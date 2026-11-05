import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { listInstallableAssets } from '../engine/install.mjs';
import { createAnchor, findAnchor, place } from '../features/void/comments.mjs';
import { merge, plain, wordDiff } from '../features/void/text.mjs';

const PAGES = [
  { k: 'Intro.Welcome', en: '<b>Welcome</b>\nFirst line here.\n\nSecond paragraph of the text.', es: '<b>Bienvenida</b>\nPrimera línea.\n\nSegundo párrafo.' },
  { k: 'Intro.Other', en: 'Other page text', es: 'Otra página' },
];

// ---- text and anchors ---------------------------------------------------

test('plain text keeps the lines and the paragraph breaks the reader draws and drops the marks', () => {
  assert.equal(plain(PAGES[0].en), 'Welcome\nFirst line here.\n\nSecond paragraph of the text.');
  assert.equal(plain('<i>a</i> < b >\n\n\nc\n'), 'a < b >\n\n\nc\n');
  assert.equal(plain('# Title\r\n\r\n<b>A😀</b> **bold** _italic_ ~~gone~~\r\n- item\r\n> quote\r\n`<b>code</b>`\r\n'),
    'Title\n\nA😀 bold italic gone\nitem\nquote\n<b>code</b>\n');
});

test('Markdown comments retain plain offsets and relocate to the exact bilingual source passage', () => {
  const source = '# Title\r\n\r\n<b>A😀</b> **passage**\r\n';
  const visible = plain(source), start = visible.indexOf('😀');
  const anchor = createAnchor(visible, start, start + 2, 'es', 'One');
  const pages = [{ k: 'One', en: 'Other text', es: `Before\r\n${source}`, future: true }];
  const found = place(pages, { anchor });
  assert.equal(found.start, start + 7); assert.equal(found.end, start + 9);
  assert.equal(pages[0].es.slice(found.sourceStart, found.sourceEnd), '😀');
  assert.equal(found.exact, true);
  assert.throws(() => createAnchor(visible, start + 1, start + 2, 'es', 'One'), RangeError);
});

test('the word diff reports inserted and removed words as runs', () => {
  const runs = wordDiff('The quick brown fox', 'The slow brown fox jumps');
  assert.deepEqual(runs.map((r) => r.kind), ['equal', 'delete', 'insert', 'equal', 'insert']);
  assert.equal(runs.find((r) => r.kind === 'delete').text, 'quick');
  assert.equal(runs.find((r) => r.kind === 'insert').text, 'slow');
  assert.equal(runs.map((r) => r.text).filter((_, i) => runs[i].kind !== 'delete').join(''), 'The slow brown fox jumps');
  assert.deepEqual(wordDiff('same', 'same'), [{ kind: 'equal', text: 'same' }]);
  assert.deepEqual(wordDiff('', 'new'), [{ kind: 'insert', text: 'new' }]);
});

test('a comment finds its words again after the page is edited around them', () => {
  const text = plain(PAGES[0].en);
  const quote = 'Second paragraph of the text';
  const start = text.indexOf(quote);
  const anchor = createAnchor(text, start, start + quote.length, 'en', 'Intro.Welcome');
  const pages = (en) => [{ k: 'Intro.Welcome', en }];
  const thread = { anchor };
  const longer = PAGES[0].en.replace('First line here.', 'First line here, now longer than before.');
  const inserted = place(pages(longer), thread);
  assert.equal(plain(longer).slice(inserted.start, inserted.end), quote);
  assert.equal(inserted.exact, true);
  const reworded = PAGES[0].en.replace('paragraph of the', 'paragraphs of the');
  const moved = place(pages(reworded), thread);
  assert.equal(moved.exact, false);
  assert.equal(plain(reworded).slice(moved.start, moved.end), 'Second paragraphs of the text.');
  assert.equal(place(pages('Nothing alike remains here.'), thread), null);
  assert.equal(place([], thread), null);
});

test('a repeated quote is told apart by its surroundings and then by its offset', () => {
  const text = 'red apple on the left and red apple on the right';
  const second = text.lastIndexOf('red apple');
  const anchor = createAnchor(text, second, second + 'red apple'.length, 'en', 'k');
  assert.equal(findAnchor(text, anchor).start, second);
  assert.equal(findAnchor(`a ${text}`, anchor).start, second + 2);
  const bare = { quote: 'red apple', prefix: '', suffix: '', start: second };
  assert.equal(findAnchor(text, bare).start, second);
  assert.equal(findAnchor(text, { ...bare, start: 0 }).start, 0);
});

test('two changes to one text are joined where they do not touch', () => {
  const base = 'The first line stays.\nThe middle line is plain.\nThe last line ends.';
  assert.equal(merge(base, base.replace('first', 'opening'), base.replace('last', 'final')), 'The opening line stays.\nThe middle line is plain.\nThe final line ends.');
  assert.equal(merge(base, base, base.replace('last', 'final')), base.replace('last', 'final'));
  assert.equal(merge(base, base.replace('last', 'final'), base), base.replace('last', 'final'));
  assert.equal(merge(base, 'Same.', 'Same.'), 'Same.');
  assert.equal(merge(base, base.replace('middle', 'center'), base.replace('middle', 'centre')), null, 'both changed the same words');
  assert.equal(merge('One.', 'One. Mine.', 'One. Theirs.'), null, 'both added at the same place');
  assert.equal(merge('<b>Title</b>\nBody text.', '<b>Title</b>\nBody text, mine.', '<b>New title</b>\nBody text.'), '<b>New title</b>\nBody text, mine.');
});

test('the installed Void skill leaves the modules only the service loads in the kit', async () => {
  const kitPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { assets } = await listInstallableAssets(kitPath);
  const skill = assets.find((asset) => asset.type === 'feature' && path.basename(path.dirname(asset.sourcePath)) === 'void');
  assert.ok(skill?.mainContent, 'the Void skill is installable');
  const shipped = skill.supportFiles.map((support) => support.relativePath);
  assert.ok(!shipped.includes('comments.mjs') && !shipped.includes('text.mjs'), `shipped: ${shipped.join(', ')}`);
});
