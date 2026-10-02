'use strict';
// loadConfig(): when accounts are on, which overrides count, and where tokens may be kept.
// Every case passes its own projectFile, so the real src/cloud/project.json is never read.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('node:util');
const { loadConfig } = require('../../src/cloud/config');

const FAKE_KEY = `AIzaFAKE${'0'.repeat(31)}`; // the right shape, not a real key
const PROJECT = {
  projectId: 'recaller-test', apiKey: FAKE_KEY, storageBucket: 'recaller-test-data',
  authDomain: 'recaller-test.firebaseapp.com', region: 'us-east1',
};
const REAL = {
  identity: 'https://identitytoolkit.googleapis.com/v1',
  token: 'https://securetoken.googleapis.com/v1',
  firestore: 'https://firestore.googleapis.com/v1',
  storage: 'https://firebasestorage.googleapis.com/v0',
};
const BASE = 'http://127.0.0.1:4567';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-config-test-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function file(name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}
const VALID = file('valid.json', PROJECT);
const MISSING = path.join(dir, 'missing.json');

// Runs fn with console.warn captured, so refused overrides can be checked and stay quiet.
function withWarnings(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    return { value: fn(), lines };
  } finally {
    console.warn = original;
  }
}

const load = (opts) => withWarnings(() => loadConfig(opts)).value;

test('enabled truth table', () => {
  const rows = [
    // packaged, projectFile, env, enabled, reason, mock
    [true, VALID, {}, true, 'ok', false],
    [true, VALID, { RECALLER_DATA_DIR: '/tmp/x' }, false, 'test-data-dir', false],
    [true, VALID, { RECALLER_DATA_DIR: '/tmp/x', RECALLER_GCP_REAL: '1' }, false, 'test-data-dir', false],
    [true, VALID, { RECALLER_DATA_DIR: '/tmp/x', RECALLER_GCP_BASE: BASE }, false, 'test-data-dir', false],
    [true, MISSING, {}, false, 'no-config', false],
    [true, MISSING, { RECALLER_GCP_BASE: BASE }, false, 'no-config', false],
    [false, VALID, {}, true, 'ok', false],
    [false, VALID, { RECALLER_DATA_DIR: '/tmp/x' }, false, 'test-data-dir', false],
    [false, VALID, { RECALLER_DATA_DIR: '/tmp/x', RECALLER_GCP_REAL: '1' }, true, 'ok', false],
    [false, VALID, { RECALLER_DATA_DIR: '/tmp/x', RECALLER_GCP_REAL: 'true' }, false, 'test-data-dir', false],
    [false, VALID, { RECALLER_DATA_DIR: '' }, true, 'ok', false],
    [false, MISSING, {}, false, 'no-config', false],
    [false, MISSING, { RECALLER_DATA_DIR: '/tmp/x', RECALLER_GCP_REAL: '1' }, false, 'no-config', false],
    [false, MISSING, { RECALLER_GCP_BASE: BASE }, true, 'ok', true],
    [false, MISSING, { RECALLER_GCP_BASE: BASE, RECALLER_DATA_DIR: '/tmp/x' }, true, 'ok', true],
    [false, VALID, { RECALLER_GCP_BASE: BASE, RECALLER_DATA_DIR: '/tmp/x' }, true, 'ok', true],
    [false, MISSING, { RECALLER_GCP_BASE: 'http://example.com:4567', RECALLER_DATA_DIR: '/tmp/x' }, false, 'no-config', false],
  ];
  for (const [isPackaged, projectFile, env, enabled, reason, mock] of rows) {
    const c = load({ env, isPackaged, projectFile });
    const label = JSON.stringify({ isPackaged, projectFile: path.basename(projectFile), env });
    assert.equal(c.enabled, enabled, label);
    assert.equal(c.reason, reason, label);
    assert.equal(c.mock, mock, label);
  }
});

test('a packaged app ignores every override', () => {
  const env = {
    RECALLER_GCP_BASE: BASE, RECALLER_GCP_PROJECT: 'other', RECALLER_GCP_BUCKET: 'other.test',
    RECALLER_GCP_API_KEY: 'other-key', RECALLER_GCP_REAL: '1', RECALLER_TOKEN_STORE: 'test-file',
    RECALLER_SYNC_FAST: '1', RECALLER_SYNC_OFFLINE: '1',
  };
  const { value: c, lines } = withWarnings(() => loadConfig({ env, isPackaged: true, projectFile: VALID }));
  assert.equal(c.enabled, true);
  assert.equal(c.mock, false);
  assert.deepEqual(c.endpoints, REAL);
  assert.equal(c.projectId, 'recaller-test');
  assert.equal(c.bucket, 'recaller-test-data');
  assert.equal(c.apiKey, FAKE_KEY);
  assert.equal(c.tokenStore, 'secure');
  assert.equal(c.fast, false);
  assert.equal(c.offline, false);
  assert.deepEqual(lines, []);
});

test('the real project comes from project.json', () => {
  const c = load({ env: {}, isPackaged: false, projectFile: VALID });
  assert.deepEqual(
    { projectId: c.projectId, apiKey: c.apiKey, bucket: c.bucket, authDomain: c.authDomain, region: c.region },
    { projectId: 'recaller-test', apiKey: FAKE_KEY, bucket: 'recaller-test-data', authDomain: 'recaller-test.firebaseapp.com', region: 'us-east1' },
  );
  assert.deepEqual(c.endpoints, REAL);
  for (const url of Object.values(c.endpoints)) assert.doesNotMatch(url, /\/$/);
});

test('project overrides apply only to the mock', () => {
  const c = load({ env: { RECALLER_GCP_PROJECT: 'other', RECALLER_GCP_API_KEY: 'k' }, isPackaged: false, projectFile: VALID });
  assert.equal(c.mock, false);
  assert.equal(c.projectId, 'recaller-test');
  assert.equal(c.apiKey, FAKE_KEY);
});

test('a loopback mock base routes every service to it', () => {
  const c = load({ env: { RECALLER_GCP_BASE: BASE }, isPackaged: false, projectFile: MISSING });
  assert.deepEqual(c.endpoints, {
    identity: `${BASE}/identitytoolkit.googleapis.com/v1`,
    token: `${BASE}/securetoken.googleapis.com/v1`,
    firestore: `${BASE}/firestore.googleapis.com/v1`,
    storage: `${BASE}/firebasestorage.googleapis.com/v0`,
  });
  assert.equal(c.projectId, 'demo-recaller');
  assert.equal(c.bucket, 'demo-recaller.test');
  assert.equal(c.apiKey, 'mock-key');
  assert.equal(c.authDomain, 'demo-recaller.firebaseapp.com');

  const named = load({
    env: { RECALLER_GCP_BASE: 'http://localhost:9/', RECALLER_GCP_PROJECT: 'p-1', RECALLER_GCP_BUCKET: 'b.test', RECALLER_GCP_API_KEY: 'k' },
    isPackaged: false,
    projectFile: MISSING,
  });
  assert.equal(named.mock, true);
  assert.equal(named.endpoints.firestore, 'http://localhost:9/firestore.googleapis.com/v1');
  assert.deepEqual([named.projectId, named.bucket, named.apiKey], ['p-1', 'b.test', 'k']);
});

test('a mock never reads project.json', () => {
  const bad = file('unreadable-for-mock.json', '{ not json');
  const { value: c, lines } = withWarnings(() => loadConfig({ env: { RECALLER_GCP_BASE: BASE }, isPackaged: false, projectFile: bad }));
  assert.equal(c.enabled, true);
  assert.deepEqual(lines, []);
});

test('a non-loopback base is refused with a log line', () => {
  const refused = [
    'http://example.com:4567', 'https://127.0.0.1:4567', 'http://127.0.0.2:4567', 'http://127.0.0.1',
    'http://localhost', 'http://127.0.0.1:4567/path', 'http://127.0.0.1:4567?x=1', 'http://user:pw@127.0.0.1:4567',
    'http://[::1]:4567', 'http://localhost.example.com:4567', 'http://0.0.0.0:4567', 'ftp://127.0.0.1:21',
    'http://127.0.0.1:0', 'http://127.0.0.1:70000', '127.0.0.1:4567',
  ];
  for (const value of refused) {
    const { value: c, lines } = withWarnings(() => loadConfig({ env: { RECALLER_GCP_BASE: value }, isPackaged: false, projectFile: VALID }));
    assert.equal(c.mock, false, value);
    assert.deepEqual(c.endpoints, REAL, value);
    assert.equal(c.projectId, 'recaller-test', value);
    // One fixed line: the refused value itself is never echoed.
    assert.deepEqual(lines, ['[cloud] RECALLER_GCP_BASE ignored: only http://127.0.0.1:PORT or http://localhost:PORT is allowed'], value);
  }
});

test('token store defaults', () => {
  const rows = [
    // packaged, env, expected
    [true, {}, 'secure'],
    [true, { RECALLER_TOKEN_STORE: 'memory' }, 'secure'],
    [true, { RECALLER_TOKEN_STORE: 'test-file', RECALLER_GCP_BASE: BASE }, 'secure'],
    [false, {}, 'memory'],
    [false, { RECALLER_TOKEN_STORE: 'secure' }, 'secure'],
    [false, { RECALLER_TOKEN_STORE: 'memory' }, 'memory'],
    [false, { RECALLER_TOKEN_STORE: 'test-file' }, 'memory'],
    [false, { RECALLER_TOKEN_STORE: 'test-file', RECALLER_GCP_BASE: BASE }, 'test-file'],
    [false, { RECALLER_TOKEN_STORE: 'test-file', RECALLER_GCP_BASE: 'http://example.com:1' }, 'memory'],
    [false, { RECALLER_GCP_BASE: BASE }, 'memory'],
    [false, { RECALLER_TOKEN_STORE: 'plain' }, 'memory'],
    [false, { RECALLER_TOKEN_STORE: 'SECURE' }, 'memory'],
  ];
  for (const [isPackaged, env, expected] of rows) {
    assert.equal(load({ env, isPackaged, projectFile: VALID }).tokenStore, expected, JSON.stringify({ isPackaged, env }));
  }
});

test('fast and offline switches only from source, and only with 1', () => {
  const on = load({ env: { RECALLER_SYNC_FAST: '1', RECALLER_SYNC_OFFLINE: '1' }, isPackaged: false, projectFile: VALID });
  assert.equal(on.fast, true);
  assert.equal(on.offline, true);
  const off = load({ env: { RECALLER_SYNC_FAST: 'true', RECALLER_SYNC_OFFLINE: '0' }, isPackaged: false, projectFile: VALID });
  assert.equal(off.fast, false);
  assert.equal(off.offline, false);
  const packaged = load({ env: { RECALLER_SYNC_FAST: '1', RECALLER_SYNC_OFFLINE: '1' }, isPackaged: true, projectFile: VALID });
  assert.equal(packaged.fast, false);
  assert.equal(packaged.offline, false);
});

test('project.json must be valid', () => {
  const invalid = {
    'not-json': '{ "projectId": ',
    'not-object': '"recaller-test"',
    'bad-id': { ...PROJECT, projectId: 'Recaller_Test' },
    'short-id': { ...PROJECT, projectId: 'abc' },
    'bad-key': { ...PROJECT, apiKey: 'AIzaTooShort' },
    'no-bucket': { ...PROJECT, storageBucket: '' },
    'blank-bucket': { ...PROJECT, storageBucket: '  ' }, // scripts/cloud-config.js --check refuses it too
    'no-domain': { ...PROJECT, authDomain: undefined },
    'no-region': { ...PROJECT, region: 7 },
  };
  for (const [name, content] of Object.entries(invalid)) {
    const { value: c, lines } = withWarnings(() => loadConfig({ env: {}, isPackaged: true, projectFile: file(`${name}.json`, content) }));
    assert.equal(c.enabled, false, name);
    assert.equal(c.reason, 'no-config', name);
    assert.equal(c.apiKey, '', name);
    assert.equal(lines.length, 1, name);
    assert.ok(!lines[0].includes('AIza'), 'nothing from the file is logged');
  }
  const { lines } = withWarnings(() => loadConfig({ env: {}, isPackaged: true, projectFile: MISSING }));
  assert.deepEqual(lines, [], 'a build without config is silent');
});

test('printing the config hides the API key', () => {
  const c = load({ env: {}, isPackaged: true, projectFile: VALID });
  assert.equal(c.apiKey, FAKE_KEY);
  const printed = inspect(c, { depth: 5 });
  assert.ok(!printed.includes(FAKE_KEY));
  assert.match(printed, /\(hidden\)/);
  assert.match(printed, /recaller-test-data/);
  assert.deepEqual(Object.keys({ ...c }).sort(), [
    'apiKey', 'authDomain', 'bucket', 'enabled', 'endpoints', 'fast', 'mock', 'offline', 'projectId', 'reason', 'region', 'tokenStore',
  ]);
});
