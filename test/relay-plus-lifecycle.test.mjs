import assert from 'node:assert/strict';
import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRelayPlus } from '../engine/relay-plus/runtime.mjs';
import { createRecoveryEnvelope } from '../engine/relay-plus/keys.mjs';
import { saveRelanKey } from '../engine/relan/keys.mjs';
import { protectLocalFile, stubAclRunner } from '../engine/service/security.mjs';

const vectors = JSON.parse(await readFile(new URL('./fixtures/cosmic-keys-vectors.json', import.meta.url), 'utf8'));
const password = vectors.password;
const START = 1_800_000_000_000;
const BASE = 'http://127.0.0.1:49123';
const POLICIES = [
  { id: 'terms', version: 'qa-next', path: '/terms/qa-next/' },
  { id: 'privacy', version: 'qa-next', path: '/privacy/qa-next/' },
];

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fakeClock() {
  let time = START;
  const pending = new Set();
  const waits = [];
  return {
    now: () => time,
    waits,
    wait(ms, signal) {
      waits.push(ms);
      return new Promise((resolve, reject) => {
        const entry = { due: time + ms, complete() { pending.delete(entry); signal?.removeEventListener('abort', abort); resolve(); } };
        const abort = () => { pending.delete(entry); reject(Object.assign(new Error('Cancelled test wait.'), { name: 'AbortError' })); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        pending.add(entry);
      });
    },
    tick(ms) {
      time += ms;
      for (const entry of [...pending]) if (entry.due <= time) entry.complete();
    },
  };
}

async function until(predicate, message = 'The expected lifecycle boundary was not reached.') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function failure(status, code, fields = {}, reason, retryAfter) {
  return Response.json({ error: { code, fields, ...(reason ? { reason } : {}) } }, {
    status, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : {},
  });
}

// This approver uses independent primitives and only the requester bytes sent to the API.
function sealApproval(accountId, row, key, approver) {
  const publicKey = Buffer.from(row.requesterPublic, 'base64');
  const requesterNonce = Buffer.from(row.requesterNonce, 'base64');
  const secret = diffieHellman({ privateKey: approver.privateKey,
    publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), publicKey]), format: 'der', type: 'spki' }) });
  const wrapping = Buffer.from(hkdfSync('sha256', secret, Buffer.concat([
    publicKey, approver.publicKey, requesterNonce, approver.nonce,
  ]), Buffer.from('cosmic-key-approval-v1'), 32));
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', wrapping, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['cosmic-key-approval-v1', accountId, row.id,
      row.requesterPublic, row.approverPublic, row.requesterNonce, row.approverNonce])));
    return Buffer.concat([Buffer.from([1]), iv, cipher.update(key), cipher.final(), cipher.getAuthTag()]).toString('base64');
  } finally { secret.fill(0); wrapping.fill(0); }
}

async function fixture(t, options = {}) {
  const temporaryRoot = path.resolve('.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, 'relay-lifecycle-'));
  const localDirectory = path.join(root, 'service');
  const credentialsFile = path.join(localDirectory, 'relay-plus', 'credentials.json');
  const aclRunner = stubAclRunner();
  const clock = fakeClock();
  const accountId = password.accountId;
  const expectedKey = Buffer.from(password.keyHex, 'hex');
  const stored = new Map(options.stored ? [[accountId, Buffer.from(expectedKey)]] : []);
  const state = {
    accountId, meId: accountId, available: true, entitled: options.entitled !== false,
    envelopes: [{ recipient: 'password', algorithm: password.algorithm, wrapped: password.wrapped }],
    policies: [], usageAcceptance: false, keyAcceptance: false, meFailure: null, tokenFailure: null,
    legalSteps: [], puts: [], deletes: 0, consumes: 0, writes: 0, keyReads: 0, legalReads: [],
    changes: 0, abortedChanges: 0, requests: [], row: null, receipt: null, putGate: null,
    putStatus: null, approve: false, approvalAcceptance: false, tamperOffer: false, failStore: false, tokenGate: null,
  };
  const generated = generateKeyPairSync('x25519');
  const approver = { privateKey: generated.privateKey,
    publicKey: generated.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32), nonce: randomBytes(32) };
  const accountKeyStore = {
    async readAccountKey(id) { return stored.has(id) ? Buffer.from(stored.get(id)) : null; },
    async writeAccountKey(id, key) {
      state.writes += 1;
      if (state.failStore) throw Object.assign(new Error('The fixture key store is unavailable.'), { code: 'store_unavailable' });
      stored.set(id, Buffer.from(key));
    },
  };
  const tokens = () => ({ accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), expiresIn: 900,
    deviceId: 'qa-device', account_id: accountId });
  async function seedCredentials() {
    await mkdir(path.dirname(credentialsFile), { recursive: true });
    await protectLocalFile(path.dirname(credentialsFile), { aclRunner });
    // This is the pre-change credential shape, without new lifecycle fields.
    await writeFile(credentialsFile, JSON.stringify({ ...tokens(), baseUrl: BASE, computerId: 'qa-writer', expiresAt: START + 900_000 }), { mode: 0o600 });
    await protectLocalFile(credentialsFile, { aclRunner });
  }
  const fakeFetch = async (url, request) => {
    const route = url.pathname;
    const method = request.method ?? 'GET';
    state.requests.push({ route, method, at: clock.now() });
    if (state.offline) throw Object.assign(new Error('The fixture is offline.'), { code: 'ECONNRESET' });
    if (route === '/v1/oauth/token') {
      if (state.tokenGate) await state.tokenGate.promise;
      if (state.tokenFailure) return failure(...state.tokenFailure);
      return Response.json(tokens());
    }
    if (route === '/v1/oauth/revoke') return Response.json({ success: true });
    if (route === '/v1/me') {
      if (state.meFailure) return failure(...state.meFailure);
      return Response.json({ accountId: state.meId, email: 'alex@example.com', plans: [], devices: [] });
    }
    if (route === '/v1/bootstrap') return Response.json({ accountId: state.meId, capabilities: { relayPlus: state.entitled }, after: null });
    if (route === '/v1/usage') return state.usageAcceptance
      ? failure(403, 'acceptance_required', { policies: POLICIES }) : Response.json({ usedBytes: 0, poolBytes: 1000 });
    if (route === '/v1/legal/requirements') {
      state.legalReads.push(clock.now());
      const next = state.legalSteps.shift();
      if (next?.retryAfter) return failure(429, 'rate_limited', {}, null, next.retryAfter);
      return Response.json({ policies: next?.policies ?? state.policies, registrationBetaRequired: false });
    }
    if (route === '/v1/keys') {
      state.keyReads += 1;
      return state.keyAcceptance ? failure(403, 'acceptance_required', { policies: POLICIES }) : Response.json({ keys: state.envelopes });
    }
    if (route === '/v1/key-approvers/availability') return Response.json({ available: state.available });
    if (route.startsWith('/v1/key-approval-requests/') && method === 'PUT') {
      state.puts.push(clock.now());
      if (state.putStatus) return failure(...state.putStatus);
      if (!state.row) state.row = { id: 'qa-approval', status: 'pending', createdAt: clock.now(), expiresAt: clock.now() + 300_000 };
      if (state.putGate) { await state.putGate.promise; throw Object.assign(new Error('The creation response was lost.'), { code: 'ECONNRESET' }); }
      return Response.json(state.row, { status: 201 });
    }
    if (route.startsWith('/v1/key-approval-requests/') && method === 'DELETE') {
      state.deletes += 1;
      if (state.row) state.receipt = { ...state.row, status: 'cancelled', endedAt: clock.now() };
      state.row = null;
      return Response.json({ success: true });
    }
    if (route.startsWith('/v1/key-approval-requests/') && method === 'GET') {
      return state.row || state.receipt ? Response.json(state.row ?? state.receipt) : failure(404, 'not_found');
    }
    if (route.startsWith('/v1/key-approvals/') && route.endsWith('/reveal')) {
      const body = JSON.parse(request.body);
      Object.assign(state.row, body, { status: 'revealed' });
      if (state.approve) Object.assign(state.row, { algorithm: vectors.approval.algorithm,
        wrapped: sealApproval(accountId, state.row, expectedKey, approver), status: 'approved' });
      if (state.tamperOffer) state.row.approverNonce = randomBytes(32).toString('base64');
      return Response.json(state.row);
    }
    if (route.startsWith('/v1/key-approvals/') && route.endsWith('/consume')) {
      state.consumes += 1;
      state.row = null;
      return Response.json({ success: true });
    }
    if (route.startsWith('/v1/key-approvals/') && method === 'GET') {
      if (state.approvalAcceptance) return failure(403, 'acceptance_required', { policies: POLICIES });
      if (!state.row) return failure(404, 'not_found');
      if (state.approve && state.row.status === 'pending') Object.assign(state.row, {
        approverPublic: approver.publicKey.toString('base64'), approverNonce: approver.nonce.toString('base64'), status: 'offered',
      });
      return Response.json(state.row);
    }
    if (route === '/v1/datasets/hivem1nd/objects') return Response.json({ objects: [], after: null });
    if (route === '/v1/changes') {
      state.changes += 1;
      return new Promise((resolve, reject) => {
        const abort = () => { state.abortedChanges += 1; reject(Object.assign(new Error('The fixture feed was cancelled.'), { name: 'AbortError' })); };
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
    }
    throw new Error('An unexpected fixture API route was requested.');
  };
  if (options.credentials !== false) await seedCredentials();
  if (options.mindKey) await saveRelanKey({ localDirectory, aclRunner }, options.mindKey);
  let runtime = await createRelayPlus({ localDirectory, machine: 'QA', computerId: 'qa-writer', mindId: 'qa-mind',
    baseUrl: BASE, siteUrl: 'http://127.0.0.1:49124', enabled: options.enabled === true, aclRunner,
    fetch: fakeFetch, now: clock.now, wait: clock.wait, accountKeyStore,
    onReplicated: options.onReplicated,
    origin: { store: {}, paths: { origin: path.join(root, 'origin') }, machine: 'QA' } });
  t.after(async () => {
    state.putGate?.resolve(); state.tokenGate?.resolve();
    await runtime.close();
    expectedKey.fill(0);
    for (const key of stored.values()) key.fill(0);
    const relative = path.relative(temporaryRoot, root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The fixture cleanup target escaped its temporary root.');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { state, stored, clock, credentialsFile, runtime,
    async reopen() {
      await runtime.close();
      runtime = await createRelayPlus({ localDirectory, machine: 'QA', computerId: 'qa-writer', mindId: 'qa-mind',
        baseUrl: BASE, enabled: false, aclRunner, fetch: fakeFetch, now: clock.now, wait: clock.wait, accountKeyStore });
      this.runtime = runtime;
      return runtime;
    } };
}

test('real PKCE callback opens the existing account and keeps the requester alive until completion', async t => {
  const f = await fixture(t, { credentials: false });
  const pending = await f.runtime.control({ action: 'sign-in' });
  assert.equal(pending.state, 'sign-in-pending');
  const authorization = new URL(pending.url);
  const callback = new URL(authorization.searchParams.get('redirectUri'));
  callback.searchParams.set('code', 'c'.repeat(43));
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  await until(() => f.state.keyReads > 0);
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.sync.state, 'key-required');
  assert.equal(status.sync.methods.password, true);
  assert.equal(status.signInPending, false);
});

test('simultaneous approval requests create at most one remote request', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.runtime.control({ action: 'request-approval' }), f.runtime.control({ action: 'request-approval' })]);
  assert.equal(f.state.puts.length, 1);
  assert.equal(results.every(result => result.state === 'approval-pending'), true);
  assert.equal(f.state.writes, 0);
});

for (const action of ['cancel-approval', 'sign-out']) {
  test(`${action} cancels an uncertain creation before its lost response arrives`, async t => {
    const f = await fixture(t);
    f.state.putGate = deferred();
    const creation = f.runtime.control({ action: 'request-approval' }).catch(error => ({ code: error.code }));
    await until(() => f.state.puts.length === 1);
    const cancellation = f.runtime.control({ action });
    await new Promise(resolve => setImmediate(resolve));
    f.state.putGate.resolve();
    await Promise.all([creation, cancellation]);
    assert.equal(f.state.deletes >= 1, true, 'The known client UUID must be cancelled even without a creation response.');
    assert.equal(f.state.row, null);
    assert.equal(f.state.writes, 0);
    const inspected = await f.runtime.control({ action: 'inspect' }).catch(error => ({ code: error.code }));
    assert.notEqual(inspected.stored, true);
    if (action === 'sign-out') assert.equal((await f.runtime.control({ action: 'status' })).state, 'signed-out');
  });
}

test('usage consent preserves exact policies, credentials and K and stops an already held feed', async t => {
  const f = await fixture(t, { stored: true, enabled: true });
  await until(() => f.state.changes === 1);
  const beforeCredentials = createHash('sha256').update(await readFile(f.credentialsFile)).digest('hex');
  const beforeKey = createHash('sha256').update(f.stored.get(password.accountId)).digest('hex');
  f.state.usageAcceptance = true;
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.state, 'acceptance-required');
  assert.deepEqual(status.policies, POLICIES);
  assert.equal(status.account.accountId, password.accountId);
  assert.equal(status.usage, null);
  assert.equal(status.pages.es.acceptance, 'http://127.0.0.1:49124/es/');
  assert.equal(createHash('sha256').update(await readFile(f.credentialsFile)).digest('hex') === beforeCredentials, true, 'Consent must retain credentials.');
  assert.equal(createHash('sha256').update(f.stored.get(password.accountId)).digest('hex') === beforeKey, true, 'Consent must retain the shared account key.');
  await until(() => f.state.abortedChanges === 1, 'Consent did not stop the active protected feed.');
  assert.equal(f.state.writes, 0);
});

test('consent during password selection exposes exact safe policies and leaves credentials intact', async t => {
  const f = await fixture(t);
  f.state.keyAcceptance = true;
  await assert.rejects(f.runtime.control({ action: 'unlock', password: password.password }), error =>
    error.code === 'acceptance_required' && error.status === 403 && JSON.stringify(error.details?.policies) === JSON.stringify(POLICIES));
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.sync.state, 'acceptance-required');
  assert.deepEqual(status.sync.policies, POLICIES);
  assert.equal(f.state.writes, 0);
  assert.equal((await readFile(f.credentialsFile)).length > 0, true);
  const requests = f.state.requests.length;
  const paused = await f.runtime.control({ action: 'request-approval' });
  assert.equal(paused.state, 'acceptance-required');
  assert.equal(f.state.requests.length, requests, 'Protected controls must remain paused while consent is missing.');
});

test('legal checks share a two-second throttle even when called concurrently', async t => {
  const f = await fixture(t);
  f.state.usageAcceptance = true;
  f.state.policies = POLICIES;
  await f.runtime.control({ action: 'status' });
  const first = f.runtime.control({ action: 'check-acceptance' });
  const second = f.runtime.control({ action: 'check-acceptance' });
  await until(() => f.state.legalReads.length >= 1);
  assert.equal(f.state.legalReads.length, 1, 'Concurrent legal checks must not bypass the shared throttle.');
  f.clock.tick(1999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.legalReads.length, 1);
  f.clock.tick(1);
  const results = await Promise.all([first, second]);
  assert.equal(results.every(result => result.resumed === false), true);
  assert.equal(f.state.legalReads.length <= 2, true);
  if (f.state.legalReads.length === 2) assert.equal(f.state.legalReads[1] - f.state.legalReads[0] >= 2000, true);
});

test('foreground legal polling honors Retry-After and resumes while unrelated Beta remains', async t => {
  const f = await fixture(t);
  f.state.usageAcceptance = true;
  await f.runtime.control({ action: 'status' });
  f.state.legalSteps = [{ retryAfter: 5 }, { policies: POLICIES }, { policies: [{ id: 'beta', version: 'qa-beta', path: '/beta/' }] }];
  const polling = f.runtime.resumeAcceptance();
  await until(() => f.state.legalReads.length === 1 && f.clock.waits.length > 0);
  f.clock.tick(4999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.legalReads.length, 1);
  f.clock.tick(1);
  await until(() => f.state.legalReads.length === 2 && f.clock.waits.length > 1);
  f.clock.tick(2000);
  await polling;
  assert.equal(f.state.legalReads[1] - f.state.legalReads[0] >= 5000, true);
  assert.equal(f.state.legalReads[2] - f.state.legalReads[1] >= 2000, true);
  f.state.usageAcceptance = false;
  assert.equal((await f.runtime.control({ action: 'status' })).sync.state, 'key-required');
});

test('another account cannot complete the saved account consent flow', async t => {
  const f = await fixture(t);
  f.state.usageAcceptance = true;
  await f.runtime.control({ action: 'status' });
  f.state.meId = 'different-account';
  f.state.policies = [];
  const result = await f.runtime.control({ action: 'check-acceptance' });
  assert.equal(result.resumed, false);
  assert.equal(result.stopped, true);
  assert.equal(f.state.legalReads.length, 0);
  assert.equal(f.state.writes, 0);
});

for (const revoked of [true, false]) {
  test(`a refresh failure preserves the ${revoked ? 'revoked-device' : 'expired-session'} distinction`, async t => {
    const f = await fixture(t, { stored: true });
    f.state.meFailure = [401, 'unauthorized'];
    f.state.tokenFailure = [400, 'invalid_grant', {}, revoked ? 'device_revoked' : null];
    const status = await f.runtime.control({ action: 'status' });
    assert.equal(status.state, 'authentication-required');
    assert.equal(status.reason, revoked ? 'device-revoked' : 'session-expired');
    const requests = f.state.requests.length;
    await f.runtime.control({ action: 'inbox' }).catch(() => {});
    assert.equal(f.state.requests.length, requests, 'Terminal authentication failure must stop protected traffic.');
    assert.equal(f.stored.has(password.accountId), true);
  });
}

test('a direct device revocation stops requests without refreshing or deleting K', async t => {
  const f = await fixture(t, { stored: true });
  f.state.meFailure = [401, 'unauthorized', {}, 'device_revoked'];
  const before = f.state.requests.filter(item => item.route === '/v1/oauth/token').length;
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.reason, 'device-revoked');
  assert.equal(f.state.requests.filter(item => item.route === '/v1/oauth/token').length, before);
  assert.equal(f.stored.has(password.accountId), true);
});

test('legacy phrase credentials still open retained M1ND data and reopening does not write K again', async t => {
  const retained = { keyId: 'qa-existing-key', relanId: 'qa-relan', key: randomBytes(32) };
  const f = await fixture(t, { mindKey: retained });
  const phrase = Array(24).fill('acorn').join(' ');
  const recovery = createRecoveryEnvelope({ phrase, key: Buffer.from(password.keyHex, 'hex') });
  f.state.envelopes = [{ recipient: 'phrase', ...recovery.envelope }];
  const choices = await f.runtime.control({ action: 'refresh-keys' });
  assert.equal(choices.methods.password, false);
  assert.equal(choices.methods.phrase, true);
  await f.runtime.control({ action: 'recover', phrase });
  assert.equal(f.runtime.keyProvider(retained.keyId)?.equals(retained.key), true, 'Recovery must preserve the existing M1ND encryption material.');
  assert.equal(f.state.writes, 1);
  const before = f.state.keyReads;
  const reopened = await f.reopen();
  assert.equal(reopened.keyProvider(retained.keyId)?.equals(retained.key), true, 'An old session must reopen its retained M1ND data.');
  assert.equal(f.state.keyReads, before);
  assert.equal(f.state.writes, 1);
  retained.key.fill(0); recovery.key.fill(0);
});

test('a password opening that completes after sign-out does not save the account key', async t => {
  const f = await fixture(t);
  const before = f.state.keyReads;
  let completed = false;
  const unlocking = f.runtime.control({ action: 'unlock', password: password.password })
    .then(result => { completed = true; return result; }, error => { completed = true; return { code: error.code }; });
  await until(() => f.state.keyReads > before);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, 'The fixture must reach sign-out while password derivation is pending.');
  await f.runtime.control({ action: 'sign-out' });
  const result = await unlocking;
  assert.equal(f.state.writes, 0);
  assert.notEqual(result.state, 'ready');
  assert.equal((await f.runtime.control({ action: 'status' })).state, 'signed-out');
});

for (const enabled of [false, true]) {
  test(`password opening reports ${enabled ? 'read-only without entitlement' : 'configured while disabled'} instead of ready`, async t => {
    const f = await fixture(t, { enabled, entitled: false });
    const result = await f.runtime.control({ action: 'unlock', password: password.password });
    assert.equal(result.state, enabled ? 'read-only' : 'configured');
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.consumes, 0);
  });

  test(`create-key preserves the ${enabled ? 'read-only' : 'configured'} synchronization state`, async t => {
    const f = await fixture(t, { stored: true, enabled, entitled: false });
    const result = await f.runtime.control({ action: 'create-key' });
    assert.equal(result.state, enabled ? 'read-only' : 'configured');
    assert.equal(f.state.writes, 0);
  });
}

test('a failed durable approval store never consumes and never reports recovered data', async t => {
  const f = await fixture(t);
  f.state.approve = true;
  f.state.failStore = true;
  await f.runtime.control({ action: 'request-approval' });
  await until(() => f.state.row?.requesterPublic);
  f.clock.tick(2000);
  await until(() => f.state.writes === 1);
  const result = await f.runtime.control({ action: 'accept' }).catch(error => ({ code: error.code }));
  assert.notEqual(result.state, 'ready');
  assert.notEqual(result.stored, true);
  assert.equal(f.state.consumes, 0);
  assert.equal(f.stored.has(password.accountId), false);
});

test('successive approval creations honor the prior Retry-After deadline', async t => {
  const f = await fixture(t);
  f.state.putStatus = [429, 'rate_limited', {}, null, 7];
  const first = await f.runtime.control({ action: 'request-approval' });
  assert.equal(first.outcome, 'rate-limited');
  f.state.putStatus = null;
  const second = f.runtime.control({ action: 'request-approval' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.puts.length, 1, 'A new creation must not bypass the previous Retry-After.');
  f.clock.tick(6999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.puts.length, 1);
  f.clock.tick(1);
  const result = await second;
  if (f.state.puts.length > 1) assert.equal(f.state.puts[1] - f.state.puts[0] >= 7000, true);
  assert.notEqual(result.stored, true);
  const retried = await f.runtime.control({ action: 'request-approval' });
  assert.equal(retried.state, 'approval-pending');
  assert.equal(f.state.puts.length, 2);
  assert.equal(f.state.puts[1] - f.state.puts[0] >= 7000, true);
});

test('a requester paused by consent resumes with the live key manager and stores K once', async t => {
  const f = await fixture(t);
  f.state.approvalAcceptance = true;
  await f.runtime.control({ action: 'request-approval' });
  await until(() => f.state.requests.some(item => item.route === '/v1/key-approvals/qa-approval'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.runtime.control({ action: 'status' })).sync.state, 'acceptance-required');
  f.state.approvalAcceptance = false;
  f.state.approve = true;
  const resumed = await f.runtime.control({ action: 'check-acceptance' });
  assert.equal(resumed.resumed, true);
  f.clock.tick(2000);
  await until(() => f.state.requests.some(item => item.route.endsWith('/reveal')));
  await new Promise(resolve => setImmediate(resolve));
  const result = await f.runtime.control({ action: 'accept' }).catch(error => ({ code: error.code }));
  assert.equal(f.state.writes, 1, 'The resumed requester must use the live account key manager.');
  assert.equal(result.stored, true);
  assert.equal(f.state.consumes, 1);
  assert.equal(f.state.puts.length, 1);
});

test('an approval response cannot change the offer pinned before reveal', async t => {
  const f = await fixture(t);
  f.state.approve = true;
  f.state.tamperOffer = true;
  await f.runtime.control({ action: 'request-approval' });
  await until(() => f.state.requests.some(item => item.route.endsWith('/reveal')));
  await new Promise(resolve => setImmediate(resolve));
  f.clock.tick(2000);
  const result = await f.runtime.control({ action: 'inspect' }).catch(error => ({ code: error.code }));
  assert.equal(f.state.writes, 0, 'A changed approver transcript must be rejected before any durable key write.');
  assert.notEqual(result.stored, true);
  assert.equal(f.state.consumes, 0);
});

test('consent arriving during an in-flight sync prevents a newly started feed', async t => {
  const entered = deferred();
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await fixture(t, { enabled: true, onReplicated: async () => { entered.resolve(); await gate.promise; } });
  const unlocking = f.runtime.control({ action: 'unlock', password: password.password });
  await entered.promise;
  f.state.usageAcceptance = true;
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.sync.state, 'acceptance-required');
  gate.resolve();
  await unlocking;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.changes, 0, 'A sync finishing after consent is blocked must not open a protected feed.');
});

test('sign-out during an expired-session refresh removes credentials and refuses the late grant', async t => {
  const f = await fixture(t);
  f.clock.tick(900_000);
  f.state.tokenGate = deferred();
  const checking = f.runtime.control({ action: 'status' }).catch(error => ({ code: error.code }));
  await until(() => f.state.requests.some(item => item.route === '/v1/oauth/token'));
  const signingOut = f.runtime.control({ action: 'sign-out' }).catch(error => ({ code: error.code }));
  await new Promise(resolve => setImmediate(resolve));
  f.state.tokenGate.resolve();
  const result = await signingOut;
  await checking;
  assert.equal(result.state, 'signed-out', 'An expired refresh must not prevent explicit sign-out.');
  assert.equal((await f.runtime.control({ action: 'status' })).state, 'signed-out');
  assert.equal(f.state.writes, 0);
});

test('offline sign-out removes only local credentials and keeps the shared data key', async t => {
  const f = await fixture(t, { stored: true });
  f.state.offline = true;
  const result = await f.runtime.control({ action: 'sign-out' });
  assert.equal(result.state, 'signed-out');
  assert.equal(f.stored.has(password.accountId), true);
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.state, 'signed-out');
  assert.equal(status.sync.state, 'signed-out');
});

test('signed-out message and key actions reject without waiting on their own control queue', { timeout: 3000 }, async t => {
  const f = await fixture(t, { credentials: false });
  for (const action of ['inbox', 'outbox', 'create-key', 'publish', 'delivered', 'read']) {
    await assert.rejects(f.runtime.control({ action }), { code: 'sign_in_required' });
  }
  assert.equal(f.state.requests.length, 0);
});

test('cancelling a replacement sign-in preserves the previous session and its working sync transport', async t => {
  const f = await fixture(t, { stored: true, enabled: true });
  await until(() => f.state.changes === 1);
  const reads = () => f.state.requests.filter(item => item.route === '/v1/datasets/hivem1nd/objects').length;
  const before = reads();
  await f.runtime.control({ action: 'cancel-sign-in' });
  f.runtime.wake();
  await until(() => reads() > before, 'Cancelling an inactive sign-in must not invalidate the active transport.');
  const pending = await f.runtime.control({ action: 'sign-in' });
  assert.equal(pending.state, 'sign-in-pending');
  await f.runtime.control({ action: 'cancel-sign-in' });
  await until(() => f.state.changes === 2, 'The previous signed-in session must resume its feed after cancellation.');
  assert.equal(f.runtime.ready(), true);
  assert.equal((await f.runtime.control({ action: 'status' })).sync.state, 'ready');
  assert.equal(f.state.writes, 0);
});

test('cancellation wins before a queued sign-in creates its listener', async t => {
  const f = await fixture(t);
  const beginning = f.runtime.control({ action: 'sign-in' }).catch(error => ({ code: error.code }));
  const cancelled = f.runtime.control({ action: 'cancel-sign-in' });
  const [result] = await Promise.all([beginning, cancelled]);
  assert.equal(result.code, 'operation_cancelled');
  assert.equal((await f.runtime.control({ action: 'status' })).signInPending, false);
});

test('a late failed status refresh cannot replace the signed-out state', async t => {
  const f = await fixture(t);
  f.clock.tick(900_000);
  f.state.tokenGate = deferred();
  f.state.tokenFailure = [503, 'temporarily_unavailable'];
  const checking = f.runtime.control({ action: 'status' });
  await until(() => f.state.requests.some(item => item.route === '/v1/oauth/token'));
  const signingOut = f.runtime.control({ action: 'sign-out' });
  await new Promise(resolve => setImmediate(resolve));
  f.state.tokenGate.resolve();
  await Promise.all([checking, signingOut]);
  const status = await f.runtime.control({ action: 'status' });
  assert.equal(status.state, 'signed-out');
  assert.equal(status.sync.state, 'signed-out');
});
