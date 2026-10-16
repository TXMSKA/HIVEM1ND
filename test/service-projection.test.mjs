import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus, publishDomainEvents, revisionRelation } from '../engine/service/events.mjs';
import { randomUUID } from 'node:crypto';
import { hashText } from '../engine/service/identity.mjs';
import { answersFor, observationFresh, paginate, paginateMessages, readCollection, readDetail, readProjection, readSync, serviceRecord, statusFor, waitingFor } from '../engine/service/projection.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { clearInboundFailure, clearSyncFailure, openSync, recordInboundFailure, recordSyncFailure, stageTransaction } from '../engine/sync/store.mjs';
import { revisionOf } from '../engine/service/store.mjs';
import { request as httpRequest } from 'node:http';
import { clientRecords, probeClients } from '../engine/service/adapters.mjs';
import { composeCore, writeBeat } from '../engine/service/service.mjs';
import { connectLead, createUnit, patchLayout, patchSettings, setUnitAlias } from '../engine/service/units.mjs';
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
  }, '## Report\nApproved for review by overseer on 2026-10-10\n'));
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
  const secondFile = path.join(fixture.paths.mind, 'user', 'state', 'two.md');
  await writeFile(secondFile, (await readFile(secondFile, 'utf8')).replace('machine: DESKTOP', 'machine: LAPTOP'));
  await assert.rejects(
    () => readCollection({ paths: fixture.paths, now: () => NOW }, 'units', { limit: 1, q: 'shop', cursor: first.nextCursor }),
    (error) => error.code === 'cursor_expired',
  );
  assert.throws(() => paginate(messages, { cursor: 'not a cursor', snapshot: 'snap' }), (error) => error.code === 'invalid_cursor');
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
  const listed = await readCollection({ paths: fixture.paths, now: () => NOW }, 'units', { limit: 1 });
  assert.equal(listed.items.length, 1);
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
  assert.equal(replayed.frames.at(-1).data.source.kind, 'service');
  assert.equal(replayed.frames.at(-1).data.data.capabilities.length, 22);
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

test('replay keeps the emitted snapshot and expires it without a newer event', () => {
  const clock = { now: NOW };
  const bus = createEventBus({ now: () => clock.now, machine: 'DESKTOP' });
  const desktop = { stableId: 'desktop', audience: 'desktop', viewerId: 'viewer-a' };
  const subscription = bus.subscribe(desktop);
  const cursor = bus.captureCursor();
  const data = { unit: { id: 'root:master', name: 'before' } };
  const source = { kind: 'gui', id: 'DESKTOP', unitId: 'root:master' };
  bus.emit({ name: 'unit.changed', resourceId: 'root:master', revision: 'a'.repeat(64), data, source });
  data.unit.name = 'after';
  source.kind = 'local';
  const replayed = bus.replay(subscription, cursor);
  const frame = replayed.frames.find((item) => item.name === 'unit.changed');
  assert.equal(frame.data.data.unit.name, 'before');
  assert.deepEqual(frame.data.source, { kind: 'gui', id: 'DESKTOP', unitId: 'root:master' });
  clock.now += 600001;
  assert.equal(bus.replay(subscription, cursor).reset, true);
  const operation = 'op-1';
  assert.equal(bus.emit({
    name: 'unit.changed', operationId: operation, resourceId: 'root:master', revision: 'b'.repeat(64), data: { unit: { id: 'root:master' } },
  }).emitted, true);
  assert.equal(bus.emit({
    name: 'view.changed', operationId: operation, data: { revision: 'c'.repeat(64), collections: ['units'] },
  }).emitted, true);
  const agent = bus.subscribe({ stableId: 'agent', audience: 'agent', unitId: 'root:executor', capabilities: ['read', 'chat.post'] });
  const ready = bus.replay(agent, null);
  assert.deepEqual(ready.frames.at(-1).data.data.capabilities, ['read', 'chat.post']);
});

test('agent delivery uses live chat membership and ignores a unit id as a resource', async (t) => {
  const fixture = await mind(t);
  const chatId = 'f359bb5c-9d80-4b96-ad33-e9b99e523f52';
  const resourceId = '10943b49-2c8a-4b30-b3aa-2d431e34a551';
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'chats', chatId, 'chat.md'), `id: ${chatId}\nmembers: ["root:executor"]\n`);
  await mkdir(path.join(fixture.paths.mind, 'user', 'relay', 'editors'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'relay', 'editors', `${resourceId}.json`), JSON.stringify({ attached: ['root:executor'] }));
  const bus = createEventBus({ now: () => NOW, machine: 'DESKTOP', mind: fixture.paths.mind });
  const seen = [];
  bus.subscribe({
    stableId: 'agent-1', audience: 'agent', unitId: 'root:executor', chatIds: [], resourceIds: [],
  }, {}, (frame) => seen.push(frame.name));
  bus.emit({ name: 'unit.changed', data: { unit: { id: 'root:executor' } } });
  bus.emit({ name: 'unit.changed', data: { unit: { id: 'root:other' } } });
  bus.emit({ name: 'chat.changed', data: { chat: { id: chatId } } });
  bus.emit({ name: 'chat.changed', data: { chat: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } } });
  bus.emit({ name: 'blueprint.changed', resourceId, data: { resourceId } });
  bus.emit({ name: 'blueprint.changed', resourceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', data: { resourceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } });
  assert.deepEqual(seen, ['unit.changed', 'chat.changed', 'blueprint.changed']);
  const unitFrame = bus.replay(bus.subscribe({ stableId: 'desktop', audience: 'desktop' }), `${bus.startupId}:0`);
  const unitEvent = unitFrame.events.find((event) => event.name === 'unit.changed');
  assert.equal(unitEvent.resourceId, null);
});

test('a domain event is emitted once with the acting client source', () => {
  const bus = createEventBus({ now: () => NOW, machine: 'DESKTOP' });
  const seen = [];
  bus.subscribe({ stableId: 'desktop', audience: 'desktop', viewerId: 'viewer-a' }, {}, (frame) => seen.push(frame));
  const context = { store: { events: [] }, bus, paths: { machine: 'DESKTOP' }, principal: { unitId: 'root:master', audience: 'desktop' } };
  publishDomainEvents(context, [{ name: 'chat.changed', data: { chat: { id: 'room' } } }]);
  assert.equal(context.store.events.length, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].data.source, { kind: 'gui', id: 'DESKTOP', unitId: 'root:master' });
  assert.equal(seen[0].data.source.kind === 'unit', false);
});

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
  const overseer = await createUnit(context, { unit: 'overseer', role: 'overseer', scope: 'root', machine: 'DESKTOP' }, { receipt });
  assert.equal(overseer.unit.id, 'root:overseer');
  assert.equal(overseer.unit.role, 'overseer');
  assert.equal(overseer.unit.machine, 'DESKTOP');
  assert.equal(typeof overseer.unit.revision, 'string');
  assert.equal(overseer.unit.status, 'idle');
  const changed = fixture.store.events.filter((event) => event.name === 'unit.changed').at(-1);
  assert.equal(changed.data.unit.id, 'root:overseer');
  assert.equal(changed.data.unit.role, 'overseer');
  assert.equal(changed.data.unit.revision, overseer.unit.revision);
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
  await createUnit(context, { unit: 'worker', role: 'executor', scope: 'root', machine: 'DESKTOP', leadId: 'root:overseer' });
  await createUnit(context, { unit: 'worker', role: 'executor', scope: { kind: 'project', name: 'shop' }, machine: 'DESKTOP', leadId: 'root:overseer' });
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'state', 'worker.md')).then(() => true, () => false), true);
  assert.equal(await readFile(path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'state', 'worker.md')).then(() => true, () => false), true);
  const executorPath = path.join(fixture.paths.mind, 'user', 'projects', 'shop', 'state', 'executor-shop.md');
  const beforeCycle = await readFile(executorPath);
  const overlordRevision = revisionOf(await readFile(path.join(fixture.paths.mind, 'user', 'envs', 'web', 'state', 'overlord-web.md')));
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

test('a loopback projection read returns the same list shape', async (t) => {
  const fixture = await makeCoreFixture({ now: NOW });
  let core;
  t.after(async () => { await core?.http.close(); await dispose(fixture); });
  core = await composeCore({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
  const token = await new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }));
    const req = httpRequest({
      host: '127.0.0.1',
      port: core.http.port,
      method: 'POST',
      path: '/api/v1/auth/local',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        authorization: `Bearer ${core.bootstrap.secret}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).data.token));
    });
    req.on('error', reject);
    req.end(payload);
  });
  const listed = await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: core.http.port,
      path: '/api/v1/units',
      headers: {
        host: `127.0.0.1:${core.http.port}`,
        origin: `http://127.0.0.1:${core.http.port}`,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end();
  });
  const direct = await readCollection({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, principal: { unitId: 'root:master' } }, 'units');
  assert.deepEqual(listed.data.items, direct.items);
});

test('scoped records, terminal sessions and chat fields stay in the projection', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  const sessionId = '20c58b80-4d93-88cd-83b3-39d78f1d9d5d';
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'state'), { recursive: true });
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'inbox', 'builder'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'session-status', sessionId), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'room'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'room', 'read', 'master'), { recursive: true });
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'product.json'), JSON.stringify({ format: 'hivem1nd-product-v1', title: 'Shop' }));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'state', 'builder.md'), stateFile({
    unit: 'builder', role: 'executor', state: 'in', machine: 'DESKTOP', 'lead-id': 'root:overseer',
  }));
  await writeFile(path.join(root, 'user', 'state', 'overseer.md'), stateFile({
    unit: 'overseer', 'unit-id': 'root:overseer', role: 'overseer', state: 'in', machine: 'DESKTOP',
  }));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'tasks', '002.md'), stateFile({
    id: '002', title: 'Scoped', status: 'open', 'from-id': 'root:master', 'to-id': 'project:shop:builder', date: '2026-10-10',
  }, '## Request\nDo the work.\n## Report\nStarted.\n'));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'inbox', 'builder', 'note.md'), stateFile({
    'from-id': 'root:master', 'to-id': 'project:shop:builder', 'thread-id': 'thread-1', timestamp: '2026-10-10T12:00:00.000Z',
    attachments: '["docs/note.txt"]',
  }));
  const messageId = path.basename('note.md', '.md');
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'older.json'), JSON.stringify({
    kind: 'registration', sessionId, unitId: 'project:shop:builder', client: 'codex', machine: 'DESKTOP',
    nativeSessionId: 'native-1', registeredAt: '2026-10-10T11:00:00.000Z', activity: 'idle', activityObservedAt: '2026-10-10T11:50:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'newer.json'), JSON.stringify({
    kind: 'registration', sessionId, unitId: 'project:shop:builder', client: 'codex', machine: 'DESKTOP',
    nativeSessionId: 'native-1', registeredAt: '2026-10-10T11:30:00.000Z', activity: 'busy', activityObservedAt: '2026-10-10T11:50:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'blank.json'), '{}\n');
  await writeFile(path.join(root, 'user', 'relay', 'session-status', sessionId, 'stop.json'), JSON.stringify({
    format: 'hivem1nd-session-status-v1', sessionId, state: 'stopped', machine: 'DESKTOP', at: '2026-10-10T11:40:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'room', 'chat.md'), stateFile({
    id: 'room', title: 'Room', kind: 'group', members: '["root:master","project:shop:builder"]', created: '2026-10-10T10:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'room', 'read', 'master', 'receipt.json'), JSON.stringify({ messageId: 'note' }));
  const view = await readProjection({ paths: fixture.paths, now: () => NOW });
  const builder = view.units.find((unit) => unit.id === 'project:shop:builder');
  assert.ok(builder);
  assert.deepEqual(builder.sessionIds, []);
  assert.equal(view.mind.machine, 'DESKTOP');
  assert.equal(view.units.find((unit) => unit.id === 'project:shop:builder').path, undefined);
  const squad = view.squads.find((item) => item.id === 'lead:root:overseer');
  assert.equal(squad.members.includes('project:shop:builder'), true);
  assert.notEqual(builder.status, 'unknown');
  assert.equal(squad.rollup[builder.status] >= 1, true);
  assert.equal(view.projects[0].id, 'shop');
  assert.equal(view.projects[0].title, 'Shop');
  assert.equal(view.projects[0].available, false);
  assert.equal(view.projects[0].product, null);
  assert.deepEqual(view.projects[0].unitIds, ['project:shop:builder']);
  assert.equal(view.counts.projects, 1);
  const task = view.tasks.find((item) => item.id === 'project:shop:002');
  assert.equal(task.request, 'Do the work.');
  assert.equal(task.report, 'Started.');
  const note = view.messages.find((item) => item.path.endsWith('note.md'));
  assert.equal(note.id, messageId);
  assert.equal(note.threadId, 'thread-1');
  assert.deepEqual(note.attachments, ['docs/note.txt']);
  assert.equal(note.read, true);
  assert.equal(view.sessions.length, 1);
  assert.equal(view.sessions[0].id, sessionId);
  assert.equal(view.sessions[0].state, 'stopped');
  assert.equal(view.sessions.some((session) => session.id === undefined), false);
  const chat = view.chats.find((item) => item.id === 'room');
  assert.deepEqual(chat.members, ['root:master', 'project:shop:builder']);
  assert.equal(chat.createdAt, '2026-10-10T10:00:00.000Z');
  assert.equal(view.issues.some((issue) => issue.path.endsWith('blank.json')), true);
});

test('chat and mailbox reads stay with their reader, archive, and revisions', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  const context = { paths: fixture.paths, now: () => NOW, principal: { unitId: 'root:master', audience: 'desktop' } };
  const encoded = Buffer.from('root:master').toString('base64url');
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'direct'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'group'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'direct', 'read', Buffer.from('project:shop:builder').toString('base64url'), 'DESKTOP'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'archive', 'by-unit', encoded), { recursive: true });
  await mkdir(path.join(root, 'user', 'inbox', 'builder'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'approvals', 'approve-1'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'sessions'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'session-status', '20c58b80-4d93-88cd-83b3-39d78f1d9d5d'), { recursive: true });
  await mkdir(path.join(root, 'user', 'gui'), { recursive: true });
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'state'), { recursive: true });
  await writeFile(path.join(root, 'user', 'state', 'overseer.md'), stateFile({
    unit: 'overseer', 'unit-id': 'root:overseer', role: 'overseer', state: 'in', machine: 'DESKTOP', date: '2026-10-10',
  }, 'Waiting on user: which name; which date\nWaiting on the master: ship it\n'));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'state', 'builder.md'), stateFile({
    unit: 'builder', role: 'executor', state: 'in', machine: 'DESKTOP',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'direct', 'chat.md'), stateFile({
    id: 'direct', title: 'Direct', kind: 'direct', members: '["root:master","project:shop:builder"]', created: '2026-10-10T10:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'direct', 'm1.md'), stateFile({
    id: 'm1', 'from-id': 'user', timestamp: '2026-10-10T11:00:00.000Z', kind: 'chat-notice', 'notice-key': 'direct:m1', 'resource-id': 'board-1',
  }, 'Earlier\n'));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'direct', 'm2.md'), stateFile({
    id: 'm2', 'from-id': 'project:shop:builder', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Later\n'));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'group', 'chat.md'), stateFile({
    id: 'group', title: 'Group', kind: 'group', members: '["root:master","project:shop:builder"]', created: '2026-10-10T10:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'group', 'g1.md'), stateFile({
    id: 'g1', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Group only\n'));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'direct', 'read', Buffer.from('project:shop:builder').toString('base64url'), 'DESKTOP', 'receipt.json'), JSON.stringify({
    unitId: 'project:shop:builder', messageIds: ['m1', 'm2'],
  }));
  await writeFile(path.join(root, 'user', 'inbox', 'master', 'hello.md'), stateFile({
    id: 'hello', from: 'master', 'to-id': 'root:master', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Hello\n'));
  await writeFile(path.join(root, 'user', 'inbox', 'builder', 'secret.md'), stateFile({
    id: 'secret', 'to-id': 'project:shop:builder', 'reply-requested': 'true', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Other only\n'));
  await writeFile(path.join(root, 'user', 'relay', 'archive', 'by-unit', encoded, 'old.md'), stateFile({
    id: 'old', 'to-id': 'root:master', timestamp: '2026-10-09T12:00:00.000Z', read: 'true',
  }, 'Archived\n'));
  await writeFile(path.join(root, 'user', 'relay', 'approvals', 'approve-1', 'request.json'), JSON.stringify({
    id: 'approve-1', unitId: 'root:master', display: 'Publish', requestedAt: '2026-10-10T12:00:00.000Z', action: 'process.run',
    pattern: { command: 'npm run build', cwd: 'project:shop' },
  }));
  await writeFile(path.join(root, 'user', 'gui', 'resources.json'), JSON.stringify({
    format: 'hivem1nd-resources-v1',
    resources: [{ id: 'board-1', kind: 'blueprint', project: 'shop', path: 'boards/one.md', title: 'One' }],
  }));
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'older.json'), JSON.stringify({
    kind: 'registration', sessionId: '20c58b80-4d93-88cd-83b3-39d78f1d9d5d', unitId: 'root:overseer', client: 'cursor', machine: 'DESKTOP', registeredAt: '2026-10-10T10:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'newer.json'), JSON.stringify({
    kind: 'registration', sessionId: '20c58b80-4d93-88cd-83b3-39d78f1d9d5d', unitId: 'root:overseer', client: 'cursor', machine: 'DESKTOP', registeredAt: '2026-10-10T11:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'sessions', 'live.json'), JSON.stringify({
    kind: 'registration', sessionId: '30c58b80-4d93-88cd-83b3-39d78f1d9d5d', unitId: 'root:overseer', client: 'codex', machine: 'DESKTOP', registeredAt: '2026-10-10T09:00:00.000Z',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'session-status', '20c58b80-4d93-88cd-83b3-39d78f1d9d5d', 'stop.json'), JSON.stringify({
    format: 'hivem1nd-session-status-v1', sessionId: '20c58b80-4d93-88cd-83b3-39d78f1d9d5d', state: 'stopped', at: '2026-10-10T11:30:00.000Z',
  }));

  const direct = await readCollection(context, 'messages', { chatId: 'direct' });
  assert.deepEqual(direct.items.map((item) => item.id), ['m1', 'm2']);
  assert.equal(direct.items[0].fromId, 'root:master');
  assert.deepEqual(direct.items[0].notice, { key: 'direct:m1', resourceId: 'board-1' });
  const latest = await readCollection(context, 'messages', { chatId: 'direct', limit: 1 });
  assert.deepEqual(latest.items.map((item) => item.id), ['m2']);
  const older = await readCollection(context, 'messages', { chatId: 'direct', before: 'm2' });
  assert.deepEqual(older.items.map((item) => item.id), ['m1']);
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'direct', 'm2.md'), stateFile({
    id: 'm2', 'from-id': 'project:shop:builder', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Changed\n'));
  await assert.rejects(
    () => readCollection(context, 'messages', { chatId: 'direct', limit: 1, cursor: latest.nextCursor }),
    (error) => error.code === 'cursor_expired',
  );

  const unread = await readCollection(context, 'messages', { mailboxId: 'root:master' });
  assert.deepEqual(unread.items.map((item) => item.id), ['hello']);
  const read = await readCollection(context, 'messages', { mailboxId: 'root:master', state: 'read' });
  assert.deepEqual(read.items.map((item) => item.id), ['old']);
  const archived = await readDetail(context, 'messages', 'old', { mailboxId: 'root:master' });
  assert.equal(archived.archived, true);
  assert.equal(archived.body.trim(), 'Archived');
  const boxes = await readCollection(context, 'mailboxes');
  const masterBox = boxes.items.find((item) => item.unitId === 'root:master');
  assert.equal(masterBox.unread, 1);
  assert.equal(masterBox.total, 2);
  assert.equal(boxes.items.some((item) => item.unitId === 'project:shop:builder'), true);

  const view = await readProjection(context);
  // The builder's receipt does not read m2 for the person, and the person's own m1 is never unread.
  assert.equal(view.chats.find((chat) => chat.id === 'direct').unread, 1);
  assert.equal(view.waiting.some((item) => item.id === 'approval:approve-1'), true);
  assert.equal(view.waiting.find((item) => item.id === 'approval:approve-1').desktopOnly, false);
  assert.equal(view.waiting.some((item) => item.id === `question:root:overseer:${hashText('which name')}`), true);
  assert.equal(view.waiting.some((item) => item.kind === 'message' && item.messageId === 'secret'), false);
  assert.equal(view.sessions.filter((session) => session.id === '20c58b80-4d93-88cd-83b3-39d78f1d9d5d').length, 1);
  assert.equal(view.sessions.find((session) => session.id === '20c58b80-4d93-88cd-83b3-39d78f1d9d5d').state, 'stopped');
  assert.equal(view.sessions[0].registeredAt >= view.sessions[1].registeredAt, true);
  assert.equal(view.editors[0].title, 'One');
  assert.equal(view.editors[0].readOnly, false);
  assert.equal(view.editors[0].openThreads, 0);
  assert.equal(view.editors[0].activity, null);
  assert.equal(view.editors[0].revision, null);
  const again = await readProjection(context);
  assert.equal(again.chats.find((chat) => chat.id === 'direct').unread, view.chats.find((chat) => chat.id === 'direct').unread);
});

test('person aliases, waiting ids, lead approval and task requirements stay canonical', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'state'), { recursive: true });
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'user', 'projects', 'shop', 'inbox', 'builder'), { recursive: true });
  await writeFile(path.join(root, 'user', 'state', 'overseer.md'), stateFile({
    unit: 'overseer', 'unit-id': 'root:overseer', role: 'overseer', state: 'in', machine: 'DESKTOP', date: '2026-10-10',
  }, 'Waiting on Tom: the registry name\n'));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'state', 'builder.md'), stateFile({
    unit: 'builder', role: 'executor', state: 'in', machine: 'DESKTOP', 'lead-id': 'root:overseer',
  }));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'tasks', '003.md'), stateFile({
    id: '003', title: 'Alias', status: 'review', from: 'user@DESKTOP', to: 'builder', date: '2026-10-10',
    requirements: 'APP-A-01, APP-B-04',
  }, '## Request\nShip it.\n## Report\nApproved for review by overseer on 2026-10-10\n'));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'inbox', 'builder', 'note.md'), stateFile({
    id: 'note', 'from-id': 'person:Tom', to: 'nobody', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Hello\n'));
  await writeFile(path.join(root, 'user', 'projects', 'shop', 'inbox', 'builder', 'other.md'), stateFile({
    id: 'other', 'from-id': 'person:Nobody', to: 'nobody', timestamp: '2026-10-10T12:01:00.000Z',
  }, 'Unknown\n'));
  await mkdir(path.join(root, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(root, 'user', 'machines', 'DESKTOP.md'), 'machine: DESKTOP\nperson: Tom\n\n');
  const view = await readProjection({ paths: fixture.paths, now: () => NOW, principal: { unitId: 'root:master', audience: 'desktop' } });
  const task = view.tasks.find((item) => item.id === 'project:shop:003');
  assert.equal(task.fromId, 'root:master');
  assert.equal(task.toId, 'project:shop:builder');
  assert.deepEqual(task.requirements, ['APP-A-01', 'APP-B-04']);
  assert.equal(task.approvedBy, 'root:overseer');
  assert.equal(task.reviewable, true);
  const note = view.messages.find((item) => item.id === 'note');
  assert.equal(note.fromId, 'root:master');
  assert.equal(note.toId, null);
  assert.equal(view.messages.find((item) => item.id === 'other').fromId, null);
  const question = view.waiting.find((item) => item.kind === 'question');
  assert.equal(question.id, `question:root:overseer:${hashText('the registry name')}`);
  assert.equal(question.title, 'the registry name');
});

test('chat destinations stay on the message and the last message', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  const chatId = '0efb1be7-b006-476d-b0f6-4629d217ab82';
  const dir = path.join(root, 'user', 'relay', 'chats', chatId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'chat.md'), stateFile({
    id: chatId, kind: 'direct', members: '["root:master"]', listed: 'true',
  }));
  await writeFile(path.join(dir, 'legacy.md'), stateFile({
    id: 'legacy', to: 'chat', kind: 'message', 'from-id': 'root:master', timestamp: '2026-10-10T12:00:00.000Z',
  }, 'Old\n'));
  await writeFile(path.join(dir, 'paired.md'), stateFile({
    id: 'paired', to: 'chat', 'to-id': `chat:${chatId}`, kind: 'message', 'from-id': 'root:master', timestamp: '2026-10-10T12:01:00.000Z',
  }, 'Paired\n'));
  await writeFile(path.join(dir, 'canonical.md'), stateFile({
    id: 'canonical', to: `chat:${chatId}`, kind: 'message', 'from-id': 'root:master', timestamp: '2026-10-10T12:02:00.000Z',
  }, 'New\n'));
  await writeFile(path.join(dir, 'foreign.md'), stateFile({
    id: 'foreign', to: 'chat:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'message', timestamp: '2026-10-10T11:00:00.000Z',
  }, 'Wrong\n'));
  const view = await readProjection({ paths: fixture.paths, now: () => NOW, principal: { unitId: 'root:master', audience: 'desktop' } });
  assert.equal(view.messages.find((item) => item.id === 'legacy').toId, `chat:${chatId}`);
  assert.equal(view.messages.find((item) => item.id === 'paired').toId, `chat:${chatId}`);
  assert.equal(view.messages.find((item) => item.id === 'canonical').toId, `chat:${chatId}`);
  assert.equal(view.messages.find((item) => item.id === 'foreign').toId, null);
  assert.equal(view.chats.find((item) => item.id === chatId).lastMessage.toId, `chat:${chatId}`);
  const again = await readDetail({ paths: fixture.paths, now: () => NOW, principal: { unitId: 'root:master', audience: 'desktop' } }, 'messages', 'canonical', { chatId });
  assert.equal(again.toId, `chat:${chatId}`);
});

test('pending sync work stays pending and a failure stays visible', async (t) => {
  const fixture = await mind(t);
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => NOW, projects: [] });
  const ledger = openLedger({ store: fixture.store, paths: fixture.paths, now: () => NOW, machine: fixture.paths.machine });
  const context = { store: fixture.store, paths: fixture.paths, now: () => NOW, sync, ledger };
  await stageTransaction(sync, [{ target: { kind: 'mind', path: 'user/note.txt' }, bytes: Buffer.from('local') }]);
  await writeFile(ledger.file, `${JSON.stringify({
    format: 'hivem1nd-sync-ledger-v1',
    admitted: [],
    outgoing: [],
    incoming: { LAPTOP: [{ id: 'pack-1', at: '2026-10-10T12:00:00.000Z', messages: 1, bytes: 20 }] },
    applied: {},
    notices: [],
  })}\n`);
  const pending = await readSync(context);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.pendingChanges > 0, true);
  assert.equal(pending.error, null);
  assert.equal(pending.incoming[0].machine, 'LAPTOP');
  assert.equal(pending.incoming[0].limits.messages.used, 1);
  assert.equal((await serviceRecord(context)).syncState, 'pending');
  await recordSyncFailure(sync, { code: 'sync_rate_limited', retryAt: '2026-10-10T12:05:00.000Z' });
  const failed = await readSync({ ...context, syncOutcome: 'idle' });
  assert.equal(failed.state, 'error');
  assert.equal(failed.error.code, 'sync_rate_limited');
  assert.equal(failed.error.message, 'Sync failed.');
  assert.equal(failed.retryAt, '2026-10-10T12:05:00.000Z');
  assert.equal((await serviceRecord({ ...context, syncOutcome: 'idle' })).syncState, 'error');
});

test('an inbound receipt failure stays after publication succeeds', async (t) => {
  const fixture = await mind(t);
  const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => NOW, projects: [] });
  const context = { store: fixture.store, paths: fixture.paths, now: () => NOW, sync };
  await recordInboundFailure(sync, { code: 'invalid_record_owner', message: 'The record is not owned by the publishing machine.' });
  const failed = await readSync(context);
  assert.equal(failed.state, 'error');
  assert.equal(failed.error.code, 'invalid_record_owner');
  assert.equal(failed.error.message, 'The record is not owned by the publishing machine.');
  assert.equal(failed.retryAt, null);
  assert.equal(failed.pendingChanges, 0);
  assert.deepEqual(failed.incoming, []);
  assert.equal((await serviceRecord(context)).syncState, 'error');
  await recordSyncFailure(sync, { code: 'sync_rate_limited', retryAt: '2026-10-10T12:05:00.000Z' });
  await clearSyncFailure(sync);
  const kept = await readSync(context);
  assert.equal(kept.state, 'error');
  assert.equal(kept.error.code, 'invalid_record_owner');
  await clearInboundFailure(sync);
  const cleared = await readSync(context);
  assert.equal(cleared.state, 'idle');
  assert.equal(cleared.error, null);
});

test('collection filters accept typed queries and hide closed tasks by default', async (t) => {
  const fixture = await mind(t);
  const root = fixture.paths.mind;
  const context = { paths: fixture.paths, now: () => NOW };
  await mkdir(path.join(root, 'user', 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'open-chat'), { recursive: true });
  await mkdir(path.join(root, 'user', 'relay', 'chats', 'hidden-chat'), { recursive: true });
  await writeFile(path.join(root, 'user', 'tasks', '010.md'), stateFile({
    id: 'root:010', title: 'Open work', status: 'open', 'to-id': 'root:master',
  }));
  await writeFile(path.join(root, 'user', 'tasks', '011.md'), stateFile({
    id: 'root:011', title: 'Filed', status: 'closed', 'to-id': 'root:master',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'open-chat', 'chat.md'), stateFile({
    id: 'open-chat', title: 'Open', kind: 'direct', members: '["root:master"]', listed: 'true', pinned: 'false',
  }));
  await writeFile(path.join(root, 'user', 'relay', 'chats', 'hidden-chat', 'chat.md'), stateFile({
    id: 'hidden-chat', title: 'Hidden', kind: 'direct', members: '["root:master"]', listed: 'false', pinned: 'true',
  }));
  const tasks = await readCollection(context, 'tasks');
  assert.deepEqual(tasks.items.map((item) => item.id), ['root:010']);
  const closed = await readCollection(context, 'tasks', { status: 'open,closed' });
  assert.deepEqual(closed.items.map((item) => item.id).sort(), ['root:010', 'root:011']);
  const hidden = await readCollection(context, 'chats', { listed: 'false' });
  assert.deepEqual(hidden.items.map((item) => item.id), ['hidden-chat']);
  const pinned = await readCollection(context, 'chats', { listed: 'false', pinned: 'true' });
  assert.deepEqual(pinned.items.map((item) => item.id), ['hidden-chat']);
  await assert.rejects(() => readCollection(context, 'tasks', { q: 'x'.repeat(201) }), { code: 'invalid_query' });
});

test('machine clients are the probed availability records without executable paths', async (t) => {
  const fixture = await mind(t);
  const bin = path.join(fixture.root, 'bin');
  await mkdir(bin);
  const executable = path.join(bin, 'codex.exe');
  await writeFile(executable, '');
  const reports = await probeClients({ env: { PATH: bin, PATHEXT: '.EXE' }, platform: 'win32' });
  const clients = clientRecords(reports).map((item) => (
    item.id === 'codex' ? { ...item, command: executable, version: 'secret-version' } : item
  ));
  await writeBeat({ store: fixture.store, paths: fixture.paths, now: () => NOW, clients }, 'running');
  const raw = await readFile(path.join(fixture.paths.origin, 'machines', 'DESKTOP', 'service.json'), 'utf8');
  assert.equal(raw.includes(executable), false);
  assert.equal(raw.includes('secret-version'), false);
  const view = await readProjection({ paths: fixture.paths, now: () => NOW });
  const machine = view.machines.find((item) => item.id === 'DESKTOP');
  assert.deepEqual(machine.clients, [
    { id: 'claude', enabled: false, installed: false },
    { id: 'codex', enabled: true, installed: true },
    { id: 'cursor', enabled: false, installed: false },
    { id: 'lyra', enabled: false, installed: false },
  ]);
  assert.equal(JSON.stringify(machine).includes(executable), false);
});

test('an alias changes display and search without changing identity or lead', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  const relative = path.join(fixture.paths.mind, 'user', 'state', 'executor-blog.md');
  const original = Buffer.from('unit: executor-blog\nunit-id: root:executor-blog\nrole: executor\nstate: out\nmachine: DESKTOP\nlead-id: root:overseer\n\nalias: body content stays.\n');
  await writeFile(relative, original);
  const changed = await setUnitAlias(context, 'root:executor-blog', { alias: ' Blog ', expectedRevision: revisionOf(original) });
  assert.equal(changed.unit.id, 'root:executor-blog');
  assert.equal(changed.unit.unit, 'executor-blog');
  assert.equal(changed.unit.alias, 'Blog');
  assert.equal(changed.unit.leadId, 'root:overseer');
  const found = await readCollection(context, 'units', { q: 'Blog' });
  assert.equal(found.items.some((unit) => unit.id === 'root:executor-blog'), true);
  const beforeClear = await readFile(relative);
  const cleared = await setUnitAlias(context, 'root:executor-blog', { alias: null, expectedRevision: revisionOf(beforeClear) });
  assert.equal(cleared.unit.alias, null);
  assert.ok((await readFile(relative, 'utf8')).endsWith('\nalias: body content stays.\n'));
  await assert.rejects(setUnitAlias(context, 'root:executor-blog', { alias: 'Unsafe\nline', expectedRevision: cleared.unit.revision }), { code: 'invalid_alias' });
  await assert.rejects(setUnitAlias(context, 'root:executor-blog', { alias: 'Other', expectedRevision: revisionOf(original) }), { code: 'revision_conflict' });
});

test('expired asks stay readable and do not count as active Waiting', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  const id = '11111111-1111-4111-8111-111111111111';
  const directory = path.join(fixture.paths.mind, 'user', 'relay', 'approvals', id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'request.json'), JSON.stringify({ id, unitId: 'root:executor-shop', display: 'Push to the remote', requestedAt: '2026-10-09T12:00:00.000Z', expiresAt: '2026-10-09T12:02:00.000Z', chatId: null }));
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ state: 'expired' }));
  const view = await readProjection(context);
  const expired = view.waiting.find((item) => item.approvalId === id);
  assert.ok(expired);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.blocking, false);
  assert.equal(view.counts.waiting, 0);
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ state: 'denied' }));
  assert.equal((await readProjection(context)).waiting.some((item) => item.approvalId === id), false);
});

test('Send to agent persists separately from theme and language', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  await patchSettings(context, { sendToAgent: false, expectedRevision: null });
  const file = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
  const before = await readFile(file);
  assert.equal(JSON.parse(before).sendToAgent, false);
  await patchSettings(context, { language: 'es', expectedRevision: revisionOf(before) });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.sendToAgent, false);
  assert.equal(saved.language, 'es');
  await assert.rejects(patchSettings(context, { sendToAgent: 'false', expectedRevision: revisionOf(await readFile(file)) }), { code: 'invalid_body' });
});

test('all six looks persist while existing high-contrast remains compatible', async (t) => {
  const fixture = await mind(t);
  const context = serviceContext(fixture);
  let revision = null;
  for (const look of ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']) {
    await patchSettings(context, { look, expectedRevision: revision });
    const file = path.join(fixture.paths.mind, 'user', 'gui', 'settings.json');
    const bytes = await readFile(file);
    assert.equal(JSON.parse(bytes).look, look);
    revision = revisionOf(bytes);
  }
});

test('a locally registered zero-unit project appears with provenance without creating a lead or an agent', async t => {
  const fixture = await mind(t), context = { ...serviceContext(fixture), projects: [{ name: 'empty', localPath: fixture.root }] };
  let view = await readProjection(context);
  assert.deepEqual(view.projects[0].unitIds, []); assert.equal(view.projects[0].available, true);
  const directory = path.join(fixture.paths.mind, 'user', 'projects', 'empty'); await mkdir(directory, { recursive: true });
  const provenance = { format: 'hivem1nd-product-v1', title: 'Empty repository', additionId: randomUUID(), origin: 'acme/empty', pin: { kind: 'commit', value: 'a'.repeat(40), digest: 'b'.repeat(64) } };
  await writeFile(path.join(directory, 'product.json'), JSON.stringify(provenance));
  view = await readProjection(context);
  assert.equal(view.projects[0].additionId, provenance.additionId); assert.deepEqual(view.projects[0].pin, provenance.pin);
  assert.deepEqual(view.units, []); assert.deepEqual(view.leads, []); assert.equal(view.counts.projects, 1);
  assert.equal((await readCollection(context, 'projects')).items[0].origin, provenance.origin);
  await writeFile(path.join(directory, 'product.json'), JSON.stringify({ ...provenance, removed: true }));
  assert.deepEqual((await readProjection(context)).projects, []);
});
