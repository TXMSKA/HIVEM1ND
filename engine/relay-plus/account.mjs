import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { assertLocalStaging, assertNoLinks } from '../service/paths.mjs';
import { protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { openHandoffEnvelope } from './account-key.mjs';
import { writeAccountKey } from './cosmic-keys/index.mjs';
import { classifyRelayFailure, createRelayPlusClient, createRelayPlusMessages, DEFAULT_QUANTUM_URL, RelayPlusError } from './client.mjs';

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
  let generation = 0;
  let signIn = null;
  let writes = Promise.resolve();
  const serializeWrite = action => {
    const result = writes.then(action);
    writes = result.catch(() => {});
    return result;
  };
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
      // A computer that never signed in, or signed out, has no file to verify: that is no credential, not a fault.
      await lstat(file);
      await verifyLocalPermissions(directory, options);
      await verifyLocalPermissions(file, options);
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.baseUrl !== anonymous.baseUrl || saved.computerId !== computerId) throw new RelayPlusError(409, 'account_binding_mismatch');
      return saved;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(tokens, current = () => true) {
    return serializeWrite(async () => {
      if (!current()) throw new RelayPlusError(408, 'sign_in_cancelled');
      await secureDirectory();
      const temporary = path.join(directory, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ ...tokens, baseUrl: anonymous.baseUrl, computerId,
          expiresAt: now() + tokens.expiresIn * 1000 }), { flag: 'wx', mode: 0o600 });
        await protectLocalFile(temporary, options);
        if (!current()) throw new RelayPlusError(408, 'sign_in_cancelled');
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      stopped = null;
      return credentials();
    });
  }
  function authState(saved, reason) {
    return { state: 'authentication-required', reason, accountId: saved?.account_id ?? null, deviceId: saved?.deviceId ?? null };
  }
  function stopAuthentication(error) {
    const classified = classifyRelayFailure(error);
    if (classified?.state !== 'authentication-required') return false;
    stopped = classified.reason;
    return true;
  }
  async function getAccessToken(force = false) {
    const epoch = generation;
    if (stopped === 'device-revoked') throw new RelayPlusError(401, 'unauthorized', {}, null, 'device_revoked');
    if (stopped === 'session-expired') throw new RelayPlusError(401, 'invalid_grant');
    const saved = await credentials();
    if (generation !== epoch) throw new RelayPlusError(409, 'operation_cancelled');
    if (!saved) throw new RelayPlusError(401, 'sign_in_required');
    if (!force && saved.expiresAt > now() + 30_000) return saved.accessToken;
    if (!refreshing) refreshing = anonymous.request('/v1/oauth/token', { method: 'POST', body: {
      grantType: 'refresh_token', refreshToken: saved.refreshToken, appId: 'hivem1nd',
    } }).then(tokens => save(tokens, () => generation === epoch)).catch(error => {
      if (generation !== epoch) throw new RelayPlusError(409, 'operation_cancelled');
      if (!stopAuthentication(error) && (error.code === 'invalid_grant' || error.status === 401)) stopped = 'session-expired';
      throw error;
    }).finally(() => { refreshing = null; });
    return (await refreshing).accessToken;
  }
  function pages(language = 'en') {
    const spanish = language === 'es';
    return {
      acceptance: new URL(spanish ? 'es/' : '', site).href,
      recovery: new URL(spanish ? 'es/security/' : 'security/', site).href,
    };
  }
  // A protected 401 refreshes once and repeats once. A terminal answer stops later protected traffic.
  async function onUnauthorized(error, final) {
    if (error?.reason === 'device_revoked') { stopped = 'device-revoked'; return false; }
    if (stopped) return false;
    if (final) { stopped = 'session-expired'; return false; }
    await getAccessToken(true);
    return 'retry';
  }
  const client = createRelayPlusClient({ baseUrl, fetch: options.fetch, getAccessToken: () => getAccessToken(), getGeneration: () => generation, onUnauthorized });
  async function beginSignIn({ timeoutMs = 300_000 } = {}) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(computerId) || typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 128 || /[\u0000-\u001f\u007f]/.test(deviceName)) {
      throw new RelayPlusError(422, 'invalid_device');
    }
    signIn?.cancel();
    const epoch = ++generation;
    let cancelled = false;
    const controller = new AbortController();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // Contract beta.2 echoes an optional desktop state; requiring it refuses callbacks this sign-in did not start.
    const state = randomBytes(32).toString('base64url');
    // A new account's K comes back sealed under this attempt's secret. The secret travels only in the URL fragment.
    const handoffSecret = randomBytes(32);
    async function storeHandoff(envelope, context) {
      let key = null;
      try {
        key = openHandoffEnvelope(envelope, handoffSecret, context);
        await (options.accountKeyStore?.writeAccountKey ?? writeAccountKey)(context.accountId, key,
          { file: options.accountKeyStoreFile, writer: 'hivem1nd', origin: 'hivem1nd' });
      } catch { /* Without a usable handoff, the password, approval or phrase path opens the data. */ }
      finally { key?.fill(0); }
    }
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
        const { keyHandoff, ...tokens } = await anonymous.request('/v1/oauth/token', { method: 'POST', signal: controller.signal, body: {
          grantType: 'authorization_code', code: callback.searchParams.get('code'), codeVerifier: verifier,
          redirectUri, appId: 'hivem1nd', keyHandoff: true,
        } });
        if (keyHandoff) await storeHandoff(keyHandoff, { accountId: tokens.account_id, appId: 'hivem1nd', redirectUri, codeChallenge: challenge, state });
        await save(tokens, () => !cancelled && generation === epoch);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Account connected. You can close this window.');
        resolve({ accountId: tokens.account_id, deviceId: tokens.deviceId });
      } catch (error) { res.writeHead(400); res.end('Account connection failed.'); reject(error); }
      finally { clearTimeout(timer); server.close(); handoffSecret.fill(0); }
    });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const cancel = () => { cancelled = true; handoffSecret.fill(0); controller.abort(); clearTimeout(timer); server.close(); server.closeAllConnections(); reject(new RelayPlusError(408, 'sign_in_cancelled')); };
    timer = setTimeout(cancel, timeoutMs);
    timer.unref();
    const url = new URL('/authorize/', site);
    for (const [key, value] of Object.entries({ appId: 'hivem1nd', redirectUri, codeChallenge: challenge, computerId, deviceName, state, keyHandoff: '1' })) url.searchParams.set(key, value);
    url.hash = `keyHandoffSecret=${handoffSecret.toString('base64url')}`;
    const current = { url: url.href, complete, cancel };
    signIn = current;
    complete.finally(() => { if (signIn === current) signIn = null; }).catch(() => {});
    return current;
  }
  return {
    client, messages: createRelayPlusMessages(client), credentials, beginSignIn, pages,
    async signIn({ openBrowser, ...settings } = {}) {
      const pending = await beginSignIn(settings);
      try { await openBrowser(pending.url); } catch (error) { pending.cancel(); throw error; }
      return pending.complete;
    },
    async assertBound() {
      const epoch = generation;
      const saved = await credentials();
      if (!saved) return null;
      if (stopped) return authState(saved, stopped);
      const account = await client.request('/v1/me');
      if (generation !== epoch) throw new RelayPlusError(409, 'operation_cancelled');
      if (account?.accountId && account.accountId !== saved.account_id) {
        stopped = 'session-expired';
        throw new RelayPlusError(409, 'account_binding_mismatch');
      }
      return saved;
    },
    async status() {
      const epoch = generation;
      const assertCurrent = () => { if (generation !== epoch) throw new RelayPlusError(409, 'operation_cancelled'); };
      const saved = await credentials();
      assertCurrent();
      if (!saved) return { state: 'signed-out' };
      if (stopped) return authState(saved, stopped);
      let account = null, bootstrap = null, usage = null, acceptance = null, blocked = null;
      const take = error => {
        assertCurrent();
        const classified = classifyRelayFailure(error);
        if (!classified) throw error;
        if (classified.state === 'authentication-required') {
          stopped = classified.reason;
          blocked = authState(saved, classified.reason);
          return;
        }
        if (classified.state === 'acceptance-required') { acceptance = classified; return; }
        if (classified.state === 'read-only') return;
        blocked = { state: 'forbidden', code: classified.code, accountId: saved.account_id, deviceId: saved.deviceId };
      };
      try { account = await client.request('/v1/me'); }
      catch (error) { take(error); if (blocked) return blocked; }
      assertCurrent();
      if (account?.accountId && account.accountId !== saved.account_id) {
        stopped = 'session-expired';
        throw new RelayPlusError(409, 'account_binding_mismatch');
      }
      try { bootstrap = await client.request('/v1/bootstrap'); }
      catch (error) { take(error); if (blocked) return { ...blocked, account, accountId: saved.account_id, deviceId: saved.deviceId }; }
      assertCurrent();
      if (bootstrap?.accountId && bootstrap.accountId !== saved.account_id) {
        stopped = 'session-expired';
        throw new RelayPlusError(409, 'account_binding_mismatch');
      }
      try { usage = await client.request('/v1/usage'); }
      catch (error) { take(error); if (blocked && blocked.state !== 'acceptance-required') return { ...blocked, account, accountId: saved.account_id, deviceId: saved.deviceId }; }
      assertCurrent();
      if (!acceptance && (account?.consentRequired === true || bootstrap?.legal?.missing?.some(policy => policy.id !== 'beta'))) {
        const requirements = await client.request('/v1/legal/requirements');
        assertCurrent();
        const policies = (requirements.policies ?? []).filter(policy => policy.id !== 'beta');
        if (policies.length) acceptance = { policies };
      }
      const entitled = bootstrap?.capabilities?.relayPlus === true;
      if (acceptance) return { state: 'acceptance-required', code: 'acceptance_required', policies: acceptance.policies,
        account, devices: account?.devices, plans: account?.plans, deviceId: saved.deviceId, accountId: saved.account_id, entitled, usage: null };
      if (blocked) return blocked;
      return { state: entitled ? 'ready' : 'read-only', account, devices: account?.devices, plans: account?.plans,
        deviceId: saved.deviceId, accountId: saved.account_id, entitled, usage };
    },
    async signOut() {
      signIn?.cancel();
      generation += 1;
      const saved = await credentials();
      if (!saved) return { state: 'signed-out' };
      // Device deletion is irreversible for this computerId; sign-out revokes this client's token chain.
      try { await client.request('/v1/oauth/revoke', { method: 'POST' }); }
      catch { /* Local sign-out still completes when the remote revocation cannot be delivered. */ }
      await serializeWrite(() => rm(file, { force: true }));
      stopped = 'sign_in_required';
      return { state: 'signed-out' };
    },
    cancelSignIn() { signIn?.cancel(); },
  };
}
