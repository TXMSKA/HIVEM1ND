// Void: the local server behind /void.
//
// It shows one Void document, a JSON file an agent wrote, in the reader, and
// saves each edit back into that file as plain text. The first save keeps the
// untouched document as <name>.orig.json and every save appends a line to
// <name>.versions.jsonl, so an agent reads the edits from disk with nothing
// asked of the person.
//
// Node built-ins only, bound to 127.0.0.1. Run: node server.mjs [--port <n>] [--lan]
// then open http://localhost:3301/?file=<absolute path, URL-encoded>, or from a
// phone on the same network the link with a key that --lan prints.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const port = Number(flag('--port')) || 3301;
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
// With --lan the server also answers on this machine's home network addresses.
// It opens any document path it is given, so each of those requests needs the
// key printed at start: once in the link, then as a cookie. The key changes on
// every start.
const lan = process.argv.includes('--lan');
const lanKey = lan ? randomBytes(18).toString('base64url') : '';
const lanHosts = lan ? Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal).map((a) => `${a.address}:${port}`) : [];
const hosts = new Set([...localHosts, ...lanHosts]);
const origins = new Set([...hosts].map((host) => `http://${host}`));
const sameKey = (given) => Boolean(given) && given.length === lanKey.length && timingSafeEqual(Buffer.from(given), Buffer.from(lanKey));
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:";

const original = (file) => file.replace(/\.json$/i, '.orig.json');
const versions = (file) => file.replace(/\.json$/i, '.versions.jsonl');

function docPath(url) {
  const file = url.searchParams.get('file');
  if (!file || !path.isAbsolute(file) || !/\.json$/i.test(file) || /\.orig\.json$/i.test(file)) throw new Error('file must be an absolute path to a .json Void document');
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

// Reads and saves run one at a time so two quick edits never interleave their read and write of the same file.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function load(file) {
  return serial(async () => repair(file, await readJson(file)));
}

function save(file, { k, lang, text }) {
  return serial(async () => {
    const doc = await repair(file, await readJson(file));
    const page = doc.pages.find((p) => p.k === k);
    if (!page || lang === 'k' || typeof page[lang] !== 'string' || typeof text !== 'string') throw new Error('unknown page or language');
    if (page[lang] !== text) {
      await fs.writeFile(original(file), JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
      const before = page[lang];
      page[lang] = text;
      doc.rev = (doc.rev || 0) + 1;
      await write(file, doc);
      await fs.appendFile(versions(file), JSON.stringify({ at: new Date().toISOString(), rev: doc.rev, k, lang, before, after: text }) + '\n');
    }
    return { edited: (await edited(file, doc)).includes(k) };
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
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
  send(res, 403, { error: 'This address needs the link with the key that Void printed when it started.' });
  return false;
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (!hosts.has(host)) return send(res, 403, { error: 'host' });
  const url = new URL(req.url, `http://${host}`);
  if (!localHosts.has(host) && !lanPass(req, res, url)) return;
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await fs.readFile(path.join(here, 'reader.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/doc') {
      const file = docPath(url);
      const doc = await load(file);
      return send(res, 200, { title: doc.title, pages: doc.pages, edited: await edited(file, doc) });
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      if (!origins.has(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'origin' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) return send(res, 413, { error: 'too large' }); }
      return send(res, 200, await save(docPath(url), JSON.parse(raw)));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is taken. Void may already be running at http://localhost:${port}/` : e);
  process.exit(1);
});

server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Void on http://localhost:${port}/?file=<absolute path to a .json document>`);
  for (const h of lanHosts) console.log(`On the home network: http://${h}/?key=${lanKey}&file=<absolute path to a .json document>`);
});
