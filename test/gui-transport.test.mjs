import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ApiError, createApi, createOperation, dispose, fetchAsset, operationId, request, retryOperation } from "../gui/app/api.mjs";
import { FRAME_LIMIT, close, createSseParser, decodeEvent, reconnectDelay, subscribe, synchronize } from "../gui/app/stream.mjs";
import { acceptStreamEvent, applyEvent, applyReset, createStore, isAfterCursor, loadResource, loadSnapshot, setDraft } from "../gui/app/state.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";

const SERVICE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function envelope(data, cursor = `${SERVICE}:1`) {
  return {
    contract: "hivem1nd-gui-v3",
    data,
    meta: { requestId: "33333333-3333-4333-8333-333333333333", readAt: "2026-10-10T12:00:00.000Z", eventCursor: cursor, sync: "local" },
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness({ hash = "#session=desktop-token", fetch, origin = "http://127.0.0.1:9" } = {}) {
  const location = { origin, pathname: "/gui/viewer/", search: "?tab=map", hash };
  const history = {
    state: { kept: true },
    replaceState(state, title, url) {
      history.replaced = { state, title, url };
    },
  };
  const api = createApi({ location, history, fetch });
  return { api, location, history };
}

function unitEvent(id, unit) {
  return {
    id,
    name: "unit.changed",
    envelope: {
      contract: "hivem1nd-events-v3",
      at: "2026-10-10T12:00:00.000Z",
      machine: "DESKTOP",
      source: { kind: "gui", id: "fixture", unitId: "root:master" },
      data: { unit },
    },
  };
}

async function filesUnder(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    found.push(full);
    if (entry.isDirectory()) await filesUnder(full, found);
  }
  return found;
}

function waitFor(predicate, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 10);
  });
}

test("credentials are read once and API routes keep a single prefix", async () => {
  const calls = [];
  const { api, history } = harness({
    hash: "#session=desktop-token&panel=chats",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, envelope({ ok: true }));
    },
  });
  assert.equal(api.token, "desktop-token");
  assert.equal(history.replaced.url, "/gui/viewer/?tab=map#panel=chats");
  assert.equal(history.replaced.url.includes("desktop-token"), false);
  assert.equal(history.replaced.state.kept, true);
  const reopened = harness({ hash: "" }).api;
  assert.equal(reopened.token, null);
  assert.equal(reopened.homeKey, null);

  await request(api, "POST", "/auth/local", { body: { embedded: false, hostOrigin: null, look: null, language: null }, headers: { Authorization: "Bearer bootstrap-secret" } });
  await request(api, "POST", "/auth/home", { body: { key: "home-key" } });
  await request(api, "GET", "/layout");
  await request(api, "GET", "/viewer");
  const events = [];
  await subscribe(api, {
    onEvent(event) { events.push(event); },
    lastEventId: `${SERVICE}:4`,
    query: { unitId: "root:master" },
  });
  const urls = calls.map((call) => call.url);
  assert.deepEqual(urls, [
    "http://127.0.0.1:9/api/v1/auth/local",
    "http://127.0.0.1:9/api/v1/auth/home",
    "http://127.0.0.1:9/api/v1/layout",
    "http://127.0.0.1:9/api/v1/viewer",
    "http://127.0.0.1:9/api/v1/events?unitId=root%3Amaster",
  ]);
  assert.equal(urls.some((url) => url.includes("/api/v1/api/v1")), false);
  assert.equal(calls[0].init.headers["Idempotency-Key"], undefined);
  assert.equal(calls[0].init.headers.Authorization, "Bearer bootstrap-secret");
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[4].init.headers.Authorization, "Bearer desktop-token");
  assert.equal(calls[4].init.headers["Last-Event-ID"], `${SERVICE}:4`);
  assert.equal(calls.some((call) => call.url.includes("desktop-token")), false);
});

test("path ids are encoded once and unsafe URLs never reach fetch", async () => {
  let called = false;
  const { api } = harness({
    fetch: async (url) => {
      called = true;
      assert.equal(url, "http://127.0.0.1:9/api/v1/units/root%3Amaster");
      return jsonResponse(200, envelope({ id: "root:master" }));
    },
  });
  await request(api, "GET", "/units/:unitId", { params: { unitId: "root:master" } });
  assert.equal(called, true);
  called = false;
  const blocked = ["http://127.0.0.1:9/layout", "//evil.example/layout", "/api/v1/layout", "/mcp", "layout"];
  for (const path of blocked) {
    await assert.rejects(() => request(api, "GET", path), (error) => error instanceof ApiError && error.code === "invalid_url");
  }
  await assert.rejects(() => request(api, "GET", "/units/:unitId", { params: { unitId: "root/master" } }), (error) => error.code === "invalid_path");
  assert.equal(called, false);
});

test("a verified asset URL is fetched directly with the bearer", async () => {
  const calls = [];
  const revoked = [];
  const { api } = harness({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(Uint8Array.of(1, 2, 3), { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  api.createObjectURL = () => "blob:picture";
  api.revokeObjectURL = (url) => revoked.push(url);
  const asset = await fetchAsset(api, { id: "picture", url: "http://127.0.0.1:9/api/v1/assets/picture", contentType: "image/png" });
  assert.equal(calls[0].url, "http://127.0.0.1:9/api/v1/assets/picture");
  assert.equal(calls[0].url.includes("/api/v1/api/v1"), false);
  assert.equal(calls[0].init.headers.Authorization, "Bearer desktop-token");
  assert.equal(asset.url, "blob:picture");
  dispose(api);
  assert.deepEqual(revoked, ["blob:picture"]);
  const rejected = harness({ fetch: async () => { throw new Error("fetched"); } }).api;
  rejected.token = "desktop-token";
  await assert.rejects(() => fetchAsset(rejected, { url: "http://evil.example/picture.png" }), (error) => error.code === "invalid_url");
});

test("retries reuse the operation id and body bytes", async () => {
  const bodies = [];
  const keys = [];
  const { api } = harness({
    fetch: async (_url, init) => {
      bodies.push(init.body);
      keys.push(init.headers["Idempotency-Key"]);
      return jsonResponse(200, envelope({ saved: true }));
    },
  });
  const input = { nodes: { "root:master": { x: 3, y: 4 } }, expectedRevision: "ab" };
  const operation = createOperation({ method: "PATCH", path: "/layout", body: input });
  input.nodes["root:master"].x = 9;
  assert.equal(operation.body.nodes["root:master"].x, 3);
  assert.match(operation.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(operationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await request(api, operation.method, operation.path, { operation });
  await retryOperation(api, operation);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(keys[0], operation.id);
  assert.equal(keys[1], operation.id);
});

test("the event parser accepts split UTF-8, mixed endings, and unknown events", () => {
  const note = "niño 日本語";
  const payload = {
    contract: "hivem1nd-events-v3",
    at: "2026-10-10T12:00:00.000Z",
    machine: "DESKTOP",
    source: { kind: "gui", id: "fixture", unitId: "root:master" },
    data: { note },
  };
  const frame = `: keepalive\r\nid: ${SERVICE}:2\r\nevent: future.added\ndata: ${JSON.stringify(payload)}\r\n\n`;
  const parser = createSseParser();
  const frames = [];
  for (const byte of new TextEncoder().encode(frame)) frames.push(...parser.pushBytes(Uint8Array.of(byte)));
  frames.push(...parser.finish());
  assert.equal(frames.length, 1);
  const decoded = decodeEvent(frames[0]);
  assert.equal(decoded.name, "future.added");
  assert.equal(decoded.envelope.data.note, note);
  assert.equal(decoded.id, `${SERVICE}:2`);

  const mixed = createSseParser();
  const joined = mixed.pushText("data: hello\rdata: niño\n\n");
  assert.equal(joined[0].data, "hello\nniño");
  const kept = mixed.pushText("id: keep\nid: drop\0this\ndata: hi\n\n");
  assert.equal(kept[0].id, "keep");
  const partial = createSseParser();
  partial.pushText("data: partial");
  assert.equal(partial.finish().length, 0);
});

test("a frame larger than 16 MB fails visibly", () => {
  const parser = createSseParser();
  assert.throws(() => parser.pushText(`data: ${"x".repeat(FRAME_LIMIT + 1)}\n`), (error) => error.code === "frame_too_large");
});

test("an expired approval keeps the desktop credential and home expiry clears it", async () => {
  const approval = harness({
    fetch: async () => jsonResponse(410, { error: { code: "approval_expired", message: "The approval has expired.", requestId: "x", details: {}, retryAt: null } }),
  }).api;
  const token = approval.token;
  await assert.rejects(request(approval, "POST", "/approvals/expired/answer", {
    body: { decision: "deny", expectedRevision: "a".repeat(64) },
  }), (error) => error.code === "approval_expired" && error.status === 410);
  assert.equal(approval.token, token);

  const capability = harness({
    fetch: async () => jsonResponse(410, { error: { code: "capability_expired", message: "The capability has expired.", requestId: "x", details: {}, retryAt: null } }),
  }).api;
  await assert.rejects(request(capability, "GET", "/view"), (error) => error.code === "capability_expired");
  assert.equal(capability.token !== null, true);

  const home = harness({
    fetch: async () => jsonResponse(410, { error: { code: "home_expired", message: "Home access has expired.", requestId: "x", details: {}, retryAt: null } }),
  }).api;
  await assert.rejects(request(home, "GET", "/view"), (error) => error.code === "home_expired");
  assert.equal(home.token, null);

  const revoked = harness({
    fetch: async () => jsonResponse(401, { error: { code: "invalid_session", message: "The session is invalid.", requestId: "x", details: {}, retryAt: null } }),
  }).api;
  await assert.rejects(request(revoked, "GET", "/view"), (error) => error.status === 401);
  assert.equal(revoked.token, null);
});

test("reconnect waits on the capped schedule and stops when the credential ends", async () => {
  assert.equal(reconnectDelay(0, () => 0), 800);
  assert.equal(reconnectDelay(0, () => 1), 1200);
  assert.equal(reconnectDelay(0, () => 0.5), 1000);
  assert.equal(reconnectDelay(4, () => 0.5), 15000);
  assert.equal(reconnectDelay(9, () => 0.5), 15000);

  const delays = [];
  const store = createStore();
  setDraft(store, "doc", { text: "keep" });
  const { api } = harness({
    fetch: async () => jsonResponse(401, { error: { code: "invalid_session", message: "The session is invalid.", requestId: "x", details: {}, retryAt: null } }),
  });
  const live = synchronize(api, store, {
    schedule(delay) { delays.push(delay); return 0; },
    random: () => 0,
    onEvent() {},
  });
  await waitFor(() => store.signedOut === 401);
  assert.equal(delays.length, 0);
  assert.equal(api.token, null);
  assert.equal(store.drafts.get("doc").text, "keep");
  close(live);

  const limited = [];
  const rateLimited = harness({
    fetch: async () => jsonResponse(429, { error: { code: "request_rate_limited", message: "Slow down.", requestId: "x", details: {}, retryAt: null } }, { "retry-after": "3" }),
  }).api;
  const rate = synchronize(rateLimited, createStore(), {
    schedule(delay) { limited.push(delay); return 0; },
    onEvent() {},
  });
  await waitFor(() => limited.length === 1);
  assert.equal(limited[0], 3000);
  close(rate);

  const expired = harness({
    fetch: async () => jsonResponse(410, { error: { code: "home_expired", message: "The home grant expired.", requestId: "x", details: {}, retryAt: null } }),
  });
  synchronize(expired.api, createStore(), { schedule() { throw new Error("reconnect"); }, onEvent() {} });
  await waitFor(() => expired.api.token === null);
});

test("snapshots, duplicate revisions, and late reads stay ordered", async () => {
  assert.equal(isAfterCursor("a".repeat(64), "b".repeat(64)), false);
  assert.equal(isAfterCursor(`${SERVICE}:5`, `${SERVICE}:4`), true);
  assert.equal(isAfterCursor(`${OTHER}:9`, `${SERVICE}:1`), false);

  const same = createStore();
  const sameApi = harness({ fetch: async () => { throw new Error("no get"); } }).api;
  await applyEvent(same, sameApi, unitEvent(`${SERVICE}:2`, { id: "root:master", revision: "aa", context: "two" }));
  await applyEvent(same, sameApi, unitEvent(`${SERVICE}:3`, { id: "root:master", revision: "aa", context: "three" }));
  assert.equal(same.indexes.units.get("root:master").context, "two");

  const gates = [deferred(), deferred()];
  let calls = 0;
  const raced = createStore();
  raced.indexes.units.set("root:master", { id: "root:master", revision: "aa", context: "before" });
  const racedApi = harness({
    fetch: async () => gates[calls++].promise,
  }).api;
  const first = loadResource(raced, racedApi, "/units/root%3Amaster", "unit:root:master");
  const second = loadResource(raced, racedApi, "/units/root%3Amaster", "unit:root:master");
  gates[1].resolve(jsonResponse(200, envelope({ id: "root:master", revision: "cc", context: "new" })));
  await second;
  gates[0].resolve(jsonResponse(200, envelope({ id: "root:master", revision: "bb", context: "old" })));
  const stale = await first;
  assert.equal(stale.stale, true);
  assert.equal(raced.indexes.units.get("root:master").context, "new");

  const during = deferred();
  const snapStore = createStore();
  const snapApi = harness({
    fetch: async (url) => {
      if (String(url).includes("/units/")) return during.promise;
      return jsonResponse(200, envelope({ units: [{ id: "root:master", revision: "dd", context: "SNAP" }], chats: [], tasks: [] }, `${SERVICE}:6`));
    },
  }).api;
  const late = loadResource(snapStore, snapApi, "/units/root%3Amaster", "unit:root:master");
  await loadSnapshot(snapStore, snapApi);
  during.resolve(jsonResponse(200, envelope({ id: "root:master", revision: "ee", context: "LATE" })));
  assert.equal((await late).stale, true);
  assert.equal(snapStore.indexes.units.get("root:master").context, "SNAP");

  const dirty = createStore();
  setDraft(dirty, "doc-1", { text: "mine" });
  dirty.indexes.editors.set("doc-1", { id: "doc-1", revision: "aa" });
  const editorGate = deferred();
  const dirtyApi = harness({ fetch: async () => editorGate.promise }).api;
  const conflict = applyEvent(dirty, dirtyApi, {
    id: `${SERVICE}:4`,
    name: "void.changed",
    envelope: { contract: "hivem1nd-events-v3", data: { resourceId: "doc-1", revision: "bb" } },
  });
  assert.equal(dirty.drafts.get("doc-1").text, "mine");
  assert.equal(dirty.conflicts.get("doc-1").revision, "bb");
  editorGate.resolve(jsonResponse(200, envelope({ id: "doc-1", revision: "bb", document: { text: "theirs" } })));
  await conflict;
  assert.equal(dirty.drafts.get("doc-1").text, "mine");

  const paged = createStore();
  const pagedApi = harness({
    fetch: async () => jsonResponse(413, { error: { code: "view_too_large", message: "The view is too large. Request each collection instead.", requestId: "x", details: { units: [{ id: "root:master" }] }, retryAt: null } }),
  }).api;
  const mode = await loadSnapshot(paged, pagedApi);
  assert.equal(mode.paged, true);
  assert.equal(paged.view, null);
  assert.equal(paged.indexes.units.size, 0);
});

test("replay advances the consumed cursor and keeps the snapshot cursor during reset", async () => {
  const api = harness({
    fetch: async () => jsonResponse(200, envelope({
      units: [{ id: "root:master", revision: "aa", context: "SNAP" }],
      chats: [],
      tasks: [],
    }, `${SERVICE}:1`)),
  }).api;
  const store = createStore();
  const live = unitEvent(`${SERVICE}:2`, { id: "root:master", revision: null, context: "from-event" });
  assert.equal((await acceptStreamEvent(store, api, live)).buffered, true);
  assert.equal((await acceptStreamEvent(store, api, live)).dropped, true);
  assert.equal(store.cursor, null);
  assert.equal(store.snapshotCursor, null);
  const loaded = await loadSnapshot(store, api);
  assert.equal(loaded.cursor, `${SERVICE}:1`);
  assert.equal(store.snapshotCursor, `${SERVICE}:1`);
  assert.equal(store.cursor, `${SERVICE}:2`);
  assert.equal(store.indexes.units.get("root:master").context, "from-event");
  const repeated = await acceptStreamEvent(store, api, live);
  assert.equal(repeated.dropped, true);
  assert.equal(store.indexes.units.get("root:master").context, "from-event");
  assert.equal(store.cursor, `${SERVICE}:2`);
  const older = await acceptStreamEvent(store, api, unitEvent(`${SERVICE}:1`, { id: "root:master", revision: null, context: "old" }));
  assert.equal(older.dropped, true);
  assert.equal(store.indexes.units.get("root:master").context, "from-event");

  const gate = deferred();
  const resetting = createStore();
  resetting.snapshotCursor = `${SERVICE}:1`;
  resetting.cursor = `${SERVICE}:1`;
  resetting.snapshotReady = true;
  const resetApi = harness({
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith("/view")) return gate.promise;
      if (target.endsWith("/settings")) return jsonResponse(200, envelope({ settings: { look: "modern" }, revision: "11" }, `${SERVICE}:3`));
      return jsonResponse(200, envelope({ revision: "11" }, `${SERVICE}:3`));
    },
  }).api;
  const pending = applyReset(resetting, resetApi);
  await waitFor(() => resetting.paused === true && resetting.cursor === null);
  assert.equal((await acceptStreamEvent(resetting, resetApi, unitEvent(`${SERVICE}:4`, { id: "root:master", revision: null, context: "after" }))).buffered, true);
  assert.equal((await acceptStreamEvent(resetting, resetApi, unitEvent(`${SERVICE}:4`, { id: "root:master", revision: null, context: "after" }))).dropped, true);
  assert.equal((await acceptStreamEvent(resetting, resetApi, unitEvent(`${SERVICE}:2`, { id: "root:master", revision: null, context: "ANCIENT" }))).buffered, true);
  assert.equal(resetting.snapshotCursor, `${SERVICE}:1`);
  gate.resolve(jsonResponse(200, envelope({
    units: [{ id: "root:master", revision: "aa", context: "SNAP" }],
    chats: [],
    tasks: [],
  }, `${SERVICE}:3`)));
  await pending;
  assert.equal(resetting.snapshotCursor, `${SERVICE}:3`);
  assert.equal(resetting.cursor, `${SERVICE}:4`);
  assert.equal(resetting.indexes.units.get("root:master").context, "after");
});

test("reset keeps the latest snapshot and drops a stale 400-item page", async () => {
  const calls = [];
  const resourceGate = deferred();
  const { api } = harness({
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/units/")) return resourceGate.promise;
      if (String(url).endsWith("/view")) {
        return jsonResponse(200, envelope({
          units: [{ id: "root:master", revision: "22", context: "latest", unit: "master" }],
          chats: [],
          tasks: [],
        }, `${SERVICE}:8`));
      }
      return jsonResponse(200, envelope({ revision: "22" }));
    },
  });
  const store = createStore();
  store.capabilities = ["viewer.write"];
  store.selected.unitId = "root:master";
  store.viewport.scale = 2;
  setDraft(store, "doc", { text: "keep" });
  store.pages.set("units", { items: Array.from({ length: 400 }, (_, index) => index) });
  store.buffer.push(unitEvent(`${SERVICE}:3`, { id: "root:master", revision: "ff", context: "ANCIENT" }));
  store.buffer.push(unitEvent(`${SERVICE}:12`, { id: "root:master", revision: "33", context: "from-event" }));
  const reset = applyReset(store, api);
  await waitFor(() => calls.some((url) => url.includes("/units/")));
  assert.equal(store.indexes.units.get("root:master").context, "latest");
  resourceGate.resolve(jsonResponse(200, envelope({ id: "root:master", revision: "33", context: "newest" })));
  await reset;
  assert.equal(store.indexes.units.get("root:master").context, "newest");
  assert.equal(store.pages.has("units"), false);
  assert.equal(store.selected.unitId, "root:master");
  assert.equal(store.viewport.scale, 2);
  assert.equal(store.drafts.get("doc").text, "keep");
  assert.equal(calls.some((url) => url.endsWith("/api/v1/view")), true);
  assert.equal(calls.some((url) => url.endsWith("/api/v1/settings")), true);
  assert.equal(calls.some((url) => url.endsWith("/api/v1/viewer")), true);
});

test("phone reset skips viewer, drains only after permitted reads, and keeps a failed reset recoverable", async () => {
  const calls = [];
  const { api } = harness({
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/view")) {
        return jsonResponse(200, envelope({
          units: [{ id: "root:master", revision: "22", context: "latest", unit: "master" }],
          chats: [],
          tasks: [],
        }, `${SERVICE}:8`));
      }
      if (String(url).endsWith("/settings")) return jsonResponse(200, envelope({ settings: { look: "modern" }, revision: "11" }));
      if (String(url).includes("/units/")) return jsonResponse(200, envelope({ id: "root:master", revision: "33", context: "from-event" }));
      return jsonResponse(403, { error: { code: "phone_read_only", message: "The phone cannot read this.", requestId: "x", details: {}, retryAt: null } });
    },
  });
  const phone = createStore();
  phone.capabilities = ["read", "chat.post", "task.accept"];
  phone.buffer.push(unitEvent(`${SERVICE}:12`, { id: "root:master", revision: "33", context: "from-event" }));
  await applyReset(phone, api);
  assert.equal(phone.paused, false);
  assert.equal(phone.failure, null);
  assert.equal(calls.some((url) => url.endsWith("/api/v1/viewer")), false);
  assert.equal(calls.some((url) => url.endsWith("/api/v1/settings")), true);
  assert.equal(phone.indexes.units.get("root:master").context, "from-event");

  const held = [];
  const failing = createStore();
  failing.capabilities = ["read"];
  failing.buffer.push(unitEvent(`${SERVICE}:4`, { id: "root:master", revision: "9", context: "waiting" }));
  const failingApi = harness({
    fetch: async (url) => {
      if (String(url).endsWith("/settings")) {
        return jsonResponse(500, { error: { code: "unavailable", message: "The service is unavailable.", requestId: "x", details: {}, retryAt: null } });
      }
      return jsonResponse(200, envelope({ units: [], chats: [], tasks: [] }, `${SERVICE}:2`));
    },
  }).api;
  await assert.rejects(applyReset(failing, failingApi), (error) => error.code === "unavailable");
  assert.equal(failing.paused, true);
  assert.equal(failing.failure.code, "unavailable");
  assert.equal(failing.buffer.length, 1);
  assert.equal(held.length, 0);
});

test("the fixture retries one lost layout write and reset sees the latest record", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const desktop = new URL(fixture.desktopUrl);
  const { api } = harness({ origin: fixture.origin, hash: desktop.hash, fetch: globalThis.fetch.bind(globalThis) });
  const store = createStore();
  await loadSnapshot(store, api);
  const before = store.indexes.units.get("root:master").context;
  await fixture.control.changeResource("root:master", "Latest note");
  const events = [];
  const stop = new AbortController();
  const stream = subscribe(api, {
    signal: stop.signal,
    lastEventId: "00000000-0000-4000-8000-000000000099:1",
    async onEvent(event) {
      events.push(event.name);
      if (event.name === "stream.reset") {
        store.buffer.push(unitEvent(OTHER + ":9", { id: "root:master", revision: "f".repeat(64), context: "ANCIENT" }));
        return applyReset(store, api);
      }
      const result = await acceptStreamEvent(store, api, event);
      if (!result?.dropped && !result?.buffered) result?.consume?.();
      return result;
    },
  });
  await waitFor(() => events.includes("stream.reset") && store.indexes.units.get("root:master").context.includes("Latest note"));
  assert.equal(store.indexes.units.get("root:master").context.includes("ANCIENT"), false);
  assert.notEqual(store.indexes.units.get("root:master").context, before);
  stop.abort();
  await stream.catch((error) => {
    if (error?.name !== "AbortError") throw error;
  });

  const current = await request(api, "GET", "/layout");
  const body = { nodes: { "root:master": { x: 500, y: 80 } }, expectedRevision: current.data.revision };
  const operation = createOperation({ method: "PATCH", path: "/layout", body });
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/layout", dropAfterCommit: true });
  await assert.rejects(() => request(api, operation.method, operation.path, { operation }));
  assert.equal(api.uncertain.has(operation.id), true);
  const saved = await retryOperation(api, operation);
  assert.equal(saved.data.layout.nodes["root:master"].x, 500);
  assert.equal(api.uncertain.has(operation.id), false);
  const ledgerFile = (await filesUnder(fixture.root)).find((file) => file.endsWith(`${path.sep}event-ledger.json`));
  const records = JSON.parse(await readFile(ledgerFile, "utf8")).records.filter((record) => record.name === "layout.changed");
  assert.equal(records.length, 1);
  const receipts = (await filesUnder(fixture.root)).filter((file) => file.includes(`${path.sep}receipts${path.sep}`) && file.endsWith(".json"));
  assert.equal(receipts.length, 1);

  const viewerId = desktop.pathname.split("/").filter(Boolean).at(-1);
  await fixture.control.revokeViewer(viewerId);
  await assert.rejects(() => request(api, "GET", "/viewer"), (error) => error.status === 401 && error.code === "invalid_session");
  assert.equal(api.token, null);
});
