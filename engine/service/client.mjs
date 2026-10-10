import { request as httpRequest } from 'node:http';

export async function connectService(options) {
  if (!options?.origin || !options?.token) throw new Error('A service client needs an origin and a token.');
  const origin = new URL(options.origin);
  return { origin, token: options.token, closed: false };
}

export async function request(client, spec) {
  if (client.closed) throw new Error('The service client is closed.');
  const payload = spec.body === undefined ? null : Buffer.from(JSON.stringify(spec.body));
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: client.origin.hostname,
      port: client.origin.port,
      method: spec.method ?? 'POST',
      path: spec.path,
      headers: {
        host: client.origin.host,
        origin: client.origin.origin,
        authorization: `Bearer ${client.token}`,
        accept: spec.accept ?? 'application/json, text/event-stream',
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(spec.headers ?? {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const json = raw.length > 0 && String(res.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

export function subscribe() {
  return { close() {} };
}

export function bindNative(client, binding) {
  if (!binding?.verifiedLogin) return { nativeSupport: false, reason: 'native_login_unverified' };
  return { nativeSupport: true, client };
}

export async function legacyOperation(client, name, args) {
  return request(client, { path: '/mcp', body: { jsonrpc: '2.0', id: args?.requestId ?? 1, method: 'tools/call', params: { name, arguments: args ?? {} } } });
}

export function close(client) {
  client.closed = true;
}
