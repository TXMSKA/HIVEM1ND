import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapConfig } from '../engine/service/install.mjs';
import { runConfiguredService, stopService } from '../engine/service/service.mjs';
import { stageTransaction } from '../engine/sync/store.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function eventually(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('The configured ReLAN members did not converge.');
}

test('a configured ReLAN host stops promptly with an active member and received history', async t => {
  const fixtures = [];
  const handles = [];
  t.after(async () => {
    await Promise.all(handles.map(handle => stopService(handle, { force: true })));
    for (const fixture of fixtures) await dispose(fixture);
  });
  for (const machine of ['STOP-HOST', 'STOP-MEMBER']) {
    const fixture = await makeCoreFixture({ machine });
    fixtures.push(fixture);
    const config = bootstrapConfig({ mindPath: fixture.paths.mind, machine,
      stagingPath: fixture.paths.staging, origin: { kind: 'relan', path: path.join(fixture.root, 'mirror') },
      encryption: { algorithm: 'aes-256-gcm', keyId: 'relan-stop-key' } });
    await writeFile(fixture.paths.configFile, JSON.stringify(config));
    handles.push(await runConfiguredService({ platform: fixture.platform, mindPath: fixture.paths.mind,
      cosmicPath: fixture.paths.cosmic, hostname: machine, store: fixture.store, env: fixture.env,
      aclRunner: fixture.store.aclRunner, now: Date.now, userKey: randomUUID(), guardPort: 0,
      projects: [], clients: [], deferSync: false,
      relan: { addresses: ['127.0.0.1'], port: 0, allowLoopback: true,
        timers: { initialMs: 60000, announceMs: 100, hostLossMs: 10000, tickMs: 25, retryMs: 100 },
        discovery: { port: 0, targets: [] } } }));
  }
  const [host, member] = handles.map(handle => handle.runtime);
  const { code } = await host.relan.showCode();
  await host.relan.host();
  await host.startSync();
  const endpoint = host.relan.status().listeners[0];
  await member.relan.join(code, endpoint);
  await member.startSync();
  for (let index = 0; index < 5; index += 1) {
    const changes = await stageTransaction(member.sync, [{ target: { kind: 'mind', path: `user/stop-${index}.txt` }, bytes: Buffer.from(`probe ${index}`) }]);
    await member.pulse.changed(changes.map(change => change.id));
    assert.equal((await member.pulse.flush()).published, true);
  }
  const groups = path.join(host.paths.localDirectory, 'received', 'groups');
  await mkdir(groups, { recursive: true });
  const history = new Set();
  for (let index = 0; index < 120; index += 1) {
    const id = randomUUID();
    const file = path.join(groups, `${id}.json`);
    history.add(file);
    await writeFile(file, JSON.stringify({ id, ops: [], events: [], done: 0, emitted: true }));
  }
  const open = fs.open;
  let scanned = 0;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (history.has(String(file))) {
      scanned += 1;
      // Bound shutdown by cancellation, rather than the speed or length of the disk history.
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    return open(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await writeFile(path.join(host.paths.mind, 'user', 'stop-trigger.txt'), 'changed');
  await eventually(() => scanned > 0);
  assert.equal(member.relan.status().host, 'STOP-HOST');
  const started = performance.now();
  await stopService(handles[0], { force: true });
  const elapsed = performance.now() - started;
  t.diagnostic(`host stop with active member: ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < 2000, `Stopping the host took ${Math.round(elapsed)} ms.`);
});
