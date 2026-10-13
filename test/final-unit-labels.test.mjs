import assert from 'node:assert/strict';
import test from 'node:test';
import { unitDisplayName } from '../gui/app/hierarchy.mjs';

test('alias labels retain the actual unit name and preserve user text', () => {
  assert.equal(unitDisplayName({ id: 'project:blog:executor-blog', unit: 'executor-blog', alias: 'Blog' }), 'Blog (executor-blog)');
  assert.equal(unitDisplayName({ unit: 'executor-blog', alias: null }), 'executor-blog');
  assert.equal(unitDisplayName({ unit: 'executor-blog', alias: 'M1ND notes' }), 'M1ND notes (executor-blog)');
});
