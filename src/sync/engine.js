'use strict';
// The sync engine (ai_memory/15_accounts_and_sync.md, 3.3, 4.6, 4.7, 5.1–5.18), in the main process. The data
// file stays the source of truth: the engine reads it only as main wrote it (onLoadResult, onFileWritten) and
// never writes it. A push is a fast-forward commit that raises the account's head rev by exactly one under an
// updateTime precondition, and its entities enter the shadow once that commit has succeeded. A pull reads
// (state.rev, head.rev], merges, and reaches the page as a patch that counts only once the page's
// acknowledging save is on disk. Triggers only say what is wanted; one loop does the network work, one task at
// a time. Everything comes in through deps (the clients, the sync folder, the page, timers and the clock), so
// the engine runs under plain Node, and tests/support/peer.js runs it as a second computer.
//
// Beyond the Engine API of 3.3: status() also carries tooLargePictures; counts() gives AccountState.counts
// for the delete panel; deletion() tells an interrupted account deletion; localOnly() counts what exists
// only on this computer (sign-out may not remove the board while it isn't zero), and the unreadable-file
// copies that removing the board deletes with it; drain(ms), before stop() at a sign-out, lets the patch on
// its way land or withdraws it; onAccountChange() lets the facade pass on account changes; onPageReady() also
// takes the page's contentSeq and what its data:load read ('main' | 'bak' | null), for a sign-in after the
// page loaded; completePictures() fetches the full size of the board's pictures that are here only as thumbnails
// (before a sign-out; deleteAccountData() runs it first); idle(), whenIdle(), busy() and debug() are for tests and
// the peer.
//
// The head carries commits.<device id>, the id of that computer's last commit that landed: a commit whose
// answer never came is settled by the next head read, even after others rewrote all of it (st.outgoing).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const codec = require('../cloud/codec');
const model = require('./model');
const { diffLocal, quarantineSig, pushedEntry } = require('./diff');
const { mergeRemote, shadowDelta, applyShadowDelta, neededTrash } = require('./merge');
const { maskEmail } = require('./state');

const SCHEMA = 1;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const MAX_WRITES = 400;                  // per commit, the head and trash copies included (4.7)
const MAX_COMMIT_BYTES = 8 * 1024 * 1024; // estimated; Firestore takes 10 MiB per request
const MIN_COMMIT_BYTES = 256 * 1024;     // the smallest a commit gets on a link too slow for bigger ones
const READ_MAX = 300;                    // documents per runQuery page (5.6); a slow link gets smaller ones
const BATCH_MAX = 100;                   // documents per batchGet
const READ_GROW = 10;                    // full pages in a row before a smaller page size is doubled again
const PICTURE_MAX = 32 * 1024 * 1024;    // larger pictures stay on this computer (4.7)
const VIEW_MAX = 600000;
const DRAFTS_MAX = 150000;
const IMAGE_ID = /^[a-f0-9]{32}$/;
const UNREADABLE = /^recaller-data\.unreadable-.+\.json$/; // copies of a data file that couldn't be read (3.5)
const PLATFORMS = ['darwin', 'win32', 'linux'];
const SETTINGS_KEYS = ['theme', 'model', 'language', 'hint', 'hotkey', 'shotHotkey', 'hideAfterCopy'];
const VIEW_PROJECT_KEYS = new Set(['notesCollapsed', 'usedCollapsed', 'augCollapsed', 'usedExpanded', 'augExpanded']);
const LISTS = ['notes', 'used', 'combined'];
// Undo labels that explain a deletion (5.5 step 4).
const EXPLAINING = new Set(['Delete note', 'Delete project', 'Clear Cooked', 'Clear Served', 'Delete Cooked note',
  'Delete Served text', 'Edit Cooked', 'Edit Served', 'Undo', 'Redo',
  // 1.18: Done moves the Served notes to Eaten (on this computer), and serving a Claude Code note
  // replaces its parts with the one formatted note
  'Done eating', 'Serve as Claude Code']);
const NET = new Set(['NETWORK', 'TIMEOUT']);
// What getIdToken() or a refresh says once this computer's sign-in has ended (account.js shows why).
const SIGNED_OFF = new Set(['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'PROJECT_NUMBER_MISMATCH', 'USER_DISABLED',
  'USER_NOT_FOUND', 'SIGNED_OUT']);
const MODES = new Set(['normal', 'union', 'restore']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v) => (Number.isSafeInteger(v) ? v : 0);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const HASHED = 'sha256:';
const sigHash = (sig) => `${HASHED}${sha256(sig)}`;  // a quarantine signature as state.json keeps it
const fieldsHash = (f) => sha256(model.fieldsSig(isObj(f) ? f : {})); // an outgoing item's fields, likewise
const list = (v) => (Array.isArray(v) ? v : []);
const plural = (kind) => (kind === 'note' ? 'notes' : 'projects');

// Typed Firestore values for the writes built here; items go through model.encode*.
const S = (v) => ({ stringValue: String(v) });
const I = (v) => ({ integerValue: String(Math.trunc(v)) });
const B = (v) => ({ booleanValue: Boolean(v) });
const M = (fields) => ({ mapValue: { fields } });
const boardValue = (b) => M({ joiner: typeof b?.joiner === 'string' ? S(b.joiner) : { nullValue: null } });
const statsValue = (c) => M({ projects: I(c.projects), notes: I(c.notes), images: I(c.images) });

// Ids come from the data file, so '__proto__' is a possible key: define it, never assign it.
function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  else obj[k] = v;
  return obj;
}

class SyncError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
  }
}

class Stopped extends Error {} // work begun before stop() or a deletion: dropped without a trace
class Halt extends Error {}    // the head says this computer can't go on (deleting, gone): the cycle ends quietly

const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };

// Every interval of 5.2 and 3.4; RECALLER_SYNC_FAST divides them by ten.
function timing(fast) {
  const f = fast ? 0.1 : 1;
  return {
    pushDebounce: 2000 * f, pushMax: 10000 * f, counters: 10 * MIN * f, device: 10 * MIN * f, devices: 10 * MIN * f,
    poll: fast ? { focused: 1000, visible: 1500, hidden: 2000 } : { focused: MIN, visible: 5 * MIN, hidden: 30 * MIN },
    pullGap: 10000 * f, offline: 30000 * f, backoff: [5000, 15000, MIN, 5 * MIN, 15 * MIN].map((ms) => ms * f),
    refused: [5000, 30000].map((ms) => ms * f), waiting: fast ? 1000 : 1500, count: fast ? 250 : 1000, bulk: 1000 * f,
    verify: fast ? 500 : 30000, verifyFor: 10 * MIN, verifyFocus: 10000 * f, image: 15000,
    audit: 30 * DAY, auditGap: 60 * MIN, trash: 30 * DAY,
    firstCheck: 30 * MIN * f, goneCheck: 5 * MIN * f, syncedSave: 10 * MIN, saveSoon: 2000 * f,
  };
}

function decodeHead(doc) {
  if (!doc) return null;
  const f = codec.decodeFields(doc.fields);
  const stats = isObj(f.stats) ? { projects: int(f.stats.projects), notes: int(f.stats.notes), images: int(f.stats.images) } : null;
  return {
    doc,
    rev: int(f.rev),
    minRev: int(f.minRev),
    schema: Number.isSafeInteger(f.schema) ? f.schema : SCHEMA,
    deleting: f.deleting === true,
    lastDevice: typeof f.lastDevice === 'string' ? f.lastDevice : '',
    commits: isObj(f.commits) ? f.commits : {}, // device id → the id of its last commit that landed
    board: { joiner: isObj(f.board) && typeof f.board.joiner === 'string' ? f.board.joiner : null },
    stats,
    createdAt: typeof f.createdAt === 'string' ? f.createdAt : null,
    updatedAt: Date.parse(f.updatedAt) || null,
    updateTime: doc.updateTime ?? null,
  };
}

const syncOf = (doc) => {
  const s = doc?.fields?._sync ? codec.fromValue(doc.fields._sync) : null;
  return isObj(s) ? s : {};
};

// The data file's pictures, drafts' included, as 32-hex ids.
function noteImageIds(fields) {
  return list(fields?.images).map((i) => (isObj(i) ? i.id : null)).filter((id) => typeof id === 'string' && IMAGE_ID.test(id));
}

// Runs fn over items, n at a time; every item is tried, then the first failure is thrown.
async function pool(items, n, fn) {
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (next < items.length && !failure) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        failure = failure || err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failure) throw failure;
}

// The page's save bookkeeping (3.6): { session, seq, contentSeq, labels, acks }. Bad meta counts as {}.
function cleanMeta(meta) {
  const m = isObj(meta) ? meta : {};
  const out = { labels: [], acks: [] };
  if (typeof m.session === 'string' && m.session.length <= 200) out.session = m.session;
  if (Number.isSafeInteger(m.seq)) out.seq = m.seq;
  if (Number.isSafeInteger(m.contentSeq)) out.contentSeq = m.contentSeq;
  out.labels = list(m.labels).filter((l) => typeof l === 'string' && l.length <= 200).slice(-500);
  out.acks = [...list(m.acks), m.ack].filter((a) => typeof a === 'string' && a.length > 0 && a.length <= 200).slice(-50);
  return out;
}

// Two saves that main writes as one (3.8): every ack kept, labels joined, the newest session and counters.
function mergeSaveMeta(prev, next) {
  if (prev == null && next == null) return null;
  const p = prev == null ? null : cleanMeta(prev);
  const n = cleanMeta(next);
  if (!p) return n;
  const pick = (k) => (n[k] !== undefined ? n[k] : p[k]);
  const out = { labels: [...p.labels, ...n.labels].slice(-500), acks: [...p.acks, ...n.acks].slice(-50) };
  for (const k of ['session', 'seq', 'contentSeq']) if (pick(k) !== undefined) out[k] = pick(k);
  return out;
}

function createSync(deps = {}) {
  const {
    syncDir, account, firestore, storage, images = null, backups = null, page = {},
    getDeviceSettings = () => ({}), getWindowState = () => ({ visible: true, focused: true, minimized: false }),
    hasPendingWrite = () => false, isRestoring = () => false, flushData = () => {}, isOnline = () => true,
    config = {}, platform = process.platform, appVersion = '', now = Date.now, timers = realTimers, log = console,
    random = Math.random, serverNow = null, dataFile = null,
  } = deps;
  if (!syncDir || !account || !firestore || !storage) throw new TypeError('createSync needs syncDir, account, firestore and storage');
  const T = timing(Boolean(config?.fast));
  const DATA_FILE = typeof dataFile === 'string' && dataFile ? dataFile : path.join(path.dirname(syncDir.dir), 'recaller-data.json');
  const cloudNow = typeof serverNow === 'function' ? serverNow : now; // the trash's expireAt is the server's clock (4.7)

  let started = false;
  let stopped = false;
  let gen = 0;                // moves on stop(), a sign-out and a deletion: work begun before it is dropped
  let cycleGen = 0;
  let device = null;          // sync/device.json
  let st = null;              // sync/state.json
  let shadow = null;          // sync/shadow.json, in applyShadowDelta's shape
  let disk = null;            // L_disk: { value, session, contentSeq, sha } (sha: of the file it is, when known)
  let pageSession = null;     // the page load that said sync:ready
  let pageSeq = null;         // its contentSeq when no save of it has been seen yet; null: unknown
  let loadSeen = false;       // data:load came before that sync:ready (a page load, so contentSeq was 0)
  let modeEpoch = 0;          // moves whenever a union or restore is (re)entered: older merges don't end it
  let running = null;
  let rerun = false;
  const want = { pull: false, push: false };
  let deletingHere = false;
  let halting = false;        // drain() and stop(): no new work starts while the page settles
  let withdrawal = null;      // the empty patch that replaces the one on its way (drain)
  let win = { visible: true, focused: true, minimized: false };
  let qVersion = 0;
  let thumbs = null;
  const downloads = new Map();
  const timer = {};
  const sleepers = new Set();
  let idleWaiters = [];
  let patchSerial = 0;
  let tombstoneHeld = false;  // this push left a project's tombstone out of a commit (housed): its labels stay

  // What one run knows about the account it syncs; resetRun() starts it over (start(), another account).
  let inFlight;               // the patch the page hasn't acknowledged
  let head;                   // the head as last read
  let countersDue;
  let finalRun;               // the final push before quit or sign-out
  let massDeleteOk;
  let activity;               // what the loop is doing over the network (phase syncing)
  let progress;
  let error;                  // { code, retryAt } while backing off
  let netDown;
  let badRequest;
  let deletingElsewhere;
  let sawDeleting;            // a first sync found the account being deleted
  let updateNeeded;
  let backoffStep;
  let backoffUntil;
  let headMoves;
  let lastPullAt;
  let lastAuditTry;
  let firstListing;           // the account's board as the first sync listed it
  let firstCheckedAt;         // the first sync's forced token refresh (does the account still exist?)
  let goneCheckAt;            // the same check while the account's cloud board is missing
  let devicesMap;             // deviceId → { name, platform, lastSeenAt }
  let devicesAt;
  let askedDevices;
  let pendingCount;
  let diffCache;
  let pushFirstAt;
  let verifyUntil;
  let lastVerifyAt;
  let noThumb;                // pictures the account has no thumbnail for (prefetch)
  let thumbTries;             // prefetches that failed on the way (a 503, a dropped connection), per picture
  let thumbFailed;            // pictures no thumbnail could be made for here (4.6: the full one serves)
  let notHere;                // pictures whose full file isn't on this computer
  let sweptShadow;            // the shadow the owed pictures were last looked for in
  let staleNacks;             // stale nacks in a row with no newer save of the page's
  let commitBudget;           // bytes per commit: halved while a slow link can't carry a commit
  let budgetOks;
  let drops;                  // small commits lost on a link that answers, in a row
  let readSize;               // documents per read (a query page, a batchGet): halved while a slow link can't carry one
  let readOks;                // full pages read in a row at that size
  let readDrops;              // cycles in a row whose one-document read timed out on a link that answers
  let outgoing;               // the commit whose answer never came: { id, rev, chunk } (state.json: st.outgoing)
  let headGone;               // the last head read found none
  let restoreLoad;            // a backup is being put back: until the page loads it, the board here is the old one
  let syncedSaved;            // when lastSyncedAt last went into state.json
  let shown;

  function resetRun() {
    inFlight = null;
    disarm('waiting');
    head = null;
    want.pull = false;
    want.push = false;
    countersDue = false;
    finalRun = false;
    massDeleteOk = false;
    activity = null;
    progress = null;
    error = null;
    netDown = false;
    badRequest = false;
    deletingElsewhere = false;
    sawDeleting = false;
    updateNeeded = false;
    backoffStep = 0;
    backoffUntil = 0;
    disarm('retry');
    headMoves = 0;
    lastPullAt = 0;
    lastAuditTry = 0;
    firstListing = null;
    firstCheckedAt = 0;
    goneCheckAt = 0;
    devicesMap = new Map();
    devicesAt = 0;
    askedDevices = new Set();
    pendingCount = 0;
    diffCache = null;
    pushFirstAt = 0;
    verifyUntil = 0;
    lastVerifyAt = 0;
    noThumb = new Set();
    thumbTries = new Map();
    thumbFailed = new Set();
    notHere = new Set();
    sweptShadow = null;
    staleNacks = 0;
    commitBudget = MAX_COMMIT_BYTES;
    budgetOks = 0;
    drops = 0;
    readSize = READ_MAX;
    readOks = 0;
    readDrops = 0;
    outgoing = null;
    headGone = false;
    restoreLoad = false;
    syncedSaved = 0;
    shown = '';
    withdrawal = null;
    pageSeq = null; // the page's saves while this engine didn't run were never seen: learnt again (probe)
    loadSeen = false;
  }
  resetRun();

  // ---- small helpers

  const uid = () => account.uid?.() || null;
  const status0 = () => {
    try {
      return account.state?.().status || 'signed-out';
    } catch {
      return 'signed-out';
    }
  };
  const signedIn = () => status0() === 'signed-in';
  const headPath = () => `users/${uid()}`;
  const imagePath = (id, thumb) => `users/${uid()}/images/${id}${thumb ? '.t' : ''}.png`;
  const jitter = (ms) => Math.round(ms * (0.8 + 0.4 * random()));
  const signedOff = (err) => SIGNED_OFF.has(err?.code);
  const alive = () => {
    if (stopped || cycleGen !== gen) throw new Stopped();
  };
  // A backup is being put in place (main writes it, and the page loads it a moment later): until then the board
  // this engine has is the one before it, so nothing is merged against it or pushed from it (5.10).
  const replacing = () => restoreLoad || Boolean(isRestoring());

  function warn(text) {
    try {
      log.warn?.(`[sync] ${text}`);
    } catch {}
  }

  // Codes and the place in the code only: a message can carry a note's text.
  function warnErr(what, err) {
    const code = err?.code ? ` ${err.code}` : '';
    const where = err instanceof Error && !err.code ? String(err.stack || '').split('\n').slice(1, 3).join(' |').trim() : '';
    warn(`${what}: ${err?.name || 'Error'}${code}${where ? ` ${where}` : ''}`);
  }

  function safe(fn) {
    return (...args) => {
      try {
        const out = fn(...args);
        if (out && typeof out.catch === 'function') out.catch((err) => warnErr('task failed', err));
      } catch (err) {
        warnErr('task failed', err);
      }
    };
  }

  // A stopped engine arms nothing: signed out, no timers run (S1).
  function arm(name, ms, fn) {
    disarm(name);
    if (stopped) return;
    const box = { id: null };
    box.id = timers.setTimeout(() => {
      if (timer[name] !== box) return;
      timer[name] = null;
      if (!stopped) safe(fn)();
    }, Math.max(0, Math.round(ms)));
    timer[name] = box;
  }

  function disarm(name) {
    const box = timer[name];
    if (!box) return;
    timer[name] = null;
    timers.clearTimeout(box.id);
  }

  function disarmAll() {
    for (const name of Object.keys(timer)) disarm(name);
    for (const s of sleepers) {
      timers.clearTimeout(s.id);
      s.resolve();
    }
    sleepers.clear();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const s = { id: null, resolve };
      s.id = timers.setTimeout(() => {
        sleepers.delete(s);
        resolve();
      }, Math.max(0, Math.round(ms)));
      sleepers.add(s);
    });
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const id = timers.setTimeout(() => {
        if (!done) {
          done = true;
          resolve(fallback);
        }
      }, ms);
      promise.then((v) => {
        if (done) return;
        done = true;
        timers.clearTimeout(id);
        resolve(v);
      }, () => {
        if (done) return;
        done = true;
        timers.clearTimeout(id);
        resolve(fallback);
      });
    });
  }

  function readWin() {
    try {
      const w = getWindowState() || {};
      return { visible: w.visible !== false, focused: Boolean(w.focused), minimized: Boolean(w.minimized) };
    } catch {
      return { visible: true, focused: false, minimized: false };
    }
  }

  function offline() {
    if (config?.offline) return true;
    try {
      return isOnline() === false;
    } catch {
      return false;
    }
  }

  // ---- the sync folder

  function freshState(u, keep = {}) {
    return {
      version: 1, uid: u, rev: 0, headUpdateTime: null, minRev: 0, mode: 'first', seeded: false,
      dataFile: keep.dataFile ?? null, uploaded: keep.uploaded ?? {}, quarantine: {}, labels: [], choice: null,
      lastPullAt: 0, lastPushAt: 0, lastAuditAt: 0, lastIncomingBackupAt: 0, deletion: keep.deletion ?? null,
    };
  }

  // Nothing of a stopped run reaches sync/: a sign-out may have removed it (5.14), and none exists signed out (3.5).
  function saveState() {
    if (stopped) return;
    syncDir.writeState(st);
  }

  // State that can wait a moment (pictures this computer fetched): one write for many.
  function saveSoon() {
    if (!timer.save) arm('save', T.saveSoon, saveState);
  }

  function writeShadow() {
    if (stopped) return;
    trimTombstones();
    syncDir.writeShadow(shadow);
  }

  // A deleted entity keeps its fields in the shadow while the account keeps its trash copy (30 days), so an
  // undelete elsewhere can be told from an edit; after that only the tombstone stays here, as in the account
  // (6.7). Without them a merge keeps what comes back rather than deleting it. Aged by the tombstone's
  // updateTime, or from when the shadow first held it without one.
  function trimTombstones() {
    const t = cloudNow();
    let trimmed = false;
    for (const kind of ['projects', 'notes']) {
      const entries = shadow[kind];
      for (const id of Object.keys(entries)) {
        const e = entries[id];
        if (!isObj(e) || e.d !== true || !isObj(e.f) || !Object.keys(e.f).length) continue;
        const at = Date.parse(e.u) || (Number.isFinite(e.t) ? e.t : 0);
        if (!at) {
          put(entries, id, { ...e, t });
        } else if (t - at >= T.trash) {
          const bare = { ...e, f: {} };
          delete bare.t;
          put(entries, id, bare);
          trimmed = true;
        }
      }
    }
    if (trimmed) diffCache = null;
  }

  function setShadow(next) {
    shadow = next;
    shadow.uid = uid();
    diffCache = null;
  }

  function loadFiles() {
    const u = uid();
    device = syncDir.ensureDevice();
    let s = syncDir.readState();
    let sh = syncDir.readShadow();
    // Another account's state and shadow are never used, never mixed (3.5).
    if ((s?.uid && s.uid !== u) || (sh?.uid && sh.uid !== u)) {
      syncDir.removeAccountState();
      s = null;
      sh = null;
    }
    shadow = null;
    if (s?.mode === 'first') {
      st = { ...freshState(u), ...s, uid: u }; // the first sync, perhaps answered already (firstAnswer)
    } else if (!sh) {
      st = freshState(u, s || {}); // never synced here: the first sync (5.9)
    } else {
      st = s ? { ...s, uid: u } : { ...freshState(u), rev: int(sh.rev), mode: 'union' }; // unsure where sync stood: a union
      if (!MODES.has(st.mode)) st.mode = 'union';
      shadow = applyShadowDelta(sh, null);
      shadow.uid = u;
    }
    for (const k of ['uploaded', 'quarantine']) if (!isObj(st[k])) st[k] = {};
    if (!Array.isArray(st.labels)) st.labels = [];
    recoverAck();
    // A commit an earlier run sent and never heard back about: the next head read says whether it landed.
    const o = st.outgoing;
    const known = st.mode !== 'first' && shadow && isObj(o) && typeof o.id === 'string' && Number.isSafeInteger(o.rev) && Array.isArray(o.items);
    outgoing = known ? { id: o.id, rev: o.rev, board: isObj(o.board) ? o.board : null, items: o.items } : null;
    if (!known) st.outgoing = null;
    saveState();
  }

  // A crash after the acknowledging save but before the shadow advanced (5.18): the marker in state.json,
  // written together with that save's fingerprint, holds the patch's shadow delta. Applying it here, not
  // merging again, keeps copy counts from doubling. Applying it twice changes nothing.
  function recoverAck() {
    const a = isObj(st.ack) ? st.ack : null;
    st.ack = null;
    if (!a || !isObj(a.delta)) return;
    setShadow(applyShadowDelta(a.first ? null : shadow, a.delta));
    writeShadow();
    st.rev = int(a.H);
    st.headUpdateTime = a.headUpdateTime ?? null;
    if (a.first) {
      st.headCreatedAt = a.createdAt ?? null;
      finishFirst();
    }
    if (a.audit) st.lastAuditAt = now();
    if (a.endMode) endMode();
  }

  // The merge a union or restore needed is on disk: from here every difference is an edit or a delete made
  // since, and a delete made since carries its undo label (5.10).
  function endMode() {
    if (st.mode === 'union' || st.mode === 'restore') st.mode = 'normal';
    st.seeded = false;
    st.stale = false;
  }

  function finishFirst() {
    st.mode = 'normal';
    st.choice = null;
    st.firstAnswer = null;
    st.firstBackup = null;
    st.seeded = false;
    st.stale = false;
    if (!st.lastAuditAt) st.lastAuditAt = now();
    firstListing = null;
    try {
      const d = syncDir.readDevice() || device;
      device = syncDir.writeDevice({ ...d, lastUid: uid(), lastEmailMasked: maskEmail(account.email?.()) });
    } catch (err) {
      warnErr("device.json couldn't be written", err);
    }
  }

  // ---- the board on disk

  // sha: the fingerprint of the data file this value is, or null when the file on disk is something else
  // (the page showing the .bak or a seed of its own over an unreadable file).
  function setDisk(value, session = null, contentSeq = 0, sha = null) {
    disk = isObj(value) && Array.isArray(value.projects) ? { value, session, contentSeq, sha } : null;
    diffCache = null;
  }

  // Where the board stood before this run (5.10): a file this app didn't write last, a .bak, or no
  // readable file at all makes the next sync a union, which never pushes a deletion.
  // from: what loadData read ('main', 'bak' or null); text: the main file's, when it holds a board (then
  // disk.sha is its fingerprint).
  function loaded(from, text) {
    if (!st) return;
    restoreLoad = false; // a backup being put in place is on disk now, and this is it
    if (st.mode === 'first') { // the first sync takes the file as it is; later runs compare against it
      if (from === 'main' && disk?.sha) {
        st.dataFile = { sha256: disk.sha, bytes: Buffer.byteLength(text) };
        saveState();
      }
      return;
    }
    if (st.mode === 'restore') { // the restored file: whatever was merged before it is merged again
      modeEpoch++;
      return;
    }
    if (from === 'main' && disk) {
      if (!st.dataFile || st.dataFile.sha256 !== disk.sha) union({ seeded: reseeded() });
    } else if (from === 'bak') {
      union({ stale: true });
    } else { // both unreadable, or a main file that holds no board: the page seeds one
      union({ seeded: true });
    }
  }

  // A pristine Welcome the account never had, in a file this app didn't write last: the page seeded it
  // because it could read nothing (a sign-in after a load while signed out).
  function reseeded() {
    if (!disk || !model.isPristineBoard(disk.value)) return false;
    const pid = disk.value.projects.find(isObj)?.id;
    return !(typeof pid === 'string' && shadow && Object.hasOwn(shadow.projects, pid));
  }

  // Asks for the merge a union needs; flags only add up until it has run. (A first sync has no base yet.)
  function union({ stale = false, seeded = false }) {
    if (st.mode === 'first') return;
    if (st.mode !== 'restore') st.mode = 'union';
    if (stale) st.stale = true;
    if (seeded) st.seeded = true;
    if (st.choice?.kind === 'mass-delete') st.choice = null; // a union deletes nothing: it brings them back
    st.massDelete = null;
    modeEpoch++;
    saveState();
  }

  // The file as it is when the engine starts. At app start data:load follows and says where the page's
  // board came from. A sign-in after the page loaded gets no data:load: a main file that can't be read
  // means the page shows the .bak, or a seed when that can't be read either (loadData's rule), so the
  // first sync from here is that union (5.10) and never a deletion.
  function readDiskNow() {
    const read = (file) => {
      try {
        const text = fs.readFileSync(file, 'utf8');
        const value = JSON.parse(text);
        return value ? { text, value } : null;
      } catch {
        return null;
      }
    };
    const main = read(DATA_FILE);
    const bak = main ? null : read(`${DATA_FILE}.bak`);
    const from = main ? 'main' : bak ? 'bak' : null;
    if (main) setDisk(main.value, null, 0, sha256(main.text));
    else setDisk(bak?.value);
    if (st && !(from === 'main' && disk)) copyAside(DATA_FILE);
    loaded(from, main ? main.text : '');
  }

  // The unreadable main file's bytes, before anything can overwrite them; the five newest are kept, and
  // the same bytes are kept once.
  function copyAside(file) {
    try {
      if (!fs.existsSync(file)) return;
      const dir = path.dirname(file);
      const copies = () => fs.readdirSync(dir).filter((n) => UNREADABLE.test(n)).sort().reverse();
      const newest = copies()[0];
      if (newest && fs.readFileSync(path.join(dir, newest)).equals(fs.readFileSync(file))) return;
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(file, path.join(dir, `recaller-data.unreadable-${stamp}.json`));
      for (const n of copies().slice(5)) fs.rmSync(path.join(dir, n), { force: true });
    } catch (err) {
      warnErr("the unreadable data file couldn't be copied aside", err);
    }
  }

  function unreadableCopies() {
    try {
      return fs.readdirSync(path.dirname(DATA_FILE)).filter((n) => UNREADABLE.test(n)).length;
    } catch {
      return 0;
    }
  }

  const EMPTY = {
    upserts: [], tombstones: [], pending: 0, counterOnly: false, tooLarge: [], deletions: { notes: 0, projects: 0 }, board: null,
    quarantined: [], withProject: [], heldProjects: [],
  };

  function diffMode() {
    return st.mode === 'restore' ? 'restore' : st.mode === 'union' ? 'union' : 'normal';
  }

  function currentDiff() {
    if (!disk || !st || st.mode === 'first') return { diff: EMPTY, local: null };
    const c = diffCache;
    if (c && c.disk === disk && c.shadow === shadow && c.mode === st.mode && c.seeded === st.seeded && c.q === qVersion) return c;
    const local = model.toModel(disk.value);
    const diff = keepWithProjects(diffLocal({ shadow, local, mode: diffMode(), quarantine: quarantineView(local), seeded: st.seeded === true }));
    diffCache = { disk, shadow, mode: st.mode, seeded: st.seeded, q: qVersion, diff, local };
    pendingCount = diff.pending;
    return diffCache;
  }

  const projectAlive = (pid) => Object.hasOwn(shadow.projects, pid) && isObj(shadow.projects[pid]) && shadow.projects[pid].d !== true;

  // A live note the account would hold in this project only once this write lands: new, undeleted, or moved in.
  function entering(item) {
    const b = Object.hasOwn(shadow.notes, item.id) ? shadow.notes[item.id] : null;
    return !isObj(b) || b.d === true || b.p !== item.project;
  }

  // The projects the account (the shadow) has a live note in that stays there: one `going` (the note ids a push
  // deletes or moves) doesn't name.
  function occupied(going) {
    const out = new Set();
    for (const id of Object.keys(shadow.notes)) {
      const b = shadow.notes[id];
      if (isObj(b) && b.d !== true && !going.has(id)) out.add(b.p);
    }
    return out;
  }

  // 5.5 step 5: never a live note in a project the account doesn't have. A note going into a project that is neither
  // alive in the account nor going up in this push (too large, or refused: held here) stays here with it, and goes
  // once it does (withProject). Meanwhile it counts as only here (localOnly), not as waiting; up on its own, it would
  // make another computer stand in a "Recovered notes" for the project, and that would replace this one here.
  // Nor does a project's tombstone go while the account has a live note in it that this push neither deletes nor
  // moves out: a note moved out of it here and held (with its project, refused, too large) still lives there in the
  // account, and every other computer would keep the project for it (KEPT_PROJECT) and bring it back everywhere,
  // here too. The tombstone waits for that note (heldProjects): not counted as waiting, but as only here, with its
  // undo label kept for it.
  function keepWithProjects(diff) {
    const coming = new Set(diff.upserts.filter((u) => u.kind === 'project').map((u) => u.id));
    const withProject = [];
    const upserts = diff.upserts.filter((u) => {
      if (u.kind !== 'note' || coming.has(u.project) || projectAlive(u.project) || !entering(u)) return true;
      withProject.push(u.id);
      return false;
    });
    const heldProjects = [];
    let { tombstones } = diff;
    if (tombstones.some((t) => t.kind === 'project')) {
      const stays = occupied(new Set([...upserts, ...tombstones].filter((x) => x.kind === 'note').map((x) => x.id)));
      tombstones = tombstones.filter((t) => {
        if (t.kind !== 'project' || !stays.has(t.id)) return true;
        heldProjects.push(t.id);
        return false;
      });
    }
    if (!withProject.length && !heldProjects.length) return { ...diff, withProject, heldProjects };
    const pending = upserts.length + tombstones.length + (diff.board ? 1 : 0);
    const counterOnly = pending > 0 && !tombstones.length && !diff.board && upserts.every((u) => u.reason === 'counter');
    const deletions = { ...diff.deletions, projects: diff.deletions.projects - heldProjects.length };
    return { ...diff, upserts, tombstones, deletions, pending, counterOnly, withProject, heldProjects };
  }

  // The same at commit time, for a project that didn't go up in this very push (refused while it was split, or one
  // Firestore can't hold): its notes stay out of the commit, and the next diff holds them with it. Likewise a
  // project's tombstone while the account (after the commits that landed) still has a live note in it that this
  // commit neither deletes nor moves out, its own write refused in a part before, say: it waits for that note.
  function housed(chunk) {
    const coming = new Set(chunk.items.filter((e) => e.item.kind === 'project' && e.item.reason).map((e) => e.item.id));
    let items = chunk.items.filter((e) => e.item.kind !== 'note' || !e.item.reason || coming.has(e.item.project)
      || projectAlive(e.item.project) || !entering(e.item));
    if (items.some((e) => e.item.kind === 'project' && !e.item.reason)) {
      const stays = occupied(new Set(items.filter((e) => e.item.kind === 'note').map((e) => e.item.id)));
      items = items.filter((e) => {
        if (e.item.kind !== 'project' || e.item.reason || !stays.has(e.item.id)) return true;
        tombstoneHeld = true;
        return false;
      });
    }
    if (items.length === chunk.items.length) return chunk;
    return {
      ...chunk, items, writes: items.reduce((n, e) => n + e.writes, 0), bytes: items.reduce((n, e) => n + e.bytes, 0),
      pictures: items.flatMap((e) => e.pictures),
    };
  }

  // state.json is written after every save, so a held item's signature goes there as a hash (a refused note can
  // be 900 KB). diffLocal compares whole signatures: an entry whose hash is the item's as it is now gets that
  // signature back, and any other stays a hash that matches nothing.
  function quarantineView(local) {
    const out = {};
    for (const k of Object.keys(st.quarantine)) {
      const e = st.quarantine[k];
      if (!isObj(e) || typeof e.sig !== 'string' || !e.sig.startsWith(HASHED)) {
        put(out, k, e);
        continue;
      }
      const at = k.indexOf(':');
      const kind = k.slice(0, at);
      const id = k.slice(at + 1);
      const x = kind === 'note' ? local.notes.get(id) : kind === 'project' ? local.projects.get(id) : null;
      const sig = x ? quarantineSig({ kind, id, reason: 'change', fields: x.fields, project: x.project, list: x.list }) : null;
      put(out, k, sig !== null && sigHash(sig) === e.sig ? { ...e, sig } : e);
    }
    return out;
  }

  function recount() {
    arm('count', T.count, () => {
      pendingCount = currentDiff().diff.pending;
      notify();
    });
  }

  // The contentSeq of the save on disk, for the page's stale check; null (the engine probes) when the engine started
  // after the page had loaded and hasn't seen one of its saves yet. The page's contentSeq it was told (pageSeq) counts
  // only while no save waits in main: one on its way holds what the file this engine read doesn't (a note typed just
  // before signing in), so a patch merged from that file must never claim to be based on it.
  const contentSeqNow = () => {
    if (disk && disk.session === pageSession) return disk.contentSeq;
    return hasPendingWrite() ? null : pageSeq;
  };

  function counts(m) {
    const c = model.countLive(m);
    return { projects: c.projects, notes: c.notes, pictures: c.images };
  }

  // ---- devices

  function deviceRef(id) {
    const known = devicesMap.get(id)?.platform;
    const p = PLATFORMS.includes(known) ? known : id && device && id === device.id ? platform : null;
    return { platform: p, sameAsThis: p !== null && p === platform };
  }

  function devicePlatforms() {
    const m = new Map();
    for (const [id, d] of devicesMap) if (d.platform) m.set(id, { platform: d.platform });
    if (device) m.set(device.id, { platform });
    return m;
  }

  // Only what "Also signed in on" shows: a device's view and drafts can be large.
  const DEVICE_FIELDS = { fields: ['name', 'platform', 'lastSeenAt'].map((fieldPath) => ({ fieldPath })) };

  async function refreshDevices() {
    const found = new Map();
    for await (const doc of firestore.queryAll(headPath(), { from: [{ collectionId: 'devices' }], select: DEVICE_FIELDS })) {
      const id = String(doc.path || '').split('/').pop();
      const f = codec.decodeFields(doc.fields);
      if (!PLATFORMS.includes(f.platform)) continue;
      found.set(id, {
        name: typeof f.name === 'string' ? f.name.slice(0, 60) : '',
        platform: f.platform,
        lastSeenAt: Date.parse(f.lastSeenAt) || 0,
      });
    }
    alive();
    devicesMap = found;
    devicesAt = now();
  }

  // Unknown writers in a pull: one look at the devices (5.6 step 9).
  async function learnDevices(remote) {
    const unknown = [];
    for (const d of [...remote.projects.values(), ...remote.notes.values()]) {
      if (d.by && d.by !== device.id && !devicesMap.has(d.by) && !askedDevices.has(d.by)) unknown.push(d.by);
    }
    if (!unknown.length && devicesAt) return;
    for (const by of unknown) askedDevices.add(by);
    try {
      await refreshDevices();
    } catch (err) {
      alive(); // a stop() meanwhile: this pull is dropped, never merged into the run after it
      warnErr("the devices couldn't be read", err);
    }
  }

  // The writer whose changes a patch brings (the waiting phase names it).
  function writerOf(remote) {
    const n = new Map();
    for (const d of [...(remote?.projects?.values() || []), ...(remote?.notes?.values() || [])]) {
      if (d.by && d.by !== device?.id) n.set(d.by, (n.get(d.by) || 0) + 1);
    }
    const top = [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    return deviceRef(top ? top[0] : '');
  }

  // ---- state for the page

  function refused() {
    let n = 0;
    for (const k of Object.keys(st?.quarantine || {})) if (st.quarantine[k]?.code !== 'TOO_LARGE') n++;
    return n;
  }

  function phaseNow() {
    if (!st) return 'synced';
    if (deletingElsewhere) return 'deleting-elsewhere';
    if (updateNeeded) return 'update-needed';
    if (st.choice) return 'choosing';
    if (badRequest) return 'paused';
    if (offline() || netDown) return 'offline';
    if (error) return 'paused';
    if (inFlight?.waiting) return 'waiting';
    if (activity) return 'syncing';
    if (pendingCount > 0) return 'pending';
    const q = st.quarantine || {};
    if (Object.keys(q).length || Object.keys(st.skippedPictures || {}).length) return 'paused';
    return 'synced';
  }

  function status() {
    const q = st?.quarantine || {};
    const phase = phaseNow();
    const pending = pendingCount;
    // Too large: recorded by a push, or (none since) known to the diff alone; localOnly() counts the same.
    const big = new Set(st ? tooLargeKeys() : []);
    for (const k of Object.keys(q)) if (q[k]?.code === 'TOO_LARGE') big.add(k);
    const out = {
      phase,
      pending,
      lastSyncedAt: st?.lastSyncedAt || null,
      tooLarge: big.size,
      quarantined: new Set([...Object.keys(q), ...big]).size,
      tooLargePictures: Object.keys(st?.skippedPictures || {}).length,
    };
    if (phase === 'syncing' && progress) out.progress = { ...progress };
    if (phase === 'paused') {
      if (badRequest) out.error = { code: 'BAD_REQUEST' };
      else if (error) out.error = { ...error };
      else if (refused() > 0) out.error = { code: 'PERMISSION' };
    }
    if (phase === 'waiting') out.waitingFor = inFlight.from;
    return out;
  }

  function notify() {
    if (!started) return;
    let key;
    try {
      key = JSON.stringify([status(), st?.choice ?? null, devices().map((d) => [d.id, d.lastSeenAt]), st?.deletion ?? null]);
    } catch {
      key = String(Math.random());
    }
    if (key === shown) return;
    shown = key;
    try {
      page.sendState?.();
    } catch (err) {
      warnErr('sendState failed', err);
    }
  }

  function setChoice(choice) {
    st.choice = choice;
    saveState();
    activity = null;
    progress = null;
    notify();
  }

  function otherAccount() {
    if (!device?.lastUid || device.lastUid === uid()) return undefined;
    return device.lastEmailMasked || 'another account';
  }

  // ---- the loop

  function kick() {
    if (!started || stopped || deletingHere || halting) return;
    if (running) {
      rerun = true;
      return;
    }
    rerun = false;
    running = loop().finally(() => {
      running = null;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const w of waiters) w();
      if (rerun && started && !stopped && !deletingHere) kick();
    });
  }

  async function loop() {
    cycleGen = gen;
    for (let i = 0; i < 25; i++) {
      rerun = false;
      try {
        await cycle();
      } catch (err) {
        // Work begun before a stop() or a deletion is dropped however it ended: a request on its way at a sign-out
        // fails after it (NETWORK), and that is no reason to try again.
        if (!(err instanceof Stopped) && !(err instanceof Halt) && !stopped && cycleGen === gen) failed(err);
      } finally {
        activity = null;
        progress = null;
      }
      if (stopped || cycleGen !== gen) return;
      notify();
      if (!rerun) break;
    }
    if (rerun) arm('rerun', 0, kick); // a long chain of reruns yields to the timers
    rerun = false;
    schedulePoll();
  }

  function ready() {
    if (!started || stopped || deletingHere || !st || !device) return false;
    if (!signedIn() || !uid()) return false;
    return Boolean(disk && pageSession);
  }

  async function cycle() {
    if (!ready() || st.deletion) return;
    if (st.uid !== uid()) { // another account signed in without a stop()
      syncDir.removeAccountState();
      resetRun();
      loadFiles();
      readDiskNow();
      want.pull = true;
      want.push = true;
    }
    if (replacing()) return;
    if (offline()) {
      goOffline();
      return;
    }
    if (inFlight) {
      if (inFlight.stale && !hasPendingWrite()) {
        if (disk !== inFlight.disk) {
          remerge();
        } else if (staleNacks > 2) { // the page keeps refusing with nothing newer saved: back off
          dropInFlight();
          throw new SyncError('UNKNOWN');
        } else {
          reprobe(); // stale, yet nothing newer was saved: learn the page's contentSeq
        }
        if (!inFlight) rerun = true; // nothing left for the page: push what's here
      }
      return;
    }
    // A question blocks only what its answer decides: the first sync, or pushing the deletions (5.5 step 4).
    const asked = st.choice?.kind ?? null;
    if (updateNeeded || (asked && asked !== 'mass-delete' && asked !== 'account-gone')) return;
    if (backoffUntil > now()) return;
    if (asked === 'account-gone') {
      await goneCheck();
      return;
    }
    if (!want.pull && !want.push && st.mode !== 'first' && !(st.firstAnswer)) return;
    if (st.mode === 'first') {
      if (deletingElsewhere && !want.pull) return; // being deleted: only the polls look again
      want.pull = false;
      await firstSync();
      return;
    }
    // Woken only to push (an acknowledged patch, a save, a blur, the counters timer) with nothing to push: no head
    // read. push() still does its bookkeeping, all of it here (labels, the mass-delete question, the quarantine), and
    // the device record goes up when due (the rules check the head on their side).
    if (!want.pull && !needsMerge() && !outgoing && currentDiff().diff.pending === 0) {
      await push();
      if (!deletingElsewhere) await deviceIfDue();
      succeeded();
      return;
    }
    want.pull = false;
    const h = await getHead();
    if (!(await headOk(h))) return;
    if ((await settleOutgoing(h)) === 'moved') {
      want.pull = true;
      rerun = true;
      return;
    }
    if (h.minRev > st.rev) {
      if (hasPendingWrite()) return void (want.pull = true);
      await fullResync(h);
      return;
    }
    if (h.rev !== st.rev || needsMerge()) {
      if (hasPendingWrite()) return void (want.pull = true); // the newer save first, then the merge
      await pull(h);
      if (inFlight || blocked()) return;
    } else {
      adoptHead(h);
    }
    if (replacing()) return void (want.pull = true); // merged again once the restored board has loaded
    if (want.push) await push();
    if (inFlight || st.choice || rerun) return;
    await picturesIfDue();
    await deviceIfDue();
    await devicesIfDue();
    await auditIfDue(h);
    succeeded();
  }

  const blocked = () => Boolean(st.choice && st.choice.kind !== 'mass-delete');

  function needsMerge() {
    return st.mode === 'union' || st.mode === 'restore' || st.seeded === true;
  }

  // The account's cloud board is missing (5.15): the polls keep looking. A board made again means a new
  // first sync; the account itself gone shows as deleted (a forced refresh, now and then and on Sync now).
  async function goneCheck() {
    if (!want.pull) return;
    want.pull = false;
    const h = await getHead();
    if (h) {
      st.choice = null;
      saveState();
      notify();
      want.pull = true;
      rerun = true;
      return;
    }
    if (now() - goneCheckAt >= T.goneCheck) await accountGone();
  }

  function goOffline() {
    activity = null;
    notify();
    if (!timer.online) {
      arm('online', T.offline, () => {
        if (!offline()) {
          resetBackoff();
          want.pull = true;
          want.push = true;
        }
        kick();
      });
    }
  }

  function failed(err) {
    if (stopped) return;
    activity = null;
    progress = null;
    if (signedOff(err)) { // the account shows why; nothing to retry until it changes
      notify();
      return;
    }
    if (err?.code === 'BAD_REQUEST') {
      badRequest = true;
      warnErr('stopped pushing (a request this version made was refused as bad)', err);
      notify();
      return;
    }
    const delay = jitter(T.backoff[Math.min(backoffStep, T.backoff.length - 1)]);
    backoffStep++;
    backoffUntil = now() + delay;
    if (err?.code === 'DROPPED') {
      // A small commit lost on a link that answers: tried again with nothing shown (the phase stays pending).
    } else if (NET.has(err?.code)) {
      netDown = true;
      error = null;
    } else {
      error = { code: err?.code === 'QUOTA' || err?.code === 'SERVER' ? err.code : 'UNKNOWN', retryAt: backoffUntil };
    }
    want.pull = true;
    want.push = true;
    arm('retry', delay, () => {
      backoffUntil = 0;
      kick();
    });
    warnErr(`will try again in ${Math.round(delay / 1000)} s`, err);
    notify();
  }

  function succeeded() {
    backoffStep = 0;
    backoffUntil = 0;
    error = null;
    netDown = false;
    readDrops = 0;
    disarm('retry');
    if (!inFlight && pendingCount === 0 && st && st.mode !== 'first') {
      st.lastSyncedAt = now();
      // An idle poll needn't write state.json: lastSyncedAt goes with the next write, or every 10 minutes.
      if (now() - syncedSaved >= T.syncedSave) {
        syncedSaved = now();
        saveState();
      }
    }
  }

  // Focus, resume, Sync now and back online end a backoff, and the retry it was waiting for runs now.
  function resetBackoff() {
    backoffStep = 0;
    if (backoffUntil) {
      backoffUntil = 0;
      disarm('retry');
      want.pull = true;
      want.push = true;
      kick();
    }
  }

  function schedulePoll() {
    if (!started || stopped || deletingHere) return;
    const w = readWin();
    win = w;
    const ms = w.focused ? T.poll.focused : w.visible && !w.minimized ? T.poll.visible : T.poll.hidden;
    if (timer.poll && timer.poll.ms === ms) return;
    arm('poll', ms, () => {
      want.pull = true;
      kick();
    });
    timer.poll.ms = ms;
  }

  function pullSoon(force = false) {
    if (!force && now() - lastPullAt < T.pullGap) return;
    want.pull = true;
    kick();
  }

  // ---- the head

  async function getHead() {
    const doc = await firestore.get(headPath());
    alive();
    head = decodeHead(doc);
    headGone = !head;
    // The service answers: an earlier failure shows no longer (its backoff step stays, should the next fail too).
    error = null;
    netDown = false;
    lastPullAt = now();
    st.lastPullAt = lastPullAt;
    return head;
  }

  function adoptHead(h) {
    if (h.rev === st.rev && st.headUpdateTime !== h.updateTime) {
      st.headUpdateTime = h.updateTime;
      saveState();
    }
  }

  // false when the head says this computer can't sync: gone, being deleted, or written by a newer version.
  async function headOk(h) {
    if (!h) {
      deletingElsewhere = false;
      if (st.rev > 0) await accountGone();
      else {
        st.mode = 'first';
        saveState();
        rerun = true;
      }
      return false;
    }
    if (h.deleting) { // polls go on: once the head is gone, the account's fate shows (5.15)
      deletingElsewhere = true;
      dropInFlight();
      notify();
      return false;
    }
    deletingElsewhere = false;
    if (h.schema > SCHEMA) {
      updateNeeded = true;
      notify();
      return false;
    }
    // A head made again (the board was deleted and another computer uploaded anew): this shadow describes
    // a board that is gone, so this computer starts over with the first-sync decision (5.9).
    if (h.rev < st.rev || (st.headCreatedAt && h.createdAt && h.createdAt !== st.headCreatedAt)) {
      warn('the account\'s board was made again; syncing starts over here');
      syncDir.removeAccountState();
      shadow = null;
      st = freshState(uid(), { dataFile: st.dataFile, deletion: st.deletion });
      outgoing = null;
      firstListing = null;
      modeEpoch++;
      dropInFlight();
      saveState();
      rerun = true;
      return false;
    }
    if (!st.headCreatedAt && h.createdAt) {
      st.headCreatedAt = h.createdAt;
      saveState();
    }
    return true;
  }

  // The head is missing though this computer synced: deleted, or only its cloud board is gone (5.15).
  async function accountGone() {
    goneCheckAt = now();
    try {
      await account.getIdToken({ force: true });
    } catch (err) {
      alive();
      if (signedOff(err)) {
        notify();
        return;
      }
      throw err;
    }
    alive();
    if (st.choice?.kind !== 'account-gone') setChoice({ kind: 'account-gone' });
  }

  function dropInFlight() {
    inFlight = null;
    disarm('waiting');
  }

  // ---- pulling

  function rangeQuery(collectionId, from, to) {
    const rev = { fieldPath: '_sync.rev' };
    return {
      from: [{ collectionId }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: rev, op: 'GREATER_THAN', value: I(from) } },
            { fieldFilter: { field: rev, op: 'LESS_THAN_OR_EQUAL', value: I(to) } },
          ],
        },
      },
      orderBy: [{ field: rev, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    };
  }

  // Every document a query names, in pages a slow link can carry: a page its deadline cut short is read again from
  // just after the last document that came (its cursor), in smaller pages (readFailed), and nothing read before it is
  // read again.
  // The range (st.rev, H] and the __name__ order don't change while the pages are read.
  async function collect(query, onDoc = null) {
    const out = { projects: [], notes: [] };
    for (const kind of ['projects', 'notes']) {
      const q = query(kind);
      let last = null;
      for (;;) {
        const size = readSize;
        const at = last ? cursorOf(last, q.orderBy) : null;
        let n = 0;
        try {
          for await (const doc of firestore.queryAll(headPath(), at ? { ...q, startAt: { values: at, before: false } } : q, { pageSize: size })) {
            out[kind].push(doc);
            if (onDoc) onDoc(kind, doc);
            last = doc;
            if (++n % size === 0) readOk(true);
          }
        } catch (err) {
          alive();
          await readFailed(err, size);
          continue;
        }
        alive();
        readOk(false); // the last page, shorter than a full one
        break;
      }
    }
    return out;
  }

  // The values a page after this document starts at, in the query's order (as queryAll builds its own cursors).
  function cursorOf(doc, orderBy) {
    return list(orderBy).map((o) => {
      const fieldPath = String(o?.field?.fieldPath || '');
      if (fieldPath === '__name__') return { referenceValue: doc.name };
      let v = { mapValue: { fields: doc.fields } };
      for (const key of fieldPath.split('.')) {
        const fields = v?.mapValue?.fields;
        v = isObj(fields) && Object.hasOwn(fields, key) ? fields[key] : undefined;
      }
      return v ?? { nullValue: null };
    });
  }

  // batchGet in batches a slow link can carry (readSize, at most 100), keeping every batch that came.
  async function getDocs(paths) {
    const all = [...paths];
    const out = new Map();
    for (let i = 0; i < all.length;) {
      const size = Math.min(readSize, BATCH_MAX);
      const some = all.slice(i, i + size);
      let found;
      try {
        found = await firestore.batchGet(some);
      } catch (err) {
        alive();
        await readFailed(err, some.length);
        continue;
      }
      alive();
      for (const [k, v] of found) out.set(k, v);
      i += some.length;
      readOk(some.length === size);
    }
    return out;
  }

  // A read that came: a full page at a smaller size counts towards reading bigger ones again. (A read stuck further
  // on still counts as one: readDrops is reset by a cycle that got through, succeeded().)
  function readOk(full) {
    if (!full || readSize >= READ_MAX) return;
    if (++readOks >= READ_GROW) {
      readSize = Math.min(READ_MAX, readSize * 2);
      readOks = 0;
    }
  }

  // A read cut short by its deadline (TIMEOUT: http.js gave up on it) on a link that answers: a link too slow to
  // carry that page in time (a first sync of long notes on a slow uplink). The read goes on from where it stopped in
  // pages half as big, down to one document, with no backoff and no "offline". A one-document read that can't get
  // through is tried again after a quiet backoff; the next cycle that can't get past it either shows it (paused), as
  // a read that never gets through (a document the link can't carry in time) must: the count goes on across cycles,
  // and only a cycle that got through resets it (succeeded). Whether the link answers at all, the head says: a link
  // that doesn't is offline. A dropped connection (NETWORK) says nothing about the page's size, and smaller pages
  // only make a link that loses answers of any size read more of them: that cycle fails as any request's would
  // (offline, a backoff), and the read starts again at the size it had.
  async function readFailed(err, size) {
    if (err?.code !== 'TIMEOUT' || offline()) throw err;
    await getHead();
    if (size <= 1) throw new SyncError(++readDrops >= 2 ? 'UNKNOWN' : 'DROPPED');
    readSize = Math.max(1, Math.floor(Math.min(readSize, size) / 2));
    readOks = 0;
    warn(`a read didn't get through; reading ${readSize} documents at a time`);
  }

  async function pull(h) {
    activity = 'pull';
    notify();
    const docs = h.rev > st.rev ? await collect((kind) => rangeQuery(kind, st.rev, h.rev)) : { projects: [], notes: [] };
    const remote = model.fromDocs({ head: h.doc, projectDocs: docs.projects, noteDocs: docs.notes, log: warn });
    await integrate({ remote, H: h.rev, headUpdateTime: h.updateTime });
  }

  // The whole account (5.9 step 3, 5.11): everything listed, then one incremental pull for what changed meanwhile.
  async function listAll(h, { progressNotes = false } = {}) {
    const total = h.stats?.notes || 0;
    let done = 0;
    if (progressNotes) progress = { what: 'download-notes', done, total };
    notify();
    const byName = { projects: new Map(), notes: new Map() };
    await collect((kind) => ({ from: [{ collectionId: kind }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] }),
      (kind, doc) => {
        byName[kind].set(doc.path, doc);
        if (progressNotes && kind === 'notes' && syncOf(doc).deleted !== true) {
          done++;
          progress = { what: 'download-notes', done, total: Math.max(total, done) };
        }
      });
    let last = h;
    const again = await getHead();
    if (again?.deleting) {
      await headOk(again);
      throw new Halt();
    }
    if (again && again.rev > h.rev) {
      const more = await collect((kind) => rangeQuery(kind, h.rev, again.rev));
      for (const kind of ['projects', 'notes']) for (const doc of more[kind]) byName[kind].set(doc.path, doc);
      last = again;
    }
    const remote = model.fromDocs({ head: last.doc, projectDocs: [...byName.projects.values()], noteDocs: [...byName.notes.values()], log: warn });
    return { rev: last.rev, h: last, remote };
  }

  async function fetchTrash(needed) {
    if (!needed.length) return new Map();
    const paths = needed.map((t) => [t.id, `users/${uid()}/trash/${t.kind}-${t.docId || codec.docId(t.id)}`]);
    const found = await getDocs(paths.map(([, p]) => p));
    const out = new Map();
    for (const [id, p] of paths) {
      const doc = found.get(p);
      if (!doc) continue;
      const f = codec.decodeFields(doc.fields);
      if (typeof f.data === 'string') out.set(id, { data: f.data });
    }
    return out;
  }

  // A merge runs in the mode in force when it runs, never the one its pull began in, and keeps that mode's
  // epoch: committing it ends a union or restore only if no newer one began meanwhile (a restore during a
  // pull, a reload that found the file unreadable).
  function runMerge(ctx, local) {
    if (!ctx.first) {
      ctx.mode = diffMode();
      ctx.epoch = modeEpoch;
    }
    return mergeRemote({
      shadow: ctx.first ? null : baseForHeld(ctx.remote, local),
      local,
      remote: ctx.remote,
      mode: ctx.first ? ctx.firstMode : ctx.mode,
      trash: ctx.trash || new Map(),
      devices: devicePlatforms(),
      deviceId: device.id,
      platform,
      now: now(),
      seeded: !ctx.first && st.seeded === true,
      stale: !ctx.first && st.stale === true,
      full: Boolean(ctx.full),
      minRev: ctx.minRev,
      held: ctx.first ? null : heldNotes(),
    });
  }

  // Notes whose version here the account hasn't seen and can't take yet: held with a project it doesn't have
  // (keepWithProjects), refused (the quarantine) or too large. To a delete in the account each is a change made here:
  // moved here into a held project, a note still lives in its old column there, and that column deleted elsewhere
  // (with the note as the account had it) mustn't take it from where it is now.
  function heldNotes() {
    const c = currentDiff();
    const out = new Set(c.diff.withProject);
    if (!c.local) return out;
    for (const k of [...c.diff.quarantined, ...tooLargeKeys(c)]) {
      if (k.startsWith('note:') && c.local.notes.has(k.slice(5))) out.add(k.slice(5));
    }
    return out;
  }

  // A project held here (refused, or too large) that the account has though this computer never had it from there (no
  // base): a stand-in another computer made for notes that went up without it ("Recovered notes", 5.7), never this
  // project's own fields. Merged with the account's version as the base, this computer's stays (it would have gone up
  // over it), and the account's enters the shadow as what the account holds.
  function baseForHeld(remote, local) {
    let out = shadow;
    if (!shadow) return out;
    for (const k of Object.keys(st.quarantine)) {
      if (!k.startsWith('project:')) continue;
      const id = k.slice(8);
      const d = remote?.projects?.get(id);
      const b = Object.hasOwn(shadow.projects, id) ? shadow.projects[id] : null;
      const based = isObj(b) && (b.d !== true || (isObj(b.f) && Object.keys(b.f).length > 0));
      if (!d || d.deleted === true || based || !local.projects.has(id)) continue;
      out = applyShadowDelta(out, { projects: shadowDelta({ projects: new Map([[id, d]]) }).projects, notes: {} });
    }
    return out;
  }

  const endsMode = (ctx) => !ctx.first && ctx.mode !== 'normal' && ctx.epoch === modeEpoch;

  // Merge, then either commit what the account holds (nothing for the page to do) or send the patch. The
  // merge reads the file as it is once nothing is awaited any more, so the patch matches its contentSeq.
  async function integrate(ctx) {
    for (let i = 0; i < 3 && disk; i++) {
      const seen = disk;
      const epoch = modeEpoch;
      const local = model.toModel(seen.value);
      const mode = ctx.first ? ctx.firstMode : diffMode();
      ctx.trash = await fetchTrash(neededTrash({ shadow: ctx.first ? null : shadow, local, remote: ctx.remote, mode }));
      await learnDevices(ctx.remote);
      if (disk === seen && epoch === modeEpoch) break;
    }
    if (!disk) { // the page is starting over on a board of its own (a seed): merged once that is saved
      want.pull = true;
      return;
    }
    deliver(ctx, runMerge(ctx, model.toModel(disk.value)));
  }

  function deliver(ctx, result) {
    if (replacing()) { // merged with the board before a restore: neither committed nor sent, but made again
      want.pull = true;
      return;
    }
    if (ctx.first && ctx.firstMode === 'use-account' && !useAccountOk(ctx, result)) return;
    if (ctx.drop) for (const kind of ['projects', 'notes']) for (const id of ctx.drop[kind]) put(result.shadowAfter[kind], id, null);
    if (!result.patch) {
      commitRemote(ctx, result.shadowAfter);
      return;
    }
    const patch = { ...result.patch, notices: [...result.patch.notices] };
    if (result.backupFirst && !backupIncoming()) {
      patch.notices = patch.notices.filter((n) => n.code !== 'REMOTE_DELETES'); // its text says a backup was made
    }
    send(ctx, patch, result.shadowAfter);
  }

  const localBlank = (local) => local.projects.size === 0 || model.isPristineBoard(local);

  // "Use my account's board" removes what only this computer has, and gives notes both boards have the
  // account's text with no copy, so it goes ahead only for the board it was decided for (5.9, 6.3): one still
  // blank or pristine when no question was asked; otherwise one a before-sync backup holds, made again here
  // when the file changed after the answer.
  function useAccountOk(ctx, result) {
    if (localBlank(model.toModel(disk.value))) return true;
    if (ctx.auto) { // something was written meanwhile: no longer a blank board, so now it is a question
      firstAgain();
      return false;
    }
    if (!result.patch?.changesContent) return true; // only counts rise here: nothing of this board is replaced
    if (disk.sha && st.firstBackup === disk.sha) return true;
    if (!disk.sha) { // the page shows a board no file holds yet: its save first, then the backup
      probe(ctx);
      return false;
    }
    if (backupBeforeSync('use-account')) return true;
    warn("this board wasn't replaced: no backup of it could be made");
    firstAgain();
    return false;
  }

  // The drafts of the columns a patch removes, as a file holds them ('' when none holds one).
  function draftsIn(value, removes) {
    const ids = new Set(removes);
    const out = [];
    for (const p of list(value?.projects)) {
      if (!isObj(p) || !ids.has(p.id)) continue;
      const text = typeof p.draft === 'string' ? p.draft : '';
      const pics = model.cleanImages(p.draftImages).map((i) => i.id);
      if (text.trim() || pics.length) out.push([p.id, text, pics]);
    }
    return out.length ? sha256(JSON.stringify(out)) : '';
  }

  // The page applies "Use my account's board" once nothing holds it back, and the draft rule doesn't keep a
  // column for it (6.3): a draft saved into a column it removes while it waits goes into a before-sync backup
  // first. A few times per patch (the newest before-sync backups are kept); a draft saved together with the
  // acknowledging save never reaches the disk here, which only the page can prevent.
  function keepDrafts() {
    const f = inFlight;
    if (!f?.removes || f.probe || f.draftBackups >= 5) return;
    const d = draftsIn(disk.value, f.removes);
    if (!d || d === f.drafts) return;
    if (backupBeforeSync('use-account')) {
      f.drafts = d;
      f.draftBackups++;
    }
  }

  // The first-sync decision once more (the listing is reused while the head stays put).
  function firstAgain() {
    st.firstAnswer = null;
    saveState();
    want.pull = true;
    kick();
  }

  // At most once an hour; false when no backup was made now.
  function backupIncoming() {
    const t = now();
    if (st.lastIncomingBackupAt && t - st.lastIncomingBackupAt < 60 * MIN) return false;
    try {
      const id = backups?.create?.('before-sync', { reason: 'incoming' });
      st.lastIncomingBackupAt = t;
      saveState();
      return Boolean(id);
    } catch (err) {
      warnErr("the before-sync backup couldn't be made", err);
      return false;
    }
  }

  // true when a backup of the file as it is now was made (it then counts for that file, by its fingerprint).
  function backupBeforeSync(reason) {
    try {
      const id = backups?.create?.('before-sync', { reason });
      if (!id) return false;
      st.firstBackup = disk?.sha ?? null;
      saveState();
      return true;
    } catch (err) {
      warnErr("the before-sync backup couldn't be made", err);
      return false;
    }
  }

  // The account's state at H becomes the shadow: the page already has it (5.6 step 4), or acknowledged it.
  function commitRemote(ctx, delta) {
    setShadow(applyShadowDelta(ctx.first ? null : shadow, delta));
    writeShadow();
    st.rev = ctx.H;
    st.headUpdateTime = ctx.headUpdateTime;
    st.ack = null;
    if (ctx.first) {
      st.headCreatedAt = ctx.createdAt ?? null; // which head this shadow belongs to
      finishFirst();
    }
    if (ctx.audit) st.lastAuditAt = now();
    if (endsMode(ctx)) endMode();
    saveState();
    want.push = true;
    diffCache = null;
    prefetchThumbs();
  }

  // Nothing is written yet: until the page's acknowledging save, the shadow stays where it is (5.6). While
  // the engine halts, no patch goes: the next run pulls again. A run that stopped while it merged ends here.
  function send(ctx, patch, delta) {
    if (stopped) throw new Stopped();
    if (halting) return;
    const seq = contentSeqNow();
    if (patch.changesContent && seq === null) return probe(ctx);
    const id = newPatchId();
    inFlight = { ...ctx, id, delta, disk, stale: false, waiting: false, probe: false, from: writerOf(ctx.remote), removes: null };
    if (ctx.first && ctx.firstMode === 'use-account' && patch.projects.remove.length) {
      inFlight.removes = patch.projects.remove;
      inFlight.drafts = draftsIn(disk.value, inFlight.removes);
      inFlight.draftBackups = ctx.draftBackups || 0;
    }
    arm('waiting', T.waiting, () => {
      if (inFlight?.id === id) {
        inFlight.waiting = true;
        notify();
      }
    });
    page.sendPatch({ ...patch, id, session: pageSession, basedOnContentSeq: seq ?? 0 });
  }

  const newPatchId = () => `p${++patchSerial}-${crypto.randomBytes(4).toString('hex')}`;

  // A patch that changes nothing: the page applies it at once, whatever it is doing, and acknowledges it
  // with a save that carries its session and contentSeq. The page keeps only the newest patch, so this one
  // also replaces a patch it is holding back.
  function emptyPatch(id) {
    page.sendPatch({
      id, session: pageSession, basedOnContentSeq: 0, changesContent: false, resetHistory: false,
      projects: { upsert: {}, remove: [], order: null }, notes: { upsert: {}, remove: [], counters: {} }, lists: {}, notices: [],
    });
  }

  // The probe: an empty patch whose acknowledging save tells the page's contentSeq; the real patch then goes,
  // based on that save.
  function probe(ctx) {
    if (stopped) throw new Stopped();
    if (halting) return;
    const id = newPatchId();
    inFlight = { ...ctx, id, delta: null, disk, stale: false, waiting: false, probe: true, from: writerOf(ctx.remote) };
    emptyPatch(id);
  }

  function reprobe() {
    const f = inFlight;
    dropInFlight();
    probe(f);
  }

  function probed() {
    const ctx = { ...inFlight, probe: false };
    dropInFlight();
    deliver(ctx, runMerge(ctx, model.toModel(disk.value)));
  }

  // The page saved the patch (5.6 step 6). The marker, with the shadow delta, goes into state.json together
  // with that save's fingerprint; then shadow.json advances, then state.json again (5.18).
  function acked() {
    const f = inFlight;
    dropInFlight();
    st.ack = {
      patchId: f.id, H: f.H, ackedAt: now(), headUpdateTime: f.headUpdateTime, first: Boolean(f.first), audit: Boolean(f.audit),
      createdAt: f.createdAt ?? null, endMode: endsMode(f), delta: f.delta,
    };
    saveState();
    commitRemote(f, f.delta);
    notify();
  }

  // A stale patch: the same account documents against the newer file (5.6 step 7).
  function remerge() {
    const f = inFlight;
    dropInFlight();
    deliver(f, runMerge(f, model.toModel(disk.value)));
  }

  async function fullResync(h) {
    activity = 'pull';
    const listing = await listAll(h);
    union({}); // the whole account against this board, with nothing deleted (5.11)
    await integrate({ remote: listing.remote, H: listing.rev, headUpdateTime: listing.h.updateTime, full: true, minRev: listing.h.minRev });
  }

  // ---- pushing

  function guardTrips(diff) {
    if (!diff.tombstones.length) return false;
    if (st.labels.some((l) => EXPLAINING.has(l))) return false;
    return diff.deletions.notes >= 5 || diff.deletions.projects >= 1;
  }

  // The question stands for the deletions it was asked about (st.massDelete) until it is answered or they are
  // undone: a delete made since, with its label, explains only itself.
  function massPending(diff) {
    const asked = new Set(list(st.massDelete?.ids));
    return asked.size > 0 && diff.tombstones.some((t) => asked.has(`${t.kind}:${t.id}`));
  }

  function quarantine(item, code) {
    const sig = quarantineSig(item);
    put(st.quarantine, `${item.kind}:${item.id}`, { code, sig: sig === 'deleted' ? sig : sigHash(sig), at: now() });
    qVersion++;
  }

  function unquarantine(item) {
    const k = `${item.kind}:${item.id}`;
    if (Object.hasOwn(st.quarantine, k)) {
      delete st.quarantine[k];
      qVersion++;
    }
  }

  // The diff's too-large items as quarantine keys. push() records them (noteTooLarge); until one has run since
  // (offline, or within the push debounce) only the diff knows them, and they exist only here all the same.
  function tooLargeKeys(c = currentDiff()) {
    return c.local ? c.diff.tooLarge.map((id) => `${c.local.notes.has(id) ? 'note' : 'project'}:${id}`) : [];
  }

  // Too-large items never leave this computer; the quarantine records them for the status line.
  function noteTooLarge(diff, local) {
    for (const id of diff.tooLarge) {
      const n = local.notes.get(id);
      const p = n ? null : local.projects.get(id);
      const item = n ? { kind: 'note', id, fields: n.fields, project: n.project, list: n.list, reason: 'change' }
        : p ? { kind: 'project', id, fields: p.fields, reason: 'change' } : null;
      if (!item) continue;
      const k = `${item.kind}:${id}`;
      const sig = sigHash(quarantineSig(item));
      if (st.quarantine[k]?.code !== 'TOO_LARGE' || st.quarantine[k].sig !== sig) {
        put(st.quarantine, k, { code: 'TOO_LARGE', sig, at: now() });
        qVersion++;
      }
    }
  }

  // A skipped picture no note or draft here shows any more stops counting for the status line.
  function forgetSkippedPictures(local) {
    const skipped = st.skippedPictures;
    if (!isObj(skipped) || !Object.keys(skipped).length) return;
    const shown = new Set();
    for (const n of local.notes.values()) for (const id of noteImageIds(n.fields)) shown.add(id);
    for (const p of list(disk?.value?.projects)) for (const i of model.cleanImages(p?.draftImages)) shown.add(i.id);
    let changed = false;
    for (const id of Object.keys(skipped)) {
      if (!shown.has(id)) {
        delete skipped[id];
        changed = true;
      }
    }
    if (changed) saveState();
  }

  // After a whole push: only what the diff still holds back (or this push refused) stays quarantined.
  // Refused pictures have their own bookkeeping (picturesIfDue).
  function pruneQuarantine(keep) {
    for (const k of Object.keys(st.quarantine)) {
      if (!keep.has(k) && !k.startsWith('picture:')) {
        delete st.quarantine[k];
        qVersion++;
      }
    }
  }

  function encodeItem(item) {
    const docId = codec.docId(item.id);
    const by = device.id;
    let fields;
    let trash = null;
    try {
      if (!item.reason) {
        fields = model.tombstoneFields({ rev: 1, key: item.key, by, project: item.project, list: item.list, id: item.id });
        trash = {
          kind: S(item.kind),
          data: S(item.trashData ?? JSON.stringify(item.fields || {})),
          rev: I(1),
          by: S(by),
          expireAt: { timestampValue: new Date(cloudNow() + T.trash).toISOString() },
        };
        if (item.kind === 'note') Object.assign(trash, { project: S(item.project), list: S(item.list) });
      } else {
        fields = item.kind === 'note' ? model.encodeNote(item, { rev: 1, by }) : model.encodeProject(item, { rev: 1, by });
      }
    } catch (err) {
      if (err?.name !== 'UnrepresentableError') throw err;
      quarantine(item, 'PERMISSION'); // a hand-edited file Firestore can't hold
      return null;
    }
    const kind = plural(item.kind);
    return {
      item,
      docId,
      path: `users/${uid()}/${kind}/${docId}`,
      trashPath: trash ? `users/${uid()}/trash/${item.kind}-${docId}` : null,
      fields,
      trash,
      writes: trash ? 2 : 1,
      bytes: codec.estimateBytes(fields) + (trash ? codec.estimateBytes(trash) : 0),
      pictures: item.reason && item.kind === 'note' ? noteImageIds(item.fields) : [],
    };
  }

  // 5.5 step 5: projects that appear, notes without pictures, notes with pictures, note tombstones, other
  // project changes, project tombstones; each chunk at most 400 writes and 8 MiB.
  function planChunks(diff) {
    const groups = [[], [], [], [], [], []];
    for (const u of diff.upserts) {
      if (u.kind === 'project') groups[u.reason === 'new' || u.reason === 'undelete' ? 0 : 4].push(u);
      else groups[noteImageIds(u.fields).length ? 2 : 1].push(u);
    }
    for (const t of diff.tombstones) groups[t.kind === 'note' ? 3 : 5].push(t);
    const chunks = [];
    let cur = null;
    for (const item of groups.flat()) {
      const e = encodeItem(item);
      if (!e) continue;
      if (!cur || cur.writes + e.writes > MAX_WRITES - 1 || (cur.items.length && cur.bytes + e.bytes > commitBudget)) {
        cur = { items: [], writes: 0, bytes: 0, pictures: [] };
        chunks.push(cur);
      }
      cur.items.push(e);
      cur.writes += e.writes;
      cur.bytes += e.bytes;
      cur.pictures.push(...e.pictures);
    }
    if (!chunks.length && diff.board) chunks.push({ items: [], writes: 0, bytes: 0, pictures: [] });
    for (const c of chunks) c.board = diff.board;
    return chunks;
  }

  function chunkDelta(chunk, rev, results, headTime) {
    const delta = { rev, projects: {}, notes: {} };
    if (chunk.board) delta.board = { joiner: chunk.board.joiner };
    let w = 1;
    for (const e of chunk.items) {
      const updateTime = results?.[w]?.updateTime ?? headTime ?? null;
      w += e.writes;
      put(delta[plural(e.item.kind)], e.item.id, pushedEntry(e.item, { rev, updateTime, docId: e.docId }));
    }
    return delta;
  }

  // The head names the commit as this computer's last one (commits.<device id>). Other computers' commits mask
  // only their own entry, so it stays there after they rewrite every document of it (5.5 step 13).
  function buildWrites(chunk, rev, commitId) {
    const after = applyShadowDelta(shadow, chunkDelta(chunk, rev, null, null));
    const board = chunk.board ?? shadow.board ?? { joiner: null };
    const writes = [{
      update: {
        name: firestore.name(headPath()),
        fields: {
          rev: I(rev), lastDevice: S(device.id), board: boardValue(board), stats: statsValue(model.countLive(after)),
          commits: M({ [device.id]: S(commitId) }),
        },
      },
      updateMask: { fieldPaths: ['rev', 'lastDevice', 'board', 'stats', `commits.\`${device.id}\``] },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { updateTime: st.headUpdateTime },
    }];
    for (const e of chunk.items) {
      e.fields._sync.mapValue.fields.rev = I(rev);
      writes.push({
        update: { name: firestore.name(e.path), fields: e.fields },
        updateTransforms: [{ fieldPath: '_sync.at', setToServerValue: 'REQUEST_TIME' }],
      });
      if (e.trash) {
        e.trash.rev = I(rev);
        writes.push({
          update: { name: firestore.name(e.trashPath), fields: e.trash },
          updateTransforms: [{ fieldPath: 'deletedAt', setToServerValue: 'REQUEST_TIME' }],
        });
      }
    }
    return writes;
  }

  // A committed chunk: exactly its entities enter the shadow (5.5 step 7).
  function landed(chunk, rev, results) {
    const headTime = results?.[0]?.updateTime ?? null;
    setShadow(applyShadowDelta(shadow, chunkDelta(chunk, rev, results, headTime)));
    writeShadow();
    for (const e of chunk.items) unquarantine(e.item);
    st.rev = rev;
    st.headUpdateTime = headTime;
    st.lastPushAt = now();
    outgoing = null;
    st.outgoing = null;
    headMoves = 0;
    drops = 0;
    if (commitBudget < MAX_COMMIT_BYTES && ++budgetOks >= 3) { // the link carries these: try bigger ones again
      commitBudget = Math.min(MAX_COMMIT_BYTES, commitBudget * 2);
      budgetOks = 0;
    }
    saveState();
  }

  // Pull, merge, let the page acknowledge, recompute and try again (5.5 step 8); five in a row back off.
  function moved() {
    headMoves++;
    want.pull = true;
    want.push = true;
    if (headMoves >= 5) {
      headMoves = 0;
      throw new SyncError('ABORTED');
    }
    rerun = true;
    return 'moved';
  }

  async function push() {
    want.push = false;
    if (badRequest) return;
    if (replacing() || (hasPendingWrite() && !finalRun)) {
      want.push = true; // the newer save (or the restored board) is on its way: it asks again
      return;
    }
    disarm('push'); // this push takes every save on disk
    const { diff, local } = currentDiff();
    if (!local) return;
    noteTooLarge(diff, local);
    forgetSkippedPictures(local);
    const keep = new Set([...diff.quarantined, ...tooLargeKeys({ diff, local })]);
    // Labels explain the deletions waiting to go up. With none waiting (a note deleted before it ever went up, a
    // delete undone), they would explain later ones they have nothing to do with (5.5 step 4). A deletion held back
    // (in quarantine, or a project's tombstone waiting for a note held here) keeps them.
    const heldTombstone = diff.heldProjects.length > 0 || diff.quarantined.some((k) => st.quarantine[k]?.sig === 'deleted');
    if (st.labels.length && diffMode() === 'normal' && !diff.tombstones.length && !heldTombstone) {
      st.labels = [];
      saveState();
    }
    // The question about deletions no undo label explains lasts while they do (an Undo ends it), and holds the
    // whole push until it is answered.
    const asked = massPending(diff);
    const trips = !massDeleteOk && !st.firstUpload && (asked || guardTrips(diff));
    if (!trips && (st.massDelete || st.choice?.kind === 'mass-delete')) {
      st.massDelete = null;
      if (st.choice?.kind === 'mass-delete') setChoice(null);
      else saveState();
    }
    if (!diff.pending) {
      pruneQuarantine(keep);
      settle();
      return;
    }
    if (diff.counterOnly && !countersDue && !finalRun) {
      if (!timer.counters) {
        arm('counters', T.counters, () => {
          countersDue = true;
          want.push = true;
          kick();
        });
      }
      return;
    }
    if (trips) {
      if (!asked) st.massDelete = { ids: diff.tombstones.map((t) => `${t.kind}:${t.id}`) };
      const count = diff.deletions.notes;
      if (st.choice?.kind !== 'mass-delete' || st.choice.count !== count) setChoice({ kind: 'mass-delete', count });
      else if (!asked) saveState();
      return;
    }
    const labelsAt = st.labels.length;
    const chunks = planChunks(diff);
    const bulk = chunks.length > 1 || st.firstUpload === true;
    const notes = chunks.reduce((n, c) => n + c.items.filter((e) => e.item.kind === 'note' && e.item.reason).length, 0);
    let notesDone = 0;
    activity = 'push';
    if (bulk) progress = { what: 'upload-notes', done: 0, total: notes };
    notify();
    let refusedTombstone = false;
    tombstoneHeld = false;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = housed(chunks[i]);
      if (!chunk.items.length && (!chunk.board || chunk.board.joiner === (shadow.board?.joiner ?? null))) continue;
      await uploadPictures(chunk.pictures, { bulk });
      if (bulk) progress = { what: 'upload-notes', done: notesDone, total: notes };
      const r = await commitChunk(chunk);
      if (r === 'moved' || r === 'stop') return;
      for (const e of chunk.items) {
        const k = `${e.item.kind}:${e.item.id}`;
        if (Object.hasOwn(st.quarantine, k)) {
          keep.add(k);
          if (!e.item.reason) refusedTombstone = true;
        } else if (e.item.kind === 'note' && e.item.reason) {
          notesDone++;
        }
      }
      if (bulk) {
        progress = { what: 'upload-notes', done: notesDone, total: notes };
        notify();
      }
      if (bulk && i < chunks.length - 1) {
        await sleep(T.bulk);
        alive();
      }
    }
    // The labels explained the tombstones this push sent. A union or restore sends none, and a tombstone held
    // back (in quarantine, or out of a commit by housed) goes later: then they stay for it.
    if (diffMode() === 'normal' && !refusedTombstone && !heldTombstone && !tombstoneHeld) st.labels = st.labels.slice(labelsAt);
    pruneQuarantine(keep);
    countersDue = false;
    disarm('counters');
    diffCache = null;
    settle();
    pendingCount = currentDiff().diff.pending;
  }

  // Everything this computer had is in the account: the first upload is over, and so is a Delete-everywhere
  // answer. (A union or restore ended when its merge was committed.)
  function settle() {
    if (st.mode === 'normal') {
      st.seeded = false;
      st.stale = false;
    }
    st.firstUpload = false;
    massDeleteOk = false;
    saveState();
  }

  async function commitChunk(chunk) {
    for (let waits = 0; ;) {
      if (!st.headUpdateTime) return moved();
      const rev = st.rev + 1;
      let res;
      try {
        res = await sendChunk(chunk, rev);
      } catch (err) {
        alive();
        const code = err?.code;
        if (code === 'HEAD_MOVED' || code === 'ABORTED') return moved();
        if (mayHaveLanded(code)) return lost(chunk, rev, err);
        if (code === 'TOO_LARGE') return split(chunk, 'TOO_LARGE');
        if (code === 'PERMISSION') {
          const r = await refusedCommit(waits);
          if (r === 'again') {
            waits++;
            continue;
          }
          return r === 'split' ? split(chunk, 'PERMISSION') : r;
        }
        if (code === 'BAD_REQUEST') badRequest = true;
        throw err;
      }
      alive();
      landed(chunk, rev, res?.writeResults);
      return 'ok';
    }
  }

  // A 403 isn't always a refusal: a race the rules saw before the precondition, or the moment a rules
  // deploy replaces the release. The head decides, then a short wait, and only then the split (5.5 step 9).
  async function refusedCommit(waits) {
    const h = await getHead();
    if (!(await headOk(h))) return 'stop';
    if (h.rev !== st.rev || h.updateTime !== st.headUpdateTime) return moved();
    if (waits < T.refused.length) {
      await sleep(jitter(T.refused[waits]));
      alive();
      return 'again';
    }
    return 'split';
  }

  // Halves, each with its own head bump, until single items fail; those are quarantined.
  async function split(chunk, code) {
    if (chunk.items.length <= 1) {
      for (const e of chunk.items) quarantine(e.item, code);
      saveState();
      return chunk.items.length ? 'partial' : 'stop';
    }
    const mid = Math.ceil(chunk.items.length / 2);
    for (const items of [chunk.items.slice(0, mid), chunk.items.slice(mid)]) {
      // A project refused in the half before: its notes stay here with it (housed), never up on their own.
      const part = housed({ ...chunk, items, bytes: items.reduce((n, e) => n + e.bytes, 0) });
      if (!part.items.length) continue;
      const rev = st.rev + 1;
      let res;
      try {
        res = await sendChunk(part, rev);
      } catch (err) {
        alive();
        const c = err?.code;
        if (c === 'HEAD_MOVED' || c === 'ABORTED') return moved();
        if (mayHaveLanded(c)) {
          const r = await lost(part, rev, err);
          if (r === 'ok') continue;
          return r;
        }
        if (c === code) {
          if (c === 'PERMISSION') {
            const h = await getHead();
            if (!(await headOk(h))) return 'stop';
            if (h.rev !== st.rev || h.updateTime !== st.headUpdateTime) return moved();
          }
          const r = await split(part, code);
          if (r === 'moved' || r === 'stop') return r;
          continue;
        }
        throw err;
      }
      alive();
      landed(part, rev, res?.writeResults);
    }
    return 'partial';
  }

  // Answers after which a commit may still have been applied: none came (NETWORK, TIMEOUT), or a 5xx did
  // (SERVER: 500, 503, 504 DEADLINE_EXCEEDED, an answer that isn't JSON).
  const mayHaveLanded = (code) => NET.has(code) || code === 'SERVER';

  // One chunk out (5.5 step 6). Until its answer is known, state.json says what it carried (st.outgoing): an
  // answer lost, or one that comes after a crash or a quit, is then settled by the next head read.
  async function sendChunk(chunk, rev) {
    const id = `${rev}-${crypto.randomBytes(6).toString('hex')}`;
    outgoing = { id, rev, chunk };
    st.outgoing = outgoingRecord(id, rev, chunk);
    saveState();
    try {
      return await firestore.commit(buildWrites(chunk, rev, id));
    } catch (err) {
      if (!mayHaveLanded(err?.code)) { // it never landed
        outgoing = null;
        st.outgoing = null;
      }
      throw err;
    }
  }

  // A chunk's entities as its commit writes them, with each one's fields as hashes, the whole and each field's
  // own: state.json stays small, and is written after every save.
  function outgoingRecord(id, rev, chunk) {
    const items = chunk.items.map((e) => {
      const { f, ...entry } = pushedEntry(e.item, { rev, docId: e.docId });
      const out = { ...entry, h: fieldsHash(f) };
      if (e.item.reason) out.hk = fieldHashes(f);
      return [plural(e.item.kind), e.item.id, out];
    });
    return { id, rev, board: chunk.board ? { joiner: chunk.board.joiner ?? null } : null, items };
  }

  // The commit whose answer never came: did it land? The head names this computer's last commit that did
  // (commits.<device id>), however many came after it and whatever they rewrote (5.5 step 13, 5.18).
  // → 'landed' (the head is still at it), 'partial' (others committed after it: its entities enter the shadow
  // at its rev, so their changes merge as changes and its copies count once), 'no', null (none outstanding),
  // or 'moved' (the account changed while its documents were read: the next head read settles it).
  async function settleOutgoing(h) {
    const o = outgoing;
    if (!o || !h) return null;
    const named = Object.hasOwn(h.commits, device.id) ? h.commits[device.id] : null;
    const ours = named !== null ? named === o.id : h.rev === o.rev && h.lastDevice === device.id;
    if (!ours || o.rev !== st.rev + 1 || h.rev < o.rev) {
      outgoing = null;
      st.outgoing = null;
      return 'no';
    }
    const whole = h.rev === o.rev;
    if (whole && o.chunk) {
      outgoing = null;
      st.outgoing = null;
      landed(o.chunk, o.rev, [{ updateTime: h.updateTime }]);
      return 'landed';
    }
    const delta = o.chunk ? chunkDelta(o.chunk, o.rev, null, whole ? h.updateTime : null) : await restoredDelta(o, h, whole);
    if (!delta) return 'moved'; // still outstanding
    outgoing = null;
    st.outgoing = null;
    setShadow(applyShadowDelta(shadow, delta));
    writeShadow();
    for (const e of o.chunk?.items || []) unquarantine(e.item);
    if (whole) {
      st.rev = o.rev;
      st.headUpdateTime = h.updateTime;
      st.lastPushAt = now();
    }
    saveState();
    return whole ? 'landed' : 'partial';
  }

  // What that commit wrote, after a restart: only hashes of its fields are known (st.outgoing). Fields here or in
  // the shadow that match are exact. Any other entity's document is read: this commit's own is what it wrote,
  // and one a later writer rewrote gives back, field by field under its hash, whatever that writer left alone
  // (as this computer and the shadow do). A field found nowhere was changed on both sides since; it is set apart
  // from both (a note's text and pictures: null, so they merge as a conflict copy, never as an overwrite; any
  // other field: the account's, so this computer's wins, as when both changed it). null: the account moved
  // meanwhile.
  async function restoredDelta(o, h, whole) {
    const delta = { rev: o.rev, projects: {}, notes: {} };
    if (o.board) delta.board = { joiner: typeof o.board.joiner === 'string' ? o.board.joiner : null };
    const local = disk ? model.toModel(disk.value) : null;
    const unsure = [];
    for (const item of list(o.items)) {
      const [kind, id, e] = list(item);
      if ((kind !== 'projects' && kind !== 'notes') || typeof id !== 'string' || !isObj(e)) continue;
      const here = local?.[kind].get(id)?.fields ?? null;
      const was = Object.hasOwn(shadow[kind], id) && isObj(shadow[kind][id]) && isObj(shadow[kind][id].f) ? shadow[kind][id].f : null;
      const { h: hash, hk, ...entry } = e;
      const f = [here, was].find((x) => x && fieldsHash(x) === hash);
      if (f) put(delta[kind], id, { ...entry, f, u: whole ? h.updateTime : null });
      else if (e.d === true) put(delta[kind], id, { ...entry, f: was || {}, u: whole ? h.updateTime : null });
      else unsure.push({ kind, id, entry, hk, here, was, path: `users/${uid()}/${kind}/${e.i || codec.docId(id)}` });
    }
    if (!unsure.length) return delta;
    const found = await getDocs(unsure.map((x) => x.path));
    for (const x of unsure) {
      const doc = found.get(x.path) || null;
      const s = doc ? syncOf(doc) : {};
      if (doc && int(s.rev) > h.rev) return null; // a commit after that head read: its rev isn't pulled yet
      const d = doc ? model.fromDocs({ [x.kind === 'notes' ? 'noteDocs' : 'projectDocs']: [doc] })[x.kind].get(x.id) : null;
      if (!d) continue; // not in the account (never so for a commit that landed): the shadow keeps what it had
      if (d.rev === o.rev && d.by === device.id) {
        put(delta[x.kind], x.id, { ...x.entry, f: d.fields, u: doc.updateTime ?? null });
        continue;
      }
      const f = rebuildFields(x.kind, x.hk, [x.here, x.was, d.deleted ? null : d.fields], d.deleted ? null : d.fields);
      put(delta[x.kind], x.id, { ...x.entry, f, u: null });
    }
    return delta;
  }

  const fieldHash = (v) => sha256(model.fieldsSig(v)).slice(0, 16);

  function fieldHashes(f) {
    const out = {};
    for (const k of Object.keys(f)) if (f[k] !== undefined) put(out, k, fieldHash(f[k]));
    return out;
  }

  // The fields under these per-field hashes, from the versions at hand; see restoredDelta for a field found in
  // none of them. A record without them (none is ever written so) gives the account's fields.
  function rebuildFields(kind, hk, versions, account) {
    if (!isObj(hk)) return account || {};
    const out = {};
    for (const k of Object.keys(hk)) {
      const v = versions.find((x) => isObj(x) && Object.hasOwn(x, k) && x[k] !== undefined && fieldHash(x[k]) === hk[k]);
      if (v) put(out, k, v[k]);
      else if (kind === 'notes' && (k === 'text' || k === 'images')) put(out, k, null);
      else if (isObj(account) && Object.hasOwn(account, k) && account[k] !== undefined) put(out, k, account[k]);
    }
    return out;
  }

  // Such a commit is never sent again blindly: the head says whether it landed. A head that names no commit of
  // this computer's leaves it to the chunk's own documents (commits are atomic).
  async function lost(chunk, rev, err) {
    let h;
    try {
      h = await getHead();
    } catch (e) {
      alive();
      throw err; // still unreachable: the commit stays outstanding, and the next head read settles it
    }
    const named = Boolean(h) && Object.hasOwn(h.commits, device.id);
    const settled = await settleOutgoing(h);
    if (settled === 'landed') return 'ok';
    if (settled === 'partial' || settled === 'moved') return moved();
    if (h && h.rev === st.rev) return notLanded(chunk, err);
    if (!(await headOk(h))) return 'stop';
    if (h.rev === rev || named) return moved(); // another computer's commit took that rev, or ours never landed
    const paths = chunk.items.map((e) => e.path);
    const found = paths.length ? await getDocs(paths) : new Map();
    alive();
    const ours = (doc) => doc && int(syncOf(doc).rev) === rev && syncOf(doc).by === device.id;
    if ([...found.values()].some(ours)) {
      // It landed. Its entities become the base, so later writers' changes to them merge as changes.
      const delta = { projects: {}, notes: {} };
      if (chunk.board) delta.board = { joiner: chunk.board.joiner };
      for (const e of chunk.items) {
        const doc = found.get(e.path);
        put(delta[plural(e.item.kind)], e.item.id, pushedEntry(e.item, { rev, updateTime: ours(doc) ? doc.updateTime : null, docId: e.docId }));
        unquarantine(e.item);
      }
      setShadow(applyShadowDelta(shadow, delta));
      writeShadow();
      saveState();
    }
    return moved();
  }

  // It never landed. A server error backs off. A commit lost on the way while the head just answered means
  // the link works but can't carry that much in time (a slow uplink and an 8 MiB chunk): the push is planned
  // again in smaller commits, down to 256 KiB, before backing off; and the status isn't "offline". One that
  // can't get smaller is tried again after a quiet backoff (a dropped connection); only a few in a row are
  // shown as something wrong.
  function notLanded(chunk, err) {
    if (!NET.has(err?.code)) throw err;
    if (chunk.bytes > MIN_COMMIT_BYTES && commitBudget > MIN_COMMIT_BYTES) {
      commitBudget = Math.max(MIN_COMMIT_BYTES, Math.floor(Math.min(commitBudget, chunk.bytes) / 2));
      budgetOks = 0;
      warn(`a commit didn't get through; trying commits of ${Math.round(commitBudget / 1024)} KiB`);
      want.push = true;
      rerun = true;
      return 'moved';
    }
    throw new SyncError(++drops >= 3 ? 'UNKNOWN' : 'DROPPED');
  }

  // ---- pictures (4.6)

  // What the account still lacks of a picture: 1 its thumbnail (unless none can be made here), 2 the picture.
  function lacks(id) {
    const bits = st.uploaded[id] || 0;
    return (bits & 2 ? 0 : 2) | (bits & 1 || thumbFailed.has(id) ? 0 : 1);
  }

  // The account holds this part of a picture: uploaded, found there already, or fetched from it.
  function markHave(id, bit) {
    put(st.uploaded, id, (st.uploaded[id] || 0) | bit);
  }

  // Before the commit that references them. A refusal that isn't the account's deletion is waited out
  // briefly when patient (a rules deploy lasts seconds), then held like a refused note ('picture:<id>' in
  // the quarantine: Sync paused, with Retry) when recorded; the note goes up without it, and
  // picturesIfDue() tries it again on its own backoff.
  async function uploadPictures(ids, { bulk = false, patient = true, record = true } = {}) {
    if (!images || !ids.length) return;
    const skipped = st.skippedPictures || {};
    const todo = [...new Set(ids)].filter((id) => IMAGE_ID.test(id) && lacks(id) && !skipped[id] && safeHas(id, false));
    if (!todo.length) return;
    let done = 0;
    const total = todo.length;
    const before = progress;
    if (bulk) progress = { what: 'upload-pictures', done, total };
    notify();
    const attempt = async (some) => {
      const refusedIds = [];
      await pool(some, 3, async (id) => {
        const r = await uploadPicture(id);
        alive();
        if (r === 'refused') {
          refusedIds.push(id);
          return;
        }
        done++;
        if (bulk) progress = { what: 'upload-pictures', done, total };
      });
      return refusedIds;
    };
    try {
      let left = await attempt(todo);
      if (left.length && !(await headOk(await getHead()))) throw new Halt(); // the account is being deleted
      for (let w = 0; patient && left.length && w < T.refused.length; w++) {
        await sleep(jitter(T.refused[w]));
        alive();
        left = await attempt(left);
      }
      for (const id of left) {
        if (record) refusePicture(id);
        else warn('a picture was refused');
      }
    } finally {
      if (bulk) progress = before;
      if (!stopped && cycleGen === gen) saveState(); // an answer after a stop or a deletion writes nothing
    }
  }

  function refusePicture(id) {
    const k = `picture:${id}`;
    const tries = int(st.quarantine[k]?.tries) + 1;
    const wait = jitter(T.backoff[Math.min(tries, T.backoff.length) - 1]);
    put(st.quarantine, k, { code: 'PERMISSION', sig: '', at: now(), tries, next: now() + wait });
    qVersion++;
    warn('a picture was refused; it will be tried again');
  }

  function unrefusePicture(id) {
    const k = `picture:${id}`;
    if (!Object.hasOwn(st.quarantine, k)) return;
    delete st.quarantine[k];
    qVersion++;
  }

  function safeHas(id, thumb) {
    try {
      return Boolean(images.has(id, thumb));
    } catch {
      return false;
    }
  }

  // The picture's size without reading it, where the images module can tell.
  function pictureSize(id) {
    try {
      const n = images.size?.(id, false);
      return Number.isSafeInteger(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  // The thumbnail, then the picture. → 'ok'; 'skipped' (over 32 MB: it stays here, and its note still
  // syncs); or 'refused'.
  async function uploadPicture(id) {
    if (!((st.uploaded[id] || 0) & 1) && !thumbFailed.has(id)) {
      if (!safeHas(id, true)) {
        try {
          await images.ensureThumb?.(id);
        } catch {}
        alive();
      }
      if (!safeHas(id, true)) thumbFailed.add(id); // none can be made: other computers use the picture itself
      else if (await sendPicture(id, true)) markHave(id, 1);
      else return 'refused';
    }
    if (!((st.uploaded[id] || 0) & 2)) {
      const size = pictureSize(id);
      const bytes = size === null ? await images.readFile(id, false) : null;
      alive();
      if ((size ?? bytes.length) > PICTURE_MAX) {
        st.skippedPictures = { ...(st.skippedPictures || {}) };
        put(st.skippedPictures, id, 'TOO_LARGE');
        unrefusePicture(id); // nothing more to try: it stays here (its thumbnail went up)
        return 'skipped';
      }
      if (!(await sendPicture(id, false, bytes))) return 'refused';
      markHave(id, 2);
    }
    unrefusePicture(id);
    return 'ok';
  }

  // One file; false when refused. A file the account already holds counts as sent (4.6; section 0, item 34).
  // Pictures never change once uploaded, so the rules refuse an upload to a name that holds one: after a lost
  // answer, a restart that hadn't recorded the upload, a picture forgotten and shown again, or a board whose
  // pictures another computer uploaded first. storage.upload() reads what is there with one stat. The same
  // bytes count as sent. Other bytes (a thumbnail another computer's encoder made differently, say) count as
  // sent too: the account's copy is the shared one for that id and stays, and this computer keeps its own file,
  // so nothing is replaced or lost, and nothing is held or tried again.
  async function sendPicture(id, thumb, bytes = null) {
    const name = imagePath(id, thumb);
    const data = bytes ?? await images.readFile(id, thumb);
    alive();
    let res;
    try {
      res = await storage.upload(name, data);
    } catch (err) {
      alive();
      if (err?.code === 'PERMISSION') return false; // refused, and nothing is there
      throw err;
    }
    alive();
    if (res?.differs) warn(`the account already holds this ${thumb ? 'thumbnail' : 'picture'} with other bytes; its copy stays, and this computer keeps its own`);
    return true;
  }

  // The pictures of the notes the account has.
  function shadowPictures() {
    const ids = new Set();
    for (const id of Object.keys(shadow.notes)) {
      const e = shadow.notes[id];
      if (isObj(e) && !e.d) for (const p of noteImageIds(e.f)) ids.add(p);
    }
    return ids;
  }

  // Pictures of notes the account has that never got there (a refusal, a thumbnail made only later): tried
  // again after a cycle that went well, each on its own backoff, until the account has them (4.6).
  async function picturesIfDue() {
    if (!images || !shadow) return;
    const t = now();
    const held = Object.keys(st.quarantine).filter((k) => k.startsWith('picture:'));
    if (shadow === sweptShadow && !held.some((k) => !(st.quarantine[k].next > t))) return;
    sweptShadow = shadow;
    const inAccount = shadowPictures();
    // A hold ends once nothing is left to try: its note is gone, the account has the picture, it stays here
    // (over 32 MB), or its file isn't on this computer any more.
    let changed = pruneUploaded(inAccount);
    for (const k of held) {
      const id = k.slice(8);
      if (inAccount.has(id) && lacks(id) && !st.skippedPictures?.[id] && safeHas(id, false)) {
        notHere.delete(id); // its file is here (again): a sweep that once missed it doesn't keep it from a try
        continue;
      }
      unrefusePicture(id);
      changed = true;
    }
    const owed = [];
    for (const id of inAccount) {
      if (!lacks(id) || st.skippedPictures?.[id] || notHere.has(id) || st.quarantine[`picture:${id}`]?.next > t) continue;
      if (safeHas(id, false)) owed.push(id);
      else notHere.add(id); // the account's own: fetched on demand, never ours to upload
    }
    // Every hold kept is tried now or waits its turn: one due with no try would wake a cycle (a head read) at once.
    for (const k of held) {
      const e = st.quarantine[k];
      if (!isObj(e) || e.next > t || owed.includes(k.slice(8))) continue;
      e.next = t + jitter(T.backoff[Math.max(1, Math.min(int(e.tries), T.backoff.length)) - 1]);
      changed = true;
    }
    if (owed.length) await uploadPictures(owed, { patient: false });
    else if (changed) saveState();
    schedulePictures();
  }

  // Each try again of a held picture is a cycle with a head read: never sooner than the first backoff step.
  function schedulePictures() {
    let next = Infinity;
    for (const k of Object.keys(st.quarantine)) if (k.startsWith('picture:')) next = Math.min(next, Number(st.quarantine[k].next) || 0);
    if (next === Infinity) disarm('pictures');
    else {
      arm('pictures', Math.max(T.backoff[0], next - now()), () => {
        want.pull = true;
        kick();
      });
    }
  }

  // st.uploaded goes into state.json with every save: a picture nothing here or in the account shows any more
  // is forgotten (should it come back, finding it in the account costs a stat). → whether any went.
  function pruneUploaded(inAccount) {
    const shown = new Set(inAccount);
    for (const p of list(disk?.value?.projects)) {
      for (const i of model.cleanImages(p?.draftImages)) shown.add(i.id);
      for (const l of LISTS) for (const n of list(p?.[l])) for (const id of noteImageIds(n)) shown.add(id);
    }
    let changed = false;
    for (const id of Object.keys(st.uploaded)) {
      if (shown.has(id)) continue;
      delete st.uploaded[id];
      changed = true;
    }
    return changed;
  }

  function prefetchThumbs() {
    if (thumbs || !images || !disk) return;
    const ids = [];
    for (const p of list(disk.value.projects)) {
      for (const l of LISTS) {
        for (const n of list(p?.[l])) for (const id of noteImageIds(n)) if (!noThumb.has(id) && !safeHas(id, true) && !safeHas(id, false)) ids.push(id);
      }
    }
    if (!ids.length) return;
    const g = gen;
    const current = () => g === gen && !stopped && signedIn();
    thumbs = pool([...new Set(ids)], 4, async (id) => {
      if (!current()) return;
      try {
        if (!(await fetchImage(id, true)) && current()) noThumb.add(id); // the account has neither file
      } catch {
        // A failure on the way (a 503, a dropped connection): the next prefetch tries again, a few times at most.
        if (!current()) return;
        const n = (thumbTries.get(id) || 0) + 1;
        thumbTries.set(id, n);
        if (n >= 3) noThumb.add(id);
      }
    }).catch(() => {}).finally(() => {
      thumbs = null;
    });
  }

  // A download that answers after a stop, a sign-out or a deletion writes nothing: "Also remove this board"
  // may have removed images/ meanwhile, or another account be signed in (5.14).
  async function fetchImage(id, thumb) {
    const s = st;
    const g = gen;
    const current = () => g === gen && !stopped && signedIn();
    let bytes = await storage.download(imagePath(id, thumb));
    if (!current()) return false;
    let asThumb = thumb;
    if (!bytes && thumb) { // no thumbnail in the account: the full picture serves as one
      bytes = await storage.download(imagePath(id, false));
      if (!current()) return false;
      asThumb = false;
    }
    if (!bytes) return false;
    await images.writeWithId(id, asThumb, bytes);
    if (!current()) return true;
    if (!asThumb) notHere.delete(id); // the picture is on this computer now
    if (s && st === s) { // the account has it: never uploaded from here
      markHave(id, asThumb ? 1 : 2);
      saveSoon();
    }
    if (!asThumb && thumb) {
      try {
        await images.ensureThumb?.(id);
      } catch {}
    }
    return true;
  }

  // The board here made whole: every picture the board on disk shows (all three lists) whose full size isn't on this
  // computer, downloaded from the account, its thumbnail first when that is missing too (as fetchImage does).
  // Pictures from another computer arrive as thumbnails, the full size only on demand, so before the account's copy
  // goes (a deletion) or this computer leaves it (a sign-out), this keeps the board here complete. 4 at a time; none
  // starts after `deadline` (an absolute ms time), a full size after its thumbnail included. A download that didn't
  // come within http.js's deadline (TIMEOUT) is no failure at first, the link being shared: from then on they go one
  // at a time, and each that timed out is tried once more on its own (four 4 MB pictures on a 1 Mbit/s link need 128 s
  // together, 32 s each alone); only that try's TIMEOUT counts. strict: the first failure (a picture the account lacks
  // isn't one) is thrown, so the caller can stop; otherwise failures are counted and the rest go on. Offline, strict
  // throws NETWORK at once and otherwise nothing is tried. Only while the engine runs, signed in.
  // → { total, fetched, left, failed }: left, the pictures not tried (the deadline, a stop, offline), or whose download
  // was cut short (a stop, a sign-out, or this computer's sign-in stopped working before it answered: nothing written).
  async function completePictures({ deadline, strict = false, onProgress = null } = {}) {
    const todo = new Set();
    if (images && disk) {
      for (const p of list(disk.value.projects)) {
        for (const l of LISTS) for (const n of list(p?.[l])) for (const id of noteImageIds(n)) if (!safeHas(id, false)) todo.add(id);
      }
    }
    const out = { total: todo.size, fetched: 0, left: todo.size, failed: 0 };
    if (!todo.size || !started || stopped || !signedIn()) return out;
    if (offline()) {
      if (strict) throw new SyncError('NETWORK');
      return out;
    }
    const g = gen;
    const current = () => g === gen && !stopped && signedIn(); // what fetchImage writes under
    const going = () => current() && !(Number.isFinite(deadline) && now() >= deadline);
    let done = 0;
    const report = () => {
      try {
        onProgress?.({ done, total: out.total });
      } catch {}
    };
    report();
    const queue = [...todo];
    const again = []; // timed out while others shared the link: once more, on its own
    let width = 4;
    let failure = null;
    // One picture; it stays left unless it is settled: here now, failed, or not in the account (no failure).
    const one = async (id, alone) => {
      if (!going()) return;
      try {
        // The account's thumbnail, or the picture itself when it has none (false: it has neither).
        const found = safeHas(id, true) || await fetchImage(id, true);
        if (found && !safeHas(id, false)) {
          if (!going()) return; // the deadline came while its thumbnail did
          await fetchImage(id, false);
        }
        if (safeHas(id, false)) out.fetched++;
        else if (!current()) return; // cut short: fetchImage wrote nothing, so it wasn't saved after all
      } catch (err) {
        if (err?.code === 'TIMEOUT' && !alone) {
          width = 1;
          again.push(id);
          return;
        }
        if (strict) {
          failure = failure || err;
          return;
        }
        out.failed++;
      }
      out.left--;
      done++;
      report();
    };
    const worker = async (k) => {
      while (queue.length && !failure && k < width) await one(queue.shift(), false);
    };
    await Promise.all([0, 1, 2, 3].map(worker));
    for (const id of again) {
      if (failure) break;
      await one(id, true);
    }
    if (failure) throw failure;
    return out;
  }

  // ---- the device record (4.2), a backup of this computer's own things, never applied elsewhere

  function deviceRecord() {
    const data = isObj(disk?.value) ? disk.value : {};
    const prefs = {};
    if (isObj(data.prefs)) for (const k of Object.keys(data.prefs)) if (k !== 'joiner') put(prefs, k, data.prefs[k]);
    const projects = {};
    const notes = {};
    const drafts = {};
    const draftImages = [];
    for (const p of list(data.projects)) {
      if (!isObj(p) || typeof p.id !== 'string') continue;
      const v = {};
      for (const k of Object.keys(p)) if (VIEW_PROJECT_KEYS.has(k) || k.startsWith('local')) put(v, k, p[k]);
      if (Object.keys(v).length) put(projects, p.id, v);
      const text = typeof p.draft === 'string' ? p.draft : '';
      const pics = model.cleanImages(p.draftImages).map((i) => ({ id: i.id, w: i.w, h: i.h }));
      if (text || pics.length) {
        put(drafts, p.id, { text, images: pics });
        draftImages.push(...pics.map((i) => i.id));
      }
      for (const l of LISTS) {
        for (const n of list(p[l])) {
          if (!isObj(n) || typeof n.id !== 'string') continue;
          const nv = {};
          if (n.expanded === true) nv.expanded = true;
          for (const k of Object.keys(n)) if (k.startsWith('local')) put(nv, k, n[k]);
          if (Object.keys(nv).length) put(notes, n.id, nv);
        }
      }
    }
    const top = {};
    // A top-level key starting with "local" (1.18: localEaten, the Eaten history) is this computer's own and
    // can be large; it stays out of the device record, as it stays out of everything synced.
    for (const k of Object.keys(data)) if (k !== 'projects' && k !== 'prefs' && !k.startsWith('local')) put(top, k, data[k]);
    let view = JSON.stringify({ prefs, projects, notes, top });
    if (view.length > VIEW_MAX) view = JSON.stringify({ prefs, projects, top });
    if (view.length > VIEW_MAX) view = JSON.stringify({ prefs, projects });
    if (view.length > VIEW_MAX) view = JSON.stringify({ prefs: {}, truncated: true });
    let draftsText = JSON.stringify(drafts);
    if (draftsText.length > DRAFTS_MAX) {
      const out = { truncated: true };
      let size = 24;
      for (const id of Object.keys(drafts)) {
        const d = drafts[id];
        const entry = { text: d.text.slice(0, Math.max(0, DRAFTS_MAX - size - 400)), images: d.images };
        const len = JSON.stringify(id).length + JSON.stringify(entry).length + 2;
        if (size + len > DRAFTS_MAX) break;
        put(out, id, entry);
        size += len;
      }
      draftsText = JSON.stringify(out);
    }
    const settings = {};
    let given = {};
    try {
      given = getDeviceSettings() || {};
    } catch {}
    for (const k of SETTINGS_KEYS) {
      const v = given[k];
      if (typeof v === 'string') settings[k] = S(v.slice(0, 500));
      else if (typeof v === 'boolean') settings[k] = B(v);
    }
    const name = typeof device.name === 'string' && device.name.trim() ? device.name.slice(0, 60) : 'Computer';
    const parts = { name, platform: PLATFORMS.includes(platform) ? platform : 'linux', appVersion: String(appVersion || '').slice(0, 40) };
    const fields = {
      name: S(parts.name), platform: S(parts.platform), appVersion: S(parts.appVersion), lastRev: I(st.rev),
      view: S(view), drafts: S(draftsText), settings: M(settings),
    };
    return { fields, draftImages, sig: sha256(JSON.stringify([parts, view, draftsText, settings])) };
  }

  async function deviceIfDue({ force = false } = {}) {
    if (!head || !disk) return; // only once the head exists: the rules read it (4.8)
    const t = now();
    if (!force && st.deviceAt && t - st.deviceAt < T.device) return;
    const rec = deviceRecord();
    if (!force && rec.sig === st.deviceSig) {
      st.deviceAt = t; // nothing to write; state.json gets it with its next write
      return;
    }
    await uploadPictures(rec.draftImages, { patient: false, record: false }); // drafts never wait for a refusal
    try {
      await firestore.commit([{
        update: { name: firestore.name(`users/${uid()}/devices/${device.id}`), fields: rec.fields },
        updateTransforms: [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }],
      }]);
    } catch (err) {
      alive();
      if (NET.has(err?.code) || signedOff(err)) throw err;
      if (err?.code === 'PERMISSION') await headOk(await getHead());
      warnErr("the device record wasn't written", err);
      st.deviceAt = t;
      saveState();
      return;
    }
    alive();
    st.deviceSig = rec.sig;
    st.deviceAt = t;
    saveState();
  }

  // The other computers, for "Also signed in on" (6.2): read again every 10 minutes, and only while the window
  // is focused, where Settings can show them (once focused again, the next pull reads them). A pull that names
  // a writer this computer doesn't know reads them at once (learnDevices).
  async function devicesIfDue() {
    if (!head || now() - devicesAt < T.devices || !readWin().focused) return;
    try {
      await refreshDevices();
      notify();
    } catch (err) {
      alive();
      if (NET.has(err?.code)) throw err;
      devicesAt = now();
      warnErr("the devices couldn't be read", err);
    }
  }

  // ---- the audit (5.11): runs when head.stats disagrees with the shadow, and every 30 days

  function sameCounts(a, b) {
    return a && b && a.projects === b.projects && a.notes === b.notes && a.images === b.images;
  }

  async function auditIfDue(h) {
    if (!h || inFlight || st.rev !== h.rev || st.choice || hasPendingWrite()) return; // a newer save first, as for a pull
    const t = now();
    const off = h.stats && !sameCounts(h.stats, model.countLive(shadow));
    const due = (st.lastAuditAt && t - st.lastAuditAt >= T.audit) || (off && t - lastAuditTry >= T.auditGap);
    if (!st.lastAuditAt && !off) {
      st.lastAuditAt = t;
      saveState();
      return;
    }
    if (!due) return;
    lastAuditTry = t;
    await audit(h);
  }

  async function audit(h) {
    activity = 'pull';
    const fields = ['_sync.rev', '_sync.deleted', '_sync.id'].map((fieldPath) => ({ fieldPath }));
    const cloud = { projects: new Map(), notes: new Map() };
    await collect((kind) => ({ from: [{ collectionId: kind }], select: { fields }, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] }),
      (kind, doc) => {
        const s = syncOf(doc);
        const docId = String(doc.path).split('/').pop();
        cloud[kind].set(typeof s.id === 'string' && s.id ? s.id : docId, { path: doc.path, rev: int(s.rev), updateTime: doc.updateTime });
      });
    const fetch = [];
    const drop = { projects: [], notes: [] };
    for (const kind of ['projects', 'notes']) {
      for (const [id, c] of cloud[kind]) {
        const e = Object.hasOwn(shadow[kind], id) ? shadow[kind][id] : null;
        if (!e || e.r !== c.rev || (e.u && c.updateTime && e.u !== c.updateTime)) fetch.push(c.path);
      }
      for (const id of Object.keys(shadow[kind])) if (!cloud[kind].has(id) && !(int(shadow[kind][id].r) <= h.minRev && h.minRev > 0)) drop[kind].push(id);
    }
    const got = fetch.length ? await getDocs(fetch) : new Map();
    alive();
    const docs = { projects: [], notes: [] };
    for (const p of fetch) {
      const doc = got.get(p);
      if (doc) docs[p.includes('/projects/') ? 'projects' : 'notes'].push(doc);
    }
    const remote = model.fromDocs({ head: h.doc, projectDocs: docs.projects, noteDocs: docs.notes, log: warn });
    await integrate({ remote, H: h.rev, headUpdateTime: h.updateTime, mode: diffMode(), audit: true, drop });
  }

  // ---- the first sign-in on this computer (5.9)

  function localModel() {
    return model.toModel(disk.value);
  }

  // Does the account still exist (5.9 step 1)? A forced refresh says (USER_NOT_FOUND: deleted). Asked once
  // a run, again after half an hour, and when a deletion elsewhere is over; creating the head always asks.
  async function confirmAccount(force = false) {
    if (!force && firstCheckedAt && now() - firstCheckedAt < T.firstCheck) return;
    await account.getIdToken({ force: true });
    alive();
    firstCheckedAt = now();
  }

  async function firstSync() {
    activity = 'first';
    notify();
    await confirmAccount();
    const h = await getHead();
    if (h?.deleting) { // being deleted on another computer: only the polls look again (5.15)
      deletingElsewhere = true;
      sawDeleting = true;
      notify();
      return;
    }
    if (!h && sawDeleting) await confirmAccount(true); // that deletion is over: was the account deleted too?
    sawDeleting = false;
    deletingElsewhere = false;
    if (h && h.schema > SCHEMA) {
      updateNeeded = true;
      notify();
      return;
    }
    const same = firstListing && (firstListing.h ? Boolean(h) && firstListing.h.updateTime === h.updateTime : !h);
    let listing = same ? firstListing : null;
    if (!listing) {
      const empty = { rev: 0, board: null, projects: new Map(), notes: new Map() };
      listing = h ? await listAll(h, { progressNotes: true }) : { rev: 0, h: null, remote: empty };
    }
    firstListing = listing;
    progress = null;
    // The decision and its merge read the board as it is on disk: a save on its way first (it may hold a note
    // written just before the sign-in); its arrival asks again, with this listing while the head stays put.
    if (hasPendingWrite()) return void (want.pull = true);
    const remote = listing.remote;
    const local = localModel();
    const live = model.countLive(remote);
    const accountPristine = Boolean(listing.h) && model.isPristineBoard(remote);
    const accountBlank = !listing.h || (live.projects === 0 && live.notes === 0) || accountPristine;
    const blankHere = localBlank(local);
    // An answer counts only for the account as it was asked about: Upload tombstones what the account holds
    // (meant for a pristine Welcome) and Use my account's board drops this one, so if another computer
    // filled or emptied the account meanwhile, the question comes again.
    const answer = st.firstAnswer;
    if (answer === 'upload' && accountBlank) return firstUpload(listing);
    if ((answer === 'combine' || answer === 'use-account') && !accountBlank) return firstMerge(answer, listing);
    if (answer) {
      st.firstAnswer = null;
      saveState();
    }
    // No question for a blank or pristine board here; if a note is written before the merge is on disk,
    // the decision is made again (useAccountOk).
    if (accountBlank && blankHere) {
      if (accountPristine) return firstMerge('use-account', listing, { auto: true }); // identical boards: the account's Welcome stays
      return firstUpload(listing);
    }
    if (accountBlank) return setChoice({ kind: 'first-upload', local: counts(local), ...(otherAccount() ? { otherAccount: otherAccount() } : {}) });
    if (blankHere) {
      backupBeforeSync('use-account');
      return firstMerge('use-account', listing, { auto: true });
    }
    await learnDevices(remote);
    return setChoice({
      kind: 'first-merge',
      account: { ...counts(remote), changedAt: listing.h.updatedAt, device: listing.h.lastDevice ? deviceRef(listing.h.lastDevice) : null },
      local: counts(local),
      ...(otherAccount() ? { otherAccount: otherAccount() } : {}),
    });
  }

  async function firstMerge(mode, listing, { auto = false } = {}) {
    activity = 'first';
    await integrate({
      first: true, firstMode: mode, auto, remote: listing.remote, H: listing.rev, headUpdateTime: listing.h.updateTime, createdAt: listing.h.createdAt,
    });
  }

  // Upload this board: the head is created if needed, an account's pristine Welcome is tombstoned, and
  // everything here goes up. The mass-delete guard doesn't apply to that Welcome (5.9 row 2).
  async function firstUpload(listing) {
    if (!listing.h) {
      const made = await createHead();
      if (made !== 'ok') return;
    } else {
      setShadow(applyShadowDelta(null, shadowDelta(listing.remote)));
      st.rev = listing.rev;
      st.headUpdateTime = listing.h.updateTime;
      st.headCreatedAt = listing.h.createdAt;
    }
    writeShadow();
    st.firstUpload = true;
    finishFirst();
    saveState();
    want.push = true;
    head = head || listing.h;
    await refreshDevices().catch(() => alive());
    await push();
    want.pull = true; // then a cycle of its own, with the device record
    rerun = true;
  }

  // 5.5 "Creating the head". A lost race (ALREADY_EXISTS, or a 403 when the rules judge it as an update)
  // restarts the first-sync decision.
  async function createHead() {
    if (!firstCheckedAt || now() - firstCheckedAt > 5000) await confirmAccount(true); // never for a deleted account
    const joiner = localModel().board.joiner;
    const fields = {
      schema: I(SCHEMA), rev: I(1), minRev: I(0), deleting: B(false), lastDevice: S(device.id),
      board: boardValue({ joiner }), stats: statsValue({ projects: 0, notes: 0, images: 0 }),
    };
    const transforms = [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ];
    const privacy = account.privacyVersion?.();
    if (typeof privacy === 'string' && privacy) {
      fields.privacy = M({ version: S(privacy) });
      transforms.push({ fieldPath: 'privacy.acceptedAt', setToServerValue: 'REQUEST_TIME' });
    }
    let updateTime;
    try {
      const res = await firestore.commit([{
        update: { name: firestore.name(headPath()), fields }, updateTransforms: transforms, currentDocument: { exists: false },
      }]);
      updateTime = res?.writeResults?.[0]?.updateTime ?? null;
    } catch (err) {
      alive();
      const code = err?.code;
      if (code !== 'HEAD_MOVED' && code !== 'PERMISSION' && !mayHaveLanded(code)) throw err;
      const h = await getHead();
      if (h && mayHaveLanded(code) && h.rev === 1 && h.lastDevice === device.id) {
        updateTime = h.updateTime; // it landed; the answer was lost
      } else if (h) {
        firstListing = null;
        st.firstAnswer = null;
        saveState();
        rerun = true;
        return 'raced';
      } else {
        throw err;
      }
    }
    alive();
    setShadow({ version: 1, uid: uid(), rev: 1, board: { joiner: joiner ?? null }, projects: {}, notes: {} });
    st.rev = 1;
    st.headUpdateTime = updateTime;
    st.headCreatedAt = null;
    head = { rev: 1, minRev: 0, schema: SCHEMA, deleting: false, lastDevice: device.id, commits: {}, board: { joiner }, stats: null, updateTime };
    headGone = false;
    // Which head this shadow belongs to: its createdAt (a REQUEST_TIME the commit's answer doesn't carry).
    try {
      const made = decodeHead(await firestore.get(headPath()));
      alive();
      if (made && made.rev === 1 && made.lastDevice === device.id) {
        st.headCreatedAt = made.createdAt;
        head = made;
      }
    } catch (err) {
      if (err instanceof Stopped) throw err;
    }
    return 'ok';
  }

  // ---- account deletion (5.15 steps 2–6; account.js does 1, 7 and 8)

  // First the board here is made whole, while nothing of the deletion exists yet: the full size of every picture it
  // shows (from another computer, only its thumbnail is here, and the account's copy goes with it), reported as
  // 'save-pictures'. A failure stops the deletion before anything is recorded (deletion() stays null) or erased; it
  // can be tried again from the start. A deletion resumed after that step had passed goes straight on. (No pull
  // first: what a pull brings counts only once the page has saved it, and the page may hold a patch back.)
  async function deleteAccountData(onProgress) {
    const report = (p) => {
      try {
        onProgress?.(p);
      } catch {}
    };
    if (!started || !st) throw new SyncError('UNAVAILABLE');
    if (!st.deletion && signedIn()) { // (an unverified account never held a picture)
      const g = gen;
      const saved = await completePictures({ strict: true, onProgress: (p) => report({ what: 'save-pictures', ...p }) });
      // Stopped, signed out, or this computer's sign-in stopped working meanwhile (a download cut short saved nothing):
      // nothing of the deletion begins. Recorded, a later "Finish deleting" would go on without saving the pictures.
      if (saved.left > 0 || g !== gen || stopped || !signedIn()) throw new SyncError('UNAVAILABLE');
    }
    deletingHere = true;
    gen++;
    disarmAll();
    dropInFlight();
    if (running) await running.catch(() => {});
    const u = uid();
    if (!st.deletion) {
      st.deletion = { startedAt: now() };
      saveState();
    }
    notify();
    let h = decodeHead(await firestore.get(`users/${u}`));
    if (!h) return; // never uploaded, or interrupted after the head went: nothing left but the sign-in
    if (!h.deleting) {
      try {
        await firestore.commit([{
          update: { name: firestore.name(`users/${u}`), fields: { deleting: B(true) } },
          updateMask: { fieldPaths: ['deleting'] },
          updateTransforms: [{ fieldPath: 'deletingAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        }]);
      } catch (err) {
        h = decodeHead(await firestore.get(`users/${u}`)); // a lost answer, or the head went meanwhile
        if (!h) return;
        if (!h.deleting) throw err;
      }
    }
    await deletePictures(u, report);
    await deleteDocuments(u, report);
    await deletePictures(u, report, { again: true }); // an upload begun before deleting was set may have finished since
    try {
      await firestore.commit([{ delete: firestore.name(`users/${u}`) }]);
    } catch (err) {
      if (await firestore.get(`users/${u}`)) throw err;
    }
  }

  async function deletePictures(u, report, { again = false } = {}) {
    const names = [];
    for await (const name of storage.list(`users/${u}/images/`)) names.push(name);
    if (again && !names.length) return;
    let done = 0;
    report({ what: 'pictures', done, total: names.length });
    await pool(names, 8, async (name) => {
      await storage.remove(name);
      done++;
      report({ what: 'pictures', done, total: names.length });
    });
  }

  async function deleteDocuments(u, report) {
    const paths = [];
    for (const collectionId of ['notes', 'projects', 'trash', 'devices']) {
      const names = { from: [{ collectionId }], select: { fields: [{ fieldPath: '__name__' }] } };
      for await (const doc of firestore.queryAll(`users/${u}`, names)) paths.push(doc.path);
    }
    const batches = [];
    for (let i = 0; i < paths.length; i += 10) batches.push(paths.slice(i, i + 10));
    let done = 0;
    report({ what: 'notes', done, total: paths.length });
    await pool(batches, 4, async (batch) => {
      await firestore.commit(batch.map((p) => ({ delete: firestore.name(p) })));
      done += batch.length;
      report({ what: 'notes', done, total: paths.length });
    });
  }

  // ---- the choices (6.3)

  function choose(answer) {
    if (!started || !st) return { ok: false, code: 'UNAVAILABLE' };
    const c = st.choice;
    const go = () => {
      resetBackoff();
      want.pull = true;
      want.push = true;
      saveState();
      notify();
      kick();
      return { ok: true };
    };
    switch (answer) {
      case 'not-now':
        return { ok: true }; // the phase stays choosing (5.9)
      case 'retry':
        retry();
        return { ok: true };
      case 'upload':
        if (c?.kind !== 'first-upload' && c?.kind !== 'account-gone') break;
        if (c.kind === 'account-gone') { // the board goes up again, as new, into the empty account
          syncDir.removeAccountState({ keepShadow: false });
          shadow = null;
          st = freshState(uid(), { dataFile: st.dataFile });
          outgoing = null;
        }
        backupBeforeSync('first-sync');
        st.choice = null;
        st.mode = 'first';
        st.firstAnswer = 'upload';
        return go();
      case 'combine':
      case 'use-account':
        if (c?.kind !== 'first-merge') break;
        // Use my account's board removes this board, so it waits for the backup that holds it (6.3). A board
        // no file holds yet (the page shows its .bak) is backed up once the page has saved it.
        if (!backupBeforeSync(answer) && answer === 'use-account' && disk?.sha) return { ok: false, code: 'UNAVAILABLE' };
        st.choice = null;
        st.firstAnswer = answer;
        return go();
      case 'keep': // nothing is deleted; a union brings the notes back here
        if (c?.kind !== 'mass-delete') break;
        st.choice = null;
        st.massDelete = null;
        st.labels = [];
        union({});
        return go();
      case 'delete-everywhere':
        if (c?.kind !== 'mass-delete') break;
        st.choice = null;
        st.massDelete = null;
        massDeleteOk = true;
        return go();
      default:
        break;
    }
    return { ok: false, code: 'UNAVAILABLE' };
  }

  function retry() {
    if (!st) return;
    for (const k of Object.keys(st.quarantine)) {
      if (st.quarantine[k]?.code === 'PERMISSION') {
        delete st.quarantine[k];
        qVersion++;
      }
    }
    sweptShadow = null; // refused pictures too, now
    staleNacks = 0;
    badRequest = false;
    resetBackoff();
    error = null;
    want.pull = true;
    want.push = true;
    saveState();
    notify();
    kick();
  }

  // ---- public hooks; none throws into main

  function guard(name, fn, fallback) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        warnErr(`${name} failed`, err);
        return typeof fallback === 'function' ? fallback() : fallback;
      }
    };
  }

  function whenIdle() {
    if (!running) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function idle() {
    if (!started || stopped) return true;
    if (running || thumbs || downloads.size || inFlight) return false;
    if (deletingHere || !st || st.deletion || deletingElsewhere || updateNeeded || badRequest) return true;
    if (st.choice && st.choice.kind !== 'mass-delete') return true; // that question still lets syncing go on
    if (offline() || !signedIn() || !disk || !pageSession) return true;
    return !(timer.push || timer.retry || timer.count || timer.rerun || want.push || want.pull || st.mode === 'first');
  }

  function devices() {
    const out = [];
    for (const [id, d] of devicesMap) out.push({ id, name: d.name, platform: d.platform, lastSeenAt: d.lastSeenAt, current: id === device?.id });
    if (device && !devicesMap.has(device.id)) out.push({ id: device.id, name: device.name, platform, lastSeenAt: st?.deviceAt || 0, current: true });
    return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt || (a.id < b.id ? -1 : 1));
  }

  // What exists only on this computer, which "Also remove this board…" would destroy (5.14): the whole
  // board while the account doesn't hold it (no first sync yet, its cloud board missing or being deleted, the
  // account itself deleted or disabled), and otherwise what the account refused or can't take: quarantined
  // notes and projects, too-large ones (recorded by a push or not yet), the notes held here with such a project
  // and the deletions of projects held for them (keepWithProjects), and pictures it lacks (refused, over 32 MB,
  // or not uploaded yet). Changes still waiting to upload are hasUnpushed()'s.
  // unreadable: the copies kept of a data file that couldn't be read, which may hold notes nothing else has
  // (the page names them; the removal deletes them with the board).
  function localOnly() {
    const out = { projects: 0, notes: 0, pictures: 0, unreadable: unreadableCopies() };
    if (!st || !disk) return out;
    const local = model.toModel(disk.value);
    const gone = headGone || st.choice?.kind === 'account-gone' || deletingElsewhere || ['deleted', 'disabled'].includes(status0());
    if (st.mode === 'first' || gone) return localBlank(local) ? out : { ...out, ...counts(local) };
    const c = currentDiff();
    const notes = new Set(c.diff.withProject); // notes held here with a project the account doesn't have
    const projects = new Set(c.diff.heldProjects); // deleted here, while the account still has such a note in them
    const pictures = new Set();
    for (const n of local.notes.values()) for (const id of noteImageIds(n.fields)) pictures.add(id);
    for (const k of [...Object.keys(st.quarantine), ...tooLargeKeys(c)]) {
      const i = k.indexOf(':');
      const id = k.slice(i + 1);
      if (k.startsWith('note:') && local.notes.has(id)) notes.add(id);
      else if (k.startsWith('project:') && local.projects.has(id)) projects.add(id);
    }
    out.notes += notes.size;
    out.projects += projects.size;
    for (const id of pictures) {
      const held = Object.hasOwn(st.quarantine, `picture:${id}`) || Boolean(st.skippedPictures?.[id]);
      if (held || (images && lacks(id) & 2 && safeHas(id, false))) out.pictures++;
    }
    return out;
  }

  function verifyTick() {
    const s = status0();
    if (s === 'signed-in') {
      want.pull = true;
      kick();
      return;
    }
    if (s !== 'unverified' || now() > verifyUntil) return;
    const again = () => {
      if (status0() === 'unverified' && now() <= verifyUntil && started && !stopped) arm('verify', T.verify, verifyTick);
    };
    if (offline()) again(); // no lookups while offline
    else checkVerify().finally(again);
  }

  async function checkVerify() {
    lastVerifyAt = now();
    try {
      const r = await account.checkVerified?.();
      if (r?.verified) {
        want.pull = true;
        want.push = true;
        kick();
      }
    } catch {}
  }

  function scheduleVerify() {
    if (status0() !== 'unverified') return;
    verifyUntil = now() + T.verifyFor;
    arm('verify', T.verify, verifyTick);
  }

  const api = {
    start: guard('start', () => {
      if (status0() === 'signed-out' || !uid()) return; // nothing of an account's is touched while signed out (S1)
      if (started && !stopped) {
        resetBackoff();
        want.pull = true;
        want.push = true;
        kick();
        return;
      }
      started = true;
      stopped = false;
      deletingHere = false;
      gen++;
      resetRun(); // an engine started again (another sign-in) knows nothing of the last run's account
      loadFiles();
      disk = null;
      readDiskNow(); // as it is now; at app start onLoadResult follows and says where it came from
      win = readWin();
      want.pull = true;
      want.push = true;
      scheduleVerify();
      notify();
      kick();
    }),

    // A patch the page applies once the engine has stopped counts for nothing (its save comes after), and
    // the next sign-in's union would add its copies again: a save already waiting in main is taken first,
    // and an empty patch replaces whatever the page still holds back. drain() before stop() does it fully.
    stop: guard('stop', () => {
      if (started && !stopped && inFlight) {
        halting = true;
        try {
          flushData();
          if (inFlight && pageSession) emptyPatch(newPatchId());
        } finally {
          halting = false;
        }
      }
      stopped = true;
      gen++;
      withdrawal = null;
      disarmAll();
      dropInFlight();
      for (const w of idleWaiters.splice(0)) w();
    }),

    // Before stop() at a sign-out (5.14): the patch on its way either lands (its acknowledging save is
    // written and counted) or is withdrawn (an empty patch replaces it in the page, and its acknowledgement
    // says so); no new work starts meanwhile. Settles within timeoutMs.
    drain: async (timeoutMs = 2000) => {
      if (!started || stopped || !inFlight) return;
      const until = now() + timeoutMs;
      halting = true;
      try {
        if (!withdrawal && pageSession) {
          withdrawal = newPatchId();
          emptyPatch(withdrawal);
        }
        while (inFlight && !stopped && now() < until) {
          try {
            flushData(); // the page's acknowledging save, now rather than after main's debounce
          } catch {}
          if (inFlight) await sleep(Math.min(50, Math.max(1, until - now())));
        }
      } catch (err) {
        warnErr('drain failed', err);
      } finally {
        halting = false;
      }
    },

    onLoadResult: guard('onLoadResult', ({ from, value, file } = {}) => {
      if (!started || stopped) return;
      const f = from === 'main' || from === 'bak' ? from : null;
      loadSeen = true; // the page is loading: its contentSeq starts at 0
      const board = isObj(value) && Array.isArray(value.projects);
      const text = f === 'main' && board ? JSON.stringify(value, null, 2) : '';
      setDisk(value, null, 0, text ? sha256(text) : null);
      if (!text && typeof file === 'string' && file) copyAside(file); // the page won't show what it holds
      loaded(f, text);
      recount();
      notify();
    }),

    onFileWritten: guard('onFileWritten', (data, meta, text) => {
      if (!started || stopped || !st) return;
      const m = cleanMeta(meta);
      const changed = m.session === undefined || !disk || m.session !== disk.session || m.contentSeq !== disk.contentSeq
        || m.labels.length > 0;
      const body = typeof text === 'string' ? text : JSON.stringify(data, null, 2);
      const sha = sha256(body);
      setDisk(data, m.session ?? null, m.contentSeq ?? 0, sha);
      if (!disk) return;
      staleNacks = 0;
      // A save names the page that made it: an engine told of an older page load (a replayed sync:ready)
      // learns the one that is there.
      if (m.session && pageSession && m.session !== pageSession) {
        pageSession = m.session;
        pageSeq = null;
      }
      st.dataFile = { sha256: sha, bytes: Buffer.byteLength(body) };
      if (m.labels.length) st.labels = [...st.labels, ...m.labels].slice(-1000);
      const isAck = Boolean(inFlight && m.acks.includes(inFlight.id));
      if (isAck && inFlight.probe) {
        saveState();
        probed();
      } else if (isAck) {
        acked(); // the push that follows takes everything on disk, so no debounce
      } else {
        saveState();
        keepDrafts();
      }
      if (withdrawal && m.acks.includes(withdrawal)) { // the page took the empty patch after the one before it
        withdrawal = null;
        if (inFlight) dropInFlight(); // held back and replaced: never applied, so the next run pulls it again
      }
      if (st.choice && (st.choice.kind === 'first-upload' || st.choice.kind === 'first-merge')) {
        st.choice = { ...st.choice, local: counts(localModel()) };
      }
      if (isAck) {
        disarm('push');
      } else if (changed) {
        const t = now();
        if (!timer.push) pushFirstAt = t;
        arm('push', Math.min(T.pushDebounce, pushFirstAt + T.pushMax - t), () => {
          want.push = true;
          kick();
        });
      } else if (!timer.counters) {
        arm('counters', T.counters, () => {
          countersDue = true;
          want.push = true;
          kick();
        });
      }
      recount();
      if (inFlight?.stale || want.pull || want.push || (st.mode === 'first' && !deletingElsewhere)) kick();
      notify();
    }),

    mergeSaveMeta,

    // data:load (3.8): main's last pending save is written first, while the patch it may acknowledge is
    // still known; the page then starts over, and the next pull repeats any merge it didn't save.
    onPageLoading: guard('onPageLoading', () => {
      if (started && !stopped && inFlight) {
        try {
          flushData();
        } catch (err) {
          warnErr('the last save before the reload failed', err);
        }
      }
      pageSession = null;
      loadSeen = false;
      dropInFlight();
      notify();
    }),

    // A page that loaded before this engine started (a sign-in in mid-session) gets no data:load here, so
    // the facade passes what it knows: contentSeq, the page's; from, what its data:load read ('main', 'bak'
    // or null for a seed over unreadable files). Without them, a probe learns the contentSeq, and the file as
    // it is now says what it can (readDiskNow). The same page told again (a sign-in from needs-sign-in) still
    // holds the patch it may be holding back, and its acknowledgement still counts: only another page load
    // means that page and its patch are gone.
    onPageReady: guard('onPageReady', ({ session, contentSeq, from } = {}) => {
      if (typeof session !== 'string' || !session) return;
      const replayed = !loadSeen;
      const same = session === pageSession && !loadSeen;
      pageSession = session;
      if (Number.isSafeInteger(contentSeq)) pageSeq = contentSeq;
      else if (!same) pageSeq = loadSeen ? 0 : null;
      loadSeen = false;
      staleNacks = 0;
      if (!same) dropInFlight();
      if (!started || stopped) return;
      if (replayed && st && st.mode !== 'first') {
        if (from === 'bak') union({ stale: true });
        else if (from === null) union({ seeded: true });
      }
      want.pull = true;
      want.push = true;
      kick();
    }),

    onNack: guard('onNack', ({ patchId, reason } = {}) => {
      if (!inFlight || inFlight.id !== patchId) return;
      if (reason === 'stale') {
        inFlight.stale = true;
        staleNacks++;
        if (!hasPendingWrite()) kick();
        return;
      }
      dropInFlight(); // the page couldn't apply it: back off, then the next pull repeats the merge
      failed(new SyncError('UNKNOWN'));
    }),

    onWindowState: guard('onWindowState', () => {
      if (!started || stopped) return;
      const prev = win;
      win = readWin();
      const shown = win.visible && !win.minimized;
      const wasShown = prev.visible && !prev.minimized;
      if ((win.focused && !prev.focused) || (shown && !wasShown)) {
        resetBackoff();
        pullSoon();
        if (status0() === 'unverified' && !offline() && now() - lastVerifyAt >= T.verifyFocus) checkVerify();
      }
      // Copies go up on blur or hide. The app hides after a copy, so the copy's save may still be on its way: once
      // written, it pushes (onFileWritten), with no head read before. With nothing to push, a blur costs nothing.
      if ((!win.focused && prev.focused) || (!shown && wasShown)) {
        countersDue = true;
        if (st && hasPendingWrite()) {
          want.push = true;
        } else if (st && currentDiff().diff.pending > 0) {
          want.push = true;
          kick();
        }
      }
      disarm('poll');
      schedulePoll();
    }),

    onSummon: guard('onSummon', () => {
      if (started && !stopped) pullSoon();
    }),

    onResume: guard('onResume', () => {
      if (!started || stopped) return;
      resetBackoff();
      pullSoon(true);
    }),

    // main writes the restored file next, and the page loads it a moment later (data:load): until then nothing
    // is merged with the board before it, or pushed from it (replacing()).
    onRestore: guard('onRestore', () => {
      if (!started || stopped || !st) return;
      dropInFlight();
      disarm('push');
      restoreLoad = true;
      if (st.mode !== 'first') {
        st.mode = 'restore'; // persisted before the restored file is written (5.10)
        st.seeded = false;
        st.stale = false;
        if (st.choice?.kind === 'mass-delete') st.choice = null;
        st.massDelete = null;
        modeEpoch++; // a merge already under way was for the board before the restore
      }
      saveState();
    }),

    onAccountChange: guard('onAccountChange', () => {
      if (!started || stopped) return;
      const s = status0();
      if (s === 'signed-in') {
        resetBackoff();
        want.pull = true;
        want.push = true;
        kick();
      } else if (s === 'unverified' && !timer.verify) {
        scheduleVerify();
      } else if (s === 'signed-out') { // the facade stops the engine too; until then nothing runs or polls
        gen++;
        disarmAll();
        dropInFlight();
      }
      notify();
    }),

    syncNow: async () => {
      try {
        if (!started || stopped) return status();
        resetBackoff();
        badRequest = false;
        error = null;
        netDown = false;
        lastPullAt = 0;
        devicesAt = 0; // the list in Settings is read again too
        goneCheckAt = 0; // and a missing cloud board asks whether the account is gone
        staleNacks = 0;
        countersDue = true;
        want.pull = true;
        want.push = true;
        kick();
        await whenIdle();
        if (rerun || timer.rerun) await whenIdle();
      } catch (err) {
        warnErr('syncNow failed', err);
      }
      return status();
    },

    choose: guard('choose', choose, () => ({ ok: false, code: 'UNAVAILABLE' })),
    retry: guard('retry', retry),
    status: guard('status', status, () => ({ phase: 'synced', pending: 0, lastSyncedAt: null, tooLarge: 0, quarantined: 0, tooLargePictures: 0 })),
    choice: guard('choice', () => (st?.choice ? { ...st.choice } : null), null),
    devices: guard('devices', devices, () => []),

    counts: guard('counts', () => {
      const s = head?.stats || (shadow ? model.countLive(shadow) : null);
      return s ? { projects: s.projects, notes: s.notes, pictures: s.images } : null;
    }, null),

    deletion: guard('deletion', () => (st?.deletion ? { ...st.deletion } : null), null),

    hasUnpushed: guard('hasUnpushed', () => {
      if (!started || stopped || !st || st.mode === 'first' || !disk) return false;
      return currentDiff().diff.pending > 0;
    }, false),

    localOnly: guard('localOnly', localOnly, () => ({ projects: 0, notes: 0, pictures: 1, unreadable: 0 })),

    ensureImage: async (id, thumb = false) => {
      try {
        const key = String(id);
        const small = Boolean(thumb);
        if (!images || !IMAGE_ID.test(key)) return false;
        if (safeHas(key, small) || (small && safeHas(key, false))) return true;
        if (!started || stopped || deletingHere || !signedIn() || offline()) return false;
        const name = `${key}${small ? '.t' : ''}`;
        if (!downloads.has(name)) {
          downloads.set(name, fetchImage(key, small).catch(() => false).finally(() => downloads.delete(name)));
        }
        return await withTimeout(downloads.get(name), T.image, false);
      } catch {
        return false;
      }
    },

    // Before quit (5.16) and before signing out (5.14): content and counters, then the device record if
    // time remains (never offline, and never while the account can't take it). Always settles within
    // timeoutMs.
    finalPush: async (timeoutMs = 1500) => {
      try {
        if (!started || stopped || !st || st.mode === 'first') return;
        const until = now() + timeoutMs;
        const work = (async () => {
          try {
            flushData();
          } catch {}
          if (running) await whenIdle();
          finalRun = true;
          countersDue = true;
          want.push = true;
          resetBackoff();
          kick();
          await whenIdle();
          finalRun = false;
          if (now() < until - 200 && signedIn() && head && !deletingHere && !offline() && !deletingElsewhere && !updateNeeded) {
            cycleGen = gen;
            try {
              await deviceIfDue({ force: true });
            } catch {}
          }
        })().catch((err) => warnErr('the final push failed', err));
        await withTimeout(work, timeoutMs, undefined);
      } catch (err) {
        warnErr('finalPush failed', err);
      } finally {
        finalRun = false;
      }
    },

    deleteAccountData,
    completePictures,

    idle,
    whenIdle,
    busy: () => Boolean(running || thumbs || downloads.size), // work that ends without any timer
    // What the engine is waiting for, for tests and logs (no board content).
    debug: () => ({
      running: Boolean(running), inFlight: inFlight ? { id: inFlight.id, stale: inFlight.stale, waiting: inFlight.waiting } : null,
      want: { ...want }, timers: Object.keys(timer).filter((k) => timer[k]), mode: st?.mode ?? null, rev: st?.rev ?? null,
      seeded: st?.seeded ?? null, modeEpoch, backoffUntil, headMoves, countersDue, deletingHere, choice: st?.choice?.kind ?? null,
      commitBudget, staleNacks, outgoing: outgoing ? outgoing.id : null, drops, replacing: replacing(), readSize,
      held: st && st.mode !== 'first' && disk ? [...heldNotes()] : [], // note ids a delete in the account doesn't remove
    }),
  };
  return api;
}

module.exports = { createSync, mergeSaveMeta, cleanMeta, timing, SCHEMA };
