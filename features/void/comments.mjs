// Void: comments on a selection.
//
// A comment file is the full Void app's format, { path, threads }, with each
// thread { id, anchor, to?, status, messages }, so either app reads what the
// other wrote. Void Lite adds three fields to the anchor, because a document
// here has pages: the page key `k` and the `start` and `end` offsets of the
// quote in the page's plain text (see text.mjs). The quote with its
// surroundings finds the words again after the page is edited; the offsets say
// which copy was meant when the words repeat.

import { randomUUID } from 'node:crypto';
import { plain } from './text.mjs';

export const PERSON = 'person';
export const MAX_COMMENT = 4000;
const CONTEXT = 48;
// A longer quote is looked for as it was written and is not matched by similarity.
const MAX_FUZZY = 1000;

export function emptyComments(name) {
  return { path: name, threads: [] };
}

export function createAnchor(text, start, end, lang, k) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) throw new RangeError('Invalid comment selection');
  return {
    lang,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    k,
    start,
    end,
  };
}

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j])));
    previous = next;
  }
  return previous[b.length];
}

function context(text, start, end, anchor) {
  let score = 0;
  for (let i = 1; i <= anchor.prefix.length && start >= i && text[start - i] === anchor.prefix.at(-i); i++) score++;
  for (let i = 0; i < anchor.suffix.length && text[end + i] === anchor.suffix[i]; i++) score++;
  return score;
}

// The exact quote wins; when it repeats, the copy with the most matching
// surroundings, then the one nearest the offset it was made at. A quote that
// is gone is looked for by similarity, as the full app does, word by word.
export function findAnchor(text, anchor) {
  const quote = anchor.quote;
  if (!quote) return null;
  const near = Number.isInteger(anchor.start) ? anchor.start : 0;
  const exact = [];
  for (let start = text.indexOf(quote); start >= 0; start = text.indexOf(quote, start + 1)) exact.push({ start, end: start + quote.length, exact: true });
  if (exact.length) {
    return exact.sort((a, b) => context(text, b.start, b.end, anchor) - context(text, a.start, a.end, anchor)
      || Math.abs(a.start - near) - Math.abs(b.start - near))[0];
  }
  if (quote.length > MAX_FUZZY) return null;
  const lowered = quote.toLocaleLowerCase();
  const words = [...text.matchAll(/\S+/gu)];
  const quoted = lowered.match(/\S+/gu) ?? [];
  if (!quoted.length) return null;
  const letters = (word) => word.replace(/[^\p{L}\p{N}]/gu, '');
  const survivors = new Set(quoted.map(letters).filter((word) => word.length > 2));
  const candidates = new Set();
  words.forEach((word, index) => {
    if (survivors.has(letters(word[0].toLocaleLowerCase()))) {
      for (let offset = 0; offset < quoted.length && offset <= index; offset++) candidates.add(index - offset);
    }
  });
  const lines = (value) => value.split('\n').length;
  const slack = Math.max(2, Math.ceil(quoted.length * 0.35));
  let best = null;
  let bestScore = 0.66;
  for (const index of candidates) {
    const start = words[index].index;
    for (let count = Math.max(1, quoted.length - slack); count <= quoted.length + slack && index + count <= words.length; count++) {
      const last = words[index + count - 1];
      const end = last.index + last[0].length;
      const candidate = text.slice(start, end).toLocaleLowerCase();
      if (candidate.length > lowered.length * 1.6 || candidate.length < lowered.length * 0.6 || lines(candidate) > lines(lowered)) continue;
      const similarity = 1 - distance(lowered, candidate) / Math.max(lowered.length, candidate.length);
      if (similarity < 0.67) continue;
      const score = similarity + context(text, start, end, anchor) / 10000;
      if (score > bestScore) { bestScore = score; best = { start, end, exact: false }; }
    }
  }
  return best;
}

// Where a thread sits in the page now, or null when the words are gone, the
// page no longer exists or the thread was not made on a page of this document.
export function place(pages, thread) {
  const anchor = thread.anchor;
  const page = pages.find((p) => p.k === anchor?.k);
  if (!page || typeof page[anchor.lang] !== 'string') return null;
  const found = findAnchor(plain(page[anchor.lang]), anchor);
  return found && { start: found.start, end: found.end, exact: found.exact };
}

export function addThread(comments, { anchor, text, to, now = new Date() }) {
  const thread = {
    id: randomUUID(),
    anchor,
    ...(to ? { to } : {}),
    status: 'open',
    messages: [{ author: PERSON, at: now.toISOString(), text }],
  };
  comments.threads.push(thread);
  return thread;
}

// A reply to a resolved thread opens it again, as it is the person speaking in it.
export function addReply(comments, id, text, now = new Date()) {
  const thread = comments.threads.find((t) => t.id === id);
  if (!thread) return null;
  thread.messages.push({ author: PERSON, at: now.toISOString(), text });
  thread.status = 'open';
  return thread;
}

export function setStatus(comments, id, status) {
  const thread = comments.threads.find((t) => t.id === id);
  if (!thread || (status !== 'open' && status !== 'resolved')) return null;
  thread.status = status;
  return thread;
}

export function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text && text.length <= MAX_COMMENT ? text : null;
}

const quoted = (text) => text.split('\n').map((line) => `> ${line}`).join('\n');

// The Relay message for a new comment or a reply: the selection, the comment,
// and where in the document they are. The comments file travels as the attachment.
export function commentMessage({ title, thread, file, commentsFile, page, reply }) {
  const { anchor } = thread;
  const text = plain(page?.[anchor.lang] ?? '');
  const found = findAnchor(text, anchor);
  const line = found ? `, line ${text.slice(0, found.start).split('\n').length}` : '';
  const last = thread.messages.at(-1);
  const earlier = thread.messages.slice(0, -1);
  const body = [
    `${reply ? 'Reply on a comment' : 'Comment'} in "${title}", page ${anchor.k}, ${anchor.lang} text${line}.`,
    '',
    'Selected text:',
    quoted(anchor.quote),
    ...(earlier.length ? ['', 'Earlier in this thread:', ...earlier.map((m) => `${m.author}: ${m.text}`)] : []),
    '',
    reply ? 'Reply:' : 'Comment:',
    last.text,
    '',
    `Document: ${file}`,
    `Comments file: ${commentsFile} (thread ${thread.id})`,
  ].join('\n');
  return { subject: `Void comment: ${title} / ${anchor.k}`, body };
}
