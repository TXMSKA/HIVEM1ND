import { request } from 'node:http';
import { validWakeBinding, validWakePointer, explicitWakeAttach, spawnLocalWakeWorker } from './local-wake.mjs';

export const wakeAdapter = Object.freeze({
  moduleUrl: import.meta.url,
  label: 'opencode', capability: opencodeWakeCapability, sendPointer: sendOpenCodeWake,
  attachIdentity: ({ nativeSessionId }) => explicitWakeAttach('opencode', nativeSessionId),
  validateRuntime: async () => {}, spawnWorker: spawnLocalWakeWorker, workerDependency: 'spawnLocalWakeWorker',
  workerEnvKeys: Object.freeze(['RELAY_OPENCODE_URL', 'OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD']),
  acceptsDeferred: true,
  helpLines: Object.freeze(['OpenCode: set RELAY_OPENCODE_URL to an explicit http://127.0.0.1:<port> server.']),
});

function localUrl(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) return null;
    return url;
  } catch { return null; }
}

export function opencodeWakeCapability({ env = process.env } = {}) {
  return localUrl(env.RELAY_OPENCODE_URL) ? { available: true } : { available: false, reason: 'explicit_loopback_server_required' };
}

/** Use the selected running server, never start a second OpenCode session. */
export async function sendOpenCodeWake({ binding, text, env = process.env, timeoutMs = 4000, signal,
  requestHttp = request } = {}) {
  const no = (reason) => ({ status: 'not_submitted', reason });
  const url = localUrl(env.RELAY_OPENCODE_URL);
  if (!url) return no('explicit_loopback_server_required');
  if (!validWakeBinding(binding, 'opencode')) return no('native_binding_mismatch');
  if (!validWakePointer(text, binding.unit)) return no('invalid_pointer');
  if (signal?.aborted) return no('cancelled_before_submit');
  const bounded = new AbortController();
  const abort = () => bounded.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  let dispatched = false;
  const headers = {};
  if (env.OPENCODE_SERVER_PASSWORD) {
    headers.authorization = 'Basic ' + Buffer.from(`${env.OPENCODE_SERVER_USERNAME || 'opencode'}:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64');
  }
  async function call(method, route, body) {
    return new Promise((resolve, reject) => {
      const encoded = body === undefined ? null : JSON.stringify(body);
      const req = requestHttp(new URL(route, url), { method, signal: bounded.signal,
        headers: { ...headers, ...(encoded ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) } : {}) } }, (res) => {
        let data = Buffer.alloc(0);
        res.on('data', (chunk) => {
          data = Buffer.concat([data, chunk]);
          if (data.length > 65536) { res.destroy(); reject(new Error('Response exceeds bound.')); }
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, data: data.toString('utf8') }));
      });
      req.on('error', reject);
      if (method === 'POST') dispatched = true;
      req.end(encoded);
    });
  }
  try {
    const session = await call('GET', `/session/${encodeURIComponent(binding.nativeSessionId)}`);
    if (session.status !== 200 || JSON.parse(session.data)?.id !== binding.nativeSessionId) return no('existing_session_unavailable');
    const activity = await call('GET', '/session/status');
    if (activity.status !== 200) return no('session_activity_unavailable');
    const states = JSON.parse(activity.data);
    if (!states || typeof states !== 'object' || Array.isArray(states)) return no('session_activity_unavailable');
    // OpenCode omits idle sessions; defer busy and retry states, including urgent arrivals.
    if (states[binding.nativeSessionId] && states[binding.nativeSessionId].type !== 'idle') return { ...no('target_busy'), deferred: true };
    if (bounded.signal.aborted) return no('cancelled_before_submit');
    const response = await call('POST', `/session/${encodeURIComponent(binding.nativeSessionId)}/prompt_async`, { parts: [{ type: 'text', text }] });
    return response.status === 204 ? { status: 'submitted', transport: 'opencode-prompt-async' }
      : { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' };
  } catch {
    return dispatched ? { status: 'ambiguous', reason: 'SINK_AMBIGUOUS' } : no('opencode_server_unavailable');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
