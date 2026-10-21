'use strict';
// The sync model (src/sync/model.js). Plain Node: node --test tests/unit/model.test.js
// The Welcome seed and normalize() come from the real app.js, run in a vm context, so these
// checks follow the page's code on both platforms.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../../src/sync/model');
const { diffLocal, pushedEntry } = require('../../src/sync/diff');

// CRLF → LF: a Windows checkout (core.autocrlf) has CRLF, and statement() looks for ';\n'.
const APP = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8').replace(/\r\n/g, '\n');
const HAS_CODEC = fs.existsSync(path.join(__dirname, '../../src/cloud/codec.js'));

function block(start) {
  const at = APP.indexOf(start);
  assert.ok(at >= 0, `app.js has ${start}`);
  let depth = 0;
  for (let i = APP.indexOf('{', at); i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${start}`);
}

function statement(start) {
  const at = APP.indexOf(start);
  assert.ok(at >= 0, `app.js has ${start}`);
  return APP.slice(at, APP.indexOf(';\n', at) + 1);
}

// The page's own seedData() and normalize(), for one platform, with a controllable clock.
function page(platform, times = [1759300000000]) {
  let call = 0;
  let id = 0;
  const ctx = {
    IS_MAC: platform === 'darwin',
    DATA_VERSION: 2,
    PALETTE: [{ id: 'monstera' }],
    IMAGE_ID: /^[a-f0-9]{32}$/,
    Date: { now: () => times[Math.min(call++, times.length - 1)] },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
  };
  vm.createContext(ctx);
  vm.runInContext([
    block('function kb(label) {'), block('function uid() {'), block('function makeNote(text, images = []) {'),
    statement('const cleanImages = '), block('function normalize(raw) {'), block('function seedData() {'),
    'this.seedData = seedData; this.normalize = normalize;',
  ].join('\n'), ctx);
  return ctx;
}

const HEX = (c) => c.repeat(32);

function sampleFile() {
  return {
    version: 2,
    prefs: { density: 'roomy', joiner: 'line', colWidths: { p1: 330 }, futurePref: 1 },
    futureTopLevel: { keep: true },
    projects: [
      {
        id: 'p1', name: 'Wildfire RL', color: 'moss', createdAt: 1000, notesCollapsed: true, usedCollapsed: true,
        augCollapsed: false, usedExpanded: true, augExpanded: false, draft: 'half a thought', draftImages: [{ id: HEX('d'), w: 1, h: 1 }],
        futureProjectField: 'x', localWidth: 3,
        notes: [
          { id: 'n1', text: 'one', images: [{ id: HEX('a'), w: 3024, h: 1964, futureImageField: 1 }], createdAt: 1, updatedAt: 2, copied: 4, lastCopiedAt: 9, usedAt: 0, expanded: true, highlight: 'amber', futureNoteField: { nested: true }, localFlag: 1 },
          { id: 'n2', text: 'two', images: [], createdAt: 3, updatedAt: 3, copied: 0, lastCopiedAt: 0, usedAt: 0 },
        ],
        used: [{ id: 'n3', text: 'cooked', images: [], createdAt: 4, updatedAt: 4, copied: 1, lastCopiedAt: 5, usedAt: 6 }],
        combined: [{ id: 'n4', text: 'served', images: [], createdAt: 5, updatedAt: 5, copied: 0, lastCopiedAt: 0, usedAt: 7 }],
      },
      { id: 'p2', name: 'Empty', color: 'sun', createdAt: 2000, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], notes: [], used: [], combined: [] },
    ],
  };
}

test('toModel: synced fields only, positions, counters and the joiner', () => {
  const m = model.toModel(sampleFile());
  assert.deepEqual(m.columns, ['p1', 'p2']);
  assert.deepEqual(m.board, { joiner: 'line' });
  assert.deepEqual(m.projects.get('p1').fields, { name: 'Wildfire RL', color: 'moss', createdAt: 1000, futureProjectField: 'x' });
  assert.equal(m.projects.get('p1').hasDraft, true);
  assert.equal(m.projects.get('p2').hasDraft, false);
  const n1 = m.notes.get('n1');
  assert.deepEqual(n1.fields, {
    text: 'one', images: [{ id: HEX('a'), w: 3024, h: 1964, futureImageField: 1 }], createdAt: 1, updatedAt: 2, usedAt: 0,
    highlight: 'amber', futureNoteField: { nested: true },
  });
  assert.equal(n1.copied, 4);
  assert.equal(n1.lastCopiedAt, 9);
  assert.deepEqual([n1.project, n1.list], ['p1', 'notes']);
  assert.deepEqual(m.lists.get(model.listKey('p1', 'notes')), ['n1', 'n2']);
  assert.deepEqual(m.lists.get(model.listKey('p1', 'used')), ['n3']);
  assert.deepEqual(m.lists.get(model.listKey('p1', 'combined')), ['n4']);
  assert.deepEqual(m.lists.get(model.listKey('p2', 'notes')), []);
  assert.equal(m.skipped.size, 0);
});

test('toModel: per-device keys never enter a model', () => {
  const m = model.toModel(sampleFile());
  const local = ['id', 'notes', 'used', 'combined', 'notesCollapsed', 'usedCollapsed', 'augCollapsed', 'usedExpanded', 'augExpanded', 'draft', 'draftImages', 'expanded', 'copied', 'lastCopiedAt'];
  for (const e of [...m.projects.values(), ...m.notes.values()]) {
    for (const k of Object.keys(e.fields)) {
      assert.ok(!local.includes(k), `${k} is per device`);
      assert.ok(!k.startsWith('local'), `${k} is per device`);
    }
  }
});

test('toModel: skips malformed entities the way normalize() does, and never invents ids', () => {
  const file = {
    prefs: { joiner: 42 },
    projects: [
      null, 7, 'x',
      { name: 'no id', notes: [{ id: 'orphan', text: 'in a project without an id' }] },
      { id: '', name: 'empty id', notes: [] },
      {
        id: 'p1', name: '  ', color: '', createdAt: 'yesterday',
        notes: [
          { id: 'a', text: 'fine', images: [{ id: 'nope' }, { id: HEX('b'), w: '10', h: null }], usedAt: 'x', createdAt: 5, updatedAt: 'y' },
          { id: 'b', text: 42 }, // not a string: dropped by normalize(), skipped here
          { text: 'no id' },
          { id: 'a', text: 'duplicate of a' },
          'not a note',
        ],
        used: [{ id: 'b', text: 'b again, now valid' }],
      },
      { id: 'p1', name: 'duplicate project', notes: [{ id: 'c', text: 'note in the duplicate' }] },
    ],
  };
  const m = model.toModel(file);
  assert.equal(m.board.joiner, null);
  assert.deepEqual(m.columns, ['p1']);
  assert.deepEqual(m.projects.get('p1').fields, { name: 'Untitled', color: 'monstera' });
  assert.deepEqual(m.lists.get(model.listKey('p1', 'notes')), ['a']);
  assert.deepEqual(m.lists.get(model.listKey('p1', 'used')), ['b']);
  assert.deepEqual(m.notes.get('a').fields, { text: 'fine', images: [{ id: HEX('b'), w: 10, h: 0 }], usedAt: 0, createdAt: 5 });
  assert.equal(m.notes.get('b').fields.text, 'b again, now valid');
  assert.ok(!m.notes.has('orphan') && !m.notes.has('c'));
  for (const id of ['orphan', 'b', 'a', 'p1', 'c']) assert.ok(m.skipped.has(id), `${id} skipped`);

  // The same file through the page's normalize(): every entity the model kept is there with
  // the same id and place; everything else got a new id or was dropped.
  const normalized = page('win32').normalize(JSON.parse(JSON.stringify(file)));
  const kept = new Map();
  for (const p of normalized.projects) for (const list of model.LISTS) for (const n of p[list]) kept.set(n.id, `${p.id}/${list}`);
  for (const [id, n] of m.notes) assert.equal(kept.get(id), `${n.project}/${n.list}`);
  assert.equal(normalized.projects.filter((p) => p.id === 'p1').length, 1);

  // Firestore can't store a lone surrogate: such ids stay on this computer, never tombstoned.
  const odd = model.toModel({ projects: [
    { id: 'ok', name: 'OK', notes: [{ id: 'n\uD800', text: 'odd id' }, { id: 'fine', text: 'fine' }] },
    { id: 'p\uDC00', name: 'Odd', notes: [{ id: 'inside', text: 'in an odd project' }] },
  ] });
  assert.deepEqual(odd.columns, ['ok']);
  assert.deepEqual(odd.lists.get(model.listKey('ok', 'notes')), ['fine']);
  for (const id of ['n\uD800', 'p\uDC00', 'inside']) assert.ok(odd.skipped.has(id), JSON.stringify(id));
});

test('toModel: a normalized board from the page is taken whole', () => {
  const ctx = page('darwin');
  const data = ctx.normalize(sampleFile());
  const m = model.toModel(JSON.parse(JSON.stringify(data)));
  assert.equal(m.skipped.size, 0);
  assert.equal(m.notes.size, 4);
  assert.deepEqual(m.projects.get('p1').fields, model.toModel(sampleFile()).projects.get('p1').fields);
  const empty = model.toModel(null);
  assert.equal(empty.projects.size + empty.notes.size + empty.columns.length, 0);
  assert.equal(model.toModel({ projects: 'nope' }).projects.size, 0);
});

test('fieldsSig: stable whatever the key order, sensitive to values', () => {
  const a = { text: 'x', images: [{ id: '1', w: 2, h: 3 }], nested: { b: 1, a: [1, { z: 1, y: 2 }] } };
  const b = { nested: { a: [1, { y: 2, z: 1 }], b: 1 }, images: [{ h: 3, w: 2, id: '1' }], text: 'x' };
  assert.equal(model.fieldsSig(a), model.fieldsSig(b));
  assert.notEqual(model.fieldsSig(a), model.fieldsSig({ ...b, text: 'y' }));
  assert.notEqual(model.fieldsSig({ a: [1, 2] }), model.fieldsSig({ a: [2, 1] }));
  assert.notEqual(model.fieldsSig({ a: null }), model.fieldsSig({}));
  assert.equal(model.fieldsSig({ a: undefined }), model.fieldsSig({}));
  const odd = JSON.parse('{"__proto__": 1, "x": 2}');
  assert.notEqual(model.fieldsSig(odd), model.fieldsSig({ x: 2 }));
});

test('remoteEntity: decoded documents are coerced like normalize(), never dropped', () => {
  const note = model.remoteEntity('note', {
    docId: 'x-abc',
    fields: { text: 12, images: [{ id: 'bad' }, { id: HEX('c'), w: 5, h: 6 }], usedAt: null, copied: 3, lastCopiedAt: 8, expanded: true, localX: 1, futureNoteField: 'y' },
    sync: { rev: 9, key: 'V', deleted: false, by: 'dev', project: 'p1', list: 'used', id: 'weird/id' },
    updateTime: 't9',
  });
  assert.deepEqual(note, {
    id: 'weird/id', docId: 'x-abc', fields: { text: '12', images: [{ id: HEX('c'), w: 5, h: 6 }], usedAt: 0, futureNoteField: 'y' },
    key: 'V', rev: 9, deleted: false, updateTime: 't9', by: 'dev', project: 'p1', list: 'used', copied: 3, lastCopiedAt: 8,
  });
  const project = model.remoteEntity('project', { docId: 'p1', fields: { name: 5, color: null, notes: [] }, sync: { rev: 2, key: 'k', deleted: false, by: 'dev' } });
  assert.deepEqual(project.fields, { name: 'Untitled', color: 'monstera' });
  const tomb = model.remoteEntity('note', { docId: 'n9', fields: {}, sync: { rev: 4, key: 'F', deleted: true, by: 'dev', project: 'p1', list: 'bogus' } });
  assert.deepEqual([tomb.deleted, tomb.fields, tomb.list, tomb.copied], [true, {}, 'notes', 0]);
});

test('a note that goes up and comes back compares equal (no conflict with our own echo)', () => {
  const local = model.toModel(sampleFile());
  const diff = diffLocal({ shadow: null, local });
  for (const item of diff.upserts) {
    const doc = { ...item.fields };
    if (item.kind === 'note') Object.assign(doc, { copied: item.copied, lastCopiedAt: item.lastCopiedAt });
    const back = model.remoteEntity(item.kind, {
      docId: item.id, fields: JSON.parse(JSON.stringify(doc)), sync: { rev: 1, key: item.key, deleted: false, by: 'me', project: item.project, list: item.list },
    });
    assert.equal(model.fieldsSig(back.fields), model.fieldsSig(item.fields), item.id);
    if (item.kind === 'note') assert.deepEqual([back.copied, back.lastCopiedAt, back.project, back.list], [item.copied, item.lastCopiedAt, item.project, item.list]);
  }
});

// ---- pristine Welcome

test('isPristineWelcome: the real seed on Windows and on a Mac (different tip texts)', () => {
  const win = page('win32').seedData();
  const mac = page('darwin').seedData();
  assert.notEqual(win.projects[0].notes[0].text, mac.projects[0].notes[0].text);
  for (const seed of [win, mac]) {
    assert.equal(model.isPristineWelcome(seed.projects[0]), true);
    assert.equal(model.isPristineBoard(seed), true);
    assert.equal(model.isPristineBoard(model.toModel(seed)), true);
    // As saved to disk and loaded again by normalize().
    const again = page('win32').normalize(JSON.parse(JSON.stringify(seed)));
    assert.equal(model.isPristineWelcome(again.projects[0]), true);
  }
});

test('isPristineWelcome: the seed stamps the project first, so its notes may be a moment later', () => {
  // seedData() evaluates the project's createdAt before makeNote() runs for the tips.
  const seed = page('win32', [1759300000000, 1759300000001]).seedData();
  const p = seed.projects[0];
  assert.ok(p.notes.every((n) => n.createdAt === p.createdAt + 1));
  assert.equal(model.isPristineWelcome(p), true);
  const slow = page('darwin', [1759300000000, 1759300002500]).seedData();
  assert.equal(model.isPristineWelcome(slow.projects[0]), false);
});

test('isPristineWelcome: a touched seed is a real board', () => {
  const touches = {
    copied: (p) => { p.notes[0].copied = 1; p.notes[0].lastCopiedAt = p.createdAt + 5000; },
    highlighted: (p) => { p.notes[3].highlight = 'amber'; },
    edited: (p) => { p.notes[2].text += '!'; p.notes[2].updatedAt += 60000; },
    'moved to Cooked': (p) => { const [n] = p.notes.splice(4, 1); n.usedAt = p.createdAt + 1; p.used.push(n); },
    'Served text': (p) => { p.combined.push({ ...p.notes[0], id: 'x' }); },
    'draft typed': (p) => { p.draft = 'my own words'; },
    'draft picture': (p) => { p.draftImages = [{ id: HEX('e'), w: 1, h: 1 }]; },
    'note added': (p) => { p.notes.push({ ...p.notes[0], id: 'extra' }); },
    'note deleted': (p) => { p.notes.pop(); },
    renamed: (p) => { p.name = 'Welcome!'; },
    recoloured: (p) => { p.color = 'moss'; },
    'picture added': (p) => { p.notes[1].images = [{ id: HEX('f'), w: 1, h: 1 }]; },
  };
  for (const [what, touch] of Object.entries(touches)) {
    const seed = page('win32').seedData();
    touch(seed.projects[0]);
    assert.equal(model.isPristineWelcome(seed.projects[0]), false, what);
    assert.equal(model.isPristineBoard(model.toModel(seed)), false, what);
  }
  // Per-device view state doesn't touch it.
  const seed = page('darwin').seedData();
  seed.projects[0].notesCollapsed = true;
  seed.projects[0].notes[0].expanded = true;
  seed.prefs.colWidths = { [seed.projects[0].id]: 400 };
  assert.equal(model.isPristineBoard(model.toModel(seed)), true);
});

test('isPristineWelcome: a "Welcome" made by hand is not the seed', () => {
  const t = 1759300000000;
  const notes = Array.from({ length: 10 }, (_, i) => ({
    id: `h${i}`, text: `my note ${i}`, images: [], createdAt: t + i * 60000, updatedAt: t + i * 60000, copied: 0, lastCopiedAt: 0, usedAt: 0,
  }));
  const project = { id: 'w', name: 'Welcome', color: 'monstera', createdAt: t, draft: '', draftImages: [], notes, used: [], combined: [] };
  assert.equal(model.isPristineWelcome(project), false);
});

test('isPristineBoard: exactly one pristine Welcome, on this computer or in the account', () => {
  const seed = page('win32').seedData();
  const two = JSON.parse(JSON.stringify(seed));
  two.projects.push({ id: 'p', name: 'Mine', color: 'moss', createdAt: 1, notes: [], used: [], combined: [] });
  assert.equal(model.isPristineBoard(two), false);
  assert.equal(model.isPristineBoard(model.toModel(two)), false);
  assert.equal(model.isPristineBoard({ projects: [] }), false);
  assert.equal(model.isPristineBoard(null), false);
  const withJunk = JSON.parse(JSON.stringify(seed));
  withJunk.projects[0].notes.push({ id: 'bad', text: 5 });
  assert.equal(model.isPristineBoard(model.toModel(withJunk)), false);

  // The account's side, decoded: the seed as this computer would upload it.
  const remote = { rev: 1, board: { joiner: null }, projects: new Map(), notes: new Map() };
  for (const item of diffLocal({ shadow: null, local: model.toModel(seed) }).upserts) {
    const fields = { ...item.fields, copied: item.copied, lastCopiedAt: item.lastCopiedAt };
    const sync = { rev: 1, key: item.key, deleted: false, by: 'me', project: item.project, list: item.list };
    remote[`${item.kind}s`].set(item.id, model.remoteEntity(item.kind, { docId: item.id, fields, sync }));
  }
  assert.equal(model.isPristineBoard(remote), true);
  const orphan = model.remoteEntity('note', { docId: 'o', fields: { text: 'x' }, sync: { rev: 2, key: 'V', by: 'b', project: 'gone', list: 'notes' } });
  remote.notes.set('o', orphan);
  assert.equal(model.isPristineBoard(remote), false);
});

test('countLive: models, the account\'s documents and the shadow', () => {
  const m = model.toModel(sampleFile());
  assert.deepEqual(model.countLive(m), { projects: 2, notes: 4, images: 1 });
  const shadow = { projects: {}, notes: {} };
  for (const item of diffLocal({ shadow: null, local: m }).upserts) shadow[`${item.kind}s`][item.id] = pushedEntry(item, { rev: 1 });
  shadow.notes.n2.d = true;
  shadow.notes.n5 = { f: { images: [{ id: HEX('a') }, { id: HEX('9') }] }, d: false };
  assert.deepEqual(model.countLive(shadow), { projects: 2, notes: 4, images: 2 });
  assert.deepEqual(model.countLive(model.shadowView(shadow)), { projects: 2, notes: 4, images: 2 });
  const remote = { projects: new Map([['p', { deleted: false }], ['q', { deleted: true }]]), notes: new Map([['n', { deleted: false, fields: { images: [] } }]]) };
  assert.deepEqual(model.countLive(remote), { projects: 1, notes: 1, images: 0 });
  assert.deepEqual(model.countLive(null), { projects: 0, notes: 0, images: 0 });
});

test('shadowView: reads sync/shadow.json defensively', () => {
  const view = model.shadowView({
    rev: 12, board: { joiner: 'blank' },
    projects: { p1: { f: { name: 'A' }, k: 'V', r: 3, u: 't', d: false, i: 'p1' }, bad: 'x' },
    notes: JSON.parse('{"__proto__": {"f": {"text": "odd"}, "k": "V", "r": 2, "p": "p1", "l": "nope"}, "n1": {}}'),
  });
  assert.equal(view.rev, 12);
  assert.deepEqual(view.board, { joiner: 'blank' });
  assert.deepEqual([...view.projects.keys()], ['p1']);
  assert.deepEqual(view.notes.get('__proto__'), { f: { text: 'odd' }, k: 'V', r: 2, u: null, d: false, i: '', p: 'p1', l: 'notes', c: 0, lc: 0 });
  assert.deepEqual(view.notes.get('n1'), { f: {}, k: '', r: 0, u: null, d: false, i: '', p: '', l: 'notes', c: 0, lc: 0 });
  assert.equal(model.shadowView(null).projects.size, 0);
});

// ---- encoding, with the real codec (WP2) once it exists

test('encode and fromDocs round-trip through the Firestore codec', { skip: HAS_CODEC ? false : 'src/cloud/codec.js (WP2) is not built yet' }, () => {
  const codec = require('../../src/cloud/codec');
  const file = sampleFile();
  file.projects[0].notes.push({ id: '__odd__', text: 'id that needs a hashed doc id', images: [], createdAt: 1, updatedAt: 1, copied: 2, lastCopiedAt: 3, usedAt: 0, weird: [[1, 2], [3]] });
  const local = model.toModel(file);
  const diff = diffLocal({ shadow: null, local });
  const doc = (kind, item, fields) => ({
    name: `projects/demo/databases/(default)/documents/users/u/${kind}s/${codec.docId(item.id)}`, fields, updateTime: '2026-10-01T10:00:00.000001Z',
  });
  const projectDocs = [];
  const noteDocs = [];
  for (const item of diff.upserts) {
    if (item.kind === 'project') projectDocs.push(doc('project', item, model.encodeProject(item, { rev: 1, by: 'me' })));
    else noteDocs.push(doc('note', item, model.encodeNote(item, { rev: 1, by: 'me' })));
  }
  const tomb = model.tombstoneFields({ rev: 2, key: 'V', by: 'me', project: 'p1', list: 'notes', id: 'gone' });
  noteDocs.push({ name: 'x/notes/gone', fields: tomb, updateTime: 't' });
  const head = { fields: codec.encodeFields({ rev: 2, minRev: 0, board: { joiner: 'line' } }, { skip: new Set() }).fields };
  const remote = model.fromDocs({ head, projectDocs, noteDocs });
  assert.equal(remote.rev, 2);
  assert.deepEqual(remote.board, { joiner: 'line' });
  for (const item of diff.upserts) {
    const r = remote[`${item.kind}s`].get(item.id);
    assert.ok(r, item.id);
    assert.equal(model.fieldsSig(r.fields), model.fieldsSig(item.fields), item.id);
    assert.equal(r.key, item.key);
    assert.equal(r.by, 'me');
    if (item.kind === 'note') assert.deepEqual([r.project, r.list, r.copied, r.lastCopiedAt], [item.project, item.list, item.copied, item.lastCopiedAt]);
  }
  assert.notEqual(remote.notes.get('__odd__').docId, '__odd__');
  assert.equal(remote.notes.get('gone').deleted, true);
});
