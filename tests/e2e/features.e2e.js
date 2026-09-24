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
  check('drag into Augmented joins the note into it', (await augOf('p1')).includes('Benchmark heuristic_ai'));
  check('move shows an Undo toast', (await texts('.toast')).some((t) => t.includes('Added to Augmented') && t.includes('Undo')));
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

  // ---------------------------------------------------------------- stages: prompts → Augmented (one note) → Used (one text)
  check('Used section shows once Augmented has notes', await js(`!document.querySelector('.column[data-id="p1"] .final').hidden`));
  check('Used section hidden while Augmented and Used are empty', await js(`document.querySelector('.column[data-id="p2"] .final').hidden`));
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
  const toAug = (i = 0) => js(`document.querySelectorAll('.column[data-id="px1"] .active-list .act-used')[${i}].click()`);
  await toAug(); await sleep(300); // Gamma three
  await toAug(); await sleep(300); // Beta two
  const aug1 = await augOf('px1');
  check('Augmented joins the moved prompts into ONE note, in the order added', (await js(`document.querySelectorAll('.column[data-id="px1"] .aug-note').length`)) === 1 && aug1 === 'Gamma three\n\nBeta two' && !(await colTexts('px1')).includes('Gamma three'), JSON.stringify(aug1));
  await clipboard.writeText('');
  await clickSel('.column[data-id="px1"] .aug-note .aug-text');
  await sleep(250);
  check('clicking the Augmented note copies it', (await clipboard.readText()) === aug1);
  const finalOf = (id) => js(`document.querySelector('.column[data-id="${id}"] .final-text').textContent`);
  // swipe the Augmented note left → appended to Used, Augmented empties
  const an = await rect('.column[data-id="px1"] .aug-note');
  mouse('mouseMove', an.cx, an.cy, { modifiers: [] }); mouse('mouseDown', an.cx, an.cy);
  await drag(an.cx, an.cy, an.cx - 90, an.cy + 2, 8);
  const revealsMove = await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-swiping')`);
  await drag(an.cx - 90, an.cy + 2, an.cx - 190, an.cy + 3, 6);
  mouse('mouseUp', an.cx - 190, an.cy + 3);
  await sleep(700);
  const final1 = await finalOf('px1');
  check('swiping the Augmented note left moves it down into Used', revealsMove && final1 === aug1 && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)), JSON.stringify(final1));
  // next batch via the Move to Used button: it combines with the Used text
  await toAug(); await sleep(300); // Alpha one
  await toAug(); await sleep(300); // Placeholder note for Writing
  const aug2 = await augOf('px1');
  await clickSel('.column[data-id="px1"] .aug-move');
  await sleep(700);
  const final2 = await finalOf('px1');
  check('Move to Used adds the whole Augmented note to the end of the Used text', final2 === `${final1}\n\n${aug2}`, JSON.stringify(final2));
  // a third batch dragged onto Used
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
  check('dragging the Augmented note onto Used also moves it down', finalNow === `${final2}\n\nDelta four`, JSON.stringify(finalNow.slice(-40)));
  await clipboard.writeText('');
  await clickSel('.column[data-id="px1"] .final-copy');
  await sleep(250);
  check('Copy all copies the whole Used text and the button says Copied', (await clipboard.readText()) === finalNow && (await js(`document.querySelector('.column[data-id="px1"] .final-copy').textContent.trim()`)) === 'Copied');
  const overlaps = await js(`(() => {
    const r = (sel) => document.querySelector('.column[data-id="px1"] ' + sel).getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const btn = r('.final-copy');
    return ['.final-toggle > span:nth-of-type(2)', '.final-count', '.final-text', '.final-stats'].filter((sel) => hit(btn, r(sel)));
  })()`);
  check('Copy all button overlaps nothing', overlaps.length === 0, overlaps.join(', '));
  // Augmented parts: a prompt can be pulled back out
  await clickSel('.column[data-id="px1"] .new-prompt'); await sleep(150); await type('Epsilon five'); key('Enter', ['control']); await sleep(200); key('Escape'); await sleep(150);
  await toAug(); await sleep(300);
  const partText = await augOf('px1');
  await js(`document.querySelector('.column[data-id="px1"] .aug-parts-btn').click()`);
  await sleep(200);
  await js(`document.querySelector('.column[data-id="px1"] .ap-back').click()`);
  await sleep(400);
  check('a prompt can be sent back out of Augmented', (await colTexts('px1')).includes(partText.split('\n')[0]) && (await js(`document.querySelector('.column[data-id="px1"] .used').classList.contains('is-empty')`)));
  const stageColours = await js(`(() => {
    const c = (sel, prop = 'backgroundColor') => getComputedStyle(document.querySelector('.column[data-id="p1"] ' + sel))[prop];
    return [c('.active-list .card'), c('.used'), c('.final', 'backgroundImage')];
  })()`);
  check('new, Augmented and Used each look different', new Set(stageColours).size === 3, stageColours.map((x) => x.slice(0, 40)).join(' | '));
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
  await sleep(450);
  check('selection bar "Move to Augmented" joins the notes into it', (await augOf('p2')).includes(moving) && !(await colTexts('p2')).includes(moving));
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
  const top = (await colTexts('p1'))[0];
  check('Ctrl+Enter saves dictated note', /^Phrase one\. typed Phrase two\..* Keep it simple\.$/.test(top || ''), JSON.stringify(top));
  key('Escape');
  await sleep(250);

  // Save pressed mid-recording: stops, finishes transcribing, then saves
  const n0 = (await colTexts('p2')).length;
  await clickSel('.column[data-id="p2"] .col-mic');
  await sleep(1500);
  await clickSel('.composer .comp-save');
  let savedMid = false;
  for (let t = 0; t < 40 && !savedMid; t++) { await sleep(100); savedMid = (await colTexts('p2')).length === n0 + 1; }
  check('Save during recording finishes transcription then saves', savedMid && /^Phrase/.test((await colTexts('p2'))[0] || ''), (await colTexts('p2'))[0]);
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
  const withImg = await rect('.column[data-id="p3"] .active-list .card-text');
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
  check('data persisted (v2, images on notes, density pref)', saved.version === 2 && p3.notes[0].images.length === 1 && saved.prefs.density === 'slim');
  check('no renderer console errors', errors.length === 0, errors.join(' | '));

  // The snip contains the real screen — don't keep it around.
  fs.rmSync(path.join(DATA_DIR, 'images'), { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  server.close();
  app.exit(failed ? 1 : 0);
}
