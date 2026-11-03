import assert from "node:assert/strict";
import test from "node:test";
import { plainCaretFromSource, plainText, renderMarkup, sourceBoundary, tokenizeMarkup, validUtf16Boundary } from "../gui/app/markup.mjs";

test("Markdown, legacy, code, tables and literal HTML share reversible UTF-16 and newline offsets", () => {
  const source = "\r\n# Title\r\n\r\n<b>A😀</b> **bold** _italic_ ~~gone~~\r\n- One\r\n- Two\r\n> quote\r\n`<b>code</b>`\r\n\r\n\r\n";
  const visible = "\nTitle\n\nA😀 bold italic gone\nOne\nTwo\nquote\n<b>code</b>\n\n\n";
  assert.equal(plainText(source), visible);
  const tokens = tokenizeMarkup(source);
  for (let at = 0; at <= visible.length; at++) {
    if (!validUtf16Boundary(visible, at)) { assert.equal(sourceBoundary(source, at), null); continue; }
    for (const affinity of ["start", "end"]) {
      const boundary = sourceBoundary(source, at, affinity);
      assert.ok(validUtf16Boundary(source, boundary), `${at} ${affinity}`);
      assert.equal(plainCaretFromSource(tokens, boundary), at, `${at} ${affinity}`);
    }
  }
  const table = "| Left | Right |\r\n| --- | --- |\r\n| A\\|B | C |";
  assert.equal(plainText(table), "Left\tRight\nA|B\tC");
  assert.equal(plainText("```\r\n<b>literal</b>\r\n```"), "<b>literal</b>");
  const raw = '<script>alert(1)</script><img src=x onerror=run()> [X](javascript:run()) ![X](data:image/png;base64,x)';
  const rendered = renderMarkup(fakeDocument(), raw);
  assert.equal(textOf(rendered), raw);
  assert.equal(hasTag(rendered, "SCRIPT"), false); assert.equal(hasTag(rendered, "IMG"), false);
  const image = "![local](assets/11111111-1111-4111-8111-111111111111.png)";
  assert.equal(hasTag(renderMarkup(fakeDocument(), image), "IMG"), false);
  const assets = new Map([["assets/11111111-1111-4111-8111-111111111111.png", { url: "blob:verified" }]]);
  assert.equal(hasTag(renderMarkup(fakeDocument(), image, { assets }), "IMG"), true);
  assert.equal(hasTag(renderMarkup(fakeDocument(), "[site](https://example.test)"), "A"), true);
});

test("link recognition reads many open brackets in one pass and keeps the links beside them", () => {
  const adversarial = ["[".repeat(100000), "![".repeat(50000), `${"[".repeat(50000)}](${"x".repeat(50000)}`, `${"[".repeat(50000)}](${"x".repeat(50000)})`, "a [".repeat(33000)];
  const started = performance.now();
  for (const source of adversarial) assert.equal(plainText(source), source);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `Open brackets took ${Math.round(elapsed)} ms.`);
  const source = "[[ [x](https://a.test) [y](nope) ![i](assets/11111111-1111-4111-8111-111111111111.png)";
  assert.equal(plainText(source), "[ [x [y](nope) i");
  const opened = tokenizeMarkup(source).filter((token) => token.action === "open" && token.tag !== "p");
  assert.deepEqual(opened.map((token) => [token.tag, token.href ?? token.image, token.sourceStart, token.sourceEnd]),
    [["a", "https://a.test", 0, 1], ["span", "assets/11111111-1111-4111-8111-111111111111.png", 33, 35]]);
});

function fakeDocument() {
  const create = (tagName) => ({
    tagName,
    children: [],
    attributes: new Map(), listeners: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  });
  return {
    createDocumentFragment() { return create("#fragment"); },
    createElement(name) { return create(name.toUpperCase()); },
    createElementNS(_namespace, name) { return create(name.toUpperCase()); },
    createTextNode(text) { return { tagName: "#text", textContent: text, children: [], append() {} }; },
  };
}

function hasTag(node, name) {
  if (node.tagName === name) return true;
  return (node.children ?? []).some((child) => hasTag(child, name));
}

function textOf(node) {
  if (node.tagName === "#text") return node.textContent;
  return (node.children ?? []).map(textOf).join("");
}

