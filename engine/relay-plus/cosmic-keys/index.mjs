// Adapted from @txmska/cosmic 0.1.0; retain its shared-store wire format and lock protocol.
import * as fs from "node:fs/promises";
import { CosmicError, withLock, writeAtomic } from "./files.mjs";
import { keysFile } from "./paths.mjs";
import { assertSupported, seal, unseal } from "./dpapi.mjs";

export { CosmicError } from "./files.mjs";
export { keysFile } from "./paths.mjs";

const record = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validAccountId = (value) => typeof value === "string" &&
  value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9._:-]/.test(value);
const base64 = (value) => typeof value === "string" && value.length > 0 &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
  Buffer.from(value, "base64").toString("base64") === value;

function isEntry(value) {
  return record(value) && Object.keys(value).length === 5 &&
    Object.keys(value).every(key => ["sealedK", "origin", "createdAt", "updatedAt", "writer"].includes(key)) &&
    base64(value.sealedK) && typeof value.origin === "string" && typeof value.writer === "string" &&
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt);
}

function isStore(value) {
  return record(value) && Object.keys(value).length === 2 && value.version === 1 && record(value.accounts) &&
    Object.entries(value.accounts).every(([id, entry]) => validAccountId(id) && isEntry(entry));
}

// Re-serializing another app's entry would change its whitespace, escapes and numeric spelling.
// JSON.parse and the shape checks run first, so only account objects occur at depth three.
function entryTexts(text) {
  const entries = new Map();
  const fields = [];
  let depth = 0, start = 0, id = "";
  for (const token of text.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}]/g)) {
    if (token[0] === "{") {
      if (depth === 2) start = token.index;
      fields.push(new Set());
      depth++;
    } else if (token[0] === "}") {
      if (depth === 3) {
        if (entries.has(id)) throw new CosmicError("invalid");
        entries.set(id, text.slice(start, token.index + 1));
      }
      fields.pop();
      depth--;
    } else if (token[2]) {
      const name = JSON.parse(token[1]);
      if (fields[depth - 1].has(name)) throw new CosmicError("invalid");
      fields[depth - 1].add(name);
      if (depth === 2) id = name;
    }
  }
  return entries;
}

async function current(file) {
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) {
    if ((error).code === "ENOENT") return { store: { version: 1, accounts: {} }, entries: new Map() };
    throw error;
  }
  let value, text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  }
  catch { throw new CosmicError("invalid"); }
  if (!isStore(value)) throw new CosmicError("invalid");
  return { store: value, entries: entryTexts(text) };
}

function serialize(entries) {
  return '{"version":1,"accounts":{' + [...entries].map(([id, text]) => JSON.stringify(id) + ":" + text).join(",") + "}}\n";
}

export async function readAccountKey(accountId, options = {}) {
  assertSupported();
  if (!validAccountId(accountId)) throw new CosmicError("invalid");
  const { store } = await current(options.file ?? keysFile());
  if (!Object.hasOwn(store.accounts, accountId)) return null;
  const key = await unseal(store.accounts[accountId].sealedK);
  if (key.length !== 32) {
    key.fill(0);
    throw new CosmicError("invalid");
  }
  return key;
}

export async function writeAccountKey(
  accountId,
  key,
  options = {},
) {
  assertSupported();
  const writer = options.writer ?? "cosmic", origin = options.origin ?? writer;
  if (!validAccountId(accountId) || !(key instanceof Uint8Array) || key.length !== 32 ||
    typeof writer !== "string" || typeof origin !== "string") throw new CosmicError("invalid");
  // Compilation can take longer than a lock's stale interval, so sealing precedes the lock.
  const sealedK = await seal(key), file = options.file ?? keysFile();
  await withLock(file, writer, async () => {
    const { store, entries } = await current(file), now = Date.now();
    const createdAt = Object.hasOwn(store.accounts, accountId) ? store.accounts[accountId].createdAt : now;
    entries.set(accountId, JSON.stringify({ sealedK, origin, createdAt, updatedAt: now, writer }));
    await writeAtomic(file, serialize(entries));
  });
}

export async function removeAccountKey(
  accountId,
  options = {},
) {
  assertSupported();
  const writer = options.writer ?? "cosmic", file = options.file ?? keysFile();
  if (!validAccountId(accountId) || typeof writer !== "string") throw new CosmicError("invalid");
  return withLock(file, writer, async () => {
    const { entries } = await current(file);
    if (!entries.delete(accountId)) return false;
    await writeAtomic(file, serialize(entries));
    return true;
  });
}
