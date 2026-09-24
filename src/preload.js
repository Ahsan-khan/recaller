'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let nextReq = 1;

contextBridge.exposeInMainWorld('recaller', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.send('data:save', data),
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
  platform: process.platform,
});
