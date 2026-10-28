import { createSocket } from 'node:dgram';
import fs from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { openOrigin } from '../engine/sync/origin.mjs';
import { encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport } from '../engine/sync/replicate.mjs';
import { openSync } from '../engine/sync/store.mjs';
import { openDiscovery, parseDiscovery } from '../engine/relan/discovery.mjs';
import { openRelanListener } from '../engine/relan/http.mjs';
import { createRelanKey, saveRelanKey } from '../engine/relan/keys.mjs';
import { pairRelan } from '../engine/relan/pairing.mjs';
import { createRelan } from '../engine/relan/runtime.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const TIMERS = { initialMs: 800, announceMs: 75, hostLossMs: 1200, tickMs: 25, retryMs: 300 };

async function eventually(check, message, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

async function udpPorts(count) {
  const sockets = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const socket = createSocket('udp4');
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, '127.0.0.1', resolve);
      });
    }
    return sockets.map((socket) => socket.address().port);
  } finally {
    await Promise.all(sockets.map((socket) => new Promise((resolve) => socket.close(resolve))));
  }
}

async function cluster(t, { names = ['MACHINE-A', 'MACHINE-B', 'MACHINE-C'], preferred = null, started = {}, clocks = {}, isolated = false, keyMaterial = null, online = null } = {}) {
  const ports = await udpPorts(names.length);
  const fixtures = [];
  const instances = new Map();
  const origins = new Map();
  const wire = [];
  t.after(async () => {
    await Promise.all([...instances.values()].map((runtime) => runtime.close()));
    for (const fixture of fixtures) await dispose(fixture);
  });
  const base = Date.now();
  let readyAt = null;
  let material = keyMaterial;
  for (const name of names) {
    const fixture = await makeCoreFixture({ machine: name });
    fixtures.push(fixture);
    const keyOptions = { localDirectory: fixture.paths.localDirectory, store: fixture.store, aclRunner: fixture.store.aclRunner };
    if (!material) material = await createRelanKey(keyOptions);
    else await saveRelanKey(keyOptions, material);
    const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine: name });
    origins.set(name, origin);
  }
  async function start(name) {
    const index = names.indexOf(name);
    const origin = origins.get(name);
    const runtime = await createRelan({
      origin, machine: name, addresses: online ? () => online[name] === false ? [] : ['127.0.0.1'] : ['127.0.0.1'], allowLoopback: true, port: 0,
      preferred: name === preferred, now: () => base + (readyAt === null ? 0 : Date.now() - readyAt) + (clocks[name] ?? 0), startedAt: base + (clocks[name] ?? 0) + (started[name] ?? 0),
      discovery: { port: ports[index], targets: isolated ? [] : ports.filter((_, other) => other !== index).map((port) => ({ address: '127.0.0.1', port })) },
      timers: { ...TIMERS, ...(isolated ? { initialMs: 60000 } : {}) }, onWire: (bytes) => wire.push(Buffer.from(bytes)),
    });
    instances.set(name, runtime);
    return runtime;
  }
  // Election time starts once every fixture has finished constructing its service.
  await Promise.all(names.map(start));
  readyAt = Date.now();
  return { names, fixtures, instances, origins, material, wire, start };
}

function allFollow(group, name) {
  return [...group.instances.values()].every((runtime) => runtime.status().host === name && runtime.status().hosting === (runtime.status().machine === name));
}

async function announceTo(sender, target) {
  const state = sender.status();
  const socket = createSocket('udp4');
  try {
    const bytes = Buffer.from(JSON.stringify({ format: 'hivem1nd-relan-v1', relanId: state.relanId, host: state.machine, epoch: state.epoch, port: state.listeners[0].port })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    await new Promise((resolve, reject) => socket.send(bytes, target.status().discovery[0].port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  } finally {
    socket.close();
  }
}

test('ReLAN discovery accepts exactly its five clear fields and refuses wildcard bindings', async () => {
  const value = { format: 'hivem1nd-relan-v1', relanId: 'test-relan', host: 'MACHINE-A', epoch: 1, port: 43119 }; // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.deepEqual(parseDiscovery(Buffer.from(JSON.stringify(value))), value);
  for (const extra of [{ name: 'private mind' }, { preferred: true }, { uptime: 10 }, { key: 'secret' }]) {
    assert.equal(parseDiscovery(Buffer.from(JSON.stringify({ ...value, ...extra }))), null);
  }
  for (const invalid of [{ ...value, host: '../escape' }, { ...value, port: 0 }, { ...value, epoch: -1 }, { ...value, format: 'other' }]) {
    assert.equal(parseDiscovery(Buffer.from(JSON.stringify(invalid))), null);
  }
  await assert.rejects(openDiscovery({ addresses: ['0.0.0.0'], allowLoopback: true, port: 0 }), { code: 'invalid_relan_address' });
  await assert.rejects(openDiscovery({ addresses: ['127.0.0.1'], port: 0 }), { code: 'invalid_relan_address' });
});

test('ReLAN discovery fallback reaches two interface-bound sockets without target overrides', async (t) => {
  const [port] = await udpPorts(1);
  const received = [[], []];
  const errors = [];
  const listeners = [];
  t.after(() => Promise.all(listeners.map((listener) => listener.close())));
  for (const [index, address] of ['127.0.0.1', '127.0.0.2'].entries()) {
    listeners.push(await openDiscovery({ addresses: [address], allowLoopback: true, port,
      onMessage: (packet) => received[index].push(packet), onError: (error) => errors.push(error) }));
  }
  const packets = ['MACHINE-A', 'MACHINE-B'].map((host) => ({ format: 'hivem1nd-relan-v1', relanId: 'test-relan', host, epoch: 1, port: 43120 })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  listeners[0].send(packets[0]);
  listeners[1].send(packets[1]);
  await eventually(() => received[0].some((packet) => packet.host === 'MACHINE-B') && received[1].some((packet) => packet.host === 'MACHINE-A'), 'The private-interface discovery fallback did not deliver.');
  for (const packets of received) for (const packet of packets) assert.deepEqual(Object.keys(packet).sort(), ['epoch', 'format', 'host', 'port', 'relanId']);
  assert.deepEqual(errors, []);
});

test('ReLAN starts without eligible interfaces and keeps its local key and mirror available', async (t) => {
  const fixture = await makeCoreFixture({ machine: 'MACHINE-A' });
  let runtime;
  t.after(async () => { await runtime?.close(); await dispose(fixture); });
  const material = await createRelanKey({ localDirectory: fixture.paths.localDirectory, store: fixture.store, aclRunner: fixture.store.aclRunner });
  const origin = openOrigin({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') }, machine: fixture.machine });
  runtime = await createRelan({ origin, interfaces: () => [], discovery: { port: 0, targets: [] }, timers: TIMERS });
  assert.equal(runtime.status().paired, true);
  assert.deepEqual(runtime.status().listeners, []);
  assert.deepEqual(runtime.status().discovery, []);
  assert.deepEqual(runtime.keyProvider(material.keyId), material.key);
  const bytes = encodePack({ machine: fixture.machine, sequence: 1, changes: [], objects: [], encryption: runtime.encryption(), keyProvider: runtime.keyProvider });
  const folder = openFolderTransport({ directory: origin.paths.origin, store: fixture.store, keyProvider: runtime.keyProvider });
  await folder.writePack(fixture.machine, 1, bytes);
  await folder.writeHead({ format: 'hivem1nd-head-v1', machine: fixture.machine, sequence: 1, updatedAt: new Date().toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
  assert.deepEqual(await folder.readPack(fixture.machine, 1), bytes);
  await runtime.host();
  assert.deepEqual(runtime.status().listeners, []);
  for (const addresses of [[], ['0.0.0.0']]) {
    await assert.rejects(createRelan({ origin, interfaces: () => [], addresses }), { code: 'invalid_relan_address' });
  }
});

test('ReLAN loopback-only bindings do not enumerate unrelated machine interfaces', async (t) => {
  t.mock.method(os, 'networkInterfaces', () => { throw new Error('Unexpected system interface enumeration.'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const group = await cluster(t, { preferred: 'MACHINE-C' });
  await eventually(() => allFollow(group, 'MACHINE-C'), 'The loopback election consulted the machine interfaces.');
});

test('ReLAN opens and closes network bindings as interfaces return and catches up offline publication', async (t) => {
  const online = { 'MACHINE-B': false };
  const group = await cluster(t, { names: ['MACHINE-A', 'MACHINE-B'], online });
  const a = group.instances.get('MACHINE-A');
  const b = group.instances.get('MACHINE-B');
  const fixture = group.fixtures.find((item) => item.machine === 'MACHINE-B');
  const raw = Buffer.from('An edit published while every ReLAN interface is disconnected.');
  const target = 'user/interface-offline.txt';
  await writeFile(path.join(fixture.paths.mind, target), raw);
  const hash = hashBytes(raw);
  const bytes = encodePack({ machine: fixture.machine, sequence: 1, encryption: b.encryption(), keyProvider: b.keyProvider,
    changes: [{ format: 'hivem1nd-change-v1', id: uuidV8(['interface-offline']), machine: fixture.machine, at: new Date(fixture.clock.now).toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      target: { kind: 'mind', path: target }, operation: 'put', hash, size: raw.length, baseHash: null, messageId: null, transactionId: null }],
    objects: [{ hash, raw }] });
  const local = openFolderTransport({ directory: group.origins.get(fixture.machine).paths.origin, store: fixture.store, keyProvider: b.keyProvider });
  await local.writePack(fixture.machine, 1, bytes);
  await local.writeHead({ format: 'hivem1nd-head-v1', machine: fixture.machine, sequence: 1, updatedAt: new Date(fixture.clock.now).toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
  assert.deepEqual(b.status().listeners, []);
  assert.deepEqual(await readFile(path.join(fixture.paths.mind, target)), raw);
  await eventually(() => a.status().hosting, 'The connected machine did not host.');
  online['MACHINE-B'] = true;
  const remote = openFolderTransport({ directory: group.origins.get('MACHINE-A').paths.origin, keyProvider: a.keyProvider });
  await eventually(async () => b.status().listeners.length === 1 && (await remote.listHeads()).length === 1, 'The returning interface did not open and replicate its offline publication.');
  assert.deepEqual(await remote.readPack(fixture.machine, 1), bytes);
  const receiving = group.fixtures.find((item) => item.machine === 'MACHINE-A');
  const sync = openSync({ store: receiving.store, paths: receiving.paths, now: () => receiving.clock.now });
  const provider = { keyProvider: a.keyProvider, readHead: async (machine) => (await remote.listHeads()).find((head) => head.machine === machine), readPack: remote.readPack };
  assert.equal((await applyPack(sync, bytes, { provider })).status, 'applied');
  assert.deepEqual(await readFile(path.join(receiving.paths.mind, target)), raw);
  online['MACHINE-B'] = false;
  await eventually(() => b.status().listeners.length === 0 && b.status().discovery.length === 0, 'The disappeared interface kept listening.');
  assert.deepEqual(b.keyProvider(group.material.keyId), group.material.key);
  online['MACHINE-B'] = true;
  await eventually(() => allFollow(group, 'MACHINE-A') && b.status().listeners.length === 1, 'The interface did not recover a second time.');
});

test('ReLAN election chooses preferred host before service uptime and name', async (t) => {
  const group = await cluster(t, { preferred: 'MACHINE-C', started: { 'MACHINE-A': -20000, 'MACHINE-B': -10000 } });
  await eventually(() => allFollow(group, 'MACHINE-C'), 'The preferred machine did not become the only host.');
  assert.equal(group.instances.get('MACHINE-C').status().epoch, 1);
});

test('ReLAN election and state probes continue while discovered peers wait for durable storage', async (t) => {
  let release;
  let writes = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (path.basename(String(args[0])).startsWith('relan-peers.json.')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { writes += 1; await blocked; return sync(); };
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { release(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  const group = await cluster(t, { preferred: 'MACHINE-C' });
  await eventually(() => writes > 0, 'No discovered peer reached durable storage.');
  await eventually(() => allFollow(group, 'MACHINE-C'), 'Peer persistence blocked the preferred host election.');
  for (const runtime of group.instances.values()) {
    assert.equal(runtime.status().members.length, 2);
    assert.equal(runtime.status().epoch, 1);
    assert.deepEqual(runtime.status().peers, []);
  }
  const host = group.instances.get('MACHINE-C');
  const { code } = await host.showCode();
  const paired = await pairRelan({ ...host.status().listeners[0], code, timeoutMs: TIMERS.hostLossMs });
  assert.equal(paired.relanId, group.material.relanId);
  assert.equal(paired.key.equals(group.material.key), true);
});

test('ReLAN election chooses longest service uptime before name', async (t) => {
  const group = await cluster(t, { started: { 'MACHINE-B': -20000, 'MACHINE-C': -10000 } });
  await eventually(() => allFollow(group, 'MACHINE-B'), 'The longest running service did not host.');
});

test('ReLAN service uptime ranking is independent of machine wall-clock offsets', async (t) => {
  const group = await cluster(t, { started: { 'MACHINE-B': -20000 }, clocks: { 'MACHINE-B': 30000, 'MACHINE-C': -20000 } });
  await eventually(() => allFollow(group, 'MACHINE-B'), 'Clock offsets changed the service uptime ordering.');
});

test('ReLAN election uses name order when preference and service uptime tie', async (t) => {
  const group = await cluster(t);
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The first machine by name did not host.');
});

test('ReLAN host loss migrates to the next candidate with epoch plus one', async (t) => {
  const group = await cluster(t);
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The initial host was not elected.');
  const initialEpoch = group.instances.get('MACHINE-A').status().epoch;
  await group.instances.get('MACHINE-A').close();
  group.instances.delete('MACHINE-A');
  await eventually(() => allFollow(group, 'MACHINE-B'), 'The remaining machines did not migrate to MACHINE-B.');
  assert.equal(group.instances.get('MACHINE-B').status().epoch, initialEpoch + 1);
});

test('ReLAN follows a restarted host at the same endpoint without waiting for another publication', async (t) => {
  const group = await cluster(t, { names: ['MACHINE-B'], isolated: true });
  const member = group.instances.get('MACHINE-B');
  const now = () => member.status().startedAt + member.status().uptimeMs;
  let startedAt = now() - 10000;
  let published = false;
  const bytes = encodePack({ machine: 'MACHINE-A', sequence: 1, changes: [], objects: [], encryption: member.encryption(), keyProvider: member.keyProvider });
  const head = { format: 'hivem1nd-head-v1', machine: 'MACHINE-A', sequence: 1, updatedAt: new Date().toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] };
  const transport = { listHeads: async () => published ? [head] : [], readPack: async () => bytes };
  const open = (port = 0) => openRelanListener({ transport, keyProvider: member.keyProvider, getKey: () => group.material,
    addresses: ['127.0.0.1'], interfaces: [], allowLoopback: true, port, now, longPollMs: TIMERS.tickMs,
    getState: () => ({ machine: 'MACHINE-A', relanId: group.material.relanId, epoch: 1, hosting: true, preferred: true, startedAt, uptimeMs: now() - startedAt }) });
  let listener = await open();
  const port = listener.listeners[0].port;
  const discovery = await openDiscovery({ addresses: ['127.0.0.1'], interfaces: [], allowLoopback: true, port: 0,
    targets: [{ address: '127.0.0.1', port: member.status().discovery[0].port }] });
  const announce = () => discovery.send({ format: 'hivem1nd-relan-v1', relanId: group.material.relanId, host: 'MACHINE-A', epoch: 1, port }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const timer = setInterval(announce, TIMERS.announceMs);
  t.after(async () => { clearInterval(timer); await discovery.close(); await listener.close(); });
  announce();
  await eventually(() => member.status().host === 'MACHINE-A' && group.wire.some(chunk => chunk.equals(Buffer.from('{"revision":0}'))), 'The member did not establish its initial change feed.');
  await listener.close();
  // The host publishes while stopped; the new listener has no filesystem event to announce.
  published = true;
  startedAt = now();
  listener = await open(port);
  announce();
  const folder = openFolderTransport({ directory: group.origins.get('MACHINE-B').paths.origin, keyProvider: member.keyProvider });
  await eventually(async () => (await folder.listHeads()).some(item => item.machine === 'MACHINE-A'), 'The restarted host kept its offline publication hidden.');
  assert.deepEqual(await folder.readPack('MACHINE-A', 1), bytes);
});

test('ReLAN migration breaks equal uptime ties by name despite delayed state responses', async (t) => {
  let delayedPort, hostPort, initialHost;
  let missingHostUpdates = false;
  const createServer = http.createServer;
  t.mock.method(http, 'createServer', (...args) => {
    const server = createServer(...args);
    server.on('request', (request, response) => {
      if (request.url !== '/state') return;
      const end = response.end.bind(response);
      response.end = (...parts) => {
        if (missingHostUpdates && server.address()?.port === hostPort) {
          const state = initialHost.status();
          if (Number(request.headers['x-hivem1nd-time']) < state.startedAt + state.uptimeMs - 10000) { // Compatibility: paired machines retain their signed wire headers.
            response.destroy();
            return response;
          }
        }
        if (server.address()?.port !== delayedPort) return end(...parts);
        const timer = setTimeout(() => end(...parts), 60);
        response.once('close', () => clearTimeout(timer));
        return response;
      };
    });
    return server;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const group = await cluster(t, { names: ['MACHINE-C', 'MACHINE-B', 'MACHINE-A'], preferred: 'MACHINE-A', clocks: { 'MACHINE-C': -20000 } });
  delayedPort = group.instances.get('MACHINE-B').status().listeners[0].port;
  initialHost = group.instances.get('MACHINE-A');
  hostPort = initialHost.status().listeners[0].port;
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The initial preferred host was not elected.');
  missingHostUpdates = true;
  await eventually(() => {
    const b = group.instances.get('MACHINE-B').status().members.find(peer => peer.machine === 'MACHINE-A');
    const c = group.instances.get('MACHINE-C').status().members.find(peer => peer.machine === 'MACHINE-A');
    return b && c && b.seenAt - (c.seenAt + 20000) >= 150;
  }, 'The member did not miss the final host updates.');
  const initialEpoch = group.instances.get('MACHINE-A').status().epoch;
  await group.instances.get('MACHINE-A').close();
  group.instances.delete('MACHINE-A');
  await eventually(() => allFollow(group, 'MACHINE-B'), 'State response latency changed the migration order.');
  assert.equal(group.instances.get('MACHINE-B').status().epoch, initialEpoch + 1);
});

test('ReLAN Overtake increments epoch and the previous host becomes a member', async (t) => {
  const group = await cluster(t);
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The initial host was not elected.');
  const initialEpoch = group.instances.get('MACHINE-A').status().epoch;
  await group.instances.get('MACHINE-C').host();
  await eventually(() => allFollow(group, 'MACHINE-C'), 'Overtake did not move all machines to MACHINE-C.');
  assert.equal(group.instances.get('MACHINE-C').status().epoch, initialEpoch + 1);
  assert.equal(group.instances.get('MACHINE-A').status().hosting, false);
});

test('ReLAN split hosts settle by higher epoch', async (t) => {
  const group = await cluster(t, { names: ['MACHINE-A', 'MACHINE-B'], isolated: true });
  const a = group.instances.get('MACHINE-A');
  const b = group.instances.get('MACHINE-B');
  await a.host();
  await b.host();
  await b.host();
  await Promise.all([announceTo(a, b), announceTo(b, a)]);
  await eventually(() => allFollow(group, 'MACHINE-B'), 'The lower epoch host did not yield.');
  assert.equal(b.status().epoch, 2);
});

test('ReLAN split hosts with equal epochs settle by name', async (t) => {
  const group = await cluster(t, { names: ['MACHINE-A', 'MACHINE-B'], isolated: true });
  const a = group.instances.get('MACHINE-A');
  const b = group.instances.get('MACHINE-B');
  await a.host();
  await b.host();
  await Promise.all([announceTo(a, b), announceTo(b, a)]);
  await eventually(() => allFollow(group, 'MACHINE-A'), 'Equal epoch hosts did not settle by name.');
  assert.equal(a.status().epoch, 1);
});

test('ReLAN keeps offline edits on two members and converges encrypted mirrors after reconnect', async (t) => {
  const group = await cluster(t);
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The initial host was not elected.');
  const encryption = group.instances.get('MACHINE-A').encryption();
  const keyProvider = (keyId) => keyId === group.material.keyId ? group.material.key : null;
  await Promise.all([...group.instances.values()].map((runtime) => runtime.close()));
  group.instances.clear();
  const written = new Map();
  for (const machine of ['MACHINE-B', 'MACHINE-C']) {
    const fixture = group.fixtures.find((item) => item.machine === machine);
    const raw = Buffer.from(`This test file belongs to ${machine} and stays private on the wire.`);
    const target = `user/offline-${machine}.txt`;
    await writeFile(path.join(fixture.paths.mind, target), raw);
    const hash = hashBytes(raw);
    const bytes = encodePack({
      machine, sequence: 1, encryption, keyProvider,
      changes: [{ format: 'hivem1nd-change-v1', id: uuidV8(['offline', machine]), machine, at: new Date(fixture.clock.now).toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
        target: { kind: 'mind', path: target }, operation: 'put', hash, size: raw.length, baseHash: null, messageId: null, transactionId: null }],
      objects: [{ hash, raw }],
    });
    const folder = openFolderTransport({ directory: group.origins.get(machine).paths.origin, store: fixture.store, keyProvider });
    await folder.writePack(machine, 1, bytes);
    await folder.writeHead({ format: 'hivem1nd-head-v1', machine, sequence: 1, updatedAt: new Date(fixture.clock.now).toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
    written.set(machine, { raw, target, bytes });
    assert.deepEqual(await folder.listHeads().then((heads) => heads.map((head) => head.machine)), [machine]);
  }
  await Promise.all(group.names.map(group.start));
  await eventually(async () => {
    const heads = await Promise.all(group.names.map((name) => openFolderTransport({ directory: group.origins.get(name).paths.origin, keyProvider }).listHeads()));
    return heads.every((items) => items.length === 2);
  }, 'The two offline histories did not converge.');
  for (const fixture of group.fixtures) {
    const folder = openFolderTransport({ directory: group.origins.get(fixture.machine).paths.origin, store: fixture.store, keyProvider });
    const sync = openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now });
    const provider = { keyProvider, readHead: async (machine) => (await folder.listHeads()).find((head) => head.machine === machine), readPack: folder.readPack };
    for (const [machine, entry] of written) {
      assert.deepEqual(await folder.readPack(machine, 1), entry.bytes);
      if (fixture.machine !== machine) assert.equal((await applyPack(sync, entry.bytes, { provider })).status, 'applied');
      assert.deepEqual(await readFile(path.join(fixture.paths.mind, entry.target)), entry.raw);
    }
  }
  assert.ok(group.wire.length > 0);
  for (const chunk of group.wire) for (const { raw, target } of written.values()) {
    assert.equal(chunk.includes(raw), false, 'The test file plaintext appeared on the wire.');
    assert.equal(chunk.includes(Buffer.from(target)), false, 'The test file path appeared on the wire.');
  }
});

test('ReLAN leave persists across restart and Host reuses the key for historical packs', async (t) => {
  const group = await cluster(t, { names: ['MACHINE-A', 'MACHINE-B'] });
  await eventually(() => allFollow(group, 'MACHINE-A'), 'The initial host was not elected.');
  const previous = group.instances.get('MACHINE-B');
  const encryption = previous.encryption();
  const origin = group.origins.get('MACHINE-B');
  const folder = openFolderTransport({ directory: origin.paths.origin, store: origin.store, keyProvider: previous.keyProvider });
  const bytes = encodePack({ machine: 'MACHINE-B', sequence: 1, changes: [], objects: [], encryption, keyProvider: previous.keyProvider });
  await folder.writePack('MACHINE-B', 1, bytes);
  await folder.writeHead({ format: 'hivem1nd-head-v1', machine: 'MACHINE-B', sequence: 1, updatedAt: new Date().toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
  await eventually(async () => (await openFolderTransport({ directory: group.origins.get('MACHINE-A').paths.origin }).listHeads()).length === 1, 'The historical pack was not replicated.');
  await Promise.all([previous.host(), previous.leave()]);
  assert.equal(previous.status().paired, false);
  assert.equal(previous.status().left, true);
  assert.deepEqual(previous.keyProvider(encryption.keyId), group.material.key);
  await previous.close();
  group.instances.delete('MACHINE-B');
  const restarted = await group.start('MACHINE-B');
  assert.equal(restarted.status().paired, false);
  assert.equal(restarted.status().left, true);
  assert.throws(() => restarted.encryption(), { code: 'encryption_key_missing' });
  await restarted.host();
  assert.deepEqual(restarted.encryption(), encryption);
  assert.equal(restarted.status().left, false);
  await eventually(() => allFollow(group, 'MACHINE-B'), 'Host did not reactivate the retained ReLAN.');
  assert.deepEqual(await folder.readPack('MACHINE-B', 1), bytes);
});

test('ReLAN join refuses replacing its local key before and after publishing immutable history', async (t) => {
  const group = await cluster(t, { names: ['MACHINE-A'], isolated: true });
  const foreign = await cluster(t, { names: ['MACHINE-X'], isolated: true });
  const changedKey = await cluster(t, { names: ['MACHINE-Y'], isolated: true,
    keyMaterial: { ...group.material, key: Buffer.from(group.material.key).fill(7) } });
  const runtime = group.instances.get('MACHINE-A');
  const host = foreign.instances.get('MACHINE-X');
  const encryption = runtime.encryption();
  const origin = group.origins.get('MACHINE-A');
  const folder = openFolderTransport({ directory: origin.paths.origin, store: origin.store, keyProvider: runtime.keyProvider });
  const { code } = await host.showCode();
  assert.deepEqual(await folder.listHeads(), []);
  await assert.rejects(runtime.join(code, host.status().listeners[0]), { code: 'relan_history_conflict' });
  assert.deepEqual(runtime.encryption(), encryption);
  const sameIdentifiers = changedKey.instances.get('MACHINE-Y');
  const otherCode = await sameIdentifiers.showCode();
  await assert.rejects(runtime.join(otherCode.code, sameIdentifiers.status().listeners[0]), { code: 'relan_history_conflict' });
  assert.deepEqual(runtime.encryption(), encryption);
  const bytes = encodePack({ machine: 'MACHINE-A', sequence: 1, changes: [], objects: [], encryption, keyProvider: runtime.keyProvider });
  await folder.writePack('MACHINE-A', 1, bytes);
  await folder.writeHead({ format: 'hivem1nd-head-v1', machine: 'MACHINE-A', sequence: 1, updatedAt: new Date().toISOString(), // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] });
  await assert.rejects(runtime.join(code, host.status().listeners[0]), { code: 'relan_history_conflict' });
  assert.deepEqual(runtime.encryption(), encryption);
  assert.deepEqual(await folder.readPack('MACHINE-A', 1), bytes);
});
