import assert from 'node:assert/strict';
import { createCipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RelayPlusError } from '../engine/relay-plus/client.mjs';
import { approvalCode, approvalCommitment, approvalLabel, createApprovalRequester, formatApprovalCode, openApprovalEnvelope, usablePublicKey } from '../engine/relay-plus/approval.mjs';

const vectors = JSON.parse(await readFile(new URL('./fixtures/cosmic-keys-vectors.json', import.meta.url), 'utf8'));
const approval = vectors.approval;
const source = await readFile(new URL('../engine/relay-plus/approval.mjs', import.meta.url), 'utf8');

function clock(start = 1_000) {
  let time = start;
  return { now: () => time, async wait(ms) { time += ms; }, advance(ms) { time += ms; } };
}
function seedKey(hex) {
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' });
}
function rawPublic(key) {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32);
}

// Test-only approver. It does not call production offer or approve code.
function sealForRequester(key, transcript, iv) {
  const privateKey = seedKey(approval.approver.privateSeedHex);
  const secret = diffieHellman({ privateKey, publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), transcript.requesterPublic]), format: 'der', type: 'spki' }) });
  const wrapping = Buffer.from(hkdfSync('sha256', secret, Buffer.concat([transcript.requesterPublic, transcript.approverPublic, transcript.requesterNonce, transcript.approverNonce]), Buffer.from('cosmic-key-approval-v1'), 32));
  secret.fill(0);
  const cipher = createCipheriv('aes-256-gcm', wrapping, iv);
  const aad = JSON.stringify(['cosmic-key-approval-v1', transcript.accountId, transcript.id, transcript.requesterPublic.toString('base64'), transcript.approverPublic.toString('base64'), transcript.requesterNonce.toString('base64'), transcript.approverNonce.toString('base64')]);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  wrapping.fill(0);
  return Buffer.concat([Buffer.from([1]), iv, ciphertext]).toString('base64');
}

test('frozen approval transcript matches requester commitment, code and opened K', () => {
  assert.equal(source.includes('/offer'), false);
  assert.equal(source.includes('/approve'), false);
  assert.equal(source.includes('key-approvers/self'), false);
  const requesterPublic = Buffer.from(approval.requester.public, 'base64');
  const requesterNonce = Buffer.from(approval.requester.nonce, 'base64');
  const approverPublic = Buffer.from(approval.approver.public, 'base64');
  const approverNonce = Buffer.from(approval.approver.nonce, 'base64');
  assert.equal(approvalCommitment(requesterPublic, requesterNonce).toString('base64'), approval.commit);
  assert.equal(rawPublic(seedKey(approval.requester.privateSeedHex)).toString('base64'), approval.requester.public);
  assert.equal(approvalCode(requesterPublic, approverPublic, requesterNonce, approverNonce), approval.code);
  assert.equal(formatApprovalCode(Buffer.from([0, 0, 0, 42, 0, 0, 0, 0])), '0000 0042');
  const transcript = { accountId: approval.accountId, id: approval.id, requesterPublic, approverPublic, requesterNonce, approverNonce };
  const sealed = sealForRequester(Buffer.from(approval.keyHex, 'hex'), transcript, Buffer.from(approval.ivHex, 'hex'));
  assert.equal(sealed, approval.wrapped);
  assert.equal(createHash('sha256').update(Buffer.from(approval.additionalData)).digest('hex').length, 64);
  const opened = openApprovalEnvelope({ algorithm: approval.algorithm, wrapped: approval.wrapped }, Buffer.from(approval.requester.privateSeedHex, 'hex'), transcript);
  assert.deepEqual(opened, Buffer.from(approval.keyHex, 'hex'));
  assert.equal(usablePublicKey(Buffer.alloc(32)), false);
  assert.equal(approvalLabel('win32'), 'ONEM1ND, Windows');
  assert.equal(approvalLabel('win32').includes('@'), false);
  for (const bad of [
    { ...transcript, accountId: 'other' },
    { ...transcript, id: '00000000-0000-4000-8000-0000000000bb' },
    { ...transcript, approverNonce: randomBytes(32) },
  ]) assert.throws(() => openApprovalEnvelope({ algorithm: approval.algorithm, wrapped: approval.wrapped }, Buffer.from(approval.requester.privateSeedHex, 'hex'), bad), { code: 'key_authentication_failed' });
  const mutated = Buffer.from(approval.wrapped, 'base64');
  mutated[mutated.length - 1] ^= 1;
  assert.throws(() => openApprovalEnvelope({ algorithm: approval.algorithm, wrapped: mutated.toString('base64') }, Buffer.from(approval.requester.privateSeedHex, 'hex'), transcript), { code: 'key_authentication_failed' });
});

function fakeServer(timer) {
  const stats = { creates: 0, gets: [], bodies: [], deletes: [] };
  let row = null;
  let receipt = null;
  let available = true;
  let dropPut = false;
  let failPut = null;
  let revealConflict = false;
  const api = {
    stats, setAvailable(value) { available = value; }, dropNextPut() { dropPut = true; }, failNextPut(error) { failPut = error; },
    offer() { row.approverPublic = approval.approver.public; row.approverNonce = approval.approver.nonce; row.status = 'offered'; },
    approve(wrapped = approval.wrapped) { row.algorithm = approval.algorithm; row.wrapped = wrapped; row.status = 'approved'; },
    reject() { receipt = { ...row, status: 'rejected', endedAt: timer.now() }; row = null; },
    async request(path, options = {}) {
      const method = options.method ?? 'GET';
      if (path === '/v1/key-approvers/availability') return { available };
      if (path.startsWith('/v1/key-approval-requests/') && method === 'PUT') {
        stats.bodies.push(options.body);
        if (dropPut) { dropPut = false; stats.creates += 1; row = { id: 'approval-row', status: 'pending', createdAt: timer.now(), expiresAt: timer.now() + 300_000, commit: options.body.commit, label: options.body.label }; throw Object.assign(new Error('lost'), { code: 'ECONNRESET' }); }
        if (failPut) { const error = failPut; failPut = null; throw error; }
        if (row && (row.commit !== options.body.commit || row.label !== options.body.label)) throw new RelayPlusError(409, 'approval_conflict');
        if (!row && !receipt) { stats.creates += 1; row = { id: 'approval-row', status: 'pending', createdAt: timer.now(), expiresAt: timer.now() + 300_000, commit: options.body.commit, label: options.body.label }; return { ...row }; }
        if (row) return { ...row };
        return { id: receipt.id, status: receipt.status, createdAt: receipt.createdAt, expiresAt: receipt.expiresAt, endedAt: receipt.endedAt };
      }
      if (path.startsWith('/v1/key-approval-requests/') && method === 'GET') {
        stats.gets.push({ path, at: timer.now() });
        if (row) return { ...row };
        if (receipt) return { id: receipt.id, status: receipt.status, createdAt: receipt.createdAt, expiresAt: receipt.expiresAt, endedAt: receipt.endedAt };
        throw new RelayPlusError(404, 'not_found');
      }
      if (path.startsWith('/v1/key-approval-requests/') && method === 'DELETE') {
        stats.deletes.push(path);
        if (!row && !receipt) throw new RelayPlusError(404, 'not_found');
        if (row) { receipt = { id: row.id, status: 'cancelled', createdAt: row.createdAt, expiresAt: row.expiresAt, endedAt: timer.now() }; row = null; }
        return { success: true };
      }
      if (path.startsWith('/v1/key-approvals/') && path.endsWith('/reveal') && method === 'POST') {
        if (revealConflict) { revealConflict = false; throw new RelayPlusError(409, 'approval_conflict'); }
        if (!row?.approverPublic) throw new RelayPlusError(409, 'approval_conflict');
        row.requesterPublic = options.body.requesterPublic;
        row.requesterNonce = options.body.requesterNonce;
        row.status = 'revealed';
        return { ...row };
      }
      if (path.startsWith('/v1/key-approvals/') && path.endsWith('/consume') && method === 'POST') {
        if (!row?.wrapped) throw new RelayPlusError(404, 'not_found');
        receipt = { id: row.id, status: 'consumed', createdAt: row.createdAt, expiresAt: row.expiresAt, endedAt: timer.now() };
        row = null;
        return { success: true };
      }
      if (path.startsWith('/v1/key-approvals/') && method === 'GET') {
        stats.gets.push({ path, at: timer.now() });
        if (!row) throw new RelayPlusError(404, 'not_found');
        return { ...row };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return api;
}

function fixedRequester(timer, server) {
  return createApprovalRequester({
    client: server, accountId: approval.accountId, now: timer.now, wait: timer.wait, platform: 'win32',
    nonce: Buffer.from(approval.requester.nonce, 'base64'),
    generate: () => ({ privateKey: seedKey(approval.requester.privateSeedHex) }),
  });
}

test('a lost 201 is recovered once, polls are spaced, and cancellation orders the store', async () => {
  const timer = clock();
  const server = fakeServer(timer);
  server.dropNextPut();
  const requester = fixedRequester(timer, server);
  const started = await requester.start();
  assert.equal(server.stats.creates, 1);
  assert.equal(started.state, 'approval-pending');
  assert.equal(requester.body().label, 'ONEM1ND, Windows');
  const before = server.stats.gets.length;
  await Promise.all([requester.inspect(), requester.inspect()]);
  const polls = server.stats.gets.slice(before).filter(item => item.path.startsWith('/v1/key-approvals/'));
  assert.ok(polls.length >= 2);
  assert.ok(polls[1].at - polls[0].at >= 2000);
  server.offer();
  const coded = await requester.inspect();
  assert.equal(coded.code, approval.code);
  const transcript = {
    accountId: approval.accountId, id: 'approval-row',
    requesterPublic: Buffer.from(approval.requester.public, 'base64'),
    approverPublic: Buffer.from(approval.approver.public, 'base64'),
    requesterNonce: Buffer.from(approval.requester.nonce, 'base64'),
    approverNonce: Buffer.from(approval.approver.nonce, 'base64'),
  };
  server.approve(sealForRequester(Buffer.from(approval.keyHex, 'hex'), transcript, Buffer.from(approval.ivHex, 'hex')));
  await requester.inspect();
  let writes = 0;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const saving = requester.accept(async () => { writes += 1; entered(); await gate; });
  await enteredPromise;
  const cancelling = requester.cancel();
  release();
  assert.equal(await saving, true);
  const cancelled = await cancelling;
  assert.equal(writes, 1);
  assert.equal(requester.stored, true);
  assert.equal(cancelled.remote, true);
  const endedAt = timer.now();
  await requester.cancel();
  assert.equal(server.stats.deletes.length, 2);
  assert.equal(timer.now() >= endedAt, true);
  assert.equal(await requester.consume(), true);
  assert.equal(requester.stored, true);
  assert.equal(writes, 1);
});

test('limit, expiry, a zero public key and offline deletion stay explicit', async () => {
  const timer = clock();
  const server = fakeServer(timer);
  server.setAvailable(false);
  const hidden = fixedRequester(timer, server);
  assert.equal((await hidden.start()).outcome, 'approval-unavailable');
  assert.equal(server.stats.creates, 0);
  server.setAvailable(true);
  server.failNextPut(new RelayPlusError(409, 'approval_limit'));
  assert.equal((await fixedRequester(timer, server).start()).outcome, 'approval-limit');
  const live = fixedRequester(timer, server);
  await live.start();
  timer.advance(300_001);
  const gets = server.stats.gets.length;
  assert.equal((await live.inspect()).outcome, 'expired');
  assert.equal(server.stats.gets.length, gets);
  const rowPublic = Buffer.alloc(32).toString('base64');
  const offered = fakeServer(timer);
  offered.setAvailable(true);
  const another = fixedRequester(timer, offered);
  await another.start();
  offered.offer();
  const original = offered.request;
  offered.request = async (path, options) => {
    if (path.startsWith('/v1/key-approvals/') && (options?.method ?? 'GET') === 'GET') {
      return { id: 'approval-row', status: 'offered', createdAt: timer.now(), expiresAt: timer.now() + 300_000, approverPublic: rowPublic, approverNonce: approval.approver.nonce };
    }
    return original.call(offered, path, options);
  };
  await assert.rejects(another.inspect(), { code: 'invalid_approval' });
  const offline = fixedRequester(timer, { async request(path, options = {}) {
    if (path === '/v1/key-approvers/availability') return { available: true };
    if ((options.method ?? 'GET') === 'PUT') return { id: 'approval-row', status: 'pending', createdAt: timer.now(), expiresAt: timer.now() + 300_000 };
    if ((options.method ?? 'GET') === 'DELETE') throw Object.assign(new Error('offline'), { code: 'ECONNRESET' });
    throw new RelayPlusError(404, 'not_found');
  } });
  await offline.start();
  const result = await offline.cancel();
  assert.equal(result.remote, false);
  assert.equal(offline.stored, false);
});

test('an unusable high-bit alias is rejected before reveal and cannot restart the transcript', async () => {
  const timer = clock();
  const server = fakeServer(timer);
  const original = server.request;
  let reveals = 0;
  const lowOrder = Buffer.alloc(32);
  lowOrder[0] = 1; lowOrder[31] = 128;
  server.request = async (path, options) => {
    if (path.endsWith('/reveal')) reveals += 1;
    if (path.startsWith('/v1/key-approvals/') && (options?.method ?? 'GET') === 'GET') {
      return { id: 'approval-row', status: 'offered', approverPublic: lowOrder.toString('base64'), approverNonce: approval.approver.nonce };
    }
    return original.call(server, path, options);
  };
  const requester = fixedRequester(timer, server);
  await requester.start();
  await assert.rejects(requester.inspect(), { code: 'invalid_approval' });
  assert.equal(reveals, 0);
  assert.equal((await requester.inspect()).state, 'approval-ended');
  assert.equal(requester.stored, false);
});

test('the seven small-order encodings and their high-bit aliases are refused, other noncanonical keys are kept', () => {
  const small = ['00'.repeat(32), `01${'00'.repeat(31)}`,
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    `ec${'ff'.repeat(30)}7f`, `ed${'ff'.repeat(30)}7f`, `ee${'ff'.repeat(30)}7f`];
  for (const hex of small) {
    const raw = Buffer.from(hex, 'hex');
    assert.equal(usablePublicKey(raw), false, hex);
    const alias = Buffer.from(raw);
    alias[31] |= 0x80;
    assert.equal(usablePublicKey(alias), false, `${hex} with the high bit`);
  }
  assert.equal(usablePublicKey(Buffer.from(`ff${'ff'.repeat(30)}7f`, 'hex')), true, '2^255-1 is a valid noncanonical encoding');
  assert.equal(usablePublicKey(Buffer.alloc(31, 9)), false);
});
