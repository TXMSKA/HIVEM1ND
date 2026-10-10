import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { CoreError } from './identity.mjs';

export async function openBridge({ host = '127.0.0.1' } = {}) {
  const secret = randomBytes(32).toString('base64url');
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 100000) {
        socket.end(`${JSON.stringify({ error: 'invalid_body' })}\n`);
        return;
      }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        socket.end(`${JSON.stringify({ error: 'invalid_body' })}\n`);
        return;
      }
      if (message.secret !== secret) {
        socket.end(`${JSON.stringify({ id: message.id ?? null, error: 'unauthorized' })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({ id: message.id, result: { accepted: true, operation: message.operation } })}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });
  const address = server.address();
  return {
    server,
    host,
    port: address.port,
    secret,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export async function dispatchLocal(bridge, operation, binding) {
  if (!bridge?.port || !bridge.secret) throw new CoreError(503, 'service_unavailable', 'The local bridge is not open.');
  const id = randomUUID();
  const payload = `${JSON.stringify({ id, operation, secret: bridge.secret, binding })}\n`;
  const { createConnection } = await import('node:net');
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: bridge.host, port: bridge.port }, () => socket.end(payload));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new CoreError(422, 'invalid_body', 'The bridge response is not JSON.')); }
    });
  });
  if (response.error) throw new CoreError(401, response.error, 'The bridge rejected the message.');
  return response.result;
}

export async function attachNative(bridge, proof) {
  if (!proof?.unitId || !proof?.nativeSessionId || proof.handshake !== true) {
    throw new CoreError(409, 'stop_unavailable', 'Native attachment needs a verified handshake.');
  }
  return dispatchLocal(bridge, 'attach', { unitId: proof.unitId, nativeSessionId: proof.nativeSessionId });
}

export async function closeBridge(bridge) {
  if (bridge) await bridge.close();
}
