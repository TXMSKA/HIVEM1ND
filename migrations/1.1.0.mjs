import { mkdir } from "node:fs/promises";
import path from "node:path";

export const version = "1.1.0";
export const idempotent = true;

export async function migrate({ userPath }) {
  await mkdir(path.join(userPath, "protocols"), { recursive: true });
}
