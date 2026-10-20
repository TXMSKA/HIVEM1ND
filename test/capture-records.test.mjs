import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { finalLookCaptures, finalVerificationCases } from './gui-data.mjs';
import { captureTasks, finishRun, loadRegistry } from './visual/capture-final-screens.mjs';
import { pngSize } from './visual/chrome.mjs';

test('the capture runner covers every active destination without opening a browser', async () => {
  const references = finalVerificationCases().filter(item => !item.replacements.length);
  const registry = await loadRegistry();
  assert.deepEqual([...registry.keys()].sort(), references.map(item => item.reference).sort());
  assert.ok([...registry.values()].every(spec => typeof spec.reach === 'function'));
  const expected = [...references.flatMap(item => item.captures), ...finalLookCaptures()];
  const tasks = captureTasks();
  assert.equal(tasks.length, 193);
  assert.equal(new Set(tasks.map(task => task.path)).size, expected.length);
  assert.deepEqual(tasks.map(task => task.path).sort(), expected.map(task => task.path).sort());
  assert.deepEqual(captureTasks({ only: ['1.8', 'start 2.5'], languages: ['es'] }).map(task => task.path), [
    'docs/3.0/verification/1.8-es-modern.png', 'docs/3.0/verification/start-2.5-es-modern.png',
  ]);
});

test('reference 2.17 opens Stop only after the session is live', async () => {
  const source = await readFile(new URL('./visual/cases/map.mjs', import.meta.url), 'utf8');
  const reach = source.slice(source.indexOf("'2.17'"), source.indexOf('async function seedMobile'));
  const progress = reach.indexOf('data-session-progress');
  const click = reach.indexOf('await ctx.page.click(\'.inspector [data-action="stop-session"]\')');
  assert.ok(progress > 0 && click > progress, 'Stop is clicked only after the starting progress is gone');
});

test('capture records match the actual PNG inventory and retain unreached states', async () => {
  const handoff = await readFile(new URL('./gui-browser.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../docs/3.0/verification/README.md', import.meta.url), 'utf8');
  const tasks = captureTasks();
  const hashes = new Set();
  let captured = 0, missing = 0;
  for (const task of tasks) {
    const row = handoff.split('\n').find(line => line.startsWith(`| ${task.reference} `));
    let bytes;
    try { bytes = await readFile(new URL(`../${task.path}`, import.meta.url)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes) {
      missing += 1;
      assert.match(row ?? '', /UNREACHED en\/es, modern: .+/, task.path);
      assert.equal(handoff.includes(`\`${task.path}\``), false, 'An unreached file must not be listed as a saved capture.');
      continue;
    }
    captured += 1;
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], task.path);
    assert.deepEqual(pngSize(bytes), { width: task.viewport[0], height: task.viewport[1] }, task.path);
    assert.ok(handoff.includes(`\`${task.path}\``), task.path);
    assert.match(task.look === 'modern' ? row ?? '' : handoff.split('\n').find(line => line.includes(`\`${task.path}\``)) ?? '', /CAPTURED/, task.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hashes.has(hash), false, `Duplicate image bytes at ${task.path}`);
    hashes.add(hash);
  }
  const files = (await readdir(new URL('../docs/3.0/verification/', import.meta.url))).filter(file => file.endsWith('.png'));
  assert.equal(files.length, captured, 'The folder must not contain unlisted extra PNGs.');
  assert.equal(Number(/^Captured: (\d+)$/m.exec(readme)?.[1]), captured);
  assert.equal(Number(/^Unreached: (\d+)$/m.exec(readme)?.[1]), missing);
  const sources = [...readme.matchAll(/^\| ([a-f0-9]{40}) \| (\d+) \| (.+) \|$/gm)];
  assert.ok(sources.length >= 1, 'Every saved file names the source revision it was captured from.');
  assert.equal(sources.reduce((sum, source) => sum + Number(source[2]), 0), captured);
  assert.match(readme, /not visual acceptance/);
  assert.equal(handoff.includes('retained guarantees CAPTURED'), false, 'A saved replacement PNG does not establish retained behavior.');
  assert.match(handoff.split('\n').find(line => line.startsWith('| 3.10 ')), /Send back dialog opens/);
  assert.match(handoff.split('\n').find(line => line.startsWith('| 4.11 ')), /required recipient live Work row absent/);
});

test('a capture run saves its report and then fails when a state was unreached', async () => {
  const writes = [];
  const options = { version: 'Chrome/1', reportFile: 'capture-results.json', write: async (file, text) => writes.push({ file, report: JSON.parse(text) }), log: () => undefined };
  const record = status => ({ reference: '1.8', status });
  assert.equal(await finishRun([record('captured'), record('unreached')], options), 1);
  assert.deepEqual(writes.map(item => [item.file, item.report.captured, item.report.unreached]), [['capture-results.json', 1, 1]]);
  assert.equal(await finishRun([record('captured')], options), 0);
  assert.equal(writes.length, 2);
});
