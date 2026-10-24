'use strict';
// The part of Node's Buffer that src/sync and src/cloud use, on top of Uint8Array. UTF-8 and base64 go
// through the native bridge (fast, and the same lone-surrogate handling as Node: U+FFFD); hex, latin1 and
// UTF-16LE are done here.

const N = require('./native');

const HEX = '0123456789abcdef';

function normEnc(enc) {
  const e = String(enc || 'utf8').toLowerCase();
  if (e === 'utf-8') return 'utf8';
  if (e === 'ucs2' || e === 'ucs-2' || e === 'utf-16le') return 'utf16le';
  if (e === 'binary') return 'latin1';
  return e;
}

function wrap(u8) {
  return new Buffer(u8.buffer, u8.byteOffset, u8.byteLength);
}

function fromString(s, enc) {
  const e = normEnc(enc);
  switch (e) {
    case 'utf8':
      return wrap(N.utf8Encode(s));
    case 'hex': {
      const n = s.length >> 1;
      const b = new Buffer(n);
      let i = 0;
      for (; i < n; i++) {
        const v = parseInt(s.substr(i * 2, 2), 16);
        if (Number.isNaN(v)) break;
        b[i] = v;
      }
      return i === n ? b : b.subarray(0, i);
    }
    case 'base64':
    case 'base64url': {
      let t = s.replace(/[^A-Za-z0-9+/\-_]/g, '').replace(/-/g, '+').replace(/_/g, '/');
      while (t.length % 4) t += '=';
      return wrap(N.base64Decode(t));
    }
    case 'utf16le': {
      const b = new Buffer(s.length * 2);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        b[i * 2] = c & 255;
        b[i * 2 + 1] = c >> 8;
      }
      return b;
    }
    case 'latin1':
    case 'ascii': {
      const b = new Buffer(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
      return b;
    }
    default:
      throw new TypeError(`Unknown encoding: ${enc}`);
  }
}

class Buffer extends Uint8Array {
  static from(v, encOrOffset, length) {
    if (typeof v === 'string') return fromString(v, encOrOffset);
    if (v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]') {
      const off = Number(encOrOffset) || 0;
      return new Buffer(v, off, length === undefined ? v.byteLength - off : length);
    }
    if (ArrayBuffer.isView(v)) {
      const b = new Buffer(v.byteLength);
      b.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      return b;
    }
    if (Array.isArray(v)) {
      const b = new Buffer(v.length);
      for (let i = 0; i < v.length; i++) b[i] = v[i] & 255;
      return b;
    }
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
    throw new TypeError('Buffer.from: unsupported value');
  }

  static alloc(n, fill = 0) {
    const b = new Buffer(n);
    if (fill) b.fill(typeof fill === 'number' ? fill : 0);
    return b;
  }

  static allocUnsafe(n) {
    return new Buffer(n);
  }

  static isBuffer(v) {
    return v instanceof Buffer;
  }

  static isEncoding(enc) {
    return ['utf8', 'hex', 'base64', 'base64url', 'utf16le', 'latin1', 'ascii'].includes(normEnc(enc));
  }

  static byteLength(v, enc = 'utf8') {
    if (typeof v !== 'string') return v.byteLength;
    if (normEnc(enc) === 'utf8') return N.utf8Length(v);
    return fromString(v, enc).length;
  }

  static concat(list, total) {
    const len = total === undefined ? list.reduce((n, b) => n + b.length, 0) : total;
    const out = new Buffer(len);
    let at = 0;
    for (const b of list) {
      if (at >= len) break;
      const part = b.length > len - at ? b.subarray(0, len - at) : b;
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  toString(enc = 'utf8', start = 0, end = this.length) {
    const v = start === 0 && end === this.length ? this : this.subarray(start, end);
    switch (normEnc(enc)) {
      case 'utf8':
        return N.utf8Decode(v);
      case 'hex': {
        let s = '';
        for (let i = 0; i < v.length; i++) s += HEX[v[i] >> 4] + HEX[v[i] & 15];
        return s;
      }
      case 'base64':
        return N.base64Encode(v);
      case 'base64url':
        return N.base64Encode(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      case 'utf16le': {
        let s = '';
        for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode(v[i] | (v[i + 1] << 8));
        return s;
      }
      case 'latin1':
      case 'ascii': {
        let s = '';
        for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
        return s;
      }
      default:
        throw new TypeError(`Unknown encoding: ${enc}`);
    }
  }

  toJSON() {
    return { type: 'Buffer', data: Array.from(this) };
  }

  // Node's slice is a view, like subarray.
  slice(start, end) {
    return this.subarray(start, end);
  }

  equals(other) {
    if (!(other instanceof Uint8Array) || other.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  indexOf(value, from = 0, enc) {
    const needle = typeof value === 'string' ? fromString(value, enc) : typeof value === 'number' ? [value & 255] : value;
    const n = needle.length;
    if (n === 0) return Math.min(from, this.length);
    outer: for (let i = Math.max(0, from); i <= this.length - n; i++) {
      for (let j = 0; j < n; j++) if (this[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  includes(value, from = 0, enc) {
    return this.indexOf(value, from, enc) !== -1;
  }

  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const part = this.subarray(sourceStart, Math.min(sourceEnd, sourceStart + (target.length - targetStart)));
    target.set(part, targetStart);
    return part.length;
  }
}

module.exports = { Buffer };
