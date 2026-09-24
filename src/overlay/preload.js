'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shot', {
  image: () => ipcRenderer.invoke('shot:image'),
  ready: () => ipcRenderer.send('shot:ready'),
  done: (rect) => ipcRenderer.send('shot:done', rect),
  cancel: () => ipcRenderer.send('shot:cancel'),
});
