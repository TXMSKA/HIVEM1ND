import { canAccept, canSendBack } from "./actions.mjs";
import { element, labeledField, progressMark } from "./components.mjs";
import { formatWhen } from "./i18n.mjs";
import { unitDisplayName } from './hierarchy.mjs';

export function renderUnit(document, unit, t, language = "en") {
  const card = element(document, "section", { class: "unit-card" });
  card.append(element(document, "h3", { text: unit ? unitDisplayName(unit) : t("unknown") }));
  card.append(element(document, "p", { text: `${t("role")}: ${unit?.role ?? t("unknown")}` }));
  card.append(element(document, "p", { text: `${t("job")}: ${unit?.job ?? t("unknown")}` }));
  const lines = [
    ["scope", unit?.scope?.name ?? unit?.scope?.kind],
    ["lead", unit?.leadId],
    ["model", unit?.model],
    ["machine", unit?.machine],
    ["branch", unit?.branch],
    ["date", shownDate(language, unit?.date)],
  ];
  const facts = element(document, "div", { class: "unit-facts", "data-unit-facts": "true" });
  for (const [label, value] of lines) {
    facts.append(element(document, "p", { text: `${t(label)}: ${value ?? t("unknown")}` }));
  }
  if (unit?.context) facts.append(element(document, "p", { text: unit.context }));
  card.append(facts);
  return card;
}

export function renderMachine(document, machine, t) {
  const block = element(document, "section", {
    class: "machine-facts",
    "data-machine": machine?.id ?? "",
    "data-answers": machine?.answers ? "true" : "false",
  });
  block.append(element(document, "p", { text: `${machine?.id ?? t("unknown")}: ${machine?.answers ? t("machineAnswers") : t("machineSilent")}` }));
  for (const issue of machine?.issues ?? []) {
    block.append(element(document, "p", { "data-machine-issue": machine.id, text: issue.message || t("machineUnavailable", { machine: machine.id }) }));
  }
  return block;
}

const ACTIVITY_COPY = {
  busy: "sessionWorking",
  working: "sessionWorking",
  idle: "activityIdle",
  active: "activityActive",
  inactive: "activityInactive",
};

const WAKE_COPY = {
  "handoff-budget-exhausted": "wakePausedHandoff",
  "dedupe-budget-exhausted": "wakePausedDedupe",
  "error-budget-exhausted": "wakePausedError",
  expired: "wakePausedExpired",
  disabled: "wakePausedDisabled",
};

function shownDate(language, value) {
  if (value == null || value === "") return null;
  return formatWhen(language, value);
}

function wakeSentence(t, wake) {
  if (!wake) return t("wakeUnknown");
  if (wake.pausedReason) return t(WAKE_COPY[wake.pausedReason] ?? "wakePausedUnknown");
  return wake.enabled ? t("wakeEnabledSentence") : t("wakeOff");
}

export function renderSession(document, session, t) {
  if (!session) return element(document, "p", { text: t("unknown") });
  const block = element(document, "section", { "data-session": session.id, "data-session-state": session.state ?? "" });
  const activity = session.activity ?? "unknown";
  const activityText = t(ACTIVITY_COPY[activity] ?? "activityUnknown");
  if (activity === "busy" || activity === "working") {
    block.append(progressMark(document, activityText, { "data-session-activity": activity }));
  } else {
    block.append(element(document, "p", { "data-session-activity": activity, text: activityText }));
  }
  const quota = session.quota;
  const quotaText = quota == null ? t("unknown") : `${quota.remaining ?? t("unknown")}${quota.exhausted ? ` ${t("statusQuota")}` : ""}`;
  block.append(element(document, "p", { "data-session-quota": quota == null ? "unknown" : "known", text: `${t("sessionQuota")}: ${quotaText}` }));
  const wake = session.wake;
  const wakeState = !wake ? "unknown" : wake.pausedReason ? "paused" : wake.enabled ? "enabled" : "off";
  block.append(element(document, "p", { "data-session-wake": wakeState, text: wakeSentence(t, wake) }));
  return block;
}

export function renderGrants(document, grants, t, onRevoke, busyId = null) {
  const block = element(document, "section", { class: "grants" });
  for (const grant of grants ?? []) {
    const row = element(document, "article", { class: "grant" });
    row.append(element(document, "p", { "data-grant-action": grant.action ?? "", text: grant.action || t("unknown") }));
    row.append(element(document, "p", { "data-grant-pattern": "true", text: patternText(grant.pattern) || t("unknown") }));
    const busy = busyId === grant.id;
    if (busy) row.append(progressMark(document, t("working")));
    if (onRevoke) row.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "revoke-grant",
      "data-grant": grant.id,
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: t("revoke"),
      onclick: () => onRevoke(grant),
    }));
    block.append(row);
  }
  return block;
}

export function renderApproval(document, approval, t, onAnswer, busy = false) {
  const block = element(document, "section", { class: "card", "data-approval": approval.id, "data-approval-state": approval.state });
  block.append(element(document, "p", { text: approval.display ?? approval.action ?? approval.id }));
  if (busy) block.append(progressMark(document, t("answering"), { "data-approval-progress": approval.id }));
  if (approval.state === "pending") {
    const button = (action, label) => element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": action,
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: label,
      onclick: () => onAnswer?.(approval, action),
    });
    block.append(button("approve", t("approve")));
    if (approval.alwaysAllowed !== false) block.append(button("approve-always", t("approveAlways")));
    block.append(button("deny", t("deny")));
  }
  return block;
}

export function renderTask(document, task, t, onStatus, onUndo, draft = "", onDraft, allowSendBack = canSendBack(task), busy = false) {
  const block = element(document, "section", { class: "card", "data-task": task.id, "data-reviewable": String(Boolean(task.reviewable)), "data-task-status": task.status });
  block.append(element(document, "p", { text: `${task.number} ${task.title}` }));
  if (busy) block.append(progressMark(document, t("working"), { "data-task-progress": task.id }));
  const accept = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "accept",
    "aria-busy": busy ? "true" : "false",
    text: t("accept"),
    onclick: () => onStatus?.(task, "done"),
  });
  if (!canAccept(task) || busy) accept.disabled = true;
  if (!canAccept(task) && !busy) {
    const hint = element(document, "p", { id: `reason-accept-${task.id}`, class: "field-hint", "data-disabled-reason": "accept", text: t("acceptNeedsReview") });
    accept.setAttribute("aria-describedby", hint.id ?? `reason-accept-${task.id}`);
    block.append(hint);
  }
  const note = element(document, "input", { "data-note": task.id, "data-keep": `note|${encodeURIComponent(task.id)}` });
  note.value = draft;
  note.addEventListener("input", () => onDraft?.(note.value, note.selectionStart, note.selectionEnd));
  const back = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "send-back",
    text: t("sendBack"),
    onclick: () => onStatus?.(task, "open", note.value),
  });
  if (!allowSendBack || busy) back.disabled = true;
  if (busy) back.setAttribute("aria-busy", "true");
  if (!allowSendBack && !busy) {
    const hint = element(document, "p", { id: `reason-back-${task.id}`, class: "field-hint", "data-disabled-reason": "send-back", text: t("sendBackNeedsReview") });
    back.setAttribute("aria-describedby", `reason-back-${task.id}`);
    block.append(hint);
  }
  block.append(accept, labeledField(document, t("sendBack"), t("sendBackHint"), note), back);
  if (task.undoAvailable && onUndo) {
    block.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "undo",
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: t("undo"),
      onclick: () => onUndo?.(task),
    }));
  }
  return block;
}

export function renderWaiting(document, items, t, onOpen, emptyAction = null) {
  const block = element(document, "section", { class: "waiting-list", "data-waiting": String(items?.length ?? 0) });
  if (!items?.length) {
    block.append(element(document, "p", { "data-empty": "waiting", text: t("emptyWaiting") }));
    block.append(element(document, "p", { class: "field-hint", "data-empty-next": "waiting", text: t("emptyWaitingNext") }));
    if (emptyAction) block.append(emptyAction);
  }
  for (const item of items ?? []) {
    const attrs = {
      "data-waiting-item": item.id,
      "data-kind": item.kind ?? "",
      "data-approval": item.approvalId ?? "",
      "data-task": item.taskId ?? "",
      "data-chat": item.chatId ?? "",
      "data-message": item.messageId ?? "",
      "data-unit": item.unitId ?? "",
      text: item.title || item.kind || "",
    };
    if (onOpen) block.append(element(document, "button", { type: "button", class: "btn", ...attrs, onclick: () => onOpen(item) }));
    else block.append(element(document, "p", attrs));
  }
  return block;
}

export function openTaskDetail(document, task, t) {
  const requirements = (task.requirements ?? []).join(", ");
  return element(document, "article", { "data-task-detail": task.id },
    element(document, "h3", { text: task.title ?? "" }),
    element(document, "p", { text: task.request ?? "" }),
    element(document, "p", { text: task.report ?? "" }),
    element(document, "p", { "data-requirements": requirements, text: `${t("requirements")}: ${requirements || t("unknown")}` }),
    element(document, "p", { "data-approved-by": task.approvedBy ?? "", text: `${t("approvedBy")}: ${task.approvedBy ?? t("unknown")}` }),
  );
}

function patternText(pattern) {
  if (!pattern || typeof pattern !== "object") return "";
  return Object.keys(pattern).sort().map((key) => `${key}: ${pattern[key]}`).join(", ");
}
