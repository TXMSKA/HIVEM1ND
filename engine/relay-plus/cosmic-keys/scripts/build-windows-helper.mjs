import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);

const root = fileURLToPath(new URL("..", import.meta.url));
const frameworks = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET");
const framework = ["Framework64", "Framework"]
  .map(folder => path.join(frameworks, folder, "v4.0.30319"))
  .find(folder => existsSync(path.join(folder, "csc.exe")));
const source = path.join(root, "helpers", "windows", "cosmic-keys.cs");
const output = path.join(root, "bin", "windows", "cosmic-keys.exe");
if (existsSync(output) && [source, fileURLToPath(import.meta.url)].every(file => statSync(file).mtimeMs <= statSync(output).mtimeMs)) process.exit(0);
if (!framework) {
  console.error("The Cosmic key helper is missing");
  process.exit(1);
}

mkdirSync(path.dirname(output), { recursive: true });
// A second process may build on first use, so only a completed executable reaches the shared path.
const temporary = path.join(path.dirname(output), `cosmic-keys.${process.pid}.${randomUUID()}.exe`);
try {
  const result = spawnSync(path.join(framework, "csc.exe"), [
    "/nologo", "/noconfig", "/optimize+", "/debug-", "/warnaserror+", "/target:exe", "/platform:anycpu", `/out:${temporary}`,
    `/reference:${path.join(framework, "System.Security.dll")}`, source,
  ], { shell: false, windowsHide: true, stdio: "ignore", timeout: 60_000 });
  if (result.error || result.status !== 0 || !existsSync(temporary)) throw new Error();
  try {
    renameSync(temporary, output);
  } catch {
    if (!existsSync(output)) throw new Error();
  }
} catch {
  console.error("The Cosmic Windows key helper did not compile.");
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true });
}
