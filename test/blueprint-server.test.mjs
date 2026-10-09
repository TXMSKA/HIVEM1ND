import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRelay } from "../engine/relay/store.mjs";
import { addLink, addScreen, newSketch, rectangleNode } from "../features/blueprint/review/sketch-format.mjs";

const SERVER = fileURLToPath(new URL("../features/blueprint/server.mjs", import.meta.url));
const HOST = "TESTBOX";
const STYLE = { stroke: "#1c1c1c", fill: "none" };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A mind with the project `shop` and a repository with the board `checkout`,
 * in a temporary folder, and the real server running against them.
 */
async function world(context, { agent = true, wake = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "blueprint-lite-"));
  const mind = path.join(root, "mind");
  const repo = path.join(root, "repo");
  const flows = path.join(repo, "docs", "flows");
  await mkdir(path.join(mind, "user", "machines"), { recursive: true });
  await mkdir(path.join(mind, "user", "projects", "shop", "state"), { recursive: true });
  await mkdir(path.join(flows, "boards"), { recursive: true });
  await writeFile(path.join(mind, "user", "machines", `${HOST}.md`), `## Paths\n\n- shop: ${repo}\n`);
  await writeFile(path.join(mind, "user", "routes.md"), "## Environments\n\n- web: shop\n\n## Projects\n\n- shop (web)\n");
  await writeFile(path.join(flows, "boards", "index.json"), JSON.stringify([{ id: "checkout", letter: "CH", short: "Checkout", title: "Checkout" }]));
  if (agent) {
    await writeFile(path.join(mind, "user", "projects", "shop", "state", "executor-shop.md"), `unit: executor-shop\nstate: in\nmachine: ${HOST}\ndate: 2026-10-05 10:00\n\nWorking on shop.\n`);
  }
  if (wake) {
    const folder = path.join(mind, "user", "relay", "wake", "policies");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${"a".repeat(64)}.json`), JSON.stringify({ enabled: true, deadlineAt: null, binding: { unit: "executor-shop" } }));
  }

  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, "--mind", mind, "--hostname", HOST, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  await new Promise((resolve, reject) => {
    child.once("exit", () => reject(new Error(`The server stopped: ${errors}`)));
    child.stdout.on("data", (chunk) => String(chunk).includes("Blueprint is on") && resolve());
  });
  context.after(async () => {
    child.kill();
    await new Promise((resolve) => (child.exitCode === null ? child.once("exit", resolve) : resolve()));
    await rm(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  const call = async (route, { method = "GET", body, type = "application/json", headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": type }), ...headers },
      body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const text = Buffer.from(await response.arrayBuffer());
    const json = /json/.test(response.headers.get("content-type") ?? "") ? JSON.parse(text.toString("utf8")) : null;
    return { status: response.status, json, text, headers: response.headers };
  };
  return { root, mind, repo, flows, port, base, call, errors: () => errors };
}

const comment = (text, extra = {}) => ({
  op: "add",
  anchor: { screen: "pay", screenTitle: "Payment", element: "continue", label: "Continue", path: ["Payment", "Continue"], point: { x: 10, y: 20 } },
  text,
  ...extra,
});

async function inboxOf(w, unit = "executor-shop") {
  const relay = await createRelay({ mindPath: w.mind, hostname: HOST, sessionId: "reader", client: "test" });
  return (await relay.read({ unit })).messages;
}

function sketchWith(board = "checkout") {
  const sketch = newSketch(board, "Checkout");
  const first = addScreen(sketch, { title: "Coupon", x: 0, y: 1000 });
  const second = addScreen(sketch, { title: "Receipt", x: 1800, y: 1000 });
  first.root.kids.push(rectangleNode(sketch, { x: 40, y: 40, w: 300, h: 80 }, STYLE));
  addLink(sketch, first.id, second.id);
  return sketch;
}

test("the agent route names the unit of the project and whether its wake is on", async (context) => {
  const asleep = await world(context);
  assert.deepEqual((await asleep.call("/api/agent/shop")).json, { agent: { unit: "executor-shop", awake: false } });
  assert.equal((await asleep.call("/api/agent/nowhere")).status, 404);

  const awake = await world(context, { wake: true });
  assert.deepEqual((await awake.call("/api/agent/shop")).json, { agent: { unit: "executor-shop", awake: true } });

  const alone = await world(context, { agent: false });
  assert.deepEqual((await alone.call("/api/agent/shop")).json, { agent: null });
  assert.deepEqual(await readdir(path.join(alone.mind, "user")), ["machines", "projects", "routes.md"], "asking who the agent is writes nothing to the mind");
});

test("a comment without the flag is saved as it always was and sends nothing", async (context) => {
  const w = await world(context);
  const added = await w.call("/api/comments/shop/checkout", { method: "POST", body: comment("The total is missing.") });
  assert.equal(added.status, 200);
  assert.equal(added.json.threads.length, 1);
  assert.equal(added.json.relay, undefined);
  assert.equal(added.json.saved, undefined);
  assert.deepEqual(await readdir(path.join(w.mind, "user", "projects", "shop")), ["state"], "no inbox was created");
  const onDisk = JSON.parse(await readFile(path.join(w.flows, "comments", "checkout.json"), "utf8"));
  assert.equal(onDisk.threads[0].messages[0].text, "The total is missing.");

  const off = await w.call("/api/comments/shop/checkout", { method: "POST", body: comment("Still nothing sent.", { send: false }) });
  assert.equal(off.json.relay, undefined);
  assert.deepEqual(await readdir(path.join(w.mind, "user", "projects", "shop")), ["state"]);
});

test("a comment with the flag is saved first and then sent to the agent of the project", async (context) => {
  const w = await world(context);
  const added = await w.call("/api/comments/shop/checkout", { method: "POST", body: comment("The total is missing.\nAdd it under the lines.", { send: true }) });
  assert.equal(added.status, 200);
  assert.equal(added.json.saved, true);
  assert.equal(added.json.relay.sent, true);
  assert.equal(added.json.relay.to, "executor-shop");
  assert.equal(added.json.threads.length, 1);

  const [message] = await inboxOf(w);
  const file = path.resolve(w.flows, "comments", "checkout.json");
  assert.equal(message.from, "user");
  assert.equal(message.subject, "Blueprint comment: checkout / Continue");
  assert.deepEqual(message.attachments, [file]);
  const thread = added.json.threads[0].id;
  assert.match(message.body, /^A new comment on the board checkout of shop\./);
  assert.match(message.body, /^> The total is missing\.\n> Add it under the lines\.$/m);
  assert.match(message.body, /^Project: shop$/m);
  assert.match(message.body, /^Board: checkout$/m);
  assert.match(message.body, /^Screen: pay \(Payment\)$/m);
  assert.match(message.body, /^Element: continue \(Continue\)$/m);
  assert.match(message.body, new RegExp(`^Thread: ${thread}$`, "m"));
  assert.ok(message.body.includes(`open docs/flows/comments/checkout.json of the project (the attached file, ${file}), find the thread ${thread} and append a message to its messages`), message.body);
  assert.equal(JSON.parse(await readFile(file, "utf8")).threads[0].messages[0].text, "The total is missing.\nAdd it under the lines.");
});

test("a reply with the flag is sent in its thread, and the subject names the screen when no element is pinned", async (context) => {
  const w = await world(context);
  const screenOnly = { ...comment("Whole screen.").anchor, element: null, label: "Payment", path: ["Payment"] };
  const first = await w.call("/api/comments/shop/checkout", { method: "POST", body: { op: "add", anchor: screenOnly, text: "Whole screen." } });
  const thread = first.json.threads[0].id;
  const reply = await w.call("/api/comments/shop/checkout", { method: "POST", body: { op: "reply", thread, text: "Please answer.", send: true } });
  assert.equal(reply.json.relay.sent, true);
  assert.equal(reply.json.threads[0].messages.length, 2);
  const [message] = await inboxOf(w);
  assert.equal(message.subject, "Blueprint comment: checkout / Payment");
  assert.match(message.body, /^A reply in a comment thread on the board checkout of shop\./);
  assert.match(message.body, /^> Please answer\.$/m);
  assert.match(message.body, /^Element: none$/m);
});

test("a comment on a project with no agent is saved and says why nothing was sent", async (context) => {
  const w = await world(context, { agent: false });
  const added = await w.call("/api/comments/shop/checkout", { method: "POST", body: comment("Nobody to tell.", { send: true }) });
  assert.equal(added.status, 200);
  assert.equal(added.json.saved, true);
  assert.deepEqual(added.json.relay, { sent: false, reason: "no-agent" });
  assert.equal(added.json.threads[0].messages[0].text, "Nobody to tell.");
});

test("a message that fails to send never costs the comment", async (context) => {
  const w = await world(context);
  // A file where the inbox folder has to be makes the delivery fail after the agent is found.
  await writeFile(path.join(w.mind, "user", "projects", "shop", "inbox"), "not a folder");
  const added = await w.call("/api/comments/shop/checkout", { method: "POST", body: comment("Keep these words.", { send: true }) });
  assert.equal(added.status, 200);
  assert.equal(added.json.saved, true);
  assert.deepEqual(added.json.relay, { sent: false, reason: "failed" });
  assert.equal(added.json.threads[0].messages[0].text, "Keep these words.");
  const onDisk = JSON.parse(await readFile(path.join(w.flows, "comments", "checkout.json"), "utf8"));
  assert.equal(onDisk.threads[0].messages[0].text, "Keep these words.");
  assert.equal((await w.call("/api/comments/shop/checkout")).json.threads.length, 1);
});

test("the comment route still refuses what it always refused", async (context) => {
  const w = await world(context);
  const route = "/api/comments/shop/checkout";
  assert.equal((await w.call(route, { method: "POST", body: comment("x", { send: "yes" }) })).status, 400);
  assert.equal((await w.call(route, { method: "POST", body: comment("x"), headers: { Origin: "http://evil.example" } })).status, 403);
  assert.equal((await w.call(route, { method: "POST", body: comment("x"), headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await w.call(route, { method: "POST", body: "{}", type: "text/plain" })).status, 415);
  assert.equal((await w.call(route, { method: "POST", body: "x".repeat(70 * 1024) })).status, 413);
  assert.equal((await w.call(route, { method: "POST", body: { op: "add", anchor: null, text: "x", send: true } })).status, 400);
  assert.equal((await w.call("/api/comments/shop/..%2Fx")).status, 404);
  assert.equal((await w.call(route)).json.threads.length, 0, "nothing refused was saved");
});

test("a sketch is empty until saved, then loads exactly as it was written", async (context) => {
  const w = await world(context);
  const route = "/api/sketch/shop/checkout";
  const empty = (await w.call(route)).json;
  assert.equal(empty.revision, "");
  assert.equal(empty.problem, null);
  assert.equal(empty.sketch.screens.length, 0);
  assert.equal(empty.sketch.id, "checkout");

  const sketch = sketchWith();
  const saved = await w.call(route, { method: "PUT", body: { base: "", sketch } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.sketch, sketch);
  const file = path.join(w.flows, "sketches", "checkout.json");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), sketch);
  assert.deepEqual(await readdir(path.dirname(file)), ["checkout.json"], "no temporary file is left");

  const loaded = (await w.call(route)).json;
  assert.equal(loaded.revision, saved.json.revision);
  assert.deepEqual(loaded.sketch, sketch);
});

test("a save made on a stale revision is refused with the sketch that is on disk", async (context) => {
  const w = await world(context);
  const route = "/api/sketch/shop/checkout";
  const first = (await w.call(route, { method: "PUT", body: { base: "", sketch: sketchWith() } })).json;
  const edited = JSON.parse(await readFile(path.join(w.flows, "sketches", "checkout.json"), "utf8"));
  edited.screens[0].title = "Edited by an agent";
  edited.screens[0].root.name = "Edited by an agent";
  await writeFile(path.join(w.flows, "sketches", "checkout.json"), JSON.stringify(edited));

  const stale = await w.call(route, { method: "PUT", body: { base: first.revision, sketch: sketchWith() } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.sketch.screens[0].title, "Edited by an agent");
  assert.notEqual(stale.json.revision, first.revision);
  assert.equal(JSON.parse(await readFile(path.join(w.flows, "sketches", "checkout.json"), "utf8")).screens[0].title, "Edited by an agent");

  const fresh = await w.call(route, { method: "PUT", body: { base: stale.json.revision, sketch: stale.json.sketch } });
  assert.equal(fresh.status, 200);
  assert.equal((await w.call(route, { method: "PUT", body: { sketch: sketchWith() } })).status, 400, "a save with no revision is refused");
});

test("a sketch that is not Blueprint JSON v1 as Lite reads it is refused and never written", async (context) => {
  const w = await world(context);
  const route = "/api/sketch/shop/checkout";
  const put = (sketch, headers) => w.call(route, { method: "PUT", body: { base: "", sketch }, headers });

  const bad = sketchWith();
  bad.screens[0].root.kids[0].fill = "red";
  const refused = await put(bad);
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /screens\[0\]\.root\.kids\[0\]\.fill/);

  const extra = sketchWith();
  extra.script = "alert(1)";
  assert.match((await put(extra)).json.error, /script is not part of a Lite sketch/);

  const drawn = sketchWith();
  drawn.screens[0].root.kids.push({ id: "n-evil", name: "Evil", t: "vector", place: { x: 0, y: 0 }, w: 10, h: 10, d: 'M0 0" onload="x' });
  assert.equal((await put(drawn)).status, 400);

  assert.equal((await put(sketchWith(), { Origin: "http://evil.example" })).status, 403);
  assert.equal((await w.call(route, { method: "PUT", body: "{}", type: "text/plain" })).status, 415);
  assert.equal((await w.call(route, { method: "PUT", body: "{" })).status, 400);
  const big = sketchWith();
  big.note = "x".repeat(3 * 1024 * 1024);
  assert.equal((await put(big)).status, 413);
  assert.equal((await w.call("/api/sketch/shop/nowhere")).status, 404);
  assert.equal((await w.call("/api/sketch/shop/..%2Fboards")).status, 404);
  assert.equal((await w.call("/api/sketch/shop/checkout", { method: "POST", body: {} })).status, 405);
  await assert.rejects(readFile(path.join(w.flows, "sketches", "checkout.json")), { code: "ENOENT" });
});

test("a sketch file that was edited into something invalid is reported, not overwritten", async (context) => {
  const w = await world(context);
  await mkdir(path.join(w.flows, "sketches"), { recursive: true });
  await writeFile(path.join(w.flows, "sketches", "checkout.json"), JSON.stringify({ ...newSketch("checkout", "Checkout"), formatVersion: 2 }));
  const loaded = (await w.call("/api/sketch/shop/checkout")).json;
  assert.equal(loaded.sketch, null);
  assert.match(loaded.problem, /formatVersion/);
  assert.notEqual(loaded.revision, "");
});

test("a picture is checked by its bytes and kept in the assets of the repository", async (context) => {
  const w = await world(context);
  const saved = await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/png" });
  assert.equal(saved.status, 201);
  assert.match(saved.json.src, /^assets\/[0-9a-f-]{36}\.png$/);
  assert.equal(saved.json.url, `/p/shop/${saved.json.src}`);
  assert.deepEqual(await readFile(path.join(w.flows, saved.json.src)), PNG);
  const served = await w.call(saved.json.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");

  const jpeg = await w.call("/api/images/shop", { method: "POST", body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), type: "image/jpeg" });
  assert.match(jpeg.json.src, /\.jpg$/);
  const webp = await w.call("/api/images/shop", { method: "POST", body: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]), type: "image/webp" });
  assert.match(webp.json.src, /\.webp$/);

  assert.equal((await w.call("/api/images/shop", { method: "POST", body: Buffer.from("<svg onload=alert(1)>"), type: "image/png" })).status, 415);
  assert.equal((await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/jpeg" })).status, 415);
  assert.equal((await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/svg+xml" })).status, 415);
  assert.equal((await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/png", headers: { Origin: "http://evil.example" } })).status, 403);
  assert.equal((await w.call("/api/images/shop", { method: "POST", body: Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]), type: "image/png" })).status, 413);
  assert.equal((await w.call("/api/images/nowhere", { method: "POST", body: PNG, type: "image/png" })).status, 404);
  assert.equal((await w.call("/api/images/shop")).status, 405);
  assert.equal((await readdir(path.join(w.flows, "assets"))).length, 3, "only the three good pictures were kept");
});

test("a reference image opens a thread on its screen and asks the agent to recreate it", async (context) => {
  const w = await world(context);
  const picture = (await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/png" })).json;
  const sketch = newSketch("checkout", "Checkout");
  const screen = addScreen(sketch, { title: "Reference", x: 0, y: 1000, w: 600, h: 400 });
  screen.root.kids.push({ id: "n-reference", name: "Reference", t: "image", place: { x: 0, y: 0 }, w: 600, h: 400, src: picture.src });
  await w.call("/api/sketch/shop/checkout", { method: "PUT", body: { base: "", sketch } });

  const asked = await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: screen.id, note: "Match the spacing." } });
  assert.equal(asked.status, 200);
  assert.equal(asked.json.saved, true);
  assert.equal(asked.json.relay.sent, true);
  const thread = asked.json.threads.find((t) => t.id === asked.json.thread);
  assert.equal(thread.anchor.screen, screen.id);
  assert.equal(thread.anchor.element, null);
  assert.equal(thread.messages[0].text, "Match the spacing.");

  const [message] = await inboxOf(w);
  const comments = path.resolve(w.flows, "comments", "checkout.json");
  const image = path.resolve(w.flows, picture.src);
  assert.equal(message.subject, "Blueprint reference: checkout / Reference");
  assert.deepEqual(message.attachments, [image, comments]);
  assert.match(message.body, /^> Match the spacing\.$/m);
  assert.match(message.body, new RegExp(`^Sketch screen: ${screen.id} \\(Reference\\)$`, "m"));
  assert.ok(message.body.includes(`Reference image: ${image}`));
  assert.ok(message.body.includes(`open docs/flows/comments/checkout.json of the project (the attached file, ${comments}), find the thread ${thread.id} and append a message`));

  const plain = await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: screen.id } });
  assert.equal(plain.json.threads.find((t) => t.id === plain.json.thread).messages[0].text, "Recreate this reference image as a screen of the board.");
});

test("a reference request needs a screen with a picture, and keeps its thread when nothing can be sent", async (context) => {
  const w = await world(context, { agent: false });
  const sketch = sketchWith();
  await w.call("/api/sketch/shop/checkout", { method: "PUT", body: { base: "", sketch } });
  assert.equal((await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: sketch.screens[0].id } })).status, 404);
  assert.equal((await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: "nowhere" } })).status, 404);
  assert.equal((await w.call("/api/reference/shop/checkout", { method: "POST", body: { note: "x" } })).status, 400);
  assert.equal((await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: "x" }, headers: { Origin: "http://evil.example" } })).status, 403);
  assert.equal((await w.call("/api/reference/shop/nowhere", { method: "POST", body: { screen: "x" } })).status, 404);

  const picture = (await w.call("/api/images/shop", { method: "POST", body: PNG, type: "image/png" })).json;
  const withImage = (await w.call("/api/sketch/shop/checkout")).json;
  withImage.sketch.screens[0].root.kids.push({ id: "n-reference", name: "Reference", t: "image", place: { x: 0, y: 0 }, w: 100, h: 100, src: picture.src });
  await w.call("/api/sketch/shop/checkout", { method: "PUT", body: { base: withImage.revision, sketch: withImage.sketch } });
  const asked = await w.call("/api/reference/shop/checkout", { method: "POST", body: { screen: sketch.screens[0].id } });
  assert.equal(asked.status, 200);
  assert.deepEqual(asked.json.relay, { sent: false, reason: "no-agent" });
  assert.equal(asked.json.threads.length, 1);
});

test("the server keeps refusing a host it does not know, and a sketch can be asked for only by its own board", async (context) => {
  const w = await world(context);
  const status = await new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: w.port, path: "/api/sketch/shop/checkout", headers: { Host: "evil.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 421);
  assert.equal((await w.call("/api/agent/..%2F..")).status, 404);
});

test("the viewer serves the sketch modules to the page, and the format module is the one the server checks with", async (context) => {
  const w = await world(context);
  for (const file of ["sketch.js", "sketch-format.mjs", "review.js", "review.css"]) {
    const served = await w.call(`/review/${file}`);
    assert.equal(served.status, 200, file);
    assert.match(served.headers.get("content-type"), /^(text\/javascript|text\/css)/, file);
  }
  const served = (await w.call("/review/sketch-format.mjs")).text.toString("utf8");
  assert.equal(served.replace(/\r\n/g, "\n"), (await readFile(new URL("../features/blueprint/review/sketch-format.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n"));
  const page = await w.call("/review/");
  assert.match(page.text.toString("utf8"), /id="sketchbar"/);
  assert.equal((page.text.toString("utf8").match(/data-sends/g) ?? []).length, 3, "the comment box, the reply box and the reference card each offer Send to agent");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
});
