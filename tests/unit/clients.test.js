'use strict';
// The WP2 REST clients (src/cloud: http, auth, firestore, storage) against the GCP mock (tests/mock-gcp) over real
// HTTP on 127.0.0.1, with Node's global fetch as fetchImpl (ai_memory/15, 7.4): error mapping, 401 then refresh
// then retry, precondition failures as HEAD_MOVED, runQuery paging, JSON-array and NDJSON streams, multipart
// uploads up to 256 KiB and resumable ones above (resuming after a failure), the Firebase scheme, and an upload
// to a name that already holds a picture: refused (in Storage rules that is a create over it), then counted as
// existed from one stat, whether the account's bytes are these or other ones (which stay).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const { inspect } = require('node:util');
const { createGcpMock } = require('../mock-gcp');
const { loadConfig } = require('../../src/cloud/config');
const { CloudError, createHttp, errorFrom } = require('../../src/cloud/http');
const { createAuth } = require('../../src/cloud/auth');
const { createFirestore, parseStream } = require('../../src/cloud/firestore');
const { createStorage } = require('../../src/cloud/storage');
const { toValue, encodeFields, decodeFields, docId } = require('../../src/cloud/codec');

const mock = createGcpMock();
let config;
test.before(async () => {
  await mock.listen();
  config = loadConfig({ env: mock.env(), isPackaged: false });
});
test.after(() => mock.close());
test.beforeEach(() => mock.reset());

const KiB = 1024;
const MiB = 1024 * KiB;
const PASSWORD = 'correct horse battery';
const DEVICE = `c0ffee${'0'.repeat(26)}`;
const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('base64');
const hex32 = (seed) => crypto.createHash('md5').update(String(seed)).digest('hex');
const picture = (a, seed, thumb = false) => `users/${a.uid}/images/${hex32(seed)}${thumb ? '.t' : ''}.png`;

// The mock's log from index `from` on, as 'op status'.
const since = (from) => mock.log.slice(from).map((e) => `${e.op} ${e.status}`);
const ids = (docs) => docs.map((d) => d.path.split('/').pop());

async function all(iterable) {
  const out = [];
  for await (const x of iterable) out.push(x);
  return out;
}

// Awaits a rejection with a CloudError whose fields include `expected`, and returns the error.
async function rejects(promise, expected) {
  let error = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof CloudError, `expected a CloudError, got ${error}`);
  for (const [k, v] of Object.entries(expected)) assert.equal(error[k], v, `${k} of "${error.message}"`);
  return error;
}

// The clients as the app wires them, pointed at the mock by loadConfig().
function clients({ getIdToken = async () => '', fetchImpl = fetch, endpoints = config.endpoints, apiKey = config.apiKey } = {}) {
  const http = createHttp({ fetchImpl });
  return {
    http,
    auth: createAuth({ http, endpoints, apiKey }),
    firestore: createFirestore({ http, endpoints, projectId: config.projectId, getIdToken }),
    storage: createStorage({ http, endpoints, bucket: config.bucket, getIdToken }),
  };
}

// A verified user signed in through the client, with the head created (spec 5.5). getIdToken is what account.js
// gives the clients: the session's ID token, or with force a refresh through Secure Token. calls records each force.
async function account(email = 'alice@example.com', { fetchImpl = fetch } = {}) {
  mock.createUser({ email, password: PASSWORD, verified: true });
  const a = { email, calls: [], rev: 1 };
  const getIdToken = async ({ force = false } = {}) => {
    a.calls.push(force);
    if (force) a.session = await a.auth.refresh(a.session.refreshToken);
    return a.session.idToken;
  };
  Object.assign(a, clients({ getIdToken, fetchImpl }));
  a.session = await a.auth.signIn(email, PASSWORD);
  a.uid = a.session.uid;
  a.headTime = (await a.firestore.commit([headCreate(a)])).writeResults[0].updateTime;
  a.calls.length = 0;
  return a;
}

// ---- the app's writes (spec 4.2, 5.5), encoded with codec.js

const docName = (a, rest = '') => a.firestore.name(`users/${a.uid}${rest && `/${rest}`}`);
const requestTime = (...paths) => paths.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));

function headCreate(a) {
  const { fields } = encodeFields({
    schema: 1, rev: 1, minRev: 0, deleting: false, lastDevice: DEVICE, board: { joiner: 'blank' }, stats: { projects: 0, notes: 0, images: 0 },
  });
  return { update: { name: docName(a), fields }, updateTransforms: requestTime('createdAt', 'updatedAt'), currentDocument: { exists: false } };
}

function headBump(a, rev = a.rev + 1, updateTime = a.headTime) {
  const { fields } = encodeFields({ rev, lastDevice: DEVICE, board: { joiner: 'blank' }, stats: { projects: 1, notes: 0, images: 0 } });
  return {
    update: { name: docName(a), fields },
    updateMask: { fieldPaths: ['rev', 'lastDevice', 'board', 'stats'] },
    updateTransforms: requestTime('updatedAt'),
    currentDocument: { updateTime },
  };
}

function noteWrite(a, id, rev, data = {}) {
  const { fields } = encodeFields({ text: `note ${id}`, createdAt: 1758690000000, ...data });
  fields._sync = toValue({ rev, key: 'V', deleted: false, by: DEVICE, project: 'p1', list: 'notes' });
  return { update: { name: docName(a, `notes/${docId(id)}`), fields }, updateTransforms: requestTime('_sync.at') };
}

const startDeletion = (a) => ({
  update: { name: docName(a), fields: { deleting: toValue(true) } },
  updateMask: { fieldPaths: ['deleting'] },
  updateTransforms: requestTime('deletingAt'),
});

// One board commit: the head moves up by one, with whole notes (data: id → extra fields).
async function push(a, noteIds, data = {}) {
  const rev = a.rev + 1;
  const res = await a.firestore.commit([headBump(a, rev), ...noteIds.map((id) => noteWrite(a, id, rev, data[id]))]);
  a.rev = rev;
  a.headTime = res.writeResults[0].updateTime;
  return res;
}

// Notes n1…n7 at revs 2, 3 and 4; by (rev, name) they read n1 n3 n6 | n2 n7 | n4 n5.
async function sevenNotes(a) {
  await push(a, ['n3', 'n1', 'n6']);
  await push(a, ['n2', 'n7']);
  await push(a, ['n4', 'n5']);
}

// The pull query of spec 5.6: notes with lo < _sync.rev <= hi, by (_sync.rev, __name__).
const BY_REV = [{ field: { fieldPath: '_sync.rev' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
const pull = (lo, hi) => ({
  from: [{ collectionId: 'notes' }],
  where: {
    compositeFilter: {
      op: 'AND',
      filters: [
        { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'GREATER_THAN', value: toValue(lo) } },
        { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'LESS_THAN_OR_EQUAL', value: toValue(hi) } },
      ],
    },
  },
  orderBy: BY_REV,
});

// ---- fetch wrappers (still the mock over HTTP underneath)

// Keeps each request's URL, method, headers and body for the test to read.
function recorder(inner = fetch) {
  const requests = [];
  const fetchImpl = (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', headers: new Headers(init.headers), body: init.body });
    return inner(url, init);
  };
  return { fetchImpl, requests };
}

const isStream = (url) => /:(?:runQuery|batchGet)$/.test(new URL(url).pathname);

function answer(res, text) {
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(text, { status: res.status, statusText: res.statusText, headers });
}

// The mock answers runQuery and batchGet as a JSON array. The real framing is unconfirmed (spec 9.2), so the same
// answer is re-framed here the other ways the service might send it.
function reframed(style) {
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!isStream(url)) return res;
    const items = JSON.parse(await res.text());
    const lines = items.map((x) => JSON.stringify(x));
    const text = {
      array: JSON.stringify(items),
      pretty: `[${lines.join('\n,')}\n]`,
      ndjson: `${lines.join('\n')}\n`,
      concatenated: lines.join(''),
      commas: lines.join(',\r\n'),
    }[style];
    return answer(res, text);
  };
}

function closedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// ---- config and auth

test('loadConfig() points every client at the mock', async () => {
  assert.equal(config.mock, true);
  assert.deepEqual(config.endpoints, {
    identity: `${mock.base}/identitytoolkit.googleapis.com/v1`,
    token: `${mock.base}/securetoken.googleapis.com/v1`,
    firestore: `${mock.base}/firestore.googleapis.com/v1`,
    storage: `${mock.base}/firebasestorage.googleapis.com/v0`,
  });
  assert.deepEqual([config.projectId, config.bucket, config.apiKey], [mock.projectId, mock.bucket, mock.apiKey]);
  assert.equal(clients().firestore.name('users/u1'), 'projects/demo-recaller/databases/(default)/documents/users/u1');
});

test('auth: sign-up and sign-in give a session, and claims() reads the ID token', async () => {
  const rec = recorder();
  const { auth } = clients({ fetchImpl: rec.fetchImpl });
  const before = Date.now();
  const s = await auth.signUp('Alice@Example.com', PASSWORD);
  const after = Date.now();
  assert.deepEqual(Object.keys(s).sort(), ['email', 'emailVerified', 'expiresAt', 'idToken', 'refreshToken', 'uid']);
  assert.equal(s.uid, mock.user('alice@example.com').uid);
  assert.equal(s.email, 'alice@example.com');
  assert.equal(s.emailVerified, false);
  assert.ok(s.expiresAt >= before + 3600e3 && s.expiresAt <= after + 3600e3, 'local receipt time + expiresIn');
  const c = auth.claims(s.idToken);
  assert.deepEqual(Object.keys(c), ['user_id', 'email_verified', 'exp']);
  assert.deepEqual([c.user_id, c.email_verified], [s.uid, false]);
  assert.ok(c.exp * 1000 > after);
  assert.deepEqual(auth.claims('not a token'), { user_id: null, email_verified: false, exp: 0 });

  const t = await auth.signIn('alice@example.com', PASSWORD);
  assert.equal(t.uid, s.uid);
  assert.notEqual(t.idToken, s.idToken);
  assert.deepEqual(since(0), ['signUp 200', 'signInWithPassword 200']);
  assert.ok(mock.log.every((e) => e.auth === null), 'passwords and tokens travel in bodies, never in a header');
  // Without returnSecureToken, Identity Toolkit answers with no refresh token (the mock doesn't check it).
  const sent = rec.requests.map((r) => {
    const u = new URL(r.url);
    return [u.pathname.split('/').pop(), u.search, r.headers.get('content-type'), JSON.parse(r.body)];
  });
  assert.deepEqual(sent, [
    ['accounts:signUp', `?key=${mock.apiKey}`, 'application/json', { email: 'Alice@Example.com', password: PASSWORD, returnSecureToken: true }],
    ['accounts:signInWithPassword', `?key=${mock.apiKey}`, 'application/json', { email: 'alice@example.com', password: PASSWORD, returnSecureToken: true }],
  ]);
});

test('auth: Identity Toolkit errors keep their code, and never carry the email, password or key', async () => {
  const { auth } = clients();
  await auth.signUp('alice@example.com', PASSWORD);
  const rows = [
    [() => auth.signUp('alice@example.com', PASSWORD), 'EMAIL_EXISTS'],
    [() => auth.signUp('bob@example.com', 'seven77'), 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS'],
    [() => auth.signUp('not-an-email', PASSWORD), 'INVALID_EMAIL'],
    [() => auth.signIn('alice@example.com', 'wrong password'), 'INVALID_LOGIN_CREDENTIALS'],
    [() => auth.signIn('nobody@example.com', PASSWORD), 'INVALID_LOGIN_CREDENTIALS'],
  ];
  for (const [call, code] of rows) {
    const err = await rejects(call(), { code, status: 400, retryable: false, service: 'identity', detail: '' });
    assert.doesNotMatch(inspect(err), /example\.com|not-an-email|correct horse|seven77|wrong password|mock-key/);
  }
  mock.setSignupDisabled(true);
  await rejects(auth.signUp('carol@example.com', PASSWORD), { code: 'ADMIN_ONLY_OPERATION' });
  mock.disableUser('alice@example.com');
  await rejects(auth.signIn('alice@example.com', PASSWORD), { code: 'USER_DISABLED' });
  mock.tooManyAttemptsAfter(0);
  await rejects(auth.signIn('alice@example.com', PASSWORD), { code: 'TOO_MANY_ATTEMPTS_TRY_LATER', retryable: false });
  mock.tooManyAttemptsAfter(null);

  // Prose isn't a code: a wrong API key falls through to the HTTP status.
  const wrongKey = clients({ apiKey: 'wrong-key' }).auth;
  await rejects(wrongKey.signIn('alice@example.com', PASSWORD), { code: 'BAD_REQUEST', status: 400, detail: 'INVALID_ARGUMENT' });
  mock.fail({ service: 'identity', status: 503 });
  await rejects(auth.signIn('alice@example.com', PASSWORD), { code: 'SERVER', status: 503, retryable: true, detail: 'UNAVAILABLE' });
  mock.fail({ service: 'identity', status: 429 });
  await rejects(auth.signIn('alice@example.com', PASSWORD), { code: 'QUOTA', status: 429, retryable: true });
});

test('auth: refresh rotates both tokens, and its failures keep their code', async () => {
  const rec = recorder();
  const { auth } = clients({ fetchImpl: rec.fetchImpl });
  mock.createUser({ email: 'alice@example.com', password: PASSWORD, verified: true });
  const s = await auth.signIn('alice@example.com', PASSWORD);
  const r = await auth.refresh(s.refreshToken);
  const grant = rec.requests.at(-1); // a form, as Secure Token documents it (the mock takes JSON too)
  assert.equal(grant.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.deepEqual([...new URLSearchParams(grant.body)], [['grant_type', 'refresh_token'], ['refresh_token', s.refreshToken]]);
  assert.deepEqual([r.uid, r.email, r.emailVerified], [s.uid, 'alice@example.com', true]);
  assert.notEqual(r.idToken, s.idToken);
  assert.notEqual(r.refreshToken, s.refreshToken);
  assert.ok(r.expiresAt > Date.now() + 3590e3);
  assert.equal(mock.log.at(-1).op, 'token');

  await rejects(auth.refresh('AMf-no-such-token'), { code: 'INVALID_REFRESH_TOKEN', status: 400, service: 'token', detail: 'INVALID_ARGUMENT' });
  mock.revokeTokens('alice@example.com'); // a password change elsewhere
  await rejects(auth.refresh(r.refreshToken), { code: 'TOKEN_EXPIRED' });
  const again = await auth.signIn('alice@example.com', PASSWORD);
  mock.disableUser('alice@example.com');
  await rejects(auth.refresh(again.refreshToken), { code: 'USER_DISABLED' });
  mock.disableUser('alice@example.com', false);
  mock.fail({ service: 'token', status: 503 });
  await rejects(auth.refresh(again.refreshToken), { code: 'SERVER', retryable: true, service: 'token' });
  mock.deleteUser('alice@example.com');
  await rejects(auth.refresh(again.refreshToken), { code: 'USER_NOT_FOUND' });
});

test('auth: lookup sees a verification at once, the ID token only after a refresh', async () => {
  const { auth } = clients();
  const s = await auth.signUp('alice@example.com', PASSWORD);
  await auth.sendVerification(s.idToken);
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['VERIFY_EMAIL', 'alice@example.com']]);
  assert.deepEqual(await auth.lookup(s.idToken), { uid: s.uid, email: 'alice@example.com', emailVerified: false, disabled: false });
  mock.verify('alice@example.com');
  assert.equal((await auth.lookup(s.idToken)).emailVerified, true);
  assert.equal(auth.claims(s.idToken).email_verified, false);
  const r = await auth.refresh(s.refreshToken);
  assert.equal(r.emailVerified, true);
  assert.equal(auth.claims(r.idToken).email_verified, true);
  mock.disableUser('alice@example.com');
  assert.equal((await auth.lookup(r.idToken)).disabled, true);
});

test('auth: a password reset is silent for unknown emails, and says when reCAPTCHA is needed', async () => {
  const { auth } = clients();
  mock.createUser({ email: 'alice@example.com' });
  await auth.sendPasswordReset('alice@example.com');
  await auth.sendPasswordReset('nobody@example.com');
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['PASSWORD_RESET', 'alice@example.com']]);
  mock.requireRecaptchaForReset(true);
  await rejects(auth.sendPasswordReset('alice@example.com'), { code: 'MISSING_RECAPTCHA_TOKEN', status: 400 });
});

test('auth: deleteAccount needs a recent sign-in; afterwards the account is gone', async () => {
  const { auth } = clients();
  mock.createUser({ email: 'alice@example.com', password: PASSWORD, verified: true });
  const s = await auth.signIn('alice@example.com', PASSWORD);
  mock.clock.advance(6 * 60 * 1000);
  await rejects(auth.deleteAccount(s.idToken), { code: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' });
  const fresh = await auth.signIn('alice@example.com', PASSWORD);
  await auth.deleteAccount(fresh.idToken);
  assert.equal(mock.user('alice@example.com'), null);
  await rejects(auth.lookup(fresh.idToken), { code: 'USER_NOT_FOUND' });
  await rejects(auth.refresh(fresh.refreshToken), { code: 'USER_NOT_FOUND' });
});

// ---- http: error mapping and the clock

test('http: failing statuses map to CloudError codes', async () => {
  const a = await account();
  const rows = [
    // status, code, retryable, detail (Google's status word)
    [500, 'SERVER', true, 'INTERNAL'],
    [502, 'SERVER', true, 'UNAVAILABLE'],
    [503, 'SERVER', true, 'UNAVAILABLE'],
    [504, 'SERVER', true, 'DEADLINE_EXCEEDED'],
    [429, 'QUOTA', true, 'RESOURCE_EXHAUSTED'],
    [409, 'ABORTED', true, 'ABORTED'],
    [408, 'TIMEOUT', true, 'UNKNOWN'],
    [413, 'TOO_LARGE', false, 'UNKNOWN'],
    [400, 'BAD_REQUEST', false, 'INVALID_ARGUMENT'],
    [403, 'PERMISSION', false, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND', false, 'NOT_FOUND'],
  ];
  for (const [status, code, retryable, detail] of rows) {
    mock.fail({ service: 'firestore', op: 'commit', status });
    await rejects(a.firestore.commit([headBump(a)]), { code, status, retryable, detail, service: 'firestore-commit' });
    mock.fail({ service: 'firestore', op: 'runQuery', status });
    await rejects(a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] }), { code, status, retryable, service: 'firestore' });
  }
  assert.equal(mock.docs(a.uid).head.rev, 1, 'no failed commit was applied');

  // What the mock can't produce: an index error is a precondition, but only a commit's precondition is HEAD_MOVED.
  const index = { error: { code: 400, message: 'The query requires an index.', status: 'FAILED_PRECONDITION' } };
  assert.equal(errorFrom(400, index, 'firestore').code, 'BAD_REQUEST');
  assert.equal(errorFrom(400, index, 'firestore-commit').code, 'HEAD_MOVED');
  assert.equal(errorFrom(400, { error: { code: 400, message: 'Request payload size exceeds the limit' } }, 'firestore').code, 'TOO_LARGE');
  assert.equal(errorFrom(403, { error: { code: 403, message: 'x', status: 'RESOURCE_EXHAUSTED' } }).code, 'PERMISSION');
  assert.equal(errorFrom(418, { error: { status: 'RESOURCE_EXHAUSTED' } }).code, 'QUOTA');
  assert.equal(errorFrom(418, { error: { status: 'UNAVAILABLE' } }).code, 'SERVER');
  assert.equal(errorFrom(418, 'not json').code, 'BAD_REQUEST');
});

test('http: a refused connection and a dropped answer are NETWORK, a slow answer TIMEOUT; nothing is logged', async () => {
  const printed = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[k] = console[k];
    console[k] = (...args) => printed.push(args.join(' '));
  }
  try {
    const a = await account();
    const port = await closedPort();
    const endpoints = Object.fromEntries(Object.entries(config.endpoints).map(([k, v]) => [k, v.replace(mock.base, `http://127.0.0.1:${port}`)]));
    const err = await rejects(clients({ endpoints }).auth.signIn('alice@example.com', PASSWORD), {
      code: 'NETWORK', status: 0, retryable: true, service: 'identity',
    });
    assert.doesNotMatch(inspect(err), /mock-key|example\.com|correct horse|127\.0\.0\.1/);

    mock.fail({ service: 'firestore', op: 'get', status: 'offline' });
    await rejects(a.firestore.get(`users/${a.uid}`), { code: 'NETWORK', retryable: true, service: 'firestore' });
    assert.equal(mock.log.at(-1).status, 'offline');

    const held = mock.pauseAfter('get');
    const url = `${config.endpoints.firestore}/${docName(a)}`;
    const slow = a.http.json(url, { headers: { Authorization: `Bearer ${a.session.idToken}` }, timeoutMs: 150, service: 'firestore' });
    await rejects(slow, { code: 'TIMEOUT', status: 0, retryable: true, service: 'firestore' });
    await held.hit;
    held.resume();
    assert.equal((await a.firestore.get(`users/${a.uid}`)).path, `users/${a.uid}`);
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(printed, []);
});

test('http: a success answer that can\'t be read is SERVER, never an empty result', async () => {
  let garble = null; // pathname → the body that replaces the answer, or undefined
  const a = await account('alice@example.com', {
    fetchImpl: async (url, init) => {
      const res = await fetch(url, init);
      const body = garble?.(new URL(url).pathname);
      if (body === undefined) return res;
      await res.arrayBuffer();
      return answer(res, body);
    },
  });
  // The commit landed and only its answer was cut short: it must not pass for a commit without results.
  garble = (p) => (p.endsWith(':commit') ? '{"commitTime":"2026-10-01T10:00:00.000001Z","writeResults":[' : undefined);
  await rejects(push(a, ['n1']), { code: 'SERVER', status: 200, retryable: true, service: 'firestore-commit' });
  assert.equal(mock.docs(a.uid).head.rev, 2);
  garble = (p) => (p.endsWith(`/users/${a.uid}`) ? '{}' : undefined);
  await rejects(a.firestore.get(`users/${a.uid}`), { code: 'SERVER', status: 200, retryable: true, service: 'firestore' });
});

test('http: serverNow() is the median offset of the last 5 answers\' Date headers', async () => {
  const a = await account();
  const offset = () => a.http.serverNow() - Date.now();
  assert.ok(Math.abs(offset()) < 1500);
  mock.skewMs = 90_000;
  for (let i = 0; i < 5; i++) await a.firestore.get(`users/${a.uid}`);
  let o = offset();
  assert.ok(o > 88_000 && o < 91_000, String(o)); // Date headers have whole seconds
  // Back on time: the offset follows only once 3 of the last 5 answers agree.
  mock.skewMs = 0;
  for (let i = 0; i < 2; i++) await a.firestore.get(`users/${a.uid}`);
  o = offset();
  assert.ok(o > 88_000, String(o));
  await a.firestore.get(`users/${a.uid}`);
  o = offset();
  assert.ok(Math.abs(o) < 1500, String(o));
});

// ---- Firestore

test('firestore: get() gives the document, null when missing, PERMISSION for another account', async () => {
  const a = await account();
  const head = await a.firestore.get(`users/${a.uid}`);
  assert.deepEqual(Object.keys(head), ['path', 'name', 'fields', 'createTime', 'updateTime']);
  assert.equal(head.path, `users/${a.uid}`);
  assert.equal(head.name, docName(a));
  assert.equal(head.updateTime, a.headTime);
  const data = decodeFields(head.fields);
  assert.deepEqual([data.schema, data.rev, data.minRev, data.deleting, data.board], [1, 1, 0, false, { joiner: 'blank' }]);
  assert.match(data.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/); // REQUEST_TIME comes back as a timestamp
  assert.equal(await a.firestore.get(`users/${a.uid}/notes/nope`), null);
  assert.equal((await a.firestore.get(`/users/${a.uid}/`)).path, `users/${a.uid}`);

  const b = await account('bob@example.com');
  await rejects(b.firestore.get(`users/${a.uid}`), { code: 'PERMISSION', status: 403, detail: 'PERMISSION_DENIED', retryable: false });
  mock.createUser({ email: 'unverified@example.com', password: PASSWORD });
  const u = clients();
  const session = await u.auth.signIn('unverified@example.com', PASSWORD);
  const unverified = clients({ getIdToken: async () => session.idToken }).firestore;
  await rejects(unverified.get(`users/${session.uid}`), { code: 'PERMISSION' });
});

test('firestore: commit() gives the commit time and every write result', async () => {
  const a = await account();
  const res = await push(a, ['n1', 'n2']);
  assert.deepEqual(Object.keys(res), ['commitTime', 'writeResults']);
  assert.equal(res.writeResults.length, 3);
  for (const r of res.writeResults) assert.deepEqual(Object.keys(r), ['updateTime']);
  assert.equal(res.writeResults[0].updateTime, res.commitTime);
  const docs = mock.docs(a.uid);
  assert.equal(docs.head.rev, 2);
  assert.deepEqual(Object.keys(docs.notes).sort(), ['n1', 'n2']);
  assert.equal(docs.notes.n1._sync.at.slice(0, 19), res.commitTime.slice(0, 19)); // REQUEST_TIME
});

test('firestore: precondition failures on a commit are HEAD_MOVED', async () => {
  const a = await account();
  const stale = a.headTime;
  await push(a, ['n1']);

  // An updateTime that is no longer the head's: 400 FAILED_PRECONDITION.
  await rejects(a.firestore.commit([headBump(a, 3, stale), noteWrite(a, 'n2', 3)]), {
    code: 'HEAD_MOVED', status: 400, detail: 'FAILED_PRECONDITION', retryable: false, service: 'firestore-commit',
  });
  // Creating a head that exists (another computer won the first sync): 409 ALREADY_EXISTS.
  await rejects(a.firestore.commit([headCreate(a)]), { code: 'HEAD_MOVED', status: 409, detail: 'ALREADY_EXISTS' });
  // The other computer commits between our read of the head and our commit.
  mock.bumpHeadBetweenGetAndCommit({ uid: a.uid });
  await rejects(push(a, ['n3']), { code: 'HEAD_MOVED', status: 400 });
  assert.deepEqual(mock.log.at(-1).tags, ['bumped']);
  assert.equal(mock.log.at(-1).error, undefined);

  // A lost answer: the commit landed, so the same commit again fails its precondition (spec 5.5, 13).
  const head = await a.firestore.get(`users/${a.uid}`);
  a.rev = decodeFields(head.fields).rev;
  a.headTime = head.updateTime;
  const writes = [headBump(a), noteWrite(a, 'n4', a.rev + 1)];
  mock.fail({ service: 'firestore', op: 'commit', status: 'offline', lost: true });
  await rejects(a.firestore.commit(writes), { code: 'NETWORK', retryable: true });
  await rejects(a.firestore.commit(writes), { code: 'HEAD_MOVED', status: 400 });

  // Updating a document that must exist but doesn't is NOT_FOUND, not HEAD_MOVED.
  await rejects(a.firestore.commit([{ ...noteWrite(a, 'n9', 9), currentDocument: { exists: true } }]), { code: 'NOT_FOUND', status: 404 });
  assert.deepEqual(Object.keys(mock.docs(a.uid).notes).sort(), ['n1', 'n4']);
});

test('firestore: an oversized document or request is TOO_LARGE, a malformed write BAD_REQUEST', async () => {
  const a = await account();
  await rejects(a.firestore.commit([headBump(a), noteWrite(a, 'big', 2, { text: 'x'.repeat(MiB + 1) })]), {
    code: 'TOO_LARGE', status: 400, detail: 'INVALID_ARGUMENT', retryable: false,
  });
  const many = Array.from({ length: 11 }, (_, i) => noteWrite(a, `n${i}`, 2, { text: 'y'.repeat(MiB - 1000) }));
  await rejects(a.firestore.commit([headBump(a), ...many]), { code: 'TOO_LARGE', status: 400 });
  const reserved = { update: { name: docName(a, 'notes/n1'), fields: { __bad__: toValue('x') } } };
  await rejects(a.firestore.commit([headBump(a), reserved]), { code: 'BAD_REQUEST', status: 400, detail: 'INVALID_ARGUMENT' });
  assert.equal(mock.docs(a.uid).head.rev, 1);
});

test('a 401 forces one token refresh and the request is sent again (Firestore and Storage)', async () => {
  const a = await account();
  await push(a, ['n1']);
  const pic = picture(a, 'p');
  await a.storage.upload(pic, crypto.randomBytes(100));
  const runs = [
    ['get', () => a.firestore.get(`users/${a.uid}`)],
    ['batchGet', () => a.firestore.batchGet([`users/${a.uid}/notes/n1`])],
    ['runQuery', () => a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] })],
    ['commit', () => push(a, ['n2'])],
    ['upload', () => a.storage.upload(picture(a, 'q'), crypto.randomBytes(100))],
    ['download', () => a.storage.download(pic)],
    ['metadata', () => a.storage.stat(pic)],
    ['list', () => all(a.storage.list(`users/${a.uid}/images/`))],
    ['upload-start', () => a.storage.upload(picture(a, 'r'), crypto.randomBytes(300 * KiB))],
  ];
  for (const [op, run] of runs) {
    mock.expireIdTokens();
    a.calls.length = 0;
    const from = mock.log.length;
    await run();
    assert.deepEqual(since(from).slice(0, 3), [`${op} 401`, 'token 200', `${op} 200`], op);
    assert.deepEqual(a.calls.slice(0, 2), [false, true], op);
  }
  assert.deepEqual(Object.keys(mock.docs(a.uid).notes).sort(), ['n1', 'n2']);
  assert.equal(Object.keys(mock.objects(a.uid)).length, 3);
});

test('a second 401 is UNAUTHENTICATED without a third try, and a failed refresh keeps its own code', async () => {
  const a = await account();
  const pic = picture(a, 'p');
  await a.storage.upload(pic, crypto.randomBytes(100));
  const stuck = clients({ getIdToken: async () => a.session.idToken }); // never gets a new token
  mock.expireIdTokens();
  const from = mock.log.length;
  await rejects(stuck.firestore.get(`users/${a.uid}`), { code: 'UNAUTHENTICATED', status: 401, detail: 'UNAUTHENTICATED', retryable: false });
  await rejects(stuck.storage.download(pic), { code: 'UNAUTHENTICATED', status: 401, service: 'storage' });
  assert.deepEqual(since(from), ['get 401', 'get 401', 'download 401', 'download 401']);

  // account.js turns TOKEN_EXPIRED into needs-sign-in; the client passes it on unchanged.
  mock.revokeTokens(a.email);
  a.calls.length = 0;
  await rejects(a.firestore.get(`users/${a.uid}`), { code: 'TOKEN_EXPIRED', service: 'token' });
  assert.deepEqual(a.calls, [false, true]);
});

test('firestore: batchGet() asks 100 documents a request and answers in the order asked', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  await push(a, ['n1', 'n2', 'n3']);
  const missing = Array.from({ length: 147 }, (_, i) => `users/${a.uid}/notes/m${i}`);
  const paths = [`users/${a.uid}`, ...missing, `users/${a.uid}/notes/n2`, `users/${a.uid}/notes/n1`, `/users/${a.uid}/notes/n2`];
  const from = mock.log.length;
  rec.requests.length = 0;
  const got = await a.firestore.batchGet(paths);
  assert.deepEqual(since(from), ['batchGet 200', 'batchGet 200']); // 150 distinct documents
  assert.deepEqual(rec.requests.map((r) => JSON.parse(r.body).documents.length), [100, 50]);
  assert.deepEqual([...got.keys()], paths);
  assert.equal(got.get(`users/${a.uid}`).updateTime, a.headTime);
  assert.ok(missing.every((p) => got.get(p) === null));
  assert.equal(decodeFields(got.get(`users/${a.uid}/notes/n2`).fields).text, 'note n2');
  assert.equal(got.get(`/users/${a.uid}/notes/n2`).path, `users/${a.uid}/notes/n2`);
  assert.equal(got.has(`users/${a.uid}/notes/n3`), false);
  assert.equal((await a.firestore.batchGet([])).size, 0);
});

test('firestore: query() gives the documents and the read time, even with no results', async () => {
  const a = await account();
  let res = await a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] });
  assert.deepEqual(res.docs, []);
  assert.match(res.readTime, /Z$/);
  await push(a, ['n2', 'n1']);
  res = await a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] });
  assert.deepEqual(ids(res.docs), ['n1', 'n2']);
  assert.equal(res.docs[0].name, docName(a, 'notes/n1'));
  assert.equal(res.docs[0].updateTime, a.headTime);
  // A streamed method fails as an array: the error is still read.
  const b = await account('bob@example.com');
  await rejects(b.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] }), {
    code: 'PERMISSION', status: 403, detail: 'PERMISSION_DENIED', service: 'firestore',
  });
});

test('firestore: queryAll() pages the pull query with startAt on its orderBy values (spec 5.6)', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  await sevenNotes(a);
  const queries = () => rec.requests.filter((r) => r.url.endsWith(':runQuery')).map((r) => JSON.parse(r.body).structuredQuery);
  const cursor = (rev, id) => ({ values: [{ integerValue: String(rev) }, { referenceValue: docName(a, `notes/${id}`) }], before: false });

  rec.requests.length = 0;
  let docs = await all(a.firestore.queryAll(`users/${a.uid}`, pull(1, 4), { pageSize: 3 }));
  assert.deepEqual(ids(docs), ['n1', 'n3', 'n6', 'n2', 'n7', 'n4', 'n5']);
  let sent = queries();
  assert.deepEqual(sent.map((q) => q.limit), [3, 3, 3]);
  assert.deepEqual(sent[0].orderBy, BY_REV);
  assert.deepEqual(sent[0].where, pull(1, 4).where);
  assert.deepEqual(sent.map((q) => q.startAt), [undefined, cursor(2, 'n6'), cursor(4, 'n4')]);

  rec.requests.length = 0;
  docs = await all(a.firestore.queryAll(`users/${a.uid}`, pull(2, 4), { pageSize: 2 }));
  assert.deepEqual(ids(docs), ['n2', 'n7', 'n4', 'n5']);
  sent = queries();
  assert.deepEqual(sent.map((q) => q.startAt), [undefined, cursor(3, 'n7'), cursor(4, 'n5')]); // the last page is empty

  rec.requests.length = 0;
  docs = await all(a.firestore.queryAll(`users/${a.uid}`, pull(1, 4)));
  assert.equal(docs.length, 7);
  assert.deepEqual(queries().map((q) => q.limit), [300]);
});

test('firestore: queryAll() pages a projection, names only, a descending order and an implicit order', async () => {
  const a = await account();
  await sevenNotes(a);
  const parent = `users/${a.uid}`;
  const everyNote = { from: [{ collectionId: 'notes' }] };

  // The cursor's fields are added to a projection, or its pages couldn't continue.
  let docs = await all(a.firestore.queryAll(parent, { ...pull(1, 4), select: { fields: [{ fieldPath: 'text' }] } }, { pageSize: 2 }));
  assert.deepEqual(ids(docs), ['n1', 'n3', 'n6', 'n2', 'n7', 'n4', 'n5']);
  assert.deepEqual(Object.keys(docs[0].fields).sort(), ['_sync', 'text']);
  assert.deepEqual(Object.keys(docs[0].fields._sync.mapValue.fields), ['rev']);

  // Names only, as account deletion reads them (spec 5.15).
  docs = await all(a.firestore.queryAll(parent, { ...everyNote, select: { fields: [{ fieldPath: '__name__' }] } }, { pageSize: 3 }));
  assert.deepEqual(ids(docs), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
  assert.ok(docs.every((d) => Object.keys(d.fields).length === 0));

  const desc = { ...everyNote, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'DESCENDING' }] };
  assert.deepEqual(ids(await all(a.firestore.queryAll(parent, desc, { pageSize: 3 }))), ['n7', 'n6', 'n5', 'n4', 'n3', 'n2', 'n1']);

  // No orderBy: Firestore orders by the inequality field, then __name__; the pages follow that order.
  const above2 = { ...everyNote, where: { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'GREATER_THAN', value: toValue(2) } } };
  assert.deepEqual(ids(await all(a.firestore.queryAll(parent, above2, { pageSize: 3 }))), ['n2', 'n7', 'n4', 'n5']);
});

test('firestore: a server that ignores startAt stops queryAll() instead of looping', async () => {
  let queries = 0;
  const noCursor = async (url, init) => {
    if (!String(url).endsWith(':runQuery')) return fetch(url, init);
    if (++queries > 5) throw new Error('queryAll() is looping'); // fail fast rather than hang
    const body = JSON.parse(init.body);
    delete body.structuredQuery.startAt;
    return fetch(url, { ...init, body: JSON.stringify(body) });
  };
  const a = await account('alice@example.com', { fetchImpl: noCursor });
  await push(a, ['n1', 'n2', 'n3']);
  const seen = [];
  const read = async () => {
    for await (const doc of a.firestore.queryAll(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] }, { pageSize: 2 })) seen.push(doc);
  };
  await rejects(read(), { code: 'SERVER', retryable: true, service: 'firestore' });
  assert.deepEqual(ids(seen), ['n1', 'n2'], 'each document once');
});

test('firestore: runQuery and batchGet answers parse as a JSON array, NDJSON or objects back to back', async () => {
  const tricky = 'braces } { ] [ and "quotes" \\ and a \\" too';
  for (const style of ['array', 'pretty', 'ndjson', 'concatenated', 'commas']) {
    mock.reset();
    const a = await account('alice@example.com', { fetchImpl: reframed(style) });
    await push(a, ['n1', 'n2', 'n3'], { n2: { text: tricky } });
    const docs = await all(a.firestore.queryAll(`users/${a.uid}`, pull(1, 2), { pageSize: 2 }));
    assert.deepEqual(ids(docs), ['n1', 'n2', 'n3'], style);
    assert.equal(decodeFields(docs[1].fields).text, tricky, style);
    const empty = await a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'projects' }] });
    assert.deepEqual(empty.docs, [], style);
    assert.match(empty.readTime, /Z$/, style);
    const got = await a.firestore.batchGet([`users/${a.uid}/notes/n2`, `users/${a.uid}/notes/zz`, `users/${a.uid}`]);
    assert.deepEqual([...got.values()].map((d) => d?.path ?? null), [`users/${a.uid}/notes/n2`, null, `users/${a.uid}`], style);
  }
});

test('firestore: a stream cut short is SERVER, and an error inside a stream keeps its code', async () => {
  let mode = null;
  const cut = async (url, init) => {
    const res = await fetch(url, init);
    if (!mode || !isStream(url)) return res;
    const text = await res.text();
    const error = (code, status) => JSON.stringify({ error: { code, message: 'Stream failed.', status } });
    const out = {
      bracket: text.slice(0, -1),
      half: text.slice(0, text.length >> 1),
      unavailable: `${text.slice(0, -1)},${error(503, 'UNAVAILABLE')}]`,
      denied: `${text.slice(0, -1)},${error(403, 'PERMISSION_DENIED')}]`,
    }[mode];
    return answer(res, out);
  };
  const a = await account('alice@example.com', { fetchImpl: cut });
  await push(a, ['n1', 'n2']);
  const query = () => a.firestore.query(`users/${a.uid}`, { from: [{ collectionId: 'notes' }] });
  for (const m of ['bracket', 'half']) {
    mode = m;
    await rejects(query(), { code: 'SERVER', retryable: true, status: 200, service: 'firestore' });
    await rejects(a.firestore.batchGet([`users/${a.uid}/notes/n1`]), { code: 'SERVER', retryable: true });
  }
  mode = 'unavailable';
  await rejects(query(), { code: 'SERVER', retryable: true, status: 503, detail: 'UNAVAILABLE' });
  mode = 'denied';
  await rejects(query(), { code: 'PERMISSION', status: 403, detail: 'PERMISSION_DENIED' });
  mode = null;
  assert.deepEqual(ids((await query()).docs), ['n1', 'n2']);
});

test('parseStream(): a JSON array, NDJSON and objects back to back; a cut-off stream throws', () => {
  assert.deepEqual(parseStream(''), []);
  assert.deepEqual(parseStream(' [ ] '), []);
  assert.deepEqual(parseStream('[{"a":1},{"b":"}{"}]'), [{ a: 1 }, { b: '}{' }]);
  assert.deepEqual(parseStream('[{"a":1}\n,{"b":2}\n]'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseStream('{"a":1}\n{"b":"\\"]"}\n'), [{ a: 1 }, { b: '"]' }]);
  assert.deepEqual(parseStream('{"a":{"b":[1,{"c":"\\\\"}]}}{"d":3}'), [{ a: { b: [1, { c: '\\' }] } }, { d: 3 }]);
  assert.deepEqual(parseStream('{"a":1},\r\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseStream('{"only":true}'), [{ only: true }]);
  for (const bad of ['[{"a":1}', '[{"a":1},', '{"a":1', '{"a":"}', '{"a":1}{"b":', '[{"a":1}]]', 'x', '{"a":1} x', '{"a":1}"b"']) {
    assert.throws(() => parseStream(bad), SyntaxError, bad);
  }
});

test('codec output survives a commit and a read unchanged', async () => {
  const a = await account();
  const nest = (n) => (n ? { k: nest(n - 1) } : 'leaf');
  const note = {
    text: 'Review the fire spread model …', images: [{ id: hex32('img'), w: 3024, h: 1964, futureImageField: [1, 'x'] }],
    createdAt: 1758690000000, updatedAt: 1758693600000, usedAt: 0, copied: 5, lastCopiedAt: 1758700000000, highlight: 'amber',
    ratio: 0.25, big: 2 ** 53, negative: -12, empty: '', none: null, flags: [true, false], emptyMap: {}, emptyList: [],
    futureNoteField: { nested: true, 'a.b': 1, 'sp ace': 'ok', 'ünï': 'ü' },
    nested: [[1, 2], [3]], lone: 'x\uD800y', _private: { a: 1 }, __weird__: true, '': 'empty key', deep: nest(25),
  };
  const { fields, jsonKeys } = encodeFields(note);
  assert.deepEqual(jsonKeys.sort(), ['', '__weird__', '_private', 'deep', 'lone', 'nested']);
  fields._sync = toValue({ rev: 2, key: 'V', deleted: false, by: DEVICE, project: 'p1', list: 'notes' });
  await a.firestore.commit([headBump(a, 2), { update: { name: docName(a, 'notes/n1'), fields }, updateTransforms: requestTime('_sync.at') }]);
  const doc = await a.firestore.get(`users/${a.uid}/notes/n1`);
  assert.deepEqual(decodeFields(doc.fields), note);
  assert.match(doc.fields._sync.mapValue.fields.at.timestampValue, /Z$/);
});

test('account deletion with the clients: names by queryAll, deletes in commits of 10, then the head and the sign-in', async () => {
  const a = await account();
  const notes = Array.from({ length: 23 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  await push(a, notes);
  const pic = picture(a, 'p');
  await a.storage.upload(pic, crypto.randomBytes(100));

  a.headTime = (await a.firestore.commit([startDeletion(a)])).writeResults[0].updateTime;
  await rejects(push(a, ['late']), { code: 'PERMISSION', status: 403 }); // the precondition holds; the rules refuse
  await rejects(a.storage.upload(picture(a, 'late'), crypto.randomBytes(100)), { code: 'PERMISSION' });

  const names = await all(a.storage.list(`users/${a.uid}/images/`));
  assert.deepEqual(names, [pic]);
  assert.equal(await a.storage.remove(pic), true);
  assert.equal(await a.storage.remove(pic), false);

  const namesOnly = { from: [{ collectionId: 'notes' }], select: { fields: [{ fieldPath: '__name__' }] } };
  const docs = await all(a.firestore.queryAll(`users/${a.uid}`, namesOnly, { pageSize: 10 }));
  assert.equal(docs.length, 23);
  for (let i = 0; i < docs.length; i += 10) {
    const res = await a.firestore.commit(docs.slice(i, i + 10).map((d) => ({ delete: d.name })));
    assert.ok(res.writeResults.every((r) => r.updateTime === null));
  }
  await a.firestore.commit([{ delete: docName(a) }]);
  await a.auth.deleteAccount(a.session.idToken);
  const left = mock.docs(a.uid);
  assert.deepEqual([left.head, left.notes, mock.objects(a.uid), mock.user(a.email)], [null, {}, {}, null]);
});

// ---- Storage

test('storage: up to 256 KiB is one multipart request with Authorization: Firebase <ID token>', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  for (const size of [1, 100 * KiB, 256 * KiB]) {
    const path = picture(a, size);
    const bytes = crypto.randomBytes(size);
    const from = mock.log.length;
    rec.requests.length = 0;
    assert.deepEqual(await a.storage.upload(path, bytes), { size, md5Hash: md5(bytes), existed: false });
    assert.deepEqual(since(from), ['upload 200'], String(size));
    assert.equal(mock.log.at(-1).protocol, 'multipart');
    const stored = mock.objects(a.uid)[path];
    assert.ok(stored.bytes.equals(bytes));
    assert.equal(stored.contentType, 'image/png');
    const [req] = rec.requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.get('authorization'), `Firebase ${a.session.idToken}`);
    assert.equal(req.headers.get('x-goog-upload-protocol'), 'multipart');
    assert.match(req.headers.get('content-type'), /^multipart\/related; boundary=\S+$/);
    assert.equal(new URL(req.url).searchParams.get('name'), path);
  }
  // A view into a larger buffer uploads only its own bytes.
  const whole = crypto.randomBytes(3000);
  const view = new Uint8Array(whole.buffer, whole.byteOffset + 1000, 1000);
  const res = await a.storage.upload(picture(a, 'view'), view);
  assert.deepEqual(res, { size: 1000, md5Hash: md5(whole.subarray(1000, 2000)), existed: false });
  assert.ok(mock.objects(a.uid)[picture(a, 'view')].bytes.equals(whole.subarray(1000, 2000)));
});

test('storage: above 256 KiB the upload is resumable, in 2 MiB chunks', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  const path = picture(a, 'big');
  const bytes = crypto.randomBytes(5 * MiB + 123);
  let from = mock.log.length;
  rec.requests.length = 0;
  assert.deepEqual(await a.storage.upload(path, bytes), { size: bytes.length, md5Hash: md5(bytes), existed: false });
  assert.deepEqual(mock.log.slice(from).map((e) => [e.op, e.command ?? null, e.status]), [
    ['upload-start', null, 200],
    ['upload-chunk', 'upload', 200],
    ['upload-chunk', 'upload', 200],
    ['upload-chunk', 'upload, finalize', 200],
  ]);
  const [start, ...chunks] = rec.requests;
  assert.equal(new URL(start.url).searchParams.get('name'), path);
  const startHeaders = ['authorization', 'x-goog-upload-protocol', 'x-goog-upload-command', 'x-goog-upload-header-content-length',
    'x-goog-upload-header-content-type'];
  assert.deepEqual(startHeaders.map((h) => start.headers.get(h)), [`Firebase ${a.session.idToken}`, 'resumable', 'start', String(bytes.length), 'image/png']);
  assert.deepEqual(JSON.parse(start.body), { name: path, contentType: 'image/png' });
  assert.deepEqual(chunks.map((r) => [r.headers.get('x-goog-upload-offset'), r.body.length, r.headers.get('authorization')]), [
    ['0', 2 * MiB, `Firebase ${a.session.idToken}`],
    [String(2 * MiB), 2 * MiB, `Firebase ${a.session.idToken}`],
    [String(4 * MiB), MiB + 123, `Firebase ${a.session.idToken}`],
  ]);
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));

  // One byte over 256 KiB is already resumable: a single chunk that uploads and finalizes.
  const edge = crypto.randomBytes(256 * KiB + 1);
  from = mock.log.length;
  assert.deepEqual(await a.storage.upload(picture(a, 'edge'), edge), { size: edge.length, md5Hash: md5(edge), existed: false });
  assert.deepEqual(mock.log.slice(from).map((e) => [e.op, e.command ?? null]), [['upload-start', null], ['upload-chunk', 'upload, finalize']]);
});

test('storage: after a dropped chunk the upload asks where the server stopped and resumes there', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  const path = picture(a, 'dropped');
  const bytes = crypto.randomBytes(3 * MiB + 7);
  mock.fail({ service: 'storage', op: 'upload-chunk', status: 'offline' }); // the server keeps 1 MiB of the first 2
  const from = mock.log.length;
  rec.requests.length = 0;
  assert.deepEqual(await a.storage.upload(path, bytes), { size: bytes.length, md5Hash: md5(bytes), existed: false });
  assert.deepEqual(since(from), ['upload-start 200', 'upload-chunk offline', 'upload-query 200', 'upload-chunk 200', 'upload-chunk 200']);
  assert.deepEqual(rec.requests.map((r) => [r.headers.get('x-goog-upload-command'), r.headers.get('x-goog-upload-offset')]), [
    ['start', null], ['upload', '0'], ['query', null], ['upload', String(MiB)], ['upload, finalize', String(3 * MiB)],
  ]);
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));

  // A refused chunk (503) kept nothing: the query says so, and the same chunk goes again.
  mock.fail({ service: 'storage', op: 'upload-chunk', status: 503, skip: 1 });
  const again = crypto.randomBytes(3 * MiB);
  let next = mock.log.length;
  assert.equal((await a.storage.upload(picture(a, 'refused'), again)).md5Hash, md5(again));
  assert.deepEqual(since(next), ['upload-start 200', 'upload-chunk 200', 'upload-chunk 503', 'upload-query 200', 'upload-chunk 200']);
  assert.ok(mock.objects(a.uid)[picture(a, 'refused')].bytes.equals(again));

  // The connection is still down when the query goes out: the query is asked again, within the same budget.
  mock.fail({ service: 'storage', status: 'offline', times: 2, skip: 1 });
  const third = crypto.randomBytes(3 * MiB);
  next = mock.log.length;
  assert.equal((await a.storage.upload(picture(a, 'still down'), third)).md5Hash, md5(third));
  assert.deepEqual(since(next), ['upload-start 200', 'upload-chunk offline', 'upload-query offline', 'upload-query 200', 'upload-chunk 200']);
  assert.ok(mock.objects(a.uid)[picture(a, 'still down')].bytes.equals(third));
});

test('storage: a session the server cancelled is not asked again', async () => {
  // The account starts being deleted during the upload: the finalize is refused, and that answer is lost.
  const a = await account('alice@example.com', {
    fetchImpl: (url, init) => {
      if (new Headers(init.headers).get('x-goog-upload-command') === 'upload, finalize') {
        mock.writeDoc(`users/${a.uid}`, { ...mock.docs(a.uid).head, deleting: true });
      }
      return fetch(url, init);
    },
  });
  mock.fail({ service: 'storage', op: 'upload-chunk', status: 'offline', lost: true });
  const from = mock.log.length;
  await rejects(a.storage.upload(picture(a, 'cancelled'), crypto.randomBytes(300 * KiB)), { code: 'SERVER', retryable: false, service: 'storage' });
  assert.deepEqual(since(from), ['upload-start 200', 'upload-chunk offline', 'upload-query 200']);
  assert.deepEqual(mock.objects(a.uid), {});
});

test('storage: when the answer to the last chunk is lost, the query finds the upload final', async () => {
  const a = await account();
  const path = picture(a, 'lost');
  const bytes = crypto.randomBytes(300 * KiB);
  mock.fail({ service: 'storage', op: (e) => e.op === 'upload-chunk' && /finalize/.test(e.command), status: 'offline', lost: true });
  const from = mock.log.length;
  assert.deepEqual(await a.storage.upload(path, bytes), { size: bytes.length, md5Hash: md5(bytes), existed: false });
  assert.deepEqual(since(from), ['upload-start 200', 'upload-chunk offline', 'upload-query 200', 'metadata 200']);
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));
});

test('storage: a resumable upload gives up after 3 failures in a row without progress', async () => {
  const a = await account();
  // Failures with progress in between don't add up: every chunk drops once, keeping 1 MiB of the 2 sent.
  const flaky = crypto.randomBytes(5 * MiB);
  mock.fail({ service: 'storage', op: 'upload-chunk', status: 'offline', times: 4 });
  let from = mock.log.length;
  assert.deepEqual(await a.storage.upload(picture(a, 'flaky'), flaky), { size: flaky.length, md5Hash: md5(flaky), existed: false });
  assert.deepEqual(since(from), ['upload-start 200', ...Array(4).fill(['upload-chunk offline', 'upload-query 200']).flat(), 'upload-chunk 200']);
  assert.ok(mock.objects(a.uid)[picture(a, 'flaky')].bytes.equals(flaky));

  mock.fail({ service: 'storage', op: 'upload-chunk', status: 503, times: Infinity });
  from = mock.log.length;
  await rejects(a.storage.upload(picture(a, 'never'), crypto.randomBytes(300 * KiB)), { code: 'SERVER', status: 503, retryable: true, service: 'storage' });
  assert.deepEqual(since(from), [
    'upload-start 200', 'upload-chunk 503', 'upload-query 200', 'upload-chunk 503', 'upload-query 200',
    'upload-chunk 503', 'upload-query 200', 'upload-chunk 503',
  ]);
  assert.deepEqual(Object.keys(mock.objects(a.uid)), [picture(a, 'flaky')]);
});

test('storage: an upload session on another origin is refused, so the ID token never leaves the storage host', async () => {
  const rec = recorder(async (url, init) => {
    const res = await fetch(url, init);
    const session = res.headers.get('x-goog-upload-url');
    if (!session) return res;
    const headers = new Headers(res.headers);
    headers.set('x-goog-upload-url', session.replace('//127.0.0.1:', '//localhost:'));
    return new Response(await res.arrayBuffer(), { status: res.status, headers });
  });
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  rec.requests.length = 0;
  await rejects(a.storage.upload(picture(a, 'elsewhere'), crypto.randomBytes(300 * KiB)), { code: 'SERVER', retryable: false, service: 'storage' });
  assert.deepEqual(rec.requests.map((r) => [new URL(r.url).host, r.headers.get('x-goog-upload-command')]), [[new URL(mock.base).host, 'start']]);
});

test('storage: an answer describing other bytes than were sent is an error, never a success', async () => {
  // Pictures are immutable, so a bad copy could never be replaced: it must not pass as uploaded.
  let change = null;
  const a = await account('alice@example.com', {
    fetchImpl: async (url, init) => {
      const res = await fetch(url, init);
      const text = change && init.method === 'POST' && url.includes('/firebasestorage.') ? await res.text() : '';
      if (!text) return res.bodyUsed ? answer(res, text) : res;
      return answer(res, JSON.stringify({ ...JSON.parse(text), ...change }));
    },
  });
  for (const size of [100 * KiB, 300 * KiB]) { // multipart, then resumable
    for (const wrong of [{ md5Hash: md5(Buffer.from('other bytes')) }, { size: String(size - 1) }]) {
      change = wrong;
      const upload = a.storage.upload(picture(a, `${size}${Object.keys(wrong)}`), crypto.randomBytes(size));
      await rejects(upload, { code: 'SERVER', retryable: false, service: 'storage' });
    }
  }
});

test('storage: a 401 partway through a resumable upload refreshes the token and sends the same chunk again', async () => {
  let uploads = 0;
  const rec = recorder((url, init) => {
    if (new Headers(init.headers).get('x-goog-upload-command') === 'upload' && ++uploads === 2) mock.expireIdTokens();
    return fetch(url, init);
  });
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  const path = picture(a, 'expiring');
  const bytes = crypto.randomBytes(5 * MiB);
  const from = mock.log.length;
  rec.requests.length = 0;
  assert.deepEqual(await a.storage.upload(path, bytes), { size: bytes.length, md5Hash: md5(bytes), existed: false });
  assert.deepEqual(since(from), ['upload-start 200', 'upload-chunk 200', 'upload-chunk 401', 'token 200', 'upload-chunk 200', 'upload-chunk 200']);
  const chunks = rec.requests.filter((r) => r.headers.get('x-goog-upload-offset') !== null);
  assert.deepEqual(chunks.map((r) => r.headers.get('x-goog-upload-offset')), ['0', String(2 * MiB), String(2 * MiB), String(4 * MiB)]);
  assert.equal(chunks[3].headers.get('authorization'), `Firebase ${a.session.idToken}`); // the new token
  assert.notEqual(chunks[1].headers.get('authorization'), chunks[2].headers.get('authorization'));
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));
});

test('storage: an upload to a name that holds a picture is refused, and one stat says what the account has: these bytes, or other bytes that stay', async () => {
  // Pictures never change: the rules refuse an upload over a stored file (a create with resource set, 4.9).
  const a = await account();
  const small = crypto.randomBytes(10 * KiB);
  const big = crypto.randomBytes(700 * KiB);
  const p1 = picture(a, 1);
  const p2 = picture(a, 2);
  await a.storage.upload(p1, small);
  await a.storage.upload(p2, big);
  const stored = () => Object.fromEntries(Object.entries(mock.objects(a.uid)).map(([k, o]) => [k, [o.md5Hash, o.generation]]));
  const before = stored();

  // The same bytes (a lost answer, an upload a restart didn't record): existed. A resumable one is refused at
  // its start, so not a byte goes up again.
  let from = mock.log.length;
  assert.deepEqual(await a.storage.upload(p1, small), { size: small.length, md5Hash: md5(small), existed: true });
  assert.deepEqual(since(from), ['upload 403', 'metadata 200']);
  from = mock.log.length;
  assert.deepEqual(await a.storage.upload(p2, big), { size: big.length, md5Hash: md5(big), existed: true });
  assert.deepEqual(since(from), ['upload-start 403', 'metadata 200']);

  // Other bytes (another computer's thumbnail of the same picture): the account's copy stays, and the answer
  // describes it, from the same single stat.
  for (const [path, mine, theirs] of [[p1, crypto.randomBytes(10 * KiB), small], [p1, crypto.randomBytes(300 * KiB), small], [p2, crypto.randomBytes(KiB), big]]) {
    from = mock.log.length;
    assert.deepEqual(await a.storage.upload(path, mine), { size: theirs.length, md5Hash: md5(theirs), existed: true, differs: true });
    assert.deepEqual(since(from), [mine.length > 256 * KiB ? 'upload-start 403' : 'upload 403', 'metadata 200']);
  }
  assert.deepEqual(stored(), before, 'nothing was replaced');

  // No object behind the refusal: PERMISSION, as before.
  await rejects(a.storage.upload(`users/${a.uid}/images/not-a-picture.png`, small), { code: 'PERMISSION', status: 403, service: 'storage' });
  await rejects(a.storage.upload(picture(a, 3), small, 'image/jpeg'), { code: 'PERMISSION' });
  // When the stat is refused too, the upload's own refusal is what comes back.
  const undo = mock.denyDoc(p1);
  from = mock.log.length;
  await rejects(a.storage.upload(p1, small), { code: 'PERMISSION', status: 403 });
  assert.deepEqual(since(from), ['upload 403', 'metadata 403']);
  undo();
  // A stat that can't answer says so: whether the picture is there is unknown, which is no refusal.
  mock.fail({ service: 'storage', op: 'metadata', status: 'offline' });
  await rejects(a.storage.upload(p1, small), { code: 'NETWORK', retryable: true });
  mock.fail({ service: 'storage', op: 'metadata', status: 503 });
  await rejects(a.storage.upload(p1, small), { code: 'SERVER', status: 503, retryable: true });
  assert.deepEqual(stored(), before);
});

test('storage: a name that gets its picture while a resumable upload is on its way: the finalize is refused, and one stat tells what is there', async () => {
  let seed = null; // what another computer stores under the name just before this upload's last chunk
  const a = await account('alice@example.com', {
    fetchImpl: (url, init) => {
      if (seed && new Headers(init.headers).get('x-goog-upload-command') === 'upload, finalize') {
        mock.writeObject(seed.path, seed.bytes);
        seed = null;
      }
      return fetch(url, init);
    },
  });
  for (const same of [true, false]) {
    const path = picture(a, `race ${same}`);
    const bytes = crypto.randomBytes(300 * KiB);
    const theirs = same ? bytes : crypto.randomBytes(200 * KiB);
    seed = { path, bytes: theirs };
    const from = mock.log.length;
    const res = await a.storage.upload(path, bytes);
    assert.deepEqual(res, { size: theirs.length, md5Hash: md5(theirs), existed: true, ...(same ? {} : { differs: true }) });
    assert.deepEqual(since(from), ['upload-start 200', 'upload-chunk 403', 'metadata 200']);
    assert.ok(mock.objects(a.uid)[path].bytes.equals(theirs), 'the stored picture stays');
  }
});

test('storage: a multipart upload whose answer was lost is refused when sent again, and counts as existed', async () => {
  const a = await account();
  const path = picture(a, 'lost answer');
  const bytes = crypto.randomBytes(50 * KiB);
  mock.fail({ service: 'storage', op: 'upload', status: 'offline', lost: true });
  await rejects(a.storage.upload(path, bytes), { code: 'NETWORK', retryable: true });
  const generation = mock.objects(a.uid)[path].generation; // it landed
  const from = mock.log.length;
  assert.deepEqual(await a.storage.upload(path, bytes), { size: bytes.length, md5Hash: md5(bytes), existed: true });
  assert.deepEqual(since(from), ['upload 403', 'metadata 200']);
  assert.equal(mock.objects(a.uid)[path].generation, generation, 'stored once');
});

test('storage: download, stat, list and remove', async () => {
  const a = await account();
  const pic = picture(a, 'x');
  const bytes = crypto.randomBytes(1000);
  await a.storage.upload(pic, bytes);
  assert.ok((await a.storage.download(pic)).equals(bytes));
  assert.deepEqual(await a.storage.stat(pic), { size: 1000, md5Hash: md5(bytes), contentType: 'image/png' });
  assert.equal(await a.storage.download(picture(a, 'missing')), null);
  assert.equal(await a.storage.stat(picture(a, 'missing')), null);
  const b = await account('bob@example.com');
  await rejects(b.storage.download(pic), { code: 'PERMISSION', status: 403 });
  await rejects(b.storage.stat(pic), { code: 'PERMISSION', status: 403 });
  mock.fail({ service: 'storage', op: 'download', status: 503 });
  await rejects(a.storage.download(pic), { code: 'SERVER', retryable: true });

  // 1,003 pictures come in two pages; a deeper folder is a prefix, not an item.
  for (let i = 0; i < 1002; i++) mock.writeObject(picture(a, `seed${i}`), Buffer.from([i & 255]));
  mock.writeObject(`users/${a.uid}/images/sub/${hex32('sub')}.png`, Buffer.from('x'));
  const from = mock.log.length;
  const names = await all(a.storage.list(`users/${a.uid}/images/`));
  assert.deepEqual(since(from), ['list 200', 'list 200']);
  assert.equal(names.length, 1003);
  assert.deepEqual(names, Object.keys(mock.objects(a.uid)).filter((n) => !n.includes('/sub/')).sort());
  assert.deepEqual(await all(b.storage.list(`users/${b.uid}/images/`)), []);

  // Pictures are removed only while the account is being deleted: then true, and false once gone.
  await rejects(a.storage.remove(pic), { code: 'PERMISSION', status: 403 });
  await a.firestore.commit([startDeletion(a)]);
  assert.equal(await a.storage.remove(pic), true);
  assert.equal(await a.storage.remove(pic), false);
  assert.equal(await a.storage.download(pic), null);
});

test('Storage always gets the Firebase scheme, Firestore Bearer; no token ever goes in a URL', async () => {
  const rec = recorder();
  const a = await account('alice@example.com', { fetchImpl: rec.fetchImpl });
  await push(a, ['n1']);
  const pic = picture(a, 'x');
  await a.storage.upload(pic, crypto.randomBytes(1000));
  await a.storage.upload(picture(a, 'y'), crypto.randomBytes(300 * KiB));
  await a.storage.download(pic);
  await a.storage.stat(pic);
  await all(a.storage.list(`users/${a.uid}/images/`));
  await a.firestore.get(`users/${a.uid}`);
  await a.firestore.batchGet([`users/${a.uid}/notes/n1`]);
  await all(a.firestore.queryAll(`users/${a.uid}`, pull(0, 2)));
  const schemes = {};
  for (const e of mock.log) schemes[e.service] = [...new Set([...(schemes[e.service] || []), e.auth])];
  assert.deepEqual(schemes, { identity: [null], firestore: ['Bearer'], storage: ['Firebase'] });
  for (const r of rec.requests) {
    assert.ok(!r.url.includes(a.session.idToken) && !r.url.includes(a.session.refreshToken), r.url);
    const auth = r.headers.get('authorization');
    if (auth !== null) assert.equal(auth, `${r.url.includes('/firebasestorage.') ? 'Firebase' : 'Bearer'} ${a.session.idToken}`);
  }
});
