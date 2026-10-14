import assert from 'node:assert/strict';
import test from 'node:test';
import { closeHome, exchange, openHome } from '../engine/service/home.mjs';
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
