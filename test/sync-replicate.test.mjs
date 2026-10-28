import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { openOrigin } from '../engine/sync/origin.mjs';
import { decodePack, encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport, replicate } from '../engine/sync/replicate.mjs';
import { assertContained, dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const EMPTY = { pushed: 0, pulled: 0, headsPushed: 0, headsPulled: 0 };

function mirror(fixture, machine) {
  return openOrigin({
    store: fixture.store,
    paths: { ...fixture.paths, origin: path.join(fixture.root, machine) },
    machine,
  });
}

function folder(origin, keyProvider = null) {
  return openFolderTransport({ directory: origin.paths.origin, store: origin.store, keyProvider });
}

function packed(machine, sequence, text = `${machine}:${sequence}`, options = {}) {
  const raw = Buffer.from(text);
  const hash = hashBytes(raw);
  return encodePack({
    machine,
    sequence,
    changes: [{
      format: 'hivem1nd-change-v1', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      id: uuidV8(['replicate', machine, sequence, hash]),
      machine,
      at: AT,
      target: { kind: 'mind', path: `user/${machine.toLowerCase()}.md` },
      operation: 'put',
      hash,
      size: raw.length,
      baseHash: null,
      messageId: null,
      transactionId: null,
    }],
    objects: [{ hash, raw }],
    ...options,
  });
}

function headed(machine, packs) {
  return {
    format: 'hivem1nd-head-v1', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    machine,
    sequence: packs.length,
    updatedAt: AT,
    packs: packs.map((bytes, index) => ({ sequence: index + 1, file: packFileName(index + 1), hash: hashBytes(bytes), bytes: bytes.length })),
  };
}

async function seed(transport, machine, count, options = {}) {
  const packs = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const bytes = packed(machine, sequence, `${machine}:${sequence}`, options);
    packs.push(bytes);
    await transport.writePack(machine, sequence, bytes);
  }
  const head = headed(machine, packs);
  await transport.writeHead(head);
  return { head, packs };
}

function packPath(origin, machine, sequence) {
  return path.join(origin.paths.origin, 'machines', machine, 'packs', packFileName(sequence));
}

function headPath(origin, machine) {
  return path.join(origin.paths.origin, 'machines', machine, 'head.json');
}

test('replication unions three machines and forwards cached packs without changing bytes', async () => {
  const fixture = await makeCoreFixture();
  try {
    const desktop = mirror(fixture, 'DESKTOP');
    const laptop = mirror(fixture, 'LAPTOP');
    const scout = mirror(fixture, 'SCOUT');
    const seeds = new Map();
    for (const origin of [desktop, laptop, scout]) seeds.set(origin.machine, await seed(folder(origin), origin.machine, 2));
    assert.deepEqual(await replicate({ origin: desktop, transport: folder(laptop) }), { pushed: 2, pulled: 2, headsPushed: 1, headsPulled: 1 });
    assert.deepEqual(await replicate({ origin: scout, transport: folder(laptop) }), { pushed: 2, pulled: 4, headsPushed: 1, headsPulled: 2 });
    assert.deepEqual(await replicate({ origin: desktop, transport: folder(laptop) }), { pushed: 0, pulled: 2, headsPushed: 0, headsPulled: 1 });
    for (const origin of [desktop, laptop, scout]) {
      assert.deepEqual((await folder(origin).listHeads()).map((head) => head.machine), ['DESKTOP', 'LAPTOP', 'SCOUT']);
      for (const [machine, published] of seeds) {
        assert.deepEqual(JSON.parse(await readFile(headPath(origin, machine), 'utf8')), published.head);
        for (let sequence = 1; sequence <= 2; sequence += 1) assert.deepEqual(await folder(origin).readPack(machine, sequence), published.packs[sequence - 1]);
      }
    }
    assert.deepEqual(await replicate({ origin: desktop, transport: folder(laptop) }), EMPTY);
    assertContained(fixture);
  } finally {
    await dispose(fixture);
  }
});

test('replication publishes owned history before waiting for a stalled foreign history', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'SCOUT');
    const remote = mirror(fixture, 'HOST');
    await seed(folder(local), 'SCOUT', 1);
    await seed(folder(remote), 'LAPTOP', 1);
    const transport = folder(remote);
    const readPack = transport.readPack;
    let release, entered, waiting = false;
    const blocked = new Promise(resolve => { release = resolve; });
    const reading = new Promise(resolve => { entered = resolve; });
    transport.readPack = async (machine, sequence) => {
      if (machine === 'LAPTOP') { waiting = true; entered(); await blocked; }
      return readPack(machine, sequence);
    };
    const pending = replicate({ origin: local, transport });
    try {
      await Promise.race([reading, pending]);
      assert.equal(waiting, true);
      assert.equal((await folder(remote).listHeads()).some(head => head.machine === 'SCOUT'), true);
    } finally {
      release();
      await pending;
    }
  } finally {
    await dispose(fixture);
  }
});

test('replication never pulls a machine own history from an ahead transport', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    await seed(folder(local), 'DESKTOP', 1);
    const published = await seed(folder(remote), 'DESKTOP', 2);
    await seed(folder(remote), 'SCOUT', 1);
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), { pushed: 0, pulled: 1, headsPushed: 0, headsPulled: 1 });
    assert.equal(await folder(local).readPack('DESKTOP', 2), null);
    assert.equal((await folder(local).listHeads()).find((head) => head.machine === 'DESKTOP').sequence, 1);
    assert.deepEqual(JSON.parse(await readFile(headPath(remote, 'DESKTOP'), 'utf8')), published.head);
    const fresh = mirror(fixture, 'SCOUT');
    assert.deepEqual(await replicate({ origin: fresh, transport: folder(remote) }), { pushed: 0, pulled: 2, headsPushed: 0, headsPulled: 1 });
    assert.equal(await folder(fresh).readPack('SCOUT', 1), null);
  } finally {
    await dispose(fixture);
  }
});

test('replication refuses a corrupt advertised pack and retries when its bytes recover', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const published = await seed(folder(remote), 'SCOUT', 1);
    const corrupt = Buffer.from(published.packs[0]);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(packPath(remote, 'SCOUT', 1), corrupt);
    await assert.rejects(replicate({ origin: local, transport: folder(remote) }), { code: 'corrupt_resource' });
    assert.deepEqual(await folder(local).listHeads(), []);
    assert.equal(await folder(local).readPack('SCOUT', 1), null);
    await writeFile(packPath(remote, 'SCOUT', 1), published.packs[0]);
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), { pushed: 0, pulled: 1, headsPushed: 0, headsPulled: 1 });
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), EMPTY);
  } finally {
    await dispose(fixture);
  }
});

test('missing packs refuse head publication and a restart resumes after a partial copy', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const published = await seed(folder(remote), 'SCOUT', 3);
    await unlink(packPath(remote, 'SCOUT', 2));
    await assert.rejects(replicate({ origin: local, transport: folder(remote) }), { code: 'missing_pack' });
    assert.deepEqual(await folder(local).listHeads(), []);
    assert.deepEqual(await folder(local).readPack('SCOUT', 1), published.packs[0]);
    assert.equal(await folder(local).readPack('SCOUT', 3), null);
    await writeFile(packPath(remote, 'SCOUT', 2), published.packs[1]);
    const restarted = mirror(fixture, 'DESKTOP');
    assert.deepEqual(await replicate({ origin: restarted, transport: folder(remote) }), { pushed: 0, pulled: 2, headsPushed: 0, headsPulled: 1 });
    assert.deepEqual(await replicate({ origin: restarted, transport: folder(remote) }), EMPTY);
  } finally {
    await dispose(fixture);
  }
});

test('a host change during a pack read refuses the stale pass and the next host resumes the union', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const oldHost = mirror(fixture, 'OLD');
    const newHost = mirror(fixture, 'NEW');
    await seed(folder(local), 'DESKTOP', 1);
    await seed(folder(oldHost), 'LAPTOP', 2);
    await seed(folder(newHost), 'LAPTOP', 2);
    await seed(folder(newHost), 'SCOUT', 1);
    const previous = folder(oldHost);
    const next = folder(newHost);
    let current = previous;
    const readPack = previous.readPack;
    previous.readPack = async (machine, sequence) => {
      const bytes = await readPack(machine, sequence);
      if (machine === 'LAPTOP' && sequence === 2) current = next;
      return bytes;
    };
    const getTransport = () => current;
    await assert.rejects(replicate({ origin: local, getTransport }), { code: 'transport_changed' });
    assert.equal((await folder(local).listHeads()).some((head) => head.machine === 'LAPTOP'), false);
    assert.notEqual(await folder(local).readPack('LAPTOP', 1), null);
    assert.equal(await folder(local).readPack('LAPTOP', 2), null);
    assert.deepEqual(await replicate({ origin: local, getTransport }), { pushed: 1, pulled: 2, headsPushed: 1, headsPulled: 2 });
    assert.deepEqual((await folder(newHost).listHeads()).map((head) => head.machine), ['DESKTOP', 'LAPTOP', 'SCOUT']);
    assert.deepEqual(await replicate({ origin: local, getTransport }), EMPTY);
  } finally {
    await dispose(fixture);
  }
});

test('a host change during a pack write leaves the old host head unpublished', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const oldHost = mirror(fixture, 'OLD');
    const newHost = mirror(fixture, 'NEW');
    const published = await seed(folder(local), 'DESKTOP', 1);
    const previous = folder(oldHost);
    const next = folder(newHost);
    let current = previous;
    const writePack = previous.writePack;
    previous.writePack = async (...args) => {
      const result = await writePack(...args);
      current = next;
      return result;
    };
    const getTransport = () => current;
    await assert.rejects(replicate({ origin: local, getTransport }), { code: 'transport_changed' });
    assert.deepEqual(await folder(oldHost).listHeads(), []);
    assert.deepEqual(await folder(oldHost).readPack('DESKTOP', 1), published.packs[0]);
    assert.deepEqual(await replicate({ origin: local, getTransport }), { pushed: 1, pulled: 0, headsPushed: 1, headsPulled: 0 });
    assert.deepEqual(await folder(newHost).listHeads(), [published.head]);
  } finally {
    await dispose(fixture);
  }
});

test('replication detects corrupt committed destination bytes even when both heads agree', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const published = await seed(folder(remote), 'SCOUT', 1);
    await replicate({ origin: local, transport: folder(remote) });
    const corrupt = Buffer.from(published.packs[0]);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(packPath(local, 'SCOUT', 1), corrupt);
    await assert.rejects(replicate({ origin: local, transport: folder(remote) }), { code: 'corrupt_resource' });
    assert.deepEqual(await readFile(packPath(local, 'SCOUT', 1)), corrupt);
    await writeFile(packPath(local, 'SCOUT', 1), published.packs[0]);
    await writeFile(packPath(remote, 'SCOUT', 1), corrupt);
    await assert.rejects(replicate({ origin: local, transport: folder(remote) }), { code: 'corrupt_resource' });
  } finally {
    await dispose(fixture);
  }
});

test('replication restores missing committed packs without replacing their unchanged heads', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const published = await seed(folder(remote), 'SCOUT', 2);
    await replicate({ origin: local, transport: folder(remote) });
    await unlink(packPath(local, 'SCOUT', 1));
    await unlink(packPath(remote, 'SCOUT', 2));
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), { pushed: 1, pulled: 1, headsPushed: 0, headsPulled: 0 });
    assert.deepEqual(await folder(local).readPack('SCOUT', 1), published.packs[0]);
    assert.deepEqual(await folder(remote).readPack('SCOUT', 2), published.packs[1]);
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), EMPTY);
  } finally {
    await dispose(fixture);
  }
});

test('an interrupted uncommitted corrupt pack can be replaced but a valid immutable collision refuses', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const published = await seed(folder(remote), 'SCOUT', 2);
    await folder(local).writePack('SCOUT', 1, published.packs[0]);
    await writeFile(packPath(local, 'SCOUT', 1), Buffer.from('interrupted bytes'));
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote) }), { pushed: 0, pulled: 2, headsPushed: 0, headsPulled: 1 });
    const other = mirror(fixture, 'OTHER');
    const conflicting = packed('SCOUT', 1, 'different valid bytes');
    await folder(other).writePack('SCOUT', 1, conflicting);
    await assert.rejects(replicate({ origin: other, transport: folder(remote) }), { code: 'revision_conflict' });
    assert.deepEqual(await folder(other).readPack('SCOUT', 1), conflicting);
    assert.deepEqual(await folder(other).listHeads(), []);
  } finally {
    await dispose(fixture);
  }
});

test('changed immutable head commitments and incomplete sequence histories refuse before copying', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    await seed(folder(local), 'SCOUT', 1);
    const other = packed('SCOUT', 1, 'different committed bytes');
    await folder(remote).writePack('SCOUT', 1, other);
    await folder(remote).writeHead(headed('SCOUT', [other]));
    await assert.rejects(replicate({ origin: local, transport: folder(remote) }), { code: 'corrupt_resource' });
    const missingHistory = headed('LAPTOP', [packed('LAPTOP', 1), packed('LAPTOP', 2)]);
    missingHistory.packs.shift();
    const transport = { ...folder(remote), async listHeads() { return [missingHistory]; } };
    await assert.rejects(replicate({ origin: local, transport }), { code: 'invalid_pack' });
  } finally {
    await dispose(fixture);
  }
});

test('pack lengths, owners and sequences must match their advertised head', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    for (const [name, bytes, edit, code] of [
      ['length', packed('SCOUT', 1), (head) => { head.packs[0].bytes += 1; }, 'corrupt_resource'],
      ['owner', packed('LAPTOP', 1), () => {}, 'invalid_record_owner'],
      ['sequence', packed('SCOUT', 2), () => {}, 'corrupt_resource'],
    ]) {
      const head = headed('SCOUT', [bytes]);
      edit(head);
      const transport = {
        async listHeads() { return [head]; },
        async readPack() { return bytes; },
        async writePack() { assert.fail(`Unexpected ${name} pack write.`); },
        async writeHead() { assert.fail(`Unexpected ${name} head write.`); },
      };
      await assert.rejects(replicate({ origin: local, transport }), { code });
      assert.deepEqual(await folder(local).listHeads(), []);
    }
  } finally {
    await dispose(fixture);
  }
});

test('folder transport refuses heads before all verified packs and refuses immutable rewrites', async () => {
  const fixture = await makeCoreFixture();
  try {
    const origin = mirror(fixture, 'DESKTOP');
    const transport = folder(origin);
    const first = packed('SCOUT', 1);
    const second = packed('SCOUT', 2);
    await assert.rejects(transport.writeHead(headed('SCOUT', [first, second])), { code: 'missing_pack' });
    assert.deepEqual(await transport.listHeads(), []);
    await transport.writePack('SCOUT', 1, first);
    await transport.writeHead(headed('SCOUT', [first]));
    await assert.rejects(transport.writePack('SCOUT', 1, packed('SCOUT', 1, 'replacement')), { code: 'corrupt_resource' });
    await assert.rejects(transport.writePack('SCOUT', 2, first), { code: 'corrupt_resource' });
    await transport.writePack('SCOUT', 2, second);
    await transport.writeHead(headed('SCOUT', [first, second]));
    assert.equal(await transport.writeHead(headed('SCOUT', [first])), false);
    assert.equal(await transport.writePack('SCOUT', 2, second), false);
    const changed = headed('SCOUT', [packed('SCOUT', 1, 'changed'), second]);
    await assert.rejects(transport.writeHead(changed), { code: 'corrupt_resource' });
  } finally {
    await dispose(fixture);
  }
});

test('replication validates encrypted packs with its key provider and preserves ciphertext', async () => {
  const fixture = await makeCoreFixture();
  try {
    const local = mirror(fixture, 'DESKTOP');
    const remote = mirror(fixture, 'HOST');
    const key = Buffer.alloc(32, 7);
    const keyProvider = (keyId) => keyId === 'relan-key' ? key : null;
    const options = { encryption: { algorithm: 'aes-256-gcm', keyId: 'relan-key' }, keyProvider };
    const published = await seed(folder(remote, keyProvider), 'SCOUT', 1, options);
    await assert.rejects(replicate({ origin: local, transport: folder(remote, keyProvider) }), { code: 'encryption_key_missing' });
    assert.deepEqual(await folder(local).listHeads(), []);
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote, keyProvider), keyProvider }), { pushed: 0, pulled: 1, headsPushed: 0, headsPulled: 1 });
    const copied = await folder(local).readPack('SCOUT', 1);
    assert.deepEqual(copied, published.packs[0]);
    assert.equal(decodePack(copied, { keyProvider }).header.encryption.algorithm, 'aes-256-gcm');
    assert.deepEqual(await replicate({ origin: local, transport: folder(remote, keyProvider), keyProvider }), EMPTY);
    assert.equal(await readFile(headPath(local, 'SCOUT'), 'utf8'), `${canonicalJson(published.head)}\n`);
  } finally {
    await dispose(fixture);
  }
});

test('concurrent folder adapters preserve the newer complete head', async () => {
  const fixture = await makeCoreFixture();
  try {
    const origin = mirror(fixture, 'DESKTOP');
    const first = folder(origin);
    const second = folder(origin);
    const packs = [packed('SCOUT', 1), packed('SCOUT', 2)];
    for (let sequence = 1; sequence <= packs.length; sequence += 1) await first.writePack('SCOUT', sequence, packs[sequence - 1]);
    assert.deepEqual(await Promise.all([
      first.writeHead(headed('SCOUT', packs)),
      second.writeHead(headed('SCOUT', packs.slice(0, 1))),
      second.writeHead(headed('SCOUT', packs)),
    ]), [true, false, false]);
    assert.deepEqual(await first.listHeads(), [headed('SCOUT', packs)]);
  } finally {
    await dispose(fixture);
  }
});

test('concurrent conflicting pack writes preserve the first bytes and leave the queue retryable', async () => {
  const fixture = await makeCoreFixture();
  try {
    const origin = mirror(fixture, 'DESKTOP');
    const first = folder(origin);
    const second = folder(origin);
    const original = packed('SCOUT', 1);
    const conflicting = packed('SCOUT', 1, 'competing writer');
    const results = await Promise.allSettled([
      first.writePack('SCOUT', 1, original),
      second.writePack('SCOUT', 1, conflicting),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, 'revision_conflict');
    assert.deepEqual(await first.readPack('SCOUT', 1), original);
    assert.equal(await second.writePack('SCOUT', 2, packed('SCOUT', 2)), true);
    assert.equal(await first.writeHead(headed('SCOUT', [original, packed('SCOUT', 2)])), true);
    assertContained(fixture);
  } finally {
    await dispose(fixture);
  }
});

test('folder transport refuses links in a pack parent before reading or writing', async (t) => {
  const fixture = await makeCoreFixture();
  try {
    const origin = mirror(fixture, 'DESKTOP');
    const transport = folder(origin);
    const outside = path.join(fixture.root, 'outside');
    const directory = path.dirname(packPath(origin, 'SCOUT', 1));
    await mkdir(outside, { recursive: true });
    await mkdir(path.dirname(directory), { recursive: true });
    const bytes = packed('SCOUT', 1);
    await writeFile(path.join(outside, packFileName(1)), bytes);
    try {
      await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('The platform does not allow fixture links.');
        return;
      }
      throw error;
    }
    await assert.rejects(transport.readPack('SCOUT', 1), { code: 'unsafe_path' });
    await assert.rejects(transport.writePack('SCOUT', 1, bytes), { code: 'unsafe_path' });
    assert.deepEqual(await readFile(path.join(outside, packFileName(1))), bytes);
    assertContained(fixture);
  } finally {
    await dispose(fixture);
  }
});
