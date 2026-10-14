import { ApiError, createOperation, request } from "./api.mjs";
import { element, progressMark } from "./components.mjs";

export const PHONE_NAV = ["hierarchy", "chats", "waiting"];

export function canPerform(capabilities, action) {
  return Array.isArray(capabilities) && capabilities.includes(action);
}

export async function exchangeHomeFragment(api) {
  const key = api.homeKey;
  api.homeKey = null;
  if (!key) return null;
  try {
    const result = await request(api, "POST", "/auth/home", { body: { key } });
    api.token = result.data.token;
    api.homeReadAt = Date.parse(result.meta.readAt);
    api.homeKey = null;
    return result.data;
  } catch (error) {
    api.token = null;
    api.homeKey = null;
    throw pairingError(error);
  }
}

export async function exchangeCode(api, code) {
  const normalized = normalizeCode(code);
  api.homeKey = null;
  try {
    const result = await request(api, "POST", "/auth/home", { body: { code: normalized } });
    api.token = result.data.token;
    api.homeReadAt = Date.parse(result.meta.readAt);
    api.homeKey = null;
    return result.data;
  } catch (error) {
    api.token = null;
    api.homeKey = null;
    throw pairingError(error);
  }
}

function normalizeCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function pairingError(error) {
  const details = {};
  if (Number.isInteger(error.details?.triesLeft) && error.details.triesLeft >= 0 && error.details.triesLeft <= 4) details.triesLeft = error.details.triesLeft;
  const lockedUntil = error.details?.lockedUntil;
  if (typeof lockedUntil === "string" && Number.isFinite(Date.parse(lockedUntil))) details.lockedUntil = new Date(lockedUntil).toISOString();
  return new ApiError(error.status, error.code, "Phone pairing failed.", details, details.lockedUntil ?? null, error.retryAfter);
}

export function renderCodeEntry(document, t, onSubmit, options = {}) {
  const form = element(document, "form", { class: "phone-code-form", "data-code-entry": "true" });
  const entry = element(document, "div", { class: "phone-code-entry", "data-invalid": String(Boolean(options.invalid)) });
  const cells = Array.from({ length: 6 }, () => element(document, "span", { class: "phone-code-cell", "data-code-cell": "true" }));
  const input = element(document, "input", {
    class: "phone-code-input",
    "data-home-code": "true",
    "aria-label": t("homeCode"),
    "aria-describedby": options.invalid ? "phone-code-guidance phone-code-error" : "phone-code-guidance",
    "aria-invalid": String(Boolean(options.invalid)),
    type: "text",
    inputmode: "text",
    maxlength: "6",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    required: "",
  });
  input.value = normalizeCode(options.value);
  const submit = element(document, "button", { type: "submit", class: "btn primary", text: t(options.invalid ? "phoneTryAgain" : "submitCode") });
  const paint = () => {
    const caret = input.selectionStart;
    const prefix = normalizeCode(input.value.slice(0, caret ?? input.value.length)).length;
    input.value = normalizeCode(input.value);
    if (Number.isInteger(caret)) input.setSelectionRange?.(prefix, prefix);
    cells.forEach((cell, index) => {
      cell.textContent = input.value[index] ?? "";
      cell.setAttribute("data-filled", String(index < input.value.length));
    });
    submit.disabled = Boolean(options.busy) || input.value.length !== 6;
  };
  input.addEventListener("input", paint);
  input.addEventListener("paste", event => {
    const pasted = event.clipboardData?.getData("text");
    if (pasted == null) return;
    event.preventDefault();
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? input.value.length;
    input.value = normalizeCode(input.value.slice(0, start) + pasted + input.value.slice(end));
    input.setSelectionRange?.(Math.min(6, start + normalizeCode(pasted).length), Math.min(6, start + normalizeCode(pasted).length));
    paint();
  });
  paint();
  if (options.busy) {
    input.disabled = true;
    submit.setAttribute("aria-busy", "true");
    submit.replaceChildren(progressMark(document, t("phoneOpening")));
  }
  entry.append(element(document, "div", { class: "phone-code-cells", "aria-hidden": "true" }, cells), input);
  form.append(entry);
  if (options.feedback) form.append(options.feedback);
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCode(input.value);
    if (options.busy || code.length !== 6) return;
    input.value = "";
    paint();
    onSubmit?.(code);
  });
  return form;
}

export function renderPhone(document, t, modes, current, onNavigate, iconFor) {
  const nav = element(document, "nav", { class: "phone-nav", "data-phone": "true" });
  for (const mode of modes) {
    const icon = iconFor?.(document, mode === "waiting" ? "waiting" : mode);
    nav.append(element(document, "button", {
      type: "button",
      "data-phone-mode": mode,
      "aria-pressed": String(current === mode),
      onclick: () => onNavigate?.(mode),
    }, icon, t(mode)));
  }
  return nav;
}

export async function logout(api) {
  if (!api.token) return { status: 204, data: null, meta: null };
  const operation = createOperation({ method: "POST", path: "/auth/logout", body: {} });
  try {
    const result = await request(api, "POST", "/auth/logout", { operation });
    api.token = null;
    api.homeKey = null;
    if (api.live) api.live.stopped = true;
    return result;
  } catch (error) {
    api.token = null;
    api.homeKey = null;
    if (api.live) api.live.stopped = true;
    if (error.status === 401 || error.status === 204) return { status: 204, data: null, meta: null };
    throw error;
  }
}
