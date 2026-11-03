const { contextBridge, ipcRenderer } = require('electron');

const methods = new Set(['hello', 'app.saved', 'agents.list', 'agents.send',
  'blueprint.locations', 'blueprint.list', 'blueprint.read', 'blueprint.save', 'blueprint.asset', 'blueprint.upload',
  'void.files.list', 'void.files.read', 'void.files.write', 'void.files.url', 'void.files.asset', 'void.files.attribution',
  'void.storage.load', 'void.storage.save', 'void.open.pick', 'void.open.switchTo', 'void.export.save', 'void.export.pdf', 'void.project']);
const events = new Set(['host.visible', 'host.locale', 'host.tokens', 'agents.changed', 'app.save', 'blueprint.changed', 'blueprint.locations', 'void.files.changed', 'void.project']);

if (window.top === window) contextBridge.exposeInMainWorld('cosmicBridge', Object.freeze({
  protocol: 1,
  async call(method, params = {}) {
    if (!methods.has(method)) throw { code: 'invalid' };
    if (method === 'blueprint.upload' && (params?.bytes?.byteLength > 10_000_000 || params?.bytes?.length > 10_000_000 || params?.base64?.length > 13_333_336)) throw { code: 'invalid' };
    const response = await ipcRenderer.invoke('cosmic:bridge-call', method, params).catch(() => { throw { code: 'unavailable' }; });
    if (response?.error) throw { code: response.error.code };
    return response?.result;
  },
  on(event, listener) {
    if (!events.has(event) || typeof listener !== 'function') throw { code: 'invalid' };
    const receive = (_ipcEvent, envelope) => { if (envelope?.name === event) listener(envelope.params); };
    ipcRenderer.on('cosmic:bridge-event', receive);
    return () => ipcRenderer.removeListener('cosmic:bridge-event', receive);
  },
}));
