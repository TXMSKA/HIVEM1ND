import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { helpText, parseArgs } from '../cli/index.mjs';
import { createSetupSession } from '../engine/setup.mjs';
import { parseMachineRecord, writeMachineRecord } from '../engine/records.mjs';
import { uninstall } from '../engine/uninstall.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('help and argument parsing document the uninstall command', () => {
  assert.match(helpText(), /\buninstall\b/);
  assert.match(helpText(), /--dry-run/);
  assert.match(helpText(), /--remove-mind/);
  assert.deepEqual(
    parseArgs(['uninstall', '--dry-run', '--remove-mind', '--mind-path', 'C:/mind']).options,
    { dryRun: true, removeMind: true, mindPath: 'C:/mind' },
  );
  assert.throws(() => parseArgs(['uninstall', 'extra']), /does not accept positional arguments/);
});

test('uninstall removes managed skills, the auto rule line and the machine record, restoring the home', async (context) => {
  const fixture = await makeFixture(context);
  const before = await snapshotTree(fixture.homeDir);
  await installFixture(fixture);

  const rulesAfterInstall = await readFile(path.join(fixture.homeDir, '.codex', 'AGENTS.md'), 'utf8');
  assert.match(rulesAfterInstall, /HIVEM1ND: the mind is at/);
  assert.match(await readFile(path.join(fixture.homeDir, '.cursor', 'rules', 'hivem1nd.mdc'), 'utf8'), /HIVEM1ND: the mind is at/);
  await lstat(path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'));

  const result = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.updated.includes(path.join(fixture.homeDir, '.codex', 'AGENTS.md')));

  const rulesAfterUninstall = await readFile(path.join(fixture.homeDir, '.codex', 'AGENTS.md'), 'utf8');
  assert.equal(rulesAfterUninstall, 'Existing agent preference stays first.\n');
  await assert.rejects(() => lstat(path.join(fixture.homeDir, '.cursor')), { code: 'ENOENT' });
  await assert.rejects(() => lstat(path.join(fixture.homeDir, '.agents')), { code: 'ENOENT' });
  await assert.rejects(
    () => lstat(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md')),
    { code: 'ENOENT' },
  );

  const after = await snapshotTree(fixture.homeDir);
  assert.deepEqual(Object.fromEntries(after), Object.fromEntries(before));
});

test('a user-modified skill file is kept and its folder is not removed', async (context) => {
  const fixture = await makeFixture(context);
  await installFixture(fixture);
  const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md');
  await writeFile(skillPath, 'the user changed this skill\n');

  const result = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].path, skillPath);
  assert.match(result.kept[0].reason, /modified after installation/);
  assert.equal(await readFile(skillPath, 'utf8'), 'the user changed this skill\n');

  await assert.rejects(() => lstat(path.join(fixture.homeDir, '.agents', 'skills', 'qa')), { code: 'ENOENT' });
});

test('a junction skill folder is left untouched', async (t) => {
  const fixture = await makeFixture(t);
  await installFixture(fixture);
  const qaPath = path.join(fixture.homeDir, '.agents', 'skills', 'qa');
  const outside = path.join(fixture.root, 'outside-qa');
  await mkdir(outside, { recursive: true });
  await rm(qaPath, { recursive: true });
  try {
    await symlink(outside, qaPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction requires Windows Developer Mode');
      return;
    }
    throw error;
  }

  const result = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
  const keptQa = result.kept.filter((item) => item.path.startsWith(qaPath));
  assert.ok(keptQa.length > 0);
  assert.ok(keptQa.every((item) => item.reason.includes('symbolic link')));
  assert.equal((await lstat(qaPath)).isSymbolicLink(), true);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(() => lstat(path.join(fixture.homeDir, '.agents', 'skills', 'executor')), { code: 'ENOENT' });
});

test('a dry run reports the plan without removing anything', async (context) => {
  const fixture = await makeFixture(context);
  await installFixture(fixture);
  const rulesBefore = await readFile(path.join(fixture.homeDir, '.codex', 'AGENTS.md'), 'utf8');

  const result = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' }, dryRun: true });
  assert.ok(result.removed.length > 0);

  assert.equal(await readFile(path.join(fixture.homeDir, '.codex', 'AGENTS.md'), 'utf8'), rulesBefore);
  await lstat(path.join(fixture.homeDir, '.cursor', 'rules', 'hivem1nd.mdc'));
  await lstat(path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'));
  await lstat(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'));
});

test('removeMind deletes the mind when this is the only machine', async (context) => {
  const fixture = await makeFixture(context);
  await installFixture(fixture);

  const result = await uninstall({
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    removeMind: true,
  });
  assert.deepEqual(result.kept, []);
  assert.ok(result.removed.includes(fixture.mindPath));
  await assert.rejects(() => lstat(fixture.mindPath), { code: 'ENOENT' });
});

test('removeMind keeps the mind when another machine record exists, but this machine still detaches', async (context) => {
  const fixture = await makeFixture(context);
  await installFixture(fixture);
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  await writeMachineRecord(fixture.mindPath, 'OTHERBOX', { ...machine, machine: 'OTHERBOX' });

  const result = await uninstall({
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    removeMind: true,
  });
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].path, fixture.mindPath);
  assert.match(result.kept[0].reason, /OTHERBOX\.md/);
  await lstat(fixture.mindPath);
  await assert.rejects(
    () => lstat(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md')),
    { code: 'ENOENT' },
  );
  await lstat(path.join(fixture.mindPath, 'user', 'machines', 'OTHERBOX.md'));
});

test('running uninstall twice is harmless', async (context) => {
  const fixture = await makeFixture(context);
  await installFixture(fixture);

  const first = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
  assert.ok(first.removed.length > 0);

  const second = await uninstall({ mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
  assert.deepEqual(second.removed, []);
  assert.deepEqual(second.kept, []);
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0], /No machine record exists/);
});

test('the kit uninstaller script points at the local CLI and mind path', async () => {
  const content = await readFile(path.join(KIT_PATH, 'uninstall.cmd'), 'utf8');
  assert.match(content, /node "%~dp0cli\\index\.mjs" uninstall --mind-path "%~dp0\."/);
  assert.match(content, /^pause\s*$/m);
});

async function makeFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-uninstall-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  await writeFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'Existing agent preference stays first.\n');
  return { root, mindPath, homeDir };
}

async function installFixture(fixture, hostname = 'TESTBOX') {
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname,
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ scan: true });
  await session.answer({ addAgent: 'cursor' });
  await session.answer({ addAgent: 'vscode' });
  await session.answer({
    agents: ['codex', 'cursor', 'vscode'],
    attachModes: { codex: 'auto', cursor: 'auto', vscode: 'on-demand' },
  });
  const includeStep = await session.getStep();
  await session.answer({ included: includeStep.values.included });
  await session.answer({ projectsConfirmed: true });
  await session.answer({ skipPreferences: true, autoUpdates: false });
  await session.answer({ confirm: true });
  return session.install();
}

async function snapshotTree(root) {
  const map = new Map();
  await walk(root, '');
  return map;

  async function walk(directory, relative) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        map.set(entryRelative, 'symlink');
      } else if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else {
        map.set(entryRelative, await readFile(entryPath, 'utf8'));
      }
    }
  }
}
