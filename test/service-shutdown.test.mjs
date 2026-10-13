import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { writeMachineRecord } from '../engine/records.mjs';
import { uninstall } from '../engine/uninstall.mjs';
import { CoreError } from '../engine/service/identity.mjs';
import { startService, stopConfiguredService, stopService } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function fixtureFor(t) {
  const fixture = await makeCoreFixture();
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const guardPort = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const options = {
    platform: fixture.platform, env: fixture.env, homeDir: fixture.home, cosmicPath: fixture.paths.cosmic,
    mindPath: fixture.paths.mind, hostname: fixture.machine, guardPort, userKey: fixture.root,
    aclRunner: fixture.store.aclRunner, confineRoot: fixture.root,
  };
  const owned = await startService({ ...options, paths: fixture.paths, store: fixture.store, now: () => fixture.clock.now });
  t.after(async () => { await stopService(owned); await dispose(fixture); });
  return { fixture, options, owned };
}

test('uninstall authenticates the owned service and waits for shutdown before removing machine data', async t => {
  const { fixture, options, owned } = await fixtureFor(t);
  await writeMachineRecord(fixture.paths.mind, fixture.machine, { machine: fixture.machine, mind: fixture.paths.mind, setup: 'done', agents: [] });
  const file = path.join(fixture.paths.localDirectory, 'shutdown.json');
  const descriptor = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(descriptor.secret, owned.bridge.secret);
  assert.equal(fixture.store.aclRunner.calls.some(call => call.op === 'check' && call.target === file), true);
  const dry = await uninstall({ ...options, dryRun: true });
  assert.equal(dry.action, 'uninstall');
  assert.equal((await fetch(`http://127.0.0.1:${owned.http.port}/`)).status, 200);
  const result = await uninstall(options);
  assert.equal(result.action, 'uninstall');
  for (const target of [file, fixture.paths.activeFile, fixture.paths.lockFile, path.join(fixture.paths.mind, 'user', 'machines', `${fixture.machine}.md`)]) {
    await assert.rejects(readFile(target), { code: 'ENOENT' });
  }
  assert.deepEqual(owned.signaled, []);
  assert.deepEqual(await stopConfiguredService(options), { stopped: false, absent: true });
});

test('a mismatched private shutdown binding preserves the live service and machine data', async t => {
  const { fixture, options, owned } = await fixtureFor(t);
  await writeMachineRecord(fixture.paths.mind, fixture.machine, { machine: fixture.machine, mind: fixture.paths.mind, setup: 'done', agents: [] });
  const file = path.join(fixture.paths.localDirectory, 'shutdown.json');
  const raw = await readFile(file);
  const descriptor = JSON.parse(raw);
  const activeRaw = await readFile(fixture.paths.activeFile);
  await writeFile(fixture.paths.activeFile, JSON.stringify({ ...JSON.parse(activeRaw), mindPath: path.join(fixture.root, 'foreign-mind') }));
  await assert.rejects(uninstall({ ...options, shutdownTimeoutMs: 40 }), { code: 'service_unavailable' });
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'machines', `${fixture.machine}.md`), 'utf8'), /^setup: done$/m);
  await writeFile(fixture.paths.activeFile, activeRaw);
  await writeFile(file, JSON.stringify({ ...descriptor, nonce: 'foreign' }));
  await assert.rejects(uninstall(options), { code: 'service_unavailable' });
  assert.equal((await fetch(`http://127.0.0.1:${owned.http.port}/`)).status, 200);
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'machines', `${fixture.machine}.md`), 'utf8'), /^setup: done$/m);
  assert.deepEqual(owned.signaled, []);
  await assert.rejects(uninstall({ ...options, stopService: async () => { throw new CoreError(422, 'invalid_path', 'Unsafe shutdown path'); } }), { code: 'invalid_path' });
  assert.match(await readFile(path.join(fixture.paths.mind, 'user', 'machines', `${fixture.machine}.md`), 'utf8'), /^setup: done$/m);
  await writeFile(file, raw);
});
