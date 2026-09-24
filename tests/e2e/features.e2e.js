'use strict';
// Drives the real Recaller app with synthetic input against a temp data dir,
// a mock OpenAI server (streamed SSE replies) and a fake microphone that plays
// speech-like bursts separated by pauses.

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { app, BrowserWindow, clipboard, screen } = require('electron');

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const DATA_DIR = path.join(SCRATCH, 'data2');
const SHOTS = path.join(SCRATCH, 'shots2');
const APP_MAIN = process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js');
if (!fs.existsSync(APP_MAIN)) { console.error(`HARNESS FAIL: no app at ${APP_MAIN} (APP_MAIN must be a Windows path)`); process.exit(1); }
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
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let placed = 0;
function offscreenRect(W = 1360, H = 860) {
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
  key('Enter', ['control']);
  await sleep(400);
  const afterSave = await js(`[!!document.querySelector('.column[data-id="p1"] .col-compose .composer'), document.querySelector('.column[data-id="p1"] .col-new').hidden]`);
  check('saving a new prompt closes the editor and shows the buttons again', !afterSave[0] && !afterSave[1] && (await colTexts('p1')).pop() === 'Temporary prompt', JSON.stringify(afterSave));
  key('Z', ['control']); // take "Temporary prompt" out again
  await sleep(300);

  // ---------------------------------------------------------------- Cooking: a stage header like the others; New prompt | Dictate in halves
  const bar = await js(`(() => {
    const c = document.querySelector('.column[data-id="p1"]');
    const a = c.querySelector('.col-add').getBoundingClientRect();
    const m = c.querySelector('.col-mic').getBoundingClientRect();
    const lbl = c.querySelector('.col-add .np-label');
    return { add: Math.round(a.width), mic: Math.round(m.width), micLabel: c.querySelector('.col-mic').textContent.trim(), fits: lbl.scrollWidth <= lbl.clientWidth + 1 };
  })()`);
  check('New prompt and Dictate share the bar in equal halves, both fully labelled', Math.abs(bar.add - bar.mic) <= 1 && bar.mic > 100 && bar.micLabel === 'Dictate' && bar.fits, JSON.stringify(bar));
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
  key('Enter', ['control']);
  await sleep(400);
  key('Escape');
  await sleep(250);
  check('a new prompt opens a folded Cooking so you can see it', !(await js(`document.querySelector('.column[data-id="p3"]').classList.contains('cooking-collapsed')`)) && (await colTexts('p3')).pop() === 'Quick one');
  key('Z', ['control']); // remove "Quick one" again
  await sleep(300);
  // long project name: wraps to two lines and never runs under the options button
  await js(`document.querySelector('.column[data-id="p3"] .col-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(150);
  await js(`(() => { const i = document.querySelector('.column[data-id="p3"] .col-name-input'); i.value = 'Computer Vision and Robotics Research Notes for the Thesis'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(250);
  const nameBox = await rect('.column[data-id="p3"] .col-name');
  const menuBox = await rect('.column[data-id="p3"] .col-menu');
  check('long project names wrap to two lines, clear of the options button', nameBox.h > 30 && nameBox.h < 44 && nameBox.x + nameBox.w <= menuBox.x + 1, `name ${Math.round(nameBox.w)}×${Math.round(nameBox.h)}, gap ${Math.round(menuBox.x - (nameBox.x + nameBox.w))}`);
  key('Z', ['control']);
  await sleep(250);
  const headBg = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .col-head')).backgroundImage`);
  const head2Bg = await js(`getComputedStyle(document.querySelector('.column[data-id="p2"] .col-head')).backgroundImage`);
  const usedBg = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .used')).backgroundColor`);
  const cardBg = await js(`getComputedStyle(document.querySelector('.card')).backgroundColor`);
  check('columns and sections have distinct colours', headBg !== head2Bg && usedBg !== cardBg, `${headBg} | ${head2Bg} | used ${usedBg} | card ${cardBg}`);
  const titleFamily = await js(`getComputedStyle(document.querySelector('.col-name')).fontFamily`);
  check('column titles use the new default font, Instrument Sans', /Instrument Sans/.test(titleFamily) && await js(`document.fonts.check('650 16px "Instrument Sans"')`), titleFamily);
  check('the top bar has no + Project button', !(await js(`!!document.querySelector('#new-project')`)) && await js(`!!document.querySelector('.column') && !!document.querySelector('.add-column')`));
  const emptyAug = await js(`(() => { const s = getComputedStyle(document.querySelector('.column[data-id="p2"] .used')); return [s.backgroundColor, s.borderTopStyle]; })()`);
  const emptyHelp = await js(`getComputedStyle(document.querySelector('.column[data-id="p2"] .aug-empty')).display`);
  check('an empty Cooked section is just its quiet name: no block, no helper sentence at rest', emptyAug[0] === 'rgba(0, 0, 0, 0)' && emptyHelp === 'none', `${emptyAug.join(' ')} | helper ${emptyHelp}`);
  const bodies = await js(`['p1', 'p2', 'p3'].map((id) => getComputedStyle(document.querySelector('.column[data-id="' + id + '"]')).backgroundColor)`);
  check('every column shares one calm background (colour stays in the headers)', new Set(bodies).size === 1, bodies.join(' | '));
  const band = await js(`getComputedStyle(document.querySelector('.column[data-id="p1"] .used-headrow')).backgroundImage`);
  const bandRgb = (band.match(/rgba?\(([^)]*)\)/) || [])[1]?.split(',').map(Number) || [];
  check('Cooked uses a muted slate band, not bright violet', bandRgb.length >= 3 && Math.max(...bandRgb.slice(0, 3)) - Math.min(...bandRgb.slice(0, 3)) < 50 && Math.max(...bandRgb.slice(0, 3)) < 120, band.slice(0, 60));
  await clickSel('#open-help');
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
  key('Z', ['control']);
  await sleep(400);
  check('Ctrl+Z restores deleted note', (await colTexts('p2')).some((t) => t.startsWith('Write alt text')));
  key('Y', ['control']);
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
    key('Enter', ['control']);
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
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Delta four'); key('Enter', ['control']); await sleep(200); key('Escape'); await sleep(150);
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
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Epsilon five'); key('Enter', ['control']); await sleep(200); key('Escape'); await sleep(150);
  await toAug(); await sleep(300);
  const partText = await augOf('px1');
  await js(`document.querySelector('.column[data-id="px1"] .aug-parts-btn').click()`);
  await sleep(200);
  await js(`document.querySelector('.column[data-id="px1"] .ap-back').click()`);
  await sleep(400);
  check('a prompt can be sent back out of Cooked', (await colTexts('px1')).includes(partText.split('\n')[0]) && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)));
  const stageColours = await js(`(() => {
    const c = (sel, prop = 'backgroundColor') => getComputedStyle(document.querySelector('.column[data-id="p1"] ' + sel))[prop];
    return [c('.active-list .card'), c('.used'), c('.final', 'backgroundImage'), c('.aug-note'), c('.final-body'), c('.used-headrow', 'backgroundImage')];
  })()`);
  check('new, Cooked and Served each look different (blocks, headers and inner notes)', new Set(stageColours.slice(0, 3)).size === 3 && new Set([stageColours[0], stageColours[3], stageColours[4]]).size === 3 && stageColours[5].includes('gradient'), stageColours.map((x) => x.slice(0, 40)).join(' | '));
  await shot('03b-stages');
  // separator setting
  await clickSel('#open-settings');
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
  check('the Served Notes list shows each part with move, edit and send-back buttons', (await partsOf('px1', '.final-parts')).length === 5 && await js(`['.fp-up', '.fp-down', '.fp-edit', '.fp-back'].every((s) => ${finalRow(0)}.querySelector(s))`));
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
  key('Enter', ['control']);
  await sleep(400);
  const editedFinal = finalNow.replace(/Delta four$/, 'Delta four edited');
  check('saving it changes only that part; the others stay separate', (await finalOf('px1')) === editedFinal && (await partsOf('px1', '.final-parts')).length === 5, JSON.stringify((await finalOf('px1')).slice(-30)));
  await clickSel('.column[data-id="px1"] .final-edit');
  await sleep(300);
  const wholeFinal = await composerValue();
  await type(' Done.');
  key('Enter', ['control']);
  await sleep(400);
  check('the Served pencil edits the whole text, saved as one note', wholeFinal === editedFinal && (await finalOf('px1')) === `${editedFinal} Done.` && (await partsOf('px1', '.final-parts')).length === 1);
  key('Z', ['control']);
  await sleep(300);
  key('Z', ['control']);
  await sleep(350);
  check('Ctrl+Z undoes both edits', (await finalOf('px1')) === finalNow && (await partsOf('px1', '.final-parts')).length === 5);
  await toAug(); await sleep(300); // Epsilon five → Cooked
  await js(`document.querySelector('.column[data-id="px1"] .aug-parts .fp-edit').click()`);
  await sleep(300);
  const partValue = await composerValue();
  await type(' plus');
  key('Enter', ['control']);
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
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Zeta six'); key('Enter', ['control']); await sleep(200); key('Escape'); await sleep(150);
  await clickSel('.column[data-id="px1"] .aug-edit');
  await sleep(300);
  await toAug(); await sleep(300); // Zeta six → Cooked, editor still open
  await js(`document.querySelector('.column[data-id="px1"] .aug-wrap .composer textarea').focus()`);
  await type(' again');
  key('Enter', ['control']);
  await sleep(400);
  check('a prompt added while the Cooked editor is open is not lost on save', (await augOf('px1')) === 'Epsilon five plus again\n\nZeta six', JSON.stringify(await augOf('px1')));
  key('Z', ['control']); await sleep(300); // the edit
  key('Z', ['control']); await sleep(300); // the move
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
  key('Z', ['control']);
  await sleep(350);
  check('Ctrl+Z brings the Served text back', (await finalOf('px1')) === finalNow);
  await menuPick('px1', 'Clear Cooked');
  check('Clear Cooked empties the Cooked note and leaves Served alone', (await augOf('px1')) === '' && (await finalOf('px1')) === finalNow);
  key('Z', ['control']);
  await sleep(350);

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
  key('Z', ['control']);
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
  key('Z', ['control']);
  await sleep(300);
  check('Ctrl+Z removes the highlight', !(await js(`document.querySelector('.column[data-id="p2"] .active-list .card-wrap').classList.contains('is-hl')`)));
  await js(`document.querySelector('.column[data-id="p2"] .active-list .card').focus()`);
  key('H');
  await sleep(300);
  check('H key toggles the highlight on a focused note', await js(`document.querySelector('.column[data-id="p2"] .active-list .card-wrap').classList.contains('is-hl')`));
  key('H');
  await sleep(250);

  // ---------------------------------------------------------------- Ctrl+click multi-copy
  const ctrlClick = async (r) => { mouse('mouseMove', r.cx, r.cy, { modifiers: ['control'] }); mouse('mouseDown', r.cx, r.cy, { modifiers: ['control'] }); await sleep(40); mouse('mouseUp', r.cx, r.cy, { modifiers: ['control'] }); await sleep(250); };
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
  key('Z', ['control']);
  await sleep(350);
  check('and Ctrl+Z puts them back', (await colTexts('p2')).includes(moving));

  // ---------------------------------------------------------------- live dictation
  await clickSel('.column[data-id="p1"] .col-mic');
  await sleep(700);
  check('mic starts recording from header', await js(`!!document.querySelector('.composer.is-recording')`));
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
  key('Enter', ['control']);
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
  key('Enter', ['control']);
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

  // ---------------------------------------------------------------- horizontal scrolling
  const sl0 = await js('document.querySelector("#board").scrollLeft');
  check('right scroll arrow visible when columns overflow', !(await js(`document.querySelector('#pan-right').hidden`)));
  await clickSel('#pan-right');
  await sleep(600);
  const sl1 = await js('document.querySelector("#board").scrollLeft');
  check('arrow scrolls by about one column', sl1 - sl0 > 200, `${sl0} → ${sl1}`);
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
  await clickSel('#open-settings');
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

  // ---------------------------------------------------------------- resize columns, then reset them from the top bar
  const prefsNow = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'recaller-data.json'), 'utf8')).prefs;
  const widthOf = async (id) => (await rect(`.column[data-id="${id}"]`)).w;
  await js('document.querySelector("#board").scrollLeft = 0');
  await sleep(150);
  check('reset-widths button sits in the top bar, off while no column is resized', await js(`document.querySelector('.topbar #reset-widths').disabled`));
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
  await clickSel('#reset-widths');
  await sleep(700);
  check('the top-bar button puts every column back to the default width', Math.abs((await widthOf('p1')) - w0) < 1 && Math.abs((await widthOf('p2')) - w0) < 1 && !('colWidths' in prefsNow()) && await js(`document.querySelector('#reset-widths').disabled`));
  await js(`[...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Column widths reset')).querySelector('.toast-action').click()`);
  await sleep(700);
  check('Undo on its toast brings the widths back', Math.abs((await widthOf('p1')) - w1) < 1 && (prefsNow().colWidths || {}).p1 === Math.round(w1));
  await js(`document.querySelector('.column[data-id="p1"] .col-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(700);
  check('double-clicking a column edge resets just that column', Math.abs((await widthOf('p1')) - w0) < 1 && Math.abs((await widthOf('p2')) - w2) < 1 && !((prefsNow().colWidths || {}).p1));
  await clickSel('#reset-widths');
  await sleep(500);

  // ---------------------------------------------------------------- column drag + undo
  const h1 = await rect('.column[data-id="p1"] .col-name');
  const col2 = await rect('.column[data-id="p2"]');
  mouse('mouseMove', h1.cx, h1.cy, { modifiers: [] }); mouse('mouseDown', h1.cx, h1.cy);
  await drag(h1.cx, h1.cy, col2.x + col2.w * 0.8, h1.cy + 10, 16, 18);
  mouse('mouseUp', col2.x + col2.w * 0.8, h1.cy + 10);
  await sleep(450);
  const order1 = await js(`[...document.querySelectorAll('.column')].map(c => c.dataset.id).slice(0, 2).join(',')`);
  key('Z', ['control']);
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
  key('Z', ['control']);
  await sleep(700);
  check('Sort prompts oldest first reorders by date, and Ctrl+Z undoes it', !ascending(beforeSort) && ascending(afterSort) && JSON.stringify(createdOrder()) === JSON.stringify(beforeSort), `${beforeSort.length} prompts`);

  await shot('11-final-board');

  // ---------------------------------------------------------------- real screen snip (last: it captures the actual screen; not viewed)
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
