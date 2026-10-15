import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createNativeAdapter } from '../../engine/service/adapters.mjs';
import { uuidV8 } from '../../engine/service/identity.mjs';
import { acceptRepositories, agentCredential, choice, createAgent, createOverseer } from './seed.mjs';
import { placeNodes } from './map-helpers.mjs';

// Preconditions and shared GUI steps for the chat references (rows 3.x). Everything here is written through the
// actual core's HTTP API (or, for what only a native client or another machine produces, the record that client or
// machine would write); the states themselves are reached through the GUI.

export const claudeChoice = { client: 'claude', model: 'observed', effort: 'high', mode: null };
export const SHOP_EXECUTOR = 'project:shop:executor-shop';
export const SHOP_EXECUTOR_2 = 'project:shop:executor-shop-2';

// The core of the chat cases. The native client is a fixture claude adapter whose protocol opens one Bash tool call
// (the Work tab then has a real native step); the wake transport submits a message only to a unit that has a live
// session, which is what the native delivery does, so a unit without one keeps "Sent, awaiting delivery".
export const chatsBoot = {
  async prepare(fixture) {
    const live = new Set();
    fixture.liveUnits = live;
    const thread = randomUUID();
    return {
      wake: { notify: async notice => (live.has(notice.unitId) ? { state: 'submitted' } : { state: 'pending', error: 'no_live_session' }) },
      adapters: {
        claude: createNativeAdapter('claude', {
          fixture: true, models: ['observed', 'alternate'], efforts: ['high', 'xhigh'],
          transcript: [
            JSON.stringify({ type: 'system', subtype: 'init', session_id: thread }),
            JSON.stringify({ type: 'assistant', session_id: thread, message: { content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'npm test' } }] } }),
          ],
        }),
      },
    };
  },
};

// Accepted shop and blog repositories, the Overseer, executor-shop and executor-shop-2, and the saved layout the Map
// needs (the core stores position 0,0 for new units, which would stack the circles). Returns the units and the chat
// of executor-shop.
export async function seedChats(world, { first = choice, second = choice, overseer = true } = {}) {
  const clusters = await acceptRepositories(world, ['shop', 'blog']);
  const shop = clusters.find(cluster => cluster.title === 'shop'), blog = clusters.find(cluster => cluster.title === 'blog');
  if (overseer) await createOverseer(world);
  // The cluster chat is answered by its lead; with two executors and no Overlord it would not know who plans.
  const lead = await createAgent(world, shop.id, 'overlord', choice);
  const a = await createAgent(world, shop.id, 'executor', first);
  const b = await createAgent(world, shop.id, 'executor', second);
  await placeNodes(world);
  const chat = await world.call('POST', '/chats', { members: [a.id] });
  return { shop, blog, lead, a, b, chat };
}

export const say = (world, chatId, body, credential = null) => world.call('POST', `/chats/${chatId}/messages`, { body }, credential ? { credential } : {});
export const unitToken = (world, unit, sessionId) => agentCredential(world, unit.id ?? unit, sessionId);

// The recipient's explicit read: only the agent's own credential can acknowledge its own messages.
export async function readAs(world, chatId, unit, messageIds, sessionId) {
  return world.call('POST', `/chats/${chatId}/read`, { messageIds }, { credential: unitToken(world, unit, sessionId) });
}

export const messagesOf = async (world, chatId) => (await world.call('GET', `/chats/${chatId}/messages`)).items;

export async function pinChat(world, chat) {
  const current = await world.call('GET', `/chats/${chat.id}`);
  return world.call('PATCH', `/chats/${chat.id}`, { pinned: true, expectedRevision: current.revision });
}

// An approval request made by the agent itself (build command, one exact approval, with Always offered).
export function askBuild(world, unit, chatId, display = 'npm run build', sessionId) {
  return world.call('POST', '/approvals/request', { action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop' }, display, alwaysAllowed: true, chatId },
    { credential: unitToken(world, unit, sessionId) });
}

// A task the unit delivered for review: the lead approved it, so the person can accept or send it back.
export async function reviewTask(world, unit, number, title, { scope = 'shop', lead = 'overlord-shop' } = {}) {
  const id = `project:${scope}:${number}`, directory = path.join(world.mind, 'user', 'projects', scope, 'tasks');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${number}.md`), `id: ${id}\ntitle: ${title}\nstatus: review\nfrom-id: root:master\nto-id: ${unit.id}\ndate: 2026-10-10 11:00\n\n## Request\nBuild it.\n\n## Report\nDelivered.\nApproved for review by ${lead} on 2026-10-10 11:00\n`);
  return id;
}

// A live chat session of an executor started through the actual core (fixture claude client) and the activity its
// native hook reports: the registration the core wrote is rewritten as busy with the core's own clock.
// A command step in the fixture transcript, so Work has a row. The thread id is the one the launch is about to mint.
export function noteWorkStep(world) {
  world.fx.fixture.sessionObservations = threadId => [JSON.stringify({
    method: 'item/started', params: { threadId, item: { id: 'build-step', type: 'commandExecution' } },
  })];
}

export async function startSession(world, unit, { busy = true } = {}) {
  const current = await world.call('GET', `/units/${encodeURIComponent(unit.id)}`);
  const started = await world.call('POST', `/units/${encodeURIComponent(unit.id)}/session`, { expectedRevision: current.revision, runMode: 'chat' });
  let request;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    request = await world.call('GET', `/session-requests/${started.requestId}`);
    if (request.state === 'started') break;
    if (['failed', 'expired', 'canceled'].includes(request.state)) throw new Error(`The session of ${unit.id} did not start: ${request.state} ${request.error?.code ?? ''}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (request.state !== 'started') throw new Error(`The session of ${unit.id} did not start in time.`);
  world.fx.fixture.liveUnits?.add(unit.id);
  if (busy) await setActivity(world, request.sessionId, 'busy');
  return { sessionId: request.sessionId, requestId: started.requestId };
}

export async function setActivity(world, sessionId, activity) {
  const directory = path.join(world.mind, 'user', 'relay', 'sessions');
  for (const name of await readdir(directory)) {
    const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    if (record.sessionId !== sessionId) continue;
    await writeFile(path.join(directory, name), JSON.stringify({ ...record, activity, activityObservedAt: new Date(world.fx.fixture.clock.now).toISOString() }));
    return;
  }
  throw new Error(`No registration for session ${sessionId}.`);
}

// The page's clock follows the core's injected clock (2026-10-10 12:00 UTC), so "now", elapsed minutes and undo windows
// agree with the times the core wrote. `ctx.advance(ms)` on the core is mirrored with `moveClock(ctx, ms)`.
export async function alignClock(ctx, aheadMs = 0) {
  const base = ctx.world.fx.fixture.clock.now + aheadMs;
  const source = `(() => { const Real = Date, offset = ${base} - Real.now(); const clock = window.__hm = { offset };
    class Shifted extends Real { constructor(...args) { super(...(args.length ? args : [Real.now() + clock.offset])); } static now() { return Real.now() + clock.offset; } }
    window.Date = Shifted; })()`;
  await ctx.page.send('Page.addScriptToEvaluateOnNewDocument', { source });
}

export async function moveClock(ctx, ms) {
  ctx.advance(ms);
  await ctx.page.eval(delta => { if (window.__hm) window.__hm.offset += delta; }, ms);
}

// Open the app on a world whose Overseer exists, with the clock aligned, and wait until the named units are listed.
export async function openChats(ctx, unitIds, { ahead = 0 } = {}) {
  await alignClock(ctx, ahead);
  await ctx.open({ overseerExists: true });
  await ctx.page.waitFor(ids => ids.every(id => document.querySelector(`[data-row][data-id="${id}"]`)) && document.querySelector('[data-action="tab-hierarchy"][aria-pressed="true"]'),
    { args: [unitIds], timeout: 30000, message: 'the Hierarchy to list the units' });
}

// Select a tab of the side column and wait for its list; the click is repeated if the shell repainted over it.
export async function showTab(ctx, tab, rowSelector) {
  const { page } = ctx;
  await page.waitFor(async (name, row) => {
    const button = document.querySelector(`[data-action="tab-${name}"]`);
    if (!button) return false;
    if (button.getAttribute('aria-pressed') !== 'true') { button.click(); return false; }
    return Boolean(document.querySelector(row));
  }, { args: [tab, rowSelector], timeout: 30000, message: `the ${tab} tab with its rows` });
}

export const chatRow = id => `[data-row][data-id="${id}"]`;

// Click a conversation row and wait until its transcript is the open one.
export async function openChatRow(ctx, chatId, messages = 1) {
  await ctx.page.click(chatRow(chatId));
  await ctx.page.waitFor((id, count) => document.querySelectorAll(`.transcript[data-chat="${id}"] [data-message]`).length >= count, { args: [chatId, messages], timeout: 30000, message: 'the conversation transcript' });
}

// Select a unit in the Hierarchy the way a person does and wait for its inspector (conversation and facts).
export async function openUnit(ctx, unit, messages = 1) {
  await ctx.page.click(chatRow(unit.id));
  await ctx.page.waitFor((id, count) => document.querySelectorAll(`.inspector .transcript [data-message]`).length >= count
    && document.querySelector(`.map-node[data-unit-id="${id}"]`)?.classList.contains('is-selected'), { args: [unit.id, messages], timeout: 30000, message: 'the unit inspector with its conversation' });
}

// An executor of the blog cluster owned by the LAPTOP, which is offline: its state file names the other machine, its
// Relay registered a manual-app session three hours ago and its service beat stopped answering (what the synced M1ND
// holds for another machine). Returns the unit.
export async function seedLaptopAgent(world, blog, { app = true } = {}) {
  const unit = await createAgent(world, blog.id, 'executor', choice);
  const file = path.join(world.mind, 'user', 'projects', unit.scope.name, 'state', `${unit.unit}.md`);
  const text = await readFile(file, 'utf8');
  if (!/^machine: DESKTOP$/m.test(text)) throw new Error(`The state of ${unit.id} has no machine line to hand to the LAPTOP.`);
  await writeFile(file, text.replace(/^machine: DESKTOP$/m, 'machine: LAPTOP'));
  const now = world.fx.fixture.clock.now, before = new Date(now - 3 * 3600000).toISOString();
  const nativeSessionId = 'laptop-app-session';
  if (app) {
    await mkdir(path.join(world.mind, 'user', 'relay', 'sessions'), { recursive: true });
    await writeFile(path.join(world.mind, 'user', 'relay', 'sessions', `${randomUUID()}.json`), JSON.stringify({
      kind: 'registration', registrationId: randomUUID(), instanceId: 'relay-LAPTOP', sessionId: uuidV8(['session', 'LAPTOP', 'claude', nativeSessionId, unit.id]),
      unit: unit.unit, unitId: unit.id, scopeId: unit.scope.id, nativeSessionId, client: 'claude', machine: 'LAPTOP', registeredAt: before,
      activity: 'idle', activityObservedAt: before, quota: null, quotaObservedAt: null, runMode: 'chat', taskId: null, launchKind: 'manual-app',
    }));
  }
  const machines = path.join(world.fx.fixture.paths.origin, 'machines', 'LAPTOP');
  await mkdir(machines, { recursive: true });
  await writeFile(path.join(machines, 'service.json'), JSON.stringify({ machine: 'LAPTOP', state: 'running', version: '3.0.0', heartbeatAt: before, clients: [{ id: 'claude', enabled: true, installed: true }] }));
  return unit;
}

// A unit counts as having a live session for the wake transport (a session started through the API is marked by
// startSession; this marks a unit whose native session the case does not need to open).
export const markLive = (world, unit) => world.fx.fixture.liveUnits.add(unit.id);

// A child command line requested by an agent from its live chat session: one exact approval to open the unit's stored
// client on this machine.
export function askSession(world, unit, sessionId, child, client = 'codex', machine = 'DESKTOP') {
  return world.call('POST', '/approvals/request', { action: 'session.open', pattern: { client, machine, unitId: child.id, runMode: 'chat', taskId: null }, display: 'Open another CLI', alwaysAllowed: false },
    { credential: unitToken(world, unit, sessionId) });
}

// The pending request of a held POST: the page's request for a message of a chat is held (or its acknowledgment lost).
export const sendsMessage = request => request.method === 'POST' && /\/chats\/[^/]+\/messages$/.test(new URL(request.url).pathname);
