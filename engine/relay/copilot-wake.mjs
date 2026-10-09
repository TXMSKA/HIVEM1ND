import { spawn } from 'node:child_process';
import path from 'node:path';
import { validWakeBinding, validWakePointer, localWakeChildEnv, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

// Credential and location variables the Copilot CLI documents for itself.
// COPILOT_ALLOW_ALL and the permission flags are deliberately absent.
export const COPILOT_WORKER_ENV_KEYS = Object.freeze([
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_HOME', 'GH_HOST', 'COPILOT_GH_HOST',
  'RELAY_COPILOT_CLI', 'RELAY_COPILOT_CWD',
]);

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'copilot', capability: copilotWakeCapability, sendPointer: sendCopilotWake,
  attachIdentity: ({ nativeSessionId }) => explicitWakeAttach('copilot', nativeSessionId),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  workerEnvKeys: COPILOT_WORKER_ENV_KEYS,
  controllerOptions: Object.freeze({ retryPolicy: Object.freeze({ sinkTimeoutMs: 15_000, leaseMs: 30_000 }) }),
  helpLines: Object.freeze([
    'Copilot CLI ACP: set RELAY_COPILOT_CWD; close the exact session in every other client.',
  ]),
});

export function copilotWakeCapability({ env = process.env } = {}) {
  if (typeof env.RELAY_COPILOT_CWD !== 'string' || !path.isAbsolute(env.RELAY_COPILOT_CWD)
      || /[\0\r\n]/.test(env.RELAY_COPILOT_CWD)) return { available: false, reason: 'explicit_copilot_cwd_required' };
  if (env.RELAY_COPILOT_CLI !== undefined && (typeof env.RELAY_COPILOT_CLI !== 'string' || !env.RELAY_COPILOT_CLI.trim()
      || /[\0\r\n]/.test(env.RELAY_COPILOT_CLI))) return { available: false, reason: 'invalid_copilot_cli' };
  return { available: true };
}

/**
 * Headless resume only, over the documented `copilot --acp --stdio` server. It loads the exact
 * existing session, sends one pointer and closes. It never creates a session or approves a request.
 */
export async function sendCopilotWake({ binding, text, env = process.env, spawnProcess = spawn,
  timeoutMs = 14_000, signal } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const capability = copilotWakeCapability({ env });
  if (!capability.available) return no(capability.reason);
  if (!validWakeBinding(binding, 'copilot')) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  if (signal?.aborted) return no('cancelled_before_submit');
  let child;
  try {
    child = spawnProcess(env.RELAY_COPILOT_CLI || 'copilot', ['--acp', '--stdio'], {
      cwd: env.RELAY_COPILOT_CWD, env: localWakeChildEnv('copilot', env),
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { return no('copilot_cli_unavailable'); }
  let dispatched = false, settled = false, buffer = Buffer.alloc(0), nextId = 1;
  const pending = new Map();
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const failure = () => dispatched ? { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' } : no('copilot_acp_unavailable');
  const write = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  const quietError = () => {};
  const finish = (value) => {
    if (settled) return;
    settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    child.stdout.removeListener('data', onData);
    child.removeListener('error', onError); child.removeListener('exit', onError);
    child.stdin.removeListener('error', onError);
    child.on('error', quietError); child.stdin.on('error', quietError);
    // On Windows the process can still hold its cwd after kill() returns.
    // Wait for close, with a small bounded shutdown margin, before completing.
    const shutdownTimer = setTimeout(() => resolveResult(value), 500);
    child.once('close', () => {
      clearTimeout(shutdownTimer);
      child.removeListener('error', quietError); child.stdin.removeListener('error', quietError);
      resolveResult(value);
    });
    if (dispatched && value.status !== 'submitted') {
      try { write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: binding.nativeSessionId } }); } catch { /* closing */ }
    }
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
    try { child.stdin.end(); child.kill(); } catch { /* already exited */ }
  };
  const onError = () => finish(failure());
  const onAbort = () => finish(failure());
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > 1024 * 1024) { onError(); return; }
    while (!settled) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      const line = buffer.subarray(0, end).toString('utf8').trim();
      buffer = buffer.subarray(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { onError(); return; }
      if (!message || message.jsonrpc !== '2.0') { onError(); return; }
      // Any traffic about another session means the exact binding cannot be trusted.
      if (message.method && message.params?.sessionId !== undefined
          && message.params.sessionId !== binding.nativeSessionId) { onError(); return; }
      // A background sink cannot approve tools, read files or run terminals.
      if (message.method && message.id !== undefined) {
        try {
          write(message.method === 'session/request_permission'
            ? { jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }
            : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Interactive client required.' } });
        } catch { onError(); }
      } else if (!message.method && pending.has(message.id)) {
        const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
      }
    }
  };
  const timer = setTimeout(onError, timeoutMs);
  child.stdout.on('data', onData); child.on('error', onError); child.on('exit', onError); child.stdin.on('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) { onAbort(); return result; }
  async function request(method, params) {
    if (settled) return null;
    const id = nextId++;
    const response = new Promise((resolve) => pending.set(id, resolve));
    try {
      if (method === 'session/prompt') dispatched = true;
      write({ jsonrpc: '2.0', id, method, params });
    } catch { onError(); }
    return response;
  }
  const ok = (message) => Boolean(message && !message.error && message.result && typeof message.result === 'object');
  try {
    const initialized = await request('initialize', { protocolVersion: 1,
      clientInfo: { name: 'hivem1nd-relay', version: '1.0.0' }, clientCapabilities: {} });
    if (!ok(initialized) || initialized.result.protocolVersion !== 1 || initialized.result.agentCapabilities?.loadSession !== true) {
      finish(no('copilot_load_unavailable')); return result;
    }
    const loaded = await request('session/load', { sessionId: binding.nativeSessionId, cwd: env.RELAY_COPILOT_CWD, mcpServers: [] });
    if (!ok(loaded)) { finish(no('copilot_load_failed')); return result; }
    const prompted = await request('session/prompt', { sessionId: binding.nativeSessionId, prompt: [{ type: 'text', text }] });
    finish(ok(prompted) && typeof prompted.result.stopReason === 'string'
      ? { status: 'submitted', transport: 'copilot-acp' } : failure());
  } catch { onError(); }
  return result;
}
