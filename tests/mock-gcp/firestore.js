'use strict';
// The GCP mock's Cloud Firestore REST v1 (ai_memory/15, 7.2) for the (default) database: GET a document,
// :batchGet, :runQuery (answered as a JSON array) and :commit, with Google-shaped errors. Every read and write
// goes through the rules twin (rules.js) with its access calls counted: at most 10 per document, 20 per
// commit or batchGet. A commit is atomic: every precondition first, then the rules for every write, then all
// writes at once. Update and commit times have microseconds; REQUEST_TIME has milliseconds, as the REST
// reference says, and is the rules' request.time. remote(uid), the other computer, commits the same way.

const crypto = require('node:crypto');
const rules = require('./rules');
const { reply } = require('./server');

const OTHER_DEVICE = 'b0'.repeat(16);
const DAY = 24 * 60 * 60 * 1000;
const MAX_DOC_BYTES = 1048576;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 100; // Firestore allows 20 levels; the mock only stops runaway input
const LONE_SURROGATE = /\p{Surrogate}/u;
const RESERVED = /^__[\s\S]*__$/;
const SIMPLE_SEGMENT = /^[A-Za-z_][A-Za-z_0-9]*$/;
const PLAIN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const KINDS = new Set([
  'nullValue', 'booleanValue', 'integerValue', 'doubleValue', 'timestampValue', 'stringValue', 'bytesValue',
  'referenceValue', 'geoPointValue', 'arrayValue', 'mapValue',
]);
const FIELD_OPS = new Set([
  'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'EQUAL', 'NOT_EQUAL', 'ARRAY_CONTAINS',
  'IN', 'ARRAY_CONTAINS_ANY', 'NOT_IN',
]);
const INEQUALITIES = new Set([
  'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'NOT_EQUAL', 'NOT_IN', 'IS_NOT_NAN', 'IS_NOT_NULL',
]);
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const CLASS_ORDER = [
  'nullValue', 'booleanValue', 'number', 'timestampValue', 'stringValue', 'bytesValue', 'referenceValue',
  'geoPointValue', 'arrayValue', 'mapValue',
];

class ApiError extends Error {
  constructor(status, word, message) {
    super(message);
    this.status = status;
    this.word = word;
  }
}

// What remote(uid) throws when the mock refuses the other computer's change.
class MockError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MockError';
    this.status = status;
    this.code = code;
  }
}

const bad = (message) => { throw new ApiError(400, 'INVALID_ARGUMENT', message); };
const deniedError = () => new ApiError(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => structuredClone(v);
const kindOf = (v) => Object.keys(v)[0];
const without = (fields, key) => Object.fromEntries(Object.entries(fields).filter(([k]) => k !== key));

// ---- time, as REST writes it (RFC 3339)

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;

// → nanoseconds since the epoch as a BigInt, or null
function parseTimestamp(text) {
  const m = typeof text === 'string' ? TIMESTAMP.exec(text) : null;
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[4].toUpperCase()}`);
  if (!Number.isFinite(ms)) return null;
  return BigInt(ms) * 1000000n + BigInt((m[3] || '0').padEnd(9, '0'));
}

// Microseconds → proto3 JSON: Z-normalized, with 0, 3 or 6 fractional digits.
function formatMicros(us) {
  const ms = Math.floor(us / 1000);
  const iso = new Date(ms).toISOString();
  let frac = `${iso.slice(20, 23)}${String(us - ms * 1000).padStart(3, '0')}`;
  if (frac.endsWith('000')) frac = frac.slice(0, 3);
  if (frac === '000') frac = '';
  return `${iso.slice(0, 19)}${frac ? `.${frac}` : ''}Z`;
}

const floorDiv = (a, b) => (a >= 0n ? a / b : -((-a + b - 1n) / b));

// ---- values, kept canonical: one type each, integers as decimal strings, map and array bodies present

function validFieldName(k) {
  return typeof k === 'string' && k !== '' && !RESERVED.test(k) && !LONE_SURROGATE.test(k) && Buffer.byteLength(k) <= 1500;
}

function validId(s) {
  return typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !s.includes('/') && !RESERVED.test(s)
    && !LONE_SURROGATE.test(s) && Buffer.byteLength(s) <= 1500;
}

function normValue(v, depth, inArray) {
  if (!isPlainObject(v)) bad('A value must be an object with exactly one type field.');
  const names = Object.keys(v);
  if (names.length !== 1 || !KINDS.has(names[0])) bad(`A value holds exactly one of ${[...KINDS].join(', ')}.`);
  if (depth > MAX_DEPTH) bad('A value is nested too deeply.');
  const x = v[names[0]];
  switch (names[0]) {
    case 'nullValue':
      if (x !== null && x !== 'NULL_VALUE') bad('Invalid nullValue.');
      return { nullValue: null };
    case 'booleanValue':
      if (typeof x !== 'boolean') bad('Invalid booleanValue.');
      return { booleanValue: x };
    case 'integerValue': {
      let n = null;
      if (typeof x === 'number' && Number.isSafeInteger(x)) n = BigInt(x);
      else if (typeof x === 'string' && /^-?\d{1,19}$/.test(x)) n = BigInt(x);
      if (n === null || n < INT64_MIN || n > INT64_MAX) bad(`Invalid integerValue: ${x}`);
      return { integerValue: n.toString() };
    }
    case 'doubleValue':
      if (typeof x === 'number') return { doubleValue: x };
      if (x === 'NaN' || x === 'Infinity' || x === '-Infinity') return { doubleValue: x };
      return bad(`Invalid doubleValue: ${x}`);
    case 'timestampValue': {
      const ns = parseTimestamp(x);
      if (ns === null) bad(`Invalid timestampValue: ${x}`);
      return { timestampValue: formatMicros(Number(floorDiv(ns, 1000n))) }; // Firestore keeps microseconds
    }
    case 'stringValue':
      if (typeof x !== 'string' || LONE_SURROGATE.test(x)) bad('Invalid stringValue: not valid UTF-8.');
      return { stringValue: x };
    case 'bytesValue':
      if (typeof x !== 'string' || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(x)) bad('Invalid bytesValue.');
      return { bytesValue: Buffer.from(x, 'base64').toString('base64') };
    case 'referenceValue': {
      const m = typeof x === 'string' ? /^projects\/[^/]+\/databases\/[^/]+\/documents\/(.+)$/.exec(x) : null;
      const seg = m ? m[1].split('/') : [];
      if (!m || seg.length % 2 || !seg.every(validId)) bad(`Invalid referenceValue: ${x}`);
      return { referenceValue: x };
    }
    case 'geoPointValue': {
      const lat = x?.latitude ?? 0;
      const lng = x?.longitude ?? 0;
      if (!isPlainObject(x) || typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        bad('Invalid geoPointValue.');
      }
      return { geoPointValue: { latitude: lat, longitude: lng } };
    }
    case 'arrayValue':
      if (inArray) bad('Cannot convert an array value in an array value.');
      if (!isPlainObject(x) || (x.values !== undefined && !Array.isArray(x.values))) bad('Invalid arrayValue.');
      return { arrayValue: { values: (x.values || []).map((y) => normValue(y, depth + 1, true)) } };
    default: // mapValue
      if (!isPlainObject(x)) bad('Invalid mapValue.');
      return { mapValue: { fields: normFields(x.fields ?? {}, depth + 1) } };
  }
}

function normFields(fields, depth) {
  if (!isPlainObject(fields)) bad('fields must be a map.');
  const out = {};
  for (const k of Object.keys(fields)) {
    if (!validFieldName(k)) bad(`Invalid field name: ${JSON.stringify(k)}.`);
    out[k] = normValue(fields[k], depth, false);
  }
  return out;
}

// 'a.b', 'a.`b.c`' → ['a', 'b'], ['a', 'b.c']
function parseFieldPath(text) {
  if (typeof text !== 'string' || !text) bad('A field path is empty.');
  const segs = [];
  for (let i = 0; ;) {
    let seg = '';
    if (text[i] === '`') {
      for (i++; i < text.length && text[i] !== '`'; i++) {
        if (text[i] === '\\') i++;
        seg += text[i] ?? '';
      }
      if (text[i] !== '`') bad(`Invalid field path: ${text}`);
      i++;
    } else {
      const end = text.indexOf('.', i);
      seg = text.slice(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
      if (!SIMPLE_SEGMENT.test(seg)) bad(`Invalid field path: ${text}. Quote a segment like this one with backticks.`);
    }
    if (!validFieldName(seg)) bad(`Invalid field path: ${text}`);
    segs.push(seg);
    if (i === text.length) return segs;
    if (text[i] !== '.' || i === text.length - 1) bad(`Invalid field path: ${text}`);
    i++;
  }
}

const pathKey = (segs) => segs.map((s) => (SIMPLE_SEGMENT.test(s) ? s : `\`${s.replace(/[`\\]/g, '\\$&')}\``)).join('.');

function getField(fields, segs) {
  let cur = fields;
  for (let i = 0; i < segs.length; i++) {
    const v = Object.hasOwn(cur, segs[i]) ? cur[segs[i]] : undefined;
    if (v === undefined || i === segs.length - 1) return v;
    if (!v.mapValue) return undefined;
    cur = v.mapValue.fields;
  }
  return undefined;
}

// Creates the maps on the way, replacing anything that isn't one.
function setField(fields, segs, value) {
  let cur = fields;
  for (let i = 0; i < segs.length - 1; i++) {
    let v = Object.hasOwn(cur, segs[i]) ? cur[segs[i]] : undefined;
    if (!v?.mapValue) {
      v = { mapValue: { fields: {} } };
      cur[segs[i]] = v;
    }
    cur = v.mapValue.fields;
  }
  cur[segs[segs.length - 1]] = value;
}

function deleteField(fields, segs) {
  let cur = fields;
  for (let i = 0; i < segs.length - 1; i++) {
    const v = Object.hasOwn(cur, segs[i]) ? cur[segs[i]] : undefined;
    if (!v?.mapValue) return;
    cur = v.mapValue.fields;
  }
  delete cur[segs[segs.length - 1]];
}

// Masked fields come from the write, or are deleted when the write lacks them; the rest stay.
function applyMask(base, fields, mask) {
  const out = clone(base);
  for (const segs of mask) {
    const v = getField(fields, segs);
    if (v === undefined) deleteField(out, segs);
    else setField(out, segs, clone(v));
  }
  return out;
}

function project(fields, paths) {
  const out = {};
  for (const segs of paths) {
    const v = getField(fields, segs);
    if (v !== undefined) setField(out, segs, clone(v));
  }
  return out;
}

// REST answers leave out empty map and array bodies, and a document without fields has no fields key.
function outValue(v) {
  switch (kindOf(v)) {
    case 'arrayValue': return v.arrayValue.values.length ? { arrayValue: { values: v.arrayValue.values.map(outValue) } } : { arrayValue: {} };
    case 'mapValue': return Object.keys(v.mapValue.fields).length ? { mapValue: { fields: outFields(v.mapValue.fields) } } : { mapValue: {} };
    default: return v;
  }
}
const outFields = (fields) => Object.fromEntries(Object.keys(fields).map((k) => [k, outValue(fields[k])]));

// The rules' view of a value.
function toRules(v) {
  switch (kindOf(v)) {
    case 'nullValue': return null;
    case 'booleanValue': return v.booleanValue;
    case 'integerValue': return BigInt(v.integerValue);
    case 'doubleValue': return Number(v.doubleValue);
    case 'timestampValue': return new rules.Timestamp(parseTimestamp(v.timestampValue));
    case 'stringValue': return v.stringValue;
    case 'bytesValue': return new rules.Bytes(Buffer.from(v.bytesValue, 'base64'));
    case 'referenceValue': return new rules.Path(v.referenceValue);
    case 'geoPointValue': return new rules.LatLng(v.geoPointValue.latitude, v.geoPointValue.longitude);
    case 'arrayValue': return v.arrayValue.values.map(toRules);
    default: return toRulesFields(v.mapValue.fields);
  }
}
const toRulesFields = (fields) => new Map(Object.keys(fields).map((k) => [k, toRules(fields[k])]));

// Plain JSON for inspection: numbers as numbers, timestamps as their RFC 3339 text.
function plain(v) {
  switch (kindOf(v)) {
    case 'nullValue': return null;
    case 'booleanValue': return v.booleanValue;
    case 'integerValue': return Number(v.integerValue);
    case 'doubleValue': return Number(v.doubleValue);
    case 'timestampValue': return v.timestampValue;
    case 'stringValue': return v.stringValue;
    case 'bytesValue': return v.bytesValue;
    case 'referenceValue': return v.referenceValue;
    case 'geoPointValue': return { ...v.geoPointValue };
    case 'arrayValue': return v.arrayValue.values.map(plain);
    default: return plainFields(v.mapValue.fields);
  }
}
const plainFields = (fields) => Object.fromEntries(Object.keys(fields).map((k) => [k, plain(fields[k])]));

// JSON → a value: an integral number is an integer and { $ts: ms } a timestamp.
function typed(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isSafeInteger(v)) return { integerValue: String(v) };
    return { doubleValue: Number.isFinite(v) ? v : String(v) };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
  if (typeof v === 'object') {
    const k = Object.keys(v);
    if (k.length === 1 && k[0] === '$ts') return { timestampValue: formatMicros(v.$ts * 1000) };
    return { mapValue: { fields: typedFields(v) } };
  }
  throw new TypeError(`GCP mock: can't store a ${typeof v}`);
}
const typedFields = (obj) => Object.fromEntries(Object.keys(obj).filter((k) => obj[k] !== undefined).map((k) => [k, typed(obj[k])]));

// Canonical text of a value: equal values give equal text.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

// ---- storage size (Firestore's formula) and ordering

const stringSize = (s) => Buffer.byteLength(s, 'utf8') + 1;

function valueSize(v) {
  switch (kindOf(v)) {
    case 'nullValue': case 'booleanValue': return 1;
    case 'integerValue': case 'doubleValue': case 'timestampValue': return 8;
    case 'geoPointValue': return 16;
    case 'stringValue': return stringSize(v.stringValue);
    case 'bytesValue': return Buffer.from(v.bytesValue, 'base64').length;
    case 'referenceValue': return v.referenceValue.split('/').slice(5).reduce((n, s) => n + stringSize(s), 16);
    case 'arrayValue': return v.arrayValue.values.reduce((n, x) => n + valueSize(x), 0);
    default: return fieldsSize(v.mapValue.fields);
  }
}
const fieldsSize = (fields) => Object.keys(fields).reduce((n, k) => n + stringSize(k) + valueSize(fields[k]), 0);
const documentSize = (path, fields) => path.split('/').reduce((n, s) => n + stringSize(s), 16) + fieldsSize(fields) + 32;

const typeClass = (v) => { const k = kindOf(v); return k === 'integerValue' || k === 'doubleValue' ? 'number' : k; };
const isNaNValue = (v) => kindOf(v) === 'doubleValue' && Number.isNaN(Number(v.doubleValue));

function compareNumbers(a, b) {
  const x = kindOf(a) === 'integerValue' ? BigInt(a.integerValue) : Number(a.doubleValue);
  const y = kindOf(b) === 'integerValue' ? BigInt(b.integerValue) : Number(b.doubleValue);
  const nx = typeof x === 'number' && Number.isNaN(x);
  const ny = typeof y === 'number' && Number.isNaN(y);
  if (nx || ny) return nx === ny ? 0 : nx ? -1 : 1; // NaN sorts first
  if (typeof x === 'bigint' && typeof y === 'bigint') return x < y ? -1 : x > y ? 1 : 0;
  return Number(x) < Number(y) ? -1 : Number(x) > Number(y) ? 1 : 0;
}

function compareNames(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = rules.compareStrings(x[i], y[i]);
    if (c) return c;
  }
  return x.length - y.length;
}

// Firestore's order of values: by type (numbers together), then by value.
function compareValues(a, b) {
  const ca = typeClass(a);
  const cb = typeClass(b);
  if (ca !== cb) return CLASS_ORDER.indexOf(ca) - CLASS_ORDER.indexOf(cb);
  switch (ca) {
    case 'nullValue': return 0;
    case 'booleanValue': return Number(a.booleanValue) - Number(b.booleanValue);
    case 'number': return compareNumbers(a, b);
    case 'timestampValue': {
      const x = parseTimestamp(a.timestampValue);
      const y = parseTimestamp(b.timestampValue);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case 'stringValue': return rules.compareStrings(a.stringValue, b.stringValue);
    case 'bytesValue': return Buffer.compare(Buffer.from(a.bytesValue, 'base64'), Buffer.from(b.bytesValue, 'base64'));
    case 'referenceValue': return compareNames(a.referenceValue, b.referenceValue);
    case 'geoPointValue':
      return Math.sign(a.geoPointValue.latitude - b.geoPointValue.latitude) || Math.sign(a.geoPointValue.longitude - b.geoPointValue.longitude);
    case 'arrayValue': {
      const x = a.arrayValue.values;
      const y = b.arrayValue.values;
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = compareValues(x[i], y[i]);
        if (c) return c;
      }
      return x.length - y.length;
    }
    default: {
      const x = a.mapValue.fields;
      const y = b.mapValue.fields;
      const kx = Object.keys(x).sort(rules.compareStrings);
      const ky = Object.keys(y).sort(rules.compareStrings);
      for (let i = 0; i < Math.min(kx.length, ky.length); i++) {
        const c = rules.compareStrings(kx[i], ky[i]) || compareValues(x[kx[i]], y[ky[i]]);
        if (c) return c;
      }
      return kx.length - ky.length;
    }
  }
}
const valuesEqual = (a, b) => compareValues(a, b) === 0;

// ---- ids and order keys, as the app makes them (src/cloud/codec.js docId, ai_memory/15 4.5 keyBetween)

function docIdOf(id) {
  const s = String(id);
  if (PLAIN_ID.test(s) && !RESERVED.test(s)) return s;
  const bytes = LONE_SURROGATE.test(s) ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf8');
  return `x-${crypto.createHash('sha256').update(bytes).digest('base64url')}`;
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function keyBetween(a, b) {
  a = a || '';
  if (b != null && !(a < b)) throw new RangeError('keyBetween: a must sort before b');
  let out = '';
  for (let i = 0; ; i++) {
    const da = i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const db = b != null && i < b.length ? DIGITS.indexOf(b[i]) : 62;
    if (da === db) {
      out += DIGITS[da];
      continue;
    }
    if (db - da > 1) return out + DIGITS[(da + db) >> 1];
    out += DIGITS[da];
    b = null;
  }
}

// ---- the service

function createFirestore({ projectId, clock, ids, auth, denied }) {
  const ROOT = `projects/${projectId}/databases/(default)/documents`;
  const docs = new Map(); // path → { fields, createTime, updateTime } (times in µs)
  const children = new Map(); // collection path → Set of its document paths
  let bumps = [];

  const fullName = (path) => `${ROOT}/${path}`;
  const timeOf = (us) => new rules.Timestamp(BigInt(us) * 1000n);
  const nowTimestamp = () => timeOf(Math.floor(clock.now() * 1000));
  const rulesData = (path) => {
    const d = docs.get(path);
    return d ? toRulesFields(d.fields) : null;
  };

  function pathOfName(name) {
    if (typeof name !== 'string' || !name.startsWith(`${ROOT}/`)) return null;
    const path = name.slice(ROOT.length + 1);
    const seg = path.split('/');
    return seg.length % 2 === 0 && seg.every(validId) ? path : null;
  }

  function store(path, doc) {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (doc) {
      docs.set(path, doc);
      let set = children.get(parent);
      if (!set) children.set(parent, (set = new Set()));
      set.add(path);
    } else {
      docs.delete(path);
      children.get(parent)?.delete(path);
    }
  }

  function docJson(path, doc, select = null) {
    const json = { name: fullName(path) };
    const fields = select ? project(doc.fields, select) : doc.fields;
    if (Object.keys(fields).length) json.fields = outFields(fields);
    json.createTime = formatMicros(doc.createTime);
    json.updateTime = formatMicros(doc.updateTime);
    return json;
  }

  // The rules twin, behind denyDoc().
  function check(method, path, user, { existing = null, incoming = null, time = nowTimestamp(), limit = 10 } = {}) {
    if (denied.has(path)) return { allow: false, calls: 0 };
    return rules.evaluate({
      service: 'firestore',
      method,
      path,
      auth: rules.authValue(user),
      time,
      existing: existing && toRulesFields(existing.fields),
      incoming: incoming && toRulesFields(incoming.fields),
      head: rulesData,
    }, { limit });
  }

  // /firestore.googleapis.com/v1/projects/P/databases/D/documents[/path][:verb]; ':' in an id arrives as %3A.
  function parseRoute(pathname) {
    const raw = pathname.split('/').slice(2);
    let verb = null;
    const last = raw.length - 1;
    const colon = raw[last]?.indexOf(':') ?? -1;
    if (colon >= 0) {
      verb = raw[last].slice(colon + 1);
      raw[last] = raw[last].slice(0, colon);
    }
    let seg;
    try {
      seg = raw.map(decodeURIComponent);
    } catch {
      return null;
    }
    if (seg[0] !== 'v1' || seg[1] !== 'projects' || seg[3] !== 'databases' || seg[5] !== 'documents') return null;
    return { project: seg[2], database: seg[4], path: seg.slice(6), verb };
  }

  function classify(req) {
    const r = parseRoute(req.pathname);
    if (!r) return { op: null };
    if (req.method === 'GET' && !r.verb) return { op: 'get', doc: r.path.join('/') };
    if (req.method === 'POST' && r.verb === 'runQuery') return { op: 'runQuery', parent: r.path.join('/') };
    if (req.method === 'POST' && (r.verb === 'commit' || r.verb === 'batchGet')) return { op: r.verb };
    return { op: null };
  }

  function jsonBody(req) {
    let v;
    try {
      v = JSON.parse(req.body.toString('utf8'));
    } catch {}
    if (!isPlainObject(v)) bad('Invalid JSON payload received.');
    return v;
  }

  function handle(req, entry) {
    const r = parseRoute(req.pathname);
    const stream = r?.verb === 'batchGet' || r?.verb === 'runQuery';
    try {
      if (!r) throw new ApiError(404, 'NOT_FOUND', 'Not Found');
      if (r.project !== projectId || r.database !== '(default)') {
        throw new ApiError(404, 'NOT_FOUND', `The database ${r.database} does not exist for project ${r.project}.`);
      }
      const user = auth.userFromHeader(req.headers.authorization, 'Bearer');
      if (!user) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials. Expected OAuth 2 access token, '
          + 'login cookie or other valid authentication credential.');
      }
      if (req.body.length > MAX_REQUEST_BYTES) bad(`Request payload size exceeds the limit: ${MAX_REQUEST_BYTES} bytes.`);
      if (req.method === 'GET' && !r.verb) return getDocument(r.path, user, req.query);
      if (req.method === 'POST' && r.verb === 'commit' && !r.path.length) return reply(200, commit(jsonBody(req), user, { entry, bump: true }));
      if (req.method === 'POST' && r.verb === 'batchGet' && !r.path.length) return batchGet(jsonBody(req), user);
      if (req.method === 'POST' && r.verb === 'runQuery') return runQuery(r.path, jsonBody(req), user);
      throw new ApiError(404, 'NOT_FOUND', 'Not Found');
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const error = { error: { code: e.status, message: e.message, status: e.word } };
      return reply(e.status, stream && e.status !== 401 ? [error] : error); // streamed methods fail as an array
    }
  }

  // ---- reads

  function getDocument(seg, user, query) {
    const path = seg.join('/');
    if (!seg.length || seg.length % 2 || !seg.every(validId)) bad(`The mock reads documents only: ${path}`);
    const doc = docs.get(path) ?? null;
    if (!check('get', path, user, { existing: doc }).allow) throw deniedError();
    if (!doc) throw new ApiError(404, 'NOT_FOUND', `Document "${fullName(path)}" not found.`);
    const mask = query.getAll('mask.fieldPaths');
    return reply(200, docJson(path, doc, mask.length ? mask.map(parseFieldPath) : null));
  }

  function batchGet(req, user) {
    if (req.transaction !== undefined || req.newTransaction !== undefined || req.readTime !== undefined) {
      bad('The mock does not support transactions or readTime.');
    }
    if (!Array.isArray(req.documents)) bad('documents must be a list.');
    const paths = req.documents.map((n) => pathOfName(n) ?? bad(`Invalid document name: ${n}`));
    let mask = null;
    if (req.mask !== undefined) {
      if (!isPlainObject(req.mask) || !Array.isArray(req.mask.fieldPaths ?? [])) bad('Invalid mask.');
      mask = (req.mask.fieldPaths ?? []).map(parseFieldPath);
    }
    let calls = 0;
    for (const path of paths) {
      const verdict = check('get', path, user, { existing: docs.get(path) ?? null, limit: Math.min(10, 20 - calls) });
      calls += verdict.calls;
      if (!verdict.allow) throw deniedError();
    }
    const readTime = formatMicros(clock.readMicros());
    return reply(200, paths.map((path, i) => {
      const doc = docs.get(path);
      return doc ? { found: docJson(path, doc, mask), readTime } : { missing: req.documents[i], readTime };
    }));
  }

  function fieldRef(ref) {
    const text = isPlainObject(ref) ? ref.fieldPath : undefined;
    if (text === '__name__') return { key: '__name__', segs: null };
    const segs = parseFieldPath(text);
    return { key: pathKey(segs), segs };
  }

  function parseFilter(f) {
    if (!isPlainObject(f) || Object.keys(f).length !== 1) bad('A filter is one of compositeFilter, fieldFilter or unaryFilter.');
    if (f.compositeFilter !== undefined) {
      const c = f.compositeFilter;
      if (!isPlainObject(c) || !['AND', 'OR'].includes(c.op) || !Array.isArray(c.filters) || !c.filters.length) bad('Invalid compositeFilter.');
      return { type: 'composite', op: c.op, filters: c.filters.map(parseFilter) };
    }
    if (f.fieldFilter !== undefined) {
      const c = f.fieldFilter;
      if (!isPlainObject(c) || !FIELD_OPS.has(c.op)) bad(`Invalid fieldFilter operator: ${c?.op}`);
      const ref = fieldRef(c.field);
      const value = normValue(c.value, 1, false);
      if (['IN', 'NOT_IN', 'ARRAY_CONTAINS_ANY'].includes(c.op) && kindOf(value) !== 'arrayValue') bad(`${c.op} needs an array value.`);
      if (ref.segs === null && !['IN', 'NOT_IN'].includes(c.op) && kindOf(value) !== 'referenceValue') bad('A __name__ filter needs a reference value.');
      return { type: 'field', ...ref, op: c.op, value };
    }
    if (f.unaryFilter !== undefined) {
      const c = f.unaryFilter;
      if (!isPlainObject(c) || !['IS_NAN', 'IS_NULL', 'IS_NOT_NAN', 'IS_NOT_NULL'].includes(c.op)) bad(`Invalid unaryFilter operator: ${c?.op}`);
      return { type: 'unary', ...fieldRef(c.field), op: c.op };
    }
    return bad('A filter is one of compositeFilter, fieldFilter or unaryFilter.');
  }

  function inequalities(f, out) {
    if (f?.type === 'composite') for (const x of f.filters) inequalities(x, out);
    else if (f && INEQUALITIES.has(f.op) && !out.some((o) => o.key === f.key)) out.push({ key: f.key, segs: f.segs });
    return out;
  }

  // Order: the explicit orderBy, then inequality fields it lacks (by field path), then __name__ in the last
  // direction, as Firestore adds them.
  function planQuery(q) {
    const where = q.where === undefined ? null : parseFilter(q.where);
    if (q.orderBy !== undefined && !Array.isArray(q.orderBy)) bad('orderBy must be a list.');
    const order = (q.orderBy || []).map((o) => {
      if (!isPlainObject(o)) bad('Invalid orderBy.');
      const dir = o.direction ?? 'ASCENDING';
      if (!['ASCENDING', 'DESCENDING', 'DIRECTION_UNSPECIFIED'].includes(dir)) bad(`Invalid direction: ${dir}`);
      return { ...fieldRef(o.field), desc: dir === 'DESCENDING' };
    });
    for (const f of inequalities(where, []).sort((a, b) => rules.compareStrings(a.key, b.key))) {
      if (!order.some((o) => o.key === f.key)) order.push({ ...f, desc: false });
    }
    if (!order.some((o) => o.key === '__name__')) order.push({ key: '__name__', segs: null, desc: order.length ? order[order.length - 1].desc : false });
    const cursor = (c) => {
      if (!isPlainObject(c) || !Array.isArray(c.values) || !c.values.length) bad('A cursor needs values.');
      if (c.values.length > order.length) bad('Too many cursor values specified. The specified values must match the orderBy() constraints of the query.');
      const values = c.values.map((v, i) => {
        const n = normValue(v, 1, false);
        if (order[i].segs === null && kindOf(n) !== 'referenceValue') bad('A cursor value for __name__ must be a document reference.');
        return n;
      });
      return { values, before: c.before === true };
    };
    const count = (v, what) => {
      const n = isPlainObject(v) ? v.value : v;
      const x = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
      if (!Number.isSafeInteger(x) || x < 0) bad(`Invalid ${what}.`);
      return x;
    };
    let select = null;
    if (q.select !== undefined) {
      if (!isPlainObject(q.select) || (q.select.fields !== undefined && !Array.isArray(q.select.fields))) bad('Invalid select.');
      select = (q.select.fields || []).map(fieldRef).filter((f) => f.segs).map((f) => f.segs);
    }
    return {
      where,
      order,
      select,
      startAt: q.startAt === undefined ? null : cursor(q.startAt),
      endAt: q.endAt === undefined ? null : cursor(q.endAt),
      offset: q.offset === undefined ? 0 : count(q.offset, 'offset'),
      limit: q.limit === undefined ? null : count(q.limit, 'limit'),
    };
  }

  function matchFilter(f, row, valueOf) {
    if (f.type === 'composite') {
      return f.op === 'AND' ? f.filters.every((x) => matchFilter(x, row, valueOf)) : f.filters.some((x) => matchFilter(x, row, valueOf));
    }
    const v = valueOf(row, f);
    if (v === undefined) return false; // a filter never matches a missing field
    const isNull = kindOf(v) === 'nullValue';
    if (f.type === 'unary') {
      if (f.op === 'IS_NAN') return isNaNValue(v);
      if (f.op === 'IS_NULL') return isNull;
      if (f.op === 'IS_NOT_NAN') return !isNaNValue(v) && !isNull;
      return !isNull;
    }
    const w = f.value;
    const ordered = () => typeClass(v) === typeClass(w) && !isNaNValue(v) && !isNaNValue(w); // same type only
    switch (f.op) {
      case 'EQUAL': return valuesEqual(v, w);
      case 'NOT_EQUAL': return !isNull && !valuesEqual(v, w);
      case 'LESS_THAN': return ordered() && compareValues(v, w) < 0;
      case 'LESS_THAN_OR_EQUAL': return ordered() && compareValues(v, w) <= 0;
      case 'GREATER_THAN': return ordered() && compareValues(v, w) > 0;
      case 'GREATER_THAN_OR_EQUAL': return ordered() && compareValues(v, w) >= 0;
      case 'ARRAY_CONTAINS': return kindOf(v) === 'arrayValue' && v.arrayValue.values.some((x) => valuesEqual(x, w));
      case 'IN': return w.arrayValue.values.some((x) => valuesEqual(v, x));
      case 'NOT_IN': return !isNull && !w.arrayValue.values.some((x) => valuesEqual(v, x));
      default: return kindOf(v) === 'arrayValue' && v.arrayValue.values.some((x) => w.arrayValue.values.some((y) => valuesEqual(x, y)));
    }
  }

  function execute(plan, collection) {
    const valueOf = (row, ref) => (ref.segs === null ? { referenceValue: row.name } : getField(row.fields, ref.segs));
    let rows = [...(children.get(collection) || [])]
      .map((path) => ({ path, name: fullName(path), fields: docs.get(path).fields }))
      .filter((row) => (!plan.where || matchFilter(plan.where, row, valueOf)) && plan.order.every((o) => valueOf(row, o) !== undefined));
    rows.sort((a, b) => {
      for (const o of plan.order) {
        const c = compareValues(valueOf(a, o), valueOf(b, o));
        if (c) return o.desc ? -c : c;
      }
      return 0;
    });
    const position = (row, cur) => {
      for (let i = 0; i < cur.values.length; i++) {
        const c = compareValues(valueOf(row, plan.order[i]), cur.values[i]);
        if (c) return plan.order[i].desc ? -c : c;
      }
      return 0;
    };
    if (plan.startAt) rows = rows.filter((row) => (plan.startAt.before ? position(row, plan.startAt) >= 0 : position(row, plan.startAt) > 0));
    if (plan.endAt) rows = rows.filter((row) => (plan.endAt.before ? position(row, plan.endAt) < 0 : position(row, plan.endAt) <= 0));
    rows = rows.slice(plan.offset);
    return plan.limit === null ? rows : rows.slice(0, plan.limit);
  }

  function runQuery(parent, req, user) {
    if (parent.length % 2 || !parent.every(validId)) bad(`Invalid parent: ${parent.join('/')}`);
    if (req.transaction !== undefined || req.newTransaction !== undefined || req.readTime !== undefined) {
      bad('The mock does not support transactions or readTime.');
    }
    const q = req.structuredQuery;
    if (!isPlainObject(q)) bad('structuredQuery is required.');
    const from = q.from;
    if (!Array.isArray(from) || from.length !== 1 || !isPlainObject(from[0]) || !validId(from[0].collectionId)) bad('A query reads exactly one collection.');
    if (from[0].allDescendants) bad('The mock does not support collection group queries.');
    const collection = [...parent, from[0].collectionId].join('/');
    const plan = planQuery(q);
    if (!check('list', collection, user).allow) throw deniedError();
    const rows = execute(plan, collection);
    const readTime = formatMicros(clock.readMicros());
    if (!rows.length) return reply(200, [{ readTime }]);
    return reply(200, rows.map((row) => ({ document: docJson(row.path, docs.get(row.path), plan.select), readTime })));
  }

  // ---- commits

  function parsePrecondition(cd) {
    if (!isPlainObject(cd) || Object.keys(cd).length !== 1) bad('currentDocument sets exactly one of exists or updateTime.');
    if (Object.hasOwn(cd, 'exists')) {
      if (typeof cd.exists !== 'boolean') bad('currentDocument.exists must be a bool.');
      return { exists: cd.exists };
    }
    if (!Object.hasOwn(cd, 'updateTime')) bad('currentDocument sets exactly one of exists or updateTime.');
    const ns = parseTimestamp(cd.updateTime);
    if (ns === null) bad(`Invalid currentDocument.updateTime: ${cd.updateTime}`);
    if (ns % 1000n !== 0n) bad('currentDocument.updateTime must be microsecond aligned.');
    return { updateTime: Number(ns / 1000n) };
  }

  function parseWrite(w, i) {
    if (!isPlainObject(w)) bad(`writes[${i}] must be an object.`);
    const ops = ['update', 'delete', 'transform'].filter((k) => w[k] !== undefined);
    if (ops.length !== 1) bad(`writes[${i}] must have exactly one of update or delete.`);
    if (ops[0] === 'transform') bad('The mock does not support transform writes; use updateTransforms.');
    const out = { update: ops[0] === 'update', path: null, fields: null, mask: null, transforms: [], current: null };
    const name = out.update ? w.update?.name : w.delete;
    out.path = pathOfName(name);
    if (!out.path) bad(`writes[${i}]: invalid document name: ${name}`);
    if (out.update) {
      out.fields = normFields(w.update.fields ?? {}, 1);
      if (w.updateMask !== undefined) {
        const paths = isPlainObject(w.updateMask) ? w.updateMask.fieldPaths ?? [] : null;
        if (!Array.isArray(paths)) bad(`writes[${i}].updateMask must be { fieldPaths: [...] }.`);
        out.mask = paths.map(parseFieldPath);
      }
      if (w.updateTransforms !== undefined) {
        if (!Array.isArray(w.updateTransforms)) bad(`writes[${i}].updateTransforms must be a list.`);
        out.transforms = w.updateTransforms.map((t) => {
          if (!isPlainObject(t) || Object.keys(t).length !== 2 || t.setToServerValue !== 'REQUEST_TIME') {
            bad('The mock supports only { fieldPath, setToServerValue: "REQUEST_TIME" } transforms.');
          }
          return parseFieldPath(t.fieldPath);
        });
      }
    } else if (w.updateMask !== undefined || w.updateTransforms !== undefined) {
      bad(`writes[${i}]: a delete takes no updateMask or updateTransforms.`);
    }
    if (w.currentDocument !== undefined) out.current = parsePrecondition(w.currentDocument);
    return out;
  }

  function precondition(w, before) {
    const c = w.current;
    if (!c) return;
    if (c.exists === true && !before) throw new ApiError(404, 'NOT_FOUND', `No document to update: ${fullName(w.path)}`);
    if (c.exists === false && before) throw new ApiError(409, 'ALREADY_EXISTS', `Document already exists: ${fullName(w.path)}`);
    if (c.updateTime !== undefined && (!before || before.updateTime !== c.updateTime)) {
      throw new ApiError(400, 'FAILED_PRECONDITION',
        `the stored version (${before ? before.updateTime : 0}) does not match the required base version (${c.updateTime})`);
    }
  }

  // What the log shows of a commit: the account, the head's new rev, the number of writes, and tags that
  // pauseAfter() can wait for ('head-create', 'deleting', 'head-delete').
  function describe(entry, steps) {
    const tags = entry.tags ? [...entry.tags] : [];
    const deleting = (d) => d?.fields.deleting?.booleanValue === true;
    entry.writes = steps.length;
    for (const { w, before, after } of steps) {
      const seg = w.path.split('/');
      if (seg[0] === 'users' && entry.uid === undefined) entry.uid = seg[1];
      if (seg.length !== 2 || seg[0] !== 'users') continue;
      if (!after) {
        tags.push('head-delete');
        continue;
      }
      if (!before) tags.push('head-create');
      if (deleting(after) && !deleting(before)) tags.push('deleting');
      if (after.fields.rev?.integerValue !== undefined) entry.rev = Number(after.fields.rev.integerValue);
    }
    entry.tags = tags;
  }

  function commit(req, user, { entry = null, bump = false } = {}) {
    if (req.transaction !== undefined) bad('The mock does not support transactions.');
    if (req.writes !== undefined && !Array.isArray(req.writes)) bad('writes must be a list.');
    const writes = (req.writes || []).map(parseWrite);
    if (bump) runBump(writes, entry);
    const commitMicros = clock.tick();
    const requestMicros = Math.floor(commitMicros / 1000) * 1000;
    const requestTime = { timestampValue: formatMicros(requestMicros) };

    // 1. Preconditions, and each document as it will be.
    const working = new Map();
    const current = (path) => (working.has(path) ? working.get(path) : docs.get(path) ?? null);
    const steps = writes.map((w) => {
      const before = current(w.path);
      precondition(w, before);
      let after = null;
      if (w.update) {
        const fields = w.mask ? applyMask(before ? before.fields : {}, w.fields, w.mask) : clone(w.fields);
        for (const segs of w.transforms) setField(fields, segs, requestTime);
        const bytes = documentSize(w.path, fields);
        if (bytes > MAX_DOC_BYTES) {
          bad(`Document '${fullName(w.path)}' cannot be written because its size (${bytes.toLocaleString('en-US')} bytes) `
            + 'exceeds the maximum allowed size of 1,048,576 bytes.');
        }
        const unchanged = before && stable(before.fields) === stable(fields); // keeps its update time
        after = { fields, createTime: before ? before.createTime : commitMicros, updateTime: unchanged ? before.updateTime : commitMicros };
      }
      working.set(w.path, after);
      return { w, before, after };
    });

    // 2. The rules for every write; get() sees the documents as they were before this commit.
    const time = timeOf(requestMicros);
    let calls = 0;
    for (const { w, before, after } of steps) {
      const method = !w.update ? 'delete' : before ? 'update' : 'create';
      const verdict = check(method, w.path, user, { existing: before, incoming: after, time, limit: Math.min(10, 20 - calls) });
      calls += verdict.calls;
      if (!verdict.allow) throw deniedError();
    }

    // 3. All at once.
    for (const [path, doc] of working) store(path, doc);
    if (entry) describe(entry, steps);
    return {
      writeResults: steps.map(({ w, after }) => {
        if (!after) return {};
        const result = { updateTime: formatMicros(after.updateTime) };
        if (w.transforms.length) result.transformResults = w.transforms.map(() => requestTime);
        return result;
      }),
      commitTime: formatMicros(commitMicros),
    };
  }

  // ---- the other computer

  function runBump(writes, entry) {
    if (!bumps.length) return;
    for (const w of writes) {
      const seg = w.path.split('/');
      if (!w.update || w.current?.updateTime === undefined || seg.length !== 2 || seg[0] !== 'users') continue;
      const arm = bumps.find((a) => a.times > 0 && (a.uid == null || a.uid === seg[1]));
      if (!arm) return;
      arm.times -= 1;
      if (arm.times <= 0) bumps = bumps.filter((a) => a !== arm);
      const was = docs.get(w.path)?.updateTime;
      arm.error = null;
      try {
        const peer = remote(seg[1]);
        if (typeof arm.change === 'function') arm.change(peer);
        else peer.touch();
      } catch (e) {
        arm.error = e;
      }
      // A race that didn't happen must not pass unnoticed: the entry says so, and the commit goes on unraced.
      const moved = docs.get(w.path)?.updateTime !== was;
      if (moved) entry.tags = ['bumped'];
      if (!moved || arm.error) {
        entry.error = `bumpHeadBetweenGetAndCommit: ${moved ? 'change() failed' : "the head didn't move"}`
          + `${arm.error ? `: ${arm.error.message}` : ''}`;
      }
      return;
    }
  }

  // The next commit that moves a head with an updateTime precondition first gets a commit from the other
  // computer (a bare head bump, or change(remote)), so its precondition fails. That commit's log entry is
  // tagged 'bumped'; when change() fails or moves nothing, the entry has an error instead.
  function bumpHeadBetweenGetAndCommit({ uid = null, times = 1, change = null } = {}) {
    const arm = { uid, times, change, error: null };
    bumps.push(arm);
    return () => { bumps = bumps.filter((a) => a !== arm); };
  }

  function remote(uid) {
    if (!validId(uid)) throw new TypeError('remote(uid): uid is a document id');
    const headPath = `users/${uid}`;
    const owner = { uid, verified: true };
    const collectionOf = (kind) => `users/${uid}/${kind === 'project' ? 'projects' : 'notes'}`;
    const syncOf = (fields) => (fields?._sync?.mapValue ? plainFields(fields._sync.mapValue.fields) : {});
    const live = (fields) => Boolean(fields) && syncOf(fields).deleted !== true;
    const refuse = (e) => {
      if (e instanceof ApiError) throw new MockError(e.status, e.word, `remote(${uid}): ${e.message}`);
      throw e;
    };
    // Documents as they will be after this commit's writes so far.
    const view = (ctx, path) => (ctx.pending.has(path) ? ctx.pending.get(path) : docs.get(path)?.fields ?? null);

    function find(ctx, kind, id) {
      const base = collectionOf(kind);
      const direct = `${base}/${docIdOf(id)}`;
      if (view(ctx, direct)) return { path: direct, docId: docIdOf(id) };
      for (const path of children.get(base) || []) {
        if (syncOf(view(ctx, path)).id === id) return { path, docId: path.slice(base.length + 1) };
      }
      return null;
    }

    function need(ctx, kind, id) {
      const hit = find(ctx, kind, id);
      if (!hit || !live(view(ctx, hit.path))) throw new MockError(404, 'NOT_FOUND', `remote(${uid}): no live ${kind} ${id}`);
      return { ...hit, fields: view(ctx, hit.path) };
    }

    // Live projects (the board) or notes, in key order, ties by id.
    function ordered(ctx, kind, where = () => true) {
      const base = collectionOf(kind);
      const paths = new Set(children.get(base) || []);
      for (const p of ctx.pending.keys()) if (p.startsWith(`${base}/`)) paths.add(p);
      const out = [];
      for (const path of paths) {
        const fields = view(ctx, path);
        if (!live(fields)) continue;
        const s = syncOf(fields);
        if (where(s)) out.push({ path, docId: path.slice(base.length + 1), id: s.id ?? path.slice(base.length + 1), key: String(s.key ?? '') });
      }
      return out.sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    function keyFor(list, { index, before, after } = {}) {
      let i = list.length;
      if (Number.isInteger(index)) i = Math.max(0, Math.min(index, list.length));
      else if (before != null && list.some((x) => x.id === before)) i = list.findIndex((x) => x.id === before);
      else if (after != null && list.some((x) => x.id === after)) i = list.findIndex((x) => x.id === after) + 1;
      const lo = i > 0 ? list[i - 1].key : null;
      const hi = i < list.length ? list[i].key : null;
      try {
        return keyBetween(lo, hi);
      } catch {
        return keyBetween(lo, null);
      }
    }

    // A whole item document with _sync.rev = this commit's rev and _sync.at = REQUEST_TIME.
    function put(ctx, kind, path, fields, sync) {
      const s = { rev: ctx.rev, key: sync.key, deleted: sync.deleted === true, by: OTHER_DEVICE };
      if (kind === 'note') {
        s.project = sync.project;
        s.list = sync.list;
      }
      if (sync.id !== undefined) s.id = sync.id;
      const all = { ...fields, _sync: typed(s) };
      ctx.writes.push({ update: { name: fullName(path), fields: all }, updateTransforms: [{ fieldPath: '_sync.at', setToServerValue: 'REQUEST_TIME' }] });
      ctx.pending.set(path, all);
    }

    function trash(ctx, kind, hit) {
      const s = syncOf(hit.fields);
      const data = {};
      for (const k of Object.keys(hit.fields)) if (k !== '_sync' && k !== '_json') data[k] = plain(hit.fields[k]);
      for (const [k, v] of Object.entries(hit.fields._json?.mapValue?.fields || {})) {
        try {
          data[k] = JSON.parse(v.stringValue);
        } catch {
          data[k] = plain(v);
        }
      }
      if (kind === 'note') {
        delete data.copied;
        delete data.lastCopiedAt;
      }
      const fields = typedFields({ kind, data: JSON.stringify(data), rev: ctx.rev, by: OTHER_DEVICE, expireAt: { $ts: ctx.now + 30 * DAY } });
      if (kind === 'note') Object.assign(fields, typedFields({ project: s.project, list: s.list }));
      ctx.writes.push({
        update: { name: fullName(`users/${uid}/trash/${kind}-${hit.docId}`), fields },
        updateTransforms: [{ fieldPath: 'deletedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }

    function tombstone(ctx, kind, hit) {
      const s = syncOf(hit.fields);
      put(ctx, kind, hit.path, {}, { key: s.key, deleted: true, project: s.project, list: s.list, id: s.id });
      trash(ctx, kind, hit);
    }

    function stats(ctx) {
      const notes = ordered(ctx, 'note');
      const images = new Set();
      for (const n of notes) {
        for (const im of view(ctx, n.path).images?.arrayValue?.values || []) {
          const id = im.mapValue?.fields?.id?.stringValue;
          if (id) images.add(id);
        }
      }
      return { projects: ordered(ctx, 'project').length, notes: notes.length, images: images.size };
    }

    // One push: the head moves up by one under an updateTime precondition, with the item writes.
    function push(build) {
      const head = docs.get(headPath);
      if (!head) throw new MockError(404, 'NOT_FOUND', `remote(${uid}): the account has no head`);
      const ctx = {
        rev: Number(head.fields.rev?.integerValue ?? 0) + 1,
        now: Math.floor(clock.now()),
        writes: [],
        pending: new Map(),
        board: head.fields.board?.mapValue ? clone(head.fields.board) : { mapValue: { fields: {} } },
        result: {},
      };
      build(ctx);
      const headWrite = {
        update: {
          name: fullName(headPath),
          fields: { rev: typed(ctx.rev), lastDevice: typed(OTHER_DEVICE), board: ctx.board, stats: typed(stats(ctx)) },
        },
        updateMask: { fieldPaths: ['rev', 'lastDevice', 'board', 'stats'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { updateTime: formatMicros(head.updateTime) },
      };
      try {
        const out = commit({ writes: [headWrite, ...ctx.writes] }, owner);
        return { ...ctx.result, rev: ctx.rev, commitTime: out.commitTime };
      } catch (e) {
        return refuse(e);
      }
    }

    return {
      uid,
      device: OTHER_DEVICE,
      head() {
        const d = docs.get(headPath);
        return d ? plainFields(d.fields) : null;
      },
      createHead({ joiner = 'blank' } = {}) {
        const write = {
          update: {
            name: fullName(headPath),
            fields: typedFields({
              schema: 1, rev: 1, minRev: 0, deleting: false, lastDevice: OTHER_DEVICE, board: { joiner },
              stats: { projects: 0, notes: 0, images: 0 },
            }),
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
          currentDocument: { exists: false },
        };
        try {
          return { rev: 1, commitTime: commit({ writes: [write] }, owner).commitTime };
        } catch (e) {
          return refuse(e);
        }
      },
      touch: () => push(() => {}),
      setJoiner: (joiner) => push((ctx) => { ctx.board.mapValue.fields.joiner = typed(joiner); }),
      addProject(name, { id = ids.uuid('project'), color = 'monstera', index, before, after, fields = {} } = {}) {
        return push((ctx) => {
          if (find(ctx, 'project', id)) throw new MockError(409, 'ALREADY_EXISTS', `remote(${uid}): project ${id} exists`);
          const key = keyFor(ordered(ctx, 'project'), { index, before, after });
          const docId = docIdOf(id);
          put(ctx, 'project', `${collectionOf('project')}/${docId}`, typedFields({ name, color, createdAt: ctx.now, ...fields }),
            { key, id: docId === id ? undefined : id });
          ctx.result.id = id;
        });
      },
      editProject(id, fields = {}) {
        return push((ctx) => {
          const hit = need(ctx, 'project', id);
          put(ctx, 'project', hit.path, { ...without(hit.fields, '_sync'), ...typedFields(fields) }, syncOf(hit.fields));
        });
      },
      addNote(projectId, text, { id = ids.uuid('note'), list = 'notes', index, before, after, fields = {} } = {}) {
        return push((ctx) => {
          need(ctx, 'project', projectId);
          if (find(ctx, 'note', id)) throw new MockError(409, 'ALREADY_EXISTS', `remote(${uid}): note ${id} exists`);
          const key = keyFor(ordered(ctx, 'note', (s) => s.project === projectId && s.list === list), { index, before, after });
          const note = {
            text, images: [], createdAt: ctx.now, updatedAt: ctx.now, usedAt: list === 'notes' ? 0 : ctx.now,
            copied: 0, lastCopiedAt: 0, ...fields,
          };
          const docId = docIdOf(id);
          put(ctx, 'note', `${collectionOf('note')}/${docId}`, typedFields(note), { key, project: projectId, list, id: docId === id ? undefined : id });
          ctx.result.id = id;
        });
      },
      editNote(id, text, fields = {}) {
        return push((ctx) => {
          const hit = need(ctx, 'note', id);
          const changes = typedFields({ ...(text == null ? {} : { text, updatedAt: ctx.now }), ...fields });
          put(ctx, 'note', hit.path, { ...without(hit.fields, '_sync'), ...changes }, syncOf(hit.fields));
        });
      },
      moveNote(id, { project: toProject, list: toList, index, before, after } = {}) {
        return push((ctx) => {
          const hit = need(ctx, 'note', id);
          const s = syncOf(hit.fields);
          const to = { project: toProject ?? s.project, list: toList ?? s.list };
          if (to.project !== s.project) need(ctx, 'project', to.project);
          const siblings = ordered(ctx, 'note', (x) => x.project === to.project && x.list === to.list).filter((x) => x.path !== hit.path);
          const fields = without(hit.fields, '_sync');
          if (to.list !== 'notes' && to.list !== s.list) fields.usedAt = typed(ctx.now);
          put(ctx, 'note', hit.path, fields, { ...s, ...to, key: keyFor(siblings, { index, before, after }) });
        });
      },
      copy(id, n = 1) {
        return push((ctx) => {
          const hit = need(ctx, 'note', id);
          const was = Number(plain(hit.fields.copied ?? typed(0))) || 0;
          put(ctx, 'note', hit.path, { ...without(hit.fields, '_sync'), copied: typed(was + n), lastCopiedAt: typed(ctx.now) }, syncOf(hit.fields));
        });
      },
      deleteNote(id) {
        return push((ctx) => tombstone(ctx, 'note', need(ctx, 'note', id)));
      },
      deleteProject(id) {
        return push((ctx) => {
          const hit = need(ctx, 'project', id);
          for (const n of ordered(ctx, 'note', (s) => s.project === id)) tombstone(ctx, 'note', { ...n, fields: view(ctx, n.path) });
          tombstone(ctx, 'project', hit);
        });
      },
    };
  }

  // ---- inspection and seeding

  function doc(path) {
    const d = docs.get(path);
    if (!d) return null;
    return {
      name: fullName(path), path, fields: clone(d.fields), data: plainFields(d.fields),
      createTime: formatMicros(d.createTime), updateTime: formatMicros(d.updateTime),
    };
  }

  // { head, projects, notes, trash, devices, other }: decoded fields, collections keyed by document id.
  function docsOf(uid) {
    const out = { head: null, projects: {}, notes: {}, trash: {}, devices: {}, other: {} };
    const head = docs.get(`users/${uid}`);
    if (head) out.head = plainFields(head.fields);
    const prefix = `users/${uid}/`;
    for (const [path, d] of docs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length).split('/');
      const known = rest.length === 2 && ['projects', 'notes', 'trash', 'devices'].includes(rest[0]);
      if (known) out[rest[0]][rest[1]] = plainFields(d.fields);
      else out.other[path] = plainFields(d.fields);
    }
    return out;
  }

  // Writes (or with null, deletes) a document directly, without rules: for seeding a test.
  function writeDoc(path, data) {
    const seg = String(path).split('/');
    if (seg.length % 2 || !seg.every(validId)) throw new TypeError(`writeDoc: not a document path: ${path}`);
    if (data == null) {
      store(path, null);
      return null;
    }
    let fields;
    try {
      fields = normFields(typedFields(data), 1);
    } catch (e) {
      if (e instanceof ApiError) throw new TypeError(`writeDoc: ${e.message}`);
      throw e;
    }
    const us = clock.tick();
    const before = docs.get(path);
    store(path, { fields, createTime: before ? before.createTime : us, updateTime: us });
    return formatMicros(us);
  }

  function reset() {
    docs.clear();
    children.clear();
    bumps = [];
  }

  return {
    handle, classify, commit, remote, doc, docsOf, writeDoc, rulesData, nowTimestamp, bumpHeadBetweenGetAndCommit, reset, fullName,
  };
}

module.exports = { createFirestore, formatMicros, parseTimestamp, MockError, docIdOf, keyBetween, OTHER_DEVICE };
