'use strict';
// npm run rules:test (ai_memory/15_accounts_and_sync.md, 7.3 and 7.7): runs every case in tests/rules/cases.js
// against the rules texts in infra/firebase/ through the Firebase Rules API's test method, and prints SUCCESS
// or FAILURE per case. projects.test only compiles the given source and evaluates it on the given requests:
// nothing is deployed and no data is read or written. It uses the owner's gcloud login (set GCLOUD to use
// another gcloud than ~/google-cloud-sdk/bin/gcloud or the one on PATH).
//
//   node infra/scripts/rules-test.js [text]     only the cases whose name contains text
//
// How a case becomes a TestCase (the forms below are the ones the API accepted on the first run, 2026-09-30):
// - request.auth is { uid, token: { email_verified } }, or null when signed out. It must be sent as null: an
//   omitted auth makes request.auth an error, not null.
// - request.path is /databases/(default)/documents/<path> or /b/<bucket>/o/<path>. A Firestore list is
//   evaluated at a document path inside the queried collection (the collection path alone matches no rule),
//   so a placeholder document id is appended. A Storage list uses the prefix without its trailing slash (with
//   the slash the API answers INVALID_ARGUMENT).
// - request.resource is { data } in Firestore and the object metadata { size, contentType } in Storage; the
//   TestCase's resource is the same for what is stored before the request.
// - Values: the API reads a whole JSON number as an int and any other number as a float, and reads an RFC 3339
//   string as a timestamp ({ seconds, nanos } and { timestampValue } stay maps). So { $ts: ms } is sent as
//   new Date(ms).toISOString(), and time as the same string.
// - get() and firestore.get() are mocked by function name, 'get' in Firestore rules and 'firestore.get' in
//   Storage rules, with args [{ exactValue: '/databases/(default)/documents/users/<uid>' }] (the plain path
//   string matches, although the API reports the call's argument URL-encoded; another uid's path doesn't, so
//   an ALLOW proves the rule read the right head). The result is
//   { value: { data: head } }, or { undefined: {} } when the head is missing: the call then fails with a
//   "Service call error" and the rule denies, as a real get() of a missing document does.
// Each result's functionCalls are also checked against the access-call budget in 4.8 and 4.9: board writes
// make no call, a device write or a hard delete one, a Storage upload or delete one.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');
const { cases, validate } = require('../../tests/rules/cases.js');

const PROJECT = 'recaller-cloud';
const BUCKET = 'recaller-cloud-data';
const ENDPOINT = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`;
const DOCS = '/databases/(default)/documents';
const LIST_DOC = 'anyDocument';
const PER_REQUEST = 40;
const SERVICES = {
  firestore: { file: path.join(__dirname, '..', 'firebase', 'firestore.rules'), mock: 'get' },
  storage: { file: path.join(__dirname, '..', 'firebase', 'storage.rules'), mock: 'firestore.get' },
};

function gcloudToken() {
  const bundled = path.join(os.homedir(), 'google-cloud-sdk', 'bin', process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud');
  const gcloud = process.env.GCLOUD || (fs.existsSync(bundled) ? bundled : 'gcloud');
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  try {
    const out = process.platform === 'win32'
      ? execSync(`"${gcloud}" auth print-access-token`, opts)
      : execFileSync(gcloud, ['auth', 'print-access-token'], opts);
    return out.trim();
  } catch {
    console.error(`Could not get a token from ${gcloud}. Sign in with: gcloud auth login --update-adc`);
    process.exit(1);
  }
}

function value(v) {
  if (Array.isArray(v)) return v.map(value);
  if (v !== null && typeof v === 'object') {
    if (Object.hasOwn(v, '$ts')) return new Date(v.$ts).toISOString();
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]));
  }
  return v;
}

function toTestCase(c) {
  const firestore = c.service === 'firestore';
  const request = {
    auth: c.auth ? { uid: c.auth.uid, token: { email_verified: c.auth.verified } } : null,
    path: firestore ? `${DOCS}/${c.path}${c.method === 'list' ? '/' + LIST_DOC : ''}` : `/b/${BUCKET}/o/${c.path}`,
    method: c.method,
    time: value(c.time),
  };
  if (c.incoming) request.resource = firestore ? { data: value(c.incoming) } : value(c.incoming);
  const test = { expectation: c.expect, request };
  if (c.existing) test.resource = firestore ? { data: value(c.existing) } : value(c.existing);
  // Production gives a Storage upload of a new file `resource == null` (an upload over a stored file gets that
  // file's metadata, firebase-tools#4329). A TestCase without `resource` leaves it unset instead, and reading it
  // is a "Null value error", so a Storage create with nothing stored says null explicitly.
  else if (!firestore && c.method === 'create') test.resource = null;
  const uid = /^users\/([^/]+)/.exec(c.path)?.[1];
  if (uid) {
    test.functionMocks = [{
      function: SERVICES[c.service].mock,
      args: [{ exactValue: `${DOCS}/users/${uid}` }],
      result: c.head ? { value: { data: value(c.head) } } : { undefined: {} },
    }];
  }
  return test;
}

// The most get() / firestore.get() calls a request may make (4.8 "Access-call budget", 4.9).
function budget(c) {
  if (c.service === 'storage') return c.method === 'create' || c.method === 'delete' ? 1 : 0;
  if (c.method === 'get' || c.method === 'list') return 0;
  const [, , collection] = c.path.split('/');
  if (collection === 'devices') return 1;
  return collection && c.method === 'delete' ? 1 : 0;
}

async function runTests(source, testCases, token) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-goog-user-project': PROJECT,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ source, testSuite: { testCases } }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message ?? text.slice(0, 300)}`);
  return data;
}

function describe(result, lines) {
  const out = [];
  const message = result?.debugMessages?.[0];
  if (message) out.push(message.split('\n')[0]);
  const pos = result?.errorPosition;
  if (pos?.line) out.push(`line ${pos.line}: ${(lines[pos.line - 1] ?? '').trim()}`);
  return out.join('; ');
}

async function main() {
  const problems = validate(cases);
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error('tests/rules/cases.js is not valid; nothing was sent.');
    process.exit(1);
  }
  const filter = process.argv[2] ?? '';
  if (!cases.some((c) => c.name.includes(filter))) {
    console.error(`No case name contains "${filter}".`);
    process.exit(1);
  }
  const token = gcloudToken();
  let passed = 0;
  let failed = 0;
  for (const [service, { file }] of Object.entries(SERVICES)) {
    const selected = cases.filter((c) => c.service === service && c.name.includes(filter));
    if (!selected.length) continue;
    // The bytes Terraform uploads (rules.tf normalizes CRLF to LF).
    const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const lines = content.split('\n');
    const source = { files: [{ name: path.basename(file), content }] };
    for (let i = 0; i < selected.length; i += PER_REQUEST) {
      const chunk = selected.slice(i, i + PER_REQUEST);
      const data = await runTests(source, chunk.map(toTestCase), token);
      for (const issue of data.issues ?? []) {
        const at = issue.sourcePosition ? `${issue.sourcePosition.fileName}:${issue.sourcePosition.line}:${issue.sourcePosition.column}` : '';
        console.log(`${issue.severity} ${at} ${issue.description}`);
      }
      if ((data.issues ?? []).some((issue) => issue.severity === 'ERROR')) {
        console.error(`${path.basename(file)} does not compile; its cases did not run.`);
        process.exit(1);
      }
      chunk.forEach((c, k) => {
        const result = data.testResults?.[k];
        const calls = result?.functionCalls?.length ?? 0;
        const reasons = [];
        if (result?.state !== 'SUCCESS') reasons.push(`expected ${c.expect}` + (describe(result, lines) ? `; ${describe(result, lines)}` : ''));
        if (calls > budget(c)) reasons.push(`${calls} access calls, budget ${budget(c)}`);
        if (reasons.length) {
          failed++;
          console.log(`FAILURE  ${c.name}  (${reasons.join('; ')})`);
        } else {
          passed++;
          console.log(`SUCCESS  ${c.name}`);
        }
      });
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(`rules-test: ${err.message}`);
  process.exit(1);
});
