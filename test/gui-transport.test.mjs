import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ApiError, REQUEST_DEADLINE_MS, SEND_DEADLINE_MS, createApi, createOperation, dispose, fetchAsset, operationId, request, retryOperation } from "../gui/app/api.mjs";
import { FRAME_LIMIT, STREAM_HANDSHAKE_MS, STREAM_INACTIVITY_MS, STREAM_RETRY_ATTEMPTS, STREAM_RETRY_BUDGET_MS, close, createSseParser, decodeEvent, reconnectDelay, subscribe, synchronize } from "../gui/app/stream.mjs";
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

function controlEvent(name, id, data) {
  return {
    id,
    name,
    envelope: {
      contract: "hivem1nd-events-v3",
      at: "2026-10-10T12:00:00.000Z",
      machine: "DESKTOP",
      source: { kind: "service", id: "fixture", unitId: "root:master" },
      data,
    },
  };
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

test("success envelopes accept only the sync enum", async () => {
  const run = async (sync) => {
    const body = envelope({ ok: true });
    if (sync === undefined) delete body.meta.sync;
    else body.meta.sync = sync;
    const { api } = harness({ fetch: async () => jsonResponse(200, body) });
    try {
      return await request(api, "GET", "/view");
    } finally {
      dispose(api);
    }
  };
  for (const sync of ["local", "pending", "published"]) {
    const result = await run(sync);
    assert.equal(result.meta.sync, sync);
    assert.equal(result.data.ok, true);
  }
  for (const sync of [null, "", "remote", undefined]) {
    await assert.rejects(run(sync), (error) => error instanceof ApiError && error.status === 200 && error.code === "invalid_response");
  }
});

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

test("reconnection stops after a finite budget and keeps the session", async () => {
  assert.equal(STREAM_HANDSHAKE_MS, REQUEST_DEADLINE_MS);
  assert.equal(STREAM_INACTIVITY_MS, 45_000);
  assert.equal(STREAM_RETRY_ATTEMPTS, 5);
  assert.equal(STREAM_RETRY_BUDGET_MS, 30_000);

  async function exhaust(now, fetch) {
    const steps = [];
    const store = createStore();
    setDraft(store, "doc", { text: "keep" });
    const { api } = harness({ fetch });
    const token = api.token;
    const live = synchronize(api, store, {
      schedule(_delay, run) { steps.push(run); return steps.length; },
      now,
      random: () => 0.5,
      onEvent() {},
    });
    await waitFor(() => steps.length === 1 || store.stream?.state === "error");
    let runs = 0;
    while (store.stream?.state !== "error") {
      const run = steps.shift();
      assert.equal(typeof run, "function");
      run();
      runs += 1;
      assert.ok(runs <= STREAM_RETRY_ATTEMPTS);
      await waitFor(() => steps.length === 1 || store.stream?.state === "error");
    }
    assert.equal(store.stream.error, "reconnect_exhausted");
    assert.equal(store.drafts.get("doc").text, "keep");
    assert.equal(api.token, token);
    assert.equal(steps.length, 0);
    close(live);
    return runs;
  }

  const failures = await exhaust(() => 1000, async () => {
    throw new ApiError(0, "timeout", "The event stream timed out.");
  });
  assert.equal(failures, STREAM_RETRY_ATTEMPTS - 1);

  let clock = 10_000;
  const elapsedSteps = [];
  const elapsedStore = createStore();
  setDraft(elapsedStore, "doc", { text: "keep" });
  const elapsedApi = harness({
    fetch: async () => { throw new ApiError(0, "timeout", "The event stream timed out."); },
  }).api;
  const elapsedToken = elapsedApi.token;
  const elapsedLive = synchronize(elapsedApi, elapsedStore, {
    schedule(_delay, run) { elapsedSteps.push(run); return elapsedSteps.length; },
    now: () => clock,
    random: () => 0.5,
    onEvent() {},
  });
  await waitFor(() => elapsedSteps.length === 1);
  assert.equal(elapsedStore.stream.state, "reconnecting");
  clock = 10_000 + STREAM_RETRY_BUDGET_MS;
  elapsedSteps.shift()();
  await waitFor(() => elapsedStore.stream.state === "error");
  assert.equal(elapsedStore.stream.error, "reconnect_exhausted");
  assert.equal(elapsedStore.drafts.get("doc").text, "keep");
  assert.equal(elapsedApi.token, elapsedToken);
  assert.equal(elapsedSteps.length, 0);
  close(elapsedLive);

  const encoder = new TextEncoder();
  const ready = `event: stream.ready\ndata: ${JSON.stringify({ contract: "hivem1nd-events-v3", data: { cursor: `${SERVICE}:1` } })}\n\n`;
  let opened = 0;
  const afterReady = await exhaust(() => 1000, async () => {
    opened += 1;
    if (opened === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ready));
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    throw new ApiError(0, "timeout", "The event stream timed out.");
  });
  assert.equal(afterReady, STREAM_RETRY_ATTEMPTS);
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

test("reset and ready that share a cursor still publish desktop capabilities", async () => {
  const cursor = `${SERVICE}:4`;
  const reset = controlEvent("stream.reset", cursor, { reason: "service_restarted", cursor });
  const ready = controlEvent("stream.ready", cursor, {
    cursor,
    readAt: "2026-10-10T12:00:00.000Z",
    capabilities: ["read", "viewer.write", "layout.write"],
  });
  const early = createStore();
  const earlyApi = harness({
    fetch: async () => jsonResponse(200, envelope({ units: [], chats: [], tasks: [] }, cursor)),
  }).api;
  assert.equal((await acceptStreamEvent(early, earlyApi, reset)).buffered, true);
  assert.equal((await acceptStreamEvent(early, earlyApi, ready)).buffered, true);
  assert.equal((await acceptStreamEvent(early, earlyApi, ready)).dropped, true);
  await loadSnapshot(early, earlyApi);
  assert.deepEqual(early.capabilities, ["read", "viewer.write", "layout.write"]);

  const late = createStore();
  late.snapshotReady = true;
  late.cursor = cursor;
  late.snapshotCursor = cursor;
  const lateApi = harness({
    fetch: async () => jsonResponse(200, envelope({ units: [], chats: [], tasks: [] }, cursor)),
  }).api;
  const applied = await acceptStreamEvent(late, lateApi, ready);
  assert.equal(applied.dropped, undefined);
  assert.equal(applied.ready, true);
  assert.deepEqual(late.capabilities, ["read", "viewer.write", "layout.write"]);

  const resetting = createStore();
  resetting.snapshotReady = true;
  resetting.cursor = cursor;
  resetting.snapshotCursor = cursor;
  let reads = 0;
  const resetApi = harness({
    fetch: async () => {
      reads += 1;
      return jsonResponse(200, envelope({ units: [], chats: [], tasks: [], settings: { look: "modern" }, revision: "1" }, cursor));
    },
  }).api;
  const outcome = await acceptStreamEvent(resetting, resetApi, reset);
  assert.notEqual(outcome?.dropped, true);
  assert.equal(reads > 0, true);
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

test("stalled reads time out and a mutation retry keeps the same operation", async () => {
  assert.equal(REQUEST_DEADLINE_MS, 30_000);
  assert.equal(STREAM_HANDSHAKE_MS, REQUEST_DEADLINE_MS);
  assert.ok(STREAM_INACTIVITY_MS > STREAM_HANDSHAKE_MS);
  let held = 0;
  const { api } = harness({
    fetch: (_url, init) => new Promise((resolve, reject) => {
      held = api.controllers.size;
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (init.signal.aborted) fail();
      init.signal.addEventListener("abort", fail, { once: true });
    }),
  });
  const operation = createOperation({ method: "POST", path: "/units", body: { unit: "shop" } });
  await assert.rejects(request(api, "POST", "/units", { operation, deadlineMs: 40 }), (error) => error instanceof ApiError && error.code === "timeout");
  assert.equal(held, 1);
  assert.equal(api.controllers.size, 0);
  assert.equal(api.uncertain.get(operation.id).operation, operation);

  const keys = [];
  api.fetch = async (_url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    return jsonResponse(200, envelope({ id: "project:shop:shop" }));
  };
  const saved = await retryOperation(api, operation);
  assert.equal(keys[0], operation.id);
  assert.equal(saved.data.id, "project:shop:shop");
  assert.equal(api.uncertain.has(operation.id), false);

  const bodyHeld = harness({
    fetch: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        const fail = () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init.signal.aborted) fail();
        init.signal.addEventListener("abort", fail, { once: true });
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  }).api;
  let openDuringRead = 0;
  const stalled = request(bodyHeld, "GET", "/view", { deadlineMs: 5_000 });
  await waitFor(() => bodyHeld.controllers.size === 1);
  openDuringRead = bodyHeld.controllers.size;
  dispose(bodyHeld);
  await assert.rejects(stalled, (error) => error.name === "AbortError");
  assert.equal(openDuringRead, 1);
  assert.equal(bodyHeld.controllers.size, 0);

  const signal = AbortSignal.abort("caller");
  let relayed = false;
  const relayedApi = harness({
    fetch: async (_url, init) => {
      relayed = init.signal.aborted === true;
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  }).api;
  const callerOperation = createOperation({ method: "PATCH", path: "/layout", body: { nodes: {} } });
  await assert.rejects(
    request(relayedApi, "PATCH", "/layout", { operation: callerOperation, signal, deadlineMs: 500 }),
    (error) => error.name === "AbortError",
  );
  assert.equal(relayed, true);
  assert.equal(relayedApi.uncertain.has(callerOperation.id), false);

  const assets = harness({
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  }).api;
  await assert.rejects(
    fetchAsset(assets, { url: "http://127.0.0.1:9/api/v1/assets/picture" }, { deadlineMs: 30 }),
    (error) => error.code === "timeout",
  );
  assert.equal(assets.controllers.size, 0);
});

test("a stalled event stream reports reconnect instead of staying pending", async () => {
  const states = [];
  const { api } = harness({
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  });
  const store = createStore();
  const live = synchronize(api, store, {
    handshakeMs: 30,
    schedule() { return 0; },
    onState(state) { states.push(state.state); },
    onEvent() {},
  });
  await waitFor(() => states.includes("reconnecting"));
  assert.equal(states[0], "connecting");
  assert.equal(store.stream.state, "reconnecting");
  assert.equal(store.stream.error, "timeout");
  assert.ok(store.stream.retryIn > 0);
  close(live);

  const encoder = new TextEncoder();
  const quiet = harness({
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } }),
  }).api;
  const started = Date.now();
  await assert.rejects(
    subscribe(quiet, { handshakeMs: 1_000, inactivityMs: 40, onEvent() {} }),
    (error) => error.code === "timeout",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 30 && elapsed < 500);
});

test('the GUI response deadline covers thirty seconds independently of send deadlines', () => {
  const { api } = harness({ fetch: async () => jsonResponse(200, envelope({})) });
  assert.equal(api.deadlineMs, 30000);
  assert.equal(STREAM_HANDSHAKE_MS, 30000);
  dispose(api);
});

test('send timeout and general response timeout remain distinct', () => {
  assert.equal(SEND_DEADLINE_MS, 10000);
  assert.equal(REQUEST_DEADLINE_MS, 30000);
  assert.ok(SEND_DEADLINE_MS < REQUEST_DEADLINE_MS);
});

test('actual chat and mailbox posts time out at ten seconds and ordinary bodies at thirty seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [route, deadline] of [['/chats/chat-1/messages', 10000], ['/mailboxes/root%3Amaster/messages', 10000], ['/units', 30000]]) {
    const api = harness({ fetch: async () => new Response(new ReadableStream({ start() {} }), { status: 200 }) }).api;
    const operation = createOperation({ method: 'POST', path: route, body: { body: 'Retained' } });
    let settled = false;
    const pending = request(api, operation.method, operation.path, { operation });
    const rejected = assert.rejects(pending.finally(() => { settled = true; }), (error) => error.code === 'timeout');
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    t.mock.timers.tick(deadline - 1);
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    assert.equal(settled, false, route);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(api.uncertain.get(operation.id).operation, operation);
    assert.equal(api.controllers.size, 0);
    dispose(api);
  }
});

test("a paged store applies live events and leaves a reset unpaused", async () => {
  const tooLarge = () => jsonResponse(413, { error: { code: "view_too_large", message: "The view is too large. Request each collection instead.", requestId: "x" } });
  const api = harness({ fetch: async () => tooLarge() }).api;
  const store = createStore();
  assert.equal((await loadSnapshot(store, api)).paged, true);
  const event = { id: `${SERVICE}:7`, name: "unit.unread", envelope: { contract: "hivem1nd-events-v3", data: { unitId: "root:master", count: 3 } } };
  const applied = await acceptStreamEvent(store, api, event);
  assert.notEqual(applied?.dropped, true, "a paged store must not drop live events");
  applied.consume();
  assert.equal(store.cursor, `${SERVICE}:7`);
  await applyReset(store, api);
  assert.equal(store.paused, false, "a reset that ends paged resumes the stream");
  const later = await acceptStreamEvent(store, api, { ...event, id: `${SERVICE}:8` });
  assert.notEqual(later?.buffered, true);
  assert.equal((await applyEvent(store, api, { id: `${SERVICE}:9`, name: "additions.changed", envelope: { contract: "hivem1nd-events-v3", data: {} } })).applied, true, "a paged store does not ask for the whole view again");
});

test("a paged store does not ask for the whole view on view.changed, and takes a restarted service's events", async () => {
  const requests = [];
  const api = harness({ fetch: async (url) => { requests.push(String(url)); return jsonResponse(413, { error: { code: "view_too_large", message: "The view is too large.", requestId: "x" } }); } }).api;
  const store = createStore();
  await loadSnapshot(store, api);
  requests.length = 0;
  const changed = await applyEvent(store, api, { id: `${SERVICE}:5`, name: "view.changed", envelope: { contract: "hivem1nd-events-v3", data: { revision: "r1", collections: ["units"] } } });
  assert.equal(changed.applied, true);
  assert.equal(requests.some((url) => url.endsWith("/view")), false, "paged, view.changed reloads collections, not the view");
  const first = await acceptStreamEvent(store, api, { id: `${SERVICE}:9`, name: "unit.unread", envelope: { contract: "hivem1nd-events-v3", data: { unitId: "root:master", count: 1 } } });
  first.consume();
  const restarted = "22222222-2222-4222-8222-222222222222";
  const next = await acceptStreamEvent(store, api, { id: `${restarted}:1`, name: "unit.unread", envelope: { contract: "hivem1nd-events-v3", data: { unitId: "root:master", count: 2 } } });
  assert.notEqual(next?.dropped, true, "the first event of a restarted service is new, though its number is lower");
  next.consume();
  assert.equal(store.cursor, `${restarted}:1`);
});
