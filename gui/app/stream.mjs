import { ApiError, REQUEST_DEADLINE_MS, apiUrl, clearCredentials } from "./api.mjs";

export const FRAME_LIMIT = 16 * 1024 * 1024;
export const STREAM_HANDSHAKE_MS = REQUEST_DEADLINE_MS;
export const STREAM_INACTIVITY_MS = 45_000;
const DELAYS = [1000, 2000, 4000, 8000, 15000];
export const STREAM_RETRY_ATTEMPTS = DELAYS.length;
export const STREAM_RETRY_BUDGET_MS = DELAYS.reduce((sum, value) => sum + value, 0);

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
  if (envelope?.contract !== "hivem1nd-events-v3") return { error: "invalid_event", id: frame.id, name: frame.event }; // Compatibility: retain the event wire contract for existing clients.
  return { id: frame.id, name: frame.event || "message", envelope };
}

export async function subscribe(api, { onEvent, onLifecycle, lastEventId, signal, query, handshakeMs, inactivityMs } = {}) {
  if (!api.token) throw new ApiError(401, "sign_in_required", "Open the app again to continue.");
  const suffix = query ? `/events?${new URLSearchParams(Object.entries(query).filter(([, value]) => value != null))}` : "/events";
  const controller = new AbortController();
  api.controllers.add(controller);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort);
  const parser = createSseParser();
  const handshake = handshakeMs ?? api.deadlineMs ?? STREAM_HANDSHAKE_MS;
  const inactive = inactivityMs ?? api.inactivityMs ?? STREAM_INACTIVITY_MS;
  let timer = null;
  const arm = (delay, reason) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(reason), delay);
  };
  arm(handshake, "handshake");
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
    if (controller.signal.aborted) throw streamAbort(controller.signal);
    if (!response.ok) throw await responseError(response, api);
    onLifecycle?.("open");
    arm(inactive, "inactivity");
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await readStreamChunk(reader, controller.signal);
        arm(inactive, "inactivity");
        if (chunk.done) {
          for (const frame of parser.finish()) await onEvent?.(decodeEvent(frame));
          break;
        }
        for (const frame of parser.pushBytes(chunk.value)) {
          await onEvent?.(decodeEvent(frame));
        }
      }
    } finally {
      reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* The reader was already cancelled. */ }
    }
  } catch (error) {
    if (controller.signal.reason === "handshake" || controller.signal.reason === "inactivity") {
      throw new ApiError(0, "timeout", "The event stream timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    api.controllers.delete(controller);
  }
}

export function synchronize(api, store, options = {}) {
  close(api.live);
  const live = { stopped: false, failures: 0, since: null, verified: false, timer: null, state: "connecting", error: null, retryIn: null };
  api.live = live;
  const schedule = options.schedule ?? ((delay, run) => setTimeout(run, delay));
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());
  noteStream(live, store, options, { state: "connecting" });
  const connect = async () => {
    if (live.stopped || api.closed) return;
    const controller = new AbortController();
    live.controller = controller;
    try {
      await subscribe(api, {
        signal: controller.signal,
        query: options.query,
        lastEventId: options.cursor?.() ?? null,
        onEvent: async (event) => {
          if (event?.name === "stream.ready") {
            live.failures = 0;
            live.since = null;
            live.verified = true;
          }
          await options.onEvent?.(event);
        },
        handshakeMs: options.handshakeMs,
        inactivityMs: options.inactivityMs,
        onLifecycle: (phase) => noteStream(live, store, options, { state: phase }),
      });
      if (live.stopped || api.closed) return;
      if (live.verified) {
        live.verified = false;
        live.failures = 0;
        live.since = null;
        const delay = reconnectDelay(0, random);
        noteStream(live, store, options, { state: "reconnecting", retryIn: delay });
        queue(delay);
        return;
      }
      retryOrStop(null);
    } catch (error) {
      if (live.stopped || api.closed || error?.name === "AbortError") return;
      if (error.status === 401 || error.status === 410) {
        if (options.reauthenticate && await options.reauthenticate(error)) return;
        if (live.stopped || api.closed) return;
        clearCredentials(api);
        if (store) store.signedOut = error.status;
        noteStream(live, store, options, { state: "error", error: error.code ?? "signed_out" });
        return;
      }
      if (error.code === "frame_too_large") {
        if (store) store.failure = error.code;
        noteStream(live, store, options, { state: "error", error: error.code });
        return;
      }
      if (live.verified) {
        live.verified = false;
        live.failures = 0;
        live.since = null;
      }
      retryOrStop(error);
    }
  };
  const retryOrStop = (error) => {
    if (live.since == null) live.since = now();
    live.failures += 1;
    const elapsed = now() - live.since;
    if (live.failures >= STREAM_RETRY_ATTEMPTS || elapsed >= STREAM_RETRY_BUDGET_MS) {
      noteStream(live, store, options, { state: "error", error: "reconnect_exhausted" });
      return;
    }
    const delay = error?.status === 429 ? (error.retryAfter ?? 1000) : reconnectDelay(live.failures - 1, random);
    noteStream(live, store, options, { state: "reconnecting", error: error?.code ?? "request_failed", retryIn: delay });
    queue(delay);
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
  if (live.timer != null) clearTimeout(live.timer);
}

export function resetCredentials(api, store, session) {
  if (!session?.token || !session.viewerId || session.origin !== api.location.origin) throw new ApiError(0, 'invalid_response', 'The recovered viewer is not local.');
  close(api.live);
  api.token = session.token;
  api.homeKey = null;
  store.signedOut = null;
  store.cursor = null;
  store.liveCursor = null;
  store.buffer.length = 0;
  store.capabilities = session.capabilities ?? store.capabilities;
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

function noteStream(live, store, options, patch) {
  live.state = patch.state;
  live.error = patch.error ?? null;
  live.retryIn = patch.retryIn ?? null;
  const snapshot = { state: live.state, error: live.error, retryIn: live.retryIn };
  if (store) store.stream = snapshot;
  options.onState?.(snapshot);
}

function streamAbort(signal) {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  error.reason = signal?.reason;
  return error;
}

function readStreamChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(streamAbort(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reader.cancel().catch(() => {});
      reject(streamAbort(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then((chunk) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(streamAbort(signal));
      else resolve(chunk);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
