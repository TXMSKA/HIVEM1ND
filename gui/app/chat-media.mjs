// The parts a chat message shows under its text: a gallery of its pictures and a row of buttons that open a link, a
// Blueprint board, a Void text or a task. The gallery is a carousel with a strip of thumbnails, and it can be seen as a
// grid or a list instead. Pictures are blob URLs the caller fetched; nothing here reads the network.
import { element, icon, labelDialog, labeledField, pathIcon } from "./components.mjs";
import { validLink } from "./markup.mjs";

export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
export const IMAGE_MAX_BYTES = 10_000_000;
export const GALLERY_VIEWS = Object.freeze(["carousel", "grid", "list"]);

const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;
const RESOURCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TASK = /^(?:root:[0-9]+|env:[^:\s\\/]+:[0-9]+|project:[^:\s\\/]+:[0-9]+)$/;
// The shape the service accepts: no spaces, no backslash and no credentials before the host.
const LINK = /^(?:https?:\/\/[^\s/?#@\\]+(?:[/?#][^\s\\]*)?|mailto:[^\s@\\]+@[^\s@\\]+)$/i;
const LABEL_MAX = 120;
const SWIPE = 40;
const GLYPHS = {
  previous: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  carousel: "M7 5h10v14H7zM3 8v8M21 8v8",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};
const ACTION_ICONS = { board: "blueprint", text: "document", task: "check" };

// The pictures and the buttons of a message. A part that is not one of the five kinds, or whose target does not have the
// shape of its kind, is left out: the service checked it once, and the view never trusts what it is given.
export function messageParts(attachments) {
  const images = [];
  const actions = [];
  for (const part of Array.isArray(attachments) ? attachments : []) {
    if (!part || typeof part !== "object" || typeof part.path !== "string") continue;
    const label = typeof part.label === "string" ? part.label.trim().slice(0, LABEL_MAX) : "";
    if (part.kind === "image" && ASSET.test(part.path)) images.push({ id: part.path, label });
    else if (part.kind === "link" && isLink(part.path)) actions.push({ kind: "link", target: part.path, label });
    else if ((part.kind === "board" || part.kind === "text") && RESOURCE.test(part.path)) actions.push({ kind: part.kind, target: part.path, label });
    else if (part.kind === "task" && TASK.test(part.path)) actions.push({ kind: "task", target: part.path, label });
  }
  return { images, actions };
}

function isLink(value) {
  return typeof value === "string" && value.length <= 2048 && LINK.test(value) && validLink(value);
}

// The part a composer adds, in the shape the service stores, or null when the target does not fit its kind.
export function composerPart(kind, target, label = "") {
  const value = typeof target === "string" ? target.trim() : "";
  const name = typeof label === "string" ? label.trim().slice(0, LABEL_MAX) : "";
  const fits = kind === "link" ? isLink(value)
    : kind === "board" || kind === "text" ? RESOURCE.test(value)
      : kind === "task" ? TASK.test(value)
        : kind === "image" && ASSET.test(value);
  if (!fits) return null;
  return { kind, path: value, ...(name ? { label: name } : {}) };
}

// What a gallery shows is kept per message, so a redraw of the chat leaves each one where the person left it.
export function galleryState(store, messageId, count) {
  let state = store.get(messageId);
  if (!state) {
    state = { view: "carousel", index: 0 };
    store.set(messageId, state);
  }
  if (!GALLERY_VIEWS.includes(state.view)) state.view = "carousel";
  state.index = count > 0 ? Math.min(Math.max(0, Math.trunc(state.index) || 0), count - 1) : 0;
  return state;
}

export function stepGallery(state, count, step) {
  if (count < 1) return state;
  state.index = (state.index + step + count) % count;
  return state;
}

// imageFor(id) gives {url} for a picture that loaded, {failed: true} for one that could not, and null while it loads.
export function renderGallery(document, { images, state, imageFor, t, onChange }) {
  const count = images.length;
  if (!GALLERY_VIEWS.includes(state.view)) state.view = "carousel";
  state.index = Math.min(Math.max(0, Math.trunc(state.index) || 0), Math.max(0, count - 1));
  const name = (image, index) => image.label || t("galleryImage", { index: index + 1 });
  const gallery = element(document, "div", { class: "chat-gallery", role: "group", "aria-label": t("galleryLabel"),
    "data-gallery": String(count), "data-view": state.view });
  const choose = (index) => { state.view = "carousel"; state.index = index; onChange(); };
  // A thumbnail sits in a button that already carries the name, so only the large picture is described.
  const picture = (image, index, className) => {
    const loaded = imageFor(image.id);
    const thumb = className === "gallery-thumb";
    if (loaded?.url) return element(document, "img", { class: className, src: loaded.url, alt: thumb ? "" : name(image, index), "data-gallery-image": image.id });
    return element(document, "span", {
      class: `${className} gallery-placeholder`,
      "data-gallery-image": image.id,
      "data-state": loaded?.failed ? "failed" : "loading",
      ...(thumb ? { "aria-hidden": "true" } : { role: "img", "aria-label": name(image, index) }),
      text: loaded?.failed ? t("galleryFailed") : t("galleryLoading"),
    });
  };
  if (count > 1) {
    const views = element(document, "div", { class: "gallery-views", role: "group", "aria-label": t("galleryViews") });
    for (const view of GALLERY_VIEWS) {
      const label = t(`gallery${view[0].toUpperCase()}${view.slice(1)}`);
      views.append(element(document, "button", {
        type: "button", class: "gallery-view", "data-gallery-view": view, "aria-pressed": String(state.view === view), "aria-label": label, title: label,
        onclick: () => { state.view = view; onChange(); },
      }, pathIcon(document, GLYPHS[view])));
    }
    gallery.append(views);
  }
  if (state.view === "grid" && count > 1) {
    const grid = element(document, "div", { class: "gallery-grid", "data-gallery-grid": "true" });
    images.forEach((image, index) => grid.append(element(document, "button", {
      type: "button", class: "gallery-cell", "data-gallery-index": String(index), "aria-label": name(image, index), onclick: () => choose(index),
    }, picture(image, index, "gallery-thumb"))));
    gallery.append(grid);
    return gallery;
  }
  if (state.view === "list" && count > 1) {
    const list = element(document, "ul", { class: "gallery-list", "data-gallery-list": "true" });
    images.forEach((image, index) => list.append(element(document, "li", {}, element(document, "button", {
      type: "button", class: "gallery-row", "data-gallery-index": String(index), onclick: () => choose(index),
    }, picture(image, index, "gallery-thumb"), element(document, "span", { class: "gallery-name", text: name(image, index) })))));
    gallery.append(list);
    return gallery;
  }
  const current = images[state.index];
  const stage = element(document, "div", {
    class: "gallery-stage", "data-gallery-stage": "true", tabindex: count > 1 ? "0" : null,
    "aria-roledescription": count > 1 ? t("galleryCarousel") : null,
    "aria-label": count > 1 ? t("galleryPosition", { index: state.index + 1, count }) : null,
  }, picture(current, state.index, "gallery-picture"));
  if (count > 1) {
    const move = (step) => { stepGallery(state, count, step); onChange(); };
    stage.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault?.();
      move(event.key === "ArrowLeft" ? -1 : 1);
    });
    // On a touch screen a sideways swipe turns the carousel; a vertical one still scrolls the chat.
    let swipeFrom = null;
    stage.addEventListener("pointerdown", (event) => { swipeFrom = event.pointerType === "touch" ? event.clientX : null; });
    stage.addEventListener("pointercancel", () => { swipeFrom = null; });
    stage.addEventListener("pointerup", (event) => {
      if (swipeFrom === null) return;
      const distance = event.clientX - swipeFrom;
      swipeFrom = null;
      if (Math.abs(distance) >= SWIPE) move(distance > 0 ? -1 : 1);
    });
    stage.append(
      element(document, "button", { type: "button", class: "gallery-step", "data-action": "gallery-previous", "aria-label": t("galleryPrevious"), title: t("galleryPrevious"), onclick: () => move(-1) }, pathIcon(document, GLYPHS.previous)),
      element(document, "button", { type: "button", class: "gallery-step", "data-action": "gallery-next", "aria-label": t("galleryNext"), title: t("galleryNext"), onclick: () => move(1) }, pathIcon(document, GLYPHS.next)),
      element(document, "span", { class: "gallery-count", "aria-hidden": "true", text: `${state.index + 1} / ${count}` }),
    );
  }
  gallery.append(stage);
  if (count > 1) {
    const strip = element(document, "div", { class: "gallery-strip", "data-gallery-strip": "true" });
    images.forEach((image, index) => strip.append(element(document, "button", {
      type: "button", class: "gallery-cell", "data-gallery-index": String(index), "aria-pressed": String(index === state.index), "aria-label": name(image, index),
      onclick: () => choose(index),
    }, picture(image, index, "gallery-thumb"))));
    gallery.append(strip);
  }
  return gallery;
}

// The name a button shows: its own label, else what it opens.
export function actionName(action, t, titleOf = () => "") {
  if (action.label) return action.label;
  if (action.kind === "link") {
    if (/^mailto:/i.test(action.target)) return action.target.slice(7);
    try { return new URL(action.target).host; } catch { return action.target; }
  }
  const title = titleOf(action);
  if (title) return title;
  if (action.kind === "task") return t("chatTask", { id: action.target.split(":").at(-1) });
  return t(action.kind === "board" ? "chatBoard" : "chatText");
}

// A link opens outside the app, in the browser; the other buttons open their board, text or task in the app.
export function renderActions(document, actions, { t, titleOf, onOpen }) {
  const row = element(document, "div", { class: "chat-actions", "data-chat-actions": String(actions.length) });
  for (const action of actions) {
    const name = actionName(action, t, titleOf);
    const glyph = action.kind === "link" ? pathIcon(document, GLYPHS.link) : icon(document, ACTION_ICONS[action.kind]);
    if (action.kind === "link") {
      row.append(element(document, "a", { class: "chat-action", href: action.target, target: "_blank", rel: "noopener noreferrer", "data-chat-action": "link", title: action.target }, glyph, element(document, "span", { text: name })));
      continue;
    }
    row.append(element(document, "button", { type: "button", class: "chat-action", "data-chat-action": action.kind, "data-target": action.target, onclick: () => onOpen(action) },
      glyph, element(document, "span", { text: name })));
  }
  return row;
}

// The parts waiting in a composer, each with a way to take it out before the message is sent.
export function renderPendingParts(document, parts, { t, titleOf, onRemove }) {
  const row = element(document, "div", { class: "composer-parts", "data-composer-parts": String(parts.length) });
  parts.forEach((part, index) => {
    const name = part.kind === "image" ? part.name || t("galleryImage", { index: index + 1 })
      : actionName({ kind: part.kind, target: part.path, label: part.label ?? "" }, t, titleOf);
    const chip = element(document, "span", { class: "composer-part", "data-part": part.kind, "data-state": part.uploading ? "uploading" : "ready" });
    if (part.kind === "image" && part.preview) chip.append(element(document, "img", { class: "composer-part-thumb", src: part.preview, alt: "" }));
    else chip.append(part.kind === "link" ? pathIcon(document, GLYPHS.link) : icon(document, ACTION_ICONS[part.kind] ?? "document"));
    chip.append(element(document, "span", { class: "composer-part-name", text: part.uploading ? t("attachUploading") : name }));
    chip.append(element(document, "button", { type: "button", class: "composer-part-remove", "data-action": "remove-part", "aria-label": t("attachRemove", { name }), title: t("attachRemove", { name }),
      onclick: () => onRemove(part) }, icon(document, "close")));
    row.append(chip);
  });
  return row;
}

// The dialog that adds parts to a message: pictures from this device and a link everywhere, and the boards, texts and
// tasks offered in `choices` ({board, text, task}, each a list of {id, title}). Each addition closes it.
export function renderAttachDialog(document, { t, choices = {}, onImages, onAdd }) {
  const dialog = element(document, "dialog", { class: "dialog attach-dialog", "data-attach-dialog": "true" });
  const heading = element(document, "h2", { text: t("attachToMessage") });
  labelDialog(dialog, heading);
  const files = element(document, "input", { type: "file", multiple: "", accept: IMAGE_TYPES.join(","), "data-attach-images": "true" });
  files.addEventListener("change", () => {
    const picked = [...(files.files ?? [])];
    if (!picked.length) return;
    dialog.close();
    onImages(picked);
  });
  const address = element(document, "input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://", "data-attach-link": "true" });
  const linkName = element(document, "input", { type: "text", maxlength: "120", autocomplete: "off", "data-attach-link-name": "true" });
  const linkError = element(document, "p", { class: "field-error", role: "alert", "data-attach-error": "link" });
  address.addEventListener("input", () => { linkError.textContent = ""; address.removeAttribute?.("aria-invalid"); });
  const addLink = element(document, "button", { type: "button", class: "btn", "data-action": "attach-link", text: t("attachAdd"), onclick: () => {
    const part = composerPart("link", address.value, linkName.value);
    if (!part) {
      linkError.textContent = t("attachLinkInvalid");
      address.setAttribute("aria-invalid", "true");
      address.focus?.();
      return;
    }
    dialog.close();
    onAdd(part);
  } });
  dialog.append(heading, labeledField(document, t("attachImages"), t("attachImagesHint"), files),
    element(document, "div", { class: "attach-group", "data-attach-group": "link" },
      labeledField(document, t("attachLink"), t("attachLinkHint"), address),
      labeledField(document, t("attachLinkName"), t("attachLinkNameHint"), linkName), linkError, addLink));
  for (const kind of ["board", "text", "task"]) {
    const items = choices[kind] ?? [];
    if (!items.length) continue;
    const select = element(document, "select", { "data-attach-choice": kind },
      element(document, "option", { value: "", text: t("attachChoose") }),
      ...items.map((item) => element(document, "option", { value: item.id, text: item.title || item.id })));
    const add = element(document, "button", { type: "button", class: "btn", "data-action": `attach-${kind}`, text: t("attachAdd"), onclick: () => {
      const item = items.find((entry) => entry.id === select.value);
      const part = item ? composerPart(kind, item.id, item.title) : null;
      if (!part) {
        select.focus?.();
        return;
      }
      dialog.close();
      onAdd(part);
    } });
    const label = { board: "attachBoard", text: "attachText", task: "attachTask" }[kind];
    dialog.append(element(document, "div", { class: "attach-group", "data-attach-group": kind }, labeledField(document, t(label), t("attachChooseHint"), select), add));
  }
  dialog.append(element(document, "div", { class: "dialog-actions" },
    element(document, "button", { type: "button", class: "btn", "data-action": "attach-cancel", text: t("cancel"), onclick: () => dialog.close() })));
  dialog.addEventListener("close", () => dialog.remove?.());
  return dialog;
}

// Base64 in slices, so a picture of several megabytes does not build one character at a time.
export function encodeBase64(bytes) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
