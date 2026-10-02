'use strict';
// Image attachments live as files next to the data file (never inline in the
// JSON), served to the page through the recaller-img:// protocol.

const { app, protocol, net, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const SCHEME = 'recaller-img';
const ID = /^[a-f0-9]{32}$/;
const THUMB_WIDTH = 640;

const dir = () => path.join(app.getPath('userData'), 'images');
const fullPath = (id) => path.join(dir(), `${id}.png`);
const thumbPath = (id) => path.join(dir(), `${id}.t.png`);

// Must run before app 'ready'.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// fetchMissing(id, thumb), when given (sync), is awaited for a file that isn't on this computer yet;
// without it, this serves exactly as before. A missing thumbnail falls back to the full size, and a missing
// full size to the thumbnail (a picture from another computer, known here only by its preview after a sign-out).
function serve({ fetchMissing } = {}) {
  protocol.handle(SCHEME, async (request) => {
    const match = /^\/([a-f0-9]{32})(\.t)?\.png$/.exec(new URL(request.url).pathname);
    if (!match) return new Response('Not found', { status: 404 });
    let file = match[2] ? thumbPath(match[1]) : fullPath(match[1]);
    if (fetchMissing && !fs.existsSync(file)) {
      try { await fetchMissing(match[1], Boolean(match[2])); } catch {}
    }
    if (!fs.existsSync(file)) file = fullPath(match[1]);
    if (!fs.existsSync(file)) file = thumbPath(match[1]);
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function store(image) {
  if (!image || image.isEmpty()) throw new Error('Empty image');
  fs.mkdirSync(dir(), { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  const { width, height } = image.getSize();
  fs.writeFileSync(fullPath(id), image.toPNG());
  const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image;
  fs.writeFileSync(thumbPath(id), thumb.toPNG());
  return { id, w: width, h: height };
}

function storeBytes(bytes) {
  return store(nativeImage.createFromBuffer(Buffer.from(bytes)));
}

// The picture image:copy puts on the clipboard: the full size, or its preview when only that is here (as above).
function readPng(id) {
  if (!ID.test(id)) throw new Error('Bad image id');
  return fs.readFileSync(!fs.existsSync(fullPath(id)) && fs.existsSync(thumbPath(id)) ? thumbPath(id) : fullPath(id));
}

// ---- for sync (src/sync/engine.js): pictures by id, the thumbnail or the full size

const fileFor = (id, thumb) => (thumb ? thumbPath(id) : fullPath(id));

function has(id, thumb = false) {
  return ID.test(String(id)) && fs.existsSync(fileFor(String(id), thumb));
}

// Bytes on disk, without reading the file; null when it isn't here.
function size(id, thumb = false) {
  if (!ID.test(String(id))) return null;
  try {
    return fs.statSync(fileFor(String(id), thumb)).size;
  } catch {
    return null;
  }
}

function readFile(id, thumb = false) {
  if (!ID.test(String(id))) throw new Error('Bad image id');
  return fs.promises.readFile(fileFor(String(id), thumb));
}

// A picture from the account, under its own id: a temp file, then a rename.
function writeWithId(id, thumb, bytes) {
  if (!ID.test(String(id))) throw new Error('Bad image id');
  if (!(bytes instanceof Uint8Array)) throw new Error('No image bytes');
  fs.mkdirSync(dir(), { recursive: true });
  const target = fileFor(String(id), thumb);
  fs.writeFileSync(target + '.tmp', bytes);
  fs.renameSync(target + '.tmp', target);
}

// Makes <id>.t.png from <id>.png with store()'s 640 px rule. → whether the thumbnail is there now.
function ensureThumb(id) {
  if (!ID.test(String(id))) throw new Error('Bad image id');
  if (fs.existsSync(thumbPath(id))) return true;
  if (!fs.existsSync(fullPath(id))) return false;
  const image = nativeImage.createFromPath(fullPath(id));
  if (image.isEmpty()) return false;
  const { width } = image.getSize();
  const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image;
  writeWithId(id, true, thumb.toPNG());
  return true;
}

// Deletes image files no note references. Skips recent files so an image that
// was just captured into an unsaved composer is never swept.
function collectGarbage(keepIds, minAgeMs = 60 * 60 * 1000) {
  const keep = new Set(keepIds);
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir()); } catch { return 0; }
  const now = Date.now();
  for (const name of entries) {
    const id = name.slice(0, 32);
    if (!ID.test(id) || keep.has(id)) continue;
    const file = path.join(dir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs < minAgeMs) continue;
      fs.unlinkSync(file);
      removed++;
    } catch (err) {
      console.error('[images] gc failed for', name, err.message);
    }
  }
  return removed;
}

module.exports = {
  SCHEME, registerScheme, serve, store, storeBytes, readPng, collectGarbage, has, size, readFile, writeWithId, ensureThumb,
};
