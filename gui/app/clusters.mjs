import { element, icon, labelDialog, progressMark } from './components.mjs';
import { startText } from './start-copy.mjs';

export function connectedChoices(clients = []) {
  return clients.filter(client => client.connected === true);
}

// Claude Code and Cursor may run supervised under the person's explicit choice, without claiming confinement.
export function launchable(client) {
  return client?.connected === true && (client.scopeEnforced === true
    && (client.boundary === undefined || client.boundary === 'confined')
    || ['claude', 'cursor'].includes(client.id) && supervisedClient(client));
}

export function supervisedClient(client) {
  return client?.boundary === 'supervised' && client.scopeEnforced !== true;
}

export function validRunsIn(choice, clients) {
  const client = connectedChoices(clients).find(item => item.id === choice?.client);
  const model = client?.models.find(item => item.id === choice?.model);
  return Boolean(launchable(client) && model && (client.id === 'lyra'
    ? choice.effort === null && model.modes.includes(choice.mode)
    : choice.mode === null && model.efforts.includes(choice.effort)));
}

export function initialRunsIn(clients, preferred = null, kind = null) {
  const available = connectedChoices(clients).filter(item => !kind || (kind === 'local') === (item.id === 'lyra'));
  if (validRunsIn(preferred, available)) return { ...preferred };
  for (const client of available) for (const model of client.models) {
    const value = { client: client.id, model: model.id, effort: client.id === 'lyra' ? null : model.efforts[0] ?? null,
      mode: client.id === 'lyra' ? model.modes[0] ?? null : null };
    if (validRunsIn(value, available)) return value;
  }
  return null;
}

export function runsInLabel(choice, clients = []) {
  if (!choice) return '';
  const client = clients.find(item => item.id === choice.client);
  return [client?.title ?? choice.client, client?.models.find(item => item.id === choice.model)?.title ?? choice.model, choice.mode ?? choice.effort].filter(Boolean).join(', ');
}

export function repositorySelection(offer) {
  return new Set((offer?.groups ?? []).flatMap(group => group.repositories.map(repo => repo.id)));
}

export function acceptedRepositoryCluster(clusters, addition) {
  return clusters.find(cluster => !cluster.deleted && cluster.link?.kind === 'repository' && cluster.link.projectId === addition.projectId) ?? null;
}

export function filterRepositories(offer, query = '') {
  const needle = query.trim().toLowerCase();
  return (offer?.groups ?? []).map(group => ({ ...group, repositories: group.repositories.filter(repo =>
    !needle || [group.title, group.path, repo.name, ...repo.worktrees.flatMap(tree => [tree.path, tree.branch])]
      .some(value => String(value ?? '').toLowerCase().includes(needle))) })).filter(group => group.repositories.length);
}

export function clusterLead(cluster, units = []) {
  const members = units.filter(unit => !unit.removed && unit.role !== 'master' && cluster.members.includes(unit.id));
  const leads = members.filter(unit => unit.role === 'overlord' && !members.some(other => other.id === unit.leadId));
  if (leads.length === 1) return leads[0];
  return members.length === 1 ? members[0] : null;
}

function button(document, label, action, onclick, primary = false) {
  return element(document, 'button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, 'data-action': action, text: label, onclick });
}

function tick(document, label, checked, onChange, attributes = {}) {
  const input = element(document, 'input', { type: 'checkbox', ...attributes });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return element(document, 'label', { class: 'start-check' }, input, element(document, 'span', { text: label }));
}

function options(document, items, selected, onChoose) {
  return element(document, 'div', { class: 'start-segment', role: 'group' }, items.map(item =>
    button(document, item.label, `choose-${item.id}`, () => onChoose(item.id))
  ).map((node, index) => { node.setAttribute('aria-pressed', String(items[index].id === selected)); return node; }));
}

export function renderRepositoryOffer(document, model, actions) {
  const t = (key, values) => startText(model.language, key, values);
  const count = repositorySelection(model.offer).size;
  const root = element(document, 'section', { class: 'discovery-view' },
    element(document, 'h2', { text: t('reposFound', { count }) }),
    element(document, 'p', { class: 'start-hint', text: t('reposHint', { count: model.offer.groups.length }) }));
  const search = element(document, 'input', { type: 'search', class: 'start-filter', 'data-start-field': 'filter',
    'aria-label': t('filter'), placeholder: t('filter'), oninput: () => actions.onFilter(search.value) });
  search.value = model.query ?? '';
  root.append(search);
  const list = element(document, 'div', { class: 'discovery-folders' });
  for (const group of filterRepositories(model.offer, model.query)) {
    const original = model.offer.groups.find(item => item.id === group.id);
    const selected = original.repositories.filter(repo => model.selected.has(repo.id)).length;
    const check = tick(document, group.title, selected === original.repositories.length, value => actions.onFolder(group.id, value), { 'data-discovery-folder': group.id });
    check.querySelector?.('input') && (check.querySelector('input').indeterminate = selected > 0 && selected < original.repositories.length);
    const open = model.expanded.has(group.id) || Boolean(model.query);
    const row = element(document, 'div', { class: 'discovery-folder' }, check,
      button(document, open ? '⌄' : '›', `expand-${group.id}`, () => actions.onExpand(group.id)),
      element(document, 'code', { text: group.path }), element(document, 'small', { text: t(original.repositories.length === 1 ? 'repositoryOne' : 'repositoryMany', { count: original.repositories.length }) }));
    row.children[1].setAttribute('aria-label', group.title);
    row.children[1].setAttribute('aria-expanded', String(open));
    list.append(row);
    if (open) for (const repo of group.repositories) {
      list.append(element(document, 'div', { class: 'discovery-repository' },
        tick(document, repo.name, model.selected.has(repo.id), value => actions.onRepository(repo.id, value), { 'data-discovery-repository': repo.id }),
        ...repo.worktrees.map(tree => element(document, 'code', { class: 'discovery-worktree', text: [tree.path, tree.branch].filter(Boolean).join(' · ') }))));
    }
  }
  root.append(list, element(document, 'p', { class: 'start-hint', text: t('worktreesHint') }),
    element(document, 'footer', { class: 'dialog-actions' },
      button(document, t('notNow'), 'dismiss-discovery', actions.onDismiss),
      button(document, t('import', { count: model.selected.size }), 'import-repositories', actions.onImport, true)));
  return root;
}

export function renderRunsInPicker(document, model, actions) {
  const t = (key, values) => startText(model.language, key, values);
  const clients = connectedChoices(model.clients);
  const current = clients.find(item => item.id === model.choice?.client);
  const selectedModel = current?.models.find(item => item.id === model.choice?.model);
  const root = element(document, 'section', { class: 'runs-in-picker', 'data-runs-picker': 'true' });
  const columns = element(document, 'div', { class: 'runs-in-columns' });
  const column = (label, items) => element(document, 'div', { class: 'runs-in-column', role: 'group', 'aria-label': label },
    element(document, 'h3', { text: label }), ...items);
  const option = (id, title, note, selected, choose, disabled = false) => {
    const node = button(document, '', id, () => { if (!node.disabled) choose(); });
    node.className = 'runs-in-option'; node.disabled = disabled;
    node.setAttribute('aria-pressed', String(selected));
    node.append(element(document, 'span', {}, element(document, 'strong', { text: title }), note ? element(document, 'small', { text: note }) : null),
      selected ? element(document, 'span', { 'aria-hidden': 'true', text: '✓' }) : null);
    return node;
  };
  columns.append(column(t('agent'), clients.map(client => {
    const quota = client.id === 'lyra' ? t('localQuota') : client.quota?.known && Number.isFinite(client.quota.remainingPercent)
      ? t('quota', { label: client.quota.period ?? client.title, percent: client.quota.remainingPercent }) : t('quotaUnknown');
    return option(`runs-client-${client.id}`, client.title, launchable(client) ? quota : t('scopeUnavailable'), current?.id === client.id,
      () => actions.onChoice(initialRunsIn([client])), !launchable(client) || !initialRunsIn([client]));
  })));
  columns.append(column(t('model'), (current?.models ?? []).map(item => {
    const choice = { ...model.choice, model: item.id };
    // A model change keeps the selected mode/effort. An incompatible pair needs an explicit new choice.
    return option(`runs-model-${item.id}`, item.title, validRunsIn(choice, clients) ? '' : t('unavailable'), selectedModel?.id === item.id,
      () => actions.onChoice(choice));
  })));
  const local = current?.id === 'lyra';
  const values = local ? ['fast', 'normal', 'thinking'] : [...new Set((current?.models ?? []).flatMap(item => item.efforts))];
  columns.append(column(t(local ? 'mode' : 'effort'), values.map(value => {
    const supported = (local ? selectedModel?.modes : selectedModel?.efforts)?.includes(value);
    const label = ['low', 'medium', 'high', 'max', 'fast', 'normal', 'thinking'].includes(value) ? t(value) : value;
    return option(`runs-${local ? 'mode' : 'effort'}-${value}`, label,
      !supported ? t('unavailable') : local ? t(`${value}Hint`) : '', (local ? model.choice?.mode : model.choice?.effort) === value,
      () => actions.onChoice({ ...model.choice, [local ? 'mode' : 'effort']: value }), !supported);
  })));
  const warning = supervisedClient(current) ? element(document, 'section', { class: 'runs-in-warning', role: 'note', 'data-native-warning': current.id },
    icon(document, 'alert'), element(document, 'p', { text: t('supervisedWarning') }),
    typeof model.automatic === 'boolean' ? tick(document, t('workAutomatically'), model.automatic === true, value => actions.onAutomatic?.(value), { 'data-work-automatically': 'true' }) : null) : null;
  root.append(columns);
  if (warning) root.append(warning);
  root.append(element(document, 'footer', { class: 'runs-in-footer' },
    tick(document, t('defaultChoice'), model.useAsDefault === true, actions.onDefault, { 'data-use-default': 'true' }),
    button(document, runsInLabel(model.choice, clients) || t('unavailable'), 'close-runs-picker', actions.onClose)));
  return root;
}

export function renderAgentForm(document, model, actions) {
  const t = (key, values) => startText(model.language, key, values);
  const overseer = model.kind === 'overseer';
  const root = element(document, 'section', { class: overseer ? 'overseer-view' : 'new-agent-view' },
    element(document, 'h2', { text: overseer ? t('createOverseer') : t('newAgentIn', { name: model.cluster.title }) }));
  if (overseer) {
    root.append(element(document, 'p', { class: 'start-hint', text: t('overseerHint') }),
      element(document, 'div', { class: 'overseer-kinds' }, ...['external', 'local'].map(kind => {
        const node = button(document, '', `overseer-${kind}`, () => actions.onKind(kind));
        node.className = 'overseer-kind'; node.setAttribute('aria-pressed', String(model.agentKind === kind));
        node.append(icon(document, kind === 'local' ? 'genesis' : 'executor'), element(document, 'strong', { text: t(kind) }), element(document, 'small', { text: t(`${kind}Hint`) }));
        return node;
      })));
  } else root.append(options(document, ['executor', 'overlord'].map(id => ({ id, label: t(id) })), model.role, actions.onRole));
  root.append(element(document, 'label', { class: 'start-runs-field' }, element(document, 'span', { text: t('runsIn') }),
    button(document, runsInLabel(model.choice, model.clients) || t('unavailable'), 'open-runs-picker', actions.onPicker)));
  if (overseer) root.append(tick(document, t('fresh'), model.fresh, actions.onFresh, { 'data-start-fresh': 'true' }),
    element(document, 'p', { class: 'start-hint', text: t('freshHint') }));
  else root.append(element(document, 'p', { class: 'start-hint', text: t(model.cluster.link.kind === 'repository' ? 'agentScope' : model.cluster.link.kind === 'folder' ? 'folderScope' : 'unlinkedScope', { name: model.cluster.title }) }));
  const create = button(document, t('create'), 'create-agent', actions.onCreate, true);
  create.disabled = !validRunsIn(model.choice, model.clients);
  root.append(element(document, 'footer', { class: 'dialog-actions' }, button(document, t(overseer ? 'later' : 'cancel'), 'cancel-agent', actions.onCancel), create));
  return root;
}

export function renderClusterForm(document, model, actions) {
  const t = (key, values) => startText(model.language, key, values);
  const root = element(document, 'section', { class: 'new-cluster-view' }, element(document, 'h2', { text: t('newCluster') }),
    element(document, 'p', { class: 'start-hint', text: t('newClusterHint') }));
  const name = element(document, 'input', { name: 'title', 'data-start-field': 'title', maxlength: 240, oninput: () => actions.onName(name.value) });
  name.value = model.title;
  root.append(element(document, 'label', { class: 'field' }, t('name'), name),
    element(document, 'span', { class: 'field-label', text: t('linkedTo') }),
    options(document, ['repository', 'folder', 'none'].map(id => ({ id, label: t(id === 'none' ? 'nothing' : id) })), model.linkKind, actions.onLinkKind));
  if (model.linkKind === 'none') root.append(element(document, 'p', { class: 'start-hint', text: t('unlinkedHint') }));
  else {
    const path = element(document, 'input', { name: 'path', 'data-start-field': 'path', oninput: () => actions.onPath(path.value) });
    path.value = model.path;
    root.append(element(document, 'label', { class: 'field' }, t(model.linkKind), path));
  }
  root.append(element(document, 'footer', { class: 'dialog-actions' }, button(document, t('cancel'), 'cancel-cluster', actions.onCancel),
    button(document, t('create'), 'create-cluster', actions.onCreate, true)));
  return root;
}

// Dialogs live outside the shell so event refreshes cannot discard a draft or an unconfirmed operation.
export function startDialog(document, { view, render, language, anchor = null, onCancel = null, onClose = null }) {
  const invoker = document.activeElement;
  const dialog = element(document, 'dialog', { class: `start-dialog start-${view}`, 'data-start-dialog': view });
  let busy = false, uncertain = false;
  const paint = () => {
    const active = document.activeElement;
    const field = active?.getAttribute?.('data-start-field');
    const action = active?.getAttribute?.('data-action');
    const selection = [active?.selectionStart, active?.selectionEnd];
    dialog.replaceChildren(render());
    const heading = dialog.querySelector('h2, h3');
    if (heading) labelDialog(dialog, heading);
    const replacement = field ? dialog.querySelector(`[data-start-field="${field}"]`) : action ? dialog.querySelector(`[data-action="${action}"]`) : null;
    replacement?.focus?.();
    if (field && selection.every(Number.isInteger)) replacement?.setSelectionRange?.(...selection);
  };
  const run = async (action, work) => {
    if (busy) return;
    busy = true;
    dialog.querySelector('[data-start-error]')?.remove();
    const controls = [...dialog.querySelectorAll('button, input, select')];
    const enabled = controls.filter(node => !node.disabled);
    for (const node of enabled) node.disabled = true;
    const control = dialog.querySelector(`[data-action="${action}"]`);
    const label = control?.textContent ?? '';
    control?.setAttribute('aria-busy', 'true');
    control?.replaceChildren(progressMark(document, label));
    try { await work(); uncertain = false; }
    catch (error) {
      paint();
      uncertain = Boolean(error.operation && (!error.status || error.status >= 500));
      if (uncertain) {
        for (const node of dialog.querySelectorAll('button, input, select')) if (node.getAttribute('data-action') !== action) node.disabled = true;
      }
      dialog.append(element(document, 'p', { role: 'alert', 'data-start-error': error.code ?? 'request_failed', text: error.message || startText(language, 'unavailable') }));
      dialog.querySelector(`[data-action="${action}"]`)?.focus?.();
    } finally { busy = false; if (dialog.isConnected) { for (const node of enabled) node.disabled = false; control?.removeAttribute('aria-busy'); } }
  };
  const close = () => { if (!busy && !uncertain) { if (onCancel) onCancel(); else dialog.close(); } };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter' && event.target?.tagName === 'INPUT' && view !== 'discovery') {
      event.preventDefault(); dialog.querySelector('button.primary')?.click?.();
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea')].filter(node => !node.disabled && !node.closest('[hidden]'));
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  });
  dialog.addEventListener('close', () => {
    dialog.remove(); onClose?.();
    const action = invoker?.getAttribute?.('data-action');
    const target = action ? document.querySelector(`[data-action="${action}"]`) : null;
    (target ?? invoker)?.focus?.();
  });
  paint(); document.body.append(dialog); dialog.showModal();
  if (anchor) {
    const rect = anchor.getBoundingClientRect?.();
    const viewport = document.defaultView;
    if (rect && viewport) {
      dialog.style.margin = '0';
      dialog.style.left = `${Math.max(16, Math.min(viewport.innerWidth - (view === 'picker' ? 560 : 320) - 16, rect.right - (view === 'picker' ? 560 : 320)))}px`;
      dialog.style.top = `${Math.max(16, Math.min(viewport.innerHeight - dialog.getBoundingClientRect().height - 16, rect.bottom + 8))}px`;
    }
  }
  dialog.querySelector('input, button')?.focus?.();
  return { dialog, paint, run, get busy() { return busy; }, get uncertain() { return uncertain; } };
}
