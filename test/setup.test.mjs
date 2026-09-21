import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAdapters } from '../engine/discovery.mjs';
import { applyInstallPlan, combinePlans, installAgentAssets, planAgentAssets, planDataFile } from '../engine/install.mjs';
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
  assert.deepEqual(includeStep.categories.map((category) => category.id).filter((id) => id !== 'other'), ['planning', 'quality', 'continuity', 'knowledge']);
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
  assert.deepEqual(result.attachPrompts, []);
  const copilot = await readFile(path.join(fixture.homeDir, '.copilot', 'instructions', 'hivem1nd.instructions.md'), 'utf8');
  assert.match(copilot, /^---\ndescription: .+\napplyTo: "\*\*"\n---\n\nHIVEM1ND: the mind is at /);

  const installed = await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'), 'utf8');
  assert.match(installed, new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  const installedSkills = await readdir(path.join(fixture.homeDir, '.agents', 'skills'));
  const featureNames = (await readdir(path.join(KIT_PATH, 'features')))
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .map((name) => path.basename(name, '.md'));
  assert.ok(featureNames.length > 0);
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

test('a symbolic ancestor becomes one conflict with replace as the default, and omitting writes nothing behind it', async (t) => {
  const fixture = await makeFixture(t);
  const outside = path.join(fixture.root, 'outside');
  await mkdir(outside);
  const link = path.join(fixture.homeDir, '.agents');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
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
  const linkConflicts = preview.conflicts.filter((conflict) => conflict.link === true);
  assert.equal(linkConflicts.length, 1);
  assert.equal(linkConflicts[0].path, link);
  assert.deepEqual(linkConflicts[0].choices, ['replace', 'omit']);
  assert.equal(linkConflicts[0].selection, 'replace');
  const perFileConflicts = preview.conflicts.filter((conflict) => conflict.path.startsWith(`${link}${path.sep}`));
  assert.equal(perFileConflicts.length, 0);
  assert.ok(preview.files.some((file) => file.path.startsWith(`${link}${path.sep}`)), 'files behind the link stay in the plan');

  const step = await session.getStep();
  const conflictField = step.fields.find((field) => field.label === link);
  assert.deepEqual(conflictField.options.map((option) => option.value), ['replace', 'omit']);
  assert.equal(conflictField.options[0].label, text('en', 'replaceLink'));

  await session.answer({ confirm: true, conflicts: { [link]: 'omit' } });
  const result = await session.install();
  assert.ok(result.omitted.length > 0);
  assert.ok(result.omitted.every((item) => item.component === link));
  assert.equal(result.files.filter((file) => file.startsWith(`${link}${path.sep}`)).length, 0);
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await lstat(link)).isSymbolicLink(), true);

  const report = await readFile(result.reportPath, 'utf8');
  assert.match(report, new RegExp(`^omitted: ${result.omitted.length}$`, 'm'));
  assert.ok(report.includes(link));
  const record = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.equal(record.setup, 'done');
  assert.equal(Object.keys(record.managedFiles).some((filePath) => filePath.startsWith(`${link}${path.sep}`)), false);
});

test('replacing a junction inside a skills folder removes the link, writes the files and leaves the target untouched', async (t) => {
  const fixture = await makeFixture(t);
  const skillsDir = path.join(fixture.homeDir, '.agents', 'skills');
  await mkdir(skillsDir, { recursive: true });
  const outsideQa = path.join(fixture.root, 'outside-qa');
  const outsideReport = path.join(fixture.root, 'outside-report');
  await mkdir(outsideQa);
  await mkdir(outsideReport);
  await writeFile(path.join(outsideQa, 'kept.md'), 'kept\n');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const qaLink = path.join(skillsDir, 'qa');
  const reportLink = path.join(skillsDir, 'report');
  try {
    await symlink(outsideQa, qaLink, linkType);
    await symlink(outsideReport, reportLink, linkType);
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction requires Windows Developer Mode');
      return;
    }
    throw error;
  }

  const session = await completeAnswers(fixture, ['codex']);
  const preview = await session.preview();
  const linkConflicts = preview.conflicts.filter((conflict) => conflict.link === true);
  assert.deepEqual(linkConflicts.map((conflict) => conflict.path).sort(), [qaLink, reportLink].sort());

  await session.answer({ confirm: true, conflicts: { [qaLink]: 'replace', [reportLink]: 'replace' } });
  const result = await session.install();
  assert.deepEqual(result.omitted, []);
  assert.deepEqual([...result.replacedLinks].sort(), [qaLink, reportLink].sort());
  assert.equal((await lstat(qaLink)).isSymbolicLink(), false);
  assert.ok(result.files.includes(path.join(qaLink, 'SKILL.md')));
  assert.ok((await readdir(qaLink)).includes('SKILL.md'));
  // The folder the junction pointed at keeps its own content.
  assert.deepEqual(await readdir(outsideQa), ['kept.md']);
  assert.deepEqual(await readdir(outsideReport), []);

  const report = await readFile(result.reportPath, 'utf8');
  assert.match(report, /^links-replaced: 2$/m);
  const record = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.equal(record.setup, 'done');
  assert.equal(record.managedFiles[path.join(qaLink, 'SKILL.md')] !== undefined, true);
});

test('content categories group every feature deterministically and control the included set', async (context) => {
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

  assert.deepEqual(contentStep.categories.map((category) => category.id).filter((id) => id !== 'other'), ['planning', 'quality', 'continuity', 'knowledge']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'planning').items.map((item) => item.name), ['brainstorm', 'plan', 'report']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'quality').items.map((item) => item.name), ['conflicts', 'corpo', 'observer', 'qa', 'tribunal']);
  assert.deepEqual(contentStep.categories.find((category) => category.id === 'continuity').items.map((item) => item.name), ['catchup', 'docs', 'release']);
  const allIds = contentStep.categories.flatMap((category) => category.items.map((item) => item.id));
  const featureCount = (await readdir(path.join(KIT_PATH, 'features')))
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md').length;
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(allIds.filter((id) => id.startsWith('feature:')).length, featureCount);

  const planningIds = contentStep.categories.find((category) => category.id === 'planning').items.map((item) => item.id);
  const qualityIds = contentStep.categories.find((category) => category.id === 'quality').items.map((item) => item.id);
  const selection = [...planningIds, qualityIds[0]];
  const nextStep = await session.answer({ included: selection });
  assert.equal(nextStep.number, 5);

  const backToContent = await session.back();
  assert.equal(backToContent.number, 4);
  assert.deepEqual(backToContent.values.included, selection);
});

test('knowledge packs form their own last group, and each option names the pack and the commands it installs', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-packs-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const kitPath = path.join(root, 'kit');
  const homeDir = path.join(root, 'home');
  const mindPath = path.join(root, 'mind');
  await mkdir(path.join(kitPath, 'features'), { recursive: true });
  await mkdir(path.join(kitPath, 'knowledge', 'security', 'features'), { recursive: true });
  await mkdir(path.join(kitPath, 'knowledge', 'security', 'protocols'), { recursive: true });
  await mkdir(path.join(kitPath, 'knowledge', 'design'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  await writeFile(path.join(kitPath, 'features', 'alpha.md'), '---\nname: alpha\ndescription: Alpha.\ncategory: planning\n---\n\n# Alpha\n');
  await writeFile(path.join(kitPath, 'knowledge', 'security', 'features', 'cyberattack.md'), '---\nname: cyberattack\ndescription: Attack.\n---\n\n# Cyberattack\n');
  await writeFile(path.join(kitPath, 'knowledge', 'security', 'protocols', 'secrets.md'), '# Secrets\n');
  await writeFile(path.join(kitPath, 'knowledge', 'design', 'INDEX.md'), '# Design\n');

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

  assert.deepEqual(step.categories.map((category) => category.id), ['planning', 'knowledge']);
  const packs = step.categories.at(-1);
  assert.equal(packs.label, text('en', 'categoryPacks'));
  assert.deepEqual(packs.items, [
    { id: 'knowledge:design', name: 'design', commands: [] },
    { id: 'knowledge:security', name: 'security', commands: ['/cyberattack'] },
  ]);
  const labelById = new Map(step.fields[0].options.map((entry) => [entry.value, entry.label]));
  assert.equal(labelById.get('knowledge:security'), 'security /cyberattack');
  assert.equal(labelById.get('knowledge:design'), 'design');
  assert.equal(labelById.get('feature:alpha'), '/alpha');
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
  const [vscode] = (await loadAdapters({ kitPath: KIT_PATH })).filter((adapter) => adapter.id === 'vscode');
  const ruleless = { ...vscode, id: 'ruleless', displayName: 'Ruleless Agent', rules: null };
  for (const language of ['en', 'es']) {
    const fixture = await makeFixture(context);
    const plan = await planAgentAssets({
      kitPath: KIT_PATH,
      mindPath: fixture.mindPath,
      homeDir: fixture.homeDir,
      env: { PATH: '' },
      adapters: [ruleless],
      agents: [{ name: 'ruleless', mode: 'auto' }],
      language,
    });
    const expected = text(language, 'warningNoRulesFile', { agent: 'Ruleless Agent' });
    assert.ok(plan.warnings.includes(expected), `expected ${language} warning: ${expected}`);
  }
});

test('the attach prompt keeps the literal mind placeholder', () => {
  for (const language of ['en', 'es']) {
    const prompt = text(language, 'attachPrompt', { mind: 'C:/mind', placeholder: '{{mind}}' });
    assert.match(prompt, /\{\{mind\}\} (with|por) C:\/mind\./);
  }
});

test('setup installs a role and a feature added to the mind folder', async (context) => {
  const fixture = await makeFixture(context);
  await mkdir(path.join(fixture.mindPath, 'roles'), { recursive: true });
  await mkdir(path.join(fixture.mindPath, 'features'), { recursive: true });
  await writeFile(
    path.join(fixture.mindPath, 'roles', 'archivist.md'),
    '---\nname: archivist\ndescription: Archive.\n---\n\n# Archivist\n\nMind: {{mind}}\n',
  );
  await writeFile(path.join(fixture.mindPath, 'features', 'tidy.md'), '---\nname: tidy\ndescription: Tidy.\n---\n\n# Tidy\n');

  const session = await completeAnswers(fixture, ['codex']);
  await session.answer({ confirm: true });
  await session.install();

  const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'archivist', 'SKILL.md');
  assert.match(await readFile(skillPath, 'utf8'), new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  assert.match(await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'tidy', 'SKILL.md'), 'utf8'), /# Tidy/);
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.ok(machine.managedFiles[skillPath]);
});

test('a private role in user/roles installs like a kit role, and a kit name keeps the kit file', async (context) => {
  const fixture = await makeFixture(context);
  await mkdir(path.join(fixture.mindPath, 'user', 'roles'), { recursive: true });
  await mkdir(path.join(fixture.mindPath, 'user', 'commands'), { recursive: true });
  await writeFile(
    path.join(fixture.mindPath, 'user', 'roles', 'overmind.md'),
    ['---', 'name: overmind', 'description: Private role.', '---', '', '# Overmind', '', 'Mind: {{mind}}', ''].join('\n'),
  );
  await writeFile(
    path.join(fixture.mindPath, 'user', 'commands', 'relay.md'),
    ['---', 'name: relay', 'description: A name the kit already ships.', '---', '', '# Local relay', ''].join('\n'),
  );

  const session = await completeAnswers(fixture, ['codex']);
  await session.answer({ confirm: true });
  const result = await session.install();

  const privateSkill = path.join(fixture.homeDir, '.agents', 'skills', 'overmind', 'SKILL.md');
  assert.match(await readFile(privateSkill, 'utf8'), new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'));
  assert.ok(machine.managedFiles[privateSkill]);
  // The private half never reaches the published folder.
  assert.equal(await pathExists(path.join(fixture.mindPath, 'roles', 'overmind.md')), false);
  // A name the kit already ships keeps the kit file and says so.
  assert.doesNotMatch(await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'relay', 'SKILL.md'), 'utf8'), /# Local relay/);
  assert.ok(result.warnings.some((warning) => warning.includes(path.join('user', 'commands', 'relay.md'))));
});

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('custom mode alerts about an installed mind, attaches the machine and leaves the mind content alone', async (context) => {
  const fixture = await makeFixture(context);
  await makeInstalledMind(fixture, '1.0.0');
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'SECOND',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });

  await session.answer({ installMode: 'custom' });
  const location = await session.getStep();
  assert.equal(location.number, 2);
  assert.equal(location.existingMind.path, fixture.mindPath);
  assert.equal(location.existingMind.version, '1.0.0');
  assert.match(location.alert, /1\.0\.0/);
  const attachField = location.fields.find((field) => field.id === 'attach');
  assert.ok(attachField, 'expected the attach question');
  assert.equal(location.values.attach, true);

  await session.answer({ mindPath: fixture.mindPath, attach: true });
  await session.answer({ scan: true });
  await session.answer({ agents: ['codex'], attachModes: { codex: 'auto' } });
  const includeStep = await session.getStep();
  await session.answer({ included: includeStep.values.included });
  await session.answer({ addRoot: fixture.projectsRoot });
  // Preferences belong to the mind, so an attach goes straight to the install step.
  const installStep = await session.answer({ projectsConfirmed: true });
  assert.equal(installStep.number, 7);

  const preview = await session.preview();
  const mindFiles = preview.files.filter((file) => file.path.startsWith(`${fixture.mindPath}${path.sep}`));
  assert.deepEqual(
    mindFiles.map((file) => path.relative(fixture.mindPath, file.path)).sort(),
    [path.join('user', 'machines', 'SECOND.md'), path.join('user', 'routes.md')].sort(),
  );

  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.attached, true);
  assert.ok(result.notices.some((notice) => notice.includes(fixture.mindPath)));
  assert.ok(result.notices.some((notice) => notice.includes('1.0.0')), 'expected the version pair notice');
  assert.equal(await readFile(path.join(fixture.mindPath, 'user', 'VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(
    await readFile(path.join(fixture.mindPath, 'user', 'preferences.md'), 'utf8'),
    '- 2026-01-01: Existing preference stays first. Why: chosen before setup.\n',
  );
  assert.equal(await readFile(path.join(fixture.mindPath, 'rules.md'), 'utf8'), 'Older rules kept.\n');
  const machine = parseMachineRecord(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'SECOND.md'), 'utf8'));
  assert.equal(machine.setup, 'done');
  assert.ok(machine.managedFiles[path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md')]);
});

test('simple mode attaches to a mind already installed on this machine instead of writing a second one', async (context) => {
  const fixture = await makeFixture(context);
  const installed = path.join(fixture.homeDir, 'HIVEM1ND');
  await makeInstalledMind({ ...fixture, mindPath: installed }, '1.1.1');
  const session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: path.join(fixture.root, 'unused'),
    homeDir: fixture.homeDir,
    hostname: 'SECOND',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });

  const step = await session.answer({ installMode: 'simple' });
  assert.equal(step.number, 7);
  const preview = await session.preview();
  assert.equal(preview.files.some((file) => file.path.startsWith(`${path.join(fixture.root, 'unused')}${path.sep}`)), false);
  await session.answer({ confirm: true });
  const result = await session.install();
  assert.equal(result.attached, true);
  assert.equal(result.mindPath, installed);
  assert.equal(await pathExists(path.join(fixture.root, 'unused')), false);
  assert.equal(await readFile(path.join(installed, 'user', 'VERSION'), 'utf8'), '1.1.1\n');
  assert.ok(await pathExists(path.join(installed, 'user', 'machines', 'SECOND.md')));
});

async function makeInstalledMind(fixture, version) {
  await mkdir(path.join(fixture.mindPath, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(fixture.mindPath, 'rules.md'), 'Older rules kept.\n');
  await writeFile(path.join(fixture.mindPath, 'files.md'), 'Older formats kept.\n');
  await writeFile(path.join(fixture.mindPath, 'user', 'VERSION'), `${version}\n`);
  await writeFile(
    path.join(fixture.mindPath, 'user', 'preferences.md'),
    '- 2026-01-01: Existing preference stays first. Why: chosen before setup.\n',
  );
  await writeFile(path.join(fixture.mindPath, 'user', 'routes.md'), '## Environments\n\n## Projects\n\n## Minds\n');
}

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
