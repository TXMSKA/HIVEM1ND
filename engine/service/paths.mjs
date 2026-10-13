import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, validateMachineName } from './identity.mjs';

const ONE_DRIVE_ENV = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];
export const COSMIC_ROOT_NAME = 'Cosmic';
export const MIND_DIRECTORY_NAME = '.m1nd';

function library(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function absolute(lib, value) {
  return typeof value === 'string' && value !== '' && lib.isAbsolute(value);
}

export function localCosmic({ platform, env = {}, home } = {}) {
  const lib = library(platform);
  if (platform === 'win32') {
    if (!absolute(lib, env.LOCALAPPDATA)) throw new CoreError(422, 'invalid_path', 'LOCALAPPDATA must be an absolute path.');
    return lib.resolve(lib.join(env.LOCALAPPDATA, COSMIC_ROOT_NAME));
  }
  if (platform === 'darwin') {
    if (!absolute(lib, home)) throw new CoreError(422, 'invalid_path', 'The home directory must be absolute.');
    return lib.resolve(lib.join(home, 'Library', 'Application Support', COSMIC_ROOT_NAME));
  }
  if (!absolute(lib, home)) throw new CoreError(422, 'invalid_path', 'The home directory must be absolute.');
  return lib.resolve(lib.join(home, '.local', 'share', COSMIC_ROOT_NAME));
}

export function defaultMind({ platform, env = {}, home } = {}) {
  const lib = library(platform);
  const localEnv = { ...env };
  if (platform === 'win32' && !localEnv.LOCALAPPDATA) {
    if (!absolute(lib, home)) throw new CoreError(422, 'invalid_path', 'The home directory must be absolute.');
    localEnv.LOCALAPPDATA = lib.join(home, 'AppData', 'Local');
  }
  return lib.join(localCosmic({ platform, env: localEnv, home }), MIND_DIRECTORY_NAME);
}

export function oneDriveRoots({ platform = 'win32', env = {} } = {}) {
  const lib = library(platform);
  const roots = [];
  for (const key of ONE_DRIVE_ENV) {
    if (absolute(lib, env[key])) roots.push(lib.resolve(env[key]));
  }
  return roots;
}

export function mindKeyFor(mindPath, platform) {
  const lib = library(platform);
  const resolved = lib.resolve(mindPath);
  const hashed = platform === 'win32' ? resolved.toLowerCase() : resolved;
  return createHash('sha256').update(hashed).digest('hex').slice(0, 16);
}

export function servicePaths({ platform, env = {}, home, mindPath, machine, originPath = null, cosmicPath = null } = {}) {
  const lib = library(platform);
  const machineName = validateMachineName(machine);
  const cosmic = cosmicPath ? lib.resolve(cosmicPath) : localCosmic({ platform, env, home });
  const mind = lib.resolve(mindPath ?? defaultMind({ platform, env, home }));
  const mindKey = mindKeyFor(mind, platform);
  const serviceRoot = lib.join(cosmic, 'hivem1nd-service');
  const localDirectory = lib.join(serviceRoot, mindKey, machineName);
  const staging = lib.join(localDirectory, 'staging');
  const origin = originPath ? lib.resolve(originPath) : null;
  return {
    platform,
    cosmic,
    mind,
    mindKey,
    machine: machineName,
    serviceRoot,
    localDirectory,
    staging,
    origin,
    lockFile: lib.join(serviceRoot, 'service.lock'),
    activeFile: lib.join(serviceRoot, 'active.json'),
    configFile: lib.join(localDirectory, 'config.json'),
    receipts: lib.join(localDirectory, 'receipts'),
    transactions: lib.join(localDirectory, 'transactions'),
  };
}

export function safeRelative(input) {
  if (typeof input !== 'string' || input === '' || input.includes('\\') || input.includes('\0') || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    throw new CoreError(422, 'invalid_path', 'The path must be a relative path.');
  }
  const parts = input.split('/');
  const kept = [];
  for (const part of parts) {
    if (part === '' || part === '..') throw new CoreError(422, 'invalid_path', 'The path must stay inside its root.');
    if (part === '.') continue;
    if (part.length > 255 || /[\u0000-\u001f\u007f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part) || part.endsWith('.') || part.endsWith(' ')) {
      throw new CoreError(422, 'invalid_path', 'The path must stay inside its root.');
    }
    kept.push(part);
  }
  if (kept.length === 0) throw new CoreError(422, 'invalid_path', 'The path must name a file.');
  return kept.join('/');
}

function inside(parent, child, lib) {
  const relative = lib.relative(lib.resolve(parent), lib.resolve(child));
  return relative === '' || (!relative.startsWith(`..${lib.sep}`) && relative !== '..' && !lib.isAbsolute(relative));
}

export async function resolveExisting(target, lib = path) {
  const resolved = lib.resolve(target);
  const missing = [];
  let current = resolved;
  while (true) {
    try {
      const real = await realpath(current);
      return missing.length ? lib.join(real, ...missing.reverse()) : real;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = lib.dirname(current);
      if (parent === current) return resolved;
      missing.push(lib.basename(current));
      current = parent;
    }
  }
}

export async function assertNoLinks(target, { root = null, lib = path } = {}) {
  const resolved = lib.resolve(target);
  if (root && !inside(lib.resolve(root), resolved, lib)) {
    throw new CoreError(422, 'invalid_path', 'The path must stay inside its root.');
  }
  const stop = lib.parse(resolved).root;
  const chain = [];
  let current = resolved;
  while (true) {
    chain.push(current);
    if (lib.resolve(current) === lib.resolve(stop) || current === lib.dirname(current)) break;
    current = lib.dirname(current);
  }
  for (const item of chain.reverse()) {
    let stats;
    try {
      stats = await lstat(item);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to follow a link.');
  }
  return resolved;
}

export async function assertLocalStaging(staging, { platform = process.platform, origin = null, syncedRoots = [], oneDrive = [], env = null, lib = path } = {}) {
  const pathLib = lib === path ? library(platform) : lib;
  const resolvedStaging = await resolveExisting(staging, pathLib);
  const forbidden = [];
  if (origin) forbidden.push(await resolveExisting(origin, pathLib));
  for (const root of syncedRoots) forbidden.push(await resolveExisting(root, pathLib));
  const detected = oneDrive.length ? oneDrive : (env ? oneDriveRoots({ platform, env }) : []);
  for (const root of detected) forbidden.push(await resolveExisting(root, pathLib));
  for (const root of forbidden) {
    if (inside(root, resolvedStaging, pathLib) || inside(root, pathLib.resolve(staging), pathLib)) {
      throw new CoreError(422, 'unsafe_staging', 'Staging must stay outside the origin and every synced root.');
    }
  }
  await assertNoLinks(staging, { lib: pathLib });
  return resolvedStaging;
}

export async function resolveTarget(paths, target, { projects = [] } = {}) {
  if (!target || typeof target !== 'object') throw new CoreError(422, 'invalid_path', 'The target is not valid.');
  if (target.kind === 'mind') {
    const relative = safeRelative(target.path);
    const absolute = path.resolve(paths.mind, ...relative.split('/'));
    if (!inside(paths.mind, absolute, path)) throw new CoreError(422, 'invalid_path', 'The path must stay inside its root.');
    await assertNoLinks(absolute, { root: paths.mind });
    return { kind: 'mind', relative, absolute };
  }
  if (target.kind === 'project') {
    if (typeof target.path !== 'string' || path.win32.isAbsolute(target.path) || path.posix.isAbsolute(target.path)) {
      throw new CoreError(422, 'invalid_path', 'A repository target cannot be an absolute path.');
    }
    const relative = safeRelative(target.path);
    const project = projects.find((item) => item.name === target.project);
    if (!project?.localPath || project.eligible === false) {
      throw new CoreError(409, 'project_unavailable', 'The project is not registered on this machine.');
    }
    const absolute = path.resolve(project.localPath, ...relative.split('/'));
    if (!inside(project.localPath, absolute, path)) throw new CoreError(422, 'invalid_path', 'The path must stay inside its root.');
    await assertNoLinks(absolute, { root: project.localPath });
    return { kind: 'project', project: project.name, relative, absolute };
  }
  throw new CoreError(422, 'invalid_path', 'The target is not valid.');
}
