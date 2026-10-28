import { lstat, readFile, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAdapters, resolveAdapterPaths } from './discovery.mjs';
import { OWNED_RULE_MODES, autoRuleLine } from './install.mjs';
import { atomicWriteFile, hashContent, machineManagedPath, machineReportPath, readMachineRecord } from './records.mjs';
import { removeOwnedRegistration } from './service/install.mjs';
import { defaultMind, mindKeyFor } from './service/paths.mjs';

const MANAGED_FILE_MODIFIED_REASON = 'The ONEM1ND-managed file was modified after installation.';
const SYMLINK_REASON = 'The path is a symbolic link and is not managed by ONEM1ND.';
// Setup keeps its checkpoint, proof and draft for one M1ND in this machine's local service folder.
const SETUP_STATE_FILES = ['setup.json', 'setup-proof.json', 'setup-draft.json'];
// A migrated copy records the 2.x M1ND it came from; that M1ND is never written, so nothing inside it is removed.
const LEGACY_CLOSURE = path.join('.migration', 'legacy-closure.json');

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
    return { action: 'uninstall', removed, kept, relay: [], warnings };
  }

  let serviceLocationKnown = true;
  try {
    const registration = await removeOwnedRegistration({
      mindPath, hostname, env, homeDir, cosmicPath: options.cosmicPath, platform: options.platform,
      dryRun, run: options.registrationRunner ?? options.serviceRunner ?? null,
      query: options.registrationQuery ?? options.serviceQuery,
      uid: options.uid,
    });
    if (registration.kept) kept.push(registration.kept);
    removed.push(...(registration.removedPaths ?? (registration.removedPath ? [registration.removedPath] : [])));
  } catch (error) {
    if (error?.code !== 'invalid_path') throw error;
    serviceLocationKnown = false;
  }
  if (!dryRun && serviceLocationKnown) {
    const stop = options.stopService ?? (await import('./service/service.mjs')).stopConfiguredService;
    await stop({ ...options, mindPath, hostname, env, homeDir });
  }
  // A checkpoint left behind would reopen a later setup of this M1ND at Ready with nothing installed.
  const setupState = await removeSetupState({ mindPath, hostname, env, homeDir, cosmicPath: options.cosmicPath, dryRun });
  removed.push(...setupState.removed);
  kept.push(...setupState.kept);

  const managedFiles = record.managedFiles ?? {};
  const cleanupDirectories = new Set();
  const startMenuRoots = new Set();
  const legacySource = await migrationSource(mindPath);
  let legacyKept = 0;

  for (const [filePath, expectedHash] of Object.entries(managedFiles)) {
    const resolved = path.resolve(filePath);
    if (isWithin(mindPath, resolved) || normalizePath(resolved) === normalizePath(machinePath)) continue;
    if (legacySource && isWithin(legacySource, resolved)) {
      legacyKept += 1;
      continue;
    }
    const folder = path.dirname(resolved), parent = path.dirname(folder);
    const startMenuShortcut = path.basename(resolved).toLowerCase() === 'onem1nd.lnk' && path.basename(folder).toLowerCase() === 'cosmic'
      && path.basename(parent).toLowerCase() === 'programs';
    if (startMenuShortcut) startMenuRoots.add(normalizePath(parent));
    const outcome = await planFileRemoval(resolved, expectedHash);
    if (outcome === 'missing') {
      if (startMenuShortcut) cleanupDirectories.add(folder);
      continue;
    }
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
  const bases = new Set([normalizePath(homeDir), ...startMenuRoots]);
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

  if (legacyKept > 0) warnings.push(`${legacyKept} files inside the previous M1ND at ${legacySource} were left untouched.`);
  const relay = await removeRelayEntries({ homeDir, env, mindPath, dryRun });
  if (!dryRun) await removeEmptyDirectories(cleanupDirectories, bases, startMenuRoots);

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
    // The managed map belongs to this machine as well and goes with its record.
    const managedPath = machineManagedPath(mindPath, hostname);
    if (await lstatIfPresent(managedPath)) {
      if (!dryRun) await removeFile(managedPath);
      removed.push(managedPath);
    }
    if (eligibility) kept.push({ path: mindPath, reason: eligibility.reason });
  }

  return { action: 'uninstall', dryRun, removed, updated, kept, relay, warnings };
}

async function migrationSource(mindPath) {
  const bytes = await readFile(path.join(mindPath, LEGACY_CLOSURE), 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (bytes === null) return null;
  const sourcePath = JSON.parse(bytes)?.sourcePath;
  return typeof sourcePath === 'string' && path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : null;
}

// The folder is the one setup writes: an explicit Cosmic root, or the parent of the default M1ND.
async function removeSetupState({ mindPath, hostname, env, homeDir, cosmicPath, dryRun }) {
  const result = { removed: [], kept: [] };
  let cosmic;
  try {
    cosmic = cosmicPath ? path.resolve(cosmicPath) : path.dirname(defaultMind({ platform: process.platform, env, home: homeDir }));
  } catch (error) {
    if (error?.code === 'invalid_path') return result;
    throw error;
  }
  const directory = path.join(cosmic, 'onem1nd-service', mindKeyFor(mindPath, process.platform), hostname);
  for (const name of SETUP_STATE_FILES) {
    const file = path.join(directory, name);
    if (await findSymlinkAncestor(file)) {
      if (await lstatIfPresent(file)) result.kept.push({ path: file, reason: SYMLINK_REASON });
      continue;
    }
    const state = await lstatIfPresent(file);
    if (!state?.isFile()) continue;
    if (!dryRun) await removeFile(file);
    result.removed.push(file);
  }
  return result;
}

// A stable kit or legacy mind copy is owned only when its explicit mind argument matches this mind.
async function removeRelayEntries({ homeDir, env, mindPath, dryRun }) {
  const { RELAY_CLIENTS, relayEntryPointsAt, relayEntryPresent, unconfigureRelayClient } = await import('./relay/config.mjs');
  const results = [];
  for (const client of RELAY_CLIENTS) {
    try {
      if (await relayEntryPointsAt({ client, homeDir, env, mindPath })) {
        if (!dryRun) await unconfigureRelayClient({ client, homeDir, env, mindPath });
        results.push({ client, status: 'removed' });
      } else {
        results.push({ client, status: await relayEntryPresent({ client, homeDir, env }) ? 'elsewhere' : 'none' });
      }
    } catch (error) {
      results.push({ client, status: 'failed', reason: error.message });
    }
  }
  return results;
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

async function removeEmptyDirectories(directories, bases, stopAt) {
  // Deepest first, so a folder is looked at after the folders inside it are gone.
  const queue = [...directories].sort((left, right) => path.resolve(right).length - path.resolve(left).length);
  const processed = new Set();
  while (queue.length > 0) {
    const directory = path.resolve(queue.shift());
    const key = normalizePath(directory);
    if (processed.has(key)) continue;
    processed.add(key);
    if (stopAt.has(key)) continue;
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
  const ownManagedPath = path.join(machinesDir, `${hostname}.managed.json`);
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
      if (normalizePath(entryPath) === normalizePath(ownManagedPath)) continue;
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
