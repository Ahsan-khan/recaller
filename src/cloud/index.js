'use strict';
// The facade main.js uses for accounts and sync (ai_memory/15_accounts_and_sync.md, 3.3 and 3.6–3.8, 5.3,
// 5.13–5.16). It builds the REST clients, the account and the sync engine over this computer's data folder
// (wired as tests/support/peer.js wires them), answers the page's account:* and sync:* calls, and passes
// main's events on to the engine. All network goes through Electron's net.fetch, here in main: the page
// gets AccountState, Results and patches, never a token, a key, a password or the config.
//
// Accounts are off when the build has no cloud config, and in every test run that sets RECALLER_DATA_DIR
// without a mock (config.js). Off or signed out, every hook returns at once: no sync/ folder, no network,
// no timers and no quit delay, as in 1.16.0. account:get answers either way. No hook throws into main.js.

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { loadConfig } = require('./config');
const { createHttp } = require('./http');
const { createAuth } = require('./auth');
const { createFirestore } = require('./firestore');
const { createStorage } = require('./storage');
const { createTokenStore } = require('./tokens');
const { createAccount } = require('./account');
const { openSyncDir, deviceName } = require('../sync/state');
const { createSync } = require('../sync/engine');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHOICES = new Set(['upload', 'combine', 'use-account', 'not-now', 'delete-everywhere', 'keep', 'retry']);
const NACKS = new Set(['stale', 'invalid']);
const PROGRESS = new Set(['save-pictures', 'pictures', 'notes', 'account']);
const DATA_FILE = 'recaller-data.json';
const UNREADABLE = /^recaller-data\.unreadable-.+\.json$/; // copies the engine kept of a file it couldn't read
const RM = { force: true, recursive: true, maxRetries: 3, retryDelay: 25 };
const SIGN_OUT_PUSH_MS = 10000; // 5.14
const SIGN_OUT_PICTURES_MS = 20000; // a plain sign-out first saves the account's full-size pictures here
const DRAIN_MS = 2000;

let deps = {};
let config = null;      // never sent over IPC or logged: JSON.stringify would show the API key
let on = false;         // accounts are enabled in this run
let http = null;
let account = null;
let syncDir = null;
let firestore = null;
let storage = null;
let engine = null;      // one engine, kept across sign-outs (start() begins every run afresh)
let running = false;    // the engine runs: from a saved sign-in at start, or a sign-in, to a sign-out or deletion
let busy = false;       // an account operation from the page is running; another gets BUSY (3.6)
let deleting = false;   // account:delete is running
let progress = null;    // its { what, done, total }
let saving = null;      // a plain sign-out's { done, total } while it saves the account's full-size pictures here
let pageSession = null; // the page's last sync:ready
let lastSave = null;    // { session, contentSeq } of the page's last save that main has written
let nextSave = null;    // the same for the save main holds back (its 250 ms debounce), until it is written
let loadedFrom;         // what the page's data:load read while the engine didn't run: told once, at a sign-in
let powerWatched = false; // resume and unlock-screen, from the first time sync runs

const active = () => on && running && Boolean(engine);
const enabled = () => on;
const fail = (code) => ({ ok: false, code });
const unavailable = () => fail('UNAVAILABLE');
const count = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);

// Codes only: a message can carry an email or a note's text.
function warn(what, err) {
  try {
    const code = typeof err?.code === 'string' ? err.code : err ? err.name || 'Error' : '';
    console.warn(`[cloud] ${what}${code ? ` (${code})` : ''}`);
  } catch {}
}

function status() {
  try {
    return account?.state().status || 'signed-out';
  } catch {
    return 'signed-out';
  }
}

function online() {
  if (config?.offline) return false;
  try {
    return electron.net.isOnline() !== false;
  } catch {
    return true;
  }
}

function win() {
  try {
    const w = deps.getWindow?.();
    return w && !w.isDestroyed() ? w : null;
  } catch {
    return null;
  }
}

function send(channel, payload) {
  const w = win();
  if (!w) return;
  try {
    if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  } catch (err) {
    warn(`${channel} couldn't be sent`, err);
  }
}

function flush() {
  try {
    deps.flushData?.();
  } catch (err) {
    warn('the pending save failed', err);
  }
}

// Settles once the work does, and at the latest half a second after ms: the engine's own timeouts come first,
// this only makes sure a quit or a sign-out can never hang.
function settle(work, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms + 500);
    Promise.resolve(work).catch(() => {}).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---- AccountState (3.6), sent on every change

function devices() {
  const out = [];
  for (const d of engine.devices() || []) {
    if (!d || typeof d.id !== 'string') continue;
    out.push({ id: d.id, name: String(d.name || ''), platform: d.platform ?? null, lastSeenAt: Number(d.lastSeenAt) || 0, current: d.current === true });
  }
  if (!out.some((d) => d.current)) { // this computer is always listed, uploaded or not
    let id = '';
    try {
      id = syncDir.readDevice()?.id || '';
    } catch {}
    out.push({ id, name: deviceName(deps.platform || process.platform), platform: deps.platform || process.platform, lastSeenAt: 0, current: true });
  }
  return out;
}

function accountState() {
  if (!on || !account) return { enabled: false, state: 'signed-out' };
  let a;
  try {
    a = account.state() || {};
  } catch {
    a = {};
  }
  const out = { enabled: true, state: typeof a.status === 'string' ? a.status : 'signed-out' };
  if (typeof a.email === 'string' && a.email) out.email = a.email;
  if (typeof a.keyStore === 'string' && a.keyStore) out.keyStore = a.keyStore;
  if (active() && out.state === 'signed-in') {
    try {
      out.sync = engine.status();
      out.choice = engine.choice();
      out.devices = devices();
      out.counts = engine.counts();
      // While account:delete runs, its progress; otherwise an interrupted deletion asks for the password
      // again ("Finishing account deletion…"), with no stale numbers.
      out.deleting = deleting && progress ? { ...progress } : engine.deletion() ? { what: 'account', done: 0, total: 0 } : null;
      if (saving) out.signingOut = { what: 'pictures', ...saving };
    } catch (err) {
      warn("the sync state couldn't be read", err);
    }
  }
  return out;
}

function sendState() {
  if (on) send('account:changed', accountState());
}

// ---- the engine's life: started by a saved sign-in at init or by a sign-in, stopped at a sign-out or deletion

function startEngine() {
  try {
    if (!engine) {
      engine = createSync({
        syncDir,
        account,
        firestore,
        storage,
        images: deps.images || null,
        backups: deps.backups || null,
        page: { sendPatch: (patch) => send('sync:patch', patch), sendState },
        getDeviceSettings: () => deps.getDeviceSettings?.() || {},
        getWindowState: () => {
          const w = win();
          return w ? { visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized() } : { visible: false, focused: false, minimized: false };
        },
        hasPendingWrite: () => {
          try {
            return deps.hasPendingWrite?.() === true;
          } catch {
            return false;
          }
        },
        isRestoring: () => {
          try {
            return deps.isRestoring?.() === true;
          } catch {
            return false;
          }
        },
        flushData: flush,
        isOnline: () => electron.net.isOnline(),
        config,
        platform: deps.platform || process.platform,
        appVersion: String(deps.appVersion || ''),
        now: Date.now,
        log: console,
        serverNow: http.serverNow,
        dataFile: path.join(deps.userData, DATA_FILE),
      });
    }
    engine.start(); // does nothing while signed out
    running = status() !== 'signed-out';
    if (running) watchPower();
  } catch (err) {
    warn("sync couldn't start", err);
  }
}

// powerMonitor's resume and unlock-screen (3.8), watched from the first time sync runs and never while
// signed out: the first listener sets up Electron's power monitor (on Windows, a hidden window). On a Mac
// also shutdown (a log out, restart or shut down; never ⌘Q): main then quits without the final push.
function watchPower() {
  if (powerWatched) return;
  powerWatched = true;
  try {
    electron.powerMonitor.on('resume', onResume);
    electron.powerMonitor.on('unlock-screen', onResume);
    if ((deps.platform || process.platform) === 'darwin') electron.powerMonitor.on('shutdown', onShutdown);
  } catch (err) {
    warn('no resume events', err);
  }
}

function onShutdown() {
  try {
    deps.onShutdown?.();
  } catch (err) {
    warn('onShutdown failed', err);
  }
}

// running stays true while stop() takes a save already waiting in main (its onFileWritten must count).
function stopEngine() {
  if (!running) return;
  try {
    engine.stop();
  } catch (err) {
    warn("sync didn't stop cleanly", err);
  } finally {
    running = false;
  }
}

// The page that said sync:ready, to the engine. A page that loaded while the engine didn't run gets no
// data:load there: what that load read goes with it once, and so does the page's contentSeq when known: that
// of its last save on disk, which is what the engine reads (a newer one still in main is stale to it).
function tellPageReady() {
  const info = { session: pageSession };
  if (lastSave && lastSave.session === pageSession) info.contentSeq = lastSave.contentSeq;
  if (loadedFrom !== undefined) info.from = loadedFrom;
  loadedFrom = undefined;
  engine.onPageReady(info);
}

// A sign-in or sign-up in mid-session (5.9 follows in the engine). The save main still holds goes to disk
// first, so the engine starts from the board the page shows.
function signedIn() {
  flush();
  startEngine();
  try {
    if (active() && pageSession) tellPageReady();
  } catch (err) {
    warn("the page couldn't be told", err);
  }
}

function accountChanged(s) {
  try {
    if (s?.status === 'signed-out') stopEngine();
    // During a deletion a re-authentication can say signed-in again: the engine must not start syncing then.
    else if (active() && !deleting) engine.onAccountChange();
  } catch (err) {
    warn('the account change failed', err);
  }
  sendState();
}

// ---- init (5.3)

function init(d = {}) {
  deps = d && typeof d === 'object' ? d : {};
  // The test and development overrides count only in a run from source (3.4): a missing value counts as packaged.
  const isPackaged = typeof deps.isPackaged === 'boolean' ? deps.isPackaged : deps.app?.isPackaged !== false;
  try {
    config = loadConfig({ env: process.env, isPackaged });
    if (!config.enabled) return;
    const now = Date.now; // the same clock for http (Session.expiresAt) and the account
    http = createHttp({ fetchImpl: electron.net.fetch, now });
    const auth = createAuth({ http, endpoints: config.endpoints, apiKey: config.apiKey });
    syncDir = openSyncDir(deps.userData); // nothing is created until someone signs in
    const tokens = createTokenStore({
      dir: syncDir.dir, safeStorage: deps.safeStorage, mode: config.tokenStore, platform: deps.platform || process.platform,
      config, isPackaged,
    });
    account = createAccount({ auth, tokens, config, onChange: accountChanged, now, log: console });
    const getIdToken = (opts) => account.getIdToken(opts);
    firestore = createFirestore({ http, endpoints: config.endpoints, projectId: config.projectId, getIdToken });
    storage = createStorage({ http, endpoints: config.endpoints, bucket: config.bucket, getIdToken });
    on = true;
  } catch (err) {
    on = false;
    account = null;
    warn("accounts are off: the cloud couldn't be set up", err);
    return;
  }
  // A saved sign-in starts the engine before the page loads; nothing goes out until the page is ready.
  if (status() !== 'signed-out') startEngine();
}

// ---- hooks main.js calls (3.8); each returns at once while signed out

function onLoadResult(r) {
  if (!on) return;
  try {
    const from = r?.from === 'main' || r?.from === 'bak' ? r.from : null;
    if (!active()) {
      loadedFrom = from; // kept for a sign-in later in this page's life
      return;
    }
    loadedFrom = undefined;
    engine.onLoadResult({ from, value: r?.value, file: r?.file });
  } catch (err) {
    warn('onLoadResult failed', err);
  }
}

function onFileWritten(data, meta, text) {
  if (!on) return;
  lastSave = nextSave; // the save main noted last is the one it wrote
  nextSave = null;
  if (!active()) return;
  try {
    engine.onFileWritten(data, meta, text);
  } catch (err) {
    warn('onFileWritten failed', err);
  }
}

// null while signed out, so main keeps no meta then. The page's session and contentSeq are noted in memory
// either way, for a sign-in later in this page's life; they count once main has written that save.
function mergeSaveMeta(prev, next) {
  if (!on) return null;
  try {
    nextSave = next && typeof next === 'object' && !Array.isArray(next) && typeof next.session === 'string'
      && next.session.length > 0 && next.session.length <= 200 && Number.isSafeInteger(next.contentSeq)
      ? { session: next.session, contentSeq: next.contentSeq }
      : null;
    return active() ? engine.mergeSaveMeta(prev, next) : null;
  } catch {
    return null;
  }
}

function onPageLoading() {
  if (!on) return;
  pageSession = null;
  lastSave = null;
  nextSave = null;
  if (!active()) return;
  try {
    engine.onPageLoading();
  } catch (err) {
    warn('onPageLoading failed', err);
  }
}

function onRestore(id) {
  if (!active()) return;
  try {
    engine.onRestore(id);
  } catch (err) {
    warn('onRestore failed', err);
  }
}

function onWindowState() {
  if (!active()) return;
  try {
    engine.onWindowState();
  } catch (err) {
    warn('onWindowState failed', err);
  }
}

function onSummon() {
  if (!active()) return;
  try {
    engine.onSummon();
  } catch (err) {
    warn('onSummon failed', err);
  }
}

// powerMonitor resume and unlock-screen: pull now, and refresh the sign-in (5.13).
function onResume() {
  if (!active()) return;
  try {
    engine.onResume();
    const s = status();
    if ((s === 'signed-in' || s === 'unverified') && online()) account.getIdToken({ force: true }).catch(() => {});
  } catch (err) {
    warn('onResume failed', err);
  }
}

function hasUnpushed() {
  if (!active()) return false;
  try {
    return engine.hasUnpushed() === true;
  } catch {
    return false;
  }
}

// The before-quit push (5.16); always settles.
function finalPush(ms = 1500) {
  if (!active()) return Promise.resolve();
  const limit = Math.max(0, Number(ms) || 0);
  try {
    return settle(engine.finalPush(limit), limit);
  } catch {
    return Promise.resolve();
  }
}

// A picture another computer added, fetched before it is served or copied; false when it can't be.
async function ensureImage(id, thumb = false) {
  if (!active()) return false;
  try {
    return (await engine.ensureImage(String(id), Boolean(thumb))) === true;
  } catch {
    return false;
  }
}

// ---- the page's calls (3.6)

function emailOf(v) {
  if (typeof v !== 'string' || v.length > 1024) return null;
  const email = v.trim();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const passwordOf = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 4096 ? v : null);

// Only what a Result may hold reaches the page.
function clean(res) {
  if (!res || typeof res !== 'object') return unavailable();
  if (res.ok === true) return { ok: true };
  const out = fail(typeof res.code === 'string' && res.code ? res.code : 'UNAVAILABLE');
  if (Number.isFinite(res.retryAfterMs) && res.retryAfterMs >= 0) out.retryAfterMs = res.retryAfterMs;
  return out;
}

// One account operation at a time (3.6). The verification check, account:get and Sync now stay outside.
async function exclusive(fn) {
  if (!on || !account) return unavailable();
  if (busy) return fail('BUSY');
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

async function signUp(p) {
  if (status() !== 'signed-out') return unavailable();
  const email = emailOf(p?.email);
  if (!email) return fail('INVALID_EMAIL');
  const password = passwordOf(p?.password);
  if (!password) return fail('WEAK_PASSWORD');
  const privacy = typeof p?.privacyVersion === 'string' && p.privacyVersion.length <= 40 ? p.privacyVersion : null;
  const res = await account.signUp(email, password, privacy);
  if (res?.ok) signedIn();
  return clean(res);
}

async function signIn(p) {
  const s = status();
  if (s !== 'signed-out' && s !== 'needs-sign-in') return unavailable();
  const email = emailOf(p?.email);
  if (!email) return fail('INVALID_EMAIL');
  const password = passwordOf(p?.password);
  if (!password) return fail('WRONG_PASSWORD');
  const res = await account.signIn(email, password);
  if (res?.ok) signedIn();
  return clean(res);
}

async function checkVerified() {
  if (!on || !account) return { ...unavailable(), verified: false };
  const res = await account.checkVerified(); // shares the lookup on its way, the engine's polls included
  return { ...clean(res), verified: res?.ok === true && res.verified === true };
}

function localOnly() {
  const only = engine.localOnly() || {};
  return {
    projects: count(only.projects), notes: count(only.notes), pictures: count(only.pictures), unreadable: count(only.unreadable),
  };
}

// Only a board the account holds may go: never for a deleted or turned-off account.
function holdsBoard() {
  const s = status();
  return active() && (s === 'signed-in' || s === 'needs-sign-in' || s === 'unverified');
}

// A plain sign-out first saves here, for at most 20 s, the full-size pictures this board shows that this computer
// holds only as previews (another computer added them): signed out, nothing could fetch them. → how many are
// still only previews here (offline, out of time, or failed); the account keeps them, images.js shows the previews.
// A picture the account doesn't hold either (another computer couldn't upload it) isn't counted: nothing to promise.
async function savePictures() {
  if (status() !== 'signed-in' || typeof engine.completePictures !== 'function') return 0;
  let seen = null;
  let res = null;
  let over = false;
  const onProgress = (x) => {
    if (over) return; // a download still on its way after the 20 s
    seen = { done: count(x?.done), total: count(x?.total) };
    saving = seen.total ? seen : null;
    sendState();
  };
  try {
    const work = engine.completePictures({ deadline: Date.now() + SIGN_OUT_PICTURES_MS, strict: false, onProgress });
    await settle(Promise.resolve(work).then((r) => { res = r; }), SIGN_OUT_PICTURES_MS);
  } catch (err) {
    warn("the pictures couldn't be saved here", err);
  } finally {
    over = true;
    saving = null;
  }
  let phase = '';
  try {
    phase = engine.status()?.phase || '';
  } catch {}
  if (phase === 'deleting-elsewhere') return 0; // the account won't keep them: nothing to promise
  if (res && typeof res === 'object') return count(res.left) + count(res.failed); // not tried, or failed
  return seen ? Math.max(0, seen.total - seen.done) : 0;
}

// 5.14: what waits goes up first; then the sign-in goes, and with removeBoard the board, its pictures and its
// backups too. The board is never removed while something of it exists only here: changes still waiting,
// or what the account refused or can't take (engine.localOnly()), forced or not. Copies kept of a data file
// that couldn't be read may hold notes nothing else has: they go with the board only once the page has named
// them and the person agreed (removeUnreadable), else PENDING with localOnly.unreadable (as peer.js signOut).
// A plain sign-out answers picturesLeft when some full-size pictures stayed in the account (savePictures).
async function signOut(p) {
  const force = p?.force === true;
  const removeBoard = p?.removeBoard === true;
  const removeUnreadable = p?.removeUnreadable === true;
  let picturesLeft = 0;
  if (removeBoard && !holdsBoard()) return unavailable();
  if (active()) {
    flush();
    if (status() === 'signed-in' && engine.hasUnpushed() && online()) await settle(engine.finalPush(SIGN_OUT_PUSH_MS), SIGN_OUT_PUSH_MS);
    // The push may have learnt that the account was turned off or deleted meanwhile (so may the drain below).
    if (removeBoard && !holdsBoard()) return unavailable();
    const pending = engine.hasUnpushed() ? Math.max(1, count(engine.status()?.pending)) : 0;
    if (pending && !force && !removeBoard) return { ok: false, code: 'PENDING', pending };
    if (removeBoard) {
      const only = localOnly();
      const kept = only.projects + only.notes + only.pictures;
      if (pending || kept || (only.unreadable && !removeUnreadable)) return { ok: false, code: 'PENDING', pending: pending + kept, localOnly: only };
    } else {
      picturesLeft = await savePictures();
    }
    await settle(engine.drain(DRAIN_MS), DRAIN_MS); // the patch on its way lands or is withdrawn
    if (removeBoard && !holdsBoard()) return unavailable();
    stopEngine();
  }
  const res = await account.signOut(); // account.json goes; device.json, state.json and shadow.json stay
  if (!res?.ok) {
    signedIn(); // still signed in: sync goes on
    return clean(res);
  }
  if (removeBoard) removeBoardHere();
  return picturesLeft ? { ok: true, picturesLeft } : { ok: true };
}

// "Also remove this board, its pictures and its backups from this computer" (5.14 step 5). The settings
// file and the data folder stay. Saves are held off until the page loads again, which then shows Welcome.
function removeBoardHere() {
  try {
    deps.holdSaves?.();
  } catch (err) {
    warn("saves couldn't be held", err);
  }
  const dir = deps.userData;
  const file = path.join(dir, DATA_FILE);
  const targets = [file, `${file}.bak`, `${file}.tmp`, path.join(dir, 'images'), path.join(dir, 'backups')];
  try {
    for (const name of fs.readdirSync(dir)) if (UNREADABLE.test(name)) targets.push(path.join(dir, name));
  } catch {}
  for (const target of targets) {
    try {
      fs.rmSync(target, RM);
    } catch (err) {
      warn("part of the board couldn't be removed", err);
    }
  }
  try {
    syncDir.removeAccountState({ clearLastUid: true });
  } catch (err) {
    warn("the sync state couldn't be removed", err);
  }
  setTimeout(() => win()?.webContents.reload(), 50);
}

// 5.15: account.js re-authenticates and deletes the sign-in; the engine erases the cloud board between, and
// its progress reaches the page in account:changed. The board here stays.
async function deleteAccount(p) {
  const password = passwordOf(p?.password);
  if (!password) return fail('WRONG_PASSWORD');
  if (status() === 'signed-out') return unavailable();
  deleting = true;
  progress = null;
  const onProgress = (x) => {
    if (!x || typeof x !== 'object') return;
    progress = { what: PROGRESS.has(x.what) ? x.what : 'account', done: count(x.done), total: count(x.total) };
    sendState();
  };
  try {
    const res = await account.deleteAccount(password, {
      eraseData: () => {
        if (!active()) throw new Error('sync is not running'); // never the sign-in alone while the board is in the cloud
        return engine.deleteAccountData(onProgress);
      },
      onProgress,
    });
    if (res?.ok) {
      stopEngine();
      try {
        syncDir.removeAccountState({ clearLastUid: true });
      } catch (err) {
        warn("the sync state couldn't be removed", err);
      }
    }
    return clean(res);
  } finally {
    deleting = false;
    progress = null;
    sendState();
  }
}

function pageReady(info) {
  if (!on) return;
  const session = info?.session;
  if (typeof session !== 'string' || !session || session.length > 200) return;
  pageSession = session;
  if (active()) tellPageReady();
}

function nack(info) {
  if (!active()) return;
  const patchId = info?.patchId;
  if (typeof patchId !== 'string' || !patchId || patchId.length > 200 || !NACKS.has(info?.reason)) return;
  engine.onNack({ patchId, reason: info.reason });
}

async function syncNow() {
  if (!active()) return null;
  return engine.syncNow();
}

function choose(p) {
  if (!active()) return unavailable();
  const choice = p?.choice;
  if (typeof choice !== 'string' || !CHOICES.has(choice)) return unavailable();
  if (busy) return fail('BUSY');
  return clean(engine.choose(choice));
}

function registerIpc(ipcMain) {
  const handle = (channel, fn, fallback) => ipcMain.handle(channel, async (_e, payload) => {
    try {
      return await fn(payload);
    } catch (err) {
      warn(`${channel} failed`, err);
      return fallback();
    }
  });
  const listen = (channel, fn) => ipcMain.on(channel, (_e, payload) => {
    try {
      fn(payload);
    } catch (err) {
      warn(`${channel} failed`, err);
    }
  });
  try {
    handle('account:get', () => accountState(), () => ({ enabled: on, state: 'signed-out' }));
    handle('account:sign-up', (p) => exclusive(() => signUp(p)), unavailable);
    handle('account:sign-in', (p) => exclusive(() => signIn(p)), unavailable);
    handle('account:resend-verification', () => exclusive(async () => clean(await account.resendVerification())), unavailable);
    handle('account:check-verified', () => checkVerified(), () => ({ ...unavailable(), verified: false }));
    handle('account:discard-unverified', () => exclusive(async () => clean(await account.discardUnverified())), unavailable);
    handle('account:reset-password', (p) => exclusive(async () => {
      const email = emailOf(p?.email);
      return email ? clean(await account.resetPassword(email)) : fail('INVALID_EMAIL');
    }), unavailable);
    handle('account:sign-out', (p) => exclusive(() => signOut(p)), unavailable);
    handle('account:delete', (p) => exclusive(() => deleteAccount(p)), unavailable);
    listen('sync:ready', pageReady);
    listen('sync:nack', nack);
    handle('sync:now', () => syncNow(), () => null);
    handle('sync:choose', (p) => choose(p), unavailable);
  } catch (err) {
    warn("the account calls couldn't be registered", err);
  }
}

module.exports = {
  init, registerIpc, enabled, active,
  onLoadResult, onFileWritten, mergeSaveMeta, onPageLoading, onRestore, onWindowState, onSummon, onResume,
  hasUnpushed, finalPush, ensureImage,
};
