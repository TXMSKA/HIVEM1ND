import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from 'node:zlib';
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { createApi, createOperation, dispose as disposeApi, request, retryOperation } from "../gui/app/api.mjs";
import { answerApproval, changeTaskStatus, createGroup, createUnit, removeUnit, setUnitAlias, startSession, undoTask } from "../gui/app/actions.mjs";
import { createThread, markMailboxRead, openDirectChat, postMessage } from "../gui/app/chats.mjs";
import { dispose as disposeEmbed, handleParentMessage, publishDirty, publishReady, startEmbedChannel } from "../gui/app/embed.mjs";
import { DICTIONARIES, cardinal, dictionaryKeys, formatClock, formatRecent, formatShortDate, formatShortTime, formatWhen, limitsUsage, text } from "../gui/app/i18n.mjs";
import { encodeHomeQr } from "../gui/app/qr.mjs";
import { canPerform, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "../gui/app/phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, limitsLabel, noteHomeChange, openHome, renderSettings, saveSettings, takeGrant, updateExpiry } from "../gui/app/settings.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { collectPages, createPagedList, loadAll, moveFocus, reloadList, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { flushLayout, graphBounds, queueLayoutPatch, wheelZoom } from "../gui/app/map.mjs";
import { clusterCamera } from "../gui/app/cluster-geometry.mjs";
import { composeCore } from "../engine/service/service.mjs";
import { stopService } from "../engine/service/service.mjs";
import { close as closeStream } from '../gui/app/stream.mjs';
import { checkoutFacts, renderApproval, renderSession, renderUnit, startsFresh } from "../gui/app/inspector.mjs";
import { dispose, knownLanguage, mapButton, maybeStartDiscovery, mount, navigate, presentation, renderBar, renderShell, shellLayout } from "../gui/app/main.mjs";
import { applyReset, createStore, loadSnapshot, startCollection, writeCollection } from "../gui/app/state.mjs";
import { ApiError } from "../gui/app/api.mjs";
import { FIXTURE_HOME_CODE, FIXTURE_HOME_KEY, deterministicUuid } from "./gui-data.mjs";
import { createGuiFixture } from "./gui-fixture.mjs";
import { closeGuiHost, createFolderReopen, startGui } from "../gui/index.mjs";
import { dispose as disposeCoreFixture, makeCoreFixture } from "./core-fixture.mjs";
import { assertVisibleCopy } from "./spanish-register.test.mjs";
import * as startApi from '../gui/app/start-api.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { makePlanFixture } from './service-plans.test.mjs';
import { createPlan, startPlan } from '../engine/service/plans.mjs';
import { createText } from '../engine/service/editors.mjs';
import { callPlanTool, drainRunLaunches, readRun } from '../engine/service/runs.mjs';
import { checkRuns } from '../engine/service/run-supervision.mjs';
import { createHttpServer } from '../engine/service/http.mjs';
import { createEventBus } from '../engine/service/events.mjs';
import { createCredentialStore } from '../engine/service/security.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { createChat, postChat } from '../engine/service/chats.mjs';
import { createContext, readContext } from '../engine/service/context.mjs';
import { registerNative } from '../engine/service/adapters.mjs';
import { refreshPlan } from '../gui/app/plan-controller.mjs';
import { element, restoreRunning } from '../gui/app/components.mjs';
import { initialRunsIn, runsInLabel } from '../gui/app/clusters.mjs';
import { AGENT_ROLES } from '../gui/app/start-copy.mjs';
import { displayName, hierarchyIcon } from '../gui/app/hierarchy.mjs';
import { renderContext } from '../gui/app/session-work.mjs';

test('R057 bar modes, waiting copy, destinations and shared buttons match the final controls', () => {
  const { document, root } = createTestDocument(1440);
  const app = { root, layout: 'desktop', mode: 'map', waitingOpen: false, inspectorOpen: true,
    bootReading: true, bootFailed: false, store: { capabilities: [] } };
  const bar = renderBar(app, (key, values) => text('en', key, values), { waiting: 0 });
  const action = name => bar.querySelector(`[data-action="${name}"]`);
  const modes = ['mode-map', 'mode-blueprint', 'mode-document'].map(actionName => action(actionName));
  assert.deepEqual(modes.map(button => button.getAttribute('data-action')), ['mode-map', 'mode-blueprint', 'mode-document']);
  assert.deepEqual(modes.map(button => button.children.at(-1).textContent), ['Map', 'Blueprint', 'Void']);
  assert.equal(action('waiting'), null);
  assert.ok(action('open-phone'));
  // The bell opens Activity, the list of background work.
  assert.equal(action('open-notifications')?.getAttribute('disabled'), null);
  assert.equal(action('open-notifications').getAttribute('aria-label'), 'Activity');
  assert.notEqual(action('toggle-inspector').children[0].children[0].getAttribute('d'), 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v8M14 12V6.5a1.5 1.5 0 0 1 3 0V15c0 4-2.5 6-6 6');
  assert.equal(text('en', 'voidMode'), 'Void');
  assert.equal(text('en', 'waitingOnYouOther', { count: 2 }), '2 waiting on you');
  assert.equal(text('es', 'waitingOnYouOther', { count: 2 }), '2 pendientes de respuesta');

  const withWaiting = renderBar({ ...app, root: createTestDocument(1440).root, language: 'es' }, (key, values) => text('es', key, values), { waiting: 2 });
  assert.equal(withWaiting.querySelector('[data-action="waiting"]').children.at(-1).textContent, '2 pendientes de respuesta');
  const button = mapButton(app, 'edit', 'Edit', () => {});
  const primary = mapButton(app, 'create', 'Create', () => {}, { class: 'btn primary' });
  const sharedButton = element(document, 'button', { class: 'btn', text: 'Secondary action' });
  assert.equal(button.className, 'btn secondary');
  assert.equal(primary.className, 'btn primary');
  assert.equal(sharedButton.className, 'btn secondary');
});
import { createSettingsOwner } from '../engine/service/settings.mjs';

const PHONE = ["read", "chat.post", "master.read", "approval.answer", "task.accept", "task.send-back"];
const DESKTOP = ["read", "chat.post", "chat.manage", "mailbox.read", "approval.answer", "grant.revoke", "task.status", "task.undo", "unit.create", "unit.connect", "session.start", "session.stop", "layout.write", "settings.write", "home.manage", "editor.read", "editor.write", "comment.write", "proposal.answer", "asset.write", "watch", "viewer.write"];

test("native Blueprint and Void modes show the real app stage, localized connection guidance and bridge stream events", async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const updates = [], events = [], paths = [];
  let status;
  const host = { embeddedUpdate: value => updates.push(value), embeddedEvent: value => events.push(value),
    onEmbeddedStatus(listener) { status = listener; return () => { status = null; }; } };
  const desktop = await bootWithFetch(fixture.desktopUrl, 1440, (url, init) => { paths.push(new URL(url).pathname); return fetch(url, init); }, { hivem1nd: host });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.layout === "desktop", "The native shell did not open.");
  for (const [mode, name] of [["blueprint", "blueprint"], ["document", "void"]]) {
    navigate(desktop.app, mode);
    assert.equal(desktop.root.querySelector("[data-embedded-stage]").getAttribute("data-embedded-stage"), name);
    assert.equal(updates.at(-1).app, name);
    assert.equal(desktop.root.querySelector("[data-editor-column]"), null);
    assert.equal(desktop.root.querySelector("[data-action='toggle-comments']"), null);
    status({ app: name, state: "unavailable" });
    assert.match(desktop.root.querySelector(".embedded-message").querySelector("p").textContent, /Connect to the internet/);
    desktop.app.language = "es"; renderShell(desktop.app);
    assert.match(desktop.root.querySelector(".embedded-message").querySelector("p").textContent, /Conectarse a internet/);
    const before = updates.length; click(desktop.root.querySelector("[data-action='retry-embedded-app']"));
    assert.equal(updates.length, before + 1);
    status({ app: name, state: "ready" });
    assert.equal(desktop.root.querySelector("[data-embedded-state]").getAttribute("data-embedded-state"), "ready");
    desktop.app.language = "en";
  }
  const data = { app: "void", name: "void.files.changed", params: [{ path: "notes.md", kind: "changed", by: "executor" }] };
  await fixture.control.emit("app.bridge", data);
  await waitFor(() => events.length > 0, "The native bridge did not receive the stream event.");
  assert.deepEqual(events.at(-1).envelope.data, data);
  assert.equal(paths.some(path => /\/(?:blueprint\/boards|void\/texts|editors)(?:\/|$)/.test(path)), false);
  navigate(desktop.app, "map"); assert.equal(updates.at(-1).app, null);
});

test('ephemeral app stream events reach the host at the snapshot cursor and while snapshot reads pause', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  let controller, snapshotCursor;
  const forwarded = [], encoder = new TextEncoder();
  const ready = () => {
    if (controller && snapshotCursor) controller.enqueue(encoder.encode(sseFrame('stream.ready', snapshotCursor, { cursor: snapshotCursor, capabilities: DESKTOP })));
  };
  const desktop = await bootWithFetch(fixture.desktopUrl, 1440, async (url, init) => {
    if (new URL(url).pathname === '/api/v1/events') return new Response(new ReadableStream({ start(value) { controller = value; ready(); } }), { headers: { 'content-type': 'text/event-stream' } });
    const response = await fetch(url, init);
    if (new URL(url).pathname === '/api/v1/view') { snapshotCursor = (await response.clone().json()).meta.eventCursor; ready(); }
    return response;
  }, { hivem1nd: { embeddedUpdate() {}, embeddedEvent: event => forwarded.push(event) } });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.layout === 'desktop', 'The native shell did not open.');
  const cursor = desktop.app.store.cursor, separator = cursor.lastIndexOf(':');
  const bus = createEventBus({ startupId: cursor.slice(0, separator) });
  for (let index = 0; index < Number(cursor.slice(separator + 1)); index++) bus.emit({ name: 'unit.changed' });
  bus.subscribe({ stableId: 'ephemeral-native-stream', audience: 'desktop' }, {}, frame => {
    controller.enqueue(encoder.encode(`id: ${frame.id}\nevent: ${frame.name}\ndata: ${JSON.stringify(frame.data)}\n\n`));
  });
  for (const name of ['void.files.changed', 'agents.changed']) bus.emit({ name: 'app.bridge', data: { app: 'void', name, params: [] } });
  await patient(() => forwarded.length === 2, 'Same-cursor app events were dropped.', 2000);
  desktop.app.store.paused = true;
  bus.emit({ name: 'app.bridge', data: { app: 'void', name: 'void.project', params: null } });
  await patient(() => forwarded.length === 3, 'App events were buffered behind a snapshot.', 2000);
  assert.equal(desktop.app.store.cursor, cursor);
  assert.equal(desktop.app.store.buffer.length, 0);
  assert.deepEqual(forwarded.map(event => event.envelope.data.name), ['void.files.changed', 'agents.changed', 'void.project']);
});

test("disposing an API or shell cancels its pending reconnect timer", async t => {
  for (const close of [disposeApi, api => dispose({ api, root: createTestDocument().root })]) {
    const api = createApi({ location: { origin: "http://127.0.0.1:9", hash: "" } });
    let reconnected = false;
    const timer = setTimeout(() => { reconnected = true; }, 0);
    t.after(() => clearTimeout(timer));
    api.live = { stopped: false, timer, controller: new AbortController() };
    api.controllers.add(api.live.controller);
    close(api);
    await delay(0);
    assert.equal(reconnected, false);
    assert.equal(api.live.stopped, true);
    assert.equal(api.live.controller.signal.aborted, true);
    assert.equal(api.controllers.size, 0);
  }
});

test('the browser launcher restores a stopped singleton without losing a draft or duplicating an uncertain send', async t => {
  const fixture = await makeCoreFixture();
  let host;
  let desktop;
  let holdMessageReads = false;
  let releaseMessageReads;
  const messageReads = new Promise(resolve => { releaseMessageReads = resolve; });
  t.after(async () => { releaseMessageReads(); if (desktop) dispose(desktop.app); await host?.stop(); await closeGuiHost(); await disposeCoreFixture(fixture); });
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: 'hivem1nd-service-config-v1', mindPath: fixture.paths.mind, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    machine: fixture.machine, origin: { kind: 'folder', path: join(fixture.root, 'origin') }, stagingPath: fixture.paths.staging, port: 0 }));
  host = await startGui({ mindPath: fixture.paths.mind, env: fixture.env, home: fixture.home, platform: fixture.platform,
    machine: fixture.machine, aclRunner: fixture.store.aclRunner, confineRoot: fixture.root });
  const api = apiFrom(host.url);
  await createUnit(api, { unit: 'overseer', role: 'overseer', scope: 'root', machine: fixture.machine });
  const chat = (await request(api, 'POST', '/chats', { operation: createOperation({ method: 'POST', path: '/chats', body: { members: ['root:overseer'] } }) })).data;
  const sends = [];
  desktop = await bootWithFetch(host.url, 1440, async (input, init) => {
    const response = await fetch(input, init);
    if (init.method === 'POST' && new URL(input).pathname.endsWith('/messages')) {
      sends.push(init.headers['Idempotency-Key']);
      if (sends.length === 1) { await response.arrayBuffer(); throw new Error('The reply was lost after commit.'); }
      releaseMessageReads();
    }
    if (init.method === 'GET' && new URL(input).pathname.endsWith('/messages') && holdMessageReads) await messageReads;
    return response;
  });
  await waitFor(() => desktop.app.recovery && desktop.app.chatList?.catalog?.length, 'The browser bridge did not load.');
  navigate(desktop.app, 'chats');
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The chat did not open.');
  await desktop.app.activity.get(`chat-load:${chat.id}`).localWork;
  // This case proves replay; a late authoritative read must not confirm the send before that replay.
  holdMessageReads = true;
  closeStream(desktop.app.api.live);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Send exactly once', 0, 17);
  click(desktop.root.querySelector('[data-action="send"]'));
  await waitFor(() => desktop.app.api.uncertain.has(sends[0]), 'The uncertain operation was not retained.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Keep this next draft', 3, 8);
  const oldToken = desktop.app.api.token;
  const drafts = desktop.app.store.drafts;
  drafts.set('open-resource', { text: 'Retained resource work' });
  desktop.app.store.selected.resourceId = 'open-resource';
  await stopService(host.service, { force: true });
  desktop.app.store.stream = { state: 'reconnecting' }; renderShell(desktop.app);
  click(desktop.root.querySelector('[data-action="retry-service"]'));
  await waitFor(() => desktop.root.querySelector('[data-service-banner="stopped"]'), 'The owned guard did not confirm the stopped service.');
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep this next draft');
  await clickAndWait(desktop.root.querySelector('[data-action="recover-service"]'));
  await waitFor(() => desktop.app.api.token !== oldToken && desktop.app.thread.pendingSends.size === 0, 'Recovery did not reconcile the original operation.');
  assert.equal(sends.length, 2);
  assert.equal(sends[0], sends[1]);
  assert.equal(desktop.app.thread.messages.filter(message => message.operationId === sends[0]).length, 1);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep this next draft');
  assert.equal(desktop.app.store.selected.chatId, chat.id);
  assert.equal(desktop.app.store.selected.resourceId, 'open-resource');
  assert.equal(desktop.app.store.drafts === drafts, true);
  const copy = [...desktop.document.querySelectorAll('p, span, button')].map(node => node.textContent).join(' ');
  assert.equal(copy.includes(desktop.app.api.token), false);
  assert.equal(copy.includes(host.service.bootstrap.secret), false);
  assert.equal(desktop.app.embed ?? null, null);
  const recoveredToken = desktop.app.api.token;
  navigate(desktop.app, 'settings');
  await desktop.app.settingsState.pending;
  await waitFor(() => desktop.root.querySelector('[data-action="settings-restart"]')?.disabled === false, 'The local service controls did not load.');
  await clickAndWait(desktop.root.querySelector('[data-action="settings-restart"]'));
  await waitFor(() => desktop.app.api.token !== recoveredToken && !desktop.app.recoveryPending, 'Running restart did not renew the desktop credential.');
  assert.equal(host.service.guard.listening, true);
  assert.equal(desktop.app.store.selected.resourceId, 'open-resource');
  assert.equal(desktop.app.store.drafts === drafts, true);
});

test('reconnection never infers a stopped service from a slow response and Details names the existing launcher', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.layout === 'desktop', 'The desktop did not open.');
  desktop.app.selectedFolder = 'C:\\fixtures\\.m1nd';
  desktop.app.store.stream = { state: 'reconnecting', error: 'timeout' };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-service-banner="stopped"]'), null);
  assert.match(desktop.root.querySelector('[data-service-copy]').textContent, /What you do is kept/);
  assert.equal(desktop.root.querySelector('[data-action="retry-service"]').textContent, 'Retry now');
  desktop.app.store.stream = { state: 'error', error: 'reconnect_exhausted' };
  renderShell(desktop.app);
  click(desktop.root.querySelector('[data-action="service-details"]'));
  const details = [...desktop.document.querySelector('[data-service-details]').querySelectorAll('p')].map(node => node.textContent).join(' ');
  assert.match(details, /onem1nd service install --mind-path/);
  assert.equal(details.includes(desktop.app.api.token), false);
  desktop.document.querySelector('[data-service-details]').close();
  desktop.app.language = 'es'; desktop.app.serviceStopped = true; renderShell(desktop.app);
  assert.match(desktop.root.querySelector('[data-service-copy]').textContent, /El servicio Relay se detuvo/);
  assert.equal(desktop.root.querySelector('[data-action="recover-service"]').textContent, 'Reiniciar el servicio');
});

test('phone reconnection requires pairing after restart and never invokes desktop recovery', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  let expired = false;
  let recoveries = 0;
  const phone = await bootWithFetch(fixture.phoneUrl, 390, (input, init) => expired && new URL(input).pathname.endsWith('/events')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'invalid_session' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    : fetch(input, init), { recovery: { async recoverService() { recoveries++; }, async serviceStatus() { return { state: 'stopped' }; } } });
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.layout === 'phone', 'The phone did not pair.');
  closeStream(phone.app.api.live);
  expired = true;
  phone.app.store.stream = { state: 'error' }; renderShell(phone.app);
  click(phone.root.querySelector('[data-action="retry-stream"]'));
  await waitFor(() => phone.app.api.token === null, 'The old phone credential remained active.');
  assert.equal(recoveries, 0);
  assert.equal(phone.app.api.homeKey, null);
  assert.equal(phone.root.querySelector('[data-action="recover-service"]'), null);
});

test("English and Spanish use the same copy keys", () => {
  assert.deepEqual(Object.keys(DICTIONARIES.en).sort(), Object.keys(DICTIONARIES.es).sort());
  assert.deepEqual(dictionaryKeys().sort(), Object.keys(DICTIONARIES.es).sort());
  assert.equal(text("en", "map"), "Map");
  assert.equal(text("es", "map"), "Mapa");
  assert.equal(text("es", "hierarchy"), "Jerarquía");
  assert.equal(text("en", "chats"), "Chats");
  assert.equal(text("es", "chats"), "Chats");
  assert.equal(text("es", "waiting"), "Pendientes");
  assert.equal(text("es", "approveAlways"), "Siempre para este agente");
  assert.equal(text("es", "sendBack"), "Devolver");
  assert.equal(text("es", "watch"), "Seguir");
  assert.equal(text("es", "document"), "Documento");
  assert.equal(text("en", "boards"), "Boards");
  assert.equal(text("es", "boards"), "Tableros");
  assert.equal(text("en", "texts"), "Texts");
  assert.equal(text("es", "texts"), "Textos");
  assert.equal(text("en", "comments"), "Comments");
  assert.equal(text("es", "comments"), "Comentarios");
  assert.equal(text("es", "focus"), "Concentración");
  assert.equal(text("es", "highContrast"), "Nocturne");
  assert.equal(text("es", "settings"), "Configuración");
  assert.equal(text("en", "showMore", { count: 4 }), "Show 4 more");
  assert.equal(text("es", "queued").includes("en cola"), true);
  assert.equal(text("es", "queued").includes("respuesta registrada"), false);
  assert.equal(text("en", "submitted").includes("has not been recorded"), true);
  assert.throws(() => text("en", "missing-key"), /Unknown copy key: missing-key/);
  assert.throws(() => text("es", "missing-key"), /Unknown copy key: missing-key/);
});

async function settingsApp(t, onFetch, options = {}) {
  const fixture = await createGuiFixture({ scenario: "settings", now: new Date().toISOString(), ...options });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], onFetch);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The Settings fixture did not start.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.app.settingsState?.loaded && !desktop.app.settingsState.loading, "The Settings reports did not load.");
  return { fixture, ...desktop };
}

function changeControl(control, value) {
  control.checked = value;
  for (const handler of control.listeners.get("change") ?? []) handler({ target: control });
}

test("Settings exposes four keyboard tabs, own-palette looks and machine-owned read-only reports", async t => {
  const desktop = await settingsApp(t);
  const { root, app } = desktop;
  assert.deepEqual([...root.querySelectorAll("[data-settings-tab]")].map(node => node.textContent || text("en", `settings${node.dataset.settingsTab[0].toUpperCase()}${node.dataset.settingsTab.slice(1)}`)),
    ["General", "Agents", "Projects", "Content"]);
  assert.equal(root.querySelectorAll(".look-choice").length, 6);
  for (const preview of root.querySelectorAll(".look-choice")) {
    assert.equal(preview.getAttribute("data-look"), null);
    assert.equal(preview.querySelector(".look-preview-panels").children.length, 3);
    assert.equal(preview.querySelector(".look-preview").getAttribute("data-look") !== null, true);
  }
  assert.equal(root.querySelector("[data-origin]"), null);
  assert.equal(root.querySelector("[data-action='relay-coming-soon']").disabled, true);
  assert.equal(root.querySelector("[data-start-with-windows]").checked, false);
  click(root.querySelector("[data-look='nebula']").closest("button"));
  await waitFor(() => app.look === "nebula" && app.activity.get("settings")?.phase === "success", "The look did not apply.");
  const tab = root.querySelector("[data-settings-tab='general']");
  for (const handler of tab.listeners.get("keydown") ?? []) handler({ key: "ArrowRight", preventDefault() {} });
  assert.equal(app.settingsState.tab, "agents");
  assert.equal(desktop.document.activeElement, root.querySelector("[data-settings-tab='agents']"));
  assert.equal(root.querySelector("[data-agent='claude']").querySelector("small").textContent, "CLI 2.6.1");
  click(root.querySelector("[data-action='settings-machine']"));
  click(root.querySelector("[data-machine-choice='OFFLINE']"));
  await waitFor(() => app.settingsState.info?.selectedMachine === "OFFLINE" && !app.settingsState.loading, "The offline report did not load.");
  assert.equal(root.querySelectorAll("[data-agent]").length, 1);
  assert.equal(root.querySelector("[data-agent='codex']").querySelector("small").textContent, "CLI 0.150.0");
  assert.equal(root.querySelector("[data-action='settings-scan']").disabled, true);
  assert.equal(root.querySelector("[data-action='settings-mode-codex-auto']").disabled, true);
  assert.match(root.querySelector("[data-settings-readonly]").textContent, /Last report/);
  click(root.querySelector("[data-settings-tab='projects']"));
  assert.equal(root.querySelector("[data-cluster-link]").querySelector("code").textContent.endsWith("blog"), true);
  assert.equal(root.querySelector("[data-action='add-folder']"), null);
  click(root.querySelector("[data-settings-tab='general']"));
  assert.equal(root.querySelector("[data-start-with-windows]").disabled, true);
  assert.equal([...root.querySelectorAll("span")].some(node => node.textContent.includes("offline-staging")), true);
  assert.equal(root.querySelector(".look-choice").disabled, false);
  app.language = "es"; renderShell(app);
  assert.match(root.querySelector("[data-settings-readonly]").textContent, /solo lectura/);
  assertVisibleCopy("es", mountedVisibleCopy(desktop));
});

test("Settings mode and named app changes are reviewed; Copy and Cancel write no client bytes", async t => {
  const writes = [];
  const desktop = await settingsApp(t, (input, init) => { if (!["GET", "HEAD"].includes(init.method)) writes.push(new URL(input).pathname); });
  const { root, app, document, fixture } = desktop;
  const copies = [];
  desktop.view.navigator = { clipboard: { writeText: async value => copies.push(value) } };
  click(root.querySelector("[data-settings-tab='agents']"));
  click(root.querySelector("[data-action='settings-mode-codex-on-demand']"));
  await waitFor(() => document.querySelector("[data-settings-review='codex']"), "The mode change bypassed review.");
  let dialog = document.querySelector("[data-settings-review]");
  assert.equal(dialog.querySelector("[data-review-change='git']").checked, false);
  assert.equal(dialog.querySelector("[data-action='settings-apply']").textContent, "Apply 2 changes");
  const preview = dialog.querySelector("pre");
  assert.ok(preview);
  click(dialog.querySelector("[data-action='settings-copy']"));
  await waitFor(() => copies.length === 1, "Copy changes did not use the clipboard.");
  assert.equal(copies[0].includes("mcp.json") && copies[0].includes("fixture-relay") && !copies[0].includes("git.commit"), true);
  click(dialog.querySelector("[data-action='settings-review-cancel']"));
  assert.equal(document.querySelector("[data-settings-review]"), null);
  assert.equal(document.activeElement, root.querySelector("[data-action='settings-mode-codex-on-demand']"));
  assert.equal(app.settingsState.agents.items.find(item => item.id === "codex").mode, "auto");
  assert.equal((await readdir(fixture.root, { recursive: true })).some(path => path.endsWith("reviewed-clients.json") || path.endsWith("mcp.json")), false);
  click(root.querySelector("[data-action='settings-app-codex']"));
  await waitFor(() => document.querySelector("[data-settings-review='codex']"), "The named app connection bypassed review.");
  dialog = document.querySelector("[data-settings-review]");
  assert.match(dialog.querySelector("h2").textContent, /Codex app/);
  click(dialog.querySelector("[data-action='settings-review-cancel']"));
  const settingsWrites = writes.filter(path => path.includes("/settings/"));
  assert.equal(settingsWrites.length, 2);
  assert.equal(settingsWrites.every(path => path.endsWith("/preview")), true);
});

test("Settings applies a reviewed selection once after a lost response and revokes the exact optional agent permission", async t => {
  const writes = [];
  const desktop = await settingsApp(t, (input, init) => {
    if (init.body && !["GET", "HEAD"].includes(init.method)) writes.push({ path: new URL(input).pathname, key: headerValue(init.headers, "Idempotency-Key"), body: JSON.parse(init.body) });
  });
  const { root, app, document, fixture } = desktop;
  click(root.querySelector("[data-settings-tab='agents']"));
  click(root.querySelector("[data-action='settings-review-cursor']"));
  await waitFor(() => document.querySelector("[data-settings-review='cursor']"), "The client review did not open.");
  const dialog = document.querySelector("[data-settings-review]");
  changeControl(dialog.querySelector("[data-review-change='git']"), true);
  assert.equal(dialog.querySelector("[data-action='settings-apply']").textContent, "Apply 3 changes");
  fixture.control.setFault({ method: "POST", path: "/api/v1/settings/agents/cursor/apply", dropAfterCommit: true });
  click(dialog.querySelector("[data-action='settings-apply']"));
  await waitFor(() => root.querySelector("[data-action='retry-activity']"), "The unconfirmed Apply did not offer Retry.");
  assert.equal(dialog.querySelector("[data-review-change='git']").checked, true);
  click(root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => !document.querySelector("[data-settings-review]") && app.settingsState.agents.items.find(item => item.id === "cursor").cli.state === "connected", "Apply did not reconcile.");
  const applied = writes.filter(item => item.path.endsWith("cursor/apply"));
  assert.equal(applied.length, 2);
  assert.equal(applied[0].key === applied[1].key, true);
  assert.deepEqual(applied[0].body, applied[1].body);
  assert.equal(app.settingsState.agents.items.find(item => item.id === "cursor").mode, "on-demand");
  assert.equal(root.querySelector("[data-settings-tab='permissions']"), null);
  const permission = app.settingsState.permissions.agentPermissions[0];
  assert.equal(permission.client, "cursor");
  click(root.querySelector(`[data-action='settings-revoke-${permission.id}']`));
  await waitFor(() => app.settingsState.permissions.agentPermissions.length === 0, "The exact agent permission was not revoked.");
  assert.equal(writes.filter(item => item.path.includes("/settings/permissions/")).length, 1);
  const grant = app.settingsState.permissions.unitGrants[0];
  click(root.querySelector(`[data-action='settings-revoke-${grant.grant.id}']`));
  await waitFor(() => writes.some(item => item.path.endsWith(`/approval-grants/${grant.grant.id}`)), "The standing grant was not addressed exactly.");
  assert.equal(writes.find(item => item.path.endsWith(`/approval-grants/${grant.grant.id}`)).path.includes(encodeURIComponent(grant.unitId)), true);
});

test("Settings Content uses discovered items, preserves preferences and retains drafts on revision failure", async t => {
  const desktop = await settingsApp(t);
  const { root, app, fixture } = desktop;
  click(root.querySelector("[data-settings-tab='projects']"));
  assert.equal(root.querySelectorAll("[data-cluster-link]").length, 1);
  assert.equal(root.querySelectorAll("[data-cluster-link]").length, 1);
  click(root.querySelector("[data-settings-tab='content']"));
  assert.equal(root.querySelectorAll("[data-content-item]").length, 13);
  changeControl(root.querySelector("[data-content-item='feature:tribunal']"), false);
  typeInput(root.querySelector("[data-preference-instructions]"), "Retained instructions.\nSecond line.", 3, 3);
  click(root.querySelector("[data-action='settings-save-content']"));
  await waitFor(() => !app.settingsState.contentDirty && !app.settingsState.loading && app.activity.get("settings:PATCH:/settings/content")?.phase === "success", "Content did not save.");
  const preferences = await readFile(join(fixture.root, "Cosmic", "onem1nd", "user", "preferences.md"), "utf8");
  assert.equal(preferences.startsWith("Existing user preference."), true);
  assert.match(preferences, /Retained instructions\.\nSecond line\./);
  assert.equal(app.settingsState.content.features.find(item => item.id === "feature:tribunal").included, false);
  typeInput(root.querySelector("[data-preference-instructions]"), "Draft after conflict.", 5, 5);
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings/content", status: 409, code: "revision_conflict" });
  click(root.querySelector("[data-action='settings-save-content']"));
  await waitFor(() => app.activity.get("settings:PATCH:/settings/content")?.phase === "error", "The revision conflict was hidden.");
  assert.equal(root.querySelector("[data-preference-instructions]").value, "Draft after conflict.");
  assert.equal(app.settingsState.contentDirty, true);
  assert.equal(await readFile(join(fixture.root, "Cosmic", "onem1nd", "user", "preferences.md"), "utf8"), preferences);
  click(root.querySelector("[data-action='settings-reload-content']"));
  assert.equal(app.settingsState.contentDirty, false);
  assert.equal(root.querySelector("[data-preference-instructions]").value, "Retained instructions.\nSecond line.");
});

test("Settings refuses a stale configuration preview without touching the other selected files", async t => {
  const desktop = await settingsApp(t);
  const { root, document } = desktop;
  click(root.querySelector("[data-settings-tab='agents']"));
  click(root.querySelector("[data-action='settings-review-cursor']"));
  await waitFor(() => document.querySelector("[data-settings-review]"), "The configuration review did not open.");
  const dialog = document.querySelector("[data-settings-review]");
  const files = [...dialog.querySelectorAll("code")].map(node => node.textContent);
  await mkdir(dirname(files[0]), { recursive: true });
  const foreign = '{"mcpServers":{"foreign":{"command":"preserve"}}}\n';
  await writeFile(files[0], foreign);
  click(dialog.querySelector("[data-action='settings-apply']"));
  await waitFor(() => dialog.querySelector("[data-settings-dialog-error]"), "A stale preview was silently applied.");
  assert.match(dialog.querySelector("[data-settings-dialog-error]").textContent, /configuration changed/);
  assert.equal(await readFile(files[0], "utf8"), foreign);
  assert.equal(await readFile(files[1]).then(() => true).catch(() => false), false);
  assert.equal(dialog.querySelector("[data-review-change='git']").checked, false);
  click(dialog.querySelector("[data-action='settings-review-cancel']"));
});

test("Settings retains Content edits typed while an earlier save waits for acknowledgment", async t => {
  let release;
  let saving = false;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const desktop = await settingsApp(t, async (input, init) => {
    if (init.method === "PATCH" && new URL(input).pathname.endsWith("/settings/content")) { saving = true; await held; }
  });
  const { root, app } = desktop;
  click(root.querySelector("[data-settings-tab='content']"));
  typeInput(root.querySelector("[data-preference-instructions]"), "First save.", 3, 3);
  click(root.querySelector("[data-action='settings-save-content']"));
  await waitFor(() => saving, "The Content save did not start.");
  typeInput(root.querySelector("[data-preference-instructions]"), "Newer draft.", 5, 5);
  release();
  await waitFor(() => app.activity.get("settings:PATCH:/settings/content")?.phase === "success", "The earlier save did not finish.");
  assert.equal(root.querySelector("[data-preference-instructions]").value, "Newer draft.");
  assert.equal(app.settingsState.content.preferences.additionalInstructions, "First save.");
  assert.equal(app.settingsState.contentDirty, true);
  click(root.querySelector("[data-action='settings-save-content']"));
  await waitFor(() => !app.settingsState.contentDirty && app.activity.get("settings:PATCH:/settings/content")?.phase === "success", "The newer draft did not save against the acknowledged revision.");
  assert.equal(app.settingsState.content.preferences.additionalInstructions, "Newer draft.");
});

test("Settings ignores a late previous-machine response after another selection", async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const desktop = await settingsApp(t, async (input, init) => {
    if (init.method === "GET" && new URL(input).searchParams.get("machine") === "OFFLINE") await held;
  });
  const { root, app } = desktop;
  click(root.querySelector("[data-action='settings-machine']"));
  click(root.querySelector("[data-machine-choice='OFFLINE']"));
  click(root.querySelector("[data-action='settings-machine']"));
  click(root.querySelector("[data-machine-choice='DESKTOP']"));
  await waitFor(() => app.settingsState.info?.selectedMachine === "DESKTOP" && !app.settingsState.loading, "The current-machine report did not load.");
  release();
  await delay(100);
  assert.equal(app.settingsState.machine, "DESKTOP");
  assert.equal(app.settingsState.info.selectedMachine, "DESKTOP");
  click(root.querySelector("[data-settings-tab='projects']"));
  assert.equal(root.querySelectorAll("[data-cluster-link]").length, 1);
  assert.equal(root.querySelector("[data-cluster-link]").querySelector("strong").textContent, "Shop");
});

test('a superseded Settings refresh waits for the current machine before its continuation runs', async t => {
  const desktop = await settingsApp(t), { app, root } = desktop;
  closeStream(app.api.live);
  let releasePrevious, releaseCurrent;
  const previous = new Promise(resolve => { releasePrevious = resolve; });
  const current = new Promise(resolve => { releaseCurrent = resolve; });
  t.after(() => { releasePrevious(); releaseCurrent(); });
  const state = app.settingsState;
  const reports = new Map([
    ['/api/v1/settings', state.info], ['/api/v1/settings/agents', state.agents],
    ['/api/v1/settings/permissions', state.permissions], ['/api/v1/settings/projects', state.projects],
    ['/api/v1/settings/content', state.content], ['/api/v1/machines', { items: state.machines, total: state.machines.length }],
  ]);
  app.api.fetch = async input => {
    const url = new URL(input), machine = state.machine;
    await (machine === 'OFFLINE' ? previous : current);
    const data = structuredClone(reports.get(url.pathname));
    if (url.pathname === '/api/v1/settings') data.selectedMachine = machine;
    return jsonEnvelope(200, data);
  };
  click(root.querySelector('[data-action="settings-machine"]'));
  click(root.querySelector('[data-machine-choice="OFFLINE"]'));
  const earlier = state.pending;
  let continued = false;
  const continuation = earlier.then(() => { continued = true; });
  click(root.querySelector('[data-action="settings-machine"]'));
  click(root.querySelector('[data-machine-choice="DESKTOP"]'));
  releasePrevious();
  await delay(0);
  assert.equal(continued, false);
  assert.equal(state.loading, true);
  releaseCurrent();
  await Promise.all([state.pending, continuation]);
  assert.equal(continued, true);
  assert.equal(state.loading, false);
  assert.equal(state.info.selectedMachine, 'DESKTOP');
});

test("Settings startup, scan and manual finding target the selected owner with revision checks", async t => {
  const desktop = await settingsApp(t);
  const { root, app, fixture, document } = desktop;
  let releaseFind;
  const findResponse = new Promise(resolve => { releaseFind = resolve; });
  t.after(() => releaseFind());
  const send = app.api.fetch;
  app.api.fetch = async (input, init) => {
    const response = await send(input, init);
    if (init?.method === "POST" && new URL(input).pathname === "/api/v1/settings/agents/find") await findResponse;
    return response;
  };
  changeControl(root.querySelector("[data-start-with-windows]"), true);
  await waitFor(() => app.settingsState.info.service.startWithWindows && app.activity.get("settings:PATCH:/settings/service")?.phase === "success", "The machine-local startup setting did not save.");
  click(root.querySelector("[data-settings-tab='agents']"));
  click(root.querySelector("[data-action='settings-scan']"));
  await waitFor(() => app.activity.get("settings:POST:/settings/agents/scan")?.phase === "success", "Scan did not finish.");
  const binary = join(fixture.root, "copilot.exe");
  await writeFile(binary, "Fixture binary, never executed.");
  click(root.querySelector("[data-action='settings-find-copilot']"));
  await waitFor(() => document.querySelector("[data-form='settings-find']"), "Manual finding did not open.");
  const dialog = document.querySelector("[data-form='settings-find']");
  dialog.querySelector("[name='path']").value = binary;
  click(dialog.querySelector("[data-action='confirm-form']"));
  await waitFor(() => app.settingsState.agents.items.find(item => item.id === "copilot").found, "The client discovery event did not arrive before its acknowledgment.");
  assert.equal(document.querySelector("[data-form='settings-find']"), dialog);
  releaseFind();
  await waitFor(() => app.settingsState.agents.items.find(item => item.id === "copilot").found && document.querySelector("[data-form='settings-find']") == null, "The known client path was not found.");
  assert.equal(document.querySelector("[data-form='settings-find']"), null);
});

test("Settings General keeps Restart in the Relay card header, names the time of a slowdown and lists unreadable records by file", () => {
  const { document } = createTestDocument(1440);
  const restarts = [], opened = [];
  const render = (extra = {}, language = "en") => renderSettings(document, { tab: "general", machine: "DESKTOP", localMachine: "DESKTOP", language, canWrite: true,
    service: { state: "running", machine: "DESKTOP", version: "3.0.0", startedAt: "2026-10-21T14:15:00.000Z" }, locations: { mind: "C:/M1ND", staging: "C:/staging" }, ...extra },
  (key, values) => text(language, key, values), { onRestart: () => restarts.push(1), onIssuesOpen: open => opened.push(open) });
  const retryAt = "2026-10-21T14:40:00.000Z";
  const issues = [{ code: "corrupt_resource", path: "units/shop.json", message: "The state could not be projected." },
    { code: "corrupt_resource", path: "tasks/027-media.md", message: "The task could not be projected." }, { code: "bad_record", path: "odd.txt", message: "Something else went wrong." }];
  const panel = render({ limits: { state: "slowing", retryAt, messages: { used: 50, max: 60 }, syncBytes: { used: 49900000, max: 50000000 } }, issues });
  const head = panel.querySelector(".settings-card-head");
  assert.equal(head.querySelector("h3").textContent, "Relay service");
  const restart = head.querySelector("[data-action='settings-restart']");
  assert.equal(restart.children.at(-1).textContent, "Restart");
  assert.equal(restart.getAttribute("aria-label"), "Restart service");
  assert.equal(restart.className.includes("is-secondary"), true);
  assert.equal(restart.disabled, false);
  click(restart);
  assert.equal(restarts.length, 1);
  assert.equal(render({ readOnly: true }).querySelector("[data-action='settings-restart']").disabled, true);
  assert.deepEqual(panel.querySelectorAll(".settings-line").slice(0, 4).map(line => line.children[0].textContent), ["State", "Version", "Started", "Start with Windows"]);
  const slowing = panel.querySelector("[data-limits='slowing']");
  assert.equal(slowing.querySelector("strong").textContent, `Publishing slows down until ${formatShortTime("en", retryAt)}`);
  assert.equal(slowing.querySelector("[data-limit-usage]").textContent, "49.9 of 50 MB of sync used in this window. Messages still go out.");
  assert.equal(render({ limits: { state: "slowing", retryAt: null, syncBytes: { used: 1, max: 50000000 } } }).querySelector("[data-limits='slowing']").querySelector("strong").textContent, "Publishing slows down");
  const normal = render({ limits: { state: "normal", messages: { used: 3, max: 60 }, syncBytes: { used: 1, max: 50000000 } } });
  assert.equal(normal.querySelector(".settings-notice"), null);
  assert.equal(normal.querySelector("[data-limits='normal']").textContent, limitsUsage("en", { used: 3, max: 60 }, { used: 1, max: 50000000 }));
  const notice = panel.querySelector("[data-issues]");
  assert.equal(notice.querySelector("strong").textContent, "3 records could not be read");
  assert.equal(notice.querySelector("p").textContent, "The rest of the M1ND works.");
  const files = notice.querySelector("[data-issue-files]"), toggle = notice.querySelector("[data-action='settings-issues-toggle']");
  assert.equal(files.getAttribute("hidden") !== null, true);
  assert.equal(toggle.textContent, "Show files");
  click(toggle);
  assert.equal(files.getAttribute("hidden"), null);
  assert.equal(toggle.textContent, "Hide files");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(opened, [true]);
  assert.deepEqual(files.querySelectorAll("code").map(node => node.textContent), ["units/shop.json", "tasks/027-media.md", "odd.txt"]);
  assert.deepEqual(files.querySelectorAll("span").map(node => node.textContent), ["Unit state could not be read", "Task could not be read", "Could not be read"]);
  assert.equal(render({ issues: issues.slice(0, 1) }).querySelector("[data-issues]").querySelector("strong").textContent, "1 record could not be read");
  assert.equal(render({ issues, issuesOpen: true }).querySelector("[data-issue-files]").getAttribute("hidden"), null);
  assert.equal(render().querySelector("[data-issues]"), null);
  const spanish = render({ limits: { state: "slowing", retryAt, syncBytes: { used: 49900000, max: 50000000 } }, issues }, "es");
  assert.equal(spanish.querySelector("[data-limits='slowing']").querySelector("strong").textContent, `La publicación se ralentiza hasta las ${formatShortTime("es", retryAt)}`);
  assert.equal(spanish.querySelector("[data-issues]").querySelector("strong").textContent, "No se pudieron leer 3 registros");
  assert.deepEqual(spanish.querySelector("[data-issue-files]").querySelectorAll("span").map(node => node.textContent),
    ["No se pudo leer el estado de una unidad", "No se pudo leer una tarea", "No se pudo leer"]);
  assertVisibleCopy("es", [["General", nodeText(spanish)]]);
});

test("Settings General folds Phone, Relay+ and Locations into disclosures that stay closed until asked", () => {
  const { document } = createTestDocument(1440);
  const render = (home, language = "en") => renderSettings(document, { tab: "general", machine: "DESKTOP", localMachine: "DESKTOP", language, canWrite: true, canManage: true, home,
    now: Date.parse("2026-10-21T10:00:00.000Z"), locations: { mind: "C:/M1ND", staging: "C:/staging" } }, (key, values) => text(language, key, values), {});
  const panel = render({ enabled: false });
  const folds = panel.querySelectorAll("details");
  assert.deepEqual(folds.map(node => node.getAttribute("data-disclosure")), ["settings-phone", "settings-relay-plus", "settings-locations"]);
  assert.deepEqual(folds.map(node => node.getAttribute("open")), [null, null, null]);
  assert.deepEqual(folds.map(node => node.querySelector("summary").children.at(-1).textContent), ["Closed", "Coming soon", "M1ND and staging folders"]);
  assert.deepEqual(folds.map(node => node.querySelector("summary").children[1].textContent), ["Phone on the home network", "Relay+", "Locations"]);
  assert.equal(folds[0].querySelector("[data-action='open-home']").className.includes("is-secondary"), true);
  const expiresAt = "2026-10-21T22:00:00.000Z";
  const open = render({ enabled: true, expiresAt, phoneCount: 1 });
  assert.equal(open.querySelector("details").querySelector("summary").children.at(-1).textContent, `Open until ${formatShortTime("en", expiresAt)}`);
  assert.equal(open.querySelector("details").getAttribute("open"), null);
  assert.equal(render({ enabled: false }, "es").querySelector("details").querySelector("summary").children.at(-1).textContent, "Cerrado");
});

test("Settings Agents offers one Review all notice, folds Permissions and opens it for a saved permissions tab", () => {
  const { document } = createTestDocument(1440);
  const reviewed = [];
  const agent = (id, name, changes, extra = {}) => ({ id, name, version: "1.0.0", found: true, mode: "auto", cli: { state: changes ? "changes-needed" : "connected", changes }, app: { name: null, state: "missing" }, ...extra });
  const items = [agent("claude", "Claude Code", 52), agent("codex", "Codex", 52), agent("cursor", "Cursor", 51), agent("opencode", "OpenCode", 0),
    agent("lyra", "Lyra", 0, { found: false, version: null, cli: { state: "missing", changes: 0 } })];
  const render = (extra = {}, language = "en") => renderSettings(document, { tab: "agents", machine: "DESKTOP", localMachine: "DESKTOP", language, canWrite: true, canRevoke: true,
    agents: { items, reportedAt: "2026-10-21T13:31:00.000Z" }, permissions: { unitGrants: [], agentPermissions: [] }, ...extra }, (key, values) => text(language, key, values), { onReviewAll: list => reviewed.push(list.map(item => item.id)), onReview: (item, mode, target) => reviewed.push([item.id, mode, target]), onFind: item => reviewed.push(["find", item.id]) });
  const panel = render();
  assert.deepEqual(panel.querySelectorAll("[data-settings-tab]").map(node => node.getAttribute("data-settings-tab")), ["general", "agents", "projects", "content"]);
  const notice = panel.querySelector("[data-agents-notice]");
  assert.equal(notice.querySelector("strong").textContent, "3 agents need the M1ND's rules and Relay");
  assert.equal(notice.querySelector("p").textContent, "Up to 52 changes for each: rules, commands and the Relay entry. Each one can be read before applying.");
  click(notice.querySelector("[data-action='settings-review-all']"));
  assert.deepEqual(reviewed.pop(), ["claude", "codex", "cursor"]);
  const same = render({ agents: { items: [agent("claude", "Claude Code", 52), agent("codex", "Codex", 52)] } });
  assert.equal(same.querySelector("[data-agents-notice]").querySelector("p").textContent, "The same 52 changes for each: rules, commands and the Relay entry. Each one can be read before applying.");
  assert.equal(render({ agents: { items: [agent("claude", "Claude Code", 0)] } }).querySelector("[data-agents-notice]"), null);
  const link = panel.querySelector("[data-agent='cursor']").querySelector("[data-action='settings-review-cursor']");
  assert.equal(link.children[0].textContent, "51 changes");
  click(link);
  assert.deepEqual(reviewed.pop(), ["cursor", "auto", "cli"]);
  const missing = panel.querySelector("[data-agent='lyra']");
  assert.equal(missing.className.includes("is-missing"), true);
  assert.equal(missing.querySelector("small").textContent, "Not found on this machine");
  const find = missing.querySelector("[data-action='settings-find-lyra']");
  assert.equal(find.textContent, "Find it");
  click(find);
  assert.deepEqual(reviewed.pop(), ["find", "lyra"]);
  const connected = panel.querySelector("[data-agent='opencode']");
  assert.equal(connected.querySelector(".settings-connected").textContent, "Connected");
  assert.equal(connected.querySelector("[data-action='settings-review-opencode']"), null);
  const folded = panel.querySelector("[data-disclosure='settings-permissions']");
  assert.equal(folded.getAttribute("open"), null);
  assert.equal(folded.querySelector("summary").children.at(-1).textContent, "No standing approvals");
  assert.deepEqual(folded.querySelectorAll("p").map(node => node.textContent).filter(value => value.endsWith("yet.")), ["No standing approvals yet.", "No agent permissions yet."]);
  const grant = { unitId: "root:overseer", grant: { id: "g1", action: "shell", pattern: { command: "npm test" }, grantedAt: "2026-10-21T10:00:00.000Z" } };
  const listed = render({ permissions: { unitGrants: [grant], agentPermissions: [{ id: "p1", client: "codex", actions: ["git.commit"], grantedAt: "2026-10-21T10:00:00.000Z" }] } });
  assert.equal(listed.querySelector("[data-disclosure='settings-permissions']").querySelector("summary").children.at(-1).textContent, "2 standing approvals");
  assert.deepEqual(listed.querySelectorAll("[data-permission]").map(node => node.getAttribute("data-permission")), ["g1", "p1"]);
  const requested = render({ tab: "permissions" });
  assert.equal(requested.querySelector("[data-settings-page]").getAttribute("data-settings-page"), "agents");
  assert.equal(requested.querySelector("[data-settings-tab='agents']").getAttribute("aria-selected"), "true");
  assert.notEqual(requested.querySelector("[data-disclosure='settings-permissions']").getAttribute("open"), null);
  const spanish = render({}, "es");
  assert.equal(spanish.querySelector("[data-agents-notice]").querySelector("strong").textContent, "3 agentes necesitan las reglas de la M1ND y Relay");
  assert.equal(spanish.querySelector("[data-agent='lyra']").querySelector("[data-action='settings-find-lyra']").textContent, "Buscarla");
  assert.equal(spanish.querySelector("[data-disclosure='settings-permissions']").querySelector("summary").children.at(-1).textContent, "Sin aprobaciones permanentes");
  assertVisibleCopy("es", [["Agents", nodeText(spanish)]]);
});

test("Settings Projects sorts A to Z or Z to A, searches by name and path, marks missing folders and keeps Unlink in a row menu", () => {
  const { document } = createTestDocument(1440);
  const calls = [], views = [];
  const links = [
    { clusterId: "c3", title: "zeta-site", kind: "repository", localPath: "C:\\Web\\zeta-site", available: true },
    { clusterId: "c1", title: "alpha", kind: "folder", localPath: "C:\\Unity\\alpha", available: true },
    { clusterId: "c2", title: "Beta", kind: "repository", localPath: null, available: false },
    { clusterId: "c4", title: "gamma", kind: "none", localPath: null, available: false },
  ];
  const render = (extra = {}, language = "en") => renderSettings(document, { tab: "projects", machine: "DESKTOP", localMachine: "DESKTOP", language, canWrite: true, projects: { clusterLinks: links }, ...extra },
    (key, values) => text(language, key, values), { onLinkFolder: () => calls.push("link"), onRemoveLink: link => calls.push(["unlink", link.clusterId]), onOpenEditor: link => calls.push(["editor", link.clusterId]),
      onCopyPath: link => calls.push(["copy", link.clusterId]), onProjectView: view => views.push(view) });
  const panel = render();
  const order = () => panel.querySelectorAll("[data-cluster-link]").map(node => node.getAttribute("data-cluster-link"));
  assert.equal(panel.querySelector(".settings-card-head").querySelector("h3").textContent, "Linked folders");
  const add = panel.querySelector(".settings-card-head").querySelector("[data-action='settings-link-folder']");
  assert.equal(add.children.at(-1).textContent, "Link a folder");
  click(add);
  assert.deepEqual(calls.pop(), "link");
  const search = panel.querySelector("[data-action='settings-link-search']");
  assert.equal(search.getAttribute("placeholder"), "Search 4 linked folders");
  const button = panel.querySelector("[data-action='settings-link-order']");
  assert.equal(button.children[0].textContent, "A to Z");
  assert.deepEqual(order(), ["c1", "c2", "c4", "c3"]);
  click(button);
  assert.equal(button.children[0].textContent, "Z to A");
  assert.deepEqual(order(), ["c3", "c4", "c2", "c1"]);
  assert.deepEqual(views.at(-1), { query: "", order: "descending" });
  click(button);
  assert.deepEqual(order(), ["c1", "c2", "c4", "c3"]);
  search.value = "WEB"; for (const handler of search.listeners.get("input") ?? []) handler();
  assert.deepEqual(order(), ["c3"]);
  assert.deepEqual(views.at(-1), { query: "WEB", order: "ascending" });
  search.value = "ALP"; for (const handler of search.listeners.get("input") ?? []) handler();
  assert.deepEqual(order(), ["c1"]);
  search.value = "nothing at all"; for (const handler of search.listeners.get("input") ?? []) handler();
  assert.deepEqual(order(), []);
  assert.equal(panel.querySelector(".settings-link-list").querySelector("p").textContent, "No linked folder matches.");
  search.value = ""; for (const handler of search.listeners.get("input") ?? []) handler();
  const missing = panel.querySelector("[data-cluster-link='c2']");
  assert.equal(nodeText(missing.querySelector("[data-link-missing]")), "Not on this machine");
  assert.equal(missing.querySelector("code"), null);
  assert.equal(panel.querySelector("[data-cluster-link='c4']").querySelector("[data-action='settings-link-more']"), null);
  assert.equal(panel.querySelector("[data-cluster-link='c3']").querySelector("code").textContent, "C:\\Web\\zeta-site");
  const restored = render({ projectQuery: "al", projectOrder: "descending" });
  assert.deepEqual(restored.querySelectorAll("[data-cluster-link]").map(node => node.getAttribute("data-cluster-link")), ["c1"]);
  assert.equal(restored.querySelector("[data-action='settings-link-order']").children[0].textContent, "Z to A");
  const more = panel.querySelector("[data-cluster-link='c3']").querySelector("[data-action='settings-link-more']");
  click(more);
  const menu = document.querySelector("[data-context-menu]");
  assert.deepEqual(menu.children.map(node => node.getAttribute("data-action") ?? node.getAttribute("role")), ["context-open-editor", "context-copy-path", "separator", "context-unlink"]);
  assert.deepEqual(menu.children.filter(node => node.tag === "button").map(node => node.textContent), ["Open in editor", "Copy the path", "Unlink"]);
  assert.equal(menu.querySelector("[data-action='context-unlink']").className.includes("is-danger"), true);
  click(menu.querySelector("[data-action='context-copy-path']"));
  assert.deepEqual(calls.pop(), ["copy", "c3"]);
  assert.equal(document.querySelector("[data-context-menu]"), null);
  click(more);
  click(document.querySelector("[data-action='context-open-editor']"));
  assert.deepEqual(calls.pop(), ["editor", "c3"]);
  click(more);
  click(document.querySelector("[data-action='context-unlink']"));
  assert.deepEqual(calls.pop(), ["unlink", "c3"]);
  assert.equal(document.querySelector("[data-context-menu]"), null);
  click(panel.querySelector("[data-cluster-link='c1']").querySelector("[data-action='settings-link-more']"));
  assert.equal(document.querySelector("[data-action='context-open-editor']") != null, true);
  document.querySelector("[data-context-menu]").remove();
  click(panel.querySelector("[data-cluster-link='c2']").querySelector("[data-action='settings-link-more']"));
  assert.deepEqual(document.querySelector("[data-context-menu]").children.map(node => node.getAttribute("data-action")), ["context-unlink"]);
  document.querySelector("[data-context-menu]").remove();
  const spanish = render({}, "es");
  assert.equal(spanish.querySelector("[data-action='settings-link-order']").children[0].textContent, "De la A a la Z");
  assert.equal(spanish.querySelector("[data-action='settings-link-search']").getAttribute("placeholder"), "Buscar entre 4 carpetas vinculadas");
  assert.equal(nodeText(spanish.querySelector("[data-link-missing]")), "No está en esta máquina");
  assertVisibleCopy("es", [["Projects", nodeText(spanish)]]);
  assert.equal(render({ canWrite: false }).querySelector("[data-action='settings-link-folder']").disabled, true);
});

test("Settings Review all reads every agent that is behind and applies them in Activity, a refusal on one not stopping the others", async t => {
  const writes = [];
  const desktop = await settingsApp(t, (input, init) => { if (init.body && !["GET", "HEAD"].includes(init.method)) writes.push(new URL(input).pathname); }, {
    seed: async ({ tree }) => {
      const file = join(tree.user, "machines", "DESKTOP", "settings.json");
      const report = JSON.parse(await readFile(file, "utf8"));
      report.agents.items = report.agents.items.map(item => ["claude", "codex"].includes(item.id) ? { ...item, cli: { state: "changes-needed", changes: 52 } } : item);
      await writeFile(file, JSON.stringify(report));
    },
  });
  const { root, app, document, fixture } = desktop;
  click(root.querySelector("[data-settings-tab='agents']"));
  const notice = root.querySelector("[data-agents-notice]");
  assert.equal(notice.querySelector("strong").textContent, "3 agents need the M1ND's rules and Relay");
  click(notice.querySelector("[data-action='settings-review-all']"));
  await waitFor(() => document.querySelector("[data-settings-review-all]"), "Review all did not open.");
  const dialog = document.querySelector("[data-settings-review-all]");
  const agents = dialog.querySelectorAll("[data-review-agent]");
  assert.deepEqual(agents.map(node => node.getAttribute("data-review-agent")), ["claude", "codex", "cursor"]);
  assert.deepEqual(agents.map(node => node.getAttribute("open") !== null), [true, false, false]);
  assert.deepEqual(agents.map(node => node.querySelector("summary").children.at(-1).textContent), ["2 changes", "2 changes", "2 changes"]);
  assert.equal(dialog.querySelector("[data-review-change='git']"), null);
  assert.equal(writes.filter(path => path.endsWith("/preview")).length, 3);
  assert.equal(writes.some(path => path.endsWith("/apply")), false);
  fixture.control.setFault({ method: "POST", path: "/api/v1/settings/agents/codex/apply", status: 409, code: "configuration_changed" });
  click(dialog.querySelector("[data-action='settings-apply-all']"));
  assert.equal(document.querySelector("[data-settings-review-all]"), null);
  await waitFor(() => root.querySelector("[data-queue-state='failed']"), "The refused agent did not fail in Activity.");
  assert.deepEqual(root.querySelectorAll("[data-queue-result]").map(node => node.getAttribute("data-queue-result")), ["done", "failed", "done"]);
  assert.deepEqual(writes.filter(path => path.endsWith("/apply")), ["claude", "codex", "cursor"].map(id => `/api/v1/settings/agents/${id}/apply`));
  await waitFor(() => ["claude", "cursor"].every(id => app.settingsState.agents.items.find(item => item.id === id).cli.state === "connected"), "The agents that were accepted did not connect.");
  assert.equal(app.settingsState.agents.items.find(item => item.id === "codex").cli.state, "changes-needed");
  click(root.querySelector("[data-action='queue-retry']"));
  await waitFor(() => root.querySelector("[data-queue-state='done']"), "Retry did not finish the agent that was left.");
  assert.deepEqual(root.querySelectorAll("[data-queue-result]").map(node => node.getAttribute("data-queue-result")), ["done", "done", "done"]);
  assert.equal(writes.filter(path => path.endsWith("/codex/apply")).length, 2);
  assert.equal(writes.filter(path => path.endsWith("/claude/apply") || path.endsWith("/cursor/apply")).length, 2);
  await waitFor(() => !app.settingsState.loading && app.settingsState.agents.items.every(item => !item.found || item.cli.state === "connected"), "Settings did not read the connected agents.");
  assert.equal(root.querySelector("[data-agents-notice]"), null);
});

test("a saved permissions tab opens Agents with its Permissions disclosure open", async t => {
  const { root, app } = await settingsApp(t);
  assert.equal(root.querySelector("[data-disclosure='settings-permissions']"), null);
  app.settingsState.tab = "permissions";
  renderShell(app);
  assert.equal(app.settingsState.tab, "agents");
  assert.equal(root.querySelector("[data-settings-page]").getAttribute("data-settings-page"), "agents");
  assert.notEqual(root.querySelector("[data-disclosure='settings-permissions']").getAttribute("open"), null);
  renderShell(app);
  assert.notEqual(root.querySelector("[data-disclosure='settings-permissions']").getAttribute("open"), null);
});

test("Settings phone dialog uses the real grant, retains expiry and scrubs secrets on dismissal and close", async t => {
  const desktop = await settingsApp(t);
  const { root, app, fixture } = desktop;
  await endFixtureHome(desktop);
  clickAction(root, "open-home");
  await waitFor(() => root.querySelector("[data-phone-dialog]"), "The QR dialog did not open.");
  assert.equal(root.querySelector(".qr").getAttribute("data-qr") === app.homeState.grant.qrPayloads[0], true);
  assert.equal(decodeHomeQrPath(root.querySelector('.qr').querySelector('path').getAttribute('d')), app.homeState.grant.qrPayloads[0]);
  const homeApi = apiFrom(`${new URL(fixture.phoneUrl).origin}/`);
  await exchangeCode(homeApi, app.homeState.grant.shortCode);
  const reported = await request(app.api, 'GET', '/settings');
  assert.equal(reported.data.home.phoneCount, 1);
  const counted = renderSettings(root.ownerDocument, { tab: 'general', machine: 'DESKTOP', language: 'en', home: reported.data.home, now: Date.parse(reported.meta.readAt) }, (key, values) => text('en', key, values), {});
  assert.equal(counted.querySelector('[data-phone-count]').getAttribute('data-phone-count'), '1');
  assert.match(counted.querySelector('[data-phone-count]').textContent, /1 phone signed in/);
  assert.equal(Date.parse(app.homeState.grant.expiresAt) - Date.parse(app.homeState.grant.openedAt), 12 * 3600000);
  assert.equal(root.querySelector("[data-phone-count]").getAttribute("data-phone-count"), "unknown");
  assert.equal(Object.hasOwn(app.activity.get("home-open").result.data, "key"), false);
  click(root.querySelector("[data-action='phone-done']"));
  assert.equal(app.homeState.grant, null);
  assert.equal(root.querySelector("[data-secret]"), null);
  assert.equal(root.querySelector("[data-phone-dialog]"), null);
  assert.equal(app.homeState.home.enabled, true);
  clickAction(root, "close-home");
  await waitFor(() => !app.homeState.home.enabled, "Close access did not revoke the grant.");
  assert.equal(root.querySelector("[data-home]").getAttribute("data-home"), "closed");
  assert.equal(JSON.stringify((await request(app.api, "GET", "/settings")).data).includes("shortCode"), false);
  const { document } = createTestDocument(1440);
  const panel = renderSettings(document, { tab: "general", machine: "DESKTOP", language: "en", home: { enabled: true, phoneCount: 2, expiresAt: new Date(Date.now() + 10000).toISOString() } }, (key, values) => text("en", key, values), {});
  assert.match(panel.querySelector("[data-phone-count]").textContent, /2 phones signed in/);
  assert.match(panel.querySelector("[data-remaining]").textContent, /less than a minute/);
  assert.doesNotMatch(panel.querySelector("[data-phone-count]").textContent, /\d:\d{2}:\d{2}/);
  const later = renderSettings(document, { tab: "general", machine: "DESKTOP", language: "en", now: Date.now(), home: { enabled: true, phoneCount: 2, expiresAt: new Date(Date.now() + 43198 * 1000).toISOString() } }, (key, values) => text("en", key, values), {});
  assert.match(later.querySelector("[data-remaining]").textContent, /Access closes in 11 h 59 min/);
  assert.doesNotMatch(later.querySelector("[data-remaining]").textContent, /seconds/);
  clickAction(root, "open-home");
  await waitFor(() => root.querySelector("[data-phone-dialog]"), "The next QR grant did not open.");
  await fixture.control.advance(12 * 3600000);
  await waitFor(() => !app.homeState.home.enabled && !root.querySelector("[data-phone-dialog]"), "Expiry did not remove the QR grant.");
  assert.equal(app.homeState.grant, null);
  assert.equal(root.querySelector("[data-secret]"), null);
});

async function endFixtureHome(desktop) {
  clickAction(desktop.root, "close-home");
  await waitFor(() => !desktop.app.homeState.home.enabled, "The fixture home access did not close.");
}

test("known language prefers the stored viewer language, then a Spanish browser", () => {
  const storage = { getItem: (key) => key === "hivem1nd:language" ? "es" : null }; // Compatibility: browser storage and desktop bridge names remain stable.
  assert.equal(knownLanguage(storage, ["en-US"]), "es");
  assert.equal(knownLanguage({ getItem: () => null }, ["es-AR", "en"]), "es");
  assert.equal(knownLanguage({ getItem: () => "fr" }, ["es-MX"]), "es");
  assert.equal(knownLanguage({ getItem: () => null }, ["en-US", "es"]), "en");
  assert.equal(knownLanguage(null, null), "en");
  assert.equal(knownLanguage({ getItem: () => { throw new Error("private"); } }, ["es"]), "es");
});

test("presentation prefers a viewer override and otherwise uses settings", () => {
  assert.deepEqual(presentation({ look: "high-contrast", language: "es" }, { look: "modern", language: "en" }), {
    look: "high-contrast",
    language: "es",
  });
  assert.deepEqual(presentation({ look: null, language: null }, { look: "high-contrast", language: "es" }), {
    look: "high-contrast",
    language: "es",
  });
  assert.deepEqual(presentation(null, null), { look: "modern", language: "en" });
  assert.deepEqual(presentation({ look: null, language: "en" }, { look: "modern", language: "es" }), {
    look: "modern",
    language: "en",
  });
});

test("phone capabilities select the phone shell and desktop capabilities stay desktop", () => {
  assert.equal(shellLayout(PHONE), "phone");
  assert.equal(shellLayout(DESKTOP), "desktop");
  assert.equal(shellLayout(["viewer.write"]), "desktop");
  assert.equal(shellLayout([]), "unknown");
  assert.equal(shellLayout(DESKTOP, "phone"), "phone");
  assert.equal(shellLayout(PHONE, "desktop"), "phone");
  for (const action of ["read", "chat.post", "master.read", "approval.answer", "task.accept", "task.send-back"]) {
    assert.equal(canPerform(PHONE, action), true, action);
  }
  for (const action of ["chat.manage", "mailbox.read", "unit.create", "unit.connect", "session.start", "session.stop", "layout.write", "settings.write", "home.manage", "grant.revoke", "task.undo", "task.status", "editor.write", "comment.write", "proposal.answer", "asset.write", "watch", "viewer.write"]) {
    assert.equal(canPerform(PHONE, action), false, action);
    assert.equal(canPerform(DESKTOP, action), true, action);
  }
});

test("the shell has no remote assets, no token storage beyond the tab session, and no inline code", async () => {
  const files = ["gui/app/index.html", "gui/app/favicon.svg", "gui/app/main.mjs", "gui/app/i18n.mjs", "gui/app/styles.css", "gui/app/components.mjs", "gui/app/lists.mjs", "gui/app/hierarchy.mjs", "gui/app/map.mjs", "gui/app/map-geometry.mjs", "gui/app/actions.mjs", "gui/app/chats.mjs", "gui/app/chat-media.mjs", "gui/app/inspector.mjs", "gui/app/markup.mjs", "gui/app/settings.mjs", "gui/app/qr.mjs", "gui/app/qr-render.mjs", "gui/app/phone.mjs", "gui/app/embed.mjs", "gui/app/embedded-apps.mjs"];
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
  for (const [file, source] of sources) {
    if (file !== "gui/app/main.mjs") assert.equal(source.includes("localStorage"), false, file);
    // Decided 2026-10-21: a desktop viewer keeps its session in its own tab, so a reload does not sign it out. The page
    // only hands the tab's storage to the api; nothing else reads or writes it.
    const tabStorage = source.match(/sessionStorage/g) ?? [];
    if (file === "gui/app/main.mjs") assert.deepEqual([tabStorage.length, source.includes("return env.sessionStorage ?? null;")], [1, true], file);
    else assert.equal(tabStorage.length, 0, file);
    assert.equal(source.includes("fonts.googleapis"), false, file);
    assert.equal(source.includes("\u2014"), false, file);
    const remote = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    assert.deepEqual(remote.filter((url) => !["http://www.w3.org/2000/svg", "https://blueprint.txmska.com/files", "https://void.txmska.com/"].includes(url)), [], file);
  }
  const html = sources[0][1];
  assert.match(html, /lang="en"/);
  assert.match(html, /href="\/app\/styles\.css"/);
  assert.equal(html.includes("mark.svg"), false);
  assert.match(html, /rel="icon" href="\/app\/favicon\.svg"/);
  assert.equal(html.includes("data:image"), false);
  const icon = sources[1][1];
  assert.equal(icon.includes("#ff2d55"), true);
  assert.ok(Buffer.byteLength(icon) < 2048);
  await assert.rejects(readFile("gui/app/mark.svg"), (error) => error.code === "ENOENT");
  assert.match(html, /src="\/app\/main\.mjs"/);
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false);
  assert.equal(html.includes("<style"), false);
  assert.equal(html.includes("session="), false);
  const main = sources[2][1];
  const imports = [...new Set([...main.matchAll(/from "([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(imports, ["./actions.mjs", "./api.mjs", "./chat-media.mjs", "./chats.mjs", "./components.mjs", "./embed.mjs", "./embedded-apps.mjs", "./hierarchy.mjs", "./i18n.mjs", "./inspector.mjs", "./lists.mjs", "./map.mjs", "./phone.mjs", "./settings.mjs", "./state.mjs", "./stream.mjs"]);
  const css = sources[4][1];
  assert.match(css, /--bg:\s*#07040a/);
  assert.match(css, /--bg:\s*#050505/);
  assert.match(css, /--accent:\s*#ff2d55/);
  assert.match(css, /--accent:\s*#d4b06a/);
  assert.match(css, /--bar:\s*52px/);
  assert.match(css, /--footer:\s*30px/);
  assert.match(css, /--side:\s*290px/);
  assert.match(css, /--inspector:\s*366px/);
  assert.match(css, /--radius-panel:\s*20px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*0/);
  assert.match(css, /--target:\s*44px/);
});

test("collections page 1, 4, 40, 400 and 1200 rows without stopping early", async () => {
  for (const count of [1, 4, 40, 400, 1200]) {
    const items = numberedUnits(count);
    const { list, calls } = pagedList(items);
    const result = await loadAll(list);
    assert.equal(result.stale, false);
    assert.equal(list.items.length, count);
    assert.equal(list.total, count);
    assert.equal(list.nextCursor, null);
    assert.equal(calls.length, Math.ceil(count / 100));
    assert.equal(list.store.pages.get("units").generation, list.generation);
  }
});

test("a newer query wins while an older fetch is still running", async () => {
  const pending = [];
  const store = createStore();
  const list = createPagedList({ api: {}, store, name: "units", route: "/units" });
  list.delay = 0;
  list.request = (_api, _method, _path, options) => new Promise((resolve, reject) => {
    const entry = { query: options.query.q, resolve, reject };
    options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    pending.push(entry);
  });
  list.scrollTop = 4000;
  const first = setQuery(list, "alpha");
  assert.equal(list.scrollTop, 0);
  await delay(0);
  const second = setQuery(list, "beta");
  await delay(0);
  assert.equal(pending.at(-1).query, "beta");
  pending[0].resolve(page([{ id: "alpha", unit: "alpha" }]));
  pending.at(-1).resolve(page([{ id: "beta", unit: "beta" }]));
  await first;
  await second;
  assert.deepEqual(list.items.map((item) => item.id), ["beta"]);
  assert.equal(list.store.pages.get("units").query, "beta");
});

test("an expired cursor reloads once and an invalid cursor does not retry", async () => {
  const expired = faultList(numberedUnits(150), "cursor_expired");
  expired.list.focusId = "unit-0001";
  await loadAll(expired.list);
  assert.equal(expired.list.items.length, 150);
  assert.equal(expired.list.focusId, "unit-0001");
  assert.equal(expired.calls.filter((query) => query.cursor).length, 2);

  const invalid = faultList(numberedUnits(150), "invalid_cursor");
  await loadAll(invalid.list);
  assert.equal(invalid.list.status, "error");
  assert.equal(invalid.list.error.code, "invalid_cursor");
  assert.equal(invalid.calls.filter((query) => query.cursor).length, 1);
});

test("later collection pages stay available and compact windows stay under 100 rows", async () => {
  const seen = [];
  const page = await collectPages({}, "/chats", {
    limit: 50,
    query: { unitId: "project:shop:executor-shop", listed: "true" },
    request: async (_api, _method, _path, options) => {
      seen.push(options.query.cursor ?? "");
      if (!options.query.cursor) {
        return { data: { items: [{ id: "page-1" }], total: 2, issues: [{ code: "malformed_record", message: "The record could not be read." }], nextCursor: "more" } };
      }
      return { data: { items: [{ id: "page-2" }], total: 2, issues: [], nextCursor: null } };
    },
  });
  assert.deepEqual(seen, ["", "more"]);
  assert.deepEqual(page.items.map((item) => item.id), ["page-1", "page-2"]);
  assert.equal(page.total, 2);
  assert.equal(page.nextCursor, null);
  assert.equal(page.issues[0].code, "malformed_record");

  const host = createTestDocument(1440).document.createElement("div");
  host.clientHeight = 900;
  const list = { scrollTop: 0, rowHeight: 36, height: 900, focusId: null };
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: `row-${index}`, kind: "editor", text: `Row ${index}`, pos: index + 1, setsize: 1200 }));
  renderWindow(host.ownerDocument, host, list, rows, {});
  const mounted = host.querySelectorAll("[data-row]").length;
  assert.equal(mounted < 100, true);
  assert.equal(mounted > 0, true);
  const spacers = [host.children[0], host.children.at(-1)];
  assert.deepEqual(spacers.map((spacer) => spacer.getAttribute("style")), [null, null]);
  assert.deepEqual(spacers.map((spacer) => spacer.style.height), ["0px", `${(1200 - mounted) * 36}px`]);
  list.scrollTop = 4000;
  const short = rows.slice(0, 6);
  short[5].text = "unit-1200 Out";
  renderWindow(host.ownerDocument, host, list, short, {});
  assert.equal(list.scrollTop, 0);
  assert.match([...host.querySelectorAll("[data-row]")].map((row) => row.textContent).join("\n"), /unit-1200/);

});

test("a stale collection generation cannot overwrite a newer page", () => {
  const store = createStore();
  const first = startCollection(store, "units");
  assert.equal(writeCollection(store, "units", first, { total: 4, status: "ready" }), true);
  const second = startCollection(store, "units");
  assert.equal(writeCollection(store, "units", first, { total: 9 }), false);
  assert.equal(store.pages.get("units").generation, second);
  assert.equal(store.pages.get("units").total, null);
});

test('hierarchy keeps aliases and duplicates in one cluster tree and reveals searched repositories', () => {
  const units = [sample('root:overseer', 'overseer', 'overseer', 'root', null), sample('root:overseer-old', 'overseer-old', 'overseer', 'root', null), sample('project:shop:a', 'same', 'executor', 'project', 'shop'), sample('project:blog:a', 'same', 'executor', 'project', 'blog')];
  const groups = [{ id: 'folder', title: 'Web', parentId: null, link: { kind: 'folder' }, members: [] }, ...Array.from({ length: 20 }, (_, i) => ({ id: 'repo-'+i, title: 'Repo '+i, parentId: 'folder', link: { kind: 'repository' }, members: i === 0 ? ['project:shop:a', 'project:blog:a'] : [] }))];
  const state = { shown: new Map(), collapsed: new Set() }, tree = buildHierarchy(units, [], groups);
  assert.ok(tree.hidden.includes('root:overseer-old'));
  const rows = flattenVisibleHierarchy(tree, state); assert.equal(rows.filter(row => row.kind === 'cluster').length, 7);
  assert.equal(rows.filter(row => row.unit?.unit === 'same').length, 2);
  const before = JSON.stringify([...state.shown]); assert.ok(flattenVisibleHierarchy(tree, state, 'Repo 19').some(row => row.groupId === 'repo-19')); assert.equal(JSON.stringify([...state.shown]), before);
  toggleGroup(state, 'cluster:folder'); assert.equal(flattenVisibleHierarchy(tree, state).filter(row => row.kind === 'cluster').length, 1);
  revealGroup(state, 'cluster:folder', 14); assert.equal(flattenVisibleHierarchy(tree, state).filter(row => row.kind === 'cluster').length, 21);
});

test("a reporting cycle is shown and keyboard focus reaches the final row", () => {
  const cycled = [
    sample("project:loop:a", "a", "executor", "project", "loop", "project:loop:b"),
    sample("project:loop:b", "b", "executor", "project", "loop", "project:loop:a"),
  ];
  const tree = buildHierarchy(cycled);
  assert.ok(tree.cycles.length > 0);
  const rows = flattenVisibleHierarchy(tree, { shown: new Map(), collapsed: new Set() }, "");
  assert.equal(rows.some((row) => row.kind === "issue"), true);

  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.height = 900;
  const many = numberedUnits(1200).map((unit, index) => ({ id: unit.id, kind: "unit", text: unit.unit, depth: 0, pos: index + 1, setsize: 1200 }));
  const host = createHost(900);
  renderWindow(host.ownerDocument, host, list, many, {});
  assert.ok(mounted(host).length < 100);
  moveFocus(list, many, "end");
  renderWindow(host.ownerDocument, host, list, many, {});
  assert.equal(list.focusId, "project:bulk:unit-1200");
  list.height = 581;
  host.clientHeight = 293;
  host.getBoundingClientRect = () => ({ top: 0, bottom: host.clientHeight });
  const Node = host.constructor;
  Node.prototype.getBoundingClientRect = function rect() {
    if (this.getAttribute?.("data-id") === "project:bulk:unit-1200") return { top: 864, bottom: 900 };
    return { top: 0, bottom: 36 };
  };
  const endEvent = { key: "End", target: { getAttribute: () => null }, preventDefault() {} };
  for (const fn of host.listeners.get("keydown")) fn(endEvent);
  assert.equal(list.focusId, "project:bulk:unit-1200");
  assert.ok(list.scrollTop >= (1200 * list.rowHeight) - host.clientHeight);
  assert.equal(mounted(host).some((node) => node.getAttribute("data-id") === list.focusId), true);
  const app = { store: createStore(), layout: "desktop" };
  activateUnit(app, { id: "project:bulk:unit-1200" }, "keyboard");
  assert.equal(app.store.selected.unitId, "project:bulk:unit-1200");
  assert.equal(app.pendingChat, undefined);
  activateUnit(app, { id: "project:shop:executor-shop" }, "double");
  assert.equal(app.pendingCenter, "project:shop:executor-shop");
  assert.equal(app.pendingChat.create, true);
  app.layout = "phone";
  activateUnit(app, { id: "root:master" }, "double");
  assert.equal(app.pendingChat.create, false);
});

function numberedUnits(count) {
  return Array.from({ length: count }, (_item, index) => sample(
    `project:bulk:unit-${String(index + 1).padStart(4, "0")}`,
    `unit-${String(index + 1).padStart(4, "0")}`,
    "executor",
    "project",
    "bulk",
    null,
    "out",
  ));
}

function sample(id, name, role, kind, scopeName, leadId = null, status = "idle") {
  return {
    id,
    unit: name,
    role,
    scope: kind === "root" ? { kind: "root", name: null } : { kind, name: scopeName },
    leadId,
    job: null,
    context: name,
    status,
  };
}

function page(items, total = items.length, nextCursor = null) {
  return { data: { items, total, nextCursor, issues: [] } };
}

function pagedList(items) {
  const calls = [];
  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.request = async (_api, _method, _path, options) => {
    calls.push({ ...options.query });
    const start = Number(options.query.cursor ?? 0);
    const limit = Number(options.query.limit);
    const slice = items.slice(start, start + limit);
    const next = start + limit < items.length ? String(start + limit) : null;
    return page(slice, items.length, next);
  };
  return { list, calls };
}

function faultList(items, code) {
  const calls = [];
  let failed = false;
  const list = createPagedList({ api: {}, store: createStore(), name: "units", route: "/units" });
  list.request = async (_api, _method, _path, options) => {
    calls.push({ ...options.query });
    if (options.query.cursor && !failed) {
      failed = true;
      const status = code === "invalid_cursor" ? 400 : 409;
      throw new ApiError(status, code, "The page cursor failed.");
    }
    const start = Number(options.query.cursor ?? 0);
    const limit = Number(options.query.limit);
    const slice = items.slice(start, start + limit);
    const next = start + limit < items.length ? String(start + limit) : null;
    return page(slice, items.length, next);
  };
  return { list, calls };
}

function createHost(height) {
  function Node(document) {
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.isConnected = true;
    this.className = "";
    this.textContent = "";
    this.tabIndex = 0;
  }
  Node.prototype.setAttribute = function setAttribute(name, value) { this.attributes.set(name, String(value)); };
  Node.prototype.getAttribute = function getAttribute(name) { return this.attributes.get(name) ?? null; };
  Node.prototype.addEventListener = function addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  };
  Node.prototype.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    for (const node of nodes) this.children.push(node);
  };
  Node.prototype.focus = function focus() { this.ownerDocument.activeElement = this; };
  const document = { activeElement: null };
  document.createElement = () => new Node(document);
  const host = new Node(document);
  host.clientHeight = height;
  host.ownerDocument = document;
  return host;
}

function mounted(host) {
  return [...host.children].filter((node) => node.getAttribute?.("data-row") === "true");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("the bounded home QR matches its golden matrices", () => {
  const payload = "http://192.168.1.23:43123/#home=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(qrDigest(encodeHomeQr(payload)), "83549c0a12eb68c8716657575309cb4255bb529bfd795aebb1570b256ec34549");
  assert.equal(qrDigest(encodeHomeQr("x".repeat(106))), "28571cbdad17176449c375be5ff4484c96ab69a72384c1fbe30595e2a902a1f5");
  assert.throws(() => encodeHomeQr("x".repeat(107)), RangeError);
  assert.throws(() => encodeHomeQr("café"), RangeError);
  const expiry = updateExpiry({ enabled: true, expiresAt: "2026-10-10T12:00:01.000Z" }, Date.parse("2026-10-10T12:00:00.000Z"));
  assert.equal(expiry.remainingSeconds, 1);
  assert.equal(expiry.expired, false);
  assert.equal(updateExpiry({ enabled: true, expiresAt: "2026-10-10T12:00:00.000Z" }, Date.parse("2026-10-10T12:00:00.000Z")).expired, true);
});

test("sync snapshots, service beats, and local expiry do not extend a grant", () => {
  const synced = applySyncSnapshot({ incoming: [{ machine: "LAPTOP" }] }, {
    state: "paused",
    pendingChanges: 4,
    limits: { state: "slowing", retryAt: "2099-01-01T00:00:10.000Z", messages: { used: 40, max: 60 }, syncBytes: { used: 8, max: 50 } },
    retryAt: "2099-01-01T00:00:10.000Z",
    error: null,
  });
  assert.equal(synced.state, "paused");
  assert.equal(synced.pendingChanges, 4);
  assert.equal(synced.limits.state, "slowing");
  assert.equal(synced.incoming[0].machine, "LAPTOP");
  assert.equal(limitsLabel("slowing"), "limitsSlowing");
  assert.equal(limitsLabel("paused"), "limitsPaused");
  assert.equal(limitsLabel("normal"), "limitsNormal");
  const service = applyServiceBeat({ machine: "DESKTOP", originKind: "folder" }, { id: "LAPTOP", version: "3.0.1", state: "running", answers: true });
  assert.equal(service.machine, "LAPTOP");
  assert.equal(service.originKind, "folder");
  assert.equal(applyServiceBeat({ machine: "DESKTOP", originKind: "folder" }, "DESKTOP").originKind, "folder");
  const issues = applyIssueChange([], { issue: { path: "a", code: "bad_record", message: "Unreadable" }, resolved: false });
  assert.equal(issues.length, 1);
  assert.equal(applyIssueChange(issues, { issue: issues[0], resolved: true }).length, 0);
  const expiresAt = "2099-01-01T00:00:10.000Z";
  const now = Date.parse("2099-01-01T00:00:00.000Z");
  const state = { home: { enabled: true, expiresAt }, grant: { key: "secret", shortCode: "1234", links: [], qrPayloads: ["payload"] }, tickMs: null };
  let scheduled = null;
  armExpiry(state, now, (fn, ms) => { scheduled = { fn, ms }; return 7; }, () => {});
  assert.equal(scheduled.ms, 10000);
  assert.equal(state.grant.key, "secret");
  state.tickMs = 1000;
  armExpiry(state, now, (fn, ms) => { scheduled = { fn, ms }; return 8; }, () => {});
  assert.equal(scheduled.ms, 1000);
  assert.equal(scheduled.ms <= 10000, true);
  const expired = { home: { enabled: true, expiresAt: "2020-01-01T00:00:00.000Z" }, grant: { key: "secret", shortCode: "1", links: ["http://127.0.0.1"], qrPayloads: ["payload"] } };
  let called = false;
  armExpiry(expired, Date.parse("2020-01-01T00:00:05.000Z"), () => { called = true; return 1; }, () => {});
  assert.equal(called, false);
  assert.equal(expired.grant, null);
});

test("home grants are replaced, expired and kept out of settings storage", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const settingsFile = join(fixture.root, "Cosmic", "onem1nd", "user", "gui", "settings.json");
  const before = await readFile(settingsFile);
  const current = await request(api, "GET", "/settings");
  assert.equal(Object.hasOwn(current.data.home, "key"), false);
  assert.equal(JSON.stringify(current.data).includes(FIXTURE_HOME_KEY), false);
  await assert.rejects(saveSettings(api, "0".repeat(64), { look: "high-contrast" }), (error) => error.code === "revision_conflict");
  assert.deepEqual(await readFile(settingsFile), before);
  const phoneToken = await exchangeHome(fixture, FIXTURE_HOME_KEY);
  const phone = apiFrom(`${fixture.origin}/#session=${phoneToken}`);
  await assert.rejects(saveSettings(phone, current.data.revision, { language: "es" }), (error) => error.code === "phone_read_only");
  await assert.rejects(openHome(phone), (error) => error.code === "phone_read_only");
  await assert.rejects(openHome(api, ["8.8.8.8"]), (error) => error.code === "invalid_home_address");
  await assert.rejects(openHome(api, ["192.168.1.23", "192.168.1.23"]), (error) => error.code === "invalid_home_address");
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 200);
  const operation = createOperation({
    method: "POST",
    path: "/settings/home-network",
    body: { enabled: true, addresses: ["192.168.1.23", "192.168.1.24"] },
  });
  const opened = await request(api, "POST", "/settings/home-network", { operation });
  const repeated = await retryOperation(api, operation);
  assert.equal(opened.status, 201);
  assert.equal(repeated.data.key, opened.data.key);
  assert.deepEqual(opened.data.qrPayloads, opened.data.links);
  assert.equal(opened.data.links[0].startsWith("http://192.168.1.23:"), true);
  assert.equal(opened.data.links[1].startsWith("http://192.168.1.24:"), true);
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 401);
  assert.equal((await exchangeRaw(fixture, opened.data.key)).status, 200);
  assert.equal(JSON.stringify((await request(api, "GET", "/settings")).data).includes(opened.data.key), false);
  await assertAbsent(fixture.root, opened.data.key);
  const state = { grant: null, home: null, expectGrant: true, selected: 0 };
  takeGrant(state, opened.data);
  noteHomeChange(state, { reason: "replaced", home: { enabled: true, openedAt: opened.data.openedAt, expiresAt: opened.data.expiresAt, addresses: opened.data.addresses, remainingSeconds: 1 } });
  assert.equal(state.grant.key, opened.data.key);
  noteHomeChange(state, { reason: "replaced", home: { enabled: true, openedAt: "2026-10-10T13:00:00.000Z", expiresAt: "2026-10-11T01:00:00.000Z", addresses: [], remainingSeconds: 1 } });
  assert.equal(state.grant, null);
  applySettingsRead(state, { settings: { look: "modern" }, revision: "a".repeat(64), service: {}, home: { enabled: true, key: opened.data.key, expiresAt: opened.data.expiresAt } });
  assert.equal(state.grant, null);
  const closed = await closeHome(api);
  assert.equal(closed.data.enabled, false);
  assert.equal((await exchangeRaw(fixture, opened.data.key)).status, 410);
  clearGrant(state);
  const saved = await saveSettings(api, current.data.revision, { language: "es" });
  assert.equal(saved.data.settings.language, "es");
  assert.equal(saved.data.settings.look, "modern");
});

test("a failed home binding leaves no active grant", async (t) => {
  const fixture = await createGuiFixture({ scenario: "home-bind-failure" });
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  await assert.rejects(openHome(api, ["192.168.1.23"]), (error) => error.code === "listener_unavailable");
  const settings = await request(api, "GET", "/settings");
  assert.equal(settings.data.home.enabled, false);
  assert.equal((await exchangeRaw(fixture, FIXTURE_HOME_KEY)).status, 410);
});

for (const reason of ["closed", "expired", "replaced"]) test(`a ${reason} home event clears the phone session without closing the desktop viewer`, async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(phone.app));
  t.after(() => dispose(desktop.app));
  await waitFor(() => phone.root.querySelector(".shell") && desktop.root.querySelector(".shell"), "The viewers did not open.");
  const desktopToken = desktop.app.api.token;
  await fixture.control.emit("home.changed", { reason, home: { enabled: false } });
  await waitFor(() => phone.root.querySelector('[data-phone-state="ended"]'), "The closed phone session did not show reopening guidance.");
  assert.equal(phone.app.api.token, null);
  assert.equal(phone.app.api.homeKey, null);
  assert.equal(phone.app.api.live.stopped, true);
  assert.equal(phone.root.querySelector(".shell"), null);
  assert.equal(phone.root.querySelector(".gate")?.querySelector("p")?.textContent, text(phone.app.language, 'phoneAccessEndedBody'));
  assert.equal(phone.root.querySelector('[data-home-code]'), null);
  assert.equal(phone.app.store.view, null);
  assert.equal(phone.app.store.indexes.units.size, 0);
  assert.equal(phone.app.unitList, null);
  assert.equal(phone.app.inputDrafts ?? null, null);
  click(phone.root.querySelector('[data-action="phone-new-code"]'));
  assert.equal(phone.root.querySelectorAll('[data-code-cell]').length, 6);
  renderShell(phone.app);
  assert.equal(phone.root.querySelector(".shell"), null);
  assert.equal(desktop.app.api.token, desktopToken);
  assert.ok(desktop.root.querySelector(".shell"));
});

test("a home code is cleared before it is sent and a bad code keeps no secret", async (t) => {
  const document = createTestDocument().document;
  let submitted = null;
  const form = renderCodeEntry(document, (key) => text("en", key), (code) => { submitted = code; });
  const input = form.querySelector("[data-home-code]");
  input.value = "ab23cd";
  form.listeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(submitted, "AB23CD");
  assert.equal(input.value, "");
  const nav = renderPhone(document, (key) => text("en", key), ["hierarchy", "chats", "waiting"], "hierarchy", () => undefined, () => null);
  assert.deepEqual([...nav.querySelectorAll("[data-phone-mode]")].map((node) => node.getAttribute("data-phone-mode")), ["hierarchy", "chats", "waiting"]);

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const home = new URL(fixture.phoneUrl);
  let sent = null;
  const api = createApi({
    location: { origin: home.origin, pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    fetch: async (url, init) => {
      sent = JSON.parse(init.body);
      return jsonEnvelope(200, { token: "phone-token", audience: "phone", capabilities: PHONE, expiresAt: "2026-10-11T00:00:00.000Z" });
    },
  });
  const credential = await exchangeCode(api, "ab23cd");
  assert.deepEqual(sent, { code: "AB23CD" });
  assert.equal(credential.audience, "phone");
  assert.equal(api.homeKey, null);
  assert.equal(api.token, "phone-token");

  const invalid = apiFrom(`${home.origin}/`);
  await assert.rejects(exchangeCode(invalid, "abcdef"), (error) => error.code === "invalid_home_key" && error.status === 401);
  assert.equal(invalid.token, null);
  assert.equal(invalid.homeKey, null);
  const parsedHome = new URL(fixture.phoneUrl);
  let cleared = "";
  const fragment = createApi({
    location: { origin: parsedHome.origin, pathname: parsedHome.pathname, search: parsedHome.search, hash: parsedHome.hash },
    history: { replaceState(_state, _title, next) { cleared = String(next); } },
    fetch: globalThis.fetch.bind(globalThis),
  });
  assert.equal(fragment.homeKey, FIXTURE_HOME_KEY);
  assert.equal(cleared.includes("home="), false);
  assert.equal(cleared.includes(FIXTURE_HOME_KEY), false);
  const exchanged = await exchangeHomeFragment(fragment);
  assert.equal(exchanged.audience, "phone");
  assert.equal(fragment.homeKey, null);
  assert.equal(fragment.token, exchanged.token);
  const again = await exchangeCode(apiFrom(`${home.origin}/`), FIXTURE_HOME_CODE);
  assert.equal(again.expiresAt, exchanged.expiresAt);
});

test('one accessible code input paints six cells, normalizes paste and backspace, and clears every cell on submit', () => {
  const { document } = createTestDocument();
  let submitted;
  const form = renderCodeEntry(document, key => text('en', key), code => { submitted = code; });
  const input = form.querySelector('[data-home-code]');
  assert.equal(form.querySelectorAll('input').length, 1);
  assert.equal(form.querySelectorAll('[data-code-cell]').length, 6);
  assert.equal(input.getAttribute('aria-label'), text('en', 'homeCode'));
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(form.querySelector('.phone-code-cells').getAttribute('aria-hidden'), 'true');
  const button = form.querySelector('button');
  assert.equal(button.disabled, true);
  let prevented = false;
  input.listeners.get('paste')[0]({ preventDefault() { prevented = true; }, clipboardData: { getData: () => ' k7p-4qx ' } });
  assert.equal(prevented, true);
  assert.equal(input.value, 'K7P4QX');
  assert.equal(button.disabled, false);
  typeInput(input, 'K7P4Q', 5, 5);
  assert.equal(button.disabled, true);
  assert.equal(form.querySelectorAll('[data-code-cell]')[5].textContent, '');
  typeInput(input, 'k7p4qx', 6, 6);
  form.listeners.get('submit')[0]({ preventDefault() {} });
  assert.equal(submitted, 'K7P4QX');
  assert.equal(input.value, '');
  assert.equal(form.querySelectorAll('[data-filled="true"]').length, 0);
});

test('pairing errors keep only server counters and lock dates, with no reply credential or entered code', async () => {
  const api = apiFrom('http://127.0.0.1:43123/');
  api.fetch = async () => ({ ...jsonEnvelope(401, null), text: async () => JSON.stringify({ error: {
    code: 'invalid_home_key', message: 'reply-secret K7P4QX', details: { triesLeft: 4, token: 'reply-secret', code: 'K7P4QX' },
  } }) });
  await assert.rejects(exchangeCode(api, 'K7P4QX'), error => {
    assert.deepEqual(error.details, { triesLeft: 4 });
    assert.equal(JSON.stringify(error).includes('reply-secret'), false);
    assert.equal(error.message.includes('K7P4QX'), false);
    return error.code === 'invalid_home_key';
  });
  assert.equal(api.uncertain.size, 0);
  assert.equal(api.token, null);
  assert.equal(api.homeKey, null);
});

test('pairing renders four server counts, locks without submit, and accepts a replacement grant immediately', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const origin = new URL(fixture.phoneUrl).origin;
  const phone = await bootApp(`${origin}/`, 390, []); t.after(() => dispose(phone.app));
  phone.app.api.now = () => fixtureNow;
  let fixtureNow = Date.parse('2026-10-10T12:00:00.000Z');
  assert.equal(phone.view.innerHeight, 844);
  assert.equal(phone.root.querySelector('[data-phone-state]').getAttribute('data-phone-state'), 'pair');
  for (let count = 4; count >= 1; count -= 1) {
    const input = phone.root.querySelector('[data-home-code]');
    typeInput(input, '000000', 6, 6);
    const form = phone.root.querySelector('[data-code-entry]');
    form.listeners.get('submit')[0]({ preventDefault() {} });
    assert.equal(input.value, '');
    assert.equal(phone.app.phoneCode ?? null, null);
    await waitFor(() => phone.root.querySelector('[data-tries-left]')?.getAttribute('data-tries-left') === String(count), 'Server attempts were not rendered.');
    assert.equal(phone.root.querySelector('[data-home-code]').getAttribute('aria-invalid'), 'true');
  }
  typeInput(phone.root.querySelector('[data-home-code]'), '000000', 6, 6);
  phone.root.querySelector('[data-code-entry]').listeners.get('submit')[0]({ preventDefault() {} });
  await waitFor(() => phone.root.querySelector('[data-phone-state="locked"]'), 'Pairing did not lock.');
  assert.equal(phone.root.querySelector('[data-code-entry]'), null);
  assert.equal(phone.root.querySelector('button'), null);
  await fixture.control.advance(599999); fixtureNow += 599999;
  await assert.rejects(exchangeCode(apiFrom(`${origin}/`), FIXTURE_HOME_CODE), { code: 'pairing_locked' });
  await fixture.control.advance(1); fixtureNow += 1;
  renderShell(phone.app);
  assert.ok(phone.root.querySelector('[data-home-code]'));
  await exchangeCode(apiFrom(`${origin}/`), FIXTURE_HOME_CODE);
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(exchangeCode(apiFrom(`${origin}/`), '000000'));
  const next = await openHome(apiFrom(fixture.desktopUrl));
  const replacement = await bootApp(`${origin}/#home=${next.data.key}`, 390, []); t.after(() => dispose(replacement.app));
  await waitFor(() => replacement.root.querySelector('.shell'), 'The replacement grant did not unlock pairing.');
  assert.equal(replacement.app.store.audience, 'phone');
  await assertAbsent(fixture.root, next.data.shortCode);
  await assertAbsent(fixture.root, replacement.app.api.token);
});

test('a phone shows computer guidance for push asks and ordinary controls for session.open in both languages', () => {
  const { document } = createTestDocument();
  for (const language of ['en', 'es']) {
    const t = key => text(language, key);
    const push = renderApproval(document, { id: 'push', state: 'pending', display: 'Build', desktopOnly: true }, t, () => assert.fail('Phone push action'), false, false);
    assert.equal(push.querySelectorAll('button').length, 0);
    assert.equal(push.querySelector('[data-computer-required]').textContent, t('phoneComputerRequired'));
    const session = renderApproval(document, { id: 'session', state: 'pending', action: 'session.open', pattern: { client: 'codex', machine: 'DESKTOP' }, desktopOnly: false, alwaysAllowed: false }, t, () => {}, false, false);
    assert.deepEqual(session.querySelectorAll('button').map(button => button.getAttribute('data-action')), ['approve', 'deny']);
  }
});

test('phone chat cards belong to its existing conversation, require a review note and preserve authority when widened', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const requests = [];
  const phone = await bootApp(fixture.phoneUrl, 390, [], (url, init) => requests.push({ path: new URL(url).pathname, method: init.method }));
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.chatList?.catalog?.length, 'Phone conversations did not load.');
  const unit = phone.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  phone.app.activeHandlers.onActivate({ id: unit.id, kind: 'unit', unit }, 'double');
  await waitFor(() => phone.root.querySelector('[data-phone-card="review"]'), 'In-place review did not load.');
  assert.equal(phone.app.activeRows.some(row => row.unit?.role === 'master'), false);
  assert.equal(requests.some(item => item.method === 'POST' && item.path === '/api/v1/chats'), false);
  const review = phone.root.querySelector('[data-task="project:shop:029"]');
  assert.equal(review.querySelector('[data-action="accept"]').disabled, false);
  assert.equal(review.querySelector('[data-action="send-back"]').disabled, true);
  typeInput(review.querySelector('[data-note]'), 'Please repeat the checks', 0, 23);
  assert.equal(review.querySelector('[data-action="send-back"]').disabled, false);
  const notReady = phone.root.querySelector('[data-task="project:shop:030"]');
  assert.equal(notReady.querySelector('[data-action="accept"]').disabled, true);
  assert.equal(notReady.querySelector('[data-action="send-back"]').disabled, true);
  phone.view.innerWidth = 1440; renderShell(phone.app);
  assert.equal(phone.root.querySelector('[data-action="approve-always"]'), null);
  assert.equal(phone.root.querySelector('[data-action="undo"]'), null);
  assert.equal(phone.root.querySelector('[data-action="mailbox"]'), null);
  const approval = (await request(phone.app.api, 'GET', '/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ecf')).data;
  await assert.rejects(answerApproval(phone.app.api, approval, 'approve-always'), { code: 'phone_read_only' });
  assert.equal((await request(phone.app.api, 'GET', `/approvals/${approval.id}`)).data.state, 'pending');
});

test("replaced and expired home codes are rejected and attempts are rate limited", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = apiFrom(fixture.desktopUrl);
  const opened = await openHome(desktop, ["192.168.1.23"]);
  const home = new URL(fixture.phoneUrl).origin;
  await assert.rejects(exchangeCode(apiFrom(`${home}/`), FIXTURE_HOME_CODE), (error) => error.code === "invalid_home_key");
  const lowered = await exchangeCode(apiFrom(`${home}/`), opened.data.shortCode.toLowerCase());
  assert.equal(lowered.expiresAt, opened.data.expiresAt);
  assert.equal((await exchangeCode(apiFrom(`${home}/`), opened.data.shortCode)).expiresAt, lowered.expiresAt);
  await fixture.control.advance(12 * 60 * 60 * 1000);
  await assert.rejects(exchangeCode(apiFrom(`${home}/`), opened.data.shortCode), (error) => error.code === "home_expired" && error.status === 410);

  const limited = await createGuiFixture();
  t.after(() => limited.close());
  const limitedHome = new URL(limited.phoneUrl).origin;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(exchangeCode(apiFrom(`${limitedHome}/`), "ABCDEF"), (error) => error.code === "invalid_home_key" && error.details.triesLeft === 4 - attempt);
  }
  await assert.rejects(exchangeCode(apiFrom(`${limitedHome}/`), "ABCDEF"), (error) => error.code === "pairing_locked" && error.retryAfter === 600_000);
});

test("a mounted map persists a drag with the loaded revision and keeps a later in-flight drag", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release = null;
  let held = false;
  const patches = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (_input, init) => {
    if (init?.method !== "PATCH" || !String(init.body ?? "").includes("expectedRevision")) return;
    const body = JSON.parse(init.body);
    if (!body.nodes) return;
    const headers = init.headers ?? {};
    patches.push({ id: headers["Idempotency-Key"], body });
    if (!held) {
      held = true;
      await new Promise((resolve) => { release = resolve; });
    }
  });
  t.after(() => dispose(desktop.app));
  await until(() => desktop.app.mapState?.authoritative?.revision);
  const revision = desktop.app.mapState.authoritative.revision;
  const loaded = await request(desktop.app.api, "GET", "/layout");
  assert.equal(revision, loaded.data.revision);
  const map = desktop.app.mapState;
  const id = "root:master";
  const origin = map.positions[id];
  queueLayoutPatch(map, id, { x: origin.x + 20, y: origin.y });
  const saving = flushLayout(map);
  await until(() => patches.length === 1);
  queueLayoutPatch(map, id, { x: origin.x + 40, y: origin.y });
  release();
  await saving;
  await until(() => patches.length === 2);
  assert.equal(patches[0].body.expectedRevision, revision);
  assert.equal(patches[0].body.nodes[id].x, origin.x + 20);
  assert.notEqual(patches[0].id, patches[1].id);
  assert.equal(patches[1].body.nodes[id].x, origin.x + 40);
  const stored = await request(desktop.app.api, "GET", "/layout");
  assert.equal(stored.data.layout.nodes[id].x, origin.x + 40);
  assert.notEqual(stored.data.revision, revision);
  assert.notEqual(patches[1].body.expectedRevision, null);
  assert.notEqual(patches[1].body.expectedRevision, revision);
});

test("phone boot never calls viewer routes and a narrow desktop token stays desktop", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, urls);
  t.after(() => dispose(phone.app));
  await until(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone");
  const beforeReset = urls.length;
  await applyReset(phone.app.store, phone.app.api);
  assert.equal(phone.app.store.paused, false);
  assert.equal(phone.app.store.failure, null);
  assert.equal(urls.slice(beforeReset).some((url) => url.includes("/viewer")), false);
  assert.equal(phone.app.embed ?? null, null);
  assert.equal(phone.view.innerWidth, 390);
  navigate(phone.app, "map");
  navigate(phone.app, "blueprint");
  navigate(phone.app, "settings");
  assert.equal(phone.app.mode, "hierarchy");
  assert.equal(phone.root.querySelectorAll(".mode").length, 2);
  assert.equal(phone.root.querySelector("[data-action='new-cluster']"), null);
  assert.equal(phone.root.querySelector("[aria-label='Settings']"), null);
  assert.equal(phone.root.querySelector(".stage"), null);
  assert.equal((phone.root.textContent ?? "").includes("This screen is not ready yet."), false);
  const overseer = phone.app.unitList.catalog.find((unit) => unit.id === "root:overseer");
  phone.app.activeHandlers.onActivate({ id: overseer.id, kind: "unit", unit: overseer }, "double");
  await until(() => phone.app.phoneChatNote === true);
  assert.equal(phone.root.querySelector("[data-phone-chat='required']")?.textContent, "A desktop conversation is required.");
  const executor = phone.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  phone.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await until(() => phone.root.querySelector("[data-composer]") && phone.app.thread?.chat?.members?.includes(executor.id));
  assert.equal(phone.root.querySelector("[data-action='pin']"), null);
  await until(() => phone.app.inspectorData?.unitId === executor.id);
  phone.app.waitingList.height = 20000;
  navigate(phone.app, "waiting");
  await until(() => phone.root.querySelector("[data-waiting-surface]")?.querySelector("[data-task='project:shop:029']"));
  click(phone.root.querySelector("[data-waiting-surface]").querySelector("[data-task='project:shop:029']"));
  await until(() => phone.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"));
  const review = phone.root.querySelector("[data-waiting-record='review']");
  assert.equal(review?.querySelector("[data-action='accept']")?.disabled, false);
  assert.equal(review?.querySelector("[data-action='send-back']")?.disabled, true);
  typeInput(review.querySelector('[data-note]'), 'Needs another pass', 0, 18);
  assert.equal(review.querySelector('[data-action="send-back"]').disabled, false);
  assert.equal(phone.root.querySelector("[data-task='project:shop:030']"), null);
  assert.equal(phone.root.querySelector("[data-action='undo']"), null);
  assert.equal(phone.root.querySelector("[data-action='revoke-grant']"), null);
  phone.view.innerWidth = 1440;
  renderShell(phone.app);
  assert.equal(phone.root.querySelector(".shell").getAttribute("data-layout"), "phone");

  const directId = deterministicUuid(["direct-chat", ["project:shop:executor-shop", "root:master"].sort()]);
  const message = createOperation({
    method: "POST",
    path: "/chats/:chatId/messages",
    params: { chatId: directId },
    body: { body: "On my way", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  await request(phone.app.api, "POST", message.path, { operation: message });
  await retryOperation(phone.app.api, message);
  const returning = (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:030" } })).data;
  await assert.rejects(changeTaskStatus(phone.app.api, returning, "open", "Needs another pass"), (error) => error.code === "phone_read_only");
  await changeTaskStatus(phone.app.api, (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:029" } })).data, "done");
  const mailboxOperation = createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/messages",
    params: { unitId: "root:master" },
    body: { body: "Seen from the phone", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  const mailbox = await request(phone.app.api, "POST", mailboxOperation.path, { operation: mailboxOperation });
  await markMailboxRead(phone.app.api, "root:master", [mailbox.data.id]);
  const agentMail = createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/messages",
    params: { unitId: "project:shop:executor-shop" },
    body: { body: "From the phone", subject: "", replyTo: null, attachments: [], priority: "normal" },
  });
  const agentMessage = await request(phone.app.api, "POST", agentMail.path, { operation: agentMail });
  assert.equal(agentMessage.data.body, "From the phone");
  await assert.rejects(markMailboxRead(phone.app.api, "project:shop:executor-shop", [agentMessage.data.id]), (error) => error.code === "phone_read_only");
  const approval = (await request(phone.app.api, "GET", "/approvals/e80a0bf9-8fb4-4d64-9527-04524c9a2ecf")).data;
  await answerApproval(phone.app.api, approval, "approve");
  await delay(200);
  assert.equal(urls.some((url) => url.includes("/viewer")), false);

  const denied = [
    ["POST", "/units", {}],
    ["PUT", "/units/:unitId/lead", { unitId: "root:overseer" }],
    ["POST", "/units/:unitId/session", { unitId: "root:overseer" }],
    ["POST", "/sessions/:sessionId/stop", { sessionId: "00000000-0000-4000-8000-000000000000" }],
    ["PATCH", "/layout", {}],
    ["POST", "/chats", {}],
    ["PATCH", "/chats/:chatId", { chatId: directId }],
    ["PATCH", "/settings", {}],
    ["POST", "/settings/home-network", {}],
    ["DELETE", "/units/:unitId/approval-grants/:grantId", { unitId: "project:shop:executor-shop", grantId: "f605f169-8686-4a88-a213-7ca19703fd41" }],
    ["POST", "/tasks/:taskId/undo", { taskId: "project:shop:027" }],
    ["POST", "/editors/register", {}],
    ["POST", "/editors/:resourceId/comments", { resourceId: "missing" }],
    ["POST", "/void/texts/:resourceId/proposals/:proposalId/answer", { resourceId: "missing", proposalId: "missing" }],
    ["POST", "/watch", {}],
    ["PATCH", "/viewer", {}],
    ["POST", "/blueprint/boards", {}],
    ["POST", "/editors/:resourceId/assets", { resourceId: "missing" }],
  ];
  for (const [method, path, params] of denied) {
    const operation = createOperation({ method, path, params, body: {} });
    await assert.rejects(request(phone.app.api, method, operation.path, { operation }), (error) => error.status === 403 && error.code === "phone_read_only", `${method} ${path}`);
  }
  await assert.rejects(request(phone.app.api, "GET", "/viewer"), (error) => error.status === 403 && error.code === "phone_read_only");
  const closed = (await request(phone.app.api, "GET", "/tasks/:taskId", { params: { taskId: "project:shop:026" } })).data;
  await assert.rejects(changeTaskStatus(phone.app.api, closed, "closed"), (error) => error.code === "phone_read_only");

  const desktopUrls = [];
  const desktop = await bootApp(fixture.desktopUrl, 390, desktopUrls);
  t.after(() => dispose(desktop.app));
  await until(() => desktop.root.querySelector(".shell")?.getAttribute("data-layout") === "desktop");
  assert.equal(desktop.view.innerWidth, 390);
  assert.equal(shellLayout(desktop.app.store.capabilities), "desktop");
});

test("embedded viewers accept only their parent and logout is idempotent", async (t) => {
  const parent = fakeParent();
  const other = fakeParent();
  const calls = [];
  const channel = startEmbedChannel({
    embedded: true,
    hostOrigin: "http://127.0.0.1:9",
    viewerId: "viewer-a",
    capabilities: DESKTOP,
  }, {
    patchViewer: async (body) => { calls.push(body); },
    logout: async () => { calls.push("logout"); },
  }, parent.transport);
  const sibling = startEmbedChannel({
    embedded: true,
    hostOrigin: "http://127.0.0.1:9",
    viewerId: "viewer-b",
    capabilities: DESKTOP,
  }, {
    patchViewer: async (body) => { calls.push(["b", body]); },
    logout: async () => { calls.push("logout-b"); },
  }, other.transport);
  publishReady(channel);
  publishDirty(channel, 1);
  assert.deepEqual(parent.parent.sent.data, {
    contract: "hivem1nd-embed-v1", // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    viewerId: "viewer-a",
    type: "dirty",
    value: true,
  });
  assert.equal(parent.parent.sent.origin, "http://127.0.0.1:9");
  publishReady(sibling);
  assert.equal(other.parent.sent.data.viewerId, "viewer-b");
  assert.equal(parent.parent.sent.data.viewerId, "viewer-a");
  const forged = [
    { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    { source: parent.parent, origin: "https://evil.example", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "modern" } }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "other", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "neon" } }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: false } }, // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  ];
  for (const event of forged) await handleParentMessage(channel, event);
  assert.deepEqual(calls, []);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-language", value: "es" } }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  await handleParentMessage(sibling, { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "high-contrast" } }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.deepEqual(calls[0], { language: "es" });
  assert.deepEqual(calls[1], ["b", { look: "high-contrast" }]);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: null } }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  assert.equal(calls.at(-1), "logout");
  disposeEmbed(channel);
  publishDirty(channel, false);
  assert.equal(parent.parent.sent.data.type, "dirty");
  assert.equal(parent.parent.sent.data.value, true);

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const secret = await bootstrapSecret(fixture.root);
  const first = await localViewer(fixture, secret, { look: null, language: null });
  const second = await localViewer(fixture, secret, { look: "modern", language: "en" });
  const left = apiFrom(first.url);
  const right = apiFrom(second.url);
  await request(left, "POST", "/watch", { operation: createOperation({ method: "POST", path: "/watch", body: { unitId: "root:master" } }) });
  assert.equal(fixture.control.watchCount(), 1);
  const patched = await request(left, "PATCH", "/viewer", {
    operation: createOperation({ method: "PATCH", path: "/viewer", body: { look: "high-contrast", language: "es", dirty: true } }),
  });
  assert.equal(patched.data.look, "high-contrast");
  assert.equal(patched.data.dirty, true);
  const untouched = await request(right, "GET", "/viewer");
  assert.equal(untouched.data.viewerId, second.viewerId);
  assert.equal(untouched.data.look, "modern");
  assert.equal(untouched.data.dirty, false);
  const settings = await request(apiFrom(fixture.desktopUrl), "GET", "/settings");
  assert.equal(settings.data.settings.look, "modern");
  assert.equal(settings.data.settings.language, "en");
  const gone = await logout(left);
  assert.equal(gone.status, 204);
  assert.equal(left.token, null);
  assert.equal(fixture.control.watchCount(), 0);
  let fetched = false;
  left.fetch = async () => { fetched = true; throw new Error("logout fetched twice"); };
  assert.equal((await logout(left)).status, 204);
  assert.equal(fetched, false);
  assert.equal((await request(right, "GET", "/viewer")).data.viewerId, second.viewerId);
  await assert.rejects(request(apiFrom(first.url), "POST", "/sessions/none/stop", {
    operation: createOperation({ method: "POST", path: "/sessions/none/stop", body: {} }),
  }), (error) => error.status === 401);
});

test("session, approval and grant outcomes use the contract events", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === executor.id, "The inspector did not open.");
  const overseer = (await request(desktop.app.api, "GET", "/units/:unitId", { params: { unitId: "root:overseer" } })).data;
  const started = await startSession(desktop.app.api, overseer, "cursor", null, null, { runMode: "chat" });
  await waitFor(() => desktop.app.sessionRequestId === started.data.requestId && noteText(desktop) === "The session is queued.", "The session request event did not arrive.");
  await fixture.control.patchSession(started.data.requestId, "failed", "launch_ambiguous");
  const beforeReset = urls.length;
  const firstMark = desktop.app.trackedAt ?? 0;
  await fixture.control.emit("stream.reset", { reason: "service_restarted", cursor: "0" });
  await waitFor(() => (desktop.app.trackedAt ?? 0) > firstMark && noteText(desktop) === text('en', 'launchAmbiguous') && urls.slice(beforeReset).some((url) => url.includes(`/session-requests/${started.data.requestId}`)), "The session request was not reread.");

  const pendingId = "e80a0bf9-8fb4-4d64-9527-04524c9a2ecf";
  const approvalCard = () => desktop.root.querySelector(`.card[data-approval="${pendingId}"]`);
  click(approvalCard()?.querySelector("[data-action='deny']"));
  await waitFor(() => desktop.app.answerId && noteText(desktop) === "Answer queued.", "The queued denial was not shown.");
  assert.notEqual(noteText(desktop), "Approved");
  assert.equal(approvalCard()?.getAttribute("data-approval-state"), "answering");
  const beforeAnswer = urls.length;
  const answerMark = desktop.app.trackedAt ?? 0;
  await fixture.control.emit("stream.reset", { reason: "cursor_expired", cursor: "0" });
  await waitFor(() => (desktop.app.trackedAt ?? 0) > answerMark && urls.slice(beforeAnswer).some((url) => url.includes(`/approvals/${pendingId}/answers/${desktop.app.answerId}`)), "The answer was not reread.");
  await fixture.control.settleAnswer(desktop.app.answerId, "applied");
  await waitFor(() => noteText(desktop) === "Denied" && approvalCard()?.getAttribute("data-approval-state") === "denied", "The denial was labeled as an approval.");
  assert.equal(urls.some((url) => url.includes("/waiting")), true);
  assert.equal(urls.some((url) => url.includes("/approval-grants")), true);

  const grantId = "f605f169-8686-4a88-a213-7ca19703fd41";
  click(desktop.root.querySelector(`[data-grant="${grantId}"]`));
  await waitFor(() => desktop.app.revocationRequestId, "The revocation was not tracked.");
  await fixture.control.settleRevocation(desktop.app.revocationRequestId);
  await waitFor(() => desktop.root.querySelector(`[data-grant="${grantId}"]`) == null && noteText(desktop) === "The grant was revoked.", "The revoked grant stayed in the inspector.");

  const extraId = "11111111-1111-4111-8111-111111111111";
  const sample = desktop.app.inspectorData.approvals[0];
  await fixture.control.emit("approval.requested", { approval: { ...sample, id: extraId, display: "Extra request", state: "pending" } });
  await waitFor(() => desktop.root.querySelector(`[data-approval="${extraId}"]`), "The requested approval did not appear.");
});


test("Enter in the composer sends the message and Shift+Enter does not", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length > 1, "The chat list did not load.");
  navigate(desktop.app, "chats");
  const [first] = desktop.app.chatList.catalog;
  desktop.app.activeHandlers.onActivate({ id: first.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  const press = (key, shiftKey = false) => { for (const handler of desktop.root.querySelector("[data-composer]").listeners.get("keydown") ?? []) handler({ key, shiftKey, isComposing: false, preventDefault() {} }); };
  typeInput(desktop.root.querySelector("[data-composer]"), "Sent with Enter", 15, 15);
  press("Enter", true);
  assert.equal(desktop.root.querySelector("[data-composer]").value, "Sent with Enter", "Shift+Enter keeps the text");
  press("Enter");
  await waitFor(() => desktop.app.thread?.messages?.some((message) => message.body === "Sent with Enter") && desktop.root.querySelector("[data-composer]")?.value === "", "Enter did not send the message.");
});

test("R13 Send back confirms in its dialog and incoming renders keep chat text and return notes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length > 1, "The chat list did not load.");
  navigate(desktop.app, "chats");
  const [first, second] = desktop.app.chatList.catalog;
  desktop.app.activeHandlers.onActivate({ id: first.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]"), "The first chat did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Unsent hello", 6, 11);
  await fixture.control.emit("service.changed", { machine: "DESKTOP" });
  await waitFor(() => desktop.root.querySelector("[data-composer]")?.value === "Unsent hello", "The unsent chat text was erased.");
  const restored = desktop.root.querySelector("[data-composer]");
  assert.equal(desktop.document.activeElement, restored);
  assert.equal(restored.selectionStart, 6);
  assert.equal(restored.selectionEnd, 11);
  desktop.app.activeHandlers.onActivate({ id: second.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === second.id && desktop.root.querySelector("[data-composer]")?.value === "", "The second chat reused the first draft.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Second draft", 0, 6);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-composer]").value, "Second draft");
  desktop.app.activeHandlers.onActivate({ id: first.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]")?.value === "Unsent hello", "The first draft was lost while switching chats.");
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.app.thread?.chat?.id === first.id && desktop.root.querySelector("[data-composer]")?.value === "", "The sent chat draft remained.");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "Needs another pass", 6, 13);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").value, "Needs another pass");
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").selectionStart, 6);
  click(desktop.root.querySelector("[data-task='project:shop:030']")?.querySelector("[data-action='send-back']"));
  const sendBack = desktop.document.querySelector('dialog');
  assert.equal(sendBack.querySelector('h2').textContent, text('en', 'sendBackTaskTitle'));
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").value, "Needs another pass");
  click(sendBack.querySelector('button.primary'));
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']")?.value === "", "The sent return note remained.");
});

test("visible sent lines do not acknowledge the recipient and agents have no separate mailbox surface", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === chat.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Visible line", 0, 12);
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.app.thread.messages.some(message => message.body === 'Visible line' && !message.pending), 'The send did not settle.');
  assert.equal(desktop.app.thread.messages.find(message => message.body === 'Visible line').read, false);

  const transcript = desktop.root.querySelector(".transcript");
  transcript._scrollHeight = transcript.clientHeight + 80;
  transcript.scrollTop = 0;
  desktop.app.thread.nearBottom = false;
  for (const handler of transcript.listeners.get("scroll") ?? []) handler();
  assert.equal(desktop.app.thread.nearBottom, false);
  await fixture.control.emit("message.created", {
    chatId: chat.id,
    mailboxId: null,
    message: { id: "away-from-bottom", body: "Away from the bottom", timestamp: "2099-01-01T00:00:00.000Z", read: false },
  });
  await waitFor(() => desktop.root.querySelector("[data-new-messages]")?.textContent === "New messages", "A message away from the bottom was treated as visible.");

  const mailboxReads = () => urls.filter((url) => /\/mailboxes\/[^ ?]+\/read/.test(url)).length;
  const beforeReads = mailboxReads();
  assert.equal(desktop.root.querySelector("[data-action='mailbox']"), null);
  assert.equal(desktop.root.querySelector('[data-mailbox-view]'), null);
  assert.equal(mailboxReads(), beforeReads);

  const phoneUrls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, phoneUrls);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const phoneChat = phone.app.chatList.catalog[0];
  phone.app.activeHandlers.onActivate({ id: phoneChat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector('[data-composer]'), 'The phone conversation did not open.');
  assert.equal(phone.root.querySelector('[data-action="mailbox"]'), null);
  assert.equal(phone.root.querySelector('[data-mailbox-view]'), null);
  assert.equal(phone.root.querySelector("[data-action='mark-read']"), null);
  assert.equal(phoneUrls.some((url) => /\/mailboxes\/[^ ?]+\/read/.test(url)), false);
});

test("R13 accepted waiting tasks use a toast and quiet Undo without opening the unit inspector", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.items?.some(item => item.taskId === "project:shop:029"), "The review task did not load.");
  assert.equal(desktop.app.inspectorData ?? null, null);
  click(desktop.root.querySelector("[data-action='waiting']"));
  click(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:shop:029']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"), "The review did not open.");
  click(desktop.root.querySelector("[data-waiting-record='review']").querySelector("[data-action='accept']"));
  await waitFor(() => desktop.app.activity.get("task:project:shop:029")?.phase === "success", "Task acceptance did not settle.");
  assert.equal(desktop.app.waitingRecord.task.status, "done");
  assert.equal(desktop.root.querySelector('[data-map-toast]').textContent.includes(text('en', 'taskAccepted')), true);
  assert.match(desktop.root.querySelector('[data-action="map-undo"]').className, /ghost/);
  assert.equal((await request(desktop.app.api, "GET", "/tasks/project%3Ashop%3A029")).data.status, "done");
  clickAction(desktop.root, 'map-undo');
  await waitFor(() => desktop.app.store.indexes.tasks.get("project:shop:029").status === "review", "Undo did not settle.");
  assert.equal(desktop.app.waitingRecord.task.status, "review");
  assert.equal(desktop.app.inspectorData ?? null, null);
  assert.equal(desktop.app.store.indexes.tasks.get("project:shop:029").status, "review");
});

test("waiting opens from either navigation surface and refreshes without a selected unit", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.status === "ready" || desktop.app.waitingList?.status === "empty", "Waiting did not load.");
  assert.equal(desktop.app.store.selected.unitId, null);
  const pending = desktop.app.waitingList.items.find((item) => item.approvalId === "e80a0bf9-8fb4-4d64-9527-04524c9a2ecf");
  assert.ok(pending);
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]")?.querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"), "The waiting list did not open.");
  assert.ok(desktop.root.querySelector(".map"), "the Map stays beside Waiting");
  assert.equal(desktop.root.querySelector("[data-waiting-surface]"), null);
  click(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-record='approval']")?.querySelector("[data-action='approve']"), "The approval action was not offered.");
  assert.equal(desktop.root.querySelector("[data-waiting-record]")?.querySelector("[data-action='revoke-grant']"), null);
  navigate(desktop.app, "settings");
  assert.equal(desktop.root.querySelector("[data-settings]") != null, true);
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null);
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null, "any mode change, the Map included, closes Waiting");
  assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "false");

  desktop.app.embeddedHost = { embeddedUpdate() {} };
  for (const mode of ["settings", "blueprint", "document"]) {
    navigate(desktop.app, mode);
    assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "false");
    click(desktop.root.querySelector("[data-action='waiting']"));
    await waitFor(() => desktop.root.querySelector("[data-waiting-panel]"), `Waiting did not open from ${mode}.`);
    assert.equal(desktop.app.mode, "map");
    assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "true");
  }

  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.waitingList?.items?.some((item) => item.approvalId === pending.approvalId), "The phone waiting list did not load.");
  assert.equal(phone.app.store.selected.unitId, null);
  const before = phone.app.store.view?.counts?.waiting ?? 0;
  const approval = (await request(phone.app.api, "GET", "/approvals/:approvalId", { params: { approvalId: pending.approvalId } })).data;
  const answered = await answerApproval(phone.app.api, approval, "approve");
  await fixture.control.settleAnswer(answered.data.answerId, "applied");
  await waitFor(() => phone.app.store.selected.unitId === null && (phone.app.store.view?.counts?.waiting ?? before) < before, "The waiting total did not refresh without a selected unit.");
  phone.app.waitingList.height = 20000;
  click(phone.root.querySelector("[data-phone-mode='waiting']"));
  await waitFor(() => phone.root.querySelector("[data-waiting-surface]")?.querySelector("[data-kind='review']"), "Phone Waiting did not open its own list.");
  assert.equal(phone.app.store.selected.unitId, null);
  click(phone.root.querySelector("[data-waiting-surface]").querySelector("[data-kind='review']"));
  await waitFor(() => phone.root.querySelector("[data-waiting-record='review']")?.querySelector("[data-action='accept']"), "The phone review action was hidden.");
  assert.equal(phone.root.querySelector("[data-waiting-record]")?.querySelector("[data-action='undo']"), null);
});




function clickEvent(node, event) {
  const payload = { preventDefault() {}, target: event.target ?? node, offsetX: event.offsetX ?? 0, offsetY: event.offsetY ?? 0 };
  for (const handler of node?.listeners?.get("click") ?? []) handler(payload);
}

function textNodes(node, found = []) {
  if (node?.tag === "#text") found.push(node);
  for (const child of node?.children ?? []) textNodes(child, found);
  return found;
}

// This is the current mounted inventory, not a sweep over arbitrary DOM data.
// Record content and technical commands are exceptions at their owning elements;
// buttons, hints, accessible names and live regions still enter the copy gate.
function mountedVisibleCopy(booted) {
  const { document, app } = booted;
  const ownData = new Set();
  const prefixes = new Set();
  const own = (selector) => { for (const node of document.querySelectorAll(selector)) ownData.add(node); };
  own("[data-message], [data-mailbox-message], [data-mailbox-detail], .comment-text, .comment-author, .bubble-meta, .chat-members, [data-grant-action], [data-grant-pattern], [data-chip], [data-board-target], [data-lead-choice], [data-mailbox-unit]");
  own(".row-unit, .row-chat, .row-group, .row-issue, .row-editor, .unit-card h3");
  // The fixture selector implements single element selectors, so relational
  // exceptions are resolved from each actual record container.
  for (const card of document.querySelectorAll(".unit-card")) {
    for (const node of card.children) {
      if (node.tag === "h3") ownData.add(node);
      if (node.tag === "p") prefixes.add(node);
    }
  }
  for (const facts of document.querySelectorAll("[data-unit-facts]")) {
    facts.children.forEach((node, index) => (index < 6 ? prefixes : ownData).add(node));
  }
  for (const card of document.querySelectorAll("[data-approval], [data-task], [data-task-detail]")) {
    for (const node of card.children) {
      if (node.tag === "h3" || node.tag === "p" && !node.getAttribute("data-requirements") && !node.getAttribute("data-approved-by")) ownData.add(node);
    }
  }
  for (const node of document.querySelectorAll("[data-requirements], [data-approved-by]")) prefixes.add(node);
  for (const node of document.querySelectorAll(".map-label")) {
    if (!String(node.parent?.className).includes("empty-master")) ownData.add(node);
  }
  const entries = [];
  const visit = (node, identity, recordText = false) => {
    if (node.getAttribute?.("aria-hidden") === "true" || node.getAttribute?.("hidden") != null) return;
    if (node.getAttribute?.("data-secret") != null || node.getAttribute?.("data-void") != null || node.getAttribute?.("data-screen") != null) return;
    const action = node.getAttribute?.("data-action");
    const where = action ? `${identity}[data-action=${action}]` : identity;
    let value = node.textContent ?? "";
    if (ownData.has(node) || recordText && node.tag === "#text") value = "";
    if (prefixes.has(node)) value = value.split(": ")[0];
    if (node.getAttribute?.("data-opening-cause") != null && app?.selectedFolder) value = value.replace(app.selectedFolder, "");
    const title = node.getAttribute?.("data-editor-title");
    if (title) value = value.replace(title, "");
    if (value.trim()) entries.push([`${where}.text`, value]);
    for (const name of ["aria-label", "title", "placeholder", "alt"]) {
      const label = node.getAttribute?.(name);
      if (label) entries.push([`${where}.${name}`, label]);
    }
    (node.children ?? []).forEach((child, index) => visit(child, `${where}/${child.tag}[${index}]`, ownData.has(node)));
  };
  visit(document.body, "body");
  return entries;
}

test("mounted copy exceptions belong to records and never hide nearby product labels", () => {
  const { document, root } = createTestDocument(1440);
  const command = document.createElement("p");
  command.setAttribute("data-grant-pattern", "true");
  command.textContent = "printf 'tu mente' --mind-path C:/fixtures/mind/keep";
  root.append(command);
  const content = document.createElement("div");
  content.setAttribute("data-void", "true");
  content.textContent = "Tu mente: vos podés escribir esto.";
  root.append(content);
  const booted = { document, app: {} };
  assertVisibleCopy("es", mountedVisibleCopy(booted));
  const button = document.createElement("button");
  button.setAttribute("data-action", "retry");
  button.textContent = "Revisá tu mente";
  root.append(button);
  assert.throws(() => assertVisibleCopy("es", mountedVisibleCopy(booted)), /data-action=retry/);
  assert.equal(command.textContent, "printf 'tu mente' --mind-path C:/fixtures/mind/keep");
  assert.equal(content.textContent, "Tu mente: vos podés escribir esto.");
});

for (const language of ["en", "es"]) test(`current mounted ${language} states use M1ND and neutral product copy`, async (t) => {
  const fixture = await createGuiFixture({ scenario: language === "es" ? "spanish" : "standard" });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const inventory = new Map();
  const capture = (state, booted = desktop) => {
    booted.app.language = language;
    renderShell(booted.app);
    const entries = mountedVisibleCopy(booted);
    assert.ok(entries.length > 3, `${state}: the mounted copy inventory was empty`);
    assertVisibleCopy(language, entries.map(([where, value]) => [`${state} ${where}`, value]));
    inventory.set(state, entries.length);
  };
  capture("Map and Hierarchy");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === executor.id && desktop.app.thread?.messages?.length, "The copy inventory did not open the unit and its chat.");
  const message = desktop.app.thread.messages[0];
  const userContent = "Tu mente: vos podés usar mind y --mind-path C:/fixtures/mind/keep.";
  message.body = userContent;
  capture("Chat, unit, session, approvals and task review");
  assert.equal(message.body, userContent);
  const always = desktop.root.querySelector("[data-action='approve-always']");
  assert.ok(always);
  assert.equal(always.textContent, text(language, "approveAlways"));
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]"), "The copy inventory did not open Waiting.");
  capture("Waiting");
  click(desktop.root.querySelector("[data-action='new-cluster']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='cluster']"), "The copy inventory did not open the unit form.");
  capture("New cluster form");
  desktop.document.querySelector("dialog[open]").close();
  click(desktop.root.querySelector("[data-action='waiting']"));
  const idle = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: idle.id, kind: "unit", unit: idle }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === idle.id && desktop.root.querySelector("[data-action='start-session']"), "The copy inventory did not open an agent that can start.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The copy inventory did not open the session form.");
  capture("Session form");
  desktop.document.querySelector("dialog[open]").close();
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-settings]"), "The copy inventory did not open Settings.");
  capture("Settings and service");
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  capture("Phone Hierarchy", phone);
  const phoneUnit = phone.app.unitList.catalog.find((unit) => unit.id === executor.id);
  phone.app.activeHandlers.onActivate({ id: phoneUnit.id, kind: "unit", unit: phoneUnit }, "double");
  await waitFor(() => phone.app.thread?.messages?.length, "The copy inventory did not open the phone chat.");
  capture("Phone chat", phone);
  navigate(phone.app, "waiting");
  capture("Phone Waiting", phone);
  await fixture.control.emit("home.changed", { reason: "expired", home: { enabled: false } });
  await waitFor(() => phone.root.querySelector('[data-phone-state="ended"]'), "The copy inventory did not end phone access.");
  capture("Phone access ended and pairing", phone);
  click(phone.root.querySelector('[data-action="phone-new-code"]'));
  capture('Phone pairing', phone);
  const first = await createGuiFixture({ scenario: "first-run" });
  t.after(() => first.close());
  const empty = await bootApp(first.desktopUrl, 1440, []);
  t.after(() => dispose(empty.app));
  capture("Empty M1ND", empty);
  empty.app.bootReading = true;
  capture("Reading M1ND", empty);
  empty.app.bootReading = false;
  empty.app.bootFailed = true;
  empty.app.selectedFolder = "C:/fixtures/mind/keep";
  empty.app.bootError = new ApiError(0, "timeout", text(language, "requestTimeout"));
  capture("Unreadable M1ND", empty);
  assert.equal(inventory.size, 14);
});

test("unit forms use machines, session forms use the stored runtime, and the inspector shows the contract facts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls, async (input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-session-activity]")?.getAttribute("data-session-activity") === "busy", "The session facts did not load.");
  const session = desktop.root.querySelectorAll("[data-session='20c58b80-4d93-88cd-83b3-39d78f1d9d5d']").find((node) => node.querySelector("[data-session-activity]"));
  assert.equal(session.querySelector("[data-session-quota]").getAttribute("data-session-quota"), "unknown");
  assert.equal(session.querySelector("[data-session-wake]").getAttribute("data-session-wake"), "enabled");
  assert.equal(desktop.root.querySelector("[data-machine='DESKTOP']").getAttribute("data-answers"), "true");
  assert.equal(desktop.root.querySelector("[data-action='start-session']"), null, "a running session offers Stop and no Start");
  assert.ok(desktop.root.querySelector("[data-action='stop-session']"));
  const grant = desktop.root.querySelector("[data-grant-action='process.run']").parent;
  assert.equal(grant.querySelector("[data-grant-action]").getAttribute("data-grant-action"), "process.run");
  assert.equal(grant.querySelector("[data-grant-pattern]").textContent, "command: npm run build, cwd: project:shop");
  assert.equal(grant.querySelector("[data-action='revoke-grant']") == null, false);
  const reviewable = desktop.root.querySelector("[data-task='project:shop:029']");
  assert.equal(reviewable.getAttribute("data-reviewable"), "true");
  assert.equal(reviewable.querySelector("[data-action='accept']").disabled, false);
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:029']").querySelector("[data-requirements]").getAttribute("data-requirements"), "SHOP-1");
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:029']").querySelector("[data-approved-by]").getAttribute("data-approved-by"), "env:web:overlord-web");
  const gated = desktop.root.querySelector("[data-task='project:shop:030']");
  assert.equal(gated.getAttribute("data-reviewable"), "false");
  assert.equal(gated.querySelector("[data-action='accept']").disabled, true);
  assert.equal(desktop.root.querySelector("[data-task-detail='project:shop:030']").querySelector("[data-approved-by]").getAttribute("data-approved-by"), "");

  const adjutant = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: adjutant.id, kind: "unit", unit: adjutant }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === "root:adjutant", "The adjutant inspector did not open.");
  const beforeSession = urls.length;
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The session form did not open.");
  const sessionForm = desktop.document.querySelector("[data-form='session']");
  assert.equal(sessionForm.querySelector("[name='client']"), null);
  typeInput(sessionForm.querySelector("[name='prompt']"), "Check the build", 0, 15);
  click(sessionForm.querySelector("[data-action='confirm-form']"));
  await waitFor(() => urls.slice(beforeSession).some((url) => url.includes("/session-requests/")), "The queued session was not read back.");
  const started = writes.find((item) => item.url.endsWith('/session'));
  assert.deepEqual(Object.keys(started.body).sort(), ["expectedRevision", "prompt", "runMode", "taskId"]);
  assert.equal(started.body.runMode, 'chat');
  assert.equal(started.body.taskId, null);
  assert.equal(started.body.prompt, "Check the build");
  assert.equal(noteText(desktop), "The session is queued.");

  const blog = desktop.app.unitList.catalog.find((unit) => unit.id === "project:blog:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: blog.id, kind: "unit", unit: blog }, "double");
  await waitFor(() => desktop.root.querySelector("[data-machine='OFFLINE']")?.getAttribute("data-answers") === "false", "The silent machine was not shown.");
  assert.equal(desktop.root.querySelector("[data-action='start-session']"), null, "a machine that does not answer offers neither Start nor Stop");
  assert.equal(desktop.root.querySelector("[data-action='stop-session']"), null);
  const notice = desktop.root.querySelector("[data-machine-notice='OFFLINE']");
  assert.equal(notice.querySelector("strong").textContent, "OFFLINE is not answering");
  assert.equal(notice.querySelector("p").textContent, "Executor shop runs there; it starts when OFFLINE is back.");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-machine-notice='OFFLINE']").querySelector("strong").textContent, "OFFLINE no responde");
  assert.equal(desktop.root.querySelector("[data-machine-notice='OFFLINE']").querySelector("p").textContent, "Executor shop se ejecuta allí; se inicia cuando OFFLINE vuelva.");
});

test('a rejected cluster keeps its name and focus across refresh and retries its original operation', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close()); const writes = []; let reject = true;
  const desktop = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    if (init.method === 'POST' && new URL(input).pathname === '/api/v1/clusters') {
      writes.push({ body: init.body, key: init.headers['Idempotency-Key'] });
      if (reject) { reject = false; throw new Error('The request was not confirmed.'); }
    }
    return fetch(input, init);
  }); t.after(() => dispose(desktop.app));
  click(desktop.root.querySelector("[data-action='new-cluster']"));
  const dialog = desktop.document.querySelector("[data-start-dialog='cluster']"), name = dialog.querySelector("[name='title']");
  typeInput(name, 'Retained cluster', 3, 8); name.focus(); renderShell(desktop.app);
  assert.equal(name.value, 'Retained cluster'); assert.equal(desktop.document.activeElement, name);
  click(dialog.querySelector("[data-action='create-cluster']"));
  await waitFor(() => dialog.querySelector('[data-start-error]'), 'The rejected cluster did not stay open.');
  assert.equal(dialog.querySelector("[name='title']").value, 'Retained cluster');
  click(dialog.querySelector("[data-action='create-cluster']"));
  await waitFor(() => desktop.app.store.selected.groupId && !desktop.document.querySelector("[data-start-dialog='cluster']"), 'The cluster did not reconcile.');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
});

test("unsaved forms share one dirty flag and only a saved draft clears it", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== "PATCH" || !init.body) return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  const embedMessages = [];
  await waitFor(() => desktop.app.chatList?.catalog?.length > 0 && desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The desktop lists did not load.");
  desktop.app.embed = {
    disposed: false,
    viewer: { embedded: true, hostOrigin: "http://127.0.0.1:9", viewerId: "viewer-dirty", capabilities: DESKTOP },
    transport: { parent: { postMessage(data) { embedMessages.push(data); } } },
  };
  const dirtyPatches = () => writes.filter((item) => item.url.includes("/viewer") && Object.prototype.hasOwnProperty.call(item.body ?? {}, "dirty"));
  const dirtyMessages = () => embedMessages.filter((item) => item.type === "dirty");
  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The chat composer did not open.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Hold", 0, 4);
  await waitFor(() => dirtyPatches().some((item) => item.body.dirty === true), "Chat text did not mark the viewer dirty.");
  typeInput(desktop.root.querySelector("[data-composer]"), "Hold!", 0, 5);
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "single");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "Fix", 0, 3);
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(dirtyMessages().filter((item) => item.value === true).length, 1);
  typeInput(desktop.root.querySelector("[data-composer]"), "", 0, 0);
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "", 0, 0);
  await waitFor(() => dirtyPatches().some((item) => item.body.dirty === false), "Clearing the last draft did not clear the dirty flag.");
  const phoneUrls = [];
  const phone = await bootApp(fixture.phoneUrl, 390, phoneUrls);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const phoneChat = phone.app.chatList.catalog[0];
  phone.app.activeHandlers.onActivate({ id: phoneChat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("[data-composer]"), "The phone composer did not open.");
  typeInput(phone.root.querySelector("[data-composer]"), "Local only", 0, 10);
  await delay(40);
  assert.equal(phoneUrls.some((url) => url.includes("/viewer")), false);
  assert.equal(phone.app.inputDrafts.chats.get(phoneChat.id).value, "Local only");
});








test("mounted map circles use translated status and the zoom bar has no pan button", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector("[data-unit-id='root:overseer']"), "The map circles did not render.");
  const overseer = desktop.root.querySelector("[data-unit-id='root:overseer']");
  const lead = desktop.root.querySelector("[data-unit-id='env:web:overlord-web']");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  const shop = desktop.root.querySelector("[data-unit-id='project:shop:executor-shop']");
  assert.equal(overseer.getAttribute("data-ring"), "overseer");
  assert.equal(overseer.className.includes("is-overseer"), true);
  assert.equal(overseer.querySelector("[data-role-icon='crown']") != null, true);
  assert.equal(overseer.querySelector("[data-map-label]").textContent, "Overseer");
  assert.equal(lead.getAttribute("data-ring"), "lead");
  assert.equal(lead.className.includes("is-lead"), true);
  assert.equal(shop.getAttribute("data-role"), executor.role);
  assert.equal(shop.querySelector("[data-map-label]").textContent, displayName(executor.unit));
  assert.equal(desktop.root.querySelector("[data-action='pan']"), null);
  assert.equal(desktop.root.querySelector("[data-action='map-help']") != null, true);
  desktop.app.language = "es";
  renderShell(desktop.app);
  const status = desktop.root.querySelector("[data-unit-id='project:shop:executor-shop']").querySelector("[data-status]");
  const key = { working: "statusWorking", waiting: "statusWaiting", idle: "statusIdle", out: "statusOut", quota: "statusQuota" }[status.getAttribute("data-status")] ?? "statusUnknown";
  assert.equal(status.getAttribute("aria-label"), text("es", key));
  desktop.app.mapState.selection = new Set(["root:overseer"]);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-unit-id='root:overseer']").className.includes("is-selected"), true);
});

test("settings and the footer follow sync, service, and issue changes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-settings]"), "Settings did not open.");
  const retryAt = "2099-01-01T00:00:10.000Z";
  await fixture.control.emit("sync.changed", {
    state: "paused",
    pendingChanges: 4,
    limits: {
      state: "paused",
      retryAt,
      messages: { used: 61, max: 60, windowSeconds: 60 },
      syncBytes: { used: 12, max: 50000000, windowSeconds: 3600 },
    },
    retryAt,
    error: null,
  });
  await waitFor(() => desktop.root.querySelector("[data-sync='paused']")?.textContent === "Sync is paused", "The paused sync state was not shown.");
  assert.equal(desktop.root.querySelector("[data-pending-changes]")?.textContent, "4 changes waiting");
  assert.equal(desktop.root.querySelector("[data-limits='paused']")?.getAttribute("data-retry-at"), retryAt);
  const limitText = desktop.root.querySelector("[data-limits='paused']").querySelector("strong").textContent;
  assert.equal(limitText, text("en", "limitsPaused", { time: formatShortTime("en", retryAt) }));
  assert.equal(limitText.includes(retryAt), false);
  assert.equal(limitText.includes("T"), false);
  assert.equal(desktop.root.querySelector("[data-limit-usage]")?.textContent, "0 of 50 MB of sync used in this window. Messages still go out.");
  await fixture.control.emit("service.changed", { machine: { id: "LAPTOP", version: "3.0.1", state: "running", answers: true } });
  await waitFor(() => desktop.root.querySelector("[data-service-machine]")?.getAttribute("data-service-machine") === "LAPTOP", "The service machine was not updated.");
  // The unreadable records the fixture already has are listed too; each says which file and why, never the service's English sentence.
  const unreadable = () => desktop.root.querySelector("[data-issue-files]")?.querySelectorAll("li") ?? [];
  const before = unreadable().length;
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: false });
  await waitFor(() => unreadable().length === before + 1, "The issue was not shown.");
  assert.equal(desktop.root.querySelector("[data-issues]").querySelector("strong").textContent, cardinal("en", "settingsIssues", before + 1));
  const added = unreadable().find((row) => row.querySelector("code").textContent === "units/shop");
  assert.deepEqual(added.querySelectorAll("span").map((node) => node.textContent), ["Could not be read"]);
  assert.equal(/projected|unreadable/.test(nodeText(desktop.root.querySelector("[data-issue-files]"))), false);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-sync='paused']")?.textContent, "La sincronización está en pausa");
  assert.equal(desktop.root.querySelector("[data-limits='paused']").querySelector("strong").textContent.includes("en pausa"), true);
  assert.equal(desktop.root.querySelector("[data-issues]").querySelector("strong").textContent, cardinal("es", "settingsIssues", before + 1));
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: true });
  await waitFor(() => unreadable().length === before, "The resolved issue remained.");
  const token = desktop.app.api.token;
  desktop.app.store.stream = { state: "error", error: "reconnect_exhausted" };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-stream='stopped']")?.textContent, "La conexión en vivo se detuvo.");
  assert.equal(desktop.root.querySelector("[data-action='retry-stream']")?.textContent, "Reintentar");
  assert.equal(desktop.app.api.token, token);
  assert.equal(desktop.root.querySelector("[data-settings]") != null, true);
  desktop.app.language = "en";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-stream='stopped']")?.textContent, "The live connection stopped.");
});

test("a replayed unit event is applied once and the cursor advances", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "root:master"), "The unit list did not load.");
  const unitReads = () => urls.filter((url) => url.includes("/api/v1/units")).length;
  const before = unitReads();
  const current = desktop.app.store.indexes.units.get("root:master");
  const id = await fixture.control.emit("unit.changed", { unit: current });
  await waitFor(() => {
    const list = desktop.app.unitList;
    return unitReads() > before && (list?.status === "ready" || list?.status === "empty") && !list?.nextCursor && desktop.app.store.cursor === id;
  }, "The unit change was not consumed.");
  const after = unitReads();
  await fixture.control.replay(id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.equal(unitReads(), after);
    assert.equal(desktop.app.store.cursor, id);
    await delay(25);
  }
});

test("action notes use bilingual outcomes and keep wire codes for diagnostics", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.mapState?.onConnect && desktop.app.unitList?.catalog?.some((unit) => unit.id === "root:master"), "The map did not load.");
  desktop.app.mapState.onConnect({ source: "env:web:overlord-web", target: "root:master" });
  click(desktop.document.querySelector("dialog").querySelector(".primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent === "That connection is not valid.", "The connection note was not translated.");
  assert.equal(desktop.document.querySelector("dialog")?.getAttribute("open") != null, true);
  assert.equal(desktop.document.querySelector("[data-dialog-error]").getAttribute("data-code"), "invalid_lead");
  assert.equal(desktop.document.querySelector("[data-dialog-error]").textContent.includes("root:master"), false);
  click(desktop.document.querySelector("dialog").querySelector("button"));
  await waitFor(() => desktop.document.querySelector("dialog") == null, "Cancel did not close the connection dialog.");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:030']"), "The task list did not load.");
  const missingNoteTask = (await request(desktop.app.api, 'GET', '/tasks/:taskId', { params: { taskId: 'project:shop:030' } })).data;
  await assert.rejects(changeTaskStatus(desktop.app.api, missingNoteTask, 'open', ''), { code: 'note_required' });
  assert.equal(desktop.root.querySelector("[data-task='project:shop:030']").querySelector("[data-action='send-back']").disabled, true);
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='accept']"));
  await waitFor(() => desktop.root.querySelector("[data-map-toast]")?.textContent.includes("Task accepted"), "The accepted task presentation was not shown.");
  assert.match(desktop.root.querySelector("[data-action='map-undo']").className, /ghost/);

  desktop.app.language = "es";
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:029']")?.querySelector("[data-action='undo']"), "Undo did not appear.");
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='undo']"));
  await waitFor(() => noteText(desktop) === "La tarea está en revisión.", "The Spanish task outcome was not shown.");

  fixture.control.setFault({ method: "POST", path: "/api/v1/units/root:adjutant/session", status: 422, code: "totally_unknown" });
  desktop.app.language = "en";
  const adjutant = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: adjutant.id, kind: "unit", unit: adjutant }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === "root:adjutant", "The adjutant inspector did not open.");
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The session form did not open.");
  click(desktop.document.querySelector("[data-form='session']").querySelector("[data-action='confirm-form']"));
  await waitFor(() => noteText(desktop) === "The action failed. Try again.", "An unknown code was shown to the reader.");
  assert.equal(desktop.root.querySelector("[data-action-note]").getAttribute("data-code"), "totally_unknown");
});








test("counts, clocks, and session facts follow the active language", () => {
  assert.equal(cardinal("en", "unitCount", 1), "1 agent");
  assert.equal(cardinal("en", "unitCount", 0), "0 agents");
  assert.equal(cardinal("es", "unitCount", 1), "1 agente");
  assert.equal(cardinal("es", "issueCount", 1), "1 incidencia");
  assert.equal(cardinal("en", "pendingChanges", 1), "1 change waiting");
  assert.equal(text("en", "nothingToUndo"), "No task change to undo.");
  assert.equal(text("es", "nothingToUndo"), "No hay un cambio de tarea para deshacer.");
  const stamp = "2026-10-10T12:00:00.000Z";
  const clock = formatClock("en", stamp);
  assert.equal(clock, localTime(stamp));
  assert.equal(clock.includes(stamp), false);
  assert.equal(formatWhen("en", stamp).includes(stamp), false);
  assert.equal(/\d:\d{2}:\d{2}/.test(formatWhen("en", stamp)), false);
  assert.equal(/\d:\d{2}:\d{2}/.test(formatWhen("es", stamp)), false);
  assert.equal(formatShortTime("en", stamp).includes(":00:"), false);
  assert.equal(formatShortTime("en", stamp), localTime(stamp));
  assert.equal(formatWhen("en", "not-a-date"), "not-a-date");
  // Phone access that ends at midnight in Buenos Aires reads 00:00 there, not the UTC 03:00.
  const local = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `import { formatClock, formatShortTime, formatWhen } from ${JSON.stringify(new URL("../gui/app/i18n.mjs", import.meta.url).href)};
const at = "2026-10-11T03:00:00.000Z";
console.log(JSON.stringify([formatShortTime("en", at), formatClock("es", at), formatWhen("en", at)]));`], { encoding: "utf8", env: { ...process.env, TZ: "America/Argentina/Buenos_Aires" } }));
  assert.deepEqual(local, ["00:00", "00:00", "Oct 11, 2026, 00:00"]);
  assert.equal(limitsUsage("en", { used: 0, max: 0 }, { used: 0, max: 0 }), "0 of 0 messages and 0 of 0 sync bytes.");
  assert.equal(limitsUsage("en", { used: 1, max: 1 }, { used: 1, max: 1 }), "1 of 1 message and 1 of 1 sync byte.");
  assert.equal(limitsUsage("en", { used: 1, max: 2 }, { used: 1, max: 2 }), "1 of 2 messages and 1 of 2 sync bytes.");
  assert.equal(limitsUsage("en", { used: 12, max: 60 }, { used: 1, max: 50000000 }), "12 of 60 messages and 1 of 50,000,000 sync bytes.");
  assert.equal(limitsUsage("es", { used: 0, max: 0 }, { used: 0, max: 1 }), "0 de 0 mensajes y 0 de 1 byte de sincronización.");
  assert.equal(limitsUsage("es", { used: 1, max: 1 }, { used: 2, max: 60 }), "1 de 1 mensaje y 2 de 60 bytes de sincronización.");
  assert.equal(limitsUsage("es", { used: 2, max: 60 }, { used: 1, max: 1 }), "2 de 60 mensajes y 1 de 1 byte de sincronización.");
  const { document } = createTestDocument();
  const t = (key, variables) => text("en", key, variables);
  const idle = renderSession(document, {
    id: "s1",
    activity: "idle",
    quota: null,
    wake: { enabled: true, pausedReason: "handoff-budget-exhausted" },
  }, t);
  assert.equal(idle.querySelector("[data-session-activity]").textContent, "The session is idle.");
  assert.equal(idle.querySelector("[data-session-wake]").textContent.includes("handoff-budget"), false);
  assert.equal(idle.querySelector("[data-session-wake]").textContent.includes("handoff"), true);
  const busy = renderSession(document, {
    id: "s2",
    activity: "busy",
    wake: { enabled: true, pausedReason: "not-a-known-reason" },
  }, t);
  const mark = busy.querySelector("[data-session-activity]");
  assert.equal(mark.getAttribute("aria-label"), "The session is working.");
  assert.equal(mark.children.some((child) => child.textContent === "The session is working."), true);
  assert.equal(mark.getAttribute("aria-label").includes("busy"), false);
  assert.equal(busy.querySelector("[data-session-wake]").textContent, "Wake is paused.");
  const unit = renderUnit(document, { unit: "shop", date: stamp, context: "Keep this sentence." }, t, "en");
  const dateLine = unit.querySelectorAll("p").find((node) => node.textContent.startsWith("Date"));
  assert.equal(dateLine.textContent.includes(stamp), false);
  assert.equal(unit.querySelectorAll("p").some((node) => node.textContent === "Keep this sentence."), true);
});

test("the shell has one heading, a skip link, and stable live regions", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  const headings = desktop.root.querySelectorAll("h1");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].textContent, "Map");
  assert.equal(desktop.document.title, "Map · ONEM1ND");
  assert.equal(desktop.document.title.includes("\u2014"), false);
  const skip = desktop.root.querySelector("a.skip");
  assert.equal(skip?.getAttribute("href"), "#workspace");
  assert.equal(skip.textContent, "Skip to the workspace");
  assert.equal(desktop.root.querySelector("[id='workspace']") != null, true);
  assert.equal(desktop.root.querySelector("[role='tab']"), null);
  assert.equal(desktop.root.querySelector("[role='tablist']"), null);
  const status = desktop.document.querySelector("[data-live='status']");
  const error = desktop.document.querySelector("[data-live='error']");
  assert.equal(status?.parentNode === desktop.document.body, true);
  assert.equal(error?.parentNode === desktop.document.body, true);
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(error.getAttribute("role"), "alert");
  assert.equal(status.textContent, "");
  assert.equal(status.textContent.includes("Reading the mind."), false);
  status.parent = null;
  error.parent = null;
  for (let pass = 0; pass < 12; pass += 1) renderShell(desktop.app);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(desktop.document.querySelector("[data-live='status']").parentNode === desktop.document.body, true);
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent, "");
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("h1").textContent, "Mapa");
  assert.equal(desktop.document.title, "Mapa · ONEM1ND");
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  dispose(desktop.app);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 0);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 0);
});

test("same-cursor reset and ready open the desktop shell and read the viewer", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  let shared = null;
  let releaseEvents = () => {};
  const eventsReady = new Promise((resolve) => {
    releaseEvents = resolve;
  });
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    urls.push(target);
    const pathname = new URL(target).pathname;
    if (pathname === "/api/v1/events") return sameCursorStream(eventsReady, () => shared);
    const response = await fetch(input, init);
    if (pathname !== "/api/v1/view") return response;
    const json = await response.json();
    if (!shared) {
      shared = json.meta.eventCursor;
      releaseEvents();
    }
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  });
  t.after(() => dispose(booted.app));
  await waitFor(() => booted.root.querySelector(".shell"), "The desktop shell did not appear.");
  assert.equal(booted.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(booted.app.store.capabilities.includes("viewer.write"), true);
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/viewer"), true);
});

test("startup shows Retry when stream.ready never arrives", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const urls = [];
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    urls.push(target);
    if (new URL(target).pathname === "/api/v1/events") {
      return new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return fetch(input, init);
  }, { readyBudgetMs: 200 });
  t.after(() => dispose(booted.app));
  await waitFor(() => booted.root.querySelector("[data-boot='failed']"), "Startup did not fail closed.");
  assert.equal(booted.root.querySelector("h2")?.textContent, "The M1ND cannot be read");
  assert.equal(booted.root.querySelector("[data-action='retry-boot']")?.textContent, "Retry");
  assert.equal(booted.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(booted.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(booted.document.querySelector("[data-live='error']").textContent, "The M1ND cannot be read");
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/settings"), true);
  assert.equal(urls.some((url) => new URL(url).pathname === "/api/v1/viewer"), false);
});

test("startup Retry repeats the failed read with the same authorized API", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const token = new URL(fixture.desktopUrl).hash.replace(/^#/, "").split("&").find((part) => part.startsWith("session=")).slice("session=".length);
  const history = { state: null, urls: [], replaceState(_state, _title, url) { this.urls.push(String(url)); } };
  const authorizations = [];
  let views = 0;
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    if (new URL(target).pathname === "/api/v1/view") {
      views += 1;
      authorizations.push(init?.headers?.Authorization ?? null);
      if (views === 1) {
        return new Response(JSON.stringify({
          error: { code: "unavailable", message: "The service is unavailable.", requestId: "req-boot", details: {}, retryAt: null },
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
    }
    return fetch(input, init);
  }, { history });
  t.after(() => dispose(booted.app));
  const api = booted.app.api;
  await waitFor(() => booted.root.querySelector("[data-boot='failed']"), "The failed startup did not stay recoverable.");
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(api.token, token);
  assert.equal(history.urls.length, 1);
  assert.equal(history.urls[0].includes(token), false);
  assert.equal(history.urls[0].includes("session="), false);
  click(booted.root.querySelector("[data-action='retry-boot']"));
  await waitFor(() => booted.root.querySelector("[data-boot='ready']"), "Retry did not open the desktop shell.");
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Loading."), false);
  assert.equal(booted.document.querySelector("[data-live='status']").textContent.includes("Reading the mind."), false);
  assert.equal(booted.document.querySelector("[data-live='error']").textContent.includes("The service is unavailable."), false);
  assert.equal(booted.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(booted.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(booted.app.api, api);
  assert.equal(booted.app.api.token, token);
  assert.equal(authorizations.length >= 2, true);
  assert.equal(authorizations.every((value) => value === `Bearer ${token}`), true);
  assert.equal(history.urls.length, 1);
});

test("startup Retry shows the opening frame while the read is in progress", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let views = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    const target = String(input);
    if (new URL(target).pathname === "/api/v1/view") {
      views += 1;
      if (views === 1) {
        return new Response(JSON.stringify({
          error: { code: "unavailable", message: "The service is unavailable.", requestId: "req-boot", details: {}, retryAt: null },
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
      await gate;
    }
    return fetch(input, init);
  });
  t.after(() => dispose(booted.app));
  await waitFor(() => booted.root.querySelector("[data-boot='failed']"), "The failed startup did not stay recoverable.");
  click(booted.root.querySelector("[data-action='retry-boot']"));
  assert.equal(booted.root.querySelector("[data-boot]")?.getAttribute("data-boot"), "reading");
  assert.equal(booted.root.querySelector("h2")?.textContent, "Reading the M1ND");
  assert.ok(booted.root.querySelector(".spinner"));
  release();
  await waitFor(() => booted.root.querySelector("[data-boot='ready']"), "Retry did not open the desktop shell.");
});

test("phone pairing uses a stored or browser language before a viewer exists", async () => {
  const { document, root } = createTestDocument(390);
  const app = await mount(root, {
    location: { origin: "http://127.0.0.1:43123", pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    navigator: { languages: ["es-ES", "es"] },
    fetch: async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } }),
  });
  assert.equal(root.querySelector("h1").textContent, "Abrir la M1ND");
  assert.equal(document.documentElement.lang, "es");
  dispose(app);
  const storage = new Map([["hivem1nd:language", "en"]]); // Compatibility: browser storage and desktop bridge names remain stable.
  const english = createTestDocument(390);
  const stored = await mount(english.root, {
    location: { origin: "http://127.0.0.1:43123", pathname: "/", search: "", hash: "" },
    history: { replaceState() {} },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { languages: ["es-ES"] },
    fetch: async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } }),
  });
  assert.equal(english.root.querySelector("h1").textContent, "Open your M1ND");
  assert.equal(english.document.documentElement.lang, "en");
  dispose(stored);
});

test("the opening frame uses a stored or browser language before the read, then the viewer settings", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const storage = new Map();
  const { document, root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  const pending = mount(root, {
    location: url, history: { replaceState() {} },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { languages: ["es-AR", "es"] },
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/view") await gate;
      return fetch(input, init);
    },
  });
  assert.equal(root.querySelector("h2").textContent, "Leyendo la M1ND");
  assert.equal(document.documentElement.lang, "es");
  const stored = new Map([["hivem1nd:language", "es"]]); // Compatibility: browser storage and desktop bridge names remain stable.
  const storedRoot = createTestDocument(1440).root;
  const storedBoot = mount(storedRoot, {
    location: url, history: { replaceState() {} },
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    navigator: { languages: ["en-US"] },
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/view") await gate;
      return fetch(input, init);
    },
  });
  assert.equal(storedRoot.querySelector("h2").textContent, "Leyendo la M1ND");
  release();
  const app = await pending;
  const storedApp = await storedBoot;
  t.after(() => { dispose(app); dispose(storedApp); });
  await patient(() => [app, storedApp].every(mounted => mounted.bootSettled && !mounted.bootReading
    && mounted.store.snapshotReady && mounted.store.viewer), 'The authoritative viewer presentation did not finish.');
  assert.equal(app.language, "en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(storage.get("hivem1nd:language"), "en"); // Compatibility: browser storage and desktop bridge names remain stable.
  assert.equal(stored.get("hivem1nd:language"), "en"); // Compatibility: browser storage and desktop bridge names remain stable.
});

test("settings do not replace the opening language before the viewer can be read", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let settled = 0;
  const storage = new Map([["hivem1nd:language", "es"]]); // Compatibility: browser storage and desktop bridge names remain stable.
  const { root } = createTestDocument(1440);
  const pending = mount(root, {
    location: new URL(fixture.desktopUrl), history: { replaceState() {} },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { languages: ["en-US"] },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/api/v1/view") await gate;
      const response = await fetch(input, init);
      if (path === "/api/v1/settings") Promise.resolve().then(() => { settled = 1; }).then(() => { settled = 2; });
      return response;
    },
  });
  await patient(() => settled === 2, "The settings read did not finish.");
  assert.equal(root.querySelector("h2").textContent, "Leyendo la M1ND");
  assert.equal(storage.get("hivem1nd:language"), "es"); // Compatibility: browser storage and desktop bridge names remain stable.
  release();
  const app = await pending;
  t.after(() => dispose(app));
});

test("the opening frame shows a stored view, and the shell opens when the view arrives without waiting for settings", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const live = (await request(apiFrom(fixture.desktopUrl), "GET", "/view")).data;
  const liveBoards = (live.editors ?? []).filter((editor) => editor.kind === "blueprint").length;
  const storage = new Map([["hivem1nd:opening-view", JSON.stringify({ counts: { units: 424242, chats: 2 }, groupCount: 1, boardCount: 3 })]]); // Compatibility: browser storage and desktop bridge names remain stable.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const { root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  const store = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const pending = mount(root, {
    location: url, history: { replaceState() {} }, storage: store,
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/api/v1/settings" || path === "/api/v1/viewer") await gate;
      return fetch(input, init);
    },
  });
  assert.equal(root.querySelector(".opening-counts").textContent, "424242 units, 1 groups, 2 chats, 3 boards");
  assert.equal(root.querySelector("[data-boot]").getAttribute("data-boot"), "reading");
  // Settings and the viewer are still held back: the shell and its lists are already drawn.
  await waitFor(() => root.querySelector("[data-boot]")?.getAttribute("data-boot") === "ready" && root.querySelector(".side"), "The shell did not open when the view arrived.");
  assert.equal(root.querySelector(".opening-counts"), null);
  release();
  const app = await pending;
  t.after(() => dispose(app));
  assert.deepEqual(JSON.parse(storage.get("hivem1nd:opening-view")), { counts: { units: live.counts.units, chats: live.counts.chats }, groupCount: live.groups?.length ?? 0, boardCount: liveBoards }); // Compatibility: browser storage and desktop bridge names remain stable.
});

test("a delayed initial read keeps the desktop frame and skeleton panels visible", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const { document, root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = mount(root, {
    location: url, history: { replaceState() {} }, mindPath: join(fixture.root, "Cosmic", "onem1nd"),
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/view") await gate;
      return fetch(input, init);
    },
  });
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  assert.equal(root.querySelector(".bar") != null, true);
  assert.equal(root.querySelector(".foot") != null, true);
  assert.equal(root.querySelectorAll(".opening-skeleton").length, 14);
  assert.equal(root.querySelector("h2").textContent, "Reading the M1ND");
  assert.equal(document.querySelector("[data-live='status']").textContent, "Reading the M1ND");
  await delay(50);
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  release();
  const app = await pending;
  t.after(() => dispose(app));
  assert.equal(root.querySelector("[data-boot='ready']") != null, true);
  assert.equal(root.querySelector(".opening-skeleton"), null);
  assert.equal(document.querySelector("[data-live='status']").textContent, "");
});

test("the initial read ends at 30000 milliseconds with its selected folder and Retry", async (t) => {
  const { document, root } = createTestDocument(1440);
  const selected = "C:\\fixtures\\offline\\.m1nd";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = mount(root, {
    location: { origin: "http://127.0.0.1:43123", pathname: "/gui/viewer", hash: "#session=fixture-credential" },
    history: { replaceState() {} }, mindPath: selected,
    fetch: async (input, init) => {
      if (new URL(input).pathname === "/api/v1/events") return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } });
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    },
  });
  t.mock.timers.tick(29999);
  assert.equal(root.querySelector("[data-boot='reading']") != null, true);
  t.mock.timers.tick(1);
  const app = await pending;
  t.after(() => dispose(app));
  assert.equal(root.querySelector("[data-boot='failed']") != null, true);
  assert.equal(root.querySelector("[data-opening-cause]").textContent, `${selected} did not answer in 30 s. The drive may be offline, or another program may hold the folder.`);
  assert.equal(root.querySelector("[data-action='retry-boot']").textContent, "Retry");
  assert.equal(root.querySelector("[data-action='choose-folder']").textContent, "Choose another folder");
  assert.equal(root.querySelectorAll(".opening-skeleton").length, 14);
  assert.equal(document.querySelector("[data-live='error']").textContent, "The M1ND cannot be read");
  assert.equal(app.api.token != null, true);
  app.language = "es";
  renderShell(app);
  assert.equal(root.querySelector("h2").textContent, "No se puede leer la M1ND");
  assert.equal(root.querySelector("[data-action='choose-folder']").textContent, "Elegir otra carpeta");
  assert.equal(root.querySelector("[data-opening-cause]").textContent.includes("no respondió en 30 s"), true);
  t.mock.timers.reset();
});

test("an inaccessible-folder cause exposes no credential and choosing another folder retains drafts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const selected = join(fixture.root, "Cosmic", "onem1nd");
  let handoff = null;
  const booted = await bootWithFetch(fixture.desktopUrl, 1440, async (input, init) => {
    if (new URL(input).pathname === "/api/v1/view") return new Response(JSON.stringify({ error: { code: "folder_unreadable", message: `Access is denied. ${init.headers.Authorization}` } }), { status: 403, headers: { "content-type": "application/json" } });
    return fetch(input, init);
  }, { mindPath: selected, chooseFolder: async (input) => { handoff = input; } });
  t.after(() => dispose(booted.app));
  assert.equal(booted.root.querySelector("[data-opening-cause]").textContent.includes(selected), true);
  assert.equal(booted.root.querySelector("[data-opening-cause]").textContent.includes("Access is denied."), true);
  const token = booted.app.api.token;
  for (const node of booted.document.querySelectorAll("p, h2, [data-live]")) assert.equal(node.textContent.includes(token), false);
  const drafts = new Map([["document", { text: "Keep this draft." }]]);
  booted.app.store.drafts = drafts;
  const api = booted.app.api;
  click(booted.root.querySelector("[data-action='choose-folder']"));
  await delay(0);
  assert.deepEqual(handoff, { mindPath: selected });
  assert.equal(booted.app.api, api);
  assert.equal(api.token, token);
  assert.equal(booted.app.store.drafts, drafts);
  assert.equal(booted.app.disposed, false);
  assert.equal(booted.root.querySelector("[data-boot='failed']") != null, true);
});

test("folder reopening enters Location once without answering or replacing the existing host", async () => {
  const calls = [];
  const session = { currentStep: 8, answer() { throw new Error("The existing setup draft must not be written."); } };
  const wizard = { url: "http://127.0.0.1:43123/#session=fixture-credential" };
  const reopen = createFolderReopen({ mindPath: "C:\\fixtures\\.m1nd", kitPath: resolve(".") }, {
    createSetupSession: async (input) => { calls.push(input); return session; },
    createWizardServer: async (input) => { assert.equal(input.session, session); return wizard; },
  });
  const [first, second] = await Promise.all([reopen(), reopen()]);
  assert.equal(first, wizard);
  assert.equal(second, wizard);
  assert.equal(session.currentStep, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resume, false);
  assert.equal(calls[0].serviceSetup, true);
});

test("the owned folder handoff protects its authority and preserves the host and checkpoint bytes", async (t) => {
  const fixture = await makeCoreFixture();
  let host;
  t.after(async () => { await host?.stop(); await closeGuiHost(); await disposeCoreFixture(fixture); });
  const origin = join(fixture.root, "gui-origin");
  await mkdir(origin, { recursive: true });
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: "hivem1nd-service-config-v1", mindPath: fixture.paths.mind, machine: fixture.machine, origin: { kind: "folder", path: origin }, stagingPath: fixture.paths.staging, port: 0 })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const draft = join(fixture.paths.localDirectory, "setup-draft.json");
  const checkpoint = join(fixture.paths.localDirectory, "setup.json");
  const before = Buffer.from('{"sentinel":"retain the existing setup"}\n');
  await writeFile(draft, before);
  await writeFile(checkpoint, before);
  host = await startGui({ mindPath: fixture.paths.mind, env: fixture.env, home: fixture.home, platform: fixture.platform, machine: fixture.machine, now: () => fixture.clock.now, aclRunner: fixture.store.aclRunner });
  const headers = { Origin: host.origin, Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" };
  const selected = await fetch(`${host.origin}/api/v1/viewer/folder`, { headers });
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).data.mindPath, fixture.paths.mind);
  const rejected = await fetch(`${host.origin}/api/v1/viewer/folder`, { method: "POST", headers: { ...headers, Origin: "http://127.0.0.1:1" }, body: "{}" });
  assert.equal(rejected.status, 403);
  await rejected.arrayBuffer();
  const opened = await fetch(`${host.origin}/api/v1/viewer/folder`, { method: "POST", headers, body: "{}" });
  assert.equal(opened.status, 200);
  const wizard = new URL((await opened.json()).data.url);
  const credential = new URLSearchParams(wizard.hash.slice(1)).get("session");
  const step = await fetch(`${wizard.origin}/api/v1/step`, { headers: { Origin: wizard.origin, Authorization: `Bearer ${credential}` } });
  assert.equal(step.status, 200);
  assert.equal((await step.json()).data.id, "location");
  assert.equal((await readFile(draft)).equals(before), true);
  assert.equal((await readFile(checkpoint)).equals(before), true);
  assert.equal(host.stopped, false);
  const viewer = await fetch(`${host.origin}/api/v1/viewer`, { headers });
  assert.equal(viewer.status, 200);
  await viewer.arrayBuffer();
});

test('an undismissed discovery offer stays closed when a cluster already exists', () => {
  const opened = [];
  const app = {
    disposed: false, startDialog: null, layout: 'desktop', language: 'en', overseerOffered: true,
    root: { ownerDocument: { body: { append(node) { opened.push(node); } }, createElement() { return { className: '', children: [], append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, replaceChildren() {}, style: {} }; } } },
    store: {
      capabilities: ['unit.create'],
      indexes: {
        groups: new Map([['shop', { id: 'shop', deleted: false, title: 'shop' }]]),
        units: new Map([['root:overseer', { id: 'root:overseer', role: 'overseer', removed: false }]]),
      },
    },
    startProjects: { discoveryOffer: { id: 'offer-1', dismissed: false, groups: [{ id: 'web', repositories: [{ id: 'shop', name: 'shop', worktrees: [] }] }] } },
  };
  maybeStartDiscovery(app);
  assert.equal(opened.length, 0);
  assert.equal(app.startDialog, null);
});

test('mounted first-open discovery filters canonical selections, imports explicitly and then offers the Overseer', async t => {
  let repository;
  const writes = [];
  const desktop = await startCoreDesktop(t, { prepare: async fixture => {
    repository = join(fixture.home, 'Web', 'shop'); await mkdir(join(repository, '.git'), { recursive: true });
    await writeFile(join(repository, 'retained.txt'), 'Unchanged repository.');
    return { gitRunner: async (_exe, args, options) => {
      if (args.includes('rev-parse')) return { stdout: args.includes('--show-toplevel') ? `${options.cwd}\n` : `${join(options.cwd, '.git')}\n` };
      if (args.includes('worktree')) return { stdout: `worktree ${options.cwd}\0HEAD ${'a'.repeat(40)}\0branch refs/heads/main\0\0` };
      if (args.includes('config')) return { stdout: '', code: 1 };
      throw new Error('Unexpected Git write or read.');
    } };
  }, afterFetch: async (input, init, response) => { if (init.method === 'POST') writes.push(new URL(input).pathname); return response; } });
  const offer = desktop.app.startProjects.discoveryOffer;
  let dialog = desktop.document.querySelector('[data-start-dialog="discovery"]'); assert.ok(dialog);
  assert.equal(desktop.app.store.indexes.groups.size, 0); assert.equal(writes.length, 0);
  typeInput(dialog.querySelector('[data-start-field="filter"]'), 'unmatched', 0, 9);
  assert.equal(dialog.querySelectorAll('[data-discovery-repository]').length, 0);
  assert.equal(dialog.querySelector('[data-action="import-repositories"]').textContent, 'Import 1');
  typeInput(dialog.querySelector('[data-start-field="filter"]'), '', 0, 0);
  const folder = dialog.querySelector(`[data-discovery-folder="${offer.groups[0].id}"]`);
  folder.checked = false; for (const run of folder.listeners.get('change') ?? []) run();
  assert.equal(dialog.querySelector('[data-action="import-repositories"]').textContent, 'Import 0');
  const restored = dialog.querySelector(`[data-discovery-folder="${offer.groups[0].id}"]`); restored.checked = true;
  for (const run of restored.listeners.get('change') ?? []) run();
  const confirm = dialog.querySelector('[data-action="import-repositories"]'); const imported = clickAndWait(confirm); click(confirm);
  assert.equal(confirm.getAttribute('aria-busy'), 'true');
  await imported;
  await waitFor(() => desktop.document.querySelector('[data-start-dialog="overseer"]'), 'The Overseer was not offered after import.').catch(error => {
    throw new Error(`${error.message} ${JSON.stringify({ code: desktop.document.querySelector('[data-start-error]')?.getAttribute('data-start-error') ?? desktop.app.startError?.code, dismissed: desktop.app.startProjects.discoveryOffer.dismissed, clusters: desktop.app.store.indexes.groups.size, dialogs: desktop.document.querySelectorAll('[data-start-dialog]').map(node => node.getAttribute('data-start-dialog')) })}`);
  });
  assert.equal(desktop.app.store.indexes.groups.size, 2); assert.equal(writes.filter(route => route.endsWith('/answer')).length, 1);
  assert.equal(await readFile(join(repository, 'retained.txt'), 'utf8'), 'Unchanged repository.'); assert.equal(desktop.launches.length, 0);
  dialog = desktop.document.querySelector('[data-start-dialog="overseer"]'); click(dialog.querySelector('[data-action="cancel-agent"]'));
  assert.equal(desktop.document.querySelector('[data-start-dialog="discovery"]'), null);
});

test('a superseded start report waits for the winning read before offering the Overseer', async t => {
  const desktop = await startCoreDesktop(t), { app, root } = desktop;
  closeStream(app.api.live);
  app.startDialog?.dialog.close();
  await app.startReportPending;
  let releasePrevious, releaseCurrent;
  const previous = new Promise(resolve => { releasePrevious = resolve; });
  const current = new Promise(resolve => { releaseCurrent = resolve; });
  t.after(() => { releasePrevious(); releaseCurrent(); });
  const reports = new Map([
    ['/api/v1/settings/projects', app.startProjects], ['/api/v1/settings/agents', app.startAgents],
    ['/api/v1/clusters', { items: [], total: 0 }], ['/api/v1/additions', { items: [] }],
  ]);
  let batch = 0;
  app.api.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/api/v1/settings/projects') batch++;
    await (batch === 1 ? previous : current);
    return jsonEnvelope(200, structuredClone(reports.get(url.pathname)));
  };
  app.overseerOffered = false;
  app.startError = new ApiError(503, 'service_unavailable', 'Read the reports again.'); renderShell(app);
  const earlier = clickAndWait(root.querySelector('[data-action="retry-start-reports"]'));
  const later = clickAndWait(root.querySelector('[data-action="retry-start-reports"]'));
  releasePrevious();
  await delay(0);
  assert.equal(app.startDialog ?? null, null);
  releaseCurrent();
  await Promise.all([earlier, later]);
  assert.ok(desktop.document.querySelector('[data-start-dialog="overseer"]'));
  assert.equal(app.startError, null);
});

function discoveryApp(units) {
  const { document, root } = createTestDocument(1440);
  const app = {
    root, layout: 'desktop', language: 'en', selectedFolder: 'mind', overseerOffered: false, startDialog: null, startError: null,
    startProjects: {}, startAgents: { connectedClients: [{ id: 'codex', connected: true, title: 'Codex', scopeEnforced: true, models: [{ id: 'observed', title: 'Observed', efforts: ['high'] }] }], defaultRunsIn: null },
    startStorage: { getItem: () => null, setItem() {} },
    unitList: { catalog: [] },
    store: { capabilities: ['unit.create'], view: { units, mind: { machine: 'DESKTOP' } }, indexes: { units: new Map(), groups: new Map() }, selected: {}, settings: null },
  };
  return { app, document };
}

test('an existing Overseer is not offered when the unit list is still empty', () => {
  const offered = discoveryApp([{ id: 'root:overseer', role: 'overseer', unit: 'overseer', removed: false }]);
  maybeStartDiscovery(offered.app);
  assert.equal(offered.document.querySelector('[data-start-dialog="overseer"]') == null, true);
  const first = discoveryApp([]);
  maybeStartDiscovery(first.app);
  assert.ok(first.document.querySelector('[data-start-dialog="overseer"]'));
});

test('first-open Later persists without a launch and explicit Overseer creation reconciles a lost response once', async t => {
  const storage = new Map(), writes = []; let drop = true;
  const desktop = await startCoreDesktop(t, { storage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) }, afterFetch: async (input, init, response) => {
    if (init.method === 'POST' && new URL(input).pathname === '/api/v1/overseer') {
      writes.push({ key: init.headers['Idempotency-Key'], body: init.body });
      if (drop) { drop = false; await response.arrayBuffer(); throw new Error('Reply lost after commit.'); }
    }
    return response;
  } });
  let dialog = desktop.document.querySelector("[data-start-dialog='overseer']"); assert.ok(dialog);
  assert.equal(desktop.root.querySelector("[data-unit-id='root:master']"), null); assert.equal(desktop.launches.length, 0);
  const beforeDismissal = storage.size;
  click(dialog.querySelector("[data-action='cancel-agent']"));
  assert.equal(storage.size, beforeDismissal + 1);
  assert.equal(storage.get(`hivem1nd:overseer:${desktop.app.selectedFolder}`), 'dismissed'); // Compatibility: browser storage and desktop bridge names remain stable.
  renderShell(desktop.app); assert.equal(desktop.document.querySelector("[data-start-dialog='overseer']"), null);
  click(desktop.root.querySelector("[data-action='create-overseer']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='overseer']"), 'The Overseer choice did not reopen.');
  dialog = desktop.document.querySelector("[data-start-dialog='overseer']"); const create = dialog.querySelector("[data-action='create-agent']"); click(create); click(create);
  assert.equal(create.getAttribute('aria-busy'), 'true');
  await waitFor(() => dialog.querySelector('[data-start-error]'), 'The unconfirmed creation was lost.');
  click(dialog.querySelector("[data-action='create-agent']"));
  await waitFor(() => desktop.app.store.selected.unitId === 'root:overseer' && desktop.app.unitList.catalog.some(unit => unit.id === 'root:overseer'), 'The actual Overseer was not selected.');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]); assert.equal(desktop.launches.length, 0);
  assert.equal(desktop.app.unitList.catalog.filter(unit => unit.id === 'root:overseer').length, 1);
});

test('a failed first-open creation retains its selected runtime, fresh preference and named retry', async t => {
  const desktop = await startCoreDesktop(t, { afterFetch: async (input, init, response) => {
    if (init.method === 'POST' && new URL(input).pathname === '/api/v1/overseer') return new Response(JSON.stringify({ error: { code: 'machine_unavailable', message: 'The selected machine is unavailable.' } }), { status: 409 });
    return response;
  } });
  const dialog = desktop.document.querySelector("[data-start-dialog='overseer']"); click(dialog.querySelector("[data-action='create-agent']"));
  await waitFor(() => dialog.querySelector('[data-start-error]'), 'The failure was not visible.');
  assert.equal(dialog.querySelector('[data-start-fresh]').checked, true); assert.equal(desktop.app.store.selected.unitId, null); assert.equal(desktop.launches.length, 0);
  assert.equal(desktop.document.activeElement, dialog.querySelector("[data-action='create-agent']"));
});

test("manual presentation choices replace only their viewer override and retry without another settings write", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  await request(api, "PATCH", "/viewer", { operation: createOperation({
    method: "PATCH", path: "/viewer", body: { look: "modern", language: "en" },
  }) });
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === "PATCH") writes.push({ path: new URL(String(input)).pathname, key: headerValue(init.headers, "Idempotency-Key") });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  const before = await countNamedEvents(fixture.root, "settings.changed");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/viewer", dropAfterCommit: true });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost viewer response did not offer Retry.");
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "success", "The viewer retry did not finish.");
  assert.equal(desktop.app.look, "high-contrast");
  assert.equal(desktop.app.language, "en");
  const viewerWrites = writes.filter(item => item.path === "/api/v1/viewer");
  assert.equal(viewerWrites.length, 2);
  assert.equal(viewerWrites[0].key, viewerWrites[1].key);
  assert.equal(writes.filter(item => item.path === "/api/v1/settings").length, 1);
  assert.equal(await countNamedEvents(fixture.root, "settings.changed"), before + 1);
  let viewer = (await request(api, "GET", "/viewer")).data;
  assert.equal(viewer.look, null);
  assert.equal(viewer.language, "en");
  click(desktop.root.querySelector("[data-language='es']"));
  await waitFor(() => desktop.app.language === "es" && desktop.app.activity.get("settings")?.phase === "success", "The language override was not replaced.");
  viewer = (await request(api, "GET", "/viewer")).data;
  assert.equal(viewer.language, null);
  assert.equal(desktop.document.documentElement.lang, "es");
});

test("a lost settings or home response retries the same mutation", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (!init?.body || (init.method !== "PATCH" && init.method !== "POST")) return;
    if (!target.includes("/settings")) return;
    writes.push({
      method: init.method,
      path: new URL(target).pathname,
      key: headerValue(init.headers, "Idempotency-Key"),
      body: JSON.parse(init.body),
    });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  const settingsBefore = await countNamedEvents(fixture.root, "settings.changed");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", dropAfterCommit: true });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost settings response did not offer Retry.");
  click(desktop.root.querySelector("[data-language='es']"));
  await waitFor(() => desktop.root.querySelector("[data-language='es']")?.getAttribute("aria-pressed") === "true", "The later language choice did not settle.");
  assert.equal(desktop.app.actionKey === "settings" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  const settingsWrites = writes.filter((item) => item.path === "/api/v1/settings");
  assert.equal(settingsWrites.length, 3);
  assert.equal(settingsWrites[0].key, settingsWrites[1].key);
  assert.equal(settingsWrites[0].body.look, "high-contrast");
  assert.equal(settingsWrites[0].body.expectedRevision, settingsWrites[1].body.expectedRevision);
  assert.equal(settingsWrites[2].key === settingsWrites[0].key, false);
  assert.equal(settingsWrites[2].body.language, "es");
  assert.equal(settingsWrites[2].body.expectedRevision === settingsWrites[0].body.expectedRevision, false);
  assert.equal(await countNamedEvents(fixture.root, "settings.changed"), settingsBefore + 2);

  fixture.control.setFault({ method: "POST", path: "/api/v1/settings/home-network", dropAfterCommit: true });
  clickAction(desktop.root, "open-home");
  await waitFor(() => desktop.root.querySelector("[data-action='retry-activity']"), "The lost home response did not offer Retry.");
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("home-open")?.phase === "success", "Home retry did not resolve.");
  assert.equal(desktop.app.actionKey === "home-open" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  const homeWrites = writes.filter((item) => item.path === "/api/v1/settings/home-network");
  assert.equal(homeWrites.length, 2);
  assert.equal(homeWrites[0].key, homeWrites[1].key);
  assert.deepEqual(homeWrites[0].body, homeWrites[1].body);
  const home = await request(desktop.app.api, "GET", "/settings");
  assert.equal(home.data.home.enabled, true);
});

test("a resolved action clears only its own error and navigation drops stale announcements", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:029']"), "The task list did not load.");
  fixture.control.setFault({ method: "POST", path: "/api/v1/tasks/project:shop:029/status", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-task='project:shop:029']").querySelector("[data-action='accept']"));
  await waitFor(() => desktop.app.activity.get("task:project:shop:029")?.phase === "error", "The task failure was not kept.");
  const taskFailure = desktop.app.activity.get("task:project:shop:029");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "error", "The settings failure was not shown.");
  assert.equal(taskFailure.phase, "error");
  desktop.app.embeddedHost = { embeddedUpdate() {} };
  navigate(desktop.app, "document");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']"), null);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  navigate(desktop.app, "settings");
  click(desktop.root.querySelector("[data-action='retry-activity'][data-activity='settings']"));
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "success", "The settings retry did not finish.");
  assert.equal(desktop.app.actionKey === "settings" && desktop.app.actionTone === "error", false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");

  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']"), null);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The action failed."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector("[data-activity='task:project:shop:029']") != null, true);

  navigate(desktop.app, "chats");
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === chat.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  fixture.control.setFault({ method: "POST", path: `/api/v1/chats/${chat.id}/messages`, status: 503, code: "timeout" });
  typeInput(desktop.root.querySelector("[data-composer]"), "Retry me", 0, 8);
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.root.querySelector("[data-action-note]")?.getAttribute("data-code") === "timeout", "The chat failure was not announced.");
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.length > 0, true);
  click(desktop.root.querySelector("[data-action='retry-message']"));
  await waitFor(() => [...desktop.root.querySelectorAll("[data-message]")].some((node) => node.textContent === "Retry me" && node.getAttribute("data-pending") == null), "The retried chat was not delivered.");
  assert.notEqual(desktop.app.actionKey, `chat:${chat.id}`);
  assert.notEqual(desktop.root.querySelector("[data-action-note]")?.getAttribute("data-code"), "timeout");
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("timed out"), false);
  assert.equal(desktop.app.activity.get("task:project:shop:029").phase, "error");
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
});

test("a failed connection stays open and retries the same targets", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (init?.method !== "PUT" || !target.includes("/lead")) return;
    writes.push({
      path: decodeURIComponent(new URL(target).pathname),
      key: headerValue(init.headers, "Idempotency-Key"),
      body: JSON.parse(init.body),
    });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.mapState?.onConnect && desktop.app.unitList?.catalog?.length, "The map did not offer a connection.");
  const units = desktop.app.unitList.catalog;
  const master = units.find((unit) => unit.role === "master");
  const target = units.find((unit) => unit.role !== "master" && unit.leadId && unit.revision);
  const source = units.find((unit) => unit.id === target.leadId);
  desktop.app.mapState.onConnect({ source: source.id, target: master.id });
  await waitFor(() => desktop.document.querySelector("dialog")?.getAttribute("open") != null, "The connection dialog did not open.");
  click(desktop.document.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent.includes("not valid"), "A rejected connection did not reopen with its failure note.");
  assert.equal(desktop.document.querySelector("dialog").getAttribute("open") != null, true);
  assert.equal(desktop.document.querySelector("[data-dialog-error]").getAttribute("data-code"), "invalid_lead");
  assert.equal(desktop.app.mapState.pendingConnect, null);
  assert.equal(desktop.root.querySelector("[data-pending-edge]"), null);
  assert.equal(desktop.app.mapState.selection.has(master.id), true);
  assert.equal(writes.length, 0);
  click(desktop.document.querySelector("dialog").querySelector("button"));
  await waitFor(() => desktop.document.querySelector("dialog") == null, "Cancel did not close the dialog.");

  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  await waitFor(() => desktop.document.querySelector("button.primary"), "The connection dialog did not return.");
  fixture.control.setFault({ method: "PUT", path: `/api/v1/units/${target.id}/lead`, dropAfterCommit: true });
  click(desktop.document.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-dialog-error]")?.textContent.includes("not known yet"), "An unknown connection result did not reopen for retry.");
  assert.equal(desktop.document.querySelector("dialog").getAttribute("open") != null, true);
  assert.equal(desktop.app.mapState.selection.has(target.id), true);
  const retry = desktop.document.querySelector("dialog").querySelector("button.primary");
  assert.equal(retry.textContent, "Retry");
  click(retry);
  await waitFor(() => desktop.document.querySelector("dialog") == null, "A resolved connection did not close.");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, writes[1].path);
  assert.equal(writes[0].key, writes[1].key);
  assert.deepEqual(writes[0].body, writes[1].body);
});

test("personal folders, zones and chats select one group and deletion offers only ten seconds of Undo", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const members = ["project:shop:executor-shop", "env:web:overlord-web", "project:blog:executor-shop"];
  const before = (await request(api, "GET", "/units")).data.items.map((unit) => [unit.id, unit.leadId]);
  const direct = (await request(api, "GET", "/chats", { query: { listed: "true" } })).data.items.filter((chat) => chat.kind === "direct").map((chat) => chat.id);
  const group = (await createGroup(api, "Checkout launch", members)).data;
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  assert.ok(desktop.app.activeRows.some(row => row.id === 'section:clusters'));
  const folder = desktop.root.querySelector(`[data-cluster-row="${group.id}"]`);
  assert.equal(folder.getAttribute("aria-expanded"), "false");
  assert.equal(desktop.root.querySelector("[data-action='new-cluster']").getAttribute("aria-label"), "New cluster");
  click(folder);
  await waitFor(() => desktop.app.thread?.chat?.id === group.chatId, "The folder did not select its linked chat.");
  assert.equal(desktop.app.store.selected.groupId, group.id);
  assert.equal(desktop.root.querySelector(`[data-cluster-inspector="${group.id}"]`) != null, true);
  assert.equal(desktop.root.querySelector("[data-composer]").getAttribute("aria-label"), "Message Checkout launch");
  assert.equal(desktop.root.querySelectorAll(".field-hint").some((node) => node.textContent.includes("Goes to the cluster")), true);
  assert.equal(desktop.app.activeRows.filter((row) => row.personalMember).length, 0);
  click(desktop.root.querySelector(`[data-group-id="${group.id}"]`));
  assert.equal(desktop.app.store.selected.groupId, group.id);
  navigate(desktop.app, "chats");
  desktop.app.activeHandlers.onActivate({ id: group.chatId, kind: "chat" }, "single");
  assert.equal(desktop.app.store.selected.groupId, group.id);
  clickAction(desktop.root, "cluster-more");
  const dialog = desktop.document.querySelector("dialog");
  assert.match(dialog.querySelector("p").textContent, /Files and work stay/);
  click(dialog.querySelector("button.primary"));
  await waitFor(() => !desktop.app.store.indexes.groups.has(group.id) && desktop.root.querySelector("[data-action='map-undo']"), "The confirmed deletion did not offer Undo.");
  const archived = (await request(api, "GET", "/chats", { query: { archived: "true" } })).data.items;
  assert.equal(archived.some((chat) => chat.id === group.id && chat.archived), true);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.store.indexes.groups.has(group.id), "Undo did not restore the group.");
  await waitFor(() => desktop.app.activity.get(undoKey)?.phase === "success", "Undo did not finish.");
  // Undo runs in Activity and selects the cluster again when it is back.
  await waitFor(() => desktop.root.querySelector("[data-action='cluster-more']") && desktop.app.store.selected.groupId === group.id, "Undo did not select the cluster again.");
  clickAction(desktop.root, "cluster-more");
  click(desktop.document.querySelector("dialog").querySelector("button.primary"));
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']"), "The second deletion did not offer Undo.");
  await fixture.control.advance(10001);
  const originalClock = desktop.app.api.now;
  desktop.app.api.now = () => originalClock() + 10001;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  const remaining = (await request(api, "GET", "/chats", { query: { listed: "true" } })).data.items;
  assert.equal(direct.every((id) => remaining.some((chat) => chat.id === id)), true);
  assert.deepEqual((await request(api, "GET", "/units")).data.items.map((unit) => [unit.id, unit.leadId]), before);
});

test('a new empty cluster has one chat and no agent or reporting change until New agent is confirmed', async t => {
  const desktop = await startCoreDesktop(t); click(desktop.document.querySelector("[data-action='cancel-agent']"));
  click(desktop.root.querySelector("[data-action='new-cluster']")); const dialog = desktop.document.querySelector("[data-start-dialog='cluster']");
  typeInput(dialog.querySelector("[name='title']"), 'Planning', 0, 8); click(dialog.querySelector("[data-action='create-cluster']"));
  await waitFor(() => desktop.app.store.selected.groupId, 'The cluster was not created.');
  const id = desktop.app.store.selected.groupId; assert.equal(desktop.app.store.indexes.groups.get(id).members.length, 0);
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The cluster composer did not open.');
  assert.equal(desktop.root.querySelector('[data-composer]').getAttribute('aria-label'), 'Message Planning');
  click(desktop.root.querySelector("[data-action='new-agent']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='agent']"), 'The agent choices did not open.');
  const agent = desktop.document.querySelector("[data-start-dialog='agent']");
  assert.equal(agent.querySelector("[name='unit']"), null); assert.equal(agent.querySelector("[name='machine']"), null);
  click(agent.querySelector("[data-action='create-agent']"));
  await waitFor(() => desktop.app.unitList.catalog.some(unit => unit.clusterId === id), 'The derived agent was not created.');
  assert.equal(desktop.launches.length, 0); assert.equal((await request(desktop.app.api, 'GET', '/settings/agents')).data.defaultRunsIn, null);
});

test("R13 connection closes the dialog, draws immediately and Undo restores the recorded lead", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== "PUT" || !String(input).endsWith("/lead")) return;
    writes.push(JSON.parse(init.body));
    if (writes.length === 1) await gate;
  });
  t.after(() => release());
  t.after(() => dispose(desktop.app));
  const target = desktop.app.unitList.catalog.find((unit) => unit.id === "project:blog:executor-shop");
  const source = desktop.app.unitList.catalog.find((unit) => unit.id === "env:web:overlord-web");
  const group = (await createGroup(apiFrom(fixture.desktopUrl), "Keep membership", [target.id])).data;
  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  let dialog = desktop.document.querySelector("dialog");
  assert.match(dialog.querySelector("p").textContent, /Executor shop will report to Overlord web/);
  assert.match(dialog.querySelector("p").textContent, /Clusters and chats do not change/);
  click(dialog.querySelector("button"));
  assert.equal(writes.length, 0);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, target.leadId);
  desktop.app.mapState.onConnect({ source: source.id, target: target.id });
  dialog = desktop.document.querySelector("dialog");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => writes.length === 1, "The connection was not submitted.");
  assert.equal(writes[0].leadId, source.id);
  assert.equal(desktop.document.querySelector("dialog"), null);
  assert.equal(desktop.root.querySelector("[data-pending-edge]") != null, true);
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, target.leadId);
  release();
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']") && desktop.document.querySelector("dialog") == null
    && desktop.app.unitList.catalog.find(unit => unit.id === target.id)?.leadId === source.id, "The committed connection did not offer Undo.");
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id).leadId, source.id);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => ["success", "error"].includes(desktop.app.activity.get(undoKey)?.phase)
    && desktop.app.unitList.catalog.find(unit => unit.id === target.id)?.leadId === target.leadId, "Undo did not settle.");
  assert.equal(desktop.app.activity.get(undoKey).error?.code ?? null, null);
  assert.equal(writes.length, 2);
  assert.equal(desktop.app.unitList.catalog.find((unit) => unit.id === target.id)?.leadId, target.leadId);
  assert.equal(writes[1].leadId, target.leadId);
  assert.deepEqual((await request(apiFrom(fixture.desktopUrl), "GET", "/groups")).data.items.find((item) => item.id === group.id).members, [target.id]);
});

test("alias keyboard, menu, cancel, conflicts and Undo preserve the recorded previous alias", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const id = "project:blog:executor-shop";
  const original = (await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data;
  await setUnitAlias(api, original, "Previous blog");
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === "PATCH" && String(input).endsWith("/alias")) writes.push(JSON.parse(init.body));
  });
  t.after(() => dispose(desktop.app));
  const unit = desktop.app.unitList.catalog.find((item) => item.id === id);
  desktop.app.activeHandlers.onActivate({ id, kind: "unit", unit }, "double");
  await waitFor(() => desktop.app.thread?.chat?.members?.includes(id), "The unit chat did not open.");
  assert.equal(desktop.app.mapState.centered, id);
  assert.equal(desktop.root.querySelector("[data-alias-input]"), null);
  const row = desktop.root.querySelector(`[data-id="${id}"]`);
  for (const handler of desktop.root.listeners.get("keydown") ?? []) handler({ key: "F2", target: row, preventDefault() {} });
  let input = desktop.root.querySelector("[data-alias-input]");
  assert.equal(desktop.document.activeElement, input);
  typeInput(input, "Canceled", 0, 8);
  for (const handler of input.listeners.get("keydown")) handler({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(desktop.app.aliasEdit, null);
  assert.equal(writes.length, 0);
  clickAction(desktop.root, "rename-unit");
  input = desktop.root.querySelector("[data-alias-input]");
  typeInput(input, "Blog", 0, 4);
  const current = (await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data;
  await setUnitAlias(api, current, "Elsewhere");
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  await waitFor(() => desktop.app.aliasEdit?.error && !desktop.app.aliasEdit.saving, "The alias conflict did not retain the draft.");
  assert.equal(desktop.app.aliasEdit.value, "Blog");
  assert.equal(desktop.root.querySelector("[data-action='map-undo']"), null);
  input = desktop.root.querySelector("[data-alias-input]");
  desktop.app.aliasEdit.value = "An older input event";
  input.value = "Blog";
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  await waitFor(() => !desktop.app.aliasEdit && desktop.root.querySelector("[data-action='map-undo']") && desktop.app.unitList.catalog.find((item) => item.id === id)?.alias === "Blog", "The alias retry did not commit.");
  const renamed = desktop.app.unitList.catalog.find((item) => item.id === id);
  assert.equal(renamed.alias, "Blog");
  assert.equal(renamed.id, id);
  assert.equal(renamed.leadId, original.leadId);
  for (const host of [desktop.root.querySelector(`[data-id="${id}"]`), desktop.root.querySelector(`[data-unit-id="${id}"]`), desktop.root.querySelector(".chat-title")]) {
    assert.equal(host.querySelector(".unit-alias").textContent, "Blog");
    assert.equal(host.querySelector(".unit-original").textContent, "Executor shop");
  }
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.unitList.catalog.find((item) => item.id === id)?.alias === "Elsewhere", "Undo did not restore the authoritative previous alias.");
  assert.equal(writes.at(-1).alias, "Elsewhere");
  assert.notEqual(writes.at(-1).expectedRevision, writes[0].expectedRevision);
});

test("selection actions count canonical recipients and Message all creates no personal group", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const ids = ["project:shop:executor-shop", "env:web:overlord-web", "project:blog:executor-shop"];
  desktop.app.mapState.selection = new Set(["root:master", ...ids]);
  desktop.app.mapState.onSelection([...desktop.app.mapState.selection]);
  assert.equal(desktop.root.querySelector("[data-selection-count]").getAttribute("data-selection-count"), "3");
  assert.equal(desktop.root.querySelector("[data-action='message-all']").textContent, "Message all 3");
  assert.equal(desktop.root.querySelector("[data-action='save-group']"), null);
  clickAction(desktop.root, "message-all");
  await waitFor(() => desktop.app.thread?.chat?.members?.length === 4, "Message all did not open all three recipients.");
  assert.deepEqual(new Set(desktop.app.thread.chat.members), new Set(["root:master", ...ids]));
  assert.equal((await request(apiFrom(fixture.desktopUrl), "GET", "/groups")).data.total, 0);
  desktop.app.mapState.selection = new Set(ids);
  desktop.app.mapState.onSelection(ids);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-action='message-all']").textContent, "Enviar un mensaje a los 3 agentes");
  clickAction(desktop.root, "clear-selection");
  assert.equal(desktop.app.mapState.selection.size, 0);
  assert.equal(desktop.app.store.selected.unitId, null);
});

test('Runs in remains a draft until Create and the default is initially unchecked', async t => {
  const desktop = await startCoreDesktop(t); const dialog = desktop.document.querySelector("[data-start-dialog='overseer']");
  click(dialog.querySelector("[data-action='open-runs-picker']")); const picker = desktop.document.querySelector("[data-start-dialog='picker']");
  assert.ok(picker); assert.equal(picker.querySelector('[data-use-default]').checked, false);
  click(picker.querySelector("[data-action='close-runs-picker']")); click(dialog.querySelector("[data-action='cancel-agent']"));
  assert.equal(desktop.app.unitList.catalog.length, 0); assert.equal(desktop.launches.length, 0);
  assert.equal((await request(desktop.app.api, 'GET', '/settings/agents')).data.defaultRunsIn, null);
});

test('an explicit unit Runs in change survives picker redraws and persists only on Save', async t => {
  const desktop = await startCoreDesktop(t);
  click(desktop.document.querySelector('[data-action="create-agent"]'));
  await waitFor(() => desktop.app.unitList.catalog.some(unit => unit.id === 'root:overseer'), 'The Overseer was not created.');
  await waitFor(() => desktop.root.querySelector('[data-action="change-runs-in"]'), 'The stored choice control was not mounted.');
  const before = desktop.app.unitList.catalog.find(unit => unit.id === 'root:overseer');
  click(desktop.root.querySelector('[data-action="change-runs-in"]'));
  await waitFor(() => desktop.document.querySelector('[data-start-dialog="picker"]'), 'The unit picker did not open.');
  const report = (await request(desktop.app.api, 'GET', '/settings/agents')).data;
  const effort = report.connectedClients[0].models[0].efforts.find(value => value !== before.runsIn.effort);
  const picker = desktop.document.querySelector('[data-start-dialog="picker"]');
  click(picker.querySelector(`[data-action="runs-effort-${effort}"]`));
  assert.equal((await request(desktop.app.api, 'GET', '/units/:unitId', { params: { unitId: before.id } })).data.runsIn.effort, before.runsIn.effort);
  assert.ok(picker.querySelector('[data-action="save-runs-in"]')); assert.equal(picker.querySelector('[data-use-default]').checked, false);
  click(picker.querySelector('[data-action="save-runs-in"]'));
  await waitFor(() => desktop.app.unitList.catalog.find(unit => unit.id === before.id)?.runsIn.effort === effort, 'The explicit choice was not stored.').catch(async error => {
    const stored = (await request(desktop.app.api, 'GET', '/units/:unitId', { params: { unitId: before.id } })).data;
    throw new Error(`${error.message} ${JSON.stringify({ code: desktop.document.querySelector('[data-start-error]')?.getAttribute('data-start-error'), expected: effort, actual: desktop.app.unitList.catalog.find(unit => unit.id === before.id)?.runsIn.effort, stored: stored.runsIn.effort, dialogs: desktop.document.querySelectorAll('[data-start-dialog]').map(node => node.getAttribute('data-start-dialog')) })}`);
  });
  assert.equal((await request(desktop.app.api, 'GET', '/settings/agents')).data.defaultRunsIn, null);
  assert.equal(desktop.launches.length, 0);
});

// A real core with supervised Claude Code and Cursor beside Codex, and a log of every request the shell makes.
async function supervisedDesktop(t) {
  const calls = [];
  const supervised = Object.fromEntries([['claude', 'Claude Code'], ['cursor', 'Cursor']].map(([id, title]) => [id,
    createNativeAdapter(id, { fixture: true, models: ['observed'], efforts: ['high', 'xhigh'],
      describe: async () => ({ id, title, connected: true, scopeEnforced: false, boundary: 'supervised',
        models: [{ id: 'observed', title: 'Observed', efforts: ['high', 'xhigh'], modes: [] }], quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } }) })]));
  const codex = createNativeAdapter('codex', { fixture: true, models: ['observed'], efforts: ['high', 'xhigh'], transcript: ['{"id":1,"result":{"thread":{"id":"owned"}}}'] });
  const desktop = await startCoreDesktop(t, { prepare: async () => ({ adapters: { codex, ...supervised } }),
    afterFetch: async (input, init, result) => { calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : null }); return result; } });
  t.after(() => Promise.all(Object.values(supervised).map(adapter => adapter.close())));
  return { ...desktop, calls };
}
const nodeText = node => [node.textContent, ...(node.children ?? []).map(nodeText)].filter(Boolean).join(' ');
const permissionWrites = calls => calls.filter(call => call.method === 'POST' && call.path.endsWith('/settings/permissions'));
const SUPERVISED_COPY = {
  en: ['ONEM1ND cannot confine this agent on Windows. By default it asks you before every file change and command.',
    "Work automatically: it changes files and runs commands without asking, and can write outside its cluster's folder. You can turn this off in Settings, Permissions."],
  es: ['ONEM1ND no puede confinar a este agente en Windows. De forma predeterminada, consulta antes de cada cambio de archivos y de cada comando.',
    'Trabajar de forma automática: modifica archivos y ejecuta comandos sin consultar, y puede escribir fuera de la carpeta de su clúster. Se puede desactivar en Configuración, Permisos.'],
};
async function chooseSupervised(desktop, { automatic, client = 'claude', language = 'en' }) {
  desktop.app.language = language;
  desktop.app.startDialog.model.language = language;
  desktop.app.startDialog.paint();
  const dialog = desktop.document.querySelector("[data-start-dialog='overseer']");
  click(dialog.querySelector("[data-action='open-runs-picker']"));
  const picker = desktop.document.querySelector("[data-start-dialog='picker']");
  assert.equal(picker.querySelector('[data-native-warning]'), null, 'Codex is chosen first and shows no warning');
  const choice = picker.querySelector(`[data-action="runs-client-${client}"]`);
  assert.equal(choice.disabled, false, 'the connected supervised client is selectable');
  click(choice);
  const banner = picker.querySelector('[data-native-warning]');
  assert.ok(banner, 'the warning appears when the supervised client is chosen');
  assert.equal(banner.getAttribute('data-native-warning'), client);
  assert.ok(nodeText(banner).includes(SUPERVISED_COPY[language][0]));
  const box = picker.querySelector('[data-work-automatically]');
  assert.equal(box.checked, false, 'unchecked by default');
  assert.ok(nodeText(banner).includes(SUPERVISED_COPY[language][1]));
  if (automatic) changeControl(box, true);
  assert.equal(desktop.document.querySelectorAll('.dialog').length, 0, 'no confirmation dialog opens');
  click(picker.querySelector('[data-action="close-runs-picker"]'));
  desktop.app.language = 'en'; renderShell(desktop.app);
  return dialog;
}

test('Claude Code and Cursor show the bilingual warning; Work automatically creates the exact grant after Create and Settings can revoke it', async t => {
  for (const client of ['claude', 'cursor']) for (const language of ['en', 'es']) await t.test(`${client} ${language}`, async t => {
  const desktop = await supervisedDesktop(t);
  const dialog = await chooseSupervised(desktop, { automatic: true, client, language });
  assert.equal(permissionWrites(desktop.calls).length, 0, 'choosing the box changes nothing until the agent is saved');
  click(dialog.querySelector("[data-action='create-agent']"));
  await patient(() => desktop.app.unitList.catalog.some(unit => unit.id === 'root:overseer'), 'The agent was not created.');
  await patient(() => permissionWrites(desktop.calls).length === 1, 'The automatic grant was not created.');
  const writes = desktop.calls.filter(call => call.method !== 'GET');
  assert.ok(writes.findIndex(call => call.path.endsWith('/overseer')) < writes.findIndex(call => call.path.endsWith('/settings/permissions')), 'the grant follows the agent');
  const body = permissionWrites(desktop.calls)[0].body;
  assert.deepEqual({ ...body, expectedRevision: undefined }, { machine: body.machine, unitId: 'root:overseer', client, action: 'native.automatic', expectedRevision: undefined });
  const listed = (await request(desktop.app.api, 'GET', '/settings/permissions')).data.agentPermissions;
  assert.deepEqual(listed.map(item => [item.unitId, item.client, item.actions]), [['root:overseer', client, ['native.automatic']]]);
  await patient(() => desktop.root.querySelector('[data-native-mode="automatic"]'), 'The inspector did not say that the agent works automatically.');
  const mode = desktop.root.querySelector('[data-native-mode]');
  assert.equal(mode.getAttribute('data-native-mode'), 'automatic'); assert.equal(mode.textContent, 'Automatic, not confined');
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-native-mode]').textContent, 'Automático, sin confinamiento');
  desktop.app.language = 'en'; renderShell(desktop.app);
  // Settings, Agents, Permissions lists the grant with Revoke, which applies to the next operation in a running session.
  navigate(desktop.app, 'settings'); await desktop.app.settingsState.pending; await patient(() => desktop.app.settingsState?.loaded && !desktop.app.settingsState.loading, 'Settings did not load.');
  click(desktop.root.querySelector('[data-action="settings-tab-agents"]'));
  await patient(() => desktop.root.querySelector(`[data-permission="${listed[0].id}"]`), 'The grant is not listed in Permissions.');
  const row = desktop.root.querySelector(`[data-permission="${listed[0].id}"]`);
  assert.ok(nodeText(row).includes('root:overseer')); assert.ok(nodeText(row).includes(`Works automatically in ${client === 'claude' ? 'Claude Code' : 'Cursor'}, not confined`));
  assert.ok(nodeText(desktop.root).includes('Revoking makes the agent ask before its next file change or command, including in a session that is already running.'));
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.ok(nodeText(desktop.root).includes('Al revocarlo, el agente consulta antes del siguiente cambio de archivos o comando, incluso en una sesión que ya está en ejecución.'));
  desktop.app.language = 'en'; renderShell(desktop.app);
  const revoke = desktop.root.querySelector(`[data-permission="${listed[0].id}"]`).querySelector('[data-action="settings-revoke-' + listed[0].id + '"]');
  assert.ok(revoke, 'the grant has a Revoke button');
  click(revoke);
  await patient(() => desktop.calls.some(call => call.method === 'DELETE' && call.path.endsWith(`/settings/permissions/${listed[0].id}`)), 'Revoke was not requested.');
  await patient(() => desktop.app.settingsState.permissions?.agentPermissions.length === 0, 'The grant was not revoked.');
  assert.deepEqual((await request(desktop.app.api, 'GET', '/settings/permissions')).data.agentPermissions, []);
  });
});

test('leaving Work automatically unchecked creates no grant, the inspector says Asks first, and a confined client shows nothing', async t => {
  for (const client of ['claude', 'cursor']) await t.test(client, async t => {
  const desktop = await supervisedDesktop(t);
  const dialog = await chooseSupervised(desktop, { automatic: false, client });
  click(dialog.querySelector("[data-action='create-agent']"));
  await patient(() => desktop.app.unitList.catalog.some(unit => unit.id === 'root:overseer'), 'The agent was not created.');
  await patient(() => desktop.root.querySelector('[data-native-mode]'), 'The inspector did not say how the agent works.');
  assert.equal(permissionWrites(desktop.calls).length, 0);
  assert.equal(desktop.root.querySelector('[data-native-mode]').getAttribute('data-native-mode'), 'supervised');
  assert.equal(desktop.root.querySelector('[data-native-mode]').textContent, 'Asks first');
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-native-mode]').textContent, 'Consulta antes');
  assert.deepEqual((await request(desktop.app.api, 'GET', '/settings/permissions')).data.agentPermissions, []);
  // The same agent moved to Codex shows no native line at all.
  click(desktop.root.querySelector('[data-action="change-runs-in"]'));
  await patient(() => desktop.document.querySelector('[data-start-dialog="picker"]'), 'The unit picker did not open.');
  const picker = desktop.document.querySelector('[data-start-dialog="picker"]');
  assert.equal(picker.querySelector('[data-work-automatically]').checked, false);
  click(picker.querySelector('[data-action="runs-client-codex"]'));
  assert.equal(picker.querySelector('[data-native-warning]'), null);
  click(picker.querySelector('[data-action="save-runs-in"]'));
  await patient(() => desktop.app.unitList.catalog.find(unit => unit.id === 'root:overseer')?.runsIn.client === 'codex', 'Codex was not stored.');
  await patient(() => !desktop.root.querySelector('[data-native-mode]'), 'A confined agent still shows a native line.');
  assert.equal(permissionWrites(desktop.calls).length, 0);
  });
});

test('the change Runs in picker shows an existing grant checked and unchecking it revokes the grant on Save', async t => {
  const desktop = await supervisedDesktop(t);
  const dialog = await chooseSupervised(desktop, { automatic: true });
  click(dialog.querySelector("[data-action='create-agent']"));
  await patient(() => permissionWrites(desktop.calls).length === 1 && desktop.root.querySelector('[data-native-mode="automatic"]'), 'The grant was not created.');
  click(desktop.root.querySelector('[data-action="change-runs-in"]'));
  await patient(() => desktop.document.querySelector('[data-start-dialog="picker"]'), 'The unit picker did not open.');
  const picker = desktop.document.querySelector('[data-start-dialog="picker"]');
  const box = picker.querySelector('[data-work-automatically]');
  assert.equal(box.checked, true, 'the existing grant is shown');
  changeControl(box, false);
  click(picker.querySelector('[data-action="runs-effort-xhigh"]'));
  click(picker.querySelector('[data-action="save-runs-in"]'));
  await patient(() => desktop.calls.some(call => call.method === 'DELETE' && call.path.includes('/settings/permissions/')), 'The grant was not revoked.');
  await patient(() => desktop.root.querySelector('[data-native-mode="supervised"]'), 'The inspector still says Automatic.');
  assert.deepEqual((await request(desktop.app.api, 'GET', '/settings/permissions')).data.agentPermissions, []);
  assert.equal(permissionWrites(desktop.calls).length, 1, 'no second grant');
});


test("failure causes and empty lists name the resource and its next step", async (t) => {
  assert.equal(text("en", "requestTimeout"), "The request timed out.");
  assert.equal(text("es", "requestTimeout"), "La solicitud agotó el tiempo.");
  assert.equal(text("en", "requestLimited"), "The request limit was reached.");
  assert.equal(text("es", "commentHintText"), "Seleccionar texto y escribir el comentario.");
  assert.throws(() => text("en", "emptyList"), /Unknown copy key: emptyList/);
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='high-contrast']"), "Settings did not open.");
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "timeout" });
  click(desktop.root.querySelector("[data-look='high-contrast']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "timeout", "The timeout was not recorded.");
  const timeoutText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(timeoutText.includes("The request timed out."), true);
  assert.equal(timeoutText.includes("Try again."), true);
  assert.equal(desktop.root.querySelector("[data-action='retry-activity']") != null, true);

  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 503, code: "service_unavailable" });
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "service_unavailable", "The unavailable cause was not recorded.");
  const unavailableText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(unavailableText.includes("The service is unavailable."), true);
  assert.equal(unavailableText.includes("Try again."), true);

  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", status: 429, code: "request_rate_limited" });
  click(desktop.root.querySelector("[data-action='retry-activity']"));
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "request_rate_limited", "The limit cause was not recorded.");
  const limitedText = desktop.root.querySelector("[data-activity='settings']")?.textContent ?? "";
  assert.equal(limitedText.includes("The request limit was reached."), true);
  assert.equal(limitedText.includes("Try again."), true);
  assert.equal(limitedText.includes("Wait and try again."), false);

  navigate(desktop.app, "map");
  await waitFor(() => desktop.app.unitList && desktop.app.unitList.status !== "loading", "The unit list did not settle.");
  if (desktop.app.store.view) desktop.app.store.view.issues = [];
  desktop.app.unitList.issues = [];
  desktop.app.unitList.query = "zzzz-no-match";
  desktop.app.unitList.status = "empty";
  renderShell(desktop.app);


  assert.equal(desktop.root.querySelector("[data-action='clear-search']")?.textContent, "Clear search");

  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.app.waitingList && desktop.app.waitingList.status !== "loading" && desktop.root.querySelector("[data-waiting-panel]"), "Waiting did not open.");
  desktop.app.waitingList.items = [];
  desktop.app.waitingList.total = 0;
  desktop.app.waitingList.status = "empty";
  renderShell(desktop.app);
  const waiting = desktop.root.querySelector("[data-waiting-panel]");
  assert.equal(waiting.querySelector("[data-empty='waiting']")?.textContent, "Nothing is waiting.");
  assert.equal(waiting.querySelector("[data-empty-next='waiting']")?.textContent, "Open the map to find who is waiting.");
  assert.equal(waiting.querySelector("[data-action='show-map']"), null, "the Map is already beside the panel");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Nothing to show yet.")), false);

  desktop.app.waitingOpen = false;
  navigate(desktop.app, "chats");
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The composer did not open.");
  await waitFor(() => desktop.app.activity.get(`chat-load:${chat.id}`)?.phase === "success", "The conversation did not finish loading.");
  desktop.app.thread.messages = [];
  desktop.app.thread.total = 0;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='chat']")?.textContent, "No messages yet. Write one below.");

  assert.equal(desktop.root.querySelector("[data-action='mailbox']"), null);
  assert.equal(desktop.root.querySelector('[data-mailbox-view]'), null);
});


test("the GUI import graph stays inside its ownership table", async () => {
  const plan = await readFile("docs/3.0/plan-gui.md", "utf8");
  const section = plan.split("## File ownership")[1].split("\n## ")[0];
  const owned = new Set([...section.matchAll(/`((?:gui\/app|test)\/[^`]+)`/g)].map((match) => match[1]));
  const integration = await readFile('docs/3.0/integration.md', 'utf8');
  assert.match(integration.split('#### T046.')[1].split('#### T047.')[0], /`gui\/app\/find-worker\.mjs`, new isolated regex worker/);
  owned.add('gui/app/embedded-apps.mjs');
  assert.equal(owned.has("gui/app/phone.mjs"), true);
  assert.equal(owned.has("gui/app/embed.mjs"), true);
  assert.equal(owned.has("test/gui-fixture.mjs"), true);
  const seen = new Set();
  async function walk(file) {
    const rel = relative(process.cwd(), file).replaceAll("\\", "/");
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.equal(owned.has(rel), true, rel);
    const source = await readFile(file, "utf8");
    const audited = source;
    assert.equal(audited.includes("import("), false, rel);
    const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.equal(specifier.startsWith(".") || specifier.startsWith("node:"), true, specifier);
      assert.equal(/engine|cli|features|https?:|node_modules/.test(specifier), false, specifier);
      if (specifier.startsWith("node:")) {
        assert.equal(rel.startsWith("gui/"), false, specifier);
        continue;
      }
      await walk(resolve(file, "..", specifier));
    }
  }
  await walk(resolve("gui/app/main.mjs"));
  await walk(resolve("test/gui-fixture.mjs"));
  await walk(resolve("test/gui-data.mjs"));
});

function qrDigest(matrix) {
  const text = matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

function decodeHomeQrPath(commands) {
  const matrix = Array.from({ length: 37 }, () => Array(37).fill(false));
  for (const match of commands.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) matrix[Number(match[2]) - 4][Number(match[1]) - 4] = true;
  // Read the version-5 function regions and unmask the byte-mode data from the rendered SVG.
  const reserved = (x, y) => x === 6 || y === 6 || (x <= 8 && y <= 8) || (x >= 29 && y <= 8)
    || (x <= 8 && y >= 29) || (x >= 28 && x <= 32 && y >= 28 && y <= 32);
  const bits = [];
  let upward = true;
  for (let right = 36; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < 37; step++) {
      const y = upward ? 36 - step : step;
      for (const x of [right, right - 1]) if (!reserved(x, y)) bits.push(Number(matrix[y][x] !== ((x + y) % 2 === 0)));
    }
    upward = !upward;
  }
  let position = 0;
  const read = size => { let value = 0; while (size--) value = value * 2 + bits[position++]; return value; };
  assert.equal(read(4), 4);
  const length = read(8);
  return new TextDecoder().decode(Uint8Array.from({ length }, () => read(8)));
}

function apiFrom(url) {
  const parsed = new URL(url);
  return createApi({
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: globalThis.fetch.bind(globalThis),
  });
}

async function exchangeHome(fixture, key) {
  const response = await exchangeRaw(fixture, key);
  assert.equal(response.status, 200);
  return response.json.data.token;
}

async function exchangeRaw(fixture, key) {
  const home = new URL(fixture.phoneUrl);
  const response = await fetch(`${home.origin}/api/v1/auth/home`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: home.origin },
    body: JSON.stringify({ key }),
  });
  return { status: response.status, json: await response.json() };
}

function jsonEnvelope(status, data) {
  const body = JSON.stringify({
    contract: "hivem1nd-gui-v3", // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    data,
    meta: { requestId: "req", readAt: "2026-10-10T12:00:00.000Z", eventCursor: "0", sync: "local" },
  });
  return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } }, text: async () => body };
}

function noteText(booted) {
  return booted.root.querySelector("[data-action-note]")?.textContent ?? "";
}

function typeInput(node, value, start, end) {
  node.value = value;
  node.selectionStart = start;
  node.selectionEnd = end;
  node.focus();
  for (const handler of node.listeners?.get("input") ?? []) handler();
}

function click(node) {
  for (const handler of node?.listeners?.get("click") ?? []) handler({ preventDefault() {}, target: node });
}

// A library row waits in a folded folder until the folders above it are opened, so a test opens them as a person would before it presses the row.
function clickAndWait(node) {
  return Promise.all([...(node?.listeners?.get("click") ?? [])].map(handler => handler({ preventDefault() {}, target: node })));
}

function clickAction(root, action) {
  const node = root.querySelector(`[data-action='${action}']`);
  const event = { target: node, preventDefault() {} };
  let current = node;
  while (current) {
    for (const handler of current.listeners?.get("click") ?? []) handler(event);
    current = current.parent;
  }
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(name.toLowerCase());
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

async function countNamedEvents(root, name) {
  const entries = await readdir(root, { recursive: true });
  const hit = entries.find((entry) => String(entry).endsWith("event-ledger.json"));
  if (!hit) return 0;
  const ledger = JSON.parse(await readFile(join(root, String(hit)), "utf8"));
  return ledger.records.filter((record) => record.name === name).length;
}

function columnIndex(column, node) {
  let current = node;
  while (current && current.parent !== column) current = current.parent;
  return column.children.indexOf(current);
}

async function waitFor(check, label) {
  await patient(check, label);
}

// The ceiling is patient because the whole suite shares a loaded machine; every wait still ends on its condition.
async function patient(check, label, limit = 30000) {
  for (const deadline = Date.now() + limit; Date.now() < deadline; await delay(25)) if (check()) return;
  throw new Error(label);
}

async function until(check) {
  await patient(check, "The phone shell did not reach the expected state.");
}

function sseFrame(name, id, data) {
  const envelope = {
    contract: "hivem1nd-events-v3", // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    at: "2026-10-11T12:00:00.000Z",
    machine: "QA",
    source: { kind: "service", id: "fixture", unitId: "root:master" },
    data,
  };
  return `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

function sameCursorStream(eventsReady, cursor) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await eventsReady;
      const id = cursor();
      const reset = sseFrame("stream.reset", id, { reason: "service_restarted", cursor: id });
      const ready = sseFrame("stream.ready", id, {
        cursor: id,
        readAt: "2026-10-11T12:00:00.000Z",
        capabilities: DESKTOP,
      });
      controller.enqueue(encoder.encode(reset + ready));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

async function bootWithFetch(url, width, fetchImpl, extras = {}) {
  const { document, root, view } = createTestDocument(width);
  const parsed = new URL(url);
  const app = await mount(root, {
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: fetchImpl,
    ...extras,
  });
  return { app, root, view, document };
}

async function startCoreDesktop(t, { afterFetch = null, storage = null, width = 1440, prepare = null } = {}) {
  const fixture = await makeCoreFixture();
  const origin = join(fixture.root, 'origin'); await mkdir(origin, { recursive: true });
  const adapter = createNativeAdapter('codex', { fixture: true, models: ['observed'], efforts: ['high', 'xhigh'], transcript: ['{"id":1,"result":{"thread":{"id":"owned"}}}'] });
  const launches = [], original = adapter.create.bind(adapter); adapter.create = async input => { launches.push(input); return original(input); };
  const prepared = await prepare?.(fixture) ?? {};
  const core = await composeCore({ store: fixture.store, paths: { ...fixture.paths, origin }, now: () => fixture.clock.now,
    homeDir: fixture.home, env: fixture.env, projects: [], adapters: { codex: adapter }, probeAgents: async () => ({}), ...prepared });
  const address = `http://127.0.0.1:${core.http.port}`;
  const response = await fetch(`${address}/api/v1/auth/local`, { method: 'POST', headers: { origin: address, authorization: `Bearer ${core.bootstrap.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }) });
  assert.equal(response.status, 201);
  const token = (await response.json()).data.token;
  const desktop = await bootWithFetch(`${address}/#session=${token}`, width, async (input, init) => {
    const result = await fetch(input, init); return afterFetch ? afterFetch(input, init, result) : result;
  }, { storage });
  t.after(async () => { dispose(desktop.app); await core.http.close(); await adapter.close(); await disposeCoreFixture(fixture); });
  return { ...desktop, launches, core, fixture };
}

async function bootApp(url, width, urls, onFetch) {
  const { document, root, view } = createTestDocument(width);
  const parsed = new URL(url);
  const app = await mount(root, {
    location: { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { replaceState() {} },
    fetch: async (input, init) => {
      urls.push(String(input));
      if (onFetch) await onFetch(input, init);
      return fetch(input, init);
    },
  });
  // These tests drive slow requests with mocked timers, so the notice shows at once; its five second wait has its own test.
  app.slowNoticeAfterS = 0;
  if (parsed.hash) {
    await waitFor(() => app.bootSettled && !app.bootReading, "The application did not finish its initial read.");
  }
  return { app, root, view, document };
}

function fakeParent() {
  const parent = { sent: null, postMessage(data, origin) { this.sent = { data, origin }; } };
  return { parent, transport: { parent, addEventListener() {}, removeEventListener() {} } };
}

async function bootstrapSecret(root) {
  const entries = await readdir(root, { recursive: true });
  const hit = entries.find((entry) => String(entry).endsWith("bootstrap.json"));
  return JSON.parse(await readFile(join(root, hit), "utf8")).secret;
}

async function localViewer(fixture, secret, viewer) {
  const response = await fetch(`${fixture.origin}/api/v1/auth/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.origin, Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ embedded: true, hostOrigin: "http://127.0.0.1:9", look: viewer.look, language: viewer.language }),
  });
  const json = await response.json();
  assert.equal(response.status, 201);
  return json.data;
}

function localTime(stamp) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(stamp));
}

function createTestDocument(width = 390) {
  const document = {
    documentElement: null,
    body: null,
    activeElement: null,
    defaultView: null,
    createElement(tag) { return make(tag, null); },
    createElementNS(namespace, tag) { return make(tag, namespace); },
    createTextNode(value) { return make("#text", null, String(value)); },
    createDocumentFragment() { return make("#fragment", null); },
  };
  const view = {
    parent: null,
    innerWidth: width,
    innerHeight: 844,
    getComputedStyle() { return { getPropertyValue: (name) => ({ "--text": "#f5f1f6", "--accent": "#bdcd79", "--waiting": "#e6c06f", "--card": "#211a27" })[name] ?? "" }; },
    btoa, URL, setTimeout, clearTimeout,
    listeners: new Map(),
    addEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    removeEventListener() {},
    requestAnimationFrame() { return 0; },
    postMessage() {},
  };
  document.defaultView = view;
  function make(tag, namespace, text = "") {
    const node = {
      tag,
      tagName: tag.startsWith("#") ? "" : String(tag).toUpperCase(),
      namespace,
      children: [],
      get childNodes() { return this.children; },
      attributes: new Map(),
      listeners: new Map(),
      className: "",
      textContent: text,
      value: "",
      disabled: false,
      tabIndex: 0,
      scrollTop: 0,
      clientWidth: width,
      clientHeight: 640,
      get offsetHeight() {
        if (Number.isFinite(this._offsetHeight)) return this._offsetHeight;
        if (this.getAttribute?.("data-message")) return 48;
        return 0;
      },
      get offsetTop() {
        if (Number.isFinite(this._offsetTop)) return this._offsetTop;
        const parent = this.parent;
        if (!parent?.children) return 0;
        let top = 0;
        for (const child of parent.children) {
          if (child === this) return top;
          top += child.offsetHeight || 0;
        }
        return 0;
      },
      get scrollHeight() {
        if (Number.isFinite(this._scrollHeight)) return this._scrollHeight;
        return (this.children ?? []).reduce((sum, child) => sum + (child.offsetHeight || 0), 0);
      },
      isConnected: true,
      style: {},
      dataset: {},
      contentWindow: tag === "iframe" ? {} : null,
      getContext() { return { measureText: (value) => ({ width: String(value).length * 8 }) }; },
      set src(url) {
        this._src = url;
        if (tag !== "iframe") return;
        const frame = this;
        Promise.resolve().then(async () => {
          const html = await (await fetch(url)).text();
          const scriptUrl = html.match(/<script type="module" src="([^"]+)"/)[1];
          const script = await (await fetch(scriptUrl)).text();
          const prior = globalThis.document;
          globalThis.document = document;
          try {
            const parent = { postMessage(data) { for (const handler of view.listeners.get("message") ?? []) handler({ source: frame.contentWindow, data }); } };
            await new Function("parent", `return (async () => { ${script} })()`)(parent);
          } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
        });
      },
      ownerDocument: document,
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === "class") this.className = String(value);
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      append(...kids) { for (const kid of kids) this.appendChild(kid && typeof kid === "object" ? kid : document.createTextNode(String(kid))); },
      appendChild(kid) {
        if (kid == null) return;
        kid.parent = this;
        kid.parentNode = this;
        this.children.push(kid);
      },
      replaceChildren(...kids) {
        this.children = [];
        this.append(...kids);
      },
      addEventListener(type, handler) {
        const list = this.listeners.get(type) ?? [];
        list.push(handler);
        this.listeners.set(type, list);
      },
      removeEventListener() {},
      querySelector(selector) { return find(this, selector, false); },
      querySelectorAll(selector) { return find(this, selector, true); },
      focus() { this.ownerDocument.activeElement = this; },
      setSelectionRange(start, end, direction = "none") {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
      },
      contains(node) {
        let current = node;
        while (current) {
          if (current === this) return true;
          current = current.parent;
        }
        return false;
      },
      showModal() { this.setAttribute("open", ""); },
      close() {
        this.removeAttribute("open");
        for (const handler of this.listeners.get("close") ?? []) handler();
      },
      remove() {
        const parent = this.parentNode ?? this.parent;
        if (!parent?.children) return;
        parent.children = parent.children.filter((child) => child !== this);
        this.parent = null;
        this.parentNode = null;
      },
      removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          delete this.dataset[key];
        }
      },
      closest(selector) {
        let current = this;
        while (current) {
          if (selectorMatches(current, selector)) return current;
          current = current.parent;
        }
        return null;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width, height: 700 }; },
    };
    return node;
  }
  function find(node, selector, all) {
    const found = [];
    const visit = (current) => {
      for (const child of current.children ?? []) {
        if (selectorMatches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(node);
    return all ? found : (found[0] ?? null);
  }
  document.documentElement = make("html");
  document.body = make("body");
  document.documentElement.append(document.body);
  const root = make("div");
  document.body.append(root);
  document.querySelector = (selector) => find(document.documentElement, selector, false);
  document.querySelectorAll = (selector) => find(document.documentElement, selector, true);
  return { document, root, view };
}

function selectorMatches(node, selector) {
  return selector.split(",").some((part) => selectorPart(node, part.trim()));
}

function selectorPart(node, selector) {
  if (!node || node.tag === "#text") return false;
  let rest = selector;
  if (/^[A-Za-z]/.test(rest)) {
    const tag = /^[A-Za-z][\w-]*/.exec(rest)[0];
    if (node.tag !== tag) return false;
    rest = rest.slice(tag.length);
  }
  while (rest.startsWith(".")) {
    const name = /^[\w-]+/.exec(rest.slice(1))?.[0];
    if (!name || !String(node.className ?? "").split(/\s+/).includes(name)) return false;
    rest = rest.slice(1 + name.length);
  }
  while (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return false;
    const body = rest.slice(1, end);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const expected = eq === -1 ? null : body.slice(eq + 1).replace(/^["']|["']$/g, "");
    const actual = node.getAttribute?.(name);
    if (actual == null || (expected != null && actual !== expected)) return false;
    rest = rest.slice(end + 1);
  }
  return rest.length === 0;
}

test("unit removal confirms scope, cancels safely, retries the same write and restores visibility with Undo", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const id = "project:blog:executor-shop";
  const group = (await createGroup(api, "Shared work", [id, "project:shop:executor-shop"])).data;
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], (input, init) => {
    if (init?.method === "DELETE" && String(input).includes("/units/")) writes.push({ key: init.headers["Idempotency-Key"], body: init.body });
  });
  t.after(() => dispose(desktop.app));
  const choose = () => { desktop.app.mapState.selection = new Set([id]); desktop.app.mapState.onSelection([id]); };
  choose();
  clickAction(desktop.root, "remove-unit");
  let dialog = desktop.document.querySelector("[data-remove-unit]");
  assert.equal(dialog.querySelector("h2").textContent, "Remove Executor shop?");
  assert.equal(dialog.querySelector("button.primary").textContent, "Remove agent");
  assert.match(dialog.querySelector("p").textContent, /tasks stay in the project/);
  assert.equal(dialog.style.width, "480px");
  assert.equal(dialog.style.borderRadius, "22px");
  assert.equal(dialog.querySelectorAll("button")[1].style.background, "var(--error)");
  click(dialog.querySelector("button"));
  assert.equal(writes.length, 0);
  assert.equal((await request(api, "GET", "/units")).data.items.some((unit) => unit.id === id), true);
  choose();
  clickAction(desktop.root, "remove-unit");
  dialog = desktop.document.querySelector("[data-remove-unit]");
  fixture.control.setFault({ method: "DELETE", path: `/api/v1/units/${id}`, dropAfterCommit: true });
  click(dialog.querySelector("button.primary"));
  // The dialog closes at once; the unconfirmed removal fails in Activity, and its Retry replays the same write.
  await waitFor(() => desktop.document.querySelector("[data-remove-unit]") == null && desktop.root.querySelector("[data-queue-state='failed']"), "The unconfirmed removal did not wait in Activity.");
  click(desktop.root.querySelector("[data-action='queue-retry']"));
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']"), "The replayed removal did not offer Undo.");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, writes[1].key);
  assert.equal(writes[0].body, writes[1].body);
  assert.match(desktop.root.querySelector("[data-map-toast]").textContent, /Archived/);
  // The dialog closes once the service confirms; the lists catch up behind it.
  await waitFor(() => !desktop.app.unitList.catalog.some((unit) => unit.id === id) && desktop.app.store.indexes.groups.get(group.id)?.members.length === 1, "The lists did not catch up with the removal.");
  assert.deepEqual(desktop.app.store.indexes.groups.get(group.id).members, ["project:shop:executor-shop"]);
  assert.equal((await request(api, "GET", "/units", { query: { archived: "true" } })).data.items[0].id, id);
  const undoKey = desktop.app.mapToast.key;
  clickAction(desktop.root, "map-undo");
  await waitFor(() => ["success", "error"].includes(desktop.app.activity.get(undoKey)?.phase), "Undo did not finish.");
  assert.equal(desktop.app.activity.get(undoKey)?.phase, "success", `${desktop.app.activity.get(undoKey)?.error?.message} ${desktop.app.activity.get(undoKey)?.error?.details?.path}`);
  await waitFor(() => desktop.app.unitList.catalog.some((unit) => unit.id === id), "Undo did not restore the unit.");
  await waitFor(() => desktop.app.store.indexes.groups.get(group.id)?.members.includes(id), "Undo did not restore group membership.");
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.sessionIds.length, 0);
  desktop.app.language = "es";
  choose();
  clickAction(desktop.root, "remove-unit");
  dialog = desktop.document.querySelector("[data-remove-unit]");
  assert.equal(dialog.querySelector("h2").textContent, "¿Quitar Executor shop?");
  assert.match(dialog.querySelector("p").textContent, /El chat y el buzón pasan a Archivados/);
  assertVisibleCopy("es", [["Removal dialog", dialog.textContent]]);
  click(dialog.querySelector("button"));
});

test("a unit remains visible while stop acknowledgment is pending and Undo does not restart its session", async (t) => {
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const fixture = await createGuiFixture({ stopNative: () => { entered(); return new Promise((resolve) => { release = resolve; }); } });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const id = "project:shop:executor-shop";
  const unit = desktop.app.unitList.catalog.find((unit) => unit.id === id);
  desktop.app.mapState.selection = new Set([id]);
  desktop.app.mapState.onSelection([id]);
  clickAction(desktop.root, "remove-unit");
  const dialog = desktop.document.querySelector("[data-remove-unit]");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => dialog.querySelector("button.primary").getAttribute("aria-busy") === "true", "Removal did not wait for native shutdown.");
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), true);
  const api = apiFrom(fixture.desktopUrl);
  await waiting;
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.removed, false);
  release({ acknowledged: true });
  await waitFor(() => desktop.root.querySelector("[data-action='map-undo']"), "Acknowledged removal did not commit.");
  await waitFor(() => !desktop.app.unitList.catalog.some((unit) => unit.id === id), "The list did not catch up with the removal.");
  clickAction(desktop.root, "map-undo");
  await waitFor(() => desktop.app.unitList.catalog.some((unit) => unit.id === id), "Undo did not restore the stopped unit.");
  assert.equal((await request(api, "GET", "/units/:unitId", { params: { unitId: id } })).data.sessionIds.length, 0);
});

test('the Executor form defaults to one task, rejects an empty task, and cancels a kept-open chat start', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === 'POST' && init.body) writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, 'The units did not load.');
  const operation = createOperation({ method: 'POST', path: '/units', body: { unit: 'executor-session', role: 'executor', scope: { kind: 'project', name: 'shop' }, machine: 'DESKTOP', leadId: null, job: null, model: null } });
  const unit = (await request(desktop.app.api, 'POST', '/units', { operation })).data;
  await waitFor(() => desktop.app.unitList?.catalog?.some((item) => item.id === unit.id), 'The new unit did not load.');
  desktop.app.activeHandlers.onActivate({ id: unit.id, kind: 'unit', unit }, 'double');
  await waitFor(() => desktop.app.inspectorData?.unitId === unit.id, 'The unit inspector did not load.');
  click(desktop.root.querySelector('[data-action="start-session"]'));
  await waitFor(() => desktop.document.querySelector('[data-form="session"]'), 'The session form did not open.');
  const form = desktop.document.querySelector('[data-form="session"]');
  const modes = form.querySelectorAll('[name="runMode"]');
  assert.equal(modes.find((item) => item.checked).value, 'task');
  click(form.querySelector('[data-action="confirm-form"]'));
  assert.equal(form.querySelector('[data-field-error="prompt"]').textContent, text('en', 'taskRequired'));
  assert.equal(writes.some((item) => item.url.endsWith('/session')), false);
  for (const mode of modes) mode.checked = mode.value === 'chat';
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.app.sessionRequestId && desktop.root.querySelector('[data-action="cancel-start"]'), 'The start did not stay tracked.');
  const started = writes.find((item) => item.url.endsWith('/session'));
  assert.equal(started.body.runMode, 'chat');
  assert.equal(started.body.taskId, null);
  assert.equal(started.body.prompt, null);
  const requestId = desktop.app.sessionRequestId;
  click(desktop.root.querySelector('[data-action="cancel-start"]'));
  await waitFor(() => desktop.app.sessionRequest?.state === 'canceled', 'The canceled start was not acknowledged.');
  assert.equal(desktop.app.sessionRequestId, requestId);
  assert.equal(writes.filter((item) => item.url.endsWith('/session')).length, 1);
});

test('Work keeps Stop apart from authored chat and retains the composer and thread', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, 'The units did not load.');
  const unit = desktop.app.unitList.catalog.find((item) => item.id === 'project:shop:executor-shop');
  desktop.app.activeHandlers.onActivate({ id: unit.id, kind: 'unit', unit }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-action="session-work"]'), 'The session tabs did not open.');
  await waitFor(() => desktop.app.thread?.chat?.kind === 'direct' && desktop.app.thread.chat.members.includes(unit.id), 'The agent chat did not open.');
  const chatId = desktop.app.thread.chat.id;
  assert.equal(desktop.root.querySelector('[data-action="stop-step"]'), null);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Keep this draft', 2, 5);
  click(desktop.root.querySelector('[data-action="session-work"]'));
  await waitFor(() => desktop.root.querySelector('[data-session-work]'), 'Work did not open.');
  assert.ok(desktop.root.querySelector('[data-action="stop-step"]'));
  assert.equal(desktop.root.querySelector('.transcript'), null);
  assert.equal(desktop.app.thread.chat.id, chatId);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep this draft');
  click(desktop.root.querySelector('[data-action="session-chat"]'));
  assert.equal(desktop.app.thread.chat.id, chatId);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep this draft');
});

test('two optimistic sends leave the composer free and preserve text typed while either settles', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  const gates = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
    await new Promise((resolve) => gates.push(resolve));
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  for (const body of ['First draft', 'Second draft']) {
    typeInput(desktop.root.querySelector('[data-composer]'), body, 0, body.length);
    click(desktop.root.querySelector('[data-action="send"]'));
    assert.equal(desktop.root.querySelector('[data-composer]').value, '');
    assert.equal(Boolean(desktop.root.querySelector('[data-action="send"]').disabled), false);
  }
  await waitFor(() => calls.length === 2, 'The independent sends did not start.');
  assert.notEqual(calls[0].key, calls[1].key);
  assert.equal(desktop.root.querySelectorAll('[data-send-state="sending"]').length, 2);
  assert.equal(desktop.app.thread.pendingSends.size, 2);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Third draft', 2, 5);
  gates[1]();
  await waitFor(() => desktop.app.thread.pendingSends.size === 1, 'The second send did not settle.');
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
  gates[0]();
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'The first send did not settle.');
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
  assert.equal(desktop.root.querySelector('[data-composer]').selectionStart, 2);
  const own = desktop.app.thread.messages.filter((message) => calls.some((call) => call.key === message.operationId));
  assert.equal(own.length, 2);
  assert.equal(new Set(own.map((message) => message.id)).size, 2);
  const message = own[0];
  const members = chat.members.filter((id) => id !== 'root:master');
  assert.equal(message.delivery.state, 'stored');
  assert.ok(desktop.root.querySelector('[data-send-state="storedReceipt"]'));
  for (const unitId of members) await fixture.control.acknowledgeChat(chat.id, message.id, unitId);
  await waitFor(() => message.delivery.state === 'delivered', 'The recipient submissions did not update delivery.');
  assert.ok(desktop.root.querySelector('[data-send-state="deliveredReceipt"]').textContent.includes('Delivered'));
  for (const unitId of members) await fixture.control.acknowledgeChat(chat.id, message.id, unitId, { read: true });
  await waitFor(() => message.delivery.state === 'read', 'The recipient reads did not update delivery.');
  desktop.app.language = 'es';
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('[data-send-state="readReceipt"]').textContent.includes('Leído'));
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Third draft');
});

test('an unconfirmed row retries its own payload once while preserving the next composer draft', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  let release;
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: init.body, key: init.headers['Idempotency-Key'] });
    if (calls.length > 1) await new Promise((resolve) => { release = resolve; });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  fixture.control.setFault({ method: 'POST', path: `/api/v1/chats/${chat.id}/messages`, status: 503, code: 'timeout' });
  typeInput(desktop.root.querySelector('[data-composer]'), 'Original message', 0, 16);
  click(desktop.root.querySelector('[data-action="send"]'));
  await waitFor(() => desktop.root.querySelector('[data-send-state="notConfirmed"]'), 'The unconfirmed line did not appear.');
  assert.equal(desktop.root.querySelector('[data-send-state="notConfirmed"]').textContent, 'Not confirmed: the service did not answer in 10 s.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Next draft', 0, 10);
  const retry = desktop.root.querySelector('[data-action="retry-message"]');
  assert.equal(retry.getAttribute('title'), 'Retry sends the same message once; it is never sent twice');
  click(retry);
  click(retry);
  await waitFor(() => calls.length === 2, 'Retry did not start.');
  assert.deepEqual(calls[1], calls[0]);
  release();
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'The retry did not settle.');
  assert.equal(calls.length, 2);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Next draft');
  assert.equal(desktop.app.thread.messages.filter((message) => message.operationId === calls[0].key).length, 1);
});

test('reconnection resumes an uncertain send under its original identity and retains the next draft', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const calls = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method !== 'POST' || !new URL(input).pathname.endsWith('/messages') || !String(input).includes('/chats/')) return;
    calls.push({ body: init.body, key: init.headers['Idempotency-Key'] });
    if (calls.length === 1) throw new Error('Connection lost');
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Resume once', 0, 11);
  click(desktop.root.querySelector('[data-action="send"]'));
  await waitFor(() => desktop.app.api.uncertain.has(calls[0]?.key), 'The uncertain send was not retained.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Unsent draft', 0, 12);
  await fixture.control.emit('stream.ready', { capabilities: desktop.app.store.capabilities, readAt: '2026-10-13T00:00:00.000Z' });
  await waitFor(() => desktop.app.thread.pendingSends.size === 0, 'Reconnection did not reconcile the send.');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Unsent draft');
  assert.equal(desktop.app.thread.chat.id, chat.id);
  assert.equal(desktop.app.api.uncertain.has(calls[0].key), false);
  assert.equal(desktop.app.thread.messages.filter((message) => message.operationId === calls[0].key).length, 1);
});

for (const end of ['Cancel', 'timeout']) test(`ordinary waiting reports elapsed time and ${end} preserves a committed operation and drafts`, async (t) => {
  t.after(() => t.mock.timers.reset());
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, 'The chats did not load.');
  navigate(desktop.app, 'chats');
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-composer]'), 'The composer did not open.');
  typeInput(desktop.root.querySelector('[data-composer]'), 'Unsent text', 0, 11);
  navigate(desktop.app, 'settings');
  await waitFor(() => desktop.root.querySelector('[data-look="high-contrast"]'), 'Settings did not open.');
  const fetchRequest = desktop.app.api.fetch;
  const commits = new Map();
  const requests = [];
  let finish;
  let now = 1000;
  desktop.app.api.now = () => now;
  desktop.app.api.fetch = async (input, init) => {
    if (init.method !== 'PATCH' || !new URL(input).pathname.endsWith('/settings')) return fetchRequest(input, init);
    const key = init.headers['Idempotency-Key'];
    requests.push(key);
    const data = commits.get(key) ?? { settings: { ...desktop.app.store.settings.settings, look: 'high-contrast' }, revision: 'b'.repeat(64) };
    commits.set(key, data);
    const payload = JSON.stringify({ contract: 'hivem1nd-gui-v3', data, meta: { requestId: key, readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    if (requests.length > 1) return new Response(payload, { status: 200 });
    return new Response(new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); }; } }), { status: 200 });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click(desktop.root.querySelector('[data-look="high-contrast"]'));
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  const notice = desktop.root.querySelector('[data-activity="settings"]');
  assert.match(notice.querySelector('strong').textContent, /Taking longer than usual/);
  assert.equal(notice.querySelector('p'), null);
  const region = notice.parent;
  assert.equal(region.getAttribute('data-overlay'), 'true');
  assert.equal(String(region.className).includes('notice-area'), true);
  assert.equal(region.parent.className.includes('shell'), true);
  now += 12000;
  t.mock.timers.tick(12000);
  assert.match(desktop.root.querySelector('[data-activity="settings"]').querySelector('p').textContent, /12 s/);
  assert.ok(desktop.root.querySelector('[data-action="cancel-activity"]'));
  if (end === 'Cancel') click(desktop.root.querySelector('[data-action="cancel-activity"]'));
  else {
    now += 18000;
    t.mock.timers.tick(18000);
  }
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  assert.equal(desktop.app.activity.get('settings').phase, 'error');
  assert.equal(desktop.root.querySelector('[data-action="cancel-activity"]'), null);
  assert.ok(desktop.root.querySelector('[data-action="retry-activity"]'));
  assert.equal(commits.size, 1);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, 'Unsent text');
  if (end === 'Cancel') {
    click(desktop.root.querySelector('[data-action="retry-activity"]'));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    assert.equal(requests.length, 1);
    finish();
  } else click(desktop.root.querySelector('[data-action="retry-activity"]'));
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
  assert.equal(desktop.app.activity.get('settings').phase, 'success');
  assert.equal(commits.size, 1);
  if (end === 'timeout') {
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1]);
  }
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.notice-area \{[^}]*position:\s*absolute/);
  t.mock.timers.reset();
});

async function assertAbsent(root, secret) {
  const entries = await readdir(root, { recursive: true });
  for (const entry of entries) {
    const file = join(root, entry);
    let body = "";
    try {
      body = await readFile(file, "utf8");
    } catch {
      continue;
    }
    assert.equal(body.includes(secret), false, String(entry));
  }
}

function changeSelect(node, value) {
  node.value = value;
  for (const handler of node.listeners.get("change") ?? []) handler({ target: node, currentTarget: node });
}

async function openedDesktop(t, onFetch) {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], onFetch); t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.layout === "desktop", "The desktop shell did not open.");
  return { ...desktop, fixture };
}





test('R9 plan cards use the chat scroll area and the Overseer notice wraps its actions', async () => {
  const { document } = createTestDocument(720);
  const styles = await readFile('gui/app/styles.css', 'utf8');
  const notice = renderContext(document, { session: { id: 'overseer' }, context: { percent: 80, generationId: 'g1', dismissed: false } }, 'en', () => {});
  assert.equal(notice.querySelector('.context-notice').querySelectorAll('button').length, 3);
  assert.match(styles, /\.chat-panel\.has-plans \.transcript \{ max-height: none; overflow: visible; \}/);
  assert.match(styles, /\.context-notice \.action-row \{ display: flex; flex-wrap: wrap;/);
  assert.match(styles, /\.context-notice \.action-row \.btn \{ min-width: 0; flex: 1 1 96px;/);
});

test('R10 Runs in never renders a null model or effort as a label', () => {
  assert.equal(runsInLabel({ client: 'codex', model: null, effort: 'high', mode: null }, [{ id: 'codex', title: 'Codex', models: [] }]), 'Codex, High');
});


test('a repository plan stalls ten minutes after its last confirmed step', async () => {
  const { stallPast } = await import('./visual/cases/start-board.mjs');
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  const at = new Date(now).toISOString();
  assert.equal(stallPast({ phase: 'execution', lastStepAt: at }, now), 601000);
  assert.equal(stallPast({ phase: 'planning', lastStepAt: at }, now), 1801000);
  const source = await readFile(new URL('./visual/cases/start-board.mjs', import.meta.url), 'utf8');
  assert.match(source, /mode: 'execution'/);
  assert.match(source, /data-action="stop-step"/);
});

test('the slow notice keeps Cancel inside the card', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.slow-notice \{[^}]*max-width:\s*100%/);
  assert.match(css, /\.slow-notice \{[^}]*box-sizing:\s*border-box/);
  assert.match(css, /\.slow-notice > div \{[^}]*min-width:\s*0/);
  assert.match(css, /\.slow-notice \.btn \{[^}]*flex:\s*0 0 auto/);
});

test('the cluster inspector keeps the composer and does not stretch Start a plan', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.shell\[data-layout="desktop"\]\[data-mode="map"\] \.inspector \{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.inspector-body > \.chat-panel:not\(\.agent-conversation\) \{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.inspector-body > \.chat-panel:not\(\.agent-conversation\) > \.transcript \{[^}]*overflow:\s*auto/);
  assert.match(css, /\.transcript > \.btn \{[^}]*align-self:\s*start/);
  assert.match(css, /\.transcript > \.btn \{[^}]*height:\s*auto/);
});

test('the Overseer subtitle stacks under the name inside the hierarchy row', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.list \.row-unit \.group-title:has\(\.hierarchy-sub\) \{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.list \.row-unit \.group-title:has\(\.hierarchy-sub\) \.hierarchy-sub \{[^}]*margin-left:\s*0/);
  assert.match(css, /\.list \.row-unit \.group-title:has\(\.hierarchy-sub\) \.unit-name,\s*\n\.list \.row-unit \.group-title:has\(\.hierarchy-sub\) \.hierarchy-sub \{[^}]*text-overflow:\s*ellipsis/);
});

test('R10 look controls and placeholders use themed contrast tokens', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /--focus: 2px solid var\(--accent\)/);
  assert.match(css, /\.look-preview-radio \{ border-color: var\(--ring\) !important;/);
  assert.match(css, /scrollbar-color: var\(--line2\) var\(--panel\)/);
  assert.match(css, /\*::-webkit-scrollbar-button \{[^}]*display:\s*none/);
  assert.match(css, /input::placeholder, textarea::placeholder \{ color: var\(--mute\); opacity: 1;/);
  assert.match(css, /\.settings-panel input\[type="checkbox"\].*appearance: none/);
  assert.match(css, /\[data-look="txmska"\][\s\S]*?--ring: #a855f7/);
});

test('R13 session progress names the failed client and offers Retry only after failure', async t => {
  const desktop = await openedDesktop(t), selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.store.selected.unitId = selected.id;
  desktop.app.sessionRequest = { requestId: 'start-r13', unitId: selected.id, state: 'starting', client: 'claude-code', machine: 'DESKTOP' };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelectorAll('[data-start-step]').length, 3);
  assert.equal(desktop.root.querySelector('[data-action="retry-session"]'), null);
  assert.ok(desktop.root.querySelector('[data-action="cancel-start"]'));
  desktop.app.sessionRequest = { ...desktop.app.sessionRequest, state: 'failed', error: { code: 'launch_failed', step: 'launch' } };
  renderShell(desktop.app);
  const progress = desktop.root.querySelector('[data-session-progress]');
  assert.match(progress.querySelector('[role="alert"]').textContent, /Claude Code could not start at launch/);
  assert.ok(progress.querySelector('[data-action="retry-session"]'));
  assert.equal(progress.querySelector('[data-action="cancel-start"]'), null);
});

test('an empty chat does not offer older messages until a cursor exists', async t => {
  const desktop = await openedDesktop(t);
  const selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.store.selected.unitId = selected.id;
  desktop.app.thread = { chat: { id: 'chat-empty', title: 'Shop', kind: 'direct', members: ['root:master', selected.id], pinned: true, listed: true }, messages: [], total: 0, nearBottom: true };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-action="older"]'), null);
  desktop.app.thread.nextCursor = 'older-1';
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('[data-action="older"]'));
});

test('ask cards scroll with the conversation, after its messages and above the composer, in one scroll area', async t => {
  const desktop = await openedDesktop(t);
  const selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.store.selected.unitId = selected.id;
  desktop.app.inspectorData = { unitId: selected.id, approvals: [{ id: 'approval-ask', state: 'pending', action: 'git.commit', display: 'Commit the cart', alwaysAllowed: true }], tasks: [], sessions: [], grants: [], waiting: [] };
  renderShell(desktop.app);
  const card = desktop.root.querySelector('[data-approval="approval-ask"]');
  assert.ok(card);
  const transcript = desktop.root.querySelector('.transcript');
  let parent = card, inside = false;
  while (parent) {
    if (parent === transcript) inside = true;
    parent = parent.parentNode ?? parent.parent ?? null;
  }
  assert.equal(inside, true, 'the ask card scrolls with the conversation');
  const panel = desktop.root.querySelector('.chat-panel');
  const kids = [...panel.children];
  const field = panel.querySelector('.field');
  if (field) assert.ok(kids.indexOf(transcript) < kids.indexOf(field), 'the conversation, with its asks, sits above the composer');
  assert.equal([...panel.children].some(node => node.classList?.contains?.('action-cards')), false, 'no second scroll area beside the conversation');
});


test('background loads do not announce a slow request', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  if (!desktop.app.activity) desktop.app.activity = new Map();
  desktop.app.activity.set('chat-load:shop', { key: 'chat-load:shop', phase: 'pending', scope: 'unit', label: 'Loading the conversation', elapsed: 0 });
  desktop.app.activity.set('inspector:shop', { key: 'inspector:shop', phase: 'pending', scope: 'unit', label: 'Loading details', elapsed: 0 });
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('.slow-notice'), null);
  assert.equal(desktop.root.querySelector('.notice-area'), null);
  desktop.app.activity.set('older:shop', { key: 'older:shop', phase: 'pending', scope: 'unit', label: 'Loading earlier messages', elapsed: 2 });
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('.slow-notice'));
});

test('a session that never names its step says nothing was started', async t => {
  const desktop = await openedDesktop(t), selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.store.selected.unitId = selected.id;
  desktop.app.sessionRequest = { requestId: 'start-unnamed', unitId: selected.id, state: 'failed', client: 'codex', machine: 'DESKTOP', error: { code: 'launch_failed', step: 'The session is starting.' } };
  renderShell(desktop.app);
  const alert = desktop.root.querySelector('[data-session-progress]').querySelector('[role="alert"]');
  assert.equal(alert.textContent.includes('The session is starting'), false);
  assert.match(alert.textContent, /Codex did not answer in 30 seconds\./);
  assert.match(alert.textContent, /Nothing was started\. It may still be updating; try again, or choose another client\./);
  desktop.app.language = 'es';
  renderShell(desktop.app);
  const spanish = desktop.root.querySelector('[data-session-progress]').querySelector('[role="alert"]').textContent;
  assert.equal(spanish.includes('La sesión está iniciando'), false);
  assert.match(spanish, /Codex no respondió en 30 segundos\./);
  assert.match(spanish, /No se inició nada\./);
});

function accessibilityRules(css) {
  return [...css.replaceAll("\r\n", "\n").matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.trim().split(",").map(value => value.trim()),
    values: Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
  }));
}

function accessibilityPalette(rules, look) {
  return Object.assign({}, ...rules.filter(rule => rule.selectors.includes(":root")).map(rule => rule.values),
    ...rules.filter(rule => rule.selectors.includes(`[data-look="${look}"]`)).map(rule => rule.values));
}

function accessibilityColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return [...value.slice(1).matchAll(/../g)].map(part => parseInt(part[0], 16)).concat(1);
  assert.match(value, /^rgba\([\d.,\s]+\)$/);
  return value.match(/[\d.]+/g).map(Number);
}

function accessibilityComposite(foreground, background) {
  return foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3])).concat(1);
}

function accessibilityLuminance(color) {
  return color.slice(0, 3).map(channel => channel / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function accessibilityRatio(foreground, background) {
  const a = accessibilityLuminance(foreground), b = accessibilityLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function accessibilityMatrix(rules) {
  const rows = [];
  for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    const palette = accessibilityPalette(rules, look);
    const base = ["bg", "panel", "card", "card2", "ground", "me"].map(name => [name, accessibilityColor(palette[`--${name}`])]);
    const surfaces = base.concat(["accent-soft", "waiting-soft", "ring-soft", "error-soft"].flatMap(name =>
      base.filter(([surface]) => ["panel", "card", "card2"].includes(surface))
        .map(([surface, background]) => [`${name}/${surface}`, accessibilityComposite(accessibilityColor(palette[`--${name}`]), background)])));
    surfaces.push(["focus-black", [0, 0, 0, 1]]);
    for (const [surface, background] of surfaces) {
      for (const role of ["mute", "body", "text"]) {
        const raw = surface === "focus-black" && role !== "mute" ? role === "body" ? "#d8d4cc" : "#f1efe9" : palette[`--${role}`];
        const foreground = accessibilityComposite(accessibilityColor(raw), background);
        rows.push({ look, role, surface, raw, background, foreground, ratio: accessibilityRatio(foreground, background) });
      }
    }
  }
  return rows;
}

function accessibilityControlMatrix(rules) {
  const rows = [];
  for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    const palette = accessibilityPalette(rules, look);
    for (const indicator of ["ring", "accent"]) for (const surface of ["panel", "ground"]) {
      const raw = palette[`--${indicator}`], background = accessibilityColor(palette[`--${surface}`]);
      const foreground = accessibilityComposite(accessibilityColor(raw), background);
      rows.push({ look, indicator, surface, raw, background, foreground, ratio: accessibilityRatio(foreground, background) });
    }
  }
  return rows;
}

function accessibilityEvidenceRow(row) {
  const rgb = color => color.slice(0, 3).map(value => value.toFixed(6)).join(", ");
  return `| ${row.look} | ${row.role} | ${row.surface} | ${row.raw} | ${rgb(row.background)} | ${rgb(row.foreground)} | ${row.ratio.toFixed(6)} |`;
}

function accessibilityControlEvidenceRow(row) {
  const rgb = color => color.slice(0, 3).map(value => value.toFixed(6)).join(", ");
  return `| ${row.look} | ${row.indicator} | ${row.surface} | ${row.raw} | ${rgb(row.background)} | ${rgb(row.foreground)} | ${row.ratio.toFixed(6)} |`;
}

test("T062 measures exact six-look text and alpha surfaces and retains its evidence", async () => {
  const css = await readFile(new URL("../gui/app/styles.css", import.meta.url), "utf8");
  const rules = accessibilityRules(css);
  const evidence = await readFile(new URL("./gui-browser.md", import.meta.url), "utf8");
  const rows = accessibilityMatrix(rules);
  assert.equal(rows.length, 342);
  for (const row of rows) {
    assert.ok(row.ratio >= 4.5, `${row.look} ${row.role} ${row.surface}: ${row.ratio}`);
    assert.ok(evidence.includes(accessibilityEvidenceRow(row)), `Missing measured pair: ${row.look} ${row.role} ${row.surface}`);
  }
  const controls = accessibilityControlMatrix(rules);
  assert.equal(controls.length, 24);
  const controlEvidence = await readFile(new URL("./gui-browser.md", import.meta.url), "utf8");
  for (const row of controls) {
    assert.ok(row.ratio >= 3, `${row.look} ${row.indicator}/${row.surface}: ${row.ratio}`);
    assert.ok(controlEvidence.includes(accessibilityControlEvidenceRow(row)), `Missing non-text pair: ${row.look} ${row.indicator}/${row.surface}`);
  }
  for (const selector of [".settings-panel .btn:disabled"]) {
    assert.equal(rules.find(rule => rule.selectors.includes(selector)).values.opacity, "1", selector);
  }
  for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    const own = accessibilityPalette(rules, look);
    for (const parent of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
      const nested = Object.assign({}, accessibilityPalette(rules, parent),
        ...rules.filter(rule => rule.selectors.includes(":where(.look-preview)")).map(rule => rule.values),
        ...rules.filter(rule => rule.selectors.includes(`[data-look="${look}"]`)).map(rule => rule.values));
      for (const token of Object.keys(own).filter(key => key.startsWith("--"))) assert.equal(nested[token], own[token], `${parent}/${look}/${token}`);
    }
  }
});

test("provenance links keep 4.5:1 on their surfaces in every look", async () => {
  const rules = accessibilityRules(await readFile(new URL("../gui/app/styles.css", import.meta.url), "utf8"));
  const value = (selector, property) => rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.values[property]).filter(Boolean).at(-1);
  for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    const palette = accessibilityPalette(rules, look);
    const resolve = raw => accessibilityColor(raw.replace(/^var\((--[\w-]+)\)$/, (_, name) => palette[name]));
    for (const [selector, surface] of [[".add-content-row .add-origin", ".add-content-row"]]) {
      const background = resolve(value(surface, "background"));
      const foreground = accessibilityComposite(resolve(value(`[data-look="${look}"] ${selector}`, "color") ?? value(selector, "color")), background);
      const ratio = accessibilityRatio(foreground, background);
      assert.ok(ratio >= 4.5, `${look} ${selector}: ${ratio.toFixed(2)}`);
    }
  }
});

test("Settings fits the look previews to the width its section has", async () => {
  const rules = accessibilityRules(await readFile(new URL("../gui/app/styles.css", import.meta.url), "utf8"));
  const looks = rules.find(rule => rule.selectors.includes(".settings-looks")).values;
  // At 1280 px two Settings columns leave about 470 px inside a section; three 166 px previews need 522 px.
  assert.equal(looks["grid-template-columns"], "repeat(auto-fill, 166px)");
  assert.equal(looks["max-width"], `${3 * 166 + 2 * parseFloat(looks.gap)}px`);
});

test("T062 retains local faces, minimum hit geometry, zoom reflow and status shapes", async () => {
  const css = await readFile(new URL("../gui/app/styles.css", import.meta.url), "utf8");
  const rules = accessibilityRules(css);
  const declaration = selector => Object.assign({}, ...rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.values));
  assert.equal(declaration("button")["min-inline-size"], "32px");
  assert.equal(declaration("button")["min-block-size"], "32px");
  for (const selector of ["a[href]", "summary", "textarea", '[contenteditable="true"]']) {
    assert.equal(declaration(selector)["min-inline-size"], "32px");
    assert.equal(declaration(selector)["min-block-size"], "32px");
  }
  for (const [selector, width, height] of [[".icon-button", 36, 36], [".map-handle", 44, 44], [".phone-code-cell", 40, 50]]) {
    assert.equal(parseFloat(declaration(selector).width), width, selector);
    assert.equal(parseFloat(declaration(selector).height), height, selector);
    assert.ok(width >= 32 && height >= 32, selector);
  }
  for (const selector of [".segmented .segment", ".settings-content-item", ".settings-change label"]) {
    assert.equal(declaration(selector)["min-height"], "32px", selector);
  }
  assert.equal(declaration(".phone-code-input").height, "100%");
  assert.equal(declaration(".phone-gate")["overflow-y"], "auto");
  assert.match(css, /\.settings-looks\s*\{\s*grid-template-columns:\s*repeat\(auto-fit, minmax\(166px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*grid-template-columns: repeat\(3, 40px\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.equal(declaration(":root")["--qr-dark"], "#000000");
  assert.equal(declaration(":root")["--qr-light"], "#ffffff");
  assert.match(declaration('.status-dot[data-status="waiting"]')["box-shadow"], /2px/);
  assert.match(declaration(".status-dot")["box-shadow"], /1\.5px/);
  assert.equal(declaration('.status-dot[data-status="working"]')["box-shadow"], "none");
  for (const sheet of [css, await readFile(new URL("../gui/styles.css", import.meta.url), "utf8")]) {
    const faces = [...sheet.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => body);
    assert.equal(faces.length, 4);
    for (const [weight, style, filename] of [[400, "normal", "atkinson-400.woff2"], [400, "italic", "atkinson-400-italic.woff2"],
      [700, "normal", "atkinson-700.woff2"], [700, "italic", "atkinson-700-italic.woff2"]]) {
      const face = faces.find(body => body.includes(`url("./${filename}")`));
      assert.ok(face);
      assert.ok(face.includes(`font-weight: ${weight}`) && face.includes(`font-style: ${style}`));
      assert.ok(face.includes('font-family: "Atkinson Hyperlegible"') && face.includes("font-display: swap"));
    }
  }
});

test("T062 keeps keyboard control identity, skips to the workspace and announces each outcome once", async t => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, "The desktop did not load.");
  const { app, root, document } = desktop;
  for (const language of ["en", "es"]) for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    app.language = language; app.look = look; renderShell(app);
    click(root.querySelector("a.skip"));
    assert.equal(document.activeElement, root.querySelector("[id='workspace']"));
    assert.equal(document.activeElement.getAttribute("tabindex"), "-1");
    const mode = root.querySelector("[data-action='mode-map']"); mode.focus();
    renderShell(app);
    assert.equal(document.activeElement, root.querySelector("[data-action='mode-map']"));
    const tab = root.querySelector("[data-action='tab-chats']"); tab.focus(); click(tab);
    assert.equal(document.activeElement, root.querySelector("[data-action='tab-chats']"));
    for (const button of root.querySelectorAll("button")) {
      const copy = node => node.getAttribute?.("aria-hidden") === "true" ? "" : `${node.textContent ?? ""} ${(node.children ?? []).map(copy).join(" ")}`;
      assert.ok((button.getAttribute("aria-label") || copy(button)).trim(), "An icon control has no accessible name.");
    }
    assert.equal(root.querySelectorAll("h1").length, 1);
  }
  const status = document.querySelector("[data-live='status']");
  let value = status.textContent, writes = 0;
  Object.defineProperty(status, "textContent", { configurable: true, get: () => value, set: next => { writes++; value = next; } });
  app.actionNote = "A measured action completed."; app.actionTone = "status"; app.actionScope = "unit";
  renderShell(app);
  assert.equal(writes, 1);
  assert.equal(status.getAttribute("aria-atomic"), "true");
  for (let index = 0; index < 10; index++) renderShell(app);
  assert.equal(writes, 1);
  app.actionNote = "A second action completed."; renderShell(app);
  assert.equal(writes, 2);
  app.actionNote = null; renderShell(app);
  assert.equal(status.textContent, "");
  const pending = { phase: "pending", key: "measured-action", label: "Measuring", scope: "unit", elapsed: 3 };
  app.activity ??= new Map();
  app.activity.set(pending.key, pending); renderShell(app);
  const pendingCopy = status.textContent, pendingWrites = writes;
  assert.ok(pendingCopy.includes("3 s"));
  pending.elapsed = 4; renderShell(app);
  assert.equal(writes, pendingWrites);
  assert.equal(status.textContent, pendingCopy);
  app.activity.delete(pending.key);
  app.actionNote = "A second action completed."; renderShell(app);
  assert.equal(writes, pendingWrites + 1);
  assert.equal(status.textContent, app.actionNote);
});

test("T062 dialogs wrap enabled visible controls, close on Escape and restore a replaced invoker", async () => {
  const { element, showDialog, announce } = await import("../gui/app/components.mjs");
  const { document, root } = createTestDocument();
  const invoker = element(document, "button", { "data-action": "open-dialog", text: "Open" });
  root.append(invoker); invoker.focus();
  const dialog = showDialog(document, { title: "Measured dialog", body: "Retained copy", cancel: "Cancel", confirm: "Confirm", onConfirm() {} });
  const hidden = element(document, "div", { hidden: "" }, element(document, "input", {}));
  const closed = element(document, "details", {}, element(document, "summary", { text: "Details" }), element(document, "input", {}));
  dialog.append(hidden, closed);
  const buttons = dialog.querySelectorAll("button");
  const key = (key, shiftKey = false) => { let prevented = false; for (const listener of dialog.listeners.get("keydown") ?? []) listener({ key, shiftKey, preventDefault() { prevented = true; } }); return prevented; };
  buttons[0].focus(); assert.equal(key("Tab", true), true);
  assert.equal(document.activeElement, closed.querySelector("summary"));
  assert.equal(key("Tab"), true); assert.equal(document.activeElement, buttons[0]);
  buttons[1].disabled = true;
  const replacement = element(document, "button", { "data-action": "open-dialog", text: "Open" });
  root.replaceChildren(replacement);
  assert.equal(key("Escape"), true);
  assert.equal(document.activeElement, replacement);
  announce(root, "Changed once");
  const region = root.querySelector("[data-announce]");
  let value = region.textContent, writes = 0;
  Object.defineProperty(region, "textContent", { get: () => value, set: next => { value = next; writes++; } });
  announce(root, "Changed once"); assert.equal(writes, 0);
  announce(root, "Changed again"); assert.equal(writes, 1);
});

test("T062 Settings focus survives report redraws and a disabled preview cannot choose a look", async t => {
  const { app, root, document } = await settingsApp(t);
  const startup = root.querySelector("[data-start-with-windows]"); startup.focus();
  renderShell(app);
  assert.equal(document.activeElement, root.querySelector("[data-start-with-windows]"));
  root.querySelector("[data-language='es']").focus(); renderShell(app);
  assert.equal(document.activeElement, root.querySelector("[data-language='es']"));
  click(root.querySelector("[data-action='settings-machine']"));
  const menu = root.querySelector(".settings-machine-menu");
  for (const listener of menu.listeners.get("keydown") ?? []) listener({ key: "End", preventDefault() {} });
  assert.equal(document.activeElement, menu.querySelectorAll("button").at(-1));
  for (const listener of menu.listeners.get("keydown") ?? []) listener({ key: "Escape", preventDefault() {} });
  assert.equal(document.activeElement, root.querySelector("[data-action='settings-machine']"));
  const { renderLookPreview } = await import("../gui/app/settings.mjs");
  let chosen = 0;
  const button = renderLookPreview(document, { id: "coffee-cat", label: "Toxic" }, false, () => { chosen++; });
  button.disabled = true;
  click(button.querySelector(".look-preview"));
  assert.equal(chosen, 0);
});

test("T062 phone navigation retains focus after redraw and six code cells use one tab stop", async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const phone = await bootApp(fixture.phoneUrl, 390, []); t.after(() => dispose(phone.app));
  await waitFor(() => phone.root.querySelector(".phone-nav"), "The phone did not load.");
  const button = phone.root.querySelector("[data-phone-mode='waiting']"); button.focus(); click(button);
  assert.equal(phone.document.activeElement, phone.root.querySelector("[data-phone-mode='waiting']"));
  const form = renderCodeEntry(phone.document, key => text("en", key), () => {});
  assert.equal(form.querySelectorAll("input").length, 1);
  assert.equal(form.querySelectorAll("[data-code-cell]").length, 6);
  assert.equal(form.querySelectorAll("[tabindex]").length, 0);
});

test('T091 Enter submits the cluster choice and Escape restores its replaced invoker', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  const opener = desktop.root.querySelector("[data-action='new-cluster']"); opener.focus(); click(opener);
  const dialog = desktop.document.querySelector("[data-start-dialog='cluster']"), create = dialog.querySelector("[data-action='create-cluster']");
  create.click = () => click(create);
  let prevented = false;
  for (const handler of dialog.listeners.get('keydown') ?? []) handler({ key: 'Enter', target: dialog.querySelector("[name='title']"), preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await waitFor(() => dialog.querySelector('[data-start-error]'), 'The required cluster name was not checked.');
  renderShell(desktop.app);
  for (const handler of dialog.listeners.get('keydown') ?? []) handler({ key: 'Escape', preventDefault() {} });
  assert.equal(desktop.document.activeElement, desktop.root.querySelector("[data-action='new-cluster']"));
});

test("T062 pairing has one heading and a skip destination and restores the code field on rejection", async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const phone = await bootApp(new URL(fixture.phoneUrl).origin, 390, []); t.after(() => dispose(phone.app));
  assert.equal(phone.root.querySelectorAll("h1").length, 1);
  click(phone.root.querySelector("a.skip"));
  assert.equal(phone.document.activeElement, phone.root.querySelector("[id='phone-gate-workspace']"));
  typeInput(phone.root.querySelector("[data-home-code]"), "000000", 6, 6);
  for (const handler of phone.root.querySelector("[data-code-entry]").listeners.get("submit") ?? []) handler({ preventDefault() {} });
  await waitFor(() => phone.root.querySelector("[data-tries-left]"), "Pairing did not reject the code.");
  assert.equal(phone.document.activeElement, phone.root.querySelector("[data-home-code]"));
  assert.equal(phone.root.querySelector("[id='phone-code-error']").getAttribute("role"), "alert");
  assert.equal(phone.root.querySelectorAll("h1").length, 1);
});

test('T094 shared Add retains its dialog, check, selection and focus across shell and Content entry points', async t => {
  const { app, root, document } = await settingsApp(t);
  for (const language of ['en', 'es']) for (const look of ['modern', 'high-contrast', 'nebula', 'txmska', 'coffee-cat', 'ntk']) {
    app.language = language; app.look = look; renderShell(app);
    const add = root.querySelector('[data-action="add-to-mind"]'); add.focus(); click(add);
    const dialog = document.querySelector('.add-dialog'); assert.ok(dialog);
    const bar = root.querySelector('.bar');
    assert.ok(bar.children.indexOf(add) < bar.children.indexOf(root.querySelector('[data-action="waiting"]')));
    click(root.querySelector('[data-action="add-to-mind"]'));
    assert.equal(document.querySelectorAll('.add-dialog').length, 1);
    click(dialog.querySelector('[data-action="add-cancel"]'));
    assert.equal(document.activeElement, root.querySelector('[data-action="add-to-mind"]'));
  }
  click(root.querySelector('[data-action="settings-tab-content"]'));
  const contentAdd = root.querySelector('[data-action="add-content"]'); contentAdd.focus(); click(contentAdd);
  const originalMode = app.mode, originalTab = app.settingsState.tab;
  const dialog = document.querySelector('.add-dialog'), input = dialog.querySelector('[id="add-link"]');
  const replace = dialog.replaceChildren.bind(dialog);
  dialog.replaceChildren = (...nodes) => { if (dialog.contains(document.activeElement)) document.activeElement = document.body; replace(...nodes); };
  typeInput(input, 'https://github.com/acme/example', 10, 18);
  for (const handler of input.listeners.get('keydown') ?? []) handler({ key: 'Enter', preventDefault() {} });
  await waitFor(() => app.addController.model.preview?.state === 'ready', 'The Add preview did not load.');
  assert.equal(document.activeElement, dialog.querySelector('[id="add-link"]'));
  assert.equal(document.activeElement.selectionStart, 10); assert.equal(document.activeElement.selectionEnd, 18);
  const candidate = app.addController.model.preview.candidates.find(item => item.kind === 'skill');
  changeControl(dialog.querySelector(`[data-candidate-id="${candidate.id}"]`).querySelector('input'), true);
  click(dialog.querySelector('[data-action="add-continue"]'));
  await waitFor(() => dialog.getAttribute('data-add-stage') === 'check', 'The Add check did not open.');
  assert.equal(app.mode, originalMode); assert.equal(app.settingsState.tab, originalTab);
  const beforeDraft = { value: 'Keep this document draft' }; app.store.drafts.set('retained-document', beforeDraft);
  click(dialog.querySelector('[data-action="add-back"]')); click(dialog.querySelector('[data-action="add-cancel"]'));
  click(root.querySelector('[data-action="add-to-mind"]'));
  await waitFor(() => !app.addController.model.busy, 'The retained preview was not reconciled.');
  assert.deepEqual(app.addController.model.selected, [candidate.id]);
  assert.equal(app.store.drafts.get('retained-document'), beforeDraft);
  assert.equal(app.addController.model.link, 'https://github.com/acme/example');
  click(document.querySelector('.add-dialog').querySelector('[data-action="add-cancel"]'));
});

test('T094 actual-core Add selects one repository cluster, creates only an explicitly chosen agent and manages Content and links', async t => {
  const desktop = await startCoreDesktop(t), { app, root, document, core, fixture, launches } = desktop;
  await waitFor(() => app.bootSettled && app.startProjects, 'The actual core did not open.');
  app.startDialog?.dialog.close();
  const chunks = [];
  for (const [relative, content] of [['LICENSE', 'MIT License\n'], ['NOTICE', 'Keep this notice\n'], ['package.json', '{"name":"landing-site","license":"MIT"}'], ['skills/pdf/SKILL.md', '---\nname: pdf\nruntime: none\n---\nPDF skill\n'], ['docs/guide.md', '# Guide\n']]) {
    const data = Buffer.from(content), header = Buffer.alloc(512);
    header.write(`package/${relative}`, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  const archive = gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)])), owner = core.runtime.settingsOwner;
  let pin = 'a'.repeat(40);
  owner.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  owner.additionTransport = async url => ({ status: 200, bytes: url.pathname.includes('/commits/')
    ? Buffer.from(JSON.stringify({ sha: pin, commit: { committer: { date: '2026-10-01T00:00:00.000Z' } } })) : archive });
  owner.additionRunner = async (_command, _args, _options, input) => Buffer.from(createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') + '\n');
  const waitForAddition = (check, label) => waitFor(check, label).catch(error => {
    const model = app.addController?.model;
    error.message += ` (errorCode=${model?.errorCode ?? 'none'}, stage=${model?.stage ?? 'none'}, busy=${model?.busy ?? 'none'})`;
    throw error;
  });
  const inspect = async () => {
    click(root.querySelector('[data-action="add-to-mind"]'));
    // Reopening can revalidate the retained preview before another inspection is accepted.
    await waitForAddition(() => {
      const input = document.querySelector('[id="add-link"]');
      return input && !input.disabled && input.getAttribute('disabled') === null
        && !app.addController.model.busy && !app.addController.state.operation;
    }, 'The actual source input did not become ready.');
    const previousPreviewId = app.addController.model.preview?.id;
    const input = document.querySelector('[id="add-link"]'); typeInput(input, 'https://github.com/acme/landing-site', 0, 0);
    for (const handler of input.listeners.get('keydown') ?? []) handler({ key: 'Enter', preventDefault() {} });
    await waitForAddition(() => !app.addController.model.busy && app.addController.model.preview?.id !== previousPreviewId
      && app.addController.model.preview?.state === 'ready', 'The actual source check did not finish.');
  };
  const choose = kind => {
    const candidate = app.addController.model.preview.candidates.find(item => item.kind === kind);
    changeControl(document.querySelector(`[data-candidate-id="${candidate.id}"]`).querySelector('input'), true);
  };
  const check = async () => { await clickAndWait(document.querySelector('[data-action="add-continue"]')); await waitForAddition(() => !app.addController.model.busy && app.addController.model.stage === 'check', 'The immutable check did not open.'); };
  await inspect(); choose('repository'); await check(); await clickAndWait(document.querySelector('[data-action="add-confirm"]'));
  await waitFor(() => app.store.selected.groupId && !document.querySelector('.add-dialog'), 'The accepted repository was not selected.').catch(() => {
    throw new Error(`Repository acceptance: ${app.addController.model.errorCode ?? app.addController.model.preview?.state}, reports: ${app.startError?.code ?? 'ready'}`);
  });
  const clusterId = app.store.selected.groupId, cluster = app.store.indexes.groups.get(clusterId);
  assert.equal(cluster.link.projectId, 'landing-site'); assert.deepEqual(cluster.members, []); assert.equal(launches.length, 0);
  assert.equal(app.store.indexes.groups.size, 1); assert.equal(app.unitList.catalog.length, 0);
  await waitFor(() => root.querySelector('[data-cluster-origin]'), 'Repository provenance was not displayed.');
  assert.match(root.querySelector('[data-cluster-origin]').querySelector('p').textContent, /aaaaaaa/);
  click(root.querySelector('[data-action="new-agent"]'));
  const agentDialog = document.querySelector('[data-start-dialog="agent"]'); assert.ok(agentDialog);
  assert.equal(agentDialog.querySelector('[data-action="choose-executor"]').getAttribute('aria-pressed'), 'true');
  assert.equal(agentDialog.querySelectorAll('[data-action="choose-overlord"]').length, 1);
  await clickAndWait(agentDialog.querySelector('[data-action="create-agent"]'));
  await waitFor(() => !app.startDialog && app.unitList.catalog.length === 1, 'The explicit first agent was not created.');
  assert.equal(launches.length, 0);
  const draft = { value: 'Retain editor work' }; app.store.drafts.set('document-draft', draft);
  await inspect(); choose('skill'); choose('docs'); await check();
  const { scopeAddition } = await import('../gui/app/add-controller.mjs');
  for (const id of app.addController.model.selected) scopeAddition(app.addController, id, 'group', clusterId, true);
  await clickAndWait(document.querySelector('[data-action="add-confirm"]'));
  await waitForAddition(() => app.store.additions.report?.items.length === 3 && !document.querySelector('.add-dialog'), 'Content was not accepted.');
  navigate(app, 'settings'); await app.settingsState.pending; await waitFor(() => app.settingsState?.loaded && !app.settingsState.loading, 'Content reports did not load.');
  click(root.querySelector('[data-action="settings-tab-content"]'));
  await waitFor(() => root.querySelectorAll('[data-addition-id]').length === 2, 'Imported Content was not placed beside kit items.');
  const pdf = app.settingsState.content.features.find(item => item.title === 'pdf');
  assert.equal(pdf.unitCount, 1); assert.equal(pdf.included, true);
  typeInput(root.querySelector('[data-preference-instructions]'), 'Retain these preferences', 3, 8);
  pin = 'b'.repeat(40);
  await clickAndWait(root.querySelector(`[data-addition-id="${pdf.additionId}"]`).querySelector('.add-origin'));
  await waitFor(() => app.addController.model.preview?.state === 'ready', 'Origin did not check for updates.');
  assert.equal(app.addController.model.preview.pin.value, pin);
  assert.equal(app.settingsState.content.features.find(item => item.title === 'pdf').pin.value, 'a'.repeat(40));
  await clickAndWait(document.querySelector('[data-action="add-continue"]')); await waitFor(() => app.addController.model.stage === 'check', 'The update check did not open.');
  await clickAndWait(document.querySelector('[data-action="add-confirm"]'));
  await waitFor(() => app.settingsState.content.features.find(item => item.title === 'pdf')?.pin.value === pin, 'The explicit update did not replace the pin.');
  assert.equal(app.settingsState.contentDraft.preferences.additionalInstructions, 'Retain these preferences');
  assert.equal(app.settingsState.contentDraft.features.find(item => item.title === 'pdf').pin.value, pin);
  assert.equal(await readFile(join(fixture.paths.mind, 'user/features/pdf/NOTICE'), 'utf8'), 'Keep this notice\n');
  click(root.querySelector(`[data-addition-id="${pdf.additionId}"]`).querySelector('[data-action="remove-addition"]'));
  await clickAndWait(document.querySelector('.dialog').querySelector('.primary'));
  await waitFor(() => !document.querySelector('.dialog') && !app.settingsState.content.features.some(item => item.title === 'pdf'), 'The confirmed Remove did not remove Content.');
  await clickAndWait(root.querySelector('[data-action="map-undo"]'));
  await waitFor(() => app.settingsState.content.features.some(item => item.title === 'pdf'), 'Content Undo did not restore it.');
  assert.equal(app.store.drafts.get('document-draft'), draft);
  click(root.querySelector('[data-action="settings-tab-projects"]'));
  assert.ok(root.querySelector(`[data-cluster-link="${clusterId}"]`));
  // Unlink lives in the row's menu and leads to the same confirmation as before.
  click(root.querySelector(`[data-cluster-link="${clusterId}"]`).querySelector('[data-action="settings-link-more"]'));
  click(document.querySelector('[data-action="context-unlink"]'));
  await clickAndWait(document.querySelector('.dialog').querySelector('.primary'));
  await waitFor(() => !document.querySelector('.dialog') && app.store.indexes.groups.get(clusterId)?.link.kind === 'none', 'The canonical link did not detach.');
  assert.equal(app.store.indexes.groups.get(clusterId).members.length, 1); assert.equal(launches.length, 0);
  await clickAndWait(root.querySelector('[data-action="map-undo"]'));
  await waitFor(() => app.store.indexes.groups.get(clusterId)?.link.kind === 'repository', 'Link Undo did not restore its identity.');
});

test('T093 actual-core lead chat mounts its plan, Work milestones, retained draft, warning and one Waiting pointer', async t => {
  const state = await makePlanFixture(t);
  state.context.ledger = openLedger({ store: state.store, paths: state.context.paths, now: state.context.now, machine: state.machine });
  await postChat(state.context, state.cluster.chatId, { body: 'Build the requested cart.' });
  state.input.expectedChatRevision = (await import('../engine/service/projection.mjs').then(module => module.readDetail(state.context, 'chats', state.cluster.chatId))).revision;
  const plan = await createPlan(state.context, state.input);
  const credentials = createCredentialStore({ now: state.context.now });
  state.context.settingsOwner = createSettingsOwner({ ...state.context, probeAgents: async () => ({}) });
  const server = await createHttpServer({ ...state.context, credentials }); state.context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, fetch, { clock: state.context.now });
  t.after(async () => { dispose(desktop.app); await server.close(); });
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.activeHandlers, 'The actual core tree did not load.').catch(() => { throw new Error(`Core boot: ${desktop.app.bootError?.code ?? desktop.app.store.failure?.code ?? desktop.app.layout}`); });
  desktop.app.startDialog?.dialog.close();
  desktop.app.activeHandlers.onActivate({ kind: 'cluster', groupId: state.cluster.id }, 'single');
  await waitFor(() => desktop.root.querySelector('.plan-card'), 'The plan did not attach to the lead chat.');
  assert.ok(desktop.root.querySelector('[data-action="run-plan"]'));
  assert.ok(desktop.root.querySelector('[data-action="edit-assignment"]'));
  const started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  await refreshPlan(desktop.app.planController, plan.id, started.runId);
  let run = await readRun(state.context, started.runId);
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: run.attempts[0].sessionId } };
  await callPlanTool(actor, 'plan_step', { runId: run.id, attemptId: run.attempts[0].id, eventId: 'read-board', step: 'plan', state: 'started', requestId: crypto.randomUUID() });
  await loadSnapshot(desktop.app.store, desktop.app.api);
  const unit = desktop.app.store.indexes.units.get(state.units[0].id);
  desktop.app.activeHandlers.onActivate({ kind: 'unit', id: unit.id, unit }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-action="session-work"]'), 'The actual session tabs did not open.');
  await waitFor(() => desktop.app.thread?.chat?.kind === 'direct' && desktop.app.thread.chat.members.includes(unit.id), 'The agent chat did not open.');
  assert.ok(desktop.root.querySelector('[data-started-with]'));
  assert.equal(desktop.root.querySelector('[data-started-with]').getAttribute('open'), null);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Keep the illustration', 2, 8);
  const messageIds = desktop.app.thread.messages.map(message => message.id);
  click(desktop.root.querySelector('[data-action="session-work"]'));
  await waitFor(() => desktop.root.querySelector('[data-work-sequence]'), 'Verified Work milestones were not loaded.');
  const beforeSteps = desktop.root.querySelectorAll('[data-work-sequence]').length;
  await callPlanTool(actor, 'plan_step', { runId: run.id, attemptId: run.attempts[0].id, eventId: 'edit-files', step: 'edit', state: 'started', requestId: crypto.randomUUID() });
  await waitFor(() => desktop.root.querySelectorAll('[data-work-sequence]').length > beforeSteps, 'The live Work cursor did not advance after a verified event.');
  assert.equal(desktop.root.querySelector('.transcript'), null);
  assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep the illustration');
  click(desktop.root.querySelector('[data-action="session-chat"]'));
  assert.deepEqual(desktop.app.thread.messages.map(message => message.id), messageIds);
  assert.equal(desktop.root.querySelector('[data-action="mailbox"]'), null);
  state.clock.now += 30 * 60000;
  state.context.runDelivery = async () => ({ state: 'submitted' });
  await checkRuns(state.context);
  await refreshPlan(desktop.app.planController, plan.id, run.id);
  await loadSnapshot(desktop.app.store, desktop.app.api);
  const waiting = desktop.app.store.view.waiting.filter(item => item.runId === run.id);
  assert.equal(waiting.length, 1); assert.equal(waiting[0].actions[0], 'stop_step');
  desktop.app.activeHandlers.onActivate({ kind: 'cluster', groupId: state.cluster.id }, 'single');
  await waitFor(() => desktop.root.querySelector('[data-action="retry-task"]'), 'The actual planning stall did not reach the card.');
  const problem = desktop.root.querySelector('.plan-problem').textContent;
  assert.match(problem, /30 minutes/);
  assert.ok(desktop.root.querySelector('[data-action="stop-step"]'));
  run = await readRun(state.context, run.id);
  assert.equal(run.state, 'open');
});

test('T093 actual-core Overseer context uses live telemetry and Compact, Clear and Close preserve messages and drafts', async t => {
  const fixture = await makeCoreFixture(); t.after(() => disposeCoreFixture(fixture));
  const now = () => fixture.clock.now, unitId = 'root:overseer', meter = { used: 180, capacity: 1000, unit: 'tokens' };
  const context = { ...fixture, now, principal: { audience: 'desktop', unitId: 'root:master' }, ownedPids: new Set([5151]), adapters: {} };
  await mkdir(join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(join(fixture.paths.mind, 'user', 'state', 'overseer.md'), 'unit: overseer\nunit-id: root:overseer\nrole: overseer\nstate: in\nmachine: DESKTOP\nfresh: true\n\nReady.\n');
  await writeFile(join(fixture.paths.mind, 'rules.md'), 'Current M1ND rules.');
  context.adapters.codex = { client: 'codex', capabilities: { create: true, stop: true }, confirm: async () => true,
    readContext: async () => meter, contextBusy: async () => false, checkpointContext: async () => ({ messages: [{ role: 'user', content: 'Decision' }] }),
    summarizeContext: async () => 'Keep the decision.', prepareContext: async () => ({ acknowledged: true }), commitContext: async () => { meter.used = 20; return true; } };
  const session = await registerNative(context, { client: 'codex', unitId, nativeSessionId: 'fixture-context', launchKind: 'cli', runMode: 'chat' });
  const journal = join(fixture.paths.localDirectory, 'session-starts', 'owned.json'); await mkdir(dirname(journal), { recursive: true });
  await writeFile(journal, JSON.stringify({ requestId: crypto.randomUUID(), sessionId: session.sessionId, unitId, client: 'codex', pid: 5151, phase: 'registered', createAttempted: true }));
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now, machine: fixture.machine });
  const { chat } = await createChat(context, { members: [unitId] }); await postChat(context, chat.id, { body: 'Keep authored history.' });
  await createContext(context, session, context.adapters.codex);
  context.settingsOwner = createSettingsOwner({ ...context, probeAgents: async () => ({}) });
  const credentials = createCredentialStore({ now }), server = await createHttpServer({ ...context, credentials }); context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, fetch, { clock: now });
  t.after(async () => { dispose(desktop.app); await server.close(); });
  await waitFor(() => desktop.app.unitList?.catalog?.length, 'The actual Overseer did not load.').catch(() => { throw new Error(`Context boot: ${desktop.app.bootError?.code ?? desktop.app.store.failure?.code ?? desktop.app.layout}`); });
  const unit = desktop.app.unitList.catalog.find(unit => unit.id === unitId);
  desktop.app.activeHandlers.onActivate({ kind: 'unit', id: unitId, unit }, 'double');
  await waitFor(() => desktop.root.querySelector('[role="meter"]')?.getAttribute('aria-valuenow') === '18', 'The actual context telemetry did not load.');
  assert.equal(desktop.root.querySelector('[data-context-notice]'), null);
  typeInput(desktop.root.querySelector('[data-composer]'), 'Keep next draft', 3, 7);
  const view = desktop.app.store.sessionViews.get(session.sessionId), generation = view.context.generationId;
  meter.used = 820; await readContext(context, session.sessionId);
  await waitFor(() => desktop.root.querySelector('[data-context-notice]'), 'The 80 percent notice did not open.');
  click(desktop.root.querySelector('[data-action="context-dismiss"]'));
  await waitFor(() => view.context.dismissed && !view.pending && view.context.operation?.state === 'applied', 'Close did not dismiss the current generation.');
  assert.equal(view.context.generationId, generation);
  for (const action of ['compact', 'clear']) {
    const before = view.context.generationId;
    await import('../gui/app/session-work.mjs').then(module => module.changeContext(desktop.app.api, view, action, () => renderShell(desktop.app)));
    await fixture.store.contextJobs?.get(session.sessionId);
    await waitFor(() => view.context.generationId !== before, 'The actual context generation did not reconcile.');
    assert.equal(desktop.root.querySelector('[data-composer]').value, 'Keep next draft');
    assert.equal(desktop.app.thread.messages.some(message => message.body === 'Keep authored history.'), true);
  }
});

async function startEmptyClusterDesktop(t, { texts = [] } = {}) {
  const state = await makePlanFixture(t, { task: false });
  state.context.ledger = openLedger({ store: state.store, paths: state.context.paths, now: state.context.now, machine: state.machine });
  const localPath = join(state.paths.localDirectory, 'shop'); await mkdir(localPath, { recursive: true });
  state.context.projects = [{ name: 'shop', localPath }];
  for (const [file, document] of texts) await createText(state.context, { project: 'shop', path: file, document });
  const credentials = createCredentialStore({ now: state.context.now });
  state.context.settingsOwner = createSettingsOwner({ ...state.context, probeAgents: async () => ({}) });
  const server = await createHttpServer({ ...state.context, credentials }); state.context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const calls = [];
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, (input, init) => {
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : null });
    return fetch(input, init);
  }, { clock: state.context.now });
  // The project watchers must stop before the fixture folder is removed, so the test closes them itself and the hook only covers a failure.
  let closed = false;
  const close = async () => { if (closed) return; closed = true; dispose(desktop.app); await server.close(); };
  t.after(close);
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.activeHandlers, 'The actual core tree did not load.');
  desktop.app.startDialog?.dialog.close();
  desktop.app.activeHandlers.onActivate({ kind: 'cluster', groupId: state.cluster.id }, 'single');
  await waitFor(() => desktop.root.querySelector('[data-action="start-plan"]'), 'The cluster chat did not open.');
  click(desktop.root.querySelector('[data-action="start-plan"]'));
  await waitFor(() => desktop.root.querySelector('[data-plan-draft]'), 'The empty plan draft did not open.');
  return { ...desktop, state, calls, close };
}
const draftRows = root => [...root.querySelectorAll('[data-edit-task]')];
const rowTitle = row => row.querySelector('input');

test('a cluster without any task opens an empty draft whose added rows become the new tasks of the plan, then Run confirms them', async t => {
  const { root, app, document, state, calls, close } = await startEmptyClusterDesktop(t);
  const save = () => root.querySelector('[data-action="save-plan"]');
  assert.ok(root.querySelector('[data-plan-empty]')); assert.equal(root.querySelector('[data-plan-empty]').textContent, 'No tasks yet: write the first one, or take them from a Void text.');
  assert.equal(draftRows(root).length, 1); assert.equal(save().disabled, true);
  assert.ok(root.querySelector('[data-action="plan-from-void"]')); assert.equal(root.querySelector('[data-action="remove-plan-task"]'), null);
  assert.equal(draftRows(root)[0].querySelector('select').value, state.units[0].id);
  typeInput(rowTitle(draftRows(root)[0]), 'Build the cart', 14, 14);
  click(root.querySelector('[data-action="add-plan-task"]'));
  await waitFor(() => draftRows(root).length === 2, 'The added row did not appear.');
  assert.equal(rowTitle(draftRows(root)[0]).value, 'Build the cart'); assert.equal(save().disabled, true);
  typeInput(rowTitle(draftRows(root)[1]), 'Test the cart', 13, 13);
  assert.equal(save().disabled, false);
  assert.equal(root.querySelectorAll('[data-action="remove-plan-task"]').length, 2);
  click(save());
  await waitFor(() => !app.planDraft && root.querySelector('[data-action="run-plan"]'), 'The saved plan card did not appear.');
  const created = calls.find(call => call.method === 'POST' && call.path === '/api/v1/plans');
  assert.deepEqual(created.body.tasks.map(task => Object.keys(task).sort()), [['assignment', 'title'], ['assignment', 'title']]);
  assert.deepEqual(created.body.tasks.map(task => task.title), ['Build the cart', 'Test the cart']);
  assert.deepEqual(created.body.tasks.map(task => task.assignment.unitId), [state.units[0].id, state.units[0].id]);
  assert.deepEqual((await readdir(join(state.paths.mind, 'user', 'tasks'))).sort(), ['001-build-the-cart.md', '002-test-the-cart.md']);
  assert.equal(state.launches.length, 0);
  click(root.querySelector('[data-action="run-plan"]'));
  await waitFor(() => document.querySelector('.dialog'), 'The Run confirmation did not open.');
  assert.equal(calls.some(call => call.path.endsWith('/run')), false);
  await clickAndWait(document.querySelector('.dialog').querySelector('.primary'));
  await waitFor(() => calls.some(call => call.method === 'POST' && call.path.endsWith('/run')), 'Run was not sent.');
  await drainRunLaunches(state.context);
  assert.deepEqual(JSON.parse(state.launches[0].bootstrap).plan.tasks.map(task => task.id), ['root:001', 'root:002']);
  await close();
});

test('choosing a Void text fills the empty draft from its top-level list items and level-two headings', async t => {
  const document = { title: 'Cart', rev: 0, pages: [
    { k: 'Intro', en: '# Cart\n\nIgnored preface.\n\n- Build the cart page\n\n  Show the lines and the totals.\n\n  Keep the layout.\n- [ ] Test the cart\n  - nested stays in the body', es: 'Texto' },
    { k: 'Pay', en: '## Take payment\n\nCard payment only.\n\n```\n- not a task\n## nor this\n```\n\n### Details stay in the body\n\n1. Send the receipt' }] };
  const { root, app, document: dom, state, calls, close } = await startEmptyClusterDesktop(t, { texts: [['docs/cart.json', document]] });
  click(root.querySelector('[data-action="plan-from-void"]'));
  await waitFor(() => dom.querySelector('[data-action="plan-void-text"]'), 'The Void texts were not listed.');
  assert.equal(dom.querySelectorAll('[data-action="plan-void-text"]').length, 1);
  assert.equal(dom.querySelector('[data-action="plan-void-text"]').textContent, 'Cart');
  click(dom.querySelector('[data-action="plan-void-text"]'));
  await waitFor(() => draftRows(root).length === 4, 'The rows were not filled from the text.');
  assert.deepEqual(draftRows(root).map(row => rowTitle(row).value), ['Build the cart page', 'Test the cart', 'Take payment', 'Send the receipt']);
  assert.equal(root.querySelector('[data-plan-empty]'), null); assert.equal(root.querySelector('[data-action="save-plan"]').disabled, false);
  assert.deepEqual(app.planDraft.draft.tasks.map(task => task.body), ['Show the lines and the totals.\n\nKeep the layout.', '- nested stays in the body',
    'Card payment only.\n\n```\n- not a task\n## nor this\n```\n\n### Details stay in the body', '']);
  click(draftRows(root)[1].querySelector('[data-action="remove-plan-task"]'));
  await waitFor(() => draftRows(root).length === 3, 'A row was not removed.');
  click(root.querySelector('[data-action="save-plan"]'));
  await waitFor(() => !app.planDraft && root.querySelector('[data-action="run-plan"]'), 'The saved plan card did not appear.');
  const created = calls.find(call => call.method === 'POST' && call.path === '/api/v1/plans');
  assert.deepEqual(created.body.tasks.map(task => task.title), ['Build the cart page', 'Take payment', 'Send the receipt']);
  assert.deepEqual(created.body.tasks.map(task => 'body' in task), [true, true, false]);
  assert.deepEqual((await readdir(join(state.paths.mind, 'user', 'tasks'))).sort(), ['001-build-the-cart-page.md', '002-take-payment.md', '003-send-the-receipt.md']);
  assert.equal(state.launches.length, 0);
  await close();
});

test('a cluster with open tasks keeps the draft built from them, without the empty-draft controls', async t => {
  const state = await makePlanFixture(t);
  const credentials = createCredentialStore({ now: state.context.now });
  state.context.settingsOwner = createSettingsOwner({ ...state.context, probeAgents: async () => ({}) });
  const server = await createHttpServer({ ...state.context, credentials }); state.context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, fetch, { clock: state.context.now });
  t.after(async () => { dispose(desktop.app); await server.close(); });
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.activeHandlers, 'The actual core tree did not load.');
  desktop.app.startDialog?.dialog.close();
  desktop.app.activeHandlers.onActivate({ kind: 'cluster', groupId: state.cluster.id }, 'single');
  await waitFor(() => desktop.root.querySelector('[data-action="start-plan"]'), 'The cluster chat did not open.');
  click(desktop.root.querySelector('[data-action="start-plan"]'));
  await waitFor(() => desktop.root.querySelector('[data-plan-draft]'), 'The draft did not open.');
  assert.deepEqual(draftRows(desktop.root).map(row => row.getAttribute('data-edit-task')), [state.taskId]);
  assert.equal(desktop.root.querySelector('[data-plan-empty]'), null); assert.equal(desktop.root.querySelector('[data-action="add-plan-task"]'), null);
  assert.equal(desktop.root.querySelector('[data-action="plan-from-void"]'), null); assert.equal(desktop.root.querySelector('[data-action="save-plan"]').disabled, false);
});

// The seeded shop executor has one live session on this machine. Registering the same native session as a started
// (command line) session lets the service report where it runs; a stopped status closes it.
const SHOP_SESSION = '20c58b80-4d93-88cd-83b3-39d78f1d9d5d';
function seedCheckout({ reading = null, stopped = false } = {}) {
  return async ({ tree, local }) => {
    const directory = join(tree.user, 'relay', 'sessions');
    for (const name of await readdir(directory)) {
      const record = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (record.sessionId !== SHOP_SESSION) continue;
      const registrationId = deterministicUuid(['checkout-registration']);
      await writeFile(join(directory, `${registrationId}.json`), JSON.stringify({ ...record, registrationId, launchKind: 'cli' }));
    }
    if (reading) {
      await mkdir(join(local, 'sessions', SHOP_SESSION), { recursive: true });
      await writeFile(join(local, 'sessions', SHOP_SESSION, 'checkout.json'), JSON.stringify({ format: 'hivem1nd-session-checkout-v1', sessionId: SHOP_SESSION, ...reading })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
    }
    if (stopped) {
      await mkdir(join(tree.user, 'relay', 'session-status', SHOP_SESSION), { recursive: true });
      await writeFile(join(tree.user, 'relay', 'session-status', SHOP_SESSION, 'closed.json'), JSON.stringify({ format: 'hivem1nd-session-status-v1', // Compatibility: stored schemas and wire contracts retain their existing identifiers.
        sessionId: SHOP_SESSION, state: 'stopped', machine: 'DESKTOP', at: '2026-10-10T11:59:00.000Z', reason: 'native-acknowledged' }));
    }
  };
}

async function openShopExecutor(t, options, urls = []) {
  const fixture = await createGuiFixture(options); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, urls); t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some(unit => unit.id === 'project:shop:executor-shop'), 'The unit list did not load.');
  const executor = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: 'unit', unit: executor }, 'double');
  await waitFor(() => desktop.root.querySelector("[data-details-section='detailsWaiting']"), 'The inspector details did not appear.');
  const facts = () => Object.fromEntries(desktop.root.querySelectorAll('[data-unit-facts]')[0].children
    .map(node => [node.textContent.split(': ')[0], { text: node.textContent.split(': ').slice(1).join(': '), title: node.getAttribute('title') }]));
  return { fixture, desktop, facts };
}

test('the agent inspector names the folder and branch a started session works in, marks a worktree and follows the language', async t => {
  const reading = { path: 'C:/Users/dev/Web/shop-worktree', kind: 'worktree', repositoryId: deterministicUuid(['repository']), branch: 'review', head: 'a'.repeat(40), detached: false, observedAt: '2026-10-10T11:58:00.000Z' };
  const urls = [];
  const { desktop, facts } = await openShopExecutor(t, { seed: seedCheckout({ reading }) }, urls);
  await waitFor(() => facts()['Works in'], 'The folder row did not appear.');
  assert.deepEqual(facts()['Works in'], { text: 'shop-worktree · Worktree', title: 'C:/Users/dev/Web/shop-worktree' });
  assert.equal(facts().Branch.text, 'review');
  assert.equal(Object.keys(facts()).indexOf('Works in'), Object.keys(facts()).indexOf('Runs in') + 1);
  assert.equal(Object.keys(facts()).indexOf('Branch'), Object.keys(facts()).indexOf('Works in') + 1);
  assert.equal(urls.filter(url => url.endsWith(`/sessions/${SHOP_SESSION}/checkout`)).length, 1, 'One read serves every render.');
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.equal(facts()['Trabaja en'].text, 'shop-worktree · Worktree');
  assert.equal(facts().Rama.text, 'review');
  assertVisibleCopy('es', desktop.root.querySelectorAll('[data-unit-facts]')[0].children.map(node => ['facts', node.textContent.split(': ')[0]]));
});

test('a manual session and a session that never ran here are not guessed', async t => {
  const manual = await openShopExecutor(t, {});
  await waitFor(() => manual.facts()['Works in'], 'The folder row did not appear.');
  assert.equal(manual.facts()['Works in'].text, 'Not known');
  assert.equal(manual.facts().Branch, undefined, 'a branch nobody knows is not a row');
  assert.equal(manual.facts()['Works in'].title, 'This session was started outside M1ND, so its folder is not recorded.');
  manual.desktop.app.language = 'es'; renderShell(manual.desktop.app);
  assert.equal(manual.facts()['Trabaja en'].text, 'Sin determinar');
  assert.equal(manual.facts()['Trabaja en'].title, 'Esta sesión se inició fuera de M1ND, por lo que no se registra su carpeta.');
  const blog = manual.desktop.app.unitList.catalog.find(unit => unit.id === 'project:blog:executor-shop');
  manual.desktop.app.activeHandlers.onActivate({ id: blog.id, kind: 'unit', unit: blog }, 'double');
  await waitFor(() => manual.desktop.app.inspectorData?.unitId === blog.id, 'The second inspector did not load.');
  assert.equal(manual.facts()['Trabaja en'], undefined, 'A stopped session of another machine shows nothing.');
});

test('a stopped session keeps its last reading marked with the time it was last seen', async t => {
  const reading = { path: 'C:/Users/dev/Web/shop', kind: 'repository', repositoryId: deterministicUuid(['repository']), branch: 'main', head: 'c'.repeat(40), detached: false, observedAt: '2026-10-10T11:58:00.000Z' };
  const { facts } = await openShopExecutor(t, { seed: seedCheckout({ reading, stopped: true }) });
  await waitFor(() => facts()['Works in'], 'The last reading did not appear.');
  const seen = formatWhen('en', reading.observedAt);
  assert.deepEqual(facts()['Works in'], { text: `shop · Last seen ${seen}`, title: reading.path });
  assert.equal(facts().Branch.text, `main · Last seen ${seen}`);
});

test('the folder and branch rows cover a detached head, a plain folder, a private folder and a failed read in both languages', () => {
  const base = { sessionId: 'session', repositoryId: null, branch: null, head: null, detached: false, observedAt: '2026-10-10T11:58:00.000Z', live: true };
  const session = { id: 'session', machine: 'DESKTOP', state: 'registered' };
  const rows = (language, entry, extra = {}) => checkoutFacts((key, values) => text(language, key, values), language, { session: { ...session, ...extra }, local: 'DESKTOP', entry });
  const detached = { ...base, path: 'C:/Web/shop', kind: 'repository', head: 'b'.repeat(40), detached: true };
  assert.deepEqual(rows('en', { data: detached }), [['worksIn', 'shop', 'C:/Web/shop'], ['branch', 'Detached at bbbbbbb', null]]);
  assert.deepEqual(rows('es', { data: detached }), [['worksIn', 'shop', 'C:/Web/shop'], ['branch', 'Desacoplada en bbbbbbb', null]]);
  assert.deepEqual(rows('en', { data: { ...base, path: 'C:/Notes', kind: 'folder' } }), [['worksIn', 'Notes', 'C:/Notes']], 'A folder without Git has no branch to show.');
  assert.deepEqual(rows('en', { data: { ...base, path: 'C:/Local/sessions/8c2f', kind: 'private' } }), [['worksIn', 'Private folder', 'C:/Local/sessions/8c2f']]);
  assert.deepEqual(rows('en', { error: new Error('offline') }).map(row => row.slice(0, 2)), [['worksIn', 'Not known']], 'an unknown branch is not a row');
  assert.deepEqual(rows('en', { data: { ...base, path: 'C:/Web/shop', kind: 'repository' } }), [['worksIn', 'shop', 'C:/Web/shop']], 'a repository without a branch name shows none');
  // A unit of the root scope works in every cluster: an unknown folder is not "Not known" for it, and a known one is still named.
  const rootRows = (language, entry) => checkoutFacts((key, values) => text(language, key, values), language, { session, local: 'DESKTOP', entry, root: true });
  assert.deepEqual(rootRows('en', { error: new Error('offline') }), [['worksIn', 'Every cluster', null]]);
  assert.deepEqual(rootRows('es', { data: { sessionId: 'session', known: false, reason: 'manual' } }), [['worksIn', 'Todos los clústeres', null]]);
  assert.deepEqual(rootRows('en', { data: detached })[0], ['worksIn', 'shop', 'C:/Web/shop']);
  assert.deepEqual(rows('en', { error: new Error('offline') }, { state: 'stopped' }), []);
  assert.deepEqual(rows('en', undefined), [], 'Nothing is shown before the first answer.');
  assert.deepEqual(checkoutFacts(key => key, 'en', { session: null, local: 'DESKTOP' }), []);
  assert.equal(rows('en', { data: { sessionId: 'session', known: false, reason: 'other_machine' } })[0][2], 'Another machine runs this session.');
  assert.equal(rows('es', { data: { sessionId: 'session', known: false, reason: 'git_unavailable' } })[0][2], 'Git no respondió para esta carpeta.');
  assert.equal(rows('en', undefined, { machine: 'LAPTOP' })[0][2], 'Another machine runs this session.', 'No request is made for another machine.');
  for (const key of ['worksIn', 'branch', 'worktree', 'detachedAt', 'notKnown', 'lastSeen']) {
    assert.ok(text('en', key, { head: 'x', time: 'y' }).length > 0 && text('es', key, { head: 'x', time: 'y' }).length > 0);
  }
  assert.equal(text('en', 'worksIn'), 'Works in'); assert.equal(text('es', 'worksIn'), 'Trabaja en');
  assert.equal(text('en', 'lastSeen', { time: 'T' }), 'Last seen T'); assert.equal(text('es', 'lastSeen', { time: 'T' }), 'Visto por última vez T');
});

test('the folder rows are read again on a session change, not on every work event inside 15 seconds', async t => {
  const reading = { path: 'C:/Users/dev/Web/shop', kind: 'repository', repositoryId: deterministicUuid(['repository']), branch: 'main', head: 'a'.repeat(40), detached: false, observedAt: '2026-10-10T11:58:00.000Z' };
  const urls = [], seed = seedCheckout({ reading });
  let local;
  const { fixture, desktop, facts } = await openShopExecutor(t, { seed: async context => { local = context.local; await seed(context); } }, urls);
  const reads = () => urls.filter(url => url.endsWith(`/sessions/${SHOP_SESSION}/checkout`)).length;
  await waitFor(() => facts().Branch?.text === 'main', 'The first reading did not appear.');
  assert.equal(reads(), 1);
  await writeFile(join(local, 'sessions', SHOP_SESSION, 'checkout.json'), JSON.stringify({ format: 'hivem1nd-session-checkout-v1', sessionId: SHOP_SESSION, ...reading, branch: 'later' })); // Compatibility: stored schemas and wire contracts retain their existing identifiers.
  const cursor = desktop.app.store.cursor;
  await fixture.control.emit('session.work', { sessionId: SHOP_SESSION, sequence: 1 });
  await waitFor(() => desktop.app.store.cursor !== cursor, 'The work event was not consumed.');
  assert.equal(reads(), 1, 'A work event inside the window reads nothing.');
  assert.equal(facts().Branch.text, 'main');
  await fixture.control.emit('session.changed', { session: { id: SHOP_SESSION, unitId: 'project:shop:executor-shop', state: 'registered' } });
  await waitFor(() => facts().Branch?.text === 'later', 'The session change did not refresh the branch.');
  assert.equal(reads(), 2);
  assert.ok(desktop.app.checkoutTimer, 'A live session is read again on a timer.');
});

test('Stop the step on an ordinary session uses its own route, shows progress and its outcome, and the session stays', async t => {
  const fixture = await makeCoreFixture(); t.after(() => disposeCoreFixture(fixture));
  const now = () => fixture.clock.now, unitId = 'root:overseer', meter = { used: 180, capacity: 1000, unit: 'tokens' };
  const context = { ...fixture, now, principal: { audience: 'desktop', unitId: 'root:master' }, ownedPids: new Set([5151]), adapters: {} };
  await mkdir(join(fixture.paths.mind, 'user', 'state'), { recursive: true });
  await writeFile(join(fixture.paths.mind, 'user', 'state', 'overseer.md'), 'unit: overseer\nunit-id: root:overseer\nrole: overseer\nstate: in\nmachine: DESKTOP\nfresh: true\n\nReady.\n');
  await writeFile(join(fixture.paths.mind, 'rules.md'), 'Current M1ND rules.');
  const interrupts = []; let release, answer = { acknowledged: true }; const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  context.adapters.codex = { client: 'codex', capabilities: { create: true, stop: true }, confirm: async () => true,
    readContext: async () => meter, contextBusy: async () => false, checkpointContext: async () => ({ messages: [{ role: 'user', content: 'Decision' }] }),
    summarizeContext: async () => 'Keep the decision.', prepareContext: async () => ({ acknowledged: true }), commitContext: async () => true,
    interruptTurn: async input => { interrupts.push(input); await gate; return answer; } };
  const session = await registerNative(context, { client: 'codex', unitId, nativeSessionId: 'fixture-step', launchKind: 'cli', runMode: 'chat' });
  const journal = join(fixture.paths.localDirectory, 'session-starts', 'owned.json'); await mkdir(dirname(journal), { recursive: true });
  await writeFile(journal, JSON.stringify({ requestId: crypto.randomUUID(), sessionId: session.sessionId, unitId, client: 'codex', pid: 5151, phase: 'registered', createAttempted: true, nativeSessionId: 'fixture-step' }));
  context.ledger = openLedger({ store: fixture.store, paths: fixture.paths, now, machine: fixture.machine });
  const { chat } = await createChat(context, { members: [unitId] }); await postChat(context, chat.id, { body: 'Keep authored history.' });
  await createContext(context, session, context.adapters.codex);
  context.settingsOwner = createSettingsOwner({ ...context, probeAgents: async () => ({}) });
  const credentials = createCredentialStore({ now }), server = await createHttpServer({ ...context, credentials }); context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const calls = [];
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, async (input, init) => {
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : null }); return fetch(input, init);
  }, { clock: now });
  t.after(async () => { dispose(desktop.app); await server.close(); });
  await patient(() => desktop.app.unitList?.catalog?.length, 'The actual Overseer did not load.');
  desktop.app.startDialog?.dialog.close();
  desktop.app.activeHandlers.onActivate({ kind: 'unit', id: unitId, unit: desktop.app.unitList.catalog.find(unit => unit.id === unitId) }, 'double');
  await patient(() => desktop.root.querySelector('[data-action="session-work"]'), 'The session tabs did not open.');
  click(desktop.root.querySelector('[data-action="session-work"]'));
  await patient(() => desktop.root.querySelector('[data-session-work]'), 'Work did not open.');
  const stop = () => desktop.root.querySelector('[data-action="stop-step"]');
  assert.equal(stop().getAttribute('aria-busy'), null);
  click(stop());
  await patient(() => stop().getAttribute('aria-busy') === 'true', 'The button did not show progress.');
  await patient(() => interrupts.length === 1, 'The native step was not asked to stop.');
  assert.notEqual(stop().getAttribute('disabled'), null, 'the button cannot be pressed twice');
  click(stop());
  release();
  await patient(() => desktop.root.querySelector('[data-stop-outcome="stopped"]'), 'The Work tab did not show the outcome.');
  assert.equal(desktop.root.querySelector('[data-stop-outcome]').textContent, 'The step was stopped. The session stays open.');
  assert.equal(stop().getAttribute('aria-busy'), null);
  const stopped = calls.filter(call => call.method === 'POST' && call.path === `/api/v1/sessions/${session.sessionId}/stop-step`);
  assert.equal(stopped.length, 1); assert.deepEqual(stopped[0].body, {});
  assert.deepEqual(interrupts[0].nativeSessionId, 'fixture-step');
  assert.equal(calls.some(call => call.path.includes('/runs/')), false, 'an ordinary session never uses the plan control');
  assert.equal(calls.some(call => call.method === 'POST' && call.path.endsWith('/stop')), false, 'the session itself is not stopped');
  assert.notEqual((await request(desktop.app.api, 'GET', '/sessions')).data.items.find(item => item.id === session.sessionId).state, 'stopped');
  answer = { acknowledged: true, idle: true };
  click(stop());
  await patient(() => desktop.root.querySelector('[data-stop-outcome="idle"]'), 'The idle outcome was not shown.');
  assert.equal(desktop.root.querySelector('[data-stop-outcome]').textContent, 'Nothing was running, so there was no step to stop.');
  answer = { acknowledged: false };
  click(stop());
  await patient(() => desktop.root.querySelector('[data-stop-outcome="failed"]'), 'The failed outcome was not shown.');
  assert.equal(desktop.root.querySelector('[data-stop-outcome]').textContent, 'The agent did not confirm that the step stopped. It may still be working.');
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-stop-outcome]').textContent, 'El agente no confirmó que el paso se detuviera. Puede seguir trabajando.');
});

test('Stop the step on a plan attempt keeps the plan control and never calls the session route', async t => {
  const state = await makePlanFixture(t);
  let stepStops = 0;
  const parent = new (await import('node:events')).EventEmitter(), identity = crypto.randomUUID();
  state.nativeOptions.planProcessHandle = { identity, verify: async () => true, onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
    cleanup: async () => ({ closed: true, identity }), stop: async () => { parent.emit('exit'); return { acknowledged: true }; }, stopStep: async () => { stepStops += 1; return { acknowledged: true }; } };
  state.context.ledger = openLedger({ store: state.store, paths: state.context.paths, now: state.context.now, machine: state.machine });
  await postChat(state.context, state.cluster.chatId, { body: 'Build the requested cart.' });
  state.input.expectedChatRevision = (await import('../engine/service/projection.mjs').then(module => module.readDetail(state.context, 'chats', state.cluster.chatId))).revision;
  const plan = await createPlan(state.context, state.input);
  const credentials = createCredentialStore({ now: state.context.now });
  state.context.settingsOwner = createSettingsOwner({ ...state.context, probeAgents: async () => ({}) });
  const server = await createHttpServer({ ...state.context, credentials }); state.context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const calls = [];
  const desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, async (input, init) => {
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : null }); return fetch(input, init);
  }, { clock: state.context.now });
  t.after(async () => { dispose(desktop.app); await server.close(); });
  await patient(() => desktop.app.unitList?.catalog?.length && desktop.app.activeHandlers, 'The actual core tree did not load.');
  desktop.app.startDialog?.dialog.close();
  desktop.app.activeHandlers.onActivate({ kind: 'cluster', groupId: state.cluster.id }, 'single');
  await patient(() => desktop.root.querySelector('.plan-card'), 'The plan did not attach to the lead chat.');
  const started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  await refreshPlan(desktop.app.planController, plan.id, started.runId);
  const run = await readRun(state.context, started.runId);
  await loadSnapshot(desktop.app.store, desktop.app.api);
  const unit = desktop.app.store.indexes.units.get(state.units[0].id);
  desktop.app.activeHandlers.onActivate({ kind: 'unit', id: unit.id, unit }, 'double');
  await patient(() => desktop.root.querySelector('[data-action="session-work"]'), 'The actual session tabs did not open.');
  click(desktop.root.querySelector('[data-action="session-work"]'));
  await patient(() => desktop.root.querySelector('[data-session-work]'), 'Work did not open.');
  click(desktop.root.querySelector('[data-action="stop-step"]'));
  await patient(() => desktop.root.querySelector('[data-stop-outcome="stopped"]'), 'The plan step stop did not report.');
  const control = calls.filter(call => call.method === 'POST' && call.path === `/api/v1/runs/${run.id}/control`);
  assert.equal(control.length, 1); assert.equal(control[0].body.action, 'stop_step'); assert.equal(control[0].body.attemptId, run.attempts[0].id);
  assert.equal(stepStops, 1, 'the plan handle was asked to stop the step');
  assert.equal(calls.some(call => call.path.endsWith('/stop-step')), false, 'a plan attempt never uses the session route');
});

function documentOrder(root) {
  const list = [];
  const visit = node => { list.push(node); for (const child of node.children ?? []) visit(child); };
  visit(root);
  return list;
}

test('every agent inspector keeps the header, tabs, facts, and composer in separate blocks', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.chatList?.catalog?.length, 'The unit list did not load.');
  const sessionUnits = new Set((desktop.app.store.view?.sessions ?? []).map(session => session.unitId));
  const idle = desktop.app.unitList.catalog.find(unit => unit.role !== 'master' && !unit.removed && !sessionUnits.has(unit.id));
  assert.ok(idle, 'An executor that has not started is required.');
  desktop.app.activeHandlers.onActivate({ id: idle.id, kind: 'unit', unit: idle }, 'double');
  await waitFor(() => desktop.root.querySelector('[data-unit-facts]') && desktop.root.querySelector('[data-action="session-chat"]') && desktop.root.querySelector('[data-action="session-work"]'), 'The idle agent inspector did not gain tabs and facts.');
  const body = desktop.root.querySelector('.agent-inspector');
  assert.ok(body);
  const heading = body.querySelector('.agent-heading');
  const facts = body.querySelector('[data-unit-facts]');
  const tabs = body.querySelector('.session-tabs');
  assert.equal(facts.className.includes('agent-facts'), true);
  assert.equal(facts.closest('.transcript'), null);
  assert.equal(body.querySelector(':scope > h2, h2')?.textContent === 'Nothing selected', false);
  // The facts are in the Details tab, after the tabs and apart from the conversation.
  const order = documentOrder(body);
  assert.ok(order.indexOf(heading) < order.indexOf(tabs) && order.indexOf(tabs) < order.indexOf(facts));
  assert.ok(facts.closest('[data-agent-details]'));
  click(desktop.root.querySelector('[data-action="session-work"]'));
  await waitFor(() => desktop.root.querySelector('[data-unit-work]'), 'Work did not open for an agent that has not started.');
  assert.equal([...desktop.root.querySelector('[data-unit-work]').children].some(node => node.textContent === 'Not started'), true);
  assert.equal(desktop.root.querySelector('.transcript'), null);
  click(desktop.root.querySelector('[data-action="session-chat"]'));
  const direct = desktop.app.chatList.catalog.find(chat => chat.kind === 'direct');
  assert.ok(direct);
  desktop.app.store.selected.unitId = null;
  desktop.app.mapState?.selection?.clear();
  navigate(desktop.app, 'chats');
  desktop.app.activeHandlers.onActivate({ id: direct.id, kind: 'chat' }, 'double');
  await waitFor(() => desktop.root.querySelector('.agent-heading') && desktop.root.querySelector('[data-composer]'), 'Opening a direct chat did not show the agent.');
  assert.equal([...desktop.root.querySelectorAll('h2')].some(node => node.textContent === 'Nothing selected'), false);
  const column = desktop.root.querySelector('.agent-conversation');
  const transcript = column.querySelector('.transcript');
  const composer = column.querySelector('[data-composer]');
  const chatFacts = desktop.root.querySelector('[data-unit-facts]');
  assert.equal(transcript.contains(composer), false);
  assert.equal(transcript.contains(chatFacts), false);
  // The facts are in the Details tab, hidden while the chat is shown.
  assert.notEqual(chatFacts.closest('[data-agent-details]')?.getAttribute('hidden'), null);
  const chatOrder = documentOrder(column);
  assert.ok(chatOrder.indexOf(transcript) < chatOrder.indexOf(composer));
  const started = transcript.querySelector('[data-started-with]');
  if (started) assert.equal(transcript.children[0], started);
  const css = await readFile(new URL('../gui/app/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.inspector-body\.agent-inspector > \.chat-panel\.agent-conversation \{[^}]*overflow:\s*hidden/);
});

test('a slow chat load shows one notice above the composer', async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.root.querySelector('.map'), 'The map did not open.');
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const fetchRequest = desktop.app.api.fetch;
  desktop.app.api.fetch = (input, init) => String(input).includes('/messages') ? gate.then(() => fetchRequest(input, init)) : fetchRequest(input, init);
  const executor = desktop.app.unitList.catalog.find(unit => unit.role === 'executor' && !unit.removed);
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: 'unit', unit: executor }, 'double');
  const ready = () => {
    const keys = [...(desktop.app.activity?.keys() ?? [])];
    return keys.some(key => key.startsWith('chat-load:')) && keys.some(key => key.startsWith('open-chat:') || key.startsWith('direct:'));
  };
  await patient(ready, "The slow chat notice did not appear.").catch(() => {
    throw new Error(JSON.stringify({
      keys: [...(desktop.app.activity?.keys() ?? [])],
      pending: desktop.app.pendingChat, opening: desktop.app.chatOpening,
      selected: desktop.app.store.selected.unitId, thread: desktop.app.thread?.chat?.kind ?? null,
    }));
  });
  const region = desktop.root.querySelector('[data-activity-region]');
  const keys = [...region.children].map(node => node.getAttribute('data-activity')).filter(Boolean);
  assert.equal(keys.some(key => key.startsWith('open-chat:') || key.startsWith('direct:')), false);
  assert.equal(keys.filter(key => key.startsWith('chat-load:')).length, 1);
  const field = [...region.parent.children].find(node => String(node.className).split(/\s+/).includes('field'));
  assert.ok(field);
  assert.ok([...region.parent.children].indexOf(region) < [...region.parent.children].indexOf(field));
  assert.equal(region.getAttribute('data-overlay'), null);
  const texts = [];
  const visit = node => { if (node.textContent) texts.push(node.textContent); for (const child of node.children ?? []) visit(child); };
  visit(region);
  assert.equal(texts.some(text => /\b0 s\b/.test(text)), false);
  release();
});

test("an agent with no conversation offers the composer and its first message opens the conversation", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, "The agents did not load.");
  const chats = (await request(api, "GET", "/chats", { query: { listed: "true" } })).data.items;
  const talked = new Set(chats.filter((chat) => chat.kind === "direct").flatMap((chat) => chat.members));
  const quiet = desktop.app.unitList.catalog.find((unit) => unit.role !== "master" && !talked.has(unit.id));
  assert.ok(quiet, "the fixture has an agent with no conversation");
  desktop.app.mapState.selection = new Set([quiet.id]);
  desktop.app.mapState.onSelection([quiet.id]);
  await waitFor(() => desktop.root.querySelector(`[data-first-message="${quiet.id}"]`), "The first-message composer did not appear.");
  assert.equal(desktop.root.querySelector("[data-composer]"), null, "no open conversation is announced before the first message");
  typeInput(desktop.root.querySelector(`[data-first-message="${quiet.id}"]`), "Hello from the first message", 0, 0);
  click(desktop.root.querySelector('[data-action="send-first"]'));
  await waitFor(() => desktop.app.thread?.chat?.kind === "direct" && desktop.app.thread.chat.members.includes(quiet.id), "The conversation did not open.");
  let posted = false;
  for (let attempt = 0; attempt < 100 && !posted; attempt += 1) {
    const items = (await request(api, "GET", `/chats/${encodeURIComponent(desktop.app.thread.chat.id)}/messages`)).data.items ?? [];
    posted = items.some((message) => message.body === "Hello from the first message");
    if (!posted) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(posted, true, "The first message was not posted.");
});

// Opens the New agent dialog of a fresh cluster in the fixture app and records every agent creation the app sends.
async function openNewAgent(t) {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const group = (await createGroup(apiFrom(fixture.desktopUrl), 'Ideas', ['project:shop:executor-shop'])).data;
  const sent = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (init?.method === 'POST' && String(input).endsWith(`/clusters/${group.id}/agents`)) sent.push(JSON.parse(init.body));
  });
  t.after(() => dispose(desktop.app));
  desktop.app.startDialog?.dialog.close();
  click(desktop.root.querySelector(`[data-cluster-row="${group.id}"]`));
  await waitFor(() => desktop.root.querySelector(`[data-cluster-inspector="${group.id}"]`), 'The cluster did not open.');
  click(desktop.root.querySelector("[data-action='new-agent']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='agent']"), 'The agent choices did not open.');
  return { ...desktop, fixture, group, sent, dialog: desktop.document.querySelector("[data-start-dialog='agent']") };
}

test('the mounted New agent dialog offers every preset and Custom, and a preset is sent without a name or description', async (t) => {
  const { app, root, document, dialog, sent, group } = await openNewAgent(t);
  for (const id of AGENT_ROLES) assert.ok(dialog.querySelector(`[data-action="choose-${id}"]`), id);
  assert.equal(dialog.querySelector('[data-action="choose-executor"]').getAttribute('aria-pressed'), 'true');
  assert.equal(dialog.querySelector('[data-custom-role]'), null);
  click(dialog.querySelector('[data-action="choose-code-reviewer"]'));
  assert.equal(dialog.querySelector('[data-action="choose-code-reviewer"]').getAttribute('aria-pressed'), 'true');
  assert.equal(dialog.querySelector('[data-action="choose-executor"]').getAttribute('aria-pressed'), 'false');
  assert.equal(dialog.querySelector('[data-custom-role]'), null);
  await clickAndWait(dialog.querySelector('[data-action="create-agent"]'));
  await waitFor(() => !app.startDialog && app.unitList.catalog.some(unit => unit.role === 'code-reviewer'), 'The preset agent was not created.');
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['expectedRevision', 'machine', 'role', 'runsIn', 'useAsDefault']);
  assert.equal(sent[0].role, 'code-reviewer');
  const made = app.unitList.catalog.find(unit => unit.role === 'code-reviewer');
  assert.equal(made.roleName, null);
  await waitFor(() => root.querySelector(`[data-unit-id="${made.id}"]`), 'The new agent did not reach the Map.');
  // The Map draws its own mark and names the role in the tooltip; the inspector says it in the Role line.
  const node = root.querySelector(`[data-unit-id="${made.id}"]`);
  assert.ok(node.querySelector(`[data-role-icon="${hierarchyIcon(made)}"]`));
  assert.match(node.getAttribute('title'), /(^|, )Code reviewer$/, 'the tooltip names the role, after the full name when the name was shortened');
  assert.ok(root.querySelectorAll('p').some(node => node.textContent === 'Role: Code reviewer'));
});

test('the mounted Custom role is checked inline, sent with its name and description, and shown as that name everywhere', async (t) => {
  const { app, root, document, dialog, sent, group } = await openNewAgent(t);
  const description = 'Cuts the release.\nChecks the notes before every tag.';
  click(dialog.querySelector('[data-action="choose-custom"]'));
  const name = () => dialog.querySelector('[data-start-field="roleName"]'), area = () => dialog.querySelector('[data-start-field="roleDescription"]');
  assert.ok(name() && area());
  assert.equal(name().getAttribute('maxlength'), '60'); assert.equal(area().getAttribute('maxlength'), '4000');
  assert.equal(dialog.querySelector('[data-role-count]').textContent, '0 of 4000');
  // Nothing typed: both problems show under their fields, focus goes to the first and nothing is sent.
  click(dialog.querySelector('[data-action="create-agent"]'));
  assert.deepEqual(dialog.querySelectorAll('[data-role-error]').map(node => node.getAttribute('data-role-error')), ['roleName', 'roleDescription']);
  assert.equal(document.activeElement, name());
  assert.equal(name().getAttribute('aria-invalid'), 'true');
  assert.equal(sent.length, 0); assert.equal(app.startDialog?.dialog, dialog);
  // Editing a field clears only its own message.
  typeInput(name(), 'n'.repeat(60), 60, 60);
  assert.equal(dialog.querySelector('[data-role-error="roleName"]').textContent, '');
  assert.notEqual(dialog.querySelector('[data-role-error="roleDescription"]').textContent, '');
  typeInput(area(), description, 5, 5);
  assert.equal(dialog.querySelector('[data-role-error="roleDescription"]').textContent, '');
  assert.equal(dialog.querySelector('[data-role-count]').textContent, `${description.length} of 4000`);
  // The values survive switching to a preset and back.
  click(dialog.querySelector('[data-action="choose-qa"]'));
  assert.equal(dialog.querySelector('[data-custom-role]'), null);
  click(dialog.querySelector('[data-action="choose-custom"]'));
  assert.equal(name().value, 'n'.repeat(60)); assert.equal(area().value, description);
  // A name over the limit cannot be typed in a browser, but a pasted value is still checked before it is sent.
  typeInput(name(), 'n'.repeat(61), 61, 61);
  click(dialog.querySelector('[data-action="create-agent"]'));
  assert.equal(dialog.querySelector('[data-role-error="roleName"]').textContent, 'The name can have up to 60 characters.');
  assert.equal(sent.length, 0);
  typeInput(name(), '  Release captain ', 18, 18);
  await clickAndWait(dialog.querySelector('[data-action="create-agent"]'));
  await waitFor(() => !app.startDialog && sent.length === 1 && app.unitList.catalog.some(unit => unit.role === 'custom'), 'The custom agent was not created.');
  assert.deepEqual({ ...sent[0], runsIn: undefined, expectedRevision: undefined, machine: undefined },
    { role: 'custom', roleName: 'Release captain', roleDescription: description, useAsDefault: false, runsIn: undefined, expectedRevision: undefined, machine: undefined });
  assert.ok(sent[0].runsIn && sent[0].expectedRevision && sent[0].machine);
  const made = app.unitList.catalog.find(unit => unit.role === 'custom');
  assert.equal(made.roleName, 'Release captain'); assert.equal(made.roleDescription, description);
  await waitFor(() => app.store.indexes.groups.get(group.id).members.includes(made.id), 'The cluster did not take its new agent.');
  await waitFor(() => root.querySelector(`[data-unit-id="${made.id}"]`), 'The new agent did not reach the Map.');
  const node = root.querySelector(`[data-unit-id="${made.id}"]`);
  assert.equal(node.getAttribute('data-role'), 'custom');
  assert.match(node.getAttribute('title'), /(^|, )Release captain$/);
  assert.ok(node.querySelector(`[data-role-icon="${hierarchyIcon(made)}"]`));
  assert.ok(root.querySelectorAll('p').some(node => node.textContent === 'Role: Release captain'));
});

test('the Hierarchy names a custom or preset role under the unit and a role the app does not know stays a plain agent', async (t) => {
  const fixture = await createGuiFixture({ seed: async ({ tree }) => {
    const state = (unit, role, extra = []) => [`unit: ${unit}`, `unit-id: root:${unit}`, `role: ${role}`, ...extra, 'state: in', 'machine: DESKTOP',
      `runs-in: ${JSON.stringify({ client: 'cursor', model: 'fixture-model', effort: 'high', mode: null })}`, 'date: 2026-10-10 09:00', '', 'Ready.', ''].join('\n');
    await mkdir(join(tree.user, 'state'), { recursive: true });
    await writeFile(join(tree.user, 'state', 'captain.md'), state('captain', 'custom', ['role-name: Release captain', `role-description: ${JSON.stringify('Cuts the release.\nChecks the notes.')}`]));
    await writeFile(join(tree.user, 'state', 'tester.md'), state('tester', 'qa'));
    await writeFile(join(tree.user, 'state', 'plain.md'), state('plain', 'executor'));
  } });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some(unit => unit.id === 'root:captain'), 'The seeded units did not load.');
  const captain = desktop.app.unitList.catalog.find(unit => unit.id === 'root:captain');
  assert.equal(captain.role, 'custom'); assert.equal(captain.roleName, 'Release captain'); assert.equal(captain.roleDescription, 'Cuts the release.\nChecks the notes.');
  assert.equal(desktop.app.unitList.catalog.find(unit => unit.id === 'root:tester').roleName, null);
  await waitFor(() => desktop.root.querySelector('[data-unit-role="custom"]'), 'The Hierarchy did not name the custom role.');
  assert.equal(desktop.root.querySelector('[data-unit-role="custom"]').textContent, 'Release captain');
  assert.equal(desktop.root.querySelector('[data-unit-role="qa"]').textContent, 'QA');
  assert.equal(desktop.root.querySelector('[data-unit-role="executor"]'), null);
  const rows = desktop.app.activeRows.filter(row => row.kind === 'unit');
  assert.ok(rows.find(row => row.unit.id === 'root:captain').text.startsWith('Captain (Release captain) '));
  assert.ok(rows.find(row => row.unit.id === 'root:plain').text.startsWith('Plain '));
  // The Spanish names come from the same table.
  desktop.app.language = 'es'; renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-unit-role="qa"]').textContent, 'QA');
  assert.equal(desktop.root.querySelector('[data-unit-role="custom"]').textContent, 'Release captain');
  // The inspector says it in the Role line, and a role the app does not know is a plain agent, never its id.
  const english = (key, values) => text('en', key, values);
  const line = unit => renderUnit(desktop.document, unit, english, 'en').querySelectorAll('p').find(node => node.textContent.startsWith('Role')).textContent;
  assert.equal(line(captain), 'Role: Release captain');
  assert.equal(line({ unit: 'a', role: 'custom', roleName: null }), 'Role: Custom');
  assert.equal(line({ unit: 'a', role: 'product-manager' }), 'Role: Product manager');
  assert.equal(line({ unit: 'a', role: 'wizard' }), 'Role: Agent');
  assert.equal(line({ unit: 'a', role: 'constructor' }), 'Role: Agent');
  assert.equal(line({ unit: 'a', role: 'agent' }), 'Role: Agent');
  assert.equal(line({ unit: 'a' }), 'Role: Unknown');
  assert.equal(renderUnit(desktop.document, { unit: 'a', role: 'wizard' }, (key, values) => text('es', key, values), 'es').querySelectorAll('p').find(node => node.textContent.startsWith('Rol')).textContent, 'Rol: Agente');
  // An agent led by the person names the person in the inspector's language.
  const leadLine = (language, leadId) => renderUnit(desktop.document, { unit: 'a', leadId }, (key, values) => text(language, key, values), language).querySelectorAll('p').find(node => node.textContent.startsWith(text(language, 'lead'))).textContent;
  assert.equal(leadLine('es', 'root:master'), `Líder: ${text('es', 'person')}`);
  assert.equal(leadLine('es', 'root:person'), `Líder: ${text('es', 'person')}`);
  assert.equal(leadLine('en', 'root:master'), 'Lead: You');
  assert.equal(leadLine('es', 'env:web:overlord-web'), 'Líder: Overlord web');
});

test("a task changed elsewhere updates the inspector's copy of it", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === executor.id && desktop.app.inspectorData.tasks?.some((task) => task.status === "open"), "The inspector did not list an open task.");
  const open = desktop.app.inspectorData.tasks.find((task) => task.status === "open");
  const path = `/tasks/${encodeURIComponent(open.id)}/status`;
  await request(desktop.app.api, "POST", path, { operation: createOperation({ method: "POST", path, body: { status: "review", expectedRevision: open.revision } }) });
  await waitFor(() => desktop.app.inspectorData.tasks.find((task) => task.id === open.id)?.status === "review", "The inspector kept the old task.");
});

test("an older waiting answer arriving last does not undo a newer one", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  const taskId = "project:shop:029";
  const review = (await request(desktop.app.api, "GET", "/waiting")).data.items.find((item) => item.taskId === taskId);
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === review.unitId), "The unit list did not load.");
  const reviewer = desktop.app.unitList.catalog.find((unit) => unit.id === review.unitId);
  desktop.app.activeHandlers.onActivate({ id: reviewer.id, kind: "unit", unit: reviewer }, "double");
  const waits = () => desktop.app.inspectorData?.waiting?.some((item) => item.taskId === taskId);
  await waitFor(() => desktop.app.inspectorData?.unitId === reviewer.id && waits(), "The inspector did not list the review as waiting.");
  // The answer to the first task change is held until the second one has been answered.
  const fetch = desktop.app.api.fetch;
  let held = false, answered = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  desktop.app.api.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (String(url).includes("/waiting?unitId=")) { if (!held) { held = true; await gate; } else answered += 1; }
    return response;
  };
  const ready = (await request(desktop.app.api, "GET", `/tasks/${encodeURIComponent(taskId)}`)).data;
  const accepted = (await changeTaskStatus(desktop.app.api, ready.task ?? ready, "done")).data.task;
  await waitFor(() => held, "The first waiting request did not start.");
  const before = desktop.app.inspectorData.waiting;
  await undoTask(desktop.app.api, accepted);
  await waitFor(() => answered > 0 && desktop.app.inspectorData.waiting !== before && waits(), "The task back in review did not wait again.");
  release();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(waits(), true, "the older answer arriving last does not remove it");
});

test("a full inspector load answered after a task change keeps the newer task and waiting items", async (t) => {
  const taskId = "project:shop:029";
  // The reviewer's inspector waits on the review; the executor's inspector lists the task itself.
  for (const side of ["reviewer", "executor"]) await t.test(side, async (t) => {
    const fixture = await createGuiFixture();
    t.after(() => fixture.close());
    const desktop = await bootApp(fixture.desktopUrl, 1440, []);
    t.after(() => dispose(desktop.app));
    const review = (await request(desktop.app.api, "GET", "/waiting")).data.items.find((item) => item.taskId === taskId);
    const unitId = side === "reviewer" ? review.unitId : "project:shop:executor-shop";
    await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === unitId), "The unit list did not load.");
    const unit = desktop.app.unitList.catalog.find((item) => item.id === unitId);
    const waits = () => desktop.app.inspectorData?.waiting?.some((item) => item.taskId === taskId);
    const status = () => desktop.app.inspectorData?.tasks?.find((task) => task.id === taskId)?.status;
    const current = () => side === "reviewer" ? waits() : status() === "review";
    desktop.app.activeHandlers.onActivate({ id: unit.id, kind: "unit", unit }, "double");
    await waitFor(() => desktop.app.inspectorData?.unitId === unit.id && current(), "The inspector did not show the task in review.");
    // The next full load is held until the task has changed and its own refresh has run.
    const fetch = desktop.app.api.fetch;
    let held = false, release;
    const gate = new Promise((resolve) => { release = resolve; });
    desktop.app.api.fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (String(url).includes("/tasks?unitId=") && !held) { held = true; await gate; }
      return response;
    };
    const ticket = desktop.app.inspectorTicket;
    desktop.app.activeHandlers.onActivate({ id: unit.id, kind: "unit", unit }, "double");
    await waitFor(() => held && desktop.app.inspectorTicket > ticket, "The full load did not start.");
    const ready = (await request(desktop.app.api, "GET", `/tasks/${encodeURIComponent(taskId)}`)).data;
    await changeTaskStatus(desktop.app.api, ready.task ?? ready, "done");
    await waitFor(() => desktop.app.store.indexes.tasks.get(taskId)?.status === "done", "The task change did not arrive.");
    release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(current(), false, "the older full load does not bring back the task in review");
    if (side === "executor") assert.equal(status(), "done");
  });
});

test("pairing that cannot reach the computer says so instead of calling the code wrong", async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const phone = await bootApp(new URL(fixture.phoneUrl).origin, 390, []); t.after(() => dispose(phone.app));
  phone.app.api.fetch = async () => { throw new TypeError("fetch failed"); };
  typeInput(phone.root.querySelector("[data-home-code]"), "K7P4QX", 6, 6);
  for (const handler of phone.root.querySelector("[data-code-entry]").listeners.get("submit") ?? []) handler({ preventDefault() {} });
  await waitFor(() => phone.root.querySelector(".phone-code-error"), "Pairing did not report the failure.");
  assert.equal(phone.root.querySelector(".phone-code-error").textContent, "The phone could not reach this computer. Check the connection and try again.");
  assert.notEqual(phone.root.querySelector("[data-phone-state]").getAttribute("data-phone-state"), "error");
});

test("the older messages of a long conversation can be reached, not only loaded", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  const path = `/chats/${encodeURIComponent(chat.id)}/messages`;
  for (let index = 1; index <= 100; index += 1) {
    const body = `Line ${String(index).padStart(3, "0")}`;
    await request(api, "POST", path, { operation: createOperation({ method: "POST", path, body: { body, subject: "", replyTo: null, attachments: [], priority: "normal" } }) });
  }
  navigate(desktop.app, "chats");
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.app.thread?.chat?.id === chat.id && desktop.root.querySelector("[data-composer]"), "The chat did not open.");
  await waitFor(() => desktop.app.thread.messages.length >= 40 && desktop.root.querySelector(".bubble"), "The messages did not load.");
  const first = () => desktop.app.thread.messages.find((message) => message.body === "Line 001")?.id;
  const visible = () => [...desktop.root.querySelectorAll("[data-message]")].map((node) => node.getAttribute("data-message"));
  for (let attempt = 0; attempt < 12 && !visible().includes(first()); attempt += 1) {
    const older = desktop.root.querySelector("[data-action='older']");
    if (!older) break;
    click(older);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(visible().includes(first()), "the first message of the conversation stays out of reach");
});

test("every loaded waiting item shows, and more load on request", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.status === "ready" && desktop.app.waitingList.items.length, "Waiting did not load.");
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]") && desktop.app.waitingList.status === "ready", "The waiting list did not open.");
  const sample = desktop.app.waitingList.items[0];
  desktop.app.waitingList.items = Array.from({ length: 100 }, (_, index) => ({ ...sample, id: `${sample.id}-${index}` }));
  desktop.app.waitingList.total = 140;
  desktop.app.waitingList.nextCursor = "next-page";
  renderShell(desktop.app);
  const surface = desktop.root.querySelector("[data-waiting-panel]");
  assert.equal(surface.querySelectorAll("[data-waiting-item]").length, 100, "every loaded item has its row");
  assert.ok(surface.querySelector("[data-action='waiting-more']"), "a list with more pages offers to show them");
});

test("an element's inline style is set through the object model, which the content policy allows", () => {
  const document = createTestDocument(1440).document;
  const node = element(document, "span", { class: "spinner", style: "width:15px;height:15px" });
  assert.equal(node.getAttribute("style"), null, "a style attribute would be blocked by style-src 'self'");
  assert.equal(node.style.cssText, "width:15px;height:15px");
});

test("a chat message shows its pictures as a carousel with its buttons, and the composer sends a picture and a link", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const assets = `/chats/${encodeURIComponent(chat.id)}/assets`;
  const upload = async () => (await request(api, "POST", assets, { operation: createOperation({ method: "POST", path: assets, body: { contentType: "image/png", bytesBase64: png.toString("base64") } }) })).data.id;
  const [first, second] = [await upload(), await upload()];
  const path = `/chats/${encodeURIComponent(chat.id)}/messages`;
  await request(api, "POST", path, { operation: createOperation({ method: "POST", path, body: { body: "The checkout screens", subject: "", replyTo: null, priority: "normal",
    attachments: [{ kind: "image", path: first, label: "Checkout" }, { kind: "image", path: second }, { kind: "link", path: "https://example.com/pr/1", label: "Pull request" }, { kind: "task", path: "project:shop:029" }] } }) });
  navigate(desktop.app, "chats");
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-gallery-stage]")?.querySelector("img"), "The picture did not load.");
  const gallery = desktop.root.querySelector("[data-gallery]");
  assert.equal(gallery.getAttribute("data-gallery"), "2");
  const picture = gallery.querySelector("[data-gallery-stage]").querySelector("img");
  assert.match(picture.getAttribute("src"), /^blob:/);
  assert.equal(picture.getAttribute("alt"), "Checkout");
  assert.equal(gallery.querySelector("[data-gallery-strip]").querySelectorAll("[data-gallery-index]").length, 2);
  click(gallery.querySelector("[data-gallery-view='grid']"));
  assert.ok(desktop.root.querySelector("[data-gallery-grid]"), "the grid replaces the carousel");
  const link = desktop.root.querySelector("[data-chat-action='link']");
  assert.deepEqual([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel"), link.children.at(-1).textContent], ["https://example.com/pr/1", "_blank", "noopener noreferrer", "Pull request"]);
  assert.ok(desktop.root.querySelector("[data-chat-action='task']"));

  click(desktop.root.querySelector("[data-action='attach']"));
  await waitFor(() => desktop.document.querySelector("[data-attach-dialog]"), "The attach dialog did not open.");
  let dialog = desktop.document.querySelector("[data-attach-dialog]");
  dialog.querySelector("[data-attach-link]").value = "https://example.com/spec";
  click(dialog.querySelector("[data-action='attach-link']"));
  await waitFor(() => desktop.root.querySelector("[data-composer-parts='1']"), "The link did not join the composer.");
  click(desktop.root.querySelector("[data-action='attach']"));
  await waitFor(() => desktop.document.querySelector("[data-attach-dialog]"), "The attach dialog did not open again.");
  dialog = desktop.document.querySelector("[data-attach-dialog]");
  const input = dialog.querySelector("[data-attach-images]");
  input.files = [new File([png], "shot.png", { type: "image/png" })];
  for (const handler of input.listeners.get("change") ?? []) handler({});
  await waitFor(() => desktop.app.thread.parts?.length === 2 && desktop.app.thread.parts.every((part) => part.path), "The picture did not upload.");
  click(desktop.root.querySelector("[data-action='send']"));
  await waitFor(() => desktop.app.thread.messages.some((message) => !message.pending && message.attachments?.length === 2 && message.fromId === "root:master"), "The parts were not sent.");
  const sent = desktop.app.thread.messages.find((message) => !message.pending && message.attachments?.length === 2);
  assert.deepEqual(sent.attachments.map((part) => part.kind), ["link", "image"]);
  assert.equal(sent.body, "");
  assert.equal(desktop.root.querySelector("[data-composer-parts]"), null, "the composer is empty after sending");
  await waitFor(() => desktop.root.querySelectorAll("[data-gallery]").length === 2, "The sent picture did not show.");
});

async function startMenuDesktop(t) {
  let desktop, server;
  t.after(async () => {
    if (desktop?.app) dispose(desktop.app);
    if (server) await server.close();
  });
  const state = await makePlanFixture(t, { count: 2, task: false });
  state.context.ledger = openLedger({ store: state.store, paths: state.context.paths, now: state.context.now, machine: state.machine });
  state.context.projects = [];
  const credentials = createCredentialStore({ now: state.context.now });
  state.context.settingsOwner = createSettingsOwner({ ...state.context, probeAgents: async () => ({}) });
  server = await createHttpServer({ ...state.context, credentials }); state.context.bus = server.bus;
  const token = credentials.issue({ audience: 'desktop', capabilities: DESKTOP.filter(capability => capability !== 'viewer.write') }).token;
  const calls = [];
  desktop = await bootWithFetch(`http://127.0.0.1:${server.port}/#session=${token}`, 1440, (input, init) => {
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : null });
    return fetch(input, init);
  }, { clock: state.context.now });
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.activeHandlers && desktop.app.mapState, 'The actual core tree did not load.');
  desktop.app.startDialog?.dialog.close();
  return { ...desktop, state, calls };
}

test('agents picked in the Hierarchy are deleted in one background job with a bar, and Undo brings them back', async t => {
  const { root, app, document, state, calls } = await startMenuDesktop(t);
  const [first, second] = state.units;
  const pick = (unit, how = { toggle: true }) => app.activeHandlers.onPick({ id: unit.id, kind: 'unit', unit: unitOf(app, unit.id) }, how);
  pick(first); pick(second);
  assert.equal(root.querySelector('[data-pick-bar]')?.getAttribute('data-pick-bar'), '2');
  root.querySelector('[data-action="delete-picked"]').listeners.get('click')[0]();
  const dialog = document.querySelector('[data-delete-many]');
  assert.equal(dialog.getAttribute('data-delete-many'), '2');
  dialog.querySelector('.primary').listeners.get('click')[0]();
  // The dialog closes at once and both agents leave the screen; the job runs in Activity.
  await waitFor(() => !document.querySelector('[data-delete-many]'), 'The dialog did not close at once.');
  assert.equal(app.unitList.catalog.filter(unit => [first.id, second.id].includes(unit.id) && !unit.removed).length, 0);
  await waitFor(() => root.querySelector("[data-action='map-undo']"), 'The deletions did not finish.');
  assert.equal(calls.filter(call => call.method === 'DELETE' && call.path.includes('/units/')).length, 2);
  const job = app.queue.items.find(item => item.kind === 'delete');
  assert.equal(job.state, 'done'); assert.deepEqual(job.progress, { done: 2, total: 2 });
  // The bell lists the job.
  root.querySelector('[data-action="open-notifications"]').listeners.get('click')[0]();
  assert.ok(root.querySelector('[data-queue-panel]').querySelector(`[data-queue-item="${job.id}"]`));
  root.querySelector('[data-action="close-queue"]').listeners.get('click')[0]();
  root.querySelector("[data-action='map-undo']").listeners.get('click')[0]();
  await waitFor(() => app.queue.items.some(item => item.kind === 'undo' && item.state === 'done'), 'Undo did not run in Activity.');
  await waitFor(() => [first.id, second.id].every(id => app.unitList.catalog.some(unit => unit.id === id && !unit.removed)), 'Undo did not bring the agents back.');
});

test('a pick starts empty, the Map marks it, and the inspector shows it with the actions that fit what was picked', async t => {
  const desktop = await startMenuDesktop(t), { root, app, state } = desktop;
  const [first, second] = state.units;
  const pick = (row, how = { toggle: true }) => app.activeHandlers.onPick(row, how);
  const agentRow = unit => ({ id: unit.id, kind: 'unit', unit: unitOf(app, unit.id) });
  const clusterRow = id => ({ id: `cluster:${id}`, kind: 'cluster', groupId: id });
  for (const [id, title] of [['b', 'Bravo'], ['c', 'Charlie']]) app.store.indexes.groups.set(id, { id, title, parentId: null, members: [], link: { kind: 'repository' }, revision: 'x', chatId: `chat-${id}` });
  const panel = () => root.querySelector('[data-pick-inspector]');
  const actions = () => panel().querySelectorAll('[data-action]').map(node => node.getAttribute('data-action'));
  const kind = () => panel().querySelector('.agent-status').textContent;
  // The agent that is open is not part of the pick: the first Ctrl click picks only the row it lands on.
  app.store.selected.unitId = first.id; renderShell(app);
  pick(agentRow(second));
  assert.deepEqual([...app.hierarchySelection], [second.id]);
  assert.equal(panel(), null, 'one row is not a pick yet');
  pick(clusterRow('b')); pick(clusterRow('c'));
  assert.equal(app.hierarchySelection.size, 3, 'three Ctrl picks give three');
  assert.equal(app.mapState.picked, app.hierarchySelection);
  assert.ok(root.querySelector(`[data-unit-id='${second.id}']`).className.includes('is-picked'), 'the Map marks a picked agent');
  assert.ok(!root.querySelector(`[data-unit-id='${first.id}']`).className.includes('is-picked'));
  assert.ok(root.querySelector("[data-group-zone='b']").getAttribute('class').includes('is-picked'), 'and a picked cluster');
  assert.equal(root.querySelector('[data-pick-bar]').getAttribute('data-pick-bar'), '3', 'the floating bar stays');
  assert.equal(panel().getAttribute('data-pick-inspector'), '3');
  assert.equal(panel().querySelector('h2').textContent, '3 selected');
  assert.equal(kind(), 'Clusters and agents');
  assert.deepEqual(panel().querySelectorAll('.pick-item').map(node => node.getAttribute('data-pick-item')), ['Bravo', 'Charlie', displayName(second.unit)]);
  assert.deepEqual(panel().querySelectorAll('.pick-note').map(node => node.textContent), ['no agents', 'no agents', 'Executor']);
  assert.deepEqual(actions(), ['clear-pick', 'pick-message', 'pick-delete'], 'agents can be messaged as a group, but only a pick of agents alone can be moved');
  assert.equal(panel().querySelector('[data-action="pick-delete"]').textContent, 'Delete 3');
  // Clusters alone.
  app.hierarchySelection.delete(second.id); renderShell(app);
  assert.equal(kind(), 'Repository clusters');
  assert.deepEqual(actions(), ['clear-pick', 'pick-delete']);
  assert.equal(panel().querySelector('[data-action="pick-delete"]').textContent, 'Delete 2');
  app.store.indexes.groups.get('b').parentId = state.cluster.id; app.store.indexes.groups.get('c').parentId = state.cluster.id; renderShell(app);
  assert.equal(kind(), 'Repository clusters in Planning');
  // Agents alone.
  app.hierarchySelection.clear(); app.hierarchySelection.add(first.id); app.hierarchySelection.add(second.id); renderShell(app);
  assert.equal(kind(), 'Agents');
  assert.deepEqual(panel().querySelectorAll('.pick-note').map(node => node.textContent), ['Executor', 'Executor']);
  assert.deepEqual(actions(), ['clear-pick', 'pick-message', 'pick-move', 'pick-delete']);
  // The delete button asks once for everything picked, and the close button ends the pick.
  click(panel().querySelector('[data-action="pick-delete"]'));
  assert.equal(app.root.ownerDocument.querySelector('[data-delete-many]').getAttribute('data-delete-many'), '2');
  app.root.ownerDocument.querySelector('[data-delete-many]').querySelector('button').listeners.get('click')[0]();
  click(panel().querySelector('[data-action="clear-pick"]'));
  assert.equal(app.hierarchySelection.size, 0);
  assert.equal(panel(), null, 'the inspector shows the open agent again');
  // Escape ends a pick too, wherever the focus is.
  app.hierarchySelection.add(first.id); app.hierarchySelection.add(second.id); renderShell(app);
  assert.ok(panel());
  for (const handler of desktop.view.listeners.get('keydown') ?? []) handler({ key: 'Escape', target: root, preventDefault() {} });
  assert.equal(app.hierarchySelection.size, 0);
  assert.equal(panel(), null);
  // Spanish.
  app.language = 'es';
  app.hierarchySelection.add(first.id); app.hierarchySelection.add(second.id); renderShell(app);
  assert.equal(panel().querySelector('h2').textContent, '2 seleccionados');
  assert.equal(kind(), 'Agentes');
  assert.equal(panel().querySelector('[data-action="pick-delete"]').textContent, 'Eliminar 2');
  assertVisibleCopy('es', [['pick panel', panel().textContent]]);
});

test('agents picked together are moved to one cluster in one job, and messaged as a group', async t => {
  const { root, app, document, state } = await startMenuDesktop(t);
  const [first, second] = state.units, machine = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine;
  const other = (await fetch(`${app.api.location.origin}/api/v1/clusters`, { method: 'POST', headers: { authorization: `Bearer ${app.api.token}`, 'content-type': 'application/json', origin: app.api.location.origin, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ title: 'Elsewhere', parentId: null, link: { kind: 'none' }, machine, confirmed: true }) }).then(response => response.json())).data;
  await waitFor(() => app.store.indexes.groups.get(other.id), 'The second cluster did not load.');
  const pickBoth = () => { for (const unit of [first, second]) app.activeHandlers.onPick({ id: unit.id, kind: 'unit', unit: unitOf(app, unit.id) }, { toggle: true }); };
  pickBoth();
  click(root.querySelector('[data-pick-inspector]').querySelector('[data-action="pick-move"]'));
  const form = document.querySelector('[data-form="move-agent"]');
  assert.equal(form.querySelector('h2').textContent, 'Move 2 agents');
  const choices = form.querySelector('select').children.map(option => option.value);
  assert.ok(choices.includes(other.id) && !choices.includes(state.cluster.id), 'the cluster that holds all of them is not offered');
  form.querySelector('select').value = other.id;
  await clickAndWait(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => app.queue.items.some(item => item.kind === 'move' && item.state === 'done'), 'The move did not finish.');
  assert.equal(app.queue.items.filter(item => item.kind === 'move').length, 1, 'one job for all of them');
  assert.equal(app.queue.items.find(item => item.kind === 'move').label, 'Move 2 agents to Elsewhere');
  await waitFor(() => [first.id, second.id].every(id => app.store.indexes.groups.get(other.id)?.members.includes(id) && !app.store.indexes.groups.get(state.cluster.id)?.members.includes(id)), 'The cluster members did not change.');
  // Messaging them as a group clears the pick and opens one chat with both.
  app.hierarchySelection.clear(); pickBoth();
  click(root.querySelector('[data-pick-inspector]').querySelector('[data-action="pick-message"]'));
  assert.equal(app.hierarchySelection.size, 0);
  await waitFor(() => app.thread?.chat?.members?.includes(first.id) && app.thread.chat.members.includes(second.id), 'The group chat did not open.');
  assert.equal(root.querySelector('[data-pick-inspector]'), null);
});

test('the Map follows its stage while it shows the fitted view, and a stage too small to fit leaves the view as it is', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  const { app, root, document } = desktop, observers = [];
  desktop.view.ResizeObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe(host) { this.host = host; } disconnect() { this.disconnected = true; } };
  renderShell(app);
  const observer = observers.at(-1), host = observer.host, map = app.mapState;
  assert.equal(host, root.querySelector('.map'));
  assert.equal(map.autoFit, true, 'the first fit follows the stage');
  const stage = { left: 0, top: 0, width: 1000, height: 640 };
  host.getBoundingClientRect = () => stage;
  observer.callback();
  assert.deepEqual(map.view, clusterCamera(graphBounds(map), stage, 48, 1.15), 'a new size fits the graph again');
  const fitted = map.view;
  observer.callback();
  assert.equal(map.view, fitted, 'the same size fits nothing again');
  host.getBoundingClientRect = () => ({ ...stage, width: 80, height: 80 });
  observer.callback();
  assert.equal(map.view, fitted, 'a stage under 96 px is left alone');
  // The Fit item of the Map menu does not throw on a stage that small either.
  map.onContextMenu({ kind: 'map', x: 5, y: 5 });
  [...document.querySelector('[data-context-menu]').children].find(child => child.getAttribute('data-action') === 'context-fit').listeners.get('click')[0]();
  assert.equal(map.view, fitted);
  // Once the person zooms, the Map stays where it is.
  host.getBoundingClientRect = () => stage;
  wheelZoom(map, { clientX: 100, clientY: 100, deltaY: -1, preventDefault() {} }, stage);
  const zoomed = map.view;
  host.getBoundingClientRect = () => ({ ...stage, width: 1200 });
  observer.callback();
  assert.equal(map.view, zoomed);
  // A new drawing has a new stage: the old observer is let go and the new one watches it. A stage that starts at another size than the
  // one it replaces is fitted to, while the view is the fitted one.
  map.autoFit = true;
  renderShell(app);
  const next = observers.at(-1);
  assert.equal(observer.disconnected, true);
  assert.equal(next.host, root.querySelector('.map'));
  assert.notEqual(next, observer);
  next.callback();
  assert.deepEqual(map.view, clusterCamera(graphBounds(map), next.host.getBoundingClientRect(), 48, 1.15));
  const settled = map.view;
  next.callback();
  assert.equal(map.view, settled, 'the same stage is not fitted twice');
  // Leaving the Map lets go of the observer too.
  dispose(app);
  assert.equal(next.disconnected, true);
});

test('the Hierarchy ends with Services: a unit that exists opens its chat, one that does not offers to be set up, and the Map has no Services pills', async t => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  const { app, root } = desktop;
  assert.equal(root.querySelector('.map-services'), null);
  assert.equal(root.querySelector("[data-action='map-services']"), null);
  assert.equal(app.mapState.onServices, undefined);
  const services = () => app.activeRows.slice(app.activeRows.findIndex(row => row.id === 'section:services'));
  assert.deepEqual(services().map(row => row.id), ['section:services', 'root:incubator', 'root:genesis']);
  assert.equal(app.activeRows.at(-1).id, 'root:genesis', 'the section is last');
  const incubator = services()[1];
  app.activeHandlers.onActivate(incubator, 'double');
  await waitFor(() => app.inspectorData?.unitId === 'root:incubator' && app.store.selected.unitId === 'root:incubator', 'The Incubator did not open.');
  // A service nobody set up shows its name and a muted line, and is a row of its own.
  for (const shown of [app.unitList.catalog.find(unit => unit.id === 'root:genesis'), app.store.indexes.units.get('root:genesis')]) if (shown) shown.removed = true;
  renderShell(app);
  assert.deepEqual(services().map(row => row.id), ['section:services', 'root:incubator', 'service:genesis']);
  const row = root.querySelector("[data-service-row='genesis']");
  assert.ok(row);
  assert.equal(row.querySelector('.unit-original').textContent, 'Genesis');
  assert.equal(row.querySelector('.hierarchy-sub').textContent, 'Not set up');
  assert.equal(row.getAttribute('aria-disabled'), null);
  app.language = 'es'; renderShell(app);
  assert.equal(root.querySelector("[data-service-row='genesis']").querySelector('.hierarchy-sub').textContent, 'Sin configurar');
});

test('a service that is not set up opens the new agent form with its role chosen, and creates a root unit of that role', async t => {
  const desktop = await startCoreDesktop(t), { app, root, document } = desktop;
  click(document.querySelector("[data-action='cancel-agent']"));
  await waitFor(() => app.unitList?.status && root.querySelector("[data-service-row='incubator']"), 'The services did not show.');
  assert.deepEqual(app.activeRows.slice(-3).map(row => row.id), ['section:services', 'service:incubator', 'service:genesis']);
  // Services is a heading like Clusters: the same element and class, not a larger row title.
  const heading = root.querySelector("[data-id='section:services']");
  assert.deepEqual([heading.tag, heading.className, heading.children[0].textContent], ['div', 'my-groups-heading', 'Services']);
  click(root.querySelector("[data-service-row='incubator']"));
  await waitFor(() => document.querySelector("[data-start-dialog='agent']"), 'The form did not open.');
  const dialog = document.querySelector("[data-start-dialog='agent']");
  assert.equal(dialog.querySelector('h2').textContent, 'Set up Incubator');
  assert.equal(dialog.querySelectorAll('button').filter(node => node.getAttribute('data-action')?.startsWith('choose-')).length, 0, 'the role is not asked: it is the row\'s');
  assert.ok(dialog.querySelector("[data-action='open-runs-picker']"));
  click(dialog.querySelector("[data-action='create-agent']"));
  await waitFor(() => app.unitList.catalog.some(unit => unit.id === 'root:incubator'), 'The Incubator was not created.');
  await waitFor(() => !document.querySelector("[data-start-dialog='agent']"), 'The runtime choice did not finish saving.');
  const unit = (await request(app.api, 'GET', '/units/:unitId', { params: { unitId: 'root:incubator' } })).data;
  assert.equal(unit.role, 'incubator');
  assert.equal(unit.runsIn.client, 'codex', 'where it runs is set right after it is created');
  assert.equal(unit.clusterId ?? null, null, 'it belongs to no cluster');
  await waitFor(() => !root.querySelector("[data-service-row='incubator']") && app.activeRows.some(row => row.id === 'root:incubator'), 'The row did not become the unit.');
  assert.equal(root.querySelector("[data-service-row='genesis']") != null, true);
});

test('a cluster row keeps its whole name and shortens only its branch', async t => {
  const { root, app, state } = await startMenuDesktop(t);
  const cluster = { ...app.store.indexes.groups.get(state.cluster.id), title: 'E pet' };
  app.store.indexes.groups.set(cluster.id, cluster);
  app.clusterGit ??= new Map(); app.clusterGit.set(cluster.id, { revision: cluster.revision, git: { branch: 'checkpoint/scout-2026-10-12' } });
  renderShell(app);
  const [, , title, branch] = root.querySelector(`[data-cluster-row='${cluster.id}']`).children;
  assert.deepEqual([title.className, title.textContent, branch.className, branch.textContent], ['group-title', 'E pet', 'hierarchy-branch', 'checkpoint/scout-2026-10-12']);
});

test('a cluster with a cluster inside it is deleted with it, the inner one first', async t => {
  const { app, document, state, calls } = await startMenuDesktop(t);
  const parent = state.cluster;
  const machine = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine;
  const inner = (await fetch(`${app.api.location.origin}/api/v1/clusters`, { method: 'POST', headers: { authorization: `Bearer ${app.api.token}`, 'content-type': 'application/json', origin: app.api.location.origin, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ title: 'Inner', parentId: parent.id, link: { kind: 'none' }, machine, confirmed: true }) }).then(response => response.json())).data;
  await waitFor(() => app.store.indexes.groups.get(inner.id), 'The inner cluster did not load.');
  app.mapState.onContextMenu({ kind: 'cluster', id: parent.id, x: 10, y: 10 });
  [...document.querySelector('[data-context-menu]').children].find(child => child.getAttribute('data-action') === 'context-delete').listeners.get('click')[0]();
  const dialog = [...document.querySelectorAll('.dialog')].at(-1);
  assert.match(dialog.querySelector('p').textContent, /also deletes the cluster inside it/);
  dialog.querySelector('.primary').listeners.get('click')[0]();
  await waitFor(() => app.queue.items.some(item => item.kind === 'delete' && item.state === 'done'), 'The tree deletion did not finish.');
  const deletes = calls.filter(call => call.method === 'DELETE' && call.path.startsWith('/api/v1/clusters/')).map(call => call.path.split('/').at(-1));
  assert.deepEqual(deletes, [inner.id, parent.id]);
});

test('the right-click menu of an agent and of a cluster lists only what the state allows, from the Map and from the Hierarchy, and every entry opens its action', async t => {
  const { root, app, document, state, calls } = await startMenuDesktop(t);
  const menu = () => document.querySelector('[data-context-menu]');
  const actions = () => [...menu().children].filter(item => item.getAttribute('data-action')).map(item => item.getAttribute('data-action').replace('context-', ''));
  const choose = async id => { const item = [...menu().children].find(child => child.getAttribute('data-action') === `context-${id}`); item.listeners.get('click')[0](); await delay(0); };
  const member = state.units[1], clusterId = state.cluster.id;
  const openMenu = target => { app.mapState.onContextMenu({ ...target, x: 30, y: 40 }); return actions(); };

  assert.deepEqual(openMenu({ kind: 'unit', id: member.id }), ['open', 'start', 'rename', 'connect', 'new-report', 'details', 'remove', 'delete'], 'with one cluster there is nowhere to move an agent to');
  assert.ok(menu().children[0].className.includes('is-primary'), 'Open chat is the primary action');
  assert.equal(menu().getAttribute('aria-label'), `Actions for ${displayName(member.unit)}`);
  assert.match(menu().style.left, /px$/, 'the menu is placed');
  app.store.indexes.groups.set('other', { id: 'other', title: 'Elsewhere', parentId: null, members: [], link: { kind: 'none' }, revision: 'x', chatId: 'chat-other' });
  assert.ok(openMenu({ kind: 'unit', id: member.id }).includes('move'), 'a second cluster makes Move to cluster possible');
  await choose('move');
  await waitFor(() => document.querySelector('[data-form="move-agent"]'), 'Move to cluster did not open.');
  assert.equal(document.querySelector('[data-form="move-agent"]').querySelector('select').value, 'other');
  document.querySelector('[data-form="move-agent"]').querySelector('[data-action="cancel-form"]').listeners.get('click')[0]();
  app.store.indexes.groups.delete('other');

  // Rename, Details, Connect and Start open the same places the inspector opens.
  openMenu({ kind: 'unit', id: member.id }); await choose('rename');
  assert.equal(app.aliasEdit?.id, member.id);
  app.aliasEdit = null;
  openMenu({ kind: 'unit', id: member.id }); await choose('details');
  assert.equal(app.store.selected.unitId, member.id);
  await waitFor(() => document.querySelector(`[data-disclosure="agent-controls:${member.id}"]`)?.getAttribute('open') !== null, 'Details did not open.');
  openMenu({ kind: 'unit', id: member.id }); await choose('connect');
  await waitFor(() => document.querySelector('[data-form="selection-lead"]'), 'Connect to did not ask for a lead.');
  document.querySelector('[data-form="selection-lead"]').querySelector('[data-action="cancel-form"]').listeners.get('click')[0]();
  openMenu({ kind: 'unit', id: member.id }); await choose('start');
  await waitFor(() => document.querySelector('[data-form="session"]'), 'Start did not open the session form.');
  document.querySelector('[data-form="session"]').querySelector('[data-action="cancel-form"]').listeners.get('click')[0]();

  // Delete asks first, as the inspector does; Remove takes the agent out of its cluster and nothing else.
  openMenu({ kind: 'unit', id: member.id }); await choose('delete');
  await waitFor(() => document.querySelector('[data-remove-unit]'), 'Delete did not ask for confirmation.');
  assert.equal(calls.some(call => call.method === 'DELETE' && call.path.includes('/units/')), false);
  document.querySelector('[data-remove-unit]').querySelector('button').listeners.get('click')[0]();
  openMenu({ kind: 'unit', id: member.id }); await choose('remove');
  await waitFor(() => document.querySelector('.dialog'), 'Remove did not ask for confirmation.');
  assert.match(document.querySelector('.dialog').querySelector('h2').textContent, /Remove .* from Planning\?/);
  await clickAndWait(document.querySelector('.dialog').querySelector('.primary'));
  await waitFor(() => calls.some(call => call.method === 'PATCH' && call.path === `/api/v1/groups/${clusterId}`), 'Remove did not reach the service.');
  const patched = calls.find(call => call.method === 'PATCH' && call.path === `/api/v1/groups/${clusterId}`);
  assert.deepEqual(patched.body.members, state.units.filter(unit => unit.id !== member.id).map(unit => unit.id));

  // A cluster: open, add an agent, rename, collapse on the Map and delete.
  assert.deepEqual(openMenu({ kind: 'cluster', id: clusterId }), ['open', 'new-agent', 'rename', 'collapse', 'delete']);
  await choose('collapse');
  await waitFor(() => !app.mapState.inFlight && !app.mapState.refreshing && app.mapState.pendingGroups.size === 0, 'The collapsed Map cluster did not finish saving.');
  assert.equal(app.mapState.saved.groups[`cluster:${clusterId}`].collapsed, true);
  assert.equal(openMenu({ kind: 'cluster', id: clusterId }).includes('collapse'), true);
  assert.equal([...menu().children].find(child => child.getAttribute('data-action') === 'context-collapse').textContent, 'Expand');
  await choose('collapse');
  await waitFor(() => !app.mapState.inFlight && !app.mapState.refreshing && app.mapState.pendingGroups.size === 0, 'The expanded Map cluster did not finish saving.');
  assert.equal(app.mapState.saved.groups[`cluster:${clusterId}`].collapsed, false);
  openMenu({ kind: 'cluster', id: clusterId }); await choose('rename');
  await waitFor(() => document.querySelector('[data-form="cluster-rename"]'), 'Rename did not open.');
  const field = document.querySelector('[data-form="cluster-rename"]').querySelector('input');
  assert.equal(field.value, 'Planning');
  typeInput(field, 'Shipping', 8, 8);
  await clickAndWait(document.querySelector('[data-form="cluster-rename"]').querySelector('[data-action="confirm-form"]'));
  await waitFor(() => calls.some(call => call.method === 'PATCH' && call.body?.title === 'Shipping'), 'Rename did not reach the service.');
  openMenu({ kind: 'cluster', id: clusterId }); await choose('new-agent');
  await waitFor(() => app.startDialog, 'New agent here did not open its form.');
  app.startDialog.dialog.close();

  // The empty Map has its own menu, and a connection dropped on empty space offers a new agent that reports to its source.
  const mapItems = openMenu({ kind: 'map', groupId: null });
  assert.ok(['new-agent', 'new-cluster', 'fit'].every(id => mapItems.includes(id)), mapItems.join());
  assert.equal(menu().getAttribute('aria-label'), 'Map actions');
  await choose('fit');
  app.mapState.onConnectDrop({ source: member.id, x: 50, y: 60, groupId: null });
  assert.deepEqual(actions(), ['new-overlord', 'new-executor', 'new-custom']);
  assert.match(menu().querySelector('[data-context-title]').textContent, /reporting to/);
  await choose('new-overlord');
  await waitFor(() => app.startDialog, 'New Overlord did not open its form.');
  assert.equal(app.startDialog.model.role, 'overlord');
  assert.equal(app.startDialog.model.leadId, member.id);
  assert.ok(app.startDialog.dialog.querySelector('[data-start-lead]'), 'the form names the lead');
  app.startDialog.dialog.close();
  openMenu({ kind: 'cluster', id: clusterId }); await choose('delete');
  await waitFor(() => [...document.querySelectorAll('.dialog')].some(dialog => /^Delete: /.test(dialog.querySelector('h2')?.textContent ?? '')), 'Delete did not ask for confirmation.');

  // The Hierarchy offers the same menu on its rows, from the mouse and from the keyboard. A cluster starts folded there, so its entry reads Expand.
  const listOf = () => root.querySelector('[data-collection]');
  const rowNode = id => [...listOf().children].find(node => node.getAttribute?.('data-id') === id);
  const prevented = [];
  const clusterRow = app.activeRows.find(item => item.kind === 'cluster' && item.groupId === clusterId);
  assert.ok(rowNode(clusterRow.id), 'the cluster row is drawn');
  listOf().listeners.get('contextmenu')[0]({ type: 'contextmenu', target: rowNode(clusterRow.id), clientX: 70, clientY: 90, preventDefault: () => prevented.push(true) });
  assert.equal(prevented.length, 1);
  assert.deepEqual(actions(), ['open', 'new-agent', 'rename', 'collapse', 'delete']);
  assert.equal([...menu().children].find(child => child.getAttribute('data-action') === 'context-collapse').textContent, 'Expand');
  await choose('collapse');
  assert.equal(app.hierarchy.collapsed.has(`cluster:${clusterId}`), false, 'Expand opens the folded row');
  const unitRow = app.activeRows.find(item => item.unit?.id === state.units[0].id);
  assert.ok(unitRow && rowNode(unitRow.id), 'the agents of the cluster are listed now');
  for (const handler of listOf().listeners.get('keydown')) handler({ type: 'keydown', key: 'F10', shiftKey: true, target: rowNode(unitRow.id), preventDefault: () => prevented.push(true) });
  assert.equal(prevented.length, 2);
  assert.deepEqual(actions().slice(0, 2), ['open', 'start']);
  assert.match(menu().style.top, /px$/);
});

test('the Hierarchy list says it is loading only while it has nothing to show, and says it once', async t => {
  const { app, root } = await startMenuDesktop(t);
  app.unitList.status = 'loading';
  renderShell(app);
  let total = root.querySelector('.list-total');
  assert.equal(total.getAttribute('data-list-status'), 'loading');
  assert.ok(total.className.includes('visually-hidden'), 'rows are drawn, so a reload behind them says nothing');
  assert.equal(root.querySelectorAll('[data-list-progress]').length, 0);
  app.unitList.catalog = []; app.unitList.items = [];
  app.store.indexes.units.clear(); app.store.indexes.groups.clear();
  renderShell(app);
  total = root.querySelector('.list-total');
  assert.equal(total.textContent, '', 'the list total holds no sentence of its own');
  assert.equal(root.querySelector('[data-list-progress]').getAttribute('aria-label'), 'Loading the list.', 'the one mark carries the sentence');
  assert.equal(root.querySelectorAll('[data-list-progress]').length, 1);
  assert.ok(root.querySelector('[data-list-progress]').className.includes('skeleton-rows'), 'the list shows the rows to come');
  assert.equal(total.className.includes('visually-hidden'), false);
  assert.equal(root.querySelector('[data-collection]').getAttribute('aria-busy'), 'true');
});

test('a redraw waits while the person scrolls, once, and happens when the scrolling stops', async t => {
  const { app, root } = await startMenuDesktop(t);
  const before = root.querySelector('[data-collection]');
  for (const handler of root.listeners.get('wheel')) handler({ type: 'wheel' });
  renderShell(app); renderShell(app);
  assert.equal(root.querySelector('[data-collection]'), before, 'the list is not replaced under a scroll');
  assert.ok(app.scrollRedraw, 'one redraw waits');
  await waitFor(() => root.querySelector('[data-collection]') !== before, 'The redraw did not happen once the scrolling stopped.');
  assert.equal(app.scrollRedraw, null);
});

test('a button that starts an action shows a loader while it runs, again after a redraw, and is released when it ends', async () => {
  const { document, root } = createTestDocument(1440);
  let finish;
  const work = new Promise(resolve => { finish = resolve; });
  const button = element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'load-demo', text: 'Load', onclick: () => work });
  root.append(button);
  click(button);
  assert.equal(button.getAttribute('data-busy'), 'true');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.disabled, true);
  // The shell draws again: the new button for the same action shows the same loader.
  const twin = element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'load-demo', text: 'Load', onclick: () => work });
  root.replaceChildren(twin);
  restoreRunning(root);
  assert.equal(twin.getAttribute('data-busy'), 'true');
  assert.equal(twin.disabled, true);
  finish();
  await delay(0);
  assert.equal(button.getAttribute('data-busy'), null);
  assert.equal(button.disabled, false);
  // A button that was disabled before stays disabled afterwards.
  const off = element(document, 'button', { type: 'button', class: 'btn', 'data-action': 'off-demo', text: 'Off', onclick: () => Promise.resolve() });
  off.disabled = true;
  click(off);
  await delay(0);
  assert.equal(off.disabled, true);
});

test('the same failure is one notice with one Retry, the sentence reads whole and slow requests are one notice', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  desktop.app.language = 'es';
  const timeout = new ApiError(0, 'timeout', 'The request timed out.');
  desktop.app.activity = new Map([
    ['chat-load:a', { key: 'chat-load:a', phase: 'error', scope: 'unit', action: 'Cargando la conversación.', label: 'Cargando la conversación.', error: timeout, retry: () => Promise.resolve() }],
    ['inspector:b', { key: 'inspector:b', phase: 'error', scope: 'unit', action: 'Cargando overseer.', label: 'Cargando overseer.', error: timeout, retry: () => Promise.resolve() }],
    ['older:c', { key: 'older:c', phase: 'pending', scope: 'unit', label: 'Mensajes anteriores', elapsed: 3 }],
    ['older:d', { key: 'older:d', phase: 'pending', scope: 'unit', label: 'Mensajes anteriores', elapsed: 5 }],
  ]);
  renderShell(desktop.app);
  const region = desktop.root.querySelector('[data-activity-region]');
  assert.equal(region.querySelectorAll('[data-action="retry-activity"]').length, 1);
  assert.equal(region.querySelectorAll('.notice-error').length, 1);
  assert.equal(region.querySelectorAll('.slow-notice').length, 1);
  assert.equal(region.querySelectorAll('[data-action="cancel-activity"]').length, 1);
  assert.match(region.querySelector('[data-activity-count]').children[0].textContent, /^2 solicitudes fallaron\. La solicitud agotó el tiempo\./);
  desktop.app.activity.delete('inspector:b');
  renderShell(desktop.app);
  const single = desktop.root.querySelector('[data-activity-count]').children[0].textContent;
  assert.equal(single.includes('. falló'), false);
  assert.match(single, /^Cargando la conversación falló\. /);
});

test('an Overseer that holds state does not say it starts fresh', () => {
  assert.equal(startsFresh({ role: 'overseer', fresh: true }), true);
  assert.equal(startsFresh({ role: 'overseer', fresh: true, unread: 363 }), false);
  assert.equal(startsFresh({ role: 'overseer', fresh: true, sessionIds: ['s1'] }), false);
  assert.equal(startsFresh({ role: 'overseer', fresh: false }), false);
  assert.equal(startsFresh({ role: 'executor', fresh: true }), false);
});

test('an unread conversation says it could not be read instead of saying it has no messages', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.thread = createThread(chat);
  desktop.app.store.selected.chatId = chat.id;
  desktop.app.activity = new Map([[`chat-load:${chat.id}`, { key: `chat-load:${chat.id}`, phase: 'error', scope: 'unit', label: 'Loading', error: new ApiError(0, 'timeout', 'x'), retry() {} }]]);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-empty="chat"]'), null);
  assert.ok(desktop.root.querySelector('[data-empty="unread"]'));
  desktop.app.activity.set(`chat-load:${chat.id}`, { key: `chat-load:${chat.id}`, phase: 'pending', scope: 'unit', label: 'Loading', elapsed: 0 });
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-empty="chat"]'), null);
  assert.ok(desktop.root.querySelector('[data-loading="chat"]').className.includes('skeleton-chat'), 'the conversation shows the messages to come');
});

test('the inspector keeps its scroll position when the shell draws again', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  renderShell(desktop.app);
  desktop.root.querySelector('.panel.inspector').scrollTop = 180;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('.panel.inspector').scrollTop, 180);
});

test('the Overseer, a project executor and a conversation with each are created through the calls the interface makes', async t => {
  const desktop = await startCoreDesktop(t), { app } = desktop;
  app.startDialog?.dialog.close();
  const machine = app.store.settings?.service?.machine ?? app.store.view?.mind?.machine;
  const agents = (await request(app.api, 'GET', '/settings/agents', { query: { machine } })).data;
  const runsIn = initialRunsIn(agents.connectedClients, agents.defaultRunsIn, null);
  assert.ok(runsIn, 'a connected client offers a runtime');
  // The Overseer and its first message.
  const overseer = await startApi.createOverseer(app.api, { machine, runsIn, fresh: true, expectedRevision: null });
  assert.equal(overseer.data.id, 'root:overseer');
  const overseerChat = await openDirectChat(app.api, [overseer.data.id]);
  const overseerThread = createThread(overseerChat.data);
  await postMessage(app.api, overseerThread, { body: 'Hello Overseer' });
  assert.ok(overseerThread.messages.some(message => message.body === 'Hello Overseer'));
  // A cluster, its executor and the first message to it.
  const cluster = await startApi.createCluster(app.api, { title: 'Shop', parentId: null, link: { kind: 'none' }, machine });
  const executor = await startApi.createClusterAgent(app.api, cluster.data.id, { machine, role: 'executor', roleName: '', roleDescription: '', runsIn, useAsDefault: false, expectedRevision: cluster.data.revision });
  assert.equal(executor.data.role, 'executor');
  const executorChat = await openDirectChat(app.api, [executor.data.id]);
  const executorThread = createThread(executorChat.data);
  await postMessage(app.api, executorThread, { body: 'Hello executor' });
  assert.ok(executorThread.messages.some(message => message.body === 'Hello executor'));
  // The same chat is found again, not created twice.
  const again = await openDirectChat(app.api, [executor.data.id]);
  assert.equal(again.data.id, executorChat.data.id);
  // Removing the executor takes it out of the list of units without a reload of the page.
  reloadList(app.unitList);
  await waitFor(() => app.unitList.status === 'ready' && app.unitList.catalog.some(unit => unit.id === executor.data.id), 'The new executor did not join the list of units.');
  await removeUnit(app.api, executor.data);
  reloadList(app.unitList);
  await waitFor(() => app.unitList.status !== 'loading' && !app.unitList.catalog.some(unit => unit.id === executor.data.id), 'The removed executor stayed in the list of units.');
});

test('a tab whose service stopped says so and how to open it again instead of a slow drive', async t => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const { root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  const app = await mount(root, {
    location: url, history: { replaceState() {} }, mindPath: 'C:\Minds\Shop',
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  t.after(() => dispose(app));
  await waitFor(() => app.bootStopped === true, 'The stopped service was not recognised.');
  assert.equal(root.querySelector('.opening-failure').children[1].textContent, 'The service stopped');
  const cause = root.querySelector('[data-opening-cause]').textContent;
  assert.match(cause, /onem1nd service install --mind-path "C:\Minds\Shop"/);
  assert.equal(cause.includes('30 s'), false);
});


test('the agent menu offers to remove the agent and asks before removing it', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  const executor = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mapState.selection = new Set([executor.id]);
  desktop.app.mapState.onSelection([executor.id]);
  renderShell(desktop.app);
  click(desktop.root.querySelector('[data-action="agent-more"]'));
  const remove = desktop.document.querySelector('[data-action="context-agent-remove"]');
  assert.ok(remove, 'the agent menu has a Remove agent button');
  click(remove);
  const dialog = desktop.document.querySelector('[data-remove-unit]');
  assert.ok(dialog, 'removal asks for confirmation');
  assert.equal(dialog.querySelector('button.primary').textContent, 'Remove agent');
  click(dialog.querySelector('button'));
});

test('a request is called slow only after five seconds; before that the button loader is enough', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.slowNoticeAfterS = undefined;
  desktop.app.mode = 'map';
  if (!desktop.app.activity) desktop.app.activity = new Map();
  desktop.app.activity.set('older:shop', { key: 'older:shop', phase: 'pending', scope: 'unit', label: 'Loading earlier messages', elapsed: 4 });
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('.slow-notice'), null, 'four seconds is not slow');
  desktop.app.activity.get('older:shop').elapsed = 5;
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('.slow-notice'), 'five seconds is');
});

test('a failure notice can be closed without retrying', async t => {
  const desktop = await openedDesktop(t);
  desktop.app.mode = 'map';
  if (!desktop.app.activity) desktop.app.activity = new Map();
  desktop.app.activity.set('older:shop', { key: 'older:shop', phase: 'error', scope: 'unit', label: 'Loading earlier messages', error: { code: 'timeout' } });
  renderShell(desktop.app);
  const close = desktop.root.querySelector('[data-action="dismiss-activity"]');
  assert.ok(close, 'the failure has a close button');
  click(close);
  assert.equal(desktop.root.querySelector('[data-action="dismiss-activity"]'), null);
  assert.equal(desktop.app.activity.has('older:shop'), false);
});

function unitOf(app, id) { return app.unitList.catalog.find(unit => unit.id === id); }

// A window keydown, as the browser sends it to every listener the shell attached to the window.
function pressKey(desktop, key, target = { tagName: "BODY" }) {
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key, target, preventDefault() {} });
}

test("Waiting opens in the inspector column beside the Map; a review names its task, project and day, opens in place and folds", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.items?.some((item) => item.taskId === "project:shop:029"), "The review task did not load.");
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]") && desktop.app.waitingList.status === "ready", "The Waiting panel did not open.");
  assert.ok(desktop.root.querySelector(".inspector-body").querySelector("[data-waiting-panel]"), "Waiting is in the inspector column");
  assert.ok(desktop.root.querySelector(".stage").querySelector(".map"), "the stage keeps the Map");
  assert.equal(desktop.root.querySelector("[data-waiting-surface]"), null);
  assert.match(desktop.root.querySelector("[data-waiting-panel]").querySelector("h2").textContent, /waiting on you$/);
  // The task has no title line: the engine names it from its file, and the row adds its project and day.
  const review = desktop.app.waitingList.items.find((item) => item.taskId === "project:shop:029");
  Object.assign(review, { title: "Media to disk and webp", since: "2026-10-19" });
  renderShell(desktop.app);
  const row = desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:shop:029']");
  assert.equal(row.querySelector(".waiting-row-title").textContent, "Media to disk and webp");
  assert.equal(row.querySelector(".waiting-row-meta").textContent, "Shop, task 029, Oct 19");
  assert.match(desktop.root.querySelector("[data-waiting-panel]").querySelector("p").textContent, /^From /, "asks and reviews together are only said to come from projects");
  Object.assign(review, { title: "" });
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:shop:029']").querySelector(".waiting-row-title").textContent, "Task 029", "a review with no title at all still names itself");
  Object.assign(review, { title: "Media to disk and webp" });
  click(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:shop:029']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-open]") && desktop.app.waitingRecord?.task, "The review did not open in place.");
  desktop.app.waitingRecord.task.request = `${"Old uploads move to the media folder as optimized WebP. ".repeat(8)}\n\nA second paragraph that stays out.`;
  renderShell(desktop.app);
  const open = desktop.root.querySelector("[data-waiting-open='review:project:shop:029']");
  assert.match(open.querySelector(".waiting-row-meta").textContent, /^Shop, task 029, delivered Oct 19 by /);
  const request = open.querySelector(".waiting-request").textContent;
  assert.ok(request.length <= 241 && request.endsWith("…") && !request.includes("second paragraph"), "the first paragraph, cut at a word with an ellipsis");
  assert.ok(open.querySelector("[data-action='accept']") && open.querySelector("[data-action='send-back']") && open.querySelector("[data-action='open-task']"));
  // The note is asked for only once Send back is pressed: the first press shows and focuses it, the second sends it.
  const opened = () => desktop.root.querySelector("[data-waiting-open]"), sendBack = () => opened().querySelector("[data-action='send-back']"), note = () => opened().querySelector("[data-note]");
  assert.notEqual(note().closest("label").getAttribute("hidden"), null, "the note is not shown before Send back is pressed");
  assert.equal(sendBack().disabled, false, "Send back can be pressed with no note yet");
  click(sendBack());
  assert.equal(note().closest("label").getAttribute("hidden"), null, "the first press shows the note");
  assert.equal(desktop.document.activeElement, note(), "and focuses it");
  assert.equal(sendBack().disabled, true, "Send back keeps its required note");
  renderShell(desktop.app);
  assert.equal(note().closest("label").getAttribute("hidden"), null, "a redraw keeps the note shown");
  typeInput(note(), "Needs another pass", 0, 18);
  assert.equal(sendBack().disabled, false, "with a note the second press can send");
  assert.equal(desktop.root.querySelectorAll("[data-waiting-open]").length, 1, "one row is open at a time");
  click(open.querySelector("[data-waiting-item]"));
  assert.equal(desktop.app.waitingRecord, null);
  assert.equal(desktop.root.querySelector("[data-waiting-open]"), null, "the header of the open row folds it");
  const reviews = (...ids) => ids.map((id) => ({ ...review, id: `review:${id}`, taskId: id, unitId: null }));
  const sub = () => desktop.root.querySelector("[data-waiting-panel]").querySelector("p").textContent;
  desktop.app.waitingList.items = reviews("project:alpha:001");
  renderShell(desktop.app);
  assert.equal(sub(), "Reviews from Alpha");
  desktop.app.waitingList.items = reviews("project:alpha:001", "project:beta:002", "project:gamma:003", "project:alpha:004");
  renderShell(desktop.app);
  assert.equal(sub(), "Reviews from Alpha, Beta and Gamma");
  desktop.app.waitingList.items = reviews("project:alpha:001", "project:beta:002", "project:gamma:003", "project:delta:004");
  renderShell(desktop.app);
  assert.equal(sub(), "Reviews from Alpha, Beta, Gamma and 1 more");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(sub(), "Revisiones de Alpha, Beta, Gamma y 1 más");
  assert.equal(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:alpha:001']").querySelector(".waiting-row-meta").textContent, "Alpha, tarea 001, 19 oct");
});

test("Waiting closes with the Map button, with Escape unless a dialog is open, and when something else is picked", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.waitingList?.items?.length, "The lists did not load.");
  const pill = () => desktop.root.querySelector("[data-action='waiting']");
  click(pill());
  assert.ok(desktop.root.querySelector("[data-waiting-panel]"));
  click(desktop.root.querySelector("[data-action='mode-map']"));
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null, "the Map button closes Waiting");
  click(pill());
  const dialog = desktop.document.createElement("dialog");
  dialog.setAttribute("open", "");
  desktop.document.body.append(dialog);
  pressKey(desktop, "Escape");
  assert.ok(desktop.root.querySelector("[data-waiting-panel]"), "Escape belongs to the dialog while one is open");
  dialog.remove();
  pressKey(desktop, "Enter");
  assert.ok(desktop.root.querySelector("[data-waiting-panel]"));
  pressKey(desktop, "Escape");
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null, "Escape closes Waiting");
  assert.equal(pill().getAttribute("aria-pressed"), "false");
  click(pill());
  click(desktop.root.querySelector("[data-action='waiting-close']"));
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null, "the close button closes it too");
  click(pill());
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "single");
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null, "picking an agent shows the agent");
});

test("the phone button opens a panel under the bar, not Settings: a closed access offers 12 hours, an open one shows its code, and a click outside closes it", async (t) => {
  const fixture = await createGuiFixture({ now: new Date().toISOString() });
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, "The lists did not load.");
  const panel = () => desktop.root.querySelector("[data-phone-panel]");
  const state = () => panel().querySelector("[data-phone-state]");
  click(desktop.root.querySelector("[data-action='open-phone']"));
  assert.equal(desktop.app.mode, "map", "the phone button does not go to Settings");
  assert.ok(panel());
  assert.equal(panel().querySelector("h2").textContent, "Open on the phone");
  assert.equal(panel().querySelector(".phone-panel-esc").textContent, "Esc closes");
  // The access this fixture starts with is open, and the screen holds no code for it.
  assert.equal(state().getAttribute("data-phone-state"), "open");
  assert.match(state().textContent, /^Open until \d\d:\d\d$/);
  assert.equal(panel().querySelector(".qr"), null);
  assert.equal(panel().querySelector(".phone-panel-note").textContent, "Open home access on this screen to show a new code.");
  click(panel().querySelector("[data-action='phone-close-home']"));
  await waitFor(() => panel()?.querySelector("[data-action='phone-open-home']"), "Closing the access did not show it closed.");
  assert.equal(state().getAttribute("data-phone-state"), "closed");
  assert.equal(state().textContent, "Home access is closed");
  assert.equal(panel().querySelector(".phone-panel-note").textContent, text("en", "finalPhoneHint"));
  assert.equal(panel().querySelector("[data-action='phone-open-home']").textContent, "Open for 12 hours");
  assert.equal(panel().querySelector("[data-action='phone-close-home']"), null);
  assert.equal(panel().querySelector(".qr"), null);
  click(panel().querySelector("[data-action='phone-open-home']"));
  await waitFor(() => panel()?.querySelector(".qr"), "The code did not appear.");
  assert.equal(panel().querySelector("[data-code]").textContent.length, 6, "the short code stays under the code");
  assert.match(state().textContent, /^Open until \d\d:\d\d$/);
  assert.equal(panel().querySelector("[data-action='phone-copy-link']").textContent, "Copy the link");
  assert.deepEqual(panel().querySelector(".phone-panel-scan").children.filter((node) => node.tag === "p").map((node) => node.textContent), ["Scan with the phone on the same network.", "Access closes after 12 hours."]);
  assert.equal(panel().querySelector("[data-action='phone-open-home']"), null);
  assert.equal(panel().querySelector("[data-action='phone-close-home']").textContent, "Close access");
  // A click on the panel or on its button leaves it open; one anywhere else closes it.
  const outside = (target) => { for (const handler of desktop.root.listeners.get("click") ?? []) handler({ target }); };
  outside(panel().querySelector("h2"));
  outside(desktop.root.querySelector("[data-action='open-phone']"));
  assert.ok(panel());
  outside(desktop.root.querySelector(".stage"));
  assert.equal(panel(), null);
  click(desktop.root.querySelector("[data-action='open-phone']"));
  assert.ok(panel().querySelector(".qr"), "the code is still there while the access is open and the screen has not changed");
  click(panel().querySelector("[data-action='phone-close-home']"));
  await waitFor(() => panel()?.querySelector("[data-action='phone-open-home']") && !panel().querySelector(".qr"), "Closing the access did not show it closed.");
  assert.equal(state().textContent, "Home access is closed");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(panel().querySelector("[data-action='phone-open-home']").textContent, "Abrir por 12 horas");
  assert.equal(state().textContent, "El acceso desde casa está cerrado");
  assert.equal(panel().querySelector(".phone-panel-esc").textContent, "Esc cierra");
  click(desktop.root.querySelector("[data-action='open-phone']"));
  assert.equal(panel(), null, "the button also closes the panel");
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.phone-panel \{[^}]*position: fixed;[^}]*top: 56px;[^}]*width: min\(360px, calc\(100vw - 32px\)\);[^}]*border: 1px solid var\(--line2\); border-radius: 16px; background: var\(--card\)/);
  // The buttons and the access state never wrap, so "Open for 12 hours" stays on one line; the row moves a whole button down instead.
  assert.match(css, /\.phone-panel-foot \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.phone-panel-state \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.phone-panel-foot \.btn \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.phone-panel-scan \.btn \{[^}]*white-space: nowrap;/);
});

test("the Runs in choice is one line of 13 px bold text with its chevron inside the button, section headings share one style, and Waiting rows are 8 px tall with 2 px between them", async () => {
  const css = await readFile("gui/app/styles.css", "utf8");
  for (const part of [/font-size: 13px;/, /font-weight: 700;/, /white-space: nowrap;/, /text-overflow: ellipsis;/, /overflow: hidden;/, /position: relative;/]) assert.match(css, new RegExp(String.raw`\.runs-in-choice \{[^}]*${part.source}`));
  assert.match(css, /\.runs-in-choice::after \{[^}]*position: absolute;[^}]*right: 12px;/, "the chevron stays inside the button at the right");
  assert.match(css, /\.my-groups-heading \{[^}]*font-size: 11\.5px;[^}]*letter-spacing: 0\.08em;[^}]*text-transform: uppercase;/);
  assert.match(css, /\.my-groups-heading:focus-visible \{[^}]*outline: var\(--focus\);/);
  assert.match(css, /\.waiting-panel-list \{[^}]*gap: 2px;/);
  assert.match(css, /\.waiting-row \{[^}]*padding: 8px 10px;/);
});

test("Escape closes only the topmost open layer: a menu, the phone panel, Activity, Waiting, then a drawer", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1024, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.waitingList?.items?.length, "The lists did not load.");
  const has = (selector) => desktop.root.querySelector(selector) != null;
  click(desktop.root.querySelector("[data-action='waiting']"));
  click(desktop.root.querySelector("[data-action='open-notifications']"));
  assert.deepEqual([has("[data-waiting-panel]"), has("[data-queue-panel]")], [true, true]);
  assert.equal(desktop.root.querySelector(".inspector").className.includes("is-open"), true, "where the inspector is a drawer, Waiting opens it");
  pressKey(desktop, "Escape");
  assert.deepEqual([has("[data-waiting-panel]"), has("[data-queue-panel]")], [true, false], "Activity goes first");
  desktop.app.phonePanelOpen = true; desktop.app.queuePanelOpen = true;
  renderShell(desktop.app);
  pressKey(desktop, "Escape");
  assert.deepEqual([has("[data-phone-panel]"), has("[data-queue-panel]"), has("[data-waiting-panel]")], [false, true, true], "the phone panel is above Activity");
  pressKey(desktop, "Escape");
  assert.deepEqual([has("[data-queue-panel]"), has("[data-waiting-panel]")], [false, true]);
  // Waiting goes before the drawer that holds it.
  pressKey(desktop, "Escape");
  assert.deepEqual([has("[data-waiting-panel]"), desktop.root.querySelector(".inspector").className.includes("is-open")], [false, true]);
  pressKey(desktop, "Escape");
  assert.equal(desktop.root.querySelector(".inspector").className.includes("is-open"), false, "then the drawer");
  pressKey(desktop, "Escape");
  assert.equal(desktop.app.mode, "map");
  // A dialog keeps Escape for itself.
  desktop.app.phonePanelOpen = true;
  renderShell(desktop.app);
  const dialog = desktop.document.createElement("dialog");
  dialog.setAttribute("open", "");
  desktop.document.body.append(dialog);
  pressKey(desktop, "Escape");
  assert.ok(has("[data-phone-panel]"));
  dialog.remove();
  pressKey(desktop, "Escape");
  assert.equal(has("[data-phone-panel]"), false);
});

test("at 1024 px the bar keeps Add, what waits and Details, and the rest sits in More; Details opens the inspector as a drawer with its own close button", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1024, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.app.waitingList?.items?.length, "The lists did not load.");
  const menu = () => desktop.document.querySelector("[data-context-menu]");
  const more = () => desktop.root.querySelector("[data-action='bar-more']");
  const entries = () => menu().querySelectorAll("button").map((button) => [button.getAttribute("data-action"), button.children.at(-1).textContent]);
  assert.equal(more().getAttribute("aria-label"), "More");
  click(more());
  assert.deepEqual(entries(), [["context-activity", "Activity"], ["context-phone", "Open on the phone"], ["context-settings", "Settings"]]);
  click(desktop.document.querySelector("[data-action='context-phone']"));
  assert.ok(desktop.root.querySelector("[data-phone-panel]"), "the phone entry opens the panel");
  click(more());
  click(desktop.document.querySelector("[data-action='context-activity']"));
  assert.ok(desktop.root.querySelector("[data-queue-panel]"));
  assert.equal(desktop.root.querySelector("[data-phone-panel]"), null, "one panel at a time");
  click(more());
  click(desktop.document.querySelector("[data-action='context-settings']"));
  assert.equal(desktop.app.mode, "settings");
  navigate(desktop.app, "map");
  pressKey(desktop, "Escape");
  assert.equal(desktop.root.querySelector("[data-queue-panel]"), null, "Activity was still open and goes first");
  // The waiting pill is the hand and the count; the full words stay as its name.
  const pill = desktop.root.querySelector("[data-action='waiting']");
  assert.match(pill.getAttribute("aria-label"), /^\d+ waiting on you$/);
  assert.match(pill.querySelector(".pill-count").textContent, /^\d+$/);
  assert.ok(pill.querySelector(".pill-label"));
  assert.equal(desktop.root.querySelector(".brand-name").textContent, "ONEM1ND");
  // Details opens the drawer; its header closes it; Escape closes it.
  const inspector = () => desktop.root.querySelector(".inspector");
  assert.equal(inspector().className.includes("is-open"), false);
  click(desktop.root.querySelector("[data-action='toggle-inspector']"));
  assert.equal(inspector().className.includes("is-open"), true);
  const close = inspector().querySelector("[data-action='close-inspector']");
  assert.equal(close.getAttribute("aria-label"), "Close details");
  assert.equal(inspector().children[0].className, "inspector-drawer-head");
  click(close);
  assert.equal(inspector().className.includes("is-open"), false);
  click(desktop.root.querySelector("[data-action='toggle-inspector']"));
  pressKey(desktop, "Escape");
  assert.equal(inspector().className.includes("is-open"), false);
  // The Map keeps its own view when it is not fitted any more: the drawer does not refit it.
  desktop.app.mapState.autoFit = false;
  const view = { ...desktop.app.mapState.view };
  click(desktop.root.querySelector("[data-action='toggle-inspector']"));
  assert.deepEqual(desktop.app.mapState.view, view);
});


test("opening a Waiting row from a selected cluster clears the cluster, and Open task selects the agent of the task", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const group = (await createGroup(apiFrom(fixture.desktopUrl), "Checkout launch", ["project:shop:executor-shop"])).data;
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.items?.some((item) => item.taskId === "project:shop:029") && desktop.root.querySelector(`[data-cluster-row="${group.id}"]`), "The lists did not load.");
  click(desktop.root.querySelector(`[data-cluster-row="${group.id}"]`));
  await waitFor(() => desktop.app.store.selected.groupId === group.id, "The cluster was not selected.");
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]")?.querySelector("[data-task='project:shop:029']"), "The review row did not appear.");
  assert.equal(desktop.root.querySelector(`[data-cluster-inspector="${group.id}"]`), null, "Waiting takes the place of the cluster in the inspector");
  click(desktop.root.querySelector("[data-waiting-panel]").querySelector("[data-task='project:shop:029']"));
  await waitFor(() => desktop.app.waitingRecord?.task, "The review did not load.");
  assert.equal(desktop.app.store.selected.groupId, null);
  const owner = desktop.app.waitingRecord.item.unitId;
  assert.ok(owner);
  assert.equal(desktop.app.store.selected.unitId, owner);
  click(desktop.root.querySelector("[data-waiting-open]").querySelector("[data-action='open-task']"));
  assert.equal(desktop.app.waitingOpen, false);
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null);
  assert.equal(desktop.root.querySelector(`[data-cluster-inspector="${group.id}"]`), null, "the agent shows, not the cluster");
  await waitFor(() => desktop.app.inspectorData?.unitId === owner && desktop.root.querySelector(".agent-heading"), "The agent of the task did not open.");
  assert.equal(desktop.app.store.selected.unitId, owner);
  assert.equal(desktop.app.openTaskId, "project:shop:029");
});

test("a date with no time reads as its own day, and the time of a last message follows how old it is", () => {
  assert.equal(formatShortDate("en", "2026-10-19"), "Oct 19");
  assert.equal(formatShortDate("es", "2026-10-19"), "19 oct");
  assert.equal(formatShortDate("en", ""), "");
  assert.equal(formatShortDate("en", "not a date"), "");
  const now = new Date(2026, 9, 21, 12, 0).getTime();
  const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  assert.equal(formatRecent("en", at(21, 9, 5), now), formatShortTime("en", at(21, 9, 5)), "today: the hour");
  assert.equal(formatRecent("en", at(20, 23, 59), now), "Tue", "yesterday: the weekday");
  assert.equal(formatRecent("en", at(15, 8), now), "Thu", "six days ago: still the weekday");
  assert.equal(formatRecent("en", at(14, 8), now), "Oct 14", "a week ago: the date");
  assert.equal(formatRecent("es", at(20, 8), now), "mar");
  assert.equal(formatRecent("es", at(1, 8), now), "1 oct");
  assert.equal(formatRecent("en", "", now), "");
});

test("Chats list: the newest first, an unread pill in place of the time, and the quiet chats folded into one row", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length && desktop.app.unitList?.catalog?.length, "The lists did not load.");
  const stamp = (ms) => new Date(desktop.app.api.now() - ms).toISOString();
  const chat = (id, title, extra = {}) => ({ id, title, kind: "group", members: [], pinned: false, unread: 0, lastMessage: null, ...extra });
  const said = (fromId, body, ms) => ({ id: `m-${ms}`, fromId, body, timestamp: stamp(ms) });
  desktop.app.chatList.items = [
    chat("older", "older talk", { lastMessage: said("root:master", "An old line", 3 * 86400000) }),
    chat("newest", "newest talk", { unread: 3, lastMessage: said("root:overseer", "Line one\nline two", 60000) }),
    chat("quiet-1", "quiet one"), chat("quiet-2", "quiet two"), chat("quiet-3", "quiet three"), chat("quiet-4", "quiet four"),
    chat("pinned", "pinned talk", { pinned: true }),
  ];
  desktop.app.chatList.status = "ready";
  navigate(desktop.app, "chats");
  assert.deepEqual(desktop.app.activeRows.map((row) => row.id), ["heading:pinnedChats", "pinned", "heading:recentChats", "newest", "older", "heading:quietChats", "group:quiet"]);
  const rowOf = (id) => desktop.root.querySelector(`[data-id='${id}']`);
  // Every heading of the list is the element and class of the Hierarchy's Clusters heading, not a larger row title.
  const headings = ["heading:pinnedChats", "heading:recentChats", "heading:quietChats"];
  assert.deepEqual(headings.map((id) => [rowOf(id).tag, rowOf(id).className]), headings.map(() => ["div", "my-groups-heading"]));
  assert.deepEqual(headings.map((id) => rowOf(id).children[0].textContent), ["Pinned", "Recent", "No messages yet"]);
  const newest = rowOf("newest");
  assert.equal(newest.querySelector(".chat-title").textContent, "Newest talk");
  assert.equal(newest.querySelector(".chat-preview").textContent, "Overseer: Line one line two", "the sender and the last message on one line");
  assert.equal(newest.querySelector(".chat-unread").textContent, "3");
  assert.equal(newest.querySelector(".chat-when"), null, "an unread count replaces the time");
  const older = rowOf("older");
  assert.equal(older.querySelector(".chat-unread"), null);
  assert.equal(older.querySelector(".chat-when").textContent, formatRecent("en", stamp(3 * 86400000), desktop.app.api.now()));
  assert.match(older.querySelector(".chat-preview").textContent, /: An old line$/);
  assert.equal(rowOf("pinned").querySelector(".chat-preview").textContent, "No messages yet");
  const quiet = rowOf("group:quiet");
  assert.equal(quiet.getAttribute("aria-expanded"), "false");
  assert.equal(quiet.querySelector(".chat-title").textContent, "4 chats");
  assert.equal(quiet.querySelector(".chat-preview").textContent, "Quiet one, Quiet two, Quiet three and more");
  assert.equal(rowOf("quiet-1"), null, "the chats nobody wrote in stay folded");
  desktop.app.activeHandlers.onActivate(desktop.app.activeRows.find((row) => row.id === "group:quiet"), "single");
  assert.deepEqual(desktop.app.activeRows.slice(-5).map((row) => row.id), ["group:quiet", "quiet-1", "quiet-2", "quiet-3", "quiet-4"]);
  assert.equal(rowOf("quiet-2").querySelector(".chat-preview").textContent, "No messages yet");
  assert.equal(rowOf("group:quiet").getAttribute("aria-expanded"), "true");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(rowOf("group:quiet").querySelector(".chat-title").textContent, "4 chats");
  assert.equal(rowOf("heading:quietChats").children[0].textContent, "Sin mensajes");
  assert.equal(rowOf("quiet-2").querySelector(".chat-preview").textContent, "Todavía no hay mensajes");
});

test("an agent's empty chat says what a first message does, and a cluster keeps its own empty line", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const group = (await createGroup(apiFrom(fixture.desktopUrl), "Checkout launch", ["project:shop:executor-shop"])).data;
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length && desktop.root.querySelector(`[data-cluster-row="${group.id}"]`), "The lists did not load.");
  const adjutant = desktop.app.unitList.catalog.find((unit) => unit.id === "root:adjutant");
  desktop.app.activeHandlers.onActivate({ id: adjutant.id, kind: "unit", unit: adjutant }, "double");
  await waitFor(() => desktop.app.thread?.chat?.kind === "direct" && desktop.root.querySelector("[data-composer]"), "The agent conversation did not open.");
  await waitFor(() => [...desktop.app.activity.keys()].filter((key) => key.startsWith("chat-load:")).every((key) => desktop.app.activity.get(key).phase !== "pending"), "The conversation did not finish loading.");
  desktop.app.thread.messages = [];
  desktop.app.thread.total = 0;
  renderShell(desktop.app);
  const empty = desktop.root.querySelector("[data-empty='chat']");
  assert.ok(empty.className.includes("empty-chat"));
  assert.equal(empty.querySelector("strong").textContent, "No messages yet");
  assert.equal(empty.querySelector("p").textContent, "A message reaches the agent at its next step.");
  assert.ok(empty.querySelector("svg"), "a glyph above the title");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='chat']").querySelector("strong").textContent, "Todavía no hay mensajes");
  assert.equal(desktop.root.querySelector("[data-empty='chat']").querySelector("p").textContent, "Un mensaje llega al agente en su siguiente paso.");
  desktop.app.language = "en";
  click(desktop.root.querySelector(`[data-cluster-row="${group.id}"]`));
  await waitFor(() => desktop.app.thread?.chat?.id === group.chatId && desktop.root.querySelector("[data-composer]"), "The cluster conversation did not open.");
  await waitFor(() => [...desktop.app.activity.keys()].filter((key) => key.startsWith("chat-load:")).every((key) => desktop.app.activity.get(key).phase !== "pending"), "The cluster conversation did not finish loading.");
  desktop.app.thread.messages = [];
  desktop.app.thread.total = 0;
  renderShell(desktop.app);
  const own = desktop.root.querySelector("[data-empty='chat']");
  assert.equal(own.tag, "p");
  assert.equal(own.textContent, "No messages yet. Write one below.");
  assert.ok(desktop.root.querySelector("[data-action='start-plan']"), "the cluster keeps its Choose who plans button");
});

test("a selected cluster has Chat, Work and Details; Details holds its kind, path and repositories and never the conversation", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl);
  const empty = async (title) => (await startApi.createCluster(api, { title, parentId: null, link: { kind: "none" }, machine: "DESKTOP" })).data;
  const folder = await empty("Unity");
  const repository = await empty("E pet");
  const loose = await empty("Ideas");
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(`[data-cluster-row="${folder.id}"]`), "The clusters did not load.");
  click(desktop.root.querySelector(`[data-cluster-row="${folder.id}"]`));
  await waitFor(() => desktop.app.store.selected.groupId === folder.id && desktop.app.thread?.chat?.id === folder.chatId && desktop.root.querySelector("[data-composer]"), "The cluster did not open on its chat.");
  const groups = desktop.app.store.indexes.groups;
  groups.get(folder.id).link = { kind: "folder", folderId: folder.id };
  groups.get(repository.id).parentId = folder.id;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-cluster-summary]").textContent, "Folder, 1 repository, no agents");
  assert.deepEqual(desktop.root.querySelectorAll(".session-tab").map((tab) => tab.textContent), ["Chat", "Work", "Details"]);
  assert.equal(desktop.root.querySelector("[data-action='session-chat']").getAttribute("aria-selected"), "true", "a cluster opens on its chat");
  assert.ok(desktop.root.querySelector("[data-composer]"));
  assert.equal(desktop.root.querySelector(`[data-cluster-details="${folder.id}"]`), null);
  click(desktop.root.querySelector("[data-action='session-work']"));
  assert.ok(desktop.root.querySelector("[data-unit-work]"), "no lead, so the Not started line");
  assert.equal(desktop.root.querySelector("[data-unit-work]").children.some((node) => node.textContent === "Not started"), true);
  click(desktop.root.querySelector("[data-action='session-details']"));
  const details = desktop.root.querySelector(`[data-cluster-details="${folder.id}"]`);
  assert.ok(details);
  assert.equal(desktop.root.querySelector("[data-composer]"), null, "Details does not show the conversation");
  assert.equal(desktop.root.querySelector(".transcript"), null);
  const facts = details.querySelectorAll(".fact").map((fact) => fact.children.map((child) => child.textContent));
  assert.deepEqual(facts, [["Kind", "Folder"], ["Path", "Not on this machine"], ["Repositories", "E pet"]]);
  assert.ok(details.querySelector("[data-folder-missing]"));
  assert.equal(details.querySelector("[data-action='new-agent-card']").textContent, "New agent");
  assert.equal(details.querySelector("[data-action='choose-planner']").textContent, "Choose who plans");
  click(desktop.root.querySelector("[data-action='session-chat']"));
  assert.ok(desktop.root.querySelector("[data-composer]"), "back on Chat");
  click(desktop.root.querySelector(`[data-cluster-row="${loose.id}"]`));
  await waitFor(() => desktop.app.store.selected.groupId === loose.id && desktop.root.querySelector(`[data-cluster-inspector="${loose.id}"]`), "The unlinked cluster did not open.");
  assert.equal(desktop.root.querySelector("[data-cluster-summary]").textContent, "Not linked, no agents");
  click(desktop.root.querySelector("[data-action='session-details']"));
  const unlinked = desktop.root.querySelector(`[data-cluster-details="${loose.id}"]`);
  assert.equal(unlinked.querySelector("[data-action='link-folder']").textContent, "Link a folder");
  assert.equal(unlinked.querySelector("[data-action='cluster-changes']"), null);
  assert.equal(desktop.root.querySelector(".transcript"), null);
});

test("an agent's Details names where it works, folds its session, shows the model as a name and never the default body", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.length, "The units did not load.");
  const overseer = desktop.app.unitList.catalog.find((unit) => unit.id === "root:overseer");
  desktop.app.activeHandlers.onActivate({ id: overseer.id, kind: "unit", unit: overseer }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === overseer.id && desktop.root.querySelector("[data-details-section='detailsSession']"), "The agent details did not load.");
  const facts = () => Object.fromEntries(desktop.root.querySelector("[data-agent-details]").querySelectorAll(".fact").map((fact) => [fact.children[0].textContent.replace(/: $/, ""), fact.children[1].textContent]));
  assert.equal(facts()["Works in"], "Every cluster");
  assert.equal(facts().Scope, undefined, "there is no separate Scope line");
  assert.equal(facts()["Reports to"], undefined, "the Overseer reports to no one");
  const session = desktop.root.querySelector("[data-details-section='detailsSession']");
  assert.equal(session.tag, "details");
  assert.equal(session.getAttribute("open"), null, "the session is folded");
  assert.match(session.querySelector("summary").children[1].textContent, /^Session on /);
  assert.ok(["Running", "Not started", "Unavailable"].includes(session.querySelector("summary").children[2].textContent));
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(facts()["Trabaja en"], "Todos los clústeres");
  assert.match(desktop.root.querySelector("[data-details-section='detailsSession']").querySelector("summary").children[1].textContent, /^Sesión en /);
  const shop = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: shop.id, kind: "unit", unit: shop }, "double");
  await waitFor(() => desktop.app.inspectorData?.unitId === shop.id && desktop.root.querySelector("[data-details-section='detailsSession']"), "The executor details did not load.");
  assert.equal(facts()["Trabaja en"] != null, true, "a project scope or a started session names where it works");
  assert.equal(facts()["Reporta a"] != null, true, "an agent below an Overlord or a cluster keeps its Reports to line");
  assert.equal(facts().Modelo, "Strong", "the model reads as a name");
  assert.equal(desktop.root.querySelector("[data-action='change-runs-in']").textContent.startsWith("Se ejecuta en"), false, "the card title says Run, the button only the choice");
  assert.match(desktop.root.querySelector("[data-action='change-runs-in']").getAttribute("aria-label"), /^Se ejecuta en: /);
});

test("the body every new agent starts with is not shown as a fact, and another body still is", () => {
  const { document } = createTestDocument(1440);
  const t = (key, values) => text("en", key, values);
  const unit = (context) => renderUnit(document, { unit: "ready", scope: { kind: "root" }, context }, t, "en");
  assert.equal(unit("Ready.").querySelector(".unit-context"), null);
  assert.equal(unit("Ready.\n").querySelector(".unit-context"), null);
  assert.equal(unit("Waiting on the release.").querySelector(".unit-context").textContent, "Waiting on the release.");
  const works = (scope) => renderUnit(document, { unit: "ready", scope }, t, "en").querySelector("[data-unit-facts]").children.map((node) => node.textContent);
  assert.ok(works({ kind: "root" }).includes("Works in: Every cluster"));
  assert.ok(works({ kind: "project", name: "shop" }).includes("Works in: shop"));
  assert.equal(works({ kind: "root" }).some((line) => line.startsWith("Scope")), false);
});

test("a question in Waiting opens its conversation instead of a card, and an ask names the agent and the day", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.waitingList?.items?.some((item) => item.kind === "question") && desktop.app.unitList?.catalog?.length, "The lists did not load.");
  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-panel]") && desktop.app.waitingList.status === "ready", "The Waiting panel did not open.");
  const asked = desktop.app.waitingList.items.find((item) => item.kind === "question");
  Object.assign(asked, { since: "2026-10-19" });
  renderShell(desktop.app);
  const row = desktop.root.querySelector("[data-waiting-panel]").querySelector(`[data-waiting-item='${asked.id}']`);
  assert.equal(row.querySelector(".waiting-row-meta").textContent, "Overseer, Oct 19");
  click(row);
  assert.equal(desktop.app.waitingOpen, false, "a question opens the conversation, which the inspector shows");
  assert.equal(desktop.app.store.selected.unitId, asked.unitId);
  assert.equal(desktop.root.querySelector("[data-waiting-panel]"), null);
});

test("a cluster's Work tab shows the work of the lead that has a session", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const group = (await createGroup(apiFrom(fixture.desktopUrl), "Checkout launch", ["project:shop:executor-shop"])).data;
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(`[data-cluster-row="${group.id}"]`) && desktop.app.store.view?.sessions?.some((session) => session.unitId === "project:shop:executor-shop"), "The cluster and its session did not load.");
  click(desktop.root.querySelector(`[data-cluster-row="${group.id}"]`));
  await waitFor(() => desktop.app.store.selected.groupId === group.id && desktop.root.querySelector("[data-action='session-work']"), "The cluster did not open.");
  assert.equal(desktop.root.querySelector("[data-cluster-summary]").textContent, "Not linked, 1 agent");
  click(desktop.root.querySelector("[data-action='session-work']"));
  await waitFor(() => desktop.root.querySelector("[data-session-work]"), "The lead's work did not show.");
  assert.equal(desktop.root.querySelector("[data-unit-work]"), null, "a lead with a session is not Not started");
  assert.ok(desktop.root.querySelector("[data-action='stop-step']"));
  click(desktop.root.querySelector("[data-action='session-details']"));
  const agents = desktop.root.querySelector(`[data-cluster-details="${group.id}"]`).querySelector("[data-cluster-agent='project:shop:executor-shop']");
  assert.equal(agents.children[1].textContent, "Executor shop");
  assert.equal(agents.children[2].textContent, "Executor");
});
