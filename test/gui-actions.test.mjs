import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createGuiFixture } from "./gui-fixture.mjs";
import { createApi, request } from "../gui/app/api.mjs";
import {
  acknowledgeVisible,
  applyMessageRead,
  createThread,
  incomingMessage,
  loadMessages,
  messageWindow,
  updateNearBottom,
  manageChat,
  openDirectChat,
  openGroupChat,
  openMailbox,
  postMessage,
  retryMessage,
} from "../gui/app/chats.mjs";
import {
  answerApproval,
  canAccept,
  changeTaskStatus,
  connectUnits,
  createUnit,
  revokeGrant,
  startSession,
  stopSession,
  trackAnswer,
  trackSessionRequest,
  undoTask,
} from "../gui/app/actions.mjs";
import { retryOperation } from "../gui/app/api.mjs";
import {
  applyRemoteLayout,
  createMap,
  flushLayout,
  keepLocalPosition,
  queueLayoutPatch,
  refreshCurrentLayout,
  retrySavedLayout,
  useIncomingPosition,
} from "../gui/app/map.mjs";

const SERVICE = "11111111-1111-4111-8111-111111111111";

function layout(nodes, revision = "a".repeat(64)) {
  return { layout: { nodes, groups: {} }, revision };
}

function envelope(nodes, revision, id) {
  return { id, envelope: { data: layout(nodes, revision) } };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function untilCalled(calls, count) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("The layout request was not sent.");
}

test("two rapid drags persist the latest coordinate and a remote move survives", async () => {
  const calls = [];
  const map = createMap({
    units: [{ id: "a" }, { id: "b" }],
    saved: layout({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }),
  });
  map.persist = true;
  const gate = deferred();
  map.transport = async (operation) => {
    calls.push(operation);
    await gate.promise;
    return { data: layout({ a: operation.body.nodes.a, b: { x: 9, y: 9 } }, "b".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 5, y: 5 });
  queueLayoutPatch(map, "a", { x: 8, y: 8 });
  const saving = flushLayout(map);
  gate.resolve();
  await saving;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.nodes.a, { x: 8, y: 8 });
  assert.equal(calls[0].body.nodes.b, undefined);
  assert.deepEqual(map.positions.b, { x: 9, y: 9 });
  assert.deepEqual(map.positions.a, { x: 8, y: 8 });
});

test("an unchanged-base conflict retries once with the latest revision and a new operation", async () => {
  const calls = [];
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const generation = () => map.pending.get("a")?.generation;
  map.transport = async (operation) => {
    calls.push(operation);
    if (operation.method === "GET") return { data: layout({ a: { x: 1, y: 1 } }, "b".repeat(64)) };
    const patches = calls.filter((item) => item.method === "PATCH").length;
    if (patches === 1) {
      const error = new Error("conflict");
      error.code = "revision_conflict";
      throw error;
    }
    if (patches > 2) throw new Error("retried more than once");
    return { data: layout({ a: operation.body.nodes.a }, "c".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 4, y: 4 });
  const pendingGeneration = generation();
  await flushLayout(map);
  const patches = calls.filter((item) => item.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.equal(patches[0].body.expectedRevision, "a".repeat(64));
  assert.equal(patches[1].body.expectedRevision, "b".repeat(64));
  assert.notEqual(patches[0].id, patches[1].id);
  assert.deepEqual(patches[1].body.nodes.a, { x: 4, y: 4 });
  assert.equal(map.pending.has("a"), false);
  assert.equal(pendingGeneration, 1);
  assert.deepEqual(map.positions.a, { x: 4, y: 4 });
});

test("a newer drag during an in-flight save keeps its generation and is persisted", async () => {
  const calls = [];
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const gate = deferred();
  map.transport = async (operation) => {
    calls.push(operation);
    if (calls.length === 1) await gate.promise;
    return { data: layout({ a: operation.body.nodes.a }, calls.length === 1 ? "b".repeat(64) : "c".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 5, y: 5 });
  const firstGeneration = map.pending.get("a").generation;
  const saving = flushLayout(map);
  queueLayoutPatch(map, "a", { x: 8, y: 8 });
  const latestGeneration = map.pending.get("a").generation;
  assert.equal(latestGeneration > firstGeneration, true);
  gate.resolve();
  await saving;
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.nodes.a, { x: 5, y: 5 });
  assert.deepEqual(calls[1].body.nodes.a, { x: 8, y: 8 });
  assert.notEqual(calls[0].id, calls[1].id);
  assert.equal(calls[1].body.expectedRevision, "b".repeat(64));
  assert.equal(map.pending.has("a"), false);
  assert.deepEqual(map.positions.a, { x: 8, y: 8 });
});

test("a newer drag during an unchanged-base conflict is saved with the latest revision", async () => {
  const calls = [];
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const gate = deferred();
  map.transport = async (operation) => {
    calls.push(operation);
    if (operation.method === "GET") return { data: layout({ a: { x: 1, y: 1 } }, "b".repeat(64)) };
    const patches = calls.filter((item) => item.method === "PATCH");
    if (patches.length === 1) {
      await gate.promise;
      const error = new Error("conflict");
      error.code = "revision_conflict";
      throw error;
    }
    return { data: layout({ a: operation.body.nodes.a }, "c".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 4, y: 4 });
  const saving = flushLayout(map);
  await untilCalled(calls, 1);
  const during = map.pending.get("a").generation;
  queueLayoutPatch(map, "a", { x: 8, y: 8 });
  assert.equal(map.pending.get("a").generation > during, true);
  gate.resolve();
  await saving;
  const patches = calls.filter((item) => item.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.equal(patches[1].body.expectedRevision, "b".repeat(64));
  assert.notEqual(patches[0].id, patches[1].id);
  assert.deepEqual(patches[1].body.nodes.a, { x: 8, y: 8 });
  assert.equal(map.pending.has("a"), false);
  assert.deepEqual(map.positions.a, { x: 8, y: 8 });
});

test("a remote layout event after commit does not restore the older response", async () => {
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const gate = deferred();
  map.transport = () => gate.promise.then(() => ({ data: layout({ a: { x: 4, y: 4 } }, "b".repeat(64)) }));
  queueLayoutPatch(map, "a", { x: 4, y: 4 });
  const saving = flushLayout(map);
  applyRemoteLayout(map, envelope({ a: { x: 7, y: 7 } }, "d".repeat(64), `${SERVICE}:3`));
  map.transport = async () => ({ data: layout({ a: { x: 7, y: 7 } }, "d".repeat(64)) });
  gate.resolve();
  await saving;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(map.authoritative.layout.nodes.a, { x: 7, y: 7 });
});

test("an event during the reconciliation GET invalidates that response", async () => {
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const gate = deferred();
  let reads = 0;
  map.transport = (operation) => {
    if (operation.method === "GET") {
      reads += 1;
      return gate.promise.then(() => ({ data: layout({ a: { x: 1, y: 1 } }, "e".repeat(64)) }));
    }
    const error = new Error("conflict");
    error.code = "revision_conflict";
    throw error;
  };
  map.positions.a = { x: 3, y: 3 };
  queueLayoutPatch(map, "a", map.positions.a);
  const saving = flushLayout(map);
  await new Promise((resolve) => setTimeout(resolve, 0));
  applyRemoteLayout(map, envelope({ a: { x: 6, y: 6 } }, "f".repeat(64), `${SERVICE}:4`));
  gate.resolve();
  await saving;
  await refreshCurrentLayout(map);
  assert.equal(reads >= 1, true);
  assert.equal(map.positions.a.x, 3);
});

test("a same-id conflict keeps the local draft or takes the incoming point", async () => {
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  map.transport = (operation) => {
    if (operation.method === "PATCH") {
      const error = new Error("conflict");
      error.code = "revision_conflict";
      throw error;
    }
    return { data: layout({ a: { x: 5, y: 5 } }, "f".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 3, y: 3 });
  await flushLayout(map);
  assert.deepEqual(map.layoutConflict.ids, ["a"]);
  map.transport = async (operation) => ({ data: layout({ a: operation.body.nodes.a }, "f".repeat(64)) });
  await keepLocalPosition(map, "a");
  assert.equal(map.layoutConflict, null);
  assert.deepEqual(map.positions.a, { x: 3, y: 3 });
  queueLayoutPatch(map, "a", { x: 4, y: 4 });
  map.transport = (operation) => {
    if (operation.method === "PATCH") {
      const error = new Error("conflict");
      error.code = "revision_conflict";
      throw error;
    }
    return { data: layout({ a: { x: 9, y: 9 } }, "1".repeat(64)) };
  };
  await flushLayout(map);
  useIncomingPosition(map, "a");
  assert.deepEqual(map.positions.a, { x: 9, y: 9 });
  assert.equal(map.pending.has("a"), false);
});

test("a lost layout response retries the same operation", async () => {
  const map = createMap({ units: [{ id: "a" }], saved: layout({ a: { x: 1, y: 1 } }) });
  const seen = [];
  map.transport = async (operation) => {
    seen.push(operation.id);
    if (seen.length === 1) throw new Error("socket dropped");
    return { data: layout({ a: operation.body.nodes.a }, "b".repeat(64)) };
  };
  queueLayoutPatch(map, "a", { x: 2, y: 2 });
  await flushLayout(map);
  assert.equal(map.retryOperation.method, "PATCH");
  await retrySavedLayout(map);
  assert.equal(seen[0], seen[1]);
  assert.deepEqual(map.authoritative.layout.nodes.a, { x: 2, y: 2 });
});

function apiWith(handler) {
  const location = { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=desktop-token" };
  return createApi({
    location,
    history: { replaceState() {} },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      const outcome = await handler({ method: options.method, path: decodeURIComponent(new URL(url).pathname), body, headers: options.headers });
      const status = outcome.status ?? 200;
      const payload = status >= 400
        ? { contract: "hivem1nd-gui-v3", error: outcome.error }
        : {
          contract: "hivem1nd-gui-v3",
          data: outcome.data ?? null,
          meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "0", sync: { mode: "snapshot" } },
        };
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    },
  });
}

test("a connection makes the target report to the source and keeps each result", async () => {
  const calls = [];
  const api = apiWith(async (call) => {
    calls.push(call);
    if (call.path.endsWith("/root:master/lead")) return { status: 422, data: null };
    if (call.path.endsWith("/project:shop:executor-shop/lead")) {
      return { data: { id: "project:shop:executor-shop", leadId: "env:web:overlord-web" } };
    }
    return { data: { id: "root:adjutant", leadId: "root:overseer" } };
  });
  const source = { id: "root:overseer", unit: "overseer", revision: "a".repeat(64) };
  const results = await connectUnits(api, source, [
    { id: "root:adjutant", unit: "adjutant", revision: "b".repeat(64) },
    { id: "root:master", unit: "master", role: "master", revision: "c".repeat(64) },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.leadId, "root:overseer");
  assert.equal(calls[0].body.confirmed, true);
  assert.equal(results[0].data.leadId, "root:overseer");
  assert.equal(results[1].error.code, "invalid_lead");
});

test("creating a unit names an unavailable machine before any success", async () => {
  const api = apiWith(async () => ({
    status: 409,
    error: { code: "machine_unavailable", message: "The machine is unavailable.", details: { machine: "OFFLINE" } },
  }));
  await assert.rejects(createUnit(api, {
    unit: "executor-shop", role: "executor", scope: { kind: "project", name: "shop" }, machine: "OFFLINE",
  }), (error) => error.code === "machine_unavailable" && error.details.machine === "OFFLINE");
});

test("a session stays queued until the request says otherwise and stop stays stopping", async () => {
  const api = apiWith(async (call) => {
    if (call.path.endsWith("/session")) return { status: 202, data: { requestId: "req-1", state: "queued" } };
    if (call.path.includes("/session-requests/")) return { data: { requestId: "req-1", state: "failed", error: { code: "launch_ambiguous" } } };
    return { status: 202, data: { sessionId: "ses-1", state: "stopping" } };
  });
  const started = await startSession(api, { id: "root:overseer", revision: "a".repeat(64) }, "cursor", "Look at the map");
  assert.equal(started.data.state, "queued");
  const tracked = await trackSessionRequest(api, "req-1");
  assert.equal(tracked.data.state, "failed");
  const stopped = await stopSession(api, "ses-1");
  assert.equal(stopped.data.state, "stopping");
});

test("the fixture keeps connection direction, refuses an unavailable machine, and queues a stop", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const before = await call(fixture, "GET", "/api/v1/units?limit=200");
  const unavailable = await call(fixture, "POST", "/api/v1/units", {
    unit: "executor-offline", role: "executor", scope: { kind: "project", name: "shop" }, machine: "OFFLINE", leadId: null, job: null, model: null,
  });
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.body.error.code, "machine_unavailable");
  assert.equal(unavailable.body.error.details.machine, "OFFLINE");
  const after = await call(fixture, "GET", "/api/v1/units?limit=200");
  assert.equal(after.body.data.items.length, before.body.data.items.length);
  const created = await call(fixture, "POST", "/api/v1/units", {
    unit: "executor-new", role: "executor", scope: { kind: "project", name: "shop" }, machine: "DESKTOP", leadId: null, job: null, model: null,
  });
  assert.equal(created.status, 201);
  const overseer = before.body.data.items.find((unit) => unit.id === "root:overseer");
  const adjutant = before.body.data.items.find((unit) => unit.id === "root:adjutant");
  const connected = await call(fixture, "PUT", "/api/v1/units/root%3Aadjutant/lead", {
    leadId: "root:overseer", confirmed: true, expectedRevision: adjutant.revision,
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.data.leadId, "root:overseer");
  assert.notEqual(connected.body.data.id, overseer.id);
  const started = await call(fixture, "POST", "/api/v1/units/root%3Aoverseer/session", {
    client: "cursor", prompt: null, expectedRevision: overseer.revision,
  });
  assert.equal(started.status, 202);
  assert.equal(started.body.data.state, "queued");
  const tracked = await call(fixture, "GET", `/api/v1/session-requests/${started.body.data.requestId}`);
  assert.equal(tracked.body.data.state, "queued");
  await fixture.control.setSession(started.body.data.requestId, "failed", "launch_ambiguous");
  const failed = await call(fixture, "GET", `/api/v1/session-requests/${started.body.data.requestId}`);
  assert.equal(failed.body.data.state, "failed");
  assert.equal(failed.body.data.error.code, "launch_ambiguous");
  const stopping = await call(fixture, "POST", "/api/v1/sessions/20c58b80-4d93-88cd-83b3-39d78f1d9d5d/stop", { confirmed: true });
  assert.equal(stopping.status, 202);
  assert.equal(stopping.body.data.state, "stopping");
  const remote = await call(fixture, "POST", "/api/v1/sessions/30c58b80-4d93-48cd-83b3-39d78f1d9d5d/stop", { confirmed: true });
  assert.equal(remote.status, 409);
  assert.equal(remote.body.error.code, "remote_session");
});

test("direct chats are reused, groups stay distinct, and unlisting keeps history", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const first = await openDirectChat(api, ["project:shop:executor-shop"]);
  const second = await openDirectChat(api, ["project:shop:executor-shop"]);
  assert.equal(first.data.id, second.data.id);
  assert.equal(second.status, 200);
  const left = await openGroupChat(api, ["project:shop:executor-shop", "env:web:overlord-web"]);
  const right = await openGroupChat(api, ["project:shop:executor-shop", "env:web:overlord-web"]);
  assert.equal(left.data.kind, "group");
  assert.equal(left.data.members.includes("root:master"), true);
  assert.notEqual(left.data.id, right.data.id);
  const hidden = await manageChat(api, left.data, { listed: false });
  assert.equal(hidden.data.listed, false);
  const thread = createThread(hidden.data);
  await loadMessages(api, thread);
  const before = thread.messages.map((message) => message.id);
  const listed = await request(api, "GET", "/chats");
  assert.equal(listed.data.items.some((chat) => chat.id === left.data.id), false);
  const retained = await request(api, "GET", "/chats", { query: { listed: "false" } });
  assert.equal(retained.data.items.some((chat) => chat.id === left.data.id), true);
  const reopened = await manageChat(api, hidden.data, { listed: true });
  const again = createThread(reopened.data);
  await loadMessages(api, again);
  assert.deepEqual(again.messages.map((message) => message.id), before);
});

test("a group post reaches every other member and a failed notice stays visible", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const opened = await openGroupChat(api, ["project:shop:executor-shop", "root:adjutant"]);
  fixture.control.setNoticeFailure("root:adjutant");
  const thread = createThread(opened.data);
  const posted = await postMessage(api, thread, { body: "All members can read this.", subject: "Release", priority: "normal" });
  assert.equal(posted.data.notifications.length, opened.data.members.length - 1);
  assert.equal(posted.data.notifications.find((item) => item.unitId === "root:adjutant").state, "failed");
  assert.equal(posted.data.notifications.find((item) => item.unitId === "project:shop:executor-shop").state, "pending");
  assert.equal(thread.composer, "");
  await loadMessages(api, thread);
  assert.equal(thread.messages.some((message) => message.body === "All members can read this."), true);
});

test("older pages prepend once and a late message stays unread until it is visible", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const opened = await openGroupChat(api, ["root:executive"]);
  await fixture.control.seedMessages(opened.data.id, 400);
  const thread = createThread(opened.data);
  await loadMessages(api, thread);
  assert.equal(thread.messages.length, 50);
  const anchor = thread.messages[0].id;
  await loadMessages(api, thread, true);
  assert.equal(thread.anchorId, anchor);
  assert.equal(thread.messages[50].id, anchor);
  assert.equal(new Set(thread.messages.map((message) => message.id)).size, thread.messages.length);
  const late = { id: "late-message", timestamp: "2026-10-10T11:00:00.000Z", body: "older", read: false };
  incomingMessage(thread, late);
  thread.visibleIds = new Set([thread.messages.at(-1).id]);
  assert.equal(acknowledgeVisible(thread).includes(late.id), false);
  thread.visibleIds.add(late.id);
  assert.equal(acknowledgeVisible(thread).includes(late.id), true);
  const host = { scrollHeight: 1000, scrollTop: 1000 - 640 - 24, clientHeight: 640 };
  assert.equal(updateNearBottom(thread, host), true);
  host.scrollTop -= 1;
  assert.equal(updateNearBottom(thread, host), false);
  const many = Array.from({ length: 1200 }, (_, index) => ({ id: `m${index}`, body: "x" }));
  const windowed = messageWindow(many, { nearBottom: true });
  assert.equal(windowed.items.length, 40);
  assert.equal(windowed.items[0].id, "m1160");
  const anchored = messageWindow(many, { nearBottom: false, anchorId: "m10" });
  assert.equal(anchored.items[0].id, "m10");
  assert.equal(anchored.items.length, 40);
  assert.equal(applyMessageRead(thread, { chatId: thread.chat.id, readerId: "project:shop:executor-shop", messageIds: [late.id] }), false);
  assert.equal(late.read, false);
  assert.equal(applyMessageRead(thread, { chatId: thread.chat.id, readerId: "root:master", messageIds: [late.id], unread: 0 }), true);
  assert.equal(late.read, true);
});

test("a lost chat post retries the same operation and a rate limit keeps the composer", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const opened = await openDirectChat(api, ["root:adjutant"]);
  const thread = createThread(opened.data);
  fixture.control.setFault({ method: "POST", path: `/api/v1/chats/${opened.data.id}/messages`, dropAfterCommit: true });
  await assert.rejects(postMessage(api, thread, { body: "Keep this draft" }));
  assert.equal(thread.composer, "Keep this draft");
  const operation = thread.operation;
  await retryMessage(api, thread);
  assert.equal(thread.composer, "");
  assert.equal(thread.messages[0].body, "Keep this draft");
  assert.equal(operation.id, thread.messages[0] && operation.id);
  const limited = createThread(opened.data);
  const slowing = apiWith(async () => ({ status: 429, error: { code: "rate_limited", message: "Slow down." } }));
  await assert.rejects(postMessage(slowing, limited, { body: "Still typing" }));
  assert.equal(limited.composer, "Still typing");
  assert.equal(limited.operation.body.body, "Still typing");
  const mailbox = await openMailbox(api, "project:blog:executor-shop", "all");
  assert.equal(mailbox.status, 200);
});

test("a second submit joins the in-flight post", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = apiWith(async () => {
    await gate;
    return { data: { message: { id: "m1", body: "one", timestamp: "2026-10-10T12:00:00.000Z" }, notifications: [] } };
  });
  const thread = createThread({ id: "chat-1" });
  const first = postMessage(api, thread, { body: "one" });
  const second = postMessage(api, thread, { body: "two" });
  assert.equal(first, second);
  release();
  await first;
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].body, "one");
});

test("accept omits a null note and send back keeps its note", async (context) => {
  const calls = [];
  const mock = apiWith(async (call) => {
    calls.push(call.body);
    return { data: { task: { id: "task-1", status: call.body.status, revision: "b".repeat(64) }, changeId: "change-1" } };
  });
  await changeTaskStatus(mock, { id: "task-1", revision: "a".repeat(64) }, "done", null);
  await changeTaskStatus(mock, { id: "task-1", revision: "a".repeat(64) }, "done", undefined);
  await changeTaskStatus(mock, { id: "task-1", revision: "a".repeat(64) }, "open", "Needs another pass");
  assert.equal(Object.hasOwn(calls[0], "note"), false);
  assert.equal(Object.hasOwn(calls[1], "note"), false);
  assert.equal(calls[2].note, "Needs another pass");

  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const tasks = await request(api, "GET", "/tasks", { query: { status: "open,review,done,closed", limit: "50" } });
  const ready = tasks.data.items.find((task) => task.id === "project:shop:029");
  const gated = tasks.data.items.find((task) => task.id === "project:shop:030");
  const rejected = await call(fixture, "POST", "/api/v1/tasks/project%3Ashop%3A029/status", {
    status: "done", note: null, expectedRevision: ready.revision,
  });
  assert.equal(rejected.status, 422);
  const rejectedNumber = await call(fixture, "POST", "/api/v1/tasks/project%3Ashop%3A029/status", {
    status: "done", note: 1, expectedRevision: ready.revision,
  });
  assert.equal(rejectedNumber.status, 422);
  const accepted = await changeTaskStatus(api, ready, "done");
  const undone = await undoTask(api, accepted.data.task);
  const returned = await changeTaskStatus(api, undone.data.task, "open", "Needs another pass");
  assert.equal(returned.data.task.status, "open");
  const noted = await request(api, "GET", "/tasks/project%3Ashop%3A029");
  assert.equal(noted.data.report.includes("Needs another pass"), true);
  assert.equal(gated.status, "review");
});

test("review, undo, and queued approval outcomes stay distinct", async (context) => {
  const fixture = await createGuiFixture();
  context.after(() => fixture.close());
  const api = fixtureApi(fixture);
  const tasks = await request(api, "GET", "/tasks", { query: { status: "open,review,done,closed", limit: "50" } });
  const ready = tasks.data.items.find((task) => task.id === "project:shop:029");
  const gated = tasks.data.items.find((task) => task.id === "project:shop:030");
  assert.equal(canAccept(gated), false);
  assert.equal(canAccept(ready), true);
  await assert.rejects(changeTaskStatus(api, gated, "done"), (error) => error.code === "review_not_ready");
  await assert.rejects(changeTaskStatus(api, ready, "open", " "), (error) => error.code === "note_required");
  const accepted = await changeTaskStatus(api, ready, "done");
  assert.equal(accepted.data.task.status, "done");
  const undone = await undoTask(api, accepted.data.task);
  assert.equal(undone.data.task.status, "review");
  await fixture.control.editTask("project:shop:029", "External edit");
  const current = await request(api, "GET", "/tasks/project%3Ashop%3A029");
  await assert.rejects(undoTask(api, undone.data.task), (error) => error.code === "undo_conflict");
  assert.equal(current.data.status, "review");
  const pending = await request(api, "GET", "/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ecf");
  const queued = await answerApproval(api, pending.data, "approve");
  assert.equal(queued.status, 202);
  assert.equal((await trackAnswer(api, pending.data.id, queued.data.answerId)).data.state, "queued");
  await fixture.control.settleAnswer(queued.data.answerId, "rejected");
  assert.equal((await trackAnswer(api, pending.data.id, queued.data.answerId)).data.state, "rejected");
  const denied = await request(api, "GET", "/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ec3");
  await assert.rejects(answerApproval(api, denied.data, "approve-always"), (error) => error.code === "always_unavailable");
  const unit = await request(api, "GET", "/units/project%3Ashop%3Aexecutor-shop");
  const grantId = unit.data.approvalGrants[0].id;
  const revocation = await revokeGrant(api, unit.data, grantId);
  assert.equal(revocation.data.state, "pending");
  const again = await retryOperation(api, revocation.operation);
  assert.equal(again.data.requestId, revocation.data.requestId);
  const expiredApi = fixtureApi(fixture);
  const expired = await request(expiredApi, "GET", "/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ec4");
  await assert.rejects(answerApproval(expiredApi, expired.data, "deny"), (error) => error.code === "approval_expired");
  assert.equal(expiredApi.token !== null, true);
  const desktopReturn = await changeTaskStatus(api, gated, "open", "Desktop send back");
  assert.equal(desktopReturn.data.task.status, "open");
});

function fixtureApi(fixture) {
  const desktop = new URL(fixture.desktopUrl);
  return createApi({
    location: { origin: desktop.origin, pathname: desktop.pathname, search: desktop.search, hash: desktop.hash },
    history: { replaceState() {} },
    fetch: globalThis.fetch.bind(globalThis),
  });
}

async function call(fixture, method, route, body) {
  const response = await fetch(`${fixture.origin}${route}`, {
    method,
    headers: {
      ...fixture.headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
