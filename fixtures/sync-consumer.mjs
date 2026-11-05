import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_API_VERSION, createSyncCoordinator } from 'hivem1nd/sync';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(checkout, '.test-tmp');
const at = '2026-10-28T12:00:00.000Z';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const fixtureCodec = {
  format: 'consumer-fixture', version: 1, encryption: 'none',
  async encode(bytes) { return Buffer.from(bytes); },
  async decode(bytes) { return Buffer.from(bytes); },
};

export function fixtureClock() {
  let current = Date.parse(at);
  let next = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, at: current + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) { current += milliseconds; },
    runNext() {
      const [id, timer] = [...timers].sort((left, right) => left[1].at - right[1].at)[0] ?? [];
      if (!timer) throw new Error('No fixture timer is scheduled.');
      timers.delete(id);
      current = Math.max(current, timer.at);
      return timer.callback();
    },
    get timers() { return timers.size; },
  };
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(full));
    else files.push(full);
  }
  return files;
}

const encodeGroup = group => ({ ...group, entries: group.entries.map(entry => ({ ...entry, bytes: entry.bytes == null ? null : Buffer.from(entry.bytes).toString('base64') })) });
const decodeGroup = group => ({ ...group, entries: group.entries.map(entry => ({ ...entry, bytes: entry.bytes === null ? null : Buffer.from(entry.bytes, 'base64') })) });

export function makeGroup(entries, options = {}) {
  return { transactionId: options.transactionId ?? randomUUID(), at: options.at ?? at,
    entries: entries.map(entry => ({ id: randomUUID(), operation: 'put', baseHash: null, messageId: null, ...entry,
      bytes: entry.operation === 'delete' ? null : Buffer.from(entry.bytes ?? 'consumer-owned content') })) };
}

export async function createConsumer(root, machine, options = {}) {
  const directory = path.join(root, machine);
  const file = path.join(directory, 'consumer.json');
  await mkdir(directory, { recursive: true });
  if (!await readJson(file)) await writeJson(file, { outbox: [], values: {}, applied: [], acknowledgments: [] });
  const control = { beforeAck: null, beforeApply: null, validate: null, serialize: null, validations: 0, applyCalls: 0, listCalls: 0 };
  const state = () => readJson(file);
  const outbox = {
    async listCommitted() { control.listCalls += 1; return (await state()).outbox.map(decodeGroup); },
    async ackStaged(transactionId, changeIds) {
      if (control.beforeAck) await control.beforeAck(transactionId, changeIds);
      const current = await state();
      const group = current.outbox.find(item => item.transactionId === transactionId);
      if (group) assert.deepEqual([...changeIds].sort(), group.entries.map(entry => entry.id).sort());
      current.outbox = current.outbox.filter(item => item.transactionId !== transactionId);
      if (!current.acknowledgments.some(item => item.transactionId === transactionId)) current.acknowledgments.push({ transactionId, changeIds });
      await writeJson(file, current);
    },
  };
  const domain = {
    async validate(entry) {
      control.validations += 1;
      if (control.validate) return control.validate(entry);
      return entry.target?.collection === 'consumer-table' && typeof entry.target.row === 'string';
    },
    async serialize(entry) {
      if (control.serialize) return control.serialize(entry);
      return { target: entry.target, bytes: entry.bytes, baseHash: entry.baseHash, messageId: entry.messageId };
    },
    async applyAtomic(group, context) {
      control.applyCalls += 1;
      if (control.beforeApply) await control.beforeApply(group, context);
      const current = await state();
      if (current.applied.some(item => item.transactionId === group.transactionId)) return { status: 'replayed' };
      for (const entry of group.entries) {
        const key = JSON.stringify(entry.target);
        if (entry.operation === 'delete') delete current.values[key];
        else current.values[key] = Buffer.from(entry.bytes).toString('base64');
      }
      current.applied.push({ transactionId: group.transactionId, changeIds: group.entries.map(entry => entry.id), at: group.at, context });
      await writeJson(file, current);
      return { status: 'applied' };
    },
  };
  return { control, domain, state, file,
    store: { namespace: options.namespace ?? 'consumer-fixture-v1', machine, localDirectory: path.join(directory, 'runtime'), outbox },
    async commit(group) {
      const current = await state();
      assert.ok(!current.outbox.some(item => item.transactionId === group.transactionId));
      for (const entry of group.entries) {
        const key = JSON.stringify(entry.target);
        if (entry.operation === 'delete') delete current.values[key];
        else current.values[key] = Buffer.from(entry.bytes).toString('base64');
      }
      current.outbox.push(encodeGroup(group));
      await writeJson(file, current);
      return group;
    },
  };
}

export function createOrigin(root) {
  const directory = path.join(root, 'callback-origin');
  const controls = { ackScope: 'filesystem', publish: null, hiddenHeads: new Set(), hiddenPacks: new Set(), calls: [],
    publications: [], watchers: new Set(), closes: 0, unwatches: 0 };
  const machinePath = machine => path.join(directory, machine);
  const packPath = (machine, sequence) => path.join(machinePath(machine), `${String(sequence).padStart(12, '0')}.pack`);
  const requireSignal = (operation, options, context = {}) => {
    assert.ok(options?.signal instanceof AbortSignal, `${operation} receives an AbortSignal`);
    controls.calls.push({ operation, signal: options.signal, ...context });
    options.signal.throwIfAborted();
  };
  async function publish(packet, options) {
    assert.equal(packet.digest, digest(packet.bytes));
    const file = packPath(packet.machine, packet.sequence);
    let previous = null;
    try { previous = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) assert.equal(digest(previous), packet.digest, 'a writer sequence is immutable');
    else {
      await mkdir(path.dirname(file), { recursive: true });
      const handle = await open(file, 'wx');
      try { await handle.writeFile(packet.bytes); await handle.sync(); } finally { await handle.close(); }
    }
    const headFile = path.join(machinePath(packet.machine), 'head.json');
    const previousHead = await readJson(headFile, { packs: [] });
    const packs = previousHead.packs.filter(item => item.sequence !== packet.sequence);
    packs.push({ sequence: packet.sequence, file: path.basename(file), hash: packet.digest, bytes: packet.bytes.length });
    packs.sort((left, right) => left.sequence - right.sequence);
    await writeJson(headFile, { format: 'hivem1nd-head-v1', machine: packet.machine, sequence: packet.sequence, updatedAt: at, packs });
    controls.publications.push({ machine: packet.machine, sequence: packet.sequence, digest: packet.digest, bytes: Buffer.from(packet.bytes) });
    return { machine: packet.machine, sequence: packet.sequence, digest: packet.digest, ackScope: controls.ackScope };
  }
  return { controls, directory, packPath,
    notify(error = null) { for (const watcher of controls.watchers) { if (error) watcher.onError(error); else watcher.onChange(); } },
    async head(machine) { return readJson(path.join(machinePath(machine), 'head.json')); },
    async replacePack(machine, sequence, bytes) {
      const file = packPath(machine, sequence);
      const handle = await open(file, 'w');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const head = await this.head(machine);
      Object.assign(head.packs.find(item => item.sequence === sequence), { hash: digest(bytes), bytes: bytes.length });
      await writeJson(path.join(machinePath(machine), 'head.json'), head);
    },
    adapter() {
      return {
        async publishPack(packet, options) {
          requireSignal('publishPack', options, { machine: packet.machine, sequence: packet.sequence });
          return controls.publish ? controls.publish(packet, options, publish) : publish(packet, options);
        },
        async readHead(machine, options) {
          requireSignal('readHead', options, { machine });
          return controls.hiddenHeads.has(machine) ? null : readJson(path.join(machinePath(machine), 'head.json'));
        },
        async readPack(machine, sequence, options) {
          requireSignal('readPack', options, { machine, sequence });
          if (controls.hiddenPacks.has(`${machine}:${sequence}`)) return null;
          try { return await readFile(packPath(machine, sequence)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        },
        async listMachines(options) {
          requireSignal('listMachines', options);
          return readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        },
        async reconcile(options) { requireSignal('reconcile', options); },
        async close() { controls.closes += 1; },
        watch(onChange, onError) {
          const watcher = { onChange, onError };
          controls.watchers.add(watcher);
          return () => { controls.watchers.delete(watcher); controls.unwatches += 1; };
        },
      };
    },
  };
}

export async function createFixture() {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, 'sync-api-'));
  const origin = createOrigin(root);
  const coordinators = new Set();
  return { root, origin,
    consumer: (machine, options) => createConsumer(root, machine, options),
    async coordinator(consumer, options = {}) {
      const coordinator = await createSyncCoordinator({ store: consumer.store, domain: consumer.domain,
        codec: fixtureCodec, origin: origin.adapter(), clock: fixtureClock(), ...options });
      coordinators.add(coordinator);
      return coordinator;
    },
    async dispose() {
      await Promise.allSettled([...coordinators].map(coordinator => coordinator.close()));
      assert.equal(path.dirname(root), temporaryRoot);
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function runConsumerFixture() {
  assert.equal(SYNC_API_VERSION, 1);
  const fixture = await createFixture();
  try {
    const writer = await fixture.consumer('WRITER');
    const receiver = await fixture.consumer('RECEIVER');
    const group = await writer.commit(makeGroup([{ target: { collection: 'consumer-table', row: 'opaque-id', nested: { shard: 3 } }, bytes: 'opaque consumer record' }]));
    // No changed() call: the durable outbox is the only startup source.
    let first = await fixture.coordinator(writer);
    assert.equal((await first.status()).groups[0].state, 'durable-local');
    await first.resume();
    assert.equal((await first.status()).pending, 1);
    await first.flush();
    const second = await fixture.coordinator(receiver);
    await second.resume();
    await second.resume();
    assert.equal((await receiver.state()).applied.length, 1);
    assert.equal((await receiver.state()).applied[0].transactionId, group.transactionId);
    assert.equal((await receiver.state()).outbox.length, 0, 'an import does not echo');
    const pending = await writer.commit(makeGroup([{ target: { collection: 'consumer-table', row: 'after-close' }, bytes: 'durable unfinished record' }]));
    await first.changed(pending.entries.map(entry => entry.id));
    await first.close();
    first = await fixture.coordinator(await fixture.consumer('WRITER'));
    assert.equal((await first.status()).pending, 1, 'close retains staged pending work');
    await first.resume();
    await first.flush();
    await second.resume();
    assert.equal((await receiver.state()).applied.length, 2);
    return { apiVersion: SYNC_API_VERSION, appliedTransactions: 2, lostNotificationRecovered: true, pendingCloseRecovered: true };
  } finally { await fixture.dispose(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runConsumerFixture())}\n`);
}
