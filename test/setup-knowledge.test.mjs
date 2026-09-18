import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evolve } from '../engine/lifecycle.mjs';
import { listInstallableAssets } from '../engine/install.mjs';
import { parseMachineRecord, writeMachineRecord } from '../engine/records.mjs';

test('evolve installs an included knowledge feature with its support files', async (context) => {
  const fixture = await makeKnowledgeFixture(context);
  const result = await evolve(fixture.options);

  assert.equal(result.completed, true);
  assert.match(
    await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'security-sweep', 'SKILL.md'), 'utf8'),
    /# Security sweep/,
  );
  assert.equal(
    await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'security-sweep', 'scripts', 'check.mjs'), 'utf8'),
    'export default true;\n',
  );
  assert.equal(
    await readFile(path.join(fixture.mindPath, 'knowledge', 'security', 'authentication.md'), 'utf8'),
    '# Authentication\n',
  );
});

for (const exclusion of ['security', 'knowledge']) {
  test(`evolve skips knowledge features and module files excluded by ${exclusion}`, async (context) => {
    const fixture = await makeKnowledgeFixture(context, [exclusion]);
    const result = await evolve(fixture.options);

    assert.equal(result.completed, true);
    await assert.rejects(() => access(path.join(fixture.homeDir, '.agents', 'skills', 'security-sweep')), { code: 'ENOENT' });
    await assert.rejects(() => access(path.join(fixture.mindPath, 'knowledge', 'security')), { code: 'ENOENT' });
  });
}

test('duplicate command names across base and knowledge fail before any write', async (context) => {
  const fixture = await makeKnowledgeFixture(context);
  await mkdir(path.join(fixture.kitPath, 'features'), { recursive: true });
  await writeFile(
    path.join(fixture.kitPath, 'features', 'duplicate.md'),
    '---\nname: security-sweep\ndescription: Duplicate.\n---\n\n# Duplicate\n',
  );

  await assert.rejects(
    () => listInstallableAssets(fixture.kitPath),
    /Duplicate installable command name "security-sweep".*features.*duplicate\.md.*knowledge.*security.*features.*security-sweep/s,
  );
  await assert.rejects(() => evolve(fixture.options), /Duplicate installable command name "security-sweep"/);
  await assert.rejects(() => access(path.join(fixture.mindPath, 'package.json')), { code: 'ENOENT' });
});

test('evolve installs roles, features and private knowledge features added to the mind folder', async (context) => {
  const fixture = await makeKnowledgeFixture(context);
  await writeMindFile(fixture, path.join('roles', 'archivist.md'), '---\nname: archivist\ndescription: Archive.\n---\n\n# Archivist\n');
  await writeMindFile(fixture, path.join('features', 'tidy.md'), '---\nname: tidy\ndescription: Tidy.\n---\n\n# Tidy\n');
  await writeMindFile(
    fixture,
    path.join('user', 'knowledge', 'private', 'features', 'audit.md'),
    '---\nname: audit\ndescription: Audit.\n---\n\n# Audit\n',
  );

  const result = await evolve(fixture.options);

  assert.equal(result.completed, true);
  for (const [name, heading] of [['archivist', /# Archivist/], ['tidy', /# Tidy/], ['audit', /# Audit/]]) {
    assert.match(await readFile(path.join(fixture.homeDir, '.agents', 'skills', name, 'SKILL.md'), 'utf8'), heading);
  }
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TEST.md'), 'utf8'));
  assert.ok(machine.managedFiles[path.join(fixture.homeDir, '.agents', 'skills', 'archivist', 'SKILL.md')]);
});

test('a mind command whose name collides with a kit command is skipped with a warning', async (context) => {
  const fixture = await makeKnowledgeFixture(context);
  const collidingPath = path.join(fixture.mindPath, 'roles', 'security-sweep.md');
  await writeMindFile(fixture, path.join('roles', 'security-sweep.md'), '---\nname: security-sweep\ndescription: Mine.\n---\n\n# Mine\n');

  const result = await evolve(fixture.options);

  assert.equal(result.completed, true);
  assert.ok(result.warnings.some((warning) => warning.startsWith(`${collidingPath}: the command "security-sweep" already installs from`)));
  assert.match(
    await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'security-sweep', 'SKILL.md'), 'utf8'),
    /# Security sweep/,
  );
});

test('evolve carries knowledge module protocols into the mind and skips excluded modules', async (context) => {
  const included = await makeKnowledgeFixture(context);
  assert.equal((await evolve(included.options)).completed, true);
  assert.equal(
    await readFile(path.join(included.mindPath, 'knowledge', 'security', 'protocols', 'rollback.md'), 'utf8'),
    '# Rollback\n',
  );
  await assert.rejects(() => access(path.join(included.homeDir, '.agents', 'skills', 'rollback')), { code: 'ENOENT' });

  const excluded = await makeKnowledgeFixture(context, ['security']);
  assert.equal((await evolve(excluded.options)).completed, true);
  await assert.rejects(() => access(path.join(excluded.mindPath, 'knowledge', 'security', 'protocols')), { code: 'ENOENT' });
});

async function writeMindFile(fixture, relativePath, content) {
  const filePath = path.join(fixture.mindPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function makeKnowledgeFixture(context, excluded = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-knowledge-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const kitPath = path.join(root, 'kit');
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  const modulePath = path.join(kitPath, 'knowledge', 'security');
  const featurePath = path.join(modulePath, 'features', 'security-sweep');
  await mkdir(path.join(kitPath, 'roles'), { recursive: true });
  await mkdir(path.join(featurePath, 'scripts'), { recursive: true });
  await mkdir(path.join(mindPath, 'user', 'machines'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), JSON.stringify({
    name: 'hivem1nd-test-kit',
    version: '1.0.0',
    files: ['roles/', 'features/', 'knowledge/', 'rules.md'],
  }));
  await writeFile(path.join(kitPath, 'rules.md'), '# Rules\n');
  await writeFile(
    path.join(kitPath, 'roles', 'executor.md'),
    '---\nname: executor\ndescription: Execute.\n---\n\n# Executor\n\nMind: {{mind}}\n',
  );
  await writeFile(path.join(modulePath, 'authentication.md'), '# Authentication\n');
  await mkdir(path.join(modulePath, 'protocols'), { recursive: true });
  await writeFile(path.join(modulePath, 'protocols', 'rollback.md'), '# Rollback\n');
  await writeFile(
    path.join(featurePath, 'SKILL.md'),
    '---\nname: security-sweep\ndescription: Check security.\n---\n\n# Security sweep\n\nMind: {{mind}}\n',
  );
  await writeFile(path.join(featurePath, 'scripts', 'check.mjs'), 'export default true;\n');
  await writeFile(path.join(mindPath, 'user', 'VERSION'), '0.1.0\n');
  await writeFile(path.join(mindPath, 'user', 'preferences.md'), '');
  await writeFile(path.join(mindPath, 'user', 'routes.md'), '## Environments\n\n## Projects\n\n## Minds\n');
  await writeMachineRecord(mindPath, 'TEST', {
    machine: 'TEST',
    mind: mindPath,
    language: 'en',
    updateCheck: 'off',
    lastCheck: '',
    keepExistingPreferences: true,
    setup: 'done',
    agents: [{ name: 'codex', mode: 'on-demand' }],
    paths: [],
    excluded,
    draft: {},
    managedFiles: {},
  });
  return {
    kitPath,
    mindPath,
    homeDir,
    options: {
      kitPath,
      mindPath,
      homeDir,
      hostname: 'TEST',
      env: { PATH: '' },
      pull: false,
    },
  };
}
