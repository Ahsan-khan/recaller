'use strict';
// Captures a close-up of the column headers (project names + Used/Augmented labels).
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
fs.writeFileSync(path.join(DATA_DIR, 'recaller-data.json'), JSON.stringify({ version: 2, prefs: { density: 'slim' }, projects: [
  { ...proj('a', 'Wildfire RL', 'monstera'), notes: [note('a1', 'Review the fire spread model — wind should bias ignition probability.'), hl(note('a2', 'Benchmark heuristic_ai vs PPO over 50 seeded maps.'), 'amber'), note('a3', 'Summarize the websocket protocol in 10 bullets.')],
    used: [note('u1', 'Write the stage two memory doc'), hl(note('u2', 'Refactor agents.py with typed dataclasses'), 'rose')],
    combined: [note('c1', 'You are an expert RL engineer.'), note('c2', 'Here is the current reward function:\n\nreward = -burned_cells')] },
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
require(process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js'));
app.whenReady().then(async () => {
  await sleep(2200);
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const img = await wc.capturePage({ x: 0, y: 48, width: 1160, height: 700 });
  fs.writeFileSync(path.join(SCRATCH, `${OUT}.png`), img.toPNG());
  const zoom = await wc.capturePage({ x: 10, y: 55, width: 580, height: 240 });
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-zoom.png`), zoom.resize({ width: 1160, quality: 'best' }).toPNG());
  await wc.executeJavaScript("document.querySelector('#open-settings').click()");
  await sleep(700);
  const r = await wc.executeJavaScript("(() => { const b = document.querySelector('.modal-card').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: 260 }; })()");
  fs.writeFileSync(path.join(SCRATCH, `${OUT}-settings.png`), (await wc.capturePage(r)).toPNG());
  console.log('captured');
  app.exit(0);
});
