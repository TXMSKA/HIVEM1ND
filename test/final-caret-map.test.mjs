import assert from 'node:assert/strict';
import test from 'node:test';
import { plainCaretFromSource, sourceBoundary, tokenizeMarkup, validUtf16Boundary } from '../gui/app/markup.mjs';

test('caret mapping keeps markup boundaries and source offsets distinct', () => {
  const source = '<b>A😀</b>';
  const tokens = tokenizeMarkup(source);
  assert.equal(plainCaretFromSource(tokens, 3), 0);
  assert.equal(plainCaretFromSource(tokens, 6), 3);
  assert.equal(sourceBoundary(source, 0, 'end'), 3);
  assert.equal(validUtf16Boundary(source, 5), false);
  assert.equal(plainCaretFromSource(tokens, source.length), 3);
  assert.equal(plainCaretFromSource(tokens, source.length + 1), null);
});
