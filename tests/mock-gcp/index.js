'use strict';
// An in-process mock of the Google services behind Recaller's accounts and sync (ai_memory/15, 7.2): Identity
// Toolkit, Secure Token, Cloud Firestore and Cloud Storage for Firebase, served on 127.0.0.1 only, with a
// JavaScript twin of the security rules on every read and write. It is deterministic: ids and tokens come
// from counters, and every time from one controllable clock (update times have microseconds).
//
//   const { createGcpMock } = require('../mock-gcp');
//   const mock = createGcpMock();                  // { projectId: 'demo-recaller', bucket: 'demo-recaller.test' }
//   await mock.listen();                           // → port; then process.env.RECALLER_GCP_BASE = mock.base
//   ...
//   await mock.close();
//
// Accounts:   verify(email), revokeTokens(email), expireIdTokens(), disableUser(email, on = true),
//             deleteUser(email), setSignupDisabled(on), requireRecaptchaForReset(on), tooManyAttemptsAfter(n),
//             createUser({ email, password = 'password-1234', verified }), signInAs(email) → { uid, idToken,
//             refreshToken }, user(email), users(). A call naming an unknown email throws.
//             revokeTokens() stops refreshes (TOKEN_EXPIRED); ID tokens already out keep working in Firestore
//             and Storage until they expire, as on the real service, so add expireIdTokens() to be noticed now.
// Failures:   fail({ service, status: 503 | 429 | 'offline', times = 1, op, skip, lost, partial }) → undo, fail(null)
//               service: 'identity' | 'token' | 'auth' | 'firestore' | 'storage' | '*'; op: a log op or a predicate;
//               skip: matching requests let through first; lost: processed, then the answer is lost.
//               'offline' breaks the connection after the answer's first bytes (so Chromium can't resend the
//               request by itself); reading the body then fails. mock.fetch throws a TypeError at once instead.
//               An unknown service or op throws (a misspelt one would never fail anything).
//             bumpHeadBetweenGetAndCommit({ uid, times, change(remote) }) → undo; the raced commit's log entry
//               is tagged 'bumped', or has an error when change() threw or didn't move the head
//             denyDoc(path, on = true) → undo: a Firestore document path, or a Storage object name
//             pauseAfter(step, { times }) → { hit: Promise<log entry>, resume() }; resume()
//               step: a log op ('commit', 'upload', …), a tag ('deleting', 'head-create', 'head-delete',
//               'uploaded', 'deleted') or a predicate on the log entry. The answer is held, the change is made.
//             skewMs; clock.now(), clock.set(ms), clock.advance(ms), clock.real(): set and advance hold the
//               clock at the new time (commit times still tick), real lets it run again
// The other:  remote(uid) → the other computer (_sync.by = 'b0'.repeat(16)). Each change is one precondition-checked
//             commit (head rev + 1, whole items, trash copies for deletes) → { rev, commitTime, id? }, or a thrown
//             MockError { status, code } where the rules refuse it:
//               addProject(name, { id, color, index, before, after, fields }), editProject(id, fields),
//               addNote(projectId, text, { id, list = 'notes', index, before, after, fields }), editNote(id, text, fields),
//               moveNote(id, { project, list, index, before, after }), copy(id, n = 1), deleteNote(id),
//               deleteProject(id) (its live notes too), setJoiner(joiner), touch(), createHead({ joiner }), head()
// Inspection: outbox [{ requestType, email, uid, oobCode, at }]; log [{ seq, method, path, auth (the scheme), service,
//             op, status, done, …what the service adds: doc, uid, rev, writes, tags, name, protocol, command, error }];
//             docs(uid) → { head, projects, notes, trash, devices, other }: decoded fields (timestamps as RFC 3339
//             text), collections keyed by document id; doc(path) → { fields, data, createTime, updateTime };
//             objects(uid) → { [name]: { size, contentType, md5Hash, bytes } }; writeDoc(path, data | null) and
//             writeObject(name, bytes | null) seed without rules ({ $ts: ms } is a timestamp); reset()
// Transport:  listen(port = 0), close(), port, address, base, env(), fetch(url, init) (the same mock without a
//             socket: same log, failures and pauses; 'offline' throws TypeError like fetch)

const crypto = require('node:crypto');
const { createFront } = require('./server');
const { createAuth } = require('./auth');
const { createFirestore, MockError, OTHER_DEVICE } = require('./firestore');
const { createStorage } = require('./storage');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Milliseconds from source (or a fixed time once set), shifted by skewMs. tick() gives strictly increasing
// microseconds for commit and update times.
function createClock(source) {
  let fixed = null;
  let skew = 0;
  let last = 0;
  const base = () => (fixed ?? source());
  return {
    now: () => base() + skew,
    set(ms) { fixed = Number(ms); },
    advance(ms) { fixed = base() + Number(ms); },
    real() { fixed = null; },
    get skewMs() { return skew; },
    set skewMs(ms) { skew = Number(ms) || 0; },
    tick() {
      last = Math.max(last + 1, Math.floor((base() + skew) * 1000) + 1);
      return last;
    },
    readMicros: () => Math.max(last, Math.floor((base() + skew) * 1000)),
    reset() {
      fixed = null;
      skew = 0;
      last = 0;
    },
  };
}

function createIds(seed) {
  const counters = new Map();
  const next = (kind) => {
    const n = (counters.get(kind) || 0) + 1;
    counters.set(kind, n);
    return n;
  };
  const digest = (text) => crypto.createHash('sha256').update(`${seed}\u0000${text}`).digest();
  return {
    // Firebase-like: 28 characters of [0-9A-Za-z]
    uid() {
      const h = digest(`uid:${next('uid')}`);
      let s = '';
      for (let i = 0; i < 28; i++) s += B62[h[i] % 62];
      return s;
    },
    uuid(kind = 'uuid') {
      const h = digest(`${kind}:${next(kind)}`);
      h[6] = (h[6] & 0x0f) | 0x40;
      h[8] = (h[8] & 0x3f) | 0x80;
      const x = h.toString('hex');
      return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
    },
    hex: (text, length) => digest(text).toString('hex').slice(0, length),
    reset() { counters.clear(); },
  };
}

function createGcpMock({
  projectId = 'demo-recaller', bucket = 'demo-recaller.test', apiKey = 'mock-key', now = Date.now, recentLoginMs = 5 * 60 * 1000,
} = {}) {
  const clock = createClock(now);
  const ids = createIds(`${projectId}/${bucket}`);
  const denied = new Set();
  const auth = createAuth({ projectId, apiKey, clock, ids, recentLoginMs });
  const firestore = createFirestore({ projectId, clock, ids, auth, denied });
  const storage = createStorage({ bucket, clock, ids, auth, firestore, denied });
  const front = createFront({
    clock,
    services: {
      identity: { handle: auth.identity, classify: auth.classify },
      token: { handle: auth.secureToken, classify: auth.classify },
      firestore: { handle: firestore.handle, classify: firestore.classify },
      storage: { handle: storage.handle, classify: storage.classify, partial: storage.partial },
    },
  });

  const docPath = (path) => {
    const s = String(path);
    const root = `projects/${projectId}/databases/(default)/documents/`;
    return s.startsWith(root) ? s.slice(root.length) : s.replace(/^\/+/, '');
  };

  const mock = {
    projectId,
    bucket,
    apiKey,
    otherDevice: OTHER_DEVICE,
    get port() { return front.port; },
    get address() { return front.address; },
    get base() { return front.port ? `http://127.0.0.1:${front.port}` : null; },
    listen: (port = 0) => front.listen(port),
    close: () => front.close(),
    fetch: front.fetch,
    // The environment a suite sets before require(APP_MAIN).
    env() {
      return { RECALLER_GCP_BASE: mock.base, RECALLER_GCP_PROJECT: projectId, RECALLER_GCP_BUCKET: bucket, RECALLER_GCP_API_KEY: apiKey };
    },

    ...auth.control,

    fail: front.fail,
    bumpHeadBetweenGetAndCommit: firestore.bumpHeadBetweenGetAndCommit,
    denyDoc(path, on = true) {
      const p = docPath(path);
      if (on) denied.add(p);
      else denied.delete(p);
      return () => denied.delete(p);
    },
    pauseAfter: front.pauseAfter,
    resume: front.resume,
    get skewMs() { return clock.skewMs; },
    set skewMs(ms) { clock.skewMs = ms; },
    clock: {
      now: () => clock.now(),
      set: (ms) => clock.set(ms),
      advance: (ms) => clock.advance(ms),
      real: () => clock.real(),
    },

    remote: (uid) => firestore.remote(uid),

    outbox: auth.outbox,
    log: front.log,
    docs: (uid) => firestore.docsOf(uid),
    doc: (path) => firestore.doc(docPath(path)),
    objects: (uid) => storage.objectsOf(uid),
    writeDoc: (path, data) => firestore.writeDoc(docPath(path), data),
    writeObject: (name, bytes, contentType) => storage.writeObject(name, bytes, contentType),
    reset() {
      front.reset();
      auth.reset();
      firestore.reset();
      storage.reset();
      denied.clear();
      ids.reset();
      clock.reset();
    },
  };
  return mock;
}

module.exports = { createGcpMock, MockError, OTHER_DEVICE };
