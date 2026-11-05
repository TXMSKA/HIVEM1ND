import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { assertLocalStaging, assertNoLinks } from '../service/paths.mjs';
import { protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { createRelayPlusClient, createRelayPlusMessages, DEFAULT_QUANTUM_URL, RelayPlusError } from './client.mjs';

export function createRelayPlusAccount(options) {
  const { localDirectory, computerId, deviceName, now = Date.now } = options;
  if (typeof localDirectory !== 'string' || !path.isAbsolute(localDirectory)) throw new RelayPlusError(422, 'invalid_local_directory');
  const baseUrl = options.baseUrl ?? DEFAULT_QUANTUM_URL;
  const site = new URL(options.siteUrl ?? (new URL(baseUrl).origin === DEFAULT_QUANTUM_URL ? 'https://cosmic.txmska.com' : baseUrl));
  if (site.username || site.password || site.search || site.hash || site.pathname !== '/' ||
      !(site.protocol === 'https:' || site.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(site.hostname))) {
    throw new RelayPlusError(422, 'invalid_account_site_url');
  }
  const directory = path.join(localDirectory, 'relay-plus');
  const file = path.join(directory, 'credentials.json');
  let refreshing = null;
  let stopped = null;
  const anonymous = createRelayPlusClient({ baseUrl, fetch: options.fetch });
  async function secureDirectory() {
    await assertLocalStaging(directory, { syncedRoots: options.syncedRoots ?? [], env: process.env });
    await assertNoLinks(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await protectLocalFile(directory, options);
  }
  async function credentials() {
    await assertNoLinks(file);
    try {
      await verifyLocalPermissions(directory, options);
      await verifyLocalPermissions(file, options);
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.baseUrl !== anonymous.baseUrl || saved.computerId !== computerId) throw new RelayPlusError(409, 'account_binding_mismatch');
      return saved;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(tokens) {
    await secureDirectory();
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ ...tokens, baseUrl: anonymous.baseUrl, computerId,
        expiresAt: now() + tokens.expiresIn * 1000 }), { flag: 'wx', mode: 0o600 });
      await protectLocalFile(temporary, options);
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    stopped = null;
    return credentials();
  }
  async function getAccessToken() {
    if (stopped) throw new RelayPlusError(401, stopped);
    const saved = await credentials();
    if (!saved) throw new RelayPlusError(401, 'sign_in_required');
    if (saved.expiresAt > now() + 30_000) return saved.accessToken;
    if (!refreshing) refreshing = anonymous.request('/v1/oauth/token', { method: 'POST', body: {
      grantType: 'refresh_token', refreshToken: saved.refreshToken, appId: 'hivem1nd',
    } }).then(save).catch(error => {
      if (error.code === 'invalid_grant') stopped = 'device_revoked_or_session_expired';
      throw error;
    }).finally(() => { refreshing = null; });
    return (await refreshing).accessToken;
  }
  const client = createRelayPlusClient({ baseUrl, fetch: options.fetch, getAccessToken });
  async function beginSignIn({ timeoutMs = 300_000 } = {}) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(computerId) || typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 128 || /[\u0000-\u001f\u007f]/.test(deviceName)) {
      throw new RelayPlusError(422, 'invalid_device');
    }
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // Contract beta.2 echoes an optional desktop state; requiring it refuses callbacks this sign-in did not start.
    const state = randomBytes(32).toString('base64url');
    let resolve, reject, claimed = false;
    const complete = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Consumers can return the authorization URL before awaiting completion.
    complete.catch(() => {});
    let timer;
    const server = http.createServer(async (req, res) => {
      const callback = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET' || callback.pathname !== '/callback' || claimed || !/^[A-Za-z0-9_-]{43}$/.test(callback.searchParams.get('code') ?? '')
        || callback.searchParams.get('state') !== state) {
        res.writeHead(400); res.end('Invalid authorization callback.'); return;
      }
      claimed = true;
      try {
        const tokens = await anonymous.request('/v1/oauth/token', { method: 'POST', body: {
          grantType: 'authorization_code', code: callback.searchParams.get('code'), codeVerifier: verifier,
          redirectUri, appId: 'hivem1nd',
        } });
        await save(tokens);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Account connected. You can close this window.');
        resolve({ accountId: tokens.account_id, deviceId: tokens.deviceId });
      } catch (error) { res.writeHead(400); res.end('Account connection failed.'); reject(error); }
      finally { clearTimeout(timer); server.close(); }
    });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const cancel = () => { clearTimeout(timer); server.close(); reject(new RelayPlusError(408, 'sign_in_cancelled')); };
    timer = setTimeout(cancel, timeoutMs);
    timer.unref();
    const url = new URL('/authorize/', site);
    for (const [key, value] of Object.entries({ appId: 'hivem1nd', redirectUri, codeChallenge: challenge, computerId, deviceName, state })) url.searchParams.set(key, value);
    return { url: url.href, complete, cancel };
  }
  return {
    client, messages: createRelayPlusMessages(client), credentials, beginSignIn,
    async signIn({ openBrowser, ...settings } = {}) {
      const pending = await beginSignIn(settings);
      try { await openBrowser(pending.url); } catch (error) { pending.cancel(); throw error; }
      return pending.complete;
    },
    async status() {
      const saved = await credentials();
      if (!saved) return { state: 'signed-out' };
      try {
        const [account, bootstrap, usage] = await Promise.all([client.request('/v1/me'), client.request('/v1/bootstrap'), client.request('/v1/usage')]);
        const entitled = bootstrap.capabilities.relayPlus === true;
        return { state: entitled ? 'ready' : 'read-only', account, devices: account.devices, plans: account.plans,
          deviceId: saved.deviceId, accountId: saved.account_id, entitled, usage };
      } catch (error) {
        if (error.status === 401 || error.code === 'invalid_grant') {
          stopped = 'device_revoked_or_session_expired';
          return { state: stopped, accountId: saved.account_id, deviceId: saved.deviceId };
        }
        throw error;
      }
    },
    async signOut() {
      const saved = await credentials();
      if (!saved) return { state: 'signed-out' };
      // Device deletion is irreversible for this computerId; sign-out revokes this client's token chain.
      try { await client.request('/v1/oauth/revoke', { method: 'POST' }); }
      catch (error) { if (error.status !== 401 && error.code !== 'invalid_grant') throw error; }
      await rm(file, { force: true });
      stopped = 'sign_in_required';
      return { state: 'signed-out' };
    },
  };
}
