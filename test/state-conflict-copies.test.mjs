import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { readProjection } from '../engine/service/projection.mjs';
import { isMachineCopy, readUnitStates } from '../engine/service/state.mjs';

const STATE = 'unit: canonical\nunit-id: root:canonical\nrole: executor\nstate: out\nmachine: DESKTOP\n\nReady.\n';

test('a machine-suffixed sync copy of an agent state file is not another agent', async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const context = { paths: fixture.paths, store: fixture.store, now: () => fixture.clock.now, principal: { audience: 'desktop', unitId: 'root:master' }, projects: [] };
  await mkdir(path.join(fixture.paths.mind, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(fixture.paths.mind, 'user', 'machines', 'LAPTOP.md'), 'machine: LAPTOP\n');
  const state = path.join(fixture.paths.mind, 'user', 'state');
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, 'canonical.md'), STATE);
  await writeFile(path.join(state, 'canonical-LAPTOP.md'), STATE);
  // A hyphenated agent name whose last part is not a machine stays an agent.
  await writeFile(path.join(state, 'canonical-review.md'), STATE.replace('unit: canonical', 'unit: canonical-review').replace('root:canonical', 'root:canonical-review'));
  const ids = (await readProjection(context)).units.map((unit) => unit.id).filter((id) => id.startsWith('root:canonical'));
  assert.deepEqual(ids.sort(), ['root:canonical', 'root:canonical-review']);
  const states = (await readUnitStates(context)).map((item) => item.id);
  assert.equal(states.filter((id) => String(id).startsWith('root:canonical')).length, 2);
  assert.equal(isMachineCopy('canonical-LAPTOP.md', new Set(['canonical.md']), new Set(['laptop'])), true);
  assert.equal(isMachineCopy('canonical-LAPTOP.md', new Set([]), new Set(['laptop'])), false, 'without its base file it is an agent of its own');
});
