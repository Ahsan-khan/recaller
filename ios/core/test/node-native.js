'use strict';
// The native bridge (ios/core/shims/native.js) implemented in Node, so the bundle can run in a bare vm
// context, as it does in JavaScriptCore: nothing but __native and the language itself.

const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { bundle } = require('../build');

// One seal key for every core in this process, as the Keychain keeps one for the app across launches.
const key = crypto.randomBytes(32);

function createNative({ fetchImpl, online = () => true, hostname = 'test-iphone', onEvent = () => {}, log = () => {} }) {
  let ctx = null; // the vm context, for calling back into it
  let realm = null; // its own Uint8Array and Array (a bare context's built-ins aren't properties of it)
  const timers = new Map();
  let stopped = false; // after stop(), nothing reaches the context any more (a crash, as far as it knows)
  const tasks = new Map();
  const u8 = (b) => {
    const out = new realm.Uint8Array(b.length);
    out.set(b);
    return out;
  };
  const toNode = (v) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.alloc(0));
  const err = (e) => ({ __err: e.code || 'EIO', message: e.message });
  const tryFs = (fn) => {
    try {
      const r = fn();
      return r === undefined ? undefined : r;
    } catch (e) {
      return err(e);
    }
  };

  const native = {
    fsRead: (p) => tryFs(() => u8(fs.readFileSync(p))),
    fsWrite: (p, b) => tryFs(() => { fs.writeFileSync(p, toNode(b)); }),
    fsExists: (p) => fs.existsSync(p),
    fsMkdir: (p, recursive) => tryFs(() => { fs.mkdirSync(p, { recursive }); }),
    fsRename: (a, b) => tryFs(() => { fs.renameSync(a, b); }),
    fsCopy: (a, b) => tryFs(() => { fs.copyFileSync(a, b); }),
    fsReaddir: (p) => tryFs(() => realm.Array.from(fs.readdirSync(p).sort())),
    fsRm: (p, recursive) => tryFs(() => {
      if (!fs.existsSync(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      fs.rmSync(p, { recursive });
    }),
    fsStat: (p) => tryFs(() => {
      const s = fs.statSync(p);
      return { size: s.size, dir: s.isDirectory(), ino: s.ino, birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs };
    }),
    utf8Encode: (s) => u8(Buffer.from(String(s), 'utf8')),
    utf8Decode: (b) => toNode(b).toString('utf8'),
    utf8Length: (s) => Buffer.byteLength(String(s), 'utf8'),
    base64Encode: (b) => toNode(b).toString('base64'),
    base64Decode: (s) => u8(Buffer.from(s, 'base64')),
    hash: (alg, b) => u8(crypto.createHash(alg).update(toNode(b)).digest()),
    randomBytes: (n) => u8(crypto.randomBytes(n)),
    setTimer(id, ms) {
      if (stopped) return;
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        if (!stopped) ctx.__timerFire(id);
      }, ms));
    },
    clearTimer(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
    fetch(id, url, method, headers, body) {
      if (stopped) return;
      const ac = new AbortController();
      tasks.set(id, ac);
      Promise.resolve()
        .then(() => fetchImpl(url, { method, headers: { ...headers }, body: body ? toNode(body) : undefined, signal: ac.signal }))
        .then(async (res) => {
          const bytes = Buffer.from(await res.arrayBuffer());
          if (!tasks.delete(id) || stopped) return;
          const hs = {};
          res.headers.forEach((v, k) => { hs[k.toLowerCase()] = v; });
          ctx.__fetchDone(id, res.status, hs, u8(bytes));
        })
        .catch((e) => {
          if (tasks.delete(id) && !stopped) ctx.__fetchFail(id, String(e?.message || e));
        });
    },
    fetchCancel(id) {
      tasks.get(id)?.abort();
      tasks.delete(id);
    },
    isOnline: () => online(),
    hostname: () => hostname,
    log: (level, text) => log(level, text),
    emit: (event, json) => onEvent(event, JSON.parse(json)),
    makeThumb(src, dst) {
      fs.copyFileSync(src, dst);
      return true;
    },
    seal(s) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const out = Buffer.concat([iv, c.update(s, 'utf8'), c.final(), c.getAuthTag()]);
      return u8(out);
    },
    unseal(b) {
      const buf = toNode(b);
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(buf.length - 16));
      return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
    },
    stop() {
      stopped = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const ac of tasks.values()) ac.abort();
      tasks.clear();
    },
  };
  return {
    native,
    attach(context) {
      ctx = context;
      realm = { Uint8Array: vm.runInContext('Uint8Array', context), Array: vm.runInContext('Array', context) };
    },
  };
}

// A bare context with only the bridge, then the bundle: the iPhone's JavaScriptCore, in Node.
function loadCore(opts) {
  const { native, attach } = createNative(opts);
  const context = vm.createContext({ __native: native, __moduleRoot: opts.moduleRoot || '/bundle' });
  attach(context);
  vm.runInContext(bundle().text, context, { filename: 'recaller-core.js' });
  return { core: context.RecallerCore, context, stop: native.stop };
}

module.exports = { createNative, loadCore };
