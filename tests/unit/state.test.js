'use strict';
// openSyncDir() (ai_memory/15, 3.5): the sync/ folder's files, read defensively and written atomically through
// writeJsonAtomic; this computer's device id (a folder copied from another computer gets its own); and what
// removeAccountState() and removeAll() take away. Nothing exists until something is written.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../src/store');
const { openSyncDir, hostId, deviceName, maskEmail, DEVICE_ID } = require('../../src/sync/state');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-state-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let cases = 0;

// A data folder, as main's userData.
function dataFolder() {
  const dir = path.join(root, `data-${++cases}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const NOW = 1759312800000;
const lines = [];
const log = { warn: (...a) => lines.push(a.join(' ')) };
const open = (userData, opts = {}) => openSyncDir(userData, { hostname: 'pc-a', platform: 'darwin', now: () => NOW, log, ...opts });
const readRaw = (sync, name) => JSON.parse(fs.readFileSync(path.join(sync.dir, name), 'utf8'));
const writeRaw = (sync, name, content) => {
  fs.mkdirSync(sync.dir, { recursive: true });
  fs.writeFileSync(path.join(sync.dir, name), typeof content === 'string' ? content : JSON.stringify(content));
};

const STATE = {
  version: 1, uid: 'u1', rev: 57, headUpdateTime: '2026-10-01T10:00:00.123456Z', minRev: 0, mode: 'normal', seeded: false,
  dataFile: { sha256: 'ab'.repeat(32), bytes: 123456 }, uploaded: { ['c'.repeat(32)]: 3 },
  quarantine: { 'note:n1': { code: 'PERMISSION', sig: 's1', at: 5 } }, labels: ['Delete note'], choice: null,
  lastPullAt: 1, lastPushAt: 2, lastAuditAt: 3, lastIncomingBackupAt: 4, deletion: null,
};
const SHADOW = {
  version: 1, uid: 'u1', rev: 12, board: { joiner: 'blank' },
  projects: { p1: { f: { name: 'Work' }, k: 'a0', r: 3, u: '2026-10-01T10:00:00.000001Z', d: false, i: 'p1' } },
  notes: { n1: { f: { text: 'hello' }, p: 'p1', l: 'notes', k: 'a0', r: 4, u: null, d: false, i: 'n1', c: 2, lc: 9 } },
};

test('nothing exists until something is written, and missing files read as null', () => {
  const userData = dataFolder();
  const sync = open(userData);
  assert.equal(sync.dir, path.join(userData, 'sync'));
  assert.ok(!sync.dir.split(path.sep).includes('backups'), 'beside the data file, never in a backup');
  assert.equal(sync.readDevice(), null);
  assert.equal(sync.readState(), null);
  assert.equal(sync.readShadow(), null);
  sync.removeAccountState();
  sync.removeAccountState({ keepShadow: true, clearLastUid: true });
  sync.removeAll();
  assert.equal(fs.existsSync(sync.dir), false);
  assert.deepEqual(fs.readdirSync(userData), []);
});

test('ensureDevice() makes this computer\'s record once', () => {
  const sync = open(dataFolder());
  const device = sync.ensureDevice();
  assert.match(device.id, DEVICE_ID);
  assert.deepEqual({ ...device, id: 'x', place: 'x' }, {
    version: 1, id: 'x', name: 'Mac', host: hostId('pc-a', 'darwin'), place: 'x', lastUid: null, lastEmailMasked: null, createdAt: NOW,
  });
  assert.equal(device.host, crypto.createHash('sha256').update('pc-adarwin').digest('hex').slice(0, 16));
  assert.match(device.host, /^[a-f0-9]{16}$/);
  assert.deepEqual(readRaw(sync, 'device.json'), device);
  assert.deepEqual(sync.ensureDevice(), device);
  assert.deepEqual(open(path.dirname(sync.dir)).readDevice(), device);

  assert.equal(open(dataFolder(), { platform: 'win32' }).ensureDevice().name, 'Windows PC');
  assert.deepEqual([deviceName('darwin'), deviceName('win32'), deviceName('linux')], ['Mac', 'Windows PC', 'Linux PC']);
  assert.notEqual(open(dataFolder()).ensureDevice().id, device.id);
});

test('writeDevice() keeps lastUid and fields from newer versions, and stamps this host', () => {
  const sync = open(dataFolder());
  const device = sync.ensureDevice();
  const written = sync.writeDevice({ ...device, lastUid: 'u1', lastEmailMasked: 'a•••@example.com', future: { x: 1 } });
  assert.deepEqual(written, { ...device, lastUid: 'u1', lastEmailMasked: 'a•••@example.com', future: { x: 1 } });
  assert.deepEqual(sync.readDevice(), written);
  // A record without a valid id gets a new one rather than a broken file.
  const fresh = sync.writeDevice({ id: 'not-hex', name: '' });
  assert.match(fresh.id, DEVICE_ID);
  assert.equal(fresh.name, 'Mac');
});

test('a folder copied from another computer gets a new device id; the account it synced with stays', () => {
  const pc = dataFolder();
  const a = open(pc);
  const original = a.writeDevice({ ...a.ensureDevice(), lastUid: 'u1', lastEmailMasked: 'a•••@example.com' });

  for (const hostname of ['pc-b', 'pc-a']) { // a different host, or one that happens to have the same name
    const copy = dataFolder();
    fs.cpSync(pc, copy, { recursive: true });
    const b = open(copy, { hostname });
    const device = b.readDevice();
    assert.match(device.id, DEVICE_ID);
    assert.notEqual(device.id, original.id, hostname);
    assert.equal(device.host, hostId(hostname, 'darwin'));
    assert.deepEqual([device.lastUid, device.lastEmailMasked, device.createdAt], ['u1', 'a•••@example.com', NOW]);
    assert.deepEqual(readRaw(b, 'device.json'), device, 'kept, so the new id is stable');
    assert.deepEqual(b.readDevice(), device);
    assert.deepEqual(open(copy, { hostname }).readDevice(), device);
  }
  assert.deepEqual(a.readDevice(), original, 'the first computer keeps its id');

  // If the new record can't be written, this run still keeps one id for this computer.
  const copy = dataFolder();
  fs.cpSync(pc, copy, { recursive: true });
  const c = open(copy, { hostname: 'pc-c' });
  const write = store.writeJsonAtomic;
  store.writeJsonAtomic = () => {
    throw Object.assign(new Error('read-only'), { code: 'EROFS' });
  };
  let device;
  try {
    device = c.readDevice();
    assert.notEqual(device.id, original.id);
    assert.deepEqual(c.readDevice(), device);
  } finally {
    store.writeJsonAtomic = write;
  }
  assert.match(lines.at(-1), /device\.json couldn't be written \(EROFS\)/);
  assert.equal(readRaw(c, 'device.json').id, original.id, 'nothing was written');
});

test('a folder copied from a PC to a Mac becomes the Mac\'s record', () => {
  const pc = dataFolder();
  const original = open(pc, { platform: 'win32', hostname: 'DESKTOP-7Q2' }).ensureDevice();
  assert.equal(original.name, 'Windows PC');
  const mac = dataFolder();
  fs.cpSync(pc, mac, { recursive: true });
  const device = open(mac, { platform: 'darwin', hostname: 'Ahsans-MacBook-Pro.local' }).readDevice();
  assert.notEqual(device.id, original.id);
  assert.deepEqual([device.name, device.host], ['Mac', hostId('Ahsans-MacBook-Pro.local', 'darwin')]);
});

test('the host decides for a record that doesn\'t know its folder; a renamed host keeps the folder\'s id', () => {
  // The spec's shape of device.json (no folder stamp).
  const userData = dataFolder();
  const sync = open(userData);
  const id = 'd'.repeat(32);
  writeRaw(sync, 'device.json', {
    version: 1, id, name: 'Mac', host: hostId('pc-a', 'darwin'), lastUid: 'u1', lastEmailMasked: null, createdAt: 5,
  });
  assert.equal(sync.readDevice().id, id);
  const elsewhere = open(userData, { hostname: 'pc-b' }).readDevice();
  assert.notEqual(elsewhere.id, id);
  assert.equal(elsewhere.lastUid, 'u1');

  // A Mac's hostname changes with the network; the folder is the same, and so is the id.
  const mac = open(dataFolder(), { hostname: 'Ahsans-MacBook-Pro.local' });
  const device = mac.ensureDevice();
  assert.equal(open(path.dirname(mac.dir), { hostname: '192-168-1-23.home' }).readDevice().id, device.id);
});

test('device.json is read defensively', () => {
  const sync = open(dataFolder());
  for (const content of ['{"id": ', '[]', JSON.stringify({ id: 'short' }), JSON.stringify({ id: 'D'.repeat(32) })]) {
    writeRaw(sync, 'device.json', content);
    assert.equal(sync.readDevice(), null, content);
  }
  const device = sync.ensureDevice(); // replaces the unusable file
  assert.match(device.id, DEVICE_ID);
  writeRaw(sync, 'device.json', { ...device, name: 7, lastUid: 3, lastEmailMasked: '', createdAt: 'yesterday' });
  assert.deepEqual(sync.readDevice(), { ...device, name: 'Mac', lastUid: null, lastEmailMasked: null, createdAt: 0 });
});

test('every file goes through writeJsonAtomic, and a crash before the rename leaves the last good file', () => {
  const sync = open(dataFolder());
  const original = store.writeJsonAtomic;
  const calls = [];
  store.writeJsonAtomic = (file, value) => {
    calls.push(path.basename(file));
    return original(file, value);
  };
  try {
    sync.ensureDevice();
    sync.writeState(STATE);
    sync.writeShadow(SHADOW);
  } finally {
    store.writeJsonAtomic = original;
  }
  assert.deepEqual(calls, ['device.json', 'state.json', 'shadow.json']);
  assert.deepEqual(fs.readdirSync(sync.dir).sort(), ['device.json', 'shadow.json', 'state.json']);
  assert.deepEqual(sync.readState(), STATE);
  assert.deepEqual(sync.readShadow(), SHADOW);

  // The temp file is written, then the process dies before the rename.
  store.writeJsonAtomic = (file) => {
    fs.writeFileSync(`${file}.tmp`, '{"version": 1, "rev": 58, "mo');
    throw new Error('crash');
  };
  try {
    assert.throws(() => sync.writeState({ ...STATE, rev: 58 }), /crash/);
  } finally {
    store.writeJsonAtomic = original;
  }
  assert.deepEqual(sync.readState(), STATE, 'the last good state.json');
  sync.writeState({ ...STATE, rev: 58 });
  assert.equal(sync.readState().rev, 58);
  assert.deepEqual(fs.readdirSync(sync.dir).sort(), ['device.json', 'shadow.json', 'state.json']);
});

test('state.json: odd fields fall back to safe values, and unknown ones are kept', () => {
  const sync = open(dataFolder());
  const img = 'f'.repeat(32);
  writeRaw(sync, 'state.json', `{
    "version": 1, "uid": "", "rev": -3, "headUpdateTime": 7, "minRev": 1.5, "mode": "weird", "seeded": "yes",
    "dataFile": { "sha256": "ab", "bytes": -1 },
    "uploaded": { "${img}": 3, "bad": "x", "zero": 0, "__proto__": 1 },
    "quarantine": { "note:a": { "code": "TOO_LARGE", "sig": "s", "at": 1 }, "note:b": 5 },
    "labels": ["Delete note", 7, null], "choice": [], "lastPullAt": "now", "lastPushAt": -5,
    "deletion": { "startedAt": "x" }, "ack": { "patchId": "p1", "H": 9, "ackedAt": 3 }
  }`);
  const state = sync.readState();
  const uploaded = { [img]: 3 };
  Object.defineProperty(uploaded, '__proto__', { value: 1, enumerable: true, writable: true, configurable: true });
  assert.deepEqual(state, {
    version: 1, uid: null, rev: 0, headUpdateTime: null, minRev: 0, mode: 'union', seeded: false, dataFile: null,
    uploaded, quarantine: { 'note:a': { code: 'TOO_LARGE', sig: 's', at: 1 } }, labels: ['Delete note'], choice: null,
    lastPullAt: 0, lastPushAt: 0, lastAuditAt: 0, lastIncomingBackupAt: 0, deletion: { startedAt: 0 },
    ack: { patchId: 'p1', H: 9, ackedAt: 3 },
  });
  assert.equal(Object.getPrototypeOf(state.uploaded), Object.prototype, 'a "__proto__" key never becomes a prototype');
  assert.equal({}.polluted, undefined);

  // A missing mode means "unsure": union, which never pushes a deletion.
  writeRaw(sync, 'state.json', { uid: 'u1', rev: 3 });
  assert.deepEqual([sync.readState().mode, sync.readState().rev, sync.readState().version], ['union', 3, 1]);

  const before = lines.length;
  for (const content of ['', '{"rev": 5', '[1]', '42', 'null']) {
    writeRaw(sync, 'state.json', content);
    assert.equal(sync.readState(), null, JSON.stringify(content));
  }
  assert.equal(lines.length - before, 5);
  assert.ok(lines.slice(before).every((line) => line === '[sync] state.json is unreadable; ignoring it'));
  fs.rmSync(path.join(sync.dir, 'state.json'));
  fs.mkdirSync(path.join(sync.dir, 'state.json'));
  assert.equal(sync.readState(), null);
  assert.throws(() => sync.writeState(null), TypeError);
});

test('shadow.json: read defensively, with ids such as __proto__ kept safely; writeShadow takes maps too', () => {
  const sync = open(dataFolder());
  writeRaw(sync, 'shadow.json', `{
    "uid": "u1", "rev": "12", "board": { "joiner": 3 },
    "projects": { "p1": ${JSON.stringify(SHADOW.projects.p1)}, "p2": "broken" },
    "notes": { "__proto__": { "f": { "text": "odd id" }, "p": "p1", "l": "notes", "k": "a1", "r": 5 }, "n2": [] },
    "extra": true
  }`);
  const shadow = sync.readShadow();
  assert.deepEqual(Object.keys(shadow.projects), ['p1']);
  assert.deepEqual(Object.keys(shadow.notes), ['__proto__']);
  assert.equal(Object.getPrototypeOf(shadow.notes), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(shadow.notes, '__proto__').value.f.text, 'odd id');
  assert.deepEqual([shadow.version, shadow.uid, shadow.rev, shadow.board, shadow.extra], [1, 'u1', 0, { joiner: null }, true]);

  sync.writeShadow(shadow);
  assert.deepEqual(Object.keys(readRaw(sync, 'shadow.json').notes), ['__proto__']);

  sync.writeShadow({ ...SHADOW, projects: new Map(Object.entries(SHADOW.projects)), notes: new Map(Object.entries(SHADOW.notes)) });
  assert.deepEqual(sync.readShadow(), SHADOW);
  assert.deepEqual(readRaw(sync, 'shadow.json'), SHADOW);
  assert.throws(() => sync.writeShadow('x'), TypeError);
  writeRaw(sync, 'shadow.json', '{"version": 1, "notes": {');
  assert.equal(sync.readShadow(), null);
});

test('removeAccountState(): state.json goes, shadow.json too unless keepShadow; device.json and account.json stay', () => {
  const sync = open(dataFolder());
  const device = sync.writeDevice({ ...sync.ensureDevice(), lastUid: 'u1', lastEmailMasked: 'a•••@example.com' });
  sync.writeState(STATE);
  sync.writeShadow(SHADOW);
  writeRaw(sync, 'account.json', { version: 1, uid: 'u1' });
  writeRaw(sync, 'state.json.tmp', '{"half"');
  writeRaw(sync, 'shadow.json.tmp', '{"half"');

  sync.removeAccountState({ keepShadow: true });
  assert.deepEqual(fs.readdirSync(sync.dir).sort(), ['account.json', 'device.json', 'shadow.json', 'shadow.json.tmp']);
  assert.equal(sync.readState(), null);
  assert.deepEqual(sync.readShadow(), SHADOW);

  sync.removeAccountState();
  assert.deepEqual(fs.readdirSync(sync.dir).sort(), ['account.json', 'device.json']);
  assert.deepEqual(sync.readDevice(), device, 'the account this computer last synced with stays (5.14 step 4)');

  sync.removeAccountState({ clearLastUid: true }); // the board was removed, or the account deleted
  assert.deepEqual(sync.readDevice(), { ...device, lastUid: null, lastEmailMasked: null });
});

test('removeAll(): the sync folder goes; the data folder and its files stay', () => {
  const userData = dataFolder();
  fs.writeFileSync(path.join(userData, 'recaller-data.json'), '{"projects": []}');
  const sync = open(userData);
  sync.ensureDevice();
  sync.writeState(STATE);
  writeRaw(sync, 'account.json', { version: 1 });
  sync.removeAll();
  assert.equal(fs.existsSync(sync.dir), false);
  assert.deepEqual(fs.readdirSync(userData), ['recaller-data.json']);
  assert.equal(sync.readDevice(), null);
  assert.notEqual(sync.ensureDevice().id, undefined);
});

test('maskEmail()', () => {
  assert.equal(maskEmail('ahsan@ponders.ai'), 'a•••@ponders.ai');
  assert.equal(maskEmail('A.Long+Tag@Example.com'), 'A•••@Example.com');
  assert.equal(maskEmail('😀x@example.com'), '😀•••@example.com');
  for (const bad of ['', '@example.com', 'nobody@', 'plain', null, 7]) assert.equal(maskEmail(bad), null, String(bad));
});
