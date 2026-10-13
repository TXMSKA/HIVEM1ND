import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './service/identity.mjs';
import { assertNoLinks } from './service/paths.mjs';

function contains(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export async function legacyTreeInventory(sourcePath) {
  await assertNoLinks(sourcePath);
  const root = path.resolve(sourcePath);
  const entries = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const input = path.join(directory, entry.name);
      const state = await lstat(input);
      const relative = path.relative(root, input).split(path.sep).join('/');
      if (state.isSymbolicLink() || !state.isDirectory() && !state.isFile()) {
        throw new CoreError(422, 'unsafe_path', 'Refusing an unsupported or linked legacy entry.');
      }
      if (state.isDirectory()) {
        entries.push({ path: relative, kind: 'directory' });
        await visit(input);
      } else {
        entries.push({ path: relative, kind: 'file', sha256: createHash('sha256').update(await readFile(input)).digest('hex') });
      }
    }
  }
  await visit(root);
  return entries;
}

// Resume accepts only the original inventory and byte-verified copied entries.
// A destination file is never replaced, including an uncheckpointed partial write.
export async function copyLegacyTree(sourcePath, destinationPath, options = {}) {
  await assertNoLinks(sourcePath);
  await assertNoLinks(destinationPath);
  const source = await realpath(sourcePath);
  const destination = path.resolve(destinationPath);
  if (contains(source, destination) || contains(destination, source)) {
    throw new CoreError(422, 'invalid_path', 'The source and destination must be separate folders.');
  }
  const sourceState = await lstat(source);
  if (!sourceState.isDirectory()) throw new CoreError(422, 'invalid_path', 'The legacy M1ND must be a folder.');
  const inventory = await legacyTreeInventory(source);
  if (options.inventory && JSON.stringify(inventory) !== JSON.stringify(options.inventory)) {
    throw new CoreError(409, 'legacy_changed', 'The legacy M1ND changed after setup was prepared.');
  }
  if (options.resume) {
    if (!options.inventory || !Array.isArray(options.completed)) throw new CoreError(409, 'checkpoint_changed', 'Copy resume needs its original inventory.');
    await mkdir(destination, { recursive: true });
    const actual = await legacyTreeInventory(destination);
    for (const entry of actual) {
      const expected = inventory.find(item => item.path === entry.path);
      if (!expected || JSON.stringify(entry) !== JSON.stringify(expected)) {
        throw new CoreError(409, 'checkpoint_changed', 'A partial destination entry changed.');
      }
    }
    for (const entry of options.completed) {
      if (!actual.some(item => JSON.stringify(item) === JSON.stringify(entry))) {
        throw new CoreError(409, 'checkpoint_changed', 'A completed copy entry is missing or changed.');
      }
    }
  } else {
    await mkdir(destination, { recursive: false });
  }
  let files = 0;
  for (const entry of inventory) {
    const input = path.join(source, entry.path);
    const output = path.join(destination, entry.path);
    await assertNoLinks(input);
    await assertNoLinks(output);
    if (entry.kind === 'directory') {
      await mkdir(output, { recursive: true });
      continue;
    }
    const before = createHash('sha256').update(await readFile(input)).digest('hex');
    if (before !== entry.sha256) throw new CoreError(409, 'legacy_changed', 'A legacy entry changed during the copy.');
    if (!options.completed?.some(item => JSON.stringify(item) === JSON.stringify(entry))) {
      try { await copyFile(input, output, constants.COPYFILE_EXCL); }
      catch (error) { if (!options.resume || error.code !== 'EEXIST') throw error; }
    }
    const copied = createHash('sha256').update(await readFile(output)).digest('hex');
    if (copied !== entry.sha256) throw new CoreError(409, 'checkpoint_changed', 'A copied entry could not be verified.');
    files += 1;
    await options.onCheckpoint?.(entry);
  }
  if (JSON.stringify(await legacyTreeInventory(source)) !== JSON.stringify(inventory)) {
    throw new CoreError(409, 'legacy_changed', 'The legacy M1ND changed during the copy.');
  }
  return { files };
}
