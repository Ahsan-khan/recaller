'use strict';
// The GCP mock's front door: one HTTP server on 127.0.0.1, plus an in-process fetch with the same behaviour.
// The first path segment names the Google service, the way src/cloud/config.js builds mock endpoints:
// /identitytoolkit.googleapis.com, /securetoken.googleapis.com, /firestore.googleapis.com and
// /firebasestorage.googleapis.com. It keeps the request log (method, path, auth scheme and what the
// services add, never a body), applies injected failures and holds paused answers.

const http = require('node:http');

const SERVICES = {
  'identitytoolkit.googleapis.com': 'identity',
  'securetoken.googleapis.com': 'token',
  'firestore.googleapis.com': 'firestore',
  'firebasestorage.googleapis.com': 'storage',
};
// What fail() and pauseAfter() may name: the ops the services' classify() gives, and the tags they add. A
// misspelt name would otherwise never match, and a test injecting that failure would pass without it.
const FAIL_SERVICES = new Set(['*', 'auth', ...Object.values(SERVICES)]);
const OPS = new Set([
  'signUp', 'signInWithPassword', 'sendOobCode', 'lookup', 'delete', 'token', 'get', 'batchGet', 'runQuery', 'commit',
  'upload', 'upload-start', 'upload-chunk', 'upload-query', 'upload-cancel', 'download', 'metadata', 'list',
]);
const TAGS = new Set(['head-create', 'head-delete', 'deleting', 'bumped', 'uploaded', 'deleted']);
const MAX_BODY = 64 * 1024 * 1024;
const WORDS = {
  400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 409: 'ABORTED',
  429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 501: 'UNIMPLEMENTED', 502: 'UNAVAILABLE', 503: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED',
};
const MESSAGES = {
  429: 'Quota exceeded. Try again later.',
  500: 'Internal error encountered.',
  503: 'The service is currently unavailable.',
  504: 'Deadline expired before operation could complete.',
};

// A service's answer: an object body is sent as JSON, a string or Buffer as it is.
function reply(status, body = '', headers = {}) {
  return { status, body, headers };
}

function googleError(status, message = MESSAGES[status] || 'Injected failure.') {
  return reply(status, { error: { code: status, message, status: WORDS[status] || 'UNKNOWN' } });
}

const scheme = (header) => (typeof header === 'string' ? /^\s*(\S+)/.exec(header)?.[1] ?? null : null);

// services: { identity, token, firestore, storage }, each { handle(req, entry), classify?(req), partial?(req) }.
// req = { method, pathname (still percent-encoded), query: URLSearchParams, headers (lower-case names),
//         body: Buffer, origin }.
function createFront({ clock, services }) {
  const log = [];
  const failures = [];
  let pauses = [];
  let seq = 0;
  let done = 0;
  let server = null;
  let port = 0;

  function takeFailure(entry) {
    for (const f of failures) {
      if (f.times <= 0) continue;
      if (f.service !== '*' && f.service !== entry.service && !(f.service === 'auth' && (entry.service === 'identity' || entry.service === 'token'))) continue;
      if (f.service === '*' && !entry.service) continue;
      if (f.op && (typeof f.op === 'function' ? !f.op(entry) : f.op !== entry.op)) continue;
      if (f.skip > 0) {
        f.skip -= 1;
        continue;
      }
      f.times -= 1;
      return f;
    }
    return null;
  }

  const failed = (f) => (f.status === 'offline' ? { drop: true } : googleError(f.status));

  const matches = (step, entry) => (typeof step === 'function' ? Boolean(step(entry)) : entry.op === step || Boolean(entry.tags?.includes(step)));

  async function hold(entry) {
    const p = pauses.find((x) => !x.released && x.times > 0 && matches(x.step, entry));
    if (!p) return;
    p.times -= 1;
    entry.paused = true;
    p.hit(entry);
    await new Promise((resolve) => {
      if (p.released) resolve();
      else p.held.push(resolve);
    });
  }

  function finish(res) {
    const headers = {};
    for (const [k, v] of Object.entries(res.headers || {})) headers[k.toLowerCase()] = String(v);
    let body = res.body;
    if (Buffer.isBuffer(body)) {
      headers['content-type'] ??= 'application/octet-stream';
    } else if (typeof body === 'string') {
      body = Buffer.from(body);
      if (body.length) headers['content-type'] ??= 'text/plain; charset=utf-8';
    } else {
      body = Buffer.from(JSON.stringify(body));
      headers['content-type'] ??= 'application/json; charset=UTF-8';
    }
    if (res.status === 204 || res.status === 304) body = Buffer.alloc(0);
    headers.date = new Date(clock.now()).toUTCString();
    headers['content-length'] = String(body.length);
    return { status: res.status, headers, body };
  }

  async function handle({ method, url, headers, body }) {
    const u = new URL(url);
    const service = SERVICES[u.pathname.split('/')[1]] ?? null;
    const svc = service ? services[service] : null;
    const req = { method, pathname: u.pathname, query: u.searchParams, headers, body, origin: u.origin };
    const entry = { seq: ++seq, method, path: u.pathname, auth: scheme(headers.authorization), service, op: null };
    try {
      if (svc?.classify) Object.assign(entry, svc.classify(req));
    } catch {}
    entry.at = clock.now();
    entry.status = null;
    log.push(entry);

    const failure = takeFailure(entry);
    let res;
    if (failure && !failure.lost) {
      if (failure.status === 'offline' && failure.partial !== false) svc?.partial?.(req);
      res = failed(failure);
    } else {
      try {
        res = svc ? await svc.handle(req, entry) : googleError(404, 'Not Found');
      } catch (err) {
        entry.error = String(err?.stack || err);
        res = googleError(500, `GCP mock bug: ${err?.message || err}`);
      }
      if (failure) res = failed(failure); // processed, then the answer is lost
      else if (res.status < 300) await hold(entry);
    }
    entry.status = res.drop ? 'offline' : res.status;
    entry.done = ++done;
    return res.drop ? res : finish(res);
  }

  async function serve(req, res) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const out = await handle({
      method: req.method,
      url: `http://${req.headers.host || `127.0.0.1:${port}`}${req.url}`,
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    if (out.drop) {
      // The connection breaks partway through the answer. Closing it before the first byte would look like an
      // idle keep-alive socket the server had closed, and Chromium (Electron's net.fetch) quietly resends such
      // a request, POSTs included, so the app might never see the failure, or a lost answer processed twice.
      res.writeHead(200, { 'content-type': 'application/json; charset=UTF-8', 'content-length': '64' });
      res.write('{', () => req.socket.destroy());
      return;
    }
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  }

  function listen(wanted = 0) {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        serve(req, res).catch((err) => {
          try {
            res.writeHead(500);
            res.end(String(err?.message || err));
          } catch {}
        });
      });
      // Idle connections stay open until the client or close() ends them: a server-side timeout could race a
      // client reusing the socket and fail a request that did nothing wrong.
      s.keepAliveTimeout = 0;
      s.once('error', reject);
      s.listen(wanted, '127.0.0.1', () => {
        s.off('error', reject);
        server = s;
        port = s.address().port;
        resolve(port);
      });
    });
  }

  function close() {
    resume();
    if (!server) return Promise.resolve();
    const s = server;
    server = null;
    port = 0;
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    });
  }

  async function toBuffer(body) {
    if (body == null) return Buffer.alloc(0);
    if (typeof body === 'string') return Buffer.from(body);
    if (Buffer.isBuffer(body)) return body;
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (body instanceof URLSearchParams) return Buffer.from(body.toString());
    if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
    throw new TypeError('GCP mock fetch: unsupported body');
  }

  // fetch(url, init) without a socket: the same handling, log and failures ('offline' throws like fetch).
  async function fetchImpl(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || request?.headers || {}).forEach((v, k) => { headers[k] = v; });
    const signal = init.signal ?? request?.signal;
    const aborted = () => signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
    if (signal?.aborted) throw aborted();
    const body = init.body === undefined && request ? await request.arrayBuffer() : init.body;
    const work = handle({ method, url, headers, body: await toBuffer(body) });
    const out = !signal ? await work : await new Promise((resolve, reject) => {
      const onAbort = () => reject(aborted());
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
    if (out.drop) throw new TypeError('fetch failed', { cause: new Error('GCP mock: connection dropped') });
    const empty = [101, 204, 205, 304].includes(out.status) || method === 'HEAD';
    return new Response(empty ? null : out.body, { status: out.status, headers: out.headers });
  }

  // Controls
  function fail(spec) {
    if (spec == null) {
      failures.length = 0;
      return () => {};
    }
    const status = spec.status ?? 503;
    if (status !== 'offline' && !(Number.isInteger(status) && status >= 400 && status <= 599)) {
      throw new TypeError("fail(): status is 'offline' or an HTTP error status");
    }
    const service = spec.service ?? '*';
    if (!FAIL_SERVICES.has(service)) throw new TypeError(`fail(): unknown service ${service}`);
    if (spec.op != null && typeof spec.op !== 'function' && !OPS.has(spec.op)) throw new TypeError(`fail(): unknown op ${spec.op}`);
    const f = {
      service, op: spec.op ?? null, status, times: spec.times ?? 1, skip: spec.skip ?? 0, lost: Boolean(spec.lost), partial: spec.partial,
    };
    failures.push(f);
    return () => {
      const k = failures.indexOf(f);
      if (k >= 0) failures.splice(k, 1);
    };
  }

  function pauseAfter(step, { times = 1 } = {}) {
    if (typeof step !== 'function' && !OPS.has(step) && !TAGS.has(step)) throw new TypeError(`pauseAfter(): unknown step ${step}`);
    let hit;
    const p = { step, times, held: [], released: false, hit: null };
    const promise = new Promise((resolve) => { hit = resolve; });
    p.hit = hit;
    p.resume = () => {
      p.released = true;
      for (const resolve of p.held.splice(0)) resolve();
    };
    pauses.push(p);
    return { hit: promise, resume: p.resume };
  }

  function resume() {
    for (const p of pauses) p.resume();
    pauses = [];
  }

  function reset() {
    resume();
    failures.length = 0;
    log.length = 0;
    seq = 0;
    done = 0;
  }

  return {
    log, handle, listen, close, fetch: fetchImpl, fail, pauseAfter, resume, reset,
    get port() { return port; },
    get address() { return server ? server.address() : null; },
  };
}

module.exports = { createFront, reply, googleError };
