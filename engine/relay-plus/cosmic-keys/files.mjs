// Adapted from @txmska/cosmic 0.1.0; retain its shared-store wire format and lock protocol.
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export class CosmicError extends Error {
  code;

  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

function hasCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function unlink(file) {
  try {
    await fs.unlink(file);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, text);
    for (let retry = 0;; retry++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (error) {
        if (process.platform !== "win32" || retry >= 5 ||
          !["EPERM", "EACCES", "EBUSY"].some(code => hasCode(error, code))) throw error;
        await delay(20);
      }
    }
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

// Two waiters can judge the same lock stale at once. Renaming it aside is atomic, so only one of them removes it;
// if the renamed file is not the stale lock that was read, another waiter already replaced it, so it goes back.
async function takeOver(lock, seen) {
  const aside = lock + "." + randomUUID() + ".stale";
  try {
    await fs.rename(lock, aside);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  const moved = await fs.readFile(aside, "utf8").catch(() => seen);
  if (moved !== seen) {
    try {
      await fs.link(aside, lock);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
  await unlink(aside);
}

export async function withLock(
  file,
  writer,
  run,
  options = { staleMs: 10_000, waitMs: 5_000, pollMs: 25, now: Date.now },
) {
  const extension = path.extname(file);
  const lock = (extension ? file.slice(0, -extension.length) : file) + ".lock";
  await fs.mkdir(path.dirname(file), { recursive: true });
  const started = options.now();
  for (;;) {
    let handle;
    try {
      handle = await fs.open(lock, "wx");
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      let stale = false;
      try {
        let value, seen = "";
        try {
          seen = await fs.readFile(lock, "utf8");
          value = JSON.parse(seen);
        } catch (error) {
          if (hasCode(error, "ENOENT")) continue;
          stale = options.now() - (await fs.stat(lock)).mtimeMs > options.staleMs;
        }
        if (typeof value === "object" && value !== null && "at" in value && typeof value.at === "number") {
          stale = options.now() - value.at > options.staleMs;
        }
        if (stale) {
          await takeOver(lock, seen);
          continue;
        }
      } catch (error) {
        if (hasCode(error, "ENOENT")) continue;
        throw error;
      }
      if (options.now() - started >= options.waitMs) throw new CosmicError("locked");
      await delay(options.pollMs);
      continue;
    }
    let failed = false;
    const mine = JSON.stringify({ writer, pid: process.pid, at: options.now(), token: randomUUID() });
    try {
      try {
        await handle.writeFile(mine);
      } finally {
        await handle.close();
      }
      return await run();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        // A holder that outlived staleMs may have been taken over; it must not remove the new holder's lock.
        if (await fs.readFile(lock, "utf8").catch(() => "") === mine) await unlink(lock);
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }
}