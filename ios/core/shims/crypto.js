'use strict';
// node:crypto's createHash (sha256, md5), randomBytes and randomUUID, over the native bridge.

const N = require('./native');
const { Buffer } = require('./buffer');

function createHash(alg) {
  const name = String(alg).toLowerCase();
  if (name !== 'sha256' && name !== 'md5') throw new Error(`Digest method not supported: ${alg}`);
  const parts = [];
  return {
    update(data, enc) {
      parts.push(typeof data === 'string' ? Buffer.from(data, enc || 'utf8') : data);
      return this;
    },
    digest(enc) {
      const all = parts.length === 1 ? parts[0] : Buffer.concat(parts.map((p) => (p instanceof Buffer ? p : Buffer.from(p))));
      const r = N.hash(name, all);
      const out = new Buffer(r.buffer, r.byteOffset, r.byteLength);
      return enc ? out.toString(enc) : out;
    },
  };
}

function randomBytes(n) {
  const r = N.randomBytes(n);
  return new Buffer(r.buffer, r.byteOffset, r.byteLength);
}

function randomUUID() {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = { createHash, randomBytes, randomUUID };
