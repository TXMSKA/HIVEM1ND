import { watch } from 'node:fs';
import { lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { eligibleAddresses, parsePeerAddress } from './addresses.mjs';
import { CoreError, validateMachineName } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { writeDurable } from '../sync/origin.mjs';
import { openFolderTransport, replicate } from '../sync/replicate.mjs';
import { openDiscovery, privateAddresses } from './discovery.mjs';
import { openRelanListener, openRelanTransport } from './http.mjs';
import { createRelanKey, loadRelanKey, saveRelanKey } from './keys.mjs';
import { createPairing, pairRelan } from './pairing.mjs';
import { openKnownPeers, tailscalePeers } from './peers.mjs';

export async function createRelan(options = {}) {
  const { origin, localDirectory = origin?.paths?.localDirectory, store = origin?.store, aclRunner = store?.aclRunner, now = () => Date.now() } = options;
  const machine = validateMachineName(options.machine ?? origin?.machine);
  if (!origin?.paths?.origin || !localDirectory) throw new CoreError(500, 'internal_error', 'ReLAN needs a local mirror and a local directory.');
  const keyOptions = { localDirectory, store, aclRunner };
  const knownPeers = await openKnownPeers({ ...keyOptions, allowLoopback: options.allowLoopback });
  let tailnetPeers = [];
  let tailnetTask = null;
  let nextTailnetAt = 0;
  const remembering = new Map();
  const leftFile = path.join(localDirectory, 'relan-left.json');
  const timers = { initialMs: 3000, announceMs: 2000, hostLossMs: 10000, tickMs: 250, retryMs: 1000, ...options.timers };
  for (const value of Object.values(timers)) {
    if (!Number.isFinite(value) || value < 1) throw new CoreError(422, 'invalid_relan_timer', 'ReLAN timers must be positive.');
  }
  const longPollMs = options.longPollMs ?? Math.max(timers.hostLossMs, timers.retryMs * 3);
  if (!Number.isFinite(longPollMs) || longPollMs < 1) throw new CoreError(422, 'invalid_relan_timer', 'The ReLAN long-poll timer must be positive.');
  const startedAt = options.startedAt ?? now();
  let openedAt = now();
  const peers = new Map();
  const candidates = new Map();
  const discoveryWaiters = new Set();
  const probing = new Set();
  const probes = new Set();
  let material = await loadRelanKey(keyOptions);
  let retained = material;
  if (await isLeft()) material = null;
  let creatingKey = null;
  let membership = Promise.resolve();
  let generation = 0;
  let epoch = 0;
  let maxEpoch = 0;
  let hosting = false;
  let host = null;
  let lastHostAt = null;
  let lastError = null;
  let remote = null;
  let remoteName = null;
  let closed = false;
  let syncing = null;
  let pending = false;
  let pollTask = null;
  let nextPollAt = 0;
  let retryAt = null;
  let watcher = null;
  let interval = null;
  let announcement = null;
  let discovery = null;
  let listener = null;
  let networking = null;
  let networkSignature = null;
  let networkGeneration = 0;
  let pairing = newPairing();

  function keyProvider(keyId) {
    const saved = material ?? retained;
    return saved?.keyId === keyId ? saved.key : options.keyProvider?.(keyId) ?? null;
  }

  function encryption() {
    if (!material) throw new CoreError(409, 'encryption_key_missing', 'Pair this machine or host a ReLAN before publishing.');
    return { algorithm: 'aes-256-gcm', keyId: material.keyId };
  }

  async function ensureKey() {
    if (material) return material;
    if (!creatingKey) {
      const currentGeneration = generation;
      creatingKey = Promise.resolve(createRelanKey(keyOptions)).then(async (value) => {
        assertOpen();
        if (generation !== currentGeneration) throw new CoreError(409, 'relan_changed', 'The ReLAN membership changed.');
        await clearLeft();
        assertOpen();
        material = value;
        retained = value;
        await options.onKey?.(material);
        announce();
        return material;
      }).finally(() => { creatingKey = null; });
    }
    return creatingKey;
  }

  function newPairing() {
    return createPairing({ getKey: () => material, ensureKey, now });
  }

  function ownState() {
    return { machine, relanId: material?.relanId ?? null, epoch, hosting, preferred: options.preferred === true, startedAt, uptimeMs: Math.max(0, now() - startedAt) };
  }

  function status() {
    return {
      ...ownState(),
      paired: material !== null,
      left: material === null && retained !== null,
      host: hosting ? machine : host,
      listeners: listener?.listeners.map(({ address, port }) => ({ address, port })) ?? [],
      discovery: discovery?.listeners ?? [],
      peers: destinations(),
      members: [...peers.values()].filter((peer) => now() - peer.seenAt <= timers.hostLossMs).map(({ machine, hosting, preferred, startedAt, epoch, seenAt, address, port }) => ({ machine, hosting, preferred, startedAt, epoch, seenAt, address, port })).sort((left, right) => left.machine.localeCompare(right.machine, 'en')),
      lastError,
    };
  }

  function report(error) {
    if (!closed) lastError = { code: error?.code ?? 'relan_unavailable', message: error?.message ?? 'ReLAN is unavailable.' };
  }

  function announce() {
    if (closed || !material || !listener || !discovery) return;
    discovery.send({ format: 'hivem1nd-relan-v1', relanId: material.relanId, host: machine, epoch, port: listener.listeners[0].port });
  }

  function destinations() {
    return [...new Map([...knownPeers.list(), ...tailnetPeers].map((peer) => [`${peer.address}:${peer.port}`, peer])).values()]
      .sort((left, right) => left.address.localeCompare(right.address, 'en') || left.port - right.port);
  }

  function refreshTailnet() {
    if (options.tailscale !== true || closed || tailnetTask || now() < nextTailnetAt) return tailnetTask;
    nextTailnetAt = now() + 30000;
    tailnetTask = tailscalePeers({ execFile: options.execFile }).then((value) => {
      if (!closed) { tailnetPeers = value; announce(); }
    }).finally(() => { tailnetTask = null; });
    return tailnetTask;
  }

  async function remember(address, discoveryPort) {
    if (closed) return;
    let peer;
    try { peer = parsePeerAddress(`${address}:${discoveryPort ?? 43119}`, 43119, { allowLoopback: options.allowLoopback }); } catch { return; }
    if (knownPeers.list().some((known) => known.address === peer.address && known.port === peer.port)) return;
    const key = `${peer.address}:${peer.port}`;
    if (remembering.has(key)) return remembering.get(key);
    const operation = knownPeers.add(peer);
    remembering.set(key, operation);
    try {
      if (await operation) announce();
    } finally {
      remembering.delete(key);
    }
  }

  async function rememberAddress(address) {
    const matches = [...candidates.values()].filter((candidate) => candidate.address === address);
    if (matches.length === 0 && !knownPeers.list().some((peer) => peer.address === address)) await remember(address);
    else for (const candidate of matches) await remember(address, candidate.discoveryPort);
  }

  async function addPeer(value) {
    assertOpen();
    await knownPeers.add(parsePeerAddress(value, 43119, { allowLoopback: options.allowLoopback }));
    announce();
    return status();
  }

  async function removePeer(value) {
    assertOpen();
    await knownPeers.remove(parsePeerAddress(value, 43119, { allowLoopback: options.allowLoopback }));
    return status();
  }

  function receive(packet, source) {
    if (closed || !listener || packet.host === machine) return;
    for (const [name, peer] of candidates) if (now() - peer.seenAt > timers.hostLossMs * 2) candidates.delete(name);
    const key = `${source.address}:${packet.port}`;
    if (candidates.size >= 256 && !candidates.has(key)) return;
    candidates.set(key, { address: source.address, port: packet.port, discoveryPort: source.port, machine: packet.host, relanId: packet.relanId, seenAt: now() });
    for (const resolve of discoveryWaiters) resolve();
    if (!material || packet.relanId !== material.relanId || probing.has(key)) return;
    const operation = probe(packet, source, key);
    probes.add(operation);
    operation.catch(report).finally(() => probes.delete(operation));
  }

  async function probe(packet, source, key) {
    probing.add(key);
    const currentMaterial = material;
    const currentNetwork = networkGeneration;
    const transport = openRelanTransport({ address: source.address, port: packet.port, key: currentMaterial.key, now, timeoutMs: Math.max(timers.retryMs, timers.tickMs * 2), onWire: options.onWire });
    const requestedAt = now();
    try {
      const state = await transport.getState();
      if (closed || currentNetwork !== networkGeneration || material !== currentMaterial || !validState(state) || state.relanId !== currentMaterial.relanId || state.machine !== packet.host) return;
      const seenAt = now();
      peers.set(state.machine, { ...state, rankingStartedAt: seenAt - state.uptimeMs, rankingStartedAfter: requestedAt - state.uptimeMs, address: source.address, port: packet.port, seenAt });
      maxEpoch = Math.max(maxEpoch, state.epoch);
      elect();
      remember(source.address, source.discoveryPort ?? source.port).catch(report);
    } finally {
      transport.close?.();
      probing.delete(key);
    }
  }

  function chooseRemote(peer) {
    // A restarted service has a fresh change revision even when its endpoint is unchanged.
    const selectedName = peer ? `${peer.machine}:${peer.address}:${peer.port}:${peer.startedAt}` : null;
    if (selectedName === remoteName) return;
    remote?.close?.();
    remote = null;
    remoteName = selectedName;
    if (!peer || !material) return;
    remote = openRelanTransport({ address: peer.address, port: peer.port, key: material.key, now, timeoutMs: Math.max(timers.hostLossMs, longPollMs + timers.retryMs), onWire: options.onWire });
    const selectedRemote = remote;
    startPoll(selectedRemote);
    wake();
  }

  function elect() {
    if (closed || !listener || !material) return;
    const at = now();
    for (const [name, peer] of peers) if (at - peer.seenAt > timers.hostLossMs * 2) peers.delete(name);
    for (const [name, peer] of candidates) if (at - peer.seenAt > timers.hostLossMs * 2) candidates.delete(name);
    const live = [...peers.values()].filter((peer) => at - peer.seenAt <= timers.hostLossMs);
    const hosts = live.filter((peer) => peer.hosting);
    if (hosting) hosts.push({ ...ownState(), seenAt: at });
    hosts.sort((left, right) => right.epoch - left.epoch || compareName(left, right));
    const winner = hosts[0];
    if (winner) {
      const wasHosting = hosting;
      const previousHost = host;
      hosting = winner.machine === machine;
      host = winner.machine;
      lastHostAt = hosting ? at : winner.seenAt;
      epoch = Math.max(epoch, winner.epoch);
      maxEpoch = Math.max(maxEpoch, epoch);
      chooseRemote(hosting ? null : winner);
      if (wasHosting !== hosting || previousHost !== host) {
        announce();
        options.onStatus?.(status());
      }
      return;
    }
    hosting = false;
    host = null;
    chooseRemote(null);
    const waiting = lastHostAt === null ? at - openedAt < timers.initialMs : at - lastHostAt < timers.hostLossMs;
    if (waiting) return;
    const candidate = chooseCandidate([{ ...ownState(), rankingStartedAt: startedAt, rankingStartedAfter: startedAt }, ...live]);
    if (candidate.machine !== machine) return;
    epoch = Math.max(epoch, maxEpoch) + 1;
    maxEpoch = epoch;
    hosting = true;
    host = machine;
    lastHostAt = at;
    announce();
    options.onStatus?.(status());
  }

  function wake() {
    if (closed) return;
    listener?.changed();
    pending = true;
    if (!syncing) {
      syncing = sync().finally(() => {
        syncing = null;
        if (pending && !closed) wake();
      });
    }
  }

  async function sync() {
    while (pending && !closed) {
      pending = false;
      const selectedRemote = remote;
      if (!selectedRemote || !material) continue;
      try {
        const result = await replicate({ origin, getTransport: () => remote, keyProvider });
        lastError = null;
        retryAt = null;
        if (result.pulled || result.headsPulled || result.pushed || result.headsPushed) await options.onReplicated?.(result);
      } catch (error) {
        if (selectedRemote === remote) {
          report(error);
          retryAt = now() + timers.retryMs;
        }
      }
    }
  }

  function startPoll(transport) {
    const task = poll(transport);
    pollTask = task;
    task.finally(() => {
      if (pollTask === task) pollTask = null;
      nextPollAt = now() + timers.retryMs;
    });
  }

  async function poll(transport) {
    while (!closed && remote === transport) {
      try {
        await transport.waitForChange();
        if (remote !== transport || closed) break;
        wake();
      } catch (error) {
        if (remote !== transport || closed) break;
        report(error);
        break;
      }
    }
  }

  function networkSnapshot() {
    const addresses = typeof options.addresses === 'function' ? options.addresses() : options.addresses;
    const onlyLoopback = options.allowLoopback && Array.isArray(addresses) && addresses.every(address => typeof address === 'string' && address.startsWith('127.'));
    const interfaces = typeof options.interfaces === 'function' ? options.interfaces() : options.interfaces ?? (onlyLoopback ? [] : networkInterfaces());
    if (addresses === undefined && eligibleAddresses(interfaces).length === 0 || typeof options.addresses === 'function' && Array.isArray(addresses) && addresses.length === 0) {
      return { selected: [], interfaces };
    }
    return { selected: privateAddresses({ addresses, interfaces, allowLoopback: options.allowLoopback }), interfaces };
  }

  function refreshNetwork(initial = false) {
    if (closed) return Promise.resolve();
    if (networking) return networking;
    let snapshot;
    try {
      snapshot = networkSnapshot();
    } catch (error) {
      if (initial) return Promise.reject(error);
      report(error);
      snapshot = { selected: [], interfaces: [] };
    }
    const signature = JSON.stringify(snapshot.selected);
    if (signature === networkSignature) return Promise.resolve();
    const operation = makeNetwork(snapshot, signature);
    networking = operation.catch(report).finally(() => { networking = null; });
    return networking;
  }

  async function makeNetwork({ selected, interfaces }, signature) {
    networkGeneration += 1;
    const oldListener = listener;
    const oldDiscovery = discovery;
    listener = null;
    discovery = null;
    chooseRemote(null);
    hosting = false;
    host = null;
    lastHostAt = null;
    peers.clear();
    candidates.clear();
    await Promise.allSettled([oldDiscovery?.close(), oldListener?.close()]);
    networkSignature = null;
    if (closed) return;
    if (selected.length === 0) {
      networkSignature = signature;
      options.onStatus?.(status());
      return;
    }
    const folder = openFolderTransport({ directory: origin.paths.origin, store, keyProvider });
    const openedListener = await openRelanListener({
      transport: folder,
      keyProvider,
      getKey: () => material,
      pairing: { handleStart: (...args) => pairing.handleStart(...args), handleFinish: (...args) => serialize(async () => {
        const result = await pairing.handleFinish(...args);
        rememberAddress(args[1]).catch(report);
        return result;
      }) },
      onPeer: ({ address }) => { rememberAddress(address).catch(report); },
      addresses: selected.map((item) => item.address),
      interfaces,
      allowLoopback: options.allowLoopback,
      port: options.port ?? 43120,
      now,
      longPollMs,
      getState: ownState,
    });
    let openedDiscovery;
    try {
      if (!closed) openedDiscovery = await openDiscovery({ addresses: selected.map((item) => item.address), interfaces, allowLoopback: options.allowLoopback, ...options.discovery, peers: destinations, onMessage: receive, onError: report });
    } catch (error) {
      await openedListener.close();
      throw error;
    }
    if (closed) {
      await Promise.allSettled([openedListener.close(), openedDiscovery?.close()]);
      return;
    }
    listener = openedListener;
    discovery = openedDiscovery;
    networkSignature = signature;
    openedAt = now();
    lastError = null;
    announce();
    options.onStatus?.(status());
  }

  try {
    await refreshNetwork(true);
    refreshTailnet();
    await mkdir(origin.paths.origin, { recursive: true });
    watcher = watch(origin.paths.origin, { recursive: true }, wake);
    watcher.on('error', report);
    watcher.unref();
    interval = setInterval(() => {
      refreshNetwork().catch(report);
      refreshTailnet();
      elect();
      if (remote && !pollTask && now() >= nextPollAt) startPoll(remote);
      if (remote && retryAt !== null && !pending && !syncing && now() >= retryAt) wake();
    }, timers.tickMs);
    interval.unref();
    announcement = setInterval(announce, timers.announceMs);
    announcement.unref();
    announce();
    if (material) await options.onKey?.(material);
  } catch (error) {
    await close();
    throw error;
  }

  async function showCode() {
    assertOpen();
    await ensureKey();
    assertOpen();
    announce();
    return pairing.showCode();
  }

  async function join(code, target = null) {
    assertOpen();
    if (target?.host !== undefined) target = parsePeerAddress(target.host, 43120, { allowLoopback: options.allowLoopback });
    if (target) target = { ...target, ...parsePeerAddress(`${target.address}:${target.port}`, 43120, { allowLoopback: options.allowLoopback }) };
    if (!target) await waitForDiscovery(timers.initialMs + timers.announceMs);
    const choices = target ? [target] : [...candidates.values()].filter((item) => now() - item.seenAt <= timers.hostLossMs).sort((left, right) => compareName(left, right));
    if (choices.length === 0) throw new CoreError(503, 'relan_not_found', 'No ReLAN member has been discovered.');
    let failure;
    for (const candidate of choices) {
      try {
        const joined = await pairRelan({ address: candidate.address, port: candidate.port, code, timeoutMs: Math.max(timers.hostLossMs, 1000), onWire: options.onWire });
        assertOpen();
        if (retained && (retained.relanId !== joined.relanId || retained.keyId !== joined.keyId || !retained.key.equals(joined.key))) {
          throw new CoreError(409, 'relan_history_conflict', 'This local M1ND already belongs to another ReLAN; use a fresh local M1ND to join.');
        }
        assertOpen();
        await saveRelanKey(keyOptions, joined);
        assertOpen();
        await clearLeft();
        assertOpen();
        generation += 1;
        material = joined;
        retained = joined;
        pairing = newPairing();
        hosting = false;
        host = null;
        lastHostAt = null;
        epoch = 0;
        maxEpoch = 0;
        peers.clear();
        chooseRemote(null);
        await options.onKey?.(material);
        remember(candidate.address, candidate.discoveryPort).catch(report);
        const transport = openRelanTransport({ address: candidate.address, port: candidate.port, key: material.key, now, timeoutMs: Math.max(timers.hostLossMs, 1000), onWire: options.onWire });
        const requestedAt = now();
        try {
          const state = await transport.getState();
          if (validState(state) && state.relanId === material.relanId) {
            const seenAt = now();
            peers.set(state.machine, { ...state, rankingStartedAt: seenAt - state.uptimeMs, rankingStartedAfter: requestedAt - state.uptimeMs, address: candidate.address, port: candidate.port, seenAt });
            maxEpoch = state.epoch;
          }
        } finally {
          transport.close?.();
        }
        announce();
        elect();
        wake();
        return status();
      } catch (error) {
        if (error?.code === 'relan_history_conflict' || closed) throw error;
        failure = error;
      }
    }
    throw failure;
  }

  async function hostHere() {
    assertOpen();
    await ensureKey();
    assertOpen();
    await waitForDiscovery(timers.announceMs);
    await Promise.allSettled([...candidates.values()].filter((peer) => peer.relanId === material.relanId).map((peer) => probe({ host: peer.machine, port: peer.port }, peer, `${peer.address}:${peer.port}`)));
    assertOpen();
    epoch = Math.max(epoch, maxEpoch, ...[...peers.values()].map((peer) => peer.epoch)) + 1;
    maxEpoch = epoch;
    hosting = true;
    host = machine;
    lastHostAt = now();
    chooseRemote(null);
    announce();
    listener?.changed();
    options.onStatus?.(status());
    return status();
  }

  async function leave() {
    assertOpen();
    if (retained) {
      await writeDurable(store, leftFile, Buffer.from(`${JSON.stringify({ format: 'hivem1nd-relan-left-v1', relanId: retained.relanId })}\n`), [localDirectory]);
      await protectLocalFile(leftFile, keyOptions);
    }
    assertOpen();
    generation += 1;
    chooseRemote(null);
    material = null;
    hosting = false;
    host = null;
    epoch = 0;
    maxEpoch = 0;
    lastHostAt = null;
    lastError = null;
    peers.clear();
    pairing = newPairing();
    await options.onKey?.(null);
    options.onStatus?.(status());
    return status();
  }

  async function close() {
    if (closed) return;
    closed = true;
    generation += 1;
    for (const resolve of discoveryWaiters) resolve();
    clearInterval(interval);
    clearInterval(announcement);
    watcher?.close();
    remote?.close?.();
    remote = null;
    await Promise.allSettled([membership, networking, tailnetTask, discovery?.close(), listener?.close(), syncing, pollTask, ...probes, ...remembering.values()]);
  }

  function assertOpen() {
    if (closed) throw new CoreError(503, 'relan_closed', 'The ReLAN service has closed.');
  }

  function serialize(run) {
    const operation = membership.then(() => { assertOpen(); return run(); });
    membership = operation.catch(() => {});
    return operation;
  }

  async function waitForDiscovery(milliseconds) {
    if (candidates.size > 0) return;
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        discoveryWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      discoveryWaiters.add(finish);
    });
    assertOpen();
  }

  async function isLeft() {
    await assertNoLinks(leftFile, { root: store?.confineRoot });
    try {
      const info = await lstat(leftFile);
      if (!info.isFile() || info.size > 4096 || info.nlink !== 1) throw new CoreError(422, 'unsafe_path', 'The ReLAN membership marker must be a regular file.');
      await verifyLocalPermissions(leftFile, keyOptions);
      const value = JSON.parse(await readFile(leftFile, 'utf8'));
      if (value.format !== 'hivem1nd-relan-left-v1' || typeof value.relanId !== 'string') throw new CoreError(422, 'invalid_relan_membership', 'The ReLAN membership marker is not valid.');
      return retained?.relanId === value.relanId;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function clearLeft() {
    await assertNoLinks(leftFile, { root: store?.confineRoot });
    await unlink(leftFile).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }

  return { status, addPeer: (value) => serialize(() => addPeer(value)), removePeer: (value) => serialize(() => removePeer(value)), showCode: () => serialize(showCode), join: (...args) => serialize(() => join(...args)), host: () => serialize(hostHere), leave: () => serialize(leave), wake, close, keyProvider, encryption };
}

function validState(state) {
  try {
    validateMachineName(state?.machine);
    return Number.isFinite(state.startedAt) && Number.isFinite(state.uptimeMs) && state.uptimeMs >= 0 && typeof state.preferred === 'boolean' && typeof state.hosting === 'boolean' && Number.isSafeInteger(state.epoch) && state.epoch >= 0;
  } catch {
    return false;
  }
}

function compareName(left, right) {
  return left.machine < right.machine ? -1 : left.machine > right.machine ? 1 : 0;
}

function chooseCandidate(candidates) {
  const preferred = candidates.some(peer => peer.preferred) ? candidates.filter(peer => peer.preferred) : candidates;
  const oldestAt = Math.min(...preferred.map(peer => peer.rankingStartedAt));
  // Remote uptime was sampled between request and response; overlapping start intervals tie.
  return preferred.filter(peer => peer.rankingStartedAfter <= oldestAt).sort(compareName)[0];
}
