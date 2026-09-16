import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { helpText, parseArgs, runCli, runTerminalSetup } from "../cli/index.mjs";
import { createWindowOptions, parseElectronOptions, secureWebPreferences } from "../gui/electron.mjs";
import { createSetupSession } from "../engine/setup.mjs";

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sink() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    read() { return value; },
  };
}

test("help documents every v1 command", async () => {
  const output = sink();
  const errors = sink();
  const code = await runCli(["--help"], { stdout: output.stream, stderr: errors.stream });
  assert.equal(code, 0);
  assert.equal(errors.read(), "");
  for (const command of ["init", "evolve", "pylon", "swarm"]) {
    assert.match(output.read(), new RegExp(`\\b${command}\\b`));
  }
  assert.match(helpText(), /--gui/);
  assert.match(helpText(), /--check-only/);
});

test("invalid commands and parameters return usage errors", async () => {
  for (const argv of [
    ["unknown"],
    ["init", "--state", "main"],
    ["init", "--language", "fr"],
    ["pylon"],
    ["pylon", ".", "extra"],
    ["swarm", "--mystery"],
  ]) {
    const output = sink();
    const errors = sink();
    const code = await runCli(argv, { stdout: output.stream, stderr: errors.stream });
    assert.equal(code, 2, argv.join(" "));
    assert.match(errors.read(), /^Usage error:/);
    assert.equal(output.read(), "");
  }
});

test("parser rejects conflicting and repeated boolean options", () => {
  assert.throws(() => parseArgs(["pylon", ".", "--ai-files", "--no-ai-files"]), /Conflicting or repeated/);
  assert.throws(() => parseArgs(["init", "--resume", "--resume"]), /Conflicting or repeated/);
});

test("lifecycle receives isolated paths and injected environment", async () => {
  const output = sink();
  const scratch = path.join(os.tmpdir(), "hivem1nd-interface-test");
  const env = { HIVEM1ND_TEST: "1" };
  let received;
  const code = await runCli(["swarm", "--home-dir", scratch, "--mind-path", scratch, "--hostname", "TEST"], {
    stdout: output.stream,
    stderr: sink().stream,
    env,
    lifecycle: {
      async swarm(options) {
        received = options;
        return { action: "swarm", units: [] };
      },
    },
  });
  assert.equal(code, 0);
  assert.equal(received.homeDir, path.resolve(scratch));
  assert.equal(received.mindPath, path.resolve(scratch));
  assert.equal(received.hostname, "TEST");
  assert.equal(received.env, env);
  const expectedKit = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  assert.equal(path.normalize(received.kitPath), path.normalize(expectedKit));
  assert.equal(output.read(), "Units\n(none)\n\nTasks\n(none)\n\nInboxes\n(none)\n");
});

test("Electron defaults stay inside the selected test home", () => {
  const testHome = path.join(os.tmpdir(), "hivem1nd-electron-home");
  const overrideHome = path.join(os.tmpdir(), "hivem1nd-electron-override");
  assert.equal(parseElectronOptions([], testHome).mindPath, path.join(testHome, "HIVEM1ND"));
  const options = parseElectronOptions(["--home-dir", overrideHome], testHome);
  assert.equal(options.homeDir, path.resolve(overrideHome));
  assert.equal(options.mindPath, path.join(path.resolve(overrideHome), "HIVEM1ND"));
  const userData = path.join(os.tmpdir(), "hivem1nd-electron-profile");
  assert.equal(parseElectronOptions([`--user-data-dir=${userData}`], testHome).userDataDir, path.resolve(userData));
});

test("evolve accepts repeatable explicit conflict choices", () => {
  assert.deepEqual(
    parseArgs(["evolve", "--conflict", "C:/mind/rules.md=keep", "--conflict", "C:/mind/files.md=replace"]).options.conflicts,
    { "C:/mind/rules.md": "keep", "C:/mind/files.md": "replace" },
  );
  assert.throws(() => parseArgs(["evolve", "--check-only", "--conflict", "rules.md=keep"]), /cannot be used/);
});

test("evolve cancellation does not claim migrations were untouched", async () => {
  let cancellation = "";
  const cancelled = Symbol("cancelled");
  const code = await runCli(["evolve", "--mind-path", "."], {
    stdout: sink().stream,
    stderr: sink().stream,
    lifecycle: {
      async evolve() {
        return {
          action: "evolve",
          completed: false,
          conflicts: [{ path: "C:/mind/rules.md", reason: "Existing file", choices: ["keep", "replace"] }],
        };
      },
    },
    prompts: {
      async select() { return cancelled; },
      isCancel(value) { return value === cancelled; },
      cancel(message) { cancellation = message; },
    },
  });
  assert.equal(code, 130);
  assert.equal(cancellation, "Update cancelled.");
});

test("Electron renderer has no Node access and uses a sandbox", () => {
  assert.deepEqual(secureWebPreferences, {
    contextIsolation: true,
    devTools: false,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
  assert.deepEqual(createWindowOptions("icon.ico").webPreferences, secureWebPreferences);
  assert.equal(createWindowOptions("icon.ico").icon, "icon.ico");
});

test("Electron entry does not await startup readiness", async () => {
  const source = await readFile(new URL("../gui/electron.mjs", import.meta.url), "utf8");
  const entry = source.slice(source.indexOf("if (process.versions.electron"));
  assert.match(entry, /await import\("electron"\)/);
  assert.doesNotMatch(entry, /await\s+startElectronApp/);
  assert.match(entry, /void startElectronApp/);
  assert.match(entry, /electron\.app\.exit\(1\)/);
});

test("Electron shows the window after the local wizard finishes loading", async () => {
  const source = await readFile(new URL("../gui/electron.mjs", import.meta.url), "utf8");
  assert.match(source, /await createdWindow\.loadURL\(wizard\.url\);\s+if \(!createdWindow\.isDestroyed\(\) && !createdWindow\.isVisible\(\)\) createdWindow\.show\(\);/);
});

test("terminal setup renders descriptors and installs only after preview", async () => {
  const steps = [
    { number: 1, language: "es", title: "Modo de instalación", fields: [{ id: "installMode", type: "select", label: "Modo de instalación", options: [{ value: "custom", label: "Personalizada" }], required: true }], values: { installMode: "custom" } },
    { number: 2, language: "es", title: "Mind", fields: [{ id: "mindPath", type: "text", label: "Ruta", required: true }], values: { mindPath: "C:/mind" } },
    {
      number: 3,
      language: "es",
      title: "Agentes",
      fields: [
        { id: "agents", type: "multiselect", label: "Agentes", options: [{ value: "codex", label: "Codex" }], required: false },
        { id: "attachModes", type: "object", label: "Modo de conexión", options: [{ value: "codex", label: "Codex" }], required: false },
      ],
      values: { agents: ["codex"], attachModes: { codex: "on-demand" } },
    },
    { number: 4, language: "es", title: "Contenido", fields: [], values: {} },
    {
      number: 5,
      language: "es",
      title: "Proyectos",
      groups: [{ id: "g1", folder: "C:/projects", environment: "", projects: [{ index: 0, name: "app", path: "C:/projects/app" }] }],
      fields: [
        { id: "addRoot", type: "text", label: "Agregar carpeta", required: false },
        { id: "removeProject", type: "number", label: "Quitar repositorio", required: false },
        { id: "removeEnvironment", type: "text", label: "Quitar entorno", required: false },
        { id: "projectsConfirmed", type: "boolean", label: "Confirmar proyectos", required: true },
      ],
      values: { addRoot: "", projectsConfirmed: false },
    },
    { number: 6, language: "es", title: "Confirmación", fields: [{ id: "customPreference", type: "textarea", label: "Preferencia", required: false }, { id: "autoUpdates", type: "boolean", label: "Actualizaciones", required: false }], values: { customPreference: "", autoUpdates: true } },
    { number: 7, language: "es", title: "Vista previa", fields: [], values: {} },
    { number: 8, language: "es", title: "Listo", description: "Listo.", fields: [], values: {}, done: true, result: { message: "Listo.", attachPrompts: [{ agent: "otro", text: "Adjuntar" }] } },
  ];
  let index = 0;
  const answers = [];
  let installed = false;
  let intro = "";
  const session = {
    async getStep() { return steps[index]; },
    async answer(values) { answers.push(values); if (steps[index].number !== 7) index += 1; },
    async preview() { return { files: [{ action: "create", path: "C:/mind/user/VERSION" }], warnings: [], conflicts: [] }; },
    async install() { installed = true; index += 1; return { completed: true }; },
  };
  const notes = [];
  const stepLogs = [];
  const prompts = {
    intro(message) { intro = message; },
    outro() {},
    note(message, title) { notes.push({ message, title }); },
    log: { step(message) { stepLogs.push(message); } },
    isCancel() { return false; },
    cancel() {},
    async group(group) {
      const result = {};
      for (const [key, prompt] of Object.entries(group)) result[key] = await prompt({ results: result });
      return result;
    },
    async text(options) { return options.initialValue ?? "value"; },
    async multiline(options) { return options.initialValue ?? "value"; },
    async select(options) { return options.initialValue ?? options.options[0].value; },
    async multiselect(options) { return options.initialValues ?? options.options.map((option) => option.value); },
    async confirm() { return true; },
    spinner() { return { start() {}, stop() {} }; },
  };
  const result = await runTerminalSetup(session, prompts);
  assert.equal(result.completed, true);
  assert.equal(installed, true);
  assert.match(intro, /HIVEM1ND/);
  assert.doesNotMatch(intro, /⬡/);
  assert.ok(stepLogs.includes("Paso 1/8 · Modo de instalación"));
  assert.equal(notes.some((note) => note.message === ""), false);
  assert.deepEqual(answers.at(-1), { confirm: true, conflicts: {} });
  assert.ok(notes.some((note) => note.title === "Vista previa"));
  assert.ok(notes.some((note) => note.title === "otro" && note.message === "Adjuntar"));
});

test("a descriptor field of type number prompts as text and is sent as a number", async () => {
  const steps = [
    { number: 1, language: "en", title: "Count", fields: [{ id: "count", type: "number", label: "Count", required: false }], values: {} },
    { number: 8, language: "en", title: "Done", description: "Done.", fields: [], values: {}, done: true, result: { message: "Done." } },
  ];
  let index = 0;
  const answers = [];
  const session = {
    async getStep() { return steps[index]; },
    async answer(values) { answers.push(values); index += 1; return steps[index]; },
  };
  const prompts = {
    intro() {},
    outro() {},
    note() {},
    log: { step() {} },
    isCancel() { return false; },
    cancel() {},
    async group(group) {
      const result = {};
      for (const [key, prompt] of Object.entries(group)) result[key] = await prompt({ results: result });
      return result;
    },
    async text() { return "3"; },
    spinner() { return { start() {}, stop() {} }; },
  };

  const result = await runTerminalSetup(session, prompts);

  assert.equal(result.message, "Done.");
  assert.equal(answers[0].count, 3);
  assert.equal(typeof answers[0].count, "number");
});

test("terminal setup walks step 5 of a real session: remove a repository, remove an environment, rename one, then confirm", async (context) => {
  const fixture = await makeTerminalProjectsFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));

  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: "TERMINALBOX",
    language: "en",
    env: { PATH: "" },
    resume: false,
  });

  const notes = [];
  let actionStep = 0;
  const actionScript = ["removeProject", "removeEnvironment", "rename", "confirm"];
  const prompts = {
    intro() {},
    outro() {},
    note(message, title) { notes.push({ message, title }); },
    log: { step() {} },
    isCancel() { return false; },
    cancel() {},
    async group(group) {
      const result = {};
      for (const [key, prompt] of Object.entries(group)) result[key] = await prompt({ results: result });
      return result;
    },
    async text(options) {
      if (String(options.message).includes(path.join(fixture.homeDir, "GitHub"))) return "oss";
      return options.initialValue ?? "value";
    },
    async multiline(options) { return options.initialValue ?? ""; },
    async select(options) {
      const values = options.options.map((option) => option.value);
      if (values.includes("confirm") && values.includes("addRoot")) {
        const action = actionScript[actionStep];
        actionStep += 1;
        return action;
      }
      if (values.length > 0 && values.every((value) => typeof value === "number")) {
        return options.options.find((option) => option.label.includes("repo2")).value;
      }
      if (values.some((value) => typeof value === "string" && (value.startsWith("folder:") || value.startsWith("project:")))) {
        return options.options.find((option) => option.label.includes("Unity")).value;
      }
      return options.initialValue ?? options.options[0]?.value;
    },
    async multiselect(options) { return options.initialValues ?? options.options.map((option) => option.value); },
    async confirm() { return true; },
    spinner() { return { start() {}, stop() {} }; },
  };

  const result = await runTerminalSetup(session, prompts);

  assert.equal(actionStep, 4);
  assert.ok(notes.some((note) => typeof note.message === "string" && note.message.includes("repo1")));
  const routes = await readFile(path.join(fixture.mindPath, "user", "routes.md"), "utf8");
  assert.match(routes, /- repo1 \(oss\)/);
  assert.match(routes, /- oss: repo1/);
  assert.doesNotMatch(routes, /repo2/);
  assert.doesNotMatch(routes, /repo3/);
  assert.equal(result.mindPath, fixture.mindPath);
});

async function makeTerminalProjectsFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-terminal-projects-"));
  const homeDir = path.join(root, "home");
  const mindPath = path.join(root, "mind");
  await mkdir(path.join(homeDir, "GitHub", "repo1", ".git"), { recursive: true });
  await mkdir(path.join(homeDir, "GitHub", "repo2", ".git"), { recursive: true });
  await mkdir(path.join(homeDir, "Unity", "repo3", ".git"), { recursive: true });
  await mkdir(mindPath, { recursive: true });
  return { root, homeDir, mindPath };
}

test("swarm output is human-readable and JSON remains opt-in", async () => {
  const result = {
    action: "swarm",
    units: [{ unit: "executor-app", state: "in", machine: "TEST", date: "2026-09-15", context: "Working\nMore", path: "C:/private/state.md" }],
    tasks: { open: 1, done: 0, projects: [{ project: "app", open: 1, done: 0, items: [{ id: "007", slug: "ship", status: "open", path: "C:/private/task.md" }] }] },
    inboxes: { unread: 2, units: [{ unit: "executor-app", count: 2, path: "C:/private/inbox" }] },
  };
  const lifecycle = { async swarm() { return result; } };
  const human = sink();
  assert.equal(await runCli(["swarm", "--mind-path", "."], { stdout: human.stream, stderr: sink().stream, lifecycle }), 0);
  assert.match(human.read(), /^Units\nexecutor-app \| in/);
  assert.match(human.read(), /Tasks\napp \| open 1 \| done 0\n007 ship \| open/);
  assert.match(human.read(), /Inboxes\nexecutor-app \| 2 unread/);
  assert.doesNotMatch(human.read(), /C:\/private/);

  const json = sink();
  assert.equal(await runCli(["swarm", "--mind-path", ".", "--json"], { stdout: json.stream, stderr: sink().stream, lifecycle }), 0);
  assert.deepEqual(JSON.parse(json.read()), result);
});
