import { createOperation, request } from "./api.mjs";
import { createTextAnchor, plainText, rangeRequest, renderMarkup } from "./markup.mjs";

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
  block.append(renderMarkup(document, source));
  host.append(block);
}

export function beginTextEdit(editor, k, lang) {
  const source = editor.document?.pages?.find((page) => page.k === k)?.[lang] ?? editor.authoritative?.document?.pages?.find((page) => page.k === k)?.[lang] ?? "";
  editor.draftText = source;
  editor.draftKey = { k, lang };
  editor.dirty = true;
  return editor.draftText;
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
  acceptText(editor, result.data);
  editor.dirty = false;
  editor.conflict = null;
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

export async function answerProposal(api, editor, proposal, decision) {
  const operation = createOperation({
    method: "POST",
    path: "/void/texts/:resourceId/proposals/:proposalId/answer",
    params: { resourceId: editor.resourceId, proposalId: proposal.id },
    body: { decision, expectedRevision: editor.revision, expectedCommentsRevision: editor.commentsRevision },
  });
  const result = await request(api, "POST", operation.path, { operation });
  acceptText(editor, result.data.editor ?? result.data);
  const next = result.data.proposal;
  editor.proposals = (editor.proposals ?? editor.authoritative?.proposals ?? []).map((item) => item.id === next.id ? next : item);
  if (editor.authoritative) editor.authoritative.proposals = editor.proposals;
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
  editor.revision = data.revision ?? editor.revision;
  editor.commentsRevision = data.commentsRevision ?? editor.commentsRevision;
  editor.authoritative = { ...editor.authoritative, ...data };
  editor.document = data.document ?? editor.document;
  editor.baseRevision = data.revision ?? editor.baseRevision;
}

function line(document, value) {
  const node = document.createElement("p");
  node.textContent = String(value ?? "");
  return node;
}
