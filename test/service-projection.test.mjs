import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus, revisionRelation } from '../engine/service/events.mjs';
import { randomUUID } from 'node:crypto';
import { answersFor, observationFresh, paginate, paginateMessages, readCollection, readProjection, statusFor, waitingFor } from '../engine/service/projection.mjs';
import { revisionOf } from '../engine/service/store.mjs';
import { connectLead, createUnit, patchLayout, patchSettings } from '../engine/service/units.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');

function stateFile(fields, body = 'Ready.\n') {
  return `${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${body}`;
}

async function mind(t) {
  const fixture = await makeCoreFixture({ now: NOW });
  t.after(() => dispose(fixture));
  const root = fixture.paths.mind;
  await mkdir(path.join(root, 'user', 'state'), { recursive: true });
  await mkdir(path.join(root, 'user', 'inbox', 'master'), { recursive: true });
  await mkdir(path.join(root, 'user', 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'sessions'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats'), { recursive: true });
  fixture.paths.origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(fixture.paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  return fixture;
}

test('status precedence follows the existing view and state alone is not working', () => {
  assert.deepEqual(
    ['unknown', 'out', 'quota', 'waiting', 'working', 'idle'].map((expected) => expected),
    [
      statusFor({ malformed: true, state: 'in', activity: 'busy' }),
      statusFor({ state: 'out', activity: 'busy', quota: { exhausted: true }, waiting: true }),
      statusFor({ state: 'in', quota: { remaining: 0 }, waiting: true, activity: 'busy' }),
      statusFor({ state: 'in', waiting: true, activity: 'busy' }),
      statusFor({ state: 'in', activity: 'active' }),
      statusFor({ state: 'in', activity: 'idle' }),
    ],
  );
  assert.equal(statusFor({ state: 'in' }), 'idle');
});

test('stale and future beats do not answer, and stale observations are not fresh idle', () => {
  const running = { state: 'running', heartbeatAt: '2026-10-10T12:00:00.000Z' };
  assert.equal(answersFor(running, NOW), true);
  assert.equal(answersFor(running, NOW + 180001), false);
  assert.equal(answersFor({ ...running, heartbeatAt: '2026-10-10T12:00:31.000Z' }, NOW), false);
  assert.equal(answersFor({ state: 'stopped', heartbeatAt: running.heartbeatAt }, NOW), false);
  assert.equal(observationFresh('2026-10-10T11:44:00.000Z', NOW), false);
  assert.equal(observationFresh('2026-10-10T12:00:31.000Z', NOW), false);
  assert.equal(observationFresh('2026-10-10T11:50:00.000Z', NOW), true);
});

test('projection keeps duplicate names, one overseer, full counts, and deduped waiting', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  await writeFile(path.join(root, 'user', 'state', 'shop.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP', 'lead-id': 'root:overseer',
  }));
  await writeFile(path.join(root, 'user', 'state', 'other.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:other:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  await writeFile(path.join(root, 'user', 'state', 'overseer.md'), stateFile({
    unit: 'overseer', 'unit-id': 'root:overseer', role: 'overseer', state: 'in', machine: 'DESKTOP',
  }));
  await writeFile(path.join(root, 'user', 'state', 'extra.md'), stateFile({
    unit: 'extra', 'unit-id': 'root:extra', role: 'overseer', state: 'out', machine: 'DESKTOP',
  }));
  await writeFile(path.join(root, 'user', 'state', 'broken.md'), 'this is not a state\n');
  await writeFile(path.join(root, 'user', 'tasks', '029-review.md'), stateFile({
    id: 'project:shop:029', title: 'Review me', status: 'review', 'from-id': 'root:master', 'to-id': 'project:shop:executor-shop', date: '2026-10-10',
  }, 'Approved for review by overseer on 2026-10-10\n'));
  await writeFile(path.join(root, 'user', 'inbox', 'master', 'ask.md'), stateFile({
    id: 'message-ask', 'to-id': 'root:master', 'reply-requested': 'true', subject: 'Need a decision', timestamp: '2026-10-10T12:00:00.000Z',
  }));
  const view = await readProjection({ paths: fixture.paths, now: () => NOW });
  const names = view.units.filter((unit) => unit.unit === 'executor-shop').map((unit) => unit.id).sort();
  assert.deepEqual(names, ['project:other:executor-shop', 'project:shop:executor-shop']);
  assert.equal(view.leads.filter((id) => id === 'root:overseer').length, 1);
  assert.equal(view.issues.some((issue) => issue.code === 'duplicate_overseer'), true);
  const broken = view.units.find((unit) => unit.unit === 'broken');
  assert.equal(broken.status, 'unknown');
  assert.equal(broken.revision, null);
  assert.equal(view.waiting.some((item) => item.id === 'review:project:shop:029'), true);
  assert.equal(view.waiting.some((item) => item.id === 'message:message-ask'), true);
  assert.equal(waitingFor([...view.waiting, view.waiting[0]]).length, view.waiting.length);
  const page = await readCollection({ paths: fixture.paths, now: () => NOW }, 'units', { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.total, view.counts.units);
  assert.ok(page.total > 1);
  assert.ok(page.nextCursor);
});

test('message pages are chronological and cursors fail on filter or snapshot changes', async (t) => {
  const messages = [
    { id: 'c', timestamp: '2026-10-10T12:02:00.000Z', subject: 'third', body: '' },
    { id: 'a', timestamp: null, date: null, subject: 'none', body: '' },
    { id: 'b', timestamp: '2026-10-10T12:01:00.000Z', subject: 'second', body: '' },
  ];
  const page = paginateMessages(messages, { limit: 2, snapshot: 'snap' });
  assert.deepEqual(page.items.map((item) => item.id), ['b', 'c']);
  assert.equal(page.total, 3);
  const older = paginateMessages(messages, { limit: 2, cursor: page.nextCursor, snapshot: 'snap' });
  assert.deepEqual(older.items.map((item) => item.id), ['a']);
  const before = paginateMessages(messages, { limit: 2, before: 'c', snapshot: 'snap' });
  assert.deepEqual(before.items.map((item) => item.id), ['a', 'b']);
  assert.throws(() => paginateMessages(messages, { cursor: page.nextCursor, snapshot: 'other' }), (error) => error.code === 'cursor_expired');
  assert.throws(() => paginate(messages, { cursor: page.nextCursor, filters: { q: 'other' }, snapshot: 'snap' }), (error) => error.code === 'invalid_cursor');
  const fixture = await mind(t);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'one.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'two.md'), stateFile({
    unit: 'executor-shop-2', 'unit-id': 'project:shop:executor-shop-2', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  const first = await readCollection({ paths: fixture.paths, now: () => NOW }, 'units', { limit: 1, q: 'shop' });
  assert.ok(first.nextCursor);
  await assert.rejects(
    () => readCollection({ paths: fixture.paths, now: () => NOW }, 'units', { limit: 1, q: 'missing', cursor: first.nextCursor }),
    (error) => error.code === 'invalid_cursor',
  );
});

test('a view larger than 16 MB asks for the lists', async (t) => {
  const fixture = await mind(t);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'huge.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }, `${'x'.repeat(16000000)}\n`));
  await assert.rejects(
    () => readProjection({ paths: fixture.paths, now: () => NOW }),
    (error) => error.status === 413 && error.code === 'view_too_large',
  );
});

test('a service beat projects answers and an inaccessible mind is unavailable', async (t) => {
  const fixture = await mind(t);
  await writeFile(path.join(fixture.paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify({
    format: 'hivem1nd-service-v1', machine: 'DESKTOP', state: 'running', version: '3.0.0', heartbeatAt: '2026-10-10T12:00:00.000Z', startedAt: '2026-10-10T12:00:00.000Z',
  }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'sessions', 'one.json'), JSON.stringify({
    sessionId: '20c58b80-4d93-88cd-83b3-39d78f1d9d5d', unitId: 'project:shop:executor-shop', client: 'codex', machine: 'DESKTOP',
    activity: 'idle', activityObservedAt: '2026-10-10T11:40:00.000Z', quota: { remaining: 0, exhausted: true }, quotaObservedAt: '2026-10-10T11:40:00.000Z',
    registeredAt: '2026-10-10T11:40:00.000Z',
  }));
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'shop.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  const view = await readProjection({ paths: fixture.paths, now: () => NOW });
  assert.equal(view.machines[0].answers, true);
  assert.equal(view.sessions[0].activity, null);
  assert.equal(view.sessions[0].quota, null);
  assert.equal(view.units[0].status, 'idle');
  const file = path.join(fixture.root, 'not-mind');
  await writeFile(file, 'nope');
  await assert.rejects(
    () => readProjection({ paths: { ...fixture.paths, mind: file }, now: () => NOW }),
    (error) => error.status === 503 && error.code === 'mind_unavailable',
  );
});

test('events replay after a cursor, isolate viewers, and drop expired or duplicate revisions', async (t) => {
  const fixture = await mind(t);
  const clock = { now: NOW };
  const bus = createEventBus({ now: () => clock.now, machine: 'DESKTOP' });
  const desktop = { stableId: 'desktop', audience: 'desktop', viewerId: 'viewer-a' };
  const other = { stableId: 'other', audience: 'desktop', viewerId: 'viewer-b' };
  const phone = { stableId: 'phone', audience: 'phone', viewerId: null };
  const live = [];
  const subscription = bus.subscribe(desktop, {}, (frame) => live.push(frame));
  bus.subscribe(other);
  bus.subscribe(phone);
  const cursor = bus.captureCursor();
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'shop.md'), stateFile({
    unit: 'executor-shop', 'unit-id': 'project:shop:executor-shop', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  const emitted = bus.emit({
    name: 'unit.changed',
    resourceId: 'project:shop:executor-shop',
    revision: 'ab'.repeat(32),
    data: { unit: { id: 'project:shop:executor-shop' } },
  });
  assert.equal(bus.emit({
    name: 'unit.changed',
    resourceId: 'project:shop:executor-shop',
    revision: 'ab'.repeat(32),
    operationId: emitted.id,
    data: { unit: { id: 'project:shop:executor-shop' } },
  }).duplicate, true);
  assert.equal(revisionRelation('ab'.repeat(32), 'cd'.repeat(32)), 'different');
  assert.equal(revisionRelation('ab'.repeat(32), 'ab'.repeat(32)), 'equal');
  const view = await readProjection({ paths: fixture.paths, now: () => clock.now });
  assert.equal(view.units.some((unit) => unit.id === 'project:shop:executor-shop'), true);
  const replayed = bus.replay(subscription, cursor);
  assert.equal(replayed.reset, false);
  assert.equal(replayed.events.some((event) => event.name === 'unit.changed'), true);
  assert.equal(replayed.frames.at(-1).name, 'stream.ready');
  bus.emit({ name: 'watch.changed', viewerId: 'viewer-a', data: { watchId: 'w', viewerId: 'viewer-a', unitId: 'root:master', resourceId: null, state: 'watching' } });
  bus.emit({ name: 'session.changed', data: { session: { id: 's', nativeSessionId: 'secret-native', endpoint: 'pipe://secret' } } });
  assert.equal(live.some((frame) => frame.name === 'watch.changed'), true);
  const otherLive = [];
  const otherSub = bus.subscribe(other, {}, (frame) => otherLive.push(frame));
  bus.replay(otherSub, cursor);
  assert.equal(otherLive.some((frame) => frame.name === 'watch.changed'), false);
  const phoneLive = [];
  const phoneSub = bus.subscribe(phone, {}, (frame) => phoneLive.push(frame));
  bus.replay(phoneSub, cursor);
  const session = phoneLive.find((frame) => frame.name === 'session.changed');
  assert.equal(JSON.stringify(session).includes('secret-native'), false);
  assert.equal(JSON.stringify(session).includes('pipe://'), false);
  bus.closePrincipal('desktop');
  const before = live.length;
  bus.emit({ name: 'settings.changed', data: { settings: { look: 'modern' }, revision: 'c'.repeat(64) } });
  assert.equal(live.length, before);
  assert.throws(() => bus.replay(subscription, cursor), (error) => error.status === 401);
  const restart = bus.replay(otherSub, '00000000-0000-4000-8000-000000000000:1');
  assert.equal(restart.reset, true);
  assert.equal(restart.frames[0].name, 'stream.reset');
  assert.equal(restart.frames[1].name, 'stream.ready');
  for (let index = 0; index < 1001; index += 1) {
    bus.emit({ name: 'issue.changed', resourceId: `issue-${index}`, revision: `r${index}`, data: { issue: { path: null, code: 'x', message: 'x' }, resolved: false } });
  }
  assert.equal(bus.replay(otherSub, cursor).reset, true);
  const held = bus.captureCursor();
  bus.emit({ name: 'issue.changed', resourceId: 'bridge', revision: 'bridge', data: { issue: { path: null, code: 'x', message: 'bridge' }, resolved: false } });
  clock.now += 600001;
  bus.emit({ name: 'issue.changed', resourceId: 'later', revision: 'later', data: { issue: { path: null, code: 'x', message: 'later' }, resolved: false } });
  assert.equal(bus.replay(otherSub, held).reset, true);
});

function serviceContext(fixture) {
  return { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now };
}

async function answeringMachine(fixture) {
  fixture.paths.origin = path.join(fixture.root, 'origin');
  await mkdir(path.join(fixture.paths.origin, 'machines', 'DESKTOP'), { recursive: true });
  await writeFile(path.join(fixture.paths.origin, 'machines', 'DESKTOP', 'service.json'), JSON.stringify({
    format: 'hivem1nd-service-v1', machine: 'DESKTOP', state: 'running', version: '3.0.0',
    heartbeatAt: new Date(fixture.clock.now).toISOString(), startedAt: new Date(fixture.clock.now).toISOString(),
  }));
}

test('unit, lead, layout, and settings writes are validated before any file changes', async (t) => {
  const fixture = await mind(t);
  await answeringMachine(fixture);
  const context = serviceContext(fixture);
  await assert.rejects(
    () => createUnit({ ...context, paths: { ...fixture.paths, origin: path.join(fixture.root, 'missing-origin') } }, {
      unit: 'executor-shop', role: 'executor', scope: { kind: 'project', name: 'shop' }, machine: 'DESKTOP',
    }),
    (error) => error.code === 'machine_unavailable',
  );
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md')).then(() => true, () => false), false);
  const receipt = { principal: 'desktop', key: randomUUID(), method: 'POST', path: '/api/v1/units', body: { unit: 'overseer' }, requestId: randomUUID() };
  await createUnit(context, { unit: 'overseer', role: 'overseer', scope: 'root', machine: 'DESKTOP' }, { receipt });
  const again = await createUnit(context, { unit: 'overseer', role: 'overseer', scope: 'root', machine: 'DESKTOP' }, { receipt });
  assert.equal(again.replayed, true);
  assert.equal(fixture.store.events.filter((event) => event.name === 'unit.changed').length, 1);
  await assert.rejects(
    () => createUnit(context, { unit: 'second', role: 'overseer', scope: 'root', machine: 'DESKTOP' }),
    (error) => error.code === 'overseer_exists',
  );
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'second.md')).then(() => true, () => false), false);
  await createUnit(context, {
    unit: 'overlord-web', role: 'overlord', scope: { kind: 'environment', name: 'web' }, machine: 'DESKTOP', leadId: 'root:overseer',
  });
  await createUnit(context, {
    unit: 'executor-shop', role: 'executor', scope: { kind: 'project', name: 'shop' }, machine: 'DESKTOP', leadId: 'env:web:overlord-web', job: 'builder',
  });
  const executorPath = path.join(fixture.paths.mind, 'user', 'state', 'executor-shop.md');
  const beforeCycle = await readFile(executorPath);
  const overlordRevision = revisionOf(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'overlord-web.md')));
  await assert.rejects(
    () => connectLead(context, 'env:web:overlord-web', { leadId: 'project:shop:executor-shop', confirmed: true, expectedRevision: overlordRevision }),
    (error) => error.code === 'lead_cycle',
  );
  assert.deepEqual(await readFile(executorPath), beforeCycle);
  await writeFile(path.join(fixture.paths.mind, 'user', 'state', 'master.md'), stateFile({
    unit: 'master', 'unit-id': 'root:master', role: 'master', state: 'in', machine: 'DESKTOP',
  }, 'Keep this body.\n'));
  const masterPath = path.join(fixture.paths.mind, 'user', 'state', 'master.md');
  const masterBefore = await readFile(masterPath);
  await assert.rejects(
    () => connectLead(context, 'root:master', { leadId: 'root:overseer', confirmed: true, expectedRevision: revisionOf(masterBefore) }),
    (error) => error.code === 'invalid_lead',
  );
  assert.deepEqual(await readFile(masterPath), masterBefore);
  const layoutPath = path.join(fixture.paths.mind, 'user', 'gui', 'layout.json');
  const layoutBefore = await readFile(layoutPath);
  const moved = await patchLayout(context, {
    nodes: { 'root:overseer': { x: 12, y: 24 } },
    expectedRevision: revisionOf(layoutBefore),
  });
  assert.equal(moved.replayed, false);
  const layoutAfter = JSON.parse(await readFile(layoutPath, 'utf8'));
  assert.equal(layoutAfter.nodes['root:overseer'].x, 12);
  assert.equal(layoutAfter.nodes['project:shop:executor-shop'].x, 0);
  const layoutRevision = revisionOf(await readFile(layoutPath));
  await assert.rejects(
    () => patchLayout(context, { nodes: { 'root:overseer': { x: 100001, y: 1 } }, expectedRevision: layoutRevision }),
    (error) => error.code === 'invalid_body',
  );
  assert.equal(JSON.parse(await readFile(layoutPath, 'utf8')).nodes['root:overseer'].x, 12);
  const settings = await patchSettings(context, { look: 'high-contrast', expectedRevision: null });
  assert.equal(settings.replayed, false);
  const settingsPath = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
  const newer = Buffer.from(`${JSON.stringify({ format: 'hivem1nd-settings-v1', look: 'modern', language: 'es' })}\n`);
  await writeFile(settingsPath, newer);
  await assert.rejects(
    () => patchSettings(context, { language: 'en', expectedRevision: revisionOf(Buffer.from('{"format":"hivem1nd-settings-v1","look":"high-contrast","language":"en"}\n')) }),
    (error) => error.code === 'revision_conflict',
  );
  assert.equal(await readFile(settingsPath, 'utf8'), newer.toString('utf8'));
  const names = fixture.store.events.map((event) => event.name);
  assert.equal(names.filter((name) => name === 'unit.changed').length >= 1, true);
  assert.equal(names.includes('layout.changed'), true);
  assert.equal(names.includes('view.changed'), true);
  assert.equal(names.includes('settings.changed'), true);
});
