import { ApiError, apiUrl, clearCredentials } from "./api.mjs";

export const FRAME_LIMIT = 16 * 1024 * 1024;
const DELAYS = [1000, 2000, 4000, 8000, 15000];

export function reconnectDelay(attempt, random = Math.random) {
  const base = DELAYS[Math.min(Math.max(attempt, 0), DELAYS.length - 1)];
  return Math.round(base * (0.8 + random() * 0.4));
}

export function createSseParser() {
  let line = "";
  let afterCR = false;
  let eventName = "";
  let data = [];
  let id = "";
  let sawId = false;
  let byteCount = 0;
  const frames = [];
  const decoder = new TextDecoder("utf-8");

  function fail() {
    line = "";
    data = [];
    byteCount = 0;
    throw new ApiError(0, "frame_too_large", "The event frame is too large.");
  }

  function acceptLine(text) {
    if (text === "") {
      if (data.length > 0) frames.push({ event: eventName || "message", data: data.join("\n"), id: sawId ? id : null });
      eventName = "";
      data = [];
      id = "";
      sawId = false;
      byteCount = 0;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") {
      byteCount += new TextEncoder().encode(value).length + (data.length ? 1 : 0);
      if (byteCount > FRAME_LIMIT) fail();
      data.push(value);
    } else if (field === "id" && !value.includes("\0")) {
      id = value;
      sawId = true;
    }
  }

  function pushCharacters(text) {
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (afterCR) {
        afterCR = false;
        if (character === "\n") {
          start = index + 1;
          continue;
        }
      }
      if (character === "\r" || character === "\n") {
        line += text.slice(start, index);
        if (line.length > FRAME_LIMIT) fail();
        acceptLine(line);
        line = "";
        start = index + 1;
        afterCR = character === "\r";
      }
    }
    line += text.slice(start);
    if (line.length > FRAME_LIMIT) fail();
  }

  return {
    pushText(text) {
      pushCharacters(String(text ?? ""));
      return frames.splice(0);
    },
    pushBytes(chunk) {
      return this.pushText(decoder.decode(chunk, { stream: true }));
    },
    finish() {
      const flushed = this.pushText(decoder.decode());
      line = "";
      data = [];
      eventName = "";
      id = "";
      sawId = false;
      byteCount = 0;
      return flushed;
    },
  };
}

export function decodeEvent(frame) {
  if (!frame) return { error: "invalid_event" };
  let envelope;
  try {
    envelope = JSON.parse(frame.data);
  } catch {
    return { error: "invalid_event", id: frame.id, name: frame.event };
  }
  if (envelope?.contract !== "hivem1nd-events-v3") return { error: "invalid_event", id: frame.id, name: frame.event };
  return { id: frame.id, name: frame.event || "message", envelope };
}

export async function subscribe(api, { onEvent, lastEventId, signal, query } = {}) {
  if (!api.token) throw new ApiError(401, "sign_in_required", "Open the app again to continue.");
  const suffix = query ? `/events?${new URLSearchParams(Object.entries(query).filter(([, value]) => value != null))}` : "/events";
  const controller = new AbortController();
  api.controllers.add(controller);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const parser = createSseParser();
  try {
    const response = await api.fetch(apiUrl(api.location.origin, suffix), {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${api.token}`,
        ...(typeof document === "undefined" ? { Origin: api.location.origin } : {}),
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response, api);
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          for (const frame of parser.finish()) await onEvent?.(decodeEvent(frame));
          break;
        }
        for (const frame of parser.pushBytes(chunk.value)) {
          await onEvent?.(decodeEvent(frame));
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    api.controllers.delete(controller);
  }
}

export function synchronize(api, store, options = {}) {
  close(api.live);
  const live = { stopped: false, attempt: 0, timer: null };
  api.live = live;
  const schedule = options.schedule ?? ((delay, run) => setTimeout(run, delay));
  const random = options.random ?? Math.random;
  const connect = async () => {
    if (live.stopped || api.closed) return;
    const controller = new AbortController();
    live.controller = controller;
    try {
      await subscribe(api, {
        signal: controller.signal,
        query: options.query,
        lastEventId: options.cursor?.() ?? null,
        onEvent: options.onEvent,
      });
      if (live.stopped || api.closed) return;
      live.attempt = 0;
      queue(reconnectDelay(0, random));
    } catch (error) {
      if (live.stopped || api.closed || error?.name === "AbortError") return;
      if (error.status === 401 || error.status === 410) {
        clearCredentials(api);
        if (store) store.signedOut = error.status;
        return;
      }
      if (error.code === "frame_too_large") {
        if (store) store.failure = error.code;
        return;
      }
      const delay = error.status === 429 ? (error.retryAfter ?? 1000) : reconnectDelay(live.attempt, random);
      if (error.status !== 429) live.attempt = Math.min(live.attempt + 1, DELAYS.length - 1);
      queue(delay);
    }
  };
  const queue = (delay) => {
    if (live.stopped || api.closed) return;
    live.timer = schedule(delay, () => {
      live.timer = null;
      connect();
    });
  };
  connect();
  return live;
}

export function close(live) {
  if (!live || live.stopped) return;
  live.stopped = true;
  live.controller?.abort();
  if (typeof live.timer === "number") clearTimeout(live.timer);
}

async function responseError(response, api) {
  const retryAfter = retryHeader(response, api.now);
  let code = "request_failed";
  let message = "The event stream failed.";
  let details = {};
  let retryAt = null;
  try {
    const json = await response.json();
    code = json?.error?.code ?? code;
    message = json?.error?.message ?? message;
    details = json?.error?.details ?? {};
    retryAt = json?.error?.retryAt ?? null;
  } catch {
    // The status still tells the client whether to stop.
  }
  return new ApiError(response.status, code, message, details, retryAt, retryAfter);
}

function retryHeader(response, now) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, when - now()) : null;
}
