#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WAKE_ADAPTERS, getWakeAdapter } from '../engine/relay/wake-adapters.mjs';
import { formatBytes } from '../engine/measure.mjs';
import { relayLine } from '../engine/texts.mjs';

const require = createRequire(import.meta.url);
const VERSION = require("../package.json").version;
const KIT_PATH = fileURLToPath(new URL("../", import.meta.url));
const ACID = "\u001B[38;2;189;205;121m";
const DIM = "\u001B[2m";
const RESET = "\u001B[0m";

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
    this.code = "CLI_USAGE";
  }
}

export function helpText() {
  return `HIVEM1ND ${VERSION}

Usage:
  hivem1nd init [--gui] [--resume] [options]
  hivem1nd evolve [--check-only] [options]
  hivem1nd check [options]
  hivem1nd pylon <repo> [--state branch|main] [options]
  hivem1nd swarm [options]
  hivem1nd view [--project <name>] [options]
  hivem1nd relay <in|register|send|inbox|read|history|threads|status|events|reminder|delivery|mcp|hook|wake|configure|unconfigure|diagnose> [options]
  hivem1nd uninstall [--dry-run] [--remove-mind] [options]
  hivem1nd service <install|uninstall|status|run> [--dry-run] [options]
  hivem1nd task status <project> <id> <status> [--note <text>]
  hivem1nd task undo <project> <id>

Commands:
  init       Configure this machine in eight guided steps
  evolve     Update the mind and apply pending migrations
  check      Report what a new chat should know, without writing
  pylon      Attach a repository to the shared mind
  swarm      Show units, tasks and unread messages
  view       Show chats, squads, what waits on the person, tasks, inbox and products
  relay     Send and read messages, register sessions, or configure Relay clients
  uninstall  Remove what HIVEM1ND wrote on this machine
  service    Plan the user login service, or print its status
  task       Change a task status or undo the last change through the service

Relay options:
  --mind-path <path>       Path to the private mind
  --kit-path <path>        Path to the HIVEM1ND kit
  --session-id <id>        Stable Relay instance identifier
  --native-session-id <id> Native client session identifier
  --client <name>          Client name: ${Object.keys(WAKE_ADAPTERS).join(', ')} or user
  --unit <name>            Explicit unit name, including user
  --event <name>           Native hook event name
  --hours <4|5|6|7|8|12|24> Bounded wake window (12/24 require --extended)
  --max-handoffs <1-100> Maximum submitted Relay pointers (default 20)
  --to <unit> --subject <text> --body <text>
  --reply-to <id> --thread-id <id> --reply-requested
  --priority <normal|urgent> --attachment <path> (repeatable)
  --id <message-id> (repeatable) --limit <count>
  relay delivery --id <message-id> [--id ...] shows how far messages sent by the registered unit have come (at most 100)

Relay wake actions:
  relay wake attach --client <${Object.keys(WAKE_ADAPTERS).join('|')}> --unit <name> [--native-session-id <id>] [--hours <n>] [--extended] [--mind-path <path>]
  relay wake enable|disable|status --unit <name> --native-session-id <id> [options]
  relay wake status ... --machine <name> reads the worker note of a binding that belongs to another machine
  relay wake watch --unit <name> --native-session-id <id> [options] (internal worker)
${Object.values(WAKE_ADAPTERS).flatMap((adapter) => adapter.helpLines).map((line) => '  ' + line).join('\n')}
  Clients other than Claude require an existing exact registration and explicit native ID; Cursor attached from inside its CLI chat reads it from CURSOR_CONVERSATION_ID.

Init options:
  --gui                 Open the local browser wizard
  --resume              Continue the saved setup session
  --language <en|es>    Start in English or Spanish

Evolve options:
  --check-only          Check for a newer version without changing files
  --conflict <path>=<keep|replace|omit>
                        Resolve a file or link conflict (repeatable)

Uninstall options:
  --dry-run             Report the plan without removing anything
  --remove-mind         Also delete the mind folder when it is safe to

Service options:
  service install --dry-run    Print the login plan. This does not register a task.
  --origin-kind <folder|onedrive>
  --origin-path <path>         Explicit origin folder
  --cosmic-path <path>         Cosmic parent. The mind folder hivem1nd is appended when no mind path is set.

Pylon options:
  --state <branch|main> Store team state on its own branch or on main
  --ai-files            Allow shared AI files (default)
  --no-ai-files         Keep shared AI files out of code branches
  --ai-trailers         Allow AI commit trailers
  --no-ai-trailers      Disallow AI commit trailers (default)
  --environment <name>  Environment name for the repository route

View options:
  --project <name>      Show one project and the units that lead it

Shared path options:
  --kit-path <path>     Path to the HIVEM1ND kit (default: installed kit)
  --mind-path <path>    Path to the private mind
  --home-dir <path>     Agent configuration home
  --hostname <name>     Machine name

Lifecycle output:
  --json                Print the complete machine-readable result
  -h, --help            Show help
  -v, --version         Show version`;
}

const VALUE_FLAGS = new Map([
  ["--kit-path", "kitPath"],
  ["--mind-path", "mindPath"],
  ["--home-dir", "homeDir"],
  ["--hostname", "hostname"],
  ["--language", "language"],
  ["--environment", "environment"],
  ["--state", "state"],
  ["--project", "project"],
  ["--origin-kind", "originKind"],
  ["--origin-path", "originPath"],
  ["--cosmic-path", "cosmicPath"],
]);

const BOOLEAN_FLAGS = new Map([
  ["--gui", ["gui", true]],
  ["--resume", ["resume", true]],
  ["--check-only", ["checkOnly", true]],
  ["--ai-files", ["aiFiles", true]],
  ["--no-ai-files", ["aiFiles", false]],
  ["--ai-trailers", ["aiTrailers", true]],
  ["--no-ai-trailers", ["aiTrailers", false]],
  ["--json", ["json", true]],
  ["--dry-run", ["dryRun", true]],
  ["--remove-mind", ["removeMind", true]],
]);

const ALLOWED_FLAGS = {
  init: new Set(["gui", "resume", "language", "kitPath", "mindPath", "homeDir", "hostname", "originKind", "originPath", "cosmicPath"]),
  evolve: new Set(["checkOnly", "conflicts", "json", "kitPath", "mindPath", "homeDir", "hostname", "originKind", "originPath", "cosmicPath"]),
  pylon: new Set(["state", "aiFiles", "aiTrailers", "environment", "json", "kitPath", "mindPath", "homeDir", "hostname"]),
  check: new Set(["json", "kitPath", "mindPath", "homeDir", "hostname"]),
  swarm: new Set(["json", "kitPath", "mindPath", "homeDir", "hostname"]),
  view: new Set(["json", "project", "kitPath", "mindPath", "homeDir", "hostname"]),
  uninstall: new Set(["dryRun", "removeMind", "json", "mindPath", "homeDir", "hostname"]),
};

export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new CliUsageError("Arguments must be an array.");
  if (argv[0] === "relay") return parseRelayArgs(argv.slice(1));
  if (argv[0] === "service") return parseServiceArgs(argv.slice(1));
  if (argv[0] === "task") return parseTaskArgs(argv.slice(1));
  if (argv.length === 0) return { help: true };
  if (argv.length === 1 && ["-h", "--help"].includes(argv[0])) return { help: true };
  if (argv.length === 1 && ["-v", "--version"].includes(argv[0])) return { version: true };

  const [command, ...tokens] = argv;
  if (!Object.hasOwn(ALLOWED_FLAGS, command)) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  const options = {};
  const positional = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-h", "--help"].includes(token)) return { command, help: true };
    if (["-v", "--version"].includes(token)) return { version: true };

    if (token === "--conflict") {
      if (!ALLOWED_FLAGS[command].has("conflicts")) throw new CliUsageError(`${token} is not valid for ${command}.`);
      const value = tokens[index + 1];
      if (!value) throw new CliUsageError("--conflict requires <path>=keep, <path>=replace or <path>=omit.");
      const match = /^(.*)=(keep|replace|omit)$/.exec(value);
      if (!match?.[1]) throw new CliUsageError("--conflict requires <path>=keep, <path>=replace or <path>=omit.");
      options.conflicts ??= {};
      if (Object.hasOwn(options.conflicts, match[1])) throw new CliUsageError(`Conflict path was provided more than once: ${match[1]}`);
      options.conflicts[match[1]] = match[2];
      index += 1;
      continue;
    }

    if (VALUE_FLAGS.has(token)) {
      const key = VALUE_FLAGS.get(token);
      if (!ALLOWED_FLAGS[command].has(key)) throw new CliUsageError(`${token} is not valid for ${command}.`);
      if (Object.hasOwn(options, key)) throw new CliUsageError(`${token} was provided more than once.`);
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) throw new CliUsageError(`${token} requires a value.`);
      options[key] = value;
      index += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(token)) {
      const [key, value] = BOOLEAN_FLAGS.get(token);
      if (!ALLOWED_FLAGS[command].has(key)) throw new CliUsageError(`${token} is not valid for ${command}.`);
      if (Object.hasOwn(options, key)) throw new CliUsageError(`Conflicting or repeated option: ${token}.`);
      options[key] = value;
      continue;
    }

    if (token.startsWith("-")) throw new CliUsageError(`Unknown option: ${token}`);
    positional.push(token);
  }

  if (options.language && !["en", "es"].includes(options.language)) {
    throw new CliUsageError("--language must be en or es.");
  }
  if (options.state && !["branch", "main"].includes(options.state)) {
    throw new CliUsageError("--state must be branch or main.");
  }
  if (options.checkOnly && options.conflicts) throw new CliUsageError("--conflict cannot be used with --check-only.");
  if (command === "pylon") {
    if (positional.length !== 1) throw new CliUsageError("pylon requires exactly one repository path.");
    options.repoPath = positional[0];
  } else if (positional.length > 0) {
    throw new CliUsageError(`${command} does not accept positional arguments.`);
  }

  return { command, options };
}

const SERVICE_FLAGS = new Set(["dryRun", "originKind", "originPath", "cosmicPath", "mindPath", "homeDir", "hostname", "json"]);

function parseServiceArgs(tokens) {
  const action = tokens[0];
  if (!action || action === "--help" || action === "-h") return { command: "service", help: true };
  if (!["install", "uninstall", "status", "run"].includes(action)) {
    throw new CliUsageError("service requires install, uninstall, status or run.");
  }
  const options = { action };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-h", "--help"].includes(token)) return { command: "service", help: true };
    if (VALUE_FLAGS.has(token)) {
      const key = VALUE_FLAGS.get(token);
      if (!SERVICE_FLAGS.has(key)) throw new CliUsageError(`${token} is not valid for service.`);
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) throw new CliUsageError(`${token} requires a value.`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      const [key, value] = BOOLEAN_FLAGS.get(token);
      if (!SERVICE_FLAGS.has(key)) throw new CliUsageError(`${token} is not valid for service.`);
      options[key] = value;
      continue;
    }
    if (token.startsWith("-")) throw new CliUsageError(`Unknown option: ${token}`);
    throw new CliUsageError("service does not accept positional arguments.");
  }
  if (options.originKind && !["folder", "onedrive"].includes(options.originKind)) {
    throw new CliUsageError("--origin-kind must be folder or onedrive.");
  }
  return { command: "service", options };
}

function parseTaskArgs(tokens) {
  const action = tokens[0];
  if (action !== "status" && action !== "undo") throw new CliUsageError("task requires status or undo.");
  const options = { action };
  const positional = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-h", "--help"].includes(token)) return { command: "task", help: true };
    if (token === "--note") {
      if (action !== "status") throw new CliUsageError("--note is only valid for task status.");
      if (Object.hasOwn(options, "note")) throw new CliUsageError("--note was provided more than once.");
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) throw new CliUsageError("--note requires a value.");
      options.note = value;
      index += 1;
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const key = VALUE_FLAGS.get(token);
      if (!["mindPath", "homeDir", "hostname", "cosmicPath"].includes(key)) throw new CliUsageError(`${token} is not valid for task.`);
      if (Object.hasOwn(options, key)) throw new CliUsageError(`${token} was provided more than once.`);
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) throw new CliUsageError(`${token} requires a value.`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (token === "--json") {
      if (options.json === true) throw new CliUsageError("--json was provided more than once.");
      options.json = true;
      continue;
    }
    if (token.startsWith("-")) throw new CliUsageError(`Unknown option: ${token}`);
    positional.push(token);
  }
  if (action === "status") {
    if (positional.length !== 3) throw new CliUsageError("task status requires a project, an id and a status.");
    const [project, taskId, status] = positional;
    if (!["open", "review", "done", "closed"].includes(status)) throw new CliUsageError("task status must be open, review, done or closed.");
    options.project = project;
    options.taskId = taskId.includes(":") ? taskId : `project:${project}:${taskId}`;
    options.status = status;
  } else {
    if (positional.length !== 2) throw new CliUsageError("task undo requires a project and an id.");
    const [project, taskId] = positional;
    options.project = project;
    options.taskId = taskId.includes(":") ? taskId : `project:${project}:${taskId}`;
  }
  return { command: "task", options };
}

const RELAY_VALUE_FLAGS = new Map([
  ["--mind-path", "mindPath"], ["--kit-path", "kitPath"], ["--home-dir", "homeDir"], ["--hostname", "hostname"],
  ["--session-id", "sessionId"], ["--native-session-id", "nativeSessionId"], ["--client", "client"], ["--unit", "unit"],
  ["--event", "event"], ["--to", "to"], ["--subject", "subject"], ["--body", "body"], ["--priority", "priority"],
  ["--reply-to", "replyTo"], ["--thread-id", "threadId"], ["--limit", "limit"], ["--activity", "activity"], ["--quota", "quota"],
  ["--attachment", "attachments"], ["--id", "ids"],
  ["--hours", "hours"],
  ["--max-handoffs", "maxHandoffs"], ["--machine", "machine"],
]);
const RELAY_ACTIONS = new Set(["in", "register", "send", "inbox", "read", "history", "threads", "status", "events", "reminder", "delivery", "mcp", "hook", "wake", "configure", "unconfigure", "diagnose"]);

function parseRelayArgs(tokens) {
  let [action, ...rest] = tokens;
  let wakeAction;
  if (action === "wake") {
    wakeAction = rest.shift();
    if (!wakeAction || !["attach", "enable", "disable", "status", "watch"].includes(wakeAction)) {
      throw new CliUsageError("relay wake requires attach, enable, disable, status or watch.");
    }
  }
  if (!action || action === "--help" || action === "-h") return { command: "relay", options: { help: true } };
  if (!RELAY_ACTIONS.has(action)) throw new CliUsageError(`Unknown relay action: ${action}`);
  const options = { action: action === "in" ? "register" : action, attachments: [], ids: [] };
  if (wakeAction) options.wakeAction = wakeAction;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--reply-requested") { options.replyRequested = true; continue; }
    if (token === "--body-stdin") { options.bodyStdin = true; continue; }
    if (token === "--extended") { if (options.extended) throw new CliUsageError("--extended was provided more than once."); options.extended = true; continue; }
    if (token === "--unlimited") { if (options.unlimited) throw new CliUsageError("--unlimited was provided more than once."); options.unlimited = true; continue; }
    if (token === "--manual-consent") { if (options.manualConsent) throw new CliUsageError("--manual-consent was provided more than once."); options.manualConsent = true; continue; }
    const key = RELAY_VALUE_FLAGS.get(token);
    if (!key) throw new CliUsageError(`Unknown Relay option: ${token}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${token} requires a value.`);
    if (key === "attachments" || key === "ids") options[key].push(value);
    else if (Object.hasOwn(options, key)) throw new CliUsageError(`${token} was provided more than once.`);
    else options[key] = value;
    index += 1;
  }
  if (options.limit !== undefined && (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 500)) throw new CliUsageError("--limit must be between 1 and 500.");
  if (options.machine !== undefined && wakeAction !== "status") throw new CliUsageError("--machine is only valid with relay wake status.");
  if (options.priority !== undefined && !["normal", "urgent"].includes(options.priority)) throw new CliUsageError("--priority must be normal or urgent.");
  if (options.hours !== undefined && !["4", "5", "6", "7", "8", "12", "24"].includes(options.hours)) throw new CliUsageError("--hours must be 4 through 8, 12 or 24.");
  if (options.maxHandoffs !== undefined && (!/^\d+$/.test(options.maxHandoffs) || Number(options.maxHandoffs) < 1 || Number(options.maxHandoffs) > 100)) throw new CliUsageError("--max-handoffs must be between 1 and 100.");
  if (["12", "24"].includes(options.hours) && !options.extended) throw new CliUsageError("--hours 12 or --hours 24 requires --extended.");
  if (options.extended && !["12", "24"].includes(options.hours)) throw new CliUsageError("--extended is only valid with --hours 12 or --hours 24.");
  if (options.unlimited && (options.hours !== undefined || !options.manualConsent)) throw new CliUsageError("--unlimited requires --manual-consent and cannot be combined with --hours.");
  if (options.manualConsent && !options.unlimited) throw new CliUsageError("--manual-consent is only valid with --unlimited.");
  if (options.quota !== undefined) {
    try { options.quota = JSON.parse(options.quota); }
    catch { throw new CliUsageError("--quota must be valid JSON."); }
  }
  return { command: "relay", options };
}

function formatResult(result) {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/, 1)[0];
}

function formatCheck(result) {
  const line = result.notice
    || (result.updateAvailable
      ? `Version ${result.latestVersion} is available. Current version: ${result.currentVersion}.`
      : `HIVEM1ND ${result.currentVersion ?? result.latestVersion ?? ""} is up to date.`);
  return [line, ...(result.warnings ?? []).map((warning) => `Warning: ${warning}`)].join("\n");
}

function formatEvolve(result) {
  const lines = [];
  if (!result.completed) {
    lines.push("Evolution needs conflict choices before it can continue.");
    for (const conflict of result.conflicts ?? []) {
      lines.push(`${conflict.path}: ${conflict.reason}`);
      lines.push(`  Choices: ${(conflict.choices ?? ["keep", "replace"]).join(", ")}`);
    }
    lines.push("Run evolve again with --conflict <path>=<choice> for each file.");
    return lines.join("\n");
  }
  lines.push(result.changed
    ? `Evolved from ${result.fromVersion} to ${result.toVersion}.`
    : `HIVEM1ND ${result.toVersion ?? result.fromVersion} is already current.`);
  if (result.migrations?.length) lines.push(`Migrations: ${result.migrations.join(", ")}`);
  if (result.baseFiles?.length) lines.push(`Base files: ${result.baseFiles.length}.`);
  if (result.agents?.length) {
    lines.push(`Agent files: ${result.agents.map((agent) => `${agent.name} (${agent.files?.length ?? 0})`).join(", ")}`);
  }
  if (result.replacedLinks?.length) lines.push(`Links replaced: ${result.replacedLinks.join(", ")}`);
  if (result.omitted?.length) {
    lines.push(`Left uninstalled: ${result.omitted.length}. Run evolve again to install them.`);
  }
  for (const item of result.relay ?? []) lines.push(relayLine("en", item));
  if (result.reportPath) lines.push(`Report: ${result.reportPath}`);
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function formatPylon(result) {
  const name = path.basename(result.repoPath) || result.repoPath;
  const lines = [
    `Pylon ready for ${name}.`,
    `State: ${result.state}${result.branch ? ` (${result.branch})` : ""}. Files created: ${result.created?.length ?? 0}.`,
  ];
  if (result.pushed) lines.push("State branch pushed.");
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function formatSwarm(result) {
  const lines = ["Units"];
  if (!result.units?.length) lines.push("(none)");
  for (const unit of result.units ?? []) {
    lines.push(`${unit.unit} | ${unit.state} | ${unit.machine || "unknown"} | ${unit.date || "unknown"} | ${firstLine(unit.context)}`);
  }

  lines.push("", "Tasks");
  if (!result.tasks?.projects?.length) lines.push("(none)");
  for (const project of result.tasks?.projects ?? []) {
    lines.push(`${project.project} | open ${project.open} | review ${project.review} | done ${project.done}`);
    for (const item of project.items ?? []) lines.push(`${item.id} ${item.slug} | ${item.status}`);
  }

  lines.push("", "Inboxes");
  const unread = (result.inboxes?.units ?? []).filter((unit) => unit.count > 0);
  if (unread.length === 0) lines.push("(none)");
  for (const unit of unread) lines.push(`${unit.unit} | ${unit.count} unread`);
  return lines.join("\n");
}

function tally(items, key, names) {
  return names.map((name) => `${name} ${items.filter((item) => item[key] === name).length}`).join(", ");
}

function formatView(result) {
  const blocking = result.waiting.filter((item) => item.kind !== "review").length;
  return [
    `Waiting on the person: ${result.counts.waiting} (${blocking} to answer, ${result.counts.waiting - blocking} to review)`,
    `Chats: ${result.counts.chats} (${tally(result.chats, "status", ["waiting", "working", "idle", "out", "quota", "unknown"])})`,
    `Tasks: open ${result.counts.open}, review ${result.counts.review}, done ${result.counts.done}, closed ${result.counts.closed}`,
    `Unread: ${result.counts.unread}`,
    `Issues: ${result.counts.issues}${result.counts.issues ? "; --json lists them" : ""}`,
  ].join("\n");
}

function waitingText({ unread, open }) {
  return [
    unread ? `${unread} unread message${unread === 1 ? "" : "s"}` : "",
    open ? `${open} open task${open === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
}

function mindText(mind) {
  if (!mind?.count) return "";
  return `Mind: ${mind.count} item${mind.count === 1 ? "" : "s"} to clean (${mind.largest.path}, ${formatBytes(mind.largest.bytes)}); /cleaner offers the cleanup.`;
}

// A seat is told about its own project only. A session that resolves to no project, such as an
// executive seat at the mind root, gets the count instead of a line per project.
function missingProductText({ project, mind }) {
  const missing = mind?.product?.missing ?? [];
  if (project) {
    const own = missing.some((item) => item.project.toLowerCase() === project.name.toLowerCase());
    return own ? `Product document missing for ${project.name}; its seat writes it from the records before other work.` : "";
  }
  if (missing.length === 0) return "";
  const plural = missing.length === 1 ? "" : "s";
  return `Product document${plural} missing in ${missing.length} project${plural}.`;
}

function productTexts(result) {
  const stale = (result.mind?.product?.stale ?? []).map((item) => `Product document of ${item.project}: ${item.updated ? `updated ${item.updated}` : "undated"}, older than the Fact of ${item.fact} that points to it; /protocol product-requirements brings it up to date.`);
  return [...stale, missingProductText(result)].filter(Boolean);
}

function modelTexts(mind) {
  return (mind?.models?.unregistered ?? []).map((item) => `Models: the row "${item.work}" names the client "${item.client}", which is not a Relay wake adapter or subagent; correct user/models.md.`);
}

function formatStatus(result) {
  const lines = [];
  if (!result.machineRecord) lines.push(`This machine (${result.machine}) has no machine record in the mind. Run hivem1nd init to set it up.`);
  if (result.missing?.length) {
    lines.push(`Not installed on this machine: ${result.missing.map((asset) => asset.name).join(", ")}. Run /evolve to install.`);
  }
  if (result.update?.updateAvailable) lines.push(`HIVEM1ND ${result.update.latestVersion} is available. Run /evolve to update.`);
  if (result.repository) lines.push(`${result.repository} is a Git repository that is not a registered project.`);
  const project = result.project ? waitingText(result.project) : "";
  if (project) lines.push(`${result.project.name}: ${project}.`);
  const executive = result.executive ? waitingText(result.executive) : "";
  if (executive) lines.push(`Executive roles: ${executive}.`);
  const mind = mindText(result.mind);
  if (mind) lines.push(mind);
  lines.push(...productTexts(result));
  lines.push(...modelTexts(result.mind));
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function relayUninstallLine({ client, status, reason }) {
  if (status === "removed") return `${client}: Relay entry removed.`;
  if (status === "elsewhere") return `${client}: Relay entry points elsewhere, kept.`;
  if (status === "failed") return `${client}: Relay entry not removed. ${reason}`;
  return `${client}: no Relay entry.`;
}

function formatUninstall(result) {
  const lines = result.removed.length
    ? result.removed.map((path) => `Removed: ${path}`)
    : ["Nothing was removed."];
  for (const path of result.updated ?? []) lines.push(`Rule line removed: ${path}`);
  for (const item of result.kept ?? []) lines.push(`Kept: ${item.path} (${item.reason})`);
  for (const item of result.relay ?? []) lines.push(relayUninstallLine(item));
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function formatHumanResult(result) {
  if (result.action === "check") return formatCheck(result);
  if (result.action === "evolve") return formatEvolve(result);
  if (result.action === "pylon") return formatPylon(result);
  if (result.action === "swarm") return formatSwarm(result);
  if (result.contract === "hivem1nd-view-v1") return formatView(result);
  if (result.action === "status") return formatStatus(result);
  if (result.action === "uninstall") return formatUninstall(result);
  return formatResult(result);
}

function setupOptions(options, { env = process.env, lifecycle = false } = {}) {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const currentMind = path.join(process.cwd(), "user", "VERSION");
  return {
    kitPath: path.resolve(options.kitPath ?? KIT_PATH),
    ...(options.mindPath
      ? { mindPath: path.resolve(options.mindPath) }
      : lifecycle
        ? { mindPath: existsSync(currentMind) ? process.cwd() : path.join(homeDir, "HIVEM1ND") }
        : {}),
    homeDir,
    hostname: options.hostname ?? os.hostname(),
    ...(options.language ? { language: options.language } : {}),
    env,
    resume: options.resume === true,
    relaySetup: true,
    serviceSetup: true,
    serviceDryRun: lifecycle ? true : options.dryRun === true,
    ...(lifecycle || options.dryRun === true ? {} : { serviceRunner: runRegistrationCommand, serviceStart: startUserService }),
    ...(options.originKind ? { originKind: options.originKind } : {}),
    ...(options.originPath ? { originPath: options.originPath } : {}),
    ...(options.cosmicPath ? { cosmicPath: options.cosmicPath } : {}),
  };
}

function cancelled(prompts, value, message = "Setup cancelled.") {
  if (!prompts.isCancel(value)) return false;
  prompts.cancel(message);
  return true;
}

function normalizePaths(value) {
  return String(value ?? "")
    .split(/[;\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const terminalCopy = {
  en: {
    required: "A value is required.",
    invalidNumber: "Enter a whole number.",
    onDemand: "On demand",
    auto: "Auto",
    paths: "separate paths with ;",
    noFiles: "No files will be written.",
    warning: "Warning",
    writePreview: "Write preview",
    keep: "Keep existing",
    replace: "Replace",
    replaceLink: "Remove the link and write the files",
    omitLink: "Leave those files uninstalled",
    report: "Report",
    confirm: "Write these files?",
    cancelled: "Nothing was written.",
    installing: "Installing the mind",
    installed: "Mind installed",
    stopped: "Installation stopped",
    done: "Done.",
    step: "Step",
    chooseAction: "Choose an action",
    renameEnvironments: "Rename environments",
    noGroups: "No repositories found.",
  },
  es: {
    required: "Se requiere un valor.",
    invalidNumber: "Ingresar un número entero.",
    onDemand: "Bajo demanda",
    auto: "Automático",
    paths: "separar las rutas con ;",
    noFiles: "No se escribirá ningún archivo.",
    warning: "Aviso",
    writePreview: "Vista previa",
    keep: "Conservar existente",
    replace: "Reemplazar",
    replaceLink: "Quitar el enlace y escribir los archivos",
    omitLink: "Dejar esos archivos sin instalar",
    report: "Reporte",
    confirm: "¿Escribir estos archivos?",
    cancelled: "No se escribió nada.",
    installing: "Instalando el mind",
    installed: "Mind instalado",
    stopped: "Instalación detenida",
    done: "Listo.",
    step: "Paso",
    chooseAction: "Elegir una acción",
    renameEnvironments: "Renombrar entornos",
    noGroups: "No se encontraron repositorios.",
  },
};

async function promptAttachModes(prompts, field, values, language) {
  const labels = terminalCopy[language];
  const current = values?.[field.id] ?? field.value ?? {};
  const choices = field.options ?? Object.keys(current).map((value) => ({ value, label: value }));
  const answer = {};
  for (const choice of choices) {
    const value = await prompts.select({
      message: `${ACID}${field.label}${RESET} ${choice.label}`,
      options: [
        { value: "on-demand", label: labels.onDemand },
        { value: "auto", label: labels.auto },
      ],
      initialValue: current[choice.value] ?? "on-demand",
    });
    if (prompts.isCancel(value)) return value;
    answer[choice.value] = value;
  }
  return answer;
}

async function promptField(prompts, field, values, language) {
  const labels = terminalCopy[language];
  const current = values?.[field.id] ?? field.value;
  if (field.id === "attachModes") return promptAttachModes(prompts, field, values, language);

  const common = {
    message: field.help ? `${ACID}${field.label}${RESET} ${DIM}${field.help}${RESET}` : `${ACID}${field.label}${RESET}`,
    ...(current !== undefined ? { initialValue: current } : {}),
    validate(value) {
      if (field.required && (value === "" || value === undefined || (Array.isArray(value) && value.length === 0))) {
        return labels.required;
      }
    },
  };

  switch (field.type) {
    case "select":
      return prompts.select({ ...common, options: field.options ?? [] });
    case "multiselect":
      return prompts.multiselect({
        ...common,
        options: field.options ?? [],
        required: field.required === true,
        initialValues: Array.isArray(current) ? current : undefined,
      });
    case "boolean":
      return prompts.confirm({
        ...common,
        initialValue: current ?? true,
        ...(language === "es" ? { active: "Sí", inactive: "No" } : {}),
      });
    case "paths": {
      const value = await prompts.multiline({
        ...common,
        message: `${common.message} ${DIM}(${labels.paths})${RESET}`,
        initialValue: Array.isArray(current) ? current.join("; ") : current,
      });
      return prompts.isCancel(value) ? value : normalizePaths(value);
    }
    case "textarea":
      return prompts.multiline(common);
    case "text":
      return prompts.text(common);
    case "number": {
      const value = await prompts.text({
        ...common,
        validate(input) {
          if (field.required && (input === "" || input === undefined)) return labels.required;
          if (input !== "" && input !== undefined && !/^-?\d+$/.test(String(input).trim())) return labels.invalidNumber;
        },
      });
      if (prompts.isCancel(value)) return value;
      const trimmed = String(value ?? "").trim();
      return trimmed === "" ? undefined : Number(trimmed);
    }
    default:
      throw new Error(`Unsupported setup field type: ${field.type}`);
  }
}

function formatProjectsGroups(groups, labels) {
  if (!groups.length) return labels.noGroups;
  return groups.map((group) => {
    const header = group.environment ? `${group.folder} (${group.environment})` : group.folder;
    const projects = group.projects.map((project) => `  ${project.index} ${project.name}`).join("\n");
    return projects ? `${header}\n${projects}` : header;
  }).join("\n");
}

async function runProjectsStep(session, prompts, initialStep) {
  const language = initialStep.language ?? "en";
  const labels = terminalCopy[language];
  const cancelMessage = language === "es" ? "Configuración cancelada." : "Setup cancelled.";
  let step = initialStep;
  let environmentEdits = {};
  const fieldLabel = (id) => step.fields.find((candidate) => candidate.id === id)?.label ?? labels.chooseAction;

  while (true) {
    prompts.note(formatProjectsGroups(step.groups, labels), step.title);

    const options = [{ value: "confirm", label: fieldLabel("projectsConfirmed") }];
    if (step.groups.length > 0) options.push({ value: "rename", label: labels.renameEnvironments });
    if (step.groups.some((group) => group.projects.length > 0)) {
      options.push({ value: "removeProject", label: fieldLabel("removeProject") });
    }
    if (step.groups.length > 0) options.push({ value: "removeEnvironment", label: fieldLabel("removeEnvironment") });
    options.push({ value: "addRoot", label: fieldLabel("addRoot") });

    const action = await prompts.select({ message: labels.chooseAction, options });
    if (cancelled(prompts, action, cancelMessage)) return null;

    if (action === "confirm") {
      await session.answer({ projectsConfirmed: true, ...environmentEdits });
      return true;
    }

    if (action === "rename") {
      const groupEnvironmentLabel = step.fields.find((candidate) => candidate.id.startsWith("groupEnvironment."))?.label
        ?? labels.renameEnvironments;
      for (const [index, group] of step.groups.entries()) {
        const key = `groupEnvironment.${index}`;
        const value = await prompts.text({
          message: `${ACID}${groupEnvironmentLabel}${RESET} ${group.folder}`,
          initialValue: environmentEdits[key] ?? group.environment,
        });
        if (cancelled(prompts, value, cancelMessage)) return null;
        environmentEdits[key] = value;
      }
      step = {
        ...step,
        groups: step.groups.map((group, index) => ({
          ...group,
          environment: environmentEdits[`groupEnvironment.${index}`] ?? group.environment,
        })),
      };
      continue;
    }

    if (action === "removeProject") {
      const projectOptions = step.groups.flatMap((group) => group.projects.map((project) => ({
        value: project.index,
        label: `${project.index} ${project.name}`,
      })));
      const index = await prompts.select({ message: fieldLabel("removeProject"), options: projectOptions });
      if (cancelled(prompts, index, cancelMessage)) return null;
      step = await session.answer({ removeProject: index });
      environmentEdits = {};
      continue;
    }

    if (action === "removeEnvironment") {
      const groupOptions = step.groups.map((group) => ({
        value: group.id,
        label: group.environment ? `${group.folder} (${group.environment})` : group.folder,
      }));
      const groupId = await prompts.select({ message: fieldLabel("removeEnvironment"), options: groupOptions });
      if (cancelled(prompts, groupId, cancelMessage)) return null;
      step = await session.answer({ removeEnvironment: groupId });
      environmentEdits = {};
      continue;
    }

    if (action === "addRoot") {
      const folder = await prompts.text({
        message: fieldLabel("addRoot"),
        validate(value) {
          if (value === "" || value === undefined) return labels.required;
        },
      });
      if (cancelled(prompts, folder, cancelMessage)) return null;
      step = await session.answer({ addRoot: folder });
      environmentEdits = {};
      continue;
    }
  }
}

function reportOutcome(prompts, labels, result) {
  for (const attach of result?.attachPrompts ?? []) prompts.note(attach.text, attach.agent);
  for (const notice of result?.notices ?? []) prompts.log.info(notice);
  if (result?.reportPath) prompts.log.info(`${labels.report}: ${result.reportPath}`);
}

function conflictLabel(labels, conflict, value) {
  if (conflict.link) return value === "replace" ? labels.replaceLink : labels.omitLink;
  return value === "keep" ? labels.keep : labels.replace;
}

function previewText(preview, language) {
  const labels = terminalCopy[language];
  const files = preview.files?.map((file) => `${file.action.padEnd(8)} ${file.path}`) ?? [];
  const warnings = preview.warnings?.map((warning) => `${labels.warning}: ${warning}`) ?? [];
  return [...files, ...warnings].join("\n") || labels.noFiles;
}

async function collectStep(prompts, step) {
  const group = {};
  for (const field of step.fields ?? []) {
    group[field.id] = () => promptField(prompts, field, step.values ?? {}, step.language ?? "en");
  }
  if (Object.keys(group).length === 0) return {};
  let wasCancelled = false;
  const answers = await prompts.group(group, {
    onCancel() {
      wasCancelled = true;
      prompts.cancel(step.language === "es" ? "Configuración cancelada." : "Setup cancelled.");
    },
  });
  return wasCancelled ? null : answers;
}

export async function runTerminalSetup(session, prompts) {
  prompts.intro(`${ACID}HIVEM1ND${RESET}`);

  while (true) {
    const step = await session.getStep();
    const labels = terminalCopy[step.language ?? "en"];
    if (step.done || step.number === 8) {
      reportOutcome(prompts, labels, step.result);
      prompts.outro(step.result?.message ?? step.description ?? step.title);
      return step.result ?? step;
    }

    const heading = `${labels.step} ${step.number}/8 · ${step.title}`;
    if (step.description) prompts.note(step.description, heading);
    else prompts.log.step(heading);
    if (step.alert) prompts.log.warn(step.alert);
    if (step.number === 5) {
      const result = await runProjectsStep(session, prompts, step);
      if (result === null) return null;
      continue;
    }
    if (step.number === 7) {
      const preview = await session.preview();
      prompts.note(previewText(preview, step.language ?? "en"), labels.writePreview);
      const conflicts = {};
      for (const conflict of preview.conflicts ?? []) {
        const choice = await prompts.select({
          message: `${conflict.path}: ${conflict.reason}`,
          options: (conflict.choices ?? ["keep", "replace"]).map((value) => ({
            value,
            label: conflictLabel(labels, conflict, value),
          })),
          initialValue: conflict.selection,
        });
        if (cancelled(prompts, choice, step.language === "es" ? "Configuración cancelada." : "Setup cancelled.")) return null;
        conflicts[conflict.path] = choice;
      }
      const confirm = await prompts.confirm({
        message: labels.confirm,
        initialValue: true,
        ...(step.language === "es" ? { active: "Sí", inactive: "No" } : {}),
      });
      if (cancelled(prompts, confirm, step.language === "es" ? "Configuración cancelada." : "Setup cancelled.")) return null;
      if (!confirm) {
        prompts.cancel(labels.cancelled);
        return null;
      }
      await session.answer({ confirm: true, conflicts });
      const spin = prompts.spinner();
      spin.start(labels.installing);
      try {
        const result = await session.install();
        spin.stop(labels.installed);
        const completed = await session.getStep();
        reportOutcome(prompts, labels, completed.result ?? result);
        prompts.outro(completed.result?.message ?? result?.message ?? labels.done);
        return result;
      } catch (error) {
        spin.stop(labels.stopped);
        throw error;
      }
    }

    const answers = await collectStep(prompts, step);
    if (answers === null) return null;
    await session.answer(answers);
  }
}

async function openLocalUrl(url) {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  const command = platform === "win32" ? "rundll32" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

async function waitForServer(server, output) {
  output.write(`Local wizard: ${server.url}\nPress Ctrl+C to stop it.\n`);
  await new Promise((resolve) => {
    const stop = async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await server.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runInit(options, dependencies, output) {
  if (options.gui) {
    const { createWizardServer } = dependencies.wizard ?? await import("../gui/server.mjs");
    const server = await createWizardServer({
      sessionOptions: setupOptions(options, { env: dependencies.env }),
      openCompletedViewer: dependencies.openCompletedViewer,
    });
    await (dependencies.openUrl ?? openLocalUrl)(server.url);
    await (dependencies.waitForServer ?? waitForServer)(server, output);
    return 0;
  }
  const { createSetupSession } = dependencies.setup ?? await import("../engine/setup.mjs");
  const prompts = dependencies.prompts ?? await import("@clack/prompts");
  const session = await createSetupSession(setupOptions(options, { env: dependencies.env }));
  return await runTerminalSetup(session, prompts) === null ? 130 : 0;
}

async function completePylonOptions(options, prompts) {
  const complete = { ...options };
  if (!complete.state) {
    complete.state = await prompts.select({
      message: "Where should team state be stored?",
      options: [
        { value: "branch", label: "Dedicated branch" },
        { value: "main", label: "Main branch" },
      ],
      initialValue: "branch",
    });
  }
  if (complete.aiTrailers === undefined) {
    complete.aiTrailers = await prompts.confirm({ message: "Allow AI trailers in commits?", initialValue: false });
  }
  if (complete.aiFiles === undefined) {
    complete.aiFiles = await prompts.confirm({ message: "Allow shared AI files?", initialValue: true });
  }
  if ([complete.state, complete.aiTrailers, complete.aiFiles].some((value) => prompts.isCancel(value))) {
    prompts.cancel("Pylon cancelled.");
    return null;
  }
  return complete;
}

async function runLifecycle(command, options, dependencies, output) {
  const lifecycle = dependencies.lifecycle ?? await import("../engine/lifecycle.mjs");
  const common = setupOptions(options, { env: dependencies.env, lifecycle: true });
  delete common.language;
  delete common.resume;
  let result;
  if (command === "evolve") {
    result = options.checkOnly
      ? await lifecycle.checkForUpdates(common)
      : await lifecycle.evolve({ ...common, conflicts: options.conflicts ?? {} });
    // An agent runs this without a terminal, where a prompt would wait forever; the conflicts are
    // listed instead and the exit code reports the incomplete run.
    const interactive = (dependencies.stdin ?? process.stdin).isTTY === true && output.isTTY === true;
    if (!options.checkOnly && !options.json && interactive && result.completed === false && result.conflicts?.length) {
      const prompts = dependencies.prompts ?? await import("@clack/prompts");
      const conflicts = { ...(options.conflicts ?? {}) };
      for (const conflict of result.conflicts) {
        const selection = await prompts.select({
          message: `${conflict.path}: ${conflict.reason}`,
          options: (conflict.choices ?? ["keep", "replace"]).map((value) => ({
            value,
            label: conflictLabel(terminalCopy.en, conflict, value),
          })),
          initialValue: conflict.selection,
        });
        if (prompts.isCancel(selection)) {
          prompts.cancel("Update cancelled.");
          return 130;
        }
        conflicts[conflict.path] = selection;
      }
      result = await lifecycle.evolve({ ...common, conflicts });
    }
  } else if (command === "swarm") {
    result = await lifecycle.swarm(common);
  } else if (command === "view") {
    const { readView } = dependencies.view ?? await import("../engine/view.mjs");
    result = await readView({ mindPath: common.mindPath, hostname: common.hostname, ...(options.project ? { project: options.project } : {}) });
  } else if (command === "check") {
    result = await lifecycle.check(common);
  } else {
    const prompts = dependencies.prompts ?? await import("@clack/prompts");
    const complete = await completePylonOptions(options, prompts);
    if (!complete) return 130;
    result = await lifecycle.pylon({
      ...common,
      repoPath: path.resolve(complete.repoPath),
      state: complete.state,
      aiFiles: complete.aiFiles,
      aiTrailers: complete.aiTrailers,
      ...(complete.environment ? { environment: complete.environment } : {}),
    });
  }
  const text = options.json ? formatResult(result) : formatHumanResult(result);
  if (text) output.write(`${text}\n`);
  return result.completed === false ? 1 : 0;
}

async function runService(options, dependencies, output) {
  const { installService, planRegistration, uninstallService } = dependencies.serviceInstall ?? await import("../engine/service/install.mjs");
  if (!options.mindPath && !options.cosmicPath) {
    output.write("Service commands need --mind-path or --cosmic-path. Nothing was discovered or written.\n");
    return 1;
  }
  const mindPath = options.mindPath
    ? path.resolve(options.mindPath)
    : path.join(path.resolve(options.cosmicPath), "hivem1nd");
  const registration = {
    platform: process.platform,
    nodePath: process.execPath,
    cliPath: path.join(KIT_PATH, "cli", "index.mjs"),
    mindPath,
    workingDirectory: KIT_PATH,
    localDirectory: options.cosmicPath ? path.resolve(options.cosmicPath) : path.dirname(mindPath),
    home: options.homeDir ? path.resolve(options.homeDir) : os.homedir(),
    sid: dependencies.sid ?? "S-1-5-21-current",
  };
  const dry = options.dryRun === true;
  if (options.action === "status") {
    output.write("Service status is plan-only here. No login registration was queried on the operating system.\n");
    return 0;
  }
  if (options.action === "run") {
    const { runConfiguredService, stopService } = dependencies.serviceRuntime ?? await import("../engine/service/service.mjs");
    let handle;
    try {
      handle = await runConfiguredService({
        mindPath,
        platform: dependencies.platform ?? process.platform,
        env: dependencies.env ?? process.env,
        home: options.homeDir ? path.resolve(options.homeDir) : os.homedir(),
        cosmicPath: options.cosmicPath ? path.resolve(options.cosmicPath) : undefined,
        hostname: options.hostname,
        aclRunner: dependencies.aclRunner,
        confineRoot: dependencies.confineRoot,
        now: dependencies.now,
        userKey: dependencies.userKey,
        guardPort: dependencies.guardPort,
      });
    } catch (error) {
      output.write(`${error.code ?? "error"}: ${error.message}\n`);
      return 1;
    }
    try {
      await (dependencies.stop ?? waitForServiceStop());
    } finally {
      await stopService(handle);
    }
    output.write("Service stopped.\n");
    return 0;
  }
  if (!dry && !dependencies.sid) {
    const { aclRunnerFrom } = await import("../engine/service/security.mjs");
    registration.sid = (dependencies.aclRunner ?? aclRunnerFrom(dependencies)).userSid();
  }
  const plan = planRegistration(registration);
  if (options.action === "uninstall") {
    if (options.dryRun === false && !dependencies.registrationRunner) {
      output.write("Refusing to delete a login registration without an injected runner.\n");
      return 1;
    }
    const removal = uninstallService(plan);
    output.write(`${JSON.stringify({ dryRun: true, os: false, commands: removal.commands }, null, 2)}\n`);
    return 0;
  }
  const installed = await installService(registration, {
    dryRun: dry,
    run: dependencies.registrationRunner ?? (dry ? null : runRegistrationCommand),
    query: dependencies.queryRegistration,
    aclRunner: dependencies.aclRunner,
  });
  output.write(`${JSON.stringify({ dryRun: dry, os: installed.os === true, action: installed.action, commands: installed.commands, digest: installed.digest }, null, 2)}\n`);
  return 0;
}

async function startUserService(config) {
  const { startConfiguredViewer } = await import("../engine/service/install.mjs");
  return startConfiguredViewer(config);
}

function runRegistrationCommand(argv) {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const [file, ...args] = argv;
      const child = spawn(file, args, { shell: false, windowsHide: true });
      child.once("error", reject);
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("The registration command failed."))));
    }).catch(reject);
  });
}

function waitForServiceStop() {
  return new Promise((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

async function runUninstall(options, dependencies, output) {
  const uninstall = dependencies.uninstall ?? (await import("../engine/uninstall.mjs")).uninstall;
  const common = setupOptions(options, { env: dependencies.env, lifecycle: true });
  delete common.language;
  delete common.resume;
  delete common.kitPath;
  const result = await uninstall({ ...common, dryRun: options.dryRun === true, removeMind: options.removeMind === true });
  output.write(`${options.json ? formatResult(result) : formatHumanResult(result)}\n`);
  return 0;
}

async function readInput(stream, maximum = 262144) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk);
    length += value.length;
    if (length > maximum) throw new Error("Relay input exceeds the allowed size.");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function relayWakeBinding(options, hostname = os.hostname(), adapters = WAKE_ADAPTERS) {
  if (!options.unit) throw new CliUsageError('Relay wake requires an explicit --unit.');
  if (!options.nativeSessionId) throw new CliUsageError('Relay wake requires --native-session-id.');
  const client = options.client ?? 'claude';
  if (!getWakeAdapter(client, adapters)) throw new CliUsageError('Unsupported Relay wake client.');
  return { unit: options.unit, nativeSessionId: options.nativeSessionId, client, machine: options.machine ?? hostname };
}

async function runRelayWake(options, dependencies, output, errorOutput) {
  if (!options.mindPath) throw new CliUsageError(`relay wake ${options.wakeAction} requires --mind-path.`);
  const env = dependencies.env ?? process.env;
  const hostname = options.hostname ?? os.hostname();
  const client = options.client ?? 'claude';
  const adapters = dependencies.wakeAdapters ?? WAKE_ADAPTERS;
  const adapter = getWakeAdapter(client, adapters);
  if (!adapter) throw new CliUsageError('Unsupported Relay wake client.');
  const { createRelayWakeController } = dependencies.createRelayWakeController
    ? { createRelayWakeController: dependencies.createRelayWakeController }
    : await import('../engine/relay/wake.mjs');
  const runtime = { env, platform: dependencies.platform ?? process.platform };
  const sink = (delivery) => adapter.sendPointer({ ...delivery, ...runtime });
  const controller = await createRelayWakeController({
    mindPath: options.mindPath,
    hostname,
    sink,
    ...adapter.controllerOptions,
    ...(dependencies.wakeAdapters ? { adapters } : {}),
  });

  if (options.wakeAction === 'attach') {
    if (!options.unit) throw new CliUsageError('relay wake attach requires an explicit --unit.');
    let identity;
    try { identity = adapter.attachIdentity({ nativeSessionId: options.nativeSessionId, ...runtime }); }
    catch (error) { throw new CliUsageError(error.message); }
    const { nativeSessionId } = identity;
    const capability = adapter.capability(runtime);
    if (!capability.available) throw new CliUsageError(client + ' wake is unavailable: ' + capability.reason + '.');
    try { await adapter.validateRuntime(runtime); }
    catch (error) { throw new CliUsageError(error.message); }
    const binding = { unit: options.unit, nativeSessionId, client, machine: hostname };
    const { createRelay } = dependencies.createRelay
      ? { createRelay: dependencies.createRelay }
      : await import('../engine/relay/store.mjs');
    const relay = await createRelay({
      mindPath: options.mindPath,
      hostname,
      sessionId: identity.sessionId,
      client,
    });
    if (identity.requireRegistration) {
      const existing = await relay.reminder({ nativeSessionId, client });
      if (!existing.registered || existing.unit !== options.unit) {
        throw new CliUsageError(adapter.label + ' wake requires an existing exact registration for the selected target and unit.');
      }
    } else {
      await relay.register({ unit: options.unit, nativeSessionId, client });
    }
    const policy = await controller.enable({
      ...binding,
      ...(options.hours ? { windowHours: Number(options.hours) } : {}),
      ...(options.extended ? { extended: true } : {}),
      ...(options.unlimited ? { unlimited: true, manualConsent: true } : {}),
      ...(options.maxHandoffs ? { maxHandoffs: Number(options.maxHandoffs) } : {}),
    });
    if (identity.activity) await controller.observeActivity(binding, { activity: identity.activity });
    if (identity.warning) errorOutput.write(`${identity.warning}\n`);
    try {
      const spawnWorker = dependencies[adapter.workerDependency] ?? adapter.spawnWorker;
      const worker = spawnWorker({ cliPath: path.join(dependencies.kitPath ?? KIT_PATH, 'cli', 'index.mjs'), mindPath: options.mindPath, binding, env, keepParentAliveUntilReady: true });
      const readiness = await worker.ready;
      output.write(`${formatResult({ binding, policy, worker: readiness.state, ownsLease: readiness.ownsLease, delivery: 'not claimed' })}\n`);
    } catch (error) {
      await controller.disable(binding).catch(() => {});
      throw new CliUsageError(client + ' wake watcher could not start: ' + error.message);
    }
    return 0;
  }

  const binding = relayWakeBinding(options, hostname, adapters);
  if (options.wakeAction === 'watch') {
    const capability = adapter.capability(runtime);
    if (!capability.available) throw new CliUsageError(client + ' wake is unavailable: ' + capability.reason + '.');
    try { await adapter.validateRuntime({ ...runtime, binding }); }
    catch (error) { throw new CliUsageError(error.message); }
    const handle = controller.start(binding);
    const terminate = () => handle.stop();
    process.once('SIGINT', terminate);
    process.once('SIGTERM', terminate);
    try {
      const readiness = await handle.ready;
      if (process.connected) {
        try {
          process.send?.({ type: 'relay-wake-ready', state: readiness.state, ownsLease: readiness.ownsLease }, (error) => {
            if (error && process.connected) {
              try { process.disconnect(); } catch { /* parent already exited */ }
            }
          });
        } catch { /* the detached hook parent may have exited */ }
        try { if (process.connected) process.disconnect(); } catch { /* already disconnected */ }
      }
      const result = await handle.done;
      if (result?.reason === 'error') errorOutput.write('Relay wake watcher stopped after an internal error.\n');
    } finally {
      process.removeListener('SIGINT', terminate);
      process.removeListener('SIGTERM', terminate);
    }
    return 0;
  }

  if (options.wakeAction === 'enable') {
    const policy = await controller.enable({
      ...binding,
      ...(options.hours ? { windowHours: Number(options.hours) } : {}),
      ...(options.extended ? { extended: true } : {}),
      ...(options.unlimited ? { unlimited: true, manualConsent: true } : {}),
      ...(options.maxHandoffs ? { maxHandoffs: Number(options.maxHandoffs) } : {}),
    });
    output.write(`${formatResult(policy)}\n`);
  } else if (options.wakeAction === 'disable') {
    output.write(`${formatResult(await controller.disable(binding))}\n`);
  } else {
    output.write(`${formatResult(await controller.status(binding))}\n`);
  }
  return 0;
}

async function runRelay(options, dependencies, output) {
  if (options.help) { output.write(`${helpText()}\n`); return 0; }
  const { action } = options;
  if (action === "diagnose") {
    const { diagnoseRelayClients, RELAY_CLIENTS } = await import("../engine/relay/config.mjs");
    if (options.client && !RELAY_CLIENTS.includes(options.client)) throw new CliUsageError("Unsupported Relay client.");
    const found = await diagnoseRelayClients({ homeDir: options.homeDir, mindPath: options.mindPath });
    const result = options.client ? { [options.client]: found[options.client] } : found;
    // A consent whose worker is not running wakes nothing, and nothing else says so.
    if (options.mindPath) {
      try {
        const { createRelayWakeController } = dependencies.createRelayWakeController
          ? { createRelayWakeController: dependencies.createRelayWakeController }
          : await import("../engine/relay/wake.mjs");
        const controller = await createRelayWakeController({ mindPath: options.mindPath, hostname: options.hostname ?? os.hostname(),
          sink: async () => ({ status: "not_submitted" }) });
        for (const { binding, worker } of await controller.workerStates()) {
          if (!result[binding.client]) continue;
          (result[binding.client].wake ??= []).push({ unit: binding.unit, nativeSessionId: binding.nativeSessionId,
            state: worker === "running" ? "enabled" : "enabled, no worker" });
        }
      } catch { /* a folder that is not a mind has no consents to report */ }
    }
    output.write(`${formatResult(result)}\n`);
    return 0;
  }
  if (action === "configure" || action === "unconfigure") {
    if (!options.client) throw new CliUsageError(`relay ${action} requires --client.`);
    if (action === "configure" && !options.mindPath) throw new CliUsageError("relay configure requires --mind-path.");
    const config = await import("../engine/relay/config.mjs");
    const result = action === "configure"
      ? await config.configureRelayClient({ ...options, kitPath: options.kitPath ?? KIT_PATH })
      : await config.unconfigureRelayClient(options);
    output.write(`${formatResult(result)}\n`);
    return 0;
  }
  if (!options.mindPath) throw new CliUsageError(`relay ${action} requires --mind-path.`);
  if (action === "hook") {
    if (!options.client) throw new CliUsageError("relay hook requires --client.");
    const { runRelayHook } = await import("../engine/relay/hooks.mjs");
    await runRelayHook({
      ...options,
      stdin: dependencies.stdin ?? process.stdin,
      stdout: output,
      stderr: dependencies.stderr ?? process.stderr,
    });
    return 0;
  }
  if (action === 'wake') return runRelayWake(options, dependencies, output, dependencies.stderr ?? process.stderr);
  if (action === "mcp") {
    const { serveRelayMcp } = await import("../engine/relay/mcp.mjs");
    await serveRelayMcp({ ...options, stdin: dependencies.stdin ?? process.stdin, stdout: output, stderr: dependencies.stderr ?? process.stderr });
    return 0;
  }
  if (action === "reminder" && !options.sessionId && !options.nativeSessionId) throw new CliUsageError("relay reminder requires --session-id or --native-session-id.");
  if (action !== "reminder" && action !== "status" && !options.sessionId) throw new CliUsageError(`relay ${action} requires --session-id to select its registered instance.`);
  if (action === "read" && options.threadId) throw new CliUsageError("relay read does not accept --thread-id; relay history filters by thread.");
  if (action === "status" && options.limit) throw new CliUsageError("relay status does not accept --limit.");
  if (action === "delivery" && !options.ids.length) throw new CliUsageError("relay delivery requires at least one --id.");
  if (action === "delivery" && (options.unit !== undefined || options.limit)) throw new CliUsageError("relay delivery answers for the registered unit and takes only --id.");

  const { openRelayOperations } = await import("../engine/service/client.mjs");
  const relay = await openRelayOperations({
    mindPath: options.mindPath,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.client ? { client: options.client } : {}),
  });
  let args = {};
  if (action === "register") {
    if (!options.unit) throw new CliUsageError("relay register requires an explicit --unit.");
    args = {
      unit: options.unit,
      ...(options.nativeSessionId ? { nativeSessionId: options.nativeSessionId } : {}),
      ...(options.client ? { client: options.client } : {}),
      ...(options.activity ? { activity: options.activity } : {}),
      ...(options.quota !== undefined ? { quota: options.quota } : {}),
    };
  } else if (action === "send") {
    if (!options.to || !options.subject) throw new CliUsageError("relay send requires --to and --subject.");
    const body = options.bodyStdin ? await readInput(dependencies.stdin ?? process.stdin) : options.body;
    if (body === undefined) throw new CliUsageError("relay send requires --body or --body-stdin.");
    args = { to: options.to, subject: options.subject, body, priority: options.priority, replyTo: options.replyTo, threadId: options.threadId,
      replyRequested: options.replyRequested, attachments: options.attachments.length ? options.attachments : undefined };
  } else if (action === "inbox" || action === "read" || action === "history" || action === "status" || action === "events") {
    // Store methods reject any field they do not accept, even an undefined one.
    if (options.unit !== undefined) args.unit = options.unit;
    if (options.limit) args.limit = Number(options.limit);
    if (options.ids.length && (action === "read" || action === "history")) args.ids = options.ids;
    if (options.threadId && action === "history") args.threadId = options.threadId;
  } else if (action === "reminder") {
    args = { unit: options.unit, nativeSessionId: options.nativeSessionId, client: options.client };
  } else if (action === "delivery") {
    args = { ids: options.ids };
  }
  const method = action === "register" ? "register"
    : action === "send" ? "send"
      : action === "inbox" ? "inbox"
        : action === "read" ? "read"
          : action;
  const result = await relay[method](args);
  output.write(`${formatResult(result)}\n`);
  return 0;
}

async function runTask(options, dependencies, output, errorOutput) {
  if (options.help) {
    output.write(`${helpText()}\n`);
    return 0;
  }
  if (!options.mindPath) {
    errorOutput.write("Usage error: task requires --mind-path.\n");
    return 2;
  }
  const { randomUUID } = await import("node:crypto");
  const { bindNative, connectService, request } = await import("../engine/service/client.mjs");
  if (dependencies.bridge || dependencies.proof) {
    const bound = bindNative({}, { bridge: dependencies.bridge, proof: dependencies.proof });
    if (!bound.nativeSupport) {
      errorOutput.write("native_login_unverified: Native attachment needs a verified handshake.\n");
      return 1;
    }
  }
  const service = await connectService({
    mindPath: options.mindPath,
    platform: dependencies.platform,
    env: dependencies.env,
    home: options.homeDir,
    cosmicPath: options.cosmicPath,
    hostname: options.hostname,
    aclRunner: dependencies.aclRunner,
    confineRoot: dependencies.confineRoot,
    now: dependencies.now,
    userKey: dependencies.userKey,
    guardPort: dependencies.guardPort,
  });
  const caller = { ...service, token: dependencies.agentToken ?? service.token };
  try {
    const current = await request(caller, { method: "GET", path: `/api/v1/tasks/${encodeURIComponent(options.taskId)}` });
    if (current.status !== 200 || !current.json?.data?.revision) {
      const code = current.json?.error?.code ?? "error";
      errorOutput.write(`${code}: The request failed.\n`);
      return current.status === 409 ? 3 : current.status === 422 ? 2 : 1;
    }
    const target = options.action === "undo"
      ? `/api/v1/tasks/${encodeURIComponent(options.taskId)}/undo`
      : `/api/v1/tasks/${encodeURIComponent(options.taskId)}/status`;
    const body = options.action === "undo"
      ? { expectedRevision: current.json.data.revision }
      : { status: options.status, note: options.note ?? "", expectedRevision: current.json.data.revision };
    const result = await request(caller, {
      method: "POST",
      path: target,
      body,
      headers: { "idempotency-key": randomUUID() },
    });
    if (result.status === 200) {
      output.write(`${JSON.stringify(result.json?.data ?? null)}\n`);
      return 0;
    }
    const code = result.json?.error?.code ?? "error";
    errorOutput.write(`${code}: The request failed.\n`);
    if (result.status === 409) return 3;
    if (result.status === 422) return 2;
    return 1;
  } finally {
    await service.release({ stop: true });
  }
}

export async function runCli(argv, dependencies = {}) {
  const output = dependencies.stdout ?? process.stdout;
  const errorOutput = dependencies.stderr ?? process.stderr;
  try {
    const parsed = parseArgs(argv);
    if (parsed.version) {
      output.write(`${VERSION}\n`);
      return 0;
    }
    if (parsed.help) {
      output.write(`${helpText()}\n`);
      return 0;
    }
    if (parsed.command === "init") {
      return await runInit(parsed.options, dependencies, output);
    } else if (parsed.command === "service") {
      return await runService(parsed.options, dependencies, output);
    } else if (parsed.command === "task") {
      return await runTask(parsed.options, dependencies, output, errorOutput);
    } else if (parsed.command === "uninstall") {
      return await runUninstall(parsed.options, dependencies, output);
    } else if (parsed.command === "relay") {
      return await runRelay(parsed.options, dependencies, output);
    } else {
      return await runLifecycle(parsed.command, parsed.options, dependencies, output);
    }
  } catch (error) {
    const prefix = error instanceof CliUsageError ? "Usage error" : "Error";
    errorOutput.write(`${prefix}: ${error?.message ?? "Unknown failure"}\n`);
    if (error instanceof CliUsageError) errorOutput.write("Run hivem1nd --help for usage.\n");
    return error instanceof CliUsageError ? 2 : 1;
  }
}

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  process.exitCode = await runCli(process.argv.slice(2));
}
