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

function serve() {
  protocol.handle(SCHEME, (request) => {
    const match = /^\/([a-f0-9]{32})(\.t)?\.png$/.exec(new URL(request.url).pathname);
    if (!match) return new Response('Not found', { status: 404 });
    let file = match[2] ? thumbPath(match[1]) : fullPath(match[1]);
    if (!fs.existsSync(file)) file = fullPath(match[1]);
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

function readPng(id) {
  if (!ID.test(id)) throw new Error('Bad image id');
  return fs.readFileSync(fullPath(id));
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

module.exports = { SCHEME, registerScheme, serve, store, storeBytes, readPng, collectGarbage };
