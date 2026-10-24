'use strict';
// Recaller's core on the iPhone: what main.js and the page (app.js) do on the desktop, around the desktop's
// own account and sync code (src/cloud/index.js, src/sync/*), run in JavaScriptCore. The Swift app only
// draws the view this produces and sends actions back; the board itself lives here, so every field the
// iPhone doesn't know about stays exactly as it is (ai_memory/16, rule 1).
//
// Modelled on tests/support/peer.js (a headless Recaller) and wired as src/main.js wires the facade:
//   main:  scheduleDataWrite (250 ms, an ack flushes the save before it), flushData, loadData (+ .bak), backups
//   page:  load (normalize or seed), contentSeq and undo labels on every edit, patches held while busy,
//          the stale and draft rules, the acknowledging save, sync:ready
//
// The Swift side calls globalThis.RecallerCore:
//   init(opts)                     → JSON { ok }        opts: { dataDir, appVersion, packaged, env, settings, deviceName }
//   act(name, argsJson)            → JSON result        a board action (ios/core/board.js)
//   view()                         → JSON               the board as the screens draw it
//   account(op, payloadJson)       → Promise<JSON>      get, sign-up, sign-in, sign-out, delete, … (as the desktop's IPC)
//   setBusy(what, on)                                   'editing' | 'composer' | 'dictation' | 'menu' | 'undoToast' | 'drag'
//   lifecycle(state)                                    'active' | 'inactive' | 'background'
//   ensureImage(id, thumb)         → Promise<bool>      fetch another device's picture
//   flush()                                             write the pending save now
//   setSettings(json)                                   the voice settings, for this device's backup record
// and hears back through __native.emit(event, json): 'board' (the view), 'account' (AccountState),
// 'toast' ({ text }).

require('./shims/globals');
const N = require('./shims/native');
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('../../src/store');
const SyncApply = require('../../src/renderer/sync-apply');
const { createBoard, normalize, seedData } = require('./board');

const DATA_VERSION = 2;
const DATA_NAME = 'recaller-data.json';
const IMAGE_ID = /^[a-f0-9]{32}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

let cloud = null;     // src/cloud/index.js, required at init (after the electron shim is filled in)
let backups = null;   // src/backups.js
let dataDir = '';
let DATA_FILE = '';
let settings = { theme: 'deep', model: 'gpt-transcribe', language: '', hint: '', hotkey: '', shotHotkey: '', hideAfterCopy: false };
let here = 'this iPhone';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const newId = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
const emit = (event, value) => {
  try {
    N.emit(event, JSON.stringify(value));
  } catch (err) {
    console.error('[core] emit failed', err);
  }
};
const toast = (text) => {
  if (text) emit('toast', { text });
};

// ---- the window, as the facade sees it (the app's scene)

const scene = { visible: true, focused: true, minimized: false };
const ipc = { handlers: new Map(), listeners: new Map() };
const ipcMain = {
  handle: (channel, fn) => ipc.handlers.set(channel, fn),
  on: (channel, fn) => ipc.listeners.set(channel, fn),
};
const fakeWindow = {
  isDestroyed: () => false,
  isVisible: () => scene.visible,
  isFocused: () => scene.focused,
  isMinimized: () => scene.minimized,
  webContents: {
    isDestroyed: () => false,
    send(channel, payload) {
      if (channel === 'sync:patch') setTimeout(() => page.receive(clone(payload)), 0); // IPC: later, and a copy
      else if (channel === 'account:changed') {
        learnDevices(payload);
        emit('account', payload);
      }
    },
  },
};
const listen = (channel, payload) => {
  const fn = ipc.listeners.get(channel);
  if (fn) fn({}, payload);
};

// ---- main (src/main.js: the data file)

const main = {
  pendingData: null,
  pendingMeta: null,
  timer: null,
  restoring: false,

  scheduleDataWrite(data, meta) {
    if (main.restoring) return;
    if (meta?.ack && main.pendingData && cloud?.active()) main.flushData();
    main.pendingData = clone(data); // what IPC delivers is a copy
    main.pendingMeta = cloud ? cloud.mergeSaveMeta(main.pendingMeta, meta) : null;
    if (main.timer) clearTimeout(main.timer);
    main.timer = setTimeout(main.flushData, 250);
  },

  flushData() {
    if (main.timer) clearTimeout(main.timer);
    main.timer = null;
    if (!main.pendingData || main.restoring) return;
    let text;
    try {
      text = store.writeJsonAtomic(DATA_FILE, main.pendingData);
    } catch (err) {
      console.error('[data] save failed:', err);
      return; // kept: the next flush tries again
    }
    const written = main.pendingData;
    const meta = main.pendingMeta;
    main.pendingData = null;
    main.pendingMeta = null;
    cloud?.onFileWritten(written, meta, text);
  },

  loadData() {
    if (!main.restoring) main.flushData();
    main.restoring = false;
    const { value, from } = store.readJsonWithFallback(DATA_FILE);
    cloud?.onLoadResult({ from: from === DATA_FILE ? 'main' : from ? 'bak' : null, value, file: DATA_FILE });
    if (from === DATA_FILE) store.backup(DATA_FILE);
    return value;
  },
};

// ---- pictures (src/images.js's part the engine uses; the app writes new ones itself)

const images = {
  folder: '',
  file: (id, thumb) => path.join(images.folder, `${id}${thumb ? '.t' : ''}.png`),
  has: (id, thumb = false) => IMAGE_ID.test(id) && fs.existsSync(images.file(id, thumb)),
  size(id, thumb = false) {
    try {
      return IMAGE_ID.test(id) ? fs.statSync(images.file(id, thumb)).size : null;
    } catch {
      return null;
    }
  },
  readFile(id, thumb = false) {
    if (!IMAGE_ID.test(id)) throw new Error('Bad image id');
    return fs.readFileSync(images.file(id, thumb));
  },
  writeWithId(id, thumb, bytes) {
    if (!IMAGE_ID.test(id)) throw new Error('Bad image id');
    fs.mkdirSync(images.folder, { recursive: true });
    const target = images.file(id, thumb);
    fs.writeFileSync(`${target}.tmp`, bytes);
    fs.renameSync(`${target}.tmp`, target);
  },
  ensureThumb(id) {
    if (!IMAGE_ID.test(id) || images.has(id, true) || !images.has(id, false)) return;
    if (!N.makeThumb(images.file(id, false), images.file(id, true))) fs.copyFileSync(images.file(id, false), images.file(id, true));
  },
};

// ---- the page (app.js's sync side, with the edits in board.js)

const holdsDraft = (p) => Boolean(p && ((typeof p.draft === 'string' && p.draft.trim()) || (Array.isArray(p.draftImages) && p.draftImages.length)));

const page = {
  data: null,
  session: null,
  ready: false,
  contentSeq: 0,
  saveSeq: 0,
  labels: [],
  pendingPatch: null,
  patchTimer: null,
  busy: { editing: false, composer: null, dictation: false, menu: false, undoToast: false, drag: false },
  board: null,

  persist(extra = {}) {
    if (!page.data) return;
    const meta = { session: page.session, seq: ++page.saveSeq, contentSeq: page.contentSeq, labels: page.labels.splice(0), ...extra };
    main.scheduleDataWrite(page.data, meta);
    changed();
  },

  markContent(label) {
    page.contentSeq++;
    if (label) page.labels.push(label);
  },

  init() {
    page.session = `s-${newId()}`;
    page.contentSeq = 0;
    page.saveSeq = 0;
    page.labels = [];
    page.pendingPatch = null;
    if (page.patchTimer) clearTimeout(page.patchTimer);
    page.patchTimer = null;
    page.ready = false;
    let raw = null;
    try {
      raw = main.loadData();
    } catch (err) {
      console.error('[core] load failed', err);
    }
    page.data = normalize(raw, newId, Date.now) || seedData(newId, Date.now);
    // 1.20.4: a column minimized by 1.18–1.19 on this device becomes the synced flag.
    const oldMinimized = page.data.projects.filter((p) => p.localMinimized === true);
    for (const p of oldMinimized) {
      p.minimized = true;
      delete p.localMinimized;
    }
    if (oldMinimized.length) page.markContent('Minimize column');
    page.board = createBoard({
      get data() {
        return page.data;
      },
      markContent: page.markContent,
      persist: () => page.persist(),
      now: Date.now,
      newId,
    });
    if (!raw || !(Number(raw.version) >= DATA_VERSION) || oldMinimized.length) page.persist();
    page.ready = true;
    page.tryApplyPatch();
    listen('sync:ready', { session: page.session });
    changed();
  },

  reload() {
    cloud?.onPageLoading();
    page.init();
  },

  syncBusy(p) {
    if (!p.changesContent && !p.resetHistory) return false;
    const b = page.busy;
    if (b.editing || b.drag || b.menu || b.dictation || b.undoToast) return true;
    if (b.composer && p.projects.remove.includes(b.composer)) return true;
    return false;
  },

  nack(patchId, reason) {
    setTimeout(() => listen('sync:nack', { patchId, reason }), 0);
  },

  tryApplyPatch() {
    if (page.patchTimer) clearTimeout(page.patchTimer);
    page.patchTimer = null;
    const p = page.pendingPatch;
    if (!p || !page.ready) return;
    if (p.session !== page.session || (p.changesContent && p.basedOnContentSeq !== page.contentSeq)) {
      page.pendingPatch = null;
      page.nack(p.id, 'stale');
      return;
    }
    if (page.syncBusy(p)) {
      page.patchTimer = setTimeout(page.tryApplyPatch, 700);
      return;
    }
    if (p.projects.remove.some((id) => holdsDraft(page.data.projects.find((x) => x.id === id))) && !p.notices.some((n) => n?.code === 'USED_ACCOUNT')) {
      page.pendingPatch = null;
      page.persist();
      page.nack(p.id, 'stale');
      return;
    }
    page.pendingPatch = null;
    const own = p.notices.some((n) => n?.code === 'CONFLICT') ? ownCopies(p) : 0;
    try {
      SyncApply.applyPatch(page.data, p);
    } catch (err) {
      console.error('[sync] patch failed', err);
      page.nack(p.id, 'invalid');
      changed();
      return;
    }
    if (p.changesContent) page.contentSeq++;
    if (p.changesContent || p.resetHistory) page.board.clearHistory();
    page.persist({ ack: p.id });
    for (const n of p.notices) toast(n && typeof n === 'object' ? noticeText(n, own) : '');
  },

  receive(p) {
    if (!p || typeof p.id !== 'string') return;
    if (!Array.isArray(p.projects?.remove) || !Array.isArray(p.notes?.remove) || !Array.isArray(p.notices)) {
      page.nack(p.id, 'invalid');
      return;
    }
    page.pendingPatch = p;
    page.tryApplyPatch();
  },
};

const LISTS = ['notes', 'used', 'combined'];
const imageKey = (list) => (Array.isArray(list) ? list.map((i) => i?.id).join(',') : '');
function locate(id) {
  for (const p of page.data?.projects || []) for (const l of LISTS) for (const n of p[l] || []) if (n.id === id) return { project: p, list: l, note: n };
  return null;
}
function ownCopies(p) {
  let n = 0;
  for (const [id, up] of Object.entries(p.notes.upsert || {})) {
    const f = up?.fields;
    const original = typeof f?.syncConflict?.of === 'string' && !locate(id) ? locate(f.syncConflict.of)?.note : null;
    if (original && original.text === f.text && imageKey(original.images) === imageKey(Array.isArray(f.images) ? f.images : [])) n++;
  }
  return n;
}

// ---- notices (app.js noticeText, with the iPhone's own words)

const tally = (v) => Math.max(0, Math.floor(Number(v) || 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
function deviceLabel(ref) {
  if (ref?.platform === 'darwin') return 'your Mac';
  if (ref?.platform === 'win32') return 'your Windows PC';
  return 'another device';
}
function noticeText(n, own) {
  const k = tally(n.count) || 1;
  const device = deviceLabel(n.device);
  const name = n.name || 'Untitled';
  switch (n.code) {
    case 'CONFLICT': {
      const mine = own >= k;
      return k === 1
        ? `A note was changed on two devices. Both versions are kept; ${mine ? `${here}'s` : 'the copy'} is marked Check again.`
        : `${k} notes were changed on two devices. Both versions of each are kept; ${mine ? `${here}'s` : 'the copies'} are marked Check again.`;
    }
    case 'KEPT_NOTE':
      return k === 1 ? `A note you deleted was changed on ${device}, so it was kept.` : `${k} notes you deleted were changed on ${device}, so they were kept.`;
    case 'KEPT_PROJECT':
      return `“${name}” was deleted on ${device}, but it had changes here, so it was kept.`;
    case 'KEPT_PROJECT_DRAFT':
      return `“${name}” was deleted on ${device}, but it had an unsaved draft here, so it was kept.`;
    case 'REMOTE_DELETES':
      return `${cap(device)} deleted ${plural(tally(n.count), 'note')}. ${cap(here)}'s board was backed up first.`;
    case 'RESTORED_FROM_ACCOUNT':
      return `${cap(here)}'s notes file couldn't be read, so your board was restored from your account.`;
    case 'COMBINED':
      return `Combined: ${plural(tally(n.a), 'project')} from your account and ${tally(n.b)} from ${here}.`;
    case 'USED_ACCOUNT':
      return `${cap(here)} now shows your account's board. Its previous board was backed up.`;
    default:
      return '';
  }
}

// Conflict copies name the device they came from, by id (AccountState's devices).
let deviceNames = new Map();
function learnDevices(state) {
  if (!Array.isArray(state?.devices)) return;
  const next = new Map();
  for (const d of state.devices) if (typeof d?.id === 'string') next.set(d.id, d.current ? here : deviceLabel({ platform: d.platform }));
  deviceNames = next;
  changed();
}

// ---- telling the app (one view per turn, however many changes)

let viewQueued = false;
function changed() {
  if (viewQueued || !page.board) return;
  viewQueued = true;
  Promise.resolve().then(() => {
    viewQueued = false;
    emit('board', buildView());
  });
}

function buildView() {
  const v = page.board.view();
  v.devices = Object.fromEntries(deviceNames);
  return v;
}

// ---- daily backups (backups.js keeps 10)

function dailyBackup() {
  try {
    main.flushData();
    backups?.dailyIfDue();
  } catch (err) {
    console.error('[backups]', err);
  }
}

// ---- the API

function result(fn) {
  try {
    return JSON.stringify(fn() ?? { ok: true });
  } catch (err) {
    console.error('[core]', err);
    return JSON.stringify({ ok: false, error: String(err?.message || err) });
  }
}

const RecallerCore = {
  init(opts) {
    return result(() => {
      const o = typeof opts === 'string' ? JSON.parse(opts) : opts || {};
      dataDir = String(o.dataDir || '');
      if (!dataDir) throw new Error('init needs dataDir');
      DATA_FILE = path.join(dataDir, DATA_NAME);
      images.folder = path.join(dataDir, 'images');
      fs.mkdirSync(dataDir, { recursive: true });
      Object.assign(process.env, o.env || {});
      if (o.settings) Object.assign(settings, o.settings);
      if (o.deviceName) here = String(o.deviceName);
      electron.app.userData = dataDir;
      electron.app.version = String(o.appVersion || '0.0.0');
      electron.app.isPackaged = o.packaged !== false;
      backups = require('../../src/backups');
      cloud = require('../../src/cloud/index');
      cloud.init({
        app: electron.app, ipcMain, userData: dataDir, isPackaged: o.packaged !== false, getWindow: () => fakeWindow,
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s) => N.seal(String(s)),
          decryptString: (b) => N.unseal(b),
        },
        images, backups,
        flushData: main.flushData,
        hasPendingWrite: () => main.pendingData !== null,
        isRestoring: () => main.restoring,
        getDeviceSettings: () => ({
          theme: settings.theme, model: settings.model, language: settings.language, hint: settings.hint,
          hotkey: '', shotHotkey: '', hideAfterCopy: false,
        }),
        holdSaves: () => {
          main.restoring = true;
          if (main.timer) clearTimeout(main.timer);
          main.timer = null;
          main.pendingData = null;
          main.pendingMeta = null;
        },
        appVersion: electron.app.version,
        platform: 'ios',
      });
      cloud.registerIpc(ipcMain);
      // removeBoardHere reloads the window 50 ms after a sign-out that removed the board.
      fakeWindow.webContents.reload = () => page.reload();
      page.init();
      dailyBackup();
      return { ok: true, accounts: cloud.enabled() };
    });
  },

  act(name, argsJson) {
    return result(() => {
      const fn = page.board && page.board[name];
      if (typeof fn !== 'function' || name === 'view') return { ok: false, error: `unknown action ${name}` };
      const args = argsJson ? JSON.parse(argsJson) : [];
      const res = fn.apply(page.board, Array.isArray(args) ? args : [args]);
      changed();
      return res;
    });
  },

  view() {
    return result(() => buildView());
  },

  async account(op, payloadJson) {
    const payload = payloadJson ? JSON.parse(payloadJson) : undefined;
    const fn = ipc.handlers.get(op.includes(':') ? op : `account:${op}`) || ipc.handlers.get(op);
    if (!fn) return JSON.stringify({ ok: false, code: 'UNAVAILABLE' });
    try {
      const res = await fn({}, payload);
      if (op === 'sync:now' || op === 'sign-out' || op === 'account:sign-out') changed();
      return JSON.stringify(res ?? null);
    } catch (err) {
      console.error('[account]', err);
      return JSON.stringify({ ok: false, code: 'UNAVAILABLE' });
    }
  },

  setBusy(what, on) {
    if (!Object.hasOwn(page.busy, what)) return;
    page.busy[what] = what === 'composer' ? on || null : Boolean(on);
    if (!on) page.tryApplyPatch();
  },

  lifecycle(state) {
    const was = { ...scene };
    if (state === 'active') Object.assign(scene, { visible: true, focused: true, minimized: false });
    else if (state === 'inactive') Object.assign(scene, { visible: true, focused: false, minimized: false });
    else if (state === 'background') Object.assign(scene, { visible: false, focused: false, minimized: true });
    if (state === 'background') {
      main.flushData();
      if (cloud?.hasUnpushed()) cloud.finalPush(8000).catch?.(() => {});
    }
    if (was.visible !== scene.visible || was.focused !== scene.focused) cloud?.onWindowState();
    if (state === 'active' && !was.visible) {
      electron.powerMonitor.emit('resume'); // pull now, refresh the sign-in (5.13)
      dailyBackup();
    }
  },

  async ensureImage(id, thumb) {
    if (images.has(String(id), Boolean(thumb))) return true;
    return cloud ? cloud.ensureImage(String(id), Boolean(thumb)) : false;
  },

  flush() {
    main.flushData();
  },

  setSettings(json) {
    try {
      Object.assign(settings, JSON.parse(json));
    } catch {}
  },

  // For the tests: the board as stored, and whether everything has settled.
  debug() {
    return JSON.stringify({
      data: page.data,
      pending: main.pendingData !== null || main.timer !== null,
      patch: Boolean(page.pendingPatch || page.patchTimer),
      contentSeq: page.contentSeq,
    });
  },
};

globalThis.RecallerCore = RecallerCore;
module.exports = RecallerCore;
