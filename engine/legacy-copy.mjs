import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './service/identity.mjs';
import { assertNoLinks } from './service/paths.mjs';

function contains(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export async function copyLegacyTree(sourcePath, destinationPath) {
  await assertNoLinks(sourcePath);
  await assertNoLinks(destinationPath);
  const source = await realpath(sourcePath);
  const destination = path.resolve(destinationPath);
  if (contains(source, destination) || contains(destination, source)) {
    throw new CoreError(422, 'invalid_path', 'The source and destination must be separate folders.');
  }
  const sourceState = await lstat(source);
  if (!sourceState.isDirectory()) throw new CoreError(422, 'invalid_path', 'The legacy M1ND must be a folder.');
  await mkdir(destination, { recursive: false });
  let files = 0;
  async function copyDirectory(from, to) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const input = path.join(from, entry.name);
      const output = path.join(to, entry.name);
      const state = await lstat(input);
      if (state.isSymbolicLink()) throw new CoreError(422, 'unsafe_path', 'Refusing to copy a linked legacy entry.');
      if (state.isDirectory()) {
        await mkdir(output, { recursive: false });
        await copyDirectory(input, output);
      } else if (state.isFile()) {
        await copyFile(input, output);
        files += 1;
      } else {
        throw new CoreError(422, 'unsafe_path', 'The legacy tree contains an unsupported entry.');
      }
    }
  }
  await copyDirectory(source, destination);
  return { files };
}
