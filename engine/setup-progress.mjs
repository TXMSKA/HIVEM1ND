import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isTemporaryName } from './sync/pack.mjs';

// The first start of the service stages one change file per file of the M1ND under staging/changes, then publishes
// them to the origin; each published change moves from staging/changes to staging/acked. Counting those two folders
// is how setup reports the progress without asking the service, which is busy doing the work.

async function countChanges(directory) {
  const names = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter(name => name.endsWith('.json') && !isTemporaryName(name)).length;
}

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
const SKIPPED_PATHS = new Set(['user/relay/leases', 'user/relay/credentials', 'user/relay/endpoints']);

// The number of files the service looks at in the M1ND: the same walk it makes, without reading any of them. Some of
// these are not staged, so the figure is an estimate and the sentence says "about".
export async function estimateStagedFiles(mindPath) {
  let total = 0;
  async function visit(relative) {
    const entries = await readdir(path.join(mindPath, ...relative.split('/')), { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !SKIPPED_PATHS.has(next)) await visit(next);
      } else if (entry.isFile()) total += 1;
    }
  }
  await visit('user');
  return total;
}

// phase "preparing": nothing staged yet. "staging": change files are being written; done out of the estimate.
// "publishing": staging is over and the changes move to the origin; done out of everything staged.
export async function syncProgress({ localDirectory, estimate = null }) {
  const staged = await countChanges(path.join(localDirectory, 'staging', 'changes'));
  const published = await countChanges(path.join(localDirectory, 'staging', 'acked'));
  const everything = staged + published;
  if (everything === 0) return { phase: 'preparing', done: 0, total: estimate };
  if (published > 0 || estimate !== null && everything >= estimate) return { phase: 'publishing', done: published, total: everything };
  return { phase: 'staging', done: everything, total: estimate === null ? null : Math.max(estimate, everything) };
}
