'use strict';
// Fractional order keys (ai_memory/15, 4.5). Notes and columns are ordered by a base-62 key
// compared as a plain string, ties broken by id. The digits ascend in code-unit order and a
// key never ends in '0', so another key always fits between two neighbours.

const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = /^[0-9A-Za-z]*$/;
const KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;
const MAX_KEY = 48; // longer keys get the list re-keyed on its next push (the rules allow 64)

const isKey = (k) => typeof k === 'string' && KEY.test(k);

// a < result < b; null means unbounded.
function keyBetween(a, b) {
  if (a == null) a = '';
  if (typeof a !== 'string' || !DIGITS.test(a) || (b != null && !isKey(b))) throw new RangeError('keyBetween: not an order key');
  if (b != null && !(a < b)) throw new RangeError('keyBetween: a must sort before b');
  let out = '';
  for (let i = 0; ; i++) {
    const da = i < a.length ? D.indexOf(a[i]) : 0;
    const db = b != null && i < b.length ? D.indexOf(b[i]) : 62;
    if (da === db) { out += D[da]; continue; }
    if (db - da > 1) return out + D[(da + db) >> 1];
    out += D[da]; b = null; // below b at this digit: unbounded above from here
  }
}

// n increasing keys between a and b, balanced by recursive bisection.
function keysBetween(a, b, n) {
  const out = new Array(Math.max(0, n | 0));
  const fill = (lo, hi, from, count) => {
    if (count <= 0) return;
    const at = from + ((count - 1) >> 1);
    const key = keyBetween(lo, hi);
    out[at] = key;
    fill(lo, key, from, at - from);
    fill(key, hi, at + 1, from + count - at - 1);
  };
  fill(a ?? null, b ?? null, 0, out.length);
  return out;
}

// Keys for `ids` in this order. The longest strictly increasing run of known keys is kept
// (a longest increasing subsequence), so a drag rewrites one key; the others get new keys
// spread between their kept neighbours. Unknown or malformed keys always get new ones.
function orderKeys(ids, known) {
  const n = ids.length;
  const ks = ids.map((id) => {
    const k = known && known.get(id);
    return isKey(k) ? k : null;
  });
  const tails = [];
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const k = ks[i];
    if (k === null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ks[tails[mid]] < k) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Array(n).fill(false);
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = true;
  const out = new Map();
  let lastKey = null;
  for (let i = 0; i < n;) {
    if (keep[i]) {
      out.set(ids[i], ks[i]);
      lastKey = ks[i];
      i++;
      continue;
    }
    let j = i;
    while (j < n && !keep[j]) j++;
    const fresh = keysBetween(lastKey, j < n ? ks[j] : null, j - i);
    for (let t = i; t < j; t++) out.set(ids[t], fresh[t - i]);
    i = j;
  }
  return out;
}

// By key, then by id: the order every computer draws.
function compareKeyed(a, b) {
  const ka = String(a.key ?? '');
  const kb = String(b.key ?? '');
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ia = String(a.id ?? '');
  const ib = String(b.id ?? '');
  if (ia !== ib) return ia < ib ? -1 : 1;
  return 0;
}

function needsRekey(keys) {
  for (const k of keys) if (typeof k === 'string' && k.length > MAX_KEY) return true;
  return false;
}

module.exports = { keyBetween, keysBetween, orderKeys, compareKeyed, needsRekey, isKey, MAX_KEY };
