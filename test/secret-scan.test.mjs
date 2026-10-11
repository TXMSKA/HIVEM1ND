import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the secret scan reports a private key by location only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-secret-'));
  try {
    assert.equal(git(root, ['init']).status, 0);
    await writeFile(path.join(root, 'leak.txt'), '-----BEGIN TEST PRIVATE KEY-----\nsecret-material\n-----END TEST PRIVATE KEY-----\n');
    assert.equal(git(root, ['add', 'leak.txt']).status, 0);
    const committed = git(root, ['-c', 'user.email=scan@example.com', '-c', 'user.name=Scan', 'commit', '-m', 'leak']);
    assert.equal(committed.status, 0, committed.stderr);
    const scan = spawnSync(process.execPath, [path.join(repo, 'scripts', 'secret-scan.mjs'), root], {
      cwd: repo,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(scan.status, 1);
    assert.match(scan.stdout, /leak\.txt:1/);
    assert.equal(scan.stdout.includes('secret-material'), false);
    assert.match(scan.stdout, /gitleaks is not installed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
}
