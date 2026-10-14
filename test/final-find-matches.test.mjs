import assert from 'node:assert/strict';
import test from 'node:test';
import { findTextMatches } from '../gui/app/void.mjs';

test('Find supports literal metacharacters case and whole-word Unicode text', () => {
  assert.equal(findTextMatches('a.b aXb', 'a.b').length, 1);
  assert.equal(findTextMatches('Machine machine', 'machine', { caseSensitive: true }).length, 1);
  assert.equal(findTextMatches('máquina máquinas', 'máquina', { wholeWord: true }).length, 1);
  assert.equal(findTextMatches('\u{10400}cat cat\u0301 cat', 'cat', { wholeWord: true }).length, 1);
  assert.deepEqual(findTextMatches('abc123', '(abc)([0-9]+)', { regularExpression: true })[0].captures, ['abc', '123']);
  assert.throws(() => findTextMatches('text', '[', { regularExpression: true }), SyntaxError);
  assert.deepEqual(findTextMatches('text', ''), []);
});
