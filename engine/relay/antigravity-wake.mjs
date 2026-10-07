import { spawn } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { validWakeBinding, validWakePointer, localWakeChildEnv, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'antigravity', capability: antigravityWakeCapability, sendPointer: sendAntigravityWake,
  attachIdentity: ({ nativeSessionId }) => explicitWakeAttach('antigravity', nativeSessionId),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  workerEnvKeys: Object.freeze(['RELAY_ANTIGRAVITY_CWD', 'RELAY_ANTIGRAVITY_AGY']),
  controllerOptions: Object.freeze({ retryPolicy: Object.freeze({ sinkTimeoutMs: 15_000, leaseMs: 30_000 }) }),
  helpLines: Object.freeze(['Antigravity CLI: set RELAY_ANTIGRAVITY_CWD; close the exact conversation in other clients.']),
});

export function antigravityWakeCapability({ env = process.env } = {}) {
  if (typeof env.RELAY_ANTIGRAVITY_CWD !== 'string' || !path.isAbsolute(env.RELAY_ANTIGRAVITY_CWD)
      || /[\0\r\n]/.test(env.RELAY_ANTIGRAVITY_CWD)) return { available: false, reason: 'explicit_antigravity_cwd_required' };
  return { available: true };
}

/** Google documents --conversation and stream-json input/output in CLI headless mode. */
export async function sendAntigravityWake({ binding, text, env = process.env, spawnProcess = spawn,
  timeoutMs = 14_000, signal } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const capability = antigravityWakeCapability({ env });
  if (!capability.available) return no(capability.reason);
  if (!validWakeBinding(binding, 'antigravity') || binding.nativeSessionId.startsWith('-')) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  if (signal?.aborted) return no('cancelled_before_submit');
  let child;
  try {
    child = spawnProcess(env.RELAY_ANTIGRAVITY_AGY || 'agy', ['--conversation', binding.nativeSessionId,
      '--input-format', 'stream-json', '--output-format', 'stream-json'], {
      cwd: env.RELAY_ANTIGRAVITY_CWD, env: localWakeChildEnv('antigravity', env),
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { return no('antigravity_unavailable'); }
  return new Promise((resolve) => {
    let dispatched = false, initialized = false, settled = false, buffer = '', bytes = 0;
    const decoder = new StringDecoder('utf8');
    const failure = () => dispatched ? { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' } : no('antigravity_resume_unavailable');
    const quiet = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError); child.removeListener('exit', onError); child.stdin.removeListener('error', onError);
      child.on('error', quiet); child.stdin.on('error', quiet);
      // Wait for process closure so Windows releases the fixture's working directory.
      const shutdown = setTimeout(() => resolve(value), 500);
      child.once('close', () => {
        clearTimeout(shutdown); child.removeListener('error', quiet); child.stdin.removeListener('error', quiet); resolve(value);
      });
      try { child.stdin.end(); child.kill(); } catch { /* already exited */ }
    };
    const onError = () => finish(failure());
    const onAbort = () => finish(failure());
    const onData = (chunk) => {
      bytes += Buffer.byteLength(chunk);
      buffer += decoder.write(Buffer.from(chunk));
      if (bytes > 8 * 1024 * 1024) { onError(); return; }
      while (!settled) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        if (Buffer.byteLength(buffer.slice(0, end)) > 1024 * 1024) { onError(); return; }
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { onError(); return; }
        if (!event || typeof event !== 'object') { onError(); return; }
        if (event.event === 'init') {
          if (initialized || event.conversation_id !== binding.nativeSessionId) { onError(); return; }
          initialized = true;
          if (signal?.aborted) { onAbort(); return; }
          try {
            dispatched = true;
            child.stdin.write(JSON.stringify({ event: 'user', message: { content: text } }) + '\n');
            child.stdin.end();
          } catch { onError(); return; }
        } else if (event.event === 'result') {
          if (!dispatched) { onError(); return; }
          finish(event.result?.conversation_id === binding.nativeSessionId && event.result.status === 'SUCCESS'
            ? { status: 'submitted', transport: 'antigravity-stream-json' } : failure());
        } else if (event.event !== 'step_update' || !initialized
            || event.step_update?.conversation_id !== binding.nativeSessionId) { onError(); return; }
      }
      if (Buffer.byteLength(buffer) > 1024 * 1024) onError();
    };
    const timer = setTimeout(onError, timeoutMs);
    child.stdout.on('data', onData); child.on('error', onError); child.on('exit', onError); child.stdin.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
