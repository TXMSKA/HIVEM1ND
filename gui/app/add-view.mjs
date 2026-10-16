import { element, labelDialog, progressMark } from './components.mjs';
export const ADD_COPY = Object.freeze({
  title: ['Add to M1ND', 'Agregar al M1ND'],
  add: ['Add', 'Agregar'],
  linkHint: ['A GitHub or GitLab repository link, an npm package link, or a dropped folder', 'Un enlace a un repositorio de GitHub o GitLab, un enlace a un paquete de npm o una carpeta soltada'],
  droppedFolder: ['A dropped folder can be inspected, but it cannot be added: it has no pinned commit or release date. Add it from its repository link instead.', 'Una carpeta soltada se puede inspeccionar, pero no se puede agregar: no tiene un commit fijado ni una fecha de publicación. Agregarla desde el enlace de su repositorio.'],
  link: ['Link', 'Enlace'],
  found: ['Found in {source}, {kind} {pin}', 'Detectado en {source}, {kind} {pin}'],
  commit: ['commit', 'commit'], version: ['version', 'versión'], snapshot: ['snapshot', 'copia'],
  skill: ['Skill', 'Skill'], repository: ['Repository', 'Repositorio'], docs: ['Docs', 'Documentación'],
  'tool-server': ['Tool server', 'Servidor de herramientas'],
  docsDescription: ['Documentation', 'Documentación'], repositoryDescription: ['Git repository', 'Repositorio Git'],
  repositoryScope: ['A repository becomes a cluster. Its first agent can be added after acceptance.', 'El repositorio se convierte en un clúster. Se puede agregar el primer agente después de la confirmación.'],
  toolDescription: ['Available after 3.0', 'Disponible después de 3.0'],
  cancel: ['Cancel', 'Cancelar'], back: ['Back', 'Volver'], continue: ['Continue', 'Continuar'],
  inspect: ['Reading the source', 'Leyendo el origen'], adding: ['Adding', 'Agregando'],
  addName: ['Add {name}', 'Agregar {name}'], addMany: ['Add {count} items', 'Agregar {count} elementos'],
  checkSub: ['{kind} from {source}. Nothing is copied until you press {action}.', '{kind} de {source}. No se copia nada hasta seleccionar {action}.'],
  pinned: ['Pinned to {kind} {pin}', 'Fijado a {kind} {pin}'],
  unknownPin: ['The pin could not be verified', 'No se pudo verificar la versión fijada'],
  updateHint: ['updates wait for your yes', 'las actualizaciones requieren confirmación'],
  license: ['{license} license', 'Licencia {license}'],
  unknownLicense: ['License not reported', 'Licencia no informada'],
  age: ['Older than 7 days, no install scripts', 'Más de 7 días, sin ejecutar scripts de instalación'],
  young: ['Less than 7 complete days old', 'Antigüedad menor a 7 días completos'],
  unknownAge: ['Age could not be verified', 'No se pudo verificar la antigüedad'],
  scriptUnknown: ['No-install-script execution could not be verified', 'No se pudo verificar que no se ejecutaron scripts de instalación'],
  needs: ['Its scripts run {requirements}', 'Los scripts utilizan {requirements}'],
  noRuntime: ['No executable runtime required', 'No se requiere un entorno de ejecución'],
  unknownRuntime: ['Runtime requirements could not be verified', 'No se pudieron verificar los requisitos de ejecución'],
  native: ['Native executable', 'Ejecutable nativo'],
  onlyUnits: ['only in the units below', 'solo en las unidades seleccionadas'],
  who: ['Who can use it', 'Quién puede utilizarlo'], every: ['Every unit', 'Todas las unidades'],
  groupOne: ['Cluster, 1 agent', 'Clúster, 1 agente'], groupMany: ['Cluster, {count} agents', 'Clúster, {count} agentes'],
  originOne: ['from {source}, 1 unit', 'de {source}, 1 unidad'], originMany: ['from {source}, {count} units', 'de {source}, {count} unidades'],
  addedOne: ['{name} added for 1 unit', '{name} agregado para 1 unidad'], addedMany: ['{name} added for {count} units', '{name} agregado para {count} unidades'],
  remove: ['Remove', 'Quitar'], undo: ['Undo', 'Deshacer'], retry: ['Retry', 'Reintentar'],
  checkUpdates: ['Check for updates', 'Comprobar actualizaciones'],
  removeTitle: ['Remove {name}?', '¿Quitar {name}?'],
  removeContent: ['Its added content and access are removed. Kit content and source files stay. Undo is available for 10 s.', 'Se quitan el contenido agregado y su acceso. Se conservan el contenido del kit y los archivos de origen. Deshacer está disponible durante 10 s.'],
  removeRepository: ['The repository link is removed. The cluster, agents and files stay. Undo is available for 10 s.', 'Se quita el vínculo del repositorio. Se conservan el clúster, los agentes y los archivos. Deshacer está disponible durante 10 s.'],
  projectOrigin: ['Cluster from {source}', 'Clúster de {source}'],
  noUnits: ['No agents yet', 'Todavía no hay agentes'],
  repoPinned: ['The repository is pinned at commit {pin}. Add its first agent to start working on it.', 'El repositorio está fijado al commit {pin}. Agregar el primer agente para comenzar a trabajar.'],
  newUnit: ['New agent in {project}', 'Nuevo agente en {project}'],
  repoAdded: ['{project} added', '{project} agregado'], newUnitShort: ['New agent', 'Nuevo agente'],
  newProject: ['new', 'nuevo'],
  failureHint: ['The selection is kept. Retry checks the saved operation before sending it again.', 'Se conserva la selección. Reintentar comprueba la operación guardada antes de volver a enviarla.'],
  error_source_unavailable: ['The source could not be read. Check the link and retry.', 'No se pudo leer el origen. Comprobar el enlace y reintentar.'],
  error_source_timeout: ['The source did not answer in 30 s.', 'El origen no respondió en 30 s.'],
  error_invalid_source: ['The source is not valid. Accepted sources are a GitHub or GitLab repository link with an owner and a name, an npm package link, or a dropped folder.', 'El origen no es válido. Se aceptan un enlace a un repositorio de GitHub o GitLab con propietario y nombre, un enlace a un paquete de npm o una carpeta soltada.'],
  error_invalid_path: ['The source contains an unsafe file path or link.', 'El origen contiene una ruta de archivo o enlace no seguro.'],
  error_addition_too_large: ['The source exceeds the file or size limit.', 'El origen supera el límite de archivos o tamaño.'],
  error_check_failed: ['The source did not pass its pin, license, age or script check.', 'El origen no superó la comprobación de versión, licencia, antigüedad o scripts.'],
  error_unsupported_addition: ['Tool servers are available after 3.0.', 'Los servidores de herramientas estarán disponibles después de 3.0.'],
  error_preview_expired: ['The check expired. Read the source again.', 'La comprobación venció. Leer el origen de nuevo.'],
  error_preview_changed: ['The reviewed source changed. Read it again.', 'Cambió el origen revisado. Leerlo de nuevo.'],
  error_source_changed: ['The source bytes changed. Read the source again.', 'Cambiaron los archivos de origen. Leer el origen de nuevo.'],
  error_scope_changed: ['The selected units or cluster members changed. Review the selection.', 'Cambió la selección de unidades o integrantes del clúster. Revisarla.'],
  error_invalid_scope: ['Choose at least one available unit or cluster.', 'Seleccionar al menos una unidad o un clúster disponible.'],
  error_destination_changed: ['Existing content changed. It was not replaced.', 'Cambió el contenido existente. No se reemplazó.'],
  error_name_conflict: ['The name is already used by existing content. Nothing was replaced.', 'El nombre ya corresponde a contenido existente. No se reemplazó nada.'],
  error_revision_conflict: ['Content or project registration changed. Review the check again.', 'Cambió el contenido o registro de proyectos. Revisar la comprobación de nuevo.'],
  error_machine_unavailable: ['The selected machine is offline. Its files were not changed.', 'La máquina seleccionada está desconectada. No se modificaron sus archivos.'],
  error_runtime_unavailable: ['A required runtime is unavailable on the selected machine.', 'No está disponible un entorno de ejecución requerido en la máquina seleccionada.'],
  error_scope_unavailable: ['The selected client cannot provide content only to the selected units.', 'El cliente seleccionado no puede ofrecer el contenido solo a las unidades seleccionadas.'],
  error_addition_not_found: ['The addition is no longer available.', 'El elemento agregado ya no está disponible.'],
  error_preview_not_found: ['The source check is no longer available.', 'La comprobación de origen ya no está disponible.'],
  error_forbidden: ['Add to M1ND is available on the computer only.', 'Agregar al M1ND está disponible solo en la computadora.'],
  error_unknown: ['The operation could not be confirmed. Retry to check its state.', 'No se pudo confirmar la operación. Reintentar para comprobar su estado.'],
});
export function addText(language, key, values = {}) {
  const pair = ADD_COPY[key];
  if (!pair) throw new Error('Unknown Add copy key: ' + key);
  return pair[language === 'es' ? 1 : 0].replace(/\{([A-Za-z]+)\}/g, (_, name) => String(values[name] ?? ''));
}
function plus(document) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'add-plus');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 5v14M5 12h14'); svg.append(path); return svg;
}
export function addButton(document, language, onOpen, content = false) {
  const button = element(document, 'button', { type: 'button', class: content ? 'btn primary add-content' : 'add-button',
    'data-action': content ? 'add-content' : 'add-to-mind', 'aria-label': addText(language, 'title'), onclick: onOpen });
  button.append(plus(document), element(document, 'span', { text: addText(language, 'add') })); return button;
}
function button(document, text, id, handler, disabled, primary = false) {
  return element(document, 'button', { type: 'button', class: primary ? 'btn primary' : 'btn', 'data-action': id,
    disabled: disabled ? '' : null, text, onclick: handler });
}
function choice(document, title, checked, disabled, onChange, badge = null, description = null) {
  const row = element(document, 'label', { class: 'add-choice' + (checked ? ' is-selected' : '') });
  const input = element(document, 'input', { type: 'checkbox', disabled: disabled ? '' : null }); input.checked = checked;
  input.addEventListener('change', () => onChange?.(input.checked));
  row.append(input, element(document, 'strong', { text: title }));
  if (description) row.append(element(document, 'span', { class: 'add-description', text: description }));
  if (badge) row.append(element(document, 'span', { class: 'add-badge', text: badge })); return row;
}
function checkLine(document, ok, value, note = null) {
  const row = element(document, 'div', { class: 'add-check-line', 'data-check-ok': String(ok) });
  row.append(element(document, 'span', { class: ok ? 'add-check-dot complete' : 'add-check-dot caution', 'aria-hidden': 'true' }),
    element(document, 'span', { text: value }));
  if (note) row.append(element(document, 'span', { class: 'add-check-note', text: note })); return row;
}
function displayPin(pin) { return pin.kind === 'commit' ? pin.value.slice(0, 7) : pin.value; }
export function renderAdd(document, model, actions) {
  const t = (key, values) => addText(model.language, key, values);
  const selected = (model.preview?.candidates ?? []).filter(item => model.selected.includes(item.id));
  const accept = selected.length === 1 ? t('addName', { name: selected[0].title }) : t('addMany', { count: selected.length });
  const dialog = element(document, 'dialog', { class: 'add-dialog', 'data-add-stage': model.stage, 'aria-busy': String(model.busy) });
  const title = element(document, 'h2', { text: model.stage === 'check' ? accept : t('title') }); labelDialog(dialog, title); dialog.append(title);
  dialog.append(element(document, 'p', { class: 'add-subtitle', text: model.stage === 'check' && selected.length === 1
    ? t('checkSub', { kind: t(selected[0].kind), source: model.preview.sourceDisplay, action: accept }) : t('linkHint') }));
  if (model.stage === 'source') {
    const input = element(document, 'input', { type: 'url', id: 'add-link', 'aria-label': t('link'), class: 'add-link',
      disabled: model.busy ? '' : null, placeholder: 'https://', onchange: event => actions.onInspect?.(event.target.value) }); input.value = model.link;
    dialog.append(input);
    if (model.preview?.pin) dialog.append(element(document, 'p', { class: 'add-field-label', text: t('found', {
      source: model.preview.sourceDisplay, kind: t(model.preview.pin.kind), pin: displayPin(model.preview.pin) }) }));
    const found = element(document, 'div', { class: 'add-found', 'data-add-found': 'true' });
    for (const item of model.preview?.candidates ?? []) {
      const description = ['skill', 'tool-server'].includes(item.kind) ? item.description : t(item.kind === 'docs' ? 'docsDescription'
        : item.kind === 'repository' ? 'repositoryDescription' : 'toolDescription');
      const row = choice(document, item.title, model.selected.includes(item.id), model.busy || !item.supported,
        checked => actions.onSelect?.(item.id, checked), t(item.kind), description);
      if (!item.supported) row.children[0].setAttribute('aria-label', item.title + ', ' + t('toolDescription'));
      row.setAttribute('data-candidate-id', item.id); found.append(row);
    }
    dialog.append(found);
    dialog.addEventListener('dragover', event => event.preventDefault());
    dialog.addEventListener('drop', event => { event.preventDefault(); if (!model.busy) actions.onDrop?.(event); });
  } else {
    for (const item of selected) {
      const check = item.check;
      const block = element(document, 'section', { class: 'add-part-check', 'data-candidate-id': item.id });
      if (selected.length > 1) block.append(element(document, 'h3', { text: item.title }));
      const checks = element(document, 'div', { class: 'add-checks', 'aria-label': item.title });
      checks.append(checkLine(document, check.pin.ok, check.pin.ok ? t('pinned', { kind: t(check.pin.kind), pin: displayPin(check.pin) }) : t('unknownPin'), t('updateHint')),
        checkLine(document, check.license.ok, check.license.value ? t('license', { license: check.license.value }) : t('unknownLicense')),
        checkLine(document, check.age.ok && check.scripts.ok, !check.scripts.ok ? t('scriptUnknown') : check.age.ok ? t('age') : check.age.days === null ? t('unknownAge') : t('young')),
        checkLine(document, check.runtime.ok, check.runtime.requirements.length ? t('needs', {
          requirements: check.runtime.requirements.map(name => name === 'Native executable' ? t('native') : name).join(', '),
        }) : t(check.runtime.verified === false ? 'unknownRuntime' : 'noRuntime'), check.runtime.requirements.length ? t('onlyUnits') : null));
      block.append(checks);
      if (model.preview?.pin?.kind === 'snapshot') block.append(element(document, 'p', { class: 'add-field-label', 'data-dropped-folder': 'true', text: t('droppedFolder') }));
      if (item.kind === 'repository') { block.append(element(document, 'p', { class: 'add-field-label', text: t('repositoryScope') })); dialog.append(block); continue; }
      block.append(element(document, 'p', { class: 'add-field-label', text: t('who') }));
      const scope = model.scopes[item.id] ?? { everyUnit: false, units: [], groups: [] };
      const choices = element(document, 'div', { class: 'add-scope' });
      choices.append(choice(document, t('every'), scope.everyUnit, model.busy,
        checked => actions.onScope?.(item.id, 'everyUnit', null, checked)));
      for (const group of model.choices.groups) choices.append(choice(document, group.title, scope.groups.includes(group.id), model.busy,
        checked => actions.onScope?.(item.id, 'group', group.id, checked), group.members.length === 1 ? t('groupOne') : t('groupMany', { count: group.members.length })));
      for (const unit of model.choices.units) choices.append(choice(document, unit.title, scope.units.includes(unit.id), model.busy,
        checked => actions.onScope?.(item.id, 'unit', unit.id, checked)));
      block.append(choices); dialog.append(block);
    }
  }
  if (model.busy) dialog.append(element(document, 'p', { role: 'status', class: 'add-wait', text: t(model.stage === 'check' ? 'adding' : 'inspect') }));
  if (model.errorCode) {
    const error = element(document, 'div', { role: 'alert', class: 'add-error' });
    const key = 'error_' + model.errorCode;
    error.append(element(document, 'strong', { text: t(ADD_COPY[key] ? key : 'error_unknown') }), element(document, 'p', { text: t('failureHint') }));
    dialog.append(error);
  }
  const controls = element(document, 'div', { class: 'add-actions' });
  controls.append(button(document, t(model.stage === 'check' ? 'back' : 'cancel'), model.stage === 'check' ? 'add-back' : 'add-cancel',
    model.stage === 'check' ? actions.onBack : actions.onCancel, model.busy));
  const valid = selected.length > 0 && selected.every(item => item.supported && item.check.eligible
    && (item.kind === 'repository' || model.scopes[item.id]?.everyUnit || model.scopes[item.id]?.units.length || model.scopes[item.id]?.groups.length));
  const next = button(document, model.busy ? t(model.stage === 'check' ? 'adding' : 'inspect')
    : model.errorCode ? t('retry') : model.stage === 'check' ? accept : t('continue'), model.stage === 'check' ? 'add-confirm' : 'add-continue',
    model.errorCode ? actions.onRetry : model.stage === 'check' ? actions.onAccept : actions.onContinue,
    model.busy || !model.errorCode && (model.stage === 'check' ? !valid : selected.length === 0), true);
  if (model.busy) {
    next.setAttribute('aria-busy', 'true');
    next.replaceChildren(progressMark(document, t(model.stage === 'check' ? 'adding' : 'inspect')));
  }
  controls.append(next);
  dialog.append(controls);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!model.busy) actions.onCancel?.(); }); return dialog;
}
export function renderAddedContent(document, item, language, actions) {
  const t = (key, values) => addText(language, key, values);
  const row = element(document, 'div', { class: 'add-content-row', 'data-addition-id': item.additionId });
  const inclusion = choice(document, item.title, item.included, false, checked => actions.onIncluded?.(item, checked));
  inclusion.className = 'add-content-choice'; row.append(inclusion);
  row.append(element(document, 'button', { type: 'button', class: 'add-origin', title: t('checkUpdates'),
    'aria-label': t('checkUpdates') + ': ' + item.title, onclick: () => actions.onUpdate?.(item),
    text: t(item.unitCount === 1 ? 'originOne' : 'originMany', { source: item.origin, count: item.unitCount }) }));
  if (item.removable) row.append(button(document, t('remove'), 'remove-addition', () => actions.onRemove?.(item), false));
  return row;
}
