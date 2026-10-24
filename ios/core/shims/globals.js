'use strict';
// The globals Node and Electron give src/ for free, installed on a bare JavaScriptCore context: console,
// timers, process, Buffer, structuredClone, AbortController, URL, URLSearchParams, Headers and fetch.
// Runs first in the bundle. Nothing here is used unless the host leaves it out.

const N = require('./native');
const { Buffer } = require('./buffer');

const G = globalThis;

// ---- console

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.code ? ` (${v.code})` : ''}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
const logAt = (level) => (...args) => {
  try {
    N.log(level, args.map(fmt).join(' '));
  } catch {}
};
G.console = { log: logAt('log'), info: logAt('info'), warn: logAt('warn'), error: logAt('error'), debug: logAt('debug') };

// ---- timers (the host calls __timerFire(id) on the context's own queue)

const timers = new Map();
let timerSerial = 0;
class Timeout {
  constructor(id) {
    this.id = id;
  }
  unref() {
    return this;
  }
  ref() {
    return this;
  }
  hasRef() {
    return true;
  }
  [Symbol.toPrimitive]() {
    return this.id;
  }
}
function schedule(fn, ms, args, repeat) {
  const id = ++timerSerial;
  const delay = Math.max(0, Math.min(Number(ms) || 0, 2 ** 31 - 1));
  timers.set(id, { fn, args, repeat: repeat ? Math.max(1, delay) : 0 });
  N.setTimer(id, delay);
  return new Timeout(id);
}
const idOf = (t) => (t instanceof Timeout ? t.id : Number(t));
function cancel(t) {
  const id = idOf(t);
  if (!timers.has(id)) return;
  timers.delete(id);
  N.clearTimer(id);
}
G.__timerFire = (id) => {
  const t = timers.get(id);
  if (!t) return;
  if (t.repeat) N.setTimer(id, t.repeat);
  else timers.delete(id);
  try {
    t.fn(...t.args);
  } catch (err) {
    G.console.error('[timer]', err);
  }
};
G.setTimeout = (fn, ms, ...args) => schedule(fn, ms, args, false);
G.setInterval = (fn, ms, ...args) => schedule(fn, ms, args, true);
G.setImmediate = (fn, ...args) => schedule(fn, 0, args, false);
G.clearTimeout = cancel;
G.clearInterval = cancel;
G.clearImmediate = cancel;
if (typeof G.queueMicrotask !== 'function') G.queueMicrotask = (fn) => Promise.resolve().then(fn);

// ---- process, Buffer

G.process = {
  platform: 'ios',
  env: {},
  versions: {},
  argv: [],
  cwd: () => '/',
  nextTick: (fn, ...args) => G.queueMicrotask(() => fn(...args)),
  on() {},
};
G.Buffer = Buffer;

// ---- structuredClone (the board is plain JSON data; Dates, Maps, Sets and typed arrays are kept too)

if (typeof G.structuredClone !== 'function') {
  G.structuredClone = function clone(v, seen = new Map()) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    let out;
    if (Array.isArray(v)) {
      out = [];
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) out[i] = clone(v[i], seen);
      return out;
    }
    if (v instanceof Date) return new Date(v.getTime());
    if (ArrayBuffer.isView(v)) return v.slice ? new v.constructor(v) : v;
    if (v instanceof Map) {
      out = new Map();
      seen.set(v, out);
      for (const [k, x] of v) out.set(clone(k, seen), clone(x, seen));
      return out;
    }
    if (v instanceof Set) {
      out = new Set();
      seen.set(v, out);
      for (const x of v) out.add(clone(x, seen));
      return out;
    }
    out = {};
    seen.set(v, out);
    for (const k of Object.keys(v)) {
      const x = clone(v[k], seen);
      if (k === '__proto__') Object.defineProperty(out, k, { value: x, enumerable: true, writable: true, configurable: true });
      else out[k] = x;
    }
    return out;
  };
}

// ---- TextEncoder / TextDecoder (UTF-8 only)

if (typeof G.TextEncoder !== 'function') {
  G.TextEncoder = class TextEncoder {
    get encoding() {
      return 'utf-8';
    }
    encode(s = '') {
      return N.utf8Encode(String(s));
    }
  };
  G.TextDecoder = class TextDecoder {
    decode(b) {
      return b ? N.utf8Decode(b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b)) : '';
    }
  };
}

// ---- AbortController

if (typeof G.AbortController !== 'function') {
  class AbortSignal {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = [];
    }
    addEventListener(type, fn) {
      if (type === 'abort') this._listeners.push(fn);
    }
    removeEventListener(type, fn) {
      this._listeners = this._listeners.filter((f) => f !== fn);
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason;
    }
  }
  G.AbortSignal = AbortSignal;
  G.AbortController = class AbortController {
    constructor() {
      this.signal = new AbortSignal();
    }
    abort(reason) {
      const s = this.signal;
      if (s.aborted) return;
      s.aborted = true;
      s.reason = reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      for (const fn of [...s._listeners, s.onabort].filter(Boolean)) {
        try {
          fn({ type: 'abort' });
        } catch {}
      }
    }
  };
}

// ---- URLSearchParams and a small URL (absolute http(s) URLs, and paths resolved against a base)

const formEncode = (s) => encodeURIComponent(s).replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
const formDecode = (s) => decodeURIComponent(s.replace(/\+/g, ' '));

if (typeof G.URLSearchParams !== 'function') {
  G.URLSearchParams = class URLSearchParams {
    constructor(init) {
      this._list = [];
      if (typeof init === 'string') {
        for (const part of init.replace(/^\?/, '').split('&')) {
          if (!part) continue;
          const i = part.indexOf('=');
          this._list.push(i < 0 ? [formDecode(part), ''] : [formDecode(part.slice(0, i)), formDecode(part.slice(i + 1))]);
        }
      } else if (init && typeof init[Symbol.iterator] === 'function') {
        for (const [k, v] of init) this._list.push([String(k), String(v)]);
      } else if (init && typeof init === 'object') {
        for (const k of Object.keys(init)) this._list.push([k, String(init[k])]);
      }
    }
    append(k, v) {
      this._list.push([String(k), String(v)]);
    }
    set(k, v) {
      this.delete(k);
      this.append(k, v);
    }
    get(k) {
      const e = this._list.find(([x]) => x === k);
      return e ? e[1] : null;
    }
    getAll(k) {
      return this._list.filter(([x]) => x === k).map(([, v]) => v);
    }
    has(k) {
      return this._list.some(([x]) => x === k);
    }
    delete(k) {
      this._list = this._list.filter(([x]) => x !== k);
    }
    forEach(fn) {
      for (const [k, v] of this._list) fn(v, k, this);
    }
    entries() {
      return this._list[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this._list[Symbol.iterator]();
    }
    toString() {
      return this._list.map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`).join('&');
    }
  };
}

if (typeof G.URL !== 'function') {
  const ABS = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
  G.URL = class URL {
    constructor(input, base) {
      const s = String(input);
      let m = ABS.exec(s);
      if (!m) {
        if (base === undefined) throw new TypeError(`Invalid URL: ${s}`);
        const b = new URL(base);
        if (s.startsWith('//')) m = ABS.exec(`${b.protocol}${s}`);
        else if (s.startsWith('/')) m = ABS.exec(`${b.origin}${s}`);
        else if (s.startsWith('?')) m = ABS.exec(`${b.origin}${b.pathname}${s}`);
        else m = ABS.exec(`${b.origin}${b.pathname.replace(/[^/]*$/, '')}${s}`);
        if (!m) throw new TypeError(`Invalid URL: ${s}`);
      }
      this.protocol = m[1].toLowerCase();
      this.host = m[2].replace(/^[^@]*@/, '').toLowerCase();
      const hp = /^(\[[^\]]+\]|[^:]*)(?::(\d*))?$/.exec(this.host) || [this.host, this.host, ''];
      this.hostname = hp[1];
      const dflt = this.protocol === 'https:' ? '443' : this.protocol === 'http:' ? '80' : '';
      this.port = hp[2] && hp[2] !== dflt ? hp[2] : '';
      if (!this.port) this.host = this.hostname;
      this.pathname = m[3] || '/';
      this.search = m[4] && m[4] !== '?' ? m[4] : '';
      this.hash = m[5] && m[5] !== '#' ? m[5] : '';
      this.searchParams = new G.URLSearchParams(this.search);
    }
    get origin() {
      return `${this.protocol}//${this.host}`;
    }
    get href() {
      return `${this.origin}${this.pathname}${this.search}${this.hash}`;
    }
    toString() {
      return this.href;
    }
    toJSON() {
      return this.href;
    }
  };
}

// ---- Headers and fetch (the host does the request; bodies cross the bridge as bytes)

class Headers {
  constructor(init) {
    this._map = new Map();
    if (init instanceof Headers) init.forEach((v, k) => this.append(k, v));
    else if (init && typeof init[Symbol.iterator] === 'function') for (const [k, v] of init) this.append(k, v);
    else if (init && typeof init === 'object') for (const k of Object.keys(init)) this.append(k, init[k]);
  }
  append(k, v) {
    const key = String(k).toLowerCase();
    const prev = this._map.get(key);
    this._map.set(key, prev === undefined ? String(v) : `${prev}, ${v}`);
  }
  set(k, v) {
    this._map.set(String(k).toLowerCase(), String(v));
  }
  get(k) {
    const v = this._map.get(String(k).toLowerCase());
    return v === undefined ? null : v;
  }
  has(k) {
    return this._map.has(String(k).toLowerCase());
  }
  delete(k) {
    this._map.delete(String(k).toLowerCase());
  }
  forEach(fn) {
    for (const [k, v] of this._map) fn(v, k, this);
  }
  entries() {
    return this._map.entries();
  }
  keys() {
    return this._map.keys();
  }
  [Symbol.iterator]() {
    return this._map.entries();
  }
  toObject() {
    return Object.fromEntries(this._map);
  }
}
G.Headers = Headers;

class Response {
  constructor(status, headers, bytes) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.statusText = '';
    this.headers = new Headers(headers || {});
    this._bytes = bytes || new Uint8Array(0);
    this.bodyUsed = false;
  }
  async arrayBuffer() {
    this.bodyUsed = true;
    const b = this._bytes;
    return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  async text() {
    this.bodyUsed = true;
    return N.utf8Decode(this._bytes);
  }
  async json() {
    return JSON.parse(await this.text());
  }
}
G.Response = Response;

const pending = new Map();
let fetchSerial = 0;
const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

G.fetch = function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const signal = opts.signal;
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const id = ++fetchSerial;
    const headers = opts.headers instanceof Headers ? opts.headers.toObject() : new Headers(opts.headers || {}).toObject();
    let body = opts.body;
    if (body === undefined || body === null) body = null;
    else if (typeof body === 'string') body = N.utf8Encode(body);
    else if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    else if (!ArrayBuffer.isView(body)) body = N.utf8Encode(String(body));
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      try {
        N.fetchCancel(id);
      } catch {}
      reject(abortError());
    };
    pending.set(id, { resolve, reject, signal, onAbort });
    if (signal) signal.addEventListener('abort', onAbort);
    N.fetch(id, String(url), String(opts.method || 'GET').toUpperCase(), headers, body, 0);
  });
};

function settleFetch(id) {
  const p = pending.get(id);
  if (!p) return null;
  pending.delete(id);
  if (p.signal) p.signal.removeEventListener('abort', p.onAbort);
  return p;
}
G.__fetchDone = (id, status, headers, bytes) => {
  const p = settleFetch(id);
  if (p) p.resolve(new Response(Number(status), headers, bytes));
};
G.__fetchFail = (id, message) => {
  const p = settleFetch(id);
  if (p) p.reject(new TypeError(`fetch failed${message ? `: ${message}` : ''}`));
};

module.exports = {};
