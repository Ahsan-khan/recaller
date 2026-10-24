'use strict';
// For trying the iPhone app in the Simulator without the real cloud: the local mock of Google Cloud
// (tests/mock-gcp) on 127.0.0.1:9311, a test account, and a headless "Mac" (tests/support/peer.js)
// that uploads a sample board and keeps syncing, so changes made on the phone show up here and back.
//
//   node ios/core/dev-mock.js            then run the app with RECALLER_GCP_BASE=http://127.0.0.1:9311
//   test account: demo@example.com / password-1234   (only exists inside this mock)
//
// Type a line and press Enter to have the "Mac" add it as a prompt in the first column.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { createGcpMock } = require('../../tests/mock-gcp');
const { createPeer } = require('../../tests/support/peer');

const PORT = Number(process.env.PORT) || 9311;
const EMAIL = 'demo@example.com';
const PASSWORD = 'password-1234';

// A real PNG (the mock's pictures are only checked for type and size; the phone draws them): a dark
// "terminal" with a red error bar, w × h.
function samplePng(w = 900, h = 520) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      let c = [24, 28, 34];
      if (y < 36) c = [45, 50, 60];
      if (y >= 60 && y < 100 && x >= 30 && x < w - 30) c = [190, 45, 55];
      if (y >= 130 && (y - 130) % 34 < 12 && x >= 30 && x < 30 + ((y * 37) % (w - 120))) c = [120, 200, 140];
      raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const mock = createGcpMock();
  await mock.listen(PORT);
  mock.createUser({ email: EMAIL, password: PASSWORD, verified: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recaller-dev-mac-'));
  const mac = createPeer({ dir, fetchImpl: mock.fetch, base: `http://127.0.0.1:${PORT}`, name: 'mac', platform: 'darwin' });
  await mac.boot();
  const page = mac.page;
  page.deleteProject(page.data.projects[0].id); // Welcome

  const site = page.addProject('Website relaunch', { color: 'monstera' });
  page.data.projects.find((p) => p.id === site).group = 'Work';
  page.addNote(site, 'Review the new landing page copy and tighten the hero headline to under eight words.');
  const n2 = page.addNote(site, 'List every place the old logo still appears (footer, emails, favicons) and replace it.');
  page.highlight(n2, 'amber');
  page.addNote(site, 'Write release notes for 2.4: faster search, the new export menu, and the dark theme fixes.');
  const c1 = page.addNote(site, 'You are a senior frontend engineer. Audit the checkout page for accessibility issues.');
  const c2 = page.addNote(site, 'Focus on keyboard navigation, focus rings and colour contrast. List fixes by priority.');
  page.moveNote(c1, { list: 'used' });
  page.moveNote(c2, { list: 'used' });
  page.addNote(site, 'Summarise the analytics for October in five bullet points for the team update.', { list: 'combined' });

  const api = page.addProject('API cleanup', { color: 'moss' });
  page.data.projects.find((p) => p.id === api).group = 'Work';
  const pic = page.addNote(api, 'Here is the error from staging — explain what is going wrong and suggest a fix.');
  {
    const png = samplePng();
    const id = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'images', `${id}.png`), png);
    fs.writeFileSync(path.join(dir, 'images', `${id}.t.png`), png);
    page.mutate((d) => {
      const n = d.projects.find((p) => p.id === api).notes.find((x) => x.id === pic);
      n.images = [{ id, w: 900, h: 520 }];
      n.updatedAt = Date.now();
    }, { label: 'Edit note' });
  }
  page.addNote(api, 'Refactor the auth middleware so token refresh happens in one place.');
  page.data.projects.find((p) => p.id === api).eating = Date.now() - 23 * 60 * 1000;

  const ideas = page.addProject('Ideas', { color: 'sun' });
  const i1 = page.addNote(ideas, 'A weekly digest email that shows which prompts you reused the most.');
  page.highlight(i1, 'sky');
  page.addNote(ideas, 'Voice memos straight into Cooking from the lock screen.');

  const home = page.addProject('Home', { color: 'orchid' });
  page.addNote(home, 'Plan meals for the week: high protein, under 30 minutes, no mushrooms.');

  const res = await mac.signIn(EMAIL, PASSWORD);
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(res)}`);
  for (let i = 0; i < 200; i++) {
    if (mac.choice()?.kind === 'first-upload') mac.choose('upload');
    if (mac.status()?.phase === 'synced' && mac.quiet() && !mac.choice()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`mock cloud on http://127.0.0.1:${PORT} — account ${EMAIL} / ${PASSWORD}`);
  console.log('the "Mac" uploaded a sample board:', page.data.projects.map((p) => p.name).join(', '));

  // Show what arrives from the phone.
  let last = '';
  setInterval(() => {
    const names = mac.board().projects.map((p) => `${p.name}(${p.notes.length}/${p.used.length}/${p.combined.length})`).join(' ');
    if (names !== last) {
      last = names;
      console.log(`[mac] ${new Date().toLocaleTimeString()} ${names}`);
    }
  }, 1000);
  setInterval(() => { mac.syncNow().catch(() => {}); }, 5000);

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    const first = mac.page.data.projects.find((p) => !p.notepad);
    if (first) {
      mac.page.addNote(first.id, text);
      console.log(`[mac] added “${text}” to ${first.name}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
