import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { discoverAgents, discoverContent, loadAdapters, resolveAdapterPaths } from '../engine/discovery.mjs';
import { autoRuleLine, planAgentAssets, renderSkill } from '../engine/install.mjs';

const KIT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('adapter descriptors resolve only inside the supplied temporary home', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-adapters-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const claudeConfig = path.join(root, 'claude-profile');
  await mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await mkdir(claudeConfig, { recursive: true });

  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  const found = await discoverAgents({
    homeDir,
    env: { PATH: '', CLAUDE_CONFIG_DIR: claudeConfig },
    adapters,
  });

  assert.deepEqual(found.map((agent) => agent.id), ['claude-code', 'codex']);
  const claude = adapters.find((adapter) => adapter.id === 'claude-code');
  const codex = adapters.find((adapter) => adapter.id === 'codex');
  assert.equal(resolveAdapterPaths(claude, { homeDir, env: { CLAUDE_CONFIG_DIR: claudeConfig } }).skillsRoot, path.join(claudeConfig, 'skills'));
  assert.equal(resolveAdapterPaths(codex, { homeDir, env: {} }).skillsRoot, path.join(homeDir, '.agents', 'skills'));
});

test('the Claude adapter adds a native read-only consultant restriction', async () => {
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  const claude = adapters.find((adapter) => adapter.id === 'claude-code');
  const source = await readFile(path.join(KIT_PATH, 'roles', 'consultant.md'), 'utf8');
  const rendered = renderSkill(source, 'consultant', claude, 'D:\\mind');

  assert.match(rendered, /^---\nname: consultant\n/);
  assert.match(rendered, /\ncontext: fork\nagent: Explore\nbackground: false\n---\n/);
  assert.match(rendered, /Mind: D:\\mind/);
});

test('discovery does not follow a fake binary outside the supplied PATH', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-path-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  await mkdir(homeDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  const binary = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
  await writeFile(path.join(binDir, binary), 'exit 0\n');

  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  const found = await discoverAgents({ homeDir, env: { PATH: binDir, PATHEXT: '.CMD' }, adapters });
  assert.deepEqual(found.map((agent) => agent.id), ['opencode']);
});

test('existing agent preferences can stay before or after the auto rule without content loss', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-preferences-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const mindPath = path.join(root, 'mind');
  const rulesPath = path.join(homeDir, '.codex', 'AGENTS.md');
  const existing = 'First preference.\r\nSecond preference without newline.';
  await mkdir(path.dirname(rulesPath), { recursive: true });
  await writeFile(rulesPath, existing);
  const adapters = await loadAdapters({ kitPath: KIT_PATH });
  const common = {
    kitPath: KIT_PATH,
    mindPath,
    homeDir,
    env: { PATH: '' },
    adapters,
    agents: [{ name: 'codex', mode: 'auto' }],
  };

  const existingFirst = await planAgentAssets({ ...common, keepExistingPreferences: true });
  const existingFirstContent = existingFirst.items.find((item) => item.path === rulesPath).content;
  assert.ok(existingFirstContent.startsWith(existing));
  assert.ok(existingFirstContent.endsWith(`${autoRuleLine(mindPath)}\n`));

  const mindFirst = await planAgentAssets({ ...common, keepExistingPreferences: false });
  const mindFirstContent = mindFirst.items.find((item) => item.path === rulesPath).content;
  assert.ok(mindFirstContent.startsWith(`${autoRuleLine(mindPath)}\n`));
  assert.ok(mindFirstContent.endsWith(existing));
});

test('content discovery ignores README placeholders and exposes future knowledge modules', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-content-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'knowledge', 'security'), { recursive: true });
  await writeFile(path.join(root, 'features', 'README.md'), 'placeholder\n');
  await writeFile(path.join(root, 'knowledge', 'README.md'), 'placeholder\n');
  await writeFile(path.join(root, 'knowledge', 'security', 'guide.md'), 'module\n');

  assert.deepEqual(await discoverContent(root), [
    { id: 'knowledge:security', name: 'security', type: 'knowledge' },
  ]);
});
