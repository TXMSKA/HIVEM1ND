import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWizardServer } from "../gui/server.mjs";

function createStubSession({ failFirstAnswer = false, failInstallAfterCompletion = false, language = "en" } = {}) {
  let number = 1;
  let failed = false;
  const answers = [];
  return {
    answers,
    async getStep() {
      if (number === 8) {
        return { number, language, title: "Done", description: "Done.", fields: [], values: {}, done: true, result: { firstCommand: "/executor <project>" } };
      }
      if (number === 7) return { number, language, title: "Preview", description: "Review writes.", fields: [], values: {}, done: false };
      return {
        number,
        language,
        title: `Step ${number}`,
        description: "Test step",
        fields: [{ id: `value${number}`, type: "text", label: "Value", required: true }],
        values: {},
        done: false,
      };
    },
    async answer(values) {
      if (failFirstAnswer && !failed) {
        failed = true;
        throw new Error("simulated answer failure");
      }
      answers.push(values);
      if (number < 7) number += 1;
    },
    async back() {
      number = Math.max(1, number - 1);
    },
    async preview() {
      return {
        files: [{ path: "/tmp/mind/user/VERSION", action: "create" }],
        warnings: [],
        conflicts: [{ path: "/tmp/mind/rules.md", reason: "Existing file", choices: ["keep", "replace"] }],
      };
    },
    async install() {
      number = 8;
      if (failInstallAfterCompletion) {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      }
      return { completed: true, firstCommand: "/executor <project>" };
    },
  };
}

async function start(options = {}) {
  const session = options.session ?? createStubSession();
  const server = await createWizardServer({ session, token: "a".repeat(43) });
  const headers = {
    Authorization: `Bearer ${server.token}`,
    Origin: server.origin,
  };
  return { server, session, headers };
}

function jsonHeaders(headers) {
  return { ...headers, "Content-Type": "application/json" };
}

test("wizard serves only allow-listed assets with security headers", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const page = await fetch(server.origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(await page.text(), /HIVEM1ND setup/);
  assert.equal((await fetch(`${server.origin}/package.json`)).status, 404);
});

test("wizard uses the compact square theme and keeps long previews bounded", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const [pageResponse, scriptResponse, styleResponse] = await Promise.all([
    fetch(server.origin),
    fetch(`${server.origin}/app.js`),
    fetch(`${server.origin}/styles.css`),
  ]);
  const [page, script, styles] = await Promise.all([pageResponse.text(), scriptResponse.text(), styleResponse.text()]);
  const texts = await readFile(new URL("../engine/texts.mjs", import.meta.url), "utf8");
  assert.match(texts, /reasonUnownedFile: 'Ya existe un archivo ajeno a HIVEM1ND/);
  assert.doesNotMatch(script, /Ya existe un archivo ajeno a HIVEM1ND/);
  assert.match(texts, /actionUnchanged: 'sin cambios'/);
  assert.match(script, /formatCount\(c\.filesCountOne, files\.length\)/);
  assert.match(script, /sessionStorage\.setItem\("hivem1nd\.session", tokenFromHash\)/);
  assert.match(script, /tokenFromHash \?\? sessionStorage\.getItem\("hivem1nd\.session"\)/);
  assert.match(script, /field\.label\?\.trim\(\) === currentStep\?\.title\?\.trim\(\)/);
  assert.match(styles, /\.preview-files\s*\{[^}]*max-height:\s*min\(34vh, 260px\)/s);
  assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none !important/s);
  assert.match(styles, /grid-template-columns:\s*232px minmax\(0, 1fr\)/);
  assert.match(styles, /--surface:\s*#18121d/);
  assert.match(styles, /--purple-strong:\s*#81648c/);
  assert.match(styles, /--acid:\s*#bdcd79/);
  assert.match(styles, /#step-title:focus\s*\{[^}]*outline:\s*none/s);
  assert.match(styles, /\.fields:empty\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /input\[type="radio"\][^{]*\{[^}]*appearance:\s*none/s);
  assert.doesNotMatch(styles, /border-radius|gradient|clip-path/);
  assert.doesNotMatch(page, /brand-tagline|privacy-note|connection-label|language-switch|step-number|class="signal"/);
});

test("API accepts token-authenticated same-origin GET without Origin", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const response = await fetch(`${server.origin}/api/v1/step`, {
    headers: { Authorization: `Bearer ${server.token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.number, 1);
});

test("API rejects bad origin, absent mutation origin and bad token", async (context) => {
  const { server, headers } = await start();
  context.after(() => server.close());
  const badOrigin = await fetch(`${server.origin}/api/v1/step`, {
    headers: { ...headers, Origin: "http://example.test" },
  });
  assert.equal(badOrigin.status, 403);
  assert.equal((await badOrigin.json()).error.code, "invalid_origin");

  const noMutationOrigin = await fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: { value1: "ok" } }),
  });
  assert.equal(noMutationOrigin.status, 403);

  const badToken = await fetch(`${server.origin}/api/v1/step`, {
    headers: { ...headers, Authorization: "Bearer wrong" },
  });
  assert.equal(badToken.status, 401);
  assert.equal((await badToken.json()).error.code, "invalid_session");
});

test("server rejects a mismatched Host header", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const status = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: server.host,
      port: server.port,
      path: "/api/v1/step",
      headers: { Host: `localhost:${server.port}`, Authorization: `Bearer ${server.token}` },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(status, 400);
});

test("API rejects unknown fields, invalid JSON and oversized bodies", async (context) => {
  const { server, headers } = await start();
  context.after(() => server.close());

  const unknown = await fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ values: { invented: true } }),
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, "unknown_field");

  const invalid = await fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: "{",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_json");

  const oversized = await fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ values: { value1: "x".repeat(70_000) } }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "body_too_large");
});

test("failed mutations do not poison the serialized operation queue", async (context) => {
  const session = createStubSession({ failFirstAnswer: true });
  const { server, headers } = await start({ session });
  context.after(() => server.close());
  const request = () => fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ values: { value1: "ok" } }),
  });
  assert.equal((await request()).status, 500);
  assert.equal((await request()).status, 200);
  assert.equal(session.answers.length, 1);
});

test("concurrent answers validate against the step inside the queue", async (context) => {
  const { server, headers } = await start();
  context.after(() => server.close());
  const request = () => fetch(`${server.origin}/api/v1/answer`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ values: { value1: "ok" } }),
  });
  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
});

test("HTTP wizard flow reaches preview, resolves conflicts and installs", async (context) => {
  const { server, session, headers } = await start();
  context.after(() => server.close());
  for (let number = 1; number <= 6; number += 1) {
    const response = await fetch(`${server.origin}/api/v1/answer`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ values: { [`value${number}`]: `answer ${number}` } }),
    });
    assert.equal(response.status, 200, `step ${number}`);
  }
  const preview = await fetch(`${server.origin}/api/v1/preview`, { headers });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).data.conflicts.length, 1);

  const unresolved = await fetch(`${server.origin}/api/v1/install`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ confirm: true, conflicts: {} }),
  });
  assert.equal(unresolved.status, 400);

  const install = await fetch(`${server.origin}/api/v1/install`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ confirm: true, conflicts: { "/tmp/mind/rules.md": "keep" } }),
  });
  assert.equal(install.status, 200);
  assert.equal((await install.json()).data.completed, true);
  assert.equal((await (await fetch(`${server.origin}/api/v1/step`, { headers })).json()).data.number, 8);
  assert.deepEqual(session.answers.at(-1), { confirm: true, conflicts: { "/tmp/mind/rules.md": "keep" } });
});

test("an install that fails after completing the write still lands on Done and reports a localized error", async (context) => {
  const session = createStubSession({ language: "es", failInstallAfterCompletion: true });
  const { server, headers } = await start({ session });
  context.after(() => server.close());
  for (let number = 1; number <= 6; number += 1) {
    await fetch(`${server.origin}/api/v1/answer`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ values: { [`value${number}`]: `answer ${number}` } }),
    });
  }

  const install = await fetch(`${server.origin}/api/v1/install`, {
    method: "POST",
    headers: jsonHeaders(headers),
    body: JSON.stringify({ confirm: true, conflicts: { "/tmp/mind/rules.md": "keep" } }),
  });
  assert.equal(install.status, 500);
  const body = await install.json();
  assert.equal(body.error.code, "ENOENT");
  assert.match(body.error.message, /no pudo completar la solicitud/);
  assert.doesNotMatch(body.error.message, /The local wizard could not complete the request/);

  const step = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(step.data.number, 8);
  assert.equal(step.data.done, true);
});

test("a malformed request that never reaches the router still gets a JSON error with a status", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const responseText = await new Promise((resolve, reject) => {
    const socket = net.connect(server.port, server.host, () => {
      socket.write("BAD REQUEST LINE THAT IS NOT VALID HTTP/1.1\r\n\r\n");
    });
    let raw = "";
    socket.on("data", (chunk) => { raw += chunk.toString("utf8"); });
    socket.on("end", () => resolve(raw));
    socket.on("error", reject);
  });
  const [statusLine, ...rest] = responseText.split("\r\n\r\n");
  assert.match(statusLine, /^HTTP\/1\.1 400/);
  const body = JSON.parse(rest.join("\r\n\r\n"));
  assert.equal(typeof body.error.message, "string");
  assert.ok(body.error.message.length > 0);
});

test("the real engine reports conflict reasons localized to the session language", async (context) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-conflict-reason-"));
  const homeDir = path.join(scratch, "home");
  const mindPath = path.join(scratch, "mind");
  await mkdir(homeDir, { recursive: true });
  await mkdir(mindPath, { recursive: true });
  await writeFile(path.join(mindPath, "rules.md"), "an unrelated file the mind does not own\n");
  context.after(() => rm(scratch, { recursive: true, force: true }));

  const kitPath = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const server = await createWizardServer({
    sessionOptions: { kitPath, mindPath, homeDir, hostname: "INTERFACE-TEST", language: "es", env: {} },
    token: "e".repeat(43),
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const answer = async (values) => {
    const response = await fetch(`${server.origin}/api/v1/answer`, { method: "POST", headers, body: JSON.stringify({ values }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };

  await answer({ installMode: "custom" });
  await answer({ mindPath });
  await answer({ scan: true });
  await answer({});
  await answer({ included: [] });
  await answer({ projectsConfirmed: true });
  await answer({ skipPreferences: true, addressStyle: "impersonal", customPreference: "", autoUpdates: false });

  const preview = await (await fetch(`${server.origin}/api/v1/preview`, { headers })).json();
  const conflict = preview.data.conflicts.find((item) => item.path === path.join(mindPath, "rules.md"));
  assert.equal(conflict.reason, "Ya existe un archivo ajeno a HIVEM1ND en esta ruta.");
});

test("browser API completes the real setup engine inside an isolated home", async (context) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-browser-engine-"));
  const homeDir = path.join(scratch, "home");
  const mindPath = path.join(scratch, "mind");
  const projectRoot = path.join(scratch, "projects");
  await Promise.all([mkdir(homeDir), mkdir(projectRoot)]);
  context.after(() => rm(scratch, { recursive: true, force: true }));

  const kitPath = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const server = await createWizardServer({
    sessionOptions: { kitPath, mindPath, homeDir, hostname: "INTERFACE-TEST", language: "en", env: {} },
    token: "b".repeat(43),
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const answer = async (values) => {
    const response = await fetch(`${server.origin}/api/v1/answer`, {
      method: "POST",
      headers,
      body: JSON.stringify({ values }),
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };

  await answer({ installMode: "custom" });
  await answer({ mindPath });
  await answer({ scan: true });
  await answer({});
  await answer({ included: [] });
  await answer({ addRoot: projectRoot });
  await answer({ projectsConfirmed: true });
  await answer({ skipPreferences: true, addressStyle: "impersonal", customPreference: "", autoUpdates: false });

  const stepSeven = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(stepSeven.data.number, 7);
  assert.equal(stepSeven.data.ui.back, "Back");
  assert.equal(stepSeven.data.ui.actionUnchanged, "unchanged");
  const preview = await (await fetch(`${server.origin}/api/v1/preview`, { headers })).json();
  assert.ok(preview.data.files.length > 0);
  assert.deepEqual(preview.data.conflicts, []);
  assert.equal(preview.data.ui, undefined);

  const languageChanged = await fetch(`${server.origin}/api/v1/language`, {
    method: "POST",
    headers,
    body: JSON.stringify({ language: "es" }),
  });
  assert.equal(languageChanged.status, 200, JSON.stringify(await languageChanged.json()));
  const afterLanguage = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(afterLanguage.data.number, 7);
  assert.equal(afterLanguage.data.language, "es");
  assert.equal(afterLanguage.data.ui.back, "Atrás");
  assert.equal(afterLanguage.data.ui.actionUnchanged, "sin cambios");
  await fetch(`${server.origin}/api/v1/language`, { method: "POST", headers, body: JSON.stringify({ language: "en" }) });

  const installed = await fetch(`${server.origin}/api/v1/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: true, conflicts: {} }),
  });
  assert.equal(installed.status, 200, JSON.stringify(await installed.json()));
  const done = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(done.data.number, 8);
  assert.equal(done.data.done, true);
  const kitVersion = JSON.parse(await readFile(path.join(kitPath, "package.json"), "utf8")).version;
  assert.equal(await readFile(path.join(mindPath, "user", "VERSION"), "utf8"), `${kitVersion}\n`);
});

test("removing a repository or an environment over HTTP drops it before install", async (context) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-browser-remove-"));
  const homeDir = path.join(scratch, "home");
  const mindPath = path.join(scratch, "mind");
  await mkdir(path.join(homeDir, "GitHub", "repo1", ".git"), { recursive: true });
  await mkdir(path.join(homeDir, "GitHub", "repo2", ".git"), { recursive: true });
  await mkdir(path.join(homeDir, "Unity", "repo3", ".git"), { recursive: true });
  context.after(() => rm(scratch, { recursive: true, force: true }));

  const kitPath = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const server = await createWizardServer({
    sessionOptions: { kitPath, mindPath, homeDir, hostname: "INTERFACE-TEST", language: "en", env: {} },
    token: "c".repeat(43),
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const answer = async (values) => {
    const response = await fetch(`${server.origin}/api/v1/answer`, { method: "POST", headers, body: JSON.stringify({ values }) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.data;
  };

  await answer({ installMode: "custom" });
  await answer({ mindPath });
  await answer({ scan: true });
  await answer({});
  await answer({ included: [] });
  const projectsStep = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(projectsStep.data.groups.length, 2);
  const gitHubGroup = projectsStep.data.groups.find((group) => group.folder === path.join(homeDir, "GitHub"));
  const unityGroup = projectsStep.data.groups.find((group) => group.folder === path.join(homeDir, "Unity"));
  const repo2 = gitHubGroup.projects.find((project) => project.name === "repo2");

  const afterRemoveProject = await answer({ removeProject: repo2.index });
  assert.deepEqual(
    afterRemoveProject.groups.find((group) => group.folder === path.join(homeDir, "GitHub")).projects.map((project) => project.name),
    ["repo1"],
  );

  const afterRemoveEnvironment = await answer({ removeEnvironment: unityGroup.id });
  assert.ok(!afterRemoveEnvironment.groups.some((group) => group.folder === path.join(homeDir, "Unity")));

  await answer({ projectsConfirmed: true });
  await answer({ skipPreferences: true, addressStyle: "impersonal", customPreference: "", autoUpdates: false });
  await fetch(`${server.origin}/api/v1/install`, { method: "POST", headers, body: JSON.stringify({ confirm: true, conflicts: {} }) });

  const routes = await readFile(path.join(mindPath, "user", "routes.md"), "utf8");
  assert.match(routes, /- repo1/);
  assert.doesNotMatch(routes, /repo2/);
  assert.doesNotMatch(routes, /repo3/);
});

test("the projects step UI gates adding a root behind the native folder bridge and gives icon buttons aria-labels", async (context) => {
  const { server } = await start();
  context.after(() => server.close());
  const script = await (await fetch(`${server.origin}/app.js`)).text();
  assert.match(script, /addRootField && hasBrowseBridge\(\)/);
  assert.match(script, /window\.hivem1nd\.browseFolder\(\)/);
  assert.match(script, /submitAnswer\(\{ removeEnvironment: group\.id \}\)/);
  assert.match(script, /submitAnswer\(\{ removeProject: project\.index \}\)/);
  assert.match(script, /toggle\.setAttribute\("aria-expanded"/);
  assert.match(script, /removeGroupButton\.setAttribute\("aria-label", removeEnvironmentLabel\)/);
  assert.match(script, /removeButton\.setAttribute\("aria-label", label\)/);
});

test("the agents step advances when no agent is detected", async (context) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-browser-no-agents-"));
  const mindPath = path.join(scratch, "mind");
  await mkdir(path.join(scratch, "home"));
  context.after(() => rm(scratch, { recursive: true, force: true }));

  const kitPath = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const server = await createWizardServer({
    sessionOptions: { kitPath, mindPath, homeDir: path.join(scratch, "home"), hostname: "INTERFACE-TEST", language: "en", env: {} },
    token: "d".repeat(43),
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const post = (values) => fetch(`${server.origin}/api/v1/answer`, { method: "POST", headers, body: JSON.stringify({ values }) });

  await post({ installMode: "custom" });
  await post({ mindPath });
  const scanned = (await (await post({ scan: true })).json()).data;
  assert.equal(scanned.agents.length, 0);
  assert.equal((await post({ agents: [], attachModes: {} })).status, 400);
  const advanced = await post({});
  assert.equal(advanced.status, 200);
  assert.equal((await advanced.json()).data.number, 4);

  const script = await (await fetch(`${server.origin}/app.js`)).text();
  assert.match(script, /if \(!currentStep\.scanned \|\| !currentStep\.agents\?\.length\) return \{\};/);
});
