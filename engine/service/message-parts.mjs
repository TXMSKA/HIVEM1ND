// The parts a message carries beside its text. Five kinds are shown under the text in a chat: a picture kept in the
// message assets of the mind, a web or mail link, a Blueprint board, a Void text and a task. Any other kind, or none,
// stays the plain reference attachments always were. A part is a reference, never a command.

export const MESSAGE_ASSETS = 'user/relay/assets';
export const ASSET_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;
export const PART_KINDS = Object.freeze(['image', 'link', 'board', 'text', 'task']);
export const ASSET_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const ASSET_MAX_BYTES = 10_000_000;

const PATH_MAX = 2048;
const KIND_MAX = 64;
const LABEL_MAX = 120;
const CONTROL = /[\u0000-\u001f\u007f]/;
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINK = /^(?:https?:\/\/[^\s/?#@\\]+(?:[/?#][^\s\\]*)?|mailto:[^\s@\\]+@[^\s@\\]+)$/i;

// The part in its stored shape, {path, kind, label?}, or a thrown error from `fail` with the reason in plain words.
export function messagePart(item, fail) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('An attachment must be an object with a path.');
  const { path, kind = null, label = null } = item;
  if (typeof path !== 'string' || path.length < 1 || path.length > PATH_MAX || CONTROL.test(path)) {
    fail(`An attachment needs a single-line path of at most ${PATH_MAX} characters.`);
  }
  if (kind !== null && (typeof kind !== 'string' || kind.length > KIND_MAX || CONTROL.test(kind))) fail('An attachment kind must be a short single-line text.');
  if (label !== null && (typeof label !== 'string' || label.length > LABEL_MAX || CONTROL.test(label))) {
    fail(`An attachment label must be single-line text of at most ${LABEL_MAX} characters.`);
  }
  if (kind === 'image' && !ASSET_NAME.test(path)) fail('An image attachment names a stored message asset.');
  if (kind === 'link' && !LINK.test(path)) fail('A link attachment needs an http, https or mailto address.');
  if ((kind === 'board' || kind === 'text') && !RESOURCE_ID.test(path)) fail(`A ${kind} attachment needs the id of a ${kind === 'board' ? 'Blueprint board' : 'Void text'}.`);
  // A task part is a button when it names a canonical task id; an older task reference names the task file and stays a
  // plain reference, as it always was.
  const shown = typeof label === 'string' ? label.trim() : '';
  return { path, kind, ...(shown ? { label: shown } : {}) };
}
