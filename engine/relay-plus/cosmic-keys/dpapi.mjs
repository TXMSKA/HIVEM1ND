// Adapted from @txmska/cosmic 0.1.0; retain its shared-store wire format and lock protocol.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CosmicError } from "./files.mjs";

const helper = fileURLToPath(new URL("./bin/windows/cosmic-keys.exe", import.meta.url));
const build = fileURLToPath(new URL("./scripts/build-windows-helper.mjs", import.meta.url));
const cap = 64 * 1024;
let building;

export function assertSupported() {
  if (process.platform !== "win32") {
    throw new CosmicError("invalid", "The Cosmic key store is available on Windows only for now");
  }
}

function missing() {
  return new CosmicError("invalid", "The Cosmic key helper is missing");
}

async function executable() {
  assertSupported();
  if (existsSync(helper)) return helper;
  const framework = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET");
  if (!["Framework64", "Framework"].some(folder => existsSync(path.join(framework, folder, "v4.0.30319", "csc.exe")))) {
    throw missing();
  }
  // One build per process and a temporary compiler output keep simultaneous first calls from sharing a partial executable.
  if (!building) {
    building = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [build], { shell: false, windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => { child.kill(); reject(missing()); }, 65_000);
      child.on("error", () => { clearTimeout(timer); reject(missing()); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code !== 0 || !existsSync(helper)) reject(missing());
        else resolve();
      });
    }).finally(() => { building = undefined; });
  }
  await building;
  return helper;
}

function base64(text) {
  return text.length > 0 && text.length <= cap &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) &&
    Buffer.from(text, "base64").toString("base64") === text;
}

async function run(verb, text) {
  const file = await executable();
  if (!base64(text)) throw new CosmicError("invalid");
  return new Promise((resolve, reject) => {
    const input = Buffer.from(text + "\n", "ascii");
    const chunks = [];
    let size = 0, settled = false;
    const child = spawn(file, [verb], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let output;
      try {
        if (!success) throw new CosmicError("invalid");
        output = Buffer.concat(chunks);
        if (output.length < 2 || output[output.length - 1] !== 10 || output.indexOf(10) !== output.length - 1) {
          throw new CosmicError("invalid");
        }
        const answer = output.subarray(0, -1).toString("ascii");
        if (!base64(answer) || !output.subarray(0, -1).equals(Buffer.from(answer, "ascii"))) {
          throw new CosmicError("invalid");
        }
        resolve(answer);
      } catch {
        child.kill();
        reject(new CosmicError("invalid"));
      } finally {
        input.fill(0);
        output?.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    };
    const timer = setTimeout(() => finish(false), 10_000);
    child.stdout.on("data", (chunk) => {
      if (settled) { chunk.fill(0); return; }
      chunks.push(chunk);
      size += chunk.length;
      if (size > cap) finish(false);
    });
    child.on("error", () => finish(false));
    child.stdin.on("error", () => finish(false));
    child.on("close", code => finish(code === 0));
    // Values travel only through pipes because process arguments are visible to other programs.
    child.stdin.end(input);
  });
}

export async function seal(bytes) {
  assertSupported();
  return run("protect", Buffer.from(bytes).toString("base64"));
}

export async function unseal(text) {
  assertSupported();
  return Buffer.from(await run("unprotect", text), "base64");
}
