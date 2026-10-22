import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, isUuid, replaceHeader, uuidV8, validateMachineName, validateName } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { checkRevision, commitChange, prepareChangeUndo, readBytes, recoverTransactions, revisionOf, withLocalChanges } from './store.mjs';
import { editChatMetadata, groupChatBytes, projectChatBytes } from './chats.mjs';
import { projectGroup, groupTitle, groupMembers } from './groups.mjs';
import { readCollection, readProjection, readSessions } from './projection.mjs';
import { readUnitStates, stateHeader } from './state.mjs';
import { parseRoutes } from '../relay/store.mjs';
import { directoryIdentity, pathKey, readRepositoryIdentity } from './cluster-git.mjs';
import { clusterMembers } from './cluster-policy.mjs';

function fail(status, code, message) { throw new CoreError(status, code, message); }
function bytes(value) { return Buffer.from(`${canonicalJson(value)}\n`); }
function absolute(context, relative) { return path.join(context.paths.mind, ...relative.split('/')); }
export function clusterEntry(context, relative, beforeBytes, afterBytes, extra = {}) {
  return { resource: relative, recordPath: absolute(context, relative), beforeRevision: revisionOf(beforeBytes), beforeBytes, afterBytes, ...extra };
}
export function clusterEvents(cluster) {
  return [{ name: 'cluster.changed', chatId: cluster.chatId, data: { cluster } }, { name: 'group.changed', chatId: cluster.chatId, data: { group: cluster } },
    { name: 'view.changed', data: { revision: cluster.revision, collections: ['clusters', 'groups', 'chats', 'units'] } }];
}
export function clusterOwner(context, machine, { write = false } = {}) {
  validateMachineName(machine);
  if (machine !== context.paths.machine || (context.settingsOwner ?? context).active === false) fail(409, 'machine_unavailable', 'The selected cluster owner is unavailable.');
  if (write && context.principal?.audience !== 'desktop') fail(403, 'forbidden', 'Only the desktop may change clusters.');
}
export function validateClusterLink(link) {
  if (!link || typeof link !== 'object' || Array.isArray(link)) fail(422, 'invalid_link', 'A cluster link is required.');
  const field = link.kind === 'repository' ? 'projectId' : link.kind === 'folder' ? 'folderId' : null;
  if (!['repository', 'folder', 'none'].includes(link.kind) || Object.keys(link).sort().join(',') !== (field ? [field, 'kind'].sort().join(',') : 'kind')) fail(422, 'invalid_link', 'The cluster link is not valid.');
  if (field === 'projectId') validateName(link.projectId, { label: 'project' });
  if (field === 'folderId' && !isUuid(link.folderId)) fail(422, 'invalid_link', 'A folder link needs a canonical identity.');
  return link;
}
export async function rawClusters(context) {
  const root = absolute(context, 'user/gui/groups');
  await assertNoLinks(root, { root: context.paths.mind });
  const names = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const records = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || !isUuid(name.slice(0, -5))) continue;
    const relative = `user/gui/groups/${name}`, source = await readBytes(context.store, absolute(context, relative));
    if (source) records.push({ relative, bytes: source, record: JSON.parse(source), cluster: projectGroup(source, name.slice(0, -5)) });
  }
  return records;
}
export async function readClusterMappings(context) {
  const file = path.join(context.paths.localDirectory, 'cluster-links.json');
  await assertNoLinks(file, { root: context.paths.localDirectory });
  const source = await readBytes(context.store, file);
  const record = source ? JSON.parse(source) : { format: 'hivem1nd-cluster-links-v1', machine: context.paths.machine, links: {} };
  if (record.format !== 'hivem1nd-cluster-links-v1' || record.machine !== context.paths.machine || !record.links || typeof record.links !== 'object') fail(409, 'cluster_changed', 'The owner-local cluster mappings changed.');
  return { file, bytes: source, record };
}
export function mappingKey(link) { return `${link.kind}:${link.projectId ?? link.folderId}`; }
export async function resolveClusterLink(context, link, machine) {
  clusterOwner(context, machine);
  validateClusterLink(link);
  if (link.kind === 'none') return null;
  const mapping = (await readClusterMappings(context)).record.links[mappingKey(link)];
  if (!mapping?.localPath || mapping.machine !== machine) fail(409, 'cluster_changed', 'The linked directory is not available on this owner.');
  await assertNoLinks(mapping.localPath);
  if (!path.isAbsolute(mapping.localPath) || !(await lstat(mapping.localPath).catch(() => null))?.isDirectory()
    || pathKey(await realpath(mapping.localPath)) !== pathKey(mapping.localPath)
    || canonicalJson(await directoryIdentity(mapping.localPath)) !== canonicalJson(mapping.identity)) fail(409, 'cluster_changed', 'The linked directory changed.');
  return mapping;
}
export async function listClusters(context, query = {}) {
  if (query.machine !== undefined) validateMachineName(query.machine);
  const { machine, ...filters } = query;
  return readCollection(context, 'groups', filters);
}
export async function readCluster(context, id, { machine } = {}) {
  clusterOwner(context, machine);
  const current = (await rawClusters(context)).find(item => item.cluster.id === id && !item.cluster.deleted);
  if (!current) fail(404, 'cluster_not_found', 'The cluster does not exist.');
  if (context.principal?.audience === 'agent' && !current.cluster.members.includes(context.principal.unitId)) fail(403, 'forbidden', 'The agent is not a cluster member.');
  return current.cluster;
}
function assertTree(records) {
  const active = new Map(records.filter(record => !record.deleted).map(record => [record.id, record]));
  for (const record of active.values()) {
    const seen = new Set([record.id]); let parent = record.parentId;
    while (parent) {
      if (seen.has(parent)) fail(409, 'cluster_cycle', 'The cluster parent chain would loop.');
      seen.add(parent);
      if (!active.has(parent)) fail(409, 'cluster_changed', 'The parent cluster is unavailable.');
      parent = active.get(parent).parentId;
    }
  }
}
async function checkedLink(context, link, machine, exclude = null) {
  validateClusterLink(link);
  if (link.kind === 'none') return;
  const mapping = await resolveClusterLink(context, link, machine);
  const links = (await readClusterMappings(context)).record.links;
  if ((await rawClusters(context)).some(item => !item.cluster.deleted && item.cluster.id !== exclude && (canonicalJson(item.cluster.link) === canonicalJson(link)
    || mapping.repositoryId && links[mappingKey(item.cluster.link)]?.repositoryId === mapping.repositoryId))) fail(409, 'cluster_changed', 'The link already belongs to a cluster.');
}
function recordFor(context, { id = randomUUID(), title, members = [], parentId = null, link = { kind: 'none' }, deleted = false }) {
  return { format: 'hivem1nd-cluster-v1', id, title, members, parentId, link, chatId: id, deleted, createdAt: new Date(context.now()).toISOString() };
}
function newRecords(context, record) {
  const chat = groupChatBytes(context, record);
  const source = bytes({ ...record, chatRevision: revisionOf(chat) });
  return { cluster: projectGroup(source, record.id), entries: [clusterEntry(context, `user/gui/groups/${record.id}.json`, null, source),
    clusterEntry(context, `user/relay/chats/${record.id}/chat.md`, null, chat)] };
}
export async function createCluster(context, input) {
  clusterOwner(context, input?.machine, { write: true });
  if (input.confirmed !== true) fail(422, 'confirmation_required', 'Creating a cluster requires confirmation.');
  return withLocalChanges(context.store, async () => {
    const title = groupTitle(input.title), members = await groupMembers(context, input.members ?? [], true);
    const link = input.link, parentId = input.parentId;
    if (parentId !== null && !isUuid(parentId)) fail(422, 'invalid_parent', 'A cluster parent must be a UUID or null.');
    await checkedLink(context, link, input.machine);
    const record = recordFor(context, { title, members, parentId, link });
    assertTree([...(await rawClusters(context)).map(item => item.cluster), record]);
    const prepared = newRecords(context, record), id = randomUUID();
    const undo = await prepareChangeUndo(context, { id, permission: 'chat.manage', resourceIds: [record.id], entries: prepared.entries,
      events: [{ name: 'view.changed', data: { revision: null, collections: ['clusters', 'groups', 'chats'] } }] });
    await commitChange(context, { id, entries: [...prepared.entries, undo.entry], events: [...clusterEvents(prepared.cluster),
      { name: 'chat.changed', chatId: record.id, data: { chat: projectChatBytes(prepared.entries[1].afterBytes, record.id) } }],
      response: { status: 201, body: { ...prepared.cluster, changeId: id, undoUntil: undo.undoUntil } } });
    const { refreshClusterProjects } = await import('./settings.mjs');
    await refreshClusterProjects(context);
    return { ...prepared.cluster, changeId: id, undoUntil: undo.undoUntil };
  });
}
export async function patchCluster(context, id, input) {
  clusterOwner(context, input?.machine, { write: true });
  if (!['title', 'members', 'parentId', 'link'].some(key => Object.hasOwn(input, key))) fail(422, 'invalid_body', 'A cluster patch needs a change.');
  return withLocalChanges(context.store, async () => {
    const current = (await rawClusters(context)).find(item => item.cluster.id === id && !item.cluster.deleted);
    if (!current) fail(404, 'cluster_not_found', 'The cluster does not exist.');
    checkRevision(current.bytes, input.expectedRevision);
    const record = { ...current.record, format: 'hivem1nd-cluster-v1', parentId: current.cluster.parentId, link: current.cluster.link };
    if (Object.hasOwn(input, 'title')) record.title = groupTitle(input.title);
    if (Object.hasOwn(input, 'members')) record.members = await groupMembers(context, input.members, true);
    if (Object.hasOwn(input, 'parentId')) {
      if (input.parentId !== null && !isUuid(input.parentId)) fail(422, 'invalid_parent', 'A cluster parent must be a UUID or null.');
      record.parentId = input.parentId;
    }
    if (Object.hasOwn(input, 'link')) { await checkedLink(context, input.link, input.machine, id); record.link = input.link; }
    assertTree((await rawClusters(context)).map(item => item.cluster.id === id ? record : item.cluster));
    const relative = `user/relay/chats/${id}/chat.md`, beforeChat = await readBytes(context.store, absolute(context, relative));
    if (!beforeChat || revisionOf(beforeChat) !== current.record.chatRevision) fail(409, 'chat_changed', 'The linked chat changed.');
    const afterChat = editChatMetadata(beforeChat, { title: record.title, members: ['root:master', ...record.members].sort() });
    const after = bytes({ ...record, chatRevision: revisionOf(afterChat) }), cluster = projectGroup(after, id);
    await commitChange(context, { id: randomUUID(), entries: [clusterEntry(context, current.relative, current.bytes, after), clusterEntry(context, relative, beforeChat, afterChat)],
      events: [...clusterEvents(cluster), { name: 'chat.changed', chatId: id, data: { chat: projectChatBytes(afterChat, id) } }], response: { status: 200, body: cluster } });
    const { refreshClusterProjects } = await import('./settings.mjs');
    await refreshClusterProjects(context);
    return cluster;
  });
}
export async function prepareClusterRemoval(context, id, expectedRevision) {
  const records = await rawClusters(context), current = records.find(item => item.cluster.id === id && !item.cluster.deleted);
  if (!current) fail(404, 'cluster_not_found', 'The cluster does not exist.');
  checkRevision(current.bytes, expectedRevision);
  if (records.some(item => !item.cluster.deleted && item.cluster.parentId === id)) fail(409, 'cluster_has_children', 'Move the surviving child clusters before removal.');
  if ((await readSessions(context)).some(session => current.cluster.members.includes(session.unitId) && session.state !== 'stopped')) fail(409, 'stop_unavailable', 'Stop the owned sessions before removing this cluster.');
  const relative = `user/relay/chats/${id}/chat.md`, beforeChat = await readBytes(context.store, absolute(context, relative));
  if (!beforeChat || revisionOf(beforeChat) !== current.record.chatRevision) fail(409, 'chat_changed', 'The linked chat changed.');
  const afterChat = editChatMetadata(beforeChat, { listed: false, archived: true });
  const after = bytes({ ...current.record, deleted: true, chatRevision: revisionOf(afterChat) });
  return { entries: [clusterEntry(context, current.relative, current.bytes, after), clusterEntry(context, relative, beforeChat, afterChat)],
    events: [...clusterEvents(projectGroup(after, id)), { name: 'chat.changed', chatId: id, data: { chat: projectChatBytes(afterChat, id) } }],
    undoEvents: [...clusterEvents(current.cluster), { name: 'chat.changed', chatId: id, data: { chat: projectChatBytes(beforeChat, id) } }] };
}
export async function removeCluster(context, id, input, { groupAlias = false } = {}) {
  clusterOwner(context, input?.machine, { write: true });
  if (input.confirmed !== true) fail(422, 'confirmation_required', 'Removing a cluster requires confirmation.');
  return withLocalChanges(context.store, async () => {
    const prepared = await prepareClusterRemoval(context, id, input.expectedRevision), changeId = randomUUID();
    const undo = await prepareChangeUndo(context, { id: changeId, permission: 'chat.manage', resourceIds: [id], entries: prepared.entries, events: prepared.undoEvents });
    const result = { clusterId: id, ...(groupAlias ? { groupId: id } : {}), changeId, undoUntil: undo.undoUntil };
    await commitChange(context, { id: changeId, entries: [...prepared.entries, undo.entry], events: prepared.events, response: { status: 200, body: result } });
    const { refreshClusterProjects } = await import('./settings.mjs');
    await refreshClusterProjects(context);
    return result;
  });
}
export async function clusterChoices(context, unitId) {
  const state = (await readUnitStates(context)).find(item => item.id === unitId);
  if (!state || unitId === 'root:master' || stateHeader(state.bytes, 'removed') === 'true') return { clusterId: null, choices: [], ambiguous: false };
  const choices = (await rawClusters(context)).filter(item => !item.cluster.deleted && item.cluster.members.includes(unitId)).map(item => item.cluster.id).sort();
  const assigned = stateHeader(state.bytes, 'cluster-id');
  return { clusterId: choices.includes(assigned) ? assigned : choices.length === 1 ? choices[0] : null, choices, ambiguous: choices.length > 1 && !choices.includes(assigned) };
}

// Shared identities are journaled with their chats; absolute directories exist only in this owner's ledger.
const IDENTITY_READS = 6;

export async function prepareRepositoryClusters(context, projects, { remove = false, cache = null } = {}) {
  const records = await rawClusters(context), mapping = await readClusterMappings(context), entries = [], events = [], undoEvents = [], clusters = [];
  const links = structuredClone(mapping.record.links), known = new Map(records.map(item => [item.cluster.id, item]));
  // Reading a repository asks Git four times, and a first start does it for every project in turn (7.6 s for 26). The reads
  // only look, so they run a few at a time, and each one's failure is raised where the loop below reaches that project.
  const identities = new Map();
  const unread = projects.filter(project => project.eligible !== false && project.localPath && !(project.identity?.id && project.identity.path));
  for (let at = 0; at < unread.length; at += IDENTITY_READS) {
    await Promise.all(unread.slice(at, at + IDENTITY_READS).map(async project => {
      try {
        await assertNoLinks(project.localPath, cache ? { cache } : {});
        identities.set(project, { identity: await readRepositoryIdentity(project.localPath, { ...(context.settingsOwner ?? context), ...(cache ? { cache } : {}) }).catch(error => {
          if (error.code === 'git_unavailable') return null; throw error;
        }) });
      } catch (error) { identities.set(project, { error }); }
    }));
  }
  for (const project of projects) {
    const projectPath = project.eligible === false ? null : project.localPath;
    let identity = null;
    if (projectPath) {
      await assertNoLinks(projectPath, cache ? { cache } : {});
      const read = identities.get(project);
      if (read?.error) throw read.error;
      identity = project.identity?.id && project.identity.path ? project.identity : read ? read.identity : null;
    }
    let current = records.find(item => item.cluster.link.kind === 'repository' && item.cluster.link.projectId === project.name);
    if (!current && identity) current = records.find(item => links[mappingKey(item.cluster.link)]?.repositoryId === identity.id);
    if (remove) {
      if (current && !current.cluster.deleted) {
        if (project.additionId || project.id) {
          const view = await readProjection(context), members = new Set(clusterMembers(records.map(item => item.cluster), [current.cluster.id], view.units));
          if (view.sessions.some(session => members.has(session.unitId) && session.state !== 'stopped')) fail(409, 'stop_unavailable', 'Stop the owned sessions before removing this link.');
          const after = bytes({ ...current.record, link: { kind: 'none' } });
          entries.push(clusterEntry(context, current.relative, current.bytes, after));
          const detached = projectGroup(after, current.cluster.id);
          events.push(...clusterEvents(detached)); undoEvents.push(...clusterEvents(current.cluster)); clusters.push(detached);
          delete links[mappingKey(current.cluster.link)];
        } else {
          const prepared = await prepareClusterRemoval(context, current.cluster.id, current.cluster.revision);
          entries.push(...prepared.entries); events.push(...prepared.events); undoEvents.push(...prepared.undoEvents);
        }
      }
      continue;
    }
    const localPath = projectPath ? await realpath(projectPath).catch(error => { if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return null; throw error; }) : null;
    const folderPath = localPath && !project.additionId ? path.dirname(identity?.path ?? localPath) : null;
    const parent = records.find(item => item.cluster.id === current?.cluster.parentId && item.cluster.link.kind === 'folder');
    const folderId = folderPath ? parent?.cluster.link.folderId ?? uuidV8(['cluster-folder', pathKey(folderPath)]) : null;
    const folderClusterId = folderId ? parent?.cluster.id ?? uuidV8(['folder-cluster', folderId]) : null;
    if (folderId) {
      links[`folder:${folderId}`] = { kind: 'folder', folderId, machine: context.paths.machine, localPath: folderPath, identity: await directoryIdentity(folderPath) };
      if (!known.has(folderClusterId)) {
        const prepared = newRecords(context, recordFor(context, { id: folderClusterId, title: path.basename(folderPath), link: { kind: 'folder', folderId } }));
        known.set(folderClusterId, { cluster: prepared.cluster }); entries.push(...prepared.entries); events.push(...clusterEvents(prepared.cluster));
      }
    }
    const projectId = current?.cluster.link.projectId ?? project.name;
    links[`repository:${projectId}`] = { kind: 'repository', projectId, machine: context.paths.machine, localPath,
      identity: localPath ? await directoryIdentity(localPath) : null,
      repositoryId: identity?.id ?? null, worktrees: identity?.worktrees ?? [], additionId: project.additionId ?? project.id ?? null };
    if (!current) {
      const id = identity ? uuidV8(['repository-cluster', identity.id]) : uuidV8(['accepted-project-cluster', project.name]);
      if (known.has(id)) { clusters.push(known.get(id).cluster); continue; }
      const members = (await readUnitStates(context)).filter(state => state.id.startsWith(`project:${project.name}:`) && stateHeader(state.bytes, 'removed') !== 'true').map(state => state.id).sort();
      const prepared = newRecords(context, recordFor(context, { id, title: project.title ?? project.name, members, parentId: folderClusterId, link: { kind: 'repository', projectId } }));
      known.set(id, { cluster: prepared.cluster }); entries.push(...prepared.entries); events.push(...clusterEvents(prepared.cluster)); clusters.push(prepared.cluster);
    } else clusters.push(current.cluster);
  }
  const afterMapping = bytes({ ...mapping.record, links });
  if (!mapping.bytes?.equals(afterMapping)) entries.push({ resource: 'cluster-mappings', recordPath: mapping.file, beforeRevision: revisionOf(mapping.bytes), beforeBytes: mapping.bytes, afterBytes: afterMapping, private: true });
  return { entries, events, undoEvents, clusters };
}

export async function migrateClusters(context) {
  return withLocalChanges(context.store, async () => {
    await recoverTransactions(context.store);
    const manifestPath = path.join(context.paths.localDirectory, 'cluster-migration.json');
    const previous = await readBytes(context.store, manifestPath);
    if (previous) {
      const record = JSON.parse(previous);
      if (record.format !== 'hivem1nd-cluster-migration-v1' || record.machine !== context.paths.machine || record.phase !== 'complete') fail(409, 'cluster_changed', 'The cluster migration needs journal recovery.');
      if (!isUuid(record.transactionId)) fail(409, 'cluster_changed', 'The cluster migration has no verified journal.');
      const journalBytes = await readBytes(context.store, path.join(context.paths.localDirectory, 'transactions', `${record.transactionId}.json`));
      const journal = journalBytes ? JSON.parse(journalBytes) : null;
      if (journal?.id !== record.transactionId || journal.phase !== 'committed') fail(409, 'cluster_changed', 'The cluster migration journal is incomplete.');
      return record;
    }
    const records = await rawClusters(context), entries = [], upgrades = new Map();
    for (const item of records) {
      if (item.record.format !== 'hivem1nd-group-v1') continue;
      const after = bytes({ ...item.record, format: 'hivem1nd-cluster-v1', parentId: null, link: { kind: 'none' } });
      entries.push(clusterEntry(context, item.relative, item.bytes, after));
      upgrades.set(path.resolve(absolute(context, item.relative)), { before: item.cluster.revision, after: revisionOf(after) });
    }
    const routesBytes = await readBytes(context.store, absolute(context, 'user/routes.md'));
    const routes = parseRoutes(routesBytes?.toString('utf8') ?? '');
    const projects = new Map((context.projects ?? []).map(project => [project.name, project]));
    for (const project of routes.projects) if (!projects.has(project.name)) projects.set(project.name, { name: project.name, localPath: null });
    const prepared = await prepareRepositoryClusters(context, [...projects.values()]);
    entries.push(...prepared.entries);
    const all = [...records.map(item => item.cluster), ...prepared.clusters];
    for (const state of await readUnitStates(context)) {
      if (state.id === 'root:master' || stateHeader(state.bytes, 'removed') === 'true' || stateHeader(state.bytes, 'cluster-id')) continue;
      const choices = [...new Set(all.filter(cluster => !cluster.deleted && cluster.members.includes(state.id)).map(cluster => cluster.id))];
      if (choices.length !== 1) continue;
      const after = replaceHeader(state.bytes, 'cluster-id', choices[0]);
      entries.push(clusterEntry(context, state.relative, state.bytes, after));
      upgrades.set(path.resolve(state.absolute), { before: revisionOf(state.bytes), after: revisionOf(after) });
    }
    // Rebind only guards that still match the migration's before bytes; retain every old Undo snapshot.
    const directory = path.join(context.paths.localDirectory, 'change-undo');
    for (const name of await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!isUuid(name.slice(0, -5)) || !name.endsWith('.json')) continue;
      const file = path.join(directory, name), source = await readBytes(context.store, file), undo = JSON.parse(source);
      let changed = false;
      for (const entry of undo.entries ?? []) {
        const upgrade = upgrades.get(path.resolve(entry.recordPath));
        if (upgrade && entry.afterRevision === upgrade.before) { entry.afterRevision = upgrade.after; changed = true; }
      }
      if (changed) entries.push({ resource: `cluster-migration-undo:${name}`, recordPath: file, beforeRevision: revisionOf(source), beforeBytes: source, afterBytes: bytes(undo), private: true });
    }
    const transactionId = randomUUID();
    const manifest = { format: 'hivem1nd-cluster-migration-v1', machine: context.paths.machine, transactionId, phase: 'complete', groupIds: records.map(item => item.cluster.id), at: new Date(context.now()).toISOString() };
    entries.push({ resource: 'cluster-migration', recordPath: manifestPath, beforeRevision: null, afterBytes: bytes(manifest), private: true });
    await commitChange({ ...context, receipt: null }, { id: transactionId, additionAcceptance: true, entries,
      events: [...prepared.events, { name: 'view.changed', data: { revision: null, collections: ['clusters', 'groups', 'units', 'chats'] } }], response: { status: 200, body: manifest } });
    return manifest;
  });
}

export async function validateClusterBundle(context, incoming) {
  const changes = incoming.filter(item => item.target?.kind === 'mind' && /^user\/gui\/groups\/[a-f0-9-]{36}\.json$/.test(item.target.path));
  if (!changes.length) return;
  const records = new Map((await rawClusters(context)).map(item => [item.cluster.id, item.cluster]));
  for (const item of changes) {
    const id = path.posix.basename(item.target.path, '.json');
    if (item.deleted) records.delete(id);
    else records.set(id, projectGroup(item.bytes, id));
  }
  assertTree([...records.values()]);
}
