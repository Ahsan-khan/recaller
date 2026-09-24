'use strict';
// Launches Electron with ELECTRON_RUN_AS_NODE removed. Some hosts (e.g. VS Code
// extension terminals) set it, which makes Electron start as plain Node.

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron'); // resolves to the binary path under Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
  windowsHide: false,
});
child.on('exit', (code) => process.exit(code ?? 0));
