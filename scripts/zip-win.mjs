import { cp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
const stage = path.join(dist, "zip-stage");
const archive = path.join(dist, `HIVEM1ND-${manifest.version}-x64.zip`);

await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await cp(path.join(dist, "win-unpacked"), path.join(stage, "HIVEM1ND"), { recursive: true });

const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const result = spawnSync(tar, ["-a", "-cf", archive, "-C", stage, "HIVEM1ND"], { encoding: "utf8" });
await rm(stage, { recursive: true, force: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || `tar exited with ${result.status}`);
console.log(`Built dist/${path.basename(archive)}.`);
