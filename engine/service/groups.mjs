import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CoreError, canonicalJson, isUuid, parseUnitId } from './identity.mjs';
import { stateHeader, readUnitState } from './state.mjs';
import { checkRevision, commitChange, readBytes, revisionOf, withLocalChanges } from './store.mjs';
import { editChatMetadata, projectChatBytes } from './chats.mjs';
import { projectChat, readCollection } from './projection.mjs';
import { createCluster, patchCluster, removeCluster, validateClusterLink } from './clusters.mjs';

export function projectGroup(bytes, id) {
  try {
    const record = JSON.parse(bytes);
    if (!['hivem1nd-group-v1', 'hivem1nd-cluster-v1'].includes(record.format) || !isUuid(id) || record.id !== id || record.chatId !== id // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
      || typeof record.deleted !== 'boolean' || groupTitle(record.title) !== record.title
      || !Array.isArray(record.members) || record.members.length > 255
      || new Set(record.members).size !== record.members.length
      || record.members.some((member) => member === 'root:master' || parseUnitId(member).id !== member)
      || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('format');
    const parentId = record.parentId ?? null, link = record.link ?? { kind: 'none' };
    if (record.format === 'hivem1nd-cluster-v1' && (!Object.hasOwn(record, 'parentId') || !Object.hasOwn(record, 'link'))) throw new Error('cluster'); // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
    if (['localPath', 'commonDir', 'writeRoots', 'nativeSessionId', 'credential', 'token'].some(key => Object.hasOwn(record, key))) throw new Error('private');
    if (parentId !== null && !isUuid(parentId)) throw new Error('parent');
    validateClusterLink(link);
    return { parentId, link, id, title: record.title, members: record.members, chatId: id, createdAt: record.createdAt, revision: revisionOf(bytes), deleted: record.deleted };
  } catch { throw new CoreError(422, 'corrupt_resource', 'The group record is not valid.'); }
}

export async function listGroups(context, query = {}) {
  return readCollection(context, 'groups', query);
}

export async function prepareUnitMembershipRemoval(context, unitId) {
  const entries = [], events = [], undoEvents = [];
  const groups = [];
  let cursor = null;
  do {
    const page = await listGroups(context, { limit: 200, cursor });
    groups.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  for (const group of groups) {
    if (!group.members.includes(unitId)) continue;
    const current = await loadGroup(context, group.id);
    const members = current.record.members.filter((id) => id !== unitId);
    if (!members.length && current.record.format !== 'hivem1nd-cluster-v1') throw new CoreError(422, 'invalid_members', 'Remove the one-member group before removing its last unit.'); // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
    const chatBytes = editChatMetadata(current.chatBytes, { members: ['root:master', ...members].sort() });
    const bytes = groupBytes({ ...current.record, members,
      formerMembers: [...new Set([...(current.record.formerMembers ?? []), unitId])], chatRevision: revisionOf(chatBytes) });
    entries.push(entry(context, current.relative, current.bytes, bytes), entry(context, current.chatRelative, current.chatBytes, chatBytes));
    events.push(...changed(projectGroup(bytes, group.id), projectChatBytes(chatBytes, group.id, current.chat)));
    undoEvents.push(...changed(group, current.chat));
  }
  return { entries, events, undoEvents };
}

export async function createGroup(context, input) {
  desktop(context);
  await groupMembers(context, input?.members, true);
  return createCluster(context, { ...input, parentId: null, link: { kind: 'none' }, machine: context.paths.machine, confirmed: true });
}

export async function patchGroup(context, groupId, input) {
  try { return await patchCluster(context, groupId, { ...input, machine: context.paths.machine }); }
  catch (error) { if (error.code === 'cluster_not_found') throw new CoreError(404, 'group_not_found', 'The group does not exist.'); throw error; }
}

export async function removeGroup(context, groupId, input) {
  try {
    return await removeCluster(context, groupId, { ...input, machine: context.paths.machine }, { groupAlias: true });
  } catch (error) { if (error.code === 'cluster_not_found') throw new CoreError(404, 'group_not_found', 'The group does not exist.'); throw error; }
}

export async function patchGroupChat(context, groupId, input) {
  desktop(context);
  const changes = {};
  for (const key of ['pinned', 'listed']) {
    if (!Object.hasOwn(input ?? {}, key)) continue;
    if (typeof input[key] !== 'boolean') throw new CoreError(422, 'invalid_body', 'Chat metadata must be boolean.');
    changes[key] = input[key];
  }
  if (!Object.keys(changes).length) throw new CoreError(422, 'invalid_body', 'A chat patch needs pinned or listed.');
  return withLocalChanges(context.store, async () => {
    const current = await loadGroup(context, groupId, true);
    checkRevision(current.chatBytes, input.expectedRevision);
    if (current.record.deleted && changes.listed === true) throw new CoreError(409, 'chat_changed', 'An archived group must be restored with Undo.');
    const chatBytes = editChatMetadata(current.chatBytes, changes);
    return { chat: await saveGroup(context, current, current.record, chatBytes, true) };
  });
}

async function saveGroup(context, current, record, chatBytes, returnChat = false) {
  const bytes = groupBytes({ ...record, chatRevision: revisionOf(chatBytes) });
  const group = projectGroup(bytes, record.id);
  const chat = projectChatBytes(chatBytes, record.id, current.chat);
  await commitChange(context, { id: randomUUID(), entries: [entry(context, current.relative, current.bytes, bytes), entry(context, current.chatRelative, current.chatBytes, chatBytes)],
    events: changed(group, chat), response: { status: 200, body: returnChat ? chat : group } });
  return returnChat ? chat : group;
}

async function loadGroup(context, id, includeDeleted = false) {
  if (!isUuid(id)) throw new CoreError(404, 'group_not_found', 'The group does not exist.');
  const relative = `user/gui/groups/${id}.json`;
  const bytes = await readBytes(context.store, absolute(context, relative));
  if (!bytes) throw new CoreError(404, 'group_not_found', 'The group does not exist.');
  const group = projectGroup(bytes, id);
  if (group.deleted && !includeDeleted) throw new CoreError(404, 'group_not_found', 'The group does not exist.');
  const record = JSON.parse(bytes);
  const chatRelative = `user/relay/chats/${id}/chat.md`;
  const chatBytes = await readBytes(context.store, absolute(context, chatRelative));
  if (!chatBytes || revisionOf(chatBytes) !== record.chatRevision) throw new CoreError(409, 'chat_changed', 'The linked chat changed since the group was saved.');
  return { relative, bytes, record, chatRelative, chatBytes, chat: await projectChat(context, id) };
}

export function groupTitle(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) || !value.trim() || value.trim().length > 240) throw new CoreError(422, 'invalid_title', 'A group title must be one nonblank line of at most 240 characters.');
  return value.trim();
}

export async function groupMembers(context, values, allowEmpty = false) {
  if (!Array.isArray(values) || values.length < (allowEmpty ? 0 : 1) || values.length > 255) throw new CoreError(422, 'invalid_members', 'A group needs from 1 to 255 distinct non-master units.');
  const members = [];
  for (const value of values) {
    let id;
    try { id = parseUnitId(value).id; } catch { throw new CoreError(422, 'invalid_members', 'A group member is not a canonical unit.'); }
    const state = id === 'root:master' ? null : await readUnitState(context, parseUnitId(id));
    if (!state || stateHeader(state.bytes, 'removed') === 'true' || stateHeader(state.bytes, 'role') === 'master' || members.includes(id)) throw new CoreError(422, 'invalid_members', 'Group members must be distinct existing non-master units.');
    members.push(id);
  }
  return members.sort();
}

function desktop(context) {
  if (context.principal?.audience !== 'desktop') throw new CoreError(403, 'forbidden', 'Only the desktop can manage personal groups.');
}

function changed(group, chat) {
  return [{ name: 'cluster.changed', chatId: group.chatId, data: { cluster: group } }, { name: 'group.changed', chatId: group.chatId, data: { group } }, { name: 'chat.changed', chatId: chat.id, data: { chat } },
    { name: 'view.changed', data: { revision: group.revision, collections: ['clusters', 'groups', 'chats'] } }];
}

function entry(context, relative, beforeBytes, afterBytes) {
  return { resource: relative, recordPath: absolute(context, relative), beforeRevision: revisionOf(beforeBytes), beforeBytes, afterBytes };
}

function groupBytes(record) { return Buffer.from(`${canonicalJson(record)}\n`); }
function absolute(context, relative) { return path.join(context.paths.mind, ...relative.split('/')); }
