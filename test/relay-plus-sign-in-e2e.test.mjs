import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRelayPlus } from '../engine/relay-plus/runtime.mjs';
import { createRelayPlusAccount } from '../engine/relay-plus/account.mjs';
import { readAccountKey, writeAccountKey } from '../engine/relay-plus/cosmic-keys/index.mjs';
import { createRelayPlusClient } from '../engine/relay-plus/client.mjs';
import { request } from '../engine/service/client.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { createStore } from '../engine/service/store.mjs';
import { protectLocalFile } from '../engine/service/security.mjs';
import { loadRelanKey } from '../engine/relan/keys.mjs';
import { decodePack, encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport } from '../engine/sync/replicate.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { assertPortReleased, QUANTUM_COMMIT, startLocalQuantum } from './support/local-quantum.mjs';

const enabled = process.env.ONEM1ND_SIGNIN_E2E === '1';
const reportFile = path.resolve('.tmp/signin-e2e-result.json');

async function until(read, predicate, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (predicate(result)) return result;
    await delay(100);
  }
  throw new Error(message);
}

test('disposable pinned Quantum sign-in, approval, consent and encrypted sync', {
  skip: enabled ? false : 'Set ONEM1ND_SIGNIN_E2E=1 for the one disposable local Quantum stage.',
  timeout: 900_000,
}, async t => {
  const results = { revision: QUANTUM_COMMIT, mode: 'API-only headless driver; account-site HTML not verified', scenarios: [], cleanup: 'pending' };
  let quantum, core, caller, servicePort;
  const devices = [];
  const callbacks = [];
  try {
    quantum = await startLocalQuantum({ preparedRoot: process.env.ONEM1ND_SIGNIN_E2E_PREPARED_ROOT,
      resumePreparation: process.env.ONEM1ND_SIGNIN_E2E_RESUME_PREPARATION === '1' });
    const root = path.join(quantum.root, 'onem1nd');
    const paths = servicePaths({ platform: 'win32', env: { LOCALAPPDATA: path.join(root, 'local') }, home: path.join(root, 'home'), machine: 'E2E-SERVICE' });
    paths.origin = path.join(root, 'mirror');
    await mkdir(path.join(paths.mind, 'user'), { recursive: true });
    await mkdir(paths.localDirectory, { recursive: true });
    const store = createStore({ root, confineRoot: root, mindPath: paths.mind, localDirectory: paths.localDirectory });
    core = await composeCore({ store, paths, projects: [], clients: [] });
    servicePort = core.http.port;
    caller = { origin: new URL(`http://127.0.0.1:${servicePort}`), token: core.bootstrap.secret };
    const local = await request(caller, { path: '/api/v1/auth/local', body: { embedded: false, hostOrigin: null, look: null, language: null } });
    assert.equal(local.status, 201);
    caller.token = local.json.data.token;
    const control = async (device, body) => {
      core.runtime.relayPlus.control = device.runtime.control;
      const response = await request(caller, { path: '/api/v1/relay-plus', headers: { 'idempotency-key': randomUUID() }, body });
      if (response.status !== 200) {
        const error = new Error(`Local control failed (${response.status})`);
        error.status = response.status; error.code = response.json?.error?.code;
        throw error;
      }
      return response.json.data;
    };
    const makeDevice = async (name, { shared = name, fetch: fetchOverride } = {}) => {
      const localDirectory = path.join(root, name, 'service');
      const originDirectory = path.join(root, name, 'origin');
      const file = path.join(root, shared, 'cosmic-keys.json');
      let writes = 0, offline = false;
      const accountKeyStore = { readAccountKey, async writeAccountKey(...args) { writes += 1; return writeAccountKey(...args); } };
      const guardedFetch = async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, quantum.base);
        if (offline) throw new Error('Synthetic offline transport');
        return fetchOverride ? fetchOverride(url, options) : fetch(url, options);
      };
      const options = { enabled: true, localDirectory, machine: name, computerId: name, mindId: 'signin-e2e-mind', baseUrl: quantum.base,
        siteUrl: quantum.base, accountKeyStoreFile: file, accountKeyStore, fetch: guardedFetch,
        origin: { store: {}, paths: { origin: originDirectory }, machine: name } };
      const runtime = await createRelayPlus(options);
      const account = createRelayPlusAccount({ ...options, deviceName: name });
      const device = { runtime, account, options, localDirectory, originDirectory, file, writes: () => writes, offline: value => { offline = value; } };
      devices.push(device);
      return device;
    };
    const signIn = async (device, browser) => {
      const pending = await control(device, { action: 'sign-in' });
      assert.equal(pending.state, 'sign-in-pending');
      const navigation = new URL(pending.url);
      assert.equal(navigation.origin, quantum.base);
      assert.equal(navigation.pathname, '/authorize/');
      const authorize = {};
      for (const name of ['appId', 'computerId', 'deviceName', 'redirectUri', 'codeChallenge']) authorize[name] = navigation.searchParams.get(name);
      authorize.codeChallengeMethod = 'S256';
      const authorized = await browser.request('/v1/oauth/authorize', authorize);
      assert.equal(authorized.status, 200, 'Real site authorization must permit the normal PKCE journey');
      const callback = new URL(authorize.redirectUri);
      callbacks.push(Number(callback.port));
      quantum.trackCallback(callback.href);
      callback.searchParams.set('state', navigation.searchParams.get('state'));
      callback.searchParams.set('code', (await authorized.json()).code);
      assert.equal((await fetch(callback, { signal: AbortSignal.timeout(10_000) })).status, 200);
      await until(() => control(device, { action: 'status' }), status => status.signInPending === false, 'PKCE callback did not settle');
      assert.ok(await device.account.credentials(), 'Normal credentials must be saved by the callback');
    };
    const appClient = async device => {
      const credentials = await device.account.credentials();
      return createRelayPlusClient({ baseUrl: quantum.base, getAccessToken: () => credentials.accessToken });
    };
    const packs = [];
    const publish = async (device, text) => {
      const raw = Buffer.from(text), hash = hashBytes(raw), sequence = packs.length + 1;
      const bytes = encodePack({ machine: 'E2E-FIRST', sequence, changes: [{ format: 'hivem1nd-change-v1', id: randomUUID(), machine: 'E2E-FIRST',
        at: new Date().toISOString(), target: { kind: 'mind', path: 'user/e2e-history.md' }, operation: 'put', hash, size: raw.length,
        baseHash: null, messageId: null, transactionId: null }], objects: [{ hash, raw }],
      encryption: device.runtime.encryption(), keyProvider: device.runtime.keyProvider });
      packs.push(bytes);
      const local = openFolderTransport({ directory: device.originDirectory, keyProvider: device.runtime.keyProvider });
      await local.writePack('E2E-FIRST', sequence, bytes);
      await local.writeHead({ format: 'hivem1nd-head-v1', machine: 'E2E-FIRST', sequence, updatedAt: new Date().toISOString(),
        packs: packs.map((pack, index) => ({ sequence: index + 1, file: packFileName(index + 1), bytes: pack.length, hash: hashBytes(pack) })) });
      device.runtime.wake();
      return { bytes, hash, raw, sequence };
    };
    const waitUploaded = async (device, sequence) => {
      const remote = await appClient(device), generation = createHash('sha256').update('signin-e2e-mind').digest('hex');
      const object = `writers/E2E-FIRST/${generation}/packs/${sequence}.enc`;
      return until(async () => { try { return await remote.request(`/v1/datasets/hivem1nd/objects/${object}`, { binary: true }); }
        catch (error) { if (error.status !== 404) throw error; return null; } }, Boolean, 'Encrypted synthetic history did not upload');
    };
    const scenario = async (name, action) => {
      await t.test(name, async () => {
        try { const detail = await action(); results.scenarios.push({ name, verdict: 'PASS', ...detail }); }
        catch (error) { results.scenarios.push({ name, verdict: 'FAIL', code: error.code ?? error.name, status: error.status ?? null }); throw error; }
      });
    };

    const primary = await quantum.register(quantum.emails[0]);
    await quantum.grant(primary.email);
    const approver = await quantum.register(primary.email);
    const key = randomBytes(32), password = randomBytes(20).toString('base64url'), phrase = Array(24).fill('acorn');
    const passwordEnvelope = await quantum.siteCrypto.makePasswordEnvelope(key, password, primary.accountId);
    let first, second, expiry, terminal, terminalClient, terminalBrowser;
    const tracked = [];
    const tab = randomUUID();
    await scenario('password PKCE, duplicate envelope, wrong password and Windows DPAPI', async () => {
      const create = await primary.browser.request('/v1/keys/password', passwordEnvelope, { method: 'PUT', headers: { 'If-None-Match': '*' } });
      assert.equal(create.status, 200);
      const duplicate = await primary.browser.request('/v1/keys/password', passwordEnvelope, { method: 'PUT', headers: { 'If-None-Match': '*' } });
      assert.equal(duplicate.status, 412);
      assert.equal((await duplicate.json()).error.code, 'key_exists');
      first = await makeDevice('E2E-FIRST');
      await signIn(first, primary.browser);
      const status = await until(() => control(first, { action: 'status' }), item => item.sync?.state === 'key-required', 'Password methods did not load');
      assert.deepEqual(status.sync.methods, { password: true, phrase: false, approval: false, vault: false });
      await assert.rejects(control(first, { action: 'unlock', password: `${password}x` }));
      assert.equal(first.writes(), 0);
      assert.equal((await control(first, { action: 'unlock', password })).state, 'ready');
      assert.equal(first.runtime.ready(), true);
      assert.equal(first.writes(), 1);
      assert.ok((await readAccountKey(primary.accountId, { file: first.file })).equals(key), 'DPAPI must reopen the same account key');
      const initial = await publish(first, 'Synthetic retained M1ND history.');
      assert.ok(initial.bytes.equals(await waitUploaded(first, 1)), 'The first encrypted head must carry the retained M1ND key before another device joins');
      return { http: [200, 412], protectedStore: 'Windows DPAPI' };
    });
    await scenario('shared-store restart retains M1ND material without a second K write', async () => {
      const retained = await loadRelanKey({ localDirectory: first.localDirectory });
      const before = await readFile(first.file);
      await first.runtime.close();
      first.runtime = await createRelayPlus(first.options);
      assert.equal(first.runtime.ready(), true);
      assert.equal(first.writes(), 1);
      assert.ok(before.equals(await readFile(first.file)), 'The shared store must stay byte identical');
      const reopened = await loadRelanKey({ localDirectory: first.localDirectory });
      assert.ok(reopened.key.equals(retained.key) && reopened.keyId === retained.keyId, 'Restart must preserve M1ND key material');
    });
    await scenario('availability, lost 201, browser-session approval and lost consume response', async () => {
      const client = await appClient(first);
      assert.equal((await client.request('/v1/key-approvers/availability')).available, false);
      assert.equal((await approver.browser.request(`/v1/key-approvers/self/${tab}`, {}, { method: 'PUT' })).status, 200);
      assert.equal((await client.request('/v1/key-approvers/availability')).available, true);
      assert.equal((await approver.browser.request(`/v1/key-approvers/self/${tab}`, undefined, { method: 'DELETE' })).status, 200);
      assert.equal((await client.request('/v1/key-approvers/availability')).available, false);
      assert.equal((await approver.browser.request(`/v1/key-approvers/self/${tab}`, {}, { method: 'PUT' })).status, 200);
      let puts = 0, lostCleanup = false, requestId, approvalId;
      second = await makeDevice('E2E-SECOND', { fetch: async (url, options) => {
        const route = new URL(url).pathname;
        if (route.startsWith('/v1/key-approval-requests/') && options.method === 'PUT') {
          puts += 1; requestId = route.split('/').at(-1);
          const response = await fetch(url, options);
          assert.equal(response.status, 201);
          approvalId = (await response.clone().json()).id;
          await response.body?.cancel();
          throw new Error('Synthetic lost first creation answer');
        }
        if (route.endsWith('/consume') && !lostCleanup) {
          lostCleanup = true;
          const response = await fetch(url, options);
          assert.equal(response.status, 200);
          await response.body?.cancel();
          throw new Error('Synthetic lost consumed answer');
        }
        return fetch(url, options);
      } });
      await signIn(second, primary.browser);
      assert.equal((await control(second, { action: 'request-approval' })).state, 'approval-pending');
      assert.equal(puts, 1);
      const listed = await approver.browser.request('/v1/key-approvals');
      assert.equal(listed.status, 200);
      const rows = (await listed.json()).approvals;
      assert.equal(rows.length, 1, 'A lost 201 must leave only one live creation');
      const row = rows[0], party = await quantum.siteCrypto.startApproval();
      const b64 = value => Buffer.from(value).toString('base64');
      assert.equal((await approver.browser.request(`/v1/key-approvals/${row.id}/offer`, { approverPublic: b64(party.publicKey), approverNonce: b64(party.nonce) })).status, 200);
      const revealed = await until(async () => {
        const response = await approver.browser.request(`/v1/key-approvals/${row.id}`);
        assert.equal(response.status, 200); return response.json();
      }, item => item.status === 'revealed', 'Requester did not reveal its commitment');
      const requesterPublic = Buffer.from(revealed.requesterPublic, 'base64'), requesterNonce = Buffer.from(revealed.requesterNonce, 'base64');
      assert.equal(await quantum.siteCrypto.commitmentMatches(Buffer.from(row.commit, 'base64'), requesterPublic, requesterNonce), true);
      const code = await quantum.siteCrypto.approvalCode(requesterPublic, party.publicKey, requesterNonce, party.nonce);
      const requester = await control(second, { action: 'inspect' });
      assert.ok(requester.code === code, 'Independent browser and requester comparison codes must agree');
      const envelope = await quantum.siteCrypto.sealKey(key, party.privateKey, { requesterPublic, requesterNonce, approverPublic: party.publicKey,
        approverNonce: party.nonce, accountId: primary.accountId, id: row.id });
      assert.equal((await approver.browser.request(`/v1/key-approvals/${row.id}/approve`, envelope)).status, 200);
      await until(async () => second.runtime.ready(), Boolean, 'Browser approval did not unlock the new requester', 30_000);
      assert.equal(second.writes(), 1);
      assert.equal(lostCleanup, true);
      const requesterClient = await appClient(second);
      assert.equal((await requesterClient.request(`/v1/key-approval-requests/${requestId}`)).status, 'consumed');
      await assert.rejects(requesterClient.request(`/v1/key-approvals/${approvalId}`), error => error.status === 404);
      assert.equal((await approver.browser.request(`/v1/key-approvals/${approvalId}`)).status, 404);
      assert.ok((await readAccountKey(primary.accountId, { file: second.file })).equals(key), 'Cleanup 404 must retain durable K');
      return { http: [201, 200, 404], creates: puts, keyWrites: second.writes() };
    });
    await scenario('optional phrase and a legacy phrase-only account', async () => {
      const envelope = await quantum.siteCrypto.wrapKey(key, phrase);
      assert.equal((await primary.browser.request('/v1/keys/phrase', envelope, { method: 'PUT', headers: { 'If-None-Match': '*' } })).status, 200);
      const optional = await makeDevice('E2E-OPTIONAL');
      await signIn(optional, primary.browser);
      const status = await control(optional, { action: 'refresh-keys' });
      assert.equal(status.methods.password, true); assert.equal(status.methods.phrase, true);
      await control(optional, { action: 'recover', phrase: phrase.join(' ') });
      assert.ok((await readAccountKey(primary.accountId, { file: optional.file })).equals(key), 'Phrase and password must open the same K');
      const legacy = await quantum.register(quantum.emails[1]);
      await quantum.grant(legacy.email);
      const generated = await quantum.siteCrypto.generateRecovery();
      assert.equal((await legacy.browser.request('/v1/keys/phrase', generated.envelope, { method: 'PUT', headers: { 'If-None-Match': '*' } })).status, 200);
      const device = await makeDevice('E2E-LEGACY');
      await signIn(device, legacy.browser);
      const methods = (await control(device, { action: 'refresh-keys' })).methods;
      assert.deepEqual(methods, { password: false, phrase: true, approval: false, vault: false });
      await control(device, { action: 'recover', phrase: generated.phrase.join(' ') });
      assert.equal(device.runtime.ready(), true);
      assert.ok((await readAccountKey(legacy.accountId, { file: device.file })).equals(Buffer.from(generated.key)), 'Legacy phrase must preserve its data key');
      generated.key.fill(0);
    });
    await scenario('rejection, lost-creation cancellation and natural expiry setup', async () => {
      terminal = await quantum.register(quantum.emails[2]); await quantum.grant(terminal.email);
      terminalBrowser = (await quantum.register(terminal.email)).browser;
      const tabId = randomUUID();
      assert.equal((await terminalBrowser.request(`/v1/key-approvers/self/${tabId}`, {}, { method: 'PUT' })).status, 200);
      const device = await makeDevice('E2E-TERMINAL'); await signIn(device, terminal.browser);
      terminalClient = await appClient(device);
      const start = async () => {
        const id = randomUUID();
        const response = await terminalClient.request(`/v1/key-approval-requests/${id}`, { method: 'PUT', body: { commit: randomBytes(32).toString('base64'), label: 'ONEM1ND, Windows' } });
        tracked.push(id); return { id, row: response };
      };
      expiry = await start();
      const rejected = await start();
      assert.equal((await terminalBrowser.request(`/v1/key-approvals/${rejected.row.id}`, undefined, { method: 'DELETE' })).status, 200);
      assert.equal((await terminalClient.request(`/v1/key-approval-requests/${rejected.id}`)).status, 'rejected');
      await assert.rejects(terminalClient.request(`/v1/key-approvals/${rejected.row.id}`), error => error.status === 404);
      const cancelled = await makeDevice('E2E-CANCELLED', { fetch: async (url, options) => {
        const response = await fetch(url, options);
        if (new URL(url).pathname.startsWith('/v1/key-approval-requests/') && options.method === 'PUT') {
          tracked.push(new URL(url).pathname.split('/').at(-1)); await response.body?.cancel(); throw new Error('Synthetic lost creation answer');
        }
        return response;
      } });
      await signIn(cancelled, terminal.browser);
      await control(cancelled, { action: 'request-approval' });
      assert.equal((await control(cancelled, { action: 'cancel-approval' })).remote, true);
      const cancelledClient = await appClient(cancelled), id = tracked.at(-1);
      assert.equal((await cancelledClient.request(`/v1/key-approval-requests/${id}`)).status, 'cancelled');
      await cancelledClient.request(`/v1/key-approval-requests/${id}`, { method: 'DELETE' });
      assert.equal((await cancelledClient.request(`/v1/key-approval-requests/${id}`)).status, 'cancelled');
      return { http: [201, 200, 404], naturalExpiry: 'pending until server deadline' };
    });
    await scenario('pending registration, fixture app consent, original account and optional Beta', async () => {
      const pending = await quantum.register(quantum.emails[3], false);
      for (const route of ['/v1/me', '/v1/bootstrap', '/v1/legal/requirements']) assert.equal((await pending.browser.request(route)).status, 200);
      for (const route of ['/v1/keys', '/v1/profile']) {
        const response = await pending.browser.request(route); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'acceptance_required');
      }
      const denied = await pending.browser.request('/v1/oauth/authorize', {});
      assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'acceptance_required');
      const device = await makeDevice('E2E-CONSENT');
      const now = Date.now(), deviceId = randomUUID(), chainId = randomUUID();
      await quantum.store.registerDevice({ id: deviceId, userId: pending.accountId, appId: 'hivem1nd', computerId: 'E2E-CONSENT',
        name: 'E2E-CONSENT', createdAt: now, lastSeenAt: now, revokedAt: null });
      const tokens = { accessToken: randomBytes(32).toString('base64url'), refreshToken: randomBytes(32).toString('base64url'),
        expiresIn: 900, account_id: pending.accountId, deviceId, baseUrl: quantum.base, computerId: 'E2E-CONSENT', expiresAt: now + 900_000 };
      for (const [kind, token] of [['access', tokens.accessToken], ['refresh', tokens.refreshToken]]) await quantum.store.insertOAuthToken({
        tokenHash: await quantum.hashSecret(token), userId: pending.accountId, appId: 'hivem1nd', deviceId, chainId, kind,
        expiresAt: now + 86_400_000, absoluteExpiresAt: now + 86_400_000, revokedAt: null, replacedBy: null });
      const directory = path.join(device.localDirectory, 'relay-plus'); await mkdir(directory, { recursive: true });
      const file = path.join(directory, 'credentials.json'); await writeFile(file, JSON.stringify(tokens));
      await protectLocalFile(directory); await protectLocalFile(file);
      const client = await appClient(device);
      for (const route of ['/v1/usage', '/v1/keys', `/v1/key-approval-requests/${randomUUID()}`]) await assert.rejects(client.request(route), error => error.status === 403 && error.code === 'acceptance_required');
      const status = await control(device, { action: 'status' });
      assert.equal(status.state, 'acceptance-required'); assert.ok(status.accountId === pending.accountId);
      assert.equal(status.pages.en.acceptance, `${quantum.base}/`); assert.equal(status.pages.es.acceptance, `${quantum.base}/es/`);
      assert.equal(status.pages.en.recovery, `${quantum.base}/security/`); assert.equal(status.pages.es.recovery, `${quantum.base}/es/security/`);
      assert.equal((await control(device, { action: 'check-acceptance' })).resumed, false);
      const requirements = await (await pending.browser.request('/v1/legal/requirements')).json();
      for (const policy of requirements.policies.filter(policy => ['terms', 'privacy'].includes(policy.id))) {
        assert.equal((await pending.browser.request('/v1/legal/acceptances', { policy: policy.id, version: policy.version })).status, 200);
      }
      const remaining = await (await pending.browser.request('/v1/legal/requirements')).json();
      assert.ok(remaining.policies.some(policy => policy.id === 'beta'), 'Optional Beta must remain to prove it cannot deadlock resumption');
      // Checks are spaced by the runtime (two seconds, or Retry-After); poll until that spacing allows the resume.
      const resumed = await until(() => control(device, { action: 'check-acceptance' }), item => item.resumed || item.stopped, 'Acceptance did not resume');
      assert.equal(resumed.resumed, true);
      await signIn(device, pending.browser);
      return { http: [200, 403], authorization: 'normal PKCE after registration acceptance' };
    });
    await scenario('real encrypted history, offline reconnect and sign-out preservation', async () => {
      assert.equal(first.runtime.ready(), true); assert.equal(second.runtime.ready(), true);
      const material = await loadRelanKey({ localDirectory: first.localDirectory });
      const other = await loadRelanKey({ localDirectory: second.localDirectory });
      assert.ok(material.key.equals(other.key) && material.keyId === other.keyId, 'A second requester must retain the original M1ND key');
      first.offline(true);
      const update = await publish(first, 'Synthetic M1ND history after reconnect.');
      await until(() => control(first, { action: 'status' }), item => item.sync?.state === 'offline', 'Offline work did not pause sync');
      first.offline(false); first.runtime.wake();
      assert.ok(update.bytes.equals(await waitUploaded(first, update.sequence)), 'Reconnect must upload the original encrypted bytes');
      second.runtime.wake();
      const pulled = await until(() => openFolderTransport({ directory: second.originDirectory, keyProvider: second.runtime.keyProvider }).readPack('E2E-FIRST', update.sequence), Boolean, 'Second requester did not receive encrypted history');
      assert.ok(pulled.equals(update.bytes), 'Encrypted history must stay byte identical');
      const opened = decodePack(pulled, { machine: 'E2E-FIRST', keyProvider: second.runtime.keyProvider });
      assert.ok(opened.objects.get(update.hash).equals(update.raw), 'The second requester must open the synthetic M1ND content');
      assert.equal((await control(second, { action: 'sign-out' })).state, 'signed-out');
      assert.ok((await readAccountKey(primary.accountId, { file: second.file })).equals(key), 'Sign-out must retain account K');
    });
    await scenario('revoked device retains K and stops authentication', async () => {
      const device = await makeDevice('E2E-REVOKED', { shared: 'E2E-FIRST' }); await signIn(device, primary.browser);
      const credentials = await device.account.credentials();
      assert.equal((await primary.browser.request(`/v1/devices/${credentials.deviceId}`, undefined, { method: 'DELETE' })).status, 200);
      const client = await appClient(device);
      await assert.rejects(client.request('/v1/keys'), error => error.status === 401 && error.reason === 'device_revoked');
      const response = await quantum.client().request('/v1/oauth/token', { grantType: 'refresh_token', appId: 'hivem1nd', refreshToken: credentials.refreshToken });
      assert.equal(response.status, 400);
      const failure = await response.json(); assert.equal(failure.error.code, 'invalid_grant'); assert.equal(failure.error.reason, 'device_revoked');
      const status = await control(device, { action: 'status' }); assert.equal(status.state, 'authentication-required'); assert.equal(status.reason, 'device-revoked');
      assert.ok((await readAccountKey(primary.accountId, { file: device.file })).equals(key), 'Revocation must retain account K');
      return { http: [200, 401, 400] };
    });
    await scenario('new account from the app receives K through the setup handoff', async () => {
      const fresh = await quantum.register(quantum.emails[4]);
      const device = await makeDevice('E2E-HANDOFF');
      const pending = await control(device, { action: 'sign-in' });
      const navigation = new URL(pending.url);
      const query = quantum.siteCrypto.parseAuthorizeQuery(navigation);
      assert.ok(query, 'The site must accept the app launch as a handoff attempt');
      const secret = quantum.siteCrypto.unbase64url(new URLSearchParams(navigation.hash.slice(1)).get('keyHandoffSecret'), 32);
      const handed = randomBytes(32);
      // The site saves the new password envelope first, then seals the same K for this exact launch.
      const created = await fresh.browser.request('/v1/keys/password', await quantum.siteCrypto.makePasswordEnvelope(handed, password, fresh.accountId),
        { method: 'PUT', headers: { 'If-None-Match': '*' } });
      assert.equal(created.status, 200);
      const keyHandoff = await quantum.siteCrypto.sealAppKeyHandoff(handed, secret, quantum.siteCrypto.handoffContext(fresh.accountId, query));
      const authorized = await fresh.browser.request('/v1/oauth/authorize', { appId: query.appId, computerId: query.computerId, deviceName: query.deviceName,
        redirectUri: query.redirectUri, codeChallenge: query.codeChallenge, codeChallengeMethod: 'S256', keyHandoff });
      assert.equal(authorized.status, 200);
      const callback = new URL(query.redirectUri);
      callbacks.push(Number(callback.port)); quantum.trackCallback(callback.href);
      callback.searchParams.set('state', query.state); callback.searchParams.set('code', (await authorized.json()).code);
      assert.equal((await fetch(callback, { signal: AbortSignal.timeout(10_000) })).status, 200);
      await until(() => control(device, { action: 'status' }), status => status.signInPending === false && status.keyReady === true, 'The handed-off K did not open the data');
      assert.ok((await readAccountKey(fresh.accountId, { file: device.file })).equals(handed), 'The shared store must hold the handed-off K');
      assert.equal(device.writes(), 1);
      return { http: [200, 200, 200], typed: 'nothing' };
    });
    await scenario('natural server expiry and cancelled PKCE release their listeners', async () => {
      const remaining = expiry.row.expiresAt - Date.now() + 100;
      if (remaining > 0) await delay(remaining);
      assert.equal((await terminalClient.request(`/v1/key-approval-requests/${expiry.id}`)).status, 'expired');
      await assert.rejects(terminalClient.request(`/v1/key-approvals/${expiry.row.id}`), error => error.status === 404);
      const device = await makeDevice('E2E-CANCEL-SIGNIN');
      const pending = await control(device, { action: 'sign-in' });
      const callback = new URL(new URL(pending.url).searchParams.get('redirectUri'));
      assert.equal((await control(device, { action: 'cancel-sign-in' })).state, 'sign-in-cancelled');
      await assertPortReleased(Number(callback.port));
      return { http: [200, 404], expiry: 'natural five-minute deadline' };
    });
    key.fill(0);
  } catch (error) {
    results.preparedRoot = error.preparedRoot;
    results.setup = error.evidence;
    results.blocked = { code: error.code ?? error.name, message: error.message, command: error.command ?? null,
      output: error.command ? error.output : undefined };
    throw error;
  } finally {
    let cleanupError;
    for (const device of devices.reverse()) { try { await device.runtime.close(); } catch (error) { cleanupError ??= error; } }
    try { await core?.http.close(); if (servicePort) await assertPortReleased(servicePort); } catch (error) { cleanupError ??= error; }
    for (const port of callbacks) { try { await assertPortReleased(port); } catch (error) { cleanupError ??= error; } }
    const failed = Boolean(results.blocked) || results.scenarios.some(item => item.verdict === 'FAIL');
    if (failed && quantum) results.preparedRoot = quantum.root;
    try { await quantum?.close({ preservePrepared: failed }); } catch (error) { cleanupError ??= error; }
    if (quantum) results.setup = quantum.evidence;
    results.cleanup = cleanupError ? 'FAIL' : 'PASS';
    await mkdir(path.dirname(reportFile), { recursive: true }); await writeFile(reportFile, `${JSON.stringify(results, null, 2)}\n`);
    if (cleanupError) throw cleanupError;
  }
});
