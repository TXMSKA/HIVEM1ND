import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { replicate } from '../sync/replicate.mjs';
import { loadRelanKey, saveRelanKey } from '../relan/keys.mjs';
import { createRelayPlusAccount } from './account.mjs';
import { createRelayPlusKeys } from './keys.mjs';
import { createRelayPlusFeed, openRelayPlusTransport } from './transport.mjs';

export async function createRelayPlus(options) {
  const { localDirectory, machine, origin } = options;
  const computerId = options.computerId ?? (/^[A-Za-z0-9_-]{1,64}$/.test(machine)
    ? machine : createHash('sha256').update(machine).digest('hex'));
  const account = createRelayPlusAccount({ ...options, computerId, deviceName: machine });
  const directory = path.join(localDirectory, 'relay-plus');
  let keys = null, transport = null, feed = null, pending = null, pass = null;
  let lifecycle = Promise.resolve(), synchronizeAgain = false;
  const serialize = action => {
    const operation = lifecycle.then(action);
    lifecycle = operation.catch(() => {});
    return operation;
  };
  let closed = false, authenticationStopped = false, lastSync = null, state = { state: 'signed-out' };
  const keyProvider = id => keys?.keyProvider(id) ?? options.keyProvider?.(id) ?? null;
  const secretOptions = { aclRunner: options.aclRunner, store: options.store };
  async function read(name) {
    const file = path.join(directory, name);
    await assertNoLinks(file);
    try {
      const bytes = await readFile(file);
      await verifyLocalPermissions(directory, secretOptions);
      await verifyLocalPermissions(file, secretOptions);
      return JSON.parse(bytes);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(name, value) {
    await assertNoLinks(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await protectLocalFile(directory, secretOptions);
    const file = path.join(directory, name);
    await assertNoLinks(file);
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await protectLocalFile(temporary, secretOptions);
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
  const onState = value => {
    state = value;
    if (value.state === 'authentication-required') authenticationStopped = true;
  };
  const onError = error => onState({
    state: error.status === 401 || ['invalid_grant', 'device_revoked', 'device_revoked_or_session_expired'].includes(error.code)
      ? 'authentication-required' : 'offline', code: error.code ?? 'network_unavailable',
  });
  async function synchronize() {
    if (closed || authenticationStopped || !transport) return;
    synchronizeAgain = true;
    if (pass) return pass;
    pass = (async () => {
      do {
        synchronizeAgain = false;
        const bootstrap = await account.client.request('/v1/bootstrap');
        transport.setWritable(bootstrap.capabilities.relayPlus === true);
        await replicate({ origin, transport, keyProvider });
        await options.onReplicated?.();
        lastSync = new Date().toISOString();
      } while (synchronizeAgain && !closed && !authenticationStopped);
    })().finally(() => { pass = null; });
    return pass;
  }
  async function disconnect() {
    await feed?.stop(); feed = null;
    await pass?.catch(() => {});
    transport = null;
    keys?.lock(); keys = null;
  }
  async function connect() {
    await disconnect();
    authenticationStopped = false;
    const credentials = await account.credentials();
    if (!credentials || closed) return;
    const binding = createHash('sha256').update(`${credentials.account_id}:${credentials.deviceId}`).digest('hex');
    const mindId = options.mindId;
    if (typeof mindId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(mindId)) {
      throw new CoreError(422, 'mind_id_required', 'Configure the same unique M1ND id on every computer joining this M1ND.');
    }
    keys = createRelayPlusKeys({ client: account.client, deviceId: credentials.deviceId, accountId: credentials.account_id,
      accountKeyStoreFile: options.accountKeyStoreFile,
      accountKeyStore: options.accountKeyStore,
      loadMindKey: () => loadRelanKey({ localDirectory, ...secretOptions }),
      saveMindKey: value => saveRelanKey({ localDirectory, ...secretOptions }, value),
      mindId, loadState: () => read(`keys-${binding}.json`), saveState: value => save(`keys-${binding}.json`, value) });
    if (!await keys.unlock()) { state = keys.requiredState; return; }
    if (closed) return;
    const openTransport = () => openRelayPlusTransport({ client: account.client, accountId: credentials.account_id,
      computerId, machine, generation: createHash('sha256').update(mindId).digest('hex'),
      keyId: keys.encryption.keyId, mindId, headKey: () => keys.headKey(),
      sealMindKey: () => keys.sealMindKey(), openMindKey: value => keys.openMindKey(value), keyProvider, onState });
    // A new computer imports the existing M1ND key before generating any local key or publishing packs.
    await openTransport().listHeads();
    await keys.createMindKey();
    if (options.enabled !== true) { state = { state: 'configured', enabled: false }; return; }
    transport = openTransport();
    await options.onKey?.();
    await synchronize();
    if (closed) return;
    feed = createRelayPlusFeed({ client: account.client, loadCursor: () => read(`cursor-${binding}.json`),
      saveCursor: value => save(`cursor-${binding}.json`, value), applyPage: synchronize,
      rebuild: async bootstrap => {
        // The recovery snapshot includes every page, including collections absent from retained changes.
        let after = bootstrap.after;
        while (after) after = (await account.client.request(`/v1/bootstrap?after=${encodeURIComponent(after)}`)).after;
        for (const route of ['/v1/datasets', '/v1/relay/inbox', '/v1/relay/outbox']) {
          after = null;
          do {
            const page = await account.client.request(`${route}?limit=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`);
            if (page.after && page.after === after) throw new CoreError(502, 'invalid_response', 'The recovery listing cursor did not advance.');
            after = page.after;
          } while (after);
        }
        await synchronize();
      }, onState });
    feed.start().catch(error => onState({ state: 'offline', code: error.code ?? 'sync_failed' }));
  }
  async function control(input) {
    if (closed) throw new CoreError(503, 'service_unavailable', 'Relay+ is closed.');
    if (input.action === 'status') return { ...await account.status(), sync: state, lastSync };
    if (input.action === 'sign-in') {
      pending?.cancel();
      pending = await account.beginSignIn();
      pending.complete.then(() => serialize(connect)).catch(onError);
      return { state: 'sign-in-pending', url: pending.url };
    }
    if (input.action === 'sign-out') {
      pending?.cancel(); pending = null;
      await disconnect();
      const result = await account.signOut();
      state = { state: 'signed-out' };
      return result;
    }
    if (!keys) await connect();
    if (!keys) throw new CoreError(401, 'sign_in_required', 'Sign in before managing Relay+ keys.');
    if (input.action === 'create-key') { await keys.createMindKey(); await connect(); return { state: 'ready' }; }
    if (input.action === 'recover') { await keys.recover(input.phrase); await connect(); return { state: 'ready' }; }
    if (input.action === 'request-approval') {
      await keys.initializeDevice();
      const request = await keys.createApprovalRequest(input.deviceId);
      return { ...await account.messages.publish(request.recipient, request.ciphertext), fingerprint: request.fingerprint };
    }
    if (input.action === 'inbox' || input.action === 'outbox') return account.messages[input.action]({ after: input.after, limit: input.limit });
    if (input.action === 'inspect' || input.action === 'approve' || input.action === 'accept') {
      const bytes = await account.messages.download(input.messageId);
      if (input.action === 'inspect') return keys.inspectApproval(bytes, input.deviceId);
      if (input.action === 'approve') {
        const approval = await keys.approve(bytes, { senderDeviceId: input.deviceId, fingerprint: input.fingerprint });
        const result = await account.messages.publish(approval.recipient, approval.ciphertext);
        await account.messages.delivered(input.messageId);
        return result;
      }
      await keys.acceptApproval(bytes, input.deviceId);
      await account.messages.delivered(input.messageId);
      await connect();
      return { state: 'ready' };
    }
    if (input.action === 'delivered' || input.action === 'read') return account.messages[input.action](input.messageId);
    if (input.action === 'publish') return account.messages.publish(input.deviceId, Buffer.from(input.ciphertext, 'base64'), input.messageId);
    throw new CoreError(422, 'invalid_body', 'The Relay+ action is not valid.');
  }
  try { await connect(); } catch (error) { onError(error); }
  return { control: input => serialize(() => control(input)), keyProvider: id => keys?.keyProvider(id) ?? null,
    encryption: () => keys?.encryption, ready: () => Boolean(keys?.keyProvider(keys.encryption.keyId)),
    wake: () => { synchronize().catch(onError); },
    async close() { closed = true; pending?.cancel(); await serialize(disconnect); } };
}
