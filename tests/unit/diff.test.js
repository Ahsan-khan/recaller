'use strict';
// Pending local changes (src/sync/diff.js). Plain Node: node --test tests/unit/diff.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { toModel, isPristineWelcome } = require('../../src/sync/model');
const { diffLocal, localKeys, quarantineSig, pushedEntry, MAX_DOC_BYTES } = require('../../src/sync/diff');

const note = (id, text, extra = {}) => ({ id, text, images: [], createdAt: 1000, updatedAt: 1000, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const project = (id, name, lists = {}, extra = {}) => ({
  id, name, color: 'moss', createdAt: 1000, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [],
  notes: [], used: [], combined: [], ...lists, ...extra,
});
const board = (projects, prefs = {}) => ({ version: 2, prefs: { density: 'slim', ...prefs }, projects });
const clone = (v) => JSON.parse(JSON.stringify(v));

function sampleBoard() {
  return board([
    project('p1', 'Alpha', { notes: [note('a', 'A'), note('b', 'B'), note('c', 'C'), note('d', 'D')], used: [note('u', 'U', { usedAt: 5 })] }),
    project('p2', 'Beta', { notes: [note('e', 'E')], combined: [note('f', 'F', { usedAt: 6 })] }),
  ], { joiner: 'blank' });
}

// The shadow after every pending change has been committed at `rev`.
function commit(shadow, diff, rev) {
  const next = clone(shadow || { version: 1, rev: 0, board: { joiner: null }, projects: {}, notes: {} });
  for (const item of [...diff.upserts, ...diff.tombstones]) next[`${item.kind}s`][item.id] = pushedEntry(item, { rev, updateTime: `t${rev}`, docId: item.id });
  if (diff.board) next.board = { joiner: diff.board.joiner };
  next.rev = rev;
  return next;
}

function synced(data) {
  return commit(null, diffLocal({ shadow: null, local: toModel(data) }), 1);
}

const reasons = (diff) => diff.upserts.map((u) => `${u.id}:${u.reason}`);

test('first upload: everything is new, with balanced keys in screen order', () => {
  const diff = diffLocal({ shadow: null, local: toModel(sampleBoard()) });
  assert.deepEqual(reasons(diff), ['p1:new', 'p2:new', 'a:new', 'b:new', 'c:new', 'd:new', 'u:new', 'e:new', 'f:new']);
  assert.equal(diff.pending, 10); // nine items and the joiner
  assert.deepEqual(diff.board, { joiner: 'blank' });
  assert.deepEqual(diff.tombstones, []);
  const keysOf = (ids) => ids.map((id) => diff.upserts.find((u) => u.id === id).key);
  const inOrder = (ks) => ks.every((k, i) => i === 0 || ks[i - 1] < k);
  assert.ok(inOrder(keysOf(['p1', 'p2'])));
  assert.ok(inOrder(keysOf(['a', 'b', 'c', 'd'])));
  const a = diff.upserts.find((u) => u.id === 'a');
  assert.deepEqual([a.project, a.list, a.copied, a.lastCopiedAt], ['p1', 'notes', 0, 0]);
  assert.equal(diff.upserts.find((u) => u.id === 'u').list, 'used');
  assert.equal(diff.upserts.find((u) => u.id === 'f').list, 'combined');
});

test('nothing pending right after a commit; per-device changes never count', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  assert.equal(diffLocal({ shadow, local: toModel(data) }).pending, 0);
  const view = clone(data);
  view.projects[0].notesCollapsed = true;
  view.projects[0].usedCollapsed = true;
  view.projects[1].augCollapsed = true;
  view.projects[0].draft = 'typing…';
  view.projects[0].draftImages = [{ id: 'a'.repeat(32), w: 1, h: 1 }];
  view.projects[0].notes[0].expanded = true;
  view.projects[0].localFuture = 1;
  view.prefs.colWidths = { p1: 400 };
  view.prefs.titleFont = 'caps';
  view.prefs.scroll = { board: 50 };
  const diff = diffLocal({ shadow, local: toModel(view) });
  assert.equal(diff.pending, 0);
  assert.equal(diff.counterOnly, false);
});

test('changes: text, highlight, a move to Cooked, and a new note', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes[1].text = 'B edited';
  next.projects[0].notes[1].updatedAt = 2000;
  next.projects[0].notes[2].highlight = 'amber';
  const [moved] = next.projects[0].notes.splice(3, 1);
  moved.usedAt = 3000;
  next.projects[0].used.push(moved);
  next.projects[1].notes.push(note('g', 'G'));
  const diff = diffLocal({ shadow, local: toModel(next) });
  assert.deepEqual(reasons(diff).sort(), ['b:change', 'c:change', 'd:change', 'g:new']);
  const d = diff.upserts.find((u) => u.id === 'd');
  assert.deepEqual([d.project, d.list, d.fields.usedAt], ['p1', 'used', 3000]);
  assert.ok(d.key > shadow.notes.u.k, 'appended after the Cooked note already there');
});

test('a drag writes one note; sorting writes only the notes that moved', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const dragged = clone(data);
  const [c] = dragged.projects[0].notes.splice(2, 1);
  dragged.projects[0].notes.unshift(c);
  assert.deepEqual(reasons(diffLocal({ shadow, local: toModel(dragged) })), ['c:change']);

  const reversed = clone(data);
  reversed.projects[0].notes.reverse();
  const diff = diffLocal({ shadow, local: toModel(reversed) });
  assert.equal(diff.upserts.length, 3); // four notes, one keeps its key
  const keys = localKeys(toModel(reversed), shadow);
  const order = reversed.projects[0].notes.map((n) => keys.get(n.id));
  assert.ok(order.every((k, i) => i === 0 || order[i - 1] < k));

  const columns = clone(data);
  columns.projects.reverse();
  assert.equal(diffLocal({ shadow, local: toModel(columns) }).upserts.length, 1);
});

test('copies are counters: counter-only changes are flagged', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes[0].copied = 3;
  next.projects[0].notes[0].lastCopiedAt = 9000;
  let diff = diffLocal({ shadow, local: toModel(next) });
  assert.deepEqual(reasons(diff), ['a:counter']);
  assert.equal(diff.counterOnly, true);
  assert.deepEqual([diff.upserts[0].copied, diff.upserts[0].lastCopiedAt], [3, 9000]);
  assert.equal(diff.pending, 1);
  next.projects[0].notes[1].text = 'and an edit';
  diff = diffLocal({ shadow, local: toModel(next) });
  assert.equal(diff.counterOnly, false);
  // A content change carries the counters too (items are written whole).
  const b = diff.upserts.find((u) => u.id === 'b');
  assert.deepEqual([b.reason, b.copied], ['change', 0]);
});

test('deletes are tombstones with a trash copy, in normal mode only', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes.splice(1, 1); // b
  next.projects.splice(1, 1); // p2 with e and f
  const diff = diffLocal({ shadow, local: toModel(next), mode: 'normal' });
  assert.deepEqual(diff.tombstones.map((t) => `${t.kind}:${t.id}`), ['note:b', 'note:e', 'note:f', 'project:p2']);
  assert.deepEqual(diff.deletions, { notes: 3, projects: 1 });
  const b = diff.tombstones[0];
  assert.deepEqual([b.key, b.project, b.list], [shadow.notes.b.k, 'p1', 'notes']);
  assert.deepEqual(JSON.parse(b.trashData), shadow.notes.b.f);
  assert.equal(JSON.parse(diff.tombstones[3].trashData).name, 'Beta');
  assert.equal(diff.pending, 4);

  for (const mode of ['union', 'restore']) {
    const d = diffLocal({ shadow, local: toModel(next), mode });
    assert.deepEqual(d.tombstones, [], mode);
    assert.deepEqual(d.deletions, { notes: 0, projects: 0 }, mode);
    assert.equal(d.pending, 0, mode);
  }
});

test('union and restore still push edits and new notes', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes[0].text = 'edited meanwhile';
  next.projects[0].notes.splice(1, 1);
  next.projects[0].notes.push(note('z', 'new meanwhile'));
  for (const mode of ['normal', 'union', 'restore']) {
    const diff = diffLocal({ shadow, local: toModel(next), mode });
    assert.deepEqual(reasons(diff).sort(), ['a:change', 'z:new'], mode);
    assert.equal(diff.tombstones.length, mode === 'normal' ? 1 : 0, mode);
  }
});

test('a note back after its tombstone is an undelete', () => {
  const data = sampleBoard();
  let shadow = synced(data);
  const without = clone(data);
  without.projects[0].notes.splice(0, 1);
  shadow = commit(shadow, diffLocal({ shadow, local: toModel(without) }), 2);
  assert.equal(shadow.notes.a.d, true);
  assert.equal(shadow.notes.a.f.text, 'A', 'the tombstone keeps its last fields');
  const diff = diffLocal({ shadow, local: toModel(data) });
  assert.deepEqual(reasons(diff), ['a:undelete']);
  assert.equal(diff.upserts[0].key, shadow.notes.a.k, 'it goes back where it was');
});

test('entities the defensive model skipped are never tombstoned', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const broken = clone(data);
  broken.projects[0].notes[0].text = { not: 'a string' }; // a: dropped by normalize(), still on disk
  broken.projects[1].id = 'p1'; // p2 now duplicates p1: normalize() gives it a new id; e and f live in it
  const diff = diffLocal({ shadow, local: toModel(broken), mode: 'normal' });
  // The id p2 is gone from the file, so only it goes; a, e and f are still on disk.
  assert.deepEqual(diff.tombstones.map((t) => t.id), ['p2']);
  assert.deepEqual(diff.upserts, []);
});

test('quarantined items wait until they change', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes[0].text = 'refused by the rules';
  next.projects[0].notes.splice(1, 1);
  const first = diffLocal({ shadow, local: toModel(next) });
  const a = first.upserts.find((u) => u.id === 'a');
  const b = first.tombstones.find((t) => t.id === 'b');
  const quarantine = {
    'note:a': { code: 'PERMISSION', sig: quarantineSig(a), at: 1 },
    'note:b': { code: 'PERMISSION', sig: quarantineSig(b), at: 1 },
  };
  const held = diffLocal({ shadow, local: toModel(next), quarantine });
  assert.deepEqual(held.upserts, []);
  assert.deepEqual(held.tombstones, []);
  assert.deepEqual(held.quarantined.sort(), ['note:a', 'note:b']);
  assert.equal(held.pending, 0);
  assert.deepEqual(held.deletions, { notes: 0, projects: 0 });
  // A copy doesn't change the signature; an edit does.
  next.projects[0].notes[0].copied = 1;
  assert.deepEqual(diffLocal({ shadow, local: toModel(next), quarantine }).upserts.map((u) => u.reason), []);
  next.projects[0].notes[0].text = 'fixed';
  const retried = diffLocal({ shadow, local: toModel(next), quarantine: new Map(Object.entries(quarantine)) });
  assert.deepEqual(reasons(retried), ['a:change']);
});

test('too large: over 900 KB estimated, or over 150 fields, stays on this computer', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const next = clone(data);
  next.projects[0].notes[0].text = 'x'.repeat(MAX_DOC_BYTES);
  const wide = note('w', 'many fields');
  for (let i = 0; i < 150; i++) wide[`field${i}`] = i;
  next.projects[1].notes.push(wide);
  next.projects[1].notes.push(note('ok', 'x'.repeat(500 * 1000)));
  const diff = diffLocal({ shadow, local: toModel(next) });
  assert.deepEqual(diff.tooLarge.sort(), ['a', 'w']);
  assert.deepEqual(reasons(diff), ['ok:new']);
  assert.equal(diff.pending, 1);
});

test('the joiner: a change is pending; one never set here is no opinion', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const line = clone(data);
  line.prefs.joiner = 'line';
  const diff = diffLocal({ shadow, local: toModel(line) });
  assert.deepEqual(diff.board, { joiner: 'line' });
  assert.equal(diff.pending, 1);
  assert.equal(diff.counterOnly, false);
  const unset = clone(data);
  delete unset.prefs.joiner;
  assert.equal(diffLocal({ shadow, local: toModel(unset) }).board, null);
});

test('long keys: the list is re-keyed evenly on its next push (never in a merge)', () => {
  const data = sampleBoard();
  const shadow = synced(data);
  const long = 'V'.repeat(47);
  shadow.notes.a.k = `${long}F`;
  shadow.notes.b.k = `${long}V`;
  shadow.notes.c.k = `${long}VV`;
  shadow.notes.d.k = `${long}k`;
  const diff = diffLocal({ shadow, local: toModel(data) });
  assert.deepEqual(reasons(diff).sort(), ['a:change', 'b:change', 'c:change', 'd:change']);
  const keys = ['a', 'b', 'c', 'd'].map((id) => diff.upserts.find((u) => u.id === id).key);
  assert.ok(keys.every((k, i) => k.length <= 2 && (i === 0 || keys[i - 1] < k)));
  const kept = localKeys(toModel(data), shadow, { rekey: false });
  assert.equal(kept.get('c'), `${long}VV`);
});

test('seeded: this computer\'s fresh Welcome seed is never uploaded', () => {
  const seed = board([project('w', 'Welcome', { notes: Array.from({ length: 10 }, (_, i) => note(`t${i}`, `tip ${i}`)) }, { color: 'monstera' })]);
  assert.equal(isPristineWelcome(seed.projects[0]), true);
  const account = sampleBoard();
  const shadow = synced(account);
  const diff = diffLocal({ shadow, local: toModel(seed), mode: 'union', seeded: true });
  assert.deepEqual(diff.upserts, []);
  assert.equal(diffLocal({ shadow, local: toModel(seed), mode: 'union' }).upserts.length, 11);
});

test('pushedEntry: the shadow entry for a committed upsert or tombstone', () => {
  const data = sampleBoard();
  const diff = diffLocal({ shadow: null, local: toModel(data) });
  const a = diff.upserts.find((u) => u.id === 'a');
  assert.deepEqual(pushedEntry(a, { rev: 7, updateTime: 'u7', docId: 'a' }), {
    f: a.fields, k: a.key, r: 7, u: 'u7', d: false, i: 'a', p: 'p1', l: 'notes', c: 0, lc: 0,
  });
  const p1 = diff.upserts.find((u) => u.id === 'p1');
  assert.deepEqual(pushedEntry(p1, { rev: 7 }), { f: p1.fields, k: p1.key, r: 7, u: null, d: false, i: '' });
  const shadow = commit(null, diff, 1);
  const none = board([project('p1', 'Alpha'), project('p2', 'Beta')]);
  const t = diffLocal({ shadow, local: toModel(none) }).tombstones.find((x) => x.id === 'a');
  const entry = pushedEntry(t, { rev: 8, updateTime: 'u8', docId: 'a' });
  assert.equal(entry.d, true);
  assert.deepEqual(entry.f, shadow.notes.a.f);
  assert.deepEqual([entry.k, entry.p, entry.l, entry.r], [shadow.notes.a.k, 'p1', 'notes', 8]);
});
