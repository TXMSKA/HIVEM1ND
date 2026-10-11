import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPersonRelay } from '../engine/relay/person.mjs';
import { createAnchor, findAnchor, place } from '../features/void/comments.mjs';
import { DEFAULT_PORT, createVoid, startupMessage } from '../features/void/server.mjs';
import { projectOf } from '../features/void/project.mjs';
import { merge, plain, wordDiff } from '../features/void/text.mjs';

const PAGES = [
  { k: 'Intro.Welcome', en: '<b>Welcome</b>\nFirst line here.\n\nSecond paragraph of the text.', es: '<b>Bienvenida</b>\nPrimera línea.\n\nSegundo párrafo.' },
  { k: 'Intro.Other', en: 'Other page text', es: 'Otra página' },
];

// A clock moved by hand, for the batching of the person's edits.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, item] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= now) { pending.delete(id); item.fn(); }
      }
    },
  };
}

// The person's Relay channel as a test double: one agent for project alpha, and a send that can be made to fail.
function fakeRelay({ agents = { alpha: { unit: 'executor-alpha', awake: true } } } = {}) {
  const relay = {
    calls: [],
    fail: null,
    async agentFor(project) { return agents[project] ?? null; },
    async send(message) {
      if (relay.fail) throw relay.fail;
      relay.calls.push({ ...message, seenComments: relay.peek ? await relay.peek() : null });
      return { sent: true, to: agents[message.project].unit, id: `m${relay.calls.length}` };
    },
  };
  return relay;
}

async function fixture(context, { relay = fakeRelay(), wait, pollMs = 20, hostname = 'TESTBOX' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-void-test-'));
  const mind = path.join(root, 'mind');
  const repo = path.join(root, 'repos', 'alpha');
  await mkdir(path.join(mind, 'user', 'machines'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'beta'), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: alpha\n\n## Projects\n- alpha (web)\n');
  await writeFile(path.join(mind, 'user', 'machines', `${hostname}.md`), `machine: ${hostname}\n\n## Paths\n- web: ${path.join(root, 'repos')}\n- alpha: ${repo}\n`);
  const file = path.join(repo, 'handbook.json');
  await writeFile(file, JSON.stringify({ title: 'Handbook', rev: 0, pages: structuredClone(PAGES) }, null, 2) + '\n');
  const timers = fakeTimers();
  const app = createVoid({ port: 0, mindPath: mind, hostname, relay, timers, wait, pollMs });
  const { port } = await app.listen();
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://localhost:${port}`;
  const apiFor = (target) => (route, body, headers = {}) => request(body === undefined ? 'GET' : 'POST', base, `${route}${route.includes('?') ? '&' : '?'}file=${encodeURIComponent(target)}`, body, { Origin: base, ...headers });
  return { root, mind, repo, file, app, base, port, relay, timers, apiFor, api: apiFor(file), comments: file.replace(/\.json$/, '.comments.json') };
}

function request(method, base, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(route, base), { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw.startsWith('{') || raw.startsWith('[') ? JSON.parse(raw) : raw, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// The page's event stream: events collected as they arrive, and a way to wait for the next one of a kind.
function stream(context, base, file) {
  const events = [];
  const waiting = [];
  const req = http.get(new URL(`/api/events?file=${encodeURIComponent(file)}`, base), (res) => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!event) continue;
        const item = { event, data: JSON.parse(data), taken: false };
        events.push(item);
        const waiter = waiting.find((w) => w.event === event);
        if (waiter) { waiting.splice(waiting.indexOf(waiter), 1); item.taken = true; waiter.resolve(item.data); }
      }
    });
  });
  req.on('error', () => {});
  context.after(() => req.destroy());
  return {
    events,
    next: (event, ms = 3000) => new Promise((resolve, reject) => {
      const found = events.find((e) => e.event === event && !e.taken);
      if (found) { found.taken = true; return resolve(found.data); }
      const timer = setTimeout(() => reject(new Error(`no ${event} event within ${ms} ms`)), ms);
      waiting.push({ event, resolve: (data) => { clearTimeout(timer); resolve(data); } });
    }),
  };
}

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const select = (text, quote, extra = {}) => ({ k: 'Intro.Welcome', lang: 'en', quote, start: plain(text).indexOf(quote), prefix: '', suffix: '', ...extra });

// ---- text and anchors ---------------------------------------------------

test('plain text keeps the lines and the paragraph breaks the reader draws and drops the marks', () => {
  assert.equal(plain(PAGES[0].en), 'Welcome\nFirst line here.\n\nSecond paragraph of the text.');
  assert.equal(plain('<i>a</i> < b >\n\n\nc\n'), 'a < b >\n\nc');
});

test('the word diff reports inserted and removed words as runs', () => {
  const runs = wordDiff('The quick brown fox', 'The slow brown fox jumps');
  assert.deepEqual(runs.map((r) => r.kind), ['equal', 'delete', 'insert', 'equal', 'insert']);
  assert.equal(runs.find((r) => r.kind === 'delete').text, 'quick');
  assert.equal(runs.find((r) => r.kind === 'insert').text, 'slow');
  assert.equal(runs.map((r) => r.text).filter((_, i) => runs[i].kind !== 'delete').join(''), 'The slow brown fox jumps');
  assert.deepEqual(wordDiff('same', 'same'), [{ kind: 'equal', text: 'same' }]);
  assert.deepEqual(wordDiff('', 'new'), [{ kind: 'insert', text: 'new' }]);
});

test('a comment finds its words again after the page is edited around them', () => {
  const text = plain(PAGES[0].en);
  const quote = 'Second paragraph of the text';
  const start = text.indexOf(quote);
  const anchor = createAnchor(text, start, start + quote.length, 'en', 'Intro.Welcome');
  const pages = (en) => [{ k: 'Intro.Welcome', en }];
  const thread = { anchor };
  const longer = PAGES[0].en.replace('First line here.', 'First line here, now longer than before.');
  const inserted = place(pages(longer), thread);
  assert.equal(plain(longer).slice(inserted.start, inserted.end), quote);
  assert.equal(inserted.exact, true);
  const reworded = PAGES[0].en.replace('paragraph of the', 'paragraphs of the');
  const moved = place(pages(reworded), thread);
  assert.equal(moved.exact, false);
  assert.equal(plain(reworded).slice(moved.start, moved.end), 'Second paragraphs of the text.');
  assert.equal(place(pages('Nothing alike remains here.'), thread), null);
  assert.equal(place([], thread), null);
});

test('a repeated quote is told apart by its surroundings and then by its offset', () => {
  const text = 'red apple on the left and red apple on the right';
  const second = text.lastIndexOf('red apple');
  const anchor = createAnchor(text, second, second + 'red apple'.length, 'en', 'k');
  assert.equal(findAnchor(text, anchor).start, second);
  assert.equal(findAnchor(`a ${text}`, anchor).start, second + 2);
  const bare = { quote: 'red apple', prefix: '', suffix: '', start: second };
  assert.equal(findAnchor(text, bare).start, second);
  assert.equal(findAnchor(text, { ...bare, start: 0 }).start, 0);
});

// ---- the project of a document -----------------------------------------

test('a document belongs to the project of its repository or of its folder in the mind, the narrowest first', async (context) => {
  const { mind, repo } = await fixture(context);
  const options = { mindPath: mind, hostname: 'testbox' };
  assert.equal(await projectOf(path.join(repo, 'docs', 'a.json'), options), 'alpha');
  assert.equal(await projectOf(path.join(mind, 'user', 'projects', 'beta', 'doc.json'), options), 'beta');
  assert.equal(await projectOf(path.join(path.dirname(repo), 'elsewhere.json'), options), null, 'the environment folder is no project');
  assert.equal(await projectOf(path.join(os.tmpdir(), 'loose.json'), options), null);
  await mkdir(path.join(mind, 'user', 'projects', 'alpha'), { recursive: true });
  assert.equal(await projectOf(path.join(mind, 'user', 'projects', 'alpha', 'x.json'), options), 'alpha');
  assert.equal(await projectOf(path.join(repo, 'a.json'), { mindPath: mind, hostname: 'OTHERBOX' }), null, 'a machine without a record has no repository paths');
});

// ---- comments -------------------------------------------------------------

test('a comment is saved next to the document in the full Void format and found again by the page', async (context) => {
  const { api, file, comments, relay } = await fixture(context);
  const added = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: ' Please reword. ', send: false });
  assert.equal(added.status, 200);
  assert.equal(added.body.sent, null);
  assert.equal(relay.calls.length, 0);
  const saved = await json(comments);
  assert.equal(saved.path, 'handbook.json');
  assert.equal(saved.threads.length, 1);
  const [thread] = saved.threads;
  assert.match(thread.id, /^[0-9a-f-]{36}$/);
  assert.equal(thread.status, 'open');
  assert.equal(thread.to, undefined);
  assert.deepEqual(thread.messages.map((m) => [m.author, m.text]), [['person', 'Please reword.']]);
  assert.deepEqual(thread.anchor, { lang: 'en', quote: 'First line here.', prefix: 'Welcome\n', suffix: '\n\nSecond paragraph of the text.', k: 'Intro.Welcome', start: 8, end: 24 });

  const doc = (await api('/api/doc')).body;
  assert.deepEqual(doc.threads[0].place, { start: 8, end: 24, exact: true });
  assert.deepEqual(doc.agent, { unit: 'executor-alpha', awake: true });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pages[0].en, PAGES[0].en, 'the document itself is not touched');
});

test('a comment is anchored by its words, so an edit before them moves it along', async (context) => {
  const { api } = await fixture(context);
  await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'Second paragraph'), text: 'Why?', send: false });
  const saved = await api('/api/save', { k: 'Intro.Welcome', lang: 'en', text: PAGES[0].en.replace('Welcome', 'A much longer welcome') });
  assert.equal(saved.status, 200);
  const [thread] = saved.body.threads;
  const text = plain(PAGES[0].en.replace('Welcome', 'A much longer welcome'));
  assert.equal(text.slice(thread.place.start, thread.place.end), 'Second paragraph');
  await api('/api/save', { k: 'Intro.Welcome', lang: 'en', text: PAGES[0].en.replace('Second paragraph of the text.', 'Nothing remains.') });
  assert.equal((await api('/api/doc')).body.threads[0].place, null, 'a comment whose words are gone is kept and has no place');
});

test('a thread takes replies, is resolved and opened again', async (context) => {
  const { api, comments } = await fixture(context);
  const { body: { thread } } = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'One', send: false });
  const reply = await api('/api/comment', { op: 'reply', id: thread.id, text: 'Two', send: false });
  assert.deepEqual(reply.body.threads[0].messages.map((m) => m.text), ['One', 'Two']);
  const resolved = await api('/api/comment', { op: 'status', id: thread.id, status: 'resolved' });
  assert.equal(resolved.body.threads[0].status, 'resolved');
  assert.equal((await json(comments)).threads[0].status, 'resolved');
  assert.equal((await api('/api/comment', { op: 'reply', id: thread.id, text: 'Three', send: false })).body.threads[0].status, 'open', 'a reply opens a resolved thread');
  assert.equal((await api('/api/comment', { op: 'status', id: thread.id, status: 'done' })).status, 404);
  assert.equal((await api('/api/comment', { op: 'reply', id: 'nope', text: 'x' })).status, 404);
  assert.equal((await api('/api/comment', { op: 'reply', id: thread.id, text: '   ' })).status, 400);
});

test('a comment on text that is not there, or into an unreadable file, is refused and loses nothing', async (context) => {
  const { api, comments } = await fixture(context);
  const stale = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.', { quote: 'Text that is not on the page' }), text: 'x' });
  assert.equal(stale.status, 409);
  assert.equal((await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.', { lang: 'k' }), text: 'x' })).status, 400);
  await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'kept', send: false });
  const before = await readFile(comments, 'utf8');
  await writeFile(comments, '{"path": "handbook.json", "threads": [');
  const refused = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'second', send: false });
  assert.equal(refused.status, 409);
  assert.match(await readFile(comments, 'utf8'), /"threads": \[$/, 'the unreadable file is left as it is');
  await writeFile(comments, before);
  assert.equal((await api('/api/doc')).body.threads.length, 1);
});

test('with send on the comment is saved first and then sent to the agent with the comments file', async (context) => {
  const relay = fakeRelay();
  const { api, comments, file } = await fixture(context, { relay });
  relay.peek = async () => (await json(comments)).threads.length;
  const added = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'Second paragraph'), text: 'Cut this.', send: true });
  assert.deepEqual(added.body.sent, { sent: true, to: 'executor-alpha', id: 'm1' });
  assert.equal(relay.calls.length, 1);
  const [call] = relay.calls;
  assert.equal(call.seenComments, 1, 'the thread was on disk when the message went out');
  assert.equal(call.project, 'alpha');
  assert.equal(call.subject, 'Void comment: Handbook / Intro.Welcome');
  assert.deepEqual(call.attachments, [comments]);
  assert.match(call.body, /Comment in "Handbook", page Intro\.Welcome, en text, line 4\./);
  assert.match(call.body, /Selected text:\n> Second paragraph\n/);
  assert.match(call.body, /Comment:\nCut this\./);
  assert.ok(call.body.includes(`Document: ${file}`) && call.body.includes(`Comments file: ${comments}`));
  assert.equal((await json(comments)).threads[0].to, 'executor-alpha');

  const reply = await api('/api/comment', { op: 'reply', id: added.body.thread.id, text: 'And again.', send: true });
  assert.equal(reply.body.sent.sent, true);
  assert.match(relay.calls[1].body, /^Reply on a comment in "Handbook"/);
  assert.match(relay.calls[1].body, /Earlier in this thread:\nperson: Cut this\./);
  await api('/api/comment', { op: 'status', id: added.body.thread.id, status: 'resolved', send: true });
  assert.equal(relay.calls.length, 2, 'resolving tells no one');
});


test('a send that fails, or has nowhere to go, never loses the comment', async (context) => {
  const relay = fakeRelay();
  const { api, apiFor, comments, mind, root } = await fixture(context, { relay });
  relay.fail = new Error('inbox is locked');
  const failed = await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'First', send: true });
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body.sent, { sent: false, reason: 'error', message: 'inbox is locked' });
  assert.equal((await json(comments)).threads.length, 1);
  assert.equal((await api('/api/doc')).body.threads.length, 1);
  relay.fail = null;

  const beta = path.join(mind, 'user', 'projects', 'beta', 'doc.json');
  const loose = path.join(root, 'loose.json');
  for (const file of [beta, loose]) {
    await writeFile(file, JSON.stringify({ title: 'Other', pages: structuredClone(PAGES) }));
    const there = apiFor(file);
    assert.equal((await there('/api/doc')).body.agent, null);
    const added = await there('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'Alone', send: true });
    assert.deepEqual(added.body.sent, { sent: false, reason: 'no-agent' });
    assert.equal((await json(file.replace(/\.json$/, '.comments.json'))).threads.length, 1);
  }
  assert.equal(relay.calls.length, 0);
});

test('the agent of a document is told with the state of its wake', async (context) => {
  const relay = fakeRelay({ agents: { alpha: { unit: 'executor-alpha', awake: false } } });
  const { api } = await fixture(context, { relay });
  assert.deepEqual((await api('/api/agent')).body, { agent: { unit: 'executor-alpha', awake: false } });
  relay.agentFor = async () => { throw new Error('mind unreadable'); };
  assert.deepEqual((await api('/api/agent')).body, { agent: null }, 'a mind that cannot be read leaves the document without an agent');
});

// ---- the person's own edits ----------------------------------------------

test('saves made with send on are batched and sent once, 20 seconds after the last', async (context) => {
  const { api, relay, timers, app, file } = await fixture(context);
  const welcome = PAGES[0].en;
  const save = (k, lang, text, send = true) => api('/api/save', { k, lang, text, send });
  await save('Intro.Welcome', 'en', welcome.replace('First', 'Fist'));
  timers.tick(15000);
  await save('Intro.Welcome', 'en', welcome.replace('First line here.', 'First line, corrected.'));
  await save('Intro.Other', 'es', 'Otra página corregida');
  await save('Intro.Other', 'en', 'Not told', false);
  timers.tick(19999);
  await app.edits.idle();
  assert.equal(relay.calls.length, 0, 'the clock restarts at every edit');
  timers.tick(1);
  await app.edits.idle();
  assert.equal(relay.calls.length, 1);
  const [call] = relay.calls;
  assert.equal(call.project, 'alpha');
  assert.equal(call.subject, 'Void edits: Handbook');
  assert.deepEqual(call.attachments, [file]);
  assert.match(call.body, /corrected 2 texts in "Handbook"/);
  assert.ok(call.body.includes(`Page Intro.Welcome, en text\n\nBefore:\n${welcome}\n\nAfter:\n${welcome.replace('First line here.', 'First line, corrected.')}`), 'the text before is the one from before the first stroke');
  assert.ok(call.body.includes('Page Intro.Other, es text\n\nBefore:\nOtra página\n\nAfter:\nOtra página corregida'));
  assert.ok(!call.body.includes('Fist') && !call.body.includes('Not told'));
  assert.equal(app.edits.pending(file), 0);
  timers.tick(60000);
  await app.edits.idle();
  assert.equal(relay.calls.length, 1, 'nothing is sent twice');
});

test('an edit put back as it was is not told, and turning send off drops what waits', async (context) => {
  const { api, relay, timers, app, file } = await fixture(context);
  const text = PAGES[1].en;
  await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'changed', send: true });
  await api('/api/save', { k: 'Intro.Other', lang: 'en', text, send: true });
  timers.tick(20000);
  await app.edits.idle();
  assert.equal(relay.calls.length, 0);

  await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'changed', send: true });
  assert.equal(app.edits.pending(file), 1);
  assert.deepEqual((await api('/api/send', { send: true })).body, { cancelled: false });
  assert.deepEqual((await api('/api/send', { send: false })).body, { cancelled: true });
  assert.equal(app.edits.pending(file), 0);
  timers.tick(20000);
  await app.edits.idle();
  assert.equal(relay.calls.length, 0);
});

test('the page is told when the edits could not be sent', async (context) => {
  const relay = fakeRelay();
  const { api, app, timers, base, file } = await fixture(context, { relay });
  const live = stream(context, base, file);
  await live.next('ready');
  relay.fail = new Error('inbox is locked');
  await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'changed', send: true });
  timers.tick(20000);
  await app.edits.idle();
  assert.deepEqual(await live.next('sent'), { what: 'edits', count: 1, sent: false, reason: 'error', message: 'inbox is locked' });
  assert.equal((await json(file)).pages[1].en, 'changed', 'the correction itself is saved');

  relay.fail = null;
  await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'changed again', send: true });
  timers.tick(20000);
  await app.edits.idle();
  assert.deepEqual(await live.next('sent'), { what: 'edits', count: 1, sent: true, to: 'executor-alpha', id: 'm1' });
});

// ---- live view and changes --------------------------------------------

test('a change from outside reaches the open page within a second with its words marked, and is logged', async (context) => {
  const { file, base, api } = await fixture(context, { pollMs: 500 });
  const live = stream(context, base, file);
  await live.next('ready');
  const doc = await json(file);
  doc.pages[0].en = doc.pages[0].en.replace('First line here.', 'Opening line here, rewritten.');
  doc.pages.push({ k: 'Intro.New', en: 'A page the agent added', es: 'Una página agregada' });
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
  const started = Date.now();
  const event = await live.next('doc');
  assert.ok(Date.now() - started < 1500, `told after ${Date.now() - started} ms`);
  assert.deepEqual(event.pages.map((p) => p.k), ['Intro.Welcome', 'Intro.Other', 'Intro.New']);
  assert.equal(event.pages[0].en, doc.pages[0].en);
  const welcome = event.changes.find((c) => c.k === 'Intro.Welcome');
  assert.equal(welcome.lang, 'en');
  assert.ok(welcome.runs.some((r) => r.kind === 'delete' && /First/.test(r.text)));
  assert.ok(welcome.runs.some((r) => r.kind === 'insert' && /Opening/.test(r.text)));
  assert.deepEqual(event.changes.filter((c) => c.k === 'Intro.New').map((c) => [c.lang, c.runs]), [['en', [{ kind: 'insert', text: 'A page the agent added' }]], ['es', [{ kind: 'insert', text: 'Una página agregada' }]]]);
  assert.ok(!event.changes.some((c) => c.k === 'Intro.Other'));

  const log = (await readFile(file.replace(/\.json$/, '.versions.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const logged = log.find((v) => v.k === 'Intro.Welcome');
  assert.equal(logged.by, 'outside');
  assert.equal(logged.before, PAGES[0].en);
  assert.equal(logged.after, doc.pages[0].en);
  assert.equal(logged.rev, 0, 'an outside change takes no rev of its own');

  await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'my own correction' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(live.events.filter((e) => e.event === 'doc').length, 1, 'the person\'s own save is not a change from outside');
});

test('an agent writing from an older copy is repaired and only its own change is told', async (context) => {
  const { file, base, api, app } = await fixture(context);
  const live = stream(context, base, file);
  await live.next('ready');
  const stale = await json(file);
  await api('/api/save', { k: 'Intro.Welcome', lang: 'es', text: 'Corrección de la persona' });
  stale.pages[1].en = 'Other page, rewritten by the agent';
  await writeFile(file, JSON.stringify(stale, null, 2) + '\n');
  const event = await live.next('doc');
  assert.deepEqual(event.changes.map((c) => [c.k, c.lang]), [['Intro.Other', 'en']]);
  assert.equal(event.pages[0].es, 'Corrección de la persona', 'the person\'s save was put back');
  assert.equal((await json(file)).pages[0].es, 'Corrección de la persona');
  void app;
});

test('a comment written into the comments file from outside reaches the open page', async (context) => {
  const { file, base, api, comments } = await fixture(context);
  await api('/api/comment', { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'Question', send: false });
  const live = stream(context, base, file);
  await live.next('ready');
  const saved = await json(comments);
  saved.threads[0].messages.push({ author: 'executor-alpha', at: '2026-10-09T10:00:00.000Z', text: 'Answer' });
  await writeFile(comments, JSON.stringify(saved, null, 2) + '\n');
  const event = await live.next('comments');
  assert.deepEqual(event.threads[0].messages.map((m) => m.author), ['person', 'executor-alpha']);
  assert.deepEqual(event.threads[0].place, { start: 8, end: 24, exact: true });
  await api('/api/comment', { op: 'status', id: saved.threads[0].id, status: 'resolved' });
  assert.equal((await live.next('comments')).threads[0].status, 'resolved', 'the person\'s own comment reaches every page');
});

test('the changes view diffs each page against its previous version from the history', async (context) => {
  const { file, base, api } = await fixture(context);
  const live = stream(context, base, file);
  await live.next('ready');
  assert.deepEqual((await api('/api/changes')).body, { pages: [] });
  await api('/api/save', { k: 'Intro.Other', lang: 'es', text: 'Otra página, corregida' });
  await api('/api/save', { k: 'Intro.Other', lang: 'es', text: 'Otra página, corregida dos veces' });
  const doc = await json(file);
  doc.pages[0].en = doc.pages[0].en.replace('First line here.', 'Opening line here.');
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
  await live.next('doc');
  const { pages } = (await api('/api/changes')).body;
  assert.deepEqual(pages.map((p) => [p.k, p.index]), [['Intro.Welcome', 0], ['Intro.Other', 1]]);
  const [outside] = pages[0].texts;
  assert.deepEqual([outside.lang, outside.by], ['en', 'outside']);
  assert.ok(outside.runs.some((r) => r.kind === 'insert' && /Opening/.test(r.text)) && outside.runs.some((r) => r.kind === 'delete' && /First/.test(r.text)));
  const [own] = pages[1].texts;
  assert.deepEqual([own.lang, own.by], ['es', 'person']);
  assert.deepEqual(own.runs.filter((r) => r.kind !== 'equal'), [{ kind: 'insert', text: ' dos veces' }], 'against the version before the last save, not the original');
});

// ---- the server's doors -------------------------------------------------

test('the new routes refuse a foreign host, a foreign origin and the files they do not serve', async (context) => {
  const { api, base, file, comments } = await fixture(context);
  const route = `/api/comment?file=${encodeURIComponent(file)}`;
  const body = { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'x' };
  assert.equal((await request('POST', base, route, body, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await request('POST', base, route, body, { Origin: base, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('POST', base, route, body, {})).status, 403);
  assert.equal((await request('POST', base, `/api/send?file=${encodeURIComponent(file)}`, { send: false }, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await request('GET', base, `/api/doc?file=${encodeURIComponent(file)}`, undefined, { Host: 'evil.example' })).status, 403);
  assert.equal((await request('GET', base, `/api/events?file=${encodeURIComponent(file)}`, undefined, { Host: 'evil.example' })).status, 403);
  await assert.rejects(readFile(comments), { code: 'ENOENT' }, 'a refused comment writes nothing');
  for (const refused of [comments, file.replace(/\.json$/, '.orig.json'), 'relative.json', file.replace(/\.json$/, '.txt')]) {
    assert.equal((await request('GET', base, `/api/doc?file=${encodeURIComponent(refused)}`)).status, 400);
  }
  assert.equal((await api('/api/doc')).status, 200);
});

test('a comment reaches the agent through the person channel of Relay', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-void-relay-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  const repo = path.join(root, 'alpha');
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'machines'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'projects', 'alpha', 'state'), { recursive: true });
  await mkdir(path.join(mind, 'user', 'relay', 'wake', 'policies'), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n- web: alpha\n\n## Projects\n- alpha (web)\n');
  await writeFile(path.join(mind, 'user', 'machines', 'TESTBOX.md'), `machine: TESTBOX\n\n## Paths\n- alpha: ${repo}\n`);
  await writeFile(path.join(mind, 'user', 'state', 'overseer.md'), 'unit: overseer\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nManaging.\n');
  await writeFile(path.join(mind, 'user', 'projects', 'alpha', 'state', 'executor-alpha.md'), 'unit: executor-alpha\nstate: in\nmachine: TESTBOX\ndate: 2026-10-05 10:00\n\nWorking on alpha.\n');
  await writeFile(path.join(mind, 'user', 'relay', 'wake', 'policies', `${'a'.repeat(64)}.json`), JSON.stringify({ enabled: true, pausedReason: null, deadlineAt: null, binding: { unit: 'executor-alpha' } }));
  const file = path.join(repo, 'handbook.json');
  await writeFile(file, JSON.stringify({ title: 'Handbook', pages: structuredClone(PAGES) }));
  const relay = await createPersonRelay({ mindPath: mind, tool: 'void-lite', hostname: 'TESTBOX' });
  const app = createVoid({ port: 0, mindPath: mind, hostname: 'TESTBOX', relay });
  const { port } = await app.listen();
  context.after(() => app.close());
  const base = `http://localhost:${port}`;
  const route = `/api/doc?file=${encodeURIComponent(file)}`;
  assert.deepEqual((await request('GET', base, route)).body.agent, { unit: 'executor-alpha', awake: true });
  const added = await request('POST', base, `/api/comment?file=${encodeURIComponent(file)}`, { op: 'add', ...select(PAGES[0].en, 'First line here.'), text: 'Reword this.', send: true }, { Origin: base });
  assert.deepEqual([added.body.sent.sent, added.body.sent.to], [true, 'executor-alpha']);
  const inbox = path.join(mind, 'user', 'projects', 'alpha', 'inbox', 'executor-alpha');
  const [name] = await readdir(inbox);
  const message = await readFile(path.join(inbox, name), 'utf8');
  assert.match(message, /^from: master$/m);
  assert.match(message, /^subject: Void comment: Handbook \/ Intro\.Welcome$/m);
  assert.ok(message.includes(file.replace(/\.json$/, '.comments.json')));
  assert.match(message, /> First line here\./);
});

test('two changes to one text are joined where they do not touch', () => {
  const base = 'The first line stays.\nThe middle line is plain.\nThe last line ends.';
  assert.equal(merge(base, base.replace('first', 'opening'), base.replace('last', 'final')), 'The opening line stays.\nThe middle line is plain.\nThe final line ends.');
  assert.equal(merge(base, base, base.replace('last', 'final')), base.replace('last', 'final'));
  assert.equal(merge(base, base.replace('last', 'final'), base), base.replace('last', 'final'));
  assert.equal(merge(base, 'Same.', 'Same.'), 'Same.');
  assert.equal(merge(base, base.replace('middle', 'center'), base.replace('middle', 'centre')), null, 'both changed the same words');
  assert.equal(merge('One.', 'One. Mine.', 'One. Theirs.'), null, 'both added at the same place');
  assert.equal(merge('<b>Title</b>\nBody text.', '<b>Title</b>\nBody text, mine.', '<b>New title</b>\nBody text.'), '<b>New title</b>\nBody text, mine.');
});

test('a save made from an older text keeps the change that arrived from outside', async (context) => {
  const { api, file } = await fixture(context);
  const base = PAGES[0].en;
  const outside = await json(file);
  outside.pages[0].en = base.replace('First line here.', 'Opening line here.');
  await writeFile(file, JSON.stringify(outside, null, 2) + '\n');
  const mine = base.replace('Second paragraph', 'Second long paragraph');
  const saved = await api('/api/save', { k: 'Intro.Welcome', lang: 'en', text: mine, base });
  assert.equal(saved.body.text, base.replace('First line here.', 'Opening line here.').replace('Second paragraph', 'Second long paragraph'));
  assert.equal((await json(file)).pages[0].en, saved.body.text);
  const history = (await readFile(file.replace(/\.json$/, '.versions.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(history.at(-1).before, base.replace('First line here.', 'Opening line here.'), 'the save is logged against the text the file held');

  const clash = await json(file);
  clash.pages[0].en = clash.pages[0].en.replace('Opening line here.', 'Another opening.');
  await writeFile(file, JSON.stringify(clash, null, 2) + '\n');
  const typed = saved.body.text.replace('Opening line here.', 'My opening.');
  const lost = await api('/api/save', { k: 'Intro.Welcome', lang: 'en', text: typed, base: saved.body.text });
  assert.equal(lost.body.text, typed, 'where both changed the same words, the person\'s text stays');

  const plainSave = await api('/api/save', { k: 'Intro.Other', lang: 'en', text: 'Straight save', base: PAGES[1].en });
  assert.equal(plainSave.body.text, 'Straight save', 'a text the file still holds as it was needs no joining');
});

test('Void Lite keeps off the ports of the Void product, Blueprint Lite and the Relay examples, and its document names the same one', async () => {
  assert.equal(DEFAULT_PORT, 3302);
  assert.equal([3300, 3301, 4096].includes(DEFAULT_PORT), false);
  const feature = await readFile(fileURLToPath(new URL('../features/void/void.md', import.meta.url)), 'utf8');
  const named = [...feature.matchAll(/(?:localhost|127\.0\.0\.1):(\d+)/g)].map((match) => Number(match[1]));
  assert.ok(named.length > 0);
  assert.deepEqual([...new Set(named)], [DEFAULT_PORT]);
});

test('a port that is taken is reported with what to do, on the loopback and with --lan', async (context) => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  context.after(() => holder.close());
  const { port } = holder.address();
  assert.match(startupMessage(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }), port), new RegExp(`Port ${port} is in use.*--port <number>`));
  assert.match(startupMessage(Object.assign(new Error('denied'), { code: 'EACCES' }), port), /--port <number>/);
  assert.equal(startupMessage(new Error('something else'), port), null);

  const { mind } = await fixture(context);
  for (const lan of [false, true]) {
    const app = createVoid({ port, lan, mindPath: mind, hostname: 'TESTBOX', relay: fakeRelay() });
    await assert.rejects(app.listen(), { code: 'EADDRINUSE' }, `lan ${lan}`);
    await app.close();
  }

  const server = fileURLToPath(new URL('../features/void/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [server, '--port', String(port), '--mind', mind], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await Promise.race([
    new Promise((resolve) => child.once('exit', (...args) => resolve(args))),
    new Promise((_, reject) => setTimeout(() => { child.kill(); reject(new Error('the server neither started nor stopped')); }, 15000)),
  ]);
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`Port ${port} is in use`));
});

test('a long text with accents is saved as it was written', async (context) => {
  const { api, file } = await fixture(context);
  const text = 'Párrafo con acentos y ñandúes. '.repeat(6000);
  const saved = await api('/api/save', { k: 'Intro.Other', lang: 'es', text });
  assert.equal(saved.status, 200);
  assert.equal((await json(file)).pages[1].es, text);
});
