import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Setup has four steps (docs/3.0/final.md, decision 3): repositories are detected with defaults and
// changed in Settings. These tests exercise the project selection at the plan boundary of the setup
// session, outside the setup screens, with the home folder scanned as the projects root.

test('repositories group by their containing folder, and a direct child of the root gets its own guessed or empty environment', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  const groups = groupsOf(session);

  assert.equal(groups.length, 4);
  const gitHubGroup = groups.find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  assert.deepEqual(gitHubGroup.projects.map((project) => project.name).sort(), ['repo1', 'repo2']);
  assert.equal(gitHubGroup.environment, 'GitHub');

  const unityGroup = groups.find((group) => group.folder === path.join(fixture.homeDir, 'Unity'));
  assert.deepEqual(unityGroup.projects.map((project) => project.name), ['repo3']);
  assert.equal(unityGroup.environment, 'Unity');

  const webGroup = groups.find((group) => group.projects[0]?.name === 'direct-web');
  assert.equal(webGroup.projects.length, 1);
  assert.equal(webGroup.environment, 'web');

  const plainGroup = groups.find((group) => group.projects[0]?.name === 'direct-plain');
  assert.equal(plainGroup.projects.length, 1);
  assert.equal(plainGroup.environment, '');
});

test('editing a group environment name applies it to every repository in that group', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  const gitHub = path.join(fixture.homeDir, 'GitHub');
  session.answers.projects = session.answers.projects.map((project) => (path.dirname(project.path) === gitHub ? { ...project, environment: 'oss' } : project));
  await finishSetup(session);

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.match(routes, /- repo1 \(oss\)/);
  assert.match(routes, /- repo2 \(oss\)/);
  assert.match(routes, /- oss: repo1, repo2/);

  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.deepEqual(machine.paths.find((entry) => entry.name === 'oss'), { name: 'oss', path: gitHub });
  assert.ok(!machine.paths.some((entry) => entry.path === fixture.homeDir));
  assert.ok(machine.paths.some((entry) => entry.name === 'direct-web'));
});

test('removing a single repository drops it from its group and keeps it out of routes and the machine record', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  const gitHubGroup = groupsOf(session).find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  const repo2 = gitHubGroup.projects.find((project) => project.name === 'repo2');

  session.removeProject(repo2.index);
  const remainingGitHub = groupsOf(session).find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));
  assert.deepEqual(remainingGitHub.projects.map((project) => project.name), ['repo1']);

  await finishSetup(session);

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.doesNotMatch(routes, /repo2/);
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.ok(!machine.paths.some((entry) => entry.name === 'repo2'));
});

test('removing an environment drops every repository it contains', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  const gitHubGroup = groupsOf(session).find((group) => group.folder === path.join(fixture.homeDir, 'GitHub'));

  session.removeEnvironmentGroup(gitHubGroup.id);
  assert.ok(!groupsOf(session).some((group) => group.folder === path.join(fixture.homeDir, 'GitHub')));

  await finishSetup(session);

  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.doesNotMatch(routes, /repo1/);
  assert.doesNotMatch(routes, /repo2/);
});

test('removed repositories persist through a resumed session', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  const plainGroup = groupsOf(session).find((group) => group.projects[0]?.name === 'direct-plain');
  session.removeEnvironmentGroup(plainGroup.id);
  await session.persistDraft();
  assert.ok(!groupsOf(session).some((group) => group.projects.some((project) => project.name === 'direct-plain')));

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
  assert.equal(resumedStep.id, 'service');
  assert.ok(!groupsOf(resumed).some((group) => group.projects.some((project) => project.name === 'direct-plain')));
  assert.ok(groupsOf(resumed).some((group) => group.projects.some((project) => project.name === 'direct-web')));
});

test('adding a root merges its repositories without duplicating an existing one', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toProjectsSelection(fixture);
  await session.addProjectRoot(fixture.rootB);
  const gammaGroup = groupsOf(session).find((group) => group.projects[0]?.name === 'gamma');
  assert.ok(gammaGroup);

  await session.addProjectRoot(fixture.rootB);
  assert.equal(groupsOf(session).filter((group) => group.projects.some((project) => project.name === 'gamma')).length, 1);
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

async function toProjectsSelection(fixture) {
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.scanHomeProjects();
  return session;
}

// The session's own grouping: a repository directly in a scanned root is its own group, and every
// other repository groups with the others in its containing folder under one shared environment.
function groupsOf(session) {
  const key = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
  const groups = new Map();
  session.answers.projects.forEach((project, index) => {
    if (project.included === false) return;
    const folder = path.dirname(path.resolve(project.path));
    const direct = project.root !== undefined && key(folder) === key(project.root);
    const id = direct ? `project:${key(project.path)}` : `folder:${key(folder)}`;
    if (!groups.has(id)) groups.set(id, { id, folder, projects: [] });
    groups.get(id).projects.push({ ...project, index });
  });
  return [...groups.values()].map((group) => {
    const environments = new Set(group.projects.map((project) => project.environment).filter(Boolean));
    return { ...group, environment: environments.size === 1 ? [...environments][0] : '' };
  });
}

async function finishSetup(session) {
  await session.persistDraft();
  await session.answer({ confirm: true });
  return session.install();
}
