import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRelan } from '../engine/relan/runtime.mjs';
import { createStore } from '../engine/service/store.mjs';
import { applyPack } from '../engine/sync/apply.mjs';
import { openLedger } from '../engine/sync/limits.mjs';
import { listMachineNames, openOrigin, readHead, readOriginPack } from '../engine/sync/origin.mjs';
import { createPulse } from '../engine/sync/pulse.mjs';
import { openSync, stageTransaction } from '../engine/sync/store.mjs';

const options = JSON.parse(process.argv[2]);
const paths = { mind: path.join(options.root, 'mind'), localDirectory: path.join(options.root, 'local'),
  origin: path.join(options.root, 'mirror'), machine: options.machine };
for (const directory of [path.join(paths.mind, 'user'), paths.localDirectory, paths.origin]) await mkdir(directory, { recursive: true });
const now = () => Date.now();
const store = createStore({ root: options.root, confineRoot: options.root, mindPath: paths.mind, localDirectory: paths.localDirectory, now });
const sync = openSync({ store, paths, now });
let relan;
const keyProvider = id => relan?.keyProvider(id) ?? null;
const origin = openOrigin({ store, paths, now, machine: paths.machine, keyProvider });
const ledger = openLedger({ store, paths, now, machine: paths.machine });
let applying = null;
let applyError = null;
async function applyAll() {
  if (applying) return applying;
  applying = (async () => {
    const provider = { readHead: machine => readHead(origin, machine),
      readPack: (machine, sequence) => readOriginPack(origin, machine, sequence), keyProvider };
    for (const machine of await listMachineNames(origin)) {
      if (machine === paths.machine) continue;
      for (const pack of (await readHead(origin, machine))?.packs ?? []) {
        await applyPack(sync, await readOriginPack(origin, machine, pack.sequence), { provider, ledger });
      }
    }
    applyError = null;
  })().catch(error => { applyError = `${error.code ?? 'error'}: ${error.message}`; }).finally(() => { applying = null; });
  return applying;
}
relan = await createRelan({ origin, localDirectory: paths.localDirectory, machine: paths.machine, store,
  addresses: ['127.0.0.1'], allowLoopback: true, port: 0, discovery: options.discovery,
  preferred: options.preferred, startedAt: options.startedAt, onReplicated: applyAll,
  timers: { initialMs: 250, announceMs: 150, hostLossMs: 1800, tickMs: 75, retryMs: 150, peerMs: 2000 } });
const pulse = createPulse({ sync, origin, ledger, now, setTimeout, clearTimeout,
  keyProvider, encryption: () => relan.encryption(), ready: () => relan.status().paired });
const applyTimer = setInterval(() => void applyAll(), 150);
let closed = false;
async function close() {
  if (closed) return;
  closed = true;
  clearInterval(applyTimer);
  await pulse.close().done;
  await relan.close();
  await applying;
}

async function command(input) {
  if (input.action === 'status') return { ...relan.status(), applyError };
  if (input.action === 'code') return relan.showCode();
  if (input.action === 'join') return relan.join(input.code, input.target);
  if (input.action === 'peer-add') return relan.addPeer(input.address);
  if (input.action === 'host') return relan.host();
  if (input.action === 'write') {
    const target = { kind: 'mind', path: `user/${paths.machine}.txt` };
    const bytes = Buffer.from(input.text);
    await writeFile(path.join(paths.mind, target.path), bytes);
    const changes = await stageTransaction(sync, [{ target, bytes }]);
    await pulse.changed(changes.map(change => change.id));
    const result = await pulse.flush();
    relan.wake();
    if (!result.published) throw new Error(`The pulse did not publish: ${JSON.stringify(result)}`);
    return result;
  }
  if (input.action === 'files') {
    await applyAll();
    return Object.fromEntries(await Promise.all(input.machines.map(async machine => [machine,
      await readFile(path.join(paths.mind, 'user', `${machine}.txt`), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })])));
  }
  if (input.action === 'close') { await close(); return { closed: true }; }
  throw new Error('Unknown simulation command.');
}

let queue = Promise.resolve();
process.on('message', input => {
  queue = queue.then(async () => {
    try { process.send?.({ id: input.id, result: await command(input) }); }
    catch (error) { process.send?.({ id: input.id, error: `${error.code ?? 'error'}: ${error.message}` }); }
  });
});
process.once('disconnect', () => { void close().finally(() => process.exit()); });
process.send?.({ ready: true, pid: process.pid, machine: paths.machine });
