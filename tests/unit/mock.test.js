'use strict';
// The GCP mock (tests/mock-gcp, ai_memory/15 7.2) speaks the Google protocols the app's clients use. Checked
// here with raw requests over its 127.0.0.1 server, the way the real services are called: auth flows, token
// refresh and revocation, commit atomicity and preconditions, queries, batchGet, uploads, list, delete, and
// the control API.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGcpMock, MockError } = require('../mock-gcp');
const rules = require('../mock-gcp/rules');

const mock = createGcpMock();
test.before(() => mock.listen());
test.after(() => mock.close());
test.beforeEach(() => mock.reset());

const MiB = 1024 * 1024;
const DEVICE = `c0ffee${'0'.repeat(26)}`;
const ROOT = 'projects/demo-recaller/databases/(default)/documents';
const name = (path) => `${ROOT}/${path}`;
const identity = (method, key = 'mock-key') => `${mock.base}/identitytoolkit.googleapis.com/v1/accounts:${method}${key === null ? '' : `?key=${key}`}`;
const tokenUrl = () => `${mock.base}/securetoken.googleapis.com/v1/token?key=mock-key`;
const firestore = (rest) => `${mock.base}/firestore.googleapis.com/v1/${ROOT}${rest}`;
const storage = (rest) => `${mock.base}/firebasestorage.googleapis.com/v0/b/demo-recaller.test/o${rest}`;
const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('base64');
const claims = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));

async function send(target, { method = 'POST', json, body, headers = {}, fetchImpl = fetch } = {}) {
  const h = { ...headers };
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h['content-type'] = 'application/json';
  }
  const res = await fetchImpl(target, { method, headers: h, body: payload });
  const bytes = Buffer.from(await res.arrayBuffer());
  let data = null;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {}
  return { status: res.status, headers: res.headers, data, bytes };
}

const idCall = (method, json, key) => send(identity(method, key), { json });
const refresh = (refreshToken) => send(tokenUrl(), {
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const firebase = (token) => ({ authorization: `Firebase ${token}` });

// Typed values and the writes the app makes (ai_memory/15 4.2, 5.5)
const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });
const B = (v) => ({ booleanValue: v });
const M = (fields) => ({ mapValue: { fields } });

const commit = (token, writes) => send(firestore(':commit'), { json: { writes }, headers: bearer(token) });
const getDoc = (token, path) => send(firestore(`/${path}`), { method: 'GET', headers: bearer(token) });

const createHead = (uid) => ({
  update: {
    name: name(`users/${uid}`),
    fields: { schema: I(1), rev: I(1), minRev: I(0), deleting: B(false), board: M({ joiner: S('blank') }), stats: M({ projects: I(0), notes: I(0), images: I(0) }) },
  },
  updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: false },
});
const bumpHead = (uid, rev, updateTime, fields = {}) => ({
  update: { name: name(`users/${uid}`), fields: { rev: I(rev), lastDevice: S(DEVICE), ...fields } },
  updateMask: { fieldPaths: ['rev', 'lastDevice', ...Object.keys(fields)] },
  updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { updateTime },
});
const startDeletion = (uid) => ({
  update: { name: name(`users/${uid}`), fields: { deleting: B(true) } },
  updateMask: { fieldPaths: ['deleting'] },
  updateTransforms: [{ fieldPath: 'deletingAt', setToServerValue: 'REQUEST_TIME' }],
});
const noteWrite = (uid, id, rev, { text = `note ${id}`, key = 'V', list = 'notes', project = 'p1' } = {}) => ({
  update: {
    name: name(`users/${uid}/notes/${id}`),
    fields: { text: S(text), _sync: M({ rev: I(rev), key: S(key), deleted: B(false), by: S(DEVICE), project: S(project), list: S(list) }) },
  },
  updateTransforms: [{ fieldPath: '_sync.at', setToServerValue: 'REQUEST_TIME' }],
});

function verifiedUser(email = 'alice@example.com') {
  mock.createUser({ email, verified: true });
  return mock.signInAs(email);
}

// A verified account whose head is at rev 1.
async function account(email = 'alice@example.com') {
  const user = verifiedUser(email);
  const res = await commit(user.idToken, [createHead(user.uid)]);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { ...user, updateTime: res.data.writeResults[0].updateTime };
}

function upload(token, objectName, bytes, { contentType = 'image/png', scheme = 'Firebase' } = {}) {
  const boundary = 'mock-boundary-7f3e9c1a';
  const head = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: objectName, contentType })}`
    + `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  return send(storage(`?name=${encodeURIComponent(objectName)}`), {
    body: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--`)]),
    headers: { authorization: `${scheme} ${token}`, 'x-goog-upload-protocol': 'multipart', 'content-type': `multipart/related; boundary=${boundary}` },
  });
}

function startUpload(token, objectName, length, contentType = 'image/png') {
  return send(storage(`?name=${encodeURIComponent(objectName)}`), {
    json: { name: objectName, contentType },
    headers: {
      ...firebase(token), 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(length), 'x-goog-upload-header-content-type': contentType,
    },
  });
}

const chunk = (session, token, bytes, from, to, command) => send(session, {
  body: bytes.subarray(from, to), headers: { ...firebase(token), 'x-goog-upload-command': command, 'x-goog-upload-offset': String(from) },
});
const uploadStatus = (session, token) => send(session, { headers: { ...firebase(token), 'x-goog-upload-command': 'query' } });

// ---- transport

test('the mock listens on 127.0.0.1 and gives the suite its environment', () => {
  assert.deepEqual([mock.address.address, mock.address.family, mock.address.port], ['127.0.0.1', 'IPv4', mock.port]);
  assert.match(mock.base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(mock.env(), {
    RECALLER_GCP_BASE: mock.base, RECALLER_GCP_PROJECT: 'demo-recaller', RECALLER_GCP_BUCKET: 'demo-recaller.test', RECALLER_GCP_API_KEY: 'mock-key',
  });
});

test('unknown paths are 404, and logged like any request', async () => {
  assert.equal((await send(`${mock.base}/example.com/v1/x`, { method: 'GET' })).status, 404);
  assert.equal((await idCall('update', { idToken: 'x' })).status, 404);
  assert.deepEqual(mock.log.map((e) => [e.service, e.status]), [[null, 404], ['identity', 404]]);
});

// ---- Identity Toolkit and Secure Token

test('sign-up gives a JWT-shaped, unsigned ID token', async () => {
  const res = await idCall('signUp', { email: 'Alice@Example.com', password: 'long enough', returnSecureToken: true });
  assert.equal(res.status, 200);
  const { idToken, refreshToken, localId, expiresIn, email } = res.data;
  assert.equal(email, 'alice@example.com');
  assert.equal(expiresIn, '3600');
  assert.match(localId, /^[0-9A-Za-z]{28}$/);
  assert.ok(refreshToken);
  const parts = idToken.split('.');
  assert.equal(parts.length, 3);
  assert.equal(parts[2], '');
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')), { alg: 'none', typ: 'JWT' });
  const c = claims(idToken);
  assert.equal(c.user_id, localId);
  assert.equal(c.email_verified, false);
  assert.equal(c.exp - c.iat, 3600);
  assert.equal(mock.user('alice@example.com').uid, localId);
});

test('sign-up errors are Google-shaped, with the password policy and paused sign-ups', async () => {
  const rows = [
    [{ email: 'a@example.com', password: 'seven77' }, 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS'],
    [{ email: 'not-an-email', password: 'long enough' }, 'INVALID_EMAIL'],
    [{ email: 'a@example.com' }, 'MISSING_PASSWORD'],
    [{ password: 'long enough' }, 'MISSING_EMAIL'],
  ];
  for (const [body, code] of rows) {
    const res = await idCall('signUp', body);
    assert.equal(res.status, 400, code);
    assert.equal(res.data.error.code, 400);
    assert.match(res.data.error.message, new RegExp(`^${code}\\b`));
    assert.equal(res.data.error.errors[0].message, res.data.error.message);
  }
  assert.equal((await idCall('signUp', { email: 'a@example.com', password: 'long enough' })).status, 200);
  assert.equal((await idCall('signUp', { email: 'A@example.com', password: 'long enough' })).data.error.message, 'EMAIL_EXISTS');
  mock.setSignupDisabled(true);
  assert.equal((await idCall('signUp', { email: 'b@example.com', password: 'long enough' })).data.error.message, 'ADMIN_ONLY_OPERATION');
});

test('the API key is checked', async () => {
  const body = { email: 'a@example.com', password: 'long enough' };
  let res = await idCall('signUp', body, 'wrong-key');
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /API key not valid/);
  res = await idCall('signUp', body, null);
  assert.equal(res.status, 403);
  res = await send(tokenUrl().replace('mock-key', 'wrong-key'), { body: 'grant_type=refresh_token&refresh_token=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 400);
  assert.equal(mock.users().length, 0);
});

test('sign-in with enumeration protection, and a disabled user', async () => {
  mock.createUser({ email: 'alice@example.com', password: 'right password' });
  const wrong = await idCall('signInWithPassword', { email: 'alice@example.com', password: 'wrong password', returnSecureToken: true });
  const unknown = await idCall('signInWithPassword', { email: 'nobody@example.com', password: 'right password', returnSecureToken: true });
  for (const res of [wrong, unknown]) {
    assert.equal(res.status, 400);
    assert.equal(res.data.error.message, 'INVALID_LOGIN_CREDENTIALS');
  }
  const ok = await idCall('signInWithPassword', { email: 'Alice@example.com', password: 'right password', returnSecureToken: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.registered, true);
  assert.equal(claims(ok.data.idToken).user_id, ok.data.localId);
  mock.disableUser('alice@example.com');
  const off = await idCall('signInWithPassword', { email: 'alice@example.com', password: 'right password' });
  assert.match(off.data.error.message, /^USER_DISABLED\b/);
});

test('too many attempts', async () => {
  mock.createUser({ email: 'alice@example.com', password: 'right password' });
  mock.tooManyAttemptsAfter(2);
  const statuses = [];
  let last;
  for (let i = 0; i < 3; i++) {
    last = await idCall('signInWithPassword', { email: 'alice@example.com', password: 'right password' });
    statuses.push(last.status);
  }
  assert.deepEqual(statuses, [200, 200, 400]);
  assert.match(last.data.error.message, /^TOO_MANY_ATTEMPTS_TRY_LATER\b/);
  mock.tooManyAttemptsAfter(null);
  assert.equal((await idCall('signInWithPassword', { email: 'alice@example.com', password: 'right password' })).status, 200);
});

test('verification: the outbox, lookup, and email_verified only in a new token', async () => {
  const up = (await idCall('signUp', { email: 'alice@example.com', password: 'long enough', returnSecureToken: true })).data;
  const sent = await idCall('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: up.idToken });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.email, 'alice@example.com');
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email, m.uid]), [['VERIFY_EMAIL', 'alice@example.com', up.localId]]);
  let user = (await idCall('lookup', { idToken: up.idToken })).data.users[0];
  assert.equal(user.localId, up.localId);
  assert.equal(user.emailVerified, false);
  mock.verify('alice@example.com');
  user = (await idCall('lookup', { idToken: up.idToken })).data.users[0];
  assert.equal(user.emailVerified, true);
  assert.equal(claims(up.idToken).email_verified, false);
  const fresh = await refresh(up.refreshToken);
  assert.equal(fresh.status, 200);
  assert.equal(claims(fresh.data.id_token).email_verified, true);
  assert.equal((await idCall('lookup', { idToken: 'not a token' })).data.error.message, 'INVALID_ID_TOKEN');
});

test('password reset: a known email is sent, an unknown one is a silent success, reCAPTCHA when required', async () => {
  mock.createUser({ email: 'alice@example.com' });
  assert.equal((await idCall('sendOobCode', { requestType: 'PASSWORD_RESET', email: 'alice@example.com' })).status, 200);
  assert.equal((await idCall('sendOobCode', { requestType: 'PASSWORD_RESET', email: 'nobody@example.com' })).status, 200);
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['PASSWORD_RESET', 'alice@example.com']]);
  mock.requireRecaptchaForReset(true);
  const res = await idCall('sendOobCode', { requestType: 'PASSWORD_RESET', email: 'alice@example.com' });
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /RECAPTCHA/);
  assert.equal(mock.outbox.length, 1);
});

test('secure token: refresh rotates, then fails after revoke, disable and delete', async () => {
  mock.createUser({ email: 'alice@example.com', verified: true });
  const { uid, refreshToken } = mock.signInAs('alice@example.com');
  const res = await refresh(refreshToken);
  assert.equal(res.status, 200);
  assert.equal(res.data.user_id, uid);
  assert.equal(res.data.token_type, 'Bearer');
  assert.equal(res.data.expires_in, '3600');
  assert.notEqual(res.data.refresh_token, refreshToken);
  assert.equal(claims(res.data.id_token).user_id, uid);
  assert.equal((await send(tokenUrl(), { json: { grant_type: 'refresh_token', refresh_token: res.data.refresh_token } })).status, 200);
  const nonsense = await refresh('nonsense');
  assert.deepEqual(nonsense.data, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN', status: 'INVALID_ARGUMENT' } });
  mock.revokeTokens('alice@example.com');
  assert.equal((await refresh(res.data.refresh_token)).data.error.message, 'TOKEN_EXPIRED');
  assert.equal((await idCall('lookup', { idToken: res.data.id_token })).data.error.message, 'INVALID_ID_TOKEN');
  const again = mock.signInAs('alice@example.com');
  assert.equal((await refresh(again.refreshToken)).status, 200);
  mock.disableUser('alice@example.com');
  assert.equal((await refresh(again.refreshToken)).data.error.message, 'USER_DISABLED');
  mock.disableUser('alice@example.com', false);
  mock.deleteUser('alice@example.com');
  assert.equal((await refresh(again.refreshToken)).data.error.message, 'USER_NOT_FOUND');
});

test('accounts:delete needs a recent sign-in, and leaves the cloud data alone', async () => {
  mock.clock.set(Date.UTC(2026, 9, 1, 10));
  const a = await account();
  mock.clock.advance(6 * 60 * 1000);
  const stale = (await refresh(a.refreshToken)).data.id_token;
  assert.equal((await idCall('delete', { idToken: stale })).data.error.message, 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
  const fresh = (await idCall('signInWithPassword', { email: 'alice@example.com', password: 'password-1234' })).data.idToken;
  assert.equal((await idCall('delete', { idToken: fresh })).status, 200);
  assert.equal(mock.user('alice@example.com'), null);
  assert.match((await idCall('lookup', { idToken: fresh })).data.error.message, /^USER_NOT_FOUND/);
  assert.equal(mock.docs(a.uid).head.rev, 1);
  // Firestore checks only that an ID token is unexpired, as the real service does
  assert.equal((await getDoc(fresh, `users/${a.uid}`)).status, 200);
});

// ---- Firestore

test('Firestore takes only a current Bearer ID token', async () => {
  const a = await account();
  const head = `users/${a.uid}`;
  assert.equal((await send(firestore(`/${head}`), { method: 'GET' })).status, 401);
  assert.equal((await getDoc('not-a-token', head)).status, 401);
  assert.equal((await send(firestore(`/${head}`), { method: 'GET', headers: firebase(a.idToken) })).status, 401);
  assert.equal((await getDoc(a.idToken, head)).status, 200);
  mock.expireIdTokens();
  const expired = await getDoc(a.idToken, head);
  assert.equal(expired.status, 401);
  assert.equal(expired.data.error.status, 'UNAUTHENTICATED');
  const fresh = (await refresh(a.refreshToken)).data.id_token;
  assert.equal((await getDoc(fresh, head)).status, 200);
  mock.clock.advance(3600 * 1000);
  assert.equal((await getDoc(fresh, head)).status, 401);
});

test('the rules: unverified and other users are denied; the owner gets 404 for a missing head', async () => {
  mock.createUser({ email: 'alice@example.com' });
  const unverified = mock.signInAs('alice@example.com');
  const denied = await getDoc(unverified.idToken, `users/${unverified.uid}`);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.data, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } });
  mock.verify('alice@example.com');
  const verified = mock.signInAs('alice@example.com');
  const missing = await getDoc(verified.idToken, `users/${verified.uid}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.status, 'NOT_FOUND');
  const bob = verifiedUser('bob@example.com');
  assert.equal((await getDoc(bob.idToken, `users/${verified.uid}`)).status, 403);
});

test('commit: the head is created with REQUEST_TIME, and update times have microseconds', async () => {
  mock.clock.set(Date.UTC(2026, 9, 1, 10, 0, 0, 123));
  const a = verifiedUser();
  const res = await commit(a.idToken, [createHead(a.uid)]);
  assert.equal(res.status, 200);
  assert.equal(res.data.commitTime, '2026-10-01T10:00:00.123001Z');
  assert.equal(res.data.writeResults[0].updateTime, res.data.commitTime);
  const requestTime = { timestampValue: '2026-10-01T10:00:00.123Z' };
  assert.deepEqual(res.data.writeResults[0].transformResults, [requestTime, requestTime]);
  const head = await getDoc(a.idToken, `users/${a.uid}`);
  assert.equal(head.data.name, name(`users/${a.uid}`));
  assert.deepEqual(head.data.fields.createdAt, requestTime);
  assert.deepEqual(head.data.fields.rev, I(1));
  assert.equal(head.data.createTime, res.data.commitTime);
  assert.equal(head.data.updateTime, res.data.commitTime);
  const next = await commit(a.idToken, [bumpHead(a.uid, 2, head.data.updateTime)]);
  assert.equal(next.data.commitTime, '2026-10-01T10:00:00.123002Z'); // later, in the same millisecond
});

test('commit preconditions: exists and updateTime', async () => {
  const a = await account();
  let res = await commit(a.idToken, [createHead(a.uid)]);
  assert.equal(res.status, 409);
  assert.equal(res.data.error.status, 'ALREADY_EXISTS');
  res = await commit(a.idToken, [bumpHead(a.uid, 2, '2020-01-01T00:00:00.000001Z')]);
  assert.equal(res.status, 400);
  assert.equal(res.data.error.status, 'FAILED_PRECONDITION');
  const truncated = a.updateTime.replace(/(\.\d{3})\d{3}Z$/, '$1Z');
  assert.notEqual(truncated, a.updateTime);
  assert.equal((await commit(a.idToken, [bumpHead(a.uid, 2, truncated)])).data.error.status, 'FAILED_PRECONDITION');
  res = await commit(a.idToken, [{ ...noteWrite(a.uid, 'n1', 2), currentDocument: { updateTime: a.updateTime } }]);
  assert.equal(res.data.error.status, 'FAILED_PRECONDITION'); // no such document
  res = await commit(a.idToken, [{ ...noteWrite(a.uid, 'n1', 2), currentDocument: { exists: true } }]);
  assert.equal(res.status, 404);
  const nanos = a.updateTime.replace(/Z$/, '000Z'); // the same time, written with nanoseconds
  res = await commit(a.idToken, [bumpHead(a.uid, 2, nanos)]);
  assert.equal(res.status, 200);
  assert.equal(mock.docs(a.uid).head.rev, 2);
});

test('a commit is atomic: one refused write refuses them all', async () => {
  const a = await account();
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2), noteWrite(a.uid, 'n2', 2, { list: 'cooked' })]);
  assert.equal(res.status, 403);
  assert.equal(res.data.error.status, 'PERMISSION_DENIED');
  assert.equal(mock.docs(a.uid).head.rev, 1);
  assert.deepEqual(mock.docs(a.uid).notes, {});
  assert.equal((await commit(a.idToken, [bumpHead(a.uid, 3, a.updateTime)])).status, 403); // +2
  res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2), noteWrite(a.uid, 'n2', 2, { list: 'used' })]);
  assert.equal(res.status, 200);
  assert.equal(res.data.writeResults.length, 3);
  assert.deepEqual(Object.keys(mock.docs(a.uid).notes).sort(), ['n1', 'n2']);
  // an item's rev only moves forward
  res = await commit(a.idToken, [bumpHead(a.uid, 3, res.data.writeResults[0].updateTime), noteWrite(a.uid, 'n1', 2)]);
  assert.equal(res.status, 403);
});

test('an update mask replaces masked fields, deletes the ones the write lacks, and keeps the rest', async () => {
  const a = await account();
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime, { board: M({ joiner: S('line') }), privacy: M({ version: S('2026-10-01') }) })]);
  assert.equal(res.status, 200);
  let head = mock.docs(a.uid).head;
  assert.deepEqual(head.board, { joiner: 'line' });
  assert.equal(head.privacy.version, '2026-10-01');
  const write = bumpHead(a.uid, 3, res.data.writeResults[0].updateTime);
  write.updateMask.fieldPaths.push('privacy');
  res = await commit(a.idToken, [write]);
  assert.equal(res.status, 200);
  head = mock.docs(a.uid).head;
  assert.equal(head.privacy, undefined);
  assert.equal(head.rev, 3);
  assert.equal(head.schema, 1);
  assert.deepEqual(head.board, { joiner: 'line' });
  assert.match(head.createdAt, /Z$/);
});

test('documents come back typed, with empty maps and arrays as Google writes them', async () => {
  const a = await account();
  const write = noteWrite(a.uid, 'n1', 2);
  Object.assign(write.update.fields, { images: { arrayValue: {} }, meta: { mapValue: {} }, ratio: { doubleValue: 0.5 }, gone: { nullValue: null } });
  assert.equal((await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), write])).status, 200);
  const res = await getDoc(a.idToken, `users/${a.uid}/notes/n1`);
  assert.deepEqual(res.data.fields.images, { arrayValue: {} });
  assert.deepEqual(res.data.fields.meta, { mapValue: {} });
  assert.deepEqual(res.data.fields.ratio, { doubleValue: 0.5 });
  assert.deepEqual(res.data.fields.gone, { nullValue: null });
  assert.deepEqual(res.data.fields._sync.mapValue.fields.rev, I(2));
  assert.match(res.data.fields._sync.mapValue.fields.at.timestampValue, /^2\d{3}-.*Z$/);
});

test('bad values, bad names and oversized documents are INVALID_ARGUMENT', async () => {
  const a = await account();
  const withFields = (fields) => {
    const w = noteWrite(a.uid, 'n1', 2);
    Object.assign(w.update.fields, fields);
    return w;
  };
  for (const fields of [
    { __reserved__: S('x') },
    { '': S('x') },
    { nested: { arrayValue: { values: [{ arrayValue: { values: [] } }] } } },
    { lone: S('\ud800') },
    { two: { stringValue: 'a', integerValue: '1' } },
    { big: I('9223372036854775808') },
  ]) {
    const res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), withFields(fields)]);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal(res.data.error.status, 'INVALID_ARGUMENT');
  }
  const huge = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2, { text: 'x'.repeat(MiB) })]);
  assert.equal(huge.status, 400);
  assert.match(huge.data.error.message, /exceeds the maximum allowed size/);
  assert.equal(mock.docs(a.uid).head.rev, 1);
  const fits = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2, { text: 'x'.repeat(1000000) })]);
  assert.equal(fits.status, 200);
});

test('runQuery: rev range, orderBy with __name__, startAt paging, limit and select', async () => {
  const a = await account();
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), ...['n1', 'n2', 'n3', 'n4'].map((id) => noteWrite(a.uid, id, 2))]);
  res = await commit(a.idToken, [bumpHead(a.uid, 3, res.data.writeResults[0].updateTime), noteWrite(a.uid, 'n5', 3), noteWrite(a.uid, 'n2', 3, { text: 'changed' })]);
  assert.equal(res.status, 200);
  const range = (lo, hi) => ({
    compositeFilter: {
      op: 'AND',
      filters: [
        { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'GREATER_THAN', value: I(lo) } },
        { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'LESS_THAN_OR_EQUAL', value: I(hi) } },
      ],
    },
  });
  const orderBy = [{ field: { fieldPath: '_sync.rev' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
  const query = (structuredQuery, token = a.idToken) => send(firestore(`/users/${a.uid}:runQuery`), { json: { structuredQuery }, headers: bearer(token) });
  const ids = (r) => r.data.filter((x) => x.document).map((x) => x.document.name.split('/').pop());

  res = await query({ from: [{ collectionId: 'notes' }], where: range(1, 3), orderBy });
  assert.ok(Array.isArray(res.data));
  assert.deepEqual(ids(res), ['n1', 'n3', 'n4', 'n2', 'n5']);
  assert.ok(res.data.every((x) => typeof x.readTime === 'string'));
  assert.deepEqual(ids(await query({ from: [{ collectionId: 'notes' }], where: range(2, 3), orderBy })), ['n2', 'n5']);
  assert.deepEqual(ids(await query({ from: [{ collectionId: 'notes' }], where: range(1, 3) })), ['n1', 'n3', 'n4', 'n2', 'n5']); // implicit order

  const pages = [];
  let startAt;
  for (;;) {
    res = await query({ from: [{ collectionId: 'notes' }], where: range(1, 3), orderBy, limit: 2, ...(startAt ? { startAt } : {}) });
    const page = res.data.filter((x) => x.document).map((x) => x.document);
    pages.push(page.map((d) => d.name.split('/').pop()));
    if (page.length < 2) break;
    const last = page[page.length - 1];
    startAt = { values: [last.fields._sync.mapValue.fields.rev, { referenceValue: last.name }], before: false };
  }
  assert.deepEqual(pages, [['n1', 'n3'], ['n4', 'n2'], ['n5']]);

  res = await query({
    from: [{ collectionId: 'notes' }],
    where: { fieldFilter: { field: { fieldPath: '_sync.rev' }, op: 'EQUAL', value: I(3) } },
    select: { fields: [{ fieldPath: '_sync.rev' }] },
  });
  assert.deepEqual(ids(res), ['n2', 'n5']);
  assert.deepEqual(res.data[0].document.fields, { _sync: M({ rev: I(3) }) });
  res = await query({ from: [{ collectionId: 'notes' }], select: { fields: [{ fieldPath: '__name__' }] }, orderBy: [{ field: { fieldPath: '__name__' } }] });
  assert.deepEqual(ids(res), ['n1', 'n2', 'n3', 'n4', 'n5']);
  assert.equal(res.data[0].document.fields, undefined);
  res = await query({ from: [{ collectionId: 'notes' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit: 2 });
  assert.deepEqual(ids(res), ['n5', 'n4']);

  res = await query({ from: [{ collectionId: 'projects' }] });
  assert.equal(res.data.length, 1);
  assert.deepEqual(Object.keys(res.data[0]), ['readTime']);

  const bob = verifiedUser('bob@example.com');
  res = await query({ from: [{ collectionId: 'notes' }] }, bob.idToken);
  assert.equal(res.status, 403);
  assert.equal(res.data[0].error.status, 'PERMISSION_DENIED'); // a streamed method fails as an array
});

test('batchGet: found and missing, in the order asked', async () => {
  const a = await account();
  await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2)]);
  const documents = [name(`users/${a.uid}/notes/zz`), name(`users/${a.uid}/notes/n1`), name(`users/${a.uid}`)];
  const res = await send(firestore(':batchGet'), { json: { documents }, headers: bearer(a.idToken) });
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 3);
  assert.equal(res.data[0].missing, documents[0]);
  assert.deepEqual(res.data[1].found.fields.text, S('note n1'));
  assert.deepEqual(res.data[2].found.fields.rev, I(2));
  assert.ok(res.data.every((x) => typeof x.readTime === 'string'));
  const bob = verifiedUser('bob@example.com');
  assert.equal((await send(firestore(':batchGet'), { json: { documents }, headers: bearer(bob.idToken) })).status, 403);
});

test('access calls: hard deletes only while deleting, and at most 20 per commit', async () => {
  const a = await account();
  const notes = Array.from({ length: 25 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), ...notes.map((id) => noteWrite(a.uid, id, 2))]);
  assert.equal(res.status, 200);
  const hardDelete = (ids) => commit(a.idToken, ids.map((id) => ({ delete: name(`users/${a.uid}/notes/${id}`) })));
  assert.equal((await hardDelete(notes.slice(0, 1))).status, 403);
  assert.equal((await commit(a.idToken, [startDeletion(a.uid)])).status, 200);
  assert.equal((await hardDelete(notes.slice(0, 21))).status, 403);
  assert.equal(Object.keys(mock.docs(a.uid).notes).length, 25);
  res = await hardDelete(notes.slice(0, 20));
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.writeResults[0], {});
  assert.equal(Object.keys(mock.docs(a.uid).notes).length, 5);
});

test('a device write reads the head: allow-listed settings only, and refused while deleting', async () => {
  const a = await account();
  const device = {
    update: {
      name: name(`users/${a.uid}/devices/${DEVICE}`),
      fields: { name: S('Mac'), platform: S('darwin'), appVersion: S('1.17.0'), lastRev: I(1), settings: M({ theme: S('deep') }) },
    },
    updateTransforms: [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }],
  };
  assert.equal((await commit(a.idToken, [device])).status, 200);
  const leaky = structuredClone(device);
  leaky.update.fields.settings.mapValue.fields.apiKey = S('sk-not-real');
  assert.equal((await commit(a.idToken, [leaky])).status, 403);
  await commit(a.idToken, [startDeletion(a.uid)]);
  assert.equal((await commit(a.idToken, [device])).status, 403);
});

// ---- Storage

test('Storage takes only "Authorization: Firebase <ID token>"', async () => {
  const a = await account();
  const path = `users/${a.uid}/images/${'a'.repeat(32)}.png`;
  assert.equal((await upload(a.idToken, path, Buffer.from('png'), { scheme: 'Bearer' })).status, 401);
  assert.equal((await send(storage(`/${encodeURIComponent(path)}`), { method: 'GET' })).status, 401);
  assert.equal((await upload(a.idToken, path, Buffer.from('png'))).status, 200);
  assert.equal((await send(storage(`/${encodeURIComponent(path)}`), { method: 'GET', headers: bearer(a.idToken) })).status, 401);
});

test('Storage: multipart upload, metadata, download, and pictures never change', async () => {
  const a = await account();
  const path = `users/${a.uid}/images/${'c'.repeat(32)}.t.png`;
  const bytes = crypto.randomBytes(200 * 1024);
  let res = await upload(a.idToken, path, bytes);
  assert.equal(res.status, 200);
  assert.equal(res.data.name, path);
  assert.equal(res.data.bucket, 'demo-recaller.test');
  assert.equal(res.data.size, String(bytes.length));
  assert.equal(res.data.md5Hash, md5(bytes));
  assert.equal(res.data.contentType, 'image/png');
  res = await send(storage(`/${encodeURIComponent(path)}`), { method: 'GET', headers: firebase(a.idToken) });
  assert.equal(res.data.md5Hash, md5(bytes));
  res = await send(storage(`/${encodeURIComponent(path)}?alt=media`), { method: 'GET', headers: firebase(a.idToken) });
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(res.bytes.equals(bytes));
  assert.equal((await upload(a.idToken, path, bytes)).status, 403);
  const bob = verifiedUser('bob@example.com');
  assert.equal((await send(storage(`/${encodeURIComponent(path)}?alt=media`), { method: 'GET', headers: firebase(bob.idToken) })).status, 403);
  const other = `users/${a.uid}/images/${'d'.repeat(32)}.png`;
  assert.equal((await send(storage(`/${encodeURIComponent(other)}`), { method: 'GET', headers: firebase(a.idToken) })).status, 404);
  assert.deepEqual(Object.keys(mock.objects(a.uid)), [path]);
});

test('Storage: an upload over a stored picture is a create with resource set, as the live service asks: refused by multipart, at a resumable start, and at a finalize that finds one', async (t) => {
  // Cloud Storage for Firebase evaluates every upload of a file's contents as create (update is a metadata
  // change), with resource = the stored file's metadata. The rules twin is asked exactly that.
  const asked = [];
  const evaluate = rules.evaluate;
  rules.evaluate = (r, opts) => {
    const out = evaluate(r, opts);
    if (r.service === 'storage' && r.method !== 'get' && r.method !== 'list' && r.method !== 'delete') {
      asked.push({ method: r.method, resource: r.existing ? Number(r.existing.get('size')) : null, allow: out.allow });
    }
    return out;
  };
  t.after(() => { rules.evaluate = evaluate; });
  const a = await account();
  const path = `users/${a.uid}/images/${'e'.repeat(32)}.t.png`;
  const bytes = crypto.randomBytes(1000);
  assert.equal((await upload(a.idToken, path, bytes)).status, 200);
  assert.equal((await upload(a.idToken, path, bytes)).status, 403, 'the same bytes again');
  assert.equal((await upload(a.idToken, path, crypto.randomBytes(500))).status, 403, 'other bytes');
  assert.equal((await startUpload(a.idToken, path, 300 * 1024)).status, 403, 'refused at the start: no byte goes up');
  // A resumable upload that starts on a new name, which gets its picture from elsewhere before the finalize.
  const late = `users/${a.uid}/images/${'f'.repeat(32)}.png`;
  const big = crypto.randomBytes(300 * 1024);
  const start = await startUpload(a.idToken, late, big.length);
  assert.equal(start.status, 200);
  const first = Buffer.from('the other computer was first');
  mock.writeObject(late, first);
  const res = await chunk(start.headers.get('x-goog-upload-url'), a.idToken, big, 0, big.length, 'upload, finalize');
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('x-goog-upload-status'), 'cancelled');
  assert.deepEqual(asked, [
    { method: 'create', resource: null, allow: true },
    { method: 'create', resource: 1000, allow: false },
    { method: 'create', resource: 1000, allow: false },
    { method: 'create', resource: 1000, allow: false },
    { method: 'create', resource: null, allow: true }, // the start, on a name that was free
    { method: 'create', resource: first.length, allow: false }, // the finalize, after it was taken
  ]);
  assert.equal(mock.objects(a.uid)[path].md5Hash, md5(bytes), 'the picture never changed');
  assert.ok(mock.objects(a.uid)[late].bytes.equals(first));
});

test('Storage rules: the head, the name, PNG only, and the size', async () => {
  const bytes = Buffer.from('not really a png');
  const a = verifiedUser();
  const image = (file) => `users/${a.uid}/images/${file}`;
  assert.equal((await upload(a.idToken, image(`${'a'.repeat(32)}.png`), bytes)).status, 403); // no head yet
  await commit(a.idToken, [createHead(a.uid)]);
  assert.equal((await upload(a.idToken, image(`${'a'.repeat(32)}.png`), bytes)).status, 200);
  assert.equal((await upload(a.idToken, image(`${'b'.repeat(32)}.png`), bytes, { contentType: 'image/jpeg' })).status, 403);
  assert.equal((await upload(a.idToken, image('my picture.png'), bytes)).status, 403);
  assert.equal((await upload(a.idToken, image(`${'c'.repeat(32)}.png`), Buffer.alloc(0))).status, 403);
  assert.equal((await upload(a.idToken, `users/${a.uid}/notes/${'d'.repeat(32)}.png`, bytes)).status, 403);
  assert.equal((await startUpload(a.idToken, image(`${'e'.repeat(32)}.png`), 41 * MiB)).status, 403);
  assert.equal((await startUpload(a.idToken, image(`${'e'.repeat(32)}.png`), 40 * MiB)).status, 200);
});

test('Storage: a resumable upload in chunks, with query and finalize', async () => {
  const a = await account();
  const path = `users/${a.uid}/images/${'f'.repeat(32)}.png`;
  const bytes = crypto.randomBytes(3 * MiB + 5);
  const start = await startUpload(a.idToken, path, bytes.length);
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('x-goog-upload-status'), 'active');
  const session = start.headers.get('x-goog-upload-url');
  assert.equal(new URL(session).origin, mock.base);
  let res = await chunk(session, a.idToken, bytes, 0, 2 * MiB, 'upload');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-goog-upload-status'), 'active');
  res = await uploadStatus(session, a.idToken);
  assert.equal(res.headers.get('x-goog-upload-size-received'), String(2 * MiB));
  assert.equal((await chunk(session, a.idToken, bytes, 0, 10, 'upload')).status, 400); // wrong offset
  assert.equal((await chunk(session, a.idToken, bytes, 2 * MiB, 2 * MiB + 1000, 'upload')).status, 400); // not whole 256 KiB
  assert.deepEqual(mock.objects(a.uid), {});
  res = await chunk(session, a.idToken, bytes, 2 * MiB, bytes.length, 'upload, finalize');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-goog-upload-status'), 'final');
  assert.equal(res.data.size, String(bytes.length));
  assert.equal(res.data.md5Hash, md5(bytes));
  assert.equal((await uploadStatus(session, a.idToken)).headers.get('x-goog-upload-status'), 'final');
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));
  const bob = verifiedUser('bob@example.com');
  assert.equal((await uploadStatus(session, bob.idToken)).status, 403);
});

test('Storage: a dropped chunk keeps what arrived, and the upload resumes from there', async () => {
  const a = await account();
  const path = `users/${a.uid}/images/${'9'.repeat(32)}.png`;
  const bytes = crypto.randomBytes(2 * MiB + 100);
  const session = (await startUpload(a.idToken, path, bytes.length)).headers.get('x-goog-upload-url');
  mock.fail({ service: 'storage', op: 'upload-chunk', status: 'offline' });
  await assert.rejects(chunk(session, a.idToken, bytes, 0, 2 * MiB, 'upload'), TypeError);
  const received = Number((await uploadStatus(session, a.idToken)).headers.get('x-goog-upload-size-received'));
  assert.equal(received, MiB);
  const res = await chunk(session, a.idToken, bytes, received, bytes.length, 'upload, finalize');
  assert.equal(res.status, 200);
  assert.ok(mock.objects(a.uid)[path].bytes.equals(bytes));
});

test('Storage list: prefix, delimiter and pages', async () => {
  const a = await account();
  const files = ['a', 'b', 'c'].flatMap((x) => [`${x.repeat(32)}.png`, `${x.repeat(32)}.t.png`]);
  for (const file of files) mock.writeObject(`users/${a.uid}/images/${file}`, Buffer.from(file));
  mock.writeObject(`users/${a.uid}/drafts/x.png`, Buffer.from('x'));
  const list = (query, token = a.idToken) => send(storage(`?${query}`), { method: 'GET', headers: firebase(token) });
  const images = encodeURIComponent(`users/${a.uid}/images/`);
  let res = await list(`prefix=${images}&delimiter=%2F&maxResults=4`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.items.map((i) => i.name.split('/').pop()), files.slice(0, 4));
  assert.ok(res.data.items.every((i) => i.bucket === 'demo-recaller.test'));
  res = await list(`prefix=${images}&delimiter=%2F&maxResults=4&pageToken=${encodeURIComponent(res.data.nextPageToken)}`);
  assert.deepEqual(res.data.items.map((i) => i.name.split('/').pop()), files.slice(4));
  assert.equal(res.data.nextPageToken, undefined);
  res = await list(`prefix=${encodeURIComponent(`users/${a.uid}/`)}&delimiter=%2F`);
  assert.deepEqual(res.data.prefixes, [`users/${a.uid}/drafts/`, `users/${a.uid}/images/`]);
  assert.deepEqual(res.data.items, []);
  const bob = verifiedUser('bob@example.com');
  assert.equal((await list(`prefix=${images}&delimiter=%2F`, bob.idToken)).status, 403);
});

test('Storage delete: only while the account is being deleted, which also stops uploads', async () => {
  const a = await account();
  const path = `users/${a.uid}/images/${'a'.repeat(32)}.png`;
  await upload(a.idToken, path, Buffer.from('png'));
  const del = () => send(storage(`/${encodeURIComponent(path)}`), { method: 'DELETE', headers: firebase(a.idToken) });
  assert.equal((await del()).status, 403);
  await commit(a.idToken, [startDeletion(a.uid)]);
  assert.equal((await upload(a.idToken, `users/${a.uid}/images/${'b'.repeat(32)}.png`, Buffer.from('png'))).status, 403);
  assert.equal((await del()).status, 204);
  assert.equal((await del()).status, 404);
  assert.deepEqual(mock.objects(a.uid), {});
});

// ---- control API

test('fail(): 503 and 429, offline, times, skip, op and undo', async () => {
  const a = await account();
  const get = () => getDoc(a.idToken, `users/${a.uid}`);
  mock.fail({ service: 'firestore', status: 503, times: 2 });
  assert.equal((await get()).status, 503);
  const second = await get();
  assert.deepEqual([second.status, second.data.error.status], [503, 'UNAVAILABLE']);
  assert.equal((await get()).status, 200);
  mock.fail({ service: 'firestore', status: 429 });
  const quota = await get();
  assert.deepEqual([quota.status, quota.data.error.status], [429, 'RESOURCE_EXHAUSTED']);
  mock.fail({ service: 'storage', status: 503 });
  assert.equal((await get()).status, 200); // another service's failure
  mock.fail(null);
  mock.fail({ service: 'firestore', status: 'offline' });
  await assert.rejects(get(), TypeError);
  assert.equal((await get()).status, 200);
  // Over a socket the answer breaks after its first bytes: a connection closed before any byte looks like an
  // idle keep-alive socket, which Chromium (Electron's net.fetch) would quietly resend.
  mock.fail({ service: 'firestore', status: 'offline' });
  const cut = await fetch(firestore(`/users/${a.uid}`), { headers: bearer(a.idToken) });
  await assert.rejects(cut.arrayBuffer(), TypeError);
  assert.equal(mock.log.at(-1).status, 'offline');
  const undo = mock.fail({ service: 'firestore', op: 'commit', status: 503, times: Infinity, skip: 1 });
  assert.equal((await get()).status, 200);
  const first = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime)]);
  assert.equal(first.status, 200);
  assert.equal((await commit(a.idToken, [bumpHead(a.uid, 3, first.data.writeResults[0].updateTime)])).status, 503);
  undo();
  assert.equal((await commit(a.idToken, [bumpHead(a.uid, 3, first.data.writeResults[0].updateTime)])).status, 200);
  // A misspelt name would never match, so it throws instead of passing silently
  assert.throws(() => mock.fail({ service: 'firestore-commit', status: 503 }), TypeError);
  assert.throws(() => mock.fail({ service: 'storage', op: 'upload-finalize', status: 503 }), TypeError);
  assert.throws(() => mock.pauseAfter('delete-start'), TypeError);
});

test('fail({ lost: true }): the change is made and the answer is lost', async () => {
  const a = await account();
  mock.fail({ service: 'firestore', op: 'commit', status: 'offline', lost: true });
  await assert.rejects(commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime)]), TypeError);
  assert.equal(mock.docs(a.uid).head.rev, 2);
  const retry = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime)]);
  assert.equal(retry.data.error.status, 'FAILED_PRECONDITION');
});

test('bumpHeadBetweenGetAndCommit(): the other computer commits first, once', async () => {
  const a = await account();
  mock.bumpHeadBetweenGetAndCommit();
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2)]);
  assert.equal(res.status, 400);
  assert.equal(res.data.error.status, 'FAILED_PRECONDITION');
  assert.deepEqual(mock.log.at(-1).tags, ['bumped']);
  let head = mock.docs(a.uid).head;
  assert.equal(head.rev, 2);
  assert.equal(head.lastDevice, 'b0'.repeat(16));
  assert.deepEqual(mock.docs(a.uid).notes, {});
  res = await commit(a.idToken, [bumpHead(a.uid, 3, mock.doc(`users/${a.uid}`).updateTime), noteWrite(a.uid, 'n1', 3)]);
  assert.equal(res.status, 200);
  mock.bumpHeadBetweenGetAndCommit({ uid: a.uid, change: (peer) => peer.setJoiner('line') });
  res = await commit(a.idToken, [bumpHead(a.uid, 4, res.data.writeResults[0].updateTime)]);
  assert.equal(res.data.error.status, 'FAILED_PRECONDITION');
  head = mock.docs(a.uid).head;
  assert.deepEqual([head.rev, head.board.joiner], [4, 'line']);
  // A change that can't be made leaves the commit unraced, and the log says so
  mock.bumpHeadBetweenGetAndCommit({ change: (peer) => peer.editNote('no-such-note', 'x') });
  res = await commit(a.idToken, [bumpHead(a.uid, 5, mock.doc(`users/${a.uid}`).updateTime)]);
  assert.equal(res.status, 200);
  assert.deepEqual(mock.log.at(-1).tags, []);
  assert.match(mock.log.at(-1).error, /didn't move: remote\(.+\): no live note no-such-note/);
});

test('denyDoc(): one document is refused until the denial is lifted', async () => {
  const a = await account();
  const lift = mock.denyDoc(`users/${a.uid}/notes/n2`);
  let res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2), noteWrite(a.uid, 'n2', 2)]);
  assert.equal(res.status, 403);
  res = await commit(a.idToken, [bumpHead(a.uid, 2, a.updateTime), noteWrite(a.uid, 'n1', 2)]);
  assert.equal(res.status, 200);
  lift();
  res = await commit(a.idToken, [bumpHead(a.uid, 3, res.data.writeResults[0].updateTime), noteWrite(a.uid, 'n2', 3)]);
  assert.equal(res.status, 200);
  mock.denyDoc(name(`users/${a.uid}/notes/n1`));
  assert.equal((await getDoc(a.idToken, `users/${a.uid}/notes/n1`)).status, 403);
  assert.equal((await getDoc(a.idToken, `users/${a.uid}/notes/n2`)).status, 200);
});

test('pauseAfter(): the change is made, its answer waits, and other requests go on', async () => {
  const a = await account();
  const pause = mock.pauseAfter('deleting');
  let answered = false;
  const pending = commit(a.idToken, [startDeletion(a.uid)]).then((res) => {
    answered = true;
    return res;
  });
  const entry = await pause.hit;
  assert.equal(entry.op, 'commit');
  assert.deepEqual(entry.tags, ['deleting']);
  assert.equal(mock.docs(a.uid).head.deleting, true);
  const other = mock.signInAs('alice@example.com');
  assert.equal((await commit(other.idToken, [bumpHead(a.uid, 2, mock.doc(`users/${a.uid}`).updateTime)])).status, 403);
  assert.equal((await upload(other.idToken, `users/${a.uid}/images/${'a'.repeat(32)}.png`, Buffer.from('png'))).status, 403);
  assert.equal(answered, false);
  pause.resume();
  assert.equal((await pending).status, 200);
});

test('skewMs shifts the Date header and REQUEST_TIME', async () => {
  mock.clock.set(Date.UTC(2026, 9, 1, 10));
  mock.skewMs = 90 * 1000;
  assert.equal(mock.skewMs, 90000);
  const a = verifiedUser();
  const res = await commit(a.idToken, [createHead(a.uid)]);
  assert.equal(new Date(res.headers.get('date')).toISOString(), '2026-10-01T10:01:30.000Z');
  assert.equal(res.data.writeResults[0].transformResults[0].timestampValue, '2026-10-01T10:01:30Z');
});

test('the log has method, path and auth scheme, and never a body or token', async () => {
  const a = await account();
  const picture = `users/${a.uid}/images/${'a'.repeat(32)}.png`;
  await upload(a.idToken, picture, Buffer.from('secret picture bytes'));
  await idCall('signInWithPassword', { email: 'alice@example.com', password: 'password-1234' });
  const text = JSON.stringify(mock.log);
  for (const secret of ['password-1234', 'secret picture bytes', a.idToken, 'mock-key']) assert.ok(!text.includes(secret), secret);
  const [committed, uploaded, signedIn] = mock.log;
  assert.deepEqual([committed.method, committed.auth, committed.service, committed.op], ['POST', 'Bearer', 'firestore', 'commit']);
  assert.deepEqual([committed.uid, committed.rev, committed.writes, committed.tags], [a.uid, 1, 1, ['head-create']]);
  assert.deepEqual([uploaded.auth, uploaded.op, uploaded.protocol, uploaded.name, uploaded.status], ['Firebase', 'upload', 'multipart', picture, 200]);
  assert.deepEqual([signedIn.auth, signedIn.op, signedIn.path], [null, 'signInWithPassword', '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword']);
  assert.ok(committed.done < uploaded.seq);
});

test('remote(uid): each change is one precondition-checked commit by b0…', async () => {
  const a = await account();
  const peer = mock.remote(a.uid);
  const p = peer.addProject('From the Mac', { id: 'p-mac' });
  assert.deepEqual([p.id, p.rev], ['p-mac', 2]);
  const n1 = peer.addNote('p-mac', 'first');
  assert.match(n1.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  peer.addNote('p-mac', 'second', { id: 'n-2' });
  let d = mock.docs(a.uid);
  const s1 = d.notes[n1.id]._sync;
  assert.ok(s1.key < d.notes['n-2']._sync.key);
  assert.deepEqual([s1.by, s1.project, s1.list, s1.deleted, s1.rev], ['b0'.repeat(16), 'p-mac', 'notes', false, 3]);
  assert.match(s1.at, /Z$/);
  peer.editNote(n1.id, 'first, edited');
  peer.copy(n1.id, 3);
  peer.moveNote(n1.id, { list: 'used' });
  peer.setJoiner('line');
  d = mock.docs(a.uid);
  assert.equal(d.head.rev, 8);
  assert.equal(d.head.lastDevice, 'b0'.repeat(16));
  assert.deepEqual(d.head.board, { joiner: 'line' });
  assert.deepEqual(d.head.stats, { projects: 1, notes: 2, images: 0 });
  const note = d.notes[n1.id];
  assert.deepEqual([note.text, note.copied, note._sync.list, note._sync.rev], ['first, edited', 3, 'used', 7]);
  assert.ok(note.usedAt > 0 && note.lastCopiedAt > 0);
  peer.deleteNote(n1.id);
  d = mock.docs(a.uid);
  assert.deepEqual(Object.keys(d.notes[n1.id]), ['_sync']);
  assert.deepEqual([d.notes[n1.id]._sync.deleted, d.notes[n1.id]._sync.list], [true, 'used']);
  const trash = d.trash[`note-${n1.id}`];
  assert.deepEqual([trash.kind, trash.project, trash.list, trash.rev, JSON.parse(trash.data).text], ['note', 'p-mac', 'used', 9, 'first, edited']);
  peer.deleteProject('p-mac');
  d = mock.docs(a.uid);
  assert.equal(d.notes['n-2']._sync.deleted, true);
  assert.equal(d.projects['p-mac']._sync.deleted, true);
  assert.equal(d.trash['project-p-mac'].kind, 'project');
  assert.deepEqual([d.head.rev, d.head.stats], [10, { projects: 0, notes: 0, images: 0 }]);
  assert.throws(() => peer.editNote('n-2', 'too late'), (e) => e instanceof MockError && e.status === 404);
});

test('remote(uid) is refused where the rules refuse it', async () => {
  const a = await account();
  const peer = mock.remote(a.uid);
  peer.addProject('P', { id: 'p1' });
  await commit(a.idToken, [startDeletion(a.uid)]);
  assert.throws(() => peer.addNote('p1', 'late'), (e) => e instanceof MockError && e.status === 403 && e.code === 'PERMISSION_DENIED');
  assert.throws(() => mock.remote('nobody').touch(), (e) => e instanceof MockError && e.status === 404);
  const fresh = mock.remote('fresh');
  assert.equal(fresh.createHead().rev, 1);
  assert.throws(() => fresh.createHead(), (e) => e.status === 409);
});

test('writeDoc() and writeObject() seed the cloud without rules', async () => {
  const a = verifiedUser();
  const updateTime = mock.writeDoc(`users/${a.uid}`, {
    schema: 1, rev: 7, minRev: 0, deleting: false, createdAt: { $ts: Date.UTC(2026, 8, 1) }, updatedAt: { $ts: Date.UTC(2026, 8, 2) },
    board: { joiner: 'blank' }, stats: { projects: 0, notes: 0, images: 0 },
  });
  assert.match(updateTime, /\.\d{6}Z$/);
  const head = await getDoc(a.idToken, `users/${a.uid}`);
  assert.deepEqual(head.data.fields.createdAt, { timestampValue: '2026-09-01T00:00:00Z' });
  assert.equal(head.data.updateTime, updateTime);
  assert.equal(mock.doc(name(`users/${a.uid}`)).data.rev, 7);
  assert.equal(mock.remote(a.uid).touch().rev, 8);
  mock.writeObject(`users/${a.uid}/images/${'a'.repeat(32)}.png`, Buffer.from('png'));
  const res = await send(storage(`/${encodeURIComponent(`users/${a.uid}/images/${'a'.repeat(32)}.png`)}?alt=media`), { method: 'GET', headers: firebase(a.idToken) });
  assert.equal(res.bytes.toString(), 'png');
  mock.writeDoc(`users/${a.uid}`, null);
  assert.equal(mock.docs(a.uid).head, null);
});

test('reset() empties the mock and starts its ids again', async () => {
  const first = await account();
  mock.fail({ status: 503, times: 5 });
  mock.denyDoc(`users/${first.uid}`);
  mock.reset();
  assert.deepEqual([mock.log.length, mock.outbox.length, mock.users().length], [0, 0, 0]);
  assert.equal(mock.docs(first.uid).head, null);
  const again = await account();
  assert.equal(again.uid, first.uid);
});

test('fetch() is the same mock without a socket', async () => {
  const res = await send(identity('signUp'), { json: { email: 'alice@example.com', password: 'long enough', returnSecureToken: true }, fetchImpl: mock.fetch });
  assert.equal(res.status, 200);
  mock.verify('alice@example.com');
  const token = (await send(tokenUrl(), { json: { grant_type: 'refresh_token', refresh_token: res.data.refreshToken }, fetchImpl: mock.fetch })).data.id_token;
  const created = await send(firestore(':commit'), { json: { writes: [createHead(res.data.localId)] }, headers: bearer(token), fetchImpl: mock.fetch });
  assert.equal(created.status, 200);
  assert.ok(created.headers.get('date'));
  mock.fail({ service: 'firestore', status: 'offline' });
  await assert.rejects(send(firestore(`/users/${res.data.localId}`), { method: 'GET', headers: bearer(token), fetchImpl: mock.fetch }), TypeError);
  assert.deepEqual(mock.log.map((e) => e.op), ['signUp', 'token', 'commit', 'get']);
});
