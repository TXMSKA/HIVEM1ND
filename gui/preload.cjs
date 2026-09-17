const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hivem1nd", {
  browseFolder: () => ipcRenderer.invoke("hivem1nd:browse-folder"),
});
