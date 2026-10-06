'use strict';
// The GCP mock's Firebase Authentication on Identity Platform (ai_memory/15, 7.2): Identity Toolkit v1
// accounts:signUp, signInWithPassword, sendOobCode, lookup and delete, and Secure Token v1 /token, with users
// in memory. It behaves like the project's settings: email enumeration protection (INVALID_LOGIN_CREDENTIALS,
// silent resets for unknown emails), an 8-character password policy, and deletion only after a recent sign-in.
// ID tokens are JWT-shaped and unsigned ("alg": "none"). The mock accepts only tokens it issued, and an ID
// token's email_verified is fixed when it is issued. Firestore and Storage take any unexpired ID token (they
// don't check revocation), while Identity Toolkit also refuses revoked ones.

const crypto = require('node:crypto');
const { reply } = require('./server');

const TTL_S = 3600;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METHODS = ['signUp', 'signInWithPassword', 'sendOobCode', 'lookup', 'delete'];

class AuthError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code} : ${detail}` : code);
    this.code = code;
  }
}

const b64url = (text) => Buffer.from(text).toString('base64url');

function createAuth({ projectId, apiKey, clock, ids, recentLoginMs = 5 * 60 * 1000 }) {
  const projectNumber = String(100000000000 + (crypto.createHash('sha256').update(projectId).digest().readUInt32BE(0) % 899999999999));
  const users = new Map(); // uid → user
  const byEmail = new Map(); // lower-case email → uid
  const idTokens = new Map(); // token → { uid, email, verified, serial, exp, authTime }
  const refreshTokens = new Map(); // token → { uid, serial, authTime }
  const outbox = [];
  const state = { serial: 0, expiredThrough: 0, signupDisabled: false, recaptchaForReset: false, attemptsLeft: Infinity };

  const nowSec = () => Math.floor(clock.now() / 1000);
  const expired = (rec) => clock.now() >= rec.exp * 1000 || rec.serial <= state.expiredThrough;

  function issue(user, authTime) {
    const serial = ++state.serial;
    const iat = nowSec();
    const payload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      auth_time: authTime,
      user_id: user.uid,
      sub: user.uid,
      iat,
      exp: iat + TTL_S,
      email: user.email,
      email_verified: user.emailVerified,
      firebase: { identities: { email: [user.email] }, sign_in_provider: 'password' },
      mock_serial: serial,
    };
    const idToken = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.`;
    idTokens.set(idToken, { uid: user.uid, email: user.email, verified: user.emailVerified, serial, exp: iat + TTL_S, authTime });
    const refreshToken = `AMf-mock${serial}-${ids.hex(`refresh:${serial}`, 40)}`;
    refreshTokens.set(refreshToken, { uid: user.uid, serial, authTime });
    user.lastRefreshAt = clock.now();
    return { idToken, refreshToken };
  }

  function addUser(email, password, verified) {
    const now = clock.now();
    const user = {
      uid: ids.uid(), email, password, emailVerified: verified, disabled: false, createdAt: now, lastLoginAt: now,
      lastRefreshAt: now, passwordUpdatedAt: now, validSince: Math.floor(now / 1000), revokedThrough: 0,
    };
    users.set(user.uid, user);
    byEmail.set(email, user.uid);
    return user;
  }

  function removeUser(user) {
    users.delete(user.uid);
    byEmail.delete(user.email);
  }

  const find = (email) => users.get(byEmail.get(email)) ?? null;

  function need(email) {
    const user = find(String(email).toLowerCase());
    if (!user) throw new Error(`GCP mock: no user ${email}`);
    return user;
  }

  function attempt() {
    if (state.attemptsLeft <= 0) throw new AuthError('TOO_MANY_ATTEMPTS_TRY_LATER', 'Too many unsuccessful login attempts. Please try again later.');
    state.attemptsLeft -= 1;
  }

  function emailOf(v) {
    if (typeof v !== 'string' || !v) throw new AuthError('MISSING_EMAIL');
    const email = v.toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) throw new AuthError('INVALID_EMAIL');
    return email;
  }

  function checkPolicy(password) {
    const length = [...password].length;
    const missing = (rule) => new AuthError('PASSWORD_DOES_NOT_MEET_REQUIREMENTS', `Missing password requirements: [${rule}]`);
    if (length < 8) throw missing('Password must contain at least 8 characters');
    if (length > 4096) throw missing('Password may contain at most 4096 characters');
  }

  // An ID token sent to Identity Toolkit: it must be current, and its user must still exist.
  function checkIdToken(token) {
    if (typeof token !== 'string' || !token) throw new AuthError('MISSING_ID_TOKEN');
    const rec = idTokens.get(token);
    if (!rec) throw new AuthError('INVALID_ID_TOKEN');
    const user = users.get(rec.uid);
    if (!user) throw new AuthError('USER_NOT_FOUND');
    if (expired(rec) || rec.serial <= user.revokedThrough) throw new AuthError('INVALID_ID_TOKEN');
    return { rec, user };
  }

  function record(requestType, user) {
    outbox.push({ requestType, email: user.email, uid: user.uid, oobCode: ids.hex(`oob:${outbox.length}:${requestType}`, 32), at: clock.now() });
  }

  function info(user) {
    const out = {
      localId: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      passwordUpdatedAt: user.passwordUpdatedAt,
      providerUserInfo: [{ providerId: 'password', federatedId: user.email, email: user.email, rawId: user.email }],
      validSince: String(user.validSince),
      lastLoginAt: String(user.lastLoginAt),
      createdAt: String(user.createdAt),
      lastRefreshAt: new Date(user.lastRefreshAt).toISOString(),
    };
    if (user.disabled) out.disabled = true;
    return out;
  }

  const handlers = {
    signUp(body) {
      attempt();
      if (state.signupDisabled) throw new AuthError('ADMIN_ONLY_OPERATION');
      const email = emailOf(body.email);
      if (typeof body.password !== 'string' || !body.password) throw new AuthError('MISSING_PASSWORD');
      checkPolicy(body.password);
      if (find(email)) throw new AuthError('EMAIL_EXISTS');
      const user = addUser(email, body.password, false);
      const t = issue(user, nowSec());
      return {
        kind: 'identitytoolkit#SignupNewUserResponse', idToken: t.idToken, email, refreshToken: t.refreshToken,
        expiresIn: String(TTL_S), localId: user.uid,
      };
    },

    signInWithPassword(body) {
      attempt();
      const email = emailOf(body.email);
      if (typeof body.password !== 'string' || !body.password) throw new AuthError('MISSING_PASSWORD');
      const user = find(email);
      if (!user || user.password !== body.password) throw new AuthError('INVALID_LOGIN_CREDENTIALS');
      if (user.disabled) throw new AuthError('USER_DISABLED', 'The user account has been disabled by an administrator.');
      user.lastLoginAt = clock.now();
      const t = issue(user, nowSec());
      return {
        kind: 'identitytoolkit#VerifyPasswordResponse', localId: user.uid, email: user.email, displayName: '',
        idToken: t.idToken, registered: true, refreshToken: t.refreshToken, expiresIn: String(TTL_S),
      };
    },

    sendOobCode(body) {
      if (body.requestType === undefined) throw new AuthError('MISSING_REQ_TYPE');
      if (body.requestType === 'VERIFY_EMAIL') {
        attempt();
        const { user } = checkIdToken(body.idToken);
        if (user.disabled) throw new AuthError('USER_DISABLED');
        record('VERIFY_EMAIL', user);
        return { kind: 'identitytoolkit#GetOobConfirmationCodeResponse', email: user.email };
      }
      if (body.requestType === 'PASSWORD_RESET') {
        if (state.recaptchaForReset) throw new AuthError('MISSING_RECAPTCHA_TOKEN');
        attempt();
        const email = emailOf(body.email);
        const user = find(email);
        if (user && !user.disabled) record('PASSWORD_RESET', user); // an unknown email is a silent success
        return { kind: 'identitytoolkit#GetOobConfirmationCodeResponse', email };
      }
      throw new AuthError('INVALID_REQ_TYPE');
    },

    lookup(body) {
      const { user } = checkIdToken(body.idToken);
      return { kind: 'identitytoolkit#GetAccountInfoResponse', users: [info(user)] };
    },

    // Only the sign-in record goes; Firestore and Storage data stay, as on the real service.
    delete(body) {
      const { rec, user } = checkIdToken(body.idToken);
      if (user.disabled) throw new AuthError('USER_DISABLED');
      if (clock.now() - rec.authTime * 1000 > recentLoginMs) throw new AuthError('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
      removeUser(user);
      return { kind: 'identitytoolkit#DeleteAccountResponse' };
    },
  };

  function keyProblem(req) {
    const key = req.query.get('key') ?? req.headers['x-goog-api-key'];
    if (!key) {
      return reply(403, {
        error: {
          code: 403, status: 'PERMISSION_DENIED',
          message: "Method doesn't allow unregistered callers (callers without established identity). "
            + 'Please use API Key or other form of API consumer identity to call this API.',
        },
      });
    }
    if (key === apiKey) return null;
    const message = 'API key not valid. Please pass a valid API key.';
    return reply(400, {
      error: {
        code: 400, message, errors: [{ message, domain: 'global', reason: 'badRequest' }], status: 'INVALID_ARGUMENT',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
      },
    });
  }

  const notFound = () => reply(404, { error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
  const invalidJson = () => reply(400, { error: { code: 400, message: 'Invalid JSON payload received.', status: 'INVALID_ARGUMENT' } });

  function methodOf(req) {
    const m = /^\/identitytoolkit\.googleapis\.com\/v1\/accounts:([A-Za-z]+)$/.exec(req.pathname);
    return m && METHODS.includes(m[1]) ? m[1] : null;
  }

  function identity(req) {
    const method = methodOf(req);
    if (req.method !== 'POST' || !method) return notFound();
    const problem = keyProblem(req);
    if (problem) return problem;
    let body = null;
    try {
      body = req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    } catch {}
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidJson();
    try {
      return reply(200, handlers[method](body));
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return reply(400, { error: { code: 400, message: e.message, errors: [{ message: e.message, domain: 'global', reason: 'invalid' }] } });
    }
  }

  // Refresh grant; the answer carries a new refresh token (older ones keep working until revoked).
  function secureToken(req) {
    if (req.method !== 'POST' || req.pathname !== '/securetoken.googleapis.com/v1/token') return notFound();
    const problem = keyProblem(req);
    if (problem) return problem;
    const text = req.body.toString('utf8');
    let params;
    if (/json/i.test(req.headers['content-type'] || '')) {
      try {
        params = JSON.parse(text);
      } catch {}
      if (!params || typeof params !== 'object') return invalidJson();
    } else {
      params = Object.fromEntries(new URLSearchParams(text));
    }
    try {
      if (params.grant_type !== 'refresh_token') throw new AuthError('INVALID_GRANT_TYPE');
      if (typeof params.refresh_token !== 'string' || !params.refresh_token) throw new AuthError('MISSING_REFRESH_TOKEN');
      const rec = refreshTokens.get(params.refresh_token);
      if (!rec) throw new AuthError('INVALID_REFRESH_TOKEN');
      const user = users.get(rec.uid);
      if (!user) throw new AuthError('USER_NOT_FOUND');
      if (user.disabled) throw new AuthError('USER_DISABLED');
      if (rec.serial <= user.revokedThrough) throw new AuthError('TOKEN_EXPIRED');
      const t = issue(user, rec.authTime);
      return reply(200, {
        access_token: t.idToken, expires_in: String(TTL_S), token_type: 'Bearer', refresh_token: t.refreshToken,
        id_token: t.idToken, user_id: user.uid, project_id: projectNumber,
      });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return reply(400, { error: { code: 400, message: e.message, status: 'INVALID_ARGUMENT' } });
    }
  }

  // "Authorization: <scheme> <ID token>" for Firestore (Bearer) and Storage (Firebase) → { uid, verified, email }
  // for an unexpired token this mock issued, or null.
  function userFromHeader(header, scheme) {
    const m = typeof header === 'string' ? /^\s*(\S+)\s+(\S+)\s*$/.exec(header) : null;
    if (!m || m[1].toLowerCase() !== scheme.toLowerCase()) return null;
    const rec = idTokens.get(m[2]);
    if (!rec || expired(rec)) return null;
    return { uid: rec.uid, verified: rec.verified, email: rec.email };
  }

  const publicUser = (u) => ({ uid: u.uid, email: u.email, emailVerified: u.emailVerified, disabled: u.disabled, createdAt: u.createdAt });

  const control = {
    verify(email) { need(email).emailVerified = true; },
    // Like a password change elsewhere: refresh tokens issued so far fail with TOKEN_EXPIRED.
    revokeTokens(email) {
      const user = need(email);
      user.revokedThrough = state.serial;
      user.validSince = nowSec();
    },
    expireIdTokens() { state.expiredThrough = state.serial; },
    disableUser(email, disabled = true) { need(email).disabled = Boolean(disabled); },
    deleteUser(email) { removeUser(need(email)); },
    setSignupDisabled(disabled = true) { state.signupDisabled = Boolean(disabled); },
    requireRecaptchaForReset(required = true) { state.recaptchaForReset = Boolean(required); },
    // The next n sign-ups, sign-ins and emails go through; later ones get TOO_MANY_ATTEMPTS_TRY_LATER. null: no limit.
    tooManyAttemptsAfter(n) { state.attemptsLeft = n == null ? Infinity : Math.max(0, Number(n)); },
    createUser({ email, password = 'password-1234', verified = false } = {}) {
      const address = String(email).toLowerCase();
      if (find(address)) throw new Error(`GCP mock: ${email} exists`);
      return publicUser(addUser(address, password, Boolean(verified)));
    },
    // A fresh session, as a password sign-in would give it.
    signInAs(email) {
      const user = need(email);
      const t = issue(user, nowSec());
      return { uid: user.uid, idToken: t.idToken, refreshToken: t.refreshToken };
    },
    user(email) {
      const user = find(String(email).toLowerCase());
      return user ? publicUser(user) : null;
    },
    users: () => [...users.values()].map(publicUser),
  };

  function classify(req) {
    return { op: req.pathname.startsWith('/securetoken.') ? 'token' : methodOf(req) };
  }

  function reset() {
    users.clear();
    byEmail.clear();
    idTokens.clear();
    refreshTokens.clear();
    outbox.length = 0;
    Object.assign(state, { serial: 0, expiredThrough: 0, signupDisabled: false, recaptchaForReset: false, attemptsLeft: Infinity });
  }

  return { identity, secureToken, classify, userFromHeader, outbox, control, reset };
}

module.exports = { createAuth };
