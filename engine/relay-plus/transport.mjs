import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreError, canonicalJson, hashBytes, validateMachineName } from '../service/identity.mjs';
import { decodePack, validateHead } from '../sync/pack.mjs';
import { classifyRelayFailure } from './client.mjs';

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const HEAD = /^writers\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})\/heads\/([0-9]{1,20})\.enc$/;
const DATASET = '/v1/datasets/hivem1nd';

function completeHead(value, options) {
  const head = validateHead(value, options);
  if (head.packs.some((entry, index) => entry.sequence !== index + 1)) throw new CoreError(422, 'invalid_pack', 'The head must retain every prior pack.');
  return head;
}

// Quantum authorizes computerId writer namespaces; machine names live only inside encrypted heads.
export function openRelayPlusTransport({ client, computerId, machine, generation = '1', accountId,
  keyId, keyProvider, headKey, sealMindKey, openMindKey, mindId,
  onState = () => {} } = {}) {
  if (!client?.request || !SEGMENT.test(computerId ?? '') || !SEGMENT.test(generation)
    || typeof accountId !== 'string' || !accountId || typeof keyId !== 'string') {
    throw new CoreError(422, 'invalid_relay_plus', 'Relay+ needs an account, writer namespace and key.');
  }
  machine = validateMachineName(machine);
  let writable = true;
  let registered = false;
  let locations = new Map();
  const own = `writers/${computerId}/${generation}`;
  const objectRoute = location => `${DATASET}/objects/${location.split('/').map(encodeURIComponent).join('/')}`;
  const request = async (route, options) => {
    try { return await client.request(route, options); }
    catch (error) {
      const classified = classifyRelayFailure(error);
      if (classified?.state === 'read-only') { writable = false; onState(classified); }
      else if (classified) onState(classified);
      else if (['pool_exceeded', 'object_too_large', 'object_limit', 'writer_limit_exceeded'].includes(error.code)) onState({ state: 'limited', code: error.code, fields: error.fields });
      throw error;
    }
  };
  const read = async location => {
    try { return Buffer.from(await request(objectRoute(location), { binary: true })); }
    catch (error) { if (error.status === 404 || error.code === 'not_found') return null; throw error; }
  };
  const list = async () => {
    const result = [];
    let after = null;
    do {
      let page;
      try { page = await request(`${DATASET}/objects?limit=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`); }
      catch (error) { if (error.status === 404 || error.code === 'not_found') return []; throw error; }
      result.push(...page.objects);
      if (page.after && page.after === after) throw new CoreError(502, 'invalid_response', 'The object listing cursor did not advance.');
      after = page.after;
    } while (after);
    return result;
  };
  const ensureDataset = async () => {
    if (registered) return;
    await request(DATASET, { method: 'PUT' });
    registered = true;
  };
  const put = async (location, bytes, limit) => {
    if (bytes.length > limit) throw new CoreError(413, 'object_too_large', 'The Relay+ object exceeds its kind limit.');
    await ensureDataset();
    try {
      await request(objectRoute(location), { method: 'PUT', body: bytes, headers: {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-Content-SHA256': hashBytes(bytes),
      } });
      return true;
    } catch (error) {
      if (error.code !== 'object_conflict') throw error;
      const existing = await read(location);
      if (existing?.equals(bytes)) return false;
      throw error;
    }
  };
  const key = id => {
    const value = keyProvider?.(id);
    if (!(value instanceof Uint8Array) || value.byteLength !== 32) throw new CoreError(422, 'encryption_key_missing', 'The M1ND encryption key is unavailable.');
    return value;
  };
  const sealHead = (head, location) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', headKey ? headKey() : key(keyId), nonce);
    cipher.setAAD(Buffer.from(`onem1nd-relay-plus-head-v1:${accountId}:${location}:${keyId}`));
    const payload = sealMindKey ? { mindId, mindKey: sealMindKey(), head } : head;
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJson(payload))), cipher.final()]);
    return Buffer.from(canonicalJson({ format: 'onem1nd-relay-plus-head-v1', keyId, nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') }));
  };
  const openHead = async (bytes, location) => {
    try {
      if (bytes.length > 1000000) throw new Error('size');
      const envelope = JSON.parse(bytes.toString('utf8'));
      if (envelope.format !== 'onem1nd-relay-plus-head-v1') throw new Error('format');
      const nonce = Buffer.from(envelope.nonce, 'base64url');
      const tag = Buffer.from(envelope.tag, 'base64url');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error('envelope');
      const cipher = createDecipheriv('aes-256-gcm', headKey ? headKey() : key(envelope.keyId), nonce);
      cipher.setAAD(Buffer.from(`onem1nd-relay-plus-head-v1:${accountId}:${location}:${envelope.keyId}`));
      cipher.setAuthTag(tag);
      const payload = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64url')), cipher.final()]));
      if (openMindKey) {
        if (payload.mindId !== mindId) return null;
        await openMindKey(payload.mindKey);
        return completeHead(payload.head);
      }
      return completeHead(payload);
    } catch (error) {
      if (error.code === 'encryption_key_missing') throw error;
      throw new CoreError(422, 'authentication_failed', 'The Relay+ head could not be authenticated.');
    }
  };
  const transport = {
    canWriteMachine: owner => writable && owner === machine,
    get state() { return writable ? 'ready' : 'read-only'; },
    setWritable(value) {
      writable = value === true;
      if (writable) registered = false;
      onState({ state: writable ? 'ready' : 'read-only' });
    },
    async listHeads() {
      const candidates = new Map();
      for (const object of await list()) {
        const match = HEAD.exec(object.path);
        if (!match || BigInt(match[3]) < 1n) continue;
        const namespace = `writers/${match[1]}/${match[2]}`;
        const previous = candidates.get(namespace);
        if (!previous || BigInt(match[3]) > previous.sequence) candidates.set(namespace, { path: object.path, sequence: BigInt(match[3]), object });
      }
      const heads = new Map();
      const nextLocations = new Map();
      for (const [namespace, candidate] of candidates) {
        const bytes = await read(candidate.path);
        if (!bytes) continue; // A writer may remove an old head between listing and download; the held feed retries.
        if (hashBytes(bytes) !== candidate.object.sha256 || bytes.length !== candidate.object.size) throw new CoreError(422, 'corrupt_resource', 'The Relay+ head checksum does not match.');
        const head = await openHead(bytes, candidate.path);
        if (!head) continue;
        if (BigInt(head.sequence) !== candidate.sequence) throw new CoreError(422, 'corrupt_resource', 'The head sequence differs from its path.');
        const previous = heads.get(head.machine);
        if (previous) {
          validateHead(head.sequence >= previous.sequence ? head : previous, { previous: head.sequence >= previous.sequence ? previous : head });
          if (previous.sequence >= head.sequence) continue;
        }
        heads.set(head.machine, head);
        nextLocations.set(head.machine, namespace);
      }
      locations = nextLocations;
      return [...heads.values()];
    },
    async readPack(owner, sequence) {
      const namespace = owner === machine ? own : locations.get(owner);
      if (!namespace) return null;
      const bytes = await read(`${namespace}/packs/${sequence}.enc`);
      if (bytes) {
        const decoded = decodePack(bytes, { machine: owner, keyProvider });
        if (decoded.header.sequence !== sequence || decoded.header.encryption.algorithm !== 'aes-256-gcm') throw new CoreError(422, 'invalid_pack', 'Relay+ requires an encrypted pack matching its path.');
      }
      return bytes;
    },
    async writePack(owner, sequence, value) {
      if (owner !== machine) throw new CoreError(403, 'writer_forbidden', 'Only this computer may publish its writer namespace.');
      const bytes = Buffer.from(value);
      const decoded = decodePack(bytes, { machine: owner, keyProvider });
      if (decoded.header.sequence !== sequence || decoded.header.encryption.algorithm !== 'aes-256-gcm' || decoded.header.encryption.keyId !== keyId) throw new CoreError(422, 'invalid_pack', 'Relay+ requires a pack encrypted with the M1ND key.');
      return put(`${own}/packs/${sequence}.enc`, bytes, 50000000);
    },
    async writeHead(value) {
      const head = completeHead(value, { machine });
      if (head.sequence < 1) return false;
      const location = `${own}/heads/${head.sequence}.enc`;
      const existing = await read(location);
      if (existing) {
        if (canonicalJson(await openHead(existing, location)) !== canonicalJson(head)) throw new CoreError(409, 'object_conflict', 'The immutable head already contains different data.');
      } else {
        for (const entry of head.packs) {
          const bytes = await transport.readPack(machine, entry.sequence);
          if (!bytes) throw new CoreError(409, 'missing_pack', 'A head cannot be published before every pack.');
          validateHead(head, { packBytes: bytes, sequence: entry.sequence });
        }
        const bytes = sealHead(head, location);
        try { await put(location, bytes, 1000000); }
        catch (error) {
          if (error.code !== 'object_conflict') throw error;
          const concurrent = await read(location);
          if (!concurrent || canonicalJson(await openHead(concurrent, location)) !== canonicalJson(head)) throw error;
        }
      }
      for (const object of await list()) {
        const match = HEAD.exec(object.path);
        if (match && object.path.startsWith(`${own}/heads/`) && BigInt(match[3]) < BigInt(head.sequence)) {
          try { await request(objectRoute(object.path), { method: 'DELETE' }); }
          catch (error) { if (error.status !== 404 && error.code !== 'not_found') throw error; }
        }
      }
      return !existing;
    },
  };
  return transport;
}

// The caller connects applyPage/rebuild to Smart Pulse; the feed adds no periodic sync timer.
export function createRelayPlusFeed({ client, loadCursor = async () => null, saveCursor,
  applyPage, rebuild, onState = () => {}, wait = delay } = {}) {
  let running = null;
  let controller = null;
  const pause = async (seconds, signal) => { if (seconds > 0) await wait(seconds * 1000, undefined, { signal }); };
  const page = async (cursor, signal) => {
    const response = await client.response(`/v1/changes?limit=1000${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, { signal });
    return { value: await response.json(), retryAfter: Number(response.headers.get('retry-after')) || 0 };
  };
  const run = async signal => {
    let cursor = await loadCursor();
    let recovering = false;
    while (!signal.aborted) {
      try {
        if (recovering) {
          // Capture the new feed position before full listings, covering writes concurrent with rebuilding.
          const fresh = await page(null, signal);
          const bootstrap = await client.request('/v1/bootstrap', { signal });
          await rebuild(bootstrap, { signal });
          await saveCursor(fresh.value.cursor);
          cursor = fresh.value.cursor;
          recovering = false;
          await pause(fresh.retryAfter, signal);
          continue;
        }
        const result = await page(cursor, signal);
        await applyPage(result.value.changes, { signal });
        await saveCursor(result.value.cursor);
        cursor = result.value.cursor;
        await pause(result.retryAfter, signal);
      } catch (error) {
        if (signal.aborted) break;
        if (error.code === 'cursor_expired') {
          recovering = true;
          continue;
        }
        const classified = classifyRelayFailure(error);
        if (classified) {
          onState(classified);
          if (classified.state === 'read-only') {
            await pause(Math.max(1, error.retryAfter ?? 5), signal);
            continue;
          }
          break;
        }
        onState({ state: 'offline', code: error.code ?? 'network_unavailable' });
        await pause(Math.max(1, error.retryAfter ?? 5), signal);
      }
    }
  };
  return {
    start() {
      if (running) return running;
      controller = new AbortController();
      running = run(controller.signal).catch(error => { if (!controller.signal.aborted) throw error; }).finally(() => { running = null; });
      return running;
    },
    async stop() { controller?.abort(); await running; },
  };
}
