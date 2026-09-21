import crypto from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { text as engineText } from "../engine/texts.mjs";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REQUESTS_PER_MINUTE = 240;
const UI_KEYS = [
  "back", "continue", "install", "installing", "loading", "language", "searchLanguages",
  "browse", "add", "attachAuto", "attachOnDemand", "noFiles", "filesCountOne", "filesCountOther",
  "firstCommand", "actionCreate", "actionUpdate", "actionUnchanged", "actionAppend", "actionConflict",
  "documentTitle", "environmentPlaceholder", "reportSaved",
  "step1Title", "step2Title", "step3Title", "step4Title", "step5Title", "step6Title", "step7Title", "step8Title",
  "sessionMissing", "requestFailed",
];

function buildUi(language) {
  return Object.fromEntries(UI_KEYS.map((key) => [key, engineText(language, key)]));
}

function withUi(step) {
  return typeof step?.language === "string" ? { ...step, ui: buildUi(step.language) } : step;
}
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

const STATIC_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function errorEnvelope(error, requestId, language) {
  return {
    error: {
      code: error.code ?? "internal_error",
      message: error.status ? error.message : engineText(language, "serverError"),
      requestId,
    },
  };
}

function send(response, status, body, headers = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, {
    ...STATIC_HEADERS,
    "Content-Length": content.byteLength,
    ...headers,
  });
  response.end(content);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8" });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateBoundedValue(value, depth = 0) {
  if (depth > 4) throw new HttpError(400, "invalid_body", "The request is nested too deeply.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > 8192) throw new HttpError(400, "invalid_body", "A text value is too long.");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new HttpError(400, "invalid_body", "An array has too many items.");
    for (const item of value) validateBoundedValue(item, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 128) throw new HttpError(400, "invalid_body", "An object has too many fields.");
    for (const [key, item] of entries) {
      if (key.length > 512) throw new HttpError(400, "invalid_body", "A field name is too long.");
      validateBoundedValue(item, depth + 1);
    }
    return;
  }
  throw new HttpError(400, "invalid_body", "The request contains an unsupported value.");
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const announced = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(announced) || announced > MAX_BODY_BYTES) {
    throw new HttpError(413, "body_too_large", "The request body is too large.");
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError(413, "body_too_large", "The request body is too large.");

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "The request body must be valid JSON.");
  }
  if (!isPlainObject(body)) throw new HttpError(400, "invalid_body", "The request body must be an object.");
  validateBoundedValue(body);
  return body;
}

function requireExactKeys(object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new HttpError(400, "unknown_field", `Unknown field: ${key}`);
  }
}

function safeTokenEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function defaultSessionFactory(options) {
  const { createSetupSession } = await import("../engine/setup.mjs");
  return createSetupSession(options);
}

export async function createWizardServer({
  host = HOST,
  port = 0,
  session,
  createSession = defaultSessionFactory,
  sessionOptions = {},
  token = crypto.randomBytes(32).toString("base64url"),
} = {}) {
  if (host !== HOST) throw new Error("The wizard server can only bind to 127.0.0.1.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid wizard server port.");
  if (typeof token !== "string" || token.length < 32) throw new Error("The wizard session token is too short.");

  const activeSession = session ?? await createSession(sessionOptions);
  const assetRoot = fileURLToPath(new URL("./", import.meta.url));
  const assets = new Map();
  for (const [route, [name, contentType]] of STATIC_FILES) {
    if (assets.has(name)) continue;
    assets.set(name, { body: await readFile(new URL(name, import.meta.url)), contentType });
  }

  let expectedHost;
  let expectedOrigin;
  let requestWindow = { startedAt: Date.now(), count: 0 };
  let operation = Promise.resolve();
  const enqueue = (task) => {
    const next = operation.catch(() => undefined).then(task);
    operation = next.catch(() => undefined);
    return next;
  };

  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15_000 }, async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const remote = request.socket.remoteAddress;
      if (![HOST, `::ffff:${HOST}`].includes(remote)) throw new HttpError(403, "loopback_only", "Loopback access is required.");
      if (request.headers.host !== expectedHost) throw new HttpError(400, "invalid_host", "The Host header is invalid.");
      if ((request.url?.length ?? 0) > 2048) throw new HttpError(414, "uri_too_long", "The request URL is too long.");

      const now = Date.now();
      if (now - requestWindow.startedAt >= 60_000) requestWindow = { startedAt: now, count: 0 };
      requestWindow.count += 1;
      if (requestWindow.count > MAX_REQUESTS_PER_MINUTE) {
        response.setHeader("Retry-After", "60");
        throw new HttpError(429, "rate_limited", "Too many local wizard requests.");
      }

      const url = new URL(request.url ?? "/", expectedOrigin);
      if (url.search) throw new HttpError(400, "unexpected_query", "Query parameters are not accepted.");
      if (STATIC_FILES.has(url.pathname)) {
        if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Method not allowed.");
        const [name] = STATIC_FILES.get(url.pathname);
        const asset = assets.get(name);
        send(response, 200, request.method === "HEAD" ? Buffer.alloc(0) : asset.body, { "Content-Type": asset.contentType });
        return;
      }

      if (!url.pathname.startsWith("/api/v1/")) throw new HttpError(404, "not_found", "Route not found.");
      const suppliedOrigin = request.headers.origin;
      if (suppliedOrigin !== undefined && suppliedOrigin !== expectedOrigin) {
        throw new HttpError(403, "invalid_origin", "The request origin is invalid.");
      }
      if (!["GET", "HEAD"].includes(request.method) && suppliedOrigin !== expectedOrigin) {
        throw new HttpError(403, "invalid_origin", "The request origin is required.");
      }
      const authorization = String(request.headers.authorization ?? "");
      if (!authorization.startsWith("Bearer ") || !safeTokenEqual(authorization.slice(7), token)) {
        throw new HttpError(401, "invalid_session", "The wizard session is invalid.");
      }

      if (url.pathname === "/api/v1/step" && request.method === "GET") {
        sendJson(response, 200, { data: withUi(await activeSession.getStep()) });
        return;
      }
      if (url.pathname === "/api/v1/preview" && request.method === "GET") {
        sendJson(response, 200, { data: await activeSession.preview() });
        return;
      }
      if (url.pathname === "/api/v1/answer" && request.method === "POST") {
        const body = await readJson(request);
        requireExactKeys(body, new Set(["values"]));
        if (!isPlainObject(body.values)) throw new HttpError(400, "invalid_values", "values must be an object.");
        const result = await enqueue(async () => {
          const step = await activeSession.getStep();
          const allowedFields = new Set((step.fields ?? []).map((field) => field.id));
          requireExactKeys(body.values, allowedFields);
          return activeSession.answer(body.values);
        });
        sendJson(response, 200, { data: withUi(result ?? await activeSession.getStep()) });
        return;
      }
      if (url.pathname === "/api/v1/back" && request.method === "POST") {
        const body = await readJson(request);
        requireExactKeys(body, new Set());
        const result = await enqueue(() => activeSession.back());
        sendJson(response, 200, { data: withUi(result ?? await activeSession.getStep()) });
        return;
      }
      if (url.pathname === "/api/v1/language" && request.method === "POST") {
        const body = await readJson(request);
        requireExactKeys(body, new Set(["language"]));
        if (!["en", "es"].includes(body.language)) throw new HttpError(400, "invalid_language", "language must be en or es.");
        const result = await enqueue(() => activeSession.setLanguage(body.language));
        sendJson(response, 200, { data: withUi(result ?? await activeSession.getStep()) });
        return;
      }
      if (url.pathname === "/api/v1/install" && request.method === "POST") {
        const body = await readJson(request);
        requireExactKeys(body, new Set(["confirm", "conflicts"]));
        if (body.confirm !== true) throw new HttpError(400, "confirmation_required", "Installation must be confirmed.");
        if (!isPlainObject(body.conflicts ?? {})) throw new HttpError(400, "invalid_conflicts", "conflicts must be an object.");
        const result = await enqueue(async () => {
          const step = await activeSession.getStep();
          if (step.number !== 7) throw new HttpError(409, "invalid_step", "Installation is only available from the preview step.");
          const preview = await activeSession.preview();
          const allowedConflicts = new Map((preview.conflicts ?? []).map((conflict) => [conflict.path, new Set(conflict.choices ?? ["keep", "replace"])]));
          requireExactKeys(body.conflicts ?? {}, new Set(allowedConflicts.keys()));
          for (const [conflictPath, choices] of allowedConflicts) {
            const selection = body.conflicts?.[conflictPath];
            if (!choices.has(selection)) throw new HttpError(400, "conflict_unresolved", `Choose how to handle ${conflictPath}.`);
          }
          await activeSession.answer({ confirm: true, conflicts: body.conflicts ?? {} });
          return activeSession.install();
        });
        sendJson(response, 200, { data: result });
        return;
      }
      throw new HttpError(404, "not_found", "Route not found.");
    } catch (error) {
      const exposed = error?.name === "SetupValidationError"
        ? new HttpError(422, "invalid_answer", error.message)
        : error;
      const status = exposed.status ?? 500;
      const language = await activeSession.getStep().then((step) => step.language, () => "en");
      sendJson(response, status, errorEnvelope(exposed, requestId, language));
    }
  });

  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    const body = JSON.stringify({ error: { code: "bad_request", message: engineText("en", "serverError") } });
    socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  expectedHost = `${HOST}:${address.port}`;
  expectedOrigin = `http://${expectedHost}`;

  return {
    host,
    port: address.port,
    origin: expectedOrigin,
    token,
    url: `${expectedOrigin}/#session=${encodeURIComponent(token)}`,
    assetRoot,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    }),
  };
}
