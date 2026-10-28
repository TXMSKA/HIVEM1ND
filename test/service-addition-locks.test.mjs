import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { makeCoreFixture, dispose } from './core-fixture.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { publishMachineSettings } from '../engine/service/settings.mjs';
import { hashBytes } from '../engine/service/identity.mjs';

// The settings publisher used to take settings-report and then local-observation, while removing an addition held
// local-observation and then needed settings-report: the opposite order, so both waited forever.
test('removing an addition while the settings publisher holds its report lock still answers', async (t) => {
  const fixture = await makeCoreFixture();
  const origin = path.join(fixture.root, 'origin');
  await mkdir(origin);
  const core = await composeCore({ store: fixture.store, paths: { ...fixture.paths, origin }, now: () => fixture.clock.now, projects: [] });
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  clearInterval(core.runtime.beatTimer); core.runtime.beatTimer = null;
  const id = randomUUID();
  const record = { format: 'hivem1nd-addition-v1', id, kind: 'repository', name: 'example', title: 'example', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    source: { kind: 'git', display: 'acme/example', url: 'https://github.com/acme/example' }, sourcePath: '.',
    pin: { kind: 'commit', value: 'a'.repeat(40), digest: 'b'.repeat(64) }, license: 'MIT', publishedAt: '2026-10-01T00:00:00.000Z',
    requirements: [], scope: { everyUnit: false, units: [], groups: [] }, unitCount: 0, machine: fixture.machine, projectId: 'example',
    installedAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z', removed: false, files: [] };
  const bytes = Buffer.from(JSON.stringify(record) + '\n');
  await mkdir(path.join(fixture.paths.mind, 'user/additions'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user/additions', id + '.json'), bytes);
  await mkdir(path.join(fixture.paths.mind, 'user/projects/example'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user/projects/example/product.json'), JSON.stringify({ format: 'hivem1nd-product-v1', title: 'example', additionId: id })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const token = core.credentials.issue({ audience: 'desktop', unitId: 'root:master' }).token;
  const call = (method, target, body) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = request({ host: '127.0.0.1', port: core.http.port, method, path: target, headers: {
      host: `127.0.0.1:${core.http.port}`, origin: `http://127.0.0.1:${core.http.port}`, authorization: `Bearer ${token}`,
      'content-type': 'application/json', 'content-length': String(payload.length), 'idempotency-key': randomUUID() } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(payload);
  });
  // Hold the publisher right after it takes settings-report, until the removal holds local-observation.
  let allowPublisher, reportHeld, removeHeld, armed = true, removing = false;
  const publisherMayContinue = new Promise((resolve) => { allowPublisher = resolve; });
  const reportAcquired = new Promise((resolve) => { reportHeld = resolve; });
  const removeAcquired = new Promise((resolve) => { removeHeld = resolve; });
  const base = fixture.store.locks.acquire.bind(fixture.store.locks);
  fixture.store.locks.acquire = async (key) => {
    const stack = new Error().stack.split('\n').slice(2, 9);
    const release = await base(key);
    // The first settings-report taken while only the publisher runs is the publisher's.
    if (armed && !removing && key === `settings-report:${fixture.machine}`) { reportHeld(); await publisherMayContinue; }
    if (key === 'local-observation' && stack.some((line) => line.includes('removeAddition'))) removeHeld();
    return release;
  };
  t.after(() => { fixture.store.locks.acquire = base; });
  fixture.clock.now += 1000;
  const publishing = publishMachineSettings(core.runtime.settingsOwner, 'service').catch(() => undefined);
  await reportAcquired;
  removing = true;
  const removal = call('DELETE', `/api/v1/additions/${id}`, { machine: fixture.machine, confirmed: true, expectedRevision: hashBytes(bytes) });
  // With one lock order the removal waits for local-observation instead of taking it, so give it a moment, not forever.
  await Promise.race([removeAcquired, new Promise((resolve) => setTimeout(resolve, 1000))]);
  armed = false; allowPublisher();
  const answered = await Promise.race([removal.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 20000))]);
  assert.equal(answered, true, 'the removal answered instead of waiting on the publisher forever');
  await publishing;
});
