import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError } from '../service/identity.mjs';
import { assertNoLinks, defaultMind, MIND_DIRECTORY_NAME } from '../service/paths.mjs';

const KIT_PATH = fileURLToPath(new URL('../../', import.meta.url));

function selectedPaths(options, dependencies) {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const home = path.resolve(options.homeDir ?? os.homedir());
  return {
    platform, env, home,
    mindPath: path.resolve(options.mindPath ?? (options.cosmicPath
      ? path.join(options.cosmicPath, MIND_DIRECTORY_NAME)
      : defaultMind({ platform, env, home }))),
    hostname: options.hostname ?? os.hostname(),
    ...(options.cosmicPath ? { cosmicPath: path.resolve(options.cosmicPath) } : {}),
    aclRunner: dependencies.aclRunner,
    userKey: dependencies.userKey,
    guardPort: dependencies.guardPort,
  };
}

async function ensureRunning(selected, dependencies) {
  const runtime = dependencies.serviceRuntime ?? await import('../service/service.mjs');
  const { launchApp, serviceState, spawnDetachedService } = dependencies.launcher ?? await import('../launcher.mjs');
  await launchApp(selected, {
    state: () => serviceState(selected, runtime),
    spawnService: () => spawnDetachedService({ cliPath: path.join(KIT_PATH, 'cli', 'index.mjs'),
      mindPath: selected.mindPath, cosmicPath: selected.cosmicPath, hostname: selected.hostname, env: selected.env }),
    viewerUrl: async () => null,
    openUrl: async () => {},
    ...(dependencies.launchTiming ?? {}),
  });
}

function humanStatus(result) {
  const lines = [result.paired && Array.isArray(result.listeners) && result.listeners.length === 0
    ? 'ReLAN is offline. Changes are saved locally until the private network returns.'
    : result.hosting ? `Hosting ReLAN on ${result.machine}.`
    : result.paired ? `ReLAN member; host: ${result.host ?? 'waiting'}.` : 'ReLAN is waiting for pairing.'];
  if (result.pairing?.code) lines.push(`Pairing code: ${result.pairing.code} (expires ${result.pairing.expiresAt}).`);
  if (Array.isArray(result.peers)) lines.push(`Known peers: ${result.peers.map(peer => `${peer.address}:${peer.port}`).join(', ') || 'none'}.`);
  return lines.join('\n');
}

export async function runRelanCommand(options, dependencies, output) {
  const selected = selectedPaths(options, dependencies);
  const client = dependencies.relanClient ?? await import('../service/client.mjs');
  if (!dependencies.relanClient) await ensureRunning(selected, dependencies);
  const service = await client.connectService(selected);
  try {
    const request = async body => {
      const response = await client.request(service, {
        method: 'POST', path: '/api/v1/relan', timeoutMs: 30000,
        headers: { 'idempotency-key': randomUUID() }, body,
      });
      if (response.status !== 200) throw new CoreError(response.status,
        response.json?.error?.code ?? 'relan_unavailable', response.json?.error?.message ?? 'The ReLAN command failed.');
      return response.json?.data ?? {};
    };
    let result = await request({ action: options.action,
      ...(options.action === 'join' ? { code: options.code, ...(options.host ? { host: options.host } : {}) } : {}),
      ...(['peer-add', 'peer-remove'].includes(options.action) ? { address: options.address } : {}) });
    if (result.paired && ['status', 'host'].includes(options.action)) result = await request({ action: 'code' });
    output.write(`${options.json ? JSON.stringify(result) : options.action === 'leave' ? 'Left ReLAN.' : humanStatus(result)}\n`);
    return 0;
  } finally {
    await service.release({ stop: true });
  }
}

export async function initializeRelan(options, dependencies, output) {
  const selected = selectedPaths(options, dependencies);
  await assertNoLinks(path.join(selected.mindPath, 'user'));
  await mkdir(path.join(selected.mindPath, 'user'), { recursive: true });
  const { configureOwnedService } = dependencies.serviceInstall ?? await import('../service/install.mjs');
  const result = await configureOwnedService({ ...selected, homeDir: selected.home, kitPath: KIT_PATH,
    originKind: 'relan', originPath: options.originPath, dryRun: false, configureOnly: true });
  if (result.status !== 'configured') throw new CoreError(503, 'service_unavailable', result.error?.message ?? 'ReLAN configuration failed.');
  return runRelanCommand({ ...options, mindPath: selected.mindPath, action: 'join', code: options.joinCode.toUpperCase() }, dependencies, output);
}
