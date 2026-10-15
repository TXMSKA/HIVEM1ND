import { randomUUID } from 'node:crypto';

// Preconditions written through the actual core's HTTP API, the way the actual-core T064 tests prepare a state.
// The state a capture shows is always reached through the GUI afterwards; this only prepares what a reach step presupposes.
export const choice = { client: 'codex', model: 'observed', effort: 'high', mode: null };

export async function discoveryOffer(world) {
  return (await world.call('GET', '/settings/projects?machine=DESKTOP')).discoveryOffer;
}

// Accept the read-only discovery offer for the named repositories (default: all 26). Returns the created clusters.
export async function acceptRepositories(world, names = null) {
  const offer = await discoveryOffer(world);
  const repositories = offer.groups.flatMap(group => group.repositories).filter(item => !names || names.includes(item.name));
  const accepted = await world.call('POST', `/discovery/offers/${offer.id}/answer`, {
    machine: 'DESKTOP', repositoryIds: repositories.map(item => item.id), confirmed: true, expectedRevision: offer.revision,
  }, { key: randomUUID() });
  return accepted.clusters;
}

export async function dismissOffer(world) {
  const offer = await discoveryOffer(world);
  await world.call('POST', `/discovery/offers/${offer.id}/answer`, { machine: 'DESKTOP', repositoryIds: [], confirmed: false, expectedRevision: offer.revision });
}

export function createCluster(world, title, link = { kind: 'none' }, parentId = null) {
  return world.call('POST', '/clusters', { title, parentId, link, machine: 'DESKTOP', confirmed: true });
}

export async function createAgent(world, clusterId, role = 'executor', runsIn = choice) {
  const cluster = await world.call('GET', `/clusters/${clusterId}?machine=DESKTOP`);
  return world.call('POST', `/clusters/${clusterId}/agents`, { machine: 'DESKTOP', role, runsIn, useAsDefault: false, expectedRevision: cluster.revision });
}

export function createOverseer(world, runsIn = choice, fresh = true) {
  return world.call('POST', '/overseer', { machine: 'DESKTOP', runsIn, fresh, expectedRevision: null });
}

// A credential for an agent's own session (audience agent), for requests only an agent may make.
export function agentCredential(world, unitId, sessionId = randomUUID()) {
  return world.core.credentials.issue({ audience: 'agent', unitId, sessionId }).token;
}

export function phoneCredential(world) {
  return world.core.credentials.issue({ audience: 'phone', unitId: 'root:master' }).token;
}

export const post = (world, chatId, body, options = {}) => world.call('POST', `/chats/${chatId}/messages`, { body }, options);
