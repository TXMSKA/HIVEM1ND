import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createApi, request } from "../gui/app/api.mjs";
import {
  applyWatch,
  createComment,
  createEditors,
  createResource,
  handleActivity,
  loadCatalog,
  loadComments,
  markDirty,
  noteRemote,
  openEditor,
  registerResource,
  replyComment,
  resolveComment,
  setAttachments,
  startWatch,
  stopWatch,
} from "../gui/app/editors.mjs";
import { FIXTURE_HOME_KEY } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";

test("editor comments, attachments and Watch stay on their own revisions", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const editors = createEditors();
  const boards = await loadCatalog(api, editors, "blueprint");
  const board = boards.find((item) => item.title === "Cart");
  const legacy = boards.find((item) => item.readOnly);
  assert.ok(board);
  assert.equal(legacy.legacy ?? null, null);
  const opened = await openEditor(api, editors, board);
  assert.equal(opened.kind, "blueprint");
  assert.notEqual(opened.revision, opened.commentsRevision);
  assert.notEqual(opened.revision, opened.attachmentRevision);
  const staleDocument = { ...editors, current: { ...opened, revision: "a".repeat(64) } };
  await assert.rejects(createComment(api, staleDocument, { quote: "aside" }, "Stale document"), (error) => error.code === "revision_conflict");
  const staleComments = { ...editors, current: { ...opened, commentsRevision: "b".repeat(64) } };
  await assert.rejects(createComment(api, staleComments, { quote: "aside" }, "Stale comments"), (error) => error.code === "revision_conflict");
  await assert.rejects(setAttachments(api, { ...editors, current: { ...opened, attachmentRevision: "c".repeat(64) } }, opened.attached), (error) => error.code === "revision_conflict");
  await assert.rejects(setAttachments(api, editors, ["missing-unit"]), (error) => error.code === "unknown_unit");
  await assert.rejects(setAttachments(api, editors, Array.from({ length: 257 }, (_, index) => `project:shop:unit-${index}`)), (error) => error.code === "invalid_body");
  const attached = await setAttachments(api, editors, ["project:shop:executor-shop", "project:shop:executor-shop", "env:web:overlord-web"]);
  assert.deepEqual(attached.data.attached, ["project:shop:executor-shop", "env:web:overlord-web"]);
  fixture.control.setNoticeFailure("project:shop:executor-shop");
  const created = await createComment(api, editors, { quote: "aside" }, "Unplaced note");
  assert.equal(created.data.thread.place, null);
  assert.equal(created.data.notifications[0].state, "failed");
  fixture.control.setNoticeFailure(null);
  const resolved = await resolveComment(api, editors, created.data.thread.id);
  assert.equal(resolved.data.thread.status, "resolved");
  const reopened = await replyComment(api, editors, created.data.thread.id, "Fixture reply");
  assert.equal(reopened.data.thread.status, "open");
  assert.equal(reopened.data.notifications[0].state, "pending");
  assert.equal(reopened.data.thread.messages.at(-1).text, "Fixture reply");
  const comments = await loadComments(api, editors);
  assert.ok(comments.data.items.some((thread) => thread.id === created.data.thread.id && thread.place == null));
  opened.draftText = "local draft";
  opened.dirty = true;
  editors.drafts.set(board.id, opened);
  await openEditor(api, editors, legacy);
  assert.equal(editors.current.authoritative.legacy.reason, "conversion_required");
  assert.equal(editors.current.authoritative.document, null);
  await openEditor(api, editors, board);
  assert.equal(editors.current.draftText, "local draft");
  assert.equal(editors.current.dirty, true);
  noteRemote(editors, { resourceId: board.id, revision: "d".repeat(64) });
  assert.equal(editors.current.draftText, "local draft");
  assert.equal(editors.current.conflict.revision, "d".repeat(64));
  await assert.rejects(startWatch(api, editors, { unitId: "root:master", resourceId: board.id }), (error) => error.code === "not_attached");
  const chats = await request(api, "GET", "/chats", { query: { limit: "50" } });
  const group = chats.data.items.find((chat) => chat.kind === "group");
  await assert.rejects(startWatch(api, editors, { unitId: "project:blog:executor-shop", chatId: group.id }), (error) => error.code === "invalid_chat_member");
  const waiting = await startWatch(api, editors, { unitId: "project:shop:executor-shop", resourceId: board.id });
  assert.equal(waiting.data.state, "waiting");
  await fixture.control.noteActivity({ unitId: "project:shop:executor-shop", resourceId: board.id, screenId: "empty" });
  const switched = await startWatch(api, editors, { unitId: "project:shop:executor-shop" });
  assert.equal(switched.data.state, "watching");
  assert.equal(switched.data.resourceId, board.id);
  const held = { ...editors.current, resourceId: "other-resource", dirty: true, draftText: "stay" };
  const heldEditors = { ...editors, current: held, watch: null, pendingStop: false };
  assert.equal(applyWatch(heldEditors, switched.data), null);
  assert.equal(held.draftText, "stay");
  const follow = createEditors();
  follow.viewport = { x: 1, y: 2, scale: 1 };
  follow.focus = { resourceId: board.id, screenId: null, range: null };
  assert.equal(handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, viewport: { x: 9, y: 9 } }).follow, false);
  follow.watch = { state: "watching", unitId: "env:web:overlord-web", resourceId: board.id };
  assert.equal(handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, viewport: { x: 8, y: 8 } }).follow, false);
  follow.watch = { state: "watching", unitId: "project:shop:executor-shop", resourceId: "other-resource" };
  assert.equal(handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id }).follow, false);
  assert.equal(follow.viewport.x, 1);
  follow.watch = { state: "watching", unitId: "project:shop:executor-shop", resourceId: board.id };
  const followed = handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, screenId: "empty", viewport: { x: 4, y: 5 } });
  assert.equal(followed.follow, true);
  assert.equal(follow.focus.screenId, "empty");
  follow.pendingStop = true;
  follow.viewport = { x: 3, y: 3, scale: 1 };
  assert.equal(handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, viewport: { x: 7, y: 7 } }).follow, false);
  assert.equal(follow.viewport.x, 3);
  const otherUrl = await fixture.control.openDesktop();
  const other = apiFrom(otherUrl);
  const otherEditors = createEditors();
  otherEditors.current = { resourceId: board.id };
  const otherWatch = await startWatch(other, otherEditors, { unitId: "project:shop:executor-shop", resourceId: board.id });
  await stopWatch(api, editors);
  assert.equal(editors.watch, null);
  await assert.rejects(stopWatch(other, { watch: { watchId: waiting.data.watchId } }), (error) => error.code === "not_found");
  assert.equal((await stopWatch(other, otherEditors)).status, 204);
  assert.notEqual(otherWatch.data.watchId, waiting.data.watchId);
  const firstPatch = markDirty(api, editors, apiCapabilities(), true);
  const secondPatch = markDirty(api, editors, apiCapabilities(), true);
  assert.equal(firstPatch, secondPatch);
  await firstPatch;
  assert.equal((await request(api, "GET", "/viewer")).data.dirty, true);
  const legacyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.mjs");
  const legacyBytes = await readFile(legacyFile);
  const registered = await registerResource(api, { kind: "blueprint", project: "shop", path: "docs/flows/boards/legacy-cart.mjs" });
  assert.equal(registered.status, 200);
  assert.equal(registered.data.legacy.reason, "conversion_required");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  await assert.rejects(registerResource(api, { kind: "blueprint", project: "shop", path: "../secret.json" }), (error) => error.code === "invalid_path");
  await assert.rejects(registerResource(api, { kind: "void", project: "shop", path: "docs/missing.json" }), (error) => error.code === "resource_not_found");
  const createdBoard = await createResource(api, "blueprint", { project: "shop", document: { formatVersion: 1, id: "fresh-board", title: "Fresh board" } });
  assert.equal(createdBoard.status, 201);
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  const phone = await phoneApi(fixture);
  await assert.rejects(registerResource(phone, { kind: "blueprint", project: "shop", path: "docs/flows/boards/cart.json" }), (error) => error.code === "phone_read_only");
  await assert.rejects(createResource(phone, "void", { project: "shop", path: "docs/fresh.json", document: { formatVersion: 1, id: "fresh-text", title: "Fresh" } }), (error) => error.code === "phone_read_only");
  const commentsFile = join(fixture.root, "repositories", "shop", "docs", "flows", "comments", "cart.json");
  const original = await readFile(commentsFile);
  await writeFile(commentsFile, "{");
  await fixture.control.refresh();
  await openEditor(api, editors, board);
  assert.equal(editors.error.code, "corrupt_resource");
  assert.equal(editors.current.draftText, "local draft");
  await writeFile(commentsFile, original);
});

test("a late editor read keeps the newer selection and draft", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let seen = 0;
  const api = createApi({
    location: { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=abc" },
    history: { replaceState() {} },
    fetch: async (url) => {
      const id = decodeURIComponent(String(url).split("/").at(-1));
      seen += 1;
      if (seen === 1) await gate;
      return new Response(JSON.stringify({
        contract: "hivem1nd-gui-v3",
        data: { id, kind: "blueprint", title: id, revision: "a".repeat(64), commentsRevision: null, attachmentRevision: null, attached: [], threads: [], document: { title: id } },
        meta: { requestId: "11111111-1111-4111-8111-111111111111", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1", sync: "local" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const editors = createEditors();
  const first = openEditor(api, editors, { id: "first-board", kind: "blueprint" });
  const second = openEditor(api, editors, { id: "second-board", kind: "blueprint" });
  release();
  await second;
  await first;
  assert.equal(editors.current.resourceId, "second-board");
  editors.current.draftText = "second draft";
  editors.current.dirty = true;
  let calls = 0;
  const phone = createApi({
    location: { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=phone" },
    history: { replaceState() {} },
    fetch: async () => {
      calls += 1;
      throw new Error("The phone does not call the viewer.");
    },
  });
  assert.equal(markDirty(phone, editors, ["read", "chat.post"], true), null);
  assert.equal(calls, 0);
  assert.equal(editors.current.draftText, "second draft");
});

function apiFrom(url) {
  const parsed = new URL(url);
  return createApi({
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: globalThis.fetch.bind(globalThis),
  });
}

function apiCapabilities() {
  return ["viewer.write"];
}

async function phoneApi(fixture) {
  const home = new URL(fixture.phoneUrl);
  const response = await fetch(`${home.origin}/api/v1/auth/home`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: home.origin },
    body: JSON.stringify({ key: FIXTURE_HOME_KEY }),
  });
  const json = await response.json();
  assert.equal(response.status, 200);
  return apiFrom(`${home.origin}/#session=${json.data.token}`);
}
