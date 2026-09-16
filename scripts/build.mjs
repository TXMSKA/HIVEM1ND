import { mkdir, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(location));
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(location);
  }
  return files;
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Command failed: ${args[0]}`);
  return result.stdout;
}

for (const directory of ["engine", "cli", "gui", "migrations"]) {
  for (const file of await sourceFiles(path.join(root, directory))) runNode(["--check", file]);
}

for (const [directory, expected] of [["roles", 7], ["commands", 9], ["features", 11]]) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const commands = entries.filter(entry => entry.name !== "README.md" && (entry.isDirectory() || entry.name.endsWith(".md")));
  if (commands.length !== expected) throw new Error(`${directory}: expected ${expected} commands, found ${commands.length}`);
}

await mkdir(path.join(root, "dist"), { recursive: true });
const npmPath = process.env.npm_execpath;
if (!npmPath) throw new Error("Run the build with npm run build.");
const packed = JSON.parse(runNode([npmPath, "pack", "--json", "--ignore-scripts", "--pack-destination", "dist"]));
const [archive] = Array.isArray(packed) ? packed : Object.values(packed);
const included = new Set(archive.files.map(file => file.path.replaceAll("\\", "/")));
for (const required of ["cli/index.mjs", "engine/setup.mjs", "engine/lifecycle.mjs", "engine/uninstall.mjs", "gui/electron.mjs", "rules.md", "files.md", "uninstall.cmd", "roles/genesis.md", "LICENSE"]) {
  if (!included.has(required)) throw new Error(`Missing package file: ${required}`);
}
for (const name of included) {
  if (/^(user|test|dist|\.git|\.claude|\.codex|\.cursor)(\/|$)/.test(name) || /(^|\/)(AGENTS|CLAUDE|memo)\.md$/.test(name)) {
    throw new Error(`Private or development file in package: ${name}`);
  }
}
console.log(`Built ${manifest.name}@${manifest.version}: dist/${archive.filename} (${archive.files.length} files).`);
