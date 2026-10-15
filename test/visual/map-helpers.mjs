import { randomUUID } from 'node:crypto';
import { createNativeAdapter } from '../../engine/service/adapters.mjs';
import { CoreError } from '../../engine/service/identity.mjs';
import { placeUnits } from '../../gui/app/map-geometry.mjs';
import { acceptRepositories, createAgent, createOverseer, choice } from './seed.mjs';

// Shared preconditions for the Map references (rows 2.x). Everything here is written through the actual core's HTTP
// API; the states themselves are reached through the GUI.

export const unitsOf = async world => (await world.call('GET', '/units?limit=100')).items ?? (await world.call('GET', '/units?limit=100'));
export const clustersOf = async world => (await world.call('GET', '/clusters?limit=200')).items;

// The actual core stores position {x: 0, y: 0} for every unit that is created without a position, which stacks every
// circle in one point of the Map. A person would have dragged the circles apart, so the first free layout the Map itself
// computes (placeUnits, the same function the GUI uses before a layout exists) is written as the saved layout.
export async function placeNodes(world) {
  const [units, clusters, current] = await Promise.all([unitsOf(world), clustersOf(world), world.call('GET', '/layout')]);
  const { positions } = placeUnits(units.filter(unit => unit.role !== 'master' && !unit.removed), { nodes: {}, groups: {} }, clusters);
  const nodes = Object.fromEntries(units.filter(unit => positions[unit.id]).map(unit => [unit.id, { x: Math.round(positions[unit.id].x), y: Math.round(positions[unit.id].y) }]));
  await world.call('PATCH', '/layout', { nodes, expectedRevision: current.revision });
  return nodes;
}

// Accepted repositories, their agents and the Overseer. `agents` maps a repository name to the roles created in its cluster.
export async function seedMap(world, { repositories = ['shop', 'game-1'], agents = { shop: ['overlord', 'executor', 'executor'], 'game-1': ['executor'] }, overseer = true, runsIn = choice } = {}) {
  const clusters = await acceptRepositories(world, repositories);
  const byName = Object.fromEntries(clusters.map(cluster => [cluster.title, cluster]));
  const created = {};
  for (const [name, roles] of Object.entries(agents)) {
    created[name] = [];
    for (const role of roles) created[name].push(await createAgent(world, byName[name].id, role, runsIn));
  }
  if (overseer) await createOverseer(world, runsIn);
  await placeNodes(world);
  return { clusters: byName, agents: created };
}

export const idOf = (scope, unit) => `project:${scope}:${unit}`;

export async function setAlias(world, unit, alias) {
  const current = await world.call('GET', `/units/${encodeURIComponent(unit.id)}`);
  return world.call('PATCH', `/units/${encodeURIComponent(unit.id)}/alias`, { alias, expectedRevision: current.revision });
}

// Open the app and wait until the Map shows the expected circles at distinct places (the saved layout has been applied).
export async function openMap(ctx, count) {
  await ctx.open({ overseerExists: true });
  await ctx.page.waitFor(expected => {
    const nodes = [...document.querySelectorAll('.map-node')].map(node => node.getBoundingClientRect());
    if (nodes.length < expected) return false;
    return new Set(nodes.map(rect => `${Math.round(rect.x)}:${Math.round(rect.y)}`)).size === nodes.length && document.querySelector('[data-cluster-row]');
  }, { args: [count], timeout: 30000, message: `${count} Map circles at distinct places and the cluster tree` });
}

export const node = id => `.map-node[data-unit-id="${id}"]`;

// A direct chat with a unit: the person's message, the agent's reply written with its own credential.
export async function directChat(world, unit, { messages = [], replies = [] } = {}, credential) {
  const chat = await world.call('POST', '/chats', { members: [unit.id] });
  for (const body of messages) await world.call('POST', `/chats/${chat.id}/messages`, { body });
  for (const body of replies) await world.call('POST', `/chats/${chat.id}/messages`, { body }, { credential });
  return chat;
}

// A native client that does not answer a start until the case releases it or makes it fail. The actual core reports the
// session as queued, then starting, for as long as the adapter holds the launch (engine/service/adapters.mjs create).
export function gatedClient(fixture) {
  const options = { fixture: true, models: ['observed', 'alternate'], efforts: ['high', 'xhigh'], transcript: [] };
  const real = createNativeAdapter('codex', options);
  let release, refuse;
  const gate = new Promise((resolve, reject) => { release = resolve; refuse = reject; });
  gate.catch(() => undefined);
  const adapter = Object.create(real);
  adapter.create = async request => {
    await gate;
    options.transcript = [JSON.stringify({ id: 1, result: { thread: { id: randomUUID() } } })];
    return real.create(request);
  };
  fixture.visualGate = {
    open: () => release(),
    fail: (message = 'The selected client did not answer.') => refuse(new CoreError(503, 'client_unavailable', message)),
  };
  return { adapters: { codex: adapter } };
}

// The actual core with its client held at the start; used by the Starting and It did not start references.
export const heldStart = { prepare: async fixture => gatedClient(fixture) };

// Open the Start dialog of the selected circle from the inspector and start a chat session (no task text needed).
export async function startFromInspector(ctx) {
  const { page } = ctx;
  await ctx.visible('.inspector .agent-controls > summary');
  await page.click('.inspector .agent-controls > summary');
  await ctx.visible('.inspector [data-action="start-session"]');
  await page.click('.inspector [data-action="start-session"]');
  await ctx.visible('dialog[open][data-form="session"]');
  await page.click('dialog[open][data-form="session"] input[name="runMode"][value="chat"]');
  await page.click('dialog[open][data-form="session"] [data-action="confirm-form"]');
}
