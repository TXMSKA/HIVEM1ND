import assert from 'node:assert/strict';
import test from 'node:test';
import { closeHome, exchange, openHome, pollHome, status } from '../engine/service/home.mjs';
import { createCredentialStore, safeError } from '../engine/service/security.mjs';

function context() {
  const clock = { now: Date.parse('2026-10-13T12:00:00.000Z') };
  return { clock, now: () => clock.now, credentials: createCredentialStore({ now: () => clock.now }),
    interfaces: () => [{ name: 'Ethernet', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
    listen: async (address) => ({ address: address.address, netmask: address.netmask, port: 43123, close: async () => {} }),
    bus: { emit() {} } };
}
async function lock(home) {
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => {
      assert.equal(error.details.triesLeft, 5 - attempt);
      assert.equal(safeError(error, 'fixture').error.details.triesLeft, 5 - attempt);
      return error.status === 401;
    });
  }
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.code === 'pairing_locked'
    && error.status === 429 && error.details.triesLeft === 0 && Date.parse(error.retryAt) === home.clock.now + 600000);
}
test('five wrong codes lock that peer until the exact ten-minute boundary', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  const grant = await openHome(home);
  await lock(home);
  await assert.rejects(exchange(home, { code: grant.shortCode }, '192.168.1.40'), { code: 'pairing_locked' });
  await assert.rejects(exchange(home, { key: grant.key }, '192.168.1.40'), { code: 'pairing_locked' });
  assert.equal((await exchange(home, { code: grant.shortCode }, '192.168.1.41')).audience, 'phone');
  home.clock.now += 599999;
  await assert.rejects(exchange(home, { code: grant.shortCode }, '192.168.1.40'), { code: 'pairing_locked' });
  home.clock.now += 1;
  assert.equal((await exchange(home, { code: grant.shortCode }, '192.168.1.40')).audience, 'phone');
});
test('a replacement desktop grant clears locks and rejects the old grant', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  const old = await openHome(home);
  await lock(home);
  const next = await openHome(home);
  assert.equal((await exchange(home, { code: next.shortCode }, '192.168.1.40')).audience, 'phone');
  await assert.rejects(exchange(home, { key: old.key }, '192.168.1.40'), { code: 'invalid_home_key' });
});
test('code failures remain counted beyond a rolling minute before five attempts', async (t) => {
  const home = context();
  t.after(() => closeHome(home, { quiet: true }));
  await openHome(home);
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.details.triesLeft === 4);
  home.clock.now += 60001;
  await assert.rejects(exchange(home, { code: '000000' }, '192.168.1.40'), (error) => error.details.triesLeft === 3);
});

test('home status counts only valid phones in the current grant and announces count changes without secrets', async t => {
  const home = context(), events = [];
  home.bus.emit = event => events.push(event);
  t.after(() => closeHome(home, { quiet: true }));
  assert.equal(status(home).phoneCount, 0);
  const grant = await openHome(home);
  assert.equal(grant.phoneCount, 0);
  const outside = home.credentials.issue({ audience: 'phone', expiresAt: grant.expiresAt });
  const first = await exchange(home, { code: grant.shortCode }, '192.168.1.40');
  const second = await exchange(home, { key: grant.key }, '192.168.1.41');
  assert.equal(status(home).phoneCount, 2);
  assert.equal(events.at(-1).data.home.phoneCount, 2);
  home.credentials.revoke(first.token);
  assert.equal(status(home).phoneCount, 1);
  await pollHome(home);
  assert.equal(events.at(-1).data.home.phoneCount, 1);
  const countEvents = events.length;
  await pollHome(home);
  assert.equal(events.length, countEvents);
  home.credentials.revoke(second.token);
  await pollHome(home);
  assert.equal(events.at(-1).data.home.phoneCount, 0);
  assert.equal(home.credentials.verify(outside.token).audience, 'phone');
  const beforeReplacement = await exchange(home, { code: grant.shortCode }, '192.168.1.42');
  const replacement = await openHome(home);
  assert.equal(replacement.phoneCount, 0);
  assert.throws(() => home.credentials.verify(beforeReplacement.token), { code: 'invalid_session' });
  await exchange(home, { key: replacement.key }, '192.168.1.43');
  home.clock.now += 43200000;
  assert.equal(status(home).phoneCount, 0);
  assert.equal(events.at(-1).data.reason, 'expired');
  const serialized = JSON.stringify(events);
  for (const secret of [grant.key, grant.shortCode, first.token, second.token, replacement.key, replacement.shortCode]) assert.equal(serialized.includes(secret), false);
});
