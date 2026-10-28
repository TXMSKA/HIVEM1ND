import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { eligibleAddresses, isRelanAddress, parsePeerAddress } from '../engine/relan/addresses.mjs';
import { privateAddresses } from '../engine/relan/discovery.mjs';
import { createRelanKey, saveRelanKey } from '../engine/relan/keys.mjs';
import { createRelan } from '../engine/relan/runtime.mjs';
import { eligibleAddresses as homeAddresses } from '../engine/service/home.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { openOrigin } from '../engine/sync/origin.mjs';
import { encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport } from '../engine/sync/replicate.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const TIMERS = { initialMs: 800, announceMs: 80, hostLossMs: 1200, tickMs: 25, retryMs: 300 };
const unavailable = (_command, _args, _options, callback) => callback(Object.assign(new Error(), { code: 'ENOENT' }));
const interfaces = address => [{ name: 'Tailscale', address, netmask: '255.255.255.255', internal: false }];

async function eventually(check, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

// Bind real sockets while presenting injected tailnet interfaces to the runtime.
function mapTailnet(t) {
  const addresses = new Map([1, 2, 3].map(index => [`100.64.0.${index}`, `127.0.0.${index}`]));
  const reverse = new Map([...addresses].map(([tailnet, loopback]) => [loopback, tailnet]));
  const packets = [];
  const createSocket = dgram.createSocket;
  t.mock.method(dgram, 'createSocket', (...args) => {
    const socket = createSocket(...args);
    const bind = socket.bind.bind(socket), send = socket.send.bind(socket), emit = socket.emit.bind(socket), address = socket.address.bind(socket);
    socket.bind = (port, host, ...rest) => bind(port, addresses.get(host) ?? host, ...rest);
    socket.send = (bytes, port, host, callback) => {
      packets.push({ host, port, bytes: Buffer.from(bytes) });
      return send(bytes, port, addresses.get(host) ?? host, callback);
    };
    socket.emit = (event, ...values) => {
      if (event === 'message') values[1] = { ...values[1], address: reverse.get(values[1].address) ?? values[1].address };
      return emit(event, ...values);
    };
    socket.address = () => { const bound = address(); return { ...bound, address: reverse.get(bound.address) ?? bound.address }; };
    return socket;
  });
  const createServer = http.createServer, request = http.request;
  t.mock.method(http, 'createServer', (...args) => {
    const server = createServer(...args), listen = server.listen.bind(server);
    server.listen = (port, host, ...rest) => listen(port, addresses.get(host) ?? host, ...rest);
    return server;
  });
  t.mock.method(http, 'request', (options, ...args) => request({ ...options, hostname: addresses.get(options.hostname) ?? options.hostname }, ...args));
  syncBuiltinESMExports();
  return { packets, restore() { t.mock.restoreAll(); syncBuiltinESMExports(); } };
}

test('ReLAN includes the complete CGNAT range while home keeps RFC 1918 eligibility', () => {
  const accepted = ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.0', '100.127.255.255'];
  const rejected = ['0.0.0.0', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '127.0.0.1', '100.64.0.256', '100.064.0.1', '::1'];
  for (const address of accepted) assert.equal(isRelanAddress(address), true, address);
  for (const address of rejected) {
    assert.equal(isRelanAddress(address), false, address);
    assert.throws(() => parsePeerAddress(address), { code: 'invalid_relan_address' });
    assert.throws(() => privateAddresses({ addresses: [address], interfaces: interfaces(address) }), { code: 'invalid_relan_address' });
  }
  const rows = [...accepted, ...rejected].flatMap(interfaces);
  assert.deepEqual(eligibleAddresses(rows).map(item => item.address).sort(), accepted.sort());
  assert.deepEqual(homeAddresses(rows).map(item => item.address).sort(), accepted.filter(address => !address.startsWith('100.')).sort());
  assert.deepEqual(eligibleAddresses([{ ...interfaces('100.64.0.1')[0], internal: true }]), []);
  assert.deepEqual(parsePeerAddress('100.64.0.2:45678'), { address: '100.64.0.2', port: 45678 });
});

test('Tailscale lookup stays disabled at startup and on refresh unless explicitly enabled', async t => {
  const fixture = await makeCoreFixture();
  const runtimes = [];
  t.after(async () => { await Promise.all(runtimes.map(runtime => runtime.close())); await dispose(fixture); });
  const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine: fixture.machine });
  for (const options of [{}, { tailscale: false }]) {
    let calls = 0, snapshots = 0;
    const runtime = await createRelan({ origin, ...options, timers: { tickMs: 10 },
      interfaces: () => { snapshots += 1; return []; },
      execFile(_command, _args, _options, callback) { calls += 1; callback(null, '{}'); } });
    runtimes.push(runtime);
    assert.equal(calls, 0);
    await eventually(() => snapshots >= 3, 'The interface refresh did not run.');
    assert.equal(calls, 0);
    await runtime.close();
  }
});

test('optional Tailscale lookup does not hold startup and supplies online peers when it completes', { timeout: 3000 }, async t => {
  const fixture = await makeCoreFixture();
  let runtime, finish;
  t.after(async () => { finish?.(Object.assign(new Error(), { code: 'ENOENT' })); await runtime?.close(); await dispose(fixture); });
  const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine: fixture.machine });
  runtime = await createRelan({ origin, interfaces: [], tailscale: true, execFile(_command, _args, _options, callback) { finish = callback; } });
  assert.equal(typeof finish, 'function');
  assert.deepEqual(runtime.status().peers, []);
  finish(null, await readFile(new URL('./fixtures/relan-tailscale-status.json', import.meta.url), 'utf8'));
  await eventually(() => runtime.status().peers.length === 2, 'Online Tailscale peers were not used.');
  assert.deepEqual(runtime.status().peers, [{ address: '100.127.255.254', port: 43119 }, { address: '100.64.0.2', port: 43119 }]);
  assert.equal(runtime.status().lastError, null);
});

test('tailnet unicast with injected 100.x interfaces elects, replicates, restarts and migrates without broadcast', async t => {
  const mapping = mapTailnet(t), fixtures = [], runtimes = new Map(), origins = new Map(), settings = new Map();
  t.after(async () => {
    await Promise.all([...runtimes.values()].map(runtime => runtime.close()));
    mapping.restore();
    for (const fixture of fixtures) await dispose(fixture);
  });
  let material;
  for (const [index, machine] of ['MACHINE-A', 'MACHINE-B', 'MACHINE-C'].entries()) {
    const fixture = await makeCoreFixture({ machine });
    fixtures.push(fixture);
    const keyOptions = { localDirectory: fixture.paths.localDirectory, store: fixture.store };
    if (material) await saveRelanKey(keyOptions, material);
    else material = await createRelanKey(keyOptions);
    const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine });
    origins.set(machine, origin);
    const options = { origin, interfaces: () => interfaces(`100.64.0.${index + 1}`), port: 0,
      discovery: { port: 0, broadcast: false }, execFile: unavailable, timers: TIMERS, startedAt: 1000 + index };
    settings.set(machine, options);
    runtimes.set(machine, await createRelan(options));
  }
  assert.equal(mapping.packets.length, 0);
  for (const [machine, runtime] of runtimes) for (const [other, peer] of runtimes) {
    if (machine !== other) await runtime.addPeer(`${peer.status().discovery[0].address}:${peer.status().discovery[0].port}`);
  }
  const follows = machine => [...runtimes.values()].every(runtime => runtime.status().host === machine);
  await eventually(() => follows('MACHINE-A'), 'Tailnet members did not elect A.');
  const c = runtimes.get('MACHINE-C'), origin = origins.get('MACHINE-C');
  const folder = openFolderTransport({ directory: origin.paths.origin, store: origin.store, keyProvider: c.keyProvider });
  const bytes = encodePack({ machine: 'MACHINE-C', sequence: 1, changes: [], objects: [], encryption: c.encryption(), keyProvider: c.keyProvider });
  await folder.writePack('MACHINE-C', 1, bytes);
  await folder.writeHead({ format: 'hivem1nd-head-v1', machine: 'MACHINE-C', sequence: 1, updatedAt: new Date().toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
  await eventually(async () => (await Promise.all([...origins.values()].map(origin => openFolderTransport({ directory: origin.paths.origin, keyProvider: c.keyProvider }).listHeads()))).every(heads => heads.length === 1), 'Encrypted publication did not replicate over unicast.');
  for (const origin of origins.values()) assert.deepEqual(await openFolderTransport({ directory: origin.paths.origin, keyProvider: c.keyProvider }).readPack('MACHINE-C', 1), bytes);
  await runtimes.get('MACHINE-B').close();
  const b = await createRelan(settings.get('MACHINE-B'));
  runtimes.set('MACHINE-B', b);
  assert.ok(b.status().peers.some(peer => peer.address === '100.64.0.1'));
  await eventually(() => follows('MACHINE-A'), 'Saved peers did not reconnect after restart.');
  const epoch = runtimes.get('MACHINE-A').status().epoch;
  await runtimes.get('MACHINE-A').close();
  runtimes.delete('MACHINE-A');
  await eventually(() => follows('MACHINE-B') && b.status().hosting, 'Tailnet host loss did not migrate to B.');
  assert.equal(b.status().epoch, epoch + 1);
  await c.host();
  await eventually(() => follows('MACHINE-C') && !b.status().hosting, 'Tailnet Overtake did not settle on C.');
  assert.ok(mapping.packets.length > 0);
  for (const packet of mapping.packets) {
    assert.equal(isRelanAddress(packet.host), true);
    assert.deepEqual(Object.keys(JSON.parse(packet.bytes)).sort(), ['epoch', 'format', 'host', 'port', 'relanId']);
  }
});

test('join --host pairs without discovery and an unknown unicast member becomes a saved peer', async t => {
  const mapping = mapTailnet(t), fixtures = [], runtimes = [];
  t.after(async () => {
    await Promise.all(runtimes.map(runtime => runtime.close()));
    mapping.restore();
    for (const fixture of fixtures) await dispose(fixture);
  });
  for (const [index, machine] of ['HOST', 'MEMBER'].entries()) {
    const fixture = await makeCoreFixture({ machine });
    fixtures.push(fixture);
    const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine });
    runtimes.push(await createRelan({ origin, interfaces: () => interfaces(`100.64.0.${index + 1}`),
      discovery: { broadcast: false }, execFile: unavailable, timers: TIMERS }));
  }
  const [host, member] = runtimes;
  await host.host();
  assert.equal(mapping.packets.length, 0);
  const grant = await host.showCode();
  for (const address of ['0.0.0.0', '8.8.8.8']) await assert.rejects(member.join(grant.code, { host: address }), { code: 'invalid_relan_address' });
  assert.equal((await member.join(grant.code, { host: '100.64.0.1' })).paired, true);
  await eventually(() => host.status().members.some(peer => peer.machine === 'MEMBER') && member.status().host === 'HOST', 'The direct join did not reach the host over unicast.');
  await eventually(() => host.status().peers.some(peer => peer.address === '100.64.0.2'), 'The paired unknown sender was not remembered.');
  const saved = JSON.parse(await readFile(path.join(fixtures[0].paths.localDirectory, 'relan-peers.json'), 'utf8'));
  assert.ok(saved.peers.some(peer => peer.address === '100.64.0.2' && peer.port === 43119));
});
