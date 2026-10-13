import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProjection } from '../engine/service/projection.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

test('session wake projection matches the complete binding and conservatively merges aliases', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const sessions = path.join(fixture.paths.mind, 'user', 'relay', 'sessions');
  const policies = path.join(fixture.paths.mind, 'user', 'relay', 'wake', 'policies');
  await mkdir(sessions, { recursive: true });
  await mkdir(policies, { recursive: true });
  const base = { unitId: 'root:builder', nativeSessionId: 'same-native', client: 'codex', machine: 'DESKTOP' };
  const bindings = [base, { ...base, client: 'cursor' }, { ...base, machine: 'LAPTOP' }];
  for (const [index, binding] of bindings.entries()) {
    await writeFile(path.join(sessions, `${index}.json`), JSON.stringify({ ...binding, sessionId: `session-${index}` }));
    await writeFile(path.join(policies, `${index}.json`), JSON.stringify({
      binding, enabled: true, deadlineAt: `2026-10-10T1${index + 3}:00:00.000Z`,
    }));
  }
  let view = await readProjection({ paths: fixture.paths, now: () => fixture.clock.now });
  for (const [index] of bindings.entries()) {
    assert.deepEqual(view.sessions.find((session) => session.id === `session-${index}`).wake, {
      enabled: true, deadlineAt: `2026-10-10T1${index + 3}:00:00.000Z`, pausedReason: null,
    });
  }
  await writeFile(path.join(policies, 'legacy-alias.json'), JSON.stringify({
    binding: base, enabled: false, deadlineAt: '2026-10-10T12:30:00.000Z', pausedReason: 'window_expired',
  }));
  view = await readProjection({ paths: fixture.paths, now: () => fixture.clock.now });
  assert.deepEqual(view.sessions.find((session) => session.id === 'session-0').wake, {
    enabled: false, deadlineAt: '2026-10-10T12:30:00.000Z', pausedReason: 'window_expired',
  });
  assert.equal(view.sessions.find((session) => session.id === 'session-1').wake.enabled, true);
  assert.equal(view.sessions.find((session) => session.id === 'session-2').wake.enabled, true);
});
