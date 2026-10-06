'use strict';
// Merge rules (src/sync/merge.js, ai_memory/15 section 5.7). Plain Node: node --test tests/unit/merge.test.js
// This computer is A (a PC); the other computer B (a Mac) pushes its changes against the same
// shadow, exactly as its own diff would, and A pulls them.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { toModel, remoteEntity, LISTS, shadowView } = require('../../src/sync/model');
const { diffLocal, pushedEntry } = require('../../src/sync/diff');
const { mergeRemote, applyShadowDelta, shadowDelta, neededTrash, conflictId } = require('../../src/sync/merge');
const { applyPatch } = require('../../src/renderer/sync-apply');

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const DEVICES = new Map([[A, { platform: 'win32' }], [B, { platform: 'darwin' }]]);
const MAC = { platform: 'darwin', sameAsThis: false };
const NOW = 1759400000000;

const clone = (v) => JSON.parse(JSON.stringify(v));
const note = (id, text, extra = {}) => ({ id, text, images: [], createdAt: 1000, updatedAt: 1000, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const project = (id, name, lists = {}, extra = {}) => ({
  id, name, color: 'moss', createdAt: 1000, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [],
  notes: [], used: [], combined: [], ...lists, ...extra,
});
const board = (projects, prefs = {}) => ({ version: 2, prefs: { density: 'slim', ...prefs }, projects });

function start() {
  return board([
    project('p1', 'Alpha', { notes: [note('a', 'A', { copied: 2, lastCopiedAt: 100 }), note('b', 'B'), note('c', 'C')], used: [note('u', 'U', { usedAt: 5 })] }),
    project('p2', 'Beta', { notes: [note('e', 'E')] }),
  ], { joiner: 'blank' });
}

// ---- a tiny world: the shadow both computers share, and B's pushes as a pull brings them

function commit(shadow, diff, rev) {
  const next = clone(shadow || { version: 1, rev: 0, board: { joiner: null }, projects: {}, notes: {} });
  for (const item of [...diff.upserts, ...diff.tombstones]) next[`${item.kind}s`][item.id] = pushedEntry(item, { rev, updateTime: `t${rev}`, docId: item.id });
  if (diff.board) next.board = { joiner: diff.board.joiner };
  next.rev = rev;
  return next;
}

const synced = (data) => commit(null, diffLocal({ shadow: null, local: toModel(data) }), 1);

function doc(kind, id, { rev, key, by = B, deleted = false, fields = {}, project: pid, list } = {}) {
  return remoteEntity(kind, { docId: id, fields: clone(fields), sync: { rev, key, deleted, by, project: pid, list }, updateTime: `t${rev}` });
}

// The documents B's push writes when B's board is `data` (what A's next pull returns).
function pushFrom(shadow, data, { rev = 2, by = B } = {}) {
  const diff = diffLocal({ shadow, local: toModel(data) });
  const remote = { rev, board: { joiner: diff.board ? diff.board.joiner : shadow?.board?.joiner ?? null }, projects: new Map(), notes: new Map() };
  for (const u of diff.upserts) {
    const fields = u.kind === 'note' ? { ...u.fields, copied: u.copied, lastCopiedAt: u.lastCopiedAt } : u.fields;
    remote[`${u.kind}s`].set(u.id, doc(u.kind, u.id, { rev, key: u.key, by, fields, project: u.project, list: u.list }));
  }
  for (const t of diff.tombstones) remote[`${t.kind}s`].set(t.id, doc(t.kind, t.id, { rev, key: t.key, by, deleted: true, project: t.project, list: t.list }));
  return remote;
}

const nothingNew = (shadow) => ({ rev: shadow.rev, board: { joiner: shadow.board.joiner }, projects: new Map(), notes: new Map() });
const merge = (opts) => mergeRemote({ deviceId: A, devices: DEVICES, now: NOW, mode: 'normal', ...opts });

function applied(data, patch) {
  const page = clone(data);
  if (patch) applyPatch(page, patch);
  return page;
}

// A pulls B's changes: `mine` and `theirs` edit copies of the shared starting board.
function pull({ from = start(), mine = () => {}, theirs = null, mode = 'normal', ...extra } = {}) {
  const shadow = synced(from);
  const local = clone(from);
  mine(local);
  let remote = nothingNew(shadow);
  if (theirs) {
    const other = clone(from);
    theirs(other);
    remote = pushFrom(shadow, other);
  }
  const result = merge({ shadow, local: toModel(local), remote, mode, ...extra });
  return { shadow, local, remote, result, page: applied(local, result.patch) };
}

// What A pushes once the patch is acknowledged and shadowAfter is committed.
function afterAck(s) {
  const shadow = applyShadowDelta(s.shadow, s.result.shadowAfter);
  return { shadow, diff: diffLocal({ shadow, local: toModel(s.page) }) };
}

const ids = (data, pid, list = 'notes') => (data.projects.find((p) => p.id === pid)?.[list] || []).map((n) => n.id);
const columns = (data) => data.projects.map((p) => p.id);
function find(data, id) {
  for (const p of data.projects) for (const l of LISTS) for (const n of p[l]) if (n.id === id) return { note: n, project: p.id, list: l };
  return null;
}
const codes = (r) => r.notices.map((n) => n.code);
const reasons = (diff) => diff.upserts.map((u) => `${u.id}:${u.reason}`).sort();
const unlink = (data, id) => {
  for (const p of data.projects) for (const l of LISTS) {
    const i = p[l].findIndex((n) => n.id === id);
    if (i >= 0) return p[l].splice(i, 1)[0];
  }
  return null;
};
const dropProject = (data, id) => data.projects.splice(data.projects.findIndex((p) => p.id === id), 1)[0];
const n = (data, id) => find(data, id).note;
const p = (data, id) => data.projects.find((x) => x.id === id);

// ================================================================ normal mode

test('only one side changed a register: that side\'s value', () => {
  // Remote-only: text, a move to Cooked, a highlight, a project rename and the joiner.
  const s = pull({
    theirs: (d) => {
      Object.assign(n(d, 'a'), { text: 'A on the Mac', updatedAt: 2000 });
      const c = unlink(d, 'c');
      c.usedAt = 3000;
      p(d, 'p1').used.push(c);
      n(d, 'e').highlight = 'sky';
      p(d, 'p2').name = 'Beta renamed';
      d.prefs.joiner = 'line';
    },
  });
  assert.equal(n(s.page, 'a').text, 'A on the Mac');
  assert.equal(n(s.page, 'a').updatedAt, 2000);
  assert.deepEqual(ids(s.page, 'p1'), ['a', 'b']);
  assert.deepEqual(ids(s.page, 'p1', 'used'), ['u', 'c']);
  assert.equal(n(s.page, 'c').usedAt, 3000);
  assert.equal(n(s.page, 'e').highlight, 'sky');
  assert.equal(p(s.page, 'p2').name, 'Beta renamed');
  assert.equal(s.page.prefs.joiner, 'line');
  assert.deepEqual(s.result.notices, []);
  assert.equal(s.result.patch.changesContent, true);
  assert.equal(s.result.patch.resetHistory, true);
  assert.deepEqual(afterAck(s).diff.upserts, [], 'nothing to push back');

  // Local-only: kept as they are and pushed after the ack.
  const t = pull({
    mine: (d) => {
      Object.assign(n(d, 'b'), { text: 'B on the PC', updatedAt: 2000 });
      n(d, 'e').highlight = 'rose';
      d.prefs.joiner = 'line';
    },
    theirs: (d) => { n(d, 'c').text = 'C on the Mac'; },
  });
  assert.equal(n(t.page, 'b').text, 'B on the PC');
  assert.equal(n(t.page, 'e').highlight, 'rose');
  assert.equal(t.page.prefs.joiner, 'line');
  assert.equal(n(t.page, 'c').text, 'C on the Mac');
  assert.deepEqual(Object.keys(t.result.patch.notes.upsert), ['c']);
  assert.equal(t.result.patch.board, undefined);
  const after = afterAck(t).diff;
  assert.deepEqual(reasons(after), ['b:change', 'e:change']);
  assert.deepEqual(after.board, { joiner: 'line' });
});

test('a remote highlight removal deletes the key on the page', () => {
  const from = start();
  n(from, 'b').highlight = 'amber';
  const s = pull({ from, theirs: (d) => { delete n(d, 'b').highlight; } });
  assert.equal(Object.hasOwn(n(s.page, 'b'), 'highlight'), false);
});

test('both changed a register to the same value: that value, no conflict', () => {
  const s = pull({
    mine: (d) => { Object.assign(n(d, 'a'), { text: 'same words', updatedAt: 2000 }); n(d, 'b').highlight = 'amber'; },
    theirs: (d) => { Object.assign(n(d, 'a'), { text: 'same words', updatedAt: 3000 }); n(d, 'b').highlight = 'amber'; },
  });
  assert.deepEqual(codes(s.result), []);
  assert.equal(n(s.page, 'a').text, 'same words');
  assert.equal(s.page.projects[0].notes.length, 3, 'no copy');
  assert.equal(n(s.page, 'b').highlight, 'amber');
});

test('both changed content differently: the account\'s stays in place, this computer\'s becomes a copy right after it', () => {
  const s = pull({
    mine: (d) => { Object.assign(n(d, 'a'), { text: 'A on the PC', updatedAt: 2000, highlight: 'rose' }); },
    theirs: (d) => { Object.assign(n(d, 'a'), { text: 'A on the Mac', updatedAt: 3000 }); },
  });
  const hash = crypto.createHash('sha256').update('A on the PC\n').digest('hex').slice(0, 8);
  const copyId = `a-c${hash}`;
  assert.equal(conflictId('a', { text: 'A on the PC', images: [] }), copyId);
  assert.deepEqual(ids(s.page, 'p1'), ['a', copyId, 'b', 'c']);
  const original = n(s.page, 'a');
  assert.deepEqual([original.text, original.updatedAt, original.copied], ['A on the Mac', 3000, 2]);
  const copy = n(s.page, copyId);
  assert.deepEqual(
    [copy.text, copy.updatedAt, copy.highlight, copy.copied, copy.lastCopiedAt],
    ['A on the PC', 2000, 'rose', 0, 0],
  );
  assert.deepEqual(copy.syncConflict, { of: 'a', device: A, at: NOW });
  assert.deepEqual(s.result.notices, [{ code: 'CONFLICT', count: 1 }]);
  assert.equal(s.result.patch.changesContent, true);
  // Pictures count too, and the copy is amber when the local note had no highlight.
  const img = { id: 'f'.repeat(32), w: 10, h: 10 };
  const t = pull({
    mine: (d) => { n(d, 'b').images = [img]; },
    theirs: (d) => { n(d, 'b').text = 'B on the Mac'; },
  });
  const tid = conflictId('b', { text: 'B', images: [img] });
  assert.deepEqual(ids(t.page, 'p1'), ['a', 'b', tid, 'c']);
  assert.equal(n(t.page, tid).highlight, 'amber');
  assert.deepEqual(n(t.page, tid).images, [img]);
  assert.deepEqual(n(t.page, 'b').images, []);
  // After the ack, the copy uploads as a new note right after the original.
  const after = afterAck(t);
  assert.deepEqual(reasons(after.diff), [`${tid}:new`]);
  const key = after.diff.upserts[0].key;
  assert.ok(key > after.shadow.notes.b.k && key < after.shadow.notes.c.k);
});

test('conflict-copy ids are deterministic, and merging again adds no second copy', () => {
  const run = () => pull({
    mine: (d) => { n(d, 'a').text = 'mine'; },
    theirs: (d) => { n(d, 'a').text = 'theirs'; },
  });
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);
  // Merging the same pull again after the page applied it (a crash before shadow.json):
  const again = merge({ shadow: first.shadow, local: toModel(first.page), remote: first.remote });
  assert.equal(again.patch?.changesContent ?? false, false);
  assert.deepEqual(Object.keys(again.patch?.notes.upsert ?? {}), []);
  assert.deepEqual(codes(again), []);
  // After the ack (shadow advanced): nothing at all.
  const shadow = applyShadowDelta(first.shadow, first.result.shadowAfter);
  assert.equal(merge({ shadow, local: toModel(first.page), remote: first.remote }).patch, null);
});

test('a copy that already exists with the same text is not made twice; a different one gets the next id', () => {
  const cid = conflictId('a', { text: 'mine', images: [] });
  const s = pull({
    mine: (d) => {
      n(d, 'a').text = 'mine';
      p(d, 'p2').notes.push(note(cid, 'something else entirely'));
    },
    theirs: (d) => { n(d, 'a').text = 'theirs'; },
  });
  assert.ok(find(s.page, `${cid}-2`), 'the next free id');
  assert.equal(n(s.page, `${cid}-2`).text, 'mine');
  const t = pull({
    mine: (d) => {
      n(d, 'a').text = 'mine';
      p(d, 'p2').notes.push(note(cid, 'mine'));
    },
    theirs: (d) => { n(d, 'a').text = 'theirs'; },
  });
  assert.equal(find(t.page, `${cid}-2`), null);
  assert.deepEqual(codes(t.result), []);
});

test('both changed position or another field: this computer wins (it pushes last)', () => {
  const s = pull({
    mine: (d) => {
      const c = unlink(d, 'c');
      p(d, 'p1').notes.unshift(c);
      n(d, 'b').highlight = 'rose';
      p(d, 'p2').color = 'sun';
    },
    theirs: (d) => {
      const c = unlink(d, 'c');
      c.usedAt = 4000;
      p(d, 'p1').used.push(c);
      n(d, 'b').highlight = 'sky';
      p(d, 'p2').color = 'ruby';
    },
  });
  assert.equal(s.result.patch, null);
  assert.deepEqual(ids(s.page, 'p1'), ['c', 'a', 'b']);
  const after = afterAck(s).diff;
  assert.deepEqual(reasons(after), ['b:change', 'c:change', 'p2:change']);
  const c = after.upserts.find((x) => x.id === 'c');
  assert.deepEqual([c.list, c.fields.usedAt], ['notes', 0]);
});

test('copy counts: remote + (local − base), lastCopiedAt the larger, sent as a delta', () => {
  const s = pull({
    mine: (d) => { Object.assign(n(d, 'a'), { copied: 5, lastCopiedAt: 500 }); },
    theirs: (d) => { Object.assign(n(d, 'a'), { copied: 3, lastCopiedAt: 900 }); },
  });
  assert.deepEqual(s.result.patch.notes.counters, { a: { copiedDelta: 1, lastCopiedAt: 900 } });
  assert.equal(s.result.patch.changesContent, false);
  assert.equal(s.result.patch.resetHistory, false);
  assert.deepEqual([n(s.page, 'a').copied, n(s.page, 'a').lastCopiedAt], [6, 900]);
  // A copy made on the page while the patch waited is not lost.
  const busy = clone(s.local);
  n(busy, 'a').copied = 7;
  applyPatch(busy, s.result.patch);
  assert.equal(n(busy, 'a').copied, 8);
  // After the ack the total goes up, and B's merge gets the same total.
  const after = afterAck(s);
  assert.deepEqual(reasons(after.diff), ['a:counter']);
  assert.equal(after.diff.upserts[0].copied, 6);
  assert.equal(after.diff.counterOnly, true);
  const back = merge({ shadow: after.shadow, local: toModel(s.page), remote: nothingNew(after.shadow) });
  assert.equal(back.patch, null);
});

test('local deleted, remote changed the content or an unknown field: kept (KEPT_NOTE)', () => {
  const s = pull({
    mine: (d) => { unlink(d, 'b'); },
    theirs: (d) => { Object.assign(n(d, 'b'), { text: 'B edited on the Mac', updatedAt: 2000 }); },
  });
  assert.deepEqual(ids(s.page, 'p1'), ['a', 'b', 'c']);
  assert.equal(n(s.page, 'b').text, 'B edited on the Mac');
  assert.deepEqual(s.result.notices, [{ code: 'KEPT_NOTE', count: 1, device: MAC }]);
  assert.deepEqual(afterAck(s).diff.tombstones, []);
  const t = pull({ mine: (d) => { unlink(d, 'b'); }, theirs: (d) => { n(d, 'b').futureNoteField = { v: 2 }; } });
  assert.deepEqual(n(t.page, 'b').futureNoteField, { v: 2 });
  assert.deepEqual(codes(t.result), ['KEPT_NOTE']);
});

test('local deleted, remote changed only position, highlight or counters, or nothing: the tombstone goes up', () => {
  const variants = {
    moved: (d) => { const b = unlink(d, 'b'); b.usedAt = 9; p(d, 'p1').used.push(b); },
    highlighted: (d) => { n(d, 'b').highlight = 'lime'; },
    copied: (d) => { Object.assign(n(d, 'b'), { copied: 4, lastCopiedAt: 50 }); },
    nothing: (d) => { n(d, 'c').text = 'something else changed'; },
  };
  for (const [what, theirs] of Object.entries(variants)) {
    const s = pull({ mine: (d) => { unlink(d, 'b'); }, theirs });
    assert.equal(find(s.page, 'b'), null, what);
    assert.deepEqual(codes(s.result), [], what);
    assert.deepEqual(afterAck(s).diff.tombstones.map((t) => t.id), ['b'], what);
  }
});

test('remote tombstone, local changed the content or an unknown field: kept here, then undeleted', () => {
  for (const mine of [(d) => { n(d, 'a').text = 'A edited on the PC'; }, (d) => { n(d, 'a').futureNoteField = 1; }]) {
    const s = pull({ mine, theirs: (d) => { unlink(d, 'a'); } });
    assert.ok(find(s.page, 'a'));
    // No toast here: this computer's note just stays; the computer that deleted it is told
    // (KEPT_NOTE) when the undelete reaches it.
    assert.deepEqual(codes(s.result), []);
    assert.deepEqual(reasons(afterAck(s).diff), ['a:undelete']);
  }
});

test('the computer that deleted it hears about it when the undelete arrives (KEPT_NOTE)', () => {
  const s = pull({ mine: (d) => { unlink(d, 'a'); } });
  const shadow = commit(s.shadow, diffLocal({ shadow: s.shadow, local: toModel(s.local) }), 2); // A's delete is pushed
  assert.equal(shadow.notes.a.d, true);
  const edited = clone(start());
  n(edited, 'a').text = 'A edited on the Mac';
  const undelete = { rev: 3, board: { joiner: 'blank' }, projects: new Map(), notes: new Map() };
  const a = diffLocal({ shadow, local: toModel(edited) }).upserts.find((u) => u.id === 'a');
  undelete.notes.set('a', doc('note', 'a', { rev: 3, key: a.key, fields: { ...a.fields, copied: a.copied, lastCopiedAt: a.lastCopiedAt }, project: 'p1', list: 'notes' }));
  const r = merge({ shadow, local: toModel(s.local), remote: undelete });
  assert.ok(find(applied(s.local, r.patch), 'a'));
  assert.deepEqual(r.notices, [{ code: 'KEPT_NOTE', count: 1, device: MAC }]);
  // An Undo there (same text back) brings it back silently.
  const undo = { ...undelete, notes: new Map([['a', doc('note', 'a', { rev: 3, key: a.key, fields: { ...n(start(), 'a') }, project: 'p1', list: 'notes' })]]) };
  const quiet = merge({ shadow, local: toModel(s.local), remote: undo });
  assert.ok(find(applied(s.local, quiet.patch), 'a'));
  assert.deepEqual(codes(quiet), []);
});

test('remote tombstone, local unchanged or changed only position, highlight or counters: removed here', () => {
  const variants = {
    unchanged: () => {},
    highlighted: (d) => { n(d, 'a').highlight = 'amber'; },
    moved: (d) => { p(d, 'p1').notes.push(unlink(d, 'a')); },
    copied: (d) => { n(d, 'a').copied = 9; },
  };
  for (const [what, mine] of Object.entries(variants)) {
    const s = pull({ mine, theirs: (d) => { unlink(d, 'a'); } });
    assert.equal(find(s.page, 'a'), null, what);
    assert.deepEqual(s.result.patch.notes.remove, ['a'], what);
    assert.deepEqual(afterAck(s).diff.upserts, [], what);
  }
});

test('remote project tombstone: kept for a live note, a draft, or a changed name (KEPT_PROJECT / _DRAFT)', () => {
  const theirs = (d) => { dropProject(d, 'p2'); };
  const added = pull({ mine: (d) => { p(d, 'p2').notes.push(note('g', 'new on the PC')); }, theirs });
  assert.deepEqual(columns(added.page), ['p1', 'p2']);
  assert.deepEqual(ids(added.page, 'p2'), ['g'], 'e was deleted with it and unchanged here');
  assert.deepEqual(added.result.notices, [{ code: 'KEPT_PROJECT', name: 'Beta', device: MAC }]);
  assert.deepEqual(reasons(afterAck(added).diff), ['g:new', 'p2:undelete']);

  const draft = pull({ mine: (d) => { p(d, 'p2').draft = 'half a prompt'; }, theirs });
  assert.ok(p(draft.page, 'p2'));
  assert.equal(p(draft.page, 'p2').draft, 'half a prompt');
  assert.deepEqual(draft.result.notices, [{ code: 'KEPT_PROJECT_DRAFT', name: 'Beta', device: MAC }]);
  const pictures = pull({ mine: (d) => { p(d, 'p2').draftImages = [{ id: 'c'.repeat(32), w: 1, h: 1 }]; }, theirs });
  assert.deepEqual(codes(pictures.result), ['KEPT_PROJECT_DRAFT']);
  const blank = pull({ mine: (d) => { p(d, 'p2').draft = '   '; }, theirs });
  assert.equal(p(blank.page, 'p2'), undefined, 'a blank draft is no reason to keep it');

  const renamed = pull({ mine: (d) => { p(d, 'p2').name = 'Beta, mine'; }, theirs });
  assert.equal(p(renamed.page, 'p2').name, 'Beta, mine');
  assert.deepEqual(codes(renamed.result), ['KEPT_PROJECT']);

  const unchanged = pull({ theirs });
  assert.deepEqual(columns(unchanged.page), ['p1']);
  assert.equal(find(unchanged.page, 'e'), null);
  assert.deepEqual(unchanged.result.patch.projects.remove, ['p2']);
  assert.equal(unchanged.result.backupFirst, true, 'a project with notes goes: back up first');
  assert.deepEqual(unchanged.result.notices, [{ code: 'REMOTE_DELETES', count: 1, device: MAC }]);
});

test('local project deleted, remote changed its name, colour or unknown fields, or has a live note in it: kept', () => {
  const mine = (d) => { dropProject(d, 'p2'); };
  const renamed = pull({ mine, theirs: (d) => { p(d, 'p2').name = 'Beta renamed'; } });
  assert.deepEqual(columns(renamed.page), ['p1', 'p2']);
  const back = p(renamed.page, 'p2');
  assert.equal(back.name, 'Beta renamed');
  assert.deepEqual([back.draft, back.usedCollapsed, back.notes.length], ['', false, 0], 'arrives with this computer\'s defaults, e stays deleted');
  const future = pull({ mine, theirs: (d) => { p(d, 'p2').futureProjectField = 'x'; } });
  assert.equal(p(future.page, 'p2').futureProjectField, 'x');

  const noteThere = pull({ mine, theirs: (d) => { p(d, 'p2').notes.push(note('h', 'added on the Mac')); } });
  assert.deepEqual(ids(noteThere.page, 'p2'), ['h']);

  const recoloured = pull({ mine, theirs: (d) => { p(d, 'p2').createdAt = 5; } });
  assert.equal(p(recoloured.page, 'p2'), undefined, 'createdAt alone is no reason');
  const nothing = pull({ mine, theirs: (d) => { n(d, 'a').text = 'elsewhere'; } });
  assert.equal(p(nothing.page, 'p2'), undefined);
  assert.deepEqual(afterAck(nothing).diff.tombstones.map((t) => t.id).sort(), ['e', 'p2']);
});

test('a live note whose project is gone brings the project back: from here, the shadow or the trash', () => {
  // The account has p2 deleted but e live in it (e.g. an older client's partial push).
  const broken = (shadow, text) => ({
    rev: 2, board: { joiner: 'blank' }, projects: new Map([['p2', doc('project', 'p2', { rev: 2, key: shadow.projects.p2.k, deleted: true })]]),
    notes: new Map([['e', doc('note', 'e', { rev: 2, key: shadow.notes.e.k, fields: { ...n(start(), 'e'), text }, project: 'p2', list: 'notes' })]]),
  });
  const shadow = synced(start());
  // From here: p2 is still on this computer.
  const here = merge({ shadow, local: toModel(start()), remote: broken(shadow, 'E edited') });
  const hp = applied(start(), here.patch);
  assert.deepEqual(ids(hp, 'p2'), ['e']);
  assert.equal(n(hp, 'e').text, 'E edited');
  assert.deepEqual(here.notices, [{ code: 'KEPT_PROJECT', name: 'Beta', device: MAC }]);
  // From the shadow: this computer deleted p2 (and e) too.
  const mine = start();
  dropProject(mine, 'p2');
  const fromShadow = merge({ shadow, local: toModel(mine), remote: broken(shadow, 'E edited') });
  const sp = applied(mine, fromShadow.patch);
  assert.deepEqual(columns(sp), ['p1', 'p2']);
  assert.equal(p(sp, 'p2').name, 'Beta');
  assert.deepEqual(ids(sp, 'p2'), ['e']);
  assert.deepEqual(codes(fromShadow).sort(), ['KEPT_NOTE', 'KEPT_PROJECT']);
});

test('…and failing all three, as "Recovered notes" (monstera) after the last column', () => {
  const shadow = synced(start());
  const orphan = {
    rev: 2, board: { joiner: 'blank' }, projects: new Map(),
    notes: new Map([['o', doc('note', 'o', { rev: 2, key: 'V', fields: note('o', 'lost and found'), project: 'px', list: 'used' })]]),
  };
  const lost = merge({ shadow, local: toModel(start()), remote: orphan });
  const page = applied(start(), lost.patch);
  assert.deepEqual(columns(page), ['p1', 'p2', 'px']);
  assert.deepEqual([p(page, 'px').name, p(page, 'px').color, p(page, 'px').createdAt], ['Recovered notes', 'monstera', NOW]);
  assert.deepEqual(ids(page, 'px', 'used'), ['o']);
  assert.deepEqual(lost.notices, [{ code: 'KEPT_PROJECT', name: 'Recovered notes', device: { platform: null, sameAsThis: false } }]);
  assert.deepEqual(neededTrash({ shadow, local: toModel(start()), remote: orphan }), [{ kind: 'project', id: 'px', docId: '' }]);
  // With its trash copy, it comes back under its own name.
  const trash = new Map([['px', { kind: 'project', data: JSON.stringify({ name: 'Old project', color: 'sun', createdAt: 7 }) }]]);
  const found = merge({ shadow, local: toModel(start()), remote: orphan, trash });
  const fp = applied(start(), found.patch);
  assert.deepEqual([p(fp, 'px').name, p(fp, 'px').color], ['Old project', 'sun']);
  assert.deepEqual(columns(fp), ['p1', 'p2', 'px']);
});

test('the joiner is one register: remote change applied, null deletes it only when the account cleared it', () => {
  const s = pull({ theirs: (d) => { d.prefs.joiner = 'line'; } });
  assert.deepEqual(s.result.patch.board, { joiner: 'line' });
  assert.equal(s.result.patch.changesContent, true);
  const both = pull({ mine: (d) => { d.prefs.joiner = 'blank'; }, theirs: (d) => { d.prefs.joiner = 'line'; }, from: board(start().projects, { joiner: 'x' }) });
  assert.equal(both.page.prefs.joiner, 'blank', 'both changed: this computer wins');
  const unset = pull({ mine: (d) => { delete d.prefs.joiner; } });
  assert.equal(unset.page.prefs.joiner, 'blank', 'never set here: the account\'s value is filled in');
});

test('echoes of our own writes change nothing', () => {
  const shadow = synced(start());
  const mine = start();
  n(mine, 'a').text = 'pushed, then the app crashed before shadow.json';
  p(mine, 'p1').notes.push(note('z', 'new'));
  unlink(mine, 'b');
  const echo = pushFrom(shadow, mine, { rev: 2, by: A }); // our own documents, pulled back
  const r = merge({ shadow, local: toModel(mine), remote: echo });
  assert.equal(r.patch, null);
  assert.equal(r.backupFirst, false);
  const next = applyShadowDelta(shadow, r.shadowAfter);
  assert.equal(diffLocal({ shadow: next, local: toModel(mine) }).pending, 0);
});

test('its own documents coming back (a lost response, 5.5 step 13) are the base: nothing doubles or reverts', () => {
  const shadow = synced(start());
  const pushed = start();
  Object.assign(n(pushed, 'a'), { copied: 5, lastCopiedAt: 500 });
  p(pushed, 'p1').used.push(Object.assign(unlink(pushed, 'c'), { usedAt: 7 }));
  unlink(pushed, 'b');
  p(pushed, 'p1').notes.push(note('z', 'Z as pushed'));
  const echo = pushFrom(shadow, pushed, { rev: 2, by: A }); // it landed, but the shadow never heard
  assert.equal(merge({ shadow, local: toModel(pushed), remote: echo }).patch, null, 'unchanged since: nothing to do');

  // Changed here after that push, before the retry pulled: this computer's changes stand.
  const later = clone(pushed);
  n(later, 'a').copied = 6;
  Object.assign(n(later, 'z'), { text: 'Z edited after the push', highlight: 'rose' });
  p(later, 'p1').notes.push(Object.assign(unlink(later, 'c'), { usedAt: 0 }));
  p(later, 'p1').notes.splice(1, 0, n(start(), 'b')); // Undo of the delete
  const r = merge({ shadow, local: toModel(later), remote: echo });
  const page = applied(later, r.patch);
  assert.deepEqual(codes(r), [], 'no conflict with itself');
  assert.equal(n(page, 'a').copied, 6, 'its own copies are not counted twice');
  assert.deepEqual([n(page, 'z').text, n(page, 'z').highlight], ['Z edited after the push', 'rose']);
  assert.deepEqual(ids(page, 'p1'), ['a', 'b', 'z', 'c']);
  assert.deepEqual(ids(page, 'p1', 'used'), ['u']);
  const up = diffLocal({ shadow: applyShadowDelta(shadow, r.shadowAfter), local: toModel(page) });
  assert.deepEqual(reasons(up), ['a:counter', 'b:undelete', 'c:change', 'z:change']);
  assert.equal(up.upserts.find((u) => u.id === 'a').copied, 6);

  // Deleted here after it was pushed: the delete goes up, it doesn't come back.
  const gone = clone(pushed);
  unlink(gone, 'z');
  const g = merge({ shadow, local: toModel(gone), remote: echo });
  assert.equal(find(applied(gone, g.patch), 'z'), null);
  assert.deepEqual(diffLocal({ shadow: applyShadowDelta(shadow, g.shadowAfter), local: toModel(gone) }).tombstones.map((t) => t.id), ['z']);
});

test('a restore or a stale .bak never lowers the account\'s copy counts', () => {
  const account = start();
  Object.assign(n(account, 'a'), { copied: 10, lastCopiedAt: 900 });
  const shadow = synced(account);
  const older = start(); // a: copied 2, lastCopiedAt 100
  for (const [mode, extra] of [['restore', {}], ['union', { stale: true }]]) {
    const r = merge({ shadow, local: toModel(older), remote: nothingNew(shadow), mode, ...extra });
    assert.deepEqual(r.patch.notes.counters.a, { copiedDelta: 8, lastCopiedAt: 900 }, mode);
    const page = applied(older, r.patch);
    assert.deepEqual([n(page, 'a').copied, n(page, 'a').lastCopiedAt], [10, 900], mode);
    const up = diffLocal({ shadow: applyShadowDelta(shadow, r.shadowAfter), local: toModel(page) });
    assert.deepEqual(up.upserts.filter((u) => u.id === 'a'), [], mode);
  }
});

test('backupFirst: at least 10 notes or any project with notes leave this computer', () => {
  const many = board([project('p1', 'Alpha', { notes: Array.from({ length: 12 }, (_, i) => note(`n${i}`, `note ${i}`)) })]);
  const ten = pull({ from: many, theirs: (d) => { p(d, 'p1').notes.splice(0, 10); } });
  assert.equal(ten.result.backupFirst, true);
  assert.deepEqual(ten.result.notices, [{ code: 'REMOTE_DELETES', count: 10, device: MAC }]);
  const nine = pull({ from: many, theirs: (d) => { p(d, 'p1').notes.splice(0, 9); } });
  assert.equal(nine.result.backupFirst, false);
  assert.deepEqual(nine.result.notices, []);
  const empty = pull({ from: board([project('p1', 'A'), project('p2', 'B')]), theirs: (d) => { dropProject(d, 'p2'); } });
  assert.equal(empty.result.backupFirst, false, 'an empty project');
});

// ================================================================ union and restore

test('union and restore: an entity missing here but alive in the account is added back', () => {
  for (const mode of ['union', 'restore']) {
    const s = pull({ mode, mine: (d) => { unlink(d, 'b'); dropProject(d, 'p2'); } });
    assert.deepEqual(columns(s.page), ['p1', 'p2'], mode);
    assert.deepEqual(ids(s.page, 'p1'), ['a', 'b', 'c'], mode);
    assert.deepEqual(ids(s.page, 'p2'), ['e'], mode);
    assert.deepEqual(codes(s.result), [], mode);
    assert.deepEqual(afterAck(s).diff.tombstones, [], mode);
  }
});

test('union: local present, remote tombstone, base present: removed if unchanged, else kept and undeleted', () => {
  const same = pull({ mode: 'union', theirs: (d) => { unlink(d, 'a'); } });
  assert.equal(find(same.page, 'a'), null);
  const edited = pull({ mode: 'union', mine: (d) => { n(d, 'a').text = 'edited'; }, theirs: (d) => { unlink(d, 'a'); } });
  assert.ok(find(edited.page, 'a'));
  assert.deepEqual(reasons(afterAck(edited).diff), ['a:undelete']);
  const touched = pull({ mode: 'union', mine: (d) => { n(d, 'a').highlight = 'amber'; }, theirs: (d) => { unlink(d, 'a'); } });
  assert.ok(find(touched.page, 'a'), 'any difference from the base keeps it in union mode');
  const restored = pull({ mode: 'restore', theirs: (d) => { unlink(d, 'a'); dropProject(d, 'p2'); } });
  assert.ok(find(restored.page, 'a'));
  assert.deepEqual(columns(restored.page), ['p1', 'p2']);
  assert.deepEqual(reasons(afterAck(restored).diff), ['a:undelete', 'e:undelete', 'p2:undelete']);
});

test('union: a tombstone met again after the shadow forgot the note is compared with its trash copy', () => {
  // The base has only a tombstone with no fields (e.g. written by a client that kept none).
  const shadow = synced(start());
  shadow.notes.a = { f: {}, k: shadow.notes.a.k, r: 2, u: 't2', d: true, i: 'a', p: 'p1', l: 'notes', c: 0, lc: 0 };
  const remote = nothingNew(shadow);
  const trash = new Map([['a', { kind: 'note', data: JSON.stringify(n(start(), 'a')) }]]);
  const stale = merge({ shadow, local: toModel(start()), remote, mode: 'union', trash });
  assert.equal(find(applied(start(), stale.patch), 'a'), null, 'the same content as the trash copy: removed');
  const mine = start();
  n(mine, 'a').text = 'changed since';
  const kept = merge({ shadow, local: toModel(mine), remote, mode: 'union', trash });
  assert.ok(find(applied(mine, kept.patch), 'a'));
  assert.ok(find(applied(start(), merge({ shadow, local: toModel(start()), remote, mode: 'union' }).patch), 'a'), 'no trash copy: kept');
});

test('local present, remote tombstone, no base: trash copy decides in union mode; restore keeps it', () => {
  const from = start();
  const shadow = synced(from); // x was never synced from here
  const local = clone(from);
  p(local, 'p1').notes.push(note('x', 'X'));
  const remote = { ...nothingNew(shadow), rev: 3, notes: new Map([['x', doc('note', 'x', { rev: 3, key: 'z', deleted: true, project: 'p1', list: 'notes' })]]) };
  const trashSame = new Map([['x', JSON.stringify(note('x', 'X', { createdAt: 5 }))]]);
  const trashOther = new Map([['x', { data: JSON.stringify(note('x', 'X, before an edit')) }]]);
  assert.deepEqual(neededTrash({ shadow, local: toModel(local), remote, mode: 'union' }), [{ kind: 'note', id: 'x', docId: 'x' }]);
  const run = (mode, trash) => find(applied(local, merge({ shadow, local: toModel(local), remote, mode, trash }).patch), 'x');
  assert.equal(run('union', trashSame), null);
  assert.ok(run('union', trashOther));
  assert.ok(run('union', undefined));
  assert.equal(run('normal', trashSame), null, 'normal mode follows the same rule without a base');
  assert.ok(run('restore', trashSame));
});

test('both present, no base, content differs: union keeps the account\'s in place, restore keeps this computer\'s', () => {
  const shadow = synced(start());
  const local = start();
  p(local, 'p1').notes.push(note('x', 'X here', { updatedAt: 1500 }));
  const remote = { ...nothingNew(shadow), rev: 3, notes: new Map([['x', doc('note', 'x', { rev: 3, key: 'zz', fields: note('x', 'X in the account', { copied: 4 }), project: 'p1', list: 'notes' })]]) };
  const union = merge({ shadow, local: toModel(local), remote, mode: 'union' });
  const up = applied(local, union.patch);
  const ucopy = conflictId('x', { text: 'X here', images: [] });
  assert.deepEqual(ids(up, 'p1'), ['a', 'b', 'c', 'x', ucopy]);
  assert.equal(n(up, 'x').text, 'X in the account');
  assert.deepEqual([n(up, ucopy).text, n(up, ucopy).syncConflict.device], ['X here', A]);
  const restore = merge({ shadow, local: toModel(local), remote, mode: 'restore' });
  const rp = applied(local, restore.patch);
  const rcopy = conflictId('x', { text: 'X in the account', images: [] });
  assert.deepEqual(ids(rp, 'p1'), ['a', 'b', 'c', 'x', rcopy]);
  assert.equal(n(rp, 'x').text, 'X here');
  assert.deepEqual([n(rp, rcopy).text, n(rp, rcopy).highlight, n(rp, rcopy).syncConflict.device, n(rp, rcopy).copied], ['X in the account', 'amber', B, 0]);
  assert.deepEqual(codes(restore), ['CONFLICT']);
  // Counters without a base: the larger one.
  assert.deepEqual([n(up, 'x').copied, n(rp, 'x').copied], [4, 4]);
});

test('both present, no base, position differs: union takes the account\'s, restore keeps this computer\'s', () => {
  const shadow = synced(start());
  const local = start();
  p(local, 'p1').notes.push(note('x', 'X', { copied: 9 }));
  const remote = { ...nothingNew(shadow), rev: 3, notes: new Map([['x', doc('note', 'x', { rev: 3, key: 'V', fields: note('x', 'X', { copied: 7, usedAt: 44 }), project: 'p2', list: 'used' })]]) };
  const union = applied(local, merge({ shadow, local: toModel(local), remote, mode: 'union' }).patch);
  assert.deepEqual([find(union, 'x').project, find(union, 'x').list, n(union, 'x').usedAt], ['p2', 'used', 44]);
  const restore = applied(local, merge({ shadow, local: toModel(local), remote, mode: 'restore' }).patch);
  assert.deepEqual([find(restore, 'x').project, find(restore, 'x').list, n(restore, 'x').usedAt], ['p1', 'notes', 0]);
  assert.deepEqual([n(union, 'x').copied, n(restore, 'x').copied], [9, 9], 'max(local, remote)');
});

test('a stale file (.bak) never pushes its older text over the account\'s: kept as a copy instead', () => {
  // The .bak is from before a session whose edits were already pushed.
  const bak = start();
  const pushed = clone(bak);
  n(pushed, 'a').text = 'A as edited last session';
  p(pushed, 'p1').notes.reverse();
  n(pushed, 'b').highlight = 'sky';
  const shadow = synced(pushed);
  const remote = nothingNew(shadow);
  const r = merge({ shadow, local: toModel(bak), remote, mode: 'union', stale: true });
  const page = applied(bak, r.patch);
  const copy = conflictId('a', { text: 'A', images: [] });
  assert.deepEqual(ids(page, 'p1'), ['c', 'b', 'a', copy], 'the account\'s order');
  assert.equal(n(page, 'a').text, 'A as edited last session');
  assert.equal(n(page, copy).text, 'A');
  assert.equal(n(page, 'b').highlight, 'sky');
  assert.deepEqual(codes(r), ['CONFLICT']);
  const after = diffLocal({ shadow: applyShadowDelta(shadow, r.shadowAfter), local: toModel(page), mode: 'union' });
  assert.deepEqual(reasons(after), [`${copy}:new`], 'nothing older is pushed');
  // Without the flag, union keeps the three-way rules: the older text would win.
  const plain = applied(bak, merge({ shadow, local: toModel(bak), remote, mode: 'union' }).patch);
  assert.equal(n(plain, 'a').text, 'A');
});

test('seeded (both files unreadable): the fresh Welcome goes and the account\'s board comes back', () => {
  const account = start();
  const shadow = synced(account);
  const tips = Array.from({ length: 10 }, (_, i) => note(`t${i}`, `tip ${i}`, { createdAt: 5000, updatedAt: 5000 }));
  const seed = board([project('w', 'Welcome', { notes: tips }, { color: 'monstera', createdAt: 5000 })]);
  const r = merge({ shadow, local: toModel(seed), remote: nothingNew(shadow), mode: 'union', seeded: true });
  const page = applied(seed, r.patch);
  assert.deepEqual(columns(page), ['p1', 'p2']);
  assert.deepEqual(ids(page, 'p1'), ['a', 'b', 'c']);
  assert.deepEqual(r.patch.projects.remove, ['w']);
  assert.deepEqual(codes(r), ['RESTORED_FROM_ACCOUNT']);
  assert.equal(r.backupFirst, false, 'the seed going is not an incoming delete');
  // An empty account: the seed stays.
  const empty = { version: 1, rev: 1, board: { joiner: null }, projects: {}, notes: {} };
  const kept = merge({ shadow: empty, local: toModel(seed), remote: nothingNew(empty), mode: 'union', seeded: true });
  assert.equal(kept.patch, null);
});

// ================================================================ first sign-in

function welcome(t = 5000) {
  const tips = Array.from({ length: 10 }, (_, i) => note(`t${i}`, `tip ${i}`, { createdAt: t, updatedAt: t }));
  return project('w', 'Welcome', { notes: tips }, { color: 'monstera', createdAt: t });
}

test('Combine: union with no base; this computer\'s projects after the account\'s; the pristine Welcome is dropped', () => {
  const account = start();
  const remote = pushFrom(null, account, { rev: 5 });
  const local = board([
    welcome(),
    project('m1', 'Mine', { notes: [note('m', 'M'), note('m2', 'M2')] }),
    project('p1', 'Alpha (same id)', { notes: [note('x', 'only here'), note('a', 'A, but different here')] }, { notesCollapsed: true }),
  ], { joiner: 'line' });
  const r = merge({ local: toModel(local), remote, mode: 'combine' });
  const page = applied(local, r.patch);
  assert.deepEqual(columns(page), ['p1', 'p2', 'm1']);
  assert.equal(p(page, 'p1').name, 'Alpha', 'no base: the account\'s name');
  assert.equal(p(page, 'p1').notesCollapsed, true, 'per-device state stays');
  const copy = conflictId('a', { text: 'A, but different here', images: [] });
  assert.deepEqual(ids(page, 'p1'), ['a', copy, 'b', 'c', 'x'], 'shared notes where the account has them, then this computer\'s');
  assert.equal(n(page, 'a').text, 'A');
  assert.deepEqual(ids(page, 'm1'), ['m', 'm2']);
  assert.equal(p(page, 'w'), undefined);
  assert.equal(page.prefs.joiner, 'blank', 'no base: the account\'s joiner');
  const unset = clone(account);
  delete unset.prefs.joiner;
  const kept = merge({ local: toModel(local), remote: pushFrom(null, unset, { rev: 5 }), mode: 'combine' });
  assert.equal(kept.patch.board, undefined, 'the account never set it: this computer\'s choice stays');
  assert.deepEqual(r.notices.find((x) => x.code === 'COMBINED'), { code: 'COMBINED', a: 2, b: 1 });
  assert.deepEqual(codes(r), ['COMBINED', 'CONFLICT']);
  assert.equal(r.patch.resetHistory, true);
  assert.equal(r.backupFirst, false);
  // After the ack everything of this computer's uploads, and the Welcome never does.
  const shadow = applyShadowDelta(null, r.shadowAfter);
  const up = diffLocal({ shadow, local: toModel(page) });
  assert.deepEqual(reasons(up), [`${copy}:new`, 'm1:new', 'm2:new', 'm:new', 'x:new']);
  assert.deepEqual(up.tombstones, []);
  const keys = up.upserts.filter((u) => u.kind === 'note' && u.project === 'p1').map((u) => u.key);
  assert.ok(keys.every((k) => k > shadow.notes.a.k));
});

test('Use my account\'s board: local-only things go, the account\'s board and order apply, per-device fields stay', () => {
  const account = start();
  const remote = pushFrom(null, account, { rev: 5 });
  const local = board([
    project('m1', 'Mine', { notes: [note('m', 'M')] }),
    project('p1', 'Alpha here', { notes: [note('c', 'C here', { expanded: true, copied: 1 }), note('x', 'only here')] }, { draft: 'draft here', usedCollapsed: true }),
  ]);
  const r = merge({ local: toModel(local), remote, mode: 'use-account' });
  const page = applied(local, r.patch);
  assert.deepEqual(columns(page), ['p1', 'p2']);
  assert.deepEqual(ids(page, 'p1'), ['a', 'b', 'c']);
  assert.deepEqual(ids(page, 'p1', 'used'), ['u']);
  assert.equal(p(page, 'p1').name, 'Alpha');
  assert.deepEqual([p(page, 'p1').draft, p(page, 'p1').usedCollapsed], ['draft here', true]);
  assert.deepEqual([n(page, 'c').text, n(page, 'c').expanded, n(page, 'c').copied], ['C', true, 1]);
  assert.equal(find(page, 'x'), null);
  assert.equal(p(page, 'm1'), undefined);
  assert.equal(page.prefs.joiner, 'blank');
  assert.deepEqual(codes(r), ['USED_ACCOUNT']);
  assert.equal(r.patch.resetHistory, true);
  assert.equal(r.backupFirst, false);
  const shadow = applyShadowDelta(null, r.shadowAfter);
  assert.deepEqual(diffLocal({ shadow, local: toModel(page) }).upserts.map((u) => `${u.id}:${u.reason}`), ['c:counter']);
});

test('Use my account\'s board with a pristine Welcome on both sides: no toast', () => {
  const remote = pushFrom(null, board([welcome(1000)]), { rev: 1 });
  const local = board([{ ...welcome(7000), id: 'w2' }]);
  for (const nt of local.projects[0].notes) nt.id = `${nt.id}-here`;
  const r = merge({ local: toModel(local), remote, mode: 'use-account' });
  const page = applied(local, r.patch);
  assert.deepEqual(columns(page), ['w']);
  assert.deepEqual(r.notices, []);
  assert.notEqual(r.patch, null);
});

// ================================================================ full listings, shadow, trash

test('full resync below minRev: missing shadow entries at or below minRev are tombstones, the rest are forgotten', () => {
  const shadow = synced(start());
  shadow.notes.b.r = 1;
  shadow.notes.c.r = 7;
  const remote = pushFrom(null, start(), { rev: 9 });
  remote.notes.delete('b');
  remote.notes.delete('c');
  remote.minRev = 5;
  const r = merge({ shadow, local: toModel(start()), remote, mode: 'union', full: true });
  const page = applied(start(), r.patch);
  assert.equal(find(page, 'b'), null, 'b is at or below minRev: deleted');
  assert.ok(find(page, 'c'), 'c is above minRev: kept, and uploads again');
  assert.equal(r.shadowAfter.notes.b, null);
  assert.equal(r.shadowAfter.notes.c, null);
  const next = applyShadowDelta(shadow, r.shadowAfter);
  assert.deepEqual(reasons(diffLocal({ shadow: next, local: toModel(page) })), ['c:new']);
});

test('shadowAfter is the account\'s state, not the merged one; tombstones keep their last fields', () => {
  const s = pull({
    mine: (d) => { n(d, 'b').highlight = 'rose'; },
    theirs: (d) => { n(d, 'b').highlight = 'sky'; unlink(d, 'c'); },
  });
  const after = s.result.shadowAfter;
  assert.equal(after.rev, 2);
  assert.deepEqual(after.board, { joiner: 'blank' });
  assert.equal(after.notes.b.f.highlight, 'sky');
  assert.deepEqual([after.notes.c.d, after.notes.c.f.text, after.notes.c.p, after.notes.c.l], [true, 'C', 'p1', 'notes']);
  assert.equal(Object.hasOwn(after.notes, 'a'), false, 'only the documents the pull brought');
  const shadow = applyShadowDelta(s.shadow, after);
  assert.equal(shadow.rev, 2);
  assert.deepEqual(shadow.notes.a, s.shadow.notes.a);
  assert.deepEqual(shadow.notes.b.f.highlight, 'sky');
  assert.deepEqual(Object.keys(shadow.notes).sort(), ['a', 'b', 'c', 'e', 'u']);
  const dropped = applyShadowDelta(shadow, { projects: {}, notes: { c: null } });
  assert.deepEqual(Object.keys(dropped.notes).sort(), ['a', 'b', 'e', 'u']);
  assert.deepEqual(applyShadowDelta(shadowView(s.shadow), after).notes, shadow.notes, 'the shadow read into maps works too');
  assert.deepEqual(shadowDelta({ rev: 4, projects: new Map(), notes: new Map() }), { rev: 4, projects: {}, notes: {} });
});

test('deterministic: the same inputs give the same result', () => {
  const run = () => pull({
    mine: (d) => { n(d, 'a').text = 'x'; unlink(d, 'b'); p(d, 'p2').notes.push(note('g', 'G')); d.prefs.joiner = 'line'; },
    theirs: (d) => { n(d, 'a').text = 'y'; n(d, 'b').text = 'B2'; dropProject(d, 'p2'); },
  });
  const one = run();
  const two = run();
  assert.deepEqual(one.result, two.result);
  assert.deepEqual(one.page, two.page);
});

test('merging again after the page applied a patch and the shadow advanced changes nothing', () => {
  const scenarios = [
    { mine: (d) => { n(d, 'a').text = 'x'; }, theirs: (d) => { n(d, 'a').text = 'y'; } },
    { mine: (d) => { unlink(d, 'b'); }, theirs: (d) => { n(d, 'b').text = 'B2'; } },
    { mine: (d) => { p(d, 'p2').notes.push(note('g', 'G')); }, theirs: (d) => { dropProject(d, 'p2'); } },
    { mine: (d) => { n(d, 'a').copied = 8; }, theirs: (d) => { n(d, 'a').copied = 5; dropProject(d, 'p2'); } },
    { mode: 'union', mine: (d) => { unlink(d, 'c'); }, theirs: (d) => { unlink(d, 'a'); } },
    { mode: 'restore', mine: (d) => { dropProject(d, 'p2'); }, theirs: (d) => { n(d, 'e').text = 'E2'; } },
  ];
  for (const [i, sc] of scenarios.entries()) {
    const s = pull(sc);
    const shadow = applyShadowDelta(s.shadow, s.result.shadowAfter);
    const again = merge({ shadow, local: toModel(s.page), remote: s.remote, mode: sc.mode || 'normal' });
    assert.equal(again.patch, null, `scenario ${i}`);
  }
});

test('neededTrash lists what a merge without a base would consult', () => {
  const shadow = synced(start());
  const local = start();
  p(local, 'p1').notes.push(note('x', 'X'));
  const remote = {
    ...nothingNew(shadow), rev: 3,
    notes: new Map([
      ['x', doc('note', 'x', { rev: 3, key: 'z', deleted: true, project: 'p1', list: 'notes' })],
      ['a', doc('note', 'a', { rev: 3, key: 'V', deleted: true, project: 'p1', list: 'notes' })],
    ]),
  };
  assert.deepEqual(neededTrash({ shadow, local: toModel(local), remote }), [{ kind: 'note', id: 'x', docId: 'x' }]);
  assert.deepEqual(neededTrash({ shadow, local: toModel(local), remote, mode: 'restore' }), []);
});

// ================================================================ two computers, random steps
// Both boards edit freely and sync through a simulated account with the real diff, merge and
// apply. After quiescence the boards must match; without deletes no note may ever be lost and
// copy counts must be exact. With `restores`, a computer now and then goes back to an older
// board of its own and syncs once in restore or union mode, as after a restore or a stale file.
// With `lost`, that share of pushes lands in the account but the computer never hears back
// (5.5 step 13), so its shadow stays behind and its next pull brings its own documents.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(seed, { steps = 70, deletes = true, restores = false, lost = 0 } = {}) {
  const rand = rng(seed);
  let losing = false;
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
  let clock = 1760000000000;
  let serial = 0;
  const copiesMade = new Map();
  const created = new Set();
  const first = board([
    project('p1', 'Alpha', { notes: [note('a', 'A'), note('b', 'B')], used: [note('u', 'U', { usedAt: 3 })] }),
    project('p2', 'Beta', { notes: [note('e', 'E')] }),
  ], { joiner: 'blank' });
  ['a', 'b', 'u', 'e'].forEach((id) => created.add(id));
  const account = { rev: 0, board: { joiner: null }, projects: new Map(), notes: new Map() };
  const computers = [A, B].map((id) => ({ id, data: clone(first), shadow: null, mode: 'normal', history: [clone(first)] }));

  function push(X) {
    const diff = diffLocal({ shadow: X.shadow, local: toModel(X.data), mode: X.mode });
    const mode = X.mode;
    X.mode = 'normal';
    if (!diff.pending) return false;
    const rev = account.rev + 1;
    for (const u of diff.upserts) {
      const fields = u.kind === 'note' ? { ...u.fields, copied: u.copied, lastCopiedAt: u.lastCopiedAt } : u.fields;
      account[`${u.kind}s`].set(u.id, doc(u.kind, u.id, { rev, key: u.key, by: X.id, fields, project: u.project, list: u.list }));
    }
    for (const t of diff.tombstones) account[`${t.kind}s`].set(t.id, doc(t.kind, t.id, { rev, key: t.key, by: X.id, deleted: true, project: t.project, list: t.list }));
    if (diff.board) account.board = { joiner: diff.board.joiner };
    account.rev = rev;
    if (losing && rand() < lost) {
      X.mode = mode; // to X the push failed: it pulls (its own documents too) and tries again
      X.lost = true;
      return true;
    }
    X.shadow = commit(X.shadow, diff, rev);
    return true;
  }

  function pullInto(X) {
    const since = X.shadow ? X.shadow.rev : 0;
    const remote = { rev: account.rev, board: { ...account.board }, projects: new Map(), notes: new Map() };
    for (const kind of ['projects', 'notes']) for (const [id, d] of account[kind]) if (d.rev > since) remote[kind].set(id, d);
    const r = mergeRemote({ shadow: X.shadow, local: toModel(X.data), remote, mode: X.mode, stale: X.mode === 'union', deviceId: X.id, devices: DEVICES, now: ++clock });
    if (r.patch) applyPatch(X.data, r.patch);
    X.shadow = applyShadowDelta(X.shadow, r.shadowAfter);
    X.lost = false;
    return Boolean(r.patch && (r.patch.changesContent || Object.keys(r.patch.notes.counters).length));
  }

  const sync = (X) => {
    const pulled = pullInto(X);
    const pushed = push(X);
    X.history.push(clone(X.data));
    return pulled || pushed;
  };
  push(computers[0]);
  computers[1].shadow = clone(computers[0].shadow);

  const allNotes = (d) => d.projects.flatMap((p) => LISTS.flatMap((l) => p[l].map((x) => ({ p, l, n: x }))));
  const ops = {
    add(d) {
      if (!d.projects.length) return ops.project(d);
      const id = `n${++serial}`;
      created.add(id);
      pickOne(d.projects).notes.push(note(id, `text ${serial}`, { createdAt: ++clock, updatedAt: clock }));
    },
    edit(d) {
      const x = pickOne(allNotes(d));
      if (!x) return;
      x.n.text = `${x.n.text.split(' +')[0]} +${++serial}`;
      x.n.updatedAt = ++clock;
      delete x.n.syncConflict;
    },
    cook(d) {
      const x = pickOne(allNotes(d).filter((y) => y.l === 'notes'));
      if (!x) return;
      x.p.notes.splice(x.p.notes.indexOf(x.n), 1);
      x.n.usedAt = ++clock;
      x.p.used.push(x.n);
    },
    serve(d) {
      const p = pickOne(d.projects.filter((y) => y.used.length));
      if (!p) return;
      for (const x of p.used) x.usedAt = clock;
      p.combined.push(...p.used);
      p.used = [];
    },
    drag(d) {
      const lists = d.projects.flatMap((p) => LISTS.map((l) => p[l])).filter((l) => l.length > 1);
      const l = pickOne(lists);
      if (!l) return;
      const [x] = l.splice(Math.floor(rand() * l.length), 1);
      l.splice(Math.floor(rand() * (l.length + 1)), 0, x);
    },
    move(d) {
      const x = pickOne(allNotes(d));
      const to = pickOne(d.projects);
      if (!x || !to || to === x.p) return;
      x.p[x.l].splice(x.p[x.l].indexOf(x.n), 1);
      to.notes.push(x.n);
    },
    highlight(d) {
      const x = pickOne(allNotes(d));
      if (!x) return;
      if (x.n.highlight) delete x.n.highlight;
      else x.n.highlight = pickOne(['amber', 'rose', 'sky']);
    },
    copy(d) {
      const x = pickOne(allNotes(d));
      if (!x) return;
      x.n.copied = (x.n.copied || 0) + 1;
      x.n.lastCopiedAt = ++clock;
      copiesMade.set(x.n.id, (copiesMade.get(x.n.id) || 0) + 1);
    },
    project(d) {
      d.projects.push(project(`q${++serial}`, `Project ${serial}`, {}, { createdAt: ++clock }));
    },
    rename(d) {
      const p = pickOne(d.projects);
      if (p) p.name = `${p.name.split(' #')[0]} #${++serial}`;
    },
    columns(d) {
      if (d.projects.length < 2) return;
      const [p] = d.projects.splice(Math.floor(rand() * d.projects.length), 1);
      d.projects.splice(Math.floor(rand() * (d.projects.length + 1)), 0, p);
    },
    joiner(d) { d.prefs.joiner = pickOne(['blank', 'line']); },
    view(d) {
      const p = pickOne(d.projects);
      if (p) p.notesCollapsed = !p.notesCollapsed;
      const x = pickOne(allNotes(d));
      if (x) x.n.expanded = !x.n.expanded;
    },
    remove(d) {
      const x = pickOne(allNotes(d));
      if (x) x.p[x.l].splice(x.p[x.l].indexOf(x.n), 1);
    },
    drop(d) {
      if (d.projects.length > 1) d.projects.splice(Math.floor(rand() * d.projects.length), 1);
    },
  };
  const names = Object.keys(ops).filter((k) => deletes || (k !== 'remove' && k !== 'drop'));
  losing = true;
  for (let i = 0; i < steps; i++) {
    const X = pickOne(computers);
    // A computer that lost a push response retries at once, so it pulls its own documents
    // back before the other computer syncs again (it may still edit meanwhile).
    if (rand() < 0.3) sync(computers.find((c) => c.lost && c !== X) || X);
    else if (restores && rand() < 0.06) {
      X.data = clone(pickOne(X.history));
      X.mode = pickOne(['restore', 'union']);
    } else ops[pickOne(names)](X.data);
  }
  losing = false;
  for (const X of computers) if (X.lost) sync(X);
  for (let round = 0; round < 12; round++) {
    const changed = computers.map(sync).some(Boolean);
    if (!changed && round > 1) break;
  }
  return { computers, account, copiesMade, created };
}

function synced_view(data) {
  const m = toModel(data);
  const out = { joiner: m.board.joiner, columns: m.columns, projects: {}, lists: {}, notes: {} };
  for (const [id, x] of m.projects) out.projects[id] = x.fields;
  for (const [k, v] of m.lists) out.lists[k] = v;
  for (const [id, x] of m.notes) out.notes[id] = { f: x.fields, c: x.copied, lc: x.lastCopiedAt };
  return out;
}

test('two computers converge after random edits, deletes included (40 seeds)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { computers: [X, Y], account } = simulate(seed);
    assert.deepEqual(synced_view(X.data), synced_view(Y.data), `seed ${seed}`);
    for (const C of [X, Y]) {
      const all = C.data.projects.flatMap((p) => [p.id, ...LISTS.flatMap((l) => p[l].map((x) => x.id))]);
      assert.equal(new Set(all).size, all.length, `seed ${seed}: duplicate ids`);
      assert.equal(C.shadow.rev, account.rev, `seed ${seed}`);
      for (const [id, d] of account.notes) {
        const e = C.shadow.notes[id];
        assert.equal(e.d, d.deleted, `seed ${seed}: ${id}`);
        if (!d.deleted) assert.deepEqual([e.k, e.p, e.l, e.c], [d.key, d.project, d.list, d.copied], `seed ${seed}: ${id}`);
      }
    }
  }
});

test('without deletes, no note is ever lost and copy counts add up exactly (40 seeds)', () => {
  for (let seed = 101; seed <= 140; seed++) {
    const { computers: [X, Y], copiesMade, created } = simulate(seed, { deletes: false });
    assert.deepEqual(synced_view(X.data), synced_view(Y.data), `seed ${seed}`);
    const view = synced_view(X.data);
    for (const id of created) assert.ok(view.notes[id], `seed ${seed}: note ${id} was lost`);
    for (const [id, n] of copiesMade) assert.equal(view.notes[id].c, n, `seed ${seed}: copies of ${id}`);
  }
});

test('restores and stale files (restore and union modes) still converge, and never lose a note (40 seeds)', () => {
  for (let seed = 201; seed <= 240; seed++) {
    for (const deletes of [true, false]) {
      const { computers: [X, Y], created } = simulate(seed, { steps: 90, deletes, restores: true });
      assert.deepEqual(synced_view(X.data), synced_view(Y.data), `seed ${seed}`);
      if (deletes) continue;
      // A restore brings back an older board, so notes made after it and never synced are
      // gone with it; everything the account ever had survives.
      const view = synced_view(X.data);
      for (const id of created) if (Y.shadow.notes[id] || X.shadow.notes[id]) assert.ok(view.notes[id], `seed ${seed}: note ${id} was lost`);
    }
  }
});

test('lost push responses: its own documents come back without doubled counts or undone edits (40 seeds)', () => {
  for (let seed = 301; seed <= 340; seed++) {
    for (const deletes of [false, true]) {
      const { computers: [X, Y], account, copiesMade, created } = simulate(seed, { steps: 90, deletes, lost: 0.35 });
      assert.deepEqual(synced_view(X.data), synced_view(Y.data), `seed ${seed}`);
      for (const C of [X, Y]) {
        assert.equal(C.shadow.rev, account.rev, `seed ${seed}`);
        for (const [id, d] of account.notes) assert.equal(C.shadow.notes[id].d, d.deleted, `seed ${seed}: ${id}`);
      }
      if (deletes) continue;
      const view = synced_view(X.data);
      for (const id of created) assert.ok(view.notes[id], `seed ${seed}: note ${id} was lost`);
      for (const [id, n] of copiesMade) assert.equal(view.notes[id].c, n, `seed ${seed}: copies of ${id}`);
    }
  }
});
