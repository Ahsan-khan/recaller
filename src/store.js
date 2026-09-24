'use strict';
// Crash-safe JSON persistence: every write goes to a temp file first and is
// then renamed over the real one, so a crash mid-write never leaves a
// half-written file behind.

const fs = require('node:fs');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[store] could not read ${file}:`, err.message);
    return null;
  }
}

// Returns the first readable file in `candidates` (main file, then backup).
function readJsonWithFallback(file) {
  const main = readJson(file);
  if (main) return { value: main, from: file };
  const bak = readJson(file + '.bak');
  if (bak) return { value: bak, from: file + '.bak' };
  return { value: null, from: null };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  // Antivirus / indexers on Windows can briefly lock the target; retry a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(25 * (attempt + 1));
    }
  }
}

function backup(file) {
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  } catch (err) {
    console.error('[store] backup failed:', err.message);
  }
}

module.exports = { readJsonWithFallback, writeJsonAtomic, backup };
