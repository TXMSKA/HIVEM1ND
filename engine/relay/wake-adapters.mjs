import { wakeAdapter as claude } from './claude-wake.mjs';
import { wakeAdapter as codex } from './codex-wake.mjs';
import { wakeAdapter as cursor } from './cursor-wake.mjs';
import { wakeAdapter as opencode } from './opencode-wake.mjs';
import { wakeAdapter as nova } from './host-wake.mjs';
import { wakeAdapter as antigravity } from './antigravity-wake.mjs';

// Resolve lazily: native modules also use shared worker helpers that read this
// table at runtime. Importing a native module directly must work as well.
export const WAKE_ADAPTERS = Object.freeze({
  get claude() { return claude; },
  get codex() { return codex; },
  get cursor() { return cursor; },
  get opencode() { return opencode; },
  get nova() { return nova; },
  get antigravity() { return antigravity; },
});

export function getWakeAdapter(client, adapters = WAKE_ADAPTERS) {
  return Object.hasOwn(adapters, client) ? adapters[client] : null;
}
