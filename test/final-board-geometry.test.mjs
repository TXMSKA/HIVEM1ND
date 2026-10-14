import assert from 'node:assert/strict';
import test from 'node:test';
import { dragNodeGeometry } from '../gui/app/blueprint.mjs';

test('corner resizing fixes the opposite corner and keeps unknown placement fields', () => {
  const node = { place: { x: 20, y: 30, future: true }, w: 160, h: 40, marker: 'kept' };
  assert.deepEqual(dragNodeGeometry(node, 10, 5), { place: { x: 30, y: 35, future: true }, w: 160, h: 40 });
  assert.deepEqual(dragNodeGeometry(node, 10, 5, 'nw'), { place: { x: 30, y: 35, future: true }, w: 150, h: 35 });
  assert.deepEqual(dragNodeGeometry(node, 999, 999, 'nw'), { place: { x: 179, y: 69, future: true }, w: 1, h: 1 });
  assert.equal(node.marker, 'kept');
  assert.equal(node.place.x, 20);
  assert.throws(() => dragNodeGeometry(node, 0, 0, 'middle'), RangeError);
});
