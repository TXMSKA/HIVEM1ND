import { spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync, readFileSync, unlinkSync } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from './identity.mjs';

export const DESKTOP = Object.freeze(['read', 'chat.post', 'chat.manage', 'mailbox.read', 'approval.answer', 'grant.revoke', 'task.status', 'task.undo', 'unit.create', 'unit.connect', 'session.start', 'session.stop', 'layout.write', 'settings.write', 'home.manage', 'editor.read', 'editor.write', 'comment.write', 'proposal.answer', 'asset.write', 'watch', 'viewer.write']);
const PHONE = new Set(['read', 'chat.post', 'master.read', 'approval.answer', 'task.accept', 'task.send-back']);
const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const ACL_TIMEOUT_MS = 8000;

export function createAclRunner({ spawnSync: run = spawnSync } = {}) {
  let userSid = null;
  return {
    userSid() {
      if (userSid) return userSid;
      const result = runTool(run, 'whoami.exe', ['/user', '/fo', 'csv', '/nh']);
      const sid = String(result.stdout ?? '').match(/S-\d+-\d+(?:-\d+)+/)?.[0] ?? '';
      if (!/^S-\d+-\d+(?:-\d+)+$/.test(sid)) throw new CoreError(503, 'bootstrap_unavailable', 'The current user could not be identified.');
      userSid = sid;
      return sid;
    },
    protect(target) {
      const sid = this.userSid();
      const rights = statSync(target).isDirectory() ? '(OI)(CI)F' : 'F';
      const grant = (value) => `*${value}:${rights}`;
      runTool(run, 'icacls.exe', [
        target,
        '/inheritance:r',
        '/grant:r', grant(SYSTEM_SID),
        '/grant:r', grant(ADMINISTRATORS_SID),
        '/grant:r', grant(sid),
      ]);
      return { protected: true, sid };
    },
    check(target) {
      const sid = this.userSid();
      const saved = path.join(os.tmpdir(), `hivem1nd-acl-${randomBytes(6).toString('hex')}.txt`);
      try {
        runTool(run, 'icacls.exe', [target, '/save', saved, '/Q']);
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
  runner.check(file);
  return { protected: true, sid: runner.userSid() };
}

export async function verifyBootstrapFiles(directory, file, options = {}) {
  if (process.platform !== 'win32') {
    await verifyLocalPermissions(directory);
    await verifyLocalPermissions(file);
    return { ok: true };
  }
  aclRunnerFrom(options).check(file);
  return { ok: true };
}

export function createCredentialStore({ now = () => Date.now() } = {}) {
  const records = new Map();
  return {
    issue(input) {
      const secret = randomBytes(32);
      const token = secret.toString('base64url');
      const record = {
        secret,
        audience: input.audience,
        unitId: input.unitId ?? null,
        sessionId: input.sessionId ?? null,
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
      if (!record) throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
      const supplied = Buffer.from(String(token), 'base64url');
      const left = record.secret;
      const right = supplied.length === left.length ? supplied : left;
      const expired = record.expiresAt != null && now() >= Date.parse(record.expiresAt);
      if (!timingSafeEqual(left, right) || supplied.length !== left.length || expired) {
        throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
      }
      return { ...record, secret: undefined, token };
    },
    revoke(token) {
      records.delete(token);
    },
    revokeAudience(audience) {
      for (const [token, record] of records) {
        if (record.audience === audience) records.delete(token);
      }
    },
  };
}

export function authorize(credential, operation, object = {}) {
  if (!credential) throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
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
    if ((operation === 'editor.write' || operation === 'comment.write') && object.attached !== true && credential.attached !== true) throw new CoreError(403, 'forbidden', 'The agent is not attached to that resource.');
    if (operation === 'approval.request' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot request for another unit.');
    return { allowed: true };
  }
  if (credential.audience === 'desktop' && DESKTOP.includes(operation)) return { allowed: true };
  throw new CoreError(403, 'forbidden', 'The operation is not allowed.');
}

export function checkPeer(remoteAddress, listener) {
  const address = normalizeAddress(remoteAddress);
  if (listener.kind === 'loopback') {
    if (address !== '127.0.0.1') throw new CoreError(403, 'forbidden', 'The peer is not loopback.');
    return { ok: true };
  }
  if (!inSubnet(address, listener.address, listener.netmask)) throw new CoreError(403, 'forbidden', 'The peer is not on the home network.');
  return { ok: true };
}

export function checkHost(host, listener) {
  const expected = `${listener.address}:${listener.port}`;
  if (typeof host !== 'string' || host.includes(',') || host.toLowerCase() !== expected.toLowerCase()) {
    throw new CoreError(403, 'forbidden', 'The Host header does not match the listener.');
  }
  return { ok: true };
}

export function checkOrigin(origin, listener, { write = false } = {}) {
  const expected = `http://${listener.address}:${listener.port}`;
  if (!origin && !write) return { ok: true };
  if (origin !== expected) throw new CoreError(403, 'forbidden', 'The Origin header does not match the listener.');
  return { ok: true };
}

export function checkLimits(bucket, input, now = Date.now()) {
  const window = 60000;
  bucket.requests ??= [];
  bucket.streams ??= new Set();
  bucket.peers ??= new Map();
  bucket.grantFailures ??= [];
  if (typeof input.url === 'string' && input.url.length > 2048) throw new CoreError(414, 'request_too_large', 'The request target is too long.');
  if ((input.headerBytes ?? 0) > 8192) throw new CoreError(431, 'request_too_large', 'The request headers are too large.');
  bucket.requests = bucket.requests.filter((at) => now - at < window);
  if (bucket.requests.length >= 240) throw new CoreError(429, 'rate_limited', 'Too many requests.', {}, new Date(bucket.requests[0] + window).toISOString());
  if (input.stream === true && bucket.streams.size >= 4) throw new CoreError(429, 'rate_limited', 'Too many streams.', {}, new Date(now + 1000).toISOString());
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
  } else {
    bucket.requests.push(now);
  }
  return { ok: true };
}

export function safeError(error, requestId) {
  return {
    error: {
      code: typeof error?.code === 'string' ? error.code : 'internal',
      message: 'The request failed.',
      requestId,
      retryAt: error?.retryAt ?? null,
    },
  };
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

function assertLimitedAcl(text, userSid) {
  const marker = text.indexOf('D:');
  if (marker < 0) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
  const dacl = text.slice(marker).split(/\r?\n/, 1)[0].trim();
  const flags = dacl.slice(2).split('(', 1)[0];
  if (!flags.includes('P')) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder still inherits permissions.');
  const allowed = new Set([SYSTEM_SID, ADMINISTRATORS_SID, 'SY', 'BA', userSid.toUpperCase()]);
  const aces = [...dacl.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]);
  if (aces.length < 1) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
  let sawUser = false;
  let sawSystem = false;
  let sawAdmin = false;
  for (const ace of aces) {
    const fields = ace.split(';');
    if (fields.length < 6) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL could not be read.');
    if ((fields[1] ?? '').includes('ID')) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder still inherits permissions.');
    const trustee = fields[5].toUpperCase();
    if (!allowed.has(trustee)) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL is not limited to the owner.');
    if (trustee === userSid.toUpperCase()) sawUser = true;
    if (trustee === 'SY' || trustee === SYSTEM_SID) sawSystem = true;
    if (trustee === 'BA' || trustee === ADMINISTRATORS_SID) sawAdmin = true;
  }
  if (!sawUser || !sawSystem || !sawAdmin) throw new CoreError(503, 'bootstrap_unavailable', 'The private folder ACL is not limited to the owner.');
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
