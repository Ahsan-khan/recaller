'use strict';
// Deletes accounts whose email was never verified (ai_memory/15_accounts_and_sync.md, 2.7). They hold no cloud
// data, because every security rule requires a verified email. A dry run by default: it only lists them.
//
//   node infra/scripts/purge-unverified.js             list unverified accounts created more than 7 days ago
//   node infra/scripts/purge-unverified.js --days 30   another age, in whole days (at least 1)
//   node infra/scripts/purge-unverified.js --apply     delete them
//
// It uses the owner's gcloud login (set GCLOUD to use another gcloud than ~/google-cloud-sdk/bin/gcloud or the one on
// the PATH). Emails are shown masked. Right before deleting, each account is looked up again, and one verified
// since the listing is kept.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const PROJECT = 'recaller-cloud';
const ADMIN = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
const DAY = 24 * 60 * 60 * 1000;
const PAGE = 500; // accounts:query returns at most 500 per call
const LOOKUP = 100;
const BATCH_DELETE = 1000; // accounts:batchDelete takes at most 1000 ids
const USAGE = 'usage: node infra/scripts/purge-unverified.js [--days N] [--apply]';

function gcloudToken() {
  const bundled = path.join(os.homedir(), 'google-cloud-sdk', 'bin', process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud');
  const gcloud = process.env.GCLOUD || (fs.existsSync(bundled) ? bundled : 'gcloud');
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  try {
    const out = process.platform === 'win32'
      ? execSync(`"${gcloud}" auth print-access-token`, opts)
      : execFileSync(gcloud, ['auth', 'print-access-token'], opts);
    return out.trim();
  } catch {
    throw new Error(`Could not get a token from ${gcloud}. Sign in with: gcloud auth login --update-adc`);
  }
}

function parseArgs(argv) {
  const opts = { apply: false, days: 7 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const days = /^--days(?:=(.*))?$/.exec(arg);
    if (arg === '--apply') opts.apply = true;
    else if (days) {
      const value = days[1] ?? argv[++i];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1) throw new Error('--days needs a whole number of days, at least 1');
      opts.days = Number(value);
    } else throw new Error(USAGE);
  }
  return opts;
}

// a•••@gmail.com, as the app masks emails.
function mask(email) {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : '(no email)';
}

async function call(token, method, body) {
  let res;
  try {
    res = await fetch(`${ADMIN}:${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new Error(`accounts:${method}: ${err?.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(`accounts:${method}: HTTP ${res.status} ${[data?.error?.status, data?.error?.message].filter(Boolean).join(' ')}`);
  return data ?? {};
}

async function listAll(token) {
  const users = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await call(token, 'query', { returnUserInfo: true, limit: String(PAGE), offset: String(offset), sortBy: 'CREATED_AT' });
    const page = Array.isArray(data.userInfo) ? data.userInfo : [];
    users.push(...page);
    if (page.length < PAGE) return users;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = gcloudToken();
  const cutoff = Date.now() - opts.days * DAY;
  const all = await listAll(token);
  const stale = all.filter((u) => typeof u?.localId === 'string' && u.emailVerified !== true && Number(u.createdAt) < cutoff);
  console.log(`${PROJECT}: ${stale.length} of ${all.length} accounts are unverified and more than ${opts.days} days old.`);
  for (const u of stale) {
    console.log(`  ${new Date(Number(u.createdAt)).toISOString().slice(0, 10)}  ${mask(u.email)}  (uid ${u.localId})`);
  }
  if (!stale.length) return;
  if (!opts.apply) {
    console.log('Dry run: nothing was deleted. Run it again with --apply to delete them.');
    return;
  }

  // Look each one up again: an account verified since the listing is kept.
  const ids = [];
  for (let i = 0; i < stale.length; i += LOOKUP) {
    const data = await call(token, 'lookup', { localId: stale.slice(i, i + LOOKUP).map((u) => u.localId) });
    for (const u of Array.isArray(data.users) ? data.users : []) {
      if (u.emailVerified !== true && Number(u.createdAt) < cutoff) ids.push(u.localId);
    }
  }
  if (ids.length < stale.length) console.log(`Kept ${stale.length - ids.length}: verified or gone since the listing.`);

  // The body is the documented one ({ localIds, force }); force deletes accounts that aren't disabled too.
  let deleted = 0;
  const errors = [];
  for (let i = 0; i < ids.length; i += BATCH_DELETE) {
    const batch = ids.slice(i, i + BATCH_DELETE);
    const data = await call(token, 'batchDelete', { localIds: batch, force: true });
    const failed = Array.isArray(data.errors) ? data.errors : [];
    deleted += batch.length - failed.length;
    errors.push(...failed);
  }
  console.log(`Deleted ${deleted} of ${ids.length}.`);
  for (const e of errors) console.log(`  not deleted: uid ${e.localId ?? `#${e.index}`}: ${e.message ?? 'no reason given'}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`purge-unverified: ${err.message}`);
  process.exit(1);
});
