import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, hashBytes } from '../engine/service/identity.mjs';
import { encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport, replicate } from '../engine/sync/replicate.mjs';
import { openRelayPlusTransport, createRelayPlusFeed } from '../engine/relay-plus/transport.mjs';
import { openRelanListener, openRelanTransport } from '../engine/relan/http.mjs';
import { createRelayPlusKeys } from '../engine/relay-plus/keys.mjs';

const key = Buffer.alloc(32, 7);
const keyProvider = () => key;
function packed(machine, sequence) {
  return encodePack({ machine, sequence, changes: [], encryption: { algorithm: 'aes-256-gcm', keyId: 'account-key' }, keyProvider });
}
function head(machine, packs) {
  return { format: 'hivem1nd-head-v1', machine, sequence: packs.length, updatedAt: '2026-10-30T12:00:00.000Z',
    packs: packs.map((bytes, index) => ({ file: packFileName(index + 1), sequence: index + 1, hash: hashBytes(bytes), bytes: bytes.length })) };
}
function fakeContract() {
  const objects = new Map();
  const calls = [];
  let writeError = null;
  const client = {
    async request(route, options = {}) {
      calls.push({ route, ...options });
      const url = new URL(route, 'http://127.0.0.1');
      if (options.method === 'PUT' && writeError) throw writeError;
      if (url.pathname === '/v1/datasets/hivem1nd' && options.method === 'PUT') return { id: 'hivem1nd' };
      if (url.pathname === '/v1/datasets/hivem1nd/objects') {
        const after = url.searchParams.get('after') ?? '';
        const entries = [...objects].filter(([name]) => name > after).sort(([a], [b]) => a.localeCompare(b)).slice(0, 1000);
        return { objects: entries.map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: hashBytes(bytes) })), after: entries.length === 1000 ? entries.at(-1)[0] : null };
      }
      const location = decodeURIComponent(url.pathname.split('/objects/')[1] ?? '');
      if (options.method === 'PUT') {
        const bytes = Buffer.from(options.body);
        assert.equal(options.headers['Content-Length'], String(bytes.length));
        assert.equal(options.headers['X-Content-SHA256'], hashBytes(bytes));
        if (objects.has(location) && !objects.get(location).equals(bytes)) throw new CoreError(409, 'object_conflict', 'Conflict.');
        objects.set(location, bytes);
        return { success: true };
      }
      if (options.method === 'DELETE') { objects.delete(location); return { success: true }; }
      if (!objects.has(location)) throw new CoreError(404, 'not_found', 'Missing.');
      return Buffer.from(objects.get(location));
    },
  };
  const transport = (machine, computerId = machine, extra = {}) => openRelayPlusTransport({ client, machine, computerId,
    accountId: 'test-account', keyId: 'account-key', keyProvider, ...extra });
  return { objects, calls, client, transport, setWriteError(value) { writeError = value; } };
}

test('Relay+ encrypts heads, publishes them after packs, deletes only older own heads and preserves history', async () => {
  const fake = fakeContract();
  const writer = fake.transport('DESKTOP', 'writer-id');
  const first = packed('DESKTOP', 1), second = packed('DESKTOP', 2);
  await assert.rejects(writer.writeHead(head('DESKTOP', [first])), { code: 'missing_pack' });
  await writer.writePack('DESKTOP', 1, first);
  await writer.writeHead(head('DESKTOP', [first]));
  assert.equal(fake.objects.get('writers/writer-id/1/heads/1.enc').includes(Buffer.from('DESKTOP')), false);
  await writer.writePack('DESKTOP', 2, second);
  await writer.writeHead(head('DESKTOP', [first, second]));
  assert.equal(fake.objects.has('writers/writer-id/1/heads/1.enc'), false);
  assert.equal(fake.objects.has('writers/writer-id/1/packs/1.enc'), true);
  const reader = fake.transport('LAPTOP');
  assert.deepEqual(await reader.listHeads(), [head('DESKTOP', [first, second])]);
  assert.deepEqual(await reader.readPack('DESKTOP', 1), first);
  assert.equal(reader.canWriteMachine('DESKTOP'), false);
  await assert.rejects(reader.writePack('DESKTOP', 1, first), { code: 'writer_forbidden' });
});

test('Relay+ create-only retries reuse encrypted heads and refuse different immutable packs', async () => {
  const fake = fakeContract();
  const writer = fake.transport('DESKTOP');
  const first = packed('DESKTOP', 1);
  await writer.writePack('DESKTOP', 1, first);
  await writer.writeHead(head('DESKTOP', [first]));
  const saved = Buffer.from(fake.objects.get('writers/DESKTOP/1/heads/1.enc'));
  await writer.writePack('DESKTOP', 1, first);
  assert.equal(await writer.writeHead(head('DESKTOP', [first])), false);
  assert.deepEqual(fake.objects.get('writers/DESKTOP/1/heads/1.enc'), saved);
  await assert.rejects(writer.writePack('DESKTOP', 1, packed('DESKTOP', 1)), { code: 'object_conflict' });
});

test('existing ReLAN history and Relay+ converge by union with identical pack bytes', async t => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/dual-transport-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const existingMindKey = { keyId: 'account-key', relanId: 'existing-mind', key };
  const keys = createRelayPlusKeys({ accountId: 'test-account', mindId: 'existing-mind', deviceId: 'DESKTOP',
    existingMindKey, loadState: async () => null, saveState: async () => {},
    accountKeyStore: { readAccountKey: async () => Buffer.alloc(32, 21) } });
  await keys.unlock();
  await keys.createMindKey();
  const desktop = openFolderTransport({ directory: path.join(root, 'desktop'), keyProvider });
  const laptop = openFolderTransport({ directory: path.join(root, 'laptop'), keyProvider });
  const original = packed('DESKTOP', 1), remote = packed('LAPTOP', 1);
  await desktop.writePack('DESKTOP', 1, original);
  await desktop.writeHead(head('DESKTOP', [original]));
  await laptop.writePack('LAPTOP', 1, remote);
  await laptop.writeHead(head('LAPTOP', [remote]));
  const listener = await openRelanListener({ transport: laptop, keyProvider, getKey: () => existingMindKey,
    addresses: ['127.0.0.1'], allowLoopback: true, longPollMs: 10,
    getState: () => ({ machine: 'LAPTOP', epoch: 1, hosting: true }) });
  t.after(() => listener.close());
  const relan = openRelanTransport({ address: '127.0.0.1', port: listener.listeners[0].port, key });
  const fake = fakeContract();
  const relay = fake.transport('DESKTOP', 'DESKTOP', { mindId: 'existing-mind', headKey: () => keys.headKey(),
    sealMindKey: () => keys.sealMindKey(), openMindKey: value => keys.openMindKey(value) });
  const origin = { paths: { origin: path.join(root, 'desktop') }, store: {}, machine: 'DESKTOP' };
  await replicate({ origin, transport: relan, keyProvider });
  await replicate({ origin, transport: relay, keyProvider });
  await replicate({ origin, transport: relan, keyProvider });
  assert.deepEqual(await replicate({ origin, transport: relay, keyProvider }),
    { pushed: 0, pulled: 0, headsPushed: 0, headsPulled: 0 });
  assert.deepEqual(await desktop.readPack('DESKTOP', 1), original);
  assert.deepEqual(await desktop.readPack('LAPTOP', 1), remote);
  assert.deepEqual(fake.objects.get('writers/DESKTOP/1/packs/1.enc'), original);
  assert.deepEqual(await desktop.listHeads(), await laptop.listHeads());
  assert.equal((await desktop.listHeads()).reduce((total, value) => total + value.packs.length, 0), 2);
});

test('Relay+ authenticates account and path bindings and refuses plaintext packs', async () => {
  const fake = fakeContract();
  const writer = fake.transport('DESKTOP');
  const first = packed('DESKTOP', 1);
  await writer.writePack('DESKTOP', 1, first);
  await writer.writeHead(head('DESKTOP', [first]));
  await assert.rejects(fake.transport('LAPTOP', 'LAPTOP', { accountId: 'other-account' }).listHeads(), { code: 'authentication_failed' });
  fake.objects.set('writers/OTHER/1/heads/1.enc', fake.objects.get('writers/DESKTOP/1/heads/1.enc'));
  await assert.rejects(fake.transport('LAPTOP').listHeads(), { code: 'authentication_failed' });
  await assert.rejects(writer.writePack('DESKTOP', 2, encodePack({ machine: 'DESKTOP', sequence: 2, changes: [] })), { code: 'invalid_pack' });
});

test('plan loss still pulls remote history and writer authorization skips cached foreign uploads', async () => {
  const fake = fakeContract();
  const remote = fake.transport('LAPTOP');
  const foreign = packed('LAPTOP', 1);
  await remote.writePack('LAPTOP', 1, foreign);
  await remote.writeHead(head('LAPTOP', [foreign]));
  const temporaryRoot = path.resolve('.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, 'relay-plus-transport-'));
  try {
    const local = openFolderTransport({ directory: root, keyProvider });
    const owned = packed('DESKTOP', 1), cached = packed('SCOUT', 1);
    await local.writePack('DESKTOP', 1, owned);
    await local.writeHead(head('DESKTOP', [owned]));
    await local.writePack('SCOUT', 1, cached);
    await local.writeHead(head('SCOUT', [cached]));
    const states = [];
    const transport = fake.transport('DESKTOP', 'DESKTOP', { onState: value => states.push(value) });
    fake.setWriteError(new CoreError(403, 'relayplus_required', 'Plan required.'));
    assert.deepEqual(await replicate({ origin: { paths: { origin: root }, store: {}, machine: 'DESKTOP' }, transport, keyProvider }),
      { pushed: 0, pulled: 1, headsPushed: 0, headsPulled: 1 });
    assert.equal(transport.state, 'read-only');
    assert.equal(states[0].code, 'relayplus_required');
    assert.deepEqual(await local.readPack('LAPTOP', 1), foreign);
    assert.equal(fake.objects.has('writers/SCOUT/1/packs/1.enc'), false);
    fake.setWriteError(null);
    transport.setWritable(true);
    assert.deepEqual(await replicate({ origin: { paths: { origin: root }, store: {}, machine: 'DESKTOP' }, transport, keyProvider }),
      { pushed: 1, pulled: 0, headsPushed: 1, headsPulled: 0 });
    assert.equal(fake.objects.has('writers/SCOUT/1/packs/1.enc'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('aggregate feed applies before persisting, shares one hold and honours Retry-After', async () => {
  const order = [];
  let calls = 0;
  const client = { async response(route, { signal }) {
    calls += 1;
    if (calls > 1) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    assert.match(route, /after=saved/);
    return new Response(JSON.stringify({ changes: [{ type: 'object_added' }], cursor: 'next' }), { headers: { 'Retry-After': '2' } });
  } };
  let wake;
  const waiting = new Promise(resolve => { wake = resolve; });
  const feed = createRelayPlusFeed({ client, loadCursor: async () => 'saved', applyPage: async () => order.push('apply'),
    saveCursor: async cursor => order.push(cursor), wait: async ms => { order.push(ms); wake(); } });
  const running = feed.start();
  assert.equal(feed.start(), running);
  await waiting;
  await feed.stop();
  assert.deepEqual(order, ['apply', 'next', 2000]);
  assert.ok(calls <= 2);
});

test('cursor expiry captures a fresh cursor before bootstrap/list rebuilding and commits only after rebuild', async () => {
  const order = [];
  let calls = 0;
  let wake;
  const saved = new Promise(resolve => { wake = resolve; });
  const client = {
    async response(route, { signal }) {
      calls += 1;
      if (calls === 1) throw new CoreError(410, 'cursor_expired', 'Expired.');
      if (calls > 2) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      assert.equal(route.includes('after='), false);
      order.push('capture');
      return new Response(JSON.stringify({ changes: [], cursor: 'fresh' }));
    },
    async request(route) { assert.equal(route, '/v1/bootstrap'); order.push('bootstrap'); return { accountId: 'test-account' }; },
  };
  const feed = createRelayPlusFeed({ client, loadCursor: async () => 'expired', applyPage: async () => {},
    rebuild: async () => order.push('full-listings'), saveCursor: async cursor => { order.push(cursor); wake(); } });
  feed.start();
  await saved;
  await feed.stop();
  assert.deepEqual(order, ['capture', 'bootstrap', 'full-listings', 'fresh']);
});

test('revoked aggregate feed stops cleanly without retrying', async () => {
  let calls = 0;
  const states = [];
  const feed = createRelayPlusFeed({ client: { async response() { calls += 1; throw new CoreError(401, 'unauthorized', 'Revoked.'); } },
    applyPage: async () => {}, saveCursor: async () => {}, onState: value => states.push(value) });
  await feed.start();
  assert.equal(calls, 1);
  assert.equal(states[0].state, 'authentication-required');
  assert.equal(states[0].reason, 'session-expired');
});

test('acceptance and a generic denial stop the feed without becoming offline', async () => {
  const policies = [{ id: 'terms', version: 2, path: '/legal/terms' }];
  const states = [];
  const denied = [];
  const first = createRelayPlusFeed({ client: { async response() { throw new CoreError(403, 'acceptance_required', 'Accept.', { policies }); } },
    applyPage: async () => {}, saveCursor: async () => {}, onState: value => states.push(value) });
  await first.start();
  assert.equal(states[0].state, 'acceptance-required');
  assert.equal(states[0].policies[0].id, 'terms');
  const second = createRelayPlusFeed({ client: { async response() { throw new CoreError(403, 'forbidden', 'Denied.'); } },
    applyPage: async () => {}, saveCursor: async () => {}, onState: value => denied.push(value) });
  await second.start();
  assert.equal(denied[0].state, 'forbidden');
  assert.equal(denied.some(item => item.state === 'offline'), false);
});
