import { createConnection } from 'node:net';
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validWakeBinding, validWakePointer } from './local-wake.mjs';

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'claude', capability: claudeWakeCapability, sendPointer: sendClaudeWake,
  attachIdentity: ({ nativeSessionId: requested, env }) => {
    const nativeSessionId = env.CLAUDE_CODE_SESSION_ID;
    if (typeof nativeSessionId !== 'string' || !nativeSessionId) {
      throw new Error('Claude wake attach requires CLAUDE_CODE_SESSION_ID from the target session.');
    }
    // The worker can only reach the pipe of the session that runs attach, so a request for another session would bind this one.
    if (requested !== undefined && requested !== nativeSessionId) {
      throw new Error(`Claude wake attach runs inside the target session: --native-session-id ${requested} is not this session (${nativeSessionId}).`);
    }
    // Only the Relay Stop hook turns the attach turn's busy mark back to idle;
    // without it the activity stays unknown so normal messages are not held back.
    if (claudeStopHookInstalled(env)) return { nativeSessionId, sessionId: nativeSessionId, requireRegistration: false, activity: 'busy' };
    return { nativeSessionId, sessionId: nativeSessionId, requireRegistration: false, activity: null,
      warning: 'Relay hooks are not configured for Claude Code, so busy and idle are unknown and every message wakes the session. Run relay configure --client claude to add them.' };
  },
  validateRuntime: async ({ binding, env }) => {
    if (binding && env.CLAUDE_CODE_SESSION_ID !== binding.nativeSessionId) {
      throw new Error('Wake worker native session ID does not match CLAUDE_CODE_SESSION_ID.');
    }
  },
  spawnWorker: spawnClaudeWakeWorker, workerDependency: 'spawnClaudeWakeWorker', helpLines: Object.freeze([]),
});

// Reads the user settings that relay configure writes and looks for its Stop hook.
export function claudeStopHookInstalled(env) {
  const home = env.USERPROFILE || env.HOME;
  const root = env.CLAUDE_CONFIG_DIR || (home ? path.join(home, '.claude') : null);
  if (!root) return false;
  let settings;
  try { settings = JSON.parse(readFileSync(path.join(root, 'settings.json'), 'utf8')); } catch { return false; }
  const groups = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  return groups.some((group) => (group?.hooks ?? []).some((handler) => {
    const args = Array.isArray(handler?.args) ? handler.args : String(handler?.command ?? '').split(/\s+/).map((part) => part.replace(/^['"]|['"]$/g, ''));
    return args.includes('relay') && args.includes('hook') && args[args.indexOf('--client') + 1] === 'claude'
      && args[args.indexOf('--event') + 1] === 'Stop';
  }));
}

const MAX_POINTER_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 4_000;
const CHILD_ENV_KEYS = [
  'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ID',
];

function notSubmitted(reason) {
  return { status: 'not_submitted', reason };
}

function ambiguous(reason) {
  return { status: 'ambiguous', reason };
}

function validClaudePipePath(value) {
  if (typeof value !== 'string' || value.length > 512) return false;
  const match = /^\\\\[.?]\\pipe\\([^/\0\r\n]+)$/i.exec(value);
  if (!match) return false;
  // These are flat IPC names, not filesystem paths. Preserve the spelling,
  // but reject empty or dot components because Win32 may resolve '..' components.
  return match[1].split('\\').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function claudeWakeCapability({ env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return { available: false, reason: 'unsupported_platform' };
  const sessionId = env?.CLAUDE_CODE_SESSION_ID;
  const socketPath = env?.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env?.CLAUDE_CODE_MESSAGING_TOKEN;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || /[\u0000-\u001f\u007f]/.test(sessionId)
      || !validClaudePipePath(socketPath)
      || typeof token !== 'string' || !token || token.length > 512 || /[\r\n\0]/.test(token)) {
    return { available: false, reason: 'native_session_inbox_unavailable' };
  }
  return { available: true };
}

export function claudeWakeFrames(text, token) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Wake pointer text must be a non-empty string.');
  if (Buffer.byteLength(text, 'utf8') > MAX_POINTER_BYTES) throw new RangeError('Wake pointer text exceeds the allowed size.');
  if (typeof token !== 'string' || !token || /[\r\n\0]/.test(token)) throw new TypeError('Claude session token is unavailable.');
  const auth = JSON.stringify({ type: 'auth', token });
  const user = JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  return `${auth}\n${user}\n`;
}

/**
 * Post one untrusted Relay pointer to Claude Code's own session inbox.
 * A completed local stream write means submitted to the OS pipe only; Claude
 * Code does not document a receipt/acknowledgment for this script path.
 */
export async function sendClaudeWake({
  binding,
  text,
  env = process.env,
  platform = process.platform,
  connect = createConnection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
} = {}) {
  if (signal?.aborted) return notSubmitted('cancelled_before_submit');
  const capability = claudeWakeCapability({ env, platform });
  if (!capability.available) return notSubmitted(capability.reason);
  if (!validWakeBinding(binding, 'claude') || binding.nativeSessionId !== env.CLAUDE_CODE_SESSION_ID) return notSubmitted('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return notSubmitted('invalid_pointer');
  const socketPath = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;

  let frames;
  try { frames = claudeWakeFrames(text, token); }
  catch { return notSubmitted('invalid_pointer'); }

  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    let writeStarted = false;
    let timer;
    let onConnect;
    let onSocketError;
    let onClose;
    let onLateError;
    const cleanListeners = () => {
      if (!socket) return;
      socket.removeListener?.('connect', onConnect);
      socket.removeListener?.('error', onSocketError);
      socket.removeListener?.('close', onClose);
      if (onLateError) socket.removeListener?.('error', onLateError);
    };
    const onAbort = () => {
      const outcome = writeStarted ? ambiguous('cancelled_during_pipe_write') : notSubmitted('cancelled_before_submit');
      finish(outcome, true);
    };
    const finish = (result, destroy = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (destroy && socket) {
        // Keep a harmless error listener until close: a cancelled connecting
        // net.Socket may report ECONNRESET asynchronously after destroy().
        onLateError = () => {};
        socket.removeListener?.('connect', onConnect);
        socket.removeListener?.('error', onSocketError);
        socket.on?.('error', onLateError);
        socket.once?.('close', cleanListeners);
        socket.destroy();
      } else {
        cleanListeners();
      }
      resolve(result);
    };
    let socket;
    try { socket = connect(socketPath); }
    catch { finish(notSubmitted('native_session_inbox_unavailable')); return; }

    timer = setTimeout(() => {
      finish(writeStarted ? ambiguous('native_pipe_write_ambiguous') : notSubmitted('native_session_inbox_unavailable'), true);
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }

    onConnect = () => {
      if (settled) return;
      if (signal?.aborted) { onAbort(); return; }
      connected = true;
      writeStarted = true;
      socket.end(frames, (error) => {
        if (error) finish(ambiguous('native_pipe_write_ambiguous'), true);
        else finish({ status: 'submitted', transport: 'claude-session-inbox' }, true);
      });
    };
    onSocketError = () => {
      finish(connected || writeStarted ? ambiguous('native_pipe_write_ambiguous') : notSubmitted('native_session_inbox_unavailable'), true);
    };
    onClose = () => {
      if (!settled) finish(writeStarted ? ambiguous('native_pipe_write_ambiguous') : notSubmitted('native_session_inbox_unavailable'));
      cleanListeners();
    };
    socket.once('connect', onConnect);
    socket.on('error', onSocketError);
    socket.once('close', onClose);
  });
}

export function claudeWakeChildEnv(env = process.env) {
  const childEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof env?.[key] === 'string') childEnv[key] = env[key];
  }
  return childEnv;
}

/** Spawn the bounded policy watcher from the target Claude session's process. */
export function spawnClaudeWakeWorker({
  cliPath,
  mindPath,
  binding,
  env = process.env,
  nodePath = process.execPath,
  forkProcess = fork,
  // Core may wait for a prior generation's 15s lease before confirming the
  // replacement worker; keep enough margin for the old sink/poll to settle.
  readyTimeoutMs = 20_000,
  keepParentAliveUntilReady = false,
}) {
  if (!cliPath || !mindPath || !binding?.unit || !binding?.nativeSessionId || binding.client !== 'claude' || !binding.machine) {
    throw new TypeError('Claude wake worker requires a complete explicit binding.');
  }
  if (!env?.CLAUDE_CODE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID !== binding.nativeSessionId) {
    throw new Error('Claude wake worker binding does not match the current native session.');
  }
  if (typeof env.CLAUDE_CODE_MESSAGING_SOCKET !== 'string' || !env.CLAUDE_CODE_MESSAGING_SOCKET
      || typeof env.CLAUDE_CODE_MESSAGING_TOKEN !== 'string' || !env.CLAUDE_CODE_MESSAGING_TOKEN) {
    throw new Error('Claude native session inbox capability is unavailable.');
  }

  const args = ['relay', 'wake', 'watch', '--mind-path', mindPath, '--unit', binding.unit,
    '--native-session-id', binding.nativeSessionId, '--client', 'claude', '--hostname', binding.machine];
  const child = forkProcess(cliPath, args, {
    execPath: nodePath,
    execArgv: [],
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    env: claudeWakeChildEnv(env),
  });
  const releaseParentRefs = () => {
    child.unref?.();
    child.channel?.unref?.();
  };
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanupListeners = () => {
      child.removeListener?.('message', onMessage);
      child.removeListener?.('error', onError);
      child.removeListener?.('exit', onExit);
    };
    const stopChild = () => {
      try { child.disconnect?.(); } catch { /* already disconnected */ }
      try {
        if (child.exitCode === null || child.exitCode === undefined) child.kill?.();
      } catch { /* process may already be exiting */ }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupListeners();
      if (callback === reject) stopChild();
      callback(value);
    };
    const onMessage = (message) => {
      if (message?.type !== 'relay-wake-ready') return;
      if (!['running', 'already-running'].includes(message.state) || typeof message.ownsLease !== 'boolean') {
        finish(reject, new Error('Claude wake worker returned an invalid readiness state.'));
        return;
      }
      finish(resolve, { state: message.state, ownsLease: message.ownsLease });
      child.disconnect?.();
      if (keepParentAliveUntilReady) setImmediate(releaseParentRefs);
    };
    const onError = () => finish(reject, new Error('Claude wake worker could not start.'));
    const onExit = () => finish(reject, new Error('Claude wake worker exited before readiness.'));
    timer = setTimeout(() => finish(reject, new Error('Claude wake worker did not confirm readiness.')), readyTimeoutMs);
    if (!keepParentAliveUntilReady) timer.unref?.();
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
  ready.catch(() => {});
  if (!keepParentAliveUntilReady) releaseParentRefs();
  return { child, ready };
}
