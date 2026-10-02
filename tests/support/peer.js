'use strict';
// A headless computer for the sync tests (ai_memory/15, 7.4 and 7.5): the real engine, account, token store
// and REST clients over its own data folder, plus a stand-in for main (the 250 ms debounced write, loadData
// with its .bak fallback, restoreBackup) and one for the page (normalize or seed on load, contentSeq and
// undo labels on every edit, busy states that hold a patch back, the stale nack, the draft rule, and the
// acknowledging save). engine.test.js and fuzz.test.js run several of them on one fake clock; the e2e
// suite drives one as computer B against the mock's socket with real timers. It never starts Electron.
//
//   const peer = createPeer({ dir, fetchImpl: mock.fetch, base: 'http://127.0.0.1:9', time, platform: 'win32' });
//   await peer.boot();                                 // the app starts (signed in when account.json says so)
//   await peer.signIn(email, password);                // → Result; the engine starts mid-session, told what the
//                                                      //   page's data:load read ({ loadInfo: false }: not told)
//   const id = peer.page.addNote(projectId, 'text');   // edits as a person makes them
//   await settle([peer, other], time);                 // fake clock: everything pending runs, then quiet
//   peer.kill(); await peer.boot();                    // a crash, then the next start from disk
//
// With real timers (no `time`; the e2e suite against the mock's socket, RECALLER_SYNC_FAST timings), drive it
// the same way and wait with `await peer.whenQuiet()`. peer.firestore and peer.storage are the raw clients
// (for writes the rules must refuse), peer.accountState() is what the facade would send as AccountState.
// signIn, signOut, deleteAccount, quit and the page's load are wired as src/cloud/index.js must wire them
// (3.8, 5.14–5.16): the reference for the facade.
//
// Every call the engine makes to the cloud, the sync folder, the pictures and the backups goes through
// peer.onCall(phase, label, args) ('before' or 'after'), so a test can crash it at any await: kill() there
// and nothing of that run reaches the disk or the cloud any more.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../../src/store');
const { loadConfig } = require('../../src/cloud/config');
const { createHttp } = require('../../src/cloud/http');
const { createAuth } = require('../../src/cloud/auth');
const { createFirestore } = require('../../src/cloud/firestore');
const { createStorage } = require('../../src/cloud/storage');
const { createTokenStore } = require('../../src/cloud/tokens');
const { createAccount } = require('../../src/cloud/account');
const { openSyncDir } = require('../../src/sync/state');
const { createSync } = require('../../src/sync/engine');
const SyncApply = require('../../src/renderer/sync-apply');

const LISTS = ['notes', 'used', 'combined'];
const IMAGE_ID = /^[a-f0-9]{32}$/;
const DATA_VERSION = 2;
const STAGE = { used: 'Cooked', combined: 'Served' };

class Dead extends Error {
  constructor() {
    super('this computer has crashed');
    this.name = 'Dead';
  }
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---- time

// A clock and timers that move only when told to. Ties run in the order they were set.
function createFakeTime(start = Date.parse('2026-10-01T10:00:00.000Z')) {
  let t = start;
  let serial = 0;
  const queue = new Map();
  const next = () => {
    let best = null;
    for (const [id, e] of queue) if (!best || e.at < best.at || (e.at === best.at && e.serial < best.serial)) best = { id, ...e };
    return best;
  };
  const time = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++serial;
      queue.set(id, { at: t + Math.max(0, Number(ms) || 0), fn, serial: id });
      return id;
    },
    clearTimeout(id) {
      queue.delete(id);
    },
    nextAt() {
      const n = next();
      return n ? n.at : null;
    },
    pending: () => queue.size,
    // Runs the earliest timer (moving the clock to it).
    async step() {
      await flush();
      const n = next();
      if (!n) return false;
      queue.delete(n.id);
      t = Math.max(t, n.at);
      n.fn();
      await flush();
      return true;
    },
    // Moves the clock by ms, running every timer due on the way.
    async advance(ms) {
      const end = t + Math.max(0, ms);
      for (;;) {
        await flush();
        const n = next();
        if (!n || n.at > end) break;
        queue.delete(n.id);
        t = Math.max(t, n.at);
        n.fn();
      }
      t = end;
      await flush();
    },
    set(ms) {
      t = ms;
    },
  };
  return time;
}

// Lets every promise and I/O callback that is ready run (the mock answers within one turn).
async function flush(turns = 4) {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

// Runs the clock until every peer is quiet: pending writes flushed, patches applied and acknowledged,
// pushes done, retries over. Polls don't count. Throws when that doesn't happen within maxMs.
async function settle(peers, time, { maxMs = 60 * 60 * 1000 } = {}) {
  const from = time.now();
  for (let i = 0; i < 200000; i++) {
    for (let k = 0; k < 400 && peers.some((p) => p.busy()); k++) await flush(1);
    if (peers.every((p) => p.quiet())) return;
    const at = time.nextAt();
    if (at === null) throw new Error(`settle: not quiet, and nothing is scheduled (${peers.filter((p) => !p.quiet()).map((p) => p.name).join(', ')})`);
    if (at - from > maxMs) {
      const why = peers.filter((p) => !p.quiet()).map((p) => `${p.name}: ${p.why()}`).join('; ');
      throw new Error(`settle: not quiet after ${maxMs} ms (${why})`);
    }
    await time.step();
  }
  throw new Error('settle: too many steps');
}

// A small seeded generator (mulberry32).
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Bytes that stand in for a PNG (the mock checks the content type and size, not the format).
function pngBytes(size = 2048, seed = 1) {
  const buf = Buffer.alloc(size);
  const rand = makeRng(seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  for (let i = 8; i < size; i++) buf[i] = Math.floor(rand() * 256);
  return buf;
}

// ---- the data folder's other parts, in plain Node

function createImages(dir, check = () => {}) {
  const folder = path.join(dir, 'images');
  const file = (id, thumb) => path.join(folder, `${id}${thumb ? '.t' : ''}.png`);
  return {
    folder,
    has: (id, thumb = false) => IMAGE_ID.test(id) && fs.existsSync(file(id, thumb)),
    // Bytes on disk, without reading them (the engine skips pictures over 32 MB unread); null when missing.
    size(id, thumb = false) {
      check('images.size');
      try {
        return IMAGE_ID.test(id) ? fs.statSync(file(id, thumb)).size : null;
      } catch {
        return null;
      }
    },
    readFile(id, thumb = false) {
      check('images.readFile');
      if (!IMAGE_ID.test(id)) throw new Error('Bad image id');
      return fs.readFileSync(file(id, thumb));
    },
    writeWithId(id, thumb, bytes) {
      check('images.writeWithId');
      if (!IMAGE_ID.test(id)) throw new Error('Bad image id');
      fs.mkdirSync(folder, { recursive: true });
      const target = file(id, thumb);
      fs.writeFileSync(`${target}.tmp`, bytes);
      fs.renameSync(`${target}.tmp`, target);
    },
    // A real thumbnail is resized to 640 px; here the picture serves as its own.
    ensureThumb(id) {
      check('images.ensureThumb');
      if (!fs.existsSync(file(id, true)) && fs.existsSync(file(id, false))) fs.copyFileSync(file(id, false), file(id, true));
    },
    store(bytes, id = crypto.randomBytes(16).toString('hex')) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file(id, false), bytes);
      fs.writeFileSync(file(id, true), bytes.subarray(0, Math.min(bytes.length, 4096)));
      return { id, w: 800, h: 600 };
    },
  };
}

function createBackups(dir, now, check = () => {}) {
  const root = path.join(dir, 'backups');
  let serial = 0;
  const backups = {
    made: [],
    create(kind, meta = {}) {
      check('backups.create');
      const dataFile = path.join(dir, 'recaller-data.json');
      if (!fs.existsSync(dataFile)) return null;
      const id = `${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${++serial}_${kind}`;
      fs.mkdirSync(path.join(root, id), { recursive: true });
      fs.copyFileSync(dataFile, path.join(root, id, 'recaller-data.json'));
      fs.writeFileSync(path.join(root, id, 'backup.json'), JSON.stringify({ kind, createdAt: now(), ...meta }, null, 2));
      backups.made.push({ id, kind, meta });
      return id;
    },
    list() {
      try {
        return fs.readdirSync(root).sort();
      } catch {
        return [];
      }
    },
    readData: (id) => JSON.parse(fs.readFileSync(path.join(root, id, 'recaller-data.json'), 'utf8')),
  };
  return backups;
}

// ---- the page's own load rules (app.js normalize() and seedData(), DATA_VERSION 2)

function normalize(raw, newId, now) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return null;
  const ids = new Set();
  const cleanId = (id) => {
    let v = typeof id === 'string' && id ? id : newId();
    if (ids.has(v)) v = newId();
    ids.add(v);
    return v;
  };
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const cleanImages = (list) => (Array.isArray(list) ? list : []).filter((i) => i && IMAGE_ID.test(i.id))
    .map((i) => ({ ...i, w: Number(i.w) || 0, h: Number(i.h) || 0 }));
  const notes = (list) => (Array.isArray(list) ? list : []).filter((n) => n && typeof n.text === 'string').map((n) => ({
    ...n,
    id: cleanId(n.id),
    text: n.text,
    images: cleanImages(n.images),
    createdAt: num(n.createdAt, now()),
    updatedAt: num(n.updatedAt, num(n.createdAt, now())),
    copied: num(n.copied),
    lastCopiedAt: num(n.lastCopiedAt),
    usedAt: num(n.usedAt),
  }));
  const prefs = raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {};
  return {
    ...raw,
    version: Math.max(DATA_VERSION, Number(raw.version) || 0),
    prefs: { ...prefs, density: typeof prefs.density === 'string' ? prefs.density : 'slim' },
    projects: raw.projects.filter((p) => p && typeof p === 'object').map((p) => ({
      ...p,
      id: cleanId(p.id),
      name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Untitled',
      color: typeof p.color === 'string' && p.color ? p.color : 'monstera',
      usedCollapsed: Boolean(p.usedCollapsed),
      augCollapsed: Boolean(p.augCollapsed),
      draft: typeof p.draft === 'string' ? p.draft : '',
      draftImages: cleanImages(p.draftImages),
      createdAt: num(p.createdAt, now()),
      notes: notes(p.notes),
      used: notes(p.used),
      combined: notes(p.combined),
    })),
  };
}

const TIPS = [
  'Click a note to copy it, then paste anywhere.',
  'Swipe a note to the left to delete it.',
  'Press and hold a note, then drag it down into “Cooked”.',
  'Click Dictate next to New prompt to speak a prompt.',
  'Tap the camera in the editor to snip part of your screen into a note.',
  'Hold the modifier and click several notes to copy them all at once.',
  'New prompts start in “Cooking”.',
  'Hover a note and click the highlighter to colour-mark it.',
  'Drag the right edge of a column to make it wider or narrower.',
  'Shortcuts: search, new prompt, dictate, screenshot, undo.',
];

function seedData(newId, now) {
  const t = now();
  return {
    version: DATA_VERSION,
    prefs: { density: 'slim' },
    projects: [{
      id: newId(), name: 'Welcome', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: t,
      notes: TIPS.map((text) => ({ id: newId(), text, images: [], createdAt: t, updatedAt: t, copied: 0, lastCopiedAt: 0, usedAt: 0 })),
      used: [],
      combined: [],
    }],
  };
}

// ---- the peer

function createPeer({
  dir, fetchImpl, base = 'http://127.0.0.1:9', config = null, name = path.basename(String(dir)), platform = 'darwin',
  hostname = `${name}-host`, time = null, now = null, timers = null, random = Math.random, fast = true,
  tokenMode = 'test-file', appVersion = '1.17.0', log = null, settings = null, window = null,
} = {}) {
  if (!dir || typeof fetchImpl !== 'function') throw new TypeError('createPeer needs dir and fetchImpl');
  fs.mkdirSync(dir, { recursive: true });
  const clockNow = now || time?.now || Date.now;
  const fake = Boolean(time && typeof time.step === 'function'); // a fake clock: nothing moves unless told
  const clockTimers = timers || time || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
  const cfg = config || loadConfig({
    env: { RECALLER_GCP_BASE: base, RECALLER_TOKEN_STORE: tokenMode, ...(fast ? { RECALLER_SYNC_FAST: '1' } : {}) },
    isPackaged: false,
  });
  const lines = [];
  const logger = log || { warn: (...a) => lines.push(a.join(' ')), log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
  const DATA_FILE = path.join(dir, 'recaller-data.json');
  const hex = (n) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  const newId = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

  const peer = {
    name,
    dir,
    platform,
    config: cfg,
    lines,
    online: true,
    window: { visible: true, focused: true, minimized: false, ...(window || {}) },
    settings: { theme: 'deep', model: 'gpt-transcribe', language: '', hint: '', hotkey: '', shotHotkey: '', hideAfterCopy: false, ...(settings || {}) },
    onCall: null, // (phase, label, args) → called before and after every engine call into the world
    states: 0,
    saved: [],    // every board written to disk, in order (for no-loss checks)
    life: null,
  };

  // One run of the app. A crash (kill) ends it: from then on nothing it started reaches the disk or the cloud.
  function createLife() {
    const life = { dead: false, timers: new Set(), engine: null, account: null };
    const check = (label, args = []) => {
      if (life.dead) throw new Dead();
      if (label && peer.onCall) peer.onCall('before', label, args);
      if (life.dead) throw new Dead();
    };
    const after = (label, args = []) => {
      if (life.dead) throw new Dead();
      if (peer.onCall) peer.onCall('after', label, args);
      if (life.dead) throw new Dead();
    };
    life.check = check;
    life.setTimeout = (fn, ms) => {
      const id = clockTimers.setTimeout(() => {
        life.timers.delete(id);
        if (!life.dead) fn();
      }, ms);
      life.timers.add(id);
      return id;
    };
    life.clearTimeout = (id) => {
      life.timers.delete(id);
      clockTimers.clearTimeout(id);
    };
    life.engineTimers = { setTimeout: life.setTimeout, clearTimeout: life.clearTimeout };

    // Wraps a client so that each call is a crash point, before it goes out and after its answer arrives.
    const wrap = (obj, prefix, names) => {
      const out = { ...obj };
      for (const key of names) {
        const fn = obj[key];
        if (typeof fn !== 'function') continue;
        out[key] = (...args) => {
          const label = `${prefix}.${key}`;
          check(label, args);
          const res = fn(...args);
          if (res && typeof res[Symbol.asyncIterator] === 'function') {
            const it = res[Symbol.asyncIterator]();
            return {
              [Symbol.asyncIterator]() { return this; },
              async next() {
                check(`${label}.next`);
                const v = await it.next();
                after(`${label}.next`);
                return v;
              },
              async return(v) {
                return it.return ? it.return(v) : { done: true, value: v };
              },
            };
          }
          if (res && typeof res.then === 'function') {
            return res.then((v) => {
              after(label, args);
              return v;
            }, (err) => {
              after(label, args);
              throw err;
            });
          }
          after(label, args);
          return res;
        };
      }
      return out;
    };
    life.wrap = wrap;

    const http = createHttp({ fetchImpl, now: clockNow });
    const auth = createAuth({ http, endpoints: cfg.endpoints, apiKey: cfg.apiKey });
    const syncDir = openSyncDir(dir, { hostname, platform, now: clockNow, log: logger });
    const tokenStore = createTokenStore({ dir: syncDir.dir, mode: cfg.tokenStore, platform, config: cfg, log: logger });
    const tokens = wrap(tokenStore, 'tokens', ['save', 'clear']);
    life.http = http;
    life.syncDir = syncDir;
    life.tokens = tokens;
    life.account = createAccount({
      auth, tokens, config: cfg, now: clockNow, log: logger,
      onChange: () => {
        if (!life.dead && life.engine) life.engine.onAccountChange();
      },
    });
    const getIdToken = (opts) => life.account.getIdToken(opts);
    life.firestore = createFirestore({ http, endpoints: cfg.endpoints, projectId: cfg.projectId, getIdToken });
    life.storage = createStorage({ http, endpoints: cfg.endpoints, bucket: cfg.bucket, getIdToken });
    life.images = createImages(dir, check);
    life.backups = createBackups(dir, clockNow, check);
    life.main = createMain(life);
    life.page = createPage(life);
    return life;
  }

  // ---- main's part (src/main.js: scheduleDataWrite, flushData, loadData, restoreBackup)

  function createMain(life) {
    const main = {
      pendingData: null,
      pendingMeta: null,
      timer: null,
      reloadTimer: null, // restoreBackup's reload, 50 ms after the restored file is written (as in main.js)
      restoring: false,
      writes: 0,
      loadedFrom: undefined, // what the page's last data:load read, kept while signed out too (the facade's job)
      scheduleDataWrite(data, meta) {
        if (life.dead || main.restoring) return;
        main.pendingData = clone(data); // what IPC delivers is a copy
        main.pendingMeta = life.engine ? life.engine.mergeSaveMeta(main.pendingMeta, meta) : null;
        if (main.timer) life.clearTimeout(main.timer);
        main.timer = life.setTimeout(() => {
          main.timer = null;
          main.flushData();
        }, 250);
      },
      flushData() {
        if (main.timer) life.clearTimeout(main.timer);
        main.timer = null;
        if (life.dead || !main.pendingData || main.restoring) return;
        const text = JSON.stringify(main.pendingData, null, 2);
        store.writeJsonAtomic(DATA_FILE, main.pendingData);
        main.writes++;
        const written = main.pendingData;
        const meta = main.pendingMeta;
        main.pendingData = null;
        main.pendingMeta = null;
        peer.saved.push(written);
        if (life.engine) life.engine.onFileWritten(written, meta, text);
      },
      loadData() {
        if (!main.restoring) main.flushData();
        main.restoring = false;
        const { value, from } = readWithFallback(DATA_FILE);
        if (from === DATA_FILE) {
          try {
            fs.copyFileSync(DATA_FILE, `${DATA_FILE}.bak`);
          } catch {}
        }
        const read = from === DATA_FILE ? 'main' : from ? 'bak' : null;
        // A load the engine sees itself needs no replay; one while signed out is told once, at the sign-in.
        main.loadedFrom = life.engine ? undefined : read;
        if (life.engine) life.engine.onLoadResult({ from: read, value, file: DATA_FILE });
        return value;
      },
      // In main.js's order: the engine is told, the file is written, and the window reloads 50 ms later, so
      // the restored board reaches the engine only with that load's data:load (work already under way goes on
      // meanwhile, with the board before it).
      restoreBackup(id) {
        const restored = life.backups.readData(id);
        main.flushData();
        life.backups.create('before-restore', { restoredFrom: id });
        if (life.engine) life.engine.onRestore(id);
        main.restoring = true;
        if (main.timer) life.clearTimeout(main.timer);
        main.timer = null;
        main.pendingData = null;
        main.pendingMeta = null;
        store.writeJsonAtomic(DATA_FILE, restored);
        if (main.reloadTimer) life.clearTimeout(main.reloadTimer);
        main.reloadTimer = life.setTimeout(() => {
          main.reloadTimer = null;
          life.page.reload();
        }, 50);
      },
    };
    return main;
  }

  function readWithFallback(file) {
    for (const f of [file, `${file}.bak`]) {
      try {
        const value = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (value) return { value, from: f };
      } catch {}
    }
    return { value: null, from: null };
  }

  // ---- the page's part (app.js: persist, pushHistory, syncBusy, tryApplyPatch and the edits)

  function createPage(life) {
    const page = {
      data: null,
      session: null,
      ready: false,
      contentSeq: 0,
      saveSeq: 0,
      labels: [],
      history: 0,      // undo steps; a content patch clears them
      pendingPatch: null,
      patchTimer: null,
      busy: { editing: null, drag: false, menu: false, undoToast: false, composer: null, dictation: false },
      notices: [],
      patches: [],
      nacks: [],
    };

    const now = clockNow;
    const engine = () => life.engine;

    page.persist = (extra = {}) => {
      if (life.dead || !page.data) return;
      const meta = { session: page.session, seq: ++page.saveSeq, contentSeq: page.contentSeq, labels: page.labels.splice(0), ...extra };
      life.main.scheduleDataWrite(page.data, meta);
    };
    const checkpoint = (label) => {
      page.contentSeq++;
      page.labels.push(label);
      page.history++;
      page.persist();
    };

    page.init = () => {
      page.session = `s-${newId()}`;
      page.contentSeq = 0;
      page.saveSeq = 0;
      page.labels = [];
      page.history = 0;
      page.pendingPatch = null;
      if (page.patchTimer) life.clearTimeout(page.patchTimer);
      page.patchTimer = null;
      page.busy = { editing: null, drag: false, menu: false, undoToast: false, composer: null, dictation: false };
      page.ready = false;
      const raw = life.main.loadData();
      page.data = normalize(raw, newId, now) || seedData(newId, now);
      if (!raw || !(Number(raw.version) >= DATA_VERSION)) page.persist();
      page.ready = true;
      if (engine()) engine().onPageReady({ session: page.session });
    };

    page.reload = () => {
      if (engine()) engine().onPageLoading();
      page.init();
    };

    // ---- patches (5.8)

    const holdsDraft = (p) => Boolean(p && ((typeof p.draft === 'string' && p.draft.trim()) || (Array.isArray(p.draftImages) && p.draftImages.length)));

    page.syncBusy = (p) => {
      if (!p.changesContent && !p.resetHistory) return false;
      const b = page.busy;
      if (b.editing || b.drag || b.menu || b.dictation || b.undoToast) return true;
      if (b.composer && p.projects.remove.includes(b.composer)) return true;
      return false;
    };

    const nack = (patchId, reason) => {
      page.nacks.push({ patchId, reason });
      setImmediate(() => {
        if (!life.dead && engine()) engine().onNack({ patchId, reason });
      });
    };

    page.tryApplyPatch = () => {
      if (page.patchTimer) life.clearTimeout(page.patchTimer);
      page.patchTimer = null;
      const p = page.pendingPatch;
      if (!p || !page.ready || life.dead) return;
      if (p.session !== page.session || (p.changesContent && p.basedOnContentSeq !== page.contentSeq)) {
        page.pendingPatch = null;
        nack(p.id, 'stale');
        return;
      }
      if (page.syncBusy(p)) {
        page.patchTimer = life.setTimeout(page.tryApplyPatch, 700);
        return;
      }
      if (p.projects.remove.some((id) => holdsDraft(page.findProject(id))) && !p.notices.some((n) => n?.code === 'USED_ACCOUNT')) {
        page.pendingPatch = null;
        page.persist();
        nack(p.id, 'stale');
        return;
      }
      page.pendingPatch = null;
      SyncApply.applyPatch(page.data, p);
      if (p.changesContent) page.contentSeq++;
      if (p.changesContent || p.resetHistory) page.history = 0;
      page.patches.push(p);
      page.notices.push(...p.notices);
      page.persist({ ack: p.id });
    };

    page.receive = (patch) => {
      if (life.dead) return;
      if (!patch || typeof patch.id !== 'string') return;
      page.pendingPatch = clone(patch);
      page.tryApplyPatch();
    };

    // ---- finding things

    page.findProject = (id) => page.data?.projects.find((p) => p.id === id) || null;
    page.findNote = (id) => {
      for (const p of page.data?.projects || []) {
        for (const l of LISTS) {
          const i = p[l].findIndex((n) => n.id === id);
          if (i >= 0) return { project: p, list: l, index: i, note: p[l][i] };
        }
      }
      return null;
    };
    const needProject = (id) => {
      const p = page.findProject(id);
      if (!p) throw new Error(`${name}: no project ${id}`);
      return p;
    };
    const needNote = (id) => {
      const at = page.findNote(id);
      if (!at) throw new Error(`${name}: no note ${id}`);
      return at;
    };
    page.notes = () => (page.data?.projects || []).flatMap((p) => LISTS.flatMap((l) => p[l].map((note) => ({ project: p.id, list: l, note }))));

    // ---- edits, each as app.js makes it (a checkpoint raises contentSeq and records the undo label)

    page.addProject = (projectName = 'Project', { id = newId(), color = 'monstera', index = null } = {}) => {
      const p = {
        id, name: projectName, color, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now(),
        notes: [], used: [], combined: [],
      };
      if (Number.isInteger(index)) page.data.projects.splice(index, 0, p);
      else page.data.projects.push(p);
      checkpoint('New project');
      return id;
    };
    page.renameProject = (id, text) => {
      needProject(id).name = text;
      checkpoint('Rename project');
    };
    page.recolorProject = (id, color) => {
      needProject(id).color = color;
      checkpoint('Change color');
    };
    page.deleteProject = (id) => {
      const i = page.data.projects.findIndex((p) => p.id === id);
      if (i < 0) throw new Error(`${name}: no project ${id}`);
      page.data.projects.splice(i, 1);
      checkpoint('Delete project');
    };
    page.moveProject = (id, index) => {
      const i = page.data.projects.findIndex((p) => p.id === id);
      const [p] = page.data.projects.splice(i, 1);
      page.data.projects.splice(Math.max(0, Math.min(index, page.data.projects.length)), 0, p);
      checkpoint('Reorder projects');
    };
    page.addNote = (projectId, text, { list = 'notes', index = null, id = newId(), images = [], fields = {} } = {}) => {
      const p = needProject(projectId);
      const t = now();
      const note = { id, text, images, createdAt: t, updatedAt: t, copied: 0, lastCopiedAt: 0, usedAt: list === 'notes' ? 0 : t, ...fields };
      if (Number.isInteger(index)) p[list].splice(index, 0, note);
      else p[list].push(note);
      checkpoint('New note');
      return id;
    };
    page.editNote = (id, text) => {
      const { note, list } = needNote(id);
      note.text = text;
      note.updatedAt = now();
      delete note.syncConflict; // saving from the editor clears the tag (6.5)
      checkpoint(list === 'notes' ? 'Edit note' : `Edit ${STAGE[list]}`);
    };
    page.moveNote = (id, { project = null, list = null, index = null } = {}) => {
      const at = needNote(id);
      const to = project ? needProject(project) : at.project;
      const toList = list || at.list;
      at.project[at.list].splice(at.index, 1);
      if (toList !== 'notes' && toList !== at.list) at.note.usedAt = now();
      const target = to[toList];
      if (Number.isInteger(index)) target.splice(Math.max(0, Math.min(index, target.length)), 0, at.note);
      else target.push(at.note);
      const label = toList === at.list && to === at.project ? 'Reorder'
        : toList === 'used' ? 'Move to Cooked' : toList === 'combined' ? 'Move to Served' : 'Move back';
      checkpoint(label);
    };
    page.sortPrompts = (projectId) => {
      const p = needProject(projectId);
      p.notes.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      checkpoint('Sort prompts');
    };
    page.deleteNote = (id) => {
      const at = needNote(id);
      at.project[at.list].splice(at.index, 1);
      checkpoint(at.list === 'notes' ? 'Delete note' : at.list === 'used' ? 'Delete Cooked note' : 'Delete Served text');
    };
    page.clearList = (projectId, list) => {
      needProject(projectId)[list] = [];
      checkpoint(`Clear ${STAGE[list]}`);
    };
    page.highlight = (id, color = 'amber') => {
      const { note } = needNote(id);
      if (color) note.highlight = color;
      else delete note.highlight;
      checkpoint(color ? 'Highlight' : 'Remove highlight');
    };
    page.setJoiner = (joiner) => {
      page.data.prefs = { ...(page.data.prefs || {}), joiner };
      page.contentSeq++;
      page.labels.push('Join setting');
      page.persist();
    };
    // A copy is never a content change (copyNote: the note is looked up again after the clipboard's await).
    page.copy = (id, n = 1) => {
      const { note } = needNote(id);
      note.copied = (note.copied || 0) + n;
      note.lastCopiedAt = now();
      page.persist();
    };
    page.setDraft = (projectId, text) => {
      needProject(projectId).draft = text;
      page.persist();
    };
    page.toggleView = (projectId) => {
      const p = needProject(projectId);
      p.notesCollapsed = !p.notesCollapsed;
      page.persist();
    };
    page.addPicture = (noteId, bytes = pngBytes()) => {
      const image = life.images.store(bytes, hex(32));
      const { note } = needNote(noteId);
      note.images = [...note.images, image];
      note.updatedAt = now();
      checkpoint('Edit note');
      return image.id;
    };
    // The editor holds every content patch back; saving raises contentSeq (the patch goes stale), cancelling lets it in.
    page.openEditor = (id) => {
      needNote(id);
      page.busy.editing = id;
    };
    page.closeEditor = (text = null) => {
      const id = page.busy.editing;
      page.busy.editing = null;
      if (id && text !== null && page.findNote(id)) page.editNote(id, text);
      page.tryApplyPatch();
    };
    page.setBusy = (what, on = true) => {
      page.busy[what] = on;
      if (!on) page.tryApplyPatch();
    };
    // A save no undo label explains (the mass-delete guard's case).
    page.mutate = (fn, { label = null } = {}) => {
      fn(page.data);
      page.contentSeq++;
      if (label) page.labels.push(label);
      page.persist();
    };
    page.replaceData = (data) => {
      page.data = clone(data);
      page.contentSeq++;
      page.persist();
    };
    return page;
  }

  // ---- the engine, as src/cloud/index.js wires it (3.3, 3.8)

  function startEngine(life) {
    if (life.engine) {
      life.engine.start();
      return life.engine;
    }
    const wrap = life.wrap;
    const engine = createSync({
      syncDir: wrap(life.syncDir, 'syncDir', ['writeState', 'writeShadow', 'writeDevice', 'removeAccountState', 'removeAll']),
      account: wrap(life.account, 'account', ['getIdToken', 'checkVerified']),
      firestore: wrap(life.firestore, 'firestore', ['get', 'batchGet', 'query', 'queryAll', 'commit']),
      storage: wrap(life.storage, 'storage', ['upload', 'download', 'stat', 'list', 'remove']),
      images: life.images,
      backups: life.backups,
      page: {
        sendPatch: (patch) => {
          setImmediate(() => {
            if (!life.dead) life.page.receive(patch);
          });
        },
        sendState: () => {
          peer.states++;
        },
      },
      getDeviceSettings: () => ({ ...peer.settings }),
      getWindowState: () => ({ ...peer.window }),
      hasPendingWrite: () => life.main.pendingData !== null,
      isRestoring: () => life.main.restoring,
      flushData: () => life.main.flushData(),
      isOnline: () => peer.online,
      config: cfg,
      platform,
      appVersion,
      now: clockNow,
      timers: life.engineTimers,
      log: logger,
      random,
      serverNow: life.http.serverNow,
      dataFile: DATA_FILE,
    });
    life.engine = engine;
    engine.start();
    return engine;
  }

  const L = () => {
    if (!peer.life || peer.life.dead) throw new Error(`${name} isn't running`);
    return peer.life;
  };

  // On a fake clock nothing moves unless told: the timers run until the work settles (an engine waiting on
  // its own timer, a backoff or the 403 wait, would never finish otherwise). → whether it settled.
  async function drive(work) {
    let done = false;
    work.then(() => { done = true; }, () => { done = true; });
    if (!fake) {
      await work.catch(() => {});
      return true;
    }
    for (let i = 0; i < 100000 && !done; i++) {
      await flush(2);
      if (done || !(await time.step())) break;
    }
    await flush(2);
    return done;
  }

  // What the facade passes when the engine starts after the page loaded: the page's session, and once, what
  // its data:load read while signed out ('main', 'bak' or null). loadInfo: false leaves it out, as a facade
  // that didn't know would.
  function pageReady(life, loadInfo) {
    const from = life.main.loadedFrom;
    life.main.loadedFrom = undefined;
    life.engine.onPageReady(loadInfo && from !== undefined ? { session: life.page.session, from } : { session: life.page.session });
  }

  Object.defineProperties(peer, Object.getOwnPropertyDescriptors({
    // The app starts: the saved sign-in, the engine when signed in, the board, the page.
    async boot() {
      if (peer.life && !peer.life.dead) throw new Error(`${name} is running already`);
      const life = createLife();
      peer.life = life;
      if (life.account.state().status !== 'signed-out') startEngine(life);
      life.page.init();
      await flush();
      return peer;
    },

    // A crash: the process is gone. Requests already sent still reach the cloud; nothing else happens.
    kill() {
      const life = peer.life;
      if (!life || life.dead) return;
      life.dead = true;
      for (const id of life.timers) clockTimers.clearTimeout(id);
      life.timers.clear();
      try {
        life.engine?.stop();
      } catch {}
    },

    async restart() {
      peer.kill();
      return peer.boot();
    },

    // Quitting: the final push (5.16), then the process ends.
    async quit(ms = 1500) {
      const life = L();
      life.main.flushData();
      if (life.engine && life.engine.hasUnpushed()) await drive(life.engine.finalPush(ms));
      peer.kill();
    },

    reload() {
      L().page.reload();
    },

    get alive() {
      return Boolean(peer.life && !peer.life.dead);
    },
    get engine() {
      return peer.life?.engine || null;
    },
    get account() {
      return peer.life?.account || null;
    },
    get page() {
      return L().page;
    },
    get main() {
      return L().main;
    },
    get firestore() {
      return L().firestore;
    },
    get storage() {
      return L().storage;
    },
    get images() {
      return L().images;
    },
    get backups() {
      return L().backups;
    },
    get syncDir() {
      return L().syncDir;
    },
    get uid() {
      return peer.life?.account?.uid() || null;
    },

    // ---- the account (3.6), as the facade would run it

    async signUp(email, password, privacyVersion = '2026-10-01', { loadInfo = true } = {}) {
      const life = L();
      const res = await life.account.signUp(email, password, privacyVersion);
      if (res.ok) {
        startEngine(life);
        pageReady(life, loadInfo);
      }
      return res;
    },

    async signIn(email, password, { loadInfo = true } = {}) {
      const life = L();
      const res = await life.account.signIn(email, password);
      if (res.ok) {
        startEngine(life);
        pageReady(life, loadInfo);
      }
      return res;
    },

    async checkVerified() {
      const res = await L().account.checkVerified();
      L().engine?.onAccountChange();
      return res;
    },

    // 5.14: a final push when changes wait, PENDING unless forced, then the sign-in goes; the board stays
    // unless removeBoard (which also clears the shadow and the state, and starts the page over). Kept, it is made
    // whole first while time allows (20 s): the full size of every picture it shows only as a thumbnail, fetched from
    // the account it leaves (engine.completePictures). The board is
    // never removed while it holds something that exists only here, forced or not: changes still waiting,
    // or what the account refused or can't take (engine.localOnly()); nor for an account that isn't there to
    // hold it (deleted, turned off, or not running). Copies kept of a data file that couldn't be read may
    // hold notes nothing else has: they go with the board only once the page has named them and the person
    // agreed (removeUnreadable), else PENDING with localOnly.unreadable. A crash on the way ends it there, as
    // it would the app.
    async signOut({ force = false, removeBoard = false, removeUnreadable = false } = {}) {
      const life = L();
      const engine = life.engine;
      const holdsBoard = () => Boolean(engine) && ['signed-in', 'needs-sign-in', 'unverified'].includes(life.account.state().status);
      const living = () => {
        if (life.dead) throw new Dead();
      };
      const unavailable = { ok: false, code: 'UNAVAILABLE' };
      if (removeBoard && !holdsBoard()) return unavailable;
      if (engine) {
        life.main.flushData();
        if (engine.hasUnpushed() && peer.online) await drive(engine.finalPush(10000));
        living();
        if (removeBoard && !holdsBoard()) return unavailable; // the push may have learnt the account is gone
        const pending = engine.hasUnpushed() ? Math.max(1, engine.status().pending) : 0;
        if (pending && !force && !removeBoard) return { ok: false, code: 'PENDING', pending };
        if (!removeBoard && peer.online) {
          await drive(engine.completePictures({ deadline: clockNow() + 20000 }));
          living();
        }
        if (removeBoard) {
          const only = engine.localOnly();
          const kept = only.projects + only.notes + only.pictures;
          if (pending || kept || (only.unreadable && !removeUnreadable)) return { ok: false, code: 'PENDING', pending: pending + kept, localOnly: only };
        }
        await drive(engine.drain(2000)); // a patch on its way lands or is withdrawn: never applied unseen
        living();
        if (removeBoard && !holdsBoard()) return unavailable;
        engine.stop();
        life.engine = null;
      }
      const res = await life.account.signOut();
      living();
      if (!res.ok) return res;
      if (removeBoard) {
        const copies = fs.readdirSync(dir).filter((n) => /^recaller-data\.unreadable-.+\.json$/.test(n)).map((n) => path.join(dir, n));
        for (const f of [DATA_FILE, `${DATA_FILE}.bak`, `${DATA_FILE}.tmp`, ...copies]) fs.rmSync(f, { force: true });
        fs.rmSync(path.join(dir, 'images'), { recursive: true, force: true });
        fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
        life.syncDir.removeAccountState({ clearLastUid: true });
        life.page.reload();
      }
      return res;
    },

    // 5.15: the account re-authenticates, the engine erases the cloud board, the sign-in goes.
    async deleteAccount(password, progress = []) {
      const life = L();
      const engine = life.engine;
      const onProgress = (p) => progress.push(p);
      const res = await life.account.deleteAccount(password, {
        eraseData: engine ? () => engine.deleteAccountData(onProgress) : null,
        onProgress,
      });
      if (res.ok) {
        engine?.stop();
        life.engine = null;
        life.syncDir.removeAccountState({ clearLastUid: true });
      }
      return res;
    },

    // ---- sync

    // On a fake clock the engine may wait on its own timer (a backoff, the 403 wait, the pause between bulk
    // chunks), so the clock is moved until Sync now has run its course.
    async syncNow() {
      const engine = L().engine;
      if (!engine) return null;
      const run = engine.syncNow();
      return (await drive(run)) ? run : engine.status();
    },
    choose: (answer) => L().engine?.choose(answer) ?? { ok: false, code: 'UNAVAILABLE' },
    retry: () => L().engine?.retry(),
    status: () => peer.life?.engine?.status() ?? null,
    choice: () => peer.life?.engine?.choice() ?? null,

    // AccountState (3.6), as the facade sends it.
    accountState() {
      const life = peer.life;
      const engine = life?.engine;
      const a = life?.account?.state() || { status: 'signed-out' };
      const out = { enabled: true, state: a.status };
      if (a.email) out.email = a.email;
      if (a.keyStore) out.keyStore = a.keyStore;
      if (engine && a.status === 'signed-in') {
        out.sync = engine.status();
        out.choice = engine.choice();
        out.devices = engine.devices();
        out.counts = engine.counts();
        out.deleting = engine.deletion() ? { what: 'account', done: 0, total: 0 } : null;
      }
      return out;
    },

    setOnline(on) {
      peer.online = Boolean(on);
    },
    setWindow(w) {
      Object.assign(peer.window, w);
      peer.life?.engine?.onWindowState();
    },
    focus() {
      peer.setWindow({ visible: true, minimized: false, focused: true });
    },
    blur() {
      peer.setWindow({ focused: false });
    },
    summon() {
      peer.life?.engine?.onSummon();
    },
    restoreBackup(id) {
      L().main.restoreBackup(id);
    },

    // ---- for settle()

    // Work that finishes without the clock: a cycle running, downloads.
    busy() {
      const life = peer.life;
      return Boolean(life && !life.dead && life.engine && life.engine.busy());
    },
    quiet() {
      const life = peer.life;
      if (!life || life.dead) return true;
      if (life.main.timer || life.main.pendingData || life.main.reloadTimer) return false;
      if (life.page.pendingPatch || life.page.patchTimer) return false;
      return !life.engine || life.engine.idle();
    },
    // Real timers (the e2e suite): resolves true once this computer has stayed quiet for `stable` ms, or
    // false after timeoutMs. On a fake clock use settle().
    async whenQuiet({ timeoutMs = 20000, stable = 300 } = {}) {
      const until = Date.now() + timeoutMs;
      let since = null;
      for (;;) {
        if (peer.quiet() && !peer.busy()) {
          since = since ?? Date.now();
          if (Date.now() - since >= stable) return true;
        } else {
          since = null;
        }
        if (Date.now() > until) return false;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },

    why() {
      const life = peer.life;
      if (!life || life.dead) return 'dead';
      const out = [];
      if (life.main.timer || life.main.pendingData) out.push('write pending');
      if (life.main.reloadTimer) out.push('reload pending');
      if (life.page.pendingPatch || life.page.patchTimer) out.push('patch held');
      if (life.engine && !life.engine.idle()) out.push(`engine ${JSON.stringify(life.engine.status())} ${JSON.stringify(life.engine.debug())}`);
      return out.join(', ') || 'quiet';
    },

    // ---- inspection

    board: () => clone(L().page.data),
    disk: () => readWithFallback(DATA_FILE).value,
    readState: () => openSyncDir(dir, { hostname, platform, now: clockNow }).readState(),
    readShadow: () => openSyncDir(dir, { hostname, platform, now: clockNow }).readShadow(),
    readDevice: () => openSyncDir(dir, { hostname, platform, now: clockNow }).readDevice(),
    dataFile: DATA_FILE,
    newId,
  }));
  return peer;
}

module.exports = { createPeer, createFakeTime, settle, flush, makeRng, pngBytes, normalize, seedData, Dead, LISTS };
