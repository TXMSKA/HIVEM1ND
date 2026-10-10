import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from '../engine/service/identity.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { createStore } from '../engine/service/store.mjs';

function assertDescendant(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the fixture root: ${target}`);
  }
}

export async function makeCoreFixture(options = {}) {
  const created = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-core-'));
  const root = await realpath(created);
  const platform = options.platform ?? 'win32';
  const home = path.join(root, 'home');
  const localAppData = path.join(root, 'localappdata');
  const env = {
    LOCALAPPDATA: localAppData,
    USERPROFILE: home,
    HOME: home,
    XDG_DATA_HOME: path.join(root, 'xdg'),
    ...(options.env ?? {}),
  };
  await mkdir(home, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  const paths = servicePaths({
    platform,
    env,
    home,
    machine: options.machine ?? 'DESKTOP',
    mindPath: options.mindPath,
    originPath: options.originPath ?? null,
  });
  assertDescendant(root, paths.mind);
  assertDescendant(root, paths.localDirectory);
  await mkdir(path.join(paths.mind, 'user'), { recursive: true });
  await mkdir(paths.localDirectory, { recursive: true });
  const events = [];
  const clock = { now: options.now ?? Date.parse('2026-10-10T12:00:00.000Z') };
  const store = createStore({
    root,
    confineRoot: root,
    mindPath: paths.mind,
    localDirectory: paths.localDirectory,
    now: () => clock.now,
    events,
    autoRecover: options.autoRecover ?? true,
  });
  store.aclRunner = options.aclRunner ?? stubAclRunner();
  return {
    root,
    platform,
    env,
    home,
    clock,
    machine: paths.machine,
    paths,
    store,
    events,
    children: [],
    native: { available: {}, ...(options.native ?? {}) },
    dispatch: null,
  };
}

export function advanceClock(fixture, milliseconds) {
  fixture.clock.now += milliseconds;
  return new Date(fixture.clock.now).toISOString();
}

export function readEvents(fixture) {
  return fixture.events.map((event) => structuredClone(event));
}

export async function request(fixture, spec) {
  if (typeof fixture.dispatch !== 'function') throw new CoreError(503, 'service_unavailable', 'The HTTP listener is not running.');
  return fixture.dispatch(spec);
}

export function spawnOwned(fixture, command, args = [], options = {}) {
  const child = spawn(command, args, { shell: false, windowsHide: true, ...options });
  fixture.children.push(child);
  return child;
}

export function assertContained(fixture) {
  for (const written of fixture.store.writes) assertDescendant(fixture.root, written);
}

export async function dispose(fixture) {
  for (const child of fixture.children) {
    if (child.exitCode === null && !child.killed) {
      try { child.kill(); } catch { /* The handle is already gone. */ }
    }
  }
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 5 });
}
