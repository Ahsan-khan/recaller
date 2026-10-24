'use strict';
// The synchronous part of node:fs that src/ uses, over the native bridge. Errors carry Node's codes.

const N = require('./native');
const { Buffer } = require('./buffer');

function call(r, op, p) {
  if (r && typeof r === 'object' && typeof r.__err === 'string') {
    const err = new Error(`${r.__err}: ${r.message || 'failed'}, ${op} '${p}'`);
    err.code = r.__err;
    err.syscall = op;
    err.path = p;
    throw err;
  }
  return r;
}

const encOf = (opts) => (typeof opts === 'string' ? opts : opts && typeof opts.encoding === 'string' ? opts.encoding : null);
const toBuf = (u8) => (u8 instanceof Buffer ? u8 : new Buffer(u8.buffer, u8.byteOffset, u8.byteLength));

function readFileSync(p, opts) {
  const b = toBuf(call(N.fsRead(String(p)), 'open', p));
  const enc = encOf(opts);
  return enc ? b.toString(enc) : b;
}

function writeFileSync(p, data, opts) {
  const bytes = typeof data === 'string' ? Buffer.from(data, encOf(opts) || 'utf8') : data;
  call(N.fsWrite(String(p), bytes), 'open', p);
}

function existsSync(p) {
  try {
    return N.fsExists(String(p)) === true;
  } catch {
    return false;
  }
}

function mkdirSync(p, opts) {
  call(N.fsMkdir(String(p), Boolean(opts && opts.recursive)), 'mkdir', p);
}

function renameSync(a, b) {
  call(N.fsRename(String(a), String(b)), 'rename', a);
}

function copyFileSync(a, b) {
  call(N.fsCopy(String(a), String(b)), 'copyfile', a);
}

function readdirSync(p) {
  return call(N.fsReaddir(String(p)), 'scandir', p);
}

function rmSync(p, opts = {}) {
  const r = N.fsRm(String(p), Boolean(opts.recursive));
  if (r && r.__err === 'ENOENT' && opts.force) return;
  call(r, 'rm', p);
}

function unlinkSync(p) {
  call(N.fsRm(String(p), false), 'unlink', p);
}

function statSync(p, opts = {}) {
  const s = call(N.fsStat(String(p)), 'stat', p);
  const big = Boolean(opts.bigint);
  const num = (v) => (big ? BigInt(Math.trunc(v || 0)) : v || 0);
  return {
    size: num(s.size),
    ino: num(s.ino),
    birthtimeMs: num(s.birthtimeMs),
    mtimeMs: num(s.mtimeMs),
    isFile: () => !s.dir,
    isDirectory: () => Boolean(s.dir),
  };
}

module.exports = { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, readdirSync, rmSync, unlinkSync, statSync };
