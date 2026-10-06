'use strict';
// src/cloud/index.js, the facade main.js uses (ai_memory/15, 3.8, 5.14, 5.16), in plain Node: require('electron')
// gets a stand-in (net.fetch is the GCP mock's in-process fetch, powerMonitor an EventEmitter, a window that
// only records), main's 250 ms debounced write and the page's saves are played as main.js and app.js make
// them, over a temporary data folder, with real timers and RECALLER_SYNC_FAST. It never starts Electron.
// The facade keeps its state in the module, so each app loads a fresh one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { createGcpMock } = require('../mock-gcp');
const { seedData, pngBytes } = require('../support/peer');
const { CloudError } = require('../../src/cloud/http');
const store = require('../../src/store');
const SyncApply = require('../../src/renderer/sync-apply');
const engineModule = require('../../src/sync/engine');

const EMAIL = 'owner@example.com';
const PASSWORD = 'password-1234';

process.env.RECALLER_GCP_BASE = 'http://127.0.0.1:9'; // mock.fetch needs no socket; only a loopback address
process.env.RECALLER_TOKEN_STORE = 'test-file';
process.env.RECALLER_SYNC_FAST = '1';
for (const k of ['RECALLER_DATA_DIR', 'RECALLER_GCP_REAL', 'RECALLER_SYNC_OFFLINE']) delete process.env[k];

let mock = null; // the running test's
const electron = { net: { fetch: (url, init) => mock.fetch(url, init), isOnline: () => true }, powerMonitor: new EventEmitter() };
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'electron' ? 'electron' : resolveFilename.call(this, request, ...rest);
};
require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: electron };

// The engine the facade creates, seen through onEngine (set by a test before the app starts).
let onEngine = null;
const createSync = engineModule.createSync;
engineModule.createSync = (deps) => {
  const engine = createSync(deps);
  return onEngine ? onEngine(engine) : engine;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-facade-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let dirs = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(20);
  }
  return Boolean(await cond());
}

function world() {
  mock = createGcpMock({ now: Date.now });
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  electron.powerMonitor.removeAllListeners();
  onEngine = null;
  return mock;
}

const note = (id, text) => ({ id, text, images: [], createdAt: 1, updatedAt: 1, copied: 0, lastCopiedAt: 0, usedAt: 0 });
const board = () => ({
  version: 2, prefs: { density: 'slim' },
  projects: [{
    id: 'p-work', name: 'Work', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: 1,
    notes: [note('n-1', 'a synced note')], used: [], combined: [],
  }],
});

// The images folder as src/images.js keeps it (<id>.png and its preview <id>.t.png), for the engine.
function imagesIn(dir) {
  const folder = path.join(dir, 'images');
  const file = (id, thumb) => path.join(folder, `${id}${thumb ? '.t' : ''}.png`);
  const ok = (id) => /^[a-f0-9]{32}$/.test(String(id));
  return {
    file,
    has: (id, thumb = false) => ok(id) && fs.existsSync(file(id, thumb)),
    size: (id, thumb = false) => { try { return ok(id) ? fs.statSync(file(id, thumb)).size : null; } catch { return null; } },
    readFile: (id, thumb = false) => fs.promises.readFile(file(id, thumb)),
    writeWithId: (id, thumb, bytes) => { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file(id, thumb), bytes); },
    ensureThumb: (id) => {
      if (!fs.existsSync(file(id, true)) && fs.existsSync(file(id, false))) fs.copyFileSync(file(id, false), file(id, true));
      return fs.existsSync(file(id, true));
    },
  };
}

// One run of the app: a fresh facade, main's write path and a page, as main.js, preload.js and app.js wire them.
function createApp({ data = board(), platform = 'darwin', flushable = true, pictures = false } = {}) {
  const file = require.resolve('../../src/cloud/index.js');
  delete require.cache[file];
  const cloud = require(file);
  const dir = path.join(root, `app-${++dirs}`);
  fs.mkdirSync(dir, { recursive: true });
  const DATA = path.join(dir, 'recaller-data.json');
  if (data) store.writeJsonAtomic(DATA, data);
  const app = { cloud, dir, DATA, holds: 0, reloads: 0, shutdowns: 0, sent: [], images: pictures ? imagesIn(dir) : null };
  const backups = { // backups.create: the data file as it is, kept aside
    made: [],
    create(kind) {
      if (!fs.existsSync(DATA)) return null;
      const id = `${backups.made.length + 1}_${kind}`;
      fs.mkdirSync(path.join(dir, 'backups', id), { recursive: true });
      fs.copyFileSync(DATA, path.join(dir, 'backups', id, 'recaller-data.json'));
      backups.made.push(id);
      return id;
    },
    texts: () => backups.made.map((id) => fs.readFileSync(path.join(dir, 'backups', id, 'recaller-data.json'), 'utf8')),
  };
  app.backups = backups;

  // main.js: scheduleDataWrite and flushData (the acknowledging save takes nothing's place), loadData.
  const main = { pendingData: null, pendingMeta: null, timer: null, held: false };
  main.flush = () => {
    clearTimeout(main.timer);
    main.timer = null;
    if (!main.pendingData || main.held) return;
    const text = store.writeJsonAtomic(DATA, main.pendingData);
    const written = main.pendingData;
    const meta = main.pendingMeta;
    main.pendingData = null;
    main.pendingMeta = null;
    cloud.onFileWritten(written, meta, text);
  };
  main.save = (value, meta) => {
    if (main.held) return;
    if (meta?.ack && main.pendingData && cloud.active()) main.flush();
    main.pendingData = JSON.parse(JSON.stringify(value)); // what IPC delivers is a copy
    main.pendingMeta = cloud.mergeSaveMeta(main.pendingMeta, meta);
    clearTimeout(main.timer);
    main.timer = setTimeout(main.flush, 250);
  };
  main.load = () => {
    main.flush();
    main.held = false;
    const { value, from } = store.readJsonWithFallback(DATA);
    cloud.onLoadResult({ from: from === DATA ? 'main' : from ? 'bak' : null, value, file: DATA });
    if (from === DATA) store.backup(DATA);
    return value;
  };
  app.main = main;

  // app.js: persist with its bookkeeping, the stale check, a patch held while the page is busy, the draft rule,
  // patches applied and acknowledged.
  const page = { data: null, session: null, contentSeq: 0, saveSeq: 0, labels: [], sessions: 0, busy: false, held: null };
  page.persist = (extra = {}) => main.save(page.data, {
    session: page.session, seq: ++page.saveSeq, contentSeq: page.contentSeq, labels: page.labels.splice(0), ...extra,
  });
  page.load = () => {
    cloud.onPageLoading(); // data:load
    const raw = main.load();
    page.session = `s-page-${++page.sessions}`;
    page.contentSeq = 0;
    page.saveSeq = 0;
    let n = 0;
    page.data = raw && Array.isArray(raw.projects) ? raw : seedData(() => `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`, Date.now);
    if (!raw) page.persist();
    app.listeners.get('sync:ready')(null, { session: page.session });
  };
  page.addNote = (text) => {
    page.data.projects[0].notes.push(note(`n-${Date.now()}-${page.contentSeq}`, text));
    page.contentSeq++;
    page.labels.push('New note');
    page.persist();
  };
  const nack = (patchId) => setImmediate(() => app.listeners.get('sync:nack')(null, { patchId, reason: 'stale' }));
  const holdsDraft = (id) => page.data.projects.some((x) => x.id === id && (x.draft.trim() || x.draftImages.length));
  page.tryApplyPatch = () => {
    const p = page.held;
    if (!p) return;
    if (p.session !== page.session || (p.changesContent && p.basedOnContentSeq !== page.contentSeq)) {
      page.held = null;
      nack(p.id);
      return;
    }
    if (page.busy && (p.changesContent || p.resetHistory)) return; // until page.release()
    const drafts = p.projects.remove.some(holdsDraft);
    if (drafts && !p.notices.some((x) => x?.code === 'USED_ACCOUNT')) {
      page.held = null;
      page.persist();
      nack(p.id);
      return;
    }
    page.held = null;
    SyncApply.applyPatch(page.data, p);
    if (p.changesContent) page.contentSeq++;
    page.persist({ ack: p.id });
  };
  page.release = () => {
    page.busy = false;
    page.tryApplyPatch();
  };
  page.receive = (channel, p) => {
    if (channel !== 'sync:patch') return;
    setImmediate(() => {
      page.held = p;
      page.tryApplyPatch();
    });
  };
  app.page = page;

  const win = {
    isDestroyed: () => false, isVisible: () => true, isFocused: () => true, isMinimized: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => {
        app.sent.push({ channel, payload });
        page.receive(channel, payload);
      },
      reload: () => { app.reloads++; },
    },
  };
  app.handlers = new Map();
  app.listeners = new Map();
  cloud.init({
    isPackaged: false, safeStorage: null, userData: dir, getWindow: () => win, images: app.images,
    backups, flushData: flushable ? main.flush : () => {}, hasPendingWrite: () => main.pendingData !== null,
    isRestoring: () => main.held, getDeviceSettings: () => ({}), appVersion: '1.17.0', platform,
    holdSaves: () => {
      app.holds++;
      main.held = true;
      clearTimeout(main.timer);
      main.pendingData = null;
      main.pendingMeta = null;
    },
    onShutdown: () => { app.shutdowns++; },
  });
  cloud.registerIpc({ handle: (c, fn) => app.handlers.set(c, fn), on: (c, fn) => app.listeners.set(c, fn) });
  app.invoke = (channel, payload) => app.handlers.get(channel)(null, payload);
  app.state = () => app.invoke('account:get');
  // The sign-out that ends a test, so no engine timer outlives it.
  app.close = async () => {
    if ((await app.state()).state !== 'signed-out') await app.invoke('account:sign-out', { force: true });
    clearTimeout(main.timer);
  };
  return app;
}

async function signInAndUpload(app) {
  assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
  assert.ok(await until(async () => (await app.state()).choice?.kind === 'first-upload'), 'asked to upload this board');
  assert.deepEqual(await app.invoke('sync:choose', { choice: 'upload' }), { ok: true });
  assert.ok(await until(async () => {
    const s = await app.state();
    return s.sync?.phase === 'synced' && !s.choice && s.sync.pending === 0;
  }), 'uploaded');
}

test('"Also remove this board" keeps the copies of an unreadable notes file until the page has named them and the person agreed', async (t) => {
  world();
  const app = createApp();
  t.after(() => app.close());
  app.page.load(); // signed out
  // A copy kept of a notes file that couldn't be read (3.5): the only place its newest notes may live.
  const copy = path.join(app.dir, 'recaller-data.unreadable-2026-09-30T10-00-00-000Z.json');
  fs.writeFileSync(copy, '{ "projects": [ { "id": "p-work", "notes": [ { "id": "n-2", "text": "written just before the file broke"');
  await signInAndUpload(app);

  // As peer.js signOut: refused, with the copies named, and nothing removed.
  const refused = await app.invoke('account:sign-out', { removeBoard: true });
  assert.deepEqual(refused, { ok: false, code: 'PENDING', pending: 0, localOnly: { projects: 0, notes: 0, pictures: 0, unreadable: 1 } });
  assert.ok(fs.existsSync(copy), 'the copy is kept');
  assert.ok(fs.existsSync(app.DATA), 'the board is kept');
  assert.equal((await app.state()).state, 'signed-in', 'still signed in');
  assert.equal(app.holds, 0);

  // Once the person agreed, the copies go with the board.
  assert.deepEqual(await app.invoke('account:sign-out', { removeBoard: true, removeUnreadable: true }), { ok: true });
  assert.equal(fs.existsSync(copy), false, 'the copy went with the board');
  assert.equal(fs.existsSync(app.DATA), false, 'the board was removed');
  assert.equal(app.holds, 1, 'saves were held off');
  assert.equal((await app.state()).state, 'signed-out');
  assert.ok(await until(() => app.reloads === 1, 2000), 'the page starts over');
});

test('a sign-in tells the engine the contentSeq of the page\'s last save on disk, never that of a save main still holds', async (t) => {
  for (const flushable of [true, false]) {
    world();
    // The account already holds a board (another computer).
    const other = mock.remote(mock.user(EMAIL).uid);
    other.createHead({ joiner: 'blank' });
    const { id: pid } = other.addProject('Work');
    other.addNote(pid, 'a note of the account');

    const told = [];
    let app = null;
    onEngine = (engine) => new Proxy(engine, {
      get(target, key) {
        if (key !== 'onPageReady') return target[key];
        return (info) => {
          told.push({ info, disk: fs.readFileSync(app.DATA, 'utf8') });
          return target.onPageReady(info);
        };
      },
    });
    // A fresh computer: the Welcome board, saved before the sign-in (contentSeq 0).
    let n = 0;
    app = createApp({ data: seedData(() => `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`, Date.now), flushable });
    t.after(() => app.close());
    app.page.load();
    // The person adds a note and signs in at once: that save still waits in main's 250 ms debounce.
    app.page.addNote('typed just before signing in');
    assert.ok(app.main.pendingData, 'the save waits in main');
    assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });

    assert.equal(told.length, 1, 'the page was told once');
    const [{ info, disk }] = told;
    assert.equal(info.session, app.page.session);
    if (flushable) {
      // main's pending save went to disk before the engine started: the engine reads the board the page shows.
      assert.equal(info.contentSeq, 1);
      assert.ok(disk.includes('typed just before signing in'), 'the note is on disk');
    } else {
      // The save couldn't be written first: the engine isn't told a contentSeq the file doesn't hold (its patch
      // would pass the page's stale check though computed without the note); it learns it with a probe.
      assert.equal(disk.includes('typed just before signing in'), false);
      assert.equal(info.contentSeq, undefined);
    }
    await app.close();
  }
});

test('a log out, restart or shut down on a Mac reaches main from powerMonitor, watched only while signed in', async (t) => {
  for (const platform of ['darwin', 'win32']) {
    world();
    const app = createApp({ platform });
    t.after(() => app.close());
    app.page.load();
    // Signed out, as in 1.16: no power monitor at all.
    for (const event of ['shutdown', 'resume', 'unlock-screen']) assert.equal(electron.powerMonitor.listenerCount(event), 0);
    assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
    assert.equal(electron.powerMonitor.listenerCount('resume'), 1);
    assert.equal(electron.powerMonitor.listenerCount('shutdown'), platform === 'darwin' ? 1 : 0, `${platform}: shutdown is watched on a Mac only`);
    electron.powerMonitor.emit('shutdown');
    assert.equal(app.shutdowns, platform === 'darwin' ? 1 : 0);
    await app.close();
  }
});

test('"Use my account\'s board": a draft saved just before the page acknowledges the patch reaches the disk first, so it is backed up', async (t) => {
  world();
  // The account already holds a board (another computer).
  const other = mock.remote(mock.user(EMAIL).uid);
  other.createHead({ joiner: 'blank' });
  const { id: pid } = other.addProject('Work');
  other.addNote(pid, 'a note of the account');

  const app = createApp(); // this computer's own board: one column, Work (p-work)
  t.after(() => app.close());
  app.page.load();
  assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
  assert.ok(await until(async () => (await app.state()).choice?.kind === 'first-merge'), 'asked how to combine');

  // The composer is open in this computer's column: the patch that replaces the board waits for it.
  app.page.busy = true;
  assert.deepEqual(await app.invoke('sync:choose', { choice: 'use-account' }), { ok: true });
  assert.ok(await until(() => app.page.held?.notices.some((n) => n?.code === 'USED_ACCOUNT')), 'the patch waits in the page');
  // A draft typed there; closing the composer saves it, and the patch is applied at once, while that save
  // still waits in main's 250 ms debounce.
  app.page.data.projects.find((p) => p.id === 'p-work').draft = 'a draft typed while the account\'s board waited';
  app.page.persist();
  app.page.release();
  assert.ok(await until(async () => {
    const s = await app.state();
    return s.sync?.phase === 'synced' && !s.choice && !app.main.pendingData;
  }), 'the account\'s board is in place');
  assert.ok(!fs.readFileSync(app.DATA, 'utf8').includes('a draft typed'), 'the column went with the board');
  assert.ok(app.backups.texts().some((x) => x.includes('a draft typed while the account\'s board waited')), 'the draft is in a backup');
});

// ---- a plain sign-out saves the account's full-size pictures here first (5.14); account deletion too (5.15)

// What the page was told while signing out: the progress lines, in order.
const signingOut = (app) => app.sent.filter((x) => x.channel === 'account:changed' && x.payload.signingOut).map((x) => x.payload.signingOut);
// The engine the facade creates, with some of its calls replaced.
const replacing = (calls) => (engine) => new Proxy(engine, { get: (target, key) => (Object.hasOwn(calls, key) ? calls[key] : target[key]) });

test('a plain sign-out first saves the full-size pictures this computer holds only as previews; the page sees how far it got, and what stayed in the account', async (t) => {
  world();
  const asked = [];
  onEngine = replacing({
    async completePictures({ deadline, strict, onProgress }) {
      asked.push({ wait: deadline - Date.now(), strict });
      for (let done = 0; done < 3; done++) {
        onProgress({ done, total: 3 });
        await sleep(20);
      }
      return { total: 3, fetched: 2, left: 0, failed: 1 };
    },
  });
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true, picturesLeft: 1 });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].strict, false, 'a failure counts and the rest go on');
  assert.ok(asked[0].wait > 19000 && asked[0].wait <= 20000, `no new download starts after 20 s (${asked[0].wait} ms)`);
  assert.deepEqual(signingOut(app), [0, 1, 2].map((done) => ({ what: 'pictures', done, total: 3 })));
  const after = await app.state();
  assert.equal(after.state, 'signed-out');
  assert.equal(after.signingOut, undefined);
});

test('removing the board saves no pictures; neither does an engine without completePictures, and that sign-out answers as before', async (t) => {
  for (const removeBoard of [true, false]) {
    world();
    let asked = 0;
    onEngine = removeBoard
      ? replacing({ completePictures: async () => { asked++; return { total: 0, fetched: 0, left: 0, failed: 0 }; } })
      : replacing({ completePictures: undefined });
    const app = createApp();
    t.after(() => app.close());
    app.page.load();
    await signInAndUpload(app);
    assert.deepEqual(await app.invoke('account:sign-out', { removeBoard }), { ok: true });
    assert.equal(asked, 0);
    assert.deepEqual(signingOut(app), []);
    assert.equal((await app.state()).state, 'signed-out');
  }
});

test('a sign-out never waits for the pictures more than 20 s: what wasn\'t saved by then stays in the account', async (t) => {
  world();
  onEngine = replacing({
    completePictures: ({ onProgress }) => {
      onProgress({ done: 1, total: 4 });
      return new Promise(() => {}); // a download that never ends
    },
  });
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  const started = Date.now();
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true, picturesLeft: 3 });
  const took = Date.now() - started;
  assert.ok(took >= 20000 && took < 24000, `signed out after ${took} ms`);
  assert.equal((await app.state()).state, 'signed-out');
});

test('deleting the account: the page sees "save-pictures" first; a failure there deletes nothing and leaves no deletion to finish', async (t) => {
  world();
  const app = createApp();
  t.after(() => app.close());
  onEngine = replacing({
    async deleteAccountData(onProgress) {
      onProgress({ what: 'save-pictures', done: 0, total: 2 });
      onProgress({ what: 'save-pictures', done: 1, total: 2 });
      throw new CloudError('NETWORK', { service: 'storage' });
    },
  });
  app.page.load();
  await signInAndUpload(app);
  assert.deepEqual(await app.invoke('account:delete', { password: PASSWORD }), { ok: false, code: 'NETWORK' });
  const told = app.sent.filter((x) => x.channel === 'account:changed' && x.payload.deleting).map((x) => x.payload.deleting);
  assert.deepEqual(told, [{ what: 'save-pictures', done: 0, total: 2 }, { what: 'save-pictures', done: 1, total: 2 }]);
  const after = await app.state();
  assert.equal(after.state, 'signed-in', 'still signed in');
  assert.equal(after.deleting, null, 'nothing to finish ("Finishing account deletion…" stays away)');
  assert.ok(mock.user(EMAIL), 'the account is there');
  assert.ok(mock.docs(mock.user(EMAIL).uid).head, 'and so is its board');
});

// With the engine's own completePictures (skipped while the engine has none).
const IMG = 'ab'.repeat(16);
const FULL = pngBytes(300000, 7);
const PREVIEW = pngBytes(20000, 3);

// The account holds a note with a picture another computer added (its full size and preview in Storage); this
// computer signs in, combines, and gets the note and the preview, not the full size.
async function withPictureFromElsewhere(t) {
  world();
  const uid = mock.user(EMAIL).uid;
  const other = mock.remote(uid);
  other.createHead({ joiner: 'blank' });
  const { id: pid } = other.addProject('From the PC');
  mock.writeObject(`users/${uid}/images/${IMG}.png`, FULL, 'image/png');
  mock.writeObject(`users/${uid}/images/${IMG}.t.png`, PREVIEW, 'image/png');
  other.addNote(pid, 'a screenshot taken on the PC', { fields: { images: [{ id: IMG, w: 3000, h: 1600 }] } });
  let engine = null;
  onEngine = (e) => { engine = e; return e; };
  const app = createApp({ pictures: true });
  t.after(() => app.close());
  app.page.load();
  assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
  if (typeof engine?.completePictures !== 'function') return null;
  assert.ok(await until(async () => (await app.state()).choice?.kind === 'first-merge'), 'asked how to combine');
  assert.deepEqual(await app.invoke('sync:choose', { choice: 'combine' }), { ok: true });
  const shown = () => JSON.parse(fs.readFileSync(app.DATA, 'utf8')).projects.some((p) => p.notes.some((n) => n.images?.some((i) => i.id === IMG)));
  assert.ok(await until(shown, 20000), 'the note reached this computer');
  assert.ok(await until(async () => { const s = await app.state(); return s.sync?.phase === 'synced' && !s.choice && s.sync.pending === 0; }), 'combined');
  assert.ok(await until(() => app.images.has(IMG, true)), 'its preview is here');
  return app;
}

test('signed out after a plain sign-out, a picture from another computer opens and copies at full size (with the engine\'s completePictures)', async (t) => {
  const app = await withPictureFromElsewhere(t);
  if (!app) return t.skip('the engine has no completePictures yet');
  assert.equal(app.images.has(IMG), false, 'only the preview so far');
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true });
  assert.ok(app.images.has(IMG), 'the full size is here');
  assert.ok(fs.readFileSync(app.images.file(IMG, false)).equals(FULL));
  assert.ok(signingOut(app).some((p) => p.total === 1), 'the page showed it');
  assert.equal(await app.cloud.ensureImage(IMG, false), false, 'signed out, nothing is fetched');
});

test('offline, a plain sign-out leaves the full size in the account, says so, and keeps the preview (with the engine\'s completePictures)', async (t) => {
  const app = await withPictureFromElsewhere(t);
  if (!app) return t.skip('the engine has no completePictures yet');
  electron.net.isOnline = () => false;
  const undo = mock.fail({ service: 'storage', status: 'offline', times: 50 });
  t.after(() => { electron.net.isOnline = () => true; });
  const res = await app.invoke('account:sign-out', { force: true, removeBoard: false });
  electron.net.isOnline = () => true;
  undo();
  assert.deepEqual(res, { ok: true, picturesLeft: 1 });
  assert.equal(app.images.has(IMG), false);
  assert.ok(app.images.has(IMG, true), 'the preview stays');
  assert.equal((await app.state()).state, 'signed-out');
});

test('deleting the account first saves here the full-size pictures this computer had only as previews (with the engine\'s completePictures)', async (t) => {
  const app = await withPictureFromElsewhere(t);
  if (!app) return t.skip('the engine has no completePictures yet');
  const uid = mock.user(EMAIL).uid;
  assert.deepEqual(await app.invoke('account:delete', { password: PASSWORD }), { ok: true });
  assert.ok(app.images.has(IMG), 'the full size is here');
  assert.deepEqual(Object.keys(mock.objects(uid)), [], 'and no longer in the account');
  const told = app.sent.filter((x) => x.channel === 'account:changed' && x.payload.deleting).map((x) => x.payload.deleting.what);
  assert.ok(told.indexOf('save-pictures') >= 0 && told.indexOf('save-pictures') < told.indexOf('pictures'), `saved before anything was deleted (${[...new Set(told)].join(', ')})`);
});

// ---- the sign-out's pictures: what the page is told, and what stays behind (final verify round)

// The engine the facade creates, with some calls replaced by functions of the real engine.
const overriding = (make) => (engine) => {
  const calls = make(engine);
  return new Proxy(engine, { get: (target, key) => (Object.hasOwn(calls, key) ? calls[key] : target[key]) });
};

test('a plain sign-out promises only the pictures the account keeps: not tried or failed, never one it doesn\'t hold either', async (t) => {
  world();
  onEngine = replacing({ completePictures: async () => ({ total: 3, fetched: 1, left: 0, failed: 1 }) }); // one the account lacks
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true, picturesLeft: 1 });
});

test('a picture whose files another computer never uploaded isn\'t counted as staying in the account (with the engine\'s completePictures)', async (t) => {
  // The account holds a note with two pictures: one in Storage (full size and preview), one it never received.
  world();
  const uid = mock.user(EMAIL).uid;
  const other = mock.remote(uid);
  other.createHead({ joiner: 'blank' });
  const { id: pid } = other.addProject('From the PC');
  const MISSING = 'cd'.repeat(16);
  mock.writeObject(`users/${uid}/images/${IMG}.png`, FULL, 'image/png');
  mock.writeObject(`users/${uid}/images/${IMG}.t.png`, PREVIEW, 'image/png');
  other.addNote(pid, 'two screenshots, one never uploaded', { fields: { images: [{ id: IMG, w: 3000, h: 1600 }, { id: MISSING, w: 3000, h: 1600 }] } });
  let engine = null;
  onEngine = (e) => { engine = e; return e; };
  const app = createApp({ pictures: true });
  t.after(() => app.close());
  app.page.load();
  assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
  if (typeof engine?.completePictures !== 'function') return t.skip('the engine has no completePictures yet');
  assert.ok(await until(async () => (await app.state()).choice?.kind === 'first-merge'), 'asked how to combine');
  assert.deepEqual(await app.invoke('sync:choose', { choice: 'combine' }), { ok: true });
  const shown = () => JSON.parse(fs.readFileSync(app.DATA, 'utf8')).projects.some((p) => p.notes.some((n) => n.images?.some((i) => i.id === MISSING)));
  assert.ok(await until(shown, 20000), 'the note reached this computer');
  assert.ok(await until(async () => { const s = await app.state(); return s.sync?.phase === 'synced' && !s.choice && s.sync.pending === 0; }), 'combined');
  assert.ok(await until(() => app.images.has(IMG, true)), 'the preview of the one the account holds is here');
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true }, 'nothing is said to stay in the account');
  assert.ok(app.images.has(IMG), 'the full size the account held is here');
  assert.equal(app.images.has(MISSING) || app.images.has(MISSING, true), false);
});

test('a picture download that reports after the sign-out leaves nothing behind: the next sign-in shows no sign-out progress', async (t) => {
  world();
  let late = null;
  onEngine = replacing({
    async completePictures({ onProgress }) {
      onProgress({ done: 0, total: 2 });
      late = onProgress; // a download still on its way, which answers after the sign-out
      return { total: 2, fetched: 1, left: 0, failed: 1 };
    },
  });
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true, picturesLeft: 1 });
  assert.ok(signingOut(app).length >= 1, 'the page saw the progress while signing out');
  const told = app.sent.length;
  late({ done: 2, total: 2 });
  assert.equal(app.sent.length, told, 'nothing is sent for it');
  assert.deepEqual(await app.invoke('account:sign-in', { email: EMAIL, password: PASSWORD }), { ok: true });
  const s = await app.state();
  assert.equal(s.state, 'signed-in');
  assert.equal(s.signingOut, undefined, 'no stale "Saving full-size pictures…" after signing in again');
});

test('the account deleted on another computer meanwhile: the sign-out promises no pictures in it', async (t) => {
  world();
  let elsewhere = false;
  onEngine = overriding((engine) => ({
    async completePictures({ onProgress }) {
      onProgress({ done: 0, total: 2 });
      elsewhere = true; // the next head read says deleting
      return { total: 2, fetched: 0, left: 2, failed: 0 };
    },
    status: () => (elsewhere ? { ...engine.status(), phase: 'deleting-elsewhere' } : engine.status()),
  }));
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: true });
  assert.equal((await app.state()).state, 'signed-out');
});

test('a sign-out answered PENDING saves no pictures and waits for none; "Sign out anyway" saves them', async (t) => {
  world();
  let asked = 0;
  let waiting = false;
  onEngine = overriding((engine) => ({
    async completePictures() {
      asked++;
      return { total: 1, fetched: 1, left: 0, failed: 0 };
    },
    hasUnpushed: () => waiting || engine.hasUnpushed(),
    finalPush: async () => {}, // offline: nothing goes up
    status: () => (waiting ? { ...engine.status(), pending: 2 } : engine.status()),
  }));
  const app = createApp();
  t.after(() => app.close());
  app.page.load();
  await signInAndUpload(app);
  waiting = true; // two changes the push couldn't take
  assert.deepEqual(await app.invoke('account:sign-out', { force: false, removeBoard: false }), { ok: false, code: 'PENDING', pending: 2 });
  assert.equal(asked, 0, 'no picture is fetched before the person chose');
  assert.deepEqual(signingOut(app), []);
  assert.deepEqual(await app.invoke('account:sign-out', { force: true, removeBoard: false }), { ok: true });
  assert.equal(asked, 1);
  waiting = false;
});
