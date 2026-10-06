'use strict';
// Runs the signed-out e2e suites with accounts ON, the state people get: a cloud config is present and
// nobody is signed in. A test data folder alone turns accounts off, so this points RECALLER_GCP_BASE at
// a local listener (a run from source accepts only a loopback address there) and fails the run if the
// app sends that listener anything: signed out, Recaller must make no request at all.
//   npm run test:accounts-on                  all three suites
//   npm run test:accounts-on -- features      only the named ones (multi-copy, update-safety, features)

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SUITES = ['multi-copy', 'update-safety', 'features'];
const wanted = process.argv.slice(2);
const suites = wanted.length ? wanted : SUITES;
const requests = [];

function run(suite, base) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'run-electron.js'), path.join('tests', 'e2e', `${suite}.e2e.js`)], {
      cwd: ROOT,
      env: { ...process.env, RECALLER_GCP_BASE: base },
      stdio: 'inherit',
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code));
  });
}

const server = http.createServer((req, res) => {
  requests.push(`${req.method} ${req.url.split('?')[0]}`);
  res.writeHead(503, { 'content-type': 'application/json' });
  res.end('{"error":{"code":503,"status":"UNAVAILABLE"}}');
});

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`accounts on (a local listener at ${base}), nobody signed in\n`);
  const failed = [];
  for (const suite of suites) {
    if (!SUITES.includes(suite)) {
      console.error(`unknown suite "${suite}"; choose from ${SUITES.join(', ')}`);
      failed.push(suite);
    } else if ((await run(suite, base)) !== 0) {
      failed.push(suite);
    }
  }
  server.close();
  if (requests.length) console.log(`\nFAIL  signed out, the app sent ${requests.length} request(s): ${requests.slice(0, 10).join(', ')}`);
  else console.log('\nPASS  signed out with accounts on, the app sent no request');
  if (failed.length) console.log(`failed: ${failed.join(', ')}`);
  process.exitCode = failed.length || requests.length ? 1 : 0;
});
