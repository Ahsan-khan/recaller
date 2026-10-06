'use strict';
// Three computers and one account under random steps (ai_memory/15, 7.4): each computer is the real engine
// with the headless peer's page and main (contentSeq, undo labels, busy editors and deferral), all on the GCP
// mock and one fake clock. Steps add, edit, replace whole texts, move, reorder, sort, delete, clear, add and
// remove projects, make a project too large for the account (and small again; its notes then wait here with
// it), copy, highlight, set the joiner, add pictures, open and close editors, reload the page,
// move a note into a new project too large for the account or while its own write is refused (then sometimes delete
// the column it left at once, a deletion that waits for the note), back up and restore (the page loads the restored
// file 50 ms later, as in main.js), sign out and in again,
// sign out removing the board (then sign in again and answer the first-sync question), go offline, crash at a
// random call and restart, race another computer, and inject faults (lost commit answers, 5xx after a commit
// landed, 503s, short denials of a note, a project or a picture). After every step, the account holds no live note
// in a deleted or missing project (5.5 step 5). After quiescence: the same board on every computer
// (synced fields), every shadow equal to the account, no duplicate ids, every live note in a live project,
// every picture of a live note in the account; with deletes, a note deleted with an undo label stays deleted
// unless something could rightly bring it back (a union, an edit, a KEPT notice, a move held back on another
// computer, which a delete elsewhere never outweighs); without deletes, every text
// ever saved is still on every computer, in place or as a conflict copy, unless an edit knowingly replaced it;
// and in the exact mode (no deletes, no crashes: restarts quit cleanly) every copy made anywhere is counted
// exactly once.
//
// Default: a run of about a minute. FUZZ_SEEDS=50 FUZZ_STEPS=2000 is the full 7.4 run; FUZZ_SEED=n replays one, and
// FUZZ_OFFSET=n starts the seeds after n (fresh ones).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGcpMock } = require('../mock-gcp');
const { createPeer, createFakeTime, settle, makeRng, pngBytes, seedData, LISTS } = require('../support/peer');
const model = require('../../src/sync/model');
const codec = require('../../src/cloud/codec');

const SEEDS = Math.max(1, Number(process.env.FUZZ_SEEDS) || 12);
const EXACT_SEEDS = Math.max(1, Number(process.env.FUZZ_SEEDS) || 6);
const STEPS = Math.max(10, Number(process.env.FUZZ_STEPS) || 1200);
const ONLY = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : null;
const OFFSET = Math.max(0, Number(process.env.FUZZ_OFFSET) || 0);
const EMAIL = 'fuzz@example.com';
const PASSWORD = 'password-1234';
const TIPS = seedData(() => 'x', () => 0).projects[0].notes.map((n) => n.text); // the Welcome seed's texts
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-fuzz-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function view(data) {
  const m = model.toModel(data);
  const out = { joiner: m.board.joiner, columns: m.columns, projects: {}, lists: {}, notes: {} };
  for (const [id, x] of m.projects) out.projects[id] = x.fields;
  for (const [k, v] of m.lists) out.lists[k] = v;
  for (const [id, x] of m.notes) out.notes[id] = { f: x.fields, c: x.copied, lc: x.lastCopiedAt };
  return out;
}

// 160 fields a newer version might add: over the account's limit per document (4.7), so the project is too large.
function resize(project, large) {
  if (!project) return;
  for (let i = 0; i < 160; i++) {
    if (large) project[`futureField${i}`] = i;
    else delete project[`futureField${i}`];
  }
}

function cloudOf(mock, uid) {
  const docs = mock.docs(uid);
  const out = { head: docs.head, projects: {}, notes: {} };
  for (const kind of ['projects', 'notes']) for (const [docId, d] of Object.entries(docs[kind])) out[kind][d._sync?.id ?? docId] = d;
  return out;
}

// 5.5 step 5: the live notes the account holds in a deleted or missing project (none, ever).
function homeless(cloud) {
  return Object.entries(cloud.notes).filter(([, n]) => !n._sync.deleted
    && !(cloud.projects[n._sync.project] && !cloud.projects[n._sync.project]._sync.deleted)).map(([id, n]) => `${id} in ${n._sync.project}`);
}

// deletes: the steps include deleting; exact: no crashes (restarts quit cleanly), so copies count exactly.
async function run(seed, { steps, deletes, exact = false }) {
  const rand = makeRng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const time = createFakeTime();
  const mock = createGcpMock({ now: time.now });
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const dir = path.join(root, `seed-${seed}-${exact ? 'x' : deletes ? 'd' : 'n'}`);
  const peers = ['A', 'B', 'C'].map((name, i) => createPeer({
    dir: path.join(dir, name), fetchImpl: mock.fetch, time, name, platform: i === 0 ? 'win32' : 'darwin', random: makeRng(seed * 101 + i),
  }));
  const [A, B, C] = peers;
  const log = [];
  let step = 0;
  const say = (line) => {
    log.push(line);
    if (log.length > 60) log.shift();
  };
  let serial = 0;
  const text = (tag) => `${tag}${++serial}`;

  // A uploads a small board; B and C sign in over their Welcome boards and take it.
  for (const p of peers) await p.boot();
  const first = A.page;
  first.deleteProject(first.data.projects[0].id);
  for (let i = 0; i < 2; i++) {
    const pid = first.addProject(`P${i}`);
    for (let k = 0; k < 3; k++) first.addNote(pid, text('n'));
  }
  await settle(peers, time);
  await A.signIn(EMAIL, PASSWORD);
  await settle(peers, time);
  A.choose('upload');
  await settle(peers, time);
  for (const p of [B, C]) {
    await p.signIn(EMAIL, PASSWORD);
    await settle(peers, time);
  }
  const uid = mock.user(EMAIL).uid;
  for (const p of peers) p.saved.length = 0; // the Welcome seeds were replaced on purpose

  const superseded = new Set(); // texts an edit (or a restore) replaced, on a computer that showed them
  const made = new Map();       // copies made, per note
  const touched = new Map();    // note id → the last step anything but a copy changed it
  const deleted = [];           // notes deleted with an undo label: { id, step, peer, content, landed }
  const unions = new Map();     // computer → the steps something could have started a union there
  const restores = [];          // { step, ids, peer, ended }: a restore brings back the notes its backup holds (5.12)
  const heldSeen = new Map();   // 'note id|computer' → the last step it held the note back (merge's held: a delete doesn't remove it)
  const backupsOf = new Map();
  const notes = (p) => p.page.notes();
  const touch = (id) => touched.set(id, step);
  const union = (p) => unions.set(p.name, [...(unions.get(p.name) || []), step]);
  const edit = (p, id, next) => {
    const at = p.page.findNote(id);
    if (!at) return;
    superseded.add(at.note.text);
    touch(id);
    p.page.editNote(id, next);
  };
  // A labelled delete of these notes (as they were), tracked unless a union is still on its way there.
  const content = (n) => JSON.stringify([n.text, (n.images || []).map((i) => i.id)]);
  const drop = (p, gone) => {
    const d = p.engine?.debug();
    if (!p.engine || d.mode !== 'normal' || d.seeded) return;
    for (const n of gone) deleted.push({ id: n.id, step, peer: p.name, content: content(n), landed: null });
  };
  const signedIn = (p) => p.account?.state().status === 'signed-in';
  // A labelled delete of a column and its notes, as dropProject makes it.
  const dropColumn = (p, pid) => {
    const pr = p.page.findProject(pid);
    if (!pr || p.page.data.projects.length <= 1 || LISTS.some((l) => pr[l].some((n) => n.id === p.page.busy.editing))) return;
    const gone = LISTS.flatMap((l) => pr[l].map((n) => ({ ...n })));
    p.page.deleteProject(pid);
    drop(p, gone);
  };

  const ops = {
    async add(p) {
      const projects = p.page.data.projects;
      if (!projects.length) return ops.project(p);
      const pr = pick(projects);
      const list = chance(0.8) ? 'notes' : pick(['used', 'combined']);
      p.page.addNote(pr.id, text('n'), { list, index: chance(0.5) ? 0 : null });
    },
    async edit(p) {
      const x = pick(notes(p));
      if (x && p.page.busy.editing !== x.note.id) edit(p, x.note.id, `${x.note.text.split(' ~')[0]} ~${++serial}`);
    },
    async whole(p) {
      const x = pick(notes(p));
      if (x && p.page.busy.editing !== x.note.id) edit(p, x.note.id, text('w'));
    },
    async move(p) {
      const x = pick(notes(p));
      const to = pick(p.page.data.projects);
      if (!x || !to || p.page.busy.editing === x.note.id) return;
      touch(x.note.id);
      p.page.moveNote(x.note.id, { project: to.id, list: pick(LISTS), index: Math.floor(rand() * 4) });
    },
    async reorder(p) {
      const lists = p.page.data.projects.flatMap((pr) => LISTS.map((l) => ({ pr, l }))).filter(({ pr, l }) => pr[l].length > 1);
      const one = pick(lists);
      if (!one) return;
      const n = pick(one.pr[one.l]);
      if (p.page.busy.editing === n.id) return;
      touch(n.id);
      p.page.moveNote(n.id, { index: Math.floor(rand() * one.pr[one.l].length) });
    },
    async sort(p) {
      const pr = pick(p.page.data.projects);
      if (!pr) return;
      for (const l of LISTS) for (const n of pr[l]) touch(n.id);
      p.page.sortPrompts(pr.id);
    },
    async remove(p) {
      const x = pick(notes(p));
      if (!x || p.page.busy.editing === x.note.id) return;
      const gone = [{ ...x.note }];
      p.page.deleteNote(x.note.id);
      drop(p, gone);
    },
    async clear(p) {
      const pr = pick(p.page.data.projects);
      const l = pick(['used', 'combined']);
      if (!pr || !pr[l].length || pr[l].some((n) => n.id === p.page.busy.editing)) return;
      const gone = pr[l].map((n) => ({ ...n }));
      p.page.clearList(pr.id, l);
      drop(p, gone);
    },
    async project(p) {
      p.page.addProject(text('P'), { index: chance(0.5) ? 0 : null });
    },
    async rename(p) {
      const pr = pick(p.page.data.projects);
      if (pr) p.page.renameProject(pr.id, text('R'));
    },
    async moveProject(p) {
      const pr = pick(p.page.data.projects);
      if (pr) p.page.moveProject(pr.id, Math.floor(rand() * p.page.data.projects.length));
    },
    // A project with more fields than the account takes (a newer version's), or small again. Too large, it stays
    // here, and so do the notes that could only go up with it (5.5 step 5); the end makes every project small.
    async heavy(p) {
      const pr = pick(p.page.data.projects);
      if (pr) p.page.mutate((data) => resize(data.projects.find((x) => x.id === pr.id), !Object.hasOwn(pr, 'futureField0')));
    },
    async dropProject(p) {
      const pr = pick(p.page.data.projects);
      if (pr) dropColumn(p, pr.id);
    },
    // A note moved into a new project too large for the account: it waits here with it (5.5 step 5). With deletes, the
    // column it left is sometimes deleted at once: that deletion waits for the note (the account still has it there).
    async holdMove(p) {
      const x = pick(notes(p));
      if (!x || p.page.busy.editing === x.note.id) return;
      const pid = p.page.addProject(text('H'));
      p.page.mutate((data) => resize(data.projects.find((pr) => pr.id === pid), true));
      touch(x.note.id);
      p.page.moveNote(x.note.id, { project: pid, list: pick(LISTS) });
      if (deletes && chance(0.5)) dropColumn(p, x.project);
    },
    // The same with the note's own write refused for a while (held in quarantine until it is retried).
    async denyMove(p) {
      const x = pick(notes(p));
      const to = pick(p.page.data.projects.filter((pr) => pr.id !== x?.project));
      if (!x || !to || p.page.busy.editing === x.note.id) return;
      const undo = mock.denyDoc(`users/${uid}/notes/${codec.docId(x.note.id)}`);
      time.setTimeout(undo, Math.floor(rand() * 60000));
      touch(x.note.id);
      p.page.moveNote(x.note.id, { project: to.id, list: pick(LISTS) });
      if (deletes && chance(0.5)) dropColumn(p, x.project);
    },
    async copy(p) {
      const x = pick(notes(p));
      if (!x) return;
      const n = 1 + Math.floor(rand() * 3);
      p.page.copy(x.note.id, n);
      made.set(x.note.id, (made.get(x.note.id) || 0) + n);
    },
    async highlight(p) {
      const x = pick(notes(p));
      if (!x) return;
      touch(x.note.id);
      p.page.highlight(x.note.id, pick(['amber', 'rose', null]));
    },
    async joiner(p) {
      p.page.setJoiner(pick(['blank', 'line']));
    },
    async picture(p) {
      const x = pick(notes(p));
      if (!x || !chance(0.3) || p.page.busy.editing === x.note.id) return;
      touch(x.note.id);
      const id = p.page.addPicture(x.note.id, pngBytes(600 + Math.floor(rand() * 3000), serial++));
      if (chance(0.3)) { // refused while it goes up (a rules deploy): the note goes without it, the picture later
        const undo = [true, false].map((thumb) => mock.denyDoc(`users/${uid}/images/${id}${thumb ? '.t' : ''}.png`));
        time.setTimeout(() => undo.forEach((u) => u()), Math.floor(rand() * 20000));
      }
    },
    async editor(p) {
      if (p.page.busy.editing) {
        const id = p.page.busy.editing;
        const at = p.page.findNote(id);
        if (at && chance(0.6)) {
          superseded.add(at.note.text);
          touch(id);
          p.page.closeEditor(`${at.note.text.split(' ~')[0]} ~${++serial}`);
        } else {
          p.page.closeEditor(null);
        }
      } else {
        const x = pick(notes(p));
        if (x) p.page.openEditor(x.note.id);
      }
    },
    async offline(p) {
      p.setOnline(!p.online);
    },
    async crash(p) {
      let n = 1 + Math.floor(rand() * 12);
      p.onCall = (phase) => {
        if (phase === 'before' && --n <= 0) {
          p.onCall = null;
          say(`${p.name} crashed`);
          union(p);
          p.kill();
        }
      };
    },
    async restart(p) {
      p.onCall = null;
      if (p.page.busy.editing) p.page.closeEditor(null);
      if (exact) await p.quit();
      else p.kill();
      union(p);
      await p.boot();
    },
    // A page reload (5.6 step 8): whatever the page saved is written first.
    async reload(p) {
      if (p.page.busy.editing) p.page.closeEditor(null);
      p.reload();
    },
    async backup(p) {
      p.main.flushData();
      const id = p.backups.create('manual');
      if (id) backupsOf.set(p.name, [...(backupsOf.get(p.name) || []), id]);
    },
    // Restoring an older backup while signed in is a union (5.12). Changes not yet uploaded go with the
    // board they were made on, so without deletes only a computer with nothing waiting restores.
    async restore(p) {
      const id = pick(backupsOf.get(p.name) || []);
      if (!id || p.page.busy.editing) return;
      if (!deletes) {
        p.main.flushData();
        if (!p.online || !p.engine || !signedIn(p)) return;
        await p.syncNow();
        if (p.engine.hasUnpushed() || p.page.pendingPatch) return;
        const only = p.engine.localOnly(); // a board that never went up (a first sync not done) is all here
        if (p.engine.debug().mode === 'first' || only.notes || only.projects) return;
      }
      // Restoring puts the backup's texts back over newer ones here (5.7, restore mode): those are replaced.
      const older = new Map();
      for (const pr of p.backups.readData(id).projects || []) for (const l of LISTS) for (const n of pr[l] || []) older.set(n.id, n.text);
      for (const x of notes(p)) if (older.has(x.note.id) && older.get(x.note.id) !== x.note.text) superseded.add(x.note.text);
      restores.push({ step, ids: new Set(older.keys()), peer: p.name, ended: null });
      union(p);
      p.restoreBackup(id);
    },
    // Signing out with "Also remove this board" (5.14): refused while anything exists only here. The page then
    // starts over on a Welcome seed, whose tips the next sign-in replaces on purpose.
    async removeBoard(p) {
      if (!p.engine || !signedIn(p)) return;
      if (p.page.busy.editing) p.page.closeEditor(null);
      const res = await p.signOut({ removeBoard: true });
      if (!res.ok) return;
      say(`${p.name} signed out and removed its board`);
      for (const t of TIPS) superseded.add(t);
      backupsOf.set(p.name, []);
    },
    // Signing out keeps the board (5.14); what changes meanwhile goes up at the next sign-in, a union.
    async account(p) {
      if (p.engine) {
        if (p.page.busy.editing) p.page.closeEditor(null);
        const res = await p.signOut({ force: true });
        if (res.ok) say(`${p.name} signed out`);
      } else if (p.account.state().status !== 'signed-in') {
        union(p);
        const res = await p.signIn(EMAIL, PASSWORD);
        if (res.ok) say(`${p.name} signed in`);
      }
    },
    async sync(p) {
      const how = pick(['now', 'focus', 'blur', 'summon']);
      if (how === 'now') await p.syncNow();
      else if (how === 'focus') p.focus();
      else if (how === 'blur') p.blur();
      else p.summon();
    },
    // Two computers edit and push at the same moment: one of them loses the precondition race.
    async race(p) {
      const q = pick(peers.filter((x) => x !== p && x.alive));
      if (!q) return;
      for (const x of [p, q]) {
        const n = pick(notes(x));
        if (n && x.page.busy.editing !== n.note.id) edit(x, n.note.id, `${n.note.text.split(' ~')[0]} ~${++serial}`);
        x.main.flushData();
      }
      await Promise.all([p.syncNow(), q.syncNow()]);
    },
    // The network or the service misbehaves for a moment.
    async fault(p) {
      const kind = pick(['lost', 'lost', 'lost503', '503', 'deny', 'picture', 'project']);
      if (kind === 'lost') mock.fail({ service: 'firestore', op: 'commit', status: 'offline', lost: true, times: 1 });
      else if (kind === 'lost503') mock.fail({ service: 'firestore', op: 'commit', status: 503, lost: true, times: 1 }); // landed, then 503
      else if (kind === '503') mock.fail({ service: pick(['firestore', 'storage']), status: 503, times: 1 + Math.floor(rand() * 3) });
      else if (kind === 'deny') {
        const x = pick(notes(p));
        if (!x) return;
        const undo = mock.denyDoc(`users/${uid}/notes/${codec.docId(x.note.id)}`);
        time.setTimeout(undo, Math.floor(rand() * 6000));
      } else if (kind === 'project') { // a new project refused for a while: the note made in it waits here with it
        const pid = p.page.addProject(text('P'));
        const undo = mock.denyDoc(`users/${uid}/projects/${codec.docId(pid)}`);
        p.page.addNote(pid, text('n'));
        time.setTimeout(undo, Math.floor(rand() * 20000));
      } else { // a picture's files refused for a while (a rules deploy)
        const ids = notes(p).flatMap((x) => (x.note.images || []).map((i) => i.id));
        const id = pick(ids) || p.newId().replace(/-/g, '');
        const undo = [true, false].map((thumb) => mock.denyDoc(`users/${uid}/images/${id}${thumb ? '.t' : ''}.png`));
        time.setTimeout(() => undo.forEach((u) => u()), Math.floor(rand() * 20000));
      }
    },
  };
  const weights = [
    ['add', 10], ['edit', 8], ['whole', 4], ['move', 5], ['reorder', 4], ['sort', 1], ['project', 2], ['rename', 2],
    ['moveProject', 1], ['copy', 5], ['highlight', 3], ['joiner', 1], ['picture', 1], ['editor', 4], ['offline', 2],
    ['restart', 1], ['reload', 1], ['backup', 1], ['restore', 1], ['account', 1], ['removeBoard', 1], ['sync', 10], ['race', 4],
    ['fault', 2], ['heavy', 1], ['holdMove', 1], ['denyMove', 1],
    ...(exact ? [] : [['crash', 3]]),
    ...(deletes ? [['remove', 5], ['clear', 1], ['dropProject', 1]] : []),
  ];
  const total = weights.reduce((n, [, k]) => n + k, 0);
  const choose = () => {
    let r = rand() * total;
    for (const [name, k] of weights) if ((r -= k) < 0) return name;
    return weights[0][0];
  };

  // A computer that removed its board and signed in again is asked the first-sync question (5.9).
  const answerFirst = () => {
    for (const p of peers) {
      if (!p.alive || !p.engine) continue;
      const kind = p.choice()?.kind;
      if (kind !== 'first-merge' && kind !== 'first-upload') continue;
      const answer = kind === 'first-upload' ? 'upload' : deletes && chance(0.3) ? 'use-account' : 'combine';
      say(`${p.name} answers ${answer}`);
      p.choose(answer);
    }
  };

  // A restore is in effect until its merge is on disk (the computer's mode leaves 'restore'), signed out or not.
  const restoreEnds = () => {
    for (const x of restores) {
      if (x.ended !== null) continue;
      const q = peers.find((y) => y.name === x.peer);
      const mode = q.alive && q.engine ? q.engine.debug().mode : (q.readState()?.mode ?? null);
      if (mode !== 'restore') x.ended = step;
    }
  };

  // What each computer holds back (moved into a project the account doesn't have, refused, too large).
  const holding = () => {
    for (const p of peers) {
      if (!p.alive || !p.engine) continue;
      for (const id of p.engine.debug().held ?? []) heldSeen.set(`${id}|${p.name}`, step);
    }
  };

  // After every step: no live note in a deleted or missing project in the account.
  const housed = (when) => {
    const bad = homeless(cloudOf(mock, uid));
    if (bad.length) assert.fail(`${when} ${step}: the account holds live notes in a deleted or missing project (${bad.join(', ')}) — seed ${seed}; last steps:\n${log.join('\n')}`);
  };

  // A labelled delete has landed once the account holds its tombstone.
  const landing = () => {
    const open = deleted.filter((d) => d.landed === null);
    if (!open.length) return;
    const cloud = cloudOf(mock, uid);
    for (const d of open) if (cloud.notes[d.id]?._sync.deleted) d.landed = step;
  };

  for (step = 1; step <= steps; step++) {
    const p = pick(peers);
    if (!p.alive) {
      p.onCall = null;
      union(p);
      await p.boot();
      say(`${p.name} restarted`);
    }
    // A restore's page loads the restored file 50 ms later; main drops what the old page saves meanwhile, and
    // nobody acts in that moment. Work already under way does go on.
    if (p.main.restoring) await time.advance(60);
    const name = choose();
    say(`${step} ${p.name} ${name}`);
    try {
      if (p.alive) await ops[name](p);
    } catch (err) {
      if (!/isn't running/.test(err?.message) && err?.name !== 'Dead') throw err; // a crash armed earlier hit mid-step
    }
    await time.advance(Math.floor(rand() * (chance(0.1) ? 20000 : 1500)));
    landing();
    answerFirst();
    restoreEnds();
    holding();
    housed('step');
  }

  // Quiescence: no more faults, everyone back, signed in, online, editors closed, refusals retried; then
  // sync until all agree.
  mock.fail(null);
  await time.advance(30000);
  for (const p of peers) {
    p.onCall = null;
    if (!p.alive) {
      union(p);
      await p.boot();
    }
    if (!p.engine) {
      union(p);
      await p.signIn(EMAIL, PASSWORD);
    }
    p.setOnline(true);
    if (p.page.busy.editing) p.page.closeEditor(null);
    if (p.page.data.projects.some((pr) => Object.hasOwn(pr, 'futureField0'))) p.page.mutate((data) => data.projects.forEach((pr) => resize(pr, false)));
    p.retry();
  }
  for (let round = 0; round < 12; round++) {
    for (const p of peers) {
      p.blur();
      p.focus();
      await p.syncNow();
      await settle(peers, time);
      landing();
      answerFirst();
      restoreEnds();
      holding();
      housed('quiescence round');
    }
    const views = peers.map((p) => JSON.stringify(view(p.board())));
    if (views.every((v) => v === views[0]) && peers.every((p) => p.status().pending === 0 && p.status().quarantined === 0)) break;
    for (const p of peers) p.retry();
  }
  return { peers, mock, uid, superseded, made, deleted, touched, unions, restores, heldSeen, log };
}

function check(seed, { deletes, exact }, r) {
  const { peers, mock, uid, superseded, log } = r;
  const where = `seed ${seed}${exact ? ' (exact)' : deletes ? '' : ' (no deletes)'}; last steps:\n${log.join('\n')}`;
  const [A] = peers;
  for (const p of peers) {
    assert.equal(p.choice(), null, `${p.name} is asked something: ${JSON.stringify(p.choice())} — ${where}`);
    assert.equal(p.status().pending, 0, `${p.name} pending — ${where}`);
    assert.equal(p.status().quarantined, 0, `${p.name} holds something back — ${where}`);
  }
  const views = peers.map((p) => view(p.board()));
  for (let i = 1; i < peers.length; i++) assert.deepEqual(views[i], views[0], `${peers[i].name} differs from A — ${where}`);
  const cloud = cloudOf(mock, uid);
  for (const p of peers) {
    const shadow = p.readShadow();
    assert.equal(shadow.rev, cloud.head.rev, `${p.name} shadow rev — ${where}`);
    for (const kind of ['projects', 'notes']) {
      assert.deepEqual(Object.keys(shadow[kind]).sort(), Object.keys(cloud[kind]).sort(), `${p.name} ${kind} — ${where}`);
      for (const [id, e] of Object.entries(shadow[kind])) {
        const d = cloud[kind][id];
        assert.deepEqual([e.d, e.r, e.k], [d._sync.deleted, d._sync.rev, d._sync.key], `${p.name} ${kind} ${id} — ${where}`);
      }
    }
    const ids = [];
    for (const pr of p.board().projects) {
      ids.push(pr.id);
      for (const l of LISTS) for (const n of pr[l]) ids.push(n.id);
    }
    assert.equal(new Set(ids).size, ids.length, `${p.name} duplicate ids — ${where}`);
  }
  // The account: every live note in a live project, its pictures there too, and the board the computers show.
  const objects = mock.objects(uid);
  for (const [id, n] of Object.entries(cloud.notes)) {
    if (n._sync.deleted) continue;
    assert.ok(cloud.projects[n._sync.project] && !cloud.projects[n._sync.project]._sync.deleted, `note ${id} in a missing project — ${where}`);
    for (const i of n.images || []) {
      for (const suffix of ['.png', '.t.png']) assert.ok(objects[`users/${uid}/images/${i.id}${suffix}`], `picture ${i.id}${suffix} of note ${id} isn't in the account — ${where}`);
    }
  }
  const liveNotes = Object.values(cloud.notes).filter((n) => !n._sync.deleted).length;
  assert.equal(liveNotes, Object.keys(views[0].notes).length, `the account and the computers — ${where}`);
  if (deletes) {
    // A delete made with its undo label stays made. What may rightly bring it back (5.7, 5.10, 5.12): a
    // content change made elsewhere (KEPT_NOTE: then it comes back with that content); a union (a crash, a
    // restore, a sign-in) on the deleting computer before its tombstone landed; a union anywhere after it for
    // a note somebody moved or highlighted (a union keeps a local version that differs from the base); a
    // restore of a backup that holds the note, made after it, or before it and not yet merged when it was made
    // (5.7's restore row keeps and undeletes); and a version of it another computer held back from the account
    // then (moved into a project the account doesn't have, refused, too large), which a delete never removes (another
    // computer: the one that deleted it no longer has it to hold).
    let checked = 0;
    const unionAfter = (name, from, to = Infinity) => (r.unions.get(name) || []).some((u) => u > from && u <= to);
    const anyUnionAfter = (from) => [...r.unions.keys()].some((name) => unionAfter(name, from));
    const final = new Map(A.page.notes().map((x) => [x.note.id, JSON.stringify([x.note.text, (x.note.images || []).map((i) => i.id)])]));
    for (const d of r.deleted) {
      if (r.restores.some((x) => x.ids.has(d.id) && (x.step >= d.step || x.ended === null || x.ended >= d.step))) continue;
      if (unionAfter(d.peer, d.step - 1, d.landed ?? Infinity)) continue;
      if (r.touched.has(d.id) && anyUnionAfter(d.step - 1)) continue;
      if (peers.some((q) => q.name !== d.peer && (r.heldSeen.get(`${d.id}|${q.name}`) ?? -Infinity) >= d.step - 1)) continue;
      checked++;
      if (!final.has(d.id) || final.get(d.id) !== d.content) continue; // still deleted, or kept for a change made elsewhere
      assert.fail(`note ${d.id}, deleted on ${d.peer} at step ${d.step}, is back unchanged — ${where}`);
    }
    return { checked };
  }
  const shown = new Set(A.page.notes().map((x) => x.note.text));
  for (const p of peers) {
    for (const board of p.saved) {
      for (const pr of board.projects) {
        for (const l of LISTS) {
          for (const n of pr[l]) {
            if (!superseded.has(n.text)) assert.ok(shown.has(n.text), `"${n.text}" saved on ${p.name} is gone — ${where}`);
          }
        }
      }
    }
  }
  if (exact) {
    // Every copy counted once: a note's count is what was copied of it, anywhere.
    for (const [id, n] of r.made) {
      const at = A.page.findNote(id);
      if (!at) continue; // replaced by a conflict copy's original? never deleted here: only a project drop could
      assert.equal(at.note.copied, n, `note ${id}: ${at.note.copied} copies counted, ${n} made — ${where}`);
    }
  }
  return {};
}

const seeds = (n) => (ONLY !== null ? [ONLY] : Array.from({ length: n }, (_, i) => i + 1 + OFFSET));

test(`three computers, random steps with deletes (${seeds(SEEDS).length} seeds × ${STEPS} steps): they converge, and deletes hold`, async () => {
  let checked = 0;
  for (const seed of seeds(SEEDS)) checked += check(seed, { deletes: true }, await run(seed, { steps: STEPS, deletes: true })).checked;
  assert.ok(checked > 0, 'some deletes were checked');
});

test(`three computers, random steps without deletes (${seeds(SEEDS).length} seeds × ${STEPS} steps): no text is ever lost`, async () => {
  for (const seed of seeds(SEEDS)) check(seed + 1000, { deletes: false }, await run(seed + 1000, { steps: STEPS, deletes: false }));
});

test(`three computers, no deletes and no crashes (${seeds(EXACT_SEEDS).length} seeds × ${STEPS} steps): every copy is counted exactly once`, async () => {
  for (const seed of seeds(EXACT_SEEDS)) check(seed + 2000, { deletes: false, exact: true }, await run(seed + 2000, { steps: STEPS, deletes: false, exact: true }));
});
