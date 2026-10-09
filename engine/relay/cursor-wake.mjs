import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { validWakeBinding, validWakePointer, localWakeChildEnv, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

export const CURSOR_STOP_LOOP_LIMIT = 5;
/** The CLI took 13 to 21 s on Windows from spawn to its first stream event; the bound leaves wide headroom. */
export const CURSOR_START_TIMEOUT_MS = 60_000;
/** The controller waits past the adapter's own bound plus its 500 ms shutdown so the adapter reports first. */
export const CURSOR_CONTROLLER_BOUND_MS = CURSOR_START_TIMEOUT_MS + 5000;

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'cursor', capability: cursorWakeCapability, sendPointer: sendCursorWake,
  // The CLI shell of a Cursor chat exports its own conversation ID, so a chat attaches itself without naming it.
  attachIdentity: ({ nativeSessionId, env = process.env }) => explicitWakeAttach('cursor', nativeSessionId ?? env.CURSOR_CONVERSATION_ID),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  // The CLI and the MCP servers it starts need the profile folders, the shell and the user name on Windows.
  workerEnvKeys: Object.freeze(['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'RELAY_CURSOR_AGENT', 'RELAY_CURSOR_CWD',
    'APPDATA', 'ProgramFiles', 'ComSpec', 'USERNAME']),
  controllerOptions: Object.freeze({ retryPolicy: Object.freeze({ sinkTimeoutMs: CURSOR_CONTROLLER_BOUND_MS, leaseMs: 90_000 }) }),
  // A message that arrives while the resumed turn runs waits for the turn to end without spending retry or handoff budgets.
  acceptsDeferred: true,
  stopLoopLimit: CURSOR_STOP_LOOP_LIMIT,
  helpLines: Object.freeze([
    'Cursor CLI: run attach inside the chat; the project directory is read from the conversation and must be trusted once in the CLI. RELAY_CURSOR_CWD overrides it.',
    'Cursor editor: register the conversation, then wake enable; stop follows up at most five times.',
  ]),
});

// RELAY_CURSOR_CWD only overrides the directory the conversation recorded, so it is checked when it is set.
export function cursorWakeCapability({ env = process.env } = {}) {
  const override = env.RELAY_CURSOR_CWD;
  if (override && (!path.isAbsolute(override) || /[\0\r\n]/.test(override))) return { available: false, reason: 'cursor_cwd_invalid' };
  return { available: true };
}

const CURSOR_VERSION = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const STDERR_BOUND = 4096;
const STREAM_LINE_BOUND = 1024 * 1024;

function cursorVersionKey(name) {
  const [, year, month, day] = CURSOR_VERSION.exec(name);
  return Number(year) * 10_000 + Number(month) * 100 + Number(day);
}

// On Windows the Cursor CLI installs as agent.cmd, which spawn cannot run without a shell,
// so the bundled node.exe runs its index.js the way the launcher script does.
export async function cursorAgentCommand({ env = process.env, platform = process.platform,
  exists = existsSync, list = readdir } = {}) {
  const fallback = { command: env.RELAY_CURSOR_AGENT || 'agent', args: [] };
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
  return exists(node) && exists(script) ? { command: node, args: [script] } : fallback;
}

// The CLI keeps each conversation in a folder named by the md5 of the directory it ran in, and the
// conversation's meta.json records that directory.
const cursorCwdHash = (cwd) => createHash('md5').update(cwd).digest('hex');
const isDirectory = (directory) => statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true;

/**
 * The directory a conversation has to be resumed in. --resume starts a new conversation under an id it does
 * not know, so a conversation that cannot be located, or whose directory is gone, ends the wake instead.
 */
export async function findCursorChat({ chatId, env = process.env, platform = process.platform, list = readdir,
  read = readFile, exists = existsSync, directory = isDirectory } = {}) {
  const home = (platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();
  const chats = path.join(home, '.cursor', 'chats');
  const override = env.RELAY_CURSOR_CWD ? path.resolve(env.RELAY_CURSOR_CWD) : null;
  if (override) {
    if (!exists(path.join(chats, cursorCwdHash(override), chatId))) return { reason: 'cursor_chat_not_found' };
    return directory(override) ? { cwd: override } : { reason: 'cursor_cwd_missing' };
  }
  let folders;
  try { folders = await list(chats); } catch { return { reason: 'cursor_chat_not_found' }; }
  const found = [];
  let unreadable = false;
  for (const folder of folders) {
    if (!/^[a-f0-9]{32}$/.test(folder)) continue;
    let meta;
    try { meta = JSON.parse(await read(path.join(chats, folder, chatId, 'meta.json'), 'utf8')); }
    catch (error) { if (error?.code !== 'ENOENT') unreadable = true; continue; }
    if (typeof meta?.cwd === 'string' && path.isAbsolute(meta.cwd) && cursorCwdHash(meta.cwd) === folder) found.push(meta.cwd);
    else unreadable = true;
  }
  if (found.length > 1) return { reason: 'cursor_chat_ambiguous' };
  if (!found.length) return { reason: unreadable ? 'cursor_chat_cwd_unknown' : 'cursor_chat_not_found' };
  return directory(found[0]) ? { cwd: found[0] } : { reason: 'cursor_cwd_missing' };
}

// A second resume of a conversation whose turn still runs would write to the same conversation at once.
const runningTurns = new Map();

function exitReason(stderr) {
  return /workspace trust required/i.test(stderr) ? 'cursor_workspace_not_trusted' : 'cursor_agent_exited';
}

/**
 * Resumes the exact existing conversation in the CLI's print mode. The sink answers once the stream
 * echoes a user message of that conversation, then leaves the turn to finish on its own.
 */
export async function sendCursorWake({ binding, text, env = process.env, spawnProcess = spawn,
  timeoutMs = CURSOR_START_TIMEOUT_MS, signal, platform = process.platform, resolveAgent = cursorAgentCommand,
  findChat = findCursorChat } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const capability = cursorWakeCapability({ env });
  if (!capability.available) return no(capability.reason);
  if (!validWakeBinding(binding, 'cursor') || !CHAT_ID.test(binding.nativeSessionId)) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  const chatId = binding.nativeSessionId;
  if (runningTurns.has(chatId)) return { ...no('cursor_turn_running'), deferred: true };
  if (signal?.aborted) return no('cancelled_before_submit');
  const turn = {};
  runningTurns.set(chatId, turn);
  const release = () => { if (runningTurns.get(chatId) === turn) runningTurns.delete(chatId); };
  let child;
  try {
    const { cwd, reason } = await findChat({ chatId, env, platform });
    if (!cwd) { release(); return no(reason); }
    const agent = await resolveAgent({ env, platform });
    if (signal?.aborted) { release(); return no('cancelled_before_submit'); }
    child = spawnProcess(agent.command, [...agent.args, '--resume', chatId, '-p', '--output-format', 'stream-json',
      '--approve-mcps', text], {
      cwd, env: localWakeChildEnv('cursor', env), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { release(); return no('cursor_agent_unavailable'); }
  child.once('exit', release); child.once('error', release);
  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8');
    let settled = false, buffer = '', stderr = '';
    const detach = () => { settled = true; buffer = ''; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    // The child is already gone, or the turn started and runs on.
    const answer = (value) => { if (!settled) { detach(); resolve(value); } };
    // The child is stopped through its own handle, then given a short bound to release its working directory.
    const stop = (value) => {
      if (settled) return;
      detach();
      const shutdown = setTimeout(() => resolve(value), 500);
      child.once('close', () => { clearTimeout(shutdown); resolve(value); });
      try { child.kill(); } catch { /* already exited */ }
    };
    const onAbort = () => stop({ status: 'ambiguous', reason: 'SINK_AMBIGUOUS' });
    const timer = setTimeout(() => stop({ status: 'ambiguous', reason: 'SINK_TIMEOUT' }), timeoutMs);
    const onLine = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { stop(no('cursor_stream_malformed')); return; }
      if (!event || typeof event !== 'object' || Array.isArray(event)) { stop(no('cursor_stream_malformed')); return; }
      if (typeof event.session_id === 'string' && event.session_id !== chatId) { stop(no('cursor_session_mismatch')); return; }
      if (event.type === 'user') {
        answer({ status: 'submitted', transport: 'cursor-print' });
        // The pipes stay referenced so the worker outlives the turn instead of closing the stream under it.
        child.unref();
      } else if (event.type === 'result') {
        stop(event.is_error === true ? no('cursor_agent_error') : { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' });
      }
    };
    // After the start event both streams are only drained, so a full pipe never stalls the turn.
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      buffer += decoder.write(chunk);
      for (let end = buffer.indexOf('\n'); end >= 0 && !settled; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) onLine(line);
      }
      if (!settled && buffer.length > STREAM_LINE_BOUND) stop(no('cursor_stream_malformed'));
    });
    child.stderr.on('data', (chunk) => { if (!settled && stderr.length < STDERR_BOUND) stderr += chunk.toString('utf8'); });
    // A broken pipe on a turn that runs on must never reach the worker as an unhandled error.
    child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
    child.on('error', () => answer(no('cursor_agent_unavailable')));
    // Closing, not exiting, so the last output of the process is read before the exit is classified.
    child.on('close', () => answer(no(exitReason(stderr))));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
