import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from 'node:zlib';
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { createApi, createOperation, dispose as disposeApi, request, retryOperation } from "../gui/app/api.mjs";
import { answerApproval, changeTaskStatus, createGroup, createUnit, setUnitAlias, startSession, undoTask } from "../gui/app/actions.mjs";
import { documentSaver, findTextMatches, textDraft } from "../gui/app/void.mjs";
import { markMailboxRead } from "../gui/app/chats.mjs";
import { dispose as disposeEmbed, handleParentMessage, publishDirty, publishReady, startEmbedChannel } from "../gui/app/embed.mjs";
import { DICTIONARIES, cardinal, dictionaryKeys, formatClock, formatShortTime, formatWhen, limitsUsage, text } from "../gui/app/i18n.mjs";
import { encodeHomeQr } from "../gui/app/qr.mjs";
import { canPerform, exchangeCode, exchangeHomeFragment, logout, renderCodeEntry, renderPhone } from "../gui/app/phone.mjs";
import { applyIssueChange, applyServiceBeat, applySettingsRead, applySyncSnapshot, armExpiry, clearGrant, closeHome, limitsLabel, noteHomeChange, openHome, renderSettings, saveSettings, takeGrant, updateExpiry } from "../gui/app/settings.mjs";
import { activateUnit, buildHierarchy, flattenVisibleHierarchy, revealGroup, toggleGroup } from "../gui/app/hierarchy.mjs";
import { collectPages, createPagedList, loadAll, moveFocus, renderWindow, setQuery } from "../gui/app/lists.mjs";
import { flushLayout, queueLayoutPatch } from "../gui/app/map.mjs";
import { setAttachments, startWatch, libraryState, createResource } from "../gui/app/editors.mjs";
import { composeCore } from "../engine/service/service.mjs";
import { stopService } from "../engine/service/service.mjs";
import { close as closeStream } from '../gui/app/stream.mjs';
import { checkoutFacts, renderApproval, renderSession, renderUnit } from "../gui/app/inspector.mjs";
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
import { createCredentialStore } from '../engine/service/security.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { createChat, postChat } from '../engine/service/chats.mjs';
import { createContext, readContext } from '../engine/service/context.mjs';
import { registerNative } from '../engine/service/adapters.mjs';
import { refreshPlan } from '../gui/app/plan-controller.mjs';
import { element } from '../gui/app/components.mjs';
import { runsInLabel } from '../gui/app/clusters.mjs';
import { AGENT_ROLES } from '../gui/app/start-copy.mjs';
import { hierarchyIcon } from '../gui/app/hierarchy.mjs';
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
  assert.notEqual(action('open-notifications')?.getAttribute('disabled'), null);
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
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: 'hivem1nd-service-config-v1', mindPath: fixture.paths.mind,
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
  assert.match(details, /hivem1nd service install --mind-path/);
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

async function settingsApp(t, onFetch) {
  const fixture = await createGuiFixture({ scenario: "settings", now: new Date().toISOString() });
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

test("Settings exposes five keyboard tabs, own-palette looks and machine-owned read-only reports", async t => {
  const desktop = await settingsApp(t);
  const { root, app } = desktop;
  assert.deepEqual([...root.querySelectorAll("[data-settings-tab]")].map(node => node.textContent || text("en", `settings${node.dataset.settingsTab[0].toUpperCase()}${node.dataset.settingsTab.slice(1)}`)),
    ["General", "Agents", "Permissions", "Projects", "Content"]);
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
  click(root.querySelector("[data-settings-tab='permissions']"));
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
  const preferences = await readFile(join(fixture.root, "Cosmic", "hivem1nd", "user", "preferences.md"), "utf8");
  assert.equal(preferences.startsWith("Existing user preference."), true);
  assert.match(preferences, /Retained instructions\.\nSecond line\./);
  assert.equal(app.settingsState.content.features.find(item => item.id === "feature:tribunal").included, false);
  typeInput(root.querySelector("[data-preference-instructions]"), "Draft after conflict.", 5, 5);
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings/content", status: 409, code: "revision_conflict" });
  click(root.querySelector("[data-action='settings-save-content']"));
  await waitFor(() => app.activity.get("settings:PATCH:/settings/content")?.phase === "error", "The revision conflict was hidden.");
  assert.equal(root.querySelector("[data-preference-instructions]").value, "Draft after conflict.");
  assert.equal(app.settingsState.contentDirty, true);
  assert.equal(await readFile(join(fixture.root, "Cosmic", "hivem1nd", "user", "preferences.md"), "utf8"), preferences);
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
  const storage = { getItem: (key) => key === "hivem1nd:language" ? "es" : null };
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

test("the shell has no remote assets, token storage, or inline code", async () => {
  const files = ["gui/app/index.html", "gui/app/favicon.svg", "gui/app/main.mjs", "gui/app/i18n.mjs", "gui/app/styles.css", "gui/app/components.mjs", "gui/app/lists.mjs", "gui/app/hierarchy.mjs", "gui/app/map.mjs", "gui/app/map-geometry.mjs", "gui/app/actions.mjs", "gui/app/chats.mjs", "gui/app/chat-media.mjs", "gui/app/inspector.mjs", "gui/app/editors.mjs", "gui/app/blueprint.mjs", "gui/app/markup.mjs", "gui/app/void.mjs", "gui/app/settings.mjs", "gui/app/qr.mjs", "gui/app/qr-render.mjs", "gui/app/phone.mjs", "gui/app/embed.mjs"];
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
  for (const [file, source] of sources) {
    if (file !== "gui/app/main.mjs") assert.equal(source.includes("localStorage"), false, file);
    assert.equal(source.includes("sessionStorage"), false, file);
    assert.equal(source.includes("fonts.googleapis"), false, file);
    assert.equal(source.includes("\u2014"), false, file);
    const remote = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    assert.deepEqual(remote.filter((url) => url !== "http://www.w3.org/2000/svg"), [], file);
  }
  const html = sources[0][1];
  assert.match(html, /lang="en"/);
  assert.match(html, /href="\/app\/styles\.css"/);
  assert.equal(html.includes("mark.svg"), false);
  assert.match(html, /rel="icon" href="\/app\/favicon\.svg"/);
  assert.equal(html.includes("data:image"), false);
  const icon = sources[1][1];
  assert.equal(icon.includes("#bdcd79"), true);
  assert.ok(Buffer.byteLength(icon) < 2048);
  await assert.rejects(readFile("gui/app/mark.svg"), (error) => error.code === "ENOENT");
  assert.match(html, /src="\/app\/main\.mjs"/);
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false);
  assert.equal(html.includes("<style"), false);
  assert.equal(html.includes("session="), false);
  const main = sources[2][1];
  const imports = [...new Set([...main.matchAll(/from "([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(imports, ["./actions.mjs", "./api.mjs", "./blueprint.mjs", "./chat-media.mjs", "./chats.mjs", "./components.mjs", "./editors.mjs", "./embed.mjs", "./hierarchy.mjs", "./i18n.mjs", "./inspector.mjs", "./lists.mjs", "./map.mjs", "./markup.mjs", "./phone.mjs", "./settings.mjs", "./state.mjs", "./stream.mjs", "./void.mjs"]);
  const css = sources[4][1];
  assert.match(css, /--bg:\s*#0f0b13/);
  assert.match(css, /--bg:\s*#050505/);
  assert.match(css, /--accent:\s*#bdcd79/);
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

  await assert.rejects(setAttachments({}, { current: { resourceId: "board", attachmentRevision: null, attached: [] } }, Array.from({ length: 257 }, (_, index) => `unit-${index}`)), (error) => error.code === "invalid_body");
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
  const settingsFile = join(fixture.root, "Cosmic", "hivem1nd", "user", "gui", "settings.json");
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
  assert.equal(phone.root.querySelector(".mode"), null);
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
    contract: "hivem1nd-embed-v1",
    viewerId: "viewer-a",
    type: "dirty",
    value: true,
  });
  assert.equal(parent.parent.sent.origin, "http://127.0.0.1:9");
  publishReady(sibling);
  assert.equal(other.parent.sent.data.viewerId, "viewer-b");
  assert.equal(parent.parent.sent.data.viewerId, "viewer-a");
  const forged = [
    { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "https://evil.example", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "other", viewerId: "viewer-a", type: "set-look", value: "modern" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-look", value: "neon" } },
    { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: false } },
  ];
  for (const event of forged) await handleParentMessage(channel, event);
  assert.deepEqual(calls, []);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "set-language", value: "es" } });
  await handleParentMessage(sibling, { source: other.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-b", type: "set-look", value: "high-contrast" } });
  assert.deepEqual(calls[0], { language: "es" });
  assert.deepEqual(calls[1], ["b", { look: "high-contrast" }]);
  await handleParentMessage(channel, { source: parent.parent, origin: "http://127.0.0.1:9", data: { contract: "hivem1nd-embed-v1", viewerId: "viewer-a", type: "close", value: null } });
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

test("Watch opens the focused board and clears a stopped watch", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const board = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  const opened = await request(desktop.app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: board.id } });
  const screen = opened.data.document.screens[0];
  const nodeId = screen.root?.id;
  assert.ok(screen?.id);
  assert.ok(nodeId);
  await startWatch(desktop.app.api, desktop.app.editors, { unitId: "project:shop:executor-shop", resourceId: board.id });
  await fixture.control.noteActivity({
    unitId: "project:shop:executor-shop",
    resourceId: board.id,
    focus: { screenId: screen.id, nodeId },
  });
  await waitFor(() => desktop.root.querySelector(".shell")?.getAttribute("data-mode") === "blueprint"
    && desktop.root.querySelector(`[data-screen="${screen.id}"]`)?.getAttribute("data-focus") === "true"
    && desktop.root.querySelector(`[data-node="${nodeId}"]`)?.getAttribute("data-highlight") === "true", "Watch did not open the focused board.");
  const watchId = desktop.app.editors.watch?.watchId;
  assert.ok(watchId);
  await fixture.control.emit("watch.changed", { watchId, unitId: "project:shop:executor-shop", resourceId: board.id, state: "stopped" });
  await waitFor(() => desktop.app.editors.watch == null, "The stopped watch remained.");
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
  click(desktop.root.querySelector("[data-waiting-surface]").querySelector("[data-task='project:shop:029']"));
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
  await waitFor(() => desktop.root.querySelector("[data-waiting-surface]")?.querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"), "The waiting list did not open.");
  const search = desktop.root.querySelector("[data-waiting-search]");
  typeInput(search, "zzzz-no-such-waiting", 0, 20);
  await waitFor(() => desktop.root.querySelector("[data-waiting-total]")?.getAttribute("data-waiting-total") === "0", "Waiting search did not filter.");
  typeInput(search, "", 0, 0);
  await waitFor(() => desktop.root.querySelector("[data-waiting-surface]")?.querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"), "Waiting search did not restore the list.");
  click(desktop.root.querySelector("[data-waiting-surface]").querySelector("[data-approval='e80a0bf9-8fb4-4d64-9527-04524c9a2ecf']"));
  await waitFor(() => desktop.root.querySelector("[data-waiting-record='approval']")?.querySelector("[data-action='approve']"), "The approval action was not offered.");
  assert.equal(desktop.root.querySelector("[data-waiting-record]")?.querySelector("[data-action='revoke-grant']"), null);
  navigate(desktop.app, "settings");
  assert.equal(desktop.root.querySelector("[data-settings]") != null, true);
  assert.equal(desktop.root.querySelector("[data-waiting-surface]"), null);
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector("[data-waiting-surface]") != null, true);

  for (const mode of ["settings", "blueprint", "document", "focus"]) {
    navigate(desktop.app, mode);
    assert.equal(desktop.root.querySelector("[data-action='waiting']").getAttribute("aria-pressed"), "false");
    click(desktop.root.querySelector("[data-action='waiting']"));
    await waitFor(() => desktop.root.querySelector("[data-waiting-surface]"), `Waiting did not open from ${mode}.`);
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

test("desktop registers a path, copies a legacy module, and edits structure without rewriting read-only bytes", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const legacyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.mjs");
  await writeFile(legacyFile, 'import { board } from "blueprint/board.mjs";\nimport { col, text } from "blueprint/kit.mjs";\nexport default board({ id: "legacy-cart", title: "Legacy cart", screens: [{ id: "cart", title: "Cart", root: col({ w: 300, h: 560 }, text("Actual legacy cart")) }] });\n');
  const indexFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8")); index.push({ id: "legacy-cart", title: "Legacy cart" });
  await writeFile(indexFile, JSON.stringify(index));
  await fixture.control.refresh();
  const originalFile = join(fixture.root, "repositories", "shop", "docs", "release.orig.json");
  const legacyBytes = await readFile(legacyFile);
  const originalBytes = await readFile(originalFile);
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (_input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(_input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell")?.getAttribute("data-layout") === "desktop", "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-action='open-register']")?.getAttribute("data-kind") === "blueprint", "The registration form was not shown.");
  click(desktop.root.querySelector("[data-action='open-register']"));
  typeInput(desktop.document.querySelector("[data-field='register-path']"), "docs/flows/boards/legacy-cart.mjs", 0, 0);
  click(desktop.document.querySelector("[data-action='register-resource']"));
  await waitFor(() => desktop.root.querySelector("[data-legacy]")?.textContent === "docs/flows/boards/legacy-cart.mjs", "The original module path was not shown.");
  assert.equal(desktop.root.querySelector("[data-action='resize-screen']"), null);
  click(desktop.root.querySelector("[data-action='copy-json']"));
  await waitFor(() => desktop.app.editors.error || desktop.root.querySelector("[data-action='resize-screen']"), "The copy returned no result.");
  assert.equal(desktop.app.editors.error?.code ?? null, null, desktop.app.editors.error?.message);
  await waitFor(() => desktop.app.editors.current?.authoritative?.legacy == null && desktop.root.querySelector("[data-action='resize-screen']"), "The JSON copy did not open.");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  const copied = writes.find((item) => item.method === "POST" && item.body?.document?.id === "legacy-cart");
  assert.equal(copied.body.path, "docs/flows/boards/legacy-cart.json");
  const copyFile = join(fixture.root, "repositories", "shop", "docs", "flows", "boards", "legacy-cart.json");
  assert.equal(JSON.parse((await readFile(copyFile)).toString("utf8")).id, "legacy-cart");
  assert.equal((await readFile(copyFile)).includes(Buffer.from("export const board")), false);

  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === cart.id && desktop.root.querySelector("[data-field='screen-width']"), "The Cart board did not open.");
  assert.equal(desktop.root.querySelector("[data-action='move-page']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='add-link']")?.getAttribute("disabled"), "");
  const cartRevision = desktop.app.editors.current.revision;
  typeInput(desktop.root.querySelector("[data-field='screen-width']"), "400", 0, 3);
  typeInput(desktop.root.querySelector("[data-field='screen-height']"), "844", 0, 3);
  click(desktop.root.querySelector("[data-action='resize-screen']"));
  await waitFor(() => desktop.app.editors.current?.revision !== cartRevision, "The screen resize was not saved.");
  const resized = writes.filter((item) => item.method === "PUT" && item.body?.document?.screens).at(-1);
  assert.equal(resized.body.expectedRevision, cartRevision);
  assert.equal(resized.body.document.sentinel, "document-sentinel");
  assert.equal(resized.body.document.screens[0].sentinel, "screen-sentinel");
  assert.equal(resized.body.document.screens[0].w, 400);
  assert.equal(resized.body.document.screens[0].root.w, 400);
  assert.equal(resized.body.document.screens[0].root.sentinel, "node-sentinel");
  assert.equal(resized.body.document.links[0].to, "missing-screen");
  assert.equal(resized.body.document.links[0].sentinel, "link-sentinel");
  assert.equal(resized.body.document.pages[0].sentinel, "page-sentinel");

  click(desktop.root.querySelector("[data-action='open-create']"));
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Sample board", 0, 12);
  desktop.document.querySelector("[data-field='create-project']").value = "shop";
  click(desktop.document.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "sample-board" && desktop.root.querySelector("[data-editor-title]")?.getAttribute("data-editor-title") === "Sample board", "The new board did not open.");
  assert.equal(desktop.root.querySelector("[data-structure]").children.some(child => child.textContent === "null"), false);
  assert.equal(desktop.app.editors.current.authoritative.document.screens.length, 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages.length, 1);
  assert.equal(desktop.root.querySelector("[data-action='move-page']").getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='move-screen']").getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='add-link']").getAttribute("disabled"), "");
  assert.deepEqual(await readFile(legacyFile), legacyBytes);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors.catalog.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === notes.id && desktop.root.querySelector("[data-void-title]"), "The text did not open.");
  const textRevision = desktop.app.editors.current.revision;
  const textRev = desktop.app.editors.current.authoritative.document.rev;
  const title = desktop.root.querySelector("[data-void-title]");
  title.textContent = "Revised notes";
  for (const handler of title.listeners.get("input") ?? []) handler();
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.title === "Revised notes", "The document replacement was not saved.");
  const replaced = writes.filter((item) => item.method === "PUT" && item.body?.document?.pages && !item.body.document.screens).at(-1);
  assert.equal(replaced.body.expectedRevision, textRevision);
  assert.equal(Object.hasOwn(replaced.body.document, "rev"), false);
  assert.equal(replaced.body.document.sentinel, "void-sentinel");
  assert.equal(desktop.app.editors.current.authoritative.document.rev, textRev + 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages[0].sentinel, "void-page-sentinel");
  assert.deepEqual(await readFile(originalFile), originalBytes);
  assert.deepEqual(await readFile(legacyFile), legacyBytes);

  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone", "The phone shell did not appear.");
  phone.app.mode = "blueprint";
  renderShell(phone.app);
  assert.equal(phone.root.querySelector("[data-action='register-resource']"), null);
  assert.equal(phone.root.querySelector("[data-action='open-register']"), null);
  assert.equal(phone.root.querySelector("[data-action='create-resource']"), null);
  assert.equal(phone.root.querySelector("[data-action='open-create']"), null);
  assert.equal(phone.root.querySelector("[data-action='copy-json']"), null);
  assert.equal(phone.root.querySelector("[data-action='resize-screen']"), null);
  phone.app.mode = "document";
  renderShell(phone.app);
  assert.equal(phone.root.querySelector("[data-action='replace-document']"), null);
});

test("void drafts stay with their page and comments use the rendered selection", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || (init.method !== "POST" && init.method !== "PUT")) return;
    writes.push({ method: init.method, url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const commentsBefore = () => writes.filter((item) => item.method === "POST" && item.url.includes("/comments"));
  click(desktop.root.querySelector("[data-action='comment-quote']"));
  await delay(40);
  assert.equal(commentsBefore().length, 0);
  const quote = textNodes(desktop.root.querySelector("[data-void]")).find((node) => node.textContent.includes("first"));
  const offset = quote.textContent.indexOf("first");
  desktop.document.getSelection = () => ({
    anchorNode: quote,
    anchorOffset: offset,
    focusNode: quote,
    focusOffset: offset + "first".length,
    isCollapsed: false,
  });
  click(desktop.root.querySelector("[data-action='comment-quote']"));
  await waitFor(() => commentsBefore().some((item) => item.body.anchor?.quote === "first"), "The comment did not use the rendered selection.");
  const anchor = commentsBefore().find((item) => item.body.anchor?.quote === "first").body.anchor;
  assert.equal(anchor.k, "Intro.Welcome");
  assert.equal(anchor.lang, "en");
  assert.equal(anchor.start, 10);
  assert.equal(anchor.end, 15);
  assert.equal(anchor.prefix, "Welcome\nA ");
  assert.equal(anchor.suffix, " paragraph.");

  const source = desktop.root.querySelector("[data-source]");
  const original = source.value;
  const broken = original.replace("<b>", "<");
  typeInput(source, broken, 0, 1);
  await desktop.app.editors.current.voidSaver.flush();
  const ranged = writes.filter((item) => item.method === "PUT" && item.url.includes("/void/texts/")).at(-1).body;
  assert.equal(ranged.document.pages.find((page) => page.k === "Intro.Welcome").en, broken);
  assert.equal(ranged.document.pages.find((page) => page.k === "Intro.Welcome").es, desktop.app.editors.current.authoritative.document.pages[0].es);
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.pages?.find((page) => page.k === "Intro.Welcome")?.en === broken
    && desktop.root.querySelector("[data-source]")?.value === broken, "The saved text was not shown.");

  const kept = `${broken} kept`;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/void/texts/${notes.id}`, status: 409, code: "revision_conflict" });
  typeInput(desktop.root.querySelector("[data-source]"), kept, 0, 4);
  await assert.rejects(desktop.app.editors.current.voidSaver.flush());
  await waitFor(() => desktop.app.editors.current?.conflict?.code === "revision_conflict", "The conflict draft was discarded.");
  assert.equal(desktop.root.querySelector("[data-source]").value, kept);
  assert.equal(textDraft(desktop.app.editors.current, notes.id, "Intro.Welcome", "en"), kept);

  typeInput(desktop.root.querySelector("[data-source]"), "", 0, 0);
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  desktop.app.voidState.page = "Notes.Next";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "Next page.");
  desktop.app.voidState.page = "Intro.Welcome";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value.includes("Bienvenida"), true);
  desktop.app.language = "en";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-source]").value, "");
  typeInput(desktop.root.querySelector("[data-source]"), "LOCAL DRAFT", 0, 5);
  desktop.app.voidState.page = "Notes.Next";
  renderShell(desktop.app);
  click(desktop.root.querySelector("[data-action='open-create']"));
  typeInput(desktop.document.querySelector("[data-field='create-title']"), "Fresh note", 0, 10);
  desktop.document.querySelector("[data-field='create-project']").value = "shop";
  click(desktop.document.querySelector("[data-action='create-resource']"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.id === "fresh-note" && desktop.app.voidState?.page === "Intro.Welcome", "The new text did not open on its first page.");
  assert.equal(desktop.app.voidState.page, "Intro.Welcome");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "LOCAL DRAFT");
  assert.notEqual(desktop.root.querySelector("[data-source]").value, "Next page.");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === notes.id && desktop.app.voidState?.page === "Notes.Next", "The text did not restore its selected page.");
  assert.equal(textDraft(desktop.app.editors.current, notes.id, "Intro.Welcome", "en"), "LOCAL DRAFT");
  desktop.app.voidState.page = "Intro.Welcome";
  renderShell(desktop.app);
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value === "LOCAL DRAFT", "The page draft was lost while switching texts.");
});

test("comments use a complete anchor and stay disabled until one exists", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || init.method !== "POST") return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='comment']") && desktop.root.querySelector("[data-node='label']"), "The board comment control did not appear.");
  const commentPosts = () => writes.filter((item) => item.url.includes("/comments") && item.body.anchor);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "Place the label", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  click(desktop.root.querySelector("[data-action='comment']"));
  await delay(40);
  assert.equal(commentPosts().length, 0);
  const host = desktop.root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Place the label"), "The node comment was not sent.");
  const nodeAnchor = commentPosts().find((item) => item.body.text === "Place the label").body.anchor;
  assert.equal(nodeAnchor.screen, "empty");
  assert.equal(nodeAnchor.screenTitle, "Empty cart");
  assert.equal(nodeAnchor.element, "label");
  assert.equal(nodeAnchor.label, "Label");
  assert.deepEqual(nodeAnchor.path, ["Empty cart", "Root", "Label"]);
  assert.deepEqual(nodeAnchor.point, { x: 20, y: 24 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent node comment remained.");

  clickEvent(desktop.root.querySelector(".board-host"), { target: desktop.root.querySelector("[data-screen='empty']"), offsetX: 8, offsetY: 9 });
  typeInput(desktop.root.querySelector("[data-comment]"), "Whole screen", 0, 5);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Whole screen"), "The screen comment was not sent.");
  const screenAnchor = commentPosts().find((item) => item.body.text === "Whole screen").body.anchor;
  assert.equal(screenAnchor.screen, "empty");
  assert.equal(screenAnchor.screenTitle, "Empty cart");
  assert.equal(screenAnchor.element, null);
  assert.equal(screenAnchor.label, "Empty cart");
  assert.deepEqual(screenAnchor.path, ["Empty cart"]);
  assert.deepEqual(screenAnchor.point, { x: 8, y: 9 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent screen comment remained.");

  clickEvent(desktop.root.querySelector(".board-host"), { target: desktop.root.querySelector(".board-host"), offsetX: -40, offsetY: -15 });
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "On the canvas", 0, 3);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "On the canvas"), "The canvas comment was not sent.");
  const canvas = commentPosts().find((item) => item.body.text === "On the canvas").body.anchor;
  assert.equal(canvas.screen, null);
  assert.equal(canvas.screenTitle, null);
  assert.equal(canvas.element, null);
  assert.equal(canvas.label, "Board");
  assert.deepEqual(canvas.path, ["Board"]);
  assert.deepEqual(canvas.point, { x: -40, y: -15 });
  await waitFor(() => desktop.root.querySelector("[data-comment]")?.value === "", "The sent canvas comment remained.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  typeInput(desktop.root.querySelector("[data-comment]"), "Use the rendered words", 0, 3);
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), "");
  const quote = textNodes(desktop.root.querySelector("[data-void]")).find((node) => node.textContent.includes("first"));
  const offset = quote.textContent.indexOf("first");
  desktop.document.getSelection = () => ({
    anchorNode: quote,
    anchorOffset: offset,
    focusNode: quote,
    focusOffset: offset + "first".length,
    isCollapsed: false,
  });
  desktop.app.onCommentSelection();
  assert.equal(desktop.root.querySelector("[data-comment]").value, "Use the rendered words");
  assert.equal(desktop.root.querySelector("[data-action='comment']").getAttribute("disabled"), null);
  click(desktop.root.querySelector("[data-action='comment']"));
  await waitFor(() => commentPosts().some((item) => item.body.text === "Use the rendered words"), "The text comment was not sent.");
  const textAnchorBody = commentPosts().find((item) => item.body.text === "Use the rendered words").body.anchor;
  assert.equal(textAnchorBody.k, "Intro.Welcome");
  assert.equal(textAnchorBody.lang, "en");
  assert.equal(textAnchorBody.start, 10);
  assert.equal(textAnchorBody.end, 15);
  assert.equal(textAnchorBody.quote, "first");
  assert.equal(textAnchorBody.prefix, "Welcome\nA ");
  assert.equal(textAnchorBody.suffix, " paragraph.");
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
  capture("Waiting");
  click(desktop.root.querySelector("[data-action='new-cluster']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='cluster']"), "The copy inventory did not open the unit form.");
  capture("New cluster form");
  desktop.document.querySelector("dialog[open]").close();
  click(desktop.root.querySelector("[data-action='start-session']"));
  await waitFor(() => desktop.document.querySelector("[data-form='session']"), "The copy inventory did not open the session form.");
  capture("Session form");
  desktop.document.querySelector("dialog[open]").close();
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-settings]"), "The copy inventory did not open Settings.");
  capture("Settings and service");
  for (const [mode, kind] of [["blueprint", "blueprint"], ["document", "void"]]) {
    navigate(desktop.app, mode);
    await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.kind === kind && item.title === (kind === "blueprint" ? "Cart" : "Release notes")), "The copy inventory did not load the library.");
    capture(`${mode} library`);
    const item = desktop.app.editors.catalog.find((item) => item.kind === kind && item.title === (kind === "blueprint" ? "Cart" : "Release notes"));
    renderShell(desktop.app);
    click(desktop.root.querySelector(`[data-id='${item.id}']`));
    await waitFor(() => desktop.app.editors.current?.resourceId === item.id && desktop.root.querySelector(kind === "blueprint" ? ".board-host" : "[data-void]"), "The copy inventory did not open the resource.");
    capture(`${mode} content and comments`);
  }
  navigate(desktop.app, "focus");
  capture("Focus");
  desktop.root.listeners.get("pointermove")[0]();
  capture("Focus tools");
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
  assert.equal(inventory.size, 20);
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
  assert.notEqual(desktop.root.querySelector("[data-action='start-session']").getAttribute('disabled'), null);
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
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]"), "The node name field did not open.");
  typeInput(desktop.root.querySelector("[data-node-name]"), "Label 2", 0, 7);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const source = desktop.root.querySelector("[data-source]");
  typeInput(source, `${source.value}!`, 0, 1);
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(dirtyMessages().filter((item) => item.value === true).length, 1);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, "Hold!");
  assert.equal(desktop.app.inputDrafts.notes.get("project:shop:030").value, "Fix");

  navigate(desktop.app, "map");
  await waitFor(() => desktop.root.querySelector("[data-composer]")?.value === "Hold!", "The chat draft was not restored.");
  typeInput(desktop.root.querySelector("[data-composer]"), "", 0, 0);
  typeInput(desktop.root.querySelector("[data-note='project:shop:030']"), "", 0, 0);
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === cart.id), "The board catalog did not return.");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node-name]")?.value === "Label 2", `The node draft was not restored. value=${desktop.root.querySelector("[data-node-name]")?.value ?? "missing"} stored=${desktop.app.inputDrafts.nodes?.get(cart.id) ?? "missing"}`);
  typeInput(desktop.root.querySelector("[data-node-name]"), "", 0, 0);
  assert.equal(dirtyPatches().some((item) => item.body.dirty === false), false);
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === notes.id), "The text catalog did not return.");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.endsWith("!"), "The source draft was discarded with the other forms.");
  await desktop.app.editors.current.voidSaver?.flush();
  await waitFor(() => !(desktop.app.editors.current?.textDrafts?.size), "The source draft was not saved.");
  await waitFor(() => dirtyPatches().some((item) => item.body.dirty === false) && dirtyMessages().some((item) => item.value === false), "Saving the last draft did not clear the dirty flag.");
  assert.equal(dirtyPatches().filter((item) => item.body.dirty === true).length, 1);
  assert.equal(desktop.app.inputDrafts.chats.get(chat.id).value, "");
  assert.equal(desktop.app.inputDrafts.notes.get("project:shop:030").value, "");
  assert.equal(desktop.app.viewerDirty, false);

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

test("Blueprint and Document place the catalog beside the comments", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const layout = desktop.root.querySelector("[data-editor-layout]");
  assert.equal(layout?.getAttribute("data-editor-layout"), "blueprint");
  assert.equal(layout.className.includes("workspace-editor"), true);
  assert.deepEqual([...layout.children].map((node) => node.getAttribute("data-editor-column")), ["catalog", "resource", "comments"]);
  assert.equal(layout.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Boards");
  assert.equal(layout.querySelector("[data-editor-column='comments']").querySelector("h2").textContent, "Comments");
  assert.equal(desktop.root.querySelector("[role='tab']"), null);
  assert.equal(desktop.root.querySelector(".side"), null);
  assert.equal(desktop.root.querySelector(".inspector"), null);
  assert.equal(layout.querySelector("[data-editor-column='catalog']").querySelector("[data-action='open-register']")?.getAttribute("data-kind"), "blueprint");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Tableros");
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").querySelector("h2").textContent, "Comentarios");
  desktop.app.language = "en";
  renderShell(desktop.app);
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector(".board-host"), "The board did not open.");
  const resource = desktop.root.querySelector("[data-editor-column='resource']");
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  const tools = resource.querySelector("[data-editor-tools]");
  assert.equal(tools.querySelector("[data-watch]")?.getAttribute("data-watch"), "off");
  assert.equal(resource.querySelector("[data-toolbar='board']").querySelector("[data-action='attach']") != null, true);
  assert.equal(resource.querySelector("[data-toolbar='board']").querySelector("[data-action='watch']") != null, true);
  assert.equal(columnIndex(resource, tools) < columnIndex(resource, resource.querySelector(".board-host")), true);
  assert.equal(resource.querySelector("[data-node-name]") != null, true);
  assert.equal(resource.querySelector("[data-comment]"), null);
  assert.equal(comments.querySelector("[data-comment]") != null, true);
  assert.equal(comments.querySelector(".board-host"), null);

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const documentLayout = desktop.root.querySelector("[data-editor-layout]");
  assert.equal(documentLayout.getAttribute("data-editor-layout"), "document");
  assert.equal(documentLayout.querySelector("[data-editor-column='catalog']").querySelector("h2").textContent, "Texts");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]")?.value?.includes("<b>Welcome</b>"), "The release text did not open.");
  const textResource = desktop.root.querySelector("[data-editor-column='resource']");
  const textComments = desktop.root.querySelector("[data-editor-column='comments']");
  const textTools = textResource.querySelector("[data-editor-tools]");
  assert.equal(columnIndex(textResource, textTools) < columnIndex(textResource, textResource.querySelector("[data-source]")), true);
  assert.equal(textTools.querySelector("[data-action='watch']") != null, true);
  assert.equal(textResource.querySelector("[data-source]") != null, true);
  assert.equal(textResource.querySelector("[data-draft]"), null);
  assert.equal(textResource.querySelector("[data-action='save-range']"), null);
  assert.equal(textResource.querySelector("[data-action='replace-document']"), null);
  assert.equal(textResource.querySelector("[data-void-body]").getAttribute("contenteditable"), "true");
  assert.equal(textComments.querySelector("[data-comment]") != null, true);
  assert.equal(textComments.querySelector("[data-source]"), null);

  const css = await readFile("gui/app/styles.css", "utf8");
  const modern = css.split('[data-look="high-contrast"]')[0];
  const contrast = css.split('[data-look="high-contrast"]')[1];
  assert.match(modern, /--editor-side:\s*228px/);
  assert.match(modern, /--editor-comments:\s*368px/);
  assert.match(contrast, /--editor-side:\s*240px/);
  assert.match(contrast, /--editor-comments:\s*380px/);
  assert.match(css, /\.workspace-editor\s*\{[^}]*grid-template-columns:\s*var\(--editor-side\)\s+minmax\(0,\s*1fr\)\s+var\(--editor-comments\)/);
});

test("a narrow desktop keeps the main column and dismisses the side panels", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 320, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  assert.equal(desktop.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), false);
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']"), null);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), true);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector(".side").className.includes("is-open"), false);
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-editor-column='resource']"), "The board column did not stay available.");
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").className.includes("is-open"), false);
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").className.includes("is-open"), false);
  click(desktop.root.querySelector("[data-action='toggle-comments']"));
  assert.equal(desktop.root.querySelector("[data-editor-column='comments']").className.includes("is-open"), true);
  click(desktop.root.querySelector("[data-action='toggle-catalog']"));
  assert.equal(desktop.root.querySelector("[data-editor-column='catalog']").className.includes("is-open"), true);
  desktop.app.language = "es";
  desktop.app.look = "high-contrast";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector(".shell").getAttribute("data-layout"), "desktop");
  assert.equal(desktop.root.querySelector("[data-action='toggle-catalog']").textContent, text("es", "hideCatalog"));
  assert.equal(desktop.root.querySelector("[data-action='toggle-comments']").textContent, text("es", "hideComments"));
  const css = await readFile("gui/app/styles.css", "utf8");
  const start = css.indexOf("@media (max-width: 987px)");
  const narrow = css.slice(start, css.indexOf("@media", start + 10));
  assert.match(narrow, /\.workspace\.workspace-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.equal(narrow.includes("var(--editor-side)"), false);
  assert.equal(narrow.includes("var(--editor-comments)"), false);
  assert.equal(narrow.includes("minmax(180px"), false);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.shell \* \{\s*min-width:\s*0;\s*\}/);
  assert.match(css, /\.modes\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("board nodes and named controls are available from the keyboard", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-node][tabindex='0']"), "The board node was not keyboard focusable.");
  const node = desktop.root.querySelector("[data-node][tabindex='0']");
  assert.equal(node.getAttribute("role"), "treeitem");
  assert.equal(node.getAttribute("aria-label").length > 0, true);
  const host = node.closest(".board-host");
  for (const handler of host.listeners.get("keydown") ?? []) handler({ key: "Enter", target: node, preventDefault() {} });
  assert.equal(desktop.app.editors.commentTarget.kind, "node");
  assert.equal(desktop.app.editors.commentTarget.nodeId, node.getAttribute("data-node"));
  const outline = desktop.root.querySelector(".board-outline");
  assert.equal(outline.getAttribute("aria-label"), "Screens and nodes");
  const item = outline.querySelector("[data-outline]");
  click(item);
  assert.equal(desktop.app.editors.selectedNodeId ?? desktop.app.editors.commentTarget.screenId, item.getAttribute("data-outline"));
  const asset = desktop.root.querySelector("[data-asset]");
  assert.equal(asset.closest("label").querySelector(".field-label").textContent, "Upload");
  assert.equal(asset.getAttribute("aria-describedby"), asset.closest("label").querySelector(".field-hint").getAttribute("id"));
  assert.equal(desktop.root.querySelector("[data-node-name]").closest("label").querySelector(".field-label").textContent, "Node name");
  assert.equal(desktop.root.querySelector("[data-draft]"), null);
  const comment = desktop.root.querySelector("[data-comment]");
  assert.equal(comment.closest("label").querySelector(".field-label").textContent, "Reply on the board");
  assert.equal(comment.closest("label").querySelector(".field-hint").textContent, "Choose a screen or node, then write the comment.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not open.");
  assert.equal(desktop.root.querySelector("[data-source]").closest("label").querySelector(".field-label").textContent, "Source");
  assert.equal(desktop.root.querySelector("[data-source]").closest("[data-source-edit]") != null, true);
  click(desktop.root.querySelector("[data-action='open-create']"));
  assert.equal(desktop.document.querySelector("[data-field='create-project']").closest("label").querySelector(".field-hint").textContent, "The text's file lives in this repository");

  navigate(desktop.app, "map");
  await waitFor(() => desktop.root.querySelector("[data-action='new-cluster']"), "The unit control did not return.");
  click(desktop.root.querySelector("[data-action='new-cluster']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='cluster']"), "The unit dialog did not open.");
  const dialog = desktop.document.querySelector("[data-start-dialog='cluster']");
  const heading = dialog.querySelector("h2");
  assert.equal(dialog.getAttribute("aria-labelledby"), heading.getAttribute("id"));
  assert.match(heading.getAttribute("id"), /^dialog-title-\d+$/);
  const firstId = heading.getAttribute("id");
  click(dialog.querySelector("[data-action='cancel-cluster']"));
  click(desktop.root.querySelector("[data-action='new-cluster']"));
  await waitFor(() => desktop.document.querySelector("[data-start-dialog='cluster']")?.querySelector("h2")?.getAttribute("id") !== firstId, "The second dialog reused the heading id.");

  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-addresses]"), "The address field did not open.");
  assert.equal(desktop.root.querySelector("[data-addresses]").closest("label").querySelector(".field-label").textContent, "Addresses");

  navigate(desktop.app, "chats");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The composer did not open.");
  assert.equal(desktop.root.querySelector("[data-composer]").closest("label").querySelector(".field-label").textContent, "Message");

  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "single");
  await waitFor(() => desktop.root.querySelector("[data-note='project:shop:030']"), "The return note did not appear.");
  const note = desktop.root.querySelector("[data-note='project:shop:030']");
  assert.equal(note.closest("label").querySelector(".field-label").textContent, "Send back");
  assert.equal(note.getAttribute("aria-describedby"), note.closest("label").querySelector(".field-hint").getAttribute("id"));

  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-note='project:shop:030']").closest("label").querySelector(".field-label").textContent, "Devolver");
});

test("Focus keeps only the readable document until the pointer reveals its tools", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.layout === 'desktop' && !desktop.app.bootReading && desktop.app.store.capabilities.includes('editor.read'), "The desktop shell did not become ready.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='enter-focus']"), "The Focus control did not appear.");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
  const reading = desktop.root.querySelector("[data-focus-layout]");
  assert.equal(reading?.getAttribute("data-focus-layout"), "document");
  assert.equal(desktop.root.querySelector(".workspace-focus")?.children.length, 1);
  assert.equal(textNodes(reading.querySelector(".void-page")).some((node) => node.textContent.includes("Welcome")), true);
  assert.equal(reading.querySelector("[data-tools]")?.getAttribute("data-tools"), "hidden");
  assert.equal(desktop.root.querySelector("[data-editor-column]"), null);
  assert.equal(desktop.root.querySelector("[data-editor-tools]"), null);
  assert.equal(desktop.root.querySelector("[data-comment]"), null);
  assert.equal(desktop.root.querySelector(".side"), null);
  assert.equal(desktop.root.querySelector(".inspector"), null);
  assert.equal(desktop.root.querySelector(".foot") != null, true);
  for (const look of ["high-contrast", "modern"]) {
    desktop.app.look = look;
    renderShell(desktop.app);
    assert.equal(desktop.app.look, look);
    assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
    assert.equal(desktop.root.querySelector("[data-editor-column]"), null);
    assert.equal(desktop.root.querySelector(".void-page") != null, true);
  }
  const stale = desktop.root.querySelector("[data-action='enter-focus']");
  for (const handler of desktop.root.listeners?.get("pointermove") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "visible");
  assert.equal(desktop.root.querySelector(".void-tools")?.className.includes("is-visible"), true);
  for (const handler of desktop.view.listeners?.get("keydown") ?? []) {
    handler({ key: "Escape", target: { tagName: "BODY" }, preventDefault() {} });
  }
  const fresh = desktop.root.querySelector("[data-action='enter-focus']");
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
  assert.equal(fresh != null && fresh !== stale, true);
  assert.equal(desktop.document.activeElement === fresh, true);
  assert.equal(fresh.closest("[data-editor-layout]")?.getAttribute("data-editor-layout"), "document");
  navigate(desktop.app, "focus");
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "focus");
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "hidden");
  const css = await readFile("gui/app/styles.css", "utf8");
  const focusCss = css.slice(css.indexOf('[data-mode="focus"]'));
  assert.match(focusCss, /background:\s*#000000/);
  assert.match(focusCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(focusCss, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(focusCss, /\[data-mode="focus"\] \.foot[\s\S]*display:\s*none/);
  assert.match(focusCss, /box-shadow:\s*none/);
});

test("Find controls navigate source matches replace one or all texts and Undo the complete last batch", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root } = desktop;
  await openCommentEditor(desktop, 'void');
  const workers = [];
  app.createFindWorker = () => {
    const worker = { terminated: false, terminate() { this.terminated = true; }, postMessage(data) { queueMicrotask(() => {
      if (this.terminated || data.query === '(a+)+$') return;
      try { this.onmessage({ data: { id: data.id, matches: findTextMatches(data.text, data.query, data.options) } }); }
      catch (error) { this.onmessage({ data: { id: data.id, error: { code: error instanceof RangeError ? 'too_many_matches' : 'invalid_pattern', message: error.message } } }); }
    }); } };
    workers.push(worker); return worker;
  };
  const editor = app.editors.current;
  typeInput(root.querySelector('[data-source]'), '**cat** cat 😀', 0, 0);
  await editor.voidSaver.flush(); renderShell(app);
  await createResource(app.api, 'void', { project: 'shop', path: 'docs/find-second.json', document: { formatVersion: 1, id: 'find-second', title: 'Other text', pages: [{ k: 'One', en: 'cat cat' }, { k: 'Two', en: 'cat' }] } });
  click(root.querySelector('[data-action="toggle-find"]'));
  typeInput(root.querySelector('[data-find-field="query"]'), 'cat', 3, 3);
  await waitFor(() => !app.voidFind.pending && app.voidFind.matches.length === 2, 'Find did not return both matches.');
  assert.equal(root.querySelector('[data-find-count]').textContent, '1 of 2');
  assert.equal(root.querySelector('[data-find-hits]').getAttribute('data-find-hits'), '2');
  const toggles = root.querySelectorAll('.void-find-option');
  assert.deepEqual(toggles.map((node) => node.textContent), ['Aa', 'W', '.*']);
  assert.ok(toggles.every((node) => node.getAttribute('aria-label') && node.getAttribute('title')));
  const selection = { get isCollapsed() { return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; }, setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); } };
  desktop.document.getSelection = () => selection;
  const firstRun = textNodes(root.querySelector('[data-void-body]')).find((node) => node.textContent === 'cat');
  selection.setBaseAndExtent(firstRun, 0, firstRun, 0); root.querySelector('[data-void-body]').focus(); editor.captureSelection();
  click(root.querySelector('[data-action="find-next"]'));
  assert.equal(root.querySelector('[data-find-count]').textContent, '2 of 2');
  assert.deepEqual(editor.textSelections.get(`${editor.resourceId}\0${editor.page}\0en`), { start: 8, end: 11 });
  click(root.querySelector('[data-action="find-previous"]'));
  typeInput(root.querySelector('[data-find-field="replacement"]'), 'dog', 3, 3);
  click(root.querySelector('[data-action="replace-match"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 1, 'Replace did not update the current hit.');
  assert.equal(editor.authoritative.document.pages[0].en, '**dog** cat 😀');
  click(root.querySelector('[data-action="find-all"]'));
  await waitFor(() => !app.voidFind.pending && app.voidFind.matches.length === 4, 'All texts did not include every page.');
  assert.equal(root.querySelector('[data-action="replace-all"]').textContent, 'Replace all 4');
  click(root.querySelector('[data-action="find-next"]'));
  await waitFor(() => app.editors.current.authoritative.title === 'Other text', 'Next did not open the matching text.');
  assert.equal(app.voidFind.matches.length, 4);
  click(root.querySelector('[data-action="find-next"]')); click(root.querySelector('[data-action="find-next"]'));
  assert.equal(app.editors.current.page, 'Two');
  click(root.querySelector('[data-action="replace-all"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 0, 'Replace all did not commit.');
  // The first text was left clean, so switching dropped its copy; the saved text is read back.
  const firstText = async () => (await request(app.api, 'GET', '/void/texts/:resourceId', { params: { resourceId: editor.resourceId } })).data.document.pages[0].en;
  assert.equal(await firstText(), '**dog** dog 😀');
  click(root.querySelector('[data-action="undo-replace"]'));
  await waitFor(() => !app.voidFind.pending && !app.voidFind.busy && app.voidFind.matches.length === 4, 'Undo did not restore the whole replacement batch.');
  assert.equal(await firstText(), '**dog** cat 😀');
  click(root.querySelector('[data-action="find-regularExpression"]'));
  typeInput(root.querySelector('[data-find-field="query"]'), '[', 1, 1);
  await waitFor(() => root.querySelector('[data-find-error="invalid_pattern"]'), 'Invalid regex did not show an error.');
  assert.equal(root.querySelector('[data-action="replace-all"]').getAttribute('disabled'), '');
  typeInput(root.querySelector('[data-find-field="query"]'), '(a+)+$', 6, 6);
  await waitFor(() => root.querySelector('[data-find-error="pattern_too_slow"]'), 'A slow regex did not terminate.');
  assert.equal(root.querySelector('[data-find-error]').textContent, text('en', 'findSlow'));
  assert.equal(root.querySelector('[data-action="replace-match"]').getAttribute('disabled'), '');
  click(root.querySelector('[data-action="toggle-find"]'));
  assert.equal(root.querySelector('[data-find-bar]'), null); assert.ok(workers.every((worker) => worker.terminated));
});

test("Void keeps the source selection and draft through formatting, Source, Focus and page arrows", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-void-body]"), "The document did not open.");
  const editor = desktop.app.editors.current;
  editor.voidSaver = documentSaver(desktop.app.api, editor, () => {}, 10000);
  const source = "# Title\r\n\r\n<b>A😀</b> **bold**\r\nSecond";
  typeInput(desktop.root.querySelector("[data-source]"), source, 0, 0);
  renderShell(desktop.app);
  const selection = {
    get isCollapsed() { return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; },
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); },
  };
  desktop.document.getSelection = () => selection;
  const body = desktop.root.querySelector("[data-void-body]");
  const emoji = textNodes(body).find((node) => node.textContent === "A😀");
  selection.setBaseAndExtent(emoji, 3, emoji, 1);
  body.focus();
  editor.captureSelection(); editor.updateFormats();
  const bar = desktop.root.querySelector("[data-format-bar]");
  assert.equal(bar.getAttribute("hidden"), null);
  assert.deepEqual(bar.querySelectorAll("[data-format]").map((node) => node.getAttribute("data-format")),
    ["bold", "italic", "strikethrough", "h1", "h2", "h3", "list", "quote", "code", "link", "table", "image", "comment"]);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  let input = desktop.root.querySelector("[data-source]");
  assert.equal(input.value, source);
  assert.equal(input.selectionStart, source.indexOf("😀"));
  assert.equal(input.selectionEnd, source.indexOf("😀") + 2);
  assert.equal(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`).backward, true);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  assert.equal(selection.anchorOffset, 3); assert.equal(selection.focusOffset, 1);
  click(desktop.root.querySelector("[data-format='bold']"));
  const formatted = source.replace("😀", "**😀**");
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), formatted);
  const formattedEmoji = textNodes(desktop.root.querySelector("[data-void-body]")).find((node) => node.textContent === "😀");
  selection.setBaseAndExtent(formattedEmoji, 2, formattedEmoji, 2);
  editor.captureSelection(); editor.updateFormats();
  assert.equal(desktop.root.querySelector("[data-format-bar]").getAttribute("hidden"), "");
  const caret = { ...editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`) };
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  assert.equal(desktop.app.editors.current === editor, true);
  assert.equal(editor.page, "Intro.Welcome");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "ArrowRight", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(editor.page, "Notes.Next");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "ArrowLeft", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(editor.page, "Intro.Welcome");
  assert.deepEqual(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`), caret);
  for (const handler of desktop.root.listeners.get("pointermove") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]").getAttribute("data-tools"), "visible");
  for (const handler of desktop.view.listeners.get("keydown") ?? []) handler({ key: "Escape", target: desktop.root.querySelector("[data-void-body]"), preventDefault() {} });
  assert.equal(desktop.app.mode, "document");
  assert.equal(desktop.app.editors.current.resourceId, notes.id);
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), formatted);
  assert.deepEqual(editor.textSelections.get(`${notes.id}\0Intro.Welcome\0en`), caret);
  assert.equal(desktop.root.querySelector("[data-action='save-range']"), null);
  assert.equal(desktop.root.querySelector("[data-action='replace-document']"), null);
  desktop.app.language = "es"; renderShell(desktop.app);
  assert.equal(editor.language, "es");
  desktop.app.language = "en"; renderShell(desktop.app);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  input = desktop.root.querySelector("[data-source]");
  assert.equal(input.value, formatted);
  assert.equal(input.selectionStart, caret.start); assert.equal(input.selectionEnd, caret.end);
  const mappedSource = "## Chats and mailboxes\r\n\r\nEdited here.";
  typeInput(input, mappedSource, mappedSource.length, mappedSource.length);
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  const editedText = textNodes(desktop.root.querySelector("[data-void-body]")).find(node => node.textContent === "Edited here.");
  assert.ok(editedText, "The edited paragraph did not render in Document view.");
  selection.setBaseAndExtent(editedText, 6, editedText, 6);
  desktop.root.querySelector("[data-void-body]").focus();
  const sourceToggle = desktop.root.querySelector("[data-action='toggle-source']");
  for (const handler of sourceToggle.listeners.get("pointerdown") ?? []) handler();
  click(sourceToggle);
  input = desktop.root.querySelector("[data-source]");
  assert.equal(input.selectionStart, mappedSource.indexOf("Edited here.") + 6);
  assert.equal(input.selectionEnd, mappedSource.indexOf("Edited here.") + 6);
});

test("Void shows Not saved and retries the captured operation before saving later typing", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const attempts = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], (url, init) => {
    if (init.method === "PUT" && String(url).includes("/void/texts/")) attempts.push({ key: init.headers["Idempotency-Key"], body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The document did not open.");
  const editor = desktop.app.editors.current;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/void/texts/${notes.id}`, dropAfterCommit: true });
  typeInput(desktop.root.querySelector("[data-source]"), "**First 😀**", 2, 2);
  await assert.rejects(editor.voidSaver.flush());
  assert.equal(desktop.root.querySelector("[data-void-save]").textContent, "Not saved");
  assert.equal(desktop.root.querySelector("[data-void-error]").querySelector("span").textContent, text("en", "voidSaveError"));
  assert.equal(textDraft(editor, notes.id, "Intro.Welcome", "en"), "**First 😀**");
  typeInput(desktop.root.querySelector("[data-source]"), "**Later 😀**", 2, 2);
  click(desktop.root.querySelector("[data-action='retry-void-save']"));
  await waitFor(() => editor.saveState === "saved", "The retained save and later typing did not finish.");
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.notEqual(attempts[2].key, attempts[1].key);
  assert.equal(attempts[2].body.document.pages[0].en, "**Later 😀**");
  assert.equal(editor.authoritative.document.pages[0].en, "**Later 😀**");
  assert.equal(editor.textDrafts.size, 0);
  assert.equal(editor.authoritative.document.sentinel, "void-sentinel");
  assert.equal(editor.authoritative.document.pages[0].sentinel, "void-page-sentinel");
  assert.equal(desktop.root.querySelector("[data-void-error]"), null);
  assert.equal(desktop.root.querySelector("[data-void-save]").textContent, "Saved");
});

test("mounted map circles use translated status and keep pan", async (t) => {
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
  assert.equal(overseer.querySelector("[data-map-label]").textContent, "overseer");
  assert.equal(lead.getAttribute("data-ring"), "lead");
  assert.equal(lead.className.includes("is-lead"), true);
  assert.equal(shop.getAttribute("data-role"), executor.role);
  assert.equal(shop.querySelector("[data-map-label]").textContent, executor.unit);
  assert.equal(desktop.root.querySelector("[data-action='pan']") != null, true);
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
  const limitText = desktop.root.querySelector("[data-limits='paused']").textContent;
  assert.equal(limitText.includes(retryAt), false);
  assert.equal(limitText.includes(String(new Date(retryAt).getFullYear())), true);
  assert.equal(limitText.includes("T"), false);
  const usage = desktop.root.querySelector("[data-limit-usage]")?.textContent ?? "";
  assert.equal(usage.includes("61 of 60"), true);
  assert.equal(usage.includes("50,000,000"), true);
  assert.equal(usage.includes("50000000"), false);
  await fixture.control.emit("service.changed", { machine: { id: "LAPTOP", version: "3.0.1", state: "running", answers: true } });
  await waitFor(() => desktop.root.querySelector("[data-service-machine]")?.getAttribute("data-service-machine") === "LAPTOP", "The service machine was not updated.");
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: false });
  await waitFor(() => [...desktop.root.querySelector("[data-issues]").children].some((node) => node.textContent === "The unit file is unreadable."), "The issue was not shown.");
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-sync='paused']")?.textContent, "La sincronización está en pausa");
  assert.equal(desktop.root.querySelector("[data-limits='paused']").textContent.includes("en pausa"), true);
  await fixture.control.emit("issue.changed", { issue: { path: "units/shop", code: "bad_record", message: "The unit file is unreadable." }, resolved: true });
  await waitFor(() => ![...desktop.root.querySelector("[data-issues]").children].some((node) => node.textContent === "The unit file is unreadable."), "The resolved issue remained.");
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

test("request expiry stays separate from reopening guidance and comments require text", async (t) => {
  assert.equal(text("en", "sessionExpired"), "This session ended. Open HIVEM1ND again.");
  assert.equal(text("es", "sessionExpired"), "Esta sesión terminó. Abrir HIVEM1ND de nuevo.");
  assert.equal(text("en", "sessionRequestExpired"), "The session request expired.");
  assert.equal(text("es", "sessionRequestExpired"), "La solicitud de sesión expiró.");

  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const writes = [];
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    if (!init?.body || init.method !== "POST") return;
    writes.push({ url: String(input), body: JSON.parse(init.body) });
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector("[data-handle='connect']"), "The connect handle did not appear.");
  const connectLabel = () => {
    const handle = desktop.root.querySelector("[data-handle='connect']");
    const unitId = handle.getAttribute("data-unit-id");
    const named = [...desktop.root.querySelectorAll("[data-map-label]")].find((item) => item.closest("[data-unit-id]")?.getAttribute("data-unit-id") === unitId);
    return { handle, name: named.getAttribute("data-map-label") };
  };
  assert.equal(connectLabel().handle.getAttribute("aria-label"), `Connect ${connectLabel().name}`);
  desktop.app.language = "es";
  renderShell(desktop.app);
  assert.equal(connectLabel().handle.getAttribute("aria-label"), `Conectar ${connectLabel().name}`);
  desktop.app.language = "en";
  renderShell(desktop.app);

  await fixture.control.emit("session.request.changed", {
    requestId: "11111111-1111-4111-8111-111111111111",
    unitId: "root:overseer",
    machine: "DESKTOP",
    state: "expired",
    sessionId: null,
    error: null,
  });
  await waitFor(() => noteText(desktop) === "The session request expired.", "Request expiry reused the reopening sentence.");
  assert.notEqual(noteText(desktop), "This session ended. Open HIVEM1ND again.");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='comment-node']"), "The node comment control did not appear.");
  const commentBodies = () => writes.filter((item) => item.url.includes("/comments")).map((item) => item.body.text);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await delay(40);
  assert.equal(commentBodies().includes("On the node."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await delay(40);
  assert.equal(commentBodies().includes("On the node."), false);
  assert.equal(commentBodies().some((item) => item?.trim?.() === ""), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "Pinned here", 0, 11);
  click(desktop.root.querySelector("[data-action='comment-node']"));
  await waitFor(() => commentBodies().includes("Pinned here"), "The supplied node comment was not sent.");

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='reply']"), "The reply control did not appear.");
  const replies = () => writes.filter((item) => item.url.includes("/replies")).map((item) => item.body.text);
  click(desktop.root.querySelector("[data-action='reply']"));
  await delay(40);
  assert.equal(replies().includes("Noted."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "   ", 0, 3);
  click(desktop.root.querySelector("[data-action='reply']"));
  await delay(40);
  assert.equal(replies().includes("Noted."), false);
  typeInput(desktop.root.querySelector("[data-comment]"), "A reply", 0, 7);
  click(desktop.root.querySelector("[data-action='reply']"));
  await waitFor(() => replies().includes("A reply"), "The supplied reply was not sent.");
});

test("a shell refresh keeps the focused editor field and its caret", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The source field did not appear.");
  click(desktop.root.querySelector("[data-action='toggle-source']"));
  let typed = "";
  for (const letter of ["A", "B", "C"]) {
    const source = desktop.root.querySelector("[data-source]");
    typed += letter;
    source.focus();
    source.value = typed;
    source.selectionStart = typed.length;
    source.selectionEnd = typed.length;
    for (const handler of source.listeners.get("input") ?? []) handler();
    renderShell(desktop.app);
    const again = desktop.root.querySelector("[data-source]");
    const edit = desktop.root.querySelector("[data-source-edit]");
    assert.equal(edit.getAttribute("hidden"), null);
    assert.equal(again.value, typed);
    assert.equal(desktop.document.activeElement, again);
    assert.equal(again.selectionStart, typed.length);
  }
  click(desktop.root.querySelector("[data-action='open-create']"));
  const title = desktop.document.querySelector("[data-field='create-title']");
  title.focus();
  title.value = "Kept";
  title.selectionStart = 4;
  title.selectionEnd = 4;
  for (const handler of title.listeners.get("input") ?? []) handler();
  renderShell(desktop.app);
  const titleAgain = desktop.document.querySelector("[data-field='create-title']");
  assert.equal(titleAgain.value, "Kept");
  assert.equal(desktop.document.activeElement === titleAgain, true);
  assert.equal(titleAgain.selectionStart, 4);
});

test("editor forms, chats, and the inspector stay compact", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.chatList?.catalog?.length > 0, "The chat list did not load.");
  navigate(desktop.app, "chats");
  desktop.app.chatList.height = 4000;
  renderShell(desktop.app);
  const rows = desktop.app.activeRows ?? [];
  assert.equal(rows.some((row) => row.kind === "heading"), true);
  const sample = rows.find((row) => row.kind === "chat");
  assert.equal(String(sample?.text ?? "").includes(sample?.chat?.title || sample?.chat?.id || ""), true);
  if (sample?.chat?.lastMessage) {
    const snippet = sample.chat.lastMessage.body || sample.chat.lastMessage.subject || "";
    if (snippet) assert.equal(sample.text.includes(snippet), true);
    const stamp = sample.chat.lastMessage.timestamp || sample.chat.lastMessage.date || "";
    if (stamp) assert.equal(sample.text.includes(stamp), false);
  }
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-chat-title]")?.textContent === (chat.title || chat.id), "The conversation title was not shown.");
  await waitFor(() => desktop.root.querySelector(".bubble-meta"), "The message sender was not shown.");
  assert.equal(desktop.root.querySelector(".bubble-meta").textContent.includes("master"), true);
  assert.equal(desktop.root.querySelector("[data-message]")?.closest(".bubble") != null, true);
  const group = desktop.app.chatList.catalog.find((item) => (item.members?.length ?? 0) > 2);
  desktop.app.activeHandlers.onActivate({ id: group.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-chat-members]")?.textContent.includes("executor-shop"), "The group members were not shown.");
  await waitFor(() => desktop.root.querySelector("[data-own='true']"), "An own message was not marked.");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='attach']"), "The attach control did not appear.");
  const toolbar = desktop.root.querySelector("[data-toolbar='board']");
  assert.equal(toolbar?.getAttribute("role"), "toolbar");
  assert.equal(desktop.root.querySelector(".attach-list"), null);
  assert.equal(desktop.root.querySelector(".attach-chips") != null, true);
  click(desktop.root.querySelector("[data-action='attach']"));
  const chooser = desktop.document.querySelector("[data-form='attach']");
  assert.equal(chooser != null, true);
  assert.equal(chooser.querySelector("[data-attach-search]") != null, true);
  const offered = chooser.querySelectorAll("[data-attach-unit]").length;
  assert.equal(offered > 0 && offered <= 40, true);
  typeInput(chooser.querySelector("[data-attach-search]"), "zzzz", 0, 4);
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length, 0);
  chooser.close();

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-editor-column='comments']")?.querySelector(".comment-author")?.textContent === "You", "The comment author was not shown as the person.");
  const source = desktop.root.querySelector("[data-source]");
  assert.equal(source?.closest("[data-source-edit]") != null, true);
  assert.equal(desktop.root.querySelector(".reading-card") != null, true);
  await waitFor(() => desktop.root.querySelector("[data-editor-column='comments']")?.querySelector("[data-action='accept-change']"), "The proposal action was not shown.");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action='accept-change']"), null);

  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  navigate(desktop.app, "hierarchy");
  navigate(desktop.app, "map");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector(".inspector-details")?.querySelector("summary")?.textContent === "Details", "The inspector details did not appear.");
  assert.equal(desktop.root.querySelector(".unit-card") != null, true);
  assert.equal(desktop.root.querySelector("[data-unit-facts]") != null, true);
  assert.equal(desktop.root.querySelector("[data-action-cards]")?.querySelector("[data-task]") != null, true);
  desktop.app.actionNote = "The task is done.";
  desktop.app.actionCode = "done";
  desktop.app.actionScope = "unit";
  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action-note]"), null);
  assert.equal(desktop.app.actionNote, "The task is done.");
  assert.equal(desktop.document.querySelector("[data-live='status']").textContent.includes("The task is done."), false);
  assert.equal(desktop.document.querySelector("[data-live='error']").textContent.includes("The task is done."), false);
  assert.equal(desktop.document.querySelectorAll("[data-live='status']").length, 1);
  assert.equal(desktop.document.querySelectorAll("[data-live='error']").length, 1);
  navigate(desktop.app, "map");
  assert.equal(desktop.root.querySelector(".inspector-body")?.querySelector("[data-action-note]")?.textContent, "The task is done.");
  desktop.app.actionScope = "editor";
  navigate(desktop.app, "blueprint");
  assert.equal(desktop.root.querySelector("[data-editor-column='resource']")?.querySelector("[data-action-note]")?.textContent, "The task is done.");
});

test("editor events refresh attachments, assets, delivery and conflicts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === cart.id && desktop.root.querySelector("[data-comment]"), "The board did not open.");
  desktop.app.editors.selectedNodeId = "kept-node";
  desktop.app.editors.current.selectedNodeId = "kept-node";
  typeInput(desktop.root.querySelector("[data-comment]"), "Keep this draft", 0, 4);

  await fixture.control.emit("editor.attachments.changed", {
    resourceId: cart.id,
    attached: ["env:web:overlord-web"],
    revision: "a".repeat(64),
  });
  await waitFor(() => desktop.root.querySelector("[data-chip='env:web:overlord-web']"), "The attachment chip did not refresh.");

  desktop.app.editors.current.attachmentChoice = new Set(["project:shop:executor-shop"]);
  await fixture.control.emit("editor.attachments.changed", {
    resourceId: cart.id,
    attached: ["root:master"],
    revision: "b".repeat(64),
  });
  await waitFor(() => desktop.root.querySelector("[data-attachment-conflict]"), "The attachment draft was not kept.");
  assert.equal(desktop.app.editors.current.attachmentChoice.has("project:shop:executor-shop"), true);
  assert.equal(desktop.app.editors.current.attachmentChoice.has("root:master"), false);

  await fixture.control.emit("editor.asset.created", {
    resourceId: cart.id,
    asset: {
      id: "mark",
      src: "assets/mark.png",
      contentType: "image/png",
      bytes: 8,
      revision: "c".repeat(64),
      url: "/api/v1/missing-asset",
    },
  });
  await waitFor(() => desktop.app.editors.current.assetRecords?.some((item) => item.id === "mark"), "The asset was not recorded.");
  assert.equal(desktop.app.editors.selectedNodeId, "kept-node");

  await fixture.control.emit("notification.changed", {
    noticeKey: "watch",
    unitId: "env:web:overlord-web",
    resourceId: cart.id,
    state: "failed",
    error: { code: "not_attached", message: "The unit is not attached." },
  });
  await waitFor(() => desktop.root.querySelector("[data-notice='failed']"), "The delivery failure was not shown.");
  assert.equal(desktop.document.querySelector("[data-live='error']")?.textContent, "The notice failed. Nothing was delivered.");

  await fixture.control.emit("sync.conflict", {
    target: { kind: "mind", path: "units/shop.md" },
    winnerMachine: "OTHER",
    copyPath: "conflicts/shop.md",
    at: "2026-10-10T12:00:00.000Z",
  });
  await waitFor(() => desktop.root.querySelector("[data-sync-conflict]")?.textContent.includes("conflicts/shop.md"), "The sync conflict was not shown.");
  assert.equal(desktop.document.querySelector("[data-live='error']")?.textContent.includes("conflicts/shop.md"), true);
  assert.equal(desktop.root.querySelector("[data-comment]").value, "Keep this draft");
  assert.equal(desktop.app.editors.selectedNodeId, "kept-node");
});

test("phone navigation stays compact and focus can leave the source", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const phone = await bootApp(fixture.phoneUrl, 390, []);
  t.after(() => dispose(phone.app));
  await waitFor(() => phone.root.querySelector(".shell")?.getAttribute("data-layout") === "phone", "The phone shell did not appear.");
  assert.equal([...phone.root.querySelectorAll("h2")].some((node) => node.textContent === "Snapshot"), false);
  assert.equal(phone.root.querySelector("[data-phone-issues]")?.querySelector("summary")?.textContent.includes("issues"), true);
  assert.equal(phone.root.querySelector("[data-phone-title]")?.textContent, "Hierarchy");
  assert.equal(phone.root.querySelector("[data-phone-hint]")?.textContent, "Use the bottom buttons to switch views.");
  assert.equal(phone.root.querySelector("[data-phone-mode='hierarchy']")?.getAttribute("aria-pressed"), "true");
  await waitFor(() => phone.app.chatList?.catalog?.length, "The phone chat list did not load.");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  const chat = phone.app.chatList.catalog.find(chat => chat.kind === 'direct');
  phone.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("[data-stage-title]")?.textContent === (chat.title || chat.id), "The phone conversation title was not shown.");
  assert.equal(phone.root.querySelector("[data-stage-title]").textContent === "Hierarchy", false);
  await waitFor(() => phone.root.querySelector(".bubble-meta"), "The phone message sender was not shown.");
  await waitFor(() => {
    const wanted = (phone.app.waitingList?.items ?? []).some((item) => item.kind === "approval" || item.kind === "review");
    return !wanted || phone.root.querySelector("[data-phone-card]");
  }, "The phone approval card did not appear.");
  const group = phone.app.chatList.catalog.find((item) => (item.members?.length ?? 0) > 2);
  phone.app.activeHandlers.onActivate({ id: group.id, kind: "chat" }, "double");
  await waitFor(() => phone.root.querySelector("h1")?.textContent === (group.title || group.id), "The phone heading did not follow the group.");
  click(phone.root.querySelector("[data-phone-mode='waiting']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === "Waiting", "Waiting kept the conversation title.");
  assert.equal(phone.document.title, "Waiting · HIVEM1ND");
  assert.equal(phone.root.querySelector("[data-stage-title]")?.textContent, "Waiting");
  assert.equal(phone.root.querySelector(".side"), null);
  assert.equal(phone.root.querySelector("[data-phone-mode='waiting']")?.getAttribute("aria-pressed"), "true");
  assert.equal(phone.root.querySelector("[data-phone-mode='chats']")?.getAttribute("aria-pressed"), "false");
  click(phone.root.querySelector("[data-phone-mode='chats']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === (group.title || group.id), "The chat title did not return.");
  assert.equal(phone.root.querySelector("[data-phone-mode='chats']")?.getAttribute("aria-pressed"), "true");
  click(phone.root.querySelector("[data-phone-mode='hierarchy']"));
  await waitFor(() => phone.root.querySelector("h1")?.textContent === "Hierarchy", "Hierarchy did not restore its title.");
  assert.equal(phone.root.querySelector("[data-phone-mode='hierarchy']")?.getAttribute("aria-pressed"), "true");
  assert.equal(phone.document.title, "Hierarchy · HIVEM1ND");
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.shell\[data-layout="phone"\] \.phone-nav button\[aria-pressed="true"\]/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /border-radius:\s*var\(--radius-pill\)/);

  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='enter-focus']"), "The Focus control did not appear.");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  const source = desktop.root.querySelector("[data-source]");
  source.focus();
  for (const handler of desktop.view.listeners?.get("keydown") ?? []) {
    handler({ key: "Escape", target: source, preventDefault() {} });
  }
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
  click(desktop.root.querySelector("[data-action='enter-focus']"));
  for (const handler of desktop.root.listeners?.get("focusin") ?? []) handler();
  assert.equal(desktop.root.querySelector("[data-tools]")?.getAttribute("data-tools"), "visible");
  assert.equal(desktop.root.querySelector("[data-action='leave-focus']")?.textContent, "Document");
  assert.equal(desktop.root.querySelector("[data-focus-hint]") != null, true);
  click(desktop.root.querySelector("[data-action='leave-focus']"));
  assert.equal(desktop.root.querySelector(".shell")?.getAttribute("data-mode"), "document");
});

test("disabled controls explain how to continue", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.unitList?.catalog?.some((unit) => unit.id === "project:shop:executor-shop"), "The unit list did not load.");
  const executor = desktop.app.unitList.catalog.find((unit) => unit.id === "project:shop:executor-shop");
  desktop.app.activeHandlers.onActivate({ id: executor.id, kind: "unit", unit: executor }, "double");
  await waitFor(() => desktop.root.querySelector("[data-task='project:shop:030']")?.querySelector("[data-disabled-reason='accept']")?.textContent === "Accept is available when the task is in review.", "The accept reason was not shown.");
  navigate(desktop.app, "settings");
  await waitFor(() => desktop.root.querySelector("[data-look='modern']")?.closest("button").getAttribute("aria-pressed") === "true", "The current look was not marked.");
  assert.equal(desktop.root.querySelector("[data-look='high-contrast']")?.closest("button").getAttribute("aria-pressed"), "false");
  assert.equal(desktop.root.querySelector("[data-language='en']")?.getAttribute("aria-pressed"), "true");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='resize-screen']"), "The resize control did not appear.");
  assert.equal(desktop.root.querySelector("[data-action='patch-node']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-action='remove-node']")?.getAttribute("disabled"), "");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='node']")?.textContent, "Select a shape on the board first.");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='add-link']")?.textContent, "A link needs two screens.");
  typeInput(desktop.root.querySelector("[data-field='screen-width']"), "no", 0, 2);
  click(desktop.root.querySelector("[data-action='resize-screen']"));
  await waitFor(() => noteText(desktop) === "Enter a whole width and height before resizing.", "The resize reason was not shown.");
});

test("an editor action names its failure and waits inside its dialog", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let nodePosts = 0;
  let releaseNodes = () => {};
  const nodeHold = new Promise((resolve) => { releaseNodes = resolve; });
  let attachPosts = 0;
  let releaseAttach = () => {};
  const attachHold = new Promise((resolve) => { releaseAttach = resolve; });
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
    const target = String(input);
    if (init?.method === "POST" && target.includes("/nodes")) {
      nodePosts += 1;
      if (nodePosts === 1) await nodeHold;
    }
    if (init?.method === "PUT" && target.includes("/attachments")) {
      attachPosts += 1;
      if (attachPosts === 1) await attachHold;
    }
  });
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-action='add-node']"), "The shape control did not appear.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  await waitFor(() => nodePosts === 1, "The shape write did not start.");
  click(desktop.root.querySelector("[data-action='add-node']"));
  assert.equal(nodePosts, 1);
  releaseNodes();
  await waitFor(() => desktop.app.editors.current?.authoritative?.document?.screens?.some((screen) => screen.root.kids.some((node) => node.name === "Added")), "The shape was not saved.");

  desktop.app.mode = "map";
  desktop.app.chatList.status = "empty";
  desktop.app.chatList.query = "";
  desktop.app.tab = "chats";
  renderShell(desktop.app);
  const listed = desktop.root.querySelector(".list-total");
  assert.equal(listed?.getAttribute("data-list-status"), "empty");
  assert.equal(listed?.textContent, "No conversations yet.");
  assert.equal(desktop.root.querySelector("[data-action='show-map']")?.textContent, "Show the map");

  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.root.querySelector("[data-action='attach']"), "The attach control did not return.");
  click(desktop.root.querySelector("[data-action='attach']"));
  const chooser = desktop.document.querySelector("[data-form='attach']");
  click(chooser.querySelector("[data-attach-unit]"));
  click(chooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => chooser.querySelector("[data-attach-progress]") && chooser.getAttribute("open") != null, "The attach dialog closed before the save finished.");
  releaseAttach();
  await waitFor(() => desktop.document.querySelector("[data-form='attach']") == null, "The saved attach dialog stayed open.");
  assert.equal(attachPosts, 1);

  const resourceId = desktop.app.editors.current.resourceId;
  fixture.control.setFault({ method: "PUT", path: `/api/v1/editors/${resourceId}/attachments`, status: 422, code: "invalid_body" });
  click(desktop.root.querySelector("[data-action='attach']"));
  const failedChooser = desktop.document.querySelector("[data-form='attach']");
  click(failedChooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => failedChooser.querySelector("[data-dialog-error]")?.textContent.includes("Attach failed."), "The failed attach did not stay in the dialog.");
  assert.equal(failedChooser.getAttribute("open") != null, true);
  const retry = failedChooser.querySelector("[data-action='save-attachments']");
  assert.equal(retry.children.some((child) => child.textContent === "Retry"), true);
  click(retry);
  await waitFor(() => desktop.document.querySelector("[data-form='attach']") == null, "Retry did not finish the attach save.");
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
  assert.equal(desktop.document.title, "Map · HIVEM1ND");
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
  assert.equal(desktop.document.title, "Mapa · HIVEM1ND");
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
  assert.equal(root.querySelector("h1").textContent, "Abrir el M1ND");
  assert.equal(document.documentElement.lang, "es");
  dispose(app);
  const storage = new Map([["hivem1nd:language", "en"]]);
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
  assert.equal(root.querySelector("h2").textContent, "Leyendo el M1ND");
  assert.equal(document.documentElement.lang, "es");
  const stored = new Map([["hivem1nd:language", "es"]]);
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
  assert.equal(storedRoot.querySelector("h2").textContent, "Leyendo el M1ND");
  release();
  const app = await pending;
  const storedApp = await storedBoot;
  t.after(() => { dispose(app); dispose(storedApp); });
  await patient(() => [app, storedApp].every(mounted => mounted.bootSettled && !mounted.bootReading
    && mounted.store.snapshotReady && mounted.store.viewer), 'The authoritative viewer presentation did not finish.');
  assert.equal(app.language, "en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(storage.get("hivem1nd:language"), "en");
  assert.equal(stored.get("hivem1nd:language"), "en");
});

test("settings do not replace the opening language before the viewer can be read", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  let settled = 0;
  const storage = new Map([["hivem1nd:language", "es"]]);
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
  assert.equal(root.querySelector("h2").textContent, "Leyendo el M1ND");
  assert.equal(storage.get("hivem1nd:language"), "es");
  release();
  const app = await pending;
  t.after(() => dispose(app));
});

test("the opening frame shows a stored view and renders again when the read arrives", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const live = (await request(apiFrom(fixture.desktopUrl), "GET", "/view")).data;
  const liveBoards = (live.editors ?? []).filter((editor) => editor.kind === "blueprint").length;
  const liveText = `${live.counts.units} units, ${live.groups?.length ?? 0} groups, ${live.counts.chats} chats, ${liveBoards} boards`;
  const storage = new Map([["hivem1nd:opening-view", JSON.stringify({ counts: { units: 424242, chats: 2 }, groupCount: 1, boardCount: 3 })]]);
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
  await waitFor(() => root.querySelector("[data-boot]")?.getAttribute("data-boot") === "reading" && root.querySelector(".opening-counts")?.textContent === liveText, "The opening frame did not show the view that arrived.");
  release();
  const app = await pending;
  t.after(() => dispose(app));
  assert.deepEqual(JSON.parse(storage.get("hivem1nd:opening-view")), { counts: { units: live.counts.units, chats: live.counts.chats }, groupCount: live.groups?.length ?? 0, boardCount: liveBoards });
});

test("a delayed initial read keeps the desktop frame and skeleton panels visible", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const { document, root } = createTestDocument(1440);
  const url = new URL(fixture.desktopUrl);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = mount(root, {
    location: url, history: { replaceState() {} }, mindPath: join(fixture.root, "Cosmic", "hivem1nd"),
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
  assert.equal(root.querySelector("h2").textContent, "No se puede leer el M1ND");
  assert.equal(root.querySelector("[data-action='choose-folder']").textContent, "Elegir otra carpeta");
  assert.equal(root.querySelector("[data-opening-cause]").textContent.includes("no respondió en 30 s"), true);
  t.mock.timers.reset();
});

test("an inaccessible-folder cause exposes no credential and choosing another folder retains drafts", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const selected = join(fixture.root, "Cosmic", "hivem1nd");
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
  await writeFile(fixture.paths.configFile, JSON.stringify({ format: "hivem1nd-service-config-v1", mindPath: fixture.paths.mind, machine: fixture.machine, origin: { kind: "folder", path: origin }, stagingPath: fixture.paths.staging, port: 0 }));
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
  assert.equal(storage.get(`hivem1nd:overseer:${desktop.app.selectedFolder}`), 'dismissed');
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
  navigate(desktop.app, "focus");
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
  assert.match(dialog.querySelector("p").textContent, /executor-shop will report to overlord-web/);
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
  for (const host of [desktop.root.querySelector(`[data-id="${id}"]`), desktop.root.querySelector(`[data-unit-id="${id}"]`), desktop.root.querySelector(".chat-title"), desktop.root.querySelector(".unit-card")]) {
    assert.equal(host.querySelector(".unit-alias").textContent, "Blog");
    assert.equal(host.querySelector(".unit-original").textContent, "executor-shop");
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
  en: ['HIVEM1ND cannot confine this agent on Windows. By default it asks you before every file change and command.',
    "Work automatically: it changes files and runs commands without asking, and can write outside its cluster's folder. You can turn this off in Settings, Permissions."],
  es: ['HIVEM1ND no puede confinar a este agente en Windows. De forma predeterminada, consulta antes de cada cambio de archivos y de cada comando.',
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
  // Settings, Permissions lists the grant with Revoke, which applies to the next operation in a running session.
  navigate(desktop.app, 'settings'); await desktop.app.settingsState.pending; await patient(() => desktop.app.settingsState?.loaded && !desktop.app.settingsState.loading, 'Settings did not load.');
  click(desktop.root.querySelector('[data-action="settings-tab-permissions"]'));
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

test("a reopened board gives each added shape a distinct persisted identity", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const created = [];
  const mounts = [];
  t.after(() => { for (const desktop of mounts) dispose(desktop.app); });
  let expectedCount = null;
  for (let index = 0; index < 2; index += 1) {
    const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/nodes")) created.push(JSON.parse(init.body).node.id);
    });
    mounts.push(desktop);
    navigate(desktop.app, "blueprint");
    await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
    const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
    renderShell(desktop.app);
    click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
    await waitFor(() => desktop.root.querySelector("[data-action='add-node']"), "The board did not open.");
    const kids = () => desktop.app.editors.current.authoritative.document.screens[0].root.kids;
    if (expectedCount === null) expectedCount = kids().length;
    assert.equal(kids().length, expectedCount);
    click(desktop.root.querySelector("[data-action='add-node']"));
    expectedCount += 1;
    await waitFor(() => kids().length === expectedCount, "The new shape was not persisted after reopening.");
    assert.equal(kids().some((node) => node.id === created[index]), true);
    dispose(desktop.app);
  }
  assert.equal(created.length, 2);
  assert.notEqual(created[0], created[1]);
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

  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Release notes"), "The text catalog did not load.");
  const notes = desktop.app.editors.catalog.find((item) => item.title === "Release notes");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${notes.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-comment]"), "The comment field did not open.");
  assert.equal(desktop.root.querySelector("[data-comment]").closest("label").querySelector(".field-hint").textContent, "Select text, then write the comment.");
  assert.equal(desktop.root.querySelector("[data-disabled-reason='comment']")?.textContent, "Select text before commenting on it.");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Choose a screen or node")), false);
  desktop.app.editors.current.threads = [];
  desktop.app.editors.current.commentsTotal = 0;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='comments']")?.textContent, "No comments yet. Select text, then write one.");

  desktop.app.editors.catalog = [];
  desktop.app.editors.catalogTotal = 0;
  desktop.app.editors.loadedKind = "void";
  desktop.app.editors.catalogLoading = false;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='void']")?.textContent, "No texts yet. Create or register one.");
  assert.equal(desktop.root.querySelector("[data-action='open-create']")?.getAttribute("aria-label"), "New text");
  assert.equal(desktop.root.querySelector("[data-action='refresh-catalog']")?.getAttribute("aria-label"), "Refresh");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Nothing to show yet.")), false);

  navigate(desktop.app, "map");
  await waitFor(() => desktop.app.unitList && desktop.app.unitList.status !== "loading", "The unit list did not settle.");
  if (desktop.app.store.view) desktop.app.store.view.issues = [];
  desktop.app.unitList.issues = [];
  desktop.app.unitList.query = "zzzz-no-match";
  desktop.app.unitList.status = "empty";
  renderShell(desktop.app);


  assert.equal(desktop.root.querySelector("[data-action='clear-search']")?.textContent, "Clear search");

  click(desktop.root.querySelector("[data-action='waiting']"));
  await waitFor(() => desktop.app.waitingList && desktop.app.waitingList.status !== "loading" && desktop.root.querySelector("[data-waiting-surface]"), "Waiting did not open.");
  desktop.app.waitingList.items = [];
  desktop.app.waitingList.total = 0;
  desktop.app.waitingList.status = "empty";
  renderShell(desktop.app);
  const waiting = desktop.root.querySelector("[data-waiting-surface]");
  assert.equal(waiting.querySelector("[data-empty='waiting']")?.textContent, "Nothing is waiting.");
  assert.equal(waiting.querySelector("[data-empty-next='waiting']")?.textContent, "Open the map to find who is waiting.");
  assert.equal(waiting.querySelector("[data-action='show-map']")?.textContent, "Show the map");
  assert.equal([...desktop.root.querySelectorAll("p")].some((node) => node.textContent.includes("Nothing to show yet.")), false);

  desktop.app.waitingOpen = false;
  navigate(desktop.app, "chats");
  await waitFor(() => desktop.app.chatList?.catalog?.length, "The chat list did not load.");
  const chat = desktop.app.chatList.catalog[0];
  desktop.app.activeHandlers.onActivate({ id: chat.id, kind: "chat" }, "double");
  await waitFor(() => desktop.root.querySelector("[data-composer]"), "The composer did not open.");
  desktop.app.thread.messages = [];
  desktop.app.thread.total = 0;
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector("[data-empty='chat']")?.textContent, "No messages yet. Write one below.");

  assert.equal(desktop.root.querySelector("[data-action='mailbox']"), null);
  assert.equal(desktop.root.querySelector('[data-mailbox-view]'), null);
});

test("the board toolbar is one row on the canvas", async (t) => {
  const fixture = await createGuiFixture();
  t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []);
  t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart") || desktop.root.querySelector(".shell"), "The desktop shell did not appear.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board catalog did not load.");
  const cart = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app);
  click(desktop.root.querySelector(`[data-id="${cart.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-toolbar='board']"), "The board toolbar did not appear.");
  const resource = desktop.root.querySelector("[data-editor-column='resource']");
  const comments = desktop.root.querySelector("[data-editor-column='comments']");
  const host = resource.querySelector(".board-host");
  const toolbar = host.querySelector("[data-toolbar='board']");
  const editorTools = resource.querySelector("[data-editor-tools]");
  assert.equal(toolbar?.getAttribute("role"), "toolbar");
  assert.equal(toolbar.className.includes("board-toolbar"), true);
  assert.equal(host.querySelectorAll("[role='toolbar']").length, 1);
  assert.equal(columnIndex(resource, editorTools) < columnIndex(resource, host), true);
  assert.equal(toolbar.querySelector("[data-action='attach']") != null, true);
  assert.equal(toolbar.querySelector("[data-action='watch']") != null, true);
  assert.equal(comments.querySelector("[data-toolbar='board']"), null);
  assert.equal(comments.querySelector("[data-comment]") != null, true);
  const tools = [...toolbar.querySelectorAll("[data-board-tool]")];
  assert.deepEqual(tools.map((node) => node.getAttribute("data-board-tool")), ["select", "frame", "text", "draw", "comment"]);
  assert.deepEqual(tools.map((node) => node.getAttribute("aria-label")), ["Select", "Frame", "Text", "Draw", "Comment"]);
  assert.equal(tools[0].getAttribute("aria-pressed"), "true");
  assert.equal(host.querySelector(".board-properties").querySelector("[data-node-name]") != null, true);
  assert.equal(host.querySelector(".board-properties").querySelector("[data-asset]") != null, true);
  assert.equal(host.querySelector(".board-outline") != null, true);
  const css = await readFile("gui/app/styles.css", "utf8");
  const rule = css.match(/\.board-host > \.board-toolbar \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /flex-wrap:\s*nowrap/);
  assert.match(rule, /overflow-x:\s*auto/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.equal(rule.includes("flex-wrap: wrap"), false);
  assert.match(css, /\[data-mode="focus"\] \.board-toolbar,/);
  const narrowStart = css.indexOf("@media (max-width: 987px)");
  const narrowOpen = css.indexOf("{", narrowStart);
  let depth = 0;
  let narrowEnd = narrowOpen;
  for (let index = narrowOpen; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        narrowEnd = index;
        break;
      }
    }
  }
  assert.equal(css.slice(narrowStart, narrowEnd).includes("board-toolbar"), false);
  assert.match(css, /\.toolbar\s*\{[^}]*flex-wrap:\s*nowrap/);
});

test("the GUI import graph stays inside its ownership table", async () => {
  const plan = await readFile("docs/3.0/plan-gui.md", "utf8");
  const section = plan.split("## File ownership")[1].split("\n## ")[0];
  const owned = new Set([...section.matchAll(/`((?:gui\/app|test)\/[^`]+)`/g)].map((match) => match[1]));
  const integration = await readFile('docs/3.0/integration.md', 'utf8');
  assert.match(integration.split('#### T046.')[1].split('#### T047.')[0], /`gui\/app\/find-worker\.mjs`, new isolated regex worker/);
  owned.add('gui/app/find-worker.mjs');
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
    const audited = rel === "gui/app/main.mjs" ? source.slice(0, source.indexOf("async function exportLegacyDocument")) + source.slice(source.indexOf("export async function importLegacyBoard")) : source;
    assert.equal(audited.includes("import("), false, rel);
    if (rel === "gui/app/main.mjs") {
      assert.match(source, /iframe\.setAttribute\("sandbox", "allow-scripts"\)/);
      assert.match(source, /connect-src 'none'/);
    }
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
  await walk(resolve('gui/app/find-worker.mjs'));
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
    contract: "hivem1nd-gui-v3",
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
    contract: "hivem1nd-events-v3",
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
  assert.equal(dialog.querySelector("h2").textContent, "Remove executor-shop?");
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
  await waitFor(() => dialog.querySelector("[data-dialog-error]"), "The unconfirmed removal did not retain its dialog.");
  click(dialog.querySelector("button.primary"));
  await waitFor(() => desktop.document.querySelector("[data-remove-unit]") == null && desktop.root.querySelector("[data-action='map-undo']"), "The replayed removal did not offer Undo.");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, writes[1].key);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), false);
  assert.match(desktop.root.querySelector("[data-map-toast]").textContent, /Archived/);
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
  assert.equal(dialog.querySelector("h2").textContent, "¿Quitar executor-shop?");
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
  assert.equal(desktop.app.unitList.catalog.some((unit) => unit.id === id), false);
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
    const payload = JSON.stringify({ contract: 'hivem1nd-gui-v3', data, meta: { requestId: key, readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } });
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

async function libraryDesktop(t, kind = "blueprint", options = {}) {
  const fixture = await createGuiFixture(options); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(desktop.app));
  navigate(desktop.app, kind === "blueprint" ? "blueprint" : "document");
  await waitFor(() => desktop.app.editors?.loadedKind === kind && !desktop.app.editors.catalogLoading, "The shared library did not load.");
  return { ...desktop, fixture, state: libraryState(desktop.app.editors, kind) };
}

function changeSelect(node, value) {
  node.value = value;
  for (const handler of node.listeners.get("change") ?? []) handler({ target: node, currentTarget: node });
}

function toggleCommentPreference(root, value) {
  const input = root.querySelector("[data-send-to-agent]");
  assert.ok(input); assert.equal(input.disabled, false);
  input.checked = value;
  for (const handler of input.listeners.get("change") ?? []) handler({ target: input });
}

async function openCommentEditor(desktop, kind) {
  navigate(desktop.app, kind === "blueprint" ? "blueprint" : "document");
  await waitFor(() => desktop.app.editors?.loadedKind === kind && !desktop.app.editors.catalogLoading, "The editor library did not load.");
  const item = desktop.app.editors.catalog.find((entry) => entry.title === (kind === "blueprint" ? "Cart" : "Release notes"));
  renderShell(desktop.app); click(desktop.root.querySelector(`[data-id="${item.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === item.id && desktop.root.querySelector("[data-send-to-agent]"), "The comment composer did not open.");
  return desktop.app.editors.current;
}

test("Blueprint and Void share the default checkbox, persisted false, machine changes and reopen without overwriting an unattached preference", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, fixture } = desktop;
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
  click(root.querySelector("button[data-board-tool='comment']"));
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(root.querySelectorAll("[data-send-to-agent]").length, 2);
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The preference did not save.");
  assert.ok(root.querySelectorAll("[data-send-to-agent]").every((input) => input.checked === false));
  assert.ok(root.querySelectorAll(".comment-preference-hint").every((hint) => hint.textContent === "Kept as a note, not sent"));
  const current = await openCommentEditor(desktop, "void");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal(root.querySelector("[data-comment]").getAttribute("aria-label"), "Reply on the text");
  await setAttachments(app.api, app.editors, []); renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal(root.querySelector("[data-send-to-agent]").disabled, true);
  assert.equal(root.querySelector(".comment-preference-hint").textContent, "No agents attached");
  assert.equal((await request(app.api, "GET", "/settings")).data.settings.sendToAgent, false);
  const reopened = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(reopened.app));
  await openCommentEditor(reopened, "blueprint");
  assert.equal(reopened.root.querySelector("[data-send-to-agent]").checked, false);
  const settings = (await request(app.api, "GET", "/settings")).data;
  await saveSettings(app.api, settings.revision, { sendToAgent: true });
  await waitFor(() => app.editors.sendToAgent && reopened.root.querySelector("[data-send-to-agent]")?.checked, "The shared setting did not synchronize to both viewers.");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal((await request(app.api, "GET", "/settings")).data.settings.sendToAgent, true);
  await setAttachments(app.api, app.editors, ["project:shop:executor-shop"]); renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
  assert.equal(current.kind, "void");
  app.language = "es"; renderShell(app);
  assert.equal(root.querySelector("[data-send-to-agent]").getAttribute("aria-label"), "Enviar al agente");
  const phone = await bootApp(fixture.phoneUrl, 390, []); t.after(() => dispose(phone.app));
  assert.equal(phone.root.querySelector("[data-send-to-agent]"), null);
  const css = await readFile("gui/app/styles.css", "utf8");
  assert.match(css, /\.comment-composer[^}]*padding: 12px 14px 16px;[^}]*gap: 7px/);
  assert.match(css, /\.comment-checkbox-hit[^}]*width: 32px; height: 32px/);
  assert.match(css, /\.comment-checkbox \{[^}]*width: 16px; height: 16px;[^}]*border-radius: 4px/);
});

test("false remains shared after the fixture service restarts and both composers reopen", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, fixture } = desktop;
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The preference did not save before restart.");
  dispose(app); await fixture.control.restart();
  const restarted = await bootApp(fixture.desktopUrl, 1440, []); t.after(() => dispose(restarted.app));
  for (const kind of ["blueprint", "void"]) {
    await openCommentEditor(restarted, kind);
    assert.equal(restarted.root.querySelector("[data-send-to-agent]").checked, false);
    assert.equal(restarted.app.editors.sendToAgent, false);
  }
  assert.equal((await request(restarted.app.api, "GET", "/settings")).data.settings.sendToAgent, false);
});

test("a settings conflict retains the visible checkbox and Retry saves that choice while a lost response reuses its receipt", async (t) => {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const api = apiFrom(fixture.desktopUrl), writes = []; let conflict = true;
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], async (url, init) => {
    if (init?.method !== "PATCH" || !String(url).endsWith("/settings")) return;
    writes.push({ key: headerValue(init.headers, "Idempotency-Key"), body: JSON.parse(init.body) });
    if (conflict) {
      conflict = false;
      const current = (await request(api, "GET", "/settings")).data;
      await saveSettings(api, current.revision, { look: "high-contrast" });
    }
  });
  t.after(() => dispose(desktop.app)); await openCommentEditor(desktop, "blueprint");
  toggleCommentPreference(desktop.root, false);
  await waitFor(() => desktop.app.activity.get("settings")?.error?.code === "revision_conflict", "The setting conflict was not shown.");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, false);
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, true);
  await openCommentEditor(desktop, "void");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, false);
  await desktop.app.activity.get("settings").retry();
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, false);
  assert.equal(writes[0].body.sendToAgent, false); assert.equal(writes[1].body.sendToAgent, false);
  assert.notEqual(writes[0].key, writes[1].key);
  fixture.control.setFault({ method: "PATCH", path: "/api/v1/settings", dropAfterCommit: true });
  toggleCommentPreference(desktop.root, true);
  await waitFor(() => desktop.app.activity.get("settings")?.phase === "error", "The lost setting response did not offer Retry.");
  assert.equal(desktop.root.querySelector("[data-send-to-agent]").checked, true);
  await desktop.app.activity.get("settings").retry();
  assert.deepEqual(writes[3], writes[2]);
  assert.equal((await request(api, "GET", "/settings")).data.settings.sendToAgent, true);
});

test("a pending note retries its captured choice and original board after navigation and a later toggle", async (t) => {
  const writes = [], desktop = await openedBoardDesktop(t, (url, init) => {
    if (init?.method === "POST" && String(url).includes("/comments")) writes.push({ url: String(url), key: headerValue(init.headers, "Idempotency-Key"), body: JSON.parse(init.body) });
  });
  const { app, root, fixture } = desktop, current = app.editors.current;
  toggleCommentPreference(root, false);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The note preference did not save.");
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-comment]"), "Keep the original note", 0, 0);
  fixture.control.setFault({ method: "POST", path: `/api/v1/editors/${current.resourceId}/comments`, dropAfterCommit: true });
  click(root.querySelector("[data-action='comment']"));
  const key = `comment:${current.resourceId}`;
  await waitFor(() => app.activity.get(key)?.phase === "error", "The lost comment did not offer Retry.");
  const captured = app.activity.get(key).commentChoice;
  assert.equal(captured.sendToAgent, false);
  assert.deepEqual(captured.attached, current.attached);
  await openCommentEditor(desktop, "void");
  toggleCommentPreference(root, true);
  await waitFor(() => app.activity.get("settings")?.phase === "success", "The later preference did not save.");
  await app.activity.get(key).retry();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(writes[1].body.sendToAgent, false);
  assert.equal(app.editors.current.kind, "void");
  await openCommentEditor(desktop, "blueprint");
  const note = app.editors.current.threads.filter((thread) => thread.messages?.some((message) => message.text === "Keep the original note"));
  assert.equal(note.length, 1); assert.equal(note[0].anchor.element, "label");
  assert.equal(note[0].messages[0].sendToAgent, false);
  assert.equal(root.querySelector("[data-comment-note]").textContent, "Kept as a note, not sent");
  assert.equal(root.querySelector("[data-send-to-agent]").checked, true);
});

async function openedBoardDesktop(t, onFetch) {
  const fixture = await createGuiFixture(); t.after(() => fixture.close());
  const desktop = await bootApp(fixture.desktopUrl, 1440, [], onFetch); t.after(() => dispose(desktop.app));
  await waitFor(() => desktop.root.querySelector(".shell") && desktop.app.layout === "desktop", "The desktop shell did not open.");
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.title === "Cart"), "The board library did not load.");
  const board = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  renderShell(desktop.app); click(desktop.root.querySelector(`[data-id="${board.id}"]`));
  await waitFor(() => desktop.root.querySelector(".board-svg"), "The board did not open.");
  return { ...desktop, fixture, board };
}

test('R6 comment metadata separates the short time and reports submitted recipients once', async t => {
  const desktop = await openedBoardDesktop(t), current = desktop.app.editors.current;
  current.threads = [{ id: 'thread-r6', messages: [{ id: 'message-r6', authorId: 'root:master', at: '2026-10-10T12:00:00.000Z', text: 'A comment.' }] }];
  current.notices = [
    { unitId: 'project:shop:executor-shop', state: 'submitted' },
    { unitId: 'env:web:overlord-web', state: 'submitted' },
  ];
  renderShell(desktop.app);
  const line = desktop.root.querySelector('[data-comment-message="message-r6"]');
  assert.equal(line.querySelector('.comment-author').textContent, 'You');
  assert.equal(line.querySelector('time').textContent, localTime('2026-10-10T12:00:00.000Z'));
  const statuses = desktop.root.querySelectorAll('[data-notice]');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].textContent, 'Sent to executor-shop and overlord-web.');
  assert.equal(desktop.root.querySelector('[data-notice="queued"]'), null);
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.comment-line time \{ display: block;/);
});

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

test('R10 History replaces Comments and places the current version first with readable metadata', async t => {
  const desktop = await openedBoardDesktop(t), current = desktop.app.editors.current;
  current.historyOpen = true;
  current.history = [
    { id: 'older', by: 'project:shop:executor-shop', at: '2026-10-10T10:00:00.000Z', operation: 'board-edit', current: false },
    { id: 'current', by: 'root:master', at: '2026-10-10T12:00:00.000Z', operation: 'restore', current: true },
  ];
  renderShell(desktop.app);
  const column = desktop.root.querySelector('[data-editor-column="comments"]');
  const rows = column.querySelectorAll('.history-row');
  assert.equal(column.querySelector('h2').textContent, 'History');
  assert.equal(rows[0].getAttribute('data-history-id'), 'current');
  assert.ok(rows[0].querySelector('.history-current'));
  const rendered = rows.map(row => row.textContent).join(' ');
  assert.equal(rendered.includes('root:master'), false);
  assert.equal(rendered.includes('project:shop:'), false);
  assert.equal(rendered.includes('2026-10-10T'), false);
  assert.ok(desktop.root.querySelector('.shared-library'));
  assert.equal(desktop.root.querySelector('[data-action="editor-history"]').getAttribute('aria-pressed'), 'true');
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

test('the board conflict banner wraps its full sentence', async () => {
  const css = await readFile('gui/app/styles.css', 'utf8');
  assert.match(css, /\.board-conflict > span \{[^}]*white-space:\s*normal/);
  assert.doesNotMatch(css, /\.board-conflict > span \{[^}]*text-overflow:\s*ellipsis/);
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
  const desktop = await openedBoardDesktop(t), selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.editors.current = null;
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
  const desktop = await openedBoardDesktop(t);
  const selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.editors.current = null;
  desktop.app.store.selected.unitId = selected.id;
  desktop.app.thread = { chat: { id: 'chat-empty', title: 'Shop', kind: 'direct', members: ['root:master', selected.id], pinned: true, listed: true }, messages: [], total: 0, nearBottom: true };
  renderShell(desktop.app);
  assert.equal(desktop.root.querySelector('[data-action="older"]'), null);
  desktop.app.thread.nextCursor = 'older-1';
  renderShell(desktop.app);
  assert.ok(desktop.root.querySelector('[data-action="older"]'));
});

test('ask cards scroll with the conversation, after its messages and above the composer, in one scroll area', async t => {
  const desktop = await openedBoardDesktop(t);
  const selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.editors.current = null;
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
  const desktop = await openedBoardDesktop(t);
  desktop.app.mode = 'map';
  desktop.app.editors.current = null;
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
  const desktop = await openedBoardDesktop(t), selected = desktop.app.unitList.catalog.find(unit => unit.id === 'project:shop:executor-shop');
  desktop.app.mode = 'map';
  desktop.app.editors.current = null;
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

function boardEvent(host, type, target, x, y, more = {}) {
  for (const handler of host.listeners.get(type) ?? []) handler({ target, pointerId: 1, button: 0, offsetX: x, offsetY: y, clientX: x, clientY: y, preventDefault() {}, ...more });
}

test("board drag and resize use parent coordinates at zoom, cancel without writes, and move by keyboard", async (t) => {
  const writes = [];
  const desktop = await openedBoardDesktop(t, (url, init) => { if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) writes.push(JSON.parse(init.body)); });
  const { app, root } = desktop, editor = app.editors.current;
  const board = structuredClone(editor.authoritative.document);
  board.screens[0].x = 100; board.screens[0].y = 200;
  board.screens[0].root.kids.push({ id: "nested", name: "Nested", t: "box", dir: "stack", place: { x: 30, y: 40 }, w: 180, h: 120, kids: [
    { id: "nested-text", name: "Text", t: "text", value: "Editable", size: 24, color: "#f5f1f6", place: { x: 10, y: 12, future: "kept" }, w: 80, h: 30, future: "node kept" },
  ] });
  const { replaceBoard, indexNodes } = await import("../gui/app/blueprint.mjs");
  await replaceBoard(app.api, editor, board); renderShell(app); writes.length = 0;
  const zoom = (host) => {
    const svg = host.querySelector(".board-svg");
    svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform(matrix) { return matrix.convert(this); } });
    svg.getScreenCTM = () => ({ convert: (point) => ({ x: point.x * 2, y: point.y * 2 }), inverse: () => ({ convert: (point) => ({ x: point.x / 2, y: point.y / 2 }) }) });
  };
  let host = root.querySelector(".board-host"); zoom(host);
  boardEvent(host, "pointerdown", host.querySelector("[data-node='nested-text']"), 300, 510);
  boardEvent(host, "pointermove", host, 320, 520);
  boardEvent(host, "pointercancel", host, 320, 520);
  assert.equal(editor.boardDraft, null); assert.equal(writes.length, 0);
  host = root.querySelector(".board-host");
  zoom(host); boardEvent(host, "pointerdown", host.querySelector("[data-node='nested-text']"), 300, 510);
  boardEvent(host, "pointermove", host, 320, 520); boardEvent(host, "pointerup", host, 320, 520);
  await waitFor(() => !editor.boardDraft && writes.length === 1, "The nested drag did not save.");
  let node = indexNodes(editor.authoritative.document).get("nested-text").node;
  assert.deepEqual(node.place, { x: 20, y: 17, future: "kept" }); assert.equal(node.future, "node kept");
  host = root.querySelector(".board-host"); zoom(host);
  const handle = host.querySelector("[data-resize='nw']"); assert.ok(handle);
  boardEvent(host, "pointerdown", handle, 300, 514); boardEvent(host, "pointermove", host, 320, 524); boardEvent(host, "pointerup", host, 320, 524);
  await waitFor(() => !editor.boardDraft && writes.length === 2, "The resize did not save.");
  node = indexNodes(editor.authoritative.document).get("nested-text").node;
  assert.deepEqual(node.place, { x: 30, y: 22, future: "kept" }); assert.equal(node.w, 70); assert.equal(node.h, 25);
  host = root.querySelector(".board-host"); boardEvent(host, "keydown", host.querySelector("[data-node='nested-text']"), 0, 0, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => !editor.boardDraft && writes.length === 3, "Keyboard movement did not save.");
  assert.equal(indexNodes(editor.authoritative.document).get("nested-text").node.place.x, 40);
  assert.equal(editor.authoritative.document.sentinel, board.sentinel);
});

test("Draw stores pen and marker strokes, cancels previews and erases through node removals", async (t) => {
  const deletes = [];
  const desktop = await openedBoardDesktop(t, (url, init) => { if (init?.method === "DELETE" && String(url).includes("/nodes/")) deletes.push(String(url)); });
  const { app, root } = desktop, editor = app.editors.current;
  click(root.querySelector("button[data-board-tool='draw']"));
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.some((screen) => screen.root.sketch), "The hand frame did not save.");
  assert.equal(editor.conflict, null, "The board's own saved sketch was reported as an outside change.");
  assert.equal(root.querySelector("[data-board-overlay='conflict']"), null);
  const frame = editor.authoritative.document.screens.find((screen) => screen.root.sketch);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h, frame.root.radius, frame.root.dash], [350, 120, 300, 560, 18, "6 5"]);
  const stroke = async (tool, end) => {
    click(root.querySelector(`[data-draw-tool='${tool}']`));
    const host = root.querySelector(".board-host");
    boardEvent(host, "pointerdown", host.querySelector(`[data-screen='${frame.id}']`), 370, 150);
    boardEvent(host, "pointermove", host, ...end); boardEvent(host, "pointerup", host, ...end);
    await waitFor(() => !editor.boardDraft && app.activity.get(`board:${editor.resourceId}`)?.phase !== "pending", "The stroke did not save.");
  };
  await stroke("pen", [430, 230]); await stroke("marker", [400, 190]);
  let strokes = editor.authoritative.document.screens.find((screen) => screen.id === frame.id).root.kids;
  assert.equal(strokes.length, 2); assert.equal(strokes[0].strokeWidth, 2.2); assert.equal(strokes[1].opacity, 0.4);
  let host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector(`[data-screen='${frame.id}']`), 380, 180); boardEvent(host, "pointermove", host, 460, 250);
  boardEvent(host, "keydown", host, 0, 0, { key: "Escape" });
  assert.equal(editor.boardDraft, null);
  await stroke("eraser", [410, 205]);
  await waitFor(() => app.activity.get(`erase:${editor.resourceId}`)?.phase === "success", "The eraser did not finish.");
  strokes = editor.authoritative.document.screens.find((screen) => screen.id === frame.id).root.kids;
  assert.equal(strokes.length, 0); assert.equal(deletes.length, 2);
  const read = (await request(app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: editor.resourceId } })).data.document;
  assert.equal(read.screens.find((screen) => screen.id === frame.id).root.kids.length, 0);
  const { addNode } = await import("../gui/app/blueprint.mjs");
  await addNode(app.api, editor, { screenId: "empty", parentId: editor.authoritative.document.screens[0].root.id,
    node: { id: "lite-stroke", name: "Retained Lite stroke", t: "vector", kind: "pen", place: { x: 40, y: 100 }, w: 80, h: 80,
      d: "M0 0 L100 100", fill: "none", stroke: "#f5f1f6", strokeWidth: 2.2, future: "Lite metadata" } });
  renderShell(app); host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector("[data-screen='empty']"), 80, 140);
  boardEvent(host, "pointerup", host, 80, 140);
  await waitFor(() => app.activity.get(`erase:${editor.resourceId}`)?.phase === "success" && deletes.length === 3, "The eraser ignored a retained Lite stroke outside the hand frame.");
  assert.equal(editor.authoritative.document.screens[0].root.kids.some((node) => node.id === "lite-stroke"), false);
});

test("the board attach picker searches groups and aliases and commits canonical unique members", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, document } = desktop;
  await waitFor(() => app.unitList?.catalog?.length, "Units did not load.");
  const members = ["project:shop:executor-shop", "env:web:overlord-web"];
  const group = await createGroup(app.api, "Checkout launch", members);
  app.store.indexes.groups.set(group.data.id, group.data);
  app.editors.current.attachmentChoice = new Set();
  click(root.querySelector("[data-action='attach']"));
  const chooser = document.querySelector("[data-form='attach']");
  assert.equal(chooser.querySelector("[data-attach-search]").getAttribute("aria-label"), "Search agents and clusters");
  typeInput(chooser.querySelector("[data-attach-search]"), "Checkout", 0, 0);
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length, 0);
  click(chooser.querySelector("[data-attach-group]"));
  typeInput(chooser.querySelector("[data-attach-search]"), "executor-shop", 0, 0);
  click(chooser.querySelector("[data-attach-unit='project:shop:executor-shop']"));
  assert.equal(chooser.querySelector("[data-action='save-attachments']").textContent, "Attach 2");
  click(chooser.querySelector("[data-action='save-attachments']"));
  await waitFor(() => document.querySelector("[data-form='attach']") == null, "The picker did not save.");
  assert.deepEqual([...app.editors.current.attached].sort(), [...members].sort());
});

test("the board attach picker lists agents that load after it opened", async (t) => {
  const desktop = await openedBoardDesktop(t), { app, root, document } = desktop;
  await waitFor(() => app.unitList?.catalog?.length, "Units did not load.");
  const loaded = app.unitList.catalog;
  app.unitList.catalog = [];
  app.editors.current.attachmentChoice = new Set();
  click(root.querySelector("[data-action='attach']"));
  const chooser = document.querySelector("[data-form='attach']");
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length, 0);
  app.unitList.catalog = loaded;
  app.unitList.onUpdate();
  assert.equal(chooser.querySelectorAll("[data-attach-unit]").length > 0, true, "the open picker shows the agents once they arrive");
  click(chooser.querySelector("[data-action='cancel-form']"));
  assert.equal(app.attachRepaint, null);
});

test("board text saves later typing, comments pin full anchors, and conflict controls retain both versions", async (t) => {
  let release, held = false; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  const desktop = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/") && !held) { held = true; await hold; }
  });
  const { app, root } = desktop, editor = app.editors.current;
  let host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "First typing", 0, 0);
  await waitFor(() => held, "The first save did not start.");
  typeInput(root.querySelector("[data-node-text='label']"), "Later typing", 0, 0); release();
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens[0].root.kids[0].value === "Later typing", "An older acknowledgment replaced later typing.");
  click(root.querySelector("button[data-board-tool='comment']")); host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  assert.equal(root.querySelector(".board-breadcrumb").textContent, "Empty cart / Root / Label");
  typeInput(root.querySelector("[data-board-comment]"), "Anchored note", 0, 0);
  click(root.querySelector(".board-comment-actions").querySelector(".primary"));
  await waitFor(() => editor.threads.some((thread) => !thread.pending && thread.messages?.some((message) => message.text === "Anchored note")), "The comment did not save.");
  const thread = editor.threads.find((thread) => thread.messages?.some((message) => message.text === "Anchored note"));
  assert.ok(root.querySelector(`[data-comment-pin='${thread.id}']`));
  assert.equal(thread.anchor.element, "label");
  const { setBoardDraft } = await import("../gui/app/blueprint.mjs");
  const local = structuredClone(editor.authoritative.document); local.title = "Local draft"; setBoardDraft(editor, local);
  const incoming = await request(app.api, "PUT", "/blueprint/boards/:resourceId", { operation: createOperation({ method: "PUT", path: "/blueprint/boards/:resourceId", params: { resourceId: editor.resourceId },
    body: { document: { ...editor.authoritative.document, title: "Incoming board" }, expectedRevision: editor.revision } }) });
  const remote = { ...incoming.data, by: "project:shop:executor-shop" };
  editor.conflict = { remote, revision: remote.revision }; renderShell(app);
  click(root.querySelector("[data-action='show-changes']"));
  assert.equal(root.querySelector("[data-board-changes]").querySelectorAll("pre").length, 2);
  click(root.querySelector("[data-action='discard-draft']"));
  await waitFor(() => editor.authoritative.document.title === "Incoming board" && !editor.historyPending, "Reload did not persist its conflict answer.");
  assert.equal(editor.authoritative.document.title, "Incoming board");
  assert.equal(editor.conflictCopies.at(-1).local.document.title, "Local draft");
  assert.equal(editor.conflictCopies.at(-1).remote.by, "project:shop:executor-shop");
});

test("a preceding save never commits a pointer preview that is later canceled", async (t) => {
  let release; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  let count = 0;
  const { app, root } = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) { count++; if (count === 1) await hold; }
  });
  const editor = app.editors.current;
  let host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "Committed text", 0, 0);
  await waitFor(() => count === 1, "The preceding save did not start.");
  host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host.querySelector("[data-node='label']"), 20, 24);
  boardEvent(host, "pointermove", host, 60, 64); release();
  await waitFor(() => app.activity.get(`board:${editor.resourceId}`)?.phase === "success", "The preceding save did not finish.");
  assert.equal(root.querySelector(".board-host"), host);
  boardEvent(host, "pointercancel", host, 60, 64);
  assert.equal(count, 1); assert.equal(editor.boardDraft, null);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].place.x, 12);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].value, "Committed text");
});

test("Frame and Text create normal nodes and Fill edits the selection in place", async (t) => {
  const { app, root } = await openedBoardDesktop(t), editor = app.editors.current;
  click(root.querySelector("button[data-board-tool='frame']"));
  let host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host, 500, 120); boardEvent(host, "pointermove", host, 800, 680); boardEvent(host, "pointerup", host, 800, 680);
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.length === 2, "The new frame did not save.");
  const frame = editor.authoritative.document.screens.at(-1);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [500, 120, 300, 560]);
  click(root.querySelector("button[data-board-tool='text']")); host = root.querySelector(".board-host");
  boardEvent(host, "pointerdown", host, 520, 150);
  await waitFor(() => !editor.boardDraft && root.querySelector("[data-node-text]"), "The new text did not save.");
  let node = editor.authoritative.document.screens.at(-1).root.kids.at(-1);
  assert.deepEqual(node.place, { x: 20, y: 30 }); assert.equal(node.t, "text");
  const fill = root.querySelector("[data-node-fill]"); changeSelect(fill, "#bdcd79");
  await waitFor(() => !editor.boardDraft && editor.authoritative.document.screens.at(-1).root.kids.at(-1).color === "#bdcd79", "Fill did not save.");
  assert.equal(editor.authoritative.document.sentinel, "document-sentinel");
});

test("Keep mine rebases a rejected board write under a new operation and retains the remote version", async (t) => {
  let release, puts = 0; const hold = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  const { app, root } = await openedBoardDesktop(t, async (url, init) => {
    if (init?.method === "PUT" && String(url).includes("/blueprint/boards/")) { puts++; if (puts === 1) await hold; }
  });
  const editor = app.editors.current, original = structuredClone(editor.authoritative.document);
  const host = root.querySelector(".board-host");
  clickEvent(host, { target: host.querySelector("[data-node='label']"), offsetX: 20, offsetY: 24 });
  typeInput(root.querySelector("[data-node-text='label']"), "Keep local typing", 0, 0);
  await waitFor(() => puts === 1, "The local write did not start.");
  const remote = { ...original, title: "Committed remotely" };
  const operation = createOperation({ method: "PUT", path: `/blueprint/boards/${editor.resourceId}`, body: { document: remote, expectedRevision: editor.revision } });
  await request(app.api, operation.method, operation.path, { operation }); release();
  await waitFor(() => app.activity.get(`board:${editor.resourceId}`)?.phase === "error" && editor.conflict?.remote, "The stale write did not retain a conflict.");
  const failedId = app.activity.get(`board:${editor.resourceId}`).operation.id;
  click(root.querySelector("[data-action='reapply-draft']"));
  await waitFor(() => !editor.boardDraft && !editor.historyPending && !app.activity.has(`board:${editor.resourceId}`), "Keep mine did not commit its conflict answer.");
  assert.equal(puts, 2); assert.notEqual(app.activity.get(`board:${editor.resourceId}`)?.operation?.id, failedId);
  assert.equal(editor.authoritative.document.screens[0].root.kids[0].value, "Keep local typing");
  assert.deepEqual(editor.conflictCopies.at(-1).remote.document, remote);
});

function libraryMenu(desktop, entry, action) {
  click(desktop.root.querySelector(`[data-library-more="${entry.id}"]`));
  click(desktop.root.querySelector(`[data-action="library-${action}"]`));
}

for (const kind of ["blueprint", "void"]) test(`the ${kind} library shares header, filters, menus and inline rename without losing a draft`, async (t) => {
  const desktop = await libraryDesktop(t, kind);
  const { app, root, document, fixture, state } = desktop;
  const header = root.querySelector(".library-header");
  assert.deepEqual(header.children.slice(1).map((node) => node.getAttribute("data-action")), ["library-filters", "new-folder", "open-create"]);
  assert.equal(root.querySelector("[data-library]").getAttribute("data-library"), kind);
  const entry = app.editors.catalog.find((item) => !item.readOnly);
  click(root.querySelector(`[data-library-more="${entry.id}"]`));
  assert.deepEqual(root.querySelector('[data-library-menu="item"]').querySelectorAll("button").map((node) => node.querySelector("span").textContent), ["Rename", "Duplicate", "Move to folder", "Delete"]);
  click(root.querySelector('[data-action="library-filters"]'));
  const menu = root.querySelector('[data-library-menu="filters"]');
  for (const handler of menu.listeners.get("keydown") ?? []) handler({ key: "Escape", preventDefault() {} });
  click(root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => app.editors.current?.resourceId === entry.id && root.querySelector("[data-comment]"), "The selected editor did not open.");
  typeInput(root.querySelector("[data-comment]"), "Kept comment draft", 3, 8);
  const current = app.editors.current;
  libraryMenu(desktop, entry, "rename");
  let input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  typeInput(input, "Renamed library item", 2, 8);
  await fixture.control.emit("service.changed", { machine: "DESKTOP" });
  await waitFor(() => root.querySelector(`[data-library-rename="${entry.id}"]`) !== input, "The rename did not survive a live render.");
  input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  assert.equal(document.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 8);
  assert.equal(input.value, "Renamed library item"); assert.equal(app.editors.current, current);
  for (const handler of input.listeners.get("keydown")) handler({ key: "Escape", preventDefault() {} });
  assert.equal(state.rename, null); assert.equal(document.activeElement.getAttribute("data-id"), entry.id);
  libraryMenu(desktop, entry, "rename");
  input = root.querySelector(`[data-library-rename="${entry.id}"]`);
  typeInput(input, "Renamed library item", 0, 20);
  fixture.control.setFault({ method: "PATCH", path: `/api/v1/editors/${entry.id}/library`, status: 503, code: "service_unavailable" });
  for (const handler of input.listeners.get("keydown")) handler({ key: "Enter", preventDefault() {} });
  await waitFor(() => state.rename?.error, "A failed inline rename did not keep its draft.");
  assert.equal(state.rename.title, "Renamed library item"); assert.equal(app.editors.current, current);
  click(root.querySelector('[data-action="save-library-name"]'));
  await waitFor(() => !state.rename && app.editors.catalog.some((item) => item.title === "Renamed library item"), "The rename retry did not commit.");
  assert.equal(app.editors.current.commentText, "Kept comment draft");
  assert.equal(app.editors.current, current);
  click(root.querySelector('[data-action="library-filters"]'));
  assert.equal(root.querySelector('[data-library-menu="filters"]').querySelectorAll("button").length, 3);
  click(root.querySelector('[data-action="library-open-comments"]'));
  await waitFor(() => root.querySelector('[data-filter-chip="openComments"]'), "The filter chip did not appear.");
  assert.equal(state.filters.openComments, true);
  click(root.querySelector('[data-action="remove-open-comments"]'));
  await waitFor(() => !root.querySelector('[data-filter-chip="openComments"]'), "The removed filter stayed active.");
  assert.equal(state.filters.openComments, undefined);
});

test("new board requires a project, Empty has one frame and duplication uses actual content", async (t) => {
  const desktop = await libraryDesktop(t);
  click(desktop.root.querySelector('[data-action="open-create"]'));
  let form = desktop.document.querySelector('[data-form="library-create"]');
  assert.equal(form.querySelector("h2").textContent, "New board");
  assert.equal(form.querySelectorAll('[name="creation"]').length, 3);
  typeInput(form.querySelector('[data-field="create-title"]'), "One frame", 0, 9);
  click(form.querySelector('[data-action="create-resource"]'));
  assert.equal(form.querySelector('[data-field-error="project"]').textContent, text("en", "projectRequired"));
  assert.equal(desktop.app.editors.current, null);
  changeSelect(form.querySelector('[name="project"]'), "shop");
  click(form.querySelector('[data-action="create-resource"]'));
  await waitFor(() => desktop.app.editors.current?.authoritative?.title === "One frame", "The empty board did not open.");
  assert.equal(desktop.app.editors.current.authoritative.document.screens.length, 1);
  assert.equal(desktop.app.editors.current.authoritative.document.pages.length, 1);
  const entry = desktop.app.editors.catalog.find((item) => item.title === "Cart");
  const source = (await request(desktop.app.api, "GET", "/blueprint/boards/:resourceId", { params: { resourceId: entry.id } })).data;
  libraryMenu(desktop, entry, "duplicate");
  form = desktop.document.querySelector('[data-form="library-create"]');
  assert.equal(form.querySelector('[data-field="create-title"]').value, "Cart copy");
  click(form.querySelector('[data-action="create-resource"]'));
  await waitFor(() => desktop.app.editors.current?.authoritative?.title === "Cart copy", "The duplicate did not open.");
  assert.deepEqual(desktop.app.editors.current.authoritative.document.screens, source.document.screens);
  assert.deepEqual(desktop.app.editors.current.authoritative.document.pages, source.document.pages);
  assert.equal(desktop.app.editors.current.authoritative.document.sentinel, source.document.sentinel);
  assert.deepEqual(desktop.app.editors.current.attached, []);
  assert.deepEqual(desktop.app.editors.current.threads, []);
});

test("new folders open inline, nested contents keep counts and folder deletion names its scope", { timeout: 15000 }, async (t) => {
  const desktop = await libraryDesktop(t, "void");
  const { app, root, document, state } = desktop;
  click(root.querySelector('[data-action="new-folder"]'));
  const form = document.querySelector('[data-form="library-folder"]');
  changeSelect(form.querySelector('[name="project"]'), "shop");
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => root.querySelector("[data-library-rename]") && !document.querySelector('[data-form="library-folder"]'), "The new folder did not enter inline rename.");
  let input = root.querySelector("[data-library-rename]");
  assert.equal(document.activeElement === input, true);
  typeInput(input, "Release", 0, 7);
  click(root.querySelector('[data-action="save-library-name"]'));
  await waitFor(() => !state.rename && state.folders.some((item) => item.title === "Release"), "The folder name did not commit.");
  const folder = state.folders.find((item) => item.title === "Release");
  assert.equal(root.querySelector(`[data-library-folder="${folder.id}"]`).querySelector(".library-count").textContent, "0");
  const entry = app.editors.catalog.find((item) => item.title === "Release notes");
  libraryMenu(desktop, entry, "move");
  await waitFor(() => document.querySelector('[data-form="library-move"]'), "The move chooser did not open.");
  const move = document.querySelector('[data-form="library-move"]');
  changeSelect(move.querySelector('[name="folderId"]'), folder.id);
  click(move.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => app.editors.catalog.find((item) => item.id === entry.id)?.folderId === folder.id, "The same-project move did not commit.");
  assert.equal(document.querySelector('[data-library-repository-confirm]'), null);
  assert.equal(root.querySelector(`[data-library-folder="${folder.id}"]`).querySelector(".library-count").textContent, "1");
  libraryMenu(desktop, state.folders.find((item) => item.id === folder.id), "delete");
  await waitFor(() => document.querySelector('[data-library-delete="folder"]'), "The folder delete confirmation did not open.");
  const dialog = document.querySelector('[data-library-delete="folder"]');
  assert.match(dialog.querySelector("p").textContent, /1 text go/);
  assert.match(dialog.querySelector("p").textContent, /subfolders/);
  assert.match(dialog.querySelector("p").textContent, /10 seconds/);
  dialog.close();
  assert.equal(app.editors.catalog.some((item) => item.id === entry.id), true);
  assert.equal(document.activeElement.getAttribute("data-action"), `folder-${folder.id}`);
});

test("text deletion retries one operation and restores the selected draft with ten-second Undo", async (t) => {
  const desktop = await libraryDesktop(t, "void");
  const { app, root, document, fixture } = desktop;
  const entry = app.editors.catalog.find((item) => item.title === "Release notes");
  click(root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => root.querySelector("[data-source]"), "The text did not open.");
  app.editors.current.voidSaver = documentSaver(app.api, app.editors.current, () => {}, 10000);
  typeInput(root.querySelector("[data-source]"), "Unsent source", 2, 5);
  const current = app.editors.current;
  libraryMenu(desktop, entry, "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The delete confirmation did not open.");
  let dialog = document.querySelector('[data-library-delete="item"]');
  assert.match(dialog.querySelector("p").textContent, /text and its comments/);
  dialog.close(); assert.equal(app.editors.current, current);
  libraryMenu(desktop, entry, "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The delete confirmation did not reopen.");
  dialog = document.querySelector('[data-library-delete="item"]');
  fixture.control.setFault({ method: "DELETE", path: `/api/v1/editors/${entry.id}`, status: 503, code: "service_unavailable" });
  click(dialog.querySelector("button.primary"));
  await waitFor(() => dialog.querySelector("[data-dialog-error]"), "The failed delete did not stay open.");
  assert.equal(app.editors.catalog.some((item) => item.id === entry.id), true);
  click(dialog.querySelector("button.primary"));
  await waitFor(() => root.querySelector('[data-action="library-undo"]'), "The committed delete did not offer Undo.");
  assert.equal(root.querySelector('[data-library-countdown]').textContent, "10 s");
  assert.equal(app.editors.current, null);
  click(root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => app.editors.current === current && app.editors.catalog.some((item) => item.id === entry.id), "Undo did not restore the text and selected draft.");
  assert.equal(root.querySelector("[data-source]").value, "Unsent source");
  libraryMenu(desktop, app.editors.catalog.find((item) => item.id === entry.id), "delete");
  await waitFor(() => document.querySelector('[data-library-delete="item"]'), "The second confirmation did not open.");
  click(document.querySelector('[data-library-delete="item"]').querySelector("button.primary"));
  await waitFor(() => root.querySelector('[data-action="library-undo"]'), "The second Undo did not appear.");
  const end = app.libraryToast.until; app.api.now = () => end;
  renderShell(app);
  assert.equal(root.querySelector('[data-action="library-undo"]'), null);
});

test("cross-project GUI movement confirms both repositories and moves real-core bytes with Undo", async (t) => {
  const fixture = await makeCoreFixture(); t.after(() => disposeCoreFixture(fixture));
  const projects = [];
  for (const name of ["shop", "api"]) {
    const localPath = join(fixture.root, name); await mkdir(localPath);
    await mkdir(join(fixture.paths.mind, "user", "projects", name), { recursive: true });
    projects.push({ name, localPath });
  }
  const core = await composeCore({ store: fixture.store, paths: fixture.paths, projects, now: () => fixture.clock.now });
  t.after(() => core.http.close());
  const origin = `http://127.0.0.1:${core.http.port}`;
  const login = await fetch(`${origin}/api/v1/auth/local`, { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${core.bootstrap.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }) });
  assert.equal(login.status, 201);
  const token = (await login.json()).data.token;
  const api = apiFrom(`${origin}/#session=${token}`);
  await request(api, "POST", "/units", { operation: createOperation({ method: "POST", path: "/units", body: { unit: "overseer", role: "overseer", scope: "root", machine: fixture.machine } }) });
  const source = await createResource(api, "blueprint", { project: "shop", document: { formatVersion: 1, id: "physical", title: "Physical board", note: "", pages: [{ id: "main", title: "Main", objects: [], order: ["frame"], start: "frame" }], screens: [{ id: "frame", title: "Frame", pageId: "main", x: 0, y: 0, w: 100, h: 100, root: { id: "root", name: "Frame", t: "box", place: { x: 0, y: 0 }, dir: "stack", w: 100, h: 100, kids: [] } }], links: [], components: [], fonts: [], threads: [], sentinel: "actual-core" } });
  const before = await readFile(join(projects[0].localPath, source.data.path));
  const desktop = await bootApp(`${origin}/#session=${token}`, 1440, []); t.after(() => dispose(desktop.app));
  navigate(desktop.app, "blueprint");
  await waitFor(() => desktop.app.editors?.catalog?.some((item) => item.id === source.data.id), "The actual core library did not load.");
  assert.deepEqual(libraryState(desktop.app.editors, "blueprint").projects.map((project) => project.id), ["api", "shop"]);
  const entry = desktop.app.editors.catalog.find((item) => item.id === source.data.id);
  click(desktop.root.querySelector(`[data-id="${entry.id}"]`));
  await waitFor(() => desktop.app.editors.current?.resourceId === entry.id, "The real board did not open.");
  libraryMenu(desktop, entry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The destination chooser did not open.");
  let form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api");
  click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The distinct repository confirmation did not open.");
  let dialog = desktop.document.querySelector('[data-library-repository-confirm]');
  assert.match(dialog.querySelector("p").textContent, /shop repository to the api repository/);
  assert.deepEqual(await readFile(join(projects[0].localPath, source.data.path)), before);
  dialog.close();
  assert.equal(desktop.app.editors.current.resourceId, source.data.id);
  libraryMenu(desktop, entry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The move chooser did not reopen.");
  form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api"); click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The repository confirmation did not reopen.");
  dialog = desktop.document.querySelector('[data-library-repository-confirm]'); await clickAndWait(dialog.querySelector("button.primary"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.project === "api" && desktop.root.querySelector('[data-action="library-undo"]'), "The physical move did not commit.");
  await assert.rejects(readFile(join(projects[0].localPath, source.data.path)), (error) => error.code === "ENOENT");
  assert.deepEqual(await readFile(join(projects[1].localPath, source.data.path)), before);
  assert.notEqual(desktop.app.editors.current.resourceId, source.data.id);
  await clickAndWait(desktop.root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => desktop.app.editors.current?.resourceId === source.data.id, "Undo did not restore the original resource identity.");
  assert.deepEqual(await readFile(join(projects[0].localPath, source.data.path)), before);
  await assert.rejects(readFile(join(projects[1].localPath, source.data.path)), (error) => error.code === "ENOENT");
  const sourceText = await createResource(api, "void", { project: "shop", path: "docs/physical-text.json", document: { formatVersion: 1, id: "physical-text", title: "Physical text", pages: [{ k: "Intro.Welcome", en: "Original text", es: "Texto original" }] } });
  navigate(desktop.app, "document");
  await waitFor(() => desktop.app.editors.catalog.some((item) => item.id === sourceText.data.id), "The real text did not appear in the library.");
  const textEntry = desktop.app.editors.catalog.find((item) => item.id === sourceText.data.id);
  click(desktop.root.querySelector(`[data-id="${textEntry.id}"]`));
  await waitFor(() => desktop.root.querySelector("[data-source]"), "The real text did not open.");
  desktop.app.editors.current.voidSaver = documentSaver(desktop.app.api, desktop.app.editors.current, () => {}, 10000);
  typeInput(desktop.root.querySelector("[data-source]"), "Unsaved text", 2, 6);
  libraryMenu(desktop, textEntry, "move");
  await waitFor(() => desktop.document.querySelector('[data-form="library-move"]'), "The text destination chooser did not open.");
  form = desktop.document.querySelector('[data-form="library-move"]');
  changeSelect(form.querySelector('[name="project"]'), "api"); click(form.querySelector('[data-action="confirm-form"]'));
  await waitFor(() => desktop.document.querySelector('[data-library-repository-confirm]'), "The text repository confirmation did not open.");
  await clickAndWait(desktop.document.querySelector('[data-library-repository-confirm]').querySelector("button.primary"));
  await waitFor(() => desktop.app.editors.current?.authoritative?.project === "api" && desktop.root.querySelector('[data-action="library-undo"]'), "The physical text move did not commit.");
  const movedTextId = desktop.app.editors.current.resourceId;
  assert.equal(desktop.root.querySelector("[data-source]").value, "Unsaved text");
  assert.equal(textDraft(desktop.app.editors.current, movedTextId, "Intro.Welcome", "en"), "Unsaved text");
  assert.equal(desktop.app.store.open.editors.has(textEntry.id), false);
  assert.equal(desktop.app.store.open.editors.has(movedTextId), true);
  await clickAndWait(desktop.root.querySelector('[data-action="library-undo"]'));
  await waitFor(() => desktop.app.editors.current?.resourceId === textEntry.id, "Undo did not restore the text's original identity.");
  assert.equal(textDraft(desktop.app.editors.current, textEntry.id, "Intro.Welcome", "en"), "Unsaved text");
  assert.equal(desktop.root.querySelector("[data-source]").value, "Unsaved text");
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
  for (const selector of [".comment-send:disabled", ".comment-preference.no-agents", ".settings-panel .btn:disabled"]) {
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

test("provenance links and the Remove action keep 4.5:1 on their surfaces in every look", async () => {
  const rules = accessibilityRules(await readFile(new URL("../gui/app/styles.css", import.meta.url), "utf8"));
  const value = (selector, property) => rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.values[property]).filter(Boolean).at(-1);
  for (const look of ["modern", "high-contrast", "nebula", "txmska", "coffee-cat", "ntk"]) {
    const palette = accessibilityPalette(rules, look);
    const resolve = raw => accessibilityColor(raw.replace(/^var\((--[\w-]+)\)$/, (_, name) => palette[name]));
    for (const [selector, surface] of [[".add-content-row .add-origin", ".add-content-row"], [".library-menu-row.is-danger", ".library-menu"]]) {
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
  for (const [selector, width, height] of [[".icon-button", 36, 36], [".board-tool", 32, 32], [".board-resize", 32, 32],
    [".board-swatch", 32, 32], [".comment-send", 34, 34], [".map-handle", 44, 44], [".phone-code-cell", 40, 50]]) {
    assert.equal(parseFloat(declaration(selector).width), width, selector);
    assert.equal(parseFloat(declaration(selector).height), height, selector);
    assert.ok(width >= 32 && height >= 32, selector);
  }
  for (const selector of [".segmented .segment", ".comment-preference-label", ".settings-content-item", ".settings-change label"]) {
    assert.equal(declaration(selector)["min-height"], "32px", selector);
  }
  assert.equal(declaration(".board-resize::before").width, "9px");
  assert.equal(declaration(".board-resize::before").height, "9px");
  assert.equal(declaration(".phone-code-input").height, "100%");
  assert.equal(declaration(".phone-gate")["overflow-y"], "auto");
  assert.match(css, /\.settings-looks\s*\{\s*grid-template-columns:\s*repeat\(auto-fit, minmax\(166px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*grid-template-columns: repeat\(3, 40px\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.equal(declaration('[data-mode="focus"]')["--bg"], "#000000");
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
  const inspect = async () => {
    click(root.querySelector('[data-action="add-to-mind"]'));
    const input = document.querySelector('[id="add-link"]'); typeInput(input, 'https://github.com/acme/landing-site', 0, 0);
    for (const handler of input.listeners.get('keydown') ?? []) handler({ key: 'Enter', preventDefault() {} });
    await waitFor(() => app.addController.model.preview?.state === 'ready', 'The actual source check did not finish.');
  };
  const choose = kind => {
    const candidate = app.addController.model.preview.candidates.find(item => item.kind === kind);
    changeControl(document.querySelector(`[data-candidate-id="${candidate.id}"]`).querySelector('input'), true);
  };
  const check = async () => { await clickAndWait(document.querySelector('[data-action="add-continue"]')); await waitFor(() => app.addController.model.stage === 'check', 'The immutable check did not open.'); };
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
  await waitFor(() => app.store.additions.report?.items.length === 3 && !document.querySelector('.add-dialog'), 'Content was not accepted.');
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
  click(root.querySelector(`[data-cluster-link="${clusterId}"]`).querySelector('[data-action="settings-remove-link"]'));
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
      await writeFile(join(local, 'sessions', SHOP_SESSION, 'checkout.json'), JSON.stringify({ format: 'hivem1nd-session-checkout-v1', sessionId: SHOP_SESSION, ...reading }));
    }
    if (stopped) {
      await mkdir(join(tree.user, 'relay', 'session-status', SHOP_SESSION), { recursive: true });
      await writeFile(join(tree.user, 'relay', 'session-status', SHOP_SESSION, 'closed.json'), JSON.stringify({ format: 'hivem1nd-session-status-v1',
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
  await waitFor(() => desktop.root.querySelector('.inspector-details'), 'The inspector details did not appear.');
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
  assert.equal(manual.facts().Branch.text, 'Not known');
  assert.equal(manual.facts()['Works in'].title, 'This session was started outside M1ND, so its folder is not recorded.');
  assert.equal(manual.facts().Branch.title, manual.facts()['Works in'].title);
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
  assert.deepEqual(rows('en', { error: new Error('offline') }).map(row => row.slice(0, 2)), [['worksIn', 'Not known'], ['branch', 'Not known']]);
  assert.deepEqual(rows('en', { error: new Error('offline') }, { state: 'stopped' }), []);
  assert.deepEqual(rows('en', undefined), [], 'Nothing is shown before the first answer.');
  assert.deepEqual(checkoutFacts(key => key, 'en', { session: null, local: 'DESKTOP' }), []);
  assert.equal(rows('en', { data: { sessionId: 'session', known: false, reason: 'other_machine' } })[0][2], 'Another machine runs this session.');
  assert.equal(rows('es', { data: { sessionId: 'session', known: false, reason: 'git_unavailable' } })[1][2], 'Git no respondió para esta carpeta.');
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
  await writeFile(join(local, 'sessions', SHOP_SESSION, 'checkout.json'), JSON.stringify({ format: 'hivem1nd-session-checkout-v1', sessionId: SHOP_SESSION, ...reading, branch: 'later' }));
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
  const order = documentOrder(body);
  assert.ok(order.indexOf(heading) < order.indexOf(facts) && order.indexOf(facts) < order.indexOf(tabs));
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
  assert.equal(column.contains(chatFacts), false);
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
  assert.equal(node.getAttribute('title'), 'Code reviewer');
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
  assert.equal(node.getAttribute('title'), 'Release captain');
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
  assert.ok(rows.find(row => row.unit.id === 'root:captain').text.startsWith('captain (Release captain) '));
  assert.ok(rows.find(row => row.unit.id === 'root:plain').text.startsWith('plain '));
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
  assert.equal(leadLine('es', 'env:web:overlord-web'), 'Líder: overlord-web');
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
  await waitFor(() => desktop.root.querySelector("[data-waiting-surface]") && desktop.app.waitingList.status === "ready", "The waiting list did not open.");
  const sample = desktop.app.waitingList.items[0];
  desktop.app.waitingList.items = Array.from({ length: 100 }, (_, index) => ({ ...sample, id: `${sample.id}-${index}` }));
  desktop.app.waitingList.total = 140;
  desktop.app.waitingList.nextCursor = "next-page";
  renderShell(desktop.app);
  const surface = desktop.root.querySelector("[data-waiting-surface]");
  assert.equal(surface.querySelectorAll("[data-waiting-item]").length, 100, "every loaded item has its card");
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
