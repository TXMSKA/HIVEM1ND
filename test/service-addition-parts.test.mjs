import assert from 'node:assert/strict';
import test from 'node:test';
import { additionPath, recognizeAdditionParts } from '../engine/service/addition-parts.mjs';
const file = (path, text) => ({ path, kind: 'file', bytes: Buffer.byteLength(text), text });
test('a mixed repository offers separate skills docs repository and a disabled tool', () => {
  const parts = recognizeAdditionParts([
    file('pdf/SKILL.md', '---\nname: pdf\ndescription: Read PDF files\n---\nInstructions.\n'),
    file('pdf/scripts/read.py', 'print(1)\n'), file('pdf/docs/help.md', '# Skill support\n'),
    file('docx/SKILL.md', '---\nname: docx\ndescription: Word documents\n---\nInstructions.\n'),
    file('docs/guide.md', '# Project documentation\n'),
    file('tools/package.json', '{"name":"acme-files","mcp":true,"scripts":{"postinstall":"never execute"}}'),
  ], { repository: true, name: 'landing-site' });
  assert.deepEqual(parts.map(item => [item.kind, item.name]).sort(), [
    ['docs', 'docs'], ['repository', 'landing-site'], ['skill', 'docx'], ['skill', 'pdf'], ['tool-server', 'acme-files'],
  ]);
  assert.deepEqual(parts.find(item => item.name === 'pdf').requirements, ['Python']);
  assert.equal(parts.find(item => item.kind === 'tool-server').supported, false);
  assert.equal(parts.find(item => item.kind === 'tool-server').blockedReason, 'after_3_0');
  assert.equal(JSON.stringify(parts).includes('never execute'), false);
});
test('unsafe inventories fail before any candidate can be accepted', () => {
  for (const value of ['/root/file', '../file', 'a/../file', 'a\\file', 'C:/file', 'a:stream', 'CON/file', 'a./file']) {
    assert.throws(() => additionPath(value), error => error.code === 'invalid_path');
  }
  assert.throws(() => recognizeAdditionParts([file('docs/a.md', 'a'), file('DOCS/A.md', 'b')]), error => error.code === 'invalid_path');
  assert.throws(() => recognizeAdditionParts([{ path: 'a', kind: 'link', bytes: 0, text: null }]), error => error.code === 'invalid_source');
  assert.throws(() => recognizeAdditionParts(Array.from({ length: 1025 }, (_, index) => file(String(index), ''))), error => error.code === 'addition_too_large');
  for (const body of ['{', 'null', '[]', '{"name":42}']) {
    assert.throws(() => recognizeAdditionParts([file('package.json', body)]), error => error.code === 'invalid_source');
  }
});
