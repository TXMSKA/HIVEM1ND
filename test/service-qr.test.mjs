import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialStore } from '../engine/service/security.mjs';
import { encodeQr, formatBits, matrixText, penalty, toSvg } from '../engine/service/qr.mjs';
import { closeHome, eligibleAddresses, exchange, openHome, pollHome } from '../engine/service/home.mjs';
import { advanceClock, dispose, makeCoreFixture } from './core-fixture.mjs';

const SAMPLE = 'http://192.168.1.23:43123/#home=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('forced mask 0 matches the primary reference digests', () => {
  const sample = matrixText(encodeQr(SAMPLE, { mask: 0 }).modules);
  const full = matrixText(encodeQr('x'.repeat(106), { mask: 0 }).modules);
  assert.equal(createHash('sha256').update(sample).digest('hex'), '83549c0a12eb68c8716657575309cb4255bb529bfd795aebb1570b256ec34549');
  assert.equal(createHash('sha256').update(full).digest('hex'), '28571cbdad17176449c375be5ff4484c96ab69a72384c1fbe30595e2a902a1f5');
  assert.throws(() => encodeQr('x'.repeat(107)), (error) => error.code === 'qr_too_large');
  const decoded = decodeSymbol(sample);
  assert.equal(decoded, SAMPLE);
  assert.equal(decodeSymbol(full), 'x'.repeat(106));
});

test('every mask keeps function cells, format bits and a quiet SVG', () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const symbol = encodeQr('hivem1nd', { mask });
    assert.equal(symbol.modules[3][3], true);
    assert.equal(symbol.modules[5][5], false);
    assert.equal(symbol.modules[30][30], true);
    assert.equal(symbol.modules[29][8], true);
    assert.equal(readFormat(symbol.modules).mask, mask);
    assert.equal(typeof penalty(symbol.modules), 'number');
  }
  const svg = toSvg(encodeQr('hivem1nd', { mask: 0 }));
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="180" height="180"/);
  assert.match(svg, /<rect x="0" y="0" width="180" height="180" fill="#ffffff"\/>/);
  assert.equal(svg.includes('hivem1nd'), false);
});

test('home grants expire exactly, revoke tokens and hide secrets', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const credentials = createCredentialStore({ now: () => fixture.clock.now });
  const events = [];
  const closed = [];
  const context = {
    now: () => fixture.clock.now,
    credentials,
    bus: { emit(event) { events.push(event); } },
    interfaces: () => [{ name: 'Ethernet', address: '192.168.1.23', netmask: '255.255.255.0', internal: false }],
    schedule: (fn, delay) => ({ fn, delay, cleared: false }),
    listen: (address) => listenLoopback(address, closed),
  };
  const grant = await openHome(context, {});
  assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.openedAt), 43200000);
  assert.equal(grant.links[0], `http://192.168.1.23:${grant.links[0].split(':')[2].split('/')[0]}/#home=${grant.key}`);
  assert.equal(grant.qrPayloads[0], grant.links[0]);
  assert.equal(JSON.stringify(events).includes(grant.key), false);
  assert.equal(events[0].data.reason, 'opened');
  const phone = await exchange(context, { code: grant.shortCode.toLowerCase() }, '192.168.1.23');
  assert.equal(phone.expiresAt, grant.expiresAt);
  await assert.rejects(() => exchange(context, { key: 'wrong-key' }, '192.168.1.23'), (error) => error.code === 'invalid_home_key');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => exchange(context, { code: 'ZZZZZZ' }, '192.168.1.40'), (error) => error.code === 'invalid_home_key');
  }
  await assert.rejects(() => exchange(context, { code: 'ZZZZZZ' }, '192.168.1.40'), (error) => error.code === 'auth_rate_limited');
  await openHome(context, {});
  await assert.rejects(async () => credentials.verify(phone.token), (error) => error.status === 401);
  const second = await exchange(context, { key: context.grant.key }, '192.168.1.23');
  advanceClock(fixture, 43200000);
  await context.grant.expiry.fn();
  await assert.rejects(async () => credentials.verify(second.token), { status: 401, code: 'unauthorized' });
  assert.equal(events.at(-1).data.reason, 'expired');
  assert.equal(events.at(-1).data.home.enabled, false);
  const addresses = eligibleAddresses({
    beta: [{ address: '10.1.1.1', netmask: '255.0.0.0', family: 'IPv4', internal: false }],
    alpha: [{ address: '192.168.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }, { address: '8.8.8.8', netmask: '255.255.255.0', family: 'IPv4', internal: false }, { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }],
  });
  assert.deepEqual(addresses.map((item) => item.address), ['192.168.0.2', '10.1.1.1']);
  void closed;
});

test('a failed second bind leaves no listener and a lost interface closes the grant', async () => {
  const closed = [];
  let calls = 0;
  const context = {
    now: () => Date.parse('2026-10-10T12:00:00.000Z'),
    credentials: createCredentialStore({ now: () => Date.parse('2026-10-10T12:00:00.000Z') }),
    bus: { emit() {} },
    interfaces: () => [
      { name: 'a', address: '192.168.1.10', netmask: '255.255.255.0', internal: false },
      { name: 'b', address: '192.168.1.11', netmask: '255.255.255.0', internal: false },
    ],
    listen: async (address) => {
      calls += 1;
      if (calls === 2) throw new Error('bind failed');
      return { address: address.address, netmask: address.netmask, port: 41000, close: async () => { closed.push(address.address); } };
    },
  };
  await assert.rejects(() => openHome(context, { addresses: ['192.168.1.10', '192.168.1.11'] }), (error) => error.code === 'listener_unavailable');
  assert.deepEqual(closed, ['192.168.1.10']);
  assert.equal(context.grant, null);
  context.listen = (address) => listenLoopback(address, []);
  context.interfaces = () => [{ name: 'a', address: '192.168.1.10', netmask: '255.255.255.0', internal: false }];
  const opened = await openHome(context, { addresses: ['192.168.1.10'] });
  const token = (await exchange(context, { key: opened.key }, '192.168.1.10')).token;
  context.interfaces = () => [];
  await pollHome(context);
  assert.equal(context.grant, null);
  await assert.rejects(async () => context.credentials.verify(token), (error) => error.status === 401);
  await closeHome(context);
});

function listenLoopback(address, closed) {
  const server = createServer((socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        address: address.address,
        netmask: address.netmask,
        port: server.address().port,
        close: () => new Promise((done) => {
          closed.push(address.address);
          server.close(() => done());
        }),
      });
    });
  });
}

function decodeSymbol(text) {
  const modules = text.split('\n').map((line) => [...line].map((cell) => cell === '1'));
  const { mask } = readFormat(modules);
  const cells = writableCells();
  const bits = cells.map(([x, y]) => {
    const masked = modules[y][x];
    return MASKS[mask](x, y) ? !masked : masked;
  });
  const words = [];
  for (let index = 0; index < 134 * 8; index += 8) {
    let word = 0;
    for (let shift = 0; shift < 8; shift += 1) word = (word << 1) | (bits[index + shift] ? 1 : 0);
    words.push(word);
  }
  const data = words.slice(0, 108);
  assert.deepEqual(remainder(data), words.slice(108));
  const payload = [];
  for (let index = 4; index < 12; index += 1) payload.push(bits[index]);
  let length = 0;
  for (const bit of payload) length = (length << 1) | (bit ? 1 : 0);
  const bytes = [];
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (let shift = 0; shift < 8; shift += 1) value = (value << 1) | (bits[12 + index * 8 + shift] ? 1 : 0);
    bytes.push(value);
  }
  return Buffer.from(bytes).toString('utf8');
}

function readFormat(modules) {
  let bits = 0;
  for (let index = 0; index < 15; index += 1) {
    const [x, y] = index <= 5 ? [8, index] : index === 6 ? [8, 7] : index === 7 ? [8, 8] : index === 8 ? [7, 8] : [14 - index, 8];
    if (modules[y][x]) bits |= 1 << index;
  }
  const unmasked = bits ^ 0x5412;
  return { mask: (unmasked >> 10) & 7, bits };
}

function writableCells() {
  const isFunction = Array.from({ length: 37 }, () => Array(37).fill(false));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < 37 && y < 37) isFunction[y][x] = true; };
  for (const [cx, cy] of [[3, 3], [33, 3], [3, 33]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  }
  for (let index = 0; index < 37; index += 1) {
    mark(index, 6);
    mark(6, index);
  }
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(30 + dx, 30 + dy);
  for (let index = 0; index < 15; index += 1) {
    const [x, y] = index <= 5 ? [8, index] : index === 6 ? [8, 7] : index === 7 ? [8, 8] : index === 8 ? [7, 8] : [14 - index, 8];
    mark(x, y);
    mark(index <= 7 ? 36 - index : 8, index <= 7 ? 8 : 22 + index);
  }
  mark(8, 29);
  const cells = [];
  let x = 36;
  while (x > 0) {
    if (x === 6) x = 5;
    const upward = ((x + 1) & 2) === 0;
    for (let row = 0; row < 37; row += 1) {
      const y = upward ? 36 - row : row;
      for (const column of [x, x - 1]) if (!isFunction[y][column]) cells.push([column, y]);
    }
    x -= 2;
  }
  return cells;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function remainder(data) {
  const multiply = (a, b) => {
    let result = 0;
    for (let i = 0; i < 8; i += 1) {
      if (b & 1) result ^= a;
      b >>>= 1;
      a <<= 1;
      if (a & 0x100) a ^= 0x11d;
    }
    return result;
  };
  let generator = [1];
  let root = 1;
  for (let degree = 0; degree < 26; degree += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, i) => {
      next[i] ^= coefficient;
      next[i + 1] ^= multiply(coefficient, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const work = [...data, ...Array(26).fill(0)];
  for (let i = 0; i < 108; i += 1) {
    const factor = work[i];
    for (let j = 0; j < generator.length; j += 1) work[i + j] ^= multiply(factor, generator[j]);
  }
  return work.slice(108);
}

void randomUUID;
void formatBits;
