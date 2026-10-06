'use strict';
// Firebase Authentication on Identity Platform over REST: Identity Toolkit v1
// for accounts, Secure Token v1 for refreshing. Stateless; account.js keeps the
// session. Passwords and tokens only ever travel in request bodies.

const { CloudError } = require('./http');

const DEFAULT_TTL_S = 3600;

// The JWT payload, decoded without verification (Google checks every token it receives).
function payload(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function claims(idToken) {
  const c = payload(idToken);
  const uid = typeof c?.user_id === 'string' ? c.user_id : typeof c?.sub === 'string' ? c.sub : null;
  return { user_id: uid, email_verified: c?.email_verified === true, exp: Number.isFinite(c?.exp) ? c.exp : 0 };
}

function createAuth({ http, endpoints, apiKey }) {
  const now = typeof http.now === 'function' ? http.now : Date.now;
  const key = `?key=${encodeURIComponent(apiKey)}`;

  async function identity(method, body) {
    const { data } = await http.json(`${endpoints.identity}/accounts:${method}${key}`, {
      method: 'POST', body, service: 'identity',
    });
    return data && typeof data === 'object' ? data : {};
  }

  // expiresAt is measured from when the answer arrived, on this computer's clock.
  function session({ uid, email, idToken, refreshToken, expiresIn }, service) {
    if (typeof idToken !== 'string' || !idToken || typeof refreshToken !== 'string' || !refreshToken) {
      throw new CloudError('SERVER', { service });
    }
    const c = payload(idToken) || {};
    const ttl = Number(expiresIn);
    return {
      uid: String(uid || c.user_id || c.sub || ''),
      email: String(email || c.email || ''),
      idToken,
      refreshToken,
      expiresAt: now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_S) * 1000,
      emailVerified: c.email_verified === true,
    };
  }

  async function passwordSession(method, email, password) {
    const d = await identity(method, { email, password, returnSecureToken: true });
    const { localId: uid, idToken, refreshToken, expiresIn } = d;
    return session({ uid, email: d.email || email, idToken, refreshToken, expiresIn }, 'identity');
  }

  const signUp = (email, password) => passwordSession('signUp', email, password);
  const signIn = (email, password) => passwordSession('signInWithPassword', email, password);

  async function refresh(refreshToken) {
    const { data } = await http.json(`${endpoints.token}/token${key}`, {
      method: 'POST', form: { grant_type: 'refresh_token', refresh_token: refreshToken }, service: 'token',
    });
    const d = data && typeof data === 'object' ? data : {};
    return session({
      uid: d.user_id, idToken: d.id_token, refreshToken: d.refresh_token || refreshToken, expiresIn: d.expires_in,
    }, 'token');
  }

  async function lookup(idToken) {
    const d = await identity('lookup', { idToken });
    const user = Array.isArray(d.users) ? d.users[0] : null;
    if (!user || typeof user !== 'object') throw new CloudError('USER_NOT_FOUND', { service: 'identity' });
    return {
      uid: String(user.localId || ''),
      email: String(user.email || ''),
      emailVerified: user.emailVerified === true,
      disabled: user.disabled === true,
    };
  }

  async function sendVerification(idToken) {
    await identity('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
  }

  async function sendPasswordReset(email) {
    await identity('sendOobCode', { requestType: 'PASSWORD_RESET', email });
  }

  async function deleteAccount(idToken) {
    await identity('delete', { idToken });
  }

  return { signUp, signIn, refresh, lookup, sendVerification, sendPasswordReset, deleteAccount, claims };
}

module.exports = { createAuth };
