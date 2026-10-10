export class ApiError extends Error {
  constructor(status, code, message, details = {}, retryAt = null, retryAfter = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAt = retryAt;
    this.retryAfter = retryAfter;
  }
}

export function operationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createApi({ location, history, fetch: fetchImpl, clock, createObjectURL, revokeObjectURL } = {}) {
  if (!location?.origin) throw new ApiError(0, "invalid_url", "The application origin is missing.");
  const credentials = readFragment(location, history);
  const api = {
    location,
    fetch: (fetchImpl ?? globalThis.fetch).bind(globalThis),
    now: clock ?? (() => Date.now()),
    createObjectURL: createObjectURL ?? globalThis.URL?.createObjectURL?.bind(globalThis.URL),
    revokeObjectURL: revokeObjectURL ?? globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
    token: credentials.token,
    homeKey: credentials.homeKey,
    uncertain: new Map(),
    controllers: new Set(),
    blobs: new Set(),
    live: null,
    closed: false,
  };
  return api;
}

export function createOperation({ method, path, params, body } = {}) {
  if (typeof method !== "string" || typeof path !== "string") {
    throw new ApiError(0, "invalid_operation", "The operation is not complete.");
  }
  const payload = body === undefined ? undefined : deepFreeze(structuredClone(body));
  return Object.freeze({
    id: operationId(),
    method,
    path: encodeRoute(path, params),
    body: payload,
  });
}

export async function request(api, method, path, options = {}) {
  if (api.closed) throw new ApiError(0, "closed", "The session is closed.");
  const operation = options.operation ?? null;
  const actualMethod = operation?.method ?? method;
  const suffix = encodeRoute(operation?.path ?? path, operation ? {} : options.params);
  const url = apiUrl(api.location.origin, withQuery(suffix, options.query));
  const authExchange = isAuthExchange(suffix);
  if (!authExchange && !api.token) throw new ApiError(401, "sign_in_required", "Open the app again to continue.");
  const payload = operation ? operation.body : options.body;
  const encodedBody = payload === undefined ? undefined : JSON.stringify(payload);
  const headers = {
    Accept: options.accept ?? "application/json",
    "Cache-Control": "no-store",
    ...(options.headers ?? {}),
  };
  if (typeof document === "undefined") headers.Origin = api.location.origin;
  if (!authExchange && api.token) headers.Authorization = `Bearer ${api.token}`;
  if (encodedBody !== undefined) headers["Content-Type"] = "application/json";
  if (operation && !authExchange && actualMethod !== "GET" && actualMethod !== "HEAD") {
    headers["Idempotency-Key"] = operation.id;
  }
  const controller = new AbortController();
  api.controllers.add(controller);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);
  let response;
  try {
    response = await api.fetch(url, {
      method: actualMethod,
      headers,
      body: encodedBody,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name !== "AbortError" && operation && !authExchange) api.uncertain.set(operation.id, { at: api.now(), method: actualMethod, path: suffix });
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    api.controllers.delete(controller);
  }
  if (operation) api.uncertain.delete(operation.id);
  if (response.status === 401 || response.status === 410) clearCredentials(api);
  if (response.status === 204) return { status: 204, data: null, meta: null };
  const retryAfter = retryAfterMs(response, api.now);
  let json = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "invalid_response", "The response was not JSON.", {}, null, retryAfter);
    }
  }
  if (response.ok) {
    if (json?.contract !== "hivem1nd-gui-v3" || !json.meta?.requestId || !json.meta.readAt || json.meta.eventCursor == null || !json.meta.sync) {
      throw new ApiError(response.status, "invalid_response", "The response envelope is not valid.", {}, null, retryAfter);
    }
    return { status: response.status, data: json.data, meta: json.meta };
  }
  const error = json?.error ?? {};
  throw new ApiError(
    response.status,
    error.code ?? "request_failed",
    redact(error.message ?? "The request failed.", api),
    error.details ?? {},
    error.retryAt ?? null,
    retryAfter,
  );
}

export function retryOperation(api, operation) {
  return request(api, operation.method, operation.path, { operation });
}

export async function fetchAsset(api, asset) {
  if (!api.token) throw new ApiError(401, "sign_in_required", "Open the app again to continue.");
  const url = resolveAssetUrl(api.location.origin, asset?.url);
  const response = await api.fetch(url, {
    headers: {
      Authorization: `Bearer ${api.token}`,
      Accept: asset?.contentType ?? "image/*",
      ...(typeof document === "undefined" ? { Origin: api.location.origin } : {}),
    },
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new ApiError(response.status, "asset_not_found", "The asset could not be read.");
  const mime = String(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) throw new ApiError(response.status, "invalid_asset", "The asset is not an image.");
  const blob = await response.blob();
  if (!api.createObjectURL) throw new ApiError(0, "invalid_asset", "This view cannot hold image bytes.");
  const objectUrl = api.createObjectURL(blob);
  api.blobs.add(objectUrl);
  return {
    url: objectUrl,
    contentType: mime,
    revoke() {
      api.blobs.delete(objectUrl);
      api.revokeObjectURL?.(objectUrl);
    },
  };
}

export function dispose(api) {
  api.closed = true;
  clearCredentials(api);
  if (api.live) api.live.stopped = true;
  if (typeof api.live?.timer === "number") clearTimeout(api.live.timer);
  for (const controller of [...api.controllers]) controller.abort();
  api.controllers.clear();
  for (const url of api.blobs) api.revokeObjectURL?.(url);
  api.blobs.clear();
}

export function clearCredentials(api) {
  api.token = null;
  api.homeKey = null;
}

export function apiUrl(origin, suffix) {
  assertSuffix(suffix);
  return `${origin}/api/v1${suffix}`;
}

export function encodeRoute(path, params = {}) {
  if (typeof path !== "string") throw new ApiError(0, "invalid_url", "The route is not valid.");
  assertSuffix(path);
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt);
  const encoded = pathname.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, name) => {
    if (!Object.hasOwn(params, name)) throw new ApiError(0, "invalid_path", "A path id is missing.");
    const value = String(params[name]);
    if (value.includes("/") || value.includes("\\") || value.includes("\0")) throw new ApiError(0, "invalid_path", "The path id is not valid.");
    return encodeURIComponent(value);
  });
  for (const segment of encoded.split("/")) {
    if (!segment) continue;
    if (segment.includes(":") || segment.includes("\\") || segment.includes(" ") || /%(?:2f|5c|25)/i.test(segment)) {
      throw new ApiError(0, "invalid_path", "Encode each path id once.");
    }
  }
  return encoded + query;
}

function readFragment(location, history) {
  const params = new URLSearchParams(String(location.hash ?? "").replace(/^#/, ""));
  const token = params.get("session");
  const homeKey = params.get("home");
  if (token !== null || homeKey !== null) {
    params.delete("session");
    params.delete("home");
    const rest = params.toString();
    const next = `${location.pathname ?? "/"}${location.search ?? ""}${rest ? `#${rest}` : ""}`;
    if (!history?.replaceState) throw new ApiError(0, "invalid_url", "The view cannot clear its fragment.");
    history.replaceState(history.state ?? null, "", next);
  }
  return { token, homeKey };
}

function assertSuffix(path) {
  if (typeof path !== "string" || path.length === 0) throw new ApiError(0, "invalid_url", "The route is not valid.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) throw new ApiError(0, "invalid_url", "Absolute URLs are not accepted.");
  if (!path.startsWith("/")) throw new ApiError(0, "invalid_url", "The route must stay under the API.");
  if (path === "/api/v1" || path.startsWith("/api/v1/") || path.startsWith("/api/v1?")) throw new ApiError(0, "invalid_url", "The API prefix is already present.");
  const pathname = path.split("?")[0];
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) throw new ApiError(0, "invalid_url", "The browser does not call that route.");
}

function withQuery(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}${path.includes("?") ? "&" : "?"}${text}` : path;
}

function isAuthExchange(path) {
  const pathname = path.split("?")[0];
  return pathname === "/auth/local" || pathname === "/auth/home";
}

function retryAfterMs(response, now) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, when - now()) : null;
}

function redact(message, api) {
  let text = String(message);
  for (const secret of [api.token, api.homeKey]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function resolveAssetUrl(origin, assetUrl) {
  if (typeof assetUrl !== "string" || assetUrl.length === 0) throw new ApiError(0, "invalid_url", "The asset URL is missing.");
  let url;
  try {
    url = new URL(assetUrl, `${origin}/`);
  } catch {
    throw new ApiError(0, "invalid_url", "The asset URL is not valid.");
  }
  if (url.origin !== origin || url.username || url.password) throw new ApiError(0, "invalid_url", "The asset URL is not local.");
  return url.href;
}
