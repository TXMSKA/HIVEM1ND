import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAdapters } from '../engine/discovery.mjs';
import { parseMachineRecord } from '../engine/records.mjs';
import { createSetupSession, SetupValidationError } from '../engine/setup.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the agents step exposes a single scan action until it has run', async (context) => {
  const fixture = await makeFixture(context);
  const session = await toAgentsStep(fixture);
  const step = await session.getStep();
  assert.equal(step.number, 3);
  assert.equal(step.scanned, false);
  assert.deepEqual(step.fields.map((entry) => entry.id), ['scan']);

  const scanned = await session.answer({ scan: true });
  assert.equal(scanned.number, 3);
  assert.equal(scanned.scanned, true);
  assert.ok(!scanned.fields.some((entry) => entry.id === 'scan'));
});

test('scanning detects known agents and selection narrows what gets installed', async (context) => {
  const fixture = await makeFixture(context, ['codex', 'cursor']);
  const session = await toAgentsStep(fixture);
  const scanned = await session.answer({ scan: true });
  assert.deepEqual(scanned.agents.map((agent) => agent.id).sort(), ['codex', 'cursor']);
  assert.ok(scanned.agents.every((agent) => agent.detected === true && agent.selected === true && agent.attach === 'auto'));

  await session.answer({ agents: ['codex'], attachModes: { codex: 'on-demand' } });
  await finishSetup(session, fixture);
  await session.install();

  const machine = parseMachineRecord(await readFile(machineRecordPath(fixture), 'utf8'));
  assert.deepEqual(machine.agents, [{ name: 'codex', mode: 'on-demand' }]);
});

test('a supported adapter that scanning did not detect can be added manually', async (context) => {
  const fixture = await makeFixture(context, ['codex']);
  const session = await toAgentsStep(fixture);
  const scanned = await session.answer({ scan: true });
  assert.deepEqual(scanned.addableAgents.map((agent) => agent.value).sort(), ['claude-code', 'cursor', 'opencode', 'vscode']);

  const withManual = await session.answer({ addAgent: 'cursor' });
  assert.equal(withManual.number, 3);
  const cursorAgent = withManual.agents.find((agent) => agent.id === 'cursor');
  assert.ok(cursorAgent);
  assert.equal(cursorAgent.detected, false);
  assert.equal(cursorAgent.selected, true);
  assert.equal(cursorAgent.attach, 'auto');
  assert.ok(!withManual.addableAgents.some((agent) => agent.value === 'cursor'));

  await assert.rejects(() => session.answer({ addAgent: 'not-a-real-adapter' }), SetupValidationError);

  const stillOne = await session.answer({ addAgent: 'cursor' });
  assert.equal(stillOne.agents.filter((agent) => agent.id === 'cursor').length, 1);
});

test('auto attach writes the rule line for every adapter that has one; on demand never does', async (context) => {
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  for (const adapter of adapters) {
    for (const mode of ['auto', 'on-demand']) {
      const fixture = await makeFixture(context, [adapter.id]);
      const session = await toAgentsStep(fixture);
      await session.answer({ scan: true });
      await session.answer({ agents: [adapter.id], attachModes: { [adapter.id]: mode } });
      const preview = await finishSetup(session, fixture);
      assert.equal(preview.conflicts.length, 0, `${adapter.id} ${mode}`);
      await session.install();

      const skillPath = path.join(fixture.homeDir, ...skillsHomePath(adapter), 'executor', 'SKILL.md');
      await access(skillPath);

      if (!adapter.rules) continue;
      const rulesPath = path.join(fixture.homeDir, ...adapter.rules.homePath.split('/'));
      if (mode === 'auto') {
        const rules = await readFile(rulesPath, 'utf8');
        assert.match(rules, /HIVEM1ND: the mind is at/, `${adapter.id} auto`);
      } else {
        await assert.rejects(() => readFile(rulesPath, 'utf8'), { code: 'ENOENT' }, `${adapter.id} on-demand`);
      }
    }
  }
});

test('the on-demand notice is recorded once and survives resume', async (context) => {
  const fixture = await makeFixture(context, ['codex']);
  let session = await toAgentsStep(fixture);
  const scanned = await session.answer({ scan: true });
  assert.equal(scanned.onDemandNoticeShown, false);

  await session.answer({ agents: ['codex'], attachModes: { codex: 'auto' } });
  await session.back();
  const backAfterAuto = await session.getStep();
  assert.equal(backAfterAuto.number, 3);
  assert.equal(backAfterAuto.onDemandNoticeShown, false);

  await session.answer({ agents: ['codex'], attachModes: { codex: 'on-demand' } });

  session = await createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    env: { PATH: '' },
    resume: true,
  });
  const step = await session.getStep();
  assert.equal(step.number, 4);

  await session.back();
  const backToAgents = await session.getStep();
  assert.equal(backToAgents.number, 3);
  assert.equal(backToAgents.onDemandNoticeShown, true);
});

test('accepting scan results as-is keeps every detected agent selected with its default attach mode', async (context) => {
  const fixture = await makeFixture(context, ['codex', 'cursor']);
  const session = await toAgentsStep(fixture);
  await session.answer({ scan: true });
  const step = await session.answer({});
  assert.equal(step.number, 4);

  await finishSetup(session, fixture);
  await session.install();
  const machine = parseMachineRecord(await readFile(machineRecordPath(fixture), 'utf8'));
  assert.deepEqual(
    machine.agents.map((agent) => agent.name).sort(),
    ['codex', 'cursor'],
  );
  assert.ok(machine.agents.every((agent) => agent.mode === 'auto'));
});

async function makeFixture(context, detectedAdapterIds = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-setup-agents-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  const projectsRoot = path.join(root, 'projects');
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  for (const id of detectedAdapterIds) {
    const adapter = adapters.find((candidate) => candidate.id === id);
    const marker = adapter.detect.homePaths[0];
    await mkdir(path.join(homeDir, ...marker.split('/')), { recursive: true });
  }
  return { root, mindPath, homeDir, projectsRoot };
}

async function toAgentsStep(fixture) {
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
  return session;
}

async function finishSetup(session, fixture) {
  const includeStep = await session.getStep();
  await session.answer({ included: includeStep.values.included });
  await session.answer({ addRoot: fixture.projectsRoot });
  await session.answer({ projectsConfirmed: true });
  await session.answer({ skipPreferences: true, autoUpdates: false });
  const preview = await session.preview();
  await session.answer({ confirm: true });
  return preview;
}

function machineRecordPath(fixture) {
  return path.join(fixture.mindPath, 'user', 'machines', 'TESTBOX.md');
}

function skillsHomePath(adapter) {
  return adapter.skills.homePath.split('/');
}
