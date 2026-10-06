'use strict';
// npm run rules:smoke (ai_memory/15_accounts_and_sync.md, 7.7 and 2.10): checks the deployed rules, the indexes and
// the Identity Toolkit, Firestore and Storage REST protocols on the real project with two throwaway accounts
// (recaller-smoke-<random>@example.com), then deletes everything it made and checks that nothing is left. About
// 2,000 operations, inside the free tier. No email is sent: the owner's admin call marks the accounts verified.
//
// Run it after the Terraform apply and auth-settings.sh (infra/README.md). It reads the app key from
// infra/gcp/project.json and the owner's token from gcloud (set GCLOUD to use another gcloud than
// ~/google-cloud-sdk/bin/gcloud or the one on the PATH). No key, token or password is printed; the throwaway
// emails and uids are, so the leftovers of a killed run can be found. Ctrl+C stops the checks and still cleans up.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { execFileSync, execSync } = require('node:child_process');

const PROJECT_FILE = path.join(__dirname, '..', 'gcp', 'project.json');
const DAY = 24 * 60 * 60 * 1000;
const EARLY = 3; // notes committed with the +1 bump, at rev 2
const BULK = 399; // the 400-write commit: the head plus 399 notes, at rev 3
const PAGE = 300;
const DELETE_BATCH = 10;
const PARALLEL = 4;
const CHUNK = 2 * 1024 * 1024;
const PRIVACY_VERSION = '2026-10-01';
const D62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UID = /^[A-Za-z0-9]{20,128}$/;
const OWNER = 'owner';

// Terraform's app_config output. PowerShell may have written it with a byte-order mark or as UTF-16LE.
function loadConfig(file = PROJECT_FILE) {
  const shown = path.relative(process.cwd(), file) || file;
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    const problem = err.code === 'ENOENT' ? 'is missing' : "can't be read";
    throw new Error(`${shown} ${problem}: write it from Terraform first (infra/README.md, "The app's settings").`);
  }
  let text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le', 2) : bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let c = null;
  try { c = JSON.parse(text); } catch {}
  const ok = c && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.projectId) && /^AIza[0-9A-Za-z_-]{35}$/.test(c.apiKey)
    && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(c.storageBucket);
  if (!ok) throw new Error(`${shown} is not a valid app config (check it with npm run cloud:config).`);
  return { projectId: c.projectId, apiKey: c.apiKey, bucket: c.storageBucket };
}

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
    throw new Error(`Could not get a token from ${gcloud}. Sign in with: gcloud auth login --update-adc`);
  }
}

// An 8-bit RGB PNG of random pixels: noise doesn't compress, so the file is about width × height × 3 bytes.
function png(width, height) {
  const row = 1 + width * 3;
  const raw = crypto.randomBytes(row * height);
  for (let y = 0; y < height; y++) raw[y * row] = 0; // filter: none
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(toValue) } : {} };
  return { mapValue: { fields: toFields(v) } };
}
const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));

function fromValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromValue(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  return undefined;
}

// A Firestore timestamp in microseconds, for comparing REQUEST_TIME with commitTime exactly.
function micros(ts) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(ts ?? '');
  if (!m) return null;
  return BigInt(Date.parse(`${m[1]}Z`)) * 1000n + BigInt(`${m[2] ?? ''}000000`.slice(0, 6));
}

function claims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) ?? {};
  } catch {
    return {};
  }
}

// runQuery answers as a stream; how it is framed over HTTP is one of the facts this run records.
function parseStream(text) {
  const t = text.trim();
  if (!t) return { items: [], framing: 'an empty body' };
  try {
    const v = JSON.parse(t);
    return { items: Array.isArray(v) ? v : [v], framing: Array.isArray(v) ? 'a JSON array' : 'one JSON object' };
  } catch {}
  try {
    return { items: t.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)), framing: 'newline-delimited JSON' };
  } catch {}
  return { items: null, framing: 'unreadable' };
}

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('base64');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hex32 = () => crypto.randomBytes(16).toString('hex');
const orderKey = (i) => `a${D62[Math.floor(i / 62) % 62]}${D62[i % 62]}V`;
const inBatches = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function createSmoke({ projectId, apiKey, bucket, ownerToken, print = (line) => console.log(line) }) {
  const IDT = 'https://identitytoolkit.googleapis.com/v1';
  const DOCS = `projects/${projectId}/databases/(default)/documents`;
  const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
  const ST = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o`;
  const GCS = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const DEVICE = hex32();
  const PLATFORM = ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'linux';
  const T0 = Date.now();
  const users = [];
  const recorded = [];
  let passed = 0;
  let failed = 0;
  let clockOffset = 0;
  let stopping = false;

  // ---- HTTP. Nothing here logs a URL (the key is in some), a header or a body.
  async function request(url, { method = 'GET', headers = {}, body, auth, owner = false, cleanUp = false, timeoutMs = 60000 } = {}) {
    if (stopping && !cleanUp) throw new Error('interrupted');
    const h = { ...headers };
    if (auth) h.Authorization = auth;
    if (owner) {
      h.Authorization = `Bearer ${ownerToken}`;
      h['X-Goog-User-Project'] = projectId;
    }
    let payload = body;
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      payload = JSON.stringify(body);
      h['Content-Type'] = h['Content-Type'] ?? 'application/json';
    }
    try {
      const res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs) });
      const buf = Buffer.from(await res.arrayBuffer());
      const date = Date.parse(res.headers.get('date') ?? '');
      if (Number.isFinite(date)) clockOffset = date - Date.now();
      let data = null;
      try { data = JSON.parse(buf.toString('utf8')); } catch {}
      return { status: res.status, headers: res.headers, buf, data };
    } catch (err) {
      const error = err?.name === 'TimeoutError' ? 'timed out' : 'network error';
      return { status: 0, headers: new Headers(), buf: Buffer.alloc(0), data: null, error };
    }
  }

  const serverNow = () => Date.now() + clockOffset;
  const ok2xx = (res) => res.status >= 200 && res.status < 300;

  // Google's status word and message only. Cloud Storage's messages name the caller, so emails are left out.
  const message = (e) => (typeof e?.message === 'string' ? e.message.replace(/[^\s@'"]+@[^\s@'"]+/g, '(an email)').slice(0, 160) : '');
  function why(res) {
    if (!res.status) return res.error;
    const e = (Array.isArray(res.data) ? res.data : [res.data]).find((x) => x?.error)?.error;
    const words = e ? [e.status, message(e)].filter(Boolean).join(' ') : '';
    return `HTTP ${res.status}${words ? ` ${words}` : ''}`;
  }
  const idCode = (res) => (res.status ? /^[A-Z_]+/.exec(res.data?.error?.message ?? '')?.[0] ?? `HTTP ${res.status}` : res.error);

  function check(name, ok, detail = '') {
    if (ok) passed++;
    else failed++;
    print(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
    return ok;
  }
  const allowed = (name, res, detail = '') => check(name, ok2xx(res), ok2xx(res) ? detail : why(res));
  // A streamed method could also report the denial inside its answer.
  const denied = (res) => res.status === 403
    || (Array.isArray(res.data) && res.data.some((x) => x?.error?.status === 'PERMISSION_DENIED' || x?.error?.code === 403));
  const refused = (name, res) => check(name, denied(res), denied(res) ? '' : `expected HTTP 403, got ${why(res)}`);
  function record(label, text) {
    recorded.push(`${label}: ${text}`);
    print(`INFO  ${label}: ${text}`);
  }

  // ---- Identity Toolkit
  const identity = (method, body, opts = {}) =>
    request(`${IDT}/accounts:${method}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', body, ...opts });
  const admin = (method, body) => request(`${IDT}/projects/${projectId}/accounts:${method}`, { method: 'POST', body, owner: true, cleanUp: true });

  function newUser(label) {
    return {
      label, email: `recaller-smoke-${crypto.randomBytes(6).toString('hex')}@example.com`,
      password: crypto.randomBytes(18).toString('base64url'), uid: null, idToken: null, signedInAt: 0, deleted: false,
    };
  }

  function adopt(user, data) {
    user.uid = data.localId;
    user.idToken = data.idToken;
    user.signedInAt = Date.now();
    users.push(user);
    print(`INFO  throwaway account ${user.label}: ${user.email} (uid ${user.uid})`);
  }

  async function signUp(user) {
    const res = await identity('signUp', { email: user.email, password: user.password, returnSecureToken: true });
    if (res.status !== 200 || typeof res.data?.localId !== 'string' || typeof res.data?.idToken !== 'string') {
      const code = idCode(res);
      throw new Error(code === 'ADMIN_ONLY_OPERATION'
        ? 'sign-ups are paused (signup_enabled = false); turn them on for the run'
        : `could not create throwaway account ${user.label}: ${code}`);
    }
    adopt(user, res.data);
  }

  async function signIn(user) {
    const res = await identity('signInWithPassword', { email: user.email, password: user.password, returnSecureToken: true });
    if (res.status !== 200 || typeof res.data?.idToken !== 'string') throw new Error(`sign-in of ${user.label} failed: ${idCode(res)}`);
    user.idToken = res.data.idToken;
    user.signedInAt = Date.now();
  }

  // The user's own deletion; the recent-login rule may want a fresh sign-in first.
  async function deleteSelf(user) {
    let res = await identity('delete', { idToken: user.idToken });
    const age = Math.round((Date.now() - user.signedInAt) / 1000);
    if (idCode(res) === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') {
      record(`recent-login window (${user.label})`, `accounts:delete refused an ID token ${age} s after sign-in`);
      await signIn(user);
      res = await identity('delete', { idToken: user.idToken });
    } else if (res.status === 200) {
      record(`recent-login window (${user.label})`, `accounts:delete accepted an ID token ${age} s after sign-in`);
    }
    if (res.status === 200) user.deleted = true;
    return res;
  }

  // ---- Firestore (the user's ID token as Bearer, so the rules apply; the owner's token bypasses them)
  const docName = (p) => `${DOCS}/${p}`;
  const docUrl = (p) => `${FS}/${p.split('/').map(encodeURIComponent).join('/')}`;
  const bearer = (u) => `Bearer ${u.idToken}`;
  const as = (who) => (who === OWNER ? { owner: true, cleanUp: true } : { auth: bearer(who) });
  const fsGet = (who, p) => request(docUrl(p), as(who));
  const commit = (who, writes) => request(`${FS}:commit`, { method: 'POST', body: { writes }, timeoutMs: 120000, ...as(who) });

  async function runQuery(who, parent, structuredQuery) {
    const res = await request(`${docUrl(parent)}:runQuery`, { method: 'POST', body: { structuredQuery }, ...as(who) });
    if (res.status !== 200) return { res, docs: [], error: why(res) };
    const { items, framing } = parseStream(res.buf.toString('utf8'));
    if (!items) return { res, docs: [], framing, error: 'an unreadable answer' };
    const bad = items.find((x) => x?.error);
    if (bad) return { res, docs: [], framing, error: `an error in the stream: ${[bad.error.status, message(bad.error)].filter(Boolean).join(' ')}` };
    return { res, framing, docs: items.filter((x) => typeof x?.document?.name === 'string').map((x) => x.document) };
  }

  // Every page starts just after the previous page's last document.
  async function queryAll(who, parent, query, cursorOf) {
    const docs = [];
    let q = { ...query, limit: PAGE };
    for (let pages = 1; ; pages++) {
      const r = await runQuery(who, parent, q);
      if (r.error) return { ...r, docs, pages };
      docs.push(...r.docs);
      if (r.docs.length < PAGE) return { res: r.res, framing: r.framing, docs, pages };
      if (pages >= 100) return { res: r.res, docs, pages, error: 'no end after 100 pages' };
      q = { ...query, limit: PAGE, startAt: { values: cursorOf(r.docs[r.docs.length - 1]), before: false } };
    }
  }

  // The pull query of 5.6, and the full listing of 5.9 and 5.15.
  const pullQuery = (collectionId, from, to) => ({
    from: [{ collectionId }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'GREATER_THAN', value: { integerValue: String(from) } } },
          { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(to) } } },
        ],
      },
    },
    orderBy: [
      { field: { fieldPath: '_sync.rev' }, direction: 'ASCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
    ],
  });
  const listQuery = (collectionId, select) => ({
    from: [{ collectionId }],
    ...(select ? { select: { fields: select.map((fieldPath) => ({ fieldPath })) } } : {}),
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
  });
  const revCursor = (d) => [d.fields?._sync?.mapValue?.fields?.rev ?? { nullValue: null }, { referenceValue: d.name }];
  const nameCursor = (d) => [{ referenceValue: d.name }];

  function update(p, data, { mask, transforms = [], precondition } = {}) {
    const write = { update: { name: docName(p), fields: toFields(data) } };
    if (mask) write.updateMask = { fieldPaths: mask };
    if (transforms.length) write.updateTransforms = transforms.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
    if (precondition) write.currentDocument = precondition;
    return write;
  }
  const remove = (p) => ({ delete: docName(p) });

  // The documents as 4.2 and 5.5 describe them.
  const head = (u) => `users/${u.uid}`;
  const headCreate = (u) => update(head(u), {
    schema: 1, rev: 1, minRev: 0, deleting: false, lastDevice: DEVICE, board: { joiner: 'blank' },
    stats: { projects: 0, notes: 0, images: 0 }, privacy: { version: PRIVACY_VERSION, acceptedAt: new Date(serverNow()) },
  }, { transforms: ['createdAt', 'updatedAt'], precondition: { exists: false } });
  const headBump = (u, rev, updateTime, stats) => update(head(u),
    { rev, lastDevice: DEVICE, board: { joiner: 'blank' }, stats },
    { mask: ['rev', 'lastDevice', 'board', 'stats'], transforms: ['updatedAt'], precondition: { updateTime } });
  const startDeletion = (u) => update(head(u), { deleting: true },
    { mask: ['deleting'], transforms: ['deletingAt'], precondition: { exists: true } });
  const projectWrite = (u, pid, rev) => update(`${head(u)}/projects/${pid}`, {
    name: 'Smoke test', color: 'monstera', createdAt: T0, _sync: { rev, key: 'V', deleted: false, by: DEVICE },
  }, { transforms: ['_sync.at'] });
  const notePath = (u, n) => `${head(u)}/notes/${n.id}`;
  const noteFields = (n) => ({ text: `Smoke test note ${n.i}`, images: [], createdAt: T0, updatedAt: T0, usedAt: 0, copied: 0, lastCopiedAt: 0 });
  const noteSync = (n, pid, rev, deleted = false) => ({ rev, key: orderKey(n.i), deleted, by: DEVICE, project: pid, list: n.list });
  const noteWrite = (u, n, pid, rev) => update(notePath(u, n), { ...noteFields(n), _sync: noteSync(n, pid, rev) }, { transforms: ['_sync.at'] });
  const tombstone = (u, n, pid, rev, extra = {}) =>
    update(notePath(u, n), { ...extra, _sync: noteSync(n, pid, rev, true) }, { transforms: ['_sync.at'] });
  const trashWrite = (u, n, pid, rev) => update(`${head(u)}/trash/note-${n.id}`, {
    kind: 'note', data: JSON.stringify(noteFields(n)), rev, project: pid, list: n.list, by: DEVICE,
    expireAt: new Date(serverNow() + 30 * DAY),
  }, { transforms: ['deletedAt'] });
  const deviceWrite = (u, rev) => update(`${head(u)}/devices/${DEVICE}`, {
    name: 'Smoke test', platform: PLATFORM, appVersion: 'smoke', lastRev: rev,
    view: JSON.stringify({ prefs: {}, projects: {}, notes: {}, top: {} }), drafts: '{}',
    settings: { theme: 'deep', hideAfterCopy: false },
  }, { transforms: ['lastSeenAt'] });

  function recordRequestTime(label, res) {
    const commitTime = res.data?.commitTime;
    const stamps = (res.data?.writeResults ?? []).flatMap((w) => (w?.transformResults ?? []).map((t) => t?.timestampValue)).filter(Boolean);
    const a = micros(stamps[0]);
    const b = micros(commitTime);
    if (a === null || b === null) {
      record(`REQUEST_TIME vs commitTime (${label})`, 'the answer had no timestamps to compare');
      return;
    }
    const same = stamps.every((s) => s === stamps[0]);
    record(`REQUEST_TIME vs commitTime (${label})`, `${a === b ? 'equal' : `commitTime - REQUEST_TIME = ${b - a} µs`}`
      + ` (${stamps[0]} / ${commitTime}); ${stamps.length} REQUEST_TIME value${stamps.length === 1 ? '' : 's'}${same ? '' : ', NOT all equal'}`);
  }

  // ---- Storage v0 (Authorization: Firebase <ID token>, the SDK's protocols as src/cloud/storage.js uses them)
  const objUrl = (name) => `${ST}/${encodeURIComponent(name)}`;
  const firebase = (u) => `Firebase ${u.idToken}`;
  const images = (u) => `users/${u.uid}/images/`;

  function multipart(u, name, bytes, contentType = 'image/png') {
    const boundary = hex32();
    const before = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name, contentType })}`
      + `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    return request(`${ST}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      auth: firebase(u),
      headers: { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([Buffer.from(before), bytes, Buffer.from(`\r\n--${boundary}--`)]),
    });
  }

  async function resumable(u, name, bytes, contentType = 'image/png') {
    const start = await request(`${ST}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      auth: firebase(u),
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': contentType,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ name, contentType }),
    });
    const url = start.headers.get('x-goog-upload-url');
    if (start.status !== 200 || !url) return { res: start, requests: 1, final: false };
    if (new URL(url).origin !== new URL(ST).origin) {
      return { res: { ...start, status: 0, error: 'the upload URL is on another host' }, requests: 1, final: false };
    }
    let offset = 0;
    let requests = 1;
    let res;
    do {
      const end = Math.min(offset + CHUNK, bytes.length);
      res = await request(url, {
        method: 'POST',
        auth: firebase(u),
        headers: { 'X-Goog-Upload-Command': end === bytes.length ? 'upload, finalize' : 'upload', 'X-Goog-Upload-Offset': String(offset) },
        body: Buffer.from(bytes.subarray(offset, end)),
        timeoutMs: 120000,
      });
      requests++;
      if (res.status !== 200) break;
      offset = end;
    } while (offset < bytes.length);
    return { res, requests, final: res.status === 200 && res.headers.get('x-goog-upload-status') === 'final' };
  }

  const download = (u, name, scheme = 'Firebase') => request(`${objUrl(name)}?alt=media`, { auth: `${scheme} ${u.idToken}`, timeoutMs: 120000 });
  const listObjects = (u, prefix) =>
    request(`${ST}?prefix=${encodeURIComponent(prefix)}&delimiter=${encodeURIComponent('/')}`, { auth: firebase(u) });
  const removeObject = (u, name) => request(objUrl(name), { method: 'DELETE', auth: firebase(u) });
  const stored = (res, bytes) => ok2xx(res) && Number(res.data?.size) === bytes.length && res.data?.md5Hash === md5(bytes);

  // ---- the checks, numbered as in 7.7
  async function steps() {
    const A = newUser('A');
    const B = newUser('B');
    const thumb = png(200, 170); // 100 KB: multipart
    const full = png(1024, 1024); // 3 MB: resumable
    const pid = crypto.randomUUID();
    const notes = Array.from({ length: EARLY + BULK },
      (_, i) => ({ id: crypto.randomUUID(), i, list: ['notes', 'used', 'combined'][i % 3], rev: 0 }));
    const early = notes.slice(0, EARLY);
    const bulk = notes.slice(EARLY);
    const stats = (n) => ({ projects: 1, notes: n, images: 0 });

    // 1. Unverified access
    await signUp(A);
    await signUp(B);
    check('1. a new account starts unverified', claims(A.idToken).email_verified === false && claims(B.idToken).email_verified === false);
    refused('1. unverified: reading its own head is refused', await fsGet(A, head(A)));
    refused('1. unverified: creating its own head is refused', await commit(A, [headCreate(A)]));
    refused('1. unverified: querying its own notes is refused', (await runQuery(A, head(A), listQuery('notes'))).res);
    refused('1. unverified: an upload is refused', await multipart(A, `${images(A)}${hex32()}.t.png`, thumb));
    refused('1. unverified: listing its own pictures is refused', await listObjects(A, images(A)));

    // 2. Verified by the owner's admin call (no email is sent), then signed in again
    for (const u of [A, B]) {
      const res = await admin('update', { localId: u.uid, emailVerified: true });
      if (res.status !== 200) throw new Error(`the admin call accounts:update failed: ${why(res)}`);
      await signIn(u);
    }
    check('2. accounts:update marks them verified, and the next ID token says so',
      claims(A.idToken).email_verified === true && claims(B.idToken).email_verified === true);

    // 3. Head rules
    let res = await commit(A, [headCreate(A)]);
    if (!allowed('3. creating the head at rev 1 works', res)) throw new Error('the other checks need a head');
    let headTime = res.data?.writeResults?.[0]?.updateTime;
    recordRequestTime('head creation', res);
    refused('3. a +2 bump is refused', await commit(A, [headBump(A, 3, headTime, stats(0))]));
    res = await commit(A, [headBump(A, 2, headTime, stats(EARLY)), projectWrite(A, pid, 2), ...early.map((n) => noteWrite(A, n, pid, 2))]);
    if (!allowed(`3. a +1 bump works (with a project and ${EARLY} notes)`, res)) throw new Error('board commits are refused');
    headTime = res.data?.writeResults?.[0]?.updateTime;
    for (const n of early) n.rev = 2;
    refused('3. another user reading the head is refused', await fsGet(B, head(A)));
    refused('3. another user querying the notes is refused', (await runQuery(B, head(A), listQuery('notes'))).res);
    refused('3. another user writing a note is refused', await commit(B, [noteWrite(A, { id: crypto.randomUUID(), i: 0, list: 'notes' }, pid, 3)]));

    // 4. A 400-write commit: board writes make no access calls, so the 20-per-batch limit never applies
    const t0 = Date.now();
    res = await commit(A, [headBump(A, 3, headTime, stats(EARLY + BULK)), ...bulk.map((n) => noteWrite(A, n, pid, 3))]);
    if (!allowed(`4. a ${BULK + 1}-write commit (the head plus ${BULK} notes) works`, res, `${Date.now() - t0} ms`)) {
      throw new Error('the large commit was refused');
    }
    headTime = res.data?.writeResults?.[0]?.updateTime;
    for (const n of bulk) n.rev = 3;
    recordRequestTime(`${BULK + 1}-write commit`, res);

    // 5. The exact pull query and bootstrap query, in pages of 300
    const expectPull = notes.map((n) => ({ rev: n.rev, name: docName(notePath(A, n)) }))
      .sort((a, b) => a.rev - b.rev || byName(a.name, b.name)).map((x) => x.name);
    const pull = await queryAll(A, head(A), pullQuery('notes', 0, 3), revCursor);
    if (pull.framing) record('runQuery framing', `${pull.framing} (Content-Type: ${pull.res.headers.get('content-type') ?? 'none'})`);
    check('5. the pull query returns every note in (rev, name) order, with no index error',
      !pull.error && JSON.stringify(pull.docs.map((d) => d.name)) === JSON.stringify(expectPull),
      pull.error ?? `${pull.docs.length} of ${notes.length} in ${count(pull.pages, 'page')}`);
    const pullProjects = await queryAll(A, head(A), pullQuery('projects', 0, 3), revCursor);
    check('5. the pull query on projects returns the project',
      !pullProjects.error && pullProjects.docs.length === 1 && pullProjects.docs[0].name === docName(`${head(A)}/projects/${pid}`),
      pullProjects.error ?? count(pullProjects.docs.length, 'document'));
    const boot = await queryAll(A, head(A), listQuery('notes'), nameCursor);
    check('5. the bootstrap query returns every note in name order',
      !boot.error && JSON.stringify(boot.docs.map((d) => d.name)) === JSON.stringify([...expectPull].sort(byName)),
      boot.error ?? `${boot.docs.length} of ${notes.length} in ${count(boot.pages, 'page')}`);

    // 6. Item rules
    const [n0, n1, n2] = bulk;
    refused('6. a backwards rev is refused', await commit(A, [headBump(A, 4, headTime, stats(EARLY + BULK)), noteWrite(A, n0, pid, 2)]));
    refused('6. a tombstone with content is refused',
      await commit(A, [headBump(A, 4, headTime, stats(EARLY + BULK - 1)), tombstone(A, n1, pid, 4, { text: 'still here' })]));
    refused('6. a hard delete while not deleting is refused', await commit(A, [remove(notePath(A, n0))]));
    res = await fsGet(A, head(A));
    check('6. a refused commit writes nothing (the head is still at rev 3)',
      res.status === 200 && fromValue(res.data?.fields?.rev) === 3 && res.data?.updateTime === headTime, res.status === 200 ? '' : why(res));
    res = await commit(A, [headBump(A, 4, headTime, stats(EARLY + BULK - 1)), tombstone(A, n2, pid, 4), trashWrite(A, n2, pid, 4)]);
    if (allowed('6. a delete (tombstone plus a trash copy that expires in 30 days) works', res)) headTime = res.data?.writeResults?.[0]?.updateTime;
    const inc = await queryAll(A, head(A), pullQuery('notes', 3, 4), revCursor);
    check('6. the pull of (3, 4] returns just that tombstone',
      !inc.error && inc.docs.length === 1 && inc.docs[0].name === docName(notePath(A, n2))
        && Object.keys(inc.docs[0].fields ?? {}).join() === '_sync',
      inc.error ?? count(inc.docs.length, 'document'));
    allowed('6. a device record write works', await commit(A, [deviceWrite(A, 4)]));

    // 7. Storage. A working upload also proves the IAM grant: the rules read the head in Firestore.
    const pic = hex32();
    const thumbName = `${images(A)}${pic}.t.png`;
    const fullName = `${images(A)}${pic}.png`;
    res = await multipart(A, thumbName, thumb);
    check(`7. a ${Math.round(thumb.length / 1024)} KB multipart upload with Authorization: Firebase works`, stored(res, thumb),
      ok2xx(res) ? (stored(res, thumb) ? '' : 'the stored size or md5 differs') : `${why(res)} (a new IAM grant can take several minutes)`);
    const up = await resumable(A, fullName, full);
    check(`7. a ${(full.length / 1048576).toFixed(1)} MB resumable upload works`, up.final && stored(up.res, full),
      up.final ? (stored(up.res, full) ? `${up.requests} requests` : 'the stored size or md5 differs') : why(up.res));
    refused('7. an overwrite is refused', await multipart(A, thumbName, png(8, 8)));
    for (const [name, bytes] of [[thumbName, thumb], [fullName, full]]) {
      res = await download(A, name);
      const match = res.status === 200 && sha256(res.buf) === sha256(bytes);
      check(`7. the downloaded ${name.endsWith('.t.png') ? 'thumbnail' : 'picture'} matches the upload`, match,
        match ? '' : res.status === 200 ? 'the bytes differ' : why(res));
    }
    res = await listObjects(A, images(A));
    const listed = (res.data?.items ?? []).map((x) => x?.name).sort(byName);
    check('7. listing the pictures works', res.status === 200 && JSON.stringify(listed) === JSON.stringify([fullName, thumbName].sort(byName)),
      res.status === 200 ? `${listed.length} listed` : why(res));
    res = await download(A, thumbName, 'Bearer');
    const got = res.status === 200 ? (sha256(res.buf) === sha256(thumb) ? ', the right bytes' : ', other bytes') : '';
    record('Storage v0 with Authorization: Bearer <ID token>', `${why(res)}${got}`);
    refused('7. another user downloading a picture is refused', await download(B, thumbName));
    refused('7. another user listing the pictures is refused', await listObjects(B, images(A)));
    refused('7. an upload with no head is refused', await multipart(B, `${images(B)}${hex32()}.t.png`, thumb));

    // 8. Account deletion and its gating, in the order of 5.15
    await signIn(A); // the app re-authenticates right before it deletes
    res = await commit(A, [startDeletion(A)]);
    if (!allowed('8. starting the deletion (deleting: true) works', res)) throw new Error('the deletion could not start');
    headTime = res.data?.writeResults?.[0]?.updateTime;
    refused('8. while deleting, a board commit is refused', await commit(A, [headBump(A, 5, headTime, stats(0)), noteWrite(A, n0, pid, 5)]));
    refused('8. while deleting, a device write is refused', await commit(A, [deviceWrite(A, 5)]));
    refused('8. while deleting, an upload is refused', await multipart(A, `${images(A)}${hex32()}.t.png`, thumb));
    res = await listObjects(A, images(A));
    const names = (res.data?.items ?? []).map((x) => x?.name).filter((n) => typeof n === 'string' && n.startsWith(images(A)));
    const gone = await pool(names, 8, (name) => removeObject(A, name));
    res = await listObjects(A, images(A));
    check('8. the pictures delete', names.length === 2 && gone.every(ok2xx) && res.status === 200 && !(res.data?.items ?? []).length,
      `${gone.filter(ok2xx).length} of ${names.length} deleted${gone.every(ok2xx) ? '' : `; ${why(gone.find((r) => !ok2xx(r)))}`}`);
    const problems = [];
    let deleted = 0;
    for (const collection of ['notes', 'projects', 'trash', 'devices']) {
      const all = await queryAll(A, head(A), listQuery(collection, ['__name__']), nameCursor);
      if (all.error) {
        problems.push(`${collection}: ${all.error}`);
        continue;
      }
      const results = await pool(inBatches(all.docs.map((d) => d.name), DELETE_BATCH), PARALLEL,
        (batch) => request(`${FS}:commit`, { method: 'POST', auth: bearer(A), body: { writes: batch.map((name) => ({ delete: name })) } }));
      const bad = results.find((r) => !ok2xx(r));
      if (bad) problems.push(`${collection}: ${why(bad)}`);
      else deleted += all.docs.length;
    }
    const expected = notes.length + 3; // the notes, the project, the trash copy and the device record
    check(`8. the documents delete, ${DELETE_BATCH} per commit`, !problems.length && deleted === expected,
      problems.length ? problems.join('; ') : `${deleted} of ${expected}`);
    allowed('8. the head deletes', await commit(A, [remove(head(A))]));
    allowed('8. accounts:delete deletes the account', await deleteSelf(A));

    // 9. REQUEST_TIME is recorded above. The password policy: 8 or more characters.
    const C = newUser('C');
    C.password = crypto.randomBytes(8).toString('base64url').slice(0, 7);
    res = await identity('signUp', { email: C.email, password: C.password, returnSecureToken: true });
    if (res.status === 200 && typeof res.data?.localId === 'string') {
      adopt(C, res.data);
      check('9. a sign-up with 7 characters is refused (PASSWORD_DOES_NOT_MEET_REQUIREMENTS)', false,
        'it was accepted: the password policy is not enforced (run infra/scripts/auth-settings.sh)');
      await deleteSelf(C);
    } else {
      const code = idCode(res);
      check('9. a sign-up with 7 characters is refused (PASSWORD_DOES_NOT_MEET_REQUIREMENTS)',
        code === 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS', code === 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS' ? '' : `got ${code}`);
    }

    // 10. The second account, which never had a head, deletes itself; the clean-up checks everything.
    allowed('10. the second account deletes itself', await deleteSelf(B));
  }

  // ---- clean-up with the owner's access, whatever the checks left. Only paths under users/<a uid made here>.
  async function collectionIds(parent) {
    const ids = [];
    let pageToken = '';
    do {
      const body = pageToken ? { pageSize: 100, pageToken } : { pageSize: 100 };
      const r = await request(`${docUrl(parent)}:listCollectionIds`, { method: 'POST', owner: true, cleanUp: true, body });
      if (r.status !== 200) return { ids, error: why(r) };
      ids.push(...(Array.isArray(r.data?.collectionIds) ? r.data.collectionIds : []));
      pageToken = typeof r.data?.nextPageToken === 'string' ? r.data.nextPageToken : '';
    } while (pageToken);
    return { ids };
  }

  async function gcsList(prefix) {
    const names = [];
    let pageToken = '';
    do {
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const fields = encodeURIComponent('items(name),nextPageToken');
      const r = await request(`${GCS}?prefix=${encodeURIComponent(prefix)}&fields=${fields}${page}`, { owner: true, cleanUp: true });
      if (r.status !== 200) return { names, error: why(r) };
      for (const item of Array.isArray(r.data?.items) ? r.data.items : []) {
        if (typeof item?.name === 'string' && item.name.startsWith(prefix)) names.push(item.name);
      }
      pageToken = typeof r.data?.nextPageToken === 'string' ? r.data.nextPageToken : '';
    } while (pageToken);
    return { names };
  }

  async function sweep(u) {
    const removed = [];
    if (UID.test(u.uid ?? '')) {
      const parent = head(u);
      const inside = `${docName(parent)}/`;
      let docs = 0;
      const { ids } = await collectionIds(parent);
      for (const collection of ids) {
        const all = await queryAll(OWNER, parent, listQuery(collection, ['__name__']), nameCursor);
        for (const batch of inBatches(all.docs.map((d) => d.name).filter((name) => name.startsWith(inside)), 200)) {
          const r = await commit(OWNER, batch.map((name) => ({ delete: name })));
          if (ok2xx(r)) docs += batch.length;
        }
      }
      if ((await fsGet(OWNER, parent)).status === 200 && ok2xx(await commit(OWNER, [remove(parent)]))) docs++;
      if (docs) removed.push(count(docs, 'document'));
      const { names } = await gcsList(`users/${u.uid}/`);
      let pictures = 0;
      for (const name of names) {
        if (ok2xx(await request(`${GCS}/${encodeURIComponent(name)}`, { method: 'DELETE', owner: true, cleanUp: true }))) pictures++;
      }
      if (pictures) removed.push(count(pictures, 'picture'));
    } else if (u.uid) {
      print(`INFO  ${u.label}'s uid has an unexpected shape, so its documents and pictures were not swept; check users/${u.uid} by hand`);
    }
    // The admin call first; if the owner's token can't, the account's own ID token can still delete it.
    if (u.uid && !u.deleted && ((await admin('delete', { localId: u.uid })).status === 200
      || (u.idToken && (await identity('delete', { idToken: u.idToken }, { cleanUp: true })).status === 200))) {
      u.deleted = true;
      removed.push('the account');
    }
    return removed.join(', ');
  }

  async function remains(u) {
    const left = [];
    const r = await admin('lookup', { localId: [u.uid] });
    if (r.status !== 200) left.push(`the account lookup failed (${why(r)})`);
    else if (Array.isArray(r.data?.users) && r.data.users.length) left.push('the account');
    if (UID.test(u.uid ?? '')) {
      const h = await fsGet(OWNER, head(u));
      if (h.status === 200) left.push('the head');
      else if (h.status !== 404) left.push(`the head read failed (${why(h)})`);
      const { ids, error } = await collectionIds(head(u));
      if (error) left.push(`listing collections failed (${error})`);
      else if (ids.length) left.push(`documents in ${ids.join(', ')}`);
      const listed = await gcsList(`users/${u.uid}/`);
      if (listed.error) left.push(`listing pictures failed (${listed.error})`);
      else if (listed.names.length) left.push(count(listed.names.length, 'picture'));
    }
    return left;
  }

  async function cleanUp() {
    for (const u of users) {
      const removed = await sweep(u);
      if (removed) print(`INFO  the clean-up removed ${removed} of ${u.label}`);
    }
    for (const u of users) {
      const left = await remains(u);
      check(`10. nothing remains of ${u.label} (account, documents, pictures)`, !left.length, left.join('; '));
    }
    if (users.length) print('INFO  deleted pictures stay soft-deleted for 7 days, and the daily Firestore backups keep old documents for 7 days');
  }

  // The clean-up needs the owner's access, so it is checked (read-only) before anything is made.
  async function preflight() {
    const probe = `recallersmokeprobe${hex32()}`;
    const problems = [];
    const r = await admin('lookup', { localId: [probe] });
    if (r.status !== 200) problems.push(`Identity Toolkit admin: ${why(r)}`);
    const c = await collectionIds(`users/${probe}`);
    if (c.error) problems.push(`Firestore: ${c.error}`);
    const g = await gcsList(`users/${probe}/`);
    if (g.error) problems.push(`Cloud Storage: ${g.error}`);
    return problems;
  }

  async function run() {
    print(`Smoke test on ${projectId} (bucket ${bucket}): throwaway accounts, about 2,000 operations, then a full clean-up.`);
    const problems = await preflight();
    if (problems.length) {
      check("the owner's access works (the clean-up needs it); nothing was made", false, problems.join('; '));
    } else {
      try {
        await steps();
      } catch (err) {
        check('the run reaches the end', false, err.message);
      }
      try {
        await cleanUp();
      } catch (err) {
        check('the clean-up finishes', false, `${err.message}; delete the accounts listed above by hand`);
      }
    }
    print('');
    if (recorded.length) {
      print('Recorded (ai_memory/15_accounts_and_sync.md, 2.10 and 9.2):');
      for (const line of recorded) print(`  ${line}`);
      print('');
    }
    print(`${passed} passed, ${failed} failed`);
    return { passed, failed, recorded };
  }

  return { run, stop: () => { stopping = true; } };
}

async function main() {
  const config = loadConfig();
  const ownerToken = gcloudToken();
  const smoke = createSmoke({ ...config, ownerToken });
  process.once('SIGINT', () => {
    console.log('\nInterrupted: finishing the current request, then cleaning up (Ctrl+C again leaves the rest).');
    smoke.stop();
    process.once('SIGINT', () => process.exit(130));
  });
  const { failed } = await smoke.run();
  if (failed) process.exitCode = 1;
}

module.exports = { createSmoke, loadConfig, png, parseStream, micros };

if (require.main === module) {
  main().catch((err) => {
    console.error(`rules-smoke: ${err.message}`);
    process.exit(1);
  });
}
