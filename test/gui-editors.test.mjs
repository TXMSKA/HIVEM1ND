import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createApi, createOperation, request } from "../gui/app/api.mjs";
import { editorDraftDocument, loadHistory, resolveEditorConflict, restoreEditorHistory } from "../gui/app/editors.mjs";
import { boundaryInsideTag, plainCaretFromSource, plainText, rangeRequest, renderMarkup, sourceBoundary, tokenizeMarkup, validUtf16Boundary } from "../gui/app/markup.mjs";
import { answerProposal, documentSaver, draftSnapshot, enterFocus, formatSelection, leaveFocus, moveFocus, rememberTextDraft, replaceVisible, saveRange, selectedPlainRange, showTools, textDraft, TEXT_FORMATS } from "../gui/app/void.mjs";
import {
  addNode,
  addBoardFrame,
  appendBoardNode,
  boardCommentAnchor,
  boardDocument,
  dragNodeGeometry,
  indexNodes,
  parentPoint,
  setBoardDraft,
  sketchStroke,
  touchedStrokes,
  collectAssetRefs,
  editedBoard,
  hitBoardNode,
  loadAssets,
  patchNode,
  removeNode,
  renderNode,
  replaceBoard,
  updateNodeOperation,
  uploadAsset,
} from "../gui/app/blueprint.mjs";
import {
  applyWatch,
  createComment,
  commentChoice,
  discardEditorDraft,
  noteComment,
  createEditors,
  createResource,
  handleActivity,
  loadCatalog,
  libraryState,
  groupCatalog,
  renderLibrary,
  duplicateEditor,
  moveEditor,
  loadComments,
  markDirty,
  noteRemote,
  openEditor,
  reapplyEditorDraft,
  reconcileEditor,
  refreshRemoteEditor,
  registerResource,
  replyComment,
  resolveComment,
  setAttachments,
  expandAttachments,
  startWatch,
  stopWatch,
} from "../gui/app/editors.mjs";
import { FIXTURE_HOME_KEY } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";
import { text } from "../gui/app/i18n.mjs";
import { importLegacyBoard, legacyModuleUrls } from "../gui/app/main.mjs";
import { validateSketch } from "../features/blueprint/review/sketch-format.mjs";

test("comment choice snapshots attached IDs and no attachments never change the shared preference", () => {
  const editors = createEditors();
  editors.current = { attached: ["root:one", "root:one", "root:master"] };
  const choice = commentChoice(editors);
  assert.deepEqual(choice.attached, ["root:one"]);
  assert.equal(choice.sendToAgent, true);
  editors.current.attached.push("root:two"); editors.sendToAgent = false;
  assert.deepEqual(choice.attached, ["root:one"]);
  assert.equal(choice.sendToAgent, true);
  assert.ok(Object.isFrozen(choice.attached));
  editors.current.attached = [];
  editors.sendToAgent = true;
  assert.equal(commentChoice(editors).sendToAgent, false);
  assert.equal(editors.sendToAgent, true);
});

test("both editor kinds save false notes with complete anchors and History and true sends notify each agent once", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), editors = createEditors();
  for (const kind of ["blueprint", "void"]) {
    const catalog = await loadCatalog(api, editors, kind);
    const current = await openEditor(api, editors, catalog.find((item) => !item.readOnly));
    await setAttachments(api, editors, ["project:shop:executor-shop"]);
    editors.sendToAgent = false;
    const anchor = kind === "void" ? welcomeAnchor() : canvasAnchor();
    const before = (await loadHistory(api, editors)).length;
    const note = await createComment(api, editors, anchor, "Keep a complete note");
    assert.deepEqual(note.data.thread.anchor, anchor);
    assert.equal(note.data.thread.messages[0].sendToAgent, false);
    assert.deepEqual(note.data.notifications, []);
    const reply = await replyComment(api, editors, note.data.thread.id, "Keep the reply too");
    assert.equal(reply.data.thread.messages.at(-1).sendToAgent, false);
    assert.deepEqual(reply.data.notifications, []);
    const history = await loadHistory(api, editors);
    assert.ok(history.length >= before + 2);
    assert.equal(history.filter((item) => item.operation === "comment").length, 2);
    await openEditor(api, editors, catalog.find((item) => item.id === current.resourceId));
    assert.equal(editors.current.threads.find((item) => item.id === note.data.thread.id).messages.length, 2);
    editors.sendToAgent = true;
    const sent = await createComment(api, editors, anchor, "Notify the attached agent");
    assert.equal(sent.data.thread.messages[0].sendToAgent, true);
    assert.deepEqual(sent.data.notifications, [{ unitId: "project:shop:executor-shop", state: "pending" }]);
  }
});

test("lost comment and reply responses retry their original boolean and body after a later toggle", async () => {
  for (const reply of [false, true]) {
    const editors = commentEditor(); editors.current.attached = ["root:one"]; editors.sendToAgent = false;
    const attempts = [];
    const api = commentApi(async (_url, init) => {
      attempts.push({ key: init.headers["Idempotency-Key"], body: JSON.parse(init.body) });
      if (attempts.length === 1) throw new Error("Response lost");
      return commentEnvelope({ thread: { id: "saved", messages: [{ text: "Original", sendToAgent: false }] }, commentsRevision: "d".repeat(64), notifications: [] });
    });
    let operation;
    const send = (retained) => reply ? replyComment(api, editors, "old-thread", "Original", retained) : createComment(api, editors, canvasAnchor(), "Original", retained);
    await assert.rejects(send(), (error) => { operation = error.operation; return Boolean(operation); });
    editors.sendToAgent = true; editors.current.attached = ["root:two"];
    editors.current.commentText = "Later typing";
    await send(operation);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(attempts[1].body.sendToAgent, false);
    assert.equal(editors.current.commentText, "Later typing");
  }
});

test("desktop import opens the real registered board beside its module with pages links styles and sketches", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const repo = join(fixture.root, "repositories", "shop"), file = join(repo, "docs/flows/boards/legacy-cart.mjs");
  const module = `import { board } from "blueprint/board.mjs";
import { col, row, text } from "blueprint/kit.mjs";
export default board({id: "legacy-cart", title: "Real cart", future: "kept",
pages: [{id: "one", title: "One", objects: [], order: ["first"]}, {id: "two", title: "Two", objects: [], order: ["second"]}],
screens: [{id: "first", title: "First", pageId: "one", w: 400, h: 300, root: col({pad: 10, fill: "surface", radius: "md"}, row({name: "continue"}, text("Actual cart", {size: 22, color: "accent"})))},
{id: "second", title: "Second", pageId: "two", root: col({}, text("Actual second page"))}], links: [{from: "first", to: "second", at: "continue", label: "Continue"}]});`;
  await writeFile(file, module); await writeFile(join(repo, "docs/flows/boards/index.json"), JSON.stringify([{ id: "legacy-cart", title: "Legacy cart", futureIndex: true }]));
  const { newSketch, addScreen } = await import("../features/blueprint/review/sketch-format.mjs");
  const sketch = newSketch("legacy-cart", "Cart sketch"), frame = addScreen(sketch, { title: "Real sketch", x: 0, y: 1000 });
  frame.root.kids.push({ id: "stroke", name: "Stroke", t: "vector", kind: "pen", place: { x: 10, y: 10 }, w: 40, h: 20, d: "M0 0 L100 100", stroke: "#123456", strokeWidth: 3, opacity: 0.5, future: "stroke kept" });
  await mkdir(join(repo, "docs/flows/sketches"), { recursive: true }); await writeFile(join(repo, "docs/flows/sketches/legacy-cart.json"), JSON.stringify(sketch));
  const originalStat = await stat(file);
  await fixture.control.refresh();
  const api = apiFrom(fixture.desktopUrl), editors = createEditors(); await loadCatalog(api, editors, "blueprint");
  const legacy = editors.catalog.find((item) => item.readOnly);
  const exported = await importLegacyBoard(api, legacy, { title: "Imported cart" }, null, async (manifest) => {
    const prior = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: (value) => ({ width: value.length * 8 }) }) }) };
    try {
      const urls = legacyModuleUrls(manifest, (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
      const [source, kit, skins, exporter, schema] = await Promise.all([urls.module, urls.kit, urls.skins, urls.exporter, urls.schema].map((url) => import(url)));
      kit.useSkin(skins.skins.design);
      return exporter.exportBoard(source.default, { layout: kit.layout, normalize: schema.normalizeBoard, skin: skins.skins.design, sketch: manifest.sketch });
    } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
  });
  assert.equal(exported.data.path, "docs/flows/boards/legacy-cart.json");
  const opened = await openEditor(api, editors, exported.data);
  assert.equal(opened.authoritative.readOnly, false); assert.equal(opened.authoritative.document.screens.length, 3);
  assert.deepEqual(opened.authoritative.document.pages.map((page) => page.id), ["one", "two", "sketch"]);
  assert.equal(opened.authoritative.document.screens[0].root.kids[0].kids[0].value, "Actual cart");
  assert.equal(opened.authoritative.document.screens[0].root.radius, 10);
  assert.equal(opened.authoritative.document.screens.at(-1).root.kids[0].future, "stroke kept");
  assert.equal(opened.authoritative.document.links[0].element, opened.authoritative.document.screens[0].root.kids[0].id);
  assert.equal(opened.authoritative.document.future, "kept");
  assert.equal(await readFile(file, "utf8"), module); assert.equal((await stat(file)).mtimeMs, originalStat.mtimeMs);
  await assert.rejects(importLegacyBoard(api, legacy, { project: "blog", title: "Wrong project" }), { code: "import_unavailable" });
  const phone = await phoneApi(fixture);
  await assert.rejects(request(phone, "GET", "/blueprint/boards/:resourceId/export", { params: { resourceId: legacy.id } }), { status: 403 });
});

test("an exporter failure creates no substitute and Retry reuses the exact imported document and operation", async () => {
  const source = { id: "11111111-1111-4111-8111-111111111111", project: "shop", readOnly: true };
  const manifest = { path: "docs/flows/boards/legacy.json", expectedRevision: "a".repeat(64), sourceRevisions: { module: "a".repeat(64), index: "b".repeat(64), sketch: null, kit: {} } };
  const writes = [], reads = [], document = { formatVersion: 1, id: "legacy", title: "Actual", screens: [{ id: "actual" }], unknown: true };
  const api = createApi({ location: { origin: "http://127.0.0.1:9", hash: "#session=fixture" }, history: { replaceState() {} }, fetch: async (url, init) => {
    if (init.method === "GET") { reads.push(url); return jsonResponse(manifest); }
    writes.push({ key: init.headers["Idempotency-Key"], body: init.body });
    if (writes.length === 1) throw new Error("Connection closed after storage");
    return jsonResponse({ id: "copy", document: JSON.parse(init.body).document });
  } });
  await assert.rejects(importLegacyBoard(api, source, { title: "Copy" }, null, async () => { throw new Error("Unsupported exporter"); }), { code: "import_unavailable" });
  assert.equal(writes.length, 0);
  let retained;
  try { await importLegacyBoard(api, source, { title: "Copy" }, null, async () => structuredClone(document)); } catch (error) { retained = error.operation; }
  assert.ok(retained);
  const result = await importLegacyBoard(api, source, { title: "Later title" }, retained, async () => { throw new Error("Retry must not export twice"); });
  assert.equal(reads.length, 2); assert.deepEqual(writes[0], writes[1]); assert.equal(result.data.document.unknown, true);
  assert.equal(JSON.parse(writes[1].body).title, "Copy");
});

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
  await assert.rejects(createComment(api, staleDocument, canvasAnchor(), "Stale document"), (error) => error.code === "revision_conflict");
  const staleComments = { ...editors, current: { ...opened, commentsRevision: "b".repeat(64) } };
  await assert.rejects(createComment(api, staleComments, canvasAnchor(), "Stale comments"), (error) => error.code === "revision_conflict");
  await assert.rejects(setAttachments(api, { ...editors, current: { ...opened, attachmentRevision: "c".repeat(64) } }, opened.attached), (error) => error.code === "revision_conflict");
  await assert.rejects(setAttachments(api, editors, ["missing-unit"]), (error) => error.code === "unknown_unit");
  await assert.rejects(setAttachments(api, editors, Array.from({ length: 257 }, (_, index) => `project:shop:unit-${index}`)), (error) => error.code === "invalid_body");
  const attached = await setAttachments(api, editors, ["project:shop:executor-shop", "project:shop:executor-shop", "env:web:overlord-web"]);
  assert.deepEqual(attached.data.attached, ["project:shop:executor-shop", "env:web:overlord-web"]);
  fixture.control.setNoticeFailure("project:shop:executor-shop");
  const created = await createComment(api, editors, canvasAnchor(), "Unplaced note");
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
  assert.ok(comments.items.some((thread) => thread.id === created.data.thread.id && thread.place == null));
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
  const ignored = handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, screenId: "empty", range: { start: 1 }, viewport: { x: 4, y: 5 } });
  assert.equal(ignored.follow, true);
  assert.equal(follow.focus.screenId ?? null, null);
  assert.equal(follow.viewport.x, 1);
  follow.current = {
    resourceId: board.id,
    authoritative: { document: { screens: [{ id: "empty", x: 10, y: 20, root: { id: "title", place: { x: 5, y: 6 }, kids: [] } }] } },
  };
  const followed = handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, kind: "blueprint", focus: { screenId: "empty", nodeId: "title" } });
  assert.equal(followed.follow, true);
  assert.equal(follow.focus.screenId, "empty");
  assert.equal(follow.focus.nodeId, "title");
  assert.equal(follow.viewport.x, 15);
  assert.equal(follow.viewport.y, 26);
  const ranged = handleActivity(follow, { unitId: "project:shop:executor-shop", resourceId: board.id, kind: "void", focus: { k: "intro", lang: "en", start: 1, end: 4 } });
  assert.equal(ranged.focus.k, "intro");
  assert.equal(ranged.focus.lang, "en");
  assert.equal(ranged.focus.start, 1);
  assert.equal(ranged.focus.end, 4);
  assert.equal(follow.current.page, "intro");
  follow.watch = { watchId: "watch-1", state: "watching", unitId: "project:shop:executor-shop", resourceId: board.id };
  assert.equal(applyWatch(follow, { watchId: "watch-1", unitId: "project:shop:executor-shop", resourceId: board.id, state: "stopped" }), null);
  assert.equal(follow.watch, null);
  assert.equal(applyWatch(follow, { watchId: "watch-1", state: "off" }), null);
  follow.watch = { state: "watching", unitId: "project:shop:executor-shop", resourceId: board.id };
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

test("a remote edit replaces clean content with its revision and keeps a dirty draft", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const editors = createEditors();
  const boards = await loadCatalog(api, editors, "blueprint");
  const board = boards.find((item) => item.title === "Cart");
  const opened = await openEditor(api, editors, board);
  const before = opened.revision;
  const beforeNote = opened.authoritative.document.note ?? "";
  noteRemote(editors, { resourceId: board.id, revision: "e".repeat(64) });
  assert.equal(editors.current.revision, before);
  assert.equal(editors.current.authoritative.document.note ?? "", beforeNote);
  assert.equal(editors.current.remoteStale, true);
  assert.equal(reconcileEditor(editors, { id: board.id, revision: "e".repeat(64), document: { note: "late" } }, 0), false);
  assert.equal(editors.current.authoritative.document.note ?? "", beforeNote);
  await fixture.control.editBoard(board.id);
  assert.equal(await refreshRemoteEditor(api, editors, board.id), true);
  assert.equal(String(editors.current.authoritative.document.note).includes("outside"), true);
  assert.notEqual(editors.current.revision, before);
  assert.equal(editors.current.baseRevision, editors.current.revision);
  assert.equal(editors.current.remoteStale, false);

  const base = editors.current.revision;
  editors.current.dirty = true;
  editors.current.draftText = "local draft";
  editors.current.baseRevision = base;
  noteRemote(editors, { resourceId: board.id, revision: "f".repeat(64) });
  assert.equal(editors.current.revision, base);
  assert.equal(editors.current.baseRevision, base);
  assert.equal(editors.current.draftText, "local draft");
  await fixture.control.editBoard(board.id);
  assert.equal(await refreshRemoteEditor(api, editors, board.id), true);
  assert.equal(editors.current.draftText, "local draft");
  assert.equal(editors.current.baseRevision, base);
  assert.equal(editors.current.revision, base);
  assert.equal(String(editors.current.conflict.remote.document.note).includes("outside"), true);
  const remoteRevision = editors.current.conflict.remote.revision;
  assert.equal(reapplyEditorDraft(editors), true);
  assert.equal(editors.current.draftText, "local draft");
  assert.equal(editors.current.baseRevision, remoteRevision);
  assert.equal(editors.current.conflict, null);
  const taken = { ...editors.current.authoritative, revision: "1".repeat(64), document: { ...editors.current.authoritative.document, note: "taken" } };
  editors.current.dirty = true;
  editors.current.draftText = "keep me";
  editors.current.conflict = { revision: taken.revision, remote: taken };
  assert.equal(discardEditorDraft(editors), true);
  assert.equal(editors.current.dirty, false);
  assert.equal(editors.current.draftText, "");
  assert.equal(editors.current.authoritative.document.note, "taken");
  assert.equal(editors.current.revision, "1".repeat(64));
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

test("blueprint edits keep unknown fields and refuse a lossy save", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  api.createObjectURL = () => "blob:asset";
  let revoked = false;
  api.revokeObjectURL = () => { revoked = true; };
  const editors = createEditors();
  const created = await createResource(api, "blueprint", { project: "shop", document: fullBoard() });
  await openEditor(api, editors, { id: created.data.id, kind: "blueprint" });
  const original = sentinels(editors.current.authoritative.document);
  assert.ok(original.includes("document-sentinel"));
  assert.throws(() => updateNodeOperation(editors.current, "label", { id: "other" }), /structural/i);
  await patchNode(api, editors.current, "label", { name: "Renamed" });
  const replaced = editedBoard(editors.current.authoritative, (document) => { document.title = "Retitled"; });
  const saved = await replaceBoard(api, editors.current, replaced.document);
  const after = sentinels(saved.data.document);
  for (const value of original) assert.ok(after.includes(value), value);
  assert.equal(saved.data.document.title, "Retitled");
  assert.equal(saved.data.document.screens[0].root.kids[0].name, "Renamed");
  assert.equal(saved.data.document.links[0].easing, "legacy-ease");
  assert.equal(saved.data.document.links[0].to, "missing-screen");
  const broken = structuredClone(saved.data.document);
  delete broken.sentinel;
  await assert.rejects(replaceBoard(api, editors.current, broken), (error) => error.code === "unsupported_fields_lost");
  assert.equal((await openEditor(api, editors, { id: created.data.id, kind: "blueprint" })).authoritative.document.sentinel, "document-sentinel");
  const stale = editors.current.revision;
  await patchNode(api, editors.current, "label", { value: "Next" });
  await assert.rejects(patchNode(api, { ...editors.current, revision: stale }, "label", { value: "Race" }), (error) => error.code === "revision_conflict");
  await assert.rejects(removeNode(api, editors.current, "root"), (error) => error.code === "root_node");
  const clip = hitBoardNode(fullBoard(), { x: 90, y: 10 });
  const outside = hitBoardNode(fullBoard(), { x: 110, y: 10 });
  assert.equal(clip.nodeId, "overflow");
  assert.equal(outside.nodeId, "root");
  const circle = hitBoardNode({
    screens: [{ id: "s", x: 0, y: 0, w: 100, h: 100, root: { id: "root", t: "box", place: { x: 0, y: 0 }, w: 100, h: 100, kids: [
      { id: "dot", t: "vector", kind: "circle", place: { x: 0, y: 0 }, w: 100, h: 100 },
    ] } }],
  }, { x: 1, y: 1 });
  assert.equal(circle.nodeId, "root");
  assert.equal(hitBoardNode({
    screens: [{ id: "s", x: 0, y: 0, w: 100, h: 100, root: { id: "root", t: "box", place: { x: 0, y: 0 }, w: 100, h: 100, kids: [
      { id: "dot", t: "vector", kind: "circle", place: { x: 0, y: 0 }, w: 100, h: 100 },
    ] } }],
  }, { x: 50, y: 50 }).nodeId, "dot");
  const asset = await uploadAsset(api, editors.current, { type: "image/png", arrayBuffer: async () => Buffer.from(PNG, "base64") });
  assert.match(asset.src, /^assets\/[0-9a-f-]{36}\.(png|jpg|webp)$/);
  assert.equal(asset.objectUrl, "blob:asset");
  asset.revoke();
  assert.equal(revoked, true);
  await assert.rejects(uploadAsset(api, editors.current, { type: "image/png", arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]) }), (error) => error.code === "invalid_asset");
  await assert.rejects(uploadAsset(api, editors.current, { type: "image/png", arrayBuffer: async () => new Uint8Array(10 * 1024 * 1024 + 1) }), (error) => error.code === "asset_too_large");
  const boards = await loadCatalog(api, editors, "blueprint");
  const cart = boards.find((item) => item.title === "Cart");
  const legacy = boards.find((item) => item.readOnly);
  const legacyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.mjs");
  const legacyBytes = await readFile(legacyFile);
  await openEditor(api, editors, legacy);
  await assert.rejects(replaceBoard(api, editors.current, fullBoard()), (error) => error.code === "read_only_resource");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  await openEditor(api, editors, cart);
  await removeNode(api, editors.current, "label");
  const comments = await loadComments(api, editors);
  const orphan = comments.items.find((thread) => thread.anchor?.element === "label");
  assert.ok(orphan);
  assert.equal(orphan.place, null);
  assert.equal(editors.current.authoritative.document.sentinel, "document-sentinel");
});

test("Void formats keep exact source, CRLF, and collapsed or unsafe selections unchanged", () => {
  const source = "One\r\nTwo";
  const expected = {
    bold: "**One**\r\n**Two**", italic: "_One_\r\n_Two_", strikethrough: "~~One~~\r\n~~Two~~",
    h1: "# One\r\n# Two", h2: "## One\r\n## Two", h3: "### One\r\n### Two",
    list: "- One\r\n- Two", quote: "> One\r\n> Two", code: "```\r\nOne\r\nTwo\r\n```",
    link: "[One](https://example.test/docs)\r\n[Two](https://example.test/docs)",
    table: "| One |  |\r\n| --- | --- |\r\n| Two |  |",
    image: "![One](assets/11111111-1111-4111-8111-111111111111.png)\r\n![Two](assets/11111111-1111-4111-8111-111111111111.png)",
  };
  for (const format of TEXT_FORMATS) {
    const target = format === "image" ? "assets/11111111-1111-4111-8111-111111111111.png" : "https://example.test/docs";
    const change = formatSelection(source, { start: 0, end: 7 }, format, target);
    if (format === "comment") assert.equal(change, null);
    else assert.equal(change.source, expected[format], format);
    assert.equal(formatSelection(source, { start: 2, end: 2 }, format), null);
  }
  assert.equal(formatSelection("A😀B", { start: 2, end: 3 }, "bold"), null);
  assert.throws(() => formatSelection("Word", { start: 0, end: 4 }, "link", "javascript:alert(1)"));
  assert.throws(() => formatSelection("Word", { start: 0, end: 4 }, "image", "assets/../secret.png"));
  assert.equal(formatSelection("One\r\nTwo", { start: 1, end: 2 }, "h2").source, "## One\r\nTwo");
});

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

test("in-place typing preserves unedited markup, empty strings, newlines and surrogate pairs", () => {
  const source = "# Title\r\n\r\n<b>A😀</b> **bold**\r\n";
  const visible = plainText(source), start = visible.indexOf("😀");
  const change = replaceVisible(source, { start, end: start + 2 }, "😊");
  assert.equal(change.source, source.replace("😀", "😊"));
  assert.equal(replaceVisible("<b>word</b>", { start: 0, end: 0 }, "X").source, "<b>Xword</b>");
  assert.equal(replaceVisible("**word**", { start: 0, end: 4 }, "").source, "****");
  assert.equal(plainText("****"), "");
  assert.equal(replaceVisible("", { start: 0, end: 0 }, "**literal**").source, "\\*\\*literal\\*\\*");
  assert.equal(plainText(replaceVisible("One\r\n", { start: 4, end: 4 }, "Two").source), "One\nTwo");
  assert.throws(() => replaceVisible(source, { start: start + 1, end: start + 2 }, ""));
  assert.equal(selectedPlainRange({ isCollapsed: true }), null);
});

test("one document saver retains later typing and retries its exact failed operation across pages and languages", async () => {
  const revision = "a".repeat(64);
  const document = { title: "Title", sentinel: { future: true }, pages: [{ k: "One", en: "Before", es: "Antes", sentinel: 7 }, { k: "Two", en: "Other", es: "Otro" }], rev: 1, history: [] };
  const editor = { resourceId: "text", revision, authoritative: { document, revision } };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const attempts = [], states = [];
  const api = createApi({ location: { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=fixture" }, history: { replaceState() {} }, fetch: async (_url, init) => {
    const body = JSON.parse(init.body); attempts.push({ key: init.headers["Idempotency-Key"], body });
    if (attempts.length === 1) { await gate; throw new Error("Response lost"); }
    return jsonResponse({ id: "text", revision: String(attempts.length).repeat(64), document: { ...body.document, rev: attempts.length } });
  } });
  const saver = documentSaver(api, editor, ({ state }) => states.push(state), 10000);
  rememberTextDraft(editor, "text", "One", "en", "First"); saver.queue(draftSnapshot(editor));
  const pending = saver.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  rememberTextDraft(editor, "text", "One", "en", "Later");
  rememberTextDraft(editor, "text", "Two", "es", "Después"); saver.queue(draftSnapshot(editor));
  release(); await assert.rejects(pending);
  assert.equal(editor.saveState, "not-saved");
  assert.equal(textDraft(editor, "text", "One", "en"), "Later");
  await saver.retry(); saver.dispose();
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(attempts[2].body.expectedRevision, "2".repeat(64));
  assert.equal(attempts[2].body.document.pages[0].en, "Later");
  assert.equal(attempts[2].body.document.pages[0].es, "Antes");
  assert.equal(attempts[2].body.document.pages[1].es, "Después");
  assert.deepEqual(attempts[2].body.document.sentinel, { future: true });
  assert.equal(attempts[2].body.document.pages[0].sentinel, 7);
  assert.equal(editor.dirty, false); assert.equal(editor.textDrafts.size, 0); assert.equal(editor.draftText, "");
  assert.equal(states.at(-1), "saved");
});

test("void edits keep source boundaries, history and proposals", async (t) => {
  const welcome = "<b>Welcome</b>\nA first paragraph.";
  assert.equal(plainText(welcome).slice(0, 7), "Welcome");
  assert.equal(sourceBoundary(welcome, 0, "end"), 3);
  assert.equal(welcome.slice(3, 10), "Welcome");
  assert.equal(boundaryInsideTag(welcome, 1), true);
  assert.throws(() => rangeRequest({ document: { pages: [{ k: "Intro.Welcome", en: welcome }] }, revision: "a".repeat(64) }, "Intro.Welcome", "en", 1, 2, "x"), /invalid/);
  const emoji = "A😀B";
  assert.equal(validUtf16Boundary(emoji, 2), false);
  assert.equal(validUtf16Boundary(emoji, 1), true);
  const rendered = renderMarkup(fakeDocument(), "<script>alert(1)</script><b>Hi</b>");
  assert.equal(hasTag(rendered, "SCRIPT"), false);
  assert.equal(hasTag(rendered, "B"), true);
  assert.match(textOf(rendered), /<script>alert\(1\)<\/script>/);
  const focus = enterFocus({ mode: "document", tools: true, page: "Intro.Welcome", pages: [{ k: "Intro.Welcome" }, { k: "Notes.Next" }] });
  moveFocus(focus, "ArrowRight");
  assert.equal(focus.page, "Notes.Next");
  assert.equal(focus.tools, false);
  moveFocus(focus, "ArrowRight");
  assert.equal(focus.page, "Notes.Next");
  showTools(focus);
  leaveFocus(focus);
  assert.equal(focus.mode, "document");
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const editors = createEditors();
  const origPath = join(fixture.root, "repositories", "shop", "docs", "release.orig.json");
  const historyPath = join(fixture.root, "repositories", "shop", "docs", "release.versions.jsonl");
  const original = await readFile(origPath);
  const historyBefore = (await readFile(historyPath, "utf8")).trim().split(/\n/).length;
  const texts = await loadCatalog(api, editors, "void");
  const release = texts.find((item) => item.title === "Release notes");
  await openEditor(api, editors, release);
  assert.equal(editors.current.authoritative.proposals, undefined);
  const proposal = editors.current.proposals.find((item) => item.replacement === "Hello");
  await answerProposal(api, editors.current, proposal, "accept");
  const document = editors.current.authoritative.document;
  assert.equal(document.pages[0].en.includes("<b>Hello</b>"), true);
  assert.equal(document.pages[0].es.includes("Bienvenida"), true);
  assert.equal(document.sentinel, "void-sentinel");
  assert.equal(document.pages[0].sentinel, "void-page-sentinel");
  assert.equal(document.rev, 2);
  assert.deepEqual(await readFile(origPath), original);
  assert.equal((await readFile(historyPath, "utf8")).trim().split(/\n/).length, historyBefore + 1);
  const second = editors.current.proposals.find((item) => item.replacement === "opening");
  await assert.rejects(answerProposal(api, editors.current, second, "accept"), (error) => error.code === "proposal_stale");
  assert.equal(second.state, "pending");
  const revision = editors.current.revision;
  await answerProposal(api, editors.current, second, "discard");
  assert.equal(editors.current.revision, revision);
  assert.equal(editors.current.proposals.find((item) => item.id === second.id).state, "discarded");
  assert.equal(editors.current.proposals.find((item) => item.replacement === "Hello").state, "accepted");
  assert.equal(editors.current.authoritative.proposals, undefined);
  const next = document.pages.find((page) => page.k === "Notes.Next");
  const applied = await saveRange(api, editors.current, "Notes.Next", "en", 0, next.en.length, "<b>Next 😀</b> <script>no</script>");
  assert.deepEqual(Object.keys(applied.data).sort(), ["editor", "proposal"]);
  assert.equal(applied.data.proposal, null);
  assert.equal(applied.data.editor.document.pages.find((page) => page.k === "Notes.Next").en, "<b>Next 😀</b> <script>no</script>");
  assert.equal(editors.current.revision, applied.data.editor.revision);
  assert.equal(editors.current.dirty, false);
  assert.equal(editors.current.document.pages.find((page) => page.k === "Notes.Next").en, applied.data.editor.document.pages.find((page) => page.k === "Notes.Next").en);
  const saved = editors.current.authoritative.document.pages.find((page) => page.k === "Notes.Next").en;
  assert.equal(saved, "<b>Next 😀</b> <script>no</script>");
  assert.equal(editors.current.authoritative.document.pages.find((page) => page.k === "Notes.Next").sentinel, "void-next-sentinel");
  assert.equal((await readFile(historyPath, "utf8")).trim().split(/\n/).length, historyBefore + 2);
  assert.deepEqual(await readFile(origPath), original);
  const documentPath = join(fixture.root, "repositories", "shop", "docs", "release.json");
  const commentsPath = join(fixture.root, "repositories", "shop", "docs", "release.comments.json");
  const documentBefore = await readFile(documentPath);
  const commentsBefore = await readFile(commentsPath);
  const introduction = editors.current.authoritative.document.pages.find((page) => page.k === "Intro.Welcome").en;
  const start = introduction.indexOf("Hello");
  const operation = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/ranges",
    params: { resourceId: editors.current.resourceId },
    body: {
      k: "Intro.Welcome",
      lang: "en",
      start,
      end: start + "Hello".length,
      expectedText: "Hello",
      replacement: "Later",
      expectedRevision: editors.current.revision,
      mode: "propose",
      threadId: "b37ea5c9-31a6-43ea-aed4-63e842c41f37",
      expectedCommentsRevision: editors.current.commentsRevision,
    },
  });
  const proposed = await request(api, "POST", operation.path, { operation });
  assert.equal(proposed.data.proposal.state, "pending");
  assert.equal(proposed.data.proposal.replacement, "Later");
  assert.equal(proposed.data.proposal.resourceId, editors.current.resourceId);
  assert.equal(proposed.data.proposal.threadId, "b37ea5c9-31a6-43ea-aed4-63e842c41f37");
  assert.equal(proposed.data.editor.revision, editors.current.revision);
  assert.notEqual(proposed.data.editor.commentsRevision, editors.current.commentsRevision);
  assert.equal(proposed.data.proposal.commentsRevision, proposed.data.editor.commentsRevision);
  assert.deepEqual(await readFile(documentPath), documentBefore);
  assert.notDeepEqual(await readFile(commentsPath), commentsBefore);
  const withoutThread = { ...operation.body, mode: "propose" };
  delete withoutThread.threadId;
  delete withoutThread.expectedCommentsRevision;
  const missingThread = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/ranges",
    params: { resourceId: editors.current.resourceId },
    body: withoutThread,
  });
  await assert.rejects(request(api, "POST", missingThread.path, { operation: missingThread }), (error) => error.status === 422);
  const stale = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/ranges",
    params: { resourceId: editors.current.resourceId },
    body: { ...operation.body, expectedCommentsRevision: "a".repeat(64), threadId: "b37ea5c9-31a6-43ea-aed4-63e842c41f37" },
  });
  await assert.rejects(request(api, "POST", stale.path, { operation: stale }), (error) => error.code === "revision_conflict");
});

test("a compliant range envelope replaces the draft with the saved editor", async () => {
  const editor = {
    resourceId: "text-1",
    revision: "a".repeat(64),
    commentsRevision: "c".repeat(64),
    document: { pages: [{ k: "Page", en: "Before" }] },
    authoritative: { document: { pages: [{ k: "Page", en: "Before" }] }, revision: "a".repeat(64) },
    dirty: true,
  };
  const savedEditor = {
    resourceId: "text-1",
    revision: "b".repeat(64),
    commentsRevision: "c".repeat(64),
    document: { pages: [{ k: "Page", en: "After" }] },
  };
  const api = createApi({
    location: { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=desktop-token" },
    history: { replaceState() {} },
    fetch: async () => jsonResponse({ editor: savedEditor, proposal: null }),
  });
  const result = await saveRange(api, editor, "Page", "en", 0, 6, "After");
  assert.equal(result.data.proposal, null);
  assert.equal(editor.dirty, false);
  assert.equal(editor.revision, savedEditor.revision);
  assert.equal(editor.document.pages[0].en, "After");
  assert.equal(editor.authoritative.document.pages[0].en, "After");
  assert.notEqual(editor.authoritative.document.pages[0].en, "Before");
});

function jsonResponse(data) {
  return new Response(JSON.stringify({
    contract: "hivem1nd-gui-v3",
    data,
    meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "0", sync: "local" },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("reopening a board reloads referenced images and draws clipped styled nodes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const revoked = [];
  let blobs = 0;
  api.createObjectURL = () => {
    blobs += 1;
    return `blob:asset-${blobs}`;
  };
  api.revokeObjectURL = (url) => revoked.push(url);
  const editors = createEditors();
  const created = await createResource(api, "blueprint", { project: "shop", document: fullBoard() });
  await openEditor(api, editors, { id: created.data.id, kind: "blueprint" });
  const asset = await uploadAsset(api, editors.current, { type: "image/png", arrayBuffer: async () => Buffer.from(PNG, "base64") });
  const missingSrc = "assets/11111111-1111-4111-8111-111111111111.png";
  await addNode(api, editors.current, { screenId: "empty", parentId: "root", node: { id: "photo", name: "Photo", t: "image", place: { x: 4, y: 4 }, w: 16, h: 16, src: asset.src } });
  await addNode(api, editors.current, { screenId: "empty", parentId: "root", node: { id: "missing-image", name: "Missing", t: "image", place: { x: 8, y: 8 }, w: 16, h: 16, src: missingSrc } });
  await addNode(api, editors.current, { screenId: "empty", parentId: "root", node: { id: "remote-image", name: "Remote", t: "image", place: { x: 12, y: 12 }, w: 16, h: 16, src: "https://evil.example/pixel.png" } });
  const seen = [];
  const baseFetch = api.fetch;
  api.fetch = async (url, init) => {
    seen.push({ url: String(url), authorization: init?.headers?.Authorization ?? "" });
    return baseFetch(url, init);
  };
  const firstUrl = editors.current.assets.get(asset.src).url;
  await openEditor(api, editors, { id: created.data.id, kind: "blueprint" });
  const reloaded = editors.current.assets.get(asset.src);
  assert.ok(reloaded.url.startsWith("blob:"));
  assert.notEqual(reloaded.url, firstUrl);
  assert.ok(revoked.includes(firstUrl));
  const assetCalls = seen.filter((item) => item.url.includes("/assets/"));
  assert.equal(assetCalls.length, 2);
  assert.ok(assetCalls.every((item) => item.url.startsWith(new URL(fixture.desktopUrl).origin) && item.authorization.startsWith("Bearer ")));
  assert.equal(assetCalls.some((item) => item.url.includes("evil.example")), false);
  assert.ok(editors.current.assetIssues.some((item) => item.src === missingSrc && item.code === "asset_not_found"));
  assert.ok(editors.current.assetIssues.some((item) => item.code === "invalid_asset"));
  const ready = nodesOf(renderNode(svgDocument(), { id: "photo", name: "Photo", t: "image", place: { x: 0, y: 0 }, w: 16, h: 16, src: asset.src }, editors.current));
  const image = ready.find((node) => node.tag === "image");
  assert.equal(image.getAttribute("href"), reloaded.url);
  assert.equal(image.getAttribute("data-asset"), "ready");
  assert.equal(String(image.getAttribute("href")).includes("docs/flows"), false);
  const missing = nodesOf(renderNode(svgDocument(), { id: "gone", name: "Gone", t: "image", place: { x: 0, y: 0 }, w: 16, h: 16, src: missingSrc }, editors.current));
  assert.equal(missing.find((node) => node.tag === "image").getAttribute("data-asset"), "asset_not_found");
  assert.equal(missing.find((node) => node.tag === "image").getAttribute("href"), null);
  editors.current.authoritative = { ...editors.current.authoritative, document: { ...editors.current.authoritative.document, screens: [] } };
  await loadAssets(api, editors.current);
  assert.ok(revoked.includes(reloaded.url));

  const clipped = nodesOf(renderNode(svgDocument(), { id: "frame", name: "Frame", t: "box", clip: true, place: { x: 0, y: 0 }, w: 40, h: 20, kids: [] }, {}));
  assert.ok(clipped.some((node) => node.getAttribute("clip-path")?.startsWith("url(#clip-frame)")));
  const icon = nodesOf(renderNode(svgDocument(), { id: "mark", name: "Mark", t: "icon", icon: "alert", place: { x: 0, y: 0 }, w: 16, h: 16, fill: "#112233" }, {}));
  assert.equal(icon.some((node) => node.tag === "rect"), false);
  assert.equal(icon.find((node) => node.tag === "polygon").getAttribute("data-icon"), "alert");
  const rule = nodesOf(renderNode(svgDocument(), { id: "rule", name: "Rule", t: "vector", kind: "line", place: { x: 0, y: 0 }, w: 40, h: 8, stroke: "#112233", strokeWidth: 2, fill: "none" }, {}));
  const line = rule.find((node) => node.tag === "line");
  assert.equal(line.getAttribute("stroke"), "#112233");
  assert.equal(line.getAttribute("stroke-width"), "2");
  assert.equal(line.getAttribute("fill"), "none");
  const board = {
    screens: [{ id: "s", x: 0, y: 0, w: 80, h: 80, root: { id: "root", t: "box", place: { x: 0, y: 0 }, w: 80, h: 80, kids: [
      { id: "caption", t: "text", place: { x: 10, y: 10 }, w: 0, h: 0, value: "Hi" },
      { id: "trail", t: "vector", kind: "pen", place: { x: 30, y: 30 }, w: 0, h: 0, d: "M0 0h4" },
    ] } }],
  };
  assert.equal(hitBoardNode(board, { x: 12, y: 12 }).nodeId, "caption");
  assert.equal(hitBoardNode(board, { x: 32, y: 32 }).nodeId, "trail");
});

test("comment creation accepts only a complete anchor for that editor", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const editors = createEditors();
  const boards = await loadCatalog(api, editors, "blueprint");
  const board = boards.find((item) => item.title === "Cart");
  await openEditor(api, editors, board);
  await assert.rejects(createComment(api, editors, { quote: "aside" }, "Quote only"), (error) => error.code === "invalid_body");
  await assert.rejects(createComment(api, editors, { ...canvasAnchor(), point: { x: 1.5, y: 0 } }, "Fractional point"), (error) => error.code === "invalid_body");
  await assert.rejects(createComment(api, editors, {
    screen: "empty", screenTitle: "Empty cart", element: "label", label: "Label", path: ["Empty cart", "Label"],
  }, "Missing point"), (error) => error.code === "invalid_body");
  await assert.rejects(createComment(api, editors, welcomeAnchor(), "Wrong editor"), (error) => error.code === "invalid_body");
  await assert.rejects(createComment(api, editors, {
    screen: "empty", screenTitle: "Empty cart", element: "missing", label: "Missing", path: ["Empty cart"], point: { x: 1, y: 2 },
  }, "Missing node"), (error) => error.code === "anchor_changed");
  const placed = await createComment(api, editors, {
    screen: "empty", screenTitle: "Empty cart", element: "label", label: "Label", path: ["Empty cart", "Root", "Label"], point: { x: 16, y: 20 },
  }, "On the label");
  assert.equal(placed.data.thread.place.screenId, "empty");
  assert.equal(placed.data.thread.place.nodeId, "label");
  const texts = await loadCatalog(api, editors, "void");
  const notes = texts.find((item) => item.title === "Release notes");
  await openEditor(api, editors, notes);
  await assert.rejects(createComment(api, editors, canvasAnchor(), "Wrong editor"), (error) => error.code === "invalid_body");
  const mismatched = { ...welcomeAnchor(), quote: "WelcomX" };
  await assert.rejects(createComment(api, editors, mismatched, "Wrong quote"), (error) => error.code === "anchor_changed");
  const partial = { ...welcomeAnchor() };
  delete partial.suffix;
  await assert.rejects(createComment(api, editors, partial, "Partial void"), (error) => error.code === "invalid_body");
  const created = await createComment(api, editors, welcomeAnchor(), "On the welcome");
  assert.equal(created.data.thread.anchor.k, "Intro.Welcome");
  assert.equal(created.data.thread.anchor.quote, "Welcome");
  assert.equal(created.data.thread.anchor.prefix, "");
  assert.equal(created.data.thread.anchor.suffix, "\nA first paragraph.");
});

function svgDocument() {
  const create = (tag) => ({
    tag,
    attributes: new Map(),
    children: [],
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    append(...kids) { this.children.push(...kids); },
  });
  return { createElementNS: (_namespace, tag) => create(tag) };
}

function nodesOf(node, found = []) {
  found.push(node);
  for (const child of node.children ?? []) nodesOf(child, found);
  return found;
}

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

function fullBoard() {
  return {
    formatVersion: 1,
    id: "full-board",
    title: "Full",
    note: "",
    sentinel: "document-sentinel",
    pages: [{ id: "main", title: "Main", objects: [{ sentinel: "object-sentinel" }], order: ["empty"], start: "empty", sentinel: "page-sentinel" }],
    screens: [{
      id: "empty",
      title: "Empty",
      pageId: "main",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      sentinel: "screen-sentinel",
      root: {
        id: "root",
        name: "Root",
        t: "box",
        place: { x: 0, y: 0 },
        w: 200,
        h: 200,
        dir: "stack",
        sentinel: "node-sentinel",
        valign: "top",
        shadows: [{ sentinel: "shadow-sentinel" }],
        blur: 1,
        pixelate: 2,
        kids: [
          { id: "label", name: "Label", t: "text", place: { x: 12, y: 12, sentinel: "place-sentinel" }, w: 80, h: 24, value: "Cart", color: "#112233", align: "left", sentinel: "text-sentinel" },
          { id: "clip", name: "Clip", t: "box", place: { x: 0, y: 0 }, w: 100, h: 100, dir: "stack", clip: true, kids: [
            { id: "overflow", name: "Overflow", t: "box", place: { x: 80, y: 0 }, w: 50, h: 20, dir: "stack", kids: [] },
          ] },
        ],
      },
    }],
    links: [{ id: "legacy-link", from: "empty", to: "missing-screen", transition: "cut", easing: "legacy-ease", sentinel: "link-sentinel" }],
    components: [{ id: "button", sentinel: "component-sentinel" }],
    fonts: [{ id: "body", sentinel: "font-sentinel" }],
    threads: [{ id: "thread-doc", sentinel: "thread-sentinel" }],
  };
}

function sentinels(value, found = []) {
  if (typeof value === "string" && value.includes("sentinel")) found.push(value);
  else if (Array.isArray(value)) for (const item of value) sentinels(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) sentinels(item, found);
  return found;
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a comment response and its event leave one thread", async () => {
  const threadId = "f8a6a2ec-024c-4b7a-af0f-31cc8f04bea6";
  const thread = { id: threadId, status: "open", messages: [{ text: "GUI quote comment" }] };
  const newer = { id: threadId, status: "open", messages: [{ text: "newer body" }] };
  const firstRevision = "d".repeat(64);
  const secondRevision = "e".repeat(64);
  const eventFirst = commentEditor();
  const eventApi = commentApi(() => {
    noteComment(eventFirst, { resourceId: "board-1", thread, commentsRevision: firstRevision, operation: "create" });
    return commentEnvelope({ thread, commentsRevision: firstRevision, notifications: [] });
  });
  await createComment(eventApi, eventFirst, canvasAnchor(), "GUI quote comment");
  assert.equal(eventFirst.current.threads.filter((item) => item.id === threadId).length, 1);
  assert.equal(eventFirst.current.threads.some((item) => item.pending), false);
  assert.equal(eventFirst.current.commentsRevision, firstRevision);

  const responseFirst = commentEditor();
  await createComment(commentApi(() => commentEnvelope({ thread, commentsRevision: firstRevision, notifications: [] })), responseFirst, canvasAnchor(), "GUI quote comment");
  noteComment(responseFirst, { resourceId: "board-1", thread, commentsRevision: firstRevision, operation: "create" });
  assert.equal(responseFirst.current.threads.filter((item) => item.id === threadId).length, 1);
  assert.equal(responseFirst.current.threads.some((item) => item.pending), false);
  assert.equal(responseFirst.current.commentsRevision, firstRevision);

  const raced = commentEditor();
  await createComment(commentApi(() => {
    noteComment(raced, { resourceId: "board-1", thread, commentsRevision: firstRevision, operation: "create" });
    noteComment(raced, { resourceId: "board-1", thread: newer, commentsRevision: secondRevision, operation: "create" });
    return commentEnvelope({ thread, commentsRevision: firstRevision, notifications: [] });
  }), raced, canvasAnchor(), "GUI quote comment");
  assert.equal(raced.current.threads.filter((item) => item.id === threadId).length, 1);
  assert.equal(raced.current.threads.find((item) => item.id === threadId).messages[0].text, "newer body");
  assert.equal(raced.current.commentsRevision, secondRevision);
});

function commentEditor() {
  return {
    current: {
      resourceId: "board-1",
      revision: "a".repeat(64),
      commentsRevision: "c".repeat(64),
      threads: [
        { id: "old-thread", messages: [{ text: "old" }] },
        { id: "pending-comment", pending: true, messages: [{ text: "GUI quote comment" }] },
      ],
      commentText: "GUI quote comment",
    },
  };
}

function commentApi(fetchImpl) {
  return createApi({
    location: { origin: "http://127.0.0.1:9", pathname: "/", search: "", hash: "#session=token" },
    history: { replaceState() {}, state: null },
    fetch: fetchImpl,
  });
}

function commentEnvelope(data) {
  const body = JSON.stringify({
    contract: "hivem1nd-gui-v3",
    data,
    meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "svc:1", sync: "local" },
  });
  return { status: 201, ok: true, headers: { get() { return null; } }, text: async () => body };
}

function canvasAnchor(x = 0, y = 0) {
  return { screen: null, screenTitle: null, element: null, label: "Board", path: ["Board"], point: { x, y } };
}

function welcomeAnchor() {
  return {
    k: "Intro.Welcome",
    lang: "en",
    start: 0,
    end: 7,
    quote: "Welcome",
    prefix: "",
    suffix: "\nA first paragraph.",
  };
}

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

test("both editor kinds use the shared library with empty folders, recursive counts and matching ancestors", () => {
  const document = fakeDocument();
  for (const kind of ["blueprint", "void"]) {
    const editors = createEditors(), state = libraryState(editors, kind);
    editors.catalog = [{ id: "deep", kind, title: "Cart", project: "shop", folderId: "child", openThreads: 2 }];
    state.folders = [{ id: "parent", project: "shop", title: "Parent", parentId: null, count: 1 }, { id: "child", project: "shop", title: "Child", parentId: "parent", count: 1 }, { id: "empty", project: "shop", title: "Empty", parentId: null, count: 0 }];
    state.collapsed = new Set(["project:shop", "shop:parent", "shop:child"]);
    const render = () => renderLibrary(document, { kind, data: editors, project: "deep", t: (key, vars) => text("en", key, vars), actions: {} });
    assert.equal(nodesOf(render()).some((node) => node.getAttribute?.("data-library-item") === "deep"), false);
    state.query = "screen text";
    const matching = nodesOf(render());
    assert.equal(matching.find((node) => node.getAttribute?.("data-library")).getAttribute("data-library"), kind);
    assert.equal(matching.some((node) => node.getAttribute?.("data-library-item") === "deep"), true);
    assert.deepEqual(matching.filter((node) => node.getAttribute?.("data-library-folder")).map((node) => node.getAttribute("data-library-folder")), ["parent", "child"]);
    state.query = ""; state.collapsed.clear();
    const empty = nodesOf(render()).find((node) => node.getAttribute?.("data-library-folder") === "empty");
    assert.equal(nodesOf(empty).find((node) => node.className === "library-count").textContent, "0");
    assert.equal(groupCatalog(editors.catalog, state.folders)[0].folders.length, 3);
    assert.equal(state.collapsed.size, 0);
  }
});

test("catalog search loads every result page and keeps AND filters and kind-specific state", async () => {
  const calls = [];
  const api = createApi({ location: { origin: "http://127.0.0.1:9", hash: "#session=fixture" }, history: { replaceState() {} }, fetch: async (input) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith("/library/folders")) return jsonResponse({ items: [{ id: "folded", project: "shop", parentId: null, title: "Folded", count: 51 }], total: 1 });
    if (url.pathname.endsWith("/projects")) return jsonResponse({ items: [{ id: "shop" }], total: 1 });
    const next = url.searchParams.has("cursor");
    return jsonResponse({ items: next ? [{ id: "last", kind: "blueprint", project: "shop", title: "Last", folderId: "folded" }] : Array.from({ length: 50 }, (_, index) => ({ id: `item-${index}`, kind: "blueprint", project: "shop", title: "Match", folderId: "folded" })), total: 51, nextCursor: next ? null : "page-two" });
  } });
  const editors = createEditors(), state = libraryState(editors, "blueprint");
  state.filters = { project: "shop", openComments: true, attachedAgents: true, changedThisWeek: true };
  state.collapsed.add("shop:folded");
  await loadCatalog(api, editors, "blueprint", "deep comment");
  assert.equal(editors.catalog.length, 51);
  assert.equal(editors.catalog.at(-1).id, "last");
  const requests = calls.filter((url) => url.pathname.endsWith("/blueprint/boards"));
  assert.equal(requests.length, 2);
  for (const url of requests) for (const [key, value] of Object.entries({ q: "deep comment", project: "shop", openComments: "true", attachedAgents: "true", changedThisWeek: "true" })) assert.equal(url.searchParams.get(key), value);
  assert.deepEqual(libraryState(editors, "void").filters, {});
  assert.equal(libraryState(editors, "void").query, "");
  delete state.filters.openComments;
  await loadCatalog(api, editors, "blueprint");
  assert.equal(calls.at(-1).searchParams.has("openComments"), false);
  assert.equal(state.query, "deep comment");
});

test("full content and comment search includes folded folders and UTC week filters", async (t) => {
  const fixture = await createGuiFixture({ now: "2026-10-13T10:00:00.000Z" });
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), editors = createEditors();
  await loadCatalog(api, editors, "blueprint");
  const board = await openEditor(api, editors, editors.catalog.find((item) => item.title === "Cart"));
  const folder = await request(api, "POST", "/library/folders", { operation: createOperation({ method: "POST", path: "/library/folders", body: { project: "shop", kind: "blueprint", title: "Folded", parentId: null, expectedRevision: board.authoritative.libraryRevision } }) });
  const moved = await moveEditor(api, board.authoritative, { project: "shop", path: board.authoritative.path, folderId: folder.data.folder.id }, folder.data.revision);
  const state = libraryState(editors, "blueprint"); state.collapsed.add(`shop:${folder.data.folder.id}`);
  const node = moved.data.editor.document.screens[0].root.kids[0];
  const found = await loadCatalog(api, editors, "blueprint", node.value);
  assert.ok(found.some((item) => item.id === board.resourceId));
  board.authoritative = moved.data.editor;
  await createComment(api, editors, canvasAnchor(), "A unique comment inside a folded folder");
  state.filters = { openComments: true, attachedAgents: true, changedThisWeek: true };
  const comments = await loadCatalog(api, editors, "blueprint", "unique comment inside");
  assert.deepEqual(comments.map((item) => item.id), [board.resourceId]);
  state.filters.project = "blog";
  assert.deepEqual(await loadCatalog(api, editors, "blueprint", "unique comment inside"), []);
  assert.equal(state.collapsed.has(`shop:${folder.data.folder.id}`), true);
});

test("duplication copies source screens, sketches and unknown fields without comments or attachments", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), editors = createEditors();
  const source = await createResource(api, "blueprint", { project: "shop", document: fullBoard() });
  await openEditor(api, editors, source.data);
  await createComment(api, editors, canvasAnchor(), "This must stay with the source");
  const copy = await duplicateEditor(api, source.data, { project: "shop", folderId: null, title: "Actual copy", path: "docs/flows/boards/actual-copy.json" });
  assert.deepEqual(copy.data.document.screens, source.data.document.screens);
  assert.deepEqual(copy.data.document.pages, source.data.document.pages);
  assert.equal(copy.data.document.sentinel, "document-sentinel");
  assert.notEqual(copy.data.document.id, source.data.document.id);
  assert.deepEqual(copy.data.threads, []); assert.deepEqual(copy.data.attached, []);
  assert.equal((await request(api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: source.data.id } })).data.threads.length, 1);
});

test("Changed this week starts at Monday 00:00 UTC, independently of viewer time", async (t) => {
  const fixture = await createGuiFixture({ now: "2026-10-11T23:59:59.000Z" }); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), editors = createEditors();
  await createResource(api, "blueprint", { project: "shop", document: { ...fullBoard(), id: "sunday", title: "Boundary board Sunday" } });
  await fixture.control.advance(1000);
  const monday = await createResource(api, "blueprint", { project: "shop", document: { ...fullBoard(), id: "monday", title: "Boundary board Monday" } });
  libraryState(editors, "blueprint").filters.changedThisWeek = true;
  assert.deepEqual((await loadCatalog(api, editors, "blueprint", "Boundary board")).map((item) => item.id), [monday.data.id]);
});

test("an offline project is reported once without hiding another project's library", async () => {
  const issue = { project: "offline", code: "project_unavailable" };
  const api = createApi({ location: { origin: "http://127.0.0.1:9", hash: "#session=fixture" }, history: { replaceState() {} }, fetch: async (input) => {
    const route = new URL(input).pathname;
    return jsonResponse(route.endsWith("/projects") ? { items: [{ id: "shop" }, { id: "offline" }], total: 2 } : route.endsWith("/library/folders") ? { items: [], total: 0, issues: [issue] } : { items: [{ id: "accessible", kind: "blueprint", title: "Accessible", project: "shop", folderId: null }], total: 1, issues: [issue] });
  } });
  const editors = createEditors(); await loadCatalog(api, editors, "blueprint");
  assert.deepEqual(editors.catalogIssues, [issue]);
  const view = renderLibrary(fakeDocument(), { kind: "blueprint", data: editors, actions: {}, t: (key, vars) => text("en", key, vars) });
  assert.equal(nodesOf(view).filter((node) => node.getAttribute?.("data-library-issue")).length, 1);
  assert.ok(nodesOf(view).some((node) => node.getAttribute?.("data-library-item") === "accessible"));
});

test("switching editor kind never shows the previous kind while its catalog is loading", () => {
  const editors = createEditors();
  editors.catalog = [{ id: "board", kind: "blueprint", title: "Board", project: "shop" }];
  editors.catalogLoading = true;
  const view = renderLibrary(fakeDocument(), { kind: "void", data: editors, actions: {}, t: (key, vars) => text("en", key, vars) });
  assert.equal(nodesOf(view).some((node) => node.getAttribute?.("data-id") === "board"), false);
  assert.ok(nodesOf(view).some((node) => node.getAttribute?.("data-catalog-progress")));
});

test('board vectors use their declared dimensions and keep the stroke width', () => {
  const nodes = nodesOf(renderNode(svgDocument(), { id: 'stroke', name: 'Pen stroke', t: 'vector', kind: 'pen',
    place: { x: 0, y: 0 }, w: 270, h: 500, d: 'M0 0 L100 100', stroke: '#f5f1f6', strokeWidth: 2.2, fill: 'none' }, {}));
  const vector = nodes.find((item) => item.tag === 'path');
  assert.equal(vector.getAttribute('d'), 'M0 0 L100 100');
  assert.equal(vector.getAttribute('transform'), 'scale(2.7 5)');
  assert.equal(vector.getAttribute('vector-effect'), 'non-scaling-stroke');
  assert.equal(vector.getAttribute('stroke-width'), '2.2');
});

test('board asset references retain the core filename including extension', () => {
  const filename = '11111111-1111-4111-8111-111111111111.png';
  const refs = collectAssetRefs({ screens: [{ root: { kids: [
    { t: 'image', src: 'assets/' + filename }, { t: 'image', src: 'assets/' + filename },
    { t: 'image', src: 'docs/flows/assets/' + filename }, { t: 'image', src: 'https://invalid.example/image.png' },
  ] } }] });
  assert.deepEqual(refs.allowed, [{ src: 'assets/' + filename, id: filename }]);
  assert.deepEqual(refs.rejected, ['docs/flows/assets/' + filename, 'https://invalid.example/image.png']);
});

test("nested geometry, overlap and rounded clipping share the painted coordinate domain", () => {
  const board = fullBoard();
  const root = board.screens[0].root; root.place = { x: 7, y: 9 };
  const clip = root.kids[1]; clip.place = { x: 20, y: 30 }; clip.radius = 18;
  clip.kids = [{ id: "under", name: "Under", t: "box", dir: "stack", kids: [], place: { x: 10, y: 12, future: true }, w: 40, h: 30 },
    { id: "over", name: "Over", t: "text", value: "Continue", place: { x: 10, y: 12, future: true }, w: 40, h: 30, size: 24, weight: 700, align: "center", color: "#112233" }];
  board.screens[0].x = 100; board.screens[0].y = 200;
  const item = indexNodes(board).get("over");
  assert.deepEqual([item.x, item.y, item.parentX, item.parentY], [137, 251, 127, 239]);
  assert.deepEqual(parentPoint(board, "over", { x: 155, y: 260 }), { x: 28, y: 21 });
  assert.equal(hitBoardNode(board, { x: 147, y: 260 }).nodeId, "over");
  assert.equal(hitBoardNode(board, { x: 128, y: 240 }).nodeId, "label");
  Object.assign(item.node, dragNodeGeometry(item.node, 8, 5, "nw"));
  assert.deepEqual(item.node.place, { x: 18, y: 17, future: true });
  assert.equal(item.node.w, 32); assert.equal(item.node.h, 25);
  assert.deepEqual(boardCommentAnchor(board, { kind: "node", nodeId: "over", x: 147, y: 260 }).path, ["Empty", "Root", "Clip", "Over"]);
  const nodes = nodesOf(renderNode(svgDocument(), root, {}));
  const text = nodes.find((node) => node.tag === "text" && node.textContent === "Continue");
  assert.equal(text.getAttribute("font-size"), "24"); assert.equal(text.getAttribute("font-weight"), "700");
  assert.equal(text.getAttribute("x"), "16"); assert.equal(text.getAttribute("text-anchor"), "middle");
  const clipped = nodes.find((node) => node.tag === "clipPath");
  assert.equal(clipped.children[0].getAttribute("rx"), "18");
  assert.ok(nodes.some((node) => node.tag === "rect" && node.getAttribute("rx") === "18"));
});

test("sketches persist in ordinary bounded board JSON, retain Lite fields and erase only touched strokes", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), editors = createEditors();
  const board = fullBoard(); board.legacySketch = { future: "retained-lite", screens: [] };
  board.links = [];
  const colors = { card: "#211a27", accent: "#bdcd79" };
  const frame = addBoardFrame(board, "hand", { x: 350, y: 120 }, { w: 300, h: 560 }, colors, true);
  const pen = sketchStroke(board, frame, "pen-stroke", [{ x: 360, y: 100 }, { x: 1000, y: 900 }], "#f5f1f6");
  const marker = sketchStroke(board, frame, "marker-stroke", [{ x: 370, y: 150 }, { x: 400, y: 190 }], "#e6c06f", true);
  assert.deepEqual(pen.place, { x: 15, y: 24 }); assert.equal(pen.w, 270); assert.equal(pen.h, 500);
  assert.equal(marker.opacity, 0.4); assert.equal(marker.strokeWidth, 2.2);
  assert.deepEqual(touchedStrokes(board, { x: 367, y: 149 }, { x: 374, y: 154 }).sort(), ["marker-stroke", "pen-stroke"]);
  assert.deepEqual(touchedStrokes(board, { x: 580, y: 160 }), []);
  validateSketch(board);
  const created = await createResource(api, "blueprint", { project: "shop", document: board });
  const editor = await openEditor(api, editors, created.data);
  assert.deepEqual(editor.authoritative.document, board);
  await removeNode(api, editor, marker.id);
  await openEditor(api, editors, created.data);
  assert.equal(indexNodes(editors.current.authoritative.document).has(marker.id), false);
  assert.equal(indexNodes(editors.current.authoritative.document).has(pen.id), true);
  assert.deepEqual(editors.current.authoritative.document.legacySketch, board.legacySketch);
  const crowded = fullBoard(); crowded.screens[0].root.kids = Array.from({ length: 9999 }, (_, i) => ({ id: `node-${i}`, t: "text", place: { x: 0, y: 0 } }));
  assert.throws(() => appendBoardNode(crowded, "empty", "root", marker), RangeError);
  const deep = fullBoard(); let parent = deep.screens[0].root; parent.kids = [];
  for (let i = 0; i < 30; i++) { const child = { id: `level-${i}`, t: "box", kids: [], place: { x: 0, y: 0 } }; parent.kids.push(child); parent = child; }
  assert.throws(() => appendBoardNode(deep, "empty", parent.id, marker), RangeError);
});

test("whole-board acknowledgments retain later typing and a newer remote conflict", async () => {
  const editors = createEditors(), board = fullBoard(), revision = "a".repeat(64);
  const editor = { resourceId: "board", kind: "blueprint", revision, baseRevision: revision, authoritative: { id: "board", revision, document: board } };
  editors.current = editor; editors.drafts.set("board", editor); editors.tickets.set("board", 1);
  let release; const hold = new Promise((resolve) => { release = resolve; });
  const api = commentApi(async (_url, init) => { await hold; return jsonResponse({ id: "board", revision: "b".repeat(64), document: JSON.parse(init.body).document }); });
  const first = structuredClone(board); first.screens[0].root.kids[0].value = "First"; setBoardDraft(editor, first);
  const saving = replaceBoard(api, editor, first);
  const second = structuredClone(first); second.screens[0].root.kids[0].value = "Later typing"; setBoardDraft(editor, second);
  const own = { id: "board", revision: "b".repeat(64), document: first };
  noteRemote(editors, { resourceId: "board", revision: own.revision }); reconcileEditor(editors, own, 1);
  assert.equal(editor.conflict, null); release(); await saving;
  assert.equal(boardDocument(editor).screens[0].root.kids[0].value, "Later typing"); assert.equal(editor.dirty, true);
  assert.equal(editor.baseRevision, own.revision);
  const remote = { id: "board", revision: "c".repeat(64), document: { ...board, title: "Incoming" }, by: "project:shop:executor-shop" };
  reconcileEditor(editors, remote, 1);
  assert.equal(editor.conflict.remote.by, "project:shop:executor-shop");
  assert.equal(reapplyEditorDraft(editors), true);
  assert.equal(editor.conflictCopies[0].local.document.screens[0].root.kids[0].value, "Later typing");
  assert.deepEqual(editor.conflictCopies[0].remote, remote);
  reconcileEditor(editors, { ...remote, revision: "d".repeat(64) }, 1);
  assert.equal(discardEditorDraft(editors), true);
  assert.equal(editor.boardDraft, null); assert.equal(boardDocument(editor).title, "Incoming");
  assert.equal(editor.conflictCopies.length, 2);
});

test("group attachments expand canonical members once and bind the chooser's attachment revision", async () => {
  const units = [{ id: "project:shop:executor-shop" }, { id: "env:web:overlord-web" }];
  const groups = [{ id: "one", members: units.map((unit) => unit.id) }, { id: "two", members: [units[0].id] }];
  const expanded = expandAttachments(units, groups, ["group:one", "group:two", units[0].id]);
  assert.deepEqual(expanded, units.map((unit) => unit.id));
  let sent;
  const editors = { current: { resourceId: "board", attachmentRevision: "b".repeat(64), attachmentChoiceRevision: "a".repeat(64) } };
  await setAttachments(commentApi(async (_url, init) => { sent = JSON.parse(init.body); return jsonResponse({ attached: expanded, revision: "c".repeat(64) }); }), editors, expanded);
  assert.equal(sent.expectedRevision, "a".repeat(64));
  assert.equal(Object.hasOwn(editors.current, "attachmentChoiceRevision"), false);
});

test("Watch never replaces a board gesture or draft and off leaves committed content available", () => {
  const editors = createEditors();
  editors.current = { resourceId: "board", authoritative: { document: fullBoard() }, boardDraft: { title: "Local draft" } };
  editors.watch = { state: "watching", resourceId: "board", unitId: "project:shop:executor-shop" };
  editors.focus = { nodeId: "label" }; editors.viewport = { x: 1, y: 2, scale: 2 };
  const activity = { resourceId: "board", unitId: "project:shop:executor-shop", focus: { nodeId: "overflow", screenId: "empty" } };
  assert.equal(handleActivity(editors, activity).follow, false);
  assert.deepEqual(editors.current.boardDraft, { title: "Local draft" }); assert.equal(editors.viewport.scale, 2);
  editors.current.boardDraft = null; editors.current.boardGesture = true;
  assert.equal(handleActivity(editors, activity).follow, false);
  editors.current.boardGesture = false; editors.watch = null;
  assert.equal(handleActivity(editors, activity).follow, false);
  assert.equal(editors.focus.nodeId, "label"); assert.equal(editors.current.authoritative.document.title, "Full");
});

test("both editor conflict answers persist the draft before replacing it and History restores both versions", async (t) => {
  for (const kind of ["blueprint", "void"]) for (const decision of ["keep-mine", "reload"]) await t.test(`${kind} ${decision}`, async (t) => {
    const fixture = await createGuiFixture(); t.after(() => fixture.close());
    const api = apiFrom(fixture.desktopUrl), editors = createEditors();
    await loadCatalog(api, editors, kind);
    const summary = editors.catalog.find((item) => !item.readOnly);
    const current = await openEditor(api, editors, summary);
    const local = structuredClone(current.authoritative.document);
    if (kind === "blueprint") { local.title = "Person draft"; setBoardDraft(current, local); }
    else {
      const page = local.pages[0], lang = typeof page.en === "string" ? "en" : "es";
      current.draftKey = { k: page.k, lang }; current.draftText = "Person draft";
      current.textDrafts.set(`${current.resourceId}\0${page.k}\0${lang}`, current.draftText); current.dirty = true;
      page[lang] = current.draftText;
    }
    const file = join(fixture.root, "repositories", current.authoritative.project, current.authoritative.path), incoming = structuredClone(current.authoritative.document);
    incoming.title = "Incoming version";
    await writeFile(file, JSON.stringify(incoming)); await fixture.control.refresh();
    noteRemote(editors, { resourceId: current.resourceId, revision: "f".repeat(64) }); await refreshRemoteEditor(api, editors, current.resourceId);
    assert.deepEqual(editorDraftDocument(current), local);
    await resolveEditorConflict(api, editors, decision);
    assert.equal(current.dirty, false); assert.equal(current.conflict, null);
    assert.equal(current.authoritative.document.title, decision === "keep-mine" ? local.title : "Incoming version");
    const history = await loadHistory(api, editors);
    const draftVersion = history.find((item) => item.source?.kind === "draft"), incomingVersion = history.find((item) => item.source?.kind === "external");
    assert.ok(draftVersion); assert.ok(incomingVersion); assert.equal(draftVersion.by, "root:master");
    const result = await restoreEditorHistory(api, editors, draftVersion);
    assert.ok(result); assert.deepEqual(current.authoritative.document.pages ?? current.authoritative.document.screens, local.pages ?? local.screens);
    await restoreEditorHistory(api, editors, incomingVersion);
    assert.equal(current.authoritative.document.title, "Incoming version");
    assert.equal((await loadHistory(api, editors)).filter((item) => item.current).length, 1);
  });
});

test("conflict persistence failure leaves every draft and selection intact and its retry preserves later typing", async () => {
  const editors = createEditors(), board = fullBoard(), revision = "a".repeat(64);
  const current = { resourceId: "board", kind: "blueprint", revision, baseRevision: revision, authoritative: { id: "board", revision, document: board }, editGeneration: 1, dirty: true, boardDraft: { ...board, title: "Draft" },
    conflict: { remote: { id: "board", revision: "b".repeat(64), commentsRevision: null, document: { ...board, title: "Incoming" } } } };
  editors.current = current; editors.drafts.set("board", current);
  const failing = commentApi(async () => { throw new Error("Offline"); });
  await assert.rejects(() => resolveEditorConflict(failing, editors, "reload"));
  assert.equal(current.boardDraft.title, "Draft"); assert.equal(current.conflict.remote.document.title, "Incoming");
  const retained = current.historyOperation; assert.ok(retained);
  setBoardDraft(current, { ...board, title: "Later typing" });
  const retry = commentApi(async (_url, options) => {
    assert.equal(JSON.parse(options.body).document.title, "Draft");
    return jsonResponse({ id: "board", revision: "c".repeat(64), commentsRevision: null, document: { ...board, title: "Incoming" } });
  });
  await resolveEditorConflict(retry, editors, "reload", retained);
  assert.equal(current.boardDraft.title, "Later typing"); assert.equal(current.dirty, true); assert.equal(current.baseRevision, "c".repeat(64));
});

test("History restore binds both current revisions and refuses to replace an unsaved draft", async () => {
  const editors = createEditors(), board = fullBoard();
  const current = { resourceId: "board", kind: "blueprint", revision: "a".repeat(64), commentsRevision: "b".repeat(64), authoritative: { document: board }, dirty: true, boardDraft: { ...board, title: "Unsaved" } };
  editors.current = current;
  const api = commentApi(async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { expectedRevision: "a".repeat(64), expectedCommentsRevision: "b".repeat(64) });
    return jsonResponse({ id: "board", revision: "c".repeat(64), commentsRevision: null, document: board });
  });
  assert.equal(await restoreEditorHistory(api, editors, { id: "snapshot" }), false);
  current.dirty = false; current.boardDraft = null;
  await restoreEditorHistory(api, editors, { id: "snapshot" });
  assert.equal(current.commentsRevision, null); assert.equal(current.revision, "c".repeat(64));
});
