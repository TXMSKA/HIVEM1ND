import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { CoreError } from './identity.mjs';
import { checkLimits } from './security.mjs';
import { encodeQr } from './qr.mjs';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LIFETIME_MS = 43200000;
const POLL_MS = 15000;

export function eligibleAddresses(interfaces = networkInterfaces()) {
  const rows = flatten(interfaces).filter((item) => item.internal !== true && isPrivate(item.address) && !String(item.address).includes(':'));
  rows.sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address, 'en'));
  return rows.map((item) => ({ name: item.name, address: item.address, netmask: item.netmask }));
}

export async function openHome(context, input = {}) {
  await closeHome(context, { reason: context.grant ? 'replaced' : null, quiet: !context.grant });
  context.grant = null;
  const available = eligibleAddresses(context.interfaces?.() ?? networkInterfaces());
  const selected = selectAddresses(available, input.addresses);
  const opened = [];
  try {
    for (const address of selected) opened.push(await bindAddress(context, address));
  } catch (error) {
    await closeAll(opened);
    if (error instanceof CoreError) throw error;
    throw new CoreError(503, 'listener_unavailable', 'A home listener could not be opened.');
  }
  const openedAt = new Date(context.now()).toISOString();
  const expiresAt = new Date(context.now() + LIFETIME_MS).toISOString();
  const key = randomBytes(32).toString('base64url');
  let code = '';
  for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  const links = opened.map((listener) => `http://${listener.address}:${listener.port}/#home=${key}`);
  try {
    for (const link of links) encodeQr(link);
  } catch (error) {
    await closeAll(opened);
    throw error;
  }
  const grant = {
    enabled: true,
    key,
    code,
    openedAt,
    expiresAt,
    listeners: opened,
    tokens: new Set(),
    addresses: opened.map((listener) => ({ origin: `http://${listener.address}:${listener.port}` })),
  };
  context.grant = grant;
  arm(context, grant);
  emit(context, 'opened');
  return grantView(context, true);
}

export async function closeHome(context, options = {}) {
  const grant = context.grant;
  if (!grant) return status(context);
  grant.enabled = false;
  for (const token of grant.tokens) context.credentials?.revoke(token);
  grant.tokens.clear();
  await closeAll(grant.listeners ?? []);
  grant.listeners = [];
  if (grant.expiry) grant.expiry.cleared = true;
  if (grant.poll) grant.poll.cleared = true;
  context.grant = null;
  if (options.quiet !== true) emit(context, options.reason ?? 'closed');
  return status(context);
}

export async function exchange(context, input, peer) {
  const grant = context.grant;
  const bucket = context.bucket ?? { peers: new Map(), grantFailures: [] };
  context.bucket = bucket;
  if (!grant?.enabled || context.now() >= Date.parse(grant?.expiresAt ?? 0)) {
    if (grant?.enabled) await closeHome(context, { reason: 'expired' });
    throw new CoreError(410, 'home_expired', 'Home access is not active.');
  }
  const presented = presentedSecret(input);
  const expected = input && Object.hasOwn(input, 'code') ? grant.code : grant.key;
  if (!safeEqual(expected, presented)) {
    checkLimits(bucket, { homeFailure: true, peer: peer ?? 'unknown' }, context.now());
    throw new CoreError(401, 'invalid_home_key', 'The home key is not valid.');
  }
  const issued = context.credentials.issue({
    audience: 'phone',
    expiresAt: grant.expiresAt,
  });
  grant.tokens.add(issued.token);
  return { token: issued.token, audience: 'phone', expiresAt: grant.expiresAt, capabilities: issued.capabilities };
}

export function status(context) {
  const grant = context.grant;
  if (!grant?.enabled) return { enabled: false, openedAt: null, expiresAt: null, addresses: [], remainingSeconds: 0 };
  const remaining = Math.max(0, Math.ceil((Date.parse(grant.expiresAt) - context.now()) / 1000));
  return {
    enabled: true,
    openedAt: grant.openedAt,
    expiresAt: grant.expiresAt,
    addresses: grant.addresses.map((item) => ({ origin: item.origin })),
    remainingSeconds: remaining,
  };
}

export async function pollHome(context) {
  const grant = context.grant;
  if (!grant?.enabled) return status(context);
  const current = new Map(eligibleAddresses(context.interfaces?.() ?? networkInterfaces()).map((item) => [item.address, item.netmask]));
  const survivors = [];
  for (const listener of grant.listeners) {
    if (current.get(listener.address) !== listener.netmask) {
      await listener.close();
      continue;
    }
    survivors.push(listener);
  }
  grant.listeners = survivors;
  if (survivors.length === 0) return closeHome(context, { reason: 'closed' });
  grant.addresses = survivors.map((listener) => ({ origin: `http://${listener.address}:${listener.port}` }));
  return status(context);
}

function selectAddresses(available, requested) {
  if (requested == null) {
    if (available.length === 0) throw new CoreError(422, 'invalid_home_address', 'No private network address is available.');
    return [available[0]];
  }
  if (!Array.isArray(requested) || requested.length === 0) throw new CoreError(422, 'invalid_home_address', 'The home address list is not valid.');
  if (new Set(requested).size !== requested.length) throw new CoreError(422, 'invalid_home_address', 'A home address is repeated.');
  return requested.map((address) => {
    const found = available.find((item) => item.address === address);
    if (!found) throw new CoreError(422, 'invalid_home_address', 'The home address is not a current private interface.');
    return found;
  });
}

async function bindAddress(context, address) {
  if (context.listen) return context.listen(address);
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, address.address, () => resolve());
  });
  const bound = server.address();
  return {
    address: address.address,
    netmask: address.netmask,
    port: bound.port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function arm(context, grant) {
  const schedule = context.schedule ?? ((fn) => ({ fn, cleared: false }));
  const expiry = schedule(() => {
    if (!expiry.cleared && context.grant === grant) return closeHome(context, { reason: 'expired' });
    return null;
  }, LIFETIME_MS);
  grant.expiry = expiry;
  schedulePoll(context, grant, schedule);
}

function schedulePoll(context, grant, schedule) {
  const poll = schedule(() => {
    if (poll.cleared || context.grant !== grant) return;
    pollHome(context).catch(() => {});
    schedulePoll(context, grant, schedule);
  }, POLL_MS);
  grant.poll = poll;
}

function grantView(context, includeSecret) {
  const view = status(context);
  if (!includeSecret) return view;
  const grant = context.grant;
  return { ...view, key: grant.key, shortCode: grant.code, links: grant.listeners.map((listener) => `http://${listener.address}:${listener.port}/#home=${grant.key}`), qrPayloads: grant.listeners.map((listener) => `http://${listener.address}:${listener.port}/#home=${grant.key}`) };
}

function emit(context, reason) {
  context.bus?.emit({ name: 'home.changed', data: { home: status(context), reason } });
}

function presentedSecret(input) {
  const keys = Object.keys(input ?? {});
  if (keys.length !== 1 || (!keys.includes('key') && !keys.includes('code'))) {
    throw new CoreError(422, 'invalid_body', 'Home exchange needs exactly a key or a code.');
  }
  const value = keys[0] === 'code' ? String(input.code).toUpperCase() : String(input.key);
  return value;
}

function safeEqual(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function flatten(interfaces) {
  if (Array.isArray(interfaces)) return interfaces;
  const rows = [];
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    for (const entry of entries ?? []) rows.push({ name, ...entry });
  }
  return rows;
}

function isPrivate(address) {
  const parts = String(address ?? '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

async function closeAll(listeners) {
  for (const listener of listeners) {
    try { await listener.close(); } catch { /* The listener is already gone. */ }
  }
}
