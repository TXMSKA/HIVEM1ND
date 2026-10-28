import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import { isIP } from 'node:net';
import { eligibleAddresses } from './addresses.mjs';
import { CoreError, validateMachineName } from '../service/identity.mjs';
import { decodePack, MAX_PACK_BYTES } from '../sync/pack.mjs';

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function signature(key, method, route, body, timestamp, nonce) {
  return createHmac('sha256', key).update([method, route, hash(body), timestamp, nonce].join('\n')).digest('hex');
}
function responseSignature(key, nonce, status, body) {
  return createHmac('sha256', key).update(['response', nonce, status, hash(body)].join('\n')).digest('hex');
}
function equal(left, right) {
  return typeof left === 'string' && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function unavailable() { return new CoreError(503, 'relan_unavailable', 'The ReLAN member is unavailable.'); }
function unauthorized() { return new CoreError(401, 'unauthorized', 'Unauthorized.'); }

export async function openRelanListener({ transport, keyProvider, getKey, pairing, addresses, interfaces, port = 0,
  allowLoopback = false, now = () => Date.now(), longPollMs = 15000, onPeer, getState } = {}) {
  const available = eligibleAddresses(typeof interfaces === 'function' ? interfaces() : interfaces);
  const requested = addresses ?? available.map(item => item.address);
  if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length) {
    throw new CoreError(422, 'invalid_relan_address', 'No private ReLAN interface is available.');
  }
  for (const address of requested) {
    if (!available.some(item => item.address === address) && !(allowLoopback && isIP(address) === 4 && address.startsWith('127.'))) {
      throw new CoreError(422, 'invalid_relan_address', 'The ReLAN address is not a current private IPv4 interface.');
    }
  }
  const nonces = new Map();
  const pending = new Set();
  const listeners = [];
  let sharedPort = port;
  let revision = 0;
  let closed = false;
  const changed = () => {
    revision += 1;
    for (const wake of [...pending]) wake();
    return revision;
  };
  const decrypt = (packed, material, key) => {
    const decoded = decodePack(packed, { keyProvider: keyProvider ?? (() => key) });
    if (decoded.header.encryption.algorithm !== 'aes-256-gcm') throw new CoreError(422, 'unencrypted_pack', 'ReLAN only transfers encrypted packs.');
    if (material?.keyId && decoded.header.encryption.keyId !== material.keyId) throw new CoreError(422, 'encryption_key_missing', 'The ReLAN pack does not use the current key.');
    return packed;
  };
  const serve = async (req, res) => {
    let key = null;
    let nonce = '';
    let authenticated = false;
    let pairingRequest = false;
    const send = (status, value = null, binary = false) => {
      if (res.destroyed || res.writableEnded) return;
      const body = value === null ? Buffer.alloc(0) : binary ? value : Buffer.from(JSON.stringify(value));
      const headers = { 'content-type': binary ? 'application/octet-stream' : 'application/json', 'content-length': body.length, 'cache-control': 'no-store' };
      if (key) headers['x-hivem1nd-signature'] = responseSignature(key, nonce, status, body); // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
      res.writeHead(status, headers); res.end(body);
    };
    try {
      const route = req.url ?? '';
      if (req.method === 'POST' && (route === '/pair/start' || route === '/pair/finish')) {
        pairingRequest = true;
        if (!pairing) throw unauthorized();
        const input = JSON.parse((await readBody(req, 16384)).toString('utf8'));
        const peer = req.socket.remoteAddress ?? '';
        const result = route === '/pair/start' ? await pairing.handleStart(input, peer) : await pairing.handleFinish(input, peer);
        send(200, result); return;
      }
      const material = await getKey?.();
      key = Buffer.isBuffer(material) ? material : material?.key;
      if (!Buffer.isBuffer(key) || key.length !== 32) { key = null; throw unauthorized(); }
      const timestamp = req.headers['x-hivem1nd-time']; // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
      nonce = req.headers['x-hivem1nd-nonce']; // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
      const presented = req.headers['x-hivem1nd-signature']; // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
      if (typeof timestamp !== 'string' || !/^[0-9]{1,16}$/.test(timestamp) || Math.abs(now() - Number(timestamp)) > 60000
        || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(nonce)) throw unauthorized();
      for (const [value, until] of nonces) if (now() > until) nonces.delete(value);
      if (nonces.has(nonce) || nonces.size >= 20000) throw unauthorized();
      const body = await readBody(req, MAX_PACK_BYTES);
      if (Math.abs(now() - Number(timestamp)) > 60000) throw unauthorized();
      if (!equal(presented, signature(key, req.method, route, body, timestamp, nonce))) throw unauthorized();
      if (nonces.has(nonce)) throw unauthorized();
      nonces.set(nonce, Number(timestamp) + 60000);
      authenticated = true;
      await onPeer?.({ address: req.socket.remoteAddress, at: now() });
      if (req.method === 'GET' && route === '/heads') { send(200, await transport.listHeads()); return; }
      if (req.method === 'GET' && route === '/state') { send(200, await getState?.() ?? {}); return; }
      if (req.method === 'PUT' && route === '/heads') {
        const result = await transport.writeHead(JSON.parse(body.toString('utf8')));
        changed(); send(200, { changed: result !== false }); return;
      }
      const pack = route.match(/^\/packs\/([A-Za-z0-9._-]+)\/([1-9][0-9]*)$/);
      if (pack && (req.method === 'GET' || req.method === 'PUT')) {
        const machine = validateMachineName(pack[1]);
        const sequence = Number(pack[2]);
        if (!Number.isSafeInteger(sequence)) throw new CoreError(422, 'invalid_pack', 'The pack sequence is not valid.');
        if (req.method === 'GET') {
          const packed = await transport.readPack(machine, sequence);
          if (packed == null) { send(404); return; }
          send(200, decrypt(packed, material, key), true); return;
        }
        const result = await transport.writePack(machine, sequence, decrypt(body, material, key));
        changed(); send(200, { changed: result !== false }); return;
      }
      const changes = route.match(/^\/changes\?after=([0-9]+)$/);
      if (req.method === 'GET' && changes) {
        const after = Number(changes[1]);
        if (!Number.isSafeInteger(after)) throw new CoreError(422, 'invalid_body', 'The change revision is not valid.');
        if (after === revision && !closed) await new Promise(resolve => {
          const wake = () => { clearTimeout(timer); pending.delete(wake); res.off('close', wake); resolve(); };
          const timer = setTimeout(wake, longPollMs); timer.unref?.();
          pending.add(wake); res.once('close', wake);
        });
        send(200, { revision }); return;
      }
      send(404);
    } catch (error) {
      if (!authenticated) {
        const status = pairingRequest && error?.status === 429 ? 429 : 401;
        key = null; send(status, { error: status === 429 ? 'pairing_locked' : 'unauthorized' });
      } else send(error?.status >= 400 && error?.status <= 599 ? error.status : 400, { error: 'request_refused' });
    }
  };
  try {
    for (const address of requested) {
      const sockets = new Set();
      const server = createServer((req, res) => { void serve(req, res); });
      server.requestTimeout = 30000;
      server.headersTimeout = 10000;
      server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(sharedPort, address, () => { server.removeListener('error', reject); resolve(); });
      });
      server.unref();
      sharedPort = server.address().port;
      listeners.push({ address, port: server.address().port, close: () => new Promise(resolve => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }) });
    }
  } catch (error) {
    for (const listener of listeners) await listener.close();
    throw error;
  }
  return {
    listeners: listeners.map(({ address, port: boundPort }) => ({ address, port: boundPort })),
    changed,
    get revision() { return revision; },
    async close() {
      closed = true; changed();
      await Promise.all(listeners.map(listener => listener.close()));
    },
  };
}

export function openRelanTransport({ host, address = host, port, key, now = () => Date.now(), timeoutMs = 20000, onWire } = {}) {
  if (isIP(address) !== 4 || address === '0.0.0.0' || !Number.isInteger(port) || port < 1 || port > 65535
    || !Buffer.isBuffer(key) || key.length !== 32) throw new CoreError(422, 'invalid_relan_transport', 'The ReLAN peer is not valid.');
  let revision = 0;
  const controller = new AbortController();
  const call = (method, route, body = Buffer.alloc(0), signal) => {
    const timestamp = String(now());
    const nonce = randomBytes(24).toString('base64url');
    onWire?.(body);
    return new Promise((resolve, reject) => {
      const req = request({ hostname: address, port, path: route, method, timeout: timeoutMs, agent: false,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        headers: { 'content-length': body.length, 'x-hivem1nd-time': timestamp, 'x-hivem1nd-nonce': nonce, // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
          'x-hivem1nd-signature': signature(key, method, route, body, timestamp, nonce) } }, response => { // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_PACK_BYTES) response.destroy(unavailable()); else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const packed = Buffer.concat(chunks); onWire?.(packed);
          if (!equal(response.headers['x-hivem1nd-signature'], responseSignature(key, nonce, response.statusCode, packed))) return reject(unauthorized()); // Compatibility: wire identifiers keep existing native sessions and paired machines connected.
          if (response.statusCode === 404) { resolve(null); return; }
          if (response.statusCode !== 200) { reject(new CoreError(response.statusCode, 'relan_refused', 'The ReLAN request was refused.')); return; }
          resolve(packed);
        });
      });
      req.on('timeout', () => req.destroy(unavailable()));
      req.on('error', reject); req.end(body);
    });
  };
  const json = async (...args) => {
    const packed = await call(...args);
    try { return packed === null ? null : JSON.parse(packed.toString('utf8')); } catch { throw unavailable(); }
  };
  const packRoute = (machine, sequence) => {
    validateMachineName(machine);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new CoreError(422, 'invalid_pack', 'The pack sequence is not valid.');
    return `/packs/${machine}/${sequence}`;
  };
  const encryptedPack = packed => {
    const decoded = decodePack(packed, { keyProvider: () => key });
    if (decoded.header.encryption.algorithm !== 'aes-256-gcm') throw new CoreError(422, 'unencrypted_pack', 'ReLAN only transfers encrypted packs.');
    return packed;
  };
  return {
    listHeads: () => json('GET', '/heads'),
    async readPack(machine, sequence) {
      const packed = await call('GET', packRoute(machine, sequence));
      return packed === null ? null : encryptedPack(packed);
    },
    async writePack(machine, sequence, packed) {
      return json('PUT', packRoute(machine, sequence), encryptedPack(Buffer.from(packed)));
    },
    writeHead: head => json('PUT', '/heads', Buffer.from(JSON.stringify(head))),
    getState: () => json('GET', '/state'),
    async waitForChange({ signal } = {}) {
      while (true) {
        const result = await json('GET', `/changes?after=${revision}`, Buffer.alloc(0), signal);
        if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw unavailable();
        if (result.revision === revision) continue;
        revision = result.revision;
        return result;
      }
    },
    close: () => controller.abort(),
  };
}

function readBody(req, maximum) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maximum) { reject(new CoreError(413, 'resource_too_large', 'The ReLAN request is too large.')); req.resume(); }
      else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
