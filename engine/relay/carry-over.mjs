// A Claude conversation can continue under a new native session ID: the desktop app starts a new session when it
// restarts or recovers, and copies the conversation into the new session's transcript. Relay registrations and wake
// consents name the old ID, so the chat would stop receiving its messages. This module carries them over, and only
// when the link is certain: the transcript belongs to the current session (its file is named by that ID) and it
// holds the conversation's own last Relay registration, made under the old ID for the same unit, which is still the
// newest registration of that ID on this machine. Nothing is ever guessed from a unit name or a working directory.

import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRelay } from './store.mjs';

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

/**
 * Carries this conversation's Relay registration, and its wake consent when one is enabled, from the native ID it was
 * made under to the current one. Returns null when there is nothing certain to carry, or
 * `{ unit, previous, binding }` where binding is the new wake binding or null.
 */
export async function carryClaudeSession({ mindPath, nativeSessionId, transcriptPath, env = process.env, hostname = os.hostname(),
  wakeControllerFactory }) {
  const transcript = await sessionTranscript(transcriptPath, nativeSessionId, env);
  if (!transcript) return null;
  const relay = await createRelay({ mindPath, hostname, sessionId: nativeSessionId, client: 'claude' });
  const current = await relay.reminder({ nativeSessionId, client: 'claude' });
  if (current.registered) return null;
  const last = lastRegistration(await readFile(transcript, 'utf8'));
  if (!last || last.nativeSessionId === nativeSessionId) return null;
  const previous = await relay.reminder({ nativeSessionId: last.nativeSessionId, client: 'claude' });
  if (!previous.registered || previous.unit.toLowerCase() !== last.unit.toLowerCase()) return null;
  await relay.register({ unit: previous.unit, nativeSessionId, client: 'claude' });

  const { createRelayWakeController } = await import('./wake.mjs');
  const controller = await (wakeControllerFactory ?? createRelayWakeController)({ mindPath, hostname, sink: async () => ({ status: 'not_submitted' }) });
  const old = await controller.findEnabledBinding({ nativeSessionId: last.nativeSessionId, client: 'claude', machine: hostname });
  if (!old) return { unit: previous.unit, previous: last.nativeSessionId, binding: null };
  const policy = await controller.status(old);
  const binding = { unit: old.unit, nativeSessionId, client: 'claude', machine: hostname };
  // The same consent continues: same window length, extended or unlimited as the person gave it.
  await controller.enable({
    ...binding,
    ...(policy?.unlimited ? { unlimited: true, manualConsent: true } : {}),
    ...(!policy?.unlimited && Number.isInteger(policy?.durationHours) ? { windowHours: policy.durationHours } : {}),
    ...(policy?.extended ? { extended: true } : {}),
  });
  await controller.disable(old);
  return { unit: previous.unit, previous: last.nativeSessionId, binding };
}
