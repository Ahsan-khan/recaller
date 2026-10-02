'use strict';
// JSON and byte requests to Google's REST APIs through an injected fetch
// (Electron's net.fetch in the app, Node's fetch in tests). Every failure
// becomes one CloudError. Nothing here logs: URLs carry the API key, and
// headers and bodies carry tokens, passwords and emails.

class CloudError extends Error {
  constructor(code, { status = 0, retryable = false, detail = '', service = '' } = {}) {
    super(`${service ? `${service}: ` : ''}${code}${status ? ` (HTTP ${status}${detail ? ` ${detail}` : ''})` : ''}`);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
    this.service = service;
  }
}

// Identity Toolkit and Secure Token put their code first in error.message: "EMAIL_EXISTS",
// "WEAK_PASSWORD : Password should be…", "PASSWORD_DOES_NOT_MEET_REQUIREMENTS:Missing…".
// Prose such as "API key not valid." isn't a code and falls through to the HTTP status.
const LEADING_CODE = /^([A-Z][A-Z0-9_]*)(?=\s*(?::|$))/;
const STATUS_WORDS = new Set([
  'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED',
  'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED',
  'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS',
]);
const SIZE_TEXT = /exceeds|too large/i;

function parseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return undefined;
  }
}

// Google's error body is { error: { code, message, status } }; streamed calls wrap it in an array.
function googleError(body) {
  const e = Array.isArray(body) ? body.find((x) => x && typeof x === 'object' && x.error)?.error : body?.error;
  if (!e || typeof e !== 'object') return { word: '', message: '' };
  const message = typeof e.message === 'string' ? e.message : '';
  let word = typeof e.status === 'string' && STATUS_WORDS.has(e.status) ? e.status : '';
  if (!word) {
    const m = LEADING_CODE.exec(message);
    if (m && STATUS_WORDS.has(m[1])) word = m[1];
  }
  return { word, message };
}

// Maps an HTTP failure to a CloudError. The message is read here and never kept.
function errorFrom(status, body, service = '') {
  const { word, message } = googleError(body);
  const info = { status, detail: word, service };
  if ((service === 'identity' || service === 'token') && status >= 400) {
    const m = LEADING_CODE.exec(message);
    if (m) return new CloudError(m[1], { ...info, retryable: status === 429 || status >= 500 });
  }
  if (status === 401) return new CloudError('UNAUTHENTICATED', info);
  if (status === 403) return new CloudError('PERMISSION', info);
  if (status === 404) return new CloudError('NOT_FOUND', info);
  if (service === 'firestore-commit'
    && ((status === 409 && word === 'ALREADY_EXISTS') || (status === 400 && word === 'FAILED_PRECONDITION'))) {
    return new CloudError('HEAD_MOVED', info);
  }
  if (status === 409) return new CloudError('ABORTED', { ...info, retryable: true });
  if (status === 413 || (status === 400 && (!word || word === 'INVALID_ARGUMENT') && SIZE_TEXT.test(message))) {
    return new CloudError('TOO_LARGE', info);
  }
  if (status === 400) return new CloudError('BAD_REQUEST', info);
  if (status === 429 || word === 'RESOURCE_EXHAUSTED') return new CloudError('QUOTA', { ...info, retryable: true });
  if (status >= 500 || word === 'UNAVAILABLE' || word === 'DEADLINE_EXCEEDED') {
    return new CloudError('SERVER', { ...info, retryable: true });
  }
  if (status === 408) return new CloudError('TIMEOUT', { ...info, retryable: true });
  return new CloudError('BAD_REQUEST', info);
}

// Calls fn(idToken); after a 401 it forces a fresh token and tries once more.
async function withToken(getIdToken, fn) {
  const token = await getIdToken({ force: false });
  try {
    return await fn(token);
  } catch (err) {
    if (err?.code !== 'UNAUTHENTICATED') throw err;
    return fn(await getIdToken({ force: true }));
  }
}

const hasHeader = (headers, name) => Object.keys(headers).some((k) => k.toLowerCase() === name);

function headerObject(headers) {
  const entries = [];
  headers?.forEach?.((value, name) => entries.push([String(name).toLowerCase(), String(value)]));
  return Object.fromEntries(entries);
}

function createHttp({ fetchImpl, now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createHttp needs fetchImpl');
  const offsets = []; // server clock minus ours, from the last 5 Date headers

  function noteClock(date, receivedAt) {
    const server = Date.parse(date || '');
    if (!Number.isFinite(server)) return;
    offsets.push(server - receivedAt);
    if (offsets.length > 5) offsets.shift();
  }

  async function send(url, { method, headers, body, timeoutMs, service }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 2 ** 31 - 1));
    let res;
    let receivedAt;
    let data;
    try {
      res = await fetchImpl(url, {
        method, headers, body, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      receivedAt = now();
      if (!(res?.status >= 100)) throw new Error('no response');
      data = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new CloudError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', { retryable: true, service });
    } finally {
      clearTimeout(timer);
    }
    const out = { status: res.status, headers: headerObject(res.headers), data };
    noteClock(out.headers.date, receivedAt);
    if (res.status >= 200 && res.status < 300) return out;
    throw errorFrom(res.status, parseJson(data), service);
  }

  const wait = (ms, fallback) => (Number.isFinite(ms) && ms > 0 ? ms : fallback);

  async function json(url, { method = 'GET', headers = {}, body, form, timeoutMs = 30000, service = '' } = {}) {
    const h = { ...headers };
    let payload;
    if (form !== undefined) {
      payload = new URLSearchParams(form).toString();
      if (!hasHeader(h, 'content-type')) h['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!hasHeader(h, 'content-type')) h['Content-Type'] = 'application/json';
    }
    const res = await send(url, { method, headers: h, body: payload, timeoutMs: wait(timeoutMs, 30000), service });
    let data = null;
    if (res.data.toString('utf8').trim()) {
      data = parseJson(res.data);
      if (data === undefined) throw new CloudError('SERVER', { status: res.status, retryable: true, service });
    }
    return { status: res.status, headers: res.headers, data };
  }

  function bytes(url, { method = 'GET', headers = {}, body, timeoutMs = 120000, service = '' } = {}) {
    return send(url, { method, headers: { ...headers }, body, timeoutMs: wait(timeoutMs, 120000), service });
  }

  function serverNow() {
    if (!offsets.length) return now();
    const s = [...offsets].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return now() + Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
  }

  return { json, bytes, serverNow, now };
}

module.exports = { CloudError, createHttp, errorFrom, withToken };
