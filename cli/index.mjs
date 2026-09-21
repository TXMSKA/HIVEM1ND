#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  hivem1nd uninstall [--dry-run] [--remove-mind] [options]

Commands:
  init       Configure this machine in eight guided steps
  evolve     Update the mind and apply pending migrations
  check      Report what a new chat should know, without writing
  pylon      Attach a repository to the shared mind
  swarm      Show units, tasks and unread messages
  uninstall  Remove what HIVEM1ND wrote on this machine

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

Pylon options:
  --state <branch|main> Store team state on its own branch or on main
  --ai-files            Allow shared AI files (default)
  --no-ai-files         Keep shared AI files out of code branches
  --ai-trailers         Allow AI commit trailers
  --no-ai-trailers      Disallow AI commit trailers (default)
  --environment <name>  Environment name for the repository route

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
  init: new Set(["gui", "resume", "language", "kitPath", "mindPath", "homeDir", "hostname"]),
  evolve: new Set(["checkOnly", "conflicts", "json", "kitPath", "mindPath", "homeDir", "hostname"]),
  pylon: new Set(["state", "aiFiles", "aiTrailers", "environment", "json", "kitPath", "mindPath", "homeDir", "hostname"]),
  check: new Set(["json", "kitPath", "mindPath", "homeDir", "hostname"]),
  swarm: new Set(["json", "kitPath", "mindPath", "homeDir", "hostname"]),
  uninstall: new Set(["dryRun", "removeMind", "json", "mindPath", "homeDir", "hostname"]),
};

export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new CliUsageError("Arguments must be an array.");
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
    for (const conflict of result.conflicts ?? []) lines.push(`${conflict.path}: ${conflict.reason}`);
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
    lines.push(`${project.project} | open ${project.open} | done ${project.done}`);
    for (const item of project.items ?? []) lines.push(`${item.id} ${item.slug} | ${item.status}`);
  }

  lines.push("", "Inboxes");
  const unread = (result.inboxes?.units ?? []).filter((unit) => unit.count > 0);
  if (unread.length === 0) lines.push("(none)");
  for (const unit of unread) lines.push(`${unit.unit} | ${unit.count} unread`);
  return lines.join("\n");
}

function waitingText({ unread, open }) {
  return [
    unread ? `${unread} unread message${unread === 1 ? "" : "s"}` : "",
    open ? `${open} open task${open === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
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
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function formatUninstall(result) {
  const lines = result.removed.length
    ? result.removed.map((path) => `Removed: ${path}`)
    : ["Nothing was removed."];
  for (const path of result.updated ?? []) lines.push(`Rule line removed: ${path}`);
  for (const item of result.kept ?? []) lines.push(`Kept: ${item.path} (${item.reason})`);
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function formatHumanResult(result) {
  if (result.action === "check") return formatCheck(result);
  if (result.action === "evolve") return formatEvolve(result);
  if (result.action === "pylon") return formatPylon(result);
  if (result.action === "swarm") return formatSwarm(result);
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
    invalidNumber: "Ingresá un número entero.",
    onDemand: "Bajo demanda",
    auto: "Automático",
    paths: "separá las rutas con ;",
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
    const server = await createWizardServer({ sessionOptions: setupOptions(options, { env: dependencies.env }) });
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
    if (!options.checkOnly && !options.json && result.completed === false && result.conflicts?.length) {
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
    } else if (parsed.command === "uninstall") {
      return await runUninstall(parsed.options, dependencies, output);
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = await runCli(process.argv.slice(2));
}
