import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installAgentAssets } from '../engine/install.mjs';
import {
  machineManagedPath,
  machineRecordPath,
  parseMachineRecord,
  readMachineRecord,
  serializeMachineRecord,
  writeMachineRecord,
} from '../engine/records.mjs';

async function temporaryMind(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-records-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const mindPath = path.join(root, 'mind');
  await mkdir(path.join(mindPath, 'user', 'machines'), { recursive: true });
  return { root, mindPath };
}

function legacyRecord(managed) {
  return [
    'machine: BOX',
    'mind: C:\\mind',
    'language: en',
    'update-check: off',
    'last-check: ',
    'preferences-first: yes',
    'setup: done',
    '',
    '## Agents',
    '- codex: on-demand',
    '',
    '## Paths',
    '- app: C:\\repos\\app',
    '',
    '## Excluded',
    '',
    '## Managed Files',
    '```json',
    JSON.stringify(managed, null, 2),
    '```',
    '',
  ].join('\n');
}

const managed = { 'C:\\home\\.agents\\skills\\executor\\SKILL.md': 'a'.repeat(64) };

test('the machine file serializes without the managed files', () => {
  const text = serializeMachineRecord({ ...parseMachineRecord(legacyRecord(managed)), managedFiles: managed });
  assert.doesNotMatch(text, /Managed Files/);
  assert.match(text, /^## Excluded$/m);
});

test('a machine file with no managed map beside it still reads its Managed Files section', async (t) => {
  const { mindPath } = await temporaryMind(t);
  await writeFile(machineRecordPath(mindPath, 'BOX'), legacyRecord(managed));
  const { record } = await readMachineRecord(mindPath, 'BOX');
  assert.deepEqual(record.managedFiles, managed);
  assert.deepEqual(record.paths, [{ name: 'app', path: 'C:\\repos\\app' }]);
});

test('the managed map beside the machine file wins over the legacy section', async (t) => {
  const { mindPath } = await temporaryMind(t);
  await writeFile(machineRecordPath(mindPath, 'BOX'), legacyRecord(managed));
  const current = { 'C:\\home\\.agents\\skills\\qa\\SKILL.md': 'b'.repeat(64) };
  await writeFile(machineManagedPath(mindPath, 'BOX'), JSON.stringify(current));
  assert.deepEqual((await readMachineRecord(mindPath, 'BOX')).record.managedFiles, current);

  await writeFile(machineManagedPath(mindPath, 'BOX'), '{ not json');
  assert.deepEqual((await readMachineRecord(mindPath, 'BOX')).record.managedFiles, managed);
});

test('the next write moves the managed files out of the machine file', async (t) => {
  const { mindPath } = await temporaryMind(t);
  const filePath = machineRecordPath(mindPath, 'BOX');
  await writeFile(filePath, legacyRecord(managed));
  const { record } = await readMachineRecord(mindPath, 'BOX');
  record.lastCheck = '2030-01-01';
  await writeMachineRecord(mindPath, 'BOX', record);

  assert.doesNotMatch(await readFile(filePath, 'utf8'), /Managed Files/);
  assert.match(await readFile(filePath, 'utf8'), /^last-check: 2030-01-01$/m);
  assert.deepEqual(JSON.parse(await readFile(machineManagedPath(mindPath, 'BOX'), 'utf8')), managed);
  assert.deepEqual((await readMachineRecord(mindPath, 'BOX')).record.managedFiles, managed);

  record.managedFiles = { ...managed, 'C:\\home\\.agents\\skills\\qa\\SKILL.md': 'c'.repeat(64) };
  await writeMachineRecord(mindPath, 'BOX', record);
  assert.equal(Object.keys(JSON.parse(await readFile(machineManagedPath(mindPath, 'BOX'), 'utf8'))).length, 2);
});

test('a machine with no managed files gets no managed map', async (t) => {
  const { mindPath } = await temporaryMind(t);
  await writeMachineRecord(mindPath, 'BOX', { ...parseMachineRecord(legacyRecord({})), machine: 'BOX', managedFiles: {} });
  assert.deepEqual(await readdir(path.join(mindPath, 'user', 'machines')), ['BOX.md']);
});

test('an install moves a machine file written with the Managed Files section to the managed map', async (t) => {
  const { root, mindPath } = await temporaryMind(t);
  const kitPath = path.join(root, 'kit');
  const homeDir = path.join(root, 'home');
  const env = { ...process.env, CODEX_HOME: path.join(homeDir, '.codex') };
  await mkdir(path.join(kitPath, 'roles'), { recursive: true });
  await writeFile(path.join(kitPath, 'package.json'), `${JSON.stringify({ name: 'hivem1nd-test', version: '1.0.0' })}\n`);
  await writeFile(path.join(kitPath, 'roles', 'executor.md'), '---\nname: executor\ndescription: Executor\n---\n\n# /executor\n');
  const filePath = machineRecordPath(mindPath, 'BOX');
  await writeFile(filePath, `machine: BOX\nmind: ${mindPath}\nlanguage: en\nupdate-check: off\nlast-check: \nsetup: done\n\n## Agents\n- codex: on-demand\n\n## Paths\n\n## Excluded\n`);

  await installAgentAssets({ kitPath, mindPath, homeDir, hostname: 'BOX', env });
  const written = JSON.parse(await readFile(machineManagedPath(mindPath, 'BOX'), 'utf8'));
  assert.ok(Object.keys(written).some((filePath) => filePath.endsWith(path.join('executor', 'SKILL.md'))));

  // Put the same map back where an older install kept it.
  await rm(machineManagedPath(mindPath, 'BOX'));
  const text = await readFile(filePath, 'utf8');
  await writeFile(filePath, `${text.trimEnd()}\n\n## Managed Files\n\`\`\`json\n${JSON.stringify(written, null, 2)}\n\`\`\`\n`);
  assert.deepEqual((await readMachineRecord(mindPath, 'BOX')).record.managedFiles, written);

  await installAgentAssets({ kitPath, mindPath, homeDir, hostname: 'BOX', env });
  assert.doesNotMatch(await readFile(filePath, 'utf8'), /Managed Files/);
  assert.deepEqual(JSON.parse(await readFile(machineManagedPath(mindPath, 'BOX'), 'utf8')), written);
});
