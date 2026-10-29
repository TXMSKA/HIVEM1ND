const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hivem1nd", { // Compatibility: retain the installed renderer bridge and IPC channel identity.
  browseFolder: () => ipcRenderer.invoke("hivem1nd:browse-folder"), // Compatibility: retain the installed renderer bridge and IPC channel identity.
  serviceStatus: () => ipcRenderer.invoke('hivem1nd:service-status'), // Compatibility: retain the installed renderer bridge and IPC channel identity.
  recoverService: () => ipcRenderer.invoke('hivem1nd:recover-service'), // Compatibility: retain the installed renderer bridge and IPC channel identity.
  embeddedUpdate: (state) => ipcRenderer.invoke('hivem1nd:embedded-update', state),
  embeddedEvent: (event) => ipcRenderer.send('hivem1nd:embedded-event', event),
  onEmbeddedStatus: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const receive = (_event, status) => listener(status);
    ipcRenderer.on('hivem1nd:embedded-status', receive);
    return () => ipcRenderer.removeListener('hivem1nd:embedded-status', receive);
  },
});
