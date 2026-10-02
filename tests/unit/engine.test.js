'use strict';
// The sync engine (src/sync/engine.js; ai_memory/15, 5.1–5.18, 7.4) with real temp folders, the headless
// peer (tests/support/peer.js) and the GCP mock, all on one fake clock: pushes and pulls both ways, the
// precondition race, chunk and picture order, the first-sync table, the union triggers, 403s (a race seen
// first by the rules, a passing denial, a lasting one that splits and quarantines), lost answers, the audit,
// the minRev resync, the schema guard, account deletion and its gating, account-gone, and a crash at every
// call the engine makes into the world (the process dies, comes back from disk, and nothing is reverted,
// lost or left unconverged). Then the review's regressions: unions and restores that end with their own
// merge, sign-ins after the page loaded a .bak or a seed, 5xx answers after a commit landed, reloads while
// an acknowledging save waits, what exists only here, refused pictures, one engine run after run, questions
// that don't stop syncing, Use my account's board only for the board it was decided for, slow links, a
// page that keeps refusing, production timings and costs, nothing sent while offline. Round 2: a commit
// settled after a restart from its documents (an Undo, a .bak), a sign-in again in the same page, labels that
// explain nothing, drafts under Use my account's board, nothing written after a stop, deleted text kept no
// longer than the trash, and fewer reads. Round 3: a note typed just before signing in, notes held with a
// project the account doesn't have, reads on a slow link, a held picture whose file came back, wake-ups with
// nothing to push, a prefetch that failed once, and nothing armed after a sign-out. Round 4: a column's deletion
// that waits for a note held here, a held note a deletion elsewhere doesn't remove, too-large items no push has
// recorded yet, a read that never gets through, a link that loses answers, and the full size of every picture
// saved here before the account goes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGcpMock } = require('../mock-gcp');
const { createPeer, createFakeTime, settle, flush, makeRng, pngBytes, LISTS } = require('../support/peer');
const model = require('../../src/sync/model');
const codec = require('../../src/cloud/codec');
const { mergeSaveMeta } = require('../../src/sync/engine');

const EMAIL = 'owner@example.com';
const PASSWORD = 'password-1234';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-engine-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let worlds = 0;

// A mock, a clock and computers (A a PC, B a Mac, C another Mac). fast: false runs the production timings.
// fetchSpy wraps every computer's fetch; fetchFor(name, fetch) gives one computer its own.
function world({ names = ['A', 'B'], seed = 7, user = true, verified = true, fetchSpy = null, fetchFor = null, fast = true } = {}) {
  const time = createFakeTime();
  const mock = createGcpMock({ now: time.now });
  if (user) mock.createUser({ email: EMAIL, password: PASSWORD, verified });
  const dir = path.join(root, `world-${++worlds}`);
  const rand = makeRng(seed);
  const platforms = { A: 'win32', B: 'darwin', C: 'darwin' };
  const fetchImpl = fetchSpy ? fetchSpy(mock.fetch) : mock.fetch;
  const peers = names.map((name) => createPeer({
    dir: path.join(dir, name), fetchImpl: fetchFor ? fetchFor(name, fetchImpl) : fetchImpl, time, name, platform: platforms[name] || 'linux', random: rand, fast,
  }));
  const run = (who = peers, opts) => settle(who, time, opts);
  return { time, mock, peers, run, dir, uid: () => mock.user(EMAIL)?.uid ?? null };
}

// A board with real content (two projects, notes in every stage) on a computer that isn't synced yet.
function realBoard(peer) {
  const p = peer.page;
  const w = p.data.projects[0];
  if (w?.name === 'Welcome') p.deleteProject(w.id);
  const work = p.addProject('Work');
  const home = p.addProject('Home');
  const n = {
    a: p.addNote(work, 'alpha'),
    b: p.addNote(work, 'bravo'),
    c: p.addNote(work, 'charlie'),
    u: p.addNote(work, 'used one', { list: 'used' }),
    s: p.addNote(work, 'served one', { list: 'combined' }),
    h: p.addNote(home, 'home note'),
  };
  return { work, home, ...n };
}

async function signIn(w, peer, { answer = null } = {}) {
  const res = await peer.signIn(EMAIL, PASSWORD);
  assert.deepEqual(res, { ok: true });
  await w.run();
  if (answer) {
    assert.ok(peer.choice(), `${peer.name}: a choice was expected`);
    assert.deepEqual(peer.choose(answer), { ok: true });
    await w.run();
  }
}

// A's real board uploaded, then B signed in over its pristine Welcome (it takes the account's board).
async function twoSynced(opts = {}) {
  const w = world(opts);
  const [A, B] = w.peers;
  await A.boot();
  await B.boot();
  const ids = realBoard(A);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  await signIn(w, B);
  await w.run();
  assert.deepEqual(view(B), view(A));
  return { w, A, B, ids };
}

// Synced fields only: what both computers must agree on.
function view(peer, data = peer.board()) {
  const m = model.toModel(data);
  const out = { joiner: m.board.joiner, columns: m.columns, projects: {}, lists: {}, notes: {} };
  for (const [id, x] of m.projects) out.projects[id] = x.fields;
  for (const [k, v] of m.lists) out.lists[k.replace('\u0000', '/')] = v;
  for (const [id, x] of m.notes) out.notes[id] = { f: x.fields, c: x.copied, lc: x.lastCopiedAt };
  return out;
}

// The account's board as decoded documents, keyed by entity id.
function cloud(w) {
  const docs = w.mock.docs(w.uid());
  const out = { head: docs.head, projects: {}, notes: {}, trash: docs.trash, devices: docs.devices };
  for (const kind of ['projects', 'notes']) {
    for (const [docId, d] of Object.entries(docs[kind])) out[kind][d._sync?.id ?? docId] = d;
  }
  return out;
}

// shadow.json is what the account holds (5.1): every entry against its document.
function assertShadowIsCloud(w, peer) {
  const shadow = peer.readShadow();
  const c = cloud(w);
  assert.equal(shadow.rev, c.head.rev, `${peer.name}: shadow rev`);
  for (const kind of ['projects', 'notes']) {
    assert.deepEqual(Object.keys(shadow[kind]).sort(), Object.keys(c[kind]).sort(), `${peer.name}: ${kind} in the shadow`);
    for (const [id, e] of Object.entries(shadow[kind])) {
      const d = c[kind][id];
      assert.equal(e.d, d._sync.deleted, `${peer.name}: ${kind} ${id} deleted`);
      assert.equal(e.r, d._sync.rev, `${peer.name}: ${kind} ${id} rev`);
      assert.equal(e.k, d._sync.key, `${peer.name}: ${kind} ${id} key`);
      if (kind === 'notes') assert.deepEqual([e.p, e.l], [d._sync.project, d._sync.list], `${peer.name}: note ${id} place`);
      if (!e.d) {
        const fields = model.remoteEntity(kind === 'notes' ? 'note' : 'project', { docId: id, fields: stripSync(d), sync: d._sync }).fields;
        assert.deepEqual(e.f, fields, `${peer.name}: ${kind} ${id} fields`);
        if (kind === 'notes') assert.deepEqual([e.c, e.lc], [d.copied ?? 0, d.lastCopiedAt ?? 0], `${peer.name}: note ${id} counters`);
      }
    }
  }
}

function stripSync(d) {
  const out = {};
  for (const k of Object.keys(d)) if (k !== '_sync') out[k] = d[k];
  return out;
}

function noDuplicateIds(peer) {
  const ids = [];
  for (const p of peer.board().projects) {
    ids.push(p.id);
    for (const l of LISTS) for (const n of p[l]) ids.push(n.id);
  }
  assert.equal(new Set(ids).size, ids.length, `${peer.name}: duplicate ids`);
}

const commits = (w) => w.mock.log.filter((e) => e.op === 'commit' && e.status === 200);
const noteText = (peer, id) => peer.page.findNote(id)?.note.text ?? null;
const texts = (peer) => peer.page.notes().map((x) => x.note.text).sort();

// ================================================================ push and pull

test('push and pull both ways: edits, new notes, moves, deletes, columns and the joiner', async () => {
  const { w, A, B, ids } = await twoSynced();
  const c0 = cloud(w);
  assert.equal(c0.head.lastDevice.length, 32);
  assert.deepEqual(c0.head.stats, { projects: 2, notes: 6, images: 0 });
  // Per-device keys never reach the account; the data names do.
  for (const d of Object.values(c0.notes)) {
    assert.equal(d.expanded, undefined);
    assert.ok(['notes', 'used', 'combined'].includes(d._sync.list));
  }

  // A: an edit, a new note, a move to Cooked, a delete, a column move.
  A.page.editNote(ids.a, 'alpha, edited on A');
  const added = A.page.addNote(ids.home, 'new on A');
  A.page.moveNote(ids.b, { list: 'used' });
  A.page.deleteNote(ids.c);
  A.page.moveProject(ids.home, 0);
  await w.run();
  const c1 = cloud(w);
  assert.ok(c1.head.rev > c0.head.rev);
  assert.equal(c1.notes[ids.a].text, 'alpha, edited on A');
  assert.equal(c1.notes[ids.a]._sync.by, A.readDevice().id);
  assert.equal(c1.notes[ids.c]._sync.deleted, true);
  assert.deepEqual(Object.keys(c1.notes[ids.c]), ['_sync'], 'a tombstone keeps only _sync');
  assert.equal(c1.trash[`note-${ids.c}`].kind, 'note');

  assert.deepEqual(B.page.notices.map((n) => n.code), ['USED_ACCOUNT'], 'B took the account\'s board over its Welcome');
  B.page.notices.length = 0;
  B.focus();
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(B), view(A));
  assert.equal(noteText(B, added), 'new on A');
  assert.deepEqual(B.page.notices, [], 'ordinary changes bring no toast');

  // B: an edit and the joiner; A pulls.
  B.page.editNote(ids.h, 'home, edited on B');
  B.page.setJoiner('line');
  await w.run();
  await A.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
  assert.equal(A.board().prefs.joiner, 'line');
  assert.equal(cloud(w).head.board.joiner, 'line');
  for (const p of [A, B]) {
    assertShadowIsCloud(w, p);
    noDuplicateIds(p);
    assert.equal(p.status().phase, 'synced');
    assert.equal(p.status().pending, 0);
  }
});

test('a push that changes only the joiner goes up, and a computer that never set it never clears it', async () => {
  const { w, A, B } = await twoSynced();
  A.page.setJoiner('line');
  await w.run();
  assert.equal(cloud(w).head.board.joiner, 'line');
  const rev = cloud(w).head.rev;
  // B has no joiner of its own: its pushes write the account's value back, never null.
  assert.equal(B.board().prefs.joiner, undefined);
  B.page.addNote(B.board().projects[0].id, 'from B');
  await w.run();
  assert.ok(cloud(w).head.rev > rev);
  assert.equal(cloud(w).head.board.joiner, 'line');
  await B.syncNow();
  await w.run();
  assert.equal(B.board().prefs.joiner, 'line');
});

test('HEAD_MOVED: a commit that loses the race pulls, merges and tries again, with nothing doubled', async () => {
  const { w, A, ids } = await twoSynced();
  const uid = w.uid();
  let other = null;
  w.mock.bumpHeadBetweenGetAndCommit({ uid, change: (remote) => { other = remote.addNote(ids.work, 'from the other computer').id; } });
  A.page.editNote(ids.a, 'alpha, raced');
  await w.run();
  assert.ok(w.mock.log.some((e) => e.tags?.includes('bumped')), 'the race happened');
  assert.ok(!w.mock.log.some((e) => e.error), 'and the change made in it went through');
  const c = cloud(w);
  assert.equal(c.notes[ids.a].text, 'alpha, raced');
  assert.equal(noteText(A, other), 'from the other computer');
  assertShadowIsCloud(w, A);
  noDuplicateIds(A);
  assert.equal(A.page.notes().filter((x) => x.note.text === 'alpha, raced').length, 1);
});

test('copy counts add up across computers: base + mine + theirs', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.copy(ids.a);
  A.page.copy(ids.a);
  B.page.copy(ids.a, 3);
  // Copies alone wait for blur, hide, ten minutes or quit (5.2).
  await w.run();
  assert.equal(cloud(w).notes[ids.a].copied, 0);
  A.blur();
  B.blur();
  await w.run();
  await A.syncNow();
  await B.syncNow();
  await w.run();
  assert.equal(A.page.findNote(ids.a).note.copied, 5);
  assert.equal(B.page.findNote(ids.a).note.copied, 5);
  assert.equal(cloud(w).notes[ids.a].copied, 5);
});

// ================================================================ chunks and pictures

test('a large first upload: chunks of at most 400 writes in the order of 5.5, pictures uploaded before the commit that uses them', async () => {
  const bodies = [];
  const spy = (fetchImpl) => async (url, init = {}) => {
    if (String(url).endsWith(':commit')) bodies.push(JSON.parse(init.body));
    return fetchImpl(url, init);
  };
  const w = world({ fetchSpy: spy });
  const [A] = w.peers;
  await A.boot();
  const p = A.page;
  p.deleteProject(p.data.projects[0].id);
  const big = p.addProject('Big');
  for (let i = 0; i < 450; i++) p.addNote(big, `note ${i}`);
  const pics = [];
  for (let i = 0; i < 3; i++) {
    const id = p.addNote(big, `picture note ${i}`);
    pics.push({ note: id, image: p.addPicture(id, pngBytes(i === 0 ? 300 * 1024 : 4096, i + 1)) });
  }
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  const board = bodies.filter((b) => b.writes[0].updateMask?.fieldPaths?.includes('rev')); // board commits
  assert.ok(board.length >= 2, 'more than one chunk');
  for (const b of board) assert.ok(b.writes.length <= 400);
  const kinds = board.flatMap((b) => b.writes.slice(1).map((x) => x.update.name.split('/').slice(-2)[0]));
  assert.equal(kinds[0], 'projects', 'the project is created first');
  const notesOrder = board.flatMap((b) => b.writes.slice(1).filter((x) => x.update.name.includes('/notes/')).map((x) => x.update.fields.text?.stringValue));
  const firstPicture = notesOrder.findIndex((t) => t?.startsWith('picture note'));
  assert.equal(firstPicture, 450, 'notes without pictures go first');
  // Each picture: thumbnail then full size, both done before the commit that references it.
  const log = w.mock.log;
  for (const { image } of pics) {
    const up = (thumb) => log.find((e) => e.service === 'storage' && e.tags?.includes('uploaded') && e.name?.endsWith(`${image}${thumb ? '.t' : ''}.png`));
    const commit = log.find((e) => e.op === 'commit' && e.status === 200 && e.seq > up(false).seq && e.writes > 1);
    assert.ok(up(true).done < up(false).done, 'the thumbnail first');
    assert.ok(up(false).done < commit.seq, 'both before the commit');
    assert.equal(up(true).auth, 'Firebase');
  }
  assert.ok(log.some((e) => e.protocol === 'resumable'), 'the 300 KB picture goes up resumable');
  assert.deepEqual(Object.keys(w.mock.objects(w.uid())).length, 6);
  assert.equal(cloud(w).head.stats.notes, 453);
  assert.equal(cloud(w).head.stats.images, 3);
  assert.equal(A.status().phase, 'synced');
});

// ================================================================ the first sign-in (5.9)

test('first sign-in, empty account and a pristine Welcome here: uploaded with no question', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  await signIn(w, A);
  assert.equal(A.choice(), null);
  const c = cloud(w);
  assert.equal(c.head.rev >= 2, true);
  assert.equal(Object.keys(c.projects).length, 1);
  assert.equal(Object.keys(c.notes).length, 10);
  assert.equal(c.head.privacy, undefined, 'a sign-in (not a sign-up) knows no privacy acceptance');
  assert.deepEqual(A.backups.made, [], 'the seed holds nothing personal: no backup');
  assert.equal(A.readState().mode, 'normal');
  assert.equal(A.readDevice().lastUid, w.uid());
  // The device record exists only once the head does, and holds this computer's own things.
  const dev = Object.values(c.devices);
  assert.equal(dev.length, 1);
  assert.deepEqual(Object.keys(dev[0]).sort(), ['appVersion', 'drafts', 'lastRev', 'lastSeenAt', 'name', 'platform', 'settings', 'view']);
  assert.equal(dev[0].platform, 'win32');
  assert.equal(dev[0].name, 'Windows PC');
  assert.deepEqual(Object.keys(dev[0].settings).sort(), ['hideAfterCopy', 'hint', 'hotkey', 'language', 'model', 'shotHotkey', 'theme']);
  assert.equal(JSON.parse(dev[0].view).prefs.density, 'slim');
});

test('first sign-in, a pristine Welcome in the account and here: the account\'s is used, silently', async () => {
  const w = world();
  const [A, B] = w.peers;
  await A.boot();
  await signIn(w, A);
  await B.boot();
  const before = B.board().projects[0].id;
  await signIn(w, B);
  assert.equal(B.choice(), null);
  assert.notEqual(B.board().projects[0].id, before);
  assert.deepEqual(view(B), view(A));
  assert.deepEqual(B.page.notices, [], 'identical boards: no toast');
  assert.deepEqual(B.backups.made, []);
});

test('first sign-in, empty account and a real board here: "Upload this board?", Not now, then Upload', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  const writes = () => w.mock.log.filter((e) => e.op === 'commit').length;
  await signIn(w, A);
  assert.deepEqual(A.choice(), { kind: 'first-upload', local: { projects: 2, notes: 6, pictures: 0 } });
  assert.equal(A.status().phase, 'choosing');
  assert.equal(writes(), 0, 'nothing is written before the answer');
  assert.equal(cloud(w).head, null);
  assert.deepEqual(A.choose('not-now'), { ok: true });
  await w.run();
  assert.equal(A.status().phase, 'choosing');
  assert.equal(writes(), 0);
  assert.deepEqual(A.choose('combine'), { ok: false, code: 'UNAVAILABLE' }, 'not an answer to this question');
  assert.deepEqual(A.choose('upload'), { ok: true });
  await w.run();
  assert.equal(A.choice(), null);
  assert.deepEqual(A.backups.made.map((b) => b.kind), ['before-sync']);
  assert.deepEqual(cloud(w).head.stats, { projects: 2, notes: 6, images: 0 });
  assert.equal(A.status().phase, 'synced');
  assertShadowIsCloud(w, A);
});

test('first sign-in over the account\'s pristine Welcome: Upload tombstones it (trash copies) past the mass-delete guard', async () => {
  const w = world();
  const [A, B] = w.peers;
  await B.boot();
  await signIn(w, B); // the account holds a pristine Welcome
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A);
  assert.equal(A.choice().kind, 'first-upload');
  A.choose('upload');
  await w.run();
  assert.equal(A.choice(), null, 'no mass-delete question');
  const c = cloud(w);
  const welcome = Object.values(c.projects).find((p) => p.name === 'Welcome' || p._sync.deleted);
  assert.equal(welcome._sync.deleted, true);
  assert.equal(Object.values(c.notes).filter((n) => n._sync.deleted).length, 10);
  assert.equal(Object.keys(c.trash).length, 11);
  for (const t of Object.values(c.trash)) {
    const expireAt = Date.parse(t.expireAt);
    assert.ok(Math.abs(expireAt - (w.time.now() + 30 * 24 * 3600 * 1000)) < 60000, 'expireAt is 30 days ahead');
  }
  const typed = w.mock.doc(`users/${w.uid()}/trash/${Object.keys(c.trash)[0]}`).fields.expireAt;
  assert.ok(typed.timestampValue, 'expireAt is a timestamp, as the rules require');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(B), view(A));
});

test('first sign-in, a board in the account and a pristine Welcome here: a backup, then the account\'s board', async () => {
  const { w, B } = await twoSynced();
  assert.deepEqual(B.backups.made.map((b) => b.kind), ['before-sync']);
  assert.deepEqual(B.page.notices.map((n) => n.code), ['USED_ACCOUNT']);
  assert.ok(B.page.patches.some((p) => p.resetHistory), 'undo history is cleared');
  assert.equal(B.page.history, 0);
  assertShadowIsCloud(w, B);
});

test('first sign-in, a board on both sides: Combine keeps everything from both, with a backup first', async () => {
  const { w, A } = await twoSynced({ names: ['A', 'B', 'C'] });
  const C = w.peers[2];
  await C.boot();
  const mine = realBoard(C); // same names, other ids
  C.page.addNote(mine.work, 'only on C');
  await w.run();
  await signIn(w, C);
  const ch = C.choice();
  assert.equal(ch.kind, 'first-merge');
  assert.deepEqual(ch.local, { projects: 2, notes: 7, pictures: 0 });
  assert.deepEqual([ch.account.projects, ch.account.notes, ch.account.pictures], [2, 6, 0]);
  assert.ok(ch.account.changedAt > 0);
  assert.deepEqual(ch.account.device, { platform: 'win32', sameAsThis: false }, 'A wrote last: "your Windows PC"');
  assert.equal(ch.otherAccount, undefined);
  assert.deepEqual(C.choose('combine'), { ok: true });
  await w.run();
  assert.deepEqual(C.backups.made.map((b) => b.kind), ['before-sync']);
  assert.ok(C.page.notices.some((n) => n.code === 'COMBINED'));
  assert.equal(C.board().projects.length, 4, 'the account\'s columns, then this computer\'s');
  assert.ok(texts(C).includes('only on C'));
  await A.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(C));
  assertShadowIsCloud(w, C);
});

test('first sign-in, a board on both sides: Use my account\'s board replaces this one, after a backup', async () => {
  const { w, A } = await twoSynced({ names: ['A', 'B', 'C'] });
  const C = w.peers[2];
  await C.boot();
  realBoard(C);
  await w.run();
  await signIn(w, C, { answer: 'use-account' });
  assert.deepEqual(view(C), view(A));
  assert.ok(C.page.notices.some((n) => n.code === 'USED_ACCOUNT'));
  const backup = C.backups.made[0];
  assert.equal(backup.kind, 'before-sync');
  assert.equal(C.backups.readData(backup.id).projects.length, 2, 'the old board is in the backup');
  assert.equal(cloud(w).head.stats.notes, 6, 'nothing of C\'s went up');
});

test('another account on this computer: the question warns, and nothing from the first account goes up unasked', async () => {
  const { w, A } = await twoSynced();
  const res = await A.signOut();
  assert.deepEqual(res, { ok: true });
  assert.equal(fs.existsSync(path.join(A.dir, 'sync', 'account.json')), false);
  assert.equal(fs.existsSync(path.join(A.dir, 'sync', 'shadow.json')), true, 'the shadow stays for the same account');
  w.mock.createUser({ email: 'second@example.com', password: PASSWORD, verified: true });
  const before = w.mock.log.length;
  assert.deepEqual(await A.signIn('second@example.com', PASSWORD), { ok: true });
  await w.run();
  const ch = A.choice();
  assert.equal(ch.kind, 'first-upload');
  assert.equal(ch.otherAccount, 'o•••@example.com');
  assert.ok(!w.mock.log.slice(before).some((e) => e.op === 'commit'), 'nothing written to the second account');
  assert.equal(A.readShadow(), null, 'the first account\'s shadow is gone');
});

test('a lost race to create the head (HEAD_MOVED, ALREADY_EXISTS) restarts the first-sync decision', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A);
  let raced = false;
  w.mock.fail({
    service: 'firestore',
    status: 503,
    op: (e) => {
      if (e.op === 'commit' && !raced) {
        raced = true;
        const r = w.mock.remote(w.uid());
        r.createHead();
        const p = r.addProject('From the other computer').id;
        r.addNote(p, 'theirs');
      }
      return false;
    },
  });
  A.choose('upload');
  await w.run();
  assert.ok(raced);
  assert.ok(w.mock.log.some((e) => e.op === 'commit' && e.status === 409), 'ALREADY_EXISTS');
  assert.equal(A.choice()?.kind, 'first-merge', 'the account has a board now: the other question');
  A.choose('combine');
  await w.run();
  assert.ok(texts(A).includes('theirs'));
  assert.ok(texts(A).includes('alpha'));
});

// ================================================================ union triggers (5.10)

const tombstones = (w) => [...Object.values(cloud(w).notes), ...Object.values(cloud(w).projects)].filter((d) => d._sync.deleted).length;
const unreadableCopies = (peer) => fs.readdirSync(peer.dir).filter((n) => /^recaller-data\.unreadable-.+\.json$/.test(n));

test('.bak fallback: a union that brings back what the older file lacks and deletes nothing, even with no new rev', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.restart(); // the .bak now holds the board as it is
  const later = B.page.addNote(ids.work, 'later, from B');
  await w.run();
  await A.syncNow();
  await w.run();
  assert.equal(noteText(A, later), 'later, from B');
  const rev = A.readState().rev;
  assert.equal(rev, cloud(w).head.rev, 'A is up to date: H == state.rev');
  A.kill();
  assert.ok(!fs.readFileSync(`${A.dataFile}.bak`, 'utf8').includes('later, from B'), 'the .bak is older');
  fs.writeFileSync(A.dataFile, '{ this is not json');
  const graves = tombstones(w);
  await A.boot();
  assert.equal(A.readState().mode, 'union');
  assert.equal(A.readState().stale, true);
  assert.equal(unreadableCopies(A).length, 1, 'the unreadable file is copied aside first');
  await w.run();
  assert.equal(noteText(A, later), 'later, from B', 'the merge ran although nothing was new');
  assert.equal(tombstones(w), graves, 'nothing deleted in the account');
  assert.equal(A.readState().mode, 'normal');
  assert.deepEqual(view(A), view(B));
});

test('both files unreadable: the fresh Welcome is replaced by the account\'s board, and never uploaded', async () => {
  const { w, A, B } = await twoSynced();
  A.kill();
  fs.writeFileSync(A.dataFile, 'garbage');
  fs.writeFileSync(`${A.dataFile}.bak`, 'more garbage');
  const graves = tombstones(w);
  const projects = Object.keys(cloud(w).projects).length;
  await A.boot();
  assert.equal(A.readState().seeded, true);
  assert.equal(unreadableCopies(A).length, 1);
  await w.run();
  assert.deepEqual(view(A), view(B));
  assert.ok(A.page.notices.some((n) => n.code === 'RESTORED_FROM_ACCOUNT'));
  assert.equal(tombstones(w), graves);
  assert.equal(Object.keys(cloud(w).projects).length, projects, 'the seed never went up');
  assert.equal(A.readState().seeded, false);
});

test('a file this app didn\'t write last (fingerprint mismatch): a union, so a note gone from it comes back and edits push', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.kill();
  const data = JSON.parse(fs.readFileSync(A.dataFile, 'utf8'));
  const work = data.projects.find((p) => p.id === ids.work);
  work.notes = work.notes.filter((n) => n.id !== ids.b);
  work.notes.find((n) => n.id === ids.a).text = 'alpha, edited by hand';
  fs.writeFileSync(A.dataFile, JSON.stringify(data)); // not as writeJsonAtomic writes it
  await A.boot();
  assert.equal(A.readState().mode, 'union');
  await w.run();
  assert.equal(noteText(A, ids.b), 'bravo', 'never deleted from a file this app didn\'t write');
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, edited by hand');
  assert.equal(cloud(w).notes[ids.b]._sync.deleted, false);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(B), view(A));
});

test('restoring a backup while signed in: nothing is deleted from the account, the backup\'s notes come back on B, B\'s newer ones stay', async () => {
  const { w, A, B, ids } = await twoSynced();
  const backup = A.backups.create('manual');
  A.page.deleteNote(ids.c);
  const after = A.page.addNote(ids.work, 'after the backup');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(noteText(B, ids.c), null);
  const newer = B.page.addNote(ids.home, 'newer on B');
  await w.run();
  const graves = tombstones(w);
  A.restoreBackup(backup);
  assert.equal(A.readState().mode, 'restore', 'persisted before the restored file is written');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(noteText(B, ids.c), 'charlie', 'the backup\'s note is back on B');
  assert.equal(noteText(A, newer), 'newer on B');
  assert.equal(noteText(A, after), 'after the backup', 'restoring never deletes from the account');
  assert.equal(tombstones(w), graves - 1, 'charlie undeleted, nothing new deleted');
  assert.deepEqual(view(A), view(B));
  assert.equal(A.readState().mode, 'normal');
});

test('signing in again as the same account resumes from the shadow: normal when the file is unchanged, a union when not', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.signOut();
  assert.deepEqual(await A.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(A.readState().mode, 'normal');
  await w.run();
  assert.equal(A.choice(), null);
  await A.signOut();
  A.page.deleteNote(ids.b); // made while signed out: never a deletion in the account
  await w.run();
  assert.deepEqual(await A.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(A.readState().mode, 'union');
  await w.run();
  assert.equal(noteText(A, ids.b), 'bravo');
  assert.equal(cloud(w).notes[ids.b]._sync.deleted, false);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// ================================================================ 403s (5.5 step 9 and the lead's policy)

const notePath = (w, id) => `users/${w.uid()}/notes/${codec.docId(id)}`;

test('a 403 from a race the rules saw first (the head moved): pull, merge and retry, never a quarantine', async () => {
  const { w, A, ids } = await twoSynced();
  let theirs = null;
  w.mock.fail({
    service: 'firestore',
    status: 403,
    times: 1,
    op: (e) => {
      if (e.op !== 'commit' || theirs) return false;
      theirs = w.mock.remote(w.uid()).addNote(ids.home, 'theirs, in the race').id; // the head moves first
      return true;
    },
  });
  A.page.editNote(ids.a, 'mine, refused at first');
  await w.run();
  assert.ok(theirs, 'the race happened');
  assert.equal(A.status().quarantined, 0);
  assert.equal(cloud(w).notes[ids.a].text, 'mine, refused at first');
  assert.equal(noteText(A, theirs), 'theirs, in the race');
  assertShadowIsCloud(w, A);
});

test('a 403 that passes (a rules deploy): the head is unchanged, a short wait, then the same chunk goes through', async () => {
  const { w, A, ids } = await twoSynced();
  const undo = w.mock.denyDoc(notePath(w, ids.a));
  const lastCommit = () => w.mock.log.filter((e) => e.op === 'commit').at(-1);
  A.onCall = (phase, label) => {
    if (phase === 'after' && label === 'firestore.commit' && lastCommit()?.status === 403) undo(); // the denial ends during the wait
  };
  A.page.editNote(ids.a, 'alpha, after a passing denial');
  await w.run();
  A.onCall = null;
  assert.equal(A.status().quarantined, 0);
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, after a passing denial');
  assert.equal(w.mock.log.filter((e) => e.op === 'commit' && e.status === 403).length, 1, 'refused once, then through');
});

test('a lasting 403: after the waits the chunk is split, the refused note quarantined, the rest synced; Retry syncs it once allowed', async () => {
  const { w, A, B, ids } = await twoSynced();
  const undo = w.mock.denyDoc(notePath(w, ids.b));
  A.page.editNote(ids.a, 'alpha 2');
  A.page.editNote(ids.b, 'bravo 2, refused');
  A.page.editNote(ids.h, 'home 2');
  await w.run();
  const st = A.status();
  assert.equal(st.quarantined, 1);
  assert.equal(st.tooLarge, 0);
  assert.equal(st.phase, 'paused');
  assert.deepEqual(st.error, { code: 'PERMISSION' });
  assert.equal(A.readState().quarantine[`note:${ids.b}`].code, 'PERMISSION');
  const c = cloud(w);
  assert.equal(c.notes[ids.a].text, 'alpha 2');
  assert.equal(c.notes[ids.h].text, 'home 2');
  assert.equal(c.notes[ids.b].text, 'bravo');
  // Held back while unchanged: another push doesn't retry it.
  const before = w.mock.log.filter((e) => e.status === 403).length;
  A.page.editNote(ids.a, 'alpha 3');
  await w.run();
  assert.equal(w.mock.log.filter((e) => e.status === 403).length, before);
  undo();
  A.retry();
  await w.run();
  assert.equal(A.status().quarantined, 0);
  assert.equal(A.status().phase, 'synced');
  assert.equal(cloud(w).notes[ids.b].text, 'bravo 2, refused');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(B), view(A));
});

test('a quarantined note is retried once it changes', async () => {
  const { w, A, ids } = await twoSynced();
  const undo = w.mock.denyDoc(notePath(w, ids.b));
  A.page.editNote(ids.b, 'refused');
  await w.run();
  assert.equal(A.status().quarantined, 1);
  undo();
  A.page.editNote(ids.b, 'changed: tried again');
  await w.run();
  assert.equal(A.status().quarantined, 0);
  assert.equal(cloud(w).notes[ids.b].text, 'changed: tried again');
});

// ================================================================ lost answers (5.5 step 13 and the lead's notes)

test('a lost commit answer: the head shows it landed, so it counts as done; nothing is sent twice', async () => {
  const { w, A, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  A.page.copy(ids.a, 2);
  A.page.editNote(ids.a, 'alpha, answer lost');
  w.mock.fail({ service: 'firestore', op: 'commit', status: 'offline', lost: true, times: 1 });
  const rev = cloud(w).head.rev;
  await w.run();
  const c = cloud(w);
  assert.equal(c.head.rev, rev + 1, 'one commit');
  assert.equal(c.notes[ids.a].copied, 2);
  assert.equal(A.page.findNote(ids.a).note.copied, 2);
  assert.equal(A.readState().rev, rev + 1);
  assert.equal(A.status().phase, 'synced');
  assertShadowIsCloud(w, A);
});

test('a lost commit answer, then another computer commits: its documents show it landed, and later changes merge as changes', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.syncNow(); // the device record, if due, goes now: the next commit is the board's
  await w.run();
  A.page.copy(ids.a, 2);
  A.page.editNote(ids.a, 'alpha from A');
  A.page.editNote(ids.b, 'bravo from A');
  w.mock.fail({ service: 'firestore', op: 'commit', status: 'offline', lost: true, times: 1 });
  let raced = false;
  A.onCall = (phase, label) => {
    if (phase === 'after' && label === 'firestore.commit' && !raced) {
      raced = true; // before A hears anything, the other computer edits one of the same notes, on top of A's
      w.mock.remote(w.uid()).editNote(ids.b, 'bravo, then the other computer');
    }
  };
  await w.run();
  A.onCall = null;
  assert.ok(raced);
  assert.equal(noteText(A, ids.b), 'bravo, then the other computer', 'a later edit, not a conflict');
  assert.equal(A.page.notes().filter((x) => x.note.syncConflict).length, 0);
  assert.equal(A.page.findNote(ids.a).note.copied, 2, 'counted once');
  assert.equal(cloud(w).notes[ids.a].copied, 2);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

test('a commit whose answer is lost and that never landed is tried again after a backoff', async () => {
  const { w, A, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  A.page.editNote(ids.a, 'alpha, offline for a moment');
  w.mock.fail({ service: 'firestore', op: 'commit', status: 'offline', times: 1 });
  await w.run();
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, offline for a moment');
  assert.equal(A.status().phase, 'synced');
});

// ================================================================ crash after the acknowledging save (5.18)

test('a crash after the acknowledging save, before shadow.json: the marker applies the delta and copy counts never double', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.page.copy(ids.a, 3);
  B.page.editNote(ids.h, 'home from B');
  B.blur();
  await w.run();
  assert.equal(cloud(w).notes[ids.a].copied, 3);
  let crashed = false;
  A.onCall = (phase, label) => {
    // The marker is in state.json with the save's fingerprint; shadow.json hasn't advanced.
    if (phase === 'before' && label === 'syncDir.writeShadow' && A.readState().ack && !crashed) {
      crashed = true;
      A.kill();
    }
  };
  await A.syncNow();
  await w.run();
  assert.ok(crashed, 'the crash happened at that point');
  A.onCall = null;
  assert.equal(A.disk().projects.flatMap((p) => p.notes).find((n) => n.id === ids.a).copied, 3, 'the patch is on disk');
  await A.boot();
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(A.page.findNote(ids.a).note.copied, 3);
  assert.equal(B.page.findNote(ids.a).note.copied, 3);
  assert.equal(cloud(w).notes[ids.a].copied, 3);
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

// ================================================================ the mass-delete guard (5.5 step 4)

test('deletions no undo label explains: the mass-delete question; Keep brings the notes back and deletes nothing', async () => {
  const { w, A, B, ids } = await twoSynced();
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push(A.page.addNote(ids.home, `extra ${i}`));
  await w.run();
  const graves = tombstones(w);
  A.page.mutate((data) => { // a crafted save: five notes gone, no label
    const home = data.projects.find((p) => p.id === ids.home);
    home.notes = [];
  });
  await w.run();
  assert.deepEqual(A.choice(), { kind: 'mass-delete', count: 5 });
  assert.equal(A.status().phase, 'choosing');
  assert.equal(tombstones(w), graves);
  assert.deepEqual(A.choose('keep'), { ok: true });
  await w.run();
  assert.equal(A.choice(), null);
  for (const id of [ids.h, ...extra]) assert.ok(noteText(A, id), 'back on this computer');
  assert.equal(tombstones(w), graves, 'nothing deleted in the account');
  assert.equal(A.readState().mode, 'normal');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

test('the same deletions, answered Delete them everywhere: the tombstones go up; deletes a person makes never ask', async () => {
  const { w, A, B, ids } = await twoSynced();
  for (let i = 0; i < 4; i++) A.page.addNote(ids.home, `extra ${i}`);
  await w.run();
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.home).notes = []; });
  await w.run();
  assert.equal(A.choice().kind, 'mass-delete');
  A.choose('delete-everywhere');
  await w.run();
  assert.equal(A.choice(), null);
  assert.equal(Object.values(cloud(w).notes).filter((n) => n._sync.deleted && n._sync.project === ids.home).length, 5);
  // A person's deletes carry their undo labels: no question, even for a whole project.
  A.page.deleteProject(ids.work);
  await w.run();
  assert.equal(A.choice(), null);
  assert.equal(cloud(w).projects[ids.work]._sync.deleted, true);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, B);
});

// ================================================================ size limits (4.7)

test('a note over 900 KB stays here (TOO_LARGE) while the others sync; once smaller it goes up', async () => {
  const { w, A, ids } = await twoSynced();
  A.page.editNote(ids.b, 'x'.repeat(950 * 1000));
  A.page.editNote(ids.a, 'alpha, small');
  await w.run();
  const st = A.status();
  assert.deepEqual([st.tooLarge, st.quarantined, st.phase], [1, 1, 'paused']);
  assert.equal(st.error, undefined, 'the page says TOO_LARGE from tooLarge');
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, small');
  assert.equal(cloud(w).notes[ids.b].text, 'bravo');
  A.page.editNote(ids.b, 'bravo, small again');
  await w.run();
  assert.deepEqual([A.status().tooLarge, A.status().quarantined, A.status().phase], [0, 0, 'synced']);
  assert.equal(cloud(w).notes[ids.b].text, 'bravo, small again');
});

test('a picture over 32 MB stays here (tooLargePictures); its note still syncs', async () => {
  const { w, A, ids } = await twoSynced();
  const big = Buffer.alloc(33 * 1024 * 1024, 7);
  const image = A.page.addPicture(ids.a, big);
  await w.run();
  assert.equal(A.status().tooLargePictures, 1);
  assert.equal(A.status().phase, 'paused');
  const note = cloud(w).notes[ids.a];
  assert.equal(note.images[0].id, image, 'the note went up');
  const objects = Object.keys(w.mock.objects(w.uid()));
  assert.ok(objects.some((n) => n.endsWith(`${image}.t.png`)), 'its thumbnail too');
  assert.ok(!objects.some((n) => n.endsWith(`${image}.png`)), 'not the picture');
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.work).notes.find((n) => n.id === ids.a).images = []; }, { label: 'Edit note' });
  await w.run();
  assert.equal(A.status().tooLargePictures, 0);
});

// ================================================================ the page: editors, drafts, deferral (5.8)

test('an open editor holds B\'s change back (waiting); saving there keeps both versions, cancelling lets it in', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.openEditor(ids.a);
  B.page.editNote(ids.a, 'alpha from B');
  await w.run([B]);
  await A.syncNow();
  await w.time.advance(3000);
  const st = A.status();
  assert.equal(st.phase, 'waiting');
  assert.deepEqual(st.waitingFor, { platform: 'darwin', sameAsThis: false });
  assert.equal(noteText(A, ids.a), 'alpha', 'nothing changes under the editor');
  A.page.closeEditor('alpha from A, saved in the editor');
  await w.run();
  const copy = A.page.notes().find((x) => x.note.syncConflict);
  assert.ok(copy, 'a conflict copy');
  assert.equal(copy.note.text, 'alpha from A, saved in the editor');
  assert.equal(copy.note.highlight, 'amber');
  assert.equal(noteText(A, ids.a), 'alpha from B', 'the account\'s version stays in place');
  assert.ok(A.page.notices.some((n) => n.code === 'CONFLICT'));
  assert.ok(A.page.nacks.some((n) => n.reason === 'stale'));
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));

  // Cancel: the remote edit applies.
  A.page.openEditor(ids.c);
  B.page.editNote(ids.c, 'charlie from B');
  await w.run([B]);
  await A.syncNow();
  await w.time.advance(3000);
  assert.equal(noteText(A, ids.c), 'charlie');
  A.page.closeEditor(null);
  await w.run();
  assert.equal(noteText(A, ids.c), 'charlie from B');
});

test('a project deleted on B while A has a draft in it: kept on both, with KEPT_PROJECT_DRAFT', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.setDraft(ids.home, 'a draft I am still writing');
  await w.run();
  B.page.deleteProject(ids.home);
  await w.run();
  await A.syncNow();
  await w.run();
  assert.ok(A.page.findProject(ids.home), 'kept here');
  assert.equal(A.page.findProject(ids.home).draft, 'a draft I am still writing');
  assert.ok(A.page.notices.some((n) => n.code === 'KEPT_PROJECT_DRAFT'));
  await B.syncNow();
  await w.run();
  assert.ok(B.page.findProject(ids.home), 'and undeleted on B');
  assert.deepEqual(view(A), view(B));
});

test('a note deleted on A while B edits it: it survives with B\'s text, and A is told', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.deleteNote(ids.b);
  B.page.editNote(ids.b, 'bravo, edited on B');
  await w.run();
  await A.syncNow();
  await B.syncNow();
  await A.syncNow();
  await w.run();
  assert.equal(noteText(A, ids.b), 'bravo, edited on B');
  assert.equal(noteText(B, ids.b), 'bravo, edited on B');
  assert.ok(A.page.notices.some((n) => n.code === 'KEPT_NOTE'));
  assert.deepEqual(view(A), view(B));
});

// ================================================================ offline, tokens

test('offline: no requests, the changes count up, and once back online one push takes them all', async () => {
  const { w, A, ids } = await twoSynced();
  A.setOnline(false);
  let calls = 0;
  A.onCall = (phase, label) => { if (phase === 'before' && /^(firestore|storage)\./.test(label)) calls++; };
  const before = w.mock.log.length;
  A.page.editNote(ids.a, 'a 2');
  A.page.editNote(ids.b, 'b 2');
  A.page.editNote(ids.c, 'c 2');
  await w.time.advance(5000);
  A.onCall = null;
  assert.equal(calls, 0, 'no requests while offline');
  assert.deepEqual([A.status().phase, A.status().pending], ['offline', 3]);
  assert.equal(A.engine.hasUnpushed(), true);
  A.setOnline(true);
  await w.run();
  const pushes = commits(w).filter((e) => e.seq > before && e.writes > 1);
  assert.equal(pushes.length, 1);
  assert.deepEqual([A.status().phase, A.status().pending], ['synced', 0]);
});

test('expired ID tokens are refreshed without anyone noticing', async () => {
  const { w, A, ids } = await twoSynced();
  w.mock.expireIdTokens();
  A.page.editNote(ids.a, 'after the tokens expired');
  await w.run();
  assert.equal(cloud(w).notes[ids.a].text, 'after the tokens expired');
  assert.ok(w.mock.log.some((e) => e.status === 401));
  assert.equal(A.account.state().status, 'signed-in');
});

test('a revoked sign-in: needs-sign-in, edits still save here, and signing in again pushes them with nothing deleted', async () => {
  const { w, A, ids } = await twoSynced();
  w.mock.revokeTokens(EMAIL);
  w.mock.expireIdTokens();
  A.page.editNote(ids.a, 'made while signed out by the server');
  await w.run();
  assert.equal(A.account.state().status, 'needs-sign-in');
  assert.equal(A.disk().projects.find((p) => p.id === ids.work).notes.find((n) => n.id === ids.a).text, 'made while signed out by the server');
  const graves = tombstones(w);
  assert.deepEqual(await A.signIn(EMAIL, PASSWORD), { ok: true });
  await w.run();
  assert.equal(cloud(w).notes[ids.a].text, 'made while signed out by the server');
  assert.equal(tombstones(w), graves);
});

test('a sign-in after the page has loaded: an empty patch first learns the page\'s contentSeq', async () => {
  const w = world();
  const [A, B] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  await B.boot();
  const mine = realBoard(B); // edits before signing in: contentSeq is well past 0
  await w.run();
  assert.ok(B.page.contentSeq > 5);
  await signIn(w, B, { answer: 'combine' });
  const first = B.page.patches[0];
  assert.equal(first.changesContent, false, 'the probe');
  assert.deepEqual(first.notices, []);
  assert.ok(B.page.patches[1].changesContent);
  assert.equal(B.page.nacks.length, 0, 'never stale');
  assert.ok(noteText(B, mine.a));
  await A.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// ================================================================ audit, minRev, schema (5.11, D20)

test('the audit: when head.stats disagrees, documents the shadow has wrong are fetched and merged, and ones the cloud lacks upload again', async () => {
  const { w, A, ids } = await twoSynced();
  const uid = w.uid();
  const head = cloud(w).head;
  // Behind A's back: a note appears in the account at an old rev, and one of A's documents vanishes.
  w.mock.writeDoc(`users/${uid}/notes/ghost`, {
    text: 'a note A never pulled', images: [], createdAt: 1, updatedAt: 1, usedAt: 0, copied: 0, lastCopiedAt: 0,
    _sync: { rev: 1, key: 'zz', deleted: false, by: 'b0'.repeat(16), project: ids.work, list: 'notes' },
  });
  w.mock.writeDoc(notePath(w, ids.c), null);
  w.mock.writeDoc(`users/${uid}`, { ...head, stats: { projects: 2, notes: 99, images: 0 } });
  await A.engine.syncNow();
  await w.run();
  assert.equal(noteText(A, 'ghost'), 'a note A never pulled', 'merged as a pull');
  assert.equal(cloud(w).notes[ids.c].text, 'charlie', 'the vanished document uploaded again');
  assertShadowIsCloud(w, A);
  assert.ok(A.readState().lastAuditAt > 0);
});

test('minRev above state.rev: a full resync, where entries the cloud dropped at or below minRev count as deleted', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.setOnline(false);
  B.page.deleteNote(ids.c);
  await w.run();
  const uid = w.uid();
  const gone = cloud(w).notes[ids.c];
  const head = cloud(w).head;
  // A clean-up (not built in v1) erased the tombstone and raised minRev past A's state.
  w.mock.writeDoc(notePath(w, ids.c), null);
  w.mock.writeDoc(`users/${uid}`, { ...head, minRev: gone._sync.rev });
  assert.ok(A.readState().rev < gone._sync.rev);
  A.setOnline(true);
  await A.syncNow();
  await w.run();
  assert.equal(noteText(A, ids.c), null, 'deleted here too');
  assert.equal(A.readState().rev, cloud(w).head.rev);
  assert.equal(A.readShadow().notes[ids.c], undefined);
  assert.deepEqual(view(A), view(B));
});

test('a head written by a newer version (schema 2): update-needed, and nothing is written', async () => {
  const { w, A, ids } = await twoSynced();
  const head = cloud(w).head;
  w.mock.writeDoc(`users/${w.uid()}`, { ...head, schema: 2 });
  const before = commits(w).length;
  A.page.editNote(ids.a, 'not pushed');
  await w.run();
  assert.equal(A.status().phase, 'update-needed');
  assert.equal(commits(w).length, before);
});

// ================================================================ account deletion (5.15)

test('account deletion: deleting is set first, then pictures, documents and the head go, then the sign-in; B is gated meanwhile', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.addPicture(ids.a);
  await w.run();
  await B.syncNow();
  await w.run();
  const uid = w.uid();
  assert.ok(Object.keys(w.mock.objects(uid)).length >= 2);
  const pause = w.mock.pauseAfter('deleting');
  const progress = [];
  const done = A.deleteAccount(PASSWORD, progress);
  await pause.hit;
  // While A's deletion is held right after deleting: true, B can't write anything.
  const bState = B.readState();
  const head = w.mock.doc(`users/${uid}`);
  const bump = await B.firestore.commit([{
    update: { name: B.firestore.name(`users/${uid}`), fields: { rev: { integerValue: String(bState.rev + 1) } } },
    updateMask: { fieldPaths: ['rev'] },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { updateTime: head.updateTime },
  }]).then(() => 'ok', (e) => e.code);
  assert.equal(bump, 'PERMISSION', 'a board commit is refused');
  const device = await B.firestore.commit([{
    update: {
      name: B.firestore.name(`users/${uid}/devices/${B.readDevice().id}`),
      fields: { name: { stringValue: 'Mac' }, platform: { stringValue: 'darwin' } },
    },
    updateTransforms: [{ fieldPath: 'lastSeenAt', setToServerValue: 'REQUEST_TIME' }],
  }]).then(() => 'ok', (e) => e.code);
  assert.equal(device, 'PERMISSION', 'a device write is refused');
  const upload = await B.storage.upload(`users/${uid}/images/${'e'.repeat(32)}.png`, pngBytes(1000)).then(() => 'ok', (e) => e.code);
  assert.equal(upload, 'PERMISSION', 'an upload is refused');
  B.page.editNote(ids.b, 'B keeps editing');
  await B.syncNow();
  assert.equal(B.status().phase, 'deleting-elsewhere');
  pause.resume();
  assert.deepEqual(await done, { ok: true });
  await w.run([A]);
  const docs = w.mock.docs(uid);
  assert.equal(docs.head, null);
  for (const kind of ['projects', 'notes', 'trash', 'devices']) assert.deepEqual(docs[kind], {}, kind);
  assert.deepEqual(w.mock.objects(uid), {});
  assert.equal(w.mock.user(EMAIL), null, 'the sign-in is gone');
  assert.equal(A.account.state().status, 'signed-out');
  assert.equal(A.readState(), null);
  assert.equal(A.readShadow(), null);
  assert.equal(A.readDevice().lastUid, null);
  assert.equal(noteText(A, ids.a), 'alpha', 'the board stays here');
  assert.deepEqual([...new Set(progress.map((p) => p.what))], ['pictures', 'notes', 'account']);
  // B: the head is gone, and the account with it.
  await B.syncNow();
  await w.run([B]);
  assert.equal(B.account.state().status, 'deleted');
  assert.equal(noteText(B, ids.b), 'B keeps editing', 'B\'s board stays too');
});

test('deleting an account that never uploaded: no head, so straight to the sign-in', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A);
  assert.equal(A.choice().kind, 'first-upload');
  A.choose('not-now');
  const before = commits(w).length;
  assert.deepEqual(await A.deleteAccount(PASSWORD), { ok: true });
  assert.equal(commits(w).length, before, 'nothing to commit');
  assert.equal(w.mock.user(EMAIL), null);
});

test('a picture that lands during the deletion is caught by the second listing, before the head goes', async () => {
  const { w, A, ids } = await twoSynced();
  A.page.addPicture(ids.a);
  await w.run();
  const uid = w.uid();
  let lists = 0;
  A.onCall = (phase, label) => {
    if (phase === 'after' && label === 'firestore.queryAll.next' && lists === 0 && A.engine && A.readState()?.deletion) {
      lists++; // an upload begun before deleting was set finishes now
      w.mock.writeObject(`users/${uid}/images/${'d'.repeat(32)}.png`, pngBytes(500));
    }
  };
  assert.deepEqual(await A.deleteAccount(PASSWORD), { ok: true });
  A.onCall = null;
  assert.equal(lists, 1);
  assert.deepEqual(w.mock.objects(uid), {});
});

test('an interrupted deletion stays recorded, stops syncing, and finishes on the next try', async () => {
  const { w, A, ids } = await twoSynced();
  const uid = w.uid();
  w.mock.fail({ service: 'firestore', op: 'commit', status: 503, skip: 1, times: 1 }); // the first document batch fails
  const res = await A.deleteAccount(PASSWORD);
  assert.equal(res.ok, false);
  assert.ok(A.readState().deletion.startedAt > 0);
  assert.ok(A.engine.deletion());
  assert.equal(w.mock.doc(`users/${uid}`).data.deleting, true);
  A.page.editNote(ids.a, 'edited meanwhile');
  await w.run([A]);
  assert.notEqual(cloud(w).notes[ids.a]?.text, 'edited meanwhile');
  // The next start: still recorded; the password finishes it.
  await A.restart();
  assert.ok(A.engine.deletion());
  assert.deepEqual(await A.deleteAccount(PASSWORD), { ok: true });
  assert.equal(w.mock.doc(`users/${uid}`), null);
  assert.equal(w.mock.user(EMAIL), null);
});

test('the head is gone but the account exists: account-gone, never automatic; Upload puts this board back', async () => {
  const { w, A, B, ids } = await twoSynced();
  const uid = w.uid();
  const docs = w.mock.docs(uid);
  for (const kind of ['projects', 'notes', 'trash', 'devices']) for (const id of Object.keys(docs[kind])) w.mock.writeDoc(`users/${uid}/${kind}/${id}`, null);
  for (const name of Object.keys(w.mock.objects(uid))) w.mock.writeObject(name, null);
  w.mock.writeDoc(`users/${uid}`, null);
  await B.syncNow();
  await w.run([B]);
  assert.deepEqual(B.choice(), { kind: 'account-gone' });
  assert.equal(w.mock.docs(uid).head, null, 'nothing written by itself');
  B.choose('upload');
  await w.run([B]);
  assert.equal(B.choice(), null);
  assert.equal(cloud(w).head.stats.notes, 6);
  assert.equal(Object.values(cloud(w).notes).filter((n) => n._sync.deleted).length, 0);
  await A.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
  assert.equal(noteText(A, ids.a), 'alpha');
});

test('signing in while the account is being deleted elsewhere: deleting-elsewhere, no sync', async () => {
  const { w } = await twoSynced({ names: ['A', 'B', 'C'] });
  const uid = w.uid();
  w.mock.writeDoc(`users/${uid}`, { ...cloud(w).head, deleting: true });
  const C = w.peers[2];
  await C.boot();
  realBoard(C);
  await w.run([C]);
  await C.signIn(EMAIL, PASSWORD);
  await w.run([C]);
  assert.equal(C.status().phase, 'deleting-elsewhere');
  assert.equal(C.choice(), null);
});

// ================================================================ pictures on demand, final push, state for the page

test('pictures: thumbnails are fetched after a patch, full ones on demand', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(B.images.has(image, true), true, 'the thumbnail came with the patch');
  assert.equal(B.images.has(image, false), false, 'the full picture waits until asked for');
  assert.equal(await B.engine.ensureImage(image, false), true);
  assert.deepEqual(B.images.readFile(image), A.images.readFile(image));
  assert.equal(await B.engine.ensureImage('f'.repeat(32), false), false, 'a picture the account lacks');
  assert.equal(await B.engine.ensureImage('../etc/passwd', false), false);
});

test('the final push at quit takes content and copies within its time, and the device record if time remains', async () => {
  const { w, A, ids } = await twoSynced();
  A.page.copy(ids.a);
  A.page.editNote(ids.b, 'just before quitting');
  await A.quit(1500); // the peer moves the fake clock while the final push runs
  assert.equal(cloud(w).notes[ids.b].text, 'just before quitting');
  assert.equal(cloud(w).notes[ids.a].copied, 1);
});

test('state for the page: devices with this one marked current, counts for the delete panel, status fields', async () => {
  const { w, A, B } = await twoSynced();
  await A.syncNow();
  await w.run();
  const st = A.accountState();
  assert.equal(st.state, 'signed-in');
  const devices = st.devices;
  assert.deepEqual(devices.map((d) => [d.name, d.platform, d.current]).sort(), [['Mac', 'darwin', false], ['Windows PC', 'win32', true]]);
  assert.ok(devices.every((d) => d.lastSeenAt > 0 && /^[a-f0-9]{32}$/.test(d.id)));
  assert.deepEqual(st.counts, { projects: 2, notes: 6, pictures: 0 });
  assert.deepEqual(Object.keys(st.sync).sort(), ['lastSyncedAt', 'pending', 'phase', 'quarantined', 'tooLarge', 'tooLargePictures']);
  assert.equal(B.accountState().devices.find((d) => d.current).platform, 'darwin');
});

test('mergeSaveMeta keeps every ack, joins labels and takes the newest counters; bad meta counts as {}', () => {
  assert.equal(mergeSaveMeta(null, undefined), null);
  assert.deepEqual(mergeSaveMeta(null, 'nonsense'), { labels: [], acks: [] });
  const a = mergeSaveMeta(null, { session: 's1', seq: 1, contentSeq: 4, labels: ['Delete note'], ack: 'p1' });
  const b = mergeSaveMeta(a, { session: 's1', seq: 2, contentSeq: 5, labels: ['Edit note', 7], ack: 'p2' });
  assert.deepEqual(b, { session: 's1', seq: 2, contentSeq: 5, labels: ['Delete note', 'Edit note'], acks: ['p1', 'p2'] });
  assert.deepEqual(mergeSaveMeta(b, { labels: 'x' }), { session: 's1', seq: 2, contentSeq: 5, labels: ['Delete note', 'Edit note'], acks: ['p1', 'p2'] });
});

// ================================================================ a crash at every await (5.18)

// Both computers sync until they agree (or the rounds run out).
async function converge(w, peers, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    for (const p of peers) {
      p.blur();
      p.focus();
      await p.syncNow();
      await w.run(peers);
    }
    const views = peers.map((p) => JSON.stringify(view(p)));
    if (views.every((v) => v === views[0]) && peers.every((p) => p.status().pending === 0)) return;
  }
}

// A was offline while it edited (everything on disk); B pushed meanwhile. Then A syncs, and the run is cut at
// its `at`-th call into the world (`phase` 'before' or 'after' it). → what the crash hit, and the outcome.
async function crashRun({ at = Infinity, phase = 'before' } = {}) {
  const { w, A, B, ids } = await twoSynced();
  A.setOnline(false);
  A.page.editNote(ids.a, 'alpha from A');
  A.page.copy(ids.a, 2);
  const pictured = A.page.addNote(ids.work, 'with a picture');
  const image = A.page.addPicture(pictured, pngBytes(3000, 5));
  A.page.deleteNote(ids.c);
  A.page.moveNote(ids.b, { list: 'used' });
  await w.run([A]);
  B.page.editNote(ids.h, 'home from B');
  B.page.copy(ids.a, 3);
  B.blur();
  await w.run([B]);
  const calls = [];
  let hit = null;
  A.onCall = (p, label, args) => {
    if (p !== phase) return;
    calls.push(label);
    if (calls.length === at) {
      // The file is written, but state.json is about to record its fingerprint: the next start sees a
      // mismatch and makes a union, which resurrects rather than deletes (5.18).
      const fingerprint = label === 'syncDir.writeState' && p === 'before'
        && args?.[0]?.dataFile?.sha256 !== A.readState()?.dataFile?.sha256;
      hit = { label, fingerprint };
      A.kill();
    }
  };
  A.setOnline(true);
  await A.syncNow();
  await w.run([A, B]);
  A.onCall = null;
  if (hit) await A.boot();
  await converge(w, [A, B]);
  return { w, A, B, ids, pictured, image, calls, hit };
}

function assertRecovered({ w, A, B, ids, pictured, image, hit }, where) {
  const label = `crash ${where}`;
  assert.deepEqual(view(A), view(B), `${label}: the two computers agree`);
  for (const p of [A, B]) {
    assertShadowIsCloud(w, p);
    noDuplicateIds(p);
  }
  // Nothing reverted, nothing lost: every change A had on disk, and B's, is in place.
  assert.equal(noteText(A, ids.a), 'alpha from A', label);
  assert.equal(noteText(A, ids.h), 'home from B', label);
  assert.equal(noteText(A, pictured), 'with a picture', label);
  if (!hit?.fingerprint) assert.equal(noteText(A, ids.c), null, `${label}: the delete holds`);
  assert.equal(A.page.findNote(ids.b)?.list, 'used', label);
  assert.equal(A.page.notes().filter((x) => x.note.syncConflict).length, 0, `${label}: no conflict copies`);
  const objects = Object.keys(w.mock.objects(w.uid()));
  assert.ok(objects.some((n) => n.endsWith(`${image}.png`)) && objects.some((n) => n.endsWith(`${image}.t.png`)), `${label}: the picture`);
  // Copies: exact, except in that window right after an acknowledging save (the marker isn't beside the
  // fingerprint yet), where the incoming increment can count twice.
  const copied = A.page.findNote(ids.a).note.copied;
  if (hit?.fingerprint) assert.ok(copied === 5 || copied === 8, `${label}: copies ${copied}`);
  else assert.equal(copied, 5, `${label}: copies`);
  assert.equal(A.status().phase, 'synced', label);
}

test('a crash at every call the engine makes: the next start from disk reverts nothing, loses nothing and converges', async () => {
  const dry = await crashRun();
  assert.equal(dry.hit, null);
  assertRecovered(dry, 'nowhere');
  const counts = { before: dry.calls.length, after: 0 };
  const after = await crashRun({ phase: 'after' });
  counts.after = after.calls.length;
  assert.ok(counts.before > 20, `the engine made ${counts.before} calls`);
  const seen = new Set();
  for (const phase of ['before', 'after']) {
    for (let at = 1; at <= counts[phase]; at++) {
      const r = await crashRun({ at, phase });
      if (!r.hit) continue; // the run made fewer calls this time
      seen.add(r.hit.label);
      assertRecovered(r, `${phase} call ${at} (${r.hit.label})`);
    }
  }
  const expected = ['firestore.get', 'firestore.queryAll.next', 'firestore.commit', 'storage.upload', 'syncDir.writeState', 'syncDir.writeShadow', 'images.readFile'];
  for (const label of expected) {
    assert.ok(seen.has(label), `crashed at ${label} at least once`);
  }
});

// ================================================================ verification, errors and backoff (5.13, 5.2)

test('unverified: no Firestore or Storage traffic; once verified (found by the engine\'s own poll) the first sync runs', async () => {
  const w = world({ names: ['A'], user: false });
  const [A] = w.peers;
  await A.boot();
  assert.deepEqual(await A.signUp(EMAIL, PASSWORD), { ok: true });
  assert.equal(A.account.state().status, 'unverified');
  await w.time.advance(5000);
  assert.ok(!w.mock.log.some((e) => e.service === 'firestore' || e.service === 'storage'));
  assert.ok(w.mock.log.filter((e) => e.op === 'lookup').length >= 3, 'the engine looks every 500 ms (fast)');
  w.mock.verify(EMAIL);
  await w.time.advance(1000);
  await w.run();
  assert.equal(A.account.state().status, 'signed-in');
  assert.equal(cloud(w).head.privacy.version, '2026-10-01', 'the privacy acceptance from the sign-up');
  assert.ok(cloud(w).head.privacy.acceptedAt);
  assert.equal(Object.keys(cloud(w).notes).length, 10);
});

test('BAD_REQUEST stops pushing (paused, a client bug); Sync now tries again', async () => {
  const { w, A, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  w.mock.fail({ service: 'firestore', op: 'commit', status: 400, times: 1 });
  A.page.editNote(ids.a, 'refused as bad');
  await w.run();
  assert.equal(A.status().phase, 'paused');
  assert.deepEqual(A.status().error, { code: 'BAD_REQUEST' });
  A.page.editNote(ids.b, 'still not pushed');
  await w.run();
  assert.equal(cloud(w).notes[ids.b].text, 'bravo');
  await A.syncNow();
  await w.run();
  assert.equal(A.status().phase, 'synced');
  assert.equal(cloud(w).notes[ids.a].text, 'refused as bad');
});

test('server errors back off (paused SERVER with retryAt), then succeed without a click', async () => {
  const { w, A, ids } = await twoSynced();
  w.mock.fail({ service: 'firestore', status: 503, times: 2 });
  A.page.editNote(ids.a, 'after two 503s');
  await w.time.advance(400);
  const st = A.status();
  assert.equal(st.phase, 'paused');
  assert.equal(st.error.code, 'SERVER');
  assert.ok(st.error.retryAt > w.time.now());
  await w.run();
  assert.equal(A.status().phase, 'synced');
  assert.equal(cloud(w).notes[ids.a].text, 'after two 503s');
});

test('a head made again after the board was erased: this computer starts over with the first-sync question', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.setOnline(false);
  const uid = w.uid();
  const docs = w.mock.docs(uid);
  for (const kind of ['projects', 'notes', 'trash', 'devices']) for (const id of Object.keys(docs[kind])) w.mock.writeDoc(`users/${uid}/${kind}/${id}`, null);
  w.mock.writeDoc(`users/${uid}`, null);
  await B.syncNow();
  await w.run([B]);
  B.choose('upload'); // B puts its board back as new; the head starts again at rev 1
  B.page.addNote(ids.home, 'made after the restart, on B');
  await w.run([B]);
  assert.notEqual(cloud(w).head.createdAt, A.readState().headCreatedAt, 'a new head (its rev may well be past A\'s)');
  A.setOnline(true);
  await A.syncNow();
  await w.run([A, B]);
  assert.equal(A.choice()?.kind, 'first-merge', 'never mixes its old shadow into the new board');
  A.choose('combine');
  await w.run([A, B]);
  await B.syncNow();
  await w.run([A, B]);
  assert.deepEqual(view(A), view(B));
  assert.ok(texts(A).includes('made after the restart, on B'));
  assertShadowIsCloud(w, A);
});

// The first sign-in on a third computer with its own board, answered Combine, cut at every call.
async function firstCrashRun({ at = Infinity, phase = 'before' } = {}) {
  const { w, A } = await twoSynced({ names: ['A', 'B', 'C'] });
  const C = w.peers[2];
  await C.boot();
  const mine = realBoard(C);
  C.page.copy(mine.a, 2);
  await w.run([C]);
  await C.signIn(EMAIL, PASSWORD);
  await w.run([C]);
  assert.equal(C.choice().kind, 'first-merge');
  const calls = [];
  let hit = null;
  C.onCall = (p, label, args) => {
    if (p !== phase) return;
    calls.push(label);
    if (calls.length === at) {
      const fingerprint = label === 'syncDir.writeState' && p === 'before'
        && args?.[0]?.dataFile?.sha256 !== C.readState()?.dataFile?.sha256;
      hit = { label, fingerprint };
      C.kill();
    }
  };
  C.choose('combine');
  await w.run([A, C]);
  C.onCall = null;
  if (hit) {
    await C.boot();
    await w.run([A, C]);
    if (C.choice()?.kind === 'first-merge') { // the answer itself was lost with the crash: asked again
      C.choose('combine');
      await w.run([A, C]);
    }
  }
  await converge(w, [A, C]);
  return { w, A, C, mine, calls, hit };
}

test('a crash at every call during a first sign-in\'s Combine: the next start finishes it, losing and doubling nothing', async () => {
  const dry = await firstCrashRun();
  const n = { before: dry.calls.length, after: (await firstCrashRun({ phase: 'after' })).calls.length };
  assert.ok(n.before > 10);
  for (const phase of ['before', 'after']) {
    for (let at = 0; at <= n[phase]; at++) {
      const r = at ? await firstCrashRun({ at, phase }) : dry;
      const label = r.hit ? `crash ${phase} call ${at} (${r.hit.label})` : 'no crash';
      const { w, A, C, mine } = r;
      assert.equal(C.choice(), null, label);
      assert.deepEqual(view(C), view(A), label);
      assertShadowIsCloud(w, C);
      noDuplicateIds(C);
      for (const t of ['alpha', 'bravo', 'charlie', 'home note', 'used one', 'served one']) {
        assert.equal(C.page.notes().filter((x) => x.note.text === t).length, 2, `${label}: both boards' "${t}", once each`);
      }
      if (!r.hit?.fingerprint) assert.equal(C.page.findNote(mine.a).note.copied, 2, `${label}: copies`);
      assert.equal(C.status().phase, 'synced', label);
    }
  }
});

test('an answer given for an account that changed meanwhile is asked again, never applied to the new board', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A);
  assert.equal(A.choice().kind, 'first-upload');
  // Before the answer is acted on, another computer fills the account.
  const r = w.mock.remote(w.uid());
  r.createHead();
  const theirs = r.addProject('Theirs').id;
  const note = r.addNote(theirs, 'their note').id;
  A.choose('upload');
  await w.run();
  assert.equal(A.choice()?.kind, 'first-merge', 'asked again: the account has a board now');
  assert.equal(cloud(w).notes[note]._sync.deleted, false, 'nothing of theirs was deleted');
  A.choose('combine');
  await w.run();
  assert.ok(texts(A).includes('their note'));
  assert.ok(texts(A).includes('alpha'));
  assert.equal(Object.values(cloud(w).notes).filter((n) => n._sync.deleted).length, 0);
});

test('a delete made while a union is still pushing keeps its undo label: it goes up afterwards with no question', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.page.addNote(ids.work, 'so the union has something to bring');
  await w.run();
  A.kill();
  const data = JSON.parse(fs.readFileSync(A.dataFile, 'utf8'));
  data.projects.find((p) => p.id === ids.work).notes.find((n) => n.id === ids.a).text = 'alpha, edited by hand';
  fs.writeFileSync(A.dataFile, JSON.stringify(data)); // not as this app writes it: a union, with an edit to push
  let acked = false;
  let done = false;
  A.onCall = (phase, label, args) => {
    if (phase === 'after' && label === 'syncDir.writeState' && args?.[0]?.ack) acked = true; // the union's patch is saved
    if (phase === 'before' && label === 'firestore.get' && acked && !done) {
      done = true; // the cycle that pushes begins; first, a person deletes a project
      A.page.deleteProject(ids.home);
      A.main.flushData();
    }
  };
  await A.boot();
  await w.run();
  A.onCall = null;
  assert.ok(done);
  assert.equal(A.choice(), null, 'the label explains it');
  assert.equal(cloud(w).projects[ids.home]._sync.deleted, true);
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, edited by hand');
  assert.equal(A.readState().mode, 'normal');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// ================================================================ unions and restores end with their own merge (5.10, 5.12)

test('a union ends with its own merge: a note deleted afterwards stays deleted, even while only a copy waits to go up', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.copy(ids.a); // a copy: it goes up lazily (blur, ten minutes or quit)
  await w.run([A]);
  A.kill();
  fs.writeFileSync(A.dataFile, JSON.stringify(JSON.parse(fs.readFileSync(A.dataFile, 'utf8')))); // the same board, written by another program
  let union = false;
  A.onCall = (phase, label, args) => { if (label === 'syncDir.writeState' && args?.[0]?.mode === 'union') union = true; };
  await A.boot();
  await w.run();
  A.onCall = null;
  assert.ok(union, 'a union');
  assert.equal(A.readState().mode, 'normal', 'that ended once its merge was on disk');
  assert.equal(A.status().pending, 1, 'the copy still waits');
  A.page.deleteNote(ids.c);
  await w.run();
  assert.equal(cloud(w).notes[ids.c]._sync.deleted, true, 'the delete went up');
  B.page.editNote(ids.h, 'home from B');
  await w.run();
  await A.syncNow();
  await w.run();
  assert.equal(noteText(A, ids.h), 'home from B');
  assert.equal(noteText(A, ids.c), null, 'the next pull doesn\'t bring it back');
  assert.equal(A.page.findNote(ids.a).note.copied, 1);
  assert.equal(cloud(w).notes[ids.a].copied, 1);
});

// The person restores a backup (or the page reloads over unreadable files) while A's pull is between its
// listing and its merge: here, at the devices lookup for B's change. prepare() runs first, while in sync.
async function midPull(prepare) {
  const { w, A, B, ids } = await twoSynced();
  const ctx = { w, A, B, ids, graves: 0 };
  await prepare(ctx);
  A.setOnline(false);
  B.page.editNote(ids.h, 'home from B'); // something for A to pull, by a writer A looks up
  await w.run([B]);
  A.setOnline(true);
  ctx.graves = tombstones(w);
  let fired = false;
  A.onCall = (phase, label, args) => {
    if (phase === 'before' && !fired && label === 'firestore.queryAll' && args?.[1]?.from?.[0]?.collectionId === 'devices') {
      fired = true;
      ctx.fire();
    }
  };
  await A.syncNow();
  await w.run();
  A.onCall = null;
  assert.ok(fired, 'it happened inside the pull');
  return ctx;
}

test('a restore while a pull is merging: the merge is made again for the restored board, and nothing is deleted from the account', async () => {
  const { w, A, B, ids, graves, later } = await midPull(async (ctx) => {
    ctx.A.main.flushData();
    const backup = ctx.A.backups.create('manual');
    ctx.later = ctx.A.page.addNote(ctx.ids.work, 'made after the backup');
    await ctx.w.run();
    assert.equal(cloud(ctx.w).notes[ctx.later]._sync.deleted, false);
    ctx.fire = () => ctx.A.restoreBackup(backup);
  });
  assert.equal(noteText(A, later), 'made after the backup', 'the account\'s newer note is back here');
  assert.equal(noteText(A, ids.h), 'home from B');
  A.page.editNote(ids.b, 'bravo, after the restore');
  await w.run();
  assert.equal(cloud(w).notes[later]._sync.deleted, false, 'never deleted from the account');
  assert.equal(tombstones(w), graves);
  assert.equal(A.readState().mode, 'normal');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

test('a reload that finds both files unreadable while a pull is merging: the account\'s board replaces the seed, and nothing is deleted', async () => {
  const { w, A, B, graves } = await midPull(async (ctx) => {
    ctx.fire = () => {
      fs.writeFileSync(ctx.A.dataFile, 'garbage');
      fs.writeFileSync(`${ctx.A.dataFile}.bak`, 'more garbage');
      ctx.A.reload();
    };
  });
  assert.ok(A.page.notices.some((n) => n.code === 'RESTORED_FROM_ACCOUNT'));
  assert.equal(tombstones(w), graves, 'no tombstones');
  assert.ok(!Object.values(cloud(w).projects).some((p) => p.name === 'Welcome'), 'the seed never went up');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
  assert.equal(A.readState().mode, 'normal');
});

test('a reload after another program rewrote the file (a note taken out) while a pull is merging: the union still runs, and the note comes back', async () => {
  const { w, A, B, ids, graves } = await midPull(async (ctx) => {
    ctx.fire = () => {
      const data = JSON.parse(fs.readFileSync(ctx.A.dataFile, 'utf8'));
      const work = data.projects.find((p) => p.id === ctx.ids.work);
      work.notes = work.notes.filter((n) => n.id !== ctx.ids.c);
      fs.writeFileSync(ctx.A.dataFile, JSON.stringify(data)); // not as this app writes it: a union
      ctx.A.reload();
    };
  });
  assert.equal(noteText(A, ids.c), 'charlie', 'never deleted from a file this app didn\'t write');
  A.page.editNote(ids.b, 'bravo, after the reload');
  await w.run();
  assert.equal(cloud(w).notes[ids.c]._sync.deleted, false);
  assert.equal(tombstones(w), graves);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// ================================================================ a sign-in after the page loaded (5.10, 3.3)

for (const loadInfo of [true, false]) {
  test(`signing in after the page loaded the .bak (${loadInfo ? 'the facade says so' : 'the engine finds out'}): notes the .bak lacks stay in the account`, async () => {
    const { w, A, B, ids } = await twoSynced();
    await A.restart(); // this load copies the main file to .bak
    await w.run();
    const n1 = A.page.addNote(ids.work, 'made after the .bak, one');
    const n2 = A.page.addNote(ids.work, 'made after the .bak, two');
    await w.run();
    assert.equal(cloud(w).notes[n1].text, 'made after the .bak, one');
    assert.deepEqual(await A.signOut(), { ok: true }); // keeps the board, state.json and shadow.json
    A.kill();
    fs.writeFileSync(A.dataFile, '{ "projects": [ broken');
    await A.boot(); // signed out: the page shows the .bak and saves nothing yet
    assert.equal(A.page.findNote(n1), null, 'the .bak predates the two notes');
    assert.deepEqual(await A.signIn(EMAIL, PASSWORD, { loadInfo }), { ok: true });
    assert.equal(A.readState().mode, 'union');
    assert.equal(A.readState().stale, true);
    assert.equal(unreadableCopies(A).length, 1, 'the unreadable file is copied aside');
    await w.run();
    assert.equal(noteText(A, n1), 'made after the .bak, one', 'brought back here');
    A.page.editNote(ids.a, 'alpha, edited after signing in');
    await w.run();
    assert.equal(cloud(w).notes[n1]._sync.deleted, false);
    assert.equal(cloud(w).notes[n2]._sync.deleted, false);
    await B.syncNow();
    await w.run();
    assert.deepEqual(view(A), view(B));
  });

  test(`signing in after the page seeded over unreadable files (${loadInfo ? 'the facade says so' : 'the engine finds out'}): the account's board replaces the seed, with no question`, async () => {
    const { w, A, B } = await twoSynced();
    assert.deepEqual(await A.signOut(), { ok: true });
    A.kill();
    fs.writeFileSync(A.dataFile, '{ broken');
    fs.writeFileSync(`${A.dataFile}.bak`, '{ broken too');
    await A.boot(); // signed out: the page seeds a Welcome and saves it
    assert.equal(A.page.data.projects[0].name, 'Welcome');
    const graves = tombstones(w);
    assert.deepEqual(await A.signIn(EMAIL, PASSWORD, { loadInfo }), { ok: true });
    await w.run();
    assert.equal(A.choice(), null, 'no mass-delete question');
    assert.equal(tombstones(w), graves, 'nothing deleted in the account');
    assert.ok(!Object.values(cloud(w).projects).some((p) => p.name === 'Welcome'), 'the seed never went up');
    assert.deepEqual(view(A), view(B));
    assert.equal(A.readState().mode, 'normal');
  });
}

test('the page\'s load is told once: a later sign-in in the same page session is no union', async () => {
  const { w, A } = await twoSynced(); // A's page loaded with no file at all (a seed), signed out
  await A.signOut();
  assert.deepEqual(await A.signIn(EMAIL, PASSWORD), { ok: true });
  assert.equal(A.readState().mode, 'normal');
  await w.run();
  assert.equal(A.readState().mode, 'normal');
});

// ================================================================ answers that never came (5.5 step 13)

// A's commit of one note lands, but A doesn't learn so (each `how`); before it does, B pulls that commit and
// rewrites its only document, so none of A's own documents is left to find. The head still names the commit
// as A's last (commits.<device id>), so A counts it once: no conflict copy of its own text, no copies added
// twice. The answers: a 503, then lost()'s own head read fails too; the same with no connection; a lost answer
// that A hears of only after B is done; a crash right after the commit; a quit before the answer came.
for (const how of ['503', 'offline', 'answer after B', 'crash', 'quit']) {
  test(`a commit that landed (${how}), then B rewrote all of it before A heard: no conflict copy, copies counted once`, async () => {
    let gate = null;
    const fetchFor = (name, f) => (name !== 'A' ? f : async (url, init = {}) => {
      if (gate && String(url).endsWith(':commit')) {
        const g = gate;
        gate = null;
        await f(url, init); // applied
        await g; // its answer is on its way while B works,
        throw new TypeError('fetch failed'); // and never arrives
      }
      return f(url, init);
    });
    const { w, A, B, ids } = await twoSynced({ fetchFor });
    await A.syncNow(); // the device record is fresh, so the next commit is the board's
    await w.run();
    let committed = false;
    let release = null;
    let pause = null;
    if (how === '503' || how === 'offline') {
      const status = how === '503' ? 503 : 'offline';
      w.mock.fail({ service: 'firestore', op: 'commit', status, lost: true, times: 1 });
      A.onCall = (phase, label) => {
        if (phase !== 'after' || label !== 'firestore.commit' || committed) return;
        committed = true;
        w.mock.fail({ service: 'firestore', op: 'get', status, times: 1 }); // lost()'s own head read
      };
    } else if (how === 'answer after B') {
      gate = new Promise((resolve) => { release = resolve; });
    } else if (how === 'crash') {
      A.onCall = (phase, label) => {
        if (phase !== 'after' || label !== 'firestore.commit' || committed) return;
        committed = true;
        A.kill(); // landed; the process dies before it records so
      };
    } else {
      pause = w.mock.pauseAfter('commit'); // applied; its answer comes after the quit
    }
    A.page.copy(ids.a, 2);
    A.page.editNote(ids.a, 'alpha from A');
    if (how === 'quit') await A.quit(1500);
    else for (let i = 0; i < 40 && cloud(w).notes[ids.a].text !== 'alpha from A'; i++) await w.time.advance(50);
    A.onCall = null;
    assert.equal(cloud(w).notes[ids.a].text, 'alpha from A', 'A\'s commit landed');
    const me = A.readDevice().id;
    const rev = cloud(w).head.rev;
    const named = cloud(w).head.commits?.[me];
    if (A.alive) A.setOnline(false); // A waits; B gets in first
    await B.syncNow();
    await w.run([B]);
    assert.equal(B.page.findNote(ids.a).note.copied, 2, 'B has A\'s two copies');
    B.page.copy(ids.a, 3);
    B.page.editNote(ids.a, 'alpha from A, then B'); // every document of A's commit, rewritten
    B.blur();
    await w.run([B]);
    assert.equal(cloud(w).notes[ids.a].copied, 5);
    const kept = cloud(w).head.commits?.[me];
    release?.();
    pause?.resume();
    await flush(4);
    if (!A.alive) await A.boot();
    A.setOnline(true);
    await A.syncNow();
    await w.run();
    await B.syncNow();
    await w.run();
    assert.deepEqual(A.page.notes().filter((x) => x.note.syncConflict).map((x) => x.note.text), [], 'A pushed that text itself');
    assert.equal(noteText(A, ids.a), 'alpha from A, then B');
    assert.equal(A.page.findNote(ids.a).note.copied, 5, '2 on A + 3 on B');
    assert.equal(B.page.findNote(ids.a).note.copied, 5);
    assert.equal(cloud(w).notes[ids.a].copied, 5);
    assert.deepEqual(view(A), view(B));
    assertShadowIsCloud(w, A);
    assert.match(String(named), new RegExp(`^${rev}-`), 'the head named it as A\'s last commit');
    assert.equal(kept, named, 'and B\'s commit left that entry alone');
  });
}

// ================================================================ a reload while the acknowledging save waits (5.6 step 8)

for (const what of ['copies', 'an edit']) {
  test(`a page reload while the save acknowledging a patch (${what}) is in main's debounce: the patch counts once`, async () => {
    const { w, A, B, ids } = await twoSynced();
    if (what === 'copies') B.page.copy(ids.a, 3);
    else B.page.editNote(ids.a, 'alpha from B');
    B.blur();
    await w.run([B]);
    const before = A.page.patches.length;
    A.engine.syncNow();
    for (let i = 0; i < 2000 && A.page.patches.length === before; i++) await flush(1);
    assert.equal(A.page.patches.length, before + 1, 'A applied the patch');
    assert.ok(A.main.pendingData, 'its save is still waiting');
    A.reload(); // data:load: onPageLoading, then loadData
    await w.run();
    await A.syncNow();
    await w.run();
    await B.syncNow();
    await w.run();
    assert.equal(A.page.notes().filter((x) => x.note.syncConflict).length, 0);
    assert.equal(A.page.findNote(ids.a).note.copied, what === 'copies' ? 3 : 0);
    assert.equal(cloud(w).notes[ids.a].copied, what === 'copies' ? 3 : 0);
    assert.deepEqual(view(A), view(B));
  });
}

// ================================================================ what exists only here (5.14)

// Sign-out with "Also remove this board…": refused while anything would be lost, forced or not.
async function removeRefused(A, what) {
  const res = await A.signOut({ force: true, removeBoard: true });
  assert.equal(res.code, 'PENDING', `${what}: refused`);
  assert.ok(res.pending >= 1);
  assert.ok(fs.existsSync(A.dataFile), `${what}: the board stays`);
  assert.equal(A.account.state().status, 'signed-in', `${what}: still signed in`);
  return res;
}

test('"Also remove this board" is refused while a note exists only here (too large, or refused by the cloud), and allowed once it is in the account', async () => {
  const { w, A, ids } = await twoSynced();
  const big = A.page.addNote(ids.work, 'x'.repeat(950 * 1000));
  await w.run();
  assert.deepEqual([A.status().pending, A.engine.hasUnpushed()], [0, false], 'nothing waits to upload');
  assert.deepEqual((await removeRefused(A, 'too large')).localOnly, { projects: 0, notes: 1, pictures: 0, unreadable: 0 });
  A.page.editNote(big, 'small again');
  const undo = w.mock.denyDoc(notePath(w, ids.b));
  A.page.editNote(ids.b, 'bravo, refused');
  await w.run();
  assert.equal(A.status().quarantined, 1);
  assert.deepEqual((await removeRefused(A, 'refused')).localOnly, { projects: 0, notes: 1, pictures: 0, unreadable: 0 });
  undo();
  A.retry();
  await w.run();
  assert.deepEqual(A.engine.localOnly(), { projects: 0, notes: 0, pictures: 0, unreadable: 0 });
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: true });
  assert.equal(fs.existsSync(A.dataFile), false);
  assert.equal(cloud(w).notes[big].text, 'small again');
});

test('"Also remove this board" is refused for a picture over 32 MB, and for a board that never went up (Not now)', async () => {
  const { w, A, ids } = await twoSynced();
  A.page.addPicture(ids.a, Buffer.alloc(33 * 1024 * 1024, 7));
  await w.run();
  assert.equal(A.status().tooLargePictures, 1);
  assert.deepEqual((await removeRefused(A, 'big picture')).localOnly, { projects: 0, notes: 0, pictures: 1, unreadable: 0 });

  const w2 = world({ names: ['C'] });
  const [C] = w2.peers;
  await C.boot();
  realBoard(C);
  await w2.run();
  await C.signIn(EMAIL, PASSWORD);
  await w2.run();
  assert.equal(C.choice().kind, 'first-upload');
  C.choose('not-now');
  assert.deepEqual((await removeRefused(C, 'not uploaded')).localOnly, { projects: 2, notes: 6, pictures: 0, unreadable: 0 });
});

// ================================================================ refused pictures (4.6, 5.5 step 9)

test('a picture refused for a while (a rules deploy): the note goes up, paused with Retry meanwhile, and the picture follows once allowed', async () => {
  const { w, A, B, ids } = await twoSynced();
  const uid = w.uid();
  const image = A.page.addPicture(ids.a, pngBytes(3000, 9));
  const undo = [true, false].map((thumb) => w.mock.denyDoc(`users/${uid}/images/${image}${thumb ? '.t' : ''}.png`));
  await w.run();
  assert.equal(cloud(w).notes[ids.a].images[0].id, image, 'the note went up');
  const objects = () => Object.keys(w.mock.objects(uid)).filter((n) => n.includes(image));
  assert.deepEqual(objects(), []);
  const st = A.status();
  assert.deepEqual([st.phase, st.error?.code, st.quarantined], ['paused', 'PERMISSION', 1], 'Sync paused · the cloud refused a change, with Retry');
  assert.deepEqual(A.engine.localOnly(), { projects: 0, notes: 0, pictures: 1, unreadable: 0 });
  // Still refused: tried again on its own backoff, never blocking the rest.
  A.page.editNote(ids.b, 'bravo, meanwhile');
  await w.run();
  await w.time.advance(2000);
  await w.run();
  assert.equal(cloud(w).notes[ids.b].text, 'bravo, meanwhile');
  assert.deepEqual(objects(), []);
  for (const u of undo) u(); // the deploy is over
  await w.time.advance(20000);
  await w.run();
  assert.equal(objects().length, 2, 'both files reached the account, with no click');
  assert.equal(A.readState().uploaded[image], 3);
  assert.deepEqual([A.status().phase, A.status().quarantined], ['synced', 0]);
  await B.syncNow();
  await w.run();
  assert.equal(await B.engine.ensureImage(image, false), true, 'B can show it');
});

test('Retry sends a refused picture at once, and a refusal that passes during the wait never shows', async () => {
  const { w, A, ids } = await twoSynced();
  const uid = w.uid();
  const first = A.page.addPicture(ids.a, pngBytes(3000, 3));
  const undo = w.mock.denyDoc(`users/${uid}/images/${first}.png`);
  await w.run();
  assert.equal(A.status().quarantined, 1);
  undo();
  A.retry();
  await w.run();
  assert.equal(A.status().quarantined, 0);
  assert.ok(w.mock.objects(uid)[`users/${uid}/images/${first}.png`]);
  // A refusal that ends within the short wait: the picture goes up before its note, and nothing is held.
  const second = A.page.addPicture(ids.b, pngBytes(2000, 4));
  const undo2 = w.mock.denyDoc(`users/${uid}/images/${second}.png`);
  A.onCall = (phase, label, args) => {
    // Refused once (the upload, and the stat that finds nothing there), then allowed.
    if (phase === 'after' && label === 'storage.upload' && String(args?.[0]).endsWith(`${second}.png`)) undo2();
  };
  await w.run();
  A.onCall = null;
  assert.equal(A.status().quarantined, 0);
  assert.equal(A.readState().uploaded[second], 3);
});

test('a picture whose thumbnail can\'t be made: the picture goes up without one, and others use the picture itself', async () => {
  const { w, A, B, ids } = await twoSynced();
  const uid = w.uid();
  const image = A.page.addPicture(ids.a, pngBytes(3000, 5));
  fs.rmSync(path.join(A.dir, 'images', `${image}.t.png`)); // and no thumbnail can be made of it
  let tries = 0;
  const ensure = A.images.ensureThumb;
  A.images.ensureThumb = () => { tries++; };
  await w.run();
  assert.deepEqual(Object.keys(w.mock.objects(uid)).filter((n) => n.includes(image)), [`users/${uid}/images/${image}.png`]);
  assert.equal(A.readState().uploaded[image], 2, 'only the picture is in the account');
  for (let i = 0; i < 3; i++) {
    await A.syncNow();
    await w.run();
  }
  assert.equal(tries, 1, 'tried once this run');
  A.images.ensureThumb = ensure;
  await B.syncNow();
  await w.run();
  assert.equal(B.images.has(image, false), true, 'B fetched the picture as its thumbnail');
});

test('a draft picture over 32 MB: counted once, never read, never uploaded (only its thumbnail)', async () => {
  const { w, A, ids } = await twoSynced();
  const image = A.images.store(Buffer.alloc(33 * 1024 * 1024, 3));
  let reads = 0;
  const read = A.images.readFile;
  A.images.readFile = (id, thumb) => {
    if (id === image.id && !thumb) reads++;
    return read(id, thumb);
  };
  A.page.findProject(ids.work).draftImages = [image];
  A.page.setDraft(ids.work, 'a draft with a big picture');
  await w.time.advance(2 * 60 * 1000); // the device record is due
  await A.syncNow();
  await w.run();
  assert.equal(A.status().tooLargePictures, 1);
  A.page.editNote(ids.a, 'alpha, a push later');
  await w.run();
  await w.time.advance(2 * 60 * 1000);
  await A.syncNow();
  await w.run();
  assert.equal(A.status().tooLargePictures, 1, 'still counted: a draft shows it');
  assert.equal(reads, 0);
  assert.ok(!Object.keys(w.mock.objects(w.uid())).some((n) => n.endsWith(`${image.id}.png`) && !n.endsWith('.t.png')), 'only its thumbnail went up');
});

// ================================================================ pictures the account already holds (4.6; section 0, item 34)
// A picture never changes once uploaded: the rules refuse an upload to a name that holds one (in Storage rules
// that upload is a create with resource set, and the mock asks its twin so). One stat then counts it as sent.

const imageName = (w, id, thumb) => `users/${w.uid()}/images/${id}${thumb ? '.t' : ''}.png`;
// The Storage requests for these object names since log index `from`, as 'op status'.
const pictureOps = (w, names, from = 0) => w.mock.log.slice(from)
  .filter((e) => e.service === 'storage' && names.includes(e.name)).map((e) => `${e.op} ${e.status}`);
const timesStored = (w, name) => w.mock.log.filter((e) => e.name === name && e.tags?.includes('uploaded')).length;

test('a board copied by hand to another computer, then Combine there: its pictures are in the account already, each upload is refused and one stat counts it; the account keeps its thumbnail, and nothing is held, retried, replaced or lost', async () => {
  // The owner's go-live (8.4): the PC uploads, then the Mac, whose board was once copied from the PC, chooses
  // Combine both. The Mac's thumbnail of the shared picture came out of its own encoder: other bytes.
  const w = world({ names: ['A', 'C'] });
  const [A, C] = w.peers;
  await A.boot();
  const ids = realBoard(A);
  const image = A.page.addPicture(ids.a, pngBytes(5000, 11));
  await w.run([A]);
  await signIn(w, A, { answer: 'upload' });
  const uid = w.uid();
  const names = [imageName(w, image, true), imageName(w, image, false)];
  const stored = () => names.map((n) => [w.mock.objects(uid)[n]?.md5Hash, w.mock.objects(uid)[n]?.generation]);
  const before = stored();
  assert.ok(before.every(([hash]) => hash), 'A uploaded the picture and its thumbnail');
  fs.mkdirSync(path.join(C.dir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(A.dir, 'recaller-data.json'), path.join(C.dir, 'recaller-data.json'));
  fs.copyFileSync(path.join(A.dir, 'images', `${image}.png`), path.join(C.dir, 'images', `${image}.png`));
  const ownThumb = pngBytes(1200, 99);
  fs.writeFileSync(path.join(C.dir, 'images', `${image}.t.png`), ownThumb);
  await C.boot();
  const from = w.mock.log.length;
  await signIn(w, C, { answer: 'combine' });
  await w.run();
  await C.syncNow(); // the next full cycle (a poll or a focus) sends what the account should have from here
  await w.run();
  assert.deepEqual(pictureOps(w, [names[0]], from), ['upload 403', 'metadata 200'], 'the thumbnail: refused, then one stat');
  assert.deepEqual(pictureOps(w, [names[1]], from), ['upload 403', 'metadata 200'], 'the picture: the same');
  assert.equal(C.readState().uploaded[image], 3, 'both count as in the account');
  assert.deepEqual([C.status().phase, C.status().quarantined, C.engine.localOnly().pictures], ['synced', 0, 0]);
  assert.deepEqual(stored(), before, 'the account\'s copies stay as A uploaded them');
  assert.ok(fs.readFileSync(path.join(C.dir, 'images', `${image}.t.png`)).equals(ownThumb), 'C keeps its own thumbnail');
  assert.ok(C.lines.some((l) => l.includes('the account already holds this thumbnail with other bytes')), 'said once, in the log');
  assert.ok(!C.lines.some((l) => l.includes('this picture with other bytes') || l.includes('a picture was refused')));
  // Nothing is held or tried again.
  for (let i = 0; i < 3; i++) {
    await w.time.advance(2 * 60 * 1000);
    await C.syncNow();
    await w.run();
  }
  assert.equal(pictureOps(w, names, from).length, 4);
  await A.syncNow();
  await w.run();
  assert.deepEqual(view(C), view(A));
  assert.equal(await A.engine.ensureImage(image, true), true);
});

test('a picture whose upload landed but whose answer was lost: the next try is refused, one stat finds these bytes, and it counts as uploaded', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(6000, 12));
  const names = [imageName(w, image, true), imageName(w, image, false)];
  w.mock.fail({ service: 'storage', op: (e) => e.op === 'upload' && e.name === names[1], status: 'offline', lost: true });
  const from = w.mock.log.length;
  await w.run();
  assert.deepEqual(pictureOps(w, [names[1]], from), ['upload offline', 'upload 403', 'metadata 200']);
  assert.deepEqual(pictureOps(w, [names[0]], from), ['upload 200']);
  assert.equal(timesStored(w, names[1]), 1, 'stored once');
  assert.equal(cloud(w).notes[ids.a].images[0].id, image, 'the note went up with it');
  assert.equal(A.readState().uploaded[image], 3);
  assert.deepEqual([A.status().phase, A.status().quarantined], ['synced', 0]);
  await B.syncNow();
  await w.run();
  assert.equal(await B.engine.ensureImage(image, false), true, 'B can show it');
});

test('a large picture uploaded just before a crash, before state.json recorded it: after the restart its upload is refused at the start, no chunk goes up again, and one stat counts it', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(300 * 1024, 13)); // resumable; its thumbnail is multipart
  const names = [imageName(w, image, true), imageName(w, image, false)];
  let crashed = false;
  A.onCall = (phase, label, args) => {
    if (phase === 'after' && label === 'storage.upload' && args?.[0] === names[1]) {
      crashed = true;
      A.kill(); // the finalize landed; nothing of its answer reaches state.json
    }
  };
  await w.run();
  A.onCall = null;
  assert.equal(crashed, true);
  assert.equal(A.readState().uploaded?.[image], undefined, 'nothing recorded');
  assert.ok(names.every((n) => w.mock.objects(w.uid())[n]), 'both files are in the account');
  const from = w.mock.log.length;
  await A.boot();
  await w.run();
  assert.deepEqual(pictureOps(w, [names[0]], from), ['upload 403', 'metadata 200']);
  assert.deepEqual(pictureOps(w, [names[1]], from), ['upload-start 403', 'metadata 200'], 'refused at its start');
  for (const n of names) assert.equal(timesStored(w, n), 1, `${n}: stored once`);
  assert.equal(cloud(w).notes[ids.a].images[0].id, image, 'the note went up with it');
  assert.equal(A.readState().uploaded[image], 3);
  assert.deepEqual([A.status().phase, A.status().quarantined], ['synced', 0]);
  await B.syncNow();
  await w.run();
  assert.equal(await B.engine.ensureImage(image, false), true);
});

test('a picture forgotten once nothing showed it, then shown again (an Undo of its note\'s deletion): sent again, refused, and one stat counts it', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(4000, 14));
  await w.run();
  assert.equal(A.readState().uploaded[image], 3);
  const before = JSON.parse(JSON.stringify(A.page.findNote(ids.a).note));
  A.page.deleteNote(ids.a);
  await w.run();
  await A.syncNow();
  await w.run();
  assert.equal(A.readState().uploaded[image], undefined, 'forgotten: nothing here or in the account shows it');
  const names = [imageName(w, image, true), imageName(w, image, false)];
  const from = w.mock.log.length;
  A.page.mutate((data) => { // Undo
    data.projects.find((p) => p.id === ids.work).notes.unshift(JSON.parse(JSON.stringify(before)));
  }, { label: 'Undo' });
  await w.run();
  assert.deepEqual(pictureOps(w, names, from), ['upload 403', 'metadata 200', 'upload 403', 'metadata 200']);
  assert.equal(cloud(w).notes[ids.a]._sync.deleted, false);
  assert.equal(cloud(w).notes[ids.a].images[0].id, image);
  assert.equal(A.readState().uploaded[image], 3);
  assert.deepEqual([A.status().phase, A.status().quarantined], ['synced', 0]);
  await B.syncNow();
  await w.run();
  assert.equal(await B.engine.ensureImage(image, false), true);
});

// ================================================================ the peer on a fake clock

test('quit() settles on the fake clock while the engine waits on its own timer (the 403 wait)', async () => {
  const { w, A, ids } = await twoSynced();
  const undo = w.mock.denyDoc(notePath(w, ids.a));
  A.page.editNote(ids.a, 'refused for now');
  for (let i = 0; i < 50 && !w.mock.log.some((e) => e.op === 'commit' && e.status === 403); i++) await w.time.advance(50);
  assert.ok(w.mock.log.some((e) => e.op === 'commit' && e.status === 403), 'the engine is in its 403 wait');
  const t0 = w.time.now();
  await A.quit(1500);
  assert.ok(w.time.now() - t0 <= 1600, 'within its time');
  assert.equal(A.alive, false);
  undo();
});

// ================================================================ one engine, run after run (start, stop, accounts)

test('one engine stopped and started for another account: nothing of the first account\'s run sticks', async () => {
  const { w, A } = await twoSynced();
  await A.syncNow();
  await w.run();
  const engine = A.engine;
  assert.equal(engine.devices().length, 2);
  w.mock.writeDoc(`users/${w.uid()}`, { ...cloud(w).head, schema: 2 });
  await A.syncNow();
  await w.run();
  assert.equal(A.status().phase, 'update-needed');
  engine.stop();
  await A.account.signOut();
  assert.ok(A.readShadow(), 'the shadow stays for the same account (5.14)');
  engine.start(); // nobody is signed in: nothing is touched
  await w.run();
  assert.ok(A.readShadow(), 'still there');
  assert.equal(A.readState().mode, 'normal');
  w.mock.createUser({ email: 'second@example.com', password: PASSWORD, verified: true });
  assert.deepEqual(await A.account.signIn('second@example.com', PASSWORD), { ok: true });
  engine.start();
  engine.onPageReady({ session: A.page.session });
  await w.run();
  assert.notEqual(engine.status().phase, 'update-needed', 'account 2 isn\'t on schema 2');
  assert.equal(engine.choice()?.kind, 'first-upload');
  assert.deepEqual(engine.devices().filter((d) => !d.current), [], 'no computer of account 1 is shown for account 2');
});

// ================================================================ questions block only what they decide (5.5 step 4, 5.15)

test('while the mass-delete question is open, the other computer\'s changes still arrive; bringing the notes back ends the question', async () => {
  const { w, A, B, ids } = await twoSynced();
  for (let i = 0; i < 4; i++) A.page.addNote(ids.home, `extra ${i}`);
  await w.run();
  await B.syncNow();
  await w.run();
  const before = A.page.data.projects.find((p) => p.id === ids.home).notes.map((n) => ({ ...n }));
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.home).notes = []; });
  await w.run();
  assert.equal(A.choice().kind, 'mass-delete');
  B.page.editNote(ids.a, 'alpha, edited on B while A is asked');
  const added = B.page.addNote(ids.work, 'new on B while A is asked');
  await w.run();
  await A.syncNow();
  await w.run();
  assert.equal(noteText(A, ids.a), 'alpha, edited on B while A is asked');
  assert.equal(noteText(A, added), 'new on B while A is asked');
  assert.equal(A.choice().kind, 'mass-delete', 'still asked');
  assert.equal(Object.values(cloud(w).notes).filter((n) => n._sync.deleted).length, 0, 'nothing deleted');
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.home).notes = before; }, { label: 'Undo' });
  await w.run();
  assert.equal(A.choice(), null, 'nothing left to ask about');
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

test('a computer that looks between the head\'s delete and the account\'s: it still learns the account was deleted', async () => {
  const { w, A, B } = await twoSynced();
  const pause = w.mock.pauseAfter('head-delete');
  const done = A.deleteAccount(PASSWORD);
  await pause.hit;
  await B.syncNow(); // B's poll lands in the window: the board is gone, the account not yet
  await w.run([B]);
  assert.deepEqual(B.choice(), { kind: 'account-gone' });
  pause.resume();
  assert.deepEqual(await done, { ok: true });
  B.focus();
  await B.syncNow();
  await w.run([B]);
  assert.equal(B.account.state().status, 'deleted');
});

test('a cloud board that comes back while this computer is asked about it: the question goes, and the first sync begins', async () => {
  const { w, A, B, ids } = await twoSynced();
  const uid = w.uid();
  const docs = w.mock.docs(uid);
  for (const kind of ['projects', 'notes', 'trash', 'devices']) for (const id of Object.keys(docs[kind])) w.mock.writeDoc(`users/${uid}/${kind}/${id}`, null);
  w.mock.writeDoc(`users/${uid}`, null);
  await A.syncNow();
  await B.syncNow();
  await w.run();
  assert.equal(A.choice()?.kind, 'account-gone');
  assert.equal(B.choice()?.kind, 'account-gone');
  B.choose('upload');
  await w.run([B]);
  await A.syncNow();
  await w.run();
  assert.equal(A.choice()?.kind, 'first-merge', 'a board again: the first sync\'s question');
  A.choose('combine');
  await w.run();
  assert.ok(noteText(A, ids.a));
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// ================================================================ "Use my account's board" only for the board it was decided for (5.9, 6.3)

async function thirdWithBoard(opts) {
  const { w, A } = await twoSynced({ names: ['A', 'B', 'C'], ...opts });
  const C = w.peers[2];
  await C.boot();
  const mine = realBoard(C);
  await w.run();
  await C.signIn(EMAIL, PASSWORD);
  await w.run();
  assert.equal(C.choice().kind, 'first-merge');
  return { w, A, C, mine };
}

const inBackup = (peer, text) => peer.backups.made.some((b) => JSON.stringify(peer.backups.readData(b.id)).includes(text));

test('Use my account\'s board answered offline, then a note written before the merge: the note is in a before-sync backup', async () => {
  const { w, C, mine } = await thirdWithBoard();
  C.setOnline(false);
  assert.deepEqual(C.choose('use-account'), { ok: true });
  await w.run([C]);
  C.page.addNote(mine.work, 'written after the answer');
  await w.time.advance(60 * 60 * 1000);
  C.setOnline(true);
  await C.syncNow();
  await w.run();
  assert.equal(C.choice(), null);
  assert.ok(C.page.notices.some((n) => n.code === 'USED_ACCOUNT'));
  assert.ok(inBackup(C, 'written after the answer'), 'backed up right before the board was replaced');
  assert.deepEqual(C.backups.made.map((b) => b.kind), ['before-sync', 'before-sync']);
});

test('Use my account\'s board when no backup can be made: refused, and this board stays', async () => {
  const { w, C } = await thirdWithBoard();
  C.onCall = (phase, label) => {
    if (phase === 'before' && label === 'backups.create') throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
  };
  assert.deepEqual(C.choose('use-account'), { ok: false, code: 'UNAVAILABLE' });
  await w.run();
  C.onCall = null;
  assert.equal(C.choice()?.kind, 'first-merge', 'still asked');
  assert.ok(texts(C).includes('alpha') && C.page.data.projects.length === 2, 'nothing replaced');
  assert.deepEqual(C.choose('combine'), { ok: true }, 'Combine deletes nothing here, so it goes ahead');
  await w.run();
  assert.equal(C.choice(), null);
});

test('a fresh computer\'s first sync, with a note written while its patch waits: asked, never thrown away', async () => {
  const w = world();
  const [A, B] = w.peers;
  await A.boot();
  realBoard(A);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  await B.boot();
  const welcome = B.page.data.projects[0].id;
  B.page.openEditor(B.page.data.projects[0].notes[0].id); // reading a tip in the editor
  await B.signIn(EMAIL, PASSWORD); // a pristine Welcome: the account's board, with no question
  for (let i = 0; i < 2000 && !B.engine.debug().inFlight; i++) await flush(1);
  await w.time.advance(5000);
  assert.equal(B.status().phase, 'waiting');
  B.page.addNote(welcome, 'my first note on this Mac');
  B.page.closeEditor(null);
  await w.run();
  assert.ok(texts(B).includes('my first note on this Mac'), 'kept');
  assert.equal(B.choice()?.kind, 'first-merge', 'no longer a blank board: asked');
  B.choose('combine');
  await w.run();
  assert.ok(texts(B).includes('my first note on this Mac'));
  assert.ok(texts(B).includes('alpha'));
});

// ================================================================ a slow link, a page that keeps refusing

test('a link too slow for big commits: the push goes in smaller commits until they get through', async () => {
  let dropped = 0;
  const spy = (f) => async (url, init = {}) => {
    if (String(url).endsWith(':commit') && Buffer.byteLength(String(init.body || '')) > 1024 * 1024) {
      dropped++;
      throw new TypeError('fetch failed'); // never reached the server
    }
    return f(url, init);
  };
  const w = world({ names: ['A'], fetchSpy: spy });
  const [A] = w.peers;
  await A.boot();
  const p = A.page;
  p.deleteProject(p.data.projects[0].id);
  const pid = p.addProject('Big notes');
  for (let i = 0; i < 300; i++) p.addNote(pid, `${i} `.padEnd(6000, 'x'));
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  assert.ok(dropped >= 1);
  assert.equal(Object.keys(cloud(w).notes).length, 300, 'everything went up');
  assert.equal(A.status().phase, 'synced');
  assert.ok(A.engine.debug().commitBudget < 8 * 1024 * 1024);
});

test('a page that keeps refusing patches as stale with nothing newer saved: the engine backs off, and the page\'s next save sets it right', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.page.editNote(ids.a, 'alpha from B');
  await w.run([B]);
  A.engine.onPageReady({ session: 's-an-older-page-load' }); // a replayed sync:ready
  const n0 = A.page.nacks.length;
  for (let i = 0; i < 60; i++) await flush(1); // the clock stands still
  assert.ok(A.page.nacks.length - n0 <= 4, `${A.page.nacks.length - n0} round trips`);
  assert.equal(A.status().phase, 'paused', 'backing off');
  A.page.editNote(ids.b, 'bravo, saved by the page that is there');
  await w.run();
  assert.equal(noteText(A, ids.a), 'alpha from B', 'the patch reached the page');
  assert.equal(A.status().phase, 'synced');
});

// ================================================================ production timings (D13, 5.2)

test('production timings: head reads per idle hour (focused 60, visible 12, hidden 2), few state.json writes, devices read with a projection, a blur with nothing to push costs nothing', async () => {
  const bodies = [];
  const spy = (f) => async (url, init = {}) => {
    if (String(url).endsWith(':runQuery')) bodies.push(JSON.parse(init.body));
    return f(url, init);
  };
  const { w, A, B, ids } = await twoSynced({ fast: false, fetchSpy: spy });
  await A.syncNow();
  await w.run();
  B.kill(); // only A talks to the mock from here
  const tally = (from) => {
    const out = {};
    for (const e of w.mock.log.slice(from)) out[`${e.service}:${e.op}`] = (out[`${e.service}:${e.op}`] || 0) + 1;
    return out;
  };
  for (const [win, heads] of [[{ focused: true, visible: true }, 60], [{ focused: false, visible: true }, 12], [{ focused: false, visible: false }, 2]]) {
    A.setWindow({ minimized: false, ...win });
    await w.run([A]);
    const from = w.mock.log.length;
    let states = 0;
    A.onCall = (phase, label) => { if (phase === 'before' && label === 'syncDir.writeState') states++; };
    await w.time.advance(60 * 60 * 1000);
    A.onCall = null;
    const t = tally(from);
    assert.ok(Math.abs((t['firestore:get'] || 0) - heads) <= 1, `${JSON.stringify(win)}: ${t['firestore:get']} head reads`);
    assert.ok((t['token:token'] || 0) <= 1, 'one token refresh an hour');
    assert.ok(states <= 6, `${states} state.json writes`);
  }
  const devices = bodies.filter((b) => b.structuredQuery.from[0].collectionId === 'devices');
  assert.ok(devices.length > 0 && devices.every((b) => b.structuredQuery.select), 'only name, platform and lastSeenAt');
  A.focus();
  await w.run([A]);
  await w.time.advance(30000);
  const from = w.mock.log.length;
  A.blur();
  await w.run([A]);
  assert.deepEqual(tally(from), {}, 'a blur with nothing to push');
  A.focus();
  await w.run([A]);
  A.page.copy(ids.a);
  A.blur(); // the copy's save is still in main's debounce
  await w.run([A]);
  assert.equal(cloud(w).notes[ids.a].copied, 1, 'copies still go up on blur');
});

test('production timings: failures back off 5 s, 15 s, 1 min, 5 min, then every 15 min (±20 %)', async () => {
  const w = world({ names: ['A'], fast: false });
  const [A] = w.peers;
  await A.boot();
  const ids = realBoard(A);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  A.blur();
  await w.run();
  w.mock.fail({ service: 'firestore', op: 'commit', status: 503, times: 100 });
  A.page.editNote(ids.a, 'refused for a while');
  const at = [];
  A.onCall = (phase, label) => { if (phase === 'before' && label === 'firestore.commit') at.push(w.time.now()); };
  await w.time.advance(60 * 60 * 1000);
  A.onCall = null;
  w.mock.fail(null);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  const ladder = [5000, 15000, 60000, 300000, 900000, 900000];
  assert.ok(gaps.length >= ladder.length, `${gaps.length} retries`);
  ladder.forEach((ms, i) => assert.ok(gaps[i] >= ms * 0.8 && gaps[i] <= ms * 1.2 + 100, `retry ${i + 1}: ${gaps[i]} ms, expected about ${ms}`));
  assert.deepEqual([A.status().phase, A.status().error.code], ['paused', 'SERVER']);
});

test('production timings: a focus right after a failure retries at once', async () => {
  const { w, A, B, ids } = await twoSynced({ fast: false });
  B.kill();
  A.blur();
  await w.run([A]);
  w.mock.fail({ service: 'firestore', op: 'commit', status: 503, times: 1 });
  A.page.editNote(ids.a, 'after one 503');
  await w.time.advance(2600); // the debounce, the head read, the 503
  assert.equal(A.status().error?.code, 'SERVER');
  const t0 = w.time.now();
  A.focus();
  for (let s = 0; s < 30 && cloud(w).notes[ids.a].text !== 'after one 503'; s++) await w.time.advance(500);
  assert.equal(cloud(w).notes[ids.a].text, 'after one 503');
  assert.ok(w.time.now() - t0 <= 2000, `${w.time.now() - t0} ms after the focus`);
});

test('production timings: a first sync that finds the account being deleted reads the head on polls, with no forced refresh each time', async () => {
  const { w } = await twoSynced({ names: ['A', 'B', 'C'], fast: false });
  w.mock.writeDoc(`users/${w.uid()}`, { ...cloud(w).head, deleting: true });
  const C = w.peers[2];
  w.peers[0].kill();
  w.peers[1].kill();
  await C.boot();
  realBoard(C);
  await w.run([C]);
  await C.signIn(EMAIL, PASSWORD);
  await w.run([C]);
  assert.equal(C.status().phase, 'deleting-elsewhere');
  const from = w.mock.log.length;
  for (let i = 0; i < 6; i++) C.page.editNote(C.page.notes()[0].note.id, `edited while deleting ${i}`); // saves cost nothing
  await w.time.advance(60 * 60 * 1000);
  const refreshes = w.mock.log.slice(from).filter((e) => e.service === 'token').length;
  const heads = w.mock.log.slice(from).filter((e) => e.op === 'get').length;
  assert.ok(refreshes <= 2, `${refreshes} forced refreshes in an hour`);
  assert.ok(heads <= 61, `${heads} head reads in an hour`);
});

// ================================================================ nothing goes out while offline (5.2, 5.13)

test('offline: the final push sends nothing (no device record either), and an unverified account makes no lookups', async () => {
  const { w, A, ids } = await twoSynced();
  A.setOnline(false);
  A.page.setDraft(ids.home, 'a draft, so the device record has changed');
  A.page.editNote(ids.a, 'made offline');
  await w.run([A]);
  const from = w.mock.log.length;
  await A.quit(1500);
  assert.deepEqual(w.mock.log.slice(from), [], 'no request at quit');

  const w2 = world({ names: ['C'], user: false });
  const [C] = w2.peers;
  await C.boot();
  assert.deepEqual(await C.signUp('new@example.com', PASSWORD), { ok: true });
  await w2.time.advance(1000);
  assert.ok(w2.mock.log.some((e) => e.op === 'lookup'), 'it looks while online');
  C.setOnline(false);
  await w2.time.advance(1000);
  const before = w2.mock.log.length;
  C.focus();
  await w2.time.advance(5000);
  assert.equal(w2.mock.log.slice(before).filter((e) => e.op === 'lookup').length, 0, 'no lookups while offline');
});

// ================================================================ costs of an incoming patch (5.6, 5.18)

test('an incoming patch writes shadow.json once', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  A.setOnline(false); // A's own polls wait: one patch brings both changes
  B.page.editNote(ids.a, 'alpha from B');
  B.page.copy(ids.b, 2);
  B.blur();
  await w.run([B]);
  A.setOnline(true);
  let shadows = 0;
  A.onCall = (phase, label) => { if (phase === 'before' && label === 'syncDir.writeShadow') shadows++; };
  const before = A.page.patches.length;
  await A.syncNow();
  await w.run();
  A.onCall = null;
  const real = A.page.patches.slice(before).filter((p) => p.changesContent || Object.keys(p.notes.counters).length);
  assert.equal(real.length, 1, 'one patch (after the empty probe of a mid-session sign-in)');
  assert.equal(shadows, 1);
  assertShadowIsCloud(w, A);
});

// ================================================================ hardening round 1 (the second review's regressions)

// A restore as main.js does it: the engine is told and the file written at once, and the page loads it 50 ms
// later. A cycle already past its first look (here, at its head read) merged the board before the restore and,
// with nothing to patch, ended the restore at once; the restored board then merged as a union, which removes
// again a note the backup brings back and the account deleted (5.7: a restore keeps it, and undeletes it).
test('a restore while a head read is on its way (main reloads 50 ms later): merged as a restore once the restored board loads, never as a union', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  A.main.flushData();
  const backup = A.backups.create('manual'); // holds "charlie"
  A.page.deleteNote(ids.c); // a person's delete, with its label
  await w.run();
  assert.equal(cloud(w).notes[ids.c]._sync.deleted, true, 'the delete went up');
  let restored = false;
  A.onCall = (phase, label) => {
    if (phase !== 'before' || label !== 'firestore.get' || restored) return;
    restored = true;
    A.restoreBackup(backup); // the file is written now; the page loads it 50 ms later
  };
  await A.syncNow();
  A.onCall = null;
  assert.ok(restored, 'the restore came while the head read was on its way');
  await w.run();
  await A.syncNow();
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(noteText(A, ids.c), 'charlie', 'the backup\'s note is back here');
  assert.equal(cloud(w).notes[ids.c]._sync.deleted, false, 'and undeleted in the account');
  assert.equal(noteText(B, ids.c), 'charlie');
  assert.equal(A.readState().mode, 'normal');
  assert.deepEqual(view(A), view(B));
});

// 5.5 step 4: the question is about the deletions no label explained when it was asked. Syncing goes on while
// it is open, and a delete the person makes meanwhile (with its label) used to answer it for all of them.
test('an open mass-delete question stands for the deletions it asked about: a delete made since, or a restart, never answers it', async () => {
  const { w, A, B, ids } = await twoSynced();
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push(A.page.addNote(ids.home, `extra ${i}`));
  await w.run();
  await B.syncNow();
  await w.run();
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.home).notes = []; }); // five gone, no label
  await w.run();
  assert.deepEqual(A.choice(), { kind: 'mass-delete', count: 5 });
  A.page.deleteNote(ids.c); // the person goes on working: one delete of their own
  await w.run();
  const gone = () => [ids.h, ...extra, ids.c].filter((id) => cloud(w).notes[id]._sync.deleted);
  assert.deepEqual(gone(), [], 'nothing went up: the push is held as a whole');
  assert.deepEqual(A.choice(), { kind: 'mass-delete', count: 6 }, 'still asked');
  await A.restart();
  await w.run();
  assert.deepEqual(gone(), [], 'nor after a restart');
  assert.equal(A.choice()?.kind, 'mass-delete');
  assert.deepEqual(A.choose('delete-everywhere'), { ok: true }); // the answer decides, for all of them
  await w.run();
  assert.equal(A.choice(), null);
  assert.equal(gone().length, 6);
  await B.syncNow();
  await w.run();
  assert.deepEqual(view(A), view(B));
});

// PS1 looked only at removals: a note both boards share takes the account's text with no copy (5.7), so an
// edit made after the answer must be in a backup too.
test('Use my account\'s board answered offline, then an edit to a note both boards share: the replaced text is in a before-sync backup', async () => {
  const { w, A, ids } = await twoSynced({ names: ['A', 'B', 'C'] });
  const C = w.peers[2];
  A.main.flushData();
  fs.mkdirSync(C.dir, { recursive: true });
  fs.copyFileSync(A.dataFile, C.dataFile); // the board came over as a copied data file, not by sync
  await C.boot();
  C.page.editNote(ids.a, 'alpha, first edit on C');
  await w.run([C]);
  await C.signIn(EMAIL, PASSWORD);
  await w.run([C]);
  assert.equal(C.choice()?.kind, 'first-merge');
  C.setOnline(false);
  assert.deepEqual(C.choose('use-account'), { ok: true });
  await w.run([C]);
  C.page.editNote(ids.a, 'alpha, written on C after the answer');
  await w.run([C]);
  C.setOnline(true);
  await C.syncNow();
  await w.run();
  assert.equal(C.choice(), null);
  assert.equal(noteText(C, ids.a), 'alpha', 'the account\'s board is used');
  assert.ok(inBackup(C, 'alpha, written on C after the answer'), 'the text it replaced is in a before-sync backup');
});

test('the account deleted elsewhere, or its head missing while that can\'t be checked: localOnly() is the whole board, and the board stays', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.setOnline(false); // B's engine stops pulling (its account calls still work)
  const only = A.page.addNote(ids.work, 'written on A, never seen by B');
  await w.run([A]);
  assert.equal(cloud(w).notes[only].text, 'written on A, never seen by B');
  assert.deepEqual(await B.deleteAccount(PASSWORD), { ok: true });
  await A.syncNow();
  await w.run([A]);
  assert.equal(A.account.state().status, 'deleted');
  assert.equal(A.engine.hasUnpushed(), false);
  assert.deepEqual(A.engine.localOnly(), { projects: 2, notes: 7, pictures: 0, unreadable: 0 }, 'the account holds none of it');
  const res = await A.signOut({ removeBoard: true });
  assert.equal(res.ok, false, 'refused');
  assert.ok(fs.existsSync(A.dataFile), 'the board stays');
  assert.equal(noteText(A, only), 'written on A, never seen by B');

  const two = await twoSynced();
  two.B.kill();
  two.w.mock.writeDoc(`users/${two.w.uid()}`, null); // the cloud board is gone...
  two.w.mock.fail({ service: 'token', status: 'offline', times: 1000 }); // ...and the forced refresh can't say why
  two.A.engine.syncNow();
  await two.w.time.advance(3000);
  assert.equal(two.A.choice(), null, 'not known yet');
  assert.deepEqual(two.A.engine.localOnly(), { projects: 2, notes: 6, pictures: 0, unreadable: 0 });
  two.w.mock.fail(null);
  await two.A.syncNow();
  await two.w.run([two.A]);
  assert.deepEqual(two.A.choice(), { kind: 'account-gone' }, 'then it is known');
  assert.deepEqual(two.A.engine.localOnly(), { projects: 2, notes: 6, pictures: 0, unreadable: 0 });
});

// A head read per cycle: count them while the clock runs (at most `ms` of it, or `steps` timers).
async function headReads(w, { ms = 60000, steps = 3000 } = {}) {
  const from = w.mock.log.length;
  const t0 = w.time.now();
  for (let n = 0; n < steps && w.time.now() - t0 < ms; n++) if (!(await w.time.step())) break;
  return { gets: w.mock.log.slice(from).filter((e) => e.service === 'firestore' && e.op === 'get').length, elapsed: w.time.now() - t0 };
}

for (const fast of [true, false]) {
  test(`a picture over 32 MB whose thumbnail was refused for a while: once that goes up nothing is held, and no head read beyond the polls (${fast ? 'fast' : 'production'} timings)`, async () => {
    const { w, A, B, ids } = await twoSynced({ fast });
    B.kill(); // only A talks to the mock
    await A.syncNow();
    await w.run([A]);
    const image = A.page.addPicture(ids.a, Buffer.alloc(33 * 1024 * 1024, 7));
    const undo = w.mock.denyDoc(`users/${w.uid()}/images/${image}.t.png`); // a rules deploy, longer than the waits
    await w.run([A]);
    assert.equal(cloud(w).notes[ids.a].images[0].id, image, 'the note went up without its picture');
    assert.ok(A.readState().quarantine[`picture:${image}`], 'held for a retry');
    undo();
    const { gets, elapsed } = await headReads(w);
    assert.ok(gets <= Math.ceil(elapsed / (fast ? 1000 : 60000)) + 4, `${gets} head reads in ${elapsed} ms`);
    assert.equal(A.readState().quarantine[`picture:${image}`], undefined, 'nothing left to try');
    assert.ok(w.mock.objects(w.uid())[`users/${w.uid()}/images/${image}.t.png`], 'its thumbnail went up');
    assert.deepEqual([A.status().tooLargePictures, A.status().phase], [1, 'paused'], 'the picture itself stays here');
  });
}

test('a held picture whose file is gone, or one left held in state.json: dropped, and no head read beyond the polls, after a restart too', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.kill();
  await A.syncNow();
  await w.run([A]);
  const image = A.page.addPicture(ids.a, pngBytes(5000, 3));
  w.mock.denyDoc(`users/${w.uid()}/images/${image}.t.png`); // refused, and it stays refused
  await w.run([A]);
  assert.ok(A.readState().quarantine[`picture:${image}`], 'held for a retry');
  for (const n of [`${image}.png`, `${image}.t.png`]) fs.rmSync(path.join(A.dir, 'images', n), { force: true });
  let r = await headReads(w);
  assert.ok(r.gets <= Math.ceil(r.elapsed / 1000) + 4, `${r.gets} head reads in ${r.elapsed} ms`);
  assert.equal(A.readState().quarantine[`picture:${image}`], undefined);

  // A hold an earlier run left for a picture over 32 MB, due long ago: the next start drops it.
  const big = A.page.addPicture(ids.b, Buffer.alloc(33 * 1024 * 1024, 5));
  await w.run([A]);
  A.kill();
  const file = path.join(A.dir, 'sync', 'state.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(st.skippedPictures[big], 'TOO_LARGE');
  st.quarantine[`picture:${big}`] = { code: 'PERMISSION', sig: '', at: 0, tries: 1, next: 1 };
  fs.writeFileSync(file, JSON.stringify(st));
  await A.boot();
  r = await headReads(w);
  assert.ok(r.gets <= Math.ceil(r.elapsed / 1000) + 4, `after the restart: ${r.gets} head reads in ${r.elapsed} ms`);
  assert.equal(A.readState().quarantine[`picture:${big}`], undefined);
});

// "Also remove this board" (5.14): a download answered after the sign-out writes nothing into images/.
test('a thumbnail prefetch in flight at "Also remove this board" writes nothing once its answer comes', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
  await w.run();
  const pause = w.mock.pauseAfter('download'); // B's prefetch after the patch: the answer is held
  let hit = false;
  pause.hit.then(() => { hit = true; });
  B.engine.syncNow();
  for (let i = 0; i < 5000 && !hit; i++) {
    await flush(2);
    if (!hit) await w.time.step();
  }
  assert.ok(hit, 'the prefetch began');
  assert.deepEqual(await B.signOut({ removeBoard: true }), { ok: true });
  pause.resume();
  for (let i = 0; i < 50; i++) await flush(2);
  const folder = path.join(B.dir, 'images');
  assert.deepEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], [], 'no picture of the account is back');
  assert.ok(image);
});

test('a picture the page asked for (ensureImage) and answered after "Also remove this board" is never written', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.a, pngBytes(5000, 11));
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(B.images.has(image, false), false, 'the full picture waits until asked for');
  const pause = w.mock.pauseAfter('download');
  const asked = B.engine.ensureImage(image, false);
  await pause.hit;
  assert.deepEqual(await B.signOut({ removeBoard: true }), { ok: true });
  pause.resume();
  assert.equal(await asked, false);
  for (let i = 0; i < 50; i++) await flush(2);
  const folder = path.join(B.dir, 'images');
  assert.deepEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], []);
});

// The copies may hold notes nothing else has (a note written offline into a file that then couldn't be read):
// the removal asks for them by name first, and takes them only once the person agreed (removeUnreadable).
test('"Also remove this board": unreadable copies are named first (PENDING, localOnly.unreadable), and go only once agreed', async () => {
  const { w, B } = await twoSynced();
  const text = fs.readFileSync(B.dataFile, 'utf8');
  fs.writeFileSync(B.dataFile, text.slice(0, Math.floor(text.length * 0.8))); // cut short, still mostly the board
  B.reload();
  await w.run();
  assert.equal(unreadableCopies(B).length, 1, 'the unreadable file was copied aside');
  assert.ok(fs.readFileSync(path.join(B.dir, unreadableCopies(B)[0]), 'utf8').includes('alpha'), 'and it holds the notes');
  const only = { projects: 0, notes: 0, pictures: 0, unreadable: 1 };
  assert.deepEqual(B.engine.localOnly(), only);
  assert.deepEqual(await B.signOut({ removeBoard: true }), { ok: false, code: 'PENDING', pending: 0, localOnly: only });
  assert.equal(unreadableCopies(B).length, 1, 'kept: nobody agreed to remove it');
  assert.equal(B.account.state().status, 'signed-in');
  assert.deepEqual(await B.signOut({ removeBoard: true, removeUnreadable: true }), { ok: true });
  assert.deepEqual(unreadableCopies(B), [], 'no copy of the board is left on this computer');
});

test('one small commit lost on a link that answers: a quiet retry (pending), and only a link that keeps losing them shows it', async () => {
  let drop = 0;
  const fetchFor = (name, f) => (name !== 'A' ? f : async (url, init = {}) => {
    if (drop > 0 && String(url).endsWith(':commit')) {
      drop--;
      throw new TypeError('fetch failed'); // never reached the server
    }
    return f(url, init);
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor });
  B.kill();
  await A.syncNow();
  await w.run([A]);
  const phases = async (n) => {
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const s = A.status();
      seen.add(s.phase === 'paused' ? `paused:${s.error?.code}` : s.phase);
      await w.time.advance(50);
    }
    return [...seen];
  };
  drop = 1;
  A.page.editNote(ids.a, 'one small edit');
  for (let i = 0; i < 60 && drop > 0; i++) await w.time.advance(50);
  const seen = await phases(8);
  await w.run([A]);
  assert.equal(cloud(w).notes[ids.a].text, 'one small edit', 'it goes up on the retry');
  assert.ok(!seen.some((p) => p.startsWith('paused') || p === 'offline'), `phases after the drop: ${seen.join(', ')}`);
  drop = 3;
  A.page.editNote(ids.b, 'three lost in a row');
  for (let i = 0; i < 200 && drop > 0; i++) await w.time.advance(50);
  assert.deepEqual([A.status().phase, A.status().error?.code], ['paused', 'UNKNOWN']);
  await w.run([A]);
  assert.equal(cloud(w).notes[ids.b].text, 'three lost in a row');
  assert.equal(A.status().phase, 'synced');
});

// state.json is written after every save: what is held back goes there as a hash, never as the note.
test('a note over 900 KB, and a large one the cloud refused: state.json keeps hashes, and both are still held exactly as before', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.kill();
  A.page.addNote(ids.work, 'x'.repeat(2 * 1000 * 1000)); // a pasted 2 MB log
  const undo = w.mock.denyDoc(notePath(w, ids.b));
  A.page.editNote(ids.b, 'y'.repeat(800 * 1000));
  await w.run([A]);
  assert.deepEqual([A.status().tooLarge, A.status().quarantined], [1, 2]);
  const size = () => fs.statSync(path.join(A.dir, 'sync', 'state.json')).size;
  for (let i = 0; i < 3; i++) {
    A.page.toggleView(ids.home); // view-only saves rewrite state.json
    await w.time.advance(400);
  }
  assert.ok(size() < 20 * 1024, `state.json is ${size()} bytes`);
  const refusals = () => w.mock.log.filter((e) => e.op === 'commit' && e.status === 403).length;
  const before = refusals();
  A.page.editNote(ids.a, 'alpha, another push');
  await w.run([A]);
  assert.equal(refusals(), before, 'the refused note is held while it is unchanged');
  await A.restart();
  await w.run([A]);
  assert.equal(refusals(), before, 'after a restart too');
  undo();
  A.page.editNote(ids.b, 'bravo, small again');
  await w.run([A]);
  assert.equal(cloud(w).notes[ids.b].text, 'bravo, small again', 'changed: tried again');
  assert.deepEqual([A.status().tooLarge, A.status().quarantined], [1, 1]);
});

for (const status of [503, 'offline']) {
  test(`after one ${status === 503 ? '503' : 'dropped connection'}, a retry that works and waits for the open editor shows "waiting"`, async () => {
    const { w, A, B, ids } = await twoSynced();
    B.page.editNote(ids.b, 'bravo from B');
    B.blur();
    await w.run([B]);
    A.page.openEditor(ids.a); // the page holds content patches back
    w.mock.fail({ service: 'firestore', op: 'get', status, times: 1 });
    A.engine.syncNow(); // the head read fails once, then the backoff's retry works
    for (let i = 0; i < 100 && !A.engine.debug().inFlight; i++) await w.time.advance(100);
    assert.ok(A.engine.debug().inFlight, 'the retry pulled B\'s change and sent it');
    await w.time.advance(3000);
    const s = A.status();
    assert.equal(s.phase, 'waiting', `${s.phase} ${JSON.stringify(s.error ?? null)}`);
    A.page.closeEditor(null);
    await w.run();
    assert.equal(noteText(A, ids.b), 'bravo from B');
    assert.equal(A.status().phase, 'synced');
  });
}

// ================================================================ hardening, round 2

const MIN = 60 * 1000;

// A commit that landed but whose answer never came, settled after a restart: state.json keeps only hashes of its
// fields, and here the note no longer matches them (an Undo, a .bak). Its document is read rather than the
// shadow's old fields taken for what the commit wrote.
async function undoneWhileOnItsWay(w, A, ids) {
  await A.syncNow();
  await w.run();
  const before = JSON.parse(JSON.stringify(A.page.findNote(ids.a).note)); // what the Undo snapshot holds
  const pause = w.mock.pauseAfter('commit'); // applied; its answer is held
  A.page.editNote(ids.a, 'alpha v1, then undone');
  for (let i = 0; i < 40 && cloud(w).notes[ids.a].text !== 'alpha v1, then undone'; i++) await w.time.advance(50);
  assert.equal(cloud(w).notes[ids.a].text, 'alpha v1, then undone', 'the commit landed; its answer waits');
  A.page.mutate((data) => { // Undo
    const work = data.projects.find((p) => p.id === ids.work);
    work.notes[work.notes.findIndex((n) => n.id === ids.a)] = JSON.parse(JSON.stringify(before));
  }, { label: 'Undo' });
  await A.quit(1500);
  assert.ok(A.readState().outgoing, 'state.json names the commit as outgoing');
  return pause;
}

test('an Undo saved while its commit\'s answer is on its way, then a quit: after the restart the Undo goes up', async () => {
  const { w, A, B, ids } = await twoSynced();
  const pause = await undoneWhileOnItsWay(w, A, ids);
  pause.resume();
  await A.boot();
  await w.run();
  await converge(w, [A, B]);
  assert.equal(noteText(A, ids.a), 'alpha');
  assert.equal(cloud(w).notes[ids.a].text, 'alpha', 'the account has the Undo');
  assert.equal(noteText(B, ids.a), 'alpha', 'and so has B');
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

test('the same, while B copies and moves that note before A is back: the Undo stays, B\'s move and copies arrive', async () => {
  const { w, A, B, ids } = await twoSynced();
  const pause = await undoneWhileOnItsWay(w, A, ids);
  pause.resume();
  await B.syncNow();
  await w.run([B]);
  assert.equal(noteText(B, ids.a), 'alpha v1, then undone');
  B.page.copy(ids.a, 2);
  B.page.moveNote(ids.a, { list: 'used' }); // its text stays the one A pushed
  await w.run([B]);
  await A.boot();
  await w.run();
  await converge(w, [A, B]);
  assert.equal(A.page.findNote(ids.a).list, 'used', 'B\'s move arrives');
  assert.equal(noteText(A, ids.a), 'alpha', 'the Undo is the only text change since A\'s commit');
  assert.deepEqual(A.page.notes().filter((x) => x.note.syncConflict).map((x) => x.note.text), []);
  assert.equal(cloud(w).notes[ids.a].text, 'alpha');
  assert.equal(A.page.findNote(ids.a).note.copied, 2, 'B\'s copies, counted once');
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

test('the same, while B deletes that note before A is back: the Undo is a change made here, so the note is kept', async () => {
  const { w, A, B, ids } = await twoSynced();
  const pause = await undoneWhileOnItsWay(w, A, ids);
  pause.resume();
  await B.syncNow();
  await w.run([B]);
  B.page.deleteNote(ids.a);
  await w.run([B]);
  assert.equal(cloud(w).notes[ids.a]._sync.deleted, true);
  await A.boot();
  await w.run();
  await converge(w, [A, B]);
  assert.equal(noteText(A, ids.a), 'alpha', 'kept on A');
  assert.equal(noteText(B, ids.a), 'alpha', 'and back on B');
  assert.equal(cloud(w).notes[ids.a]._sync.deleted, false);
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

test('the same, with A editing that note again and B editing it too: both texts stay, one as a conflict copy', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  const pause = w.mock.pauseAfter('commit');
  A.page.editNote(ids.a, 'alpha v1 from A');
  for (let i = 0; i < 40 && cloud(w).notes[ids.a].text !== 'alpha v1 from A'; i++) await w.time.advance(50);
  A.page.editNote(ids.a, 'alpha v2 from A');
  await A.quit(1500);
  pause.resume();
  await B.syncNow();
  await w.run([B]);
  B.page.editNote(ids.a, 'alpha v1 from A, then B');
  await w.run([B]);
  await A.boot();
  await w.run();
  await converge(w, [A, B]);
  for (const t of ['alpha v2 from A', 'alpha v1 from A, then B']) {
    assert.ok(texts(A).includes(t), `"${t}" is on A`);
    assert.ok(texts(B).includes(t), `"${t}" is on B`);
  }
  assert.equal(A.page.notes().filter((x) => x.note.syncConflict).length, 1);
  assert.deepEqual(view(A), view(B));
  assertShadowIsCloud(w, A);
});

// The page shows the .bak after a power loss (a stale union, 5.10). With or without the crash between the commit
// and its answer, the account's newer text comes back in place, and the older text here stays as a copy.
test('a commit unheard at a crash, then the .bak at the restart: the account\'s text is back here, as without the crash', async () => {
  const outcomes = [];
  for (const crash of [false, true]) {
    const { w, A, B, ids } = await twoSynced();
    await A.restart(); // this load copies the file (with "alpha") to .bak
    await w.run();
    await A.syncNow();
    await w.run();
    let crashed = false;
    A.onCall = (phase, label) => {
      if (crash && phase === 'after' && label === 'firestore.commit' && !crashed) {
        crashed = true;
        A.kill(); // landed; the process dies before it records so
      }
    };
    A.page.editNote(ids.a, 'alpha v1, pushed');
    await w.run();
    A.onCall = null;
    assert.equal(crashed, crash);
    assert.equal(cloud(w).notes[ids.a].text, 'alpha v1, pushed');
    assert.equal(Boolean(A.readState().outgoing), crash, 'state.json names the commit only after the crash');
    A.kill();
    fs.writeFileSync(A.dataFile, '{ "projects": [ cut short by a power loss');
    await A.boot();
    await w.run();
    await converge(w, [A, B]);
    assert.equal(noteText(A, ids.a), 'alpha v1, pushed', `crash ${crash}: the account's text, in place`);
    assert.deepEqual(A.page.notes().filter((x) => x.note.syncConflict).map((x) => x.note.text), ['alpha'], 'the .bak\'s kept as a copy');
    assert.deepEqual(view(A), view(B));
    assertShadowIsCloud(w, A);
    outcomes.push(texts(A));
  }
  assert.deepEqual(outcomes[1], outcomes[0], 'the crash changes nothing');
});

// The facade tells the engine the page is ready again when the person signs in again in the same page (from
// needs-sign-in): the patch that page holds back still counts once it acknowledges it (D11: copies once).
test('signing in again in the same page while it holds a patch back: the patch still counts, and copies count once', async () => {
  const { w, A, B, ids } = await twoSynced();
  await A.syncNow();
  await w.run();
  B.page.copy(ids.a, 3);
  B.page.editNote(ids.h, 'home from B');
  B.blur();
  await w.run([B]);
  A.page.openEditor(ids.b); // content patches wait
  A.focus();
  await A.syncNow();
  for (let i = 0; i < 20; i++) await w.time.advance(200);
  assert.ok(A.engine.debug().inFlight && A.page.pendingPatch, 'the page holds the patch');
  w.mock.revokeTokens(EMAIL); // the password changed elsewhere
  w.mock.expireIdTokens();
  A.engine.onResume();
  await A.account.getIdToken({ force: true }).catch(() => {});
  for (let i = 0; i < 20; i++) await w.time.advance(200);
  assert.equal(A.account.state().status, 'needs-sign-in');
  w.mock.fail({ service: 'firestore', op: 'get', status: 503, times: 1 }); // no newer patch replaces the held one
  assert.deepEqual(await A.signIn(EMAIL, PASSWORD), { ok: true });
  for (let i = 0; i < 4; i++) await w.time.advance(50);
  assert.ok(A.engine.debug().inFlight, 'still waiting on the patch the page holds');
  assert.ok(A.page.pendingPatch);
  A.page.closeEditor(null); // the page applies it
  await w.run();
  assert.deepEqual(await B.signIn(EMAIL, PASSWORD), { ok: true }); // the same account: B's sign-in ended too
  await w.run();
  await converge(w, [A, B]);
  assert.equal(noteText(A, ids.h), 'home from B');
  assert.equal(A.page.findNote(ids.a).note.copied, 3, 'A: B\'s copies, once');
  assert.equal(cloud(w).notes[ids.a].copied, 3, 'the account');
  assert.equal(B.page.findNote(ids.a).note.copied, 3, 'B');
  assert.deepEqual(view(A), view(B));
});

// 5.5 step 4: a label explains only deletions still waiting to go up.
test('a label from a delete that needed no push never explains a later unlabelled mass deletion', async () => {
  const { w, A, ids } = await twoSynced();
  for (let i = 0; i < 4; i++) A.page.addNote(ids.home, `extra ${i}`);
  await w.run();
  const quick = A.page.addNote(ids.work, 'typed by mistake'); // made and deleted before it went up
  A.page.deleteNote(quick);
  await w.run();
  assert.equal(cloud(w).notes[quick], undefined, 'it never went up');
  assert.deepEqual(A.readState().labels, [], 'its label explained nothing in the account');
  const undone = A.page.addNote(ids.work, 'deleted, then undone before it went');
  await w.run();
  const note = JSON.parse(JSON.stringify(A.page.findNote(undone).note));
  A.page.deleteNote(undone);
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.work).notes.push(note); }, { label: 'Undo' });
  await w.run();
  assert.deepEqual(A.readState().labels, [], 'nor did the undone delete\'s');
  const graves = tombstones(w);
  A.page.mutate((data) => { data.projects.find((p) => p.id === ids.home).notes = []; }); // five gone, no label
  await w.run();
  assert.deepEqual(A.choice(), { kind: 'mass-delete', count: 5 }, 'asked');
  assert.equal(tombstones(w), graves, 'nothing deleted in the account');
});

// "Use my account's board" (6.3): a draft saved into a column the patch removes while the composer holds the
// patch back is in a before-sync backup before the column goes.
test('a draft saved while "Use my account\'s board" waits on that column\'s composer: it is in a before-sync backup', async () => {
  const { w } = await twoSynced({ names: ['A', 'B', 'C'] });
  const C = w.peers[2];
  await C.boot();
  C.page.deleteProject(C.page.data.projects[0].id);
  const mine = C.page.addProject('Mine');
  C.page.addNote(mine, 'a note of C\'s own');
  await w.run();
  await C.signIn(EMAIL, PASSWORD);
  await w.run();
  assert.equal(C.choice()?.kind, 'first-merge');
  C.page.setBusy('composer', mine); // the New prompt composer is open in that column
  assert.deepEqual(C.choose('use-account'), { ok: true });
  for (let i = 0; i < 40; i++) await w.time.advance(100);
  assert.ok(C.page.pendingPatch, 'the patch waits on the composer');
  const made = C.backups.made.length;
  C.page.setDraft(mine, 'a long prompt, begun');
  await w.time.advance(1000);
  C.page.setDraft(mine, 'a long prompt, begun after the answer');
  await w.time.advance(1000);
  C.page.toggleView(mine); // not a draft: no backup
  await w.time.advance(1000);
  assert.equal(C.backups.made.length, made + 2, 'one backup per draft saved');
  C.page.setBusy('composer', null);
  await w.run();
  assert.equal(C.choice(), null);
  assert.equal(C.page.findProject(mine), null, 'the column went, as asked');
  assert.ok(inBackup(C, 'a long prompt, begun after the answer'), 'the draft is in a before-sync backup');
});

// 5.14 and 3.5: nothing of a run that stopped reaches sync/ any more.
test('a draft picture\'s upload answered after "Also remove this board" writes no sync/state.json back', async () => {
  const { w, A, B, ids } = await twoSynced();
  B.kill();
  await A.syncNow();
  await w.run([A]);
  const image = A.images.store(pngBytes(4000, 21));
  A.page.findProject(ids.work).draftImages = [image];
  A.page.setDraft(ids.work, 'a draft with a picture');
  await w.run([A]);
  const pause = w.mock.pauseAfter('upload'); // the device record's draft picture: applied, its answer held
  let hit = false;
  pause.hit.then(() => { hit = true; });
  for (let i = 0; i < 20000 && !hit; i++) {
    await flush(2);
    if (!hit) await w.time.step();
  }
  assert.ok(hit, 'the draft picture is on its way');
  assert.deepEqual(A.engine.localOnly(), { projects: 0, notes: 0, pictures: 0, unreadable: 0 }, 'nothing holds the removal back');
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: true });
  const state = path.join(A.dir, 'sync', 'state.json');
  assert.equal(fs.existsSync(state), false, 'removed with the board');
  pause.resume();
  for (let i = 0; i < 50; i++) await flush(2);
  await w.time.advance(5000);
  assert.equal(fs.existsSync(state), false, 'nothing of the account is written back');
  assert.equal(fs.existsSync(path.join(A.dir, 'sync', 'shadow.json')), false);
});

// 6.7: deleted notes are kept 30 days in the account's trash, then erased; the shadow keeps a deleted note's
// text no longer than that (only the tombstone stays), so it neither outlives the trash nor grows without end.
test('a deleted note\'s text leaves shadow.json once the account\'s 30-day trash copy has expired, on every computer', async () => {
  const { w, A, B, ids } = await twoSynced();
  const secret = 'sk-proj-PASTED-BY-MISTAKE-0123456789abcdef';
  const id = A.page.addNote(ids.work, `call the API with ${secret}`);
  await w.run();
  await B.syncNow();
  await w.run();
  assert.ok(B.page.findNote(id));
  A.page.deleteNote(id);
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(B.page.findNote(id), null, 'the delete reached B');
  const holding = () => [A, B].filter((p) => fs.readFileSync(path.join(p.dir, 'sync', 'shadow.json'), 'utf8').includes(secret)).map((p) => p.name);
  assert.deepEqual(holding(), ['A', 'B'], 'kept meanwhile, so an undelete elsewhere is told from an edit');
  w.time.set(w.time.now() + 29 * 24 * 60 * MIN);
  A.page.editNote(ids.a, 'alpha, 29 days later');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual(holding(), ['A', 'B'], 'within the 30 days');
  w.time.set(w.time.now() + 2 * 24 * 60 * MIN);
  A.page.editNote(ids.a, 'alpha, 31 days later');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual(holding(), [], 'gone from both');
  for (const p of [A, B]) assert.deepEqual(p.readShadow().notes[id].f, {}, `${p.name}: the tombstone stays`);
  assert.deepEqual(view(A), view(B));
});

test('shadow.json stays bounded: notes cleared every day keep their text there only for the last 30 days', async () => {
  const w = world({ names: ['A'] });
  const [A] = w.peers;
  await A.boot();
  const ids = realBoard(A);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  const prompt = (i) => `Prompt #${i}#: ${'Summarise the attached logs and propose three fixes, with code. '.repeat(16)}`;
  const DAYS = 45;
  const PER_DAY = 8;
  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < PER_DAY; i++) A.page.addNote(ids.work, prompt(day * PER_DAY + i), { list: 'combined' });
    await w.run();
    A.page.clearList(ids.work, 'combined'); // Clear Served
    await w.run();
    w.time.set(w.time.now() + 24 * 60 * MIN);
  }
  A.page.editNote(ids.a, 'one small edit');
  await w.run();
  const text = fs.readFileSync(path.join(A.dir, 'sync', 'shadow.json'), 'utf8');
  const kept = Array.from({ length: DAYS * PER_DAY }, (_, i) => i).filter((i) => text.includes(`Prompt #${i}#`));
  assert.ok(kept.length > 0 && kept.length <= 31 * PER_DAY, `${kept.length} cleared texts kept`);
  assert.ok(kept.every((i) => i >= (DAYS - 31) * PER_DAY), 'only the last 30 days\'');
});

// Cost (2.3): "Also signed in on" is read where it can be seen.
test('production timings: a hidden window reads no device records; once focused they are read with its next pull, then every 10 minutes', async () => {
  const bodies = [];
  const spy = (f) => async (url, init = {}) => {
    if (String(url).endsWith(':runQuery')) bodies.push(JSON.parse(init.body));
    return f(url, init);
  };
  const { w, A, B } = await twoSynced({ fast: false, fetchSpy: spy });
  await A.syncNow();
  await w.run();
  B.kill();
  A.setWindow({ focused: false, visible: false, minimized: false });
  await w.run([A]);
  const reads = (from) => bodies.slice(from).filter((b) => b.structuredQuery.from[0].collectionId === 'devices').length;
  const from = bodies.length;
  const heads = w.mock.log.length;
  await w.time.advance(4 * 60 * MIN);
  assert.equal(w.mock.log.slice(heads).filter((e) => e.service === 'firestore' && e.op === 'get').length, 8, 'the polls');
  assert.equal(reads(from), 0, 'no device list while hidden');
  A.focus();
  await w.time.advance(MIN + 1000);
  assert.equal(reads(from), 1, 'read with the first pull once focused');
  await w.time.advance(7 * MIN);
  assert.equal(reads(from), 1, 'not again within 10 minutes');
  await w.time.advance(3 * MIN);
  assert.equal(reads(from), 2, 'then every 10 minutes while focused');
});

// Cost: a copy that hides the window (hideAfterCopy) and an edit followed by a switch to another app each cost one
// head read and one commit: the hide waits for the copy's save, and a push ends the push debounce.
for (const [what, act] of [
  ['a copy that hides the window', (w, A, ids) => {
    A.page.copy(ids.a);
    A.setWindow({ focused: false, visible: false }); // its save is still in main's debounce
  }],
  ['an edit, then a switch to another app', async (w, A, ids, i) => {
    A.page.editNote(ids.a, `alpha ${i}`);
    await w.time.advance(500); // written
    A.blur();
  }],
]) {
  test(`production timings: ${what} costs one head read and one commit`, async () => {
    const { w, A, B, ids } = await twoSynced({ fast: false });
    B.kill();
    await A.syncNow();
    await w.run([A]);
    const costs = [];
    for (let i = 0; i < 4; i++) { // the first warms up (the first save after a sign-in arms a push too)
      await w.time.advance(30000);
      const from = w.mock.log.length;
      await act(w, A, ids, i);
      await w.run([A]);
      const t = {};
      for (const e of w.mock.log.slice(from)) t[`${e.service}:${e.op}`] = (t[`${e.service}:${e.op}`] || 0) + 1;
      if (i > 0) costs.push(t);
      A.setWindow({ focused: true, visible: true });
      await w.run([A]);
    }
    assert.deepEqual(costs, [1, 2, 3].map(() => ({ 'firestore:get': 1, 'firestore:commit': 1 })));
    assert.equal(what.startsWith('a copy') ? cloud(w).notes[ids.a].copied : cloud(w).notes[ids.a].text, what.startsWith('a copy') ? 4 : 'alpha 3');
  });
}

// ================================================================ hardening, round 3

// 3.8 and 5.6: at a sign-in in mid-session the facade tells the page's contentSeq, taken when main scheduled the
// save, which may still wait in main's debounce. A patch merged from the file as it is must never claim to be based
// on that save: Use my account's board would remove a fresh computer's Welcome column with the note just typed.
for (const told of [false, true]) {
  test(`a note typed just before signing in, its save still in main (contentSeq ${told ? 'told, as the facade does' : 'not told'}): kept, and asked`, async () => {
    const w = world();
    const [A, B] = w.peers;
    await A.boot();
    await B.boot();
    realBoard(A);
    await w.run();
    await signIn(w, A, { answer: 'upload' });
    const text = 'typed on B right before signing in';
    const id = B.page.addNote(B.page.data.projects[0].id, text); // into the pristine Welcome
    assert.ok(B.main.pendingData, 'its save waits in main');
    assert.deepEqual(await B.signIn(EMAIL, PASSWORD), { ok: true });
    if (told) B.engine.onPageReady({ session: B.page.session, contentSeq: B.page.contentSeq });
    await w.run();
    assert.equal(noteText(B, id), text, 'still on the board');
    assert.deepEqual(B.page.patches.filter((p) => p.changesContent), [], 'nothing was applied over it');
    assert.equal(B.choice()?.kind, 'first-merge', 'a real board now: asked');
    assert.deepEqual(B.choose('combine'), { ok: true });
    await w.run();
    assert.equal(noteText(B, id), text);
    assert.equal(cloud(w).notes[id]?.text, text, 'and in the account');
  });
}

// 5.5 step 5: no live note in a project the account doesn't have. A project held here (too large, or refused) keeps
// its notes here with it: up on their own, they made the other computer stand in a "Recovered notes" for it, which
// then replaced this computer's own project (its name, colour and every other field) with nothing shown here.
const heavy = (peer, pid, on = true) => peer.page.mutate((data) => {
  const p = data.projects.find((x) => x.id === pid);
  for (let i = 0; i < 160; i++) {
    if (on) p[`futureField${i}`] = i; // a newer version's fields, or a hand-edited file
    else delete p[`futureField${i}`];
  }
});
const futureFields = (p) => Object.keys(p || {}).filter((k) => k.startsWith('futureField')).length;

function noNoteWithoutProject(w) {
  const c = cloud(w);
  for (const [id, n] of Object.entries(c.notes)) {
    if (n._sync.deleted) continue;
    const p = c.projects[n._sync.project];
    assert.ok(p && !p._sync.deleted, `note ${id} is live in a project the account doesn't have`);
  }
}

test('a new project too large for the account: its notes stay here with it, nothing stands in for it elsewhere, and both go up once it fits', async () => {
  const { w, A, B } = await twoSynced();
  const pid = A.page.addProject('Research', { color: 'rose' });
  heavy(A, pid);
  const note = A.page.addNote(pid, 'first idea');
  await w.run();
  assert.equal(A.status().tooLarge, 1, 'the project is held here');
  assert.equal(cloud(w).notes[note], undefined, 'and its note with it');
  noNoteWithoutProject(w);
  assert.deepEqual([A.status().pending, A.engine.hasUnpushed()], [0, false], 'nothing waits that could go');
  const only = { projects: 1, notes: 1, pictures: 0, unreadable: 0 };
  assert.deepEqual(A.engine.localOnly(), only, 'both exist only here');
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: false, code: 'PENDING', pending: 2, localOnly: only });
  await B.syncNow();
  await w.run();
  await A.syncNow();
  await w.run();
  const p = A.page.findProject(pid);
  assert.deepEqual([p.name, p.color, futureFields(p)], ['Research', 'rose', 160], 'A\'s project is as it was');
  assert.equal(B.page.findProject(pid), null, 'B has no stand-in for it');
  heavy(A, pid, false); // small enough now
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(cloud(w).notes[note].text, 'first idea');
  assert.deepEqual([B.page.findProject(pid)?.name, noteText(B, note)], ['Research', 'first idea']);
  assert.deepEqual(view(A), view(B));
  assert.equal(A.status().phase, 'synced');
});

test('a new project the account refuses: its notes stay here with it while the rest goes up, and go with it after Retry', async () => {
  const { w, A, B, ids } = await twoSynced();
  const pid = A.page.addProject('Secret plans', { color: 'rose' });
  const undo = w.mock.denyDoc(`users/${w.uid()}/projects/${codec.docId(pid)}`); // a lasting refusal of that document
  const note = A.page.addNote(pid, 'first idea');
  const other = A.page.addNote(ids.work, 'an ordinary note');
  await w.run();
  assert.deepEqual(Object.keys(A.readState().quarantine), [`project:${pid}`], 'the project is held');
  assert.equal(cloud(w).notes[note], undefined, 'and its note with it');
  assert.equal(cloud(w).notes[other].text, 'an ordinary note', 'the rest went up');
  noNoteWithoutProject(w);
  assert.deepEqual(A.engine.localOnly(), { projects: 1, notes: 1, pictures: 0, unreadable: 0 });
  assert.deepEqual([A.status().phase, A.status().pending, A.status().error], ['paused', 0, { code: 'PERMISSION' }]);
  undo();
  await B.syncNow();
  await w.run();
  await A.syncNow();
  await w.run();
  assert.deepEqual([A.page.findProject(pid).name, A.page.findProject(pid).color], ['Secret plans', 'rose'], 'as it was');
  assert.equal(B.page.findProject(pid), null, 'no stand-in on B');
  A.retry();
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(cloud(w).projects[pid].name, 'Secret plans');
  assert.equal(noteText(B, note), 'first idea');
  assert.deepEqual(view(A), view(B));
});

test('a project held here that the account has as another computer\'s stand-in ("Recovered notes"): this computer\'s stays as it is', async () => {
  const { w, A } = await twoSynced();
  const pid = A.page.addProject('Research', { color: 'rose' });
  heavy(A, pid);
  const note = A.page.addNote(pid, 'first idea');
  await w.run();
  assert.equal(A.status().tooLarge, 1);
  // What a computer that sent notes without their project leaves in the account: a stand-in, with a note in it.
  const other = w.mock.remote(w.uid());
  other.addProject('Recovered notes', { id: pid, color: 'monstera' });
  const theirs = other.addNote(pid, 'a note of the other computer').id;
  await A.syncNow();
  await w.run();
  const p = A.page.findProject(pid);
  assert.deepEqual([p.name, p.color, futureFields(p)], ['Research', 'rose', 160], 'its name, colour and fields');
  assert.equal(noteText(A, theirs), 'a note of the other computer');
  assert.equal(cloud(w).notes[note]?.text, 'first idea', 'the account has that project now: the note goes into it');
  noNoteWithoutProject(w);
  assert.equal(A.status().tooLarge, 1, 'the project itself still can\'t go up');
});

// 5.6: reads adapt to a slow link as commits do (5.5). A page the link can't carry within http.js's deadline is read
// again from where it stopped, in smaller pages: what came before isn't read (and billed) again, there is no backoff,
// and the status isn't "offline" while the head answers.
const LINK = 125000; // 1 Mbit/s, in bytes per second
const deadlineOf = (url) => (url.endsWith(':runQuery') || url.endsWith(':batchGet') ? 60000 : url.endsWith(':commit') ? 120000 : 30000);

// http.js's own deadline gave up on the request (TIMEOUT): what a link too slow for an answer does. The fake clock
// can't run that real-time timer, so the request ends as it would: its signal aborted.
function timedOut(init) {
  if (init.signal) Object.defineProperty(init.signal, 'aborted', { value: true, configurable: true });
  return new TypeError('This operation was aborted');
}

// B's link: an answer that would take longer than the request's deadline never arrives (the server has sent it, so
// its documents are billed).
function slowLink(billed) {
  return (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const u = String(url);
    const res = await f(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    if (u.endsWith(':runQuery') || u.endsWith(':batchGet')) {
      try {
        const items = JSON.parse(buf.toString('utf8'));
        if (Array.isArray(items)) billed.reads += items.filter((x) => x && (x.document || x.found)).length;
      } catch {}
    }
    if (((Buffer.byteLength(String(init.body || '')) + buf.length) / LINK) * 1000 > deadlineOf(u)) {
      billed.cut++;
      throw timedOut(init);
    }
    return new Response(buf, { status: res.status, headers: res.headers });
  });
}

for (const fast of [true, false]) {
  test(`a computer on a 1 Mbit/s link finishes its first sync of 300 long notes (${fast ? 'fast' : 'production'} timings)`, async () => {
    const billed = { reads: 0, cut: 0 };
    const w = world({ fetchFor: slowLink(billed), fast });
    const [A, B] = w.peers;
    await A.boot();
    await B.boot(); // a pristine Welcome: its first sync takes the account's board with no question
    const p = A.page;
    p.deleteProject(p.data.projects[0].id);
    const pid = p.addProject('Long prompts');
    for (let i = 0; i < 300; i++) p.addNote(pid, `${i} `.padEnd(30000, 'x')); // a page of 300: 9 MB, 72 s
    await w.run();
    await signIn(w, A, { answer: 'upload' });
    A.kill();
    assert.deepEqual(await B.signIn(EMAIL, PASSWORD), { ok: true });
    await w.time.advance(60 * MIN);
    assert.equal(B.page.notes().length, 300, `B has the board (${billed.cut} answers lost, phase ${B.status().phase})`);
    assert.equal(B.status().phase, 'synced');
    assert.equal(billed.cut, 1, 'one page lost, then smaller ones');
  });
}

// B's link can't carry one answer within its deadline (the server sent it: billed, never received), chosen by
// drop(url, body); got counts what each kind of read brought, and the sizes of the batchGets.
function dropOnce(drop, got) {
  let dropped = false;
  return (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const u = String(url);
    const streamed = u.endsWith(':runQuery') || u.endsWith(':batchGet');
    const body = streamed && init.body ? JSON.parse(String(init.body)) : null;
    const res = await f(url, init);
    if (!dropped && drop(u, body)) {
      dropped = true;
      await res.arrayBuffer();
      throw timedOut(init);
    }
    if (!streamed) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    const kind = u.endsWith(':runQuery') ? body.structuredQuery.from[0].collectionId : 'batchGet';
    got[kind] = (got[kind] || 0) + JSON.parse(buf.toString('utf8')).filter((x) => x && (x.document || x.found)).length;
    if (kind === 'batchGet') (got.sizes = got.sizes || []).push(body.documents.length);
    return new Response(buf, { status: res.status, headers: res.headers });
  });
}

test('a page of the first sync\'s listing cut short by its deadline: read again from where it stopped, in smaller pages, never offline', async () => {
  const got = {};
  const secondPageOfNotes = (u, b) => u.endsWith(':runQuery') && b?.structuredQuery.from[0].collectionId === 'notes' && b.structuredQuery.startAt;
  const w = world({ fetchFor: dropOnce(secondPageOfNotes, got) });
  const [A, B] = w.peers;
  await A.boot();
  await B.boot();
  A.page.deleteProject(A.page.data.projects[0].id);
  const pid = A.page.addProject('Many');
  for (let i = 0; i < 700; i++) A.page.addNote(pid, `note ${i}`);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  const phases = new Set();
  const lines = B.lines.length;
  assert.deepEqual(await B.signIn(EMAIL, PASSWORD), { ok: true });
  for (let i = 0; i < 4000 && !(B.quiet() && !B.busy()); i++) {
    phases.add(B.status()?.phase);
    await flush(2);
    phases.add(B.status()?.phase);
    if (!(await w.time.step())) break;
  }
  await w.run();
  assert.equal(B.page.notes().length, 700);
  assert.equal(got.notes, 700, 'the page lost is read again from where it stopped: no note twice');
  assert.equal(B.engine.debug().readSize, 150, 'in pages half as big');
  assert.ok(!phases.has('offline'), [...phases].join());
  assert.ok(!B.lines.slice(lines).some((l) => l.includes('will try again')), 'no backoff');
});

test('a batchGet answer cut short by its deadline (the audit): read again in smaller batches, the rest kept', async () => {
  const got = {};
  let armed = false;
  const w = world({ fetchFor: dropOnce((u) => armed && u.endsWith(':batchGet'), got) });
  const [A, B] = w.peers;
  await A.boot();
  await B.boot();
  A.page.deleteProject(A.page.data.projects[0].id);
  const pid = A.page.addProject('Many');
  for (let i = 0; i < 250; i++) A.page.addNote(pid, `note ${i}`);
  await w.run();
  await signIn(w, A, { answer: 'upload' });
  await signIn(w, B);
  await w.run();
  assert.equal(B.page.notes().length, 250);
  B.kill();
  const shadowFile = path.join(B.dir, 'sync', 'shadow.json');
  const shadow = JSON.parse(fs.readFileSync(shadowFile, 'utf8'));
  for (const e of Object.values(shadow.notes)) e.u = '2020-01-01T00:00:00.000000Z'; // out of step with the account
  fs.writeFileSync(shadowFile, JSON.stringify(shadow));
  const stateFile = path.join(B.dir, 'sync', 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), lastAuditAt: 1 })); // the audit is due
  armed = true;
  const lines = B.lines.length;
  await B.boot();
  await w.run();
  assert.equal(got.batchGet, 250, 'every note fetched, none twice');
  assert.deepEqual(got.sizes, [50, 50, 50, 50, 50], 'the lost batch of 100 again as two of 50, and the rest so');
  assert.ok(!B.lines.slice(lines).some((l) => l.includes('will try again')), 'no backoff');
  assertShadowIsCloud(w, B);
});

test('a read cut short while the link is down (a dropped connection): offline, and the pull finishes once it is back', async () => {
  const { w, A, B, ids } = await twoSynced();
  A.page.editNote(ids.a, 'alpha from A');
  await w.run([A]);
  A.kill(); // only B talks to the mock from here
  w.mock.fail({ service: 'firestore', op: 'runQuery', status: 'offline', times: 1 });
  w.mock.fail({ service: 'firestore', op: 'get', status: 'offline', skip: 1, times: 1 }); // the next head read fails too
  const lines = B.lines.length;
  B.engine.syncNow();
  for (let i = 0; i < 200 && B.status().phase !== 'offline'; i++) await w.time.advance(50);
  assert.equal(B.status().phase, 'offline');
  assert.equal(B.engine.debug().readSize, 300, 'nothing to make smaller');
  assert.ok(B.lines.slice(lines).some((l) => l.includes('will try again')), 'a backoff');
  w.mock.fail(null);
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(noteText(B, ids.a), 'alpha from A');
  assert.equal(B.status().phase, 'synced');
});

// 4.6 and 2.3: a held picture is tried again on its own backoff. One whose full file was missing at a sweep (the
// account's own, until fetched) and came later (the lightbox) was kept held but never tried: a cycle with a head
// read every 5 seconds, without end.
test('production timings: a held picture whose file came after a sweep missed it is tried again on its backoff, not every 5 s', async () => {
  const { w, A, B, ids } = await twoSynced({ fast: false });
  const uid = w.uid();
  const image = A.page.addPicture(ids.a, pngBytes(3000, 5));
  fs.rmSync(path.join(A.dir, 'images', `${image}.t.png`)); // no thumbnail can be made on A: the account gets the picture only
  A.images.ensureThumb = () => {};
  await w.run();
  assert.deepEqual(Object.keys(w.mock.objects(uid)).filter((n) => n.includes(image)), [`users/${uid}/images/${image}.png`]);
  w.mock.fail({ service: 'storage', op: 'download', status: 503, times: 1 }); // B's prefetch fails: its sweep finds no file
  await B.syncNow();
  await w.run();
  w.mock.fail(null);
  assert.equal(B.images.has(image, false), false);
  const got = B.engine.ensureImage(image, false); // the lightbox: the picture is on B from now on
  await w.run([B]);
  assert.equal(await got, true);
  w.mock.denyDoc(`users/${uid}/images/${image}.t.png`); // B's own thumbnail is refused, longer than the push waits
  A.kill();
  B.page.editNote(ids.a, 'alpha, edited on B');
  await w.run([B]);
  assert.equal(cloud(w).notes[ids.a].text, 'alpha, edited on B');
  assert.ok(B.readState().quarantine[`picture:${image}`], 'its thumbnail is held');
  const from = w.mock.log.length;
  const { gets, elapsed } = await headReads(w, { ms: 10 * MIN, steps: 5000 });
  const uploads = w.mock.log.slice(from).filter((e) => e.service === 'storage' && String(e.op).startsWith('upload')).length;
  assert.ok(gets <= 20, `${gets} head reads in ${Math.round(elapsed / 1000)} s (the polls: 10)`);
  assert.ok(uploads >= 3, `tried again on its backoff: ${uploads} uploads`);
  assert.ok(B.readState().quarantine[`picture:${image}`].tries >= 4);
});

// 2.3: a wake-up only to push reads the head only when there is something to push.
function headCounter() {
  const counts = {};
  const fetchFor = (name, f) => async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if ((init.method || 'GET') === 'GET' && /\/documents\/users\/[^/]+$/.test(u)) counts[name] = (counts[name] || 0) + 1;
    return f(url, init);
  };
  return { counts, fetchFor };
}

test('production timings: a patch acknowledged with nothing to push costs one head read, not two', async () => {
  const hc = headCounter();
  const { w, A, B, ids } = await twoSynced({ fast: false, fetchFor: hc.fetchFor });
  await A.syncNow();
  await B.syncNow();
  await w.run();
  B.setWindow({ focused: false, visible: false, minimized: false }); // hidden: polls 30 minutes apart
  await w.run();
  await w.time.advance(30000);
  A.page.editNote(ids.a, 'alpha, edited on A');
  await w.time.advance(5000);
  await w.run([A]);
  const before = hc.counts.B || 0;
  B.focus(); // one pull, at once
  await w.time.advance(10000); // well before the next poll
  await w.run([B]);
  assert.equal(noteText(B, ids.a), 'alpha, edited on A');
  assert.equal((hc.counts.B || 0) - before, 1);
});

test('production timings: a blur while only a draft save waits in main costs no head read', async () => {
  const hc = headCounter();
  const { w, A, B, ids } = await twoSynced({ fast: false, fetchFor: hc.fetchFor });
  B.kill();
  await A.syncNow();
  await w.run([A]);
  await w.time.advance(30000);
  const before = hc.counts.A || 0;
  A.page.setDraft(ids.work, 'a draft, never synced'); // drafts stay on this computer (the device record only)
  A.blur(); // its save is still in main's debounce
  await w.time.advance(30000);
  await w.run([A]);
  assert.equal(A.engine.hasUnpushed(), false);
  assert.equal((hc.counts.A || 0) - before, 0);
});

test('production timings: a view-only save arms no head read of its own (the 10-minute counters timer), even hidden', async () => {
  const hc = headCounter();
  const { w, A, B, ids } = await twoSynced({ fast: false, fetchFor: hc.fetchFor });
  B.kill();
  await A.syncNow();
  await w.run([A]);
  A.page.toggleView(ids.work); // the first save after a sign-in arms a push too
  await w.time.advance(5000);
  await w.run([A]);
  A.page.toggleView(ids.work); // a column folded: per computer, nothing syncs
  await w.time.advance(1000);
  A.setWindow({ focused: false, visible: false, minimized: false });
  await w.run([A]);
  const before = hc.counts.A || 0;
  await w.time.advance(12 * MIN); // no poll in this window (hidden: 30 minutes)
  assert.equal(A.engine.hasUnpushed(), false);
  assert.equal((hc.counts.A || 0) - before, 0);
});

// 4.6: the thumbnail prefetch after a patch. A failure on the way (a 503, a dropped connection) isn't the account
// saying it has no thumbnail: the next prefetch tries again, so a note in a folded section has its picture offline.
test('a thumbnail whose prefetch failed once (a 503) is fetched with the next patch', async () => {
  const { w, A, B, ids } = await twoSynced();
  const image = A.page.addPicture(ids.u, pngBytes(5000, 11)); // a note in Cooked
  await w.run();
  w.mock.fail({ service: 'storage', op: 'download', status: 503, times: 1 });
  await B.syncNow();
  await w.run();
  assert.equal(B.images.has(image, true), false, 'the first prefetch failed');
  A.page.editNote(ids.a, 'alpha, a later change');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(noteText(B, ids.a), 'alpha, a later change');
  assert.equal(B.images.has(image, true) || B.images.has(image, false), true, 'fetched with the next patch');
});

// S1: signed out, no timers. A request on its way at the sign-out that fails afterwards is no reason to try again.
test('a head read that fails after the sign-out leaves no engine timer and no retry behind', async () => {
  let hold = null;
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (hold && (init.method || 'GET') === 'GET' && /\/documents\/users\/[^/]+$/.test(u)) {
      const h = hold;
      hold = null;
      await h.wait; // on its way until released
      throw new TypeError('fetch failed'); // then the connection drops
    }
    return f(url, init);
  });
  const { w, B } = await twoSynced({ fetchFor });
  let release;
  hold = { wait: new Promise((r) => { release = r; }) };
  const engine = B.engine;
  for (let i = 0; i < 50 && hold; i++) await w.time.advance(200); // B's next poll: its head read is held
  assert.equal(hold, null, 'the head read is on its way');
  assert.equal(engine.busy(), true);
  assert.deepEqual(await B.signOut(), { ok: true });
  const lines = B.lines.length;
  release();
  for (let i = 0; i < 10; i++) await flush();
  assert.deepEqual(engine.debug().timers, [], 'no engine timer runs signed out');
  assert.deepEqual(B.lines.slice(lines).filter((l) => l.includes('will try again')), [], 'nothing is tried again');
});

// The same for a pull: one waiting on the device list at a sign-out, whose query then fails, is dropped there. It
// never reaches the page, nor the run of the account signed in next.
test('a pull waiting on the device list at a sign-out: once that query fails, nothing of it reaches the next account\'s run', async () => {
  let hold = null;
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    if (hold && String(url).endsWith(':runQuery') && JSON.parse(String(init.body)).structuredQuery.from[0].collectionId === 'devices') {
      const h = hold;
      hold = null;
      h.hit();
      await h.wait; // on its way until released
      throw new TypeError('fetch failed'); // then the connection drops
    }
    return f(url, init);
  });
  const { w, B, ids } = await twoSynced({ fetchFor });
  w.mock.remote(w.uid()).editNote(ids.a, 'alpha from a computer B never heard of'); // B reads the device list for it
  let hit;
  let release;
  const reached = new Promise((r) => { hit = r; });
  hold = { hit: () => hit(), wait: new Promise((r) => { release = r; }) };
  B.engine.syncNow();
  for (let i = 0; i < 200 && hold; i++) await w.time.advance(50);
  await reached;
  assert.deepEqual(await B.signOut({ force: true }), { ok: true });
  w.mock.createUser({ email: 'second@example.com', password: PASSWORD, verified: true });
  assert.deepEqual(await B.signIn('second@example.com', PASSWORD), { ok: true });
  await w.run([B]);
  assert.equal(B.choice()?.kind, 'first-upload');
  const patches = B.page.patches.length;
  release();
  for (let i = 0; i < 20; i++) await flush(2);
  await w.run([B]);
  assert.equal(B.page.patches.length, patches, 'no patch of the first account\'s pull');
  assert.equal(noteText(B, ids.a), 'alpha');
  assert.equal(B.readShadow(), null, 'nothing in the second account\'s shadow');
});

// Round 4 (the final review). 5.5 step 5 also holds for deletions: a project's tombstone never goes while the account
// still has a live note in it that the same push neither deletes nor moves out. A note moved out of a column here and
// held (with a project the account doesn't have, or refused) still lives in that column in the account; deleting the
// column here then waits for the note. Sent anyway, every other computer kept the column for that note (KEPT_PROJECT)
// and brought it back everywhere, here too, with nothing said.
const homeHeld = async (w, A, ids, hold) => {
  const where = hold(); // the note's way out of Home can't go up
  A.page.moveNote(ids.h, { project: where, list: 'notes' });
  A.page.deleteProject(ids.home);
  await w.run();
  noNoteWithoutProject(w);
  assert.equal(cloud(w).projects[ids.home]._sync.deleted, false, 'Home\'s tombstone waits for the note');
  assert.equal(cloud(w).notes[ids.h]._sync.project, ids.home, 'which the account still has in Home');
  assert.equal(A.page.findProject(ids.home), null, 'Home stays deleted here');
  assert.equal(A.choice(), null, 'no question: the undo label waits with the tombstone');
};

test('a note moved into a project held here (too large), then its old column deleted: the deletion waits for the note, and no column comes back', async () => {
  const { w, A, B, ids } = await twoSynced();
  let pid;
  await homeHeld(w, A, ids, () => {
    pid = A.page.addProject('Research', { color: 'rose' });
    heavy(A, pid);
    return pid;
  });
  assert.deepEqual(A.engine.localOnly(), { projects: 2, notes: 1, pictures: 0, unreadable: 0 }, 'Research, Home\'s deletion and the note');
  assert.equal(A.engine.hasUnpushed(), false);
  await B.syncNow();
  await w.run();
  await A.syncNow();
  await w.run();
  assert.equal(B.page.notices.some((n) => n.code === 'KEPT_PROJECT'), false, 'B kept no column for a note');
  assert.equal(noteText(B, ids.h), 'home note');
  assert.equal(A.page.findProject(ids.home), null, 'nothing brought Home back here');
  assert.equal(A.page.findNote(ids.h).project.id, pid);
  heavy(A, pid, false); // small enough now: the project, the note and Home's deletion go up together
  await w.run();
  await B.syncNow();
  await w.run();
  noNoteWithoutProject(w);
  assert.equal(cloud(w).projects[ids.home]._sync.deleted, true);
  assert.equal(B.page.findProject(ids.home), null, 'Home is deleted on B too');
  assert.deepEqual([B.page.findNote(ids.h)?.project.id, noteText(B, ids.h)], [pid, 'home note']);
  assert.equal(A.choice(), null);
  assert.deepEqual(view(A), view(B));
});

test('the same with a project the account refuses, and with the note\'s own move refused (a split commit): the deletion waits', async () => {
  for (const how of ['project', 'note']) {
    const { w, A, B, ids } = await twoSynced();
    let undo;
    await homeHeld(w, A, ids, () => {
      if (how === 'note') {
        undo = w.mock.denyDoc(notePath(w, ids.h)); // the note's move and Home's tombstone share a commit, then are split
        return ids.work;
      }
      const pid = A.page.addProject('Secret plans', { color: 'rose' });
      undo = w.mock.denyDoc(`users/${w.uid()}/projects/${codec.docId(pid)}`);
      return pid;
    });
    assert.ok(A.readState().quarantine[how === 'note' ? `note:${ids.h}` : `project:${A.page.findNote(ids.h).project.id}`], `${how}: held`);
    assert.equal(A.engine.localOnly().projects, how === 'note' ? 1 : 2, `${how}: Home's deletion counts as only here`);
    await B.syncNow();
    await w.run();
    await A.syncNow();
    await w.run();
    assert.equal(B.page.notices.some((n) => n.code === 'KEPT_PROJECT'), false, `${how}: B kept no column`);
    assert.equal(A.page.findProject(ids.home), null, `${how}: nothing brought Home back here`);
    undo();
    A.retry();
    await w.run();
    await B.syncNow();
    await w.run();
    noNoteWithoutProject(w);
    assert.equal(cloud(w).projects[ids.home]._sync.deleted, true, `${how}: Home's deletion went up with the note`);
    assert.equal(B.page.findProject(ids.home), null, `${how}: and reached B`);
    assert.equal(noteText(B, ids.h), 'home note');
    assert.equal(A.choice(), null, `${how}: no question`);
    assert.deepEqual(view(A), view(B));
  }
});

// A held deletion isn't one of the push's: the mass-delete guard (5.5 step 4) counts only what goes now. Deletions no
// undo label explains (the file changed outside the app, say): one note goes with no question while Home's waits for
// its note, and Home's is asked about once it can go.
test('a column\'s deletion held for a note: the guard judges the deletions going now on their own, and the held one when it goes', async () => {
  const { w, A, ids } = await twoSynced();
  const pid = A.page.addProject('Research', { color: 'rose' });
  heavy(A, pid);
  A.page.moveNote(ids.h, { project: pid, list: 'notes' });
  await w.run();
  A.page.mutate((data) => { // no undo label for either
    data.projects = data.projects.filter((p) => p.id !== ids.home);
    const work = data.projects.find((p) => p.id === ids.work);
    work.notes = work.notes.filter((n) => n.id !== ids.a);
  });
  await w.run();
  assert.equal(A.choice(), null, 'one note: no question');
  assert.equal(cloud(w).notes[ids.a]._sync.deleted, true, 'its deletion went up');
  assert.equal(cloud(w).projects[ids.home]._sync.deleted, false, 'Home\'s waits for the note');
  heavy(A, pid, false);
  await w.run();
  assert.equal(A.choice()?.kind, 'mass-delete', 'Home\'s deletion, which nothing explains, is asked about once it can go');
  assert.equal(cloud(w).projects[ids.home]._sync.deleted, false, 'and waits for the answer');
  noNoteWithoutProject(w);
});

// A note moved here into a held project still lives in its old column in the account. That column deleted on another
// computer (with the note, as the account had it) must not take the note from where it is now: a move held back is a
// change made here (merge's held), and the note stays, held, until its project goes up.
test('a note moved into a project held here, then its old column deleted on another computer: the note stays here, and reaches B once the project fits', async () => {
  const { w, A, B, ids } = await twoSynced();
  const pid = A.page.addProject('Research', { color: 'rose' });
  heavy(A, pid);
  await w.run();
  A.page.moveNote(ids.h, { project: pid, list: 'notes' });
  await w.run();
  await B.syncNow();
  await w.run();
  B.page.deleteProject(ids.home); // B: Home, with the note the account still has in it
  await w.run();
  assert.equal(cloud(w).notes[ids.h]._sync.deleted, true);
  await A.syncNow();
  await w.run();
  assert.deepEqual([A.page.findNote(ids.h)?.project.id, noteText(A, ids.h)], [pid, 'home note'], 'still in Research on A');
  assert.deepEqual(A.engine.localOnly(), { projects: 1, notes: 1, pictures: 0, unreadable: 0 }, 'held, and only here');
  noNoteWithoutProject(w);
  heavy(A, pid, false);
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual([B.page.findNote(ids.h)?.project.id, noteText(B, ids.h)], [pid, 'home note'], 'on B, in Research');
  assert.equal(B.page.findProject(ids.home), null, 'Home stays deleted');
  noNoteWithoutProject(w);
  assert.deepEqual(view(A), view(B));
});

// The same for a move the account refuses (the note's own write, quarantined): held, so the deletion elsewhere doesn't
// remove it here either, and it goes up as an undelete once the refusal ends.
test('a note whose move the account refuses, then its old column deleted on another computer: the note stays here, and reaches B once it is taken', async () => {
  const { w, A, B, ids } = await twoSynced();
  const undo = w.mock.denyDoc(notePath(w, ids.h));
  A.page.moveNote(ids.h, { project: ids.work, list: 'notes' });
  await w.run();
  assert.ok(A.readState().quarantine[`note:${ids.h}`], 'the move is held here');
  undo(); // (B's deletion of the note is taken; A's move stays held until Retry)
  B.page.deleteProject(ids.home); // B: Home, with the note as the account has it
  await w.run();
  assert.equal(cloud(w).notes[ids.h]._sync.deleted, true);
  await A.syncNow();
  await w.run();
  assert.deepEqual([A.page.findNote(ids.h)?.project.id, noteText(A, ids.h)], [ids.work, 'home note'], 'still in Work on A');
  assert.deepEqual(A.engine.localOnly(), { projects: 0, notes: 1, pictures: 0, unreadable: 0 }, 'held, and only here');
  noNoteWithoutProject(w);
  A.retry();
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual([B.page.findNote(ids.h)?.project.id, noteText(B, ids.h)], [ids.work, 'home note'], 'on B, in Work');
  assert.equal(B.page.findProject(ids.home), null, 'Home stays deleted');
  noNoteWithoutProject(w);
  assert.deepEqual(view(A), view(B));
});

// "Also remove this board" is refused while anything exists only here. A note or project too large for the account
// counted only once a push had recorded it (offline, or within the push debounce, none had): the removal deleted the
// only copy. The diff counts it now, and status().tooLarge agrees.
const big = 'x'.repeat(1000 * 1000); // over the 900 KB a document may hold (4.7)

test('"Also remove this board" right after a note became too large, offline or within the push debounce: refused, and the note stays', async () => {
  for (const offline of [true, false]) {
    const { w, A, ids } = await twoSynced();
    if (offline) A.setOnline(false);
    const id = A.page.addNote(ids.work, `a pasted log ${big}`);
    if (offline) await w.run([A]);
    else A.main.flushData(); // no push since (the debounce): signOut flushes the same way
    assert.deepEqual([A.engine.hasUnpushed(), A.status().tooLarge, A.status().quarantined], [false, 1, 1], `offline ${offline}`);
    const only = { projects: 0, notes: 1, pictures: 0, unreadable: 0 };
    assert.deepEqual(A.engine.localOnly(), only, `offline ${offline}: only here`);
    assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: false, code: 'PENDING', pending: 1, localOnly: only }, `offline ${offline}`);
    assert.equal(noteText(A, id)?.length, big.length + 'a pasted log '.length, `offline ${offline}: the note stays`);
  }
});

test('"Also remove this board" offline, right after a project became too large: refused, and the project stays', async () => {
  const { w, A } = await twoSynced();
  A.setOnline(false);
  const pid = A.page.addProject('Research', { color: 'rose' });
  heavy(A, pid);
  await w.run([A]);
  const only = { projects: 1, notes: 0, pictures: 0, unreadable: 0 };
  assert.deepEqual([A.status().tooLarge, A.engine.localOnly()], [1, only]);
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: false, code: 'PENDING', pending: 1, localOnly: only });
  assert.equal(futureFields(A.page.findProject(pid)), 160);
});

// A document the link can never carry within its deadline (a 600 KB note at 64 kbit/s): the reads shrink to one
// document, and that one keeps timing out. The first cycle stuck on it is quiet; the next shows it (paused), never
// "synced" for hours while nothing arrives. The count of such cycles was reset by every read that came before it (the
// projects, the notes before it), so it never got past one.
test('a document the link can never carry in time: from the second cycle stuck on it, the status says so', async () => {
  const RATE = 8000; // bytes per second: 64 kbit/s
  const state = { on: false };
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const res = await f(url, init);
    if (!state.on) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    if (((Buffer.byteLength(String(init.body || '')) + buf.length) / RATE) * 1000 > deadlineOf(String(url))) throw timedOut(init);
    return new Response(buf, { status: res.status, headers: res.headers });
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor, fast: false });
  A.page.editNote(ids.a, 'alpha, edited on A');
  await w.run([A]);
  A.page.addNote(ids.work, 'x'.repeat(600 * 1000)); // 75 s at 64 kbit/s, over the 60 s a read may take
  await w.run([A]);
  A.kill();
  state.on = true;
  const lines = B.lines.length;
  const t0 = w.time.now();
  for (let i = 0; i < 100000 && w.time.now() - t0 < 2 * 60 * MIN; i++) if (!(await w.time.step())) break;
  const retries = B.lines.slice(lines).filter((l) => l.includes('will try again'));
  assert.ok(retries.length >= 6, `the same read kept failing (${retries.length} retries)`);
  assert.deepEqual([B.status().phase, B.status().error?.code], ['paused', 'UNKNOWN'], 'shown, not "synced"');
  assert.match(retries[0], /DROPPED/, 'the first cycle is quiet');
  assert.ok(retries.slice(1).every((l) => /UNKNOWN/.test(l)), 'every later one shows');
  assert.equal(noteText(B, ids.a), 'alpha', 'a pull reaches the page whole, or not at all');
});

test('a cycle that got through starts the count of stuck reads over: the next read stuck is quiet once again', async () => {
  const RATE = 8000; // bytes per second: 64 kbit/s
  const state = { on: false };
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const res = await f(url, init);
    if (!state.on) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    if (((Buffer.byteLength(String(init.body || '')) + buf.length) / RATE) * 1000 > deadlineOf(String(url))) throw timedOut(init);
    return new Response(buf, { status: res.status, headers: res.headers });
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor, fast: false });
  const retries = () => B.lines.filter((l) => l.includes('will try again'));
  const stuckOn = async (text) => { // A adds a note B's slow link can't carry in time; B's cycles go on until one is stuck on it
    A.page.addNote(ids.work, text);
    await w.run([A]);
    state.on = true;
    const before = retries().length;
    for (let i = 0; i < 100000 && retries().length === before; i++) if (!(await w.time.step())) break;
    return retries().at(-1);
  };
  assert.match(await stuckOn('x'.repeat(600 * 1000)), /DROPPED/, 'the first cycle stuck is quiet');
  state.on = false; // the link is fast again: the next cycle gets through
  for (let i = 0; i < 100000 && B.page.notes().length !== A.page.notes().length; i++) if (!(await w.time.step())) break;
  await B.syncNow();
  assert.equal(B.status().phase, 'synced');
  assert.match(await stuckOn('y'.repeat(600 * 1000)), /DROPPED/, 'stuck again later: quiet again, not shown at once');
});

// A link that loses a share of its answers whatever their size (a dropped connection, a Wi-Fi handover): smaller pages
// only mean more answers to lose. Every such loss halved the page, which grew back only after 10 full ones, so a large
// first sync on such a link ended up reading a document or two at a time and never finished. A dropped connection
// fails the cycle as any request's would (offline, a backoff), and the read starts again at the size it had.
function lossyReads(p, seed, state) {
  let a = (seed * 2654435761) >>> 0; // mulberry32, warmed up
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) rand();
  return (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const u = String(url);
    const res = await f(url, init);
    if (!state.on || !u.includes('firestore.googleapis.com') || u.endsWith(':commit')) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    state.reads++;
    if (rand() < p) throw new TypeError('fetch failed'); // the server sent it; it never arrived
    return new Response(buf, { status: res.status, headers: res.headers });
  });
}

for (const seed of [4, 5, 8]) {
  test(`a first sync of 700 notes on a link that loses 20 % of its read answers finishes (seed ${seed})`, async () => {
    const state = { on: false, reads: 0 };
    const w = world({ fetchFor: lossyReads(0.2, seed, state), fast: false });
    const [A, B] = w.peers;
    await A.boot();
    await B.boot(); // a pristine Welcome: its first sync takes the account's board with no question
    A.page.deleteProject(A.page.data.projects[0].id);
    const pid = A.page.addProject('Many');
    for (let i = 0; i < 700; i++) A.page.addNote(pid, `note ${i}`);
    await w.run();
    await signIn(w, A, { answer: 'upload' });
    A.kill();
    state.on = true;
    const t0 = w.time.now();
    assert.deepEqual(await B.signIn(EMAIL, PASSWORD), { ok: true });
    for (let i = 0; i < 400000 && w.time.now() - t0 < 6 * 60 * MIN && B.page.notes().length !== 700; i++) {
      if (!(await w.time.step())) break;
    }
    const minutes = Math.round((w.time.now() - t0) / MIN);
    assert.equal(B.page.notes().length, 700, `after ${minutes} min, ${state.reads} reads; readSize ${B.engine.debug().readSize}`);
    assert.equal(B.engine.debug().readSize, 300, 'pages as big as ever');
  });
}

// 5.15: deleting the account erases the account's copy of every picture. A picture another computer added is here only
// as a thumbnail (its full size comes on demand), so once that computer had removed its board, the deletion erased the
// only full-size copy, though the panel says this computer keeps its own copy of the board. The full sizes are saved
// here first ('save-pictures'), before anything of the deletion exists.
const pictureFromA = async () => {
  const { w, A, B, ids } = await twoSynced();
  const bytes = pngBytes(5000, 9);
  const image = A.page.addPicture(ids.a, bytes);
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual([B.images.has(image, true), B.images.has(image, false)], [true, false], 'B has its thumbnail only');
  return { w, A, B, ids, image, bytes, uid: w.uid() };
};

test('deleting the account first saves here the full size of every picture the board shows only as a thumbnail', async () => {
  const { w, A, B, image, bytes, uid } = await pictureFromA();
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: true }); // all of it is in the account: A may remove its board
  const progress = [];
  assert.deepEqual(await B.deleteAccount(PASSWORD, progress), { ok: true });
  assert.deepEqual(w.mock.objects(uid), {}, 'the account\'s copy is gone');
  assert.ok(B.images.has(image, false) && B.images.readFile(image, false).equals(bytes), 'the full size is here');
  assert.deepEqual([...new Set(progress.map((p) => p.what))], ['save-pictures', 'pictures', 'notes', 'account']);
  assert.deepEqual(progress.filter((p) => p.what === 'save-pictures').at(-1), { what: 'save-pictures', done: 1, total: 1 });
});

test('a picture that can\'t be saved (a 503): the deletion stops with nothing recorded or erased, sync goes on, and deleting again works', async () => {
  const { w, A, B, ids, image, uid } = await pictureFromA();
  const objects = Object.keys(w.mock.objects(uid)).sort();
  w.mock.fail({ service: 'storage', op: 'download', status: 503, times: 1 });
  const progress = [];
  const res = await B.deleteAccount(PASSWORD, progress);
  assert.equal(res.ok, false);
  assert.deepEqual([B.engine.deletion(), B.readState().deletion ?? null], [null, null], 'no deletion recorded');
  assert.ok(!w.mock.doc(`users/${uid}`).data.deleting, 'the head isn\'t marked');
  assert.deepEqual(Object.keys(w.mock.objects(uid)).sort(), objects, 'every picture still in the account');
  assert.ok(w.mock.user(EMAIL), 'and the sign-in');
  assert.deepEqual([...new Set(progress.map((p) => p.what))], ['save-pictures']);
  A.page.editNote(ids.b, 'bravo, later');
  await w.run();
  await B.syncNow();
  await w.run();
  assert.deepEqual([noteText(B, ids.b), B.status().phase], ['bravo, later', 'synced'], 'B syncs on');
  assert.deepEqual(await B.deleteAccount(PASSWORD), { ok: true });
  assert.ok(B.images.has(image, false), 'the full size is here');
  assert.deepEqual([w.mock.user(EMAIL), w.mock.doc(`users/${uid}`)], [null, null]);
});

// A picture the account has no full size of (over 32 MB, it stays on the computer that has it; or one refused there,
// that never went up at all) can't be saved, and isn't a failure: otherwise the account could never be deleted here.
test('a picture the account has only as a thumbnail, or not at all: not a failure, and the deletion goes on', async () => {
  for (const missing of ['full', 'both']) {
    const { w, B, image, uid } = await pictureFromA();
    for (const thumb of missing === 'both' ? [false, true] : [false]) w.mock.writeObject(`users/${uid}/images/${image}${thumb ? '.t' : ''}.png`, null);
    if (missing === 'both') fs.rmSync(path.join(B.images.folder, `${image}.t.png`), { force: true }); // never fetched here either
    assert.deepEqual(await B.engine.completePictures({ strict: true }), { total: 1, fetched: 0, left: 0, failed: 0 }, `${missing}: none to fetch`);
    const progress = [];
    assert.deepEqual(await B.deleteAccount(PASSWORD, progress), { ok: true }, missing);
    assert.deepEqual(progress.filter((p) => p.what === 'save-pictures').at(-1), { what: 'save-pictures', done: 1, total: 1 }, missing);
    assert.equal(B.images.has(image, true), missing === 'full', `${missing}: the thumbnail stays when it was here`);
    assert.deepEqual([w.mock.user(EMAIL), w.mock.doc(`users/${uid}`)], [null, null], missing);
  }
});

// What the facade's plain sign-out uses (completePictures({ deadline })): the full sizes the board shows, fetched while
// time allows; offline, nothing is tried (strict: NETWORK at once).
test('completePictures: the full sizes the board shows only as thumbnails, within a deadline; offline nothing, or NETWORK when strict', async () => {
  const { w, A, B, ids, image } = await pictureFromA();
  const second = A.page.addPicture(ids.b, pngBytes(4000, 11));
  await w.run();
  await B.syncNow();
  await w.run();
  B.setOnline(false);
  assert.deepEqual(await B.engine.completePictures({}), { total: 2, fetched: 0, left: 2, failed: 0 });
  await assert.rejects(B.engine.completePictures({ strict: true }), (err) => err.code === 'NETWORK');
  B.setOnline(true);
  assert.deepEqual(await B.engine.completePictures({ deadline: w.time.now() }), { total: 2, fetched: 0, left: 2, failed: 0 }, 'none starts after it');
  w.mock.fail({ service: 'storage', op: 'download', status: 503, times: 1 });
  const seen = [];
  const r = await B.engine.completePictures({ onProgress: (p) => seen.push(p) });
  assert.deepEqual([r.total, r.fetched + r.failed, r.left, r.failed], [2, 2, 0, 1], 'a failure counted, the rest go on');
  assert.deepEqual(seen.at(-1), { done: 2, total: 2 });
  assert.deepEqual(await B.engine.completePictures({}), { total: 1, fetched: 1, left: 0, failed: 0 });
  assert.ok(B.images.has(image, false) && B.images.has(second, false));
  assert.deepEqual(await B.engine.completePictures({}), { total: 0, fetched: 0, left: 0, failed: 0 });
});

// Round 4, verified (protocol): "none starts after the deadline" held for a picture's first download only. With neither
// file here (a prefetch that never got the thumbnail), the thumbnail comes first; once it came after the deadline, the
// full size still started (up to 32 MB the sign-out doesn't wait for). And the thumbnail first: without it, the board
// here would load full-size pictures where it shows previews.
test('completePictures: no download starts after the deadline, a full size whose thumbnail came late included; with time, the thumbnail first', async () => {
  const slow = { thumb: null, time: null, full: [] };
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init) => {
    const u = String(url);
    if (slow.thumb && u.includes('alt=media') && u.includes(`${slow.thumb}.t.png`)) await new Promise((r) => slow.time.setTimeout(r, 25000));
    else if (slow.thumb && u.includes('alt=media') && u.includes(`${slow.thumb}.png`)) slow.full.push(slow.time.now());
    return f(url, init);
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor });
  slow.time = w.time;
  const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
  await w.run();
  await B.syncNow();
  await w.run();
  const thumbFile = path.join(B.images.folder, `${image}.t.png`);
  fs.rmSync(thumbFile); // neither file here
  slow.thumb = image;
  let res = null;
  B.engine.completePictures({ deadline: w.time.now() + 20000 }).then((r) => { res = r; });
  for (let i = 0; i < 100000 && !res; i++) {
    await flush(2);
    if (!res && !(await w.time.step())) break;
  }
  assert.deepEqual(res, { total: 1, fetched: 0, left: 1, failed: 0 }, 'left: its thumbnail came after the deadline');
  assert.deepEqual(slow.full, [], 'and its full size never started');
  assert.deepEqual([B.images.has(image, true), B.images.has(image, false)], [true, false], 'the thumbnail that came is kept');
  slow.thumb = null;
  fs.rmSync(thumbFile);
  assert.deepEqual(await B.engine.completePictures({}), { total: 1, fetched: 1, left: 0, failed: 0 });
  assert.deepEqual([B.images.has(image, true), B.images.has(image, false)], [true, true], 'the thumbnail first, then the full size');
});

// B's downlink: rate bytes per second, shared evenly by the downloads on it; one that can't finish within its deadline
// (http.js gives a download 120 s) is cut (TIMEOUT).
function sharedDownlink(time, rate) {
  const active = new Set();
  let last = time.now();
  let tick = null;
  const advance = () => {
    const dt = (time.now() - last) / 1000;
    last = time.now();
    if (active.size && dt > 0) for (const x of active) x.left -= (rate * dt) / active.size;
  };
  const plan = () => {
    if (tick !== null) time.clearTimeout(tick);
    tick = null;
    if (!active.size) return;
    const soonest = Math.min(...[...active].map((x) => x.left)) / (rate / active.size);
    tick = time.setTimeout(() => {
      tick = null;
      advance();
      for (const x of [...active]) {
        if (x.left > 0.5) continue;
        active.delete(x);
        time.clearTimeout(x.cut);
        x.resolve();
      }
      plan();
    }, Math.max(1, Math.ceil(soonest * 1000)));
  };
  return (bytes, deadline) => new Promise((resolve, reject) => {
    advance();
    const x = { left: bytes, resolve };
    x.cut = time.setTimeout(() => {
      advance();
      if (!active.delete(x)) return;
      plan();
      reject(new Error('cut'));
    }, deadline);
    active.add(x);
    plan();
  });
}

// A slow link shared by four downloads: four 1 MB pictures on 256 kbit/s need 125 s together, over the 120 s a download
// has, and 31 s each alone. All four timed out, the strict deletion stopped at the first, and every try again did the
// same: the account couldn't be deleted from that link. Timed out together, they are tried again one at a time, and the
// pictures after them go one at a time too.
const savingOver = (rate) => {
  const link = { on: null, cut: 0, got: 0, rate };
  link.fetchFor = (name, f) => (name !== 'B' ? f : async (url, init = {}) => {
    const res = await f(url, init);
    if (!link.on || !String(url).includes('alt=media') || res.status !== 200) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      await link.on(buf.length, 120000);
    } catch {
      link.cut++;
      throw timedOut(init);
    }
    link.got++;
    return new Response(buf, { status: res.status, headers: res.headers });
  });
  link.deleting = async (w, B) => {
    link.on = sharedDownlink(w.time, link.rate);
    const t0 = w.time.now();
    let res = null;
    B.deleteAccount(PASSWORD).then((r) => { res = r; });
    for (let i = 0; i < 100000 && !res && w.time.now() - t0 < 30 * MIN; i++) {
      await flush(2);
      if (!res && !(await w.time.step())) break;
    }
    return { res, took: Math.round((w.time.now() - t0) / 1000) };
  };
  return link;
};

test('deleting the account over a 256 kbit/s link with eight 1 MB pictures to save: four time out together, then one at a time, and the account goes', async () => {
  const link = savingOver(32000);
  const { w, A, B, ids } = await twoSynced({ fetchFor: link.fetchFor });
  const notes = [ids.a, ids.b, ids.c, ids.h, ids.u, ids.s, ids.a, ids.b];
  const pics = notes.map((id, i) => A.page.addPicture(id, pngBytes(1000000, 20 + i)));
  await w.run();
  await B.syncNow();
  await w.run();
  assert.ok(pics.every((id) => B.images.has(id, true) && !B.images.has(id, false)), 'B has the thumbnails only');
  const { res, took } = await link.deleting(w, B);
  assert.deepEqual(res, { ok: true }, `after ${took} s`);
  assert.ok(pics.every((id) => B.images.has(id, false)), 'every full size is here');
  assert.deepEqual([link.cut, link.got], [4, 8], 'four timed out together; the rest and then those came one at a time');
  assert.ok(took < 400, `${took} s`);
  assert.equal(w.mock.user(EMAIL), null);
});

test('a picture the link can\'t carry even alone: tried once more on its own, then the deletion stops with nothing recorded or erased', async () => {
  const link = savingOver(8000); // 1 MB alone needs 125 s
  const { w, A, B, ids } = await twoSynced({ fetchFor: link.fetchFor });
  const image = A.page.addPicture(ids.a, pngBytes(1000000, 20));
  await w.run();
  await B.syncNow();
  await w.run();
  const uid = w.uid();
  const objects = Object.keys(w.mock.objects(uid)).sort();
  const { res, took } = await link.deleting(w, B);
  assert.deepEqual(res, { ok: false, code: 'NETWORK' }, `after ${took} s: the download's own failure (a connection problem)`);
  assert.equal(link.cut, 2, 'two tries, the last one on its own');
  assert.deepEqual([B.engine.deletion(), B.readState().deletion ?? null], [null, null], 'no deletion recorded');
  assert.deepEqual(Object.keys(w.mock.objects(uid)).sort(), objects, 'every picture still in the account');
  assert.ok(w.mock.user(EMAIL), 'and the sign-in');
  assert.equal(B.images.has(image, false), false);
});

test('a plain sign-out first fetches the full size of the pictures the board shows only as thumbnails (as the facade does)', async () => {
  const { w, A, B, image, bytes } = await pictureFromA();
  assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: true });
  assert.deepEqual(await B.signOut(), { ok: true });
  assert.ok(B.images.has(image, false) && B.images.readFile(image, false).equals(bytes), 'signed out, the board here is whole');
  assert.ok(w.mock.user(EMAIL), 'the account stays');
});

// accounts:delete wants a sign-in from the last ~5 minutes. Saving the pictures first can take longer than that on a
// slow link: account.js signs in again before the last step when the one before it is over 4 minutes old (0 #17).
test('a picture download that outlasts the recent sign-in before a deletion: the account still goes, signed in again first', async () => {
  const slow = { id: null, time: null };
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init) => {
    const u = String(url);
    if (slow.id && u.includes('alt=media') && u.includes(`${slow.id}.png`)) await new Promise((r) => slow.time.setTimeout(r, 5 * MIN));
    return f(url, init);
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor });
  slow.time = w.time;
  const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
  await w.run();
  await B.syncNow();
  await w.run();
  assert.equal(B.images.has(image, false), false);
  slow.id = image;
  const signIns = () => w.mock.log.filter((e) => e.op === 'signInWithPassword' && e.status === 200).length;
  const before = signIns();
  const t0 = w.time.now();
  let res = null;
  B.deleteAccount(PASSWORD).then((r) => { res = r; });
  for (let i = 0; i < 100000 && !res; i++) {
    await flush(2);
    if (!res && !(await w.time.step())) break;
  }
  assert.deepEqual(res, { ok: true });
  assert.ok(w.time.now() - t0 >= 5 * MIN, 'the picture took 5 minutes');
  assert.ok(B.images.has(image, false), 'and is here');
  assert.equal(signIns() - before, 2, 'signed in again before the sign-in was deleted');
  assert.equal(w.mock.user(EMAIL), null);
});

// Round 4, verified: a download the save-pictures step had started, answered after the engine stopped (stop(): the
// facade's sign-out stops it before account.js answers BUSY, then starts it again) or after this computer's sign-in
// stopped working (a password changed elsewhere), writes nothing. It counted as tried, so the deletion went on: erased
// at once after a stop, or recorded and then "Finish deleting", which skips the step, erased the only full-size copy.
// Cut short, it counts as left: nothing is recorded or erased.
test('a picture download cut short by a stop or a sign-in that stopped working: the deletion stops, nothing recorded or erased, and the next one saves it first', async () => {
  for (const how of ['stop', 'sign-in']) {
    const slow = { id: null, time: null };
    const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init) => {
      const u = String(url);
      if (slow.id && u.includes('alt=media') && u.includes(`${slow.id}.png`)) await new Promise((r) => slow.time.setTimeout(r, 5 * MIN));
      return f(url, init);
    });
    const { w, A, B, ids } = await twoSynced({ fetchFor });
    slow.time = w.time;
    const uid = w.uid();
    const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
    await w.run();
    await B.syncNow();
    await w.run();
    assert.deepEqual(await A.signOut({ removeBoard: true }), { ok: true }); // the account's is the only full size now
    slow.id = image;
    const objects = Object.keys(w.mock.objects(uid)).sort();
    const runUntil = async (cond) => {
      for (let i = 0; i < 100000 && !cond(); i++) {
        await flush(2);
        if (!cond() && !(await w.time.step())) break;
      }
    };
    let res = null;
    B.deleteAccount(PASSWORD).then((r) => { res = r; });
    const t0 = w.time.now();
    await runUntil(() => res || w.time.now() - t0 >= MIN);
    assert.equal(res, null, `${how}: a minute into the download`);
    if (how === 'stop') B.engine.stop();
    else {
      w.mock.revokeTokens(EMAIL); // refreshes now fail (TOKEN_EXPIRED)
      await B.account.getIdToken({ force: true }).catch(() => {});
      assert.equal(B.account.state().status, 'needs-sign-in');
    }
    await runUntil(() => res);
    assert.equal(res?.ok, false, `${how}: the deletion stopped`);
    assert.deepEqual([B.engine.deletion(), B.readState().deletion ?? null], [null, null], `${how}: no deletion recorded`);
    assert.ok(!w.mock.doc(`users/${uid}`).data.deleting, `${how}: the head isn't marked`);
    assert.deepEqual(Object.keys(w.mock.objects(uid)).sort(), objects, `${how}: every picture still in the account`);
    assert.ok(w.mock.user(EMAIL), `${how}: and the sign-in`);
    if (how === 'stop') B.engine.start();
    let again = null;
    B.deleteAccount(PASSWORD).then((r) => { again = r; });
    await runUntil(() => again);
    assert.deepEqual(again, { ok: true }, `${how}: deleting again works`);
    assert.ok(B.images.has(image, false), `${how}: the full size was saved here first`);
    assert.deepEqual([w.mock.user(EMAIL), w.mock.doc(`users/${uid}`)], [null, null]);
  }
});

test('completePictures: a download the engine stopped during counts as left, not as saved or failed', async () => {
  const slow = { id: null, time: null };
  const fetchFor = (name, f) => (name !== 'B' ? f : async (url, init) => {
    const u = String(url);
    if (slow.id && u.includes('alt=media') && u.includes(`${slow.id}.png`)) await new Promise((r) => slow.time.setTimeout(r, 5 * MIN));
    return f(url, init);
  });
  const { w, A, B, ids } = await twoSynced({ fetchFor });
  slow.time = w.time;
  const image = A.page.addPicture(ids.a, pngBytes(5000, 9));
  await w.run();
  await B.syncNow();
  await w.run();
  slow.id = image;
  let res = null;
  B.engine.completePictures({}).then((r) => { res = r; });
  const t0 = w.time.now();
  for (let i = 0; i < 100000 && !res && w.time.now() - t0 < MIN; i++) {
    await flush(2);
    if (!res && !(await w.time.step())) break;
  }
  assert.equal(res, null, 'a minute into the download');
  B.engine.stop();
  for (let i = 0; i < 100000 && !res; i++) {
    await flush(2);
    if (!res && !(await w.time.step())) break;
  }
  assert.deepEqual(res, { total: 1, fetched: 0, left: 1, failed: 0 });
  assert.equal(B.images.has(image, false), false, 'nothing written after the stop');
});
