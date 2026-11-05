import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkForUpdates, evolve } from "../engine/lifecycle.mjs";
import { compareRecords, formatVersionRecord, migrationApplies, parseVersionRecord } from "../engine/version-line.mjs";

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "onem1nd-line-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  return directory;
}

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

const stub = (version, logName) => `import { appendFile } from 'node:fs/promises';
export const version = '${version}';
export const idempotent = true;
export async function migrate({ userPath, version: running }) { if (running) await appendFile(userPath + '/${logName}.log', running + '\\n'); return {}; }
`;

async function fixture(t, { record, kitName = "onem1nd", kitVersion = "1.0.0-beta.1", migrations = ["3.0.0", "3.0.0-onem1nd"] }) {
  const root = await temporaryDirectory(t);
  const mindPath = path.join(root, "mind");
  const kitPath = path.join(root, "kit");
  await write(path.join(mindPath, "user", "VERSION"), record);
  await write(path.join(mindPath, "user", "routes.md"), "## Environments\n\n## Projects\n\n## Minds\n");
  await write(path.join(mindPath, "user", "machines", "TEST.md"),
    `machine: TEST\nmind: ${mindPath}\nupdate-check: daily\nlast-check: 2029-01-01\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`);
  await write(path.join(kitPath, "package.json"), `${JSON.stringify({ name: kitName, version: kitVersion })}\n`);
  for (const name of migrations) await write(path.join(kitPath, "migrations", `${name}.mjs`), stub(name, "ran"));
  const options = {
    kitPath, mindPath, homeDir: path.join(root, "home"), hostname: "TEST", pull: false,
    now: new Date("2030-01-02T12:00:00Z"),
    installAgentAssets: async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] }),
  };
  const ran = async () => (await fs.readFile(path.join(mindPath, "user", "ran.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const version = () => fs.readFile(path.join(mindPath, "user", "VERSION"), "utf8");
  return { root, mindPath, kitPath, options, ran, version };
}

test("a bare record is the HIVEM1ND line and any ONEM1ND version is newer", () => {
  assert.deepEqual(parseVersionRecord("3.0.0\n"), { line: "hivem1nd", version: "3.0.0" });
  assert.deepEqual(parseVersionRecord("onem1nd 1.0.0-beta.1\n"), { line: "onem1nd", version: "1.0.0-beta.1" });
  assert.equal(formatVersionRecord("1.0.0-beta.1"), "onem1nd 1.0.0-beta.1\n");
  const numeric = (a, b) => a.localeCompare(b, "en", { numeric: true });
  assert.equal(compareRecords({ line: "onem1nd", version: "1.0.0-beta.1" }, { line: "hivem1nd", version: "3.0.0" }, numeric), 1);
  assert.equal(compareRecords({ line: "hivem1nd", version: "9.0.0" }, { line: "onem1nd", version: "1.0.0-beta.1" }, numeric), -1);
  assert.equal(compareRecords({ line: "onem1nd", version: "1.0.0-beta.2" }, { line: "onem1nd", version: "1.0.0-beta.1" }, numeric), 1);
});

test("migration selection keeps the two lines apart", () => {
  const compare = (a, b) => a.localeCompare(b, "en", { numeric: true });
  const legacy = (version) => ({ line: "hivem1nd", version });
  const next = (version) => ({ line: "onem1nd", version });
  assert.equal(migrationApplies("3.0.0-onem1nd", legacy("2.1.0"), next("1.0.0-beta.1"), compare), true);
  assert.equal(migrationApplies("3.0.0-onem1nd", legacy("3.0.0"), next("1.0.0-beta.1"), compare), true);
  assert.equal(migrationApplies("3.0.0", legacy("3.0.0"), next("1.0.0-beta.1"), compare), false);
  assert.equal(migrationApplies("1.1.0", legacy("2.1.0"), next("1.0.0-beta.1"), compare), false);
  assert.equal(migrationApplies("3.0.0-onem1nd", next("1.0.0-beta.1"), next("1.0.0-beta.2"), compare), false);
  assert.equal(migrationApplies("1.0.0-beta.2", next("1.0.0-beta.1"), next("1.0.0-beta.2"), compare), true);
  assert.equal(migrationApplies("1.0.0-beta.2", legacy("3.0.0"), next("1.0.0-beta.2"), compare), true);
});

for (const [from, expectedRan] of [["2.1.0", ["3.0.0-onem1nd", "3.0.0"]], ["3.0.0", ["3.0.0-onem1nd"]]]) {
  test(`a HIVEM1ND ${from} mind evolves to ONEM1ND 1.0.0-beta.1 and runs the rebrand migration once`, async (t) => {
    const f = await fixture(t, { record: `${from}\n` });
    const first = await evolve(f.options);
    assert.equal(first.completed, true);
    assert.equal(first.fromVersion, from);
    assert.equal(first.toVersion, "1.0.0-beta.1");
    assert.equal(first.changed, true);
    assert.deepEqual(await f.ran(), expectedRan);
    assert.equal(await f.version(), "onem1nd 1.0.0-beta.1\n");
    const second = await evolve(f.options);
    assert.equal(second.completed, true);
    assert.deepEqual(second.migrations, []);
    assert.deepEqual(await f.ran(), expectedRan);
  });
}

test("ONEM1ND moves from beta.1 to beta.2 with only its own migrations", async (t) => {
  const f = await fixture(t, {
    record: "onem1nd 1.0.0-beta.1\n", kitVersion: "1.0.0-beta.2", migrations: ["3.0.0-onem1nd", "1.0.0-beta.2"],
  });
  const result = await evolve(f.options);
  assert.equal(result.completed, true);
  assert.deepEqual(result.migrations, ["1.0.0-beta.2"]);
  assert.deepEqual(await f.ran(), ["1.0.0-beta.2"]);
  assert.equal(await f.version(), "onem1nd 1.0.0-beta.2\n");
});

test("a downgrade inside the ONEM1ND line is refused", async (t) => {
  const f = await fixture(t, { record: "onem1nd 1.0.0-beta.2\n" });
  await assert.rejects(evolve(f.options), { code: "VERSION_DOWNGRADE" });
  assert.equal(await f.version(), "onem1nd 1.0.0-beta.2\n");
});

test("a HIVEM1ND kit does not overwrite an ONEM1ND record", async (t) => {
  const f = await fixture(t, { record: "onem1nd 1.0.0-beta.1\n", kitName: "hivem1nd", kitVersion: "9.0.0" });
  await assert.rejects(evolve(f.options), { code: "VERSION_DOWNGRADE" });
});

test("the update check treats an ONEM1ND version as newer than any HIVEM1ND record", async (t) => {
  const f = await fixture(t, { record: "3.0.0\n" });
  const check = await checkForUpdates({ ...f.options, now: new Date("2030-01-02T12:00:00Z"), fetch: false, latestVersion: "1.0.0-beta.1" });
  assert.equal(check.currentVersion, "3.0.0");
  assert.equal(check.latestVersion, "1.0.0-beta.1");
  assert.equal(check.updateAvailable, true);
  const same = await fixture(t, { record: "onem1nd 1.0.0-beta.1\n" });
  const none = await checkForUpdates({ ...same.options, now: new Date("2030-01-02T12:00:00Z"), fetch: false, latestVersion: "1.0.0-beta.1" });
  assert.equal(none.updateAvailable, false);
  const later = await fixture(t, { record: "onem1nd 1.0.0-beta.1\n" });
  const newer = await checkForUpdates({ ...later.options, now: new Date("2030-01-02T12:00:00Z"), fetch: false, latestVersion: "1.0.0-beta.2" });
  assert.equal(newer.updateAvailable, true);
});

test("a mind written by an ONEM1ND machine is not downgraded by a machine still recording a HIVEM1ND version", async (t) => {
  const f = await fixture(t, { record: "onem1nd 1.0.0-beta.1\n", kitName: "onem1nd", kitVersion: "1.0.0-beta.1" });
  // The other machine syncs its bare record over this one; both readings stay ordered by line.
  const older = parseVersionRecord("2.1.0\n");
  const newer = parseVersionRecord(await f.version());
  assert.equal(compareRecords(newer, older, (a, b) => a.localeCompare(b, "en", { numeric: true })), 1);
  const result = await evolve(f.options);
  assert.equal(result.completed, true);
  assert.deepEqual(result.migrations, []);
});
