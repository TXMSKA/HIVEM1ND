import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function makeRelayMind(root) {
  const mind = path.join(root, 'mind');
  await mkdir(path.join(mind, 'user', 'state'), { recursive: true });
  await writeFile(path.join(mind, 'user', 'state', 'manager.md'), 'unit: manager\nstate: in\nmachine: RELAYTEST\ndate: 2026-10-05 10:00\n\nTesting Relay.\n');
  await writeFile(path.join(mind, 'user', 'routes.md'), '## Environments\n\n## Projects\n');
  return mind;
}
