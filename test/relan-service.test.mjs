import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapConfig } from '../engine/service/install.mjs';
import { runConfiguredService, stopService } from '../engine/service/service.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { openOrigin, readHead, readOriginPack } from '../engine/sync/origin.mjs';
import { decodePack, resolveDependencies } from '../engine/sync/pack.mjs';
import { createPulse } from '../engine/sync/pulse.mjs';
import { listStaged, openSync, stageTransaction } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('encrypted publication waits for a key, resolves encrypted dependencies and recovers a prepared pack', async t => {
  const fixture = await makeCoreFixture();
  fixture.paths.origin = path.join(fixture.root, 'mirror');
  t.after(() => dispose(fixture));
  const key = randomBytes(32);
  const keyId = 'relan-test-key';
  const keyProvider = id => id === keyId ? key : null;
  let paired = false;
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const origin = openOrigin({ ...sync, machine: fixture.machine, keyProvider });
  const ledger = openLedger({ ...sync, machine: fixture.machine });
  const pulses = [];
  const start = () => {
    const pulse = createPulse({ sync, origin, ledger, now: sync.now, setTimeout, clearTimeout,
      keyProvider, encryption: () => ({ algorithm: 'aes-256-gcm', keyId }), ready: () => paired });
    pulses.push(pulse);
    return pulse;
  };
  t.after(async () => { for (const pulse of pulses) await pulse.close().done; });
  let pulse = start();
  const content = Buffer.from('The confidential ReLAN test file has never crossed the network as plaintext.');
  const stage = async name => {
    const changes = await stageTransaction(sync, [{ target: { kind: 'mind', path: `user/${name}.txt` }, bytes: content }]);
    await pulse.changed(changes.map(change => change.id));
  };
  await stage('first');
  assert.equal((await pulse.flush()).waitingForKey, true);
  assert.equal(await readHead(origin, fixture.machine), null);
  assert.equal((await listStaged(sync)).length, 1);
  paired = true;
  await pulse.resume();
  assert.equal((await pulse.flush()).published, true);
  const first = await readOriginPack(origin, fixture.machine, 1);
  assert.equal(first.includes(content), false);
  assert.throws(() => decodePack(first), { code: 'encryption_key_missing' });
  assert.equal(decodePack(first, { keyProvider }).header.encryption.algorithm, 'aes-256-gcm');
  fixture.clock.now += 1000;
  await stage('second');
  origin.fault = 'before-head';
  assert.equal((await pulse.flush()).error, 'injected_crash');
  const prepared = await readOriginPack(origin, fixture.machine, 2);
  assert.equal(decodePack(prepared, { keyProvider }).index.dependencies.length, 1);
  await pulse.close().done;
  pulse = start();
  await pulse.resume();
  assert.equal((await pulse.flush()).published, true);
  assert.equal((await readHead(origin, fixture.machine)).sequence, 2);
  assert.deepEqual(await readOriginPack(origin, fixture.machine, 2), prepared);
  assert.equal((await listStaged(sync)).length, 0);
  const resolved = await resolveDependencies(prepared, { keyProvider,
    readHead: machine => readHead(origin, machine), readPack: (machine, sequence) => readOriginPack(origin, machine, sequence) });
  assert.equal(resolved.status, 'ready');
  assert.ok([...resolved.objects.values()].some(bytes => bytes.equals(content)));
});

test('a configured ReLAN service starts unpaired and publishes only after its local key is available', async t => {
  const fixture = await makeCoreFixture();
  let handle;
  t.after(async () => { if (handle) await stopService(handle, { force: true }); await dispose(fixture); });
  const config = bootstrapConfig({ mindPath: fixture.paths.mind, machine: fixture.machine,
    stagingPath: fixture.paths.staging, origin: { kind: 'relan', path: path.join(fixture.root, 'mirror') },
    encryption: { algorithm: 'aes-256-gcm', keyId: 'local-reLAN-key' } });
  await mkdir(fixture.paths.localDirectory, { recursive: true });
  await writeFile(fixture.paths.configFile, JSON.stringify(config));
  handle = await runConfiguredService({ platform: fixture.platform, mindPath: fixture.paths.mind,
    cosmicPath: fixture.paths.cosmic, hostname: fixture.machine, store: fixture.store, env: fixture.env,
    aclRunner: fixture.store.aclRunner, now: () => fixture.clock.now, userKey: randomUUID(), guardPort: 0,
    projects: [], clients: [], deferSync: false,
    relan: { addresses: ['127.0.0.1'], port: 0, allowLoopback: true, discovery: { port: 0, targets: [] } } });
  const runtime = handle.runtime;
  assert.equal(runtime.relan.status().paired, false);
  assert.equal(await readHead(runtime.origin, fixture.machine), null);
  await runtime.relan.showCode();
  await runtime.startSync();
  const content = Buffer.from('Private service publication through the ReLAN envelope.');
  const changes = await stageTransaction(runtime.sync, [{ target: { kind: 'mind', path: 'user/service-secret.txt' }, bytes: content }]);
  await runtime.pulse.changed(changes.map(change => change.id));
  assert.equal((await runtime.pulse.flush()).published, true);
  const head = await readHead(runtime.origin, fixture.machine);
  const bytes = await readOriginPack(runtime.origin, fixture.machine, head.sequence);
  assert.equal(bytes.includes(content), false);
  const decoded = decodePack(bytes, { keyProvider: runtime.relan.keyProvider });
  assert.equal(decoded.header.encryption.algorithm, 'aes-256-gcm');
  assert.equal(JSON.parse(await readFile(fixture.paths.configFile, 'utf8')).origin.kind, 'relan');
});
