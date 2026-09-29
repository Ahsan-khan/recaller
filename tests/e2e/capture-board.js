'use strict';
// Renders a fixed sample board for visual review: the stages (prompts, Cooked, Served),
// highlights, a long two-line name, a resized column, the top bar, Settings and the colour menu.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, screen } = require('electron');

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const DATA_DIR = path.join(SCRATCH, 'data4');
const OUT = process.env.OUT || 'headers';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const now = Date.now();
const note = (id, text, extra = {}) => ({ id, text, images: [], createdAt: now - 7e6, updatedAt: now - 7e6, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const proj = (id, name, color, used = []) => ({ id, name, color, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now, notes: [note(id + 'n', `A prompt in ${name}`)], used });
const hl = (n, h) => ({ ...n, highlight: h });
fs.writeFileSync(path.join(DATA_DIR, 'recaller-data.json'), JSON.stringify({ version: 2, prefs: { density: 'slim', colWidths: { c: 330 } }, projects: [
  { ...proj('a', 'Wildfire RL', 'monstera'), notes: [note('a1', 'Review the fire spread model — wind should bias ignition probability.'), hl(note('a2', 'Benchmark heuristic_ai vs PPO over 50 seeded maps.'), 'amber'), note('a3', 'Summarize the websocket protocol in 10 bullets.')],
    used: [note('u1', 'Write the stage two memory doc'), hl(note('u2', 'Refactor agents.py with typed dataclasses'), 'rose')],
    combined: [note('c1', 'You are an expert RL engineer.'), note('c2', 'Here is the current reward function:\n\nreward = -burned_cells'),
      ...['Profile the rollout loop and report the slowest three calls.', 'Add a seed argument to every environment constructor.', 'Plot containment time against wind speed.', 'Write a README section on reproducing the benchmark.', 'List every magic number in agents.py with a suggested name.'].map((t, i) => note(`c${i + 3}`, t))] },
  { ...proj('b', 'Computer Vision and Robotics Research Notes', 'moss'), used: [note('u3', 'Label studio setup steps')] },
  proj('c', 'Website', 'sun'),
  proj('d', 'Ideas', 'orchid'),
] }));
fs.writeFileSync(path.join(DATA_DIR, 'recaller-settings.json'), JSON.stringify({ hotkey: '', shotHotkey: '', theme: 'deep', lastVersion: '44.4.5' }));

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
process.env.RECALLER_DATA_DIR = DATA_DIR;
const OFF = () => {
  const c = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(c).workArea;
  return { x: c.x - wa.x > wa.width / 2 ? wa.x - 1300 : wa.x + wa.width - 60, y: wa.y, width: 1360, height: 820 };
};
app.on('browser-window-created', (_e, w) => {
  const showInactive = w.showInactive.bind(w);
  w.show = () => { w.setBounds(OFF()); showInactive(); w.setBounds(OFF()); };
});
const APP_MAIN = process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js');
if (!fs.existsSync(APP_MAIN)) { console.error(`HARNESS FAIL: no app at ${APP_MAIN} (APP_MAIN must be a Windows path)`); process.exit(1); }
require(APP_MAIN);
app.whenReady().then(async () => {
  await sleep(2200);
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const js = (code) => wc.executeJavaScript(code);
  // open the Notes list under the Cooked note and the Served text of the first column
  await js("document.querySelector('.column[data-id=\"a\"] .aug-parts-btn').click(); document.querySelector('.column[data-id=\"a\"] .final-parts-btn').click()");
  await sleep(300);
  const img = await wc.capturePage({ x: 0, y: 0, width: 1360, height: 780 });
  fs.writeFileSync(path.join(SCRATCH, `${OUT}.png`), img.toPNG());
  const zoom = await wc.capturePage({ x: 10, y: 55, width: 580, height: 240 });
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-zoom.png`), zoom.resize({ width: 1160, quality: 'best' }).toPNG());
  await js("document.querySelector('.column[data-id=\"a\"] .col-menu').click()");
  await sleep(300);
  const m = await js("(() => { const b = document.querySelector('.menu').getBoundingClientRect(); return { x: Math.round(b.left) - 4, y: Math.round(b.top) - 4, width: Math.round(b.width) + 8, height: Math.round(b.height) + 8 }; })()");
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-menu.png`), (await wc.capturePage(m)).toPNG());
  await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(200);
  await js("document.querySelector('#open-settings').click()");
  await sleep(700);
  const r = await js("(() => { const b = document.querySelector('#settings .modal-card').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: 400 }; })()");
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-settings.png`), (await wc.capturePage(r)).toPNG());
  await js("document.querySelector('#settings').close(); document.querySelector('#open-help').click()");
  await sleep(700);
  const h = await js("(() => { const b = document.querySelector('#help .modal-card').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(Math.min(b.height, 780)) }; })()");
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-help.png`), (await wc.capturePage(h)).toPNG());
  console.log('captured');
  app.exit(0);
});
