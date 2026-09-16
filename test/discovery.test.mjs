import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverContent, discoverHomeProjects, guessEnvironment } from '../engine/discovery.mjs';
import { createSetupSession } from '../engine/setup.mjs';

test('guessEnvironment detects each environment type in priority order', async (context) => {
  const cases = [
    { name: 'unity', files: { 'ProjectSettings/ProjectVersion.txt': '2022.3\n' }, expected: 'unity' },
    { name: 'unity-with-csproj', files: { 'ProjectSettings/ProjectVersion.txt': '2022.3\n', 'Assembly.csproj': '<Project/>\n' }, expected: 'unity' },
    { name: 'unreal', files: { 'Game.uproject': '{}\n' }, expected: 'unreal' },
    { name: 'godot', files: { 'project.godot': '[application]\n' }, expected: 'godot' },
    { name: 'godot-with-csproj', files: { 'project.godot': '[application]\n', 'Game.csproj': '<Project/>\n' }, expected: 'godot' },
    { name: 'web', files: { 'package.json': '{"name":"app"}\n' }, expected: 'web' },
    { name: 'apps-csproj', files: { 'Game.csproj': '<Project/>\n' }, expected: 'apps' },
    { name: 'apps-sln', files: { 'Solution.sln': '\n' }, expected: 'apps' },
    { name: 'apps-cargo', files: { 'Cargo.toml': '[package]\n' }, expected: 'apps' },
    { name: 'apps-go', files: { 'go.mod': 'module example\n' }, expected: 'apps' },
    { name: 'none', files: {}, expected: '' },
  ];

  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-guess-env-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const scenario of cases) {
    const repository = path.join(root, scenario.name);
    await mkdir(repository, { recursive: true });
    for (const [relativePath, content] of Object.entries(scenario.files)) {
      const destination = path.join(repository, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    assert.equal(await guessEnvironment(repository), scenario.expected, scenario.name);
  }
});

test('the home scan skips AppData, Library and hidden directories but still finds nested repositories', async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-home-scan-'));
  context.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(path.join(homeDir, 'AppData', 'excluded', '.git'), { recursive: true });
  await mkdir(path.join(homeDir, 'Library', 'excluded', '.git'), { recursive: true });
  await mkdir(path.join(homeDir, '.hidden', 'excluded', '.git'), { recursive: true });
  await mkdir(path.join(homeDir, 'GitHub', 'found', '.git'), { recursive: true });

  const found = await discoverHomeProjects(homeDir);
  assert.deepEqual(found.map((project) => project.name), ['found']);
});

test('the home scan tolerates a directory it cannot list', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-home-scan-unreadable-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const blocked = path.join(homeDir, 'blocked');
  await mkdir(blocked, { recursive: true });
  await mkdir(path.join(homeDir, 'visible', '.git'), { recursive: true });

  await chmod(blocked, 0o000);
  try {
    await readdir(blocked);
    t.skip('This platform does not enforce directory permissions for the current process.');
    return;
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
  }

  try {
    const found = await discoverHomeProjects(homeDir);
    assert.deepEqual(found.map((project) => project.name), ['visible']);
  } finally {
    await chmod(blocked, 0o700);
  }
});

test('feature categories come from frontmatter, and a missing or unknown category is preserved as-is', async (context) => {
  const kitPath = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-categories-'));
  context.after(() => rm(kitPath, { recursive: true, force: true }));
  const featuresDir = path.join(kitPath, 'features');
  await mkdir(featuresDir, { recursive: true });
  await writeFile(path.join(featuresDir, 'alpha.md'), '---\nname: alpha\ndescription: Alpha.\ncategory: planning\n---\n\n# Alpha\n');
  await writeFile(path.join(featuresDir, 'beta.md'), '---\nname: beta\ndescription: Beta.\ncategory: quality\n---\n\n# Beta\n');
  await writeFile(path.join(featuresDir, 'gamma.md'), '---\nname: gamma\ndescription: Gamma.\n---\n\n# Gamma\n');
  await writeFile(path.join(featuresDir, 'delta.md'), '---\nname: delta\ndescription: Delta.\ncategory: mystery\n---\n\n# Delta\n');

  const content = await discoverContent(kitPath);
  assert.equal(content.find((item) => item.name === 'alpha').category, 'planning');
  assert.equal(content.find((item) => item.name === 'beta').category, 'quality');
  assert.equal(content.find((item) => item.name === 'gamma').category, undefined);
  assert.equal(content.find((item) => item.name === 'delta').category, 'mystery');
});

test('the content step still lists a feature with a missing or unknown category, in a fallback group', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-categories-session-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const kitPath = path.join(root, 'kit');
  const homeDir = path.join(root, 'home');
  const mindPath = path.join(root, 'mind');
  await mkdir(path.join(kitPath, 'features'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  await writeFile(path.join(kitPath, 'features', 'alpha.md'), '---\nname: alpha\ndescription: Alpha.\ncategory: planning\n---\n\n# Alpha\n');
  await writeFile(path.join(kitPath, 'features', 'gamma.md'), '---\nname: gamma\ndescription: Gamma.\n---\n\n# Gamma\n');

  const session = await createSetupSession({
    kitPath,
    mindPath,
    homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath });
  await session.answer({ scan: true });
  const step = await session.answer({});
  assert.equal(step.number, 4);

  const planning = step.categories.find((category) => category.id === 'planning');
  const fallback = step.categories.find((category) => category.id === 'other');
  assert.deepEqual(planning.items.map((item) => item.name), ['alpha']);
  assert.ok(fallback);
  assert.deepEqual(fallback.items.map((item) => item.name), ['gamma']);
});
