import assert from 'node:assert/strict';
import test from 'node:test';
import { addBoardFrame, handStrokeNode } from '../gui/app/blueprint.mjs';

test('a hand stroke stores normalized path geometry in a regular vector node', () => {
  const node = handStrokeNode('stroke-1', [{ x: 10, y: 20 }, { x: 280, y: 520 }], '#f5f1f6');
  assert.equal(node.d, 'M0.000 0.000 L100.000 100.000');
  assert.deepEqual(node.place, { x: 10, y: 20 });
  assert.equal(node.w, 270);
  assert.equal(node.h, 500);
  assert.equal(node.strokeWidth, 2.2);
  assert.equal(handStrokeNode('stroke-2', [{ x: 0, y: 0 }, { x: 5, y: 0 }], '#bdcd79', true).name, 'Marker stroke');
  assert.throws(() => handStrokeNode('stroke-3', [{ x: NaN, y: 0 }, { x: 1, y: 1 }], '#ffffff'), RangeError);
});

test('R11 sketch frames use the selected language copy', () => {
  const colors = { card: '#211a27', accent: '#bdcd79' };
  const board = { pages: [{ id: 'main', title: 'Main', objects: [], order: [] }], screens: [] };
  const frame = addBoardFrame(board, 'sketch-1', { x: 0, y: 0 }, { w: 300, h: 560 }, colors, true, 'es');
  assert.equal(frame.title, 'Boceto a mano');
  assert.equal(frame.root.name, 'Boceto a mano');
});
