import { element, icon } from './components.mjs';
import { AGENT_ROLES, roleLabel } from './start-copy.mjs';

// The roles a person can pick beyond Executor and Overlord, each with the existing icon that suits it. The Map draws the same ones.
export const PRESET_ICON = Object.freeze({ 'ux-designer': 'blueprint', 'ui-designer': 'focus', writer: 'document', 'game-designer': 'move',
  'security-consultant': 'alert', qa: 'check', 'code-reviewer': 'graph', 'product-manager': 'map', helper: 'adjutant', custom: 'settings' });
const ROLE_ICON = { overseer: 'crown', overlord: 'executive', executor: 'executor', genesis: 'genesis', incubator: 'genesis', adjutant: 'adjutant', executive: 'executive', ...PRESET_ICON };

export function pathFolder(value) {
  const parts = String(value ?? '').split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? '';
}

// The cluster row already names its own checkout. A worktree row needs a folder that is not that checkout and not only the branch.
export function listedWorktrees(linkPath, worktrees = []) {
  const own = String(linkPath ?? '').replace(/[\\/]+$/, '').toLowerCase();
  return worktrees.filter(tree => {
    const folder = pathFolder(tree?.path);
    if (!folder || folder === tree.branch) return false;
    return String(tree.path).replace(/[\\/]+$/, '').toLowerCase() !== own;
  });
}

export function readableIdentity(value, personLabel = 'You') {
  if (value === 'root:master' || value === 'root:person' || value === 'master') return personLabel;
  // The unit's own name, as the Map and Hierarchy show it: only the scope prefix goes.
  return String(value ?? '').split(':').at(-1);
}

export function hierarchyIcon(unit) {
  const role = unit?.role;
  return typeof role === 'string' && Object.hasOwn(ROLE_ICON, role) ? ROLE_ICON[role] : 'executor';
}

// Executor and Overlord are told apart by their icon. Every other role a person can pick is named under the unit.
export function unitRoleName(unit, language) {
  const role = unit?.role;
  return AGENT_ROLES.includes(role) && role !== 'executor' && role !== 'overlord' ? roleLabel(language, role, unit.roleName) : '';
}

export function hierarchyDisclosure(document, expanded) {
  return element(document, 'span', { class: 'hierarchy-disclosure', 'aria-hidden': 'true' }, icon(document, expanded ? 'chevron' : 'chevronRight'));
}

// A folder starts closed. Clusters already in the set keep whatever the person opened.
export function collapseNewClusters(state, clusters) {
  const ids = clusters.map(cluster => cluster.id).sort();
  const signature = ids.join('\0');
  if (state.seeded === signature) return state;
  const known = new Set(String(state.seeded ?? '').split('\0').filter(Boolean));
  state.seeded = signature;
  for (const cluster of clusters) if (!known.has(cluster.id)) state.collapsed.add(`cluster:${cluster.id}`);
  return state;
}

export function buildHierarchy(units, issues = [], groups = []) {
  const list = (Array.isArray(units) ? units : []).filter(unit => !unit.removed && unit.role !== 'master');
  const canonical = list.find(unit => unit.role === 'overseer' && unit.unit === 'overseer' && unit.scope?.kind === 'root');
  const hidden = list.filter(unit => unit.role === 'overseer' && unit.id !== canonical?.id).map(unit => unit.id);
  const visible = list.filter(unit => !hidden.includes(unit.id));
  const services = visible.filter(unit => ['genesis', 'incubator'].includes(unit.role));
  const clusters = groups.filter(group => !group.deleted).map(group => ({ ...group, link: group.link ?? { kind: 'none' },
    units: visible.filter(unit => unit.clusterId === group.id || !unit.clusterId && group.members.includes(unit.id)) }));
  const assigned = new Set(clusters.flatMap(cluster => cluster.units.map(unit => unit.id)));
  const byId = new Map(list.map(unit => [unit.id, unit])), cycles = new Set();
  for (const unit of visible) {
    const seen = new Set([unit.id]); let lead = unit.leadId;
    while (lead && byId.has(lead)) {
      if (seen.has(lead)) { cycles.add(lead); break; }
      seen.add(lead); lead = byId.get(lead).leadId;
    }
  }
  return { clusters, groups: clusters, command: visible.filter(unit => unit.id === canonical?.id || !assigned.has(unit.id) && !services.includes(unit)),
    services, hidden, cycles: [...cycles], issues };
}

export function flattenVisibleHierarchy(tree, state, query = '') {
  const rows = [], fold = state ?? { shown: new Map(), collapsed: new Set() };
  const matches = unit => !query || [unit.unit, unit.alias, unit.job, unit.context].some(value => String(value ?? '').toLowerCase().includes(query.toLowerCase()));
  const pushUnits = (units, depth) => {
    const visited = new Set();
    const append = (unit, level) => {
      if (visited.has(unit.id)) return;
      visited.add(unit.id); rows.push(unitRow(unit, level));
      for (const child of units.filter(item => item.leadId === unit.id)) append(child, level + 1);
    };
    for (const unit of units.filter(unit => !units.some(other => other.id === unit.leadId))) append(unit, depth);
    for (const unit of units) append(unit, depth);
  };
  pushUnits(tree.command.filter(matches), 0);
  rows.push({ id: 'section:clusters', kind: 'heading', labelKey: 'clusters', depth: 0 });
  const all = tree.clusters ?? [], emitted = new Set();
  const contains = (cluster, seen = new Set()) => {
    if (seen.has(cluster.id)) return false;
    seen.add(cluster.id);
    return !query || cluster.title.toLowerCase().includes(query.toLowerCase()) || cluster.units.some(matches)
      || (cluster.worktrees ?? []).some(worktree => [worktree.path, worktree.branch].some(value => String(value ?? '').toLowerCase().includes(query.toLowerCase())))
      || all.some(child => child.parentId === cluster.id && contains(child, seen));
  };
  const appendCluster = (cluster, depth) => {
    if (emitted.has(cluster.id) || !contains(cluster)) return;
    emitted.add(cluster.id);
    const key = `cluster:${cluster.id}`, children = all.filter(item => item.parentId === cluster.id && contains(item));
    const expanded = !fold.collapsed.has(key) || Boolean(query);
    rows.push({ id: key, kind: 'cluster', groupId: cluster.id, group: cluster, label: cluster.title, depth, count: children.length || cluster.units.length, expanded });
    if (!expanded) return;
    pushUnits(cluster.units.filter(matches), depth + 1);
    for (const worktree of cluster.worktrees ?? []) rows.push({ id: `worktree:${cluster.id}:${worktree.id}`, kind: 'worktree', groupId: cluster.id, worktree, label: pathFolder(worktree.path) || worktree.branch || '', depth: depth + 1 });
    const shown = query ? children.length : fold.shown.get(key) ?? 6;
    for (const child of children.slice(0, shown)) appendCluster(child, depth + 1);
    if (children.length > shown) rows.push({ id: `more:${key}`, kind: 'more', groupId: key, count: children.length - shown, depth: depth + 1, labelKey: 'more' });
  };
  for (const cluster of all.filter(item => !all.some(parent => parent.id === item.parentId))) appendCluster(cluster, 0);
  if (tree.services.length) {
    rows.push({ id: 'section:services', kind: 'heading', labelKey: 'services', depth: 0 });
    pushUnits(tree.services.filter(matches), 0);
  }
  if (tree.cycles.length) rows.push({ id: 'issue:cycle', kind: 'issue', labelKey: 'cycleIssue', depth: 0 });
  rows.forEach((row, index) => { row.pos = index + 1; row.setsize = rows.length; });
  return rows;
}

export function toggleGroup(state, groupId) {
  if (state.collapsed.has(groupId)) state.collapsed.delete(groupId);
  else state.collapsed.add(groupId);
}

export function revealGroup(state, groupId, count) {
  state.shown.set(groupId, (state.shown.get(groupId) ?? 6) + count);
  state.collapsed.delete(groupId);
}

export function activateUnit(app, unit, kind) {
  if (!unit?.id || unit.role === 'master') return;
  app.store.selected.unitId = unit.id;
  app.store.selected.groupId = null;
  if (app.mapState) { app.mapState.selectedGroupId = null; app.mapState.selection = new Set([unit.id]); }
  if (kind === 'double') { app.pendingCenter = unit.id; app.pendingChat = { unitId: unit.id, create: app.layout !== 'phone' }; }
}

export function unitsForTree(matches, catalog) {
  const source = catalog?.length ? catalog : matches;
  if (!matches || matches === source) return source;
  const byId = new Map(source.map(unit => [unit.id, unit])), wanted = new Set();
  for (const unit of matches) {
    wanted.add(unit.id); const seen = new Set([unit.id]); let lead = unit.leadId;
    while (lead && !seen.has(lead)) { seen.add(lead); wanted.add(lead); lead = byId.get(lead)?.leadId; }
  }
  return [...source.filter(unit => wanted.has(unit.id)), ...matches.filter(unit => !byId.has(unit.id))];
}

function unitRow(unit, depth) { return { id: unit.id, kind: 'unit', unit, depth, label: unitDisplayName(unit) }; }

export function unitDisplayName(unit) {
  const id = String(unit?.unit ?? unit?.id ?? '');
  const alias = typeof unit?.alias === 'string' ? unit.alias.trim() : '';
  return alias ? alias + ' (' + id + ')' : id;
}

// The right-click menu of a Map node, a Map cluster and a Hierarchy row. It opens at the pointer, stays on screen and closes on
// Escape, on a click elsewhere, on scrolling and on a choice. Each item is { id, label, danger, disabled, run }.
export function openContextMenu(document, { x = 0, y = 0, items = [], label = '' } = {}) {
  document.querySelector?.('[data-context-menu]')?.remove();
  const view = document.defaultView, invoker = document.activeElement;
  // The Map and the list draw themselves again while the menu is open, so the control that opened it may be gone by then.
  const mark = ['data-unit-id', 'data-group-id', 'data-id'].map(key => [key, invoker?.getAttribute?.(key)]).find(([, value]) => value);
  const refocus = () => {
    if (invoker?.isConnected !== false) { invoker?.focus?.(); return; }
    if (mark) document.querySelector?.(`[${mark[0]}="${String(mark[1]).replace(/["\\]/g, '\\$&')}"]`)?.focus?.();
  };
  const menu = element(document, 'div', { class: 'context-menu', role: 'menu', 'aria-label': label, 'data-context-menu': 'true' });
  const entries = items.map(item => {
    const entry = element(document, 'button', { type: 'button', class: `context-item${item.primary ? ' is-primary' : ''}${item.danger ? ' is-danger' : ''}`, role: 'menuitem',
      'data-action': `context-${item.id}`, disabled: item.disabled ? '' : null, text: item.label });
    entry.addEventListener('click', () => { close(false); item.run?.(); });
    menu.append(entry);
    return entry;
  });
  const enabled = () => entries.filter(entry => !entry.disabled && entry.getAttribute('disabled') === null);
  function close(restore = true) {
    document.removeEventListener?.('pointerdown', outside, true);
    document.removeEventListener?.('keydown', keys, true);
    view?.removeEventListener?.('resize', dismiss);
    view?.removeEventListener?.('blur', dismiss);
    document.removeEventListener?.('scroll', dismiss, true);
    menu.remove();
    if (restore) refocus();
  }
  function dismiss() { close(false); }
  function outside(event) { if (!menu.contains?.(event.target)) close(false); }
  function keys(event) {
    const live = enabled(), index = live.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault?.(); close(); return; }
    if (event.key === 'Tab') { close(false); return; }
    const next = event.key === 'ArrowDown' ? live[(index + 1) % live.length] : event.key === 'ArrowUp' ? live[(index - 1 + live.length) % live.length]
      : event.key === 'Home' ? live[0] : event.key === 'End' ? live.at(-1) : null;
    if (next) { event.preventDefault?.(); next.focus?.(); }
  }
  document.addEventListener?.('pointerdown', outside, true);
  document.addEventListener?.('keydown', keys, true);
  view?.addEventListener?.('resize', dismiss);
  view?.addEventListener?.('blur', dismiss);
  document.addEventListener?.('scroll', dismiss, true);
  document.body.append(menu);
  const box = menu.getBoundingClientRect?.(), width = box?.width ?? 0, height = box?.height ?? 0;
  menu.style.left = `${Math.max(8, Math.min(x, (view?.innerWidth ?? x + width + 8) - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, (view?.innerHeight ?? y + height + 8) - height - 8))}px`;
  enabled()[0]?.focus?.();
  return { menu, close };
}
