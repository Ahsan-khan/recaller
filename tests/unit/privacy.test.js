'use strict';
// The privacy note "What's stored and where" (ai_memory/15, 6.7): the page (src/renderer/account.js), the README
// and the spec say the same words, and those words cover what the account really keeps: a deleted note's
// pictures, and every field of a computer's own record (users/{uid}/devices/{id}).
// Plain Node, against the GCP mock and the headless peer: node --test tests/unit/privacy.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGcpMock } = require('../mock-gcp');
const { createPeer, createFakeTime, settle } = require('../support/peer');

const ROOT = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${from} found`);
  return text.slice(start, end);
};

function notes() {
  const page = between(read('src/renderer/account.js'), '<details class="privacy-note">', '</details>');
  const readme = between(read('README.md'), "### What's stored and where", '\n## ');
  const spec = between(read('ai_memory/15_accounts_and_sync.md'), '### 6.7 Privacy note', '### 6.8');
  return {
    page: [...page.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1])),
    readme: readme.split('\n').filter((l) => l.startsWith('- ')).map((l) => plain(l.slice(2))),
    spec: spec.split('\n').filter((l) => l.startsWith('> - ')).map((l) => plain(l.slice(4))),
  };
}

const bullet = (list, start) => list.find((b) => b.startsWith(start)) || '';

test('the page, the README and the spec show the same privacy note', () => {
  const { page, readme, spec } = notes();
  assert.equal(page.length, 8, 'eight points');
  assert.deepEqual(readme, page, 'README "What\'s stored and where" = the page');
  assert.deepEqual(spec, page, 'spec 6.7 = the page');
});

test('the note says a picture stays in the account until the account is deleted, even after its note is erased', () => {
  const board = bullet(notes().page, 'Your board:');
  assert.match(board, /Notes and projects you delete are kept for 30 days so they can be recovered, then erased; only a small record that each was deleted, with no text, stays until the account is deleted\./);
  assert.match(board, /Pictures stay in your account until the account is deleted, even after the note or draft that held them is gone\./);
});

test('every field of a computer\'s record in the account is named in the note', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-privacy-test-'));
  try {
    const time = createFakeTime();
    const mock = createGcpMock({ now: time.now });
    mock.createUser({ email: 'alice@example.com', password: 'correct horse battery', verified: true });
    const peer = createPeer({ dir: path.join(root, 'mac'), fetchImpl: mock.fetch, time, platform: 'darwin' });
    await peer.boot();
    assert.deepEqual(await peer.signIn('alice@example.com', 'correct horse battery'), { ok: true });
    await settle([peer], time);
    if (peer.choice()) {
      peer.choose('upload');
      await settle([peer], time);
    }
    const projectId = peer.board().projects[0].id;
    peer.page.addNote(projectId, 'a note');
    await settle([peer], time);
    const uid = mock.user('alice@example.com').uid;
    const records = Object.values(mock.docs(uid).devices || {});
    assert.equal(records.length, 1, 'this computer wrote its record');
    // Each stored field, and the words of the note that name it.
    const WORDS = {
      name: 'its name ("Mac" or "Windows PC")',
      platform: 'platform',
      appVersion: 'Recaller version',
      lastSeenAt: 'last sync time',
      lastRev: 'last sync time', // the board's revision at that sync
      drafts: 'its unsaved drafts and their pictures',
      view: 'its view (column widths, folded sections, scroll positions, density, title font, Cooked colour)',
      settings: 'these settings: colour theme, voice model, language, vocabulary hint, the two shortcuts, and "hide after copying"',
    };
    const own = bullet(notes().page, "Each computer's own things,");
    for (const field of Object.keys(records[0])) {
      assert.ok(Object.hasOwn(WORDS, field), `the record's field ${field} is accounted for here`);
      assert.ok(own.includes(WORDS[field]), `the note names ${field}: "${WORDS[field]}"`);
    }
    peer.kill?.();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
