import { createOperation, perform, request, retryOperation } from "./api.mjs";
import { collectPages } from "./lists.mjs";

export function createThread(chat = null) {
  return {
    chat,
    messages: [],
    nextCursor: null,
    anchorId: null,
    anchorOffset: 0,
    composer: "",
    pendingSends: new Map(),
    error: null,
    nearBottom: true,
    unseen: 0,
    visibleIds: new Set(),
    notifications: [],
  };
}

export async function openDirectChat(api, memberIds, retained = null) {
  return openConversation(api, memberIds, undefined, retained);
}

export async function findDirectChat(api, unitId) {
  const [listed, hidden] = await Promise.all([
    collectPages(api, "/chats", { query: { unitId, listed: "true" }, limit: 50 }),
    collectPages(api, "/chats", { query: { unitId, listed: "false" }, limit: 50 }),
  ]);
  return [...listed.items, ...hidden.items].find((item) => item.members?.length === 2 && item.members.includes(unitId) && item.members.includes("root:master")) ?? null;
}

export async function openGroupChat(api, memberIds, title, retained = null) {
  return openConversation(api, memberIds, title, retained);
}

export async function loadMessages(api, thread, older = false) {
  const query = { limit: "50" };
  if (older) {
    if (!thread.nextCursor) return thread;
    query.cursor = thread.nextCursor;
  }
  const result = await request(api, "GET", `/chats/${encodeURIComponent(thread.chat.id)}/messages`, { query });
  const incoming = result.data.items ?? [];
  const seen = new Set(thread.messages.map((message) => message.id));
  const fresh = incoming.filter((message) => !seen.has(message.id));
  if (older) {
    thread.anchorId = thread.messages[0]?.id ?? null;
    thread.messages = [...fresh, ...thread.messages];
  } else {
    for (const message of incoming) incomingMessage(thread, message, true);
  }
  thread.nextCursor = result.data.nextCursor ?? null;
  thread.total = result.data.total ?? thread.messages.length;
  return thread;
}

export function incomingMessage(thread, message, authoritative = false) {
  if (!message?.id) return thread;
  const entry = thread.pendingSends.get(message.operationId);
  if (entry) {
    entry.result = { data: { message, notifications: [] } };
    thread.pendingSends.delete(entry.operation.id);
    thread.messages = thread.messages.filter((item) => item.operationId !== entry.operation.id || item.id === message.id);
    thread.error = [...thread.pendingSends.values()].find((item) => item.error)?.error ?? null;
  }
  const current = thread.messages.find((item) => item.id === message.id);
  if (current) {
    const rank = { stored: 0, delivered: 1, read: 2 };
    const delivery = !authoritative && (rank[current.delivery?.state] ?? 0) > (rank[message.delivery?.state] ?? 0) ? current.delivery : message.delivery;
    Object.assign(current, message, { pending: false, failed: false, read: Boolean(current.read || message.read), ...(delivery ? { delivery } : {}) });
    return thread;
  }
  thread.messages = mergeChronological(thread.messages, [message]);
  if (thread.nearBottom) thread.unseen = 0;
  else thread.unseen += 1;
  return thread;
}

export const NEAR_BOTTOM_PX = 24;
export const MESSAGE_WINDOW = 40;

export function acknowledgeVisible(thread) {
  return [...thread.visibleIds].filter((id) => {
    const message = thread.messages.find((item) => item.id === id);
    return message && !message.read;
  }).slice(0, 200);
}

export function updateNearBottom(thread, host) {
  if (!host || !(host.scrollHeight > 0)) return thread.nearBottom;
  const distance = host.scrollHeight - host.scrollTop - host.clientHeight;
  thread.nearBottom = distance <= NEAR_BOTTOM_PX;
  return thread.nearBottom;
}

export function measureVisible(thread, host) {
  const visible = new Set();
  if (host?.querySelectorAll) {
    const top = host.scrollTop ?? 0;
    const bottom = top + (host.clientHeight ?? 0);
    for (const node of host.querySelectorAll("[data-message]")) {
      const id = node.getAttribute("data-message");
      const height = node.offsetHeight ?? 0;
      if (!id || height <= 0) continue;
      const start = node.offsetTop ?? 0;
      if (start + height > top && start < bottom) visible.add(id);
    }
  }
  thread.visibleIds = visible;
  return visible;
}

export function messageWindow(messages, { nearBottom = true, anchorId = null, start = 0, size = MESSAGE_WINDOW } = {}) {
  const list = messages ?? [];
  if (list.length <= size) return { items: list, start: 0 };
  if (anchorId && nearBottom === false) {
    const index = list.findIndex((message) => message.id === anchorId);
    const indexStart = index < 0 ? Math.max(0, Math.min(start, list.length - size)) : Math.max(0, Math.min(index, list.length - size));
    return { items: list.slice(indexStart, indexStart + size), start: indexStart };
  }
  if (nearBottom) {
    const indexStart = list.length - size;
    return { items: list.slice(indexStart), start: indexStart };
  }
  const indexStart = Math.max(0, Math.min(start, list.length - size));
  return { items: list.slice(indexStart, indexStart + size), start: indexStart };
}

export function applyMessageRead(thread, data, readerId = "root:master") {
  if (!thread?.chat || !data || data.chatId !== thread.chat.id) return false;
  for (const receipt of data.deliveries ?? []) {
    const message = thread.messages.find((item) => item.id === receipt.messageId);
    if (message) message.delivery = receipt.delivery;
  }
  if (data.readerId && data.readerId !== readerId) return Boolean(data.deliveries?.length);
  const ids = new Set(data.messageIds ?? []);
  for (const message of thread.messages) {
    if (ids.has(message.id)) message.read = true;
  }
  if (Number.isInteger(data.unread)) thread.unread = data.unread;
  return true;
}

export async function postVisibleReads(api, thread) {
  const ids = acknowledgeVisible(thread).filter((id) => !thread.pendingReads?.has(id));
  if (!ids.length || !thread.chat?.id) return null;
  thread.pendingReads ??= new Set();
  for (const id of ids) thread.pendingReads.add(id);
  const operation = createOperation({
    method: "POST",
    path: "/chats/:chatId/read",
    params: { chatId: thread.chat.id },
    body: { messageIds: ids },
  });
  try {
    const result = await request(api, "POST", operation.path, { operation });
    const readIds = result.data?.readIds?.length ? result.data.readIds : ids;
    applyMessageRead(thread, {
      chatId: thread.chat.id,
      readerId: "root:master",
      messageIds: readIds,
      unread: result.data?.unread,
      deliveries: result.data?.deliveries,
    });
    return result;
  } catch (error) {
    for (const id of ids) thread.pendingReads.delete(id);
    throw error;
  }
}

export function postMessage(api, thread, draft) {
  const operation = createOperation({
    method: "POST",
    path: "/chats/:chatId/messages",
    params: { chatId: thread.chat.id },
    body: {
      body: draft.body ?? "",
      subject: draft.subject ?? "",
      replyTo: draft.replyTo ?? null,
      attachments: draft.attachments ?? [],
      priority: draft.priority ?? "normal",
    },
  });
  thread.composer = "";
  const entry = { operation, promise: null, error: null, result: null };
  thread.pendingSends.set(operation.id, entry);
  return sendPending(api, thread, entry);
}

export function retryMessage(api, thread, operationId = null) {
  const entry = operationId ? thread.pendingSends.get(operationId) : [...thread.pendingSends.values()].find((item) => item.error);
  if (!entry) return null;
  if (entry.promise) return entry.promise;
  return sendPending(api, thread, entry, true);
}

function sendPending(api, thread, entry, retry = false) {
  const { operation } = entry;
  entry.error = null;
  markOptimistic(thread, operation, api.now());
  const task = (retry ? retryOperation(api, operation) : request(api, "POST", operation.path, { operation })).then((result) => {
    const message = { ...result.data.message, operationId: operation.id, pending: false, failed: false };
    entry.result = result;
    thread.messages = thread.messages.filter((item) => item.operationId !== operation.id || item.id === message.id);
    thread.pendingSends.delete(operation.id);
    thread.notifications = result.data.notifications ?? [];
    incomingMessage(thread, message);
    thread.error = [...thread.pendingSends.values()].find((item) => item.error)?.error ?? null;
    return result;
  }).catch((error) => {
    if (entry.result) {
      api.uncertain.delete(operation.id);
      return entry.result;
    }
    entry.error = error;
    thread.error = error;
    const row = thread.messages.find((item) => item.operationId === operation.id);
    if (row) row.failed = true;
    throw error;
  }).finally(() => {
    entry.promise = null;
  });
  entry.promise = task;
  return task;
}

function markOptimistic(thread, operation, now) {
  const body = operation.body?.body ?? "";
  let row = thread.messages.find((message) => message.operationId === operation.id);
  if (!row) {
    row = { id: `pending:${operation.id}`, body, fromId: "root:master", timestamp: new Date(now).toISOString(), pending: true, failed: false, operationId: operation.id };
    thread.messages = [...thread.messages, row];
  }
  row.body = body;
  row.pending = true;
  row.failed = false;
}

export async function manageChat(api, chat, change, retained = null) {
  return perform(api, {
    method: "PATCH",
    path: "/chats/:chatId",
    params: { chatId: chat.id },
    body: { ...change, expectedRevision: chat.revision },
  }, retained);
}

export async function openMailbox(api, unitId, state = "unread", cursor = null) {
  const query = { state, limit: "50" };
  if (cursor) query.cursor = cursor;
  return request(api, "GET", `/mailboxes/${encodeURIComponent(unitId)}/messages`, { query });
}

export async function loadMailboxes(api) {
  return request(api, "GET", "/mailboxes", { query: { limit: "50" } });
}

export async function loadMailboxMessage(api, unitId, messageId) {
  return request(api, "GET", `/mailboxes/${encodeURIComponent(unitId)}/messages/${encodeURIComponent(messageId)}`);
}

export function postMailbox(api, unitId, draft, retained = null) {
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/messages",
    params: { unitId },
    body: {
      body: draft.body ?? "",
      subject: draft.subject ?? "",
      replyTo: draft.replyTo ?? null,
      attachments: draft.attachments ?? [],
      priority: draft.priority ?? "normal",
    },
  });
  const task = request(api, "POST", operation.path, { operation }).catch((error) => {
    if (error && typeof error === "object") error.operation = operation;
    throw error;
  });
  task.operation = operation;
  return task;
}

export function canMarkMailbox(audience, capabilities, unitId) {
  if (audience === "phone") return unitId === "root:master";
  const names = capabilities ?? [];
  return names.includes("mailbox.read") || names.includes("master.read");
}

export async function markMailboxRead(api, unitId, messageIds, retained = null) {
  return perform(api, {
    method: "POST",
    path: "/mailboxes/:unitId/read",
    params: { unitId },
    body: { messageIds },
  }, retained);
}

async function openConversation(api, memberIds, title, retained = null) {
  const body = { members: memberIds };
  if (title) body.title = title;
  return perform(api, { method: "POST", path: "/chats", body }, retained);
}

function mergeChronological(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) if (!byId.has(message.id)) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => Number(Boolean(left.pending)) - Number(Boolean(right.pending)) || String(left.timestamp ?? left.date ?? "").localeCompare(String(right.timestamp ?? right.date ?? "")) || left.id.localeCompare(right.id, "en"));
}
