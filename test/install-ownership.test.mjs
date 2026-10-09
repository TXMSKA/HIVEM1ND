import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installAgentAssets, planKitCopy } from '../engine/install.mjs';
import { evolve } from '../engine/lifecycle.mjs';
import { hashContent, machineManagedPath, machineRecordPath, readMachineRecord } from '../engine/records.mjs';
import { createSetupSession } from '../engine/setup.mjs';

const OLD_LICENSE = 'Permission is granted.\n\nThe software is provided as is.\n';
const NEW_LICENSE = 'Permission is granted.\n\nThe software is provided as is, without warranty.\n';
const ENDINGS = { lf: '\n', crlf: '\r\n' };
const RECORDED_REASON = 'The HIVEM1ND-managed file was modified after installation.';
const UNOWNED_REASON = 'An unowned file already exists at this path.';

function text(content, ending) {
  return Buffer.from(content.replaceAll('\n', ENDINGS[ending]));
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-ownership-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const fixture = {
    root,
    kitPath: path.join(root, 'kit'),
    mindPath: path.join(root, 'mind'),
    homeDir: path.join(root, 'home'),
    hostname: 'TEST',
  };
  fixture.env = { ...process.env, CODEX_HOME: path.join(fixture.homeDir, '.codex') };
  await mkdir(path.join(fixture.mindPath, 'user'), { recursive: true });
  await mkdir(fixture.homeDir, { recursive: true });
  await writeFile(path.join(fixture.mindPath, 'user', 'VERSION'), '0.1.0\n');
  await writeMachine(fixture, 'TEST');
  return fixture;
}

async function writeMachine(fixture, hostname, managed = {}) {
  const { mindPath } = fixture;
  await mkdir(path.dirname(machineRecordPath(mindPath, hostname)), { recursive: true });
  await writeFile(
    machineRecordPath(mindPath, hostname),
    `machine: ${hostname}\nmind: ${mindPath}\nlanguage: en\nupdate-check: off\nlast-check: \nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`,
  );
  if (Object.keys(managed).length > 0) await writeFile(machineManagedPath(mindPath, hostname), JSON.stringify(managed));
  else await rm(machineManagedPath(mindPath, hostname), { force: true });
}

async function writeKit(fixture, files) {
  await rm(fixture.kitPath, { recursive: true, force: true });
  const roots = [...new Set(Object.keys(files).map((relative) => relative.split('/')[0]))];
  await mkdir(fixture.kitPath, { recursive: true });
  await writeFile(
    path.join(fixture.kitPath, 'package.json'),
    `${JSON.stringify({ name: 'hivem1nd-test', version: '1.0.0', files: roots })}\n`,
  );
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(fixture.kitPath, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function writeMind(fixture, relative, content) {
  const destination = path.join(fixture.mindPath, ...relative.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
  return destination;
}

function install(fixture, options = {}) {
  const { kitPath, mindPath, homeDir, hostname, env } = fixture;
  return installAgentAssets({ kitPath, mindPath, homeDir, hostname, env, ...options });
}

function run(fixture, options = {}) {
  const { kitPath, mindPath, homeDir, hostname, env } = fixture;
  return evolve({ kitPath, mindPath, homeDir, hostname, env, pull: false, ...options });
}

async function recordedHash(fixture, filePath) {
  return (await readMachineRecord(fixture.mindPath, fixture.hostname)).record.managedFiles[filePath];
}

test('the same text under the other line ending is unchanged, left as it is and recorded as it is on disk', async (t) => {
  for (const [desired, onDisk] of [['lf', 'crlf'], ['crlf', 'lf']]) {
    const fixture = await makeFixture(t);
    await writeKit(fixture, { LICENSE: text(OLD_LICENSE, desired) });
    const licensePath = await writeMind(fixture, 'LICENSE', text(OLD_LICENSE, onDisk));

    const first = await run(fixture);
    assert.equal(first.completed, true, `${desired} desired, ${onDisk} on disk`);
    assert.deepEqual(first.conflicts, []);
    assert.ok(!first.baseFiles.includes(licensePath));
    assert.deepEqual(first.warnings, []);
    assert.deepEqual(await readFile(licensePath), text(OLD_LICENSE, onDisk));
    assert.equal(await recordedHash(fixture, licensePath), hashContent(text(OLD_LICENSE, onDisk)));

    const second = await run(fixture);
    assert.equal(second.completed, true);
    assert.deepEqual(second.conflicts, []);
    assert.deepEqual(second.baseFiles, []);
    assert.equal(second.changed, false);
    assert.deepEqual(await readFile(licensePath), text(OLD_LICENSE, onDisk));
  }
});

test('a recorded file that holds the same text under the other line ending is updated, not reported as modified', async (t) => {
  for (const [recorded, onDisk] of [['lf', 'crlf'], ['crlf', 'lf']]) {
    const fixture = await makeFixture(t);
    await writeKit(fixture, { LICENSE: text(OLD_LICENSE, recorded) });
    const licensePath = path.join(fixture.mindPath, 'LICENSE');
    assert.deepEqual((await install(fixture)).conflicts, []);
    assert.equal(await recordedHash(fixture, licensePath), hashContent(text(OLD_LICENSE, recorded)));
    await writeMind(fixture, 'LICENSE', text(OLD_LICENSE, onDisk));
    await writeKit(fixture, { LICENSE: text(NEW_LICENSE, recorded) });

    const preview = await install(fixture, { previewOnly: true });
    assert.deepEqual(preview.conflicts, [], `${recorded} recorded, ${onDisk} on disk`);
    const result = await run(fixture);
    assert.equal(result.completed, true);
    assert.deepEqual(await readFile(licensePath), text(NEW_LICENSE, recorded));
    assert.equal(await recordedHash(fixture, licensePath), hashContent(text(NEW_LICENSE, recorded)));
    assert.deepEqual((await run(fixture)).baseFiles, []);
  }
});

test('a file written by another machine of the mind is updated without a conflict, in either line ending', async (t) => {
  for (const [peerForm, onDisk] of [['lf', 'lf'], ['lf', 'crlf'], ['crlf', 'lf'], ['crlf', 'crlf']]) {
    const fixture = await makeFixture(t);
    await writeKit(fixture, { 'rules.md': NEW_LICENSE, 'features/relay-client-setup.md': 'New setup text.\n' });
    const rulesPath = await writeMind(fixture, 'rules.md', text(OLD_LICENSE, onDisk));
    const featurePath = await writeMind(fixture, 'features/relay-client-setup.md', text('Old setup text.\n', onDisk));

    const unowned = await install(fixture, { previewOnly: true });
    assert.equal(unowned.conflicts.find((conflict) => conflict.path === rulesPath)?.reason, UNOWNED_REASON);

    await writeMachine(fixture, 'OTHER', {
      [rulesPath]: hashContent(text(OLD_LICENSE, peerForm)),
      [featurePath]: hashContent(text('Old setup text.\n', peerForm)),
    });
    const result = await run(fixture);
    const label = `${peerForm} recorded by the other machine, ${onDisk} on disk`;
    assert.equal(result.completed, true, label);
    assert.deepEqual(result.conflicts, [], label);
    assert.deepEqual(result.warnings, [], label);
    assert.equal(await readFile(rulesPath, 'utf8'), NEW_LICENSE);
    assert.equal(await readFile(featurePath, 'utf8'), 'New setup text.\n');
    assert.equal(await recordedHash(fixture, featurePath), hashContent('New setup text.\n'));
  }
});

test('a record of another machine that cannot be read, or holds odd entries, changes nothing', async (t) => {
  const fixture = await makeFixture(t);
  await writeKit(fixture, { 'rules.md': NEW_LICENSE });
  const rulesPath = await writeMind(fixture, 'rules.md', OLD_LICENSE);
  await writeMachine(fixture, 'BROKEN');
  await writeFile(machineManagedPath(fixture.mindPath, 'BROKEN'), '{ not json');
  await writeMachine(fixture, 'ODD', { [rulesPath]: 42, 'rules.md': hashContent(OLD_LICENSE) });

  const result = await install(fixture, { previewOnly: true });
  assert.deepEqual(result.conflicts.map((conflict) => [conflict.path, conflict.reason]), [[rulesPath, UNOWNED_REASON]]);
});

test('a retired file that another machine rewrote is removed instead of kept as modified', async (t) => {
  for (const [peerForm, onDisk] of [['lf', 'crlf'], ['crlf', 'lf']]) {
    const fixture = await makeFixture(t);
    await writeKit(fixture, { 'rules.md': OLD_LICENSE, 'features/old-tool.md': 'Old tool.\n' });
    const toolPath = path.join(fixture.mindPath, 'features', 'old-tool.md');
    assert.deepEqual((await install(fixture)).conflicts, []);
    await writeMind(fixture, 'features/old-tool.md', text('Newer tool text.\n', onDisk));
    await writeKit(fixture, { 'rules.md': OLD_LICENSE });

    const kept = await run(fixture);
    assert.deepEqual(kept.removed, []);
    assert.deepEqual(kept.kept, [{ path: toolPath, reason: RECORDED_REASON }]);
    assert.equal(await readFile(toolPath, 'utf8'), text('Newer tool text.\n', onDisk).toString());

    await writeMachine(fixture, 'OTHER', { [toolPath]: hashContent(text('Newer tool text.\n', peerForm)) });
    await writeMachine(fixture, 'TEST', { [toolPath]: hashContent('Old tool.\n') });
    const removed = await run(fixture);
    assert.deepEqual(removed.removed, [toolPath], `${peerForm} recorded by the other machine, ${onDisk} on disk`);
    assert.deepEqual(removed.kept, []);
    await assert.rejects(readFile(toolPath), { code: 'ENOENT' });
  }
});

test('a piece of the user in a kit folder that matches no record is still kept with a warning', async (t) => {
  const fixture = await makeFixture(t);
  await writeKit(fixture, { 'features/relay-client-setup.md': 'Kit setup text.\n' });
  const featurePath = await writeMind(fixture, 'features/relay-client-setup.md', 'My own setup notes.\n');
  await writeMachine(fixture, 'OTHER', {
    [featurePath]: hashContent('Some other text.\n'),
    [path.join(fixture.mindPath, 'rules.md')]: hashContent(OLD_LICENSE),
  });

  const result = await run(fixture);
  assert.equal(result.completed, true);
  assert.deepEqual(result.conflicts, []);
  assert.match(result.warnings.join('\n'), /relay-client-setup\.md: the kit now ships a file with the same name/);
  assert.equal(await readFile(featurePath, 'utf8'), 'My own setup notes.\n');
  assert.equal(await recordedHash(fixture, featurePath), undefined);
});

test('a managed file the user changed is still a conflict with keep and replace', async (t) => {
  const fixture = await makeFixture(t);
  await writeKit(fixture, { LICENSE: OLD_LICENSE });
  const licensePath = path.join(fixture.mindPath, 'LICENSE');
  assert.deepEqual((await install(fixture)).conflicts, []);
  await writeMind(fixture, 'LICENSE', 'My own license.\n');
  await writeMachine(fixture, 'OTHER', { [licensePath]: hashContent(NEW_LICENSE) });
  await writeKit(fixture, { LICENSE: NEW_LICENSE });

  const blocked = await run(fixture);
  assert.equal(blocked.completed, false);
  assert.deepEqual(blocked.conflicts, [{
    path: licensePath,
    reason: RECORDED_REASON,
    choices: ['keep', 'replace'],
    selection: null,
    link: false,
  }]);
  assert.equal(await readFile(licensePath, 'utf8'), 'My own license.\n');

  const kept = await run(fixture, { conflicts: { [licensePath]: 'keep' } });
  assert.equal(kept.completed, true);
  assert.equal(await readFile(licensePath, 'utf8'), 'My own license.\n');
  assert.equal(await recordedHash(fixture, licensePath), undefined);

  const replaced = await run(fixture, { conflicts: { [licensePath]: 'replace' } });
  assert.equal(replaced.completed, true);
  assert.equal(await readFile(licensePath, 'utf8'), NEW_LICENSE);
});

test('binary content is compared by its bytes even when it holds line ending bytes', async (t) => {
  const crlf = [Buffer.from([0x89, 0x00, 0x0d, 0x0a, 0x1a]), Buffer.from([0xff, 0xfe, 0x0d, 0x0a, 0x41])];
  const lf = [Buffer.from([0x89, 0x00, 0x0a, 0x1a]), Buffer.from([0xff, 0xfe, 0x0a, 0x41])];
  for (const [index, desired] of crlf.entries()) {
    const fixture = await makeFixture(t);
    await writeKit(fixture, { 'assets/blob.bin': desired });
    const blobPath = await writeMind(fixture, 'assets/blob.bin', lf[index]);

    const unowned = await install(fixture, { previewOnly: true });
    assert.equal(unowned.conflicts.find((conflict) => conflict.path === blobPath)?.reason, UNOWNED_REASON, `variant ${index}`);

    await writeMachine(fixture, 'TEST', { [blobPath]: hashContent(desired) });
    const modified = await install(fixture, { previewOnly: true });
    assert.equal(modified.conflicts.find((conflict) => conflict.path === blobPath)?.reason, RECORDED_REASON, `variant ${index}`);

    await writeMachine(fixture, 'TEST');
    await writeMachine(fixture, 'OTHER', { [blobPath]: hashContent(lf[index]) });
    await writeKit(fixture, { 'assets/blob.bin': lf[index] });
    await writeMind(fixture, 'assets/blob.bin', desired);
    const reverse = await install(fixture, { previewOnly: true });
    assert.equal(reverse.conflicts.find((conflict) => conflict.path === blobPath)?.reason, UNOWNED_REASON, `variant ${index}`);

    await writeMind(fixture, 'assets/blob.bin', lf[index]);
    const same = await install(fixture);
    assert.deepEqual(same.conflicts, []);
    assert.deepEqual(same.baseFiles.filter((filePath) => filePath === blobPath), []);
    assert.equal(await recordedHash(fixture, blobPath), hashContent(lf[index]));
  }
});

test('setup previews no conflict for a kit file another machine installed', async (t) => {
  const fixture = await makeFixture(t);
  await writeKit(fixture, { 'rules.md': NEW_LICENSE, 'files.md': 'Formats.\n' });
  const rulesPath = await writeMind(fixture, 'rules.md', text(OLD_LICENSE, 'crlf'));
  await writeMind(fixture, 'files.md', 'Formats.\n');
  const preview = async () => {
    // Previewing saves a draft over the machine record, which would make the next session an attach.
    await writeMachine(fixture, 'TEST');
    const session = await createSetupSession({
      kitPath: fixture.kitPath,
      mindPath: fixture.mindPath,
      homeDir: fixture.homeDir,
      hostname: fixture.hostname,
      language: 'en',
      env: { PATH: '' },
      resume: false,
    });
    return (await session.answer({ installMode: 'simple' })).preview;
  };

  assert.equal((await preview()).conflicts.find((conflict) => conflict.path === rulesPath)?.reason, UNOWNED_REASON);
  await writeMachine(fixture, 'OTHER', { [rulesPath]: hashContent(text(OLD_LICENSE, 'lf')) });
  const planned = await preview();
  assert.deepEqual(planned.conflicts, []);
  assert.equal(planned.files.find((file) => file.path === rulesPath)?.action, 'update');
});

test('the kit copy carries the runtime dependency closure into the mind and warns on a missing one', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-deps-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const kitPath = path.join(root, 'cache', 'node_modules', 'hivem1nd');
  const mindPath = path.join(root, 'mind');
  const write = async (relative, content) => {
    const destination = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  await write('cache/node_modules/hivem1nd/package.json', JSON.stringify({ name: 'hivem1nd', files: ['cli/'], dependencies: { alpha: '1.0.0', '@scope/beta': '1.0.0', missing: '1.0.0' } }));
  await write('cache/node_modules/hivem1nd/cli/index.mjs', 'export {};\n');
  await write('cache/node_modules/hivem1nd/node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', dependencies: { gamma: '1.0.0' } }));
  await write('cache/node_modules/hivem1nd/node_modules/alpha/dist/index.js', 'alpha\n');
  await write('cache/node_modules/hivem1nd/node_modules/alpha/node_modules/skip/package.json', '{}');
  await write('cache/node_modules/@scope/beta/package.json', JSON.stringify({ name: '@scope/beta' }));
  await write('cache/node_modules/gamma/package.json', JSON.stringify({ name: 'gamma' }));
  await mkdir(mindPath, { recursive: true });

  const plan = await planKitCopy({ kitPath, mindPath });
  const planned = plan.items.map((item) => path.relative(mindPath, item.path ?? item.destination).split(path.sep).join('/')).sort();
  assert.deepEqual(planned, [
    'cli/index.mjs',
    'node_modules/@scope/beta/package.json',
    'node_modules/alpha/dist/index.js',
    'node_modules/alpha/package.json',
    'node_modules/gamma/package.json',
    'package.json',
  ]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /missing/);
});
