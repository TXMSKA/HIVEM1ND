import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const version = "2.0.0-experimental.4";
export const idempotent = true;

// The Manager role is renamed Overseer. Its private records follow: the working
// folder, the root state files, the root inbox and the recipient of unread messages.
// Logs, archived messages and the text of other records stay as written.

const OLD = "manager";
const NEW = "overseer";

async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Moves every entry that has no namesake at the target and removes the source
// folder only once it is empty, so nothing is lost when both folders hold a file.
async function moveTree(source, target) {
  if (!(await exists(source))) return;
  await mkdir(target, { recursive: true });
  for (const item of await entries(source)) {
    const from = path.join(source, item.name);
    const to = path.join(target, item.name);
    if (item.isDirectory()) await moveTree(from, to);
    else if (!(await exists(to))) await rename(from, to);
  }
  if ((await entries(source)).length === 0) await rmdir(source);
}

function header(text, key) {
  const match = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

function renameUnit(text) {
  return text.replace(/^unit:[ \t]*manager(\S*)[ \t]*$/m, (line, suffix) => `unit: ${NEW}${suffix}`);
}

async function retireState(userPath, statePath) {
  const text = await readFile(statePath, "utf8");
  const unit = header(text, "unit") || path.basename(statePath, ".md");
  const date = header(text, "date").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  const stamp = date ? `${date[1]}${date[2]}${date[3]}-${date[4]}${date[5]}` : "00000000-0000";
  const logDirectory = path.join(userPath, "log");
  await mkdir(logDirectory, { recursive: true });
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
  const entry = `unit: ${unit}\ndate: ${header(text, "date")}\n\nState retired when the Manager role became Overseer.\n\n${body}\n`;
  await writeFile(path.join(logDirectory, `${stamp}-${unit}-retired.md`), entry);
  await rm(statePath, { force: true });
}

async function moveStates(userPath) {
  const directory = path.join(userPath, "state");
  for (const item of await entries(directory)) {
    if (!item.isFile()) continue;
    const match = item.name.match(/^manager(.*)\.md$/);
    if (!match) continue;
    const source = path.join(directory, item.name);
    const target = path.join(directory, `${NEW}${match[1]}.md`);
    const text = renameUnit(await readFile(source, "utf8"));
    if (await exists(target)) {
      const current = await readFile(target, "utf8");
      if (current === text) {
        await rm(source, { force: true });
        continue;
      }
      await retireState(userPath, target);
    }
    await writeFile(target, text);
    await rm(source, { force: true });
  }
}

async function readdressInbox(directory) {
  for (const item of await entries(directory)) {
    if (!item.isFile() || !item.name.endsWith(".md")) continue;
    const file = path.join(directory, item.name);
    const text = await readFile(file, "utf8");
    const next = text.replace(/^to:[ \t]*manager[ \t]*$/m, `to: ${NEW}`);
    if (next !== text) await writeFile(file, next);
  }
}

export async function migrate({ userPath }) {
  await moveTree(path.join(userPath, OLD), path.join(userPath, NEW));
  await moveStates(userPath);
  await moveTree(path.join(userPath, "inbox", OLD), path.join(userPath, "inbox", NEW));
  await readdressInbox(path.join(userPath, "inbox", NEW));
}
