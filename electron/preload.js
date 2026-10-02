const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  printToPDF: (options) => ipcRenderer.invoke('print-to-pdf', options),
  saveJsonDraft: (data, defaultName) => ipcRenderer.invoke('save-json-dialog', data, defaultName),
  openJsonDraft: () => ipcRenderer.invoke('open-json-dialog'),
  onTriggerNativePdf: (callback) => {
    ipcRenderer.on('trigger-native-pdf', () => callback());
  }
});
