import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIXTURE_HOME_CODE,
  FIXTURE_HOME_KEY,
  LOCAL_MACHINE,
  canonical,
  createFixtureTree,
  deterministicUuid,
  seedRecords,
  sha256,
  stableJson,
} from "./gui-data.mjs";

// Isolated GUI contract fixture. It does not import the service, CLI, or feature servers.
// The home listener is a loopback transport simulation, not a production subnet check.
// Stdin commands: advance <ms>, emit <name> <json>, disconnect, quit.

const CONTRACT = "hivem1nd-gui-v3";
const EVENTS = "hivem1nd-events-v3";
const HOST = "127.0.0.1";
const HOME_ADDRESSES = ["192.168.1.23", "192.168.1.24"];
const HOME_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DAY_MS = 86400000;
const HOME_MS = 12 * 3600_000;
const ROLES = new Set(["overseer", "adjutant", "executive", "overlord", "executor", "incubator", "genesis", "master"]);
const DESKTOP_CAPS = ["read", "chat.post", "chat.manage", "mailbox.read", "approval.answer", "grant.revoke", "task.status", "task.undo", "unit.create", "unit.connect", "session.start", "session.stop", "layout.write", "settings.write", "home.manage", "editor.read", "editor.write", "comment.write", "proposal.answer", "asset.write", "watch", "viewer.write"];
const PHONE_CAPS = ["read", "chat.post", "master.read", "approval.answer", "task.accept", "task.send-back"];
const APP_FILES = ["index.html", "main.mjs", "api.mjs", "stream.mjs", "state.mjs", "i18n.mjs", "styles.css", "components.mjs", "lists.mjs", "map-geometry.mjs", "map.mjs", "hierarchy.mjs", "chats.mjs", "inspector.mjs", "actions.mjs", "settings.mjs", "qr.mjs", "qr-render.mjs", "phone.mjs", "embed.mjs", "editors.mjs", "blueprint.mjs", "void.mjs", "markup.mjs"];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class HttpError extends Error {
  constructor(status, code, message, details = {}, retryAt = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAt = retryAt;
  }
}

class CrashError extends Error {
  constructor() {
    super("Fixture crash after data and before receipt.");
    this.crash = true;
  }
}

function clock(fx) {
  return new Date(fx.nowMs);
}

function uuid() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hashBody(body) {
  return sha256(JSON.stringify(canonical(body)));
}

function success(fx, data, requestId, eventCursor, sync = "local") {
  return {
    contract: CONTRACT,
    data,
    meta: { requestId, readAt: clock(fx).toISOString(), eventCursor, sync },
  };
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function principalHash(id) {
  return sha256(id);
}

function cursorNow(fx) {
  return `${fx.serviceId}:${fx.eventSeq}`;
}

function planCursor(fx, count) {
  return `${fx.serviceId}:${fx.eventSeq + count}`;
}

function enqueue(fx, task) {
  const run = fx.tail.then(task, task);
  fx.tail = run.then(() => undefined, () => undefined);
  return run;
}

function invalidate(fx) {
  fx.cache = null;
}

async function writeAtomic(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${uuid()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

async function hashExisting(file) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    return sha256(await readFile(file));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function listDir(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => !entry.isSymbolicLink());
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}

function relMind(mind, file) {
  return relative(mind, file).replaceAll("\\", "/");
}

function parseRecord(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const splitAt = normalized.indexOf("\n\n");
  const header = splitAt === -1 ? normalized : normalized.slice(0, splitAt);
  const body = splitAt === -1 ? "" : normalized.slice(splitAt + 2).replace(/\n$/, "");
  const fields = new Map();
  let broken = false;
  for (const line of header.split("\n")) {
    if (!line.trim()) continue;
    const index = line.indexOf(":");
    if (index <= 0) {
      broken = true;
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        value = JSON.parse(value);
      } catch {
        broken = true;
      }
    }
    fields.set(key, value);
  }
  return { fields, body, broken };
}

function field(fields, key) {
  const value = fields.get(key);
  return value === undefined || value === "" ? null : value;
}

function boolField(value, fallback = false) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function scopeOf(id) {
  const parts = String(id).split(":");
  if (parts[0] === "root") return { kind: "root", name: null };
  if (parts[0] === "env") return { kind: "environment", name: parts[1] ?? null };
  if (parts[0] === "project") return { kind: "project", name: parts[1] ?? null };
  return { kind: "root", name: null };
}

function section(body, heading) {
  const pattern = new RegExp(`(?:^|\\n)## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  return pattern.exec(body)?.[1]?.replace(/\n$/, "") ?? "";
}

function serviceSource() {
  return { kind: "service", id: "fixture", unitId: null };
}

function limits() {
  return {
    messages: { used: 0, max: 60, windowSeconds: 60 },
    messageBytes: { max: 1000000 },
    syncBytes: { used: 0, max: 50000000, windowSeconds: 3600 },
    state: "normal",
    retryAt: null,
  };
}

async function readJsonFile(file) {
  const bytes = await readFile(file);
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  return { bytes, value: JSON.parse(text), hash: sha256(bytes) };
}

function answersOf(machine, now) {
  if (machine.state !== "running" || !machine.heartbeatAt) return false;
  const beat = Date.parse(machine.heartbeatAt);
  if (!Number.isFinite(beat)) return false;
  return now - beat <= 180000 && beat - now <= 30000;
}

function activityOf(session, now) {
  if (!session.activity || !session.activityObservedAt) return null;
  const observed = Date.parse(session.activityObservedAt);
  if (!Number.isFinite(observed) || now - observed > 15 * 60_000) return null;
  return session.activity;
}

function quotaOf(session, now) {
  if (!session.quota || !session.quotaObservedAt) return session.quota ?? null;
  const observed = Date.parse(session.quotaObservedAt);
  if (!Number.isFinite(observed) || now - observed > 15 * 60_000) return null;
  return session.quota;
}

async function buildProjection(fx) {
  const user = fx.tree.user;
  const issues = [];
  const unitFiles = new Map();
  const units = [];
  const scopes = [{ kind: "root", name: null, path: user }];
  for (const entry of await listDir(join(user, "envs"))) {
    if (entry.isDirectory()) scopes.push({ kind: "environment", name: entry.name, path: join(user, "envs", entry.name) });
  }
  for (const entry of await listDir(join(user, "projects"))) {
    if (entry.isDirectory()) scopes.push({ kind: "project", name: entry.name, path: join(user, "projects", entry.name) });
  }

  for (const scope of scopes) {
    for (const entry of await listDir(join(scope.path, "state"))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = join(scope.path, "state", entry.name);
      let text;
      try {
        text = (await readFile(file)).toString("utf8");
      } catch {
        issues.push({ path: relMind(fx.tree.mind, file), code: "malformed_record", message: "The state record could not be read." });
        continue;
      }
      const parsed = parseRecord(text);
      const id = field(parsed.fields, "unit-id");
      const role = field(parsed.fields, "role");
      const state = field(parsed.fields, "state");
      const malformed = parsed.broken || !id || !ROLES.has(role) || (state !== "in" && state !== "out");
      if (!id) {
        issues.push({ path: relMind(fx.tree.mind, file), code: "malformed_record", message: "The state record could not be read." });
        continue;
      }
      if (malformed) {
        issues.push({ path: relMind(fx.tree.mind, file), code: "malformed_record", message: "The state record is malformed." });
      }
      const revision = malformed ? null : sha256(Buffer.from(text));
      unitFiles.set(id, file);
      units.push({
        id,
        unit: field(parsed.fields, "unit") ?? entry.name.replace(/\.md$/, ""),
        role: ROLES.has(role) ? role : role,
        scope: scope.kind === "root" ? { kind: "root", name: null } : { kind: scope.kind, name: scope.name },
        leadId: field(parsed.fields, "lead-id"),
        job: field(parsed.fields, "job"),
        model: field(parsed.fields, "model"),
        machine: field(parsed.fields, "machine"),
        state: state === "out" ? "out" : "in",
        context: parsed.body,
        date: field(parsed.fields, "date"),
        branch: field(parsed.fields, "branch"),
        revision,
        approvalGrants: Array.isArray(parsed.fields.get("approvals")) ? parsed.fields.get("approvals") : [],
        malformed,
        file,
      });
    }
  }
  for (const extra of units.filter((unit) => unit.role === "overseer" && unit.unit !== "overseer")) {
    issues.push({ path: relMind(fx.tree.mind, extra.file), code: "duplicate_overseer", message: "Only one Overseer is used." });
  }

  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const sessions = await loadSessions(fx, byId);
  const tasks = await loadTasks(fx, byId, issues);
  const chats = await loadChats(fx, issues);
  const mailboxes = await loadMail(fx, byId, issues);
  const approvals = await loadApprovals(fx, issues);
  const editors = await loadEditors(fx, issues);
  const machines = await loadMachines(fx);
  const waiting = buildWaiting(units, tasks, mailboxes, approvals);
  const waitingUnits = new Set(waiting.map((item) => item.unitId).filter(Boolean));
  for (const unit of units) {
    unit.sessionIds = sessions.filter((session) => session.unitId === unit.id).map((session) => session.id);
    unit.status = unit.malformed ? "unknown" : statusOf(unit, sessions, waitingUnits);
    unit.position = null;
  }
  const layout = await loadLayout(fx);
  for (const unit of units) unit.position = layout.layout.nodes[unit.id] ?? null;
  const settings = await loadSettings(fx);
  const projects = await loadProjects(fx, units);
  const squads = buildSquads(units);
  const leads = buildLeads(units);
  sortUnits(units);
  const publicUnits = units.map(publicUnit);
  return {
    units: publicUnits,
    files: { units: unitFiles, layout: join(fx.tree.user, "gui", "layout.json"), settings: join(fx.tree.user, "gui", "settings.json") },
    issues,
    sessions,
    tasks,
    chats: chats.chats,
    messages: chats.messages,
    mailboxes,
    approvals,
    editors,
    machines,
    waiting,
    layout,
    settings,
    projects,
    squads,
    leads,
    byId,
  };
}

function publicUnit(unit) {
  return {
    id: unit.id,
    unit: unit.unit,
    role: unit.role,
    scope: unit.scope,
    leadId: unit.leadId,
    job: unit.job,
    model: unit.model,
    machine: unit.machine,
    state: unit.state,
    status: unit.status,
    context: unit.context,
    date: unit.date,
    branch: unit.branch,
    revision: unit.revision,
    sessionIds: unit.sessionIds,
    approvalGrants: unit.approvalGrants,
    position: unit.position,
  };
}

function statusOf(unit, sessions, waitingUnits) {
  if (unit.state === "out") return "out";
  const live = sessions.find((session) => session.unitId === unit.id && session.state !== "stopped");
  if (live?.quota && (live.quota.exhausted === true || (typeof live.quota.remaining === "number" && live.quota.remaining <= 0))) return "quota";
  if (waitingUnits.has(unit.id)) return "waiting";
  if (live?.activity === "busy" || live?.activity === "active") return "working";
  return "idle";
}

function sortUnits(units) {
  const rank = (unit) => (unit.status === "idle" || unit.status === "out" ? 1 : 0);
  units.sort((left, right) => rank(left) - rank(right) || left.unit.localeCompare(right.unit, "en") || left.id.localeCompare(right.id, "en"));
}

function buildLeads(units) {
  const ids = new Set(units.filter((unit) => unit.role === "overseer" && unit.unit === "overseer").map((unit) => unit.id));
  for (const unit of units) if (unit.leadId) ids.add(unit.leadId);
  return [...ids].filter((id) => units.some((unit) => unit.id === id));
}

function buildSquads(units) {
  const squads = [];
  const byLead = new Map();
  for (const unit of units) {
    if (!unit.leadId || unit.malformed) continue;
    if (!byLead.has(unit.leadId)) byLead.set(unit.leadId, []);
    byLead.get(unit.leadId).push(unit);
  }
  for (const [leadId, members] of byLead) {
    const lead = units.find((unit) => unit.id === leadId);
    squads.push({
      id: `lead:${leadId}`,
      leadId,
      scope: lead?.scope ?? scopeOf(leadId),
      members: members.map((unit) => unit.id).sort(),
      rollup: rollup(members),
    });
  }
  const loose = new Map();
  for (const unit of units) {
    if (unit.leadId || unit.malformed || byLead.has(unit.id)) continue;
    const key = unit.scope.kind === "root" ? "loose:root:root" : `loose:${unit.scope.kind}:${unit.scope.name}`;
    if (!loose.has(key)) loose.set(key, []);
    loose.get(key).push(unit);
  }
  for (const [id, members] of loose) {
    squads.push({
      id,
      leadId: null,
      scope: members[0].scope,
      members: members.map((unit) => unit.id).sort(),
      rollup: rollup(members),
    });
  }
  return squads.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function rollup(units) {
  const counts = { working: 0, idle: 0, waiting: 0, out: 0, attention: 0 };
  for (const unit of units) {
    if (unit.status === "quota" || unit.status === "unknown") counts.attention += 1;
    else if (counts[unit.status] !== undefined) counts[unit.status] += 1;
  }
  return counts;
}

async function loadSessions(fx, byId) {
  const now = fx.nowMs;
  const registrations = [];
  for (const entry of await listDir(join(fx.tree.user, "relay", "sessions"))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const { value } = await readJsonFile(join(fx.tree.user, "relay", "sessions", entry.name));
      registrations.push(value);
    } catch {
      // A bad registration is ignored as an inaccessible session file.
    }
  }
  const newest = new Map();
  for (const record of registrations) {
    const current = newest.get(record.sessionId);
    if (!current || Date.parse(record.registeredAt) >= Date.parse(current.registeredAt)) newest.set(record.sessionId, record);
  }
  const statuses = new Map();
  const statusRoot = join(fx.tree.user, "relay", "session-status");
  for (const entry of await listDir(statusRoot)) {
    if (!entry.isDirectory()) continue;
    const files = (await listDir(join(statusRoot, entry.name))).filter((item) => item.isFile());
    let winner = null;
    for (const file of files) {
      try {
        const { value } = await readJsonFile(join(statusRoot, entry.name, file.name));
        if (!winner || Date.parse(value.at) >= Date.parse(winner.at)) winner = value;
      } catch {
        // Skip an unreadable status file.
      }
    }
    if (winner) statuses.set(entry.name, winner);
  }
  const policies = [];
  for (const entry of await listDir(join(fx.tree.user, "relay", "wake", "policies"))) {
    if (!entry.isFile()) continue;
    try {
      policies.push((await readJsonFile(join(fx.tree.user, "relay", "wake", "policies", entry.name))).value);
    } catch {
      // Skip an unreadable policy.
    }
  }
  return [...newest.values()].map((record) => {
    const status = statuses.get(record.sessionId);
    const policy = policies.find((item) => item.binding?.unitId === record.unitId && item.binding?.nativeSessionId === record.nativeSessionId);
    const session = {
      id: record.sessionId,
      unitId: byId.has(record.unitId) ? record.unitId : record.unitId,
      client: record.client,
      machine: record.machine,
      nativeSessionId: record.nativeSessionId,
      registeredAt: record.registeredAt,
      activity: activityOf(record, now),
      quota: quotaOf(record, now),
      wake: {
        enabled: Boolean(policy?.enabled) && !policy?.pausedReason && (policy?.unlimited === true || Date.parse(policy?.deadlineAt) > now),
        deadlineAt: policy?.deadlineAt ?? null,
        pausedReason: policy?.pausedReason ?? null,
      },
      state: status?.state ?? "registered",
    };
    return session;
  }).sort((left, right) => right.registeredAt.localeCompare(left.registeredAt) || left.id.localeCompare(right.id, "en"));
}

async function loadTasks(fx, byId, issues) {
  const tasks = [];
  const roots = [{ kind: "root", name: null, path: fx.tree.user }];
  for (const name of await names(join(fx.tree.user, "envs"))) roots.push({ kind: "environment", name, path: join(fx.tree.user, "envs", name) });
  for (const name of await names(join(fx.tree.user, "projects"))) roots.push({ kind: "project", name, path: join(fx.tree.user, "projects", name) });
  for (const scope of roots) {
    const base = scope.path;
    const scopeKind = scope.kind;
    const scopeName = scope.name;
    for (const entry of await listDir(join(base, "tasks"))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = join(base, "tasks", entry.name);
      try {
        const bytes = await readFile(file);
        const parsed = parseRecord(bytes.toString("utf8"));
        const number = String(field(parsed.fields, "id") ?? "");
        const id = field(parsed.fields, "task-id") ?? (scopeKind === "root" ? `root:${number}` : `${scope}:${number}`);
        const report = section(parsed.body, "Report");
        const toId = field(parsed.fields, "to-id") ?? resolveName(byId, field(parsed.fields, "to"), scopeKind, scopeName);
        const executor = byId.get(toId);
        const approval = /Approved for review by\s+(\S+)\s+on\s+(\S.*?)\s*$/m.exec(report);
        const approvedBy = executor?.leadId && approval && approval[1] === executor.leadId.split(":").at(-1) ? executor.leadId : null;
        const fromId = field(parsed.fields, "from-id") ?? (["master", "user"].includes(String(field(parsed.fields, "from") ?? "").toLowerCase()) ? "root:master" : null);
        const status = field(parsed.fields, "status");
        tasks.push({
          id,
          number,
          scope: { kind: scopeKind, name: scopeName },
          title: field(parsed.fields, "title") ?? section(parsed.body, "Request").split("\n")[0] ?? "",
          status,
          fromId,
          toId,
          date: field(parsed.fields, "date"),
          requirements: String(field(parsed.fields, "requirements") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
          approvedBy,
          reviewable: status === "review" && fromId === "root:master" && (!executor?.leadId || Boolean(approvedBy)),
          revision: sha256(bytes),
          request: section(parsed.body, "Request"),
          report,
          undoAvailable: false,
          file,
        });
      } catch {
        issues.push({ path: relMind(fx.tree.mind, file), code: "malformed_record", message: "The task record could not be read." });
      }
    }
  }
  return tasks;
}

async function names(directory) {
  return (await listDir(directory)).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function resolveName(byId, name, scopeKind, scopeName) {
  if (!name) return null;
  if (["master", "user"].includes(String(name).toLowerCase())) return "root:master";
  const matches = [...byId.values()].filter((unit) => unit.unit.toLowerCase() === String(name).toLowerCase());
  const local = matches.find((unit) => unit.scope.kind === scopeKind && unit.scope.name === scopeName);
  return local?.id ?? matches[0]?.id ?? null;
}

async function loadChats(fx, issues) {
  const chats = [];
  const messages = [];
  const root = join(fx.tree.user, "relay", "chats");
  for (const entry of await listDir(root)) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "chat.md");
    try {
      const bytes = await readFile(file);
      const parsed = parseRecord(bytes.toString("utf8"));
      const readIds = new Set();
      for (const receipt of await walkJson(join(root, entry.name, "read"))) {
        for (const id of receipt.messageIds ?? []) readIds.add(id);
      }
      const ownMessages = [];
      for (const child of await listDir(join(root, entry.name))) {
        if (!child.isFile() || !child.name.endsWith(".md") || child.name === "chat.md") continue;
        const messageFile = join(root, entry.name, child.name);
        const messageBytes = await readFile(messageFile);
        ownMessages.push(messageFrom(parseRecord(messageBytes.toString("utf8")), sha256(messageBytes), readIds));
      }
      ownMessages.sort(messageOrder);
      messages.push(...ownMessages.map((message) => ({ ...message, chatId: field(parsed.fields, "id") })));
      const last = ownMessages.at(-1) ?? null;
      chats.push({
        id: field(parsed.fields, "id"),
        title: field(parsed.fields, "title") ?? "",
        kind: field(parsed.fields, "kind"),
        members: parsed.fields.get("members") ?? [],
        pinned: boolField(field(parsed.fields, "pinned")),
        listed: boolField(field(parsed.fields, "listed"), true),
        createdAt: field(parsed.fields, "created"),
        revision: sha256(bytes),
        lastMessage: last ? publicMessage(last) : null,
        unread: ownMessages.filter((message) => !message.read).length,
        file,
      });
    } catch {
      issues.push({ path: relMind(fx.tree.mind, file), code: "malformed_record", message: "The chat record could not be read." });
    }
  }
  return { chats, messages };
}

function messageOrder(left, right) {
  const leftTime = left.timestamp ?? left.date ?? "";
  const rightTime = right.timestamp ?? right.date ?? "";
  return leftTime.localeCompare(rightTime) || left.id.localeCompare(right.id, "en");
}

function messageFrom(parsed, hash, readIds) {
  const id = field(parsed.fields, "id");
  const kind = field(parsed.fields, "kind") ?? "message";
  const resourceId = field(parsed.fields, "resource-id");
  return {
    id,
    fromId: field(parsed.fields, "from-id"),
    toId: field(parsed.fields, "to-id") ?? field(parsed.fields, "to"),
    machine: field(parsed.fields, "machine"),
    timestamp: field(parsed.fields, "timestamp"),
    date: field(parsed.fields, "date"),
    priority: field(parsed.fields, "priority") ?? "normal",
    subject: field(parsed.fields, "subject") ?? "",
    body: parsed.body,
    threadId: field(parsed.fields, "thread-id") ?? "",
    replyTo: field(parsed.fields, "reply-to"),
    replyRequested: boolField(field(parsed.fields, "reply-requested")),
    attachments: Array.isArray(parsed.fields.get("attachments")) ? parsed.fields.get("attachments") : [],
    kind,
    read: readIds.has(id),
    notice: resourceId ? { resourceId, key: field(parsed.fields, "notice-key") } : null,
    hash,
  };
}

async function walkJson(directory) {
  const found = [];
  for (const entry of await listDir(directory)) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walkJson(file));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        found.push((await readJsonFile(file)).value);
      } catch {
        // Skip an unreadable receipt.
      }
    }
  }
  return found;
}

async function loadMail(fx, byId, issues) {
  const boxes = new Map();
  const ensure = (unitId) => {
    if (!boxes.has(unitId)) boxes.set(unitId, { unitId, messages: [] });
    return boxes.get(unitId);
  };
  const roots = [{ unitScope: "root", path: join(fx.tree.user, "inbox"), scopeKind: "root", scopeName: null }];
  for (const name of await names(join(fx.tree.user, "projects"))) {
    roots.push({ path: join(fx.tree.user, "projects", name, "inbox"), scopeKind: "project", scopeName: name });
  }
  for (const name of await names(join(fx.tree.user, "envs"))) {
    roots.push({ path: join(fx.tree.user, "envs", name, "inbox"), scopeKind: "environment", scopeName: name });
  }
  for (const root of roots) {
    for (const entry of await listDir(root.path)) {
      if (!entry.isDirectory()) continue;
      const unitId = resolveName(byId, entry.name, root.scopeKind, root.scopeName);
      if (!unitId) continue;
      const box = ensure(unitId);
      for (const file of await listDir(join(root.path, entry.name))) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;
        const full = join(root.path, entry.name, file.name);
        try {
          const bytes = await readFile(full);
          const message = messageFrom(parseRecord(bytes.toString("utf8")), sha256(bytes), new Set());
          message.read = false;
          message.location = "inbox";
          message.file = full;
          message.fileName = file.name;
          box.messages.push(message);
        } catch {
          issues.push({ path: relMind(fx.tree.mind, full), code: "malformed_record", message: "The mailbox record could not be read." });
        }
      }
    }
  }
  const legacy = join(fx.tree.user, "relay", "archive");
  for (const entry of await listDir(legacy)) {
    if (!entry.isDirectory() || entry.name === "by-unit") continue;
    const unitId = resolveName(byId, entry.name, "root", null);
    if (!unitId) continue;
    await readArchiveDir(join(legacy, entry.name), ensure(unitId), issues, fx);
  }
  for (const entry of await listDir(join(legacy, "by-unit"))) {
    if (!entry.isDirectory()) continue;
    const unitId = Buffer.from(entry.name, "base64url").toString("utf8");
    await readArchiveDir(join(legacy, "by-unit", entry.name), ensure(unitId), issues, fx);
  }
  for (const box of boxes.values()) {
    box.unread = box.messages.filter((message) => !message.read).length;
    box.total = box.messages.length;
  }
  return [...boxes.values()];
}

async function readArchiveDir(directory, box, issues, fx) {
  for (const file of await listDir(directory)) {
    if (!file.isFile() || !file.name.endsWith(".md")) continue;
    const full = join(directory, file.name);
    try {
      const bytes = await readFile(full);
      const message = messageFrom(parseRecord(bytes.toString("utf8")), sha256(bytes), new Set());
      message.read = true;
      message.location = "archive";
      message.file = full;
      message.fileName = file.name;
      box.messages.push(message);
    } catch {
      issues.push({ path: relMind(fx.tree.mind, full), code: "malformed_record", message: "The archive record could not be read." });
    }
  }
}

async function loadApprovals(fx, issues) {
  const approvals = [];
  const root = join(fx.tree.user, "relay", "approvals");
  for (const entry of await listDir(root)) {
    if (!entry.isDirectory()) continue;
    try {
      const requestFile = await readJsonFile(join(root, entry.name, "request.json"));
      const answers = [];
      for (const answer of await listDir(join(root, entry.name, "answers"))) {
        if (answer.isFile()) answers.push(await readJsonFile(join(root, entry.name, "answers", answer.name)));
      }
      const outcomes = [];
      for (const outcome of await listDir(join(root, entry.name, "answer-results"))) {
        if (outcome.isFile()) outcomes.push((await readJsonFile(join(root, entry.name, "answer-results", outcome.name))).value);
      }
      let result = null;
      try {
        result = await readJsonFile(join(root, entry.name, "result.json"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const request = requestFile.value;
      const answerHashes = answers.map((item) => item.hash).sort();
      const revision = sha256(JSON.stringify([requestFile.hash, answerHashes, result?.hash ?? null]));
      let state = "pending";
      if (answers.length && !result) state = "answering";
      if (result) state = result.value.state;
      else if (Date.parse(request.expiresAt) <= fx.nowMs) state = "expired";
      approvals.push({
        ...request,
        state,
        revision,
        answer: answers.at(-1)?.value ?? null,
        grantId: result?.value.grantId ?? null,
        answerOutcomes: outcomes,
      });
    } catch {
      issues.push({ path: `user/relay/approvals/${entry.name}`, code: "malformed_record", message: "The approval record could not be read." });
    }
  }
  return approvals;
}

async function loadMachines(fx) {
  const clients = await readJsonFile(join(fx.local, "clients.json")).then((item) => item.value).catch(() => ({}));
  const machines = [];
  for (const entry of await listDir(join(fx.tree.user, "machines"))) {
    if (!entry.isDirectory()) continue;
    try {
      const { value } = await readJsonFile(join(fx.tree.user, "machines", entry.name, "service.json"));
      const answers = answersOf(value, fx.nowMs);
      const issues = answers ? [] : [{ path: null, code: "machine_unavailable", message: "The machine does not answer." }];
      machines.push({
        id: value.machine,
        state: value.state === "running" || value.state === "stopped" ? value.state : "unknown",
        version: value.version ?? null,
        heartbeatAt: value.heartbeatAt ?? null,
        answers,
        clients: clients[value.machine] ?? [],
        issues,
      });
    } catch {
      machines.push({
        id: entry.name, state: "unknown", version: null, heartbeatAt: null, answers: false, clients: [],
        issues: [{ path: null, code: "malformed_record", message: "The machine record could not be read." }],
      });
    }
  }
  return machines.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

async function loadLayout(fx) {
  const file = join(fx.tree.user, "gui", "layout.json");
  try {
    const { value, hash } = await readJsonFile(file);
    return { layout: value, revision: hash };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      layout: { format: "hivem1nd-layout-v1", nodes: {}, groups: {}, updatedAt: null, machine: null },
      revision: null,
    };
  }
}

async function loadSettings(fx) {
  const file = join(fx.tree.user, "gui", "settings.json");
  try {
    const { value, hash } = await readJsonFile(file);
    return { settings: value, revision: hash };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { settings: { format: "hivem1nd-settings-v1", look: "modern", language: "en" }, revision: null };
  }
}

async function loadProjects(fx, units) {
  const projects = [];
  for (const entry of await listDir(join(fx.tree.user, "projects"))) {
    if (!entry.isDirectory()) continue;
    let title = entry.name;
    let environment = null;
    try {
      const parsed = parseRecord((await readFile(join(fx.tree.user, "projects", entry.name, "brief.md"))).toString("utf8"));
      title = field(parsed.fields, "title") ?? title;
      environment = field(parsed.fields, "environment");
    } catch {
      // A project without a brief still appears.
    }
    let available = false;
    try {
      const info = await lstat(join(fx.tree.root, "repositories", entry.name));
      available = info.isDirectory();
    } catch {
      available = false;
    }
    projects.push({
      id: entry.name,
      environment,
      title,
      unitIds: units.filter((unit) => unit.scope.kind === "project" && unit.scope.name === entry.name).map((unit) => unit.id),
      available,
      product: null,
    });
  }
  return projects.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function buildWaiting(units, tasks, mailboxes, approvals) {
  const items = [];
  for (const approval of approvals) {
    if (approval.state !== "pending" && approval.state !== "answering") continue;
    items.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      unitId: approval.unitId,
      title: approval.display,
      since: approval.requestedAt,
      chatId: approval.chatId ?? null,
      approvalId: approval.id,
      taskId: null,
      messageId: null,
      blocking: true,
    });
  }
  for (const task of tasks) {
    if (!task.reviewable) continue;
    items.push({
      id: `review:${task.id}`,
      kind: "review",
      unitId: task.approvedBy ?? task.toId,
      title: task.title,
      since: task.date ?? "",
      chatId: null,
      approvalId: null,
      taskId: task.id,
      messageId: null,
      blocking: false,
    });
  }
  for (const unit of units) {
    if (unit.scope.kind === "project") continue;
    for (const match of unit.context.matchAll(/^\s*Waiting on (?:the )?(?:master|user)\s*:\s*(.*)$/gim)) {
      const title = match[1].trim();
      items.push({
        id: `question:${unit.id}:${sha256(title)}`,
        kind: "question",
        unitId: unit.id,
        title,
        since: unit.date ?? "",
        chatId: null,
        approvalId: null,
        taskId: null,
        messageId: null,
        blocking: true,
      });
    }
  }
  for (const box of mailboxes) {
    if (box.unitId !== "root:master") continue;
    for (const message of box.messages) {
      if (!message.replyRequested || message.read) continue;
      items.push({
        id: `message:${message.id}`,
        kind: "message",
        unitId: message.fromId,
        title: message.subject,
        since: message.timestamp ?? message.date ?? "",
        chatId: null,
        approvalId: null,
        taskId: null,
        messageId: message.id,
        blocking: true,
      });
    }
  }
  const seen = new Set();
  return items.filter((item) => (seen.has(item.id) ? false : seen.add(item.id))).sort((left, right) => Number(right.blocking) - Number(left.blocking) || String(right.since).localeCompare(String(left.since)) || left.id.localeCompare(right.id, "en"));
}

async function loadEditors(fx, issues) {
  let catalog = { resources: [] };
  try {
    catalog = (await readJsonFile(join(fx.tree.user, "gui", "resources.json"))).value;
  } catch (error) {
    if (error.code !== "ENOENT") issues.push({ path: "user/gui/resources.json", code: "malformed_record", message: "The editor catalog could not be read." });
  }
  const editors = [];
  for (const resource of catalog.resources ?? []) {
    const repo = join(fx.tree.root, "repositories", resource.project);
    const file = join(repo, ...resource.path.split("/"));
    const readOnly = resource.path.endsWith(".mjs");
    let revision = null;
    let document = null;
    try {
      const bytes = await readFile(file);
      revision = sha256(bytes);
      if (!readOnly) document = JSON.parse(bytes.toString("utf8"));
    } catch {
      issues.push({ path: `${resource.project}/${resource.path}`, code: "malformed_record", message: "The editor resource could not be read." });
    }
    const commentsFile = resource.kind === "void"
      ? file.replace(/\.json$/, ".comments.json")
      : join(repo, "docs", "flows", "comments", `${resource.legacyId ?? document?.id}.json`);
    let commentsRevision = null;
    let threads = [];
    let corrupt = false;
    try {
      const loaded = await readJsonFile(commentsFile);
      commentsRevision = loaded.hash;
      const nodeIds = new Set();
      if (document) collectNodeIds(document, nodeIds);
      threads = (loaded.value.threads ?? []).map((thread) => ({
        ...thread,
        place: resource.kind === "void" ? { start: thread.anchor?.start ?? 0, end: thread.anchor?.end ?? 0, exact: true } : (thread.anchor?.screen && (thread.anchor.element == null || nodeIds.has(thread.anchor.element)) ? { screenId: thread.anchor.screen, nodeId: thread.anchor.element ?? null, x: thread.anchor.point?.x ?? 0, y: thread.anchor.point?.y ?? 0 } : null),
        revision: loaded.hash,
        notifications: [],
      }));
    } catch (error) {
      if (error.code !== "ENOENT") {
        issues.push({ path: `${resource.project}/${resource.path}`, code: "corrupt_resource", message: "The comment sidecar is unreadable." });
        commentsRevision = null;
        threads = [];
        corrupt = true;
      }
    }
    let attachmentRevision = null;
    let attached = [];
    const binding = join(fx.tree.user, "relay", "editors", `${resource.id}.json`);
    try {
      const loaded = await readJsonFile(binding);
      attachmentRevision = loaded.hash;
      attached = loaded.value.attached ?? [];
    } catch (error) {
      if (error.code !== "ENOENT") attachmentRevision = null;
    }
    const title = document?.title ?? resource.legacyId ?? resource.path;
    editors.push({
      id: resource.id,
      kind: resource.kind,
      project: resource.project,
      title,
      path: resource.path,
      readOnly,
      revision,
      attached,
      openThreads: threads.filter((thread) => thread.status === "open").length,
      activity: null,
      document: readOnly ? null : document,
      legacy: readOnly ? { id: resource.legacyId, path: resource.path, reason: "conversion_required" } : null,
      attachmentRevision,
      commentsRevision,
      threads,
      corrupt,
      proposals: threads.flatMap((thread) => (thread.messages ?? []).flatMap((message) => (message.proposal ? [{ ...message.proposal, resourceId: resource.id, threadId: thread.id, commentsRevision }] : []))),
    });
  }
  return editors;
}

async function projection(fx) {
  if (fx.readGate) {
    fx.readWaits = (fx.readWaits ?? 0) + 1;
    await fx.readGate;
  }
  if (!fx.cache) fx.cache = await buildProjection(fx);
  return fx.cache;
}

function snapshotHash(items) {
  return sha256(JSON.stringify(canonical(items.map((item) => [item.id, item.revision ?? null]).sort((left, right) => left[0].localeCompare(right[0], "en")))));
}

function page(items, query, allowed, filter, issues) {
  const unknown = [...query.keys()].filter((key) => !allowed.includes(key));
  if (unknown.length) throw new HttpError(400, "invalid_query", "The query is not valid.");
  const limit = limitOf(query.get("limit"));
  const q = query.get("q");
  if (q !== undefined && q.length > 200) throw new HttpError(400, "invalid_query", "The query is not valid.");
  const filtered = q ? items.filter((item) => filter(item, q.toLowerCase())) : items;
  const snapshot = snapshotHash(items);
  const filterHash = sha256(JSON.stringify(canonical({ q: q ?? null, extra: allowed.filter((key) => !["q", "limit", "cursor"].includes(key)).map((key) => [key, query.get(key) ?? null]) })));
  const position = readCursor(query.get("cursor"), filterHash, snapshot);
  const slice = filtered.slice(position, position + limit);
  const next = position + limit < filtered.length ? Buffer.from(JSON.stringify({ contract: CONTRACT, filter: filterHash, snapshot, position: position + limit })).toString("base64url") : null;
  return { items: slice, total: filtered.length, nextCursor: next, issues };
}

function limitOf(value) {
  if (value === undefined || value === null) return 50;
  if (!/^\d+$/.test(value)) throw new HttpError(400, "invalid_query", "The query is not valid.");
  const limit = Number(value);
  if (limit < 1 || limit > 200) throw new HttpError(400, "invalid_query", "The query is not valid.");
  return limit;
}

function readCursor(raw, filterHash, snapshot) {
  if (raw === undefined || raw === null) return 0;
  if (raw.length > 1024) throw new HttpError(400, "invalid_cursor", "The page cursor is not valid.");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_cursor", "The page cursor is not valid.");
  }
  if (!parsed || parsed.contract !== CONTRACT || parsed.filter !== filterHash || !Number.isInteger(parsed.position) || parsed.position < 0) {
    throw new HttpError(400, "invalid_cursor", "The page cursor is not valid.");
  }
  if (parsed.snapshot !== snapshot) throw new HttpError(409, "cursor_expired", "The page cursor has expired.");
  return parsed.position;
}

function includes(value, q) {
  return String(value ?? "").toLowerCase().includes(q);
}

function syncState(fx) {
  const offline = fx.scenario === "offline";
  return {
    state: offline ? "error" : "idle",
    pendingChanges: 0,
    limits: limits(),
    incoming: [],
    retryAt: null,
    error: offline ? { code: "origin_unavailable", message: "The origin is not reachable." } : null,
  };
}

function homeStatus(fx) {
  if (!fx.home || fx.nowMs >= Date.parse(fx.home.expiresAt)) {
    return { enabled: false, openedAt: null, expiresAt: null, addresses: [], remainingSeconds: 0 };
  }
  return {
    enabled: true,
    openedAt: fx.home.openedAt,
    expiresAt: fx.home.expiresAt,
    addresses: fx.home.addresses,
    remainingSeconds: Math.max(0, Math.ceil((Date.parse(fx.home.expiresAt) - fx.nowMs) / 1000)),
  };
}

function viewData(fx, snap, project) {
  let units = snap.units;
  let tasks = snap.tasks;
  if (project) {
    const local = new Set(units.filter((unit) => unit.scope.kind === "project" && unit.scope.name === project).map((unit) => unit.id));
    const leads = new Set(units.filter((unit) => local.has(unit.id) && unit.leadId).map((unit) => unit.leadId));
    units = units.filter((unit) => local.has(unit.id) || leads.has(unit.id) || unit.id === "root:master" || unit.role === "overseer");
    tasks = tasks.filter((task) => task.scope.kind === "project" && task.scope.name === project);
  }
  const chats = snap.chats.filter((chat) => chat.listed);
  const counts = {
    units: units.length,
    leads: snap.leads.length,
    squads: snap.squads.length,
    projects: snap.projects.length,
    machines: snap.machines.length,
    sessions: snap.sessions.length,
    chats: chats.length,
    waiting: snap.waiting.length,
    open: snap.tasks.filter((task) => task.status === "open").length,
    review: snap.tasks.filter((task) => task.status === "review").length,
    done: snap.tasks.filter((task) => task.status === "done").length,
    closed: snap.tasks.filter((task) => task.status === "closed").length,
    unread: chats.reduce((sum, chat) => sum + chat.unread, 0) + (snap.mailboxes.find((box) => box.unitId === "root:master")?.unread ?? 0),
    issues: snap.issues.length,
  };
  return {
    mind: { version: "3.0.0", machine: LOCAL_MACHINE, project: project ?? null },
    units, leads: snap.leads, squads: snap.squads, projects: snap.projects, machines: snap.machines,
    sessions: snap.sessions, chats: chats.map(publicChat), tasks: tasks.map(publicTask), waiting: snap.waiting, counts, issues: snap.issues,
  };
}

function present(principal, data) {
  if (!data || principal?.audience !== "phone") return data;
  return JSON.parse(JSON.stringify(data), function revive(key, value) {
    if (key === "nativeSessionId") return null;
    return value;
  });
}

async function ledger(fx) {
  const file = join(fx.local, "event-ledger.json");
  try {
    return { file, value: (await readJsonFile(file)).value };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { file, value: { format: "hivem1nd-fixture-ledger-v1", records: [] } };
  }
}

async function saveLedger(fx, value) {
  await writeAtomic(join(fx.local, "event-ledger.json"), Buffer.from(stableJson(value)));
}

async function receiptFor(fx, principalId, key) {
  const memory = fx.memoryReceipts.get(principalId)?.get(key);
  if (memory) return memory;
  const file = join(fx.local, "receipts", principalHash(principalId), `${key}.json`);
  try {
    const value = (await readJsonFile(file)).value;
    if (Date.parse(value.expiresAt) <= fx.nowMs) return null;
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveReceipt(fx, principalId, key, identity, status, response) {
  const file = join(fx.local, "receipts", principalHash(principalId), `${key}.json`);
  await writeAtomic(file, Buffer.from(stableJson({
    principalHash: principalHash(principalId),
    method: identity.method,
    path: identity.path,
    bodyHash: identity.bodyHash,
    status,
    response,
    createdAt: clock(fx).toISOString(),
    expiresAt: new Date(fx.nowMs + DAY_MS).toISOString(),
  })));
}

function saveMemoryReceipt(fx, principalId, key, identity, status, response) {
  if (!fx.memoryReceipts.has(principalId)) fx.memoryReceipts.set(principalId, new Map());
  fx.memoryReceipts.get(principalId).set(key, {
    method: identity.method, path: identity.path, bodyHash: identity.bodyHash, status, response,
    createdAt: clock(fx).toISOString(), expiresAt: new Date(fx.nowMs + DAY_MS).toISOString(),
  });
}

async function saveIntent(fx, intent) {
  await writeAtomic(join(fx.local, "transactions", `${intent.id}.json`), Buffer.from(stableJson(intent)));
}

async function finishIntent(fx, intent) {
  for (const write of intent.writes) {
    const current = await hashExisting(write.path);
    if (current === write.afterRevision) continue;
    if (current !== write.beforeRevision) throw new HttpError(500, "fixture_journal_conflict", "Fixture journal conflict.");
    const bytes = Buffer.from(write.afterBytesBase64, "base64");
    if (sha256(bytes) !== write.afterRevision) throw new HttpError(500, "fixture_journal_conflict", "Fixture journal conflict.");
    await writeAtomic(write.path, bytes);
  }
  for (const removal of intent.removes ?? []) {
    const current = await hashExisting(removal.path);
    if (current === null) continue;
    if (current !== removal.beforeRevision) throw new HttpError(500, "fixture_journal_conflict", "Fixture journal conflict.");
    await rm(removal.path, { force: true });
  }
  if (faultMatches(fx, intent.identity.method, intent.identity.path) && fx.fault.crashAfterDataBeforeReceipt) {
    fx.fault = null;
    throw new CrashError();
  }
  const receiptFile = join(fx.local, "receipts", principalHash(intent.principalId), `${intent.key}.json`);
  if (await hashExisting(receiptFile) === null) {
    await writeAtomic(receiptFile, Buffer.from(stableJson({
      principalHash: principalHash(intent.principalId),
      ...intent.identity,
      status: intent.receipt.status,
      response: intent.receipt.response,
      createdAt: intent.receipt.createdAt,
      expiresAt: intent.receipt.expiresAt,
    })));
  }
  const book = await ledger(fx);
  let changed = false;
  for (const event of intent.events) {
    if (book.value.records.some((record) => record.key === event.key)) continue;
    book.value.records.push(event);
    changed = true;
  }
  if (changed) await saveLedger(fx, book.value);
  intent.phase = "committed";
  await saveIntent(fx, intent);
  invalidate(fx);
}

async function recoverIntents(fx) {
  for (const entry of await listDir(join(fx.local, "transactions"))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const intent = (await readJsonFile(join(fx.local, "transactions", entry.name))).value;
    if (intent.phase === "prepared") await finishIntent(fx, intent);
  }
}

function faultMatches(fx, method, path) {
  return Boolean(fx.fault && fx.fault.method === method && fx.fault.path === path);
}

function publish(fx, events, principal) {
  let last = cursorNow(fx);
  for (const event of events) {
    fx.eventSeq += 1;
    last = `${fx.serviceId}:${fx.eventSeq}`;
    const record = {
      id: last,
      seq: fx.eventSeq,
      name: event.name,
      envelope: {
        contract: EVENTS,
        at: clock(fx).toISOString(),
        machine: LOCAL_MACHINE,
        source: event.source ?? { kind: principal?.audience === "phone" ? "phone" : "gui", id: principal?.viewerId ?? "fixture", unitId: "root:master" },
        data: event.data,
      },
      viewerId: event.viewerId ?? null,
      unitId: event.unitId ?? event.data?.unit?.id ?? null,
      chatId: event.chatId ?? event.data?.chat?.id ?? event.data?.chatId ?? null,
      resourceId: event.resourceId ?? event.data?.resourceId ?? null,
      global: Boolean(event.global) || ["service.changed", "settings.changed", "sync.changed", "stream.reset", "home.changed"].includes(event.name),
      at: Date.now(),
    };
    fx.ring.push(record);
    const cutoff = Date.now() - 10 * 60_000;
    while (fx.ring.length > 1000 || (fx.ring[0] && fx.ring[0].at < cutoff)) fx.ring.shift();
    for (const stream of fx.streams) writeStream(stream, record);
  }
  return last;
}

function visible(stream, record) {
  if (record.viewerId && record.viewerId !== stream.principal.viewerId) return false;
  if (record.global || record.name === "stream.ready") return true;
  if (stream.filters.unitId && record.unitId && stream.filters.unitId !== record.unitId) return false;
  if (stream.filters.chatId && record.chatId && stream.filters.chatId !== record.chatId) return false;
  if (stream.filters.resourceId && record.resourceId && stream.filters.resourceId !== record.resourceId) return false;
  return true;
}

function writeStream(stream, record) {
  if (stream.closed || !visible(stream, record)) return;
  const data = stream.principal.audience === "phone" ? present(stream.principal, record.envelope) : record.envelope;
  stream.response.write(`id: ${record.id}\nevent: ${record.name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publishNewEventRecords(fx, intent, principal) {
  const fresh = intent.events.filter((event) => !fx.broadcast.has(event.key));
  for (const event of fresh) fx.broadcast.add(event.key);
  if (!fresh.length) return cursorNow(fx);
  return publish(fx, fresh.map((event) => ({
    name: event.name,
    data: event.data,
    source: event.source,
    unitId: event.unitId,
    chatId: event.chatId,
    resourceId: event.resourceId,
    global: event.global,
  })), principal);
}

async function mutate(fx, request, route, body, principal, requestId) {
  authorize(principal, route);
  route.validate(body);
  const key = String(request.headers["idempotency-key"] ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) {
    throw new HttpError(400, "invalid_body", "The idempotency key must be a lowercase UUID.");
  }
  return enqueue(fx, async () => {
    if (faultMatches(fx, request.method, route.requestPath) && fx.fault.status && !fx.fault.crashAfterDataBeforeReceipt && !fx.fault.dropAfterCommit) {
      const fault = fx.fault;
      if (fault.once !== false) fx.fault = null;
      const error = new HttpError(fault.status, fault.code, fault.message ?? "The request was rejected.", fault.details ?? {}, fault.retryAt ?? null);
      if (fault.status === 429) error.retryAfter = fault.retryAfter ?? 1;
      throw error;
    }
    const identity = { method: request.method, path: route.requestPath, bodyHash: hashBody(body) };
    const previous = await receiptFor(fx, principal.id, key);
    if (previous) {
      if (previous.method !== identity.method || previous.path !== identity.path || previous.bodyHash !== identity.bodyHash) {
        throw new HttpError(409, "idempotency_conflict", "The idempotency key was already used.");
      }
      return { status: previous.status, response: previous.response };
    }
    await route.checkPreconditions(body);
    const prepared = await route.prepare(body, principal);
    const response = prepared.status === 204 ? null : success(fx, prepared.data, requestId, planCursor(fx, prepared.events.length), prepared.sync ?? "local");
    const createdAt = clock(fx).toISOString();
    const expiresAt = new Date(fx.nowMs + DAY_MS).toISOString();
    if (route.runtime) {
      if (route.homeGrant) saveMemoryReceipt(fx, principal.id, key, identity, prepared.status, response);
      else await saveReceipt(fx, principal.id, key, identity, prepared.status, response);
      prepared.apply?.();
      publish(fx, prepared.events, principal);
    } else {
      const intent = {
        id: uuid(),
        principalId: principal.id,
        key,
        identity,
        writes: prepared.writes,
        removes: prepared.removes ?? [],
        receipt: { status: prepared.status, response, createdAt, expiresAt },
        events: prepared.events.map((event, index) => ({
          key: `${intentIdPlaceholder(index)}`,
          name: event.name,
          data: event.data,
          source: event.source ?? null,
          unitId: event.unitId ?? null,
          chatId: event.chatId ?? null,
          resourceId: event.resourceId ?? null,
          global: Boolean(event.global),
        })),
        phase: "prepared",
      };
      const transactionId = intent.id;
      intent.events = intent.events.map((event, index) => ({ ...event, key: `${transactionId}:${index}` }));
      await saveIntent(fx, intent);
      await finishIntent(fx, intent);
      publishNewEventRecords(fx, intent, principal);
    }
    const dropped = faultMatches(fx, request.method, route.requestPath) && fx.fault?.dropAfterCommit;
    if (dropped) fx.fault = null;
    return { status: prepared.status, response, drop: Boolean(dropped) };
  });
}

function intentIdPlaceholder() {
  return "pending";
}

function authorize(principal, route) {
  const names = [route.capability, ...(route.allow ?? [])].filter(Boolean);
  if (names.length && !names.some((name) => principal.capabilities.includes(name))) {
    if (principal.audience === "phone") throw new HttpError(403, "phone_read_only", "The phone cannot change this.");
    throw new HttpError(403, "forbidden", "This credential cannot do that.");
  }
  if (principal.audience === "phone" && route.mailboxUnit && route.mailboxUnit !== "root:master" && route.pattern === "/mailboxes/:unitId/read") {
    throw new HttpError(403, "phone_read_only", "The phone can acknowledge only the person's mailbox.");
  }
}

function requireObject(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(422, "invalid_body", "The request body is not valid.");
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw new HttpError(400, "unknown_field", "The request contains an unknown field.");
  }
}

function requireKeys(body, keys) {
  for (const key of keys) if (!(key in body)) throw new HttpError(422, "invalid_body", "The request body is not valid.");
}

function revisionField(value) {
  if (value === null) return;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new HttpError(422, "invalid_body", "The revision is not valid.");
}

function coordinate(value, key) {
  if (!value || typeof value !== "object" || Object.keys(value).some((item) => !["x", "y"].includes(item))) {
    throw new HttpError(422, "invalid_body", "The position is not valid.");
  }
  for (const axis of ["x", "y"]) {
    if (typeof value[axis] !== "number" || !Number.isFinite(value[axis]) || value[axis] < -100000 || value[axis] > 100000) {
      throw new HttpError(422, "invalid_body", `The ${key} position is not valid.`);
    }
  }
}

function validateLayout(body) {
  requireObject(body, ["nodes", "groups", "expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  revisionField(body.expectedRevision);
  if (!body.nodes && !body.groups) throw new HttpError(422, "invalid_body", "A layout change is required.");
  if (body.nodes) {
    if (typeof body.nodes !== "object" || Array.isArray(body.nodes)) throw new HttpError(422, "invalid_body", "The layout change is not valid.");
    for (const position of Object.values(body.nodes)) coordinate(position, "node");
  }
  if (body.groups) {
    if (typeof body.groups !== "object" || Array.isArray(body.groups)) throw new HttpError(422, "invalid_body", "The layout change is not valid.");
    for (const [id, group] of Object.entries(body.groups)) {
      if (!/^(project|env):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new HttpError(422, "invalid_body", "The group is not valid.");
      coordinate(group, "group");
      if (typeof group.collapsed !== "boolean" || Object.keys(group).some((key) => !["x", "y", "collapsed"].includes(key))) {
        throw new HttpError(422, "invalid_body", "The group is not valid.");
      }
    }
  }
}

async function prepareSettings(fx, body) {
  const current = await loadSettings(fx);
  const next = { ...current.settings, format: "hivem1nd-settings-v1" };
  if (body.look) next.look = body.look;
  if (body.language) next.language = body.language;
  const bytes = Buffer.from(stableJson(next));
  const afterRevision = sha256(bytes);
  return {
    status: 200,
    data: { settings: next, revision: afterRevision },
    writes: [{ path: join(fx.tree.user, "gui", "settings.json"), beforeRevision: current.revision, afterRevision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "settings.changed", global: true, data: { settings: next, revision: afterRevision } }],
  };
}

function prepareHomeNetwork(fx, body, principal) {
  if (body.enabled === false) {
    const wasOpen = Boolean(fx.home);
    const home = { enabled: false, openedAt: null, expiresAt: null, addresses: [], remainingSeconds: 0 };
    return {
      status: 200,
      data: home,
      events: wasOpen ? [{ name: "home.changed", global: true, data: { home, reason: "closed" } }] : [],
      apply() {
        fx.home = null;
        revokeAudience(fx, "phone");
      },
    };
  }
  const selected = selectedHomeAddresses(body.addresses);
  if (fx.scenario === "home-bind-failure") {
    fx.home = null;
    revokeAudience(fx, "phone");
    publish(fx, [{ name: "home.changed", global: true, data: { home: homeStatus(fx), reason: "closed" } }], principal);
    throw new HttpError(503, "listener_unavailable", "The home listener is unavailable.");
  }
  const replacing = Boolean(fx.home);
  const duration = fx.scenario === "home-expiry" ? 1000 : HOME_MS;
  const openedAt = clock(fx).toISOString();
  const expiresAt = new Date(fx.nowMs + duration).toISOString();
  const key = randomBytes(32).toString("base64url");
  const code = homeCode();
  const port = fx.homeListener.port;
  const addresses = selected.map((address) => ({ origin: `http://${address}:${port}` }));
  const links = selected.map((address) => `http://${address}:${port}/#home=${key}`);
  const home = { enabled: true, openedAt, expiresAt, addresses, remainingSeconds: Math.ceil(duration / 1000) };
  return {
    status: 201,
    data: { ...home, key, shortCode: code, links, qrPayloads: links.slice() },
    events: [{ name: "home.changed", global: true, data: { home, reason: replacing ? "replaced" : "opened" } }],
    apply() {
      revokeAudience(fx, "phone");
      fx.home = { key, code, openedAt, expiresAt, addresses };
    },
  };
}

function selectedHomeAddresses(input) {
  if (input === undefined) return [HOME_ADDRESSES[0]];
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(422, "invalid_home_address", "The home address is not valid.");
  const seen = new Set();
  for (const address of input) {
    if (typeof address !== "string" || !HOME_ADDRESSES.includes(address) || seen.has(address)) {
      throw new HttpError(422, "invalid_home_address", "The home address is not valid.");
    }
    seen.add(address);
  }
  return input;
}

function homeCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += HOME_CODE_ALPHABET[randomInt(HOME_CODE_ALPHABET.length)];
  return code;
}

async function prepareLayout(fx, body) {
  const current = await loadLayout(fx);
  const next = structuredClone(current.layout);
  next.format = "hivem1nd-layout-v1";
  next.nodes ??= {};
  next.groups ??= {};
  const snap = await projection(fx);
  if (body.nodes) {
    for (const [id, position] of Object.entries(body.nodes)) {
      const unit = snap.units.find((item) => item.id === id);
      if (!unit || unit.revision === null) throw new HttpError(422, "unknown_unit", "The unit is unknown.");
      next.nodes[id] = { x: position.x, y: position.y };
    }
  }
  if (body.groups) {
    for (const [id, group] of Object.entries(body.groups)) next.groups[id] = { x: group.x, y: group.y, collapsed: group.collapsed };
  }
  next.updatedAt = clock(fx).toISOString();
  next.machine = LOCAL_MACHINE;
  const bytes = Buffer.from(stableJson(next));
  const afterRevision = sha256(bytes);
  return {
    status: 200,
    data: { layout: next, revision: afterRevision },
    writes: [{ path: join(fx.tree.user, "gui", "layout.json"), beforeRevision: current.revision, afterRevision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "layout.changed", global: true, data: { layout: next, revision: afterRevision } }],
  };
}

function validateMessage(body) {
  requireObject(body, ["body", "subject", "replyTo", "attachments", "priority", "replyRequested"]);
  requireKeys(body, ["body"]);
  if (typeof body.body !== "string") throw new HttpError(422, "invalid_body", "The message body is not valid.");
}

function validateRead(body) {
  requireObject(body, ["messageIds"]);
  requireKeys(body, ["messageIds"]);
  if (!Array.isArray(body.messageIds) || body.messageIds.length > 200 || body.messageIds.some((id) => typeof id !== "string")) {
    throw new HttpError(422, "invalid_body", "The message list is not valid.");
  }
}

async function prepareChatPost(fx, body, principal, chatId) {
  const snap = await projection(fx);
  const chat = snap.chats.find((item) => item.id === chatId);
  if (!chat) throw new HttpError(404, "chat_not_found", "The chat was not found.");
  if (!chat.members.includes(principal.unitId)) throw new HttpError(403, "not_chat_member", "The sender is not a member of the chat.");
  const id = uuid();
  const now = clock(fx).toISOString();
  const document = markdownMessage({
    id, from: "master", "from-id": principal.unitId, to: `chat:${chatId}`, "to-id": `chat:${chatId}`,
    machine: LOCAL_MACHINE, timestamp: now, priority: body.priority ?? "normal", subject: body.subject ?? "",
    "thread-id": chatId, "reply-to": body.replyTo ?? null, "reply-requested": "false", attachments: body.attachments ?? [], kind: "message",
  }, body.body);
  const bytes = Buffer.from(document);
  const writes = [{ path: join(fx.tree.user, "relay", "chats", chatId, `${id}.md`), beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") }];
  const message = {
    id, fromId: principal.unitId, toId: `chat:${chatId}`, machine: LOCAL_MACHINE, timestamp: now, date: null,
    priority: body.priority ?? "normal", subject: body.subject ?? "", body: body.body, threadId: chatId,
    replyTo: body.replyTo ?? null, replyRequested: false, attachments: body.attachments ?? [], kind: "message", read: false, notice: null,
  };
  return {
    status: 201,
    data: {
      message,
      notifications: chat.members.filter((unitId) => unitId !== principal.unitId).map((unitId) => ({
        unitId,
        state: fx.noticeFailure === unitId ? "failed" : "pending",
      })),
    },
    writes,
    events: [{ name: "message.created", chatId, data: { chatId, mailboxId: null, message } }],
  };
}

function markdownMessage(fields, body) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(canonical(value))}`);
  }
  return `${lines.join("\n")}\n\n${body.replace(/\n$/, "")}\n`;
}

async function prepareChatRead(fx, body, principal, chatId) {
  const snap = await projection(fx);
  const chat = snap.chats.find((item) => item.id === chatId);
  if (!chat) throw new HttpError(404, "chat_not_found", "The chat was not found.");
  const known = new Set(snap.messages.filter((message) => message.chatId === chatId).map((message) => message.id));
  if (body.messageIds.some((id) => !known.has(id))) throw new HttpError(422, "invalid_body", "A message was not found in the chat.");
  const receiptId = uuid();
  const record = {
    format: "hivem1nd-chat-read-v1", chatId, unitId: principal.unitId, machine: LOCAL_MACHINE,
    messageIds: body.messageIds, at: clock(fx).toISOString(),
  };
  const bytes = Buffer.from(stableJson(record));
  const encoded = Buffer.from(principal.unitId).toString("base64url");
  const unread = snap.messages.filter((message) => message.chatId === chatId && !message.read && !body.messageIds.includes(message.id)).length;
  return {
    status: 200,
    data: { chatId, readIds: body.messageIds, unread },
    writes: [{
      path: join(fx.tree.user, "relay", "chats", chatId, "read", encoded, LOCAL_MACHINE, `${receiptId}.json`),
      beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64"),
    }],
    events: body.messageIds.length ? [{ name: "message.read", chatId, data: { chatId, mailboxId: null, readerId: principal.unitId, messageIds: body.messageIds, unread } }] : [],
  };
}

async function prepareMailboxRead(fx, body, unitId) {
  const snap = await projection(fx);
  const box = snap.mailboxes.find((item) => item.unitId === unitId);
  const messages = box?.messages ?? [];
  if (body.messageIds.some((id) => !messages.some((message) => message.id === id))) {
    throw new HttpError(404, "message_not_found", "The message was not found.");
  }
  const writes = [];
  const removes = [];
  const readIds = [];
  const alreadyReadIds = [];
  for (const id of body.messageIds) {
    const message = messages.find((item) => item.id === id);
    if (message.read) {
      alreadyReadIds.push(id);
      continue;
    }
    const archiveDir = unitId === "root:master"
      ? join(fx.tree.user, "relay", "archive", "master")
      : join(fx.tree.user, "relay", "archive", "by-unit", Buffer.from(unitId).toString("base64url"));
    const target = join(archiveDir, message.fileName);
    const existing = await hashExisting(target);
    if (existing && existing !== message.hash) throw new HttpError(409, "archive_collision", "The archived copy differs.");
    if (!existing) {
      const bytes = await readFile(message.file);
      writes.push({ path: target, beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") });
    }
    removes.push({ path: message.file, beforeRevision: message.hash });
    readIds.push(id);
  }
  return {
    status: 200,
    data: { unitId, readIds, alreadyReadIds },
    writes,
    removes,
    events: readIds.length ? [{ name: "message.read", data: { chatId: null, mailboxId: unitId, readerId: "root:master", messageIds: readIds, unread: (box?.unread ?? 0) - readIds.length } }] : [],
  };
}

function queryMap(url) {
  const map = new Map();
  for (const key of url.searchParams.keys()) {
    if (map.has(key)) throw new HttpError(400, "invalid_query", "The query is not valid.");
    map.set(key, url.searchParams.get(key));
  }
  return map;
}

function noneQuery(query) {
  if (query.size) throw new HttpError(400, "invalid_query", "The query is not valid.");
}

function matchPath(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(":")) {
      let value = actual[index];
      try {
        value = decodeURIComponent(value);
      } catch {
        return null;
      }
      if (value.includes("/") || value.includes("\\") || value.includes("\0")) return null;
      params[expected[index].slice(1)] = value;
    }
    else if (expected[index] !== actual[index]) return null;
  }
  return params;
}

function routeTable() {
  return [
    { pattern: "/view", GET: { query: ["project"] } },
    { pattern: "/units", GET: { query: ["q", "limit", "cursor", "project", "machine", "leadId", "status"] } },
    { pattern: "/units", POST: { capability: "unit.create", validate: validateUnit } },
    { pattern: "/units/:unitId", GET: { query: [] } },
    { pattern: "/units/:unitId/lead", PUT: { capability: "unit.connect", validate: validateLead } },
    { pattern: "/units/:unitId/session", POST: { capability: "session.start", validate: validateSession, runtime: true } },
    { pattern: "/session-requests/:requestId", GET: { query: [] } },
    { pattern: "/sessions/:sessionId/stop", POST: { capability: "session.stop", validate: validateStop, runtime: true } },
    { pattern: "/leads", GET: { query: ["q", "limit", "cursor", "project"] } },
    { pattern: "/squads", GET: { query: ["q", "limit", "cursor", "project", "leadId"] } },
    { pattern: "/projects", GET: { query: ["q", "limit", "cursor"] } },
    { pattern: "/machines", GET: { query: ["q", "limit", "cursor"] } },
    { pattern: "/sessions", GET: { query: ["q", "limit", "cursor", "unitId", "machine", "state"] } },
    { pattern: "/sync", GET: { query: [] } },
    { pattern: "/layout", GET: { query: [] }, PATCH: { capability: "layout.write", validate: validateLayout } },
    { pattern: "/chats", GET: { query: ["q", "limit", "cursor", "unitId", "listed", "pinned"] }, POST: { capability: "chat.manage", validate: validateChat } },
    { pattern: "/chats/:chatId", PATCH: { capability: "chat.manage", validate: validateChatPatch } },
    { pattern: "/chats/:chatId", GET: { query: [] } },
    { pattern: "/chats/:chatId/messages", GET: { query: ["q", "limit", "cursor", "before"] }, POST: { capability: "chat.post", validate: validateMessage } },
    { pattern: "/chats/:chatId/read", POST: { capability: "master.read", allow: ["read", "master.read"], validate: validateRead } },
    { pattern: "/mailboxes", GET: { query: ["q", "limit", "cursor"] } },
    { pattern: "/mailboxes/:unitId/messages", GET: { query: ["q", "limit", "cursor", "state"] }, POST: { capability: "chat.post", validate: validateMessage } },
    { pattern: "/mailboxes/:unitId/messages/:messageId", GET: { query: [] } },
    { pattern: "/mailboxes/:unitId/read", POST: { capability: "mailbox.read", allow: ["mailbox.read", "master.read"], validate: validateRead } },
    { pattern: "/approvals", GET: { query: ["q", "limit", "cursor", "unitId", "state"] } },
    { pattern: "/approvals/:approvalId", GET: { query: [] } },
    { pattern: "/approvals/:approvalId/answers/:answerId", GET: { query: [] } },
    { pattern: "/units/:unitId/approval-grants", GET: { query: ["q", "limit", "cursor"] } },
    { pattern: "/tasks", GET: { query: ["q", "limit", "cursor", "project", "unitId", "status"] } },
    { pattern: "/tasks/:taskId", GET: { query: [] } },
    { pattern: "/tasks/:taskId/status", POST: { capability: "task.status", allow: ["task.accept", "task.send-back"], validate: validateTaskStatus } },
    { pattern: "/tasks/:taskId/undo", POST: { capability: "task.undo", validate: validateUndo } },
    { pattern: "/approvals/:approvalId/answer", POST: { capability: "approval.answer", validate: validateAnswer } },
    { pattern: "/units/:unitId/approval-grants/:grantId", DELETE: { capability: "grant.revoke", validate: validateRevoke } },
    { pattern: "/grant-revocations/:requestId", GET: { query: [] } },
    { pattern: "/waiting", GET: { query: ["q", "limit", "cursor", "unitId", "kind"] } },
    { pattern: "/settings", GET: { query: [] }, PATCH: { capability: "settings.write", validate: validateSettings } },
    { pattern: "/settings/home-network", POST: { capability: "home.manage", validate: validateHome, runtime: true } },
    { pattern: "/viewer", GET: { capability: "viewer.write", query: [] }, PATCH: { capability: "viewer.write", validate: validateViewer, runtime: true } },
    { pattern: "/editors/register", POST: { capability: "editor.write", validate: validateRegister } },
    { pattern: "/blueprint/boards", GET: { query: ["q", "limit", "cursor", "project"] }, POST: { capability: "editor.write", validate: validateBoard } },
    { pattern: "/blueprint/boards/:resourceId", GET: { query: [] }, PUT: { capability: "editor.write", validate: validateBoardPut } },
    { pattern: "/blueprint/boards/:resourceId/nodes", POST: { capability: "editor.write", validate: validateAddNode } },
    { pattern: "/blueprint/boards/:resourceId/nodes/:nodeId", PATCH: { capability: "editor.write", validate: validatePatchNode } },
    { pattern: "/blueprint/boards/:resourceId/nodes/:nodeId", DELETE: { capability: "editor.write", validate: validateDeleteNode } },
    { pattern: "/void/texts", GET: { query: ["q", "limit", "cursor", "project"] }, POST: { capability: "editor.write", validate: validateText } },
    { pattern: "/void/texts/:resourceId", GET: { query: [] }, PUT: { capability: "editor.write", validate: validateTextPut } },
    { pattern: "/void/texts/:resourceId/ranges", POST: { capability: "editor.write", validate: validateRange } },
    { pattern: "/void/texts/:resourceId/proposals/:proposalId/answer", POST: { capability: "proposal.answer", validate: validateProposalAnswer } },
    { pattern: "/void/texts/:resourceId/proposals", GET: { query: ["q", "limit", "cursor", "state"] } },
    { pattern: "/editors/:resourceId/attachments", GET: { query: [] } },
    { pattern: "/editors/:resourceId/comments", GET: { query: ["q", "limit", "cursor", "status"] }, POST: { capability: "comment.write", validate: validateComment } },
    { pattern: "/editors/:resourceId/comments/:threadId/replies", POST: { capability: "comment.write", validate: validateReply } },
    { pattern: "/editors/:resourceId/comments/:threadId", PATCH: { capability: "comment.write", validate: validateThread } },
    { pattern: "/editors/:resourceId/attachments", GET: { query: [] }, PUT: { capability: "editor.write", validate: validateAttachments } },
    { pattern: "/watch", POST: { capability: "watch", validate: validateWatch, runtime: true } },
    { pattern: "/watch/:watchId", DELETE: { capability: "watch", validate: validateEmpty, runtime: true } },
    { pattern: "/editors/:resourceId/assets", POST: { capability: "asset.write", validate: validateAsset } },
    { pattern: "/editors/:resourceId/assets/:assetId", GET: { query: [] } },
    { pattern: "/events", GET: { query: ["unitId", "chatId", "resourceId"] } },
    { pattern: "/auth/logout", POST: { capability: "read", validate: validateEmpty, runtime: true } },
  ];
}

function validateEmpty(body) {
  requireObject(body, []);
}

function validateSettings(body) {
  requireObject(body, ["look", "language", "expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  if (!("look" in body) && !("language" in body)) throw new HttpError(422, "invalid_body", "The request body is not valid.");
  if ("look" in body && !["modern", "high-contrast"].includes(body.look)) throw new HttpError(422, "invalid_body", "The request body is not valid.");
  if ("language" in body && !["en", "es"].includes(body.language)) throw new HttpError(422, "invalid_body", "The request body is not valid.");
  revisionField(body.expectedRevision);
}

function validateHome(body) {
  requireObject(body, ["enabled", "addresses"]);
  requireKeys(body, ["enabled"]);
  if (typeof body.enabled !== "boolean") throw new HttpError(422, "invalid_body", "The request body is not valid.");
  if (body.enabled === false && "addresses" in body) throw new HttpError(400, "unknown_field", "The request contains an unknown field.");
  if (body.enabled === true && "addresses" in body && !Array.isArray(body.addresses)) throw new HttpError(422, "invalid_home_address", "The home address is not valid.");
}

function capabilityAllows(principal, route) {
  if (!route.capability) return principal.capabilities.includes("read");
  if (principal.capabilities.includes(route.capability)) return true;
  return (route.allow ?? []).some((item) => principal.capabilities.includes(item));
}

async function handleRead(fx, principal, spec, params, query, requestId) {
  if (!capabilityAllows(principal, spec)) {
    if (principal.audience === "phone") throw new HttpError(403, "phone_read_only", "The phone cannot change this.");
    throw new HttpError(403, "forbidden", "This credential cannot do that.");
  }
  const cursor = cursorNow(fx);
  const snap = await projection(fx);
  spec.principal = principal;
  const data = await readData(fx, snap, spec, params, query);
  return success(fx, present(principal, data), requestId, cursor);
}

async function readData(fx, snap, spec, params, query) {
  const pattern = spec.pattern;
  if (pattern === "/view") {
    if ([...query.keys()].some((key) => key !== "project")) throw new HttpError(400, "invalid_query", "The query is not valid.");
    const data = viewData(fx, snap, query.get("project") ?? null);
    if (Buffer.byteLength(JSON.stringify(data)) > 16_000_000) throw new HttpError(413, "view_too_large", "The view is too large. Request each collection instead.");
    return data;
  }
  if (pattern === "/units") {
    return page(filterUnits(snap.units, query), query, spec.GET.query, (unit, q) => includes(unit.unit, q) || includes(unit.job, q) || includes(unit.context, q), snap.issues.filter((issue) => issue.path?.includes("/state/")));
  }
  if (pattern === "/units/:unitId") {
    noneQuery(query);
    const unit = snap.units.find((item) => item.id === params.unitId);
    if (!unit) throw new HttpError(404, "unit_not_found", "The unit was not found.");
    return unit;
  }
  if (pattern === "/leads") {
    const leads = snap.units.filter((unit) => snap.leads.includes(unit.id));
    const project = query.get("project");
    const filtered = project ? leads.filter((unit) => unit.scope.name === project || unit.scope.kind !== "project") : leads;
    return page(filtered, query, spec.GET.query, (unit, q) => includes(unit.unit, q) || includes(unit.job, q), []);
  }
  if (pattern === "/squads") return page(snap.squads.filter((squad) => (!query.get("project") || squad.scope.name === query.get("project")) && (!query.get("leadId") || squad.leadId === query.get("leadId"))), query, spec.GET.query, (squad, q) => includes(squad.id, q), []);
  if (pattern === "/projects") return page(snap.projects, query, spec.GET.query, (project, q) => includes(project.id, q) || includes(project.title, q), []);
  if (pattern === "/machines") return page(snap.machines, query, spec.GET.query, (machine, q) => includes(machine.id, q), []);
  if (pattern === "/sessions") {
    const items = snap.sessions.filter((session) => (!query.get("unitId") || session.unitId === query.get("unitId")) && (!query.get("machine") || session.machine === query.get("machine")) && (!query.get("state") || session.state === query.get("state")));
    return page(items, query, spec.GET.query, (session, q) => includes(session.unitId, q) || includes(session.client, q) || includes(session.machine, q), []);
  }
  if (pattern === "/sync") {
    noneQuery(query);
    return syncState(fx);
  }
  if (pattern === "/layout") {
    noneQuery(query);
    return snap.layout;
  }
  if (pattern === "/session-requests/:requestId") {
    noneQuery(query);
    const record = fx.sessionRequests?.get(params.requestId);
    if (!record) throw new HttpError(404, "request_not_found", "The session request was not found.");
    return { ...record };
  }
  if (pattern === "/chats") {
    let items = snap.chats;
    const listed = query.get("listed");
    if (listed !== undefined && listed !== "true" && listed !== "false") throw new HttpError(400, "invalid_query", "The query is not valid.");
    items = items.filter((chat) => chat.listed === (listed === undefined ? true : listed === "true"));
    if (query.get("pinned") !== undefined) items = items.filter((chat) => chat.pinned === (query.get("pinned") === "true"));
    if (query.get("unitId")) items = items.filter((chat) => chat.members.includes(query.get("unitId")));
    items = [...items].sort((left, right) => Number(right.pinned) - Number(left.pinned) || String(right.lastMessage?.timestamp ?? "").localeCompare(String(left.lastMessage?.timestamp ?? "")) || left.id.localeCompare(right.id, "en"));
    return page(items.map(publicChat), query, spec.GET.query, (chat, q) => includes(chat.title, q) || chat.members.some((id) => includes(id, q)), []);
  }
  if (pattern === "/chats/:chatId") {
    noneQuery(query);
    const chat = snap.chats.find((item) => item.id === params.chatId);
    if (!chat) throw new HttpError(404, "chat_not_found", "The chat was not found.");
    return publicChat(chat);
  }
  if (pattern === "/chats/:chatId/messages" && spec.method === "GET") return messagePage(snap, params.chatId, query, spec.GET.query);
  if (pattern === "/mailboxes") {
    const items = snap.mailboxes.map((box) => ({ id: box.unitId, unitId: box.unitId, unread: box.unread, total: box.total })).sort((left, right) => left.unitId.localeCompare(right.unitId, "en"));
    return page(items, query, spec.GET.query, (box, q) => includes(box.unitId, q), []);
  }
  if (pattern === "/mailboxes/:unitId/messages" && spec.method === "GET") {
    const state = query.get("state") ?? "unread";
    if (!["unread", "read", "all"].includes(state)) throw new HttpError(400, "invalid_query", "The query is not valid.");
    const box = snap.mailboxes.find((item) => item.unitId === params.unitId);
    let items = box?.messages ?? [];
    if (state === "unread") items = items.filter((message) => !message.read);
    if (state === "read") items = items.filter((message) => message.read);
    items = [...items].sort((left, right) => String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? "")) || left.id.localeCompare(right.id, "en"));
    return page(items.map(publicMessage), query, spec.GET.query, (message, q) => includes(message.subject, q) || includes(message.body, q) || includes(message.fromId, q), []);
  }
  if (pattern === "/mailboxes/:unitId/messages/:messageId") {
    noneQuery(query);
    const message = snap.mailboxes.find((item) => item.unitId === params.unitId)?.messages.find((item) => item.id === params.messageId);
    if (!message) throw new HttpError(404, "message_not_found", "The message was not found.");
    return publicMessage(message);
  }
  if (pattern === "/approvals") {
    const state = query.get("state") ?? "pending";
    let items = snap.approvals.filter((item) => item.state === state);
    if (query.get("unitId")) items = items.filter((item) => item.unitId === query.get("unitId"));
    items = [...items].sort((left, right) => Number(right.state === "pending") - Number(left.state === "pending") || right.requestedAt.localeCompare(left.requestedAt) || left.id.localeCompare(right.id, "en"));
    return page(items, query, spec.GET.query, (item, q) => includes(item.display, q) || includes(item.action, q) || includes(item.unitId, q), []);
  }
  if (pattern === "/approvals/:approvalId") {
    noneQuery(query);
    const approval = snap.approvals.find((item) => item.id === params.approvalId);
    if (!approval) throw new HttpError(404, "not_found", "The approval was not found.");
    return approval;
  }
  if (pattern === "/grant-revocations/:requestId") {
    noneQuery(query);
    const record = fx.revocations.get(params.requestId);
    if (!record) throw new HttpError(404, "not_found", "The revocation was not found.");
    return record;
  }
  if (pattern === "/approvals/:approvalId/answers/:answerId") {
    noneQuery(query);
    const memory = fx.answers.get(params.answerId);
    if (memory?.approvalId === params.approvalId) return memory;
    const approval = snap.approvals.find((item) => item.id === params.approvalId);
    const outcome = approval?.answerOutcomes.find((item) => item.answerId === params.answerId);
    if (!outcome) throw new HttpError(404, "not_found", "The answer was not found.");
    return { answerId: outcome.answerId, approvalId: outcome.approvalId, state: outcome.state, resultAnswerId: outcome.resultAnswerId ?? null, at: outcome.at ?? null };
  }
  if (pattern === "/units/:unitId/approval-grants") {
    const unit = snap.units.find((item) => item.id === params.unitId);
    if (!unit) throw new HttpError(404, "unit_not_found", "The unit was not found.");
    const items = [...unit.approvalGrants].sort((left, right) => right.grantedAt.localeCompare(left.grantedAt) || left.id.localeCompare(right.id, "en"));
    return page(items, query, spec.GET.query, (grant, q) => includes(grant.action, q) || includes(JSON.stringify(grant.pattern), q), []);
  }
  if (pattern === "/tasks") {
    const allowed = new Set((query.get("status") ?? "open,review,done").split(","));
    let items = snap.tasks.filter((task) => allowed.has(task.status));
    if (query.get("project")) items = items.filter((task) => task.scope.name === query.get("project"));
    if (query.get("unitId")) items = items.filter((task) => task.toId === query.get("unitId") || task.fromId === query.get("unitId"));
    const rank = { review: 0, open: 1, done: 2, closed: 3 };
    items = [...items].sort((left, right) => rank[left.status] - rank[right.status] || String(right.date ?? "").localeCompare(String(left.date ?? "")) || left.id.localeCompare(right.id, "en"));
    return page(items.map(publicTask), query, spec.GET.query, (task, q) => includes(task.number, q) || includes(task.title, q) || includes(task.report, q), []);
  }
  if (pattern === "/tasks/:taskId") {
    noneQuery(query);
    const task = snap.tasks.find((item) => item.id === params.taskId);
    if (!task) throw new HttpError(404, "task_not_found", "The task was not found.");
    return publicTask(task);
  }
  if (pattern === "/waiting") {
    let items = snap.waiting;
    if (query.get("unitId")) items = items.filter((item) => item.unitId === query.get("unitId"));
    if (query.get("kind")) items = items.filter((item) => item.kind === query.get("kind"));
    return page(items, query, spec.GET.query, (item, q) => includes(item.title, q) || includes(item.unitId, q), []);
  }
  if (pattern === "/settings") {
    noneQuery(query);
    return { settings: snap.settings.settings, revision: snap.settings.revision, service: { machine: LOCAL_MACHINE, version: "3.0.0", originKind: "folder", syncState: syncState(fx).state }, home: homeStatus(fx) };
  }
  if (pattern === "/viewer") {
    noneQuery(query);
    return viewerData(spec.principal);
  }
  if (pattern === "/blueprint/boards" || pattern === "/void/texts") {
    const kind = pattern.startsWith("/blueprint") ? "blueprint" : "void";
    let items = snap.editors.filter((editor) => editor.kind === kind);
    if (query.get("project")) items = items.filter((editor) => editor.project === query.get("project"));
    items = [...items].sort((left, right) => left.project.localeCompare(right.project, "en") || left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"));
    return page(items.map(summary), query, spec.GET.query, (editor, q) => includes(editor.title, q) || includes(editor.project, q) || includes(editor.path, q), []);
  }
  if (pattern === "/blueprint/boards/:resourceId" || pattern === "/void/texts/:resourceId") {
    noneQuery(query);
    const editor = requireEditor(snap, params.resourceId);
    if (editor.corrupt) throw new HttpError(409, "corrupt_resource", "The comment sidecar is unreadable.");
    const published = { ...editor };
    delete published.proposals;
    return published;
  }
  if (pattern === "/void/texts/:resourceId/proposals") {
    const editor = requireEditor(snap, params.resourceId);
    const state = query.get("state") ?? "pending";
    const items = editor.proposals.filter((item) => item.state === state);
    return page(items, query, spec.GET.query, () => true, []);
  }
  if (pattern === "/editors/:resourceId/attachments") {
    noneQuery(query);
    const editor = requireEditor(snap, params.resourceId);
    return { attached: editor.attached, revision: editor.attachmentRevision };
  }
  if (pattern === "/editors/:resourceId/comments") {
    const editor = requireEditor(snap, params.resourceId);
    if (editor.corrupt) throw new HttpError(409, "corrupt_resource", "The comment sidecar is unreadable.");
    const status = query.get("status") ?? "all";
    const items = editor.threads.filter((thread) => status === "all" || thread.status === status);
    const result = page(items, query, spec.GET.query, (thread, q) => JSON.stringify(thread).toLowerCase().includes(q), []);
    return { ...result, commentsRevision: editor.commentsRevision };
  }
  if (pattern === "/editors/:resourceId/assets/:assetId") throw new HttpError(404, "asset_not_found", "The asset was not found.");
  throw new HttpError(404, "not_found", "The route was not found.");
}

function filterUnits(units, query) {
  return units.filter((unit) => (!query.get("project") || (unit.scope.kind === "project" && unit.scope.name === query.get("project")))
    && (!query.get("machine") || unit.machine === query.get("machine"))
    && (!query.get("leadId") || unit.leadId === query.get("leadId"))
    && (!query.get("status") || unit.status === query.get("status")));
}

function publicChat(chat) {
  const { file, ...rest } = chat;
  return rest;
}

function publicTask(task) {
  const { file, ...rest } = task;
  return rest;
}

function publicMessage(message) {
  return {
    id: message.id, fromId: message.fromId, toId: message.toId, machine: message.machine, timestamp: message.timestamp,
    date: message.date, priority: message.priority, subject: message.subject, body: message.body, threadId: message.threadId,
    replyTo: message.replyTo, replyRequested: message.replyRequested, attachments: message.attachments, kind: message.kind,
    read: message.read, notice: message.notice,
  };
}

function messagePage(snap, chatId, query, allowed) {
  if (query.get("before") && query.get("cursor")) throw new HttpError(400, "invalid_query", "The query is not valid.");
  const chat = snap.chats.find((item) => item.id === chatId);
  if (!chat) throw new HttpError(404, "chat_not_found", "The chat was not found.");
  let ordered = snap.messages.filter((message) => message.chatId === chatId).sort(messageOrder);
  const q = query.get("q");
  if (q) ordered = ordered.filter((message) => includes(message.subject, q.toLowerCase()) || includes(message.body, q.toLowerCase()) || includes(message.fromId, q.toLowerCase()));
  const total = ordered.length;
  let end = ordered.length;
  if (query.get("before")) {
    const index = ordered.findIndex((message) => message.id === query.get("before"));
    if (index < 0) throw new HttpError(422, "invalid_body", "The message was not found in the chat.");
    end = index;
  }
  const snapshot = snapshotHash(snap.messages.filter((message) => message.chatId === chatId));
  const filterHash = sha256(JSON.stringify(canonical({ chatId, q: q ?? null })));
  if (query.get("cursor")) end = readCursor(query.get("cursor"), filterHash, snapshot);
  const limit = limitOf(query.get("limit"));
  const start = Math.max(0, end - limit);
  const nextCursor = start > 0 ? Buffer.from(JSON.stringify({ contract: CONTRACT, filter: filterHash, snapshot, position: start })).toString("base64url") : null;
  return { items: ordered.slice(start, end).map(publicMessage), total, nextCursor, issues: [] };
}

function summary(editor) {
  return {
    id: editor.id, kind: editor.kind, project: editor.project, title: editor.title, path: editor.path, readOnly: editor.readOnly,
    revision: editor.revision, attached: editor.attached, openThreads: editor.openThreads, activity: editor.activity,
  };
}

function requireEditor(snap, id) {
  const editor = snap.editors.find((item) => item.id === id);
  if (!editor) throw new HttpError(404, "not_found", "The editor was not found.");
  return editor;
}

function viewerData(viewer) {
  return { viewerId: viewer.viewerId, embedded: viewer.embedded, hostOrigin: viewer.hostOrigin, look: viewer.look, language: viewer.language, dirty: viewer.dirty };
}

function contentType(name) {
  if (name.endsWith(".html")) return "text/html; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/javascript; charset=utf-8";
}

function sendJson(response, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  response.end(payload);
}

function sendError(response, error, requestId) {
  const known = error instanceof HttpError;
  if (error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
  sendJson(response, known ? error.status : 500, {
    error: {
      code: known ? error.code : "internal_error",
      message: known ? error.message : "The service could not complete the request.",
      requestId,
      details: known ? error.details : {},
      retryAt: known ? error.retryAt : null,
    },
  });
}

const GENERAL_BODY = 2_000_000;
const LARGE_BODY = 16_000_000;

function bodyLimit(method, apiPath) {
  if (method === "PUT" && (/^\/blueprint\/boards\/[^/]+$/.test(apiPath) || /^\/void\/texts\/[^/]+$/.test(apiPath))) return LARGE_BODY;
  if (method === "POST" && (apiPath === "/blueprint/boards" || apiPath === "/void/texts")) return LARGE_BODY;
  if (method === "POST" && (/^\/void\/texts\/[^/]+\/ranges$/.test(apiPath) || /^\/editors\/[^/]+\/assets$/.test(apiPath))) return LARGE_BODY;
  return GENERAL_BODY;
}

async function readBody(request, limit = GENERAL_BODY) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new HttpError(413, "body_too_large", "The request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function canonicalOrigin(value) {
  if (typeof value !== "string") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (value !== parsed.origin) return null;
  return parsed.origin;
}

function staticHeaders(frameAncestors, deny) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (deny) headers["X-Frame-Options"] = "DENY";
  return headers;
}

async function serveStatic(fx, request, response, audience) {
  const url = new URL(request.url, audience.origin);
  let fileName = null;
  let viewer = null;
  if (url.pathname === "/" || url.pathname === "/index.html") fileName = "index.html";
  const viewerMatch = /^\/gui\/([0-9a-f-]{36})\/?$/.exec(url.pathname);
  if (viewerMatch) {
    fileName = "index.html";
    viewer = [...fx.viewers.values()].find((item) => item.viewerId === viewerMatch[1]);
  }
  const assetMatch = /^\/app\/([^/]+)$/.exec(url.pathname);
  if (assetMatch) {
    if (!APP_FILES.includes(assetMatch[1])) throw new HttpError(404, "not_found", "The route was not found.");
    fileName = assetMatch[1];
  }
  if (!fileName) return false;
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "method_not_allowed", "The method is not allowed.");
  const frame = viewer?.embedded && viewer.hostOrigin ? viewer.hostOrigin : "'none'";
  const headers = staticHeaders(frame, frame === "'none'");
  let bytes;
  try {
    bytes = await readFile(join(repoRoot, "gui", "app", fileName));
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, headers);
      response.end();
      return true;
    }
    throw error;
  }
  response.writeHead(200, { ...headers, "Content-Type": contentType(fileName), "Content-Length": bytes.length });
  response.end(request.method === "HEAD" ? undefined : bytes);
  return true;
}

function findRoute(pathname, method) {
  const path = pathname.startsWith("/api/v1") ? (pathname.slice("/api/v1".length) || "/") : pathname;
  let found = null;
  for (const route of routeTable()) {
    const params = matchPath(route.pattern, path);
    if (!params) continue;
    found = { route, params, path };
    if (route[method]) return { route, params, path, allowed: true };
  }
  return found ? { ...found, allowed: false } : null;
}

async function handleApi(fx, request, response, audience) {
  const requestId = uuid();
  const rawPath = request.url.split("?")[0];
  if (/%2f|%5c|%2e%2e|\.\.|\\/i.test(rawPath)) throw new HttpError(400, "invalid_path", "The path is not valid.");
  if ((request.url?.length ?? 0) > 2048) throw new HttpError(414, "uri_too_long", "The request URL is too long.");
  const remote = request.socket.remoteAddress;
  if (![HOST, `::ffff:${HOST}`].includes(remote)) throw new HttpError(403, "peer_not_allowed", "The peer is not allowed.");
  if (request.headers.host !== `${HOST}:${audience.port}`) throw new HttpError(400, "invalid_host", "The Host header is invalid.");
  if (request.method === "OPTIONS") throw new HttpError(403, "invalid_origin", "Cross-origin requests are rejected.");
  const url = new URL(request.url, audience.origin);
  if ([...url.searchParams.keys()].some((key) => key === "token" || key === "access_token")) {
    throw new HttpError(400, "invalid_query", "The query is not valid.");
  }
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== audience.origin) throw new HttpError(403, "invalid_origin", "The request origin is invalid.");
  if (await serveStatic(fx, request, response, audience)) return;
  if (!url.pathname.startsWith("/api/v1/")) throw new HttpError(404, "not_found", "The route was not found.");
  const writing = !["GET", "HEAD"].includes(request.method);
  if (writing && origin !== audience.origin) throw new HttpError(403, "invalid_origin", "The request origin is required.");
  const apiPath = url.pathname.slice("/api/v1".length);
  if (apiPath === "/auth/local" || apiPath === "/auth/home") {
    await handleAuth(fx, request, response, audience, apiPath, requestId);
    return;
  }
  const matched = findRoute(apiPath, request.method);
  if (!matched) throw new HttpError(404, "not_found", "The route was not found.");
  if (!matched.allowed) {
    const allow = Object.keys(matched.route).filter((key) => key === key.toUpperCase());
    response.setHeader("Allow", allow.join(", "));
    throw new HttpError(405, "method_not_allowed", "The method is not allowed.");
  }
  const token = bearer(request);
  const principal = fx.tokens.get(token);
  if (!principal || !safeEqual(principal.token, token)) throw new HttpError(401, "invalid_session", "The session is invalid.");
  if (audience.kind === "home" && principal.audience !== "phone") throw new HttpError(403, "forbidden", "This credential is not accepted on the home listener.");
  if (principal.expiresAt && Date.parse(principal.expiresAt) <= fx.nowMs) throw new HttpError(410, "home_expired", "Home access has expired.");
  const spec = { ...matched.route, ...matched.route[request.method], pattern: matched.route.pattern, method: request.method, token };
  if (apiPath === "/events" && request.method === "GET") {
    await handleEvents(fx, request, response, principal, url, requestId);
    return;
  }
  const query = queryMap(url);
  if (request.method === "GET" || request.method === "HEAD") {
    if (spec.pattern === "/editors/:resourceId/assets/:assetId") {
      const asset = await readAsset(fx, matched.params.resourceId, matched.params.assetId);
      response.writeHead(200, { "Content-Type": asset.contentType, ETag: `"${sha256(asset.bytes)}"`, "Cache-Control": "no-store", "Content-Length": asset.bytes.length });
      response.end(request.method === "HEAD" ? undefined : asset.bytes);
      return;
    }
    const body = await handleRead(fx, principal, spec, matched.params, query, requestId);
    sendJson(response, 200, body);
    return;
  }
  const raw = await readBody(request, bodyLimit(request.method, apiPath));
  const type = String(request.headers["content-type"] ?? "");
  if (!type.includes("application/json")) throw new HttpError(415, "unsupported_media_type", "JSON is required.");
  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "invalid_json", "The JSON body is not valid.");
  }
  const concrete = `/api/v1${apiPath.split("/").map((part, index) => index === 0 ? part : decodeOnce(part)).join("/")}`;
  const route = {
    ...spec,
    requestPath: concrete,
    mailboxUnit: matched.params.unitId,
    validate: spec.validate,
    checkPreconditions: async (input) => checkMutation(fx, spec.pattern, matched.params, input),
    prepare: async (input, actor) => prepareMutation(fx, spec.pattern, matched.params, input, actor),
    runtime: Boolean(spec.runtime),
    homeGrant: spec.pattern === "/settings/home-network",
    apply: spec.pattern === "/auth/logout" ? () => revokeViewer(fx, principal.viewerId) : undefined,
  };
  if (spec.pattern === "/auth/logout") {
    route.prepare = async () => ({ status: 204, data: null, writes: [], events: [], apply: () => revokeViewer(fx, principal.viewerId) });
    route.runtime = true;
  }
  const result = await mutate(fx, request, route, body, principal, requestId);
  if (result.drop) {
    request.socket.destroy();
    return;
  }
  if (result.status === 204) {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  sendJson(response, result.status, result.response);
}

function decodeOnce(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new HttpError(400, "invalid_path", "The path is not valid.");
  }
}

function bearer(request) {
  const header = String(request.headers.authorization ?? "");
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "invalid_session", "The session is invalid.");
  return header.slice(7);
}

function validateUnit(body) {
  requireObject(body, ["unit", "role", "scope", "machine", "leadId", "job", "model", "position"]);
  requireKeys(body, ["unit", "role", "scope", "machine"]);
  if (typeof body.unit !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(body.unit)) throw new HttpError(422, "invalid_body", "The unit name is not valid.");
  if (!ROLES.has(body.role)) throw new HttpError(422, "invalid_body", "The role is not valid.");
  if (!body.scope || typeof body.scope !== "object" || !["root", "environment", "project"].includes(body.scope.kind)) {
    throw new HttpError(422, "invalid_body", "The scope is not valid.");
  }
  if (body.scope.kind !== "root" && (typeof body.scope.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(body.scope.name))) {
    throw new HttpError(422, "invalid_body", "The scope is not valid.");
  }
  if (typeof body.machine !== "string" || !body.machine) throw new HttpError(422, "invalid_body", "The machine is not valid.");
  if (body.position) coordinate(body.position, "unit");
}

function validateLead(body) {
  requireObject(body, ["leadId", "confirmed", "expectedRevision"]);
  requireKeys(body, ["leadId", "confirmed", "expectedRevision"]);
  if (body.confirmed !== true) throw new HttpError(422, "invalid_body", "The connection is not confirmed.");
  if (body.leadId !== null && typeof body.leadId !== "string") throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  revisionField(body.expectedRevision);
}

function validateSession(body) {
  requireObject(body, ["client", "prompt", "expectedRevision"]);
  requireKeys(body, ["client", "expectedRevision"]);
  if (typeof body.client !== "string" || !body.client) throw new HttpError(422, "invalid_body", "The client is not valid.");
  if (body.prompt !== undefined && body.prompt !== null && typeof body.prompt !== "string") throw new HttpError(422, "invalid_body", "The prompt is not valid.");
  revisionField(body.expectedRevision);
}

function validateStop(body) {
  requireObject(body, ["confirmed"]);
  requireKeys(body, ["confirmed"]);
  if (body.confirmed !== true) throw new HttpError(422, "invalid_body", "The stop is not confirmed.");
}

function unitIdentity(body) {
  if (body.scope.kind === "project") return `project:${body.scope.name}:${body.unit}`;
  if (body.scope.kind === "environment") return `env:${body.scope.name}:${body.unit}`;
  return `root:${body.unit}`;
}

async function rejectUnit(snap, body) {
  const machine = snap.machines.find((item) => item.id === body.machine);
  if (!machine || !machine.answers) {
    throw new HttpError(409, "machine_unavailable", "The machine is unavailable.", { machine: body.machine, heartbeatAt: machine?.heartbeatAt ?? null });
  }
  const id = unitIdentity(body);
  if (snap.units.some((unit) => unit.id === id)) throw new HttpError(409, "unit_exists", "The unit already exists.");
  if (body.role === "overseer" && snap.units.some((unit) => unit.role === "overseer" && unit.unit === "overseer" && unit.revision)) {
    throw new HttpError(409, "overseer_exists", "An Overseer already exists.");
  }
  if (body.role === "master" && body.leadId) throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  if (body.leadId && !snap.units.some((unit) => unit.id === body.leadId && unit.revision)) {
    throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  }
}

function rejectLead(snap, unitId, body) {
  const target = snap.units.find((unit) => unit.id === unitId);
  if (!target || target.revision === null) throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  if (target.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The unit was changed elsewhere.", { currentRevision: target.revision });
  if (target.role === "master" || body.leadId === unitId) throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  if (body.leadId && !snap.units.some((unit) => unit.id === body.leadId && unit.revision)) {
    throw new HttpError(422, "invalid_lead", "The lead is not valid.");
  }
  if (body.leadId && leadCycle(snap.units, unitId, body.leadId)) throw new HttpError(409, "lead_cycle", "The connection would cycle.");
}

async function rejectSession(fx, snap, unitId, body) {
  const target = snap.units.find((unit) => unit.id === unitId);
  if (!target || target.revision === null) throw new HttpError(404, "unit_not_found", "The unit was not found.");
  if (target.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The unit was changed elsewhere.", { currentRevision: target.revision });
  const machine = snap.machines.find((item) => item.id === target.machine);
  if (!machine || !machine.answers) {
    throw new HttpError(409, "machine_unavailable", "The machine is unavailable.", { machine: target.machine, heartbeatAt: machine?.heartbeatAt ?? null });
  }
  const client = (machine.clients ?? []).find((item) => item.id === body.client && item.enabled && item.installed);
  if (!client) throw new HttpError(422, "client_unavailable", "The client is not available on that machine.");
  if (snap.sessions.some((session) => session.unitId === unitId && session.state !== "stopped")) {
    throw new HttpError(409, "unit_in_use", "The unit already has a session.");
  }
  if ([...fx.sessionRequests.values()].some((item) => item.unitId === unitId && (item.state === "queued" || item.state === "starting"))) {
    throw new HttpError(409, "unit_in_use", "The unit already has a session.");
  }
}

async function rejectStop(fx, sessionId) {
  const snap = await projection(fx);
  const session = snap.sessions.find((item) => item.id === sessionId);
  if (!session) throw new HttpError(404, "not_found", "The session was not found.");
  if (session.machine !== LOCAL_MACHINE) throw new HttpError(409, "remote_session", "The session is on another machine.");
  if (session.state === "stopped" || fx.sessionStops.get(sessionId)?.state === "stopped") {
    throw new HttpError(409, "stop_unavailable", "The session cannot be stopped.");
  }
}

function leadCycle(units, targetId, leadId) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const seen = new Set([targetId]);
  let cursor = leadId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.leadId ?? null;
  }
  return false;
}

function unitFile(user, body, id) {
  if (body.scope.kind === "project") return join(user, "projects", body.scope.name, "state", `${body.unit}.md`);
  if (body.scope.kind === "environment") return join(user, "envs", body.scope.name, "state", `${body.unit}.md`);
  return join(user, "state", `${body.unit}.md`);
}

function unitRecord(body, id) {
  const lines = [
    `unit: ${body.unit}`,
    `unit-id: ${id}`,
    `role: ${body.role}`,
    "state: in",
    `machine: ${body.machine}`,
  ];
  if (body.leadId) {
    lines.push(`lead: ${body.leadId.split(":").at(-1)}`);
    lines.push(`lead-id: ${body.leadId}`);
  }
  if (body.job) lines.push(`job: ${body.job}`);
  if (body.model) lines.push(`model: ${body.model}`);
  lines.push("date: 2026-10-10 09:00");
  return `${lines.join("\n")}\n\n`;
}

function replaceLead(text, leadId) {
  const rows = text.replace(/\s*$/, "").split("\n");
  const write = (prefix, value) => {
    const index = rows.findIndex((row) => row.startsWith(prefix));
    if (!value) {
      if (index >= 0) rows.splice(index, 1);
      return;
    }
    if (index >= 0) rows[index] = value;
    else {
      const blank = rows.findIndex((row) => row === "");
      rows.splice(blank === -1 ? rows.length : blank, 0, value);
    }
  };
  write("lead:", leadId ? `lead: ${leadId.split(":").at(-1)}` : null);
  write("lead-id:", leadId ? `lead-id: ${leadId}` : null);
  return `${rows.join("\n")}\n`;
}

async function prepareUnit(fx, body) {
  const snap = await projection(fx);
  const id = unitIdentity(body);
  const bytes = Buffer.from(unitRecord(body, id));
  const file = unitFile(fx.tree.user, body, id);
  const revision = sha256(bytes);
  const writes = [{ path: file, beforeRevision: null, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }];
  const events = [];
  let position = null;
  if (body.position) {
    const current = await loadLayout(fx);
    const next = structuredClone(current.layout);
    next.nodes ??= {};
    next.nodes[id] = { x: body.position.x, y: body.position.y };
    next.updatedAt = clock(fx).toISOString();
    next.machine = LOCAL_MACHINE;
    const layoutBytes = Buffer.from(stableJson(next));
    const afterRevision = sha256(layoutBytes);
    writes.push({
      path: join(fx.tree.user, "gui", "layout.json"),
      beforeRevision: current.revision,
      afterRevision,
      afterBytesBase64: layoutBytes.toString("base64"),
    });
    events.push({ name: "layout.changed", global: true, data: { layout: next, revision: afterRevision } });
    position = body.position;
  }
  const unit = {
    id,
    unit: body.unit,
    role: body.role,
    scope: body.scope.kind === "root" ? { kind: "root", name: null } : { kind: body.scope.kind, name: body.scope.name },
    leadId: body.leadId ?? null,
    job: body.job ?? null,
    model: body.model ?? null,
    machine: body.machine,
    state: "in",
    status: "idle",
    context: "",
    date: "2026-10-10 09:00",
    branch: null,
    revision,
    sessionIds: [],
    approvalGrants: [],
    position,
  };
  events.push({ name: "unit.changed", unitId: id, data: { unit } });
  return { status: 201, data: unit, writes, events };
}

async function prepareLead(fx, unitId, body) {
  const snap = await projection(fx);
  const target = snap.units.find((unit) => unit.id === unitId);
  const file = snap.files.units.get(unitId);
  const next = replaceLead(await readFile(file, "utf8"), body.leadId);
  const bytes = Buffer.from(next);
  const revision = sha256(bytes);
  const unit = { ...target, leadId: body.leadId, revision };
  return {
    status: 200,
    data: unit,
    writes: [{ path: file, beforeRevision: target.revision, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "unit.changed", unitId, data: { unit } }],
  };
}

async function prepareSession(fx, unitId, body) {
  const snap = await projection(fx);
  const target = snap.units.find((unit) => unit.id === unitId);
  const requestId = uuid();
  const record = {
    requestId,
    unitId,
    machine: target?.machine ?? LOCAL_MACHINE,
    state: "queued",
    sessionId: null,
    error: null,
    expiresAt: new Date(fx.nowMs + 60_000).toISOString(),
    prompt: body.prompt ?? null,
    client: body.client,
  };
  return {
    status: 202,
    data: { requestId, state: "queued", expiresAt: record.expiresAt },
    writes: [],
    events: [{ name: "session.request.changed", global: true, unitId: record.unitId, data: sessionRequestData(record) }],
    apply() { fx.sessionRequests.set(requestId, record); },
  };
}

async function prepareStop(fx, sessionId) {
  const snap = await projection(fx);
  const current = snap.sessions.find((item) => item.id === sessionId);
  const session = { ...(current ?? { id: sessionId }), state: "stopping" };
  const record = { sessionId, state: "stopping" };
  return {
    status: 202,
    data: { sessionId, state: "stopping" },
    writes: [],
    events: [{ name: "session.changed", global: true, data: { session } }],
    apply() { fx.sessionStops.set(sessionId, record); },
  };
}

async function dropGrant(fx, unitId, grantId) {
  const snap = await projection(fx);
  const file = snap.files.units.get(unitId);
  const current = snap.units.find((item) => item.id === unitId);
  if (!file) return current?.revision ?? null;
  const text = await readFile(file, "utf8");
  const match = text.match(/^approvals: (\[.*\])$/m);
  if (!match) return current?.revision ?? null;
  const grants = JSON.parse(match[1]).filter((item) => item.id !== grantId);
  const next = text.replace(match[0], `approvals: ${JSON.stringify(grants)}`);
  await writeAtomic(file, Buffer.from(next));
  invalidate(fx);
  return (await projection(fx)).units.find((item) => item.id === unitId)?.revision ?? null;
}

function activityFocus(focus) {
  if (!focus || typeof focus !== "object") return null;
  if (typeof focus.screenId === "string" || typeof focus.nodeId === "string") {
    return { screenId: focus.screenId ?? null, nodeId: focus.nodeId ?? null };
  }
  if (typeof focus.k === "string") {
    return { k: focus.k, lang: focus.lang ?? null, start: focus.start ?? null, end: focus.end ?? null };
  }
  return null;
}

function sessionRequestData(record) {
  return {
    requestId: record.requestId,
    unitId: record.unitId,
    machine: record.machine,
    state: record.state,
    sessionId: record.sessionId ?? null,
    error: record.error ?? null,
  };
}

function validateChat(body) {
  requireObject(body, ["members", "title"]);
  requireKeys(body, ["members"]);
  if (!Array.isArray(body.members) || body.members.length < 1 || body.members.length > 256 || body.members.some((id) => typeof id !== "string" || !id)) {
    throw new HttpError(422, "invalid_members", "The chat members are not valid.");
  }
  if (body.title !== undefined && typeof body.title !== "string") throw new HttpError(422, "invalid_body", "The title is not valid.");
}

function validateChatPatch(body) {
  requireObject(body, ["pinned", "listed", "expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  if (!("pinned" in body) && !("listed" in body)) throw new HttpError(422, "invalid_body", "The chat change is not valid.");
  if ("pinned" in body && typeof body.pinned !== "boolean") throw new HttpError(422, "invalid_body", "The chat change is not valid.");
  if ("listed" in body && typeof body.listed !== "boolean") throw new HttpError(422, "invalid_body", "The chat change is not valid.");
  revisionField(body.expectedRevision);
}

async function prepareChat(fx, body, principal) {
  const snap = await projection(fx);
  const selected = [...new Set(body.members.filter((id) => id !== principal.unitId))];
  if (!selected.length || selected.some((id) => !snap.units.some((unit) => unit.id === id && unit.revision))) {
    throw new HttpError(422, "invalid_members", "The chat members are not valid.");
  }
  const members = [principal.unitId, ...selected];
  const kind = selected.length === 1 ? "direct" : "group";
  const names = selected.map((id) => snap.units.find((unit) => unit.id === id).unit);
  const title = body.title || (kind === "direct" ? names[0] : names.join(", ").slice(0, 240));
  if (kind === "direct") {
    const id = deterministicUuid(["direct-chat", [...members].sort()]);
    const existing = snap.chats.find((chat) => chat.id === id);
    if (existing?.listed) return { status: 200, data: publicChat(existing), writes: [], events: [] };
    if (existing) return rewriteChat(fx, existing, { listed: true });
    return writeNewChat(fx, { id, title, members, kind, pinned: false, listed: true });
  }
  return writeNewChat(fx, { id: uuid(), title, members, kind, pinned: false, listed: true });
}

async function prepareChatPatch(fx, chatId, body) {
  const snap = await projection(fx);
  const chat = snap.chats.find((item) => item.id === chatId);
  if (!chat) throw new HttpError(404, "chat_not_found", "The chat was not found.");
  if (chat.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The chat was changed elsewhere.", { currentRevision: chat.revision });
  return rewriteChat(fx, chat, {
    pinned: body.pinned ?? chat.pinned,
    listed: body.listed ?? chat.listed,
  });
}

function writeNewChat(fx, chat) {
  const createdAt = clock(fx).toISOString();
  const text = `id: ${chat.id}\ntitle: ${chat.title}\nmembers: ${JSON.stringify(chat.members)}\npinned: ${chat.pinned}\nlisted: ${chat.listed}\ncreated: ${createdAt}\ncreated-by: root:master\nkind: ${chat.kind}\n\n`;
  const bytes = Buffer.from(text);
  const revision = sha256(bytes);
  const data = { ...chat, createdAt, revision, lastMessage: null, unread: 0 };
  return {
    status: 201,
    data,
    writes: [{ path: join(fx.tree.user, "relay", "chats", chat.id, "chat.md"), beforeRevision: null, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "chat.changed", chatId: chat.id, data: { chat: data } }],
  };
}

async function rewriteChat(fx, chat, changes) {
  const text = replaceChatFields(await readFile(chat.file, "utf8"), changes);
  const bytes = Buffer.from(text);
  const revision = sha256(bytes);
  const data = publicChat({ ...chat, ...changes, revision });
  return {
    status: 200,
    data,
    writes: [{ path: chat.file, beforeRevision: chat.revision, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "chat.changed", chatId: chat.id, data: { chat: data } }],
  };
}

function replaceChatFields(text, changes) {
  const rows = text.replace(/\s*$/, "").split("\n");
  for (const [key, value] of Object.entries(changes)) {
    const line = `${key}: ${value}`;
    const index = rows.findIndex((row) => row.startsWith(`${key}:`));
    if (index >= 0) rows[index] = line;
  }
  return `${rows.join("\n")}\n`;
}

function validateAnswer(body) {
  requireObject(body, ["decision", "expectedRevision"]);
  requireKeys(body, ["decision", "expectedRevision"]);
  if (!["approve", "approve-always", "deny"].includes(body.decision)) throw new HttpError(422, "invalid_body", "The decision is not valid.");
  revisionField(body.expectedRevision);
}

function validateRevoke(body) {
  requireObject(body, ["expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  revisionField(body.expectedRevision);
}

function validateTaskStatus(body) {
  requireObject(body, ["status", "note", "expectedRevision"]);
  requireKeys(body, ["status", "expectedRevision"]);
  if (!["open", "review", "done", "closed"].includes(body.status)) throw new HttpError(422, "invalid_body", "The status is not valid.");
  if (body.note !== undefined && typeof body.note !== "string") throw new HttpError(422, "invalid_body", "The note is not valid.");
  revisionField(body.expectedRevision);
}

const VOID_ANCHOR_KEYS = ["k", "lang", "start", "end", "quote", "prefix", "suffix"];
const BOARD_ANCHOR_KEYS = ["screen", "screenTitle", "element", "label", "path", "point"];

function validateComment(body) {
  requireObject(body, ["anchor", "text", "expectedRevision", "expectedCommentsRevision"]);
  requireKeys(body, ["anchor", "text", "expectedRevision"]);
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 10000) throw new HttpError(422, "invalid_body", "The comment is not valid.");
  revisionField(body.expectedRevision);
  if (body.expectedCommentsRevision !== undefined && body.expectedCommentsRevision !== null) revisionField(body.expectedCommentsRevision);
  validateCommentAnchor(body.anchor);
}

function anchorVariant(anchor) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  const keys = Object.keys(anchor);
  if (keys.length === VOID_ANCHOR_KEYS.length && VOID_ANCHOR_KEYS.every((key) => keys.includes(key))) return "void";
  if (keys.length === BOARD_ANCHOR_KEYS.length && BOARD_ANCHOR_KEYS.every((key) => keys.includes(key))) return "blueprint";
  return null;
}

function validateCommentAnchor(anchor) {
  const variant = anchorVariant(anchor);
  if (variant === "void") validateVoidAnchor(anchor);
  else if (variant === "blueprint") validateBoardAnchor(anchor);
  else throw new HttpError(422, "invalid_body", "The anchor is not valid.");
}

function validateVoidAnchor(anchor) {
  if (typeof anchor.k !== "string" || anchor.k.length < 1 || anchor.k.length > 200) throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  if (anchor.lang !== "en" && anchor.lang !== "es") throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  if (typeof anchor.quote !== "string" || typeof anchor.prefix !== "string" || typeof anchor.suffix !== "string") {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  if (anchor.quote.length !== anchor.end - anchor.start || anchor.prefix.length > 48 || anchor.suffix.length > 48) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
}

function validateBoardAnchor(anchor) {
  const id = (value) => value === null || (typeof value === "string" && value.length > 0 && value.length <= 160);
  if (!id(anchor.screen) || !id(anchor.element) || (anchor.element !== null && anchor.screen === null)) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  if (anchor.screen === null) {
    if (anchor.screenTitle !== null) throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  } else if (anchor.screenTitle !== null && (typeof anchor.screenTitle !== "string" || anchor.screenTitle.length > 160)) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  if (typeof anchor.label !== "string" || anchor.label.length > 160) throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  if (!Array.isArray(anchor.path) || anchor.path.length > 10 || anchor.path.some((item) => typeof item !== "string" || item.length > 160)) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  const point = anchor.point;
  if (!point || typeof point !== "object" || Array.isArray(point) || Object.keys(point).length !== 2) {
    throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  }
  for (const axis of ["x", "y"]) {
    if (!Number.isInteger(point[axis]) || point[axis] < -100000 || point[axis] > 100000) {
      throw new HttpError(422, "invalid_body", "The anchor is not valid.");
    }
  }
}

function fixturePlain(source) {
  return String(source ?? "").replaceAll("<b>", "").replaceAll("</b>", "").replaceAll("<i>", "").replaceAll("</i>");
}

function assertVoidAnchorMatches(editor, anchor) {
  const page = (editor.document?.pages ?? []).find((item) => item.k === anchor.k);
  const source = page?.[anchor.lang];
  if (typeof source !== "string") throw new HttpError(409, "anchor_changed", "The anchor no longer matches.");
  const plain = fixturePlain(source);
  const prefix = plain.slice(Math.max(0, anchor.start - 48), anchor.start);
  const quote = plain.slice(anchor.start, anchor.end);
  const suffix = plain.slice(anchor.end, anchor.end + 48);
  if (anchor.end > plain.length || anchor.quote !== quote || anchor.prefix !== prefix || anchor.suffix !== suffix) {
    throw new HttpError(409, "anchor_changed", "The anchor no longer matches.");
  }
}

function assertBoardAnchorMatches(editor, anchor) {
  if (anchor.screen === null && anchor.element === null) return;
  const screen = (editor.document?.screens ?? []).find((item) => item.id === anchor.screen);
  if (!screen) throw new HttpError(409, "anchor_changed", "The anchor no longer matches.");
  if (anchor.screenTitle !== null && anchor.screenTitle !== screen.title) throw new HttpError(409, "anchor_changed", "The anchor no longer matches.");
  if (anchor.element !== null && !nodeExists(screen.root, anchor.element)) throw new HttpError(409, "anchor_changed", "The anchor no longer matches.");
}

function nodeExists(node, id) {
  if (!node) return false;
  if (node.id === id) return true;
  return (node.kids ?? []).some((child) => nodeExists(child, id));
}

function validateReply(body) {
  requireObject(body, ["text", "expectedCommentsRevision"]);
  requireKeys(body, ["text", "expectedCommentsRevision"]);
  if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(422, "invalid_body", "The comment is not valid.");
  revisionField(body.expectedCommentsRevision);
}

function validateThread(body) {
  requireObject(body, ["status", "expectedCommentsRevision"]);
  requireKeys(body, ["status", "expectedCommentsRevision"]);
  if (!["open", "resolved"].includes(body.status)) throw new HttpError(422, "invalid_body", "The comment status is not valid.");
  revisionField(body.expectedCommentsRevision);
}

function validateAttachments(body) {
  requireObject(body, ["attached", "expectedRevision"]);
  requireKeys(body, ["attached", "expectedRevision"]);
  if (!Array.isArray(body.attached) || body.attached.length > 256 || new Set(body.attached).size !== body.attached.length) {
    throw new HttpError(422, "invalid_body", "The attached units are not valid.");
  }
  if (body.expectedRevision !== null) revisionField(body.expectedRevision);
}

function validateWatch(body) {
  requireObject(body, ["unitId", "resourceId", "chatId"]);
  requireKeys(body, ["unitId"]);
  if (typeof body.unitId !== "string") throw new HttpError(422, "invalid_body", "The unit is not valid.");
}

async function prepareComment(fx, resourceId, body) {
  const editor = await editorFor(fx, resourceId);
  if (editor.revision !== body.expectedRevision || (body.expectedCommentsRevision ?? null) !== editor.commentsRevision) {
    throw new HttpError(409, "revision_conflict", "The editor was changed elsewhere.");
  }
  if (anchorVariant(body.anchor) !== editor.kind) throw new HttpError(422, "invalid_body", "The anchor is not valid.");
  if (editor.kind === "void") assertVoidAnchorMatches(editor, body.anchor);
  else assertBoardAnchorMatches(editor, body.anchor);
  const thread = {
    id: uuid(),
    anchor: body.anchor,
    status: "open",
    place: body.anchor?.screen ? { screenId: body.anchor.screen, nodeId: body.anchor.element ?? null, x: body.anchor.point?.x ?? 0, y: body.anchor.point?.y ?? 0 } : null,
    messages: [{ id: uuid(), author: "master", authorId: "root:master", at: clock(fx).toISOString(), text: body.text, proposal: null }],
  };
  return writeComments(fx, editor, [...editor.threads, thread], thread, 201, "create");
}

async function prepareReply(fx, params, body) {
  const editor = await editorFor(fx, params.resourceId);
  if (editor.commentsRevision !== body.expectedCommentsRevision) throw new HttpError(409, "revision_conflict", "The comments were changed elsewhere.");
  const thread = editor.threads.find((item) => item.id === params.threadId);
  if (!thread) throw new HttpError(404, "thread_not_found", "The thread was not found.");
  const next = {
    ...thread,
    status: "open",
    messages: [...(thread.messages ?? []), { id: uuid(), author: "master", authorId: "root:master", at: clock(fx).toISOString(), text: body.text, proposal: null }],
  };
  return writeComments(fx, editor, editor.threads.map((item) => item.id === thread.id ? next : item), next, 200, "reply");
}

async function prepareThreadStatus(fx, params, body) {
  const editor = await editorFor(fx, params.resourceId);
  if (editor.commentsRevision !== body.expectedCommentsRevision) throw new HttpError(409, "revision_conflict", "The comments were changed elsewhere.");
  const thread = editor.threads.find((item) => item.id === params.threadId);
  if (!thread) throw new HttpError(404, "thread_not_found", "The thread was not found.");
  const next = { ...thread, status: body.status };
  const operation = body.status === "resolved" ? "resolve" : "reopen";
  return writeComments(fx, editor, editor.threads.map((item) => item.id === thread.id ? next : item), next, 200, operation);
}

async function prepareAttachments(fx, resourceId, body) {
  const snap = await projection(fx);
  const editor = requireEditor(snap, resourceId);
  if ((body.expectedRevision ?? null) !== editor.attachmentRevision) throw new HttpError(409, "revision_conflict", "The attachments were changed elsewhere.");
  if (body.attached.some((id) => !snap.units.some((unit) => unit.id === id && unit.revision))) throw new HttpError(422, "unknown_unit", "The unit is unknown.");
  const record = { format: "hivem1nd-editor-binding-v1", resourceId, kind: editor.kind, attached: body.attached, updatedAt: clock(fx).toISOString() };
  const bytes = Buffer.from(stableJson(record));
  const revision = sha256(bytes);
  const failed = fx.noticeFailure && body.attached.includes(fx.noticeFailure) ? fx.noticeFailure : null;
  return {
    status: 200,
    data: {
      attached: body.attached,
      revision,
      notifications: body.attached.map((unitId) => ({ unitId, state: unitId === failed ? "failed" : "pending" })),
    },
    writes: [{ path: join(fx.tree.user, "relay", "editors", `${resourceId}.json`), beforeRevision: editor.attachmentRevision, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "editor.changed", resourceId, data: { resourceId, attached: body.attached, revision } }],
  };
}

async function prepareWatch(fx, body, principal) {
  const snap = await projection(fx);
  if (body.resourceId) {
    const editor = requireEditor(snap, body.resourceId);
    if (!editor.attached.includes(body.unitId)) throw new HttpError(403, "not_attached", "The unit is not attached to that resource.");
  }
  if (body.chatId) {
    const chat = snap.chats.find((item) => item.id === body.chatId);
    if (!chat || !(chat.members ?? []).includes(body.unitId)) throw new HttpError(422, "invalid_chat_member", "The unit is not in that chat.");
  }
  const cutoff = fx.nowMs - 15 * 60_000;
  const recent = [...fx.activity].reverse().find((item) => item.unitId === body.unitId && item.ms >= cutoff && (!body.resourceId || item.resourceId === body.resourceId));
  const watchId = uuid();
  const record = { watchId, state: recent ? "watching" : "waiting", unitId: body.unitId, resourceId: body.resourceId ?? recent?.resourceId ?? null, viewerId: principal.viewerId };
  fx.watches.set(watchId, record);
  return {
    status: 200,
    data: { watchId, state: record.state, unitId: record.unitId, resourceId: record.resourceId },
    writes: [],
    events: [{ name: "watch.changed", global: false, viewerId: principal.viewerId, data: record }],
    apply() {},
  };
}

function prepareStopWatch(fx, watchId, principal) {
  const current = fx.watches.get(watchId);
  if (!current || current.viewerId !== principal.viewerId) throw new HttpError(404, "not_found", "The watch was not found.");
  fx.watches.delete(watchId);
  return {
    status: 204,
    data: null,
    writes: [],
    events: [{ name: "watch.changed", viewerId: principal.viewerId, data: { watchId, unitId: current.unitId, resourceId: current.resourceId ?? null, state: "stopped" } }],
    apply() {},
  };
}

async function editorFor(fx, resourceId) {
  const editor = requireEditor(await projection(fx), resourceId);
  if (editor.corrupt) throw new HttpError(409, "corrupt_resource", "The comment sidecar is unreadable.");
  return editor;
}

function commentsPath(fx, editor) {
  const repo = join(fx.tree.root, "repositories", editor.project);
  if (editor.kind === "void") return join(repo, ...editor.path.split("/")).replace(/\.json$/, ".comments.json");
  return join(repo, "docs", "flows", "comments", `${editor.legacy?.id ?? editor.document?.id}.json`);
}

function writeComments(fx, editor, threads, thread, status = 201, operation = "create") {
  const document = { threads: threads.map((item) => ({ ...item, revision: undefined })) };
  const bytes = Buffer.from(stableJson(document));
  const commentsRevision = sha256(bytes);
  const failed = fx.noticeFailure;
  return {
    status,
    data: {
      thread: { ...thread, place: thread.place ?? null },
      commentsRevision,
      notifications: [{ unitId: editor.attached[0] ?? null, state: failed && editor.attached.includes(failed) ? "failed" : "pending" }],
    },
    writes: [{ path: commentsPath(fx, editor), beforeRevision: editor.commentsRevision, afterRevision: commentsRevision, afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "comment.changed", resourceId: editor.id, data: { resourceId: editor.id, thread, commentsRevision, operation } }],
  };
}

function validateViewer(body) {
  requireObject(body, ["look", "language", "dirty"]);
  const present = ["look", "language", "dirty"].filter((key) => body[key] !== undefined);
  if (!present.length) throw new HttpError(422, "invalid_body", "The viewer change is empty.");
  if (body.look !== undefined && body.look !== null && !["modern", "high-contrast"].includes(body.look)) throw new HttpError(422, "invalid_body", "The look is not valid.");
  if (body.language !== undefined && body.language !== null && !["en", "es"].includes(body.language)) throw new HttpError(422, "invalid_body", "The language is not valid.");
  if (body.dirty !== undefined && typeof body.dirty !== "boolean") throw new HttpError(422, "invalid_body", "The dirty flag is not valid.");
}

function prepareViewer(fx, body, principal) {
  const viewer = fx.viewers.get(principal.viewerId) ?? principal;
  if (body.look !== undefined) viewer.look = body.look;
  if (body.language !== undefined) viewer.language = body.language;
  if (body.dirty !== undefined) viewer.dirty = body.dirty;
  const data = viewerData(viewer);
  return { status: 200, data, writes: [], events: [{ name: "viewer.changed", viewerId: viewer.viewerId, data }], apply() {} };
}

function validateRegister(body) {
  requireObject(body, ["kind", "project", "path"]);
  requireKeys(body, ["kind", "project", "path"]);
  if (!["blueprint", "void"].includes(body.kind)) throw new HttpError(422, "invalid_body", "The editor kind is not valid.");
  assertEditorPath(body.project, body.path);
}

function validateBoard(body) {
  requireObject(body, ["project", "path", "document", "attached"]);
  requireKeys(body, ["project", "document"]);
  assertDocument(body.document);
  if (body.path !== undefined) assertEditorPath(body.project, body.path);
  else assertEditorPath(body.project, "docs/flows/boards/placeholder.json");
}

function validateText(body) {
  requireObject(body, ["project", "path", "document", "attached"]);
  requireKeys(body, ["project", "path", "document"]);
  assertDocument(body.document);
  assertEditorPath(body.project, body.path);
}

function assertEditorPath(project, path) {
  if (typeof project !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(project)) throw new HttpError(422, "invalid_body", "The project is not valid.");
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new HttpError(422, "invalid_path", "The path is not valid.");
  }
}

function assertDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document) || document.formatVersion !== 1 || typeof document.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(document.id)) {
    throw new HttpError(422, "invalid_document", "The document is not valid.");
  }
}

async function prepareRegister(fx, body) {
  const file = editorFile(fx, body.project, body.path);
  try {
    await readFile(file);
  } catch {
    throw new HttpError(404, "resource_not_found", "The resource was not found.");
  }
  const id = deterministicUuid(["editor", body.kind, body.project, body.path]);
  const catalog = await readJsonFile(join(fx.tree.user, "gui", "resources.json"));
  if (catalog.value.resources.some((item) => item.id === id)) {
    return { status: 200, data: requireEditor(await projection(fx), id), writes: [], events: [] };
  }
  const next = structuredClone(catalog.value);
  next.resources.push({ id, kind: body.kind, project: body.project, path: body.path, legacyId: body.path.endsWith(".mjs") ? body.path.split("/").at(-1).replace(/\.mjs$/, "") : null });
  const bytes = Buffer.from(stableJson(next));
  const readOnly = body.path.endsWith(".mjs");
  return {
    status: 201,
    data: { id, kind: body.kind, project: body.project, path: body.path, title: body.path, readOnly, revision: null, document: null, legacy: readOnly ? { id: body.path, path: body.path, reason: "conversion_required" } : null, attached: [], threads: [], commentsRevision: null, attachmentRevision: null },
    writes: [{ path: join(fx.tree.user, "gui", "resources.json"), beforeRevision: catalog.hash, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "editor.changed", resourceId: id, data: { resourceId: id } }],
  };
}

async function prepareCreateEditor(fx, kind, body) {
  const path = body.path ?? (kind === "blueprint" ? `docs/flows/boards/${body.document.id}.json` : null);
  if (!path?.endsWith(".json")) throw new HttpError(422, "invalid_path", "The path is not valid.");
  assertEditorPath(body.project, path);
  const id = deterministicUuid(["editor", kind, body.project, path]);
  const catalog = await readJsonFile(join(fx.tree.user, "gui", "resources.json"));
  if (catalog.value.resources.some((item) => item.id === id || (item.project === body.project && item.path === path))) {
    throw new HttpError(409, "resource_exists", "The resource already exists.");
  }
  const file = editorFile(fx, body.project, path);
  if (await hashExisting(file) !== null) throw new HttpError(409, "resource_exists", "The resource already exists.");
  const snap = await projection(fx);
  const attached = body.attached ?? [];
  if (attached.some((unitId) => !snap.units.some((unit) => unit.id === unitId && unit.revision))) throw new HttpError(422, "unknown_unit", "The unit is unknown.");
  const document = kind === "void" ? { ...body.document, rev: 1, history: [] } : body.document;
  const docBytes = Buffer.from(stableJson(document));
  const revision = sha256(docBytes);
  const next = structuredClone(catalog.value);
  next.resources.push({ id, kind, project: body.project, path, legacyId: null });
  const catalogBytes = Buffer.from(stableJson(next));
  const writes = [
    { path: file, beforeRevision: null, afterRevision: revision, afterBytesBase64: docBytes.toString("base64") },
    { path: join(fx.tree.user, "gui", "resources.json"), beforeRevision: catalog.hash, afterRevision: sha256(catalogBytes), afterBytesBase64: catalogBytes.toString("base64") },
  ];
  let attachmentRevision = null;
  if (attached.length) {
    const binding = { format: "hivem1nd-editor-binding-v1", resourceId: id, kind, attached, updatedAt: clock(fx).toISOString() };
    const bindingBytes = Buffer.from(stableJson(binding));
    attachmentRevision = sha256(bindingBytes);
    writes.push({ path: join(fx.tree.user, "relay", "editors", `${id}.json`), beforeRevision: null, afterRevision: attachmentRevision, afterBytesBase64: bindingBytes.toString("base64") });
  }
  return {
    status: 201,
    data: { id, kind, project: body.project, title: document.title ?? document.id, path, readOnly: false, revision, document, legacy: null, attached, threads: [], commentsRevision: null, attachmentRevision, proposals: [] },
    writes,
    events: [{
      name: kind === "void" ? "void.changed" : "blueprint.changed",
      resourceId: id,
      data: kind === "void"
        ? { resourceId: id, revision, rev: document.rev ?? 0, operation: "create", k: null, lang: null }
        : { resourceId: id, revision, operation: "create", nodeId: null },
    }],
  };
}

function collectNodeIds(document, ids) {
  for (const screen of document.screens ?? []) collectNode(screen.root, ids);
}

function collectNode(node, ids) {
  if (!node?.id) return;
  ids.add(node.id);
  for (const child of node.kids ?? []) collectNode(child, ids);
}

function editorFile(fx, project, path) {
  const repo = join(fx.tree.root, "repositories", project);
  const file = join(repo, ...path.split("/"));
  const rel = relative(repo, file);
  if (!rel || rel.startsWith("..")) throw new HttpError(422, "invalid_path", "The path is not valid.");
  return file;
}

function validateBoardPut(body) {
  requireObject(body, ["document", "expectedRevision"]);
  requireKeys(body, ["document", "expectedRevision"]);
  revisionField(body.expectedRevision);
  assertDocument(body.document);
}

function validateAddNode(body) {
  requireObject(body, ["screenId", "parentId", "index", "node", "expectedRevision"]);
  requireKeys(body, ["screenId", "parentId", "node", "expectedRevision"]);
  revisionField(body.expectedRevision);
  if (!body.node || typeof body.node !== "object" || Array.isArray(body.node)) throw new HttpError(422, "invalid_node", "The node is not valid.");
}

function validatePatchNode(body) {
  requireObject(body, ["changes", "expectedRevision"]);
  requireKeys(body, ["changes", "expectedRevision"]);
  revisionField(body.expectedRevision);
  if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) throw new HttpError(422, "invalid_node", "The node is not valid.");
  for (const key of ["id", "t", "kids"]) if (key in body.changes) throw new HttpError(422, "invalid_node", "Structural fields require a structural operation.");
}

function validateDeleteNode(body) {
  requireObject(body, ["expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  revisionField(body.expectedRevision);
}

function validateAsset(body) {
  requireObject(body, ["contentType", "bytesBase64"]);
  requireKeys(body, ["contentType", "bytesBase64"]);
  if (!["image/png", "image/jpeg", "image/webp"].includes(body.contentType)) throw new HttpError(422, "invalid_asset", "The asset is not an image.");
  if (typeof body.bytesBase64 !== "string") throw new HttpError(422, "invalid_asset", "The asset is not an image.");
}

async function prepareBoardPut(fx, resourceId, body) {
  const editor = await editorFor(fx, resourceId);
  if (editor.readOnly || !editor.document) throw new HttpError(409, "read_only_resource", "The resource is read only.");
  if (editor.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The board was changed elsewhere.", { currentRevision: editor.revision });
  assertCompatible(editor.document, body.document);
  assertNewLinks(editor.document, body.document);
  return writeBoard(fx, editor, body.document, { operation: "replace" });
}

async function prepareAddNode(fx, resourceId, body) {
  const editor = await mutableBoard(fx, resourceId, body.expectedRevision);
  const screen = editor.document.screens.find((item) => item.id === body.screenId);
  const parent = screen ? findNode(screen.root, body.parentId) : null;
  if (!parent || parent.node.t !== "box") throw new HttpError(422, "invalid_parent", "The parent is not a box.");
  if (findInDocument(editor.document, body.node.id)) throw new HttpError(409, "node_exists", "The node already exists.");
  const kids = parent.node.kids ?? [];
  const index = body.index ?? kids.length;
  if (!Number.isInteger(index) || index < 0 || index > kids.length) throw new HttpError(422, "invalid_node", "The index is not valid.");
  const document = structuredClone(editor.document);
  const nextParent = findNode(document.screens.find((item) => item.id === body.screenId).root, body.parentId);
  nextParent.node.kids = [...(nextParent.node.kids ?? [])];
  nextParent.node.kids.splice(index, 0, body.node);
  return writeBoard(fx, editor, document, { operation: "add-node", nodeId: body.node.id, respondNode: true });
}

async function preparePatchNode(fx, params, body) {
  const editor = await mutableBoard(fx, params.resourceId, body.expectedRevision);
  if (!findInDocument(editor.document, params.nodeId)) throw new HttpError(404, "node_not_found", "The node was not found.");
  const document = structuredClone(editor.document);
  const found = findInDocument(document, params.nodeId);
  mergeNode(found.node, body.changes);
  return writeBoard(fx, editor, document, { operation: "update-node", nodeId: params.nodeId });
}

async function prepareDeleteNode(fx, params, body) {
  const editor = await mutableBoard(fx, params.resourceId, body.expectedRevision);
  const document = structuredClone(editor.document);
  const removed = removeSubtree(document, params.nodeId);
  if (removed.root) throw new HttpError(422, "root_node", "The root node cannot be removed.");
  if (!removed.ids) throw new HttpError(404, "node_not_found", "The node was not found.");
  document.links = (document.links ?? []).filter((link) => !removed.ids.has(link.element));
  return writeBoard(fx, editor, document, { operation: "remove-node", nodeId: params.nodeId });
}

async function prepareAsset(fx, resourceId, body) {
  const editor = await editorFor(fx, resourceId);
  if (editor.readOnly) throw new HttpError(409, "read_only_resource", "The resource is read only.");
  const bytes = Buffer.from(body.bytesBase64, "base64");
  if (bytes.length > 10 * 1024 * 1024) throw new HttpError(413, "asset_too_large", "The asset is too large.");
  const extension = imageExtension(bytes, body.contentType);
  const assetId = uuid();
  const src = `docs/flows/assets/${assetId}.${extension}`;
  return {
    status: 201,
    data: { id: assetId, src, contentType: body.contentType, url: `/api/v1/editors/${resourceId}/assets/${assetId}` },
    writes: [{ path: editorFile(fx, editor.project, src), beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") }],
    events: [],
  };
}

function validateTextPut(body) {
  requireObject(body, ["document", "expectedRevision"]);
  requireKeys(body, ["document", "expectedRevision"]);
  revisionField(body.expectedRevision);
  if (!body.document || typeof body.document !== "object" || !Array.isArray(body.document.pages)) throw new HttpError(422, "invalid_document", "The document is not valid.");
}

function validateRange(body) {
  requireObject(body, ["k", "lang", "start", "end", "expectedText", "replacement", "expectedRevision", "mode", "threadId", "expectedCommentsRevision"]);
  requireKeys(body, ["k", "lang", "start", "end", "expectedText", "replacement", "expectedRevision"]);
  revisionField(body.expectedRevision);
  if (!Number.isInteger(body.start) || !Number.isInteger(body.end)) throw new HttpError(422, "invalid_range", "The selected source range is invalid.");
  if (typeof body.expectedText !== "string" || typeof body.replacement !== "string") throw new HttpError(422, "invalid_range", "The selected source range is invalid.");
  if (body.mode !== undefined && body.mode !== "apply" && body.mode !== "propose") throw new HttpError(422, "invalid_body", "The range mode is not valid.");
  if (body.mode === "propose") {
    if (typeof body.threadId !== "string" || !body.threadId || body.expectedCommentsRevision == null) {
      throw new HttpError(422, "invalid_body", "A suggestion requires a thread and a comments revision.");
    }
    revisionField(body.expectedCommentsRevision);
  }
}

function validateProposalAnswer(body) {
  requireObject(body, ["decision", "expectedRevision", "expectedCommentsRevision"]);
  requireKeys(body, ["decision", "expectedRevision", "expectedCommentsRevision"]);
  if (!["accept", "discard"].includes(body.decision)) throw new HttpError(422, "invalid_body", "The decision is not valid.");
  revisionField(body.expectedRevision);
  revisionField(body.expectedCommentsRevision);
}

async function prepareTextPut(fx, resourceId, body) {
  const editor = await mutableText(fx, resourceId, body.expectedRevision);
  assertTextCompatible(editor.document, body.document);
  const document = structuredClone(body.document);
  delete document.history;
  document.rev = (editor.document.rev ?? 0) + 1;
  return writeText(fx, editor, document, { operation: "replace", k: null, lang: null, before: "", after: "" });
}

async function prepareRange(fx, resourceId, body) {
  const editor = await mutableText(fx, resourceId, body.expectedRevision);
  const source = textSource(editor.document, body.k, body.lang);
  if (body.end < body.start || !validTextBoundary(source, body.start) || !validTextBoundary(source, body.end) || insideTag(source, body.start) || insideTag(source, body.end)) {
    throw new HttpError(422, "invalid_range", "The selected source range is invalid.");
  }
  if (source.slice(body.start, body.end) !== body.expectedText) throw new HttpError(409, "range_changed", "The source range changed.");
  if ((body.mode ?? "apply") === "propose") return proposeRange(fx, editor, body);
  const document = structuredClone(editor.document);
  const page = document.pages.find((item) => item.k === body.k);
  page[body.lang] = `${source.slice(0, body.start)}${body.replacement}${source.slice(body.end)}`;
  document.rev = (document.rev ?? 0) + 1;
  const saved = await writeText(fx, editor, document, { operation: "replace-range", k: body.k, lang: body.lang, before: body.expectedText, after: body.replacement });
  return { status: saved.status, data: { editor: saved.data, proposal: null }, writes: saved.writes, events: saved.events };
}

async function proposeRange(fx, editor, body) {
  if (editor.commentsRevision !== body.expectedCommentsRevision) throw new HttpError(409, "revision_conflict", "The comments were changed elsewhere.");
  const threads = structuredClone(editor.threads ?? []);
  const thread = threads.find((item) => item.id === body.threadId);
  if (!thread) throw new HttpError(404, "thread_not_found", "The thread was not found.");
  const text = body.replacement.trim() ? body.replacement : body.expectedText;
  if (!text.trim()) throw new HttpError(422, "invalid_range", "The selected source range is invalid.");
  const at = clock(fx).toISOString();
  const proposal = {
    id: uuid(),
    state: "pending",
    k: body.k,
    lang: body.lang,
    start: body.start,
    end: body.end,
    expectedText: body.expectedText,
    replacement: body.replacement,
    baseRevision: editor.revision,
    createdBy: "root:master",
    createdAt: at,
    decidedBy: null,
    decidedAt: null,
  };
  const next = {
    ...thread,
    status: "open",
    messages: [...(thread.messages ?? []), {
      id: uuid(),
      author: "master",
      authorId: "root:master",
      at,
      text,
      proposal,
    }],
  };
  const updated = threads.map((item) => item.id === thread.id ? next : item);
  const comments = writeComments(fx, editor, updated, next, 200, "reply");
  const published = { ...proposal, resourceId: editor.id, threadId: thread.id, commentsRevision: comments.data.commentsRevision };
  return {
    status: 200,
    data: {
      editor: {
        ...editor,
        commentsRevision: comments.data.commentsRevision,
        threads: updated,
        proposals: updated.flatMap(proposalList),
      },
      proposal: published,
    },
    writes: comments.writes,
    events: [
      ...comments.events,
      { name: "void.proposal.changed", resourceId: editor.id, data: { resourceId: editor.id, proposal: published, commentsRevision: comments.data.commentsRevision } },
    ],
  };
}

async function prepareProposal(fx, params, body) {
  const editor = await mutableText(fx, params.resourceId, body.expectedRevision);
  if (editor.commentsRevision !== body.expectedCommentsRevision) throw new HttpError(409, "revision_conflict", "The comments were changed elsewhere.");
  const proposal = editor.proposals.find((item) => item.id === params.proposalId);
  if (!proposal) throw new HttpError(404, "not_found", "The proposal was not found.");
  if (proposal.state !== "pending") throw new HttpError(409, "proposal_resolved", "The proposal was already answered.");
  const source = textSource(editor.document, proposal.k, proposal.lang);
  const stale = proposal.baseRevision !== editor.revision || source.slice(proposal.start, proposal.end) !== proposal.expectedText;
  if (body.decision === "accept" && stale) throw new HttpError(409, "proposal_stale", "The suggestion no longer matches.");
  const threads = structuredClone(editor.threads);
  const thread = threads.find((item) => (item.messages ?? []).some((message) => message.proposal?.id === proposal.id));
  const message = thread.messages.find((item) => item.proposal?.id === proposal.id);
  message.proposal = { ...message.proposal, state: body.decision === "accept" ? "accepted" : "discarded", decidedBy: "root:master", decidedAt: clock(fx).toISOString() };
  if (body.decision === "discard") {
    const comments = writeComments(fx, editor, threads, thread, 200, "reply");
    return { ...comments, status: 200, data: { ...comments.data, proposal: message.proposal, editor: { ...editor, commentsRevision: comments.data.commentsRevision, threads, proposals: threads.flatMap(proposalList) } } };
  }
  const document = structuredClone(editor.document);
  const page = document.pages.find((item) => item.k === proposal.k);
  page[proposal.lang] = `${source.slice(0, proposal.start)}${proposal.replacement}${source.slice(proposal.end)}`;
  document.rev = (document.rev ?? 0) + 1;
  const saved = await writeText(fx, editor, document, { operation: "replace-range", k: proposal.k, lang: proposal.lang, before: proposal.expectedText, after: proposal.replacement });
  const comments = writeComments(fx, { ...editor, threads }, threads, thread, 200, "reply");
  return {
    status: 200,
    data: { editor: { ...saved.data, commentsRevision: comments.data.commentsRevision, threads, proposals: threads.flatMap(proposalList) }, proposal: message.proposal },
    writes: [...saved.writes, ...comments.writes],
    events: [...saved.events, ...comments.events],
  };
}

function proposalList(thread) {
  return (thread.messages ?? []).flatMap((message) => (message.proposal ? [{ ...message.proposal, threadId: thread.id }] : []));
}

function textSource(document, k, lang) {
  const page = document.pages?.find((item) => item.k === k);
  const source = page?.[lang];
  if (typeof source !== "string") throw new HttpError(422, "invalid_range", "The selected source range is invalid.");
  return source;
}

function validTextBoundary(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function insideTag(source, offset) {
  const tags = ["<b>", "</b>", "<i>", "</i>"];
  let index = 0;
  while (index < source.length) {
    const tag = tags.find((item) => source.startsWith(item, index));
    if (!tag) {
      index += 1;
      continue;
    }
    if (offset > index && offset < index + tag.length) return true;
    index += tag.length;
  }
  return false;
}

async function mutableText(fx, resourceId, expectedRevision) {
  const editor = await editorFor(fx, resourceId);
  if (editor.kind !== "void" || editor.readOnly || !editor.document) throw new HttpError(409, "read_only_resource", "The resource is read only.");
  if (editor.revision !== expectedRevision) throw new HttpError(409, "revision_conflict", "The text was changed elsewhere.");
  return editor;
}

function assertTextCompatible(before, after) {
  for (const key of Object.keys(before)) {
    if (["rev", "pages", "title"].includes(key)) continue;
    if (stableJson(before[key]) !== stableJson(after?.[key])) throw new HttpError(409, "unsupported_fields_lost", "The edit dropped editor fields.");
  }
  for (const page of before.pages ?? []) {
    const next = (after.pages ?? []).find((item) => item.k === page.k);
    if (!next) continue;
    for (const key of Object.keys(page)) {
      if (["en", "es", "k"].includes(key)) continue;
      if (stableJson(page[key]) !== stableJson(next[key])) throw new HttpError(409, "unsupported_fields_lost", "The edit dropped editor fields.");
    }
  }
}

async function writeText(fx, editor, document, change) {
  const bytes = Buffer.from(stableJson(document));
  const revision = sha256(bytes);
  const historyPath = editorFile(fx, editor.project, editor.path).replace(/\.json$/, ".versions.jsonl");
  let prior = Buffer.alloc(0);
  let beforeRevision = null;
  try {
    prior = await readFile(historyPath);
    beforeRevision = sha256(prior);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const line = `${JSON.stringify({ at: clock(fx).toISOString(), rev: document.rev, k: change.k, lang: change.lang, before: change.before, after: change.after })}\n`;
  const history = Buffer.concat([prior, Buffer.from(line)]);
  return {
    status: 200,
    data: { ...editor, document, revision, file: undefined },
    writes: [
      { path: editorFile(fx, editor.project, editor.path), beforeRevision: editor.revision, afterRevision: revision, afterBytesBase64: bytes.toString("base64") },
      { path: historyPath, beforeRevision, afterRevision: sha256(history), afterBytesBase64: history.toString("base64") },
    ],
    events: [{
      name: "void.changed",
      resourceId: editor.id,
      data: { resourceId: editor.id, revision, rev: document.rev ?? 0, operation: change.operation ?? "replace", k: change.k ?? null, lang: change.lang ?? null },
    }],
  };
}

async function readAsset(fx, resourceId, assetId) {
  const editor = requireEditor(await projection(fx), resourceId);
  const folder = editorFile(fx, editor.project, "docs/flows/assets");
  for (const extension of ["png", "jpg", "webp"]) {
    const file = join(folder, `${assetId}.${extension}`);
    try {
      const bytes = await readFile(file);
      const contentType = extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp";
      imageExtension(bytes, contentType);
      return { bytes, contentType };
    } catch (error) {
      if (error instanceof HttpError) throw error;
    }
  }
  throw new HttpError(404, "asset_not_found", "The asset was not found.");
}

function imageExtension(bytes, contentType) {
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "image/png" && png) return "png";
  if (contentType === "image/jpeg" && jpeg) return "jpg";
  if (contentType === "image/webp" && webp) return "webp";
  throw new HttpError(422, "invalid_asset", "The asset is not an image.");
}

async function mutableBoard(fx, resourceId, expectedRevision) {
  const editor = await editorFor(fx, resourceId);
  if (editor.readOnly || !editor.document) throw new HttpError(409, "read_only_resource", "The resource is read only.");
  if (editor.revision !== expectedRevision) throw new HttpError(409, "revision_conflict", "The board was changed elsewhere.", { currentRevision: editor.revision });
  return editor;
}

function writeBoard(fx, editor, document, data) {
  const bytes = Buffer.from(stableJson(document));
  const revision = sha256(bytes);
  const editorData = { ...editor, document, revision, file: undefined, corrupt: undefined };
  return {
    status: 200,
    data: data.respondNode ? { editor: editorData, nodeId: data.nodeId } : editorData,
    writes: [{ path: editorFile(fx, editor.project, editor.path), beforeRevision: editor.revision, afterRevision: revision, afterBytesBase64: bytes.toString("base64") }],
    events: [{
      name: "blueprint.changed",
      resourceId: editor.id,
      data: { resourceId: editor.id, revision, operation: data.operation ?? "replace", nodeId: data.nodeId ?? null },
    }],
  };
}

function assertCompatible(before, after) {
  const next = identify(after);
  for (const [id, value] of identify(before)) {
    if (!next.has(id)) continue;
    if (unknownChanged(value, next.get(id))) throw new HttpError(409, "unsupported_fields_lost", "The edit dropped editor fields.");
  }
}

function assertNewLinks(before, after) {
  const screens = new Set((after.screens ?? []).map((screen) => screen.id));
  const old = new Set((before.links ?? []).map((link) => link.id));
  for (const link of after.links ?? []) {
    if (old.has(link.id)) continue;
    if (!screens.has(link.from) || !screens.has(link.to)) throw new HttpError(422, "invalid_document", "The link is not internal.");
  }
}

function identify(document) {
  const map = new Map();
  if (document?.id) map.set(`doc:${document.id}`, document);
  for (const page of document?.pages ?? []) if (page?.id) map.set(`page:${page.id}`, page);
  for (const screen of document?.screens ?? []) {
    if (screen?.id) map.set(`screen:${screen.id}`, screen);
    identifyNode(screen.root, map);
  }
  for (const link of document?.links ?? []) if (link?.id) map.set(`link:${link.id}`, link);
  for (const [name, list] of [["component", document?.components], ["font", document?.fonts], ["thread", document?.threads]]) {
    for (const item of list ?? []) if (item?.id) map.set(`${name}:${item.id}`, item);
  }
  return map;
}

function identifyNode(node, map) {
  if (!node?.id) return;
  map.set(`node:${node.id}`, node);
  for (const child of node.kids ?? []) identifyNode(child, map);
}

function unknownChanged(before, after) {
  const known = new Set(["formatVersion", "id", "title", "note", "pages", "screens", "links", "components", "fonts", "threads", "objects", "order", "start", "pageId", "x", "y", "w", "h", "root", "from", "to", "element", "transition", "direction", "duration", "name", "t", "place", "dir", "kids", "value", "color", "align", "d", "src", "icon", "fill", "stroke", "strokeWidth", "radius", "corners", "clip", "opacity", "kind", "sides", "size", "weight", "font"]);
  for (const key of Object.keys(before)) {
    if (key === "place" && before.place && typeof before.place === "object") {
      for (const placeKey of Object.keys(before.place)) {
        if (["x", "y"].includes(placeKey)) continue;
        if (stableJson(before.place[placeKey]) !== stableJson(after.place?.[placeKey])) return true;
      }
    }
    if (known.has(key)) continue;
    if (stableJson(before[key]) !== stableJson(after?.[key])) return true;
  }
  return false;
}

function findInDocument(document, nodeId) {
  for (const screen of document.screens ?? []) {
    const found = findNode(screen.root, nodeId);
    if (found) return { ...found, screen };
  }
  return null;
}

function findNode(node, nodeId, parent = null) {
  if (!node) return null;
  if (node.id === nodeId) return { node, parent };
  for (const child of node.kids ?? []) {
    const found = findNode(child, nodeId, node);
    if (found) return found;
  }
  return null;
}

function mergeNode(node, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value && typeof value === "object" && !Array.isArray(value) && node[key] && typeof node[key] === "object" && !Array.isArray(node[key])) mergeNode(node[key], value);
    else node[key] = value;
  }
}

function removeSubtree(document, nodeId) {
  for (const screen of document.screens ?? []) {
    if (screen.root?.id === nodeId) return { root: true, ids: null };
    const ids = detach(screen.root, nodeId);
    if (ids) return { root: false, ids };
  }
  return { root: false, ids: null };
}

function detach(node, nodeId) {
  const kids = node.kids ?? [];
  const index = kids.findIndex((child) => child.id === nodeId);
  if (index >= 0) {
    const [removed] = kids.splice(index, 1);
    node.kids = kids;
    const ids = new Set();
    collectNodeIds({ screens: [{ root: removed }] }, ids);
    return ids;
  }
  for (const child of kids) {
    const ids = detach(child, nodeId);
    if (ids) return ids;
  }
  return null;
}

function validateUndo(body) {
  requireObject(body, ["expectedRevision"]);
  requireKeys(body, ["expectedRevision"]);
  revisionField(body.expectedRevision);
}

async function prepareAnswer(fx, approvalId, body) {
  const snap = await projection(fx);
  const approval = snap.approvals.find((item) => item.id === approvalId);
  if (!approval) throw new HttpError(404, "not_found", "The approval was not found.");
  if (approval.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The approval was changed elsewhere.");
  if (approval.state === "expired" || Date.parse(approval.expiresAt) <= fx.nowMs) throw new HttpError(410, "approval_expired", "The approval has expired.");
  if (body.decision === "approve-always" && approval.alwaysAllowed === false) throw new HttpError(422, "always_unavailable", "Approve always is not available.");
  if (approval.state !== "pending") throw new HttpError(409, "approval_resolved", "The approval was already answered.");
  const answerId = uuid();
  const answer = { decision: body.decision, at: clock(fx).toISOString(), answerId };
  const bytes = Buffer.from(stableJson(answer));
  const record = { answerId, approvalId, state: "queued", resultAnswerId: null, at: null, decision: body.decision };
  fx.answers.set(answerId, record);
  const nextApproval = {
    ...approval,
    state: "answering",
    answer,
    answerOutcomes: [...(approval.answerOutcomes ?? []), { answerId, approvalId, state: "queued", resultAnswerId: null, at: null }],
  };
  return {
    status: 202,
    data: { approval: nextApproval, answerId },
    writes: [{ path: join(fx.tree.user, "relay", "approvals", approvalId, "answers", `${answerId}.json`), beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "approval.answered", global: true, unitId: approval.unitId, data: { approval: nextApproval } }],
  };
}

async function prepareRevoke(fx, params, body) {
  const snap = await projection(fx);
  const unit = snap.units.find((item) => item.id === params.unitId);
  const grant = unit?.approvalGrants?.find((item) => item.id === params.grantId);
  if (!unit || !grant) throw new HttpError(404, "grant_not_found", "The grant was not found.");
  if (unit.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The unit was changed elsewhere.");
  const requestId = uuid();
  const record = { requestId, unitId: unit.id, grantId: grant.id, state: "pending", revision: unit.revision };
  fx.revocations.set(requestId, record);
  return { status: 202, data: record, writes: [], events: [] };
}

async function prepareTaskStatus(fx, taskId, body, principal) {
  const snap = await projection(fx);
  const task = snap.tasks.find((item) => item.id === taskId);
  if (!task) throw new HttpError(404, "task_not_found", "The task was not found.");
  if (principal.audience === "phone" && !(task.status === "review" && task.reviewable === true && (body.status === "done" || body.status === "open"))) {
    throw new HttpError(403, "phone_read_only", "The phone cannot change this.");
  }
  if (task.revision !== body.expectedRevision) throw new HttpError(409, "revision_conflict", "The task was changed elsewhere.");
  if (body.status === task.status) throw new HttpError(409, "status_unchanged", "The status is already set.");
  if (body.status === "done" && task.status === "review" && !task.reviewable) throw new HttpError(409, "review_not_ready", "The lead has not approved this delivery.");
  if (task.status === "review" && body.status === "open" && !String(body.note ?? "").trim()) throw new HttpError(422, "note_required", "A note is required.");
  const previous = await readFile(task.file);
  const next = Buffer.from(replaceStatus(previous.toString("utf8"), body.status, body.note));
  const changeId = uuid();
  fx.taskUndo.set(taskId, { bytes: previous, changeId });
  const updated = { ...publicTask(task), status: body.status, reviewable: false, undoAvailable: true, revision: sha256(next) };
  return {
    status: 200,
    data: { task: updated, changeId },
    writes: [{ path: task.file, beforeRevision: task.revision, afterRevision: updated.revision, afterBytesBase64: next.toString("base64") }],
    events: [{ name: "task.changed", data: { task: updated, changeId, undoOf: null } }],
  };
}

async function prepareUndo(fx, taskId, body) {
  const snap = await projection(fx);
  const task = snap.tasks.find((item) => item.id === taskId);
  if (!task) throw new HttpError(404, "task_not_found", "The task was not found.");
  if (task.revision !== body.expectedRevision) throw new HttpError(409, "undo_conflict", "The task was changed elsewhere.");
  const previous = fx.taskUndo.get(taskId);
  if (!previous) throw new HttpError(409, "nothing_to_undo", "There is nothing to undo.");
  const restored = /^status: (.+)$/m.exec(previous.bytes.toString("utf8"))?.[1] ?? task.status;
  const changeId = uuid();
  const updated = { ...publicTask(task), status: restored, revision: sha256(previous.bytes), undoAvailable: false };
  fx.taskUndo.delete(taskId);
  return {
    status: 200,
    data: { task: updated, changeId, undoOf: previous.changeId },
    writes: [{ path: task.file, beforeRevision: task.revision, afterRevision: updated.revision, afterBytesBase64: previous.bytes.toString("base64") }],
    events: [{ name: "task.changed", data: { task: updated, changeId, undoOf: previous.changeId } }],
  };
}

function replaceStatus(text, status, note) {
  const rows = text.replace(/\s*$/, "").split("\n");
  const index = rows.findIndex((row) => row.startsWith("status:"));
  if (index >= 0) rows[index] = `status: ${status}`;
  const extra = String(note ?? "").trim() ? `\n\n${String(note).trim()}\n` : "\n";
  return `${rows.join("\n")}${extra}`;
}

async function checkMutation(fx, pattern, params, body) {
  if (pattern === "/units" || pattern === "/units/:unitId/lead" || pattern === "/units/:unitId/session") {
    const snap = await projection(fx);
    if (pattern === "/units") await rejectUnit(snap, body);
    if (pattern === "/units/:unitId/lead") rejectLead(snap, params.unitId, body);
    if (pattern === "/units/:unitId/session") await rejectSession(fx, snap, params.unitId, body);
  }
  if (pattern === "/sessions/:sessionId/stop") await rejectStop(fx, params.sessionId);
  if (pattern === "/layout") {
    const current = await loadLayout(fx);
    if ((body.expectedRevision ?? null) !== current.revision) {
      throw new HttpError(409, "revision_conflict", "The layout was changed elsewhere.", { currentRevision: current.revision });
    }
  }
  if (pattern === "/settings") {
    const current = await loadSettings(fx);
    if ((body.expectedRevision ?? null) !== current.revision) {
      throw new HttpError(409, "revision_conflict", "The settings were changed elsewhere.", { currentRevision: current.revision });
    }
  }
  if (pattern === "/chats/:chatId/messages") {
    const snap = await projection(fx);
    if (body.replyTo && !snap.messages.some((message) => message.chatId === params.chatId && message.id === body.replyTo)) {
      throw new HttpError(422, "invalid_reply", "The reply target was not found.");
    }
  }
}

async function prepareMutation(fx, pattern, params, body, principal) {
  if (pattern === "/units") return prepareUnit(fx, body);
  if (pattern === "/units/:unitId/lead") return prepareLead(fx, params.unitId, body);
  if (pattern === "/units/:unitId/session") return prepareSession(fx, params.unitId, body);
  if (pattern === "/sessions/:sessionId/stop") return prepareStop(fx, params.sessionId);
  if (pattern === "/approvals/:approvalId/answer") return prepareAnswer(fx, params.approvalId, body);
  if (pattern === "/units/:unitId/approval-grants/:grantId") return prepareRevoke(fx, params, body);
  if (pattern === "/tasks/:taskId/status") return prepareTaskStatus(fx, params.taskId, body, principal);
  if (pattern === "/tasks/:taskId/undo") return prepareUndo(fx, params.taskId, body);
  if (pattern === "/editors/:resourceId/comments") return prepareComment(fx, params.resourceId, body);
  if (pattern === "/editors/:resourceId/comments/:threadId/replies") return prepareReply(fx, params, body);
  if (pattern === "/editors/:resourceId/comments/:threadId") return prepareThreadStatus(fx, params, body);
  if (pattern === "/editors/:resourceId/attachments") return prepareAttachments(fx, params.resourceId, body);
  if (pattern === "/watch") return prepareWatch(fx, body, principal);
  if (pattern === "/watch/:watchId") return prepareStopWatch(fx, params.watchId, principal);
  if (pattern === "/viewer") return prepareViewer(fx, body, principal);
  if (pattern === "/editors/register") return prepareRegister(fx, body);
  if (pattern === "/blueprint/boards") return prepareCreateEditor(fx, "blueprint", body);
  if (pattern === "/void/texts") return prepareCreateEditor(fx, "void", body);
  if (pattern === "/blueprint/boards/:resourceId") return prepareBoardPut(fx, params.resourceId, body);
  if (pattern === "/blueprint/boards/:resourceId/nodes" && body.node) return prepareAddNode(fx, params.resourceId, body);
  if (pattern === "/blueprint/boards/:resourceId/nodes/:nodeId" && body.changes) return preparePatchNode(fx, params, body);
  if (pattern === "/blueprint/boards/:resourceId/nodes/:nodeId") return prepareDeleteNode(fx, params, body);
  if (pattern === "/editors/:resourceId/assets") return prepareAsset(fx, params.resourceId, body);
  if (pattern === "/void/texts/:resourceId") return prepareTextPut(fx, params.resourceId, body);
  if (pattern === "/void/texts/:resourceId/ranges") return prepareRange(fx, params.resourceId, body);
  if (pattern === "/void/texts/:resourceId/proposals/:proposalId/answer") return prepareProposal(fx, params, body);
  if (pattern === "/chats") return prepareChat(fx, body, principal);
  if (pattern === "/chats/:chatId") return prepareChatPatch(fx, params.chatId, body);
  if (pattern === "/layout") return prepareLayout(fx, body);
  if (pattern === "/settings") return prepareSettings(fx, body);
  if (pattern === "/settings/home-network") return prepareHomeNetwork(fx, body, principal);
  if (pattern === "/chats/:chatId/messages") return prepareChatPost(fx, body, principal, params.chatId);
  if (pattern === "/chats/:chatId/read") return prepareChatRead(fx, body, principal, params.chatId);
  if (pattern === "/mailboxes/:unitId/read") return prepareMailboxRead(fx, body, params.unitId);
  if (pattern === "/mailboxes/:unitId/messages") return prepareMailboxPost(fx, body, principal, params.unitId);
  throw new HttpError(404, "not_found", "The route was not found.");
}

async function prepareMailboxPost(fx, body, principal, unitId) {
  const id = uuid();
  const now = clock(fx).toISOString();
  const stamp = now.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  const document = markdownMessage({
    id, from: "master", "from-id": principal.unitId, to: unitId.split(":").at(-1), "to-id": unitId,
    machine: LOCAL_MACHINE, timestamp: now, priority: body.priority ?? "normal", subject: body.subject ?? "",
    "thread-id": id, "reply-to": body.replyTo ?? null, "reply-requested": body.replyRequested ? "true" : "false",
    attachments: body.attachments ?? [], kind: "message",
  }, body.body);
  const bytes = Buffer.from(document);
  const scope = unitId.startsWith("project:") ? join(fx.tree.user, "projects", unitId.split(":")[1], "inbox", unitId.split(":").at(-1))
    : unitId.startsWith("env:") ? join(fx.tree.user, "envs", unitId.split(":")[1], "inbox", unitId.split(":").at(-1))
      : join(fx.tree.user, "inbox", unitId.split(":").at(-1));
  const message = publicMessage({
    id, fromId: principal.unitId, toId: unitId, machine: LOCAL_MACHINE, timestamp: now, date: null,
    priority: body.priority ?? "normal", subject: body.subject ?? "", body: body.body, threadId: id,
    replyTo: body.replyTo ?? null, replyRequested: Boolean(body.replyRequested), attachments: body.attachments ?? [],
    kind: "message", read: false, notice: null,
  });
  return {
    status: 201,
    data: message,
    writes: [{ path: join(scope, `${stamp}-${LOCAL_MACHINE}-${id}.md`), beforeRevision: null, afterRevision: sha256(bytes), afterBytesBase64: bytes.toString("base64") }],
    events: [{ name: "message.created", data: { chatId: null, mailboxId: unitId, message } }],
  };
}

async function handleAuth(fx, request, response, audience, path, requestId) {
  const raw = await readBody(request);
  if (!String(request.headers["content-type"] ?? "").includes("application/json")) throw new HttpError(415, "unsupported_media_type", "JSON is required.");
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "The JSON body is not valid.");
  }
  if (path === "/auth/local") {
    if (audience.kind !== "desktop") throw new HttpError(403, "forbidden", "Local exchange is only available on the desktop listener.");
    const secret = bearer(request);
    const bootstrap = JSON.parse(await readFile(join(fx.local, "bootstrap.json"), "utf8"));
    if (!safeEqual(secret, bootstrap.secret)) throw new HttpError(401, "invalid_bootstrap", "The bootstrap secret is invalid.");
    requireObject(body, ["embedded", "hostOrigin", "look", "language"]);
    requireKeys(body, ["embedded", "hostOrigin", "look", "language"]);
    if (typeof body.embedded !== "boolean") throw new HttpError(422, "invalid_body", "The request body is not valid.");
    const hostOrigin = body.embedded ? canonicalOrigin(body.hostOrigin) : null;
    if (body.embedded && !hostOrigin) throw new HttpError(422, "invalid_host_origin", "The host origin is not valid.");
    if (!body.embedded && body.hostOrigin !== null) throw new HttpError(422, "invalid_host_origin", "The host origin is not valid.");
    if (![null, "modern", "high-contrast"].includes(body.look)) throw new HttpError(422, "invalid_body", "The look is not valid.");
    if (![null, "en", "es"].includes(body.language)) throw new HttpError(422, "invalid_body", "The language is not valid.");
    const viewer = createViewer(fx, { embedded: body.embedded, hostOrigin, look: body.look, language: body.language, audience: "desktop" });
    sendJson(response, 201, success(fx, {
      token: viewer.token, viewerId: viewer.viewerId, origin: fx.desktop.origin, url: viewer.url,
      capabilities: viewer.capabilities, expiresAt: null,
    }, requestId, cursorNow(fx)));
    return;
  }
  if (audience.kind !== "home") throw new HttpError(403, "forbidden", "Home exchange is only available on the home listener.");
  const keys = Object.keys(body);
  if (!(keys.length === 1 && (keys[0] === "key" || keys[0] === "code"))) throw new HttpError(422, "invalid_body", "A home key or code is required.");
  if (!fx.home || fx.nowMs >= Date.parse(fx.home.expiresAt)) throw new HttpError(410, "home_expired", "Home access has expired.");
  const presented = String(body.key ?? body.code ?? "");
  const expected = body.key ? fx.home.key : fx.home.code;
  const normalized = body.code ? presented.toUpperCase() : presented;
  if (!safeEqual(normalized, expected)) {
    noteHomeFailure(fx, request.socket.remoteAddress);
    throw new HttpError(401, "invalid_home_key", "The home key is not valid.");
  }
  const viewer = createViewer(fx, { embedded: false, hostOrigin: null, look: null, language: null, audience: "phone", expiresAt: fx.home.expiresAt });
  sendJson(response, 200, success(fx, {
    token: viewer.token, audience: "phone", expiresAt: fx.home.expiresAt, capabilities: viewer.capabilities,
  }, requestId, cursorNow(fx)));
}

function noteHomeFailure(fx, remote) {
  const now = Date.now();
  const bucket = fx.homeFailures.get(remote) ?? [];
  const recent = bucket.filter((at) => now - at < 60_000);
  recent.push(now);
  fx.homeFailures.set(remote, recent);
  const grantFailures = (fx.homeGrantFailures ?? []).filter((at) => now - at < 60_000);
  grantFailures.push(now);
  fx.homeGrantFailures = grantFailures;
  if (recent.length > 5 || grantFailures.length > 30) {
    const error = new HttpError(429, "auth_rate_limited", "Too many home attempts.", {}, new Date(now + 60_000).toISOString());
    error.retryAfter = 60;
    throw error;
  }
}

function createViewer(fx, input) {
  const token = randomBytes(32).toString("base64url");
  const viewerId = uuid();
  const principal = {
    id: input.audience === "phone" ? "phone-user" : "desktop-user",
    audience: input.audience,
    capabilities: input.audience === "phone" ? PHONE_CAPS : DESKTOP_CAPS,
    viewerId,
    token,
    embedded: input.embedded,
    hostOrigin: input.hostOrigin,
    look: input.look,
    language: input.language,
    dirty: false,
    unitId: "root:master",
    expiresAt: input.expiresAt ?? null,
  };
  principal.url = `${fx.desktop.origin}/gui/${viewerId}/#session=${token}`;
  fx.tokens.set(token, principal);
  fx.viewers.set(viewerId, principal);
  return principal;
}

function revokeViewer(fx, viewerId) {
  const viewer = fx.viewers.get(viewerId);
  if (!viewer) return;
  fx.tokens.delete(viewer.token);
  fx.viewers.delete(viewerId);
  for (const stream of [...fx.streams]) {
    if (stream.principal.viewerId === viewerId) endStream(stream);
  }
  for (const [watchId, watch] of [...fx.watches]) {
    if (watch.viewerId === viewerId) fx.watches.delete(watchId);
  }
}

function revokeAudience(fx, audience) {
  for (const viewer of [...fx.viewers.values()]) if (viewer.audience === audience) revokeViewer(fx, viewer.viewerId);
}

async function handleEvents(fx, request, response, principal, url, requestId) {
  const query = queryMap(url);
  for (const key of query.keys()) if (!["unitId", "chatId", "resourceId"].includes(key)) throw new HttpError(400, "invalid_query", "The query is not valid.");
  await enqueue(fx, async () => {
    const open = [...fx.streams].filter((stream) => stream.principal.id === principal.id && !stream.closed);
    if (open.length >= 4) {
      const error = new HttpError(429, "request_rate_limited", "Too many event streams are open.");
      error.retryAfter = 1;
      throw error;
    }
    const stream = {
      response, principal, closed: false, requestId,
      filters: { unitId: query.get("unitId") ?? null, chatId: query.get("chatId") ?? null, resourceId: query.get("resourceId") ?? null },
    };
    fx.streams.add(stream);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    const last = request.headers["last-event-id"];
    const known = last ? fx.ring.find((record) => record.id === last) : null;
    if (last && (!known || !last.startsWith(`${fx.serviceId}:`))) {
      const reason = last.startsWith(`${fx.serviceId}:`) ? "cursor_expired" : "service_restarted";
      publish(fx, [{ name: "stream.reset", global: true, viewerId: principal.viewerId, data: { reason, cursor: cursorNow(fx) } }], principal);
    } else if (known) {
      for (const record of fx.ring) {
        if (record.seq <= known.seq || record.name === "stream.ready" || record.name === "stream.reset") continue;
        writeStream(stream, record);
      }
    }
    publish(fx, [{
      name: "stream.ready", global: true, viewerId: principal.viewerId,
      data: { cursor: planCursor(fx, 1), readAt: clock(fx).toISOString(), capabilities: principal.capabilities },
    }], principal);
    stream.done = new Promise((resolve) => {
      stream.finish = resolve;
    });
  });
  const stream = [...fx.streams].find((item) => item.response === response);
  request.on("close", () => endStream(stream));
  await stream?.done;
}

function endStream(stream) {
  if (!stream || stream.closed) return;
  stream.closed = true;
  stream.response.end();
  stream.finish?.();
}

function disconnectStreams(fx) {
  for (const stream of [...fx.streams]) endStream(stream);
  fx.streams.clear();
}

async function listen(fx, kind) {
  const sockets = new Set();
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15_000 }, async (request, response) => {
    const requestId = uuid();
    try {
      await handleApi(fx, request, response, fx[kind]);
    } catch (error) {
      if (error instanceof CrashError || error?.crash) {
        request.socket.destroy();
        return;
      }
      if (!response.headersSent) sendError(response, error, requestId);
      else response.end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const port = server.address().port;
  fx[kind] = { server, sockets, port, kind: kind === "homeListener" ? "home" : kind, origin: `http://${HOST}:${port}` };
}

async function writeBootstrap(fx) {
  const secret = randomBytes(32).toString("base64url");
  await writeAtomic(join(fx.local, "bootstrap.json"), Buffer.from(stableJson({
    format: "hivem1nd-bootstrap-v1",
    origin: fx.desktop?.origin ?? null,
    secret,
    startedAt: clock(fx).toISOString(),
  })));
  await chmod(join(fx.local, "bootstrap.json"), 0o600).catch(() => undefined);
  fx.bootstrapSecret = secret;
}

function openHome(fx) {
  const duration = fx.scenario === "home-expiry" ? 1000 : HOME_MS;
  fx.home = {
    key: FIXTURE_HOME_KEY,
    code: FIXTURE_HOME_CODE,
    openedAt: clock(fx).toISOString(),
    expiresAt: new Date(fx.nowMs + duration).toISOString(),
    addresses: [{ origin: fx.homeListener.origin }],
  };
}

async function boot(fx, { seedHome = false } = {}) {
  await recoverIntents(fx);
  await listen(fx, "desktop");
  await listen(fx, "homeListener");
  await writeBootstrap(fx);
  if (seedHome) openHome(fx);
  const embedded = fx.scenario === "embedded";
  const viewer = createViewer(fx, {
    embedded, hostOrigin: embedded ? "https://embed.example" : null, look: null, language: null, audience: "desktop",
  });
  fx.primary = viewer;
}

export async function createGuiFixture(options = {}) {
  const tree = await createFixtureTree();
  const seeded = await seedRecords(tree, options);
  const fx = {
    tree,
    local: seeded.local,
    scenario: options.scenario ?? "standard",
    nowMs: Date.parse(options.now ?? seeded.data.now),
    serviceId: uuid(),
    eventSeq: 0,
    ring: [],
    broadcast: new Set(),
    tokens: new Map(),
    viewers: new Map(),
    streams: new Set(),
    memoryReceipts: new Map(),
    homeFailures: new Map(),
    home: null,
    fault: null,
    noticeFailure: null,
    answers: new Map(),
    revocations: new Map(),
    taskUndo: new Map(),
    watches: new Map(),
    activity: [],
    sessionRequests: new Map(),
    sessionStops: new Map(),
    cache: null,
    tail: Promise.resolve(),
    closed: false,
    desktop: null,
    homeListener: null,
  };
  try {
    await boot(fx, { seedHome: fx.scenario !== "empty" });
  } catch (error) {
    await tree.cleanup();
    throw error;
  }
  const api = {
    get origin() { return fx.desktop.origin; },
    get desktopUrl() { return fx.primary.url; },
    get phoneUrl() { return `${fx.homeListener.origin}/#home=${FIXTURE_HOME_KEY}`; },
    get headers() { return { Authorization: `Bearer ${fx.primary.token}`, Origin: fx.desktop.origin }; },
    get root() { return tree.root; },
    control: {
      emit(name, data, source) {
        return enqueue(fx, async () => publish(fx, [{ name, data, source: source ?? serviceSource(), global: true }], fx.primary));
      },
      holdReads() {
        if (fx.readGate) return;
        fx.readWaits = 0;
        fx.readGate = new Promise((resolve) => { fx.releaseReads = resolve; });
      },
      releaseReads() {
        const release = fx.releaseReads;
        fx.readGate = null;
        fx.releaseReads = null;
        release?.();
      },
      readsWaiting() { return fx.readWaits ?? 0; },
      replay(id) {
        return enqueue(fx, async () => {
          const record = fx.ring.find((item) => item.id === id);
          if (!record) throw new Error("Unknown event.");
          for (const stream of fx.streams) writeStream(stream, record);
          return id;
        });
      },
      advance(ms) {
        return enqueue(fx, async () => {
          fx.nowMs += ms;
          if (fx.home && fx.nowMs >= Date.parse(fx.home.expiresAt)) {
            const home = homeStatus(fx);
            fx.home = null;
            revokeAudience(fx, "phone");
            publish(fx, [{ name: "home.changed", global: true, data: { home: { ...home, enabled: false, remainingSeconds: 0 }, reason: "expired" } }], fx.primary);
          }
        });
      },
      changeResource(id, change) {
        return enqueue(fx, async () => {
          const snap = await projection(fx);
          const file = snap.files.units.get(id);
          if (!file) throw new Error("Unknown fixture resource.");
          const text = await readFile(file, "utf8");
          await writeAtomic(file, Buffer.from(`${text.replace(/\s*$/, "")}\n\n${String(change ?? "changed")}\n`));
          invalidate(fx);
          const unit = (await projection(fx)).units.find((item) => item.id === id);
          publish(fx, [{ name: "unit.changed", unitId: id, data: { unit } }], fx.primary);
        });
      },
      setFault(fault) { fx.fault = fault; },
      setNoticeFailure(unitId) { fx.noticeFailure = unitId; },
      openDesktop() {
        return enqueue(fx, async () => createViewer(fx, { embedded: false, hostOrigin: null, look: null, language: null, audience: "desktop" }).url);
      },
      refresh() {
        return enqueue(fx, async () => { invalidate(fx); });
      },
      noteActivity(activity) {
        return enqueue(fx, async () => {
          let kind = activity.kind === "void" || activity.kind === "blueprint" ? activity.kind : null;
          if (!kind && activity.resourceId) {
            try {
              kind = requireEditor(await projection(fx), activity.resourceId).kind === "void" ? "void" : "blueprint";
            } catch {
              kind = "blueprint";
            }
          }
          const record = {
            resourceId: activity.resourceId ?? null,
            kind: kind ?? "blueprint",
            unitId: activity.unitId,
            at: clock(fx).toISOString(),
            focus: activityFocus(activity.focus),
          };
          fx.activity.push({ ...record, ms: fx.nowMs });
          const events = [];
          for (const watch of fx.watches.values()) {
            const sameResource = !watch.resourceId || watch.resourceId === record.resourceId;
            if (watch.unitId !== record.unitId || !sameResource) continue;
            watch.state = "watching";
            if (!watch.resourceId) watch.resourceId = record.resourceId ?? null;
            events.push({ name: "watch.changed", viewerId: watch.viewerId, data: { watchId: watch.watchId, state: watch.state, unitId: watch.unitId, resourceId: watch.resourceId } });
          }
          events.push({ name: "editor.activity", global: true, resourceId: record.resourceId ?? null, unitId: record.unitId, data: record });
          publish(fx, events, fx.primary);
        });
      },
      editBoard(resourceId) {
        return enqueue(fx, async () => {
          const editor = requireEditor(await projection(fx), resourceId);
          const document = structuredClone(editor.document);
          document.note = `${document.note ?? ""} outside`;
          const bytes = Buffer.from(stableJson(document));
          await writeAtomic(editorFile(fx, editor.project, editor.path), bytes);
          invalidate(fx);
          publish(fx, [{ name: "blueprint.changed", resourceId, global: true, data: { resourceId, revision: sha256(bytes), operation: "import", nodeId: null } }], fx.primary);
        });
      },
      setLook(look) {
        return enqueue(fx, async () => {
          for (const viewer of fx.viewers.values()) if (viewer.audience === "desktop") viewer.look = look;
          publish(fx, [{ name: "viewer.changed", global: true, data: { look } }], fx.primary);
        });
      },
      settleAnswer(answerId, state) {
        return enqueue(fx, async () => {
          const current = fx.answers.get(answerId);
          if (!current) throw new Error("Unknown answer.");
          current.state = state;
          current.at = clock(fx).toISOString();
          const approvalState = state === "applied"
            ? (current.decision === "deny" ? "denied" : "approved")
            : (state === "expired" ? "expired" : null);
          if (state === "applied") current.resultAnswerId = answerId;
          const outcome = {
            format: "hivem1nd-approval-answer-result-v1",
            answerId,
            approvalId: current.approvalId,
            state,
            resultAnswerId: state === "applied" ? answerId : null,
            at: current.at,
          };
          await writeAtomic(join(fx.tree.user, "relay", "approvals", current.approvalId, "answer-results", `${answerId}.json`), Buffer.from(stableJson(outcome)));
          if (approvalState) {
            const result = {
              format: "hivem1nd-approval-result-v1",
              approvalId: current.approvalId,
              state: approvalState,
              answerId,
              grantId: approvalState === "approved" && current.decision === "approve-always" ? uuid() : null,
              at: current.at,
            };
            await writeAtomic(join(fx.tree.user, "relay", "approvals", current.approvalId, "result.json"), Buffer.from(stableJson(result)));
          }
          invalidate(fx);
          const approval = (await projection(fx)).approvals.find((item) => item.id === current.approvalId);
          publish(fx, [{ name: "approval.answered", global: true, unitId: approval?.unitId, data: { approval } }], fx.primary);
        });
      },
      settleRevocation(requestId) {
        return enqueue(fx, async () => {
          const current = fx.revocations.get(requestId);
          if (!current) throw new Error("Unknown revocation.");
          const revision = await dropGrant(fx, current.unitId, current.grantId);
          current.state = "revoked";
          current.revision = revision;
          publish(fx, [{
            name: "approval.grant.changed",
            global: true,
            unitId: current.unitId,
            data: { unitId: current.unitId, grantId: current.grantId, operation: "revoked", revision },
          }], fx.primary);
        });
      },
      editTask(taskId, extra) {
        return enqueue(fx, async () => {
          const task = (await projection(fx)).tasks.find((item) => item.id === taskId);
          if (!task) throw new Error("Unknown task.");
          const text = await readFile(task.file, "utf8");
          await writeAtomic(task.file, Buffer.from(`${text.replace(/\s*$/, "")}\n\n${extra}\n`));
          invalidate(fx);
        });
      },
      seedMessages(chatId, count) {
        return enqueue(fx, async () => {
          const base = Date.parse("2026-10-10T12:00:00.000Z");
          for (let index = 0; index < count; index += 1) {
            const id = deterministicUuid(["fixture-message", chatId, index]);
            const stamp = new Date(base + index * 1000).toISOString();
            const text = `id: ${id}\nfrom: master\nfrom-id: root:master\nto: chat:${chatId}\nto-id: chat:${chatId}\nmachine: ${LOCAL_MACHINE}\ntimestamp: ${stamp}\npriority: normal\nsubject: note ${index}\nthread-id: ${chatId}\nkind: message\n\nMessage ${index}\n`;
            await writeAtomic(join(fx.tree.user, "relay", "chats", chatId, `${id}.md`), Buffer.from(text));
          }
          invalidate(fx);
        });
      },
      setSession(requestId, state, error = null) {
        return enqueue(fx, async () => {
          const current = fx.sessionRequests.get(requestId);
          if (!current) throw new Error("Unknown session request.");
          current.state = state;
          current.error = error ? { code: error, message: "The launch did not finish." } : null;
          if (state === "started" && !current.sessionId) current.sessionId = uuid();
          publish(fx, [{ name: "session.request.changed", global: true, unitId: current.unitId, data: sessionRequestData(current) }], fx.primary);
        });
      },
      patchSession(requestId, state, error = null) {
        return enqueue(fx, async () => {
          const current = fx.sessionRequests.get(requestId);
          if (!current) throw new Error("Unknown session request.");
          current.state = state;
          current.error = error ? { code: error, message: "The launch did not finish." } : null;
          if (state === "started" && !current.sessionId) current.sessionId = uuid();
        });
      },
      acknowledgeStop(sessionId) {
        return enqueue(fx, async () => {
          const current = fx.sessionStops.get(sessionId);
          if (!current || current.state !== "stopping") throw new Error("The session is not stopping.");
          current.state = "stopped";
          const found = (await projection(fx)).sessions.find((item) => item.id === sessionId);
          const session = { ...(found ?? { id: sessionId }), state: "stopped" };
          publish(fx, [{ name: "session.changed", global: true, data: { session } }], fx.primary);
        });
      },
      disconnectStreams() { disconnectStreams(fx); },
      async restart() {
        await fx.tail;
        disconnectStreams(fx);
        await closeServers(fx);
        fx.tokens.clear();
        fx.viewers.clear();
        fx.home = null;
        fx.memoryReceipts.clear();
        fx.ring = [];
        fx.serviceId = uuid();
        fx.eventSeq = 0;
        fx.broadcast = new Set();
        invalidate(fx);
        await boot(fx);
      },
      revokeViewer(id) { revokeViewer(fx, id); },
      watchCount() { return fx.watches.size; },
    },
    async close() {
      if (fx.closed) return;
      fx.closed = true;
      const release = fx.releaseReads;
      fx.readGate = null;
      fx.releaseReads = null;
      release?.();
      disconnectStreams(fx);
      await closeServers(fx);
      await fx.tail;
      await tree.cleanup();
    },
  };
  fx.api = api;
  return api;
}

async function closeServers(fx) {
  for (const slot of [fx.desktop, fx.homeListener]) {
    if (!slot?.server) continue;
    for (const socket of slot.sockets) socket.destroy();
    await new Promise((resolve) => slot.server.close(() => resolve()));
  }
}

async function main() {
  const index = process.argv.indexOf("--scenario");
  const scenario = index >= 0 ? process.argv[index + 1] : "standard";
  const fixture = await createGuiFixture({ scenario });
  const linksPath = join(fixture.root, "links.json");
  await writeFile(linksPath, JSON.stringify({ desktop: fixture.desktopUrl, phone: fixture.phoneUrl }, null, 2));
  await chmod(linksPath, 0o600).catch(() => undefined);
  process.stdout.write(`${fixture.origin}\n`);
  const shutdown = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.on("SIGINT", () => { shutdown().catch(() => process.exit(1)); });
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const [command, ...rest] = line.trim().split(/\s+/);
      if (command === "quit") shutdown().catch(() => process.exit(1));
      else if (command === "advance") fixture.control.advance(Number(rest[0] ?? 0)).catch(() => undefined);
      else if (command === "disconnect") fixture.control.disconnectStreams();
      else if (command === "emit") fixture.control.emit(rest[0], JSON.parse(rest.slice(1).join(" ") || "{}")).catch(() => undefined);
      else if (command === "session") fixture.control.setSession(rest[0], rest[1], rest[2] ?? null).catch(() => undefined);
      else if (command === "stopped") fixture.control.acknowledgeStop(rest[0]).catch(() => undefined);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
