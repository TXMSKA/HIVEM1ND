import { canAccept, canSendBack } from "./actions.mjs";
import { element } from "./components.mjs";

export function renderUnit(document, unit, t) {
  const lines = [
    ["role", unit?.role],
    ["scope", unit?.scope?.name ?? unit?.scope?.kind],
    ["lead", unit?.leadId],
    ["job", unit?.job],
    ["model", unit?.model],
    ["machine", unit?.machine],
    ["branch", unit?.branch],
    ["date", unit?.date],
  ];
  const block = element(document, "section", { class: "unit-facts" });
  for (const [label, value] of lines) {
    block.append(element(document, "p", { text: `${t(label)}: ${value ?? t("unknown")}` }));
  }
  if (unit?.context) block.append(element(document, "p", { text: unit.context }));
  return block;
}

export function renderSession(document, session, t) {
  if (!session) return element(document, "p", { text: t("unknown") });
  return element(document, "p", { text: `${session.state ?? t("unknown")} ${session.activity ?? t("unknown")}` });
}

export function renderGrants(document, grants, t, onRevoke) {
  const block = element(document, "section", { class: "grants" });
  for (const grant of grants ?? []) {
    if (onRevoke) block.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "revoke-grant",
      "data-grant": grant.id,
      text: t("revoke"),
      onclick: () => onRevoke(grant),
    }));
  }
  return block;
}

export function renderApproval(document, approval, t, onAnswer) {
  const block = element(document, "section", { "data-approval": approval.id, "data-approval-state": approval.state });
  block.append(element(document, "p", { text: approval.display ?? approval.action ?? approval.id }));
  if (approval.state === "pending") {
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "approve", text: t("approve"), onclick: () => onAnswer?.(approval, "approve") }));
    if (approval.alwaysAllowed !== false) {
      block.append(element(document, "button", { type: "button", class: "btn", "data-action": "approve-always", text: t("approveAlways"), onclick: () => onAnswer?.(approval, "approve-always") }));
    }
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "deny", text: t("deny"), onclick: () => onAnswer?.(approval, "deny") }));
  }
  return block;
}

export function renderTask(document, task, t, onStatus, onUndo, draft = "", onDraft, allowSendBack = canSendBack(task)) {
  const block = element(document, "section", { "data-task": task.id, "data-reviewable": String(Boolean(task.reviewable)), "data-task-status": task.status });
  block.append(element(document, "p", { text: `${task.number} ${task.title}` }));
  const accept = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "accept",
    text: t("accept"),
    onclick: () => onStatus?.(task, "done"),
  });
  if (!canAccept(task)) accept.disabled = true;
  const note = element(document, "input", { "data-note": task.id, "aria-label": t("sendBack") });
  note.value = draft;
  note.addEventListener("input", () => onDraft?.(note.value, note.selectionStart, note.selectionEnd));
  const back = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "send-back",
    text: t("sendBack"),
    onclick: () => onStatus?.(task, "open", note.value),
  });
  if (!allowSendBack) back.disabled = true;
  block.append(accept, note, back);
  if (task.undoAvailable && onUndo) {
    block.append(element(document, "button", { type: "button", class: "btn", "data-action": "undo", text: t("undo"), onclick: () => onUndo?.(task) }));
  }
  return block;
}

export function renderWaiting(document, items, t, onOpen) {
  const block = element(document, "section", { class: "waiting-list", "data-waiting": String(items?.length ?? 0) });
  if (!items?.length) block.append(element(document, "p", { text: t("emptyList") }));
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
  return element(document, "article", { "data-task-detail": task.id },
    element(document, "h3", { text: task.title ?? "" }),
    element(document, "p", { text: task.request ?? "" }),
    element(document, "p", { text: task.report ?? "" }),
  );
}
