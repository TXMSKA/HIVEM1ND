import { spawn } from 'node:child_process';

// What a shortcut runs. The app is the local service plus a viewer in the browser. Opening it never hosts the service
// in the window that was clicked: a service that is not running is started detached and without a console, and a
// service that runs is reused, so a second click opens one more viewer instead of a second service. Nothing is
// printed; the session address goes straight to the browser and is never shown.

export class LaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LaunchError';
    this.code = code;
  }
}

// Spawns the CLI as `service run` with no window: detached from this process, no streams, no console on Windows.
export function spawnDetachedService({ nodePath = process.execPath, cliPath, mindPath, cosmicPath, hostname, env = process.env, spawnProcess = spawn }) {
  const args = [cliPath, 'service', 'run', '--mind-path', mindPath,
    ...(cosmicPath ? ['--cosmic-path', cosmicPath] : []), ...(hostname ? ['--hostname', hostname] : [])];
  const child = spawnProcess(nodePath, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// absent: nothing holds the service. starting: it holds the guard but is not ready. running: it can be reached.
export async function serviceState(options, serviceRuntime) {
  try {
    const owned = await serviceRuntime.readOwnedServiceBridge(options);
    if (owned.unrelated) return 'conflict';
    return owned.absent ? 'absent' : owned.descriptor ? 'running' : 'starting';
  } catch (error) {
    if (error?.code === 'service_mind_conflict') return 'conflict';
    return 'starting';
  }
}

export async function launchApp(options, deps) {
  const { state, spawnService, viewerUrl, openUrl, sleep = delay, now = Date.now, timeoutMs = 90_000, pollMs = 300 } = deps;
  let current = await state();
  if (current === 'conflict') throw new LaunchError('service_mind_conflict', 'Another M1ND owns the service.');
  const started = current === 'absent';
  if (started) await spawnService();
  const deadline = now() + timeoutMs;
  while (current !== 'running') {
    if (now() > deadline) throw new LaunchError('service_start_timeout', 'The service did not become ready.');
    await sleep(pollMs);
    current = await state();
    if (current === 'conflict') throw new LaunchError('service_mind_conflict', 'Another M1ND owns the service.');
  }
  await openUrl(await viewerUrl());
  return { started };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
