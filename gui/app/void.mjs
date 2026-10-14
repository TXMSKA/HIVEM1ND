import { perform, request } from "./api.mjs";
import { element, icon } from "./components.mjs";
import { assetIdentity, boundaryInsideTag, createTextAnchor, plainCaretFromSource, plainOffsets, plainText, rangeRequest, renderMarkup, runMetadata, sourceBoundary, tokenizeMarkup, validLink, validUtf16Boundary } from "./markup.mjs";

export function renderDocument(document, host, editor) {
  host.replaceChildren();
  const text = editor.authoritative?.document ?? editor.document;
  if (!text) return;
  const page = text.pages?.find((item) => item.k === editor.page) ?? text.pages?.[0];
  if (!page) return;
  editor.page = page.k;
  const block = document.createElement("article");
  block.dataset.page = page.k;
  block.dataset.language = editor.language ?? "en";
  if (editor.focus?.k === page.k) {
    block.dataset.highlight = "true";
    if (Number.isInteger(editor.focus.start) && Number.isInteger(editor.focus.end)) block.dataset.range = `${editor.focus.start}:${editor.focus.end}`;
    if (editor.focus.lang) block.dataset.language = editor.focus.lang;
  }
  const source = textDraft(editor, editor.resourceId, page.k, block.dataset.language) ?? page[block.dataset.language] ?? "";
  block.append(renderMarkup(document, source, { assets: editor.assets }));
  host.append(block);
}

export function textDraftKey(resourceId, k, lang) {
  return `${resourceId}\0${k}\0${lang}`;
}

export function textDraft(editor, resourceId, k, lang) {
  const drafts = editor?.textDrafts;
  const key = textDraftKey(resourceId, k, lang);
  if (!drafts?.has(key)) return undefined;
  return drafts.get(key);
}

export function rememberTextDraft(editor, resourceId, k, lang, value) {
  if (!editor.dirty) editor.baseRevision = editor.revision;
  editor.editGeneration = (editor.editGeneration ?? 0) + 1;
  if (!editor.textDrafts) editor.textDrafts = new Map();
  editor.textDrafts.set(textDraftKey(resourceId, k, lang), value);
  editor.draftKey = { k, lang };
  editor.draftText = value;
  editor.dirty = true;
  return value;
}

export function beginTextEdit(editor, k, lang) {
  const source = editor.document?.pages?.find((page) => page.k === k)?.[lang] ?? editor.authoritative?.document?.pages?.find((page) => page.k === k)?.[lang] ?? "";
  const existing = textDraft(editor, editor.resourceId, k, lang);
  return rememberTextDraft(editor, editor.resourceId, k, lang, existing === undefined ? source : existing);
}

export function sourceReplacement(current, value) {
  const currentText = String(current ?? "");
  const nextText = String(value ?? "");
  let start = 0;
  while (start < currentText.length && start < nextText.length && currentText[start] === nextText[start]) start += 1;
  let end = currentText.length;
  let valueEnd = nextText.length;
  while (end > start && valueEnd > start && currentText[end - 1] === nextText[valueEnd - 1]) {
    end -= 1;
    valueEnd -= 1;
  }
  if (!safeSourceBoundary(currentText, start) || !safeSourceBoundary(currentText, end) || !safeSourceBoundary(nextText, start) || !safeSourceBoundary(nextText, valueEnd)) {
    return { start: 0, end: currentText.length, replacement: nextText };
  }
  return { start, end, replacement: nextText.slice(start, valueEnd) };
}

function safeSourceBoundary(source, offset) {
  return validUtf16Boundary(source, offset) && !boundaryInsideTag(source, offset);
}

export function selectedPlainRange(selection) {
  if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return null;
  const range = plainOffsets(selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset);
  if (!range || range.start === range.end) return null;
  return range;
}

export async function saveRange(api, editor, k, lang, start, end, replacement, retained = null) {
  const generation = editor.editGeneration ?? 0;
  const body = rangeRequest({ document: editor.authoritative?.document ?? editor.document, revision: editor.revision }, k, lang, start, end, replacement);
  const result = await perform(api, {
    method: "POST",
    path: "/void/texts/:resourceId/ranges",
    params: { resourceId: editor.resourceId },
    body,
  }, retained);
  const saved = result.data?.editor;
  acceptText(editor, saved);
  if (saved?.document || saved?.revision) {
    if ((editor.editGeneration ?? 0) === generation && !editor.textDrafts?.size) editor.dirty = false;
    if (!editor.conflict?.remote || editor.conflict.remote.revision === saved.revision) editor.conflict = null;
  }
  return result;
}

export async function replaceDocument(api, editor, document, retained = null, expectedRevision = editor.revision) {
  const generation = editor.editGeneration ?? 0;
  const next = structuredClone(document);
  delete next.rev;
  delete next.history;
  const result = await perform(api, {
    method: "PUT",
    path: "/void/texts/:resourceId",
    params: { resourceId: editor.resourceId },
    body: { document: next, expectedRevision },
  }, retained);
  acceptText(editor, result.data);
  if ((editor.editGeneration ?? 0) === generation && !editor.textDrafts?.size) editor.dirty = false;
  if (!editor.conflict?.remote || editor.conflict.remote.revision === result.data.revision) editor.conflict = null;
  return result;
}

export function editProposal(editor, proposal, replacement = proposal.replacement) {
  editor.proposalDrafts ??= new Map();
  editor.proposalDrafts.set(proposal.id, replacement);
}

export function proposalStale(editor, proposal) {
  const source = (editor.authoritative?.document ?? editor.document)?.pages?.find((page) => page.k === proposal.k)?.[proposal.lang];
  return editor.staleProposals?.has(proposal.id) || proposal.baseRevision !== editor.revision
    || typeof source !== "string" || source.slice(proposal.start, proposal.end) !== proposal.expectedText;
}

export function proposalPassage(editor, proposal) {
  const source = (editor.authoritative?.document ?? editor.document)?.pages?.find((page) => page.k === proposal.k)?.[proposal.lang];
  if (typeof source !== "string") return null;
  const visible = plainText(source), tokens = tokenizeMarkup(source);
  const near = plainCaretFromSource(tokens, Math.min(source.length, Math.max(0, proposal.start)));
  const quote = plainText(proposal.expectedText);
  const offsets = [];
  if (quote) for (let at = visible.indexOf(quote); at >= 0; at = visible.indexOf(quote, at + 1)) offsets.push(at);
  let start = offsets.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
  let end;
  if (start !== undefined) end = start + quote.length;
  else {
    start = visible.lastIndexOf("\n", Math.max(0, near - 1)) + 1;
    end = visible.indexOf("\n", near);
    if (end < 0) end = visible.length;
  }
  if (end <= start || !validUtf16Boundary(visible, start) || !validUtf16Boundary(visible, end)) return null;
  return { source, anchor: createTextAnchor(source, proposal.k, proposal.lang, start, end),
    start: sourceBoundary(source, start, "end"), end: sourceBoundary(source, end, "start") };
}

export function proposalComment(editor, proposal) {
  const passage = proposalPassage(editor, proposal);
  const thread = editor.threads?.find((item) => item.id === proposal.threadId);
  const original = thread?.messages?.find((message) => !message.proposal && message.authorId === "root:master")
    ?? thread?.messages?.find((message) => !message.proposal)
    ?? thread?.messages?.find((message) => message.authorId === "root:master");
  return passage && original?.text?.trim() ? { anchor: passage.anchor, text: original.text } : null;
}

export function renderProposal(document, proposal, { editor, t, actions = {}, discussion = null } = {}) {
  const stale = editor && proposal.state === "pending" && proposalStale(editor, proposal);
  const block = element(document, "article", { class: `void-suggestion${stale ? " is-stale" : ""}`, "data-proposal": proposal.id, "data-state": proposal.state });
  if (discussion) block.append(discussion);
  else block.append(line(document, proposal.expectedText), line(document, proposal.replacement), line(document, proposal.createdBy));
  if (!t || proposal.state !== "pending") return block;
  if (stale) {
    block.setAttribute("data-proposal-stale", "true");
    block.append(element(document, "div", { class: "void-suggestion-warning", role: "alert" },
      element(document, "div", { class: "void-suggestion-heading" }, icon(document, "alert"), element(document, "strong", { text: t("suggestionStale") })),
      element(document, "p", { text: t("suggestionNotApplied") })));
  } else if (editor?.proposalDrafts?.has(proposal.id)) {
    const input = element(document, "textarea", { class: "void-suggestion-edit", "data-proposal-draft": proposal.id, "data-keep": `proposal:${proposal.id}`, "aria-label": t("edit"),
      disabled: actions.busy ? "" : null });
    input.value = editor.proposalDrafts.get(proposal.id);
    input.addEventListener("input", () => editProposal(editor, proposal, input.value));
    block.append(input);
  }
  const row = element(document, "div", { class: "void-suggestion-actions" });
  for (const [action, label, primary] of stale ? [["edit-passage", "editPassage", true], ["ask-again", "askAgain", false], ["discard", "discard", false]]
    : [["accept-change", "acceptChange", true], ["edit-change", "edit", false], ["discard", "discard", false]]) {
    if (typeof actions[action] !== "function") continue;
    row.append(element(document, "button", { type: "button", class: `btn${primary ? " primary" : ""}`, "data-action": action, "data-proposal-id": proposal.id,
      disabled: actions.busy ? "" : null, text: t(label), onclick: actions[action] }));
  }
  block.append(row);
  return block;
}

export async function loadProposals(api, editors) {
  const current = editors.current;
  if (!current || current.kind !== "void") return current?.proposals ?? [];
  editors.proposalDrafts ??= new Map();
  current.proposalDrafts = editors.proposalDrafts.get(current.resourceId) ?? current.proposalDrafts ?? new Map();
  editors.proposalDrafts.set(current.resourceId, current.proposalDrafts);
  const ticket = (editors.proposalTicket ?? 0) + 1;
  editors.proposalTicket = ticket;
  const items = [];
  for (const state of ["pending", "accepted", "discarded"]) {
    let cursor = null;
    do {
      const result = await request(api, "GET", "/void/texts/:resourceId/proposals", {
        params: { resourceId: current.resourceId },
        query: { limit: "50", state, ...(cursor ? { cursor } : {}) },
      });
      if (editors.proposalTicket !== ticket || editors.current?.resourceId !== current.resourceId) return editors.current?.proposals ?? [];
      items.push(...(result.data.items ?? []));
      cursor = result.data.nextCursor ?? null;
    } while (cursor);
  }
  if (editors.proposalTicket !== ticket || editors.current?.resourceId !== current.resourceId) return editors.current?.proposals ?? [];
  const byId = new Map(items.map((item) => [item.id, item]));
  current.proposals = [...byId.values()];
  return current.proposals;
}

export function noteProposal(editors, data) {
  const current = editors.drafts?.get(data?.resourceId) ?? (editors.current?.resourceId === data?.resourceId ? editors.current : null);
  rememberProposal(current, data?.proposal, data?.commentsRevision);
}

export function rememberProposal(editor, proposal, commentsRevision) {
  if (!editor || !proposal?.id) return;
  const items = editor.proposals ?? [];
  const index = items.findIndex((item) => item.id === proposal.id);
  editor.proposals = index >= 0 ? items.map((item) => item.id === proposal.id ? { ...item, ...proposal } : item) : [...items, proposal];
  if (commentsRevision) editor.commentsRevision = commentsRevision;
}

export async function answerProposal(api, editor, proposal, decision, retained = null) {
  if (retained && retained.body.decision !== decision) retained = null;
  const result = await perform(api, {
    method: "POST",
    path: "/void/texts/:resourceId/proposals/:proposalId/answer",
    params: { resourceId: editor.resourceId, proposalId: proposal.id },
    body: { decision, expectedRevision: decision === "accept" ? proposal.baseRevision : editor.revision, expectedCommentsRevision: editor.commentsRevision,
      ...(decision === "accept" && editor.proposalDrafts?.has(proposal.id) ? { replacement: editor.proposalDrafts.get(proposal.id) } : {}) },
  }, retained);
  acceptText(editor, result.data.editor ?? result.data);
  rememberProposal(editor, result.data.proposal, result.data.editor?.commentsRevision ?? result.data.commentsRevision);
  editor.proposalDrafts?.delete(proposal.id);
  editor.staleProposals?.delete(proposal.id);
  return result;
}

export function enterFocus(state) {
  state.mode = "focus";
  state.tools = false;
  return state;
}

export function leaveFocus(state) {
  state.mode = "document";
  state.tools = true;
  return state;
}

export function moveFocus(state, key) {
  const order = (state.pages ?? []).map((page) => page.k);
  const index = Math.max(0, order.indexOf(state.page));
  if (key === "ArrowLeft" || key === "ArrowUp") state.page = order[Math.max(0, index - 1)] ?? state.page;
  if (key === "ArrowRight" || key === "ArrowDown") state.page = order[Math.min(order.length - 1, index + 1)] ?? state.page;
  state.tools = false;
  return state;
}

export function showTools(state) {
  state.tools = true;
  return state;
}

export function textAnchor(editor, k, lang, plainStart, plainEnd) {
  const source = textDraft(editor, editor.resourceId, k, lang) ?? (editor.authoritative?.document ?? editor.document).pages.find((page) => page.k === k)[lang];
  return createTextAnchor(source, k, lang, plainStart, plainEnd);
}

export function visibleText(source) {
  return plainText(source);
}

export const TEXT_FORMATS = ["bold", "italic", "strikethrough", "h1", "h2", "h3", "list", "quote", "code", "link", "table", "image", "comment"];

export function formatSelection(source, range, format, target = "") {
  if (!range || range.end <= range.start || !validUtf16Boundary(plainText(source), range.start) || !validUtf16Boundary(plainText(source), range.end)) return null;
  let start = sourceBoundary(source, range.start, "end"), end = sourceBoundary(source, range.end, "start");
  if (start == null || end == null || end < start) return null;
  let value = source.slice(start, end), replacement;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const marks = { bold: "**", italic: "_", strikethrough: "~~" };
  const inlineLines = (wrap) => value.split(/(\r\n|\r|\n)/).map((line) => {
    if (!line || /^[\r\n]+$/.test(line)) return line;
    const prefix = /^(?:#{1,3}|[-+*]|\d+\.|>)\s+/.exec(line)?.[0] ?? "";
    return prefix + wrap(line.slice(prefix.length));
  }).join("");
  if (marks[format]) replacement = inlineLines((line) => marks[format] + line + marks[format]);
  else if (["h1", "h2", "h3", "list", "quote"].includes(format)) {
    start = source.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = source.indexOf("\n", Math.max(start, end - 1));
    end = lineEnd < 0 ? source.length : source[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    value = source.slice(start, end);
    const prefix = format[0] === "h" ? "#".repeat(Number(format[1])) + " " : format === "list" ? "- " : "> ";
    replacement = value.split(/\r?\n/).map((line) => prefix + line.replace(/^(?:#{1,3}|[-+*]|\d+\.|>)\s+/, "")).join(newline);
  } else if (format === "code") replacement = value.includes("\n") || value.includes("`") ? "```" + newline + value + newline + "```" : "`" + value + "`";
  else if (format === "link" || format === "image") {
    if (!(format === "link" ? validLink(target) : assetIdentity(target))) throw new RangeError("The target is not valid.");
    replacement = inlineLines((line) => (format === "image" ? "!" : "") + "[" + line.replace(/[\\\[\]]/g, "\\$&") + "](" + target + ")");
  } else if (format === "table") {
    const rows = value.split(/\r?\n/).map((line) => line.split("\t").map((cell) => cell.replaceAll("|", "\\|")));
    const count = Math.max(2, ...rows.map((row) => row.length));
    const rowText = (row) => "| " + Array.from({ length: count }, (_, i) => row[i] ?? "").join(" | ") + " |";
    replacement = [rowText(rows[0]), rowText(Array(count).fill("---")), ...rows.slice(1).map(rowText)].join(newline);
  } else return null;
  return { source: source.slice(0, start) + replacement + source.slice(end), start, end: start + replacement.length };
}

export function replaceVisible(source, range, value) {
  const visible = plainText(source);
  if (!range || range.end < range.start || !validUtf16Boundary(visible, range.start) || !validUtf16Boundary(visible, range.end)) throw new RangeError("The selection splits a character.");
  const caretToken = tokenizeMarkup(source).find((token) => token.type === "text" && range.start >= token.plainStart && range.start <= token.plainEnd);
  const at = range.start === range.end && validUtf16Boundary(source, range.sourceStart) ? range.sourceStart
    : range.start === range.end && caretToken ? caretToken.boundaries?.[range.start - caretToken.plainStart] ?? caretToken.sourceStart + range.start - caretToken.plainStart
    : sourceBoundary(source, range.start, "end");
  if (at == null) return { source: value, start: value.length, end: value.length };
  const changes = [];
  for (const token of tokenizeMarkup(source)) {
    if (token.type !== "text") continue;
    const start = Math.max(range.start, token.plainStart), end = Math.min(range.end, token.plainEnd);
    if (end <= start) continue;
    const from = token.boundaries?.[start - token.plainStart] ?? token.sourceStart + start - token.plainStart;
    const to = token.boundaries?.[end - token.plainStart] ?? token.sourceStart + end - token.plainStart;
    changes.push({ start: from, end: to });
  }
  let next = source;
  for (const change of changes.reverse()) next = next.slice(0, change.start) + next.slice(change.end);
  const inserted = String(value).replace(/\r\n?|\n/g, source.includes("\r\n") ? "\r\n" : "\n").replace(/[\\`*_~[\]]/g, "\\$&");
  next = next.slice(0, at) + inserted + next.slice(at);
  return { source: next, start: at + inserted.length, end: at + inserted.length };
}

export function captureTextSelection(document, host, editor, source, sourceMode = false) {
  let range;
  if (sourceMode) range = { start: host.selectionStart ?? 0, end: host.selectionEnd ?? 0, backward: host.selectionDirection === "backward" };
  else {
    const selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
    if (!selection?.anchorNode || !host.contains?.(selection.anchorNode) || !host.contains?.(selection.focusNode)) return null;
    const plain = plainOffsets(selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset);
    if (!plain) return null;
    const previous = editor.textSelections?.get(textDraftKey(editor.resourceId, editor.page, editor.language));
    const tokens = tokenizeMarkup(source);
    const point = (offset, affinity) => {
      const run = tokens.find((token) => token.type === "text" && offset >= token.plainStart && offset <= token.plainEnd);
      return run ? run.boundaries?.[offset - run.plainStart] ?? run.sourceStart + offset - run.plainStart : sourceBoundary(source, offset, affinity);
    };
    const start = previous && plainCaretFromSource(tokens, previous.start) === plain.start ? previous.start : point(plain.start, "end");
    const end = previous && plainCaretFromSource(tokens, previous.end) === plain.end ? previous.end : point(plain.end, "start");
    range = { start, end, backward: plainOffsets(selection.anchorNode, selection.anchorOffset, selection.anchorNode, selection.anchorOffset)?.start > plain.start };
  }
  if (!validUtf16Boundary(source, range.start) || !validUtf16Boundary(source, range.end)) return null;
  editor.textSelections ??= new Map();
  editor.textSelections.set(textDraftKey(editor.resourceId, editor.page, editor.language), range);
  return range;
}

export function restoreTextSelection(document, host, editor, source, sourceMode = false) {
  const range = editor.textSelections?.get(textDraftKey(editor.resourceId, editor.page, editor.language));
  if (!range || !validUtf16Boundary(source, range.start) || !validUtf16Boundary(source, range.end)) return false;
  host.focus?.();
  if (sourceMode) { host.setSelectionRange?.(range.start, range.end, range.backward ? "backward" : "forward"); return true; }
  const tokens = tokenizeMarkup(source), start = plainCaretFromSource(tokens, range.start), end = plainCaretFromSource(tokens, range.end);
  const nodes = [];
  const walk = (node) => { if (runMetadata(node)) nodes.push(node); else for (const child of node.childNodes ?? node.children ?? []) walk(child); };
  walk(host);
  const point = (offset) => {
    for (const node of nodes) { const run = runMetadata(node); if (offset >= run.plainStart && offset <= run.plainEnd) return [node, offset - run.plainStart]; }
    return [host, 0];
  };
  const a = point(start), b = point(end), selection = document.getSelection?.() ?? document.defaultView?.getSelection?.();
  if (selection?.setBaseAndExtent) selection.setBaseAndExtent(...(range.backward ? b : a), ...(range.backward ? a : b));
  else if (document.createRange && selection?.addRange) {
    const domRange = document.createRange(); domRange.setStart(...a); domRange.setEnd(...b); selection.removeAllRanges(); selection.addRange(domRange);
  }
  return true;
}

// One controller serializes every page/language of a resource under its revision.
export function documentSaver(api, editor, onState = () => {}, delayMs = 400) {
  return continuousSave({ revision: editor.revision, delayMs, onState: (state) => { editor.saveState = state.state; onState(state); }, save: async (snapshot, revision, retained) => {
    const { document, generation, drafts } = JSON.parse(snapshot);
    editor.boardSaving = { document: { ...document, rev: (editor.authoritative?.document?.rev ?? 0) + 1 } };
    try {
      const result = await replaceDocument(api, editor, document, retained, revision);
      if ((editor.editGeneration ?? 0) === generation) {
        for (const [key, value] of drafts) if (editor.textDrafts?.get(key) === value) editor.textDrafts.delete(key);
        if (editor.titleDraft === document.title) delete editor.titleDraft;
      }
      if (!editor.textDrafts?.size) { editor.draftText = ""; editor.draftKey = null; }
      editor.dirty = Boolean(editor.textDrafts?.size) || (editor.editGeneration ?? 0) !== generation;
      return result;
    } catch (failure) {
      if (failure.code === "revision_conflict") editor.conflict ??= { code: failure.code };
      throw failure;
    } finally { editor.boardSaving = null; }
  } });
}

export function draftSnapshot(editor) {
  const document = structuredClone(editor.authoritative?.document ?? editor.document);
  if (editor.titleDraft !== undefined) document.title = editor.titleDraft;
  for (const page of document.pages) for (const lang of Object.keys(page)) {
    const value = textDraft(editor, editor.resourceId, page.k, lang);
    if (value !== undefined) page[lang] = value;
  }
  return JSON.stringify({ document, generation: editor.editGeneration ?? 0, drafts: [...(editor.textDrafts ?? [])] });
}

function acceptText(editor, data) {
  if (!data?.document && !data?.revision) return;
  const rest = { ...data };
  delete rest.proposals;
  editor.revision = rest.revision ?? editor.revision;
  editor.commentsRevision = rest.commentsRevision ?? editor.commentsRevision;
  editor.authoritative = { ...editor.authoritative, ...rest };
  delete editor.authoritative.proposals;
  editor.document = rest.document ?? editor.document;
  editor.baseRevision = rest.revision ?? editor.baseRevision;
}

function line(document, value) {
  const node = document.createElement("p");
  node.textContent = String(value ?? "");
  return node;
}

export function continuousSave({ save, revision, onState = () => {}, delayMs = 400 }) {
  let value = '';
  let generation = 0;
  let savedGeneration = 0;
  let attempt = null;
  let operation = null;
  let error = null;
  let timer = null;
  let running = null;
  let closed = false;
  function report(state) { if (!closed) onState({ state, value, generation, revision, error }); }
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (closed) return Promise.resolve();
    if (running) return running;
    if (error) return Promise.reject(error);
    running = (async () => {
      while (!closed && savedGeneration < generation) {
        attempt ??= { value, generation, revision };
        report('saving');
        try {
          const result = await save(attempt.value, attempt.revision, operation);
          const editor = result.data?.editor ?? result.data ?? result;
          revision = editor.revision ?? revision;
          savedGeneration = attempt.generation;
          attempt = null;
          operation = null;
        } catch (failure) {
          error = failure;
          operation = failure.operation ?? operation;
          report('not-saved');
          throw failure;
        }
      }
      report('saved');
    })().finally(() => { running = null; });
    return running;
  }
  return {
    queue(nextValue) {
      value = nextValue;
      generation += 1;
      report(error ? 'not-saved' : 'saving');
      clearTimeout(timer);
      if (!error && !closed) timer = setTimeout(() => { void flush().catch(() => {}); }, delayMs);
    },
    flush,
    retry() { error = null; return flush(); },
    dispose() { closed = true; clearTimeout(timer); timer = null; },
    get dirty() { return savedGeneration < generation; },
  };
}

export function findTextMatches(source, query, { caseSensitive = false, wholeWord = false, regularExpression = false } = {}) {
  if (!query) return [];
  const pattern = regularExpression ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
  const word = (value) => /[\p{L}\p{M}\p{N}_]/u.test(value ?? '');
  const matches = [];
  for (const match of source.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!match[0].length) continue;
    if (wholeWord && (word([...source.slice(Math.max(0, start - 2), start)].at(-1)) || word([...source.slice(end, end + 2)].at(0)))) continue;
    matches.push({ start, end, text: match[0], captures: match.slice(1) });
    if (matches.length > 10000) throw new RangeError('Too many matches.');
  }
  return matches;
}

export function createTextFinder({ createWorker = () => new Worker(new URL('./find-worker.mjs', import.meta.url), { type: 'module' }) } = {}) {
  let generation = 0, active = null;
  function cancel() {
    generation += 1;
    active?.cancel();
    active = null;
  }
  return {
    cancel,
    async find(api, editor, query, options, scope = 'document') {
      cancel();
      const ticket = generation;
      const check = () => { if (ticket !== generation) throw Object.assign(new Error('Search canceled.'), { code: 'canceled' }); };
      if (!query) return [];
      const controller = new AbortController();
      let worker = null, pending = null, sequence = 0;
      const stop = () => { controller.abort(); worker?.terminate(); pending?.(Object.assign(new Error('Search canceled.'), { code: 'canceled' })); };
      const operation = { cancel: stop };
      active = operation;
      const matches = [];
      try {
        const sources = [];
        if (scope === 'all') {
          let cursor = null;
          do {
            const result = await request(api, 'GET', '/void/texts', { query: { limit: '50', ...(cursor ? { cursor } : {}) }, signal: controller.signal });
            check();
            sources.push(...result.data.items.filter((item) => !item.readOnly));
            cursor = result.data.nextCursor ?? null;
          } while (cursor);
        } else sources.push({ id: editor.resourceId });
        worker = createWorker();
        const run = (text) => new Promise((resolve, reject) => {
          const id = `${ticket}:${++sequence}`;
          const finish = (error, value) => { clearTimeout(timer); pending = null; error ? reject(error) : resolve(value); };
          pending = (error) => finish(error);
          const timer = setTimeout(() => {
            worker.terminate();
            finish(Object.assign(new Error('The pattern took too long.'), { code: 'pattern_too_slow' }));
          }, 100);
          worker.onmessage = ({ data }) => {
            if (ticket !== generation || data.id !== id) return;
            finish(data.error ? Object.assign(new Error(data.error.message), { code: data.error.code }) : null, data.matches);
          };
          worker.onerror = () => finish(Object.assign(new Error('The search worker failed.'), { code: 'find_unavailable' }));
          worker.postMessage({ id, text, query, options });
        });
        for (const summary of sources) {
          check();
          const data = summary.id === editor.resourceId ? editor.authoritative ?? editor
            : (await request(api, 'GET', '/void/texts/:resourceId', { params: { resourceId: summary.id }, signal: controller.signal })).data;
          check();
          for (const page of data.document?.pages ?? []) for (const [lang, source] of Object.entries(page)) {
            if (!/^[a-z]{2,3}$/.test(lang) || lang === 'k' || typeof source !== 'string') continue;
            const visible = plainText(source), hits = await run(visible);
            check();
            for (const match of hits) {
              if (!validUtf16Boundary(visible, match.start) || !validUtf16Boundary(visible, match.end)) continue;
              matches.push({ ...match, resourceId: summary.id, k: page.k, lang, source,
                expectedRevision: data.revision, commentsRevision: data.commentsRevision ?? null });
              if (matches.length > 10000) throw Object.assign(new RangeError('Too many matches.'), { code: 'too_many_matches' });
            }
          }
        }
        return matches;
      } finally {
        worker?.terminate();
        if (active === operation) active = null;
      }
    },
  };
}

// Numbered captures follow String.replace semantics; unmatched groups are empty.
export function matchReplacement(match, replacement, regularExpression, visible = null) {
  if (!regularExpression) return replacement;
  visible ??= plainText(match.source);
  return replacement.replace(/\$(\$|&|`|'|[0-9]{1,2})/g, (value, token) => {
    if (token === '$') return '$';
    if (token === '&') return match.text;
    if (token === '`') return visible.slice(0, match.start);
    if (token === "'") return visible.slice(match.end);
    const index = Number(token);
    if (index > 0 && index <= match.captures.length) return match.captures[index - 1] ?? '';
    if (token.length === 2 && Number(token[0]) > 0 && Number(token[0]) <= match.captures.length) return (match.captures[Number(token[0]) - 1] ?? '') + token[1];
    return value;
  });
}

export function replacementItems(matches, replacement, regularExpression = false) {
  const expectedCommentsRevisions = {};
  const pages = new Map();
  for (const group of Map.groupBy(matches, (match) => `${match.resourceId}\0${match.k}\0${match.lang}`).values()) {
    const source = group[0].source, tokens = tokenizeMarkup(source), visible = tokens.filter((token) => token.type === 'text').map((token) => token.text).join('');
    const offsets = [...new Set(group.flatMap((match) => [match.start, match.end]))].sort((a, b) => a - b);
    const starts = new Map(), ends = new Map(), tags = new Set(), text = [];
    const lowerBound = (values, offset, key = (value) => value) => {
      let low = 0, high = values.length;
      while (low < high) { const middle = (low + high) >>> 1; if (key(values[middle]) < offset) low = middle + 1; else high = middle; }
      return low;
    };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type === 'tag') {
        if (token.sourceEnd > token.sourceStart) {
          starts.set(token.plainStart, token.sourceEnd);
          if (!tags.has(token.plainStart)) ends.set(token.plainStart, token.sourceStart);
          tags.add(token.plainStart);
        }
        continue;
      }
      text.push({ ...token, escape: tokens[index - 1]?.text === '\\' && tokens[index - 1].sourceEnd === token.sourceStart ? tokens[index - 1].sourceStart : null });
      for (let at = lowerBound(offsets, token.plainStart); at < offsets.length && offsets[at] <= token.plainEnd; at++) {
        const offset = offsets[at], boundary = token.boundaries?.[offset - token.plainStart] ?? token.sourceStart + offset - token.plainStart;
        if (!starts.has(offset)) starts.set(offset, boundary);
        if (!ends.has(offset)) ends.set(offset, boundary);
      }
    }
    pages.set(group[0], { source, visible, starts, ends, text, lowerBound, newline: source.includes('\r\n') ? '\r\n' : '\n' });
    for (const match of group) pages.set(match, pages.get(group[0]));
  }
  const items = matches.map((match) => {
    const page = pages.get(match), { source, visible, starts, ends, text, lowerBound } = page;
    let start = starts.get(match.start), end = ends.get(match.end);
    const first = lowerBound(text, match.start + 1, (token) => token.plainEnd);
    if (text[first]?.escape !== null && match.start === text[first]?.plainStart) start = text[first].escape;
    if (!validUtf16Boundary(visible, match.start) || !validUtf16Boundary(visible, match.end) || !validUtf16Boundary(source, start) || !validUtf16Boundary(source, end) || end <= start) throw new RangeError('The match has no safe source range.');
    let at = start;
    const kept = [];
    for (let index = first; index < text.length && text[index].plainStart < match.end; index++) {
      const token = text[index], from = Math.max(match.start, token.plainStart), to = Math.min(match.end, token.plainEnd);
      const left = from === token.plainStart && token.escape !== null ? token.escape : token.boundaries?.[from - token.plainStart] ?? token.sourceStart + from - token.plainStart;
      const right = token.boundaries?.[to - token.plainStart] ?? token.sourceStart + to - token.plainStart;
      kept.push(source.slice(at, left)); at = right;
    }
    kept.push(source.slice(at, end));
    const inserted = matchReplacement(match, replacement, regularExpression, visible).replace(/\r\n?|\n/g, page.newline).replace(/[\\`*_~[\]]/g, '\\$&');
    expectedCommentsRevisions[match.resourceId] = match.commentsRevision;
    return { resourceId: match.resourceId, k: match.k, lang: match.lang, start, end,
      expectedText: source.slice(start, end), replacement: inserted + kept.join(''), expectedRevision: match.expectedRevision };
  });
  return { items, expectedCommentsRevisions };
}

export async function replaceMatches(api, editors, matches, replacement, regularExpression = false, retained = null) {
  const result = await perform(api, { method: 'POST', path: '/void/replace', body: retained?.body ?? replacementItems(matches, replacement, regularExpression) }, retained);
  acceptReplace(editors, result.data.editors);
  return result;
}

export async function undoReplace(api, editors, changeId, retained = null) {
  const result = await perform(api, { method: 'POST', path: '/void/replace/:changeId/undo', params: { changeId }, body: {} }, retained);
  acceptReplace(editors, result.data.editors);
  return result;
}

function acceptReplace(editors, values) {
  for (const value of values) {
    const current = editors.drafts?.get(value.id) ?? (editors.current?.resourceId === value.id ? editors.current : null);
    if (current) { current.voidSaver?.dispose(); current.voidSaver = null; acceptText(current, value); }
    const summary = editors.catalog?.find((item) => item.id === value.id);
    if (summary) Object.assign(summary, { revision: value.revision, libraryRevision: value.libraryRevision });
  }
}

export function highlightFind(document, host, matches, current, name = 'void-find') {
  const css = document.defaultView?.CSS ?? globalThis.CSS, HighlightType = document.defaultView?.Highlight ?? globalThis.Highlight;
  if (!css?.highlights || !HighlightType || !document.createRange) return;
  const nodes = [];
  const walk = (node) => { if (runMetadata(node)) nodes.push(node); else for (const child of node.childNodes ?? node.children ?? []) walk(child); };
  walk(host);
  const ranges = [], selected = [];
  for (const match of matches) {
    const first = nodes.find((node) => { const run = runMetadata(node); return match.start >= run.plainStart && match.start < run.plainEnd; });
    const last = nodes.find((node) => { const run = runMetadata(node); return match.end > run.plainStart && match.end <= run.plainEnd; });
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first, match.start - runMetadata(first).plainStart); range.setEnd(last, match.end - runMetadata(last).plainStart);
    ranges.push(range); if (match === current) selected.push(range);
  }
  css.highlights.set(name, new HighlightType(...ranges));
  if (name === 'void-find') css.highlights.set('void-current', new HighlightType(...selected));
}
