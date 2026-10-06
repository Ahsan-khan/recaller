'use strict';
// A JavaScript twin of the security rules in infra/firebase/firestore.rules and storage.rules
// (ai_memory/15_accounts_and_sync.md, 4.8 and 4.9). The GCP mock evaluates it on every read and write, and
// tests/unit/rules-twin.test.js runs every case of tests/rules/cases.js through it.
//
// Each rule below is written the way its text reads, with the Rules language's semantics:
//   - values are typed: an int (a BigInt here) is not a float (a Number); timestamps and durations are their
//     own types;
//   - reading a missing field, or any field of a null resource, is an error, and an error denies;
//   - && and || short-circuit, and are commutative with respect to errors: error && false is false,
//     error || true is true, and anything else involving an error is an error;
//   - get() and firestore.get() are access calls. Every call counts (none is cached), and a call past the
//     limit denies the request: 10 per Firestore evaluation and 2 per Storage evaluation, lowered by the
//     caller when the request has used some already (20 per commit or batchGet);
//   - the method is the one the live service evaluates. In Storage every upload of a file's contents is
//     'create', also over a file that already exists (resource is then that file's metadata, null for a new
//     name), and 'update' is only a metadata change: the mock's Storage asks for exactly that.
// When a rules text changes, change its twin here too: the test compares FINGERPRINTS with the files.

const crypto = require('node:crypto');

class RuleError extends Error {}
class LimitError extends Error {} // not a RuleError: it ends the whole evaluation

class Timestamp {
  constructor(nanos) { this.nanos = BigInt(nanos); }
  static ofMillis(ms) { return new Timestamp(BigInt(ms) * 1000000n); }
}
class Duration { constructor(nanos) { this.nanos = BigInt(nanos); } }
class Bytes { constructor(buf) { this.buf = Buffer.from(buf); } }
class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
class Path { constructor(path) { this.path = String(path); } }

const fail = (why) => { throw new RuleError(why); };
const isNum = (v) => typeof v === 'bigint' || typeof v === 'number';

function typeOf(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'bigint': return 'int';
    case 'number': return 'float';
    case 'string': return 'string';
    case 'boolean': return 'bool';
    default: break;
  }
  if (Array.isArray(v)) return 'list';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  if (v instanceof Timestamp) return 'timestamp';
  if (v instanceof Duration) return 'duration';
  if (v instanceof Bytes) return 'bytes';
  if (v instanceof LatLng) return 'latlng';
  if (v instanceof Path) return 'path';
  return 'unknown';
}

const is = (v, type) => (type === 'number' ? isNum(v) : typeOf(v) === type);

// Code point order, which is also UTF-8 byte order (Firestore sorts strings that way).
function compareStrings(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(i);
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function codePoints(s) {
  let n = s.length;
  for (let i = 0; i + 1 < s.length; i++) {
    const c = s.charCodeAt(i);
    const d = s.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
      n--;
      i++;
    }
  }
  return n;
}

// ==, which never fails: values of different types are simply unequal (an int equals the same float).
function eq(a, b) {
  if (isNum(a) && isNum(b)) {
    if (typeof a === typeof b) return a === b;
    const [i, f] = typeof a === 'bigint' ? [a, b] : [b, a];
    return Number.isInteger(f) && BigInt(f) === i;
  }
  const t = typeOf(a);
  if (t !== typeOf(b)) return false;
  switch (t) {
    case 'list': return a.length === b.length && a.every((x, k) => eq(x, b[k]));
    case 'map': return a.size === b.size && [...a].every(([k, x]) => b.has(k) && eq(x, b.get(k)));
    case 'set': return a.size === b.size && [...a].every((x) => [...b].some((y) => eq(x, y)));
    case 'timestamp': case 'duration': return a.nanos === b.nanos;
    case 'bytes': return a.buf.equals(b.buf);
    case 'latlng': return a.lat === b.lat && a.lng === b.lng;
    case 'path': return a.path === b.path;
    default: return a === b;
  }
}

// <, <=, >, >=: an error for values that have no order between them.
function cmp(a, b) {
  if (isNum(a) && isNum(b)) {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
    const x = Number(a);
    const y = Number(b);
    if (Number.isNaN(x) || Number.isNaN(y)) fail('NaN has no order');
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const t = typeOf(a);
  if (t !== typeOf(b)) fail(`a ${t} and a ${typeOf(b)} can't be compared`);
  if (t === 'string') return compareStrings(a, b);
  if (t === 'timestamp' || t === 'duration') return a.nanos < b.nanos ? -1 : a.nanos > b.nanos ? 1 : 0;
  if (t === 'bytes') return Buffer.compare(a.buf, b.buf);
  return fail(`${t} values have no order`);
}
const lt = (a, b) => cmp(a, b) < 0;
const le = (a, b) => cmp(a, b) <= 0;
const gt = (a, b) => cmp(a, b) > 0;
const ge = (a, b) => cmp(a, b) >= 0;

function add(a, b) {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a + b;
  if (isNum(a) && isNum(b)) return Number(a) + Number(b);
  if (a instanceof Timestamp && b instanceof Duration) return new Timestamp(a.nanos + b.nanos);
  if (a instanceof Duration && b instanceof Timestamp) return new Timestamp(a.nanos + b.nanos);
  if (a instanceof Duration && b instanceof Duration) return new Duration(a.nanos + b.nanos);
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  return fail(`can't add a ${typeOf(a)} and a ${typeOf(b)}`);
}

// m.key: an error on a missing key or on anything but a map.
function member(m, key) {
  if (!(m instanceof Map)) fail(`.${key} of a ${typeOf(m)}`);
  if (!m.has(key)) fail(`no field ${key}`);
  return m.get(key);
}

// m.get(key, default)
function getOr(m, key, dflt) {
  if (!(m instanceof Map)) fail(`get('${key}') on a ${typeOf(m)}`);
  return m.has(key) ? m.get(key) : dflt;
}

function size(v) {
  if (typeof v === 'string') return BigInt(codePoints(v));
  if (Array.isArray(v)) return BigInt(v.length);
  if (v instanceof Map || v instanceof Set) return BigInt(v.size);
  if (v instanceof Bytes) return BigInt(v.buf.length);
  return fail(`size() of a ${typeOf(v)}`);
}

function keys(m) {
  if (!(m instanceof Map)) fail(`keys() of a ${typeOf(m)}`);
  return [...m.keys()];
}

function items(v) {
  if (Array.isArray(v)) return v;
  if (v instanceof Set) return [...v];
  return fail(`a list or set was expected, not a ${typeOf(v)}`);
}
const hasAll = (v, wanted) => { const list = items(v); return wanted.every((x) => list.some((y) => eq(x, y))); };
const hasOnly = (v, allowed) => items(v).every((x) => allowed.some((y) => eq(x, y)));

// x in container
function inOp(x, c) {
  if (c instanceof Map) return typeof x === 'string' ? c.has(x) : fail('a map key is a string');
  return items(c).some((y) => eq(x, y));
}

function not(v) {
  if (typeof v !== 'boolean') fail('! needs a bool');
  return !v;
}

const patterns = new Map();
// string.matches(re): RE2 syntax, matching the whole string.
function matches(s, re) {
  if (typeof s !== 'string') fail(`matches() on a ${typeOf(s)}`);
  let r = patterns.get(re);
  if (!r) patterns.set(re, (r = new RegExp(`^(?:${re})$`, 'u')));
  return r.test(s);
}

// a.diff(b).affectedKeys(): keys added, removed or changed from b to a.
function affectedKeys(a, b) {
  if (!(a instanceof Map) || !(b instanceof Map)) fail('diff() needs two maps');
  const out = new Set();
  for (const [k, x] of a) if (!b.has(k) || !eq(x, b.get(k))) out.add(k);
  for (const k of b.keys()) if (!a.has(k)) out.add(k);
  return out;
}

const NS = { w: 604800n * 10n ** 9n, d: 86400n * 10n ** 9n, h: 3600n * 10n ** 9n, m: 60n * 10n ** 9n, s: 10n ** 9n, ms: 10n ** 6n, ns: 1n };
function durationValue(n, unit) {
  if (typeof n !== 'bigint' || !Object.hasOwn(NS, unit)) fail('duration.value(int, unit)');
  return new Duration(n * NS[unit]);
}

// &&, with short-circuiting and errors commutative: the terms are thunks, evaluated left to right.
function and(...terms) {
  let error = null;
  for (const term of terms) {
    let v;
    try {
      v = term();
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      error = error || e;
      continue;
    }
    if (typeof v !== 'boolean') {
      error = error || new RuleError('&& needs bools');
      continue;
    }
    if (!v) return false;
  }
  if (error) throw error;
  return true;
}

function or(...terms) {
  let error = null;
  for (const term of terms) {
    let v;
    try {
      v = term();
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      error = error || e;
      continue;
    }
    if (typeof v !== 'boolean') {
      error = error || new RuleError('|| needs bools');
      continue;
    }
    if (v) return true;
  }
  if (error) throw error;
  return false;
}

function cond(test, yes, no) {
  const v = test();
  if (typeof v !== 'boolean') fail('?: needs a bool');
  return v ? yes() : no();
}

// A let binding: evaluated once, when first used, error included.
function once(fn) {
  let done = false;
  let value;
  let error = null;
  return () => {
    if (!done) {
      done = true;
      try {
        value = fn();
      } catch (e) {
        error = e;
      }
    }
    if (error) throw error;
    return value;
  };
}

// ---- firestore.rules

function firestoreRules(r, get) {
  const time = r.time;
  const incoming = () => (r.incoming instanceof Map ? r.incoming : fail('request.resource is null'));
  const resource = () => (r.existing instanceof Map ? r.existing : fail('resource is null'));
  const headOf = (uid) => get(`users/${uid}`);

  const isOwner = (uid) => and(
    () => not(eq(r.auth, null)),
    () => eq(member(r.auth, 'uid'), uid),
    () => eq(member(member(r.auth, 'token'), 'email_verified'), true));

  function validSync(kind) {
    const s = once(() => member(incoming(), '_sync'));
    const f = (k) => member(s(), k);
    return and(
      () => is(s(), 'map'),
      () => hasAll(keys(s()), ['rev', 'key', 'deleted', 'by', 'at']),
      () => hasOnly(keys(s()), ['rev', 'key', 'deleted', 'by', 'at', 'id', 'project', 'list']),
      () => is(f('rev'), 'int'), () => gt(f('rev'), 0n),
      () => is(f('key'), 'string'), () => gt(size(f('key')), 0n), () => le(size(f('key')), 64n),
      () => is(f('deleted'), 'bool'),
      () => is(f('by'), 'string'), () => le(size(f('by')), 64n),
      () => eq(f('at'), time),
      () => or(() => not(inOp('id', s())), () => and(() => is(f('id'), 'string'), () => le(size(f('id')), 1500n))),
      () => or(
        () => eq(kind, 'project'),
        () => and(
          () => is(f('project'), 'string'), () => gt(size(f('project')), 0n), () => le(size(f('project')), 1500n),
          () => inOp(f('list'), ['notes', 'used', 'combined']))));
  }

  const validShape = () => cond(
    () => eq(member(member(incoming(), '_sync'), 'deleted'), true),
    () => hasOnly(keys(incoming()), ['_sync']),
    () => le(size(keys(incoming())), 200n));

  const revMovesForward = () => gt(member(member(incoming(), '_sync'), 'rev'), member(member(resource(), '_sync'), 'rev'));

  function mayHardDelete(uid) {
    const head = once(() => headOf(uid));
    return or(
      () => eq(getOr(head(), 'deleting', false), true),
      () => and(
        () => eq(member(member(resource(), '_sync'), 'deleted'), true),
        () => le(member(member(resource(), '_sync'), 'rev'), getOr(head(), 'minRev', 0n))));
  }

  const inc = (k) => member(incoming(), k);
  const res = (k) => member(resource(), k);

  // A query names a collection; its rules are those of a document inside it.
  const seg = r.path.split('/');
  const doc = r.method === 'list' ? [...seg, null] : seg;
  if (doc.length % 2 !== 0 || doc[0] !== 'users') return [];
  const uid = doc[1];
  const m = r.method;

  if (doc.length === 2) { // match /users/{uid}
    if (m === 'get') return [() => isOwner(uid)];
    if (m === 'create') {
      return [() => and(
        () => isOwner(uid),
        () => le(size(keys(incoming())), 50n),
        () => is(inc('schema'), 'int'), () => ge(inc('schema'), 1n),
        () => eq(inc('rev'), 1n),
        () => eq(inc('minRev'), 0n),
        () => eq(inc('deleting'), false),
        () => eq(inc('createdAt'), time),
        () => eq(inc('updatedAt'), time))];
    }
    if (m === 'update') {
      return [() => and(
        () => isOwner(uid),
        () => le(size(keys(incoming())), 50n),
        () => or(
          () => and(
            () => eq(res('deleting'), false),
            () => eq(inc('deleting'), false),
            () => eq(inc('rev'), add(res('rev'), 1n)),
            () => is(inc('schema'), 'int'), () => ge(inc('schema'), res('schema')),
            () => is(inc('minRev'), 'int'), () => ge(inc('minRev'), res('minRev')),
            () => le(inc('minRev'), inc('rev')),
            () => eq(inc('createdAt'), res('createdAt')),
            () => eq(inc('updatedAt'), time)),
          () => and(
            () => hasOnly(affectedKeys(incoming(), resource()), ['deleting', 'deletingAt']),
            () => eq(inc('deleting'), true),
            () => eq(inc('deletingAt'), time))))];
    }
    if (m === 'delete') return [() => and(() => isOwner(uid), () => eq(res('deleting'), true))];
    return [];
  }
  if (doc.length !== 4) return [];

  const [, , collection, id] = doc;
  const read = m === 'get' || m === 'list';
  switch (collection) {
    case 'projects':
    case 'notes': {
      const kind = collection === 'projects' ? 'project' : 'note';
      if (read) return [() => isOwner(uid)];
      if (m === 'create') return [() => and(() => isOwner(uid), () => validSync(kind), validShape)];
      if (m === 'update') return [() => and(() => isOwner(uid), () => validSync(kind), validShape, revMovesForward)];
      if (m === 'delete') return [() => and(() => isOwner(uid), () => mayHardDelete(uid))];
      return [];
    }
    case 'trash': {
      if (read) return [() => isOwner(uid)];
      if (m === 'create' || m === 'update') {
        return [() => and(
          () => isOwner(uid),
          () => hasOnly(keys(incoming()), ['kind', 'data', 'rev', 'project', 'list', 'by', 'deletedAt', 'expireAt']),
          () => inOp(inc('kind'), ['project', 'note']),
          () => is(inc('data'), 'string'),
          () => is(inc('rev'), 'int'),
          () => is(inc('by'), 'string'), () => le(size(inc('by')), 64n),
          () => eq(inc('deletedAt'), time),
          () => is(inc('expireAt'), 'timestamp'),
          () => gt(inc('expireAt'), time),
          () => lt(inc('expireAt'), add(time, durationValue(40n, 'd'))))];
      }
      if (m === 'delete') return [() => and(() => isOwner(uid), () => eq(getOr(headOf(uid), 'deleting', false), true))];
      return [];
    }
    case 'devices': {
      if (read) return [() => isOwner(uid)];
      if (m === 'create' || m === 'update') {
        return [() => and(
          () => isOwner(uid),
          () => matches(id, '[a-f0-9]{32}'),
          () => eq(getOr(headOf(uid), 'deleting', false), false),
          () => hasOnly(keys(incoming()), ['name', 'platform', 'appVersion', 'lastSeenAt', 'lastRev', 'view', 'drafts', 'settings']),
          () => is(inc('name'), 'string'), () => le(size(inc('name')), 60n),
          () => inOp(inc('platform'), ['darwin', 'win32', 'linux']),
          () => eq(inc('lastSeenAt'), time),
          () => or(() => not(inOp('view', incoming())), () => and(() => is(inc('view'), 'string'), () => le(size(inc('view')), 700000n))),
          () => or(() => not(inOp('drafts', incoming())), () => and(() => is(inc('drafts'), 'string'), () => le(size(inc('drafts')), 200000n))),
          () => or(() => not(inOp('settings', incoming())), () => and(
            () => is(inc('settings'), 'map'),
            () => hasOnly(keys(inc('settings')), ['theme', 'model', 'language', 'hint', 'hotkey', 'shotHotkey', 'hideAfterCopy']))))];
      }
      if (m === 'delete') return [() => and(() => isOwner(uid), () => eq(getOr(headOf(uid), 'deleting', false), true))];
      return [];
    }
    default:
      return [];
  }
}

// ---- storage.rules (paths inside /b/{bucket}/o)

function storageRules(r, get) {
  const seg = r.path ? r.path.split('/') : [];
  if (seg.length < 2 || seg[0] !== 'users') return [];
  const uid = seg[1];
  const incoming = () => (r.incoming instanceof Map ? r.incoming : fail('request.resource is null'));
  // resource: the metadata of the file stored at the path before the request, or null when there is none.
  const resource = () => r.existing ?? null;
  const isOwner = () => and(
    () => not(eq(r.auth, null)),
    () => eq(member(r.auth, 'uid'), uid),
    () => eq(member(member(r.auth, 'token'), 'email_verified'), true));
  const deleting = () => getOr(get(`users/${uid}`), 'deleting', false);

  const out = [];
  if (r.method === 'list') out.push(isOwner); // match /users/{uid}/{allPaths=**}: zero or more segments
  if (seg.length === 4 && seg[2] === 'images') { // match /users/{uid}/images/{name}
    const name = seg[3];
    if (r.method === 'get') out.push(isOwner);
    if (r.method === 'create') {
      out.push(() => and(
        isOwner,
        () => eq(resource(), null),
        () => matches(name, '[a-f0-9]{32}([.]t)?[.]png'),
        () => gt(member(incoming(), 'size'), 0n),
        () => le(member(incoming(), 'size'), 40n * 1024n * 1024n),
        () => eq(member(incoming(), 'contentType'), 'image/png'),
        () => eq(deleting(), false)));
    }
    if (r.method === 'update') out.push(() => false);
    if (r.method === 'delete') out.push(() => and(isOwner, () => eq(deleting(), true)));
  }
  return out;
}

// ---- evaluation

// A request in rules values:
//   { service: 'firestore' | 'storage', method: 'get' | 'list' | 'create' | 'update' | 'delete', path,
//     auth: authValue(...) | null, time: Timestamp, existing: Map | null, incoming: Map | null,
//     head: Map | null, or a function (path) → Map | null }
// path is relative to /databases/(default)/documents or to the bucket, as in tests/rules/cases.js. existing is
// resource (in Storage, a create over a stored file has it too) and incoming is request.resource. head is
// what get() returns for users/{uid}: for a function, the data of the document at that path.
// Returns { allow, calls, limited, reason }.
function evaluate(r, { limit } = {}) {
  const state = { calls: 0, limit: limit ?? (r.service === 'storage' ? 2 : 10) };
  const ownHead = `users/${r.path.split('/')[1]}`;
  const get = (path) => {
    state.calls += 1;
    if (state.calls > state.limit) throw new LimitError(`more than ${state.limit} access calls`);
    const data = typeof r.head === 'function' ? r.head(path) : path === ownHead ? r.head : null;
    if (!(data instanceof Map)) fail(`get(${path}): no such document`);
    return data;
  };
  let reason = 'no rule allows it';
  try {
    const rules = r.service === 'storage' ? storageRules(r, get) : r.service === 'firestore' ? firestoreRules(r, get) : [];
    for (const rule of rules) {
      try {
        if (rule() === true) return { allow: true, calls: state.calls, limited: false, reason: null };
        reason = 'a condition is false';
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        reason = e.message;
      }
    }
  } catch (e) {
    if (!(e instanceof LimitError)) throw e;
    return { allow: false, calls: state.calls, limited: true, reason: e.message };
  }
  return { allow: false, calls: state.calls, limited: false, reason };
}

// request.auth for { uid, verified } (a case's auth, or the mock's verified ID token), or null.
function authValue(auth) {
  if (!auth) return null;
  const token = new Map([['email_verified', auth.verified === true]]);
  if (typeof auth.email === 'string') token.set('email', auth.email);
  return new Map([['uid', auth.uid], ['token', token]]);
}

// A value of tests/rules/cases.js: { $ts: ms } is a timestamp and an integral number is an int.
function fromCase(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v) : v;
  if (Array.isArray(v)) return v.map(fromCase);
  if (typeof v === 'object') {
    const k = Object.keys(v);
    if (k.length === 1 && k[0] === '$ts') return Timestamp.ofMillis(v.$ts);
    return new Map(k.map((key) => [key, fromCase(v[key])]));
  }
  throw new TypeError('not a case value');
}

function evaluateCase(c, opts) {
  return evaluate({
    service: c.service,
    method: c.method,
    path: c.path,
    auth: authValue(c.auth),
    time: fromCase(c.time),
    existing: c.existing === null ? null : fromCase(c.existing),
    incoming: c.incoming === null ? null : fromCase(c.incoming),
    head: c.head === null ? null : fromCase(c.head),
  }, opts);
}

// A rules text without comments and blank lines, hashed: what the twin was written from.
function fingerprint(text) {
  const code = String(text).replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .join('\n');
  return crypto.createHash('sha256').update(code).digest('hex');
}

const FINGERPRINTS = {
  firestore: 'f4a54a7b5a42c3d317804358abf5ab868550dc3c66a4d01131c13507089a2754',
  storage: '7b252928b2ba8ed42995e07ab2e102a176d17e3a87a351bca573b0d12eb72ea1',
};

module.exports = {
  evaluate, evaluateCase, authValue, fromCase, fingerprint, FINGERPRINTS, compareStrings,
  Timestamp, Duration, Bytes, LatLng, Path, RuleError,
};
