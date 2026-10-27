import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const memberScript = fileURLToPath(new URL('./relan-sim-member.mjs', import.meta.url));
const unicast = process.argv.includes('--unicast');
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-relan-sim-')));
const children = [];
const names = ['MACHINE-A', 'MACHINE-B', 'MACHINE-C'];
const texts = Object.fromEntries(names.map(name => [name, `Private ReLAN simulation content from ${name}: ${root}`]));
let passed = 0;
let failed = 0;
let nextId = 0;

async function check(name, run) {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.log(`FAIL ${name}: ${error.message}`); throw error; }
}

async function ports() {
  const sockets = [];
  try {
    for (let index = 0; index < names.length; index += 1) {
      const socket = createSocket('udp4');
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', resolve); });
    }
    return sockets.map(socket => socket.address().port);
  } finally {
    await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
  }
}

async function start(machine, index, udpPorts) {
  const discovery = unicast ? { port: udpPorts[index], broadcast: false, targets: [] }
    : { port: udpPorts[index], targets: udpPorts.filter((_, peer) => peer !== index).map(port => ({ address: '127.0.0.1', port })) };
  const child = fork(memberScript, [JSON.stringify({ machine, root: path.join(root, machine),
    preferred: index === 0, startedAt: Date.now() - (names.length - index) * 1000,
    discovery })],
  { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const member = { child, machine, pending: new Map(), diagnostics: '', exited: false };
  children.push(member);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { member.diagnostics = (member.diagnostics + bytes).slice(-12000); });
  child.on('exit', (code, signal) => {
    member.exited = true;
    for (const request of member.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`${machine} exited (${signal ?? code}): ${member.diagnostics}`));
    }
    member.pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${machine} did not start: ${member.diagnostics}`)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`${machine} stopped during startup: ${member.diagnostics}`)); });
    child.on('message', message => {
      if (message.ready) { clearTimeout(timer); resolve(); return; }
      const request = member.pending.get(message.id);
      if (!request) return;
      member.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });
  });
  return member;
}

function call(member, action, input = {}) {
  if (member.exited) return Promise.reject(new Error(`${member.machine} is stopped.`));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { member.pending.delete(id); reject(new Error(`${member.machine} ${action} timed out: ${member.diagnostics}`)); }, 30000);
    member.pending.set(id, { resolve, reject, timer });
    member.child.send({ id, action, ...input }, error => {
      if (!error) return;
      clearTimeout(timer); member.pending.delete(id); reject(error);
    });
  });
}

async function until(run, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let detail;
  while (Date.now() < deadline) {
    const result = await run();
    if (result === true) return;
    detail = result;
    await delay(100);
  }
  throw new Error(`${description}: ${JSON.stringify(detail)}`);
}

async function converged(members) {
  return until(async () => {
    const states = await Promise.all(members.map(member => call(member, 'files', { machines: names })));
    return states.every(files => names.every(name => files[name] === texts[name])) || states;
  }, 'The local minds did not converge');
}

async function killOwned(member) {
  assert.ok(children.includes(member) && Number.isInteger(member.child.pid));
  if (member.exited) return;
  const exited = new Promise(resolve => member.child.once('exit', resolve));
  process.kill(member.child.pid, 'SIGKILL');
  await exited;
}

try {
  const udpPorts = await ports();
  for (const [index, name] of names.entries()) await start(name, index, udpPorts);
  const [a, b, c] = children;
  if (unicast) await check('manual peers are configured with broadcast disabled', async () => {
    await Promise.all(children.map(async (member, index) => {
      for (const port of udpPorts.filter((_, peer) => peer !== index)) await call(member, 'peer-add', { address: `127.0.0.1:${port}` });
    }));
  });
  await check('three separate Node processes use isolated loopback minds and mirrors', async () => {
    assert.equal(new Set(children.map(member => member.child.pid)).size, 3);
    assert.ok(children.every(member => member.child.pid !== process.pid));
    for (const member of children) assert.ok((await call(member, 'status')).listeners.every(listener => listener.address === '127.0.0.1'));
  });
  await check('B and C pair with A through the authenticated X25519 exchange', async () => {
    await call(a, 'host');
    const target = (await call(a, 'status')).listeners[0];
    for (const member of [b, c]) {
      const pairing = await call(a, 'code');
      await call(member, 'join', { code: pairing.code, target: unicast ? { host: `${target.address}:${target.port}` } : target });
      assert.equal((await call(member, 'status')).paired, true);
    }
    await until(async () => (await Promise.all(children.map(member => call(member, 'status')))).every(status => status.host === 'MACHINE-A'), 'A was not selected as host');
  });
  await check('each machine publishes an encrypted pulse and all three minds converge', async () => {
    for (const member of children) await call(member, 'write', { text: texts[member.machine] });
    await converged(children);
  });
  await check('every mirrored pack uses AES-256-GCM and contains none of the test plaintext', async () => {
    for (const member of children) for (const machine of names) {
      const directory = path.join(root, member.machine, 'mirror', 'machines', machine, 'packs');
      const files = await readdir(directory);
      assert.ok(files.length > 0);
      for (const file of files) {
        const bytes = await readFile(path.join(directory, file));
        const length = bytes.readUInt32BE(4);
        const header = JSON.parse(bytes.subarray(8, 8 + length));
        assert.equal(header.encryption.algorithm, 'aes-256-gcm');
        for (const text of Object.values(texts)) assert.equal(bytes.includes(Buffer.from(text)), false);
      }
    }
  });
  let before;
  await check('killing only the host PID migrates hosting with epoch + 1', async () => {
    before = (await call(a, 'status')).epoch;
    await killOwned(a);
    await until(async () => {
      const [left, right] = await Promise.all([call(b, 'status'), call(c, 'status')]);
      return left.host === 'MACHINE-B' && right.host === 'MACHINE-B' && left.hosting && left.epoch === before + 1 || [left, right];
    }, 'B did not replace A with the next epoch');
    await converged([b, c]);
  });
  await check('the surviving members publish and converge after host migration', async () => {
    texts['MACHINE-C'] += '\nWritten after the host process stopped.';
    await call(c, 'write', { text: texts['MACHINE-C'] });
    await converged([b, c]);
  });
  await check('Overtake moves hosting to C and the previous host yields', async () => {
    const epoch = (await call(b, 'status')).epoch;
    await call(c, 'host');
    await until(async () => {
      const [left, right] = await Promise.all([call(b, 'status'), call(c, 'status')]);
      return left.host === 'MACHINE-C' && !left.hosting && right.hosting && right.epoch === epoch + 1 || [left, right];
    }, 'Overtake did not settle on C');
    await converged([b, c]);
  });
} catch (error) {
  if (failed === 0) { failed += 1; console.log(`FAIL simulation startup: ${error.message}`); }
  process.exitCode = 1;
} finally {
  for (const member of children) {
    if (member.exited) continue;
    await call(member, 'close').catch(() => {});
    await killOwned(member).catch(() => {});
  }
  const temporary = await realpath(os.tmpdir());
  const relative = path.relative(temporary, root);
  assert.ok(relative.startsWith('hivem1nd-relan-sim-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`ReLAN simulation: ${passed} passed, ${failed} failed.`);
}
