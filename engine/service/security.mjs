import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './identity.mjs';

const DESKTOP = Object.freeze(['read', 'chat.post', 'chat.manage', 'mailbox.read', 'approval.answer', 'grant.revoke', 'task.status', 'task.undo', 'unit.create', 'unit.connect', 'session.start', 'session.stop', 'layout.write', 'settings.write', 'home.manage', 'editor.read', 'editor.write', 'comment.write', 'proposal.answer', 'asset.write', 'watch', 'viewer.write']);
const PHONE = new Set(['read', 'chat.post', 'master.read', 'approval.answer', 'task.accept', 'task.send-back']);
const PROTECT_SCRIPT = Buffer.from(`
$ErrorActionPreference = 'Stop'
$path = $env:HIVEM1ND_PROTECT_PATH
$sid = $env:HIVEM1ND_PROTECT_SID
$acl = [System.IO.File]::GetAccessControl($path)
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$identifier = New-Object System.Security.Principal.SecurityIdentifier($sid)
$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identifier, 'FullControl', 'Allow')))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'FullControl', 'Allow')))
[System.IO.File]::SetAccessControl($path, $acl)
$checked = [System.IO.File]::GetAccessControl($path).Access
foreach ($rule in $checked) {
  if ($rule.IsInherited) { exit 2 }
  $value = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($value -ne $sid -and $value -ne 'S-1-5-18') { exit 3 }
}
`, 'utf16le').toString('base64');

const SID_SCRIPT = Buffer.from('$ErrorActionPreference = \'Stop\'; [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value', 'utf16le').toString('base64');

export async function protectLocalFile(file, options = {}) {
  if (options.fail === true) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  await mkdir(path.dirname(file), { recursive: true });
  if (process.platform === 'win32') {
    const sid = options.sid ?? await currentSid();
    await runPowerShell(PROTECT_SCRIPT, { HIVEM1ND_PROTECT_PATH: file, HIVEM1ND_PROTECT_SID: sid }, options);
    await verifyLocalPermissions(file, { sid });
    return { protected: true, sid };
  }
  await chmod(path.dirname(file), 0o700);
  await chmod(file, 0o600);
  await verifyLocalPermissions(file);
  return { protected: true };
}

export async function verifyLocalPermissions(file, options = {}) {
  if (process.platform === 'win32') {
    const sid = options.sid ?? await currentSid();
    const output = await runPowerShell(Buffer.from(`
$ErrorActionPreference = 'Stop'
$sid = $env:HIVEM1ND_PROTECT_SID
$rules = [System.IO.File]::GetAccessControl($env:HIVEM1ND_PROTECT_PATH).Access
if ($rules.Count -lt 1) { exit 4 }
foreach ($rule in $rules) {
  if ($rule.IsInherited) { exit 2 }
  $value = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($value -ne $sid -and $value -ne 'S-1-5-18') { exit 3 }
}
Write-Output 'ok'
`, 'utf16le').toString('base64'), { HIVEM1ND_PROTECT_PATH: file, HIVEM1ND_PROTECT_SID: sid }, options);
    if (!output.includes('ok')) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
    return { ok: true };
  }
  const info = await stat(file);
  if ((info.mode & 0o077) !== 0) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
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
        expiresAt: input.expiresAt,
        viewerId: input.viewerId ?? null,
        attached: input.attached ?? null,
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
      if (!timingSafeEqual(left, right) || supplied.length !== left.length || now() >= Date.parse(record.expiresAt)) {
        throw new CoreError(401, 'unauthorized', 'The credential is not valid.');
      }
      return { ...record, secret: undefined, token };
    },
    revoke(token) {
      records.delete(token);
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
    if (['approval.answer', 'task.accept', 'task.undo', 'settings.write', 'grant.revoke', 'unit.create', 'session.start'].includes(operation)) {
      throw new CoreError(403, 'forbidden', 'The agent cannot perform that operation.');
    }
    if (operation === 'read' && object.scope !== 'own') throw new CoreError(403, 'forbidden', 'The agent cannot read that.');
    if (operation === 'mailbox.read' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot read that mailbox.');
    if (operation === 'task.status' && object.unitId !== credential.unitId) throw new CoreError(403, 'forbidden', 'The agent cannot change that task.');
    if (operation === 'editor.write' && credential.attached !== true) throw new CoreError(403, 'forbidden', 'The agent is not attached to that resource.');
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
  if ((input.headerBytes ?? 0) > 16384) throw new CoreError(431, 'request_too_large', 'The request headers are too large.');
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

async function currentSid() {
  const output = await runPowerShell(SID_SCRIPT, {});
  const sid = output.trim().split(/\s+/).at(-1);
  if (!/^S-\d+-\d+(?:-\d+)+$/.test(sid ?? '')) throw new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.');
  return sid;
}

function runPowerShell(encoded, env, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    options.handles?.push(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.'));
    }, 8000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new CoreError(503, 'bootstrap_unavailable', 'The bootstrap file could not be protected.'));
      else resolve(stdout);
      void stderr;
    });
  });
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
