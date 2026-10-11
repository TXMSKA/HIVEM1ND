import { spawnSync } from 'node:child_process';

const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', shell: false, windowsHide: true });
if (inside.status !== 0 || inside.stdout.trim() !== 'true') process.exit(0);
const set = spawnSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { encoding: 'utf8', shell: false, windowsHide: true });
if (set.status !== 0) {
  process.stderr.write('secret scan hook was not installed\n');
  process.exit(set.status ?? 1);
}
