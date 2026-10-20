import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRelayWakePersistence, createRelay, isTransientFsError } from './store.mjs';
import { WAKE_ADAPTERS, getWakeAdapter } from './wake-adapters.mjs';
import { wakePointer } from './local-wake.mjs';

const CLI_PATH = fileURLToPath(new URL('../../cli/index.mjs', import.meta.url));
// A session in use starts its window again at most this often, since each renewal replaces a file of the synced mind.
const RENEW_EVERY_MS = 5 * 60 * 1000;

const DEFAULT_WINDOW_HOURS = 4;
const ALLOWED_STANDARD_HOURS = new Set([4, 5, 6, 7, 8]);
const ALLOWED_EXTENDED_HOURS = new Set([12, 24]);
const DEFAULT_WAKE_HANDOFFS = 20;
// A hard cap per calendar day of the machine that activity does not reset, so two seats that answer each other cannot
// spend their quota all night.
const DEFAULT_DAILY_HANDOFFS = 200;
const MAX_DAILY_HANDOFFS = 1000;
const MAX_DELIVERIES = 1024;
// Ids dropped beyond what a wave needs, so the memory is not trimmed again at the next poll.
const DELIVERY_SLACK = 64;
const MAX_INBOX_MESSAGES = 500;
const ACTIVITY_MAX_AGE_MS = 15 * 60 * 1000;
const ACTIVITY_REFRESH_MS = 60_000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_LEASE_MS = 15_000;
const LEASE_RENEW_MS = 5000;
// Another machine reads the note from the synced policy, so it is written rarely; three missed notes mean the worker is gone.
const WORKER_NOTE_MS = 60_000;
const WORKER_NOTE_STALE_MS = 3 * WORKER_NOTE_MS;
// A file problem that clears by itself, such as a record OneDrive is still syncing, is retried on the next polls; a worker
// ends for one only when it has lasted this many polls in a row and this long.
const GLITCH_POLLS = 10;
const GLITCH_MS = 30_000;
// After the fast retries a wake that never reached the host is tried again on a slower schedule while the worker runs and the
// consent is enabled: 30 seconds, doubling up to 10 minutes, eight times in all, and only then is it marked failed.
const SLOW_RETRIES = 8;
const SLOW_RETRY_MS = 30_000;
const SLOW_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_SINK_TIMEOUT_MS = 5000;

function wakeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

// The calendar day of the machine, which the daily cap counts in.
function localDate(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextLocalMidnight(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function dailyCap(policy) {
  return Number.isInteger(policy?.maxDailyHandoffs) ? policy.maxDailyHandoffs : DEFAULT_DAILY_HANDOFFS;
}

function dayCount(policy, now) {
  return policy?.day?.date === localDate(now) && Number.isInteger(policy.day.count) ? policy.day.count : 0;
}

function dayCapped(policy, now) {
  return dayCount(policy, now) >= dailyCap(policy);
}

// The day's count after `added` more wakes; a new day starts again from zero.
function countedDay(policy, now, added) {
  const date = localDate(now);
  const same = policy?.day?.date === date;
  return { date, count: dayCount(policy, now) + added, ...(same && policy.day.noticeAt ? { noticeAt: policy.day.noticeAt } : {}) };
}

function plainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function safeScalar(value, label, max = 180) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw wakeError('WAKE_INVALID_BINDING', `${label} must be a bounded single-line value.`);
  }
  return value;
}

function normalizeBinding(value, machine, { remote = false } = {}) {
  if (!plainObject(value)) throw wakeError('WAKE_INVALID_BINDING', 'Wake operations require an explicit binding object.');
  const unknown = Object.keys(value).find((key) => !['unit', 'unitId', 'nativeSessionId', 'client', 'machine'].includes(key));
  if (unknown) throw wakeError('WAKE_INVALID_BINDING', `Wake binding does not accept ${unknown}.`);
  const unit = safeScalar(value.unit, 'unit', 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(unit) || unit === '.' || unit === '..' || unit.endsWith('.')
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(unit)) {
    throw wakeError('WAKE_INVALID_BINDING', 'unit must be a path-safe Relay unit name.');
  }
  const nativeSessionId = safeScalar(value.nativeSessionId, 'nativeSessionId');
  const client = safeScalar(value.client, 'client', 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(client)) throw wakeError('WAKE_INVALID_BINDING', 'client must be a path-safe name.');
  const selectedMachine = value.machine === undefined ? machine : safeScalar(value.machine, 'machine', 48);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(selectedMachine) || selectedMachine.endsWith('.')) {
    throw wakeError('WAKE_INVALID_BINDING', 'machine must be a path-safe host name.');
  }
  if (selectedMachine !== machine && !remote) throw wakeError('WAKE_WRONG_MACHINE', 'A wake controller cannot target a different machine.');
  const binding = { unit, nativeSessionId, client, machine: selectedMachine };
  if (value.unitId !== undefined) {
    const unitId = safeScalar(value.unitId, 'unitId', 200);
    if (!/^(root|env|project):[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(unitId) || !unitId.endsWith(`:${unit}`) && unitId !== `root:${unit}`) {
      throw wakeError('WAKE_INVALID_BINDING', 'unitId must be the canonical id for that unit.');
    }
    binding.unitId = unitId;
  }
  return binding;
}

function bindingHash(binding) {
  return createHash('sha256').update(JSON.stringify([binding.unitId ?? binding.unit, binding.nativeSessionId, binding.client, binding.machine])).digest('hex');
}

function legacyHash(binding) { return bindingHash({ ...binding, unitId: undefined }); }

function earlierTime(left, right) {
  if (!Number.isFinite(Date.parse(left))) return right;
  if (!Number.isFinite(Date.parse(right))) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function laterTime(left, right) {
  if (!Number.isFinite(Date.parse(left))) return right;
  if (!Number.isFinite(Date.parse(right))) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function consentWindow(policy) {
  return { startedAt: policy.startedAt, deadlineAt: policy.deadlineAt, durationHours: policy.durationHours,
    extended: policy.extended, unlimited: policy.unlimited, manualConsent: policy.manualConsent };
}

function validWindow(window) {
  if (!plainObject(window) || !Number.isFinite(Date.parse(window.startedAt)) || typeof window.extended !== 'boolean'
    || typeof window.unlimited !== 'boolean' || typeof window.manualConsent !== 'boolean') return false;
  if (window.unlimited === true) return window.deadlineAt === null && window.durationHours === null && window.manualConsent === true;
  return window.unlimited === false && window.manualConsent === false && typeof window.extended === 'boolean'
    && Number.isInteger(window.durationHours)
    && (ALLOWED_STANDARD_HOURS.has(window.durationHours) || window.extended && ALLOWED_EXTENDED_HOURS.has(window.durationHours))
    && Date.parse(window.deadlineAt) === Date.parse(window.startedAt) + window.durationHours * 3600000;
}

function mergeAliases(canonical, legacy, binding, key) {
  if (!canonical && !legacy) return null;
  const base = canonical ?? legacy;
  if (!canonical || !legacy) return { ...base, binding, key };
  const rank = { ambiguous: 5, submitted: 4, attempting: 3, failed: 2, not_submitted: 1 };
  const deliveries = { ...canonical.deliveries };
  for (const [id, incoming] of Object.entries(legacy.deliveries)) {
    const previous = deliveries[id];
    if (!previous) { deliveries[id] = incoming; continue; }
    const winner = rank[incoming.state] > rank[previous.state] ? incoming : previous;
    deliveries[id] = { ...winner, attempts: Math.max(previous.attempts, incoming.attempts),
      lastAttemptAt: laterTime(previous.lastAttemptAt, incoming.lastAttemptAt),
      ...(winner.state === 'not_submitted' ? { retryAt: laterTime(previous.retryAt, incoming.retryAt) } : {}) };
  }
  if (Object.keys(deliveries).length > MAX_DELIVERIES) throw wakeError('WAKE_STORE_LIMIT', 'Merged wake deliveries exceed the dedupe budget.');
  const wakeCount = Math.max(canonical.wakeCount, legacy.wakeCount);
  const remaining = Math.min(canonical.maxHandoffs - canonical.wakeCount, legacy.maxHandoffs - legacy.wakeCount);
  const windows = [...(canonical.consentWindows ?? [consentWindow(canonical)]), ...(legacy.consentWindows ?? [consentWindow(legacy)])]
    .filter(window => Number.isFinite(Date.parse(window.startedAt)));
  const consentWindows = [...new Map(windows.map(window => [JSON.stringify(window), window])).values()];
  const finite = consentWindows.filter(window => !window.unlimited);
  const deadlineAt = finite.reduce((at, window) => earlierTime(at, window.deadlineAt), null);
  const startedAt = consentWindows.reduce((at, window) => earlierTime(at, window.startedAt), null);
  const unlimited = finite.length === 0 && consentWindows.length > 0;
  const activity = laterTime(canonical.activity.observedAt, legacy.activity.observedAt) === legacy.activity.observedAt ? legacy.activity : canonical.activity;
  return { ...base, binding, key, enabled: canonical.enabled && legacy.enabled,
    startedAt, deadlineAt, unlimited, manualConsent: unlimited,
    durationHours: unlimited ? null : finite[0]?.durationHours ?? null,
    extended: unlimited ? consentWindows.every(window => window.extended) : finite[0]?.extended ?? false,
    consentWindows, deliveries, wakeCount, maxHandoffs: wakeCount + remaining,
    maxDailyHandoffs: Math.min(dailyCap(canonical), dailyCap(legacy)),
    day: !canonical.day && !legacy.day ? undefined : canonical.day?.date === legacy.day?.date
      ? { ...canonical.day, count: Math.max(canonical.day?.count ?? 0, legacy.day?.count ?? 0),
        ...(canonical.day?.noticeAt || legacy.day?.noticeAt ? { noticeAt: earlierTime(canonical.day?.noticeAt, legacy.day?.noticeAt) } : {}) }
      : String(canonical.day?.date ?? '') >= String(legacy.day?.date ?? '') ? canonical.day : legacy.day,
    pausedReason: canonical.pausedReason ?? legacy.pausedReason ?? (remaining === 0 ? 'handoff-budget-exhausted' : null),
    disabledAt: earlierTime(canonical.disabledAt, legacy.disabledAt),
    disabledReason: !canonical.enabled ? canonical.disabledReason : legacy.disabledReason,
    retryAt: laterTime(canonical.retryAt, legacy.retryAt), cooldownUntil: laterTime(canonical.cooldownUntil, legacy.cooldownUntil),
    consecutiveErrors: Math.max(canonical.consecutiveErrors, legacy.consecutiveErrors), activity };
}

function iso(ms) { return new Date(ms).toISOString(); }

function nowMs(clock) {
  const value = clock.now();
  const number = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(number)) throw wakeError('WAKE_CLOCK_INVALID', 'The wake clock returned an invalid time.');
  return number;
}

function activityObservation(value, at, now) {
  if (!['busy', 'idle'].includes(value) || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return { value: null, observedAt: null };
  const timestamp = Date.parse(at);
  if (timestamp > now + 5000 || now - timestamp > ACTIVITY_MAX_AGE_MS) return { value: null, observedAt: at };
  return { value, observedAt: at };
}

function parseRetryPolicy(value = {}) {
  if (!plainObject(value)) throw wakeError('WAKE_INVALID_RETRY_POLICY', 'retryPolicy must be an object.');
  const allowed = ['maxAttempts', 'baseDelayMs', 'maxDelayMs', 'cooldownMs', 'sinkTimeoutMs', 'leaseMs'];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw wakeError('WAKE_INVALID_RETRY_POLICY', `retryPolicy does not accept ${unknown}.`);
  const result = {
    maxAttempts: value.maxAttempts ?? 3,
    baseDelayMs: value.baseDelayMs ?? 1000,
    maxDelayMs: value.maxDelayMs ?? 10_000,
    cooldownMs: value.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    sinkTimeoutMs: value.sinkTimeoutMs ?? DEFAULT_SINK_TIMEOUT_MS,
    leaseMs: value.leaseMs ?? DEFAULT_LEASE_MS,
  };
  if (!Number.isInteger(result.maxAttempts) || result.maxAttempts < 1 || result.maxAttempts > 5
    || !Number.isInteger(result.baseDelayMs) || result.baseDelayMs < 100 || result.baseDelayMs > 10_000
    || !Number.isInteger(result.maxDelayMs) || result.maxDelayMs < result.baseDelayMs || result.maxDelayMs > 30_000
    || !Number.isInteger(result.cooldownMs) || result.cooldownMs < 1000 || result.cooldownMs > 120_000
    || !Number.isInteger(result.sinkTimeoutMs) || result.sinkTimeoutMs < 250 || result.sinkTimeoutMs > 180_000
    || !Number.isInteger(result.leaseMs) || result.leaseMs < 3000 || result.leaseMs > 300_000
    || result.leaseMs <= result.sinkTimeoutMs) {
    throw wakeError('WAKE_INVALID_RETRY_POLICY', 'retryPolicy values are outside their safe bounds.');
  }
  return result;
}

function makeDefaultClock() {
  return {
    now: () => Date.now(),
    sleep: (milliseconds, signal) => new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const timer = setTimeout(done, milliseconds);
      function done() { signal?.removeEventListener('abort', abort); resolve(); }
      function abort() { clearTimeout(timer); done(); }
      signal?.addEventListener('abort', abort, { once: true });
    }),
  };
}

function policyWindow(options, now) {
  const allowed = ['unit', 'unitId', 'nativeSessionId', 'client', 'machine', 'windowHours', 'extended', 'unlimited', 'manualConsent', 'maxHandoffs', 'maxDailyHandoffs'];
  const unknown = Object.keys(options).find((key) => !allowed.includes(key));
  if (unknown) throw wakeError('WAKE_INVALID_POLICY', `enable does not accept ${unknown}.`);
  const unlimited = options.unlimited === true;
  if (options.unlimited !== undefined && typeof options.unlimited !== 'boolean') throw wakeError('WAKE_INVALID_POLICY', 'unlimited must be a boolean.');
  if (unlimited && options.manualConsent !== true) throw wakeError('WAKE_MANUAL_CONSENT_REQUIRED', 'Unlimited wake requires an explicit manualConsent confirmation.');
  if (!unlimited && options.manualConsent === true) throw wakeError('WAKE_INVALID_POLICY', 'manualConsent is only valid with unlimited wake.');
  const extended = options.extended === true;
  if (options.extended !== undefined && typeof options.extended !== 'boolean') throw wakeError('WAKE_INVALID_POLICY', 'extended must be a boolean.');
  const hours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  if (ALLOWED_EXTENDED_HOURS.has(hours) && !extended) throw wakeError('WAKE_EXTENDED_CONSENT_REQUIRED', 'A 12- or 24-hour window requires extended:true.');
  if (!Number.isInteger(hours) || !(ALLOWED_STANDARD_HOURS.has(hours) || extended && ALLOWED_EXTENDED_HOURS.has(hours))) {
    throw wakeError('WAKE_INVALID_POLICY', 'Wake window must be 4–8 hours, or 12/24 hours with extended:true.');
  }
  const maxHandoffs = options.maxHandoffs ?? DEFAULT_WAKE_HANDOFFS;
  if (!Number.isInteger(maxHandoffs) || maxHandoffs < 1 || maxHandoffs > 100) throw wakeError('WAKE_INVALID_POLICY', 'maxHandoffs must be an integer from 1 to 100.');
  const maxDailyHandoffs = options.maxDailyHandoffs ?? DEFAULT_DAILY_HANDOFFS;
  if (!Number.isInteger(maxDailyHandoffs) || maxDailyHandoffs < 1 || maxDailyHandoffs > MAX_DAILY_HANDOFFS) {
    throw wakeError('WAKE_INVALID_POLICY', `maxDailyHandoffs must be an integer from 1 to ${MAX_DAILY_HANDOFFS}.`);
  }
  return { startedAt: iso(now), deadlineAt: unlimited ? null : iso(now + hours * 60 * 60 * 1000), durationHours: unlimited ? null : hours, extended, unlimited, maxHandoffs, maxDailyHandoffs };
}

const SAFE_ERROR_CODES = new Set([
  'WAKE_ERROR', 'WAKE_WORKER_ERROR', 'WAKE_STORE_BUSY', 'WAKE_STORE_LIMIT', 'WAKE_POLICY_INVALID',
  'WAKE_REGISTRATION_MISSING', 'WAKE_AMBIGUOUS_BINDING', 'INBOX_ERROR', 'MESSAGE_TOO_LARGE',
  'MALFORMED_MESSAGE', 'MALFORMED_RECORD', 'UNSAFE_PATH', 'UNSAFE_SYMLINK', 'NOT_FOUND', 'ENOENT', 'EPERM',
  'SINK_NOT_SUBMITTED', 'SINK_AMBIGUOUS', 'SINK_TIMEOUT',
]);

// The ends a restart can cure: a record that stayed busy, locked or cut short longer than the glitch bound.
const LAPSE_CODES = new Set(['WAKE_ERROR', 'WAKE_WORKER_ERROR', 'WAKE_STORE_BUSY', 'WAKE_POLICY_INVALID', 'MALFORMED_RECORD', 'UNSAFE_PATH', 'EPERM']);

function stableCode(value, fallback = 'WAKE_ERROR') { return SAFE_ERROR_CODES.has(value) ? value : fallback; }

// A read that fails the way a sync leaves a file: busy or locked, cut short, replaced while it was opened, or its lock still held.
function isFileGlitch(error) {
  return isTransientFsError(error) || ['MALFORMED_RECORD', 'WAKE_POLICY_INVALID', 'WAKE_STORE_BUSY'].includes(error?.code)
    || error?.code === 'UNSAFE_PATH' && /changed while it was being (?:opened|read)\./.test(error.message);
}

function stableSinkReason(status, reason) {
  if (reason === 'SINK_TIMEOUT') return reason;
  return status === 'not_submitted' ? 'SINK_NOT_SUBMITTED' : 'SINK_AMBIGUOUS';
}
function stableReasonCode(reason) {
  return ({ SINK_NOT_SUBMITTED: 'SINK_NOT_SUBMITTED', SINK_AMBIGUOUS: 'SINK_AMBIGUOUS', SINK_TIMEOUT: 'SINK_TIMEOUT' })[reason] ?? 'SINK_AMBIGUOUS';
}

function freshPolicy(policy, now) {
  return Boolean(policy?.enabled === true && (policy.runLeaseUntil > now || policy.unlimited === true || Number.isFinite(Date.parse(policy.deadlineAt)) && Date.parse(policy.deadlineAt) > now)
    && !policy.pausedReason);
}

// A bounded window that has run for a while starts again when its session shows activity; an unlimited one has no window.
function renewalDue(policy, now) {
  return freshPolicy(policy, now) && policy.unlimited !== true && now - Date.parse(policy.startedAt) >= RENEW_EVERY_MS;
}

function renewedWindow(policy, now) {
  if (!policy.consentWindows) return { startedAt: iso(now), deadlineAt: iso(now + policy.durationHours * 3600000) };
  const consentWindows = policy.consentWindows.map(window => ({ ...window, startedAt: iso(now),
    deadlineAt: window.unlimited ? null : iso(now + window.durationHours * 3600000) }));
  return { consentWindows, startedAt: iso(now), deadlineAt: consentWindows.filter(window => !window.unlimited)
    .reduce((at, window) => earlierTime(at, window.deadlineAt), null) };
}

function supersededPolicy(policy) { return policy?.enabled === false && policy.disabledReason === 'superseded'; }

function expectedPolicy(policy, binding, key) {
  return Boolean(policy?.kind === 'relay-wake-policy' && policy.version === 1 && policy.key === key
    && plainObject(policy.binding) && ['unit', 'nativeSessionId', 'client', 'machine'].every((field) => policy.binding[field] === binding[field])
    && (binding.unitId == null || policy.binding.unitId == null || policy.binding.unitId === binding.unitId));
}

function validStoredPolicy(policy, binding, key) {
  if (!expectedPolicy(policy, binding, key) || typeof policy.generation !== 'string' || !/^[a-f0-9-]{36}$/i.test(policy.generation)
    || typeof policy.enabled !== 'boolean' || !Number.isInteger(policy.wakeCount)
    || policy.wakeCount < 0 || !Number.isInteger(policy.maxHandoffs) || policy.maxHandoffs < 1 || policy.maxHandoffs > 100
    || policy.wakeCount > policy.maxHandoffs || !plainObject(policy.deliveries) || Object.keys(policy.deliveries).length > MAX_DELIVERIES
    || typeof policy.unlimited !== 'boolean' || typeof policy.extended !== 'boolean' || typeof policy.manualConsent !== 'boolean'
    || !Number.isInteger(policy.consecutiveErrors) || policy.consecutiveErrors < 0 || policy.consecutiveErrors > 5
    || policy.pausedReason !== null && !['handoff-budget-exhausted', 'dedupe-budget-exhausted', 'error-budget-exhausted'].includes(policy.pausedReason)
    || policy.worker !== undefined && (!plainObject(policy.worker) || !['running', 'stopped'].includes(policy.worker.state) || !Number.isFinite(Date.parse(policy.worker.heartbeatAt)))
    || !plainObject(policy.activity) || ![null, 'busy', 'idle'].includes(policy.activity.value)
    || policy.activity.observedAt !== null && !Number.isFinite(Date.parse(policy.activity.observedAt))
    || policy.lastError !== null && (!plainObject(policy.lastError) || !SAFE_ERROR_CODES.has(policy.lastError.code) || !Number.isFinite(Date.parse(policy.lastError.at)))
    || policy.maxDailyHandoffs !== undefined && (!Number.isInteger(policy.maxDailyHandoffs) || policy.maxDailyHandoffs < 1 || policy.maxDailyHandoffs > MAX_DAILY_HANDOFFS)
    || policy.day !== undefined && (!plainObject(policy.day) || !/^\d{4}-\d{2}-\d{2}$/.test(String(policy.day.date))
      || !Number.isInteger(policy.day.count) || policy.day.count < 0)) return false;
  if (policy.enabled) {
    if (policy.consentWindows !== undefined) {
      if (!Array.isArray(policy.consentWindows) || !policy.consentWindows.length || policy.consentWindows.length > 1024
        || !policy.consentWindows.every(validWindow)) return false;
      const startedAt = policy.consentWindows.reduce((at, window) => earlierTime(at, window.startedAt), null);
      const finite = policy.consentWindows.filter(window => !window.unlimited);
      const deadlineAt = finite.reduce((at, window) => earlierTime(at, window.deadlineAt), null);
      if (policy.startedAt !== startedAt || policy.deadlineAt !== deadlineAt
        || policy.unlimited !== policy.consentWindows.every(window => window.unlimited)
        || policy.manualConsent !== policy.unlimited
        || policy.durationHours !== (policy.unlimited ? null : finite[0].durationHours)
        || policy.extended !== (policy.unlimited ? policy.consentWindows.every(window => window.extended) : finite[0].extended)) return false;
    } else {
      if (!validWindow(policy)) return false;
    }
  }
  for (const entry of Object.values(policy.deliveries)) {
      if (!plainObject(entry) || !['attempting', 'submitted', 'ambiguous', 'not_submitted', 'failed'].includes(entry.state)
        || !Number.isInteger(entry.attempts) || entry.attempts < 1 || entry.attempts > 5) return false;
      if (['submitted', 'ambiguous', 'not_submitted', 'failed'].includes(entry.state) && !Number.isFinite(Date.parse(entry.lastAttemptAt))) return false;
      if (entry.reason !== undefined && !['SINK_NOT_SUBMITTED', 'SINK_AMBIGUOUS', 'SINK_TIMEOUT', 'worker-restarted-during-submit'].includes(entry.reason)) return false;
  }
  return true;
}

async function waitBounded(promise, timeoutMs, signal, sinkController) {
  if (signal?.aborted) return { status: 'cancelled' };
  let timer;
  let abortListener;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { sinkController.abort(); resolve({ status: 'ambiguous', reason: 'SINK_TIMEOUT' }); }, timeoutMs); });
  const cancelled = new Promise((resolve) => {
    abortListener = () => resolve({ status: 'ambiguous', reason: 'cancelled-during-sink' });
    signal?.addEventListener('abort', abortListener, { once: true });
  });
  try { return await Promise.race([promise, timeout, cancelled]); }
  catch { return { status: 'ambiguous', reason: 'sink-error' }; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abortListener); }
}

export async function createRelayWakeController(options = {}) {
  if (!plainObject(options)) throw wakeError('WAKE_INVALID_OPTIONS', 'Wake controller options must be an object.');
  const allowed = ['mindPath', 'hostname', 'clock', 'sink', 'pollIntervalMs', 'retryPolicy', 'adapters'];
  const unknown = Object.keys(options).find((key) => !allowed.includes(key));
  if (unknown) throw wakeError('WAKE_INVALID_OPTIONS', `Wake controller does not accept ${unknown}.`);
  if (typeof options.mindPath !== 'string' || !options.mindPath.trim()) throw wakeError('WAKE_INVALID_OPTIONS', 'mindPath is required.');
  if (typeof options.sink !== 'function') throw wakeError('WAKE_SINK_REQUIRED', 'Wake controller requires an injected native sink.');
  const adapters = options.adapters ?? WAKE_ADAPTERS;
  if (!plainObject(adapters)) throw wakeError('WAKE_INVALID_OPTIONS', 'adapters must be a wake adapter table.');
  const hostname = String(options.hostname ?? os.hostname()).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(hostname) || hostname.endsWith('.')) throw wakeError('WAKE_INVALID_OPTIONS', 'hostname must be a path-safe local machine name.');
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 5000) throw wakeError('WAKE_INVALID_OPTIONS', 'pollIntervalMs must be between 250 and 5000 ms.');
  const retry = parseRetryPolicy(options.retryPolicy);
  if (retry.leaseMs <= LEASE_RENEW_MS + retry.sinkTimeoutMs) throw wakeError('WAKE_INVALID_RETRY_POLICY', 'leaseMs must exceed the 5 second renewal interval plus sinkTimeoutMs.');
  const clock = options.clock ?? makeDefaultClock();
  if (typeof clock?.now !== 'function' || typeof clock?.sleep !== 'function') throw wakeError('WAKE_INVALID_CLOCK', 'clock requires now() and sleep(ms, signal).');
  const persistence = await createRelayWakePersistence({ mindPath: options.mindPath, hostname });
  const workers = new Map();
  const starting = new Set();
  // The workers that ended because a file stayed unreadable, not because they were stopped, their consent ended or their chat's
  // registration is gone for good; the service starts them again. A registration missing past the glitch bound is a closed chat.
  const lapses = new Map();
  function noteEnd(binding, reason) {
    if (LAPSE_CODES.has(reason)) lapses.set(bindingHash(binding), binding);
    else lapses.delete(bindingHash(binding));
  }
  function lapsedWorkers() { return [...lapses.values()]; }
  async function bindingInbox(binding) {
    const registration = await registered(binding);
    const scoped = await createRelay({ mindPath: options.mindPath, hostname, scopeLock: true, pinnedRegistration: registration });
    return scoped.inbox({ limit: MAX_INBOX_MESSAGES });
  }

  function makeBinding(value, options) { return normalizeBinding(value, hostname, options); }
  function withSourceBudget(binding, operation) {
    const key = createHash('sha256').update(JSON.stringify([binding.unitId ?? binding.unit, binding.client, binding.machine])).digest('hex');
    return persistence.withLock(`actor-submit-${key}`, operation);
  }
  async function registered(binding) {
    const current = await persistence.resolveBinding(binding);
    if (!current) throw wakeError('WAKE_REGISTRATION_MISSING', 'No current Relay registration matches this exact wake binding.');
    return current;
  }
  async function canonicalBinding(binding) {
    if (binding.unitId) return binding;
    if (binding.machine === hostname) {
      const registration = await persistence.resolveBinding(binding);
      if (registration) return makeBinding({ ...binding, unitId: registration.unitId });
    }
    const legacy = await persistence.read('policies', legacyHash(binding));
    if (legacy?.binding?.unitId && expectedPolicy(legacy, binding, legacyHash(binding))) {
      return makeBinding({ ...binding, unitId: legacy.binding.unitId }, { remote: true });
    }
    const matches = (await persistence.list('policies')).filter(({ value }) => expectedPolicy(value, binding, value.key) && value.binding.unitId);
    const ids = new Set(matches.map(({ value }) => value.binding.unitId));
    if (ids.size > 1) throw wakeError('WAKE_AMBIGUOUS_BINDING', 'The legacy wake binding names more than one canonical unit.');
    return ids.size ? makeBinding({ ...binding, unitId: [...ids][0] }, { remote: true }) : binding;
  }
  function aliasKeys(binding) { return [...new Set([bindingHash(binding), legacyHash(binding)])].sort(); }
  function withAliasLocks(binding, prefix, operation) {
    const keys = aliasKeys(binding);
    const lock = index => index === keys.length ? operation() : persistence.withLock(`${prefix}-${keys[index]}`, () => lock(index + 1));
    return lock(0);
  }
  async function readAlias(binding, key, legacy = false) {
    const record = await persistence.read('policies', key);
    if (record === null) return null;
    if (legacy && record.binding?.unitId && binding.unitId && record.binding.unitId !== binding.unitId) return null;
    if (!validStoredPolicy(record, binding, key)) throw wakeError('WAKE_POLICY_INVALID', 'The stored wake policy is malformed or does not match its binding.');
    return record;
  }
  async function readAliases(binding, key) {
    const canonical = await readAlias(binding, key);
    const oldKey = legacyHash(binding);
    const legacy = oldKey === key ? null : await readAlias(binding, oldKey, true);
    let merged = mergeAliases(canonical, legacy, binding, key);
    const leases = binding.machine === hostname ? await persistence.read('run-leases', key) : null;
    const until = Math.max(0, ...Object.values(leases?.runs ?? {}).map(run => run.expiresAt));
    if (!merged && until > nowMs(clock)) merged = await persistence.read('run-policies', key);
    if (merged && until > nowMs(clock)) merged = { ...merged, runLeaseUntil: until };
    if (merged && binding.unitId) {
      const sources = (await persistence.list('run-policies')).map(item => item.value).filter(policy => policy.kind === 'relay-run-wake'
        && policy.binding.unitId === binding.unitId && policy.binding.client === binding.client && policy.binding.machine === binding.machine);
      const used = sources.sort((a,b) => dayCount(b, nowMs(clock)) - dayCount(a, nowMs(clock)))[0];
      if (used && dayCount(used, nowMs(clock)) > dayCount(merged, nowMs(clock))) merged = { ...merged, day: used.day };
    }
    return { canonical, legacy, merged };
  }
  async function readPolicy(binding, key) { return (await readAliases(binding, key)).merged; }
  async function writeAliases(binding, key, next, legacy) {
    const { runLeaseUntil, ...stored } = next;
    const ordinary = await persistence.read('policies', key);
    if (!ordinary && await persistence.read('run-policies', key)) { await persistence.write('run-policies', key, stored); return; }
    await persistence.write('policies', key, stored);
    if (legacy) await persistence.write('policies', legacyHash(binding), { ...stored, key: legacyHash(binding) });
  }
  async function adopt(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    const key = bindingHash(binding);
    return withAliasLocks(binding, 'policy', async () => {
      const { canonical, legacy, merged } = await readAliases(binding, key);
      if (merged && (JSON.stringify(canonical) !== JSON.stringify(merged) || legacy && JSON.stringify({ ...legacy, key }) !== JSON.stringify(merged))) {
        await writeAliases(binding, key, merged, legacy);
      }
      return merged;
    });
  }
  async function mutatePolicy(binding, key, update) {
    return withAliasLocks(binding, 'policy', async () => {
      const { legacy, merged } = await readAliases(binding, key);
      const next = await update(merged);
      if (next == null) return next;
      await writeAliases(binding, key, next, legacy);
      return next;
    });
  }
  async function readWorker(key) { return persistence.read('workers', key); }
  async function mutateWorker(key, update) {
    return persistence.withLock(`worker-${key}`, async () => {
      const current = await readWorker(key);
      const next = await update(current);
      if (next === null) await persistence.remove('workers', key);
      else await persistence.write('workers', key, next);
      return next;
    });
  }
  function activityFor(policy, registration, now) {
    const wake = activityObservation(policy?.activity?.value, policy?.activity?.observedAt, now);
    if (wake.value) return wake;
    return activityObservation(registration?.activity, registration?.activityObservedAt, now);
  }
  async function inspect(binding) {
    binding = await canonicalBinding(binding);
    const key = bindingHash(binding);
    const policy = await readPolicy(binding, key);
    let registration = null;
    try { registration = await persistence.resolveBinding(binding); }
    catch (error) { if (error.code !== 'WAKE_AMBIGUOUS_BINDING') throw error; }
    const now = nowMs(clock);
    // A lease is a process id, so it can be checked only where the worker runs; for another machine the policy's own liveness note is all there is.
    const local = binding.machine === hostname;
    let worker = local ? await readWorker(key) : null;
    if (local && key !== legacyHash(binding) && (!worker || worker.expiresAt <= now)) {
      worker = await readWorker(legacyHash(binding)) ?? worker;
    }
    const note = policy?.worker;
    const deliveries = policy?.deliveries ?? {};
    const entries = Object.values(deliveries);
    const workerRunning = local && Boolean(worker && worker.expiresAt > now && await isProcessAlive(worker.pid));
    const windowExpired = policy && !(policy.runLeaseUntil > now) && !policy.unlimited && Date.parse(policy.deadlineAt) <= now;
    const workerState = local
      ? workerRunning ? 'running' : !policy || policy.enabled !== true ? 'disabled' : windowExpired ? 'expired' : worker ? 'stale' : 'idle'
      : !policy || policy.enabled !== true ? 'disabled' : windowExpired ? 'expired'
        : note?.state === 'running' ? now - Date.parse(note.heartbeatAt) <= WORKER_NOTE_STALE_MS ? 'running' : 'stale' : 'idle';
    return {
      binding,
      enabled: freshPolicy(policy, now),
      runLeaseUntil: policy?.runLeaseUntil ?? null,
      startedAt: policy?.startedAt ?? null,
      deadlineAt: policy?.deadlineAt ?? null,
      durationHours: policy?.durationHours ?? null,
      extended: policy?.extended === true,
      unlimited: policy?.unlimited === true,
      registered: local ? Boolean(registration) : null,
      activity: activityFor(policy, registration, now),
      worker: { state: workerState, leaseUntil: workerRunning ? worker.expiresAt : null, heartbeatAt: (local ? worker?.heartbeatAt : note?.heartbeatAt) ?? null },
      pendingCount: entries.filter((entry) => entry.state === 'not_submitted').length,
      submittedCount: entries.filter((entry) => entry.state === 'submitted').length,
      ambiguousCount: entries.filter((entry) => entry.state === 'ambiguous' || entry.state === 'attempting').length,
      wakeCount: policy?.wakeCount ?? 0,
      wakeBudget: policy?.maxHandoffs ?? DEFAULT_WAKE_HANDOFFS,
      dailyCount: dayCount(policy, now),
      dailyBudget: dailyCap(policy),
      // The daily cap holds wakes back until the next local midnight without pausing the consent.
      dailyResumesAt: policy && dayCapped(policy, now) ? iso(nextLocalMidnight(now)) : null,
      pausedReason: policy?.pausedReason ?? (windowExpired ? 'expired' : null),
      lastError: policy?.lastError ?? null,
    };
  }
  async function disablePolicy(binding, reason = 'manual', { wait = true } = {}) {
    const key = bindingHash(binding);
    const now = nowMs(clock);
    const policy = await mutatePolicy(binding, key, async (current) => {
      if (!current) return {
        kind: 'relay-wake-policy', version: 1, key, binding, enabled: false,
        startedAt: null, deadlineAt: null, durationHours: null, extended: false, unlimited: false,
        generation: randomUUID(), deliveries: {}, wakeCount: 0, maxHandoffs: DEFAULT_WAKE_HANDOFFS, manualConsent: false,
        activity: { value: null, observedAt: null }, disabledAt: iso(now), disabledReason: reason,
        pausedReason: null, lastError: null, consecutiveErrors: 0,
      };
      return { ...current, enabled: false, disabledAt: iso(now), disabledReason: reason };
    });
    const worker = workers.get(key);
    if (worker) {
      const stopped = worker.stop(reason);
      // A worker that hands its own consent over cannot wait for itself to end.
      if (wait) await stopped;
    }
    return policy;
  }

  async function enable(args = {}) {
    if (!plainObject(args)) throw wakeError('WAKE_INVALID_POLICY', 'enable expects a policy object.');
    const requested = makeBinding({ unit: args.unit, ...(args.unitId ? { unitId: args.unitId } : {}), nativeSessionId: args.nativeSessionId, client: args.client, machine: args.machine });
    const registration = await registered(requested);
    const binding = makeBinding({ ...requested, unitId: registration.unitId });
    const window = policyWindow(args, nowMs(clock));
    const key = bindingHash(binding);
    const policy = {
      kind: 'relay-wake-policy', version: 1, key, binding,
      generation: randomUUID(),
      enabled: true, ...window,
      manualConsent: args.unlimited === true && args.manualConsent === true,
      registrationId: registration.registrationId,
      disabledAt: null, disabledReason: null, pausedReason: null,
      activity: { value: null, observedAt: null }, wakeCount: 0,
      retryAt: null, cooldownUntil: null, lastError: null, consecutiveErrors: 0,
    };
    // The day's count of the unit's consents on this machine carries over, so neither a new attach nor a consent that moves to
    // another session of the unit starts the daily cap again.
    const today = localDate(nowMs(clock));
    let day = null;
    let others = [];
    try { others = await persistence.list('policies'); } catch { /* the consent's own earlier count still carries */ }
    for (const { value } of others) {
      const other = value?.binding;
      if (value?.kind === 'relay-wake-policy' && plainObject(other) && other.machine === binding.machine && other.client === binding.client
        && (other.unitId ? other.unitId === binding.unitId : String(other.unit).toLowerCase() === binding.unit.toLowerCase()
          && (await canonicalBinding(makeBinding(other))).unitId === binding.unitId) && dayCount(value, nowMs(clock)) > (day?.count ?? 0)) day = { ...value.day, date: today, count: dayCount(value, nowMs(clock)) };
    }
    // A new consent renews the window and budgets, not the right to point at a message again; only a pointer that never reached the host may be retried.
    await mutatePolicy(binding, key, async (previous) => {
      const carried = dayCount(previous, nowMs(clock)) > (day?.count ?? 0) ? { ...previous.day, date: today, count: dayCount(previous, nowMs(clock)) } : day;
      const interrupted = Object.values(previous?.deliveries ?? {}).some(entry => entry.state === 'attempting');
      return { ...policy, ...(carried ? { day: carried } : {}),
        ...(interrupted ? { day: countedDay({ day: carried }, nowMs(clock), 1) } : {}), deliveries: Object.fromEntries(
        Object.entries(previous?.deliveries ?? {}).filter(([, entry]) => ['submitted', 'ambiguous', 'attempting'].includes(entry.state))
          .map(([id, entry]) => [id, entry.state === 'attempting'
            ? { ...entry, state: 'ambiguous', ambiguousAt: iso(nowMs(clock)), reason: 'worker-restarted-during-submit' } : entry])) };
    });
    const worker = workers.get(key);
    if (worker && worker.generation !== policy.generation) await worker.stop('policy-replaced');
    return inspect(binding);
  }

  async function disable(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    await disablePolicy(binding, 'manual');
    return inspect(binding);
  }

  async function takeOver(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    await registered(binding);
    const newest = await persistence.latestUnitRegistration({ unit: binding.unit, unitId: binding.unitId, client: binding.client, machine: binding.machine });
    if (!newest || newest.nativeSessionId !== binding.nativeSessionId) return null;
    const lock = createHash('sha256').update(JSON.stringify([binding.unitId, binding.client, binding.machine])).digest('hex');
    const moved = await persistence.withLock(`takeover-${lock}`, async () => {
      const now = nowMs(clock), key = bindingHash(binding);
      const current = await readPolicy(binding, key);
      // The consent this session lost to a newer one comes back when the session registers again and is the newest.
      const lost = supersededPolicy(current);
      if (current && !lost && !freshPolicy(current, now)) return null;
      const earlier = new Map();
      for (const { value } of await persistence.list('policies')) {
        if (value?.kind !== 'relay-wake-policy' || value.binding?.machine !== hostname || value.binding.client !== binding.client
          || value.binding.nativeSessionId === binding.nativeSessionId) continue;
        const other = await canonicalBinding(makeBinding(value.binding));
        if (other.unitId !== binding.unitId) continue;
        if (!await persistence.resolveBinding(other)) continue;
        const policy = await readPolicy(other, bindingHash(other));
        if (policy?.runLeaseUntil > now) continue;
        if (freshPolicy(policy, now) && policy.wakeCount < policy.maxHandoffs) earlier.set(bindingHash(other), { policy, binding: other });
      }
      if (!earlier.size) return null;
      let transferred = lost ? null : current;
      for (const { policy } of earlier.values()) {
        const next = { ...policy, binding, key, generation: lost ? randomUUID() : current?.generation ?? randomUUID() };
        transferred = mergeAliases(transferred, next, binding, key);
      }
      for (const { binding: other } of earlier.values()) workers.get(bindingHash(other))?.stop('superseded');
      await mutatePolicy(binding, key, previous => supersededPolicy(previous) ? transferred : mergeAliases(previous, transferred, binding, key));
      for (const { binding: other } of earlier.values()) await disablePolicy(other, 'superseded', { wait: false });
      return inspect(binding);
    });
    // A worker follows the consent, so the session that now holds it is served without waiting for its own attach.
    if (moved) start(binding);
    return moved;
  }

  async function resume(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    await registered(binding);
    const key = bindingHash(binding);
    await mutatePolicy(binding, key, policy => policy?.enabled === true && policy.pausedReason === 'error-budget-exhausted'
      && (policy.unlimited || Date.parse(policy.deadlineAt) > nowMs(clock))
      ? { ...policy, generation: randomUUID(), pausedReason: null, consecutiveErrors: 0, lastError: null } : policy);
    return inspect(binding);
  }

  async function observeActivity(bindingValue, args = {}) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    if (!plainObject(args) || Object.keys(args).some((key) => key !== 'activity')) throw wakeError('WAKE_INVALID_ACTIVITY', 'observeActivity expects only activity.');
    const activity = args.activity;
    if (!['busy', 'idle'].includes(activity)) throw wakeError('WAKE_INVALID_ACTIVITY', 'activity must be busy or idle.');
    await registered(binding);
    const key = bindingHash(binding);
    const now = nowMs(clock);
    // Every tool call of a turn repeats the mark the turn already set. The write takes the policy lock and replaces a file of the synced mind, so a mark that is still the same and recent is left alone.
    const stored = await readPolicy(binding, key);
    const age = now - Date.parse(stored?.activity?.observedAt);
    if (freshPolicy(stored, now) && stored.activity.value === activity && age >= 0 && age < ACTIVITY_REFRESH_MS && !renewalDue(stored, now)
      && !(stored.wakeCount > 0)) return stored.activity;
    const next = await mutatePolicy(binding, key, async (policy) => {
      if (!freshPolicy(policy, now)) throw wakeError('WAKE_NOT_ENABLED', 'Activity can be observed only for an enabled, unexpired wake policy.');
      // A turn is activity of the session, so it also starts the window again and answers the wakes so far.
      return { ...policy, ...(renewalDue(policy, now) ? renewedWindow(policy, now) : {}), ...(policy.wakeCount > 0 ? { wakeCount: 0 } : {}),
        activity: { value: activity, observedAt: iso(now) } };
    });
    return next.activity;
  }

  // The command that gives a chat its wake again, with the window and the budget of the consent that ended.
  function attachCommand(binding, policy) {
    const flags = [];
    if (!policy.unlimited && policy.durationHours !== DEFAULT_WINDOW_HOURS) flags.push(`--hours ${policy.durationHours}`, ...(policy.extended ? ['--extended'] : []));
    if (policy.maxHandoffs !== DEFAULT_WAKE_HANDOFFS) flags.push(`--max-handoffs ${policy.maxHandoffs}`);
    if (dailyCap(policy) !== DEFAULT_DAILY_HANDOFFS) flags.push(`--max-daily-handoffs ${dailyCap(policy)}`);
    return `node "${CLI_PATH}" relay wake attach --mind-path "${options.mindPath}" --client ${binding.client} --unit ${binding.unit} `
      + `--native-session-id ${binding.nativeSessionId}${flags.map((flag) => ` ${flag}`).join('')}`;
  }

  // Activity of the session keeps its consent: a Relay tool call or a hook turn of the session starts its bounded window
  // again and answers the wakes so far, so the handoff budget counts only wakes the chat has not answered. A window that
  // passed, or a budget spent, without any activity ends the wake, and the first call after it is told once, with how to
  // renew it.
  async function touch(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    await registered(binding);
    const key = bindingHash(binding);
    const now = nowMs(clock);
    const quiet = { renewed: false, notice: null };
    let stored;
    try { stored = await readPolicy(binding, key); }
    catch (error) { if (error?.code === 'MALFORMED_RECORD' || isTransientFsError(error)) return quiet; throw error; }
    if (stored?.enabled !== true) return quiet;
    if (stored.pausedReason === 'handoff-budget-exhausted' || stored.pausedReason === 'dedupe-budget-exhausted') {
      if (stored.budgetNoticeAt) return quiet;
      let claimed = false;
      const told = await mutatePolicy(binding, key, async (policy) => {
        if (policy?.enabled !== true || policy.pausedReason !== stored.pausedReason || policy.budgetNoticeAt || policy.generation !== stored.generation) return policy;
        claimed = true;
        return { ...policy, budgetNoticeAt: iso(now) };
      });
      if (!claimed) return quiet;
      return {
        renewed: false,
        notice: (stored.pausedReason === 'dedupe-budget-exhausted'
          ? `Relay wake for ${binding.unit} stopped because ${MAX_DELIVERIES} messages it already pointed to are still unread, the most it keeps track of, so new messages no longer wake it. Read them first. `
          : `Relay wake for ${binding.unit} stopped after ${told.wakeCount} wakes that this chat did not answer with any Relay activity, the most its consent allows, so new messages no longer wake it. `)
          + `To wake it again, run from this chat's own shell: ${attachCommand(binding, told)}`,
      };
    }
    if (stored.unlimited === true || Date.parse(stored.deadlineAt) > now) {
      // The daily cap is not lifted by activity; the chat is told once that it holds wakes back until the next day.
      const untold = (policy, at) => dayCapped(policy, at) && !policy.day.noticeAt;
      const due = (policy, at) => freshPolicy(policy, at) && (renewalDue(policy, at) || policy.wakeCount > 0 || untold(policy, at));
      if (!due(stored, now)) return quiet;
      let claimed = false;
      const next = await mutatePolicy(binding, key, async (policy) => {
        if (!due(policy, nowMs(clock)) || policy.generation !== stored.generation) return policy;
        claimed = untold(policy, now);
        return { ...policy, ...(renewalDue(policy, now) ? renewedWindow(policy, now) : {}), wakeCount: 0,
          ...(claimed ? { day: { ...policy.day, noticeAt: iso(now) } } : {}) };
      });
      if (!claimed) return { renewed: next.startedAt === iso(now), notice: null };
      return {
        renewed: next.startedAt === iso(now),
        notice: `Relay wake for ${binding.unit} reached its limit of ${dailyCap(next)} wakes for ${next.day.date}, so new messages do not wake this chat until ${iso(nextLocalMidnight(now))}, `
          + 'midnight on this machine, when it resumes by itself. Activity of the chat and a new attach do not lift the limit before then.',
      };
    }
    if (stored.endNoticeAt) return quiet;
    let claimed = false;
    const told = await mutatePolicy(binding, key, async (policy) => {
      if (policy?.enabled !== true || policy.unlimited === true || policy.endNoticeAt
        || policy.generation !== stored.generation || Date.parse(policy.deadlineAt) > nowMs(clock)) return policy;
      claimed = true;
      return { ...policy, endNoticeAt: iso(now) };
    });
    if (!claimed) return quiet;
    return {
      renewed: false,
      notice: `Relay wake for ${binding.unit} ended at ${told.deadlineAt}: its ${told.durationHours}-hour window passed without activity of this chat, so new messages no longer wake it. `
        + `To renew it, run from this chat's own shell: ${attachCommand(binding, told)}`,
    };
  }

  async function endSession(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    // Revocation intentionally does not depend on a still-live registration.
    await disablePolicy(binding, 'revoked');
    return inspect(binding);
  }

  async function status(bindingValue) { return inspect(makeBinding(bindingValue, { remote: true })); }

  // Reserve a hook handoff under the same locks and policy budget as workers.
  // A live wake worker owns delivery; an editor stop hook must not compete with it.
  async function cursorStop(bindingValue, { loopCount, generationId } = {}) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    const stopLoopLimit = getWakeAdapter(binding.client, adapters)?.stopLoopLimit;
    if (!stopLoopLimit || !Number.isInteger(loopCount) || loopCount < 0 || loopCount >= stopLoopLimit) return null;
    if (generationId !== undefined && (typeof generationId !== 'string' || !generationId.length
        || generationId.length > 180 || /[\u0000-\u001f\u007f]/.test(generationId))) return null;
    const key = bindingHash(binding);
    return withSourceBudget(binding, () => withAliasLocks(binding, 'worker', async () => {
      const worker = await readWorker(key);
      if (worker && worker.expiresAt > nowMs(clock) && await isProcessAlive(worker.pid)) return null;
      const oldWorker = key === legacyHash(binding) ? null : await readWorker(legacyHash(binding));
      if (oldWorker && oldWorker.expiresAt > nowMs(clock) && await isProcessAlive(oldWorker.pid)) return null;
      return withAliasLocks(binding, 'policy', async () => {
        const policy = await readPolicy(binding, key);
        const now = nowMs(clock);
        if (!freshPolicy(policy, now) || policy.wakeCount >= policy.maxHandoffs || dayCapped(policy, now)) return null;
        const registration = await persistence.resolveBinding(binding);
        // The consent names the unit and the native session id; a chat that registers again gets a new record id.
        if (!registration) return null;
        if (generationId && policy.cursorStop?.generationId === generationId && policy.cursorStop.loopCount === loopCount) return null;
        const { messages } = await bindingInbox(binding);
        if (!messages.length || !freshPolicy(policy, nowMs(clock))) return null;
        const deliveries = { ...policy.deliveries };
        for (const message of messages) deliveries[message.id] = { state: 'submitted', attempts: 1,
          lastAttemptAt: iso(now), submittedAt: iso(now), threadId: message.threadId ?? null, priority: message.priority };
        if (Object.keys(deliveries).length > MAX_DELIVERIES) return null;
        const aliases = await readAliases(binding, key);
        await writeAliases(binding, key, { ...policy, deliveries, wakeCount: policy.wakeCount + 1, day: countedDay(policy, now, 1),
          cursorStop: { generationId: generationId ?? null, loopCount }, activity: { value: 'idle', observedAt: iso(now) } }, aliases.legacy);
        return wakePointer(binding.unit, messages);
      });
    }));
  }

  async function findEnabledBinding(args = {}) {
    if (!plainObject(args) || Object.keys(args).some((key) => !['nativeSessionId', 'client', 'machine'].includes(key))) {
      throw wakeError('WAKE_INVALID_BINDING', 'findEnabledBinding requires nativeSessionId, client and machine only.');
    }
    const nativeSessionId = safeScalar(args.nativeSessionId, 'nativeSessionId');
    const client = safeScalar(args.client, 'client', 80);
    const machine = args.machine === undefined ? hostname : safeScalar(args.machine, 'machine', 48);
    if (machine !== hostname) throw wakeError('WAKE_WRONG_MACHINE', 'A wake controller cannot resolve a different machine.');
    // The newest registration of the session names its unit, and the policy of that unit sits under a key computed from the binding, so no other policy is read.
    const registration = await persistence.latestRegistration({ nativeSessionId, client, machine });
    if (!registration) return null;
    const binding = makeBinding({ unit: registration.unit, unitId: registration.unitId, nativeSessionId, client, machine });
    const key = bindingHash(binding);
    let policy;
    // A record that OneDrive is still syncing, or one that is cut short, is skipped as unreadable instead of failing the hook.
    try { policy = await readPolicy(binding, key); }
    catch (error) { if (['MALFORMED_RECORD', 'WAKE_POLICY_INVALID'].includes(error?.code) || isTransientFsError(error)) return null; throw error; }
    return policy?.enabled === true && expectedPolicy(policy, binding, key) && freshPolicy(policy, nowMs(clock)) ? binding : null;
  }

  // The enabled policies of this machine and whether a worker holds each one, so a diagnosis can name a consent nobody serves.
  async function workerStates() {
    const now = nowMs(clock);
    const states = [];
    const seen = new Set();
    for (const { value: policy } of await persistence.list('policies')) {
      if (policy?.kind !== 'relay-wake-policy' || policy.enabled !== true || !policy.binding
        || policy.binding.machine !== hostname || !freshPolicy(policy, now)) continue;
      try {
        const binding = await canonicalBinding(makeBinding(policy.binding));
        const key = bindingHash(binding);
        if (seen.has(key)) continue;
        seen.add(key);
        const state = await inspect(binding);
        if (state.enabled) states.push({ binding, worker: state.worker.state });
      } catch { /* a malformed policy is reported by status, not by the overview */ }
    }
    return states;
  }

  async function stop(bindingValue) {
    const binding = await canonicalBinding(makeBinding(bindingValue));
    lapses.delete(bindingHash(binding));
    const worker = workers.get(bindingHash(binding));
    const pending = [...starting].filter(handle => legacyHash(handle.binding) === legacyHash(binding)
      && (!handle.binding.unitId || !binding.unitId || handle.binding.unitId === binding.unitId));
    if (!worker && !pending.length) return { stopped: false, reason: 'not-running' };
    await Promise.all([worker?.stop('stopped'), ...pending.map(handle => handle.stop('stopped'))]);
    return { stopped: true, reason: 'stopped' };
  }

  async function stopAll() {
    lapses.clear();
    const running = [...workers.values()];
    await Promise.all([...starting].map(handle => handle.stop('stopped')));
    await Promise.all(running.map((worker) => worker.stop('stopped')));
    return { stopped: running.length };
  }

  function start(bindingValue) {
    const requested = makeBinding(bindingValue);
    let delegate = null;
    let stopReason = null;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const pending = {
      ready, done: null, binding: requested,
      stop(reason = 'stopped') { stopReason ??= reason; delegate?.stop(reason); return pending.done; },
    };
    pending.done = (async () => {
      try {
        const binding = await canonicalBinding(requested);
        await adopt(binding);
        if (stopReason) { resolveReady({ state: stopReason, ownsLease: false }); return { reason: stopReason }; }
        delegate = startCanonical(binding);
        resolveReady(await delegate.ready);
        return await delegate.done;
      } catch (error) {
        const code = stableCode(error?.code, 'WAKE_WORKER_ERROR');
        resolveReady({ state: 'error', ownsLease: false, code });
        noteEnd(requested, code);
        return { reason: code };
      } finally { starting.delete(pending); }
    })();
    starting.add(pending);
    return pending;
  }

  function startCanonical(binding) {
    const key = bindingHash(binding);
    const existing = workers.get(key);
    if (existing) return existing.handle;
    const controller = new AbortController();
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    let stopReason = null;
    const ownerId = randomUUID();
    let activeGeneration = null;
    let leasedAt = 0;
    let notedAt = null;
    let noteTried = false;
    let checkedAt = null;
    const handle = {
      stop: (reason = 'stopped') => {
        stopReason ??= reason;
        controller.abort();
        return done;
      },
      ready,
      done,
    };
    const worker = { handle, stop: handle.stop, controller, ownerId, done, resolveDone, generation: null };
    workers.set(key, worker);

    async function leaseAcquire() {
      return withAliasLocks(binding, 'worker', async () => {
        const oldWorker = key === legacyHash(binding) ? null : await readWorker(legacyHash(binding));
        const now = nowMs(clock);
        if (oldWorker && oldWorker.expiresAt > now && await isProcessAlive(oldWorker.pid)) return oldWorker;
        const current = await readWorker(key);
        if (current && current.ownerId !== ownerId && current.expiresAt > now && await isProcessAlive(current.pid)) return current;
        const next = { kind: 'relay-wake-worker', key, ownerId, pid: process.pid, machine: hostname, generation: activeGeneration, heartbeatAt: iso(now), expiresAt: now + retry.leaseMs };
        await persistence.write('workers', key, next);
        return next;
      });
    }
    async function leaseRenew() {
      return mutateWorker(key, async (current) => {
        if (current?.ownerId !== ownerId || current.pid !== process.pid) return current;
        const now = nowMs(clock);
        return { ...current, heartbeatAt: iso(now), expiresAt: now + retry.leaseMs };
      });
    }
    async function leaseRelease() {
      await mutateWorker(key, async (current) => current?.ownerId === ownerId ? null : current).catch(() => {});
    }
    async function noteWorker(state) {
      await mutatePolicy(binding, key, async (policy) => policy?.generation === activeGeneration
        ? { ...policy, worker: { state, heartbeatAt: iso(nowMs(clock)) } } : policy);
    }
    async function recordError(code, generation) {
      return mutatePolicy(binding, key, async (policy) => policy && policy.generation === generation ? {
        ...policy, lastError: { code: stableCode(code), at: iso(nowMs(clock)) },
        consecutiveErrors: (policy.consecutiveErrors ?? 0) + 1,
      } : policy);
    }
    // A chat of the unit that registered under another native session after this one replaced it: the consent moves to the
    // newest registration, whose own worker wakes it, and this worker ends instead of waking a session that is gone.
    async function superseded(registration) {
      if ((await readPolicy(binding, key))?.runLeaseUntil > nowMs(clock)) return false;
      const newest = await persistence.latestUnitRegistration({ unit: binding.unit, unitId: binding.unitId, client: binding.client, machine: binding.machine });
      if (!newest || newest.nativeSessionId === binding.nativeSessionId || newest.registeredAt <= registration.registeredAt) return false;
      try {
        return Boolean(await takeOver({ unit: newest.unit, unitId: newest.unitId, nativeSessionId: newest.nativeSessionId, client: binding.client, machine: binding.machine }));
      } catch { return false; }
    }
    // The policy that records the error may be the file that is locked or cut short; then the error stays unrecorded and the poll goes on.
    async function absorbError(error, fallback, generation) {
      let current;
      try { current = await recordError(stableCode(error.code, fallback), generation); }
      catch { return 'continue'; }
      if ((current?.consecutiveErrors ?? 0) >= 5) {
        try { await mutatePolicy(binding, key, async (record) => record?.generation === generation ? ({ ...record, pausedReason: 'error-budget-exhausted' }) : record); }
        catch { return 'continue'; }
        stopReason = 'error-budget-exhausted';
        controller.abort();
        return stopReason;
      }
      return 'continue';
    }
    // The lease outlives several polls, so it is renewed only when the next poll would land past the renewal interval; the gap between renewals then stays within the interval plus one iteration, which leaseMs is validated to cover.
    async function renewLease(now) {
      if (now + pollIntervalMs - leasedAt < LEASE_RENEW_MS) return true;
      const lease = await leaseRenew();
      if (lease?.ownerId !== ownerId) return false;
      leasedAt = now;
      return true;
    }
    // A worker that ends while the policy is unwritable leaves a note that still says running, so the stopped note is tried again.
    async function noteStopped() {
      for (let attempt = 0; ; attempt += 1) {
        try { await noteWorker('stopped'); return; }
        catch (error) { if (!isFileGlitch(error) || attempt === 3) return; }
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    // The dedupe memory has to keep only what can still matter: the ids of messages still unread and of wakes in flight. When a
    // wave would pass the budget, the oldest ids of messages that were read since are dropped first, so a consent whose chat
    // answers its wakes never runs out of memory; only a memory full of unread messages still pauses it.
    async function makeRoom(policy, candidates, inbox) {
      const entries = Object.entries(policy.deliveries ?? {});
      const needed = entries.length + candidates.length - MAX_DELIVERIES;
      // A listing cut at its limit does not show every unread message, so nothing is dropped from it.
      if (needed <= 0 || inbox.unread > inbox.messages.length) return policy;
      const unread = new Set(inbox.messages.map((message) => message.id));
      const readIds = entries.filter(([id, entry]) => !unread.has(id) && entry.state !== 'attempting')
        .sort(([, left], [, right]) => Date.parse(left.lastAttemptAt) - Date.parse(right.lastAttemptAt)).map(([id]) => id);
      if (readIds.length < needed) return policy;
      const dropped = new Set(readIds.slice(0, Math.min(readIds.length, needed + DELIVERY_SLACK)));
      return await mutatePolicy(binding, key, async (current) => current?.generation !== policy.generation ? current : ({ ...current,
        deliveries: Object.fromEntries(Object.entries(current.deliveries ?? {}).filter(([id]) => !dropped.has(id))) })) ?? policy;
    }
    async function deliverBatch(policy, registration, candidates) {
      return withSourceBudget(binding, async () => {
        const latest = await readPolicy(binding, key);
        if (!freshPolicy(latest, nowMs(clock)) || latest.generation !== policy.generation) return;
        return deliverBatchOwned(latest, registration, candidates);
      });
    }
    async function deliverBatchOwned(policy, registration, candidates) {
      const now = nowMs(clock);
      const activity = activityFor(policy, registration, now);
      const urgent = candidates.filter((message) => message.priority === 'urgent');
      const selected = activity.value === 'busy' ? urgent : candidates;
      if (!selected.length) return;
      // The daily cap holds every wake back, urgent ones included, until the next local midnight; the worker keeps polling
      // and wakes for what is still unread once the day has changed.
      if (dayCapped(policy, now)) return;
      const hasUrgent = urgent.length > 0;
      if (policy.cooldownUntil && Date.parse(policy.cooldownUntil) > now && !hasUrgent) return;
      if ((policy.wakeCount ?? 0) >= (policy.maxHandoffs ?? DEFAULT_WAKE_HANDOFFS)) {
        await mutatePolicy(binding, key, async (current) => current?.generation === policy.generation ? ({ ...current, pausedReason: 'handoff-budget-exhausted' }) : current);
        stopReason = 'budget-exhausted';
        controller.abort();
        return;
      }
      if (Object.keys(policy.deliveries ?? {}).length + selected.length > MAX_DELIVERIES) {
        await mutatePolicy(binding, key, async (current) => current?.generation === policy.generation ? ({ ...current, pausedReason: 'dedupe-budget-exhausted' }) : current);
        stopReason = 'dedupe-budget-exhausted';
        controller.abort();
        return;
      }
      const claimed = await mutatePolicy(binding, key, async (current) => {
        if (!freshPolicy(current, nowMs(clock)) || current.generation !== policy.generation) return current;
        const deliveries = { ...(current.deliveries ?? {}) };
        for (const message of selected) {
          const previous = deliveries[message.id];
          // A slower retry is one more try of the same round, so the count of fast attempts stays where it ended.
          deliveries[message.id] = { state: 'attempting', attempts: previous?.slow ? previous.attempts : (previous?.attempts ?? 0) + 1,
            ...(previous?.slow ? { slow: previous.slow } : {}),
            lastAttemptAt: iso(now), threadId: message.threadId ?? null, priority: message.priority === 'urgent' ? 'urgent' : 'normal' };
        }
        return { ...current, deliveries, retryAt: null };
      });
      if (!freshPolicy(claimed, nowMs(clock)) || claimed.generation !== policy.generation) return;
      const ids = selected.map((message) => message.id);
      async function releaseUnsubmittedClaim() {
        await mutatePolicy(binding, key, async (current) => {
          if (current?.generation !== policy.generation) return current;
          const deliveries = { ...current.deliveries };
          for (const id of ids) if (deliveries[id]?.state === 'attempting' && deliveries[id].lastAttemptAt === iso(now)) delete deliveries[id];
          return { ...current, deliveries };
        });
      }
      // The pointer names the messages it is for, so the woken chat knows what arrived before it reads them.
      const text = wakePointer(binding.unit, selected);
      const sinkController = new AbortController();
      const cancelSink = () => sinkController.abort();
      let sinkStarted = false;
      let outcome;
      let currentPolicy;
      try {
        currentPolicy = await readPolicy(binding, key);
        if (!freshPolicy(currentPolicy, nowMs(clock)) || currentPolicy.generation !== policy.generation) { await releaseUnsubmittedClaim(); return; }
        if (!await persistence.resolveBinding(binding) || controller.signal.aborted) { await releaseUnsubmittedClaim(); return; }
        const remainingMs = currentPolicy.unlimited || currentPolicy.runLeaseUntil > nowMs(clock) ? retry.sinkTimeoutMs : Math.max(0, Date.parse(currentPolicy.deadlineAt) - nowMs(clock));
        if (remainingMs <= 0) { await releaseUnsubmittedClaim(); return; }
        controller.signal.addEventListener('abort', cancelSink, { once: true });
        sinkStarted = true;
        const sinkPromise = Promise.resolve().then(() => options.sink({ binding, messageIds: ids, urgent: urgent.length > 0,
          activity: activity.value ?? 'unknown', text, signal: sinkController.signal }));
        outcome = await waitBounded(sinkPromise, Math.min(retry.sinkTimeoutMs, remainingMs), controller.signal, sinkController);
      } catch (error) {
        if (!sinkStarted) {
          await releaseUnsubmittedClaim().catch(() => {});
          throw error;
        }
        outcome = { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' };
      } finally { controller.signal.removeEventListener('abort', cancelSink); }
      const validOutcome = plainObject(outcome) && ['submitted', 'not_submitted', 'ambiguous'].includes(outcome.status) ? outcome : { status: 'ambiguous', reason: 'invalid-sink-result' };
      if (getWakeAdapter(binding.client, adapters)?.acceptsDeferred === true && validOutcome.status === 'not_submitted' && validOutcome.deferred === true) {
        // A host's busy rejection is not a failed delivery attempt. Keep polling
        // within the original consent window without consuming retry or wake budgets.
        await releaseUnsubmittedClaim();
        return;
      }
      const settledAt = nowMs(clock);
      const settled = { ...(await readPolicy(binding, key)).deliveries };
      const settledPolicy = await readPolicy(binding, key);
      if (settledPolicy?.generation !== policy.generation || !freshPolicy(settledPolicy, nowMs(clock))) return;
      const safeReason = stableSinkReason(validOutcome.status, validOutcome.reason);
      const woke = validOutcome.status === 'submitted' || validOutcome.status === 'ambiguous';
      // A slower retry that fails again only probes the pipe, so it does not spend the error budget that pauses the consent.
      const probe = validOutcome.status === 'not_submitted' && ids.every((id) => settled[id]?.slow > 0);
      if (validOutcome.status === 'submitted') {
        for (const id of ids) settled[id] = { ...settled[id], state: 'submitted', submittedAt: iso(settledAt) };
      } else if (validOutcome.status === 'ambiguous') {
        for (const id of ids) settled[id] = { ...settled[id], state: 'ambiguous', ambiguousAt: iso(settledAt), reason: safeReason };
      } else {
        for (const id of ids) {
          const entry = settled[id];
          if ((entry?.attempts ?? 0) >= retry.maxAttempts) {
            const slow = entry.slow ?? 0;
            if (slow < SLOW_RETRIES) settled[id] = { ...entry, state: 'not_submitted', slow: slow + 1, retryAt: iso(settledAt + Math.min(SLOW_RETRY_MAX_MS, SLOW_RETRY_MS * 2 ** slow)), reason: safeReason };
            else settled[id] = { ...entry, state: 'failed', failedAt: iso(settledAt), reason: safeReason };
          } else settled[id] = { ...entry, state: 'not_submitted', retryAt: iso(settledAt + Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** Math.max(0, (entry?.attempts ?? 1) - 1))), reason: safeReason };
        }
      }
      // Both counts grow on the stored policy, so activity of the session that answered meanwhile is not written over.
      await mutatePolicy(binding, key, async (current) => current?.generation !== policy.generation || !freshPolicy(current, nowMs(clock)) ? current : ({ ...current, deliveries: settled,
        wakeCount: (current.wakeCount ?? 0) + (woke ? 1 : 0), ...(woke ? { day: countedDay(current, settledAt, 1) } : {}),
        cooldownUntil: woke ? iso(settledAt + retry.cooldownMs) : current.cooldownUntil,
        lastError: validOutcome.status === 'submitted' ? null : { code: stableReasonCode(safeReason), at: iso(settledAt) },
        consecutiveErrors: validOutcome.status === 'submitted' ? 0 : (current.consecutiveErrors ?? 0) + (probe ? 0 : 1),
      }));
      const postSinkPolicy = await readPolicy(binding, key);
      if (postSinkPolicy?.generation === policy.generation && postSinkPolicy.consecutiveErrors >= 5) {
        await mutatePolicy(binding, key, async (current) => current?.generation === policy.generation ? ({ ...current, pausedReason: 'error-budget-exhausted' }) : current);
        stopReason = 'error-budget-exhausted';
        controller.abort();
      }
    }
    async function iteration() {
      let policy = await readPolicy(binding, key);
      const now = nowMs(clock);
      if (!expectedPolicy(policy, binding, key) || !freshPolicy(policy, now)) return policy?.pausedReason ?? (policy?.enabled ? 'expired' : 'disabled');
      if (policy.generation !== activeGeneration) return 'policy-replaced';
      const registration = await persistence.resolveBinding(binding);
      if (!registration) return 'registration-lost';
      if (!await renewLease(now)) return 'lease-lost';
      if (notedAt === null || now - notedAt >= WORKER_NOTE_MS) {
        noteTried = true;
        // The note is advisory, so a policy that OneDrive is still syncing skips this attempt instead of counting against the error budget; the next poll tries again, since another machine sees no worker until a note lands.
        if (await noteWorker('running').then(() => true, () => false)) notedAt = now;
      }
      if (checkedAt === null || now - checkedAt >= WORKER_NOTE_MS) {
        checkedAt = now;
        if (await superseded(registration)) return 'superseded';
      }
      let inbox;
      try { inbox = await bindingInbox(binding); }
      catch (error) { return absorbError(error, 'INBOX_ERROR', policy.generation); }
      if (controller.signal.aborted) return stopReason ?? 'stopped';
      const messages = inbox.messages.filter((message) => typeof message.id === 'string' && message.id.length <= 180);
      policy = await readPolicy(binding, key);
      if (!freshPolicy(policy, nowMs(clock))) return policy?.pausedReason ?? (policy?.enabled ? 'expired' : 'disabled');
      // A read that failed while OneDrive was still syncing a file is over once a poll reads cleanly, so such failures
      // spread over hours never add up to pausing the wake. Failures to reach the session count until a wake succeeds.
      if (policy.consecutiveErrors > 0 && !String(policy.lastError?.code).startsWith('SINK_')) {
        policy = await mutatePolicy(binding, key, async (current) => current?.generation === policy.generation ? { ...current, consecutiveErrors: 0 } : current);
      }
      if (Object.values(policy.deliveries ?? {}).some((item) => item.state === 'attempting')) {
        await mutatePolicy(binding, key, async (current) => {
          if (current?.generation !== policy.generation) return current;
          const deliveries = { ...current.deliveries };
          let recovered = false;
          for (const [id, entry] of Object.entries(deliveries)) if (entry.state === 'attempting') {
            deliveries[id] = { ...entry, state: 'ambiguous', ambiguousAt: iso(nowMs(clock)), reason: 'worker-restarted-during-submit' };
            recovered = true;
          }
          return { ...current, deliveries, wakeCount: Math.min(current.maxHandoffs, current.wakeCount + (recovered ? 1 : 0)), ...(recovered ? { day: countedDay(current, nowMs(clock), 1) } : {}) };
        });
        policy = await readPolicy(binding, key);
      }
      const candidates = messages.filter((message) => {
        const entry = policy.deliveries?.[message.id];
        if (!entry) return true;
        return entry.state === 'not_submitted' && Date.parse(entry.retryAt) <= nowMs(clock);
      });
      if (!candidates.length) return 'continue';
      policy = await makeRoom(policy, candidates, inbox);
      // Every attempt checks again, so a session replaced between two attempts is not woken in vain until its retries run out.
      if (await superseded(registration)) return 'superseded';
      await deliverBatch(policy, registration, candidates);
      return controller.signal.aborted ? stopReason ?? 'stopped' : 'continue';
    }
    async function run() {
      let terminal = 'stopped';
      try {
        const policy = await readPolicy(binding, key);
        activeGeneration = policy?.generation ?? null;
        worker.generation = activeGeneration;
        const now = nowMs(clock);
        if (controller.signal.aborted) { terminal = stopReason ?? 'stopped'; resolveReady({ state: terminal, ownsLease: false }); return; }
        if (!expectedPolicy(policy, binding, key) || !freshPolicy(policy, now)) {
          terminal = policy?.enabled && !policy.unlimited && Date.parse(policy.deadlineAt) <= now ? 'expired' : 'disabled';
          resolveReady({ state: terminal, ownsLease: false });
          return;
        }
        const registration = await persistence.resolveBinding(binding);
        if (!registration) { terminal = 'registration-lost'; resolveReady({ state: terminal, ownsLease: false }); return; }
        await persistence.removeLegacy().catch(() => {});
        const handoffDeadline = nowMs(clock) + retry.leaseMs;
        const maxHandoffWaits = Math.ceil(retry.leaseMs / pollIntervalMs) + 1;
        let handoffWaits = 0;
        let existingLease;
        while (!controller.signal.aborted) {
          existingLease = await leaseAcquire();
          if (existingLease?.ownerId === ownerId) break;
          const leaseLive = Boolean(existingLease && existingLease.expiresAt > nowMs(clock) && await isProcessAlive(existingLease.pid));
          if (!leaseLive || existingLease.generation === activeGeneration) {
            terminal = leaseLive ? 'already-running' : 'lease-unavailable';
            resolveReady({ state: terminal, ownsLease: false });
            return;
          }
          if (nowMs(clock) >= handoffDeadline) {
            terminal = 'handoff-timeout';
            resolveReady({ state: terminal, ownsLease: false });
            return;
          }
          if (handoffWaits >= maxHandoffWaits) {
            terminal = 'handoff-timeout';
            resolveReady({ state: terminal, ownsLease: false });
            return;
          }
          handoffWaits += 1;
          await clock.sleep(Math.min(pollIntervalMs, Math.max(1, handoffDeadline - nowMs(clock))), controller.signal);
        }
        if (controller.signal.aborted) { terminal = stopReason ?? 'stopped'; resolveReady({ state: terminal, ownsLease: false }); return; }
        leasedAt = nowMs(clock);
        resolveReady({ state: 'running', ownsLease: true });
        let glitchPolls = 0;
        let glitchSince = 0;
        while (!controller.signal.aborted) {
          let glitch = null;
          try { terminal = await iteration(); }
          catch (error) {
            // A record that OneDrive is still syncing fails one read, not the worker; the next poll retries it within the error budget.
            if (!isFileGlitch(error)) throw error;
            glitch = stableCode(error.code, 'WAKE_WORKER_ERROR');
            terminal = await absorbError(error, 'WAKE_STORE_BUSY', activeGeneration);
          }
          // Routes or a state file that are empty or missing for a moment make the registration look gone; only a loss that stays ends the worker.
          if (terminal === 'registration-lost') { glitch = terminal; terminal = 'continue'; }
          if (glitch) {
            const at = nowMs(clock);
            if (glitchPolls === 0) glitchSince = at;
            glitchPolls += 1;
            if (terminal === 'continue' && glitchPolls >= GLITCH_POLLS && at - glitchSince >= GLITCH_MS) terminal = glitch;
            // The lease still has to be renewed while the poll cannot get past the problem.
            else if (terminal === 'continue') await renewLease(at).catch(() => {});
          } else glitchPolls = 0;
          if (terminal !== 'continue') break;
          await clock.sleep(pollIntervalMs, controller.signal);
        }
        if (stopReason) terminal = stopReason;
      } catch (error) {
        const code = stableCode(error?.code, 'WAKE_WORKER_ERROR');
        await recordError(code, activeGeneration).catch(() => {});
        terminal = code;
        resolveReady({ state: 'error', ownsLease: false, code });
      } finally {
        resolveReady({ state: terminal, ownsLease: false });
        if (noteTried) await noteStopped();
        await leaseRelease();
        if (workers.get(key) === worker) workers.delete(key);
        noteEnd(binding, terminal);
        resolveDone({ reason: terminal });
      }
    }
    void run();
    return handle;
  }

  async function renewRunLease(bindingValue, { runId, role, hostSessionId }) {
    if (role !== 'coordinator' || typeof runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(runId) || typeof hostSessionId !== 'string' || !hostSessionId) throw wakeError('WAKE_INVALID_BINDING', 'A run lease requires its verified coordinator conversation.');
    let binding = await canonicalBinding(makeBinding(bindingValue));
    const registration = await registered(binding);
    const newest = await persistence.latestUnitRegistration({ unit: binding.unit, unitId: binding.unitId, client: binding.client, machine: binding.machine });
    if (newest && newest.nativeSessionId !== binding.nativeSessionId && newest.hostSessionId === hostSessionId) {
      const previousKey = bindingHash(binding), nextBinding = { ...binding, nativeSessionId: newest.nativeSessionId }, nextKey = bindingHash(nextBinding);
      const leases = await persistence.read('run-leases', previousKey);
      if (leases && Object.values(leases.runs).every(run => run.hostSessionId === hostSessionId)) {
        const source = await readPolicy(binding, previousKey), destination = await readPolicy(nextBinding, nextKey);
        if (source && (!destination || destination.enabled)) {
          const moved = { ...source, binding: nextBinding, key: nextKey };
          delete moved.runLeaseUntil;
          // Carry unanswered wakes, daily counters and all pointer identities with the approved conversation.
          const combined = destination ? mergeAliases(destination, moved, nextBinding, nextKey) : moved;
          if (await persistence.read('policies', nextKey)) await writeAliases(nextBinding, nextKey, combined, null);
          else await persistence.write('run-policies', nextKey, combined);
          await persistence.write('run-leases', nextKey, leases);
          await persistence.remove('run-leases', previousKey); await stop(binding);
          binding = nextBinding;
        }
      }
    }
    const key = bindingHash(binding), now = nowMs(clock);
    await persistence.withLock(`run-${key}`, async () => {
      const leases = await persistence.read('run-leases', key) ?? { binding, runs: {} };
      const previous = leases.runs[runId];
      if (previous && previous.hostSessionId !== hostSessionId) throw wakeError('WAKE_INVALID_BINDING', 'Another role cannot adopt this run lease.');
      if (registration.hostSessionId && registration.hostSessionId !== hostSessionId) throw wakeError('WAKE_INVALID_BINDING', 'The registered conversation does not own this run.');
      if (!await readPolicy(binding, key) && !await persistence.read('run-policies', key)) {
        const sources = [...await persistence.list('policies'), ...await persistence.list('run-policies')].map(item => item.value)
          .filter(policy => policy.binding?.unitId === binding.unitId && policy.binding.client === binding.client && policy.binding.machine === binding.machine);
        const source = sources.sort((a,b) => dayCount(b, now) - dayCount(a, now))[0];
        await persistence.write('run-policies', key, { kind: 'relay-wake-policy', version: 1, binding, key, generation: randomUUID(), enabled: true,
          ...policyWindow({}, now), manualConsent: false, wakeCount: 0, deliveries: {}, disabledAt: null, disabledReason: null, pausedReason: null,
          ...(source?.day ? { day: source.day } : {}), maxDailyHandoffs: Math.min(DEFAULT_DAILY_HANDOFFS, ...sources.map(dailyCap)),
          activity: { value: 'idle', observedAt: iso(now) }, lastError: null, consecutiveErrors: 0, retryAt: null, cooldownUntil: null });
      }
      leases.runs[runId] = { role, hostSessionId, expiresAt: now + 900000 };
      await persistence.write('run-leases', key, leases);
    });
    return inspect(binding);
  }
  async function releaseRunLease(runId) {
    for (const { key, value } of await persistence.list('run-leases')) {
      if (!value.runs?.[runId]) continue;
      await persistence.withLock(`run-${key}`, async () => {
        const latest = await persistence.read('run-leases', key);
        if (!latest?.runs?.[runId]) return;
        delete latest.runs[runId];
        if (Object.keys(latest.runs).length) await persistence.write('run-leases', key, latest);
        else { await persistence.remove('run-leases', key); if (!freshPolicy(await readPolicy(value.binding, key), nowMs(clock))) await stop(value.binding); }
      });
    }
    for (const { key, value } of await persistence.list('run-policies')) if (value.kind === 'relay-run-wake' && value.runs?.[runId]) {
      delete value.runs[runId]; await persistence.write('run-policies', key, value);
      if (!Object.keys(value.runs).length) await workers.get(key)?.stop('run-closed');
    }
  }
  async function maintainActor(binding, actor, io) {
    if (binding.machine !== hostname || !['coordinator', 'planner', 'builder', 'reviewer'].includes(actor.role)
      || typeof actor.actorId !== 'string' || actor.sessionId !== actor.hostSessionId || await io.verify() !== true) throw wakeError('WAKE_INVALID_BINDING', 'The run actor is not owned by this conversation.');
    const key = createHash('sha256').update(JSON.stringify([actor.actorId, actor.role, binding.nativeSessionId, binding.client, hostname])).digest('hex');
    await withSourceBudget({ ...binding, unit: binding.unit ?? actor.actorId }, async () => {
      const record = await persistence.read('run-policies', key) ?? { kind: 'relay-run-wake', key, binding, actorId: actor.actorId, role: actor.role,
        runs: {}, deliveries: {}, wakeCount: 0, maxHandoffs: DEFAULT_WAKE_HANDOFFS, maxDailyHandoffs: DEFAULT_DAILY_HANDOFFS };
      record.runs[actor.runId] = { hostSessionId: actor.hostSessionId, expiresAt: nowMs(clock) + 900000 };
      await persistence.write('run-policies', key, record);
    });
    const sourceMatches = policy => policy.binding?.machine === hostname && policy.binding.client === binding.client
      && (binding.unitId ? policy.binding.unitId === binding.unitId : policy.actorId === actor.actorId && policy.role === actor.role);
    async function sources() { return [...await persistence.list('policies'), ...await persistence.list('run-policies')].filter(item => sourceMatches(item.value)); }
    async function state() {
      const all = await sources(), now = nowMs(clock), own = await persistence.read('run-policies', key);
      const cappedAt = Math.min(DEFAULT_DAILY_HANDOFFS, ...all.map(item => dailyCap(item.value)));
      const count = Math.max(0, ...all.map(item => dayCount(item.value, now)));
      const revoked = all.some(item => item.value.kind === 'relay-wake-policy' && item.value.enabled === false && ['manual', 'revoked'].includes(item.value.disabledReason));
      const exhausted = all.some(item => item.value.wakeCount >= item.value.maxHandoffs || item.value.pausedReason);
      return { own, all, now, count, cappedAt, pausedReason: revoked ? 'revoked' : exhausted ? 'handoff-budget-exhausted' : null,
        dailyResumesAt: count >= cappedAt ? iso(nextLocalMidnight(now)) : null };
    }
    if (!workers.has(key)) {
      const abort = new AbortController(); let done;
      const handle = { stop: async () => { abort.abort(); await done; } };
      workers.set(key, { stop: handle.stop, handle, runActor: true });
      done = (async () => {
        while (!abort.signal.aborted) {
          await clock.sleep(pollIntervalMs, abort.signal);
          if (abort.signal.aborted) break;
          const current = await state();
          if (!Object.values(current.own.runs).some(run => run.expiresAt > current.now) || await io.verify() !== true) break;
          if (current.pausedReason || current.dailyResumesAt) continue;
          for (const pointer of await io.inbox()) {
            if (abort.signal.aborted) break;
            const lock = createHash('sha256').update(JSON.stringify([binding.unitId ?? actor.actorId, binding.client, hostname])).digest('hex');
            await persistence.withLock(`actor-submit-${lock}`, async () => {
              const latest = await state(), previous = latest.own.deliveries[pointer.deliveryId];
              if (latest.pausedReason || latest.dailyResumesAt) return;
              if (previous && ['submitted', 'ambiguous', 'attempting'].includes(previous.state)) { await io.acknowledge(pointer, previous.state === 'submitted' ? 'submitted' : 'ambiguous'); return; }
              if (previous?.attempts >= retry.maxAttempts || Object.keys(latest.own.deliveries).length >= MAX_DELIVERIES && !previous) return;
              latest.own.deliveries[pointer.deliveryId] = { state: 'attempting', attempts: (previous?.attempts ?? 0) + 1 };
              latest.own.wakeCount++; latest.own.day = { date: localDate(latest.now), count: latest.count + 1 };
              await persistence.write('run-policies', key, latest.own);
              for (const source of latest.all.filter(item => item.value.kind === 'relay-wake-policy')) {
                const exact = source.value.binding;
                await mutatePolicy(exact, bindingHash(exact), policy => policy ? { ...policy, day: latest.own.day, wakeCount: Math.min(policy.maxHandoffs, policy.wakeCount + 1) } : policy);
              }
              let outcome;
              try { outcome = await waitBounded(Promise.resolve(options.sink({ binding: { ...binding, runId: actor.runId, role: actor.role, sessionId: actor.sessionId },
                messageIds: pointer.messageId ? [pointer.messageId] : [], text: pointer.text, activity: 'idle', urgent: false, signal: abort.signal })), retry.sinkTimeoutMs, abort.signal, abort); }
              catch { outcome = { status: 'ambiguous' }; }
              const submitted = outcome?.status === 'submitted', ambiguous = !submitted && outcome?.status !== 'not_submitted';
              const fresh = await persistence.read('run-policies', key);
              fresh.deliveries[pointer.deliveryId] = { ...fresh.deliveries[pointer.deliveryId], state: submitted ? 'submitted' : ambiguous ? 'ambiguous' : 'not_submitted' };
              if (!submitted && !ambiguous) {
                fresh.wakeCount = Math.max(0, fresh.wakeCount - 1); fresh.day = { ...fresh.day, count: Math.max(0, fresh.day.count - 1) };
                await persistence.write('run-policies', key, fresh);
                for (const source of latest.all.filter(item => item.value.kind === 'relay-wake-policy')) {
                  const exact = source.value.binding;
                  await mutatePolicy(exact, bindingHash(exact), policy => policy ? { ...policy, day: fresh.day, wakeCount: Math.max(0, policy.wakeCount - 1) } : policy);
                }
              }
              await persistence.write('run-policies', key, fresh);
              if (submitted || ambiguous) await io.acknowledge(pointer, submitted ? 'submitted' : 'ambiguous');
            });
          }
        }
      })().catch(() => {}).finally(() => { if (workers.get(key)?.handle === handle) workers.delete(key); });
    }
    const current = await state(); return { pausedReason: current.pausedReason, dailyResumesAt: current.dailyResumesAt };
  }
  const stopRunActors = () => Promise.all([...workers.values()].filter(worker => worker.runActor).map(worker => worker.stop()));
  return Object.freeze({ adopt, enable, disable, status, start, stop, stopAll, findEnabledBinding, workerStates, lapsedWorkers, observeActivity, endSession, cursorStop, takeOver, touch, resume, renewRunLease, releaseRunLease, maintainActor, stopRunActors });
}

async function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}
