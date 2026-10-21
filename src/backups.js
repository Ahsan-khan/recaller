'use strict';
// Safety copies of the user's data: taken automatically before every version
// change and once a day, on demand from Settings, and before any restore.
// Each backup is a folder under <userData>/backups holding copies of the data
// and settings files plus a small backup.json describing it.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['recaller-data.json', 'recaller-settings.json'];
const KEEP = { upgrade: 30, daily: 10, manual: 20, 'before-restore': 10, 'before-sync': 10 };
const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^[0-9TZ-]+_[a-z-]+$/;

const userData = () => app.getPath('userData');
const root = () => path.join(userData(), 'backups');

function summarize(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const notes = projects.reduce((n, p) => n + (p.notes?.length || 0) + (p.used?.length || 0) + (p.combined?.length || 0), 0);
    return { projects: projects.length, notes };
  } catch {
    return { projects: 0, notes: 0, unreadable: true };
  }
}

function list() {
  let names = [];
  try { names = fs.readdirSync(root()); } catch { return []; }
  const out = [];
  for (const id of names) {
    if (!ID.test(id)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root(), id, 'backup.json'), 'utf8'));
      out.push({ id, ...meta });
    } catch {
      // A folder without readable metadata is skipped, never deleted.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function prune(kind) {
  const keep = KEEP[kind] ?? 20;
  for (const b of list().filter((x) => x.kind === kind).slice(keep)) {
    try { fs.rmSync(path.join(root(), b.id), { recursive: true, force: true }); } catch {}
  }
}

/** Copies the current data + settings files. Returns the backup id, or null if there is no data yet. */
function create(kind, meta = {}) {
  const dataFile = path.join(userData(), FILES[0]);
  if (!fs.existsSync(dataFile)) return null;
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${kind}`;
  const dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of FILES) {
    const src = path.join(userData(), name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  const info = { kind, createdAt: Date.now(), appVersion: app.getVersion(), ...meta, ...summarize(path.join(dir, FILES[0])) };
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(info, null, 2));
  prune(kind);
  return id;
}

function dailyIfDue() {
  const last = list().find((b) => b.kind === 'daily');
  if (last && Date.now() - last.createdAt < DAY_MS) return null;
  return create('daily');
}

function readData(id) {
  if (!ID.test(String(id))) throw new Error('Unknown backup');
  return JSON.parse(fs.readFileSync(path.join(root(), id, FILES[0]), 'utf8'));
}

// Image ids referenced by any backup, so image cleanup never breaks a restore.
function imageIds() {
  const ids = new Set();
  for (const b of list()) {
    try {
      const data = readData(b.id);
      for (const p of data.projects || []) {
        for (const n of [...(p.notes || []), ...(p.used || []), ...(p.combined || [])]) for (const i of n.images || []) ids.add(i.id);
        for (const i of p.draftImages || []) ids.add(i.id);
      }
      // 1.18: the Eaten history's pictures (localEaten), so a restored backup shows them too
      for (const r of Array.isArray(data.localEaten) ? data.localEaten : []) for (const i of (r && r.images) || []) ids.add(i.id);
    } catch {}
  }
  return ids;
}

module.exports = { create, list, dailyIfDue, readData, imageIds };
