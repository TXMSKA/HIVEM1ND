import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FIXTURE_HOME_KEY, createFixtureTree, removeOwned, scenarioData, seedRecords } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function open(context, options) {
  const fixture = await createGuiFixture(options);
  context.after(() => fixture.close());
  return fixture;
}

async function request(fixture, method, route, { body, key, headers, origin } = {}) {
  const response = await fetch(`${origin ?? fixture.origin}${route}`, {
    method,
    headers: {
      ...fixture.headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

async function filesUnder(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    found.push(full);
    if (entry.isDirectory()) await filesUnder(full, found);
  }
  return found;
}

test("fixture trees stay inside their root and reject outside cleanup", async () => {
  const tree = await createFixtureTree();
  const seeded = await seedRecords(tree, { scenario: "standard" });
  try {
    const rootReal = await import("node:fs/promises").then((fs) => fs.realpath(tree.root));
    for (const file of seeded.paths) {
      const real = await import("node:fs/promises").then((fs) => fs.realpath(file));
      const relative = path.relative(rootReal, real);
      assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false);
    }
    await assert.rejects(() => removeOwned(tree.root, os.tmpdir()), /outside the fixture root/);
  } finally {
    await tree.cleanup();
  }
});

test("scenario data covers the required sizes, empty collections, and a malformed record", () => {
  for (const size of [1, 4, 40, 400, 1200]) {
    const data = scenarioData(size, "large");
    assert.equal(data.bulk.length, size);
    assert.equal(data.bulk[size - 1].unit, `unit-${String(size).padStart(4, "0")}`);
  }
  const empty = scenarioData(0, "empty");
  assert.equal(empty.units.length, 0);
  assert.equal(empty.bulk.length, 0);
  assert.equal(empty.malformed.path, "user/state/broken.md");
  const spanish = scenarioData(undefined, "spanish");
  const contrast = scenarioData(undefined, "high-contrast");
  assert.equal(spanish.settings.language, "es");
  assert.equal(contrast.settings.look, "high-contrast");
});

test("reads use the contract envelope, real revisions, and malformed-record issues", async (context) => {
  const fixture = await open(context);
  const view = await request(fixture, "GET", "/api/v1/view");
  assert.equal(view.status, 200);
  assert.equal(view.body.contract, "hivem1nd-gui-v3");
  assert.match(view.body.meta.requestId, /^[0-9a-f-]{36}$/);
  assert.match(view.body.meta.readAt, /Z$/);
  assert.match(view.body.meta.eventCursor, /:/);
  assert.equal(view.body.meta.sync, "local");
  assert.equal(JSON.stringify(view.body).includes(fixture.root), false);
  const master = view.body.data.units.find((unit) => unit.id === "root:master");
  assert.ok(master);
  assert.match(master.revision, /^[0-9a-f]{64}$/);
  assert.ok(view.body.data.issues.some((issue) => issue.code === "malformed_record"));
  const partial = view.body.data.units.find((unit) => unit.id === "project:shop:partial");
  assert.equal(partial.revision, null);
  assert.equal(partial.status, "unknown");
  const layout = await request(fixture, "GET", "/api/v1/layout");
  const bytes = await readFile(path.join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "layout.json"));
  assert.equal(layout.body.data.revision, sha256(bytes));
  const shell = await fetch(`${fixture.origin}/app/main.mjs`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get("content-security-policy"), /default-src 'self'/);
});

test("host, origin, and token failures use the contract status codes", async (context) => {
  const fixture = await open(context);
  const port = Number(new URL(fixture.origin).port);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/v1/view",
      headers: { Host: `localhost:${port}`, Authorization: fixture.headers.Authorization },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(hostStatus, 400);
  const origin = await request(fixture, "GET", "/api/v1/view", { headers: { Origin: "http://localhost" } });
  assert.equal(origin.status, 403);
  assert.equal(origin.body.error.code, "invalid_origin");
  const token = await request(fixture, "GET", "/api/v1/view", { headers: { Authorization: "Bearer wrong" } });
  assert.equal(token.status, 401);
  assert.equal(token.body.error.code, "invalid_session");
  const method = await request(fixture, "POST", "/api/v1/view", { body: {} });
  assert.equal(method.status, 405);
  assert.match(method.headers.get("allow"), /GET/);
});

test("the same idempotency key cannot commit two resources", async (context) => {
  const fixture = await open(context);
  const key = randomUUID();
  const body = { messageIds: [] };
  const [left, right] = await Promise.all([
    request(fixture, "POST", "/api/v1/mailboxes/root%3Amaster/read", { body, key }),
    request(fixture, "POST", "/api/v1/mailboxes/project%3Ashop%3Aexecutor-shop/read", { body, key }),
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  const conflict = [left, right].find((item) => item.status === 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
});

test("a stale layout write leaves the file unchanged", async (context) => {
  const fixture = await open(context);
  const file = path.join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "layout.json");
  const before = sha256(await readFile(file));
  const stale = await request(fixture, "PATCH", "/api/v1/layout", {
    key: randomUUID(),
    body: { nodes: { "root:master": { x: 12, y: 24 } }, expectedRevision: "a".repeat(64) },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "revision_conflict");
  assert.equal(sha256(await readFile(file)), before);
  const unknown = await request(fixture, "PATCH", "/api/v1/layout", {
    key: randomUUID(),
    body: { nodes: { "root:master": { x: 1, y: 1 } }, expectedRevision: before, extra: true },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, "unknown_field");
});

test("mailbox detail does not archive the message", async (context) => {
  const fixture = await open(context);
  const inbox = path.join(fixture.root, "Cosmic", "hivem1nd", "user", "inbox", "master");
  const before = await readdir(inbox);
  const list = await request(fixture, "GET", "/api/v1/mailboxes/root%3Amaster/messages?state=unread");
  const message = list.body.data.items[0];
  const detail = await request(fixture, "GET", `/api/v1/mailboxes/root%3Amaster/messages/${message.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.read, false);
  assert.deepEqual(await readdir(inbox), before);
});

test("list cursors expire when the snapshot changes and fail when the filter changes", async (context) => {
  const fixture = await open(context);
  const first = await request(fixture, "GET", "/api/v1/units?limit=1");
  assert.equal(first.status, 200);
  assert.equal(first.body.data.items.length, 1);
  assert.ok(first.body.data.total > 1);
  assert.ok(first.body.data.nextCursor);
  await fixture.control.changeResource("root:master", "A later note.");
  const expired = await request(fixture, "GET", `/api/v1/units?limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`);
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, "cursor_expired");
  const fresh = await request(fixture, "GET", "/api/v1/units?limit=1");
  const invalid = await request(fixture, "GET", `/api/v1/units?limit=1&q=other&cursor=${encodeURIComponent(fresh.body.data.nextCursor)}`);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "invalid_cursor");
});

test("a committed layout event is visible on the desktop stream", async (context) => {
  const fixture = await open(context);
  const stream = await fetch(`${fixture.origin}/api/v1/events`, { headers: fixture.headers });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("event: stream.ready")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
  }
  const current = await request(fixture, "GET", "/api/v1/layout");
  const saved = await request(fixture, "PATCH", "/api/v1/layout", {
    key: randomUUID(),
    body: { nodes: { "root:master": { x: 381, y: 57 } }, expectedRevision: current.body.data.revision },
  });
  assert.equal(saved.status, 200);
  while (!text.includes("event: layout.changed")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(text, /hivem1nd-events-v3/);
  await reader.cancel();
});

test("phone credentials cannot write, including on the desktop listener", async (context) => {
  const fixture = await open(context);
  const phoneOrigin = new URL(fixture.phoneUrl).origin;
  const home = await fetch(`${phoneOrigin}/api/v1/auth/home`, {
    method: "POST",
    headers: { Origin: phoneOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ key: FIXTURE_HOME_KEY }),
  });
  const opened = await home.json();
  assert.equal(home.status, 200);
  assert.equal(opened.data.audience, "phone");
  const denied = await request(fixture, "PATCH", "/api/v1/layout", {
    key: randomUUID(),
    headers: { Authorization: `Bearer ${opened.data.token}` },
    body: { nodes: { "root:master": { x: 3, y: 4 } }, expectedRevision: null },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "phone_read_only");
  const desktopOnHome = await fetch(`${phoneOrigin}/api/v1/view`, { headers: { ...fixture.headers, Origin: phoneOrigin } });
  assert.equal(desktopOnHome.status, 403);
});

test("a crash before the receipt is recovered once for the same principal", async (context) => {
  const fixture = await open(context);
  const current = await request(fixture, "GET", "/api/v1/layout");
  const key = randomUUID();
  const body = { nodes: { "root:master": { x: 410, y: 70 } }, expectedRevision: current.body.data.revision };
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/layout", crashAfterDataBeforeReceipt: true });
  await assert.rejects(() => request(fixture, "PATCH", "/api/v1/layout", { key, body }));
  await fixture.control.restart();
  const first = await request(fixture, "PATCH", "/api/v1/layout", { key, body });
  const second = await request(fixture, "PATCH", "/api/v1/layout", { key, body });
  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body);
  const ledgerFile = (await filesUnder(fixture.root)).find((file) => file.endsWith(`${path.sep}event-ledger.json`));
  const records = JSON.parse(await readFile(ledgerFile, "utf8")).records;
  const keys = new Set(records.map((record) => record.key));
  assert.equal(keys.size, records.length);
  assert.equal(records.length, 1);
  const receipts = (await filesUnder(fixture.root)).filter((file) => file.includes(`${path.sep}receipts${path.sep}`) && file.endsWith(".json"));
  assert.equal(receipts.length, 1);
  const layout = JSON.parse(await readFile(path.join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "layout.json"), "utf8"));
  assert.equal(layout.nodes["root:master"].x, 410);
});

test("a third hash during recovery is a fixture journal conflict", async (context) => {
  const fixture = await open(context);
  const current = await request(fixture, "GET", "/api/v1/layout");
  const key = randomUUID();
  const body = { nodes: { "root:overseer": { x: 20, y: 30 } }, expectedRevision: current.body.data.revision };
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/layout", crashAfterDataBeforeReceipt: true });
  await assert.rejects(() => request(fixture, "PATCH", "/api/v1/layout", { key, body }));
  const layoutFile = path.join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "layout.json");
  await writeFile(layoutFile, `${await readFile(layoutFile, "utf8")}\n`);
  await assert.rejects(() => fixture.control.restart(), /Fixture journal conflict/);
});

test("fixture bounds check origin before files and publish complete resource events", async (context) => {
  const fixture = await open(context);
  const foreign = await fetch(`${fixture.origin}/app/main.mjs`, { headers: { Origin: "http://evil.example" } });
  const foreignText = await foreign.text();
  assert.equal(foreign.status, 403);
  assert.equal(JSON.parse(foreignText).error.code, "invalid_origin");
  assert.equal(foreignText.includes("export function"), false);
  const localFile = await fetch(`${fixture.origin}/app/main.mjs`);
  assert.equal(localFile.status, 200);
  await localFile.arrayBuffer();

  const entries = await readdir(fixture.root, { recursive: true });
  const bootstrap = entries.find((entry) => String(entry).endsWith("bootstrap.json"));
  const secret = JSON.parse(await readFile(path.join(fixture.root, String(bootstrap)), "utf8")).secret;
  const local = (body) => fetch(`${fixture.origin}/api/v1/auth/local`, {
    method: "POST",
    headers: { Origin: fixture.origin, "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  for (const hostOrigin of ["http://user:pass@example.com", "http://example.com/app", "http://example.com?x=1", "http://example.com#x", "HTTP://example.com"]) {
    const rejected = await local({ embedded: true, hostOrigin, look: null, language: null });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error.code, "invalid_host_origin");
  }
  const look = await local({ embedded: true, hostOrigin: "https://embed.example", look: "comic", language: null });
  assert.equal(look.status, 422);
  assert.equal(look.body.error.code, "invalid_body");
  const language = await local({ embedded: true, hostOrigin: "https://embed.example", look: "modern", language: "fr" });
  assert.equal(language.status, 422);
  const accepted = await local({ embedded: true, hostOrigin: "https://embed.example", look: "high-contrast", language: "es" });
  assert.equal(accepted.status, 201);

  const postBytes = async (method, route, size) => {
    const response = await fetch(`${fixture.origin}${route}`, {
      method,
      headers: { ...fixture.headers, "Content-Type": "application/json" },
      body: Buffer.alloc(size, 0x78),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const general = await postBytes("POST", "/api/v1/units", 2_000_001);
  assert.equal(general.status, 413);
  assert.equal(general.body.error.code, "body_too_large");
  const replacement = await postBytes("PUT", "/api/v1/blueprint/boards/missing", 2_000_001);
  assert.equal(replacement.status, 400);
  assert.equal(replacement.body.error.code, "invalid_json");
  const upload = await postBytes("POST", "/api/v1/editors/missing/assets", 2_000_001);
  assert.equal(upload.status, 400);
  assert.equal(upload.body.error.code, "invalid_json");
  const ceiling = await postBytes("PUT", "/api/v1/void/texts/missing", 16_000_001);
  assert.equal(ceiling.status, 413);
  assert.equal(ceiling.body.error.code, "body_too_large");

  fixture.control.holdReads();
  try {
    const pending = request(fixture, "GET", "/api/v1/view");
    for (let attempt = 0; attempt < 50 && fixture.control.readsWaiting() < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fixture.control.readsWaiting() > 0, true);
    const eventId = await fixture.control.emit("service.changed", { machine: { id: "LAPTOP", version: "3.0.1", state: "running", answers: true } });
    fixture.control.releaseReads();
    const viewed = await pending;
    const cursor = /^([0-9a-f-]{36}):(\d+)$/.exec(viewed.body.meta.eventCursor);
    const emitted = /^([0-9a-f-]{36}):(\d+)$/.exec(eventId);
    assert.equal(cursor[1], emitted[1]);
    assert.equal(Number(cursor[2]) < Number(emitted[2]), true);
  } finally {
    fixture.control.releaseReads();
  }

  const board = await request(fixture, "POST", "/api/v1/blueprint/boards", {
    key: randomUUID(),
    body: {
      project: "shop",
      document: { formatVersion: 1, id: "bound-board", title: "Bound", screens: [{ id: "main", title: "Main", root: { id: "root", t: "box", kids: [] } }] },
    },
  });
  assert.equal(board.status, 201);
  const added = await request(fixture, "POST", `/api/v1/blueprint/boards/${board.body.data.id}/nodes`, {
    key: randomUUID(),
    body: {
      screenId: "main",
      parentId: "root",
      node: { id: "extra", t: "text", name: "Extra" },
      expectedRevision: board.body.data.revision,
    },
  });
  assert.equal(added.status, 200);
  const text = await request(fixture, "POST", "/api/v1/void/texts", {
    key: randomUUID(),
    body: { project: "shop", path: "docs/bound.json", document: { formatVersion: 1, id: "bound-text", title: "Bound", pages: [{ k: "Intro", en: "Hello" }] } },
  });
  assert.equal(text.status, 201);
  const ranged = await request(fixture, "POST", `/api/v1/void/texts/${text.body.data.id}/ranges`, {
    key: randomUUID(),
    body: { k: "Intro", lang: "en", start: 0, end: 5, expectedText: "Hello", replacement: "Hi", expectedRevision: text.body.data.revision },
  });
  assert.equal(ranged.status, 200);
  const boards = await request(fixture, "GET", "/api/v1/blueprint/boards?limit=50");
  const cart = boards.body.data.items.find((item) => item.title === "Cart");
  const current = await request(fixture, "GET", `/api/v1/blueprint/boards/${cart.id}`);
  const comment = await request(fixture, "POST", `/api/v1/editors/${cart.id}/comments`, {
    key: randomUUID(),
    body: {
      text: "A note.",
      expectedRevision: current.body.data.revision,
      expectedCommentsRevision: current.body.data.commentsRevision,
      anchor: { screen: null, screenTitle: null, element: null, label: "Board", path: [], point: { x: 0, y: 0 } },
    },
  });
  assert.equal(comment.status, 201);
  const tasks = await request(fixture, "GET", "/api/v1/tasks?limit=50");
  const openTask = tasks.body.data.items.find((item) => item.status === "open");
  const moved = await request(fixture, "POST", `/api/v1/tasks/${encodeURIComponent(openTask.id)}/status`, {
    key: randomUUID(),
    body: { status: "review", expectedRevision: openTask.revision },
  });
  assert.equal(moved.status, 200);
  const undone = await request(fixture, "POST", `/api/v1/tasks/${encodeURIComponent(openTask.id)}/undo`, {
    key: randomUUID(),
    body: { expectedRevision: moved.body.data.task.revision },
  });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.data.undoOf, moved.body.data.changeId);
  const ledgerFile = (await filesUnder(fixture.root)).find((file) => file.endsWith(`${path.sep}event-ledger.json`));
  const records = JSON.parse(await readFile(ledgerFile, "utf8")).records;
  const named = (name) => records.filter((record) => record.name === name).map((record) => record.data);
  const createdBoard = named("blueprint.changed").find((data) => data.operation === "create");
  assert.equal(createdBoard.resourceId, board.body.data.id);
  assert.match(createdBoard.revision, /^[0-9a-f]{64}$/);
  assert.equal(createdBoard.nodeId, null);
  const nodeEvent = named("blueprint.changed").find((data) => data.operation === "add-node");
  assert.equal(nodeEvent.nodeId, "extra");
  const createdText = named("void.changed").find((data) => data.operation === "create");
  assert.equal(createdText.resourceId, text.body.data.id);
  assert.equal(createdText.rev, 1);
  assert.equal(createdText.k, null);
  assert.equal(createdText.lang, null);
  const rangedEvent = named("void.changed").find((data) => data.operation === "replace-range");
  assert.equal(rangedEvent.k, "Intro");
  assert.equal(rangedEvent.lang, "en");
  assert.equal(typeof rangedEvent.rev, "number");
  const commentEvent = named("comment.changed").find((data) => data.operation === "create");
  assert.equal(commentEvent.resourceId, cart.id);
  assert.equal(commentEvent.thread.id, comment.body.data.thread.id);
  assert.match(commentEvent.commentsRevision, /^[0-9a-f]{64}$/);
  const taskEvent = named("task.changed").find((data) => data.changeId === moved.body.data.changeId);
  assert.equal(taskEvent.task.id, openTask.id);
  assert.equal(taskEvent.undoOf, null);
  const undoEvent = named("task.changed").find((data) => data.changeId === undone.body.data.changeId);
  assert.equal(undoEvent.undoOf, moved.body.data.changeId);
});

test("the fixture import graph stays inside Node built-ins and its own helper", async () => {
  const allowed = new Set(["node:http", "node:crypto", "node:fs/promises", "node:path", "node:os", "node:url", "./gui-data.mjs"]);
  const seen = new Set();
  async function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    assert.equal(source.includes("import("), false);
    for (const specifier of imports) {
      assert.equal(allowed.has(specifier), true, specifier);
      assert.equal(/engine|cli|features|https?:/.test(specifier), false);
      if (specifier.startsWith(".")) await walk(path.resolve(path.dirname(file), specifier));
    }
  }
  await walk(path.resolve("test/gui-fixture.mjs"));
  await walk(path.resolve("test/gui-data.mjs"));
});

test("the fixture command prints only its origin and stores viewer links privately", async () => {
  const child = spawn(process.execPath, ["test/gui-fixture.mjs", "--scenario", "standard"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture command produced no origin")), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const line = output.trim().split(/\r?\n/).find((item) => item.startsWith("http://"));
      if (line) {
        clearTimeout(timer);
        resolve(line.trim());
      }
    });
    child.once("error", reject);
  });
  assert.equal(output.includes("session="), false);
  assert.equal(output.includes(FIXTURE_HOME_KEY), false);
  const directories = (await readdir(os.tmpdir())).filter((name) => name.startsWith("hivem1nd-gui-"));
  let links = null;
  for (const name of directories) {
    const candidate = path.join(os.tmpdir(), name, "links.json");
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8"));
      if (parsed.desktop?.startsWith(origin)) links = parsed;
    } catch {
      // Another fixture directory has no links file.
    }
  }
  assert.ok(links?.desktop.includes("#session="));
  assert.ok(links.phone.includes("#home="));
  child.stdin.write("quit\n");
  const exit = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exit, 0);
});
