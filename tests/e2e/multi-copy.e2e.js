'use strict';
// Ctrl+click multi-copy under realistic input patterns.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, clipboard, screen } = require('electron');

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const DATA_DIR = path.join(SCRATCH, 'data5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const now = Date.now();
const note = (id, text) => ({ id, text, images: [], createdAt: now - 7e6, updatedAt: now - 7e6, copied: 0, lastCopiedAt: 0, usedAt: 0 });
fs.writeFileSync(path.join(DATA_DIR, 'recaller-data.json'), JSON.stringify({ version: 2, prefs: { density: 'slim' }, projects: [
  { id: 'a', name: 'Alpha', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now,
    notes: ['First prompt', 'Second prompt', 'Third prompt', 'Fourth prompt'].map((t, i) => note(`a${i}`, t)), used: [] },
  { id: 'b', name: 'Beta', color: 'moss', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now,
    notes: ['Beta one', 'Beta two'].map((t, i) => note(`b${i}`, t)), used: [] },
] }));
fs.writeFileSync(path.join(DATA_DIR, 'recaller-settings.json'), JSON.stringify({ hotkey: '', shotHotkey: '', theme: 'deep', lastVersion: '44.4.5' }));

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
process.env.RECALLER_DATA_DIR = DATA_DIR;
const OFF = () => {
  const c = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(c).workArea;
  return { x: c.x - wa.x > wa.width / 2 ? wa.x - 1300 : wa.x + wa.width - 60, y: wa.y, width: 1360, height: 860 };
};
app.on('browser-window-created', (_e, w) => {
  const showInactive = w.showInactive.bind(w);
  w.show = () => { w.setBounds(OFF()); showInactive(); w.setBounds(OFF()); };
});
require(process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js'));

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

app.whenReady().then(async () => {
  await sleep(2200);
  const win = BrowserWindow.getAllWindows()[0];
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  const js = (code) => wc.executeJavaScript(code);
  const rect = (id) => js(`(() => { const r = document.querySelector('.card-wrap[data-id="${id}"] .card-text').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const send = (e) => wc.sendInputEvent(e);
  const ctrlDown = () => send({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
  const ctrlUp = () => send({ type: 'keyUp', keyCode: 'Control', modifiers: [] });
  async function click(id, { ctrl = true, hold = 90, jitter = 0 } = {}) {
    const r = await rect(id);
    const mods = ctrl ? ['control'] : [];
    send({ type: 'mouseMove', x: Math.round(r.cx), y: Math.round(r.cy), modifiers: mods });
    send({ type: 'mouseDown', x: Math.round(r.cx), y: Math.round(r.cy), button: 'left', clickCount: 1, modifiers: mods });
    if (jitter) { await sleep(hold / 2); send({ type: 'mouseMove', x: Math.round(r.cx + jitter), y: Math.round(r.cy + 1), modifiers: [...mods, 'leftButtonDown'] }); await sleep(hold / 2); }
    else await sleep(hold);
    send({ type: 'mouseUp', x: Math.round(r.cx + jitter), y: Math.round(r.cy + (jitter ? 1 : 0)), button: 'left', clickCount: 1, modifiers: mods });
  }
  const reset = async () => { send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' }); await sleep(250); await clipboard.writeText(''); };
  const clip = () => clipboard.readText();

  // 1. hold Ctrl first (keyDown), then normal clicks, 150ms apart
  await reset();
  ctrlDown();
  for (const id of ['a0', 'a1', 'a2']) { await click(id); await sleep(150); }
  ctrlUp();
  await sleep(400);
  check('Ctrl held, 3 clicks 150ms apart', (await clip()) === 'First prompt\n\nSecond prompt\n\nThird prompt', JSON.stringify(await clip()));

  // 2. rapid clicks (no gap)
  await reset();
  ctrlDown();
  for (const id of ['a0', 'a1', 'a2', 'a3']) { await click(id, { hold: 40 }); }
  ctrlUp();
  await sleep(600);
  check('rapid Ctrl+clicks, no pause', (await clip()) === 'First prompt\n\nSecond prompt\n\nThird prompt\n\nFourth prompt', JSON.stringify(await clip()));

  // 3. slow presses (hold 450ms each)
  await reset();
  ctrlDown();
  for (const id of ['a2', 'b0']) { await click(id, { hold: 450 }); await sleep(200); }
  ctrlUp();
  await sleep(400);
  check('slow Ctrl+presses (450ms)', (await clip()) === 'Third prompt\n\nBeta one', JSON.stringify(await clip()));

  // 4. slightly wobbly clicks (4px)
  await reset();
  ctrlDown();
  for (const id of ['a1', 'b1']) { await click(id, { jitter: 4, hold: 120 }); await sleep(150); }
  ctrlUp();
  await sleep(400);
  check('Ctrl+clicks with 4px wobble', (await clip()) === 'Second prompt\n\nBeta two', JSON.stringify(await clip()));

  // 5. plain click first, then Ctrl+click others (Explorer-style expectation)
  await reset();
  await click('a0', { ctrl: false });
  await sleep(250);
  ctrlDown();
  for (const id of ['a1', 'a2']) { await click(id); await sleep(150); }
  ctrlUp();
  await sleep(400);
  check('plain click, then Ctrl+click two more → all three', (await clip()) === 'First prompt\n\nSecond prompt\n\nThird prompt', JSON.stringify(await clip()));

  // 6. search box focused while Ctrl+clicking
  await reset();
  await js(`document.querySelector('#search').focus()`);
  ctrlDown();
  for (const id of ['a3', 'a0']) { await click(id); await sleep(150); }
  ctrlUp();
  await sleep(400);
  check('with the search box focused', (await clip()) === 'Fourth prompt\n\nFirst prompt', JSON.stringify(await clip()));

  // 7. composer open while Ctrl+clicking
  await reset();
  await js(`document.querySelector('.column[data-id="b"] .col-add').click()`);
  await sleep(300);
  ctrlDown();
  for (const id of ['a1', 'a3']) { await click(id); await sleep(150); }
  ctrlUp();
  await sleep(400);
  check('with a new-prompt editor open', (await clip()) === 'Second prompt\n\nFourth prompt', JSON.stringify(await clip()));

  // 8. switching to another app (to paste) starts a fresh selection next time
  await reset();
  ctrlDown();
  for (const id of ['a0', 'a1']) { await click(id); await sleep(150); }
  ctrlUp();
  await sleep(200);
  await js(`window.dispatchEvent(new Event('blur'))`);
  await sleep(200);
  const barGone = await js(`document.querySelector('#selection-bar').hidden`);
  ctrlDown();
  await click('a3');
  ctrlUp();
  await sleep(400);
  check('after switching away, next Ctrl+click starts fresh', barGone && (await clip()) === 'Fourth prompt', JSON.stringify(await clip()));

  // 9. clicking empty canvas clears the selection
  await reset();
  ctrlDown();
  await click('a2');
  ctrlUp();
  await sleep(200);
  const spot = await js(`(() => { const b = document.querySelector('#board'); for (let y = 780; y > 120; y -= 20) for (let x = 700; x < 1300; x += 10) if (document.elementFromPoint(x, y) === b) return { x, y }; return null; })()`);
  send({ type: 'mouseMove', x: spot.x, y: spot.y }); send({ type: 'mouseDown', x: spot.x, y: spot.y, button: 'left', clickCount: 1 }); await sleep(60); send({ type: 'mouseUp', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
  await sleep(250);
  check('clicking empty space clears the selection', (await js(`document.querySelectorAll('.card-wrap.is-selected').length`)) === 0 && await js(`document.querySelector('#selection-bar').hidden`));

  // 10. plain click, something else, then Ctrl+click: the old click isn't pulled in
  await reset();
  await click('a0', { ctrl: false });
  await sleep(200);
  await js(`document.querySelector('.column[data-id="b"] .col-add').click()`);
  await sleep(250);
  send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' });
  await sleep(200);
  const addBtn = await js(`(() => { const r = document.querySelector('.column[data-id="b"] .col-menu').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  send({ type: 'mouseMove', x: addBtn.x, y: addBtn.y }); send({ type: 'mouseDown', x: addBtn.x, y: addBtn.y, button: 'left', clickCount: 1 }); await sleep(40); send({ type: 'mouseUp', x: addBtn.x, y: addBtn.y, button: 'left', clickCount: 1 });
  await sleep(200);
  send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' });
  await sleep(200);
  ctrlDown();
  await click('a2');
  ctrlUp();
  await sleep(400);
  check('an earlier plain click is not pulled in after other actions', (await clip()) === 'Third prompt', JSON.stringify(await clip()));

  // 11. plain click A, then Ctrl+click A itself: just A, once
  await reset();
  await click('a1', { ctrl: false });
  await sleep(200);
  ctrlDown();
  await click('a1');
  await sleep(150);
  await click('b0');
  ctrlUp();
  await sleep(400);
  check('plain click then Ctrl+click the same note does not duplicate it', (await clip()) === 'Second prompt\n\nBeta one', JSON.stringify(await clip()));
  const badges = await js(`[...document.querySelectorAll('.card-wrap.is-selected > .sel-badge')].map(b => b.closest('.card-wrap').dataset.id + ':' + b.textContent).join(',')`);
  check('badges show the paste order', badges === 'a1:1,b0:2', badges);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  app.exit(failed ? 1 : 0);
});
