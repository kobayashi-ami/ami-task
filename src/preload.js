'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A bubble window is launched with --ami-project=<id> so it knows which
// project it represents.
const arg = process.argv.find((a) => a.startsWith('--ami-project='));
const projectId = arg ? arg.split('=')[1] : null;

contextBridge.exposeInMainWorld('ami', {
  projectId,

  // --- reads ---
  getProjects: () => ipcRenderer.invoke('projects:get'),
  getProject: (id) => ipcRenderer.invoke('project:get', id),

  // --- subscriptions ---
  onProjectUpdated: (cb) =>
    ipcRenderer.on('project:updated', (_e, payload) => cb(payload)),
  onProjectsUpdated: (cb) =>
    ipcRenderer.on('projects:updated', (_e, payload) => cb(payload)),
  onPanelFocus: (cb) => ipcRenderer.on('panel:focus', (_e, id) => cb(id)),

  // --- writes ---
  saveProject: (data) => ipcRenderer.send('project:save', data),
  addProject: () => ipcRenderer.invoke('project:add'),
  deleteProject: (id) => ipcRenderer.send('project:delete', id),
  setActive: (id) => ipcRenderer.send('project:setActive', id),

  // --- windows / actions ---
  openEditor: (id) => ipcRenderer.send('editor:open', id),
  cancelEditor: () => ipcRenderer.send('editor:cancel'),
  bubbleContextMenu: (id) => ipcRenderer.send('bubble:context-menu', id),
  hideBubble: (id) => ipcRenderer.send('bubble:hide', id),
  setHover: (id, hovered) => ipcRenderer.send('bubble:hover', { id, hovered }),
  openLink: (url) => ipcRenderer.send('link:open', url),
  openFolder: (p) => ipcRenderer.send('folder:open', p),
});
