const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hivem1nd", {
  browseFolder: () => ipcRenderer.invoke("hivem1nd:browse-folder"),
  serviceStatus: () => ipcRenderer.invoke('hivem1nd:service-status'),
  recoverService: () => ipcRenderer.invoke('hivem1nd:recover-service'),
});
