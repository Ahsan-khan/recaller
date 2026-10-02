'use strict';
// createTokenStore() (ai_memory/15, 3.3–3.5, D17) with a fake safeStorage: a sealed token never appears as
// plain text and never as { plain }, a refused or throwing seal keeps the sign-in for the session only,
// 'memory' writes nothing, 'test-file' never calls safeStorage and is only for the mock in a run from source,
// and a file written for another cloud project is ignored.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../src/store');
const { createTokenStore } = require('../../src/cloud/tokens');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-tokens-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let cases = 0;
const syncDir = () => path.join(root, `case-${++cases}`, 'sync'); // not created: save() makes it

const TOKEN = 'AMf-refresh-0123456789abcdefghij';
const EMAIL = 'alice@example.com';
const PROJECT = 'demo-recaller';
const CONFIG = { projectId: PROJECT, mock: true };
const SIGN_IN = {
  uid: 'uid-alice', email: EMAIL, emailVerified: true, refreshToken: TOKEN, privacyVersion: '2026-10-01', signedInAt: 1759312800000,
};
const lines = []; // every warning from every store here; checked for secrets at the end
const log = { warn: (...a) => lines.push(a.join(' ')), log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };

// A stand-in for Electron's safeStorage. "Sealing" flips every bit pattern, so a sealed token never holds its text.
function fakeSafeStorage({
  available = true, availableThrows = false, encryptThrows = false, emptySeal = false, decryptThrows = false, backend = 'gnome_libsecret',
} = {}) {
  const calls = [];
  const flip = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a));
  return {
    calls,
    isEncryptionAvailable() {
      calls.push('isEncryptionAvailable');
      if (availableThrows) throw new Error('safeStorage is not ready');
      return available;
    },
    getSelectedStorageBackend() {
      calls.push('getSelectedStorageBackend');
      return backend;
    },
    encryptString(text) {
      calls.push('encryptString');
      if (encryptThrows) throw new Error('the keychain said no');
      if (emptySeal) return Buffer.alloc(0);
      return Buffer.concat([Buffer.from('v10'), flip(Buffer.from(text, 'utf8'))]);
    },
    decryptString(buf) {
      calls.push('decryptString');
      if (decryptThrows) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return flip(buf.subarray(3)).toString('utf8');
    },
  };
}

// Any call fails the test.
function tripwire() {
  const touched = [];
  const trip = (name) => () => {
    touched.push(name);
    throw new Error(`safeStorage.${name} must not be called`);
  };
  return {
    touched,
    isEncryptionAvailable: trip('isEncryptionAvailable'),
    getSelectedStorageBackend: trip('getSelectedStorageBackend'),
    encryptString: trip('encryptString'),
    decryptString: trip('decryptString'),
  };
}

const fileOf = (dir) => path.join(dir, 'account.json');
const raw = (dir) => fs.readFileSync(fileOf(dir), 'utf8');
const json = (dir) => JSON.parse(raw(dir));
const make = (opts) => createTokenStore({ config: CONFIG, platform: 'darwin', log, ...opts });

test('secure: the refresh token is sealed with safeStorage and never written as text', () => {
  for (const [platform, keyStore] of [['darwin', 'keychain'], ['win32', 'dpapi'], ['linux', 'keychain']]) {
    const dir = syncDir();
    const safe = fakeSafeStorage();
    const tokens = make({ dir, mode: 'secure', safeStorage: safe, platform });
    assert.equal(tokens.mode, 'secure');
    assert.equal(tokens.save(SIGN_IN), keyStore);
    assert.ok(safe.calls.includes('encryptString'));
    const text = raw(dir);
    assert.doesNotMatch(text, new RegExp(TOKEN));
    assert.doesNotMatch(text, /plain/i);
    const saved = json(dir);
    const order = ['version', 'project', 'uid', 'email', 'emailVerified', 'keyStore', 'refresh', 'privacyVersion', 'signedInAt'];
    assert.deepEqual(Object.keys(saved), order, 'the 3.5 shape');
    assert.deepEqual(Object.keys(saved.refresh), ['enc']);
    assert.deepEqual({ ...saved, refresh: null }, {
      version: 1, project: PROJECT, uid: 'uid-alice', email: EMAIL, emailVerified: true, keyStore, refresh: null,
      privacyVersion: '2026-10-01', signedInAt: 1759312800000,
    });
    assert.deepEqual(tokens.load(), {
      uid: 'uid-alice', email: EMAIL, emailVerified: true, refreshToken: TOKEN, keyStore, project: PROJECT,
      privacyVersion: '2026-10-01', signedInAt: 1759312800000,
    });
    assert.ok(safe.calls.includes('decryptString'));
  }
});

test('secure: no encryption, or a seal that throws, keeps the sign-in for this session only', () => {
  const rows = [
    ['darwin', { available: false }],
    ['darwin', { availableThrows: true }],
    ['win32', { encryptThrows: true }],
    ['darwin', { emptySeal: true }], // nothing sealed is nothing kept
    ['linux', { backend: 'basic_text' }], // a fixed key isn't a secure store
  ];
  for (const [platform, opts] of rows) {
    const dir = syncDir();
    const safe = fakeSafeStorage(opts);
    const tokens = make({ dir, mode: 'secure', safeStorage: safe, platform });
    assert.equal(tokens.save(SIGN_IN), 'session', platform);
    const saved = json(dir);
    assert.equal(saved.refresh, null);
    assert.equal(saved.keyStore, 'session');
    assert.doesNotMatch(raw(dir), new RegExp(TOKEN));
    if (opts.available === false || opts.availableThrows || opts.backend) assert.ok(!safe.calls.includes('encryptString'));
    const loaded = tokens.load();
    assert.equal(loaded.refreshToken, null);
    assert.equal(loaded.keyStore, 'session');
    assert.equal(loaded.uid, 'uid-alice');
  }
  // No safeStorage at all is the same.
  const dir = syncDir();
  assert.equal(make({ dir, mode: 'secure' }).save(SIGN_IN), 'session');
  assert.equal(json(dir).refresh, null);
});

test('secure: a token that can\'t be unsealed, or one written as text, reads as no token', () => {
  const dir = syncDir();
  make({ dir, mode: 'secure', safeStorage: fakeSafeStorage() }).save(SIGN_IN);
  assert.equal(make({ dir, mode: 'secure', safeStorage: fakeSafeStorage({ decryptThrows: true }) }).load().refreshToken, null);
  assert.equal(make({ dir, mode: 'secure', safeStorage: fakeSafeStorage({ available: false }) }).load().refreshToken, null);
  assert.equal(make({ dir, mode: 'secure' }).load().refreshToken, null);

  for (const refresh of [{ plain: TOKEN }, { testPlain: TOKEN }, { enc: '' }, 'AMf-text', [TOKEN]]) {
    const other = syncDir();
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(fileOf(other), JSON.stringify({ ...json(dir), refresh }));
    const safe = fakeSafeStorage();
    const loaded = make({ dir: other, mode: 'secure', safeStorage: safe }).load();
    assert.equal(loaded.refreshToken, null, JSON.stringify(refresh));
    assert.equal(loaded.keyStore, 'session');
    assert.ok(!safe.calls.includes('decryptString'));
  }
});

test('secure: signed out, or kept for the session only, the next start never asks the keychain', () => {
  const dir = syncDir();
  const safe = tripwire();
  const tokens = make({ dir, mode: 'secure', safeStorage: safe });
  assert.equal(tokens.load(), null);
  tokens.clear();
  assert.equal(fs.existsSync(path.dirname(dir)), false);
  make({ dir, mode: 'secure', safeStorage: fakeSafeStorage({ available: false }) }).save(SIGN_IN);
  const loaded = tokens.load();
  assert.deepEqual([loaded.uid, loaded.refreshToken, loaded.keyStore], ['uid-alice', null, 'session']);
  tokens.clear();
  assert.equal(fs.existsSync(fileOf(dir)), false);
  assert.deepEqual(safe.touched, []);
});

test('memory: nothing is written or removed, and safeStorage is never touched', () => {
  const dir = syncDir();
  const safe = tripwire();
  const tokens = make({ dir, mode: 'memory', safeStorage: safe });
  assert.equal(tokens.mode, 'memory');
  assert.equal(tokens.save(SIGN_IN), 'session');
  assert.equal(fs.existsSync(path.dirname(dir)), false);
  assert.equal(tokens.load(), null);
  tokens.clear();

  // A file left by another mode is neither used nor removed.
  make({ dir, mode: 'test-file' }).save(SIGN_IN);
  const before = raw(dir);
  assert.equal(tokens.load(), null);
  tokens.clear();
  assert.equal(raw(dir), before);
  assert.deepEqual(safe.touched, []);

  // An unknown mode is memory too.
  assert.equal(make({ dir, mode: 'keychain-please' }).mode, 'memory');
});

test('test-file: a readable token for the loopback mock, and safeStorage is never called', () => {
  const dir = syncDir();
  const safe = tripwire();
  const tokens = make({ dir, mode: 'test-file', safeStorage: safe });
  assert.equal(tokens.mode, 'test-file');
  assert.equal(tokens.save(SIGN_IN), 'test');
  assert.deepEqual(json(dir).refresh, { testPlain: TOKEN });
  assert.equal(json(dir).keyStore, 'test');
  assert.deepEqual(tokens.load(), {
    uid: 'uid-alice', email: EMAIL, emailVerified: true, refreshToken: TOKEN, keyStore: 'test', project: PROJECT,
    privacyVersion: '2026-10-01', signedInAt: 1759312800000,
  });
  // A sealed token can't be read here, since safeStorage is never asked.
  const sealed = syncDir();
  make({ dir: sealed, mode: 'secure', safeStorage: fakeSafeStorage() }).save(SIGN_IN);
  assert.equal(make({ dir: sealed, mode: 'test-file', safeStorage: safe }).load().refreshToken, null);
  assert.deepEqual(safe.touched, []);
});

test('test-file is refused outside the mock or when packaged: the sign-in stays in memory', () => {
  const before = lines.length;
  for (const opts of [{ config: { projectId: PROJECT, mock: false } }, { isPackaged: true }]) {
    const dir = syncDir();
    const tokens = make({ dir, mode: 'test-file', ...opts });
    assert.equal(tokens.mode, 'memory');
    assert.equal(tokens.save(SIGN_IN), 'session');
    assert.equal(fs.existsSync(path.dirname(dir)), false);
  }
  assert.equal(lines.length - before, 2);
  assert.match(lines.at(-1), /test-file/);
});

test('a file written for another cloud project is ignored, never used', () => {
  const dir = syncDir();
  make({ dir, mode: 'test-file' }).save(SIGN_IN);
  assert.equal(json(dir).project, PROJECT);
  for (const opts of [{ project: 'recaller-cloud' }, { config: { projectId: 'recaller-cloud', mock: true } }]) {
    const before = lines.length;
    assert.equal(make({ dir, mode: 'test-file', ...opts }).load(), null);
    assert.match(lines.at(-1), /another cloud project/);
    assert.equal(lines.length - before, 1);
  }
  assert.ok(fs.existsSync(fileOf(dir)), 'ignored, not removed');
  // A file without a project is another project's too.
  const saved = json(dir);
  delete saved.project;
  fs.writeFileSync(fileOf(dir), JSON.stringify(saved));
  assert.equal(make({ dir, mode: 'test-file' }).load(), null);
  // With no project to compare against, the file is read.
  assert.equal(createTokenStore({ dir, mode: 'test-file', log }).load().refreshToken, TOKEN);
  // A save that names no project is this store's project.
  const tokens = make({ dir, mode: 'test-file' });
  tokens.save({ ...SIGN_IN, project: null });
  assert.equal(json(dir).project, PROJECT);
  assert.equal(tokens.load().refreshToken, TOKEN);
});

test('save() without a refresh token keeps only who was signed in', () => {
  const dir = syncDir();
  const safe = fakeSafeStorage();
  const tokens = make({ dir, mode: 'secure', safeStorage: safe });
  assert.equal(tokens.save({ ...SIGN_IN, refreshToken: null, signedInAt: undefined }), 'session');
  assert.ok(!safe.calls.includes('encryptString'));
  const saved = json(dir);
  assert.equal(saved.refresh, null);
  assert.equal(saved.uid, 'uid-alice');
  assert.ok(Number.isFinite(saved.signedInAt) && saved.signedInAt > 0, 'now() when not given');
  assert.throws(() => tokens.save({ email: EMAIL, refreshToken: TOKEN }), TypeError);
});

test('clear() removes account.json and a temp file a crash left beside it', () => {
  const dir = syncDir();
  const tokens = make({ dir, mode: 'test-file' });
  tokens.save(SIGN_IN);
  fs.writeFileSync(`${fileOf(dir)}.tmp`, '{"half": ');
  tokens.clear();
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(tokens.load(), null);
  tokens.clear(); // nothing there: fine
});

test('writes go through writeJsonAtomic', () => {
  const dir = syncDir();
  const original = store.writeJsonAtomic;
  const calls = [];
  store.writeJsonAtomic = (file, value) => {
    calls.push(file);
    return original(file, value);
  };
  try {
    const tokens = make({ dir, mode: 'secure', safeStorage: fakeSafeStorage() });
    tokens.save(SIGN_IN);
    tokens.save({ ...SIGN_IN, refreshToken: `${TOKEN}-rotated` });
  } finally {
    store.writeJsonAtomic = original;
  }
  assert.deepEqual(calls, [fileOf(dir), fileOf(dir)]);
  assert.deepEqual(fs.readdirSync(dir), ['account.json']);
});

test('a malformed or unreadable account.json reads as null', () => {
  const rows = ['{"uid": ', '[1, 2]', 'null', '"text"', JSON.stringify({ email: EMAIL }), JSON.stringify({ uid: '', email: EMAIL }),
    JSON.stringify({ uid: 'u1', email: 7, project: PROJECT })];
  for (const content of rows) {
    const dir = syncDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileOf(dir), content);
    assert.equal(make({ dir, mode: 'test-file' }).load(), null, content);
  }
  const dir = syncDir();
  fs.mkdirSync(fileOf(dir), { recursive: true }); // a folder where the file should be
  assert.equal(make({ dir, mode: 'test-file' }).load(), null);
});

test('nothing logged ever holds a token or an email', () => {
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.doesNotMatch(line, /AMf-|example\.com|v10/);
  }
});
