'use strict';
// Drives the real Recaller app with synthetic input against a temp data dir,
// a mock OpenAI server (streamed SSE replies) and a fake microphone that plays
// speech-like bursts separated by pauses.

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { app, BrowserWindow, clipboard, screen } = require('electron');
const { IS_MAC, MOD, macRect, quiet, macState } = require('./mac-harness'); // Mac-safe run; inert on Windows

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const DATA_DIR = path.join(SCRATCH, 'data2');
const SHOTS = path.join(SCRATCH, 'shots2');
const APP_MAIN = process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js');
if (!fs.existsSync(APP_MAIN)) { console.error(`HARNESS FAIL: no app at ${APP_MAIN}${IS_MAC ? '' : ' (APP_MAIN must be a Windows path)'}`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

// ---- fake microphone: 0.4s silence, then [1.8s voice, 1.1s pause] × 2, looping
function speechWav(file) {
  const rate = 48000;
  const parts = [[0.4, 0], [1.8, 1], [1.1, 0], [1.8, 1], [1.4, 0]];
  const total = parts.reduce((s, [d]) => s + d, 0);
  const n = Math.round(total * rate);
  const pcm = Buffer.alloc(n * 2);
  let i = 0;
  let phase = 0;
  for (const [dur, voiced] of parts) {
    const len = Math.round(dur * rate);
    for (let k = 0; k < len; k++, i++) {
      const t = k / rate;
      let v = (Math.random() - 0.5) * 0.002;
      if (voiced) {
        const f0 = 130 + 25 * Math.sin(2 * Math.PI * 0.7 * t);
        phase += (2 * Math.PI * f0) / rate;
        const env = 0.45 + 0.55 * Math.abs(Math.sin(Math.PI * 4.5 * t));
        v += env * 0.32 * (Math.sin(phase) + 0.6 * Math.sin(2 * phase) + 0.4 * Math.sin(3 * phase) + 0.25 * Math.sin(5 * phase)) / 2.25;
      }
      pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}
const WAV = path.join(SCRATCH, 'speech.wav');
speechWav(WAV);

const now = Date.now();
const n = (text, ago = 0, extra = {}) => ({ id: Math.random().toString(36).slice(2), text, images: [], createdAt: now - ago, updatedAt: now - ago, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const moreProjects = ['Ideas', 'Writing', 'Research', 'Admin'].map((name, i) => ({
  id: `px${i}`, name, color: ['sun', 'orchid', 'fern', 'clay'][i], usedCollapsed: false, draft: '', draftImages: [], createdAt: now,
  notes: [n(`Placeholder note for ${name}`, 3600e3 * (i + 1))], used: [],
}));
fs.writeFileSync(path.join(DATA_DIR, 'recaller-data.json'), JSON.stringify({
  version: 1,
  projects: [
    { id: 'p1', name: 'Wildfire RL', color: 'monstera', usedCollapsed: false, draft: '', createdAt: now, notes: [
      n('Review the fire spread model in fire_model.py — wind should bias ignition probability, not just direction. Propose a fix with a unit test.', 3600e3),
      n('Benchmark heuristic_ai vs PPO agent over 50 seeded maps; report mean burned area and containment time as a table.', 7200e3, { copied: 3 }),
      n('Summarize the websocket protocol between backend/api/websocket.py and the frontend in 10 bullets.', 86400e3),
      n('Refactor agents.py so each agent exposes act(obs) → action with typed dataclasses.', 2 * 86400e3),
    ], used: [
      n('Write the stage two project memory doc from implementation_plan.md', 3 * 86400e3, { usedAt: now - 3600e3, copied: 1 }),
    ] },
    { id: 'p2', name: 'Website', color: 'eucalyptus', usedCollapsed: false, draft: '', createdAt: now, notes: [
      n('Make the hero section responsive down to 360px and fix the nav overlap on mobile.', 600e3),
      n('Write alt text for every image in /public/gallery and add loading="lazy".', 5400e3),
      n('Draft a friendly 404 page with a search box and three helpful links.\n\nTone: warm, short, a little playful.', 10 * 86400e3),
    ], used: [] },
    { id: 'p3', name: 'Computer Vision', color: 'moss', usedCollapsed: true, draft: '', createdAt: now, notes: [
      n('Explain why my YOLO model overfits after epoch 40 and suggest 3 augmentations.', 1800e3),
      n('Convert the dataset annotations from COCO to YOLO format with a script.', 4 * 86400e3),
    ], used: [n('Label studio setup steps', 9 * 86400e3, { usedAt: now - 86400e3 })] },
    ...moreProjects,
    // 1.20: the notepad (a hidden project), with another computer's version waiting under the page.
    // 1.20.4: it carries 1.18–1.19's per-computer `localMinimized`, which start-up turns into `minimized`.
    { id: 'pad', name: 'Notepad', color: 'slate', notepad: true, localMinimized: true, usedCollapsed: false, draft: '', draftImages: [], createdAt: now, notes: [
      n('Seeded page', 60e3),
      n('From the other computer', 30e3, { syncConflict: { of: 'x', device: 'b0'.repeat(16), at: now } }),
    ], used: [] },
  ],
}, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'recaller-settings.json'), JSON.stringify({
  apiKey: { plain: 'sk-test-harness-1234' }, hotkey: '', shotHotkey: '', bounds: { x: 60, y: 40, width: 1360, height: 860 },
}));

// ---- mock OpenAI (streams when asked, like the real API)
const received = [];
let mockMode = 'ok';
let phrase = 0;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const text = body.toString('latin1');
    const field = (name) => (text.match(new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
    const entry = { url: req.url, auth: req.headers.authorization, bytes: body.length, model: field('model'), stream: field('stream'), prompt: field('prompt'), fileHeader: (text.match(/name="file"; filename="[^"]+"\r\nContent-Type: [^\r]+/) || [])[0] };
    received.push(entry);
    if (mockMode === 'fail500') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'overloaded' } }));
      return;
    }
    phrase += 1;
    const reply = `Phrase ${['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][phrase - 1] || phrase}.`;
    entry.reply = reply;
    if (entry.stream === 'true') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const word of reply.split(/(?<= )/)) {
        res.write(`data: ${JSON.stringify({ type: 'transcript.text.delta', delta: word })}\n\n`);
        await sleep(90);
      }
      res.end(`data: ${JSON.stringify({ type: 'transcript.text.done', text: reply })}\n\n`);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: reply }));
    }
  });
});

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', WAV);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Mac: the sandboxed audio service can't read the fake-mic WAV
app.commandLine.appendSwitch('disable-features', IS_MAC ? 'CalculateNativeWinOcclusion,AudioServiceSandbox' : 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

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

server.listen(0, '127.0.0.1', () => {
  process.env.RECALLER_DATA_DIR = DATA_DIR;
  process.env.RECALLER_OPENAI_BASE = `http://127.0.0.1:${server.address().port}/v1`;
  app.on('browser-window-created', (_e, w) => {
    const showInactive = w.showInactive.bind(w);
    w.show = () => { w.setBounds(offscreenRect()); showInactive(); w.setBounds(offscreenRect()); }; // never on the user's screen, never focused
    if (placed++ === 0) {
      w.setBounds(offscreenRect());
    } else {
      // screenshot overlay: keep it off the user's screen too
      w.once('show', () => w.setBounds(offscreenRect(1200, 700)));
    }
  });
  quiet();
  require(APP_MAIN);
  app.whenReady().then(run).catch((err) => { console.error('HARNESS FAIL', err); app.exit(1); });
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function run() {
  await sleep(400);
  const win = BrowserWindow.getAllWindows()[0];
  const wc = win.webContents;
  win.setBounds(offscreenRect()); // the app re-applies its saved position on creation; move it out of the way now
  wc.setBackgroundThrottling(false);
  const errors = [];
  wc.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const message = e.message ?? e.params?.message;
    if (level === 'error' || level === 3) errors.push(message);
  });
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await sleep(900);

  const js = (code) => wc.executeJavaScript(code);
  const rect = (sel, i = 0) => js(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 }; })()`);
  const shot = async (name) => { const img = await wc.capturePage(); fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.toPNG()); };
  const mouseOn = (target) => (type, x, y, extra = {}) => target.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const mouse = mouseOn(wc);
  const move = (x, y) => mouse('mouseMove', x, y, { modifiers: ['leftButtonDown'] });
  const click = async (x, y) => { mouse('mouseMove', x, y, { modifiers: [] }); mouse('mouseDown', x, y); await sleep(40); mouse('mouseUp', x, y); };
  const clickSel = async (sel, i = 0) => { const r = await rect(sel, i); if (!r) throw new Error(`no element ${sel}`); await click(r.cx, r.cy); return r; };
  async function drag(x0, y0, x1, y1, steps = 14, delay = 16, mv = move) {
    for (let i = 1; i <= steps; i++) { mv(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(delay); }
  }
  const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const type = async (text) => { for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(5); } };
  const texts = (sel) => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent)`);
  // 1.20.1: Eaten, the widget, Reset column widths, help and settings sit in the top bar's ☰ menu
  const fromMenu = async (sel) => { await clickSel('#app-menu-btn'); await sleep(200); return clickSel(sel); };
  const colTexts = (id, list = 'active') => texts(`.column[data-id="${id}"] .${list}-list .card-text`);
  const composerValue = () => js(`document.querySelector('.composer textarea')?.value ?? null`);
  const augOf = (id) => js(`document.querySelector('.column[data-id="${id}"] .aug-text').textContent`);
  const augCount = (id) => js(`document.querySelector('.column[data-id="${id}"] .used-count').textContent`);

  await shot('01-board');

  // ---------------------------------------------------------------- layout
  const colW = (await rect('.column[data-id="p1"]')).w;
  check('slim columns by default (~268px)', colW >= 262 && colW <= 274, `${colW}px`);
  check('New prompt bar sits under the header, not next to the name', Boolean(await rect('.column[data-id="p1"] .col-new .new-prompt')) && !(await rect('.column[data-id="p1"] .col-head .col-add')));
  await clickSel('.column[data-id="p1"] .new-prompt');
  await sleep(250);
  check('New prompt bar opens the editor in its place', await js(`!!document.querySelector('.column[data-id="p1"] .col-compose .composer') && document.querySelector('.column[data-id="p1"] .col-new').hidden`));
  key('Escape');
  await sleep(250);

  // saving a new prompt closes the editor and brings New prompt | Dictate back
  await clickSel('.column[data-id="p1"] .col-add');
  await sleep(200);
  await type('Temporary prompt');
  key('Enter', [MOD]);
  await sleep(400);
  const afterSave = await js(`[!!document.querySelector('.column[data-id="p1"] .col-compose .composer'), document.querySelector('.column[data-id="p1"] .col-new').hidden]`);
  check('saving a new prompt closes the editor and shows the buttons again', !afterSave[0] && !afterSave[1] && (await colTexts('p1')).pop() === 'Temporary prompt', JSON.stringify(afterSave));
  key('Z', [MOD]); // take "Temporary prompt" out again
  await sleep(300);

  // hovering a prompt offers just two actions: highlight, and the main one, "↓ Cooked" (edit is right-click / E)
  const acts = await js(`[...document.querySelectorAll('.column[data-id="p1"] .active-list .card-actions')[0].children].map((b) => b.className + '|' + b.textContent.trim())`);
  check('hovering a prompt offers highlight and a prominent "↓ Cooked" (no edit button)', acts.length === 2 && /act-hl/.test(acts[0]) && /act-used act-primary\|Cooked$/.test(acts[1]), JSON.stringify(acts));

  // ---------------------------------------------------------------- Cooking: a stage header like the others; New prompt | Dictate in halves
  const bar = await js(`(() => {
    const c = document.querySelector('.column[data-id="p1"]');
    const a = c.querySelector('.col-add').getBoundingClientRect();
    const m = c.querySelector('.col-mic').getBoundingClientRect();
    const lbl = c.querySelector('.col-add .np-label');
    return { add: Math.round(a.width), mic: Math.round(m.width), micLabel: c.querySelector('.col-mic').textContent.trim(), addLabel: c.querySelector('.col-add .lbl-long').textContent, fits: lbl.scrollWidth <= lbl.clientWidth + 1 };
  })()`);
  check('New text and Dictate share the bar in equal halves, both fully labelled', Math.abs(bar.add - bar.mic) <= 1 && bar.mic > 100 && bar.micLabel === 'Dictate' && bar.addLabel === 'New text' && bar.fits, JSON.stringify(bar));
  const cook = await js(`[document.querySelector('.column[data-id="p1"] .cook-head').textContent.trim(), !!document.querySelector('.column[data-id="p1"] .col-head .col-count')]`);
  check('prompts sit under a "Cooking · n" header; the count left the column title', /^Cooking\s*· 4$/.test(cook[0]) && !cook[1], JSON.stringify(cook));
  const savedProject = (id) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).projects.find((p) => p.id === id);
  await clickSel('.column[data-id="p2"] .cook-head');
  await sleep(600);
  const folded = await js(`[document.querySelector('.column[data-id="p2"]').classList.contains('cooking-collapsed'), getComputedStyle(document.querySelector('.column[data-id="p2"] .active-list')).display]`);
  const foldedSaved = savedProject('p2').notesCollapsed === true;
  await clickSel('.column[data-id="p2"] .cook-head');
  await sleep(600);
  check('clicking "Cooking" folds the prompts away and back (remembered)', folded[0] && folded[1] === 'none' && foldedSaved && !('notesCollapsed' in savedProject('p2')) && await js(`getComputedStyle(document.querySelector('.column[data-id="p2"] .active-list')).display !== 'none'`), JSON.stringify(folded));
  await clickSel('.column[data-id="p3"] .cook-head');
  await sleep(300);
  await clickSel('.column[data-id="p3"] .new-prompt');
  await sleep(200);
  await type('Quick one');
  key('Enter', [MOD]);
  await sleep(400);
  key('Escape');
  await sleep(250);
  check('a new prompt opens a folded Cooking so you can see it', !(await js(`document.querySelector('.column[data-id="p3"]').classList.contains('cooking-collapsed')`)) && (await colTexts('p3')).pop() === 'Quick one');
  key('Z', [MOD]); // remove "Quick one" again
  await sleep(300);
  // long project name: wraps to two lines and never runs under the options button
  await js(`document.querySelector('.column[data-id="p3"] .col-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(150);
  await js(`(() => { const i = document.querySelector('.column[data-id="p3"] .col-name-input'); i.value = 'Computer Vision and Robotics Research Notes for the Thesis'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(250);
  const nameBox = await rect('.column[data-id="p3"] .col-name');
  const menuBox = await rect('.column[data-id="p3"] .col-menu');
  check('long project names wrap to two lines, clear of the options button', nameBox.h > 30 && nameBox.h < 44 && nameBox.x + nameBox.w <= menuBox.x + 1, `name ${Math.round(nameBox.w)}×${Math.round(nameBox.h)}, gap ${Math.round(menuBox.x - (nameBox.x + nameBox.w))}`);
  key('Z', [MOD]);
  await sleep(250);
  const headBg = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .col-head')).backgroundImage`);
  const head2Bg = await js(`getComputedStyle(document.querySelector('.column[data-id="p2"] .col-head')).backgroundImage`);
  const usedBg = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .used')).backgroundColor`);
  const cardBg = await js(`getComputedStyle(document.querySelector('.card')).backgroundColor`);
  check('columns and sections have distinct colours', headBg !== head2Bg && usedBg !== cardBg, `${headBg} | ${head2Bg} | used ${usedBg} | card ${cardBg}`);
  const titleFamily = await js(`getComputedStyle(document.querySelector('.col-name')).fontFamily`);
  check('column titles use the new default font, Instrument Sans', /Instrument Sans/.test(titleFamily) && await js(`document.fonts.check('650 16px "Instrument Sans"')`), titleFamily);
  // 1.6 took the top bar's + Project button away; 1.18 brought a slim + back (#new-column), next to undo
  check('the top bar has a slim + for a new project, and the board keeps its "+ New project" tile', await js(`!!document.querySelector('.topbar-actions #new-column.icon-btn') && !document.querySelector('#new-project') && !!document.querySelector('.add-column')`));
  const emptyAug = await js(`(() => { const s = getComputedStyle(document.querySelector('.column[data-id="p2"] .used')); return [s.backgroundColor, s.borderTopStyle]; })()`);
  const emptyHelp = await js(`getComputedStyle(document.querySelector('.column[data-id="p2"] .aug-empty')).display`);
  check('an empty Cooked section is just its quiet name: no block, no helper sentence at rest', emptyAug[0] === 'rgba(0, 0, 0, 0)' && emptyHelp === 'none', `${emptyAug.join(' ')} | helper ${emptyHelp}`);
  const bodies = await js(`['p1', 'p2', 'p3'].map((id) => getComputedStyle(document.querySelector('.column[data-id="' + id + '"]')).backgroundColor)`);
  check('every column shares one calm background (colour stays in the headers)', new Set(bodies).size === 1, bodies.join(' | '));
  // Cooked (1.13): a light section like Served, Ocean blue by default: no dark header band, a pale block, a blue accent
  const cookedLook = await js(`(() => { const c = document.querySelector('.column[data-id="p1"]'); const h = getComputedStyle(c.querySelector('.used-headrow')); return { band: h.backgroundImage, bandBg: h.backgroundColor, block: getComputedStyle(c.querySelector('.used')).backgroundColor, bar: getComputedStyle(c.querySelector('.aug-move')).backgroundColor, ocean: document.body.classList.contains('cooked-ocean') }; })()`);
  const rgbOf = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
  const hueOf = ([r, g, b]) => { [r, g, b] = [r / 255, g / 255, b / 255]; const mx = Math.max(r, g, b); const d = mx - Math.min(r, g, b); if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const barHue = hueOf(rgbOf(cookedLook.bar));
  check('Cooked is a light section, Ocean blue by default (no dark band, no brown)', cookedLook.ocean && cookedLook.band === 'none' && cookedLook.bandBg === 'rgba(0, 0, 0, 0)' && Math.min(...rgbOf(cookedLook.block)) > 200 && barHue > 190 && barHue < 235, `${cookedLook.block} | bar ${cookedLook.bar} hue ${Math.round(barHue)}`);
  await fromMenu('#open-help');
  await sleep(300);
  const helpText = await js(`document.querySelector('#help').open && document.querySelector('#help h2').textContent`);
  key('Escape');
  await sleep(250);
  key('F1');
  await sleep(300);
  const helpByKey = await js(`document.querySelector('#help').open`);
  key('Escape');
  await sleep(250);
  check('the ? button and F1 open "How Recaller works"; Esc closes it', helpText === 'How Recaller works' && helpByKey && !(await js(`document.querySelector('#help').open`)));

  // ---------------------------------------------------------------- copy, swipe, undo
  await clipboard.writeText('');
  const c1 = await rect('.column[data-id="p1"] .active-list .card');
  await click(c1.cx, c1.cy);
  await sleep(200);
  check('click copies note text', (await clipboard.readText()).startsWith('Review the fire spread model'));

  const before = (await colTexts('p2')).length;
  const s = await rect('.column[data-id="p2"] .active-list .card', 1);
  mouse('mouseMove', s.cx, s.cy, { modifiers: [] }); mouse('mouseDown', s.cx, s.cy);
  await drag(s.cx, s.cy, s.cx - 90, s.cy + 2, 8);
  await shot('02-swiping');
  await drag(s.cx - 90, s.cy + 2, s.cx - 170, s.cy + 3, 6);
  mouse('mouseUp', s.cx - 170, s.cy + 3);
  await sleep(600);
  check('swipe left deletes', (await colTexts('p2')).length === before - 1);
  check('undo button enabled after delete', !(await js(`document.querySelector('#undo').disabled`)));
  key('Z', [MOD]);
  await sleep(400);
  check('Ctrl+Z restores deleted note', (await colTexts('p2')).some((t) => t.startsWith('Write alt text')));
  key('Y', [MOD]);
  await sleep(300);
  check('Ctrl+Y redoes the delete', !(await colTexts('p2')).some((t) => t.startsWith('Write alt text')));
  await clickSel('#undo');
  await sleep(300);
  check('toolbar undo restores again', (await colTexts('p2')).some((t) => t.startsWith('Write alt text')));

  // ---------------------------------------------------------------- drag into Used, then undo the move
  const d = await rect('.column[data-id="p1"] .active-list .card', 1);
  const usedHead = await rect('.column[data-id="p1"] .used-head');
  mouse('mouseMove', d.cx, d.cy, { modifiers: [] }); mouse('mouseDown', d.cx, d.cy);
  await sleep(320);
  await drag(d.cx, d.cy, usedHead.cx, usedHead.cy + 40, 18, 18);
  await sleep(120);
  await shot('03-dragging');
  mouse('mouseUp', usedHead.cx, usedHead.cy + 40);
  await sleep(450);
  check('drag into Cooked joins the note into it', (await augOf('p1')).includes('Benchmark heuristic_ai'));
  check('move shows an Undo toast', (await texts('.toast')).some((t) => t.includes('Added to Cooked') && t.includes('Undo')));
  await shot('04-moved-toast');
  const undoToast = await rect('.toast-action');
  await click(undoToast.cx, undoToast.cy);
  await sleep(400);
  check('Undo on toast moves it back', (await colTexts('p1')).some((t) => t.startsWith('Benchmark heuristic_ai')) && !(await augOf('p1')).includes('Benchmark'));

  // ---------------------------------------------------------------- deep theme
  check('Deep colour theme is the default', await js(`document.body.classList.contains('theme-deep')`));
  const headRgb = await js(`(() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(document.querySelector('.column[data-id="p1"] .col-head')).backgroundImage.match(/(color\\([^)]*\\)|rgba?\\([^)]*\\))/g).pop(); return c.fillStyle; })()`);
  const hg = headRgb.startsWith('#') ? parseInt(headRgb.slice(3, 5), 16) / 255 : Number((headRgb.match(/srgb\s+[\d.]+\s+([\d.]+)/) || [])[1]);
  check('column headers are solid deep colour', hg > 0 && hg < 0.6, headRgb);
  // 1.16: the board sits in a rounded frame, inset from the window edges, with a gradient edge
  const frame = await js(`(() => { const st = document.querySelector('.stage'); const cs = getComputedStyle(st); const r = st.getBoundingClientRect(); const tb = document.querySelector('.topbar').getBoundingClientRect(); return { radius: parseFloat(cs.borderTopLeftRadius), bw: parseFloat(cs.borderTopWidth), left: r.left, right: innerWidth - r.right, bottom: innerHeight - r.bottom, gapTop: r.top - tb.bottom, edge: (cs.backgroundImage.match(/linear-gradient/g) || []).length >= 2 && cs.backgroundClip.split(',').pop().trim() === 'border-box', shell: getComputedStyle(document.body).backgroundColor === getComputedStyle(document.querySelector('.topbar')).backgroundColor }; })()`);
  check('the board has a rounded frame with a gradient edge, inset in a shell the colour of the top bar', frame.radius >= 10 && frame.bw >= 1 && frame.left >= 8 && frame.right >= 8 && frame.bottom >= 8 && frame.gapTop >= 0 && frame.edge && frame.shell, JSON.stringify(frame));

  // ---------------------------------------------------------------- stages: prompts → Cooked (one note) → Served (one text)
  // (data names: Cooked is `used`, Served is `combined`)
  const labels = await js(`[document.querySelector('.column[data-id="p1"] .used-head').textContent.trim(), document.querySelector('.column[data-id="p1"] .final-toggle').textContent.trim()]`);
  check('the stages are called Cooked and Served', labels[0].startsWith('Cooked') && labels[1] === 'Served', JSON.stringify(labels));
  check('Served section shows once Cooked has notes', await js(`!document.querySelector('.column[data-id="p1"] .final').hidden`));
  check('Served section hidden while Cooked and Served are empty', await js(`document.querySelector('.column[data-id="p2"] .final').hidden`));
  check('cards no longer carry the unused move-back button', !(await js(`!!document.querySelector('.card-wrap .act-back')`)));
  // work in the "Writing" column (px1): add three prompts, bring it into view
  await js(`document.querySelector('#board').scrollLeft = document.querySelector('.column[data-id="px1"]').offsetLeft - 20`);
  await sleep(300);
  for (const t of ['Alpha one', 'Beta two', 'Gamma three']) {
    await clickSel('.column[data-id="px1"] .new-prompt');
    await sleep(150);
    await type(t);
    key('Enter', [MOD]);
    await sleep(200);
    key('Escape');
    await sleep(150);
  }
  check('new prompts are added at the bottom of the list', JSON.stringify(await colTexts('px1')) === JSON.stringify(['Placeholder note for Writing', 'Alpha one', 'Beta two', 'Gamma three']), JSON.stringify(await colTexts('px1')));
  // moves the newest (bottom) prompt into Cooked
  const toAug = () => js(`[...document.querySelectorAll('.column[data-id="px1"] .active-list .act-used')].pop().click()`);
  await toAug(); await sleep(300); // Gamma three
  await toAug(); await sleep(300); // Beta two
  const aug1 = await augOf('px1');
  check('Cooked joins the moved prompts into ONE note, in the order added', (await js(`document.querySelectorAll('.column[data-id="px1"] .aug-note').length`)) === 1 && aug1 === 'Gamma three\n\nBeta two' && !(await colTexts('px1')).includes('Gamma three'), JSON.stringify(aug1));
  await clipboard.writeText('');
  await clickSel('.column[data-id="px1"] .aug-note .aug-text');
  await sleep(250);
  check('clicking the Cooked note copies it', (await clipboard.readText()) === aug1);
  const finalOf = (id) => js(`document.querySelector('.column[data-id="${id}"] .final-text').textContent`);
  // swipe the Cooked note left → appended to Served, Cooked empties
  const an = await rect('.column[data-id="px1"] .aug-note');
  mouse('mouseMove', an.cx, an.cy, { modifiers: [] }); mouse('mouseDown', an.cx, an.cy);
  await drag(an.cx, an.cy, an.cx - 90, an.cy + 2, 8);
  const revealsMove = await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-swiping')`);
  await drag(an.cx - 90, an.cy + 2, an.cx - 190, an.cy + 3, 6);
  mouse('mouseUp', an.cx - 190, an.cy + 3);
  await sleep(700);
  const final1 = await finalOf('px1');
  check('swiping the Cooked note left moves it down into Served', revealsMove && final1 === aug1 && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)), JSON.stringify(final1));
  // next batch via the Move to Served button: it combines with the Served text
  await toAug(); await sleep(300); // Alpha one
  await toAug(); await sleep(300); // Placeholder note for Writing
  const aug2 = await augOf('px1');
  await clickSel('.column[data-id="px1"] .aug-move');
  await sleep(700);
  const final2 = await finalOf('px1');
  check('Move to Served adds the whole Cooked note to the end of the Served text', final2 === `${final1}\n\n${aug2}`, JSON.stringify(final2));
  // a third batch dragged onto Served
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Delta four'); key('Enter', [MOD]); await sleep(200); key('Escape'); await sleep(150);
  await toAug(); await sleep(300);
  const an2 = await rect('.column[data-id="px1"] .aug-note');
  const fh = await rect('.column[data-id="px1"] .final-head');
  mouse('mouseMove', an2.cx, an2.cy, { modifiers: [] }); mouse('mouseDown', an2.cx, an2.cy);
  await sleep(300);
  await drag(an2.cx, an2.cy, fh.cx, fh.cy + 20, 12, 18);
  mouse('mouseUp', fh.cx, fh.cy + 20);
  await sleep(700);
  const finalNow = await finalOf('px1');
  check('dragging the Cooked note onto Served also moves it down', finalNow === `${final2}\n\nDelta four`, JSON.stringify(finalNow.slice(-40)));
  check('Served has no counter and no Copy all button', await js(`(() => { const s = document.querySelector('.column[data-id="px1"] .final'); return !s.querySelector('.final-count, .final-copy') && s.querySelector('.final-toggle').textContent.trim() === 'Served'; })()`));
  const servedBg = await js(`getComputedStyle(document.querySelector('.column[data-id="px1"] .final')).backgroundColor`);
  const servedRgb = (servedBg.match(/\d+/g) || []).map(Number);
  check('Served (with text in it) is a light, calm section, not a deep block', servedRgb.length >= 3 && Math.min(...servedRgb.slice(0, 3)) > 200, servedBg);
  // Served starts at a fixed size; "Show more" opens it up for now only (not saved)
  const finalBox = () => js(`(() => { const t = document.querySelector('.column[data-id="px1"] .final-text'); return { h: t.clientHeight, full: t.scrollHeight, line: parseFloat(getComputedStyle(t).lineHeight) }; })()`);
  const fb0 = await finalBox();
  check('Served starts at a fixed height (6 lines) when its text is longer', fb0.h <= Math.ceil(fb0.line * 6) + 1 && fb0.full > fb0.h + 10, JSON.stringify(fb0));
  await js(`document.querySelector('.column[data-id="px1"] .final-more').click()`);
  await sleep(300);
  const fb1 = await finalBox();
  const savedPx1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).projects.find((p) => p.id === 'px1');
  check('Show more opens the Served text up, without saving that state', fb1.h > fb0.h + 20 && !('augExpanded' in savedPx1), `${fb0.h}px → ${fb1.h}px`);
  await js(`document.querySelector('.column[data-id="px1"] .final-more').click()`);
  await sleep(250);
  await clipboard.writeText('');
  await clickSel('.column[data-id="px1"] .final-text');
  await sleep(250);
  check('clicking the Served text copies all of it (with a Copied chip)', (await clipboard.readText()) === finalNow && await js(`document.querySelector('.column[data-id="px1"] .final-body').classList.contains('is-copied')`));
  const footOverlaps = await js(`(() => {
    const r = (sel) => document.querySelector('.column[data-id="px1"] ' + sel).getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const stats = r('.final-stats');
    return ['.final-parts-btn', '.final-edit'].filter((sel) => hit(stats, r(sel)));
  })()`);
  check('Served footer: stats, Notes and edit do not overlap', footOverlaps.length === 0, footOverlaps.join(', '));
  // Cooked parts: a prompt can be pulled back out
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Epsilon five'); key('Enter', [MOD]); await sleep(200); key('Escape'); await sleep(150);
  await toAug(); await sleep(300);
  const partText = await augOf('px1');
  await js(`document.querySelector('.column[data-id="px1"] .aug-parts-btn').click()`);
  await sleep(200);
  await js(`document.querySelector('.column[data-id="px1"] .ap-back').click()`);
  await sleep(400);
  check('a prompt can be sent back out of Cooked', (await colTexts('px1')).includes(partText.split('\n')[0]) && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)));
  const stageColours = await js(`(() => {
    const c = (sel, prop = 'backgroundColor') => getComputedStyle(document.querySelector('.column[data-id="p1"] ' + sel))[prop];
    return [c('.active-list .card'), c('.used'), c('.final'), c('.aug-note'), c('.final-body'), c('.used-head', 'color'), c('.final-toggle', 'color')];
  })()`);
  check('new, Cooked and Served each look different (blocks, labels and inner notes)', new Set(stageColours.slice(0, 3)).size === 3 && new Set([stageColours[0], stageColours[3], stageColours[4]]).size === 3 && stageColours[5] !== stageColours[6], stageColours.map((x) => x.slice(0, 40)).join(' | '));
  await shot('03b-stages');
  // separator setting
  await fromMenu('#open-settings');
  await sleep(300);
  await js(`document.querySelector('#set-joiner [data-value="line"]').click()`);
  await sleep(200);
  key('Escape');
  await sleep(250);
  check('"Join notes with: New line" uses a single line break', (await finalOf('px1')) === finalNow.split('\n\n').join('\n'), JSON.stringify((await finalOf('px1')).slice(0, 50)));
  await js(`document.querySelector('#open-settings').click()`);
  await sleep(300);
  await js(`document.querySelector('#set-joiner [data-value="blank"]').click()`);
  key('Escape');
  await sleep(250);

  // ---------------------------------------------------------------- reorder and edit the parts of Served and Cooked
  const partsOf = (id, sel) => texts(`.column[data-id="${id}"] ${sel} .fp-text`);
  const finalRow = (i) => `document.querySelectorAll('.column[data-id="px1"] .final-parts .final-part')[${i}]`;
  await js(`document.querySelector('.column[data-id="px1"] .final-parts-btn').click()`);
  await sleep(200);
  check('the Served Notes list shows each part with move, edit, send-back and delete buttons', (await partsOf('px1', '.final-parts')).length === 5 && await js(`['.fp-up', '.fp-down', '.fp-edit', '.fp-back', '.fp-del'].every((s) => ${finalRow(0)}.querySelector(s))`));
  await js(`${finalRow(0)}.querySelector('.fp-down').click()`);
  await sleep(300);
  check('↓ moves a part down, and the Served text follows the new order', (await finalOf('px1')).startsWith('Beta two\n\nGamma three'), JSON.stringify((await finalOf('px1')).slice(0, 30)));
  await js(`${finalRow(1)}.querySelector('.fp-up').click()`);
  await sleep(300);
  check('↑ moves it back up', (await finalOf('px1')) === finalNow);
  await js(`${finalRow(4)}.querySelector('.fp-edit').click()`);
  await sleep(300);
  check('a single Served part opens in an editor with just its text', (await composerValue()) === 'Delta four' && await js(`!!document.querySelector('.column[data-id="px1"] .final-edit-host .composer')`), JSON.stringify(await composerValue()));
  await type(' edited');
  key('Enter', [MOD]);
  await sleep(400);
  const editedFinal = finalNow.replace(/Delta four$/, 'Delta four edited');
  check('saving it changes only that part; the others stay separate', (await finalOf('px1')) === editedFinal && (await partsOf('px1', '.final-parts')).length === 5, JSON.stringify((await finalOf('px1')).slice(-30)));
  await clickSel('.column[data-id="px1"] .final-edit');
  await sleep(300);
  const wholeFinal = await composerValue();
  await type(' Done.');
  key('Enter', [MOD]);
  await sleep(400);
  check('the Served pencil edits the whole text, saved as one note', wholeFinal === editedFinal && (await finalOf('px1')) === `${editedFinal} Done.` && (await partsOf('px1', '.final-parts')).length === 1);
  key('Z', [MOD]);
  await sleep(300);
  key('Z', [MOD]);
  await sleep(350);
  check('Ctrl+Z undoes both edits', (await finalOf('px1')) === finalNow && (await partsOf('px1', '.final-parts')).length === 5);
  await toAug(); await sleep(300); // Epsilon five → Cooked
  await js(`document.querySelector('.column[data-id="px1"] .aug-parts .fp-edit').click()`);
  await sleep(300);
  const partValue = await composerValue();
  await type(' plus');
  key('Enter', [MOD]);
  await sleep(400);
  check('a part of the Cooked note can be edited on its own too', partValue === 'Epsilon five' && (await augOf('px1')) === 'Epsilon five plus', JSON.stringify(await augOf('px1')));
  // right-click edits: a prompt card, the Cooked note, the Served text, and a single Served part
  const rightClick = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`);
  await rightClick('.column[data-id="p2"] .active-list .card .card-text');
  await sleep(300);
  const rcCard = await js(`!!document.querySelector('.column[data-id="p2"] .card-wrap.is-editing .composer')`);
  key('Escape'); await sleep(250);
  await rightClick('.column[data-id="px1"] .aug-note .aug-text');
  await sleep(300);
  const rcCooked = [await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-editing')`), await composerValue()];
  key('Escape'); await sleep(250);
  await rightClick('.column[data-id="px1"] .final-text');
  await sleep(300);
  const rcServed = [await js(`document.querySelector('.column[data-id="px1"] .final').classList.contains('is-editing')`), await composerValue()];
  key('Escape'); await sleep(250);
  await rightClick(`.column[data-id="px1"] .final-parts .final-part:nth-child(2) .fp-text`);
  await sleep(300);
  const rcPart = await composerValue();
  key('Escape'); await sleep(250);
  check('right-click edits a prompt, the Cooked note, the Served text, or one Served part', rcCard && rcCooked[0] && rcCooked[1] === 'Epsilon five plus' && rcServed[0] && rcServed[1] === finalNow && rcPart === 'Beta two', JSON.stringify({ rcCard, rcCooked, served: rcServed[0], rcPart }));
  check('Esc after a right-click edit changes nothing', (await augOf('px1')) === 'Epsilon five plus' && (await finalOf('px1')) === finalNow && !(await js(`!!document.querySelector('.composer')`)));

  // the Served editors above scrolled the column down; bring the Cooked pencil back into view
  await js(`document.querySelector('.column[data-id="px1"] .aug-edit').scrollIntoView({ block: 'center' })`);
  await sleep(200);
  await clickSel('.column[data-id="px1"] .aug-edit');
  await sleep(300);
  const wholeAug = await composerValue();
  key('Escape');
  await sleep(300);
  check('the Cooked pencil still edits the whole note (Esc cancels)', wholeAug === 'Epsilon five plus' && !(await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-editing')`)) && (await augOf('px1')) === 'Epsilon five plus');
  // a prompt that lands in Cooked while its editor is open is kept, after the edited text
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Zeta six'); key('Enter', [MOD]); await sleep(200); key('Escape'); await sleep(150);
  await clickSel('.column[data-id="px1"] .aug-edit');
  await sleep(300);
  await toAug(); await sleep(300); // Zeta six → Cooked, editor still open
  await js(`document.querySelector('.column[data-id="px1"] .aug-wrap .composer textarea').focus()`);
  await type(' again');
  key('Enter', [MOD]);
  await sleep(400);
  check('a prompt added while the Cooked editor is open is not lost on save', (await augOf('px1')) === 'Epsilon five plus again\n\nZeta six', JSON.stringify(await augOf('px1')));
  key('Z', [MOD]); await sleep(300); // the edit
  key('Z', [MOD]); await sleep(300); // the move
  await js(`document.querySelector('.column[data-id="px1"] .active-list .card').focus()`);
  key('Delete'); await sleep(600); // Zeta six out of the way again

  // ---------------------------------------------------------------- Clear Cooked / Clear Served (the old "Clear used" emptied the wrong stage)
  const menuPick = async (colId, label) => {
    await js(`document.querySelector('.column[data-id="${colId}"] .col-menu').click()`);
    await sleep(200);
    const items = await texts('.menu .menu-item');
    await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
    await sleep(350);
    return items;
  };
  const menuItems = await menuPick('px1', 'Clear Served');
  check('the project menu offers Clear Cooked and Clear Served, with counts', menuItems.includes('Clear Cooked (1)') && menuItems.includes('Clear Served (5)'), menuItems.join(' | '));
  check('Clear Served empties the Served text and leaves Cooked alone', (await finalOf('px1')) === '' && (await augOf('px1')) === 'Epsilon five plus' && (await texts('.toast')).some((t) => t.includes('Cleared Served')));
  key('Z', [MOD]);
  await sleep(350);
  check('Ctrl+Z brings the Served text back', (await finalOf('px1')) === finalNow);
  await menuPick('px1', 'Clear Cooked');
  check('Clear Cooked empties the Cooked note and leaves Served alone', (await augOf('px1')) === '' && (await finalOf('px1')) === finalNow);
  key('Z', [MOD]);
  await sleep(350);

  // ---------------------------------------------------------------- deleting inside Cooked and Served (1.15)
  const augRow = (i) => `document.querySelectorAll('.column[data-id="px1"] .aug-parts .final-part')[${i}]`;
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Eta seven'); key('Enter', [MOD]); await sleep(200); key('Escape'); await sleep(150);
  await toAug(); await sleep(300); // Eta seven → Cooked, after Epsilon five plus
  const augBefore = await augOf('px1');
  if ((await js(`document.querySelector('.column[data-id="px1"] .aug-parts-btn').getAttribute('aria-pressed')`)) !== 'true') {
    await js(`document.querySelector('.column[data-id="px1"] .aug-parts-btn').click()`);
    await sleep(200);
  }
  check('every row in the Cooked Notes list has a trash button', (await partsOf('px1', '.aug-parts')).length === 2 && await js(`[...document.querySelectorAll('.column[data-id="px1"] .aug-parts .final-part')].every((r) => r.querySelector('.fp-del'))`));
  const rowFit = await js(`(() => {
    const row = ${augRow(0)};
    const acts = row.querySelector('.fp-acts');
    acts.style.display = 'flex';
    const r = row.getBoundingClientRect(), a = acts.getBoundingClientRect(), t = row.querySelector('.fp-text').getBoundingClientRect();
    acts.style.display = '';
    return { fits: a.right <= r.right + 0.5 && t.right <= a.left + 0.5, text: Math.round(t.width) };
  })()`);
  check('a Notes row still fits its five buttons, with room for its text, at the default width', rowFit.fits && rowFit.text >= 40, JSON.stringify(rowFit));
  await js(`${augRow(0)}.scrollIntoView({ block: 'center' })`);
  await sleep(150);
  const row0 = await rect(`.column[data-id="px1"] .aug-parts .final-part`);
  mouse('mouseMove', row0.cx, row0.cy);
  await sleep(150);
  await shot('03c-cooked-row-trash');
  await js(`${augRow(0)}.querySelector('.fp-del').click()`);
  await sleep(350);
  check('the trash on a Cooked row deletes just that note (with an Undo toast)', augBefore === 'Epsilon five plus\n\nEta seven' && (await augOf('px1')) === 'Eta seven' && (await partsOf('px1', '.aug-parts')).length === 1 && (await texts('.toast')).some((t) => t.includes('Note deleted')), JSON.stringify(await augOf('px1')));
  key('Z', [MOD]);
  await sleep(350);
  check('Ctrl+Z puts the deleted note back in its place in Cooked', (await augOf('px1')) === augBefore, JSON.stringify(await augOf('px1')));
  // the trash in the whole-text editor (right-click the Cooked note) deletes the whole Cooked note
  await rightClick('.column[data-id="px1"] .aug-note .aug-text');
  await sleep(300);
  const delTitle = await js(`document.querySelector('.column[data-id="px1"] .aug-wrap .composer .comp-delete')?.title ?? null`);
  await js(`document.querySelector('.column[data-id="px1"] .aug-wrap .composer .comp-delete')?.click()`);
  await sleep(350);
  check('the Cooked editor\'s trash deletes the whole Cooked note and leaves Served alone', delTitle === 'Delete the whole cooked note' && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)) && !(await js(`!!document.querySelector('.composer')`)) && (await finalOf('px1')) === finalNow && (await texts('.toast')).some((t) => t.includes('Cooked note deleted')), JSON.stringify(delTitle));
  key('Z', [MOD]);
  await sleep(350);
  check('Ctrl+Z brings the whole Cooked note back, parts and all', (await augOf('px1')) === augBefore && (await partsOf('px1', '.aug-parts')).length === 2);
  // Served rows have the same trash
  await js(`${finalRow(1)}.querySelector('.fp-del').click()`);
  await sleep(350);
  check('the trash on a Served row deletes just that note', (await partsOf('px1', '.final-parts')).length === 4 && !(await finalOf('px1')).includes('Beta two') && (await augOf('px1')) === augBefore, JSON.stringify((await finalOf('px1')).slice(0, 40)));
  key('Z', [MOD]);
  await sleep(350);
  check('Ctrl+Z restores the Served note', (await finalOf('px1')) === finalNow);
  await js(`${augRow(1)}.querySelector('.fp-del').click()`); // Eta seven out of the way again
  await sleep(350);
  check('deleting the last Cooked row leaves the other note', (await augOf('px1')) === 'Epsilon five plus', JSON.stringify(await augOf('px1')));

  // ---------------------------------------------------------------- search also marks matches in the Cooked and Served texts
  const setSearch = (q) => js(`(() => { const s = document.querySelector('#search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input')); })()`);
  await setSearch('epsilon gamma');
  await sleep(250);
  const marks = await js(`[[...document.querySelectorAll('.column[data-id="px1"] .aug-text mark')].map((m) => m.textContent), [...document.querySelectorAll('.column[data-id="px1"] .final-text mark')].map((m) => m.textContent)]`);
  check('search highlights matches inside the Cooked and Served texts', marks[0].join() === 'Epsilon' && marks[1].join() === 'Gamma', JSON.stringify(marks));
  await setSearch('');
  await sleep(200);

  // ---------------------------------------------------------------- more column colours
  await js(`document.querySelector('.column[data-id="px1"] .col-menu').click()`);
  await sleep(200);
  const swatchNames = await js(`[...document.querySelectorAll('.menu .swatch')].map((s) => s.title)`);
  await js(`[...document.querySelectorAll('.menu .swatch')].find((s) => s.title === 'Navy').click()`);
  await sleep(250);
  const navy = await js(`document.querySelector('.column[data-id="px1"]').style.getPropertyValue('--accent')`);
  key('Escape');
  await sleep(150);
  check('18 column colours to pick from, and a new one applies', swatchNames.length === 18 && navy === '#1e3a8a', `${swatchNames.length} colours, px1 → ${navy}`);
  key('Z', [MOD]);
  await sleep(300);

  await js(`document.querySelector('#board').scrollLeft = 0`);
  await sleep(200);

  // ---------------------------------------------------------------- highlight
  const hlCard = await rect('.column[data-id="p2"] .active-list .card', 0);
  mouse('mouseMove', hlCard.cx, hlCard.cy, { modifiers: [] });
  await sleep(150);
  await js(`document.querySelector('.column[data-id="p2"] .active-list .act-hl').click()`);
  await sleep(200);
  const hlItems = await texts('.menu .hl-item');
  await js(`document.querySelector('.menu .hl-item').click()`);
  await sleep(300);
  const tag = await js(`document.querySelector('.column[data-id="p2"] .active-list .card-wrap').classList.contains('is-hl') && document.querySelector('.column[data-id="p2"] .active-list .card-hl-tag').textContent`);
  check('highlight a note from its hover menu (4 colours)', hlItems.length === 4 && tag === 'Check again', `${hlItems.join(', ')} → ${tag}`);
  await shot('03d-highlight');
  key('Z', [MOD]);
  await sleep(300);
  check('Ctrl+Z removes the highlight', !(await js(`document.querySelector('.column[data-id="p2"] .active-list .card-wrap').classList.contains('is-hl')`)));
  await js(`document.querySelector('.column[data-id="p2"] .active-list .card').focus()`);
  key('H');
  await sleep(300);
  check('H key toggles the highlight on a focused note', await js(`document.querySelector('.column[data-id="p2"] .active-list .card-wrap').classList.contains('is-hl')`));
  key('H');
  await sleep(250);

  // ---------------------------------------------------------------- Ctrl+click multi-copy
  const ctrlClick = async (r) => { mouse('mouseMove', r.cx, r.cy, { modifiers: [MOD] }); mouse('mouseDown', r.cx, r.cy, { modifiers: [MOD] }); await sleep(40); mouse('mouseUp', r.cx, r.cy, { modifiers: [MOD] }); await sleep(250); };
  const aText = (await colTexts('p1'))[0];
  const bText = (await colTexts('p2'))[1];
  await clipboard.writeText('');
  await ctrlClick(await rect('.column[data-id="p1"] .active-list .card', 0));
  await ctrlClick(await rect('.column[data-id="p2"] .active-list .card', 1));
  check('Ctrl+click two notes copies both, blank line between, in click order', (await clipboard.readText()) === `${aText}\n\n${bText}`, JSON.stringify((await clipboard.readText()).slice(0, 60)));
  const badges = await texts('.card-wrap.is-selected > .sel-badge');
  const barText = await js(`document.querySelector('#selection-bar').hidden ? '' : document.querySelector('#sel-count').textContent`);
  check('selected cards show order badges and the selection bar', badges.join(',') === '1,2' && barText === '2 notes copied', `${badges} | ${barText}`);
  await shot('03c-multiselect');
  await ctrlClick(await rect('.column[data-id="p1"] .active-list .card', 0));
  check('Ctrl+click again removes it from the clipboard text', (await clipboard.readText()) === bText);
  key('Escape');
  await sleep(200);
  check('Esc clears the selection', (await js(`document.querySelectorAll('.card-wrap.is-selected').length`)) === 0 && await js(`document.querySelector('#selection-bar').hidden`));
  await ctrlClick(await rect('.column[data-id="p2"] .active-list .card', 0));
  const moving = (await colTexts('p2'))[0];
  await clickSel('#sel-used');
  let movedAug = '';
  for (let t = 0; t < 20 && !movedAug.includes(moving); t++) { await sleep(100); movedAug = await augOf('p2'); }
  const selLabel = await js(`document.querySelector('#sel-used').textContent`);
  check('selection bar "Move to Cooked" joins the notes into it', movedAug.includes(moving) && !(await colTexts('p2')).includes(moving) && selLabel === 'Move to Cooked', JSON.stringify({ moving: moving.slice(0, 30), aug: movedAug.slice(0, 60), selLabel }));
  key('Z', [MOD]);
  await sleep(350);
  check('and Ctrl+Z puts them back', (await colTexts('p2')).includes(moving));

  // ---------------------------------------------------------------- live dictation
  await clickSel('.column[data-id="p1"] .col-mic');
  await sleep(700);
  check('mic starts recording from header', await js(`!!document.querySelector('.composer.is-recording')`));
  check('while it records, the editor says it is listening', /Listening…|Writing…/.test(await js(`document.querySelector('.composer .composer-status').textContent`)));
  const reqBefore = received.length;
  let liveSeen = '';
  for (let t = 0; t < 40 && !liveSeen; t++) {
    await sleep(100);
    const v = await composerValue();
    const rec = await js(`!!document.querySelector('.composer.is-recording')`);
    if (v && rec && /Phrase one\./.test(v)) liveSeen = v;
  }
  await shot('05-live-dictation');
  check('text appears while still recording', /Phrase one/.test(liveSeen), JSON.stringify(liveSeen));
  check('the text box stays editable while recording', !(await js(`document.querySelector('.composer textarea').readOnly`)));
  await sleep(400);
  await type(' typed');
  await sleep(150);
  const midTyped = await composerValue();
  const r0 = received[reqBefore] || {};
  check('phrases are streamed (stream=true, gpt-transcribe, webm)', r0.stream === 'true' && r0.model === 'gpt-transcribe' && /audio\/webm/.test(r0.fileHeader || ''), JSON.stringify({ stream: r0.stream, model: r0.model, file: r0.fileHeader }));
  await sleep(2200);
  await clickSel('.composer .mic-btn'); // stop
  await sleep(1500);
  const dictated = await composerValue();
  const r1 = received[reqBefore + 1] || {};
  check('typing while it records: your text stays, dictation continues after it', midTyped === 'Phrase one. typed' && /^Phrase one\. typed Phrase two\./.test(dictated || ''), JSON.stringify(dictated));
  check('previous text sent as context prompt', (r1.prompt || '').includes('Phrase one'), JSON.stringify(r1.prompt));
  check('recording stopped and textarea editable', !(await js(`document.querySelector('.composer').classList.contains('is-recording') || document.querySelector('.composer textarea').readOnly`)));
  await type(' Keep it simple.');
  key('Enter', [MOD]);
  await sleep(400);
  const newest = (await colTexts('p1')).pop();
  check('Ctrl+Enter saves dictated note', /^Phrase one\. typed Phrase two\..* Keep it simple\.$/.test(newest || ''), JSON.stringify(newest));
  key('Escape');
  await sleep(250);

  // Save pressed mid-recording: stops, finishes transcribing, then saves
  const n0 = (await colTexts('p2')).length;
  await clickSel('.column[data-id="p2"] .col-mic');
  await sleep(1500);
  await clickSel('.composer .comp-save');
  let savedMid = false;
  for (let t = 0; t < 40 && !savedMid; t++) { await sleep(100); savedMid = (await colTexts('p2')).length === n0 + 1; }
  check('Save during recording finishes transcription then saves', savedMid && /^Phrase/.test((await colTexts('p2')).pop() || ''), (await colTexts('p2')).pop());
  key('Escape');
  await sleep(200);

  // ---------------------------------------------------------------- transcription failure → Retry
  mockMode = 'fail500';
  const failBefore = received.length;
  await clickSel('.column[data-id="p2"] .col-mic');
  await sleep(1200);
  await clickSel('.composer .mic-btn');
  await sleep(2000);
  const errText = await js(`(() => { const m = document.querySelector('.composer-msg.is-error:not([hidden])'); return m ? m.textContent : null; })()`);
  check('server error: auto-retried once, then Retry/Discard offered', received.length - failBefore === 2 && /Retry/.test(errText || '') && /Discard/.test(errText || ''), `requests=${received.length - failBefore} msg=${errText}`);
  check('textarea stays editable after a failure', !(await js(`document.querySelector('.composer textarea').readOnly`)));
  mockMode = 'ok';
  await clickSel('.composer-msg .status-action');
  await sleep(900);
  check('Retry succeeds', /Phrase/.test((await composerValue()) || ''), await composerValue());
  key('Escape');
  await sleep(250);
  check('closing keeps a draft (dot on +)', await js(`document.querySelector('.column[data-id="p2"] .col-add').classList.contains('has-draft')`));

  // ---------------------------------------------------------------- pasted image → card thumbnail → copy image
  await clickSel('.column[data-id="p3"] .col-add');
  await sleep(250);
  await js(`(async () => {
    const c = new OffscreenCanvas(480, 300); const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 480, 300); grad.addColorStop(0, '#34d399'); grad.addColorStop(1, '#0284c7');
    g.fillStyle = grad; g.fillRect(0, 0, 480, 300); g.fillStyle = '#fff'; g.font = 'bold 44px Segoe UI'; g.fillText('test screenshot', 60, 165);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await sleep(700);
  check('pasted image attaches to composer', (await js(`document.querySelectorAll('.composer .attach').length`)) === 1);
  await type('Why is this chart wrong?');
  await shot('06-composer-with-image');
  key('Enter', [MOD]);
  await sleep(500);
  check('note saved with image thumbnail', (await js(`document.querySelectorAll('.column[data-id="p3"] .active-list .card-img img').length`)) === 1);
  const thumbLoaded = await js(`(() => { const i = document.querySelector('.column[data-id="p3"] .card-img img'); return i && i.complete && i.naturalWidth; })()`);
  check('thumbnail served via recaller-img://', thumbLoaded > 0, `naturalWidth=${thumbLoaded}`);
  await clipboard.writeText('');
  await clickSel('.column[data-id="p3"] .card-img');
  await sleep(300);
  const items = await clipboard.read();
  check('clicking the thumbnail copies the image', items.some((it) => it.types.includes('image/png')), JSON.stringify(items.map((i) => i.types)));
  await clipboard.writeText('');
  const withImg = await rect('.column[data-id="p3"] .active-list .card-wrap:last-child .card-text');
  await click(withImg.cx, withImg.cy);
  await sleep(250);
  check('clicking the text still copies the text', (await clipboard.readText()) === 'Why is this chart wrong?');
  await shot('07-card-with-image');
  // lightbox
  mouse('mouseMove', withImg.cx, withImg.cy + 40, { modifiers: [] });
  await sleep(150);
  await js(`document.querySelector('.column[data-id="p3"] .img-expand').click()`);
  await sleep(300);
  check('expand opens the image viewer', await js(`document.querySelector('#lightbox').open`));
  await shot('08-lightbox');
  key('Escape');
  await sleep(200);

  // ---------------------------------------------------------------- pictures in Cooked and Served: shown under the text, copied on their own
  const hasPng = async () => (await clipboard.read()).some((it) => it.types.includes('image/png'));
  await js(`[...document.querySelectorAll('.column[data-id="p3"] .active-list .act-used')].pop().click()`);
  await sleep(400);
  await clickSel('.column[data-id="p3"] .used-head'); // p3 starts with Cooked folded
  await sleep(300);
  const augTiles = await js(`[...document.querySelectorAll('.column[data-id="p3"] .aug-images:not([hidden]) .card-img img')].map((i) => i.complete && i.naturalWidth)`);
  check('a prompt moved to Cooked shows its picture under the Cooked note', augTiles.length === 1 && augTiles[0] > 0, JSON.stringify(augTiles));
  await shot('08b-cooked-with-image');
  await clipboard.writeText('');
  await clickSel('.column[data-id="p3"] .aug-text');
  await sleep(300);
  const augTextNow = await augOf('p3');
  const augChip = await js(`document.querySelector('.column[data-id="p3"] .aug-note .copied-chip')?.textContent`);
  check('clicking the Cooked text copies the text alone ("Text copied")', augTextNow.endsWith('Why is this chart wrong?') && (await clipboard.readText()) === augTextNow && !(await hasPng()) && augChip === 'Text copied', JSON.stringify(augChip));
  await clipboard.writeText('');
  await clickSel('.column[data-id="p3"] .aug-images .card-img');
  await sleep(300);
  check('clicking the picture under Cooked copies the picture', (await hasPng()) && await js(`document.querySelector('.column[data-id="p3"] .aug-images .card-img').classList.contains('is-copied')`));
  await js(`document.querySelector('.column[data-id="p3"] .aug-move').click()`);
  await sleep(400);
  check('moving it to Served carries the picture along', (await js(`document.querySelectorAll('.column[data-id="p3"] .final-images:not([hidden]) .card-img').length`)) === 1 && (await js(`document.querySelector('.column[data-id="p3"] .aug-images').hidden`)));
  await clipboard.writeText('');
  await clickSel('.column[data-id="p3"] .final-images .card-img');
  await sleep(300);
  check('clicking the picture under Served copies the picture', await hasPng());
  await clipboard.writeText('');
  await clickSel('.column[data-id="p3"] .final-text');
  await sleep(300);
  check('clicking the Served text still copies the text alone', (await clipboard.readText()) === augTextNow && !(await hasPng()));
  key('Z', [MOD]); // Move to Served
  await sleep(250);
  key('Z', [MOD]); // Move to Cooked
  await sleep(250);
  await clickSel('.column[data-id="p3"] .used-head');
  await sleep(250);
  check('undo puts the picture prompt back in Cooking', (await js(`document.querySelectorAll('.column[data-id="p3"] .active-list .card-img').length`)) === 1 && (await augOf('p3')) === 'Label studio setup steps');

  // ---------------------------------------------------------------- horizontal scrolling
  const sl0 = await js('document.querySelector("#board").scrollLeft');
  check('right scroll arrow visible when columns overflow', !(await js(`document.querySelector('#pan-right').hidden`)));
  // 1.16: the arrows keep out of sight until the pointer nears their edge, and have a visible ring
  const panState = (sel) => js(`(() => { const b = document.querySelector('${sel}'); const cs = getComputedStyle(b); return { near: b.classList.contains('is-near'), pe: cs.pointerEvents, bw: parseFloat(cs.borderTopWidth), bc: cs.borderTopColor }; })()`);
  mouse('mouseMove', 600, 420, { modifiers: [] });
  await sleep(150);
  const ps0 = await panState('#pan-right');
  check('the right arrow stays out of sight while the pointer is mid-board', !ps0.near && ps0.pe === 'none', JSON.stringify(ps0));
  const winW = await js('innerWidth');
  const pr0 = await rect('#pan-right');
  mouse('mouseMove', winW - 70, pr0.cy - 90, { modifiers: [] });
  await sleep(150);
  const ps1 = await panState('#pan-right');
  check('it appears near the right edge, with a slim coloured ring', ps1.near && ps1.pe === 'auto' && ps1.bw >= 1 && !/255, 255, 255|, 0\)$/.test(ps1.bc), JSON.stringify(ps1));
  await clickSel('#pan-right');
  await sleep(600);
  const sl1 = await js('document.querySelector("#board").scrollLeft');
  check('arrow scrolls by about one column', sl1 - sl0 > 200, `${sl0} → ${sl1}`);
  const pl0 = await panState('#pan-left');
  const pl0Hidden = await js(`document.querySelector('#pan-left').hidden`);
  const pl0r = await rect('#pan-left');
  mouse('mouseMove', 40, pl0r.cy - 90, { modifiers: [] });
  await sleep(150);
  const pl1 = await panState('#pan-left');
  const pr1 = await panState('#pan-right');
  check('the left arrow appears only near the left edge (and the right one leaves)', !pl0Hidden && !pl0.near && pl1.near && !pr1.near, JSON.stringify({ pl0, pl1, pr1 }));
  const hd = await rect('.column[data-id="p2"] .col-name');
  wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(hd.cx), y: Math.round(hd.cy), deltaX: 0, deltaY: -240, canScroll: true });
  await sleep(300);
  const sl2 = await js('document.querySelector("#board").scrollLeft');
  check('mouse wheel over a header scrolls sideways', Math.abs(sl2 - sl1) > 100, `${sl1} → ${sl2}`);
  await js('document.querySelector("#board").scrollLeft = 200');
  await sleep(100);
  const sl2b = await js('document.querySelector("#board").scrollLeft');
  const spot = await js(`(() => { const b = document.querySelector('#board'); for (let y = 780; y > 120; y -= 20) for (let x = 400; x < 1300; x += 10) if (document.elementFromPoint(x, y) === b) return { x, y }; return null; })()`);
  mouse('mouseMove', spot.x, spot.y, { modifiers: [] }); mouse('mouseDown', spot.x, spot.y);
  await drag(spot.x, spot.y, spot.x - 200, spot.y, 10);
  mouse('mouseUp', spot.x - 200, spot.y);
  await sleep(200);
  const sl3 = await js('document.querySelector("#board").scrollLeft');
  check('dragging empty canvas pans the board', sl3 - sl2b > 150, `${sl2b} → ${sl3} at ${JSON.stringify(spot)}`);
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(200);

  // ---------------------------------------------------------------- density setting
  await fromMenu('#open-settings');
  await sleep(350);
  await shot('09-settings');
  await js(`document.querySelector('#set-density [data-value="compact"]').click()`);
  await sleep(200);
  key('Escape');
  await sleep(250);
  const compactW = (await rect('.column[data-id="p1"]')).w;
  check('Compact density narrows columns', compactW < colW - 20, `${colW} → ${compactW}`);
  await shot('10-compact');
  await js(`document.querySelector('#open-settings').click()`);
  await sleep(300);
  await js(`document.querySelector('#set-density [data-value="slim"]').click()`);
  await js(`document.querySelector('#set-theme [data-value="soft"]').click()`);
  await sleep(300);
  key('Escape');
  await sleep(250);
  check('Soft colour theme can be picked', await js(`document.body.classList.contains('theme-soft')`));
  await shot('10b-soft');
  await js(`document.querySelector('#open-settings').click()`);
  await sleep(300);
  await js(`document.querySelector('#set-theme [data-value="deep"]').click()`);
  await sleep(300);
  key('Escape');
  await sleep(250);
  const savedTheme = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-settings.json'), 'utf8')).theme;
  check('theme choice is saved', savedTheme === 'deep' && await js(`document.body.classList.contains('theme-deep')`), savedTheme);

  // Settings › Cooked colour: six options, Caramel by default; picking one recolours Cooked and is saved
  await js(`document.querySelector('#open-settings').click()`);
  await sleep(300);
  const cookedOpts = await js(`[...document.querySelectorAll('#set-cooked [data-value]')].map((b) => b.dataset.value + (b.getAttribute('aria-checked') === 'true' ? '*' : ''))`);
  const barBefore = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .aug-move')).backgroundColor`);
  await js(`document.querySelector('#set-cooked [data-value="teal"]').click()`);
  let barTeal = barBefore;
  for (let t = 0; t < 20 && barTeal === barBefore; t++) { await sleep(100); barTeal = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .aug-move')).backgroundColor`); }
  await sleep(500); // let the save land
  const savedCooked = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).prefs.cookedColor;
  await js(`document.querySelector('#set-cooked [data-value="ocean"]').click()`);
  await sleep(300);
  key('Escape');
  await sleep(250);
  check('Settings › Cooked colour: 4 options, Ocean by default, a pick recolours Cooked and is saved', cookedOpts.length === 4 && cookedOpts[0] === 'ocean*' && barTeal !== barBefore && savedCooked === 'teal' && await js(`document.body.classList.contains('cooked-ocean')`), `${cookedOpts.join(',')} | saved ${savedCooked} | bar ${barBefore} → ${barTeal} | ocean now ${await js(`document.body.classList.contains('cooked-ocean')`)}`);

  // ---------------------------------------------------------------- resize columns, then reset them from the top bar
  const prefsNow = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).prefs;
  const widthOf = async (id) => (await rect(`.column[data-id="${id}"]`)).w;
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(150);
  check('Reset column widths sits in the ☰ menu, off while no column is resized', await js(`document.querySelector('#app-menu #reset-widths').disabled`));
  const w0 = await widthOf('p1');
  const resizeBy = async (id, dx) => {
    const h = await rect(`.column[data-id="${id}"] .col-resize`);
    mouse('mouseMove', h.cx, h.cy, { modifiers: [] }); mouse('mouseDown', h.cx, h.cy);
    await drag(h.cx, h.cy, h.cx + dx, h.cy + 3, 10);
    mouse('mouseUp', h.cx + dx, h.cy + 3);
    await sleep(700);
  };
  await resizeBy('p1', 90);
  await resizeBy('p2', -40);
  const w1 = await widthOf('p1');
  const w2 = await widthOf('p2');
  const saved1 = prefsNow().colWidths || {};
  check('dragging a column edge resizes it, and the width is remembered', w1 - w0 > 80 && w0 - w2 > 30 && saved1.p1 === Math.round(w1) && saved1.p2 === Math.round(w2), `p1 ${w0}→${w1}, p2 ${w0}→${w2}, saved ${JSON.stringify(saved1)}`);
  check('the reset button turns on once a column is resized', !(await js(`document.querySelector('#reset-widths').disabled`)));
  await shot('10c-resized');
  await fromMenu('#reset-widths');
  await sleep(700);
  check('the top-bar button puts every column back to the default width', Math.abs((await widthOf('p1')) - w0) < 1 && Math.abs((await widthOf('p2')) - w0) < 1 && !('colWidths' in prefsNow()) && await js(`document.querySelector('#reset-widths').disabled`));
  await js(`[...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Column widths reset')).querySelector('.toast-action').click()`);
  await sleep(700);
  check('Undo on its toast brings the widths back', Math.abs((await widthOf('p1')) - w1) < 1 && (prefsNow().colWidths || {}).p1 === Math.round(w1));
  await js(`document.querySelector('.column[data-id="p1"] .col-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(700);
  check('double-clicking a column edge resets just that column', Math.abs((await widthOf('p1')) - w0) < 1 && Math.abs((await widthOf('p2')) - w2) < 1 && !((prefsNow().colWidths || {}).p1));
  await fromMenu('#reset-widths');
  await sleep(500);

  // ---------------------------------------------------------------- column drag + undo
  const h1 = await rect('.column[data-id="p1"] .col-name');
  const col2 = await rect('.column[data-id="p2"]');
  mouse('mouseMove', h1.cx, h1.cy, { modifiers: [] }); mouse('mouseDown', h1.cx, h1.cy);
  await drag(h1.cx, h1.cy, col2.x + col2.w * 0.8, h1.cy + 10, 16, 18);
  mouse('mouseUp', col2.x + col2.w * 0.8, h1.cy + 10);
  await sleep(450);
  const order1 = await js(`[...document.querySelectorAll('.column')].map(c => c.dataset.id).slice(0, 2).join(',')`);
  key('Z', [MOD]);
  await sleep(350);
  const order2 = await js(`[...document.querySelectorAll('.column')].map(c => c.dataset.id).slice(0, 2).join(',')`);
  check('column reorder, then undo restores order', order1 === 'p2,p1' && order2 === 'p1,p2', `${order1} → ${order2}`);

  // ---------------------------------------------------------------- ⋯ › Sort prompts oldest first (for columns saved newest-first)
  const createdOrder = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).projects.find((p) => p.id === 'p2').notes.map((n) => n.createdAt);
  const ascending = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);
  const beforeSort = createdOrder();
  await js(`document.querySelector('.column[data-id="p2"] .col-menu').click()`);
  await sleep(200);
  await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith('Sort prompts oldest first')).click()`);
  await sleep(700);
  const afterSort = createdOrder();
  key('Z', [MOD]);
  await sleep(700);
  check('Sort prompts oldest first reorders by date, and Ctrl+Z undoes it', !ascending(beforeSort) && ascending(afterSort) && JSON.stringify(createdOrder()) === JSON.stringify(beforeSort), `${beforeSort.length} prompts`);

  // ---------------------------------------------------------------- 1.18: + in the top bar, Clear, Claude Code, Eating, minimize, groups
  const pickFrom = async (anchorSel, label) => {
    await js(`document.querySelector(${JSON.stringify(anchorSel)}).click()`);
    await sleep(200);
    const ok = await js(`(() => { const b = [...document.querySelectorAll('.menu .menu-item')].find((x) => x.textContent === ${JSON.stringify(label)}); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
    await sleep(400);
    return ok;
  };
  const colCount = await js(`document.querySelectorAll('.column').length`);
  await clickSel('#new-column');
  await sleep(600);
  const NEW = await js(`document.querySelector('.col-name-input')?.closest('.column').dataset.id ?? null`);
  check('the + in the top bar makes a new project, ready to name', Boolean(NEW) && (await js(`document.querySelectorAll('.column').length`)) === colCount + 1);
  await js(`(() => { const i = document.querySelector('.col-name-input'); i.value = 'Agent run'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(300);
  const C = `.column[data-id="${NEW}"]`;

  // Clear in the new-text editor, with Undo on its toast
  await clickSel(`${C} .col-add`);
  await sleep(250);
  await type('Scrap this');
  await sleep(150);
  await clickSel(`${C} .comp-clear`);
  await sleep(250);
  const clearedTo = await composerValue();
  await js(`[...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Text cleared'))?.querySelector('.toast-action').click()`);
  await sleep(250);
  const undoneTo = await composerValue();
  check('Clear in the new-text editor empties it, and Undo on its toast puts it back', clearedTo === '' && undoneTo === 'Scrap this', JSON.stringify([clearedTo, undoneTo]));
  await clickSel(`${C} .comp-clear`);
  await sleep(200);
  await type('Fix the login bug');
  key('Enter', [MOD]);
  await sleep(400);
  await clickSel(`${C} .col-add`);
  await sleep(250);
  await type('Add a test for it');
  key('Enter', [MOD]);
  await sleep(400);
  await js(`[...document.querySelectorAll('${C} .active-list .act-used')].forEach((b) => b.click())`);
  await sleep(500);

  // Cooked › Format for Claude Code, and back
  const plainCooked = await augOf(NEW);
  await js(`document.querySelector('${C} .aug-cc').click()`);
  await sleep(300);
  const ccText = await augOf(NEW);
  await clipboard.writeText('');
  await clickSel(`${C} .aug-text`);
  await sleep(400);
  const ccCopied = await clipboard.readText();
  check('Cooked › >_ formats the note for Claude Code, and a click copies that', /^Complete the request below/.test(ccText) && ccText.includes('1. Fix the login bug') && ccText.includes('2. Add a test for it') && ccText.includes('<how_to_work>') && ccCopied === ccText && savedProject(NEW).cookedFormat === 'claude-code', JSON.stringify({ plain: plainCooked, cc: ccText.slice(0, 60), copied: ccCopied.slice(0, 40) }));
  await js(`document.querySelector('${C} .aug-cc').click()`);
  await sleep(300);
  check('clicking it again shows the original text', (await augOf(NEW)) === plainCooked && !('cookedFormat' in savedProject(NEW)));
  await js(`document.querySelector('${C} .aug-cc').click()`);
  await sleep(300);
  await js(`document.querySelector('${C} .aug-move').click()`);
  await sleep(700);
  const servedCC = savedProject(NEW);
  check('serving a Claude Code note serves the formatted text, and the next batch starts plain', servedCC.combined.length === 1 && servedCC.combined[0].text === ccText && !servedCC.used.length && !('cookedFormat' in servedCC), JSON.stringify({ served: servedCC.combined.length, used: servedCC.used.length, fmt: servedCC.cookedFormat }));

  // Eating: the Served switch, and the strip at the bottom right of the board
  check('Served has an Eating switch, off at first, and no strip yet', await js(`(() => { const b = document.querySelector('${C} .eat-btn'); return !b.hidden && b.getAttribute('aria-pressed') === 'false' && document.querySelector('#eating').hidden; })()`));
  await js(`document.querySelector('${C} .eat-btn').click()`);
  await sleep(400);
  const eatNow = await js(`({ pressed: document.querySelector('${C} .eat-btn').getAttribute('aria-pressed'), bar: !document.querySelector('#eating').hidden, chips: [...document.querySelectorAll('#eating .eat-chip')].map((c) => c.dataset.id), name: document.querySelector('#eating .eat-name')?.textContent, dot: getComputedStyle(document.querySelector('${C} .mini-eat')).display })`);
  check('switching Eating on lists the column at the bottom right, and its header shows a dot', eatNow.pressed === 'true' && eatNow.bar && eatNow.chips.join() === NEW && eatNow.name === 'Agent run' && eatNow.dot === 'block' && Number.isFinite(savedProject(NEW).eating), JSON.stringify(eatNow));
  const clearOfStrip = await js(`(() => { const top = document.querySelector('#eating').getBoundingClientRect().top; return Math.max(...[...document.querySelectorAll('.column')].map((c) => c.getBoundingClientRect().bottom)) <= top + 1; })()`);
  check('the Eating strip sits below every column, never over one', clearOfStrip);
  key('Z', [MOD]); // undo the move to Served: Eating is a state, not an edit, so it stays on
  await sleep(400);
  const eatAfterUndo = Number.isFinite(savedProject(NEW).eating);
  key('Y', [MOD]);
  await sleep(400);
  check('undo leaves Eating alone', eatAfterUndo && savedProject(NEW).combined.length === 1);
  // Done: ✓ on the strip moves the Served text to Eaten, Served empties, Eating ends; Undo puts all three back
  const savedData = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8'));
  await js(`document.querySelector('#eating .eat-done').click()`);
  await sleep(500);
  const done = { p: savedProject(NEW), eaten: savedData().localEaten || [], strip: await js(`document.querySelector('#eating').hidden`), btn: await js(`!document.querySelector('#open-eaten').hidden && document.querySelector('#open-eaten .eaten-badge').textContent`) };
  check('✓ Done on the strip moves the served text to Eaten: Served empties, Eating ends, the top bar shows Eaten', !done.p.combined.length && !('eating' in done.p) && done.eaten.length === 1 && done.eaten[0].text === ccText && done.eaten[0].project === NEW && done.strip && done.btn === '1', JSON.stringify({ served: done.p.combined.length, eaten: done.eaten.length, strip: done.strip, btn: done.btn }));
  key('Z', [MOD]);
  await sleep(500);
  const undone = { p: savedProject(NEW), eaten: savedData().localEaten };
  check('Ctrl+Z after Done puts the served text and Eating back, and takes it out of Eaten', undone.p.combined.length === 1 && Number.isFinite(undone.p.eating) && !undone.eaten, JSON.stringify({ served: undone.p.combined.length, eating: undone.p.eating, eaten: undone.eaten?.length }));
  // the Served switch while eating offers Done, or stopping with the text kept in Served
  const menuNow = async () => { await js(`document.querySelector('${C} .eat-btn').click()`); await sleep(250); return texts('.menu .menu-item'); };
  const eatMenu = await menuNow();
  await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith('Stop eating')).click()`);
  await sleep(400);
  check('the Eating switch offers Done, or Stop eating that keeps the text in Served', eatMenu.join('|') === 'Done: move it to Eaten|Stop eating, keep it in Served' && !('eating' in savedProject(NEW)) && savedProject(NEW).combined.length === 1, eatMenu.join('|'));
  await js(`document.querySelector('${C} .eat-btn').click()`); // on again, then Done from the switch
  await sleep(300);
  await menuNow();
  await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith('Done')).click()`);
  await sleep(500);
  await fromMenu('#open-eaten');
  await sleep(400);
  const drawer = await js(`({ open: document.querySelector('#eaten-panel').classList.contains('is-open'), day: document.querySelector('.eaten-day')?.textContent, items: [...document.querySelectorAll('.eaten-item')].map((i) => i.querySelector('.eaten-item-head b').textContent), text: document.querySelector('.eaten-text')?.textContent.slice(0, 30) })`);
  check('the Eaten drawer lists it under Today, with its column', drawer.open && drawer.day === 'Today' && drawer.items.join() === 'Agent run' && drawer.text === ccText.slice(0, 30), JSON.stringify(drawer));
  await shot('11c-eaten');
  await clipboard.writeText('');
  await js(`document.querySelector('.eaten-item .eaten-copy').click()`);
  await sleep(300);
  check('Copy in Eaten copies the round', (await clipboard.readText()) === ccText);
  await js(`document.querySelector('.eaten-item .eaten-again').click()`);
  await sleep(500);
  check('Serve again puts it back into its column’s Served and out of Eaten', savedProject(NEW).combined.length === 1 && savedProject(NEW).combined[0].text === ccText && !savedData().localEaten && await js(`!!document.querySelector('.eaten-empty')`));
  key('Escape');
  await sleep(300);
  check('Esc closes the Eaten drawer', !(await js(`document.querySelector('#eaten-panel').classList.contains('is-open')`)));

  // ⋯ › Minimize column: a slim strip, and a click opens it
  const minimized = await pickFrom(`${C} .col-menu`, 'Minimize column');
  const miniBox = await rect(C);
  check('⋯ › Minimize column folds it to a row (1.20: synced, as `minimized`; 1.20.2: a row in a stack)', minimized && miniBox.h < 60 && miniBox.w > 150 && await js(`!!document.querySelector('${C}').closest('.mini-stack')`) && savedProject(NEW).minimized === true && !('localMinimized' in savedProject(NEW)) && await js(`getComputedStyle(document.querySelector('${C} .col-scroll')).display === 'none'`), `${Math.round(miniBox.w)}px`);
  await clickSel(`${C} .col-head`);
  await sleep(500);
  check('a click on the strip opens the column again', (await rect(C)).w > 200 && !('minimized' in savedProject(NEW)));

  // groups: ⋯ › New group…, another column joins it, it folds and opens, and undo takes it all back
  const made = await pickFrom(`${C} .col-menu`, 'New group…');
  const naming = await js(`!!document.querySelector('.col-group .group-name-input')`);
  await js(`(() => { const i = document.querySelector('.group-name-input'); if (i) { i.value = 'Important'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } })()`);
  await sleep(300);
  const joined = await pickFrom('.column[data-id="p2"] .col-menu', 'Move to group “Important”');
  const grp = await js(`(() => { const g = document.querySelector('.col-group'); return g && { name: g.querySelector('.group-name').textContent, cols: [...g.querySelectorAll('.column')].map((c) => c.dataset.id) }; })()`);
  check('⋯ › New group puts the column in a named group, and another column can join it', made && naming && joined && grp?.name === 'Important' && grp.cols.join() === `${NEW},p2` && savedProject('p2').group === 'Important', JSON.stringify(grp));
  await shot('11b-group');
  await js(`document.querySelector('.col-group .group-toggle').scrollIntoView({ inline: 'nearest' })`);
  await sleep(300);
  await clickSel('.col-group .group-toggle');
  await sleep(500);
  const foldedGroup = { w: (await rect('.col-group')).w, prefs: prefsNow().foldedGroups, hidden: await js(`document.querySelector('.column[data-id="p2"]').offsetWidth === 0`) };
  check('clicking the group name folds its columns into a strip (kept on this computer only)', foldedGroup.w < 60 && JSON.stringify(foldedGroup.prefs) === '["Important"]' && foldedGroup.hidden, JSON.stringify(foldedGroup));
  await clickSel('.col-group .group-strip');
  await sleep(500);
  check('a click on the strip opens the group again', !('foldedGroups' in prefsNow()) && await js(`document.querySelector('.column[data-id="p2"]').offsetWidth > 200`));
  key('Z', [MOD]);
  await sleep(400);
  key('Z', [MOD]);
  await sleep(500);
  check('Ctrl+Z takes both columns out of the group again, p2 back in its place', !(await js(`!!document.querySelector('.col-group')`)) && !('group' in savedProject('p2')) && (await js(`[...document.querySelectorAll('.column')].map((c) => c.dataset.id).slice(0, 2).join()`)) === 'p1,p2');

  // Soft theme: column headers are a little deeper than the light accent tint (1.18)
  const softHead = await js(`(() => {
    document.body.classList.replace('theme-deep', 'theme-soft');
    const c = document.querySelector('.column[data-id="p1"]');
    // rgb(…) in 0–255, or color(srgb …) in 0–1 (what color-mix() can compute to): channels summed in 0–765
    const sum = (v) => { const n = (v.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); return n.reduce((a, b) => a + b, 0) * (v.startsWith('color(') ? 255 : 1); };
    const r = { head: sum(getComputedStyle(c.querySelector('.col-head')).backgroundColor) };
    const probe = document.createElement('div');
    probe.style.background = 'var(--accent-tint)';
    c.appendChild(probe);
    r.tint = sum(getComputedStyle(probe).backgroundColor);
    probe.remove();
    document.body.classList.replace('theme-soft', 'theme-deep');
    return r;
  })()`);
  check('Soft theme: column headers are deeper than the light accent tint', softHead.head > 0 && softHead.head < softHead.tint - 30, JSON.stringify(softHead));
  await pickFrom(`${C} .col-menu`, 'Delete project');
  await js('document.querySelector("#board").scrollLeft = 0'); // the checks after this one aim at the first columns
  await sleep(300);

  await shot('11-final-board');

  // ---------------------------------------------------------------- 1.19: the Eating strip shows every column, and the widget
  // three columns eating at once: the 1.18 strip showed only two chips and hid the rest
  const EIDS = await js(`[...document.querySelectorAll('.column')].filter((c) => c.querySelector('.active-list .card-wrap')).slice(0, 3).map((c) => c.dataset.id)`);
  for (const id of EIDS) {
    const S = `.column[data-id="${id}"]`;
    await js(`document.querySelector('${S} .active-list .card-wrap .act-used').click()`);
    await sleep(300);
    await js(`document.querySelector('${S} .aug-move').click()`);
    await sleep(400);
    await js(`document.querySelector('${S} .eat-btn').click()`);
    await sleep(200);
  }
  await sleep(500);
  const strip = await js(`(() => {
    const bar = document.querySelector('#eating').getBoundingClientRect();
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const chips = [...document.querySelectorAll('#eating .eat-chip')];
    return {
      n: chips.length,
      whole: chips.every((c) => { const r = c.getBoundingClientRect(); return r.width > 80 && r.left >= bar.left - 1 && r.right <= bar.right + 1 && r.left >= stage.left && r.right <= stage.right && r.bottom <= stage.bottom; }),
      done: chips.every((c) => c.querySelector('.eat-done')?.textContent.trim() === 'Done'),
      count: document.querySelector('#eating-count').textContent,
      clear: Math.max(...[...document.querySelectorAll('.column')].map((c) => c.getBoundingClientRect().bottom)) <= bar.top + 1,
      // 1.20.3: the board's scrollbar (28 px) runs under the strip's foot; the strip stays above it
      scrollbar: (() => { const b = document.querySelector('#board'); return { h: b.offsetHeight - b.clientHeight, top: b.getBoundingClientRect().bottom - (b.offsetHeight - b.clientHeight) }; })(),
      stripBottom: bar.bottom,
    };
  })()`);
  check('1.19: with 3 columns eating, every chip shows in full with its Done, and the label counts 3', EIDS.length === 3 && strip.n === 3 && strip.whole && strip.done && strip.count === '3', JSON.stringify({ EIDS, ...strip }));
  check('1.19: the bigger strip still sits below every column', strip.clear);
  check('1.20.3: the board scrollbar is 28 px, and the Eating strip sits above it, not on it', strip.scrollbar.h === 28 && strip.stripBottom <= strip.scrollbar.top - 4, JSON.stringify({ scrollbar: strip.scrollbar, stripBottom: strip.stripBottom }));
  await shot('12-eating-three');

  // the widget: the window becomes a small always-on-top one with a single column, and comes back.
  // main's resizes are kept off the owner's screen here; the sizes it asks for are recorded.
  const asked = [];
  const realSetBounds = win.setBounds.bind(win);
  const realSetSize = win.setSize.bind(win);
  const realCenter = win.center.bind(win);
  win.setBounds = (b) => { asked.push({ w: b.width, h: b.height }); realSetBounds(offscreenRect(b.width, b.height)); };
  win.setSize = (w, h) => { asked.push({ w, h }); realSetBounds(offscreenRect(w, h)); };
  win.center = () => {};
  const settingsNow = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-settings.json'), 'utf8'));
  await fromMenu('#widget-toggle');
  await sleep(900);
  const wid = await js(`({ on: document.body.classList.contains('is-widget'), cols: [...document.querySelectorAll('#board > .column')].map((c) => c.dataset.id), pick: document.querySelector('#widget-pick').hidden ? null : document.querySelector('.widget-pick-name').textContent, search: getComputedStyle(document.querySelector('.search')).display, chipNames: [...document.querySelectorAll('#eating .eat-name')].every((n) => getComputedStyle(n).display === 'none') })`);
  const widName = wid.cols[0] && savedProject(wid.cols[0])?.name;
  check('1.19: the widget button turns the window into a widget: one column, a picker with its name, no search', wid.on && wid.cols.length === 1 && wid.pick === widName && wid.search === 'none', JSON.stringify(wid));
  check('1.19: main makes the widget small and always on top, and remembers it', asked.at(-1)?.w === 360 && win.isAlwaysOnTop() && settingsNow().widget === true && settingsNow().widgetProject === wid.cols[0], JSON.stringify({ asked, top: win.isAlwaysOnTop(), widget: settingsNow().widget }));
  check('1.19: in the widget the eating chips shrink to badges', wid.chipNames);
  await shot('12b-widget');
  await clickSel('#widget-pick');
  await sleep(250);
  const pickItems = await texts('.menu .menu-item');
  const other = EIDS.find((id) => id !== wid.cols[0]);
  const otherName = savedProject(other).name;
  await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith(${JSON.stringify(otherName)})).click()`);
  await sleep(400);
  const switched = await js(`({ cols: [...document.querySelectorAll('#board > .column')].map((c) => c.dataset.id), pick: document.querySelector('.widget-pick-name').textContent })`);
  check('1.19: the picker lists the columns and switches the widget to another', pickItems.length >= 4 && switched.cols.join() === other && switched.pick === otherName && settingsNow().widgetProject === other, JSON.stringify({ pickItems: pickItems.length, switched }));
  await fromMenu('#widget-toggle');
  await sleep(900);
  const back = await js(`({ on: document.body.classList.contains('is-widget'), cols: document.querySelectorAll('#board > .column, #board .col-group .column').length })`);
  check('1.19: the same button goes back to the full board at its old size, not on top', !back.on && back.cols > 3 && asked.at(-1)?.w > 400 && !win.isAlwaysOnTop() && settingsNow().widget === false, JSON.stringify({ back, asked: asked.at(-1) }));
  win.setBounds = realSetBounds;
  win.setSize = realSetSize;
  win.center = realCenter;
  win.setBounds(offscreenRect());
  await sleep(400);

  // put the three columns back: stop eating (not undoable), then undo the moves
  for (const id of EIDS) {
    await js(`document.querySelector('.column[data-id="${id}"] .eat-btn').click()`);
    await sleep(200);
    await js(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith('Stop eating')).click()`);
    await sleep(200);
  }
  for (let i = 0; i < EIDS.length * 2; i++) { key('Z', [MOD]); await sleep(250); }
  await sleep(400);
  check('1.19: stopping and undoing leaves the three columns as they were', await js(`document.querySelector('#eating').hidden`) && EIDS.every((id) => !savedProject(id).combined.length && !('eating' in savedProject(id))));
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(300);

  // ---------------------------------------------------------------- 1.20: minimize syncs, columns and groups drag freely, the notepad

  // 1.20.1: a calmer top bar: a labelled Notepad pill, +, undo / redo and a ☰ menu holding the rest
  const topBar = await js(`(() => {
    const top = document.querySelector('.topbar');
    const pill = document.querySelector('#open-notepad');
    return {
      moved: ['open-eaten', 'widget-toggle', 'reset-widths', 'open-help', 'open-settings'].every((id) => !top.contains(document.getElementById(id)) && document.getElementById(id).closest('#app-menu')),
      closed: document.querySelector('#app-menu').hidden,
      pill: pill.textContent.trim(), pillW: Math.round(pill.getBoundingClientRect().width),
      tinted: getComputedStyle(pill).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(pill).borderTopWidth !== '0px',
    };
  })()`);
  check('1.20.1: Eaten, the widget, Reset column widths, help and settings left the top bar for the ☰ menu', topBar.moved && topBar.closed, JSON.stringify(topBar));
  check('1.20.1: the notepad is a labelled, tinted pill in the top bar', topBar.pill === 'Notepad' && topBar.pillW > 80 && topBar.tinted, JSON.stringify(topBar));
  await clickSel('#app-menu-btn');
  await sleep(250);
  const menuOpen = await js(`({ open: !document.querySelector('#app-menu').hidden, rows: [...document.querySelectorAll('#app-menu .menu-item')].filter((b) => !b.hidden).map((b) => b.querySelector('.app-menu-label').textContent) })`);
  await shot('13d-app-menu');
  key('Escape');
  await sleep(250);
  const escClosed = await js(`document.querySelector('#app-menu').hidden`);
  await clickSel('#app-menu-btn');
  await sleep(200);
  await click(40, 400); // the board, away from the menu
  await sleep(250);
  check('1.20.1: ☰ opens the menu (widget, column widths, help, settings); Esc or a click away closes it', menuOpen.open && menuOpen.rows.join('|') === 'Widget: a small window on top|Reset column widths|How Recaller works|Settings' && escClosed && await js(`document.querySelector('#app-menu').hidden`), JSON.stringify({ menuOpen, escClosed }));
  check('1.20.1: the notepad page shows its own dark I-beam pointer (the system one could vanish over it)', /^url\(/.test(await js(`getComputedStyle(document.querySelector('#notepad-text')).cursor`)));
  const boardOrder = () => js(`[...document.querySelectorAll('#board > .column, #board > .col-group')].map((n) => n.dataset.id || 'G:' + n.dataset.group).join()`);
  const savedOrder = () => savedData().projects.filter((p) => !p.notepad).map((p) => p.id + (p.group ? '@' + p.group : '')).join();
  check('1.20.4: a column minimized by 1.18–1.19 (`localMinimized`) is saved as the synced `minimized` at start', savedProject('pad').minimized === true && !('localMinimized' in savedProject('pad')));
  check('1.20: "minimized" is a synced project field (the old "localMinimized" stays on one computer)', await js(`window.SyncApply.isLocalKey('minimized') === false && window.SyncApply.isLocalKey('localMinimized') === true`));
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(300);
  const order0 = savedOrder();
  await pickFrom('.column[data-id="p2"] .col-menu', 'New group…');
  await js(`(() => { const i = document.querySelector('.group-name-input'); if (i) { i.value = 'Lane'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } })()`);
  await sleep(300);
  await pickFrom('.column[data-id="p3"] .col-menu', 'Move to group “Lane”');
  // the whole group, dragged by its band to the far left (the 1.18 group could only move from its ⋯)
  const band = await rect('.col-group .group-name');
  const p1box = await rect('.column[data-id="p1"]');
  mouse('mouseMove', band.cx, band.cy, { modifiers: [] });
  mouse('mouseDown', band.cx, band.cy);
  await drag(band.cx, band.cy, p1box.x + 20, band.cy + 6, 16, 20);
  await sleep(350);
  const midGroup = await js(`({ ghost: document.querySelector('.drag-ghost .group-ghost-name')?.textContent, slot: !!document.querySelector('#board > .group-placeholder'), quiet: document.body.classList.contains('is-col-drag') })`);
  await shot('13a-group-drag');
  mouse('mouseUp', p1box.x + 20, band.cy + 6);
  await sleep(700);
  const afterGroup = await boardOrder();
  check('1.20: a group drags by its band (a small ghost with its name, a slot its size) and lands before p1', midGroup.ghost === 'Lane' && midGroup.slot && midGroup.quiet && afterGroup.startsWith('G:Lane,p1') && savedOrder().startsWith('p2@Lane,p3@Lane,p1'), JSON.stringify({ midGroup, afterGroup, saved: savedOrder() }));
  check('1.20: the release that ends a group drag doesn’t fold the group', !('foldedGroups' in prefsNow()) && !(await js(`document.querySelector('.col-group').classList.contains('is-folded')`)));
  // a column dragged by its header into the group's lane joins the group
  const lane = await rect('.col-group');
  const p1head = await rect('.column[data-id="p1"] .col-name');
  mouse('mouseMove', p1head.cx, p1head.cy, { modifiers: [] });
  mouse('mouseDown', p1head.cx, p1head.cy);
  await drag(p1head.cx, p1head.cy, lane.x + lane.w / 2, p1head.cy + 6, 18, 20);
  await sleep(350);
  const intoSlot = await js(`!!document.querySelector('.col-group .group-cols > .col-placeholder')`);
  await shot('13b-column-into-group');
  mouse('mouseUp', lane.x + lane.w / 2, p1head.cy + 6);
  await sleep(700);
  const intoToast = (await texts('.toast')).some((t) => t.startsWith('Added to “Lane”'));
  check('1.20: a column dragged into a group joins it (its slot shows inside the lane), with an Undo toast', intoSlot && savedProject('p1').group === 'Lane' && intoToast, JSON.stringify({ intoSlot, saved: savedOrder(), intoToast }));
  // and dragged out past the lane's right side, it leaves the group
  const lane2 = await rect('.col-group');
  const p3head = await rect('.column[data-id="p3"] .col-name');
  mouse('mouseMove', p3head.cx, p3head.cy, { modifiers: [] });
  mouse('mouseDown', p3head.cx, p3head.cy);
  await drag(p3head.cx, p3head.cy, lane2.x + lane2.w + 60, p3head.cy + 6, 18, 20);
  await sleep(350);
  mouse('mouseUp', lane2.x + lane2.w + 60, p3head.cy + 6);
  await sleep(700);
  const outToast = (await texts('.toast')).some((t) => t.startsWith('Taken out of “Lane”'));
  check('1.20: a column dragged out of its group leaves it, after the group', !('group' in savedProject('p3')) && outToast && (await boardOrder()).startsWith('G:Lane,'), JSON.stringify({ saved: savedOrder(), outToast }));
  // ⋯ › Move left on the group's first column steps out of the group, to just before it
  const first = await js(`document.querySelector('.col-group .group-cols > .column').dataset.id`);
  const outLeft = await pickFrom(`.column[data-id="${first}"] .col-menu`, 'Move left, out of “Lane”');
  check('1.20: ⋯ › Move left at a group’s edge reads "out of" the group and takes the column out', outLeft && !('group' in savedProject(first)) && (await boardOrder()).startsWith(`${first},G:Lane`), JSON.stringify({ first, order: await boardOrder() }));
  // New group, its rename, p3 joins, the group drag, p1 in, p3 out, the menu's move out: 7 steps
  for (let i = 0; i < 7; i++) { key('Z', [MOD]); await sleep(250); }
  await sleep(500);
  check('1.20: undo puts the columns and the group back as they were', savedOrder() === order0 && !(await js(`!!document.querySelector('.col-group')`)), JSON.stringify({ order0, now: savedOrder() }));

  // 1.20.2: minimized columns are rows with their names across; side by side they share one stack
  await pickFrom('.column[data-id="p2"] .col-menu', 'Minimize column');
  await pickFrom('.column[data-id="p3"] .col-menu', 'Minimize column');
  const stack = await js(`(() => {
    const boxes = [...document.querySelectorAll('#board > .mini-stack')];
    const rows = boxes.flatMap((b) => [...b.querySelectorAll(':scope > .column')]);
    const name = rows[0]?.querySelector('.col-name');
    return { boxes: boxes.length, rows: rows.map((r) => r.dataset.id), across: name && getComputedStyle(name).writingMode === 'horizontal-tb',
      whole: name && name.scrollWidth <= name.clientWidth + 1, w: Math.round(rows[0]?.getBoundingClientRect().width), h: Math.round(rows[0]?.getBoundingClientRect().height) };
  })()`);
  check('1.20.2: two minimized columns side by side share one stack, as rows with their names across', stack.boxes === 1 && stack.rows.join() === 'p2,p3' && stack.across && stack.whole && stack.w > 150 && stack.h < 60, JSON.stringify(stack));
  const stackFit = await js(`(() => { const s = document.querySelector('.mini-stack'); const st = getComputedStyle(s); return { overflow: st.overflowY, max: st.maxHeight, inside: s.getBoundingClientRect().bottom <= document.querySelector('#board').getBoundingClientRect().bottom }; })()`);
  check('1.20.3: a stack never runs past the board: it scrolls on its own (a small window)', stackFit.overflow === 'auto' && stackFit.max !== 'none' && stackFit.inside, JSON.stringify(stackFit));
  await shot('13e-minimized-stack');
  // a row drags like a column: p3 to the far left, out of the stack and still minimized
  const row3 = await rect('.column[data-id="p3"] .col-head');
  const p1left = await rect('.column[data-id="p1"]');
  mouse('mouseMove', row3.cx, row3.cy, { modifiers: [] });
  mouse('mouseDown', row3.cx, row3.cy);
  await drag(row3.cx, row3.cy, p1left.x + 10, row3.cy + 4, 16, 20);
  await sleep(300);
  mouse('mouseUp', p1left.x + 10, row3.cy + 4);
  await sleep(700);
  const afterRow = { order: savedOrder(), stacks: await js(`[...document.querySelectorAll('#board > .mini-stack')].map((b) => [...b.children].map((c) => c.dataset.id).join('+')).join()`), still: savedProject('p3').minimized === true, open: await js(`!document.querySelector('.column[data-id="p3"]').classList.contains('is-minimized')`) };
  check('1.20.2: a minimized row drags out of its stack (and stays minimized; the release doesn’t open it)', afterRow.order.startsWith('p3,p1') && afterRow.still && !afterRow.open && afterRow.stacks === 'p3,p2', JSON.stringify(afterRow));
  key('Z', [MOD]); // the reorder
  await sleep(400);
  await clickSel('.column[data-id="p2"] .col-head');
  await sleep(400);
  await clickSel('.column[data-id="p3"] .col-head');
  await sleep(500);
  check('1.20.2: a click on a row opens its column; the stack goes when nothing is minimized', !(await js(`!!document.querySelector('.mini-stack')`)) && !('minimized' in savedProject('p2')) && !('minimized' in savedProject('p3')) && savedOrder() === order0, JSON.stringify({ order: savedOrder() }));

  // the notepad: one scratch page (seeded with a page and another computer's version)
  const colsBefore = await js(`document.querySelectorAll('.column').length`);
  check('1.20: the notepad never shows up as a column', !(await js(`[...document.querySelectorAll('.col-name')].some((n) => n.textContent === 'Notepad')`)));
  key('J', [MOD]);
  await sleep(450);
  const padOpen = await js(`({ open: document.querySelector('#notepad-panel').classList.contains('is-open'), focus: document.activeElement?.id, value: document.querySelector('#notepad-text').value, others: document.querySelectorAll('.notepad-other').length })`);
  check('1.20: Ctrl+J opens the notepad with the page, the cursor in it, and the other version under it', padOpen.open && padOpen.focus === 'notepad-text' && padOpen.value === 'Seeded page' && padOpen.others === 1, JSON.stringify(padOpen));
  await type(' and a random note');
  await sleep(900);
  const padSaved = () => savedData().projects.find((p) => p.notepad);
  check('1.20: what you type saves by itself, into the hidden Notepad project', padSaved()?.notes[0].text === 'Seeded page and a random note' && (await js(`document.querySelectorAll('.column').length`)) === colsBefore && /^Saved/.test(await js(`document.querySelector('#notepad-status').textContent`)), JSON.stringify(padSaved()?.notes.map((x) => x.text)));
  await shot('13c-notepad');
  await clipboard.writeText('');
  await clickSel('#notepad-copy');
  await sleep(300);
  check('1.20: Copy copies the whole page', (await clipboard.readText()) === 'Seeded page and a random note');
  await js(`document.querySelector('.notepad-other .notepad-take').click()`);
  await sleep(900);
  check('1.20: "Add to the page" adds the other version to the end of the page, and it’s gone from under it', padSaved()?.notes.length === 1 && padSaved().notes[0].text === 'Seeded page and a random note\n\nFrom the other computer' && !(await js(`document.querySelectorAll('.notepad-other').length`)), JSON.stringify(padSaved()?.notes.map((x) => x.text)));
  key('Escape');
  await sleep(350);
  check('1.20: Esc closes the notepad', !(await js(`document.querySelector('#notepad-panel').classList.contains('is-open')`)));
  // a board change and its undo leave the notepad alone
  await clickSel('#new-column');
  await sleep(500);
  key('Escape');
  await sleep(300);
  key('Z', [MOD]);
  await sleep(500);
  check('1.20: undoing a board change leaves the notepad as typed', (await js(`document.querySelectorAll('.column').length`)) === colsBefore && padSaved()?.notes[0].text === 'Seeded page and a random note\n\nFrom the other computer', JSON.stringify(padSaved()?.notes.map((x) => x.text)));
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(300);

  // ---------------------------------------------------------------- macOS only: the Mac edition's own behaviour
  // Each check puts back what it changes. The reload comes last, where it can't upset the checks after it.
  if (IS_MAC) {
    const { Menu } = require('electron');
    const clearComposer = () => js(`(() => { const t = document.querySelector('.composer textarea'); if (t) { t.value = ''; t.dispatchEvent(new Event('input')); } })()`);

    // the logo clears the traffic lights (three buttons, 54 pt from x) and is level with their centre (16 pt tall: y + 8)
    const lights = win.getWindowButtonPosition();
    const brand = await rect('.brand');
    const titleBar = await js(`(() => { const p = document.createElement('div'); p.style.cssText = 'position: fixed; visibility: hidden; left: env(titlebar-area-x, -1px)'; document.body.appendChild(p); const areaX = getComputedStyle(p).left; p.remove(); return { areaX, padLeft: getComputedStyle(document.querySelector('.topbar')).paddingLeft }; })()`);
    console.log(`INFO  Mac title bar, for tuning: env(titlebar-area-x) ${titleBar.areaX}, top bar padding-left ${titleBar.padLeft}, getWindowButtonPosition() ${JSON.stringify(lights)}`);
    check('Mac: the logo clears the traffic lights and is vertically centred with them', Boolean(lights) && brand.x >= lights.x + 54 + 8 && Math.abs(brand.cy - (lights.y + 8)) <= 3, `logo x ${Math.round(brand.x)}, centre y ${Math.round(brand.cy)} | lights ${JSON.stringify(lights)}`);

    // key names: ⌘K in the search box, ⌘ all through Help (where F1 is ?), ⌘, on Settings and ⌘Z on Undo
    const macKeys = await js(`({ search: document.querySelector('.search kbd').textContent, help: [...document.querySelectorAll('#help kbd:not(#help-hotkey)')].map((k) => k.textContent), settings: document.querySelector('#open-settings').title, undo: document.querySelector('#undo').title })`);
    check('Mac: key names use ⌘ (search box, Help, Settings and Undo)', macKeys.search === '⌘K' && macKeys.help.every((t) => t.includes('⌘') || t === '?') && macKeys.settings.includes('⌘,') && macKeys.undo.includes('⌘Z'), JSON.stringify(macKeys));

    // Control+click (the real Control key, not MOD) is a right-click on a Mac: it edits, and neither copies nor selects
    await js('window.getSelection().removeAllRanges()');
    await clipboard.writeText('');
    const cc = await rect('.column[data-id="p2"] .active-list .card', 0);
    mouse('mouseMove', cc.cx, cc.cy, { modifiers: ['control'] }); mouse('mouseDown', cc.cx, cc.cy, { modifiers: ['control'] });
    await sleep(40);
    mouse('mouseUp', cc.cx, cc.cy, { modifiers: ['control'] });
    await sleep(300);
    const ctrlRc = await js(`({ editor: !!document.querySelector('.column[data-id="p2"] .card-wrap.is-editing .composer'), selected: document.querySelectorAll('.card-wrap.is-selected').length, bar: !document.querySelector('#selection-bar').hidden })`);
    ctrlRc.clip = await clipboard.readText();
    key('Escape');
    await sleep(250);
    check('Mac: Control+click on a card opens its editor, without copying or selecting it', ctrlRc.editor && !ctrlRc.selected && !ctrlRc.bar && ctrlRc.clip === '', JSON.stringify(ctrlRc));

    // a real right-click on the Served text: the Mac selects the word under it before contextmenu, and the editor must still open
    const scroll0 = await js(`[document.querySelector('#board').scrollLeft, document.querySelector('.column[data-id="px1"] .col-scroll').scrollTop]`);
    await js(`document.querySelector('.column[data-id="px1"] .final-text').scrollIntoView({ block: 'center', inline: 'center' })`);
    await sleep(300);
    await js('window.getSelection().removeAllRanges()');
    const served = await finalOf('px1');
    const st = await rect('.column[data-id="px1"] .final-text');
    mouse('mouseMove', st.cx, st.cy, { modifiers: [] }); mouse('mouseDown', st.cx, st.cy, { button: 'right' });
    await sleep(40);
    mouse('mouseUp', st.cx, st.cy, { button: 'right' });
    await sleep(300);
    const rightRc = [await js(`document.querySelector('.column[data-id="px1"] .final').classList.contains('is-editing')`), await composerValue()];
    key('Escape');
    await sleep(250);
    await js(`document.querySelector('#board').scrollLeft = ${scroll0[0]}; document.querySelector('.column[data-id="px1"] .col-scroll').scrollTop = ${scroll0[1]}`);
    await sleep(200);
    check('Mac: a real right-click on the Served text opens its editor, not the Copy menu', rightRc[0] && rightRc[1] === served && (await finalOf('px1')) === served, JSON.stringify({ editing: rightRc[0], text: String(rightRc[1]).slice(0, 30) }));

    // the menu bar: 4 menus; Window › Minimize has no ⌘M (that is Dictate in the page, and a minimize role would
    // bring it along); Edit › Undo while typing in an editor undoes the typing and leaves the board's history alone
    const menu = Menu.getApplicationMenu();
    const windowMenu = menu?.items.find((i) => String(i.role).toLowerCase() === 'window');
    const minimize = windowMenu?.submenu?.items.find((i) => i.label === 'Minimize');
    const history0 = await js(`[document.querySelector('#undo').title, document.querySelector('#redo').title]`);
    await js(`document.querySelector('.column[data-id="px0"] .col-add').click()`);
    await sleep(250);
    await type('undoable');
    const typedIn = await composerValue();
    menu?.getMenuItemById('undo')?.click();
    await sleep(300);
    const undoneTo = await composerValue();
    const history1 = await js(`[document.querySelector('#undo').title, document.querySelector('#redo').title]`);
    await clearComposer();
    key('Escape');
    await sleep(250);
    check('Mac: 4 menus; Window › Minimize has no ⌘M; Edit › Undo in an editor undoes the typing, not the board', menu?.items.length === 4 && Boolean(minimize) && !minimize.accelerator && !minimize.role && typedIn === 'undoable' && undoneTo === '' && JSON.stringify(history1) === JSON.stringify(history0), JSON.stringify({ menus: menu?.items.map((i) => i.label), minimize: minimize ? minimize.accelerator || minimize.role || 'no key' : 'missing', typedIn, undoneTo }));

    // "Hide Recaller after copying" hides the app (app.hide, counted by the harness) instead of minimizing it
    const setHide = async (on) => {
      await js(`document.querySelector('#open-settings').click()`);
      await sleep(300);
      await js(`(() => { const c = document.querySelector('#set-hide'); if (c.checked !== ${on}) c.click(); })()`);
      await sleep(300);
      key('Escape');
      await sleep(250);
    };
    const hideLabel = await js(`document.querySelector('#set-hide').closest('label').textContent.trim()`);
    await setHide(true);
    const hides0 = macState.hides;
    await clipboard.writeText('');
    await js(`document.querySelector('.column[data-id="p1"] .active-list .card').focus({ preventScroll: true })`);
    key('Enter'); // copies the focused card
    await sleep(700);
    const hid = macState.hides - hides0;
    const hideClip = await clipboard.readText();
    await setHide(false);
    const hideOff = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-settings.json'), 'utf8')).hideAfterCopy === false;
    check('Mac: "Hide Recaller after copying" hides the app (app.hide) instead of minimizing it', hid === 1 && !win.isMinimized() && hideClip.length > 0 && hideOff, JSON.stringify({ hideLabel, hid, minimized: win.isMinimized(), clip: hideClip.slice(0, 20), hideOff }));

    // ⌘H on a focused card is left to the menu (Hide Recaller) and doesn't toggle the highlight. Sent as a DOM
    // event: a real ⌘H that the page leaves alone goes on to the menu, which would hide this test app.
    const hlWrap = `document.querySelector('.column[data-id="p2"] .active-list .card-wrap')`;
    const hl0 = await js(`${hlWrap}.classList.contains('is-hl')`);
    const cmdHLeft = await js(`(() => { const c = ${hlWrap}.querySelector('.card'); c.focus({ preventScroll: true }); return c.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', metaKey: true, bubbles: true, cancelable: true })); })()`);
    await sleep(300);
    const hl1 = await js(`${hlWrap}.classList.contains('is-hl')`);
    check('Mac: ⌘H on a focused card leaves its highlight alone (the menu hides the app)', hl1 === hl0 && cmdHLeft, JSON.stringify({ before: hl0, after: hl1, leftForMenu: cmdHLeft }));

    // a draft typed right before a reload (as before ⌘Q) is kept: the page goes before its 400 ms save runs
    await js(`document.querySelector('.column[data-id="px0"] .col-add').click()`);
    await sleep(250);
    await type('Draft kept on quit');
    const draftTyped = await composerValue();
    wc.reload();
    await new Promise((r) => wc.once('did-finish-load', r));
    await sleep(1200);
    const draftSaved = savedProject('px0').draft;
    const draftDot = await js(`document.querySelector('.column[data-id="px0"] .col-add').classList.contains('has-draft')`);
    check('Mac: a draft typed right before a reload (or ⌘Q) is saved', draftTyped === 'Draft kept on quit' && draftSaved === draftTyped && draftDot, JSON.stringify({ draftTyped, draftSaved, draftDot }));
    await js(`document.querySelector('.column[data-id="px0"] .col-add').click()`); // and px0 has no draft again
    await sleep(250);
    await clearComposer();
    key('Escape');
    await sleep(250);
  }

  // ---------------------------------------------------------------- real screen snip (last: it captures the actual screen; not viewed)
  if (IS_MAC) {
    // macOS would ask for Screen Recording permission first, and the snip would capture the owner's screen
    console.log('SKIP  real screen snip (3 checks): on a Mac it needs Screen Recording permission and would capture your screen');
  } else {
    await clickSel('.column[data-id="p1"] .col-add');
    await sleep(250);
    await clickSel('.composer .shot-btn');
    let overlay = null;
    for (let t = 0; t < 50 && !overlay; t++) {
      await sleep(100);
      overlay = BrowserWindow.getAllWindows().find((w) => w !== win && w.isVisible());
    }
    check('screenshot overlay opens (Recaller hides)', Boolean(overlay) && !win.isVisible());
    if (overlay) {
      await sleep(300);
      const omouse = mouseOn(overlay.webContents);
      omouse('mouseMove', 40, 40, { modifiers: [] }); omouse('mouseDown', 40, 40);
      await drag(40, 40, 360, 240, 8, 16, (x, y) => omouse('mouseMove', x, y, { modifiers: ['leftButtonDown'] }));
      omouse('mouseUp', 360, 240);
    }
    let attached = 0;
    for (let t = 0; t < 40 && !attached; t++) { await sleep(100); attached = await js(`document.querySelectorAll('.composer .attach').length`); }
    check('snip attaches to the composer and Recaller comes back', attached === 1 && win.isVisible());
    const imgFiles = fs.readdirSync(path.join(DATA_DIR, 'images'));
    check('snip stored as full PNG + thumbnail', imgFiles.filter((f) => f.endsWith('.t.png')).length >= 2 && imgFiles.filter((f) => !f.endsWith('.t.png')).length >= 2, imgFiles.length + ' files');
    key('Escape');
    await sleep(200);
  }

  // ---------------------------------------------------------------- persistence
  await sleep(600);
  const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8'));
  const p3 = saved.projects.find((p) => p.id === 'p3');
  check('data persisted (v2, images on notes, density pref)', saved.version === 2 && p3.notes[p3.notes.length - 1].images.length === 1 && saved.prefs.density === 'slim');
  check('no renderer console errors', errors.length === 0, errors.join(' | '));

  // The snip contains the real screen — don't keep it around.
  fs.rmSync(path.join(DATA_DIR, 'images'), { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  server.close();
  app.exit(failed ? 1 : 0);
}
