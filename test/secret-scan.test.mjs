import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = path.join(repo, 'scripts', 'secret-scan.mjs');

test('a missing scanner or repository fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-secret-'));
  const missing = path.join(root, 'missing-gitleaks.mjs');
  try {
    await writeFile(path.join(root, 'leak.txt'), '-----BEGIN TEST PRIVATE KEY-----\nsecret-material\n-----END TEST PRIVATE KEY-----\n');
    const loose = scan(root, { HIVEM1ND_GITLEAKS: missing });
    assert.equal(loose.status, 1);
    assert.match(loose.stdout, /not a git repository/);
    assert.equal(loose.stdout.includes('secret-material'), false);
    assert.equal(git(root, ['init']).status, 0);
    const absent = scan(root, { HIVEM1ND_GITLEAKS: missing });
    assert.equal(absent.status, 1);
    assert.match(absent.stdout, /gitleaks is not installed/);
    assert.equal(absent.stdout.includes('secret-material'), false);
    const fake = path.join(root, 'fake-gitleaks.mjs');
    await writeFile(fake, 'if (process.argv[2] === "version") process.exit(0);\nprocess.exit(2);\n');
    const failed = scan(root, { HIVEM1ND_GITLEAKS: fake });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /gitleaks failed/);
    assert.equal(failed.stdout.includes('secret-material'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the secret scan hook is installed in a repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-hook-'));
  try {
    assert.equal(git(root, ['init']).status, 0);
    const installed = spawnSync(process.execPath, [path.join(repo, 'scripts', 'install-hooks.mjs')], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(installed.status, 0, installed.stderr);
    const configured = git(root, ['config', '--get', 'core.hooksPath']);
    assert.equal(configured.stdout.trim(), 'scripts/hooks');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function scan(cwd, env) {
  return spawnSync(process.execPath, [scanScript, cwd], {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
}
