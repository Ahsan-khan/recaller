'use strict';
// The GCP mock's rules twin (tests/mock-gcp/rules.js) against the shared cases (tests/rules/cases.js,
// ai_memory/15 7.3 layer 2): every case must get its expected ALLOW or DENY, within the access-call budget
// of 4.8 and 4.9. The twin must also still match the rules texts it was written from.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cases, validate } = require('../rules/cases');
const rules = require('../mock-gcp/rules');

// The most get() or firestore.get() calls a case may make: board writes none, a device write, a hard
// delete, and a Storage upload or delete one each.
function budget(c) {
  if (c.service === 'storage') return c.method === 'create' || c.method === 'delete' ? 1 : 0;
  if (c.method === 'get' || c.method === 'list') return 0;
  const collection = c.path.split('/')[2];
  if (collection === 'devices') return 1;
  return collection && c.method === 'delete' ? 1 : 0;
}

test('the shared case list is valid', () => {
  assert.deepEqual(validate(), []);
});

test('the twin matches the rules texts it was written from', () => {
  for (const kind of ['firestore', 'storage']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'infra', 'firebase', `${kind}.rules`), 'utf8');
    assert.equal(rules.fingerprint(text), rules.FINGERPRINTS[kind],
      `infra/firebase/${kind}.rules changed: bring tests/mock-gcp/rules.js in line with it, then update FINGERPRINTS.${kind}`);
  }
});

// The spec quotes both rules texts in full (4.8, 4.9): the fingerprint above ignores comments, so this is what
// keeps a comment change in a rules file (or in the spec) from leaving the two apart. Line endings aside: a
// Windows checkout may give the spec CRLF, while .gitattributes keeps the rules files LF.
test('ai_memory/15 quotes both rules texts byte for byte (4.8 and 4.9)', () => {
  const lf = (s) => s.replace(/\r\n/g, '\n');
  const spec = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'ai_memory', '15_accounts_and_sync.md'), 'utf8'));
  for (const [heading, kind] of [['### 4.8 Firestore rules', 'firestore'], ['### 4.9 Storage rules', 'storage']]) {
    const at = spec.indexOf(`\n${heading}`);
    assert.ok(at >= 0, `ai_memory/15: no "${heading}" section`);
    const next = spec.indexOf('\n### ', at + 1);
    const start = spec.indexOf('\n```\n', at) + 5;
    const end = spec.indexOf('\n```\n', start) + 1;
    assert.ok(start > 4 && end > start && (next < 0 || end < next), `ai_memory/15 ${heading.slice(4)}: no fenced rules text`);
    const text = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'infra', 'firebase', `${kind}.rules`), 'utf8'));
    assert.ok(spec.slice(start, end) === text,
      `ai_memory/15 ${heading.slice(4)} must quote infra/firebase/${kind}.rules exactly: change both together`);
  }
});

test('every shared case', async (t) => {
  for (const c of cases) {
    await t.test(`${c.expect} ${c.name}`, () => {
      const r = rules.evaluateCase(c);
      assert.equal(r.allow ? 'ALLOW' : 'DENY', c.expect, r.reason || '');
      assert.ok(r.calls <= budget(c), `${r.calls} access calls, budget ${budget(c)}`);
    });
  }
});

test('board writes make no access call; hard deletes and device writes make exactly one', () => {
  let checked = 0;
  for (const c of cases) {
    if (c.service !== 'firestore' || !c.auth?.verified || c.path.split('/')[1] !== c.auth.uid) continue;
    const seg = c.path.split('/');
    const r = rules.evaluateCase(c);
    const write = c.method === 'create' || c.method === 'update';
    if (write && (seg.length === 2 || ['projects', 'notes', 'trash'].includes(seg[2]))) {
      assert.equal(r.calls, 0, c.name);
      checked++;
    }
    if ((c.method === 'delete' && seg.length === 4) || (write && seg[2] === 'devices' && /^[a-f0-9]{32}$/.test(seg[3]))) {
      assert.equal(r.calls, 1, c.name);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('Storage: an upload over a stored picture (a create with resource set) is refused before the head is read; to a free name it is allowed', () => {
  // The live service evaluates every upload of a file's contents as create, an overwrite included; update is a
  // metadata change. The 2026-10-01 smoke test found an overwrite allowed while a case naming it 'update' passed.
  const overwrites = cases.filter((c) => c.service === 'storage' && c.method === 'create' && c.existing !== null);
  assert.ok(overwrites.length >= 3, 'the cases model overwrites as the service sends them');
  for (const c of overwrites) {
    const r = rules.evaluateCase(c);
    assert.equal(r.allow, false, c.name);
    assert.equal(r.calls, 0, `${c.name}: refused before firestore.get(), so it costs no read`);
  }
  // resource is what refuses them: the same uploads to a name where nothing is stored are allowed.
  for (const name of ['storage: overwrite (create over a stored picture)', 'storage: overwrite of a thumbnail with other bytes']) {
    const c = cases.find((x) => x.name === name);
    const fresh = rules.evaluateCase({ ...c, existing: null });
    assert.deepEqual([fresh.allow, fresh.calls], [true, 1], name);
  }
  // And Storage's update is only ever a metadata change, refused.
  assert.ok(cases.filter((c) => c.service === 'storage' && c.method === 'update').every((c) => c.expect === 'DENY'));
});

test('an access call past the limit denies what would be allowed', () => {
  for (const name of ['notes: hard delete while deleting', 'devices: valid', 'storage: delete while deleting', 'storage: upload .png']) {
    const c = cases.find((x) => x.name === name);
    assert.equal(rules.evaluateCase(c).allow, true, name);
    const r = rules.evaluateCase(c, { limit: 0 });
    assert.equal(r.allow, false, name);
    assert.equal(r.limited, true, name);
  }
});

test('the Rules language semantics the twin relies on', () => {
  const T = rules.Timestamp.ofMillis(Date.UTC(2026, 9, 1, 10));
  const head = rules.fromCase({ deleting: false, schema: 1, rev: 3, minRev: 0, createdAt: { $ts: 1 }, updatedAt: { $ts: 2 } });
  const bump = (over) => rules.evaluate({
    service: 'firestore', method: 'update', path: 'users/alice', auth: rules.authValue({ uid: 'alice', verified: true }), time: T,
    existing: head, head, incoming: new Map([...head, ['rev', 4n], ['updatedAt', T], ...over]),
  }).allow;
  assert.equal(bump([]), true);
  assert.equal(bump([['rev', 4]]), true); // an int equals the same float
  assert.equal(bump([['schema', 1]]), false); // but a float is not an int
  // error || true is true: a hard delete while deleting reads no resource
  const del = cases.find((x) => x.name === 'notes: hard delete of a missing note while deleting');
  assert.equal(del.existing, null);
  assert.equal(rules.evaluateCase(del).allow, true);
  // and a missing resource field is an error that denies
  assert.equal(rules.evaluateCase({ ...del, head: { ...del.head, deleting: false } }).allow, false);
});
