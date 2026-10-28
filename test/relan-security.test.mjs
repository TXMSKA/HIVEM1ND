import { createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes, uuidV8 } from '../engine/service/identity.mjs';
import { createRelanKey, loadRelanKey, removeRelanKey, saveRelanKey } from '../engine/relan/keys.mjs';
import { cpaceGenerator, cpaceKey, cpaceMultiply, mapToCurve25519 } from '../engine/relan/cpace.mjs';
import { createPairing, pairRelan } from '../engine/relan/pairing.mjs';
import { openRelanListener, openRelanTransport } from '../engine/relan/http.mjs';
import { decodePack, encodePack, packFileName } from '../engine/sync/pack.mjs';
import { openFolderTransport } from '../engine/sync/replicate.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const AT = '2026-10-10T12:00:00.000Z';
const PAIR_VERSION = 'hivem1nd-relan-pair-v2'; // Compatibility: stored schemas and wire contracts retain their existing identifiers.

async function rogueHost(start) {
  const messages = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    messages.push({ route: req.url, value });
    const response = req.url === '/pair/start' ? start(value) : null;
    res.writeHead(response ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response ?? { error: 'unauthorized' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { messages, port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}

async function member(options = {}) {
  const fixture = await makeCoreFixture();
  let material = options.noKey ? null : await createRelanKey({ localDirectory: fixture.paths.localDirectory, store: fixture.store });
  let time = Date.now();
  const keyProvider = keyId => keyId === material?.keyId ? material.key : null;
  const pairing = createPairing({ getKey: () => material, ensureKey: async () => {
    material = await createRelanKey({ localDirectory: fixture.paths.localDirectory, store: fixture.store }); return material;
  }, now: () => time });
  const folder = openFolderTransport({ directory: path.join(fixture.root, 'mirror'), store: fixture.store, keyProvider });
  const listener = await openRelanListener({ transport: folder, keyProvider, getKey: () => material, pairing,
    addresses: ['127.0.0.1'], allowLoopback: true, longPollMs: 2000, now: () => time,
    getState: () => ({ machine: 'MACHINE-A', epoch: 1, hosting: true }) });
  return { fixture, folder, pairing, listener, get material() { return material; }, get time() { return time; },
    set time(value) { time = value; }, port: listener.listeners[0].port,
    async close() { await listener.close(); await dispose(fixture); } };
}

function packed(material, plaintext, algorithm = 'aes-256-gcm') {
  const raw = Buffer.from(plaintext), hash = hashBytes(raw);
  return encodePack({ machine: 'MACHINE-B', sequence: 1,
    changes: [{ format: 'hivem1nd-change-v1', id: uuidV8(['relan-security', hash]), machine: 'MACHINE-B', at: AT, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      target: { kind: 'mind', path: 'user/secret.md' }, operation: 'put', hash, size: raw.length, baseHash: null, messageId: null, transactionId: null }],
    objects: [{ hash, raw }], encryption: algorithm === 'none' ? { algorithm } : { algorithm, keyId: material.keyId },
    keyProvider: () => material.key });
}

function signed(key, method, route, timestamp, nonce, body = Buffer.alloc(0)) {
  const digest = createHash('sha256').update(body).digest('hex');
  return { 'x-hivem1nd-time': String(timestamp), 'x-hivem1nd-nonce': nonce, // Compatibility: paired machines retain their signed wire headers.
    'x-hivem1nd-signature': createHmac('sha256', key).update([method, route, digest, timestamp, nonce].join('\n')).digest('hex') }; // Compatibility: paired machines retain their signed wire headers.
}

function raw(port, route, headers = {}, method = 'GET', body = Buffer.alloc(0)) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: route, method, headers, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('ReLAN key remains in the private local directory and survives reload', async () => {
  const fixture = await makeCoreFixture();
  const options = { localDirectory: fixture.paths.localDirectory, store: fixture.store };
  try {
    assert.equal(await loadRelanKey(options), null);
    const [first, second] = await Promise.all([createRelanKey(options), createRelanKey(options)]);
    assert.deepEqual(first, second); assert.equal(first.key.length, 32);
    assert.deepEqual(await loadRelanKey(options), first);
    const file = path.join(fixture.paths.localDirectory, 'relan-key.json');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).key, first.key.toString('base64url'));
    assert(fixture.store.aclRunner.calls.some(call => call.op === 'protect' && call.target.startsWith(file)) || process.platform !== 'win32');
    if (process.platform === 'win32') assert.equal(fixture.store.aclRunner.calls.find(call => call.op === 'protect').target, fixture.paths.localDirectory);
    if (process.platform !== 'win32') assert.equal((await lstat(file)).mode & 0o077, 0);
    await removeRelanKey(options); assert.equal(await loadRelanKey(options), null);
    await saveRelanKey(options, first); assert.deepEqual(await loadRelanKey(options), first);
  } finally { await dispose(fixture); }
});

test('ReLAN key rejects malformed saved secrets', async () => {
  const fixture = await makeCoreFixture();
  const options = { localDirectory: fixture.paths.localDirectory, store: fixture.store };
  try {
    await createRelanKey(options);
    await writeFile(path.join(fixture.paths.localDirectory, 'relan-key.json'), JSON.stringify({ format: 'hivem1nd-relan-key-v1', key: 'short' })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    await assert.rejects(loadRelanKey(options), { code: 'invalid_relan_key' });
    await assert.rejects(saveRelanKey(options, { relanId: 'x', keyId: 'x', key: randomBytes(31) }), { code: 'invalid_relan_key' });
  } finally { await dispose(fixture); }
});

test('ReLAN pairing succeeds through CPace and transfers only encrypted key material', async () => {
  const host = await member({ noKey: true });
  try {
    assert.equal(host.material, null);
    const grant = host.pairing.showCode(), wire = [];
    assert.match(grant.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    assert.equal(Date.parse(grant.expiresAt) - host.time, 600000);
    const joined = await pairRelan({ address: '127.0.0.1', port: host.port, code: grant.code, onWire: bytes => wire.push(Buffer.from(bytes)) });
    assert.deepEqual(joined, host.material);
    for (const bytes of wire) {
      assert(!bytes.includes(joined.key)); assert(!bytes.includes(joined.key.toString('base64url'))); assert(!bytes.includes(grant.code));
    }
    assert.deepEqual(wire.slice(0, 3).map(value => Object.keys(JSON.parse(value)).sort()), [
      ['nonce', 'version'], ['publicKey', 'session', 'version'], ['proof', 'publicKey', 'session'],
    ]);
    assert.equal(JSON.parse(wire[0]).version, PAIR_VERSION); assert.equal(JSON.parse(wire[1]).version, PAIR_VERSION);
  } finally { await host.close(); }
});

test('CPace matches the published X25519 generator, public points and shared secret vectors', () => {
  // draft-irtf-cfrg-cpace-21 Appendix B.1.1 through B.1.4.
  // https://www.ietf.org/archive/id/draft-irtf-cfrg-cpace-21.html#appendix-B.1
  const session = Buffer.from('7e4b4791d6a8ef019b936c79fb7f2c57', 'hex');
  const context = Buffer.from('0b415f696e69746961746f720b425f726573706f6e646572', 'hex');
  const generator = cpaceGenerator('Password', session, context);
  assert.equal(generator.toString('hex'), 'd04bf6d41f6a289632a2e929fa29bebd51092512a7829fdde7d314b62f05a73f');
  const a = Buffer.from('21b4f4bd9e64ed355c3eb676a28ebedaf6d8f17bdc365995b319097153044080', 'hex');
  const b = Buffer.from('848b0779ff415f0af4ea14df9dd1d3c29ac41d836c7808896c4eba19c51ac40a', 'hex');
  const first = cpaceMultiply(a, generator), second = cpaceMultiply(b, generator);
  assert.equal(first.toString('hex'), '1d13c89278cdadd826f6d8d7f887701430f8380ddc17611cdd6dc989ce0c9f32');
  assert.equal(second.toString('hex'), '248cccf6d5cdc3646f0ad593f9e6cef4e69d4945f8372e623512ecea32185623');
  const secret = cpaceMultiply(a, second);
  assert.equal(secret.toString('hex'), '5b067effbdc0b2a0e1d907b21ebb25cfedb96a852179a847c37e43ee71322c6b');
  assert.deepEqual(secret, cpaceMultiply(b, first));
  const key = cpaceKey(secret, session, first, second, context);
  assert.deepEqual(key, cpaceKey(cpaceMultiply(b, first), session, first, second, context));
  assert.notDeepEqual(key, cpaceKey(secret, session, second, first, context));
  assert.notDeepEqual(key, cpaceKey(secret, Buffer.alloc(16), first, second, context));
  assert.notDeepEqual(key, cpaceKey(secret, session, first, second, Buffer.from('another channel')));
  assert.notDeepEqual(generator, cpaceGenerator('Password', Buffer.alloc(16), context));
  assert.notDeepEqual(generator, cpaceGenerator('Password', session, Buffer.from('another channel')));
});

test('Elligator2 matches all five RFC 9380 curve25519 NU map vectors', () => {
  // RFC 9380 J.4.2: compare Q.x before cofactor clearing, as required by CPace.
  // https://www.rfc-editor.org/rfc/rfc9380.html#appendix-J.4.2
  const vectors = [
    ['608d892b641f0328523802a6603427c26e55e6f27e71a91a478148d45b5093cd', '51125222da5e763d97f3c10fcc92ea6860b9ccbbd2eb1285728f566721c1e65b'],
    ['46f5b22494bfeaa7f232cc8d054be68561af50230234d7d1d63d1d9abeca8da5', '7d56d1e08cb0ccb92baf069c18c49bb5a0dcd927eff8dcf75ca921ef7f3e6eeb'],
    ['235fe40c443766ce7e18111c33862d66c3b33267efa50d50f9e8e5d252a40aaa', '3fbe66b9c9883d79e8407150e7c2a1c8680bee496c62fabe4619a72b3cabe90f'],
    ['001e92a544463bda9bd04ddbe3d6eed248f82de32f522669efc5ddce95f46f5b', '227e0bb89de700385d19ec40e857db6e6a3e634b1c32962f370d26f84ff19683'],
    ['1a68a1af9f663592291af987203393f707305c7bac9c8d63d6a729bdc553dc19', '3bcd651ee54d5f7b6013898aab251ee8ecc0688166fce6e9548d38472f6bd196'],
  ];
  for (const [u, x] of vectors) assert.equal(mapToCurve25519(BigInt(`0x${u}`)).reverse().toString('hex'), x);
});

test('CPace refuses the published low-order points and their high-bit aliases', () => {
  // draft-irtf-cfrg-cpace-21 Appendix B.1.10: u0..u5 and u7 abort.
  const points = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0100000000000000000000000000000000000000000000000000000000000000',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  ];
  const scalar = Buffer.from('af46e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449aff', 'hex');
  for (const encoded of points) {
    const point = Buffer.from(encoded, 'hex');
    assert.throws(() => cpaceMultiply(scalar, point));
    point[31] |= 128;
    assert.throws(() => cpaceMultiply(scalar, point));
  }
  assert.throws(() => cpaceKey(Buffer.alloc(32), Buffer.alloc(24), Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(0)));
});

test('ReLAN rogue host capture does not identify the code in 2,000 offline candidates', async () => {
  const real = '234567', guessed = '222222';
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const candidates = Array.from({ length: 1999 }, (_, index) => {
    let remaining = index, code = '';
    for (let digit = 0; digit < 6; digit += 1) { code = alphabet[remaining % alphabet.length] + code; remaining = Math.floor(remaining / alphabet.length); }
    return code;
  });
  candidates.push(real);
  assert.equal(new Set(candidates).size, 2000); assert(candidates.includes(guessed));
  // A finite regression of the known-exponent attack, not a proof of PAKE security.
  // The rogue commits one guess before seeing the joiner's point or HMAC.
  for (const committed of [guessed, real]) {
    const scalar = randomBytes(32), session = randomBytes(24);
    let server, channel;
    const rogue = await rogueHost(client => {
      channel = Buffer.from(JSON.stringify([PAIR_VERSION, 'server', 'client', client.nonce]));
      server = { version: PAIR_VERSION, session: session.toString('base64url'),
        publicKey: cpaceMultiply(scalar, cpaceGenerator(committed, session, channel)).toString('base64url') };
      return server;
    });
    try {
      await assert.rejects(pairRelan({ address: '127.0.0.1', port: rogue.port, code: real }), { code: 'pairing_refused' });
      assert.deepEqual(rogue.messages.map(message => message.route), ['/pair/start', '/pair/finish']);
      const start = rogue.messages[0].value, finish = rogue.messages[1].value;
      const clientPoint = Buffer.from(finish.publicKey, 'base64url'), serverPoint = Buffer.from(server.publicKey, 'base64url');
      const transcript = Buffer.from(JSON.stringify([PAIR_VERSION, finish.publicKey, start.nonce, server.publicKey, server.session]));
      const secret = cpaceMultiply(scalar, clientPoint);
      const proof = key => createHmac('sha256', key).update('client').update(transcript).digest('base64url');
      const knownKey = cpaceKey(secret, session, serverPoint, clientPoint, channel);
      assert.equal(proof(knownKey) === finish.proof, committed === real);
      if (committed === real) continue; // A new online attempt can verify its one chosen guess.
      const legacyMatches = [], commitments = [], generators = new Set();
      for (const candidate of candidates) {
        const generator = cpaceGenerator(candidate, session, channel);
        generators.add(generator.toString('hex'));
        if (cpaceMultiply(scalar, generator).equals(serverPoint)) commitments.push(candidate);
        // The v1 attack knew the DH secret and varied the code in HKDF's salt.
        const legacyKey = Buffer.from(hkdfSync('sha256', secret, Buffer.from(candidate), transcript, 32));
        if (proof(legacyKey) === finish.proof) legacyMatches.push(candidate);
      }
      assert.equal(generators.size, 2000);
      assert.deepEqual(commitments, [guessed]); assert.deepEqual(legacyMatches, []);
      // Remapping another code reveals no scalar relative to the fixed recorded Y.
      // CPace's KDF has no password input, so this known scalar yields only one check.
      assert.notEqual(proof(knownKey), finish.proof);
    } finally { await rogue.close(); }
  }
});

test('ReLAN refuses v1 on both sides before the joiner sends a proof', async () => {
  const pairing = createPairing(); pairing.showCode();
  const nonce = randomBytes(16).toString('base64url');
  assert.throws(() => pairing.handleStart({ nonce, publicKey: randomBytes(44).toString('base64url') }), { code: 'pairing_refused' });
  assert.throws(() => pairing.handleStart({ nonce, version: 'hivem1nd-relan-pair-v1' }), { code: 'pairing_refused' }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const server = pairing.handleStart({ version: PAIR_VERSION, nonce });
  await assert.rejects(pairing.handleFinish({ session: server.session, proof: randomBytes(32).toString('base64url') }), { code: 'pairing_refused' });
  const rogue = await rogueHost(() => ({ version: 'hivem1nd-relan-pair-v1', session: randomBytes(24).toString('base64url'), publicKey: randomBytes(32).toString('base64url') })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  try {
    await assert.rejects(pairRelan({ address: '127.0.0.1', port: rogue.port, code: '234567' }), { code: 'pairing_refused' });
    assert.equal(rogue.messages.length, 1);
  } finally { await rogue.close(); }
});

test('ReLAN refuses low-order host points without a proof and counts low-order joiner failures', async () => {
  const rogue = await rogueHost(() => ({ version: PAIR_VERSION, session: randomBytes(24).toString('base64url'), publicKey: Buffer.alloc(32).toString('base64url') }));
  try {
    await assert.rejects(pairRelan({ address: '127.0.0.1', port: rogue.port, code: '234567' }), { code: 'pairing_refused' });
    assert.equal(rogue.messages.length, 1);
  } finally { await rogue.close(); }
  let released = 0;
  const pairing = createPairing({ getKey: () => { released += 1; return { key: randomBytes(32) }; } });
  pairing.showCode();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const server = pairing.handleStart({ version: PAIR_VERSION, nonce: randomBytes(16).toString('base64url') });
    await assert.rejects(pairing.handleFinish({ session: server.session, publicKey: Buffer.alloc(32).toString('base64url'),
      proof: randomBytes(32).toString('base64url') }), { code: attempt === 5 ? 'pairing_locked' : 'pairing_refused' });
  }
  assert.equal(released, 0); assert.throws(() => pairing.showCode(), { code: 'pairing_locked' });
});

test('ReLAN wrong code is refused and five failures lock pairing for ten minutes', async () => {
  const host = await member();
  try {
    const grant = host.pairing.showCode();
    const wrong = grant.code === '222222' ? '333333' : '222222';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await assert.rejects(pairRelan({ address: '127.0.0.1', port: host.port, code: wrong }), { code: attempt === 5 ? 'pairing_locked' : 'pairing_refused' });
    }
    await assert.rejects(pairRelan({ address: '127.0.0.1', port: host.port, code: grant.code }), { code: 'pairing_locked' });
    assert.throws(() => host.pairing.showCode(), { code: 'pairing_locked' });
    host.time += 600001;
    const renewed = host.pairing.showCode();
    assert.deepEqual(await pairRelan({ address: '127.0.0.1', port: host.port, code: renewed.code }), host.material);
  } finally { await host.close(); }
});

test('ReLAN pairing code expires after ten minutes', async () => {
  const host = await member();
  try {
    const grant = host.pairing.showCode(); host.time += 600000;
    await assert.rejects(pairRelan({ address: '127.0.0.1', port: host.port, code: grant.code }), { code: 'pairing_refused' });
  } finally { await host.close(); }
});

test('ReLAN unpaired callers see only unauthorized responses', async () => {
  const host = await member();
  try {
    for (const route of ['/heads', '/state', '/packs/MACHINE-A/1', '/changes?after=0', '/missing']) {
      const response = await raw(host.port, route);
      assert.equal(response.status, 401); assert.deepEqual(JSON.parse(response.body), { error: 'unauthorized' });
    }
    assert.equal((await raw(host.port, '/pair/start', {}, 'POST', Buffer.from('{'))).status, 401);
    const stranger = openRelanTransport({ address: '127.0.0.1', port: host.port, key: randomBytes(32) });
    await assert.rejects(stranger.getState(), { status: 401 }); stranger.close();
  } finally { await host.close(); }
});

test('ReLAN refuses replayed requests, old timestamps, future timestamps and altered bodies', async () => {
  const host = await member();
  try {
    const headers = signed(host.material.key, 'GET', '/state', host.time, randomBytes(24).toString('base64url'));
    assert.equal((await raw(host.port, '/state', headers)).status, 200);
    assert.equal((await raw(host.port, '/state', headers)).status, 401);
    const future = signed(host.material.key, 'GET', '/state', host.time + 60000, randomBytes(24).toString('base64url'));
    assert.equal((await raw(host.port, '/state', future)).status, 200);
    host.time += 61000;
    assert.equal((await raw(host.port, '/state', future)).status, 401);
    for (const timestamp of [host.time - 60001, host.time + 60001]) {
      assert.equal((await raw(host.port, '/state', signed(host.material.key, 'GET', '/state', timestamp, randomBytes(24).toString('base64url')))).status, 401);
    }
    const altered = signed(host.material.key, 'PUT', '/heads', host.time, randomBytes(24).toString('base64url'));
    assert.equal((await raw(host.port, '/heads', altered, 'PUT', Buffer.from('{}'))).status, 401);
    const slow = signed(host.material.key, 'PUT', '/heads', host.time, randomBytes(24).toString('base64url'), Buffer.from('{}'));
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: host.port, path: '/heads', method: 'PUT', agent: false,
        headers: { ...slow, 'content-length': 2 } }, result => { result.resume(); result.on('end', () => resolve(result.statusCode)); });
      req.on('error', reject); req.write('{');
      setTimeout(() => { host.time += 60001; req.end('}'); }, 20);
    });
    assert.equal(response, 401);
  } finally { await host.close(); }
});

test('ReLAN transport preserves encrypted pack bytes and never puts file plaintext on the wire', async () => {
  const host = await member();
  const plaintext = 'ReLAN-wire-secret-file-content-76e056cc2a654140';
  const wire = [];
  const transport = openRelanTransport({ address: '127.0.0.1', port: host.port, key: host.material.key, onWire: bytes => wire.push(Buffer.from(bytes)) });
  try {
    const bytes = packed(host.material, plaintext);
    await transport.writePack('MACHINE-B', 1, bytes);
    const head = { format: 'hivem1nd-head-v1', machine: 'MACHINE-B', sequence: 1, updatedAt: AT, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
      packs: [{ sequence: 1, file: packFileName(1), hash: hashBytes(bytes), bytes: bytes.length }] };
    await transport.writeHead(head);
    assert.deepEqual(await transport.listHeads(), [head]);
    assert.deepEqual(await transport.readPack('MACHINE-B', 1), bytes);
    assert.equal(await transport.readPack('MACHINE-B', 2), null);
    assert.equal(decodePack(bytes, { keyProvider: () => host.material.key }).objects.get(hashBytes(Buffer.from(plaintext))).toString('utf8'), plaintext);
    const transmitted = wire.length;
    await assert.rejects(transport.writePack('MACHINE-B', 1, packed(host.material, plaintext, 'none')), { status: 422, code: 'unencrypted_pack' });
    assert.equal(wire.length, transmitted);
    assert(wire.length > 0); assert(wire.every(chunk => !chunk.includes(plaintext)));
  } finally { transport.close(); await host.close(); }
});

test('ReLAN change feed wakes for local changes and pack or head publication', async () => {
  const host = await member();
  const transport = openRelanTransport({ address: '127.0.0.1', port: host.port, key: host.material.key });
  try {
    const pending = transport.waitForChange();
    host.listener.changed();
    assert.equal((await pending).revision, 1);
    const next = transport.waitForChange();
    await transport.writePack('MACHINE-B', 1, packed(host.material, 'feed wake'));
    assert.equal((await next).revision, 2);
    const controller = new AbortController();
    const cancelled = transport.waitForChange({ signal: controller.signal }); controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
  } finally { transport.close(); await host.close(); }
});

test('ReLAN change feed ignores heartbeat responses until the revision advances', async () => {
  const key = randomBytes(32);
  const listener = await openRelanListener({ addresses: ['127.0.0.1'], interfaces: [], allowLoopback: true, getKey: () => key, longPollMs: 10 });
  let heartbeats = 0;
  const transport = openRelanTransport({ ...listener.listeners[0], key, onWire: bytes => {
    let value;
    try { value = JSON.parse(String(bytes)); } catch { return; }
    if (value.revision === 0 && ++heartbeats === 2) listener.changed();
  } });
  try {
    assert.equal((await transport.waitForChange()).revision, 1);
    assert.equal(heartbeats, 2);
  } finally { transport.close(); await listener.close(); }
});

test('ReLAN listener rejects wildcard, public and uninjected loopback addresses', async () => {
  for (const address of ['0.0.0.0', '8.8.8.8', '127.0.0.1']) {
    await assert.rejects(openRelanListener({ addresses: [address], interfaces: [] }), { code: 'invalid_relan_address' });
  }
  await assert.rejects(openRelanListener({ addresses: ['0.0.0.0'], interfaces: [], allowLoopback: true }), { code: 'invalid_relan_address' });
  const key = randomBytes(32);
  const listener = await openRelanListener({ addresses: ['127.0.0.1', '127.0.0.2'], interfaces: [], allowLoopback: true, getKey: () => key });
  try {
    assert.equal(listener.listeners[0].port, listener.listeners[1].port);
    for (const bound of listener.listeners) {
      const transport = openRelanTransport({ ...bound, key });
      try { assert.deepEqual(await transport.getState(), {}); } finally { transport.close(); }
    }
  } finally { await listener.close(); }
});
