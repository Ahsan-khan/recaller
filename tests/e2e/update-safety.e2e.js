'use strict';
// Update-safety test. MODE=synthetic (default) builds an "old install" full of
// edge cases; MODE=real runs against a COPY of the user's actual data (only
// counts are printed, never note text).

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, screen } = require('electron');
const { IS_MAC, MOD, macRect, quiet } = require('./mac-harness'); // Mac-safe run; inert on Windows

const SCRATCH = path.join(__dirname, '.out'); // test data, screenshots, logs (git-ignored)
fs.mkdirSync(SCRATCH, { recursive: true });
const MODE = process.env.MODE || 'synthetic';
const DATA_DIR = path.join(SCRATCH, MODE === 'real' ? 'data-real' : 'data3');
const APP_MAIN = process.env.APP_MAIN || path.join(__dirname, '..', '..', 'src', 'main.js');
if (!fs.existsSync(APP_MAIN)) { console.error(`HARNESS FAIL: no app at ${APP_MAIN}${IS_MAC ? '' : ' (APP_MAIN must be a Windows path)'}`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DATA = path.join(DATA_DIR, 'recaller-data.json');
const SETTINGS = path.join(DATA_DIR, 'recaller-settings.json');

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });

const png = (seed) => {
  // tiny valid 1x1 PNG, varied by seed in a tEXt-free way (content doesn't matter)
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
};
const imgId = () => crypto.randomBytes(16).toString('hex');
const OLD = new Date(Date.now() - 3 * 24 * 3600e3);

let img1, img2, orphan, backupOnly;
if (MODE === 'real') {
  // Mac: ~/Library/Application Support/Recaller; stop cleanly (no crash dialog) if it isn't there
  const src = IS_MAC ? path.join(app.getPath('appData'), 'Recaller') : path.join(process.env.APPDATA, 'Recaller');
  const missing = IS_MAC && ['recaller-data.json', 'recaller-settings.json'].find((f) => !fs.existsSync(path.join(src, f)));
  if (missing) { console.error(`HARNESS FAIL: no ${missing} in ${src}`); process.exit(1); }
  for (const f of ['recaller-data.json', 'recaller-settings.json']) fs.copyFileSync(path.join(src, f), path.join(DATA_DIR, f));
  if (fs.existsSync(path.join(src, 'images'))) fs.cpSync(path.join(src, 'images'), path.join(DATA_DIR, 'images'), { recursive: true });
} else {
  [img1, img2, orphan, backupOnly] = [imgId(), imgId(), imgId(), imgId()];
  for (const id of [img1, img2, orphan, backupOnly]) {
    for (const suffix of ['.png', '.t.png']) {
      const f = path.join(DATA_DIR, 'images', id + suffix);
      fs.writeFileSync(f, png());
      fs.utimesSync(f, OLD, OLD);
    }
  }
  const now = Date.now();
  const note = (id, text, extra = {}) => ({ id, text, images: [], createdAt: now - 5e6, updatedAt: now - 5e6, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
  const data = {
    version: 2,
    futureTopLevel: { keep: true },
    prefs: { density: 'roomy', lastProjectId: 'pB', futurePref: { a: 1 }, colWidths: { pC: 300 } },
    projects: [
      {
        id: 'pA', name: 'Alpha — ünïcode ✓', color: 'sun', usedCollapsed: true, augCollapsed: false,
        draft: 'half-written thought\nsecond line', draftImages: [{ id: img1, w: 1, h: 1 }], createdAt: now - 9e6,
        futureProjectField: 'x',
        notes: [
          note('n1', 'First note with an image\n\n  indented line  ', { images: [{ id: img2, w: 1, h: 1, futureImageField: 7 }], copied: 5, futureNoteField: { nested: true } }),
          note('n1b', 'Second note'),
        ],
        used: [note('u1', 'Used one', { usedAt: now - 1e6 })],
      },
      {
        id: 'pB', name: 'Beta', color: 'galaxy', usedCollapsed: false, augCollapsed: true, draft: '', draftImages: [], createdAt: now - 8e6,
        notes: [note('n2', 'Note in a project whose colour comes from a future version'), ...Array.from({ length: 14 }, (_, i) => note(`nb${i}`, `Filler note ${i}
with a second line`))],
        used: [note('u2', 'Used two'), note('u3', 'Used three')],
      },
      ...['C', 'D', 'E', 'F'].map((k) => ({ id: `p${k}`, name: `Project ${k}`, color: 'moss', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now, notes: [note(`n${k}`, `Note ${k}`)], used: [] })),
    ],
  };
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
  fs.writeFileSync(SETTINGS, JSON.stringify({
    model: 'gpt-4o-mini-transcribe', language: 'en', hint: 'PyTorch', hotkey: '', shotHotkey: '', hideAfterCopy: true,
    theme: 'soft', apiKey: { plain: 'sk-keep-me' }, bounds: { x: 10, y: 10, width: 1300, height: 820 }, maximized: false,
    lastVersion: '1.2.0', futureSetting: 'keep-me',
  }, null, 2));
  const bdir = path.join(DATA_DIR, 'backups', '2026-01-01T00-00-00-000Z_manual');
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, 'recaller-data.json'), JSON.stringify({ version: 2, projects: [{ id: 'old', name: 'Old', notes: [note('o1', 'old', { images: [{ id: backupOnly, w: 1, h: 1 }] })], used: [] }] }));
  fs.writeFileSync(path.join(bdir, 'backup.json'), JSON.stringify({ kind: 'manual', createdAt: Date.parse('2026-01-01'), appVersion: '1.2.0', projects: 1, notes: 1 }));
}

const originalData = fs.readFileSync(DATA);
const originalSettings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
const originalMtime = fs.statSync(DATA).mtimeMs;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

process.env.RECALLER_DATA_DIR = DATA_DIR;
const OFF = () => {
  if (IS_MAC) return macRect(1360, 860);
  const c = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(c).workArea;
  return { x: c.x - wa.x > wa.width / 2 ? wa.x - 1160 : wa.x + wa.width - 200, y: wa.y, width: 1360, height: 860 };
};
app.on('browser-window-created', (_e, w) => {
  const showInactive = w.showInactive.bind(w);
  w.show = () => { w.setBounds(OFF()); showInactive(); w.setBounds(OFF()); };
});
quiet();
require(APP_MAIN);
app.whenReady().then(run).catch((err) => { console.error('HARNESS FAIL', err); app.exit(1); });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// Deep equality that ignores key order.
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}

async function run() {
  await sleep(400);
  const win = BrowserWindow.getAllWindows()[0];
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  const errors = [];
  wc.on('console-message', (e) => { if ((e.level ?? e.params?.level) === 'error') errors.push(e.message ?? e.params?.message); });
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await sleep(2500);
  const js = (code) => wc.executeJavaScript(code);
  const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const version = app.getVersion();

  // 1. Opening the new version must not rewrite the notes file at all.
  const afterOpen = fs.readFileSync(DATA);
  check('notes file is byte-for-byte unchanged after launching the new version', afterOpen.equals(originalData) && fs.statSync(DATA).mtimeMs === originalMtime);
  if (!afterOpen.equals(originalData)) {
    const diffKeys = (a, b, p = '') => {
      if (JSON.stringify(a) === JSON.stringify(b)) return [];
      if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return [p || '(root)'];
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].flatMap((k) => diffKeys(a[k], b[k], p ? `${p}.${k}` : k));
    };
      }

  // 2. Settings: every value identical; only the version stamp (and new keys) added.
  const settingsNow = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  // window position is excluded: this test itself moves the window out of your way
  const changed = Object.keys(originalSettings).filter((k) => !['lastVersion', 'bounds', 'maximized'].includes(k) && !same(originalSettings[k], settingsNow[k]));
  check('every existing setting keeps its exact value', changed.length === 0, changed.length ? `changed: ${changed.join(', ')}` : `${Object.keys(originalSettings).length} keys checked`);
  check('version stamp recorded', settingsNow.lastVersion === version, `${originalSettings.lastVersion ?? '(none)'} → ${settingsNow.lastVersion}`);

  // 3. A backup of exactly what the old version left, taken before anything else.
  const backups = fs.readdirSync(path.join(DATA_DIR, 'backups')).map((id) => ({ id, meta: JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backups', id, 'backup.json'), 'utf8')) }));
  const up = backups.find((b) => b.meta.kind === 'upgrade');
  check('pre-update backup made, identical to the old files', Boolean(up) && fs.readFileSync(path.join(DATA_DIR, 'backups', up.id, 'recaller-data.json')).equals(originalData) && up.meta.toVersion === version,
    up ? `${up.meta.fromVersion} → ${up.meta.toVersion}, ${up.meta.notes} notes` : 'none');
  check('daily backup made', backups.some((b) => b.meta.kind === 'daily'));

  // 4. What is on screen matches the file.
  const file = JSON.parse(originalData.toString('utf8'));
  // 1.20: the notepad is a hidden project (`notepad: true`), never drawn as a column; its page shows in the notepad
  file.projects = file.projects.filter((p) => p.notepad !== true);
  const fileNotes = file.projects.reduce((n, p) => n + p.notes.length, 0);
  const fileUsed = file.projects.reduce((n, p) => n + p.used.length, 0);
  const screenCounts = await js(`({ cols: document.querySelectorAll('.column').length, notes: document.querySelectorAll('.active-list .card-wrap').length,
    used: [...document.querySelectorAll('.column')].reduce((n, c) => n + (Number((c.querySelector('.used-count').textContent.match(/\\d+/) || [0])[0])), 0) })`);
  check('every project and note is on screen', screenCounts.cols === file.projects.length && screenCounts.notes === fileNotes && screenCounts.used === fileUsed,
    `projects ${screenCounts.cols}/${file.projects.length}, notes ${screenCounts.notes}/${fileNotes}, used ${screenCounts.used}/${fileUsed}`);
  const theme = originalSettings.theme || 'deep';
  check('colour theme kept', await js(`document.body.classList.contains('theme-${theme}')`), theme);
  const density = file.prefs?.density || 'slim';
  check('column width kept', await js(`document.body.classList.contains('density-${density}')`), density);

  if (MODE === 'synthetic') {
    const accents = await js(`[...document.querySelectorAll('.column')].map(c => c.style.getPropertyValue('--accent')).join(',')`);
    check('project colours kept (incl. one unknown to this version)', accents.startsWith('#8a6416,#17694d,'), accents);
    const widths = await js(`['pC', 'pD'].map((id) => Math.round(document.querySelector('.column[data-id="' + id + '"]').getBoundingClientRect().width))`);
    check('a resized column keeps its width; the others keep the default', widths[0] === 300 && widths[1] === 330, JSON.stringify(widths));
    check('unsaved draft kept (dot on +)', await js(`document.querySelector('.column[data-id="pA"] .col-add').classList.contains('has-draft')`));
    check('collapsed sections kept', await js(`document.querySelector('.column[data-id="pA"] .used').classList.contains('is-collapsed') && document.querySelector('.column[data-id="pB"] .final').classList.contains('is-collapsed')`));
    key('N', [MOD]);
    await sleep(300);
    check('last-used project remembered (Ctrl+N opens in it)', await js(`!!document.querySelector('.column[data-id="pB"] .composer')`));
    key('Escape');
    await sleep(200);
    check('draft text and image restored in the editor', await (async () => {
      await js(`document.querySelector('.column[data-id="pA"] .col-add').click()`);
      await sleep(300);
      const v = await js(`document.querySelector('.column[data-id="pA"] .composer textarea').value`);
      const imgs = await js(`document.querySelectorAll('.column[data-id="pA"] .composer .attach').length`);
      key('Escape');
      await sleep(200);
      return v === 'half-written thought\nsecond line' && imgs === 1;
    })());

    // images: referenced ones kept, orphan swept, backup-referenced kept
    const imgs = new Set(fs.readdirSync(path.join(DATA_DIR, 'images')));
    check('images in notes, drafts and backups are kept; true orphans cleaned', imgs.has(`${img1}.png`) && imgs.has(`${img2}.png`) && imgs.has(`${backupOnly}.png`) && !imgs.has(`${orphan}.png`));

    // 5. A real edit round-trips every field, including ones this version doesn't know.
    await js(`[...document.querySelectorAll('.card-wrap')].find(w => w.dataset.id === 'n1b').querySelector('.card').focus()`);
    key('Enter'); // copy → bumps copy count → save
    await sleep(900);
    const saved = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    // 1.4 stores its new final "Used" stage in a `combined` list; an empty one is the only addition allowed.
    for (const pr of saved.projects) if (Array.isArray(pr.combined) && !pr.combined.length) delete pr.combined;
    const expect = JSON.parse(originalData.toString('utf8'));
    const n1b = expect.projects[0].notes.find((n) => n.id === 'n1b');
    const savedN1b = saved.projects[0].notes.find((n) => n.id === 'n1b');
    n1b.copied = savedN1b.copied;
    n1b.lastCopiedAt = savedN1b.lastCopiedAt;
    check('after an edit, everything else in the file is identical (future fields too)', same(saved, expect) && savedN1b.copied === 1,
      same(saved, expect) ? '' : JSON.stringify(saved).slice(0, 200));

    // 6. Scroll positions survive a restart.
    await sleep(500);
    const bpos = await js(`(() => { const r = document.querySelector('.column[data-id="pA"] .col-head').getBoundingClientRect(); const c = document.querySelector('.column[data-id="pB"] .col-scroll').getBoundingClientRect(); return { hx: Math.round(r.left + 20), hy: Math.round(r.top + 10), cx: Math.round(c.left + 40), cy: Math.round(c.top + 60) }; })()`);
    wc.sendInputEvent({ type: 'mouseWheel', x: bpos.cx, y: bpos.cy, deltaX: 0, deltaY: -120, canScroll: true }); // column first
    await sleep(500);
    wc.sendInputEvent({ type: 'mouseWheel', x: bpos.hx, y: bpos.hy, deltaX: 0, deltaY: -120, canScroll: true }); // then the board
    await sleep(700);
        await wc.capturePage(); await sleep(300); await wc.capturePage(); // make the browser apply the queued wheel input
    const want = await js(`[document.querySelector('#board').scrollLeft, document.querySelector('.column[data-id="pB"] .col-scroll').scrollTop]`);
    await sleep(1200);
        wc.reload();
    await new Promise((r) => wc.once('did-finish-load', r));
    await sleep(1200);
        const pos = await js(`[document.querySelector('#board').scrollLeft, document.querySelector('.column[data-id="pB"] .col-scroll').scrollTop]`);
    const maxLeft = await js(`document.querySelector('#board').scrollWidth - document.querySelector('#board').clientWidth`);
    check('board and column scroll positions come back', want[0] > 0 && want[1] > 0 && Math.abs(pos[0] - want[0]) <= 4 && Math.abs(pos[1] - want[1]) <= 4, `set ${JSON.stringify(want)} → after reload ${JSON.stringify(pos)}`);
    await sleep(300);

    // 7. Restore from a backup.
    await js(`[...document.querySelectorAll('.card-wrap')].find(w => w.dataset.id === 'n2').querySelector('.card').focus()`);
    key('Delete');
    await sleep(700);
    const gone = !JSON.parse(fs.readFileSync(DATA, 'utf8')).projects[1].notes.some((n) => n.id === 'n2');
    const res = await js(`recaller.restoreBackup(${JSON.stringify(up.id)})`);
    await new Promise((r) => wc.once('did-finish-load', r));
    await sleep(1200);
    const back = await js(`!!document.querySelector('.card-wrap[data-id="n2"]')`);
    const before = fs.readdirSync(path.join(DATA_DIR, 'backups')).find((id) => id.endsWith('_before-restore'));
    const beforeData = before && JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backups', before, 'recaller-data.json'), 'utf8'));
    check('restoring a backup brings deleted notes back', gone && res.ok && back && fs.readFileSync(DATA).equals(originalData));
    check('the state before the restore is itself backed up', Boolean(beforeData) && !beforeData.projects[1].notes.some((n) => n.id === 'n2'));
    await js(`document.querySelector('#open-settings').click()`);
    await sleep(500);
    const opts = await js(`[...document.querySelectorAll('#set-backup option')].map(o => o.textContent)`);
    check('backups listed in Settings', opts.length >= 3 && opts.some((o) => o.includes(`Before update to ${version}`)), `${opts.length} listed`);
  }

  check('no renderer console errors', errors.length === 0, errors.join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed (${MODE})`);
  app.exit(failed ? 1 : 0);
}
