import { createOperation, request } from "./api.mjs";
import { element } from "./components.mjs";

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
    api.homeKey = null;
    return result.data;
  } catch (error) {
    api.homeKey = null;
    throw error;
  }
}

export async function exchangeCode(api, code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  api.homeKey = null;
  try {
    const result = await request(api, "POST", "/auth/home", { body: { code: normalized } });
    api.token = result.data.token;
    api.homeKey = null;
    return result.data;
  } catch (error) {
    api.homeKey = null;
    throw error;
  }
}

export function renderCodeEntry(document, t, onSubmit) {
  const form = element(document, "form", { "data-code-entry": "true" });
  const input = element(document, "input", {
    "data-home-code": "true",
    "aria-label": t("homeCode"),
    maxlength: "6",
    autocomplete: "off",
  });
  input.value = "";
  const submit = element(document, "button", { type: "submit", class: "btn", text: t("submitCode") });
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const entered = input.value;
    input.value = "";
    onSubmit?.(entered);
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
