import assert from 'node:assert/strict';
import test from 'node:test';
import { namedIconButton } from '../gui/app/components.mjs';

function documentStub() {
  const node = (tag) => ({ tag, attributes: new Map(), children: [],
    setAttribute(key, value) { this.attributes.set(key, value); },
    addEventListener() {}, append(...items) { this.children.push(...items); } });
  return { createElement: node, createElementNS: (_namespace, tag) => node(tag) };
}
test('icon buttons require an accessible name and retain a hidden decorative icon', () => {
  const document = documentStub();
  assert.throws(() => namedIconButton(document, 'settings', '', () => {}), TypeError);
  const button = namedIconButton(document, 'settings', 'Settings', () => {});
  assert.equal(button.attributes.get('aria-label'), 'Settings');
  assert.equal(button.children[0].attributes.get('aria-hidden'), 'true');
});
