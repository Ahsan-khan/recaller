'use strict';
// Cloud Storage for Firebase through its v0 REST API, the protocol the Firebase
// SDKs use, so the Storage security rules apply. Every request carries
// Authorization: Firebase <idToken>. Pictures up to 256 KiB go up in one
// multipart request; larger ones use the resumable protocol in 2 MiB chunks and
// pick up where the server says it stopped after a failure.
//
// A picture never changes once uploaded: the rules refuse an upload to a name
// that already holds a file (ai_memory/15, 4.9). upload() then reads that
// file's metadata once and tells the caller what the account holds (see there).

const crypto = require('node:crypto');
const { CloudError, withToken } = require('./http');

const MULTIPART_MAX = 256 * 1024;
const CHUNK = 2 * 1024 * 1024;
const MAX_FAILURES = 3; // in a row without progress, per upload
const RESUMABLE_CODES = new Set(['NETWORK', 'TIMEOUT', 'SERVER']);

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new TypeError('upload needs bytes');
}

function parseJson(buf) {
  try {
    const value = JSON.parse(buf.toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function createStorage({ http, endpoints, bucket, getIdToken }) {
  const objects = `${endpoints.storage}/b/${encodeURIComponent(bucket)}/o`;
  const object = (path) => `${objects}/${encodeURIComponent(path)}`;
  const firebase = (token) => ({ Authorization: `Firebase ${token}` });
  const fail = (status = 0) => new CloudError('SERVER', { status, service: 'storage' });

  // One request with the token header; a 401 forces a fresh token and tries once more.
  const call = (kind, url, { headers = {}, ...opts } = {}) => withToken(getIdToken, (token) => http[kind](url, {
    ...opts, headers: { ...headers, ...firebase(token) }, service: 'storage',
  }));

  // The stored object must be exactly these bytes: pictures are immutable, so a bad copy could never be replaced.
  function done(meta, buf) {
    const size = Number(meta?.size);
    const hash = md5(buf);
    if ((Number.isFinite(size) && size !== buf.length) || (typeof meta?.md5Hash === 'string' && meta.md5Hash !== hash)) throw fail();
    return { size: buf.length, md5Hash: hash, existed: false };
  }

  async function multipart(path, buf, contentType) {
    let boundary = crypto.randomBytes(16).toString('hex');
    while (buf.includes(boundary)) boundary = crypto.randomBytes(16).toString('hex');
    const head = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`
      + `${JSON.stringify({ name: path, contentType })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const res = await call('bytes', `${objects}?name=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${boundary}--`)]),
    });
    return done(parseJson(res.data), buf);
  }

  // The session URL comes from the server; the token is only ever sent back to the same origin.
  function sessionUrl(value, startUrl) {
    let u = null;
    try { u = typeof value === 'string' && value ? new URL(value, startUrl) : null; } catch {}
    if (!u || u.origin !== new URL(startUrl).origin) throw fail();
    return u.toString();
  }

  async function uploadStatus(url, total) {
    const res = await call('bytes', url, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'query' }, timeoutMs: 30000 });
    const status = res.headers['x-goog-upload-status'];
    if (status === 'final') return { final: true, received: total };
    const received = Number(res.headers['x-goog-upload-size-received']);
    if (status !== 'active' || !Number.isSafeInteger(received) || received < 0 || received > total) throw fail(res.status);
    return { final: false, received };
  }

  async function finished(path, buf, res) {
    const meta = res ? parseJson(res.data) : null;
    if (meta && meta.size !== undefined) return done(meta, buf);
    const s = await stat(path); // finalized, but the answer didn't carry the metadata
    if (!s) throw fail();
    return done(s, buf);
  }

  async function resumable(path, buf, contentType) {
    const startUrl = `${objects}?name=${encodeURIComponent(path)}`;
    const start = await call('bytes', startUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buf.length),
        'X-Goog-Upload-Header-Content-Type': contentType,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ name: path, contentType }),
      timeoutMs: 30000,
    });
    const url = sessionUrl(start.headers['x-goog-upload-url'], startUrl);
    let offset = 0;
    let failures = 0;
    let lost = false; // after a failure, where the upload stands is asked of the server
    // A failed chunk and a failed query count alike: the connection may still be down when the query goes out.
    const failed = async (err) => {
      if (!RESUMABLE_CODES.has(err?.code) || !err.retryable || ++failures > MAX_FAILURES) throw err;
      await sleep(250 * failures);
      lost = true;
    };
    for (;;) {
      if (lost) {
        let status;
        try {
          status = await uploadStatus(url, buf.length);
        } catch (err) {
          await failed(err);
          continue;
        }
        if (status.final) return finished(path, buf, null);
        if (status.received > offset) failures = 0;
        offset = status.received;
        lost = false;
      }
      const end = Math.min(offset + CHUNK, buf.length);
      const command = offset === buf.length ? 'finalize' : end === buf.length ? 'upload, finalize' : 'upload';
      let res;
      try {
        res = await call('bytes', url, {
          method: 'POST',
          headers: { 'X-Goog-Upload-Command': command, 'X-Goog-Upload-Offset': String(offset) },
          body: buf.subarray(offset, end),
        });
      } catch (err) {
        await failed(err);
        continue;
      }
      const status = res.headers['x-goog-upload-status'];
      if (status === 'final') return finished(path, buf, res);
      if (status !== 'active' || command !== 'upload') throw fail(res.status);
      offset = end;
      failures = 0;
    }
  }

  // → { size, md5Hash, existed: false } once the account holds exactly these bytes under path. A 403 is also
  // what an upload to a name that already holds a file gets (in Storage rules that upload is a create with
  // resource set, and the rules require resource == null), so one stat tells which it was:
  //   - the same bytes (size and md5Hash): an earlier upload whose answer was lost, or one a restart didn't
  //     record → { size, md5Hash, existed: true };
  //   - other bytes: the account's copy is the shared one for that name (another computer uploaded it first,
  //     say a thumbnail its encoder made differently). It stays: nothing may replace it, and nothing is lost,
  //     since the caller keeps its own file → { size, md5Hash (the account's), existed: true, differs: true };
  //   - nothing there, or the stat refused too: a real refusal (the account being deleted, a rules deploy, no
  //     head yet) → the upload's PERMISSION.
  // A stat that can't answer (offline, a timeout, a 5xx) throws its own error: whether the file is there is
  // unknown, so the caller tries again later rather than holding the picture as refused.
  async function upload(path, bytes, contentType = 'image/png') {
    const buf = toBuffer(bytes);
    try {
      return buf.length <= MULTIPART_MAX ? await multipart(path, buf, contentType) : await resumable(path, buf, contentType);
    } catch (err) {
      if (err?.code !== 'PERMISSION') throw err;
      let existing;
      try {
        existing = await stat(path);
      } catch (statErr) {
        throw statErr?.code === 'PERMISSION' ? err : statErr;
      }
      if (!existing) throw err;
      const hash = md5(buf);
      if (existing.size === buf.length && existing.md5Hash === hash) return { size: buf.length, md5Hash: hash, existed: true };
      return { size: existing.size, md5Hash: existing.md5Hash, existed: true, differs: true };
    }
  }

  async function download(path) {
    try {
      return (await call('bytes', `${object(path)}?alt=media`)).data;
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async function stat(path) {
    let data;
    try {
      ({ data } = await call('json', object(path)));
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
    if (!data || typeof data !== 'object') throw fail(200);
    return {
      size: Number(data.size),
      md5Hash: typeof data.md5Hash === 'string' ? data.md5Hash : null,
      contentType: typeof data.contentType === 'string' ? data.contentType : null,
    };
  }

  async function* list(prefix) {
    let pageToken = '';
    do {
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const { data } = await call('json', `${objects}?prefix=${encodeURIComponent(prefix)}&delimiter=%2F&maxResults=1000${page}`);
      for (const item of Array.isArray(data?.items) ? data.items : []) {
        if (typeof item?.name === 'string') yield item.name;
      }
      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
    } while (pageToken);
  }

  async function remove(path) {
    try {
      await call('bytes', object(path), { method: 'DELETE', timeoutMs: 30000 });
      return true;
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return false;
      throw err;
    }
  }

  return { upload, download, stat, list, remove };
}

module.exports = { createStorage };
