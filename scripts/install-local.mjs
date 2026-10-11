import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['install-hooks.mjs', 'install-gitleaks.mjs']) {
  const result = spawnSync(process.execPath, [path.join(dir, name)], { stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
