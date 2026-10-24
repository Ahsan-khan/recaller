'use strict';
// POSIX node:path (join, dirname, basename, extname, resolve, normalize).

function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else out.push(part);
  }
  const s = out.join('/');
  return abs ? `/${s}` : s || '.';
}

const join = (...parts) => normalize(parts.filter((x) => x !== '').join('/'));
const resolve = (...parts) => {
  let p = '';
  for (const part of parts) p = part.startsWith('/') ? part : p ? `${p}/${part}` : part;
  return normalize(p.startsWith('/') ? p : `/${p}`);
};
function dirname(p) {
  const s = p.replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  return i === 0 ? '/' : s.slice(0, i);
}
function basename(p, ext) {
  const b = p.replace(/\/+$/, '').split('/').pop() || '';
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}
function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

module.exports = { join, resolve, dirname, basename, extname, normalize, sep: '/', delimiter: ':', posix: null };
module.exports.posix = module.exports;
