import { createConnection } from 'node:net';
import path from 'node:path';
import { validWakeBinding, validWakePointer, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'host', capability: hostWakeCapability, sendPointer: sendHostWake,
  attachIdentity: ({ nativeSessionId }) => explicitWakeAttach('host', nativeSessionId),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  workerEnvKeys: Object.freeze(['RELAY_HOST_SOCKET', 'RELAY_HOST_TOKEN']), acceptsDeferred: true,
  helpLines: Object.freeze(['Host: set RELAY_HOST_SOCKET and RELAY_HOST_TOKEN; the host application must implement relay-host-v1.']),
});

export function hostWakeCapability({ env = process.env, platform = process.platform } = {}) {
  const endpoint = env.RELAY_HOST_SOCKET;
  const token = env.RELAY_HOST_TOKEN;
  const local = typeof endpoint === 'string' && endpoint.length <= 512 && !/[\0\r\n]/.test(endpoint)
    && (platform === 'win32' ? /^\\\\[.?]\\pipe\\[^/\\]+$/.test(endpoint)
      : path.isAbsolute(endpoint) && !endpoint.startsWith('//'));
  return local && typeof token === 'string' && token.length >= 16 && token.length <= 512 && !/[\0\r\n]/.test(token)
    ? { available: true } : { available: false, reason: 'local_host_channel_required' };
}

/** Relay host v1: authenticated NDJSON on a local pipe or Unix socket. */
export async function sendHostWake({ binding, text, env = process.env, platform = process.platform,
  connect = createConnection, timeoutMs = 4000, signal } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const capability = hostWakeCapability({ env, platform });
  if (!capability.available) return no(capability.reason);
  if (!validWakeBinding(binding, 'host')) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  if (signal?.aborted) return no('cancelled_before_submit');
  return new Promise((resolve) => {
    let socket, dispatched = false, settled = false, buffer = Buffer.alloc(0);
    const failure = () => dispatched ? { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' } : no('host_unavailable');
    const quiet = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      socket?.removeListener('data', onData); socket?.removeListener('connect', onConnect);
      socket?.removeListener('error', onError); socket?.removeListener('close', onError);
      socket?.on('error', quiet); socket?.once('close', () => socket.removeListener('error', quiet)); socket?.destroy();
      resolve(value);
    };
    const onAbort = () => finish(failure());
    const onError = () => finish(failure());
    const onConnect = () => {
      if (settled || signal?.aborted) { onAbort(); return; }
      try {
        dispatched = true;
        socket.write(JSON.stringify({ type: 'auth', token: env.RELAY_HOST_TOKEN }) + '\n'
          + JSON.stringify({ type: 'relay-wake', version: 1, binding, text }) + '\n');
      } catch { onError(); }
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 8192) { onError(); return; }
      const end = buffer.indexOf(10);
      if (end < 0) return;
      try {
        const reply = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        if (reply.version !== 1 || reply.nativeSessionId !== binding.nativeSessionId || reply.unit !== binding.unit) { onError(); return; }
        finish(reply.status === 'accepted' ? { status: 'submitted', transport: 'relay-host-v1' }
          : reply.status === 'busy' ? { ...no('host_deferred'), deferred: true }
            : reply.status === 'rejected' ? no('host_rejected') : failure());
      } catch { onError(); }
    };
    const timer = setTimeout(onError, timeoutMs);
    try { socket = connect(env.RELAY_HOST_SOCKET); } catch { finish(no('host_unavailable')); return; }
    socket.once('connect', onConnect); socket.on('data', onData); socket.on('error', onError); socket.once('close', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
