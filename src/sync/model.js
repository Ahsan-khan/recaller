'use strict';
// The board as sync sees it (ai_memory/15, 3.3, 4.2–4.4). The data file and the account's
// documents become the same shapes: synced fields per project and note, their places and copy
// counters. Per-device keys (SyncApply.isLocalKey) never enter a model, and values are coerced
// the way normalize() does it, so a note that goes up and comes back compares equal.

const { isLocalKey, LOCAL_PROJECT_KEYS, LOCAL_NOTE_KEYS } = require('../renderer/sync-apply');
const { compareKeyed } = require('./keys');

const LISTS = ['notes', 'used', 'combined'];
const IMAGE_ID = /^[a-f0-9]{32}$/;
const LONE_SURROGATE = /\p{Surrogate}/u;
const SKIP = new Set([...LOCAL_PROJECT_KEYS, ...LOCAL_NOTE_KEYS]);

// The Firestore codec (WP2) is needed only to encode and decode documents.
let codecModule = null;
const codec = () => codecModule || (codecModule = require('../cloud/codec'));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const int = (v) => (Number.isSafeInteger(v) ? v : Number.isSafeInteger(Number(v)) ? Number(v) : 0);
const str = (v) => (typeof v === 'string' ? v : '');
const listKey = (pid, list) => `${pid}\u0000${list}`;

// A field named __proto__ (hand-edited files) stays an ordinary field.
function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  else obj[k] = v;
  return obj;
}

// The same rule as normalize()'s cleanImages in app.js.
const cleanImages = (list) => (Array.isArray(list) ? list : [])
  .filter((i) => i && IMAGE_ID.test(i.id))
  .map((i) => ({ ...i, w: Number(i.w) || 0, h: Number(i.h) || 0 }));

function synced(src) {
  const out = {};
  for (const k of Object.keys(src)) if (!isLocalKey(k)) put(out, k, src[k]);
  return out;
}

// Clock-filled values that normalize() would invent are left out rather than guessed.
function dropBadTimes(f, keys) {
  for (const k of keys) if (Object.hasOwn(f, k) && !Number.isFinite(f[k])) delete f[k];
  return f;
}

function projectFields(src) {
  const f = synced(src);
  if (!(typeof f.name === 'string' && f.name.trim())) f.name = 'Untitled';
  if (!(typeof f.color === 'string' && f.color)) f.color = 'monstera';
  return dropBadTimes(f, ['createdAt']);
}

function noteFields(src) {
  const f = synced(src);
  if (typeof f.text !== 'string') f.text = String(f.text ?? '');
  f.images = cleanImages(f.images);
  f.usedAt = num(f.usedAt);
  return dropBadTimes(f, ['createdAt', 'updatedAt']);
}

// ---- the data file

// Defensive like normalize(): the first holder of an id keeps it. Entities normalize() would
// drop or give a new id are skipped (their ids go in `skipped`), so they are never tombstoned;
// so are ids Firestore can't store (a lone surrogate), which stay on this computer only.
function toModel(data) {
  const m = { board: { joiner: null }, projects: new Map(), notes: new Map(), columns: [], lists: new Map(), skipped: new Set() };
  if (!isObj(data)) return m;
  if (isObj(data.prefs) && typeof data.prefs.joiner === 'string') m.board.joiner = data.prefs.joiner;
  if (!Array.isArray(data.projects)) return m;
  const seen = new Set();
  const claim = (id) => {
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      if (!LONE_SURROGATE.test(id)) return true;
    }
    if (typeof id === 'string' && id) m.skipped.add(id);
    return false;
  };
  for (const p of data.projects) {
    if (!p || typeof p !== 'object') continue;
    const pid = p.id;
    const kept = claim(pid);
    if (kept) {
      const draftImages = cleanImages(p.draftImages).length;
      m.projects.set(pid, {
        id: pid,
        fields: projectFields(p),
        hasDraft: (typeof p.draft === 'string' && p.draft.trim() !== '') || draftImages > 0,
        draftEmpty: (typeof p.draft !== 'string' || p.draft === '') && draftImages === 0,
      });
      m.columns.push(pid);
    }
    for (const list of LISTS) {
      const ids = [];
      for (const n of Array.isArray(p[list]) ? p[list] : []) {
        if (!n || typeof n.text !== 'string') {
          if (n && typeof n.id === 'string' && n.id) m.skipped.add(n.id);
          continue;
        }
        if (!claim(n.id)) continue;
        if (!kept) {
          m.skipped.add(n.id);
          continue;
        }
        m.notes.set(n.id, { id: n.id, fields: noteFields(n), project: pid, list, copied: num(n.copied), lastCopiedAt: num(n.lastCopiedAt) });
        ids.push(n.id);
      }
      if (kept) m.lists.set(listKey(pid, list), ids);
    }
  }
  return m;
}

// ---- the account's documents

// One decoded document: `fields` is plain JSON (decodeFields), `sync` the decoded _sync map.
function remoteEntity(kind, { docId = '', fields = {}, sync = {}, updateTime = null } = {}) {
  const s = isObj(sync) ? sync : {};
  const src = isObj(fields) ? fields : {};
  const deleted = s.deleted === true;
  const entity = {
    id: typeof s.id === 'string' && s.id ? s.id : String(docId),
    docId: String(docId),
    fields: deleted ? {} : kind === 'note' ? noteFields(src) : projectFields(src),
    key: str(s.key),
    rev: int(s.rev),
    deleted,
    updateTime: updateTime ?? null,
    by: str(s.by),
  };
  if (kind === 'note') {
    entity.project = str(s.project);
    entity.list = LISTS.includes(s.list) ? s.list : 'notes';
    entity.copied = deleted ? 0 : num(src.copied);
    entity.lastCopiedAt = deleted ? 0 : num(src.lastCopiedAt);
  }
  return entity;
}

// Docs as returned by firestore.js ({ path, name, fields, updateTime }), fields typed.
function fromDocs({ head = null, projectDocs = [], noteDocs = [], log = null } = {}) {
  const c = codec();
  const h = !head ? {} : isObj(head.fields) ? c.decodeFields(head.fields) : head;
  const remote = {
    rev: int(h.rev),
    minRev: int(h.minRev),
    board: { joiner: isObj(h.board) && typeof h.board.joiner === 'string' ? h.board.joiner : null },
    projects: new Map(),
    notes: new Map(),
  };
  const read = (kind, into, docs) => {
    for (const doc of docs || []) {
      const typed = doc && isObj(doc.fields) ? doc.fields : null;
      const sync = typed && typed._sync ? c.fromValue(typed._sync) : null;
      if (!isObj(sync)) {
        log?.(`[sync] a ${kind} document has no _sync; skipped`);
        continue;
      }
      const fields = c.decodeFields(typed);
      if (kind === 'note' && sync.deleted !== true && typeof fields.text !== 'string') log?.('[sync] a note document had non-string text');
      const docId = String(doc.name || doc.path || '').split('/').pop();
      const entity = remoteEntity(kind, { docId, fields, sync, updateTime: doc.updateTime ?? null });
      const prev = into.get(entity.id);
      if (!prev || entity.rev >= prev.rev) into.set(entity.id, entity);
    }
  };
  read('project', remote.projects, projectDocs);
  read('note', remote.notes, noteDocs);
  return remote;
}

// ---- encoding for commits (whole documents; _sync.at is a REQUEST_TIME transform)

function syncMap(kind, entity, sync, deleted) {
  const s = { rev: sync.rev, key: sync.key ?? entity.key, deleted, by: sync.by ?? '' };
  if (kind === 'note') {
    s.project = sync.project ?? entity.project;
    s.list = sync.list ?? entity.list;
  }
  const id = sync.id ?? entity.id;
  if (typeof id === 'string' && codec().docId(id) !== id) s.id = id;
  return s;
}

function encodeProject(entity, sync = {}) {
  const c = codec();
  const { fields } = c.encodeFields(synced(isObj(entity.fields) ? entity.fields : {}), { skip: SKIP });
  fields._sync = c.toValue(syncMap('project', entity, sync, false));
  return fields;
}

function encodeNote(entity, sync = {}) {
  const c = codec();
  const { fields } = c.encodeFields(synced(isObj(entity.fields) ? entity.fields : {}), { skip: SKIP });
  fields.copied = c.toValue(num(entity.copied));
  fields.lastCopiedAt = c.toValue(num(entity.lastCopiedAt));
  fields._sync = c.toValue(syncMap('note', entity, sync, false));
  return fields;
}

// sync: { rev, key, by, project?, list?, id? }; project and list are kept on note tombstones.
function tombstoneFields(sync = {}) {
  const s = { rev: sync.rev, key: sync.key, deleted: true, by: sync.by ?? '' };
  if (sync.project != null) s.project = sync.project;
  if (sync.list != null) s.list = sync.list;
  if (typeof sync.id === 'string' && codec().docId(sync.id) !== sync.id) s.id = sync.id;
  return { _sync: codec().toValue(s) };
}

// ---- comparing

// Canonical JSON with sorted keys: equal values give equal strings, whatever the key order.
function fieldsSig(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : fieldsSig(v))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${fieldsSig(value[k])}`).join(',')}}`;
}

// ---- the shadow (sync/shadow.json, 3.5), read defensively into maps

function shadowEntry(kind, e) {
  const entry = { f: isObj(e.f) ? e.f : {}, k: str(e.k), r: int(e.r), u: e.u ?? null, d: e.d === true, i: str(e.i) };
  if (kind === 'notes') {
    entry.p = str(e.p);
    entry.l = LISTS.includes(e.l) ? e.l : 'notes';
    entry.c = num(e.c);
    entry.lc = num(e.lc);
  }
  return entry;
}

function shadowView(shadow) {
  const s = isObj(shadow) ? shadow : {};
  const view = {
    rev: int(s.rev),
    board: { joiner: isObj(s.board) && typeof s.board.joiner === 'string' ? s.board.joiner : null },
    projects: new Map(),
    notes: new Map(),
  };
  for (const kind of ['projects', 'notes']) {
    const src = s[kind] instanceof Map ? Object.fromEntries(s[kind]) : isObj(s[kind]) ? s[kind] : {};
    for (const id of Object.keys(src)) if (isObj(src[id])) view[kind].set(id, shadowEntry(kind, src[id]));
  }
  return view;
}

// ---- pristine Welcome (5.9): computed from the structure, never from the tip texts

const emptyList = (v) => v === undefined || (Array.isArray(v) && v.length === 0);

function isPristineWelcome(project) {
  if (!isObj(project) || project.name !== 'Welcome' || project.color !== 'monstera') return false;
  if (!emptyList(project.used) || !emptyList(project.combined)) return false;
  if (!(project.draft === undefined || project.draft === '') || !emptyList(project.draftImages)) return false;
  const notes = project.notes;
  if (!Array.isArray(notes) || notes.length !== 10 || !Number.isFinite(project.createdAt)) return false;
  // The seed stamps the project just before its ten notes, in the same moment.
  return notes.every((n) => isObj(n)
    && typeof n.text === 'string'
    && emptyList(n.images)
    && n.copied === 0 && n.lastCopiedAt === 0 && n.usedAt === 0
    && n.highlight == null
    && Number.isFinite(n.createdAt) && n.updatedAt === n.createdAt
    && Math.abs(project.createdAt - n.createdAt) <= 2000);
}

// One project in the data file's shape, from a model or from the account's documents (Remote).
function projectShape(board, pid) {
  const e = board.projects.get(pid);
  if (!e || e.deleted) return null;
  const isModel = Array.isArray(board.columns);
  const notesOf = (list) => {
    if (isModel) return (board.lists.get(listKey(pid, list)) || []).map((id) => board.notes.get(id));
    return [...board.notes.values()].filter((n) => !n.deleted && n.project === pid && n.list === list).sort(compareKeyed);
  };
  // Drafts never reach the account; a model only knows whether one is empty.
  const project = { ...e.fields, id: pid, draft: e.draftEmpty === false ? '(draft)' : '', draftImages: [] };
  for (const list of LISTS) project[list] = notesOf(list).map((n) => ({ ...n.fields, copied: n.copied, lastCopiedAt: n.lastCopiedAt }));
  return project;
}

function boardProjects(board) {
  const pids = Array.isArray(board.columns) ? board.columns : [...board.projects.keys()];
  return pids.map((pid) => projectShape(board, pid)).filter(Boolean);
}

// Exactly one project, and it is a pristine Welcome. Takes a data file, a model or a Remote.
function isPristineBoard(board) {
  if (!isObj(board)) return false;
  if (Array.isArray(board.projects)) {
    const projects = board.projects.filter((p) => p && typeof p === 'object');
    return projects.length === 1 && isPristineWelcome(projects[0]);
  }
  if (!(board.projects instanceof Map) || !(board.notes instanceof Map)) return false;
  if (board.skipped instanceof Set && board.skipped.size) return false;
  const projects = boardProjects(board);
  if (projects.length !== 1 || !isPristineWelcome(projects[0])) return false;
  for (const n of board.notes.values()) if (!n.deleted && n.project !== projects[0].id) return false;
  return true;
}

// Live projects, notes and distinct pictures in a model, the account's documents or a shadow.
function countLive(state) {
  let projects = 0;
  let notes = 0;
  const images = new Set();
  const each = (coll, fn) => {
    if (coll instanceof Map) coll.forEach((e) => fn(e));
    else if (isObj(coll)) for (const k of Object.keys(coll)) fn(coll[k]);
  };
  const live = (e) => isObj(e) && e.deleted !== true && e.d !== true;
  each(state?.projects, (e) => { if (live(e)) projects++; });
  each(state?.notes, (e) => {
    if (!live(e)) return;
    notes++;
    const f = isObj(e.fields) ? e.fields : isObj(e.f) ? e.f : {};
    for (const i of Array.isArray(f.images) ? f.images : []) if (i && typeof i.id === 'string') images.add(i.id);
  });
  return { projects, notes, images: images.size };
}

module.exports = {
  LISTS, listKey, cleanImages, projectFields, noteFields, toModel, fromDocs, remoteEntity, fieldsSig,
  encodeProject, encodeNote, tombstoneFields, isPristineWelcome, isPristineBoard, countLive, shadowView, projectShape,
};
