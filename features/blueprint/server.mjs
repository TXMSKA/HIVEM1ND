// Blueprint Lite: the local server behind /blueprint.
//
// One server per machine serves the boards of every project at once. It finds
// the projects in the mind (the Paths section of this machine's record and the
// Projects section of routes.md), lists the ones whose repository holds
// docs/flows/boards/index.json, serves the Review viewer and the shared kit,
// and keeps the comments made on a board in that repository's
// docs/flows/comments/<board>.json. That file is the whole point of having a
// server: a comment has to land somewhere an agent can read it, and a static
// page cannot write to disk.
//
// Node built-ins only, bound to 127.0.0.1, and the comments are changed by
// small operations rather than by overwriting the file, so a reply written by
// hand into the JSON while the page is open is not lost on the next click.
//
// Two more things are written for the person: the sketches drawn on a board
// (docs/flows/sketches/<board>.json, with the pictures in docs/flows/assets/),
// and the messages a comment can send to the agent of its project, through the
// kit's own Relay (engine/relay/person.mjs).
//
// Run: node server.mjs [--mind <path>] [--hostname <name>] [--port <number>] [--lan]
// then open http://localhost:3300/, or from a phone on the same network the
// link with a key that --lan prints.

import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, hostname as machineName, networkInterfaces } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersonRelay } from "../../engine/relay/person.mjs";
import { MAX_IMAGE_BYTES, MAX_SKETCH_BYTES, SketchError, newSketch, validateSketch } from "./review/sketch-format.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW = join(HERE, "review");
const KIT = join(HERE, "kit");
// The files the shared kit provides. A repository's own copy of one of them,
// in docs/flows/kit/, is used in its place (that is how a repository brings
// its theme); the shared file answers only where the repository has none.
const SHARED_KIT = new Set(["kit.mjs", "board.mjs", "icons.mjs", "ui.mjs", "skins.mjs"]);
// What a repository serves to its boards, under docs/flows/.
const AREAS = new Set(["boards", "kit", "assets"]);
// Where a repository keeps a font its own review page names as /fonts/<file>:
// beside its boards, or where its site keeps fonts (public/ or the app folder).
const FONT_HOMES = [["docs", "flows", "fonts"], ["public", "fonts"], ["src", "app", "fonts"], ["app", "fonts"]];

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3300;

const BOARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const THREAD_ID = /^t-[a-z0-9]+-[a-f0-9]{6}$/;
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 4000;
const MAX_LABEL = 160;
// The author Review writes on what is typed in the viewer.
const REVIEWER = "User";
// What a thread opened by a reference image says when the person wrote no note.
const REFERENCE_NOTE = "Recreate this reference image as a screen of the board.";
// The pictures a sketch may hold, by what the first bytes say they are. The
// type the browser declares must agree, so a file is never served as
// something it is not.
const PICTURES = [
  { type: "image/png", ext: "png", is: (bytes) => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", ext: "jpg", is: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: "image/webp", ext: "webp", is: (bytes) => bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP" },
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// ---- options -------------------------------------------------------------

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 ? process.argv[at + 1] : undefined;
}

// The mind is found the way the kit's command line finds it: the path given,
// else the current folder when it is a mind, else HIVEM1ND in the home folder.
function mindPath() {
  const given = option("mind");
  if (given) return resolve(given);
  if (existsSync(join(process.cwd(), "user", "VERSION"))) return process.cwd();
  return join(homedir(), "HIVEM1ND");
}

const MIND = mindPath();
const HOSTNAME = option("hostname") ?? machineName();
const PORT = Number(option("port")) || DEFAULT_PORT;

// The server's own names. A page on another site can still reach 127.0.0.1,
// straight or through a name it points here (DNS rebinding); the browser says
// where such a request comes from, and only these may read or change anything.
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

// With --lan the server also answers on this machine's home network addresses,
// for a phone on the same Wi-Fi. Anyone on that network can reach them, so each
// of those requests needs the key printed at start: once in the link, then as a
// cookie. The key changes on every start.
const LAN = process.argv.includes("--lan");
const LAN_KEY = LAN ? randomBytes(18).toString("base64url") : "";
const LAN_HOSTS = LAN
  ? Object.values(networkInterfaces())
      .flat()
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => `${address.address}:${PORT}`)
  : [];
const HOSTS = new Set([...LOCAL_HOSTS, ...LAN_HOSTS]);
const ORIGINS = new Set([...HOSTS].map((host) => `http://${host}`));
const KEY_COOKIE = "blueprint-key";

// The one outside host a repository's fonts may come from, when its own review
// page already names it.
const FONT_STYLES = "https://fonts.googleapis.com/";
const FONT_FILES = "https://fonts.gstatic.com";

// The page runs its own scripts and styles and the fonts it names, nothing
// else, and no other page may frame it. `scripts` adds the hashes of inline
// scripts the server itself wrote, such as the import map; `outside` opens
// the Google Fonts hosts for a repository that loads its fonts from there.
function policy(scripts = [], outside = false) {
  return [
    "default-src 'self'",
    `script-src 'self'${scripts.map((hash) => ` 'sha256-${hash}'`).join("")}`,
    `style-src 'self'${outside ? ` ${FONT_STYLES.slice(0, -1)}` : ""}`,
    `font-src 'self'${outside ? ` ${FONT_FILES}` : ""}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// ---- projects ------------------------------------------------------------

function section(text, title) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (start === -1) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) items.push(item[1]);
  }
  return items;
}

async function machineRecord() {
  const folder = join(MIND, "user", "machines");
  const wanted = `${HOSTNAME}.md`.toLowerCase();
  const entries = await readdir(folder).catch(() => []);
  const match = entries.find((name) => name.toLowerCase() === wanted);
  if (!match) throw new Error(`No machine record for ${HOSTNAME} in ${folder}. Pass --mind and --hostname.`);
  return readFile(join(folder, match), "utf8");
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/**
 * The projects of this machine that draw boards: the ones named in routes.md
 * that have a path in the machine record, and whose repository holds
 * docs/flows/boards/index.json. Read on every request, so a repository that
 * gains its first board shows up on the next reload, with nothing to register.
 */
async function discover() {
  const paths = new Map();
  for (const item of section(await machineRecord(), "Paths")) {
    const at = item.indexOf(":");
    if (at > 0) paths.set(item.slice(0, at).trim(), item.slice(at + 1).trim());
  }
  const routes = await readFile(join(MIND, "user", "routes.md"), "utf8").catch(() => "");
  const found = new Map();
  for (const item of section(routes, "Projects")) {
    const name = item.replace(/\s*\(.*\)\s*$/, "").trim();
    const root = paths.get(name);
    if (!name || !root) continue;
    const flows = join(root, "docs", "flows");
    if (await isFile(join(flows, "boards", "index.json"))) found.set(name, { name, root, flows });
  }
  return found;
}

const label = (value, limit) => (typeof value === "string" && value.length <= limit ? value : undefined);

/** Every board of every project, the way Review lists them. */
async function boardIndex(projects) {
  const all = [];
  for (const project of projects.values()) {
    let entries;
    try {
      entries = JSON.parse(await readFile(join(project.flows, "boards", "index.json"), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    // A repository's own icons and node types on top of the shared kit: docs/flows/kit/extra-icons.mjs and extra-nodes.mjs.
    const extra = async (file) => ((await isFile(join(project.flows, "kit", file))) ? `/p/${encodeURIComponent(project.name)}/kit/${file}` : undefined);
    const icons = await extra("extra-icons.mjs");
    const nodes = await extra("extra-nodes.mjs");
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || !BOARD_ID.test(entry.id)) continue;
      all.push({
        project: project.name,
        id: entry.id,
        letter: label(entry.letter, 4),
        short: label(entry.short, MAX_LABEL),
        title: label(entry.title, MAX_LABEL) ?? entry.id,
        url: `/p/${encodeURIComponent(project.name)}/boards/${entry.id}.mjs`,
        kit: `/p/${encodeURIComponent(project.name)}/kit/`,
        icons,
        nodes,
      });
    }
  }
  return all;
}

// ---- comments ------------------------------------------------------------

function emptyDoc(board) {
  return { board, threads: [] };
}

const commentsFile = (project, board) => join(project.flows, "comments", `${board}.json`);

async function readDoc(project, board) {
  try {
    const doc = JSON.parse(await readFile(commentsFile(project, board), "utf8"));
    if (!doc || !Array.isArray(doc.threads)) return emptyDoc(board);
    return doc;
  } catch {
    return emptyDoc(board);
  }
}

// Through a temporary file and a rename, so a reader never meets half a file.
async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}

const writeDoc = (project, board, doc) => writeAtomic(commentsFile(project, board), `${JSON.stringify(doc, null, 2)}\n`);

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text && text.length <= MAX_TEXT ? text : null;
}

function cleanLabel(value) {
  return typeof value === "string" && value.length <= MAX_LABEL ? value : null;
}

/**
 * What a comment is attached to. A screen and an element inside it, or a
 * screen alone, or nothing but a point on the empty board. Every field is
 * checked against the shape the Review app writes, so the file never carries
 * something an agent would have to second-guess.
 */
function cleanAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  const { screen, element, label: name, path, point, screenTitle } = anchor;
  if (screen !== null && !(typeof screen === "string" && NAME.test(screen))) return null;
  if (element !== null && !(typeof element === "string" && NAME.test(element))) return null;
  if (element !== null && screen === null) return null;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const crumbs = Array.isArray(path) ? path : [];
  if (crumbs.length > 10 || !crumbs.every((c) => cleanLabel(c) !== null)) return null;
  return {
    screen,
    screenTitle: screen === null ? null : cleanLabel(screenTitle) ?? screen,
    element,
    label: cleanLabel(name) ?? element ?? screen ?? "Board",
    path: crumbs,
    point: { x: Math.round(x), y: Math.round(y) },
  };
}

function threadId() {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

/** One operation from the Review app, applied to the file as it is now. */
function apply(doc, op) {
  const find = () => doc.threads.find((t) => t.id === op.thread);

  switch (op?.op) {
    case "add": {
      const anchor = cleanAnchor(op.anchor);
      const text = cleanText(op.text);
      const layer = "design";
      if (!anchor || !text) return "The comment needs a place and some text.";
      doc.threads.push({
        id: threadId(),
        anchor,
        layer,
        status: "open",
        messages: [{ author: REVIEWER, at: now(), text }],
      });
      return null;
    }
    case "reply": {
      if (typeof op.thread !== "string" || !THREAD_ID.test(op.thread)) return "Unknown thread.";
      const thread = find();
      const text = cleanText(op.text);
      if (!thread || !text) return "Unknown thread, or an empty reply.";
      thread.messages.push({ author: REVIEWER, at: now(), text });
      if (thread.status === "resolved") thread.status = "open";
      return null;
    }
    case "status": {
      const thread = find();
      if (!thread || (op.status !== "open" && op.status !== "resolved")) return "Unknown thread.";
      thread.status = op.status;
      return null;
    }
    case "remove": {
      const before = doc.threads.length;
      doc.threads = doc.threads.filter((t) => t.id !== op.thread);
      return doc.threads.length === before ? "Unknown thread." : null;
    }
    default:
      return "Unknown operation.";
  }
}

// One write at a time per board, so two quick clicks cannot interleave.
const queues = new Map();
function serial(key, task) {
  const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, next.catch(() => {}));
  return next;
}

// ---- http ----------------------------------------------------------------

function send(res, status, body, type = "application/json; charset=utf-8", csp = policy()) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
    "X-Frame-Options": "DENY",
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const notFound = (res) => send(res, 404, "Not found.", "text/plain; charset=utf-8");

const sameKey = (given) => Boolean(given) && given.length === LAN_KEY.length && timingSafeEqual(Buffer.from(given), Buffer.from(LAN_KEY));

// A request from the home network passes with the key. The link's key becomes a
// cookie and the address loses it, so it stays out of the history and of what
// the page shares.
function lanPass(req, res) {
  const url = new URL(req.url ?? "/", "http://lan");
  if (sameKey(url.searchParams.get("key"))) {
    url.searchParams.delete("key");
    res.writeHead(303, {
      Location: url.pathname + url.search,
      "Set-Cookie": `${KEY_COOKIE}=${LAN_KEY}; HttpOnly; SameSite=Strict; Path=/`,
      "Cache-Control": "no-store",
    });
    res.end();
    return false;
  }
  const cookie = String(req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === KEY_COOKIE);
  if (sameKey(cookie?.[1])) return true;
  send(res, 403, "This address needs the link with the key that Blueprint printed when it started.", "text/plain; charset=utf-8");
  return false;
}

// Past the limit the body is read to its end and dropped, so the answer is a
// 413 the page can show rather than a connection cut halfway.
function readBytes(req, limit) {
  return new Promise((done, fail) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on("end", () => (size > limit ? fail(Object.assign(new Error("too large"), { status: 413 })) : done(Buffer.concat(chunks))));
    req.on("error", fail);
  });
}

/** The JSON a request carries, or the answer to give when it is not one. */
async function readJson(req, res, limit = MAX_BODY) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    send(res, 415, { error: "JSON only." });
    return undefined;
  }
  try {
    return JSON.parse((await readBytes(req, limit)).toString("utf8"));
  } catch (error) {
    if (error.status === 413) send(res, 413, { error: "Too large." });
    else send(res, 400, { error: "Unreadable request." });
    return undefined;
  }
}

// A page on another site can still send a request to this port; the browser
// says where it comes from, and only the viewer's own page may change anything.
const foreign = (req) => {
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  return Boolean((origin && !ORIGINS.has(origin)) || (site && site !== "same-origin" && site !== "none"));
};

// ---- the agent -----------------------------------------------------------

// The person's channel to the agents, opened on the first use: a server that
// never sends a message writes nothing to the mind. A failure to open it is
// not kept, so a mind that appears later is found.
let person = null;
function personRelay() {
  person ??= createPersonRelay({ mindPath: MIND, tool: "blueprint", hostname: HOSTNAME }).catch((error) => {
    person = null;
    throw error;
  });
  return person;
}

async function sendToAgent(project, message) {
  try {
    return await (await personRelay()).send({ project: project.name, ...message });
  } catch (error) {
    console.error(error);
    // The thing the person wrote is already on disk; only the message failed.
    return { sent: false, reason: "failed" };
  }
}

/** Where a comment sits, for a subject line: the element, else the screen, else the board. */
function placeOf(anchor) {
  if (anchor.element) return anchor.label || anchor.element;
  if (anchor.screen) return anchor.screenTitle || anchor.screen;
  return "board";
}

function anchorLines(anchor) {
  return [
    `Screen: ${anchor.screen ? `${anchor.screen} (${anchor.screenTitle})` : "none, the comment is on the empty board"}`,
    `Element: ${anchor.element ? `${anchor.element} (${anchor.label})` : "none"}`,
  ];
}

const quote = (text) => text.split("\n").map((line) => `> ${line}`).join("\n");

/** The message a comment or a reply sends: what was written, where, and where to answer. */
function commentMessage(project, board, thread, text, reply) {
  const file = resolve(commentsFile(project, board));
  return {
    subject: `Blueprint comment: ${board} / ${placeOf(thread.anchor)}`,
    body: [
      reply ? `A reply in a comment thread on the board ${board} of ${project.name}.` : `A new comment on the board ${board} of ${project.name}.`,
      "",
      quote(text),
      "",
      `Project: ${project.name}`,
      `Board: ${board}`,
      ...anchorLines(thread.anchor),
      `Thread: ${thread.id}`,
      "",
      `Answer in the thread: open docs/flows/comments/${board}.json of the project (the attached file, ${file}), find the thread ${thread.id} and append a message to its messages with your unit as author, the time in UTC and your answer as text. Change the board only if the comment asks for it.`,
    ].join("\n"),
    attachments: [file],
  };
}

/** The message a reference image sends: the picture, the screen that holds it and the thread to report in. */
function referenceMessage(project, board, thread, screen, image, note) {
  const comments = resolve(commentsFile(project, board));
  const picture = resolve(project.flows, "assets", image.src.slice("assets/".length));
  return {
    subject: `Blueprint reference: ${board} / ${screen.title}`,
    body: [
      `The person added a reference image to the sketch of the board ${board} of ${project.name} and asks for it to be recreated as a screen of the board.`,
      "",
      quote(note),
      "",
      `Project: ${project.name}`,
      `Board: ${board}`,
      `Sketch screen: ${screen.id} (${screen.title})`,
      `Reference image: ${picture}`,
      `Sketch: ${resolve(sketchFile(project, board))}`,
      `Thread: ${thread.id}`,
      "",
      `Recreate the image as a screen of the board, in the board's own module. Then report in the thread: open docs/flows/comments/${board}.json of the project (the attached file, ${comments}), find the thread ${thread.id} and append a message to its messages with your unit as author, the time in UTC and the id of the screen you added.`,
    ].join("\n"),
    attachments: [picture, comments],
  };
}

async function agent(res, projects, name) {
  const project = projects.get(name);
  if (!project) return send(res, 404, { error: "Unknown project." });
  try {
    return send(res, 200, { agent: await (await personRelay()).agentFor(project.name) });
  } catch (error) {
    console.error(error);
    return send(res, 200, { agent: null });
  }
}

// ---- the routes of the comments --------------------------------------------

async function comments(req, res, projects, name, board) {
  const project = projects.get(name);
  if (!project || !BOARD_ID.test(board)) return send(res, 404, { error: "Unknown board." });

  if (req.method === "GET") return send(res, 200, await readDoc(project, board));

  if (req.method === "POST") {
    if (foreign(req)) return send(res, 403, { error: "Only the Review page can change comments." });
    const op = await readJson(req, res);
    if (op === undefined) return undefined;
    if (op?.send !== undefined && typeof op.send !== "boolean") return send(res, 400, { error: "send must be true or false." });
    const saved = await serial(`${name}/${board}`, async () => {
      const doc = await readDoc(project, board);
      const problem = apply(doc, op);
      if (problem) return { problem };
      await writeDoc(project, board, doc);
      const thread = op.op === "add" ? doc.threads.at(-1) : doc.threads.find((t) => t.id === op.thread);
      return { doc, thread };
    });
    if (saved.problem) return send(res, 400, { error: saved.problem });
    if (op.send !== true || (op.op !== "add" && op.op !== "reply")) return send(res, 200, saved.doc);
    // The comment is on disk before anything is sent: a message that fails
    // costs the person a second click, never the words.
    const text = saved.thread.messages.at(-1).text;
    const relay = await sendToAgent(project, commentMessage(project, board, saved.thread, text, op.op === "reply"));
    return send(res, 200, { ...saved.doc, saved: true, relay });
  }

  return send(res, 405, { error: "GET or POST." });
}

// ---- sketches ------------------------------------------------------------

const sketchFile = (project, board) => join(project.flows, "sketches", `${board}.json`);

// A sketch belongs to a board of the index, so a request cannot make files up.
async function boardEntry(project, board) {
  try {
    const entries = JSON.parse(await readFile(join(project.flows, "boards", "index.json"), "utf8"));
    return Array.isArray(entries) ? (entries.find((entry) => entry?.id === board) ?? null) : null;
  } catch {
    return null;
  }
}

// The revision is the hash of the bytes on disk, so an edit by hand or by an
// agent is a new revision too.
const revisionOf = (raw) => createHash("sha256").update(raw).digest("hex").slice(0, 32);

async function readRaw(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** The sketch of a board as it is on disk: an empty one when there is no file, none and the reason when the file is not a valid sketch. */
async function readSketch(project, board, entry) {
  const raw = await readRaw(sketchFile(project, board));
  if (raw === null) return { revision: "", sketch: newSketch(board, label(entry.title, MAX_LABEL) ?? board), problem: null };
  const revision = revisionOf(raw);
  try {
    return { revision, sketch: validateSketch(JSON.parse(raw.toString("utf8"))), problem: null };
  } catch (error) {
    return { revision, sketch: null, problem: error instanceof SketchError ? error.message : "The file is not JSON." };
  }
}

async function sketches(req, res, projects, name, board) {
  const project = projects.get(name);
  const entry = project && BOARD_ID.test(board) ? await boardEntry(project, board) : null;
  if (!entry) return send(res, 404, { error: "Unknown board." });

  if (req.method === "GET") return send(res, 200, await readSketch(project, board, entry));

  if (req.method === "PUT") {
    if (foreign(req)) return send(res, 403, { error: "Only the Review page can change a sketch." });
    const body = await readJson(req, res, MAX_SKETCH_BYTES);
    if (body === undefined) return undefined;
    if (typeof body?.base !== "string") return send(res, 400, { error: "base must be the revision the page was given." });
    let sketch;
    try {
      sketch = validateSketch(body.sketch);
    } catch (error) {
      if (error instanceof SketchError) return send(res, 400, { error: error.message });
      throw error;
    }
    return serial(`sketch/${name}/${board}`, async () => {
      const file = sketchFile(project, board);
      const current = await readRaw(file);
      // Someone else wrote the file since the page read it: theirs stands, and the page is told.
      if ((current === null ? "" : revisionOf(current)) !== body.base) {
        return send(res, 409, { error: "The sketch changed on disk.", ...(await readSketch(project, board, entry)) });
      }
      const text = `${JSON.stringify(sketch, null, 2)}\n`;
      await writeAtomic(file, text);
      return send(res, 200, { revision: revisionOf(text), sketch });
    });
  }

  return send(res, 405, { error: "GET or PUT." });
}

/** A picture pasted or picked in the viewer, kept in the repository's docs/flows/assets/. */
async function images(req, res, projects, name) {
  const project = projects.get(name);
  if (!project) return send(res, 404, { error: "Unknown project." });
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  if (foreign(req)) return send(res, 403, { error: "Only the Review page can add a picture." });
  const declared = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const kind = PICTURES.find((picture) => picture.type === declared);
  if (!kind) return send(res, 415, { error: "A PNG, JPEG or WebP picture only." });
  let bytes;
  try {
    bytes = await readBytes(req, MAX_IMAGE_BYTES);
  } catch (error) {
    return error.status === 413 ? send(res, 413, { error: "The picture is over 8 MB." }) : send(res, 400, { error: "Unreadable request." });
  }
  if (!kind.is(bytes)) return send(res, 415, { error: "The file is not the kind of picture it says." });
  const file = `${randomUUID()}.${kind.ext}`;
  await writeAtomic(join(project.flows, "assets", file), bytes);
  return send(res, 201, { src: `assets/${file}`, url: `/p/${encodeURIComponent(project.name)}/assets/${file}`, bytes: bytes.length });
}

/**
 * The person asks for a reference image to be recreated. The image already sits
 * on a screen of the sketch; this opens the thread the agent reports in, on
 * that screen, and sends the agent the request.
 */
async function references(req, res, projects, name, board) {
  const project = projects.get(name);
  const entry = project && BOARD_ID.test(board) ? await boardEntry(project, board) : null;
  if (!entry) return send(res, 404, { error: "Unknown board." });
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  if (foreign(req)) return send(res, 403, { error: "Only the Review page can ask for a reference." });
  const body = await readJson(req, res);
  if (body === undefined) return undefined;
  const note = body?.note === undefined || body.note === "" ? REFERENCE_NOTE : cleanText(body.note);
  if (typeof body?.screen !== "string" || !note) return send(res, 400, { error: "A screen and a note of at most 4000 characters." });
  const { sketch } = await readSketch(project, board, entry);
  const screen = sketch?.screens.find((candidate) => candidate.id === body.screen);
  const image = screen?.root.kids.find((kid) => kid.t === "image");
  if (!image) return send(res, 404, { error: "That screen of the sketch has no reference image." });
  const saved = await serial(`${name}/${board}`, async () => {
    const doc = await readDoc(project, board);
    apply(doc, {
      op: "add",
      anchor: { screen: screen.id, screenTitle: screen.title, element: null, label: screen.title, path: [screen.title], point: { x: 0, y: 0 } },
      text: note,
    });
    await writeDoc(project, board, doc);
    return { doc, thread: doc.threads.at(-1) };
  });
  const relay = await sendToAgent(project, referenceMessage(project, board, saved.thread, screen, image, note));
  return send(res, 200, { ...saved.doc, saved: true, thread: saved.thread.id, relay });
}

/** A file under `root`, by a path that may not climb out of it. */
async function serveFrom(res, root, relative) {
  const base = resolve(root);
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) return notFound(res);
  const type = TYPES[extname(target)];
  if (!type) return notFound(res);
  try {
    return send(res, 200, await readFile(target), type);
  } catch {
    return notFound(res);
  }
}

/**
 * The import map the viewer page carries. Boards write `blueprint/kit.mjs` for
 * the shared kit. A repository's own modules (`../kit/kit.mjs`, its skins, a
 * project-specific extension) are plain paths under /p/<project>/kit/ and are
 * served from the repository. A kit file the repository does not have is
 * mapped to the shared copy, so `../kit/board.mjs` and `blueprint/board.mjs`
 * are one module and the engine exists once on the page.
 */
async function importMap(projects) {
  const imports = { "blueprint/": "/kit/" };
  for (const project of projects.values()) {
    for (const file of SHARED_KIT) {
      if (!(await isFile(join(project.flows, "kit", file)))) imports[`/p/${encodeURIComponent(project.name)}/kit/${file}`] = `/kit/${file}`;
    }
  }
  return JSON.stringify({ imports }).replace(/</g, "\\u003c");
}

const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The stylesheets a repository supplies for its fonts: docs/flows/kit/theme.css
 * when it has one, and the Google Fonts stylesheets its own review page
 * already links (a repository written for its own viewer keeps its fonts
 * without a change). Nothing else from outside is ever linked.
 */
async function themeStyles(project) {
  const links = [];
  if (await isFile(join(project.flows, "kit", "theme.css"))) links.push(`/p/${encodeURIComponent(project.name)}/kit/theme.css`);
  if (await fontFaces(project)) links.push(`/p/${encodeURIComponent(project.name)}/fonts.css`);
  const own = await readFile(join(project.flows, "review", "index.html"), "utf8").catch(() => "");
  for (const tag of own.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel="stylesheet"/i.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
    if (href?.startsWith(FONT_STYLES) && !/[\s"'<>]/.test(href)) links.push(href);
  }
  return links;
}

/**
 * The @font-face rules of a repository's own review stylesheet, with the
 * files they name from the root (`/fonts/x.ttf`) pointed at this server's
 * /p/<project>/fonts/ route, so a display face a repository's boards measure
 * with is the one this viewer draws with.
 */
async function fontFaces(project) {
  const css = await readFile(join(project.flows, "review", "review.css"), "utf8").catch(() => "");
  const base = `/p/${encodeURIComponent(project.name)}/fonts/`;
  return (css.match(/@font-face\s*\{[^}]*\}/g) ?? [])
    .map((rule) => rule.replace(/url\(\s*(["']?)\/fonts\/([^"')\s]+)\1\s*\)/g, (_, quote, file) => `url(${quote}${base}${file}${quote})`))
    .join("\n");
}

/** A font file of a repository, from the first of its font folders that has it. */
async function serveFont(res, project, file) {
  for (const home of FONT_HOMES) {
    const root = join(project.root, ...home);
    const target = resolve(root, file);
    if (target.startsWith(resolve(root) + sep) && (await isFile(target))) return serveFrom(res, root, file);
  }
  return notFound(res);
}

async function viewer(res, projects) {
  const page = await readFile(join(REVIEW, "index.html"), "utf8");
  const map = await importMap(projects);
  const hash = createHash("sha256").update(map).digest("base64");
  const styles = (await Promise.all([...projects.values()].map(themeStyles))).flat();
  const links = styles.map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />`).join("\n    ");
  const html = page
    .replace("<!--importmap-->", () => `<script type="importmap">${map}</script>`)
    .replace("<!--themes-->", () => links);
  return send(res, 200, html, TYPES[".html"], policy([hash], styles.some((href) => href.startsWith("https:"))));
}

async function route(req, res) {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/") {
    res.writeHead(302, { Location: "/review/" });
    return res.end();
  }
  const projects = await discover();

  const comment = pathname.match(/^\/api\/comments\/([^/]+)\/([^/]+)$/);
  if (comment) return comments(req, res, projects, decodeURIComponent(comment[1]), comment[2]);

  const sketch = pathname.match(/^\/api\/sketch\/([^/]+)\/([^/]+)$/);
  if (sketch) return sketches(req, res, projects, decodeURIComponent(sketch[1]), sketch[2]);

  const reference = pathname.match(/^\/api\/reference\/([^/]+)\/([^/]+)$/);
  if (reference) return references(req, res, projects, decodeURIComponent(reference[1]), reference[2]);

  const picture = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (picture) return images(req, res, projects, decodeURIComponent(picture[1]));

  if (req.method !== "GET") return send(res, 405, { error: "GET only." });

  const wanted = pathname.match(/^\/api\/agent\/([^/]+)$/);
  if (wanted) return agent(res, projects, decodeURIComponent(wanted[1]));

  if (pathname === "/api/boards") return send(res, 200, await boardIndex(projects));
  if (pathname === "/review" || pathname === "/review/" || pathname === "/review/index.html") return viewer(res, projects);
  if (pathname.startsWith("/review/")) return serveFrom(res, REVIEW, `.${decodeURIComponent(pathname.slice("/review".length))}`);

  const shared = pathname.match(/^\/kit\/([^/]+)$/);
  if (shared) return SHARED_KIT.has(shared[1]) ? serveFrom(res, KIT, shared[1]) : notFound(res);

  const faces = pathname.match(/^\/p\/([^/]+)\/fonts\.css$/);
  if (faces) {
    const project = projects.get(decodeURIComponent(faces[1]));
    return project ? send(res, 200, await fontFaces(project), TYPES[".css"]) : notFound(res);
  }

  const own = pathname.match(/^\/p\/([^/]+)\/([^/]+)\/(.+)$/);
  if (own) {
    const project = projects.get(decodeURIComponent(own[1]));
    if (!project) return notFound(res);
    const relative = decodeURIComponent(own[3]);
    if (own[2] === "fonts") return serveFont(res, project, relative);
    if (!AREAS.has(own[2])) return notFound(res);
    // The repository's own file wins, theme included; the shared kit answers
    // only for a file the repository does not have.
    if (own[2] === "kit" && SHARED_KIT.has(relative) && !(await isFile(join(project.flows, "kit", relative)))) {
      return serveFrom(res, KIT, relative);
    }
    return serveFrom(res, join(project.flows, own[2]), relative);
  }

  return notFound(res);
}

const server = createServer(async (req, res) => {
  try {
    const host = String(req.headers.host ?? "").toLowerCase();
    if (!HOSTS.has(host)) return send(res, 421, { error: "Unknown host." });
    if (!LOCAL_HOSTS.has(host) && !lanPass(req, res)) return;
    return await route(req, res);
  } catch (error) {
    if (error instanceof URIError) return send(res, 400, "Bad path.", "text/plain; charset=utf-8");
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "Server error." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is taken. Blueprint may already be running at http://localhost:${PORT}/`);
  else console.error(error);
  process.exit(1);
});

server.listen(PORT, LAN ? "0.0.0.0" : HOST, async () => {
  console.log(`Blueprint is on http://localhost:${PORT}/ (mind ${MIND}, machine ${HOSTNAME})`);
  for (const host of LAN_HOSTS) console.log(`On the home network: http://${host}/review/?key=${LAN_KEY}`);
  try {
    const projects = await discover();
    console.log(`Projects with boards: ${projects.size ? [...projects.keys()].join(", ") : "none yet"}`);
  } catch (error) {
    console.error(error.message);
  }
});
