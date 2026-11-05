import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claimDirectory } from '../engine/sync/ownership.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const childSource = `
import { claimDirectory } from './engine/sync/ownership.mjs';
let release;
process.send({ type: 'waiting' });
process.on('message', async ({ type }) => {
  if (type === 'acquire') {
    try { release = await claimDirectory(process.argv[1]); process.send({ type: 'acquired' }); }
    catch (error) { process.send({ type: 'rejected', code: error.code }); }
  }
  if (type === 'close') { if (release) await release(); process.disconnect(); }
});
`;

async function setup(t) {
  const base = path.join(checkout, '.work', 'sync-ownership-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'case-'));
  const children = [];
  const releases = [];
  const claim = async () => {
    const release = await claimDirectory(directory);
    releases.push(release);
    return release;
  };
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  t.after(async () => {
    await Promise.all(children.map(stop));
    await Promise.all(releases.map((release) => release()));
    await rm(directory, { recursive: true, force: true });
  });
  async function contender() {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, directory], {
      cwd: checkout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, TEMP: directory, TMP: directory,
        RELAY_LOCAL_STATE_DIR: directory, GIT_CEILING_DIRECTORIES: checkout },
    });
    children.push(child);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    assert.equal((await once(child, 'message'))[0].type, 'waiting', stderr);
    return child;
  }
  async function command(child, type) {
    const response = once(child, 'message');
    child.send({ type });
    return (await response)[0];
  }
  async function record(value) {
    const token = randomUUID();
    await mkdir(path.join(directory, 'owners'), { recursive: true });
    const file = path.join(directory, 'owners', `${token}.json`);
    await writeFile(file, JSON.stringify({ token, choosing: false, ticket: 1, ...value }));
    return file;
  }
  return { directory, claim, contender, command, stop, record };
}

test('PID-only claims are stale even when their PID belongs to the current or another live process', { timeout: 10000 }, async (t) => {
  const fixture = await setup(t);
  const unrelated = await fixture.contender();
  await fixture.record({ pid: process.pid });
  await fixture.record({ pid: unrelated.pid });
  const release = await fixture.claim();
  await assert.rejects(claimDirectory(fixture.directory), { code: 'store_in_use' });
  await release();
  await fixture.claim();
});

test('records without the current endpoint shape are stale and remain untouched', { timeout: 10000 }, async (t) => {
  const fixture = await setup(t);
  const records = [];
  for (const value of [{}, { port: 0 }, { port: 65536 }, { port: '1' }, { port: 1, token: 'old' },
    { port: 1, choosing: null }, { port: 1, ticket: -1 }]) {
    const file = await fixture.record(value);
    records.push([file, await readFile(file, 'utf8')]);
  }
  const release = await fixture.claim();
  await assert.rejects(claimDirectory(fixture.directory), { code: 'store_in_use' });
  for (const [file, contents] of records) assert.equal(await readFile(file, 'utf8'), contents);
  await release();
  await fixture.claim();
});

test('a live cross-process owner excludes a second claimant until release', { timeout: 10000 }, async (t) => {
  const fixture = await setup(t);
  const owner = await fixture.contender();
  assert.equal((await fixture.command(owner, 'acquire')).type, 'acquired');
  await assert.rejects(claimDirectory(fixture.directory), { code: 'store_in_use' });
  const exited = once(owner, 'exit');
  owner.send({ type: 'close' });
  await exited;
  await fixture.claim();
});

test('concurrent creators choose exactly one owner and a crashed winner is immediately recoverable', { timeout: 15000 }, async (t) => {
  const fixture = await setup(t);
  for (let round = 0; round < 4; round += 1) {
    const contenders = await Promise.all(Array.from({ length: 4 }, () => fixture.contender()));
    const results = await Promise.all(contenders.map((child) => fixture.command(child, 'acquire')));
    assert.equal(results.filter((result) => result.type === 'acquired').length, 1);
    assert.equal(results.filter((result) => result.type === 'rejected' && result.code === 'store_in_use').length, 3);
    const owner = contenders[results.findIndex((result) => result.type === 'acquired')];
    await fixture.stop(owner);
    const release = await fixture.claim();
    await assert.rejects(claimDirectory(fixture.directory), { code: 'store_in_use' });
    await release();
    await Promise.all(contenders.map(fixture.stop));
  }
});

test('endpoint reuse with a different token proves a retained claim stale', { timeout: 10000 }, async (t) => {
  const fixture = await setup(t);
  const foreignToken = randomUUID();
  const server = createServer((socket) => socket.end(`${foreignToken}\n`, () => socket.destroy()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = randomUUID();
  await mkdir(path.join(fixture.directory, 'owners'), { recursive: true });
  await writeFile(path.join(fixture.directory, 'owners', `${token}.json`), JSON.stringify({
    token, port: server.address().port, choosing: false, ticket: 1,
  }));
  await fixture.claim();
});

test('a silent live endpoint fails closed after a bounded probe', { timeout: 10000 }, async (t) => {
  const fixture = await setup(t);
  const sockets = new Set();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  const token = randomUUID();
  await mkdir(path.join(fixture.directory, 'owners'), { recursive: true });
  const file = path.join(fixture.directory, 'owners', `${token}.json`);
  const record = { token, port: server.address().port, choosing: false, ticket: 1 };
  await writeFile(file, JSON.stringify(record));
  const started = performance.now();
  await assert.rejects(claimDirectory(fixture.directory), { code: 'store_in_use' });
  assert.ok(performance.now() - started < 5000);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), record);
  assert.deepEqual(await readdir(path.dirname(file)), [`${token}.json`]);
});
