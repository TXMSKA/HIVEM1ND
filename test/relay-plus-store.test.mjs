// Reference @txmska/cosmic key-store conformance tests, run against the local implementation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { readAccountKey, removeAccountKey, writeAccountKey } from "../engine/relay-plus/cosmic-keys/index.mjs";
import { keysFile } from "../engine/relay-plus/cosmic-keys/paths.mjs";
import { CosmicError } from "../engine/relay-plus/cosmic-keys/files.mjs";
import { seal, unseal } from "../engine/relay-plus/cosmic-keys/dpapi.mjs";

async function fixture(t) {
  await fs.mkdir(path.resolve(".tmp/cosmic-keys-tests"), { recursive: true });
  const folder = await fs.mkdtemp(path.resolve(".tmp/cosmic-keys-tests/store-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return { folder, file: path.join(folder, "account.json") };
}

const windows = { skip: process.platform !== "win32" };
const invalid = (error) => error instanceof CosmicError && error.code === "invalid";
const storeAt = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

test("keys exports resolve and the store path uses the supplied root", async (t) => {
  const { folder } = await fixture(t);
  assert.equal(keysFile(folder), path.join(folder, "shared", "keys", "account.json"));
  assert.equal(typeof readAccountKey, "function");
  assert.equal(typeof writeAccountKey, "function");
  assert.equal(typeof removeAccountKey, "function");
});

test("account keys round trip without storing the raw key", windows, async (t) => {
  const { file } = await fixture(t);
  assert.equal(await readAccountKey("account", { file }), null);
  assert.equal(await removeAccountKey("account", { file }), false);
  const key = randomBytes(32);
  await writeAccountKey("account", key, { file });
  const result = await readAccountKey("account", { file });
  // Boolean assertions keep assertion diagnostics from exposing key bytes.
  assert.ok(result !== null && key.equals(result), "The account key must round trip");
  const text = await fs.readFile(file, "utf8");
  assert.ok(!text.includes(key.toString("base64")), "The store must not contain the raw base64 key");
  assert.ok(!text.includes(key.toString("hex")), "The store must not contain the raw hex key");
  assert.ok(!Buffer.from(text).includes(key), "The store must not contain raw key bytes");
  const stored = await storeAt(file);
  assert.equal(stored.version, 1);
  assert.equal(stored.accounts.account.writer, "cosmic");
  assert.equal(stored.accounts.account.origin, "cosmic");
  assert.equal(typeof stored.accounts.account.createdAt, "number");
  assert.equal(typeof stored.accounts.account.updatedAt, "number");
  assert.equal(await readAccountKey("missing", { file }), null);
  assert.equal(await removeAccountKey("missing", { file }), false);
});

test("invalid account ids and a 31-byte key are refused before writing", windows, async (t) => {
  const { file } = await fixture(t);
  await assert.rejects(writeAccountKey("account", randomBytes(31), { file }), invalid);
  for (const account of ["", "a".repeat(129), "a/b", "a b", "a\nb", "a\n", "\u00e1", "a+b"]) {
    await assert.rejects(readAccountKey(account, { file }), invalid);
    await assert.rejects(writeAccountKey(account, randomBytes(32), { file }), invalid);
    await assert.rejects(removeAccountKey(account, { file }), invalid);
  }
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});

test("account ids accept their full allowed alphabet and length", windows, async (t) => {
  const { file } = await fixture(t);
  const account = "Az09._:-" + "a".repeat(120);
  const key = randomBytes(32);
  await writeAccountKey(account, key, { file });
  const result = await readAccountKey(account, { file });
  assert.ok(result !== null && key.equals(result), "The allowed account id must round trip");
});

test("account ids that match object properties are stored as own entries", windows, async (t) => {
  const { file } = await fixture(t);
  await writeAccountKey("ordinary", randomBytes(32), { file });
  for (const account of ["__proto__", "constructor", "toString"]) {
    assert.equal(await readAccountKey(account, { file }), null);
    assert.equal(await removeAccountKey(account, { file }), false);
    const key = randomBytes(32);
    await writeAccountKey(account, key, { file });
    const result = await readAccountKey(account, { file });
    assert.ok(result !== null && key.equals(result), "An own account entry must round trip");
    assert.ok(Object.hasOwn((await storeAt(file)).accounts, account));
    assert.equal(await removeAccountKey(account, { file }), true);
    assert.equal(await readAccountKey(account, { file }), null);
  }
  assert.deepEqual(Object.keys((await storeAt(file)).accounts), ["ordinary"]);
});

test("writing and removing one account preserve the other entry byte for byte", windows, async (t) => {
  const { file } = await fixture(t);
  await writeAccountKey("untouched", randomBytes(32), { file, writer: "nebula", origin: "quantum" });
  const other = (await storeAt(file)).accounts.untouched;
  const entry = `{ "writer" : ${JSON.stringify(other.writer)}, "updatedAt":${other.updatedAt},\n "sealedK" : ${JSON.stringify(other.sealedK)}, "origin" : ${JSON.stringify(other.origin)}, "createdAt" : ${other.createdAt} }`;
  await fs.writeFile(file, `{ "version": 1, "accounts": { "untouched": ${entry} } }`);
  await writeAccountKey("changed", randomBytes(32), { file, writer: "vault" });
  let text = await fs.readFile(file, "utf8");
  assert.ok(text.includes(entry), "Other account entries must retain their original bytes");
  let stored = await storeAt(file);
  assert.deepEqual(stored.accounts.untouched, other);
  assert.equal(stored.accounts.changed.writer, "vault");
  assert.equal(stored.accounts.changed.origin, "vault");
  const createdAt = stored.accounts.changed.createdAt;
  await writeAccountKey("changed", randomBytes(32), { file, writer: "nova", origin: "recovery" });
  stored = await storeAt(file);
  assert.equal(stored.accounts.changed.createdAt, createdAt);
  assert.ok(stored.accounts.changed.updatedAt >= createdAt);
  assert.equal(stored.accounts.changed.writer, "nova");
  assert.equal(stored.accounts.changed.origin, "recovery");
  assert.equal(await removeAccountKey("changed", { file, writer: "nova" }), true);
  assert.equal(await removeAccountKey("changed", { file }), false);
  text = await fs.readFile(file, "utf8");
  assert.ok(text.includes(entry), "Removing an account must retain other entry bytes");
  stored = await storeAt(file);
  assert.deepEqual(Object.keys(stored.accounts), ["untouched"]);
  assert.deepEqual(stored.accounts.untouched, other);
});

test("malformed key stores are rejected without being replaced", windows, async (t) => {
  const { file } = await fixture(t);
  const entry = { sealedK: "AAAA", origin: "cosmic", createdAt: 1, updatedAt: 1, writer: "cosmic" };
  const serializedEntry = JSON.stringify(entry);
  for (const content of [
    "{", "null", "[]", JSON.stringify({ version: 2, accounts: {} }),
    '{"version":1,"version":1,"accounts":{}}',
    '{"version":1,"accounts":{},"accounts":{}}',
    `{"version":1,"accounts":{"account":${serializedEntry},"account":${serializedEntry}}}`,
    `{"version":1,"accounts":{"account":${serializedEntry.slice(0, -1)},"writer":"cosmic"}}}`,
    JSON.stringify({ version: 1, accounts: [] }),
    JSON.stringify({ version: 1, accounts: { account: { ...entry, sealedK: 1 } } }),
    JSON.stringify({ version: 1, accounts: { account: { ...entry, createdAt: "1" } } }),
    JSON.stringify({ version: 1, accounts: { account: { ...entry, origin: null } } }),
    JSON.stringify({ version: 1, accounts: { account: { ...entry, writer: null } } }),
    JSON.stringify({ version: 1, accounts: { account: { ...entry, updatedAt: "1" } } }),
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(readAccountKey("account", { file }), invalid);
    await assert.rejects(readAccountKey("absent", { file }), invalid);
    await assert.rejects(writeAccountKey("account", randomBytes(32), { file }), invalid);
    await assert.rejects(removeAccountKey("account", { file }), invalid);
    assert.equal(await fs.readFile(file, "utf8"), content);
  }
  const malformedUtf8 = Buffer.concat([
    Buffer.from('{"version":1,"accounts":{"account":{"sealedK":"AAAA","origin":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('","createdAt":1,"updatedAt":1,"writer":"cosmic"}}}'),
  ]);
  await fs.writeFile(file, malformedUtf8);
  await assert.rejects(readAccountKey("account", { file }), invalid);
  await assert.rejects(writeAccountKey("account", randomBytes(32), { file }), invalid);
  await assert.rejects(removeAccountKey("account", { file }), invalid);
  assert.ok((await fs.readFile(file)).equals(malformedUtf8), "Malformed UTF-8 must not be replaced");
});

test("a tampered sealed account key is invalid", windows, async (t) => {
  const { file } = await fixture(t);
  await writeAccountKey("account", randomBytes(32), { file });
  const stored = await storeAt(file);
  const sealed = stored.accounts.account.sealedK;
  stored.accounts.account.sealedK = (sealed[0] === "A" ? "B" : "A") + sealed.slice(1);
  await fs.writeFile(file, JSON.stringify(stored));
  await assert.rejects(readAccountKey("account", { file }), invalid);
});

test("a moved sealed value that unseals to the wrong length is invalid", windows, async (t) => {
  const { file } = await fixture(t);
  const stored = {
    version: 1,
    accounts: { other: { sealedK: await seal(randomBytes(31)), origin: "cosmic", createdAt: 1, updatedAt: 1, writer: "cosmic" } },
  };
  stored.accounts.account = stored.accounts.other;
  delete stored.accounts.other;
  await fs.writeFile(file, JSON.stringify(stored));
  await assert.rejects(readAccountKey("account", { file }), invalid);
});

test("two child processes retain all twenty account writes", { ...windows, timeout: 60_000 }, async (t) => {
  const { folder, file } = await fixture(t);
  const script = path.join(folder, "write-keys.mjs");
  const moduleUrl = new URL("../engine/relay-plus/cosmic-keys/index.mjs", import.meta.url).href;
  await fs.writeFile(script, `import { randomBytes } from "node:crypto";
import { writeAccountKey } from ${JSON.stringify(moduleUrl)};
const [file, writer] = process.argv.slice(2);
try {
  for (let i = 0; i < 10; i++) await writeAccountKey(writer + ":" + i, randomBytes(32), { file, writer });
} catch {
  process.exitCode = 1;
}
`);
  const write = (writer) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, file, writer], { stdio: "ignore", shell: false, windowsHide: true });
    child.once("error", () => reject(new Error("The key writer process could not start")));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("The key writer process failed")));
  });
  await Promise.all([write("nebula"), write("vault")]);
  const stored = await storeAt(file);
  assert.equal(Object.keys(stored.accounts).length, 20);
  for (const writer of ["nebula", "vault"]) {
    for (let i = 0; i < 10; i++) {
      const account = writer + ":" + i;
      assert.ok(Object.hasOwn(stored.accounts, account));
      assert.equal(stored.accounts[account].writer, writer);
      const result = await readAccountKey(account, { file });
      assert.ok(result !== null && result.length === 32, "Each written account must contain a complete key");
    }
  }
});

test("key APIs reject unsupported platforms", { skip: process.platform === "win32" }, async (t) => {
  const { file } = await fixture(t);
  const unsupported = (error) => invalid(error) && error instanceof Error &&
    error.message === "The Cosmic key store is available on Windows only for now";
  await assert.rejects(readAccountKey("account", { file }), unsupported);
  await assert.rejects(writeAccountKey("account", randomBytes(32), { file }), unsupported);
  await assert.rejects(removeAccountKey("account", { file }), unsupported);
  await assert.rejects(seal(randomBytes(32)), unsupported);
  await assert.rejects(unseal("AAAA"), unsupported);
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});

const referenceRoot = process.env.COSMIC_REFERENCE_ROOT || 'C:/Users/ttasc/Web/Cosmic';
const referenceModule = path.join(referenceRoot, 'src/keys/index.ts');
const referenceExists = await fs.stat(referenceModule).then(() => true, () => false);
test('Cosmic reference and ONEM1ND exchange DPAPI keys in both directions', {
  skip: process.platform !== 'win32' || !referenceExists,
}, async t => {
  const { file } = await fixture(t);
  const { pathToFileURL } = await import('node:url');
  const reference = await import(pathToFileURL(referenceModule).href);
  const cosmicKey = randomBytes(32), mindKey = randomBytes(32);
  await reference.writeAccountKey('cosmic-account', cosmicKey, { file, writer: 'cosmic' });
  const firstText = await fs.readFile(file, 'utf8');
  await writeAccountKey('mind-account', mindKey, { file, writer: 'onem1nd' });
  assert.ok(cosmicKey.equals(await readAccountKey('cosmic-account', { file })), 'ONEM1ND must read the Cosmic account key');
  assert.ok(mindKey.equals(await reference.readAccountKey('mind-account', { file })), 'Cosmic must read the ONEM1ND account key');
  const preserved = JSON.stringify(JSON.parse(firstText).accounts['cosmic-account']);
  assert.ok((await fs.readFile(file, 'utf8')).includes(preserved), 'Cosmic entry bytes must survive the ONEM1ND write');
  await Promise.all([
    reference.writeAccountKey('concurrent-cosmic', cosmicKey, { file, writer: 'cosmic' }),
    writeAccountKey('concurrent-mind', mindKey, { file, writer: 'onem1nd' }),
  ]);
  assert.equal(Object.keys((await storeAt(file)).accounts).length, 4);
  assert.ok(cosmicKey.equals(await readAccountKey('concurrent-cosmic', { file })));
  assert.ok(mindKey.equals(await reference.readAccountKey('concurrent-mind', { file })));
});
