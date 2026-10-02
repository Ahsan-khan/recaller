'use strict';
// Plain JSON <-> Firestore's typed REST values. Items keep the data file's own
// field names. A top-level field Firestore can't hold (an array inside an array,
// a lone surrogate, a reserved, empty or oversized key, nesting deeper than 20,
// or a key starting with '_') is stored whole as JSON text under _json, so
// nothing is ever dropped or reinterpreted.

const crypto = require('node:crypto');

const MAX_DEPTH = 20;
const MAX_KEY_BYTES = 1500;
const LONE_SURROGATE = /\p{Surrogate}/u; // with the u flag a proper pair is one code point and doesn't match
const RESERVED = /^__[\s\S]*__$/; // Firestore's __.*__, with a line break inside counted too
const PLAIN_ID = /^[A-Za-z0-9_-]{1,128}$/;

class UnrepresentableError extends Error {
  constructor(reason) {
    super(`Firestore can't hold ${reason}`);
    this.name = 'UnrepresentableError';
  }
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Keys Firestore refuses, whether as a field name or as a key inside a map.
const badKey = (k) => k === '' || RESERVED.test(k) || LONE_SURROGATE.test(k) || Buffer.byteLength(k, 'utf8') > MAX_KEY_BYTES;

// UTF-8 as the spec says; a string with a lone surrogate hashes its UTF-16 units instead,
// because UTF-8 would turn every lone surrogate into the same replacement character.
function hash(s) {
  const bytes = LONE_SURROGATE.test(s) ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('base64url');
}

function isPlainObject(v) {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function encode(v, depth, inArray) {
  if (v === null) return { nullValue: null };
  switch (typeof v) {
    case 'boolean':
      return { booleanValue: v };
    case 'number':
      if (Number.isSafeInteger(v)) return { integerValue: String(v) };
      if (Number.isFinite(v)) return { doubleValue: v };
      throw new UnrepresentableError('a number that isn\'t finite');
    case 'string':
      if (LONE_SURROGATE.test(v)) throw new UnrepresentableError('a lone surrogate');
      return { stringValue: v };
    case 'object': {
      if (depth >= MAX_DEPTH) throw new UnrepresentableError(`nesting deeper than ${MAX_DEPTH}`);
      if (Array.isArray(v)) {
        if (inArray) throw new UnrepresentableError('an array inside an array');
        return { arrayValue: { values: Array.from(v, (x) => (x === undefined ? { nullValue: null } : encode(x, depth + 1, true))) } };
      }
      if (!isPlainObject(v)) throw new UnrepresentableError('an object that isn\'t plain JSON');
      const entries = [];
      for (const k of Object.keys(v)) {
        if (v[k] === undefined) continue; // as JSON.stringify does
        if (badKey(k)) throw new UnrepresentableError('an empty, reserved or oversized key');
        entries.push([k, encode(v[k], depth + 1, false)]);
      }
      return { mapValue: { fields: Object.fromEntries(entries) } };
    }
    default:
      throw new UnrepresentableError(`a ${typeof v}`);
  }
}

function toValue(json) {
  return encode(json, 0, false);
}

function fromFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  return Object.fromEntries(Object.keys(fields).map((k) => [k, fromValue(fields[k])]));
}

function fromValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (own(value, 'stringValue')) return String(value.stringValue);
  if (own(value, 'integerValue')) return Number(value.integerValue);
  if (own(value, 'doubleValue')) return Number(value.doubleValue);
  if (own(value, 'booleanValue')) return value.booleanValue === true;
  if (own(value, 'nullValue')) return null;
  if (own(value, 'mapValue')) return fromFields(value.mapValue?.fields);
  if (own(value, 'arrayValue')) {
    const values = value.arrayValue?.values;
    return Array.isArray(values) ? values.map(fromValue) : [];
  }
  // Server-written values (REQUEST_TIME and the like) come back as their RFC 3339 text.
  if (own(value, 'timestampValue')) return String(value.timestampValue);
  if (own(value, 'referenceValue')) return String(value.referenceValue);
  if (own(value, 'bytesValue')) return String(value.bytesValue);
  if (own(value, 'geoPointValue')) {
    const g = value.geoPointValue || {};
    return { latitude: Number(g.latitude ?? 0), longitude: Number(g.longitude ?? 0) };
  }
  return null;
}

function jsonText(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined; // a BigInt or a cycle: never in a parsed file
  }
}

// A top-level key that can't even be a key of _json ('', '__x__', oversized, a lone surrogate)
// goes under 'x-' + sha256(key), and its text holds [key, value] so the name comes back exactly.
const escapedKey = (k) => `x-${hash(k)}`;

function unescaped(k, value) {
  if (!k.startsWith('x-') || !Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') return null;
  return k === escapedKey(value[0]) ? value : null;
}

// skip: a Set of keys, an array, or a predicate such as SyncApply.isLocalKey.
function skipper(skip) {
  if (typeof skip === 'function') return skip;
  const set = skip instanceof Set ? skip : new Set(skip || []);
  return (k) => set.has(k);
}

function encodeFields(obj, { skip } = {}) {
  const skipped = skipper(skip);
  const typed = [];
  const extra = [];
  const jsonKeys = [];
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (v === undefined || skipped(k)) continue;
    if (!k.startsWith('_') && !badKey(k)) {
      try {
        typed.push([k, encode(v, 0, false)]);
        continue;
      } catch (err) {
        if (!(err instanceof UnrepresentableError)) throw err;
      }
    }
    const text = jsonText(v);
    if (text === undefined) continue; // a function or symbol, which JSON can't carry either
    extra.push(badKey(k) ? [escapedKey(k), { stringValue: JSON.stringify([k, v]) }] : [k, { stringValue: text }]);
    jsonKeys.push(k);
  }
  const fields = Object.fromEntries(typed);
  if (extra.length) fields._json = { mapValue: { fields: Object.fromEntries(extra) } };
  return { fields, jsonKeys };
}

function decodeFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const entries = [];
  for (const k of Object.keys(fields)) {
    if (k !== '_sync' && k !== '_json') entries.push([k, fromValue(fields[k])]);
  }
  const map = own(fields, '_json') ? fields._json?.mapValue : null;
  // A _json this codec didn't write (not a map) is kept as an ordinary field rather than dropped.
  if (own(fields, '_json') && !(map && typeof map === 'object')) entries.push(['_json', fromValue(fields._json)]);
  const extra = map?.fields;
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      const text = extra[k]?.stringValue;
      if (typeof text !== 'string') {
        entries.push([k, fromValue(extra[k])]);
        continue;
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        entries.push([k, text]); // not JSON after all: keep the text rather than lose it
        continue;
      }
      entries.push(unescaped(k, value) || [k, value]);
    }
  }
  return Object.fromEntries(entries);
}

function docId(id) {
  const s = String(id);
  return PLAIN_ID.test(s) && !RESERVED.test(s) ? s : `x-${hash(s)}`;
}

function estimateBytes(fields) {
  return Buffer.byteLength(JSON.stringify(fields ?? {}), 'utf8') * 1.1;
}

module.exports = { UnrepresentableError, toValue, fromValue, encodeFields, decodeFields, docId, estimateBytes };
