'use strict';
// main.js's quit with sync (ai_memory/15, 5.16 and section 0 item 14): signed in with changes not uploaded, quitting
// waits once for a short final push; never while the computer logs out, restarts or shuts down (macOS would say
// Recaller cancelled it). On a Mac that is powerMonitor's shutdown, and a log out the person cancels stops counting
// after a minute, so a later ⌘Q pushes again. Signed out, quitting is as in 1.16. The code is taken from main.js
// itself (its session flags, the onShutdown hook it gives the facade, the session-end listener and the before-quit
// listener) and run in a vm with stand-ins for app, cloud and the clock.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

function cut(re, what) {
  const m = re.exec(src);
  assert.ok(m, `${what} found in main.js`);
  return m;
}

// From `from` to the end of the statement whose braces open first after it: `app.on('before-quit', (e) => { … });`
function block(from, what) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${what} found in main.js`);
  let i = src.indexOf('{', src.indexOf("app.on('before-quit', (e) =>", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  const end = src.indexOf(';', i);
  return src.slice(start, end + 1);
}

const flags = [...src.matchAll(/^let sessionEnding\w* = [^;\n]+;/gm)].map((m) => m[0]).join('\n');
const onShutdown = cut(/onShutdown: (\(\) => \{[^}]*\})/, 'the onShutdown hook')[1];
const onSessionEnd = cut(/win\.on\('session-end', (\(\) => \{[^}]*\})\);/, 'the session-end listener')[1];
const beforeQuit = block('let finalPushDone = false;', 'the final-push before-quit listener');

// One run of main: its flags, hooks and listener, with app, cloud and the clock stood in for.
function main({ active = true, unpushed = true } = {}) {
  const clock = { t: Date.parse('2026-10-01T12:00:00Z') };
  class FakeDate extends Date {
    static now() { return clock.t; }
  }
  const run = { clock, pushes: [], quits: 0, flushes: 0, listeners: {}, cloud: { active, unpushed } };
  const ctx = vm.createContext({
    Date: FakeDate,
    app: { on: (event, fn) => { run.listeners[event] = fn; }, quit: () => { run.quits++; } },
    cloud: {
      active: () => run.cloud.active,
      hasUnpushed: () => run.cloud.unpushed,
      finalPush: (ms) => { run.pushes.push(ms); return Promise.resolve(); },
    },
    flushData: () => { run.flushes++; },
  });
  const hooks = vm.runInContext(`${flags}\nconst onShutdown = ${onShutdown};\nconst onSessionEnd = ${onSessionEnd};\n${beforeQuit}\n({ onShutdown, onSessionEnd });`, ctx);
  run.onShutdown = hooks.onShutdown;
  run.onSessionEnd = hooks.onSessionEnd;
  // A quit: the before-quit listener, as Electron calls it. → whether it held the quit for the final push.
  run.quit = () => {
    let held = false;
    run.listeners['before-quit']({ preventDefault: () => { held = true; } });
    return held;
  };
  return run;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('signed out, or with nothing to upload, a quit is never held (as in 1.16)', () => {
  assert.equal(main({ active: false }).quit(), false);
  assert.equal(main({ active: false, unpushed: false }).quit(), false);
  const idle = main({ unpushed: false });
  assert.equal(idle.quit(), false);
  assert.deepEqual(idle.pushes, []);
});

test('signed in with changes not uploaded: one final push of 1.5 s, then the quit goes on', async () => {
  const run = main();
  assert.equal(run.quit(), true);
  assert.deepEqual(run.pushes, [1500]);
  assert.equal(run.flushes, 1, 'the save main holds goes to disk first');
  await tick();
  assert.equal(run.quits, 1, 'app.quit() once the push settled');
  assert.equal(run.quit(), false, 'the quit that follows is not held again');
});

test('Mac: during a log out, restart or shut down the quit is not held (macOS would say Recaller cancelled it)', () => {
  const run = main();
  run.onShutdown();
  run.clock.t += 5000;
  assert.equal(run.quit(), false);
  assert.deepEqual(run.pushes, []);
});

test('Mac: a log out the person cancelled stops counting after a minute, so a later ⌘Q pushes again', () => {
  const run = main();
  run.onShutdown(); // another app (or the person) cancelled the log out: Recaller keeps running
  run.clock.t += 61 * 1000;
  assert.equal(run.quit(), true);
  assert.deepEqual(run.pushes, [1500]);
});

test('Windows: once the session ends, quitting waits for nothing', () => {
  const run = main();
  run.onSessionEnd();
  run.clock.t += 10 * 60 * 1000;
  assert.equal(run.quit(), false);
  assert.deepEqual(run.pushes, []);
});
