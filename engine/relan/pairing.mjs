import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { request } from 'node:http';
import { CoreError } from '../service/identity.mjs';
import { cpaceGenerator, cpaceKey, cpaceMultiply } from './cpace.mjs';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const WINDOW_MS = 600000;
const VERSION = 'hivem1nd-relan-pair-v2';

function refused(locked = false) {
  return new CoreError(locked ? 429 : 401, locked ? 'pairing_locked' : 'pairing_refused', locked ? 'Pairing is locked for 10 minutes.' : 'The ReLAN pairing was refused.');
}

function bytes(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw refused();
  const result = Buffer.from(value, 'base64url');
  if (result.length !== size || result.toString('base64url') !== value) throw refused();
  return result;
}

function channel(nonce) {
  return Buffer.from(JSON.stringify([VERSION, 'server', 'client', nonce]));
}

function transcript(client, server, session) {
  return Buffer.from(JSON.stringify([VERSION, client.publicKey, client.nonce, server.publicKey, session]));
}

function exchangeKey(scalar, client, server, session) {
  const clientPoint = bytes(client.publicKey, 32), serverPoint = bytes(server.publicKey, 32);
  const secret = cpaceMultiply(scalar, clientPoint);
  return cpaceKey(secret, bytes(session, 24), serverPoint, clientPoint, channel(client.nonce));
}

function confirmation(key, role, context) {
  return createHmac('sha256', key).update(role).update(context).digest();
}

export function createPairing({ getKey, ensureKey, now = () => Date.now() } = {}) {
  let grant = null;
  let failures = 0;
  let lockedUntil = 0;
  const sessions = new Map();
  const allowed = () => {
    if (now() < lockedUntil) throw refused(true);
    if (lockedUntil) { lockedUntil = 0; failures = 0; }
    if (!grant || now() >= grant.expiresAt) throw refused();
  };
  const failure = () => {
    failures += 1;
    if (failures >= 5) { lockedUntil = now() + WINDOW_MS; sessions.clear(); throw refused(true); }
    throw refused();
  };
  return {
    showCode() {
      if (now() < lockedUntil) throw refused(true);
      let code = '';
      for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
      grant = { code, expiresAt: now() + WINDOW_MS };
      sessions.clear();
      return { code, expiresAt: new Date(grant.expiresAt).toISOString() };
    },
    handleStart(input, peer = '') {
      allowed();
      try {
        if (Object.keys(input ?? {}).sort().join(',') !== 'nonce,version' || input.version !== VERSION) throw refused();
        bytes(input.nonce, 16);
        for (const [id, item] of sessions) if (now() >= item.expiresAt) sessions.delete(id);
        if (sessions.size >= 128) throw refused();
        const scalar = randomBytes(32);
        const session = randomBytes(24).toString('base64url');
        const generator = cpaceGenerator(grant.code, bytes(session, 24), channel(input.nonce));
        const response = { version: VERSION, session, publicKey: cpaceMultiply(scalar, generator).toString('base64url') };
        sessions.set(session, { scalar, server: response, nonce: input.nonce, peer, expiresAt: Math.min(grant.expiresAt, now() + 60000) });
        return response;
      } catch { throw refused(); }
    },
    async handleFinish(input, peer = '') {
      allowed();
      const session = sessions.get(input?.session);
      sessions.delete(input?.session);
      if (!session || session.peer !== peer || now() >= session.expiresAt) return failure();
      let proof, key, context;
      try {
        if (Object.keys(input ?? {}).sort().join(',') !== 'proof,publicKey,session') throw refused();
        proof = bytes(input.proof, 32);
        const client = { publicKey: input.publicKey, nonce: session.nonce };
        key = exchangeKey(session.scalar, client, session.server, input.session);
        context = transcript(client, session.server, input.session);
      } catch { return failure(); }
      if (!timingSafeEqual(proof, confirmation(key, 'client', context))) return failure();
      const material = (await getKey?.()) ?? await ensureKey?.();
      if (!material?.key || material.key.length !== 32) throw refused();
      failures = 0;
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(context);
      const plaintext = Buffer.from(JSON.stringify({ relanId: material.relanId, keyId: material.keyId, key: material.key.toString('base64url') }));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { nonce: nonce.toString('base64url'), encrypted: encrypted.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), proof: confirmation(key, 'server', context).toString('base64url') };
    },
  };
}

export async function pairRelan({ address, port, code, timeoutMs = 5000, onWire } = {}) {
  const presented = String(code ?? '').toUpperCase();
  if (presented.length !== 6 || [...presented].some(character => !ALPHABET.includes(character))) throw refused();
  const client = { version: VERSION, nonce: randomBytes(16).toString('base64url') };
  const server = await post(address, port, '/pair/start', client, timeoutMs, onWire);
  let key, context;
  try {
    if (Object.keys(server ?? {}).sort().join(',') !== 'publicKey,session,version' || server.version !== VERSION) throw refused();
    const scalar = randomBytes(32), session = bytes(server.session, 24), serverPoint = bytes(server.publicKey, 32);
    const generator = cpaceGenerator(presented, session, channel(client.nonce));
    client.publicKey = cpaceMultiply(scalar, generator).toString('base64url');
    key = cpaceKey(cpaceMultiply(scalar, serverPoint), session, serverPoint, bytes(client.publicKey, 32), channel(client.nonce));
    context = transcript(client, server, server.session);
  } catch { throw refused(); }
  const response = await post(address, port, '/pair/finish', { session: server.session, publicKey: client.publicKey,
    proof: confirmation(key, 'client', context).toString('base64url') }, timeoutMs, onWire);
  try {
    if (!timingSafeEqual(bytes(response.proof, 32), confirmation(key, 'server', context))) throw refused();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes(response.nonce, 12));
    decipher.setAAD(context); decipher.setAuthTag(bytes(response.tag, 16));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(response.encrypted, 'base64url')), decipher.final()]).toString('utf8'));
    if (typeof value.relanId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.relanId)
      || typeof value.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.keyId)) throw refused();
    return { relanId: value.relanId, keyId: value.keyId, key: bytes(value.key, 32) };
  } catch { throw refused(); }
}

function post(address, port, route, value, timeoutMs, onWire) {
  const body = Buffer.from(JSON.stringify(value));
  onWire?.(body);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: address, port, path: route, method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': body.length }, agent: false }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 16384) response.destroy(refused()); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        const packed = Buffer.concat(chunks); onWire?.(packed);
        if (response.statusCode !== 200) return reject(refused(response.statusCode === 429));
        try { resolve(JSON.parse(packed.toString('utf8'))); } catch { reject(refused()); }
      });
    });
    req.on('timeout', () => req.destroy(new CoreError(503, 'relan_unavailable', 'The ReLAN pairing timed out.')));
    req.on('error', reject); req.end(body);
  });
}
