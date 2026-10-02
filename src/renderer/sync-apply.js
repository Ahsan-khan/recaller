'use strict';
// Applies a sync patch to the board in place (ai_memory/15, 5.8), reusing the page's live
// objects. The page loads this file as window.SyncApply and main requires it, so both sides
// agree on which keys belong to one computer and never sync.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.SyncApply = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const LISTS = ['notes', 'used', 'combined'];
  // Per-device and structural keys: never uploaded, never changed by a patch.
  const LOCAL_PROJECT_KEYS = Object.freeze(['id', 'notes', 'used', 'combined', 'notesCollapsed', 'usedCollapsed', 'augCollapsed',
    'usedExpanded', 'augExpanded', 'draft', 'draftImages']);
  const LOCAL_NOTE_KEYS = Object.freeze(['id', 'expanded', 'copied', 'lastCopiedAt']); // copied and lastCopiedAt sync as counters
  const LOCAL = new Set([...LOCAL_PROJECT_KEYS, ...LOCAL_NOTE_KEYS]);

  // Keys starting with 'local' are the convention for future per-device fields.
  const isLocalKey = (k) => LOCAL.has(k) || (typeof k === 'string' && k.startsWith('local'));

  const newProjectDefaults = () => ({ usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], notes: [], used: [], combined: [] });

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const list = (v) => (Array.isArray(v) ? v : []);
  const entries = (o) => (isObj(o) ? Object.keys(o).map((k) => [k, o[k]]) : []);
  const clone = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v);

  // A field named __proto__ (hand-edited files) stays an ordinary field.
  function put(obj, k, v) {
    if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
    else obj[k] = v;
  }

  // The synced keys of `obj` become exactly `fields`; per-device keys stay as they are.
  function assignSynced(obj, fields) {
    for (const k of Object.keys(obj)) if (!isLocalKey(k) && !Object.hasOwn(fields, k)) delete obj[k];
    for (const k of Object.keys(fields)) if (!isLocalKey(k)) put(obj, k, clone(fields[k]));
  }

  // Reorders `items` in place: the ids in `order` first, then everything it didn't mention.
  function reorder(items, order, idOf) {
    const byId = new Map();
    for (const item of items) if (!byId.has(idOf(item))) byId.set(idOf(item), item);
    const placed = new Set();
    const next = [];
    for (const id of order) {
      const item = byId.get(id);
      if (item && !placed.has(item)) { next.push(item); placed.add(item); }
    }
    for (const item of items) if (!placed.has(item)) next.push(item);
    items.length = 0;
    for (const item of next) items.push(item);
  }

  function applyPatch(data, patch) {
    const created = [];
    if (!isObj(data) || !isObj(patch)) return { created, removed: [] };
    if (!Array.isArray(data.projects)) data.projects = [];
    const projects = data.projects;
    const P = isObj(patch.projects) ? patch.projects : {};
    const N = isObj(patch.notes) ? patch.notes : {};
    const findProject = (id) => projects.find((p) => isObj(p) && p.id === id);

    // Every note, indexed before anything moves, so a note leaving a removed project keeps
    // its object (with its copy count and expanded state).
    const live = new Map();
    for (const p of projects) {
      if (!isObj(p)) continue;
      for (const l of LISTS) for (const n of list(p[l])) if (isObj(n) && !live.has(n.id)) live.set(n.id, { note: n, project: p, list: l });
    }
    const before = [...live.keys()];
    const detach = (at) => {
      const arr = list(at.project[at.list]);
      const i = arr.indexOf(at.note);
      if (i >= 0) arr.splice(i, 1);
    };

    // 1. Projects
    for (const [id, up] of entries(P.upsert)) {
      const fields = isObj(up) && isObj(up.fields) ? up.fields : {};
      const p = findProject(id);
      if (p) {
        assignSynced(p, fields);
        continue;
      }
      const project = { id };
      for (const k of Object.keys(fields)) if (!isLocalKey(k)) put(project, k, clone(fields[k]));
      Object.assign(project, newProjectDefaults());
      projects.push(project);
    }

    // 2. Project removals, together with their notes
    const gone = new Set(list(P.remove));
    for (let i = projects.length - 1; i >= 0; i--) if (isObj(projects[i]) && gone.has(projects[i].id)) projects.splice(i, 1);

    // 3. Notes: updated in place (moved when the project or list differs), or added
    for (const [id, up] of entries(N.upsert)) {
      if (!isObj(up)) continue;
      const fields = isObj(up.fields) ? up.fields : {};
      const target = findProject(up.project);
      const l = LISTS.includes(up.list) ? up.list : null;
      if (target && l && !Array.isArray(target[l])) target[l] = [];
      const at = live.get(id);
      if (at) {
        if (target && l && (at.project !== target || at.list !== l)) {
          detach(at);
          target[l].push(at.note);
          at.project = target;
          at.list = l;
        }
        assignSynced(at.note, fields);
      } else if (target && l) {
        const note = { id };
        for (const k of Object.keys(fields)) if (!isLocalKey(k)) put(note, k, clone(fields[k]));
        note.copied = 0;
        note.lastCopiedAt = 0;
        target[l].push(note);
        live.set(id, { note, project: target, list: l });
        created.push(id);
      }
    }

    // 4. Note removals
    for (const id of list(N.remove)) {
      const at = live.get(id);
      if (!at) continue;
      detach(at);
      live.delete(id);
    }

    // 5. Copy counters, as deltas: a copy made here meanwhile is never lost
    for (const [id, c] of entries(N.counters)) {
      const at = live.get(id);
      if (!at || !isObj(c)) continue;
      const note = at.note;
      if (Number.isFinite(c.copiedDelta)) note.copied = (note.copied || 0) + c.copiedDelta;
      if (Number.isFinite(c.lastCopiedAt)) note.lastCopiedAt = Math.max(note.lastCopiedAt || 0, c.lastCopiedAt);
    }

    // 6. List order; notes the patch didn't mention are appended, so nothing vanishes
    for (const [pid, orders] of entries(patch.lists)) {
      const p = findProject(pid);
      if (!p || !isObj(orders)) continue;
      for (const l of LISTS) {
        if (!Object.hasOwn(orders, l) || !Array.isArray(orders[l])) continue;
        if (!Array.isArray(p[l])) p[l] = [];
        reorder(p[l], orders[l], (n) => n?.id);
      }
    }

    // 7. Column order; projects it didn't mention are appended
    if (Array.isArray(P.order)) reorder(projects, P.order, (p) => p?.id);

    // 8. "Join notes with"
    if (isObj(patch.board) && Object.hasOwn(patch.board, 'joiner')) {
      const joiner = patch.board.joiner;
      if (joiner === null) {
        if (isObj(data.prefs)) delete data.prefs.joiner;
      } else if (typeof joiner === 'string') {
        if (!isObj(data.prefs)) data.prefs = {};
        data.prefs.joiner = joiner;
      }
    }

    const after = new Set();
    for (const p of projects) if (isObj(p)) for (const l of LISTS) for (const n of list(p[l])) if (isObj(n)) after.add(n.id);
    return { created, removed: before.filter((id) => !after.has(id)) };
  }

  return { applyPatch, LOCAL_PROJECT_KEYS, LOCAL_NOTE_KEYS, isLocalKey, newProjectDefaults };
});
