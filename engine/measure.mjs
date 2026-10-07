import { promises as fs } from "node:fs";
import path from "node:path";

// Where a mind starts to be worth cleaning. The defaults sit above the sizes of a healthy mind
// and below the ones that make a session read pages of history before it can start.
export const PREFERENCES_MAX_BYTES = 20 * 1024;
export const BRIEF_MAX_BYTES = 15 * 1024;
export const STATE_IN_MAX_DAYS = 3;
export const MIND_FILES_MAX_BYTES = 500 * 1024 * 1024;
export const MACHINE_FILE_MAX_BYTES = 15 * 1024;
export const RELAY_HISTORY_MAX_FILES = 1000;

// The walk over the files of the mind is capped, so a very large mind cannot slow a chat down.
export const WALK_MAX_ENTRIES = 100_000;
export const WALK_MAX_MILLISECONDS = 1000;

const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
const STAT_BATCH = 256;
const DAY = 24 * 60 * 60 * 1000;

export function mindThresholds(overrides = {}) {
  return {
    preferencesBytes: PREFERENCES_MAX_BYTES,
    briefBytes: BRIEF_MAX_BYTES,
    stateInDays: STATE_IN_MAX_DAYS,
    filesBytes: MIND_FILES_MAX_BYTES,
    machineFileBytes: MACHINE_FILE_MAX_BYTES,
    relayHistoryFiles: RELAY_HISTORY_MAX_FILES,
    ...overrides,
  };
}

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function sizeOf(filePath) {
  try {
    const state = await fs.lstat(filePath);
    return state.isFile() ? state.size : null;
  } catch {
    return null;
  }
}

async function names(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function relative(mindPath, filePath) {
  return path.relative(mindPath, filePath).split(path.sep).join("/");
}

function parseStateDate(value) {
  const match = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value ?? "");
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
}

function headerValue(content, name) {
  return content.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"))?.[1]?.trim() ?? "";
}

async function stateScopes(userPath) {
  const scopes = [userPath];
  for (const group of ["envs", "projects"]) {
    for (const entry of await names(path.join(userPath, group))) {
      if (entry.isDirectory()) scopes.push(path.join(userPath, group, entry.name));
    }
  }
  return scopes;
}

// A state left `in` is stale when it is older than the threshold, or when it belongs to another
// machine that has relayed out something dated after it: that machine's sessions are over.
async function measureStates({ mindPath, userPath, hostname, now, limits }) {
  const states = [];
  for (const scope of await stateScopes(userPath)) {
    for (const entry of await names(path.join(scope, "state"))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(scope, "state", entry.name);
      try {
        const content = await fs.readFile(filePath, "utf8");
        states.push({
          path: filePath,
          state: headerValue(content, "state").toLowerCase(),
          machine: headerValue(content, "machine"),
          date: parseStateDate(headerValue(content, "date")),
          bytes: Buffer.byteLength(content),
        });
      } catch {
        // An unreadable state is left for the cleanup to find; the check does not fail on it.
      }
    }
  }

  const lastOut = new Map();
  for (const item of states) {
    if (item.state !== "out" || item.date === null || !item.machine) continue;
    const key = item.machine.toLowerCase();
    if (!lastOut.has(key) || lastOut.get(key) < item.date) lastOut.set(key, item.date);
  }
  const local = now.getTime() - now.getTimezoneOffset() * 60_000;
  const own = String(hostname).toLowerCase();
  const stale = [];
  for (const item of states) {
    if (item.state !== "in" || item.date === null) continue;
    const old = (local - item.date) / DAY > limits.stateInDays;
    const key = item.machine.toLowerCase();
    const closed = key !== "" && key !== own && lastOut.has(key) && item.date < lastOut.get(key);
    if (old || closed) stale.push({ path: relative(mindPath, item.path), bytes: item.bytes, reason: old ? "older" : "machine-out" });
  }
  return { count: states.filter((item) => item.state === "in").length, stale };
}

// Sums the files that are not records (anything but Markdown), grouped by their first folders,
// and counts the Relay history. Links are never followed.
async function walkFiles(mindPath, userPath) {
  const started = Date.now();
  const groups = new Map();
  const relay = { files: 0, bytes: 0 };
  let total = 0;
  let entries = 0;
  let truncated = false;
  const stack = [userPath];

  while (stack.length > 0) {
    const directory = stack.pop();
    const relativeDirectory = path.relative(userPath, directory).split(path.sep).filter(Boolean);
    const inRelayHistory = relativeDirectory[0] === "relay" && ["archive", "events"].includes(relativeDirectory[1]);
    const batch = [];
    for (const entry of await names(directory)) {
      entries += 1;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) stack.push(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        if (inRelayHistory) relay.files += 1;
        if (!entry.name.toLowerCase().endsWith(".md") || inRelayHistory) batch.push(path.join(directory, entry.name));
      }
    }
    const key = relativeDirectory.slice(0, 3).join("/") || ".";
    for (let index = 0; index < batch.length; index += STAT_BATCH) {
      const sizes = await Promise.all(batch.slice(index, index + STAT_BATCH).map(sizeOf));
      const sum = sizes.reduce((accumulator, size) => accumulator + (size ?? 0), 0);
      if (inRelayHistory) {
        relay.bytes += sum;
      } else {
        total += sum;
        groups.set(key, (groups.get(key) ?? 0) + sum);
      }
    }
    if (entries > WALK_MAX_ENTRIES || Date.now() - started > WALK_MAX_MILLISECONDS) {
      truncated = true;
      break;
    }
  }

  const folders = [...groups.entries()]
    .filter(([, bytes]) => bytes > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([folder, bytes]) => ({ path: `user/${folder}`.replace(/\/\.$/, ""), bytes }));
  return { bytes: total, entries, truncated, folders, relay };
}

export async function measureMind({ mindPath, hostname = "", now = new Date(), thresholds } = {}) {
  const limits = mindThresholds(thresholds);
  const userPath = path.join(mindPath, "user");
  const items = [];
  const sizes = { preferences: [], briefs: [], machines: [] };

  const globalPreferences = await sizeOf(path.join(userPath, "preferences.md"));
  if (globalPreferences !== null) sizes.preferences.push({ path: "user/preferences.md", bytes: globalPreferences });
  for (const entry of await names(path.join(userPath, "projects"))) {
    if (!entry.isDirectory()) continue;
    const project = path.join(userPath, "projects", entry.name);
    const preferences = await sizeOf(path.join(project, "preferences.md"));
    if (preferences !== null) sizes.preferences.push({ path: relative(mindPath, path.join(project, "preferences.md")), bytes: preferences });
    const brief = await sizeOf(path.join(project, "brief.md"));
    if (brief !== null) sizes.briefs.push({ path: relative(mindPath, path.join(project, "brief.md")), bytes: brief });
  }
  for (const entry of await names(path.join(userPath, "machines"))) {
    const lower = entry.name.toLowerCase();
    if (!entry.isFile() || !lower.endsWith(".md") || lower.endsWith(".report.md") || entry.name.startsWith(".")) continue;
    const bytes = await sizeOf(path.join(userPath, "machines", entry.name));
    if (bytes !== null) sizes.machines.push({ path: `user/machines/${entry.name}`, bytes });
  }

  for (const item of sizes.preferences) {
    if (item.bytes > limits.preferencesBytes) items.push({ kind: "preferences", ...item });
  }
  for (const item of sizes.briefs) {
    if (item.bytes > limits.briefBytes) items.push({ kind: "brief", ...item });
  }
  for (const item of sizes.machines) {
    if (item.bytes > limits.machineFileBytes) items.push({ kind: "machine", ...item });
  }

  const states = await measureStates({ mindPath, userPath, hostname, now, limits });
  for (const item of states.stale) items.push({ kind: "state", ...item });

  const files = await walkFiles(mindPath, userPath);
  if (files.bytes > limits.filesBytes) {
    const [largest] = files.folders;
    items.push({ kind: "files", path: largest?.path ?? "user", bytes: largest?.bytes ?? files.bytes, total: files.bytes });
  }
  if (files.relay.files > limits.relayHistoryFiles) {
    items.push({ kind: "relay", path: "user/relay", bytes: files.relay.bytes });
  }

  items.sort((left, right) => right.bytes - left.bytes);
  return {
    crossed: items.length > 0,
    count: items.length,
    largest: items[0] ? { kind: items[0].kind, path: items[0].path, bytes: items[0].bytes } : null,
    items,
    sizes: {
      preferences: sizes.preferences,
      briefs: sizes.briefs,
      machines: sizes.machines,
      states: { in: states.count, stale: states.stale.length },
      files: { bytes: files.bytes, folders: files.folders, entries: files.entries, truncated: files.truncated },
      relay: files.relay,
    },
    thresholds: limits,
  };
}
