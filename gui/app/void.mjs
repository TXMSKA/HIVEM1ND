import { createOperation, request } from "./api.mjs";
import { boundaryInsideTag, createTextAnchor, plainOffsets, plainText, rangeRequest, renderMarkup, validUtf16Boundary } from "./markup.mjs";

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
  const source = page[block.dataset.language] ?? "";
  if (editor.focus?.k === page.k) {
    block.dataset.highlight = "true";
    if (Number.isInteger(editor.focus.start) && Number.isInteger(editor.focus.end)) block.dataset.range = `${editor.focus.start}:${editor.focus.end}`;
    if (editor.focus.lang) block.dataset.language = editor.focus.lang;
  }
  block.append(renderMarkup(document, source));
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

export async function saveRange(api, editor, k, lang, start, end, replacement) {
  const body = rangeRequest({ document: editor.authoritative?.document ?? editor.document, revision: editor.revision }, k, lang, start, end, replacement);
  const operation = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/ranges",
    params: { resourceId: editor.resourceId },
    body,
  });
  const result = await request(api, "POST", operation.path, { operation });
  const saved = result.data?.editor;
  acceptText(editor, saved);
  if (saved?.document || saved?.revision) {
    editor.dirty = false;
    editor.conflict = null;
  }
  return result;
}

export async function replaceDocument(api, editor, document) {
  const next = structuredClone(document);
  delete next.rev;
  delete next.history;
  const operation = createOperation({
    method: "PUT",
    path: "/void/texts/:resourceId",
    params: { resourceId: editor.resourceId },
    body: { document: next, expectedRevision: editor.revision },
  });
  const result = await request(api, "PUT", operation.path, { operation });
  acceptText(editor, result.data);
  editor.dirty = false;
  editor.conflict = null;
  return result;
}

export function renderProposal(document, proposal) {
  const block = document.createElement("article");
  block.dataset.proposal = proposal.id;
  block.dataset.state = proposal.state;
  block.append(line(document, proposal.expectedText), line(document, proposal.replacement), line(document, proposal.createdBy));
  return block;
}

export async function loadProposals(api, editors) {
  const current = editors.current;
  if (!current || current.kind !== "void") return current?.proposals ?? [];
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

export async function answerProposal(api, editor, proposal, decision) {
  const operation = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/proposals/:proposalId/answer",
    params: { resourceId: editor.resourceId, proposalId: proposal.id },
    body: { decision, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision },
  });
  const result = await request(api, "POST", operation.path, { operation });
  acceptText(editor, result.data.editor ?? result.data);
  rememberProposal(editor, result.data.proposal, result.data.editor?.commentsRevision ?? result.data.commentsRevision);
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
  const source = (editor.authoritative?.document ?? editor.document).pages.find((page) => page.k === k)[lang];
  return createTextAnchor(source, k, lang, plainStart, plainEnd);
}

export function visibleText(source) {
  return plainText(source);
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
