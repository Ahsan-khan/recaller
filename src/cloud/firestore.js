'use strict';
// Cloud Firestore REST v1, authorised with the user's Firebase ID token
// (Authorization: Bearer). runQuery and batchGet answer as a stream, which
// arrives over HTTP as a JSON array; newline-delimited or back-to-back objects
// are parsed too, since that framing isn't confirmed on the real service.

const { CloudError, errorFrom, withToken } = require('./http');

const PAGE = 300;
const BATCH = 100;
const INEQUALITY = new Set([
  'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'NOT_EQUAL', 'NOT_IN', 'IS_NOT_NAN', 'IS_NOT_NULL',
]);

// The messages of a streamed answer: a JSON array, or objects one after another.
// An answer cut short throws: a partial list would look like the end of the results.
function parseStream(text) {
  const t = text.trim();
  if (!t) return [];
  try {
    const value = JSON.parse(t);
    return Array.isArray(value) ? value : [value];
  } catch {}
  const out = [];
  let depth = 0;
  let start = 0;
  let open = 0; // brackets around the objects; an array missing its ']' was cut off
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (depth === 0) {
      if (c === '{') { depth = 1; start = i; }
      else if (c === '[') open++;
      else if (c === ']' ? --open < 0 : !/[\s,]/.test(c)) throw new SyntaxError('not a stream of objects');
    } else if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if ((c === '}' || c === ']') && --depth === 0) {
      out.push(JSON.parse(t.slice(start, i + 1)));
    }
  }
  if (depth !== 0 || inString || open !== 0) throw new SyntaxError('truncated stream');
  return out;
}

// Field paths are dot-separated; a segment may be `quoted` with backticks.
function splitPath(p) {
  return Array.from(p.matchAll(/`((?:[^`\\]|\\.)*)`|([^.`]+)/g), (m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]));
}

function inequalityFields(filter, out = []) {
  if (!filter || typeof filter !== 'object') return out;
  for (const f of filter.compositeFilter?.filters || []) inequalityFields(f, out);
  const leaf = filter.fieldFilter || filter.unaryFilter;
  const p = leaf?.field?.fieldPath;
  if (p && INEQUALITY.has(leaf.op) && !out.includes(p)) out.push(p);
  return out;
}

// Paging needs a total order: the query's orderBy (or, without one, its inequality fields,
// as Firestore requires), ending with __name__, which Firestore would add implicitly anyway.
function pagingOrder(q) {
  const order = Array.isArray(q.orderBy) ? q.orderBy.filter((o) => typeof o?.field?.fieldPath === 'string') : [];
  if (!order.length) {
    for (const fieldPath of inequalityFields(q.where).sort()) order.push({ field: { fieldPath }, direction: 'ASCENDING' });
  }
  if (!order.some((o) => o.field.fieldPath === '__name__')) {
    order.push({ field: { fieldPath: '__name__' }, direction: order.at(-1)?.direction || 'ASCENDING' });
  }
  return order;
}

// A projection must still carry the fields the cursor is built from.
function withOrderFields(select, order) {
  const fields = Array.isArray(select.fields) ? [...select.fields] : [];
  for (const { field: { fieldPath } } of order) {
    if (fieldPath !== '__name__' && !fields.some((f) => f?.fieldPath === fieldPath)) fields.push({ fieldPath });
  }
  return { ...select, fields };
}

function createFirestore({ http, endpoints, projectId, getIdToken }) {
  const root = `projects/${projectId}/databases/(default)/documents`;
  const clean = (p) => String(p ?? '').replace(/^\/+|\/+$/g, '');
  const name = (path) => (clean(path) ? `${root}/${clean(path)}` : root);
  const url = (resource, verb = '') => `${endpoints.firestore}/${resource.split('/').map(encodeURIComponent).join('/')}${verb}`;
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });

  function pathOf(docName) {
    const i = docName.indexOf('/documents/');
    return i < 0 ? docName : docName.slice(i + '/documents/'.length);
  }

  const toDoc = (d, path = pathOf(d.name)) => ({
    path,
    name: d.name,
    fields: d.fields && typeof d.fields === 'object' ? d.fields : {},
    createTime: d.createTime ?? null,
    updateTime: d.updateTime ?? null,
  });

  async function stream(resource, verb, body) {
    const res = await withToken(getIdToken, (token) => http.bytes(url(resource, verb), {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 60000,
      service: 'firestore',
    }));
    let items;
    try {
      items = parseStream(res.data.toString('utf8'));
    } catch {
      throw new CloudError('SERVER', { status: res.status, retryable: true, service: 'firestore' });
    }
    items = items.filter((x) => x && typeof x === 'object');
    const failed = items.find((x) => x.error);
    if (failed) throw errorFrom(Number(failed.error.code) || 500, failed, 'firestore'); // an error partway through the stream
    return items;
  }

  async function get(path) {
    let data;
    try {
      ({ data } = await withToken(getIdToken, (token) => http.json(url(name(path)), { headers: bearer(token), service: 'firestore' })));
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
    if (typeof data?.name !== 'string') throw new CloudError('SERVER', { status: 200, retryable: true, service: 'firestore' });
    return toDoc(data, clean(path));
  }

  async function batchGet(paths) {
    const list = Array.from(paths, (p) => [p, clean(p)]);
    const wanted = [...new Set(list.map(([, p]) => p))];
    const found = new Map();
    for (let i = 0; i < wanted.length; i += BATCH) {
      const items = await stream(root, ':batchGet', { documents: wanted.slice(i, i + BATCH).map(name) });
      for (const item of items) {
        if (typeof item.found?.name === 'string') found.set(pathOf(item.found.name), toDoc(item.found));
        else if (typeof item.missing === 'string') found.set(pathOf(item.missing), null);
      }
    }
    return new Map(list.map(([key, p]) => [key, found.get(p) ?? null]));
  }

  async function query(parentPath, structuredQuery) {
    const items = await stream(name(parentPath), ':runQuery', { structuredQuery });
    const docs = [];
    let readTime = null;
    for (const item of items) {
      if (typeof item.readTime === 'string') readTime = item.readTime;
      if (typeof item.document?.name === 'string') docs.push(toDoc(item.document));
    }
    return { docs, readTime };
  }

  function cursorValue(doc, fieldPath) {
    if (fieldPath === '__name__') return { referenceValue: doc.name };
    let value = { mapValue: { fields: doc.fields } };
    for (const key of splitPath(fieldPath)) {
      const fields = value?.mapValue?.fields;
      value = fields && Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
    }
    return value ?? { nullValue: null };
  }

  // Every page starts after the previous page's last document.
  async function* queryAll(parentPath, structuredQuery, { pageSize = PAGE } = {}) {
    const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : PAGE;
    const order = pagingOrder(structuredQuery);
    const q = { ...structuredQuery, orderBy: order, limit: size };
    if (q.select) q.select = withOrderFields(q.select, order);
    let previous = '';
    for (;;) {
      const { docs } = await query(parentPath, q);
      const last = docs[docs.length - 1];
      const values = last ? order.map((o) => cursorValue(last, o.field.fieldPath)) : null;
      const cursor = values ? JSON.stringify(values) : '';
      // A page ending where the last one did means startAt was ignored: never repeat it forever.
      if (cursor && cursor === previous) throw new CloudError('SERVER', { retryable: true, service: 'firestore' });
      for (const doc of docs) yield doc;
      if (docs.length < size) return;
      previous = cursor;
      q.startAt = { values, before: false };
      delete q.offset;
    }
  }

  async function commit(writes) {
    const { data } = await withToken(getIdToken, (token) => http.json(url(root, ':commit'), {
      method: 'POST', headers: bearer(token), body: { writes }, timeoutMs: 120000, service: 'firestore-commit',
    }));
    const results = Array.isArray(data?.writeResults) ? data.writeResults : [];
    return { commitTime: data?.commitTime ?? null, writeResults: results.map((r) => ({ updateTime: r?.updateTime ?? null })) };
  }

  return { name, get, batchGet, query, queryAll, commit };
}

module.exports = { createFirestore, parseStream };
