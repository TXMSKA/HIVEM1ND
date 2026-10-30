import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_QUANTUM_URL = 'https://quantum.txmska.com';

export class RelayPlusError extends Error {
  constructor(status, code, fields = {}, retryAfter = null) {
    super(`Relay+: ${code}`);
    this.name = 'RelayPlusError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export function createRelayPlusClient({ baseUrl = DEFAULT_QUANTUM_URL, getAccessToken = null, fetch: request = globalThis.fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw new RelayPlusError(422, 'invalid_quantum_url');
  }
  async function response(route, options = {}) {
    if (!route.startsWith('/v1/') || route.startsWith('//')) throw new RelayPlusError(422, 'invalid_quantum_path');
    const headers = new Headers(options.headers);
    if (getAccessToken && options.auth !== false) headers.set('Authorization', `Bearer ${await getAccessToken()}`);
    let body = options.body;
    if (body !== undefined && body !== null && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      headers.set('Content-Type', 'application/json');
    } else if (body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
    const result = await request(new URL(route, base), { method: options.method ?? 'GET', headers, body,
      signal: options.signal ?? AbortSignal.timeout(40_000), redirect: 'error', credentials: 'omit' });
    if (!result.ok) {
      const failure = await result.json().catch(() => ({}));
      const detail = failure.error ?? failure;
      const retry = result.headers.get('Retry-After');
      throw new RelayPlusError(result.status, detail.code ?? 'request_failed', detail.fields ?? {},
        retry === null ? null : /^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)));
    }
    return result;
  }
  return {
    baseUrl: base.origin,
    response,
    async request(route, options = {}) {
      const result = await response(route, options);
      if (options.binary) return Buffer.from(await result.arrayBuffer());
      return result.status === 204 ? null : result.json();
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
