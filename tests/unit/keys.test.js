'use strict';
// Fractional order keys (src/sync/keys.js). Plain Node: node --test tests/unit/keys.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { keyBetween, keysBetween, orderKeys, compareKeyed, needsRekey, isKey, MAX_KEY } = require('../../src/sync/keys');

const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const VALID = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

// Small deterministic PRNG (mulberry32), so a failure always reproduces.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomKey(rand) {
  const len = 1 + Math.floor(rand() * 6);
  let k = '';
  for (let i = 0; i < len - 1; i++) k += D[Math.floor(rand() * 62)];
  return k + D[1 + Math.floor(rand() * 61)]; // never ends in '0'
}

const increasing = (keys) => keys.every((k, i) => i === 0 || keys[i - 1] < k);

test('keyBetween: the reference cases', () => {
  assert.equal(keyBetween(null, null), 'V');
  assert.equal(keyBetween('V', null), 'k');
  assert.equal(keyBetween(null, 'V'), 'F');
  assert.equal(keyBetween('A', 'B'), 'AV');
  assert.equal(keyBetween('', '1'), '0V');
  assert.equal(keyBetween(null, '01'), '00V');
  assert.equal(keyBetween('V', 'VV'), 'VF');
  assert.equal(keyBetween('V0', 'V1'), 'V0V');
  assert.equal(keyBetween('z', null), 'zV');
});

test('keyBetween: 10,000 random bounds give a < k < b, and k never ends in 0', () => {
  const rand = rng(20261001);
  for (let i = 0; i < 10000; i++) {
    let a = rand() < 0.15 ? null : randomKey(rand);
    let b = rand() < 0.15 ? null : randomKey(rand);
    if (a !== null && b !== null) {
      if (a === b) b = null;
      else if (a > b) [a, b] = [b, a];
    }
    const k = keyBetween(a, b);
    assert.match(k, VALID, `keyBetween(${a}, ${b}) = ${k}`);
    if (a !== null) assert.ok(a < k, `${a} < ${k}`);
    if (b !== null) assert.ok(k < b, `${k} < ${b}`);
  }
});

test('keyBetween: repeated insertion at one spot keeps working and grows slowly', () => {
  let lo = 'V';
  const hi = 'W';
  for (let i = 0; i < 300; i++) {
    const k = keyBetween(lo, hi);
    assert.ok(lo < k && k < hi);
    assert.ok(isKey(k));
    lo = k;
  }
  assert.ok(lo.length <= 300 / 5 + 2, `length ${lo.length}`);
});

test('keyBetween: refuses bounds out of order and malformed keys', () => {
  assert.throws(() => keyBetween('b', 'a'), RangeError);
  assert.throws(() => keyBetween('a', 'a'), RangeError);
  assert.throws(() => keyBetween(null, ''), RangeError);
  assert.throws(() => keyBetween(null, '10'), RangeError); // ends in 0: nothing fits below it
  assert.throws(() => keyBetween('a-b', null), RangeError);
});

test('keysBetween: increasing, inside the bounds, and balanced', () => {
  assert.deepEqual(keysBetween(null, null, 0), []);
  assert.deepEqual(keysBetween(null, null, 1), ['V']);
  for (const n of [2, 3, 10, 61, 62, 63, 500, 3844, 10000]) {
    const keys = keysBetween(null, null, n);
    assert.equal(keys.length, n);
    assert.ok(increasing(keys), `n = ${n}`);
    assert.ok(keys.every((k) => VALID.test(k)));
    const longest = Math.max(...keys.map((k) => k.length));
    // About log62(n) + 1 characters.
    assert.ok(longest <= Math.ceil(Math.log(n + 1) / Math.log(62)) + 2, `n = ${n}: longest key ${longest}`);
  }
  const rand = rng(7);
  for (let i = 0; i < 200; i++) {
    const a = randomKey(rand);
    const b = randomKey(rand);
    if (a === b) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const n = 1 + Math.floor(rand() * 40);
    const keys = keysBetween(lo, hi, n);
    assert.ok(increasing([lo, ...keys, hi]), `${lo} … ${hi}`);
  }
});

// Brute-force longest strictly increasing subsequence length, for small arrays.
function lisLength(values) {
  const best = values.map(() => 1);
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < i; j++) if (values[j] < values[i]) best[i] = Math.max(best[i], best[j] + 1);
    max = Math.max(max, best[i]);
  }
  return max;
}

test('orderKeys: an unchanged list keeps every key', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const keys = keysBetween(null, null, 4);
  const known = new Map(ids.map((id, i) => [id, keys[i]]));
  const out = orderKeys(ids, known);
  assert.deepEqual([...out.values()], keys);
});

test('orderKeys: a drag changes exactly one key', () => {
  const rand = rng(99);
  for (let round = 0; round < 300; round++) {
    const n = 2 + Math.floor(rand() * 30);
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const keys = keysBetween(null, null, n);
    const known = new Map(ids.map((id, i) => [id, keys[i]]));
    const from = Math.floor(rand() * n);
    let to = Math.floor(rand() * n);
    if (to === from) to = (from + 1) % n;
    const moved = ids.slice();
    const [id] = moved.splice(from, 1);
    moved.splice(to, 0, id);
    const out = orderKeys(moved, known);
    const changed = moved.filter((x) => out.get(x) !== known.get(x));
    assert.equal(changed.length, 1, `drag ${from} → ${to} of ${n}`);
    assert.ok(increasing(moved.map((x) => out.get(x))));
  }
});

test('orderKeys: keeps the most keys (a longest increasing run), and the result is increasing', () => {
  const rand = rng(1234);
  for (let round = 0; round < 500; round++) {
    const n = 1 + Math.floor(rand() * 12);
    const ids = Array.from({ length: n }, (_, i) => `x${i}`);
    const known = new Map();
    for (const id of ids) if (rand() < 0.8) known.set(id, randomKey(rand));
    const out = orderKeys(ids, known);
    assert.equal(out.size, n);
    const result = ids.map((id) => out.get(id));
    assert.ok(increasing(result), JSON.stringify({ ids, known: [...known], result }));
    assert.ok(result.every((k) => VALID.test(k)));
    const kept = ids.filter((id) => known.has(id) && out.get(id) === known.get(id)).length;
    const knownSeq = ids.filter((id) => known.has(id)).map((id) => known.get(id));
    assert.equal(kept, lisLength(knownSeq));
  }
});

test('orderKeys: new ids get keys between their kept neighbours', () => {
  const known = new Map([['a', 'F'], ['c', 'V']]);
  const out = orderKeys(['a', 'b', 'c', 'd'], known);
  assert.equal(out.get('a'), 'F');
  assert.equal(out.get('c'), 'V');
  assert.ok(out.get('b') > 'F' && out.get('b') < 'V');
  assert.ok(out.get('d') > 'V');
});

test('orderKeys: ties and malformed known keys are re-keyed', () => {
  const tie = orderKeys(['a', 'b'], new Map([['a', 'V'], ['b', 'V']]));
  assert.ok(tie.get('a') < tie.get('b'));
  assert.ok(tie.get('a') === 'V' || tie.get('b') === 'V');
  const bad = orderKeys(['a', 'b', 'c'], new Map([['a', 'F'], ['b', 'x0'], ['c', 'bad key']]));
  assert.equal(bad.get('a'), 'F');
  assert.ok(VALID.test(bad.get('b')) && VALID.test(bad.get('c')));
  assert.ok(bad.get('a') < bad.get('b') && bad.get('b') < bad.get('c'));
  assert.deepEqual([...orderKeys([], new Map())], []);
});

test('orderKeys: deterministic', () => {
  const known = new Map([['a', 'k'], ['b', 'F'], ['c', 'V'], ['d', '7']]);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual([...orderKeys(ids, known)], [...orderKeys(ids, known)]);
});

test('compareKeyed: by key, then by id', () => {
  const items = [{ id: 'b', key: 'V' }, { id: 'a', key: 'V' }, { id: 'z', key: 'F' }, { id: 'c', key: 'k' }];
  assert.deepEqual(items.sort(compareKeyed).map((x) => x.id), ['z', 'a', 'b', 'c']);
  assert.equal(compareKeyed({ id: 'a', key: 'V' }, { id: 'a', key: 'V' }), 0);
  // Plain code-unit order: digits < upper case < lower case.
  assert.ok(compareKeyed({ id: 'a', key: 'Z' }, { id: 'a', key: 'a' }) < 0);
  assert.ok(compareKeyed({ id: 'a', key: '9' }, { id: 'a', key: 'A' }) < 0);
});

test('needsRekey and re-keying a list whose keys grew long', () => {
  assert.equal(MAX_KEY, 48);
  assert.equal(needsRekey(['V', 'k']), false);
  assert.equal(needsRekey(['V', 'x'.repeat(48)]), false);
  assert.equal(needsRekey(['V', 'x'.repeat(49)]), true);
  assert.equal(needsRekey(new Map([['a', 'y'.repeat(60)]]).values()), true);
  // Always inserting just after the same note makes keys grow; past 48 characters the list is
  // re-keyed evenly, which gives short keys again in the same order.
  let lo = 'V';
  const keys = [lo];
  while (!needsRekey(keys)) {
    lo = keyBetween(lo, 'W');
    keys.push(lo);
  }
  assert.ok(increasing(keys));
  const fresh = keysBetween(null, null, keys.length);
  assert.ok(increasing(fresh) && !needsRekey(fresh));
  assert.ok(Math.max(...fresh.map((k) => k.length)) <= 3);
});
