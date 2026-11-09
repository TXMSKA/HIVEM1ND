import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';
import { defaultMind, MIND_DIRECTORY_NAME } from '../service/paths.mjs';
import { detectLanguage } from '../texts.mjs';
import { attachInput, readSecret, renderAccountCommand, runSignInTerminal } from './terminal.mjs';

const PENDING_APPROVAL = new Set(['approval-pending', 'approval-code', 'approval-approved']);

function stripOneLineEnding(value) {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n') || value.endsWith('\r')) return value.slice(0, -1);
  return value;
}

async function readStdin(input, { limit = 4096 } = {}) {
  let value = '';
  let bytes = 0;
  const decoder = new TextDecoder('utf8', { fatal: true });
  for await (const chunk of input) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw new CoreError(413, 'invalid_body', 'The Relay+ action is not valid.');
    value += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
}

function machineResult(options, input, output) {
  return options.json === true || input?.isTTY !== true || output?.isTTY !== true;
}

async function readHiddenPhrase(input) {
  const source = attachInput(input);
  try {
    const entry = await readSecret(input, source, { write() {} });
    if (entry.cancelled || entry.eof && !entry.value) throw new CoreError(422, 'phrase_input_required', 'Provide the recovery phrase through standard input.');
    return entry.value ?? '';
  } finally { source.stop(); }
}

// One JSON line is already on stdout. Stay attached until the listener or requester finishes, and print nothing else.
async function hold(post, result, dependencies, signal) {
  const pause = dependencies.pause ?? (async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const wait = async () => {
    if (signal.aborted) return;
    let aborted;
    const stop = new Promise(resolve => { aborted = resolve; signal.addEventListener('abort', aborted, { once: true }); });
    try { await Promise.race([pause(2000), stop]); }
    finally { signal.removeEventListener('abort', aborted); }
  };
  if (result.state === 'sign-in-pending') {
    while (!signal.aborted) {
      const status = await post('status');
      if (status.signInPending !== true) return;
      await wait();
    }
    return;
  }
  while (!signal.aborted) {
    const view = await post('inspect');
    if (!PENDING_APPROVAL.has(view.state) || view.stored === true) return;
    await wait();
  }
}

export async function runRelayPlusCommand(options, dependencies, output) {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const home = path.resolve(options.homeDir ?? os.homedir());
  const selected = { platform, env, home, mindPath: path.resolve(options.mindPath ?? (options.cosmicPath
    ? path.join(options.cosmicPath, MIND_DIRECTORY_NAME) : defaultMind({ platform, env, home }))),
  hostname: options.hostname ?? os.hostname(), cosmicPath: options.cosmicPath, aclRunner: dependencies.aclRunner };
  const client = dependencies.relayPlusClient ?? await import('../service/client.mjs');
  const input = dependencies.input ?? process.stdin;
  const language = options.language ?? detectLanguage(env);
  const service = await client.connectService(selected);
  const machine = machineResult(options, input, output);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (machine) process.on('SIGINT', cancel);
  const signal = dependencies.signal ? AbortSignal.any([controller.signal, dependencies.signal]) : controller.signal;
  let pendingAction = null, printed = false;
  const post = async (action, fields = {}) => {
    const response = await client.request(service, { method: 'POST', path: '/api/v1/relay-plus', timeoutMs: action.startsWith('cancel-') ? 5000 : 40000,
      headers: { 'idempotency-key': randomUUID() }, body: { action, ...fields } });
    if (response.status !== 200) {
      throw new CoreError(response.status, response.json?.error?.code ?? 'relay_plus_unavailable', 'The account request could not be completed.',
        response.json?.error?.details ?? {}, response.json?.error?.retryAt ?? null);
    }
    return response.json?.data ?? {};
  };
  try {
    try {
      if (!machine && options.action === 'sign-in') {
        await runSignInTerminal({
          language, input, output, call: post, open: dependencies.openUrl, now: dependencies.now,
          pause: dependencies.pause, sleep: dependencies.sleep, signal: dependencies.signal,
        });
        return 0;
      }
      if (options.action === 'unlock') {
        if (input.isTTY) throw new CoreError(422, 'password_input_required', 'Provide the password through standard input.');
        const password = stripOneLineEnding(await readStdin(input));
        output.write(`${JSON.stringify(await post('unlock', { password }))}\n`);
        return 0;
      }
      if (options.action === 'recover') {
        const phrase = (input.isTTY ? await readHiddenPhrase(input) : await readStdin(input)).trim();
        output.write(`${JSON.stringify(await post('recover', { phrase }))}\n`);
        return 0;
      }
      const fields = {};
      for (const key of ['deviceId', 'messageId', 'after', 'limit']) if (options[key] !== undefined) fields[key] = options[key];
      if (options.action === 'publish') fields.ciphertext = (await readStdin(input, { limit: 360000 })).trim();
      const result = await post(options.action, fields);
      if (!machine && (options.action === 'status' || options.action === 'sign-out')) {
        const source = attachInput(input, dependencies.signal);
        try {
          await renderAccountCommand({
            language, action: options.action, result, output, open: dependencies.openUrl, call: post,
            source,
            now: dependencies.now ?? Date.now,
            pause: dependencies.pause ?? (async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); }),
          });
        } finally { source.stop(); }
        return 0;
      }
      output.write(`${JSON.stringify(result)}\n`);
      printed = true;
      if (result.state === 'sign-in-pending' || PENDING_APPROVAL.has(result.state)) {
        pendingAction = result.state === 'sign-in-pending' ? 'cancel-sign-in' : 'cancel-approval';
        await hold(post, result, dependencies, signal);
      }
      return signal.aborted ? 130 : 0;
    } catch (error) {
      if (!machine) throw error;
      if (!printed) output.write(`${JSON.stringify({ code: error.code ?? 'error' })}\n`);
      return error.status === 422 ? 2 : 1;
    }
  } finally {
    process.off('SIGINT', cancel);
    try { if (pendingAction && signal.aborted) await post(pendingAction); }
    finally { await service.release({ stop: true }); }
  }
}
