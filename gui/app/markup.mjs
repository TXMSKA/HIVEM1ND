const TAGS = ["<b>", "</b>", "<i>", "</i>"];
const runs = new WeakMap();

export function tokenizeMarkup(source) {
  const tokens = [];
  let index = 0;
  let plain = 0;
  const text = String(source ?? "");
  while (index < text.length) {
    const tag = TAGS.find((item) => text.startsWith(item, index));
    if (tag) {
      tokens.push({ type: "tag", tag, text: tag, sourceStart: index, sourceEnd: index + tag.length, plainStart: plain, plainEnd: plain });
      index += tag.length;
      continue;
    }
    let end = index + 1;
    while (end < text.length && !TAGS.some((item) => text.startsWith(item, end))) end += 1;
    const value = text.slice(index, end);
    tokens.push({ type: "text", text: value, sourceStart: index, sourceEnd: end, plainStart: plain, plainEnd: plain + value.length });
    plain += value.length;
    index = end;
  }
  return tokens;
}

export function plainText(source) {
  return tokenizeMarkup(source).filter((token) => token.type === "text").map((token) => token.text).join("");
}

export function renderMarkup(document, source) {
  const fragment = document.createDocumentFragment();
  const stack = [fragment];
  for (const token of tokenizeMarkup(source)) {
    if (token.type === "text") {
      const node = document.createTextNode(token.text);
      runs.set(node, token);
      stack.at(-1).append(node);
      continue;
    }
    if (token.tag === "<b>" || token.tag === "<i>") {
      const element = document.createElement(token.tag === "<b>" ? "b" : "i");
      stack.at(-1).append(element);
      stack.push(element);
      continue;
    }
    const closing = token.tag === "</b>" ? "B" : "I";
    if (stack.at(-1).tagName === closing) stack.pop();
  }
  return fragment;
}

export function runMetadata(node) {
  return runs.get(node) ?? null;
}

export function plainOffsets(anchorNode, anchorOffset, focusNode, focusOffset) {
  const start = plainPoint(anchorNode, anchorOffset);
  const end = plainPoint(focusNode, focusOffset);
  if (start == null || end == null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function plainPoint(node, offset) {
  const run = runMetadata(node);
  if (!run || run.type !== "text" || !Number.isInteger(offset)) return null;
  const index = Math.max(0, Math.min(offset, run.text.length));
  return run.plainStart + index;
}

export function sourceBoundary(source, plainOffset, affinity = "end") {
  const tokens = tokenizeMarkup(source);
  const tags = tokens.filter((token) => token.type === "tag" && token.plainStart === plainOffset);
  if (affinity === "start" && tags.length) return tags[0].sourceStart;
  if (affinity === "end" && tags.length) return tags.at(-1).sourceEnd;
  for (const token of tokens) {
    if (token.type !== "text") continue;
    if (plainOffset >= token.plainStart && plainOffset <= token.plainEnd) return token.sourceStart + (plainOffset - token.plainStart);
  }
  return null;
}

export function createTextAnchor(source, k, lang, plainStart, plainEnd) {
  const plain = plainText(source);
  return {
    k,
    lang,
    start: plainStart,
    end: plainEnd,
    quote: plain.slice(plainStart, plainEnd),
    prefix: plain.slice(Math.max(0, plainStart - 48), plainStart),
    suffix: plain.slice(plainEnd, plainEnd + 48),
  };
}

export function validUtf16Boundary(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function boundaryInsideTag(source, offset) {
  return tokenizeMarkup(source).some((token) => token.type === "tag" && offset > token.sourceStart && offset < token.sourceEnd);
}

export function rangeRequest(editor, k, lang, start, end, replacement) {
  const source = editor.document.pages.find((page) => page.k === k)[lang];
  if (end < start || !validUtf16Boundary(source, start) || !validUtf16Boundary(source, end)
      || boundaryInsideTag(source, start) || boundaryInsideTag(source, end)) {
    throw new Error("The selected source range is invalid.");
  }
  return { k, lang, start, end, expectedText: source.slice(start, end), replacement,
    expectedRevision: editor.revision };
}
