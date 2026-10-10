import { watch } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, canonicalJson, hashBytes, validateMachineName } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { packFileName, validateHead } from './pack.mjs';

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function openOrigin({ store, paths, now = () => Date.now(), machine } = {}) {
  if (!store || !paths?.origin || !paths?.localDirectory || !machine) {
    throw new CoreError(500, 'internal_error', 'An origin needs a store, a folder, and a machine.');
  }
  return {
    store,
    paths,
    now,
    machine: validateMachineName(machine),
    fault: null,
    watchers: [],
    closeWatch: null,
  };
}

export async function publishPack(origin, packBytes) {
  const bytes = Buffer.isBuffer(packBytes) ? packBytes : Buffer.from(packBytes);
  const digest = hashBytes(bytes);
  const head = await readHead(origin, origin.machine);
  const journal = await readJournal(origin);
  let sequence = (head?.sequence ?? 0) + 1;
  if (journal?.phase === 'prepared') {
    const existing = await readFileIfRegular(packPath(origin, origin.machine, journal.sequence));
    if (existing && hashBytes(existing) !== journal.packHash) {
      throw new CoreError(409, 'revision_conflict', 'A prepared pack sequence cannot be reused for different bytes.');
    }
    if (digest !== journal.packHash) {
      throw new CoreError(409, 'revision_conflict', 'A prepared pack sequence cannot be reused for different bytes.');
    }
    sequence = journal.sequence;
  } else if (journal?.phase === 'committed' && journal.packHash === digest) {
    return { sequence: journal.sequence, hash: digest, bytes: bytes.length, replayed: true };
  }
  if (head?.packs?.some((item) => item.sequence === sequence && item.hash !== digest)) {
    throw new CoreError(409, 'revision_conflict', 'A committed pack sequence cannot be reused for different bytes.');
  }
  const filename = packFileName(sequence);
  await writeJson(origin, journalPath(origin), {
    format: 'hivem1nd-publication-v1',
    phase: 'prepared',
    sequence,
    packHash: digest,
    bytes: bytes.length,
    file: filename,
  });
  await placePack(origin, sequence, bytes, digest);
  if (origin.fault === 'before-head') {
    origin.fault = null;
    throw new CoreError(500, 'injected_crash', 'Injected crash before the head was replaced.');
  }
  const packs = [...(head?.packs ?? []), { sequence, file: filename, hash: digest, bytes: bytes.length }];
  const next = {
    format: 'hivem1nd-head-v1',
    machine: origin.machine,
    sequence,
    updatedAt: new Date(origin.now()).toISOString(),
    packs,
  };
  validateHead(next, { machine: origin.machine, previous: head ?? undefined, packBytes: bytes, sequence });
  await writeJson(origin, headPath(origin, origin.machine), next);
  await writeJson(origin, journalPath(origin), {
    format: 'hivem1nd-publication-v1',
    phase: 'committed',
    sequence,
    packHash: digest,
    bytes: bytes.length,
    file: filename,
  });
  return { sequence, hash: digest, bytes: bytes.length, replayed: false };
}

export async function publishBeat(origin, beat) {
  if (!beat || beat.format !== 'hivem1nd-service-v1' || beat.machine !== origin.machine) {
    throw new CoreError(422, 'invalid_record_owner', 'A machine publishes only its own heartbeat.');
  }
  if (beat.state !== 'running' && beat.state !== 'stopped') throw new CoreError(422, 'invalid_body', 'The heartbeat state is not valid.');
  if (!TIME.test(beat.heartbeatAt ?? '') || !TIME.test(beat.startedAt ?? '')) throw new CoreError(422, 'invalid_body', 'The heartbeat time must be UTC.');
  const record = {
    format: 'hivem1nd-service-v1',
    machine: origin.machine,
    state: beat.state,
    version: beat.version,
    heartbeatAt: beat.heartbeatAt,
    startedAt: beat.startedAt,
  };
  await writeJson(origin, path.join(machineDir(origin, origin.machine), 'service.json'), record);
  return record;
}

export async function readHead(origin, machine) {
  const owner = validateMachineName(machine);
  const bytes = await readFileIfRegular(headPath(origin, owner));
  if (!bytes) return null;
  return validateHead(bytes, { machine: owner });
}

export async function readOriginPack(origin, machine, sequence) {
  const owner = validateMachineName(machine);
  return readFileIfRegular(packPath(origin, owner, sequence));
}

export function watchOrigin(origin, listener, { debounceMs = 50 } = {}) {
  if (typeof listener !== 'function') throw new CoreError(422, 'invalid_body', 'The origin watcher needs a listener.');
  const machines = path.join(origin.paths.origin, 'machines');
  let timer = null;
  let closed = false;
  const watchers = [];
  const schedule = (kind) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) listener({ type: kind });
    }, debounceMs);
    timer.unref?.();
  };
  const arm = (directory) => {
    try {
      const watcher = watch(directory, { persistent: false, recursive: process.platform === 'win32' || process.platform === 'darwin' }, (_event, filename) => {
        const name = filename ? String(filename) : '';
        if (!name) {
          schedule('rescan');
          return;
        }
        if (name.endsWith('.tmp') || name.startsWith('.')) return;
        schedule('origin');
      });
      watcher.on('error', () => {
        watcher.close();
        schedule('restart');
        if (!closed) arm(directory);
      });
      watchers.push(watcher);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
  origin.closeWatch = async () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    origin.watchers = [];
    origin.closeWatch = null;
  };
  origin.watchers = watchers;
  listener({ type: 'reconcile' });
  arm(machines);
  return origin.closeWatch;
}

export async function closeOrigin(origin) {
  if (origin.closeWatch) await origin.closeWatch();
}

export async function writeDurable(store, file, bytes, roots) {
  const resolved = path.resolve(file);
  const allowed = (roots ?? []).filter(Boolean).some((root) => isInside(root, resolved));
  if (!allowed) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the mind, origin, or registered project.');
  if (store.confineRoot && !isInside(store.confineRoot, resolved)) throw new CoreError(422, 'unsafe_path', 'Refusing to write outside the test root.');
  await assertNoLinks(resolved, { root: store.confineRoot });
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${Math.random().toString(16).slice(2)}.tmp`);
  const handle = await open(temporary, 'wx');
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, resolved);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  store.writes?.push(resolved);
  return resolved;
}

async function placePack(origin, sequence, bytes, digest) {
  const file = packPath(origin, origin.machine, sequence);
  const existing = await readFileIfRegular(file);
  if (existing) {
    if (hashBytes(existing) !== digest) throw new CoreError(409, 'revision_conflict', 'A committed pack sequence cannot be reused for different bytes.');
    return file;
  }
  return writeDurable(origin.store, file, bytes, originRoots(origin));
}

async function writeJson(origin, file, value) {
  await writeDurable(origin.store, file, Buffer.from(`${canonicalJson(value)}\n`, 'utf8'), originRoots(origin));
}

async function readJournal(origin) {
  const bytes = await readFileIfRegular(journalPath(origin));
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf8'));
}

async function readFileIfRegular(file) {
  try {
    const stats = await lstat(file);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
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
}

function originRoots(origin) {
  return [origin.paths.origin, origin.paths.localDirectory, origin.store.confineRoot];
}

function machineDir(origin, machine) {
  return path.join(origin.paths.origin, 'machines', machine);
}

function headPath(origin, machine) {
  return path.join(machineDir(origin, machine), 'head.json');
}

function packPath(origin, machine, sequence) {
  return path.join(machineDir(origin, machine), 'packs', packFileName(sequence));
}

function journalPath(origin) {
  return path.join(origin.paths.localDirectory, 'outgoing', 'publication.json');
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function listMachineNames(origin) {
  const directory = path.join(origin.paths.origin, 'machines');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
}
