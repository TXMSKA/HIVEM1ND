import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { text as setupText } from '../engine/texts.mjs';
import { dictionaryKeys, text as guiText } from '../gui/app/i18n.mjs';

test('visible setup and GUI templates use M1ND in both languages', async () => {
  const source = (await readFile(new URL('../engine/texts.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const en = source.match(/\n  en: \{\n([\s\S]*?)\n  \},\n  es: \{/)?.[1];
  assert.ok(en);
  const setupKeys = [...en.matchAll(/^    (\w+): /gm)].map((match) => match[1]);
  for (const language of ['en', 'es']) {
    for (const key of setupKeys) {
      const label = setupText(language, key).replace(/\{\w+\}/g, '');
      assert.equal(/(?<![-\w/])(mind|mente)(?![-\w/])/iu.test(label), false, language + ':' + key);
    }
    for (const key of dictionaryKeys()) {
      assert.equal(/\b(mind|mente)\b/iu.test(guiText(language, key)), false, language + ':' + key);
    }
  }
});

test('M1ND copy never changes an interpolated path or a wire field', () => {
  const location = 'C:/fixture/mind/keep';
  assert.ok(setupText('en', 'attachedMachine', { mind: location }).includes(location));
  assert.ok(setupText('es', 'attachedMachine', { mind: location }).includes(location));
  assert.equal(guiText('en', 'loadingView'), 'Reading the M1ND.');
  assert.equal(guiText('es', 'loadingView'), 'Leyendo el M1ND.');
});
