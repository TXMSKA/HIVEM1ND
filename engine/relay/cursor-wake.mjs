import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validWakeBinding, validWakePointer, localWakeChildEnv, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

export const CURSOR_STOP_LOOP_LIMIT = 5;

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'cursor', capability: cursorWakeCapability, sendPointer: sendCursorWake,
  attachIdentity: ({ nativeSessionId }) => explicitWakeAttach('cursor', nativeSessionId),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  workerEnvKeys: Object.freeze(['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'RELAY_CURSOR_AGENT', 'RELAY_CURSOR_CWD']),
  controllerOptions: Object.freeze({ retryPolicy: Object.freeze({ sinkTimeoutMs: 15_000, leaseMs: 30_000 }) }),
  stopLoopLimit: CURSOR_STOP_LOOP_LIMIT,
  helpLines: Object.freeze([
    'Cursor ACP: set RELAY_CURSOR_CWD; close the exact conversation in other clients.',
    'Cursor editor: register the conversation, then wake enable; stop follows up at most five times.',
  ]),
});

export function cursorWakeCapability({ env = process.env } = {}) {
  if (typeof env.RELAY_CURSOR_CWD !== 'string' || !path.isAbsolute(env.RELAY_CURSOR_CWD)
      || /[\0\r\n]/.test(env.RELAY_CURSOR_CWD)) return { available: false, reason: 'explicit_cursor_cwd_required' };
  return { available: true };
}

const CURSOR_VERSION = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

function cursorVersionKey(name) {
  const [, year, month, day] = CURSOR_VERSION.exec(name);
  return Number(year) * 10_000 + Number(month) * 100 + Number(day);
}

// On Windows the Cursor CLI installs as agent.cmd, which spawn cannot run without a shell,
// so the bundled node.exe runs its index.js the way the launcher script does.
export async function cursorAgentCommand({ env = process.env, platform = process.platform,
  exists = existsSync, list = readdir } = {}) {
  const fallback = { command: env.RELAY_CURSOR_AGENT || 'agent', args: ['acp'] };
  if (env.RELAY_CURSOR_AGENT || platform !== 'win32' || typeof env.LOCALAPPDATA !== 'string') return fallback;
  const root = path.win32.join(env.LOCALAPPDATA, 'cursor-agent');
  let dir = root;
  if (!exists(path.win32.join(root, 'node.exe'))) {
    let names;
    try { names = await list(path.win32.join(root, 'versions')); } catch { return fallback; }
    const latest = names.filter((name) => CURSOR_VERSION.test(name))
      .sort((a, b) => cursorVersionKey(b) - cursorVersionKey(a) || b.localeCompare(a))[0];
    if (!latest) return fallback;
    dir = path.win32.join(root, 'versions', latest);
  }
  const node = path.win32.join(dir, 'node.exe');
  const script = path.win32.join(dir, 'index.js');
  return exists(node) && exists(script) ? { command: node, args: [script, 'acp'] } : fallback;
}

/** Headless resume only. Never attach a conversation open in another client. */
export async function sendCursorWake({ binding, text, env = process.env, spawnProcess = spawn,
  timeoutMs = 14_000, signal, platform = process.platform, resolveAgent = cursorAgentCommand } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const capability = cursorWakeCapability({ env });
  if (!capability.available) return no(capability.reason);
  if (!validWakeBinding(binding, 'cursor')) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  const agent = await resolveAgent({ env, platform });
  if (signal?.aborted) return no('cancelled_before_submit');
  let child;
  try {
    child = spawnProcess(agent.command, agent.args, {
      cwd: env.RELAY_CURSOR_CWD, env: localWakeChildEnv('cursor', env),
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { return no('cursor_agent_unavailable'); }
  let dispatched = false, settled = false, buffer = Buffer.alloc(0), nextId = 1;
  const pending = new Map();
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const failure = () => dispatched ? { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' } : no('cursor_acp_unavailable');
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
      finish(no('cursor_load_unavailable')); return result;
    }
    const loaded = await request('session/load', { sessionId: binding.nativeSessionId, cwd: env.RELAY_CURSOR_CWD, mcpServers: [] });
    if (!ok(loaded)) { finish(no('cursor_load_failed')); return result; }
    const prompted = await request('session/prompt', { sessionId: binding.nativeSessionId, prompt: [{ type: 'text', text }] });
    finish(ok(prompted) && typeof prompted.result.stopReason === 'string'
      ? { status: 'submitted', transport: 'cursor-acp' } : failure());
  } catch { onError(); }
  return result;
}
