import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createApi, createOperation, request } from "../gui/app/api.mjs";
import { boundaryInsideTag, plainText, rangeRequest, renderMarkup, sourceBoundary, validUtf16Boundary } from "../gui/app/markup.mjs";
import { answerProposal, enterFocus, leaveFocus, moveFocus, saveRange, showTools } from "../gui/app/void.mjs";
import {
  addNode,
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
  discardEditorDraft,
  createEditors,
  createResource,
  handleActivity,
  loadCatalog,
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
  assert.match(asset.src, /^docs\/flows\/assets\//);
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
    meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "0", sync: { mode: "snapshot" } },
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
  const missingSrc = "docs/flows/assets/11111111-1111-4111-8111-111111111111.png";
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
    append(child) { this.children.push(child); },
  });
  return {
    createDocumentFragment() { return create("#fragment"); },
    createElement(name) { return create(name.toUpperCase()); },
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
