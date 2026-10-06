'use strict';
// Brings the account's changes (remote) into this computer's board (local) (ai_memory/15, 5.7).
// Three ways with the shadow as the base, or two ways where there is none (union and restore
// modes, and the first sign-in). The result is the patch for the page, plus the shadow entries
// to commit once the page has saved it: the remote state, never the merged one, so whatever
// this computer won is pushed afterwards like any local change. The same inputs always give
// the same result, conflict-copy ids included.

const crypto = require('node:crypto');
const { compareKeyed } = require('./keys');
const model = require('./model');
const { localKeys } = require('./diff');

const { LISTS, listKey, fieldsSig } = model;
const NO_BASE = '\u0000no base';
const ABSENT = '\u0000absent';
const NOTE_KNOWN = new Set(['text', 'images', 'createdAt', 'updatedAt', 'usedAt', 'highlight', 'syncConflict']);
const PLATFORMS = ['darwin', 'win32', 'linux'];
const RECOVERED = 'Recovered notes';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const nonEmpty = (o) => isObj(o) && Object.keys(o).length > 0;
const valSig = (v) => (v === undefined ? ABSENT : fieldsSig(v));
const contentSig = (f) => fieldsSig({ text: own(f, 'text') ?? null, images: own(f, 'images') ?? null });
const posSig = (v) => fieldsSig({ p: v.project ?? null, l: v.list ?? null, k: v.key ?? null, u: own(v.fields, 'usedAt') ?? null });
const sameArray = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  else obj[k] = v;
  return obj;
}

const copyFields = (f) => Object.keys(f).reduce((out, k) => put(out, k, f[k]), {});

function fieldKeys(...objs) {
  const keys = new Set();
  for (const o of objs) if (isObj(o)) for (const k of Object.keys(o)) keys.add(k);
  return keys;
}

// Which value a register takes: 'same' (nobody changed it, or both alike), 'l' or 'r' (only
// that side changed it), 'both' (changed differently on each side).
function side(sb, sl, sr) {
  if (sl === sr) return 'same';
  if (sl === sb) return 'r';
  if (sr === sb) return 'l';
  return 'both';
}

// One version of an entity, whichever side it comes from.
const fromShadow = (e) => e && {
  alive: !e.d, fields: e.f, key: e.k, project: e.p, list: e.l, copied: num(e.c), lastCopiedAt: num(e.lc), by: '', docId: e.i,
};
const fromRemote = (d) => ({
  alive: d.deleted !== true, fields: isObj(d.fields) ? d.fields : {}, key: d.key, project: d.project, list: d.list,
  copied: num(d.copied), lastCopiedAt: num(d.lastCopiedAt), by: d.by || '', docId: d.docId,
});
const fromLocal = (e, key) => ({
  alive: true, fields: e.fields, key, project: e.project, list: e.list, copied: num(e.copied), lastCopiedAt: num(e.lastCopiedAt),
  hasDraft: Boolean(e.hasDraft),
});

function asMap(v) {
  if (v instanceof Map) return v;
  const m = new Map();
  if (Array.isArray(v)) for (const d of v) { if (isObj(d) && typeof d.id === 'string') m.set(d.id, d); }
  else if (isObj(v)) for (const k of Object.keys(v)) m.set(k, v[k]);
  return m;
}

function remoteView(remote) {
  const r = isObj(remote) ? remote : {};
  return {
    rev: Number.isSafeInteger(r.rev) ? r.rev : 0,
    minRev: Number.isSafeInteger(r.minRev) ? r.minRev : 0,
    board: isObj(r.board) ? { joiner: typeof r.board.joiner === 'string' ? r.board.joiner : null } : null,
    projects: asMap(r.projects),
    notes: asMap(r.notes),
  };
}

// A trash copy: the document ({ data: JSON text }), its JSON text, or already-parsed fields.
function trashFields(t) {
  try {
    const v = typeof t === 'string' ? JSON.parse(t) : isObj(t) && typeof t.data === 'string' ? JSON.parse(t.data)
      : isObj(t) && isObj(t.fields) ? t.fields : t;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

// DeviceRef for a writer's device id (6.5 names it "your Mac", "your other PC", …).
function deviceRefs(devices, deviceId, platform) {
  const known = asMap(devices);
  const platformOf = (id) => {
    const p = isObj(known.get(id)) ? known.get(id).platform : null;
    return PLATFORMS.includes(p) ? p : null;
  };
  const here = PLATFORMS.includes(platform) ? platform : platformOf(deviceId);
  return (by) => {
    const p = platformOf(by);
    return { platform: p, sameAsThis: p !== null && p === here };
  };
}

// The id a conflict copy gets, from its own text and pictures: repeating a merge repeats it.
function conflictId(id, fields) {
  const images = Array.isArray(fields.images) ? fields.images.map((i) => (isObj(i) ? i.id : '')).join(',') : '';
  const text = typeof fields.text === 'string' ? fields.text : '';
  return `${id}-c${crypto.createHash('sha256').update(`${text}\n${images}`).digest('hex').slice(0, 8)}`;
}

// A note's change that outweighs a delete on the other side: its text, pictures or a field
// this version doesn't know. Moves, highlights and copies never do.
function significantNote(x, b) {
  if (contentSig(x.fields) !== contentSig(b.fields)) return true;
  for (const k of fieldKeys(x.fields, b.fields)) if (!NOTE_KNOWN.has(k) && valSig(own(x.fields, k)) !== valSig(own(b.fields, k))) return true;
  return false;
}

// For projects: the name, the colour or an unknown field.
function significantProject(x, b) {
  for (const k of fieldKeys(x.fields, b.fields)) if (k !== 'createdAt' && valSig(own(x.fields, k)) !== valSig(own(b.fields, k))) return true;
  return false;
}

// The shadow entry for a document as the account has it. A tombstone keeps the fields its
// entity last had here, so a later undelete can be told apart from an edit.
function entryOf(kind, d, prev) {
  const deleted = d.deleted === true;
  const e = {
    f: deleted ? (prev && nonEmpty(prev.f) ? prev.f : {}) : isObj(d.fields) ? d.fields : {},
    k: String(d.key ?? ''), r: Number.isSafeInteger(d.rev) ? d.rev : 0, u: d.updateTime ?? null, d: deleted, i: String(d.docId ?? ''),
  };
  if (kind === 'notes') {
    Object.assign(e, { p: d.project, l: d.list, c: deleted ? num(prev?.c) : num(d.copied), lc: deleted ? num(prev?.lc) : num(d.lastCopiedAt) });
  }
  return e;
}

// Every document in `remote` as shadow entries (a ShadowDelta).
function shadowDelta(remote, shadow = null) {
  const r = remoteView(remote);
  const base = model.shadowView(shadow);
  const delta = { rev: r.rev, projects: {}, notes: {} };
  if (r.board) delta.board = { joiner: r.board.joiner };
  for (const [id, d] of r.projects) put(delta.projects, id, entryOf('projects', d, base.projects.get(id)));
  for (const [id, d] of r.notes) put(delta.notes, id, entryOf('notes', d, base.notes.get(id)));
  return delta;
}

// ShadowDelta = { rev, board?, projects: { [id]: entry | null }, notes: { [id]: entry | null } };
// null drops the entry. Takes the shadow as sync/shadow.json holds it (or as model.shadowView
// reads it, with maps) and returns a new one in the shadow.json shape.
function applyShadowDelta(shadow, delta) {
  const s = isObj(shadow) ? shadow : {};
  const entries = (v) => (v instanceof Map ? copyFields(Object.fromEntries(v)) : isObj(v) ? copyFields(v) : {});
  const out = {
    version: 1,
    uid: s.uid ?? null,
    rev: Number.isSafeInteger(s.rev) ? s.rev : 0,
    board: { joiner: isObj(s.board) && typeof s.board.joiner === 'string' ? s.board.joiner : null },
    projects: entries(s.projects),
    notes: entries(s.notes),
  };
  if (!isObj(delta)) return out;
  if (Number.isSafeInteger(delta.rev) && delta.rev > 0) out.rev = delta.rev;
  if (isObj(delta.board)) out.board = { joiner: typeof delta.board.joiner === 'string' ? delta.board.joiner : null };
  for (const kind of ['projects', 'notes']) {
    const src = isObj(delta[kind]) ? delta[kind] : {};
    for (const id of Object.keys(src)) {
      if (src[id] === null) delete out[kind][id];
      else put(out[kind], id, src[id]);
    }
  }
  return out;
}

// mergeRemote({ shadow, local, remote, mode, trash, devices, deviceId, now,
//               platform?, seeded?, stale?, full?, minRev?, held? }) → { patch, shadowAfter, notices, backupFirst }
//   local: toModel(L_disk). remote: fromDocs(…) of the pulled documents, or of all of them for the
//   first sign-in (combine, use-account) and with `full` (minRev resync). With nothing new it
//   is { rev, board } and empty maps: union and restore still need that merge, to add back what
//   is missing here. trash: Map id → trash document ({ data }), see neededTrash. devices: Map
//   deviceId → { platform }. seeded: the page reseeded over an unreadable file. stale: the
//   file is a .bak, older than the shadow. patch is the Patch of 5.8 without id, session and
//   basedOnContentSeq, or null; it is also sent (changesContent false) when only notices remain.
//   held: ids of notes whose version here the account hasn't seen and can't take yet (held with a project it
//   doesn't have, refused, too large): a delete in the account doesn't remove them, as for a change made here.
//   shadowAfter is a ShadowDelta for applyShadowDelta, committed once the page has saved it.
function mergeRemote(opts = {}) {
  const mode = opts.mode || 'normal';
  const combine = mode === 'combine';
  const useAccount = mode === 'use-account';
  const first = combine || useAccount;
  const restore = mode === 'restore';
  const normal = mode === 'normal';
  const deviceId = String(opts.deviceId || '');
  const now = Number.isFinite(opts.now) ? opts.now : 0;
  const local = opts.local && opts.local.notes instanceof Map ? opts.local : model.toModel(opts.local);
  const base = model.shadowView(first ? null : opts.shadow); // the first sign-in has no base
  const remote = remoteView(opts.remote);
  const trash = new Map([...asMap(opts.trash)].map(([id, t]) => [id, trashFields(t)]).filter(([, f]) => f));
  const deviceRef = deviceRefs(opts.devices, deviceId, opts.platform);
  const held = first ? new Set() : new Set(opts.held instanceof Set || Array.isArray(opts.held) ? opts.held : []);
  const keys = localKeys(local, base, { rekey: false });
  // Without a base, position and other fields go to the account, except when restoring.
  const noBaseWins = restore ? 'l' : 'r';
  // `stale` (union only): this computer's file may be older than the shadow (a .bak), so a
  // difference from the base may be staleness rather than an edit. The account's value then
  // stays, and a text that differs is kept as a copy instead of being pushed over the newer one.
  // A restore is the opposite: the restored board is meant to win.
  const stale = Boolean(opts.stale) && mode === 'union';
  const pick = (s, bb) => (s === 'same' ? 'r' : s === 'both' ? (bb ? 'l' : noBaseWins) : s === 'l' && stale && bb ? 'r' : s);

  // A full listing (minRev resync, 5.11): shadow entries the cloud lacks are tombstones at or
  // below minRev, and are otherwise forgotten, so this computer's copies upload again.
  const dropped = { projects: new Set(), notes: new Set() };
  const synthetic = { projects: new Map(), notes: new Map() };
  if (opts.full && !first) {
    const minRev = Number.isSafeInteger(opts.minRev) ? opts.minRev : remote.minRev;
    for (const kind of ['projects', 'notes']) {
      for (const [id, b] of base[kind]) {
        if (remote[kind].has(id)) continue;
        dropped[kind].add(id);
        if (!b.d && b.r <= minRev) synthetic[kind].set(id, { ...fromShadow(b), alive: false, fields: {} });
      }
    }
  }
  // A pulled document this computer wrote is a commit its shadow missed (a lost response, or a
  // crash before shadow.json was saved; 5.5 step 13, 5.18). It is what the shadow would hold
  // after that commit, so it is the base: whatever differs here was changed here since, and
  // its copy count already includes this computer's copies.
  const echoes = !first && deviceId !== '';
  const baseOf = (kind, id) => {
    const d = remote[kind].get(id);
    if (echoes && d && d.by === deviceId) return fromShadow(entryOf(kind, d, base[kind].get(id)));
    return dropped[kind].has(id) && !synthetic[kind].has(id) ? null : fromShadow(base[kind].get(id)) || null;
  };
  const remoteOf = (kind, id) => (remote[kind].has(id) ? fromRemote(remote[kind].get(id)) : synthetic[kind].get(id) || null);
  const usable = (b) => (b && (b.alive || nonEmpty(b.fields)) ? b : null);
  const aliveSomewhere = (kind, id) => (remoteOf(kind, id) || baseOf(kind, id) || { alive: false }).alive;

  // This computer's pristine Welcome is removed rather than uploaded: when combining, and when
  // the page reseeded over an unreadable file and the account has a board to restore.
  const drop = new Set();
  const accountHasBoard = [...new Set([...base.projects.keys(), ...remote.projects.keys()])].some((id) => aliveSomewhere('projects', id));
  if (combine || (mode === 'union' && opts.seeded && accountHasBoard)) {
    for (const pid of local.columns) {
      if (base.projects.has(pid) || remote.projects.has(pid) || !model.isPristineWelcome(model.projectShape(local, pid))) continue;
      const ids = LISTS.flatMap((l) => local.lists.get(listKey(pid, l)) || []);
      if (ids.some((id) => base.notes.has(id) || remote.notes.has(id))) continue;
      drop.add(pid);
      for (const id of ids) drop.add(id);
    }
  }

  const merged = new Map(); // live notes after the merge
  const copies = [];        // conflict copies: { after, note }
  const copyIds = new Set();
  const keptBy = new Map(); // KEPT_NOTE counts per device
  const removedBy = new Map();
  const projectNotices = [];
  const count = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  const takeLocal = (id, l, localOnly) => ({
    id, fields: l.fields, project: l.project, list: l.list, key: l.key, copied: l.copied, lastCopiedAt: l.lastCopiedAt, from: 'l', localOnly,
  });
  const takeRemote = (id, r) => ({
    id, fields: r.fields, project: r.project, list: r.list, key: r.key, copied: r.copied, lastCopiedAt: r.lastCopiedAt, from: 'r', localOnly: false,
  });

  function addCopy(id, original, src, device) {
    const firstId = conflictId(id, src.fields);
    let cid = firstId;
    for (let n = 2; ; n++) {
      const other = local.notes.get(cid) || (remote.notes.get(cid)?.deleted === false ? remote.notes.get(cid) : null);
      if (other && contentSig(other.fields) === contentSig(src.fields)) return; // this copy exists already
      const taken = other || copyIds.has(cid) || local.projects.has(cid) || local.skipped.has(cid)
        || base.notes.has(cid) || base.projects.has(cid) || remote.notes.has(cid) || remote.projects.has(cid);
      if (!taken) break;
      cid = `${firstId}-${n}`;
    }
    const fields = copyFields(src.fields);
    put(fields, 'highlight', own(src.fields, 'highlight') ?? 'amber');
    put(fields, 'syncConflict', { of: id, device, at: now });
    copyIds.add(cid);
    copies.push({ after: id, note: { id: cid, fields, project: original.project, list: original.list, key: null, copied: 0, lastCopiedAt: 0, from: 'copy' } });
  }

  // Both sides have the note alive: every register on its own.
  function mergeLive(id, l, r, bb) {
    const f = {};
    const setField = (k, v) => { if (v !== undefined) put(f, k, v); };
    // Content: text and pictures together; updatedAt follows the winner.
    let cs = side(bb ? contentSig(bb.fields) : NO_BASE, contentSig(l.fields), contentSig(r.fields));
    if (cs === 'l' && stale && bb) cs = 'both';
    let cw = cs === 'same' ? 'r' : cs;
    let copyFrom = null;
    if (cs === 'both') {
      cw = !bb && restore ? 'l' : 'r';
      if (!useAccount) copyFrom = cw === 'r' ? l : r;
    }
    const cv = cw === 'l' ? l : r;
    setField('text', own(cv.fields, 'text'));
    setField('images', own(cv.fields, 'images'));
    if (cs !== 'same') setField('updatedAt', own(cv.fields, 'updatedAt'));
    // Position: project, list, key and usedAt.
    const pv = pick(side(bb ? posSig(bb) : NO_BASE, posSig(l), posSig(r)), bb) === 'l' ? l : r;
    setField('usedAt', own(pv.fields, 'usedAt'));
    // Every other field on its own.
    for (const k of fieldKeys(l.fields, r.fields, bb && bb.fields)) {
      if (k === 'text' || k === 'images' || k === 'usedAt' || (k === 'updatedAt' && cs !== 'same')) continue;
      const s = side(bb ? valSig(own(bb.fields, k)) : NO_BASE, valSig(own(l.fields, k)), valSig(own(r.fields, k)));
      setField(k, own((pick(s, bb) === 'l' ? l : r).fields, k));
    }
    const m = {
      id, fields: f, project: pv.project, list: pv.list, key: pv.key,
      copied: bb ? r.copied + Math.max(0, l.copied - bb.copied) : Math.max(l.copied, r.copied),
      lastCopiedAt: Math.max(l.lastCopiedAt, r.lastCopiedAt),
      from: 'merge', localOnly: false,
    };
    if (copyFrom) addCopy(id, m, copyFrom, copyFrom === l ? deviceId : r.by);
    return m;
  }

  // ---- notes
  const noteIds = new Set([...local.notes.keys(), ...base.notes.keys(), ...remote.notes.keys(), ...synthetic.notes.keys()]);
  for (const id of noteIds) {
    if (drop.has(id)) continue;
    const le = local.notes.get(id);
    const l = le ? fromLocal(le, keys.get(id)) : null;
    const skipped = !le && local.skipped.has(id);
    const b = baseOf('notes', id);
    const rd = remoteOf('notes', id);
    const r = rd || b; // not in this pull: unchanged since the base
    const bb = usable(b);
    let m = null;
    if (l && r && r.alive) {
      m = mergeLive(id, l, r, first ? null : bb);
    } else if (l && r) { // deleted in the account
      if (useAccount) m = null;
      // Held here (moved into a project the account doesn't have yet, refused, too large): the account deleted the
      // version it had (with the column it was in there, say), never this one. A change made here, only held back.
      else if (restore || held.has(id)) m = takeLocal(id, l, true);
      else if (normal && b && b.alive) m = significantNote(l, b) ? takeLocal(id, l, true) : null;
      else if (normal && b) m = takeLocal(id, l, true); // brought back here after the delete
      else if (bb) m = fieldsSig(l.fields) === fieldsSig(bb.fields) ? null : takeLocal(id, l, true);
      else m = trash.get(id) && contentSig(l.fields) === contentSig(trash.get(id)) ? null : takeLocal(id, l, true);
      if (!m) count(removedBy, r.by);
    } else if (l) { // the account never had it
      m = useAccount ? null : takeLocal(id, l, true);
    } else if (r && r.alive) { // missing here
      if (!normal || skipped || !b) {
        m = takeRemote(id, r);
      } else if (b.alive) {
        // Deleted here: an edit there outweighs it; anything else, and the tombstone goes up.
        if (rd && significantNote(r, b)) {
          m = takeRemote(id, r);
          count(keptBy, r.by);
        }
      } else {
        m = takeRemote(id, r); // brought back there after the delete
        const last = nonEmpty(b.fields) ? b.fields : trash.get(id);
        if (rd && last && r.by !== deviceId && contentSig(r.fields) !== contentSig(last)) count(keptBy, r.by);
      }
    }
    if (m) merged.set(id, m);
  }

  // ---- projects
  const needed = new Set([...merged.values(), ...copies.map((c) => c.note)].map((n) => n.project));
  const projects = new Map();
  const takeLocalProject = (id, l, localOnly) => ({ id, fields: l.fields, key: l.key, from: 'l', localOnly });
  const takeRemoteProject = (id, r) => ({ id, fields: r.fields, key: r.key, from: 'r', localOnly: false });
  const projectIds = new Set([...local.projects.keys(), ...base.projects.keys(), ...remote.projects.keys(), ...synthetic.projects.keys()]);
  for (const id of projectIds) {
    if (drop.has(id)) continue;
    const le = local.projects.get(id);
    const l = le ? fromLocal(le, keys.get(id)) : null;
    const skipped = !le && local.skipped.has(id);
    const b = baseOf('projects', id);
    const rd = remoteOf('projects', id);
    const r = rd || b;
    const bb = usable(b);
    let m = null;
    if (l && r && r.alive) {
      const base2 = first ? null : bb;
      const f = {};
      for (const k of fieldKeys(l.fields, r.fields, base2 && base2.fields)) {
        const s = side(base2 ? valSig(own(base2.fields, k)) : NO_BASE, valSig(own(l.fields, k)), valSig(own(r.fields, k)));
        const v = own((pick(s, base2) === 'l' ? l : r).fields, k);
        if (v !== undefined) put(f, k, v);
      }
      const key = pick(side(base2 ? base2.key : NO_BASE, l.key, r.key), base2) === 'l' ? l.key : r.key;
      m = { id, fields: f, key, from: 'merge', localOnly: false };
    } else if (l && r) { // deleted in the account
      const hold = needed.has(id) || l.hasDraft;
      if (useAccount) m = null;
      else if (restore) m = takeLocalProject(id, l, true);
      else if (normal && b && b.alive) {
        const changed = significantProject(l, b);
        if (hold || changed) {
          m = takeLocalProject(id, l, true);
          const code = needed.has(id) || changed ? 'KEPT_PROJECT' : 'KEPT_PROJECT_DRAFT';
          projectNotices.push({ code, name: String(own(l.fields, 'name') ?? ''), device: deviceRef(r.by) });
        }
      } else if (normal && b) m = takeLocalProject(id, l, true);
      else if (bb) m = hold || fieldsSig(l.fields) !== fieldsSig(bb.fields) ? takeLocalProject(id, l, true) : null;
      else m = hold || !(trash.get(id) && fieldsSig(l.fields) === fieldsSig(trash.get(id))) ? takeLocalProject(id, l, true) : null;
      if (!m) count(removedBy, r.by);
    } else if (l) {
      m = useAccount ? null : takeLocalProject(id, l, true);
    } else if (r && r.alive) {
      if (!normal || skipped || !b || !b.alive) m = takeRemoteProject(id, r);
      else if ((rd && significantProject(r, b)) || needed.has(id)) m = takeRemoteProject(id, r); // deleted here, but changed there
    }
    if (m) projects.set(id, m);
  }

  // A live note whose project isn't: bring the project back from here, the shadow or the
  // trash, or as "Recovered notes" after the last column.
  for (const pid of needed) {
    if (projects.has(pid)) continue;
    const le = drop.has(pid) ? null : local.projects.get(pid);
    const rd = remote.projects.get(pid);
    const b = usable(fromShadow(base.projects.get(pid)));
    let m;
    if (le) m = takeLocalProject(pid, fromLocal(le, keys.get(pid)), false);
    else if (rd && rd.deleted !== true) m = takeRemoteProject(pid, fromRemote(rd));
    else if (b) m = { id: pid, fields: b.fields, key: b.key, from: 'b', localOnly: false };
    else if (trash.get(pid)) m = { id: pid, fields: model.projectFields(trash.get(pid)), key: null, append: true };
    else m = { id: pid, fields: { name: RECOVERED, color: 'monstera', createdAt: now }, key: null, append: true };
    projects.set(pid, m);
    projectNotices.push({ code: 'KEPT_PROJECT', name: String(own(m.fields, 'name') ?? ''), device: deviceRef(rd ? rd.by : '') });
  }

  // ---- order: by key; at the first sign-in this computer's own things go after the account's
  const localPos = new Map();
  local.columns.forEach((id, i) => localPos.set(id, i));
  for (const ids of local.lists.values()) ids.forEach((id, i) => localPos.set(id, i));
  const byLocal = (a, b) => (localPos.get(a.id) ?? 0) - (localPos.get(b.id) ?? 0);
  const trailing = (m) => combine && m.localOnly;
  const cols = [...projects.values()];
  const order = [
    ...cols.filter((m) => !m.append && !trailing(m)).sort(compareKeyed),
    ...cols.filter((m) => !m.append && trailing(m)).sort(byLocal),
    ...cols.filter((m) => m.append),
  ].map((m) => m.id);

  const groups = new Map();
  for (const m of merged.values()) {
    const lk = listKey(m.project, m.list);
    if (!groups.has(lk)) groups.set(lk, []);
    groups.get(lk).push(m);
  }
  const lists = new Map();
  for (const [lk, ms] of groups) {
    lists.set(lk, [
      ...ms.filter((m) => !trailing(m)).sort(compareKeyed),
      ...ms.filter(trailing).sort(byLocal),
    ].map((m) => m.id));
  }
  const noteOf = new Map(merged);
  for (const { after, note } of copies) {
    const lk = listKey(note.project, note.list);
    if (!lists.has(lk)) lists.set(lk, []);
    const ids = lists.get(lk);
    const at = ids.indexOf(after);
    ids.splice(at < 0 ? ids.length : at + 1, 0, note.id);
    noteOf.set(note.id, note);
  }

  // ---- the patch
  const patch = {
    changesContent: false,
    resetHistory: false,
    projects: { upsert: {}, remove: [], order: null },
    notes: { upsert: {}, remove: [], counters: {} },
    lists: {},
    notices: [],
  };
  for (const id of order) {
    const m = projects.get(id);
    const le = local.projects.get(id);
    if (!le || fieldsSig(m.fields) !== fieldsSig(le.fields)) put(patch.projects.upsert, id, { fields: m.fields });
  }
  for (const id of local.columns) if (!projects.has(id)) patch.projects.remove.push(id);
  // An order is sent when something arrives or moves; losing members alone needs none.
  const stayingColumns = local.columns.filter((id) => projects.has(id));
  if (order.some((id) => !local.projects.has(id)) || !sameArray(stayingColumns, order)) patch.projects.order = order;

  for (const pid of order) {
    const touched = {};
    for (const list of LISTS) {
      const ids = lists.get(listKey(pid, list)) || [];
      for (const id of ids) {
        const m = noteOf.get(id);
        const le = local.notes.get(id);
        if (!le || fieldsSig(m.fields) !== fieldsSig(le.fields) || le.project !== pid || le.list !== list) {
          put(patch.notes.upsert, id, { fields: m.fields, project: pid, list });
        }
        // Copy counts travel as deltas, so copies made on the page meanwhile add up. The delta
        // lifts this computer's count to the merged one: max(0, remote − base) whenever the count
        // here is at least the base's, and never lower than the account's after a restore or a
        // stale .bak, whose older counts would otherwise be pushed over the account's.
        if (m.from === 'copy' || m.from === 'l') continue;
        const delta = Math.max(0, m.copied - (le ? le.copied : 0));
        const later = m.lastCopiedAt > (le ? le.lastCopiedAt : 0);
        if (delta > 0 || later) put(patch.notes.counters, id, { copiedDelta: delta, lastCopiedAt: m.lastCopiedAt });
      }
      const staying = (local.lists.get(listKey(pid, list)) || []).filter((id) => {
        const m = noteOf.get(id);
        return m && m.project === pid && m.list === list;
      });
      const arriving = ids.some((id) => {
        const le = local.notes.get(id);
        return !le || le.project !== pid || le.list !== list;
      });
      if (arriving || !sameArray(staying, ids)) touched[list] = ids;
    }
    if (Object.keys(touched).length) put(patch.lists, pid, touched);
  }
  for (const id of local.notes.keys()) if (!noteOf.has(id)) patch.notes.remove.push(id);

  // "Join notes with": a value never set here is no opinion.
  const bj = base.board.joiner;
  const lj = local.board.joiner ?? bj;
  const rj = remote.board ? remote.board.joiner : bj;
  let joiner;
  if (first) joiner = rj ?? lj;
  else {
    const s = side(valSig(bj), valSig(lj), valSig(rj));
    joiner = s === 'l' || s === 'both' ? lj : rj;
  }
  if (joiner !== local.board.joiner) patch.board = { joiner };

  // ---- notices, and a backup before large incoming deletes (5.6)
  const removedNotes = patch.notes.remove.filter((id) => !drop.has(id)).length;
  const removedFullProject = patch.projects.remove.some((pid) => !drop.has(pid)
    && LISTS.some((l) => (local.lists.get(listKey(pid, l)) || []).length > 0));
  const backupFirst = !first && (removedNotes >= 10 || removedFullProject);
  const notices = [];
  if (drop.size && !combine) notices.push({ code: 'RESTORED_FROM_ACCOUNT' });
  if (combine) {
    notices.push({
      code: 'COMBINED',
      a: [...remote.projects.values()].filter((d) => d.deleted !== true).length,
      b: cols.filter((m) => m.localOnly && m.from === 'l').length,
    });
  }
  if (useAccount) {
    const blank = (board) => model.countLive(board).projects === 0 || model.isPristineBoard(board);
    if (!(blank(local) && blank(remote))) notices.push({ code: 'USED_ACCOUNT' });
  }
  if (backupFirst) {
    const by = [...removedBy].sort((a, c) => c[1] - a[1] || (a[0] < c[0] ? -1 : 1))[0]?.[0] ?? '';
    notices.push({ code: 'REMOTE_DELETES', count: removedNotes, device: deviceRef(by) });
  }
  if (copies.length) notices.push({ code: 'CONFLICT', count: copies.length });
  notices.push(...projectNotices);
  for (const [by, n] of keptBy) notices.push({ code: 'KEPT_NOTE', count: n, device: deviceRef(by) });

  patch.changesContent = Object.keys(patch.projects.upsert).length > 0 || patch.projects.remove.length > 0
    || patch.projects.order !== null || Object.keys(patch.notes.upsert).length > 0 || patch.notes.remove.length > 0
    || Object.keys(patch.lists).length > 0 || Boolean(patch.board);
  patch.resetHistory = patch.changesContent || first;
  patch.notices = notices;

  const shadowAfter = shadowDelta(remote, first ? null : opts.shadow);
  for (const kind of ['projects', 'notes']) for (const id of dropped[kind]) put(shadowAfter[kind], id, null);

  const nothing = !patch.changesContent && !Object.keys(patch.notes.counters).length && !notices.length && !first;
  return { patch: nothing ? null : patch, shadowAfter, notices, backupFirst };
}

// Trash copies mergeRemote would consult, so the engine can batchGet them first: a local
// entity the account deleted with no base to compare, a note undeleted there over a tombstone
// whose fields are unknown here, and projects of live notes that are nowhere alive.
function neededTrash({ shadow, local, remote, mode = 'normal' } = {}) {
  if (mode === 'restore' || mode === 'use-account') return [];
  const first = mode === 'combine';
  const base = model.shadowView(first ? null : shadow);
  const r = remoteView(remote);
  const m = local && local.notes instanceof Map ? local : model.toModel(local);
  const out = [];
  const add = (kind, id, docId) => out.push({ kind, id, docId: docId || '' });
  for (const [kind, one] of [['projects', 'project'], ['notes', 'note']]) {
    for (const [id, d] of r[kind]) {
      const b = base[kind].get(id);
      const known = b && (!b.d || nonEmpty(b.f));
      if (d.deleted === true && m[kind].has(id) && !known) add(one, id, d.docId);
      else if (kind === 'notes' && mode === 'normal' && d.deleted !== true && !m.notes.has(id) && b && b.d && !nonEmpty(b.f)) add(one, id, d.docId);
    }
  }
  const alive = (id) => m.projects.has(id) || (r.projects.has(id) ? r.projects.get(id).deleted !== true : Boolean(base.projects.get(id) && !base.projects.get(id).d));
  const wanted = new Set();
  for (const d of r.notes.values()) if (d.deleted !== true && !alive(d.project)) wanted.add(d.project);
  for (const pid of wanted) if (!(base.projects.get(pid) && nonEmpty(base.projects.get(pid).f))) add('project', pid, r.projects.get(pid)?.docId);
  return out;
}

module.exports = { mergeRemote, shadowDelta, applyShadowDelta, neededTrash, conflictId };
