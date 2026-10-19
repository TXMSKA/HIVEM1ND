// A Claude conversation can continue under a new native session ID: the desktop app starts a new session when it
// restarts or recovers. Relay registrations and wake consents name the old ID, so the chat would stop receiving its
// messages. This module carries them over, and only when the link is certain:
// - the host conversation ID (CLAUDE_CODE_HOST_SESSION_ID), which the desktop app keeps for the whole conversation, is the
//   one recorded with the old registration; or
// - the transcript of the current session (a .jsonl named by its ID inside the Claude projects folder) holds the
//   conversation's own last Relay registration, made under the old ID.
// In both cases the old ID must still be the newest registration of the same unit on this machine. Nothing is ever
// guessed from a unit name or a working directory. It runs from the Relay MCP server, which every session starts, and
// from the turn hooks where a client runs them.

import { lstat, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './store.mjs';
import { claudeWakeCapability, spawnClaudeWakeWorker } from './claude-wake.mjs';

const CLI_PATH = fileURLToPath(new URL('../../cli/index.mjs', import.meta.url));

const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;
const MAX_CANDIDATES = 500;
const REGISTER_TOOL = /(^|__)hivem1nd-relay__register$/;
const SAFE_ID = /^[^\u0000-\u001f\u007f]{1,180}$/;

/** The folder Claude Code keeps its transcripts in. */
export function claudeProjectsPath(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** The transcript of exactly this session, or null: a .jsonl file named by the session ID inside the projects folder. */
export async function sessionTranscript(transcriptPath, nativeSessionId, env = process.env) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || !SAFE_ID.test(nativeSessionId ?? '')) return null;
  const resolved = path.resolve(transcriptPath);
  const root = path.resolve(claudeProjectsPath(env));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (path.basename(resolved) !== `${nativeSessionId}.jsonl`) return null;
  const info = await lstat(resolved).catch(() => null);
  if (!info || !info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) return null;
  return resolved;
}

/** The conversation's last Relay registration in a transcript: the unit and the native ID it was made under. */
export function lastRegistration(text) {
  let at = text.length;
  for (let seen = 0; seen < MAX_CANDIDATES; seen += 1) {
    at = text.lastIndexOf('relay__register"', at - 1);
    if (at < 0) return null;
    const start = text.lastIndexOf('\n', at) + 1;
    const end = text.indexOf('\n', at);
    let entry;
    try { entry = JSON.parse(text.slice(start, end < 0 ? undefined : end)); } catch { continue; }
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
    const calls = entry.message.content.filter((item) => item?.type === 'tool_use' && REGISTER_TOOL.test(String(item.name ?? '')));
    const call = calls.at(-1);
    const unit = call?.input?.unit;
    const nativeSessionId = call?.input?.nativeSessionId;
    if (typeof unit === 'string' && unit && SAFE_ID.test(unit) && typeof nativeSessionId === 'string' && SAFE_ID.test(nativeSessionId)) {
      return { unit, nativeSessionId };
    }
    at = start;
  }
  return null;
}

/** Finds this session's transcript in any project folder of Claude Code, one level deep. */
export async function findSessionTranscript(nativeSessionId, env = process.env) {
  if (!SAFE_ID.test(nativeSessionId ?? '') || /[\\/]/.test(nativeSessionId)) return null;
  const root = claudeProjectsPath(env);
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const found = await sessionTranscript(path.join(root, folder.name, `${nativeSessionId}.jsonl`), nativeSessionId, env);
    if (found) return found;
  }
  return null;
}

/** A host conversation ID that can be recorded, or null. */
export function hostSessionOf(env = process.env) {
  const id = env.CLAUDE_CODE_HOST_SESSION_ID;
  return typeof id === 'string' && SAFE_ID.test(id) ? id : null;
}

/**
 * Carries this conversation's Relay registration, and its wake consent when one is enabled, from the native ID it was
 * made under to the current one. Returns null when there is nothing certain to carry, or
 * `{ unit, previous, binding }` where binding is the new wake binding or null. `startWorker` starts the wake worker of
 * the new binding when the environment can reach this session's inbox.
 */
export async function carryClaudeSession({ mindPath, nativeSessionId, transcriptPath = null, env = process.env, hostname = os.hostname(),
  wakeControllerFactory, startWorker = false, wakeWorkerSpawner, platform = process.platform, assumeUnregistered = false }) {
  if (!SAFE_ID.test(nativeSessionId ?? '')) return null;
  const hostSessionId = hostSessionOf(env);
  const relay = await createRelay({ mindPath, hostname, sessionId: nativeSessionId, client: 'claude' });
  if (!assumeUnregistered && (await relay.reminder({ nativeSessionId, client: 'claude' })).registered) return null;

  let last = null;
  if (hostSessionId) {
    const known = await relay.hostRegistration({ hostSessionId, client: 'claude' });
    if (known && known.nativeSessionId !== nativeSessionId) last = { unit: known.unit, nativeSessionId: known.nativeSessionId };
  }
  if (!last) {
    const transcript = transcriptPath ? await sessionTranscript(transcriptPath, nativeSessionId, env) : await findSessionTranscript(nativeSessionId, env);
    if (transcript) last = lastRegistration(await readFile(transcript, 'utf8'));
  }
  if (!last || last.nativeSessionId === nativeSessionId) return null;
  const previous = await relay.reminder({ nativeSessionId: last.nativeSessionId, client: 'claude' });
  if (!previous.registered || previous.unit.toLowerCase() !== last.unit.toLowerCase()) return null;
  await relay.register({ unit: previous.unit, nativeSessionId, client: 'claude', ...(hostSessionId ? { hostSessionId } : {}) });

  const binding = await moveWake({ mindPath, from: last.nativeSessionId, nativeSessionId, unit: previous.unit, env, hostname,
    wakeControllerFactory, startWorker, wakeWorkerSpawner, platform });
  return { unit: previous.unit, previous: last.nativeSessionId, binding };
}

/** Moves an enabled wake consent of a unit from one native session to another on this machine, with the same window. */
async function moveWake({ mindPath, from, nativeSessionId, unit, env, hostname, wakeControllerFactory, startWorker, wakeWorkerSpawner, platform }) {
  const { createRelayWakeController } = await import('./wake.mjs');
  const controller = await (wakeControllerFactory ?? createRelayWakeController)({ mindPath, hostname, sink: async () => ({ status: 'not_submitted' }) });
  const old = await controller.findEnabledBinding({ nativeSessionId: from, client: 'claude', machine: hostname });
  if (!old || old.unit.toLowerCase() !== unit.toLowerCase()) return null;
  const policy = await controller.status(old);
  const binding = { unit: old.unit, nativeSessionId, client: 'claude', machine: hostname };
  // The same consent continues: same window length, extended or unlimited as the person gave it.
  await controller.enable({
    ...binding,
    ...(policy?.unlimited ? { unlimited: true, manualConsent: true } : {}),
    ...(!policy?.unlimited && Number.isInteger(policy?.durationHours) ? { windowHours: policy.durationHours } : {}),
    ...(policy?.extended ? { extended: true } : {}),
    ...(Number.isInteger(policy?.dailyBudget) ? { maxDailyHandoffs: policy.dailyBudget } : {}),
  });
  await controller.disable(old);
  if (startWorker && env.CLAUDE_CODE_SESSION_ID === nativeSessionId && claudeWakeCapability({ env, platform }).available) {
    const child = (wakeWorkerSpawner ?? spawnClaudeWakeWorker)({ cliPath: CLI_PATH, mindPath, binding, env });
    await child.ready.catch(() => {});
  }
  return binding;
}

/**
 * Keeps the wake of this Claude session served from the current process. A worker reaches the session through the pipe of
 * the process that started it, so after the session's process starts again (`restart`), its consent is enabled again with
 * the same window, which ends the old worker, also one paused by the errors of the gone pipe; otherwise a worker is started
 * only when none runs. Returns the binding whose worker was started, or null.
 */
export async function resumeClaudeWake({ mindPath, nativeSessionId, env = process.env, hostname = os.hostname(), wakeControllerFactory,
  wakeWorkerSpawner, platform = process.platform, restart = false }) {
  if (!SAFE_ID.test(nativeSessionId ?? '') || env.CLAUDE_CODE_SESSION_ID !== nativeSessionId || !claudeWakeCapability({ env, platform }).available) return null;
  const relay = await createRelay({ mindPath, hostname, sessionId: nativeSessionId, client: 'claude' });
  const registration = await relay.wakePersistence.latestRegistration({ nativeSessionId, client: 'claude', machine: hostname });
  if (!registration) return null;
  const binding = { unit: registration.unit, nativeSessionId, client: 'claude', machine: hostname };
  const { createRelayWakeController } = await import('./wake.mjs');
  const controller = await (wakeControllerFactory ?? createRelayWakeController)({ mindPath, hostname, sink: async () => ({ status: 'not_submitted' }) });
  const status = await controller.status(binding);
  const consented = !['disabled', 'expired'].includes(status.worker.state);
  if (restart && consented && (status.enabled || status.pausedReason === 'error-budget-exhausted')) {
    await controller.enable({
      ...binding, maxHandoffs: status.wakeBudget, ...(Number.isInteger(status.dailyBudget) ? { maxDailyHandoffs: status.dailyBudget } : {}),
      ...(status.unlimited ? { unlimited: true, manualConsent: true } : { windowHours: status.durationHours, ...(status.extended ? { extended: true } : {}) }),
    });
  } else if (!status.enabled || status.worker.state === 'running') return null;
  const child = (wakeWorkerSpawner ?? spawnClaudeWakeWorker)({ cliPath: CLI_PATH, mindPath, binding, env });
  child.ready.catch(() => {});
  return binding;
}

/**
 * After a session registers by hand as a unit, moves the wake that the same host conversation still holds under an
 * earlier native session ID of that unit. Returns the new binding or null.
 */
export async function carryClaudeWake({ mindPath, nativeSessionId, unit, env = process.env, hostname = os.hostname(),
  wakeControllerFactory, startWorker = false, wakeWorkerSpawner, platform = process.platform }) {
  const hostSessionId = hostSessionOf(env);
  if (!hostSessionId || !SAFE_ID.test(nativeSessionId ?? '')) return null;
  const relay = await createRelay({ mindPath, hostname, sessionId: nativeSessionId, client: 'claude' });
  const earlier = await relay.hostRegistration({ hostSessionId, client: 'claude', excludeNativeSessionId: nativeSessionId });
  if (!earlier || earlier.unit.toLowerCase() !== String(unit).toLowerCase()) return null;
  return moveWake({ mindPath, from: earlier.nativeSessionId, nativeSessionId, unit, env, hostname, wakeControllerFactory, startWorker, wakeWorkerSpawner, platform });
}
