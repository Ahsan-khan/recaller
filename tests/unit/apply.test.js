'use strict';
// Applying a patch in the page (src/renderer/sync-apply.js). Plain Node: node --test tests/unit/apply.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SyncApply = require('../../src/renderer/sync-apply');

const { applyPatch, isLocalKey, LOCAL_PROJECT_KEYS, LOCAL_NOTE_KEYS, newProjectDefaults } = SyncApply;
const FILE = path.join(__dirname, '../../src/renderer/sync-apply.js');

const note = (id, text, extra = {}) => ({ id, text, images: [], createdAt: 1000, updatedAt: 1000, copied: 0, lastCopiedAt: 0, usedAt: 0, ...extra });
const project = (id, name, lists = {}, extra = {}) => ({
  id, name, color: 'moss', createdAt: 1000, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [],
  notes: [], used: [], combined: [], ...lists, ...extra,
});

function pageData() {
  return {
    version: 2,
    prefs: { density: 'slim', joiner: 'line', colWidths: { p1: 330 } },
    projects: [
      project('p1', 'Alpha', {
        notes: [note('a', 'A', { copied: 3, lastCopiedAt: 50, expanded: true, localMark: 1 }), note('b', 'B', { highlight: 'amber' })],
        used: [note('u', 'U', { usedAt: 9 })],
      }, { notesCollapsed: true, usedExpanded: true, draft: 'my draft', draftImages: [{ id: 'd'.repeat(32), w: 1, h: 1 }], localWidth: 2 }),
      project('p2', 'Beta', { notes: [note('e', 'E', { copied: 7 })], combined: [note('f', 'F')] }),
    ],
  };
}

function emptyPatch(extra = {}) {
  return {
    id: 'patch-1', session: 's', basedOnContentSeq: 3, changesContent: true, resetHistory: true,
    projects: { upsert: {}, remove: [], order: null },
    notes: { upsert: {}, remove: [], counters: {} },
    lists: {},
    notices: [],
    ...extra,
  };
}

const where = (data, id) => {
  for (const p of data.projects) for (const l of ['notes', 'used', 'combined']) {
    const n = p[l].find((x) => x.id === id);
    if (n) return { note: n, project: p.id, list: l };
  }
  return null;
};
const ids = (data, pid, list = 'notes') => data.projects.find((p) => p.id === pid)[list].map((n) => n.id);

test('the per-device key lists, isLocalKey and newProjectDefaults', () => {
  assert.deepEqual([...LOCAL_PROJECT_KEYS], ['id', 'notes', 'used', 'combined', 'notesCollapsed', 'usedCollapsed', 'augCollapsed', 'usedExpanded', 'augExpanded', 'draft', 'draftImages']);
  assert.deepEqual([...LOCAL_NOTE_KEYS], ['id', 'expanded', 'copied', 'lastCopiedAt']);
  assert.ok(Object.isFrozen(LOCAL_PROJECT_KEYS) && Object.isFrozen(LOCAL_NOTE_KEYS));
  for (const k of [...LOCAL_PROJECT_KEYS, ...LOCAL_NOTE_KEYS, 'localAnything', 'local']) assert.equal(isLocalKey(k), true, k);
  for (const k of ['text', 'images', 'name', 'color', 'createdAt', 'updatedAt', 'usedAt', 'highlight', 'syncConflict', 'futureField', 'Local', 'isLocal']) {
    assert.equal(isLocalKey(k), false, k);
  }
  const one = newProjectDefaults();
  assert.deepEqual(one, { usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], notes: [], used: [], combined: [] });
  one.notes.push(1);
  assert.deepEqual(newProjectDefaults().notes, [], 'a fresh object every time');
});

test('reuses live objects: updates, moves between lists and projects', () => {
  const data = pageData();
  const p1 = data.projects[0];
  const a = p1.notes[0];
  const b = p1.notes[1];
  const u = p1.used[0];
  const patch = emptyPatch({
    projects: { upsert: { p1: { fields: { name: 'Alpha renamed', color: 'sun', createdAt: 1000 } } }, remove: [], order: null },
    notes: {
      upsert: {
        a: { fields: { text: 'A2', images: [], createdAt: 1000, updatedAt: 2000, usedAt: 0 }, project: 'p1', list: 'notes' },
        b: { fields: { text: 'B', images: [], createdAt: 1000, updatedAt: 1000, usedAt: 5, highlight: 'amber' }, project: 'p1', list: 'used' },
        u: { fields: { text: 'U', images: [], createdAt: 1000, updatedAt: 1000, usedAt: 9 }, project: 'p2', list: 'combined' },
      },
      remove: [],
      counters: {},
    },
    lists: { p1: { used: ['u', 'b'] } },
  });
  const result = applyPatch(data, patch);
  assert.deepEqual(result, { created: [], removed: [] });
  assert.equal(data.projects[0], p1);
  assert.equal(p1.name, 'Alpha renamed');
  assert.equal(where(data, 'a').note, a);
  assert.equal(a.text, 'A2');
  assert.equal(where(data, 'b').note, b);
  assert.deepEqual([where(data, 'b').project, where(data, 'b').list], ['p1', 'used']);
  assert.equal(where(data, 'u').note, u);
  assert.deepEqual([where(data, 'u').project, where(data, 'u').list], ['p2', 'combined']);
  assert.deepEqual(ids(data, 'p1'), ['a']);
  assert.deepEqual(ids(data, 'p1', 'used'), ['b']);
  assert.deepEqual(ids(data, 'p2', 'combined'), ['f', 'u']);
});

test('a note that leaves a removed project keeps its object, count and expanded state', () => {
  const data = pageData();
  const e = data.projects[1].notes[0];
  const patch = emptyPatch({
    projects: { upsert: {}, remove: ['p2'], order: null },
    notes: { upsert: { e: { fields: { text: 'E', images: [], createdAt: 1000, updatedAt: 1000, usedAt: 0 }, project: 'p1', list: 'notes' } }, remove: [], counters: {} },
  });
  const { created, removed } = applyPatch(data, patch);
  assert.deepEqual(created, []);
  assert.deepEqual(removed, ['f']);
  assert.deepEqual(data.projects.map((p) => p.id), ['p1']);
  assert.equal(where(data, 'e').note, e);
  assert.equal(e.copied, 7);
  assert.deepEqual(ids(data, 'p1'), ['a', 'b', 'e']);
});

test('unmentioned notes are appended: nothing vanishes', () => {
  const data = pageData();
  data.projects[0].notes.push(note('c', 'C'), note('d', 'D'));
  const patch = emptyPatch({ lists: { p1: { notes: ['d', 'ghost', 'b', 'b'] } } });
  applyPatch(data, patch);
  assert.deepEqual(ids(data, 'p1'), ['d', 'b', 'a', 'c']);
  // An order that names a note of another list takes nothing from there.
  applyPatch(data, emptyPatch({ lists: { p1: { used: ['a', 'u'] } } }));
  assert.deepEqual(ids(data, 'p1', 'used'), ['u']);
  assert.deepEqual(ids(data, 'p1'), ['d', 'b', 'a', 'c']);
  // The same for columns.
  data.projects.push(project('p3', 'Gamma'));
  applyPatch(data, emptyPatch({ projects: { upsert: {}, remove: [], order: ['p3', 'nope', 'p1'] } }));
  assert.deepEqual(data.projects.map((p) => p.id), ['p3', 'p1', 'p2']);
});

test('per-device keys are never touched; synced keys missing from fields are deleted', () => {
  const data = pageData();
  const p1 = data.projects[0];
  const a = p1.notes[0];
  const draftImages = p1.draftImages;
  const patch = emptyPatch({
    projects: {
      upsert: { p1: { fields: { name: 'Alpha', color: 'moss', createdAt: 1000, draft: 'overwritten?', notes: [], id: 'p9', notesCollapsed: false, localWidth: 9 } } },
      remove: [], order: null,
    },
    notes: {
      upsert: {
        a: { fields: { text: 'A', images: [], createdAt: 1000, updatedAt: 1000, usedAt: 0, expanded: false, copied: 99, lastCopiedAt: 99, id: 'zz', localMark: 5 }, project: 'p1', list: 'notes' },
        b: { fields: { text: 'B', images: [], createdAt: 1000, updatedAt: 1000, usedAt: 0 }, project: 'p1', list: 'notes' },
      },
      remove: [], counters: {},
    },
  });
  applyPatch(data, patch);
  assert.equal(p1.id, 'p1');
  assert.deepEqual([p1.draft, p1.draftImages, p1.notesCollapsed, p1.usedExpanded, p1.localWidth], ['my draft', draftImages, true, true, 2]);
  assert.deepEqual(ids(data, 'p1'), ['a', 'b']);
  assert.deepEqual([a.id, a.expanded, a.copied, a.lastCopiedAt, a.localMark], ['a', true, 3, 50, 1]);
  assert.equal(Object.hasOwn(data.projects[0].notes[1], 'highlight'), false, 'the other side removed it');
  assert.deepEqual(data.prefs.colWidths, { p1: 330 });
});

test('new projects get this computer\'s defaults; new notes start with no copies', () => {
  const data = pageData();
  const patch = emptyPatch({
    projects: { upsert: { p3: { fields: { name: 'From the Mac', color: 'ruby', createdAt: 5, futureProjectField: [1, [2]], draft: 'x', usedCollapsed: true } } }, remove: [], order: ['p1', 'p3', 'p2'] },
    notes: {
      upsert: {
        g: { fields: { text: 'G', images: [], createdAt: 5, updatedAt: 5, usedAt: 0, futureNoteField: { deep: true } }, project: 'p3', list: 'notes' },
        h: { fields: { text: 'H', images: [], createdAt: 6, updatedAt: 6, usedAt: 8 }, project: 'p3', list: 'used' },
        lost: { fields: { text: 'no such project' }, project: 'nowhere', list: 'notes' },
      },
      remove: [],
      counters: { g: { copiedDelta: 4, lastCopiedAt: 70 } },
    },
    lists: { p3: { notes: ['g'], used: ['h'] } },
  });
  const { created } = applyPatch(data, patch);
  assert.deepEqual(created, ['g', 'h']);
  assert.deepEqual(data.projects.map((p) => p.id), ['p1', 'p3', 'p2']);
  const p3 = data.projects[1];
  assert.deepEqual(p3, {
    id: 'p3', name: 'From the Mac', color: 'ruby', createdAt: 5, futureProjectField: [1, [2]],
    usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [],
    notes: [{ id: 'g', text: 'G', images: [], createdAt: 5, updatedAt: 5, usedAt: 0, futureNoteField: { deep: true }, copied: 4, lastCopiedAt: 70 }],
    used: [{ id: 'h', text: 'H', images: [], createdAt: 6, updatedAt: 6, usedAt: 8, copied: 0, lastCopiedAt: 0 }],
    combined: [],
  });
  assert.equal(where(data, 'lost'), null);
});

test('removals: notes, and projects together with their notes', () => {
  const data = pageData();
  const { removed } = applyPatch(data, emptyPatch({
    projects: { upsert: {}, remove: ['p2', 'ghost'], order: null },
    notes: { upsert: {}, remove: ['b', 'ghost'], counters: {} },
  }));
  assert.deepEqual(removed.sort(), ['b', 'e', 'f']);
  assert.deepEqual(data.projects.map((p) => p.id), ['p1']);
  assert.deepEqual(ids(data, 'p1'), ['a']);
});

test('copy counts are deltas; lastCopiedAt never goes back', () => {
  const data = pageData();
  applyPatch(data, emptyPatch({
    changesContent: false, resetHistory: false,
    notes: { upsert: {}, remove: [], counters: { a: { copiedDelta: 2, lastCopiedAt: 40 }, e: { copiedDelta: 0, lastCopiedAt: 999 }, ghost: { copiedDelta: 1, lastCopiedAt: 1 } } },
  }));
  const a = where(data, 'a').note;
  const e = where(data, 'e').note;
  assert.deepEqual([a.copied, a.lastCopiedAt], [5, 50]);
  assert.deepEqual([e.copied, e.lastCopiedAt], [7, 999]);
  const bare = { projects: [project('p', 'P', { notes: [{ id: 'n', text: 'no counters yet' }] })] };
  applyPatch(bare, emptyPatch({ notes: { upsert: {}, remove: [], counters: { n: { copiedDelta: 3, lastCopiedAt: 8 } } } }));
  assert.deepEqual([bare.projects[0].notes[0].copied, bare.projects[0].notes[0].lastCopiedAt], [3, 8]);
});

test('"Join notes with": set, deleted with null, untouched without board', () => {
  const data = pageData();
  applyPatch(data, emptyPatch());
  assert.equal(data.prefs.joiner, 'line');
  applyPatch(data, emptyPatch({ board: { joiner: 'blank' } }));
  assert.equal(data.prefs.joiner, 'blank');
  applyPatch(data, emptyPatch({ board: { joiner: null } }));
  assert.equal(Object.hasOwn(data.prefs, 'joiner'), false);
  assert.deepEqual(data.prefs, { density: 'slim', colWidths: { p1: 330 } });
  const noPrefs = { projects: [] };
  applyPatch(noPrefs, emptyPatch({ board: { joiner: 'line' } }));
  assert.deepEqual(noPrefs.prefs, { joiner: 'line' });
});

test('fields are copied in, never shared with the patch', () => {
  const data = pageData();
  const images = [{ id: 'a'.repeat(32), w: 1, h: 2 }];
  const patch = emptyPatch({ notes: { upsert: { a: { fields: { text: 'A', images, createdAt: 1, updatedAt: 1, usedAt: 0 }, project: 'p1', list: 'notes' } }, remove: [], counters: {} } });
  applyPatch(data, patch);
  images[0].w = 999;
  assert.equal(where(data, 'a').note.images[0].w, 1);
});

test('malformed patches never throw, and a __proto__ field stays an ordinary field', () => {
  const data = pageData();
  const before = JSON.stringify(data);
  assert.deepEqual(applyPatch(data, null), { created: [], removed: [] });
  assert.deepEqual(applyPatch(data, { projects: 5, notes: 'x', lists: [], board: 3 }), { created: [], removed: [] });
  assert.deepEqual(applyPatch(null, emptyPatch()), { created: [], removed: [] });
  assert.equal(JSON.stringify(data), before);
  const fields = JSON.parse('{"text": "odd", "images": [], "__proto__": {"polluted": true}}');
  applyPatch(data, emptyPatch({ notes: { upsert: { a: { fields, project: 'p1', list: 'notes' } }, remove: [], counters: {} } }));
  const a = where(data, 'a').note;
  assert.equal(a.polluted, undefined);
  assert.equal(Object.getPrototypeOf(a), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(a, '__proto__').value, { polluted: true });
  assert.equal({}.polluted, undefined);
});

test('the same file runs in the page as window.SyncApply', () => {
  const window = {};
  const ctx = vm.createContext({ window, structuredClone });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx);
  const api = window.SyncApply;
  assert.ok(api, 'window.SyncApply is set');
  assert.deepEqual(Object.keys(api).sort(), ['LOCAL_NOTE_KEYS', 'LOCAL_PROJECT_KEYS', 'applyPatch', 'isLocalKey', 'newProjectDefaults']);
  const data = pageData();
  api.applyPatch(data, emptyPatch({ board: { joiner: null }, projects: { upsert: {}, remove: ['p2'], order: null } }));
  assert.deepEqual(data.projects.map((p) => p.id), ['p1']);
  assert.equal(data.prefs.joiner, undefined);
});

// app.js partsHtml(), the Cooked and Served "Notes" lists, with the page's own escapeHtml: a note id comes from the
// account in 1.17 (the rules take any string), so it must stay inside its attribute.
function pagePartsHtml() {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const cut = (from, to) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start);
    assert.ok(start > 0 && end > start, `${from.trim()} found in app.js`);
    return src.slice(start, end);
  };
  const helpers = cut('  const ESC = {', '  const imgUrl');
  const parts = cut('  function partsHtml(', '  function syncList(');
  const ctx = vm.createContext({ I: { arrowUp: '', arrowDown: '', edit: '', restore: '', trash: '' } });
  vm.runInContext(`${helpers}\nconst highlight = (text) => escapeHtml(text);\n${parts}\nthis.partsHtml = partsHtml;`, ctx);
  return ctx.partsHtml;
}

test('a note id from the account stays inside its attribute in the Cooked and Served Notes lists', () => {
  const evil = 'x"><style>.board{display:none}</style><a href="https://example.invalid" target="_blank">sign in</a><i title="';
  const data = pageData();
  applyPatch(data, emptyPatch({ notes: { upsert: { [evil]: { fields: { text: 'looks harmless', images: [] }, project: 'p1', list: 'used' } }, remove: [], counters: {} } }));
  const used = data.projects[0].used;
  assert.ok(used.some((n) => n.id === evil), 'the page holds the note');
  const partsHtml = pagePartsHtml();
  const html = partsHtml(used, { terms: [], key: '' }, { cls: 'ap-back fp-back', title: 'Send back to Cooking' });
  assert.ok(!html.includes('<style>') && !html.includes('<a '), 'no markup from the id');
  const attrs = [...html.matchAll(/data-id="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(attrs.length, 2, 'one row per note, each id inside its attribute');
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
  assert.deepEqual(attrs.map(decode), ['u', evil], 'dataset.id reads back the id unchanged');
  // An id the page made (a UUID) is written exactly as before.
  const uuid = '0b7c8f1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
  assert.ok(partsHtml([note(uuid, 'mine')], { terms: [], key: '' }, { cls: 'fp-back', title: 'Send back to Cooked' }).includes(`data-id="${uuid}"`));
});
