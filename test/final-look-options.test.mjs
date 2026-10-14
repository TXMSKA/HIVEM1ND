import assert from 'node:assert/strict';
import test from 'node:test';
import { LOOK_OPTIONS } from '../gui/app/settings.mjs';

test('look previews keep wire identity separate from visible names', () => {
  assert.deepEqual(LOOK_OPTIONS.map((look) => look.id), ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']);
  assert.deepEqual(LOOK_OPTIONS.map((look) => look.label), ['Modern', 'Nocturne', 'Nebula', 'Waves', 'Toxic', 'Kinetic']);
  assert.equal(new Set(LOOK_OPTIONS.map((look) => look.id)).size, 6);
});
