// Shared preparation for the Settings, service and phone captures (rows 6 and 7 of the T064 list).
// Everything here is what a reach step presupposes (a reported agent list, a second machine, standing approvals, a
// task awaiting review, an open home grant) or a fault the step names. The state itself is reached through the GUI.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSettingsOwner, publishMachineSettings } from '../../engine/service/settings.mjs';
import { writeBeat } from '../../engine/service/service.mjs';
import { servicePaths } from '../../engine/service/paths.mjs';
import { createStore } from '../../engine/service/store.mjs';
import { acceptRepositories, agentCredential, choice, createAgent, createOverseer } from './seed.mjs';
import { placeNodes } from './map-helpers.mjs';

export const LOCAL = 'DESKTOP';
export const OTHER = 'LAPTOP';

// The core runs on an injected clock (12:00 on 10 October 2026) and the page on the real one. Home access
// expires on the core clock, so the page clock is moved to the core clock before the app loads. Later core
// advances move the page clock too (advanceClocks). Only Date is moved; timers keep the real pace.
export async function alignPageClock(ctx) {
  const offset = ctx.world.fx.fixture.clock.now - Date.now();
  ctx.clockOffset = offset;
  await ctx.page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const Real = Date; const state = window.__captureClock = { offset: ${offset} };
    class Aligned extends Real {
      constructor(...args) { if (args.length === 0) super(Real.now() + state.offset); else super(...args); }
      static now() { return Real.now() + state.offset; }
    }
    window.Date = Aligned;
  })();` });
}

// Pass time on the core clock and on the page clock together.
export async function advanceClocks(ctx, ms) {
  ctx.advance(ms);
  ctx.clockOffset = (ctx.clockOffset ?? 0) + ms;
  await ctx.page.eval(offset => { if (window.__captureClock) window.__captureClock.offset = offset; }, ctx.clockOffset);
}

// ---- clients: the Agents tab and the review dialog ----------------------------------------------------------

// Five clients in the sample order; versions as a scan reports them, Copilot not installed.
const VERSIONS = { claude: '2.6.1', codex: '0.159.3', cursor: '2026.10.01', opencode: '1.4.0' };
const APPS = { claude: { name: 'Claude app', connected: true }, codex: { name: 'Codex app', available: true }, cursor: { name: 'Cursor editor', available: true } };
export const agentProbe = {
  probeAgents: async () => Object.fromEntries(Object.entries(VERSIONS).map(([id, version]) => [id, { installed: true, version }])),
  probeApps: async id => APPS[id] ?? null,
};

// A small kit the Content tab and the client plans read: the sample's features and knowledge packs.
const FEATURES = { planning: ['plan', 'brainstorm', 'task'], quality: ['qa', 'tribunal', 'cyberattack'], continuity: ['relay', 'catchup', 'docs'] };
export async function writeKit(fixture) {
  const kit = path.join(fixture.root, 'kit');
  await mkdir(path.join(kit, 'features'), { recursive: true });
  for (const [category, names] of Object.entries(FEATURES)) for (const name of names) {
    await writeFile(path.join(kit, 'features', `${name}.md`), `---\nname: ${name}\ncategory: ${category}\n---\n\n# ${name}\n`);
  }
  for (const name of ['security', 'design', 'copy', 'coding']) {
    await mkdir(path.join(kit, 'knowledge', name), { recursive: true });
    await writeFile(path.join(kit, 'knowledge', name, 'INDEX.md'), `# ${name}\n`);
  }
  await writeFile(path.join(kit, 'package.json'), JSON.stringify({ name: 'fixture-kit', files: ['features/', 'knowledge/'] }));
  return kit;
}

// Connect a client's command line through the review and apply calls the dialog makes. `git` also takes the optional
// permission (scoped git commit and git push for sessions HIVEM1ND starts).
export async function connectClient(world, client, mode = 'auto', { git = false } = {}) {
  const preview = await world.call('POST', `/settings/agents/${client}/preview`, { machine: LOCAL, mode, target: 'cli', allowGit: false }, { key: world.key() });
  const changeIds = preview.changes.filter(change => git || !change.optional).map(change => change.id);
  return world.call('POST', `/settings/agents/${client}/apply`, { machine: LOCAL, previewId: preview.previewId, changeIds, expectedRevision: preview.revision }, { key: world.key() });
}

// A second machine whose last report and last beat are already on the shared M1ND, three hours old and stopped.
// It runs before the core boots; its own owner signs the report and the actual core reads it unchanged.
export async function offlineMachine(fixture, { projects = ['blog'] } = {}) {
  const local = path.join(fixture.root, 'laptop-local'), home = path.join(fixture.root, 'laptop-home');
  await mkdir(local, { recursive: true });
  await mkdir(home, { recursive: true });
  const earlier = () => fixture.clock.now - 3 * 3600000;
  const paths = servicePaths({ platform: fixture.platform, env: fixture.env, home: fixture.home, mindPath: fixture.paths.mind, machine: OTHER, originPath: fixture.paths.origin });
  await mkdir(paths.localDirectory, { recursive: true });
  const store = createStore({ root: fixture.root, mindPath: fixture.paths.mind, localDirectory: paths.localDirectory, confineRoot: fixture.root, now: earlier });
  store.aclRunner = fixture.store.aclRunner;
  const owner = createSettingsOwner({ store, paths, now: earlier, homeDir: home, env: { PATH: '' },
    projects: projects.map(name => ({ name, localPath: path.join(fixture.home, 'Web', name) })),
    probeAgents: async () => ({ codex: { installed: true, version: '0.150.0' }, claude: { installed: true, version: '2.5.0' } }),
    probeApps: async () => null });
  owner.active = false;
  await publishMachineSettings(owner);
  await writeBeat({ store, paths, now: earlier }, 'stopped');
  return owner;
}

// The options every Settings case boots with: client probes and the small kit; `laptop` adds the offline machine.
export function settingsBoot({ laptop = false, extra = null } = {}) {
  return { prepare: async fixture => {
    if (laptop) await offlineMachine(fixture);
    return { ...agentProbe, kitPath: await writeKit(fixture), ...(await extra?.(fixture) ?? {}) };
  } };
}

// ---- the desktop world ---------------------------------------------------------------------------------------

// The Map the Settings screens sit in front of: accepted repositories, a few agents, the Overseer, connected clients.
export async function seedDesktop(ctx, { connected = true, overseer = true } = {}) {
  const { world } = ctx;
  await alignPageClock(ctx);
  const clusters = await acceptRepositories(world, ['shop', 'api-gateway', 'blog']);
  const byName = Object.fromEntries(clusters.map(cluster => [cluster.title, cluster]));
  const agents = {
    overlordShop: await createAgent(world, byName.shop.id, 'overlord', choice),
    executorShop: await createAgent(world, byName.shop.id, 'executor', choice),
    overlordApi: await createAgent(world, byName['api-gateway'].id, 'overlord', choice),
    executorBlog: await createAgent(world, byName.blog.id, 'executor', choice),
  };
  if (overseer) await createOverseer(world, choice);
  await placeNodes(world);
  if (connected) for (const [client, mode] of [['claude', 'auto'], ['codex', 'auto'], ['opencode', 'on-demand']]) await connectClient(world, client, mode);
  return { clusters: byName, agents };
}

// Open the app on the actual core. The Overseer exists, so the page storage holds the person's earlier Later.
export const openDesktop = ctx => ctx.open({ overseerExists: true });

// Open Settings through the gear, like the person does, and wait until the sections have been read.
export async function openSettings(ctx, tab = 'general') {
  const { page } = ctx;
  await ctx.visible('[data-action="open-settings"]');
  await page.click('[data-action="open-settings"]');
  await ctx.visible('[data-settings]');
  await page.waitFor(() => {
    const panel = document.querySelector('[data-settings]');
    return Boolean(panel?.querySelector('[data-settings-page]')) && !panel.querySelector('p[role="status"]:not(.settings-offline):not(.settings-toast)');
  }, { timeout: 30000, message: 'the Settings sections to be read' });
  if (tab !== 'general') {
    await page.click(`[data-settings-tab="${tab}"]`);
    await ctx.visible(`[data-settings-page="${tab}"]`);
  }
}

// ---- standing approvals -------------------------------------------------------------------------------------

// A standing approval is "Always for this unit" on one exact command: the agent asks, the person answers Always.
export async function standingApproval(world, unitId, command, cwd) {
  const credential = agentCredential(world, unitId);
  const asked = await world.call('POST', '/approvals/request', { action: 'process.run', pattern: { command, cwd }, display: `Run ${command}`, alwaysAllowed: true }, { key: world.key(), credential });
  const detail = await world.call('GET', `/approvals/${asked.approval.id}`);
  return world.call('POST', `/approvals/${asked.approval.id}/answer`, { decision: 'approve-always', expectedRevision: detail.revision }, { key: world.key() });
}

// ---- the home network and the phone -------------------------------------------------------------------------

// Open home access through the core (what the person's earlier press of Open on the phone did) and, optionally, sign
// phones in through the home listener with the code. Nothing returned here is ever printed or stored.
export async function openHome(world, { phones = 0 } = {}) {
  const grant = await world.call('POST', '/settings/home-network', { enabled: true }, { key: world.key() });
  const origin = grant.addresses[0].origin;
  const tokens = [];
  for (let index = 0; index < phones; index += 1) tokens.push((await homeExchange(origin, { code: grant.shortCode })).token);
  return { grant, origin, tokens };
}

export async function homeExchange(origin, secret) {
  const response = await fetch(`${origin}/api/v1/auth/home`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(secret) });
  const json = await response.json();
  if (response.status !== 200) throw new Error(`POST /auth/home: ${response.status} ${json?.error?.code ?? ''}`);
  return json.data;
}

// ---- a stopped service --------------------------------------------------------------------------------------

// The recovery bridge the verified launcher offers a viewer (gui/index.mjs attachRecoveryHost): GET /status says
// whether the owned service runs, POST /recover would start it. It is bound to the viewer the runner created.
export async function startRecoveryBridge(ctx, recoveryHosts) {
  const { world } = ctx;
  const token = `capture-${world.key()}`;
  const state = { stopped: false };
  const server = createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': world.origin, vary: 'Origin' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': world.origin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'Authorization, Content-Type', vary: 'Origin' });
      res.end(); return;
    }
    if (req.headers.origin !== world.origin || req.headers.authorization !== `Bearer ${token}`) { reply(403, { error: { code: 'forbidden' } }); return; }
    if (req.method === 'GET' && req.url === '/status') { reply(200, { state: state.stopped ? 'stopped' : 'running' }); return; }
    reply(503, { error: { code: 'service_unavailable' } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  ctx.defer(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const viewerId = world.core.credentials.verify(world.token).viewerId;
  recoveryHosts.set(viewerId, { origin: `http://127.0.0.1:${server.address().port}`, token });
  return { state, viewerId };
}
