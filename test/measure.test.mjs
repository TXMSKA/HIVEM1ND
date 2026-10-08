import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { check } from "../engine/lifecycle.mjs";
import { BRIEF_MAX_BYTES, PREFERENCES_MAX_BYTES, PRD_MAX_BYTES, formatBytes, measureMind, mindThresholds } from "../engine/measure.mjs";
import { runCli } from "../cli/index.mjs";

const execFileAsync = promisify(execFile);

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hivem1nd-measure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  return directory;
}

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function makeMind(root) {
  const mindPath = path.join(root, "mind");
  await write(path.join(mindPath, "user", "VERSION"), "0.1.0\n");
  await write(path.join(mindPath, "user", "routes.md"), "## Environments\n\n## Projects\n\n## Minds\n");
  await write(
    path.join(mindPath, "user", "machines", "TEST.md"),
    `machine: TEST\nmind: ${mindPath}\nupdate-check: off\nlast-check: \nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`,
  );
  await write(path.join(root, "kit", "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version: "0.1.0" })}\n`);
  return mindPath;
}

async function snapshot(directory) {
  const files = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    files[filePath] = await fs.readFile(filePath, "utf8");
  }
  return files;
}

function state(unit, values) {
  return `unit: ${unit}\nstate: ${values.state}\nmachine: ${values.machine}\ndate: ${values.date}\n\nContext.\n`;
}

function brief(project, ...facts) {
  return `project: ${project}\nenv: web\n\n## Facts\n${facts.map((fact) => `- ${fact}\n`).join("")}`;
}

function prd(project, updated) {
  return `project: ${project}\nfamily: shop\nstage: beta\n${updated ? `updated: ${updated}\n` : ""}voice: docs/voice.md\nboard: none\n\n## Problem and audience\nupdated: 2099-01-01 in the body is not the header.\n`;
}

async function projectFiles(mindPath, name, files) {
  for (const [file, content] of Object.entries(files)) await write(path.join(mindPath, "user", "projects", name, file), content);
}

test("a small mind crosses no threshold", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  await write(path.join(mindPath, "user", "preferences.md"), "- 2030-01-01: short answers. Why: noise.\n");
  await write(path.join(mindPath, "user", "projects", "app", "brief.md"), "project: app\n\n## Facts\n");
  await write(path.join(mindPath, "user", "projects", "app", "state", "executor-app.md"), state("executor-app", { state: "in", machine: "TEST", date: "2030-01-01 10:00" }));

  const mind = await measureMind({ mindPath, hostname: "TEST", now: new Date("2030-01-02T10:00:00") });
  assert.equal(mind.crossed, false);
  assert.equal(mind.count, 0);
  assert.equal(mind.largest, null);
  assert.equal(mind.sizes.briefs.length, 1);
  assert.equal(mind.sizes.states.in, 1);
  assert.deepEqual(mind.thresholds, mindThresholds());
});

test("preferences, briefs and machine files over their threshold are listed, largest first", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  await write(path.join(mindPath, "user", "preferences.md"), "x".repeat(PREFERENCES_MAX_BYTES + 1));
  await write(path.join(mindPath, "user", "projects", "app", "brief.md"), "y".repeat(BRIEF_MAX_BYTES + 500));
  await write(path.join(mindPath, "user", "projects", "web", "brief.md"), "y".repeat(BRIEF_MAX_BYTES));
  await write(path.join(mindPath, "user", "machines", "OTHER.md"), "z".repeat(40_000));
  await write(path.join(mindPath, "user", "machines", "OTHER.report.md"), "z".repeat(40_000));

  const mind = await measureMind({ mindPath, hostname: "TEST" });
  assert.deepEqual(mind.items.map((item) => [item.kind, item.path]), [
    ["machine", "user/machines/OTHER.md"],
    ["preferences", "user/preferences.md"],
    ["brief", "user/projects/app/brief.md"],
  ]);
  assert.equal(mind.largest.path, "user/machines/OTHER.md");
});

test("a state left in is stale when it is old, or when its machine relayed out after it", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  const states = path.join(mindPath, "user", "projects", "app", "state");
  await write(path.join(states, "old.md"), state("old", { state: "in", machine: "TEST", date: "2030-01-01 10:00" }));
  await write(path.join(states, "fresh.md"), state("fresh", { state: "in", machine: "TEST", date: "2030-01-09 09:00" }));
  await write(path.join(states, "away.md"), state("away", { state: "in", machine: "LAPTOP", date: "2030-01-09 08:00" }));
  await write(path.join(states, "away-out.md"), state("away-out", { state: "out", machine: "LAPTOP", date: "2030-01-09 11:45" }));
  await write(path.join(states, "running.md"), state("running", { state: "in", machine: "LAPTOP", date: "2030-01-09 12:00" }));
  await write(path.join(states, "dateless.md"), "unit: dateless\nstate: in\nmachine: TEST\n\nContext.\n");

  const mind = await measureMind({ mindPath, hostname: "TEST", now: new Date("2030-01-09T13:00:00") });
  assert.deepEqual(
    mind.items.filter((item) => item.kind === "state").map((item) => [path.posix.basename(item.path), item.reason]).sort(),
    [["away.md", "machine-out"], ["old.md", "older"]],
  );
  assert.equal(mind.sizes.states.in, 5);
});

test("files that are not records are summed by folder, and links and node_modules are skipped", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  const evidence = path.join(mindPath, "user", "projects", "app", "evidence");
  await write(path.join(evidence, "one.png"), "a".repeat(3000));
  await write(path.join(evidence, "deep", "two.json"), "b".repeat(2000));
  await write(path.join(evidence, "notes.md"), "c".repeat(9000));
  await write(path.join(mindPath, "user", "projects", "app", "node_modules", "pkg", "index.js"), "d".repeat(9000));
  const outside = path.join(root, "outside");
  await write(path.join(outside, "big.bin"), "e".repeat(9000));
  await fs.symlink(outside, path.join(mindPath, "user", "linked"), process.platform === "win32" ? "junction" : "dir");

  const mind = await measureMind({ mindPath, hostname: "TEST", thresholds: { filesBytes: 4000 } });
  // user/VERSION is the only other file that is not a Markdown record.
  assert.equal(mind.sizes.files.bytes, 5006);
  assert.equal(mind.sizes.files.truncated, false);
  assert.deepEqual(mind.items.map((item) => [item.kind, item.path, item.bytes]), [["files", "user/projects/app/evidence", 5000]]);
});

test("the Relay history is counted and flagged past its threshold", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  for (let index = 0; index < 4; index += 1) await write(path.join(mindPath, "user", "relay", "archive", "unit", `${index}.md`), "message\n");
  await write(path.join(mindPath, "user", "relay", "events", "a.jsonl"), "{}\n");

  const mind = await measureMind({ mindPath, hostname: "TEST", thresholds: { relayHistoryFiles: 4 } });
  assert.equal(mind.sizes.relay.files, 5);
  assert.deepEqual(mind.items.map((item) => item.kind), ["relay"]);
});

test("the check carries the measurements, prints one line and writes nothing", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  const cliPath = path.resolve(import.meta.dirname, "..", "cli", "index.mjs");
  const run = async (...extra) => (await execFileAsync(
    process.execPath,
    [cliPath, "check", "--kit-path", path.join(root, "kit"), "--mind-path", mindPath, "--home-dir", path.join(root, "home"), "--hostname", "TEST", ...extra],
    { cwd: root, encoding: "utf8" },
  )).stdout;

  assert.equal(await run(), "");
  await write(path.join(mindPath, "user", "projects", "app", "brief.md"), "y".repeat(BRIEF_MAX_BYTES + 1));
  await write(path.join(mindPath, "user", "projects", "web", "brief.md"), "y".repeat(BRIEF_MAX_BYTES + 2000));

  const before = await snapshot(root);
  assert.equal(await run(), "Mind: 2 items to clean (user/projects/web/brief.md, 17 KB); /cleaner offers the cleanup.\n");
  const json = JSON.parse(await run("--json"));
  assert.equal(json.mind.count, 2);
  assert.equal(json.mind.items[0].path, "user/projects/web/brief.md");
  assert.deepEqual(await snapshot(root), before);

  const result = await check({ kitPath: path.join(root, "kit"), mindPath, homeDir: path.join(root, "home"), hostname: "TEST", cwd: root });
  assert.equal(result.mind.crossed, true);
});

test("a user folder with no records measures as empty instead of failing", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "mind", "user"), { recursive: true });
  const mind = await measureMind({ mindPath: path.join(root, "mind"), hostname: "TEST" });
  assert.equal(mind.crossed, false);
  assert.deepEqual(mind.sizes.briefs, []);
  assert.equal((await measureMind({ mindPath: path.join(root, "missing"), hostname: "TEST" })).count, 0);
});

test("the human line names the count and the largest item, and stays silent below it", async () => {
  const lines = [];
  const stdout = { write(text) { lines.push(text); } };
  const mind = (count, largest) => ({ action: "status", machine: "TEST", machineRecord: true, missing: [], update: null, project: null, repository: null, executive: { unread: 0, open: 0 }, warnings: [], mind: { count, largest } });
  await runCli(["check", "--mind-path", "."], { stdout, stderr: stdout, lifecycle: { async check() { return mind(1, { path: "user/projects/app/brief.md", bytes: 16_000 }); } } });
  await runCli(["check", "--mind-path", "."], { stdout, stderr: stdout, lifecycle: { async check() { return mind(0, null); } } });
  assert.deepEqual(lines, ["Mind: 1 item to clean (user/projects/app/brief.md, 16 KB); /cleaner offers the cleanup.\n"]);
  assert.equal(formatBytes(5_362_389_374), "5.0 GB");
  assert.equal(formatBytes(800), "800 B");
});

test("a PRD older than the newest Fact with a prd pointer is reported, and nothing else is", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  // The newest Fact of "stale" has no pointer and is ignored; the newest pointer Fact is the 2030-01-02 one.
  await projectFiles(mindPath, "stale", {
    "brief.md": brief("stale", "2030-01-03: sessions stay in cookies.", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta).", "2029-12-30: the blog lives in MySQL (prd: Requirements/Alpha)."),
    "prd.md": prd("stale", "2030-01-01"),
  });
  // Updated on the day of the newest pointer Fact, with a technical Fact that is newer still.
  await projectFiles(mindPath, "level", {
    "brief.md": brief("level", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta).", "2030-02-01: the cache lives in memory."),
    "prd.md": prd("level", "2030-01-02"),
  });
  await projectFiles(mindPath, "ahead", {
    "brief.md": brief("ahead", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta)."),
    "prd.md": prd("ahead", "2030-03-01"),
  });
  // No pointer anywhere in the Facts: a dated bullet under another heading does not count.
  await projectFiles(mindPath, "technical", {
    "brief.md": `${brief("technical", "2030-05-01: the cache lives in memory.")}\n## Notes\n- 2030-06-01: seen in the admin (prd: Out of scope).\n`,
    "prd.md": prd("technical", "2020-01-01"),
  });
  await projectFiles(mindPath, "undated", {
    "brief.md": brief("undated", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta)."),
    "prd.md": prd("undated", ""),
  });
  await projectFiles(mindPath, "orphan", {
    "brief.md": brief("orphan", "2030-01-04: orders carry a paid mark (prd: Requirements/Beta).", "2030-01-06: the queue is retried (prd: Requirements/Alpha)."),
  });
  await projectFiles(mindPath, "plain", { "brief.md": brief("plain", "2030-01-04: the cache lives in memory.") });
  await projectFiles(mindPath, "no-brief", { "prd.md": prd("no-brief", "2020-01-01") });

  const mind = await measureMind({ mindPath, hostname: "TEST" });
  assert.deepEqual(mind.prd.stale.sort((left, right) => left.project.localeCompare(right.project)), [
    { project: "stale", path: "user/projects/stale/prd.md", updated: "2030-01-01", fact: "2030-01-02" },
    { project: "undated", path: "user/projects/undated/prd.md", updated: null, fact: "2030-01-02" },
  ]);
  assert.deepEqual(mind.prd.missing, [{ project: "orphan", path: "user/projects/orphan/prd.md", fact: "2030-01-06" }]);
  assert.equal(mind.crossed, false);
  assert.equal(mind.count, 0);
});

test("a prd.md that cannot be read as a file counts as missing and never fails the measurement", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  await projectFiles(mindPath, "app", { "brief.md": brief("app", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta).") });
  await fs.mkdir(path.join(mindPath, "user", "projects", "app", "prd.md"), { recursive: true });

  const mind = await measureMind({ mindPath, hostname: "TEST" });
  assert.deepEqual(mind.prd.missing.map((item) => item.project), ["app"]);
  assert.deepEqual(mind.sizes.prds, []);
});

test("a PRD over its size threshold is listed with the sizes, and one at it is not", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  assert.equal(mindThresholds().prdBytes, 20480);
  await write(path.join(mindPath, "user", "projects", "app", "prd.md"), "x".repeat(PRD_MAX_BYTES));
  await write(path.join(mindPath, "user", "projects", "web", "prd.md"), "y".repeat(PRD_MAX_BYTES + 1));

  const mind = await measureMind({ mindPath, hostname: "TEST" });
  assert.deepEqual(mind.items.map((item) => [item.kind, item.path, item.bytes]), [["prd", "user/projects/web/prd.md", PRD_MAX_BYTES + 1]]);
  assert.deepEqual(mind.sizes.prds.map((item) => [item.path, item.bytes]).sort(), [
    ["user/projects/app/prd.md", PRD_MAX_BYTES],
    ["user/projects/web/prd.md", PRD_MAX_BYTES + 1],
  ]);
  assert.equal(mind.thresholds.prdBytes, PRD_MAX_BYTES);
});

test("the check prints one line per PRD finding, carries the PRD sizes in the JSON and writes nothing", async (t) => {
  const root = await temporaryDirectory(t);
  const mindPath = await makeMind(root);
  const cliPath = path.resolve(import.meta.dirname, "..", "cli", "index.mjs");
  const run = async (...extra) => (await execFileAsync(
    process.execPath,
    [cliPath, "check", "--kit-path", path.join(root, "kit"), "--mind-path", mindPath, "--home-dir", path.join(root, "home"), "--hostname", "TEST", ...extra],
    { cwd: root, encoding: "utf8" },
  )).stdout;

  await projectFiles(mindPath, "level", {
    "brief.md": brief("level", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta).", "2030-02-01: the cache lives in memory."),
    "prd.md": prd("level", "2030-01-02"),
  });
  assert.equal(await run(), "");

  await projectFiles(mindPath, "stale", {
    "brief.md": brief("stale", "2030-01-02: a reset is sent by mail (prd: Requirements/Beta)."),
    "prd.md": prd("stale", "2030-01-01"),
  });
  await projectFiles(mindPath, "orphan", { "brief.md": brief("orphan", "2030-01-04: orders carry a paid mark (prd: Requirements/Beta).") });
  const before = await snapshot(root);
  assert.equal(
    await run(),
    "PRD of stale: updated 2030-01-01, older than the Fact of 2030-01-02 that points to it; /protocol product-requirements brings it up to date.\n"
    + "PRD of orphan: the Fact of 2030-01-04 points to a PRD and user/projects/orphan/prd.md does not exist; /protocol product-requirements writes it.\n",
  );
  assert.deepEqual(await snapshot(root), before);

  await write(path.join(mindPath, "user", "projects", "big", "prd.md"), "z".repeat(PRD_MAX_BYTES + 2000));
  const lines = (await run()).split("\n");
  assert.equal(lines[0], "Mind: 1 item to clean (user/projects/big/prd.md, 22 KB); /cleaner offers the cleanup.");
  assert.equal(lines.length, 4);
  const json = JSON.parse(await run("--json"));
  assert.equal(json.mind.thresholds.prdBytes, 20480);
  assert.deepEqual(json.mind.sizes.prds.map((item) => item.path).sort(), [
    "user/projects/big/prd.md",
    "user/projects/level/prd.md",
    "user/projects/stale/prd.md",
  ]);
  assert.deepEqual(json.mind.prd.stale.map((item) => [item.project, item.updated, item.fact]), [["stale", "2030-01-01", "2030-01-02"]]);
});

test("the example brief and PRD of the fixtures agree, so the check stays silent on them", async () => {
  const mindPath = path.resolve(import.meta.dirname, "..", "fixtures", "mind");
  const mind = await measureMind({ mindPath, hostname: "TEST" });
  assert.deepEqual(mind.prd, { stale: [], missing: [] });
  assert.deepEqual(mind.sizes.prds.map((item) => item.path), ["user/projects/myapp/prd.md"]);
});
