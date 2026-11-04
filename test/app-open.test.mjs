import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { callAppBridge, openInApp } from '../engine/service/app-bridge.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { toolSchemas } from '../engine/service/mcp.mjs';
import { makeCoreFixture, dispose } from './core-fixture.mjs';

async function setup(t, { running = true } = {}) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const project = path.join(fixture.root, 'shop'), elsewhere = path.join(fixture.root, 'elsewhere');
  await mkdir(path.join(project, 'docs/flows/boards'), { recursive: true });
  await mkdir(elsewhere);
  await writeFile(path.join(project, 'docs/flows/boards/home.json'), '{}');
  await writeFile(path.join(project, 'docs/flows/boards/index.json'), '{}');
  await writeFile(path.join(project, 'docs/guide.json'), '{}');
  await writeFile(path.join(project, 'docs/guide.comments.json'), '{}');
  await writeFile(path.join(project, 'notes.md'), 'Notes');
  await writeFile(path.join(elsewhere, 'secret.md'), 'No');
  const events = [];
  const bus = { emit: event => events.push(event), listening: audience => running && audience === 'desktop' };
  const context = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, bus,
    projects: [{ name: 'shop', localPath: project }, { name: 'other', localPath: elsewhere }],
    principal: { audience: 'agent', unitId: 'shop:executor' } };
  return { context, project, elsewhere, events };
}

test('a bus reports a desktop stream only while one is open', () => {
  const bus = createEventBus();
  assert.equal(bus.listening('desktop'), false);
  const subscriber = bus.subscribe({ stableId: 'desktop-1', audience: 'desktop' });
  assert.equal(bus.listening('desktop'), true);
  assert.equal(bus.listening('phone'), false);
  bus.release(subscriber);
  assert.equal(bus.listening('desktop'), false);
});

test('app_open has a strict schema: app is required and limited to the two apps', () => {
  const tool = toolSchemas().find(item => item.name === 'app_open');
  assert.deepEqual(tool.inputSchema.required, ['app']);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['app', 'path', 'project', 'resourceId']);
  assert.deepEqual(tool.inputSchema.properties.app.enum, ['blueprint', 'void']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('a board opens with the location id and board id, and nothing is sent without a desktop app', async t => {
  const { context, events } = await setup(t);
  assert.deepEqual(await openInApp(context, { app: 'blueprint', path: 'docs/flows/boards/home.json', project: 'shop' }), { opened: true, app: 'blueprint', project: 'shop', path: 'docs/flows/boards/home.json' });
  assert.deepEqual(events, [{ name: 'app.bridge', data: { app: 'blueprint', name: 'app.open', params: { location: 'shop', id: 'home' } } }]);
});

test('without a running desktop app the result is not_running and nothing is written or emitted', async t => {
  const { context, events, project } = await setup(t, { running: false });
  assert.deepEqual(await openInApp(context, { app: 'blueprint', path: 'docs/flows/boards/home.json', project: 'shop' }), { opened: false, status: 'not_running' });
  assert.deepEqual(await openInApp(context, { app: 'void', path: 'docs/guide.json', project: 'shop' }), { opened: false, status: 'not_running' });
  assert.deepEqual(events, []);
  const desktop = { ...context, principal: { audience: 'desktop', unitId: 'root:master' } };
  assert.deepEqual((await callAppBridge(desktop, { app: 'void', method: 'void.storage.load', params: { location: project, key: 'position:shop' }, clientId: 'check' })).value, null);
});

test('a text stores its position and sends the project, by relative or absolute path', async t => {
  const { context, events, project } = await setup(t);
  assert.equal((await openInApp(context, { app: 'void', path: path.join(project, 'docs/guide.json') })).path, 'docs/guide.json');
  assert.deepEqual(events.at(-1).data, { app: 'void', name: 'app.open', params: { project: { id: 'shop', name: 'shop', path: project }, path: 'docs/guide.json' } });
  const desktop = { ...context, principal: { audience: 'desktop', unitId: 'root:master' } };
  const stored = await callAppBridge(desktop, { app: 'void', method: 'void.storage.load', params: { location: 'shop', key: 'position:shop' }, clientId: 'check' });
  assert.deepEqual(stored.value, { path: 'docs/guide.json', scroll: 0, section: 0 });
  await openInApp(context, { app: 'void', path: 'notes.md', project: 'shop' });
  const again = await callAppBridge(desktop, { app: 'void', method: 'void.storage.load', params: { location: 'shop', key: 'position:shop' }, clientId: 'check' });
  assert.equal(again.value.path, 'notes.md');
});

test('app_open refuses paths outside an attached project, hidden or reserved names and unrelated files', async t => {
  const { context, events, elsewhere, project } = await setup(t);
  for (const input of [
    { app: 'void', path: path.join(elsewhere, 'secret.md'), project: 'shop' },
    { app: 'void', path: '../elsewhere/secret.md', project: 'shop' },
    { app: 'void', path: path.join(path.dirname(project), 'nowhere.md') },
    { app: 'void', path: 'docs/.hidden.json', project: 'shop' },
    { app: 'void', path: ['docs', 'guide.json'].join(String.fromCharCode(92)), project: 'shop' },
    { app: 'void', path: 'docs/../notes.md', project: 'shop' },
    { app: 'void', path: 'notes.md', project: 'missing' },
  ]) await assert.rejects(openInApp(context, input), { code: 'denied' }, JSON.stringify(input));
  for (const input of [
    { app: 'blueprint', path: 'docs/flows/boards/index.json', project: 'shop' },
    { app: 'blueprint', path: 'notes.md', project: 'shop' },
    { app: 'void', path: 'docs/guide.comments.json', project: 'shop' },
    { app: 'void', path: 'notes.exe', project: 'shop' },
    { app: 'void', path: 'notes.md' },
    { app: 'other', path: 'notes.md', project: 'shop' },
    { app: 'void' },
  ]) await assert.rejects(openInApp(context, input), { code: 'invalid' }, JSON.stringify(input));
  await assert.rejects(openInApp(context, { app: 'void', path: 'gone.md', project: 'shop' }), { code: 'not_found' });
  assert.deepEqual(events, []);
});
