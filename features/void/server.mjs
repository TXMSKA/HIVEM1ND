// Void: the local server behind /void.
//
// It shows one Void document, a JSON file an agent wrote, in the reader, and
// saves each edit back into that file as plain text. The first save keeps the
// untouched document as <name>.orig.json and every save appends a line to
// <name>.versions.jsonl, so an agent reads the edits from disk with nothing
// asked of the person.
//
// Three things sit on top of that. Comments on a selection are kept in
// <name>.comments.json. While a page is open the server watches the document
// and its comments and tells the page of a change made from outside. And with
// "Send to agent" on, a comment is sent to the document's agent at once and the
// person's own edits are sent in one message a while after the last one.
//
// Node built-ins only, bound to 127.0.0.1. Run: node server.mjs [--port <n>]
// [--lan] [--mind <path>] [--hostname <name>] then open
// http://localhost:3301/?file=<absolute path, URL-encoded>, or from a phone on
// the same network the link with a key that --lan prints.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir, hostname as machineName, networkInterfaces } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PERSON, addReply, addThread, cleanText, commentMessage, createAnchor, emptyComments, findAnchor, place, setStatus } from './comments.mjs';
import { createEdits, editsMessage } from './edits.mjs';
import { projectOf } from './project.mjs';
import { merge, plain, wordDiff } from './text.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:";

const original = (file) => file.replace(/\.json$/i, '.orig.json');
const versions = (file) => file.replace(/\.json$/i, '.versions.jsonl');
const commentsOf = (file) => file.replace(/\.json$/i, '.comments.json');

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function docPath(url) {
  const file = url.searchParams.get('file');
  if (!file || !path.isAbsolute(file) || !/\.json$/i.test(file) || /\.(orig|comments)\.json$/i.test(file)) throw new Error('file must be an absolute path to a .json Void document');
  return path.normalize(file);
}

async function readJson(file) {
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!doc || !Array.isArray(doc.pages)) throw new Error(`${file} has no pages array`);
  return doc;
}

async function edited(file, doc) {
  let base;
  try { base = await readJson(original(file)); } catch { return []; }
  const before = new Map(base.pages.map((p) => [p.k, p]));
  return doc.pages.filter((p) => {
    const b = before.get(p.k);
    return !b || Object.keys(p).some((key) => p[key] !== b[key]);
  }).map((p) => p.k);
}

async function history(file) {
  try {
    return (await fs.readFile(versions(file), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function write(file, doc) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(doc, null, 2) + '\n');
  await fs.rename(temp, file);
}

// A comments file that exists but cannot be read is never replaced by an empty
// one, so a half-written file or a typo does not cost the comments in it.
async function readComments(file, strict = false) {
  const name = path.basename(file);
  let raw;
  try { raw = await fs.readFile(commentsOf(file), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return emptyComments(name);
    throw e;
  }
  try {
    const comments = JSON.parse(raw);
    if (!comments || !Array.isArray(comments.threads)) throw new Error('no threads array');
    return comments;
  } catch (e) {
    if (strict) throw fail(409, `${path.basename(commentsOf(file))} cannot be read (${e.message}). Fix or remove it, and the comment is saved.`);
    return emptyComments(name);
  }
}

const titleOf = (doc, file) => (typeof doc.title === 'string' && doc.title ? doc.title : path.basename(file, '.json'));

// An agent that writes the document from a copy read before the last save leaves a lower rev and the old text of the pages saved since.
// Those saves are applied again wherever the agent left the old text; a page the agent rewrote keeps the agent's text.
async function repair(file, doc) {
  const hist = await history(file);
  const last = hist.reduce((top, v) => Math.max(top, v.rev || 0), 0);
  const rev = doc.rev || 0;
  if (rev >= last) return doc;
  let next = last;
  const restored = [];
  for (const v of hist) {
    if (!(v.rev > rev)) continue;
    const page = doc.pages.find((p) => p.k === v.k);
    if (!page || page[v.lang] !== v.before) continue;
    page[v.lang] = v.after;
    restored.push({ at: new Date().toISOString(), rev: ++next, k: v.k, lang: v.lang, before: v.before, after: v.after, restored: v.rev });
  }
  doc.rev = next;
  await write(file, doc);
  if (restored.length) await fs.appendFile(versions(file), restored.map((v) => JSON.stringify(v)).join('\n') + '\n');
  return doc;
}

// What changed between two copies of a document, as one entry per page text.
function diffPages(before, after) {
  const old = new Map(before.map((p) => [p.k, p]));
  const changes = [];
  for (const page of after) {
    const was = old.get(page.k);
    for (const lang of Object.keys(page)) {
      if (lang === 'k' || typeof page[lang] !== 'string') continue;
      const prev = typeof was?.[lang] === 'string' ? was[lang] : '';
      if (prev !== page[lang]) changes.push({ k: page.k, lang, before: prev, after: page[lang] });
    }
  }
  return changes;
}

const order = (pages) => pages.map((p) => p.k).join('\u0000');

async function stamp(file) {
  try {
    const stat = await fs.stat(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch { return '-'; }
}

async function slurp(req) {
  // Decoded as a stream, so a letter that two chunks split is not broken.
  req.setEncoding('utf8');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw fail(413, 'too large');
  }
  return JSON.parse(raw);
}

function findMind() {
  const isMind = (dir) => existsSync(path.join(dir, 'user', 'VERSION'));
  const installed = path.resolve(here, '..', '..');
  if (isMind(installed)) return installed;
  if (isMind(process.cwd())) return process.cwd();
  return path.join(homedir(), 'HIVEM1ND');
}

// `relay` and `timers` are for tests: a stand-in for the person's Relay channel
// and a clock moved by hand. Without them the real ones are used.
export function createVoid({ port = 3301, lan = false, mindPath = findMind(), hostname = machineName(), relay, timers, wait, pollMs = 500 } = {}) {
  mindPath = path.resolve(mindPath);
  // With lan the server also answers on this machine's home network addresses.
  // It opens any document path it is given, so each of those requests needs the
  // key printed at start: once in the link, then as a cookie. The key changes on
  // every start.
  const lanKey = lan ? randomBytes(18).toString('base64url') : '';
  let localHosts = new Set();
  let lanHosts = [];
  let hosts = new Set();
  let origins = new Set();
  const sameKey = (given) => Boolean(given) && given.length === lanKey.length && timingSafeEqual(Buffer.from(given), Buffer.from(lanKey));

  function bind(actual) {
    port = actual;
    localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    lanHosts = lan ? Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal).map((a) => `${a.address}:${port}`) : [];
    hosts = new Set([...localHosts, ...lanHosts]);
    origins = new Set([...hosts].map((host) => `http://${host}`));
  }

  // Reads and saves run one at a time so two quick edits never interleave their read and write of the same file.
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  // What each document looked like when the pages last heard of it, and the
  // pages listening. A change that is not the server's own is the difference.
  const docs = new Map();
  let ticker = null;

  function track(file) {
    let state = docs.get(file);
    if (!state) docs.set(file, state = { snap: null, clients: new Set(), stamp: '', comments: '', busy: false });
    return state;
  }

  function broadcast(file, event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of docs.get(file)?.clients ?? []) {
      // A stalled tab must not pile up an unbounded queue of events.
      if (!client.write(message)) client.destroy();
    }
  }

  async function threadsOf(file, doc) {
    return (await readComments(file)).threads.map((thread) => ({ ...thread, place: place(doc.pages, thread) }));
  }

  // Compares the document with what the pages were told last. With a page open,
  // a difference is a change from outside: it is logged beside the person's
  // saves, with no rev of its own, and sent to the pages with its words marked.
  async function sync(file, doc) {
    const state = track(file);
    const before = state.snap;
    state.snap = { title: doc.title, pages: structuredClone(doc.pages) };
    if (!before || !state.clients.size) return;
    const changes = diffPages(before.pages, doc.pages);
    if (!changes.length && before.title === doc.title && order(before.pages) === order(doc.pages)) return;
    if (changes.length) {
      const at = new Date().toISOString();
      await fs.appendFile(versions(file), changes.map((c) => JSON.stringify({ at, rev: doc.rev || 0, ...c, by: 'outside' })).join('\n') + '\n');
    }
    broadcast(file, 'doc', {
      title: doc.title,
      pages: doc.pages,
      edited: await edited(file, doc),
      changes: changes.map((c) => ({ k: c.k, lang: c.lang, runs: wordDiff(c.before, c.after) })),
      threads: await threadsOf(file, doc),
    });
  }

  async function fresh(file) {
    const doc = await repair(file, await readJson(file));
    await sync(file, doc);
    return doc;
  }

  const load = (file) => serial(() => fresh(file));

  // The person's own save changes the file, so the snapshot moves with it.
  function remember(file, doc) {
    track(file).snap = { title: doc.title, pages: structuredClone(doc.pages) };
  }

  // `base` is the text the person's edit was made from. When the file holds
  // another text by now, the two changes are joined wherever they do not touch.
  function save(file, { k, lang, text, base, send }) {
    return serial(async () => {
      const doc = await fresh(file);
      const page = doc.pages.find((p) => p.k === k);
      if (!page || lang === 'k' || typeof page[lang] !== 'string' || typeof text !== 'string') throw new Error('unknown page or language');
      const final = typeof base === 'string' && base !== page[lang] ? merge(base, text, page[lang]) ?? text : text;
      if (page[lang] !== final) {
        await fs.writeFile(original(file), JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
        const before = page[lang];
        page[lang] = final;
        doc.rev = (doc.rev || 0) + 1;
        await write(file, doc);
        await fs.appendFile(versions(file), JSON.stringify({ at: new Date().toISOString(), rev: doc.rev, k, lang, before, after: final }) + '\n');
        remember(file, doc);
        if (send === true) edits.add(file, titleOf(doc, file), { k, lang, before, after: final });
      }
      return { edited: (await edited(file, doc)).includes(k), threads: await threadsOf(file, doc), text: final };
    });
  }

  // ---- Relay --------------------------------------------------------------

  // The channel is made on the first message, and only if the kit's engine is beside this folder.
  let personRelay;
  function relayOf() {
    if (relay) return Promise.resolve(relay);
    if (!personRelay) {
      personRelay = import('../../engine/relay/person.mjs').then((m) => m.createPersonRelay({ mindPath, tool: 'void-lite' }));
      personRelay.catch(() => { personRelay = undefined; });
    }
    return personRelay;
  }

  // The agent a document's messages go to, or null when it has none.
  async function agentOf(file) {
    try {
      const project = await projectOf(file, { mindPath, hostname });
      return project ? await (await relayOf()).agentFor(project) : null;
    } catch { return null; }
  }

  // `build` makes the message, so a message that cannot be made is a failed send like any other.
  async function tell(file, build, attachments) {
    try {
      const project = await projectOf(file, { mindPath, hostname });
      if (!project) return { sent: false, reason: 'no-agent' };
      return await (await relayOf()).send({ project, ...build(), attachments });
    } catch (e) {
      return { sent: false, reason: 'error', message: e.message };
    }
  }

  async function deliverEdits(file, title, list) {
    const result = await tell(file, () => editsMessage({ title, file, edits: list }), [file]);
    broadcast(file, 'sent', { what: 'edits', count: list.length, ...result });
  }

  const edits = createEdits({ wait, timers, deliver: deliverEdits });

  // ---- comments -----------------------------------------------------------

  function selection(doc, body) {
    const page = doc.pages.find((p) => p.k === body.k);
    if (!page || body.lang === 'k' || typeof page[body.lang] !== 'string') throw new Error('unknown page or language');
    const text = plain(page[body.lang]);
    const quote = typeof body.quote === 'string' ? body.quote : '';
    const found = findAnchor(text, { quote, prefix: String(body.prefix ?? ''), suffix: String(body.suffix ?? ''), start: Number(body.start) });
    if (!found?.exact) throw fail(409, 'The text changed. Select it again.');
    return createAnchor(text, found.start, found.end, body.lang, body.k);
  }

  // The comment is saved before anything is sent, and a send that fails leaves
  // it saved: the page is told the message was not sent.
  async function comment(file, body) {
    const wants = body.send === true && body.op !== 'status';
    const agent = wants ? await agentOf(file) : null;
    const saved = await serial(async () => {
      const doc = await fresh(file);
      const comments = await readComments(file, true);
      const text = cleanText(body.text);
      let thread;
      if (body.op === 'status') thread = setStatus(comments, body.id, body.status);
      else if (body.op !== 'add' && body.op !== 'reply') throw new Error('unknown operation');
      else if (!text) throw new Error('The comment is empty or too long.');
      else if (body.op === 'add') thread = addThread(comments, { anchor: selection(doc, body), text, to: agent?.unit });
      else thread = addReply(comments, body.id, text);
      if (!thread) throw fail(404, 'unknown comment');
      await write(commentsOf(file), comments);
      track(file).comments = await fs.readFile(commentsOf(file), 'utf8');
      const threads = await threadsOf(file, doc);
      broadcast(file, 'comments', { threads });
      return { doc, thread, threads };
    });
    const sent = !wants ? null
      : !agent ? { sent: false, reason: 'no-agent' }
        : await tell(file, () => commentMessage({
          title: titleOf(saved.doc, file),
          thread: saved.thread,
          file,
          commentsFile: commentsOf(file),
          page: saved.doc.pages.find((p) => p.k === saved.thread.anchor.k),
          reply: body.op === 'reply',
        }), [commentsOf(file)]);
    return { thread: saved.thread, threads: saved.threads, sent };
  }

  // Each page text against the one it replaced, newest change of each text.
  async function changes(file) {
    const doc = await load(file);
    const latest = new Map();
    for (const v of await history(file)) latest.set(`${v.k}\u0000${v.lang}`, v);
    const pages = [];
    doc.pages.forEach((page, index) => {
      const texts = [];
      for (const lang of Object.keys(page)) {
        const v = latest.get(`${page.k}\u0000${lang}`);
        if (!v || typeof page[lang] !== 'string' || v.before === page[lang]) continue;
        texts.push({ lang, at: v.at, by: v.by ?? PERSON, runs: wordDiff(v.before, page[lang]) });
      }
      if (texts.length) pages.push({ k: page.k, index, texts });
    });
    return { pages };
  }

  // ---- watching -----------------------------------------------------------

  // One pass over a document a page has open. The file's size and time say
  // whether anything happened; only then is it read.
  async function check(file) {
    const state = docs.get(file);
    if (!state?.clients.size || state.busy) return;
    state.busy = true;
    try {
      const seen = `${await stamp(file)}|${await stamp(commentsOf(file))}`;
      if (seen === state.stamp) return;
      await serial(async () => {
        const doc = await fresh(file);
        const raw = await fs.readFile(commentsOf(file), 'utf8').catch(() => '');
        if (raw !== state.comments) {
          state.comments = raw;
          broadcast(file, 'comments', { threads: await threadsOf(file, doc) });
        }
      });
      state.stamp = seen;
    } catch { /* A file caught half written is read again at the next pass. */ } finally {
      state.busy = false;
    }
  }

  function listen(file, res) {
    const state = track(file);
    state.clients.add(res);
    ticker ??= setInterval(() => { for (const watched of docs.keys()) check(watched); }, pollMs);
    res.once('close', () => {
      state.clients.delete(res);
      if (![...docs.values()].some((s) => s.clients.size)) { clearInterval(ticker); ticker = null; }
    });
  }

  // ---- http ---------------------------------------------------------------

  function respond(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  }

  // The link's key becomes a cookie and the address loses it, so it stays out of
  // the history.
  function lanPass(req, res, url) {
    if (sameKey(url.searchParams.get('key'))) {
      url.searchParams.delete('key');
      res.writeHead(303, { Location: url.pathname + url.search, 'Set-Cookie': `void-key=${lanKey}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
      res.end();
      return false;
    }
    const cookie = String(req.headers.cookie ?? '').split(';').map((part) => part.trim().split('=')).find(([name]) => name === 'void-key');
    if (sameKey(cookie?.[1])) return true;
    respond(res, 403, { error: 'This address needs the link with the key that Void printed when it started.' });
    return false;
  }

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return respond(res, 403, { error: 'host' });
    const url = new URL(req.url, `http://${host}`);
    if (!localHosts.has(host) && !lanPass(req, res, url)) return;
    try {
      const get = req.method === 'GET';
      const post = req.method === 'POST';
      if (post && (!origins.has(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site')) return respond(res, 403, { error: 'origin' });
      if (get && url.pathname === '/') return respond(res, 200, await fs.readFile(path.join(here, 'reader.html'), 'utf8'), 'text/html; charset=utf-8');
      if (get && url.pathname === '/api/doc') {
        const file = docPath(url);
        const [doc, agent] = await Promise.all([load(file), agentOf(file)]);
        return respond(res, 200, { title: doc.title, pages: doc.pages, edited: await edited(file, doc), agent, threads: await threadsOf(file, doc) });
      }
      if (get && url.pathname === '/api/agent') return respond(res, 200, { agent: await agentOf(docPath(url)) });
      if (get && url.pathname === '/api/changes') return respond(res, 200, await changes(docPath(url)));
      if (get && url.pathname === '/api/events') {
        const file = docPath(url);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.flushHeaders();
        listen(file, res);
        // Listening comes first, so a change between the page's last read and now is told.
        await load(file);
        track(file).comments = await fs.readFile(commentsOf(file), 'utf8').catch(() => '');
        res.write('event: ready\ndata: {}\n\n');
        return;
      }
      if (post && url.pathname === '/api/save') return respond(res, 200, await save(docPath(url), await slurp(req)));
      if (post && url.pathname === '/api/comment') return respond(res, 200, await comment(docPath(url), await slurp(req)));
      // Turning "Send to agent" off drops the edits still waiting to be sent.
      if (post && url.pathname === '/api/send') return respond(res, 200, { cancelled: (await slurp(req)).send === false && edits.cancel(docPath(url)) });
      respond(res, 404, { error: 'not found' });
    } catch (e) {
      if (res.headersSent) return res.end();
      respond(res, e.status ?? 400, { error: e.message });
    }
  });

  // `check` and `edits` are exposed so a test can run one pass and read the held corrections.
  return {
    server,
    check,
    edits,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
          bind(server.address().port);
          resolve({ port, lanKey, lanHosts });
        });
      });
    },
    close() {
      clearInterval(ticker);
      ticker = null;
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
  const port = Number(flag('--port')) || 3301;
  const app = createVoid({ port, lan: process.argv.includes('--lan'), mindPath: flag('--mind'), hostname: flag('--hostname') ?? machineName() });
  try {
    const { lanKey, lanHosts } = await app.listen();
    console.log(`Void on http://localhost:${port}/?file=<absolute path to a .json document>`);
    for (const h of lanHosts) console.log(`On the home network: http://${h}/?key=${lanKey}&file=<absolute path to a .json document>`);
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is taken. Void may already be running at http://localhost:${port}/` : e);
    process.exit(1);
  }
}
