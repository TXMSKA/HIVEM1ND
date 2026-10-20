import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, parseUnitId, unitStatePath } from './identity.mjs';
import { readBytes } from './store.mjs';

// A sync service that cannot merge two edits keeps both, the second as name-MACHINE.md (OneDrive's form). Such a copy
// is not another agent: it is skipped when its base file sits beside it and the suffix names a machine of this M1ND.
export async function machineNames(mind) {
  const names = new Set();
  for (const entry of await readdir(path.join(mind, 'user', 'machines'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && entry.name.endsWith('.md')) names.add(entry.name.slice(0, -3).toLowerCase());
  }
  return names;
}

export function isMachineCopy(name, siblings, machines) {
  const match = /^(.+)-([^-]+)\.md$/.exec(name);
  return Boolean(match && machines.has(match[2].toLowerCase()) && siblings.has(`${match[1]}.md`));
}

export function stateHeader(bytes, name) {
  const text = bytes.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  for (const line of (end < 0 ? text : text.slice(0, end)).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0 && line.slice(0, colon).trim() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

// A custom role keeps its name and description in the state file; the description is one JSON string, so it stays on one line.
export function stateCustomRole(bytes) {
  if (stateHeader(bytes, 'role') !== 'custom') return null;
  const name = stateHeader(bytes, 'role-name');
  let description = null;
  try { description = JSON.parse(stateHeader(bytes, 'role-description') ?? ''); } catch { /* A malformed description is no role. */ }
  return name && typeof description === 'string' && description ? { name, description } : null;
}

// What an agent with a custom role reads in place of a role file.
export function customRoleText(custom) {
  return `# ${custom.name}\n\nA role the person wrote for this agent. It has no preset behaviour beyond what follows.\n\n${custom.description}\n`;
}

export function stateRunsIn(bytes) {
  const raw = stateHeader(bytes, 'runs-in');
  if (!raw) return null;
  let choice;
  try { choice = JSON.parse(raw); } catch { /* A malformed stored choice must never fall back. */ }
  if (!choice || Object.keys(choice).sort().join(',') !== 'client,effort,mode,model'
    || !['claude', 'codex', 'cursor', 'lyra'].includes(choice.client) || typeof choice.model !== 'string' || !choice.model
    || choice.client === 'lyra' && (choice.effort !== null || !['fast', 'normal', 'thinking'].includes(choice.mode))
    || choice.client !== 'lyra' && (typeof choice.effort !== 'string' || !choice.effort || choice.mode !== null)) {
    throw new CoreError(422, 'unsupported_launch_choice', 'The stored Runs in choice is invalid.');
  }
  return Object.freeze(choice);
}

export function stateUnitId(bytes, relative) {
  const explicit = stateHeader(bytes, 'unit-id');
  if (explicit) return parseUnitId(explicit).id;
  const name = String(stateHeader(bytes, 'unit') || path.basename(relative, '.md')).toLowerCase();
  const parts = relative.split('/');
  const id = parts[1] === 'projects' ? `project:${parts[2]}:${name}`
    : parts[1] === 'envs' ? `env:${parts[2]}:${name}` : `root:${name}`;
  return parseUnitId(id).id;
}

export async function readUnitState(context, parsed) {
  const relative = unitStatePath(parsed);
  const absolute = path.join(context.paths.mind, ...relative.split('/'));
  const bytes = await readBytes(context.store, absolute);
  if (bytes) {
    try { return stateUnitId(bytes, relative) === parsed.id ? { bytes, relative, absolute } : null; }
    catch { return null; }
  }
  const legacy = `user/state/${parsed.unit}.md`;
  if (legacy === relative) return null;
  const oldAbsolute = path.join(context.paths.mind, ...legacy.split('/'));
  const old = await readBytes(context.store, oldAbsolute);
  if (!old || stateHeader(old, 'unit-id') !== parsed.id) return null;
  return { bytes: old, relative: legacy, absolute: oldAbsolute };
}

export async function readUnitStates(context) {
  const directories = ['user/state'];
  for (const kind of ['envs', 'projects']) {
    const parent = path.join(context.paths.mind, 'user', kind);
    for (const entry of await entries(parent)) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) directories.push(`user/${kind}/${entry.name}/state`);
    }
  }
  const records = new Map();
  const machines = await machineNames(context.paths.mind);
  for (const directory of directories) {
    const listed = await entries(path.join(context.paths.mind, ...directory.split('/')));
    const siblings = new Set(listed.filter(entry => entry.isFile()).map(entry => entry.name));
    for (const entry of listed) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md') || entry.name.includes('.conflict-') || isMachineCopy(entry.name, siblings, machines)) continue;
      const relative = `${directory}/${entry.name}`;
      const absolute = path.join(context.paths.mind, ...relative.split('/'));
      const bytes = await readBytes(context.store, absolute);
      if (!bytes) continue;
      try {
        const id = stateUnitId(bytes, relative);
        if (records.has(id)) continue;
        const parsed = parseUnitId(id);
        // The file listed is the one the unit's own place names, so its bytes are the record: reading it again would return them.
        const current = parsed.id === id && unitStatePath(parsed) === relative ? { bytes, relative, absolute } : await readUnitState(context, parsed);
        if (current) records.set(id, { ...current, id });
      } catch (error) { if (error?.code !== 'invalid_unit' && error?.code !== 'invalid_name') throw error; }
    }
  }
  return [...records.values()];
}

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}
