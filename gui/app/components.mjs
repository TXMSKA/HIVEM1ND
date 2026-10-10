const ICONS = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  hierarchy: "M12 5a2.5 2.5 0 1 0 0 .1M5 19a2.5 2.5 0 1 0 0 .1M19 19a2.5 2.5 0 1 0 0 .1M12 7.5V11M12 11.5 6 17M12 11.5l6 5.5",
  chats: "M5 6h14v9H8l-3 3z",
  waiting: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v8M14 12V6.5a1.5 1.5 0 0 1 3 0V15c0 4-2.5 6-6 6",
  blueprint: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  document: "M6 3h9l3 3v15H6zM15 3v4h4",
  focus: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  settings: "M4 7h10M18 7h2M4 12h2M10 12h10M4 17h12",
  close: "M6 6l12 12M18 6 6 18",
  alert: "M12 4 3 19h18zM12 10v4M12 16h.1",
};

export function element(document, tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) appendChild(document, node, child);
  return node;
}

export function icon(document, name) {
  const pathData = ICONS[name];
  if (!pathData) throw new Error(`Unknown icon: ${name}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

export function showDialog(document, { title, body, confirm, cancel, onConfirm }) {
  const invoker = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  const heading = element(document, "h2", { id: "dialog-title", text: title });
  const copy = element(document, "p", { text: body ?? "" });
  const actions = element(document, "div", { class: "dialog-actions" });
  const cancelButton = element(document, "button", { type: "button", class: "btn", text: cancel });
  actions.append(cancelButton);
  if (confirm) {
    const confirmButton = element(document, "button", { type: "button", class: "btn primary", text: confirm });
    confirmButton.addEventListener("click", async () => {
      setBusy(confirmButton, true);
      try {
        await onConfirm?.();
        dialog.close();
      } finally {
        setBusy(confirmButton, false);
      }
    });
    actions.append(confirmButton);
  }
  cancelButton.addEventListener("click", () => dialog.close());
  dialog.append(heading, copy, actions);
  dialog.addEventListener("close", () => {
    dialog.remove();
    invoker?.focus?.();
  });
  dialog.addEventListener("keydown", (event) => trapFocus(dialog, event));
  document.body.append(dialog);
  dialog.showModal();
  cancelButton.focus();
  return dialog;
}

export function showError(document, { title, message, close }) {
  return showDialog(document, { title, body: message, cancel: close });
}

export function announce(host, message) {
  const document = host.ownerDocument;
  let region = host.querySelector("[data-announce]");
  if (!region) {
    region = element(document, "div", { class: "sr", "aria-live": "polite", "data-announce": "true" });
    host.append(region);
  }
  region.textContent = "";
  region.textContent = message;
}

export function setBusy(control, busy) {
  control.disabled = Boolean(busy);
  control.setAttribute("aria-busy", busy ? "true" : "false");
}

function appendChild(document, node, child) {
  if (child == null || child === false) return;
  if (typeof child === "string" || typeof child === "number") node.append(document.createTextNode(String(child)));
  else node.append(child);
}

function trapFocus(dialog, event) {
  if (event.key !== "Tab") return;
  const controls = [...dialog.querySelectorAll("button, [href], input, select, textarea")].filter((item) => !item.disabled);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && dialog.ownerDocument.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && dialog.ownerDocument.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
