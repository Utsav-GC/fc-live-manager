'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** The renderer gets a small, explicit API - no direct node access. */
contextBridge.exposeInMainWorld('setlist', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  scan: () => ipcRenderer.invoke('library:scan'),
  detail: (key, setIndex) => ipcRenderer.invoke('library:detail', { key, setIndex }),
  versions: (key) => ipcRenderer.invoke('library:versions', { key }),

  getSettings: () => ipcRenderer.invoke('library:get').then((d) => d.settings),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  addFolder: () => ipcRenderer.invoke('dialog:addFolder'),
  removeFolder: (folder) => ipcRenderer.invoke('dialog:removeFolder', folder),
  pickPreview: () => ipcRenderer.invoke('dialog:addPreview'),

  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openInLive: (p) => ipcRenderer.invoke('shell:openInLive', p),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  mediaUrl: (p) => ipcRenderer.invoke('media:url', p),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  dropPreview: (key, srcPath) => ipcRenderer.invoke('preview:drop', { key, srcPath }),
  hidePreview: (key) => ipcRenderer.invoke('preview:hide', { key }),
  unhidePreview: (key) => ipcRenderer.invoke('preview:unhide', { key }),

  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('library:progress', handler);
    return () => ipcRenderer.removeListener('library:progress', handler);
  },
  onLibraryChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('library:changed', handler);
    return () => ipcRenderer.removeListener('library:changed', handler);
  },
});
