import { EventEmitter } from 'node:events';

export const MODEL = 'observed-model';
export const choice = client => ({ client, model: MODEL, effort: 'high', mode: null });

// The fake child speaks one native protocol over in-memory pipes. Every line the service writes is recorded.
export function fakeChild(onMessage, pid = 6161) {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.pid = pid; proc.exitCode = null; proc.writes = [];
  proc.stdin = { write(line) { const message = JSON.parse(line); proc.writes.push(message); queueMicrotask(() => onMessage(message, value => proc.stdout.emit('data', `${JSON.stringify(value)}\n`))); }, end() {} };
  proc.kill = () => { if (proc.exitCode != null) return; proc.killed = true; proc.exitCode = 0; proc.emit('exit', 0); };
  return proc;
}

export function configOptions() {
  return [
    { id: 'model-option', category: 'model', type: 'select', options: [{ value: MODEL }], currentValue: 'default' },
    { id: 'effort-option', category: 'thought_level', type: 'select', options: [{ value: 'high' }], currentValue: 'default' },
  ];
}

// Claude Code: the startup message opens the first turn; an interrupt control request answers when `answerInterrupt` is true.
export function claudeNative(pid) {
  const native = fakeChild((message, send) => {
    if (message.type === 'user' && !native.started) { native.started = true; send({ type: 'system', subtype: 'init', session_id: native.nativeId, model: MODEL }); }
    if (message.type === 'control_request' && message.request?.subtype === 'interrupt' && native.answerInterrupt !== false) {
      send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id } });
    }
  }, pid);
  native.finishTurn = () => native.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success', session_id: native.nativeId })}\n`);
  return native;
}

// Cursor over ACP: a prompt stays pending until it is finished or cancelled.
export function cursorNative(pid) {
  const native = fakeChild((message, send) => {
    if (message.method === 'session/cancel') { if (native.ignoreCancel !== true) native.finishPrompt?.('cancelled'); return; }
    if (message.id == null) return;
    let result = {};
    if (message.method === 'initialize') result = { authMethods: [{ id: 'existing-login' }] };
    if (message.method === 'session/new') result = { sessionId: 'owned', configOptions: configOptions() };
    if (message.method === 'session/set_config_option') result = { configOptions: configOptions().map(option => ({ ...option, currentValue: message.params.value })) };
    if (message.method === 'session/prompt') { native.finishPrompt = reason => { native.finishPrompt = null; send({ jsonrpc: '2.0', id: message.id, result: { stopReason: reason } }); }; return; }
    send({ jsonrpc: '2.0', id: message.id, result });
  }, pid);
  return native;
}

// Codex app-server: every turn gets a new id; an interrupt is answered unless `ignoreInterrupt` is true.
export function codexNative(pid) {
  let turns = 0;
  const native = fakeChild((message, send) => {
    if (message.id == null) return;
    let result = {};
    if (message.method === 'initialize') result = { authMethods: [{ id: 'existing-login' }] };
    if (message.method === 'account/read') result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (message.method === 'thread/start') result = { thread: { id: 'owned' }, model: message.params.model, reasoningEffort: message.params.config.model_reasoning_effort, sandbox: { type: 'readOnly' } };
    if (message.method === 'turn/start') { turns += 1; native.turnId = `turn-${turns}`; result = { turn: { id: native.turnId } }; }
    if (message.method === 'turn/interrupt') {
      if (native.ignoreInterrupt === true) return;
      send({ jsonrpc: '2.0', id: message.id, result: {} });
      send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'owned', turn: { id: message.params.turnId, status: 'interrupted' } } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  }, pid);
  return native;
}

export const nativeFor = { claude: claudeNative, cursor: cursorNative, codex: codexNative };

// An owned-process handle for a fake child: it ends with the child and records how it was built.
export function fakeOwner(handles) {
  return async (child, hooks) => {
    const exit = new EventEmitter(); let ended = false;
    child.once('exit', () => { ended = true; exit.emit('exit'); });
    const identity = `fake:${child.pid}:${handles.length}`;
    const handle = { identity, verify: async () => !ended, onExit: listener => { exit.on('exit', listener); return () => exit.off('exit', listener); },
      stop: async () => { child.kill(); return { acknowledged: true }; }, cleanup: async () => ({ closed: ended, identity }), stopStep: () => hooks.stopStep() };
    handles.push({ handle, hooks, child });
    return handle;
  };
}

export const report = (client, boundary) => ({ id: client, title: client, connected: true, scopeEnforced: boundary === 'confined', boundary,
  models: [{ id: MODEL, title: 'Observed', efforts: ['high'], modes: [] }], quota: { remainingPercent: null, period: null, known: false }, context: { known: false, compact: false } });

export async function until(read, limit = 5000) {
  const deadline = Date.now() + limit;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error('The condition did not become true in time.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
