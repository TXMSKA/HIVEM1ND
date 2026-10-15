import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ownChildProcess, ownedSpawnOptions, processDriver } from '../engine/service/process-handle.mjs';

const children = [];
test.after(() => { for (const child of children) { try { child.kill(); } catch { /* Already gone. */ } } });

// A client-like parent that starts one grandchild and keeps both alive until they are stopped.
const PARENT = "const { spawn } = require('node:child_process'); const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });"
  + " process.stdout.write(grandchild.pid + '\\n'); setInterval(() => {}, 1000);";

async function launchTree() {
  const child = spawn(process.execPath, ['-e', PARENT], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, ...ownedSpawnOptions() });
  children.push(child);
  child.stdout.setEncoding('utf8');
  const grandchild = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(Number(text.trim())); });
    child.once('error', reject); child.once('exit', () => reject(new Error('The parent exited before it reported its child.')));
  });
  return { child, grandchild };
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function settled(condition) { for (let count = 0; count < 200 && !condition(); count += 1) await new Promise(resolve => setTimeout(resolve, 25)); }

test('a real process tree is owned by pid plus creation time, stopped whole, and proved closed with the same identity', async () => {
  const { child, grandchild } = await launchTree();
  const handle = await ownChildProcess(child);
  assert.match(handle.identity, new RegExp(`^${child.pid}:.+`));
  assert.equal(await handle.verify(), true);
  assert.equal(alive(grandchild), true);
  assert.deepEqual(await handle.cleanup(), { closed: false, identity: handle.identity }, 'a running process is never closed');
  let exits = 0; const detach = handle.onExit(() => { exits += 1; });
  assert.equal(typeof detach, 'function');
  assert.deepEqual(await handle.stop(), { acknowledged: true });
  await settled(() => exits > 0);
  assert.equal(exits, 1);
  assert.equal(await handle.verify(), false, 'verify is false once the process has exited');
  const cleanup = await handle.cleanup();
  assert.deepEqual(cleanup, { closed: true, identity: handle.identity });
  assert.equal(alive(grandchild), false, 'the grandchild ended with its parent');
  assert.deepEqual(await handle.stop(), { acknowledged: true }, 'stopping an ended process is still acknowledged');
});

test('verify is false for a mismatched creation time and the exit comes from the process, not its pipes', async () => {
  const { child } = await launchTree();
  const real = processDriver();
  let lie = false;
  const handle = await ownChildProcess(child, { driver: { ...real, creation: async pid => lie ? '1999-01-01T00:00:00.0000000Z' : real.creation(pid) } });
  assert.equal(await handle.verify(), true);
  lie = true;
  assert.equal(await handle.verify(), false, 'another creation time is another process');
  lie = false;
  child.stdout.destroy();
  await once(child.stdout, 'close');
  let exited = false; handle.onExit(() => { exited = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(exited, false, 'a closed pipe is not an exit');
  assert.equal(await handle.verify(), true);
  assert.deepEqual(await handle.stop(), { acknowledged: true });
  await settled(() => exited);
  assert.equal(exited, true);
  assert.equal((await handle.cleanup()).closed, true);
});

test('a process that is already gone, or has no identity, cannot be adopted', async () => {
  await assert.rejects(ownChildProcess({ pid: undefined, once() {} }), { code: 'cleanup_unavailable' });
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await once(gone, 'exit');
  await assert.rejects(ownChildProcess(gone), { code: 'cleanup_unavailable' });
  const fake = Object.assign(new EventEmitter(), { pid: 99999999, exitCode: null });
  await assert.rejects(ownChildProcess(fake, { driver: { creation: async () => null } }), { code: 'cleanup_unavailable' });
});

test('cleanup stays open while a recorded descendant lives and a failed termination is never acknowledged', async () => {
  const fake = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null });
  const driver = { creation: async () => 'created', descendants: async () => [{ pid: 7, created: 'a' }], alive: async targets => targets, terminate: async () => {}, escalate: async () => {} };
  const handle = await ownChildProcess(fake, { driver, graceMs: 20, settleMs: 80 });
  assert.deepEqual(await handle.stop(), { acknowledged: false }, 'no exit event means no acknowledgement');
  fake.exitCode = 0; fake.emit('exit', 0);
  assert.deepEqual(await handle.cleanup(), { closed: false, identity: handle.identity }, 'a surviving descendant keeps the tree open');
  const refusing = Object.assign(new EventEmitter(), { pid: 4343, exitCode: null });
  const broken = await ownChildProcess(refusing, { driver: { ...driver, terminate: async () => { throw new Error('refused'); } }, graceMs: 20 });
  assert.deepEqual(await broken.stop(), { acknowledged: false });
  const unknown = Object.assign(new EventEmitter(), { pid: 4444, exitCode: null });
  const blind = await ownChildProcess(unknown, { driver: { ...driver, descendants: async () => { throw new Error('unreadable'); }, terminate: async () => { unknown.exitCode = 0; unknown.emit('exit', 0); } }, graceMs: 20, settleMs: 80 });
  assert.deepEqual(await blind.stop(), { acknowledged: true });
  assert.deepEqual(await blind.cleanup(), { closed: false, identity: blind.identity }, 'an unreadable tree is never reported closed');
});

test('stopStep reports only an acknowledged interruption', async () => {
  const fake = Object.assign(new EventEmitter(), { pid: 4545, exitCode: null });
  const driver = { creation: async () => 'created', descendants: async () => [], alive: async () => [], terminate: async () => {}, escalate: async () => {} };
  const calls = [];
  for (const [result, expected] of [[{ acknowledged: true }, true], [{ acknowledged: true, idle: true }, true], [{ acknowledged: false }, false], [undefined, false]]) {
    const handle = await ownChildProcess(fake, { driver, stopStep: async () => { calls.push(result); return result; } });
    assert.equal((await handle.stopStep()).acknowledged, expected);
  }
  assert.equal(calls.length, 4);
  const plain = await ownChildProcess(fake, { driver });
  assert.deepEqual(await plain.stopStep(), { acknowledged: false });
});
