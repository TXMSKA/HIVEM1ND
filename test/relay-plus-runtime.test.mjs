import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRelayPlusAccount } from '../engine/relay-plus/account.mjs';
import { createRelayPlusKeys, createRecoveryEnvelope } from '../engine/relay-plus/keys.mjs';
import { createRelayPlus } from '../engine/relay-plus/runtime.mjs';
import { stubAclRunner, protectLocalFile } from '../engine/service/security.mjs';
import { encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport } from '../engine/sync/replicate.mjs';
import { hashBytes } from '../engine/service/identity.mjs';

test('runtime unlocks an existing protected account key, publishes encrypted history and aborts its held feed on close', async t => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/relay-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localDirectory = path.join(root, 'service');
  const originDirectory = path.join(root, 'origin');
  const accountId = 'fixture-account', deviceId = 'fixture-device', computerId = 'fixture-writer';
  const baseUrl = 'http://127.0.0.1:49876';
  const phrase = Array(24).fill('acorn').join(' ');
  let storedAccountKey = null;
  const accountKeyStore = { readAccountKey: async () => storedAccountKey,
    writeAccountKey: async (_id, key) => { storedAccountKey = Buffer.from(key); } };
  const recovery = createRecoveryEnvelope({ mindId: 'hivem1nd', phrase });
  const envelopes = new Map([['phrase', { recipient: 'phrase', ...recovery.envelope }]]);
  const objects = new Map();
  let listingGate = null, secondUploaded;
  const uploadedSecond = new Promise(resolve => { secondUploaded = resolve; });
  let holds = 0, activeHolds = 0, abortedHolds = 0;
  let beganHold;
  const held = new Promise(resolve => { beganHold = resolve; });
  const fakeFetch = async (url, options) => {
    const route = url.pathname;
    if (route === '/v1/oauth/token') return Response.json({ accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43),
      expiresIn: 900, deviceId, account_id: accountId });
    assert.equal(options.headers.get('Authorization'), `Bearer ${'a'.repeat(43)}`);
    if (route === '/v1/keys') return Response.json({ keys: [...envelopes.values()] });
    if (route.startsWith('/v1/keys/') && options.method === 'PUT') {
      const recipient = decodeURIComponent(route.split('/').at(-1));
      envelopes.set(recipient, { recipient, ...JSON.parse(options.body) });
      return Response.json({ success: true });
    }
    if (route === '/v1/bootstrap') return Response.json({ capabilities: { relayPlus: true }, after: null });
    if (route === '/v1/changes') {
      holds += 1; activeHolds += 1; beganHold();
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        activeHolds -= 1; abortedHolds += 1; reject(options.signal.reason);
      }, { once: true }));
    }
    if (route === '/v1/datasets/hivem1nd') return Response.json({ id: 'hivem1nd' });
    if (route === '/v1/datasets/hivem1nd/objects') {
      if (listingGate) { const gate = listingGate; listingGate = null; gate.entered(); await gate.wait; }
      return Response.json({ objects: [...objects].map(([name, bytes]) =>
        ({ path: name, size: bytes.length, sha256: hashBytes(bytes) })), after: null });
    }
    if (route.includes('/objects/')) {
      const name = decodeURIComponent(route.split('/objects/')[1]);
      if (options.method === 'PUT') {
        objects.set(name, Buffer.from(options.body));
        if (name.endsWith('/heads/2.enc')) secondUploaded();
        return Response.json({ success: true });
      }
      if (options.method === 'DELETE') { objects.delete(name); return Response.json({ success: true }); }
      if (objects.has(name)) return new Response(objects.get(name));
      return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    throw new Error(`Unexpected fixture route: ${route}`);
  };
  const aclRunner = stubAclRunner();
  const account = createRelayPlusAccount({ localDirectory, computerId, deviceName: 'DESKTOP', baseUrl, fetch: fakeFetch, aclRunner });
  const pending = await account.beginSignIn();
  t.after(pending.cancel);
  const callback = new URL(new URL(pending.url).searchParams.get('redirectUri'));
  callback.searchParams.set('code', 'c'.repeat(43));
  assert.equal((await fetch(callback)).status, 200);
  await pending.complete;
  const binding = createHash('sha256').update(`${accountId}:${deviceId}`).digest('hex');
  const file = path.join(localDirectory, 'relay-plus', `keys-${binding}.json`);
  let mindMaterial;
  const keys = createRelayPlusKeys({ client: account.client, deviceId, accountId, accountKeyStore,
    saveMindKey: async value => { mindMaterial = value; }, mindId: 'hivem1nd', loadState: async () => null,
    saveState: async state => { await writeFile(file, JSON.stringify(state), { mode: 0o600 }); await protectLocalFile(file, { aclRunner }); } });
  await keys.recover(phrase);
  await keys.createMindKey();
  const { saveRelanKey } = await import('../engine/relan/keys.mjs');
  await saveRelanKey({ localDirectory, aclRunner }, mindMaterial);
  const packed = encodePack({ machine: 'DESKTOP', sequence: 1, changes: [], encryption: keys.encryption, keyProvider: keys.keyProvider });
  const local = openFolderTransport({ directory: originDirectory, keyProvider: keys.keyProvider });
  await local.writePack('DESKTOP', 1, packed);
  await local.writeHead({ format: 'hivem1nd-head-v1', machine: 'DESKTOP', sequence: 1,
    updatedAt: '2026-10-30T12:00:00.000Z', packs: [{ sequence: 1, file: packFileName(1), bytes: packed.length, hash: hashBytes(packed) }] });
  const runtime = await createRelayPlus({ enabled: true, localDirectory, computerId, accountKeyStore, mindId: 'hivem1nd', machine: 'DESKTOP', baseUrl,
    fetch: fakeFetch, aclRunner, origin: { store: {}, paths: { origin: originDirectory }, machine: 'DESKTOP' } });
  t.after(() => runtime.close());
  await held;
  assert.equal(runtime.ready(), true);
  const generation = createHash('sha256').update('hivem1nd').digest('hex');
  assert.deepEqual(objects.get(`writers/${computerId}/${generation}/packs/1.enc`), packed);
  assert.equal(objects.get(`writers/${computerId}/${generation}/heads/1.enc`).includes(Buffer.from('DESKTOP')), false);
  assert.equal(holds, 1);
  let releaseListing, enteredListing;
  const entered = new Promise(resolve => { enteredListing = resolve; });
  const wait = new Promise(resolve => { releaseListing = resolve; });
  listingGate = { wait, entered: enteredListing };
  runtime.wake();
  await entered;
  const second = encodePack({ machine: 'DESKTOP', sequence: 2, changes: [], encryption: keys.encryption, keyProvider: keys.keyProvider });
  await local.writePack('DESKTOP', 2, second);
  await local.writeHead({ format: 'hivem1nd-head-v1', machine: 'DESKTOP', sequence: 2,
    updatedAt: '2026-10-30T12:01:00.000Z', packs: [packed, second].map((bytes, index) =>
      ({ sequence: index + 1, file: packFileName(index + 1), bytes: bytes.length, hash: hashBytes(bytes) })) });
  runtime.wake();
  releaseListing();
  await uploadedSecond;
  assert.deepEqual(objects.get(`writers/${computerId}/${generation}/packs/2.enc`), second,
    'A local pulse arriving during replication must schedule another pass without another remote event.');
  await runtime.close();
  assert.equal(activeHolds, 0);
  assert.equal(abortedHolds, 1);
  assert.equal(runtime.ready(), false);
});
