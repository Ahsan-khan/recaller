'use strict';
// createAccount() (ai_memory/15, 3.3, 3.6, 5.13–5.15) against the GCP mock through its in-process fetch, with
// one fake clock shared by the mock, http.js and the account: sign-up, verification then a forced refresh,
// wrong passwords and the lock-out, refreshing 5 minutes early and saving a rotated token, the sign-in ending
// (revoked, disabled, deleted), single-flight refreshes, BUSY, Identity Toolkit's answers to a stale ID token,
// the generic http codes, discarding an unverified account, and deletion's recent-login rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGcpMock } = require('../mock-gcp');
const { loadConfig } = require('../../src/cloud/config');
const { CloudError, createHttp } = require('../../src/cloud/http');
const { createAuth } = require('../../src/cloud/auth');
const { createTokenStore } = require('../../src/cloud/tokens');
const { createAccount, resultCode } = require('../../src/cloud/account');

const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const MIN = 60 * 1000;
const clock = { t: T0, now: () => clock.t, advance: (ms) => { clock.t += ms; } };
const mock = createGcpMock({ now: clock.now });
// mock.fetch needs no socket; the base only has to be a loopback address.
const config = loadConfig({ env: { RECALLER_GCP_BASE: 'http://127.0.0.1:9', RECALLER_TOKEN_STORE: 'test-file' }, isPackaged: false });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-account-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test.beforeEach(() => {
  mock.reset();
  clock.t = T0;
});

const EMAIL = 'alice@example.com';
const PASSWORD = 'correct horse battery';
const lines = []; // every log line from every account here; checked for secrets at the end
const log = { warn: (...a) => lines.push(a.join(' ')), log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
let cases = 0;

// An account as main wires it: http (with the shared clock) → auth, a token store in sync/, and the account.
function setup({ dir = path.join(root, `case-${++cases}`, 'sync'), mode = 'test-file', safeStorage = null, apiKey = config.apiKey } = {}) {
  const http = createHttp({ fetchImpl: mock.fetch, now: clock.now });
  const auth = createAuth({ http, endpoints: config.endpoints, apiKey });
  const tokens = createTokenStore({ dir, mode, safeStorage, config, platform: 'darwin', log });
  const changes = [];
  const account = createAccount({ auth, tokens, config, onChange: (s) => changes.push(s), now: clock.now, log });
  return { dir, file: path.join(dir, 'account.json'), auth, tokens, account, changes };
}

async function signedIn(opts) {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup(opts);
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
  return a;
}

// The mock's log from index `from` on, as 'op status'.
const ops = (from = 0) => mock.log.slice(from).map((e) => `${e.op} ${e.status}`);
const saved = (a) => JSON.parse(fs.readFileSync(a.file, 'utf8'));
const statuses = (a) => a.changes.map((s) => s.status);

// A token store holding one saved sign-in (or none), for accounts built on a stub auth.
const SAVED = { uid: 'u1', email: EMAIL, emailVerified: true, refreshToken: 'r1', keyStore: 'test', project: 'demo-recaller' };
const savedSignIn = (entry = {}) => ({
  load: () => (entry ? { ...SAVED, ...entry } : null),
  save: () => 'test',
  clear() {},
});

// A stand-in for Electron's safeStorage; the sealed form never holds the token's text.
function fakeSafeStorage({ encryptThrows = false } = {}) {
  const sealed = [];
  const flip = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a));
  return {
    sealed,
    isEncryptionAvailable: () => true,
    encryptString(text) {
      if (encryptThrows) throw new Error('the keychain said no');
      sealed.push(text);
      return Buffer.concat([Buffer.from('v10'), flip(Buffer.from(text, 'utf8'))]);
    },
    decryptString: (buf) => flip(buf.subarray(3)).toString('utf8'),
  };
}

// ---- sign-up and verification

test('sign-up: an unverified session kept in account.json, and the verification email', async () => {
  const a = setup();
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.deepEqual(await a.account.signUp(EMAIL, PASSWORD, '2026-10-01'), { ok: true });
  const { uid } = mock.user(EMAIL);
  assert.deepEqual(a.account.state(), { status: 'unverified', uid, email: EMAIL, keyStore: 'test' });
  assert.deepEqual(a.changes, [a.account.state()]);
  assert.deepEqual(ops(), ['signUp 200', 'sendOobCode 200']);
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['VERIFY_EMAIL', EMAIL]]);
  assert.deepEqual({ ...saved(a), refresh: Object.keys(saved(a).refresh) }, {
    version: 1, project: 'demo-recaller', uid, email: EMAIL, emailVerified: false, keyStore: 'test', refresh: ['testPlain'],
    privacyVersion: '2026-10-01', signedInAt: T0,
  });
  assert.deepEqual([a.account.uid(), a.account.email(), a.account.privacyVersion()], [uid, EMAIL, '2026-10-01']);
});

test('sign-up and reset answers: local checks with no network call, EMAIL_EXISTS, SIGNUP_PAUSED, a neutral reset', async () => {
  const a = setup();
  assert.deepEqual(await a.account.signUp(EMAIL, 'seven77'), { ok: false, code: 'WEAK_PASSWORD' });
  assert.deepEqual(await a.account.signUp('not-an-email', PASSWORD), { ok: false, code: 'INVALID_EMAIL' });
  assert.deepEqual(await a.account.signIn(`${'x'.repeat(250)}@example.com`, PASSWORD), { ok: false, code: 'INVALID_EMAIL' });
  assert.deepEqual(await a.account.signIn(EMAIL, ''), { ok: false, code: 'WRONG_PASSWORD' });
  assert.deepEqual(await a.account.resetPassword('nobody'), { ok: false, code: 'INVALID_EMAIL' });
  assert.deepEqual(ops(), []);

  mock.createUser({ email: EMAIL, password: PASSWORD });
  assert.deepEqual(await a.account.signUp(EMAIL, PASSWORD), { ok: false, code: 'EMAIL_EXISTS' });
  mock.setSignupDisabled(true);
  assert.deepEqual(await a.account.signUp('bob@example.com', PASSWORD), { ok: false, code: 'SIGNUP_PAUSED' });
  mock.setSignupDisabled(false);

  // A reset says the same for every email (5.13); reCAPTCHA makes it unavailable.
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: true });
  assert.deepEqual(await a.account.resetPassword('nobody@example.com'), { ok: true });
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['PASSWORD_RESET', EMAIL]]);
  clock.advance(MIN); // one link per email a minute (below)
  mock.requireRecaptchaForReset(true);
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: false, code: 'RESET_UNAVAILABLE' });

  mock.disableUser(EMAIL);
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: false, code: 'USER_DISABLED' });
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.deepEqual(a.changes, []);
});

test('sign-up: a verification email that can\'t be sent still signs up; Send again sends it', async () => {
  const a = setup();
  mock.fail({ service: 'identity', op: 'sendOobCode', status: 503 });
  assert.deepEqual(await a.account.signUp(EMAIL, PASSWORD), { ok: true });
  assert.equal(a.account.state().status, 'unverified');
  assert.deepEqual(ops(), ['signUp 200', 'sendOobCode 503']);
  assert.deepEqual(mock.outbox, []);
  assert.deepEqual(await a.account.resendVerification(), { ok: true });
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['VERIFY_EMAIL', EMAIL]]);
});

test('the privacy version accepted at sign-up stays with that account, never with another', async () => {
  mock.createUser({ email: 'bob@example.com', password: PASSWORD, verified: true });
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD, '2026-10-01');
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
  assert.deepEqual(await a.account.reauthenticate(PASSWORD), { ok: true });
  assert.deepEqual([a.account.privacyVersion(), saved(a).privacyVersion], ['2026-10-01', '2026-10-01']);
  assert.deepEqual(await a.account.signIn('bob@example.com', PASSWORD), { ok: true });
  assert.deepEqual([a.account.privacyVersion(), saved(a).privacyVersion], [null, null]);
  // Only a version date is kept.
  const b = setup();
  await b.account.signUp('carol@example.com', PASSWORD, 'yes please');
  assert.equal(b.account.privacyVersion(), null);
});

test('verification: the lookup sees it, then a forced refresh gives an ID token that says so', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD, '2026-10-01');
  const from = mock.log.length;
  assert.deepEqual(await a.account.checkVerified(), { ok: true, verified: false });
  assert.deepEqual(ops(from), ['lookup 200']);
  mock.verify(EMAIL);
  assert.deepEqual(await a.account.checkVerified(), { ok: true, verified: true });
  assert.deepEqual(ops(from), ['lookup 200', 'lookup 200', 'token 200']);
  assert.equal(a.account.state().status, 'signed-in');
  assert.deepEqual(statuses(a), ['unverified', 'signed-in']);
  assert.equal(a.auth.claims(await a.account.getIdToken()).email_verified, true);
  assert.equal(saved(a).emailVerified, true);
  assert.equal(saved(a).privacyVersion, '2026-10-01');
  // Verified already: nothing to ask.
  assert.deepEqual(await a.account.checkVerified(), { ok: true, verified: true });
  assert.deepEqual(await a.account.resendVerification(), { ok: true });
  assert.equal(ops(from).length, 3);
});

test('verified while Recaller was closed: the first refresh already says so, and no second one is needed', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.verify(EMAIL);
  const next = setup({ dir: a.dir }); // the next start: account.json still says unverified
  assert.equal(next.account.state().status, 'unverified');
  const from = mock.log.length;
  assert.deepEqual(await next.account.checkVerified(), { ok: true, verified: true });
  assert.deepEqual(ops(from), ['token 200', 'lookup 200']);
  assert.deepEqual(statuses(next), ['signed-in']);
});

test('verification checks share one lookup; an operation waits for it instead of answering BUSY', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  const from = mock.log.length;
  const pause = mock.pauseAfter('lookup');
  const first = a.account.checkVerified();
  const second = a.account.checkVerified();
  assert.equal(first, second);
  await pause.hit;
  const resend = a.account.resendVerification();
  assert.deepEqual(await a.account.checkVerified(), { ok: false, code: 'BUSY', verified: false });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(mock.log.slice(from).map((e) => e.op), ['lookup'], 'the resend waits for the lookup\'s answer');
  pause.resume();
  assert.deepEqual(await first, { ok: true, verified: false });
  assert.deepEqual(await resend, { ok: true });
  assert.deepEqual(ops(from), ['lookup 200', 'sendOobCode 200']);
});

test('Identity Toolkit\'s INVALID_ID_TOKEN forces one refresh and one retry, and never ends the sign-in', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.expireIdTokens(); // the account still believes its ID token is good for an hour
  let from = mock.log.length;
  assert.deepEqual(await a.account.checkVerified(), { ok: true, verified: false });
  assert.deepEqual(ops(from), ['lookup 400', 'token 200', 'lookup 200']);
  mock.expireIdTokens();
  from = mock.log.length;
  assert.deepEqual(await a.account.resendVerification(), { ok: true });
  assert.deepEqual(ops(from), ['sendOobCode 400', 'token 200', 'sendOobCode 200']);
  assert.equal(a.account.state().status, 'unverified');
});

test('Identity Toolkit\'s TOKEN_EXPIRED on a call is a stale ID token; only Secure Token\'s ends a sign-in', async () => {
  const calls = [];
  let n = 0;
  let lookups = 0;
  const auth = {
    refresh: async (refreshToken) => {
      calls.push('refresh');
      return { uid: 'u1', email: EMAIL, idToken: `id-${++n}`, refreshToken, expiresAt: clock.now() + 3600e3, emailVerified: false };
    },
    lookup: async (idToken) => {
      calls.push(`lookup ${idToken}`);
      if (++lookups === 1) throw new CloudError('TOKEN_EXPIRED', { status: 400, service: 'identity' });
      return { uid: 'u1', email: EMAIL, emailVerified: false, disabled: false };
    },
  };
  const account = createAccount({ auth, tokens: savedSignIn({ emailVerified: false }), config, now: clock.now, log });
  assert.deepEqual(await account.checkVerified(), { ok: true, verified: false });
  assert.deepEqual(calls, ['refresh', 'lookup id-1', 'refresh', 'lookup id-2']);
  assert.equal(account.state().status, 'unverified');
});

test('turned off or deleted while unverified: the lookup and Send again say so, and no token is asked for after', async () => {
  let a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.disableUser(EMAIL);
  assert.deepEqual(await a.account.checkVerified(), { ok: false, code: 'USER_DISABLED', verified: false });
  assert.equal(a.account.state().status, 'disabled');

  mock.reset();
  a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.disableUser(EMAIL);
  assert.deepEqual(await a.account.resendVerification(), { ok: false, code: 'USER_DISABLED' });
  assert.equal(a.account.state().status, 'disabled');
  let from = mock.log.length;
  await assert.rejects(a.account.getIdToken(), { code: 'USER_DISABLED', service: 'token' });
  assert.deepEqual(ops(from), [], 'no network call once the account is known to be off');

  mock.reset();
  a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.deleteUser(EMAIL); // its ID token is still in hand
  assert.deepEqual(await a.account.checkVerified(), { ok: false, code: 'UNAVAILABLE', verified: false });
  assert.equal(a.account.state().status, 'deleted');
  from = mock.log.length;
  await assert.rejects(a.account.getIdToken(), { code: 'USER_NOT_FOUND', service: 'token' });
  assert.deepEqual(ops(from), []);
});

// ---- passwords

test('wrong passwords: five in ten minutes lock sign-in for 30 s, with no network call meanwhile', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(await a.account.signIn(EMAIL, `wrong ${i}`), { ok: false, code: 'WRONG_PASSWORD' });
    clock.advance(MIN);
  }
  assert.deepEqual(await a.account.signIn('nobody@example.com', PASSWORD), { ok: false, code: 'LOCKED_OUT', retryAfterMs: 30000 });
  const from = mock.log.length;
  clock.advance(10000);
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: false, code: 'LOCKED_OUT', retryAfterMs: 20000 });
  assert.deepEqual(ops(from), [], 'no network call while locked out');
  clock.advance(20000);
  assert.deepEqual(await a.account.signIn(EMAIL, 'wrong again'), { ok: false, code: 'LOCKED_OUT', retryAfterMs: 30000 });
  clock.advance(30000);
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(a.account.state().status, 'signed-in');
  // A success starts the count again.
  for (let i = 0; i < 4; i++) assert.deepEqual(await a.account.signIn(EMAIL, 'wrong'), { ok: false, code: 'WRONG_PASSWORD' });
  assert.equal(a.account.state().status, 'signed-in', 'a failed sign-in leaves the current one alone');
});

test('the lock-out counts only wrong passwords from the last ten minutes, and nothing else', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  for (let i = 0; i < 4; i++) assert.deepEqual(await a.account.signIn(EMAIL, 'wrong'), { ok: false, code: 'WRONG_PASSWORD' });
  clock.advance(10 * MIN);
  assert.deepEqual(await a.account.signIn(EMAIL, 'wrong'), { ok: false, code: 'WRONG_PASSWORD' });
  mock.fail({ service: 'identity', status: 503, times: 4 });
  for (let i = 0; i < 4; i++) assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: false, code: 'UNAVAILABLE' });
  mock.tooManyAttemptsAfter(0);
  assert.deepEqual(await a.account.signIn(EMAIL, 'wrong'), { ok: false, code: 'TOO_MANY_ATTEMPTS' });
  mock.tooManyAttemptsAfter(null);
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
});

test('the lock-out forgets wrong passwords from the future when the clock is set back', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  for (let i = 0; i < 4; i++) assert.equal((await a.account.signIn(EMAIL, 'wrong')).code, 'WRONG_PASSWORD');
  assert.equal((await a.account.signIn(EMAIL, 'wrong')).code, 'LOCKED_OUT');
  clock.t = T0 - 60 * MIN; // the clock was an hour fast
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
});

test('reauthenticate(): the same account only, and wrong passwords count toward the lock-out', async () => {
  const a = await signedIn();
  const uid = a.account.uid();
  assert.deepEqual(await a.account.reauthenticate('wrong'), { ok: false, code: 'WRONG_PASSWORD' });
  assert.deepEqual(await a.account.reauthenticate(PASSWORD), { ok: true });
  assert.deepEqual(a.account.state(), { status: 'signed-in', uid, email: EMAIL, keyStore: 'test' });
  // The email names another account now (deleted, then created again): refused, nothing changes here.
  mock.deleteUser(EMAIL);
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  assert.deepEqual(await a.account.reauthenticate(PASSWORD), { ok: false, code: 'UNAVAILABLE' });
  assert.equal(a.account.uid(), uid);
  for (let i = 0; i < 4; i++) await a.account.reauthenticate('wrong');
  assert.equal((await a.account.reauthenticate('wrong')).code, 'LOCKED_OUT');
  assert.equal((await a.account.signIn(EMAIL, PASSWORD)).code, 'LOCKED_OUT');
});

// ---- ID tokens

test('getIdToken(): the same token until 5 minutes before it expires, then one refresh; the rotated token is saved', async () => {
  const a = await signedIn();
  const first = await a.account.getIdToken();
  const before = saved(a).refresh.testPlain;
  const from = mock.log.length;
  clock.advance(55 * MIN - 1);
  assert.equal(await a.account.getIdToken(), first);
  assert.deepEqual(ops(from), []);
  clock.advance(1);
  const second = await a.account.getIdToken();
  assert.notEqual(second, first);
  assert.deepEqual(ops(from), ['token 200']);
  assert.notEqual(saved(a).refresh.testPlain, before, 'the mock rotates refresh tokens');
  assert.equal(await a.account.getIdToken(), second);
  assert.notEqual(await a.account.getIdToken({ force: true }), second);
  assert.deepEqual(ops(from), ['token 200', 'token 200']);
  assert.deepEqual(statuses(a), ['signed-in']);
});

test('refreshes are single flight', async () => {
  const a = await signedIn();
  clock.advance(56 * MIN);
  const from = mock.log.length;
  const got = await Promise.all([
    a.account.getIdToken(), a.account.getIdToken({ force: true }), a.account.getIdToken(), a.account.getIdToken({ force: true }),
  ]);
  assert.deepEqual(ops(from), ['token 200']);
  assert.equal(new Set(got).size, 1);
  assert.equal(await a.account.getIdToken(), got[0]);
});

test('secure storage: the token is sealed at sign-in and again when it rotates; a failed seal is session-only', async () => {
  const safe = fakeSafeStorage();
  const a = await signedIn({ mode: 'secure', safeStorage: safe });
  assert.equal(a.account.state().keyStore, 'keychain');
  assert.deepEqual(Object.keys(saved(a).refresh), ['enc']);
  await a.account.getIdToken({ force: true });
  assert.equal(safe.sealed.length, 2);
  assert.notEqual(safe.sealed[0], safe.sealed[1]);
  const text = fs.readFileSync(a.file, 'utf8');
  assert.ok(!safe.sealed.some((token) => text.includes(token)));
  // The next start reads it back, with no network call.
  const from = mock.log.length;
  const again = setup({ dir: a.dir, mode: 'secure', safeStorage: safe });
  assert.deepEqual(again.account.state(), a.account.state());
  assert.deepEqual(ops(from), []);
  await again.account.getIdToken();
  assert.deepEqual(ops(from), ['token 200']);

  mock.reset();
  const b = await signedIn({ mode: 'secure', safeStorage: fakeSafeStorage({ encryptThrows: true }) });
  assert.equal(b.account.state().keyStore, 'session');
  assert.equal(saved(b).refresh, null);
  assert.equal(setup({ dir: b.dir, mode: 'secure', safeStorage: fakeSafeStorage() }).account.state().status, 'needs-sign-in');
});

test('a revoked refresh token ends the sign-in: needs-sign-in now and at the next start, until signing in again', async () => {
  const a = await signedIn();
  const uid = a.account.uid();
  mock.revokeTokens(EMAIL); // a password change elsewhere
  const ended = (err) => err instanceof CloudError && err.code === 'TOKEN_EXPIRED' && err.service === 'token';
  await assert.rejects(a.account.getIdToken({ force: true }), ended);
  assert.deepEqual(a.account.state(), { status: 'needs-sign-in', uid, email: EMAIL, keyStore: 'test' });
  assert.deepEqual(statuses(a), ['signed-in', 'needs-sign-in']);
  assert.deepEqual([saved(a).uid, saved(a).refresh], [uid, null]);
  const from = mock.log.length;
  await assert.rejects(a.account.getIdToken(), { code: 'TOKEN_EXPIRED', service: 'token' });
  assert.deepEqual(await a.account.checkVerified(), { ok: false, code: 'UNAVAILABLE', verified: false });
  assert.deepEqual(ops(from), [], 'no network call for a sign-in that ended');

  const next = setup({ dir: a.dir });
  assert.deepEqual(next.account.state(), { status: 'needs-sign-in', uid, email: EMAIL, keyStore: 'session' });
  assert.deepEqual(await next.account.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(next.account.state().status, 'signed-in');
  assert.equal(typeof saved(next).refresh.testPlain, 'string');
});

test('refresh answers: disabled, deleted, and the codes that end a sign-in; other failures change nothing', async () => {
  let a = await signedIn();
  mock.disableUser(EMAIL);
  await assert.rejects(a.account.getIdToken({ force: true }), { code: 'USER_DISABLED' });
  assert.equal(a.account.state().status, 'disabled');
  assert.equal(typeof saved(a).refresh.testPlain, 'string', 'kept: if the account is turned on again, the next start works');
  await assert.rejects(a.account.getIdToken(), { code: 'USER_DISABLED' });

  mock.reset();
  a = await signedIn();
  mock.deleteUser(EMAIL);
  await assert.rejects(a.account.getIdToken({ force: true }), { code: 'USER_NOT_FOUND' });
  assert.equal(a.account.state().status, 'deleted');
  await assert.rejects(a.account.getIdToken(), { code: 'USER_NOT_FOUND' });

  const rows = [
    ['TOKEN_EXPIRED', 'needs-sign-in'], ['INVALID_REFRESH_TOKEN', 'needs-sign-in'], ['PROJECT_NUMBER_MISMATCH', 'needs-sign-in'],
    ['USER_DISABLED', 'disabled'], ['USER_NOT_FOUND', 'deleted'],
    ['NETWORK', 'signed-in'], ['SERVER', 'signed-in'], ['QUOTA', 'signed-in'], ['BAD_REQUEST', 'signed-in'], ['PERMISSION', 'signed-in'],
  ];
  for (const [code, status] of rows) {
    const auth = { refresh: async () => { throw new CloudError(code, { status: 400, service: 'token' }); } };
    const account = createAccount({ auth, tokens: savedSignIn(), config, now: clock.now, log });
    await assert.rejects(account.getIdToken(), { code });
    assert.equal(account.state().status, status, code);
  }
});

test('signing out while a refresh is on its way drops its answer; account.json is not written again', async () => {
  const a = await signedIn();
  const pause = mock.pauseAfter('token');
  const pending = a.account.getIdToken({ force: true });
  await pause.hit;
  assert.deepEqual(await a.account.signOut(), { ok: true });
  assert.equal(fs.existsSync(a.file), false);
  pause.resume();
  await assert.rejects(pending, { code: 'SIGNED_OUT', service: 'token' });
  assert.equal(fs.existsSync(a.file), false);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.deepEqual(statuses(a), ['signed-in', 'signed-out']);
  await assert.rejects(a.account.getIdToken(), { code: 'SIGNED_OUT' });
  assert.equal(a.account.uid(), null);
});

test('signing in as another account while a refresh is on its way: the old answer is dropped, the new account refreshes', async () => {
  const a = await signedIn();
  mock.createUser({ email: 'bob@example.com', password: PASSWORD, verified: true });
  const pause = mock.pauseAfter('token');
  const pending = a.account.getIdToken({ force: true });
  await pause.hit;
  assert.deepEqual(await a.account.signIn('bob@example.com', PASSWORD), { ok: true });
  const bob = mock.user('bob@example.com').uid;
  const forBob = a.account.getIdToken({ force: true }); // never joins the other account's refresh
  pause.resume();
  await assert.rejects(pending, { code: 'SIGNED_OUT', service: 'token' });
  assert.equal(a.auth.claims(await forBob).user_id, bob);
  assert.deepEqual([a.account.uid(), saved(a).uid], [bob, bob]);
});

test('re-authenticating while a refresh is on its way: account.json keeps the newer sign-in', async () => {
  const a = await signedIn();
  const pause = mock.pauseAfter('token');
  const pending = a.account.getIdToken({ force: true });
  await pause.hit;
  assert.deepEqual(await a.account.reauthenticate(PASSWORD), { ok: true });
  const kept = saved(a).refresh.testPlain;
  pause.resume();
  assert.ok(await pending, 'still a good token for the same account');
  assert.equal(saved(a).refresh.testPlain, kept);
});

test('forget(): the sign-in here is forgotten at once', async () => {
  const a = await signedIn();
  a.account.forget();
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);
  await assert.rejects(a.account.getIdToken(), { code: 'SIGNED_OUT' });
  a.account.forget(); // nothing left to forget
  assert.deepEqual(statuses(a), ['signed-in', 'signed-out']);
});

// ---- one at a time, errors, start-up

test('one operation at a time: another gets BUSY, a verification check too', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  const pause = mock.pauseAfter('signInWithPassword');
  const first = a.account.signIn(EMAIL, PASSWORD);
  await pause.hit;
  const busy = { ok: false, code: 'BUSY' };
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), busy);
  assert.deepEqual(await a.account.signUp('bob@example.com', PASSWORD), busy);
  assert.deepEqual(await a.account.signOut(), busy);
  assert.deepEqual(await a.account.resetPassword(EMAIL), busy);
  assert.deepEqual(await a.account.reauthenticate(PASSWORD), busy);
  assert.deepEqual(await a.account.resendVerification(), busy);
  assert.deepEqual(await a.account.discardUnverified(), busy);
  assert.deepEqual(await a.account.deleteAccount(PASSWORD), busy);
  assert.deepEqual(await a.account.checkVerified(), { ...busy, verified: false });
  pause.resume();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(ops(), ['signInWithPassword 200']);
  assert.deepEqual(await a.account.signOut(), { ok: true });
});

test('generic http answers map to the page\'s codes and never count as wrong passwords', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  const rows = [
    [429, 'TOO_MANY_ATTEMPTS'], [503, 'UNAVAILABLE'], [500, 'UNAVAILABLE'], [403, 'UNAVAILABLE'], ['offline', 'NETWORK'],
  ];
  for (const [status, code] of rows) {
    mock.fail({ service: 'identity', status });
    assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: false, code }, String(status));
  }
  assert.deepEqual(await a.account.signIn(EMAIL, PASSWORD), { ok: true });
  // A key the project doesn't know: a 400 in prose (BAD_REQUEST).
  assert.deepEqual(await setup({ apiKey: 'wrong-key' }).account.signIn(EMAIL, PASSWORD), { ok: false, code: 'UNAVAILABLE' });
  // Secure Token failing for a while keeps the sign-in.
  mock.fail({ service: 'token', status: 503 });
  await assert.rejects(a.account.getIdToken({ force: true }), { code: 'SERVER', service: 'token' });
  mock.fail({ service: 'token', status: 'offline' });
  await assert.rejects(a.account.getIdToken({ force: true }), { code: 'NETWORK' });
  assert.equal(a.account.state().status, 'signed-in');
  assert.ok(await a.account.getIdToken({ force: true }));
});

test('resultCode(): the 3.6 table and the generic http codes', () => {
  const rows = [
    ['INVALID_EMAIL', '', 'INVALID_EMAIL'], ['INVALID_IDENTIFIER', '', 'INVALID_EMAIL'], ['MISSING_EMAIL', '', 'INVALID_EMAIL'],
    ['WEAK_PASSWORD', '', 'WEAK_PASSWORD'], ['PASSWORD_DOES_NOT_MEET_REQUIREMENTS', '', 'WEAK_PASSWORD'], ['MISSING_PASSWORD', '', 'WEAK_PASSWORD'],
    ['EMAIL_EXISTS', '', 'EMAIL_EXISTS'],
    ['INVALID_LOGIN_CREDENTIALS', 'sign-in', 'WRONG_PASSWORD'], ['INVALID_PASSWORD', 'sign-in', 'WRONG_PASSWORD'],
    ['EMAIL_NOT_FOUND', 'sign-in', 'WRONG_PASSWORD'], ['USER_NOT_FOUND', 'sign-in', 'WRONG_PASSWORD'], ['USER_NOT_FOUND', 'check', 'UNAVAILABLE'],
    ['USER_DISABLED', '', 'USER_DISABLED'],
    ['TOO_MANY_ATTEMPTS_TRY_LATER', '', 'TOO_MANY_ATTEMPTS'], ['QUOTA_EXCEEDED', '', 'TOO_MANY_ATTEMPTS'], ['QUOTA', '', 'TOO_MANY_ATTEMPTS'],
    ['ADMIN_ONLY_OPERATION', 'sign-up', 'SIGNUP_PAUSED'],
    ['MISSING_RECAPTCHA_TOKEN', 'reset', 'RESET_UNAVAILABLE'], ['INVALID_RECAPTCHA_SCORE', 'sign-in', 'UNAVAILABLE'],
    ['OPERATION_NOT_ALLOWED', '', 'UNAVAILABLE'], ['PASSWORD_LOGIN_DISABLED', '', 'UNAVAILABLE'],
    ['CONFIGURATION_NOT_FOUND', '', 'UNAVAILABLE'], ['PROJECT_NOT_FOUND', '', 'UNAVAILABLE'],
    ['NETWORK', '', 'NETWORK'], ['TIMEOUT', '', 'NETWORK'],
    ['PERMISSION', '', 'UNAVAILABLE'], ['BAD_REQUEST', '', 'UNAVAILABLE'], ['SERVER', '', 'UNAVAILABLE'],
    ['CREDENTIAL_TOO_OLD_LOGIN_AGAIN', 'delete', 'UNAVAILABLE'], ['SOMETHING_NEW', '', 'UNAVAILABLE'],
  ];
  for (const [code, op, expected] of rows) assert.equal(resultCode(new CloudError(code, { service: 'identity' }), op), expected, `${code} ${op}`);
  assert.equal(resultCode(new TypeError('x')), 'UNAVAILABLE');
  assert.equal(resultCode(null), 'UNAVAILABLE');
});

test('an operation never throws: a bug becomes UNAVAILABLE, logged without details', async () => {
  const before = lines.length;
  const auth = { signIn: async () => { throw new TypeError(`cannot read ${EMAIL}`); } };
  const tokens = savedSignIn(null);
  const onChange = () => {
    throw new Error('page gone');
  };
  const account = createAccount({ auth, tokens, config, now: clock.now, log, onChange });
  assert.deepEqual(await account.signIn(EMAIL, PASSWORD), { ok: false, code: 'UNAVAILABLE' });
  assert.deepEqual(lines.slice(before), ['[account] sign-in failed unexpectedly (TypeError)']);
  // A throwing onChange doesn't stop an operation.
  const session = { uid: 'u1', email: EMAIL, idToken: 'i', refreshToken: 'r', expiresAt: clock.now() + 3600e3, emailVerified: true };
  const ok = createAccount({ auth: { signIn: async () => session }, tokens, config, now: clock.now, log, onChange });
  assert.deepEqual(await ok.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(ok.state().status, 'signed-in');
  assert.match(lines.at(-1), /onChange failed/);
});

test('resetPassword(): one link per email a minute; other emails, and a send that failed, don\'t wait (2.7)', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  mock.fail({ service: 'identity', status: 'offline' });
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: false, code: 'NETWORK' });
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: true }, 'a failed send starts no wait');
  clock.advance(20 * 1000);
  const from = mock.log.length;
  assert.deepEqual(await a.account.resetPassword(` ${EMAIL.toUpperCase()} `), { ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs: 40 * 1000 });
  assert.deepEqual(ops(from), [], 'no request');
  assert.deepEqual(await a.account.resetPassword('nobody@example.com'), { ok: true }, 'another email is not held up');
  clock.advance(40 * 1000);
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: true }, 'a minute later');
  assert.deepEqual(mock.outbox.map((m) => [m.requestType, m.email]), [['PASSWORD_RESET', EMAIL], ['PASSWORD_RESET', EMAIL]]);
  assert.equal(a.account.state().status, 'signed-out', 'nothing else changes');
});

test('resetPassword() stays neutral even where the service tells unknown emails apart', async () => {
  const reset = (code) => createAccount({
    auth: { sendPasswordReset: async () => { throw new CloudError(code, { status: 400, service: 'identity' }); } },
    tokens: savedSignIn(null), config, now: clock.now, log,
  }).resetPassword(EMAIL);
  for (const code of ['EMAIL_NOT_FOUND', 'USER_NOT_FOUND', 'USER_DISABLED']) assert.deepEqual(await reset(code), { ok: true }, code);
  assert.deepEqual(await reset('NETWORK'), { ok: false, code: 'NETWORK' });
});

test('resetPassword(): an unknown email waits its minute like a known one, so the answer never tells them apart', async () => {
  // A service that names unknown emails (no enumeration protection): the second ask is held either way.
  let sent = 0;
  const account = createAccount({
    auth: { sendPasswordReset: async () => { sent++; throw new CloudError('EMAIL_NOT_FOUND', { status: 400, service: 'identity' }); } },
    tokens: savedSignIn(null), config, now: clock.now, log,
  });
  assert.deepEqual(await account.resetPassword('nobody@example.com'), { ok: true });
  assert.deepEqual(await account.resetPassword('nobody@example.com'), { ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs: MIN });
  assert.equal(sent, 1);
});

test('resetPassword(): a clock set back never holds a reset link for longer than a minute', async () => {
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const a = setup();
  assert.deepEqual(await a.account.resetPassword(EMAIL), { ok: true });
  clock.advance(-60 * MIN); // the computer's clock was an hour fast, and is corrected
  const res = await a.account.resetPassword(EMAIL);
  assert.ok(res.ok === true || (res.code === 'RESET_UNAVAILABLE' && res.retryAfterMs <= MIN), JSON.stringify(res));
});

test('answers that name no account, or another one, are refused', async () => {
  const later = clock.now() + 3600e3;
  const noUid = createAccount({
    auth: { signIn: async () => ({ uid: '', email: EMAIL, idToken: 'i', refreshToken: 'r', expiresAt: later, emailVerified: true }) },
    tokens: savedSignIn(null), config, now: clock.now, log,
  });
  assert.deepEqual(await noUid.signIn(EMAIL, PASSWORD), { ok: false, code: 'UNAVAILABLE' });
  assert.deepEqual(noUid.state(), { status: 'signed-out' });
  const otherUid = createAccount({
    auth: { refresh: async () => ({ uid: 'u2', email: EMAIL, idToken: 'i2', refreshToken: 'r2', expiresAt: later, emailVerified: true }) },
    tokens: savedSignIn(), config, now: clock.now, log,
  });
  await assert.rejects(otherUid.getIdToken(), { code: 'SERVER', service: 'token' });
  assert.deepEqual([otherUid.uid(), otherUid.state().status], ['u1', 'signed-in']);
});

test('a sign-in that can\'t be saved lasts for the session, and never leaves another account\'s sign-in behind', async () => {
  let cleared = 0;
  const tokens = {
    load: () => ({ ...SAVED }),
    save: () => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); },
    clear: () => { cleared++; },
  };
  const session = (uid) => ({ uid, email: EMAIL, idToken: `i-${uid}`, refreshToken: `r-${uid}`, expiresAt: clock.now() + 3600e3, emailVerified: true });
  let next = 'u1';
  const account = createAccount({ auth: { signIn: async () => session(next) }, tokens, config, now: clock.now, log });
  assert.deepEqual(await account.signIn(EMAIL, PASSWORD), { ok: true });
  assert.deepEqual([account.state().keyStore, cleared], ['session', 0], 'the same account: its file stays');
  assert.match(lines.at(-1), /the sign-in couldn't be saved \(EROFS\)/);
  next = 'u2';
  assert.deepEqual(await account.signIn(EMAIL, PASSWORD), { ok: true });
  assert.deepEqual([account.uid(), account.state().keyStore, cleared], ['u2', 'session', 1]);
});

test('start-up: a saved sign-in is used with no network call; session-only reads as needs-sign-in; another project is ignored', () => {
  const dir = path.join(root, `case-${++cases}`, 'sync');
  const store = createTokenStore({ dir, mode: 'test-file', config, log });
  const base = { uid: 'u1', email: EMAIL, privacyVersion: '2026-10-01', signedInAt: 5 };
  const rows = [
    [{ ...base, emailVerified: true, refreshToken: 'AMf-1' }, { status: 'signed-in', uid: 'u1', email: EMAIL, keyStore: 'test' }],
    [{ ...base, emailVerified: false, refreshToken: 'AMf-1' }, { status: 'unverified', uid: 'u1', email: EMAIL, keyStore: 'test' }],
    [{ ...base, emailVerified: true, refreshToken: null }, { status: 'needs-sign-in', uid: 'u1', email: EMAIL, keyStore: 'session' }],
  ];
  for (const [entry, state] of rows) {
    store.save(entry);
    const a = setup({ dir });
    assert.deepEqual(a.account.state(), state);
    assert.deepEqual(a.changes, [], 'no change to report at start-up');
    assert.equal(a.account.privacyVersion(), '2026-10-01');
  }
  createTokenStore({ dir, mode: 'test-file', project: 'recaller-cloud', log }).save({ ...base, emailVerified: true, refreshToken: 'AMf-1' });
  assert.deepEqual(setup({ dir }).account.state(), { status: 'signed-out' });
  // The memory store (runs from source) remembers nothing.
  assert.deepEqual(setup({ dir, mode: 'memory' }).account.state(), { status: 'signed-out' });
  assert.deepEqual(mock.log, []);
  // A store made without the project (3.3 gives it none): the account checks the project itself.
  const started = (entry) => createAccount({ auth: {}, tokens: savedSignIn(entry), config, now: clock.now, log }).state().status;
  assert.deepEqual([started({}), started({ project: 'recaller-cloud' }), started({ project: undefined })], ['signed-in', 'signed-out', 'signed-out']);
});

test('memory storage: a sign-in that lasts for the session, and nothing on disk', async () => {
  const a = await signedIn({ mode: 'memory' });
  assert.equal(a.account.state().keyStore, 'session');
  assert.equal(fs.existsSync(path.dirname(a.dir)), false);
  await a.account.getIdToken({ force: true });
  assert.deepEqual(await a.account.signOut(), { ok: true });
  assert.equal(fs.existsSync(path.dirname(a.dir)), false);
});

// ---- discarding an unverified account (6.2 "Use a different email")

test('discardUnverified(): deletes the unverified account, then signs out here', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  const from = mock.log.length;
  assert.deepEqual(await a.account.discardUnverified(), { ok: true });
  assert.deepEqual(ops(from), ['lookup 200', 'delete 200']);
  assert.equal(mock.user(EMAIL), null);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);
  assert.deepEqual(await a.account.discardUnverified(), { ok: true }, 'nothing left to discard');
});

test('discardUnverified() after the recent-login window signs out here and leaves the account to the clean-up', async () => {
  const a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  clock.advance(6 * MIN);
  const from = mock.log.length;
  assert.deepEqual(await a.account.discardUnverified(), { ok: true });
  assert.deepEqual(ops(from), ['lookup 200', 'delete 400']);
  assert.equal(mock.user(EMAIL).emailVerified, false, 'still there, unverified: purge-unverified.js removes it');
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);
  assert.match(lines.at(-1), /CREDENTIAL_TOO_OLD_LOGIN_AGAIN/);
});

test('discardUnverified() never deletes an account verified meanwhile, and keeps everything when offline', async () => {
  let a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.verify(EMAIL);
  assert.deepEqual(await a.account.discardUnverified(), { ok: true });
  assert.notEqual(mock.user(EMAIL), null);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });

  mock.reset();
  a = setup();
  await a.account.signUp(EMAIL, PASSWORD);
  mock.fail({ service: 'identity', status: 'offline' });
  assert.deepEqual(await a.account.discardUnverified(), { ok: false, code: 'NETWORK' });
  assert.equal(a.account.state().status, 'unverified');
  assert.ok(fs.existsSync(a.file));
  assert.deepEqual(await a.account.discardUnverified(), { ok: true });
  assert.equal(mock.user(EMAIL), null);

  // Only an unverified account is discarded this way.
  mock.reset();
  a = await signedIn();
  assert.deepEqual(await a.account.discardUnverified(), { ok: false, code: 'UNAVAILABLE' });
  assert.equal(a.account.state().status, 'signed-in');
});

// ---- account deletion, the account's side (5.15 steps 1, 7 and 8)

test('deleteAccount(): re-authenticates, lets the data be erased, deletes the sign-in and forgets it here', async () => {
  const a = await signedIn();
  const steps = [];
  const from = mock.log.length;
  const res = await a.account.deleteAccount(PASSWORD, {
    eraseData: async () => steps.push(`erase ${ops(from).join(', ')}`),
    onProgress: (p) => steps.push(p),
  });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(steps, ['erase signInWithPassword 200', { what: 'account', done: 0, total: 1 }]);
  assert.deepEqual(ops(from), ['signInWithPassword 200', 'delete 200']);
  assert.equal(mock.user(EMAIL), null);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);
  assert.deepEqual(statuses(a), ['signed-in', 'signed-out']);
});

test('deleteAccount(): a wrong password stops before anything is erased', async () => {
  const a = await signedIn();
  let erased = false;
  assert.deepEqual(await a.account.deleteAccount('wrong', { eraseData: async () => { erased = true; } }), { ok: false, code: 'WRONG_PASSWORD' });
  assert.equal(erased, false);
  assert.notEqual(mock.user(EMAIL), null);
  assert.equal(a.account.state().status, 'signed-in');
  assert.ok(fs.existsSync(a.file));
});

test('deleteAccount(): erasing a big board outlasts the recent-login window, so the password signs in again first', async () => {
  const a = await signedIn();
  const from = mock.log.length;
  const res = await a.account.deleteAccount(PASSWORD, { eraseData: async () => clock.advance(7 * MIN) });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(ops(from), ['signInWithPassword 200', 'signInWithPassword 200', 'delete 200']);
  assert.equal(mock.user(EMAIL), null);
});

test('deleteAccount(): CREDENTIAL_TOO_OLD_LOGIN_AGAIN signs in again once and retries; the page never sees it', async () => {
  const a = await signedIn();
  const from = mock.log.length;
  // The service's clock runs ahead of this computer's, so the local check thinks the sign-in is recent.
  const res = await a.account.deleteAccount(PASSWORD, { eraseData: async () => mock.clock.advance(6 * MIN) });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(ops(from), ['signInWithPassword 200', 'delete 400', 'signInWithPassword 200', 'delete 200']);
  assert.equal(mock.user(EMAIL), null);
});

test('deleteAccount(): an erase that stops partway keeps the account and the sign-in, for "Finishing account deletion…"', async () => {
  const a = await signedIn();
  const res = await a.account.deleteAccount(PASSWORD, {
    eraseData: async () => { throw new CloudError('NETWORK', { retryable: true, service: 'firestore' }); },
  });
  assert.deepEqual(res, { ok: false, code: 'NETWORK' });
  assert.notEqual(mock.user(EMAIL), null);
  assert.equal(a.account.state().status, 'signed-in');
  assert.ok(fs.existsSync(a.file));
  // Asked again with the password, it finishes.
  assert.deepEqual(await a.account.deleteAccount(PASSWORD, { eraseData: async () => {} }), { ok: true });
  assert.equal(mock.user(EMAIL), null);
});

test('deleteAccount(): an account deleted elsewhere while the data was erased counts as deleted', async () => {
  const a = await signedIn();
  const from = mock.log.length;
  assert.deepEqual(await a.account.deleteAccount(PASSWORD, { eraseData: async () => mock.deleteUser(EMAIL) }), { ok: true });
  assert.deepEqual(ops(from), ['signInWithPassword 200', 'delete 400']);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);
});

test('deleteAccount(): an account already deleted (an answer that was lost) is forgotten here', async () => {
  let a = await signedIn();
  mock.deleteUser(EMAIL);
  let from = mock.log.length;
  assert.deepEqual(await a.account.deleteAccount(PASSWORD, { eraseData: async () => assert.fail('nothing to erase') }), { ok: true });
  assert.deepEqual(ops(from), ['signInWithPassword 400', 'token 400']);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
  assert.equal(fs.existsSync(a.file), false);

  // Known to be deleted already: no network call at all.
  mock.reset();
  a = await signedIn();
  mock.deleteUser(EMAIL);
  await assert.rejects(a.account.getIdToken({ force: true }), { code: 'USER_NOT_FOUND' });
  from = mock.log.length;
  assert.deepEqual(await a.account.deleteAccount(PASSWORD), { ok: true });
  assert.deepEqual(ops(from), []);
  assert.deepEqual(a.account.state(), { status: 'signed-out' });
});

test('nothing logged ever holds an email, a password or a token', () => {
  assert.ok(lines.length > 0);
  for (const line of lines) assert.doesNotMatch(line, /example\.com|correct horse|AMf-|eyJ|wrong/);
});
