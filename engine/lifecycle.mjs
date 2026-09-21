import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { assertSafePath as assertRecordSafePath, atomicWriteFile, parseMachineRecord } from "./records.mjs";

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const MIGRATION_PATTERN = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.mjs$/;
const STATE_DIRECTORIES = ["presence", "inbox", "tasks", "log"];
const USER_KIT_FOLDERS = ["roles", "features", "commands", "knowledge"];
const UNOWNED_FILE_REASON = "An unowned file already exists at this path.";
let migrationImportSequence = 0;

function lifecycleError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

async function assertSafePath(root, target, options) {
  try {
    return await assertRecordSafePath(root, target, options);
  } catch (cause) {
    const code = /symbolic/i.test(cause.message) ? "UNSAFE_SYMLINK" : "UNSAFE_PATH";
    throw lifecycleError(code, cause.message, cause);
  }
}

function resolveOptions(options = {}) {
  const kitPath = path.resolve(options.kitPath ?? process.cwd());
  const mindPath = path.resolve(options.mindPath ?? kitPath);
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const hostname = String(options.hostname ?? os.hostname()).trim();

  if (!hostname
    || hostname === "."
    || hostname === ".."
    || /[\\/:*?"<>|\0]/.test(hostname)
    || hostname !== path.basename(hostname)) {
    throw lifecycleError("INVALID_HOSTNAME", "The hostname must be one path-safe name.");
  }

  return { ...options, kitPath, mindPath, homeDir, hostname };
}

async function readText(filePath, fallback = null) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) {
      return fallback;
    }
    throw error;
  }
}

async function writeText(filePath, content, root = path.dirname(filePath)) {
  await atomicWriteFile(filePath, content, { root });
}

function headerValue(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^${escaped}:[ \\t]*(.*)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function setHeader(content, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:[ \\t]*.*$`, "im");
  if (pattern.test(content)) {
    return content.replace(pattern, `${name}: ${value}`);
  }

  const separator = content.search(/\r?\n\r?\n/);
  if (separator >= 0) {
    return `${content.slice(0, separator)}\n${name}: ${value}${content.slice(separator)}`;
  }
  return `${content.trimEnd()}\n${name}: ${value}\n`;
}

function bodyFirstLine(content) {
  const parts = content.split(/\r?\n\r?\n/, 2);
  if (parts.length < 2) {
    return "";
  }
  return parts[1].split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function parseVersion(value, source) {
  const text = String(value ?? "").trim();
  const match = text.match(VERSION_PATTERN);
  if (!match) {
    throw lifecycleError("INVALID_VERSION", `Invalid version in ${source}: ${text || "empty"}.`);
  }
  return {
    text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ""}`,
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left, "version") : left;
  const b = typeof right === "string" ? parseVersion(right, "version") : right;
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] < b.numbers[index] ? -1 : 1;
    }
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function isoDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw lifecycleError("INVALID_DATE", "The supplied date is invalid.");
  }
  return date.toISOString().slice(0, 10);
}

async function runGit(cwd, args, options = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw lifecycleError("INVALID_GIT_ARGUMENT", "Git arguments must be an array of strings.");
  }

  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (cause) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: String(cause.stdout ?? "").trim(),
        stderr: String(cause.stderr ?? cause.message ?? "").trim(),
      };
    }
    throw lifecycleError(
      "GIT_FAILED",
      `Git ${args[0] ?? "command"} failed${cause.stderr ? `: ${String(cause.stderr).trim()}` : "."}`,
      cause,
    );
  }
}

async function runGitWithInput(cwd, args, input, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (cause) => reject(lifecycleError("GIT_FAILED", cause.message, cause)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(lifecycleError("GIT_FAILED", `Git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}.`));
      }
    });
    child.stdin.end(input);
  });
}

async function readPackageManifest(kitPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readText(path.join(kitPath, "package.json")));
  } catch (cause) {
    throw lifecycleError("INVALID_PACKAGE", `Cannot read ${path.join(kitPath, "package.json")}.`, cause);
  }
  const name = String(manifest.name ?? "").trim();
  if (!name) {
    throw lifecycleError("INVALID_PACKAGE", "package.json does not contain a package name.");
  }
  return { name, version: parseVersion(manifest.version, "package.json").text };
}

async function readPackageVersion(kitPath) {
  return (await readPackageManifest(kitPath)).version;
}

async function gitRoot(directory) {
  const result = await runGit(directory, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (!result.ok || !result.stdout) return null;
  return path.resolve(result.stdout);
}

async function isSameDirectory(left, right) {
  const [realLeft, realRight] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
  return realLeft.toLowerCase() === realRight.toLowerCase();
}

async function registryVersion(packageName) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw lifecycleError("REGISTRY_CHECK_FAILED", `The package registry returned HTTP ${response.status}.`);
  }
  const manifest = await response.json();
  return parseVersion(manifest.version, "registry package metadata").text;
}

async function machineFilePath(mindPath, hostname) {
  const machinesPath = path.join(mindPath, "user", "machines");
  const direct = path.join(machinesPath, `${hostname}.md`);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    const entries = await fs.readdir(machinesPath, { withFileTypes: true }).catch(() => []);
    const match = entries.find((entry) => entry.isFile()
      && entry.name.toLowerCase() === `${hostname}.md`.toLowerCase());
    if (match) return path.join(machinesPath, match.name);
    throw lifecycleError("MACHINE_NOT_FOUND", `No machine record exists for ${hostname}.`);
  }
}

async function updateLastCheck(mindPath, hostname, date) {
  const filePath = await machineFilePath(mindPath, hostname);
  const content = await readText(filePath);
  await writeText(filePath, setHeader(content, "last-check", date), mindPath);
}

async function loadMigrations(kitPath) {
  const directory = path.join(kitPath, "migrations");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const migrations = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(MIGRATION_PATTERN);
    if (!match) {
      if (entry.name.endsWith(".mjs")) {
        throw lifecycleError("INVALID_MIGRATION_NAME", `Migration file names must be SemVer values: ${entry.name}.`);
      }
      continue;
    }
    const version = parseVersion(match[1], entry.name).text;
    if (seen.has(version)) {
      throw lifecycleError("DUPLICATE_MIGRATION", `More than one migration targets ${version}.`);
    }
    seen.add(version);
    migrations.push({ version, filePath: path.join(directory, entry.name) });
  }

  migrations.sort((left, right) => compareVersions(left.version, right.version));
  return migrations;
}

async function applyMigrations({ kitPath, mindPath, fromVersion, toVersion }) {
  const migrations = await loadMigrations(kitPath);
  const recordPath = path.join(mindPath, "user", "MIGRATIONS");
  const record = await readText(recordPath, "");
  const completed = new Set(record.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  for (const version of completed) parseVersion(version, recordPath);
  const selected = migrations.filter((migration) => compareVersions(migration.version, fromVersion) > 0
    && compareVersions(migration.version, toVersion) <= 0);
  const applied = [];

  for (const migration of selected) {
    if (completed.has(migration.version)) continue;
    migrationImportSequence += 1;
    const url = `${pathToFileURL(migration.filePath).href}?run=${migrationImportSequence}`;
    const module = await import(url);
    if (module.version && parseVersion(module.version, migration.filePath).text !== migration.version) {
      throw lifecycleError(
        "MIGRATION_VERSION_MISMATCH",
        `${path.basename(migration.filePath)} exports version ${module.version}, expected ${migration.version}.`,
      );
    }
    const migrate = module.migrate ?? module.default;
    if (typeof migrate !== "function") {
      throw lifecycleError("INVALID_MIGRATION", `${path.basename(migration.filePath)} does not export migrate().`);
    }
    if (module.idempotent !== true) {
      throw lifecycleError(
        "MIGRATION_NOT_IDEMPOTENT",
        `${path.basename(migration.filePath)} must export idempotent = true and be safe to resume after partial failure.`,
      );
    }
    await migrate({
      userPath: path.join(mindPath, "user"),
      fromVersion,
      toVersion,
      version: migration.version,
    });
    applied.push(migration.version);
    completed.add(migration.version);
    await writeText(recordPath, `${[...completed].sort(compareVersions).join("\n")}\n`, mindPath);
  }
  return applied;
}

function isUserKitFolderPath(mindPath, filePath) {
  const relative = path.relative(mindPath, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return USER_KIT_FOLDERS.includes(relative.split(path.sep)[0]);
}

function isUserKitFolderRelativePath(relativePath) {
  return USER_KIT_FOLDERS.includes(relativePath.split("/")[0]);
}

function userFileCollisionWarning(filePath) {
  return `${filePath}: the kit now ships a file with the same name; the existing file was left unchanged; renaming it lets the kit version install.`;
}

async function pullBaseRepository(kitPath, env, userAdditions) {
  if (userAdditions.length === 0) {
    await runGit(kitPath, ["pull", "--ff-only"], { env });
    return [];
  }

  await runGit(kitPath, ["fetch"], { allowFailure: true, env });
  const upstream = await runGit(kitPath, ["rev-parse", "@{upstream}"], { allowFailure: true, env });
  const collisions = new Set();
  if (upstream.ok && upstream.stdout) {
    const incoming = await runGit(kitPath, ["diff", "--name-only", "HEAD", upstream.stdout], { allowFailure: true, env });
    if (incoming.ok) {
      for (const relativePath of incoming.stdout.split(/\r?\n/).filter(Boolean)) {
        if (userAdditions.includes(relativePath)) collisions.add(relativePath);
      }
    }
  }

  if (collisions.size > 0) {
    const paths = [...collisions].map((relativePath) => path.join(kitPath, ...relativePath.split("/")));
    throw lifecycleError(
      "KIT_COLLISION",
      `The kit now ships files with the same name as files added to the base folder. Evolve did not pull or modify it. Rename these files and run evolve again:\n${paths.join("\n")}`,
    );
  }

  await runGit(kitPath, ["pull", "--ff-only"], { env });
  return [];
}

export async function evolve(options = {}) {
  const resolved = resolveOptions(options);
  const versionPath = path.join(resolved.mindPath, "user", "VERSION");
  await assertSafePath(resolved.mindPath, versionPath, { allowMissing: false });
  const selectedMachinePath = await machineFilePath(resolved.mindPath, resolved.hostname);
  await assertSafePath(resolved.mindPath, selectedMachinePath, { allowMissing: false });
  const fromVersion = parseVersion(await readText(versionPath), versionPath).text;
  let pulled = false;
  const lifecycleWarnings = [];

  if (resolved.pull !== false) {
    const baseRoot = await gitRoot(resolved.kitPath);
    if (baseRoot && await isSameDirectory(baseRoot, resolved.kitPath)) {
      const status = await runGit(
        resolved.kitPath,
        ["status", "--porcelain", "--untracked-files=normal"],
        { env: resolved.env },
      );
      const userAdditions = [];
      for (const line of status.stdout.split(/\r?\n/).filter(Boolean)) {
        const relativePath = line.slice(3).trim();
        if (line.startsWith("??") && isUserKitFolderRelativePath(relativePath)) {
          userAdditions.push(relativePath);
        } else {
          throw lifecycleError("DIRTY_KIT", "The base folder has uncommitted changes. Evolve did not pull or modify it.");
        }
      }
      lifecycleWarnings.push(...await pullBaseRepository(resolved.kitPath, resolved.env, userAdditions));
      pulled = true;
    } else {
      lifecycleWarnings.push("The selected packaged kit has no Git checkout; evolve used its verified local version.");
    }
  }

  const toVersion = await readPackageVersion(resolved.kitPath);
  if (compareVersions(toVersion, fromVersion) < 0) {
    throw lifecycleError("VERSION_DOWNGRADE", `Installed version ${fromVersion} is newer than base version ${toVersion}.`);
  }

  const installAgentAssets = resolved.installAgentAssets
    ?? (await import("./install.mjs")).installAgentAssets;
  if (typeof installAgentAssets !== "function") {
    throw lifecycleError("INSTALLER_UNAVAILABLE", "The setup installer does not export installAgentAssets().");
  }

  const installOptions = {
    kitPath: resolved.kitPath,
    mindPath: resolved.mindPath,
    homeDir: resolved.homeDir,
    hostname: resolved.hostname,
    env: resolved.env,
    conflictChoices: { ...(resolved.conflicts ?? {}) },
  };
  const preflight = await installAgentAssets({
    ...installOptions,
    previewOnly: true,
  });
  const preflightConflicts = preflight?.conflicts ?? [];
  const userFileCollisions = preflightConflicts.filter((conflict) => conflict.reason === UNOWNED_FILE_REASON
    && isUserKitFolderPath(resolved.mindPath, conflict.path));
  const collisionWarnings = userFileCollisions.map((conflict) => userFileCollisionWarning(conflict.path));
  for (const conflict of userFileCollisions) installOptions.conflictChoices[conflict.path] = "keep";
  const unresolved = preflightConflicts.filter((conflict) => {
    const choice = installOptions.conflictChoices[conflict.path];
    return !(conflict.choices ?? ["keep", "replace"]).includes(choice);
  });
  if (unresolved.length > 0) {
    return {
      action: "evolve",
      fromVersion,
      toVersion,
      changed: compareVersions(fromVersion, toVersion) !== 0,
      pulled,
      migrations: [],
      baseFiles: preflight?.baseFiles ?? [],
      agents: preflight?.agents ?? [],
      warnings: [...lifecycleWarnings, ...collisionWarnings, ...(preflight?.warnings ?? [])],
      conflicts: unresolved,
      lastCheck: headerValue(
        await readText(await machineFilePath(resolved.mindPath, resolved.hostname)),
        "last-check",
      ),
      completed: false,
    };
  }

  const migrations = await applyMigrations({
    kitPath: resolved.kitPath,
    mindPath: resolved.mindPath,
    fromVersion,
    toVersion,
  });
  const installation = await installAgentAssets(installOptions);
  const agents = installation?.agents ?? [];
  const baseFiles = installation?.baseFiles ?? [];
  const omitted = installation?.omitted ?? [];
  const replacedLinks = installation?.replacedLinks ?? [];
  const warnings = [...lifecycleWarnings, ...collisionWarnings, ...(installation?.warnings ?? [])];
  const conflicts = installation?.conflicts ?? [];
  const lastCheck = isoDate(resolved.now);
  const completed = conflicts.length === 0;

  if (completed) {
    await writeText(versionPath, `${toVersion}\n`, resolved.mindPath);
    await updateLastCheck(resolved.mindPath, resolved.hostname, lastCheck);
  }

  return {
    action: "evolve",
    fromVersion,
    toVersion,
    changed: compareVersions(fromVersion, toVersion) !== 0
      || migrations.length > 0
      || baseFiles.length > 0
      || agents.some((agent) => (agent.files ?? []).length > 0),
    pulled,
    migrations,
    baseFiles,
    agents,
    warnings,
    conflicts,
    omitted,
    replacedLinks,
    reportPath: installation?.reportPath ?? null,
    lastCheck: completed ? lastCheck : headerValue(
      await readText(await machineFilePath(resolved.mindPath, resolved.hostname)),
      "last-check",
    ),
    completed,
  };
}

export async function checkForUpdates(options = {}) {
  const resolved = resolveOptions(options);
  const machinePath = await machineFilePath(resolved.mindPath, resolved.hostname);
  await assertSafePath(resolved.mindPath, machinePath, { allowMissing: false });
  const machine = await readText(machinePath);
  const packageManifest = await readPackageManifest(resolved.kitPath);
  const versionPath = path.join(resolved.mindPath, "user", "VERSION");
  await assertSafePath(resolved.mindPath, versionPath, { allowMissing: false });
  const currentVersion = parseVersion(await readText(versionPath), versionPath).text;
  const sourceVersion = packageManifest.version;
  const date = isoDate(resolved.now);
  const policy = headerValue(machine, "update-check").toLowerCase() || "off";
  const previousCheck = headerValue(machine, "last-check");

  if (policy !== "daily") {
    return {
      action: "check",
      checked: false,
      reason: "off",
      currentVersion,
      sourceVersion,
      latestVersion: sourceVersion,
      updateAvailable: false,
      notice: null,
      lastCheck: previousCheck,
      warnings: [],
    };
  }
  if (previousCheck === date) {
    return {
      action: "check",
      checked: false,
      reason: "already-checked",
      currentVersion,
      sourceVersion,
      latestVersion: sourceVersion,
      updateAvailable: false,
      notice: null,
      lastCheck: previousCheck,
      warnings: [],
    };
  }

  const warnings = [];
  let latestVersion = sourceVersion;
  if (resolved.fetch !== false) {
    const baseRoot = await gitRoot(resolved.kitPath);
    if (baseRoot && await isSameDirectory(baseRoot, resolved.kitPath)) {
      const fetched = await runGit(
        resolved.kitPath,
        ["fetch", "--quiet"],
        { allowFailure: true, env: resolved.env },
      );
      if (!fetched.ok) {
        warnings.push(`Update check failed: ${fetched.stderr || "git fetch failed"}`);
      } else {
        const upstream = await runGit(
          resolved.kitPath,
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
          { allowFailure: true, env: resolved.env },
        );
        if (!upstream.ok || !upstream.stdout) {
          warnings.push("Update check skipped the comparison because the current branch has no upstream.");
        } else {
          const remoteManifest = await runGit(
            resolved.kitPath,
            ["show", `${upstream.stdout}:package.json`],
            { allowFailure: true, env: resolved.env },
          );
          if (!remoteManifest.ok) {
            warnings.push("Update check could not read package.json from the upstream branch.");
          } else {
            try {
              const upstreamVersion = parseVersion(JSON.parse(remoteManifest.stdout).version, "upstream package.json").text;
              if (compareVersions(upstreamVersion, latestVersion) > 0) latestVersion = upstreamVersion;
            } catch (error) {
              warnings.push(error.message);
            }
          }
        }
      }
    } else {
      try {
        const publishedVersion = await registryVersion(packageManifest.name);
        if (compareVersions(publishedVersion, latestVersion) > 0) latestVersion = publishedVersion;
      } catch (error) {
        warnings.push(`Update check failed: ${error.message}`);
      }
    }
  } else if (resolved.latestVersion !== undefined) {
    const selectedVersion = parseVersion(resolved.latestVersion, "latestVersion").text;
    if (compareVersions(selectedVersion, latestVersion) > 0) latestVersion = selectedVersion;
  }

  await writeText(machinePath, setHeader(machine, "last-check", date), resolved.mindPath);
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  return {
    action: "check",
    checked: true,
    reason: "checked",
    currentVersion,
    sourceVersion,
    latestVersion,
    updateAvailable,
    notice: updateAvailable ? `HIVEM1ND ${latestVersion} is available. Run /evolve to update.` : null,
    lastCheck: date,
    warnings,
  };
}

function splitLines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
}

function sectionBounds(lines, heading) {
  let start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push(`## ${heading}`);
    start = lines.length - 1;
  }
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  return { start, end };
}

function upsertBullet(lines, heading, matcher, value) {
  const bounds = sectionBounds(lines, heading);
  const index = lines.findIndex((line, lineIndex) => lineIndex > bounds.start
    && lineIndex < bounds.end
    && matcher(line));
  if (index >= 0) {
    if (lines[index] === value) return false;
    lines[index] = value;
    return true;
  }
  let insertAt = bounds.end;
  while (insertAt > bounds.start + 1 && lines[insertAt - 1] === "") insertAt -= 1;
  lines.splice(insertAt, 0, value);
  return true;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function registerPylon({ mindPath, hostname, repoPath, environment }) {
  const project = path.basename(repoPath);
  const routesPath = path.join(mindPath, "user", "routes.md");
  const routeLines = splitLines(await readText(routesPath, ""));
  let routeChanged = upsertBullet(
    routeLines,
    "Projects",
    (line) => new RegExp(`^-\\s+${escapePattern(project)}(?:\\s|$)`, "i").test(line),
    `- ${project}${environment ? ` (${environment})` : ""}`,
  );

  if (environment) {
    const environmentPattern = new RegExp(`^-\\s+${escapePattern(environment)}:\\s*(.*)$`, "i");
    const bounds = sectionBounds(routeLines, "Environments");
    const existing = routeLines.findIndex((line, index) => index > bounds.start
      && index < bounds.end
      && environmentPattern.test(line));
    if (existing >= 0) {
      const match = routeLines[existing].match(environmentPattern);
      const projects = (match?.[1] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      if (!projects.some((item) => item.toLowerCase() === project.toLowerCase())) {
        projects.push(project);
        routeLines[existing] = `- ${environment}: ${projects.join(", ")}`;
        routeChanged = true;
      }
    } else {
      routeChanged = upsertBullet(
        routeLines,
        "Environments",
        (line) => environmentPattern.test(line),
        `- ${environment}: ${project}`,
      ) || routeChanged;
    }
  }
  if (routeChanged) await writeText(routesPath, `${routeLines.join("\n").trim()}\n`, mindPath);

  const machinePath = await machineFilePath(mindPath, hostname);
  const machineLines = splitLines(await readText(machinePath));
  const pathChanged = upsertBullet(
    machineLines,
    "Paths",
    (line) => new RegExp(`^-\\s+${escapePattern(project)}:\\s`, "i").test(line),
    `- ${project}: ${repoPath}`,
  );
  if (pathChanged) await writeText(machinePath, `${machineLines.join("\n").trim()}\n`, mindPath);
  return { route: routeChanged, path: pathChanged };
}

async function appendUniqueLine(filePath, line, root = path.dirname(filePath)) {
  const content = await readText(filePath, "");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.some((entry) => entry.trim() === line)) return false;
  const prefix = content && !content.endsWith("\n") ? `${content}\n` : content;
  await writeText(filePath, `${prefix}${line}\n`, root);
  return true;
}

function parseWorktrees(content) {
  return content.split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    return {
      path: lines.find((line) => line.startsWith("worktree "))?.slice(9),
      branch: lines.find((line) => line.startsWith("branch "))?.slice(7),
    };
  }).filter((worktree) => worktree.path);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function gitIdentity(repoPath, env) {
  const [name, email] = await Promise.all([
    runGit(repoPath, ["config", "user.name"], { allowFailure: true, env }),
    runGit(repoPath, ["config", "user.email"], { allowFailure: true, env }),
  ]);
  if (!name.ok || !name.stdout || !email.ok || !email.stdout) {
    throw lifecycleError("GIT_IDENTITY_REQUIRED", "Git user.name and user.email are required to initialize team state.");
  }
}

async function ensureStateDirectories(statePath, created) {
  for (const directory of STATE_DIRECTORIES) {
    const directoryPath = path.join(statePath, directory);
    const keepPath = path.join(directoryPath, ".gitkeep");
    await fs.mkdir(directoryPath, { recursive: true });
    if (!await pathExists(keepPath)) {
      await writeText(keepPath, "", statePath);
      created.push(keepPath);
    }
  }
}

export async function pylon(options = {}) {
  const resolved = resolveOptions(options);
  if (!options.repoPath) {
    throw lifecycleError("REPO_REQUIRED", "Pylon requires repoPath.");
  }
  const state = options.state ?? "branch";
  if (!["branch", "main"].includes(state)) {
    throw lifecycleError("INVALID_STATE", "Pylon state must be branch or main.");
  }
  const aiFiles = options.aiFiles ?? true;
  const aiTrailers = options.aiTrailers ?? false;
  const requestedPath = path.resolve(options.repoPath);
  const canonicalRequestedPath = await fs.realpath(requestedPath).catch((cause) => {
    throw lifecycleError("REPO_NOT_FOUND", `Repository path does not exist: ${requestedPath}.`, cause);
  });
  const rootResult = await runGit(
    canonicalRequestedPath,
    ["rev-parse", "--show-toplevel"],
    { env: resolved.env },
  );
  const repoPath = await fs.realpath(path.resolve(rootResult.stdout));
  const git = (args, gitOptions = {}) => runGit(repoPath, args, { ...gitOptions, env: resolved.env });

  const userPath = path.join(resolved.mindPath, "user");
  const machinesPath = path.join(userPath, "machines");
  await assertSafePath(resolved.mindPath, machinesPath, { allowMissing: false });
  const selectedMachinePath = await machineFilePath(resolved.mindPath, resolved.hostname);
  await assertSafePath(resolved.mindPath, selectedMachinePath, { allowMissing: false });
  await assertSafePath(resolved.mindPath, path.join(userPath, "routes.md"));
  const initialBranch = (await git(["branch", "--show-current"])).stdout;
  const initialCommit = (await git(["rev-parse", "HEAD"])).stdout;
  const created = [];
  const warnings = [];
  const hivemindPath = path.join(repoPath, ".hivem1nd");
  const statePath = path.join(hivemindPath, "state");
  const configPath = path.join(hivemindPath, "config.md");
  if (path.relative(repoPath, statePath).startsWith("..")) {
    throw lifecycleError("UNSAFE_PYLON_PATH", "The pylon state path escapes the repository.");
  }
  await assertSafePath(repoPath, hivemindPath);
  await assertSafePath(repoPath, configPath);
  await assertSafePath(repoPath, statePath);

  const config = `state: ${state}\nai-trailers: ${aiTrailers ? "yes" : "no"}\nai-files: ${aiFiles ? "yes" : "no"}\n`;
  const existingConfig = await readText(configPath, "");
  let reused = Boolean(existingConfig);
  if (existingConfig && existingConfig.replace(/\r\n/g, "\n") !== config) {
    throw lifecycleError("PYLON_CONFIG_CONFLICT", `${configPath} already contains different pylon settings.`);
  }
  const worktrees = parseWorktrees((await git(["worktree", "list", "--porcelain"])).stdout);
  const targetWorktree = worktrees.find((worktree) => path.resolve(worktree.path).toLowerCase() === statePath.toLowerCase());
  let branchExists = false;
  let remote;
  let remoteBranch;
  let ignorePath = null;
  let ignoreLine = null;
  if (state === "branch") {
    if (aiFiles) {
      ignorePath = path.join(repoPath, ".gitignore");
    } else {
      const gitPath = await git(["rev-parse", "--git-path", "info/exclude"]);
      ignorePath = path.resolve(repoPath, gitPath.stdout);
    }
    ignoreLine = "/.hivem1nd/state/";
  }
  if (ignorePath) {
    const relativeIgnore = path.relative(repoPath, ignorePath);
    if (!relativeIgnore.startsWith("..") && !path.isAbsolute(relativeIgnore)) {
      await assertSafePath(repoPath, ignorePath);
    } else {
      const commonPath = (await git(["rev-parse", "--git-common-dir"])).stdout;
      const commonRoot = await fs.realpath(path.resolve(repoPath, commonPath));
      await assertSafePath(commonRoot, ignorePath);
    }
  }

  if (state === "branch") {
    await gitIdentity(repoPath, resolved.env);
    if (targetWorktree && targetWorktree.branch !== "refs/heads/hivem1nd") {
      throw lifecycleError("PYLON_WORKTREE_CONFLICT", `${statePath} is attached to a different branch.`);
    }
    const branchWorktree = worktrees.find((worktree) => worktree.branch === "refs/heads/hivem1nd");
    if (branchWorktree && path.resolve(branchWorktree.path).toLowerCase() !== statePath.toLowerCase()) {
      throw lifecycleError("PYLON_BRANCH_IN_USE", `The hivem1nd branch is already checked out at ${branchWorktree.path}.`);
    }
    if (!targetWorktree && await pathExists(statePath)) {
      const entries = await fs.readdir(statePath);
      if (entries.length > 0) {
        throw lifecycleError("PYLON_STATE_CONFLICT", `${statePath} exists and is not the hivem1nd worktree.`);
      }
    }

    branchExists = (await git(
      ["show-ref", "--verify", "--quiet", "refs/heads/hivem1nd"],
      { allowFailure: true },
    )).ok;
    const remotes = (await git(["remote"])).stdout.split(/\r?\n/).filter(Boolean);
    remote = remotes.includes("origin") ? "origin" : remotes[0];
    if (remote) {
      const fetched = await git(["fetch", remote, "hivem1nd"], { allowFailure: true });
      if (!fetched.ok) warnings.push(`The remote state branch could not be fetched: ${fetched.stderr}`);
      const candidate = `refs/remotes/${remote}/hivem1nd`;
      if ((await git(["show-ref", "--verify", "--quiet", candidate], { allowFailure: true })).ok) {
        remoteBranch = candidate;
      }
    }
  } else if (targetWorktree) {
    throw lifecycleError("PYLON_WORKTREE_CONFLICT", `${statePath} is already a linked worktree.`);
  }

  if (!existingConfig) {
    await writeText(configPath, config, repoPath);
    created.push(configPath);
  }
  if (ignorePath && await appendUniqueLine(ignorePath, ignoreLine, path.dirname(ignorePath))) created.push(ignorePath);

  let pushed = false;
  let synced = false;
  if (state === "branch") {
    if (!targetWorktree && await pathExists(statePath)) await fs.rmdir(statePath);
    if (!branchExists && remoteBranch) {
      await git(["branch", "hivem1nd", remoteBranch]);
      branchExists = true;
    }
    if (!branchExists) {
      const emptyTree = (await runGitWithInput(repoPath, ["mktree"], "", { env: resolved.env })).stdout;
      const rootCommit = (await git(["commit-tree", emptyTree, "-m", "Initialize team state"])).stdout;
      await git(["update-ref", "refs/heads/hivem1nd", rootCommit]);
      created.push("refs/heads/hivem1nd");
    } else {
      reused = true;
    }
    if (!targetWorktree) {
      await git(["worktree", "add", statePath, "hivem1nd"]);
      created.push(statePath);
    }
    let canPush = true;
    if (remoteBranch) {
      const localCommit = (await git(["rev-parse", "refs/heads/hivem1nd"])).stdout;
      const remoteCommit = (await git(["rev-parse", remoteBranch])).stdout;
      if (localCommit !== remoteCommit) {
        const localIsAncestor = (await git(
          ["merge-base", "--is-ancestor", localCommit, remoteCommit],
          { allowFailure: true },
        )).ok;
        const remoteIsAncestor = (await git(
          ["merge-base", "--is-ancestor", remoteCommit, localCommit],
          { allowFailure: true },
        )).ok;
        if (localIsAncestor) {
          const stateStatus = await runGit(
            statePath,
            ["status", "--porcelain", "--untracked-files=normal"],
            { env: resolved.env },
          );
          if (stateStatus.stdout) {
            canPush = false;
            warnings.push("The remote state branch is newer, but the local state worktree is dirty and was left unchanged.");
          } else {
            await runGit(statePath, ["merge", "--ff-only", remoteBranch], { env: resolved.env });
            synced = true;
          }
        } else if (!remoteIsAncestor) {
          canPush = false;
          warnings.push("The local and remote state branches have diverged and require an explicit reconciliation.");
        }
      }
    }
    const keeps = [];
    await ensureStateDirectories(statePath, keeps);
    if (keeps.length > 0) {
      const stagedBefore = await runGit(
        statePath,
        ["diff", "--cached", "--quiet"],
        { allowFailure: true, env: resolved.env },
      );
      if (!stagedBefore.ok) {
        warnings.push("State directories were created but not committed because the pylon worktree already has staged changes.");
      } else {
        const relativeKeeps = keeps.map((keep) => path.relative(statePath, keep).replaceAll("\\", "/"));
        await runGit(statePath, ["add", "--", ...relativeKeeps], { env: resolved.env });
        await runGit(statePath, ["commit", "-m", "Add team state folders"], { env: resolved.env });
      }
      created.push(...keeps);
    }
    if (remote && canPush && options.push !== false) {
      const push = await git(["push", "--set-upstream", remote, "hivem1nd"], { allowFailure: true });
      if (push.ok) pushed = true;
      else warnings.push(`The hivem1nd branch was created locally but could not be pushed: ${push.stderr}`);
    }
  } else {
    await ensureStateDirectories(statePath, created);
  }

  const finalBranch = (await git(["branch", "--show-current"])).stdout;
  const finalCommit = (await git(["rev-parse", "HEAD"])).stdout;
  if (finalBranch !== initialBranch || finalCommit !== initialCommit) {
    throw lifecycleError("PYLON_BASE_CHANGED", "Pylon stopped because the code worktree branch or commit changed.");
  }
  const registered = await registerPylon({
    mindPath: resolved.mindPath,
    hostname: resolved.hostname,
    repoPath,
    environment: resolved.environment,
  });

  return {
    action: "pylon",
    repoPath,
    state,
    branch: state === "branch" ? "hivem1nd" : initialBranch,
    statePath,
    reused,
    synced,
    created,
    pushed,
    registered,
    warnings,
  };
}

async function listDirectories(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isFile() && entry.name !== ".gitkeep")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function collectScopes(userPath) {
  const scopes = [{ scope: "root", path: userPath }];
  for (const environment of await listDirectories(path.join(userPath, "envs"))) {
    scopes.push({ scope: "environment", environment, path: path.join(userPath, "envs", environment) });
  }
  for (const project of await listDirectories(path.join(userPath, "projects"))) {
    scopes.push({ scope: "project", project, path: path.join(userPath, "projects", project) });
  }
  return scopes;
}

async function readTasks(taskPath) {
  const items = [];
  for (const fileName of await listFiles(taskPath)) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(taskPath, fileName);
    const content = await readText(filePath);
    const status = headerValue(content, "status").toLowerCase();
    if (status !== "open" && status !== "done") continue;
    const fileMatch = fileName.match(/^(\d+)-(.*)\.md$/);
    items.push({
      id: headerValue(content, "id") || fileMatch?.[1] || "",
      slug: fileMatch?.[2] ?? path.basename(fileName, ".md"),
      status,
      path: filePath,
    });
  }
  items.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  return items;
}

export async function swarm(options = {}) {
  const resolved = resolveOptions(options);
  const userPath = path.join(resolved.mindPath, "user");
  await assertSafePath(resolved.mindPath, userPath, { allowMissing: false });
  const scopes = await collectScopes(userPath);
  const units = [];
  const inboxUnits = [];

  for (const scope of scopes) {
    const statePath = path.join(scope.path, "state");
    for (const fileName of await listFiles(statePath)) {
      if (!fileName.endsWith(".md")) continue;
      const filePath = path.join(statePath, fileName);
      const content = await readText(filePath);
      units.push({
        scope: scope.scope,
        ...(scope.environment ? { environment: scope.environment } : {}),
        ...(scope.project ? { project: scope.project } : {}),
        unit: headerValue(content, "unit") || path.basename(fileName, ".md"),
        state: headerValue(content, "state") || "out",
        machine: headerValue(content, "machine"),
        date: headerValue(content, "date"),
        context: bodyFirstLine(content),
        path: filePath,
      });
    }

    const inboxPath = path.join(scope.path, "inbox");
    for (const unit of await listDirectories(inboxPath)) {
      const unitPath = path.join(inboxPath, unit);
      const count = (await listFiles(unitPath)).length;
      if (count === 0) continue;
      inboxUnits.push({
        scope: scope.scope,
        ...(scope.environment ? { environment: scope.environment } : {}),
        ...(scope.project ? { project: scope.project } : {}),
        unit,
        count,
        path: unitPath,
      });
    }
  }

  const projectSummaries = [];
  let open = 0;
  let done = 0;
  for (const project of await listDirectories(path.join(userPath, "projects"))) {
    const items = await readTasks(path.join(userPath, "projects", project, "tasks"));
    const projectOpen = items.filter((item) => item.status === "open").length;
    const projectDone = items.filter((item) => item.status === "done").length;
    open += projectOpen;
    done += projectDone;
    projectSummaries.push({ project, open: projectOpen, done: projectDone, items });
  }

  units.sort((left, right) => left.unit.localeCompare(right.unit, "en"));
  inboxUnits.sort((left, right) => left.unit.localeCompare(right.unit, "en"));
  return {
    action: "swarm",
    units,
    tasks: { open, done, projects: projectSummaries },
    inboxes: {
      unread: inboxUnits.reduce((sum, inbox) => sum + inbox.count, 0),
      units: inboxUnits,
    },
  };
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function waitingWork(scopePath) {
  let unread = 0;
  for (const unit of await listDirectories(path.join(scopePath, "inbox"))) {
    unread += (await listFiles(path.join(scopePath, "inbox", unit))).length;
  }
  const open = (await readTasks(path.join(scopePath, "tasks"))).filter((item) => item.status === "open").length;
  return { unread, open };
}

async function missingAssets(resolved, record) {
  const { installableAssetRoots, listInstallableAssets } = await import("./install.mjs");
  const { loadAdapters, resolveAdapterPaths } = await import("./discovery.mjs");
  const adapters = new Map((await loadAdapters({ kitPath: resolved.kitPath })).map((adapter) => [adapter.id, adapter]));
  const { assets } = await listInstallableAssets(
    installableAssetRoots(resolved.kitPath, resolved.mindPath),
    new Set(record.excluded),
  );
  const missing = new Map();
  for (const agent of record.agents) {
    const adapter = adapters.get(agent.name);
    if (!adapter) continue;
    const { skillsRoot } = resolveAdapterPaths(adapter, { homeDir: resolved.homeDir, env: resolved.env });
    for (const asset of assets) {
      const mainPath = path.join(skillsRoot, asset.name, adapter.skills.fileName);
      if (record.managedFiles[mainPath] && await pathExists(mainPath)) continue;
      if (!missing.has(asset.name)) missing.set(asset.name, { name: asset.name, type: asset.type, agents: [] });
      missing.get(asset.name).agents.push(agent.name);
    }
  }
  return [...missing.values()];
}

function environmentNames(routes) {
  const lines = splitLines(routes);
  const bounds = sectionBounds(lines, "Environments");
  return new Set(lines.slice(bounds.start + 1, bounds.end)
    .map((line) => line.match(/^-\s+([^:]+):/)?.[1]?.trim().toLowerCase())
    .filter(Boolean));
}

export async function check(options = {}) {
  const resolved = resolveOptions(options);
  const cwd = path.resolve(resolved.cwd ?? process.cwd());
  const userPath = path.join(resolved.mindPath, "user");
  await assertSafePath(resolved.mindPath, userPath, { allowMissing: false });
  let record = null;
  try {
    const machinePath = await machineFilePath(resolved.mindPath, resolved.hostname);
    await assertSafePath(resolved.mindPath, machinePath, { allowMissing: false });
    record = parseMachineRecord(await readText(machinePath));
  } catch (error) {
    if (error.code !== "MACHINE_NOT_FOUND") throw error;
  }

  const warnings = [];
  let missing = [];
  let update = null;
  if (record) {
    missing = await missingAssets(resolved, record);
    // Recording the date keeps the network check to once a day instead of once per chat.
    const result = await checkForUpdates(resolved);
    update = {
      checked: result.checked,
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      updateAvailable: compareVersions(result.latestVersion, result.currentVersion) > 0,
    };
    warnings.push(...result.warnings);
  }

  const environments = environmentNames(await readText(path.join(userPath, "routes.md"), ""));
  const entry = (record?.paths ?? [])
    .filter((item) => item.path && !environments.has(item.name.toLowerCase()) && isInsidePath(path.resolve(item.path), cwd))
    .sort((left, right) => path.resolve(right.path).length - path.resolve(left.path).length)[0];
  const repository = entry ? null : await gitRoot(cwd);

  return {
    action: "status",
    machine: resolved.hostname,
    machineRecord: Boolean(record),
    missing,
    update,
    cwd,
    project: entry
      ? { name: entry.name, path: path.resolve(entry.path), ...await waitingWork(path.join(userPath, "projects", entry.name)) }
      : null,
    repository,
    executive: await waitingWork(userPath),
    warnings,
  };
}
