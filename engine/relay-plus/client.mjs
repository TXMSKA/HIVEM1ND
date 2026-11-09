import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_QUANTUM_URL = 'https://quantum.txmska.com';

export class RelayPlusError extends Error {
  constructor(status, code, fields = {}, retryAfter = null, reason = null) {
    super(`Relay+: ${code}`);
    this.name = 'RelayPlusError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
    this.reason = reason === 'device_revoked' ? 'device_revoked' : null;
  }
}

function copyPolicies(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({ id: item?.id ?? null, version: item?.version ?? null, path: item?.path ?? null }));
}

// Maps a contract failure onto a safe runtime state. Server request ids and raw bodies stay off this object.
export function classifyRelayFailure(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.reason === 'device_revoked' || error.code === 'device_revoked') {
    return { state: 'authentication-required', reason: 'device-revoked', code: error.code ?? 'unauthorized' };
  }
  if (error.status === 401 || error.code === 'invalid_grant' || error.code === 'unauthorized' || error.code === 'sign_in_required') {
    return { state: 'authentication-required', reason: 'session-expired', code: error.code ?? 'unauthorized' };
  }
  if (error.code === 'account_binding_mismatch') return { state: 'authentication-required', reason: 'session-expired', code: error.code };
  if (error.code === 'acceptance_required') {
    const fields = error.fields ?? error.details ?? {};
    return { state: 'acceptance-required', code: 'acceptance_required', policies: copyPolicies(fields.policies) };
  }
  if (error.code === 'relayplus_required') return { state: 'read-only', code: error.code };
  if (error.status === 403) return { state: 'forbidden', code: error.code ?? 'forbidden' };
  return null;
}

export function createRelayPlusClient({ baseUrl = DEFAULT_QUANTUM_URL, getAccessToken = null, getGeneration = null, onUnauthorized = null, fetch: request = globalThis.fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw new RelayPlusError(422, 'invalid_quantum_url');
  }
  function assertCurrent(generation) {
    if (getGeneration && getGeneration() !== generation) throw new RelayPlusError(409, 'operation_cancelled');
  }
  async function send(route, options, generation) {
    const headers = new Headers(options.headers);
    if (getAccessToken && options.auth !== false) headers.set('Authorization', `Bearer ${await getAccessToken()}`);
    assertCurrent(generation);
    let body = options.body;
    if (body !== undefined && body !== null && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      headers.set('Content-Type', 'application/json');
    } else if (body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
    const timeout = AbortSignal.timeout(40_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const result = await request(new URL(route, base), { method: options.method ?? 'GET', headers, body,
      signal, redirect: 'error', credentials: 'omit' });
    assertCurrent(generation);
    if (!result.ok) {
      const failure = await result.json().catch(() => ({}));
      assertCurrent(generation);
      const detail = failure.error ?? failure;
      const retry = result.headers.get('Retry-After');
      throw new RelayPlusError(result.status, detail.code ?? 'request_failed', detail.fields ?? {},
        retry === null ? null : /^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)),
        detail.reason);
    }
    return result;
  }
  async function response(route, options = {}) {
    if (!route.startsWith('/v1/') || route.startsWith('//')) throw new RelayPlusError(422, 'invalid_quantum_path');
    const guarded = getAccessToken && options.auth !== false && onUnauthorized;
    const generation = getGeneration?.();
    try { return await send(route, options, generation); }
    catch (error) {
      assertCurrent(generation);
      if (!guarded || error?.status !== 401) throw error;
      // One refresh and one repeat for an ordinary expiry. A terminal answer stops later protected traffic.
      if (await onUnauthorized(error, false) !== 'retry') throw error;
      assertCurrent(generation);
      try { return await send(route, options, generation); }
      catch (again) { assertCurrent(generation); if (again?.status === 401) await onUnauthorized(again, true); throw again; }
    }
  }

  return {
    baseUrl: base.origin,
    response,
    async request(route, options = {}) {
      const generation = getGeneration?.();
      const result = await response(route, options);
      const value = options.binary ? Buffer.from(await result.arrayBuffer()) : result.status === 204 ? null : await result.json();
      assertCurrent(generation);
      return value;
    },
  };
}

export function createRelayPlusMessages(client) {
  const route = id => `/v1/relay/messages/${encodeURIComponent(id)}`;
  const list = (kind, { after, limit } = {}) => {
    const query = new URLSearchParams();
    if (after != null) query.set('after', after);
    if (limit != null) query.set('limit', limit);
    return client.request(`/v1/relay/${kind}?${query}`);
  };
  return {
    publish: (recipientDeviceId, ciphertext, id = randomBytes(18).toString('base64url')) => {
      const body = Buffer.from(ciphertext);
      return client.request(route(id), { method: 'PUT', body, headers: {
        'X-Relay-Recipient': recipientDeviceId, 'X-Content-SHA256': createHash('sha256').update(body).digest('hex'),
      } });
    },
    inbox: options => list('inbox', options),
    outbox: options => list('outbox', options),
    async download(id) {
      const result = await client.response(route(id));
      const bytes = Buffer.from(await result.arrayBuffer());
      const checksum = result.headers.get('X-Content-SHA256');
      if (!checksum || createHash('sha256').update(bytes).digest('hex') !== checksum) {
        throw new RelayPlusError(502, 'invalid_message_checksum');
      }
      return bytes;
    },
    delivered: id => client.request(`${route(id)}/delivered`, { method: 'POST' }),
    read: id => client.request(`${route(id)}/read`, { method: 'POST' }),
  };
}
