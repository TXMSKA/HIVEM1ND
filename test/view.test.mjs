import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { helpText, parseArgs, runCli } from "../cli/index.mjs";
import { VIEW_CONTRACT, readView } from "../engine/view.mjs";

const FIXTURE = path.resolve(import.meta.dirname, "..", "fixtures", "view", "mind");
// Five minutes after the fixture's Relay observations, which Relay still counts as current.
const NOW = "2026-10-08T12:05:00.000Z";
const MALFORMED = [
  "010-fenced-header",
  "011-sentence-status",
  "012-status-delivered",
  "013-status-working",
  "014-heading-first",
  "015-brief-a",
  "015-brief-b",
].map((name) => `user/projects/shop/tasks/${name}.md`);

async function temporaryDirectory(t, name) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `hivem1nd-${name}-`));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  return directory;
}

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function copyOfFixture(t) {
  const directory = await temporaryDirectory(t, "view");
  await fs.cp(FIXTURE, directory, { recursive: true });
  return directory;
}

async function snapshot(directory) {
  const files = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    files[filePath] = (await fs.readFile(filePath)).toString("base64");
  }
  return files;
}

const view = (options = {}) => readView({ mindPath: FIXTURE, hostname: "LAPTOP", now: NOW, ...options });
const chat = (result, unit) => result.chats.find((item) => item.unit === unit);
const keys = (value) => Object.keys(value);

function sink() {
  let value = "";
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

test("the fixture reads into every key of the contract, with the right types", async () => {
  const result = await view();
  assert.deepEqual(keys(result), ["contract", "readAt", "mind", "chats", "squads", "waiting", "tasks", "inbox", "products", "counts", "issues"]);
  assert.equal(result.contract, VIEW_CONTRACT);
  assert.equal(result.contract, "hivem1nd-view-v1");
  assert.equal(result.readAt, NOW);
  assert.deepEqual(result.mind, { version: "2.0.0", machine: "LAPTOP", machines: ["DESKTOP", "LAPTOP"], project: null });

  for (const item of result.chats) {
    assert.deepEqual(keys(item).filter((key) => key !== "environment" && key !== "project"),
      ["unit", "scope", "state", "status", "lead", "job", "model", "machine", "date", "branch", "context", "relay", "path"]);
    assert.deepEqual(keys(item.relay), ["registered", "client", "activity", "activityObservedAt", "quota", "wake"]);
    assert.ok(["in", "out"].includes(item.state));
    assert.ok(["out", "unknown", "quota", "waiting", "working", "idle"].includes(item.status));
    assert.ok(["root", "environment", "project"].includes(item.scope));
    for (const key of ["lead", "job", "model", "machine", "date", "branch", "context"]) assert.ok(item[key] === null || typeof item[key] === "string", key);
    assert.equal(typeof item.relay.registered, "boolean");
    assert.equal(typeof item.relay.wake, "boolean");
    assert.match(item.path, /^user\/.+\.md$/);
  }
  assert.equal(chat(result, "overlord-web").environment, "web");
  assert.equal(chat(result, "executor-myapp").project, "myapp");
  assert.equal("project" in chat(result, "manager"), false);

  for (const squad of result.squads) {
    assert.deepEqual(keys(squad).filter((key) => key !== "environment" && key !== "project"), ["lead", "scope", "members", "rollup"]);
    assert.deepEqual(keys(squad.rollup), ["working", "idle", "waiting", "out", "attention"]);
    assert.ok(squad.lead === null || typeof squad.lead === "string");
    assert.ok(squad.members.every((member) => typeof member === "string"));
  }
  for (const item of result.waiting) {
    assert.deepEqual(keys(item), ["kind", "title", "project", "unit", "since", "path", "task", "approvedBy"]);
    assert.ok(["review", "question", "message"].includes(item.kind));
  }
  for (const item of result.tasks) {
    assert.deepEqual(keys(item), ["project", "id", "title", "status", "to", "from", "requirements", "approvedBy", "path"]);
    assert.ok(["open", "review", "done"].includes(item.status));
    assert.ok(Array.isArray(item.requirements));
  }
  for (const item of result.inbox) {
    assert.deepEqual(keys(item), ["unit", "from", "to", "subject", "date", "priority", "replyRequested", "path"]);
    assert.equal(typeof item.replyRequested, "boolean");
  }
  for (const item of result.products) {
    assert.deepEqual(keys(item), ["project", "stage", "updated", "requirements", "openQuestions", "annexes", "path"]);
    assert.deepEqual(keys(item.requirements), ["alpha", "beta", "release"]);
    assert.deepEqual(keys(item.requirements.beta), ["met", "total"]);
    assert.equal(typeof item.openQuestions, "number");
  }
  assert.deepEqual(keys(result.counts), ["chats", "waiting", "open", "review", "done", "closed", "unread", "issues"]);
  assert.deepEqual(result.counts, { chats: 10, waiting: 6, open: 3, review: 4, done: 2, closed: 1, unread: 4, issues: 8 });
  for (const item of result.issues) assert.deepEqual(keys(item), ["path", "reason"]);
  JSON.parse(JSON.stringify(result));
});

test("each malformed task file is one issue and the rest of the read is complete", async () => {
  const result = await view();
  const taskIssues = result.issues.filter((issue) => issue.path.includes("/tasks/"));
  assert.deepEqual(taskIssues.map((issue) => issue.path), MALFORMED);
  assert.deepEqual(taskIssues.map((issue) => issue.reason), [
    "header line 6 is not key: value",
    "status is not open, review, done or closed",
    "status is not open, review, done or closed",
    "status is not open, review, done or closed",
    "header line 1 is not key: value",
    "header line 1 is not key: value",
    "header line 1 is not key: value",
  ]);
  assert.equal(result.tasks.some((task) => MALFORMED.includes(task.path)), false);
  assert.deepEqual(result.tasks.map((task) => `${task.project}/${task.id}`), [
    "myapp/001", "myapp/003", "myapp/004", "myapp/005", "myapp/006",
    "mygame/001",
    "shop/001", "shop/002", "shop/003",
  ]);
  assert.equal(result.chats.length, 10);
  assert.equal(result.products.length, 1);
  assert.equal(result.inbox.length, 4);
  assert.equal(result.waiting.length, 6);
});

test("a task saved with a byte order mark and CRLF reads without an issue", async () => {
  const file = path.join(FIXTURE, "user", "projects", "mygame", "tasks", "001-first-level.md");
  const bytes = await fs.readFile(file);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the fixture keeps its byte order mark");
  assert.ok(bytes.includes("\r\n"), "the fixture keeps its CRLF line endings");
  const result = await view();
  const task = result.tasks.find((item) => item.project === "mygame");
  assert.equal(task.id, "001");
  assert.equal(task.status, "open");
  assert.equal(task.title, "first level");
  assert.equal(result.issues.some((issue) => issue.path.includes("mygame")), false);
});

test("a task whose header repeats a key or whose id is not a number is one issue", async (t) => {
  const mind = await copyOfFixture(t);
  const tasks = path.join(mind, "user", "projects", "mygame", "tasks");
  await write(path.join(tasks, "002-twice.md"), "id: 002\nstatus: open\nstatus: done\n\n## Request\nx\n");
  await write(path.join(tasks, "003-letters.md"), "id: 3a\nstatus: open\n\n## Request\nx\n");
  await write(path.join(tasks, "004-no-id.md"), "status: open\nfrom: user\n\n## Request\nx\n");
  const result = await view({ mindPath: mind });
  const found = Object.fromEntries(result.issues.filter((issue) => issue.path.includes("mygame")).map((issue) => [path.basename(issue.path), issue.reason]));
  assert.deepEqual(found, {
    "002-twice.md": "header status appears twice",
    "003-letters.md": "id is missing or not a number",
    "004-no-id.md": "id is missing or not a number",
  });
  assert.equal(result.tasks.filter((task) => task.project === "mygame").length, 1);
});

test("a chat is out, unknown, quota, waiting, working or idle, in that order of precedence", async () => {
  const result = await view();
  const statuses = Object.fromEntries(result.chats.map((item) => [item.unit, item.status]));
  assert.deepEqual(statuses, {
    manager: "waiting",
    "overlord-web": "out",
    "overlord-myapp": "waiting",
    "executor-myapp": "working",
    "reader-myapp": "quota",
    "archiver-myapp": "out",
    "executor-shop": "waiting",
    "builder-shop": "idle",
    "helper-shop": "unknown",
    "executor-mygame": "idle",
  });
  assert.equal(chat(result, "helper-shop").state, "out", "an unknown chat reports out");
  assert.deepEqual(result.issues.filter((issue) => issue.path.endsWith("helper-shop.md")), [
    { path: "user/projects/shop/state/helper-shop.md", reason: "state is not in or out" },
  ]);
});

test("Relay joins by unit, follows the newest registration and lets an old observation lapse", async (t) => {
  const result = await view();
  assert.deepEqual(chat(result, "executor-myapp").relay, {
    registered: true, client: "host", activity: "busy", activityObservedAt: "2026-10-08T12:00:00.000Z", quota: null, wake: true,
  });
  assert.deepEqual(chat(result, "reader-myapp").relay, {
    registered: true, client: "host", activity: null, activityObservedAt: null, quota: { exhausted: true, resetsAt: "2026-10-08 17:00" }, wake: false,
  });
  assert.deepEqual(chat(result, "builder-shop").relay, {
    registered: false, client: null, activity: null, activityObservedAt: null, quota: null, wake: false,
  });

  const late = await view({ now: "2026-10-08T12:30:00.000Z" });
  assert.equal(chat(late, "executor-myapp").status, "idle");
  assert.equal(chat(late, "executor-myapp").relay.activity, null);
  assert.equal(chat(late, "executor-myapp").relay.activityObservedAt, "2026-10-08T12:00:00.000Z");
  assert.equal(chat(late, "reader-myapp").status, "idle");

  const expired = await view({ now: "2026-10-08T16:30:00.000Z" });
  assert.equal(chat(expired, "executor-myapp").relay.wake, false);

  const mind = await copyOfFixture(t);
  const id = "c9d8e7f6-0000-4111-8222-333344445555";
  await write(path.join(mind, "user", "relay", "sessions", `${id}.json`), `${JSON.stringify({
    kind: "registration", registrationId: id, instanceId: "again", unit: "executor-myapp", scopeId: "project:myapp",
    nativeSessionId: "native-executor-myapp", client: "host", machine: "LAPTOP", registeredAt: "2026-10-08T12:02:00.000Z",
    activity: "idle", activityObservedAt: "2026-10-08T12:02:00.000Z", quota: null, quotaObservedAt: null,
  })}\n`);
  const newest = await view({ mindPath: mind });
  assert.equal(chat(newest, "executor-myapp").relay.activity, "idle");
  assert.equal(chat(newest, "executor-myapp").status, "idle");
});

test("a quota counts as exhausted when it says so or has nothing remaining", async (t) => {
  const mind = await copyOfFixture(t);
  const id = "d0e1f2a3-0000-4111-8222-333344445555";
  const registration = (unit, quota) => `${JSON.stringify({
    kind: "registration", registrationId: id, instanceId: unit, unit, scopeId: "project:shop", nativeSessionId: unit, client: "host",
    machine: "LAPTOP", registeredAt: "2026-10-08T12:04:00.000Z", activity: null, activityObservedAt: null, quota, quotaObservedAt: "2026-10-08T12:04:00.000Z",
  })}\n`;
  await write(path.join(mind, "user", "relay", "sessions", `${id}.json`), registration("builder-shop", { remaining: 0 }));
  assert.equal(chat(await view({ mindPath: mind }), "builder-shop").status, "quota");
  await write(path.join(mind, "user", "relay", "sessions", `${id}.json`), registration("builder-shop", { remaining: 40 }));
  assert.equal(chat(await view({ mindPath: mind }), "builder-shop").status, "idle");
});

test("squads group a lead with its members and the rest by project", async () => {
  const result = await view();
  assert.deepEqual(result.squads, [
    { lead: null, scope: "root", members: ["manager"], rollup: { working: 0, idle: 0, waiting: 1, out: 0, attention: 0 } },
    { lead: "overlord-web", scope: "environment", environment: "web", members: ["builder-shop"], rollup: { working: 0, idle: 1, waiting: 0, out: 1, attention: 0 } },
    { lead: "overlord-myapp", scope: "project", project: "myapp", members: ["archiver-myapp", "executor-myapp", "reader-myapp"], rollup: { working: 1, idle: 0, waiting: 1, out: 1, attention: 1 } },
    { lead: null, scope: "project", project: "mygame", members: ["executor-mygame"], rollup: { working: 0, idle: 1, waiting: 0, out: 0, attention: 0 } },
    { lead: null, scope: "project", project: "shop", members: ["executor-shop", "helper-shop"], rollup: { working: 0, idle: 0, waiting: 1, out: 0, attention: 1 } },
  ]);
  assert.deepEqual(chat(result, "executor-myapp"), {
    unit: "executor-myapp", scope: "project", project: "myapp", state: "in", status: "working",
    lead: "overlord-myapp", job: "builder", model: "mid", machine: "LAPTOP", date: "2026-10-08 10:10", branch: "feat/login",
    context: "Building the sitemap for task 006.", relay: chat(result, "executor-myapp").relay, path: "user/projects/myapp/state/executor-myapp.md",
  });
  assert.equal(chat(result, "manager").lead, null);
  assert.equal(chat(result, "manager").job, null);
});

test("what waits on the person: questions, a message that asks for a reply, and reviews a lead approved", async () => {
  const result = await view();
  assert.deepEqual(result.waiting.map((item) => [item.kind, item.title, item.unit]), [
    ["message", "Shop prices: one plan or two?", "executor-shop"],
    ["question", "pick the launch date for myapp", "manager"],
    ["question", "confirm the shop prices (in the shop chat)", "manager"],
    ["question", "approve the sitemap wording", "manager"],
    ["review", "checkout copy", "executor-shop"],
    ["review", "Reset mail wording", "overlord-myapp"],
  ]);
  const approved = result.waiting.find((item) => item.task === "004");
  assert.deepEqual(approved, {
    kind: "review", title: "Reset mail wording", project: "myapp", unit: "overlord-myapp", since: "2026-10-08 10:20",
    path: "user/projects/myapp/tasks/004-reset-mail.md", task: "004", approvedBy: "overlord-myapp",
  });
  const unled = result.waiting.find((item) => item.task === "002");
  assert.equal(unled.approvedBy, null);
  assert.equal(unled.unit, "executor-shop", "a task of an executor with no lead is reviewed as before");
  assert.equal(unled.since, "2026-10-08 10:40");
  assert.equal(result.waiting.some((item) => item.task === "005"), false, "an unapproved review of a member with a lead does not wait");
  assert.equal(result.waiting.some((item) => item.task === "003"), false, "a review an agent asked for does not wait");
  assert.deepEqual(result.waiting.find((item) => item.kind === "question"), {
    kind: "question", title: "pick the launch date for myapp", project: null, unit: "manager", since: "2026-10-08 09:30",
    path: "user/state/manager.md", task: null, approvedBy: null,
  });
  const message = result.waiting.find((item) => item.kind === "message");
  assert.equal(message.path, "user/inbox/user/20261008-200000-LAPTOP-5b1c9a7e-3d2f-4c8a-9e61-0a7d4b2c8f10.md");
  assert.equal(result.inbox.some((item) => item.to === "user" && item.replyRequested === false), true, "a message without a reply request is unread but not waiting");
  assert.equal(result.tasks.find((task) => task.id === "004").approvedBy, "overlord-myapp");
  assert.equal(result.tasks.find((task) => task.id === "005").approvedBy, null);
});

test("an approval line counts only from the lead of the executor", async (t) => {
  const mind = await copyOfFixture(t);
  const file = path.join(mind, "user", "projects", "myapp", "tasks", "004-reset-mail.md");
  const original = await fs.readFile(file, "utf8");
  const waits = async () => (await view({ mindPath: mind })).waiting.some((item) => item.task === "004");

  await fs.writeFile(file, original.replace("Approved for review by overlord-myapp", "Approved for review by overlord-other"));
  assert.equal(await waits(), false);
  assert.equal((await view({ mindPath: mind })).tasks.find((task) => task.id === "004").approvedBy, null);

  await fs.writeFile(file, original.replace(/Approved for review by .*/, ""));
  assert.equal(await waits(), false);

  await fs.writeFile(file, original.replace("from: user", "from: User (through the manager)"));
  assert.equal(await waits(), true, "a sender that opens with the user's name is the user");

  await fs.writeFile(file, original.replace("from: user", "from: overlord-web"));
  assert.equal(await waits(), false, "a review an agent asked for is the agent's to accept");
});

test("a person header identifies a review requester", async (t) => {
  const mind = await copyOfFixture(t);
  const file = path.join(mind, "user", "projects", "myapp", "tasks", "004-reset-mail.md");
  const original = await fs.readFile(file, "utf8");
  for (const [sender, expected] of [["Alex", true], ["aLeX (through the manager)", true], ["Alexander", false]]) {
    await fs.writeFile(file, original.replace("from: user", `from: ${sender}`));
    assert.equal((await view({ mindPath: mind })).waiting.some((item) => item.task === "004"), expected, sender);
  }
});

test("person names from every machine are comma-separated and escaped", async (t) => {
  const mind = await copyOfFixture(t);
  const machine = path.join(mind, "user", "machines", "DESKTOP.md");
  await fs.writeFile(machine, (await fs.readFile(machine, "utf8")).replace("language: en", "language: en\nperson: Alias.One, Alias+, ,"));
  const task = path.join(mind, "user", "projects", "myapp", "tasks", "004-reset-mail.md");
  const original = await fs.readFile(task, "utf8");
  for (const [sender, expected] of [["Alias.One", true], ["Alias+ (through the manager)", true], ["AliasXOne", false], ["Alias", false], ["Alex", true], ["user", true]]) {
    await fs.writeFile(task, original.replace("from: user", `from: ${sender}`));
    assert.equal((await view({ mindPath: mind })).waiting.some((item) => item.task === "004"), expected, sender);
  }
  await write(path.join(mind, "user", "state", "manager.md"), "unit: manager\nstate: in\n\nWaiting on Alias.One: first choice.\nWaiting on Alias+: second choice.\nWaiting on AliasXOne: not a name.\nWaiting on Alias: not a name.\n");
  assert.deepEqual((await view({ mindPath: mind })).waiting.filter((item) => item.kind === "question").map((item) => item.title), ["first choice", "second choice"]);
});

test("an environment coordinator splits Waiting on a person into questions", async (t) => {
  const mind = await copyOfFixture(t);
  const file = path.join(mind, "user", "envs", "web", "state", "overlord-web.md");
  await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("state: out", "state: in")
    + "\nWaiting on Alex: pick the shop launch date; approve the shop wording.; none.\n");
  const result = await view({ mindPath: mind });
  const questions = result.waiting.filter((item) => item.unit === "overlord-web");
  assert.deepEqual(questions, ["pick the shop launch date", "approve the shop wording"].map((title) => ({
    kind: "question", title, project: null, unit: "overlord-web", since: "2026-10-07 18:00",
    path: "user/envs/web/state/overlord-web.md", task: null, approvedBy: null,
  })));
  assert.equal(chat(result, "overlord-web").status, "waiting");
  const shop = await view({ mindPath: mind, project: "shop" });
  assert.deepEqual(shop.waiting.filter((item) => item.kind === "question"), questions);
});

test("a mind without a person header matches only user", async (t) => {
  const mind = await copyOfFixture(t);
  const machine = path.join(mind, "user", "machines", "LAPTOP.md");
  await fs.writeFile(machine, (await fs.readFile(machine, "utf8")).replace(/^person:.*\r?\n/m, ""));
  assert.deepEqual((await view({ mindPath: mind })).waiting, (await view()).waiting);
  const task = path.join(mind, "user", "projects", "myapp", "tasks", "004-reset-mail.md");
  await fs.writeFile(task, (await fs.readFile(task, "utf8")).replace("from: user", "from: Alex"));
  await write(path.join(mind, "user", "state", "manager.md"), "unit: manager\nstate: in\n\nWaiting on Alex: not matched.\nWaiting on user: still matched.\n");
  const result = await view({ mindPath: mind });
  assert.equal(result.waiting.some((item) => item.task === "004"), false);
  assert.deepEqual(result.waiting.filter((item) => item.kind === "question").map((item) => item.title), ["still matched"]);
});

test("a Waiting line with nothing in it adds no question", async (t) => {
  const mind = await copyOfFixture(t);
  await write(path.join(mind, "user", "state", "manager.md"), "unit: manager\nstate: in\ndate: 2026-10-08 09:30\n\nWaiting on the user: nothing.\n");
  const result = await view({ mindPath: mind });
  assert.equal(result.waiting.some((item) => item.kind === "question"), false);
  assert.equal(chat(result, "manager").status, "idle");
});

test("the product document counts requirements per stage, met by done tasks only", async (t) => {
  const result = await view();
  assert.deepEqual(result.products, [{
    project: "myapp",
    stage: "beta",
    updated: "2026-10-08",
    requirements: { alpha: { met: 1, total: 2 }, beta: { met: 1, total: 2 }, release: { met: 0, total: 1 } },
    openQuestions: 1,
    annexes: [{ name: "architecture", path: "annexes/architecture.md" }],
    path: "user/projects/myapp/product.md",
  }]);

  const mind = await copyOfFixture(t);
  const tasks = path.join(mind, "user", "projects", "myapp", "tasks");
  const open = path.join(tasks, "003-password-reset.md");
  await fs.writeFile(open, (await fs.readFile(open, "utf8")).replace("status: open", "status: done"));
  const closed = path.join(tasks, "002-draft-save.md");
  await fs.writeFile(closed, (await fs.readFile(closed, "utf8")).replace("status: closed", "status: done"));
  const product = path.join(mind, "user", "projects", "myapp", "product.md");
  await fs.writeFile(product, (await fs.readFile(product, "utf8"))
    .replace("- APP-R-01: every post", "- APP-R-01 Scripts: every post")
    .replace(/(## Open questions\r?\n)- .*/, "$1- none")
    .replace(/- architecture: .*/, "none"));
  const [updated] = (await view({ mindPath: mind })).products;
  assert.deepEqual(updated.requirements, { alpha: { met: 2, total: 2 }, beta: { met: 2, total: 2 }, release: { met: 0, total: 1 } });
  assert.equal(updated.openQuestions, 0);
  assert.deepEqual(updated.annexes, []);
});

test("a stage is read from the first clause of the header, whatever else the sentence says", async (t) => {
  const mind = await copyOfFixture(t);
  const product = path.join(mind, "user", "projects", "myapp", "product.md");
  const original = await fs.readFile(product, "utf8");
  for (const [stage, expected] of [["Alpha (the audit is done); Beta in preparation", "alpha"], ["v1.0 in build, part of the beta", null], ["release", "release"]]) {
    await fs.writeFile(product, original.replace("stage: beta in build", `stage: ${stage}`));
    assert.equal((await view({ mindPath: mind })).products[0].stage, expected, stage);
  }
});

test("the inbox lists every file still in an inbox, and a message without a sender is one issue", async (t) => {
  const result = await view();
  assert.deepEqual(result.inbox.map((item) => [item.unit, item.from, item.to, item.subject, item.priority, item.replyRequested]), [
    ["executor-myapp", "overlord-myapp", "executor-myapp", "task 004 is approved", "normal", false],
    ["manager", "executor-shop", "manager", "Shop prices need a decision", "normal", false],
    ["user", "manager", "user", "Weekly summary", "normal", false],
    ["user", "executor-shop", "user", "Shop prices: one plan or two?", "urgent", true],
  ]);
  assert.equal(result.inbox[1].date, "2026-10-08T12:30:00.000Z", "the timestamp of a Relay message is kept as written");
  assert.equal(result.inbox[0].date, "2026-10-08 10:30", "an older message keeps its date header");

  const mind = await copyOfFixture(t);
  await write(path.join(mind, "user", "inbox", "manager", "20261008-0100-stray.md"), "just a note\n");
  const next = await view({ mindPath: mind });
  assert.deepEqual(next.issues.filter((issue) => issue.path.includes("stray")), [
    { path: "user/inbox/manager/20261008-0100-stray.md", reason: "message has no from header" },
  ]);
  assert.equal(next.counts.unread, 4);
});

test("a project keeps its own scope plus the units that lead it", async (t) => {
  const myapp = await view({ project: "myapp" });
  assert.equal(myapp.mind.project, "myapp");
  assert.deepEqual(myapp.chats.map((item) => item.unit), ["archiver-myapp", "executor-myapp", "overlord-myapp", "reader-myapp"]);
  assert.deepEqual(myapp.tasks.map((task) => task.project), ["myapp", "myapp", "myapp", "myapp", "myapp"]);
  assert.deepEqual(myapp.products.map((product) => product.project), ["myapp"]);
  assert.deepEqual(myapp.inbox.map((item) => item.unit), ["executor-myapp"]);
  assert.deepEqual(myapp.waiting.map((item) => item.task), ["004"]);
  assert.deepEqual(myapp.issues, []);
  assert.deepEqual(myapp.counts, { chats: 4, waiting: 1, open: 1, review: 2, done: 2, closed: 1, unread: 1, issues: 0 });

  const shop = await view({ project: "SHOP" });
  assert.equal(shop.mind.project, "shop");
  assert.deepEqual(shop.chats.map((item) => item.unit), ["overlord-web", "builder-shop", "executor-shop", "helper-shop"]);
  assert.equal(shop.issues.length, 8, "the shop holds the seven malformed files and the state that is neither in nor out");
  assert.deepEqual(shop.squads.map((squad) => squad.lead), ["overlord-web", null]);
  assert.deepEqual(shop.waiting.map((item) => item.task), ["002"]);

  const mind = await copyOfFixture(t);
  const state = path.join(mind, "user", "projects", "mygame", "state", "executor-mygame.md");
  await fs.writeFile(state, (await fs.readFile(state, "utf8")).replace("tree: clean", "tree: clean\nlead: manager"));
  const mygame = await view({ mindPath: mind, project: "mygame" });
  assert.deepEqual(mygame.chats.map((item) => item.unit), ["manager", "executor-mygame"], "a root unit that leads the project is kept");
  assert.deepEqual(mygame.squads.map((squad) => [squad.lead, squad.members]), [["manager", ["executor-mygame"]]]);
  assert.deepEqual(mygame.waiting.map((item) => item.kind), ["question", "question", "question"]);

  const missing = await view({ project: "nothing" });
  assert.deepEqual(missing.issues, [{ path: "user/projects/nothing", reason: "project not found" }]);
  assert.equal(missing.chats.length + missing.tasks.length + missing.inbox.length, 0);
});

test("an oversize file is one issue, and a state that cannot be read is an unknown chat", async (t) => {
  const mind = await copyOfFixture(t);
  await write(path.join(mind, "user", "projects", "myapp", "state", "big-myapp.md"), `unit: big-myapp\nstate: in\n\n${"x".repeat(129 * 1024)}\n`);
  await write(path.join(mind, "user", "projects", "myapp", "tasks", "007-big.md"), `id: 007\nstatus: open\n\n${"x".repeat(129 * 1024)}\n`);
  const result = await view({ mindPath: mind });
  assert.equal(chat(result, "big-myapp").status, "unknown");
  assert.equal(chat(result, "big-myapp").context, null);
  assert.deepEqual(result.issues.filter((issue) => issue.path.includes("myapp")), [
    { path: "user/projects/myapp/state/big-myapp.md", reason: "is larger than 128 KB" },
    { path: "user/projects/myapp/tasks/007-big.md", reason: "is larger than 128 KB" },
  ]);
  assert.equal(result.chats.length, 11);
  assert.equal(result.tasks.length, 9);
});

test("a folder over 2000 entries is read up to 2000, with one issue", async (t) => {
  const mind = await copyOfFixture(t);
  const tasks = path.join(mind, "user", "projects", "bulk", "tasks");
  await fs.mkdir(tasks, { recursive: true });
  for (let start = 0; start < 2005; start += 250) {
    await Promise.all(Array.from({ length: Math.min(250, 2005 - start) }, (_, offset) => {
      const id = String(start + offset + 1).padStart(4, "0");
      return fs.writeFile(path.join(tasks, `${id}-bulk.md`), `id: ${id}\nstatus: open\n\nx\n`);
    }));
  }
  const result = await view({ mindPath: mind });
  assert.equal(result.tasks.filter((task) => task.project === "bulk").length, 2000);
  assert.deepEqual(result.issues.filter((issue) => issue.path.includes("bulk")), [
    { path: "user/projects/bulk/tasks", reason: "holds 2005 entries, only the first 2000 were read" },
  ]);
});

test("a symbolic link or junction is never followed", async (t) => {
  const mind = await copyOfFixture(t);
  const outside = await temporaryDirectory(t, "view-outside");
  await write(path.join(outside, "state", "leak.md"), "unit: leak\nstate: in\n\nOutside the mind.\n");
  await write(path.join(outside, "tasks", "001-leak.md"), "id: 001\nstatus: open\n\nOutside the mind.\n");
  await fs.mkdir(path.join(mind, "user", "projects", "viajunction"), { recursive: true });
  try {
    await fs.symlink(outside, path.join(mind, "user", "projects", "linked"), "junction");
    await fs.symlink(path.join(outside, "state"), path.join(mind, "user", "projects", "viajunction", "state"), "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return t.skip("links cannot be created here");
    throw error;
  }
  // A file link needs a privilege on Windows, so it is tried apart from the junctions.
  await fs.symlink(path.join(outside, "state", "leak.md"), path.join(mind, "user", "projects", "myapp", "state", "leak-link.md"), "file").catch(() => {});
  const result = await view({ mindPath: mind });
  assert.equal(result.chats.some((item) => item.unit === "leak"), false);
  assert.equal(result.tasks.some((task) => task.path.includes("linked") || task.title === "leak"), false);
  assert.deepEqual(result.issues.filter((issue) => issue.path.includes("viajunction")), [
    { path: "user/projects/viajunction/state", reason: "is a link, not followed" },
  ]);
  assert.equal(result.chats.length, 10);
});

test("a malformed Relay record is one issue and the other registrations still count", async (t) => {
  const mind = await copyOfFixture(t);
  const sessions = path.join(mind, "user", "relay", "sessions");
  await write(path.join(sessions, "e1f2a3b4-0000-4111-8222-333344445555.json"), "{ not json");
  await write(path.join(sessions, "e2f3a4b5-0000-4111-8222-333344445555.json"), JSON.stringify({ kind: "something else" }));
  const result = await view({ mindPath: mind });
  assert.deepEqual(result.issues.filter((issue) => issue.path.includes("relay")).map((issue) => issue.reason), [
    "is not valid JSON",
    "is not a Relay record of the expected kind",
  ]);
  assert.equal(chat(result, "executor-myapp").status, "working");
});

test("a mind that cannot be read is an error, not an empty view", async (t) => {
  const empty = await temporaryDirectory(t, "view-empty");
  await assert.rejects(readView({ mindPath: empty }), /does not exist/);
  await assert.rejects(readView({ mindPath: path.join(empty, "absent") }), /does not exist/);
  await assert.rejects(readView({ mindPath: FIXTURE, now: "not a date" }), /invalid/);
});

test("the view command prints the contract as JSON and writes nothing", async () => {
  const before = await snapshot(FIXTURE);
  const output = sink();
  const errors = sink();
  const code = await runCli(["view", "--json", "--mind-path", FIXTURE, "--hostname", "LAPTOP"], { stdout: output.stream, stderr: errors.stream });
  assert.equal(code, 0);
  assert.equal(errors.read(), "");
  const result = JSON.parse(output.read());
  assert.equal(result.contract, "hivem1nd-view-v1");
  assert.equal(result.mind.machine, "LAPTOP");
  assert.deepEqual(result.counts, { chats: 10, waiting: 6, open: 3, review: 4, done: 2, closed: 1, unread: 4, issues: 8 });
  assert.equal(result.issues.length, 8, "issues do not change the exit code");
  assert.deepEqual(await snapshot(FIXTURE), before);

  const scoped = sink();
  assert.equal(await runCli(["view", "--json", "--project", "myapp", "--mind-path", FIXTURE], { stdout: scoped.stream, stderr: sink().stream }), 0);
  assert.equal(JSON.parse(scoped.read()).mind.project, "myapp");
  assert.deepEqual(await snapshot(FIXTURE), before);
});

test("the view command prints a short summary without --json", async () => {
  const output = sink();
  const code = await runCli(["view", "--mind-path", FIXTURE, "--hostname", "LAPTOP"], { stdout: output.stream, stderr: sink().stream });
  assert.equal(code, 0);
  const lines = output.read().trimEnd().split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "Waiting on the person: 6 (4 to answer, 2 to review)");
  assert.match(lines[1], /^Chats: 10 \(waiting \d+, working \d+, idle \d+, out \d+, quota \d+, unknown \d+\)$/);
  assert.equal(lines[2], "Tasks: open 3, review 4, done 2, closed 1");
  assert.equal(lines[3], "Unread: 4");
  assert.equal(lines[4], "Issues: 8; --json lists them");
});

test("the view command fails only when the mind itself cannot be read, and takes only its own flags", async (t) => {
  const empty = await temporaryDirectory(t, "view-cli");
  const errors = sink();
  const output = sink();
  assert.equal(await runCli(["view", "--mind-path", empty], { stdout: output.stream, stderr: errors.stream }), 1);
  assert.match(errors.read(), /^Error: /);
  assert.equal(output.read(), "");

  assert.throws(() => parseArgs(["view", "--project"]), /requires a value/);
  assert.throws(() => parseArgs(["swarm", "--project", "myapp"]), /not valid for swarm/);
  assert.throws(() => parseArgs(["view", "--state", "main"]), /not valid for view/);
  assert.deepEqual(parseArgs(["view", "--json", "--project", "myapp"]).options, { json: true, project: "myapp" });
  assert.match(helpText(), /hivem1nd view \[--project <name>\]/);
});
