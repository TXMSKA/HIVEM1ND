import { lstat, readFile, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAdapters, resolveAdapterPaths } from './discovery.mjs';
import { OWNED_RULE_MODES, autoRuleLine } from './install.mjs';
import { atomicWriteFile, hashContent, machineReportPath, readMachineRecord } from './records.mjs';

const MANAGED_FILE_MODIFIED_REASON = 'The HIVEM1ND-managed file was modified after installation.';
const SYMLINK_REASON = 'The path is a symbolic link and is not managed by HIVEM1ND.';

export async function uninstall(options = {}) {
  const mindPath = path.resolve(requireValue(options.mindPath, 'mindPath'));
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const hostname = String(options.hostname ?? os.hostname()).trim();
  if (!hostname) throw new Error('hostname is required');
  const env = options.env ?? process.env;
  const dryRun = options.dryRun === true;
  const removeMindRequested = options.removeMind === true;

  const removed = [];
  const updated = [];
  const kept = [];
  const warnings = [];

  const { filePath: machinePath, record } = await readMachineRecord(mindPath, hostname);
  if (!record) {
    warnings.push(`No machine record exists for ${hostname} at ${mindPath}.`);
    return { action: 'uninstall', removed, kept, warnings };
  }

  const managedFiles = record.managedFiles ?? {};
  const cleanupDirectories = new Set();

  for (const [filePath, expectedHash] of Object.entries(managedFiles)) {
    const resolved = path.resolve(filePath);
    if (isWithin(mindPath, resolved) || normalizePath(resolved) === normalizePath(machinePath)) continue;
    const outcome = await planFileRemoval(resolved, expectedHash);
    if (outcome === 'missing') continue;
    if (outcome === 'symlink') {
      kept.push({ path: resolved, reason: SYMLINK_REASON });
      continue;
    }
    if (outcome === 'modified') {
      kept.push({ path: resolved, reason: MANAGED_FILE_MODIFIED_REASON });
      continue;
    }
    if (!dryRun) await removeFile(resolved);
    removed.push(resolved);
    cleanupDirectories.add(path.dirname(resolved));
  }

  const adapters = await loadAdapters({});
  const adaptersById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const bases = new Set([normalizePath(homeDir)]);
  for (const agent of record.agents ?? []) {
    const adapter = adaptersById.get(agent.name);
    if (!adapter) continue;
    const resolvedPaths = resolveAdapterPaths(adapter, { homeDir, env });
    bases.add(normalizePath(resolvedPaths.skillsBase));
    if (resolvedPaths.rulesBase) bases.add(normalizePath(resolvedPaths.rulesBase));
  }

  const ruleLine = autoRuleLine(mindPath);
  for (const agent of record.agents ?? []) {
    if (agent.mode !== 'auto') continue;
    const adapter = adaptersById.get(agent.name);
    if (!adapter?.rules || OWNED_RULE_MODES.has(adapter.rules.mode)) continue;
    const { rulesPath, rulesBase } = resolveAdapterPaths(adapter, { homeDir, env });
    const outcome = await removeRuleLine(rulesPath, rulesBase, ruleLine, dryRun);
    if (outcome === 'symlink') kept.push({ path: rulesPath, reason: SYMLINK_REASON });
    else if (outcome === 'removed') updated.push(rulesPath);
  }

  if (!dryRun) await removeEmptyDirectories(cleanupDirectories, bases);

  const eligibility = removeMindRequested ? await checkMindRemovable(mindPath, hostname, record) : null;
  if (eligibility?.removable) {
    if (!dryRun) await removeMindFolder(mindPath);
    removed.push(mindPath);
  } else {
    if (!dryRun) await removeFile(machinePath);
    removed.push(machinePath);
    // The install report belongs to this machine and goes with its record.
    const reportPath = machineReportPath(mindPath, hostname);
    if (await lstatIfPresent(reportPath)) {
      if (!dryRun) await removeFile(reportPath);
      removed.push(reportPath);
    }
    if (eligibility) kept.push({ path: mindPath, reason: eligibility.reason });
  }

  return { action: 'uninstall', removed, updated, kept, warnings };
}

async function planFileRemoval(filePath, expectedHash) {
  if (await findSymlinkAncestor(filePath)) return 'symlink';
  const state = await lstatIfPresent(filePath);
  if (!state) return 'missing';
  if (state.isSymbolicLink() || !state.isFile()) return 'symlink';
  const content = await readFile(filePath);
  return hashContent(content) === expectedHash ? 'clean' : 'modified';
}

async function removeRuleLine(rulesPath, rulesBase, line, dryRun) {
  if (await findSymlinkAncestor(rulesPath)) return 'symlink';
  const state = await lstatIfPresent(rulesPath);
  if (!state) return 'missing';
  if (state.isSymbolicLink() || !state.isFile()) return 'symlink';
  const content = await readFile(rulesPath, 'utf8');
  const withoutLine = removeExactLine(content, line);
  if (withoutLine === content) return 'absent';
  if (!dryRun) await atomicWriteFile(rulesPath, withoutLine, { root: rulesBase });
  return 'removed';
}

function removeExactLine(content, line) {
  let output = '';
  for (const match of content.matchAll(/([^\r\n]*)(\r\n|\n|$)/g)) {
    if (match[0] === '') break;
    if (match[1] !== line) output += match[0];
  }
  return output;
}

async function removeEmptyDirectories(directories, bases) {
  const queue = [...directories];
  const processed = new Set();
  while (queue.length > 0) {
    const directory = path.resolve(queue.shift());
    const key = normalizePath(directory);
    if (processed.has(key)) continue;
    processed.add(key);
    const withinBase = [...bases].some((base) => key !== base && isWithin(base, directory));
    if (!withinBase) continue;
    const state = await lstatIfPresent(directory);
    if (!state || state.isSymbolicLink() || !state.isDirectory()) continue;
    const entries = await readdir(directory).catch(() => null);
    if (!entries || entries.length > 0) continue;
    await rmdir(directory).catch((error) => {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    });
    queue.push(path.dirname(directory));
  }
}

async function checkMindRemovable(mindPath, hostname, record) {
  const machinesDir = path.join(mindPath, 'user', 'machines');
  const machineEntries = await readdir(machinesDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const ownRecordName = normalizePath(`${hostname}.md`);
  const otherMachines = machineEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !entry.name.toLowerCase().endsWith('.report.md'))
    .map((entry) => entry.name)
    .filter((name) => normalizePath(name) !== ownRecordName);
  if (otherMachines.length > 0) {
    return { removable: false, reason: `Other machine records exist: ${otherMachines.sort().join(', ')}.` };
  }

  const managedByNormalizedPath = new Map(Object.entries(record.managedFiles ?? {}).map(([entryPath, hash]) => [normalizePath(entryPath), hash]));
  const ownRecordPath = path.join(machinesDir, `${hostname}.md`);
  const ownReportPath = path.join(machinesDir, `${hostname}.report.md`);
  const migrationsPath = path.join(mindPath, 'user', 'MIGRATIONS');
  const extras = [];
  await walk(mindPath);
  if (extras.length > 0) {
    const shown = extras.slice(0, 5).join(', ');
    return { removable: false, reason: `User data exists beyond what the installer created: ${shown}${extras.length > 5 ? ', ...' : ''}.` };
  }
  return { removable: true };

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        extras.push(entryPath);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (normalizePath(entryPath) === normalizePath(ownRecordPath)) continue;
      if (normalizePath(entryPath) === normalizePath(ownReportPath)) continue;
      if (normalizePath(entryPath) === normalizePath(migrationsPath)) continue;
      const managedHash = managedByNormalizedPath.get(normalizePath(entryPath));
      if (managedHash === undefined) {
        extras.push(entryPath);
        continue;
      }
      const actualHash = hashContent(await readFile(entryPath));
      if (actualHash !== managedHash) extras.push(entryPath);
    }
  }
}

async function removeMindFolder(mindPath) {
  const state = await lstat(mindPath);
  if (state.isSymbolicLink()) throw new Error(`Refusing to remove a symbolic mind path: ${mindPath}`);
  await rm(mindPath, { recursive: true });
}

async function removeFile(filePath) {
  await unlink(filePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

async function findSymlinkAncestor(filePath) {
  let current = path.resolve(filePath);
  while (true) {
    const state = await lstatIfPresent(current);
    if (state?.isSymbolicLink()) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function lstatIfPresent(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizePath(value) {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : value;
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requireValue(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${label} is required`);
  return String(value);
}
