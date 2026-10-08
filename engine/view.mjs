import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafePath, bodyFirstLine, collectScopes, headerValue, listDirectories, listFiles } from "./lifecycle.mjs";

export const VIEW_CONTRACT = "hivem1nd-view-v1";

const FILE_MAX_BYTES = 128 * 1024;
const FOLDER_MAX_ENTRIES = 2000;
// Relay treats an activity or quota observation older than this as unknown, and the view follows it.
const OBSERVATION_MAX_AGE_MS = 15 * 60 * 1000;
const ACTIVITIES = new Set(["busy", "idle", "active", "inactive"]);
const TASK_STATUSES = new Set(["open", "review", "done", "closed"]);
const STAGES = ["alpha", "beta", "release"];
const SCOPE_RANK = { root: 0, environment: 1, project: 2 };
const APPROVAL = /^[ \t]*Approved for review by[ \t]+(\S+)[ \t]+on[ \t]+(\S.*?)[ \t]*$/gim;

const lower = (value) => String(value ?? "").toLowerCase();
const orNull = (value) => (value === "" || value === undefined ? null : value);
// A header such as `to` can carry a note after the unit name.
const unitName = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(value ?? "")?.[0] ?? null;

function splitRecord(content) {
  const separator = /\r?\n[ \t]*\r?\n/.exec(content);
  return separator
    ? { header: content.slice(0, separator.index), body: content.slice(separator.index + separator[0].length) }
    : { header: content, body: "" };
}

// Dates are kept as written, so a state's local time and a message's ISO time are compared only here.
function sortStamp(value) {
  if (!value) return 0;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return Date.parse(value) || 0;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value);
  return match ? new Date(+match[1], +match[2] - 1, +match[3], +(match[4] ?? 0), +(match[5] ?? 0)).getTime() : 0;
}

// Every file is read on its own: whatever cannot be listed, read or parsed becomes an issue and the read goes on.
function createReader(mindPath) {
  const issues = [];
  const relative = (target) => path.relative(mindPath, target).split(path.sep).join("/");
  const flag = (target, reason) => { issues.push({ path: relative(target), reason }); };

  // The safe-path check resolves its root every time, which is slow when the mind sits in a synced
  // folder, so each folder is checked against its parent. Every level is checked once from the mind down.
  async function list(directory, lister = listFiles, base = path.dirname(directory)) {
    try {
      await assertSafePath(base, directory);
      const names = await lister(directory);
      if (names.length <= FOLDER_MAX_ENTRIES) return names;
      flag(directory, `holds ${names.length} entries, only the first ${FOLDER_MAX_ENTRIES} were read`);
      return names.slice(0, FOLDER_MAX_ENTRIES);
    } catch (error) {
      flag(directory, error.code === "UNSAFE_SYMLINK" ? "is a link, not followed"
        : error.code === "UNSAFE_PATH" ? "is not a plain folder"
          : `cannot be listed (${error.code ?? "error"})`);
      return [];
    }
  }

  // A link is refused here too, since the folder walk only vouches for the folder.
  async function read(filePath, { optional = false } = {}) {
    try {
      const state = await fs.lstat(filePath);
      if (!state.isFile()) { flag(filePath, "is not a plain file"); return null; }
      if (state.size > FILE_MAX_BYTES) { flag(filePath, "is larger than 128 KB"); return null; }
      const text = await fs.readFile(filePath, "utf8");
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } catch (error) {
      if (!(optional && error.code === "ENOENT")) flag(filePath, `cannot be read (${error.code ?? "error"})`);
      return null;
    }
  }

  async function readJson(filePath, accept) {
    const content = await read(filePath);
    if (content === null) return null;
    try {
      const value = JSON.parse(content);
      if (value && typeof value === "object" && accept(value)) return value;
      flag(filePath, "is not a Relay record of the expected kind");
    } catch {
      flag(filePath, "is not valid JSON");
    }
    return null;
  }

  return { issues, relative, flag, list, read, readJson };
}

function scopeIdentity(scope) {
  return {
    scope: scope.scope,
    ...(scope.environment ? { environment: scope.environment } : {}),
    ...(scope.project ? { project: scope.project } : {}),
  };
}

function waitingLines(body, userWaiting) {
  const items = [];
  for (const line of body.split(/\r?\n/)) {
    const match = userWaiting.exec(line);
    if (!match) continue;
    for (const item of match[1].split(";")) {
      const title = item.trim().replace(/\.$/, "");
      if (title && !/^(nothing|none|n\/a)$/i.test(title)) items.push(title);
    }
  }
  return items;
}

// A state that cannot be trusted still appears, as unknown, so a chat never vanishes from the graph.
async function readChat(reader, scope, fileName) {
  const filePath = path.join(scope.path, "state", fileName);
  const content = await reader.read(filePath);
  const { header, body } = content === null ? { header: "", body: "" } : splitRecord(content);
  const state = /^(in|out)\b/.exec(lower(headerValue(header, "state")))?.[1] ?? null;
  if (content !== null && state === null) reader.flag(filePath, "state is not in or out");
  const field = (name) => orNull(headerValue(header, name));
  return {
    chat: {
      unit: field("unit") ?? path.basename(fileName, ".md"),
      ...scopeIdentity(scope),
      state: state ?? "out",
      status: state === null ? "unknown" : null,
      lead: field("lead"),
      job: field("job"),
      model: field("model"),
      machine: field("machine"),
      date: field("date"),
      branch: field("branch"),
      context: content === null ? null : orNull(bodyFirstLine(content)),
      relay: null,
      path: reader.relative(filePath),
    },
    body,
  };
}

function reportApproval(body) {
  const report = /^##[ \t]+Report[ \t]*$/im.exec(body);
  if (!report) return null;
  const section = body.slice(report.index + report[0].length).split(/^##[ \t]/m)[0];
  const lines = [...section.matchAll(APPROVAL)];
  return lines.length ? { unit: lines.at(-1)[1], date: lines.at(-1)[2] } : null;
}

// The seven shapes that stopped another reader are each one issue here: a header line that is not
// key: value, a repeated header, an id that is not a number and a status outside the four.
async function readTask(reader, scope, fileName) {
  const filePath = path.join(scope.path, "tasks", fileName);
  const content = await reader.read(filePath);
  if (content === null) return null;
  const { header, body } = splitRecord(content);
  const seen = new Set();
  for (const [index, line] of header.split(/\r?\n/).entries()) {
    const key = /^([A-Za-z][A-Za-z0-9-]*):/.exec(line)?.[1];
    if (!key) { reader.flag(filePath, `header line ${index + 1} is not key: value`); return null; }
    if (seen.has(lower(key))) { reader.flag(filePath, `header ${lower(key)} appears twice`); return null; }
    seen.add(lower(key));
  }
  const id = headerValue(header, "id");
  if (!/^\d+$/.test(id)) { reader.flag(filePath, "id is missing or not a number"); return null; }
  const status = lower(headerValue(header, "status"));
  if (!TASK_STATUSES.has(status)) { reader.flag(filePath, "status is not open, review, done or closed"); return null; }
  const slug = /^\d+-(.*)\.md$/.exec(fileName)?.[1] ?? path.basename(fileName, ".md");
  return {
    task: {
      project: scope.project ?? null,
      id,
      title: /^#[ \t]+(\S.*?)[ \t]*$/m.exec(body)?.[1] ?? slug.replaceAll("-", " "),
      status,
      to: orNull(headerValue(header, "to")),
      from: orNull(headerValue(header, "from")),
      requirements: headerValue(header, "requirements").split(",").map((item) => item.trim()).filter(Boolean),
      approvedBy: null,
      path: reader.relative(filePath),
    },
    date: orNull(headerValue(header, "date")),
    approval: reportApproval(body),
  };
}

async function readMessage(reader, scope, unit, fileName) {
  const filePath = path.join(scope.path, "inbox", unit, fileName);
  const content = await reader.read(filePath);
  if (content === null) return null;
  const { header } = splitRecord(content);
  const sender = headerValue(header, "from");
  if (!sender) { reader.flag(filePath, "message has no from header"); return null; }
  return {
    ...scopeIdentity(scope),
    message: {
      unit,
      from: /^([^@\s]+)@[A-Za-z0-9._-]+$/.exec(sender)?.[1] ?? sender,
      to: headerValue(header, "to") || unit,
      subject: orNull(headerValue(header, "subject")),
      date: orNull(headerValue(header, "timestamp") || headerValue(header, "date")),
      priority: lower(headerValue(header, "priority")) === "urgent" ? "urgent" : "normal",
      replyRequested: /^(true|yes)$/i.test(headerValue(header, "reply-requested")),
      path: reader.relative(filePath),
    },
  };
}

// The first alternative that names a stage in the first clause of the header, since the value is
// often a sentence such as "beta in build".
function productStage(value) {
  const clause = value.split(/[,;(:.]/, 1)[0];
  return /\b(alpha|beta|release)\b/i.exec(clause)?.[1].toLowerCase() ?? null;
}

function productSections(body) {
  const ids = { alpha: new Set(), beta: new Set(), release: new Set() };
  const annexes = [];
  let openQuestions = 0;
  let section = "";
  let stage = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) { section = lower(heading[1]); stage = null; continue; }
    const group = /^###[ \t]+(.*)$/.exec(line);
    if (group) { stage = section === "requirements" ? /^(alpha|beta|release)\b/i.exec(group[1])?.[1].toLowerCase() ?? null : null; continue; }
    if (section === "requirements" && stage) {
      // The ID opens the line; a colon after it is the format, a space and a title is how many documents write it.
      const id = /^\s*[-*]\s+([A-Za-z][A-Za-z0-9]*-[ABR]-\d+)\b/.exec(line)?.[1];
      if (id) ids[stage].add(id);
    } else if (section === "open questions") {
      const bullet = /^\s*[-*]\s+(\S.*)$/.exec(line)?.[1];
      if (bullet && !/^none\.?$/i.test(bullet)) openQuestions += 1;
    } else if (section === "annexes") {
      const annex = /^\s*[-*]\s+([^:]+?)\s*:\s*(\S.*?)\s*$/.exec(line);
      if (annex) annexes.push({ name: annex[1], path: annex[2] });
    }
  }
  return { ids, annexes, openQuestions };
}

async function readProduct(reader, scope, delivered) {
  const filePath = path.join(scope.path, "product.md");
  const content = await reader.read(filePath, { optional: true });
  if (content === null) return null;
  const { header, body } = splitRecord(content);
  const { ids, annexes, openQuestions } = productSections(body);
  const requirements = {};
  for (const stage of STAGES) {
    requirements[stage] = { met: [...ids[stage]].filter((id) => delivered.has(id)).length, total: ids[stage].size };
  }
  return {
    project: scope.project,
    stage: productStage(headerValue(header, "stage")),
    updated: /\d{4}-\d{2}-\d{2}/.exec(headerValue(header, "updated"))?.[0] ?? null,
    requirements,
    openQuestions,
    annexes,
    path: reader.relative(filePath),
  };
}

// The newest registration of a unit speaks for it, and the wake policies are matched by their unit.
async function readRelay(reader, userPath) {
  const registrations = new Map();
  const sessions = path.join(userPath, "relay", "sessions");
  for (const fileName of (await reader.list(sessions)).filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))) {
    const record = await reader.readJson(path.join(sessions, fileName), (value) => value.kind === "registration" && typeof value.unit === "string");
    if (!record) continue;
    const previous = registrations.get(lower(record.unit));
    const newer = !previous || String(record.registeredAt).localeCompare(String(previous.registeredAt)) > 0
      || (record.registeredAt === previous.registeredAt && String(record.registrationId).localeCompare(String(previous.registrationId)) > 0);
    if (newer) registrations.set(lower(record.unit), record);
  }
  const policies = [];
  const folder = path.join(userPath, "relay", "wake", "policies");
  for (const fileName of (await reader.list(folder, listFiles, path.join(userPath, "relay"))).filter((name) => /^[a-f0-9]{64}\.json$/i.test(name))) {
    const policy = await reader.readJson(path.join(folder, fileName), (value) => value.kind === "relay-wake-policy" && value.binding && typeof value.binding.unit === "string");
    if (policy) policies.push(policy);
  }
  return { registrations, policies };
}

function relayOf(unit, { registrations, policies }, now) {
  const record = registrations.get(lower(unit)) ?? null;
  const fresh = (observedAt) => Number.isFinite(Date.parse(observedAt)) && now - Date.parse(observedAt) <= OBSERVATION_MAX_AGE_MS;
  const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  // Same test as the wake controller: enabled, not paused, and inside its window unless it has none.
  const wake = policies.some((policy) => lower(policy.binding.unit) === lower(unit)
    && policy.enabled === true && !policy.pausedReason && (policy.unlimited === true || Date.parse(policy.deadlineAt) > now));
  return {
    registered: record !== null,
    client: typeof record?.client === "string" ? record.client : null,
    activity: ACTIVITIES.has(record?.activity) && fresh(record.activityObservedAt) ? record.activity : null,
    activityObservedAt: typeof record?.activityObservedAt === "string" ? record.activityObservedAt : null,
    quota: plain(record?.quota) && fresh(record.quotaObservedAt) ? record.quota : null,
    wake,
  };
}

// The registration carries no schema for a quota, so the view recognizes the two plain forms.
function quotaExhausted(quota) {
  return quota !== null && (quota.exhausted === true || (typeof quota.remaining === "number" && quota.remaining <= 0));
}

function statusOf(chat, waitingUnits) {
  if (chat.status === "unknown") return "unknown";
  if (chat.state === "out") return "out";
  if (quotaExhausted(chat.relay.quota)) return "quota";
  if (waitingUnits.has(lower(chat.unit))) return "waiting";
  if (chat.relay.activity === "busy" || chat.relay.activity === "active") return "working";
  return "idle";
}

function rollup(chats) {
  const counts = { working: 0, idle: 0, waiting: 0, out: 0, attention: 0 };
  for (const chat of chats) {
    if (chat.status === "quota" || chat.status === "unknown") counts.attention += 1;
    else counts[chat.status] += 1;
  }
  return counts;
}

function squadOf(lead, home, members, counted) {
  return { lead, ...scopeIdentity(home), members: members.map((chat) => chat.unit).sort(), rollup: rollup(counted) };
}

function buildSquads(chats) {
  const byUnit = new Map();
  for (const chat of chats) if (!byUnit.has(lower(chat.unit))) byUnit.set(lower(chat.unit), chat);
  const reports = new Map();
  for (const chat of chats) {
    const lead = lower(chat.lead);
    if (!lead || lead === lower(chat.unit)) continue;
    if (!reports.has(lead)) reports.set(lead, []);
    reports.get(lead).push(chat);
  }
  const squads = [];
  for (const [key, members] of reports) {
    const leader = byUnit.get(key) ?? null;
    squads.push(squadOf(leader?.unit ?? members[0].lead, leader ?? members[0], members, leader ? [leader, ...members] : members));
  }
  const groups = new Map();
  for (const chat of chats) {
    if (reports.has(lower(chat.unit)) || (chat.lead && lower(chat.lead) !== lower(chat.unit))) continue;
    const key = [chat.scope, chat.environment, chat.project].join("\0");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chat);
  }
  for (const members of groups.values()) squads.push(squadOf(null, members[0], members, members));
  return squads.sort((left, right) => SCOPE_RANK[left.scope] - SCOPE_RANK[right.scope]
    || (left.environment ?? left.project ?? "").localeCompare(right.environment ?? right.project ?? "", "en")
    || (left.lead === null) - (right.lead === null) || (left.lead ?? "").localeCompare(right.lead ?? "", "en"));
}

export async function readView({ mindPath, project, hostname, now } = {}) {
  const root = path.resolve(mindPath ?? process.cwd());
  const userPath = path.join(root, "user");
  await assertSafePath(root, userPath, { allowMissing: false });
  const readAt = new Date(now ?? Date.now());
  if (Number.isNaN(readAt.getTime())) throw new Error("The supplied date is invalid.");
  const clock = readAt.getTime();
  const reader = createReader(root);

  // Records can use a name from any machine, while user still works without a person header.
  const machines = [];
  const names = new Set(["user"]);
  const machinesPath = path.join(userPath, "machines");
  for (const fileName of await reader.list(machinesPath)) {
    if (!fileName.endsWith(".md") || fileName.endsWith(".report.md") || fileName.startsWith(".")) continue;
    machines.push(path.basename(fileName, ".md"));
    const content = await reader.read(path.join(machinesPath, fileName));
    if (content === null) continue;
    for (const name of headerValue(splitRecord(content).header, "person").split(",").map((item) => item.trim()).filter(Boolean)) names.add(name);
  }
  // A name is literal record text, so its punctuation must not become a regular expression.
  const userNames = [...names].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const userSender = new RegExp(`^(?:${userNames})(?=\\W|$)`, "i");
  const userWaiting = new RegExp(`^\\s*Waiting on (?:the )?(?:${userNames})\\s*:\\s*(.*)$`, "i");

  const allScopes = await collectScopes(userPath, (directory) => reader.list(directory, listDirectories));
  const projectScope = project ? allScopes.find((scope) => scope.scope === "project" && lower(scope.project) === lower(project)) : null;
  if (project && !projectScope) reader.flag(path.join(userPath, "projects", project), "project not found");
  const scopes = project ? (projectScope ? [projectScope, ...allScopes.filter((scope) => scope.scope !== "project")] : []) : allScopes;
  const tasksOf = (scope) => !project || scope === projectScope;

  // With a project, the root and the environments contribute only the units that lead its chats.
  const chats = [];
  const questions = [];
  let leaders = null;
  for (const scope of scopes) {
    for (const fileName of (await reader.list(path.join(scope.path, "state"))).filter((name) => name.endsWith(".md"))) {
      if (leaders && !leaders.has(lower(path.basename(fileName, ".md")))) continue;
      const { chat, body } = await readChat(reader, scope, fileName);
      chats.push(chat);
      // Root and environment coordinators both keep questions for the person in their states.
      if (scope.scope === "root" || scope.scope === "environment") {
        for (const title of waitingLines(body, userWaiting)) questions.push({ kind: "question", title, project: null, unit: chat.unit, since: chat.date, path: chat.path, task: null, approvedBy: null });
      }
    }
    if (project && scope === projectScope) leaders = new Set(chats.map((chat) => lower(chat.lead)).filter(Boolean));
  }
  const unitsShown = new Set(chats.map((chat) => lower(chat.unit)));

  const entries = [];
  const projectsRead = [];
  for (const scope of scopes.filter(tasksOf)) {
    for (const fileName of (await reader.list(path.join(scope.path, "tasks"))).filter((name) => name.endsWith(".md"))) {
      const entry = await readTask(reader, scope, fileName);
      if (entry) entries.push(entry);
    }
    if (scope.scope === "project") projectsRead.push(scope);
  }

  const inbox = [];
  for (const scope of scopes) {
    for (const unit of await reader.list(path.join(scope.path, "inbox"), listDirectories)) {
      if (project && scope !== projectScope && !unitsShown.has(lower(unit))) continue;
      for (const fileName of (await reader.list(path.join(scope.path, "inbox", unit))).filter((name) => name.endsWith(".md") && !name.startsWith("."))) {
        const found = await readMessage(reader, scope, unit, fileName);
        if (found) inbox.push(found);
      }
    }
  }

  const delivered = (name) => new Set(entries.filter((entry) => entry.task.project === name && entry.task.status === "done").flatMap((entry) => entry.task.requirements));
  const products = [];
  for (const scope of projectsRead) {
    const product = await readProduct(reader, scope, delivered(scope.project));
    if (product) products.push(product);
  }

  const relayState = await readRelay(reader, userPath);
  const byUnit = new Map();
  for (const chat of chats) {
    chat.relay = relayOf(chat.unit, relayState, clock);
    if (!byUnit.has(lower(chat.unit))) byUnit.set(lower(chat.unit), chat);
  }

  // Only a lead that approved a delivery counts as having approved it; a unit without a lead has no such line.
  const approverOf = (entry) => {
    const lead = byUnit.get(lower(unitName(entry.task.to)))?.lead ?? null;
    return lead && entry.approval && lower(entry.approval.unit) === lower(lead) ? lead : null;
  };
  for (const entry of entries) entry.task.approvedBy = approverOf(entry);

  const reviews = [];
  for (const entry of entries) {
    const { task } = entry;
    if (task.status !== "review" || !userSender.test(task.from ?? "")) continue;
    const executor = unitName(task.to);
    if (byUnit.get(lower(executor))?.lead && !task.approvedBy) continue;
    reviews.push({ kind: "review", title: task.title, project: task.project, unit: task.approvedBy ?? executor, since: task.approvedBy ? entry.approval.date : entry.date, path: task.path, task: task.id, approvedBy: task.approvedBy });
  }
  const messages = inbox
    .filter(({ message }) => message.replyRequested && (lower(message.to) === "user" || lower(message.unit) === "user"))
    .map(({ message, project: owner }) => ({ kind: "message", title: message.subject ?? "", project: owner ?? null, unit: message.from, since: message.date, path: message.path, task: null, approvedBy: null }));

  const newestFirst = (left, right) => sortStamp(right.since) - sortStamp(left.since) || left.path.localeCompare(right.path, "en");
  const waiting = [...[...questions, ...messages].sort(newestFirst), ...reviews.sort(newestFirst)];

  const waitingUnits = new Set(waiting.map((item) => lower(item.unit)));
  for (const chat of chats) chat.status = statusOf(chat, waitingUnits);
  chats.sort((left, right) => SCOPE_RANK[left.scope] - SCOPE_RANK[right.scope]
    || (left.environment ?? left.project ?? "").localeCompare(right.environment ?? right.project ?? "", "en")
    || left.unit.localeCompare(right.unit, "en") || left.path.localeCompare(right.path, "en"));

  const tasks = entries.map((entry) => entry.task).filter((task) => task.status !== "closed")
    .sort((left, right) => (left.project ?? "").localeCompare(right.project ?? "", "en") || left.id.localeCompare(right.id, "en", { numeric: true }) || left.path.localeCompare(right.path, "en"));
  const inboxList = inbox.map(({ message }) => message)
    .sort((left, right) => left.unit.localeCompare(right.unit, "en") || sortStamp(left.date) - sortStamp(right.date) || left.path.localeCompare(right.path, "en"));
  products.sort((left, right) => left.project.localeCompare(right.project, "en"));

  const version = orNull((await reader.read(path.join(userPath, "VERSION"), { optional: true }))?.trim());

  const issues = reader.issues.sort((left, right) => left.path.localeCompare(right.path, "en") || left.reason.localeCompare(right.reason, "en"));
  const count = (status) => tasks.filter((task) => task.status === status).length;
  return {
    contract: VIEW_CONTRACT,
    readAt: readAt.toISOString(),
    mind: { version, machine: hostname ?? os.hostname(), machines, project: projectScope?.project ?? project ?? null },
    chats,
    squads: buildSquads(chats),
    waiting,
    tasks,
    inbox: inboxList,
    products,
    counts: {
      chats: chats.length,
      waiting: waiting.length,
      open: count("open"),
      review: count("review"),
      done: count("done"),
      closed: entries.filter((entry) => entry.task.status === "closed").length,
      unread: inboxList.length,
      issues: issues.length,
    },
    issues,
  };
}
