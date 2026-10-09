// Void: the person's own corrections, told to the agent once.
//
// Each save that was made with "Send to agent" on is held. The agent hears of
// them in one Relay message, a fixed time after the last one, so a correction
// made in several strokes arrives as its end state and not as every step.

export const WAIT = 20000;
// Relay refuses a body over 256 KiB; the message stays well under it.
const BODY_LIMIT = 200000;

// `deliver(file, title, edits)` sends the message; `timers` is injectable so a
// test moves the clock by hand.
export function createEdits({ wait = WAIT, deliver, timers = { setTimeout, clearTimeout } }) {
  const batches = new Map();
  const running = new Set();

  function add(file, title, { k, lang, before, after }) {
    let batch = batches.get(file);
    if (!batch) batches.set(file, batch = { title, edits: new Map(), timer: null });
    batch.title = title;
    const key = `${k}\u0000${lang}`;
    batch.edits.set(key, { k, lang, before: batch.edits.get(key)?.before ?? before, after });
    timers.clearTimeout(batch.timer);
    batch.timer = timers.setTimeout(() => { flush(file); }, wait);
    batch.timer?.unref?.();
  }

  // What was typed and put back is no change, so it is not told.
  function flush(file) {
    const batch = batches.get(file);
    if (!batch) return null;
    timers.clearTimeout(batch.timer);
    batches.delete(file);
    const edits = [...batch.edits.values()].filter((edit) => edit.before !== edit.after);
    if (!edits.length) return null;
    const run = Promise.resolve(deliver(file, batch.title, edits)).catch(() => {}).finally(() => running.delete(run));
    running.add(run);
    return run;
  }

  // Turning "Send to agent" off drops what was waiting: the person said not to tell.
  function cancel(file) {
    const batch = batches.get(file);
    if (!batch) return false;
    timers.clearTimeout(batch.timer);
    batches.delete(file);
    return true;
  }

  return { add, flush, cancel, pending: (file) => batches.get(file)?.edits.size ?? 0, idle: () => Promise.all([...running]) };
}

export function editsMessage({ title, file, edits }) {
  const parts = [];
  let size = 0;
  let listed = 0;
  for (const edit of edits) {
    const part = `Page ${edit.k}, ${edit.lang} text\n\nBefore:\n${edit.before}\n\nAfter:\n${edit.after}`;
    const bytes = Buffer.byteLength(part);
    if (size + bytes > BODY_LIMIT) break;
    parts.push(part);
    size += bytes;
    listed++;
  }
  const rest = edits.length - listed;
  const body = [
    `The person corrected ${edits.length} ${edits.length === 1 ? 'text' : 'texts'} in "${title}". Each is listed with its text before and after.`,
    '',
    parts.join('\n\n---\n\n'),
    ...(rest ? ['', `${rest} more ${rest === 1 ? 'text is' : 'texts are'} not listed here; the versions file beside the document holds every change.`] : []),
    '',
    `Document: ${file}`,
  ].join('\n');
  return { subject: `Void edits: ${title}`, body };
}
