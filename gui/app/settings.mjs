import { createOperation, request } from "./api.mjs";
import { element, labeledField } from "./components.mjs";
import { cardinal, formatWhen, limitsUsage } from "./i18n.mjs";
import { encodeHomeQr } from "./qr.mjs";
import { renderQr } from "./qr-render.mjs";

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
      text: grant.links[item],
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
  const service = model.service ?? {};
  panel.append(element(document, "p", { "data-machine": service.machine ?? "", text: t("serviceRunning", { machine: service.machine ?? "" }) }));
  panel.append(element(document, "p", { "data-version": service.version ?? "", text: t("versionLabel", { version: service.version ?? "" }) }));
  panel.append(element(document, "p", { "data-origin": service.originKind ?? "", text: t("originKind", { kind: service.originKind ?? "" }) }));
  panel.append(element(document, "p", {
    "data-sync": model.syncState ?? service.syncState ?? "",
    "data-pending": String(model.pendingChanges ?? ""),
    text: model.syncLabel ?? "",
  }));
  if (model.limits) {
    const limits = model.limits;
    panel.append(element(document, "p", {
      "data-limits": limits.state ?? "normal",
      "data-retry-at": limits.retryAt ?? "",
      text: t(limitsLabel(limits.state), { time: formatWhen(model.language, limits.retryAt) }),
    }));
    const messages = limits.messages ?? {};
    const bytes = limits.syncBytes ?? {};
    panel.append(element(document, "p", {
      "data-limit-usage": "true",
      text: limitsUsage(model.language, messages, bytes),
    }));
  }
  const issues = element(document, "ul", { "data-issues": "true" });
  for (const issue of model.issues ?? []) issues.append(element(document, "li", { text: issue.message ?? "" }));
  panel.append(issues);
  if (model.canWrite) {
    const looks = element(document, "div", { class: "editor-actions" });
    looks.append(choice(document, "look", "modern", t("modern"), model.look === "modern", actions.onLook));
    looks.append(choice(document, "look", "high-contrast", t("highContrast"), model.look === "high-contrast", actions.onLook));
    looks.append(choice(document, "language", "en", t("english"), model.language === "en", actions.onLanguage));
    looks.append(choice(document, "language", "es", t("spanish"), model.language === "es", actions.onLanguage));
    panel.append(looks);
  }
  panel.append(renderHome(document, model, t, actions));
  return panel;
}

function renderHome(document, model, t, actions) {
  const home = model.home;
  const expiry = updateExpiry(home, model.now ?? Date.now());
  const block = element(document, "section", { "data-home": home?.enabled && !expiry.expired ? "open" : "closed" });
  block.append(element(document, "h3", { text: t("homeAccess") }));
  if (!home?.enabled || expiry.expired) {
    block.append(element(document, "p", { text: t("homeClosed") }));
  } else {
    block.append(element(document, "p", { text: t("homeActive", { time: formatWhen(model.language, home.expiresAt) }) }));
    block.append(element(document, "p", { "data-remaining": String(expiry.remainingSeconds), text: cardinal(model.language, "homeRemaining", expiry.remainingSeconds) }));
  }
  const grant = !expiry.expired ? model.grant : null;
  if (grant?.qrPayloads?.length) block.append(renderHomeGrant(document, grant, model.selected ?? 0, t("qrTitle")));
  else if (home?.enabled && !expiry.expired) block.append(element(document, "p", { text: t("noGrantSecret") }));
  if (model.canManage && (!home?.enabled || expiry.expired)) {
    block.append(addressField(document, t));
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "open-home", text: t("homeOpen") }));
  } else if (model.canManage && home?.enabled) {
    block.append(addressField(document, t));
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "replace-home", text: t("homeReplace") }));
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "close-home", text: t("homeClose") }));
  }
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
  };
}
