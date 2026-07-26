'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A deliberately small, safe surface exposed to both renderer windows.
contextBridge.exposeInMainWorld('ami', {
  // --- task data ---
  getTask: () => ipcRenderer.invoke('task:get'),
  saveTask: (text) => ipcRenderer.send('task:save', text),
  onTaskUpdated: (cb) =>
    ipcRenderer.on('task:updated', (_evt, payload) => cb(payload)),

  // --- windows ---
  openEditor: () => ipcRenderer.send('editor:open'),
  cancelEditor: () => ipcRenderer.send('editor:cancel'),
  bubbleContextMenu: () => ipcRenderer.send('float:context-menu'),
});
