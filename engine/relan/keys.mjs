import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { protectBootstrapFiles, protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';

function keyFile(options) {
  if (typeof options.localDirectory !== 'string' || !path.isAbsolute(options.localDirectory)) {
    throw new CoreError(422, 'invalid_path', 'The ReLAN key needs the local service directory.');
  }
  return path.join(options.localDirectory, 'relan-key.json');
}

function material(value) {
  if (!value || typeof value.relanId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.relanId)
    || typeof value.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.keyId)
    || !Buffer.isBuffer(value.key) || value.key.length !== 32) {
    throw new CoreError(422, 'invalid_relan_key', 'The ReLAN key is not valid.');
  }
  return { relanId: value.relanId, keyId: value.keyId, key: Buffer.from(value.key) };
}

export async function loadRelanKey(options = {}) {
  const file = keyFile(options);
  await assertNoLinks(file, { root: options.store?.confineRoot });
  let handle;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 4096
      || typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new CoreError(422, 'unsafe_path', 'The ReLAN key must be a private regular file.');
    }
    await verifyLocalPermissions(options.localDirectory, options);
    await verifyLocalPermissions(file, options);
    const value = JSON.parse(await handle.readFile('utf8'));
    if (value.format !== 'hivem1nd-relan-key-v1' || typeof value.key !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(value.key)) throw new CoreError(422, 'invalid_relan_key', 'The saved ReLAN key is not valid.');
    const result = material({ ...value, key: Buffer.from(value.key, 'base64url') });
    await assertNoLinks(file, { root: options.store?.confineRoot });
    const current = await lstat(file);
    if (current.dev !== info.dev || current.ino !== info.ino) throw new CoreError(409, 'relan_key_changed', 'The ReLAN key changed while reading.');
    return result;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function saveRelanKey(options = {}, value) {
  const saved = material(value);
  const file = keyFile(options);
  await assertNoLinks(file, { root: options.store?.confineRoot });
  await mkdir(options.localDirectory, { recursive: true, mode: 0o700 });
  await protectLocalFile(options.localDirectory, options);
  await verifyLocalPermissions(options.localDirectory, options);
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ format: 'hivem1nd-relan-key-v1', ...saved, key: saved.key.toString('base64url') })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await protectBootstrapFiles(options.localDirectory, temporary, options);
    await assertNoLinks(file, { root: options.store?.confineRoot });
    await rename(temporary, file);
    await verifyLocalPermissions(file, options);
  } finally {
    await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }
  return saved;
}

const creating = new Map();

export async function createRelanKey(options = {}) {
  const file = keyFile(options);
  if (creating.has(file)) return creating.get(file);
  const pending = (async () => (await loadRelanKey(options)) ?? saveRelanKey(options, {
    relanId: randomUUID(), keyId: randomUUID(), key: randomBytes(32),
  }))();
  creating.set(file, pending);
  try { return await pending; } finally { creating.delete(file); }
}

export async function removeRelanKey(options = {}) {
  const file = keyFile(options);
  await assertNoLinks(file, { root: options.store?.confineRoot });
  await unlink(file).catch(error => { if (error?.code !== 'ENOENT') throw error; });
}
