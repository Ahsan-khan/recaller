'use strict';
// The sign-in kept between runs, in sync/account.json (ai_memory/15, 3.3–3.5, D17). In 'secure' mode
// (packaged builds) the refresh token is sealed with Electron's safeStorage: the Mac's keychain or
// Windows DPAPI. Where sealing isn't possible the sign-in lasts for this session only and the token is
// never written; it is never stored as plain text. 'test-file' keeps it readable ({ testPlain }) for the
// loopback mock in a run from source, and 'memory', the default for runs from source, writes nothing and
// never touches the keychain. Nothing here logs a token or an email.

const fs = require('node:fs');
const path = require('node:path');
const store = require('../store');

const FILE = 'account.json';
const MODES = new Set(['secure', 'memory', 'test-file']);
const RM = { force: true, recursive: true, maxRetries: 3, retryDelay: 25 };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0;

// dir is the sync/ folder. project (or config.projectId) is the cloud project this build talks to: a file
// written for another project is ignored, never used. config and isPackaged, when given, also guard
// 'test-file' (loadConfig only picks it for the mock in a run from source; this checks again).
function createTokenStore({
  dir, safeStorage = null, mode = 'memory', platform = process.platform,
  project = null, config = null, isPackaged = false, now = Date.now, log = console,
} = {}) {
  let kind = MODES.has(mode) ? mode : 'memory';
  if (kind === 'test-file' && (isPackaged === true || (config && config.mock !== true))) {
    log.warn('[tokens] test-file storage is only for the loopback mock in a run from source; the sign-in stays in memory');
    kind = 'memory';
  }
  if (kind !== 'memory' && !text(dir)) throw new TypeError('createTokenStore needs the sync folder');
  const expected = text(project) ? project : text(config?.projectId) ? config.projectId : null;
  const file = kind === 'memory' ? null : path.join(dir, FILE);

  // Where a sealed token would live, or null when this computer can't seal one.
  function secureStore() {
    try {
      if (typeof safeStorage?.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) return null;
      // Linux without a keyring falls back to a fixed key ("basic_text"), which isn't secure storage.
      if (platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return null;
    } catch {
      return null;
    }
    return platform === 'win32' ? 'dpapi' : 'keychain';
  }

  function seal(token) {
    if (kind === 'test-file') return { refresh: { testPlain: token }, keyStore: 'test' };
    const keyStore = secureStore();
    if (keyStore) {
      try {
        const sealed = safeStorage.encryptString(token);
        if (sealed instanceof Uint8Array && sealed.length > 0) {
          return { refresh: { enc: Buffer.from(sealed).toString('base64') }, keyStore };
        }
      } catch {}
      log.warn("[tokens] the sign-in couldn't be sealed; it lasts for this session");
    }
    return { refresh: null, keyStore: 'session' };
  }

  // → { token, keyStore }; token is null when there is none this mode may use.
  function unseal(refresh) {
    const none = { token: null, keyStore: 'session' };
    if (!isObj(refresh)) return none;
    if (kind === 'test-file') return text(refresh.testPlain) ? { token: refresh.testPlain, keyStore: 'test' } : none;
    // secure: only a sealed token counts ({ testPlain } and { plain } are never trusted here).
    const keyStore = text(refresh.enc) ? secureStore() : null;
    if (!keyStore) return none;
    try {
      const token = safeStorage.decryptString(Buffer.from(refresh.enc, 'base64'));
      if (text(token)) return { token, keyStore };
    } catch {}
    log.warn("[tokens] the saved sign-in couldn't be unsealed; signing in again is needed");
    return none;
  }

  // → { uid, email, emailVerified, refreshToken | null, keyStore, project, privacyVersion, signedInAt } | null
  function load() {
    if (kind === 'memory') return null;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err?.code !== 'ENOENT') log.warn('[tokens] account.json is unreadable; ignoring it');
      return null;
    }
    if (!isObj(value) || !text(value.uid) || typeof value.email !== 'string') {
      log.warn('[tokens] account.json is malformed; ignoring it');
      return null;
    }
    if (expected && value.project !== expected) {
      log.warn('[tokens] account.json is for another cloud project; ignoring it');
      return null;
    }
    const { token, keyStore } = unseal(value.refresh);
    return {
      uid: value.uid,
      email: value.email,
      emailVerified: value.emailVerified === true,
      refreshToken: token,
      keyStore,
      project: text(value.project) ? value.project : null,
      privacyVersion: text(value.privacyVersion) ? value.privacyVersion : null,
      signedInAt: Number.isFinite(value.signedInAt) ? value.signedInAt : 0,
    };
  }

  // Writes account.json (atomically) and says where the token went: 'keychain' | 'dpapi' | 'session' | 'test'.
  // Without a refresh token (the sign-in ended), the file keeps only who was signed in.
  function save({
    uid, email, emailVerified = false, refreshToken = null, project: forProject = expected, privacyVersion = null, signedInAt,
  } = {}) {
    if (kind === 'memory') return 'session';
    if (!text(uid) || typeof email !== 'string') throw new TypeError('save() needs uid and email');
    const { refresh, keyStore } = text(refreshToken) ? seal(refreshToken) : { refresh: null, keyStore: 'session' };
    fs.mkdirSync(dir, { recursive: true });
    store.writeJsonAtomic(file, {
      version: 1,
      project: text(forProject) ? forProject : expected,
      uid,
      email,
      emailVerified: emailVerified === true,
      keyStore,
      refresh,
      privacyVersion: text(privacyVersion) ? privacyVersion : null,
      signedInAt: Number.isFinite(signedInAt) ? signedInAt : now(),
    });
    return keyStore;
  }

  // Removes account.json, and a temp file a crash may have left beside it.
  function clear() {
    if (kind === 'memory') return;
    fs.rmSync(file, RM);
    fs.rmSync(`${file}.tmp`, RM);
  }

  return { load, save, clear, mode: kind };
}

module.exports = { createTokenStore };
