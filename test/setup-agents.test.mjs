import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAdapters } from '../engine/discovery.mjs';
import { installAgentAssets } from '../engine/install.mjs';
import { readMachineRecord } from '../engine/records.mjs';
import { createSetupSession, SetupValidationError } from '../engine/setup.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Setup has four steps (docs/3.0/final.md, decision 3): agents are detected with defaults when the
// location is confirmed and are changed in Settings. These tests exercise the agent selection at the
// plan boundary of the setup session, outside the setup screens.

test('setup scans agents once, when the location is confirmed', async (context) => {
  const fixture = await makeFixture(context, ['codex']);
  const session = await newSession(fixture);
  const location = await session.answer({});
  assert.equal(location.id, 'location');
  assert.equal(session.answers.agentsScanned, false);
  assert.deepEqual(session.answers.agents, []);

  const service = await session.answer({ mindPath: fixture.mindPath });
  assert.equal(service.id, 'service');
  assert.equal(session.answers.agentsScanned, true);
  assert.deepEqual(session.answers.agents, [{ id: 'codex', selected: true, attach: 'auto', detected: true }]);
});

test('scanning detects known agents and selection narrows what gets installed', async (context) => {
  const fixture = await makeFixture(context, ['codex', 'cursor']);
  const session = await toServiceStep(fixture);
  assert.deepEqual(session.answers.agents.map((agent) => agent.id).sort(), ['codex', 'cursor']);
  assert.ok(session.answers.agents.every((agent) => agent.detected === true && agent.selected === true && agent.attach === 'auto'));

  session.answers.agents = session.answers.agents.map((agent) => (agent.id === 'codex' ? { ...agent, attach: 'on-demand' } : { ...agent, selected: false }));
  await session.persistDraft();
  await finishSetup(session);

  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.deepEqual(machine.agents, [{ name: 'codex', mode: 'on-demand' }]);
});

test('a supported adapter that scanning did not detect can be added manually', async (context) => {
  const fixture = await makeFixture(context, ['codex']);
  const session = await toServiceStep(fixture);
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  const addable = () => adapters.map((adapter) => adapter.id).filter((id) => !session.answers.agents.some((agent) => agent.id === id)).sort();
  assert.deepEqual(addable(), ['claude-code', 'cursor', 'opencode', 'vscode']);

  session.addManualAgent('cursor');
  assert.deepEqual(session.answers.agents.find((agent) => agent.id === 'cursor'), { id: 'cursor', selected: true, attach: 'auto', detected: false });
  assert.ok(!addable().includes('cursor'));

  assert.throws(() => session.addManualAgent('not-a-real-adapter'), SetupValidationError);

  session.addManualAgent('cursor');
  assert.equal(session.answers.agents.filter((agent) => agent.id === 'cursor').length, 1);

  await session.persistDraft();
  await finishSetup(session);
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
  assert.deepEqual(machine.agents, [{ name: 'codex', mode: 'auto' }, { name: 'cursor', mode: 'auto' }]);
});

// Setup writes no client configuration (docs/3.0/integration.md, T004); the reviewed client apply
// installs the skills and rule lines that the machine record selects.
test('auto attach writes the rule line for every adapter that has one; on demand never does', async (context) => {
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  for (const adapter of adapters) {
    for (const mode of ['auto', 'on-demand']) {
      const fixture = await makeFixture(context, [adapter.id]);
      const session = await toServiceStep(fixture);
      session.answers.agents = [{ id: adapter.id, selected: true, attach: mode, detected: true }];
      await session.persistDraft();
      const preview = await session.preview();
      assert.equal(preview.conflicts.length, 0, `${adapter.id} ${mode}`);
      await finishSetup(session);

      const skillPath = path.join(fixture.homeDir, ...skillsHomePath(adapter), 'executor', 'SKILL.md');
      await assert.rejects(() => access(skillPath), { code: 'ENOENT' }, `${adapter.id} ${mode} before review`);
      await installAgentAssets({ kitPath: KIT_PATH, mindPath: fixture.mindPath, homeDir: fixture.homeDir, hostname: 'TESTBOX', env: { PATH: '' } });
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

test('accepting scan results as-is keeps every detected agent selected with its default attach mode', async (context) => {
  const fixture = await makeFixture(context, ['codex', 'cursor']);
  const session = await toServiceStep(fixture);
  const step = await session.getStep();
  assert.equal(step.id, 'service');
  assert.equal(step.number, 3);

  await finishSetup(session);
  const machine = (await readMachineRecord(fixture.mindPath, 'TESTBOX')).record;
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
  await mkdir(homeDir, { recursive: true });
  await mkdir(path.join(mindPath, 'user'), { recursive: true });
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  for (const id of detectedAdapterIds) {
    const adapter = adapters.find((candidate) => candidate.id === id);
    const marker = adapter.detect.homePaths[0];
    await mkdir(path.join(homeDir, ...marker.split('/')), { recursive: true });
  }
  return { root, mindPath, homeDir };
}

function newSession(fixture) {
  return createSetupSession({
    kitPath: KIT_PATH,
    mindPath: fixture.mindPath,
    homeDir: fixture.homeDir,
    hostname: 'TESTBOX',
    language: 'en',
    env: { PATH: '' },
    resume: false,
  });
}

async function toServiceStep(fixture) {
  const session = await newSession(fixture);
  await session.answer({});
  await session.answer({ mindPath: fixture.mindPath });
  return session;
}

async function finishSetup(session) {
  await session.answer({ confirm: true });
  return session.install();
}

function skillsHomePath(adapter) {
  return adapter.skills.homePath.split('/');
}
