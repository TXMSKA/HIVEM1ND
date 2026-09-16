import { access, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './records.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'user']);
const HOME_SKIP_DIRECTORIES = new Set(['AppData', 'Library']);

export async function loadAdapters({ kitPath } = {}) {
  const bundled = path.join(MODULE_DIR, 'adapters');
  const requested = kitPath ? path.join(path.resolve(kitPath), 'engine', 'adapters') : bundled;
  const directory = await isDirectory(requested) ? requested : bundled;
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const adapters = [];
  for (const name of names) {
    const descriptor = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    validateAdapter(descriptor, name);
    adapters.push(descriptor);
  }
  return adapters;
}

export async function discoverAgents({ homeDir, env = process.env, kitPath, adapters } = {}) {
  if (!homeDir) throw new Error('homeDir is required for agent discovery');
  const known = adapters ?? await loadAdapters({ kitPath });
  const found = [];
  for (const adapter of known) {
    const detectedBy = [];
    for (const homePath of adapter.detect.homePaths ?? []) {
      const candidate = path.resolve(homeDir, homePath);
      if (await pathExists(candidate)) detectedBy.push(candidate);
    }
    for (const envPath of adapter.detect.envPaths ?? []) {
      const base = envValue(env, envPath.variable);
      if (!base) continue;
      const candidate = path.resolve(base, envPath.path ?? '.');
      if (await pathExists(candidate)) detectedBy.push(candidate);
    }
    for (const binary of adapter.detect.binaries ?? []) {
      const executable = await findBinary(binary, env);
      if (executable) detectedBy.push(executable);
    }
    if (detectedBy.length > 0) {
      found.push({ id: adapter.id, name: adapter.displayName, detectedBy: [...new Set(detectedBy)] });
    }
  }
  return found;
}

export function resolveAdapterPaths(adapter, { homeDir, env = process.env } = {}) {
  if (!homeDir) throw new Error('homeDir is required to resolve adapter paths');
  const skillEnv = adapter.skills.envPath;
  const skillEnvBase = skillEnv ? envValue(env, skillEnv.variable) : '';
  const skillsBase = path.resolve(skillEnvBase || homeDir);
  const skillsRoot = skillEnvBase
    ? path.resolve(skillEnvBase, skillEnv.path ?? '.')
    : path.resolve(homeDir, adapter.skills.homePath);

  let rulesPath = null;
  let rulesBase = null;
  if (adapter.rules) {
    const ruleEnv = adapter.rules.envPath;
    const ruleEnvBase = ruleEnv ? envValue(env, ruleEnv.variable) : '';
    rulesBase = path.resolve(ruleEnvBase || homeDir);
    rulesPath = ruleEnvBase
      ? path.resolve(ruleEnvBase, ruleEnv.path ?? '.')
      : path.resolve(homeDir, adapter.rules.homePath);
  }
  return { skillsRoot, skillsBase, rulesPath, rulesBase };
}

export async function discoverProjects(projectRoots, { maxDepth = 4, skip = () => false } = {}) {
  if (!Array.isArray(projectRoots)) throw new Error('projectRoots must be an array');
  const projects = [];
  const seen = new Set();
  for (const rootValue of projectRoots) {
    const root = path.resolve(String(rootValue));
    if (!await isDirectory(root)) throw new Error(`Project folder does not exist: ${root}`);
    await visit(root, 0);
  }
  return projects.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(directory, depth) {
    const key = normalizePath(directory);
    if (seen.has(key)) return;
    seen.add(key);
    const state = await lstatTolerant(directory);
    if (!state || state.isSymbolicLink() || !state.isDirectory()) return;

    if (await pathExists(path.join(directory, '.git'))) {
      projects.push({
        name: path.basename(directory),
        path: directory,
        environment: await guessEnvironment(directory),
      });
      return;
    }
    if (depth >= maxDepth) return;

    const entries = await readdirTolerant(directory);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name) || skip(entry.name)) continue;
      await visit(path.join(directory, entry.name), depth + 1);
    }
  }
}

export async function discoverHomeProjects(homeDir, { maxDepth = 4 } = {}) {
  return discoverProjects([homeDir], {
    maxDepth,
    skip: (name) => name.startsWith('.') || HOME_SKIP_DIRECTORIES.has(name),
  });
}

export async function guessEnvironment(repositoryPath) {
  if (await isDirectory(path.join(repositoryPath, 'ProjectSettings'))) return 'unity';
  if (await hasFileWithExtension(repositoryPath, '.uproject')) return 'unreal';
  if (await pathExists(path.join(repositoryPath, 'project.godot'))) return 'godot';
  if (await pathExists(path.join(repositoryPath, 'package.json'))) return 'web';
  if (await hasFileWithExtension(repositoryPath, '.csproj', '.sln')
    || await pathExists(path.join(repositoryPath, 'Cargo.toml'))
    || await pathExists(path.join(repositoryPath, 'go.mod'))) return 'apps';
  return '';
}

async function hasFileWithExtension(directory, ...extensions) {
  const entries = await readdirTolerant(directory);
  return entries.some((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)));
}

export async function discoverContent(kitPath) {
  const featuresDirectory = path.join(kitPath, 'features');
  const featureNames = await discoverNamedEntries(featuresDirectory);
  const features = await Promise.all(featureNames.map(async (name) => ({
    id: `feature:${name}`,
    name,
    type: 'feature',
    category: await readFeatureCategory(featuresDirectory, name),
  })));
  const knowledge = await discoverNamedEntries(path.join(kitPath, 'knowledge'));
  return [
    ...features,
    ...knowledge.map((name) => ({ id: `knowledge:${name}`, name, type: 'knowledge' })),
  ];
}

async function readFeatureCategory(featuresDirectory, name) {
  const content = await readFileIfPresent(path.join(featuresDirectory, `${name}.md`));
  return content === null ? undefined : parseFrontmatter(content).attributes.category;
}

export async function discoverOtherMinds(selectedMindPath, { kitPath } = {}) {
  const selected = path.resolve(selectedMindPath);
  const parent = path.dirname(selected);
  if (!await isDirectory(parent)) return [];
  const minds = [];
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(parent, entry.name);
    if (normalizePath(candidate) === normalizePath(selected)) continue;
    if (isFixturePath(candidate, kitPath)) continue;
    if (await isMind(candidate)) minds.push(candidate);
  }
  return minds.sort((left, right) => left.localeCompare(right));
}

export async function discoverPreferenceFiles(agentIds, { adapters, homeDir, env = process.env } = {}) {
  const selected = new Set(agentIds);
  const paths = [];
  for (const adapter of adapters) {
    if (!selected.has(adapter.id) || !adapter.rules) continue;
    const { rulesPath } = resolveAdapterPaths(adapter, { homeDir, env });
    if (adapter.rules.mode === 'cursor') {
      const directory = path.dirname(rulesPath);
      if (!await isDirectory(directory)) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.mdc')) paths.push(path.join(directory, entry.name));
      }
    } else if (await isNonemptyFile(rulesPath)) {
      paths.push(rulesPath);
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

export async function findBinary(binary, env = process.env) {
  const pathValue = envValue(env, 'PATH');
  if (!pathValue) return null;
  const extensions = process.platform === 'win32'
    ? (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  const hasExtension = path.extname(binary) !== '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of hasExtension ? [''] : extensions) {
      const candidate = path.resolve(directory.replace(/^"|"$/g, ''), `${binary}${extension.toLowerCase()}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        if (process.platform === 'win32' && extension) {
          const upperCandidate = path.resolve(directory.replace(/^"|"$/g, ''), `${binary}${extension.toUpperCase()}`);
          try {
            await access(upperCandidate);
            return upperCandidate;
          } catch {
            // Continue with the next extension.
          }
        }
      }
    }
  }
  return null;
}

async function discoverNamedEntries(directory) {
  if (!await isDirectory(directory)) return [];
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === 'readme.md' || entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.endsWith('.md')) names.push(path.basename(entry.name, '.md'));
    if (entry.isDirectory()) names.push(entry.name);
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

async function isMind(candidate) {
  return await pathExists(path.join(candidate, 'rules.md'))
    && await pathExists(path.join(candidate, 'files.md'))
    && await isDirectory(path.join(candidate, 'user'));
}

function isFixturePath(candidate, kitPath) {
  if (!kitPath) return false;
  const fixtureRoot = path.join(path.resolve(kitPath), 'fixtures');
  const relative = path.relative(fixtureRoot, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isNonemptyFile(filePath) {
  try {
    const state = await lstat(filePath);
    return state.isFile() && state.size > 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isDirectory(directory) {
  try {
    return (await lstat(directory)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readFileIfPresent(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function lstatTolerant(directory) {
  try {
    return await lstat(directory);
  } catch (error) {
    if (isPermissionError(error) || error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readdirTolerant(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isPermissionError(error) || error?.code === 'ENOENT') return [];
    throw error;
  }
}

function isPermissionError(error) {
  return error?.code === 'EACCES' || error?.code === 'EPERM';
}

export function envValue(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validateAdapter(adapter, fileName) {
  if (!adapter || typeof adapter !== 'object') throw new Error(`Invalid adapter: ${fileName}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adapter.id ?? '')) throw new Error(`Invalid adapter id in ${fileName}`);
  if (!adapter.displayName || !adapter.detect || !adapter.skills) throw new Error(`Incomplete adapter: ${fileName}`);
  if (adapter.skills.layout !== 'folder' || adapter.skills.fileName !== 'SKILL.md') {
    throw new Error(`Unsupported adapter skill layout: ${fileName}`);
  }
}
