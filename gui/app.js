const elements = Object.fromEntries(['progress', 'step-form', 'fields', 'preview', 'step-title', 'step-description', 'status-message', 'live-status', 'back-button', 'continue-button', 'mode-dialog', 'mode-dialog-title', 'mode-dialog-copy', 'mode-dialog-close'].map(id => [id, document.getElementById(id)]));
const fragment = new URLSearchParams(location.hash.slice(1));
const tokenFromHash = fragment.get('session');
if (tokenFromHash) sessionStorage.setItem('hivem1nd.session', tokenFromHash);
const sessionToken = tokenFromHash ?? sessionStorage.getItem('hivem1nd.session');
history.replaceState({}, '', '/');
let currentStep;
let busy = false;
// Every button that starts an action shows a spinner while the action runs, so none of them looks stuck.
let busyButton = null;
const painters = new Map();

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function icon(name, className = '') {
  const paths = {
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="M8.3 7l7.4.8M7 8.4l1.4 7.2M16.6 10l-5.8 6.3"/>',
    net: '<circle cx="12" cy="4" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="M12 6v6M4 17v-5h16v5"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    check: '<path d="M5 12l4.5 4.5L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 6l-6 6 6 6"/>', power: '<path d="M12 3v8"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
    term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    spinner: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/>',
  };
  const template = document.createElement('template');
  template.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  const svg = template.content.firstElementChild;
  svg.setAttribute('class', className);
  return svg;
}
const card = document.getElementById('step-card');
const progressRow = el('div', 'setup-progress');
const stepCount = el('span', 'step-count');
progressRow.append(elements.progress, stepCount);
card.prepend(progressRow);
document.getElementById('language-panel').hidden = true;
const brand = document.querySelector('.brand-lockup');
const mark = document.createElement('template');
mark.innerHTML = '<svg class="brand-mark" viewBox="0 0 56 48" aria-hidden="true"><path class="mark-first" d="M14 2 26 9 26 23 14 30 2 23 2 9Z"/><path class="mark-second" d="M30 18 42 25 42 39 30 46 18 39 18 25Z"/></svg>';
brand.prepend(mark.content.firstElementChild);
function ui() { return currentStep?.ui ?? {}; }
function setError(message) {
  elements['status-message'].hidden = !message;
  elements['status-message'].textContent = message ?? '';
}
// A painter draws the content of a button for a loading or a resting state; the spinner replaces the button's icon.
function paint(button, draw) {
  painters.set(button, draw);
  button.replaceChildren(...draw(false));
}
function setBusy(value, button) {
  busy = value;
  if (!value) busyButton = null;
  else if (button) busyButton = button;
  for (const control of document.querySelectorAll('button, input, select')) control.disabled = value || control.dataset.permanentDisabled === 'true';
  for (const [target, draw] of painters) {
    // The service can already be installing when the page opens, and then Continue shows it too.
    const loading = value && target === busyButton || target === elements['continue-button'] && Boolean(currentStep?.busy);
    target.setAttribute('aria-busy', String(loading));
    target.replaceChildren(...draw(loading));
  }
  elements['step-form'].setAttribute('aria-busy', String(value));
}
async function api(path, { method = 'GET', body } = {}) {
  if (!sessionToken) throw new Error(ui().sessionMissing ?? 'The local session link is incomplete. Open the wizard again from the HIVEM1ND command.');
  const response = await fetch('/api/v1/' + path, {
    method, headers: { Authorization: 'Bearer ' + sessionToken, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? (ui().requestFailed ?? 'The local wizard request failed (status {status}).').replace('{status}', String(response.status)));
  return payload.data;
}
function renderProgress(step) {
  elements.progress.replaceChildren();
  for (let number = 1; number <= 4; number += 1) {
    const item = el('li', number === step.number ? 'current' : number < step.number ? 'complete' : '');
    item.append(el('span', 'visually-hidden', ui()['step' + number + 'Title']));
    if (number === step.number) item.setAttribute('aria-current', 'step');
    elements.progress.append(item);
  }
  stepCount.textContent = ui().stepOfFour.replace('{step}', String(step.number));
}
function offer(title, body, { id, checked = false, disabled = false, badge = null } = {}) {
  const label = el('label', 'setup-offer' + (disabled ? ' relay-plus' : ''));
  const checkbox = el('input');
  checkbox.type = 'checkbox'; checkbox.id = id; checkbox.checked = checked; checkbox.disabled = disabled;
  if (disabled) checkbox.dataset.permanentDisabled = 'true';
  const copy = el('span', 'offer-copy');
  const heading = el('span', 'offer-heading');
  heading.append(el('strong', '', title));
  if (badge) heading.append(el('span', 'offer-badge', badge));
  copy.append(heading, el('span', 'offer-body', body));
  label.append(checkbox, copy);
  return label;
}
function collectValues() {
  if (currentStep.id !== 'location') return {};
  const values = { mindPath: document.getElementById('mind-path').value.trim() };
  const legacy = document.getElementById('migrate-legacy');
  const join = document.getElementById('join-mind');
  if (legacy) values.migrateLegacy = legacy.checked;
  if (join) values.attach = join.checked;
  return values;
}
function renderLocation(step) {
  const field = el('div', 'folder-field');
  const label = el('label', '', ui().folder); label.htmlFor = 'mind-path';
  const path = el('div', 'path-control');
  const input = el('input'); input.type = 'text'; input.id = 'mind-path'; input.required = true; input.value = step.values.mindPath;
  const change = el('button', 'button plain', ui().change); change.type = 'button'; change.id = 'change-folder';
  change.addEventListener('click', async () => {
    if (busy) return;
    if (typeof window.hivem1nd?.browseFolder === 'function') {
      const chosen = await window.hivem1nd.browseFolder();
      if (chosen) { input.value = chosen; await changeFolder(); }
    } else { input.focus(); input.select(); }
  });
  input.addEventListener('change', changeFolder);
  path.append(icon('folder'), input, change); field.append(label, path); elements.fields.append(field);
  if (step.join) elements.fields.append(offer(step.join.title, step.join.body, { id: 'join-mind', checked: step.values.attach }));
  else if (step.legacy) elements.fields.append(offer(step.legacy.title, step.legacy.body, { id: 'migrate-legacy', checked: step.values.migrateLegacy }));
  elements.fields.append(offer(step.relayPlus.title, step.relayPlus.body, { id: 'relay-plus', disabled: true, badge: step.relayPlus.badge }));
}
async function changeFolder() {
  if (busy) return;
  setBusy(true); setError();
  try { render(await api('answer', { method: 'POST', body: { values: { mindPath: document.getElementById('mind-path').value.trim(), changeFolder: true } } })); }
  catch (error) { setError(error.message); }
  finally { setBusy(false); }
}
function renderLegacyDialog(step) {
  const legacy = step.legacy;
  elements['mode-dialog-title'].textContent = legacy.closeTitle;
  elements['mode-dialog-copy'].textContent = legacy.closeCopy;
  document.getElementById('legacy-sessions')?.remove();
  // The sessions start folded under their count; a long list would otherwise push the action out of view.
  const fold = document.createElement('details'); fold.setAttribute('id', 'legacy-sessions'); fold.className = 'legacy-fold';
  const count = legacy.sessions.length;
  fold.append(el('summary', '', (count === 1 ? ui().legacySessionsOne : ui().legacySessionsOther).replace('{count}', String(count))));
  const list = el('div', 'legacy-sessions'); fold.append(list);
  const clients = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode', copilot: 'GitHub Copilot', vscode: 'GitHub Copilot' };
  for (const item of legacy.sessions) {
    const row = el('div', 'legacy-session'); row.append(icon('term'), el('strong', '', item.unit), el('span', '', ui().onMachine.replace('{client}', clients[item.client] ?? item.client).replace('{machine}', item.machine))); list.append(row);
  }
  if (legacy.sessions.some(item => !item.local)) list.append(el('p', 'offline-legacy', legacy.offline));
  elements['mode-dialog-copy'].after(fold);
  elements['mode-dialog-close'].textContent = legacy.action;
  elements['mode-dialog-close'].onclick = () => closeLegacy(true);
  let cancel = document.getElementById('cancel-legacy');
  if (!cancel) { cancel = el('button', 'button ghost'); cancel.id = 'cancel-legacy'; cancel.type = 'button'; elements['mode-dialog-close'].before(cancel); }
  cancel.textContent = ui().cancel; cancel.onclick = () => closeLegacy(false);
  if (!elements['mode-dialog'].open) elements['mode-dialog'].showModal();
}
async function closeLegacy(close) {
  elements['mode-dialog'].close(); setBusy(true, elements['continue-button']);
  try {
    render(await api('answer', { method: 'POST', body: { values: { ...collectValues(), closeLegacy: close } } }));
    if (currentStep.id === 'service') await runInstall();
  } catch (error) { setError(error.message); }
  finally { setBusy(false); }
}
elements['mode-dialog'].addEventListener('cancel', event => { event.preventDefault(); void closeLegacy(false); });
function renderService(step) {
  const list = el('ol', 'service-progress'); list.setAttribute('aria-label', step.title); list.setAttribute('aria-live', 'polite');
  for (const row of step.progress) {
    const item = el('li', 'progress-row ' + row.state); item.dataset.progress = row.id;
    const status = el('span', 'progress-status'); status.setAttribute('aria-label', ui()['progress' + row.state[0].toUpperCase() + row.state.slice(1)]);
    if (row.state !== 'todo') status.append(icon(row.state === 'done' ? 'check' : row.state === 'fail' ? 'x' : 'spinner'));
    item.append(status, el('span', 'progress-copy', row.label), el('span', 'progress-time', row.elapsedSeconds === null ? '' : row.elapsedSeconds + ' s'));
    list.append(item);
  }
  elements.fields.append(list);
  if (step.failure) {
    const notice = el('div', 'setup-failure'); notice.setAttribute('role', 'alert');
    notice.append(el('strong', '', step.failure.headline), el('p', '', step.failure.body)); elements.fields.append(notice);
  }
  for (const [index, conflict] of (step.preview?.conflicts ?? []).entries()) {
    const field = el('fieldset', 'conflict-card'); field.dataset.conflictPath = conflict.path;
    field.append(el('legend', '', conflict.path), el('p', '', conflict.reason));
    for (const option of step.fields[index].options) {
      const label = el('label', 'conflict-choice'); const input = el('input'); input.type = 'radio'; input.name = 'conflict-' + index; input.value = option.value;
      input.checked = conflict.selection === option.value; input.required = true; label.append(input, document.createTextNode(option.label)); field.append(label);
    }
    elements.fields.append(field);
  }
}
function renderReady(step) {
  const summary = el('div', 'setup-summary');
  for (const row of step.summary) {
    const item = el('div', 'summary-row'); item.dataset.summary = row.id;
    item.append(icon({ mind: 'folder', legacy: 'retry', service: 'power', agents: 'term', projects: 'folder' }[row.id]), el('span', 'summary-label', row.label));
    const value = el('span', 'summary-value' + (row.id === 'mind' ? ' path-value' : ''), row.value);
    if (row.running) value.prepend(el('span', 'status-running'));
    item.append(value); summary.append(item);
  }
  elements.fields.append(summary, el('p', 'setup-note', step.notice));
}
function render(step) {
  const previousId = currentStep?.id;
  currentStep = step;
  document.documentElement.lang = step.language; document.title = ui().documentTitle;
  elements.fields.replaceChildren(); elements.preview.hidden = true;
  elements['step-title'].textContent = step.title; elements['step-description'].textContent = step.description;
  renderProgress(step); elements['back-button'].hidden = !step.back;
  painters.clear();
  paint(elements['back-button'], loading => [icon(loading ? 'spinner' : 'back', loading ? 'button-spinner' : ''), document.createTextNode(ui().back)]);
  paint(elements['continue-button'], loading => [...(loading ? [icon('spinner', 'button-spinner')] : []), document.createTextNode(step.action)]);
  if (step.id === 'install') {
    const list = el('div', 'setup-bullets'); step.bullets.forEach((copy, index) => {
      const row = el('div', 'setup-bullet'); const image = el('span', 'bullet-icon'); image.append(icon(['graph', 'net', 'zap'][index])); row.append(image, el('span', '', copy)); list.append(row);
    }); elements.fields.append(list);
  }
  if (step.id === 'location') renderLocation(step);
  if (step.id === 'service') renderService(step);
  if (step.id === 'ready') renderReady(step);
  if (step.legacy?.confirmation) renderLegacyDialog(step);
  elements['step-title'].tabIndex = -1;
  if (previousId !== step.id) elements['step-title'].focus({ preventScroll: true });
  setBusy(busy);
}
async function runInstall() {
  if (currentStep.preview?.conflicts?.some(conflict => !document.querySelector('[data-conflict-path="' + CSS.escape(conflict.path) + '"] input:checked'))) return;
  const conflicts = Object.fromEntries([...elements.fields.querySelectorAll('[data-conflict-path]')].map(field => [field.dataset.conflictPath, field.querySelector('input:checked')?.value]));
  setBusy(true, elements['continue-button']); setError();
  let pending = true;
  const install = api('install', { method: 'POST', body: { confirm: true, conflicts } }).finally(() => { pending = false; });
  const poll = (async () => { while (pending) { await new Promise(resolve => setTimeout(resolve, 1000)); if (pending) render(await api('step')); } })();
  let failed = null;
  try { await install; }
  catch (error) { failed = error; }
  finally { await poll; setBusy(false); render(await api('step')); }
  // A failed step already explains itself in its own notice; the raw request error is shown only without one.
  if (failed && !currentStep.failure) throw failed;
}
elements['step-form'].addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !elements['step-form'].reportValidity()) return;
  setBusy(true, elements['continue-button']); setError();
  try {
    if (currentStep.id === 'ready') { const opened = await api('open', { method: 'POST', body: {} }); if (opened.viewerUrl) location.assign(opened.viewerUrl); }
    else if (currentStep.id === 'service') await runInstall();
    else { render(await api('answer', { method: 'POST', body: { values: collectValues() } })); if (currentStep.id === 'service') await runInstall(); }
  } catch (error) { setError(error.message); }
  finally { setBusy(false); }
});
elements['back-button'].addEventListener('click', async () => {
  if (busy) return; setBusy(true, elements['back-button']); setError();
  try { render(await api('back', { method: 'POST', body: {} })); } catch (error) { setError(error.message); } finally { setBusy(false); }
});
try {
  render(await api('step'));
  if (currentStep.id === 'service' && !currentStep.failure) await runInstall();
} catch (error) { setError(error.message); }
