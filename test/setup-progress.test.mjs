import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createSetupSession } from '../engine/setup.mjs';
import { estimateStagedFiles, syncProgress } from '../engine/setup-progress.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { text } from '../engine/texts.mjs';

const KIT_PATH = path.resolve(import.meta.dirname, '..');

async function temporary(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-progress-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function stage(local, folder, count, from = 0) {
  const directory = path.join(local, 'staging', folder);
  await mkdir(directory, { recursive: true });
  for (let index = from; index < from + count; index += 1) await writeFile(path.join(directory, `change-${index}.json`), '{}\n');
}

test('the estimate counts the files the service looks at in the M1ND and skips what it skips', async context => {
  const mind = await temporary(context);
  for (const folder of ['user/state', 'user/relay/leases', 'user/relay/sessions', 'user/node_modules/x', 'user/.git']) await mkdir(path.join(mind, folder), { recursive: true });
  for (const file of ['user/a.md', 'user/state/b.md', 'user/relay/sessions/c.json', 'user/relay/leases/skipped.json', 'user/node_modules/x/skipped.js', 'user/.git/skipped', 'outside.md']) {
    await writeFile(path.join(mind, file), 'x');
  }
  assert.equal(await estimateStagedFiles(mind), 3);
  assert.equal(await estimateStagedFiles(path.join(mind, 'missing')), 0);
});

test('sync progress reads the staging folders: preparing, then staging out of the estimate, then publishing', async context => {
  const local = await temporary(context);
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: 100 }), { phase: 'preparing', done: 0, total: 100 });
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: null }), { phase: 'preparing', done: 0, total: null });
  await stage(local, 'changes', 40);
  await writeFile(path.join(local, 'staging', 'changes', 'change-9.json.123.tmp'), '{}');
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: 100 }), { phase: 'staging', done: 40, total: 100 });
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: null }), { phase: 'staging', done: 40, total: null });
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: 30 }), { phase: 'publishing', done: 0, total: 40 }, 'staged past the estimate means staging is over');
  await stage(local, 'acked', 10, 100);
  assert.deepEqual(await syncProgress({ localDirectory: local, estimate: 100 }), { phase: 'publishing', done: 10, total: 50 });
});

test('the starting row reports files done out of the total in the session language while the service starts', async context => {
  const root = await temporary(context);
  const kitPath = path.join(root, 'kit');
  await mkdir(path.join(kitPath, 'migrations'), { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), '{"name":"hivem1nd-fixture","version":"3.0.0","files":["rules.md","migrations/"]}\n');
  await writeFile(path.join(kitPath, 'rules.md'), 'Current rules.\n');
  for (const name of ['2.0.0-experimental.4', '3.0.0']) {
    await writeFile(path.join(kitPath, 'migrations', `${name}.mjs`),
      `export {version, idempotent, migrate} from ${JSON.stringify(pathToFileURL(path.join(KIT_PATH, 'migrations', `${name}.mjs`)).href)};\n`);
  }
  const mindPath = path.join(root, 'mind');
  const homeDir = path.join(root, 'home');
  await mkdir(homeDir, { recursive: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started = false;
  const session = await createSetupSession({ kitPath, mindPath, homeDir, cosmicPath: path.join(root, 'Cosmic'), hostname: 'TESTBOX', env: {}, language: 'en',
    resume: false, aclRunner: stubAclRunner(), serviceSetup: true, serviceDryRun: false, serviceProtect: false,
    serviceRunner: async () => assert.fail('No logon registration'), serviceQuery: async () => assert.fail('No logon query'),
    serviceStart: async () => { started = true; await gate; return { viewerUrl: 'http://127.0.0.1:9/gui/viewer' }; } });
  await session.answer({});
  await session.answer({ mindPath });
  await session.answer({ confirm: true });
  const installation = session.install();
  while (!started) await new Promise(resolve => setTimeout(resolve, 10));
  await mkdir(path.join(mindPath, 'user', 'extra'), { recursive: true });
  const start = async () => (await session.getStep()).progress.find(row => row.id === 'start');
  assert.equal((await start()).state, 'busy');
  assert.equal((await start()).sync.phase, 'preparing');
  assert.equal((await start()).sync.detail, text('en', 'syncPreparing'));
  const local = session.localDirectory();
  await stage(local, 'changes', 3);
  await new Promise(resolve => setTimeout(resolve, 20));
  const staging = (await start()).sync;
  assert.equal(staging.phase, 'staging');
  assert.equal(staging.done, 3);
  assert.ok(staging.total >= 3);
  assert.match(staging.detail, /^Preparing files for synchronization: 3 of about \d+\.$/);
  await stage(local, 'acked', 2, 10);
  const publishing = (await start()).sync;
  assert.equal(publishing.phase, 'publishing');
  assert.equal(publishing.detail, 'Publishing changes to the shared folder: 2 of 5.');
  await session.setLanguage('es');
  assert.equal((await start()).sync.detail, 'Publicando cambios en la carpeta compartida: 2 de 5.');
  release();
  assert.equal((await installation).completed, true);
  assert.equal((await session.getStep()).id, 'ready');
});
