import { mkdir } from "node:fs/promises";
import path from "node:path";

export const version = "0.3.0";
export const idempotent = true;

export async function migrate({ userPath }) {
  for (const directory of ["state", "inbox", "tasks", "log"]) {
    await mkdir(path.join(userPath, directory), { recursive: true });
  }
}
