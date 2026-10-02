'use strict';
// Pending local changes (ai_memory/15, 5.4): the data file on disk, as a model, against the
// shadow. Upserts are whole documents (items are written without an update mask). Tombstones
// carry the last synced fields for the 30-day trash copy, and happen only in normal mode.

const { orderKeys, keysBetween, needsRekey } = require('./keys');
const { LISTS, listKey, fieldsSig, shadowView, isPristineWelcome, projectShape } = require('./model');

const MAX_DOC_BYTES = 900 * 1000; // estimated; Firestore's limit is 1 MiB
const MAX_FIELDS = 150;           // the rules allow 200

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const asView = (shadow) => (shadow && shadow.projects instanceof Map && shadow.notes instanceof Map ? shadow : shadowView(shadow));

// Order keys for this computer's columns and lists: shadow keys are kept where the order
// allows (only notes that stayed in the same list count), the rest get new ones. With `rekey`,
// a list holding a key over 48 characters is re-keyed evenly (pushes only; merges never do).
function localKeys(local, shadow, { rekey = true } = {}) {
  const base = asView(shadow);
  const out = new Map();
  const assign = (ids, known) => {
    let keys = orderKeys(ids, known);
    if (rekey && needsRekey(keys.values())) {
      const fresh = keysBetween(null, null, ids.length);
      keys = new Map(ids.map((id, i) => [id, fresh[i]]));
    }
    for (const [id, key] of keys) out.set(id, key);
  };
  const columns = new Map();
  for (const pid of local.columns) {
    const e = base.projects.get(pid);
    if (e) columns.set(pid, e.k);
  }
  assign(local.columns, columns);
  for (const pid of local.columns) {
    for (const list of LISTS) {
      const ids = local.lists.get(listKey(pid, list)) || [];
      const known = new Map();
      for (const id of ids) {
        const e = base.notes.get(id);
        if (e && e.p === pid && e.l === list) known.set(id, e.k);
      }
      assign(ids, known);
    }
  }
  return out;
}

// The signature state.quarantine stores: a quarantined item is retried once it changes.
function quarantineSig(item) {
  if (!item.reason) return 'deleted';
  return fieldsSig({ f: item.fields, p: item.project ?? null, l: item.list ?? null });
}

// The document's size as JSON, with room to spare (the typed encoding is a little larger).
function estimateBytes(item) {
  const sync = { rev: 1e12, key: item.key, deleted: false, by: '0'.repeat(32), at: '2026-01-01T00:00:00.000000Z', id: item.id };
  const extra = { _sync: sync };
  if (item.kind === 'note') {
    Object.assign(sync, { project: item.project, list: item.list });
    Object.assign(extra, { copied: item.copied, lastCopiedAt: item.lastCopiedAt });
  }
  return Math.ceil((Buffer.byteLength(JSON.stringify(item.fields)) + Buffer.byteLength(JSON.stringify(extra))) * 1.1);
}

const tooLarge = (item) => Object.keys(item.fields).length + 3 > MAX_FIELDS || estimateBytes(item) > MAX_DOC_BYTES;

// A pristine Welcome this computer made and the account never had (with its notes).
function seedIds(local, base) {
  const ids = new Set();
  for (const pid of local.columns) {
    if (base.projects.has(pid) || !isPristineWelcome(projectShape(local, pid))) continue;
    const notes = LISTS.flatMap((list) => local.lists.get(listKey(pid, list)) || []);
    if (notes.some((id) => base.notes.has(id))) continue;
    ids.add(pid);
    for (const id of notes) ids.add(id);
  }
  return ids;
}

function diffLocal({ shadow, local, mode = 'normal', quarantine = null, seeded = false } = {}) {
  const base = asView(shadow);
  const keys = localKeys(local, base);
  const quarantined = new Map();
  if (quarantine instanceof Map) for (const [k, v] of quarantine) quarantined.set(k, v?.sig);
  else if (isObj(quarantine)) for (const k of Object.keys(quarantine)) quarantined.set(k, quarantine[k]?.sig);
  const skip = seeded ? seedIds(local, base) : new Set();
  const out = {
    upserts: [], tombstones: [], pending: 0, counterOnly: false, tooLarge: [],
    deletions: { notes: 0, projects: 0 }, board: null, quarantined: [],
  };
  const held = (item) => {
    const qk = `${item.kind}:${item.id}`;
    if (!quarantined.has(qk) || quarantined.get(qk) !== quarantineSig(item)) return false;
    out.quarantined.push(qk);
    return true;
  };
  const upsert = (item) => {
    if (tooLarge(item)) out.tooLarge.push(item.id);
    else if (!held(item)) out.upserts.push(item);
  };
  const tombstone = (kind, id, b) => {
    const item = { kind, id, key: b.k, trashData: JSON.stringify(b.f), fields: b.f };
    if (kind === 'note') Object.assign(item, { project: b.p, list: b.l, copied: b.c, lastCopiedAt: b.lc });
    if (held(item)) return;
    out.tombstones.push(item);
    out.deletions[kind === 'note' ? 'notes' : 'projects']++;
  };

  for (const pid of local.columns) {
    if (skip.has(pid)) continue;
    const p = local.projects.get(pid);
    const b = base.projects.get(pid);
    const key = keys.get(pid);
    const reason = !b ? 'new' : b.d ? 'undelete' : fieldsSig(p.fields) !== fieldsSig(b.f) || key !== b.k ? 'change' : null;
    if (reason) upsert({ kind: 'project', id: pid, fields: p.fields, key, reason });
  }
  for (const pid of local.columns) {
    for (const list of LISTS) {
      for (const id of local.lists.get(listKey(pid, list)) || []) {
        if (skip.has(id)) continue;
        const n = local.notes.get(id);
        const b = base.notes.get(id);
        const key = keys.get(id);
        let reason = null;
        if (!b) reason = 'new';
        else if (b.d) reason = 'undelete';
        else if (fieldsSig(n.fields) !== fieldsSig(b.f) || key !== b.k || pid !== b.p || list !== b.l) reason = 'change';
        else if (n.copied !== b.c || n.lastCopiedAt !== b.lc) reason = 'counter';
        if (reason) {
          upsert({ kind: 'note', id, fields: n.fields, key, project: pid, list, copied: n.copied, lastCopiedAt: n.lastCopiedAt, reason });
        }
      }
    }
  }
  // Missing here means deleted only for a file this app wrote (normal mode). Entities the
  // defensive toModel skipped are still on disk, so they are never tombstoned.
  if (mode === 'normal') {
    const gone = (m, id, b) => !b.d && !m.has(id) && !local.skipped.has(id);
    for (const [id, b] of [...base.notes].sort(byId)) if (gone(local.notes, id, b)) tombstone('note', id, b);
    for (const [id, b] of [...base.projects].sort(byId)) if (gone(local.projects, id, b)) tombstone('project', id, b);
  }
  // A joiner that was never set here is no opinion; a push never deletes the account's.
  if (local.board.joiner !== null && local.board.joiner !== base.board.joiner) out.board = { joiner: local.board.joiner };

  out.pending = out.upserts.length + out.tombstones.length + (out.board ? 1 : 0);
  out.counterOnly = out.pending > 0 && !out.tombstones.length && !out.board && out.upserts.every((u) => u.reason === 'counter');
  return out;
}

// The shadow entry for an item once its commit has succeeded (5.5, step 7). A tombstone keeps
// the fields it last had, so a later undelete elsewhere can be told apart from an edit.
function pushedEntry(item, { rev, updateTime = null, docId = '' } = {}) {
  const deleted = !item.reason;
  const entry = { f: item.fields || {}, k: item.key, r: rev, u: updateTime, d: deleted, i: docId };
  if (item.kind === 'note') Object.assign(entry, { p: item.project, l: item.list, c: item.copied || 0, lc: item.lastCopiedAt || 0 });
  return entry;
}

module.exports = { diffLocal, localKeys, quarantineSig, pushedEntry, MAX_DOC_BYTES, MAX_FIELDS };
