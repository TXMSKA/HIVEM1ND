import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { acceptedRepositoryCluster, clusterLead, connectedChoices, customRoleProblems, filterRepositories, initialRunsIn, launchable, readable, renderAgentForm, renderRepositoryOffer, renderRunsInPicker, repositorySelection, runsInLabel, startDialog, supervisedClient, validRunsIn } from '../gui/app/clusters.mjs';
import { renderApproval } from '../gui/app/inspector.mjs';
import { renderSessionWork } from '../gui/app/session-work.mjs';
import { AGENT_ROLES, roleLabel, startText } from '../gui/app/start-copy.mjs';
import { clusterFrames, placeUnits } from '../gui/app/map-geometry.mjs';
import { buildHierarchy, collapseNewClusters, flattenVisibleHierarchy, hierarchyDisclosure, hierarchyIcon, listedWorktrees, pathFolder, readableIdentity, revealGroup, unitRoleName } from '../gui/app/hierarchy.mjs';
import { createMap, fitMap, flyToCluster, graphBounds, paintNodes, pointerDown, pointerMove, pointerUp, wheelZoom } from '../gui/app/map.mjs';
import { renderCluster, renderClusterDetails } from '../gui/app/inspector.mjs';
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
  assert.equal(readableIdentity('project:shop:executor-shop', 'Persona'), 'Executor shop');
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
    assert.match(visible, /Executor shop/);
    assert.match(visible, /Codex, Observed, (?:High|Alto)/);
  }
});

test('Overseer and New agent forms contain only their choices, fresh is checked and no callback runs on render', () => {
  let created = 0;
  for (const language of ['en', 'es']) {
    const model = { language, kind: 'agent', cluster: cluster('Ideas'), clients, role: 'executor', choice: initialRunsIn(clients), fresh: true };
    const view = renderAgentForm(document, model, { onCreate: () => created++ });
    assert.doesNotMatch(copy(view), /Builder|lead-id|machine/);
    assert.equal(nodes(view).filter(node => node.attributes?.['data-action']?.startsWith('choose-')).length, AGENT_ROLES.length);
    const overseer = renderAgentForm(document, { ...model, kind: 'overseer', agentKind: 'external' }, {});
    assert.equal(nodes(overseer).find(node => node.attributes?.['data-start-fresh']).checked, true);
  }
  assert.equal(created, 0);
});

test('with no agent connected the Runs in field is closed, says so and leads to connecting one', () => {
  for (const [language, sentence] of [['en', /No agent is connected on this machine\./], ['es', /No hay ningún agente conectado en esta máquina\./]]) {
    let connected = 0, opened = 0;
    const view = renderAgentForm(document, { language, kind: 'overseer', agentKind: 'external', cluster: null, clients: [], choice: null, fresh: true },
      { onConnect: () => connected++, onPicker: () => opened++ });
    const runs = nodes(view).find(node => node.attributes?.['data-action'] === 'open-runs-picker');
    assert.equal(runs.disabled, true);
    assert.match(copy(view), sentence);
    assert.doesNotMatch(copy(view), /current connection|conexión actual/);
    nodes(view).find(node => node.attributes?.['data-action'] === 'connect-agent').listeners.click();
    assert.equal(connected, 1); assert.equal(opened, 0);
  }
});

test('canonical nested clusters keep aliases and exact lead links without a root person or legacy sections', () => {
  const clusters = [cluster('Web', 'folder'), ...Array.from({ length: 19 }, (_, i) => cluster(`repo-${i}`, 'repository', 'Web', i === 0 ? ['root:lead', 'root:executor'] : []))];
  const units = [unit('root:master', 'master'), unit('root:overseer', 'overseer'), unit('root:lead', 'overlord', 'repo-0'), { ...unit('root:executor', 'executor', 'repo-0', 'root:lead'), alias: 'Cart' }];
  const state = { shown: new Map(), collapsed: new Set() }, tree = buildHierarchy(units, [], clusters);
  const rows = flattenVisibleHierarchy(tree, state);
  assert.equal(rows.some(row => row.unit?.role === 'master'), false); assert.equal(rows.filter(row => row.kind === 'cluster').length, 7);
  assert.equal(rows.find(row => row.unit?.id === 'root:executor').label, 'Cart (Executor)');
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
  // The Overseer sits centred above the clusters the layout placed, not above the one the person put far away.
  const placement = placeUnits([unit('root:overseer', 'overseer')], saved, groups), web = frames.find(frame => frame.group.id === 'Web').bounds, overseer = placement.positions['root:overseer'];
  assert.ok(overseer.y < web.y && overseer.x > web.x && overseer.x < web.x + web.w);
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

test('a model id reads as a name with its version dotted, and the runs-in line says the vendor once', () => {
  assert.equal(readable('claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(readable('claude-sonnet-4-1'), 'Claude Sonnet 4.1');
  assert.equal(readable('gpt-5_1'), 'Gpt 5.1');
  assert.equal(readable('claude-sonnet-4-20250514'), 'Claude Sonnet 4 20250514');
  assert.equal(readable('alternate-model'), 'Alternate Model');
  const claude = [{ id: 'claude', title: 'claude', models: [{ id: 'claude-opus-5-5', title: 'claude-opus-5-5', efforts: ['medium'] }] }];
  const choice = { client: 'claude', model: 'claude-opus-5-5', effort: 'medium', mode: null };
  assert.equal(runsInLabel(choice, claude), 'Claude Code, Claude Opus 5.5, Medium');
  assert.equal(runsInLabel(choice, claude, 'en', { brief: true }), 'Claude Code, Opus 5.5, Medium');
  assert.equal(runsInLabel({ client: 'codex', model: 'observed', effort: 'high' }, clients, 'en', { brief: true }), 'Codex, Observed, High');
});

const classOf = node => String(node.className ?? '').split(/\s+/);
const find = (root, selector) => nodes(root).find(node => selector(node));
const action = (root, name) => find(root, node => node.attributes?.['data-action'] === name);

test('a cluster header carries one summary line: what it is, what it holds, and its agents', () => {
  const summary = (model, language = 'en') => find(renderCluster(document, { language, ...model }, {}), node => node.attributes?.['data-cluster-summary']).textContent;
  const folder = cluster('Unity', 'folder'), repos = ['A', 'B', 'C', 'D', 'E'].map(id => cluster(id, 'repository', 'Unity'));
  assert.equal(summary({ cluster: folder, children: repos, units: [] }), 'Folder, 5 repositories, no agents');
  assert.equal(summary({ cluster: folder, children: repos.slice(0, 1), units: [] }), 'Folder, 1 repository, no agents');
  assert.equal(summary({ cluster: folder, children: repos, units: [] }, 'es'), 'Carpeta, 5 repositorios, sin agentes');
  const shop = cluster('shop', 'repository', null, ['root:a', 'root:b']);
  assert.equal(summary({ cluster: shop, git: { branch: 'main' }, units: [unit('root:a'), unit('root:b')] }), 'Repository, branch main, 2 agents');
  assert.equal(summary({ cluster: { ...shop, members: ['root:a'] }, git: { branch: 'main' }, units: [unit('root:a')] }), 'Repository, branch main, 1 agent');
  assert.equal(summary({ cluster: shop, git: { branch: 'main' }, units: [] }, 'es'), 'Repositorio, rama main, sin agentes');
  assert.equal(summary({ cluster: shop, units: [] }), 'Repository, no agents');
  assert.equal(summary({ cluster: cluster('Ideas'), units: [] }), 'Not linked, no agents');
  assert.equal(summary({ cluster: cluster('Ideas'), units: [] }, 'es'), 'Sin vínculo, sin agentes');
  const header = renderCluster(document, { language: 'en', cluster: folder, children: repos, units: [] }, {});
  assert.equal(nodes(header).some(node => node.attributes?.['data-cluster-git'] || node.attributes?.['data-cluster-lead']), false, 'the path and the agents line leave the header');
});

test('a folder cluster Details holds its kind, path and repositories, and offers its first agent', () => {
  const folder = cluster('Unity', 'folder'), repos = ['E pet', 'Quark'].map(id => cluster(id, 'repository', 'Unity'));
  let created = 0, planned = 0;
  const details = renderClusterDetails(document, { language: 'en', cluster: folder, children: repos, units: [], link: { clusterId: 'Unity', localPath: 'C:\\Users\\dev\\Unity' } },
    { onNewAgent: () => { created += 1; }, onChoosePlanner: () => { planned += 1; } });
  const cards = nodes(details).filter(node => node.attributes?.['data-details-section']).map(node => node.attributes['data-details-section']);
  assert.deepEqual(cards, ['cluster', 'agents']);
  const facts = nodes(details).filter(node => classOf(node).includes('fact')).map(node => node.children.map(child => child.textContent));
  assert.deepEqual(facts, [['Kind', 'Folder'], ['Path', ''], ['Repositories', 'E pet, Quark']]);
  assert.equal(find(details, node => node.tagName === 'CODE').textContent, 'C:\\Users\\dev\\Unity');
  assert.match(copy(details), /No agents yet\. An Overlord here plans for the 2 repositories; an Executor works in one\./);
  const newAgent = action(details, 'new-agent-card'), choose = action(details, 'choose-planner');
  assert.equal(newAgent.textContent, 'New agent'); assert.ok(classOf(newAgent).includes('primary')); assert.equal(choose.textContent, 'Choose who plans');
  newAgent.listeners.click(); choose.listeners.click();
  assert.deepEqual([created, planned], [1, 1]);
  assert.equal(nodes(details).some(node => node.attributes?.['data-chat'] || classOf(node).includes('transcript')), false, 'Details never shows the conversation');
  const es = renderClusterDetails(document, { language: 'es', cluster: folder, children: repos, units: [] }, {});
  assert.match(copy(es), /Todavía no hay agentes\. Un Overlord planifica para los 2 repositorios; un Executor trabaja en uno\./);
  assert.equal(find(es, node => node.attributes?.['data-folder-missing']).children[1].textContent, 'No está en esta máquina');
});

test('a cluster with agents lists them, and one with a lead no longer asks who plans', () => {
  const shop = cluster('shop', 'repository', null, ['root:lead', 'root:worker']);
  const units = [unit('root:lead', 'overlord'), unit('root:worker', 'executor', null, 'root:lead')];
  const details = renderClusterDetails(document, { language: 'en', cluster: shop, units, git: { branch: 'main', remote: 'origin', dirtyCount: 2 }, link: { localPath: 'C:\\shop' } }, {});
  const lines = nodes(details).filter(node => node.attributes?.['data-cluster-agent']).map(node => node.children.slice(1).map(child => child.textContent));
  assert.deepEqual(lines, [['Lead', 'Overlord'], ['Worker', 'Executor']]);
  assert.equal(action(details, 'new-agent-card'), undefined);
  assert.equal(action(details, 'choose-planner'), undefined);
  assert.match(copy(details), /2 files changed, not committed/);
  const branch = nodes(details).filter(node => classOf(node).includes('fact')).map(node => node.children.map(child => child.textContent));
  assert.deepEqual(branch.at(-1), ['Branch', '']);
  assert.equal(find(details, node => node.tagName === 'CODE' && node.textContent === 'main') != null, true);
});

test('an unlinked cluster offers Link a folder in Details, in both languages', () => {
  for (const [language, linkText, kindText] of [['en', 'Link a folder', 'Not linked'], ['es', 'Vincular una carpeta', 'Sin vínculo']]) {
    let linked = 0;
    const details = renderClusterDetails(document, { language, cluster: cluster('Ideas'), units: [] }, { onLink: () => { linked += 1; } });
    assert.match(copy(details), language === 'en' ? /cannot write|nowhere to write/ : /escribir/);
    const link = action(details, 'link-folder');
    assert.equal(link.textContent, linkText);
    link.listeners.click();
    assert.equal(linked, 1);
    assert.equal(find(details, node => classOf(node).includes('fact')).children[1].textContent, kindText);
    assert.equal(nodes(details).some(node => node.attributes?.['data-folder-missing']), false, 'an unlinked cluster has no path to be missing');
    assert.match(copy(details), language === 'en' ? /No agents yet\. An Executor works here\./ : /Todavía no hay agentes\. Un Executor trabaja aquí\./);
  }
});

test('inspector uses safe Git facts and an unlinked scope; six looks share bounded responsive control geometry', async () => {
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

test('the Runs in picker shows readable names for catalog ids and never prints null', () => {
  const catalog = [{ id: 'codex', title: 'codex', connected: true, scopeEnforced: true, boundary: 'confined', quota: { known: false },
    models: [{ id: 'observed', title: 'observed', efforts: ['high'], modes: [] }, { id: 'alternate', title: 'alternate', efforts: ['xhigh'], modes: [] }] }];
  const picker = renderRunsInPicker(document, { language: 'en', clients: catalog, choice: { client: 'codex', model: 'observed', effort: 'high', mode: null } }, { onChoice() {}, onClose() {} });
  const text = copy(picker);
  assert.equal(/null/.test(text), false, text);
  assert.match(text, /Codex/); assert.match(text, /Observed/); assert.match(text, /Alternate/);
  assert.doesNotMatch(text, /observed/);
});

// The roles of the New agent picker: id, English label, Spanish label.
const PICKER = [['executor', 'Executor', 'Executor'], ['overlord', 'Overlord', 'Overlord'], ['ux-designer', 'UX designer', 'Diseñador UX'],
  ['ui-designer', 'UI designer', 'Diseñador UI'], ['writer', 'Writer', 'Redactor'], ['game-designer', 'Game designer', 'Game designer'],
  ['security-consultant', 'Security consultant', 'Consultor de ciberseguridad'], ['qa', 'QA', 'QA'], ['code-reviewer', 'Code reviewer', 'Revisor de código'],
  ['product-manager', 'Product manager', 'Product manager'], ['helper', 'Helper', 'Ayudante'], ['custom', 'Custom', 'Personalizado']];
const agentModel = (extra = {}) => ({ language: 'en', kind: 'agent', cluster: cluster('Ideas'), clients, role: 'executor', choice: initialRunsIn(clients), fresh: true,
  roleName: '', roleDescription: '', roleProblems: {}, ...extra });
const startField = (view, name) => nodes(view).find(node => node.attributes?.['data-start-field'] === name);
const roleButtons = view => nodes(view).filter(node => node.attributes?.['data-action']?.startsWith('choose-'));

test('the New agent picker offers every preset and Custom, each with a line under its name, in both languages', () => {
  assert.deepEqual(AGENT_ROLES, PICKER.map(row => row[0]));
  for (const language of ['en', 'es']) {
    const picks = [];
    const view = renderAgentForm(document, agentModel({ language, role: 'qa' }), { onRole: id => picks.push(id) });
    const options = roleButtons(view);
    assert.deepEqual(options.map(node => node.getAttribute('data-action').slice('choose-'.length)), PICKER.map(row => row[0]));
    PICKER.forEach(([id, en, es], index) => {
      const label = nodes(options[index]).find(node => node.tagName === 'STRONG'), hint = nodes(options[index]).find(node => node.tagName === 'SMALL');
      assert.equal(label.textContent, language === 'es' ? es : en, id);
      assert.ok(hint.textContent.length > 12 && hint.textContent !== label.textContent, id);
    });
    assert.deepEqual(options.filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.getAttribute('data-action')), ['choose-qa']);
    options.at(-1).listeners.click();
    assert.deepEqual(picks, ['custom']);
    // A preset needs nothing more: the name and description fields belong to Custom alone.
    assert.equal(nodes(view).some(node => node.attributes?.['data-custom-role']), false);
    assert.equal(startField(view, 'roleName'), undefined);
  }
});

test('Custom shows a role name and a description with a character count that follows the typing', () => {
  const typed = {};
  const view = renderAgentForm(document, agentModel({ role: 'custom' }), { onRoleName: value => { typed.name = value; }, onRoleDescription: value => { typed.description = value; } });
  const name = startField(view, 'roleName'), area = startField(view, 'roleDescription');
  assert.equal(name.tagName, 'INPUT'); assert.equal(name.getAttribute('maxlength'), '60');
  assert.equal(area.tagName, 'TEXTAREA'); assert.equal(area.getAttribute('maxlength'), '4000');
  assert.deepEqual(roleButtons(view).filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.getAttribute('data-action')), ['choose-custom']);
  const count = nodes(view).find(node => node.attributes?.['data-role-count']);
  assert.equal(count.textContent, '0 of 4000');
  area.value = 'Reviews the release notes\nbefore each tag.'; area.listeners.input();
  assert.equal(typed.description, area.value); assert.equal(count.textContent, `${area.value.length} of 4000`);
  name.value = 'Release captain'; name.listeners.input();
  assert.equal(typed.name, 'Release captain');
  assert.equal(nodes(view).some(node => node.attributes?.['data-role-error']), false);
  // What was typed comes back when the form is drawn again, and the Spanish form says the same in Spanish.
  const again = renderAgentForm(document, agentModel({ language: 'es', role: 'custom', roleName: name.value, roleDescription: area.value }), {});
  assert.equal(startField(again, 'roleName').value, 'Release captain'); assert.equal(startField(again, 'roleDescription').value, area.value);
  assert.match(copy(again), /Nombre del rol/); assert.match(copy(again), /Descripción/);
  assert.equal(nodes(again).find(node => node.attributes?.['data-role-count']).textContent, `${area.value.length} de 4000`);
});

test('a custom role is checked as the service checks it and each problem shows under its field until the field is edited', () => {
  const both = { roleName: 'roleNameRequired', roleDescription: 'roleDescriptionRequired' };
  assert.deepEqual(customRoleProblems('', ''), both);
  assert.deepEqual(customRoleProblems('   ', ' \n '), both);
  assert.deepEqual(customRoleProblems(undefined, null), both);
  assert.deepEqual(customRoleProblems('a'.repeat(61), 'x'), { roleName: 'roleNameLong' });
  assert.deepEqual(customRoleProblems('two\nlines', 'x'), { roleName: 'roleNameLine' });
  assert.deepEqual(customRoleProblems('QA', 'x'.repeat(4001)), { roleDescription: 'roleDescriptionLong' });
  assert.deepEqual(customRoleProblems(`  ${'a'.repeat(60)}  `, `${'x'.repeat(4000)}  `), {});
  assert.deepEqual(customRoleProblems('Release captain', 'First line\n\nSecond line'), {});
  for (const language of ['en', 'es']) {
    const view = renderAgentForm(document, agentModel({ language, role: 'custom', roleProblems: customRoleProblems('', '') }), { onRoleName() {}, onRoleDescription() {} });
    const errors = nodes(view).filter(node => node.attributes?.['data-role-error']);
    assert.deepEqual(errors.map(node => node.getAttribute('data-role-error')), ['roleName', 'roleDescription']);
    assert.deepEqual(errors.map(node => node.textContent), [startText(language, 'roleNameRequired'), startText(language, 'roleDescriptionRequired')]);
    assert.ok(errors.every(node => node.getAttribute('role') === 'alert'));
    const name = startField(view, 'roleName');
    assert.equal(name.getAttribute('aria-invalid'), 'true'); assert.equal(name.getAttribute('aria-describedby'), errors[0].getAttribute('id'));
    name.value = 'QA'; name.listeners.input();
    assert.equal(errors[0].textContent, ''); assert.equal(name.getAttribute('aria-invalid'), 'false'); assert.notEqual(errors[1].textContent, '');
    const area = startField(view, 'roleDescription');
    area.value = 'Tests the work.'; area.listeners.input();
    assert.equal(errors[1].textContent, '');
  }
  assert.match(startText('en', 'roleNameLong', { max: 60 }), /60 characters/);
  assert.match(startText('es', 'roleDescriptionLong', { max: 4000 }), /4000 caracteres/);
});

test('the picker and the Custom fields have rules that keep them inside a narrow dialog', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.role-option\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.role-option > span:first-child\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.start-custom-role input, \.start-custom-role textarea\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/);
  assert.match(css, /\.start-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)[^}]*overflow:\s*auto/);
});

test('every role has an icon, a custom unit is named by its roleName, and an unknown role is an agent that never throws', () => {
  const icons = new Map(AGENT_ROLES.map(id => [id, hierarchyIcon({ role: id })]));
  assert.ok([...icons.values()].every(name => typeof name === 'string' && name));
  // The eight new presets and Custom each have an icon of their own, apart from the plain agent mark.
  const added = AGENT_ROLES.filter(id => !['executor', 'overlord'].includes(id));
  assert.equal(new Set(added.map(id => icons.get(id))).size, added.length);
  assert.ok(added.every(id => icons.get(id) !== 'executor'));
  const custom = { ...unit('c', 'custom', 'shop'), role: 'custom', roleName: 'Release captain', roleDescription: 'Cuts the release.' };
  assert.equal(unitRoleName(custom, 'en'), 'Release captain'); assert.equal(unitRoleName({ ...custom, roleName: null }, 'es'), 'Personalizado');
  assert.equal(unitRoleName({ role: 'qa' }, 'es'), 'QA'); assert.equal(unitRoleName({ role: 'code-reviewer' }, 'en'), 'Code reviewer');
  // Executor and Overlord are told apart by their icon alone.
  assert.equal(unitRoleName({ role: 'executor' }, 'en'), ''); assert.equal(unitRoleName({ role: 'overlord' }, 'en'), '');
  for (const role of ['something-new', 'constructor', '__proto__', 'toString', '', null, undefined, 7, {}]) {
    assert.equal(hierarchyIcon({ role }), 'executor', String(role));
    assert.equal(unitRoleName({ role }, 'en'), '', String(role));
    assert.equal(roleLabel('en', role), 'Agent', String(role)); assert.equal(roleLabel('es', role), 'Agente', String(role));
  }
  assert.equal(roleLabel('en'), 'Agent');
  assert.equal(roleLabel('en', 'custom', '  Release captain  '), 'Release captain'); assert.equal(roleLabel('es', 'custom', '   '), 'Personalizado');
  assert.equal(roleLabel('en', 'ux-designer', 'ignored'), 'UX designer');
  const rows = flattenVisibleHierarchy(buildHierarchy([custom, { ...unit('u', 'odd', 'shop'), role: 'constructor' }], [], [{ id: 'shop', title: 'Shop', members: ['c', 'u'], link: { kind: 'none' } }]),
    { shown: new Map(), collapsed: new Set() });
  assert.deepEqual(rows.filter(row => row.kind === 'unit').map(row => row.unit.id).sort(), ['c', 'u']);
});

test('map geometry places the new roles and an unknown role like any other member', () => {
  const units = ['ux-designer', 'ui-designer', 'writer', 'game-designer', 'security-consultant', 'qa', 'code-reviewer', 'product-manager', 'custom', 'constructor', 'invented']
    .map((role, index) => ({ ...unit(`m${index}`, `m${index}`, 'shop'), role, scope: { kind: 'root', name: null } }));
  const groups = [{ id: 'shop', title: 'Shop', members: units.map(item => item.id), link: { kind: 'none' } }];
  const placed = placeUnits(units, { nodes: {}, groups: {} }, groups);
  for (const item of units) {
    assert.ok(Number.isFinite(placed.positions[item.id]?.x) && Number.isFinite(placed.positions[item.id]?.y), item.role);
  }
  const taken = units.map(item => placed.positions[item.id]);
  assert.equal(new Set(taken.map(point => `${point.x},${point.y}`)).size, units.length);
});

test('an anchored New agent dialog that grows moves up to stay on screen and does not move back down', () => {
  const size = { height: 400 };
  const dom = { ...document, body: { append() {} }, defaultView: { innerWidth: 1200, innerHeight: 700 }, activeElement: null,
    createElement(name) {
      const node = document.createElement(name);
      Object.assign(node, { style: {}, querySelector: () => null, querySelectorAll: () => [], showModal() {}, close() {} });
      if (name === 'dialog') node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: size.height });
      return node;
    } };
  const anchor = { getBoundingClientRect: () => ({ left: 700, right: 1000, top: 270, bottom: 300, width: 300, height: 30 }) };
  const flow = startDialog(dom, { view: 'agent', language: 'en', anchor, render: () => dom.createElement('section') });
  const top = () => Number.parseFloat(flow.dialog.style.top);
  assert.equal(top(), 284); assert.equal(flow.dialog.style.left, '600px');
  size.height = 600; flow.paint();
  assert.equal(top(), 84);
  size.height = 300; flow.paint();
  assert.equal(top(), 84);
  size.height = 800; flow.paint();
  assert.equal(top(), 16);
  // A dialog without an anchor is centered by the browser and keeps no position of its own.
  const centered = startDialog(dom, { view: 'overseer', language: 'en', render: () => dom.createElement('section') });
  size.height = 900; centered.paint();
  assert.equal(centered.dialog.style.top, undefined);
});

test('the Hierarchy always ends with Services: Incubator, then Genesis, each its own unit or a row that offers to set it up', () => {
  const state = { shown: new Map(), collapsed: new Set() }, web = cluster('Web', 'folder');
  const rowsOf = (units, query = '', options = undefined) => flattenVisibleHierarchy(buildHierarchy(units, [], [web]), state, query, options);
  const services = rows => rows.slice(rows.findIndex(row => row.id === 'section:services'));
  const overseer = unit('root:overseer', 'overseer');
  const empty = services(rowsOf([overseer]));
  assert.deepEqual(empty.map(row => row.id), ['section:services', 'service:incubator', 'service:genesis']);
  assert.deepEqual(empty.slice(1).map(row => [row.kind, row.role, row.labelKey, row.glyph]), [['service', 'incubator', 'finalIncubator', 'bulb'], ['service', 'genesis', 'finalGenesis', 'genesis']]);
  assert.equal(rowsOf([overseer]).at(-1).id, 'service:genesis', 'the section is the last thing in the list');
  const genesis = unit('root:genesis', 'genesis'), incubator = unit('root:incubator', 'incubator');
  assert.deepEqual(services(rowsOf([overseer, genesis])).map(row => row.id), ['section:services', 'service:incubator', 'root:genesis']);
  assert.deepEqual(services(rowsOf([overseer, genesis, incubator])).map(row => [row.id, row.kind]), [['section:services', 'heading'], ['root:incubator', 'unit'], ['root:genesis', 'unit']], 'a unit that exists is its own row, in the same order');
  // A search narrows the list, so a missing row there does not say the service is not set up; nor does a list that has not arrived.
  assert.equal(rowsOf([overseer], 'quark').some(row => row.kind === 'service' || row.id === 'section:services'), false);
  assert.deepEqual(services(rowsOf([overseer, genesis], 'genesis')).map(row => row.id), ['section:services', 'root:genesis']);
  assert.equal(rowsOf([overseer], '', { loaded: false }).some(row => row.kind === 'service'), false);
  assert.deepEqual(services(rowsOf([overseer, genesis], '', { loaded: false })).map(row => row.id), ['section:services', 'root:genesis']);
});

test('the Hierarchy cuts the branch of a cluster row, not its name', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.list \[data-cluster-row\] \.group-title\s*\{[^}]*flex:\s*0 1 auto;[^}]*min-width:\s*4ch;[^}]*max-width:\s*70%/);
  assert.match(css, /\.list \[data-cluster-row\] \.hierarchy-branch\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0/);
  assert.match(css, /\.list \.row-cluster, \.list \.row-worktree\s*\{[^}]*grid-template-columns:\s*16px 18px fit-content\(70%\) minmax\(0, 1fr\) 2\.5rem/);
  assert.doesNotMatch(css, /7\.5rem/, 'no fixed track is kept for the branch');
  assert.match(css, /\.hierarchy-branch\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.group-title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/);
});

test('a folded chip, the pick and the services have rules for their controls', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.map-chip-expand\s*\{[^}]*cursor:\s*pointer/);
  assert.match(css, /\.map-chip-expand:hover\s*\{[^}]*background/);
  assert.match(css, /\.map-chip-expand:focus-visible\s*\{[^}]*outline/);
  assert.match(css, /\.map-help\s*\{[^}]*max-width:\s*min\(320px[^}]*padding:\s*12px[^}]*border-radius:\s*12px/);
  assert.match(css, /\.map-help\s*\{[^}]*border:\s*1px solid var\(--line2\)[^}]*background:\s*var\(--card\)/);
  assert.match(css, /\.map-cluster-frame\.is-picked\s*\{[^}]*fill:\s*var\(--accent-soft\)[^}]*stroke:\s*var\(--accent\)[^}]*stroke-width:\s*2;[^}]*stroke-dasharray:\s*none/);
  assert.match(css, /\.map-node\.is-selected, \.map-node\.is-picked\s*\{/);
  assert.doesNotMatch(css, /map-service|map-services/);
  assert.match(css, /\.map-group-badge\s*\{[^}]*background:\s*var\(--card2\)[^}]*color:\s*var\(--body\)[^}]*font-size:\s*11px;[^}]*font-weight:\s*700/);
});
