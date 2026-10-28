import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { openKnownPeers, parseTailscaleStatus, tailscalePeers } from '../engine/relan/peers.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const tailscaleFixture = new URL('./fixtures/relan-tailscale-status.json', import.meta.url);
const expectedTailscale = [{ address: '100.127.255.254', port: 43119 }, { address: '100.64.0.2', port: 43119 }];

function optionsFor(fixture, options = {}) {
  return { localDirectory: fixture.paths.localDirectory, store: fixture.store, ...options };
}

test('ReLAN peers persist only in the private local directory without redundant writes', async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture);
  const file = path.join(options.localDirectory, 'relan-peers.json');
  try {
    const peers = await openKnownPeers(options);
    assert.deepEqual(peers.list(), []);
    await assert.rejects(lstat(file), { code: 'ENOENT' });
    assert.equal(await peers.add({ address: '100.64.0.2' }), true);
    assert.equal(await peers.add({ address: '192.168.1.2', port: 43120 }), true);
    const expected = [{ address: '100.64.0.2', port: 43119 }, { address: '192.168.1.2', port: 43120 }];
    assert.deepEqual(peers.list(), expected);
    peers.list()[0].address = '8.8.8.8';
    assert.deepEqual(peers.list(), expected);
    assert.deepEqual((await openKnownPeers(options)).list(), expected);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { format: 'hivem1nd-relan-peers-v1', peers: expected }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    const before = await lstat(file);
    assert.equal(await peers.add({ address: '100.64.0.2', port: 43119 }), false);
    assert.equal(await peers.remove({ address: '10.1.2.3' }), false);
    const after = await lstat(file);
    assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(await peers.remove({ address: '100.64.0.2' }), true);
    assert.deepEqual((await openKnownPeers(options)).list(), expected.slice(1));
    await assert.rejects(lstat(path.join(fixture.paths.mind, 'relan-peers.json')), { code: 'ENOENT' });
    if (process.platform === 'win32') {
      assert(fixture.store.aclRunner.calls.some(call => call.op === 'protect' && call.target.startsWith(file)));
      assert(fixture.store.aclRunner.calls.some(call => call.op === 'check' && call.target === file));
    } else {
      assert.equal((await lstat(file)).mode & 0o077, 0);
      assert.equal((await lstat(options.localDirectory)).mode & 0o077, 0);
    }
  } finally { await dispose(fixture); }
});

test('ReLAN peer updates serialize across stores and preserve simultaneous additions', async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture);
  try {
    const first = await openKnownPeers(options), second = await openKnownPeers(options);
    assert.deepEqual(await Promise.all([
      first.add({ address: '100.64.0.2' }), second.add({ address: '100.64.0.3' }), first.add({ address: '100.64.0.2' }),
    ]), [true, true, false]);
    assert.deepEqual((await openKnownPeers(options)).list(), [
      { address: '100.64.0.2', port: 43119 }, { address: '100.64.0.3', port: 43119 },
    ]);
  } finally { await dispose(fixture); }
});

test('ReLAN peers reject public, wildcard, loopback and malformed addresses', async () => {
  const fixture = await makeCoreFixture();
  try {
    const peers = await openKnownPeers(optionsFor(fixture));
    for (const address of ['0.0.0.0', '8.8.8.8', '127.0.0.1', '100.63.255.255', '100.128.0.0', '::1', 'example.com']) {
      await assert.rejects(peers.add({ address }), { code: 'invalid_relan_address' });
      await assert.rejects(peers.remove({ address }), { code: 'invalid_relan_address' });
    }
    for (const peer of [null, {}, { address: '100.64.0.1', port: 0 }, { address: '100.64.0.1', port: '43119' }]) {
      await assert.rejects(peers.add(peer), { code: 'invalid_relan_address' });
    }
    const loopback = await openKnownPeers(optionsFor(fixture, { allowLoopback: true }));
    assert.equal(await loopback.add({ address: '127.0.0.1' }), true);
  } finally { await dispose(fixture); }
});

test('ReLAN peers reject relative paths and paths outside the local store confinement', async () => {
  const fixture = await makeCoreFixture();
  try {
    await assert.rejects(openKnownPeers(), { code: 'invalid_path' });
    await assert.rejects(openKnownPeers({ localDirectory: 'relative' }), { code: 'invalid_path' });
    await assert.rejects(openKnownPeers(optionsFor(fixture, { localDirectory: path.dirname(fixture.root) })), { code: 'invalid_path' });
  } finally { await dispose(fixture); }
});

test('ReLAN peers reject invalid saved data and stop mutations if the file becomes unsafe', async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture), file = path.join(options.localDirectory, 'relan-peers.json');
  try {
    const peers = await openKnownPeers(options);
    await peers.add({ address: '100.64.0.2' });
    for (const value of ['{', '{}', JSON.stringify({ format: 'hivem1nd-relan-peers-v1', peers: [{ address: '8.8.8.8', port: 43119 }] })]) { // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      await writeFile(file, value);
      await assert.rejects(openKnownPeers(options), { code: 'invalid_relan_peers' });
      await assert.rejects(peers.add({ address: '100.64.0.3' }), { code: 'invalid_relan_peers' });
      assert.equal(await readFile(file, 'utf8'), value);
    }
  } finally { await dispose(fixture); }
});

test('ReLAN peers reject hardlinked files on reads and updates', async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture), file = path.join(options.localDirectory, 'relan-peers.json');
  try {
    const peers = await openKnownPeers(options);
    await peers.add({ address: '100.64.0.2' });
    await link(file, path.join(fixture.root, 'shared-peers.json'));
    await assert.rejects(openKnownPeers(options), { code: 'unsafe_path' });
    await assert.rejects(peers.add({ address: '100.64.0.3' }), { code: 'unsafe_path' });
    assert.equal((await lstat(file)).nlink, 2);
  } finally { await dispose(fixture); }
});

test('ReLAN peers reject linked directories and nonregular peer files', async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture), file = path.join(options.localDirectory, 'relan-peers.json');
  try {
    const linked = path.join(fixture.root, 'linked-local');
    await symlink(options.localDirectory, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(openKnownPeers(optionsFor(fixture, { localDirectory: linked })), { code: 'unsafe_path' });
    await mkdir(file);
    await assert.rejects(openKnownPeers(options), { code: 'unsafe_path' });
  } finally { await dispose(fixture); }
});

test('ReLAN peers refuse a saved peer file readable by other users', { skip: process.platform === 'win32' }, async () => {
  const fixture = await makeCoreFixture();
  const options = optionsFor(fixture), file = path.join(options.localDirectory, 'relan-peers.json');
  try {
    const peers = await openKnownPeers(options);
    await peers.add({ address: '100.64.0.2' });
    await chmod(file, 0o644);
    await assert.rejects(openKnownPeers(options), { code: 'bootstrap_unavailable' });
    await assert.rejects(peers.remove({ address: '100.64.0.2' }), { code: 'bootstrap_unavailable' });
  } finally { await dispose(fixture); }
});

test('Tailscale fixture yields only deduplicated online eligible IPv4 peer addresses', async () => {
  const fixture = await readFile(tailscaleFixture, 'utf8');
  assert.deepEqual(parseTailscaleStatus(fixture), expectedTailscale);
  assert.deepEqual(parseTailscaleStatus(Buffer.from(fixture)), expectedTailscale);
  assert.deepEqual(parseTailscaleStatus(JSON.parse(fixture)), expectedTailscale);
  for (const invalid of [null, '', '{', 'null', '{}', { Peer: [] }, { Peer: { broken: null } }]) {
    assert.deepEqual(parseTailscaleStatus(invalid), []);
  }
});

test('Tailscale discovery invokes execFile with fixed arguments and bounded resources', async () => {
  const fixture = await readFile(tailscaleFixture, 'utf8');
  const calls = [];
  assert.deepEqual(await tailscalePeers({ execFile(command, args, options, callback) {
    calls.push({ command, args, options }); callback(null, fixture);
  } }), expectedTailscale);
  assert.deepEqual(calls, [{ command: 'tailscale', args: ['status', '--json'],
    options: { windowsHide: true, timeout: 3000, maxBuffer: 1048576 } }]);
});

test('Tailscale CLI absence, errors and malformed output are silent', async () => {
  for (const code of ['ENOENT', 'ETIMEDOUT', 'EPERM']) {
    assert.deepEqual(await tailscalePeers({ execFile(_command, _args, _options, callback) {
      callback(Object.assign(new Error('unavailable'), { code }));
    } }), []);
  }
  assert.deepEqual(await tailscalePeers({ execFile() { throw new Error('unavailable'); } }), []);
  assert.deepEqual(await tailscalePeers({ execFile(_command, _args, _options, callback) { callback(null, '{'); } }), []);
});
