import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const failedStep = {
  id: "service",
  number: 4,
  language: "en",
  title: "Starting the local service",
  description: "The service did not start.",
  action: "Retry",
  back: true,
  busy: false,
  failure: { headline: "The service did not start", body: "The port is in use." },
  progress: [{ id: "service", state: "fail", label: "Service", elapsedSeconds: 1 }],
  ui: {
    documentTitle: "HIVEM1ND setup",
    stepOfFour: "Step {step} of 4",
    step1Title: "Install",
    step2Title: "Location",
    step3Title: "Service",
    step4Title: "Ready",
    back: "Back",
    progressFail: "Failed",
    progressDone: "Done",
    progressTodo: "Waiting",
    progressActive: "Working",
  },
};

test("a failed setup install clears the Retry spinner", async () => {
  const document = createWizardDocument();
  const session = new Map([["hivem1nd.session", "test-token"]]);
  const source = await readFile(new URL("../gui/app.js", import.meta.url), "utf8");
  const start = new AsyncFunction("document", "location", "sessionStorage", "history", "fetch", "window", "CSS", "setTimeout", source);
  await start(
    document,
    { hash: "#session=test-token", assign() {} },
    { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)) },
    { replaceState() {} },
    async (url) => {
      if (String(url).endsWith("/install")) return { ok: false, status: 500, json: async () => ({ error: { message: "The service did not start." } }) };
      return { ok: true, status: 200, json: async () => ({ data: failedStep }) };
    },
    {},
    { escape: (value) => String(value) },
    (fn) => setTimeout(fn, 0),
  );
  const button = document.getElementById("continue-button");
  assert.equal(button.textContent, "Retry");
  await document.getElementById("step-form").listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(button.textContent, "Retry");
  assert.equal(button.querySelector(".button-spinner"), null);
  assert.equal(button.disabled, false);
  assert.equal(document.getElementById("step-form").getAttribute("aria-busy"), "false");
});

function createWizardDocument() {
  const nodes = new Map();
  const tags = {
    progress: "ol",
    "step-form": "form",
    fields: "div",
    preview: "div",
    "step-title": "h1",
    "step-description": "p",
    "status-message": "div",
    "live-status": "p",
    "back-button": "button",
    "continue-button": "button",
    "mode-dialog": "dialog",
    "mode-dialog-title": "h2",
    "mode-dialog-copy": "p",
    "mode-dialog-close": "button",
    "step-card": "section",
    "language-panel": "div",
  };
  function make(tag) {
    const node = {
      tag,
      id: "",
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      open: false,
      children: [],
      parent: null,
      attributes: new Map(),
      dataset: {},
      listeners: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === "class") this.className = String(value);
        if (name === "id") { this.id = String(value); nodes.set(this.id, this); }
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      },
      append(...kids) {
        for (const kid of kids) { if (kid) { kid.parent = this; this.children.push(kid); } }
      },
      prepend(...kids) {
        for (const kid of kids) { if (kid) { kid.parent = this; this.children.unshift(kid); } }
      },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() {},
      querySelector(selector) { return find(this, selector)[0] ?? null; },
      querySelectorAll(selector) { return find(this, selector); },
    };
    Object.defineProperty(node, "textContent", {
      get() { return this.children.length ? this.children.map((child) => child.textContent ?? "").join("") : this.ownText ?? ""; },
      set(value) { this.ownText = String(value); this.children = []; },
    });
    Object.defineProperty(node, "firstElementChild", { get() { return this.children.find((child) => child.tag !== "#text") ?? null; } });
    return node;
  }
  function find(node, selector) {
    const found = [];
    const visit = (current) => {
      for (const child of current.children ?? []) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(node);
    return found;
  }
  function matches(node, selector) {
    return selector.split(",").some((part) => {
      const token = part.trim();
      if (token.startsWith(".")) return String(node.className).split(/\s+/).includes(token.slice(1));
      return node.tag === token;
    });
  }
  const document = {
    documentElement: null,
    title: "",
    body: null,
    createElement(tag) {
      if (tag !== "template") return make(tag);
      const node = make("template");
      const content = make("#fragment");
      Object.defineProperty(node, "innerHTML", { set() { content.replaceChildren(make("svg")); } });
      Object.defineProperty(node, "content", { get() { return content; } });
      return node;
    },
    createTextNode(value) {
      const node = make("#text");
      node.textContent = String(value);
      return node;
    },
    getElementById(id) { return nodes.get(id) ?? null; },
    querySelector(selector) { return find(document.documentElement, selector)[0] ?? null; },
    querySelectorAll(selector) { return find(document.documentElement, selector); },
  };
  document.documentElement = make("html");
  document.body = make("body");
  document.documentElement.append(document.body);
  for (const [id, tag] of Object.entries(tags)) {
    const node = make(tag);
    node.id = id;
    nodes.set(id, node);
    document.body.append(node);
  }
  const brand = make("div");
  brand.className = "brand-lockup";
  document.body.append(brand);
  nodes.get("step-form").reportValidity = () => true;
  return document;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
