class Node {
  constructor(tag, nodeType = 1, text = '') { this.tagName = tag.toUpperCase(); this.nodeType = nodeType; this.attributes = {}; this.children = []; this.listeners = {}; this.textContent = text; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, action) { this.listeners[name] = action; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
}
export const document = { createElement: name => new Node(name), createElementNS: (_namespace, name) => new Node(name),
  createTextNode: text => new Node('#text', 3, String(text)) };
export function nodes(root) { return [root, ...root.children.flatMap(child => child?.nodeType ? nodes(child) : [])]; }
export function copy(root) { return nodes(root).map(node => node.textContent).filter(Boolean).join('\n'); }
