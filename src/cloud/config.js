'use strict';
// Where Recaller's cloud lives and whether accounts are on at all. Reads only
// the environment and project.json it is given (never Electron), so it runs
// under plain Node. Development and test overrides count only when the app
// isn't packaged, and a source run never uses the keychain unless asked.

const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const REAL = {
  identity: 'https://identitytoolkit.googleapis.com/v1',
  token: 'https://securetoken.googleapis.com/v1',
  firestore: 'https://firestore.googleapis.com/v1',
  storage: 'https://firebasestorage.googleapis.com/v0',
};
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})\/?$/;

// The same checks as scripts/cloud-config.js.
function validProject(p) {
  return Boolean(p) && typeof p === 'object'
    && typeof p.projectId === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p.projectId)
    && typeof p.apiKey === 'string' && /^AIza[0-9A-Za-z_-]{35}$/.test(p.apiKey)
    && ['storageBucket', 'authDomain', 'region'].every((k) => typeof p[k] === 'string' && p[k].trim().length > 0);
}

function readProject(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[cloud] project.json could not be read; accounts are off');
    return null; // a build without cloud config: no accounts
  }
  let value = null;
  try { value = JSON.parse(text); } catch {}
  if (validProject(value)) return value;
  console.warn('[cloud] project.json is invalid; accounts are off');
  return null;
}

// Only a loopback mock is accepted; the value itself is never printed.
function mockBase(value) {
  if (!value) return null;
  const m = LOOPBACK.exec(String(value).trim());
  const port = m ? Number(m[2]) : 0;
  if (port >= 1 && port <= 65535) return `http://${m[1]}:${port}`;
  console.warn('[cloud] RECALLER_GCP_BASE ignored: only http://127.0.0.1:PORT or http://localhost:PORT is allowed');
  return null;
}

function loadConfig({ env = process.env, isPackaged, projectFile = path.join(__dirname, 'project.json') } = {}) {
  const packaged = Boolean(isPackaged);
  const base = packaged ? null : mockBase(env.RECALLER_GCP_BASE);
  const mock = base !== null;
  const project = mock ? null : readProject(projectFile);

  let reason = 'ok';
  if (!mock && !project) reason = 'no-config';
  else if (env.RECALLER_DATA_DIR && !mock && (packaged || env.RECALLER_GCP_REAL !== '1')) reason = 'test-data-dir';

  const wanted = env.RECALLER_TOKEN_STORE;
  let tokenStore = 'memory';
  if (packaged) tokenStore = 'secure';
  else if (wanted === 'secure' || wanted === 'memory') tokenStore = wanted;
  else if (wanted === 'test-file' && mock) tokenStore = 'test-file';

  const projectId = mock ? env.RECALLER_GCP_PROJECT || 'demo-recaller' : project?.projectId || '';
  const config = {
    enabled: reason === 'ok',
    reason,
    projectId,
    apiKey: mock ? env.RECALLER_GCP_API_KEY || 'mock-key' : project?.apiKey || '',
    bucket: mock ? env.RECALLER_GCP_BUCKET || 'demo-recaller.test' : project?.storageBucket || '',
    authDomain: mock ? `${projectId}.firebaseapp.com` : project?.authDomain || '',
    region: mock ? 'us-east1' : project?.region || '',
    // The mock's first path segment names the service: `${base}/firestore.googleapis.com/v1`.
    endpoints: mock
      ? Object.fromEntries(Object.entries(REAL).map(([k, url]) => [k, url.replace('https://', `${base}/`)]))
      : { ...REAL },
    mock,
    tokenStore,
    fast: !packaged && env.RECALLER_SYNC_FAST === '1',
    offline: !packaged && env.RECALLER_SYNC_OFFLINE === '1',
  };
  // console.log(config) must never print the key.
  Object.defineProperty(config, inspect.custom, {
    value() { return { ...this, apiKey: this.apiKey ? '(hidden)' : '' }; },
  });
  return config;
}

module.exports = { loadConfig };
