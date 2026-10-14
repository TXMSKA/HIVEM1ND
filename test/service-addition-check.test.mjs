import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAddition, resolveAdditionScope } from '../engine/service/addition-check.mjs';
const now = Date.parse('2026-10-13T12:00:00.000Z');
const candidate = { supported: true, requirements: ['Python'] };
const evidence = { pin: { kind: 'commit', value: 'a'.repeat(40), digest: 'b'.repeat(64) },
  pinVerified: true, license: 'MIT', publishedAt: '2026-10-06T12:00:00.000Z', noInstallScripts: true, runtimeVerified: true };
test('seven complete days pass while runtime requirements remain an explicit caution', () => {
  const check = checkAddition(candidate, evidence, now);
  assert.equal(check.eligible, true); assert.equal(check.age.days, 7); assert.equal(check.runtime.ok, false);
  assert.deepEqual(check.runtime.requirements, ['Python']);
  for (const patch of [ { publishedAt: '2026-10-06T12:00:00.001Z' }, { publishedAt: null },
    { publishedAt: '2026-10-14T12:00:00.000Z' }, { license: null }, { pinVerified: false }, { noInstallScripts: false }, { runtimeVerified: false } ]) {
    assert.equal(checkAddition(candidate, { ...evidence, ...patch }, now).eligible, false);
  }
  assert.equal(checkAddition({ ...candidate, supported: false }, evidence, now).eligible, false);
});
test('group and direct selection produce four distinct allowed units', () => {
  const units = ['root:master', 'root:adjutant', 'project:shop:one', 'project:shop:two', 'project:shop:three'];
  const groups = [{ id: 'checkout', members: units.slice(2), deleted: false }];
  const result = resolveAdditionScope({ everyUnit: false, units: ['root:adjutant', 'project:shop:one'], groups: ['checkout'] }, units, groups);
  assert.equal(result.unitCount, 4); assert.equal(result.unitIds.includes('root:master'), false);
  assert.equal(resolveAdditionScope({ everyUnit: true, units: [], groups: [] }, units, groups).unitCount, 4);
  for (const scope of [{ everyUnit: false, units: [], groups: [] }, { everyUnit: true, units: ['root:adjutant'], groups: [] },
    { everyUnit: false, units: ['root:master'], groups: [] }, { everyUnit: false, units: [], groups: ['missing'] }]) {
    assert.throws(() => resolveAdditionScope(scope, units, groups));
  }
  assert.throws(() => resolveAdditionScope({ everyUnit: false, units: [], groups: ['checkout'] }, units,
    [{ ...groups[0], members: ['project:shop:gone'] }]), error => error.code === 'scope_changed');
});
