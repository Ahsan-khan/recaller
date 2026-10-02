'use strict';
// Accounts and sync end to end (ai_memory/15_accounts_and_sync.md, 7.5). Computer A is the real app, run in
// this process against a temp data folder; computer B is the headless peer (tests/support/peer.js), also in
// this process. Both talk to the in-process GCP mock (tests/mock-gcp) on 127.0.0.1 with fast timers
// (RECALLER_SYNC_FAST=1). Nothing reaches Google, and the keychain (or DPAPI) is never touched: the sign-in goes
// to a readable test file (RECALLER_TOKEN_STORE=test-file), and safeStorage is a tripwire.
// Checks are numbered as in 7.5. A few run out of that order: 9–11 while signed out before the sign-up (the
// lock-out then runs out on its own), 40 inside 39's deletion, and 41 (quit) last.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { app, BrowserWindow, ipcMain, net, safeStorage, screen, shell } = require('electron');
const { IS_MAC, MOD, macRect, quiet, macState } = require('./mac-harness'); // Mac-safe run; inert on Windows
const { createGcpMock } = require('../mock-gcp');

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const A_DIR = path.join(SCRATCH, 'sync-a');
const B_DIR = path.join(SCRATCH, 'sync-b');
const SHOTS = path.join(SCRATCH, 'sync-shots');
const APP_MAIN = process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js');
if (!fs.existsSync(APP_MAIN)) { console.error(`HARNESS FAIL: no app at ${APP_MAIN}${IS_MAC ? '' : ' (APP_MAIN must be a Windows path)'}`); process.exit(1); }
// Computer B runs the same engine as the app: from APP_MAIN's tree when it has its own (a copy), else this repo's.
const PEER = [path.join(path.dirname(APP_MAIN), '..', 'tests', 'support', 'peer.js'), path.join(__dirname, '..', 'support', 'peer.js')].find((f) => fs.existsSync(f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const dir of [A_DIR, B_DIR, SHOTS]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const ACC1 = { email: 'owner@example.com', password: 'correct-horse-1' };
const ACC2 = { email: 'second@example.com', password: 'second-pass-22' };
const HERE = IS_MAC ? 'this Mac' : 'this PC';
const HERE_CAP = IS_MAC ? 'This Mac' : 'This PC';
const B_PLATFORM = IS_MAC ? 'win32' : 'darwin'; // B is the owner's other computer
const B_NAME = IS_MAC ? 'your Windows PC' : 'your Mac';
const NOT_VERIFIED = 'Not verified yet. The email can take a minute; check your spam folder too.';

// ---- seed pictures: real PNGs, one of them about 1 MB (above 256 KiB, so it goes up resumable)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, pixel) {
  const row = 1 + w * 3;
  const raw = Buffer.alloc(h * row);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw.set([r, g, b], y * row + 1 + x * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const RANDOM = crypto.randomBytes(600 * 600 * 3); // noise doesn't compress: the picture stays about 1 MB
let randomAt = 0;
const noise = () => RANDOM[randomAt++ % RANDOM.length];
const IMG1 = crypto.randomBytes(16).toString('hex'); // 1 MB: resumable
const IMG2 = crypto.randomBytes(16).toString('hex'); // small: multipart
fs.mkdirSync(path.join(A_DIR, 'images'));
const PICS = {
  [`${IMG1}.png`]: png(600, 600, () => [noise(), noise(), noise()]),
  [`${IMG1}.t.png`]: png(64, 64, (x, y) => [x * 4, y * 4, 160]),
  [`${IMG2}.png`]: png(160, 100, (x, y) => [40, x + 60, y + 120]),
  [`${IMG2}.t.png`]: png(80, 50, (x, y) => [40, 2 * x + 60, 2 * y + 120]),
};
for (const [name, bytes] of Object.entries(PICS)) fs.writeFileSync(path.join(A_DIR, 'images', name), bytes);

// ---- computer A's board: every stage, copy counts, per-computer view state, unknown fields at every level,
// a pristine Welcome (the Combine check needs one), and the two pictures
const T0 = Date.now();
const note = (id, text, ago, extra = {}) => ({ id, text, images: [], createdAt: T0 - ago, updatedAt: T0 - ago, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const project = (id, name, color, extra = {}) => ({ id, name, color, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: T0 - 9e6, notes: [], used: [], combined: [], ...extra });
const TW = T0 - 2 * 86400e3;
const TIPS = ['Click a note to copy it, then paste anywhere.', 'Swipe a note to the left to delete it.', 'Press and hold a note, then drag it down into “Cooked”.',
  'Click Dictate next to New prompt to speak a prompt.', 'Tap the camera in the editor to snip part of your screen into a note.', 'Hold the modifier and click several notes to copy them all at once.',
  'New prompts start in “Cooking”.', 'Hover a note and click the highlighter to colour-mark it.', 'Drag the right edge of a column to make it wider or narrower.', 'Shortcuts: search, new prompt, dictate, screenshot, undo.'];
const SEED = {
  version: 2,
  futureTopLevel: { keep: true, list: [1, 2] },
  prefs: { density: 'slim', colWidths: { pA: 300 }, lastProjectId: 'pA', futurePref: 'stays on this computer' },
  projects: [
    project('pA', 'Wildfire RL', 'sun', {
      futureProjectField: 'x',
      notes: [
        note('nA1', 'Review the fire spread model: wind should bias ignition probability, not just direction.', 8e6, { images: [{ id: IMG1, w: 600, h: 600, futureImageField: 7 }], futureNoteField: { nested: true } }),
        note('nA2', 'Benchmark heuristic_ai vs PPO over 50 seeded maps; report mean burned area.', 7e6, { copied: 3, lastCopiedAt: T0 - 5e6 }),
        note('nA3', 'Summarize the websocket protocol between the backend and the frontend in 10 bullets.', 6e6),
        note('nA4', 'Refactor agents.py so each agent exposes act(obs) with typed dataclasses.', 5e6, { expanded: true }),
      ],
      used: [note('uA1', 'Write the stage two project memory doc from implementation_plan.md', 4e6, { usedAt: T0 - 3e6, copied: 1, lastCopiedAt: T0 - 3e6 })],
      combined: [note('cA1', 'Served earlier: the plan for the next sprint.', 4e6, { usedAt: T0 - 3e6 })],
    }),
    project('pB', 'Website', 'eucalyptus', {
      notes: [
        note('nB1', 'Make the hero section responsive down to 360px.', 3e6),
        note('nB2', 'Write alt text for every image in the gallery.', 2.9e6),
        note('nB3', 'Draft a friendly 404 page with a search box.', 2.8e6),
        note('nB4', 'Add a dark mode toggle to the header.', 2.7e6),
        note('nB5', 'Compress the gallery images to WebP.', 2.6e6),
        note('nB6', 'Fix the nav overlap on mobile.', 2.5e6),
      ],
    }),
    project('pC', 'Research', 'fern', {
      usedCollapsed: true,
      draft: 'half-written research thought',
      notes: [
        note('nC1', 'Read the 2024 survey on wildfire spread models.', 2e6),
        note('nC2', 'Chart: burned area per seed', 1.9e6, { images: [{ id: IMG2, w: 160, h: 100 }] }),
        note('nC3', 'Collect three baselines for the comparison table.', 1.8e6),
      ],
    }),
    project('pD', 'Admin', 'clay', { notes: [note('nD1', 'Renew the cloud budget alert.', 1.5e6), note('nD2', 'Archive last month’s invoices.', 1.4e6)] }),
    project('pF', 'Ideas', 'orchid', { notes: [note('nF1', 'A timeline view of prompts.', 1.2e6), note('nF2', 'Keyboard-only mode.', 1.1e6)] }),
    project('pG', 'Errands', 'moss', { notes: [note('nG1', 'Buy printer paper.', 1e6)] }),
    { ...project('pW', 'Welcome', 'monstera'), createdAt: TW, notes: TIPS.map((t, i) => ({ id: `w${i}`, text: t, images: [], createdAt: TW, updatedAt: TW, copied: 0, lastCopiedAt: 0, usedAt: 0 })) },
  ],
};
const A_DATA = path.join(A_DIR, 'recaller-data.json');
const A_SETTINGS = path.join(A_DIR, 'recaller-settings.json');
fs.writeFileSync(A_DATA, JSON.stringify(SEED, null, 2));
const SEED_BYTES = fs.readFileSync(A_DATA);
// No global hotkeys (no OS prompt), no API key (nothing for safeStorage), and this version already, so no upgrade backup.
fs.writeFileSync(A_SETTINGS, JSON.stringify({ hotkey: '', shotHotkey: '', theme: 'deep', lastVersion: app.getVersion() }, null, 2));

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ---- tripwires and taps, all before the app starts

// safeStorage would reach the keychain (Mac) or DPAPI (Windows): every call is recorded, sealing and unsealing
// fail, and the rest answer "not available".
const trips = [];
const tripwires = new Set();
for (const name of Object.keys(safeStorage)) {
  if (typeof safeStorage[name] !== 'function') continue;
  const wire = () => {
    trips.push(name);
    if (/crypt/i.test(name)) throw new Error(`safeStorage.${name} tripwire`);
    return /^is/.test(name) ? false : undefined;
  };
  safeStorage[name] = wire;
  tripwires.add(wire);
}
// Never start the app unless sealing and unsealing really are tripwires (a newer Electron could hide them).
if (!['encryptString', 'decryptString', 'isEncryptionAvailable'].every((n) => tripwires.has(require('electron').safeStorage[n]))) {
  console.error('HARNESS FAIL: safeStorage could not be replaced with tripwires; the app was not started');
  process.exit(1);
}
const sealingTrips = () => trips.filter((t) => /crypt/i.test(t));
const opened = [];
const openSpy = async (url) => { opened.push(String(url)); };
shell.openExternal = openSpy; // both platforms; set again after quiet(), whose Mac stub doesn't count

// net.fetch is the app's only way out: every request to the mock is recorded (the facade picks it up at init).
const aRequests = [];
const outside = []; // http(s) beyond the loopback mock: refused here, and check 42 fails (the real cloud is never reached)
const realFetch = net.fetch.bind(net);
net.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    if (/^(https?|wss?):/i.test(url)) {
      outside.push(url.split('?')[0].slice(0, 100));
      throw new TypeError('the sync suite lets the app reach only the loopback mock');
    }
    return realFetch(input, init); // file:// (pictures served from the data folder)
  }
  const rec = { url, method: String(init.method || 'GET').toUpperCase(), at: Date.now(), status: null, bodyError: false, opts: { credentials: init.credentials, cache: init.cache, redirect: init.redirect, signal: Boolean(init.signal) } };
  aRequests.push(rec);
  let res;
  try {
    res = await realFetch(input, init);
  } catch (err) {
    rec.status = 'error';
    throw err;
  }
  rec.status = res.status;
  const read = res.arrayBuffer.bind(res);
  res.arrayBuffer = async () => {
    try { return await read(); } catch (err) { rec.bodyError = true; throw err; }
  };
  return res;
};
// "Offline" for A only: the engine and the facade ask net.isOnline(); B (the peer) has its own switch.
const realIsOnline = net.isOnline.bind(net);
let aOffline = false;
net.isOnline = () => (aOffline ? false : realIsOnline());

// Every account:* and sync:* answer the page gets, and everything main sends it, is scanned for secrets.
const SECRET_KEYS = /"(idToken|refreshToken|accessToken|access_token|refresh_token|id_token|token|password|apiKey|testPlain|enc)"\s*:/i;
// ID tokens (JWT-shaped), the mock's refresh tokens and API key, and the suite's two passwords, under any key
const SECRET_VALUES = new RegExp(`eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}|AMf-mock|mock-key|${[ACC1, ACC2].map((a) => a.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}`);
const leaks = [];
let scanned = 0;
function scanForSecrets(where, value) {
  scanned++;
  let text = '';
  try { text = JSON.stringify(value) ?? ''; } catch { text = ''; }
  const m = SECRET_KEYS.exec(text) || SECRET_VALUES.exec(text);
  if (m) leaks.push(`${where}: ${m[0].slice(0, 40)}`);
}
const handlers = new Map();
let copyGate = null; // check 22 holds the clipboard write here
const loads = [];    // every data:load, with how many saves had reached main by then (31 and 32)
let saveCount = 0;
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => {
  const wrapped = async (event, ...args) => {
    if (channel === 'clipboard:write' && copyGate) await copyGate.promise;
    if (channel === 'data:load') loads.push({ at: Date.now(), saves: saveCount });
    const result = await fn(event, ...args);
    if (/^(account|sync):/.test(channel)) scanForSecrets(channel, result);
    return result;
  };
  handlers.set(channel, wrapped);
  return realHandle(channel, wrapped);
};
let lastSaveMeta = null;
let lastSaveAt = 0;
const acked = new Set();  // patches the page acknowledged with a save
const nacked = new Set(); // and the ones it sent back
ipcMain.on('data:save', (_e, _data, meta) => {
  saveCount++;
  lastSaveMeta = meta;
  lastSaveAt = Date.now();
  if (typeof meta?.ack === 'string') acked.add(meta.ack);
});
ipcMain.on('sync:nack', (_e, info) => { if (typeof info?.patchId === 'string') nacked.add(info.patchId); });

// ---- the mock, and the second account (it has a board of its own)
const mock = createGcpMock();
const user2 = mock.createUser({ email: ACC2.email, password: ACC2.password, verified: true });
const remote2 = mock.remote(user2.uid);
remote2.createHead({ joiner: 'blank' });
remote2.addProject('Second account plans', { id: 'q1', color: 'moss' });
remote2.addProject('Second account reading', { id: 'q2', color: 'clay' });
remote2.addNote('q1', 'Plan the second account launch', { id: 'm1' });
remote2.addNote('q1', 'Draft the welcome email', { id: 'm2' });
remote2.addNote('q2', 'Read the sync design doc', { id: 'm3' });

let placed = 0;
function offscreenRect(W = 1360, H = 860) {
  if (IS_MAC) return macRect(W, H);
  const c = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const other = displays.find((d) => !(c.x >= d.bounds.x && c.x < d.bounds.x + d.bounds.width && c.y >= d.bounds.y && c.y < d.bounds.y + d.bounds.height));
  const wa = (other || screen.getDisplayNearestPoint(c)).workArea;
  let x = wa.x;
  if (!other) x = c.x - wa.x > wa.width / 2 ? wa.x - W + 200 : wa.x + wa.width - 200;
  return { x, y: wa.y, width: W, height: H };
}

// Toasts are recorded from the page (they survive reloads this way), and so are console errors.
const toasts = [];
const errors = [];
const TOAST_SPY = `(() => {
  if (window.__toastSpy) return;
  window.__toastSpy = true;
  const host = document.getElementById('toasts');
  if (!host) return;
  const seen = new WeakSet();
  const grab = (t) => { if (seen.has(t)) return; seen.add(t); console.debug('[toast] ' + JSON.stringify((t.querySelector('span')?.textContent || t.textContent || '').trim())); };
  for (const t of host.querySelectorAll('.toast')) grab(t);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) grab(n); }).observe(host, { childList: true });
})()`;

mock.listen().then(() => {
  process.env.RECALLER_DATA_DIR = A_DIR;
  Object.assign(process.env, mock.env()); // RECALLER_GCP_BASE (loopback), project, bucket, key
  process.env.RECALLER_TOKEN_STORE = 'test-file';
  process.env.RECALLER_SYNC_FAST = '1';
  delete process.env.RECALLER_GCP_REAL;
  delete process.env.RECALLER_SYNC_OFFLINE;
  app.on('browser-window-created', (_e, w) => {
    const showInactive = w.showInactive.bind(w);
    w.show = () => { w.setBounds(offscreenRect()); showInactive(); w.setBounds(offscreenRect()); }; // never on the user's screen, never focused
    if (placed++ === 0) w.setBounds(offscreenRect());
    const wc = w.webContents;
    const realSend = wc.send.bind(wc);
    wc.send = (channel, ...args) => {
      if (channel === 'account:changed' || channel === 'sync:patch') scanForSecrets(channel, args[0]);
      if (channel === 'sync:patch') {
        const p = args[0] || {};
        patches.push({ at: Date.now(), id: p.id, content: p.changesContent, remove: p.projects?.remove, order: p.projects?.order, upsert: Object.keys(p.projects?.upsert || {}), notices: (p.notices || []).map((n) => n.code) });
      }
      return realSend(channel, ...args);
    };
    wc.on('dom-ready', () => wc.executeJavaScript(TOAST_SPY).catch(() => {}));
    wc.on('console-message', (e) => {
      const level = e.level ?? e.params?.level;
      const message = String(e.message ?? e.params?.message ?? '');
      if (message.startsWith('[toast] ')) {
        try { toasts.push({ text: JSON.parse(message.slice(8)), at: Date.now() }); } catch {}
      } else if (message.startsWith('[confirm] ')) {
        try { confirms.push(JSON.parse(message.slice(10))); } catch {}
      } else if (level === 'error' || level === 3) {
        errors.push(message);
      }
    });
  });
  quiet();
  shell.openExternal = openSpy; // quiet() replaced it on a Mac with a stub that doesn't count (check 43)
  require(APP_MAIN);
  app.whenReady().then(run).catch((err) => { console.error('HARNESS FAIL', err); app.exit(1); });
}).catch((err) => { console.error('HARNESS FAIL: the GCP mock could not listen', err); process.exit(1); });

// A hung run must not leave Electron (and its sliver) behind.
setTimeout(() => { console.error('HARNESS FAIL: the suite took longer than 20 minutes'); app.exit(1); }, 20 * 60 * 1000).unref();

const confirms = [];
const patches = []; // a summary of every sync:patch main sent the page (for the log when a check fails)
const results = [];
function check(n, name, ok, detail = '') {
  results.push({ n, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${name}${detail ? '  — ' + detail : ''}`);
}

// Deep equality that ignores key order.
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
}

async function waitFor(fn, { timeout = 10000, every = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const LISTS = ['notes', 'used', 'combined'];
const noteIn = (data, id) => {
  for (const p of data?.projects || []) for (const l of LISTS) for (const n of p[l] || []) if (n.id === id) return { ...n, project: p.id, list: l };
  return null;
};
const allIds = (data) => (data?.projects || []).flatMap((p) => LISTS.flatMap((l) => (p[l] || []).map((n) => n.id)));
const short = (v, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };

async function run() {
  await sleep(400);
  const win = BrowserWindow.getAllWindows()[0];
  const wc = win.webContents;
  win.setBounds(offscreenRect()); // the app re-applies its saved position on creation; move it out of the way now
  wc.setBackgroundThrottling(false);
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await sleep(900);
  await wc.executeJavaScript(TOAST_SPY).catch(() => {});
  fs.mkdirSync(SHOTS, { recursive: true });
  const cloud = require(path.join(path.dirname(APP_MAIN), 'cloud')); // the facade main.js loaded (same module)
  console.log(`INFO  app ${APP_MAIN}; peer ${PEER}; B is ${B_PLATFORM}; mock ${mock.base}`);

  const js = (code) => wc.executeJavaScript(code);
  const rect = (sel, i = 0) => js(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 }; })()`);
  const mouse = (type, x, y, extra = {}) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const move = (x, y) => mouse('mouseMove', x, y, { modifiers: ['leftButtonDown'] });
  async function drag(x0, y0, x1, y1, steps = 14, delay = 16) {
    for (let i = 1; i <= steps; i++) { move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(delay); }
  }
  const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  // Enter as a person presses it: keyDown, the character (Chromium's implicit form submission), keyUp.
  const enter = () => { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); };
  const type = async (text) => { for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(5); } };
  // A screenshot of the window, or of the box around every element sel matches (padded, kept inside the window).
  const shots = [];
  const shot = async (name, sel = null, pad = 10) => {
    let last = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const area = sel ? await js(`(() => {
          const rs = [...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
          if (!rs.length) return null;
          const x = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.left)) - ${pad}));
          const y = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.top)) - ${pad}));
          const right = Math.min(innerWidth, Math.ceil(Math.max(...rs.map((r) => r.right)) + ${pad}));
          const bottom = Math.min(innerHeight, Math.ceil(Math.max(...rs.map((r) => r.bottom)) + ${pad}));
          return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
        })()`) : null;
        const img = await (area ? wc.capturePage(area) : wc.capturePage());
        if (img.isEmpty()) throw new Error('empty capture');
        fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.toPNG());
        shots.push(name);
        return;
      } catch (err) {
        last = err;
        await sleep(350);
      }
    }
    console.log(`INFO  screenshot ${name} failed: ${last?.message}`);
  };

  // ---- A's window: focus is simulated for the engine (it reads isFocused()); the window never takes it
  const realIsFocused = BrowserWindow.prototype.isFocused;
  const focusA = () => { win.isFocused = () => true; win.emit('focus'); };
  const blurA = () => { win.isFocused = () => false; win.emit('blur'); };
  const refocusA = async () => { blurA(); await sleep(30); focusA(); };
  // Whether any window really had focus (BrowserWindow.getFocusedWindow() would ask the stub above), all run long.
  const focusSeen = { samples: 0, focused: 0 };
  setInterval(() => {
    focusSeen.samples++;
    if (BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && realIsFocused.call(w))) focusSeen.focused++;
  }, 250).unref();

  // ---- the page
  const openSettings = async () => {
    if (await js(`document.querySelector('#settings').open`)) return;
    await js(`document.querySelector('#open-settings').click()`);
    await waitFor(() => js(`document.querySelector('#settings').open`), { timeout: 3000, every: 50 });
    await sleep(200);
  };
  const closeSettings = async () => { await js(`(() => { const d = document.querySelector('#settings'); if (d.open) d.close(); })()`); await sleep(200); };
  const accUi = () => js(`(() => {
    const box = document.querySelector('#account');
    const txt = (sel) => { const n = box.querySelector(sel); return n && !n.hidden ? n.textContent.trim() : ''; };
    const ind = document.querySelector('#sync-status');
    return {
      hidden: box.hidden, state: box.dataset.state, phase: box.dataset.phase, view: box.dataset.view, busy: box.getAttribute('aria-busy') === 'true',
      title: [...box.querySelectorAll('.account-title')].map((n) => n.textContent.trim()).join(' | '),
      status: txt('#account-status'), error: txt('[data-slot="error"]'), note: txt('[data-slot="note"]'), side: txt('[data-slot="side"]'),
      other: txt('[data-slot="other"]'), text: box.textContent.replace(/\\s+/g, ' ').trim(),
      actions: [...box.querySelectorAll('[data-action]')].filter((b) => !b.hidden).map((b) => b.dataset.action),
      ind: { hidden: ind.hidden, phase: ind.dataset.phase, title: ind.getAttribute('title') || '', dot: !!ind.querySelector('.sync-dot'), muted: ind.classList.contains('is-muted') },
      settingsOpen: document.querySelector('#settings').open,
    };
  })()`);
  const act = (name) => js(`(() => { const b = [...document.querySelectorAll('#account [data-action="${name}"]')].find((x) => !x.hidden && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const actOrThrow = async (name) => { if (!(await act(name))) throw new Error(`no enabled [data-action="${name}"] in #account (view ${(await accUi()).view})`); };
  async function fill(name, value) {
    const ok = await js(`(() => { const i = document.querySelector('#account input[name="${name}"]'); if (!i) return false; i.focus(); i.select(); return true; })()`);
    if (!ok) throw new Error(`no input ${name} in #account`);
    if (value) await type(value);
    else key('Backspace');
    await sleep(60);
  }
  const view = async (want, timeout = 8000) => waitFor(async () => { const u = await accUi(); return u.view === want && !u.busy ? u : null; }, { timeout });
  const opCount = (op) => mock.log.filter((e) => e.op === op).length;
  // Clicks an account button and waits for the Identity Toolkit call it makes to be answered and painted.
  async function submitAndWait(action, op, timeout = 8000) {
    const n0 = opCount(op);
    await actOrThrow(action);
    await waitFor(() => opCount(op) > n0 && mock.log.filter((e) => e.op === op).every((e) => e.status !== null), { timeout });
    return waitFor(async () => { const u = await accUi(); return u.busy ? null : u; }, { timeout: 4000, every: 50 });
  }
  const toastsSince = (t) => toasts.filter((x) => x.at >= t);
  const waitToast = (t, test, timeout = 15000) => waitFor(() => toastsSince(t).find((x) => (typeof test === 'string' ? x.text === test : test.test(x.text))), { timeout });
  const cardText = (id) => js(`document.querySelector('.card-wrap[data-id="${id}"] .card-text')?.textContent ?? null`);
  const colIds = () => js(`[...document.querySelectorAll('.column')].map((c) => c.dataset.id)`);
  const augText = (pid) => js(`document.querySelector('.column[data-id="${pid}"] .aug-text')?.textContent ?? ''`);
  const focusCard = (id) => js(`(() => { const c = document.querySelector('.card-wrap[data-id="${id}"] .card'); if (!c) return false; c.scrollIntoView({ block: 'center', inline: 'nearest' }); c.focus({ preventScroll: true }); return document.activeElement === c; })()`);
  const setComposer = (text, sel) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  async function openEditor(id) {
    await js(`(() => { const t = document.querySelector('.card-wrap[data-id="${id}"] .card-text'); if (!t) return; t.scrollIntoView({ block: 'center', inline: 'nearest' }); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); })()`);
    return waitFor(() => js(`!!document.querySelector('.card-wrap[data-id="${id}"].is-editing .composer textarea')`), { timeout: 3000, every: 50 });
  }
  async function editCard(id, text) {
    if (!(await openEditor(id))) throw new Error(`no editor opened for ${id}`);
    await setComposer(text, `.card-wrap[data-id="${id}"] .composer textarea`);
    const at = Date.now();
    key('Enter', [MOD]);
    await waitFor(() => js(`!document.querySelector('.card-wrap[data-id="${id}"].is-editing')`), { timeout: 3000, every: 50 });
    await sleep(100);
    return at;
  }
  async function addPrompt(pid, text) {
    const ok = await js(`(() => { const c = document.querySelector('.column[data-id="${pid}"]'); if (!c) return false; c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); c.querySelector('.col-add').click(); return true; })()`);
    if (!ok) throw new Error(`no column ${pid}`);
    const sel = `.column[data-id="${pid}"] .col-compose .composer textarea`;
    if (!(await waitFor(() => js(`!!document.querySelector(${JSON.stringify(sel)})`), { timeout: 3000, every: 50 }))) throw new Error(`no composer in ${pid}`);
    await setComposer(text, sel);
    key('Enter', [MOD]);
    await waitFor(() => js(`!document.querySelector('.column[data-id="${pid}"] .col-compose .composer')`), { timeout: 3000, every: 50 });
    return waitFor(() => js(`[...document.querySelectorAll('.column[data-id="${pid}"] .card-wrap')].find((w) => w.querySelector('.card-text')?.textContent === ${JSON.stringify(text)})?.dataset.id ?? null`), { timeout: 3000, every: 50 });
  }
  async function deleteCard(id) {
    if (!(await focusCard(id))) throw new Error(`no card ${id} to delete`);
    key('Delete');
    return waitFor(async () => !(await js(`!!document.querySelector('.card-wrap[data-id="${id}"]')`)), { timeout: 3000, every: 50 });
  }
  async function accountShot(name) {
    await openSettings();
    await js(`document.querySelector('#account-head').scrollIntoView({ block: 'start' })`);
    await sleep(300);
    await shot(name, '#account-head, #account', 14);
  }
  async function setTheme(theme) {
    await openSettings();
    await js(`document.querySelector('#set-theme [data-value="${theme}"]').click()`);
    await waitFor(() => js(`document.body.classList.contains('theme-${theme}')`), { timeout: 3000, every: 50 });
    await sleep(250);
  }

  // ---- main and the cloud
  const mainState = () => handlers.get('account:get')({ sender: wc });
  const aSync = (name) => readJson(path.join(A_DIR, 'sync', name));
  const aData = () => readJson(A_DATA);
  const aNote = (id) => noteIn(aData(), id);
  const uidOf = (email) => mock.user(email)?.uid ?? null;
  let UID1 = null;
  let A_DEV = null;
  const docs = (uid) => mock.docs(uid);
  const headOf = (uid) => docs(uid).head;
  const headRev = (uid) => headOf(uid)?.rev ?? 0;
  const cloudNote = (uid, id) => { const d = docs(uid); return d.notes[id] || Object.values(d.notes).find((x) => x._sync?.id === id) || null; };
  const liveNoteIds = (uid) => Object.entries(docs(uid).notes).filter(([, d]) => d._sync && !d._sync.deleted).map(([k, d]) => d._sync.id || k);
  const liveProjectIds = (uid) => Object.entries(docs(uid).projects).filter(([, d]) => d._sync && !d._sync.deleted)
    .sort((a, b) => (a[1]._sync.key < b[1]._sync.key ? -1 : a[1]._sync.key > b[1]._sync.key ? 1 : 0)).map(([k, d]) => d._sync.id || k);
  const tombstones = (uid) => { const d = docs(uid); return [...Object.values(d.notes), ...Object.values(d.projects)].filter((x) => x._sync?.deleted).length; };
  const boardCommits = (from, uid) => mock.log.slice(from).filter((e) => e.op === 'commit' && e.uid === uid && e.rev !== undefined);

  let B = null;
  const bNote = (id) => (B ? noteIn(B.board(), id) : null);
  const bProject = (pid) => (B ? (B.board().projects || []).find((p) => p.id === pid) : null);
  // A is settled when the account's head is where A's state says, nothing waits to go up, the last patch main sent
  // this page was acknowledged or sent back (a merge that moves no head looks synced before that), and the save
  // that acknowledged it is on disk (main writes 250 ms after the last save).
  const patchInFlight = () => {
    const p = patches[patches.length - 1];
    const loadedAt = loads[loads.length - 1]?.at || 0;
    return Boolean(p) && p.at > loadedAt && !acked.has(p.id) && !nacked.has(p.id);
  };
  const savePending = () => { try { return fs.statSync(A_DATA).mtimeMs < lastSaveAt; } catch { return true; } };
  async function aSettled(uid) {
    const head = headOf(uid);
    const s = await mainState();
    const st = aSync('state.json');
    return head && s.state === 'signed-in' && s.sync?.phase === 'synced' && st?.rev === head.rev && !cloud.hasUnpushed() && !patchInFlight() && !savePending() ? s : null;
  }
  async function aSynced(uid, timeout = 20000) {
    return waitFor(() => aSettled(uid), { timeout, every: 150 });
  }
  async function bothSynced(uid = UID1, timeout = 25000) {
    const ok = await waitFor(async () => {
      const head = headOf(uid);
      const aOk = await aSettled(uid);
      const bOk = !B || (B.quiet() && !B.busy() && B.readState()?.rev === head?.rev);
      return aOk && bOk;
    }, { timeout, every: 150 });
    if (!ok) {
      const s = await mainState().catch(() => null);
      console.log(`INFO  not settled: A ${short(s?.sync)} rev ${aSync('state.json')?.rev} patch ${patchInFlight() ? 'in flight' : 'none'} save ${savePending() ? 'waiting' : 'written'} | B ${B ? B.why() : '-'} rev ${B?.readState()?.rev} | head ${headRev(uid)}`);
    }
    return Boolean(ok);
  }
  async function goOffline() {
    aOffline = true;
    return waitFor(async () => (await mainState()).sync?.phase === 'offline', { timeout: 6000 });
  }
  async function goOnline() {
    aOffline = false;
    await refocusA(); // focus pulls at once (and ends a backoff)
  }
  const backupsOf = (kind) => { try { return fs.readdirSync(path.join(A_DIR, 'backups')).filter((n) => n.endsWith(`_${kind}`)).sort(); } catch { return []; } };

  async function spec(n, name, fn) {
    try {
      const r = await fn();
      check(n, name, r?.ok, r?.detail ?? '');
    } catch (err) {
      check(n, name, false, `threw ${String(err?.stack || err).split('\n').slice(0, 3).join(' | ')}`);
    }
  }

  // ================================================================ 1–3: signed out, cloud enabled
  await spec(1, 'Signed out with the cloud enabled: no request during start and 20 edits, no sync/ folder, data file byte-identical before the first edit, #sync-status hidden, [Create account] [Sign in]', async () => {
    const untouched = fs.readFileSync(A_DATA).equals(SEED_BYTES);
    const u = await accUi();
    const saves0 = saveCount;
    const p1 = await addPrompt('pD', 'Signed-out edit one');
    const p2 = await addPrompt('pD', 'Signed-out edit two');
    for (let i = 0; i < 18; i++) { await focusCard('nB1'); key('H'); await sleep(70); }
    await sleep(900);
    const edits = saveCount - saves0;
    const disk = aData();
    const editsSaved = Boolean(p1 && p2 && noteIn(disk, p1) && noteIn(disk, p2)) && !noteIn(disk, 'nB1')?.highlight;
    const noRequests = mock.log.length === 0 && aRequests.length === 0;
    const noSync = !fs.existsSync(path.join(A_DIR, 'sync'));
    const ok = untouched && noRequests && noSync && !u.hidden && u.view === 'out' && same(u.actions, ['create', 'sign-in']) && u.ind.hidden && edits >= 20 && editsSaved;
    return { ok, detail: JSON.stringify({ untouched, requests: mock.log.length, aRequests: aRequests.length, noSync, view: u.view, actions: u.actions, indicatorHidden: u.ind.hidden, saves: edits, editsSaved }) };
  });
  await accountShot('01-signed-out-deep');
  await setTheme('soft');
  await accountShot('01b-signed-out-soft');
  await setTheme('deep');

  await spec(2, 'Settings keys: Enter in input[name=email] keeps Settings open; Esc closes only the form (control: Enter in Language closes Settings)', async () => {
    await openSettings();
    await actOrThrow('create');
    await view('create');
    await fill('email', 'not-an-email');
    enter();
    await sleep(350);
    const afterEnter = await accUi();
    key('Escape');
    await sleep(350);
    const afterEsc = await accUi();
    await js(`document.querySelector('#set-language').focus()`);
    enter();
    await sleep(350);
    const controlClosed = !(await js(`document.querySelector('#settings').open`));
    const ok = afterEnter.settingsOpen && afterEnter.view === 'create' && afterEnter.error === "That email address doesn't look right." && afterEsc.settingsOpen && afterEsc.view === 'out' && controlClosed;
    return { ok, detail: JSON.stringify({ enter: [afterEnter.settingsOpen, afterEnter.view, afterEnter.error], esc: [afterEsc.settingsOpen, afterEsc.view], controlClosed }) };
  });

  await spec(3, 'Short password: "Use at least 8 characters.", with no request', async () => {
    await openSettings();
    await actOrThrow('create');
    await view('create');
    await fill('email', 'short@example.com');
    await fill('password', 'short1');
    const n0 = mock.log.length;
    const a0 = aRequests.length;
    await actOrThrow('submit-create');
    await sleep(400);
    const u = await accUi();
    const ok = u.error === 'Use at least 8 characters.' && mock.log.length === n0 && aRequests.length === a0;
    return { ok, detail: JSON.stringify({ error: u.error, requests: mock.log.length - n0 }) };
  });

  // ================================================================ 9–11 (run while signed out, before the sign-up)
  await spec(9, 'Wrong password: "Email or password is wrong."; after 5, the lock-out text', async () => {
    await actOrThrow('cancel');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC2.email);
    const seen = [];
    for (let i = 1; i <= 5; i++) {
      await fill('password', `wrong-password-${i}`);
      const u = await submitAndWait('submit-sign-in', 'signInWithPassword');
      seen.push(u?.error ?? null);
    }
    const ok = seen.slice(0, 4).every((t) => t === 'Email or password is wrong.') && /^Too many wrong passwords\. Try again in \d+ seconds?\.$/.test(seen[4] || '');
    return { ok, detail: JSON.stringify(seen) };
  });

  await spec(10, 'Password reset: RESET_UNAVAILABLE with reCAPTCHA required (no wait after it); neutral text for an unknown email, then [Send link] waits 60 s; PASSWORD_RESET in the outbox for a known one, and main sends one link per email a minute', async () => {
    await actOrThrow('forgot');
    await view('forgot');
    const neutral = (email) => `If there's an account for ${email}, a link is on its way (if it isn't in your inbox, look in Spam). After you change the password, sign in again on each computer.`;
    const sendLink = () => js(`(() => { const b = document.querySelector('#account [data-action="send-reset"]'); return b ? { label: b.textContent.trim(), disabled: b.disabled } : null; })()`);
    // First the send that fails, while [Send link] can still be clicked: a failure starts no wait
    await fill('email', ACC2.email);
    mock.requireRecaptchaForReset(true);
    const n0 = mock.log.length;
    await actOrThrow('send-reset');
    await waitFor(() => mock.log.slice(n0).some((e) => e.op === 'sendOobCode' && e.status !== null), { timeout: 6000 });
    const u3 = await waitFor(async () => { const u = await accUi(); return !u.busy && u.error ? u : null; }, { timeout: 4000 });
    mock.requireRecaptchaForReset(false);
    const recaptchaOk = u3?.error === "Recaller can't send a reset link right now. Wait a while, then try again." && (await sendLink())?.disabled === false;
    // An unknown email: the neutral text, nothing in the outbox, and the button waits out its minute
    await fill('email', 'nobody@example.com');
    const ob0 = mock.outbox.length;
    const u1 = await submitAndWait('send-reset', 'sendOobCode');
    const unknownOk = u1?.note === neutral('nobody@example.com') && mock.outbox.length === ob0;
    const waiting = await sendLink();
    const waitOk = /^Send link \(\d+ s\)$/.test(waiting?.label || '') && waiting.disabled === true;
    // A known email, straight through the bridge (the button waits): PASSWORD_RESET in the outbox; asked again at
    // once, main sends nothing and says how long to wait
    const r2 = await js(`window.recaller.account.resetPassword(${JSON.stringify(ACC2.email)})`);
    const knownOk = r2?.ok === true && mock.outbox.slice(ob0).some((m) => m.requestType === 'PASSWORD_RESET' && m.email === ACC2.email);
    const r3 = await js(`window.recaller.account.resetPassword(${JSON.stringify(ACC2.email)})`);
    const mainWaits = r3?.ok === false && r3.code === 'RESET_UNAVAILABLE' && r3.retryAfterMs > 0 && mock.outbox.slice(ob0).filter((m) => m.email === ACC2.email).length === 1;
    return { ok: unknownOk && knownOk && recaptchaOk && waitOk && mainWaits, detail: JSON.stringify({ unknown: u1?.note, known: knownOk, recaptcha: u3?.error, button: waiting, again: r3 }) };
  });

  await spec(11, 'Sign-ups paused: "New accounts are paused right now. Try again later."', async () => {
    await actOrThrow('cancel'); // forgot → sign in
    await actOrThrow('cancel'); // sign in → signed out
    await actOrThrow('create');
    await view('create');
    mock.setSignupDisabled(true);
    await fill('email', 'paused@example.com');
    await fill('password', 'paused-pass-1');
    const u = await submitAndWait('submit-create', 'signUp');
    mock.setSignupDisabled(false);
    return { ok: u?.error === 'New accounts are paused right now. Try again later.' && !mock.user('paused@example.com'), detail: JSON.stringify({ error: u?.error }) };
  });

  // ================================================================ 4–8: sign-up, verification, first upload
  let signUpAt = 0;
  await spec(4, 'Sign-up (through Electron net.fetch): the mock user exists, VERIFY_EMAIL in the outbox, "Check your email" shows, no Firestore or Storage request while unverified', async () => {
    await actOrThrow('cancel'); // a fresh form, without 11's error
    await actOrThrow('create');
    await view('create');
    await fill('email', ACC1.email);
    await fill('password', ACC1.password);
    await accountShot('02-create-account-deep');
    signUpAt = mock.log.length;
    await actOrThrow('submit-create');
    const u = await view('verify', 10000);
    UID1 = uidOf(ACC1.email);
    A_DEV = aSync('device.json')?.id ?? null;
    const outbox = mock.outbox.some((m) => m.requestType === 'VERIFY_EMAIL' && m.email === ACC1.email);
    const body = Boolean(u && u.title === 'Check your email' && u.text.includes(`We sent a link to ${ACC1.email}. Open it, then come back to Recaller: it notices by itself. Not in your inbox? Look in Spam. Nothing is uploaded until your email is verified.`));
    await accountShot('03-check-your-email-deep');
    await sleep(1500); // the verification poll runs meanwhile
    const store = mock.log.slice(signUpAt).filter((e) => e.service === 'firestore' || e.service === 'storage').length;
    // Every request so far went through Electron's net.fetch with http.js's options; this sign-up's answered 200
    // (11's paused one before it was a 400).
    const viaNet = aRequests.filter((r) => /accounts:signUp/.test(r.url));
    const optsOk = aRequests.every((r) => r.opts.credentials === 'omit' && r.opts.cache === 'no-store' && r.opts.redirect === 'error' && r.opts.signal === true);
    const netOk = viaNet.length >= 1 && viaNet[viaNet.length - 1].status === 200 && optsOk;
    const ok = Boolean(UID1) && outbox && body && store === 0 && netOk && Boolean(A_DEV);
    return { ok, detail: JSON.stringify({ uid: Boolean(UID1), outbox, view: u?.view, title: u?.title, storeRequests: store, netFetch: { requests: aRequests.length, signUps: viaNet.map((r) => r.status), opts: viaNet[0]?.opts, allWithOptions: optsOk }, device: Boolean(A_DEV) }) };
  });

  let choiceAt = 0;
  await spec(5, 'Verification: "I\'ve verified" too early shows the not-verified text; verify() then focus leads to the first-upload choice; no Firestore write before the choice', async () => {
    const lookups0 = opCount('lookup');
    await actOrThrow('verified');
    await waitFor(() => opCount('lookup') > lookups0, { timeout: 5000 });
    const early = await waitFor(async () => { const u = await accUi(); return !u.busy && u.note === NOT_VERIFIED ? u : null; }, { timeout: 5000 });
    const storeBefore = mock.log.slice(signUpAt).filter((e) => e.service === 'firestore' || e.service === 'storage').length;
    mock.verify(ACC1.email);
    focusA();
    const u = await waitFor(async () => { const x = await accUi(); return x.view === 'choice' && x.title === 'Upload this board?' ? x : null; }, { timeout: 15000 });
    choiceAt = mock.log.length;
    const writes = mock.log.slice(signUpAt).filter((e) => e.op === 'commit' || /^upload/.test(e.op || '')).length;
    const local = aData();
    const counts = { projects: local.projects.length, notes: allIds(local).length };
    const body = u?.text.includes(`Your account ${ACC1.email} is empty. Upload ${HERE}'s board (${counts.projects} projects · ${counts.notes} notes · 2 pictures) to it? It then syncs with every computer where you sign in.`);
    await accountShot('04-first-upload-choice-deep');
    const ok = Boolean(early) && storeBefore === 0 && Boolean(u) && body && writes === 0;
    return { ok, detail: JSON.stringify({ early: early?.note, storeBeforeVerify: storeBefore, choice: u?.title, body, writesBeforeChoice: writes }) };
  });

  const beforeUpload = fs.readFileSync(A_DATA);
  const uploadMark = mock.log.length;
  let uploadToastAt = Date.now();
  await spec(6, 'Upload: the mock holds every project and note (data-name lists, keys ascending in screen order, no per-device fields, unknown fields kept, copied, head.rev and stats) and a "Before sync" backup is listed', async () => {
    uploadToastAt = Date.now();
    await actOrThrow('choice-upload');
    const synced = await aSynced(UID1, 30000);
    const d = docs(UID1);
    const local = aData();
    const problems = [];
    const pKeys = local.projects.map((p) => d.projects[p.id]?._sync?.key);
    if (pKeys.some((k) => typeof k !== 'string')) problems.push('a project is missing');
    for (let i = 1; i < pKeys.length; i++) if (!(pKeys[i - 1] < pKeys[i])) problems.push(`project keys not ascending at ${local.projects[i].id}`);
    const PROJECT_LOCAL = ['notesCollapsed', 'usedCollapsed', 'augCollapsed', 'usedExpanded', 'augExpanded', 'draft', 'draftImages', 'notes', 'used', 'combined', 'id'];
    for (const p of local.projects) {
      const doc = d.projects[p.id];
      if (!doc) continue;
      if (doc._sync.deleted) problems.push(`${p.id} is a tombstone`);
      const bad = Object.keys(doc).filter((k) => PROJECT_LOCAL.includes(k) || k.startsWith('local'));
      if (bad.length) problems.push(`${p.id} carries ${bad}`);
      if (doc.name !== p.name || doc.color !== p.color) problems.push(`${p.id} name/colour`);
      for (const l of LISTS) {
        const want = (p[l] || []).map((x) => x.id);
        const got = Object.entries(d.notes).filter(([, x]) => !x._sync.deleted && x._sync.project === p.id && x._sync.list === l)
          .sort((a, b) => (a[1]._sync.key < b[1]._sync.key ? -1 : 1)).map(([k, x]) => x._sync.id || k);
        if (!same(want, got)) problems.push(`${p.id}/${l}: ${short(got, 120)} ≠ ${short(want, 120)}`);
        for (const x of p[l] || []) {
          const doc2 = d.notes[x.id];
          if (!doc2) continue;
          const badN = Object.keys(doc2).filter((k) => k === 'expanded' || k === 'id' || k.startsWith('local'));
          if (badN.length) problems.push(`${x.id} carries ${badN}`);
          if (doc2.text !== x.text || (doc2.copied || 0) !== (x.copied || 0)) problems.push(`${x.id} text/copied`);
        }
      }
    }
    const unknown = d.projects.pA?.futureProjectField === 'x' && same(d.notes.nA1?.futureNoteField, { nested: true }) && d.notes.nA1?.images?.[0]?.futureImageField === 7;
    const copied = d.notes.nA2?.copied === 3 && d.notes.uA1?.copied === 1;
    const live = liveNoteIds(UID1);
    const maxRev = Math.max(...[...Object.values(d.notes), ...Object.values(d.projects)].map((x) => x._sync.rev));
    const headOk = d.head?.rev === aSync('state.json')?.rev && d.head?.rev === maxRev && same(d.head?.stats, { projects: local.projects.length, notes: live.length, images: 2 }) && live.length === allIds(local).length;
    await closeSettings(); // the backups list is painted as Settings opens
    await openSettings();
    const listed = await waitFor(async () => { const l = await js(`[...document.querySelectorAll('#set-backup option')].map((o) => o.textContent)`); return l.some((t) => / · Before sync · /.test(t)) ? l : null; }, { timeout: 4000 });
    const beforeSync = Boolean(listed) && backupsOf('before-sync').length >= 1;
    const toastOk = Boolean(await waitToast(uploadToastAt, 'Your board is in your account now.', 5000));
    const ok = Boolean(synced) && !problems.length && unknown && copied && headOk && beforeSync && toastOk;
    return { ok, detail: JSON.stringify({ synced: Boolean(synced), problems: problems.slice(0, 6), unknown, copied, head: { rev: d.head?.rev, maxRev, stats: d.head?.stats, live: live.length }, beforeSync, toast: toastOk }) };
  });

  await spec(7, 'Pictures: .t.png and .png uploaded with Authorization: Firebase before the commit that references them; the 1 MB picture went up resumable', async () => {
    const log = mock.log.slice(choiceAt);
    const out = {};
    let ok = true;
    for (const [id, noteId] of [[IMG1, 'nA1'], [IMG2, 'nC2']]) {
      const rev = cloudNote(UID1, noteId)?._sync?.rev;
      const commit = log.find((e) => e.op === 'commit' && e.uid === UID1 && e.rev === rev);
      for (const suffix of ['.t.png', '.png']) {
        const name = `users/${UID1}/images/${id}${suffix}`;
        const ups = log.filter((e) => e.name === name && /^upload/.test(e.op || ''));
        const done = ups.find((e) => e.tags?.includes('uploaded'));
        const obj = mock.objects(UID1)[name];
        const before = Boolean(commit && done && ups.every((e) => e.done < commit.seq));
        const firebase = ups.length > 0 && ups.every((e) => e.auth === 'Firebase');
        const bytes = Boolean(obj?.bytes?.equals(PICS[`${id}${suffix}`]));
        out[`${noteId}${suffix}`] = { before, firebase, bytes, protocol: [...new Set(ups.map((e) => e.protocol))].join('+') };
        ok = ok && before && firebase && bytes;
      }
    }
    const resumable = out['nA1.png'].protocol.includes('resumable') && mock.log.slice(choiceAt).some((e) => e.name === `users/${UID1}/images/${IMG1}.png` && e.op === 'upload-start');
    return { ok: ok && resumable && PICS[`${IMG1}.png`].length > 1000000, detail: JSON.stringify({ ...out, resumable, bytes: PICS[`${IMG1}.png`].length }) };
  });

  await spec(8, 'After the upload: recaller-data.json byte-identical; sync/ holds account.json, device.json, state.json and shadow.json; backup folders hold only the two files', async () => {
    const identical = fs.readFileSync(A_DATA).equals(beforeUpload);
    const files = fs.readdirSync(path.join(A_DIR, 'sync')).sort();
    const four = ['account.json', 'device.json', 'shadow.json', 'state.json'].every((f) => files.includes(f));
    const acct = aSync('account.json');
    const testFile = acct?.keyStore === 'test' && typeof acct?.refresh?.testPlain === 'string' && !acct?.refresh?.enc;
    const folders = fs.readdirSync(path.join(A_DIR, 'backups'));
    const extra = folders.map((f) => [f, fs.readdirSync(path.join(A_DIR, 'backups', f)).filter((x) => !['recaller-data.json', 'recaller-settings.json', 'backup.json'].includes(x))]).filter(([, x]) => x.length);
    const ok = identical && four && testFile && folders.length > 0 && extra.length === 0;
    return { ok, detail: JSON.stringify({ identical, sync: files, testFile, backups: folders.length, extra }) };
  });

  // ================================================================ computer B signs in (its Welcome gives way to the account's board)
  const { createPeer } = require(PEER);
  // B reaches only the loopback mock too: anything else is refused, and check 42 fails (as for A's net.fetch)
  const bFetch = (url, init) => {
    const u = typeof url === 'string' ? url : url?.url ?? String(url);
    if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(u)) {
      outside.push(`B ${u.split('?')[0].slice(0, 100)}`);
      return Promise.reject(new TypeError('the sync suite lets computer B reach only the loopback mock'));
    }
    return fetch(url, init);
  };
  B = createPeer({ dir: B_DIR, fetchImpl: bFetch, base: mock.base, platform: B_PLATFORM, name: 'B' });
  await B.boot();
  const bSignIn = await B.signIn(ACC1.email, ACC1.password);
  const bJoined = await B.whenQuiet({ timeoutMs: 30000 });
  const bBoard = B.board();
  console.log(`INFO  B signed in: ${JSON.stringify(bSignIn)}, quiet ${bJoined}, B has ${bBoard?.projects?.length} projects (${bBoard?.projects?.map((p) => p.id).join(',')}), notices ${JSON.stringify(B.page.notices.map((x) => x.code))}`);
  await closeSettings();
  focusA();
  await bothSynced();

  // ================================================================ 12–15: ordinary syncing
  await spec(12, 'Local edit: the head rev goes up within 2 s (fast timers), with _sync.by = A\'s device id', async () => {
    const rev0 = headRev(UID1);
    const savedAt = await editCard('nA3', 'Summarize the websocket protocol in 10 bullets (edited on A).');
    const upAt = await waitFor(() => (headRev(UID1) > rev0 ? Date.now() : null), { timeout: 5000, every: 20 });
    const doc = cloudNote(UID1, 'nA3');
    const ok = Boolean(upAt) && upAt - savedAt <= 2000 && doc?.text === 'Summarize the websocket protocol in 10 bullets (edited on A).' && doc?._sync?.by === A_DEV;
    return { ok, detail: JSON.stringify({ ms: upAt ? upAt - savedAt : null, by: doc?._sync?.by === A_DEV, rev: [rev0, headRev(UID1)] }) };
  });

  const viewOf = (d) => ({
    prefs: { density: d?.prefs?.density, colWidths: d?.prefs?.colWidths, scroll: d?.prefs?.scroll, titleFont: d?.prefs?.titleFont, cookedColor: d?.prefs?.cookedColor, futurePref: d?.prefs?.futurePref },
    projects: Object.fromEntries((d?.projects || []).map((p) => [p.id, { notesCollapsed: p.notesCollapsed, usedCollapsed: p.usedCollapsed, augCollapsed: p.augCollapsed, draft: p.draft, draftImages: p.draftImages }])),
    expanded: allIds(d).filter((id) => noteIn(d, id).expanded === true).sort(),
  });

  let addedOnB = null;
  await spec(13, 'B\'s changes reach A (edit, add, move to Cooked, delete, column reorder): after A\'s focus A shows them all, no toast; A\'s widths, density, folds, drafts and scroll unchanged', async () => {
    await bothSynced();
    await sleep(1200); // a scroll position the last check left is saved by now
    const before = viewOf(aData());
    const mark = Date.now();
    const nC3text = noteIn(B.board(), 'nC3')?.text;
    B.page.editNote('nA4', 'Refactor agents.py (edited on B).');
    addedOnB = B.page.addNote('pB', 'Added on B');
    B.page.moveNote('nC3', { list: 'used' });
    B.page.deleteNote('nD2');
    B.page.moveProject('pD', 0);
    await B.whenQuiet();
    await refocusA();
    const seen = await waitFor(async () => {
      const r = await js(`(() => {
        const t = (id) => document.querySelector('.card-wrap[data-id="' + id + '"] .card-text')?.textContent ?? null;
        return { nA4: t('nA4'), added: t(${JSON.stringify(addedOnB)}), nC3card: !!document.querySelector('.column[data-id="pC"] .active-list .card-wrap[data-id="nC3"]'), aug: document.querySelector('.column[data-id="pC"] .aug-text')?.textContent ?? '', nD2: !!document.querySelector('.card-wrap[data-id="nD2"]'), first: document.querySelector('.column')?.dataset.id };
      })()`);
      return r.nA4 === 'Refactor agents.py (edited on B).' && r.added === 'Added on B' && !r.nC3card && r.aug.includes(nC3text) && !r.nD2 && r.first === 'pD' ? r : null;
    }, { timeout: 15000 });
    await aSynced(UID1);
    const after = viewOf(aData());
    const quietToasts = toastsSince(mark);
    const ok = Boolean(seen) && quietToasts.length === 0 && same(before, after);
    return { ok, detail: JSON.stringify({ seen: Boolean(seen), toasts: quietToasts.map((x) => x.text), viewKept: same(before, after), ...(same(before, after) ? {} : { before: short(before, 200), after: short(after, 200) }) }) };
  });

  await spec(14, 'Joiner: B changes it, and A\'s Settings reflects it', async () => {
    B.page.setJoiner('line');
    await B.whenQuiet();
    const onDisk = await waitFor(() => aData()?.prefs?.joiner === 'line', { timeout: 15000 });
    await openSettings();
    const checked = await js(`document.querySelector('#set-joiner [data-value="line"]').getAttribute('aria-checked')`);
    await closeSettings();
    const ok = Boolean(onDisk) && checked === 'true' && headOf(UID1)?.board?.joiner === 'line';
    return { ok, detail: JSON.stringify({ onDisk: Boolean(onDisk), checked, head: headOf(UID1)?.board }) };
  });

  await spec(15, 'Copy counts: A copies twice and B three times; both show base + 5', async () => {
    await bothSynced();
    const base = aNote('nB2')?.copied || 0;
    const bBase = bNote('nB2')?.copied || 0;
    for (let i = 0; i < 2; i++) { await focusCard('nB2'); key('Enter'); await sleep(450); }
    B.page.copy('nB2', 3);
    B.blur(); // copies go up on blur
    blurA();
    const both = await waitFor(() => (aNote('nB2')?.copied === base + 5 && bNote('nB2')?.copied === base + 5 && cloudNote(UID1, 'nB2')?.copied === base + 5), { timeout: 20000 });
    const shown = await waitFor(async () => { const t = await js(`document.querySelector('.card-wrap[data-id="nB2"] .card-copies')?.textContent ?? ''`); return t === `· copied ${base + 5}×` ? t : null; }, { timeout: 5000 });
    B.focus();
    focusA();
    const ok = base === bBase && Boolean(both) && Boolean(shown);
    return { ok, detail: JSON.stringify({ base, bBase, a: aNote('nB2')?.copied, b: bNote('nB2')?.copied, cloud: cloudNote(UID1, 'nB2')?.copied, shown }) };
  });

  await bothSynced();
  await accountShot('05-signed-in-synced-deep');
  await setTheme('soft');
  await accountShot('05b-signed-in-synced-soft');
  await setTheme('deep');
  await closeSettings();

  // ================================================================ 16–23: conflicts, deletes and busy pages
  const neighbour = (id) => js(`(() => {
    const w = document.querySelector('.card-wrap[data-id="${id}"]');
    if (!w) return null;
    const n = w.nextElementSibling;
    const tag = n?.querySelector('.card-sync-tag');
    return { text: w.querySelector('.card-text')?.textContent, next: n ? { id: n.dataset.id, text: n.querySelector('.card-text')?.textContent, tag: tag?.textContent ?? '', tip: tag?.title ?? '', hl: n.classList.contains('is-hl'), hlTag: n.querySelector('.card-hl-tag')?.textContent ?? '' } : null };
  })()`);
  const conflictToast = `A note was changed on two computers. Both versions are kept; ${HERE}'s is marked Check again.`;

  await spec(16, 'Offline conflict: both keep an amber copy with "Other version"; the toast shows on A, the computer that merges second (B gets the copy as an ordinary new note)', async () => {
    await bothSynced();
    const A_TEXT = 'Draft a friendly 404 page (A, offline).';
    const B_TEXT = 'Draft a friendly 404 page (B, meanwhile).';
    const offline = await goOffline();
    await editCard('nB3', A_TEXT);
    await sleep(500);
    const notices0 = B.page.notices.length;
    B.page.editNote('nB3', B_TEXT);
    await B.whenQuiet();
    const mark = Date.now();
    await goOnline();
    const found = await waitFor(async () => { const r = await neighbour('nB3'); return r?.text === B_TEXT && r.next?.text === A_TEXT ? r : null; }, { timeout: 20000 });
    const toast = await waitToast(mark, conflictToast, 8000);
    const copyId = found?.next?.id;
    const bCopy = await waitFor(() => bNote(copyId), { timeout: 15000 });
    await shot('12-card-other-version-deep', `.column[data-id="pB"] .col-head, .card-wrap[data-id="nB3"], .card-wrap[data-id="${copyId}"]`, 12);
    const bQuiet = !B.page.notices.slice(notices0).some((n) => n.code === 'CONFLICT');
    const aCopy = aNote(copyId);
    // amber on both: the card's highlight tag here ("Check again") and the saved highlight on A and on B
    const ok = Boolean(offline) && Boolean(found) && found.next.tag === 'Other version' && found.next.hl && found.next.hlTag === 'Check again' && found.next.tip === `Changed on two computers at once. This copy is the version from ${HERE}.`
      && Boolean(toast) && aCopy?.syncConflict?.of === 'nB3' && aCopy?.highlight === 'amber' && aCopy?.text === A_TEXT && bCopy?.syncConflict?.of === 'nB3' && bCopy?.highlight === 'amber' && bCopy?.text === A_TEXT && bNote('nB3')?.text === B_TEXT && bQuiet;
    return { ok, detail: JSON.stringify({ offline: Boolean(offline), copy: found?.next, toast: Boolean(toast), aCopy: aCopy ? { conflict: aCopy.syncConflict?.of, hl: aCopy.highlight } : null, bCopy: bCopy ? { conflict: bCopy.syncConflict?.of, hl: bCopy.highlight } : null, bNoToast: bQuiet }) };
  });

  await spec(17, 'A deletes a note while B edits it: the note survives with B\'s text, and a toast shows on A', async () => {
    await bothSynced();
    const B_TEXT = 'Add a dark mode toggle to the header (B edited it).';
    await goOffline();
    const gone = await deleteCard('nB4');
    await sleep(400);
    B.page.editNote('nB4', B_TEXT);
    await B.whenQuiet();
    const mark = Date.now();
    await goOnline();
    const back = await waitFor(async () => (await cardText('nB4')) === B_TEXT, { timeout: 25000 });
    const toast = await waitToast(mark, `A note you deleted was changed on ${B_NAME}, so it was kept.`, 5000);
    await bothSynced();
    const ok = Boolean(gone) && Boolean(back) && Boolean(toast) && bNote('nB4')?.text === B_TEXT && !cloudNote(UID1, 'nB4')?._sync?.deleted;
    return { ok, detail: JSON.stringify({ deletedHere: Boolean(gone), back: Boolean(back), toast: toast?.text ?? toastsSince(mark).map((x) => x.text), b: bNote('nB4')?.text === B_TEXT }) };
  });

  await spec(18, 'B deletes a project while A adds to it: the project is kept on both', async () => {
    await bothSynced();
    await goOffline();
    const added = await addPrompt('pF', 'Added on A while B deleted Ideas');
    await sleep(400);
    B.page.deleteProject('pF');
    await B.whenQuiet();
    const mark = Date.now();
    await goOnline();
    const onA = await waitFor(async () => (await js(`!!document.querySelector('.column[data-id="pF"] .card-wrap[data-id="${added}"]')`)), { timeout: 20000 });
    const toast = await waitToast(mark, `“Ideas” was deleted on ${B_NAME}, but it had changes here, so it was kept.`, 5000);
    const onB = await waitFor(() => bProject('pF') && bNote(added)?.project === 'pF', { timeout: 15000 });
    const ok = Boolean(added) && Boolean(onA) && Boolean(onB) && Boolean(toast) && !docs(UID1).projects.pF?._sync?.deleted;
    return { ok, detail: JSON.stringify({ added: Boolean(added), onA: Boolean(onA), onB: Boolean(onB), toast: toast?.text ?? toastsSince(mark).map((x) => x.text) }) };
  });

  await spec(19, 'Card editor open on A: B\'s edit waits ("Changes from … will appear when you close the editor"); saving gives a conflict copy; cancelling lets B\'s text in', async () => {
    await bothSynced();
    const waitingText = `Changes from ${B_NAME} will appear when you close the editor.`;
    // save variant
    const opened = await openEditor('nA2');
    B.page.editNote('nA2', 'Benchmark (B edited it while A had it open).');
    await B.whenQuiet();
    const waiting = await waitFor(async () => { const u = await accUi(); return u.status === waitingText ? u : null; }, { timeout: 12000 });
    const heldBack = aNote('nA2')?.text === 'Benchmark heuristic_ai vs PPO over 50 seeded maps; report mean burned area.';
    const mark = Date.now();
    await setComposer('Benchmark (A saved it in the open editor).', '.card-wrap[data-id="nA2"] .composer textarea');
    key('Enter', [MOD]);
    const copy = await waitFor(async () => { const r = await neighbour('nA2'); return r?.text === 'Benchmark (B edited it while A had it open).' && r.next?.text === 'Benchmark (A saved it in the open editor).' && r.next.tag === 'Other version' ? r : null; }, { timeout: 15000 });
    const toast = await waitToast(mark, conflictToast, 6000);
    await bothSynced();
    // cancel variant
    const opened2 = await openEditor('nA3');
    B.page.editNote('nA3', 'Summarize the websocket protocol (B edited it; A cancelled).');
    await B.whenQuiet();
    const waiting2 = await waitFor(async () => { const u = await accUi(); return u.status === waitingText ? u : null; }, { timeout: 12000 });
    key('Escape');
    const applied = await waitFor(async () => (await cardText('nA3')) === 'Summarize the websocket protocol (B edited it; A cancelled).', { timeout: 10000 });
    const ok = Boolean(opened && waiting && heldBack && copy && toast && opened2 && waiting2 && applied) && waiting.ind.title === waitingText.replace(/\.$/, '');
    return { ok, detail: JSON.stringify({ waiting: waiting?.status, indicator: waiting?.ind.title, heldBack, copy: Boolean(copy), toast: Boolean(toast), cancelWaiting: Boolean(waiting2), cancelApplied: Boolean(applied) }) };
  });

  await spec(20, 'Composer with a draft in a project B deletes: the composer and draft survive, and the project is kept', async () => {
    await bothSynced();
    const DRAFT = 'Draft that must survive';
    await js(`(() => { const c = document.querySelector('.column[data-id="pG"]'); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); c.querySelector('.col-add').click(); })()`);
    const sel = '.column[data-id="pG"] .col-compose .composer textarea';
    await waitFor(() => js(`!!document.querySelector(${JSON.stringify(sel)})`), { timeout: 3000 });
    await js(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await type(DRAFT);
    const draftSaved = await waitFor(() => aData()?.projects.find((p) => p.id === 'pG')?.draft === DRAFT, { timeout: 5000 });
    const mark = Date.now();
    B.page.deleteProject('pG');
    await B.whenQuiet();
    const toast = await waitToast(mark, `“Errands” was deleted on ${B_NAME}, but it had an unsaved draft here, so it was kept.`, 20000);
    const composer = await js(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
    const column = (await colIds()).includes('pG');
    const onB = await waitFor(() => bProject('pG'), { timeout: 15000 });
    key('Escape'); // the composer closes; its draft stays (per computer)
    await sleep(300);
    const ok = Boolean(draftSaved) && Boolean(toast) && composer === DRAFT && column && Boolean(onB) && !docs(UID1).projects.pG?._sync?.deleted;
    return { ok, detail: JSON.stringify({ draftSaved: Boolean(draftSaved), toast: toast?.text ?? toastsSince(mark).map((x) => x.text), composer, column, onB: Boolean(onB) }) };
  });

  await spec(21, 'Undo toast visible: a content patch waits until the toast has gone, then Undo is disabled; a counter-only patch leaves history alone', async () => {
    await bothSynced();
    const c0 = aNote('nC2')?.copied || 0;
    await deleteCard('nC1');
    const t = await waitFor(() => rect('.toast[data-history]:not(.is-leaving)'), { timeout: 3000, every: 50 });
    if (t) mouse('mouseMove', t.cx, t.cy, { modifiers: [] }); // the pointer on the toast keeps it up
    await sleep(300);
    const undoOn = !(await js(`document.querySelector('#undo').disabled`));
    B.page.copy('nC2', 2);
    B.blur();
    await B.whenQuiet();
    B.focus();
    const counted = await waitFor(async () => aNote('nC2')?.copied === c0 + 2 && (await js(`document.querySelector('.card-wrap[data-id="nC2"] .card-copies')?.textContent ?? ''`)) === `· copied ${c0 + 2}×`, { timeout: 12000 });
    const historyKept = !(await js(`document.querySelector('#undo').disabled`)) && Boolean(await js(`!!document.querySelector('.toast[data-history]:not(.is-leaving)')`));
    const B_TEXT = 'Renew the cloud budget alert (B edited it during an Undo toast).';
    B.page.editNote('nD1', B_TEXT);
    await B.whenQuiet();
    const held = await waitFor(async () => (await mainState()).sync?.phase === 'waiting', { timeout: 12000 });
    const notYet = (await cardText('nD1')) !== B_TEXT && Boolean(await js(`!!document.querySelector('.toast[data-history]:not(.is-leaving)')`));
    mouse('mouseMove', 30, 300, { modifiers: [] }); // off the toast: it leaves 1.5 s later
    const applied = await waitFor(async () => (await cardText('nD1')) === B_TEXT, { timeout: 12000 });
    const toastGone = !(await js(`!!document.querySelector('.toast[data-history]:not(.is-leaving)')`));
    const undoOff = await js(`document.querySelector('#undo').disabled`);
    const ok = Boolean(t) && undoOn && Boolean(counted) && historyKept && Boolean(held) && notYet && Boolean(applied) && toastGone && undoOff;
    return { ok, detail: JSON.stringify({ toast: Boolean(t), undoOn, counterApplied: Boolean(counted), historyKept, held: Boolean(held), notYet, applied: Boolean(applied), toastGone, undoOff }) };
  });

  await spec(22, 'Patch during a copy: a patch lands during copyNote\'s await; the count lands on the live note', async () => {
    await bothSynced();
    const c0 = aNote('nB5')?.copied || 0;
    let release;
    copyGate = { promise: new Promise((r) => { release = r; }) };
    await focusCard('nB5');
    key('Enter'); // copies: the clipboard write is held
    await sleep(250);
    const B_TEXT = 'Compress the gallery images to WebP (B edited it during a copy).';
    B.page.editNote('nB5', B_TEXT);
    await B.whenQuiet();
    const patched = await waitFor(async () => (await cardText('nB5')) === B_TEXT, { timeout: 12000 });
    const midCount = aNote('nB5')?.copied;
    copyGate = null;
    release();
    const counted = await waitFor(() => aNote('nB5')?.copied === c0 + 1 && aNote('nB5')?.text === B_TEXT, { timeout: 5000 });
    await refocusA(); // copies go up on blur
    const upB = await waitFor(() => cloudNote(UID1, 'nB5')?.copied === c0 + 1 && bNote('nB5')?.copied === c0 + 1, { timeout: 15000 });
    const ok = Boolean(patched) && midCount === c0 && Boolean(counted) && Boolean(upB);
    return { ok, detail: JSON.stringify({ patchedDuringCopy: Boolean(patched), countDuringCopy: midCount, after: aNote('nB5')?.copied, cloud: cloudNote(UID1, 'nB5')?.copied, b: bNote('nB5')?.copied }) };
  });

  await spec(23, 'Drag in progress: the patch applies after the drop, and both changes are present', async () => {
    await bothSynced();
    copyGate = null;
    await js(`document.querySelector('.card-wrap[data-id="nA4"] .card').scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await sleep(200);
    const r = await rect('.card-wrap[data-id="nA4"] .card');
    const head = await rect('.column[data-id="pA"] .used-head');
    const nA4text = aNote('nA4')?.text;
    mouse('mouseMove', r.cx, r.cy, { modifiers: [] });
    mouse('mouseDown', r.cx, r.cy);
    await sleep(320);
    await drag(r.cx, r.cy, r.cx + 8, r.cy + 40, 6, 18);
    const dragging = await js(`document.body.classList.contains('is-dragging') || !!document.querySelector('.card-wrap.is-dragging, .drag-ghost, .is-drag-source')`);
    const B_TEXT = 'Make the hero section responsive (B edited it during a drag).';
    B.page.editNote('nB1', B_TEXT);
    await B.whenQuiet();
    const held = await waitFor(async () => (await mainState()).sync?.phase === 'waiting', { timeout: 12000 });
    const during = (await cardText('nB1')) !== B_TEXT;
    await drag(r.cx + 8, r.cy + 40, head.cx, head.cy + 40, 14, 18);
    mouse('mouseUp', head.cx, head.cy + 40);
    const both = await waitFor(async () => (await augText('pA')).includes(nA4text) && (await cardText('nB1')) === B_TEXT, { timeout: 20000 });
    const onB = await waitFor(() => bNote('nA4')?.list === 'used', { timeout: 15000 });
    const ok = dragging && Boolean(held) && during && Boolean(both) && Boolean(onB);
    return { ok, detail: JSON.stringify({ dragging, held: Boolean(held), heldDuringDrag: during, bothAfterDrop: Boolean(both), dropOnB: Boolean(onB) }) };
  });

  // ================================================================ 24–30: the network, tokens and the account's limits
  await spec(24, 'Offline: 3 edits wait (indicator "Offline · 3 changes will upload…", status "Offline · changes upload when you\'re back online"); back online, one push; the indicator hides again. A dropped answer is NETWORK, never resent', async () => {
    await bothSynced();
    const offline = await goOffline();
    const ids = [];
    for (const t of ['Offline edit one', 'Offline edit two', 'Offline edit three']) ids.push(await addPrompt('pD', t));
    const u = await waitFor(async () => { const x = await accUi(); return x.ind.title === "Offline · 3 changes will upload when you're back online" ? x : null; }, { timeout: 8000 });
    await shot('11-topbar-offline-deep', '.topbar-actions', 12);
    const mark = mock.log.length;
    const rev0 = headRev(UID1);
    await goOnline();
    const up = await aSynced(UID1, 15000);
    const commits = boardCommits(mark, UID1).filter((e) => e.status === 200);
    const revs = ids.map((id) => cloudNote(UID1, id)?._sync?.rev);
    const onePush = commits.length === 1 && revs.every((r) => r === commits[0].rev) && headRev(UID1) === rev0 + 1;
    const hidden = await waitFor(async () => (await accUi()).ind.hidden, { timeout: 5000 });
    // Electron's net.fetch and a connection cut after the first bytes: one 'offline' entry, the app sees NETWORK
    // (the body fails), reads the head (did it land?), and commits again later: Chromium never resent it.
    await bothSynced();
    B.setOnline(false); // the injected failure must meet A's commit, not one of B's
    await sleep(300);
    const dropMark = mock.log.length;
    const aMark = aRequests.length;
    mock.fail({ service: 'firestore', op: 'commit', status: 'offline', times: 1 });
    await editCard('nD1', 'Renew the cloud budget alert (after a dropped answer).');
    const landed = await waitFor(() => cloudNote(UID1, 'nD1')?.text === 'Renew the cloud budget alert (after a dropped answer).', { timeout: 15000 });
    B.setOnline(true);
    const drops = mock.log.slice(dropMark).filter((e) => e.status === 'offline');
    const mine = aRequests.slice(aMark);
    const cut = mine.findIndex((r) => /:commit$/.test(r.url) && r.bodyError);
    const nextReq = cut >= 0 ? mine[cut + 1] : null;
    // the dropped commit was never processed (no uid or rev in its entry); the board commit after it is A's own retry
    const commitsAfter = mock.log.slice(dropMark).filter((e) => e.op === 'commit' && (e.status === 'offline' || (e.uid === UID1 && e.rev !== undefined)));
    const retryGap = commitsAfter.length >= 2 ? commitsAfter[1].at - commitsAfter[0].at : null;
    // In the mock's log, between the dropped commit and the one that landed: A's head read (did it land?) and no
    // other board commit. A resend by Chromium would be one, and would come before the app could read the head.
    const tail = mock.log.slice(dropMark);
    const iDrop = tail.findIndex((e) => e.op === 'commit' && e.status === 'offline');
    const iRetry = iDrop < 0 ? -1 : tail.findIndex((e, i) => i > iDrop && e.op === 'commit' && e.uid === UID1 && e.rev !== undefined && e.status === 200);
    const between = iRetry > iDrop ? tail.slice(iDrop + 1, iRetry) : [];
    const headRead = between.some((e) => e.op === 'get' && e.doc === `users/${UID1}`);
    const commitsBetween = between.filter((e) => e.op === 'commit' && (e.rev !== undefined || e.status === 'offline')).length;
    const noResend = drops.length === 1 && cut >= 0 && nextReq?.method === 'GET' && iRetry > iDrop && headRead && commitsBetween === 0
      && commitsAfter.length === 2 && commitsAfter[0].status === 'offline' && commitsAfter[1].status === 200;
    const ok = Boolean(offline) && Boolean(u) && u.status === "Offline · changes upload when you're back online" && !u.ind.hidden && u.ind.muted && Boolean(up) && onePush && Boolean(hidden) && Boolean(landed) && noResend;
    return { ok, detail: JSON.stringify({ indicator: u?.ind, status: u?.status, onePush, commits: commits.length, revs, hiddenAgain: Boolean(hidden), drop: { entries: drops.length, bodyError: cut >= 0, next: nextReq && `${nextReq.method} ${nextReq.url.split('/').pop().slice(0, 30)}`, commits: commitsAfter.map((e) => e.status), headReadBetween: headRead, commitsBetween, retryGap } }) };
  });

  await spec(25, 'Expired ID tokens: refreshed without the user noticing', async () => {
    await bothSynced();
    const aMark = aRequests.length;
    mock.expireIdTokens();
    const refreshed = await waitFor(() => {
      const rs = aRequests.slice(aMark);
      const i401 = rs.findIndex((r) => r.status === 401);
      const iTok = rs.findIndex((r, i) => i > i401 && i401 >= 0 && /securetoken/.test(r.url) && r.status === 200);
      return iTok >= 0 && rs.some((r, i) => i > iTok && /firestore/.test(r.url) && r.status === 200) ? { i401, iTok } : null;
    }, { timeout: 10000 });
    const rev0 = headRev(UID1);
    await editCard('nB6', 'Fix the nav overlap on mobile (after the ID tokens expired).');
    const landed = await waitFor(() => headRev(UID1) > rev0 && cloudNote(UID1, 'nB6')?.text === 'Fix the nav overlap on mobile (after the ID tokens expired).', { timeout: 10000 });
    const u = await accUi();
    const ok = Boolean(refreshed) && Boolean(landed) && u.state === 'signed-in' && u.view === 'in' && !u.error && !u.status.startsWith('Sync paused');
    return { ok, detail: JSON.stringify({ refreshed: Boolean(refreshed), landed: Boolean(landed), state: u.state, view: u.view, status: u.status }) };
  });

  await spec(26, 'Revoked refresh token: needs-sign-in text; edits still save locally; signing in again (same account) pushes them, with nothing deleted', async () => {
    await bothSynced();
    const tomb0 = tombstones(UID1);
    mock.revokeTokens(ACC1.email);
    mock.expireIdTokens();
    const needs = await waitFor(async () => { const u = await accUi(); return u.state === 'needs-sign-in' && u.view === 'needs' ? u : null; }, { timeout: 15000 });
    const needsText = needs?.text.includes(`You're signed out on ${HERE} because your password changed or your sign-in expired. Your notes here are safe, and changes you make meanwhile upload after you sign in.`);
    await accountShot('09-needs-sign-in-deep');
    await closeSettings();
    const added = await addPrompt('pD', 'Written while the sign-in had ended');
    await editCard('nD1', 'Renew the cloud budget alert (edited while the sign-in had ended).');
    await sleep(500);
    const local = Boolean(noteIn(aData(), added)) && aNote('nD1')?.text === 'Renew the cloud budget alert (edited while the sign-in had ended).';
    await openSettings();
    await actOrThrow('sign-in-again');
    await view('sign-in');
    const prefilled = await js(`document.querySelector('#account input[name="email"]').value`);
    await fill('password', ACC1.password);
    await submitAndWait('submit-sign-in', 'signInWithPassword');
    const back = await waitFor(async () => (await mainState()).state === 'signed-in', { timeout: 10000 });
    const pushed = await waitFor(() => cloudNote(UID1, added) && cloudNote(UID1, 'nD1')?.text === 'Renew the cloud budget alert (edited while the sign-in had ended).', { timeout: 15000 });
    await closeSettings();
    const bNeeds = B.accountState().state;
    if (bNeeds !== 'signed-in') await B.signIn(ACC1.email, ACC1.password);
    await bothSynced();
    const ok = Boolean(needs) && needsText && needs.ind.title === 'Sign in again to keep syncing' && local && prefilled === ACC1.email && Boolean(back) && Boolean(pushed) && tombstones(UID1) === tomb0;
    return { ok, detail: JSON.stringify({ needs: needs?.view, text: needsText, indicator: needs?.ind.title, local, prefilled, back: Boolean(back), pushed: Boolean(pushed), tombstones: [tomb0, tombstones(UID1)], bWas: bNeeds }) };
  });

  await spec(27, 'Precondition race: a retry, no duplicates', async () => {
    await bothSynced();
    const live0 = liveNoteIds(UID1).length;
    const RACED = 'Chart: burned area per seed (raced edit from the other computer)';
    mock.bumpHeadBetweenGetAndCommit({ uid: UID1, times: 1, change: (r) => r.editNote('nC2', RACED) });
    const mark = mock.log.length;
    await editCard('nB6', 'Fix the nav overlap on mobile (edited on A in a race).');
    const done = await waitFor(() => cloudNote(UID1, 'nB6')?.text === 'Fix the nav overlap on mobile (edited on A in a race).', { timeout: 15000 });
    const shown = await waitFor(async () => (await cardText('nC2')) === RACED, { timeout: 10000 });
    await bothSynced();
    const bumped = mock.log.slice(mark).find((e) => e.tags?.includes('bumped'));
    // the raced commit was refused before anything was written (its entry has no uid or rev); then A's retry
    const statuses = mock.log.slice(mark).filter((e) => e.op === 'commit' && (e === bumped || (e.uid === UID1 && e.rev !== undefined))).map((e) => e.status);
    const ids = allIds(aData());
    const dupes = ids.length - new Set(ids).size;
    const copies = liveNoteIds(UID1).filter((id) => id.startsWith('nB6-c') || id.startsWith('nC2-c'));
    const ok = Boolean(done) && Boolean(shown) && Boolean(bumped) && !bumped.error && statuses[0] === 400 && statuses.includes(200) && liveNoteIds(UID1).length === live0 && dupes === 0 && copies.length === 0 && cloudNote(UID1, 'nB6')?._sync?.by === A_DEV;
    return { ok, detail: JSON.stringify({ landed: Boolean(done), racedShown: Boolean(shown), bumped: bumped ? (bumped.error || 'yes') : 'no', commits: statuses, live: [live0, liveNoteIds(UID1).length], dupes, copies }) };
  });

  await spec(28, 'One document denied: that note is quarantined ("Sync paused · the cloud refused a change…"), the others sync; Retry syncs it once the denial is removed', async () => {
    await bothSynced();
    const undeny = mock.denyDoc(`users/${UID1}/notes/nD1`);
    const REFUSED = 'Renew the cloud budget alert (the cloud refuses this one at first).';
    const OTHER = 'Summarize the websocket protocol (synced while nD1 was refused).';
    await goOffline(); // both edits go up in one commit
    await editCard('nD1', REFUSED);
    await editCard('nA3', OTHER);
    await sleep(400);
    await goOnline();
    const refusedText = `Sync paused · the cloud refused a change. It stays on ${HERE}.`;
    const paused = await waitFor(async () => { const u = await accUi(); return u.status === refusedText || u.side === refusedText ? u : null; }, { timeout: 25000 });
    await shot('10-topbar-paused-deep', '.topbar-actions', 12);
    await setTheme('soft');
    await closeSettings();
    await shot('10s-topbar-paused-soft', '.topbar-actions', 12);
    await setTheme('deep');
    await closeSettings();
    const others = cloudNote(UID1, 'nA3')?.text === OTHER;
    const held = cloudNote(UID1, 'nD1')?.text !== REFUSED;
    const retryShown = paused?.actions.includes('retry');
    undeny();
    await openSettings();
    await accountShot('10b-paused-section-deep');
    await actOrThrow('retry');
    const synced = await waitFor(() => cloudNote(UID1, 'nD1')?.text === REFUSED, { timeout: 15000 });
    const clear = await aSynced(UID1, 10000);
    await closeSettings();
    const ok = Boolean(paused) && others && held && retryShown && paused.ind.title === 'Sync paused · click for details' && paused.ind.dot && Boolean(synced) && Boolean(clear);
    return { ok, detail: JSON.stringify({ status: paused?.status || paused?.side, indicator: paused?.ind, others, held, retryShown, retried: Boolean(synced), clear: Boolean(clear) }) };
  });

  await spec(29, 'A 950 KB note: the too-large text; the others sync', async () => {
    await bothSynced();
    const BIG = 'A very long note. '.repeat(Math.ceil((950 * 1024) / 18)).slice(0, 950 * 1024);
    await js(`(() => { const c = document.querySelector('.column[data-id="pD"]'); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); c.querySelector('.col-add').click(); })()`);
    const sel = '.column[data-id="pD"] .col-compose .composer textarea';
    await waitFor(() => js(`!!document.querySelector(${JSON.stringify(sel)})`), { timeout: 3000 });
    await setComposer(BIG, sel);
    key('Enter', [MOD]);
    const bigId = await waitFor(() => allIds(aData()).find((id) => aNote(id)?.text?.length === BIG.length), { timeout: 8000 });
    const OTHER = 'Make the hero section responsive (synced beside a 950 KB note).';
    await editCard('nB1', OTHER);
    const tooLarge = `1 note is too large to sync (over 900 KB). It stays on ${HERE}.`;
    const shown = await waitFor(async () => { const u = await accUi(); return u.status.includes(tooLarge) || u.side.includes(tooLarge) ? u : null; }, { timeout: 15000 });
    const others = await waitFor(() => cloudNote(UID1, 'nB1')?.text === OTHER, { timeout: 10000 });
    const notInCloud = !cloudNote(UID1, bigId);
    await shot('10c-topbar-too-large-deep', '.topbar-actions', 12);
    // It stays here only: deleted again, so the board can be removed at sign-out later (38)
    const gone = await deleteCard(bigId);
    const clear = await aSynced(UID1, 15000);
    const ok = Boolean(bigId) && Boolean(shown) && Boolean(others) && notInCloud && Boolean(gone) && Boolean(clear);
    return { ok, detail: JSON.stringify({ big: Boolean(bigId), text: shown?.status || shown?.side, others: Boolean(others), notInCloud, cleanedUp: Boolean(gone && clear) }) };
  });

  await spec(30, 'Unknown fields round-trip from A to the cloud to B and back, unchanged; futureTopLevel appears only in A\'s device record', async () => {
    await bothSynced();
    const B_TEXT = 'Review the fire spread model (edited on B; unknown fields ride along).';
    B.page.editNote('nA1', B_TEXT);
    await B.whenQuiet();
    await waitFor(() => aNote('nA1')?.text === B_TEXT, { timeout: 15000 });
    const fieldsOk = (n, p) => same(n?.futureNoteField, { nested: true }) && n?.images?.[0]?.futureImageField === 7 && p?.futureProjectField === 'x';
    const onA1 = fieldsOk(aNote('nA1'), aData()?.projects.find((p) => p.id === 'pA'));
    const A_TEXT = 'Review the fire spread model (edited on A again; unknown fields still there).';
    await editCard('nA1', A_TEXT);
    await waitFor(() => cloudNote(UID1, 'nA1')?.text === A_TEXT && bNote('nA1')?.text === A_TEXT, { timeout: 15000 });
    const inCloud = fieldsOk(cloudNote(UID1, 'nA1'), docs(UID1).projects.pA);
    const onB = fieldsOk(bNote('nA1'), bProject('pA'));
    const onA2 = fieldsOk(aNote('nA1'), aData()?.projects.find((p) => p.id === 'pA'));
    const d = docs(UID1);
    let aView = null;
    try { aView = JSON.parse(d.devices[A_DEV]?.view || 'null'); } catch {}
    const inDevice = same(aView?.top?.futureTopLevel, SEED.futureTopLevel);
    const bDev = B.readDevice()?.id;
    let bView = null;
    try { bView = JSON.parse(d.devices[bDev]?.view || 'null'); } catch {}
    const leaked = JSON.stringify(d.head).includes('futureTopLevel') || [...Object.values(d.projects), ...Object.values(d.notes)].some((x) => JSON.stringify(x).includes('futureTopLevel'))
      || Object.hasOwn(B.disk() || {}, 'futureTopLevel') || JSON.stringify(bView || {}).includes('futureTopLevel');
    const ok = onA1 && inCloud && onB && onA2 && inDevice && !leaked;
    return { ok, detail: JSON.stringify({ onA1, inCloud, onB, onA2, inADevice: inDevice, elsewhere: leaked, bDevice: Boolean(bView) }) };
  });

  // ================================================================ 31–34: unreadable files, restore, the mass-delete guard
  const reload = async () => { const loaded = new Promise((r) => wc.once('did-finish-load', r)); wc.reload(); await loaded; await sleep(400); };
  // Bad bytes on disk, then a reload. The page going away may still send a save (a scroll position, a draft), and
  // main rightly writes it before the new page reads the file: that is a readable file again, not this test. So when
  // a save reached main between the corruption and the next data:load, the page that has just loaded (with nothing
  // of its own to save) goes through it once more. → which attempt read the bad file, or 0.
  async function corruptAndReload(corrupt) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(1000);
      corrupt();
      const saves0 = saveCount;
      const loads0 = loads.length;
      await reload();
      if (loads[loads0] && loads[loads0].saves === saves0) return attempt;
      console.log(`INFO  the page saved on its way out (attempt ${attempt}), over the corrupted file: corrupting it again`);
      await aSynced(UID1, 15000);
    }
    return 0;
  }
  const unreadableCopies = (bytes) => fs.readdirSync(A_DIR).filter((n) => /^recaller-data\.unreadable-.+\.json$/.test(n) && fs.readFileSync(path.join(A_DIR, n)).equals(bytes));

  await spec(31, 'Unreadable file: data file and .bak corrupt, page reloaded: the Welcome seed gives way to the account\'s board, no tombstones, an unreadable copy is kept, the toast shows', async () => {
    await reload(); // a page with nothing waiting to be saved
    await bothSynced();
    const tomb0 = tombstones(UID1);
    const trash0 = Object.keys(docs(UID1).trash).length;
    const garbage = Buffer.from('{ "projects": [ this is not JSON');
    const mark = Date.now();
    const attempt = await corruptAndReload(() => {
      fs.writeFileSync(A_DATA, garbage);
      fs.writeFileSync(`${A_DATA}.bak`, garbage);
    });
    const toast = await waitToast(mark, `${HERE_CAP}'s notes file couldn't be read, so your board was restored from your account. The unreadable file was kept in the data folder.`, 20000);
    const synced = await aSynced(UID1, 15000);
    const cols = await colIds();
    const accountCols = liveProjectIds(UID1);
    const kept = unreadableCopies(garbage).length > 0;
    const welcomeGone = !(aData()?.projects || []).some((p) => p.name === 'Welcome' && p.id !== 'pW');
    if (!welcomeGone || !same(cols, accountCols)) {
      const named = (ids, of) => ids.map((id) => `${id}:${of(id)}`);
      console.log(`INFO  31: A's file ${JSON.stringify((aData()?.projects || []).map((p) => `${p.id}:${p.name}:${LISTS.map((l) => (p[l] || []).length).join('/')}`))}`);
      console.log(`INFO  31: account ${JSON.stringify(named(accountCols, (id) => docs(UID1).projects[id]?.name))}; columns ${JSON.stringify(cols)}`);
      console.log(`INFO  31: patches ${JSON.stringify(patches.filter((p) => p.at >= mark))}`);
      console.log(`INFO  31: loads ${JSON.stringify(loads.filter((l) => l.at >= mark))}, saves now ${saveCount}`);
    }
    const ok = attempt > 0 && Boolean(toast) && Boolean(synced) && same(cols, accountCols) && welcomeGone && tombstones(UID1) === tomb0 && Object.keys(docs(UID1).trash).length === trash0 && kept;
    return { ok, detail: JSON.stringify({ readTheBadFile: attempt ? `attempt ${attempt}` : 'never', toast: Boolean(toast), columns: same(cols, accountCols) ? 'the account\'s' : cols, seedGone: welcomeGone, tombstones: [tomb0, tombstones(UID1)], trash: [trash0, Object.keys(docs(UID1).trash).length], unreadableCopy: kept }) };
  });

  await spec(32, '.bak fallback: a union; nothing deleted in the mock', async () => {
    await reload();
    await bothSynced();
    const older = fs.readFileSync(A_DATA); // the .bak to be: the board before X
    const X = await addPrompt('pB', 'Added after the .bak was made');
    await waitFor(() => cloudNote(UID1, X), { timeout: 10000 });
    await bothSynced();
    const tomb0 = tombstones(UID1);
    const live0 = liveNoteIds(UID1).length;
    const bad = Buffer.from('not JSON either');
    const attempt = await corruptAndReload(() => {
      fs.writeFileSync(A_DATA, bad);
      fs.writeFileSync(`${A_DATA}.bak`, older);
    });
    const back = await waitFor(async () => (await cardText(X)) === 'Added after the .bak was made', { timeout: 20000 });
    const synced = await aSynced(UID1, 15000);
    const kept = unreadableCopies(bad).length > 0;
    const ok = attempt > 0 && Boolean(X) && !noteIn(JSON.parse(older), X) && Boolean(back) && Boolean(synced) && kept && tombstones(UID1) === tomb0 && liveNoteIds(UID1).length === live0 && allIds(aData()).length === live0;
    return { ok, detail: JSON.stringify({ readTheBak: attempt ? `attempt ${attempt}` : 'never', back: Boolean(back), unreadableCopy: kept, tombstones: [tomb0, tombstones(UID1)], live: [live0, liveNoteIds(UID1).length, allIds(aData()).length] }) };
  });

  await spec(33, 'Restore an older backup while signed in: nothing deleted in the mock; notes from the backup come back on B; B\'s newer notes stay on A', async () => {
    await bothSynced();
    await openSettings();
    await js(`document.querySelector('#backup-now').click()`);
    const manual = await waitFor(() => backupsOf('manual').slice(-1)[0], { timeout: 5000 });
    await closeSettings();
    await deleteCard('nB1');
    await waitFor(() => cloudNote(UID1, 'nB1')?._sync?.deleted === true, { timeout: 15000 });
    const newer = B.page.addNote('pB', 'Newer note from B');
    await B.whenQuiet();
    await waitFor(async () => (await cardText(newer)) === 'Newer note from B', { timeout: 20000 });
    await bothSynced();
    const liveBefore = liveNoteIds(UID1);
    await openSettings();
    await js(`(() => { window.confirm = (m) => { console.debug('[confirm] ' + JSON.stringify(String(m))); return true; }; document.querySelector('#set-backup').value = ${JSON.stringify(manual)}; })()`);
    const loaded = new Promise((r) => wc.once('did-finish-load', r));
    const c0 = confirms.length;
    await js(`document.querySelector('#backup-restore').click()`);
    await Promise.race([loaded, sleep(10000)]);
    await sleep(400);
    const onA = await waitFor(async () => (await cardText('nB1')) && (await cardText(newer)) === 'Newer note from B', { timeout: 20000 });
    await bothSynced();
    const onB = await waitFor(() => bNote('nB1'), { timeout: 15000 });
    const liveAfter = new Set(liveNoteIds(UID1));
    const nothingDeleted = liveBefore.every((id) => liveAfter.has(id)) && liveAfter.has('nB1');
    const confirmText = confirms[c0] || '';
    const ok = Boolean(manual) && Boolean(onA) && Boolean(onB) && nothingDeleted && /^Bring back the board from .+\?\n\nYou're signed in, so nothing is deleted from your account: notes in the backup are added back, and notes that are only in your account stay\. What you have now is backed up first\.$/.test(confirmText);
    return { ok, detail: JSON.stringify({ backup: Boolean(manual), onA: Boolean(onA), backOnB: Boolean(onB), nothingDeleted, confirm: confirmText.split('\n')[0] }) };
  });

  await spec(34, 'Mass-delete guard (a crafted save without labels): the choice text shows; "Keep them in my account" deletes nothing and restores them locally', async () => {
    await bothSynced();
    await editCard('nA3', 'Summarize the websocket protocol (a labelled edit: older labels are spent).');
    await bothSynced();
    await sleep(300);
    const board = aData();
    const five = (board.projects.find((p) => p.id === 'pB')?.notes || []).slice(0, 5).map((x) => x.id);
    const crafted = JSON.parse(JSON.stringify(board));
    for (const p of crafted.projects) for (const l of LISTS) p[l] = (p[l] || []).filter((x) => !five.includes(x.id));
    const meta = { session: lastSaveMeta?.session, seq: (lastSaveMeta?.seq || 0) + 1, contentSeq: lastSaveMeta?.contentSeq ?? 0, labels: [] };
    const tomb0 = tombstones(UID1);
    await js(`window.recaller.saveData(${JSON.stringify(crafted)}, ${JSON.stringify(meta)})`);
    await sleep(700);
    const gone = five.every((id) => !noteIn(aData(), id));
    await js(`window.recaller.sync.now()`);
    const choice = await waitFor(async () => { const u = await accUi(); return u.view === 'choice' && u.title === `Delete ${five.length} notes everywhere?` ? u : null; }, { timeout: 12000 });
    const body = choice?.text.includes(`Recaller is about to delete ${five.length} notes from your account and every computer, but no delete you made explains it.`);
    const nothingYet = tombstones(UID1) === tomb0;
    await openSettings();
    await actOrThrow('choice-keep');
    const restored = await waitFor(() => five.every((id) => noteIn(aData(), id)), { timeout: 15000 });
    await bothSynced();
    await closeSettings();
    const shown = await js(`${JSON.stringify(five)}.every((id) => !!document.querySelector('.card-wrap[data-id="' + id + '"]'))`);
    const ok = five.length === 5 && gone && Boolean(choice) && body && nothingYet && Boolean(restored) && tombstones(UID1) === tomb0 && five.every((id) => !cloudNote(UID1, id)?._sync?.deleted) && shown;
    return { ok, detail: JSON.stringify({ five: five.length, craftedOnDisk: gone, choice: choice?.title, body, tombstones: [tomb0, tombstones(UID1)], restored: Boolean(restored), shown }) };
  });

  // ================================================================ 35–38: switching accounts and signing out
  const UID2 = user2.uid;
  const mask = (email) => `${email[0]}•••${email.slice(email.indexOf('@'))}`;
  await spec(35, 'Second account: sign out, sign in to another account with a board: the choice shows the other-account warning, and nothing from account 1 reaches account 2 unless Combine is chosen', async () => {
    await bothSynced();
    const docs2 = JSON.stringify(docs(UID2));
    const mark = mock.log.length;
    await openSettings();
    await actOrThrow('sign-out');
    const panel = await view('sign-out');
    const outText = panel?.text.includes(`Sign out of ${ACC1.email}? Your board stays on ${HERE} unless you remove it.`);
    const t0 = Date.now();
    await actOrThrow('sign-out-confirm');
    const out = await waitFor(async () => (await mainState()).state === 'signed-out', { timeout: 15000 });
    const outToast = await waitToast(t0, 'Signed out. Your board stays on this computer.', 5000);
    await view('out');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC2.email);
    await fill('password', ACC2.password);
    await actOrThrow('submit-sign-in');
    const choice = await waitFor(async () => { const u = await accUi(); return u.view === 'choice' && u.title === 'Your account already has a board' ? u : null; }, { timeout: 15000 });
    const warning = choice?.other === `${HERE_CAP}'s board was last synced with another account (${mask(ACC1.email)}). Uploading copies it into ${ACC2.email}.`;
    const lines = choice?.text.includes('Account: 2 projects · 3 notes') && choice?.text.includes(`${HERE_CAP}: ${aData().projects.length} projects · ${allIds(aData()).length} notes`);
    await accountShot('06-first-merge-choice-deep');
    await actOrThrow('choice-not-now');
    await sleep(1500);
    const untouched = JSON.stringify(docs(UID2)) === docs2 && boardCommits(mark, UID2).length === 0 && mock.log.slice(mark).every((e) => !(e.op === 'commit' && e.uid === UID2) && !(/^upload/.test(e.op || '') && String(e.name).includes(UID2)));
    const ok = Boolean(panel) && outText && Boolean(out) && Boolean(outToast) && Boolean(choice) && warning && lines && untouched;
    return { ok, detail: JSON.stringify({ signOutText: outText, signedOut: Boolean(out), toast: Boolean(outToast), choice: choice?.title, warning: warning ? 'yes' : choice?.other, lines, account2Untouched: untouched }) };
  });

  await spec(36, 'Combine: a union, with a before-sync backup; the pristine Welcome isn\'t uploaded', async () => {
    const backups0 = backupsOf('before-sync').length;
    const localProjects = aData().projects.map((p) => p.id);
    const localNotes = allIds(aData()).filter((id) => noteIn(aData(), id)?.project !== 'pW'); // the pristine Welcome's stay out
    await closeSettings();
    await openSettings(); // "Not now" lasts until Settings closes
    await waitFor(async () => (await accUi()).view === 'choice', { timeout: 5000 });
    const mark = Date.now();
    await actOrThrow('choice-combine');
    const toast = await waitToast(mark, /^Combined: 2 projects from your account and \d+ from (this Mac|this PC)\.$/, 20000);
    const synced = await aSynced(UID2, 20000);
    const cloudCols = liveProjectIds(UID2);
    const aCols = aData().projects.map((p) => p.id);
    const welcomeUp = cloudCols.includes('pW') || Object.values(docs(UID2).projects).some((p) => p.name === 'Welcome' && !p._sync?.deleted);
    const want = ['q1', 'q2', ...localProjects.filter((id) => id !== 'pW')];
    const kept = ['m1', 'm2', 'm3'].every((id) => cloudNote(UID2, id) && !cloudNote(UID2, id)._sync.deleted);
    // a union of the notes too: the account's three and every note of this computer's (not the Welcome's), on both sides
    const wantNotes = ['m1', 'm2', 'm3', ...localNotes].sort();
    const notesUnion = same(liveNoteIds(UID2).sort(), wantNotes) && same(allIds(aData()).sort(), wantNotes);
    const ok = Boolean(toast) && Boolean(synced) && same(cloudCols, want) && same(aCols, want) && notesUnion && !welcomeUp && backupsOf('before-sync').length === backups0 + 1 && kept;
    return { ok, detail: JSON.stringify({ toast: toast?.text, account2: cloudCols, a: aCols, notes: { want: wantNotes.length, account2: liveNoteIds(UID2).length, a: allIds(aData()).length, union: notesUnion }, welcomeUploaded: welcomeUp, backups: [backups0, backupsOf('before-sync').length], account2NotesKept: kept }) };
  });

  await spec(37, 'Use my account\'s board: the local board is replaced, and the backup holds the old one', async () => {
    const old = aData().projects.map((p) => p.id);
    await openSettings();
    await actOrThrow('sign-out');
    await view('sign-out');
    await actOrThrow('sign-out-confirm');
    await waitFor(async () => (await mainState()).state === 'signed-out', { timeout: 15000 });
    await view('out');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC1.email);
    await fill('password', ACC1.password);
    await actOrThrow('submit-sign-in');
    const choice = await waitFor(async () => { const u = await accUi(); return u.view === 'choice' && u.title === 'Your account already has a board' ? u : null; }, { timeout: 15000 });
    const warning = choice?.other === `${HERE_CAP}'s board was last synced with another account (${mask(ACC2.email)}). Uploading copies it into ${ACC1.email}.`;
    const backups0 = backupsOf('before-sync');
    const accountCols = liveProjectIds(UID1); // the account's board as the question shows it
    const accountNotes = liveNoteIds(UID1).sort();
    const mark = Date.now();
    await actOrThrow('choice-use-account');
    const toast = await waitToast(mark, `${HERE_CAP} now shows your account's board. Its previous board is in Settings › Backups.`, 20000);
    const synced = await aSynced(UID1, 20000);
    const fresh = backupsOf('before-sync').filter((n) => !backups0.includes(n));
    const held = fresh.map((n) => readJson(path.join(A_DIR, 'backups', n, 'recaller-data.json'))?.projects?.map((p) => p.id));
    // replaced down to the notes by the account's board, which stays as it was (nothing of the old board goes up)
    const replaced = same(aData().projects.map((p) => p.id), accountCols) && same(allIds(aData()).sort(), accountNotes);
    const accountKept = same(liveProjectIds(UID1), accountCols) && same(liveNoteIds(UID1).sort(), accountNotes);
    const ok = Boolean(choice) && warning && Boolean(toast) && Boolean(synced) && replaced && accountKept && held.some((ids) => same(ids, old));
    await closeSettings();
    await bothSynced();
    return { ok, detail: JSON.stringify({ warning: warning ? 'yes' : choice?.other, toast: Boolean(toast), replaced, accountKept, notes: [allIds(aData()).length, accountNotes.length, liveNoteIds(UID1).length], backupHoldsOld: held.some((ids) => same(ids, old)), newBackups: fresh.length }) };
  });

  await spec(38, 'Sign-out: with changes waiting, the PENDING text; after signing out account.json is gone, the board untouched, no further requests; the remove option deletes the data file, images and backups (and the unreadable copies: no trace of the board stays), shows Welcome and keeps the settings file', async () => {
    await bothSynced();
    // (a) changes waiting
    await goOffline();
    await addPrompt('pD', 'Waiting while signing out');
    await sleep(600);
    await openSettings();
    await actOrThrow('sign-out');
    const waiting = await waitFor(async () => { const u = await accUi(); return u.view === 'sign-out' && u.text.includes(`1 change hasn't uploaded yet. It stays on ${HERE}; notes you deleted may come back if you sign in again later.`) ? u : null; }, { timeout: 6000 });
    await accountShot('07-sign-out-changes-waiting-deep');
    const res = await js(`window.recaller.account.signOut({ force: false, removeBoard: false })`);
    const pending = res?.ok === false && res.code === 'PENDING' && res.pending >= 1;
    await js(`(() => { const c = document.querySelector('#account input[name="remove-board"]'); c.click(); })()`);
    await sleep(250);
    const blocked = await accUi();
    const waitText = blocked.text.includes(`Wait until everything is uploaded before removing the board from ${HERE}.`) && blocked.actions.includes('sync-now') && !blocked.actions.includes('sign-out-confirm');
    await accountShot('07b-sign-out-remove-blocked-deep');
    await actOrThrow('keep-syncing');
    await goOnline();
    await bothSynced();
    // (b) a plain sign-out
    const bytes = fs.readFileSync(A_DATA);
    await openSettings();
    await actOrThrow('sign-out');
    await view('sign-out');
    await actOrThrow('sign-out-confirm');
    await waitFor(async () => (await mainState()).state === 'signed-out', { timeout: 15000 });
    const aMark = aRequests.length;
    await sleep(3000);
    const plain = !fs.existsSync(path.join(A_DIR, 'sync', 'account.json')) && fs.readFileSync(A_DATA).equals(bytes) && aRequests.length === aMark;
    // (c) sign in again (same account: no question), then sign out removing the board
    await view('out');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC1.email);
    await fill('password', ACC1.password);
    await actOrThrow('submit-sign-in');
    const again = await aSynced(UID1, 20000);
    const settingsBefore = readJson(A_SETTINGS);
    // Nothing of the board may stay in Recaller's own files here: the unreadable copies 31 and 32 left (garbage, so
    // counted by name), and no note text anywhere (the Welcome's tips aside: the new seed has them too)
    const UNREADABLE = /^recaller-data\.unreadable-.+\.json$/;
    const unreadable = () => fs.readdirSync(A_DIR).filter((n) => UNREADABLE.test(n)).length;
    const unreadableBefore = unreadable();
    const oldTexts = [...new Set((aData()?.projects || []).filter((p) => p.name !== 'Welcome')
      .flatMap((p) => LISTS.flatMap((l) => (p[l] || []).map((x) => x.text))).filter((t) => typeof t === 'string' && t.length >= 24))];
    const recallerFiles = () => {
      const out = [];
      const walk = (f) => { let st = null; try { st = fs.statSync(f); } catch {} if (st?.isDirectory()) for (const n of fs.readdirSync(f)) walk(path.join(f, n)); else if (st) out.push(f); };
      for (const n of fs.readdirSync(A_DIR)) if (n.startsWith('recaller-') || ['images', 'backups', 'sync'].includes(n)) walk(path.join(A_DIR, n));
      return out;
    };
    await openSettings();
    await actOrThrow('sign-out');
    await view('sign-out');
    await js(`document.querySelector('#account input[name="remove-board"]').click()`);
    await sleep(200);
    const mark = Date.now();
    let reloaded = false;
    wc.once('did-finish-load', () => { reloaded = true; });
    await actOrThrow('sign-out-confirm');
    // Either the board goes at once (the page reloads), or main first names the unreadable copies 31 and 32 left
    // (PENDING with localOnly.unreadable, a 5.14 change in progress on 2026-10-01): the page then names them by the
    // checkbox and unticks it, and ticking it again agrees to remove them with the board.
    const removeTicked = () => js(`document.querySelector('#account input[name="remove-board"]')?.checked ?? null`);
    const step = await waitFor(async () => {
      if (reloaded) return 'removed';
      const u = await accUi();
      return u.view === 'sign-out' && !u.busy && /unreadable cop/i.test(u.text) && (await removeTicked()) === false ? 'named' : null;
    }, { timeout: 15000, every: 100 });
    let namedCopies = null;
    if (step === 'named') {
      namedCopies = { label: await js(`document.querySelector('#account [data-slot="remove-label"]')?.textContent ?? ''`), note: (await accUi()).note };
      wc.once('did-finish-load', () => { reloaded = true; });
      await js(`document.querySelector('#account input[name="remove-board"]').click()`);
      await sleep(200);
      await actOrThrow('sign-out-confirm');
      await waitFor(() => reloaded, { timeout: 15000, every: 100 });
    }
    await sleep(1200);
    const d = aData();
    const welcome = d?.projects?.length === 1 && d.projects[0].name === 'Welcome' && d.projects[0].notes.length === 10 && (await colIds()).length === 1;
    const imagesGone = !fs.existsSync(path.join(A_DIR, 'images')) || fs.readdirSync(path.join(A_DIR, 'images')).length === 0;
    const backupsGone = !fs.existsSync(path.join(A_DIR, 'backups'));
    const strip = (s) => { const { bounds, maximized, ...rest } = s || {}; return rest; };
    const settingsKept = fs.existsSync(A_SETTINGS) && same(strip(readJson(A_SETTINGS)), strip(settingsBefore));
    const syncState = !fs.existsSync(path.join(A_DIR, 'sync', 'state.json')) && !fs.existsSync(path.join(A_DIR, 'sync', 'shadow.json')) && aSync('device.json')?.lastUid === null;
    const toast = await waitToast(mark, 'Signed out. This board was removed from this computer; your account keeps it.', 6000);
    const traces = recallerFiles().filter((f) => {
      let t = '';
      try { t = fs.readFileSync(f, 'utf8'); } catch { return false; } // a .tmp renamed meanwhile
      return oldTexts.some((x) => t.includes(JSON.stringify(x).slice(1, -1)));
    }).map((f) => path.relative(A_DIR, f));
    const leftovers = { unreadable: [unreadableBefore, unreadable()], texts: oldTexts.length, traces };
    const noneLeft = unreadableBefore > 0 && unreadable() === 0 && oldTexts.length >= 5 && traces.length === 0;
    const ok = Boolean(waiting) && pending && waitText && plain && Boolean(again) && welcome && imagesGone && backupsGone && settingsKept && syncState && noneLeft && Boolean(toast);
    return { ok, detail: JSON.stringify({ waitingText: Boolean(waiting), result: res, removeBlocked: waitText, plainSignOut: plain, signedInAgain: Boolean(again), removal: namedCopies ? { step, ...namedCopies } : step, welcome, imagesGone, backupsGone, settingsKept, syncState, leftovers, toast: Boolean(toast) }) };
  });

  // ================================================================ 39–40: deleting the account (40 runs inside 39, which reports after it)
  let wrongPassword = null;
  let deletedOk = null;
  let deleteClickedAt = Date.now();
  {
    await openSettings();
    await view('out');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC1.email);
    await fill('password', ACC1.password);
    await actOrThrow('submit-sign-in');
    await waitFor(async () => same(aData()?.projects?.map((p) => p.id), liveProjectIds(UID1)), { timeout: 20000 }); // the pristine Welcome here gives way to the account's board
    await aSynced(UID1, 20000);
    await bothSynced();
  }
  const bytesBeforeDelete = fs.readFileSync(A_DATA);
  await spec(40, 'Deletion gating: with the mock paused after deleting: true, B\'s commit, device write and upload are all refused, and B shows "being deleted"', async () => {
    await openSettings();
    await actOrThrow('delete');
    const panel = await view('delete');
    const body = panel?.text.includes(`This deletes your account and everything in it from Google Cloud: ${liveProjectIds(UID1).length} projects, ${liveNoteIds(UID1).length} notes and 2 pictures. ${HERE_CAP} keeps its own copy of the board.`);
    await accountShot('08-delete-panel-deep');
    await fill('password', 'not-the-password');
    await fill('confirm-delete', 'DELETE');
    const wrong = await submitAndWait('delete-confirm', 'signInWithPassword', 10000);
    wrongPassword = { text: wrong?.error, stillThere: Boolean(headOf(UID1)) && Boolean(mock.user(ACC1.email)), body };
    // B's raw writes, first while the account can take them (the control), then while it is being deleted
    const bDev = B.readDevice()?.id;
    const tryCode = async (fn) => { try { await fn(); return 'ok'; } catch (err) { return err?.code || String(err); } };
    const bump = async () => {
      const h = await B.firestore.get(`users/${UID1}`);
      const rev = Number(h.fields.rev.integerValue) + 1;
      return B.firestore.commit([{
        update: { name: B.firestore.name(`users/${UID1}`), fields: { rev: { integerValue: String(rev) }, lastDevice: { stringValue: bDev }, board: h.fields.board, stats: h.fields.stats } },
        updateMask: { fieldPaths: ['rev', 'lastDevice', 'board', 'stats'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { updateTime: h.updateTime },
      }]);
    };
    const deviceWrite = async () => {
      const cur = await B.firestore.get(`users/${UID1}/devices/${bDev}`);
      const S = (v) => ({ stringValue: v });
      const { lastSeenAt, ...fields } = cur?.fields || {
        name: S(IS_MAC ? 'Windows PC' : 'Mac'), platform: S(B_PLATFORM), appVersion: S('1.17.0'), lastRev: { integerValue: '0' },
        view: S('{}'), drafts: S('{}'), settings: { mapValue: { fields: {} } },
      };
      return B.firestore.commit([{ update: { name: B.firestore.name(`users/${UID1}/devices/${bDev}`), fields }, updateTransforms: [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }] }]);
    };
    const upload = () => B.storage.upload(`users/${UID1}/images/${crypto.randomBytes(16).toString('hex')}.png`, PICS[`${IMG2}.png`]);
    const control = { commit: await tryCode(bump), device: await tryCode(deviceWrite), upload: await tryCode(upload) };
    await bothSynced();
    const pause = mock.pauseAfter('deleting');
    await fill('password', ACC1.password);
    deleteClickedAt = Date.now();
    await actOrThrow('delete-confirm');
    const hit = await Promise.race([pause.hit, sleep(15000).then(() => null)]);
    const gated = { commit: await tryCode(bump), device: await tryCode(deviceWrite), upload: await tryCode(upload) };
    const bDeleting = await waitFor(() => B.status()?.phase === 'deleting-elsewhere', { timeout: 10000 });
    pause.resume();
    const deleted = await waitFor(async () => (await mainState()).state === 'signed-out', { timeout: 30000 });
    deletedOk = { deleted: Boolean(deleted) };
    const ok = Boolean(hit) && same(control, { commit: 'ok', device: 'ok', upload: 'ok' }) && same(gated, { commit: 'PERMISSION', device: 'PERMISSION', upload: 'PERMISSION' }) && Boolean(bDeleting);
    return { ok, detail: JSON.stringify({ paused: Boolean(hit), before: control, during: gated, bPhase: B.status()?.phase }) };
  });

  await spec(39, 'Delete account: a wrong password gives its text; then the mock has no documents or objects for the uid and no Auth user; A\'s board is unchanged and A is signed out; B shows "This account was deleted."', async () => {
    const toast = await waitToast(deleteClickedAt, `Account deleted. Your board stays on ${HERE}.`, 10000);
    const d = docs(UID1);
    const empty = !d.head && !Object.keys(d.projects).length && !Object.keys(d.notes).length && !Object.keys(d.trash).length && !Object.keys(d.devices).length && !Object.keys(d.other).length;
    const noObjects = Object.keys(mock.objects(UID1)).length === 0;
    const noUser = !mock.user(ACC1.email);
    const unchanged = fs.readFileSync(A_DATA).equals(bytesBeforeDelete);
    const u = await accUi();
    await B.syncNow();
    const bDeleted = await waitFor(() => B.accountState().state === 'deleted', { timeout: 15000 });
    const ok = wrongPassword?.text === 'Password is wrong.' && wrongPassword.stillThere && wrongPassword.body && deletedOk?.deleted && Boolean(toast) && empty && noObjects && noUser && unchanged && u.state === 'signed-out' && Boolean(bDeleted);
    return { ok, detail: JSON.stringify({ wrong: wrongPassword, toast: Boolean(toast), empty, noObjects, noUser, boardUnchanged: unchanged, aState: u.state, b: B.accountState().state }) };
  });

  // ================================================================ 42–43, then 41 (the app quits)
  await closeSettings();
  await spec(42, 'Security: no token in any IPC result or in window.recaller; the CSP still says connect-src \'none\'; no renderer console errors; the safeStorage tripwires were never hit; nothing went beyond the loopback mock, and every request went through net.fetch with http.js\'s options', async () => {
    const shape = await js(`(() => { const walk = (o, p) => Object.keys(o).flatMap((k) => typeof o[k] === 'object' && o[k] ? walk(o[k], p + k + '.') : [p + k]); return walk(window.recaller, ''); })()`);
    const exposed = shape.filter((k) => /token|password|secret|key$/i.test(k.split('.').pop()) && !/^(account\.|sync\.)?(signUp|signIn|resetPassword)$/.test(k));
    scanForSecrets('account:get (now)', await js(`window.recaller.account.get()`));
    const csp = await js(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''`);
    const sealed = sealingTrips();
    // every request A made all run (Identity, Secure Token, Firestore, Storage) went through net.fetch with http.js's options
    const bare = aRequests.filter((r) => !(r.opts.credentials === 'omit' && r.opts.cache === 'no-store' && r.opts.redirect === 'error' && r.opts.signal === true));
    const viaNet = aRequests.length > 100 && bare.length === 0;
    const ok = leaks.length === 0 && scanned > 50 && exposed.length === 0 && /connect-src 'none'/.test(csp) && errors.length === 0 && sealed.length === 0 && outside.length === 0 && viaNet;
    return { ok, detail: JSON.stringify({ leaks: leaks.slice(0, 5), scanned, exposed, csp: /connect-src 'none'/.test(csp), consoleErrors: errors.slice(0, 5), tripwires: sealed, beyondTheMock: outside.slice(0, 3), netFetch: { requests: aRequests.length, withoutOptions: bare.slice(0, 3).map((r) => `${r.method} ${r.url.split('?')[0].slice(-60)}`) } }) };
  });

  await spec(43, IS_MAC ? 'Mac only: the Dock is hidden, focus is never stolen (macState), and the keychain is untouched' : 'Windows: the window never took focus, and DPAPI (safeStorage) was never touched', async () => {
    const untouched = trips.length === 0;
    const dock = IS_MAC ? app.dock?.isVisible?.() === false : true;
    const ok = dock && focusSeen.samples > 100 && focusSeen.focused === 0 && macState.hides === 0 && untouched && opened.length === 0;
    return { ok, detail: JSON.stringify({ dockHidden: dock, focusSamples: focusSeen.samples, focusedSamples: focusSeen.focused, hides: macState.hides, safeStorageCalls: trips, openExternal: opened.length }) };
  });

  // 41: signed in (the second account), a change still waiting, then the app quits
  let quitMark = 0;
  let quitAt = 0;
  try {
    await openSettings();
    await view('out');
    await actOrThrow('sign-in');
    await view('sign-in');
    await fill('email', ACC2.email);
    await fill('password', ACC2.password);
    await actOrThrow('submit-sign-in');
    await waitFor(async () => { const u = await accUi(); return u.view === 'choice' ? u : null; }, { timeout: 15000 });
    await actOrThrow('choice-use-account');
    await aSynced(UID2, 20000);
    await closeSettings();
    B.kill();
    mock.fail({ service: 'firestore', op: 'commit', status: 503, times: 1 }); // the change's first push fails: it is still waiting
    const mark = mock.log.length;
    const cols = await colIds();
    await addPrompt(cols[0], 'Written just before quitting');
    await waitFor(() => mock.log.slice(mark).some((e) => e.op === 'commit' && e.status === 503), { timeout: 8000, every: 5 });
  } catch (err) {
    console.log(`INFO  check 41's setup failed: ${err.message}`);
  }
  let finished = false;
  const finish = async (why) => {
    if (finished) return;
    finished = true;
    const after = mock.log.slice(quitMark).filter((e) => e.op === 'commit' && e.uid === UID2 && e.rev !== undefined && e.status === 200);
    const first = after[0];
    const within = first ? first.at - quitAt : null;
    const there = Object.values(docs(UID2).notes).some((n) => n.text === 'Written just before quitting' && !n._sync.deleted);
    check(41, 'Quit with changes waiting: the final push appears in the log within 1.5 s, and the app exits', why === 'will-quit' && Boolean(first) && within <= 1500 && there,
      JSON.stringify({ exited: why, finalPush: Boolean(first), ms: within, inAccount: there }));
    const failed = results.filter((r) => !r.ok);
    console.log(`INFO  screenshots in ${SHOTS}: ${shots.join(', ')}`);
    console.log(`INFO  failed: ${failed.map((r) => r.n).join(', ') || 'none'}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await mock.close().catch(() => {});
    app.exit(failed.length ? 1 : 0);
  };
  app.once('will-quit', (e) => { e.preventDefault(); finish('will-quit'); });
  setTimeout(() => finish('timeout: the app did not quit within 10 s'), 10000).unref?.();
  quitMark = mock.log.length;
  quitAt = Date.now();
  app.quit();
}
