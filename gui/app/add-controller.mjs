import * as api from './add-api.mjs';
import { ApiError } from './api.mjs';
import { renderAdd } from './add-view.mjs';

const emptyScope = () => ({ everyUnit: false, units: [], groups: [] });
const fail = code => { throw new ApiError(422, code, 'The dropped folder is not available for inspection.'); };

// File.path is deliberately never read. Only browser-provided relative entries cross HTTP.
export async function additionFiles(transfer) {
  const files = [];
  const visit = async (entry, prefix = '') => {
    if (!entry || /[\\/]/.test(entry.name) || ['.', '..'].includes(entry.name)) fail('invalid_path');
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (relative.length > 1024) fail('invalid_path');
    if (entry.isFile) files.push({ path: relative, file: await new Promise((resolve, reject) => entry.file(resolve, reject)) });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, relative);
      }
    } else fail('invalid_path');
    if (files.length > 1024) fail('addition_too_large');
  };
  const entries = [...(transfer.items ?? [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  let name;
  if (entries.length) {
    if (entries.length !== 1 || !entries[0].isDirectory) fail('invalid_source');
    name = entries[0].name;
    const reader = entries[0].createReader();
    for (;;) {
      const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child);
    }
  } else {
    for (const file of transfer.files ?? []) {
      const relative = file.webkitRelativePath;
      if (!relative || !relative.includes('/')) fail('invalid_path');
      const [root, ...parts] = relative.split('/');
      if (name && name !== root) fail('invalid_source');
      name = root; files.push({ path: parts.join('/'), file });
    }
  }
  let size = 0;
  const seen = new Set();
  if (!name || !files.length || files.length > 1024) fail('addition_too_large');
  for (const item of files) {
    if (!item.path || item.path.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(item.path)
      || item.path.split('/').some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part))
      || seen.has(item.path.toLowerCase())) fail('invalid_path');
    seen.add(item.path.toLowerCase());
    if (!Number.isSafeInteger(item.file.size) || item.file.size < 0 || item.file.size > 16 * 1024 * 1024
      || (size += item.file.size) > 64 * 1024 * 1024) fail('addition_too_large');
  }
  return { name, files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')) };
}

export function createAddController(client, { state = {}, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), onChange = () => {}, onAccepted = async () => {} } = {}) {
  state.model ??= { language: 'en', stage: 'source', link: '', preview: null, selected: [], scopes: {}, choices: { units: [], groups: [] }, busy: false, errorCode: null };
  const controller = { api: client, state, model: state.model, schedule, cancel, onChange, onAccepted, timer: null, poll: null, dialog: null, disposed: false };
  controller.paint = () => { paintAdd(controller); onChange(); };
  return controller;
}

function clearTimers(controller) {
  controller.cancel(controller.timer); controller.cancel(controller.poll); controller.timer = null; controller.poll = null;
}
function remember(controller, preview) {
  const model = controller.model, previous = model.preview;
  if (!previous || previous.id !== preview.id) {
    const chosen = previous?.candidates.filter(item => model.selected.includes(item.id)) ?? [];
    const scopes = model.scopes;
    model.selected = preview.candidates.filter(item => item.supported && (chosen.length
      ? chosen.some(old => old.name === item.name && old.kind === item.kind) : false)).map(item => item.id);
    model.scopes = Object.fromEntries(preview.candidates.map(item => {
      const old = chosen.find(value => value.name === item.name && value.kind === item.kind);
      return [item.id, scopes[old?.id] ?? emptyScope()];
    }));
  }
  model.preview = preview; model.choices = preview.choices;
  if (controller.state.updateTitle && !model.selected.length) {
    const item = preview.candidates.find(item => item.supported && item.title === controller.state.updateTitle);
    if (item) { model.selected = [item.id]; model.scopes[item.id] = structuredClone(controller.state.updateScope ?? emptyScope()); }
  }
  // A failed attempt can be retried under the same preview, with the same candidate identities.
  for (const id of model.selected) {
    const scope = model.scopes[id] ??= emptyScope();
    scope.units = scope.units.filter(id => preview.choices.units.some(unit => unit.id === id));
    scope.groups = scope.groups.filter(id => preview.choices.groups.some(cluster => cluster.id === id));
  }
  model.errorCode = preview.error?.code ?? null;
}
async function accepted(controller, result) {
  controller.state.operation = null; controller.state.pending = null;
  controller.state.result = result;
  controller.model.busy = false;
  closeAdd(controller);
  await controller.onAccepted(result);
  controller.state.model = controller.model = { ...controller.model, preview: null, selected: [], scopes: {}, stage: 'source', errorCode: null };
  controller.state.updateOf = null; controller.state.updateTitle = null; controller.state.machine = null;
}
async function readPreview(controller, preview) {
  remember(controller, preview);
  if (preview.state === 'accepted') { await accepted(controller, preview.result); return; }
  if (preview.state === 'inspecting') {
    controller.state.pollStarted ??= controller.api.now();
    if (controller.api.now() - controller.state.pollStarted >= 30_000) {
      controller.model.busy = false; controller.model.errorCode = 'source_timeout'; controller.state.pending = 'poll'; return;
    }
    controller.model.busy = true;
    controller.poll = controller.schedule(() => execute(controller, 'poll', () => api.getAdditionPreview(controller.api, preview.id)), 150);
    controller.poll?.unref?.();
  } else { controller.model.busy = false; controller.state.pollStarted = null; }
}
async function execute(controller, kind, work) {
  if (kind === 'poll' || kind === 'check') controller.state.pending = kind;
  controller.model.busy = true; controller.model.errorCode = null; controller.paint();
  try {
    const response = await work();
    if (controller.disposed) return;
    controller.state.operation = null;
    if (kind === 'accept') await accepted(controller, response.data);
    else await readPreview(controller, response.data);
    if (!controller.model.busy && response.data.state !== 'inspecting') controller.state.pending = null;
    return response.data;
  } catch (error) {
    if (controller.disposed) return;
    controller.model.busy = false; controller.model.errorCode = error.code ?? 'unknown';
    controller.state.operation = !error.status || error.status >= 500 ? error.operation ?? controller.state.operation : null;
  } finally { if (!controller.disposed) controller.paint(); }
}

export function inspectAdd(controller, link = controller.model.link, immediate = false) {
  if (controller.model.busy || controller.state.operation) return;
  controller.model.link = link;
  controller.cancel(controller.timer);
  const inspect = () => {
    controller.timer = null;
    if (!link.trim()) return;
    controller.state.source = { kind: 'link', url: link.trim() };
    controller.state.pollStarted = null;
    controller.state.pending = 'inspect';
    return execute(controller, 'inspect', () => api.inspectAdditionSource(controller.api, controller.state.machine, controller.state.source, controller.state.updateOf ?? null));
  };
  if (immediate) return inspect();
  controller.timer = controller.schedule(inspect, 300); controller.timer?.unref?.();
}

export function selectAddition(controller, id, checked) {
  if (controller.model.busy || controller.state.operation) return;
  if (!controller.model.preview?.candidates.some(item => item.id === id && item.supported)) return;
  const selected = new Set(controller.model.selected);
  if (checked) selected.add(id); else selected.delete(id);
  controller.model.selected = [...selected]; controller.model.scopes[id] ??= emptyScope(); controller.paint();
}
export function scopeAddition(controller, candidateId, kind, id, checked) {
  if (controller.model.busy || controller.state.operation) return;
  const scope = controller.model.scopes[candidateId] ??= emptyScope();
  if (kind === 'everyUnit') { scope.everyUnit = checked; scope.units = []; scope.groups = []; }
  else {
    const collection = kind === 'group' ? 'groups' : 'units';
    if (!controller.model.choices[collection].some(item => item.id === id)) return;
    scope.everyUnit = false;
    const ids = new Set(scope[collection]); if (checked) ids.add(id); else ids.delete(id); scope[collection] = [...ids];
  }
  controller.paint();
}
export async function continueAdd(controller) {
  if (controller.model.busy || controller.state.operation || !controller.model.selected.length) return;
  const preview = await execute(controller, 'check', () => api.getAdditionPreview(controller.api, controller.model.preview.id));
  if (preview?.state === 'ready') { controller.model.stage = 'check'; controller.paint(); }
}
export function acceptAdd(controller) {
  if (controller.model.busy || controller.state.operation || controller.model.stage !== 'check') return;
  const { preview, selected, scopes } = controller.model;
  const selections = preview.candidates.filter(item => selected.includes(item.id)).map(item => ({ candidateId: item.id,
    scope: item.kind === 'repository' ? emptyScope() : structuredClone(scopes[item.id] ?? emptyScope()) }));
  if (!selections.length || selections.some(selection => {
    const item = preview.candidates.find(item => item.id === selection.candidateId), scope = selection.scope;
    return !item.supported || !item.check.eligible || item.kind !== 'repository' && !scope.everyUnit && !scope.units.length && !scope.groups.length;
  })) return;
  controller.state.input = { machine: controller.state.machine, previewId: preview.id, selections,
    expectedContentRevision: preview.contentRevision, expectedProjectRevision: preview.projectRevision };
  controller.state.pending = 'accept';
  return execute(controller, 'accept', () => api.acceptAdditions(controller.api, controller.state.input));
}
export function retryAdd(controller) {
  if (controller.model.busy) return;
  const state = controller.state, preview = controller.model.preview;
  if (['poll', 'check'].includes(state.pending) && preview && !['preview_expired', 'preview_changed', 'source_changed', 'scope_changed'].includes(controller.model.errorCode)) {
    state.pollStarted = null; return execute(controller, 'poll', () => api.getAdditionPreview(controller.api, preview.id));
  }
  if (state.pending === 'upload') return uploadAdd(controller);
  if (state.operation) {
    if (state.pending === 'accept') return execute(controller, 'accept', async () => {
      const current = await api.getAdditionPreview(controller.api, state.input.previewId);
      return current.data.state === 'accepted' ? { data: current.data.result } : api.acceptAdditions(controller.api, state.input, state.operation);
    });
    return execute(controller, 'inspect', () => api.inspectAdditionSource(controller.api, state.machine, state.source, state.updateOf ?? null, state.operation));
  }
  if (preview?.state === 'failed') return execute(controller, 'retry', () => api.retryAdditionPreview(controller.api, preview.id));
  if (controller.model.errorCode === 'unknown' && preview) return execute(controller, 'poll', () => api.getAdditionPreview(controller.api, preview.id));
  controller.model.stage = 'source'; state.pending = 'inspect';
  return execute(controller, 'inspect', () => api.inspectAdditionSource(controller.api, state.machine, state.source, state.updateOf ?? null));
}

export async function uploadAdd(controller, transfer = null) {
  if (controller.model.busy) return;
  controller.cancel(controller.timer); controller.model.busy = true; controller.model.errorCode = null; controller.paint();
  const state = controller.state;
  try {
    if (transfer) state.upload = { ...await additionFiles(transfer), id: null, file: 0, chunk: 0 };
    const upload = state.upload;
    state.pending = 'upload';
    if (!upload.id) { upload.id = (await api.beginAdditionUpload(controller.api, state.machine, upload.name, state.operation)).data.uploadId; state.operation = null; }
    for (; upload.file < upload.files.length; upload.file++, upload.chunk = 0) {
      const item = upload.files[upload.file], total = Math.max(1, Math.ceil(item.file.size / 65536));
      for (; upload.chunk < total; upload.chunk++) {
        const bytes = new Uint8Array(await item.file.slice(upload.chunk * 65536, (upload.chunk + 1) * 65536).arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        await api.sendAdditionChunk(controller.api, upload.id, { path: item.path, index: upload.chunk, total, base64: btoa(binary) }, state.operation);
        state.operation = null;
      }
    }
    state.source = { kind: 'folder', uploadId: upload.id }; state.pending = 'inspect';
    await execute(controller, 'inspect', () => api.inspectAdditionSource(controller.api, state.machine, state.source, state.updateOf ?? null));
  } catch (error) {
    controller.model.busy = false; controller.model.errorCode = error.code ?? 'unknown';
    state.operation = !error.status || error.status >= 500 ? error.operation ?? null : null;
  } finally { controller.paint(); }
}

export function openAdd(controller, document, { language = 'en', machine, update = null } = {}) {
  if (controller.disposed) return;
  if (controller.dialog) { controller.dialog.querySelector('input, button')?.focus(); return controller.dialog; }
  const model = controller.model, state = controller.state;
  if (update && state.updateOf !== (update.additionId ?? update.id)) {
    if (state.operation || model.busy) return;
    model.preview = null; model.selected = []; model.scopes = {}; model.stage = 'source'; model.errorCode = null;
    model.link = update.source?.url ?? ''; state.updateOf = update.additionId ?? update.id;
    state.updateScope = update.scope;
    state.updateTitle = update.title;
  }
  state.machine = state.machine ?? machine; model.language = language;
  controller.document = document; controller.invoker = document.activeElement;
  controller.dialog = renderAdd(document, model, {});
  controller.dialog.addEventListener('cancel', event => { event.preventDefault(); closeAdd(controller); });
  controller.dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeAdd(controller); }
    if (event.key === 'Tab') {
      const controls = [...controller.dialog.querySelectorAll('button, input')].filter(node => !node.disabled);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  controller.dialog.addEventListener('dragover', event => event.preventDefault());
  controller.dialog.addEventListener('drop', event => { event.preventDefault(); if (!model.busy && !state.operation && model.stage === 'source') uploadAdd(controller, event.dataTransfer); });
  document.body.append(controller.dialog); controller.paint(); controller.dialog.showModal();
  controller.dialog.querySelector('input, button')?.focus();
  if (update?.source?.url && !model.preview) inspectAdd(controller, model.link, true);
  else if (model.preview) execute(controller, 'poll', () => api.getAdditionPreview(controller.api, model.preview.id));
  return controller.dialog;
}
export function closeAdd(controller, force = false) {
  if (!force && (controller.model.busy || controller.state.operation)) return;
  controller.cancel(controller.timer); controller.timer = null;
  const dialog = controller.dialog; controller.dialog = null;
  controller.focus = null;
  dialog?.close(); dialog?.remove();
  const action = controller.invoker?.getAttribute?.('data-action');
  (action ? controller.document?.querySelector(`[data-action="${action}"]`) : controller.invoker)?.focus?.();
}
export function disposeAdd(controller) { controller.disposed = true; clearTimers(controller); closeAdd(controller, true); }

function paintAdd(controller) {
  const dialog = controller.dialog, model = controller.model;
  if (!dialog) return;
  const active = controller.document.activeElement, focused = dialog.contains?.(active);
  if (focused) controller.focus = { id: active.getAttribute('id'), action: active.getAttribute('data-action'),
    index: [...dialog.querySelectorAll('button, input')].indexOf(active), selection: [active.selectionStart, active.selectionEnd] };
  const content = renderAdd(controller.document, model, {
    onInspect: value => { if (value !== controller.model.preview?.sourceDisplay && value !== controller.state.source?.url) inspectAdd(controller, value); },
    onSelect: (id, checked) => selectAddition(controller, id, checked), onScope: (...args) => scopeAddition(controller, ...args),
    onContinue: () => continueAdd(controller), onAccept: () => acceptAdd(controller), onRetry: () => retryAdd(controller),
    onBack: () => { if (!model.busy && !controller.state.operation) { model.stage = 'source'; controller.paint(); } }, onCancel: () => closeAdd(controller),
  });
  dialog.setAttribute('data-add-stage', model.stage); dialog.setAttribute('aria-busy', String(model.busy));
  dialog.setAttribute('aria-labelledby', content.getAttribute('aria-labelledby'));
  dialog.replaceChildren(...content.childNodes);
  if (controller.state.operation) for (const node of dialog.querySelectorAll('input, button')) {
    if (!['add-confirm', 'add-continue'].includes(node.getAttribute('data-action'))) node.disabled = true;
  }
  const input = dialog.querySelector('[id="add-link"]');
  input?.addEventListener('input', () => inspectAdd(controller, input.value));
  input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); inspectAdd(controller, input.value, true); } });
  if (controller.focus && (focused || controller.document.activeElement === controller.document.body || controller.document.activeElement === dialog)) {
    const { id, action, index, selection } = controller.focus;
    const next = (id ? dialog.querySelector(`[id="${id}"]`) : action ? dialog.querySelector(`[data-action="${action}"]`) : dialog.querySelectorAll('button, input')[index]);
    if (next && !next.disabled && next.getAttribute('disabled') === null) {
      next.focus(); if (selection.every(Number.isInteger)) next.setSelectionRange?.(...selection);
    }
  }
}
