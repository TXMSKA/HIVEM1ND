import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';
import { defaultMind, MIND_DIRECTORY_NAME } from '../service/paths.mjs';

export async function runRelayPlusCommand(options, dependencies, output) {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const home = path.resolve(options.homeDir ?? os.homedir());
  const selected = { platform, env, home, mindPath: path.resolve(options.mindPath ?? (options.cosmicPath
    ? path.join(options.cosmicPath, MIND_DIRECTORY_NAME) : defaultMind({ platform, env, home }))),
  hostname: options.hostname ?? os.hostname(), cosmicPath: options.cosmicPath, aclRunner: dependencies.aclRunner };
  const client = dependencies.relayPlusClient ?? await import('../service/client.mjs');
  const service = await client.connectService(selected);
  try {
    const { action, deviceId, messageId, fingerprint } = options;
    const body = { action, ...(deviceId ? { deviceId } : {}), ...(messageId ? { messageId } : {}), ...(fingerprint ? { fingerprint } : {}) };
    if (action === 'recover') {
      // The phrase never appears in shell arguments or command history.
      const input = dependencies.input ?? process.stdin;
      if (input.isTTY) throw new CoreError(422, 'phrase_input_required', 'Provide the recovery phrase through standard input.');
      let phrase = '';
      for await (const chunk of input) {
        phrase += chunk;
        if (phrase.length > 4096) throw new CoreError(413, 'invalid_recovery_phrase', 'The recovery phrase is too long.');
      }
      body.phrase = phrase.trim();
    }
    const response = await client.request(service, { method: 'POST', path: '/api/v1/relay-plus', timeoutMs: 40000,
      headers: { 'idempotency-key': randomUUID() }, body });
    if (response.status !== 200) throw new CoreError(response.status, response.json?.error?.code ?? 'relay_plus_unavailable', response.json?.error?.message ?? 'The Relay+ command failed.');
    const result = response.json?.data ?? {};
    output.write(`${JSON.stringify(result)}\n`);
    return 0;
  } finally { await service.release({ stop: true }); }
}
