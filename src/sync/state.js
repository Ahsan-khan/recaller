'use strict';
// The sync/ folder beside the data file (ai_memory/15, 3.5): device.json (this computer), state.json (where
// sync stands) and shadow.json (the board as last synced); account.json belongs to src/cloud/tokens.js.
// None of it exists while signed out. Every file is read defensively (missing, unreadable or malformed
// reads as null, and odd fields fall back to safe values; unknown fields are kept) and written atomically
// through writeJsonAtomic. The folder is never part of a backup: backups copy only the data and settings
// files, so restoring one never rewinds sync.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');

const DEVICE_ID = /^[a-f0-9]{32}$/;
const MODES = new Set(['normal', 'union', 'restore', 'first']);
const NAMES = { darwin: 'Mac', win32: 'Windows PC', linux: 'Linux PC' };
const RM = { force: true, recursive: true, maxRetries: 3, retryDelay: 25 };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const time = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

// Ids come from the data file, so '__proto__' is a possible key: define it, never assign it.
function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  else obj[k] = v;
  return obj;
}

// The own entries of a plain object (or a Map) whose values pass keep().
function entries(src, keep) {
  const out = {};
  if (src instanceof Map) {
    for (const [k, v] of src) if (typeof k === 'string' && keep(v)) put(out, k, v);
  } else if (isObj(src)) {
    for (const k of Object.keys(src)) if (keep(src[k])) put(out, k, src[k]);
  }
  return out;
}

// "<16 hex of sha256(hostname+platform)>" (3.5).
const hostId = (hostname, platform) => crypto.createHash('sha256').update(`${hostname}${platform}`).digest('hex').slice(0, 16);
const deviceName = (platform) => NAMES[platform] || 'Computer';
const newDeviceId = () => crypto.randomBytes(16).toString('hex');

// "a•••@gmail.com", for device.lastEmailMasked and the other-account warning.
function maskEmail(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return `${[...email.slice(0, at)][0]}•••${email.slice(at)}`;
}

function openSyncDir(userData, { hostname = os.hostname, platform = process.platform, now = Date.now, log = console } = {}) {
  if (typeof userData !== 'string' || !userData) throw new TypeError('openSyncDir needs the data folder');
  const dir = path.join(userData, 'sync');
  const file = (name) => path.join(dir, name);
  let replaced = null; // { from, record }: this computer's own id, when the folder came from another one

  function here() {
    let name = '';
    try {
      name = String(typeof hostname === 'function' ? hostname() : hostname);
    } catch {}
    return hostId(name, platform);
  }

  // The folder itself, as its inode and birth time: a copy (another computer, a restore) gets new ones, while
  // a renamed host leaves them alone (a Mac's hostname can change with the network). null where unknown.
  function place() {
    try {
      const st = fs.statSync(dir, { bigint: true });
      return st.ino > 0n ? `${st.ino}:${st.birthtimeMs}` : null;
    } catch {
      return null;
    }
  }

  function readJson(name) {
    let text;
    try {
      text = fs.readFileSync(file(name), 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') log.warn(`[sync] ${name} couldn't be read (${err?.code || 'error'}); ignoring it`);
      return null;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {}
    if (isObj(value)) return value;
    log.warn(`[sync] ${name} is unreadable; ignoring it`);
    return null;
  }

  function writeJson(name, value) {
    fs.mkdirSync(dir, { recursive: true });
    store.writeJsonAtomic(file(name), value);
    return value;
  }

  // ---- device.json

  function deviceRecord(v) {
    const out = {
      version: 1,
      id: v.id,
      name: typeof v.name === 'string' && v.name.trim() && v.name.length <= 60 ? v.name : deviceName(platform),
      host: typeof v.host === 'string' ? v.host : '',
      place: str(v.place),
      lastUid: str(v.lastUid),
      lastEmailMasked: str(v.lastEmailMasked),
      createdAt: time(v.createdAt),
    };
    for (const k of Object.keys(v)) if (!Object.hasOwn(out, k)) put(out, k, v[k]); // a newer version's fields stay
    return out;
  }

  // Writes this computer's record, stamped with its host and folder. → the record written
  function writeDevice(device) {
    const v = isObj(device) ? device : {};
    fs.mkdirSync(dir, { recursive: true });
    const record = deviceRecord({
      ...v,
      id: DEVICE_ID.test(v.id) ? v.id : newDeviceId(),
      createdAt: Number.isFinite(v.createdAt) && v.createdAt > 0 ? v.createdAt : now(),
    });
    record.host = here();
    record.place = place();
    store.writeJsonAtomic(file('device.json'), record);
    return { ...record };
  }

  // This computer's record, or null before the first sign-in. A folder copied from another computer gets a
  // new id at once (3.5), so two computers never write as one device; the account it last synced with stays.
  // Once the record knows its folder, the folder tells a copy apart; before that, the host does (3.5).
  function readDevice() {
    const v = readJson('device.json');
    if (!v || !DEVICE_ID.test(v.id)) return null;
    if (replaced?.from === v.id) return { ...replaced.record };
    const record = deviceRecord(v);
    const where = place();
    const copied = record.place && where ? record.place !== where : record.host !== here();
    if (!copied) return record;
    const fresh = { ...record, id: newDeviceId(), name: deviceName(platform), createdAt: now() };
    try {
      replaced = { from: v.id, record: writeDevice(fresh) };
    } catch (err) {
      log.warn(`[sync] device.json couldn't be written (${err?.code || err?.name || 'error'})`);
      replaced = { from: v.id, record: { ...fresh, host: here(), place: where } };
    }
    return { ...replaced.record };
  }

  function ensureDevice() {
    return readDevice() || writeDevice({ name: deviceName(platform) });
  }

  // ---- state.json

  function stateRecord(v) {
    const s = { version: 1, ...v };
    s.version = 1;
    s.uid = str(v.uid);
    s.rev = count(v.rev);
    s.headUpdateTime = str(v.headUpdateTime);
    s.minRev = count(v.minRev);
    s.mode = MODES.has(v.mode) ? v.mode : 'union'; // unsure where sync stood: never push a deletion from here
    s.seeded = v.seeded === true;
    s.dataFile = isObj(v.dataFile) && typeof v.dataFile.sha256 === 'string' && count(v.dataFile.bytes) === v.dataFile.bytes
      ? { ...v.dataFile } : null;
    s.uploaded = entries(v.uploaded, (bits) => Number.isSafeInteger(bits) && bits > 0);
    s.quarantine = entries(v.quarantine, isObj);
    s.labels = Array.isArray(v.labels) ? v.labels.filter((label) => typeof label === 'string') : [];
    s.choice = isObj(v.choice) ? v.choice : null;
    for (const k of ['lastPullAt', 'lastPushAt', 'lastAuditAt', 'lastIncomingBackupAt']) s[k] = time(v[k]);
    s.deletion = isObj(v.deletion) ? { ...v.deletion, startedAt: time(v.deletion.startedAt) } : null;
    return s;
  }

  function readState() {
    const v = readJson('state.json');
    return v && stateRecord(v);
  }

  function writeState(state) {
    if (!isObj(state)) throw new TypeError('writeState needs an object');
    const out = { version: 1, ...state };
    out.version = 1;
    return writeJson('state.json', out);
  }

  // ---- shadow.json: { version, uid, rev, board: { joiner }, projects: { id: entry }, notes: { id: entry } }

  function shadowRecord(v) {
    const s = { version: 1, ...v };
    s.version = 1;
    s.uid = str(v.uid);
    s.rev = count(v.rev);
    s.board = { ...(isObj(v.board) ? v.board : {}), joiner: typeof v.board?.joiner === 'string' ? v.board.joiner : null };
    s.projects = entries(v.projects, isObj); // each entry is checked where it's used (model.shadowView)
    s.notes = entries(v.notes, isObj);
    return s;
  }

  function readShadow() {
    const v = readJson('shadow.json');
    return v && shadowRecord(v);
  }

  // Takes the shadow.json shape, or model.shadowView's maps.
  function writeShadow(shadow) {
    if (!isObj(shadow)) throw new TypeError('writeShadow needs an object');
    const out = { version: 1, ...shadow };
    out.version = 1;
    for (const kind of ['projects', 'notes']) if (shadow[kind] instanceof Map) out[kind] = entries(shadow[kind], isObj);
    return writeJson('shadow.json', out);
  }

  // ---- removal

  // state.json, and shadow.json unless keepShadow (5.14, 5.15). clearLastUid also forgets which account this
  // computer last synced with (the board was removed, or the account deleted). account.json is the token
  // store's, and device.json stays: it is this computer's id.
  function removeAccountState({ keepShadow = false, clearLastUid = false } = {}) {
    for (const name of keepShadow ? ['state.json'] : ['state.json', 'shadow.json']) {
      fs.rmSync(file(name), RM);
      fs.rmSync(`${file(name)}.tmp`, RM);
    }
    if (!clearLastUid) return;
    const device = readDevice();
    if (device && (device.lastUid !== null || device.lastEmailMasked !== null)) {
      writeDevice({ ...device, lastUid: null, lastEmailMasked: null });
    }
  }

  // The whole sync/ folder, account.json and device.json included. The data folder itself stays.
  function removeAll() {
    fs.rmSync(dir, RM);
    replaced = null;
  }

  return {
    dir, readDevice, writeDevice, ensureDevice, readState, writeState, readShadow, writeShadow, removeAccountState, removeAll,
  };
}

module.exports = { openSyncDir, hostId, deviceName, maskEmail, DEVICE_ID };
