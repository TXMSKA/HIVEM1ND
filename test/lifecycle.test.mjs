import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { installAgentAssets } from "../engine/install.mjs";
import { checkForUpdates, evolve, pylon, swarm } from "../engine/lifecycle.mjs";

const execFileAsync = promisify(execFile);

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

async function git(cwd, args, env) {
  const result = await execFileAsync("git", args, { cwd, env, encoding: "utf8" });
  return result.stdout.trim();
}

async function makeMind(root, hostname = "TEST") {
  const mindPath = path.join(root, "mind");
  await write(path.join(mindPath, "user", "VERSION"), "0.1.0\n");
  await write(path.join(mindPath, "user", "routes.md"), "## Environments\n\n## Projects\n\n## Minds\n");
  await write(
    path.join(mindPath, "user", "machines", `${hostname}.md`),
    `machine: ${hostname}\nmind: ${mindPath}\nupdate-check: daily\nlast-check: 2029-01-01\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`,
  );
  return mindPath;
}

async function makeKit(root, version = "1.0.0") {
  const kitPath = path.join(root, "kit");
  await write(path.join(kitPath, "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version })}\n`);
  await fs.mkdir(path.join(kitPath, "migrations"), { recursive: true });
  return kitPath;
}

async function makeRepositoryPair(t) {
  const root = await temporaryDirectory(t, "git");
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const globalConfig = path.join(root, "empty-global-config");
  await write(globalConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };

  await fs.mkdir(bare);
  await fs.mkdir(seed);
  await git(bare, ["init", "--bare", "--initial-branch=main"], env);
  await git(seed, ["init", "--initial-branch=main"], env);
  await git(seed, ["config", "user.name", "Test User"], env);
  await git(seed, ["config", "user.email", "test@example.invalid"], env);
  await write(path.join(seed, "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version: "1.0.0" })}\n`);
  await write(path.join(seed, "app.txt"), "clean\n");
  await git(seed, ["add", "package.json", "app.txt"], env);
  await git(seed, ["commit", "-m", "Initial commit"], env);
  await git(seed, ["remote", "add", "origin", bare], env);
  await git(seed, ["push", "-u", "origin", "main"], env);
  await git(root, ["clone", bare, first], env);
  await git(root, ["clone", bare, second], env);
  for (const clone of [first, second]) {
    await git(clone, ["config", "user.name", "Test User"], env);
    await git(clone, ["config", "user.email", "test@example.invalid"], env);
  }
  return { root, bare, first, second, env };
}

test("evolve records successful migrations across an installation conflict", async (t) => {
  const root = await temporaryDirectory(t, "evolve-conflict");
  const mindPath = await makeMind(root);
  const kitPath = await makeKit(root);
  await write(
    path.join(kitPath, "migrations", "0.2.0.mjs"),
    "import { appendFile } from 'node:fs/promises'; export const version = '0.2.0'; export const idempotent = true; export async function migrate({ userPath }) { await appendFile(`${userPath}/private.txt`, '0.2.0\\n'); }\n",
  );
  await write(
    path.join(kitPath, "migrations", "1.0.0.mjs"),
    "import { appendFile } from 'node:fs/promises'; export const version = '1.0.0'; export const idempotent = true; export async function migrate({ userPath }) { await appendFile(`${userPath}/private.txt`, '1.0.0\\n'); }\n",
  );

  let installs = 0;
  const installAgentAssets = async ({ previewOnly }) => {
    if (previewOnly) return { agents: [], baseFiles: [], warnings: [], conflicts: [] };
    installs += 1;
    return installs === 1
      ? { agents: [], baseFiles: [], warnings: [], conflicts: [{ path: "changed-after-preview", choices: ["keep"] }] }
      : { agents: [], baseFiles: [], warnings: [], conflicts: [] };
  };
  const options = {
    kitPath,
    mindPath,
    homeDir: path.join(root, "home"),
    hostname: "TEST",
    pull: false,
    now: new Date("2030-01-02T12:00:00Z"),
    installAgentAssets,
  };

  const first = await evolve(options);
  assert.equal(first.completed, false);
  assert.equal(await fs.readFile(path.join(mindPath, "user", "VERSION"), "utf8"), "0.1.0\n");
  assert.deepEqual((await fs.readFile(path.join(mindPath, "user", "private.txt"), "utf8")).trim().split("\n"), ["0.2.0", "1.0.0"]);

  const second = await evolve(options);
  assert.equal(second.completed, true);
  assert.deepEqual(second.migrations, []);
  assert.equal(await fs.readFile(path.join(mindPath, "user", "private.txt"), "utf8"), "0.2.0\n1.0.0\n");
  assert.equal(await fs.readFile(path.join(mindPath, "user", "VERSION"), "utf8"), "1.0.0\n");
});

test("bundled migrations are idempotent and preserve existing private files", async (t) => {
  const root = await temporaryDirectory(t, "bundled-migrations");
  const userPath = path.join(root, "user");
  const versions = ["0.2.0", "0.3.0", "1.0.0"];
  for (const version of versions) {
    const migration = await import(`../migrations/${version}.mjs`);
    assert.equal(migration.idempotent, true);
    await migration.migrate({ userPath });
  }
  await write(path.join(userPath, "roles", "private.md"), "private role\n");
  await write(path.join(userPath, "knowledge", "private.md"), "private knowledge\n");
  for (const version of versions) {
    const migration = await import(`../migrations/${version}.mjs`);
    await migration.migrate({ userPath });
  }
  assert.equal(await fs.readFile(path.join(userPath, "roles", "private.md"), "utf8"), "private role\n");
  assert.equal(await fs.readFile(path.join(userPath, "knowledge", "private.md"), "utf8"), "private knowledge\n");
});

test("evolve resumes after a later migration fails without repeating completed work", async (t) => {
  const root = await temporaryDirectory(t, "evolve-resume");
  const mindPath = await makeMind(root);
  const kitPath = await makeKit(root);
  const firstMigration = path.join(kitPath, "migrations", "0.2.0.mjs");
  const secondMigration = path.join(kitPath, "migrations", "1.0.0.mjs");
  await write(
    firstMigration,
    "import { appendFile } from 'node:fs/promises'; export const version = '0.2.0'; export const idempotent = true; export async function migrate({ userPath }) { await appendFile(`${userPath}/private.txt`, 'first\\n'); }\n",
  );
  await write(
    secondMigration,
    "import { access, appendFile } from 'node:fs/promises'; export const version = '1.0.0'; export const idempotent = true; export async function migrate({ userPath }) { const marker = `${userPath}/partial.txt`; try { await access(marker); } catch { await appendFile(`${userPath}/private.txt`, 'second\\n'); await appendFile(marker, 'done\\n'); throw new Error('stop after mutation'); } }\n",
  );
  const installAgentAssets = async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] });
  const options = { kitPath, mindPath, homeDir: path.join(root, "home"), hostname: "TEST", pull: false, installAgentAssets };

  await assert.rejects(evolve(options), /stop/);
  assert.equal(await fs.readFile(path.join(mindPath, "user", "private.txt"), "utf8"), "first\nsecond\n");
  const result = await evolve(options);
  assert.deepEqual(result.migrations, ["1.0.0"]);
  assert.equal(await fs.readFile(path.join(mindPath, "user", "private.txt"), "utf8"), "first\nsecond\n");
});

test("evolve refuses to pull a dirty base before changing private data", async (t) => {
  const root = await temporaryDirectory(t, "evolve-dirty");
  const kitPath = path.join(root, "mind");
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "none") };
  await write(env.GIT_CONFIG_GLOBAL, "");
  await fs.mkdir(kitPath);
  await git(kitPath, ["init", "--initial-branch=main"], env);
  await git(kitPath, ["config", "user.name", "Test User"], env);
  await git(kitPath, ["config", "user.email", "test@example.invalid"], env);
  await write(path.join(kitPath, "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version: "1.0.0" })}\n`);
  await write(path.join(kitPath, ".gitignore"), "/user/\n");
  await git(kitPath, ["add", "package.json", ".gitignore"], env);
  await git(kitPath, ["commit", "-m", "Initial commit"], env);
  await makeMind(root);
  await write(path.join(kitPath, "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version: "2.0.0" })}\n`);
  let installerCalled = false;

  await assert.rejects(
    evolve({
      kitPath,
      mindPath: kitPath,
      homeDir: root,
      hostname: "TEST",
      env,
      installAgentAssets: async () => { installerCalled = true; },
    }),
    (error) => error.code === "DIRTY_KIT",
  );
  assert.equal(installerCalled, false);
  assert.equal(await fs.readFile(path.join(kitPath, "user", "VERSION"), "utf8"), "0.1.0\n");
});

test("evolve upgrades a copied mind through the real installer and keeps exclusions and private data", async (t) => {
  const root = await temporaryDirectory(t, "evolve-real");
  const mindPath = await makeMind(root);
  const oldKit = path.join(root, "old-kit");
  const newKit = path.join(root, "new-kit");
  const homeDir = path.join(root, "home");
  const env = { ...process.env, CODEX_HOME: path.join(homeDir, ".codex") };
  await write(
    path.join(mindPath, "user", "machines", "TEST.md"),
    `machine: TEST\nmind: ${mindPath}\nupdate-check: daily\nlast-check: 2029-01-01\nsetup: done\n\n## Agents\n- codex: on-demand\n\n## Paths\n\n## Excluded\n- corpo\n`,
  );
  await write(path.join(mindPath, "user", "preferences.md"), "private preference\n");
  for (const [kitPath, version, marker] of [[oldKit, "0.1.0", "old"], [newKit, "1.0.0", "new"]]) {
    await write(
      path.join(kitPath, "package.json"),
      `${JSON.stringify({ name: "hivem1nd-test", version, files: ["commands/", "features/", "migrations/", "rules.md"] })}\n`,
    );
    await write(path.join(kitPath, "rules.md"), `${marker} base rules\n`);
    await write(
      path.join(kitPath, "commands", "evolve.md"),
      `---\nname: evolve\ndescription: ${marker} evolve\n---\n\n# /evolve\n\nMind: {{mind}}\n`,
    );
    await write(
      path.join(kitPath, "features", "report.md"),
      `---\nname: report\ndescription: ${marker} report\n---\n\n# /report\n\nMind: {{mind}}\n`,
    );
    await write(
      path.join(kitPath, "features", "corpo.md"),
      `---\nname: corpo\ndescription: ${marker} corpo\n---\n\n# /corpo\n\nMind: {{mind}}\n`,
    );
  }
  await write(
    path.join(newKit, "migrations", "1.0.0.mjs"),
    "import { mkdir } from 'node:fs/promises'; import path from 'node:path'; export const version = '1.0.0'; export const idempotent = true; export async function migrate({ userPath }) { await mkdir(path.join(userPath, 'roles'), { recursive: true }); }\n",
  );

  const initial = await installAgentAssets({ kitPath: oldKit, mindPath, homeDir, hostname: "TEST", env });
  assert.deepEqual(initial.conflicts, []);
  const conflictPath = path.join(mindPath, "rules.md");
  await write(conflictPath, "locally edited base rules\n");
  const preflight = await evolve({ kitPath: newKit, mindPath, homeDir, hostname: "TEST", env, pull: false });
  assert.equal(preflight.completed, false);
  assert.deepEqual(preflight.migrations, []);
  assert.equal(preflight.conflicts[0].path, conflictPath);
  await assert.rejects(fs.access(path.join(mindPath, "user", "roles")));
  const result = await evolve({
    kitPath: newKit,
    mindPath,
    homeDir,
    hostname: "TEST",
    env,
    pull: false,
    conflicts: { [conflictPath]: "replace" },
  });
  assert.equal(result.completed, true);
  assert.match(await fs.readFile(path.join(mindPath, "rules.md"), "utf8"), /new base rules/);
  assert.match(await fs.readFile(path.join(homeDir, ".agents", "skills", "evolve", "SKILL.md"), "utf8"), /description: new evolve/);
  assert.match(await fs.readFile(path.join(homeDir, ".agents", "skills", "report", "SKILL.md"), "utf8"), /description: new report/);
  await assert.rejects(fs.access(path.join(homeDir, ".agents", "skills", "corpo")));
  assert.equal(await fs.readFile(path.join(mindPath, "user", "preferences.md"), "utf8"), "private preference\n");
  await fs.access(path.join(mindPath, "user", "roles"));
});

test("evolve preserves user-added kit files and warns only when the kit ships the same path", async (t) => {
  const root = await temporaryDirectory(t, "evolve-user-files");
  const mindPath = await makeMind(root);
  const oldKit = path.join(root, "old-kit");
  const newKit = path.join(root, "new-kit");
  const homeDir = path.join(root, "home");
  const env = { ...process.env, CODEX_HOME: path.join(homeDir, ".codex") };
  for (const [kitPath, version, marker] of [[oldKit, "1.0.0", "old"], [newKit, "2.0.0", "new"]]) {
    await write(
      path.join(kitPath, "package.json"),
      `${JSON.stringify({ name: "hivem1nd-test", version, files: ["features/"] })}\n`,
    );
    await write(path.join(kitPath, "features", "report.md"), `${marker} report\n`);
  }
  await write(path.join(newKit, "features", "onboarding.md"), "kit onboarding\n");

  await installAgentAssets({ kitPath: oldKit, mindPath, homeDir, hostname: "TEST", env });
  await write(path.join(mindPath, "features", "custom-tool.md"), "my own tool\n");
  await write(path.join(mindPath, "features", "onboarding.md"), "my own onboarding notes\n");

  const result = await evolve({ kitPath: newKit, mindPath, homeDir, hostname: "TEST", env, pull: false });

  assert.equal(result.completed, true);
  assert.deepEqual(result.conflicts, []);
  assert.match(result.warnings.join("\n"), /onboarding\.md/);
  assert.equal(await fs.readFile(path.join(mindPath, "features", "custom-tool.md"), "utf8"), "my own tool\n");
  assert.equal(await fs.readFile(path.join(mindPath, "features", "onboarding.md"), "utf8"), "my own onboarding notes\n");
  assert.equal(await fs.readFile(path.join(mindPath, "features", "report.md"), "utf8"), "new report\n");
});

test("evolve stops before pulling when the kit ships a file the user added", async (t) => {
  const root = await temporaryDirectory(t, "evolve-git-collision");
  const bare = path.join(root, "remote.git");
  const kitPath = path.join(root, "mind");
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "none") };
  await write(env.GIT_CONFIG_GLOBAL, "");
  await fs.mkdir(bare);
  await git(bare, ["init", "--bare", "--initial-branch=main"], env);
  await fs.mkdir(kitPath);
  await git(kitPath, ["init", "--initial-branch=main"], env);
  await git(kitPath, ["config", "user.name", "Test User"], env);
  await git(kitPath, ["config", "user.email", "test@example.invalid"], env);
  await write(
    path.join(kitPath, "package.json"),
    `${JSON.stringify({ name: "hivem1nd-test", version: "1.0.0", files: ["features/"] })}\n`,
  );
  await write(path.join(kitPath, ".gitignore"), "/user/\n");
  await write(path.join(kitPath, "features", "report.md"), "old report\n");
  await git(kitPath, ["add", "package.json", ".gitignore", "features/report.md"], env);
  await git(kitPath, ["commit", "-m", "Initial commit"], env);
  await git(kitPath, ["remote", "add", "origin", bare], env);
  await git(kitPath, ["push", "-u", "origin", "main"], env);
  await makeMind(root);

  const upstreamClone = path.join(root, "upstream-clone");
  await git(root, ["clone", bare, upstreamClone], env);
  await git(upstreamClone, ["config", "user.name", "Test User"], env);
  await git(upstreamClone, ["config", "user.email", "test@example.invalid"], env);
  await write(
    path.join(upstreamClone, "package.json"),
    `${JSON.stringify({ name: "hivem1nd-test", version: "2.0.0", files: ["features/"] })}\n`,
  );
  await write(path.join(upstreamClone, "features", "report.md"), "new report\n");
  await write(path.join(upstreamClone, "features", "onboarding.md"), "kit onboarding\n");
  await git(upstreamClone, ["add", "package.json", "features/report.md", "features/onboarding.md"], env);
  await git(upstreamClone, ["commit", "-m", "Release 2.0.0"], env);
  await git(upstreamClone, ["push", "origin", "main"], env);

  await write(path.join(kitPath, "features", "onboarding.md"), "my own onboarding notes\n");

  await assert.rejects(
    evolve({
      kitPath,
      mindPath: kitPath,
      homeDir: path.join(root, "home"),
      hostname: "TEST",
      env,
      installAgentAssets: async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] }),
    }),
    (error) => error.code === "KIT_COLLISION" && /onboarding\.md/.test(error.message),
  );
  assert.equal(await fs.readFile(path.join(kitPath, "features", "onboarding.md"), "utf8"), "my own onboarding notes\n");
  assert.equal(await fs.readFile(path.join(kitPath, "features", "report.md"), "utf8"), "old report\n");

  await fs.rename(path.join(kitPath, "features", "onboarding.md"), path.join(kitPath, "features", "my-onboarding.md"));
  const result = await evolve({
    kitPath,
    mindPath: kitPath,
    homeDir: path.join(root, "home"),
    hostname: "TEST",
    env,
    installAgentAssets: async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] }),
  });
  assert.equal(result.pulled, true);
  assert.equal(await fs.readFile(path.join(kitPath, "features", "report.md"), "utf8"), "new report\n");
  assert.equal(await fs.readFile(path.join(kitPath, "features", "my-onboarding.md"), "utf8"), "my own onboarding notes\n");
  assert.equal(await git(kitPath, ["status", "--porcelain"], env), "?? features/my-onboarding.md");
});

test("the actual setup installer parses and installs all eleven feature commands", async (t) => {
  const root = await temporaryDirectory(t, "feature-install");
  const mindPath = await makeMind(root);
  const homeDir = path.join(root, "home");
  const kitPath = path.resolve(import.meta.dirname, "..");
  const env = { ...process.env, CODEX_HOME: path.join(homeDir, ".codex") };
  const featureNames = [
    "brainstorm",
    "catchup",
    "conflicts",
    "corpo",
    "docs",
    "observer",
    "plan",
    "qa",
    "release",
    "report",
    "tribunal",
  ];
  await write(
    path.join(mindPath, "user", "machines", "TEST.md"),
    `machine: TEST\nmind: ${mindPath}\nupdate-check: off\nlast-check: \nsetup: done\n\n## Agents\n- codex: on-demand\n\n## Paths\n\n## Excluded\n`,
  );
  const result = await installAgentAssets({ kitPath, mindPath, homeDir, hostname: "TEST", env });
  assert.deepEqual(result.conflicts, []);
  for (const name of featureNames) {
    const installedPath = path.join(homeDir, ".agents", "skills", name, "SKILL.md");
    const content = await fs.readFile(installedPath, "utf8");
    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.match(content, new RegExp(`Mind: ${mindPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(content, /\{\{mind\}\}/);
  }
});

test("pylon creates and reuses an isolated branch while preserving the dirty code worktree", async (t) => {
  const repository = await makeRepositoryPair(t);
  const mindPath = await makeMind(repository.root);
  const originalHead = await git(repository.first, ["rev-parse", "HEAD"], repository.env);
  await write(path.join(repository.first, "app.txt"), "dirty and preserved\n");

  const result = await pylon({
    repoPath: repository.first,
    mindPath,
    kitPath: repository.first,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    state: "branch",
    aiFiles: true,
    aiTrailers: false,
    environment: "web",
    env: repository.env,
  });
  assert.equal(result.branch, "hivem1nd");
  assert.equal(result.pushed, true);
  assert.equal(await git(repository.first, ["branch", "--show-current"], repository.env), "main");
  assert.equal(await git(repository.first, ["rev-parse", "HEAD"], repository.env), originalHead);
  await assert.rejects(execFileAsync("git", ["merge-base", "main", "hivem1nd"], {
    cwd: repository.first,
    env: repository.env,
    encoding: "utf8",
  }));
  assert.equal(await fs.readFile(path.join(repository.first, "app.txt"), "utf8"), "dirty and preserved\n");
  assert.match(await fs.readFile(path.join(repository.first, ".gitignore"), "utf8"), /^\/\.hivem1nd\/state\/$/m);
  for (const directory of ["presence", "inbox", "tasks", "log"]) {
    await fs.access(path.join(result.statePath, directory, ".gitkeep"));
  }

  await git(repository.second, ["fetch", "origin", "hivem1nd"], repository.env);
  const remoteTree = await git(repository.second, ["ls-tree", "-r", "origin/hivem1nd"], repository.env);
  assert.match(remoteTree, /presence\/\.gitkeep/);
  assert.match(remoteTree, /inbox\/\.gitkeep/);
  const repeated = await pylon({
    repoPath: repository.first,
    mindPath,
    kitPath: repository.first,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    state: "branch",
    aiFiles: true,
    aiTrailers: false,
    environment: "web",
    env: repository.env,
  });
  assert.equal(repeated.reused, true);
  assert.equal(await fs.readFile(path.join(repository.first, "app.txt"), "utf8"), "dirty and preserved\n");

  const secondUser = await pylon({
    repoPath: repository.second,
    mindPath,
    kitPath: repository.second,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    state: "branch",
    aiFiles: true,
    aiTrailers: false,
    environment: "web",
    env: repository.env,
  });
  assert.equal(secondUser.reused, true);
  assert.equal(await git(repository.second, ["branch", "--show-current"], repository.env), "main");
  await write(path.join(secondUser.statePath, "tasks", "remote-task.md"), "id: 001\nstatus: open\n");
  await git(secondUser.statePath, ["add", "tasks/remote-task.md"], repository.env);
  await git(secondUser.statePath, ["commit", "-m", "Add remote task"], repository.env);
  await git(secondUser.statePath, ["push", "origin", "hivem1nd"], repository.env);
  const localNote = path.join(result.statePath, "log", "local-note.md");
  await write(localNote, "uncommitted local state\n");
  const preserved = await pylon({
    repoPath: repository.first,
    mindPath,
    kitPath: repository.first,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    state: "branch",
    aiFiles: true,
    aiTrailers: false,
    environment: "web",
    env: repository.env,
  });
  assert.equal(preserved.synced, false);
  assert.match(preserved.warnings.join("\n"), /local state worktree is dirty/);
  assert.equal(await fs.readFile(localNote, "utf8"), "uncommitted local state\n");
  await assert.rejects(fs.access(path.join(preserved.statePath, "tasks", "remote-task.md")));
  await fs.unlink(localNote);
  const synchronized = await pylon({
    repoPath: repository.first,
    mindPath,
    kitPath: repository.first,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    state: "branch",
    aiFiles: true,
    aiTrailers: false,
    environment: "web",
    env: repository.env,
  });
  assert.equal(synchronized.synced, true);
  assert.equal(await fs.readFile(path.join(synchronized.statePath, "tasks", "remote-task.md"), "utf8"), "id: 001\nstatus: open\n");
});

test("pylon main state remains visible for commit and preflight failures do not mutate a repo", async (t) => {
  const root = await temporaryDirectory(t, "pylon-main");
  const repoPath = path.join(root, "repo");
  const mindPath = await makeMind(root);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "none") };
  await write(env.GIT_CONFIG_GLOBAL, "");
  await fs.mkdir(repoPath);
  await git(repoPath, ["init", "--initial-branch=main"], env);
  await git(repoPath, ["config", "user.name", "Test User"], env);
  await git(repoPath, ["config", "user.email", "test@example.invalid"], env);
  await write(path.join(repoPath, "file.txt"), "base\n");
  await git(repoPath, ["add", "file.txt"], env);
  await git(repoPath, ["commit", "-m", "Initial commit"], env);

  await pylon({ repoPath, mindPath, kitPath: repoPath, homeDir: root, hostname: "TEST", state: "main", aiFiles: true, env });
  const ignore = await fs.readFile(path.join(repoPath, ".gitignore"), "utf8").catch(() => "");
  assert.doesNotMatch(ignore, /\.hivem1nd\/state/);
  assert.match(await git(repoPath, ["status", "--short"], env), /\.hivem1nd\//);

  const untouchedRepo = path.join(root, "untouched");
  await fs.mkdir(untouchedRepo);
  await git(untouchedRepo, ["init", "--initial-branch=main"], env);
  await git(untouchedRepo, ["config", "user.name", "Test User"], env);
  await git(untouchedRepo, ["config", "user.email", "test@example.invalid"], env);
  await write(path.join(untouchedRepo, "file.txt"), "base\n");
  await git(untouchedRepo, ["add", "file.txt"], env);
  await git(untouchedRepo, ["commit", "-m", "Initial commit"], env);
  await assert.rejects(
    pylon({ repoPath: untouchedRepo, mindPath, kitPath: untouchedRepo, homeDir: root, hostname: "MISSING", env }),
    (error) => error.code === "MACHINE_NOT_FOUND",
  );
  await assert.rejects(fs.access(path.join(untouchedRepo, ".hivem1nd")));
  await assert.rejects(
    pylon({ repoPath: untouchedRepo, mindPath, kitPath: untouchedRepo, homeDir: root, hostname: "..", env }),
    (error) => error.code === "INVALID_HOSTNAME",
  );
  await pylon({
    repoPath: untouchedRepo,
    mindPath,
    kitPath: untouchedRepo,
    homeDir: root,
    hostname: "TEST",
    state: "branch",
    aiFiles: false,
    env,
    push: false,
  });
  const localExclude = await fs.readFile(path.join(untouchedRepo, ".git", "info", "exclude"), "utf8");
  assert.match(localExclude, /^\/\.hivem1nd\/state\/$/m);
  assert.doesNotMatch(localExclude, /^\/\.hivem1nd\/$/m);
  assert.match(await git(untouchedRepo, ["status", "--short", "--untracked-files=all"], env), /\.hivem1nd\/config\.md/);

  const linkedRepo = path.join(root, "linked");
  const outside = path.join(root, "outside");
  await fs.mkdir(linkedRepo);
  await fs.mkdir(outside);
  await git(linkedRepo, ["init", "--initial-branch=main"], env);
  await git(linkedRepo, ["config", "user.name", "Test User"], env);
  await git(linkedRepo, ["config", "user.email", "test@example.invalid"], env);
  await write(path.join(linkedRepo, "file.txt"), "base\n");
  await git(linkedRepo, ["add", "file.txt"], env);
  await git(linkedRepo, ["commit", "-m", "Initial commit"], env);
  try {
    await fs.symlink(outside, path.join(linkedRepo, ".hivem1nd"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      pylon({ repoPath: linkedRepo, mindPath, kitPath: linkedRepo, homeDir: root, hostname: "TEST", env }),
      (error) => error.code === "UNSAFE_SYMLINK",
    );
    assert.deepEqual(await fs.readdir(outside), []);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
});

test("daily update checks read the upstream version without changing the checkout", async (t) => {
  const repository = await makeRepositoryPair(t);
  const mindPath = await makeMind(repository.root);
  await write(path.join(repository.second, "package.json"), `${JSON.stringify({ name: "hivem1nd-test", version: "2.0.0" })}\n`);
  await git(repository.second, ["add", "package.json"], repository.env);
  await git(repository.second, ["commit", "-m", "Release 2.0.0"], repository.env);
  await git(repository.second, ["push", "origin", "main"], repository.env);
  const originalHead = await git(repository.first, ["rev-parse", "HEAD"], repository.env);

  const result = await checkForUpdates({
    kitPath: repository.first,
    mindPath,
    homeDir: path.join(repository.root, "home"),
    hostname: "TEST",
    now: new Date("2030-01-02T12:00:00Z"),
    env: repository.env,
  });
  assert.equal(result.checked, true);
  assert.equal(result.currentVersion, "0.1.0");
  assert.equal(result.sourceVersion, "1.0.0");
  assert.equal(result.latestVersion, "2.0.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(await git(repository.first, ["rev-parse", "HEAD"], repository.env), originalHead);
  assert.match(await fs.readFile(path.join(repository.first, "package.json"), "utf8"), /"version":"1\.0\.0"/);
});

test("a packaged update check compares the selected source with the installed mind", async (t) => {
  const root = await temporaryDirectory(t, "packaged-check");
  const mindPath = await makeMind(root);
  const kitPath = await makeKit(root, "2.0.0");
  const result = await checkForUpdates({
    kitPath,
    mindPath,
    homeDir: path.join(root, "home"),
    hostname: "TEST",
    now: new Date("2030-01-02T12:00:00Z"),
    fetch: false,
  });
  assert.equal(result.currentVersion, "0.1.0");
  assert.equal(result.sourceVersion, "2.0.0");
  assert.equal(result.latestVersion, "2.0.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(await fs.readFile(path.join(mindPath, "user", "VERSION"), "utf8"), "0.1.0\n");
});

test("empty last-check headers preserve the following machine preferences", async (t) => {
  const root = await temporaryDirectory(t, "empty-last-check");
  const mindPath = await makeMind(root);
  const kitPath = await makeKit(root);
  const machinePath = path.join(mindPath, "user", "machines", "TEST.md");
  const machine = `machine: TEST\nmind: ${mindPath}\nupdate-check: daily\nlast-check: \npreferences-first: no\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`;
  await write(machinePath, machine);

  await checkForUpdates({
    kitPath,
    mindPath,
    homeDir: path.join(root, "home"),
    hostname: "TEST",
    now: new Date("2030-01-02T12:00:00Z"),
    fetch: false,
  });
  let updated = await fs.readFile(machinePath, "utf8");
  assert.match(updated, /^last-check: 2030-01-02$/m);
  assert.match(updated, /^preferences-first: no$/m);
  assert.match(updated, /^setup: done$/m);

  await write(machinePath, machine);
  await evolve({
    kitPath,
    mindPath,
    homeDir: path.join(root, "home"),
    hostname: "TEST",
    now: new Date("2030-01-03T12:00:00Z"),
    pull: false,
    installAgentAssets: async () => ({ agents: [], baseFiles: [], warnings: [], conflicts: [] }),
  });
  updated = await fs.readFile(machinePath, "utf8");
  assert.match(updated, /^last-check: 2030-01-03$/m);
  assert.match(updated, /^preferences-first: no$/m);
  assert.match(updated, /^setup: done$/m);
});

test("swarm summarizes root, environment and project state", async (t) => {
  const root = await temporaryDirectory(t, "swarm");
  const mindPath = await makeMind(root);
  await write(path.join(mindPath, "user", "state", "overseer.md"), "unit: overseer\nstate: in\nmachine: TEST\ndate: 2030-01-02 10:00\n\nPlanning releases.\nMore context.\n");
  await write(path.join(mindPath, "user", "envs", "web", "state", "overlord-web.md"), "unit: overlord-web\nstate: out\nmachine: TEST\ndate: 2030-01-02 09:00\n\nWaiting for reports.\n");
  await write(path.join(mindPath, "user", "projects", "app", "state", "executor-app.md"), "unit: executor-app\nstate: in\nmachine: TEST\ndate: 2030-01-02 11:00\n\nBuilding login.\n");
  await write(path.join(mindPath, "user", "projects", "app", "tasks", "001-login.md"), "id: 001\nstatus: open\n\n## Request\nLogin.\n");
  await write(path.join(mindPath, "user", "projects", "app", "tasks", "002-copy.md"), "id: 002\nstatus: done\n\n## Request\nCopy.\n");
  await write(path.join(mindPath, "user", "projects", "app", "tasks", "003-old.md"), "id: 003\nstatus: closed\n\n## Request\nOld.\n");
  await write(path.join(mindPath, "user", "projects", "app", "inbox", "executor-app", "one.md"), "message\n");
  await write(path.join(mindPath, "user", "projects", "app", "inbox", "executor-app", "two.md"), "message\n");

  const result = await swarm({ mindPath, kitPath: mindPath, homeDir: root, hostname: "TEST" });
  assert.deepEqual(result.units.map((unit) => unit.scope).sort(), ["environment", "project", "root"]);
  assert.equal(result.units.find((unit) => unit.unit === "overseer").context, "Planning releases.");
  assert.equal(result.tasks.open, 1);
  assert.equal(result.tasks.done, 1);
  assert.deepEqual(result.tasks.projects[0].items.map((item) => item.slug), ["login", "copy"]);
  assert.equal(result.inboxes.unread, 2);
  assert.equal(result.inboxes.units[0].unit, "executor-app");
});
