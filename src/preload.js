'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let nextReq = 1;

contextBridge.exposeInMainWorld('recaller', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data, meta) => ipcRenderer.send('data:save', data, meta),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  createBackup: () => ipcRenderer.invoke('backups:create'),
  restoreBackup: (id) => ipcRenderer.invoke('backups:restore', id),

  saveImage: (bytes) => ipcRenderer.invoke('image:save', bytes),
  copyImage: (id) => ipcRenderer.invoke('image:copy', id),
  gcImages: (keepIds) => ipcRenderer.invoke('images:gc', keepIds),
  captureScreen: () => ipcRenderer.invoke('shot:capture'),
  onScreenshot: (fn) => {
    const listener = (_e, result) => fn(result);
    ipcRenderer.on('shot:captured', listener);
    return () => ipcRenderer.removeListener('shot:captured', listener);
  },

  // onEvent receives { type: 'delta', delta } and { type: 'reset' } while the request runs.
  transcribe: async (bytes, mime, context, onEvent) => {
    const reqId = nextReq++;
    const listener = (_e, msg) => { if (msg.reqId === reqId) onEvent?.(msg); };
    ipcRenderer.on('stt:event', listener);
    try {
      return await ipcRenderer.invoke('stt:transcribe', { reqId, bytes, mime, context });
    } finally {
      ipcRenderer.removeListener('stt:event', listener);
    }
  },

  onSummoned: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('app:summoned', listener);
    return () => ipcRenderer.removeListener('app:summoned', listener);
  },

  // Mac only: the menu bar's commands, and the System Settings privacy panes.
  openPrivacy: (kind) => ipcRenderer.invoke('app:open-privacy', kind),
  onCommand: (fn) => {
    const listener = (_e, name) => fn(name);
    ipcRenderer.on('app:command', listener);
    return () => ipcRenderer.removeListener('app:command', listener);
  },

  // Accounts and sync (1.17): main does the network; the page sees AccountState and patches, never a token.
  account: {
    get: () => ipcRenderer.invoke('account:get'),
    signUp: (email, password, privacyVersion) => ipcRenderer.invoke('account:sign-up', { email, password, privacyVersion }),
    signIn: (email, password) => ipcRenderer.invoke('account:sign-in', { email, password }),
    resendVerification: () => ipcRenderer.invoke('account:resend-verification'),
    checkVerified: () => ipcRenderer.invoke('account:check-verified'),
    discardUnverified: () => ipcRenderer.invoke('account:discard-unverified'),
    resetPassword: (email) => ipcRenderer.invoke('account:reset-password', { email }),
    signOut: (opts = {}) => ipcRenderer.invoke('account:sign-out', {
      force: Boolean(opts.force), removeBoard: Boolean(opts.removeBoard), removeUnreadable: Boolean(opts.removeUnreadable),
    }),
    deleteAccount: (password) => ipcRenderer.invoke('account:delete', { password }),
    onChanged: (fn) => { const l = (_e, s) => fn(s); ipcRenderer.on('account:changed', l); return () => ipcRenderer.removeListener('account:changed', l); },
  },
  sync: {
    ready: (info) => ipcRenderer.send('sync:ready', info),
    nack: (info) => ipcRenderer.send('sync:nack', info),
    now: () => ipcRenderer.invoke('sync:now'),
    choose: (choice) => ipcRenderer.invoke('sync:choose', { choice }),
    onPatch: (fn) => { const l = (_e, p) => fn(p); ipcRenderer.on('sync:patch', l); return () => ipcRenderer.removeListener('sync:patch', l); },
  },
  platform: process.platform,
});
