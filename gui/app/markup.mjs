const runs = new WeakMap();

export function validLink(value) {
  return typeof value === "string" && !/[\s\u0000-\u001f\u007f\\]/u.test(value)
    && /^(?:https?:\/\/[^/]+|mailto:[^@]+@[^@]+)(?:.*)$/i.test(value);
}

export function assetIdentity(value) {
  return typeof value === "string" && /^assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/.test(value)
    ? value.slice(7) : null;
}

// Syntax consumes source bytes but no visible offsets. Newline runs retain their
// original boundaries. Visible newlines use LF, including blank and trailing lines.
export function tokenizeMarkup(source) {
  const tokens = [];
  let plain = 0;
  const text = String(source ?? "");
  function syntax(start, end, action = null, tag = null, attributes = {}) {
    tokens.push({ type: "tag", text: text.slice(start, end), sourceStart: start, sourceEnd: end,
      plainStart: plain, plainEnd: plain, action, tag, ...attributes });
  }
  function literal(start, end, value = text.slice(start, end), boundaries = null) {
    if (!value) return;
    tokens.push({ type: "text", text: value, sourceStart: start, sourceEnd: end, plainStart: plain, plainEnd: plain + value.length,
      ...(boundaries ? { boundaries } : {}) });
    plain += value.length;
  }
  function inline(start, end, depth = 0) {
    if (depth > 32) { literal(start, end); return; }
    let at = start, run = start;
    const flush = () => { literal(run, at); };
    while (at < end) {
      const rest = text.slice(at, end);
      if (/^\\[\\`*_~[\]()>#|!]/.test(rest)) {
        flush(); syntax(at, at + 1); literal(at + 1, at + 2); at += 2; run = at; continue;
      }
      const legacy = /^(<\/?[bi]>)/.exec(rest);
      if (legacy) {
        flush(); const tag = legacy[1]; syntax(at, at + tag.length, tag[1] === "/" ? "close" : "open", tag.includes("b") ? "b" : "i");
        at += tag.length; run = at; continue;
      }
      const link = /^(!?)\[([^\]\n]*)\]\(([^()\s]+)\)/.exec(rest);
      if (link && (link[1] ? assetIdentity(link[3]) : validLink(link[3]))) {
        flush(); const content = at + link[1].length + 1, close = content + link[2].length;
        syntax(at, content, "open", link[1] ? "span" : "a", link[1] ? { image: link[3], alt: link[2] } : { href: link[3] });
        inline(content, close, depth + 1);
        syntax(close, at + link[0].length, "close", link[1] ? "span" : "a");
        at += link[0].length; run = at; continue;
      }
      const mark = ["**", "__", "~~", "`", "*", "_"].find((item) => rest.startsWith(item));
      if (mark && !(mark.includes("_") && /[\p{L}\p{N}]/u.test(text[at - 1] ?? ""))) {
        let close = text.indexOf(mark, at + mark.length);
        while (close >= 0 && text[close - 1] === "\\") close = text.indexOf(mark, close + mark.length);
        if (close >= at + mark.length && close < end) {
          flush(); const tag = mark === "`" ? "code" : mark === "~~" ? "s" : mark.length === 2 ? "b" : "i";
          syntax(at, at + mark.length, "open", tag);
          if (tag === "code") literal(at + mark.length, close); else inline(at + mark.length, close, depth + 1);
          syntax(close, close + mark.length, "close", tag); at = close + mark.length; run = at; continue;
        }
      }
      at += 1;
    }
    literal(run, end);
  }
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter((item) => item[0].length).map((item) => {
    const value = item[0].replace(/[\r\n]+$/, "");
    return { start: item.index, end: item.index + value.length, next: item.index + item[0].length, value };
  });
  let previous = null, group = null;
  const closeGroup = (at) => { const boundary = previous?.end ?? at; if (group) syntax(boundary, boundary, "close", group); group = null; };
  function newlineRun(from, end) {
    if (end <= from) return;
    const newlines = [...text.slice(from, end).matchAll(/\r\n|\r|\n/g)];
    const boundaries = [from];
    for (const match of newlines) boundaries.push(from + match.index + match[0].length);
    literal(from, end, "\n".repeat(newlines.length), boundaries);
  }
  function gap(line) {
    newlineRun(previous?.end ?? 0, line.start);
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.value) continue;
    const fence = /^(`{3,}|~{3,})([\w-]*)\s*$/.exec(line.value);
    if (fence) {
      const close = lines.findIndex((item, index) => index > i && item.value.trim() === fence[1]);
      if (close > i) {
        closeGroup(line.start); gap(line); syntax(line.start, line.next, "open", "pre");
        for (let n = i + 1; n < close; n += 1) {
          literal(lines[n].start, lines[n].end);
          if (n + 1 < close) literal(lines[n].end, lines[n].next, "\n", [lines[n].end, lines[n].next]);
        }
        const last = lines[close - 1];
        syntax(last.next === lines[close].start ? last.end : lines[close].start, lines[close].end, "close", "pre");
        previous = lines[close]; i = close; continue;
      }
    }
    const separator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.value);
    const table = group === "table" && line.value.includes("|") || i + 1 < lines.length && line.value.includes("|")
      && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1].value);
    const list = /^(?:[-+*]|\d+\.)\s+/.exec(line.value);
    const heading = /^(#{1,3})\s+/.exec(line.value);
    const quote = /^>\s?/.exec(line.value);
    const nextGroup = table ? "table" : list ? /^\d/.test(list[0]) ? "ol" : "ul" : null;
    if (group !== nextGroup) closeGroup(line.start);
    if (separator && group === "table") { syntax(previous.end, line.end); previous = line; continue; }
    gap(line);
    if (nextGroup && group !== nextGroup) { syntax(line.start, line.start, "open", nextGroup); group = nextGroup; }
    if (table) {
      syntax(line.start, line.start, "open", "tr");
      let at = line.start;
      const cells = line.value.split(/(?<!\\)\|/);
      for (let n = 0; n < cells.length; n += 1) {
        const end = at + cells[n].length;
        if (cells[n].trim()) {
          const begin = at + cells[n].length - cells[n].trimStart().length, finish = at + cells[n].trimEnd().length;
          syntax(at, begin, "open", "td"); inline(begin, finish); syntax(finish, end, "close", "td");
        } else syntax(at, end);
        if (n < cells.length - 1) {
          if (n > 0 && n < cells.length - 2) literal(end, end + 1, "\t"); else syntax(end, end + 1);
        }
        at = end + 1;
      }
      syntax(line.end, line.end, "close", "tr");
    } else {
      const prefix = heading?.[0] ?? list?.[0] ?? quote?.[0] ?? "";
      const tag = heading ? `h${heading[1].length}` : list ? "li" : quote ? "blockquote" : /^<([bi])>[^<]*<\/\1>$/.test(line.value) ? "h3" : "p";
      syntax(line.start, line.start + prefix.length, "open", tag);
      inline(line.start + prefix.length, line.end);
      syntax(line.end, line.end, "close", tag);
    }
    previous = line;
  }
  closeGroup(text.length);
  const last = previous?.end ?? 0;
  if (last < text.length) newlineRun(last, text.length);
  return tokens;
}

export function plainText(source) {
  return tokenizeMarkup(source).filter((token) => token.type === "text").map((token) => token.text).join("");
}

export function renderMarkup(document, source, { assets = new Map() } = {}) {
  const fragment = document.createDocumentFragment();
  const stack = [fragment];
  for (const token of tokenizeMarkup(source)) {
    if (token.type === "text") {
      const node = document.createTextNode(token.text);
      runs.set(node, token);
      stack.at(-1).append(node);
      continue;
    }
    if (token.action === "open") {
      const element = document.createElement(token.tag);
      if (token.href && validLink(token.href)) { element.setAttribute("href", token.href); element.setAttribute("rel", "noopener noreferrer"); }
      if (token.image) {
        element.setAttribute("data-image", token.image);
        const asset = assets.get(token.image);
        if (assetIdentity(token.image) && asset?.url?.startsWith("blob:")) {
          const image = document.createElement("img");
          image.setAttribute("src", asset.url); image.setAttribute("alt", token.alt); image.setAttribute("contenteditable", "false");
          element.append(image);
        }
      }
      stack.at(-1).append(element);
      stack.push(element);
      continue;
    }
    if (token.action === "close") {
      const index = stack.findLastIndex((node) => node.tagName?.toLowerCase() === token.tag);
      if (index > 0) stack.length = index;
    }
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
  if (!Number.isInteger(offset)) return null;
  if (run?.type === "text") return run.plainStart + Math.max(0, Math.min(offset, run.text.length));
  const children = node?.childNodes ?? node?.children ?? [];
  const first = (item) => runMetadata(item) ?? [...(item?.childNodes ?? item?.children ?? [])].map(first).find(Boolean);
  const last = (item) => runMetadata(item) ?? [...(item?.childNodes ?? item?.children ?? [])].reverse().map(last).find(Boolean);
  return first(children[offset])?.plainStart ?? last(children[offset - 1])?.plainEnd ?? null;
}

export function sourceBoundary(source, plainOffset, affinity = "end") {
  const tokens = tokenizeMarkup(source);
  if (!validUtf16Boundary(plainText(source), plainOffset)) return null;
  const tags = tokens.filter((token) => token.type === "tag" && token.sourceEnd > token.sourceStart && token.plainStart === plainOffset);
  if (affinity === "start" && tags.length) return tags[0].sourceStart;
  if (affinity === "end" && tags.length) return tags.at(-1).sourceEnd;
  for (const token of tokens) {
    if (token.type !== "text") continue;
    if (plainOffset >= token.plainStart && plainOffset <= token.plainEnd) return token.boundaries?.[plainOffset - token.plainStart] ?? token.sourceStart + (plainOffset - token.plainStart);
  }
  return plainOffset === 0 && !source ? 0 : null;
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

export function plainCaretFromSource(tokens, offset) {
  if (!Number.isInteger(offset) || offset < 0) return null;
  for (const token of tokens) {
    if (offset < token.sourceStart) return token.plainStart;
    if (offset <= token.sourceEnd) {
      if (token.type !== 'text') return token.plainStart;
      if (token.boundaries) return token.plainStart + Math.max(0, token.boundaries.findLastIndex((boundary) => boundary <= offset));
      const caret = token.plainStart + Math.min(offset - token.sourceStart, token.plainEnd - token.plainStart);
      return validUtf16Boundary(token.text, caret - token.plainStart) ? caret : caret - 1;
    }
  }
  return offset === (tokens.at(-1)?.sourceEnd ?? 0) ? tokens.at(-1)?.plainEnd ?? 0 : null;
}
