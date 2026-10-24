'use strict';
// node --test ios/core/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BOARD_FILE = path.join(__dirname, '..', 'board.js');
const { createBoard, normalize, seedData, PALETTE } = require('../board');

const REPO = path.join(__dirname, '..', '..', '..');
// The engine's labels that explain a deletion, read from the engine itself so the two can't drift.
const EXPLAINING = (() => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'sync', 'engine.js'), 'utf8');
  const m = src.match(/const EXPLAINING = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(m, 'EXPLAINING not found in engine.js');
  return new Set([...m[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
})();

const hex = (n) => n.toString(16).padStart(32, '0');
const img = (n) => ({ id: hex(n), w: 100 + n, h: 50 + n, extra: `img-${n}` });

// A fake host page: live data, markContent labels, a persist count, a ticking clock and ids.
function fakePage(data) {
  let t = 1760000000000;
  let id = 0;
  const page = {
    _data: data,
    get data() { return page._data; },
    labels: [],
    contentSeq: 0,
    persists: 0,
    markContent(label) { page.contentSeq++; page.labels.push(label); },
    persist() { page.persists++; JSON.stringify(page._data); },
    now: () => (t += 1000),
    newId: () => `id-${++id}`,
  };
  return page;
}

const note = (id, text, extra = {}) => ({
  id, text, images: [], createdAt: 1000, updatedAt: 1000, copied: 0, lastCopiedAt: 0, usedAt: 0, mystery: { keep: id }, ...extra,
});

// A board with unknown fields at every level.
function sample() {
  return {
    version: 2,
    prefs: { density: 'slim', unknownPref: 1 },
    topUnknown: { a: 1 },
    projects: [
      {
        id: 'p1', name: 'One', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: 1,
        projectMystery: 'keep-p1',
        notes: [note('n1', 'alpha first', { createdAt: 3000 }), note('n2', 'beta second', { createdAt: 2000, images: [img(1)] }), note('n3', 'gamma third', { createdAt: 4000 })],
        used: [note('u1', 'cooked one', { images: [img(2)] }), note('u2', 'cooked two', { images: [img(2), img(3)] })],
        combined: [note('c1', 'served one'), note('c2', 'served two')],
      },
      {
        id: 'p2', name: 'Two', color: 'moss', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: 2,
        projectMystery: 'keep-p2', group: 'G',
        notes: [note('m1', 'Alpha in two')], used: [], combined: [],
      },
      {
        id: 'p3', name: 'Three', color: 'sun', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: 3,
        notes: [], used: [], combined: [],
      },
      {
        id: 'p4', name: 'Four', color: 'orchid', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: 4,
        group: 'G', notes: [], used: [], combined: [],
      },
    ],
  };
}

function setup(data = sample()) {
  const page = fakePage(data);
  const board = createBoard(page);
  return { page, board, data: () => page.data };
}
const P = (s, id) => s.data().projects.find((p) => p.id === id);
const ids = (arr) => arr.map((n) => n.id);
const lastLabel = (s) => s.page.labels[s.page.labels.length - 1];

// Every unknown field from sample() is still on the board.
function assertUnknowns(s, { skipNotes = [] } = {}) {
  const d = s.data();
  assert.deepEqual(d.topUnknown, { a: 1 });
  assert.equal(d.prefs.unknownPref, 1);
  for (const p of d.projects) {
    if (p.id === 'p1') assert.equal(p.projectMystery, 'keep-p1');
    if (p.id === 'p2') assert.equal(p.projectMystery, 'keep-p2');
    for (const l of ['notes', 'used', 'combined']) {
      for (const n of p[l]) {
        if (/^(n|u|c|m)\d$/.test(n.id) && !skipNotes.includes(n.id)) assert.deepEqual(n.mystery, { keep: n.id }, `note ${n.id} lost its field`);
        for (const i of n.images) if (/^0+\d$/.test(i.id)) assert.ok(i.extra, 'image lost its field');
      }
    }
  }
}

// Runs an action, then checks the label, the persist, the unknown fields, and that undo puts the
// board back exactly and redo makes the change again.
function roundTrip(s, fn, { label, explains = false } = {}) {
  const before = JSON.stringify(s.data().projects);
  const eatenBefore = JSON.stringify(s.data().localEaten);
  const persists = s.page.persists;
  const r = fn();
  assert.equal(r.ok, true, `action failed: ${r.error}`);
  assert.ok(s.page.persists > persists, 'not persisted');
  if (label) assert.equal(lastLabel(s), label);
  if (explains) assert.ok(EXPLAINING.has(label), `${label} must explain a deletion`);
  assertUnknowns(s);
  const after = JSON.stringify(s.data().projects);
  const eatenAfter = JSON.stringify(s.data().localEaten);
  assert.equal(s.board.view().undo.label, label);
  const u = s.board.undo();
  assert.equal(u.ok, true);
  assert.equal(lastLabel(s), 'Undo');
  assert.equal(JSON.stringify(s.data().projects), before);
  assert.equal(JSON.stringify(s.data().localEaten), eatenBefore);
  assertUnknowns(s);
  assert.equal(s.board.view().redo.label, label);
  const rd = s.board.redo();
  assert.equal(rd.ok, true);
  assert.equal(lastLabel(s), 'Redo');
  assert.equal(JSON.stringify(s.data().projects), after);
  assert.equal(JSON.stringify(s.data().localEaten), eatenAfter);
  assertUnknowns(s);
  return r;
}

// ---------------------------------------------------------------- the module itself

test('board.js loads nothing and touches no host globals', () => {
  const src = fs.readFileSync(BOARD_FILE, 'utf8');
  assert.ok(!src.includes('require('), 'board.js must not call require(');
  for (const word of ['Buffer', 'structuredClone', 'process', 'window', 'document']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(src), `board.js mentions ${word}`);
  }
});

test('board.js runs in a bare context (no module object) and sets RecallerBoard', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(BOARD_FILE, 'utf8'), ctx);
  const api = vm.runInContext('RecallerBoard', ctx);
  assert.equal(typeof api.createBoard, 'function');
  const board = vm.runInContext(`(() => {
    let n = 0; const data = { version: 2, prefs: {}, projects: [] };
    const b = RecallerBoard.createBoard({ get data() { return data; }, markContent() {}, persist() {}, now: () => 5, newId: () => 'x' + (++n) });
    b.addProject('A'); b.addNote(b.view().projects[0].id, 'hi');
    return JSON.stringify(b.view());
  })()`, ctx);
  assert.equal(JSON.parse(board).projects[0].notes[0].text, 'hi');
});

test('PALETTE is the desktop order with hex colours', () => {
  assert.equal(PALETTE.length, 18);
  assert.deepEqual(PALETTE.slice(0, 3).map((c) => c.id), ['monstera', 'moss', 'sun']);
  assert.equal(PALETTE[17].id, 'wine');
  for (const c of PALETTE) assert.match(c.color, /^#[0-9a-f]{6}$/);
});

test('normalize matches the desktop rules (peer.js model) and keeps unknown keys', () => {
  const { normalize: peerNormalize } = require('../../../tests/support/peer.js');
  const raw = {
    version: 1, extra: 'top', prefs: { joiner: 'line', weird: [1] },
    projects: [
      null, 'x',
      { id: 'a', name: '  ', color: '', draft: 5, draftImages: [{ id: 'bad' }, { id: hex(9), w: '7' }], keepMe: 1,
        notes: [{ id: 'a', text: 'dup id', copied: '3', z: 1 }, { text: 5 }, { text: 'no id', images: [{ id: hex(1), w: 2, h: 'q', y: 1 }] }],
        used: 'nope' },
      { id: 'b', name: 'B', color: 'unknown-colour', notes: [{ id: 'k', text: 't', createdAt: 5 }] },
    ],
  };
  let i = 0;
  let j = 0;
  const mine = normalize(JSON.parse(JSON.stringify(raw)), () => `g${++i}`, () => 42);
  const theirs = peerNormalize(JSON.parse(JSON.stringify(raw)), () => `g${++j}`, () => 42);
  assert.deepEqual(mine, theirs);
  assert.equal(mine.extra, 'top');
  assert.deepEqual(mine.prefs.weird, [1]);
  assert.equal(mine.projects[0].keepMe, 1);
  assert.equal(mine.projects[0].notes[0].z, 1);
  assert.equal(mine.projects[0].notes[1].images[0].y, 1);
  assert.equal(mine.projects[1].color, 'unknown-colour');
  assert.equal(mine.version, 2);
  assert.equal(normalize({ projects: 'no' }, () => 'x', () => 1), null);
});

test('seedData is a Welcome board in the data shape', () => {
  let i = 0;
  const d = seedData(() => `s${++i}`, () => 7);
  assert.equal(d.version, 2);
  assert.equal(d.projects.length, 1);
  assert.equal(d.projects[0].name, 'Welcome');
  assert.equal(d.projects[0].notes.length, 10);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(d)), () => 'z', () => 7), d);
});

// ---------------------------------------------------------------- notes

test('addNote appends to Cooking, clears the draft, and undoes', () => {
  const s = setup();
  const r = roundTrip(s, () => s.board.addNote('p1', '  new one  ', [img(5)]), { label: 'New note' });
  let p = P(s, 'p1');
  const n = p.notes[p.notes.length - 1];
  assert.equal(n.id, r.id);
  assert.equal(n.text, 'new one');
  assert.deepEqual(n.images, [img(5)]);
  assert.equal(n.copied, 0);
  assert.equal(n.usedAt, 0);
  // the draft is cleared and a folded Cooking opens; undo leaves both as they are now (applySnapshot)
  p.draft = 'half typed';
  p.notesCollapsed = true;
  s.board.addNote('p1', 'another');
  p = P(s, 'p1');
  assert.equal(p.draft, '');
  assert.equal(p.notesCollapsed, undefined);
  p.draft = 'typed after';
  s.board.undo();
  assert.equal(P(s, 'p1').draft, 'typed after');
  assert.equal(P(s, 'p1').notesCollapsed, undefined);
  assert.equal(s.board.addNote('p1', '   ').ok, false);
  assert.equal(s.board.addNote('nope', 'x').ok, false);
});

test('editNote on a card: text, images kept when undefined, conflict tag cleared', () => {
  const s = setup();
  P(s, 'p1').notes[1].syncConflict = { of: 'n9', device: 'd'.repeat(32), at: 5 };
  roundTrip(s, () => s.board.editNote('n2', 'beta edited'), { label: 'Edit note' });
  const n = P(s, 'p1').notes[1];
  assert.equal(n.text, 'beta edited');
  assert.deepEqual(n.images, [img(1)]);
  assert.equal(n.syncConflict, undefined);
  assert.ok(n.updatedAt > 1000);
  assert.deepEqual(n.mystery, { keep: 'n2' });
  // unchanged: nothing happens
  const labels = s.page.labels.length;
  assert.deepEqual(s.board.editNote('n2', 'beta edited'), { ok: true, changed: false });
  assert.equal(s.page.labels.length, labels);
  // unchanged but a conflict copy: saving settles it
  P(s, 'p1').notes[0].syncConflict = { of: 'x', device: null, at: 1 };
  assert.equal(s.board.editNote('n1', 'alpha first').ok, true);
  assert.equal(lastLabel(s), 'Edit note');
  assert.equal(P(s, 'p1').notes[0].syncConflict, undefined);
  // images replaced
  assert.equal(s.board.editNote('n1', 'alpha first', []).ok, true);
  assert.deepEqual(P(s, 'p1').notes[0].images, []);
});

test('editNote on a Cooked part changes only that part', () => {
  const s = setup();
  roundTrip(s, () => s.board.editNote('u1', 'cooked one, edited'), { label: 'Edit note' });
  assert.deepEqual(ids(P(s, 'p1').used), ['u1', 'u2']);
  assert.equal(P(s, 'p1').used[0].text, 'cooked one, edited');
});

test('deleteNote: a card, a Cooked part (format settles), a Served part', () => {
  const s = setup();
  roundTrip(s, () => s.board.deleteNote('n2'), { label: 'Delete note', explains: true });
  assert.deepEqual(ids(P(s, 'p1').notes), ['n1', 'n3']);
  roundTrip(s, () => s.board.deleteNote('c1'), { label: 'Delete note', explains: true });
  assert.deepEqual(ids(P(s, 'p1').combined), ['c2']);
  P(s, 'p2').used.push(note('u9', 'only cooked'));
  P(s, 'p2').cookedFormat = 'claude-code';
  assert.equal(s.board.deleteNote('u9').ok, true);
  assert.equal(P(s, 'p2').cookedFormat, undefined);
  assert.deepEqual(s.board.deleteNote('gone'), { ok: false, error: 'no note' });
});

test('moveToCooked appends to Cooked with usedAt', () => {
  const s = setup();
  roundTrip(s, () => s.board.moveToCooked('n1'), { label: 'Move to Cooked' });
  const p = P(s, 'p1');
  assert.deepEqual(ids(p.notes), ['n2', 'n3']);
  assert.deepEqual(ids(p.used), ['u1', 'u2', 'n1']);
  assert.ok(p.used[2].usedAt > 0);
  assert.equal(s.board.moveToCooked('u1').ok, false);
});

test('sendBack: Cooked → bottom of Cooking ("Move back"), Served → end of Cooked', () => {
  const s = setup();
  let r = roundTrip(s, () => s.board.sendBack('u1'), { label: 'Move back' });
  assert.equal(r.to, 'notes');
  assert.deepEqual(ids(P(s, 'p1').notes), ['n1', 'n2', 'n3', 'u1']);
  P(s, 'p1').notesCollapsed = true;
  s.board.sendBack('u2');
  assert.equal(P(s, 'p1').notesCollapsed, undefined); // a folded Cooking opens to show it
  s.board.undo();
  r = roundTrip(s, () => s.board.sendBack('c2'), { label: 'Send back to Cooked' });
  assert.equal(r.to, 'used');
  assert.deepEqual(ids(P(s, 'p1').used), ['u2', 'c2']);
  assert.equal(s.board.sendBack('n1').ok, false);
  // the last Cooked part sent back turns the format off
  const t = setup();
  P(t, 'p1').used = [P(t, 'p1').used[0]];
  P(t, 'p1').cookedFormat = 'claude-code';
  t.board.sendBack('u1');
  assert.equal(P(t, 'p1').cookedFormat, undefined);
});

test('serveCooked moves every Cooked part to the end of Served', () => {
  const s = setup();
  roundTrip(s, () => s.board.serveCooked('p1'), { label: 'Move to Served' });
  const p = P(s, 'p1');
  assert.deepEqual(ids(p.combined), ['c1', 'c2', 'u1', 'u2']);
  assert.deepEqual(p.used, []);
  assert.ok(p.combined[2].usedAt > 0);
  assert.equal(s.board.serveCooked('p1').ok, false);
});

test('serveCooked with the Claude Code format serves one formatted note and turns it off', () => {
  const s = setup();
  assert.equal(s.board.setCookedFormat('p1', 'claude-code').ok, true);
  assert.equal(lastLabel(s), 'Format for Claude Code');
  const cc = s.board.view().projects[0].cooked.text;
  assert.match(cc, /^Complete the request below in this codebase\.\n\n<request>\n1\. cooked one\n\n2\. cooked two\n<\/request>/);
  roundTrip(s, () => s.board.serveCooked('p1'), { label: 'Serve as Claude Code', explains: true });
  const p = P(s, 'p1');
  assert.equal(p.combined.length, 3);
  assert.equal(p.combined[2].text, cc);
  assert.deepEqual(p.combined[2].images.map((i) => i.id), [hex(2), hex(3)]);
  assert.equal(p.cookedFormat, undefined);
  assert.deepEqual(p.used, []);
});

test('setCookedFormat toggles, needs Cooked, and undoes', () => {
  const s = setup();
  roundTrip(s, () => s.board.setCookedFormat('p1', 'claude-code'), { label: 'Format for Claude Code' });
  roundTrip(s, () => s.board.setCookedFormat('p1', null), { label: 'Back to original' });
  assert.equal(s.board.setCookedFormat('p3', 'claude-code').ok, false);
  assert.equal(s.board.setCookedFormat('p1', 'other').ok, false);
});

test('reorderNote within Cooking and within Cooked', () => {
  const s = setup();
  roundTrip(s, () => s.board.reorderNote('n3', 0), { label: 'Reorder' });
  assert.deepEqual(ids(P(s, 'p1').notes), ['n3', 'n1', 'n2']);
  roundTrip(s, () => s.board.reorderNote('u1', 99), { label: 'Reorder' });
  assert.deepEqual(ids(P(s, 'p1').used), ['u2', 'u1']);
  assert.deepEqual(s.board.reorderNote('u1', 1), { ok: true, changed: false });
});

test('editStage replaces the opened parts with ONE new note; arrivals stay after it', () => {
  const s = setup();
  // unchanged: nothing happens
  assert.deepEqual(s.board.editStage('p1', 'used', 'cooked one\n\ncooked two'), { ok: true, changed: false });
  const r = roundTrip(s, () => s.board.editStage('p1', 'used', 'all new cooked'), { label: 'Edit Cooked', explains: true });
  const p = P(s, 'p1');
  assert.equal(p.used.length, 1);
  assert.equal(p.used[0].id, r.id);
  assert.equal(p.used[0].text, 'all new cooked');
  assert.deepEqual(p.used[0].images.map((i) => i.id), [hex(2), hex(2), hex(3)]); // the editor holds every part's pictures
  assert.equal(p.used[0].copied, 0);
  assert.ok(p.used[0].usedAt > 0);
  // a part that arrived while the editor was open stays, after the new note
  roundTrip(s, () => s.board.editStage('p1', 'combined', 'served, edited', [], ['c1']), { label: 'Edit Served', explains: true });
  assert.equal(P(s, 'p1').combined.length, 2);
  assert.equal(P(s, 'p1').combined[1].id, 'c2');
  assert.equal(s.board.editStage('p1', 'notes', 'x').ok, false);
  assert.equal(s.board.editStage('p3', 'used', 'x').ok, false);
});

test('deleteStage deletes the whole Cooked note / Served text', () => {
  const s = setup();
  s.board.setCookedFormat('p1', 'claude-code');
  roundTrip(s, () => s.board.deleteStage('p1', 'used'), { label: 'Delete Cooked note', explains: true });
  assert.deepEqual(P(s, 'p1').used, []);
  assert.equal(P(s, 'p1').cookedFormat, undefined);
  roundTrip(s, () => s.board.deleteStage('p1', 'combined', ['c1']), { label: 'Delete Served text', explains: true });
  assert.deepEqual(ids(P(s, 'p1').combined), ['c2']);
  assert.equal(s.board.deleteStage('p3', 'used').ok, false);
});

test('clearList empties Cooked or Served', () => {
  const s = setup();
  roundTrip(s, () => s.board.clearList('p1', 'used'), { label: 'Clear Cooked', explains: true });
  roundTrip(s, () => s.board.clearList('p1', 'combined'), { label: 'Clear Served', explains: true });
  assert.deepEqual(P(s, 'p1').used, []);
  assert.deepEqual(P(s, 'p1').combined, []);
  assert.deepEqual(s.board.clearList('p1', 'used'), { ok: true, changed: false });
  assert.equal(s.board.clearList('p1', 'notes').ok, false);
});

test('highlight sets and removes', () => {
  const s = setup();
  roundTrip(s, () => s.board.highlight('n1', 'rose'), { label: 'Highlight' });
  assert.equal(P(s, 'p1').notes[0].highlight, 'rose');
  roundTrip(s, () => s.board.highlight('n1', null), { label: 'Remove highlight' });
  assert.equal('highlight' in P(s, 'p1').notes[0], false);
  assert.equal(s.board.highlight('n1', 'purple').ok, false);
  assert.deepEqual(s.board.highlight('n1', null), { ok: true, changed: false });
});

test('copying is never a content change, and undo keeps the live count', () => {
  const s = setup();
  s.board.highlight('n1', 'amber');
  const labels = s.page.labels.length;
  const seq = s.page.contentSeq;
  const persists = s.page.persists;
  assert.equal(s.board.copied('n1').ok, true);
  assert.equal(s.board.copied('n1', 3).ok, true);
  assert.equal(s.page.labels.length, labels);
  assert.equal(s.page.contentSeq, seq);
  assert.equal(s.page.persists, persists + 2);
  assert.equal(P(s, 'p1').notes[0].copied, 4);
  assert.ok(P(s, 'p1').notes[0].lastCopiedAt > 0);
  assert.equal(s.board.view().undo.label, 'Highlight'); // no history entry
  s.board.undo();
  assert.equal(P(s, 'p1').notes[0].copied, 4); // carried over, as applySnapshot does
  assert.equal(P(s, 'p1').notes[0].highlight, undefined);
  const r = s.board.copiedStage('p1', 'used');
  assert.equal(r.ok, true);
  assert.equal(s.page.labels.length, labels + 1);
  assert.equal(s.board.copiedStage('nope', 'used').ok, false);
});

// ---------------------------------------------------------------- projects

test('addProject takes the first unused palette colour and goes before the notepad', () => {
  const s = setup();
  s.board.setNotepadText('scratch');
  const r = roundTrip(s, () => s.board.addProject(), { label: 'New project' });
  const d = s.data();
  const p = d.projects.find((x) => x.id === r.id);
  assert.equal(p.name, 'New project');
  assert.equal(p.color, 'fern'); // monstera, moss, sun, orchid are taken
  assert.equal(d.projects[d.projects.length - 1].notepad, true);
  assert.equal(d.projects[d.projects.length - 2].id, r.id);
  const g = s.board.addProject('  Grouped ', { color: 'wine', group: 'G' });
  const order = s.data().projects.map((x) => x.id);
  assert.deepEqual(order.slice(0, 5), ['p1', 'p2', 'p3', 'p4', g.id]); // after G's last member
  assert.equal(P(s, g.id).color, 'wine');
  assert.equal(P(s, g.id).name, 'Grouped');
});

test('rename, recolour, delete, move projects', () => {
  const s = setup();
  roundTrip(s, () => s.board.renameProject('p1', ' Renamed '), { label: 'Rename project' });
  assert.equal(P(s, 'p1').name, 'Renamed');
  assert.equal(s.board.renameProject('p1', '  ').ok, false);
  roundTrip(s, () => s.board.recolorProject('p1', 'ruby'), { label: 'Change color' });
  assert.equal(P(s, 'p1').color, 'ruby');
  roundTrip(s, () => s.board.deleteProject('p3'), { label: 'Delete project', explains: true });
  assert.equal(P(s, 'p3'), undefined);
  // drawn order: p1, [G: p2, p4]
  assert.deepEqual(s.board.view().projects.map((p) => p.id), ['p1', 'p2', 'p4']);
  roundTrip(s, () => s.board.moveProject('p1', 2), { label: 'Reorder projects' });
  assert.deepEqual(s.data().projects.map((p) => p.id), ['p2', 'p4', 'p1']);
  assert.deepEqual(s.board.moveProject('p1', 2), { ok: true, changed: false });
});

test('moveProject uses the drawn order (a group stands where its first member is)', () => {
  const s = setup();
  // data: p1, p2(G), p3, p4(G); drawn: p1, p2, p4, p3
  assert.deepEqual(s.board.view().projects.map((p) => p.id), ['p1', 'p2', 'p4', 'p3']);
  s.board.moveProject('p3', 0);
  assert.deepEqual(s.data().projects.map((p) => p.id), ['p3', 'p1', 'p2', 'p4']);
});

test('setMinimized is synced but not undoable', () => {
  const s = setup();
  s.board.highlight('n1', 'amber');
  P(s, 'p1').localMinimized = true;
  assert.equal(s.board.view().projects[0].minimized, true);
  assert.equal(s.board.setMinimized('p1', false).ok, true);
  assert.equal(lastLabel(s), 'Open column');
  assert.equal('localMinimized' in P(s, 'p1'), false);
  assert.equal(s.board.setMinimized('p1', true).ok, true);
  assert.equal(lastLabel(s), 'Minimize column');
  assert.equal(P(s, 'p1').minimized, true);
  assert.equal(s.board.view().undo.label, 'Highlight');
  s.board.undo();
  assert.equal(P(s, 'p1').minimized, true); // carried over
});

test('groups: join, new group, rename (fold follows), ungroup, move group', () => {
  const s = setup();
  roundTrip(s, () => s.board.setGroup('p1', 'G'), { label: 'Move to group' });
  assert.deepEqual(s.data().projects.map((p) => p.id), ['p2', 'p3', 'p4', 'p1']);
  roundTrip(s, () => s.board.setGroup('p1', null), { label: 'Remove from group' });
  assert.equal('group' in P(s, 'p1'), false);
  const r = s.board.newGroup('p3');
  assert.equal(r.group, 'Important');
  assert.equal(s.board.newGroup('p1').group, 'Group 2');
  s.data().prefs.foldedGroups = ['G'];
  roundTrip(s, () => s.board.renameGroup('G', 'Lane'), { label: 'Rename group' });
  assert.equal(P(s, 'p2').group, 'Lane');
  assert.deepEqual(s.data().prefs.foldedGroups, ['Lane']);
  roundTrip(s, () => s.board.ungroup('Lane'), { label: 'Ungroup' });
  assert.equal('group' in P(s, 'p2'), false);
  assert.equal('foldedGroups' in s.data().prefs, false);
  // move group: drawn p1(Group 2), p2, p3(Important), p4
  roundTrip(s, () => s.board.moveGroup('Important', -1), { label: 'Move group' });
  assert.equal(s.board.renameGroup('nope', 'x').ok, false);
});

// ---------------------------------------------------------------- eating

test('Eating: start and stop are synced labels, not history', () => {
  const s = setup();
  assert.equal(s.board.startEating('p1').ok, true);
  assert.equal(lastLabel(s), 'Eating');
  assert.ok(P(s, 'p1').eating > 0);
  assert.equal(s.board.view().projects[0].eating, P(s, 'p1').eating);
  assert.equal(s.board.view().undo.can, false);
  assert.equal(s.board.stopEating('p1').ok, true);
  assert.equal(lastLabel(s), 'Done eating');
  assert.equal('eating' in P(s, 'p1'), false);
});

test('doneEating moves Served to Eaten, and undo restores Eating too', () => {
  const s = setup();
  s.board.startEating('p1');
  const started = P(s, 'p1').eating;
  const r = roundTrip(s, () => s.board.doneEating('p1'), { label: 'Done eating', explains: true });
  const round = s.data().localEaten[0];
  assert.equal(round.id, r.round);
  assert.equal(round.text, 'served one\n\nserved two');
  assert.equal(round.parts, 2);
  assert.equal(round.startedAt, started);
  assert.deepEqual(P(s, 'p1').combined, []);
  assert.equal('eating' in P(s, 'p1'), false);
  s.board.undo();
  assert.equal(P(s, 'p1').eating, started);
  assert.equal(s.data().localEaten, undefined);
  s.board.redo();
  const v = s.board.view();
  assert.equal(v.eaten.length, 1);
  assert.equal(v.eaten[0].name, 'One');
  // with nothing served, Done just stops eating
  s.board.startEating('p3');
  assert.equal(s.board.doneEating('p3').ok, true);
  assert.equal(lastLabel(s), 'Done eating');
  assert.equal(s.data().localEaten.length, 1);
});

test('serveAgain and deleteEaten', () => {
  const s = setup();
  s.board.doneEating('p1');
  const id = s.data().localEaten[0].id;
  roundTrip(s, () => s.board.serveAgain(id), { label: 'Serve again' });
  assert.equal(P(s, 'p1').combined.length, 1);
  assert.equal(P(s, 'p1').combined[0].text, 'served one\n\nserved two');
  assert.equal(s.data().localEaten, undefined);
  s.board.undo();
  roundTrip(s, () => s.board.deleteEaten(id), { label: 'Delete from Eaten' });
  assert.equal(s.data().localEaten, undefined);
  assert.equal(s.board.deleteEaten('nope').ok, false);
  // a deleted column's round can't be served again; its saved name shows
  s.board.undo();
  s.board.deleteProject('p1');
  assert.equal(s.board.serveAgain(id).ok, false);
  assert.equal(s.board.view().eaten[0].name, 'One');
  assert.equal(s.board.view().eaten[0].alive, false);
});

test('Eaten keeps at most 300 rounds', () => {
  const s = setup();
  s.data().localEaten = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, project: 'p1', name: 'One', color: 'monstera', text: `t${i}`, images: [], parts: 1, startedAt: 0, doneAt: i }));
  s.board.doneEating('p1');
  assert.equal(s.data().localEaten.length, 300);
  assert.equal(s.data().localEaten[299].id, 'r298');
});

// ---------------------------------------------------------------- notepad, drafts, prefs

test('the notepad: made by the first text, saved with no label, outside the history', () => {
  const s = setup();
  assert.deepEqual(s.board.notepad(), { ok: true, projectId: null, noteId: null });
  assert.deepEqual(s.board.setNotepadText(''), { ok: true, changed: false });
  const seq = s.page.contentSeq;
  const r = s.board.setNotepadText('hello ');
  assert.equal(r.ok, true);
  assert.equal(s.page.contentSeq, seq + 1);
  assert.equal(lastLabel(s), null);
  const pad = s.data().projects.find((p) => p.notepad === true);
  assert.equal(pad.name, 'Notepad');
  assert.equal(pad.color, 'slate');
  assert.equal(pad.notes[0].text, 'hello ');
  assert.deepEqual(s.board.notepad(), { ok: true, projectId: pad.id, noteId: pad.notes[0].id });
  const v = s.board.view();
  assert.deepEqual(v.notepad, { projectId: pad.id, noteId: pad.notes[0].id, text: 'hello ' });
  assert.ok(!v.projects.some((p) => p.id === pad.id));
  assert.equal(v.counts.projects, 4);
  assert.equal(v.undo.can, false);
  // board undo leaves the notepad as it is
  s.board.addNote('p1', 'x');
  s.board.setNotepadText('hello there');
  s.board.undo();
  assert.equal(s.board.view().notepad.text, 'hello there');
  // a conflict tag goes when typed into
  pad.notes[0].syncConflict = { of: 'a', device: 'b', at: 1 };
  s.board.setNotepadText('typed');
  assert.equal(pad.notes[0].syncConflict, undefined);
  // the notepad isn't a board project
  assert.equal(s.board.deleteProject(pad.id).ok, false);
  assert.equal(s.board.addNote(pad.id, 'x').ok, false);
  // notepad({ create: true }) makes it at once
  const t = setup();
  const made = t.board.notepad({ create: true });
  assert.ok(made.projectId && made.noteId);
  assert.equal(t.board.view().notepad.text, '');
});

test('setDraft persists without content', () => {
  const s = setup();
  const seq = s.page.contentSeq;
  assert.equal(s.board.setDraft('p1', 'draft text', [img(4), { id: 'bad' }]).ok, true);
  assert.equal(s.page.contentSeq, seq);
  assert.equal(P(s, 'p1').draft, 'draft text');
  assert.deepEqual(P(s, 'p1').draftImages, [img(4)]);
  // undo keeps the live draft
  s.board.highlight('n1', 'amber');
  s.board.setDraft('p1', 'later draft');
  s.board.undo();
  assert.equal(P(s, 'p1').draft, 'later draft');
});

test('setJoiner is a synced content change only when it changes', () => {
  const s = setup();
  assert.equal(s.board.setJoiner('line').ok, true);
  assert.equal(lastLabel(s), 'Join setting');
  assert.equal(s.data().prefs.joiner, 'line');
  assert.equal(s.board.view().joiner, 'line');
  assert.equal(s.board.view().projects[0].served.text, 'served one\nserved two');
  assert.deepEqual(s.board.setJoiner('line'), { ok: true, changed: false });
  assert.equal(s.board.setJoiner('tab').ok, false);
  assert.equal(s.board.view().undo.can, false);
});

test('sortPrompts orders Cooking oldest first', () => {
  const s = setup();
  roundTrip(s, () => s.board.sortPrompts('p1'), { label: 'Sort prompts' });
  assert.deepEqual(ids(P(s, 'p1').notes), ['n2', 'n1', 'n3']);
  assert.deepEqual(s.board.sortPrompts('p1'), { ok: true, changed: false });
});

// ---------------------------------------------------------------- history

test('undo/redo: labels, empty stacks, limit, clearHistory, a new edit drops redo', () => {
  const s = setup();
  assert.deepEqual(s.board.undo(), { ok: false, error: 'nothing to undo' });
  assert.deepEqual(s.board.redo(), { ok: false, error: 'nothing to redo' });
  for (let i = 0; i < 85; i++) s.board.addNote('p3', `n${i}`);
  let undone = 0;
  while (s.board.undo().ok) undone++;
  assert.equal(undone, 80);
  assert.equal(P(s, 'p3').notes.length, 5);
  s.board.redo();
  assert.equal(s.board.view().redo.can, true);
  s.board.addNote('p3', 'fresh');
  assert.equal(s.board.view().redo.can, false);
  s.board.clearHistory();
  assert.equal(s.board.view().undo.can, false);
  assert.equal(s.board.undo().ok, false);
});

test('undo brings back a deleted project with its unknown fields', () => {
  const s = setup();
  s.board.deleteProject('p1');
  s.board.undo();
  assertUnknowns(s);
  assert.deepEqual(s.data().projects.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
});

// ---------------------------------------------------------------- search and view

test('search: every term, case-insensitive, board projects only', () => {
  const s = setup();
  s.board.setNotepadText('alpha in the notepad');
  const r = s.board.search('ALPHA');
  assert.deepEqual(r.map((x) => x.noteId), ['n1', 'm1']);
  assert.deepEqual(r[0], { projectId: 'p1', list: 'notes', noteId: 'n1', text: 'alpha first' });
  assert.deepEqual(s.board.search('cooked two').map((x) => [x.list, x.noteId]), [['used', 'u2']]);
  assert.deepEqual(s.board.search('   '), []);
});

test('view() has the agreed shape and is JSON-safe', () => {
  const s = setup();
  P(s, 'p1').notes[0].syncConflict = { of: 'x', device: 'dev', at: 9 };
  P(s, 'p1').notes[1].highlight = 'sky';
  const v = s.board.view();
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
  assert.deepEqual(Object.keys(v).sort(), ['counts', 'eaten', 'joiner', 'notepad', 'projects', 'redo', 'undo']);
  assert.deepEqual(v.counts, { projects: 4, notes: 8 });
  const p = v.projects[0];
  assert.deepEqual(Object.keys(p).sort(), ['color', 'cooked', 'cookedFormat', 'draft', 'draftImages', 'eating', 'group', 'id', 'minimized', 'name', 'notes', 'served'].sort());
  assert.equal(p.group, null);
  assert.equal(v.projects[1].group, 'G');
  assert.equal(p.cooked.text, 'cooked one\n\ncooked two');
  assert.deepEqual(p.cooked.images.map((i) => i.id), [hex(2), hex(3)]);
  assert.deepEqual(p.cooked.images[0], { id: hex(2), w: 102, h: 52 });
  const n = p.notes[0];
  assert.deepEqual(Object.keys(n).sort(), ['conflict', 'copied', 'createdAt', 'highlight', 'id', 'images', 'lastCopiedAt', 'text', 'updatedAt', 'usedAt']);
  assert.deepEqual(n.conflict, { device: 'dev', at: 9 });
  assert.equal(p.notes[1].highlight, 'sky');
  assert.equal(p.notes[1].conflict, null);
  assert.equal(v.notepad, null);
  assert.deepEqual(v.undo, { can: false, label: null });
});

test('an unknown or missing id never throws', () => {
  const s = setup();
  for (const [name, args] of Object.entries({
    editNote: ['x', 'y'], deleteNote: ['x'], moveToCooked: ['x'], sendBack: ['x'], serveCooked: ['x'], reorderNote: ['x', 0],
    editStage: ['x', 'used', 't'], deleteStage: ['x', 'used'], clearList: ['x', 'used'], highlight: ['x', 'amber'], copied: ['x'],
    renameProject: ['x', 'n'], recolorProject: ['x', 'moss'], deleteProject: ['x'], moveProject: ['x', 0], setMinimized: ['x', true],
    setGroup: ['x', 'g'], ungroup: ['x'], setCookedFormat: ['x', null], startEating: ['x'], doneEating: ['x'], serveAgain: ['x'],
    deleteEaten: ['x'], setDraft: ['x', ''], sortPrompts: ['x'],
  })) {
    const r = s.board[name](...args);
    assert.equal(r.ok, false, name);
    assert.equal(typeof r.error, 'string', name);
  }
  assert.equal(s.page.labels.length, 0);
});
