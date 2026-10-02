'use strict';
// src/images.js, the recaller-img:// protocol and the picture image:copy reads, in plain Node with a stand-in
// for require('electron'). A picture another computer added can be here as its 640 px preview only (after a
// sign-out, or offline): it is then shown and copied from that preview. Pictures made here (the full size and
// its preview, both written by store()) are served exactly as in 1.16.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { fileURLToPath } = require('node:url');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-images-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let handler = null;
const electron = {
  app: { getPath: (name) => (name === 'userData' ? root : os.tmpdir()) },
  protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme, fn) => { handler = fn; } },
  net: { fetch: async (url) => new Response(fs.readFileSync(fileURLToPath(url))) },
  nativeImage: {},
};
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'electron' ? 'electron' : resolveFilename.call(this, request, ...rest);
};
require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: electron };
const images = require('../../src/images');

const dir = path.join(root, 'images');
const FULL = Buffer.from('full-size picture');
const THUMB = Buffer.from('its 640 px preview');
let n = 0;
function picture({ full = true, thumb = true } = {}) {
  const id = (++n).toString(16).padStart(32, '0');
  fs.mkdirSync(dir, { recursive: true });
  if (full) fs.writeFileSync(path.join(dir, `${id}.png`), FULL);
  if (thumb) fs.writeFileSync(path.join(dir, `${id}.t.png`), THUMB);
  return id;
}

async function get(id, thumb = false) {
  const res = await handler({ url: `recaller-img://img/${id}${thumb ? '.t' : ''}.png` });
  return res.status === 404 ? 404 : Buffer.from(await res.arrayBuffer()).toString();
}

test('signed out (no fetchMissing): each file as before; a picture known only by its preview shows and copies from it', async () => {
  images.serve();
  const both = picture();
  assert.equal(await get(both), FULL.toString());
  assert.equal(await get(both, true), THUMB.toString());
  assert.equal(images.readPng(both).toString(), FULL.toString(), 'copying copies the full size');

  const fullOnly = picture({ thumb: false });
  assert.equal(await get(fullOnly, true), FULL.toString(), 'a missing preview still falls back to the full size');

  const previewOnly = picture({ full: false });
  assert.equal(await get(previewOnly), THUMB.toString(), 'the lightbox shows the preview');
  assert.equal(images.readPng(previewOnly).toString(), THUMB.toString(), 'copying copies the preview');

  const none = picture({ full: false, thumb: false });
  assert.equal(await get(none), 404);
  assert.equal(await get(none, true), 404);
  assert.throws(() => images.readPng(none), { code: 'ENOENT' });
  assert.throws(() => images.readPng('../x'), /Bad image id/);
});

test('signed in: the account is asked for the full size first; the preview is used only when it can\'t be had', async () => {
  const asked = [];
  let canFetch = true;
  images.serve({
    fetchMissing: async (id, thumb) => {
      asked.push([id, thumb]);
      if (canFetch) fs.writeFileSync(path.join(dir, `${id}${thumb ? '.t' : ''}.png`), FULL);
      return canFetch;
    },
  });
  const fetched = picture({ full: false });
  assert.equal(await get(fetched), FULL.toString(), 'downloaded, then served');
  assert.deepEqual(asked, [[fetched, false]]);

  canFetch = false; // offline
  const offline = picture({ full: false });
  assert.equal(await get(offline), THUMB.toString(), 'offline: the preview, not a broken picture');
  assert.deepEqual(asked.at(-1), [offline, false]);
});
