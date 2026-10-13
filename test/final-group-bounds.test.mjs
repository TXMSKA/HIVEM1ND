import assert from 'node:assert/strict';
import test from 'node:test';
import { personalGroupBounds } from '../gui/app/map-geometry.mjs';

test('personal group bounds include member radii and labels without changing coordinates', () => {
  const nodes = [{ id: 'a', x: 100, y: 100, radius: 23 }, { id: 'b', x: 200, y: 300, radius: 28 }, { id: 'outside', x: 999, y: 999, radius: 30 }];
  const before = structuredClone(nodes);
  assert.deepEqual(personalGroupBounds(['a', 'b'], nodes), { x: 53, y: 53, w: 199, h: 323 });
  assert.deepEqual(nodes, before);
  assert.equal(personalGroupBounds(['missing'], nodes), null);
});
