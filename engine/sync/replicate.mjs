import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, validateMachineName } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { withOriginWrite, writeDurable } from './origin.mjs';
import { decodePack, packFileName, validateHead } from './pack.mjs';

const CORRUPT_PACK_ERRORS = new Set(['invalid_pack', 'invalid_json', 'corrupt_resource', 'invalid_record_owner', 'resource_too_large', 'pack_too_large']);

// A transport lists complete heads and reads/writes immutable packs by machine and sequence.
// writeHead publishes only after its packs are durable. waitForChange is optional;
// getTransport is synchronous and a changed instance makes this pass retryable.
export async function replicate({ origin, transport = null, getTransport = null, keyProvider = null } = {}) {
  if (!origin?.paths?.origin || !origin.store || !origin.machine) {
    throw new CoreError(500, 'internal_error', 'Replication needs a local mirror origin.');
  }
  const machine = validateMachineName(origin.machine);
  const selected = getTransport ? getTransport() : transport;
  for (const method of ['listHeads', 'readPack', 'writePack', 'writeHead']) {
    if (typeof selected?.[method] !== 'function') throw new CoreError(500, 'internal_error', `The transport needs ${method}.`);
  }
  const local = openFolderTransport({ directory: origin.paths.origin, store: origin.store, keyProvider });
  const checkTransport = () => {
    if (getTransport && getTransport() !== selected) throw new CoreError(409, 'transport_changed', 'The replication transport changed; retry with the current host.');
  };
  const call = async (target, method, ...args) => {
    checkTransport();
    const result = await target[method](...args);
    checkTransport();
    return result;
  };
  const localHeads = headsByMachine(await call(local, 'listHeads'));
  const remoteHeads = headsByMachine(await call(selected, 'listHeads'));
  const result = { pushed: 0, pulled: 0, headsPushed: 0, headsPulled: 0 };
  // Publish local work before a slow foreign history can delay its availability to other members.
  const machines = [...new Set([...localHeads.keys(), ...remoteHeads.keys()])].sort((left, right) => Number(right === machine) - Number(left === machine) || left.localeCompare(right, 'en'));
  for (const owner of machines) {
    const localHead = localHeads.get(owner);
    const remoteHead = remoteHeads.get(owner);
    if (localHead && remoteHead) compatibleHeads(localHead, remoteHead);
    if (owner === machine && !localHead) continue;
    const head = owner === machine || (localHead?.sequence ?? -1) >= (remoteHead?.sequence ?? -1) ? localHead : remoteHead;
    for (const entry of head.packs) {
      const localBytes = await call(local, 'readPack', owner, entry.sequence);
      const localPack = inspectPack(localBytes, head, entry, Boolean(localHead?.packs.some((item) => item.sequence === entry.sequence)), keyProvider);
      if (owner === machine && !localPack) throw missingPack(owner, entry.sequence);
      const remoteBytes = await call(selected, 'readPack', owner, entry.sequence);
      const remotePack = inspectPack(remoteBytes, head, entry, Boolean(remoteHead?.packs.some((item) => item.sequence === entry.sequence)), keyProvider);
      const bytes = localPack ?? remotePack;
      if (!bytes) throw missingPack(owner, entry.sequence);
      if (!remotePack) {
        await call(selected, 'writePack', owner, entry.sequence, bytes);
        result.pushed += 1;
      }
      if (!localPack && owner !== machine) {
        await call(local, 'writePack', owner, entry.sequence, bytes);
        result.pulled += 1;
      }
    }
    if (!remoteHead || remoteHead.sequence < head.sequence) {
      await call(selected, 'writeHead', head);
      result.headsPushed += 1;
    }
    if (owner !== machine && (!localHead || localHead.sequence < head.sequence)) {
      await call(local, 'writeHead', head);
      result.headsPulled += 1;
    }
  }
  return result;
}

export function openFolderTransport({ directory, store = {}, keyProvider = null } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new CoreError(422, 'invalid_path', 'The transport folder must be absolute.');
  const root = path.resolve(directory);
  const machinePath = (machine) => path.join(root, 'machines', validateMachineName(machine));
  const headPath = (machine) => path.join(machinePath(machine), 'head.json');
  const packPath = (machine, sequence) => path.join(machinePath(machine), 'packs', packFileName(sequence));
  const read = async (file) => {
    await assertNoLinks(file, { root: store.confineRoot });
    try {
      const stats = await lstat(file);
      if (!stats.isFile()) throw new CoreError(422, 'unsafe_path', 'The transport resource must be a regular file.');
      const handle = await open(file, 'r');
      try {
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  };
  const readHead = async (machine) => {
    const bytes = await read(headPath(machine));
    return bytes ? completeHead(bytes, machine) : null;
  };
  const readPack = (machine, sequence) => read(packPath(machine, sequence));
  return {
    async listHeads() {
      const directory = path.join(root, 'machines');
      await assertNoLinks(directory, { root: store.confineRoot });
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      const heads = [];
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to follow a transport link.');
        if (!entry.isDirectory()) continue;
        const head = await readHead(entry.name);
        if (head) heads.push(head);
      }
      return heads;
    },
    readPack,
    async writePack(machine, sequence, bytes) {
      return withOriginWrite(root, machine, async () => {
        const file = packPath(machine, sequence);
        const packed = asBuffer(bytes);
        const decoded = decodePack(packed, { machine, keyProvider });
        if (decoded.header.sequence !== sequence) throw new CoreError(422, 'corrupt_resource', 'The pack sequence does not match its filename.');
        const head = await readHead(machine);
        const committed = head?.packs.find((entry) => entry.sequence === sequence);
        if (committed) validateHead(head, { packBytes: packed, sequence });
        const existing = await read(file);
        if (existing) {
          if (existing.equals(packed)) return false;
          if (committed) throw new CoreError(422, 'corrupt_resource', 'The committed pack bytes do not match the head.');
          refuseValidConflict(existing, keyProvider);
        }
        await writeDurable(store, file, packed, [root]);
        return true;
      });
    },
    async writeHead(value) {
      const head = completeHead(value);
      return withOriginWrite(root, head.machine, async () => {
        const previous = await readHead(head.machine);
        if (previous) {
          compatibleHeads(previous, head);
          if (previous.sequence >= head.sequence) return false;
        }
        for (const entry of head.packs) {
          const bytes = await readPack(head.machine, entry.sequence);
          if (!bytes) throw missingPack(head.machine, entry.sequence);
          checkedPack(bytes, head, entry, keyProvider);
        }
        await writeDurable(store, headPath(head.machine), Buffer.from(`${canonicalJson(head)}\n`, 'utf8'), [root]);
        return true;
      });
    },
  };
}

function headsByMachine(values) {
  if (!Array.isArray(values)) throw new CoreError(422, 'invalid_pack', 'The transport heads must be a list.');
  const heads = new Map();
  for (const value of values) {
    const head = completeHead(value);
    if (heads.has(head.machine)) throw new CoreError(422, 'invalid_pack', 'The transport repeats a machine head.');
    heads.set(head.machine, head);
  }
  return heads;
}

function completeHead(value, machine = null) {
  const head = validateHead(value, { machine });
  if (head.packs.some((entry, index) => entry.sequence !== index + 1)) throw new CoreError(422, 'invalid_pack', 'The head must include every prior pack sequence.');
  return head;
}

function compatibleHeads(left, right) {
  if (left.sequence >= right.sequence) validateHead(left, { previous: right });
  else validateHead(right, { previous: left });
}

function inspectPack(bytes, head, entry, committed, keyProvider) {
  if (bytes === null || bytes === undefined) return null;
  const packed = asBuffer(bytes);
  if (packed.length === entry.bytes && hashBytes(packed) === entry.hash) return checkedPack(packed, head, entry, keyProvider);
  if (committed) throw new CoreError(422, 'corrupt_resource', 'The committed pack bytes do not match the head.');
  refuseValidConflict(packed, keyProvider);
  return null;
}

function refuseValidConflict(bytes, keyProvider) {
  try {
    decodePack(bytes, { keyProvider });
  } catch (error) {
    if (CORRUPT_PACK_ERRORS.has(error?.code)) return;
    throw error;
  }
  throw new CoreError(409, 'revision_conflict', 'An immutable pack sequence already contains different valid bytes.');
}

function checkedPack(bytes, head, entry, keyProvider) {
  validateHead(head, { packBytes: bytes, sequence: entry.sequence });
  const decoded = decodePack(bytes, { expectedHash: entry.hash, machine: head.machine, keyProvider });
  if (decoded.header.sequence !== entry.sequence) throw new CoreError(422, 'corrupt_resource', 'The pack sequence does not match the head.');
  return bytes;
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  throw new CoreError(422, 'invalid_pack', 'Pack bytes are required.');
}

function missingPack(machine, sequence) {
  return new CoreError(409, 'missing_pack', `The ${machine} pack at sequence ${sequence} is not available; retry replication later.`);
}
