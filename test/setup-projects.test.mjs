import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repositories group by their containing folder, and a direct child of the root gets its own guessed or empty environment', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.getStep();

  assert.equal(step.groups.length, 4);
  const gitHubGroup = step.groups.find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  assert.deepEqual(gitHubGroup.projects.map((project) => project.name).sort(), ['repo1', 'repo2']);
  assert.equal(gitHubGroup.environment, 'GitHub');

  const unityGroup = step.groups.find((group) => group.folder === path.join(fixture.homeDir, 'Unity'));
  assert.deepEqual(unityGroup.projects.map((project) => project.name), ['repo3']);
  assert.equal(unityGroup.environment, 'Unity');

  const webGroup = step.groups.find((group) => group.projects[0]?.name === 'direct-web');
  assert.equal(webGroup.projects.length, 1);
  assert.equal(webGroup.environment, 'web');

  const plainGroup = step.groups.find((group) => group.projects[0]?.name === 'direct-plain');
  assert.equal(plainGroup.projects.length, 1);
  assert.equal(plainGroup.environment, '');
});

test('editing a group environment name applies it to every repository in that group', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.getStep();
  const gitHubIndex = step.groups.findIndex((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));

  await session.answer({ projectsConfirmed: true, [`groupEnvironment.${gitHubIndex}`]: 'oss' });
  await session.answer({ skipPreferences: true, autoUpdates: false });
  await session.answer({ confirm: true });
  await session.install();

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.match(routes, /- repo1 \(oss\)/);
  assert.match(routes, /- repo2 \(oss\)/);
  assert.match(routes, /- oss: repo1, repo2/);

  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.deepEqual(machine.paths.find((entry) => entry.name === 'oss'), { name: 'oss', path: path.join(fixture.homeDir, 'GitHub') });
  assert.ok(!machine.paths.some((entry) => entry.path === fixture.homeDir));
  assert.ok(machine.paths.some((entry) => entry.name === 'direct-web'));
});

test('removing a single repository drops it from its group and keeps it out of routes and the machine record', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.getStep();
  const gitHubGroup = step.groups.find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  const repo2 = gitHubGroup.projects.find((project) => project.name === 'repo2');

  const afterRemove = await session.answer({ removeProject: repo2.index });
  const remainingGitHub = afterRemove.groups.find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  assert.deepEqual(remainingGitHub.projects.map((project) => project.name), ['repo1']);

  await session.answer({ projectsConfirmed: true });
  await session.answer({ skipPreferences: true, autoUpdates: false });
  await session.answer({ confirm: true });
  await session.install();

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.doesNotMatch(routes, /repo2/);
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.ok(!machine.paths.some((entry) => entry.name === 'repo2'));
});

test('removing an environment drops every repository it contains', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.getStep();
  const gitHubGroup = step.groups.find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));

  const afterRemove = await session.answer({ removeEnvironment: gitHubGroup.id });
  assert.ok(!afterRemove.groups.some((group) => group.folder === path.join(fixture.homeDir, 'GitHub')));

  await session.answer({ projectsConfirmed: true });
  await session.answer({ skipPreferences: true, autoUpdates: false });
  await session.answer({ confirm: true });
  await session.install();

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.doesNotMatch(routes, /repo1/);
  assert.doesNotMatch(routes, /repo2/);
});

test('removed repositories persist through back and through a resumed session', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.getStep();
  const plainGroup = step.groups.find((group) => group.projects[0]?.name === 'direct-plain');
  await session.answer({ removeEnvironment: plainGroup.id });

  const back = await session.answer({ projectsConfirmed: true });
  assert.equal(back.number, 6);
  const returned = await session.back();
  assert.equal(returned.number, 5);
  assert.ok(!returned.groups.some((group) => group.projects.some((project) => project.name === 'direct-plain')));

  const resumed = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: true,
  });
  const resumedStep = await resumed.getStep();
  assert.equal(resumedStep.number, 5);
  assert.ok(!resumedStep.groups.some((group) => group.projects.some((project) => project.name === 'direct-plain')));
});

test('adding a root merges its repositories without duplicating an existing one', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsStep(fixture);
  const step = await session.answer({ addRoot: fixture.rootB });
  const gammaGroup = step.groups.find((group) => group.projects[0]?.name === 'gamma');
  assert.ok(gammaGroup);

  const again = await session.answer({ addRoot: fixture.rootB });
  assert.equal(again.groups.filter((group) => group.projects.some((project) => project.name === 'gamma')).length, 1);
});

async function makeFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-setup-projects-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  const rootB = path.join(root, 'rootB');

  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });

  await mkdir(path.join(homeDir, 'GitHub', 'repo1', '.git'), { recursive: true });
  await mkdir(path.join(homeDir, 'GitHub', 'repo2', '.git'), { recursive: true });
  await mkdir(path.join(homeDir, 'Unity', 'repo3', '.git'), { recursive: true });

  const directWeb = path.join(homeDir, 'direct-web');
  await mkdir(path.join(directWeb, '.git'), { recursive: true });
  await writeFile(path.join(directWeb, 'package.json'), '{"name":"direct-web"}\n');

  await mkdir(path.join(homeDir, 'direct-plain', '.git'), { recursive: true });
  await mkdir(path.join(rootB, 'gamma', '.git'), { recursive: true });

  return { root, mindPath, homeDir, rootB };
}

async function toProjectsStep(fixture) {
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ scan: true });
  await session.answer({});
  const includeStep = await session.getStep();
  await session.answer({ included: includeStep.values.included });
  return session;
}
