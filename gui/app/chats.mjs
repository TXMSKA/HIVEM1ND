import { createOperation, request, retryOperation } from "./api.mjs";

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

export function acknowledgeVisible(thread) {
  return [...thread.visibleIds].filter((id) => {
    const message = thread.messages.find((item) => item.id === id);
    return message && !message.read;
  }).slice(0, 200);
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

export async function openMailbox(api, unitId, state = "unread") {
  return request(api, "GET", `/mailboxes/${encodeURIComponent(unitId)}/messages`, { query: { state, limit: "50" } });
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
