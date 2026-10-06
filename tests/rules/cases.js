'use strict';
// Shared security-rules cases (ai_memory/15_accounts_and_sync.md, 7.3 layer 1). Two consumers must reach the
// same verdict on every case: the GCP mock's rules twin (tests/mock-gcp/rules.js, checked by
// tests/unit/rules-twin.test.js) and the Rules API runner (infra/scripts/rules-test.js, npm run rules:test),
// which evaluates the real texts in infra/firebase/*.rules.
//
// A case is a plain object with exactly these ten keys, all required:
//   name      a unique string.
//   service   'firestore' | 'storage'.
//   method    'get' | 'list' | 'create' | 'update' | 'delete', the rules' own method names, picked the way the
//             live service picks them:
//               firestore: a write to a missing document is 'create', to an existing one 'update'.
//               storage: every upload of a file's contents is 'create', also over a file that already exists
//                 (existing is then that file's metadata, which the rules see as resource); 'update' is only a
//                 change to an existing file's metadata. An overwrite modelled as 'update' would test a request
//                 the service never sends (the 2026-10-01 smoke test found exactly that gap).
//   path      segments joined by '/', with no leading or trailing slash.
//               firestore: relative to /databases/(default)/documents. A document path for get, create, update
//                 and delete ('users/alice/notes/<id>'); for list, the queried collection ('users/alice/notes').
//               storage: the object name inside the bucket ('users/alice/images/<32 hex>.png'); for list, the
//                 listed prefix without its trailing slash ('users/alice/images').
//   auth      { uid, verified } or null when signed out. verified is the ID token's email_verified claim.
//   time      request.time, as a timestamp (below).
//   existing  what is stored before the request (resource), or null when nothing is:
//               firestore: the document's data (resource.data);
//               storage: the object's metadata { size, contentType }.
//             Always null for list and for a Firestore create, never null for update; either for get, delete
//             and a Storage create (set: an upload over a stored file; null: an upload to a new name).
//   incoming  what the request would store (request.resource); set for create and update only, null otherwise:
//               firestore: request.resource.data, the WHOLE document as it would be after the write. For a
//                 write with an update mask (the head) that is the stored document with the masked fields
//                 replaced. Server transforms are already applied: a REQUEST_TIME field equals time.
//               storage: the upload's metadata { size, contentType }.
//   head      the data that get() (Firestore rules) and firestore.get() (Storage rules) return for
//             users/{uid}, with uid taken from path: the head as committed before the request (a rule's get()
//             never sees the other writes of the same commit). null means the head doesn't exist: the call
//             fails and the rule denies. Every case sets it, whether or not its rule reads it. It is null
//             for a path outside users/{uid}, and equal to existing for a case on users/{uid} itself.
//   expect    'ALLOW' | 'DENY'.
//
// Values inside existing, incoming and head are JSON, with two conventions:
//   - A timestamp is { $ts: ms }: integer epoch milliseconds and nothing else in that object. Keys starting
//     with '$' are reserved for this.
//   - A number is an integer (Firestore integerValue, rules int) when Number.isInteger(n), and a double (rules
//     float) otherwise. Every rev is an integer. There is no integral double: the Rules API can't express one.
// A plain string never looks like an RFC 3339 date-time ('2026-10-01T10:00...'), because the Rules API reads
// such a string as a timestamp. A date alone ('2026-10-01') stays a string.
//
// Exports { cases, validate(list = cases) → problems (empty when valid), isTimestamp(value) }. The list is
// deep-frozen and no two cases share an object: clone a value before changing it. Run
// `node tests/rules/cases.js` to check the list.

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const DAY = 24 * 60 * 60 * 1000;
const MiB = 1024 * 1024;
const T = Date.UTC(2026, 9, 1, 10, 0, 0, 123); // request.time of every case: 2026-10-01T10:00:00.123Z
const ts = (ms) => ({ $ts: ms });
const NOW = ts(T);
const ALLOW = 'ALLOW';
const DENY = 'DENY';

const ALICE = { uid: 'alice', verified: true };
const ALICE_UNVERIFIED = { uid: 'alice', verified: false };
const BOB = { uid: 'bob', verified: true };

const DEVICE_ID = 'c0ffee' + '0'.repeat(26); // this computer
const OTHER_DEVICE_ID = 'b0'.repeat(16); // the other computer, as the mock's remote() writes it
const IMAGE_ID = '9f0c' + 'a1'.repeat(14);
const PROJECT_ID = '5d1e7f3a-8c2b-4e6f-9a0d-3b4c5d6e7f80';
const OTHER_PROJECT_ID = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const NOTE_ID = '3f2b8c1e-4b1a-4c3e-9d5f-2a7e1c0b9d11';

const omit = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

// ---- the head, users/{uid}
const HEAD_PATH = 'users/alice';
const HEAD = {
  schema: 1, rev: 57, minRev: 0, deleting: false,
  createdAt: ts(T - 30 * DAY), updatedAt: ts(T - 60 * 60 * 1000),
  lastDevice: OTHER_DEVICE_ID, board: { joiner: 'blank' },
  stats: { projects: 12, notes: 340, images: 58 },
  privacy: { version: '2026-10-01', acceptedAt: ts(T - 30 * DAY) },
};
const HEAD_DELETING = { ...HEAD, deleting: true, deletingAt: ts(T - 10 * 60 * 1000) };
const HEAD_MIN_REV = { ...HEAD, minRev: 40 }; // tombstones at or below rev 40 may be hard-deleted
const NEW_HEAD = {
  schema: 1, rev: 1, minRev: 0, deleting: false, createdAt: NOW, updatedAt: NOW,
  lastDevice: DEVICE_ID, board: { joiner: 'blank' }, stats: { projects: 0, notes: 0, images: 0 },
  privacy: { version: '2026-10-01', acceptedAt: ts(T - 2 * 60 * 1000) },
};
// A board commit's head write (updateMask rev, lastDevice, board, stats; updatedAt = REQUEST_TIME), as stored after.
const bump = (base, over = {}) => ({
  ...base, rev: base.rev + 1, lastDevice: DEVICE_ID, board: { joiner: 'line' },
  stats: { projects: 12, notes: 341, images: 58 }, updatedAt: NOW, ...over,
});
// The start of an account deletion (updateMask deleting; deletingAt = REQUEST_TIME), as stored after.
const startDeletion = (base, over = {}) => ({ ...base, deleting: true, deletingAt: NOW, ...over });
const manyFields = (base, total) => {
  const out = { ...base };
  for (let i = 1; Object.keys(out).length < total; i++) out['extra' + i] = i;
  return out;
};

// ---- projects and notes
const projectSync = (over = {}) => ({ rev: 58, key: 'a0V', deleted: false, by: DEVICE_ID, at: NOW, ...over });
const noteSync = (over = {}) => ({
  rev: 58, key: 'a0V', deleted: false, by: DEVICE_ID, at: NOW, project: PROJECT_ID, list: 'notes', ...over,
});
const OLD_SYNC = { rev: 42, by: OTHER_DEVICE_ID, at: ts(T - DAY) };

const PROJECT_PATH = `users/alice/projects/${PROJECT_ID}`;
const PROJECT = {
  name: 'Wildfire RL', color: 'monstera', createdAt: 1758690000000,
  futureProjectField: 'x', _json: { weird: '[[1,2],[3]]' },
  _sync: projectSync(),
};
const PROJECT_STORED = { ...PROJECT, name: 'Wildfire', _sync: projectSync(OLD_SYNC) };
const PROJECT_TOMBSTONE = { _sync: projectSync({ deleted: true }) };

const NOTE_PATH = `users/alice/notes/${NOTE_ID}`;
const NOTE = {
  text: 'Review the fire spread model before the Friday call',
  images: [{ id: IMAGE_ID, w: 3024, h: 1964 }],
  createdAt: 1758690000000, updatedAt: 1758693600000, usedAt: 0,
  copied: 5, lastCopiedAt: 1758700000000, highlight: 'amber',
  futureNoteField: { nested: true },
  _sync: noteSync(),
};
const NOTE_STORED = { ...NOTE, text: 'Review the fire spread model', _sync: noteSync(OLD_SYNC) };
const NOTE_TOMBSTONE = { _sync: noteSync({ deleted: true }) };
// An id that isn't a valid document id is stored under 'x-' + base64url(sha256(id)), with the id in _sync.id.
const ODD_NOTE_ID = 'imported/note #7';
const ODD_NOTE_PATH = 'users/alice/notes/x-' + crypto.createHash('sha256').update(ODD_NOTE_ID).digest('base64url');

// ---- trash and devices
const TRASH_NOTE_PATH = `users/alice/trash/note-${NOTE_ID}`;
const TRASH_PROJECT_PATH = `users/alice/trash/project-${PROJECT_ID}`;
const TRASH_NOTE = {
  kind: 'note', data: JSON.stringify({ text: NOTE_STORED.text, images: NOTE.images, createdAt: NOTE.createdAt }),
  rev: 58, project: PROJECT_ID, list: 'notes', by: DEVICE_ID, deletedAt: NOW, expireAt: ts(T + 30 * DAY),
};
const TRASH_PROJECT = {
  kind: 'project', data: JSON.stringify({ name: 'Wildfire RL', color: 'monstera', createdAt: 1758690000000 }),
  rev: 58, by: DEVICE_ID, deletedAt: NOW, expireAt: ts(T + 30 * DAY),
};
const TRASH_STORED = { ...TRASH_NOTE, rev: 50, deletedAt: ts(T - 3 * DAY), expireAt: ts(T + 27 * DAY) };

const DEVICE_PATH = `users/alice/devices/${DEVICE_ID}`;
const SETTINGS = {
  theme: 'deep', model: 'gpt-transcribe', language: '', hint: '', hotkey: 'Control+Alt+R', shotHotkey: '',
  hideAfterCopy: false,
};
const DEVICE = {
  name: 'Mac', platform: 'darwin', appVersion: '1.17.0', lastSeenAt: NOW, lastRev: 57,
  view: JSON.stringify({ prefs: { density: 'slim', colWidths: {}, scroll: 0 }, projects: {}, notes: {}, top: {} }),
  drafts: JSON.stringify({ [PROJECT_ID]: { text: 'half a thought', images: [] } }),
  settings: SETTINGS,
};
const DEVICE_STORED = { ...DEVICE, lastSeenAt: ts(T - 10 * 60 * 1000), lastRev: 50 };

// ---- pictures
const PNG = `users/alice/images/${IMAGE_ID}.png`;
const THUMB = `users/alice/images/${IMAGE_ID}.t.png`;
const PNG_META = { size: 1843200, contentType: 'image/png' };
const THUMB_META = { size: 48213, contentType: 'image/png' };

function fsCase(name, method, path, expect, { auth = ALICE, existing = null, incoming = null, head = HEAD } = {}) {
  return { name, service: 'firestore', method, path, auth, time: NOW, existing, incoming, head, expect };
}
function stCase(name, method, path, expect, { auth = ALICE, existing = null, incoming = null, head = HEAD } = {}) {
  return { name, service: 'storage', method, path, auth, time: NOW, existing, incoming, head, expect };
}
// A case on the head document itself: head is always the stored head (existing).
function headCase(name, method, expect, { auth = ALICE, existing = HEAD, incoming = null } = {}) {
  return fsCase(name, method, HEAD_PATH, expect, { auth, existing, incoming, head: existing });
}

const list = [
  // ---- users/{uid}: reads
  headCase('head: owner get', 'get', ALLOW),
  headCase('head: owner get while missing', 'get', ALLOW, { existing: null }),
  headCase('head: other user get', 'get', DENY, { auth: BOB }),
  headCase('head: unverified get', 'get', DENY, { auth: ALICE_UNVERIFIED }),
  headCase('head: signed-out get', 'get', DENY, { auth: null }),
  fsCase('head: list users', 'list', 'users', DENY, { head: null }),

  // ---- users/{uid}: create (first sync; createdAt and updatedAt are REQUEST_TIME transforms)
  headCase('head: create rev 1', 'create', ALLOW, { existing: null, incoming: NEW_HEAD }),
  headCase('head: create rev 1 without privacy', 'create', ALLOW, { existing: null, incoming: omit(NEW_HEAD, 'privacy') }),
  headCase('head: create rev 2', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, rev: 2 } }),
  headCase('head: create already deleting', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, deleting: true } }),
  headCase('head: create without deleting', 'create', DENY, { existing: null, incoming: omit(NEW_HEAD, 'deleting') }),
  headCase('head: create with minRev 1', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, minRev: 1 } }),
  headCase('head: create with schema 0', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, schema: 0 } }),
  headCase('head: create with a string schema', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, schema: '1' } }),
  headCase('head: create with a float schema', 'create', DENY, { existing: null, incoming: { ...NEW_HEAD, schema: 1.5 } }),
  headCase('head: create with createdAt != request time', 'create', DENY,
    { existing: null, incoming: { ...NEW_HEAD, createdAt: ts(T - 1000) } }),
  headCase('head: create with updatedAt != request time', 'create', DENY,
    { existing: null, incoming: { ...NEW_HEAD, updatedAt: ts(T - 1000) } }),
  headCase('head: create with 50 fields', 'create', ALLOW, { existing: null, incoming: manyFields(NEW_HEAD, 50) }),
  headCase('head: create with 51 fields', 'create', DENY, { existing: null, incoming: manyFields(NEW_HEAD, 51) }),
  headCase('head: other user create', 'create', DENY, { auth: BOB, existing: null, incoming: NEW_HEAD }),
  headCase('head: unverified create', 'create', DENY, { auth: ALICE_UNVERIFIED, existing: null, incoming: NEW_HEAD }),

  // ---- users/{uid}: board commits
  headCase('head: +1 bump', 'update', ALLOW, { incoming: bump(HEAD) }),
  headCase('head: +1 bump with a new privacy version', 'update', ALLOW,
    { incoming: bump(HEAD, { privacy: { version: '2027-01-15', acceptedAt: ts(T - 60 * 1000) } }) }),
  headCase('head: +1 bump raising schema', 'update', ALLOW, { incoming: bump(HEAD, { schema: 2 }) }),
  headCase('head: +1 bump raising minRev', 'update', ALLOW, { incoming: bump(HEAD, { minRev: 40 }) }),
  headCase('head: +1 bump with minRev equal to rev', 'update', ALLOW, { incoming: bump(HEAD, { minRev: 58 }) }),
  headCase('head: +2 jump', 'update', DENY, { incoming: bump(HEAD, { rev: 59 }) }),
  headCase('head: rev unchanged', 'update', DENY, { incoming: bump(HEAD, { rev: 57 }) }),
  headCase('head: bump while deleting', 'update', DENY, { existing: HEAD_DELETING, incoming: bump(HEAD_DELETING) }),
  headCase('head: bump that sets deleting', 'update', DENY, { incoming: bump(HEAD, { deleting: true, deletingAt: NOW }) }),
  headCase('head: changing createdAt', 'update', DENY, { incoming: bump(HEAD, { createdAt: NOW }) }),
  headCase('head: updatedAt != request time', 'update', DENY, { incoming: bump(HEAD, { updatedAt: ts(T - 1000) }) }),
  headCase('head: schema going down', 'update', DENY,
    { existing: { ...HEAD, schema: 2 }, incoming: bump({ ...HEAD, schema: 2 }, { schema: 1 }) }),
  headCase('head: +1 bump with a float schema', 'update', DENY, { incoming: bump(HEAD, { schema: 1.5 }) }),
  headCase('head: minRev > rev', 'update', DENY, { incoming: bump(HEAD, { minRev: 59 }) }),
  headCase('head: minRev going down', 'update', DENY, { existing: HEAD_MIN_REV, incoming: bump(HEAD_MIN_REV, { minRev: 30 }) }),
  headCase('head: +1 bump with a float minRev', 'update', DENY, { incoming: bump(HEAD, { minRev: 0.5 }) }),
  headCase('head: bump with 51 fields', 'update', DENY, { incoming: manyFields(bump(HEAD), 51) }),
  headCase('head: other user +1 bump', 'update', DENY, { auth: BOB, incoming: bump(HEAD) }),
  headCase('head: unverified +1 bump', 'update', DENY, { auth: ALICE_UNVERIFIED, incoming: bump(HEAD) }),

  // ---- users/{uid}: account deletion
  headCase('head: start deletion', 'update', ALLOW, { incoming: startDeletion(HEAD) }),
  headCase('head: start deletion again when resuming', 'update', ALLOW, { existing: HEAD_DELETING, incoming: startDeletion(HEAD_DELETING) }),
  headCase('head: start deletion with deletingAt != request time', 'update', DENY,
    { incoming: startDeletion(HEAD, { deletingAt: ts(T - 1000) }) }),
  headCase('head: start deletion without deletingAt', 'update', DENY, { incoming: { ...HEAD, deleting: true } }),
  headCase('head: start deletion that also bumps rev', 'update', DENY, { incoming: startDeletion(HEAD, { rev: 58 }) }),
  headCase('head: other user starts deletion', 'update', DENY, { auth: BOB, incoming: startDeletion(HEAD) }),
  // With no head, the masked deletion-start write would create one; the engine must skip to deleting the account.
  headCase('head: start deletion while the head is missing', 'create', DENY,
    { existing: null, incoming: { deleting: true, deletingAt: NOW } }),
  headCase('head: undo deletion', 'update', DENY, { existing: HEAD_DELETING, incoming: bump(HEAD_DELETING, { deleting: false }) }),
  headCase('head: undo deletion without a bump', 'update', DENY, { existing: HEAD_DELETING, incoming: { ...HEAD_DELETING, deleting: false } }),
  headCase('head: undo deletion with a new deletingAt', 'update', DENY,
    { existing: HEAD_DELETING, incoming: { ...HEAD_DELETING, deleting: false, deletingAt: NOW } }),
  headCase('head: delete while not deleting', 'delete', DENY),
  headCase('head: delete while deleting', 'delete', ALLOW, { existing: HEAD_DELETING }),
  headCase('head: other user delete while deleting', 'delete', DENY, { auth: BOB, existing: HEAD_DELETING }),

  // ---- notes: reads
  fsCase('notes: owner get', 'get', NOTE_PATH, ALLOW, { existing: NOTE_STORED }),
  fsCase('notes: owner list', 'list', 'users/alice/notes', ALLOW),
  fsCase('notes: other user get', 'get', NOTE_PATH, DENY, { auth: BOB, existing: NOTE_STORED }),
  fsCase('notes: other user list', 'list', 'users/alice/notes', DENY, { auth: BOB }),
  fsCase('notes: unverified list', 'list', 'users/alice/notes', DENY, { auth: ALICE_UNVERIFIED }),
  fsCase('notes: signed-out list', 'list', 'users/alice/notes', DENY, { auth: null }),

  // ---- notes: writes (whole documents; _sync.at is a REQUEST_TIME transform). A "not a string" case uses a list,
  // which has a size() too, so only the rule's type check refuses it.
  fsCase('notes: create valid', 'create', NOTE_PATH, ALLOW, { incoming: NOTE }),
  fsCase('notes: create in Cooked', 'create', NOTE_PATH, ALLOW, { incoming: { ...NOTE, _sync: noteSync({ list: 'used' }) } }),
  fsCase('notes: create in Served', 'create', NOTE_PATH, ALLOW, { incoming: { ...NOTE, _sync: noteSync({ list: 'combined' }) } }),
  fsCase('notes: create with _sync.id', 'create', ODD_NOTE_PATH, ALLOW, { incoming: { ...NOTE, _sync: noteSync({ id: ODD_NOTE_ID }) } }),
  fsCase("notes: bad list 'cooked'", 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ list: 'cooked' }) } }),
  fsCase('notes: without _sync.project', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: omit(noteSync(), 'project') } }),
  fsCase('notes: empty _sync.project', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ project: '' }) } }),
  fsCase('notes: _sync.project of 1501 characters', 'create', NOTE_PATH, DENY,
    { incoming: { ...NOTE, _sync: noteSync({ project: 'p'.repeat(1501) }) } }),
  fsCase('notes: _sync.project not a string', 'create', NOTE_PATH, DENY,
    { incoming: { ...NOTE, _sync: noteSync({ project: [PROJECT_ID] }) } }),
  fsCase('notes: without _sync.list', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: omit(noteSync(), 'list') } }),
  fsCase('notes: without _sync', 'create', NOTE_PATH, DENY, { incoming: omit(NOTE, '_sync') }),
  fsCase('notes: _sync not a map', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: 'a0V' } }),
  fsCase('notes: _sync without by', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: omit(noteSync(), 'by') } }),
  fsCase('notes: _sync with an unknown key', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ owner: 'bob' }) } }),
  fsCase('notes: rev 0', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ rev: 0 }) } }),
  fsCase('notes: rev not an integer', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ rev: 58.5 }) } }),
  fsCase('notes: deleted not a bool', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ deleted: 'false' }) } }),
  fsCase('notes: empty key', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ key: '' }) } }),
  fsCase('notes: key of 64 characters', 'create', NOTE_PATH, ALLOW, { incoming: { ...NOTE, _sync: noteSync({ key: 'a'.repeat(64) }) } }),
  fsCase('notes: key of 65 characters', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ key: 'a'.repeat(65) }) } }),
  fsCase('notes: key not a string', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ key: ['a0V'] }) } }),
  fsCase('notes: by of 65 characters', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ by: 'c'.repeat(65) }) } }),
  fsCase('notes: by not a string', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ by: [DEVICE_ID] }) } }),
  fsCase('notes: _sync.id of 1501 characters', 'create', ODD_NOTE_PATH, DENY,
    { incoming: { ...NOTE, _sync: noteSync({ id: 'n'.repeat(1501) }) } }),
  fsCase('notes: _sync.id not a string', 'create', ODD_NOTE_PATH, DENY,
    { incoming: { ...NOTE, _sync: noteSync({ id: [ODD_NOTE_ID] }) } }),
  fsCase('notes: _sync.at != request time', 'create', NOTE_PATH, DENY, { incoming: { ...NOTE, _sync: noteSync({ at: ts(T - 1000) }) } }),
  fsCase('notes: 200 fields', 'create', NOTE_PATH, ALLOW, { incoming: manyFields(NOTE, 200) }),
  fsCase('notes: 201 fields', 'create', NOTE_PATH, DENY, { incoming: manyFields(NOTE, 201) }),
  fsCase('notes: other user create', 'create', NOTE_PATH, DENY, { auth: BOB, incoming: NOTE }),
  fsCase('notes: unverified create', 'create', NOTE_PATH, DENY, { auth: ALICE_UNVERIFIED, incoming: NOTE }),
  fsCase('notes: signed-out create', 'create', NOTE_PATH, DENY, { auth: null, incoming: NOTE }),
  fsCase('notes: update rev forward', 'update', NOTE_PATH, ALLOW, { existing: NOTE_STORED, incoming: NOTE }),
  fsCase('notes: move to another column and stage', 'update', NOTE_PATH, ALLOW,
    { existing: NOTE_STORED, incoming: { ...NOTE, _sync: noteSync({ project: OTHER_PROJECT_ID, list: 'used' }) } }),
  fsCase('notes: rev going backwards', 'update', NOTE_PATH, DENY,
    { existing: NOTE_STORED, incoming: { ...NOTE, _sync: noteSync({ rev: 41 }) } }),
  fsCase('notes: rev unchanged', 'update', NOTE_PATH, DENY, { existing: NOTE_STORED, incoming: { ...NOTE, _sync: noteSync({ rev: 42 }) } }),
  fsCase('notes: tombstone', 'update', NOTE_PATH, ALLOW, { existing: NOTE_STORED, incoming: NOTE_TOMBSTONE }),
  fsCase('notes: tombstone with content', 'update', NOTE_PATH, DENY,
    { existing: NOTE_STORED, incoming: { ...NOTE_TOMBSTONE, text: NOTE.text } }),
  fsCase('notes: tombstone without its list', 'update', NOTE_PATH, DENY,
    { existing: NOTE_STORED, incoming: { _sync: omit(noteSync({ deleted: true }), 'list') } }),
  fsCase('notes: tombstone going backwards', 'update', NOTE_PATH, DENY,
    { existing: NOTE_STORED, incoming: { _sync: noteSync({ deleted: true, rev: 40 }) } }),
  fsCase('notes: undelete a tombstone', 'update', NOTE_PATH, ALLOW,
    { existing: { _sync: noteSync({ ...OLD_SYNC, deleted: true }) }, incoming: NOTE }),
  fsCase('notes: other user update', 'update', NOTE_PATH, DENY, { auth: BOB, existing: NOTE_STORED, incoming: NOTE }),

  // ---- notes: hard deletes (one get() of the head each)
  fsCase('notes: hard delete while not deleting', 'delete', NOTE_PATH, DENY, { existing: NOTE_STORED }),
  fsCase('notes: hard delete while deleting', 'delete', NOTE_PATH, ALLOW, { existing: NOTE_STORED, head: HEAD_DELETING }),
  fsCase('notes: hard delete of a missing note while deleting', 'delete', NOTE_PATH, ALLOW, { head: HEAD_DELETING }),
  fsCase('notes: hard delete of a tombstone at minRev', 'delete', NOTE_PATH, ALLOW,
    { existing: { _sync: noteSync({ ...OLD_SYNC, rev: 40, deleted: true }) }, head: HEAD_MIN_REV }),
  fsCase('notes: hard delete of a tombstone above minRev', 'delete', NOTE_PATH, DENY,
    { existing: { _sync: noteSync({ ...OLD_SYNC, rev: 41, deleted: true }) }, head: HEAD_MIN_REV }),
  fsCase('notes: hard delete of a live note below minRev', 'delete', NOTE_PATH, DENY,
    { existing: { ...NOTE_STORED, _sync: noteSync({ ...OLD_SYNC, rev: 30 }) }, head: HEAD_MIN_REV }),
  fsCase('notes: hard delete with the head missing', 'delete', NOTE_PATH, DENY, { existing: NOTE_STORED, head: null }),
  fsCase('notes: other user hard delete while deleting', 'delete', NOTE_PATH, DENY,
    { auth: BOB, existing: NOTE_STORED, head: HEAD_DELETING }),

  // ---- projects: the same basic set (no stage)
  fsCase('projects: owner get', 'get', PROJECT_PATH, ALLOW, { existing: PROJECT_STORED }),
  fsCase('projects: owner list', 'list', 'users/alice/projects', ALLOW),
  fsCase('projects: other user get', 'get', PROJECT_PATH, DENY, { auth: BOB, existing: PROJECT_STORED }),
  fsCase('projects: other user list', 'list', 'users/alice/projects', DENY, { auth: BOB }),
  fsCase('projects: create valid', 'create', PROJECT_PATH, ALLOW, { incoming: PROJECT }),
  fsCase('projects: without _sync.key', 'create', PROJECT_PATH, DENY, { incoming: { ...PROJECT, _sync: omit(projectSync(), 'key') } }),
  fsCase('projects: rev not an integer', 'create', PROJECT_PATH, DENY, { incoming: { ...PROJECT, _sync: projectSync({ rev: 1.5 }) } }),
  fsCase('projects: _sync.at != request time', 'create', PROJECT_PATH, DENY,
    { incoming: { ...PROJECT, _sync: projectSync({ at: ts(T + 1000) }) } }),
  fsCase('projects: key of 65 characters', 'create', PROJECT_PATH, DENY,
    { incoming: { ...PROJECT, _sync: projectSync({ key: 'a'.repeat(65) }) } }),
  fsCase('projects: 201 fields', 'create', PROJECT_PATH, DENY, { incoming: manyFields(PROJECT, 201) }),
  fsCase('projects: other user create', 'create', PROJECT_PATH, DENY, { auth: BOB, incoming: PROJECT }),
  fsCase('projects: update rev forward', 'update', PROJECT_PATH, ALLOW, { existing: PROJECT_STORED, incoming: PROJECT }),
  fsCase('projects: rev going backwards', 'update', PROJECT_PATH, DENY,
    { existing: PROJECT_STORED, incoming: { ...PROJECT, _sync: projectSync({ rev: 41 }) } }),
  fsCase('projects: update with _sync.at != request time', 'update', PROJECT_PATH, DENY,
    { existing: PROJECT_STORED, incoming: { ...PROJECT, _sync: projectSync({ at: ts(T - 1000) }) } }),
  fsCase('projects: other user update', 'update', PROJECT_PATH, DENY, { auth: BOB, existing: PROJECT_STORED, incoming: PROJECT }),
  fsCase('projects: tombstone', 'update', PROJECT_PATH, ALLOW, { existing: PROJECT_STORED, incoming: PROJECT_TOMBSTONE }),
  fsCase('projects: tombstone with content', 'update', PROJECT_PATH, DENY,
    { existing: PROJECT_STORED, incoming: { ...PROJECT_TOMBSTONE, name: 'Wildfire RL' } }),
  fsCase('projects: undelete a tombstone', 'update', PROJECT_PATH, ALLOW,
    { existing: { _sync: projectSync({ ...OLD_SYNC, deleted: true }) }, incoming: PROJECT }),
  fsCase('projects: hard delete while not deleting', 'delete', PROJECT_PATH, DENY, { existing: PROJECT_STORED }),
  fsCase('projects: hard delete while deleting', 'delete', PROJECT_PATH, ALLOW, { existing: PROJECT_STORED, head: HEAD_DELETING }),
  fsCase('projects: hard delete of a tombstone at minRev', 'delete', PROJECT_PATH, ALLOW,
    { existing: { _sync: projectSync({ ...OLD_SYNC, rev: 40, deleted: true }) }, head: HEAD_MIN_REV }),
  fsCase('projects: hard delete of a tombstone above minRev', 'delete', PROJECT_PATH, DENY,
    { existing: { _sync: projectSync({ ...OLD_SYNC, rev: 41, deleted: true }) }, head: HEAD_MIN_REV }),
  fsCase('projects: other user hard delete while deleting', 'delete', PROJECT_PATH, DENY,
    { auth: BOB, existing: PROJECT_STORED, head: HEAD_DELETING }),

  // ---- trash (written in the same commit as the tombstone; deletedAt is a REQUEST_TIME transform)
  fsCase('trash: valid', 'create', TRASH_NOTE_PATH, ALLOW, { incoming: TRASH_NOTE }),
  fsCase('trash: valid project copy', 'create', TRASH_PROJECT_PATH, ALLOW, { incoming: TRASH_PROJECT }),
  fsCase('trash: deleted again', 'update', TRASH_NOTE_PATH, ALLOW, { existing: TRASH_STORED, incoming: TRASH_NOTE }),
  fsCase('trash: owner get', 'get', TRASH_NOTE_PATH, ALLOW, { existing: TRASH_STORED }),
  fsCase('trash: owner list', 'list', 'users/alice/trash', ALLOW),
  fsCase('trash: other user get', 'get', TRASH_NOTE_PATH, DENY, { auth: BOB, existing: TRASH_STORED }),
  fsCase('trash: expireAt at 20 days', 'create', TRASH_NOTE_PATH, ALLOW, { incoming: { ...TRASH_NOTE, expireAt: ts(T + 20 * DAY) } }),
  fsCase('trash: expireAt at 39 days', 'create', TRASH_NOTE_PATH, ALLOW, { incoming: { ...TRASH_NOTE, expireAt: ts(T + 39 * DAY) } }),
  fsCase('trash: expireAt at 40 days', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, expireAt: ts(T + 40 * DAY) } }),
  fsCase('trash: expireAt at 60 days', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, expireAt: ts(T + 60 * DAY) } }),
  fsCase('trash: expireAt in the past', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, expireAt: ts(T - DAY) } }),
  fsCase('trash: expireAt as a number', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, expireAt: T + 30 * DAY } }),
  fsCase('trash: an extra key', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, text: NOTE.text } }),
  fsCase('trash: an unknown kind', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, kind: 'column' } }),
  fsCase('trash: data not a string', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, data: { text: NOTE.text } } }),
  fsCase('trash: rev not an integer', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, rev: 58.5 } }),
  fsCase('trash: by of 65 characters', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, by: 'c'.repeat(65) } }),
  fsCase('trash: by not a string', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, by: [DEVICE_ID] } }),
  fsCase('trash: deletedAt != request time', 'create', TRASH_NOTE_PATH, DENY, { incoming: { ...TRASH_NOTE, deletedAt: ts(T - 1000) } }),
  fsCase('trash: other user create', 'create', TRASH_NOTE_PATH, DENY, { auth: BOB, incoming: TRASH_NOTE }),
  fsCase('trash: delete while not deleting', 'delete', TRASH_NOTE_PATH, DENY, { existing: TRASH_STORED }),
  fsCase('trash: delete while deleting', 'delete', TRASH_NOTE_PATH, ALLOW, { existing: TRASH_STORED, head: HEAD_DELETING }),
  fsCase('trash: other user delete while deleting', 'delete', TRASH_NOTE_PATH, DENY,
    { auth: BOB, existing: TRASH_STORED, head: HEAD_DELETING }),

  // ---- devices (a single-document write with lastSeenAt = REQUEST_TIME; one get() of the head)
  fsCase('devices: valid', 'create', DEVICE_PATH, ALLOW, { incoming: DEVICE }),
  fsCase('devices: valid update', 'update', DEVICE_PATH, ALLOW, { existing: DEVICE_STORED, incoming: DEVICE }),
  fsCase('devices: Windows PC without view, drafts or settings', 'create', DEVICE_PATH, ALLOW,
    { incoming: { name: 'Windows PC', platform: 'win32', appVersion: '1.17.0', lastSeenAt: NOW, lastRev: 57 } }),
  fsCase('devices: view and drafts at their limits', 'create', DEVICE_PATH, ALLOW,
    { incoming: { ...DEVICE, view: 'v'.repeat(700000), drafts: 'd'.repeat(200000) } }),
  fsCase('devices: apiKey in settings', 'create', DEVICE_PATH, DENY,
    { incoming: { ...DEVICE, settings: { ...SETTINGS, apiKey: 'not-a-real-key' } } }),
  fsCase('devices: while deleting', 'update', DEVICE_PATH, DENY, { existing: DEVICE_STORED, incoming: DEVICE, head: HEAD_DELETING }),
  fsCase('devices: head missing', 'create', DEVICE_PATH, DENY, { incoming: DEVICE, head: null }),
  fsCase('devices: a bad device id', 'create', 'users/alice/devices/my-macbook', DENY, { incoming: DEVICE }),
  fsCase('devices: an uppercase device id', 'create', `users/alice/devices/${DEVICE_ID.toUpperCase()}`, DENY, { incoming: DEVICE }),
  fsCase('devices: a device id of 33 hex', 'create', `users/alice/devices/${DEVICE_ID}0`, DENY, { incoming: DEVICE }),
  fsCase('devices: an extra key', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, email: 'alice@example.com' } }),
  fsCase('devices: without a name', 'create', DEVICE_PATH, DENY, { incoming: omit(DEVICE, 'name') }),
  fsCase('devices: name of 61 characters', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, name: 'M'.repeat(61) } }),
  fsCase('devices: name not a string', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, name: ['Mac'] } }),
  fsCase('devices: an unknown platform', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, platform: 'android' } }),
  fsCase('devices: lastSeenAt != request time', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, lastSeenAt: ts(T - 1000) } }),
  fsCase('devices: view of 700,001 characters', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, view: 'v'.repeat(700001) } }),
  fsCase('devices: view not a string', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, view: { prefs: {} } } }),
  fsCase('devices: drafts of 200,001 characters', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, drafts: 'd'.repeat(200001) } }),
  fsCase('devices: drafts not a string', 'create', DEVICE_PATH, DENY,
    { incoming: { ...DEVICE, drafts: { [PROJECT_ID]: { text: 'half a thought', images: [] } } } }),
  fsCase('devices: settings not a map', 'create', DEVICE_PATH, DENY, { incoming: { ...DEVICE, settings: 'deep' } }),
  fsCase('devices: other user write', 'create', DEVICE_PATH, DENY, { auth: BOB, incoming: DEVICE }),
  fsCase('devices: unverified write', 'create', DEVICE_PATH, DENY, { auth: ALICE_UNVERIFIED, incoming: DEVICE }),
  fsCase('devices: owner get', 'get', DEVICE_PATH, ALLOW, { existing: DEVICE_STORED }),
  fsCase('devices: owner list', 'list', 'users/alice/devices', ALLOW),
  fsCase('devices: other user list', 'list', 'users/alice/devices', DENY, { auth: BOB }),
  fsCase('devices: delete while not deleting', 'delete', DEVICE_PATH, DENY, { existing: DEVICE_STORED }),
  fsCase('devices: delete while deleting', 'delete', DEVICE_PATH, ALLOW, { existing: DEVICE_STORED, head: HEAD_DELETING }),
  fsCase('devices: other user delete while deleting', 'delete', DEVICE_PATH, DENY,
    { auth: BOB, existing: DEVICE_STORED, head: HEAD_DELETING }),

  // ---- anything else is closed
  fsCase('firestore: a top-level document', 'get', 'config/app', DENY, { existing: { open: true }, head: null }),
  fsCase('firestore: an unknown collection under a user', 'create', 'users/alice/secrets/s1', DENY, { incoming: { note: 'x' } }),

  // ---- Storage: users/{uid}/images/<32 hex>(.t).png
  stCase('storage: upload .png', 'create', PNG, ALLOW, { incoming: PNG_META }),
  stCase('storage: upload .t.png', 'create', THUMB, ALLOW, { incoming: THUMB_META }),
  stCase('storage: upload JPEG', 'create', PNG, DENY, { incoming: { ...PNG_META, contentType: 'image/jpeg' } }),
  stCase('storage: upload named .jpg', 'create', `users/alice/images/${IMAGE_ID}.jpg`, DENY, { incoming: PNG_META }),
  stCase('storage: upload with an uppercase id', 'create', `users/alice/images/${IMAGE_ID.toUpperCase()}.png`, DENY, { incoming: PNG_META }),
  stCase('storage: upload with a 31-hex id', 'create', `users/alice/images/${IMAGE_ID.slice(1)}.png`, DENY, { incoming: PNG_META }),
  stCase('storage: upload 40 MiB', 'create', PNG, ALLOW, { incoming: { ...PNG_META, size: 40 * MiB } }),
  stCase('storage: upload 41 MB', 'create', PNG, DENY, { incoming: { ...PNG_META, size: 41 * MiB } }),
  stCase('storage: upload 0 bytes', 'create', PNG, DENY, { incoming: { ...PNG_META, size: 0 } }),
  stCase('storage: upload by other user', 'create', PNG, DENY, { auth: BOB, incoming: PNG_META }),
  stCase('storage: upload unverified', 'create', PNG, DENY, { auth: ALICE_UNVERIFIED, incoming: PNG_META }),
  stCase('storage: upload signed out', 'create', PNG, DENY, { auth: null, incoming: PNG_META }),
  stCase('storage: upload while deleting', 'create', PNG, DENY, { incoming: PNG_META, head: HEAD_DELETING }),
  stCase('storage: upload with head missing', 'create', PNG, DENY, { incoming: PNG_META, head: null }),
  stCase('storage: upload outside images', 'create', `users/alice/notes/${IMAGE_ID}.png`, DENY, { incoming: PNG_META }),
  stCase('storage: upload outside users', 'create', `public/${IMAGE_ID}.png`, DENY, { incoming: PNG_META, head: null }),
  // An upload over a stored picture is a create with resource set (the live service sends it so): refused,
  // whatever the bytes. Only an upload to a name where nothing is stored (the cases above) is allowed.
  stCase('storage: overwrite (create over a stored picture)', 'create', PNG, DENY, { existing: PNG_META, incoming: PNG_META }),
  stCase('storage: overwrite of a thumbnail with other bytes', 'create', THUMB, DENY,
    { existing: THUMB_META, incoming: { size: 1530, contentType: 'image/png' } }),
  stCase('storage: overwrite while deleting', 'create', PNG, DENY, { existing: PNG_META, incoming: PNG_META, head: HEAD_DELETING }),
  // update is a change to an existing picture's metadata only: never allowed.
  stCase('storage: metadata update', 'update', PNG, DENY, { existing: PNG_META, incoming: PNG_META }),
  stCase('storage: delete while not deleting', 'delete', PNG, DENY, { existing: PNG_META }),
  stCase('storage: delete while deleting', 'delete', PNG, ALLOW, { existing: PNG_META, head: HEAD_DELETING }),
  stCase('storage: delete with head missing', 'delete', PNG, DENY, { existing: PNG_META, head: null }),
  stCase('storage: other user delete while deleting', 'delete', PNG, DENY, { auth: BOB, existing: PNG_META, head: HEAD_DELETING }),
  stCase('storage: own get', 'get', PNG, ALLOW, { existing: PNG_META }),
  stCase('storage: own get of a thumbnail', 'get', THUMB, ALLOW, { existing: THUMB_META }),
  stCase('storage: other get', 'get', PNG, DENY, { auth: BOB, existing: PNG_META }),
  stCase('storage: unverified get', 'get', PNG, DENY, { auth: ALICE_UNVERIFIED, existing: PNG_META }),
  stCase('storage: signed-out get', 'get', PNG, DENY, { auth: null, existing: PNG_META }),
  stCase('storage: own list', 'list', 'users/alice/images', ALLOW),
  stCase('storage: own list of the user folder', 'list', 'users/alice', ALLOW),
  stCase('storage: other list', 'list', 'users/alice/images', DENY, { auth: BOB }),
  stCase('storage: unverified list', 'list', 'users/alice/images', DENY, { auth: ALICE_UNVERIFIED }),
  stCase('storage: list outside users', 'list', 'public', DENY, { head: null }),
];

// The minimum set of 7.3; validate() fails if one goes missing.
const REQUIRED = [
  'head: owner get', 'head: other user get', 'head: unverified get', 'head: create rev 1', 'head: create rev 2',
  'head: +1 bump', 'head: +2 jump', 'head: bump while deleting', 'head: start deletion', 'head: undo deletion',
  'head: changing createdAt', 'head: schema going down', 'head: minRev > rev',
  'notes: create valid', "notes: bad list 'cooked'", 'notes: tombstone with content', 'notes: _sync.at != request time',
  'notes: rev going backwards', 'notes: key of 65 characters', 'notes: 201 fields', 'notes: hard delete while not deleting',
  'notes: hard delete while deleting', 'notes: hard delete of a tombstone at minRev',
  'projects: create valid', 'projects: tombstone with content', 'projects: _sync.at != request time',
  'projects: rev going backwards', 'projects: key of 65 characters', 'projects: 201 fields',
  'projects: hard delete while not deleting', 'projects: hard delete while deleting',
  'projects: hard delete of a tombstone at minRev',
  'trash: valid', 'trash: expireAt at 60 days', 'trash: an extra key',
  'devices: valid', 'devices: apiKey in settings', 'devices: while deleting', 'devices: a bad device id',
  'storage: upload .png', 'storage: upload .t.png', 'storage: upload JPEG', 'storage: upload 41 MB',
  'storage: upload by other user', 'storage: upload unverified', 'storage: upload while deleting',
  'storage: upload with head missing', 'storage: overwrite (create over a stored picture)', 'storage: metadata update',
  'storage: delete while not deleting',
  'storage: delete while deleting', 'storage: own get', 'storage: other get', 'storage: own list',
];

const KEYS = ['name', 'service', 'method', 'path', 'auth', 'time', 'existing', 'incoming', 'head', 'expect'];
const METHODS = ['get', 'list', 'create', 'update', 'delete'];
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isTimestamp = (v) => isPlainObject(v) && Object.keys(v).length === 1 && Number.isSafeInteger(v.$ts);
const isObjectMeta = (v) => isPlainObject(v) && Object.keys(v).sort().join() === 'contentType,size'
  && Number.isSafeInteger(v.size) && v.size >= 0 && typeof v.contentType === 'string';
const uidOf = (path) => /^users\/([^/]+)/.exec(path)?.[1] ?? null;

function checkValue(v, where, out) {
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) out.push(`${where}: number out of range`);
    return;
  }
  if (typeof v === 'string') {
    if (DATE_TIME.test(v)) out.push(`${where}: a string that reads as a date-time; write a timestamp as { $ts: ms }`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => checkValue(x, `${where}[${i}]`, out));
    return;
  }
  if (!isPlainObject(v)) {
    out.push(`${where}: not a JSON value`);
    return;
  }
  if (Object.hasOwn(v, '$ts')) {
    if (!isTimestamp(v)) out.push(`${where}: a timestamp is exactly { $ts: <integer ms> }`);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith('$')) out.push(`${where}.${k}: keys starting with $ are reserved`);
    checkValue(x, `${where}.${k}`, out);
  }
}

// Checks a case list against the format above. Returns a list of problems; empty means valid.
function validate(list = cases) {
  if (!Array.isArray(list) || !list.length) return ['cases: not a non-empty array'];
  const out = [];
  const names = new Set();
  list.forEach((c, i) => {
    const at = `case ${i} (${c?.name})`;
    if (!isPlainObject(c)) {
      out.push(`${at}: not an object`);
      return;
    }
    for (const k of KEYS) if (!Object.hasOwn(c, k)) out.push(`${at}: missing ${k}`);
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) out.push(`${at}: unknown key ${k}`);
    if (typeof c.name !== 'string' || !c.name) out.push(`${at}: name must be a non-empty string`);
    else if (names.has(c.name)) out.push(`${at}: duplicate name`);
    else names.add(c.name);
    if (c.service !== 'firestore' && c.service !== 'storage') out.push(`${at}: service must be firestore or storage`);
    if (!METHODS.includes(c.method)) out.push(`${at}: unknown method ${c.method}`);
    if (c.expect !== 'ALLOW' && c.expect !== 'DENY') out.push(`${at}: expect must be ALLOW or DENY`);

    const segments = typeof c.path === 'string' ? c.path.split('/') : [''];
    if (segments.some((s) => !s)) out.push(`${at}: path must be segments joined by /, with no leading or trailing slash`);
    else if (c.service === 'firestore' && (segments.length % 2 === 1) !== (c.method === 'list')) {
      out.push(`${at}: a Firestore list names a collection (odd segments); every other method a document`);
    }

    if (c.auth !== null && !(isPlainObject(c.auth) && Object.keys(c.auth).sort().join() === 'uid,verified'
      && typeof c.auth.uid === 'string' && c.auth.uid && typeof c.auth.verified === 'boolean')) {
      out.push(`${at}: auth must be null or { uid, verified }`);
    }
    if (!isTimestamp(c.time)) out.push(`${at}: time must be { $ts: <integer ms> }`);

    const write = c.method === 'create' || c.method === 'update';
    if (write !== (c.incoming !== null)) out.push(`${at}: incoming is set for create and update, and null otherwise`);
    if ((c.method === 'list' || (c.method === 'create' && c.service === 'firestore')) && c.existing !== null) {
      out.push(`${at}: existing must be null for ${c.method === 'list' ? 'list' : 'a Firestore create'}`);
    }
    if (c.method === 'update' && c.existing === null) out.push(`${at}: update needs existing`);
    for (const k of ['existing', 'incoming', 'head']) {
      if (c[k] === null) continue;
      if (!isPlainObject(c[k])) out.push(`${at}: ${k} must be an object or null`);
      else checkValue(c[k], `${at}: ${k}`, out);
    }
    if (c.service === 'storage') {
      for (const k of ['existing', 'incoming']) {
        if (c[k] !== null && !isObjectMeta(c[k])) out.push(`${at}: storage ${k} must be { size, contentType }`);
      }
    }

    if (c.head !== null && uidOf(c.path) === null) out.push(`${at}: head must be null outside users/{uid}`);
    if (c.service === 'firestore' && segments.length === 2 && segments[0] === 'users'
      && !isDeepStrictEqual(c.head, c.existing)) {
      out.push(`${at}: on users/{uid} itself, head must equal existing`);
    }
  });
  for (const name of REQUIRED) if (!names.has(name)) out.push(`required case missing: ${name}`);
  return out;
}

function deepFreeze(v) {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

const cases = deepFreeze(list.map((c) => structuredClone(c)));

module.exports = { cases, validate, isTimestamp };

if (require.main === module) {
  const problems = validate();
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  const count = (service, expect) => cases.filter((c) => c.service === service && c.expect === expect).length;
  console.log(`${cases.length} cases valid: firestore ${count('firestore', 'ALLOW')} ALLOW + ${count('firestore', 'DENY')} DENY,`
    + ` storage ${count('storage', 'ALLOW')} ALLOW + ${count('storage', 'DENY')} DENY`);
}
