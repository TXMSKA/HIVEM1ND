import { brotliCompressSync } from 'node:zlib';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { countLogicalMessages, decodePack, encodePack, isDeterministicNotice, packFileName, validateHead } from '../engine/sync/pack.mjs';
import { ackPublished, eligibleTargets, observeLocalChange, openSync, readObject, resolveIncoming, stageBaselines, stageTransaction } from '../engine/sync/store.mjs';
import { assertContained, dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';

function syncOf(fixture, projects = []) {
  return openSync({ store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects });
}

function change(target, raw, extra = {}) {
  const hash = raw ? hashBytes(raw) : null;
  return {
    format: 'hivem1nd-change-v1',
    id: extra.id ?? uuidV8(['change', target, hash, extra.at ?? AT]),
    machine: extra.machine ?? 'DESKTOP',
    at: extra.at ?? AT,
    target,
    operation: extra.operation ?? (raw ? 'put' : 'delete'),
    hash: extra.hash === undefined ? hash : extra.hash,
    size: extra.size === undefined ? (raw ? raw.length : 0) : extra.size,
    baseHash: extra.baseHash ?? null,
    messageId: extra.messageId ?? null,
    transactionId: extra.transactionId ?? null,
  };
}

function readFramed(bytes) {
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'H1P3');
  const jsonLength = bytes.readUInt32BE(4);
  const headerBytes = bytes.subarray(8, 8 + jsonLength);
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));
  const payload = bytes.subarray(8 + jsonLength);
  const indexLength = payload.readUInt32BE(0);
  const indexBytes = payload.subarray(4, 4 + indexLength);
  const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(indexBytes));
  return { header, index, blobs: payload.subarray(4 + indexLength), payload, jsonLength, indexLength };
}

function payloadOf(index, blobs) {
  const json = Buffer.from(canonicalJson(index), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, ...blobs]);
}

function finish(index, blobs = [], mutate = (header) => header, suffix = Buffer.alloc(0)) {
  const body = Buffer.concat([payloadOf(index, blobs), suffix]);
  const header = mutate({
    format: 'hivem1nd-pack-v1',
    machine: 'DESKTOP',
    sequence: 1,
    payloadBytes: body.length,
    payloadHash: hashBytes(body),
    encryption: { algorithm: 'none' },
  });
  const json = Buffer.from(canonicalJson(header), 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.write('H1P3', 0, 'ascii');
  prefix.writeUInt32BE(json.length, 4);
  return Buffer.concat([prefix, json, body]);
}

function emptyIndex(changes = [], extra = {}) {
  return {
    format: 'hivem1nd-pack-index-v1',
    compression: 'br',
    objects: [],
    changes,
    dependencies: [],
    transactions: [],
    ...extra,
  };
}

async function tree(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full);
      if (entry.isSymbolicLink()) {
        found.push(`${relative}\0link`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      found.push(relative);
    }
  }
  await walk(root);
  return found.sort();
}

test('pack framing round-trips text, shared bytes and tombstones', () => {
  const shared = Buffer.from('same bytes');
  const hash = hashBytes(shared);
  const accented = Buffer.from('café', 'utf8');
  const accentedHash = hashBytes(accented);
  const first = change({ kind: 'mind', path: 'user/one.txt' }, shared);
  const second = change({ kind: 'mind', path: 'user/two.txt' }, shared, { at: '2026-10-10T12:00:01.000Z' });
  const text = change({ kind: 'mind', path: 'user/café.md' }, accented, { at: '2026-10-10T12:00:02.000Z' });
  const tomb = change({ kind: 'mind', path: 'user/one.txt' }, null, { at: '2026-10-10T12:00:03.000Z' });
  const packed = encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [first, second, text, tomb],
    objects: [{ hash, raw: shared }, { hash: accentedHash, raw: accented }],
  });
  const manual = readFramed(packed);
  assert.equal(manual.jsonLength, Buffer.byteLength(canonicalJson(manual.header)));
  assert.equal(manual.header.payloadBytes, manual.payload.length);
  assert.equal(manual.header.payloadHash, hashBytes(manual.payload));
  assert.equal(manual.header.encryption.algorithm, 'none');
  assert.equal(manual.index.objects.length, 2);
  assert.equal(manual.index.objects[0].offset, 0);
  assert.equal(manual.index.objects[1].offset, manual.index.objects[0].compressedBytes);
  assert.equal(manual.index.changes[2].target.path, 'user/café.md');
  const indexJson = canonicalJson(manual.index);
  assert.ok(Buffer.byteLength(indexJson) > indexJson.length);
  const decoded = decodePack(packed);
  assert.equal(decoded.objects.size, 2);
  assert.deepEqual(decoded.objects.get(hash), shared);
  assert.deepEqual(decoded.objects.get(accentedHash), accented);
  assert.equal(decoded.changes.filter((item) => item.hash === hash).length, 2);
  assert.equal(decoded.changes.find((item) => item.operation === 'delete').hash, null);
  assert.equal(decoded.packHash, hashBytes(packed));
});

test('a non-ASCII outer header is measured in bytes', () => {
  const json = canonicalJson({
    encryption: { algorithm: 'none' },
    format: 'hivem1nd-pack-v1',
    machine: 'CAFÉ',
    payloadBytes: 0,
    payloadHash: 'ab'.repeat(32),
    sequence: 1,
  });
  assert.ok(Buffer.byteLength(json) > json.length);
  const short = Buffer.alloc(8);
  short.write('H1P3', 0, 'ascii');
  short.writeUInt32BE(json.length, 4);
  assert.throws(() => decodePack(Buffer.concat([short, Buffer.from(json)])), (error) => error.code === 'invalid_json' || error.code === 'invalid_pack');
  const full = Buffer.alloc(8);
  full.write('H1P3', 0, 'ascii');
  full.writeUInt32BE(Buffer.byteLength(json), 4);
  assert.throws(() => decodePack(Buffer.concat([full, Buffer.from(json)])), (error) => error.code === 'invalid_name');
});

test('an omitted object is loaded from a committed dependency and stays pending when that pack is missing', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const sync = syncOf(fixture);
  const beforeMind = await tree(fixture.paths.mind);
  const raw = Buffer.from('shared object');
  const hash = hashBytes(raw);
  const base = encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [change({ kind: 'mind', path: 'user/base.txt' }, raw)],
    objects: [{ hash, raw }],
  });
  const later = encodePack({
    machine: 'DESKTOP',
    sequence: 2,
    changes: [change({ kind: 'mind', path: 'user/later.txt' }, raw, { at: '2026-10-10T12:00:04.000Z' })],
    dependencies: [{ hash, machine: 'DESKTOP', sequence: 1, packHash: hashBytes(base) }],
  });
  const decoded = decodePack(later);
  assert.equal(decoded.objects.size, 0);
  assert.equal(decoded.dependencies[0].sequence, 1);
  const head = {
    format: 'hivem1nd-head-v1',
    machine: 'DESKTOP',
    sequence: 1,
    updatedAt: AT,
    packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(base), bytes: base.length }],
  };
  const ready = await resolveIncoming(sync, later, {
    async readHead() { return head; },
    async readPack(_machine, sequence) { return sequence === 1 ? base : null; },
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.objects.get(hash), raw);
  const blocked = await resolveIncoming(sync, later, {
    async readHead() { return head; },
    async readPack() { return null; },
  });
  assert.equal(blocked.status, 'pending');
  const pendingFile = path.join(fixture.paths.localDirectory, 'received', 'pending', 'DESKTOP', '2.json');
  const saved = JSON.parse(await readFile(pendingFile, 'utf8'));
  assert.equal(saved.packHash, hashBytes(later));
  assert.equal(saved.dependencies.length, 1);
  assert.deepEqual(await tree(fixture.paths.mind), beforeMind);
  fixture.clock.now += 5000;
  await resolveIncoming(sync, later, {
    async readHead() { return head; },
    async readPack() { return null; },
  });
  const again = JSON.parse(await readFile(pendingFile, 'utf8'));
  assert.equal(again.firstSeenAt, saved.firstSeenAt);
  await assert.rejects(() => resolveIncoming(sync, later, {
    async readHead() {
      return { ...head, packs: [{ ...head.packs[0], hash: 'ff'.repeat(32) }] };
    },
    async readPack() { return base; },
  }), (error) => error.code === 'corrupt_resource');
});

test('a dependency cycle is rejected and does not become pending', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const sync = syncOf(fixture);
  const packB = encodePack({
    machine: 'DESKTOP',
    sequence: 2,
    changes: [change({ kind: 'mind', path: 'user/from-b.txt' }, null)],
    dependencies: [{ hash: 'ab'.repeat(32), machine: 'DESKTOP', sequence: 1, packHash: 'cd'.repeat(32) }],
  });
  const packA = encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [change({ kind: 'mind', path: 'user/from-a.txt' }, null, { at: '2026-10-10T12:00:05.000Z' })],
    dependencies: [{ hash: 'ef'.repeat(32), machine: 'DESKTOP', sequence: 2, packHash: hashBytes(packB) }],
  });
  const head = {
    format: 'hivem1nd-head-v1',
    machine: 'DESKTOP',
    sequence: 2,
    updatedAt: AT,
    packs: [
      { sequence: 1, file: packFileName(1), hash: hashBytes(packA), bytes: packA.length },
      { sequence: 2, file: packFileName(2), hash: hashBytes(packB), bytes: packB.length },
    ],
  };
  const before = await tree(fixture.paths.localDirectory);
  await assert.rejects(() => resolveIncoming(sync, packA, {
    async readHead() { return head; },
    async readPack(_machine, sequence) { return sequence === 1 ? packA : packB; },
  }), (error) => error.code === 'invalid_pack');
  assert.deepEqual(await tree(fixture.paths.localDirectory), before);
});

test('invalid packs are rejected before any file is written', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const before = await tree(fixture.root);
  const raw = Buffer.from('payload');
  const hash = hashBytes(raw);
  const validChange = change({ kind: 'mind', path: 'user/file.txt' }, raw);
  const valid = encodePack({ machine: 'DESKTOP', sequence: 1, changes: [validChange], objects: [{ hash, raw }] });
  const framed = readFramed(valid);
  const tomb = change({ kind: 'mind', path: 'user/file.txt' }, null);
  const splitId = uuidV8(['missing-member']);
  const splitChange = change({ kind: 'mind', path: 'user/file.txt' }, null, { transactionId: uuidV8(['group']) });
  const cases = [
    ['truncated length', Buffer.concat([Buffer.from('H1P3'), Buffer.from([0xff, 0xff, 0xff, 0xff])]), 'invalid_pack'],
    ['trailing blob', finish(framed.index, [framed.blobs], (header) => header, Buffer.from([0])), 'invalid_pack'],
    ['overlapping blobs', finish({
      format: 'hivem1nd-pack-index-v1',
      compression: 'br',
      objects: [
        { hash: 'aa'.repeat(32), offset: 0, compressedBytes: 12, rawBytes: 4 },
        { hash: 'bb'.repeat(32), offset: 6, compressedBytes: 12, rawBytes: 4 },
      ],
      changes: [],
      dependencies: [],
      transactions: [],
    }, [Buffer.alloc(18)]), 'invalid_pack'],
    ['hash corruption', finish({
      ...framed.index,
      objects: [{ ...framed.index.objects[0], hash: 'ab'.repeat(32) }],
      changes: [{ ...framed.index.changes[0], hash: 'ab'.repeat(32) }],
    }, [framed.blobs]), 'corrupt_resource'],
    ['decompression bomb', (() => {
      const bombRaw = Buffer.alloc(1000, 7);
      const bomb = encodePack({
        machine: 'DESKTOP',
        sequence: 1,
        changes: [change({ kind: 'mind', path: 'user/bomb.txt' }, bombRaw, { at: '2026-10-10T12:00:09.000Z' })],
        objects: [{ hash: hashBytes(bombRaw), raw: bombRaw }],
      });
      const bombFramed = readFramed(bomb);
      return finish({
        ...bombFramed.index,
        objects: [{ ...bombFramed.index.objects[0], rawBytes: 10 }],
        changes: [{ ...bombFramed.index.changes[0], size: 10 }],
      }, [bombFramed.blobs]);
    })(), 'resource_too_large'],
    ['split transaction', finish(emptyIndex([splitChange], {
      transactions: [{ id: splitChange.transactionId, changeIds: [splitChange.id, splitId] }],
    })), 'invalid_pack'],
    ['unknown target', finish(emptyIndex([{ ...tomb, target: { kind: 'disk', path: 'C:/secret' } }])), 'invalid_pack'],
    ['requested encryption', finish(emptyIndex([tomb]), [], (header) => ({ ...header, encryption: { algorithm: 'aes-256-gcm', keyId: 'k', nonce: 'n', tag: 't' } })), 'unsupported_origin'],
    ['quantum configuration', finish(emptyIndex([tomb]), [], (header) => ({ ...header, quantum: true })), 'unsupported_origin'],
  ];
  for (const [name, bytes, code] of cases) {
    assert.throws(() => decodePack(bytes), (error) => {
      assert.equal(error.code, code, name);
      return true;
    });
  }
  assert.throws(() => encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [tomb],
    encryption: { algorithm: 'aes-256-gcm', keyId: 'k', nonce: 'n', tag: 't' },
  }), (error) => error.code === 'unsupported_origin');
  const expanded = brotliCompressSync(Buffer.alloc(1000, 7));
  assert.ok(expanded.length < 1000);
  assert.deepEqual(await tree(fixture.root), before);
});

test('logical message counts use canonical records and ignore forged notice claims', () => {
  const noticeId = uuidV8(['notice', 'publication', '2026-10-10T12', 'paused']);
  const notice = Buffer.from(`id: ${noticeId}\nkind: chat-notice\nphase: publication\nwindow: 2026-10-10T12\nsubject: paused\nresource-id: ${noticeId}\nnotice-key: ${noticeId}:\n\nPaused\n`);
  assert.equal(isDeterministicNotice({ id: noticeId, kind: 'chat-notice', phase: 'publication', window: '2026-10-10T12', subject: 'paused' }), true);
  assert.equal(isDeterministicNotice({ id: noticeId, kind: 'notice', phase: 'publication', window: '2026-10-10T12', subject: 'paused' }), false);
  const forgedId = uuidV8(['forged-notice']);
  const forged = Buffer.from(`id: ${forgedId}\nkind: notice\nphase: publication\nwindow: 2026-10-10T12\nsubject: paused\n\nForged\n`);
  const commentId = uuidV8(['comment', 1]);
  const proposalId = uuidV8(['proposal', 1]);
  const comments = Buffer.from(JSON.stringify({
    threads: [{ messages: [{ id: commentId, proposal: { id: proposalId } }, { id: commentId }] }],
  }));
  const objects = [
    { hash: hashBytes(notice), raw: notice },
    { hash: hashBytes(forged), raw: forged },
    { hash: hashBytes(comments), raw: comments },
  ];
  const packed = encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [
      change({ kind: 'mind', path: 'user/inbox/master/notice.md' }, notice, { messageId: 'ignore-notice' }),
      change({ kind: 'mind', path: 'user/inbox/master/forged.md' }, forged, { messageId: 'ignore-forged', at: '2026-10-10T12:00:01.000Z' }),
      change({ kind: 'mind', path: 'user/inbox/master/forged-copy.md' }, forged, { messageId: 'still-ignored', at: '2026-10-10T12:00:02.000Z' }),
      change({ kind: 'project', project: 'shop', path: 'docs/flows/comments/cart.json' }, comments, { messageId: null, at: '2026-10-10T12:00:03.000Z' }),
    ],
    objects,
  });
  assert.equal(countLogicalMessages(decodePack(packed)), 3);
  const chatId = '11111111-1111-4111-8111-111111111111';
  const chat = Buffer.from(`\n\nlegacy\n`);
  const chatPack = encodePack({
    machine: 'DESKTOP',
    sequence: 1,
    changes: [change({ kind: 'mind', path: `user/relay/chats/room/${chatId}.md` }, chat, { messageId: null, at: '2026-10-10T12:00:04.000Z' })],
    objects: [{ hash: hashBytes(chat), raw: chat }],
  });
  assert.equal(countLogicalMessages(decodePack(chatPack)), 1);
  assert.equal(countLogicalMessages(decodePack(chatPack), new Set([chatId])), 0);
  const huge = Buffer.alloc(1000001, 0x61);
  assert.throws(() => countLogicalMessages({
    changes: [{ operation: 'put', hash: 'aa', target: { kind: 'mind', path: 'user/inbox/master/big.md' } }],
    objects: new Map([['aa', huge]]),
  }), { code: 'message_too_large' });
});

test('a head rejects regression and a changed committed hash', () => {
  const packs = [{ sequence: 1, file: packFileName(1), hash: 'ab'.repeat(32), bytes: 40 }];
  const head = validateHead({ format: 'hivem1nd-head-v1', machine: 'DESKTOP', sequence: 1, updatedAt: AT, packs });
  assert.throws(() => validateHead({
    format: 'hivem1nd-head-v1',
    machine: 'DESKTOP',
    sequence: 1,
    updatedAt: AT,
    packs: [{ ...packs[0], hash: 'cd'.repeat(32) }],
  }, { previous: head }), (error) => error.code === 'corrupt_resource');
  assert.throws(() => validateHead({
    format: 'hivem1nd-head-v1',
    machine: 'DESKTOP',
    sequence: 0,
    updatedAt: AT,
    packs: [],
  }, { previous: head }), (error) => error.code === 'invalid_pack');
});

test('staging keeps distinct paths, baselines, eligible records and import markers', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const mind = fixture.paths.mind;
  const shop = path.join(fixture.root, 'shop');
  await mkdir(path.join(mind, 'user', 'gui'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'relay', 'sessions'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'relay', 'leases'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'relay', 'credentials'), { recursive: true });
  await mkdir(path.join(mind, 'engine'), { recursive: true });
  await mkdir(path.join(shop, 'docs', 'flows', 'boards'), { recursive: true });
  await mkdir(path.join(shop, 'docs', 'flows', 'comments'), { recursive: true });
  await mkdir(path.join(shop, 'docs', 'flows', 'assets'), { recursive: true });
  await mkdir(path.join(shop, 'gui'), { recursive: true });
  await mkdir(path.join(shop, '.git'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'gui', 'layout.json'), '{"version":1}\n');
  await writeFile(path.join(mind, 'user', 'draft.txt'), 'draft');
  await writeFile(path.join(mind, 'user', 'credentials.json'), 'secret');
  await writeFile(path.join(mind, 'user', 'page.tmp'), 'temp');
  await writeFile(path.join(mind, 'user', 'notes.conflict-DESKTOP-20261010T120000000Z'), 'lost');
  await writeFile(path.join(mind, 'user', 'relay', 'sessions', 'session.json'), '{}');
  const registrationId = uuidV8(['registration', 'shop']);
  const registrationPath = `user/relay/sessions/${registrationId}.json`;
  const registration = {
    kind: 'registration', registrationId, sessionId: uuidV8(['session', 'shop']), unitId: 'project:shop:executor-shop',
    client: 'codex', machine: 'DESKTOP', endpoint: '\\\\.\\pipe\\secret', credential: 'hidden',
  };
  await writeFile(path.join(mind, 'user', 'relay', 'sessions', `${registrationId}.json`), `${JSON.stringify(registration)}\n`);
  await writeFile(path.join(mind, 'user', 'relay', 'leases', 'lease.json'), '{"pid":4}\n');
  await writeFile(path.join(mind, 'user', 'relay', 'credentials', 'token.json'), '{"token":"no"}\n');
  await writeFile(path.join(mind, 'engine', 'kit.mjs'), 'kit');
  await writeFile(path.join(shop, '.git', 'config'), 'git');
  await writeFile(path.join(shop, 'readme.md'), 'no');
  await writeFile(path.join(mind, 'user', 'gui', 'resources.json'), `${JSON.stringify({
    format: 'hivem1nd-resources-v1',
    resources: [{ id: uuidV8(['editor', 'blueprint', 'shop', 'docs/flows/boards/cart.json']), kind: 'blueprint', project: 'shop', path: 'docs/flows/boards/cart.json', legacyId: 'cart' }],
  })}\n`);
  await writeFile(path.join(shop, 'gui', 'resources.json'), '{"format":"hivem1nd-resources-v1","resources":[{"project":"shop","path":"readme.md"}]}\n');
  await writeFile(path.join(shop, 'docs', 'flows', 'boards', 'cart.json'), '{"src":"docs/flows/assets/logo.png"}\n');
  await writeFile(path.join(shop, 'docs', 'flows', 'comments', 'cart.json'), '{}\n');
  await writeFile(path.join(shop, 'docs', 'flows', 'assets', 'logo.png'), Buffer.from([137, 80, 78, 71]));
  const outside = path.join(fixture.root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'no');
  await symlink(outside, path.join(mind, 'user', 'linked'), 'junction');
  const sync = syncOf(fixture, [{ name: 'shop', localPath: shop, eligible: true }]);
  const eligible = (await eligibleTargets(sync)).map((target) => `${target.kind}:${target.project ?? ''}:${target.path}`);
  assert.deepEqual(eligible.filter((item) => item.startsWith('project:')).sort(), [
    'project:shop:docs/flows/assets/logo.png',
    'project:shop:docs/flows/boards/cart.json',
    'project:shop:docs/flows/comments/cart.json',
  ].sort());
  assert.ok(eligible.includes('mind::user/gui/layout.json'));
  assert.ok(eligible.includes('mind::user/gui/resources.json'));
  assert.ok(eligible.includes('mind::user/draft.txt'));
  assert.ok(eligible.includes(`mind::${registrationPath}`));
  assert.equal(eligible.some((item) => item.includes('credentials') || item.includes('.tmp') || item.includes('conflict') || item.endsWith('session.json') || item.includes('leases') || item.includes('kit') || item.includes('readme') || item.includes('linked') || item.includes('.git')), false);
  const observed = await observeLocalChange(sync, { kind: 'mind', path: registrationPath }, { bytes: await readFile(path.join(mind, registrationPath)) });
  assert.equal(observed.staged, true);
  const stored = JSON.parse((await readObject(sync, observed.change.hash)).toString('utf8'));
  assert.equal(stored.kind, 'registration');
  assert.equal(stored.endpoint, undefined);
  assert.equal(stored.credential, undefined);
  const raw = Buffer.from('same');
  const transactionId = uuidV8(['transaction', 'pair']);
  const staged = await stageTransaction(sync, [
    { target: { kind: 'mind', path: 'user/left.txt' }, bytes: raw },
    { target: { kind: 'mind', path: 'user/right.txt' }, bytes: raw },
  ], { transactionId });
  assert.equal(staged.length, 2);
  assert.notEqual(staged[0].id, staged[1].id);
  assert.equal(staged[0].hash, staged[1].hash);
  assert.equal(staged[0].transactionId, transactionId);
  assert.deepEqual(await readObject(sync, staged[0].hash), raw);
  const objects = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'objects'));
  assert.equal(objects.length, 2);
  const [tomb] = await stageTransaction(sync, [{ target: { kind: 'mind', path: 'user/left.txt' }, deleted: true }]);
  assert.equal(tomb.operation, 'delete');
  assert.equal(tomb.hash, null);
  assert.equal((await readdir(path.join(fixture.paths.localDirectory, 'staging', 'objects'))).length, 2);
  const baselines = await stageBaselines(sync);
  assert.ok(baselines.length >= 4);
  const again = await stageBaselines(sync);
  assert.equal(again.length, 0);
  const layout = { kind: 'mind', path: 'user/gui/layout.json' };
  const imported = Buffer.from('{"version":2}\n');
  const winnerId = uuidV8(['winner', 'layout']);
  const winnerAt = '2026-10-10T11:00:00.000Z';
  const marked = await observeLocalChange(sync, layout, { bytes: imported, applied: true, at: winnerAt, machine: 'BRAVO', id: winnerId });
  assert.equal(marked.staged, false);
  const held = await observeLocalChange(sync, layout, { bytes: Buffer.from('local edit') });
  assert.equal(held.held, true);
  assert.equal(held.staged, false);
  const cleared = await observeLocalChange(sync, layout, { bytes: imported });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.staged, true);
  const versions = JSON.parse(await readFile(path.join(fixture.paths.localDirectory, 'sync-versions.json'), 'utf8'));
  const winner = Object.values(versions.targets).find((item) => item.id === winnerId);
  assert.equal(winner.at, winnerAt);
  assert.equal(winner.machine, 'BRAVO');
  assert.equal(winner.hash, hashBytes(imported));
  const edited = await observeLocalChange(sync, layout, { bytes: Buffer.from('local edit') });
  assert.equal(edited.unchanged, true);
  await ackPublished(sync, [staged[0].id, staged[1].id]);
  const names = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'changes'));
  assert.equal(names.includes(`${staged[0].id}.json`), false);
  assert.equal(names.includes(`${tomb.id}.json`), true);
  const acked = await readdir(path.join(fixture.paths.localDirectory, 'staging', 'acked'));
  assert.equal(acked.length, 2);
  await assert.rejects(() => stageTransaction(sync, [{ target: { kind: 'mind', path: 'user/credentials.json' }, bytes: Buffer.from('x') }]), (error) => error.code === 'invalid_pack');
  assertContained(fixture);
});
