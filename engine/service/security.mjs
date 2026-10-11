import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError, isUuid } from './identity.mjs';

export const DESKTOP = Object.freeze(['read', 'chat.post', 'chat.manage', 'mailbox.read', 'approval.answer', 'grant.revoke', 'task.status', 'task.undo', 'unit.create', 'unit.connect', 'session.start', 'session.stop', 'layout.write', 'settings.write', 'home.manage', 'editor.read', 'editor.write', 'comment.write', 'proposal.answer', 'asset.write', 'watch', 'viewer.write']);
const PHONE = new Set(['read', 'chat.post', 'master.read', 'approval.answer', 'task.accept', 'task.send-back']);
const SYSTEM_SID = 'S-1-5-18';
const ACL_TIMEOUT_MS = 8000;

export function createAclRunner({ spawnSync: run = spawnSync, env = process.env, platform = process.platform } = {}) {
  let userSid = null;
  const tool = (name) => systemTool(name, env, platform);
  return {
    userSid() {
      if (userSid) return userSid;
      const result = runTool(run, tool('whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
      const sid = String(result.stdout ?? '').match(/S-\d+-\d+(?:-\d+)+/)?.[0] ?? '';
      if (!/^S-\d+-\d+(?:-\d+)+$/.test(sid)) throw new CoreError(503, 'bootstrap_unavailable', 'The current user could not be identified.');
      userSid = sid;
      return sid;
    },
    protect(target) {
      assertLocalTarget(target);
      const sid = this.userSid();
      const rights = statSync(target).isDirectory() ? '(OI)(CI)F' : 'F';
      const grant = (value) => `*${value}:${rights}`;
      runTool(run, tool('icacls.exe'), [
        target,
        '/inheritance:r',
        '/grant:r', grant(SYSTEM_SID),
        '/grant:r', grant(sid),
      ]);
      return { protected: true, sid };
    },
    check(target) {
      assertLocalTarget(target);
      const sid = this.userSid();
      const saved = path.join(os.tmpdir(), `hivem1nd-acl-${randomBytes(6).toString('hex')}.txt`);
      try {
        runTool(run, tool('icacls.exe'), [target, '/save', saved, '/Q']);
        assertLimitedAcl(readAclText(saved), sid);
      } finally {
        try { unlinkSync(saved); } catch { /* The save file is already gone. */ }
      }
      return { ok: true };
    },
  };
}

export function stubAclRunner() {
  const calls = [];
  const sid = 'S-1-5-21-1-2-3-1001';
  return {
    calls,
    userSid() {
      calls.push({ op: 'sid' });
      return sid;
    },
    protect(target) {
      calls.push({ op: 'protect', target: String(target) });
      return { protected: true, sid };
    },
    check(target) {
      calls.push({ op: 'check', target: String(target) });
      return { ok: true };
    },
  };
}

let sharedRunner = null;

export function aclRunnerFrom(options = {}) {
  return options.aclRunner ?? options.store?.aclRunner ?? sharedAclRunner();
}

function sharedAclRunner() {
  if (!sharedRunner) sharedRunner = createAclRunner();
  return sharedRunner;
}

export async function protectLocalFile(file, options = {}) {
  if (options.fail === true) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  await mkdir(path.dirname(file), { recursive: true });
  const info = await stat(file);
  if (process.platform !== 'win32') {
    await chmod(path.dirname(file), 0o700);
    await chmod(file, info.isDirectory() ? 0o700 : 0o600);
    await verifyLocalPermissions(file);
    return { protected: true };
  }
  const runner = aclRunnerFrom(options);
  const protectedFile = runner.protect(file);
  return { protected: true, sid: protectedFile.sid };
}

export async function verifyLocalPermissions(file, options = {}) {
  if (process.platform === 'win32') {
    aclRunnerFrom(options).check(file);
    return { ok: true };
  }
  const info = await stat(file);
  if ((info.mode & 0o077) !== 0) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  return { ok: true };
}

export async function protectBootstrapFiles(directory, file, options = {}) {
  if (options.fail === true) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  await mkdir(directory, { recursive: true });
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700);
    await chmod(file, 0o600);
    await verifyLocalPermissions(directory);
    await verifyLocalPermissions(file);
    return { protected: true };
  }
  const runner = aclRunnerFrom(options);
  runner.protect(directory);
  runner.protect(file);
  runner.check(directory);
  runner.check(file);
  return { protected: true, sid: runner.userSid() };
}

export async function verifyBootstrapFiles(directory, file, options = {}) {
  if (process.platform !== 'win32') {
    await verifyLocalPermissions(directory);
    await verifyLocalPermissions(file);
    return { ok: true };
  }
  const runner = aclRunnerFrom(options);
  runner.check(directory);
  runner.check(file);
  return { ok: true };
}

export const SECURITY_RETENTION = 200;
export const SECURITY_ALERT_THRESHOLD = 8;
export const SECURITY_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const SECURITY_FAILURE_LIMIT = 256;
const SECURITY_TYPES = new Set(['auth.failure', 'auth.success', 'permission.denied', 'validation.failure', 'rate.limited', 'credential.revoked', 'security.alert']);

export function createSecuritySink({ now = () => Date.now(), directory = null } = {}) {
  const events = [];
  const diagnostics = [];
  const failures = new Map();
  const file = directory ? path.join(directory, 'security-events.jsonl') : null;
  const diagnosticFile = directory ? path.join(directory, 'developer-diagnostics.jsonl') : null;
  return {
    events,
    diagnostics,
    retention: SECURITY_RETENTION,
    alertThreshold: SECURITY_ALERT_THRESHOLD,
    diagnose(input = {}) {
      try {
        const message = typeof input.message === 'string' ? input.message : '';
        const code = typeof input.code === 'string' && input.code.length > 0 ? input.code : 'internal_error';
        const name = typeof input.name === 'string' && input.name.length > 0 ? input.name : 'Error';
        const syscall = typeof input.syscall === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(input.syscall) ? input.syscall : null;
        const record = {
          at: new Date(now()).toISOString(),
          requestId: isUuid(input.requestId) ? input.requestId : null,
          status: Number.isInteger(input.status) && input.status >= 400 && input.status <= 599 ? input.status : 500,
          code: leaks(code) ? 'internal_error' : code.slice(0, 80),
          name: leaks(name) ? 'Error' : name.slice(0, 40),
          syscall,
          message: message.length > 0 && !leaks(message) ? message.slice(0, 200) : 'redacted',
        };
        remember(diagnostics, record, diagnosticFile);
        return record;
      } catch {
        return null;
      }
    },
    record(input = {}) {
      try {
        const type = SECURITY_TYPES.has(input.type) ? input.type : null;
        if (!type) return null;
        const event = {
          at: new Date(now()).toISOString(),
          type,
          actorHash: pseudonym(input.actor),
          sessionHash: pseudonym(input.session),
          peer: publicPeer(input.peer),
          outcome: input.outcome === 'success' ? 'success' : 'failure',
        };
        remember(events, event, file);
        if (event.outcome === 'success') {
          failures.delete(`${event.type}:${event.peer}`);
          return event;
        }
        const count = noteFailure(failures, event, now());
        if (count === SECURITY_ALERT_THRESHOLD) {
          remember(events, {
            at: event.at,
            type: 'security.alert',
            actorHash: null,
            sessionHash: null,
            peer: event.peer,
            outcome: 'alert',
            threshold: SECURITY_ALERT_THRESHOLD,
          }, file);
        }
        return event;
      } catch {
        return null;
      }
    },
  };
}

function noteFailure(failures, event, at) {
  for (const [key, value] of failures) {
    if (at - value.at >= SECURITY_FAILURE_WINDOW_MS) failures.delete(key);
  }
  const key = `${event.type}:${event.peer}`;
  while (failures.size >= SECURITY_FAILURE_LIMIT && !failures.has(key)) {
    failures.delete(failures.keys().next().value);
  }
  const current = failures.get(key);
  const count = current && at - current.at < SECURITY_FAILURE_WINDOW_MS ? current.count + 1 : 1;
  failures.set(key, { count, at });
  return count;
}

function pseudonym(value) {
  if (value == null || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function publicPeer(value) {
  if (typeof value !== 'string') return null;
  if (value === '127.0.0.1' || value === '::1' || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value;
  return null;
}

function remember(events, event, file) {
  events.push(event);
  while (events.length > SECURITY_RETENTION) events.shift();
  if (!file) return;
  try {
    if (lstatSync(file).isSymbolicLink()) return;
  } catch (error) {
    if (error?.code !== 'ENOENT') return;
  }
  appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length > SECURITY_RETENTION) writeFileSync(file, `${lines.slice(-SECURITY_RETENTION).join('\n')}\n`, { mode: 0o600 });
}

export function wakeBindingLive(mind, record, now) {
  if (!mind || !record?.wakeId || !/^[A-Za-z0-9._-]{1,80}$/.test(record.wakeId)) return false;
  const file = path.join(mind, 'user', 'relay', 'wake', 'policies', `${record.wakeId}.json`);
  let policy;
  try {
    const state = lstatSync(file);
    if (state.isSymbolicLink() || !state.isFile()) return false;
    policy = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!policy || policy.enabled !== true || policy.pausedReason) return false;
  if (record.generation && policy.generation !== record.generation) return false;
  if (policy.unlimited !== true) {
    const deadline = Date.parse(policy.deadlineAt);
    if (!Number.isFinite(deadline) || deadline <= now) return false;
  }
  const binding = policy.binding ?? {};
  if (record.unitId && binding.unitId && binding.unitId !== record.unitId) return false;
  if (record.sessionId && sessionMarkedStopped(mind, record.sessionId)) return false;
  return true;
}

function sessionMarkedStopped(mind, sessionId) {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return true;
  const directory = path.join(mind, 'user', 'relay', 'session-status', sessionId);
  let names;
  try {
    const state = lstatSync(directory);
    if (state.isSymbolicLink() || !state.isDirectory()) return false;
    names = readdirSync(directory);
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name);
    try {
      const state = lstatSync(file);
      if (state.isSymbolicLink() || !state.isFile()) continue;
      const record = JSON.parse(readFileSync(file, 'utf8'));
      if (record?.state === 'stopped') return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function createCredentialStore({ now = () => Date.now() } = {}) {
  const records = new Map();
  let sink = null;
  let wakeReader = null;
  const noteRevoked = (record) => sink?.record({
    type: 'credential.revoked',
    actor: record?.unitId ?? record?.audience ?? null,
    session: record?.sessionId ?? null,
    peer: null,
    outcome: 'success',
  });
  return {
    bindSecurity(next) {
      sink = next;
    },
    bindWake(reader) {
      wakeReader = typeof reader === 'function' ? reader : null;
    },
    issue(input) {
      const secret = randomBytes(32);
      const token = secret.toString('base64url');
      const record = {
        secret,
        audience: input.audience,
        unitId: input.unitId ?? null,
        sessionId: input.sessionId ?? null,
        wakeId: input.wakeId ?? null,
        generation: input.generation ?? null,
        capabilities: input.audience === 'desktop' ? [...DESKTOP] : input.audience === 'phone' ? [...PHONE] : input.capabilities ?? [],
        expiresAt: input.expiresAt ?? null,
        viewerId: input.viewerId ?? null,
        attached: input.attached ?? null,
        embedded: input.embedded === true,
        hostOrigin: input.hostOrigin ?? null,
        look: input.look ?? null,
        language: input.language ?? null,
      };
      records.set(token, record);
      return { token, capabilities: record.capabilities };
    },
    verify(token) {
      const record = records.get(token);
      if (!record) throw new CoreError(401, 'invalid_session', 'The credential is not valid.');
      const supplied = Buffer.from(String(token), 'base64url');
      const left = record.secret;
      const right = supplied.length === left.length ? supplied : left;
      const expired = record.expiresAt != null && now() >= Date.parse(record.expiresAt);
      if (!timingSafeEqual(left, right) || supplied.length !== left.length || expired) {
        throw new CoreError(401, 'invalid_session', 'The credential is not valid.');
      }
      if (record.wakeId && wakeReader && wakeReader(record) !== true) {
        records.delete(token);
        noteRevoked(record);
        throw new CoreError(401, 'invalid_session', 'The credential is not valid.');
      }
      return { ...record, secret: undefined, token };
    },
    revokeWake(wakeId) {
      for (const [token, record] of records) {
        if (record.wakeId !== wakeId) continue;
        records.delete(token);
        noteRevoked(record);
      }
    },
    revoke(token) {
      const record = records.get(token);
      records.delete(token);
      if (record) noteRevoked(record);
    },
    revokeSession(sessionId) {
      for (const [token, record] of records) {
        if (record.sessionId !== sessionId) continue;
        records.delete(token);
        noteRevoked(record);
      }
    },
    revokeAudience(audience) {
      for (const [token, record] of records) {
        if (record.audience !== audience) continue;
        records.delete(token);
        noteRevoked(record);
      }
    },
  };
}

export function authorize(credential, operation, object = {}) {
  if (!credential) throw new CoreError(401, 'invalid_session', 'The credential is not valid.');
  if (object.listener === 'lan' && credential.audience !== 'phone') throw new CoreError(403, 'forbidden', 'A desktop credential is not accepted on the home network.');
  if (credential.audience === 'phone') {
    if (!PHONE.has(operation)) throw new CoreError(403, 'phone_read_only', 'Phone cannot change that.');
    if ((operation === 'chat.post' || operation === 'master.read') && object.existing === false) throw new CoreError(404, 'not_found', 'The destination does not exist.');
    if ((operation === 'task.accept' || operation === 'task.send-back') && object.reviewable !== true) throw new CoreError(403, 'forbidden', 'The task is not reviewable.');
    return { allowed: true };
  }
  if (credential.audience === 'agent') {
    if (['approval.answer', 'task.accept', 'task.undo', 'settings.write', 'grant.revoke', 'unit.create', 'session.start', 'session.stop', 'watch'].includes(operation)) {
      throw new CoreError(403, 'forbidden', 'The agent cannot perform that operation.');
    }
    if (operation === 'read' && object.scope !== 'own' && object.scope !== 'member') throw new CoreError(403, 'forbidden', 'The agent cannot read that.');
    if (operation === 'mailbox.read' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot read that mailbox.');
    if (operation === 'task.status' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot change that task.');
    if ((operation === 'editor.write' || operation === 'comment.write') && object.attached !== true) throw new CoreError(403, 'forbidden', 'The agent is not attached to that resource.');
    if (operation === 'approval.request' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot request for another unit.');
    return { allowed: true };
  }
  if (credential.audience === 'desktop' && DESKTOP.includes(operation)) return { allowed: true };
  throw new CoreError(403, 'forbidden', 'The operation is not allowed.');
}

export function checkPeer(remoteAddress, listener) {
  const address = normalizeAddress(remoteAddress);
  if (listener.kind === 'loopback') {
    if (address !== '127.0.0.1') throw new CoreError(403, 'loopback_only', 'The peer is not loopback.');
    return { ok: true };
  }
  if (!inSubnet(address, listener.address, listener.netmask)) throw new CoreError(403, 'peer_not_allowed', 'The peer is not on the home network.');
  return { ok: true };
}

export function checkHost(host, listener) {
  const expected = `${listener.address}:${listener.port}`;
  if (typeof host !== 'string' || host.includes(',') || host.toLowerCase() !== expected.toLowerCase()) {
    throw new CoreError(400, 'invalid_host', 'The Host header does not match the listener.');
  }
  return { ok: true };
}

export function checkOrigin(origin, listener, { write = false } = {}) {
  const expected = `http://${listener.address}:${listener.port}`;
  if (!origin && !write) return { ok: true };
  if (origin !== expected) throw new CoreError(403, 'invalid_origin', 'The Origin header does not match the listener.');
  return { ok: true };
}

export function checkLimits(bucket, input, now = Date.now()) {
  const window = 60000;
  bucket.requests ??= [];
  bucket.streams ??= new Set();
  bucket.peers ??= new Map();
  bucket.grantFailures ??= [];
  if (typeof input.url === 'string' && Buffer.byteLength(input.url, 'utf8') > 2048) throw new CoreError(414, 'uri_too_long', 'The request target is too long.');
  if ((input.headerBytes ?? 0) > 8192) throw new CoreError(431, 'request_too_large', 'The request headers are too large.');
  bucket.requests = bucket.requests.filter((at) => now - at < window);
  if (input.stream !== true && bucket.requests.length >= 240) {
    throw new CoreError(429, 'request_rate_limited', 'Too many requests.', {}, new Date(bucket.requests[0] + window).toISOString());
  }
  if (input.stream === true && bucket.streams.size >= 4) throw new CoreError(429, 'request_rate_limited', 'Too many streams.', {}, new Date(now + 1000).toISOString());
  if (input.homeFailure === true) {
    const peer = bucket.peers.get(input.peer) ?? [];
    const recentPeer = peer.filter((at) => now - at < window);
    const recentGrant = bucket.grantFailures.filter((at) => now - at < window);
    if (recentPeer.length >= 5 || recentGrant.length >= 30) {
      throw new CoreError(429, 'auth_rate_limited', 'Too many home attempts.', {}, new Date(now + 1000).toISOString());
    }
    recentPeer.push(now);
    recentGrant.push(now);
    bucket.peers.set(input.peer, recentPeer);
    bucket.grantFailures = recentGrant;
  } else if (input.stream !== true) {
    bucket.requests.push(now);
  }
  return { ok: true };
}

export function safeError(error, requestId) {
  const known = error instanceof CoreError;
  return {
    error: {
      code: known && typeof error.code === 'string' ? error.code : 'internal_error',
      message: known && !leaks(error.message) ? error.message : 'The request failed.',
      requestId,
      details: safeDetails(known ? error.details : null),
      retryAt: error?.retryAt ?? null,
    },
  };
}

const PUBLIC_DETAIL_KEYS = new Set(['remaining', 'limits', 'state', 'retryAt', 'machine', 'phase', 'used', 'max', 'windowSeconds', 'messages', 'messageBytes', 'syncBytes', 'reason', 'code']);

function leaks(value) {
  return typeof value === 'string' && /[A-Za-z]:[\\/]|\\\\|token|secret|bearer |authorization|password|(?:^|[^A-Za-z0-9])\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/i.test(value);
}

function safeDetails(source, depth = 0) {
  if (depth > 6 || !source || typeof source !== 'object' || Array.isArray(source)) return {};
  const details = {};
  for (const key of Object.keys(source).slice(0, 32)) {
    if (!PUBLIC_DETAIL_KEYS.has(key) || leaks(key)) continue;
    const projected = safeValue(source[key], depth + 1);
    if (projected !== undefined) details[key] = projected;
  }
  return details;
}

function safeValue(value, depth) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= 200 && !leaks(value) ? value : undefined;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value.slice(0, 20)) {
      const projected = safeValue(item, depth + 1);
      if (projected !== undefined) items.push(projected);
    }
    return items;
  }
  if (typeof value === 'object') return safeDetails(value, depth);
  return undefined;
}

function systemTool(name, env, platform) {
  if (platform !== 'win32') return name;
  const root = typeof env?.SystemRoot === 'string' && env.SystemRoot ? env.SystemRoot : env?.SYSTEMROOT;
  if (typeof root !== 'string' || !root) throw new CoreError(503, 'bootstrap_unavailable', 'The current user could not be identified.');
  return path.join(root, 'System32', name);
}

function runTool(run, command, args) {
  let result;
  try {
    result = run(command, args, {
      shell: false,
      windowsHide: true,
      timeout: ACL_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new CoreError(503, 'bootstrap_unavailable', 'The private folder could not be protected.');
  }
  if (result?.error || result?.status !== 0) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder could not be protected.');
  return result;
}

function readAclText(file) {
  const bytes = readFileSync(file);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes.includes(0)) return bytes.toString('utf16le').replace(/^\uFEFF/, '');
  return bytes.toString('utf8');
}

function assertLocalTarget(target) {
  let info;
  try {
    info = lstatSync(target);
  } catch {
    throw new CoreError(503, 'bootstrap_unavailable', 'The private folder could not be protected.');
  }
  if (info.isSymbolicLink()) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder could not be protected.');
}

function assertLimitedAcl(text, userSid) {
  const owner = String(text).match(/O:([^:\r\nG]+)/);
  if (owner) {
    const sid = owner[1].toUpperCase();
    if (sid !== userSid.toUpperCase() && sid !== SYSTEM_SID && sid !== 'SY') {
      throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL is not limited to the owner.');
    }
  }
  const marker = text.indexOf('D:');
  if (marker < 0) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
  const dacl = text.slice(marker).split(/\r?\n/, 1)[0].trim();
  const flags = dacl.slice(2).split('(', 1)[0];
  if (!flags.includes('P')) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder still inherits permissions.');
  const allowed = new Set([SYSTEM_SID, 'SY', userSid.toUpperCase()]);
  const aces = [...dacl.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]);
  if (aces.length < 1) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
  let sawUser = false;
  let sawSystem = false;
  for (const ace of aces) {
    const fields = ace.split(';');
    if (fields.length < 6) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
    if ((fields[1] ?? '').includes('ID')) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder still inherits permissions.');
    const trustee = fields[5].toUpperCase();
    if (!allowed.has(trustee)) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL is not limited to the owner.');
    if (trustee === userSid.toUpperCase()) sawUser = true;
    if (trustee === 'SY' || trustee === SYSTEM_SID) sawSystem = true;
  }
  if (!sawUser || !sawSystem) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL is not limited to the owner.');
}

function normalizeAddress(address) {
  if (address === '::ffff:127.0.0.1') return '127.0.0.1';
  return address;
}

function inSubnet(address, network, netmask) {
  const ip = ipv4(address);
  const base = ipv4(network);
  const mask = ipv4(netmask);
  if (ip == null || base == null || mask == null) return false;
  return (ip & mask) === (base & mask);
}

function ipv4(value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part) || Number(part) > 255) return null;
    result = (result << 8) + Number(part);
  }
  return result >>> 0;
}
