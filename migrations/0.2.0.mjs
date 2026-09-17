import { mkdir } from "node:fs/promises";
import path from "node:path";

export const version = "0.2.0";
export const idempotent = true;

export async function migrate({ userPath }) {
  await mkdir(path.join(userPath, "roles"), { recursive: true });
}
