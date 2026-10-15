import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSetupSession } from '../../engine/setup.mjs';
import { writeMachineRecord } from '../../engine/records.mjs';
import { stubAclRunner } from '../../engine/service/security.mjs';
import { createWizardServer } from '../../gui/server.mjs';
import { delay } from './chrome.mjs';

// Helpers for the setup wizard captures (references 1.1 to 1.7). The wizard is the real gui/index.html plus
// gui/app.js served by gui/server.mjs over a real setup session; only the service starter, the service
// registration runner and the legacy session control are injected, because no core runs in setup.
export const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MACHINE = 'DESKTOP';
export const REMOTE_MACHINE = 'LAPTOP';

const run = (file, args, cwd) => new Promise((resolve, reject) => {
  execFile(file, args, { cwd, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${file} ${args.join(' ')}: ${stderr || error.message}`)) : resolve(stdout));
});

async function makeRepository(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), `{"name":"${path.basename(directory)}"}\n`);
  await run('git', ['init', '-q', '-b', 'main'], directory);
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Initial commit'], directory);
}

const LEGACY_UNITS = [
  { unit: 'executor-shop', client: 'codex', machine: MACHINE, native: 'native-shop', id: '11111111-1111-4111-8111-111111111111', session: '31111111-1111-4111-8111-111111111111' },
  { unit: 'overlord-web', client: 'claude', machine: MACHINE, native: 'native-web', id: '22222222-2222-4222-8222-222222222222', session: '32222222-2222-4222-8222-222222222222' },
  { unit: 'executor-blog', client: 'codex', machine: REMOTE_MACHINE, native: 'native-blog', id: '33333333-3333-4333-8333-333333333333', session: '33333333-3333-4333-8333-333333333334' },
];

// A temporary home, Cosmic folder and (optionally) a detected HIVEM1ND 2.x tree, all under one temporary root.
export async function makeSetupSandbox(ctx, { legacy = false, sessions = false, populated = false } = {}) {
  // A short root name keeps the whole default folder (root/Cosmic/.m1nd) visible in the wizard's Folder field.
  const root = await mkdtemp(path.join(os.tmpdir(), 'hm-'));
  ctx.defer(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const home = path.join(root, 'home');
  const local = root;
  const cosmic = path.join(local, 'Cosmic');
  const env = { PATH: '', HOME: home, USERPROFILE: home, SystemDrive: root, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: local, CODEX_HOME: path.join(home, '.codex') };
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(local, { recursive: true });
  // The repositories the wizard counts on the ready step (four in Web, one in Unity).
  for (const name of ['Web/shop', 'Web/blog', 'Web/site', 'Web/docs', 'Unity/arena']) await makeRepository(path.join(home, name));
  const sandbox = { root, home, local, cosmic, env, mind: path.join(cosmic, '.m1nd'), legacyPath: null, joinPath: null, origin: path.join(root, 'origin') };
  if (legacy) {
    sandbox.legacyPath = path.join(home, 'HIVEM1ND');
    await writeLegacyTree(sandbox.legacyPath, { sessions });
  }
  if (populated) {
    sandbox.joinPath = path.join(root, 'shared', 'HIVEM1ND');
    await writePopulatedMind(sandbox.joinPath);
  }
  return sandbox;
}

async function writeKitFiles(mind, version) {
  await mkdir(path.join(mind, 'user'), { recursive: true });
  await writeFile(path.join(mind, 'rules.md'), 'Rules.\n');
  await writeFile(path.join(mind, 'files.md'), 'Formats.\n');
  await writeFile(path.join(mind, 'user', 'VERSION'), `${version}\n`);
}

async function writeLegacyTree(legacyPath, { sessions }) {
  await writeKitFiles(legacyPath, '2.0.0');
  await mkdir(path.join(legacyPath, 'user', 'state'), { recursive: true });
  await writeFile(path.join(legacyPath, 'user', 'preferences.md'), '- 2026-01-01: Keep answers short. Why: chosen before setup.\n');
  await writeFile(path.join(legacyPath, 'user', 'routes.md'), '## Environments\n\n## Projects\n\n## Minds\n');
  await writeFile(path.join(legacyPath, 'user', 'state', 'user.md'), 'unit: user\n\nPrivate person state.\n');
  for (const item of LEGACY_UNITS) await writeFile(path.join(legacyPath, 'user', 'state', `${item.unit}.md`), `unit: ${item.unit}\n\nState of ${item.unit}.\n`);
  if (!sessions) return;
  // Registrations that no stop record answers are the active legacy sessions the wizard asks to close.
  const directory = path.join(legacyPath, 'user', 'relay', 'sessions');
  await mkdir(directory, { recursive: true });
  for (const item of LEGACY_UNITS) {
    const record = { kind: 'registration', registrationId: item.id, sessionId: item.session, unit: item.unit, unitId: `root:${item.unit}`,
      client: item.client, machine: item.machine, nativeSessionId: item.native, registeredAt: '2026-10-13T00:00:00.000Z', pid: 999999 };
    await writeFile(path.join(directory, `${item.id}.json`), JSON.stringify(record));
  }
}

// A populated 3.0 folder another machine already set up: three units and the record of that machine.
async function writePopulatedMind(mindPath) {
  await writeKitFiles(mindPath, '3.0.0');
  await mkdir(path.join(mindPath, 'user', 'state'), { recursive: true });
  await writeFile(path.join(mindPath, 'user', 'preferences.md'), '- 2026-01-01: Keep answers short. Why: chosen before setup.\n');
  await writeFile(path.join(mindPath, 'user', 'routes.md'), '## Environments\n\n## Projects\n\n## Minds\n');
  for (const unit of ['overseer', 'executor-shop', 'executor-blog']) {
    await writeFile(path.join(mindPath, 'user', 'state', `${unit}.md`), `unit: ${unit}\n\nState of ${unit}.\n`);
  }
  await writeMachineRecord(mindPath, REMOTE_MACHINE, { machine: REMOTE_MACHINE, mind: mindPath, language: 'en', updateCheck: 'daily', lastCheck: '2026-10-14',
    setup: 'done', agents: [{ name: 'codex', mode: 'auto' }], paths: [], excluded: [], keepExistingPreferences: true, draft: {}, managedFiles: {} });
}

// The native side of closing legacy sessions: every local session is live, saves and closes when asked.
export function legacyControl() {
  const ended = new Set();
  const saved = new Set();
  return {
    async confirm(binding) { return { binding, owned: true, live: !ended.has(binding.nativeSessionId), saved: saved.has(binding.nativeSessionId) }; },
    async save(binding) { saved.add(binding.nativeSessionId); return { binding, saved: true }; },
    async close(binding) { ended.add(binding.nativeSessionId); return { binding, closed: true }; },
  };
}

export const VIEWER_URL = 'http://127.0.0.1:9/gui/viewer#/fixture';

// A service starter that answers at once, waits for a gate, or fails with the real port-conflict cause.
export function serviceStarter({ gate = null, fail = null, onStart = null } = {}) {
  const state = { starts: 0 };
  async function serviceStart() {
    state.starts += 1;
    await onStart?.(state.starts);
    if (gate) await gate;
    if (fail?.(state.starts)) throw fail(state.starts);
    return { viewerUrl: VIEWER_URL };
  }
  return { state, serviceStart };
}

// A gate a case releases after the capture, so the busy setup can finish before the temporary folders go.
export function makeGate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

export function portConflict(port = 49321) {
  return Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`), { code: 'EADDRINUSE', port });
}

// Builds a setup session and serves the wizard for it. Cleanup is registered on the context.
export async function startWizard(ctx, sandbox, { serviceStart, withLegacyControl = false } = {}) {
  const starter = serviceStart ?? serviceStarter().serviceStart;
  const session = await createSetupSession({
    kitPath: KIT_PATH, mindPath: undefined, cosmicPath: sandbox.cosmic, homeDir: sandbox.home, hostname: MACHINE, env: sandbox.env, language: ctx.language,
    originKind: 'folder', originPath: sandbox.origin,
    serviceSetup: true, serviceDryRun: false, serviceProtect: false, aclRunner: stubAclRunner(),
    serviceRunner: async () => undefined, serviceQuery: async () => ({ present: false }), serviceStart: starter,
    ...(withLegacyControl ? { legacyControl: legacyControl() } : {}),
  });
  const server = await createWizardServer({ session, openCompletedViewer: async () => undefined });
  ctx.defer(async () => { await Promise.race([server.close().catch(() => undefined), delay(4000)]); });
  return { session, server };
}

// Opens the wizard page and waits for its first step.
export async function openWizard(ctx, server) {
  await ctx.page.navigate(server.url);
  await ctx.page.waitFor(() => document.querySelector('#step-title')?.textContent && document.querySelector('.step-count')?.textContent && !document.querySelector('#step-form[aria-busy="true"]'), { timeout: 20000, message: 'the wizard first step' });
}

// Stops the page before the server is closed so no request is left open.
export function deferPageStop(ctx) {
  ctx.defer(() => ctx.page.navigate('about:blank'));
}

export async function stepNumber(page) {
  return page.eval(() => Number(/(\d+)/.exec(document.querySelector('.step-count')?.textContent ?? '')?.[1] ?? 0));
}
