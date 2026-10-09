import assert from "node:assert/strict";
import test from "node:test";
import { watchLive } from "../features/blueprint/review/live.mjs";
import { createSketch } from "../features/blueprint/review/sketch.js";
import { addScreen, newSketch } from "../features/blueprint/review/sketch-format.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 3000) {
  const stop = Date.now() + ms;
  while (!check()) {
    if (Date.now() > stop) throw new Error("Waited for something that did not happen.");
    await pause(10);
  }
}

/** The part of EventSource that watchLive uses, driven by the test. */
class FakeStream {
  static last = null;

  constructor(route) {
    this.route = route;
    this.listeners = {};
    this.readyState = 0;
    FakeStream.last = this;
  }

  addEventListener(name, listener) {
    (this.listeners[name] ??= []).push(listener);
  }

  emit(name, data) {
    for (const listener of this.listeners[name] ?? []) listener({ data: JSON.stringify(data) });
  }

  close() {
    this.readyState = 2;
  }
}

const answer = (body) => async () => ({ ok: true, json: async () => body });

test("the page listens to the stream, reads again after a reconnect, and polls once the stream is closed for good", async (context) => {
  const heard = [];
  const resyncs = [];
  const asked = [];
  const watch = watchLive({
    source: FakeStream,
    fetcher: async (route) => {
      asked.push(route);
      return { ok: true, json: async () => ({ cursor: "a-1", resync: false, events: asked.length === 2 ? [{ project: "shop", kind: "comments", board: "checkout" }] : [] }) };
    },
    pollMs: 10,
    onChange: (change) => heard.push(change),
    onResync: () => resyncs.push(true),
  });
  context.after(() => watch.stop());
  const stream = FakeStream.last;
  assert.equal(stream.route, "/api/live");
  assert.equal(watch.mode(), "stream");

  stream.emit("ready", { cursor: "a-0" });
  assert.equal(resyncs.length, 0, "the first connection has nothing to catch up on");
  stream.emit("change", { project: "shop", kind: "sketch", board: "checkout" });
  assert.deepEqual(heard, [{ project: "shop", kind: "sketch", board: "checkout" }]);

  // The browser is trying again: still the stream, and when it is back the page reads again.
  stream.emit("error");
  assert.equal(watch.mode(), "stream");
  stream.emit("ready", { cursor: "a-0" });
  assert.equal(resyncs.length, 1);

  // Refused for good (readyState closed): the same route is asked on a timer.
  stream.readyState = 2;
  stream.emit("error");
  assert.equal(watch.mode(), "poll");
  assert.equal(resyncs.length, 2, "events may have been missed while no stream was open");
  await until(() => asked.length >= 3);
  assert.deepEqual(asked.slice(0, 3), ["/api/live", "/api/live?after=a-1", "/api/live?after=a-1"]);
  assert.deepEqual(heard.at(-1), { project: "shop", kind: "comments", board: "checkout" });
});

test("without EventSource the page polls at once, asks to read again when the server says so, and survives a server that does not answer", async (context) => {
  const heard = [];
  const resyncs = [];
  let turn = 0;
  const watch = watchLive({
    source: null,
    fetcher: async () => {
      turn += 1;
      if (turn === 2) throw new Error("down");
      if (turn === 3) return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ cursor: `a-${turn}`, resync: turn === 4, events: turn === 5 ? [{ project: "shop", kind: "board", board: "checkout" }] : [] }) };
    },
    pollMs: 10,
    onChange: (change) => heard.push(change),
    onResync: () => resyncs.push(turn),
  });
  assert.equal(watch.mode(), "poll");
  assert.deepEqual(resyncs, [0], "once, when polling begins");
  await until(() => heard.length === 1);
  assert.deepEqual(resyncs, [0, 4], "and again when the server asks for it");

  watch.stop();
  const stopped = turn;
  await pause(80);
  assert.ok(turn <= stopped + 1, "no more asking after stop");
});

/** Just enough of a page for sketch.js to be built and driven: every element is a blank, and fetch is the test's. */
function page(context) {
  const blank = () => ({
    dataset: {},
    style: { setProperty() {} },
    files: [],
    addEventListener() {},
    setAttribute() {},
    focus() {},
    select() {},
    click() {},
    closest: () => null,
    querySelector: () => blank(),
    querySelectorAll: () => [],
  });
  const kept = {};
  const set = (name, value) => {
    kept[name] = globalThis[name];
    globalThis[name] = value;
  };
  set("window", { addEventListener() {} });
  set("document", {
    documentElement: {},
    body: { dataset: {} },
    visibilityState: "visible",
    addEventListener() {},
    createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 10 }) }) }),
  });
  set("getComputedStyle", () => ({ getPropertyValue: () => "sans-serif" }));
  set("ResizeObserver", class { observe() {} });
  const calls = { stale: [], changed: [], saved: [] };
  const host = {
    $: () => blank(),
    stage: blank(),
    status() {},
    esc: String,
    titleBand: 28,
    screens: () => new Map(),
    sync() {},
    changed: (diff) => calls.changed.push(diff),
    stale: (on) => calls.stale.push(on),
    overlay() {},
    toScreen: (x, y) => [x, y],
    toWorld: (x, y) => [x, y],
    local: () => [0, 0],
    view: () => ({ k: 1, x: 0, y: 0 }),
    linkShapes: () => new Map(),
    reveal() {},
    frame() {},
    freeArea: () => ({ x: 0, y: 0, w: 1000, h: 800 }),
    mode: () => "sketch",
    sendOn: () => false,
    renderSend() {},
    askReference: async () => {},
    closeCards() {},
  };
  const disk = { value: null, delay: 0 };
  set("fetch", async (url, init) => {
    if (init?.method === "PUT") {
      await pause(disk.delay);
      calls.saved.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ revision: "r-saved" }) };
    }
    return { ok: true, status: 200, json: async () => disk.value };
  });
  context.after(() => {
    for (const [name, value] of Object.entries(kept)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  return { sketch: createSketch(host), calls, disk };
}

const entry = { project: "shop", id: "checkout" };
const titles = (sketch) => sketch.entries().map((item) => item.def.title);
const keys = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} };

/** The sketch as the page has it, and the same sketch after an agent added the screen Receipt. */
function sketches() {
  const mine = newSketch("checkout", "Checkout");
  addScreen(mine, { title: "Coupon", x: 0, y: 1000 });
  const theirs = structuredClone(mine);
  const receipt = addScreen(theirs, { title: "Receipt", x: 1800, y: 1000 });
  return { mine, theirs, receipt };
}

/** The person draws a screen: the page now holds a change it has not saved. */
function draw(sketch) {
  sketch.key({ ...keys, key: "f" }, { onBoard: true, onControl: false });
  sketch.key({ ...keys, key: "Enter" }, { onBoard: true, onControl: false });
}

test("a sketch an agent wrote replaces the one on the page when the person has nothing unsaved, and says what changed", async (context) => {
  const { sketch, calls, disk } = page(context);
  const { mine, theirs, receipt } = sketches();
  sketch.use(entry, { revision: "r1", sketch: mine, problem: null });
  disk.value = { revision: "r2", sketch: theirs, problem: null };

  await sketch.refresh({ notify: true });
  assert.deepEqual(titles(sketch), ["Coupon", "Receipt"]);
  assert.deepEqual(calls.changed, [[{ id: receipt.id, title: "Receipt", nodes: [], whole: true }]]);
  assert.equal(calls.stale.at(-1), false);

  await sketch.refresh({ notify: true });
  assert.equal(calls.changed.length, 1, "the same revision again changes nothing");
});

test("a sketch an agent wrote never replaces unsaved work: the page keeps it, shows the notice, and reloads when asked", async (context) => {
  const { sketch, calls, disk } = page(context);
  const { mine, theirs } = sketches();
  sketch.use(entry, { revision: "r1", sketch: mine, problem: null });
  draw(sketch);
  assert.deepEqual(titles(sketch), ["Coupon", "Screen 1"]);
  disk.value = { revision: "r2", sketch: theirs, problem: null };

  await sketch.refresh();
  assert.deepEqual(titles(sketch), ["Coupon", "Screen 1"], "regaining focus alone keeps the work");
  assert.equal(calls.stale.at(-1), false);
  assert.equal(calls.changed.length, 0);

  await sketch.refresh({ notify: true });
  assert.deepEqual(titles(sketch), ["Coupon", "Screen 1"], "the person's screen is still there");
  assert.equal(calls.stale.at(-1), true, "the notice is up");
  assert.equal(calls.changed.length, 0);

  await sketch.reload();
  assert.deepEqual(titles(sketch), ["Coupon", "Receipt"]);
  assert.equal(calls.stale.at(-1), false, "the notice goes with the reload");
  await pause(800);
  assert.equal(calls.saved.length, 0, "the pending save of the discarded work never ran");
});

test("a save in flight settles before the page decides what an outside change does to it", async (context) => {
  const { sketch, calls, disk } = page(context);
  const { mine, theirs } = sketches();
  sketch.use(entry, { revision: "r1", sketch: mine, problem: null });
  draw(sketch);
  disk.delay = 150;
  disk.value = { revision: "r2", sketch: theirs, problem: null };

  const saving = sketch.save();
  await pause(20);
  await sketch.refresh({ notify: true });
  await saving;
  assert.equal(calls.saved.length, 1, "the person's change was saved first");
  assert.deepEqual(titles(sketch), ["Coupon", "Receipt"], "then the newer file was taken, with nothing unsaved left to lose");
  assert.equal(calls.stale.at(-1), false);
});
