import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { legacyTreeInventory } from "../engine/legacy-copy.mjs";
import { stubAclRunner } from "../engine/service/security.mjs";
import { createWizardServer } from "../gui/server.mjs";

function createStubSession({ failFirstAnswer = false, failInstallAfterCompletion = false, language = "en" } = {}) {
  let number = 1;
  let failed = false;
  const answers = [];
  return {
    answers,
    async getStep() {
      if (number === 4) {
        return { id:"ready", total:4, back:false, number, language, title: "Done", description: "Done.", fields: [], values: {}, done: true, result: { firstCommand: "/executor <project>" } };
      }
      if (number === 3) return { id:"service", total:4, back:false, number, language, title: "Preview", description: "Review writes.", fields: [], values: {}, done: false };
      return {
        id: number === 1 ? "install" : "location", total:4, back:number === 2,
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
      if (number < 3) number += 1;
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
      number = 4;
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

test("wizard serves the four-step board layout with authenticated assets",async context=>{
 const {server}=await start();context.after(()=>server.close());const script=await(await fetch(server.origin+'/app.js')).text();const styles=await(await fetch(server.origin+'/styles.css')).text();assert.match(script,/sessionStorage/);assert.match(script,/renderLocation/);assert.match(script,/renderService/);assert.match(script,/renderReady/);assert.doesNotMatch(script,/renderAgents|renderProjects|originKind|installMode/);assert.match(styles,/width:\s*640px/);assert.match(styles,/border-radius:\s*24px/);assert.match(styles,/--accent:\s*#bdcd79/);assert.match(styles,/\[hidden\]/);assert.match(styles,/@media/);
});

test("wizard serves only the four local Atkinson faces with a same-origin font policy", async context => {
  const { server } = await start();
  context.after(() => server.close());
  const faces = ["atkinson-400.woff2", "atkinson-400-italic.woff2", "atkinson-700.woff2", "atkinson-700-italic.woff2"];
  for (const name of faces) {
    const response = await fetch(`${server.origin}/${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "font/woff2");
    assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
    assert.deepEqual(bytes, await readFile(new URL(`../docs/flows/assets/${name}`, import.meta.url)));
    const head = await fetch(`${server.origin}/${name}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "font/woff2");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  for (const name of ["atkinson-500.woff2", "other.woff2", "app/atkinson-400.woff2", "OFL-atkinson.txt"]) {
    assert.equal((await fetch(`${server.origin}/${name}`)).status, 404);
  }
  const css = await (await fetch(`${server.origin}/styles.css`)).text();
  assert.equal([...css.matchAll(/@font-face\s*\{/g)].length, 4);
  assert.match(css, /--font:\s*"Atkinson Hyperlegible", system-ui, sans-serif/);
  for (const name of faces) assert.ok(css.includes(`url("./${name}")`));
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
  for (let number = 1; number <= 2; number += 1) {
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
  assert.equal((await (await fetch(`${server.origin}/api/v1/step`, { headers })).json()).data.number, 4);
  assert.deepEqual(session.answers.at(-1), { confirm: true, conflicts: { "/tmp/mind/rules.md": "keep" } });
});

test("an install that fails after completing the write still lands on Done and reports a localized error", async (context) => {
  const session = createStubSession({ language: "es", failInstallAfterCompletion: true });
  const { server, headers } = await start({ session });
  context.after(() => server.close());
  for (let number = 1; number <= 2; number += 1) {
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
  assert.equal(step.data.number, 4);
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
    sessionOptions: { kitPath, mindPath, homeDir, hostname: "INTERFACE-TEST", language: "es", env: {}, aclRunner: stubAclRunner() },
    token: "e".repeat(43),
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const answer = async (values) => {
    const response = await fetch(`${server.origin}/api/v1/answer`, { method: "POST", headers, body: JSON.stringify({ values }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };

  await answer({});
  await answer({ mindPath });

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
    sessionOptions: { kitPath, mindPath, homeDir, hostname: "INTERFACE-TEST", language: "en", env: {}, aclRunner: stubAclRunner() },
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

  await answer({});
  await answer({ mindPath });

  const stepSeven = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(stepSeven.data.number, 3);
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
  assert.equal(afterLanguage.data.number, 3);
  assert.equal(afterLanguage.data.language, "es");
  assert.equal(afterLanguage.data.ui.back, "Volver");
  assert.equal(afterLanguage.data.ui.actionUnchanged, "sin cambios");
  await fetch(`${server.origin}/api/v1/language`, { method: "POST", headers, body: JSON.stringify({ language: "en" }) });

  const installed = await fetch(`${server.origin}/api/v1/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: true, conflicts: {} }),
  });
  assert.equal(installed.status, 200, JSON.stringify(await installed.json()));
  const done = await (await fetch(`${server.origin}/api/v1/step`, { headers })).json();
  assert.equal(done.data.number, 4);
  assert.equal(done.data.done, true);
  const kitVersion = JSON.parse(await readFile(path.join(kitPath, "package.json"), "utf8")).version;
  assert.equal(await readFile(path.join(mindPath, "user", "VERSION"), "utf8"), `${kitVersion}\n`);
});

test("setup detects accurate repository and folder counts without editing projects", async (context) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "hivem1nd-setup-counts-"));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const homeDir = path.join(scratch, "home");
  const mindPath = path.join(scratch, "mind");
  const directories = ["GitHub/repo1", "GitHub/repo2", "Unity/repo3"].map((name) => path.join(homeDir, name));
  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], {
      cwd: directory, shell: false, windowsHide: true, timeout: 30000, stdio: "ignore",
    });
    await writeFile(path.join(directory, "source.txt"), "Unchanged project bytes.\n");
  }
  const before = await Promise.all(directories.map(legacyTreeInventory));
  const server = await createWizardServer({
    sessionOptions: {
      kitPath: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
      mindPath, homeDir, hostname: "INTERFACE-TEST", language: "en", env: {}, aclRunner: stubAclRunner(),
    },
  });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const post = (values) => fetch(`${server.origin}/api/v1/answer`, {
    method: "POST", headers, body: JSON.stringify({ values }),
  });
  assert.equal((await post({})).status, 200);
  assert.equal((await post({ mindPath })).status, 200);
  assert.equal((await post({ removeProject: 0 })).status, 400);
  assert.equal((await fetch(`${server.origin}/api/v1/install`, {
    method: "POST", headers, body: JSON.stringify({ confirm: true, conflicts: {} }),
  })).status, 200);
  const step = (await (await fetch(`${server.origin}/api/v1/step`, { headers })).json()).data;
  const projects = step.summary.find((row) => row.id === "projects");
  assert.equal(projects.repositories, 3);
  assert.equal(projects.folders, 2);
  assert.equal(projects.value, "3 repositories in 2 folders");
  assert.deepEqual(await Promise.all(directories.map(legacyTreeInventory)), before);
});

test("Folder Browse uses the native bridge, then the local server, with an editable path",async context=>{
 const {server}=await start();context.after(()=>server.close());const script=await(await fetch(server.origin+'/app.js')).text();assert.match(script,/window\.hivem1nd\.browseFolder/);assert.match(script,/changeFolder: true/);assert.doesNotMatch(script,/removeEnvironment|removeProject|addRoot/);
});

test("setup reaches service with no detected agents and rejects removed controls",async context=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'hivem1nd-no-agents-'));context.after(()=>rm(root,{recursive:true,force:true}));const homeDir=path.join(root,'home'),mindPath=path.join(root,'mind');await mkdir(homeDir);const server=await createWizardServer({sessionOptions:{kitPath:path.dirname(path.dirname(fileURLToPath(import.meta.url))),mindPath,homeDir,hostname:'INTERFACE-TEST',language:'en',env:{},aclRunner:stubAclRunner()}});context.after(()=>server.close());const headers={Authorization:'Bearer '+server.token,Origin:server.origin,'Content-Type':'application/json'};const post=values=>fetch(server.origin+'/api/v1/answer',{method:'POST',headers,body:JSON.stringify({values})});for(const key of ['installMode','sync','originKind'])assert.equal((await post({[key]:'custom'})).status,400);await post({});assert.equal((await post({changeFolder:'yes'})).status,400);const service=await post({mindPath});assert.equal(service.status,200);assert.equal((await service.json()).data.id,'service');assert.equal((await post({scan:true})).status,400);assert.equal((await fetch(server.origin+'/api/v1/back',{method:'POST',headers,body:'{}'})).status,409);
});

test("Browse asks the local server for a native folder and treats a cancel as no folder", async (context) => {
  const asked = [];
  const answers = ["/tmp/chosen", null];
  const server = await createWizardServer({ session: createStubSession(), token: "a".repeat(43), browseFolder: async (options) => { asked.push(options); return answers.shift(); } });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const post = (body = "{}", extra = {}) => fetch(`${server.origin}/api/v1/browse`, { method: "POST", headers: { ...headers, ...extra }, body });
  assert.deepEqual((await (await post()).json()).data, { path: "/tmp/chosen" });
  assert.deepEqual((await (await post()).json()).data, { path: null });
  assert.deepEqual(asked, [{ title: "Choose the folder for the M1ND" }, { title: "Choose the folder for the M1ND" }]);
  assert.equal((await post("{}", { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await post('{"path":"/x"}')).status, 400);
  assert.equal(asked.length, 2, "a rejected request never opens a dialog");
  const script = await (await fetch(`${server.origin}/app.js`)).text();
  assert.match(script, /api\('browse'/);
  const step = await (await fetch(`${server.origin}/api/v1/step`, { headers: { Authorization: headers.Authorization } })).json();
  assert.equal(step.data.ui.browse, "Browse");
  assert.equal(Object.hasOwn(step.data.ui, "change"), false);
});

test("Browse names the missing picker in the session language and opens one dialog at a time", async (context) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let mode = "missing";
  const session = createStubSession({ language: "es" });
  const server = await createWizardServer({ session, token: "a".repeat(43), browseFolder: async () => {
    if (mode === "missing") throw Object.assign(new Error("none"), { code: "browse_unavailable" });
    await held;
    return "/tmp/late";
  } });
  context.after(() => server.close());
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, "Content-Type": "application/json" };
  const post = () => fetch(`${server.origin}/api/v1/browse`, { method: "POST", headers, body: "{}" });
  const missing = await post();
  assert.equal(missing.status, 501);
  assert.deepEqual((await missing.json()).error.message, "El selector de carpetas no está disponible aquí. Escribir la ruta de la carpeta.");
  mode = "open";
  const first = post();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await post();
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.message, "Ya hay un selector de carpetas abierto.");
  release();
  assert.deepEqual((await (await first).json()).data, { path: "/tmp/late" });
});
