'use strict';
// The account, in the main process (ai_memory/15, 3.3, 3.6, 5.13–5.15): sign-up, verification, sign-in,
// sign-out, deletion, and the ID token every Firestore and Storage request carries. Each operation answers
// with a Result the page can show ({ ok: true } or { ok: false, code }) and never throws. One runs at a time
// (another gets BUSY); five wrong passwords in ten minutes lock password sign-in for 30 s. The refresh token
// lives in the token store. Passwords go straight to Identity Toolkit: never kept, logged or written.

const { CloudError } = require('./http');

const REFRESH_EARLY_MS = 5 * 60 * 1000; // refresh this long before the ID token expires
const WRONG_WINDOW_MS = 10 * 60 * 1000;
const WRONG_LIMIT = 5;
const LOCKED_MS = 30 * 1000;
const RECENT_LOGIN_MS = 4 * 60 * 1000; // accounts:delete wants a sign-in from the last ~5 minutes
const RESET_WAIT_MS = 60 * 1000; // one reset link per email a minute ("Send link", "Change password"; 2.7)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVACY_VERSION = /^\d{4}-\d{2}-\d{2}$/;

// Refresh errors that end this computer's sign-in (5.13). The same TOKEN_EXPIRED from Identity Toolkit
// only means the ID token it was given is stale.
const SIGN_IN_ENDED = new Set(['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'PROJECT_NUMBER_MISMATCH']);
const STALE_ID_TOKEN = new Set(['INVALID_ID_TOKEN', 'TOKEN_EXPIRED']);
// What getIdToken() throws, by status, when there is no sign-in to refresh.
const NO_TOKEN = { 'needs-sign-in': 'TOKEN_EXPIRED', disabled: 'USER_DISABLED', deleted: 'USER_NOT_FOUND' };
// Operations whose Identity Toolkit calls are about the signed-in account itself.
const OWN = new Set(['resend', 'check', 'discard', 'reauth', 'delete']);

const codeOf = (err) => (typeof err?.code === 'string' ? err.code : '');
const ok = () => ({ ok: true });
const fail = (code) => ({ ok: false, code });

// Identity Toolkit, Secure Token and http.js codes → the page's ResultCode (3.6).
function resultCode(err, op = '') {
  const code = codeOf(err);
  if (code.includes('RECAPTCHA')) return op === 'reset' ? 'RESET_UNAVAILABLE' : 'UNAVAILABLE';
  switch (code) {
    case 'INVALID_EMAIL': case 'INVALID_IDENTIFIER': case 'MISSING_EMAIL':
      return 'INVALID_EMAIL';
    case 'WEAK_PASSWORD': case 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS': case 'MISSING_PASSWORD':
      return 'WEAK_PASSWORD';
    case 'EMAIL_EXISTS':
      return 'EMAIL_EXISTS';
    case 'INVALID_LOGIN_CREDENTIALS': case 'INVALID_PASSWORD': case 'EMAIL_NOT_FOUND':
      return 'WRONG_PASSWORD';
    case 'USER_NOT_FOUND':
      return op === 'sign-in' || op === 'reauth' ? 'WRONG_PASSWORD' : 'UNAVAILABLE';
    case 'USER_DISABLED':
      return 'USER_DISABLED';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER': case 'QUOTA_EXCEEDED': case 'QUOTA':
      return 'TOO_MANY_ATTEMPTS';
    case 'ADMIN_ONLY_OPERATION':
      return 'SIGNUP_PAUSED';
    case 'NETWORK': case 'TIMEOUT':
      return 'NETWORK';
    default: // OPERATION_NOT_ALLOWED, CONFIGURATION_NOT_FOUND, PERMISSION, BAD_REQUEST, SERVER, …
      return 'UNAVAILABLE';
  }
}

function emailOf(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const passwordOk = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 4096;

// state() → { status: 'signed-out' | 'unverified' | 'signed-in' | 'needs-sign-in' | 'deleted' | 'disabled',
//             uid?, email?, keyStore? }; onChange(state) runs whenever that changes.
function createAccount({ auth, tokens, config = null, onChange = null, now = Date.now, log = console } = {}) {
  if (!auth || !tokens) throw new TypeError('createAccount needs auth and tokens');
  const project = typeof config?.projectId === 'string' && config.projectId ? config.projectId : null;

  let status = 'signed-out';
  // { uid, email, emailVerified, refreshToken, idToken, expiresAt, keyStore, privacyVersion, signedInAt, authAt }
  let sess = null;
  let gen = 0; // moves on every change of account: answers that arrive later for an older one are dropped
  let refreshing = null; // the token refresh on its way (single flight)
  let busy = false; // an operation is running
  let checking = null; // the verification lookup on its way, shared by everyone who asks
  let savedUid = null; // whose sign-in account.json holds
  let wrong = []; // when recent wrong passwords were typed
  const resets = new Map(); // email (lower case) → when a reset link last went to it
  let shown = '';

  // ---- state

  function state() {
    if (!sess || status === 'signed-out') return { status: 'signed-out' };
    return { status, uid: sess.uid, email: sess.email, keyStore: sess.keyStore };
  }

  function emit() {
    const s = state();
    const key = JSON.stringify(s);
    if (key === shown) return;
    shown = key;
    if (typeof onChange !== 'function') return;
    try {
      onChange(s);
    } catch (err) {
      log.warn(`[account] onChange failed (${err?.name || 'Error'})`);
    }
  }

  function setStatus(next) {
    status = next;
    emit();
  }

  // The sign-in kept from the last run. No network call yet (5.3): the first getIdToken() checks it.
  let saved = null;
  try {
    saved = tokens.load();
  } catch (err) {
    log.warn(`[account] the saved sign-in couldn't be read (${err?.code || err?.name || 'Error'})`);
  }
  if (saved && typeof saved.uid === 'string' && saved.uid && (!project || saved.project === project)) {
    sess = {
      uid: saved.uid,
      email: typeof saved.email === 'string' ? saved.email : '',
      emailVerified: saved.emailVerified === true,
      refreshToken: typeof saved.refreshToken === 'string' && saved.refreshToken ? saved.refreshToken : null,
      idToken: null,
      expiresAt: 0,
      keyStore: saved.keyStore || 'session',
      privacyVersion: saved.privacyVersion || null,
      signedInAt: Number.isFinite(saved.signedInAt) ? saved.signedInAt : 0,
      authAt: 0,
    };
    savedUid = sess.uid;
    // Without a token (kept for the session only, or the sign-in ended): this computer asks to sign in again.
    if (!sess.refreshToken) status = 'needs-sign-in';
    else status = sess.emailVerified ? 'signed-in' : 'unverified';
  }
  shown = JSON.stringify(state());

  // ---- the sign-in on disk

  function persist(s) {
    try {
      const keyStore = tokens.save({
        uid: s.uid, email: s.email, emailVerified: s.emailVerified, refreshToken: s.refreshToken,
        project, privacyVersion: s.privacyVersion, signedInAt: s.signedInAt,
      });
      savedUid = s.uid;
      return keyStore || 'session';
    } catch (err) {
      log.warn(`[account] the sign-in couldn't be saved (${err?.code || err?.name || 'Error'}); it lasts for this session`);
      if (savedUid && savedUid !== s.uid) clearSaved(); // never leave another account's sign-in behind
      return 'session';
    }
  }

  function clearSaved() {
    try {
      tokens.clear();
      savedUid = null;
    } catch (err) {
      log.warn(`[account] account.json couldn't be removed (${err?.code || err?.name || 'Error'})`);
    }
  }

  // A password sign-in (sign-up, sign-in or re-authentication) becomes this computer's session.
  function install(s, privacyVersion) {
    if (typeof s?.uid !== 'string' || !s.uid) throw new CloudError('SERVER', { service: 'identity' });
    if (sess?.uid !== s.uid) gen++;
    refreshing = null;
    const t = now();
    sess = {
      uid: s.uid,
      email: s.email,
      emailVerified: s.emailVerified === true,
      refreshToken: s.refreshToken,
      idToken: s.idToken,
      expiresAt: s.expiresAt,
      keyStore: 'session',
      privacyVersion: typeof privacyVersion === 'string' && PRIVACY_VERSION.test(privacyVersion) ? privacyVersion : null,
      signedInAt: t,
      authAt: t, // for the recent-login rule of accounts:delete
    };
    sess.keyStore = persist(sess);
    setStatus(sess.emailVerified ? 'signed-in' : 'unverified');
  }

  function forgetNow() {
    gen++;
    refreshing = null;
    clearSaved();
    sess = null;
    setStatus('signed-out');
  }

  // ---- ID tokens

  function noToken() {
    return new CloudError(NO_TOKEN[status] || 'SIGNED_OUT', { service: 'token' });
  }

  // The refresh failed: some answers end the sign-in, though the board, shadow and state stay (5.13).
  function ended(err) {
    const code = codeOf(err);
    if (SIGN_IN_ENDED.has(code)) {
      sess.refreshToken = null;
      sess.idToken = null;
      persist(sess); // who was signed in stays, without the token: the next start asks to sign in again
      setStatus('needs-sign-in');
    } else if (code === 'USER_DISABLED') {
      sess.idToken = null;
      setStatus('disabled');
    } else if (code === 'USER_NOT_FOUND') {
      sess.idToken = null;
      setStatus('deleted');
    }
  }

  function refresh() {
    if (refreshing) return refreshing;
    const s = sess;
    const g = gen;
    const p = (async () => auth.refresh(s.refreshToken))().then((next) => {
      if (g !== gen) throw noToken(); // signed out, or another account, while this was on its way
      if (sess !== s) return next.idToken; // the same account signed in again meanwhile: still a good token
      if (next.uid && next.uid !== s.uid) throw new CloudError('SERVER', { service: 'token' });
      const verified = next.emailVerified === true;
      const changed = next.refreshToken !== s.refreshToken || verified !== s.emailVerified;
      s.idToken = next.idToken;
      s.expiresAt = next.expiresAt;
      s.refreshToken = next.refreshToken;
      s.emailVerified = verified;
      if (changed) s.keyStore = persist(s); // a rotated refresh token is sealed again
      setStatus(verified ? 'signed-in' : 'unverified');
      return next.idToken;
    }, (err) => {
      if (g !== gen) throw noToken();
      if (sess === s) ended(err);
      throw err;
    });
    refreshing = p;
    const done = () => {
      if (refreshing === p) refreshing = null;
    };
    p.then(done, done);
    return p;
  }

  // Single flight; refreshes 5 minutes before the ID token expires, or now with force (after a 401).
  function getIdToken({ force = false } = {}) {
    if (!sess?.refreshToken || (status !== 'signed-in' && status !== 'unverified')) return Promise.reject(noToken());
    if (!force && sess.idToken && now() < sess.expiresAt - REFRESH_EARLY_MS) return Promise.resolve(sess.idToken);
    return refresh();
  }

  // Identity Toolkit answers a stale or bad ID token with 400 INVALID_ID_TOKEN or TOKEN_EXPIRED, not a 401:
  // force a refresh and try once more.
  async function withIdToken(fn) {
    const token = await getIdToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err?.service !== 'identity' || !STALE_ID_TOKEN.has(codeOf(err))) throw err;
      return fn(await getIdToken({ force: true }));
    }
  }

  // ---- results

  function failFrom(err, op) {
    const code = codeOf(err);
    if (OWN.has(op) && sess && err?.service === 'identity') {
      if (code === 'USER_DISABLED') setStatus('disabled');
      else if (code === 'USER_NOT_FOUND' && op !== 'reauth') setStatus('deleted');
    }
    if (!(err instanceof CloudError)) log.warn(`[account] ${op} failed unexpectedly (${err?.name || 'Error'})`);
    return fail(resultCode(err, op));
  }

  // ---- the client's own throttle: 5 wrong passwords in 10 minutes lock password sign-in for 30 s

  function lockedFor() {
    const t = now();
    wrong = wrong.filter((at) => at <= t && t - at < WRONG_WINDOW_MS);
    if (wrong.length < WRONG_LIMIT) return 0;
    return Math.max(0, Math.min(LOCKED_MS, wrong[wrong.length - 1] + LOCKED_MS - t));
  }

  const lockedOut = (ms) => ({ ok: false, code: 'LOCKED_OUT', retryAfterMs: ms });

  function passwordFailure(err, op) {
    const res = failFrom(err, op);
    if (res.code !== 'WRONG_PASSWORD') return res;
    wrong.push(now());
    const wait = lockedFor();
    return wait ? lockedOut(wait) : res;
  }

  // ---- one operation at a time

  function exclusive(op, fn) {
    if (busy) return Promise.resolve(fail('BUSY'));
    busy = true;
    return (async () => {
      try {
        if (checking) await checking; // a verification lookup on its way finishes first
        return await fn();
      } catch (err) {
        return failFrom(err, op);
      } finally {
        busy = false;
      }
    })();
  }

  // ---- operations

  function signUp(email, password, privacyVersion = null) {
    return exclusive('sign-up', async () => {
      const address = emailOf(email);
      if (!address) return fail('INVALID_EMAIL');
      if (!passwordOk(password) || password.length < 8) return fail('WEAK_PASSWORD'); // no network call (6.6)
      let s;
      try {
        s = await auth.signUp(address, password);
      } catch (err) {
        return failFrom(err, 'sign-up');
      }
      install(s, privacyVersion);
      try {
        await withIdToken((token) => auth.sendVerification(token));
      } catch (err) {
        log.warn(`[account] the verification email wasn't sent (${codeOf(err) || err?.name}); Send again retries`);
      }
      return ok();
    });
  }

  function signIn(email, password) {
    return exclusive('sign-in', async () => {
      const address = emailOf(email);
      if (!address) return fail('INVALID_EMAIL');
      if (!passwordOk(password)) return fail('WRONG_PASSWORD');
      const wait = lockedFor();
      if (wait) return lockedOut(wait);
      let s;
      try {
        s = await auth.signIn(address, password);
      } catch (err) {
        return passwordFailure(err, 'sign-in');
      }
      wrong = [];
      install(s, sess?.uid === s.uid ? sess.privacyVersion : null);
      return ok();
    });
  }

  async function reauth(password) {
    if (!sess) return fail('UNAVAILABLE');
    if (!passwordOk(password)) return fail('WRONG_PASSWORD');
    const wait = lockedFor();
    if (wait) return lockedOut(wait);
    let s;
    try {
      s = await auth.signIn(sess.email, password);
    } catch (err) {
      return passwordFailure(err, 'reauth');
    }
    if (!sess || s.uid !== sess.uid) return fail('UNAVAILABLE'); // the email names another account now
    wrong = [];
    install(s, sess.privacyVersion);
    return ok();
  }

  // The same account signs in with its password again (same uid required).
  function reauthenticate(password) {
    return exclusive('reauth', () => reauth(password));
  }

  function resendVerification() {
    return exclusive('resend', async () => {
      if (status === 'signed-in') return ok(); // verified already
      if (status !== 'unverified') return fail('UNAVAILABLE');
      await withIdToken((token) => auth.sendVerification(token));
      return ok();
    });
  }

  async function lookupVerified() {
    try {
      if (status === 'signed-in') return { ok: true, verified: true };
      if (status !== 'unverified') return { ok: false, code: 'UNAVAILABLE', verified: false };
      const g = gen;
      const info = await withIdToken((token) => auth.lookup(token));
      if (g !== gen) return { ok: false, code: 'UNAVAILABLE', verified: false };
      if (info.disabled) {
        setStatus('disabled');
        return { ok: false, code: 'USER_DISABLED', verified: false };
      }
      if (!info.emailVerified) return { ok: true, verified: false };
      // A new ID token that carries email_verified: true (5.13), unless the one just refreshed already does.
      if (status !== 'signed-in') await getIdToken({ force: true });
      return { ok: true, verified: g === gen && status === 'signed-in' };
    } catch (err) {
      return { ...failFrom(err, 'check'), verified: false };
    }
  }

  // accounts:lookup → Result & { verified }. Callers share one lookup on its way, so a background check
  // (focus, a poll) never makes a click wait for BUSY; only another operation running does.
  function checkVerified() {
    if (busy) return Promise.resolve({ ok: false, code: 'BUSY', verified: false });
    if (!checking) {
      const p = lookupVerified();
      checking = p;
      p.then(() => {
        if (checking === p) checking = null;
      });
    }
    return checking;
  }

  // "Use a different email": deletes the unverified account while the sign-up is recent (accounts:delete wants a
  // sign-in from the last ~5 minutes; later, infra/scripts/purge-unverified.js removes it), then signs out here.
  function discardUnverified() {
    return exclusive('discard', async () => {
      if (status === 'signed-out') return ok();
      if (status !== 'unverified') return fail('UNAVAILABLE');
      try {
        const info = await withIdToken((token) => auth.lookup(token));
        // Verified meanwhile, perhaps already in use on another computer: it stays, and only this one signs out.
        if (!info.emailVerified) await withIdToken((token) => auth.deleteAccount(token));
      } catch (err) {
        const code = resultCode(err);
        if (code === 'NETWORK' || code === 'TOO_MANY_ATTEMPTS') return fail(code);
        // CREDENTIAL_TOO_OLD_LOGIN_AGAIN (signed up over ~5 minutes ago), USER_NOT_FOUND, …: an unverified
        // account holds no data (the rules refuse it any), and infra/scripts/purge-unverified.js removes it.
        log.warn(`[account] the unverified account is left for the clean-up (${codeOf(err) || err?.name})`);
      }
      forgetNow();
      return ok();
    });
  }

  function resetPassword(email) {
    return exclusive('reset', async () => {
      const address = emailOf(email);
      if (!address) return fail('INVALID_EMAIL');
      const key = address.toLowerCase();
      const t = now();
      for (const [k, at] of resets) if (!(at <= t && t - at < RESET_WAIT_MS)) resets.delete(k);
      if (resets.has(key)) return { ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs: resets.get(key) + RESET_WAIT_MS - t };
      try {
        await auth.sendPasswordReset(address);
      } catch (err) {
        // The answer never tells whether there's an account with this email (5.13).
        if (!['EMAIL_NOT_FOUND', 'USER_NOT_FOUND', 'USER_DISABLED'].includes(codeOf(err))) return failFrom(err, 'reset');
      }
      resets.set(key, now());
      return ok();
    });
  }

  // Forgets the sign-in here: account.json goes. The board and the sync folder are the caller's (5.14).
  function signOut() {
    return exclusive('sign-out', async () => {
      forgetNow();
      return ok();
    });
  }

  function forget() {
    forgetNow();
  }

  async function deleteSignIn() {
    try {
      await withIdToken((token) => auth.deleteAccount(token));
    } catch (err) {
      if (codeOf(err) !== 'USER_NOT_FOUND') throw err; // already gone: an earlier answer was lost
    }
  }

  // Account deletion, the account's side (5.15): re-authenticate (step 1), let eraseData() erase the data
  // (steps 2–6, the engine), delete the sign-in (7), then forget it here (8, account.json). accounts:delete
  // wants a sign-in from the last ~5 minutes and a big board takes longer to erase, so the same password,
  // held only by this call, signs in again right before step 7. CREDENTIAL_TOO_OLD_LOGIN_AGAIN never
  // reaches the page. onProgress({ what: 'account', done: 0, total: 1 }) marks step 7.
  function deleteAccount(password, { eraseData = null, onProgress = null } = {}) {
    return exclusive('delete', async () => {
      if (!sess) return fail('UNAVAILABLE');
      if (status === 'deleted') { // finished on the server already (8 didn't run here)
        forgetNow();
        return ok();
      }
      let res = await reauth(password);
      if (!res.ok) {
        // A wrong password, or an account deleted already (sign-in can't tell them apart): the token says which.
        if (res.code === 'WRONG_PASSWORD' && sess?.refreshToken) await getIdToken({ force: true }).catch(() => {});
        if (status === 'deleted') {
          forgetNow();
          return ok();
        }
        return res;
      }
      if (typeof eraseData === 'function') await eraseData();
      if (now() - sess.authAt > RECENT_LOGIN_MS) {
        res = await reauth(password);
        if (!res.ok) return res;
      }
      try {
        onProgress?.({ what: 'account', done: 0, total: 1 });
      } catch {}
      try {
        await deleteSignIn();
      } catch (err) {
        if (codeOf(err) !== 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw err;
        res = await reauth(password);
        if (!res.ok) return res;
        await deleteSignIn();
      }
      forgetNow();
      return ok();
    });
  }

  return {
    state,
    signUp,
    signIn,
    reauthenticate,
    resendVerification,
    checkVerified,
    discardUnverified,
    resetPassword,
    signOut,
    forget,
    deleteAccount,
    getIdToken,
    uid: () => sess?.uid ?? null,
    email: () => sess?.email ?? null,
    privacyVersion: () => sess?.privacyVersion ?? null,
  };
}

module.exports = { createAccount, resultCode };
