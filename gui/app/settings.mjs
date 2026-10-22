import { createOperation, request } from "./api.mjs";
import { element, icon, labelDialog, labeledField, pathIcon } from "./components.mjs";
import { cardinal, formatNumber, formatShortTime, formatWhen, limitsUsage, syncUsage } from "./i18n.mjs";
import { encodeHomeQr } from "./qr.mjs";
import { renderQr } from "./qr-render.mjs";
import { catalogLabel, clientLabel } from './clusters.mjs';
import { startText } from './start-copy.mjs';
import { displayName, openContextMenu } from './hierarchy.mjs';
import { addButton, renderAddedContent } from './add-view.mjs';

export function updateExpiry(home, nowMs) {
  if (!home?.enabled || !home.expiresAt) return { remainingSeconds: 0, expired: true };
  const remainingMs = Date.parse(home.expiresAt) - nowMs;
  if (!Number.isFinite(remainingMs)) return { remainingSeconds: 0, expired: true };
  return { remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)), expired: remainingMs <= 0 };
}

export function clearGrant(state) {
  if (state.grant) {
    state.grant.key = "";
    state.grant.shortCode = "";
    state.grant.links = [];
    state.grant.qrPayloads = [];
  }
  state.grant = null;
  state.selected = 0;
  state.expectGrant = false;
}

export function takeGrant(state, data) {
  state.grant = {
    key: data.key,
    shortCode: data.shortCode,
    links: [...(data.links ?? [])],
    qrPayloads: [...(data.qrPayloads ?? [])],
    openedAt: data.openedAt,
    expiresAt: data.expiresAt,
  };
  state.selected = 0;
  state.home = homeFields(data);
  return state;
}

export function noteHomeChange(state, event) {
  if (event?.home) state.home = homeFields(event.home);
  const reason = event?.reason;
  if (state.expectGrant && (reason === "opened" || reason === "replaced")) {
    state.expectGrant = false;
    return state;
  }
  if (reason === "closed" || reason === "expired" || reason === "replaced" || reason === "opened" || state.home?.enabled === false) {
    clearGrant(state);
  }
  return state;
}

export function limitsLabel(state) {
  if (state === "slowing") return "limitsSlowing";
  if (state === "paused") return "limitsPaused";
  if (state === "error") return "limitsError";
  return "limitsNormal";
}

export function applySyncSnapshot(current, data) {
  const next = { ...(current ?? {}) };
  if (!data || typeof data !== "object") return next;
  if (data.state != null) next.state = data.state;
  if (data.pendingChanges != null) next.pendingChanges = data.pendingChanges;
  if (data.limits) next.limits = data.limits;
  if (Object.hasOwn(data, "retryAt")) next.retryAt = data.retryAt ?? null;
  if (Object.hasOwn(data, "error")) next.error = data.error ?? null;
  if (data.incoming) next.incoming = data.incoming;
  return next;
}

export function applyServiceBeat(service, machine) {
  const current = { ...(service ?? {}) };
  if (typeof machine === "string") return { ...current, machine };
  const beat = machine ?? {};
  return {
    ...current,
    machine: beat.id ?? beat.machine ?? current.machine ?? "",
    version: beat.version ?? current.version ?? "",
    state: beat.state ?? current.state,
    answers: beat.answers ?? current.answers,
  };
}

export function applyIssueChange(issues, data) {
  const list = [...(issues ?? [])];
  const issue = data?.issue;
  if (!issue) return list;
  const index = list.findIndex((item) => item.code === issue.code && item.path === issue.path && item.message === issue.message);
  if (data.resolved) return index >= 0 ? list.filter((_, item) => item !== index) : list;
  if (index >= 0) return list;
  return [...list, issue];
}

export function armExpiry(state, nowMs, schedule, clearScheduled) {
  if (state.expiryTimer != null) clearScheduled?.(state.expiryTimer);
  state.expiryTimer = null;
  const expiresAt = state.grant?.expiresAt ?? state.home?.expiresAt ?? null;
  if (!state.home?.enabled || !expiresAt || state.expiredLocally) return null;
  const remaining = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) {
    state.expiredLocally = true;
    clearGrant(state);
    state.onExpiry?.({ remainingSeconds: 0, expired: true });
    return null;
  }
  const delay = state.tickMs ? Math.min(state.tickMs, remaining) : remaining;
  state.expiryTimer = schedule(() => {
    state.expiryTimer = null;
    const expiry = updateExpiry(state.home, Date.now());
    if (expiry.expired) {
      state.expiredLocally = true;
      clearGrant(state);
    }
    state.onExpiry?.(expiry);
  }, delay);
  return state.expiryTimer;
}

export function applySettingsRead(state, data) {
  const settings = data?.settings ?? state.settings;
  state.settings = { ...settings, sendToAgent: settings?.sendToAgent ?? true };
  state.revision = data?.revision ?? state.revision;
  state.service = data?.service ?? state.service;
  state.home = homeFields(data?.home);
  if (!state.home?.enabled) clearGrant(state);
  return state;
}

export async function saveSettings(api, revision, patch, retained = null) {
  const operation = retained ?? createOperation({
    method: "PATCH",
    path: "/settings",
    body: { ...patch, expectedRevision: revision ?? null },
  });
  return finishOperation(api, operation);
}

export async function openHome(api, addresses, retained = null) {
  const body = { enabled: true };
  if (addresses?.length) body.addresses = addresses;
  const operation = retained ?? createOperation({ method: "POST", path: "/settings/home-network", body });
  return finishOperation(api, operation);
}

export async function closeHome(api, retained = null) {
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/settings/home-network",
    body: { enabled: false },
  });
  return finishOperation(api, operation);
}

// The preview and the apply of one agent's configuration; Review all runs them for each agent in turn.
export async function previewAgent(api, client, body, retained = null) {
  const operation = retained ?? createOperation({ method: "POST", path: `/settings/agents/${encodeURIComponent(client)}/preview`, body });
  return finishOperation(api, operation);
}

export async function applyAgent(api, client, body, retained = null) {
  const operation = retained ?? createOperation({ method: "POST", path: `/settings/agents/${encodeURIComponent(client)}/apply`, body });
  return finishOperation(api, operation);
}

async function finishOperation(api, operation) {
  try {
    const result = await request(api, operation.method, operation.path, { operation });
    result.operation = operation;
    return result;
  } catch (error) {
    if (error && typeof error === "object" && error.operation == null) error.operation = operation;
    throw error;
  }
}

export function renderHomeGrant(document, grant, index, label) {
  const payload = grant?.qrPayloads?.[index];
  const host = element(document, "div", { "data-secret": "true" });
  host.append(element(document, "p", { "data-code": grant?.shortCode ?? "", text: grant?.shortCode ?? "" }));
  const links = element(document, "div", { class: "home-links" });
  for (let item = 0; item < (grant?.links?.length ?? 0); item += 1) {
    links.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-link": String(item),
      "aria-pressed": String(item === index),
      text: new URL(grant.links[item]).origin,
    }));
  }
  host.append(links);
  if (payload) {
    const svg = renderQr(document, encodeHomeQr(payload), label);
    svg.setAttribute("data-qr", payload);
    host.setAttribute("data-qr", payload);
    host.append(svg);
  }
  return host;
}

export function renderSettings(document, model, t, actions) {
  const panel = element(document, "section", { class: "settings-panel", "data-settings": "true" });
  const tabs = [["general", "settingsGeneral", "settings"], ["agents", "settingsAgents", "executor"],
    ["projects", "settingsProjects", "document"], ["content", "settingsContent", "blueprint"]];
  // Permissions was a tab of its own; a saved or requested "permissions" opens it where it lives now, at the end of Agents.
  const requested = model.tab ?? "general";
  const tab = requested === "permissions" ? "agents" : requested;
  const bar = element(document, "div", { class: "settings-tabs", role: "tablist", "aria-label": t("settings") });
  for (const [id, key, glyph] of tabs) {
    const button = element(document, "button", { type: "button", role: "tab", id: `settings-tab-${id}`,
      "data-settings-tab": id, "data-action": `settings-tab-${id}`, "aria-selected": String(tab === id), "aria-controls": "settings-page", tabindex: tab === id ? "0" : "-1",
      onclick: () => actions.onTab?.(id) }, icon(document, glyph), t(key));
    button.addEventListener("keydown", event => {
      const index = tabs.findIndex(item => item[0] === id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
      if (next === null) return;
      event.preventDefault();
      actions.onTab?.(tabs[next][0], true);
    });
    bar.append(button);
  }
  panel.append(element(document, "header", { class: "settings-header" }, element(document, "h2", { text: t("settings") }), bar,
    renderMachinePicker(document, model, t, actions)));
  if (model.readOnly) panel.append(element(document, "p", { class: "settings-offline", role: "status", "data-settings-readonly": "true",
    text: t("settingsOfflineReport", { machine: model.machine, time: formatWhen(model.language, model.reportedAt) || t("unknown") }) }));
  if (model.loading) panel.append(element(document, "p", { role: "status", text: t("loadingList") }));
  if (model.error) panel.append(element(document, "p", { role: "alert", text: model.error }),
    settingsButton(document, "retry-settings", t("retry"), actions.onRetry));
  const page = element(document, "div", { id: "settings-page", role: "tabpanel", "aria-labelledby": `settings-tab-${tab}`, "data-settings-page": tab });
  if (tab === "general") page.append(renderGeneral(document, model, t, actions));
  if (tab === "agents") page.append(renderAgents(document, model, t, actions, requested === "permissions"));
  if (tab === "projects") page.append(renderProjects(document, model, t, actions));
  if (tab === "content") page.append(renderContent(document, model, t, actions));
  panel.append(page);
  return panel;
}

function renderMachinePicker(document, model, t, actions) {
  const host = element(document, "div", { class: "settings-machine-picker" });
  const current = model.machine === model.localMachine ? t("finalThisMachine", { machine: model.machine }) : model.machine;
  const toggle = settingsButton(document, "settings-machine", current || t("machine"), actions.onMachineMenu);
  toggle.replaceChildren(machineIcon(document, model.machine === model.localMachine), current || t("machine"), element(document, "span", { "aria-hidden": "true", text: "⌄" }));
  toggle.setAttribute("aria-label", `${t("machine")}: ${current ?? ""}`);
  toggle.setAttribute("aria-expanded", String(Boolean(model.machineMenu)));
  toggle.setAttribute("aria-haspopup", "menu");
  host.append(toggle);
  if (model.machineMenu) {
    const menu = element(document, "div", { class: "settings-machine-menu", role: "menu", "aria-label": t("machine") });
    for (const machine of model.machines ?? []) {
      const label = machine.id === model.localMachine ? t("finalThisMachine", { machine: machine.id }) : machine.id;
      const option = settingsButton(document, `settings-machine-${machine.id}`, label, () => actions.onMachine?.(machine.id));
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(machine.id === model.machine));
      option.setAttribute("data-machine-choice", machine.id);
      const identity = element(document, "span", { class: "settings-machine-label" }, label);
      if (!machine.answers) identity.append(element(document, "small", { text: t("finalMachineOffline", { time: formatWhen(model.language, machine.heartbeatAt) || t("unknown") }) }));
      option.replaceChildren(machineIcon(document, machine.id === model.localMachine), identity);
      menu.append(option);
    }
    menu.addEventListener("keydown", event => {
      const controls = [...menu.querySelectorAll("button")];
      const index = controls.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
        : event.key === "ArrowDown" ? (index + 1) % controls.length : event.key === "ArrowUp" ? (index + controls.length - 1) % controls.length : null;
      if (event.key === "Escape") { event.preventDefault(); actions.onMachineMenu?.(false); }
      else if (next !== null) { event.preventDefault(); controls[next]?.focus(); }
    });
    host.append(menu);
  }
  return host;
}

function machineIcon(document, local) {
  return pathIcon(document, local ? "M3 4h18v12H3zM12 16v4M8 20h8" : "M5 4h14v12H5zM5 16l-3 4h20l-3-4");
}

function settingsSection(document, title, ...children) {
  return element(document, "section", { class: "settings-section" }, element(document, "h3", { text: title }), ...children);
}

// A card whose title row also carries a control at its right.
function settingsCard(document, title, right, ...children) {
  return element(document, "section", { class: "settings-section" },
    element(document, "div", { class: "settings-card-head" }, element(document, "h3", { text: title }), right), ...children);
}

// The accent fill belongs to the one action of a card; every other control is secondary.
function settingsButton(document, action, label, onClick, disabled = false, secondary = false, glyph = null) {
  const button = element(document, "button", { type: "button", class: secondary ? "btn is-secondary" : "btn", "data-action": action, text: glyph ? null : label, onclick: onClick },
    glyph, glyph ? label : null);
  button.disabled = disabled;
  return button;
}

function retryGlyph(document) {
  return pathIcon(document, "M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5");
}

function settingsFact(document, name, value, attributes = {}) {
  return element(document, "div", { class: "settings-line" }, element(document, "span", { text: name }),
    element(document, "span", { ...attributes, text: value }));
}

// A folded card: the title at the left, a muted status at the right and the content inside. It stays closed until asked.
function settingsDisclosure(document, key, title, status, open, ...children) {
  const details = element(document, "details", { class: "settings-disclosure", "data-disclosure": key },
    element(document, "summary", {}, icon(document, "chevronRight"), element(document, "span", { class: "settings-disclosure-title", text: title }),
      status ? element(document, "span", { class: "settings-disclosure-status", text: status }) : null),
    element(document, "div", { class: "settings-disclosure-body" }, ...children));
  if (open) { details.open = true; details.setAttribute("open", ""); }
  return details;
}

// A notice sits in a card: a glyph, what happened, and optionally the control that answers it. The body is text or nodes.
function settingsNotice(document, tone, attributes, title, body, ...extra) {
  const lines = [].concat(body ?? []).map(line => typeof line === "string" ? element(document, "p", { text: line }) : line);
  return element(document, "div", { class: `settings-notice is-${tone}`, ...attributes }, icon(document, "alert"),
    element(document, "div", { class: "settings-notice-text" }, element(document, "strong", { text: title }), ...lines), ...extra);
}

function renderGeneral(document, model, t, actions) {
  const service = model.service ?? {};
  const looks = element(document, "div", { class: "settings-looks" });
  for (const look of LOOK_OPTIONS) {
    const preview = renderLookPreview(document, look, model.look === look.id, actions.onLook);
    preview.disabled = !model.canWrite;
    looks.append(preview);
  }
  const language = element(document, "div", { class: "settings-segment" },
    choice(document, "language", "en", t("english"), model.language === "en", actions.onLanguage),
    choice(document, "language", "es", t("spanish"), model.language === "es", actions.onLanguage));
  for (const button of language.children) button.disabled = !model.canWrite;
  const startup = element(document, "input", { type: "checkbox", "data-start-with-windows": "true", "aria-label": t("settingsStartup") });
  startup.setAttribute("data-action", "settings-startup");
  startup.checked = service.startWithWindows === true;
  startup.disabled = !model.canWrite || model.readOnly || model.loading;
  startup.addEventListener("change", () => actions.onStartup?.(startup.checked));
  const restart = settingsButton(document, "settings-restart", t("settingsRestartShort"), actions.onRestart, !model.canWrite || model.readOnly || model.loading, true, retryGlyph(document));
  restart.setAttribute("aria-label", t("settingsRestart"));
  const relay = settingsCard(document, t("settingsService"), restart,
    settingsFact(document, t("settingsState"), service.state === "running" ? t("finalRunningOn", { machine: service.machine }) : t(service.state === "stopped" ? "settingsStopped" : "unknown"), { "data-machine": service.machine ?? "" }),
    settingsFact(document, t("settingsVersion"), service.version ?? t("unknown"), { "data-version": service.version ?? "" }),
    settingsFact(document, t("settingsStarted"), formatWhen(model.language, service.startedAt) || t("unknown")),
    element(document, "label", { class: "settings-line is-toggle" }, t("settingsStartup"), element(document, "span", {}, startup, t(startup.checked ? "finalOn" : "finalOff"))));
  // Transport status remains diagnostic; it never offers a synchronization choice.
  if (model.limits) relay.append(renderLimits(document, model, t));
  if (model.issues?.length) relay.append(renderIssues(document, model, t, actions));
  const coming = settingsButton(document, "relay-coming-soon", t("settingsComingSoon"), null, true);
  return element(document, "div", { class: "settings-columns" },
    element(document, "div", { class: "settings-column" }, settingsSection(document, t("finalLook"), looks,
      element(document, "p", { class: "settings-hint", text: t("finalPreviewHint") })),
    settingsSection(document, t("settingsLanguage"), language)),
    element(document, "div", { class: "settings-column" }, relay, renderHome(document, model, t, actions),
      settingsDisclosure(document, "settings-relay-plus", "Relay+", t("settingsComingSoon"), false, coming, element(document, "p", { text: t("settingsRelayPlus") })),
      settingsDisclosure(document, "settings-locations", t("settingsLocations"), t("settingsLocationsStatus"), false,
        settingsFact(document, "M1ND", model.locations?.mind || t("unknown")),
        settingsFact(document, t("settingsStaging"), model.locations?.staging || t("unknown")))));
}

// While the limits are normal the usage is one muted line; slowing or paused is a notice that says until when.
function renderLimits(document, model, t) {
  const limits = model.limits;
  const state = limits.state ?? "normal";
  const attributes = { "data-limits": state, "data-retry-at": limits.retryAt ?? "" };
  if (state === "normal") {
    return element(document, "p", { class: "settings-usage", ...attributes, "data-limit-usage": "true", text: limitsUsage(model.language, limits.messages ?? {}, limits.syncBytes ?? {}) });
  }
  const time = Number.isNaN(Date.parse(limits.retryAt ?? "")) ? "" : formatShortTime(model.language, limits.retryAt);
  const key = limitsLabel(state);
  const title = state === "error" ? t(key) : time ? t(key, { time }) : t(`${key}NoTime`);
  const usage = state === "error" ? null : element(document, "p", { "data-limit-usage": "true", text: syncUsage(model.language, limits.syncBytes ?? {}) });
  return settingsNotice(document, "wait", attributes, title, usage);
}

// The service reports a record in English; the screen says which file and what kind of failure, in its own words.
const ISSUE_REASONS = { "The state could not be projected.": "settingsIssueState", "The task could not be projected.": "settingsIssueTask" };

function renderIssues(document, model, t, actions) {
  const issues = model.issues;
  const files = element(document, "ul", { class: "settings-issue-files", "data-issue-files": "true" }, issues.map(issue => element(document, "li", {},
    element(document, "code", { text: issue.path ?? "" }),
    element(document, "span", { text: t(issue.code === "corrupt_resource" && Object.hasOwn(ISSUE_REASONS, issue.message) ? ISSUE_REASONS[issue.message] : "settingsIssueOther") }))));
  const toggle = settingsButton(document, "settings-issues-toggle", "", null, false, true);
  const paint = open => {
    if (open) files.removeAttribute("hidden"); else files.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = t(open ? "settingsHideFiles" : "settingsShowFiles");
  };
  paint(model.issuesOpen === true);
  toggle.addEventListener("click", () => {
    const open = files.getAttribute("hidden") !== null;
    paint(open);
    actions.onIssuesOpen?.(open);
  });
  return settingsNotice(document, "error", { "data-issues": "true" }, cardinal(model.language, "settingsIssues", issues.length), [t("settingsIssuesNote"), files], toggle);
}

function renderAgents(document, model, t, actions, permissionsOpen = false) {
  const disabled = !model.canWrite || model.readOnly || model.loading;
  const reviewDisabled = disabled || model.machine !== model.localMachine;
  const items = model.agents?.items ?? [];
  const section = settingsCard(document, t("finalAgentsOn", { machine: model.machine }), element(document, "div", { class: "settings-scan" },
    element(document, "small", { text: t("finalScanned", { time: formatWhen(model.language, model.agents?.reportedAt) || t("unknown") }) }),
    settingsButton(document, "settings-scan", t("settingsScan"), actions.onScan, disabled, true, retryGlyph(document))));
  const waiting = items.filter(agent => agent.found && agent.cli?.state !== "connected" && (agent.cli?.changes ?? 0) > 0);
  if (waiting.length) section.append(renderAgentsNotice(document, model, t, actions, waiting, reviewDisabled));
  for (const agent of items) {
    const row = element(document, "div", { class: agent.found ? "settings-agent-row" : "settings-agent-row is-missing", "data-agent": agent.id });
    row.append(element(document, "span", { class: "settings-avatar", "aria-hidden": "true" }, icon(document, "executor")),
      element(document, "div", { class: "settings-agent-identity" }, element(document, "strong", { text: agent.name }),
        element(document, "small", { text: agent.found ? `CLI ${agent.version ?? t("unknown")}` : t("settingsNotFound") })));
    if (!agent.found) row.append(settingsButton(document, `settings-find-${agent.id}`, t("settingsFindIt"), () => actions.onFind?.(agent), disabled, true));
    else {
      const cli = element(document, "div", { class: "settings-agent-cli" });
      if (agent.cli?.state === "connected") {
        cli.append(element(document, "span", { class: "settings-connected", text: t("settingsConnected") }));
        const modes = element(document, "div", { class: "settings-segment settings-agent-mode" });
        for (const [mode, key] of [["auto", "settingsAuto"], ["on-demand", "settingsOnDemand"]]) {
          const button = choice(document, "agent-mode", mode, t(key), agent.mode === mode, () => actions.onReview?.(agent, mode, "cli"));
          button.setAttribute("data-action", `settings-mode-${agent.id}-${mode}`);
          button.disabled = reviewDisabled;
          modes.append(button);
        }
        cli.append(modes);
      } else {
        const count = cardinal(model.language, "settingsChanges", agent.cli?.changes ?? 0);
        const link = element(document, "button", { type: "button", class: "btn is-link", "data-action": `settings-review-${agent.id}`, "aria-label": `${agent.name}: ${count}`,
          onclick: () => actions.onReview?.(agent, agent.mode, "cli") }, count, icon(document, "chevronRight"));
        link.disabled = reviewDisabled;
        cli.append(link);
      }
      const app = element(document, "div", { class: "settings-agent-app" });
      if (agent.app?.state === "connected") app.append(element(document, "span", { class: "settings-connected", text: t("settingsAppConnected", { app: agent.app.name }) }));
      else if (agent.app?.state === "available" && agent.app.name) app.append(settingsButton(document, `settings-app-${agent.id}`, t("settingsConnectApp", { app: agent.app.name }), () => actions.onReview?.(agent, agent.mode, "app"), reviewDisabled, true));
      else app.append(element(document, "span", { text: t("settingsNoApp") }));
      row.append(cli, app);
      if (agent.cli?.state === "connected" || agent.app?.state === "connected") row.append(settingsButton(document, `settings-disconnect-${agent.id}`, t("settingsDisconnect"), () => actions.onDisconnect?.(agent), reviewDisabled, true));
    }
    section.append(row);
    const capability = model.agents?.connectedClients?.find(item => item.id === agent.id);
    if (capability) row.append(element(document, 'small', { class: 'settings-client-capability', text:
      capability.models.map(item => catalogLabel(item.title, item.id, model.language)).join(', ') + ' · ' + (capability.id === 'lyra' ? startText(model.language, 'localQuota')
        : capability.quota?.known ? startText(model.language, 'quota', { label: capability.quota.period ?? capability.title, percent: capability.quota.remainingPercent }) : startText(model.language, 'quotaUnknown')) }));
  }
  if (!items.length) section.append(element(document, "p", { text: t("settingsNoAgents") }));
  if (model.machine !== model.localMachine && !model.readOnly) section.append(element(document, "p", { class: "settings-hint", text: t("settingsReviewOwner", { machine: model.machine }) }));
  for (const key of ["finalCliExplanation", "finalAppExplanation", "finalManualExplanation"]) section.append(element(document, "p", { class: "settings-hint", text: t(key) }));
  const standing = model.permissions ? (model.permissions.unitGrants?.length ?? 0) + (model.permissions.agentPermissions?.length ?? 0) : null;
  return element(document, "div", { class: "settings-column" }, section, settingsDisclosure(document, "settings-permissions", t("settingsPermissions"),
    standing === null ? "" : standing ? cardinal(model.language, "settingsPermissionsCount", standing) : t("settingsPermissionsNone"), permissionsOpen, renderPermissions(document, model, t, actions)));
}

// Every agent that is behind needs the same rules, commands and Relay entry, so one notice offers to read and apply them together.
function renderAgentsNotice(document, model, t, actions, waiting, disabled) {
  const counts = waiting.map(agent => agent.cli.changes);
  const most = Math.max(...counts);
  const body = counts.every(count => count === most) ? cardinal(model.language, "settingsNeedSame", most) : t("settingsNeedUpTo", { count: formatNumber(model.language, most) });
  return settingsNotice(document, "wait", { "data-agents-notice": "true" }, cardinal(model.language, "settingsNeedTitle", waiting.length), body,
    settingsButton(document, "settings-review-all", t("settingsReviewAll"), () => actions.onReviewAll?.(waiting), disabled));
}

function renderPermissions(document, model, t, actions) {
  const disabled = model.readOnly || model.loading;
  const standing = settingsSection(document, t("settingsStanding"));
  const agents = settingsSection(document, t("settingsAgentPermissions"));
  const row = (id, name, description, at, action, cannotWrite) => {
    const revoke = settingsButton(document, `settings-revoke-${id}`, t("revoke"), action, disabled || cannotWrite, true);
    revoke.setAttribute("aria-label", `${t("revoke")}: ${name}, ${description}`);
    return element(document, "div", { class: "settings-grant", "data-permission": id }, element(document, "strong", { text: name }),
      element(document, "code", { text: description }), element(document, "small", { text: formatWhen(model.language, at) }), revoke);
  };
  for (const item of model.permissions?.unitGrants ?? []) standing.append(row(item.grant.id, item.unitId,
    item.grant.pattern?.command ?? `${item.grant.action}: ${JSON.stringify(item.grant.pattern)}`, item.grant.grantedAt,
    () => actions.onRevokeGrant?.(item), !model.canRevoke || model.pendingGrants?.has(item.grant.id)));
  for (const item of model.permissions?.agentPermissions ?? []) {
    const automatic = item.actions.includes('native.automatic');
    agents.append(row(item.id, automatic ? item.unitId : clientLabel(item.client, model.language), automatic ? startText(model.language, 'automaticPermission', { client: clientLabel(item.client, model.language) }) : item.actions.join(", "),
      item.grantedAt, () => actions.onRevokePermission?.(item), !model.canWrite));
  }
  if ((model.permissions?.agentPermissions ?? []).some(item => item.actions.includes('native.automatic'))) agents.append(element(document, 'p', { class: 'settings-hint', text: startText(model.language, 'automaticRevokeHint') }));
  standing.append(element(document, "p", { class: "settings-hint", text: t("finalStandingExplanation") }));
  agents.append(element(document, "p", { class: "settings-hint", text: t("finalAgentPermissionExplanation") }));
  if (!model.permissions?.unitGrants?.length) standing.append(element(document, "p", { text: t("settingsNoStanding") }));
  if (!model.permissions?.agentPermissions?.length) agents.append(element(document, "p", { text: t("settingsNoAgentPermissions") }));
  return element(document, "div", { class: "settings-permissions" }, standing, agents);
}

function renderProjects(document, model, t, actions) {
  const links = model.projects?.clusterLinks ?? [];
  const canWrite = model.canWrite && !model.readOnly;
  const section = settingsCard(document, t("settingsClusterLinks"),
    settingsButton(document, 'settings-link-folder', startText(model.language, 'linkFolder'), actions.onLinkFolder, !canWrite, false, icon(document, "plus")));
  if (!links.length) {
    section.append(element(document, "p", { text: t("settingsNoLinks") }));
    return section;
  }
  const view = { query: model.projectQuery ?? "", order: model.projectOrder === "descending" ? "descending" : "ascending" };
  const label = cardinal(model.language, "settingsLinkSearch", links.length);
  const search = element(document, "input", { type: "text", autocomplete: "off", placeholder: label, "aria-label": label, "data-action": "settings-link-search", "data-keep": "settings|projects-search" });
  search.value = view.query;
  const order = element(document, "button", { type: "button", class: "btn is-secondary", "data-action": "settings-link-order" });
  const list = element(document, "div", { class: "settings-link-list" });
  const collator = new Intl.Collator(model.language === "es" ? "es" : "en", { sensitivity: "accent" });
  const lower = value => String(value ?? "").toLocaleLowerCase(model.language);
  const place = link => {
    if (link.kind === "none") return element(document, "span", { class: "settings-link-note", text: startText(model.language, "noLink") });
    if (!link.available) return element(document, "span", { class: "settings-chip", "data-link-missing": "true" }, icon(document, "alert"), t("settingsNotHere"));
    return link.localPath ? element(document, "code", { class: "settings-link-path", title: link.localPath, text: link.localPath }) : null;
  };
  const row = link => {
    const name = displayName(link.title);
    const items = [];
    if (link.available && link.kind !== "none" && model.machine === model.localMachine) items.push({ id: "open-editor", label: startText(model.language, "openEditor"), run: () => actions.onOpenEditor?.(link) });
    if (link.available && link.localPath) items.push({ id: "copy-path", label: t("settingsCopyPath"), run: () => actions.onCopyPath?.(link) });
    if (link.kind !== "none") items.push({ id: "unlink", label: t("settingsUnlink"), danger: true, rule: items.length > 0, disabled: !canWrite, run: () => actions.onRemoveLink?.(link) });
    const more = !items.length ? null : element(document, "button", { type: "button", class: "settings-more", "data-action": "settings-link-more", "aria-haspopup": "menu",
      "aria-label": startText(model.language, "menuLabel", { name }), title: startText(model.language, "moreMenu") }, pathIcon(document, "M5 12h.1M12 12h.1M19 12h.1"));
    more?.addEventListener("click", () => {
      const box = more.getBoundingClientRect?.();
      openContextMenu(document, { x: box ? box.right - 210 : 0, y: box ? box.bottom + 6 : 0, items, label: startText(model.language, "menuLabel", { name }) });
    });
    return element(document, "div", { class: "settings-link-row", "data-cluster-link": link.clusterId }, icon(document, link.kind === "folder" ? "folder" : "graph"),
      element(document, "strong", { class: "settings-link-name", text: name }), place(link), more);
  };
  const paint = () => {
    const needle = lower(view.query.trim());
    const sign = view.order === "ascending" ? 1 : -1;
    const shown = links.filter(link => !needle || lower(displayName(link.title)).includes(needle) || lower(link.localPath).includes(needle))
      .sort((left, right) => sign * collator.compare(displayName(left.title), displayName(right.title)) || String(left.clusterId).localeCompare(String(right.clusterId)));
    list.replaceChildren(...(shown.length ? shown.map(row) : [element(document, "p", { class: "settings-hint", text: t("settingsLinkNoMatch") })]));
    order.replaceChildren(t(view.order === "ascending" ? "settingsOrderAscending" : "settingsOrderDescending"), icon(document, "chevron"));
  };
  search.addEventListener("input", () => { view.query = search.value; paint(); actions.onProjectView?.({ query: view.query, order: view.order }); });
  order.addEventListener("click", () => { view.order = view.order === "ascending" ? "descending" : "ascending"; paint(); actions.onProjectView?.({ query: view.query, order: view.order }); });
  paint();
  section.append(element(document, "div", { class: "settings-link-tools" },
    element(document, "label", { class: "settings-search" }, pathIcon(document, "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6"), search), order), list);
  return section;
}

function renderContent(document, model, t, actions) {
  const content = model.content;
  if (!content) return element(document, "p", { text: t("loadingList") });
  const draft = model.contentDraft ?? content;
  const select = (item, field) => {
    if (item.additionId) {
      const row = renderAddedContent(document, item, model.language, {
        onIncluded: (_item, included) => actions.onContentItem?.(field, item.id, included),
        onUpdate: actions.onUpdateAddition, onRemove: actions.onRemoveAddition,
      });
      for (const input of row.querySelectorAll('input')) {
        input.disabled = !model.canWrite;
        input.setAttribute('data-content-item', item.id);
        input.setAttribute('data-action', `settings-content-${item.id}`);
      }
      for (const button of row.querySelectorAll('button')) button.disabled = !model.canWrite;
      return row;
    }
    const input = element(document, "input", { type: "checkbox", "data-content-item": item.id, "data-action": `settings-content-${item.id}` });
    input.checked = item.included;
    input.disabled = !model.canWrite;
    input.addEventListener("change", () => actions.onContentItem?.(field, item.id, input.checked));
    return element(document, "label", { class: "settings-content-item" }, input, item.title);
  };
  const features = element(document, "div", { class: "settings-content-groups" });
  for (const [category, key] of [["planning", "finalPlanning"], ["quality", "finalQuality"], ["continuity", "finalContinuity"], ["other", "finalOther"]]) {
    const items = draft.features.filter(item => item.category === category);
    if (items.length) features.append(element(document, "div", {}, element(document, "h4", { text: t(key) }), items.map(item => select(item, "features"))));
  }
  const knowledge = element(document, "div", { class: "settings-content-groups" }, draft.knowledge.map(item => select(item, "knowledge")));
  const preferences = settingsSection(document, t("settingsPreferences"), element(document, "h4", { text: t("settingsAddressStyle") }));
  const styles = element(document, "div", { class: "settings-segment" });
  for (const [style, key] of [["impersonal", "settingsImpersonal"], ["formal", "settingsFormal"], ["explanatory", "settingsExplanatory"]]) {
    const button = choice(document, "address-style", style, t(key), draft.preferences.addressStyle === style, () => actions.onPreference?.("addressStyle", style));
    button.disabled = !model.canWrite;
    styles.append(button);
  }
  const instructions = element(document, "textarea", { "data-preference-instructions": "true", maxlength: "64000", "data-keep": "settings|instructions" });
  instructions.value = draft.preferences.additionalInstructions;
  instructions.disabled = !model.canWrite;
  instructions.addEventListener("input", () => actions.onPreference?.("additionalInstructions", instructions.value, false));
  preferences.append(styles, labeledField(document, t("settingsInstructions"), t("settingsInstructionsHint"), instructions));
  for (const [key, title] of [["keepExistingPreferencesFirst", "settingsKeepPreferences"], ["updateChecks", "settingsUpdates"]]) {
    const input = element(document, "input", { type: "checkbox", "data-preference": key, "data-action": `settings-preference-${key}` });
    input.checked = key === "updateChecks" ? draft.preferences[key] === "daily" : draft.preferences[key];
    input.disabled = !model.canWrite;
    input.addEventListener("change", () => actions.onPreference?.(key, key === "updateChecks" ? input.checked ? "daily" : "off" : input.checked));
    preferences.append(element(document, "label", { class: "settings-fact" }, t(title), element(document, "span", {}, input,
      t(key === "updateChecks" && input.checked ? "settingsDaily" : input.checked ? "finalOn" : "finalOff"))));
  }
  preferences.append(settingsButton(document, "settings-save-content", t("save"), actions.onSaveContent, !model.canWrite || !model.contentDirty));
  if (model.contentConflict) preferences.append(settingsButton(document, "settings-reload-content", t("settingsReloadContent"), actions.onReloadContent));
  const add = addButton(document, model.language, actions.onAdd, true); add.disabled = !model.canWrite;
  return element(document, "div", { class: "settings-columns settings-content-columns" },
    element(document, "div", { class: "settings-column" }, settingsSection(document, t("settingsFeatures"), add, features), settingsSection(document, t("settingsKnowledge"), knowledge)),
    preferences);
}

// The longest folder every path shares, ending at a separator, or an empty string when they share none.
function commonFolder(paths) {
  if (!paths.length) return "";
  let prefix = paths[0];
  for (const item of paths.slice(1)) while (prefix && !item.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf("\\"), prefix.lastIndexOf("/"));
  return cut > 0 ? prefix.slice(0, cut) : "";
}

const CHANGE_DESCRIPTIONS = { "Load the M1ND rules in every session": "settingsLoadRules", "Stop loading the M1ND rules automatically": "settingsStopRules",
  "Remove owned Content no longer included": "settingsRemoveContent", "Make included M1ND Content available on demand": "settingsIncludeContent" };

// The service describes a change in English; the screen says it in the viewer's language.
function describeChange(change, t) {
  return change.id === "mcp" ? t("settingsRelayChange") : change.id === "hooks" ? t("settingsHooksChange") : change.optional ? t("settingsGitChange")
    : CHANGE_DESCRIPTIONS[change.description] ? t(CHANGE_DESCRIPTIONS[change.description]) : change.description;
}

function groupChanges(changes, t) {
  const groups = new Map();
  for (const change of changes) {
    const key = describeChange(change, t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  return groups;
}

export function renderClientReview(document, review, t, actions) {
  const dialog = element(document, "dialog", { class: "dialog settings-review", "data-settings-review": review.agent.id });
  const heading = element(document, "h2", { text: t("settingsConnectTitle", { client: review.target === "app" ? review.agent.app.name : `${review.agent.name} CLI` }) });
  labelDialog(dialog, heading);
  dialog.append(heading, element(document, "p", { text: t("finalReviewExplanation", { machine: review.machine }) }));
  const selected = review.selected;
  const apply = settingsButton(document, "settings-apply", "", () => actions.onApply?.([...selected]));
  const update = () => { apply.textContent = t("settingsApply", { count: selected.size }); apply.disabled = !selected.size; };
  // Changes of one kind are one row with a count and their folder; the files open on demand, so 53 changes read as a few lines.
  const list = element(document, "div", { class: "settings-review-list" });
  for (const optional of [false, true]) {
    const changes = review.preview.changes.filter(change => change.optional === optional);
    if (optional && changes.length) list.append(element(document, "h3", { text: t("settingsOptional") }));
    for (const [description, members] of groupChanges(changes, t)) {
      const inputs = members.map((change) => {
        const input = element(document, "input", { type: "checkbox", "data-review-change": change.id, "aria-label": change.path });
        input.checked = selected.has(change.id);
        return input;
      });
      const group = element(document, "input", { type: "checkbox", "data-review-group": description });
      const sync = () => { const on = inputs.filter(input => input.checked).length; group.checked = on === inputs.length; group.indeterminate = on > 0 && on < inputs.length; };
      group.addEventListener("change", () => {
        for (const [index, input] of inputs.entries()) { input.checked = group.checked; if (group.checked) selected.add(members[index].id); else selected.delete(members[index].id); }
        sync(); update();
      });
      for (const [index, input] of inputs.entries()) input.addEventListener("change", () => {
        if (input.checked) selected.add(members[index].id); else selected.delete(members[index].id);
        sync(); update();
      });
      sync();
      const folder = commonFolder(members.map(change => change.path));
      const row = element(document, "div", { class: "settings-change" + (members.length > 1 ? " is-group" : "") });
      if (members.length === 1) {
        row.append(element(document, "label", {}, inputs[0], element(document, "span", {}, element(document, "strong", { text: description }), element(document, "code", { text: members[0].path }))),
          element(document, "details", {}, element(document, "summary", { text: t("details") }), element(document, "pre", { text: members[0].afterText })));
      } else {
        const files = element(document, "ul", { class: "settings-change-files" }, members.map((change, index) => element(document, "li", {},
          element(document, "label", {}, inputs[index], element(document, "code", { text: folder ? change.path.slice(folder.length).replace(/^[\\/]/, "") : change.path })))));
        row.append(element(document, "label", {}, group, element(document, "span", {},
          element(document, "strong", { text: `${description} (${members.length})` }), element(document, "code", { text: folder || members[0].path }))),
          element(document, "details", {}, element(document, "summary", { text: t("details") }), files));
      }
      list.append(row);
    }
  }
  dialog.append(list);
  dialog.append(element(document, "p", { class: "settings-hint", text: t("finalAgentPermissionExplanation") }),
    element(document, "p", { text: t("finalBackupExplanation") }));
  if (review.preview.restartRequired) dialog.append(element(document, "p", { text: t("finalRestartClientExplanation", { client: review.agent.name }) }));
  dialog.append(element(document, "div", { class: "dialog-actions" }, settingsButton(document, "settings-review-cancel", t("cancel"), () => dialog.close()),
    settingsButton(document, "settings-copy", t("settingsCopy"), () => actions.onCopy?.([...selected])), apply));
  update();
  return dialog;
}

// One dialog for every agent that is behind: a disclosure per agent with its changes grouped as in the single review, the first one open.
export function renderReviewAll(document, review, t, actions) {
  const dialog = element(document, "dialog", { class: "dialog settings-review", "data-settings-review-all": "true" });
  const heading = element(document, "h2", { text: t("settingsReviewAll") });
  labelDialog(dialog, heading);
  dialog.append(heading, element(document, "p", { text: t("settingsReviewAllIntro", { machine: review.machine }) }));
  const list = element(document, "div", { class: "settings-review-list" });
  for (const [index, { agent, preview }] of review.items.entries()) {
    const changes = preview.changes.filter(change => !change.optional);
    const body = element(document, "div", { class: "settings-review-agent-body" });
    for (const [description, members] of groupChanges(changes, t)) {
      const folder = commonFolder(members.map(change => change.path));
      const files = members.length === 1
        ? element(document, "pre", { text: members[0].afterText })
        : element(document, "ul", { class: "settings-change-files" }, members.map(change => element(document, "li", {},
          element(document, "code", { text: folder ? change.path.slice(folder.length).replace(/^[\\/]/, "") : change.path }))));
      body.append(element(document, "div", { class: "settings-change" + (members.length > 1 ? " is-group" : "") },
        element(document, "span", { class: "settings-change-title" }, element(document, "strong", { text: members.length > 1 ? `${description} (${members.length})` : description }),
          element(document, "code", { text: folder || members[0].path })),
        element(document, "details", {}, element(document, "summary", { text: t("details") }), files)));
    }
    if (preview.restartRequired) body.append(element(document, "p", { class: "settings-hint", text: t("finalRestartClientExplanation", { client: agent.name }) }));
    const item = element(document, "details", { class: "settings-review-agent", "data-review-agent": agent.id },
      element(document, "summary", {}, icon(document, "chevronRight"), element(document, "strong", { text: agent.name }),
        element(document, "span", { class: "settings-disclosure-status", text: cardinal(review.language, "settingsChanges", changes.length) })), body);
    if (index === 0) { item.open = true; item.setAttribute("open", ""); }
    list.append(item);
  }
  dialog.append(list, element(document, "p", { text: t("finalBackupExplanation") }));
  dialog.append(element(document, "div", { class: "dialog-actions" }, settingsButton(document, "settings-review-cancel", t("cancel"), () => dialog.close(), false, true),
    settingsButton(document, "settings-apply-all", t("settingsApplyAll"), () => actions.onApplyAll?.(review), !review.items.some(({ preview }) => preview.changes.some(change => !change.optional)))));
  return dialog;
}

function renderHome(document, model, t, actions) {
  const home = model.home;
  const expiry = updateExpiry(home, model.now ?? Date.now());
  const open = Boolean(home?.enabled) && !expiry.expired;
  const body = [element(document, "p", { text: t("finalPhoneHint") })];
  if (!open) {
    body.push(element(document, "p", { text: t("homeClosed") }));
  } else {
    body.push(element(document, "p", { "data-phone-count": home.phoneCount ?? "unknown", text: Number.isInteger(home.phoneCount)
      ? t(home.phoneCount === 1 ? "finalPhoneStatus" : "finalPhoneStatusPlural", { time: formatShortTime(model.language, home.expiresAt), count: home.phoneCount })
      : `${t("homeActive", { time: formatShortTime(model.language, home.expiresAt) })} ${t("settingsPhoneCountUnknown")}` }));
    const hours = Math.floor(expiry.remainingSeconds / 3600), minutes = Math.floor(expiry.remainingSeconds % 3600 / 60);
    body.push(element(document, "p", { "data-remaining": String(expiry.remainingSeconds), text: expiry.remainingSeconds < 60
      ? t("finalAccessClosesSoon") : t("finalAccessCloses", { hours, minutes }) }));
  }
  const grant = !expiry.expired ? model.grant : null;
  if (grant?.qrPayloads?.length) {
    const dialog = element(document, "dialog", { class: "dialog settings-phone-dialog", "data-phone-dialog": "true" });
    const heading = element(document, "h2", { text: t("settingsOpenPhone") });
    labelDialog(dialog, heading);
    dialog.append(heading, element(document, "p", { text: t("finalPhoneHint") }),
      element(document, "div", { class: "settings-phone-columns" }, renderHomeGrant(document, grant, model.selected ?? 0, t("qrTitle")),
        element(document, "div", {}, element(document, "p", { text: t("finalTypeCode") }),
          element(document, "p", { "data-secret": "true", text: grant.shortCode }),
          element(document, "p", { text: t("finalAccessCloses", { hours: Math.floor(expiry.remainingSeconds / 3600), minutes: Math.floor(expiry.remainingSeconds % 3600 / 60) }) }),
          element(document, "p", { text: t("finalNewCodeHint") }))),
      element(document, "div", { class: "dialog-actions" }, settingsButton(document, "close-home", t("settingsCloseAccess")),
        settingsButton(document, "phone-done", t("finalDone"), () => actions.onDismissHome?.())));
    dialog.addEventListener("cancel", event => { event.preventDefault(); actions.onDismissHome?.(); });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); actions.onDismissHome?.(); }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button, input")].filter(control => !control.disabled);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    });
    body.push(dialog);
  }
  else if (open) body.push(element(document, "p", { text: t("noGrantSecret") }));
  if (model.canManage && !open) {
    body.push(addressField(document, t));
    body.push(element(document, "div", { class: "settings-actions" },
      element(document, "button", { type: "button", class: "btn is-secondary", "data-action": "open-home", text: t("settingsOpenPhone") })));
  } else if (model.canManage && home?.enabled) {
    body.push(addressField(document, t));
    body.push(element(document, "div", { class: "settings-actions" },
      element(document, "button", { type: "button", class: "btn is-secondary", "data-action": "replace-home", text: t("settingsOpenPhone") }),
      element(document, "button", { type: "button", class: "btn", "data-action": "close-home", text: t("settingsCloseAccess") })));
  }
  // A grant is shown in a dialog inside this disclosure, so it stays open while the dialog is.
  const block = settingsDisclosure(document, "settings-phone", t("settingsPhone"),
    open ? t("settingsOpenUntil", { time: formatShortTime(model.language, home.expiresAt) }) : t("settingsClosed"), Boolean(grant?.qrPayloads?.length), ...body);
  block.setAttribute("data-home", open ? "open" : "closed");
  block.addEventListener("click", (event) => {
    const link = event.target?.closest?.("[data-link]");
    if (link) actions.onSelect?.(Number(link.getAttribute("data-link")));
    const action = event.target?.closest?.("[data-action]")?.getAttribute("data-action");
    if (action === "open-home" || action === "replace-home") actions.onOpen?.(block.querySelector("[data-addresses]")?.value ?? "", action === "replace-home");
    if (action === "close-home") actions.onClose?.();
  });
  return block;
}

function addressField(document, t) {
  const input = element(document, "input", { "data-addresses": "true", "data-keep": "home|addresses" });
  input.value = "";
  return labeledField(document, t("addressLabel"), t("addressHint"), input);
}

function choice(document, kind, value, label, selected, onChoose) {
  return element(document, "button", {
    type: "button",
    class: selected ? "btn is-selected" : "btn",
    "data-action": `settings-${kind}-${value}`,
    [`data-${kind}`]: value,
    "aria-pressed": selected ? "true" : "false",
    text: label,
    onclick: () => onChoose?.(value),
  });
}

function homeFields(home) {
  if (!home) return { enabled: false, openedAt: null, expiresAt: null, addresses: [], remainingSeconds: 0 };
  return {
    enabled: Boolean(home.enabled),
    openedAt: home.openedAt ?? null,
    expiresAt: home.expiresAt ?? null,
    addresses: home.addresses ?? [],
    remainingSeconds: home.remainingSeconds ?? 0,
    phoneCount: Number.isInteger(home.phoneCount) ? home.phoneCount : null,
  };
}

export const LOOK_OPTIONS = Object.freeze([
  { id: 'modern', label: 'Modern' }, { id: 'high-contrast', label: 'Nocturne' },
  { id: 'nebula', label: 'Nebula' }, { id: 'txmska', label: 'Waves' },
  { id: 'coffee-cat', label: 'Toxic' }, { id: 'ntk', label: 'Kinetic' },
]);
export const LOOK_IDS = Object.freeze(LOOK_OPTIONS.map((look) => look.id));
export function renderLookPreview(document, look, selected, onChoose) {
  const button = element(document, 'button', { type: 'button', class: 'look-choice',
    'data-action': `settings-look-${look.id}`,
    'aria-label': look.label, 'aria-pressed': String(selected), onclick: () => onChoose?.(look.id) });
  const preview = element(document, 'span', { class: 'look-preview', 'data-look': look.id, 'aria-hidden': 'true' });
  preview.addEventListener('click', event => { if (button.disabled) return; event.stopPropagation?.(); onChoose?.(look.id); });
  preview.append(element(document, 'span', { class: 'look-preview-bar' },
    element(document, 'span', { class: 'look-preview-mark' }),
    element(document, 'span', { class: 'look-preview-modes' })));
  const panels = element(document, 'span', { class: 'look-preview-panels' });
  const side = element(document, 'span', { class: 'look-preview-side' });
  for (const width of [24, 20, 22]) side.append(element(document, 'span', {
    class: 'look-preview-line' + (width === 22 ? ' look-preview-accent' : ''), style: 'width: ' + width + 'px' }));
  const map = element(document, 'span', { class: 'look-preview-map' },
    element(document, 'span', { class: 'look-preview-node look-preview-node-one' }),
    element(document, 'span', { class: 'look-preview-node look-preview-node-two' }));
  const inspector = element(document, 'span', { class: 'look-preview-inspector' });
  for (const [width, height, ink] of [[32, 10, 'card'], [26, 10, 'me'], [30, 7, 'accent']]) {
    inspector.append(element(document, 'span', { class: 'look-preview-bubble look-preview-' + ink,
      style: 'width: ' + width + 'px; height: ' + height + 'px' }));
  }
  panels.append(side, map, inspector);
  preview.append(panels);
  const label = element(document, 'span', { class: 'look-preview-name' },
    element(document, 'span', { class: 'look-preview-radio', 'aria-hidden': 'true' }), look.label);
  button.append(preview, label);
  return button;
}
