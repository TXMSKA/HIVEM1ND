import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { acceptedRepositoryCluster, clusterLead, connectedChoices, filterRepositories, initialRunsIn, launchable, renderAgentForm, renderRepositoryOffer, renderRunsInPicker, repositorySelection, runsInLabel, supervisedClient, validRunsIn } from '../gui/app/clusters.mjs';
import { renderApproval } from '../gui/app/inspector.mjs';
import { renderSessionWork } from '../gui/app/session-work.mjs';
import { startText } from '../gui/app/start-copy.mjs';
import { clusterFrames, placeUnits } from '../gui/app/map-geometry.mjs';
import { buildHierarchy, collapseNewClusters, flattenVisibleHierarchy, hierarchyDisclosure, listedWorktrees, pathFolder, readableIdentity, revealGroup } from '../gui/app/hierarchy.mjs';
import { createMap, fitMap, flyToCluster, graphBounds, paintNodes, pointerDown, pointerMove, pointerUp, wheelZoom } from '../gui/app/map.mjs';
import { renderCluster } from '../gui/app/inspector.mjs';
import { planCardModel } from '../gui/app/plan-controller.mjs';
import { renderPlanCard } from '../gui/app/plan-view.mjs';
import { applyEvent, createStore } from '../gui/app/state.mjs';
import { document, nodes, copy } from './add-dom-fixture.mjs';

const clients = [
  { id: 'codex', title: 'Codex', connected: true, scopeEnforced: true, models: [{ id: 'observed', title: 'Observed', efforts: ['high', 'xhigh'], modes: [] }], quota: { known: false, remainingPercent: null } },
  { id: 'lyra', title: 'Lyra', connected: true, scopeEnforced: true, models: [{ id: 'small', title: 'Installed small', efforts: [], modes: ['fast', 'normal'] }, { id: 'large', title: 'Installed large', efforts: [], modes: ['normal', 'thinking'] }] },
  { id: 'cursor', connected: false, models: [] },
];
const cluster = (id, kind = 'none', parentId = null, members = []) => ({ id, title: id, parentId, members, link: kind === 'none' ? { kind } : kind === 'folder' ? { kind, folderId: id } : { kind, projectId: id } });
const unit = (id, role = 'executor', clusterId = null, leadId = null) => ({ id, unit: id.split(':').at(-1), role, clusterId, leadId, scope: { kind: 'root' }, status: 'idle' });

test('accepted repositories select their existing nested identity and retain the first-agent defaults', () => {
  const parent = cluster('Web', 'folder'), repo = cluster('shop', 'repository', parent.id);
  assert.equal(acceptedRepositoryCluster([parent, repo], { projectId: 'shop' }), repo);
  assert.equal(acceptedRepositoryCluster([{ ...repo, deleted: true }], { projectId: 'shop' }), null);
  const view = renderAgentForm(document, { language: 'en', kind: 'agent', cluster: repo, clients, role: 'executor', choice: initialRunsIn(clients, { client: 'codex', model: 'observed', effort: 'xhigh', mode: null }) }, {});
  assert.match(copy(view), /Codex, Observed, Extra high/);
  assert.equal(nodes(view).find(node => node.attributes?.['data-action'] === 'choose-executor').getAttribute('aria-pressed'), 'true');
});

test('filtering and parent selection keep 26 canonical repositories; worktrees never increase the count', () => {
  const offer = { groups: [['Web', 19], ['Unity', 6], ['Tools', 1]].map(([title, count]) => ({ id: title, title, path: title,
    repositories: Array.from({ length: count }, (_, index) => ({ id: `${title}-${index}`, name: `${title}-${index}`, worktrees: [{ path: `${title}/${index}`, branch: 'main' }, { path: `${title}/${index}-work`, branch: 'review' }] })) })) };
  const selected = repositorySelection(offer);
  assert.equal(selected.size, 26); assert.equal(filterRepositories(offer, 'Web-18')[0].repositories.length, 1); assert.equal(selected.size, 26);
  for (const repo of offer.groups[0].repositories) selected.delete(repo.id);
  assert.equal(selected.size, 7); assert.equal(filterRepositories(offer, 'review').flatMap(group => group.repositories).length, 26);
  const view = renderRepositoryOffer(document, { language: 'en', offer, selected, expanded: new Set(), query: '' }, {});
  assert.match(copy(view), /Import 7/); assert.match(copy(view), /26 repositories/);
});

test('Runs in shows only connected capabilities, unknown quota and explicitly disabled Lyra pairs', () => {
  assert.equal(connectedChoices(clients).length, 2);
  const choice = initialRunsIn(clients); assert.equal(choice.model, 'observed');
  assert.equal(validRunsIn({ ...choice, effort: 'invented' }, clients), false);
  let selected;
  const external = renderRunsInPicker(document, { language: 'en', clients, choice, useAsDefault: false }, { onChoice: value => { selected = value; } });
  assert.match(copy(external), /Quota unavailable/); assert.doesNotMatch(copy(external), /Cursor|100%/);
  assert.equal(nodes(external).find(node => node.attributes?.['data-use-default']).checked, false);
  const localChoice = { client: 'lyra', model: 'small', effort: null, mode: 'normal' };
  const local = renderRunsInPicker(document, { language: 'es', clients, choice: localChoice }, {});
  assert.match(copy(local), /sin cuota/);
  assert.match(copy(local), /de ahora en adelante/);
  assert.equal(nodes(local).find(node => node.attributes?.['data-action'] === 'runs-mode-thinking').disabled, true);
  nodes(local).find(node => node.attributes?.['data-action'] === 'runs-mode-thinking').listeners.click();
  assert.equal(selected, undefined, 'a disabled option cannot call the selection callback');
  nodes(external).find(node => node.attributes?.['data-action'] === 'runs-effort-xhigh').listeners.click();
  assert.equal(selected.effort, 'xhigh'); assert.equal(validRunsIn(selected, clients), true);
});

test('Runs in labels keep agent, model and effort readable instead of exposing picker ids', () => {
  assert.equal(runsInLabel({ client: 'codex', model: 'observed', effort: 'high' }, clients), 'Codex, Observed, High');
  assert.equal(runsInLabel({ client: 'codex', model: 'alternate-model', effort: 'xhigh' }, clients), 'Codex, Alternate Model, Extra high');
  assert.equal(runsInLabel({ client: 'codex', model: 'observed', effort: 'xhigh' }, clients, 'es'), 'Codex, Observed, Muy alto');
  assert.equal(runsInLabel({ client: 'codex', model: 'observed', effort: 'high' }, [{ id: 'codex', title: 'codex', models: [{ id: 'observed', title: 'observed', efforts: ['high'] }] }]), 'Codex, Observed, High');
  assert.equal(runsInLabel({ client: 'claude', model: 'observed', effort: null, mode: null }, [{ id: 'claude', title: 'claude', models: [{ id: 'observed', title: 'observed', efforts: [] }] }]), 'Claude Code, Observed');
  assert.equal(runsInLabel({ client: 'codex', model: 'observed', effort: 'high' }, clients, 'es'), 'Codex, Observed, Alto');
  assert.equal(readableIdentity('root:master', 'Persona'), 'Persona');
  assert.equal(readableIdentity('project:shop:executor-shop', 'Persona'), 'executor shop');
});

test('R5 plan cards show readable identities and Runs in copy in English and Spanish', () => {
  const plan = { id: 'plan-1', title: 'Ship', branch: 'plan-ship', approved: false,
    roles: { coordinator: { kind: 'unit', unitId: 'root:master' } },
    tasks: [{ id: 'task-1', title: 'Build shop', state: 'pending', actorId: 'project:shop:executor-shop',
      assignment: { kind: 'unit', unitId: 'project:shop:executor-shop', runsIn: { client: 'codex', model: 'observed', effort: 'high' } } }] };
  const controller = { runs: new Map(), pending: new Map() };
  for (const language of ['en', 'es']) {
    const card = renderPlanCard(document, planCardModel(controller, plan, language, clients), {});
    const visible = nodes(card).map(node => node.textContent).join(' ');
    assert.doesNotMatch(visible, /root:master|project:shop:executor-shop/);
    assert.match(visible, /executor shop/);
    assert.match(visible, /Codex, Observed, (?:High|Alto)/);
  }
});

test('Overseer and New agent forms contain only their choices, fresh is checked and no callback runs on render', () => {
  let created = 0;
  for (const language of ['en', 'es']) {
    const model = { language, kind: 'agent', cluster: cluster('Ideas'), clients, role: 'executor', choice: initialRunsIn(clients), fresh: true };
    const view = renderAgentForm(document, model, { onCreate: () => created++ });
    assert.doesNotMatch(copy(view), /Builder|lead-id|machine/);
    assert.equal(nodes(view).filter(node => node.attributes?.['data-action']?.startsWith('choose-')).length, 2);
    const overseer = renderAgentForm(document, { ...model, kind: 'overseer', agentKind: 'external' }, {});
    assert.equal(nodes(overseer).find(node => node.attributes?.['data-start-fresh']).checked, true);
  }
  assert.equal(created, 0);
});

test('canonical nested clusters keep aliases and exact lead links without a root person or legacy sections', () => {
  const clusters = [cluster('Web', 'folder'), ...Array.from({ length: 19 }, (_, i) => cluster(`repo-${i}`, 'repository', 'Web', i === 0 ? ['root:lead', 'root:executor'] : []))];
  const units = [unit('root:master', 'master'), unit('root:overseer', 'overseer'), unit('root:lead', 'overlord', 'repo-0'), { ...unit('root:executor', 'executor', 'repo-0', 'root:lead'), alias: 'Cart' }];
  const state = { shown: new Map(), collapsed: new Set() }, tree = buildHierarchy(units, [], clusters);
  const rows = flattenVisibleHierarchy(tree, state);
  assert.equal(rows.some(row => row.unit?.role === 'master'), false); assert.equal(rows.filter(row => row.kind === 'cluster').length, 7);
  assert.equal(rows.find(row => row.unit?.id === 'root:executor').label, 'Cart (executor)');
  assert.equal(rows.find(row => row.kind === 'more').count, 13);
  revealGroup(state, 'cluster:Web', 13); assert.equal(flattenVisibleHierarchy(tree, state).filter(row => row.kind === 'cluster').length, 20);
  assert.ok(flattenVisibleHierarchy(tree, { shown: new Map(), collapsed: new Set(['cluster:Web']) }, 'repo-18').some(row => row.groupId === 'repo-18'));
  assert.equal(clusterLead(clusters[1], units).id, 'root:lead');
});

test('the cluster checkout is not listed again as a worktree row', () => {
  const listed = listedWorktrees('C:\\temp\\hivem1nd\\shop', [
    { id: 'main', path: 'C:\\temp\\hivem1nd\\shop', branch: 'main' },
    { id: 'alt', path: 'C:\\temp\\hivem1nd\\shop-worktree', branch: 'alternate' },
    { id: 'bare', path: '', branch: 'main' },
  ]);
  assert.deepEqual(listed.map(tree => [pathFolder(tree.path), tree.branch]), [['shop-worktree', 'alternate']]);
});

test('a worktree is named by its folder and folders start collapsed', () => {
  const web = cluster('Web', 'folder');
  const shop = { ...cluster('shop', 'repository', 'Web'), worktrees: [{ id: 'wt', path: 'C:\\temp\\hivem1nd\\shop', branch: 'feature/cart-empty-state' }] };
  const tree = buildHierarchy([unit('root:overseer', 'overseer')], [], [web, shop]);
  const open = flattenVisibleHierarchy(tree, { shown: new Map(), collapsed: new Set() });
  const worktree = open.find(row => row.kind === 'worktree');
  assert.equal(worktree.label, 'shop');
  assert.equal(worktree.worktree.branch, 'feature/cart-empty-state');
  const state = { shown: new Map(), collapsed: new Set() };
  collapseNewClusters(state, tree.clusters);
  const folded = flattenVisibleHierarchy(tree, state);
  assert.equal(folded.some(row => row.kind === 'worktree' || row.groupId === 'shop'), false);
  assert.equal(folded.find(row => row.groupId === 'Web').expanded, false);
  const disclosure = hierarchyDisclosure(document, true);
  assert.equal(nodes(disclosure).some(node => node.tagName === 'SVG'), true);
  assert.equal(copy(disclosure).includes('v'), false);
  assert.equal(nodes(disclosure).find(node => node.tagName === 'PATH').getAttribute('d'), 'M6 9l6 6 6-6');
});

test('saved cluster frames, empty and nested folders remain in Fit beyond the former zoom floor', () => {
  const groups = [cluster('Web', 'folder'), ...Array.from({ length: 100 }, (_, i) => cluster(`repo-${i}`, 'repository', 'Web')), cluster('Ideas')];
  const saved = { nodes: {}, groups: { 'cluster:Ideas': { x: 50000, y: -50000, width: 180, height: 70 } } };
  const frames = clusterFrames(groups, saved); assert.equal(frames.length, 102);
  assert.deepEqual(frames.find(frame => frame.group.id === 'Ideas').bounds, { x: 50000, y: -50000, w: 180, h: 70 });
  const map = createMap({ groups, saved, units: [unit('root:master', 'master'), unit('root:overseer', 'overseer')] });
  assert.equal(paintNodes(map).some(node => node.role === 'master'), false);
  const viewport = { width: 736, height: 818, left: 0, top: 0 }, camera = fitMap(map, viewport);
  assert.ok(camera.zoom < 0.25);
  for (const b of graphBounds(map)) {
    assert.ok(b.x * camera.zoom + camera.x >= 47.9); assert.ok((b.x + b.width) * camera.zoom + camera.x <= viewport.width - 47.9);
    assert.ok(b.y * camera.zoom + camera.y >= 47.9); assert.ok((b.y + b.height) * camera.zoom + camera.y <= viewport.height - 47.9);
  }
  map.reducedMotion = true; assert.equal(flyToCluster(map, 'Web', viewport), true);
  assert.ok(map.view.zoom > camera.zoom);
  const before = map.view.zoom; wheelZoom(map, { clientX: 200, clientY: 200, deltaY: 1 }, viewport); assert.ok(map.view.zoom < before);
  const placement = placeUnits([unit('root:overseer', 'overseer')], saved, groups); assert.deepEqual(placement.positions['root:overseer'], { x: 380, y: 409 });
});

test('sibling cluster frames stay apart, agents stay inside and the overseer stays outside', () => {
  const web = cluster('Web', 'folder'), shop = cluster('shop', 'repository', 'Web', ['lead', 'a', 'b']);
  const blog = cluster('blog', 'repository', 'Web'), unity = cluster('Unity', 'folder'), game = cluster('game-1', 'repository', 'Unity');
  const ideas = cluster('ideas');
  const groups = [ideas, web, shop, blog, unity, game];
  const units = [unit('root:overseer', 'overseer'), unit('lead', 'overlord', 'shop'), unit('a', 'executor', 'shop', 'lead'), unit('b', 'executor', 'shop', 'lead')];
  const saved = { nodes: { 'root:overseer': { x: 0, y: 0 }, a: { x: 0, y: 0 }, b: { x: 900, y: 20 } }, groups: {} };
  const box = (frames, id) => frames.find(frame => frame.group.id === id).bounds;
  const overlaps = (left, right) => left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
  const contains = (outer, inner, radius = 0) => inner.x - radius >= outer.x && inner.y - radius >= outer.y
    && inner.x + (inner.w ?? 0) + radius <= outer.x + outer.w && inner.y + (inner.h ?? 0) + radius <= outer.y + outer.h;
  const frames = clusterFrames(groups, saved, 'Web', units);
  const roots = ['Web', 'Unity', 'ideas'].map(id => box(frames, id));
  for (let i = 0; i < roots.length; i += 1) for (let j = i + 1; j < roots.length; j += 1) assert.equal(overlaps(roots[i], roots[j]), false, `${i}:${j}`);
  assert.equal(overlaps(box(frames, 'shop'), box(frames, 'blog')), false);
  assert.equal(contains(box(frames, 'Web'), box(frames, 'shop')), true);
  assert.equal(contains(box(frames, 'Unity'), box(frames, 'game-1')), true);
  assert.equal(box(frames, 'Unity').x > box(frames, 'Web').x + box(frames, 'Web').w, true);
  const placed = placeUnits(units, saved, groups);
  for (const [id, radius] of [['lead', 25], ['a', 21], ['b', 21]]) assert.equal(contains(box(frames, 'shop'), placed.positions[id], radius), true, id);
  const overseer = placed.positions['root:overseer'];
  assert.notDeepEqual(overseer, { x: 0, y: 0 });
  assert.equal(frames.some(frame => contains(frame.bounds, overseer, 30)), false);
  const withoutIdeas = clusterFrames([web, shop, blog, unity, game], saved, null, units);
  assert.deepEqual(box(withoutIdeas, 'Web'), box(clusterFrames(groups, saved, null, units), 'Web'));
  const focused = clusterFrames([web, shop, blog, unity, game], saved, 'Web', units);
  assert.deepEqual(box(focused, 'Web'), box(withoutIdeas, 'Web'));
  assert.deepEqual(box(focused, 'Unity'), box(withoutIdeas, 'Unity'));
});

test('empty drag pans, Shift-drag selects agents and camera changes never persist writes', () => {
  const map = createMap({ units: [unit('root:a')], saved: { nodes: { 'root:a': { x: 100, y: 100 } }, groups: {} } });
  const rect = { left: 0, top: 0, width: 736, height: 818 };
  const point = (x, y, shiftKey = false) => ({ clientX: x, clientY: y, pointerId: 1, shiftKey, rect });
  pointerDown(map, point(400, 400)); pointerMove(map, point(430, 450)); pointerUp(map, point(430, 450));
  assert.deepEqual(map.view, { x: 30, y: 50, zoom: 1 });
  map.view = { x: 0, y: 0, zoom: 1 }; pointerDown(map, point(50, 50, true)); pointerMove(map, point(160, 160, true)); pointerUp(map, point(160, 160, true));
  assert.deepEqual([...map.selection], ['root:a']); assert.equal(map.pending.size, 0);
});

test('cluster refresh replaces facts while keeping chat/editor drafts and selection identities', async () => {
  const store = createStore(), draft = { value: 'Retained text' }; store.drafts.set('editor', draft); store.selected.groupId = 'Ideas';
  await applyEvent(store, { token: 'fixture', location: { origin: 'http://127.0.0.1:9' }, controllers: new Set(), now: Date.now,
    fetch: async () => new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: { items: [cluster('Ideas')], nextCursor: null }, meta: { requestId: 'fixture', readAt: '2026-10-14T00:00:00.000Z', eventCursor: '', sync: 'local' } }), { status: 200 }) },
  { name: 'cluster.changed', envelope: { data: { clusterId: 'Ideas' } } });
  assert.equal(store.indexes.groups.size, 1); assert.equal(store.drafts.get('editor'), draft); assert.equal(store.selected.groupId, 'Ideas');
});

test('inspector uses safe Git facts and an unlinked scope; six looks share bounded responsive control geometry', async () => {
  for (const language of ['en', 'es']) {
    const view = renderCluster(document, { language, cluster: cluster('Ideas'), units: [] }, {});
    assert.match(copy(view), language === 'en' ? /cannot write|nowhere to write/ : /escribir/);
  }
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /--side:\s*290px/); assert.match(css, /--inspector:\s*366px/);
  assert.match(css, /\.start-dialog button[^}]*min-height:\s*32px/s);
  assert.match(css, /max-width:\s*calc\(100vw - 32px\)/);
  for (const look of ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']) assert.ok(css.includes(`[data-look="${look}"]`));
});

const supervised = (id, title) => ({ id, title, connected: true, scopeEnforced: false, boundary: 'supervised', models: [{ id: 'observed', title: 'Observed', efforts: ['high'], modes: [] }], quota: { known: false, remainingPercent: null } });
const NATIVE_COPY = {
  en: ['HIVEM1ND cannot confine this agent on Windows. By default it asks you before every file change and command.',
    "Work automatically: it changes files and runs commands without asking, and can write outside its cluster's folder. You can turn this off in Settings, Permissions."],
  es: ['HIVEM1ND no puede confinar a este agente en Windows. De forma predeterminada, consulta antes de cada cambio de archivos y de cada comando.',
    'Trabajar de forma automática: modifica archivos y ejecuta comandos sin consultar, y puede escribir fuera de la carpeta de su clúster. Se puede desactivar en Configuración, Permisos.'],
};

test('Claude Code and Cursor are selectable and a client with no boundary stays disabled', () => {
  const mixed = [...clients.slice(0, 2), supervised('claude', 'Claude Code'), supervised('cursor', 'Cursor'),
    { id: 'invented', title: 'Invented', connected: true, scopeEnforced: false, models: [{ id: 'm', title: 'M', efforts: ['high'], modes: [] }] }];
  assert.equal(launchable(mixed[2]), true); assert.equal(launchable(mixed[4]), false); assert.equal(launchable({ ...mixed[2], boundary: 'invented' }), false);
  assert.equal(launchable({ ...mixed[2], connected: false }), false);
  assert.equal(launchable({ ...mixed[4], boundary: 'supervised' }), false, 'the supervised exception belongs only to Claude Code and Cursor');
  assert.equal(supervisedClient(mixed[2]), true); assert.equal(supervisedClient(mixed[0]), false);
  assert.equal(validRunsIn({ client: 'claude', model: 'observed', effort: 'high', mode: null }, mixed), true);
  assert.equal(validRunsIn({ client: 'invented', model: 'm', effort: 'high', mode: null }, mixed), false);
  const view = renderRunsInPicker(document, { language: 'en', clients: mixed, choice: initialRunsIn(mixed), useAsDefault: false }, {});
  const option = id => nodes(view).find(node => node.attributes?.['data-action'] === `runs-client-${id}`);
  for (const id of ['claude', 'cursor', 'codex', 'lyra']) assert.notEqual(option(id).disabled, true, id);
  assert.equal(option('invented').disabled, true);
  assert.equal(initialRunsIn([mixed[2]]).client, 'claude');
});

test('a supervised choice shows the warning banner with the unchecked Work automatically box; confined clients show none', () => {
  const mixed = [...clients.slice(0, 2), supervised('claude', 'Claude Code'), supervised('cursor', 'Cursor')];
  for (const language of ['en', 'es']) {
    for (const id of ['claude', 'cursor']) {
      const choices = [];
      const view = renderRunsInPicker(document, { language, clients: mixed, choice: initialRunsIn([mixed.find(client => client.id === id)]), automatic: false, useAsDefault: false }, { onAutomatic: value => choices.push(value) });
      const banner = nodes(view).find(node => node.attributes?.['data-native-warning']);
      assert.ok(banner, `${language} ${id}`);
      assert.equal(banner.attributes['data-native-warning'], id);
      assert.equal(copy(banner).includes(NATIVE_COPY[language][0]), true); assert.equal(copy(banner).includes(NATIVE_COPY[language][1]), true);
      const box = nodes(banner).find(node => node.attributes?.['data-work-automatically']);
      assert.equal(box.checked, false, 'unchecked by default means supervised');
      box.checked = true; box.listeners.change(); assert.deepEqual(choices, [true]);
      assert.equal(nodes(view).some(node => node.attributes?.role === 'dialog' || /Work automatically\?|¿Trabajar/.test(node.textContent ?? '')), false, 'no confirmation dialog');
      const order = nodes(view);
      assert.equal(order.indexOf(banner) > order.indexOf(order.find(node => node.attributes?.['data-action'] === 'runs-effort-high')), true, 'the banner is below the choices');
    }
    for (const choice of [initialRunsIn(clients.slice(0, 1)), { client: 'lyra', model: 'small', effort: null, mode: 'normal' }]) {
      const view = renderRunsInPicker(document, { language, clients: mixed, choice, automatic: false, useAsDefault: false }, {});
      assert.equal(nodes(view).some(node => node.attributes?.['data-native-warning']), false);
      assert.equal(nodes(view).some(node => node.attributes?.['data-work-automatically']), false);
    }
  }
  const checked = renderRunsInPicker(document, { language: 'en', clients: mixed, choice: initialRunsIn([mixed[2]]), automatic: true }, {});
  assert.equal(nodes(checked).find(node => node.attributes?.['data-work-automatically']).checked, true);
  const plan = renderRunsInPicker(document, { language: 'en', clients: mixed, choice: initialRunsIn([mixed[2]]) }, {});
  assert.equal(nodes(plan).some(node => node.attributes?.['data-native-warning']), true, 'a plan role says it asks first');
  assert.equal(nodes(plan).some(node => node.attributes?.['data-work-automatically']), false, 'a plan role has no automatic choice');
});

test('an approval card shows the whole exact command wrapped, and Stop the step shows progress and its outcome', async () => {
  const command = `node build.mjs ${'--flag=value '.repeat(110)}`.trim();
  const card = renderApproval(document, { id: 'approval', state: 'pending', action: 'file.write', pattern: { path: 'C:/shop/task.txt' }, display: `Run this exact command in C:/shop: ${command}`, alwaysAllowed: false }, key => key, () => {});
  assert.equal(copy(card).includes(command), true, 'the display is not cut');
  assert.equal(nodes(card).some(node => node.attributes?.['data-action'] === 'approve-always'), false);
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /section\.card\[data-approval\] > p:first-child\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
  for (const language of ['en', 'es']) {
    const view = { session: { id: 'session' }, work: [], nextCursor: null };
    const stop = node => nodes(node).find(item => item.attributes?.['data-action'] === 'stop-step');
    const idle = renderSessionWork(document, { ...view }, language, {});
    assert.equal(stop(idle).attributes['aria-busy'], undefined);
    const busy = renderSessionWork(document, { ...view, stopping: true }, language, {});
    assert.equal(stop(busy).attributes['aria-busy'], 'true'); assert.ok(stop(busy).attributes.disabled !== undefined || stop(busy).disabled);
    for (const [state, key] of [['stopped', 'stepStopped'], ['idle', 'stepIdle'], ['failed', 'stepNotStopped']]) {
      const done = renderSessionWork(document, { ...view, stopOutcome: { state } }, language, {});
      const outcome = nodes(done).find(item => item.attributes?.['data-stop-outcome']);
      assert.equal(outcome.attributes['data-stop-outcome'], state); assert.equal(outcome.textContent, startText(language, key));
    }
  }
  assert.notEqual(startText('en', 'stepStopped'), startText('es', 'stepStopped'));
});
