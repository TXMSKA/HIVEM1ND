import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadAdapters } from '../engine/discovery.mjs';
import { applyInstallPlan, combinePlans, installAgentAssets, planAgentAssets, planDataFile, planManagedFileRemovals } from '../engine/install.mjs';
import { evolve } from '../engine/lifecycle.mjs';
import { assertSafePath, hashContent, readMachineRecord, writeMachineRecord } from '../engine/records.mjs';
import { createSetupSession as rawCreateSetupSession, SetupValidationError } from '../engine/setup.mjs';
import { text } from '../engine/texts.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { legacyTreeInventory } from '../engine/legacy-copy.mjs';
import { legacySessions } from '../engine/relay/local-wake.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createSetupSession = options => rawCreateSetupSession({ aclRunner: stubAclRunner(), ...options });

test('setup exposes four descriptors and preserves unreviewed client files', async context => {
 const fixture=await makeFixture(context); const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},language:'en'});
 const first=await session.getStep();
 assert.deepEqual({id:first.id,number:first.number,total:first.total,back:first.back,busy:first.busy,done:first.done,title:first.title,description:first.description,fields:first.fields,values:first.values,action:first.action}, {id:'install',number:1,total:4,back:false,busy:false,done:false,title:'Install HIVEM1ND',description:'Setup takes about a minute.',fields:[],values:{},action:'Start setup'});
 assert.deepEqual(first.bullets,['Control the Swarm from the Map','Organize agents to reach objectives faster and better','Relay is used for inter-session communication']);
 const location=await session.answer({}); assert.equal(location.id,'location');assert.equal(location.number,2);assert.equal(location.back,true);assert.deepEqual(location.fields.map(field=>field.id),['mindPath']);assert.equal(location.values.mindPath,fixture.mindPath);assert.equal(location.relayPlus.disabled,true);
 const service=await session.answer({mindPath:fixture.mindPath}); assert.equal(service.id,'service');assert.equal(service.number,3);assert.equal(service.back,false);assert.deepEqual(service.progress.map(row=>row.state),['todo','todo','todo','todo']);
 await session.answer({confirm:true});await session.install();const ready=await session.getStep();assert.equal(ready.id,'ready');assert.equal(ready.number,4);assert.equal(ready.done,true);assert.equal(ready.back,false);assert.equal(ready.action,'Open the Map');assert.deepEqual(ready.summary.map(row=>row.id),['mind','service','agents','projects']);assert.equal(ready.summary.find(row=>row.id==='agents').count,1);
 assert.equal(await readFile(path.join(fixture.homeDir,'.codex','AGENTS.md'),'utf8'),'Existing agent preference stays first.\n');assert.equal(await pathExists(path.join(fixture.homeDir,'.agents','skills')),false);
 const resumed=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},resume:true});assert.equal((await resumed.getStep()).id,'ready');
});

test('setup detects agents and content with defaults',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},language:'en'});await session.answer({});await session.answer({mindPath:fixture.mindPath});assert.equal((await session.getStep()).number,3);assert.deepEqual(session.answers.agents.map(agent=>agent.id),['codex']);assert.deepEqual(session.answers.included,(await session.availableContent()).map(item=>item.id));assert.equal(session.answers.updateCheck,'daily');await session.answer({confirm:true});await session.install();assert.equal((await readMachineRecord(fixture.mindPath,'TESTBOX')).record.updateCheck,'daily');
});

test('Back is available only from location',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''}});await session.answer({});assert.equal((await session.back()).id,'install');await session.answer({});await session.answer({mindPath:fixture.mindPath});await assert.rejects(session.back(),error=>error.code==='back_unavailable');await session.answer({confirm:true});await session.install();await assert.rejects(session.back(),error=>error.code==='back_unavailable');
});

test('language changes preserve folder and four-step position',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},language:'en'});await session.answer({});const step=await session.setLanguage('es');assert.equal(step.title,'Dónde se guarda el M1ND');assert.equal(step.values.mindPath,fixture.mindPath);assert.equal(step.action,'Continuar');await session.answer({mindPath:fixture.mindPath});assert.equal((await session.getStep()).title,'Iniciando el servicio Relay');
});

test('a resumed location retains the selected folder',async context=>{
 const fixture=await makeFixture(context);const options={kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},language:'en'};const session=await createSetupSession(options);await session.answer({});const chosen=path.join(fixture.root,'chosen');await session.answer({mindPath:chosen,changeFolder:true});const resumed=await createSetupSession({...options,mindPath:chosen,resume:true});const step=await resumed.getStep();assert.equal(step.id,'location');assert.equal(step.values.mindPath,chosen);
});

test('unowned files and modified managed skills require per-file choices', async (context) => {
  const fixture = await makeFixture(context);
  const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md');
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, 'private executor\n');
  const session = await completeAnswers(fixture, ['codex']);

  let preview = await session.preview();
  const conflict = preview.clientChanges.conflicts.find((item) => item.path === skillPath);
  assert.equal(conflict.reason, 'An unowned file already exists at this path.');
  await session.answer({ confirm: true });
  await session.install();
  assert.equal(await readFile(skillPath, 'utf8'), 'private executor\n');
  await applyReviewedClients(fixture, { [skillPath]: 'keep' });

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
  assert.ok(preview.clientChanges.conflicts.some((item) => item.path === skillPath));
  await replaceSession.answer({ confirm: true });
  await replaceSession.install();
  assert.equal(await readFile(skillPath, 'utf8'), 'private executor\n');
  await applyReviewedClients(fixture, { [skillPath]: 'replace' });
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

test('install and evolve prune retired kit files and skills, and previews leave them on disk', async (context) => {
  for (const action of ['install', 'evolve']) {
    const fixture = await makeRetirementFixture(context);
    const options = { ...fixture, hostname: 'TESTBOX', env: { PATH: '' } };
    const copyPath = path.join(fixture.mindPath, 'roles', 'retired.md');
    const skillDirectory = path.join(fixture.homeDir, '.agents', 'skills', 'retired');
    const skillPath = path.join(skillDirectory, 'SKILL.md');
    const bundleDirectory = path.join(fixture.homeDir, '.agents', 'skills', 'bundle');
    const supportPath = path.join(bundleDirectory, 'scripts', 'run.mjs');
    await rm(path.join(fixture.kitPath, 'roles', 'retired.md'));
    await rm(path.join(fixture.kitPath, 'features', 'bundle'), { recursive: true });
    const machinePath = path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md');
    const before = await readFile(machinePath, 'utf8');
    const session = action === 'install' ? await completeAnswers(fixture, ['codex']) : null;
    if (session) await session.preview();
    const preview = await installAgentAssets({ ...options, previewOnly: true });
    const removals = preview.removed;
    assert.ok([copyPath, skillPath, supportPath].every((filePath) => removals.includes(filePath)), action);
    for (const filePath of [copyPath, skillPath, supportPath]) assert.equal(await pathExists(filePath), true);
    if (!session) assert.equal(await readFile(machinePath, 'utf8'), before);

    if (session) await session.answer({ confirm: true });
    const setupResult = session ? await session.install() : null;
    const setupReport = setupResult ? await readFile(setupResult.reportPath, 'utf8') : '';
    const result = session ? await applyReviewedClients(fixture) : await evolve({ ...options, pull: false });
    for (const filePath of [copyPath, skillPath, supportPath, skillDirectory, bundleDirectory]) {
      assert.equal(await pathExists(filePath), false, `${action}: ${filePath}`);
    }
    assert.ok([...result.removed, ...(setupResult?.removed ?? [])].includes(copyPath));
    assert.ok(result.removed.includes(skillPath));
    const record = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
    for (const filePath of [copyPath, skillPath, supportPath]) assert.equal(record.managedFiles[filePath], undefined);
    assert.equal(await pathExists(path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md')), true);
    const report = setupReport + await readFile(result.reportPath, 'utf8');
    assert.match(report, /## Removed/);
    assert.ok(report.includes(copyPath));
  }
});

test('retired managed files edited by the user are kept, released and reported in both languages', async (context) => {
  for (const language of ['en', 'es']) {
    const fixture = await makeRetirementFixture(context);
    const copyPath = path.join(fixture.mindPath, 'roles', 'retired.md');
    const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'retired', 'SKILL.md');
    await rm(path.join(fixture.kitPath, 'roles', 'retired.md'));
    await writeFile(copyPath, 'edited mind copy\n');
    await writeFile(skillPath, 'edited skill\n');
    const result = await installAgentAssets({ ...fixture, hostname: 'TESTBOX', env: { PATH: '' }, language });
    assert.deepEqual(result.conflicts, []);
    assert.equal(await readFile(copyPath, 'utf8'), 'edited mind copy\n');
    assert.equal(await readFile(skillPath, 'utf8'), 'edited skill\n');
    const record = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
    const report = await readFile(result.reportPath, 'utf8');
    assert.ok(report.includes(`## ${text(language, 'reportKept')}`));
    for (const filePath of [copyPath, skillPath]) {
      assert.equal(record.managedFiles[filePath], undefined);
      assert.ok(report.includes(`${filePath}: ${text(language, 'reasonManagedFileModified')}`));
    }
  }
});

test('pruning never removes managed or unowned files under user', async (context) => {
  const fixture = await makeRetirementFixture(context);
  const userPath = path.join(fixture.mindPath, 'user');
  const privatePath = path.join(userPath, 'roles', 'private.md');
  const trackedPath = path.join(userPath, 'notes.md');
  const unownedPath = path.join(userPath, 'tasks', '001-private.md');
  await mkdir(path.dirname(privatePath), { recursive: true });
  await mkdir(path.dirname(unownedPath), { recursive: true });
  await writeFile(privatePath, '---\nname: private\ndescription: Private.\n---\n\n# Private\n');
  await writeFile(trackedPath, 'private notes\n');
  await writeFile(unownedPath, 'private task\n');
  const machinePath = path.join(userPath, 'machines', 'TESTBOX.md');
  const record = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  record.managedFiles[privatePath] = hashContent(await readFile(privatePath));
  record.managedFiles[trackedPath] = hashContent(await readFile(trackedPath));
  await writeMachineRecord(fixture.mindPath, 'TESTBOX', record);
  const before = await Promise.all([privatePath, trackedPath, unownedPath].map((filePath) => readFile(filePath, 'utf8')));
  const result = await installAgentAssets({ ...fixture, hostname: 'TESTBOX', env: { PATH: '' } });
  assert.deepEqual(await Promise.all([privatePath, trackedPath, unownedPath].map((filePath) => readFile(filePath, 'utf8'))), before);
  assert.ok(!result.removed.some((filePath) => filePath.startsWith(`${userPath}${path.sep}`)));
  assert.equal(await pathExists(path.join(fixture.homeDir, '.agents', 'skills', 'private', 'SKILL.md')), true);
});

test('a failed write leaves retired files intact and a late edit is kept during pruning', async (context) => {
  const fixture = await makeFixture(context);
  const retiredPath = path.join(fixture.mindPath, 'roles', 'retired.md');
  const firstPath = path.join(fixture.root, 'first.md');
  const blockedPath = path.join(fixture.root, 'blocked', 'late.md');
  await mkdir(path.dirname(retiredPath), { recursive: true });
  await writeFile(retiredPath, 'retired\n');
  const plan = await planManagedFileRemovals(combinePlans(
    await planDataFile({ destination: firstPath, content: 'first\n', root: fixture.root }),
    await planDataFile({ destination: blockedPath, content: 'late\n', root: fixture.root }),
  ), { managedFiles: { [retiredPath]: hashContent('retired\n') }, mindPath: fixture.mindPath });
  plan.items[1].root = path.join(fixture.root, 'outside');
  await assert.rejects(() => applyInstallPlan(plan), /Path escapes the selected destination/);
  assert.equal(await pathExists(firstPath), false);
  assert.equal(await readFile(retiredPath, 'utf8'), 'retired\n');

  const rulePath = path.join(fixture.homeDir, '.codex', 'AGENTS.md');
  const removalPlan = await planManagedFileRemovals(combinePlans(), {
    managedFiles: { [retiredPath]: hashContent('retired\n'), [rulePath]: hashContent(await readFile(rulePath, 'utf8')) },
    mindPath: fixture.mindPath,
  });
  await writeFile(retiredPath, 'late edit\n');
  const result = await applyInstallPlan(removalPlan);
  assert.deepEqual(result.removed, []);
  assert.equal(await pathExists(rulePath), true);
  assert.equal(result.kept[0].path, retiredPath);
  assert.equal(await readFile(retiredPath, 'utf8'), 'late edit\n');
});

async function makeRetirementFixture(context) {
  const fixture = await makeFixture(context);
  const kitPath = path.join(fixture.root, 'kit');
  await mkdir(path.join(kitPath, 'roles'), { recursive: true });
  await mkdir(path.join(kitPath, 'features', 'bundle', 'scripts'), { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), '{"name":"hivem1nd-test","version":"1.0.0","files":["roles/","features/"]}\n');
  for (const name of ['executor', 'retired']) {
    await writeFile(path.join(kitPath, 'roles', `${name}.md`), `---\nname: ${name}\ndescription: Test role.\n---\n\n# ${name}\n`);
  }
  await writeFile(path.join(kitPath, 'features', 'bundle', 'bundle.md'), '---\nname: bundle\ndescription: Bundle.\n---\n\n# Bundle\n');
  await writeFile(path.join(kitPath, 'features', 'bundle', 'scripts', 'run.mjs'), 'export const bundled = true;\n');
  fixture.kitPath = kitPath;
  const session = await completeAnswers(fixture, ['codex']);
  await session.answer({ confirm: true });
  await session.install();
  await applyReviewedClients(fixture);
  return fixture;
}

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
  assert.equal(step.values.mindPath, path.join(homeDir, 'AppData', 'Local', 'Cosmic', '.m1nd'));
  assert.ok(!step.values.mindPath.toLowerCase().includes('.qa'));
  assert.ok(!step.values.mindPath.startsWith(path.join(KIT_PATH, 'user')));
});

test('location has Folder and disabled Relay+ without mode, sync or origin controls',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''},language:'en'});const step=await session.answer({});assert.deepEqual(step.fields,[{id:'mindPath',type:'text',label:'Folder',required:true}]);for(const key of ['presets','originKind','sync','installMode','agents','categories','groups'])assert.equal(step[key],undefined);assert.deepEqual(step.relayPlus,{title:'Use Relay+',badge:'Coming soon',body:'Sync your preferences on any device, phones included, through the same service as Nebula+.',disabled:true});
});

test('Change reviews a folder without leaving location',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''}});await session.answer({});const chosen=path.join(fixture.homeDir,'chosen');const step=await session.answer({mindPath:chosen,changeFolder:true});assert.equal(step.id,'location');assert.equal(step.values.mindPath,chosen);assert.equal((await session.answer({mindPath:chosen})).id,'service');
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
  const linkConflicts = preview.clientChanges.conflicts.filter((conflict) => conflict.link === true);
  assert.equal(linkConflicts.length, 1);
  assert.equal(linkConflicts[0].path, link);
  assert.deepEqual(linkConflicts[0].choices, ['replace', 'omit']);
  assert.equal(linkConflicts[0].selection, 'replace');
  const perFileConflicts = preview.clientChanges.conflicts.filter((conflict) => conflict.path.startsWith(`${link}${path.sep}`));
  assert.equal(perFileConflicts.length, 0);
  assert.ok(preview.clientChanges.files.some((file) => file.path.startsWith(`${link}${path.sep}`)), 'files behind the link stay in the review plan');

  const step = await session.getStep();
  const conflictField = step.fields.find((field) => field.label === link);
  assert.equal(conflictField, undefined);

  await session.answer({ confirm: true, conflicts: { [link]: 'omit' } });
  await session.install();
  const result = await applyReviewedClients(fixture, { [link]: 'omit' });
  assert.ok(result.omitted.length > 0);
  assert.ok(result.omitted.every((item) => item.component === link));
  assert.equal(result.agents.flatMap(agent => agent.files).filter(file => file.startsWith(`${link}${path.sep}`)).length, 0);
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await lstat(link)).isSymbolicLink(), true);

  const report = await readFile(result.reportPath, 'utf8');
  assert.match(report, new RegExp(`^omitted: ${result.omitted.length}$`, 'm'));
  assert.ok(report.includes(link));
  const record = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
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
  const linkConflicts = preview.clientChanges.conflicts.filter((conflict) => conflict.link === true);
  assert.deepEqual(linkConflicts.map((conflict) => conflict.path).sort(), [qaLink, reportLink].sort());

  await session.answer({ confirm: true, conflicts: { [qaLink]: 'replace', [reportLink]: 'replace' } });
  await session.install();
  assert.equal((await lstat(qaLink)).isSymbolicLink(), true);
  const result = await applyReviewedClients(fixture, { [qaLink]: 'replace', [reportLink]: 'replace' });
  assert.deepEqual(result.omitted, []);
  assert.deepEqual([...result.replacedLinks].sort(), [qaLink, reportLink].sort());
  assert.equal((await lstat(qaLink)).isSymbolicLink(), false);
  assert.ok(result.agents.flatMap(agent => agent.files).includes(path.join(qaLink, 'SKILL.md')));
  assert.ok((await readdir(qaLink)).includes('SKILL.md'));
  // The folder the junction pointed at keeps its own content.
  assert.deepEqual(await readdir(outsideQa), ['kept.md']);
  assert.deepEqual(await readdir(outsideReport), []);

  const report = await readFile(result.reportPath, 'utf8');
  assert.match(report, /^links-replaced: 2$/m);
  const record = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.equal(record.setup, 'done');
  assert.equal(record.managedFiles[path.join(qaLink, 'SKILL.md')] !== undefined, true);
});

test('all detected content is included by default',async context=>{
 const fixture=await makeFixture(context);const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'TESTBOX',env:{PATH:''}});await session.applySimpleDefaults();const content=await session.availableContent();assert.equal(new Set(content.map(item=>item.id)).size,content.length);assert.ok(content.some(item=>item.id==='feature:blueprint'));assert.deepEqual(session.answers.included,content.map(item=>item.id));
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
  const items=await session.availableContent();assert.ok(items.some(item=>item.id==='knowledge:design'));assert.ok(items.some(item=>item.id==='knowledge:security'));assert.ok(items.some(item=>item.id==='feature:alpha'));
});

test('the preview groups files by owner: the mind for kit and data files, the adapter for agent files', async (context) => {
  const fixture = await makeFixture(context);
  const session = await completeAnswers(fixture, ['codex']);
  const preview = await session.preview();

  const rulesFile = preview.files.find((file) => file.path === path.join(fixture.mindPath, 'rules.md'));
  assert.deepEqual(rulesFile.owner, { id: 'mind', label: 'M1ND' });
  const versionFile = preview.files.find((file) => file.path === path.join(fixture.mindPath, 'user', 'VERSION'));
  assert.deepEqual(versionFile.owner, { id: 'mind', label: 'M1ND' });
  const skillFile = preview.clientChanges.files.find((file) => file.path === path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md'));
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

  assert.equal(await pathExists(path.join(fixture.homeDir, '.agents', 'skills', 'archivist')), false);
  await applyReviewedClients(fixture);

  const skillPath = path.join(fixture.homeDir, '.agents', 'skills', 'archivist', 'SKILL.md');
  assert.match(await readFile(skillPath, 'utf8'), new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  assert.match(await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'tidy', 'SKILL.md'), 'utf8'), /# Tidy/);
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.ok(machine.managedFiles[skillPath]);
});

test('a private role in user/roles installs like a kit role, and a kit name keeps the kit file', async (context) => {
  const fixture = await makeFixture(context);
  await mkdir(path.join(fixture.mindPath, 'user', 'roles'), { recursive: true });
  await mkdir(path.join(fixture.mindPath, 'user', 'commands'), { recursive: true });
  await writeFile(
    path.join(fixture.mindPath, 'user', 'roles', 'curator.md'),
    ['---', 'name: curator', 'description: Private role.', '---', '', '# Curator', '', 'Mind: {{mind}}', ''].join('\n'),
  );
  await writeFile(
    path.join(fixture.mindPath, 'user', 'commands', 'relay.md'),
    ['---', 'name: relay', 'description: A name the kit already ships.', '---', '', '# Local relay', ''].join('\n'),
  );

  const session = await completeAnswers(fixture, ['codex']);
  await session.answer({ confirm: true });
  const result = await session.install();

  assert.equal(await pathExists(path.join(fixture.homeDir, '.agents', 'skills', 'curator')), false);
  await applyReviewedClients(fixture);

  const privateSkill = path.join(fixture.homeDir, '.agents', 'skills', 'curator', 'SKILL.md');
  assert.match(await readFile(privateSkill, 'utf8'), new RegExp(`Mind: ${escapeRegExp(fixture.mindPath)}`));
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.ok(machine.managedFiles[privateSkill]);
  // The private half never reaches the published folder.
  assert.equal(await pathExists(path.join(fixture.mindPath, 'roles', 'curator.md')), false);
  // A name the kit already ships keeps the kit file and says so.
  assert.doesNotMatch(await readFile(path.join(fixture.homeDir, '.agents', 'skills', 'relay', 'SKILL.md'), 'utf8'), /# Local relay/);
  assert.ok(result.clientChanges.warnings.some((warning) => warning.includes(path.join('user', 'commands', 'relay.md'))));
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

test('running setup again keeps the evidence folder recorded in the machine paths', async (context) => {
  const fixture = await makeFixture(context);
  const options = { kitPath: KIT_PATH, mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', language: 'en', env: { PATH: '' }, resume: false };
  let session = await createSetupSession(options);
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  await session.install();

  const { record } = await readMachineRecord(fixture.mindPath, 'TESTBOX');
  record.paths.push({ name: 'evidence', path: path.join(fixture.root, 'evidence') });
  await writeMachineRecord(fixture.mindPath, 'TESTBOX', record);

  session = await createSetupSession(options);
  await answerReconfiguration(session, fixture, ['codex']);
  await session.preview();
  await session.answer({ confirm: true });
  await session.install();
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.ok(machine.paths.some((entry) => entry.name === 'evidence' && entry.path === path.join(fixture.root, 'evidence')));
  assert.equal(machine.managedFiles[path.join(fixture.homeDir, '.agents', 'skills', 'executor', 'SKILL.md')], undefined);
});

test('Join preserves an existing 3.0 M1ND',async context=>{
 const fixture=await makeFixture(context);await makeInstalledMind(fixture,'3.0.0');const session=await createSetupSession({kitPath:KIT_PATH,...fixture,hostname:'SECOND',env:{PATH:''},language:'en',resume:false});const step=await session.answer({});assert.equal(step.values.attach,true);assert.equal(step.join.title,'Join this M1ND');assert.equal(step.legacy,undefined);assert.equal(step.action,'Join');await session.answer({mindPath:fixture.mindPath,attach:true});assert.deepEqual((await session.preview()).files.map(file=>file.path),[path.join(fixture.mindPath,'user','machines','SECOND.md')]);await session.answer({confirm:true});assert.equal((await session.install()).mode,'join');assert.equal(await readFile(path.join(fixture.mindPath,'rules.md'),'utf8'),'Older rules kept.\n');
});

test('Change to an existing M1ND presents Join before installation',async context=>{
 const fixture=await makeFixture(context);const installed=path.join(fixture.homeDir,'HIVEM1ND');await makeInstalledMind({...fixture,mindPath:installed},'3.0.0');const unused=path.join(fixture.root,'unused');const session=await createSetupSession({kitPath:KIT_PATH,...fixture,mindPath:unused,hostname:'SECOND',env:{PATH:''},resume:false});await session.answer({});const step=await session.answer({mindPath:installed,changeFolder:true});assert.equal(step.id,'location');assert.equal(step.values.attach,true);await session.answer({mindPath:installed,attach:true});await session.answer({confirm:true});assert.equal((await session.install()).mindPath,installed);assert.equal(await pathExists(unused),false);
});

test('a migration failure leaves setup resumable until the remaining work succeeds', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({ kitPath: KIT_PATH, mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' }, language: 'en' });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  const progress = path.join(fixture.mindPath, '.migration', 'migration-3.0.0.json');
  await mkdir(path.dirname(progress), { recursive: true });
  await writeFile(progress, '{broken');
  await assert.rejects(session.install(), SyntaxError);
  assert.equal(await pathExists(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md')), false);
  assert.equal(session.checkpoint.phase, 'migrate');
  assert.equal(session.checkpoint.error.code, 'setup_failed');
  assert.equal((await session.getStep()).done, false);
  await rm(progress);
  const completed = await session.install();
  assert.equal(completed.completed, true);
  assert.match(await readFile(path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md'), 'utf8'), /^setup: done$/m);
});

test('a denied folder names the folder and the permission cause, and setup resumes after it is fixed', async (context) => {
  const fixture = await makeFixture(context);
  const session = await createSetupSession({ kitPath: KIT_PATH, mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' }, language: 'en' });
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  await session.answer({ confirm: true });
  const locked = path.join(fixture.mindPath, 'user');
  session.migrateDestination = async () => { throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${locked}'`), { code: 'EPERM', path: locked }); };
  await assert.rejects(session.install(), { code: 'EPERM' });
  assert.equal(session.checkpoint.error.code, 'permission_denied');
  assert.equal(session.checkpoint.error.message, `Setup could not complete the migrate phase: access to ${locked} was denied. Check the permissions of that folder.`);
  delete session.migrateDestination;
  assert.equal((await session.install()).completed, true);
});

test('service progress retains completed rows through failure, reopen and retry without logon registration',async context=>{
 const fixture=await makeFixture(context);let starts=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const options={kitPath:KIT_PATH,...fixture,cosmicPath:path.join(fixture.root,'Cosmic'),hostname:'TESTBOX',env:{},language:'en',serviceSetup:true,serviceDryRun:false,serviceProtect:false,serviceRunner:async()=>assert.fail('No logon registration'),serviceQuery:async()=>assert.fail('No logon query'),serviceStart:async()=>{if(++starts===1){await gate;throw Object.assign(new Error('port 43210 occupied; private output omitted'),{code:'EADDRINUSE'});}return {viewerUrl:'http://127.0.0.1:9/gui/viewer'};}};
 const session=await createSetupSession(options);await session.answer({});await session.answer({mindPath:fixture.mindPath});await session.answer({confirm:true});const installation=session.install();while(starts===0)await new Promise(resolve=>setTimeout(resolve,10));const busy=await session.getStep();assert.equal(busy.busy,true);assert.deepEqual(busy.progress.map(row=>row.state),['done','done','busy','todo']);release();assert.equal((await installation).completed,false);const failed=await session.getStep();assert.equal(failed.id,'service');assert.equal(failed.action,'Retry');assert.equal(failed.back,false);assert.deepEqual(failed.progress.map(row=>row.state),['done','done','fail','todo']);assert.equal(failed.failure.headline,'The service did not start: port 43210 is used by another program.');assert.doesNotMatch(JSON.stringify(failed.failure),/private output|Nothing outside/);
 const resumed=await createSetupSession({...options,resume:true});assert.deepEqual((await resumed.getStep()).progress.map(row=>row.state),['done','done','fail','todo']);assert.equal((await resumed.install()).completed,true);const ready=await resumed.getStep();assert.equal(ready.id,'ready');assert.equal(ready.summary.find(row=>row.id==='service').running,true);assert.equal(starts,2);
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
    kitPath: fixture.kitPath ?? KIT_PATH,
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

async function answerReconfiguration(session,fixture,agents){
 await session.answer({});await session.answer({mindPath:fixture.mindPath});
 // Exercise reviewed machine configuration at the plan boundary, outside the setup UI.
 session.answers.agents=agents.map(id=>({id,selected:true,attach:'on-demand',detected:true}));await session.addProjectRoot(fixture.projectsRoot);session.answers.skipPreferences=true;session.answers.updateCheck='off';await session.persistDraft();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyReviewedClients(fixture, conflictChoices = {}) {
  return installAgentAssets({ ...fixture, kitPath: fixture.kitPath ?? KIT_PATH, hostname: 'TESTBOX', env: { PATH: '' }, conflictChoices });
}

async function checkpointFixture(context, version = '2.0.0') {
  const fixture = await makeFixture(context);
  fixture.sourcePath = fixture.mindPath;
  await makeInstalledMind(fixture, version);
  await mkdir(path.join(fixture.sourcePath, 'user', 'state'), { recursive: true });
  await writeFile(path.join(fixture.sourcePath, 'user', 'state', 'user.md'), 'unit: user\n\nPrivate person state.\n');
  await writeFile(path.join(fixture.sourcePath, 'user', 'private.json'), '{"unknown":{"keep":true}}\n');
  fixture.mindPath = path.join(fixture.root, 'destination');
  fixture.cosmicPath = path.join(fixture.root, 'local', 'Cosmic');
  fixture.kitPath = path.join(fixture.root, 'kit');
  await mkdir(path.join(fixture.kitPath, 'migrations'), { recursive: true });
  await writeFile(path.join(fixture.kitPath, 'package.json'), '{"name":"hivem1nd-fixture","version":"3.0.0","files":["rules.md","files.md","migrations/"]}\n');
  await writeFile(path.join(fixture.kitPath, 'rules.md'), 'Current rules.\n');
  await writeFile(path.join(fixture.kitPath, 'files.md'), 'Current formats.\n');
  for (const name of ['2.0.0-experimental.4', '3.0.0']) {
    await writeFile(path.join(fixture.kitPath, 'migrations', `${name}.mjs`),
      `export {version, idempotent, migrate} from ${JSON.stringify(pathToFileURL(path.join(KIT_PATH, 'migrations', `${name}.mjs`)).href)};\n`);
  }
  fixture.options = { kitPath: fixture.kitPath, mindPath: fixture.mindPath, legacySourcePath: fixture.sourcePath,
    cosmicPath: fixture.cosmicPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' }, language: 'en' };
  return fixture;
}

async function addLegacySession(fixture, machine = 'TESTBOX', overrides = {}) {
  const record = { kind: 'registration', registrationId: '11111111-1111-4111-8111-111111111111',
    sessionId: '33333333-3333-4333-8333-333333333333', unit: 'executor', unitId: 'root:executor', client: 'host',
    machine, nativeSessionId: 'native-one', registeredAt: '2026-10-13T00:00:00.000Z', pid: 999999, ...overrides };
  const directory = path.join(fixture.sourcePath, 'user', 'relay', 'sessions');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${record.registrationId}.json`), JSON.stringify(record));
  return record;
}

function ownedLegacyControl(events = []) {
  let live = true;
  let saved = false;
  return {
    reopen() { live = true; },
    async confirm(binding) { events.push(live ? 'confirm-live' : 'confirm-closed'); assert.equal(binding.pid, undefined); return { binding, owned: true, live, saved }; },
    async save(binding) { events.push('saved'); saved = true; return { binding, saved }; },
    async close(binding) { events.push('closed'); assert.equal(saved, true); live = false; return { binding, closed: true }; },
  };
}

async function confirmedSetup(options,values={}){
 const session=await createSetupSession(options);await session.answer({});await session.answer({mindPath:session.answers.mindPath,...values});if((await session.getStep()).legacy?.confirmation)await session.answer({mindPath:session.answers.mindPath,closeLegacy:true,...values});await session.answer({confirm:true});return session;
}

async function trackSetupWrites(roots, operation, onWrite = () => {}) {
  const originals = new Map();
  const writes = [];
  const within = (root, value) => { const relative = path.relative(root, path.resolve(value));
    return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); };
  for (const name of ['writeFile', 'appendFile', 'open', 'mkdir', 'rename', 'unlink', 'rmdir', 'rm', 'copyFile', 'chmod']) {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = async (...args) => {
      const targets = name === 'rename' ? args.slice(0, 2) : name === 'copyFile' ? [args[1]]
        : name === 'open' && !/[wa]/.test(String(args[1])) ? [] : [args[0]];
      for (const target of targets) {
        assert.equal(typeof target, 'string');
        const existingAncestor = name === 'mkdir' && roots.some(root => within(path.resolve(target), root))
          && await lstat(path.resolve(target)).then(state => state.isDirectory(), () => false);
        assert.ok(roots.some(root => within(root, target)) || existingAncestor, `${name} leaves the allowed destination and local storage`);
        writes.push({ operation: name, path: path.resolve(target) });
        await onWrite(name, path.resolve(target));
      }
      return original(...args);
    };
  }
  syncBuiltinESMExports();
  try { await operation(writes); }
  finally { for (const [name, original] of originals) fs[name] = original; syncBuiltinESMExports(); }
  return writes;
}

test('joining preserves every existing record except the joining machine record', async context => {
  const fixture = await checkpointFixture(context, '3.0.0');
  const before = await legacyTreeInventory(fixture.sourcePath);
  const homeBefore = await legacyTreeInventory(fixture.homeDir);
  const options = { ...fixture.options, mindPath: fixture.sourcePath, legacySourcePath: null, hostname: 'JOINING' };
  const writes = await trackSetupWrites([fixture.cosmicPath, path.join(fixture.sourcePath, 'user', 'machines')], async () => {
    const session = await confirmedSetup(options);
    const preview = await session.preview();
    assert.deepEqual(preview.files.map(file => file.path), [path.join(fixture.sourcePath, 'user', 'machines', 'JOINING.md')]);
    const result = await session.install();
    assert.equal(result.completed, true);
    assert.equal(result.mode, 'join');
    assert.equal(result.clientChanges.requiresReview, true);
  });
  const after = (await legacyTreeInventory(fixture.sourcePath)).filter(entry => entry.path !== 'user/machines/JOINING.md');
  assert.deepEqual(after, before);
  assert.deepEqual(await legacyTreeInventory(fixture.homeDir), homeBefore);
  assert.ok(writes.some(item => item.path.endsWith('JOINING.md')));
  assert.ok(writes.filter(item => item.operation !== 'mkdir' && item.path.startsWith(fixture.sourcePath)).every(item =>
    item.path === path.join(fixture.sourcePath, 'user', 'machines') || item.path.includes('JOINING.md')));
});

test('legacy migration and same-machine Join preserve accepted Paths routes and complete project records', async t => {
  const fixture = await checkpointFixture(t);
  const paths = [{ name: 'Web', path: path.join(fixture.root, 'outside-home', 'Web') },
    { name: 'shop', path: path.join(fixture.root, 'outside-home', 'Web', 'shop') },
    { name: 'evidence', path: path.join(fixture.root, 'evidence') }];
  await writeMachineRecord(fixture.sourcePath, 'TESTBOX', { machine: 'TESTBOX', mind: fixture.sourcePath, setup: 'done', paths, agents: [], managedFiles: {} });
  const routes = '## Environments\n- Web: shop\n\n## Projects\n- shop (Web)\n\n## Minds\n';
  await writeFile(path.join(fixture.sourcePath, 'user', 'routes.md'), routes);
  const records = ['brief.md', 'product.md', 'state/executor.md', 'tasks/001.md', 'inbox/executor/001.md', 'log/entry.md', 'brainstorm/topic.md'];
  for (const name of records) {
    const file = path.join(fixture.sourcePath, 'user', 'projects', 'shop', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `Keep ${name}.\n`);
  }
  const source = await legacyTreeInventory(fixture.sourcePath);
  const migrated = await confirmedSetup(fixture.options);
  assert.equal((await migrated.install()).completed, true);
  assert.deepEqual((await readMachineRecord(fixture.mindPath, 'TESTBOX')).record.paths, paths);
  assert.equal(await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8'), routes);
  const joined = await confirmedSetup({ ...fixture.options, legacySourcePath: null, resume: false });
  assert.equal((await joined.install()).mode, 'join');
  assert.deepEqual((await readMachineRecord(fixture.mindPath, 'TESTBOX')).record.paths, paths);
  assert.equal(await readFile(path.join(fixture.mindPath, 'user', 'routes.md'), 'utf8'), routes);
  for (const name of records) assert.equal(await readFile(path.join(fixture.mindPath, 'user', 'projects', 'shop', name), 'utf8'), `Keep ${name}.\n`);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), source);
});

test('legacy shutdown finishes before a destination copy', async context => {
  const fixture = await checkpointFixture(context);
  await addLegacySession(fixture);
  const before = await legacyTreeInventory(fixture.sourcePath);
  const events = [];
  const control = ownedLegacyControl(events);
  await trackSetupWrites([fixture.cosmicPath, fixture.mindPath], async () => {
    const session = await confirmedSetup({ ...fixture.options, legacyControl: control }, { closeLegacy: true });
    assert.equal((await session.install()).completed, true);
  }, (operation, target) => {
    if (target === fixture.mindPath || target.startsWith(`${fixture.mindPath}${path.sep}`)) {
      assert.ok(events.includes('saved'));
      assert.ok(events.includes('closed'));
      assert.ok(events.includes('confirm-closed'));
    }
  });
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
  assert.deepEqual(await readdir(path.join(fixture.mindPath, 'user', 'relay', 'sessions')), []);
});

test('failed copy resumes only verified checkpoint entries', async context => {
  const fixture = await checkpointFixture(context);
  const before = await legacyTreeInventory(fixture.sourcePath);
  let copied = 0;
  let first;
  const session = await confirmedSetup({ ...fixture.options, copyCheckpoint: async entry => {
    first ??= entry.path;
    if (++copied === 2) throw new Error('injected copy interruption');
  } });
  await assert.rejects(session.install(), /injected copy interruption/);
  assert.equal(session.checkpoint.phase, 'copy');
  assert.deepEqual(session.checkpoint.completed, ['prepare', 'close-legacy']);
  const resumed = await createSetupSession(fixture.options);
  assert.equal((await resumed.getStep()).number, 3);
  await trackSetupWrites([fixture.mindPath, fixture.cosmicPath], async writes => {
    assert.equal((await resumed.install()).completed, true);
    assert.ok(!writes.some(item => item.operation === 'copyFile' && item.path === path.join(fixture.mindPath, first)));
  });
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
});

test('changed partial copy entries block resume without changing either tree', async context => {
  const fixture = await checkpointFixture(context);
  let copiedPath;
  const session = await confirmedSetup({ ...fixture.options, copyCheckpoint: async entry => { copiedPath = entry.path; throw new Error('copy stopped'); } });
  await assert.rejects(session.install(), /copy stopped/);
  await writeFile(path.join(fixture.mindPath, copiedPath), 'foreign edit\n');
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const destinationBefore = await legacyTreeInventory(fixture.mindPath);
  const resumed = await createSetupSession(fixture.options);
  await assert.rejects(resumed.install(), error => error.code === 'checkpoint_changed');
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
  assert.deepEqual(await legacyTreeInventory(fixture.mindPath), destinationBefore);
});

test('migration writes only destination paths', async context => {
  const fixture = await checkpointFixture(context, '2.0.0-experimental.3');
  await writeFile(path.join(fixture.sourcePath, 'user', 'state', 'manager.md'), 'unit: manager\n\nLegacy coordinator.\n');
  const before = await legacyTreeInventory(fixture.sourcePath);
  const homeBefore = await legacyTreeInventory(fixture.homeDir);
  const session = await confirmedSetup(fixture.options);
  const writes = await trackSetupWrites([fixture.mindPath, fixture.cosmicPath], async () => {
    const result = await session.install();
    assert.equal(result.completed, true);
    assert.deepEqual(session.checkpointProof.migrations, ['2.0.0-experimental.4', '3.0.0']);
  });
  assert.ok(writes.some(item => item.operation === 'unlink' && item.path === path.join(fixture.mindPath, 'user', 'state', 'user.md')));
  assert.equal(await pathExists(path.join(fixture.mindPath, 'user', 'state', 'master.md')), true);
  assert.equal(await pathExists(path.join(fixture.mindPath, 'user', 'state', 'overseer.md')), true);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
  assert.deepEqual(await legacyTreeInventory(fixture.homeDir), homeBefore);
});

test('reopening a failed service step preserves completed copy and migration', async context => {
  const fixture = await checkpointFixture(context);
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const commands = [];
  let starts = 0;
  const options = { ...fixture.options, serviceSetup: true, serviceDryRun: false, serviceProtect: false,
    serviceRunner: async argv => { commands.push(argv); },
    serviceQuery: async plan => {
      if (!commands.length) return { present: false };
      const ownership = JSON.parse(await readFile(path.join(session.localDirectory(), 'registration.json'), 'utf8'));
      return { present: true, digest: plan.digest, executable: plan.executable, arguments: plan.arguments, installationId: ownership.installationId };
    },
    serviceStart: async () => { if (++starts === 1) throw Object.assign(new Error('port 43210 occupied; private native output omitted'), { code: 'EADDRINUSE' });
      return { viewerUrl: 'http://127.0.0.1:9/gui/viewer#/fixture' }; } };
  const session = await confirmedSetup(options);
  const failed = await session.install();
  assert.equal(failed.completed, false);
  assert.equal(failed.checkpoint.phase, 'start');
  assert.deepEqual(failed.checkpoint.completed, ['prepare', 'close-legacy', 'copy', 'migrate', 'configure']);
  assert.equal(failed.checkpoint.error.code, 'port_in_use');
  assert.equal(failed.checkpoint.error.message, 'The service did not start: port 43210 is used by another program.');
  const local = JSON.parse(await readFile(path.join(session.localDirectory(), 'setup.json'), 'utf8'));
  assert.deepEqual(Object.keys(local).sort(), ['format', 'mode', 'sourcePath', 'destinationPath', 'phase', 'completed', 'error', 'updatedAt'].sort());
  assert.equal(JSON.stringify(local).includes('private native output'), false);
  const destinationBefore = await legacyTreeInventory(fixture.mindPath);
  const registered = commands.length;
  const resumed = await createSetupSession(options);
  assert.equal(resumed.result.service.error, local.error.message);
  const writes = await trackSetupWrites([fixture.mindPath, fixture.cosmicPath], async () => {
    assert.equal((await resumed.install()).completed, true);
  });
  assert.equal(commands.length, registered);
  assert.equal(starts, 2);
  assert.equal(writes.some(item => item.operation === 'copyFile' || item.operation === 'unlink' || item.operation === 'rename' && item.path.includes('user/state')), false);
  const excludeMachine = entries => entries.filter(entry => !entry.path.startsWith('user/machines/TESTBOX.'));
  assert.deepEqual(excludeMachine(await legacyTreeInventory(fixture.mindPath)), excludeMachine(destinationBefore));
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});

test('unsupported or unsaved legacy shutdown leaves both trees unchanged', async context => {
  for (const mode of ['unsupported', 'unsaved', 'mismatched']) {
    const fixture = await checkpointFixture(context);
    await addLegacySession(fixture);
    const before = await legacyTreeInventory(fixture.sourcePath);
    const control = mode === 'unsupported' ? null : ownedLegacyControl();
    if (mode === 'unsaved') control.save = async binding => ({ binding, saved: false });
    if (mode === 'mismatched') control.confirm = async binding => ({ binding: { ...binding, nativeSessionId: 'another' }, owned: true, live: true });
    const session = await confirmedSetup({ ...fixture.options, legacyControl: control }, { closeLegacy: true });
    await assert.rejects(session.install(), error => error.code === 'legacy_closure_required');
    assert.equal(await pathExists(fixture.mindPath), false);
    assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
  }
});

test('a closed legacy checkpoint is verified again before copy resume', async context => {
  const fixture = await checkpointFixture(context);
  await addLegacySession(fixture);
  const before = await legacyTreeInventory(fixture.sourcePath);
  const control = ownedLegacyControl();
  const session = await confirmedSetup({ ...fixture.options, legacyControl: control, copyCheckpoint: async () => { throw new Error('copy stopped'); } }, { closeLegacy: true });
  await assert.rejects(session.install(), /copy stopped/);
  control.reopen();
  await assert.rejects(createSetupSession({ ...fixture.options, legacyControl: control }), error => error.code === 'legacy_closure_required');
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
});

test('native history selects the newest binding and excludes acknowledged stopped sessions', async context => {
  const fixture = await checkpointFixture(context);
  const old = await addLegacySession(fixture);
  const newer = await addLegacySession(fixture, 'TESTBOX', { registrationId: '22222222-2222-4222-8222-222222222222',
    unit: 'overseer', unitId: 'root:overseer', registeredAt: '2026-10-13T01:00:00.000Z' });
  const sessions = await legacySessions(fixture.sourcePath);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].binding.registrationId, newer.registrationId);
  assert.equal(sessions[0].sessionId, newer.sessionId);
  const directory = path.join(fixture.sourcePath, 'user', 'relay', 'session-status', newer.sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${old.registrationId}.json`), JSON.stringify({ format: 'hivem1nd-session-status-v1', sessionId: newer.sessionId,
    state: 'stopped', machine: 'TESTBOX', at: '2026-10-13T02:00:00.000Z', reason: 'native-acknowledged' }));
  assert.deepEqual(await legacySessions(fixture.sourcePath), []);
});

test('local setup storage cannot be placed inside either M1ND or a synced root', async context => {
  const fixture = await checkpointFixture(context);
  const before = await legacyTreeInventory(fixture.sourcePath);
  await assert.rejects(createSetupSession({ ...fixture.options, cosmicPath: path.join(fixture.sourcePath, 'local') }), error => error.code === 'invalid_path');
  await assert.rejects(createSetupSession({ ...fixture.options, mindPath: fixture.sourcePath, legacySourcePath: null,
    cosmicPath: path.join(fixture.sourcePath, 'local') }), error => error.code === 'invalid_path');
  const session = await createSetupSession({ ...fixture.options, env: { PATH: '', OneDrive: fixture.cosmicPath } });
  await assert.rejects(session.answer({}), error => error.code === 'unsafe_staging');
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), before);
  assert.equal(await pathExists(fixture.mindPath), false);
});

test('an interrupted quarantine move resumes from its byte-verified move record', async context => {
  const fixture = await checkpointFixture(context);
  await addLegacySession(fixture, 'OFFLINEBOX');
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const session = await confirmedSetup(fixture.options);
  const original = fs.rename;
  let interrupted = false;
  fs.rename = async (from, to) => {
    await original(from, to);
    if (!interrupted && to.includes(`${path.sep}legacy-relay${path.sep}`)) {
      interrupted = true;
      throw new Error('injected quarantine interruption');
    }
  };
  syncBuiltinESMExports();
  try { await assert.rejects(session.install(), /injected quarantine interruption/); }
  finally { fs.rename = original; syncBuiltinESMExports(); }
  assert.equal(session.checkpoint.phase, 'migrate');
  assert.ok(session.checkpointProof.pendingMove);
  const resumed = await createSetupSession(fixture.options);
  assert.equal((await resumed.install()).completed, true);
  assert.equal(resumed.checkpointProof.pendingMove, undefined);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});

test('an interrupted person migration reopens without copying again', async context => {
  const fixture = await checkpointFixture(context);
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const session = await confirmedSetup({ ...fixture.options, migrationFaultAfterMoves: 1 });
  await assert.rejects(session.install(), error => error.code === 'MIGRATION_INTERRUPTED');
  assert.equal(session.checkpoint.phase, 'migrate');
  const resumed = await createSetupSession(fixture.options);
  const writes = await trackSetupWrites([fixture.mindPath, fixture.cosmicPath], async () => {
    assert.equal((await resumed.install()).completed, true);
  });
  assert.equal(writes.some(item => item.operation === 'copyFile'), false);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});

test('person migration recovers an unlink that completed before its checkpoint', async context => {
  const fixture = await checkpointFixture(context);
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const session = await confirmedSetup(fixture.options);
  const original = fs.unlink;
  let interrupted = false;
  fs.unlink = async target => {
    await original(target);
    if (!interrupted && target === path.join(fixture.mindPath, 'user', 'state', 'user.md')) {
      interrupted = true;
      throw new Error('injected person unlink interruption');
    }
  };
  syncBuiltinESMExports();
  try { await assert.rejects(session.install(), /injected person unlink interruption/); }
  finally { fs.unlink = original; syncBuiltinESMExports(); }
  assert.ok(session.checkpointProof.pendingPersonMove);
  const resumed = await createSetupSession(fixture.options);
  assert.equal((await resumed.install()).completed, true);
  assert.equal(resumed.checkpointProof.pendingPersonMove, null);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});

test('preceding migration resumes only its exact interrupted header and folder transforms', async context => {
  for (const mutation of ['rm', 'rename']) {
    const fixture = await checkpointFixture(context, '2.0.0-experimental.3');
    await writeFile(path.join(fixture.sourcePath, 'user', 'state', 'manager.md'), 'unit: manager\n\nPrevious coordinator state.\n');
    await mkdir(path.join(fixture.sourcePath, 'user', 'manager'), { recursive: true });
    await writeFile(path.join(fixture.sourcePath, 'user', 'manager', 'notes.md'), 'Private coordinator notes.\n');
    const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
    const session = await confirmedSetup(fixture.options);
    const original = fs[mutation];
    let interrupted = false;
    const wanted = mutation === 'rm' ? path.join(fixture.mindPath, 'user', 'state', 'manager.md')
      : path.join(fixture.mindPath, 'user', 'manager', 'notes.md');
    fs[mutation] = async (...args) => {
      await original(...args);
      if (!interrupted && args[0] === wanted) { interrupted = true; throw new Error('injected preceding migration interruption'); }
    };
    syncBuiltinESMExports();
    try { await assert.rejects(session.install(), /injected preceding migration interruption/); }
    finally { fs[mutation] = original; syncBuiltinESMExports(); }
    assert.equal(session.checkpointProof.activeMigration.version, '2.0.0-experimental.4');
    const resumed = await createSetupSession(fixture.options);
    const writes = await trackSetupWrites([fixture.mindPath, fixture.cosmicPath], async () => {
      assert.equal((await resumed.install()).completed, true);
    });
    assert.equal(writes.some(item => item.operation === 'copyFile'), false);
    assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
    assert.equal(await readFile(path.join(fixture.mindPath, 'user', 'overseer', 'notes.md'), 'utf8'), 'Private coordinator notes.\n');
  }
});

test('a preceding state collision resumes after its acknowledged retirement write', async context => {
  const fixture = await checkpointFixture(context, '2.0.0-experimental.3');
  await writeFile(path.join(fixture.sourcePath, 'user', 'state', 'manager.md'), 'unit: manager\n\nPrevious manager state.\n');
  await writeFile(path.join(fixture.sourcePath, 'user', 'state', 'overseer.md'), 'unit: overseer\ndate: 2026-10-13 00:00\n\nExisting overseer state.\n');
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const session = await confirmedSetup(fixture.options);
  const original = fs.rm;
  let interrupted = false;
  fs.rm = async (...args) => {
    await original(...args);
    if (!interrupted && args[0] === path.join(fixture.mindPath, 'user', 'state', 'overseer.md')) {
      interrupted = true;
      throw new Error('injected collision retirement interruption');
    }
  };
  syncBuiltinESMExports();
  try { await assert.rejects(session.install(), /injected collision retirement interruption/); }
  finally { fs.rm = original; syncBuiltinESMExports(); }
  const resumed = await createSetupSession(fixture.options);
  assert.equal((await resumed.install()).completed, true);
  assert.match(await readFile(path.join(fixture.mindPath, 'user', 'log', '20261013-0000-overseer-retired.md'), 'utf8'), /Existing overseer state/);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});

test('migration progress written before its protected proof is reconciled on reopen', async context => {
  const fixture = await checkpointFixture(context);
  await mkdir(path.join(fixture.sourcePath, 'user', 'inbox', 'user'), { recursive: true });
  await writeFile(path.join(fixture.sourcePath, 'user', 'inbox', 'user', 'message.md'), 'id: message-one\nto: user\nfrom: executor\n\nPrivate person message.\n');
  const sourceBefore = await legacyTreeInventory(fixture.sourcePath);
  const session = await confirmedSetup(fixture.options);
  const original = fs.rename;
  let writes = 0;
  fs.rename = async (from, to) => {
    await original(from, to);
    if (to === path.join(fixture.mindPath, '.migration', 'migration-3.0.0.json') && ++writes === 3) {
      throw new Error('injected shared progress interruption');
    }
  };
  syncBuiltinESMExports();
  try { await assert.rejects(session.install(), /injected shared progress interruption/); }
  finally { fs.rename = original; syncBuiltinESMExports(); }
  assert.ok(session.checkpointProof.pendingProgress);
  const resumed = await createSetupSession(fixture.options);
  assert.equal((await resumed.install()).completed, true);
  assert.equal(resumed.checkpointProof.pendingProgress, undefined);
  assert.deepEqual(await legacyTreeInventory(fixture.sourcePath), sourceBefore);
});
