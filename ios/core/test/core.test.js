'use strict';
// The iPhone core end to end, in a bare vm context like JavaScriptCore: the bundle (ios/core/build.js)
// with the bridge in Node, signed in against the local mock of Google Cloud, next to a desktop
// (tests/support/peer.js) syncing the same account. Real timers, fast sync timings. Never the real cloud.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGcpMock } = require('../../../tests/mock-gcp');
const { createPeer } = require('../../../tests/support/peer');
const { loadCore } = require('./node-native');

const EMAIL = 'owner@example.com';
const PASSWORD = 'password-1234';
const BASE = 'http://127.0.0.1:9';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-ios-core-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
}

function startPhone(dir, mock, logs = []) {
  const events = { board: null, account: null, toasts: [] };
  const phone = loadCore({
    fetchImpl: mock.fetch,
    onEvent: (event, value) => {
      if (event === 'board') events.board = value;
      else if (event === 'account') events.account = value;
      else if (event === 'toast') events.toasts.push(value.text);
    },
    log: (level, text) => logs.push(`${level} ${text}`),
  });
  const res = JSON.parse(phone.core.init(JSON.stringify({
    dataDir: dir,
    appVersion: '1.0.0',
    packaged: false,
    env: { RECALLER_GCP_BASE: BASE, RECALLER_SYNC_FAST: '1', RECALLER_TOKEN_STORE: 'secure' },
    deviceName: 'this iPhone',
  })));
  assert.equal(res.ok, true, JSON.stringify(res));
  const act = (name, ...args) => JSON.parse(phone.core.act(name, JSON.stringify(args)));
  const account = async (op, payload) => JSON.parse(await phone.core.account(op, payload === undefined ? undefined : JSON.stringify(payload)));
  const data = () => JSON.parse(phone.core.debug()).data;
  const quiet = async () => {
    const s = await account('get');
    const d = JSON.parse(phone.core.debug());
    return s?.sync?.phase === 'synced' && !d.pending && !d.patch;
  };
  return { ...phone, events, act, account, data, quiet, logs };
}

const projectNamed = (data, name) => data.projects.find((p) => p.name === name);

test('the iPhone core signs in, pulls the board, edits it, and keeps unknown fields', async () => {
  const mock = createGcpMock();
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });

  // The desktop has a board in the account already, with a field from a newer version.
  const desk = createPeer({ dir: path.join(root, 'desk'), fetchImpl: mock.fetch, base: BASE, name: 'desk', platform: 'darwin' });
  await desk.boot();
  const welcome = desk.page.data.projects[0];
  desk.page.deleteProject(welcome.id);
  const alpha = desk.page.addProject('Alpha');
  desk.page.data.projects[0].futureProjectField = { keep: true };
  const n1 = desk.page.addNote(alpha, 'first prompt', { fields: { futureNoteField: { n: 42, list: [1, 2.5, 'x'] } } });
  desk.page.addNote(alpha, 'second prompt');
  assert.equal((await desk.signIn(EMAIL, PASSWORD)).ok, true);
  // The first upload asks; answer it as the person would.
  await until('the desktop to upload', async () => {
    if (desk.choice()?.kind === 'first-upload') desk.choose('upload');
    return desk.status()?.phase === 'synced' && desk.quiet() && !desk.choice();
  });

  const logs = [];
  const phone = startPhone(path.join(root, 'phone'), mock, logs);
  try {
    assert.equal(JSON.parse(phone.core.view()).projects[0].name, 'Welcome'); // a fresh install's seed board
    const signIn = await phone.account('sign-in', { email: EMAIL, password: PASSWORD });
    assert.deepEqual(signIn, { ok: true });
    // A pristine Welcome board gives way to the account's board without asking.
    await until('the account board on the phone', async () => {
      const s = await phone.account('get');
      if (s?.choice) throw new Error(`asked: ${JSON.stringify(s.choice)}`);
      return projectNamed(phone.data(), 'Alpha') && (await phone.quiet());
    });
    const view = phone.events.board;
    const a = view.projects.find((p) => p.name === 'Alpha');
    assert.ok(a, JSON.stringify(view.projects.map((p) => p.name)));
    assert.deepEqual(a.notes.map((n) => n.text), ['first prompt', 'second prompt']);
    assert.equal(view.projects.some((p) => p.name === 'Welcome'), false);
    const state = await phone.account('get');
    assert.equal(state.state, 'signed-in');
    assert.equal(state.keyStore, 'keychain');

    // Edits on the phone: a new prompt, an edit of the note with the unknown field, Move to Cooked.
    const added = phone.act('addNote', a.id, 'from the iPhone');
    assert.equal(added.ok, true);
    assert.equal(phone.act('editNote', n1, 'first prompt, edited on the phone').ok, true);
    assert.equal(phone.act('moveToCooked', added.id).ok, true);
    await until('the phone to push', () => phone.quiet());

    await desk.syncNow();
    await until('the desktop to settle', async () => desk.quiet());
    const deskAlpha = projectNamed(desk.board(), 'Alpha');
    assert.deepEqual(deskAlpha.notes.map((n) => n.text), ['first prompt, edited on the phone', 'second prompt']);
    assert.deepEqual(deskAlpha.used.map((n) => n.text), ['from the iPhone']);
    assert.deepEqual(deskAlpha.notes[0].futureNoteField, { n: 42, list: [1, 2.5, 'x'] });
    assert.deepEqual(deskAlpha.futureProjectField, { keep: true });

    // The desktop changes something: it reaches the phone.
    desk.page.addNote(projectNamed(desk.page.data, 'Alpha').id, 'from the Mac');
    await until('the desktop to push', async () => desk.status()?.phase === 'synced' && desk.quiet());
    phone.core.lifecycle('background');
    phone.core.lifecycle('active'); // back to the front: pull now
    await until('the Mac note on the phone', () => projectNamed(phone.data(), 'Alpha').notes.some((n) => n.text === 'from the Mac'));

    // A deletion explained by its label goes through without the mass-delete question.
    const victim = projectNamed(phone.data(), 'Alpha').notes.find((n) => n.text === 'second prompt');
    assert.equal(phone.act('deleteNote', victim.id).ok, true);
    await until('the phone to push the delete', () => phone.quiet());
    assert.equal((await phone.account('get')).choice ?? null, null);
    await desk.syncNow();
    await until('the delete on the desktop', async () => desk.quiet() && !projectNamed(desk.board(), 'Alpha').notes.some((n) => n.text === 'second prompt'));
  } finally {
    phone.core.flush();
    phone.stop();
    desk.kill();
  }

  // The phone starts again from its folder: still signed in (the sealed token), same board.
  const again = startPhone(path.join(root, 'phone'), mock);
  try {
    await until('the saved sign-in', async () => (await again.account('get'))?.state === 'signed-in');
    assert.ok(projectNamed(again.data(), 'Alpha'));
    assert.deepEqual(projectNamed(again.data(), 'Alpha').futureProjectField, { keep: true });
    await until('a quiet start', () => again.quiet());
  } finally {
    again.stop();
  }
  const errors = logs.filter((l) => l.startsWith('error'));
  assert.deepEqual(errors, []);
});

test('signed out, the phone works on its own board and never reaches the network', async () => {
  let calls = 0;
  const mock = createGcpMock();
  const phone = loadCore({ fetchImpl: (...a) => { calls++; return mock.fetch(...a); }, onEvent: () => {} });
  try {
    JSON.parse(phone.core.init(JSON.stringify({ dataDir: path.join(root, 'solo'), appVersion: '1.0.0', packaged: false, env: { RECALLER_GCP_BASE: BASE } })));
    const act = (name, ...args) => JSON.parse(phone.core.act(name, JSON.stringify(args)));
    const p = act('addProject', 'Solo');
    assert.equal(p.ok, true);
    assert.equal(act('addNote', p.id, 'hello').ok, true);
    phone.core.flush();
    const disk = JSON.parse(fs.readFileSync(path.join(root, 'solo', 'recaller-data.json'), 'utf8'));
    assert.ok(disk.projects.some((x) => x.name === 'Solo' && x.notes[0].text === 'hello'));
    assert.equal(JSON.parse(await phone.core.account('get', undefined)).state, 'signed-out');
    await sleep(300);
    assert.equal(calls, 0);
  } finally {
    phone.stop();
  }
});
