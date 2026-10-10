import { createOperation, request, retryOperation } from "./api.mjs";
import { collectPages } from "./lists.mjs";

export function createThread(chat = null) {
  return {
    chat,
    messages: [],
    nextCursor: null,
    anchorId: null,
    anchorOffset: 0,
    composer: "",
    pending: null,
    operation: null,
    error: null,
    nearBottom: true,
    unseen: 0,
    visibleIds: new Set(),
    notifications: [],
  };
}

export async function openDirectChat(api, memberIds) {
  return openConversation(api, memberIds);
}

export async function findDirectChat(api, unitId) {
  const [listed, hidden] = await Promise.all([
    collectPages(api, "/chats", { query: { unitId, listed: "true" }, limit: 50 }),
    collectPages(api, "/chats", { query: { unitId, listed: "false" }, limit: 50 }),
  ]);
  return [...listed.items, ...hidden.items].find((item) => item.members?.length === 2 && item.members.includes(unitId) && item.members.includes("root:master")) ?? null;
}

export async function openGroupChat(api, memberIds, title) {
  return openConversation(api, memberIds, title);
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
  } else thread.messages = mergeChronological(thread.messages, fresh);
  thread.nextCursor = result.data.nextCursor ?? null;
  thread.total = result.data.total ?? thread.messages.length;
  return thread;
}

export function incomingMessage(thread, message) {
  if (!message?.id || thread.messages.some((item) => item.id === message.id)) return thread;
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
  if (data.readerId && data.readerId !== readerId) return false;
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
    });
    return result;
  } catch (error) {
    for (const id of ids) thread.pendingReads.delete(id);
    throw error;
  }
}

export function postMessage(api, thread, draft) {
  if (thread.pending) return thread.pending;
  thread.composer = draft.body ?? "";
  const operation = thread.operation ?? createOperation({
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
  thread.operation = operation;
  const task = request(api, "POST", operation.path, { operation }).then((result) => {
    thread.composer = "";
    thread.operation = null;
    thread.pending = null;
    thread.error = null;
    thread.notifications = result.data.notifications ?? [];
    incomingMessage(thread, result.data.message);
    return result;
  }).catch((error) => {
    thread.pending = null;
    thread.error = error;
    throw error;
  });
  thread.pending = task;
  return task;
}

export async function retryMessage(api, thread) {
  if (!thread.operation) return null;
  thread.pending = retryOperation(api, thread.operation).then((result) => {
    thread.composer = "";
    thread.operation = null;
    thread.pending = null;
    thread.error = null;
    incomingMessage(thread, result.data.message);
    return result;
  }).catch((error) => {
    thread.pending = null;
    thread.error = error;
    throw error;
  });
  return thread.pending;
}

export async function manageChat(api, chat, change) {
  const operation = createOperation({
    method: "PATCH",
    path: "/chats/:chatId",
    params: { chatId: chat.id },
    body: { ...change, expectedRevision: chat.revision },
  });
  return request(api, "PATCH", operation.path, { operation });
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

export async function postMailbox(api, unitId, draft) {
  const operation = createOperation({
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
  return request(api, "POST", operation.path, { operation });
}

export function canMarkMailbox(audience, capabilities, unitId) {
  if (audience === "phone") return unitId === "root:master";
  const names = capabilities ?? [];
  return names.includes("mailbox.read") || names.includes("master.read");
}

export async function markMailboxRead(api, unitId, messageIds) {
  const operation = createOperation({
    method: "POST",
    path: "/mailboxes/:unitId/read",
    params: { unitId },
    body: { messageIds },
  });
  return request(api, "POST", operation.path, { operation });
}

async function openConversation(api, memberIds, title) {
  const body = { members: memberIds };
  if (title) body.title = title;
  const operation = createOperation({ method: "POST", path: "/chats", body });
  return request(api, "POST", "/chats", { operation });
}

function mergeChronological(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) if (!byId.has(message.id)) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => String(left.timestamp ?? left.date ?? "").localeCompare(String(right.timestamp ?? right.date ?? "")) || left.id.localeCompare(right.id, "en"));
}
