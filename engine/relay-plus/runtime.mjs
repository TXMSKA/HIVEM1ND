import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreError } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { replicate } from '../sync/replicate.mjs';
import { loadRelanKey, saveRelanKey } from '../relan/keys.mjs';
import { createRelayPlusAccount } from './account.mjs';
import { classifyRelayFailure } from './client.mjs';
import { createRelayPlusKeys } from './keys.mjs';
import { createApprovalRequester } from './approval.mjs';
import { createVaultPasswordProvider } from './vault.mjs';
import { createRelayPlusFeed, openRelayPlusTransport } from './transport.mjs';

export async function createRelayPlus(options) {
  const { localDirectory, machine, origin } = options;
  const computerId = options.computerId ?? (/^[A-Za-z0-9_-]{1,64}$/.test(machine)
    ? machine : createHash('sha256').update(machine).digest('hex'));
  const account = createRelayPlusAccount({ ...options, computerId, deviceName: machine });
  const directory = path.join(localDirectory, 'relay-plus');
  let keys = null, transport = null, feed = null, pending = null, pass = null, approval = null, acceptance = null, signedInAccount = null;
  let lifecycle = Promise.resolve(), synchronizeAgain = false, generation = 0;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  let acceptanceWatch = null;
  let acceptanceCheck = null, approvalStart = null, approvalRetryAt = 0;
  let signInStarting = null;
  let commits = Promise.resolve();
  const commit = action => {
    const result = commits.then(action);
    commits = result.catch(() => {});
    return result;
  };
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
    if (closed || acceptance && !['acceptance-required', 'authentication-required'].includes(value.state)) return;
    state = value;
    if (value.state === 'authentication-required') { authenticationStopped = true; void feed?.stop().catch(() => {}); }
    if (value.state === 'acceptance-required') holdAcceptance(value);
  };
  function pages() { return { en: account.pages('en'), es: account.pages('es') }; }
  // Use Vault shows while Vault is installed, locked included, until an unlocked Vault answers none for this account.
  const vault = options.vault ?? createVaultPasswordProvider();
  let vaultHiddenFor = null;
  function required(from = keys, extra = {}) {
    const value = from.requiredState;
    const methods = { ...value.methods, ...extra };
    methods.vault = methods.password === true && vaultHiddenFor !== signedInAccount && vault.installed();
    return { ...value, methods, pages: pages() };
  }
  async function useVault(input, currentKeys, settings) {
    const email = (await account.client.request('/v1/me'))?.email;
    if (typeof email !== 'string' || !email) return { vault: 'unavailable' };
    let found;
    try {
      found = await vault.status(email);
      if (found === 'locked') {
        if (!Object.hasOwn(input, 'vaultPassword')) return { vault: 'locked' };
        try { await vault.unlock(input.vaultPassword); }
        catch (error) { return { vault: error?.code === 'locked' || error?.code === 'limited' ? 'vault-wrong' : 'unavailable' }; }
        found = await vault.status(email);
      }
    } catch { return { vault: 'unavailable' }; }
    if (found === 'none') { vaultHiddenFor = signedInAccount; return { vault: 'none' }; }
    if (found !== 'available') return { vault: 'unavailable' };
    let password;
    try { password = await vault.read(email); }
    catch { return { vault: 'unavailable' }; }
    try { await currentKeys.unlockPassword(password, settings); }
    catch (error) {
      if (error?.code === 'key_authentication_failed') return { vault: 'wrong-password' };
      throw error;
    } finally { password = null; }
    return null;
  }
  function holdAcceptance(value) {
    const accountId = value.accountId ?? signedInAccount ?? acceptance?.accountId ?? null;
    const policies = value.policies ?? [];
    const same = acceptance?.accountId === accountId && JSON.stringify(acceptance.policies) === JSON.stringify(policies);
    if (!same) acceptance = { policies, ids: policies.map(item => item?.id).filter(Boolean), accountId, nextCheck: 0 };
    state = { state: 'acceptance-required', code: 'acceptance_required', policies: acceptance.policies, accountId, pages: pages() };
    void feed?.stop().catch(() => {});
  }
  const onError = error => {
    if (closed || error.code === 'operation_cancelled' || error.code === 'sign_in_cancelled') return;
    const classified = classifyRelayFailure(error);
    if (classified?.state === 'authentication-required') { authenticationStopped = true; void cancelApproval().catch(() => {}); }
    if (classified?.state === 'acceptance-required') holdAcceptance(classified);
    onState(classified ?? { state: 'offline', code: error.code ?? 'network_unavailable' });
  };
  async function synchronize() {
    if (closed || authenticationStopped || acceptance || !transport) return;
    synchronizeAgain = true;
    if (pass) return pass;
    const epoch = generation;
    pass = (async () => {
      do {
        synchronizeAgain = false;
        const bootstrap = await account.client.request('/v1/bootstrap');
        if (closed || epoch !== generation || acceptance || authenticationStopped) return;
        transport.setWritable(bootstrap.capabilities.relayPlus === true);
        await replicate({ origin, transport, keyProvider });
        await options.onReplicated?.();
        lastSync = new Date().toISOString();
      } while (synchronizeAgain && !closed && !authenticationStopped && !acceptance);
    })().catch(error => { if (!closed && epoch === generation) throw error; }).finally(() => { pass = null; });
    return pass;
  }
  async function disconnect() {
    await feed?.stop(); feed = null;
    await pass?.catch(() => {});
    transport = null;
    await commit(() => { keys?.lock(); keys = null; });
  }
  async function connect() {
    const epoch = generation;
    await disconnect();
    if (closed || epoch !== generation || acceptance) return;
    authenticationStopped = false;
    const credentials = await account.credentials();
    if (!credentials || closed || epoch !== generation) return;
    signedInAccount = credentials.account_id;
    const binding = createHash('sha256').update(`${credentials.account_id}:${credentials.deviceId}`).digest('hex');
    const mindId = options.mindId;
    if (typeof mindId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(mindId)) {
      throw new CoreError(422, 'mind_id_required', 'Configure the same unique M1ND id on every computer joining this M1ND.');
    }
    const bound = await account.assertBound();
    if (!bound || closed || epoch !== generation) return;
    if (bound.state === 'authentication-required') { state = bound; return; }
    keys = createRelayPlusKeys({ client: account.client, deviceId: credentials.deviceId, accountId: credentials.account_id,
      accountKeyStoreFile: options.accountKeyStoreFile,
      accountKeyStore: options.accountKeyStore,
      loadMindKey: () => loadRelanKey({ localDirectory, ...secretOptions }),
      saveMindKey: value => saveRelanKey({ localDirectory, ...secretOptions }, value),
      mindId, loadState: () => read(`keys-${binding}.json`), saveState: value => save(`keys-${binding}.json`, value) });
    const connectedKeys = keys;
    if (!await connectedKeys.unlock()) {
      if (!closed && epoch === generation && !acceptance) state = required(connectedKeys);
      return;
    }
    if (closed || epoch !== generation || acceptance) { connectedKeys.lock(); return; }
    const protectedClient = {
      request(route, settings) {
        if (closed || epoch !== generation) throw new CoreError(409, 'operation_cancelled', 'The account operation was cancelled.');
        if (acceptance) throw new CoreError(403, 'acceptance_required', 'Accept the current policies in the browser.', { policies: acceptance.policies });
        if (authenticationStopped) throw new CoreError(401, 'sign_in_required', 'Sign in to continue.');
        return account.client.request(route, settings);
      },
    };
    const openTransport = () => openRelayPlusTransport({ client: protectedClient, accountId: credentials.account_id,
      computerId, machine, generation: createHash('sha256').update(mindId).digest('hex'),
      keyId: keys.encryption.keyId, mindId, headKey: () => keys.headKey(),
      sealMindKey: () => keys.sealMindKey(), openMindKey: value => keys.openMindKey(value), keyProvider, onState });
    // A new computer imports the existing M1ND key before generating any local key or publishing packs.
    await openTransport().listHeads();
    if (closed || epoch !== generation || acceptance) return;
    await connectedKeys.createMindKey();
    if (options.enabled !== true) { state = { state: 'configured', enabled: false }; return; }
    transport = openTransport();
    await options.onKey?.();
    await synchronize();
    if (closed || epoch !== generation || acceptance || authenticationStopped) return;
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
    feed.start().catch(onError);
  }
  function publicApproval(value, current = approval) {
    const safe = { state: value.state, expiresAt: value.expiresAt ?? null, outcome: value.outcome ?? null, stored: value.stored === true };
    if (current?.offline) safe.offline = true;
    if (typeof value.code === 'string') safe.code = value.code;
    if (value.remote === true || value.remote === false) safe.remote = value.remote;
    return safe;
  }
  async function finishApproval(current, epochAtStart) {
    if (current.finishing) return current.finishing;
    current.finishing = (async () => {
      const wrote = await current.requester.accept(key => current.keys.saveAccount(key));
      if (!wrote) return publicApproval(current.requester.view());
      const code = current.code;
      let consumed = false;
      for (let attempt = 0; attempt < 3 && !consumed; attempt += 1) {
        try { consumed = await current.requester.consume(); }
        catch (error) {
          if (error?.status === 404) { consumed = true; break; }
          if (error.code === 'acceptance_required' || error.status === 401) { onError(error); break; }
          if (attempt === 2) break;
          await wait(Math.max(2000, (error?.retryAfter ?? 1) * 1000));
        }
      }
      if (generation === epochAtStart && !closed && !acceptance) await serialize(connect);
      return { ...state, stored: true, ...(code ? { code } : {}) };
    })();
    try { return await current.finishing; }
    catch (error) { current.finishing = null; throw error; }
  }
  // A network failure or a server fault retries the same step with the same values while the request is live.
  function retryable(error) { return !error?.status || error.status >= 500; }
  function watchApproval(current, epochAtStart) {
    current.task = (async () => {
      let failures = 0;
      while (approval === current && generation === epochAtStart && !closed) {
        let step;
        try { step = await current.requester.inspect(); failures = 0; current.offline = false; }
        catch (error) {
          if ((!retryable(error) && error.status !== 429) || approval !== current || generation !== epochAtStart) throw error;
          failures += 1;
          current.offline = true;
          const backoff = error.status === 429 ? Math.max(2000, (error.retryAfter ?? 2) * 1000)
            : Math.min(30_000, 2000 * 2 ** Math.min(failures, 4));
          const remaining = Math.max(0, (current.requester.view().expiresAt ?? (Date.now() + backoff)) - (options.now ?? Date.now)());
          try { await wait(Math.min(backoff, remaining), current.controller.signal); } catch { return; }
          continue;
        }
        if (approval !== current || generation !== epochAtStart) return;
        if (step.code) current.code = step.code;
        if (step.state === 'approval-approved' || step.outcome === 'approved') {
          await finishApproval(current, epochAtStart);
          return;
        }
        if (['approval-ended', 'approval-inactive'].includes(step.state) || ['expired', 'rejected', 'cancelled', 'consumed', 'ended', 'forgotten', 'conflict'].includes(step.outcome)) return;
      }
    })().catch(error => {
      if (approval === current && generation === epochAtStart && !closed && !current.controller.signal.aborted) onError(error);
    });
  }
  async function cancelApproval() {
    const current = approval;
    if (!current) return { state: 'approval-inactive', remote: false, stored: false };
    approval = null;
    current.controller.abort();
    const result = await current.requester.cancel();
    return { state: 'approval-ended', outcome: 'cancelled', remote: result.remote === true, stored: current.requester.stored === true };
  }
  async function checkAcceptance() {
    if (acceptanceCheck) return acceptanceCheck;
    acceptanceCheck = performAcceptanceCheck().finally(() => { acceptanceCheck = null; });
    return acceptanceCheck;
  }
  async function performAcceptanceCheck() {
    if (!acceptance) return { state: state.state, resumed: state.state !== 'acceptance-required' };
    const blocked = acceptance;
    const epoch = generation;
    const current = () => acceptance === blocked && generation === epoch && !closed;
    const now = options.now ?? Date.now;
    if (blocked.nextCheck > now()) return { ...state, resumed: false, retryAfter: Math.ceil((blocked.nextCheck - now()) / 1000) };
    const saved = await account.credentials();
    if (!current() || !saved || saved.account_id !== blocked.accountId) return { state: 'acceptance-required', resumed: false, stopped: true };
    const me = await account.client.request('/v1/me');
    if (!current() || me?.accountId !== blocked.accountId) return { state: 'acceptance-required', resumed: false, stopped: true };
    blocked.nextCheck = now() + 2000;
    let requirements;
    try { requirements = await account.client.request('/v1/legal/requirements'); }
    catch (error) {
      if (error?.status === 429) {
        const retryAfter = Math.max(2, error.retryAfter ?? 2);
        blocked.nextCheck = now() + retryAfter * 1000;
        return { state: 'acceptance-required', resumed: false, retryAfter, policies: blocked.policies };
      }
      throw error;
    }
    const present = new Set((requirements.policies ?? []).map(item => item.id));
    if (!current()) return { state: state.state, resumed: false, stopped: true };
    if (blocked.ids.some(id => present.has(id))) return { state: 'acceptance-required', resumed: false, policies: blocked.policies };
    const bootstrap = await account.client.request('/v1/bootstrap');
    if (!current() || bootstrap?.accountId && bootstrap.accountId !== blocked.accountId) return { state: 'acceptance-required', resumed: false, stopped: true };
    acceptance = null;
    await serialize(connect);
    if (approval && !approval.requester.stored) { approval.keys = keys; watchApproval(approval, generation); }
    return { state: state.state, resumed: true };
  }
  function resumeAcceptance() {
    if (acceptanceWatch) return acceptanceWatch;
    const watchGeneration = generation;
    const controller = new AbortController();
    acceptanceWatch = (async () => {
      while (!controller.signal.aborted && watchGeneration === generation && acceptance) {
        let outcome;
        try { outcome = await checkAcceptance(); }
        catch (error) { onError(error); break; }
        if (outcome.resumed || outcome.stopped) break;
        try { await wait(Math.max(2000, (outcome.retryAfter ?? 0) * 1000), controller.signal); }
        catch { break; }
      }
    })().finally(() => { if (acceptanceWatch?.generation === watchGeneration) acceptanceWatch = null; });
    acceptanceWatch.abort = () => controller.abort();
    acceptanceWatch.generation = watchGeneration;
    return acceptanceWatch;
  }
  // A protected call that Quantum refuses for consent or authentication moves the runtime into that state.
  async function control(input, queued = false, requestGeneration = generation) {
    try { return await controlAction(input, queued, requestGeneration); }
    catch (error) {
      if (error?.name === 'RelayPlusError' && input?.action !== 'status') {
        const classified = classifyRelayFailure(error);
        if (classified?.state === 'acceptance-required' || classified?.state === 'authentication-required') onError(error);
        const details = classified?.state === 'acceptance-required' ? { policies: classified.policies }
          : classified?.reason ? { reason: classified.reason } : {};
        throw new CoreError(error.status, error.code, 'The account request could not be completed.', details,
          error.retryAfter == null ? null : new Date(Date.now() + error.retryAfter * 1000).toISOString());
      }
      throw error;
    }
  }
  async function controlAction(input, queued, requestGeneration) {
    if (closed) throw new CoreError(503, 'service_unavailable', 'Relay+ is closed.');
    if (input.action === 'status') {
      const epoch = generation;
      try {
        const current = await account.status();
        if (epoch !== generation || closed) return { ...state, sync: state, lastSync, signInPending: Boolean(pending) };
        if (current.state === 'acceptance-required') holdAcceptance(current);
        if (current.state === 'authentication-required') onState(current);
        const showPages = current.state === 'acceptance-required' || state.state === 'key-required';
        return { ...current, ...(showPages ? { pages: pages() } : {}), sync: state, lastSync,
          keyReady: keys?.ready === true, signInPending: Boolean(pending) };
      } catch (error) {
        if (epoch === generation && !closed) onError(error);
        return { ...state, sync: state, lastSync, signInPending: Boolean(pending) };
      }
    }
    if (input.action === 'check-acceptance') return checkAcceptance();
    if (input.action === 'cancel-sign-in') {
      const reconnect = pending !== null || signInStarting !== null;
      pending?.cancel(); pending = null; signInStarting = null;
      if (reconnect) await serialize(connect);
      return { state: 'sign-in-cancelled' };
    }
    if (input.action === 'cancel-approval') return cancelApproval();
    if (input.action === 'sign-in') {
      if (requestGeneration !== generation) throw new CoreError(409, 'operation_cancelled', 'The account operation was cancelled.');
      await cancelApproval();
      pending?.cancel();
      acceptance = null;
      const current = await account.beginSignIn();
      if (signInStarting === requestGeneration) signInStarting = null;
      if (requestGeneration !== generation || closed) { current.cancel(); throw new CoreError(409, 'operation_cancelled', 'The account operation was cancelled.'); }
      pending = current;
      // The listener stays up until the callback, cancel or timeout settles. Status reports that wait.
      const epoch = generation;
      current.complete.then(() => {
        if (pending === current && epoch === generation && !closed) return serialize(connect);
      }).catch(error => { if (pending === current && epoch === generation && !closed && error.code !== 'sign_in_cancelled') onError(error); })
        .finally(() => { if (pending === current) pending = null; });
      return { state: 'sign-in-pending', url: current.url };
    }
    if (input.action === 'sign-out') {
      await cancelApproval();
      acceptanceWatch?.abort?.();
      acceptance = null;
      pending?.cancel(); pending = null;
      await disconnect();
      const result = await account.signOut();
      state = { state: 'signed-out' };
      return result;
    }
    if (input.action === 'approve') throw new CoreError(422, 'approval_retired', 'Approval from this app is no longer available.');
    // Protected sync and approval stay paused. Status, sign-out and the legal check are handled above.
    if (acceptance) return { ...state };
    if (authenticationStopped) throw new CoreError(401, 'sign_in_required', 'Sign in to continue.');
    if (!keys) {
      if (queued) await connect();
      else await serialize(connect);
    }
    if (!keys) throw new CoreError(401, 'sign_in_required', 'Sign in before managing Relay+ keys.');
    if (input.action === 'create-key') { await keys.createMindKey(); await connect(); return { ...state }; }
    if (input.action === 'refresh-keys') {
      await keys.refresh();
      state = required();
      return { ...state };
    }
    if (input.action === 'unlock' || input.action === 'recover' || input.action === 'vault') {
      const epoch = generation, currentKeys = keys;
      const current = () => epoch === generation && !closed && keys === currentKeys && !acceptance;
      const settings = { commit, current };
      if (input.action === 'vault') {
        const stopped = await useVault(input, currentKeys, settings);
        if (stopped) { state = required(currentKeys); return { ...state, ...stopped }; }
      } else if (input.action === 'unlock') await currentKeys.unlockPassword(input.password, settings);
      else await currentKeys.recover(input.phrase, settings);
      if (!current()) throw new CoreError(409, 'operation_cancelled', 'The account operation was cancelled.');
      await serialize(connect);
      return { ...state, stored: true };
    }
    if (input.action === 'request-approval') {
      if (approvalStart) return approvalStart;
      approvalStart = startApproval().finally(() => { approvalStart = null; });
      return approvalStart;
    }
    if (input.action === 'inspect') {
      if (!approval) return { state: 'approval-inactive', stored: false };
      const current = approval;
      if (current.requester.stored) return { ...state, stored: true, ...(current.code ? { code: current.code } : {}) };
      const value = await current.requester.inspect();
      if (value.code) current.code = value.code;
      if (value.outcome === 'approved') return finishApproval(current, generation);
      return publicApproval(value, current);
    }
    if (input.action === 'accept') {
      if (!approval) return { state: 'approval-inactive', stored: false };
      return finishApproval(approval, generation);
    }
    if (input.action === 'inbox' || input.action === 'outbox') return account.messages[input.action]({ after: input.after, limit: input.limit });
    if (input.action === 'delivered' || input.action === 'read') return account.messages[input.action](input.messageId);
    if (input.action === 'publish') return account.messages.publish(input.deviceId, Buffer.from(input.ciphertext, 'base64'), input.messageId);
    throw new CoreError(422, 'invalid_body', 'The Relay+ action is not valid.');
  }
  async function startApproval() {
    const existing = approval?.requester.view();
    if (existing && !['approval-ended', 'approval-inactive'].includes(existing.state)) return publicApproval(existing);
    const now = options.now ?? Date.now;
    if (now() < approvalRetryAt) return { state: 'key-required', outcome: 'rate-limited', retryAfter: Math.ceil((approvalRetryAt - now()) / 1000) };
    const epochAtStart = generation;
    const controller = new AbortController();
    const requester = createApprovalRequester({ client: account.client, accountId: signedInAccount, now: options.now ?? Date.now,
      lock: commit, wait: (ms, signal) => wait(ms, signal), platform: options.platform, signal: controller.signal,
      current: () => generation === epochAtStart && approval?.requester === requester && !closed && !acceptance });
    const current = { requester, controller, keys };
    approval = current;
    const started = await requester.start();
    if (approval !== current || generation !== epochAtStart || closed) return { state: 'approval-ended', outcome: 'cancelled', stored: false };
    if (['approval-unavailable', 'approval-limit', 'rate-limited'].includes(started.outcome)) {
      if (started.outcome === 'rate-limited') approvalRetryAt = now() + Math.max(2, started.retryAfter ?? 2) * 1000;
      approval = null;
      state = { ...required(keys, { approval: false }), outcome: started.outcome };
      return { ...state, retryAfter: started.retryAfter ?? null };
    }
    if (!['approval-ended', 'approval-inactive'].includes(started.state)) watchApproval(approval, epochAtStart);
    return publicApproval(started);
  }
  try { await connect(); } catch (error) { onError(error); }
  const direct = new Set(['status', 'inspect', 'accept', 'cancel-approval', 'cancel-sign-in', 'check-acceptance', 'request-approval', 'unlock', 'recover', 'vault', 'refresh-keys']);
  return { control: input => {
    if (['sign-in', 'sign-out'].includes(input?.action) || input?.action === 'cancel-sign-in' && (pending || signInStarting !== null)) {
      generation += 1;
      account.cancelSignIn();
      pending?.cancel();
      if (input.action !== 'cancel-sign-in') pending = null;
      if (input.action === 'sign-in') signInStarting = generation;
      if (input.action === 'sign-out') signInStarting = null;
    }
    const epoch = generation;
    return direct.has(input?.action) ? control(input, false, epoch) : serialize(() => control(input, true, epoch));
  },
    keyProvider: id => keys?.keyProvider(id) ?? null,
    encryption: () => keys?.encryption, ready: () => !closed && keys?.ready === true,
    wake: () => { synchronize().catch(onError); }, resumeAcceptance,
    async close() { closed = true; generation += 1; acceptanceWatch?.abort?.(); account.cancelSignIn(); pending?.cancel(); await cancelApproval().catch(() => {}); await vault.close(); await serialize(disconnect); } };
}
