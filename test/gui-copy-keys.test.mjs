import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { text } from '../gui/app/i18n.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gui', 'app');

test('every literal copy key the desktop shell asks for exists in English and Spanish', () => {
  const used = new Map();
  for (const name of readdirSync(APP).filter(file => file.endsWith('.mjs'))) {
    const source = readFileSync(path.join(APP, name), 'utf8');
    for (const match of source.matchAll(/\btext\(\s*(?:app\.language|language|lang)\s*,\s*["']([A-Za-z0-9_]+)["']/g)) used.set(match[1], name);
  }
  assert.ok(used.size > 50, 'the scan finds the shell copy keys');
  const missing = [];
  for (const [key, file] of used) {
    for (const language of ['en', 'es']) {
      try { text(language, key); } catch { missing.push(`${key} (${language}, ${file})`); }
    }
  }
  assert.deepEqual(missing, []);
});

test('the folder delete questions count one text or board in the singular', async () => {
  const { cardinal } = await import('../gui/app/i18n.mjs');
  for (const [key, en, es] of [['deleteTextFolderScope', '1 text go', '1 texto con'], ['deleteBoardFolderScope', '1 board go', '1 tablero']]) {
    assert.match(cardinal('en', key, 1), new RegExp(en));
    assert.match(cardinal('es', key, 1), new RegExp(es));
    assert.match(cardinal('en', key, 3), /3 (texts|boards) go/);
  }
});
