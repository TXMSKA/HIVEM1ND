import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyInstallPlan, combinePlans, installAgentAssets, planDataFile } from '../engine/install.mjs';
import { assertSafePath, parseMachineRecord } from '../engine/records.mjs';
import { createSetupSession, SetupValidationError } from '../engine/setup.mjs';
import { text } from '../engine/texts.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('setup runs all eight custom-mode steps against isolated homes and resumes', async (context) => {
  const fixture = await makeFixture(context);
  let session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'es',
    env: { PATH: '' },
  });

  const first = await session.getStep();
  assert.equal(first.number, 1);
  assert.equal(first.language, 'es');
  assert.deepEqual(first.languages.map((entry) => entry.value), ['en', 'es']);
  await session.setLanguage('en');
  const agentStep = await session.answer({ installMode: 'custom' }).then(() => session.answer({ mindPath: fixture.mindPath }));
  assert.equal(agentStep.number, 3);
  assert.equal(agentStep.scanned, false);
  const scannedStep = await session.answer({ scan: true });
  assert.equal(scannedStep.number, 3);
  assert.equal(scannedStep.scanned, true);
  assert.deepEqual(scannedStep.agents.map((agent) => agent.id), ['codex']);
  assert.equal(scannedStep.agents[0].attach, 'auto');
  assert.deepEqual(
    scannedStep.addableAgents.map((agent) => agent.value).sort(),
    ['claude-code', 'cursor', 'opencode', 'vscode'],
  );

  session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    resume: true,
  });
  const resumedAgentStep = await session.getStep();
  assert.equal(resumedAgentStep.number, 3);
  assert.equal(resumedAgentStep.scanned, true);

  await session.answer({ addAgent: 'vscode' });
  const withManualAgent = await session.getStep();
  assert.ok(withManualAgent.agents.some((agent) => agent.id === 'vscode' && agent.detected === false));

  await session.answer({ agents: ['codex', 'vscode'], attachModes: { codex: 'auto', vscode: 'auto' } });
  const includeStep = await session.getStep();
  assert.equal(includeStep.number, 4);
  assert.equal(includeStep.fields[0].options.find((entry) => entry.value === 'feature:brainstorm').label, '/brainstorm');
  assert.deepEqual(includeStep.categories.map((category) => category.id), ['planning', 'quality', 'continuity']);
  await session.answer({ included: includeStep.values.included });
  const scanStep = await session.answer({ addRoot: fixture.projectsRoot });
  assert.equal(scanStep.number, 5);
  assert.equal(scanStep.groups[0].projects[0].name, 'sample');
  assert.equal(scanStep.values['groupEnvironment.0'], 'web');
  const confirmStep = await session.answer({ projectsConfirmed: true });
  assert.equal(confirmStep.number, 6);
  assert.equal(confirmStep.values.autoUpdates, true);
  await session.answer({ addressStyle: 'explanatory', customPreference: 'answers stay concise', autoUpdates: false });

  const preview = await session.preview();
  assert.equal(preview.conflicts.length, 0);
  assert.ok(preview.files.some((file) => file.path === path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md')));
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.firstCommand, '/executor <project>');
  assert.equal((await session.getStep()).number, 8);
  assert.equal((await session.getStep()).done, true);
  assert.equal(result.attachPrompts[0].agent, 'vscode');

  const installed = await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'), 'utf8');
  assert.match(installed, new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  const installedSkills = await readdir(path.join(fixture.homeDir, '.agents', 'skills'));
  const featureNames = (await readdir(path.join(KIT_PATH, 'features')))
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .map((name) => path.basename(name, '.md'));
  assert.equal(featureNames.length, 11);
  assert.ok(featureNames.every((name) => installedSkills.includes(name)));
  const rules = await readFile(path.join(fixture.homeDir, '.codex', 'AGENTS.md'), 'utf8');
  assert.ok(rules.startsWith('Existing agent preference stays first.\n'));
  assert.match(rules, /HIVEM1ND: the mind is at/);
  const routes = await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8');
  assert.match(routes, /- sample \(web\)/);
  const preferences = await readFile(path.join(fixture.mindPath, 'user', 'preferences.md'), 'utf8');
  assert.match(preferences, /Existing preference stays first\./);
  assert.match(preferences, /answers stay concise\. Why: chosen at setup\./);

  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.equal(machine.setup, 'done');
  assert.equal(machine.language, 'en');
  assert.equal(machine.updateCheck, 'off');
  assert.equal(machine.keepExistingPreferences, true);
  assert.equal(machine.draft && Object.keys(machine.draft).length, 0);
  assert.ok(machine.managedFiles[path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md')]);
  assert.equal(machine.managedFiles[path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md')], undefined);
  assert.equal((await lstat(path.join(fixture.mindPath, 'user', 'projects', 'sample', 'state'))).isDirectory(), true);
  await assert.rejects(() => lstat(path.join(fixture.mindPath, 'test')), { code: 'ENOENT' });
});

test('simple install mode accepts every default and reaches install directly', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });

  const step = await session.answer({ installMode: 'simple' });
  assert.equal(step.number, 7);
  assert.equal(step.preview.conflicts.length, 0);
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.firstCommand, '/executor <project>');

  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.equal(machine.setup, 'done');
  assert.equal(machine.updateCheck, 'daily');
  assert.deepEqual(machine.agents, [{ name: 'codex', mode: 'auto' }]);
  assert.deepEqual(machine.paths, []);
});

test('back from install returns to install mode after simple and to confirm after custom', async (context) => {
  const simpleFixture = await makeFixture(context);
  const simpleSession = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: simpleFixture.mindPath,
    homeDir: simpleFixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await simpleSession.answer({ installMode: 'simple' });
  const backFromSimple = await simpleSession.back();
  assert.equal(backFromSimple.number, 1);
  assert.equal(backFromSimple.values.installMode, 'simple');

  const customFixture = await makeFixture(context);
  const customSession = await completeAnswers(customFixture, ['codex']);
  const backFromCustom = await customSession.back();
  assert.equal(backFromCustom.number, 6);
});

test('language can change mid-flow without losing answers or position', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ scan: true });

  const step = await session.setLanguage('es');
  assert.equal(step.number, 3);
  assert.equal(step.language, 'es');
  assert.equal(step.scanned, true);
  assert.deepEqual(step.agents.map((agent) => agent.id), ['codex']);
  assert.equal(step.title, 'Agentes');
});

test('the automatic update checkbox on the confirm step survives resume', async (context) => {
  const fixture = await makeFixture(context);
  const session = await completeAnswers(fixture, ['codex']);
  await session.back();
  const confirmStep = await session.getStep();
  assert.equal(confirmStep.number, 6);
  assert.equal(confirmStep.values.autoUpdates, false);

  const resumed = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    resume: true,
  });
  const resumedStep = await resumed.getStep();
  assert.equal(resumedStep.number, 6);
  assert.equal(resumedStep.values.autoUpdates, false);
  await resumed.answer({ autoUpdates: true });
  const installStep = await resumed.getStep();
  await resumed.answer({ confirm: true });
  await resumed.install();
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.equal(machine.updateCheck, 'daily');
  assert.equal(installStep.number, 7);
});

test('unowned files and modified managed skills require per-file choices', async (context) => {
  const fixture = await makeFixture(context);
  const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md');
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, 'private executor\n');
  const session = await completeAnswers(fixture, ['codex']);

  let preview = await session.preview();
  const conflict = preview.conflicts.find((item) => item.path === skillPath);
  assert.equal(conflict.reason, 'An unowned file already exists at this path.');
  await session.answer({ confirm: true });
  await assert.rejects(() => session.install(), SetupValidationError);
  await session.answer({ conflicts: { [skillPath]: 'keep' }, confirm: true });
  await session.install();
  assert.equal(await readFile(skillPath, 'utf8'), 'private executor\n');

  const replaceSession = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await answerReconfiguration(replaceSession, fixture, ['codex']);
  preview = await replaceSession.preview();
  assert.ok(preview.conflicts.some((item) => item.path === skillPath));
  await replaceSession.answer({ conflicts: { [skillPath]: 'replace' }, confirm: true });
  await replaceSession.install();
  assert.match(await readFile(skillPath, 'utf8'), /# Executor/);

  await writeFile(skillPath, 'user changed the managed skill\n');
  const lifecyclePreview = await installAgentAssets({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    previewOnly: true,
  });
  assert.ok(lifecyclePreview.baseFiles.length > 0);
  assert.equal(lifecyclePreview.conflicts.find((item) => item.path === skillPath)?.reason, 'The HIVEM1ND-managed file was modified after installation.');
});

test('mind selection rejects filesystem roots and the kit fixtures tree', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-invalid-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => createSetupSession({
    kitPath: KIT_PATH,
    mindPath: path.parse(root).root,
    homeDir: path.join(root, 'home'),
    hostname: 'TESTBOX',
    env: { PATH: '' },
  }), SetupValidationError);
  await assert.rejects(() => createSetupSession({
    kitPath: KIT_PATH,
    mindPath: path.join(KIT_PATH, 'fixtures', 'mind'),
    homeDir: path.join(root, 'home'),
    hostname: 'TESTBOX',
    env: { PATH: '' },
  }), SetupValidationError);
});

test('the default mind path is the user home, never the kit tree or a QA fixture', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-default-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  await mkdir(homeDir, { recursive: true });
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: {},
  });
  await session.answer({ installMode: 'custom' });
  const step = await session.getStep();
  assert.equal(step.values.mindPath, path.join(homeDir, 'HIVEM1ND'));
  assert.ok(!step.values.mindPath.toLowerCase().includes('.qa'));
  assert.ok(!step.values.mindPath.startsWith(path.join(KIT_PATH, 'user')));
});

test('mind location presets always offer the installer, drive and user folders, and OneDrive only when detected', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-presets-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  await mkdir(homeDir, { recursive: true });

  const withoutOneDrive = await createSetupSession({
    kitPath: KIT_PATH,
    homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: {},
  });
  await withoutOneDrive.answer({ installMode: 'custom' });
  const stepWithout = await withoutOneDrive.getStep();
  assert.deepEqual(stepWithout.presets.map((preset) => preset.id), ['installer', 'drive', 'user']);
  assert.equal(stepWithout.presets.find((preset) => preset.id === 'installer').path, KIT_PATH);
  assert.equal(stepWithout.presets.find((preset) => preset.id === 'user').path, path.join(homeDir, 'HIVEM1ND'));

  const oneDrivePath = path.join(root, 'OneDriveFolder');
  await mkdir(oneDrivePath, { recursive: true });
  const withOneDrive = await createSetupSession({
    kitPath: KIT_PATH,
    homeDir,
    hostname: 'TESTBOX2',
    language: 'en',
    env: { OneDrive: oneDrivePath },
  });
  await withOneDrive.answer({ installMode: 'custom' });
  const stepWith = await withOneDrive.getStep();
  const oneDrivePreset = stepWith.presets.find((preset) => preset.id === 'oneDrive');
  assert.ok(oneDrivePreset);
  assert.equal(oneDrivePreset.path, path.join(oneDrivePath, 'HIVEM1ND'));
  assert.equal(oneDrivePreset.label, 'OneDrive');

  const missingOneDriveFolder = await createSetupSession({
    kitPath: KIT_PATH,
    homeDir,
    hostname: 'TESTBOX3',
    language: 'en',
    env: { OneDrive: path.join(root, 'does-not-exist') },
  });
  await missingOneDriveFolder.answer({ installMode: 'custom' });
  const stepMissing = await missingOneDriveFolder.getStep();
  assert.ok(!stepMissing.presets.some((preset) => preset.id === 'oneDrive'));
});

test('applying a mind location preset updates the mind path', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await session.answer({ installMode: 'custom' });
  const step = await session.getStep();
  const userPreset = step.presets.find((preset) => preset.id === 'user');
  assert.equal(userPreset.path, path.join(fixture.homeDir, 'HIVEM1ND'));
  const next = await session.answer({ mindPath: userPreset.path });
  assert.equal(next.number, 3);
});

test('choosing the kit fixtures tree during mind location is rejected', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await session.answer({ installMode: 'custom' });
  await assert.rejects(
    () => session.answer({ mindPath: path.join(KIT_PATH, 'fixtures', 'mind') }),
    SetupValidationError,
  );
});

test('resuming a draft keeps the previously selected mind path', async (context) => {
  const fixture = await makeFixture(context);
  let session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });

  session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    resume: true,
  });
  const step = await session.getStep();
  assert.equal(step.number, 3);
  assert.equal(step.language, 'en');
});

test('a symbolic ancestor never receives writes and is reported as one aggregated warning, not per-file conflicts', async (t) => {
  const fixture = await makeFixture(t);
  const outside = path.join(fixture.root, 'outside');
  await mkdir(outside);
  try {
    await symlink(outside, path.join(fixture.homeDir, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction requires Windows Developer Mode');
      return;
    }
    throw error;
  }

  const session = await completeAnswers(fixture, ['codex']);
  await assert.rejects(
    () => assertSafePath(fixture.homeDir, path.join(fixture.homeDir, '.agents', 'skills')),
    /symbolic destination/,
  );
  const preview = await session.preview();
  const skillConflicts = preview.conflicts.filter((conflict) => conflict.path.includes(`${path.sep}.agents${path.sep}`));
  assert.equal(skillConflicts.length, 0);
  const skillFiles = preview.files.filter((file) => file.path.includes(`${path.sep}.agents${path.sep}`));
  assert.equal(skillFiles.length, 0);
  const warning = preview.warnings.find((entry) => entry.includes(path.join(fixture.homeDir, '.agents')));
  assert.ok(warning, 'expected an aggregated symlink-skip warning');
  assert.match(warning, /^\d+ files skipped because their destination is a symbolic link\./);

  await session.answer({ confirm: true });
  const result = await session.install();
  assert.ok(result.warnings.some((entry) => entry.includes(path.join(fixture.homeDir, '.agents'))));
  assert.deepEqual(await readdir(outside), []);
});

test('junctions inside an agent skills folder are skipped and reported as one warning listing every affected folder', async (t) => {
  const fixture = await makeFixture(t);
  const skillsDir = path.join(fixture.homeDir, '.agents', 'skills');
  await mkdir(skillsDir, { recursive: true });
  const outsideQa = path.join(fixture.root, 'outside-qa');
  const outsideReport = path.join(fixture.root, 'outside-report');
  await mkdir(outsideQa);
  await mkdir(outsideReport);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    await symlink(outsideQa, path.join(skillsDir, 'qa'), linkType);
    await symlink(outsideReport, path.join(skillsDir, 'report'), linkType);
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction requires Windows Developer Mode');
      return;
    }
    throw error;
  }

  const session = await completeAnswers(fixture, ['codex']);
  const preview = await session.preview();
  const linkedConflicts = preview.conflicts.filter((conflict) => (
    conflict.path.includes(`${path.sep}skills${path.sep}qa${path.sep}`) || conflict.path.includes(`${path.sep}skills${path.sep}report${path.sep}`)
  ));
  assert.equal(linkedConflicts.length, 0);

  const warning = preview.warnings.find((entry) => entry.includes(path.join(skillsDir, 'qa')));
  assert.ok(warning, 'expected an aggregated symlink-skip warning');
  assert.ok(warning.includes(path.join(skillsDir, 'report')));
  assert.match(warning, /^2 files skipped because their destination is a symbolic link\./);

  await session.answer({ confirm: true });
  await session.install();
  assert.deepEqual(await readdir(outsideQa), []);
  assert.deepEqual(await readdir(outsideReport), []);
});

test('content categories group all eleven features deterministically and control the included set', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
  });
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ scan: true });
  const contentStep = await session.answer({});
  assert.equal(contentStep.number, 4);

  assert.deepEqual(contentStep.categories.map((category) => category.id), ['planning', 'quality', 'continuity']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'planning').items.map((item) => item.name), ['brainstorm', 'plan', 'report']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'quality').items.map((item) => item.name), ['conflicts', 'corpo', 'observer', 'qa', 'tribunal']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'continuity').items.map((item) => item.name), ['catchup', 'docs', 'release']);
  const allIds = contentStep.categories.flatMap((category) => category.items.map((item) => item.id));
  assert.equal(new Set(allIds).size, 11);

  const planningIds = contentStep.categories.find((category) => category.id === 'planning').items.map((item) => item.id);
  const qualityIds = contentStep.categories.find((category) => category.id === 'quality').items.map((item) => item.id);
  const selection = [...planningIds, qualityIds[0]];
  const nextStep = await session.answer({ included: selection });
  assert.equal(nextStep.number, 5);

  const backToContent = await session.back();
  assert.equal(backToContent.number, 4);
  assert.deepEqual(backToContent.values.included, selection);
});

test('the preview groups files by owner: the mind for kit and data files, the adapter for agent files', async (context) => {
  const fixture = await makeFixture(context);
  const session = await completeAnswers(fixture, ['codex']);
  const preview = await session.preview();

  const rulesFile = preview.files.find((file) => file.path === path.join(fixture.mindPath, 'rules.md'));
  assert.deepEqual(rulesFile.owner, { id: 'mind', label: 'Mind' });
  const versionFile = preview.files.find((file) => file.path === path.join(fixture.mindPath, 'user', 'VERSION'));
  assert.deepEqual(versionFile.owner, { id: 'mind', label: 'Mind' });
  const skillFile = preview.files.find((file) => file.path === path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'));
  assert.deepEqual(skillFile.owner, { id: 'codex', label: 'Codex' });
});

test('a late file change aborts the whole install before an earlier write', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-preflight-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const firstPath = path.join(root, 'first.md');
  const latePath = path.join(root, 'late.md');
  await writeFile(latePath, 'previewed\n');
  const plan = combinePlans(
    await planDataFile({ destination: firstPath, content: 'first\n', root }),
    await planDataFile({ destination: latePath, content: 'replacement\n', root, allowExisting: true }),
  );

  await writeFile(latePath, 'changed after preview\n');
  await assert.rejects(() => applyInstallPlan(plan), /changed after preview/);
  await assert.rejects(() => lstat(firstPath), { code: 'ENOENT' });
  assert.equal(await readFile(latePath, 'utf8'), 'changed after preview\n');
});

test('install-plan warnings are rendered in the session language', async (context) => {
  for (const language of ['en', 'es']) {
    const fixture = await makeFixture(context);
    const session = await createSetupSession({
      kitPath: KIT_PATH,
      mindPath: fixture.mindPath,
      homeDir: fixture.homeDir,
      hostname: 'TESTBOX',
      language,
      env: { PATH: '' },
    });
    await session.answer({ installMode: 'custom' });
    await session.answer({ mindPath: fixture.mindPath });
    await session.answer({ scan: true });
    await session.answer({ addAgent: 'vscode' });
    await session.answer({ agents: ['codex', 'vscode'], attachModes: { codex: 'on-demand', vscode: 'auto' } });
    const includeStep = await session.getStep();
    await session.answer({ included: includeStep.values.included });
    await session.answer({ addRoot: fixture.projectsRoot });
    await session.answer({ projectsConfirmed: true });
    await session.answer({ skipPreferences: true, autoUpdates: false });

    const preview = await session.preview();
    const expected = text(language, 'warningNoRulesFile', { agent: 'Visual Studio Code' });
    assert.ok(preview.warnings.includes(expected), `expected ${language} warning: ${expected}`);

    await session.answer({ confirm: true });
    const result = await session.install();
    assert.ok(result.warnings.includes(expected), `expected ${language} completion warning: ${expected}`);
  }
});

async function makeFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-setup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  const projectsRoot = path.join(root, 'projects');
  const repository = path.join(projectsRoot, 'sample');
  await mkdir(path.join(repository, '.git'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  await writeFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'Existing agent preference stays first.\n');
  await writeFile(path.join(repository, 'package.json'), '{"name":"sample"}\n');
  await writeFile(path.join(mindPath, 'user', 'preferences.md'), '- 2026-01-01: Existing preference stays first. Why: chosen before setup.\n');
  return { root, mindPath, homeDir, projectsRoot };
}

async function completeAnswers(fixture, agents) {
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
  await answerReconfiguration(session, fixture, agents);
  return session;
}

async function answerReconfiguration(session, fixture, agents) {
  await session.answer({ installMode: 'custom' });
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ scan: true });
  await session.answer({ agents, attachModes: Object.fromEntries(agents.map((agent) => [agent, 'on-demand'])) });
  const includeStep = await session.getStep();
  await session.answer({ included: includeStep.values.included });
  await session.answer({ addRoot: fixture.projectsRoot });
  await session.answer({ projectsConfirmed: true });
  await session.answer({ skipPreferences: true, autoUpdates: false });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
