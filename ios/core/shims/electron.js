'use strict';
// The few Electron pieces src/cloud/index.js and src/backups.js touch, filled in by app-core.js at init:
// net.fetch and net.isOnline, powerMonitor's resume events, and app.getPath / getVersion / isPackaged.

const N = require('./native');

const listeners = new Map();

const electron = {
  net: {
    fetch: (...args) => globalThis.fetch(...args),
    isOnline: () => {
      try {
        return N.isOnline() !== false;
      } catch {
        return true;
      }
    },
  },
  powerMonitor: {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit(event) {
      for (const fn of listeners.get(event) || []) {
        try {
          fn();
        } catch (err) {
          console.error('[power]', err);
        }
      }
    },
  },
  app: {
    userData: '/',
    version: '0.0.0',
    isPackaged: true,
    getPath: () => electron.app.userData,
    getVersion: () => electron.app.version,
  },
};

module.exports = electron;
