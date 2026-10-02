'use strict';
// codec.js: every row of the encoding rules (spec 4.3), the _json fallbacks,
// integers versus doubles, __proto__ safety and docId().

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  toValue, fromValue, encodeFields, decodeFields, docId, estimateBytes, UnrepresentableError,
} = require('../../src/cloud/codec');

const roundTrip = (obj, opts) => decodeFields(encodeFields(obj, opts).fields);
const stored = (fields) => fields._json?.mapValue.fields; // the _json map as sent to Firestore
const withProto = (value) => JSON.parse(`{"__proto__": ${JSON.stringify(value)}}`); // an own "__proto__" key, as JSON.parse makes

function nest(n, leaf = 'leaf') {
  let v = leaf;
  for (let i = 0; i < n; i++) v = { k: v };
  return v;
}

test('values: every row of the table', () => {
  assert.deepEqual(toValue(42), { integerValue: '42' });
  assert.deepEqual(toValue(-7), { integerValue: '-7' });
  assert.deepEqual(toValue(0), { integerValue: '0' });
  assert.deepEqual(toValue(1.5), { doubleValue: 1.5 });
  assert.deepEqual(toValue(true), { booleanValue: true });
  assert.deepEqual(toValue(false), { booleanValue: false });
  assert.deepEqual(toValue(null), { nullValue: null });
  assert.deepEqual(toValue('hi'), { stringValue: 'hi' });
  assert.deepEqual(toValue(''), { stringValue: '' });
  assert.deepEqual(toValue([1, 'a']), { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'a' }] } });
  assert.deepEqual(toValue([]), { arrayValue: { values: [] } });
  assert.deepEqual(toValue({ a: 1 }), { mapValue: { fields: { a: { integerValue: '1' } } } });
  assert.deepEqual(toValue({}), { mapValue: { fields: {} } });
});

test('every JSON type round-trips', () => {
  const samples = [
    0, 1, -1, 2 ** 53 - 1, -(2 ** 53 - 1), 0.1, -2.5, 1e21, 5e-324, true, false, null,
    '', 'text', 'ünïcødé ✓ 😀', 'line\nbreak\ttab "quoted" \\', [], [1, 'two', null, false, 2.5],
    {}, { a: { b: { c: [1, { d: 'e' }] } } }, [{ a: [1, 2] }, { b: null }],
  ];
  for (const v of samples) assert.deepEqual(fromValue(toValue(v)), v, JSON.stringify(v));
  const note = {
    text: 'Review the fire spread model', images: [{ id: '9f0c'.padEnd(32, '0'), w: 3024, h: 1964, futureImageField: { x: [1] } }],
    createdAt: 1758690000000, updatedAt: 1758693600000, usedAt: 0, highlight: 'amber', futureNoteField: { nested: true, n: 2.25 },
  };
  assert.deepEqual(roundTrip(note), note);
});

test('integers and doubles', () => {
  assert.deepEqual(toValue(2 ** 53 - 1), { integerValue: '9007199254740991' });
  assert.deepEqual(toValue(2 ** 53), { doubleValue: 2 ** 53 });
  assert.deepEqual(toValue(1758690000000), { integerValue: '1758690000000' });
  assert.deepEqual(toValue(3.0), { integerValue: '3' }); // JSON can't tell 3.0 from 3
  assert.deepEqual(toValue(1e21), { doubleValue: 1e21 });
  assert.deepEqual(toValue(-0), { integerValue: '0' }); // as JSON.stringify(-0) === '0'
  assert.equal(fromValue({ integerValue: '42' }), 42);
  assert.equal(fromValue({ integerValue: 42 }), 42);
  assert.equal(fromValue({ integerValue: '-9007199254740991' }), -9007199254740991);
  assert.equal(fromValue({ doubleValue: 2.5 }), 2.5);
  assert.equal(fromValue({ doubleValue: 3 }), 3);
  assert.ok(Number.isNaN(fromValue({ doubleValue: 'NaN' })));
  assert.equal(fromValue({ doubleValue: '-Infinity' }), -Infinity);
  assert.throws(() => toValue(NaN), UnrepresentableError);
  assert.throws(() => toValue(Infinity), UnrepresentableError);
  // Inside a field, a number JSON can't hold sends the field to _json, which stores null, as the data file would.
  assert.equal(stored(encodeFields({ x: [1, NaN] }).fields).x.stringValue, '[1,null]');
});

test('the REST encoding of a note (spec 4.2)', () => {
  const { fields, jsonKeys } = encodeFields({ text: '…', images: [{ id: '9f0c', w: 3024, h: 1964 }], createdAt: 1758690000000, copied: 5 });
  assert.deepEqual(fields, {
    text: { stringValue: '…' },
    images: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: '9f0c' }, w: { integerValue: '3024' }, h: { integerValue: '1964' } } } }] } },
    createdAt: { integerValue: '1758690000000' },
    copied: { integerValue: '5' },
  });
  assert.deepEqual(jsonKeys, []);
  assert.equal(fields._json, undefined);
});

test('_json: an array directly inside an array', () => {
  const obj = { name: 'Wildfire RL', weird: [[1, 2], [3]], deep: { list: [[1]] }, fine: [{ a: [1] }] };
  const { fields, jsonKeys } = encodeFields(obj);
  assert.deepEqual(jsonKeys, ['weird', 'deep']);
  assert.equal(fields.weird, undefined);
  assert.deepEqual(stored(fields), { weird: { stringValue: '[[1,2],[3]]' }, deep: { stringValue: '{"list":[[1]]}' } });
  assert.ok(fields.fine.arrayValue, 'a map between two arrays is fine');
  assert.throws(() => toValue([[1]]), UnrepresentableError);
  assert.deepEqual(roundTrip(obj), obj);
});

test('_json: a string with a lone surrogate', () => {
  const obj = { hi: 'a\uD800b', lo: '\uDC00', reversed: '\uDC00\uD800', nested: { t: ['ok', 'x\uDBFF'] }, emoji: 'fine 😀 ✓' };
  const { fields, jsonKeys } = encodeFields(obj);
  assert.deepEqual(jsonKeys, ['hi', 'lo', 'reversed', 'nested']);
  assert.deepEqual(fields.emoji, { stringValue: 'fine 😀 ✓' }, 'a proper pair is ordinary text');
  for (const k of jsonKeys) {
    const text = stored(fields)[k].stringValue;
    assert.ok(text.isWellFormed(), `${k}: _json holds valid UTF-8`);
    assert.match(text, /\\u/, `${k}: the surrogate is escaped`);
  }
  assert.deepEqual(roundTrip(obj), obj);
  assert.throws(() => toValue('\uD800'), UnrepresentableError);
});

test('_json: a map key that is empty, reserved or too long', () => {
  const edge = 'k'.repeat(1500);
  const obj = {
    empty: { '': 1 },
    reserved: { __x__: 1 },
    proto: withProto({ a: 1 }),
    long: { ['k'.repeat(1501)]: 1 },
    multibyte: { ['€'.repeat(501)]: 1 }, // 501 characters, 1,503 bytes
    lone: { '\uD800': 1 },
    lineBreak: { '__a\nb__': 1 }, // still reserved with a line break inside
    edge: { [edge]: 1 },
    fine: { _a: 1, __: 2, ___: 3, __x: 4 },
  };
  const { fields, jsonKeys } = encodeFields(obj);
  assert.deepEqual(jsonKeys, ['empty', 'reserved', 'proto', 'long', 'multibyte', 'lone', 'lineBreak']);
  assert.deepEqual(Object.keys(fields.edge.mapValue.fields), [edge], '1,500 bytes is allowed');
  assert.ok(fields.fine.mapValue);
  assert.deepEqual(roundTrip(obj), obj);
});

test('_json: nesting deeper than 20', () => {
  const alternating = (n) => {
    let v = 1;
    for (let i = 0; i < n; i++) v = i % 2 ? { k: v } : [v];
    return v;
  };
  const obj = { ok: nest(20), deep: nest(21), okMixed: alternating(20), deepMixed: alternating(21) };
  const { fields, jsonKeys } = encodeFields(obj);
  assert.deepEqual(jsonKeys, ['deep', 'deepMixed'], 'arrays count toward the depth too');
  assert.ok(fields.ok.mapValue);
  assert.ok(fields.okMixed.mapValue);
  assert.deepEqual(roundTrip(obj), obj);
  assert.doesNotThrow(() => toValue(nest(20)));
  assert.throws(() => toValue(nest(21)), UnrepresentableError);
});

test('_json: a top-level key starting with _', () => {
  const obj = { text: 'hi', _local: 1, _json: 'mine', _sync: { mine: true }, _: [1] };
  const { fields, jsonKeys } = encodeFields(obj);
  assert.deepEqual(jsonKeys, ['_local', '_json', '_sync', '_']);
  assert.deepEqual(Object.keys(fields).sort(), ['_json', 'text']);
  assert.deepEqual(stored(fields), {
    _local: { stringValue: '1' }, _json: { stringValue: '"mine"' }, _sync: { stringValue: '{"mine":true}' }, _: { stringValue: '[1]' },
  });
  assert.deepEqual(roundTrip(obj), obj);
});

test('_json: top-level keys that no map may hold keep their exact names', () => {
  const obj = withProto({ polluted: true });
  obj[''] = 1;
  obj.__x__ = [2];
  obj['k'.repeat(1501)] = 'long';
  obj['\uD800'] = 'lone';
  obj['__\n__'] = 4;
  obj.ok = 3;
  const { fields, jsonKeys } = encodeFields(obj);
  assert.equal(jsonKeys.length, 6);
  assert.deepEqual(Object.keys(fields).sort(), ['_json', 'ok']);
  for (const [k, v] of Object.entries(stored(fields))) {
    assert.match(k, /^x-[A-Za-z0-9_-]{43}$/, 'stored under a key Firestore accepts');
    assert.ok(v.stringValue.isWellFormed());
  }
  const back = roundTrip(obj);
  assert.deepEqual(back, obj);
  assert.equal(Object.getPrototypeOf(back), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('_json: values JSON itself reshapes are stored as JSON would store them', () => {
  const { fields, jsonKeys } = encodeFields({ when: new Date(0), fn: () => 1, big: 10n, sym: Symbol('s'), list: [1, undefined, 2], gone: undefined });
  assert.deepEqual(jsonKeys, ['when']);
  assert.deepEqual(decodeFields(fields), { when: '1970-01-01T00:00:00.000Z', list: [1, null, 2] });
});

test('decodeFields ignores _sync and lays _json over the typed fields', () => {
  const fields = {
    text: { stringValue: 'typed' },
    same: { stringValue: 'typed' },
    _sync: { mapValue: { fields: { rev: { integerValue: '3' }, id: { stringValue: 'orig' } } } },
    _json: { mapValue: { fields: {
      same: { stringValue: '"from _json"' },
      grid: { stringValue: '[[1]]' },
      broken: { stringValue: '{not json' },
      raw: { integerValue: '7' },
    } } },
  };
  assert.deepEqual(decodeFields(fields), { text: 'typed', same: 'from _json', grid: [[1]], broken: '{not json', raw: 7 });
  assert.deepEqual(decodeFields(undefined), {});
  assert.deepEqual(decodeFields({}), {});
  assert.deepEqual(decodeFields({ _sync: { mapValue: {} } }), {});
  assert.deepEqual(decodeFields({ _json: { mapValue: {} } }), {}, 'Firestore omits fields for an empty map');
  // A _json that isn't a map wasn't written by this codec: it is kept, and survives the next write.
  const odd = { text: { stringValue: 't' }, _json: { stringValue: 'odd' } };
  assert.deepEqual(decodeFields(odd), { text: 't', _json: 'odd' });
  assert.deepEqual(roundTrip(decodeFields(odd)), { text: 't', _json: 'odd' });
});

test('decoding is safe with __proto__', () => {
  const evil = withProto({ mapValue: { fields: { polluted: { booleanValue: true } } } });
  const map = fromValue({ mapValue: { fields: evil } });
  assert.equal(Object.getPrototypeOf(map), Object.prototype);
  assert.ok(Object.hasOwn(map, '__proto__'));
  assert.equal(map.polluted, undefined);

  const doc = Object.fromEntries([
    ['__proto__', { mapValue: { fields: { polluted: { booleanValue: true } } } }],
    ['constructor', { stringValue: 'x' }],
    ['_json', { mapValue: { fields: withProto({ stringValue: '{"polluted":true}' }) } }],
  ]);
  const out = decodeFields(doc);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'constructor']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, '__proto__').value, { polluted: true });
  assert.equal(out.constructor, 'x');
  assert.equal(out.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('server-written values decode to plain JSON', () => {
  assert.equal(fromValue({ timestampValue: '2026-10-01T10:00:00.123456Z' }), '2026-10-01T10:00:00.123456Z');
  assert.equal(fromValue({ referenceValue: 'projects/p/databases/(default)/documents/users/u' }), 'projects/p/databases/(default)/documents/users/u');
  assert.deepEqual(fromValue({ geoPointValue: { latitude: 1.5, longitude: -2 } }), { latitude: 1.5, longitude: -2 });
  assert.deepEqual(fromValue({ arrayValue: {} }), [], 'Firestore omits values for an empty array');
  assert.deepEqual(fromValue({ mapValue: {} }), {}, 'and fields for an empty map');
  assert.equal(fromValue(undefined), null);
  assert.equal(fromValue({}), null);
});

test('encodeFields skips per-device keys and undefined values', () => {
  const obj = { id: 'n1', text: 'a', expanded: true, copied: 3, gone: undefined };
  const { fields, jsonKeys } = encodeFields(obj, { skip: new Set(['id', 'expanded']) });
  assert.deepEqual(Object.keys(fields), ['text', 'copied']);
  assert.deepEqual(jsonKeys, []);
  assert.deepEqual(Object.keys(encodeFields(obj, { skip: ['id'] }).fields), ['text', 'expanded', 'copied']);
  assert.deepEqual(Object.keys(encodeFields(obj, { skip: (k) => k === 'id' || k.startsWith('local') }).fields), ['text', 'expanded', 'copied']);
  assert.deepEqual(Object.keys(encodeFields(obj).fields), ['id', 'text', 'expanded', 'copied']);
});

test('toValue refuses what Firestore cannot hold', () => {
  for (const v of [[[1]], '\uD800', { '': 1 }, { __x__: 1 }, NaN, -Infinity, undefined, () => 1, Symbol('s'), 10n, new Date(0), new Map(), nest(21)]) {
    assert.throws(() => toValue(v), UnrepresentableError, String(typeof v));
  }
});

test('docId', () => {
  const plain = ['abc', 'A-Z_09', '3f2b8c1e-4d5a-4b6c-9d7e-0f1a2b3c4d5e', 'x'.repeat(128), '__', '___', '__x', 'x__'];
  for (const id of plain) assert.equal(docId(id), id);
  const hashed = ['', '.', '..', 'a/b', 'a b', 'é', 'x'.repeat(129), '__x__', '____', '__proto__', 'a.b', '\uD800', '\uD801'];
  for (const id of hashed) {
    assert.match(docId(id), /^x-[A-Za-z0-9_-]{43}$/, JSON.stringify(id));
    assert.equal(docId(id), docId(id), 'deterministic');
  }
  assert.equal(new Set(hashed.map(docId)).size, hashed.length, 'distinct ids stay distinct, lone surrogates included');
  assert.equal(docId('a/b'), `x-${crypto.createHash('sha256').update('a/b', 'utf8').digest('base64url')}`);
  assert.equal(docId('__x__'), `x-${crypto.createHash('sha256').update('__x__', 'utf8').digest('base64url')}`);
  assert.equal(docId(42), '42');
});

test('estimateBytes', () => {
  const { fields } = encodeFields({ text: 'héllo wörld', n: 1 });
  assert.equal(estimateBytes(fields), Buffer.byteLength(JSON.stringify(fields)) * 1.1);
  assert.ok(estimateBytes(fields) > JSON.stringify(fields).length * 1.1, 'counts bytes, not characters');
});
