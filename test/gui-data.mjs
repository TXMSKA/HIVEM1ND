import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, dirname, relative, resolve } from "node:path";

export const DEFAULT_NOW = "2026-10-10T12:00:00.000Z";
export const FIXTURE_HOME_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const FIXTURE_HOME_CODE = "234567";
export const LOCAL_MACHINE = "DESKTOP";

const ROLES = new Set(["overseer", "adjutant", "executive", "overlord", "executor", "incubator", "genesis", "master"]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
}

export function stableJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function deterministicUuid(parts) {
  const digest = createHash("sha256").update(JSON.stringify(canonical(parts))).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function mindKey(mindPath) {
  const resolved = resolve(mindPath);
  const input = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return sha256(input).slice(0, 16);
}

export function localDirectory(mindPath, machine = LOCAL_MACHINE) {
  return join(dirname(mindPath), "hivem1nd-service", mindKey(mindPath), machine);
}

export function isInsideRoot(rootReal, targetReal) {
  const rel = relative(rootReal, targetReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function removeOwned(root, target) {
  const rootReal = await realpath(root);
  let targetReal = resolve(target);
  try {
    targetReal = await realpath(target);
  } catch {
    // A missing path is still checked from its resolved location before any removal.
  }
  if (!isInsideRoot(rootReal, targetReal)) {
    throw new Error("Refusing to remove a path outside the fixture root.");
  }
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
}

export async function createFixtureTree() {
  const root = await mkdtemp(join(tmpdir(), "hivem1nd-gui-"));
  const mind = join(root, "Cosmic", "hivem1nd");
  const user = join(mind, "user");
  const cosmicService = join(root, "Cosmic", "hivem1nd-service");
  const origin = join(root, "origin");
  const repo = join(root, "repositories", "shop");
  await mkdir(user, { recursive: true });
  await mkdir(cosmicService, { recursive: true });
  await mkdir(origin, { recursive: true });
  await mkdir(repo, { recursive: true });
  return {
    root,
    mind,
    user,
    cosmicService,
    origin,
    repo,
    cleanup: () => removeOwned(root, root),
  };
}

function markdownRecord(fields, body = "") {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  const text = body ? `${body.replace(/\n$/, "")}\n` : "";
  return `${lines.join("\n")}\n\n${text}`;
}

function padUnit(index) {
  return `unit-${String(index).padStart(4, "0")}`;
}

function castUnits(now) {
  const date = "2026-10-10 09:00";
  return [
    unit("root:master", "master", "master", "root", null, "in", LOCAL_MACHINE, null, null, null, date, "The person.", []),
    unit("root:overseer", "overseer", "overseer", "root", null, "in", LOCAL_MACHINE, null, null, null, date, "Waiting on master: Confirm the release window", []),
    unit("root:adjutant", "adjutant", "adjutant", "root", null, "in", LOCAL_MACHINE, null, "coordinator", null, date, "Beside the overseer.", []),
    unit("root:executive", "executive", "executive", "root", null, "in", LOCAL_MACHINE, null, "coordinator", null, date, "Beside the overseer.", []),
    unit("root:genesis", "genesis", "genesis", "root", null, "out", LOCAL_MACHINE, null, null, null, date, "Service.", []),
    unit("root:incubator", "incubator", "incubator", "root", null, "out", LOCAL_MACHINE, null, null, null, date, "Service.", []),
    unit("root:overseer-old", "overseer-old", "overseer", "root", null, "out", LOCAL_MACHINE, null, null, null, date, "Legacy duplicate.", []),
    unit("env:web:overlord-web", "overlord-web", "overlord", "environment", "web", "in", LOCAL_MACHINE, null, "lead", "strong", date, "Environment lead.", []),
    unit("project:shop:executor-shop", "executor-shop", "executor", "project", "shop", "in", LOCAL_MACHINE, "env:web:overlord-web", "builder", "strong", date, "Ready for the next task.", [
      grant("f605f169-8686-4a88-a213-7ca19703fd41", now),
    ]),
    unit("project:blog:executor-shop", "executor-shop", "executor", "project", "blog", "out", "OFFLINE", null, "builder", "strong", date, "Offline duplicate name.", []),
    unit("project:shop:partial", "partial", "not-a-role", "project", "shop", "in", LOCAL_MACHINE, null, null, null, date, "Malformed role.", []),
  ];
}

function unit(id, name, role, scopeKind, scopeName, state, machine, leadId, job, model, date, body, approvals) {
  return { id, unit: name, role, scopeKind, scopeName, state, machine, leadId, job, model, date, body, approvals };
}

function grant(id, now) {
  return {
    id,
    action: "process.run",
    pattern: { command: "npm run build", cwd: "project:shop" },
    grantedAt: now,
    grantedBy: "root:master",
  };
}

function bulkUnits(size) {
  const units = [];
  for (let index = 1; index <= size; index += 1) {
    const name = padUnit(index);
    units.push(unit(
      `project:bulk:${name}`,
      name,
      "executor",
      "project",
      "bulk",
      "out",
      LOCAL_MACHINE,
      null,
      "builder",
      null,
      "2026-10-10 08:00",
      name,
      [],
    ));
  }
  return units;
}

export function scenarioData(size, scenario = "standard", now = DEFAULT_NOW) {
  const resolvedSize = size ?? (scenario === "large" ? 1200 : 0);
  const empty = scenario === "empty";
  const settings = {
    format: "hivem1nd-settings-v1",
    look: scenario === "high-contrast" ? "high-contrast" : "modern",
    language: scenario === "spanish" ? "es" : "en",
  };
  const layout = {
    format: "hivem1nd-layout-v1",
    nodes: {
      "root:master": { x: 380, y: 56 },
      "root:overseer": { x: 380, y: 160 },
      "project:shop:executor-shop": { x: 84, y: 246 },
    },
    groups: { "project:shop": { x: 220, y: 360, collapsed: false } },
    updatedAt: now,
    machine: LOCAL_MACHINE,
  };
  return {
    size: resolvedSize,
    scenario,
    now,
    empty,
    settings: empty ? null : settings,
    layout: empty ? null : layout,
    units: empty ? [] : castUnits(now),
    bulk: bulkUnits(resolvedSize),
    malformed: { path: "user/state/broken.md", contents: "this is not a record\n" },
    issues: [
      { path: "user/state/broken.md", code: "malformed_record", message: "The state record could not be read." },
    ],
  };
}

function scopeDir(user, record) {
  if (record.scopeKind === "environment") return join(user, "envs", record.scopeName);
  if (record.scopeKind === "project") return join(user, "projects", record.scopeName);
  return user;
}

function stateDocument(record) {
  const lead = record.leadId ? record.leadId.split(":").at(-1) : null;
  return markdownRecord({
    unit: record.unit,
    "unit-id": record.id,
    role: record.role,
    state: record.state,
    machine: record.machine,
    lead,
    "lead-id": record.leadId,
    job: record.job,
    model: record.model,
    date: record.date,
    approvals: record.approvals,
  }, record.body);
}

async function writeOwned(paths, file, contents) {
  await mkdir(dirname(file), { recursive: true });
  const bytes = typeof contents === "string" ? Buffer.from(contents) : contents;
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
  paths.push(file);
  return bytes;
}

function messageDocument(message) {
  return markdownRecord({
    id: message.id,
    from: message.from,
    "from-id": message.fromId,
    to: message.to,
    "to-id": message.toId,
    machine: message.machine,
    timestamp: message.timestamp,
    priority: message.priority,
    subject: message.subject,
    "thread-id": message.threadId,
    "reply-to": message.replyTo,
    "reply-requested": message.replyRequested ? "true" : "false",
    attachments: message.attachments,
    kind: message.kind,
    "resource-id": message.resourceId,
    "notice-key": message.noticeKey,
  }, message.body);
}

function taskDocument(task) {
  return markdownRecord({
    id: task.number,
    "task-id": task.id,
    title: task.title,
    status: task.status,
    from: task.from,
    "from-id": task.fromId,
    to: task.to,
    "to-id": task.toId,
    date: task.date,
    requirements: task.requirements.join(", "),
  }, `## Request\n${task.request}\n\n## Report\n${task.report}`);
}

export async function seedRecords(tree, options = {}) {
  const data = scenarioData(options.size, options.scenario ?? "standard", options.now ?? DEFAULT_NOW);
  const paths = [];
  const user = tree.user;
  const local = localDirectory(tree.mind);
  await mkdir(local, { recursive: true });
  await chmod(local, 0o700).catch(() => undefined);

  await writeOwned(paths, join(user, "VERSION"), "3.0.0\n");
  await writeOwned(paths, join(user, data.malformed.path.slice("user/".length)), data.malformed.contents);

  for (const record of [...data.units, ...data.bulk]) {
    if (!ROLES.has(record.role) && record.unit !== "partial") continue;
    const file = join(scopeDir(user, record), "state", `${record.unit}.md`);
    await writeOwned(paths, file, stateDocument(record));
  }
  if (!data.empty) {
    await writeOwned(paths, join(user, "projects", "shop", "brief.md"), markdownRecord({
      project: "shop", title: "Shop", environment: "web",
    }));
    await writeOwned(paths, join(user, "projects", "blog", "brief.md"), markdownRecord({
      project: "blog", title: "Blog",
    }));
    if (data.bulk.length) {
      await writeOwned(paths, join(user, "projects", "bulk", "brief.md"), markdownRecord({
        project: "bulk", title: "Bulk",
      }));
    }
    await writeOwned(paths, join(user, "gui", "settings.json"), stableJson(data.settings));
    await writeOwned(paths, join(user, "gui", "layout.json"), stableJson(data.layout));
    await writeChats(paths, user, data.now);
    await writeMail(paths, user, data.now);
    await writeApprovals(paths, user, data.now, options.scenario ?? "standard");
    await writeTasks(paths, user);
    await writeMachines(paths, user, data.now, options.scenario ?? "standard");
    await writeSessions(paths, user, local, data.now);
    await writeEditors(paths, tree, user, data.now);
  }

  await writeOwned(paths, join(local, "config.json"), stableJson({
    format: "hivem1nd-service-config-v1",
    mindPath: tree.mind,
    machine: LOCAL_MACHINE,
    origin: { kind: "folder", path: tree.origin },
    stagingPath: join(local, "staging"),
    port: 0,
  }));
  await writeOwned(paths, join(local, "clients.json"), stableJson({
    DESKTOP: [
      { id: "claude", enabled: true, installed: true },
      { id: "codex", enabled: true, installed: true },
      { id: "cursor", enabled: true, installed: true },
    ],
    OFFLINE: [{ id: "codex", enabled: false, installed: false }],
  }));
  await writeOwned(paths, join(local, "fixture-scenario.json"), stableJson({
    scenario: data.scenario,
    now: data.now,
    size: data.size,
  }));
  await mkdir(join(local, "receipts"), { recursive: true });
  await mkdir(join(local, "transactions"), { recursive: true });
  await mkdir(tree.origin, { recursive: true });
  return { data, paths, local };
}

async function writeChats(paths, user, now) {
  const directId = deterministicUuid(["direct-chat", ["project:shop:executor-shop", "root:master"].sort()]);
  const groupId = "0efb1be7-b006-476d-b0f6-4629d217ab82";
  const unlistedId = "11111111-1111-4111-8111-111111111111";
  const chats = [
    {
      id: directId,
      title: "executor-shop",
      members: ["project:shop:executor-shop", "root:master"],
      pinned: false,
      listed: true,
      created: now,
      createdBy: "root:master",
      kind: "direct",
    },
    {
      id: groupId,
      title: "Cart release",
      members: ["env:web:overlord-web", "project:shop:executor-shop", "root:master"],
      pinned: true,
      listed: true,
      created: now,
      createdBy: "root:master",
      kind: "group",
    },
    {
      id: unlistedId,
      title: "Retained",
      members: ["project:blog:executor-shop", "root:master"],
      pinned: false,
      listed: false,
      created: now,
      createdBy: "root:master",
      kind: "direct",
    },
  ];
  for (const chat of chats) {
    await writeOwned(paths, join(user, "relay", "chats", chat.id, "chat.md"), markdownRecord({
      id: chat.id,
      title: chat.title,
      members: chat.members,
      pinned: chat.pinned ? "true" : "false",
      listed: chat.listed ? "true" : "false",
      created: chat.created,
      "created-by": chat.createdBy,
      kind: chat.kind,
    }));
  }
  const messages = [
    ["69c03b50-819b-42be-b5f9-6a11809647a8", directId, "2026-10-10T12:00:01.000Z", "The delivery is ready for review."],
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", directId, "2026-10-10T11:00:00.000Z", "Earlier note."],
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", directId, "2026-10-10T10:00:00.000Z", "Oldest note."],
    ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", groupId, "2026-10-10T12:00:02.000Z", "Group update."],
    ["cccccccc-cccc-4ccc-8ccc-ccccccccccc1", unlistedId, "2026-10-10T09:00:00.000Z", "Kept history."],
  ];
  for (const [id, chatId, timestamp, body] of messages) {
    await writeOwned(paths, join(user, "relay", "chats", chatId, `${id}.md`), messageDocument({
      id,
      from: "master",
      fromId: "root:master",
      to: `chat:${chatId}`,
      toId: `chat:${chatId}`,
      machine: "LAPTOP",
      timestamp,
      priority: "normal",
      subject: "Update",
      threadId: chatId,
      replyTo: null,
      replyRequested: false,
      attachments: [],
      kind: "message",
      body,
    }));
  }
  await writeOwned(paths, join(user, "projects", "shop", "inbox", "executor-shop", "20261010-120001-LAPTOP-notice.md"), messageDocument({
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    from: "master",
    fromId: "root:master",
    to: "executor-shop",
    toId: "project:shop:executor-shop",
    machine: "LAPTOP",
    timestamp: "2026-10-10T12:00:01.000Z",
    priority: "normal",
    subject: "Update",
    threadId: directId,
    replyTo: null,
    replyRequested: false,
    attachments: [],
    kind: "chat-notice",
    resourceId: "69c03b50-819b-42be-b5f9-6a11809647a8",
    noticeKey: "69c03b50-819b-42be-b5f9-6a11809647a8:project:shop:executor-shop",
    body: "",
  }));
}

async function writeMail(paths, user, now) {
  await writeOwned(paths, join(user, "inbox", "master", "20261010-110000-DESKTOP-mailbox.md"), messageDocument({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    from: "overseer",
    fromId: "root:overseer",
    to: "master",
    toId: "root:master",
    machine: LOCAL_MACHINE,
    timestamp: "2026-10-10T11:30:00.000Z",
    priority: "normal",
    subject: "Morning note",
    threadId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    replyTo: null,
    replyRequested: true,
    attachments: [],
    kind: "message",
    body: "The morning note.",
  }));
  await writeOwned(paths, join(user, "relay", "archive", "master", "20261010-090000-DESKTOP-read.md"), messageDocument({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    from: "overseer",
    fromId: "root:overseer",
    to: "master",
    toId: "root:master",
    machine: LOCAL_MACHINE,
    timestamp: "2026-10-10T09:00:00.000Z",
    priority: "normal",
    subject: "Archived",
    threadId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    replyTo: null,
    replyRequested: false,
    attachments: [],
    kind: "message",
    body: "Already read.",
  }));
  await writeOwned(paths, join(user, "relay", "read", LOCAL_MACHINE, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2.json"), stableJson({
    format: "hivem1nd-read-v1",
    messageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    unitId: "root:master",
    readAt: now,
    machine: LOCAL_MACHINE,
  }));
}

function approvalSet(now, scenario) {
  const soon = scenario === "approval-expiry"
    ? new Date(Date.parse(now) + 1000).toISOString()
    : new Date(Date.parse(now) + 120000).toISOString();
  const past = new Date(Date.parse(now) - 120000).toISOString();
  return [
    ["e80a0bf9-8fb4-4d64-9527-04524c9a2ecf", "pending", soon, null, null],
    ["e80a0bf9-8fb4-4d64-9527-04524c9a2ec1", "answering", soon, "approve", null],
    ["e80a0bf9-8fb4-4d64-9527-04524c9a2ec2", "approved", soon, "approve-always", "approved"],
    ["e80a0bf9-8fb4-4d64-9527-04524c9a2ec3", "denied", soon, "deny", "denied"],
    ["e80a0bf9-8fb4-4d64-9527-04524c9a2ec4", "expired", past, null, "expired"],
  ];
}

async function writeApprovals(paths, user, now, scenario) {
  let index = 0;
  for (const [id, state, expiresAt, decision, result] of approvalSet(now, scenario)) {
    index += 1;
    const request = {
      format: "hivem1nd-approval-v1",
      id,
      unitId: "project:shop:executor-shop",
      sessionId: "20c58b80-4d93-88cd-83b3-39d78f1d9d5d",
      chatId: deterministicUuid(["direct-chat", ["project:shop:executor-shop", "root:master"].sort()]),
      action: "process.run",
      pattern: { command: "npm run build", cwd: "project:shop" },
      display: `Run the project build ${index}`,
      alwaysAllowed: state !== "denied",
      requestedAt: new Date(Date.parse(now) - index * 1000).toISOString(),
      expiresAt,
    };
    const dir = join(user, "relay", "approvals", id);
    await writeOwned(paths, join(dir, "request.json"), stableJson(request));
    if (decision) {
      const answer = {
        format: "hivem1nd-approval-answer-v1",
        id: deterministicUuid(["answer", id]),
        approvalId: id,
        decision,
        answeredBy: "root:master",
        machine: "LAPTOP",
        at: now,
      };
      await writeOwned(paths, join(dir, "answers", `${answer.id}.json`), stableJson(answer));
      await writeOwned(paths, join(dir, "answer-results", `${answer.id}.json`), stableJson({
        format: "hivem1nd-approval-answer-result-v1",
        answerId: answer.id,
        approvalId: id,
        state: result === "approved" ? "applied" : result === "expired" ? "expired" : "rejected",
        resultAnswerId: result === "approved" ? answer.id : null,
        at: now,
      }));
    }
    if (result) {
      await writeOwned(paths, join(dir, "result.json"), stableJson({
        format: "hivem1nd-approval-result-v1",
        approvalId: id,
        state: result,
        answerId: decision ? deterministicUuid(["answer", id]) : null,
        grantId: result === "approved" ? "f605f169-8686-4a88-a213-7ca19703fd41" : null,
        at: now,
      }));
    }
  }
}

async function writeTasks(paths, user) {
  const tasks = [
    ["029", "review", "Reviewable delivery", "Accepted by the lead.\nApproved for review by overlord-web on 2026-10-10 11:00\n", "2026-10-10 11:00"],
    ["030", "review", "Lead gated delivery", "Waiting for the lead.\n", "2026-10-10 10:00"],
    ["028", "open", "Open delivery", "", "2026-10-10 08:00"],
    ["027", "done", "Done delivery", "Accepted.\n", "2026-10-09 12:00"],
    ["026", "closed", "Closed delivery", "Archived.\n", "2026-10-08 12:00"],
  ];
  for (const [number, status, title, report, date] of tasks) {
    await writeOwned(paths, join(user, "projects", "shop", "tasks", `${number}-${status}.md`), taskDocument({
      number,
      id: `project:shop:${number}`,
      title,
      status,
      from: "master",
      fromId: "root:master",
      to: "executor-shop",
      toId: "project:shop:executor-shop",
      date,
      requirements: ["SHOP-1"],
      request: title,
      report,
    }));
  }
}

async function writeMachines(paths, user, now, scenario) {
  const offlineBeat = new Date(Date.parse(now) - 3600_000).toISOString();
  const desktopBeat = scenario === "offline" ? offlineBeat : now;
  await writeOwned(paths, join(user, "machines", LOCAL_MACHINE, "service.json"), stableJson({
    format: "hivem1nd-service-v1",
    machine: LOCAL_MACHINE,
    state: "running",
    version: "3.0.0",
    heartbeatAt: desktopBeat,
    startedAt: new Date(Date.parse(now) - 3600_000).toISOString(),
  }));
  await writeOwned(paths, join(user, "machines", "OFFLINE", "service.json"), stableJson({
    format: "hivem1nd-service-v1",
    machine: "OFFLINE",
    state: "stopped",
    version: "3.0.0",
    heartbeatAt: offlineBeat,
    startedAt: offlineBeat,
  }));
  await writeOwned(paths, join(user, "machines", "DESKTOP.md"), "machine: DESKTOP\nperson: master\n\n");
}

async function writeSessions(paths, user, local, now) {
  const live = {
    kind: "registration",
    registrationId: "317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1",
    instanceId: "service-DESKTOP",
    sessionId: "20c58b80-4d93-88cd-83b3-39d78f1d9d5d",
    unit: "executor-shop",
    unitId: "project:shop:executor-shop",
    scopeId: "project:shop",
    nativeSessionId: "native-session-1",
    client: "codex",
    machine: LOCAL_MACHINE,
    registeredAt: now,
    activity: "busy",
    activityObservedAt: now,
    quota: null,
    quotaObservedAt: null,
  };
  const stopped = {
    ...live,
    registrationId: "317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b2",
    sessionId: "30c58b80-4d93-48cd-83b3-39d78f1d9d5d",
    unit: "executor-shop",
    unitId: "project:blog:executor-shop",
    scopeId: "project:blog",
    nativeSessionId: "native-session-2",
    machine: "OFFLINE",
    activity: "inactive",
    registeredAt: new Date(Date.parse(now) - 7200_000).toISOString(),
  };
  await writeOwned(paths, join(user, "relay", "sessions", `${live.registrationId}.json`), stableJson(live));
  await writeOwned(paths, join(user, "relay", "sessions", `${stopped.registrationId}.json`), stableJson(stopped));
  await writeOwned(paths, join(user, "relay", "session-status", stopped.sessionId, "status.json"), stableJson({
    format: "hivem1nd-session-status-v1",
    sessionId: stopped.sessionId,
    state: "stopped",
    machine: "OFFLINE",
    at: new Date(Date.parse(now) - 3600_000).toISOString(),
    reason: "native-acknowledged",
  }));
  const wakeKey = sha256(JSON.stringify([
    "project:shop:executor-shop",
    "native-session-1",
    "codex",
    LOCAL_MACHINE,
  ]));
  await writeOwned(paths, join(user, "relay", "wake", "policies", `${wakeKey}.json`), stableJson({
    kind: "relay-wake-policy",
    version: 1,
    key: wakeKey,
    binding: {
      unit: "executor-shop",
      unitId: "project:shop:executor-shop",
      nativeSessionId: "native-session-1",
      client: "codex",
      machine: LOCAL_MACHINE,
    },
    generation: "2bc1fd56-198e-438b-b8ce-0725b39f1d66",
    enabled: true,
    startedAt: now,
    deadlineAt: new Date(Date.parse(now) + 4 * 3600_000).toISOString(),
    durationHours: 4,
    extended: false,
    unlimited: false,
    maxHandoffs: 20,
    manualConsent: false,
    registrationId: live.registrationId,
    disabledAt: null,
    disabledReason: null,
    pausedReason: null,
    activity: { value: "busy", observedAt: now },
    wakeCount: 0,
    retryAt: null,
    cooldownUntil: null,
    lastError: null,
    consecutiveErrors: 0,
    deliveries: {},
    worker: { state: "running", heartbeatAt: now },
  }));
  await mkdir(join(local, "staging"), { recursive: true });
}

async function writeEditors(paths, tree, user, now) {
  const boardPath = "docs/flows/boards/cart.json";
  const legacyPath = "docs/flows/boards/legacy-cart.mjs";
  const textPath = "docs/release.json";
  const boardId = deterministicUuid(["editor", "blueprint", "shop", boardPath]);
  const legacyId = deterministicUuid(["editor", "blueprint", "shop", legacyPath]);
  const textId = deterministicUuid(["editor", "void", "shop", textPath]);
  const board = {
    formatVersion: 1,
    id: "cart",
    title: "Cart",
    note: "",
    sentinel: "document-sentinel",
    pages: [{
      id: "main", title: "Main", objects: [], order: ["empty"], start: "empty", sentinel: "page-sentinel",
    }],
    screens: [{
      id: "empty",
      title: "Empty cart",
      pageId: "main",
      x: 0,
      y: 0,
      w: 390,
      h: 844,
      sentinel: "screen-sentinel",
      root: {
        id: "root",
        name: "Root",
        t: "box",
        place: { x: 0, y: 0 },
        w: 390,
        h: 844,
        dir: "stack",
        sentinel: "node-sentinel",
        valign: "top",
        shadows: [{ sentinel: "shadow-sentinel" }],
        blur: 1,
        pixelate: 2,
        kids: [{
          id: "label",
          name: "Label",
          t: "text",
          place: { x: 12, y: 12 },
          w: 120,
          h: 32,
          value: "Cart",
          color: "#112233",
          align: "left",
          kids: undefined,
        }],
      },
    }],
    links: [{
      id: "legacy-link",
      from: "empty",
      to: "missing-screen",
      transition: "fade",
      easing: "linear",
      sentinel: "link-sentinel",
    }],
    components: [{ sentinel: "component-sentinel" }],
    fonts: [{ sentinel: "font-sentinel" }],
    threads: [{ sentinel: "board-thread-sentinel" }],
  };
  delete board.screens[0].root.kids[0].kids;
  await writeOwned(paths, join(tree.repo, boardPath), stableJson(board));
  await writeOwned(paths, join(tree.repo, "docs", "flows", "boards", "index.json"), stableJson([
    { id: "cart", letter: "C", short: "Cart", title: "Cart", sentinel: "index-sentinel" },
  ]));
  await writeOwned(paths, join(tree.repo, legacyPath), "export const board = { id: \"legacy-cart\", title: \"Legacy cart\" };\n");
  const text = {
    title: "Release notes",
    rev: 1,
    sentinel: "void-sentinel",
    pages: [{
      k: "Intro.Welcome",
      en: "<b>Welcome</b>\nA first paragraph.",
      es: "<b>Bienvenida</b>\nUn primer párrafo.",
      sentinel: "void-page-sentinel",
    }, {
      k: "Notes.Next",
      en: "Next page.",
      es: "Pagina siguiente.",
      sentinel: "void-next-sentinel",
    }],
  };
  const textBytes = await writeOwned(paths, join(tree.repo, textPath), stableJson(text));
  await writeOwned(paths, join(tree.repo, "docs", "release.orig.json"), stableJson({ ...text, rev: 0 }));
  await writeOwned(paths, join(tree.repo, "docs", "release.versions.jsonl"), `${JSON.stringify({
    at: now, rev: 1, k: "Intro.Welcome", lang: "en", before: "", after: text.pages[0].en,
  })}\n`);
  const textRevision = sha256(textBytes);
  await writeOwned(paths, join(tree.repo, "docs", "release.comments.json"), stableJson({
    path: "release.json",
    threads: [{
      id: "b37ea5c9-31a6-43ea-aed4-63e842c41f37",
      anchor: {
        lang: "en",
        k: "Intro.Welcome",
        start: 0,
        end: 7,
        quote: "Welcome",
        prefix: "",
        suffix: "\nA first paragraph.",
      },
      to: null,
      status: "open",
      messages: [{
        id: "5511f09e-0cda-4b15-8d58-8c79821b148f",
        author: "master",
        authorId: "root:master",
        at: now,
        text: "Clarify the introduction.",
        proposal: {
          id: "6611f09e-0cda-4b15-8d58-8c79821b148f",
          state: "pending",
          k: "Intro.Welcome",
          lang: "en",
          start: 3,
          end: 10,
          expectedText: "Welcome",
          replacement: "Hello",
          baseRevision: textRevision,
          createdBy: "root:master",
          createdAt: now,
          decidedBy: null,
          decidedAt: null,
        },
      }],
    }, {
      id: "b37ea5c9-31a6-43ea-aed4-63e842c41f38",
      anchor: {
        lang: "en",
        k: "Intro.Welcome",
        start: 10,
        end: 15,
        quote: "first",
        prefix: "A ",
        suffix: " paragraph.",
      },
      to: null,
      status: "open",
      messages: [{
        id: "5511f09e-0cda-4b15-8d58-8c79821b1490",
        author: "master",
        authorId: "root:master",
        at: now,
        text: "Consider the second wording.",
        proposal: {
          id: "6611f09e-0cda-4b15-8d58-8c79821b1491",
          state: "pending",
          k: "Intro.Welcome",
          lang: "en",
          start: 17,
          end: 22,
          expectedText: "first",
          replacement: "opening",
          baseRevision: textRevision,
          createdBy: "root:master",
          createdAt: now,
          decidedBy: null,
          decidedAt: null,
        },
      }],
    }],
  }));
  await writeOwned(paths, join(tree.repo, "docs", "flows", "comments", "cart.json"), stableJson({
    board: "cart",
    threads: [{
      id: "c37ea5c9-31a6-43ea-aed4-63e842c41f37",
      anchor: {
        screen: "empty",
        screenTitle: "Empty cart",
        element: "label",
        label: "Label",
        path: ["Root", "Label"],
        point: { x: 16, y: 20 },
      },
      layer: "design",
      status: "open",
      messages: [{
        id: "7711f09e-0cda-4b15-8d58-8c79821b148f",
        author: "master",
        authorId: "root:master",
        at: now,
        text: "Move the label.",
      }],
    }],
  }));
  await writeOwned(paths, join(user, "gui", "resources.json"), stableJson({
    format: "hivem1nd-resources-v1",
    resources: [
      { id: boardId, kind: "blueprint", project: "shop", path: boardPath, legacyId: "cart" },
      { id: legacyId, kind: "blueprint", project: "shop", path: legacyPath, legacyId: "legacy-cart" },
      { id: textId, kind: "void", project: "shop", path: textPath, legacyId: null },
    ],
  }));
  for (const [id, kind, attached] of [
    [boardId, "blueprint", ["project:shop:executor-shop", "env:web:overlord-web"]],
    [textId, "void", ["project:shop:executor-shop"]],
  ]) {
    await writeOwned(paths, join(user, "relay", "editors", `${id}.json`), stableJson({
      format: "hivem1nd-editor-binding-v1",
      resourceId: id,
      kind,
      attached,
      updatedAt: now,
    }));
  }
}
