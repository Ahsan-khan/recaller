'use strict';
// The GCP mock's Cloud Storage for Firebase v0 REST API (ai_memory/15, 7.2), the protocol the Firebase SDKs
// speak: multipart and resumable uploads (start, upload, finalize, query, cancel), download (?alt=media),
// metadata, list (prefix, delimiter, pages) and delete. Only "Authorization: Firebase <ID token>" is accepted;
// Bearer, like no token at all, gets 401. Every request goes through the Storage rules twin, whose
// firestore.get() reads the account's head from the mock's Firestore. An upload is evaluated the way the live
// service evaluates it: method 'create' whether or not a file is stored under that name, with resource = the
// stored file's metadata (null for a new name), and request.resource = the upload's. 'update' would be a
// metadata change, which nothing here offers. A resumable upload is evaluated when it starts (with the
// announced size) and again when it is finalized (with the bytes that arrived, and whatever is stored by then).

const crypto = require('node:crypto');
const rules = require('./rules');
const { reply } = require('./server');

const GRANULARITY = 256 * 1024; // non-final resumable chunks come in multiples of this

function parseHeaders(text) {
  const out = {};
  for (const line of text.split('\r\n')) {
    const k = line.indexOf(':');
    if (k > 0) out[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim();
  }
  return out;
}

// multipart/related: [{ headers, body }], or null when the body isn't one.
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!m || !/^multipart\//i.test(contentType)) return null;
  const boundary = m[1] || m[2];
  const first = body.indexOf(`--${boundary}`);
  if (first < 0) return null;
  const sep = Buffer.from(`\r\n--${boundary}`);
  const parts = [];
  let pos = first + boundary.length + 2;
  for (;;) {
    if (body.subarray(pos, pos + 2).toString('latin1') === '--') return parts;
    if (body.subarray(pos, pos + 2).toString('latin1') !== '\r\n') return null;
    pos += 2;
    const end = body.indexOf(sep, pos);
    if (end < 0) return null;
    const part = body.subarray(pos, end);
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) return null;
    parts.push({ headers: parseHeaders(part.subarray(0, split).toString('latin1')), body: part.subarray(split + 4) });
    pos = end + sep.length;
  }
}

function commands(req) {
  return new Set(String(req.headers['x-goog-upload-command'] ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean));
}

function createStorage({ bucket, clock, ids, auth, firestore, denied }) {
  const objects = new Map(); // name → { name, bytes, size, contentType, md5Hash, generation, timeCreated, downloadTokens }
  const sessions = new Map(); // upload id → resumable upload

  const fail = (status, message, headers = {}) => reply(status, { error: { code: status, message } }, headers);
  const denied403 = (headers) => fail(403, 'Permission denied.', headers);

  // /firebasestorage.googleapis.com/v0/b/{bucket}/o[/{object name, %2F for /}]
  function route(req) {
    const raw = req.pathname.split('/').slice(2);
    if (raw[0] !== 'v0' || raw[1] !== 'b' || raw[3] !== 'o') return null;
    try {
      return { bucket: decodeURIComponent(raw[2]), name: raw.length > 4 ? decodeURIComponent(raw.slice(4).join('/')) : null };
    } catch {
      return null;
    }
  }

  function allowed(method, name, user, { existing = null, incoming = null } = {}) {
    if (denied.has(name)) return false;
    const meta = (o) => new Map([['name', o.name], ['bucket', bucket], ['size', BigInt(o.size)], ['contentType', o.contentType]]);
    return rules.evaluate({
      service: 'storage',
      method,
      path: name,
      auth: rules.authValue(user),
      time: firestore.nowTimestamp(),
      existing: existing && meta(existing),
      incoming: incoming && meta(incoming),
      head: firestore.rulesData,
    }).allow;
  }

  function objectName(fromQuery, fromMeta) {
    const name = fromQuery ?? fromMeta;
    if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 1024 || /[\r\n]/.test(name)) return null;
    if (fromQuery != null && fromMeta != null && fromQuery !== fromMeta) return null;
    return name;
  }

  function metadataJson(o) {
    return {
      name: o.name,
      bucket,
      generation: o.generation,
      metageneration: '1',
      contentType: o.contentType,
      timeCreated: o.timeCreated,
      updated: o.timeCreated,
      storageClass: 'STANDARD',
      size: String(o.size),
      md5Hash: o.md5Hash,
      contentEncoding: 'identity',
      contentDisposition: `inline; filename*=utf-8''${encodeURIComponent(o.name.split('/').pop())}`,
      etag: crypto.createHash('md5').update(`${o.name}#${o.generation}`).digest('base64').slice(0, 22),
      downloadTokens: o.downloadTokens,
    };
  }

  function createObject(name, bytes, contentType) {
    const micros = clock.tick();
    return {
      name,
      bytes: Buffer.from(bytes),
      size: bytes.length,
      contentType,
      md5Hash: crypto.createHash('md5').update(bytes).digest('base64'),
      generation: String(micros),
      timeCreated: new Date(Math.floor(micros / 1000)).toISOString(),
      downloadTokens: ids.uuid('download'),
    };
  }

  // An upload's rules: a create, over whatever is stored under that name right now (resource), if anything.
  const mayUpload = (name, size, contentType, user) => allowed('create', name, user, {
    existing: objects.get(name) ?? null, incoming: { name, size, contentType },
  });

  function save(name, bytes, contentType, user, entry) {
    if (!mayUpload(name, bytes.length, contentType, user)) return null;
    const o = createObject(name, bytes, contentType);
    objects.set(name, o);
    entry.tags = ['uploaded'];
    return o;
  }

  function multipart(req, user, entry) {
    const parts = parseMultipart(req.body, req.headers['content-type']);
    if (!parts || parts.length !== 2) return fail(400, 'Invalid request. A multipart upload is a metadata part and a media part.');
    let meta = null;
    try {
      meta = JSON.parse(parts[0].body.toString('utf8'));
    } catch {}
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return fail(400, 'Invalid request. The metadata part is not a JSON object.');
    const name = objectName(req.query.get('name'), meta.name);
    if (!name) return fail(400, 'Invalid request. The object name is missing, or differs from the metadata.');
    const contentType = typeof meta.contentType === 'string' ? meta.contentType : parts[1].headers['content-type'] || 'application/octet-stream';
    const o = save(name, parts[1].body, contentType, user, entry);
    return o ? reply(200, metadataJson(o)) : denied403();
  }

  function start(req, user) {
    let meta = {};
    if (req.body.length) {
      try {
        meta = JSON.parse(req.body.toString('utf8'));
      } catch {
        meta = null;
      }
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return fail(400, 'Invalid request. The metadata is not a JSON object.');
    const name = objectName(req.query.get('name'), meta.name);
    if (!name) return fail(400, 'Invalid request. The object name is missing, or differs from the metadata.');
    const length = req.headers['x-goog-upload-header-content-length'];
    const total = length === undefined ? null : Number(length);
    if (total !== null && !(Number.isSafeInteger(total) && total >= 0)) return fail(400, 'Invalid request. Bad X-Goog-Upload-Header-Content-Length.');
    const contentType = typeof meta.contentType === 'string'
      ? meta.contentType
      : req.headers['x-goog-upload-header-content-type'] || 'application/octet-stream';
    if (total !== null && !mayUpload(name, total, contentType, user)) return denied403();
    const id = ids.hex(`upload:${sessions.size}:${name}`, 40);
    sessions.set(id, { id, name, uid: user.uid, contentType, total, chunks: [], size: 0, status: 'active', object: null });
    const url = `${req.origin}/firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(name)}`
      + `&uploadType=resumable&upload_id=${id}&upload_protocol=resumable`;
    return reply(200, '', {
      'x-goog-upload-status': 'active', 'x-goog-upload-url': url, 'x-goog-upload-chunk-granularity': String(GRANULARITY), 'x-guploader-uploadid': id,
    });
  }

  function chunk(req, user, entry) {
    const s = sessions.get(req.query.get('upload_id'));
    if (!s) return fail(404, 'Not Found.');
    if (s.uid !== user.uid) return denied403();
    const cmds = commands(req);
    const status = () => ({ 'x-goog-upload-status': s.status, 'x-goog-upload-size-received': String(s.size) });
    if (cmds.has('query')) return reply(200, s.status === 'final' ? metadataJson(s.object) : '', status());
    if (cmds.has('cancel')) {
      if (s.status === 'active') s.status = 'cancelled';
      return reply(200, '', status());
    }
    if (s.status === 'final') {
      return cmds.has('finalize') ? reply(200, metadataJson(s.object), status()) : fail(400, 'Invalid request. The upload is already final.', status());
    }
    if (s.status !== 'active') return fail(400, 'Invalid request. The upload was cancelled.', status());
    if (cmds.has('upload')) {
      const offset = Number(req.headers['x-goog-upload-offset']);
      if (!Number.isSafeInteger(offset) || offset !== s.size) return fail(400, `Invalid request. The upload offset should be ${s.size}.`, status());
      if (!cmds.has('finalize') && req.body.length % GRANULARITY !== 0) {
        return fail(400, `Invalid request. A chunk that doesn't finalize must be a multiple of ${GRANULARITY} bytes.`, status());
      }
      if (s.total !== null && s.size + req.body.length > s.total) return fail(400, 'Invalid request. More bytes than announced.', status());
      s.chunks.push(Buffer.from(req.body));
      s.size += req.body.length;
    } else if (req.body.length || !cmds.has('finalize')) {
      return fail(400, 'Invalid request. Unknown X-Goog-Upload-Command.', status());
    }
    if (!cmds.has('finalize')) return reply(200, '', status());
    if (s.total !== null && s.size !== s.total) return fail(400, `Invalid request. ${s.size} of ${s.total} bytes arrived.`, status());
    const o = save(s.name, Buffer.concat(s.chunks), s.contentType, user, entry);
    if (!o) {
      s.status = 'cancelled';
      return denied403(status());
    }
    s.status = 'final';
    s.object = o;
    s.chunks = [];
    return reply(200, metadataJson(o), status());
  }

  // A connection that dropped mid-chunk: the server keeps what it received, in whole 256 KiB units (half here).
  function partial(req) {
    const s = sessions.get(req.query.get('upload_id'));
    const user = auth.userFromHeader(req.headers.authorization, 'Firebase');
    if (!s || !user || s.uid !== user.uid || s.status !== 'active' || !commands(req).has('upload')) return;
    if (Number(req.headers['x-goog-upload-offset']) !== s.size) return;
    const keep = Math.floor(req.body.length / 2 / GRANULARITY) * GRANULARITY;
    if (keep > 0 && (s.total === null || s.size + keep <= s.total)) {
      s.chunks.push(Buffer.from(req.body.subarray(0, keep)));
      s.size += keep;
    }
  }

  function read(name, user, media) {
    const o = objects.get(name) ?? null;
    if (!allowed('get', name, user, { existing: o })) return denied403();
    if (!o) return fail(404, 'Not Found.');
    return media ? reply(200, o.bytes, { 'content-type': o.contentType }) : reply(200, metadataJson(o));
  }

  function list(query, user) {
    const prefix = query.get('prefix') ?? '';
    const delimiter = query.get('delimiter');
    if (delimiter !== null && delimiter !== '/') return fail(400, 'Invalid request. The delimiter must be /.');
    const max = query.has('maxResults') ? Number(query.get('maxResults')) : 1000;
    if (!Number.isSafeInteger(max) || max < 1 || max > 1000) return fail(400, 'Invalid request. maxResults must be from 1 to 1000.');
    if (!allowed('list', prefix.replace(/\/+$/, ''), user)) return denied403();
    const entries = new Map(); // value → 'item' | 'prefix'
    for (const name of objects.keys()) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      const cut = delimiter ? rest.indexOf(delimiter) : -1;
      if (cut >= 0) entries.set(prefix + rest.slice(0, cut + 1), 'prefix');
      else entries.set(name, 'item');
    }
    const sorted = [...entries.keys()].sort(rules.compareStrings);
    let from = 0;
    const token = query.get('pageToken');
    if (token) {
      const after = Buffer.from(token, 'base64url').toString('utf8');
      from = sorted.findIndex((v) => rules.compareStrings(v, after) > 0);
      if (from < 0) from = sorted.length;
    }
    const page = sorted.slice(from, from + max);
    const body = {
      prefixes: page.filter((v) => entries.get(v) === 'prefix'),
      items: page.filter((v) => entries.get(v) === 'item').map((name) => ({ name, bucket })),
    };
    if (from + max < sorted.length) body.nextPageToken = Buffer.from(page[page.length - 1]).toString('base64url');
    return reply(200, body);
  }

  function remove(name, user, entry) {
    const o = objects.get(name) ?? null;
    if (!allowed('delete', name, user, { existing: o })) return denied403();
    if (!o) return fail(404, 'Not Found.');
    objects.delete(name);
    entry.tags = ['deleted'];
    return reply(204, '');
  }

  function classify(req) {
    const r = route(req);
    if (!r) return { op: null };
    if (r.name !== null) {
      if (req.method === 'DELETE') return { op: 'delete', name: r.name };
      if (req.method === 'GET') return { op: req.query.get('alt') === 'media' ? 'download' : 'metadata', name: r.name };
      return { op: null, name: r.name };
    }
    if (req.method === 'GET') return { op: 'list', prefix: req.query.get('prefix') ?? '' };
    if (req.method !== 'POST') return { op: null };
    const id = req.query.get('upload_id');
    if (id) {
      const cmds = commands(req);
      const op = cmds.has('query') ? 'upload-query' : cmds.has('cancel') ? 'upload-cancel' : 'upload-chunk';
      return { op, name: sessions.get(id)?.name ?? req.query.get('name'), protocol: 'resumable', command: req.headers['x-goog-upload-command'] ?? null };
    }
    const protocol = String(req.headers['x-goog-upload-protocol'] ?? '').toLowerCase() || null;
    return { op: protocol === 'resumable' ? 'upload-start' : 'upload', name: req.query.get('name'), protocol };
  }

  function handle(req, entry) {
    const r = route(req);
    if (!r || r.bucket !== bucket) return fail(404, 'Not Found.');
    const user = auth.userFromHeader(req.headers.authorization, 'Firebase');
    if (!user) return fail(401, 'Invalid Firebase ID token. Only "Authorization: Firebase <token>" is accepted.');
    if (r.name !== null) {
      if (req.method === 'GET') return read(r.name, user, req.query.get('alt') === 'media');
      if (req.method === 'DELETE') return remove(r.name, user, entry);
      return fail(400, 'Invalid HTTP method/URL pair.');
    }
    if (req.method === 'GET') return list(req.query, user);
    if (req.method !== 'POST') return fail(400, 'Invalid HTTP method/URL pair.');
    if (req.query.get('upload_id')) return chunk(req, user, entry);
    const protocol = String(req.headers['x-goog-upload-protocol'] ?? '').toLowerCase();
    if (protocol === 'multipart') return multipart(req, user, entry);
    if (protocol === 'resumable') {
      return commands(req).has('start') ? start(req, user) : fail(400, 'Invalid request. A resumable upload begins with X-Goog-Upload-Command: start.');
    }
    return fail(400, 'Invalid request. The mock accepts multipart and resumable uploads only.');
  }

  function objectsOf(uid) {
    const prefix = `users/${uid}/`;
    const out = {};
    for (const [name, o] of objects) {
      if (name.startsWith(prefix)) {
        out[name] = {
          name, size: o.size, contentType: o.contentType, md5Hash: o.md5Hash, bytes: Buffer.from(o.bytes),
          generation: o.generation, timeCreated: o.timeCreated,
        };
      }
    }
    return out;
  }

  // Stores (or with null, removes) an object directly, without rules: for seeding a test.
  function writeObject(name, bytes, contentType = 'image/png') {
    if (bytes == null) {
      objects.delete(name);
      return;
    }
    objects.set(name, createObject(name, Buffer.from(bytes), contentType));
  }

  function reset() {
    objects.clear();
    sessions.clear();
  }

  return { handle, classify, partial, objectsOf, writeObject, reset };
}

module.exports = { createStorage, parseMultipart };
