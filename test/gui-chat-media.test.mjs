import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { actionName, composerPart, encodeBase64, galleryState, messageParts, renderActions, renderAttachDialog, renderGallery, renderPendingParts, stepGallery } from '../gui/app/chat-media.mjs';
import { text } from '../gui/app/i18n.mjs';

class Node {
  constructor(tag, value = '') {
    this.tagName = tag.toUpperCase(); this.attributes = {}; this.children = []; this.listeners = {}; this.style = {}; this.own = value; this.value = ''; this.className = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...kids) { for (const kid of kids) this.children.push(typeof kid === 'object' ? kid : new Node('#text', String(kid))); }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  fire(type, event = {}) { for (const handler of this.listeners[type] ?? []) handler({ preventDefault() {}, ...event }); }
  click() { this.fire('click'); }
  close() { delete this.attributes.open; this.fire('close'); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  get textContent() { return this.own + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.own = String(value); this.children = []; }
}
const document = { createElement: (tag) => new Node(tag), createElementNS: (_space, tag) => new Node(tag), createTextNode: (value) => new Node('#text', String(value)) };
const all = (root) => [root, ...root.children.flatMap(all)];
const find = (root, name, value) => all(root).filter((node) => node.attributes[name] !== undefined && (value === undefined || node.attributes[name] === value));
const t = (key, values) => text('en', key, values);
const ID = (index) => `0b1f6c1e-6f4e-4a4b-9a4c-2f1d3c5b7a9${index}.png`;
const BOARD = '6b1d2c3e-4f5a-8b6c-9d7e-0f1a2b3c4d5e';

test('a message shows only the parts whose target has the shape of its kind', () => {
  const { images, actions } = messageParts([
    { kind: 'image', path: ID(0), label: 'Checkout' }, { kind: 'image', path: '../secret.png' },
    { kind: 'link', path: 'https://github.com/TXMSKA/HIVEM1ND/pull/61', label: 'Pull request' }, { kind: 'link', path: 'javascript:alert(1)' },
    { kind: 'link', path: 'https://user@evil.example/' }, { kind: 'board', path: BOARD }, { kind: 'text', path: 'notes' },
    { kind: 'task', path: 'project:shop:029' }, 'docs/notes.md', { path: 'docs/a.md', kind: null }, null,
  ]);
  assert.deepEqual(images, [{ id: ID(0), label: 'Checkout' }]);
  assert.deepEqual(actions.map((action) => [action.kind, action.target]), [['link', 'https://github.com/TXMSKA/HIVEM1ND/pull/61'], ['board', BOARD], ['task', 'project:shop:029']]);
  assert.deepEqual(messageParts(undefined), { images: [], actions: [] });
  assert.deepEqual(composerPart('link', ' https://example.com/a ', ' Docs '), { kind: 'link', path: 'https://example.com/a', label: 'Docs' });
  assert.equal(composerPart('link', 'ftp://example.com'), null);
  assert.equal(composerPart('link', 'https://example.com/a b'), null);
  assert.deepEqual(composerPart('task', 'root:12', ''), { kind: 'task', path: 'root:12' });
  assert.equal(composerPart('board', 'board-1'), null);
});

test('the gallery keeps its view and position per message and wraps around', () => {
  const store = new Map();
  const state = galleryState(store, 'm1', 3);
  assert.deepEqual(state, { view: 'carousel', index: 0 });
  assert.equal(galleryState(store, 'm1', 3), state);
  assert.equal(stepGallery(state, 3, -1).index, 2);
  assert.equal(stepGallery(state, 3, 1).index, 0);
  Object.assign(state, { view: 'wall', index: 9 });
  assert.deepEqual(galleryState(store, 'm1', 3), { view: 'carousel', index: 2 });
});

test('a carousel shows one picture, its strip and arrows, and opens the grid and the list', () => {
  const images = [{ id: ID(0), label: 'Checkout' }, { id: ID(1), label: '' }, { id: ID(2), label: '' }];
  const state = { view: 'carousel', index: 0 };
  let changes = 0;
  const loaded = { [ID(0)]: { url: 'blob:one' }, [ID(2)]: { failed: true } };
  const draw = () => renderGallery(document, { images, state, t, imageFor: (id) => loaded[id] ?? null, onChange: () => { changes += 1; } });
  let gallery = draw();
  assert.equal(gallery.getAttribute('data-view'), 'carousel');
  const stage = find(gallery, 'data-gallery-stage')[0];
  const picture = find(stage, 'data-gallery-image')[0];
  assert.equal(picture.tagName, 'IMG');
  assert.equal(picture.getAttribute('src'), 'blob:one');
  assert.equal(picture.getAttribute('alt'), 'Checkout');
  assert.equal(stage.getAttribute('aria-label'), 'Image 1 of 3');
  assert.deepEqual(find(gallery, 'data-gallery-view').map((button) => [button.getAttribute('data-gallery-view'), button.getAttribute('aria-pressed')]),
    [['carousel', 'true'], ['grid', 'false'], ['list', 'false']]);
  const strip = find(gallery, 'data-gallery-strip')[0];
  assert.deepEqual(find(strip, 'data-gallery-index').map((cell) => cell.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.equal(find(strip, 'data-state', 'loading')[0].textContent, 'Loading image');
  assert.equal(find(strip, 'data-state', 'failed')[0].textContent, 'The image could not be loaded.');
  find(gallery, 'data-action', 'gallery-next')[0].click();
  assert.equal(state.index, 1);
  stage.fire('keydown', { key: 'ArrowLeft' });
  stage.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(state.index, 2);
  stage.fire('pointerdown', { pointerType: 'touch', clientX: 200 });
  stage.fire('pointerup', { clientX: 120 });
  assert.equal(state.index, 0, 'a swipe to the left shows the next picture');
  find(strip, 'data-gallery-index', '1')[0].click();
  assert.equal(state.index, 1);
  assert.equal(changes, 5);

  find(gallery, 'data-gallery-view', 'grid')[0].click();
  gallery = draw();
  assert.equal(find(gallery, 'data-gallery-stage').length, 0);
  const grid = find(gallery, 'data-gallery-grid')[0];
  assert.equal(find(grid, 'data-gallery-index').length, 3);
  find(grid, 'data-gallery-index', '2')[0].click();
  assert.deepEqual(state, { view: 'carousel', index: 2 });

  state.view = 'list';
  gallery = draw();
  assert.deepEqual(find(gallery, 'data-gallery-list')[0].children.map((row) => row.textContent),
    ['Checkout', 'Loading imageImage 2', 'The image could not be loaded.Image 3']);
});

test('one picture is shown alone, without strip, arrows or view switch', () => {
  const gallery = renderGallery(document, { images: [{ id: ID(0), label: '' }], state: { view: 'grid', index: 4 }, t, imageFor: () => null, onChange() {} });
  assert.equal(find(gallery, 'data-gallery-view').length, 0);
  assert.equal(find(gallery, 'data-gallery-strip').length, 0);
  assert.equal(find(gallery, 'data-action', 'gallery-next').length, 0);
  assert.equal(find(gallery, 'data-gallery-stage')[0].getAttribute('tabindex'), null);
});

test('a link opens outside the app and the other buttons open their board, text or task', () => {
  const opened = [];
  const actions = messageParts([{ kind: 'link', path: 'https://github.com/TXMSKA/HIVEM1ND/pull/61' }, { kind: 'link', path: 'mailto:team@example.com', label: 'Write' },
    { kind: 'board', path: BOARD }, { kind: 'task', path: 'project:shop:029' }]).actions;
  const row = renderActions(document, actions, { t, titleOf: (action) => action.kind === 'board' ? 'Checkout flow' : '', onOpen: (action) => opened.push(action.target) });
  const [link, mail, board, task] = row.children;
  assert.equal(link.tagName, 'A');
  assert.deepEqual([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel'), link.textContent], ['https://github.com/TXMSKA/HIVEM1ND/pull/61', '_blank', 'noopener noreferrer', 'github.com']);
  assert.equal(mail.textContent, 'Write');
  assert.equal(board.tagName, 'BUTTON');
  assert.equal(board.textContent, 'Checkout flow');
  assert.equal(task.textContent, 'Task 029');
  board.click();
  task.click();
  assert.deepEqual(opened, [BOARD, 'project:shop:029']);
  assert.equal(actionName({ kind: 'text', target: BOARD, label: '' }, t), 'Void text');
  assert.equal(actionName({ kind: 'link', target: 'mailto:team@example.com', label: '' }, t), 'team@example.com');
});

test('the attach dialog checks a link before adding it and offers boards, texts and tasks', () => {
  const added = [];
  const picked = [];
  const dialog = renderAttachDialog(document, { t, choices: { board: [{ id: BOARD, title: 'Checkout flow' }], task: [{ id: 'project:shop:029', title: '029 Release notes' }] },
    onImages: (files) => picked.push(...files), onAdd: (part) => added.push(part) });
  assert.equal(find(dialog, 'data-attach-choice', 'text').length, 0, 'no text is offered when there is none');
  const address = find(dialog, 'data-attach-link')[0];
  address.value = 'javascript:alert(1)';
  find(dialog, 'data-action', 'attach-link')[0].click();
  assert.equal(find(dialog, 'data-attach-error', 'link')[0].textContent, 'Type an http, https or mailto address.');
  assert.equal(address.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(added, []);
  address.value = 'https://example.com/spec';
  find(dialog, 'data-attach-link-name')[0].value = 'Spec';
  find(dialog, 'data-action', 'attach-link')[0].click();
  assert.deepEqual(added, [{ kind: 'link', path: 'https://example.com/spec', label: 'Spec' }]);
  assert.equal(dialog.removed, true, 'an addition closes the dialog');

  const again = renderAttachDialog(document, { t, choices: { board: [{ id: BOARD, title: 'Checkout flow' }] }, onImages: (files) => picked.push(...files), onAdd: (part) => added.push(part) });
  find(again, 'data-action', 'attach-board')[0].click();
  assert.equal(added.length, 1, 'nothing chosen adds nothing');
  find(again, 'data-attach-choice', 'board')[0].value = BOARD;
  find(again, 'data-action', 'attach-board')[0].click();
  assert.deepEqual(added.at(-1), { kind: 'board', path: BOARD, label: 'Checkout flow' });

  const images = renderAttachDialog(document, { t, onImages: (files) => picked.push(...files), onAdd() {} });
  const input = find(images, 'data-attach-images')[0];
  assert.equal(input.getAttribute('accept'), 'image/png,image/jpeg,image/webp');
  input.files = [{ name: 'shot.png' }];
  input.fire('change');
  assert.deepEqual(picked, [{ name: 'shot.png' }]);
});

test('the composer lists what will be sent and lets each part be taken out', () => {
  const removed = [];
  const parts = [{ kind: 'image', path: null, uploading: true, preview: 'blob:local' }, { kind: 'link', path: 'https://example.com', label: '' }];
  const row = renderPendingParts(document, parts, { t, titleOf: () => '', onRemove: (part) => removed.push(part) });
  assert.deepEqual(row.children.map((chip) => [chip.getAttribute('data-part'), chip.getAttribute('data-state')]), [['image', 'uploading'], ['link', 'ready']]);
  assert.equal(find(row.children[0], 'src', 'blob:local').length, 1);
  assert.match(row.children[0].textContent, /Uploading image/);
  const remove = find(row.children[1], 'data-action', 'remove-part')[0];
  assert.equal(remove.getAttribute('aria-label'), 'Remove example.com');
  remove.click();
  assert.deepEqual(removed, [parts[1]]);
});

test('a large picture is encoded the same as Node encodes it', () => {
  const bytes = randomBytes(0x8000 * 2 + 17);
  assert.equal(encodeBase64(new Uint8Array(bytes)), bytes.toString('base64'));
});
