import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrate } from '../migrations/3.0.0-onem1nd.mjs';
import { hashContent } from '../engine/records.mjs';
import { ownershipRecord, planRegistration } from '../engine/service/install.mjs';
import { mindKeyFor } from '../engine/service/paths.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';

const LEGACY = 'hivem1nd'; // Compatibility: representative 3.0.0 installation identity.

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onem1nd-migration-qa-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cosmicPath = path.join(root, 'Cosmic');
  const mindPath = path.join(cosmicPath, LEGACY);
  const homeDir = path.join(root, 'home');
  await mkdir(path.join(mindPath, 'user', 'machines'), { recursive: true });
  await mkdir(homeDir);
  await writeFile(path.join(mindPath, 'user', 'VERSION'), '3.0.0\n');
  const options = { cosmicPath, mindPath, homeDir, hostname: 'QA', platform: process.platform, nodePath: path.join(root, 'runtime', 'node.exe'),
    env: { LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming'), HOME: homeDir, USERPROFILE: homeDir }, shimDirectories: [], protectFile: async () => {}, aclRunner: stubAclRunner() };
  return { root, cosmicPath, mindPath, homeDir, options, destination: path.join(cosmicPath, 'onem1nd') };
}

test('rebrand preserves unknown machine headers and personal sections through a repeated upgrade', async t => {
  const fx = await fixture(t);
  const custom = 'private-note: Keep this exact header\n';
  const personal = '\n## Personal notes\n\nThis machine uses a separate account.\n';
  const machine = `machine: QA\nmind: ${fx.mindPath}\nlanguage: en\nupdate-check: off\nsetup: done\n${custom}\n## Agents\n- claude: auto\n\n## Paths\n- shop: ${path.join(fx.root, 'shop')}\n\n## Excluded\n${personal}`;
  await writeFile(path.join(fx.mindPath, 'user', 'machines', 'QA.md'), machine);
  await migrate(fx.options);
  await migrate({ ...fx.options, mindPath: fx.destination });
  const result = await readFile(path.join(fx.destination, 'user', 'machines', 'QA.md'), 'utf8');
  assert.ok(result.includes(custom), 'the private machine header is preserved');
  assert.ok(result.includes(personal), 'the personal machine section is preserved');
  assert.equal(result.match(/^machine:/gm).length, 1);
  assert.ok(result.includes(`mind: ${fx.destination}`));
});

test('a handwritten MCP entry identical to an installed entry retains its name and bytes', async t => {
  const fx = await fixture(t);
  const oldServer = `${LEGACY}-relay`;
  const owned = { command: 'node', args: [path.join(fx.mindPath, 'cli', 'index.mjs'), 'relay', 'mcp', '--mind-path', fx.mindPath, '--client', 'claude'] };
  const generated = { mcpServers: { [oldServer]: owned } };
  const config = path.join(fx.homeDir, '.claude.json');
  await writeFile(config, JSON.stringify({ mcpServers: { [oldServer]: owned, handwritten: structuredClone(owned) } }, null, 2));
  await writeFile(`${config}.relay-owned.json`, JSON.stringify({ client: 'claude', mindPath: fx.mindPath, entries: [{ kind: 'mcp', before: Buffer.from('{}').toString('base64'), after: Buffer.from(JSON.stringify(generated)).toString('base64') }] }));
  await migrate(fx.options);
  await migrate({ ...fx.options, mindPath: fx.destination });
  const result = JSON.parse(await readFile(config, 'utf8'));
  assert.deepEqual(result.mcpServers.handwritten, owned, 'the receipt does not own a handwritten sibling with equal content');
  assert.equal(result.mcpServers[oldServer], undefined);
  assert.ok(result.mcpServers['onem1nd-relay']);
  assert.equal(Object.keys(result.mcpServers).length, 2);
});

test('rebrand changes Settings ownership markers while preserving personal preference text', async t => {
  const fx = await fixture(t);
  const personal = `Keep ${LEGACY.toUpperCase()} notes unchanged.`;
  const preferences = { addressStyle: 'formal', keepExistingPreferencesFirst: true, updateChecks: 'off', additionalInstructions: personal };
  const marker = `${LEGACY.toUpperCase()} Settings preferences`;
  const original = `Personal opening remains.\n\n<!-- ${marker} -->\nAddress style: formal\nKeep existing preferences first: yes\nCheck for updates: off\n\n${personal}\n<!-- /${marker} -->\n`;
  await mkdir(path.join(fx.mindPath, 'user', 'gui'));
  await writeFile(path.join(fx.mindPath, 'user', 'gui', 'content.json'), JSON.stringify({ preferences }));
  await writeFile(path.join(fx.mindPath, 'user', 'preferences.md'), original);
  await migrate(fx.options);
  await migrate({ ...fx.options, mindPath: fx.destination });
  const result = await readFile(path.join(fx.destination, 'user', 'preferences.md'), 'utf8');
  assert.equal(result, original.replaceAll(marker, 'ONEM1ND Settings preferences'));
});

for (const [platform, interrupted, selectedDestination, embeddedKit] of [['darwin', false, false, false], ['linux', false, false, false], ['linux', true, false, false], ['linux', false, true, false], ['linux', false, false, true]]) {
  test(`rebrand replaces ${platform} login registration using loaded-file ownership semantics${interrupted ? ' after an interrupted unit removal' : ''}${selectedDestination ? ' when the new default is selected' : ''}${embeddedKit ? ' with its kit inside the relocated mind' : ''}`, async t => {
    const fx = await fixture(t);
    if (embeddedKit) {
      await mkdir(path.join(fx.mindPath, 'cli'));
      await writeFile(path.join(fx.mindPath, 'cli', 'index.mjs'), 'export {};\n');
    }
    const local = path.join(fx.cosmicPath, `${LEGACY}-service`, mindKeyFor(fx.mindPath, platform), 'QA');
    await mkdir(local, { recursive: true });
    const plan = planRegistration({ platform, home: fx.homeDir, configHome: path.join(fx.homeDir, '.config'), uid: 501,
      label: `com.${LEGACY}.service`, unitName: `${LEGACY}.service`, nodePath: fx.options.nodePath, cliPath: path.join(fx.root, 'kit', 'cli', 'index.mjs'),
      mindPath: fx.mindPath, workingDirectory: fx.root, localDirectory: local });
    await mkdir(path.dirname(plan.file), { recursive: true });
    await writeFile(plan.file, plan.body);
    const current = ownershipRecord(plan);
    await writeFile(path.join(local, 'registration.json'), JSON.stringify(current));
    await writeFile(path.join(local, 'config.json'), JSON.stringify({ format: `${LEGACY}-service-config-v1`, mindPath: fx.mindPath, machine: 'QA', origin: { kind: 'folder', path: path.join(fx.root, 'origin') }, stagingPath: path.join(local, 'staging'), startWithWindows: true }));
    const registered = new Map([[current.name, { file: plan.file, enabled: true }]]);
    const commands = [];
    const optionalRead = file => readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const queryRegistration = async candidate => {
      const registration = registered.get(candidate.name);
      if (!registration) return { present: false };
      const content = await optionalRead(registration.file);
      const digest = content ? hashContent(content) : null;
      return { present: true, digest, executable: content ? candidate.executable : null, arguments: content ? candidate.arguments : [],
        matchesPlan: digest === candidate.digest && registration.enabled, enabled: registration.enabled, installationId: candidate.installationId };
    };
    const run = async argv => {
      commands.push(argv);
      if (argv[0] === 'launchctl' && argv[1] === 'bootstrap') {
        const file = argv.at(-1), body = await readFile(file, 'utf8');
        const label = /<key>Label<\/key><string>([^<]+)<\/string>/.exec(body)?.[1];
        registered.set(label, { file, enabled: true });
      } else if (argv[0] === 'launchctl' && argv[1] === 'bootout') {
        for (const [name, record] of registered) if (record.file === argv.at(-1)) registered.delete(name);
      } else if (argv.includes('daemon-reload')) {
        for (const [name, record] of registered) if (!await optionalRead(record.file)) registered.delete(name);
      } else if (argv.includes('enable')) {
        const name = argv.at(-1);
        registered.set(name, { file: path.join(path.dirname(plan.file), name), enabled: true });
      } else if (argv.includes('disable')) {
        registered.get(argv.at(-1)).enabled = false;
      }
    };
    let stopRemoval = interrupted;
    const options = { ...fx.options, ...(embeddedKit ? { kitPath: fx.mindPath } : {}), mindPath: selectedDestination ? fx.destination : fx.mindPath, platform, uid: 501, stopService: async () => ({ stopped: false, absent: true }), queryRegistration, run,
      afterWrite: async file => {
        if (stopRemoval && file === plan.file && !await optionalRead(file)) {
          stopRemoval = false;
          throw new Error('interrupted after old unit removal');
        }
      } };
    if (interrupted) await assert.rejects(migrate(options), /interrupted after old unit removal/);
    await migrate(options);
    const firstCommands = commands.length;
    await migrate({ ...options, mindPath: fx.destination });
    const expected = platform === 'darwin' ? 'com.onem1nd.service' : 'onem1nd.service';
    assert.deepEqual([...registered.keys()], [expected]);
    assert.equal(commands.length, firstCommands, 'a repeated upgrade does not repeat registration operations');
    await assert.rejects(lstat(plan.file), { code: 'ENOENT' });
    if (embeddedKit) {
      const ownership = JSON.parse(await readFile(path.join(fx.cosmicPath, 'onem1nd-service', mindKeyFor(fx.destination, platform), 'QA', 'registration.json'), 'utf8'));
      assert.equal(ownership.arguments[1], path.join(fx.destination, 'cli', 'index.mjs'));
      assert.ok(ownership.body.includes(fx.destination.replaceAll('\\', '\\\\')));
    }
  });
}

test('rebrand resumes an interruption immediately after writing a new owned shortcut', async t => {
  const fx = await fixture(t);
  const desktop = path.join(fx.homeDir, 'Desktop');
  await mkdir(desktop);
  const shortcut = path.join(desktop, `${LEGACY.toUpperCase()}.lnk`);
  await writeFile(shortcut, 'legacy owned shortcut');
  const machineFile = path.join(fx.mindPath, 'user', 'machines', 'QA.md');
  await writeFile(machineFile, `machine: QA\nmind: ${fx.mindPath}\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`);
  await writeFile(machineFile.replace(/\.md$/, '.managed.json'), JSON.stringify({ [shortcut]: hashContent(Buffer.from('legacy owned shortcut')) }));
  let interrupted = true;
  const options = { ...fx.options, platform: 'win32', shortcutRun: async item => {
    await writeFile(item.file, 'new owned shortcut');
    if (interrupted) { interrupted = false; throw new Error('interrupted after shortcut creation'); }
  } };
  await assert.rejects(migrate(options), /interrupted after shortcut creation/);
  await migrate(options);
  await migrate({ ...options, mindPath: fx.destination });
  const destination = path.join(desktop, 'ONEM1ND.lnk');
  assert.equal(await readFile(destination, 'utf8'), 'new owned shortcut');
  await assert.rejects(lstat(shortcut), { code: 'ENOENT' });
  const managed = JSON.parse(await readFile(path.join(fx.destination, 'user', 'machines', 'QA.managed.json'), 'utf8'));
  assert.equal(managed[destination], hashContent(Buffer.from('new owned shortcut')));
  assert.equal(managed[shortcut], undefined);
});

for (const interruption of [null, 'created', 'removed']) {
  test(`3.0.0 moves its loose Start menu shortcut into Cosmic exactly once${interruption ? ` after interruption when ${interruption}` : ''}`, async t => {
    const fx = await fixture(t);
    const programs = path.join(fx.options.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const source = path.join(programs, `${LEGACY.toUpperCase()}.lnk`), destination = path.join(programs, 'Cosmic', 'ONEM1ND.lnk');
    await mkdir(programs, { recursive: true });
    await writeFile(source, 'legacy owned shortcut');
    const machineFile = path.join(fx.mindPath, 'user', 'machines', 'QA.md');
    await writeFile(machineFile, `machine: QA\nmind: ${fx.mindPath}\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`);
    await writeFile(machineFile.replace(/\.md$/, '.managed.json'), JSON.stringify({ [source]: hashContent(Buffer.from('legacy owned shortcut')) }));
    let interrupted = false;
    const runs = [];
    const nodePath = path.join(fx.root, 'runtime', 'node.exe');
    const options = { ...fx.options, platform: 'win32', nodePath, shortcutRun: async item => {
      runs.push(item);
      assert.equal(item.args[1], nodePath, 'the shortcut keeps the selected runtime');
      assert.equal(item.args[3], fx.destination, 'the shortcut starts the relocated mind');
      assert.equal(item.args[5], fx.cosmicPath, 'the shortcut keeps a custom Cosmic root');
      await writeFile(item.file, 'new owned shortcut');
      if (interruption === 'created' && !interrupted) { interrupted = true; throw new Error('shortcut interrupted'); }
    }, afterWrite: async file => {
      if (interruption === 'removed' && file === source && !interrupted) { interrupted = true; throw new Error('shortcut interrupted'); }
    } };
    if (interruption) {
      await assert.rejects(migrate(options), /shortcut interrupted/);
      if (interruption === 'created') assert.equal(await readFile(source, 'utf8'), 'legacy owned shortcut');
      else assert.equal(await readFile(destination, 'utf8'), 'new owned shortcut');
    }
    await migrate(options);
    const count = runs.length;
    await migrate({ ...options, mindPath: fx.destination });
    assert.equal(runs.length, count, 'a repeated upgrade regenerates no shortcut');
    assert.deepEqual(await readdir(programs), ['Cosmic']);
    assert.deepEqual(await readdir(path.dirname(destination)), ['ONEM1ND.lnk']);
    assert.equal(await readFile(destination, 'utf8'), 'new owned shortcut');
    await assert.rejects(lstat(source), { code: 'ENOENT' });
    const managed = JSON.parse(await readFile(path.join(fx.destination, 'user', 'machines', 'QA.managed.json'), 'utf8'));
    assert.equal(managed[destination], hashContent(Buffer.from('new owned shortcut')));
    assert.equal(managed[source], undefined);
  });
}

test('rebrand preserves a custom origin whose folder name begins with the old mind name', async t => {
  const fx = await fixture(t);
  const local = path.join(fx.cosmicPath, `${LEGACY}-service`, mindKeyFor(fx.mindPath, process.platform), 'QA');
  const origin = path.join(fx.cosmicPath, `${LEGACY}-archive`);
  await mkdir(local, { recursive: true });
  await mkdir(origin);
  await writeFile(path.join(origin, 'personal.txt'), 'original origin');
  await writeFile(path.join(local, 'config.json'), JSON.stringify({ format: `${LEGACY}-service-config-v1`, mindPath: fx.mindPath, machine: 'QA', origin: { kind: 'folder', path: origin }, stagingPath: path.join(local, 'staging') }));
  const options = { ...fx.options, stopService: async () => ({ absent: true }) };
  await migrate(options);
  await migrate({ ...options, mindPath: fx.destination });
  const config = JSON.parse(await readFile(path.join(fx.cosmicPath, 'onem1nd-service', mindKeyFor(fx.destination, process.platform), 'QA', 'config.json'), 'utf8'));
  assert.equal(config.origin.path, origin);
  assert.equal(await readFile(path.join(origin, 'personal.txt'), 'utf8'), 'original origin');
});

test('selecting a custom mind upgrades both saved local installations before global completion', async t => {
  const fx = await fixture(t);
  const custom = path.join(fx.root, 'shared', 'Custom mind');
  await mkdir(path.join(custom, 'user', 'machines'), { recursive: true });
  await writeFile(path.join(custom, 'user', 'VERSION'), '3.0.0\n');
  const minds = [fx.mindPath, custom];
  for (const [index, mindPath] of minds.entries()) {
    const key = mindKeyFor(mindPath, process.platform);
    const local = path.join(fx.cosmicPath, `${LEGACY}-service`, key, 'QA');
    const origin = path.join(fx.cosmicPath, `${LEGACY}-origin`, key);
    await mkdir(local, { recursive: true });
    await mkdir(origin, { recursive: true });
    await writeFile(path.join(origin, 'sync.bin'), Buffer.from([index, 0, 255]));
    await writeFile(path.join(mindPath, 'user', 'chat.json'), JSON.stringify({ id: `stable-chat-${index}`, text: `personal-${index}` }));
    await writeFile(path.join(mindPath, 'user', 'machines', 'QA.md'), `machine: QA\nmind: ${mindPath}\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`);
    await writeFile(path.join(local, 'config.json'), JSON.stringify({ format: `${LEGACY}-service-config-v1`, mindPath, machine: 'QA', origin: { kind: 'folder', path: origin }, stagingPath: path.join(local, 'staging') }));
  }
  const stopped = [];
  const options = { ...fx.options, mindPath: custom, stopService: async selected => {
    stopped.push(selected.mindPath);
    return selected.mindPath === custom ? { stopped: true } : { unrelated: true };
  } };
  await migrate(options);
  await migrate({ ...options, mindPath: fx.destination });
  await migrate(options);
  assert.deepEqual(stopped.sort(), [...minds].sort());
  const targets = [fx.destination, custom];
  for (const [index, mindPath] of targets.entries()) {
    const key = mindKeyFor(mindPath, process.platform);
    const config = JSON.parse(await readFile(path.join(fx.cosmicPath, 'onem1nd-service', key, 'QA', 'config.json'), 'utf8'));
    assert.equal(config.mindPath, mindPath);
    assert.equal(config.stagingPath, path.join(fx.cosmicPath, 'onem1nd-service', key, 'QA', 'staging'));
    assert.equal(config.origin.path, path.join(fx.cosmicPath, 'onem1nd-origin', key));
    assert.deepEqual(await readFile(path.join(config.origin.path, 'sync.bin')), Buffer.from([index, 0, 255]));
    assert.deepEqual(JSON.parse(await readFile(path.join(mindPath, 'user', 'chat.json'), 'utf8')), { id: `stable-chat-${index}`, text: `personal-${index}` });
  }
  await assert.rejects(lstat(fx.mindPath), { code: 'ENOENT' });
  assert.ok((await lstat(custom)).isDirectory());
});

test('rebrand resumes a crash after a verified copied file is linked but its temporary alias remains', async t => {
  const fx = await fixture(t);
  const source = path.join(fx.mindPath, 'user', 'machines', 'QA.md');
  const destination = path.join(fx.destination, 'user', 'machines', 'QA.md');
  const relative = 'user/machines/QA.md';
  let temporary;
  let journaledBeforePublication = false;
  await writeFile(source, `machine: QA\nmind: ${fx.mindPath}\nsetup: done\n\n## Agents\n\n## Paths\n\n## Excluded\n`);
  let interrupted = true;
  const options = { ...fx.options, protectFile: async file => {
    if (!path.basename(file).endsWith(`-${hashContent(relative)}.tmp`)) return;
    const checkpoint = JSON.parse(await readFile(path.join(fx.cosmicPath, '.onem1nd-upgrade.json'), 'utf8'));
    const move = checkpoint.moves.find(move => move.source === fx.mindPath);
    assert.equal(typeof move.copyId, 'string', 'the copy nonce is durable before publishing the destination');
    temporary = path.join(path.dirname(destination), `.onem1nd-copy-${move.copyId}-${hashContent(relative)}.tmp`);
    assert.equal(file, temporary);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    journaledBeforePublication = true;
  }, afterCopy: async file => {
    if (interrupted && file === destination) {
      interrupted = false;
      assert.equal(journaledBeforePublication, true);
      await link(destination, temporary);
      throw new Error('interrupted before copied temporary alias cleanup');
    }
  } };
  await assert.rejects(migrate(options), /interrupted before copied temporary alias cleanup/);
  await migrate(options);
  await migrate({ ...options, mindPath: fx.destination });
  assert.ok((await readFile(destination, 'utf8')).includes(`mind: ${fx.destination}`));
  await assert.rejects(lstat(temporary), { code: 'ENOENT' });
  await assert.rejects(lstat(fx.mindPath), { code: 'ENOENT' });
});

test('Windows selection and recorded paths migrate regardless of path casing', { skip: process.platform !== 'win32' && 'requires Windows case-insensitive paths' }, async t => {
  const fx = await fixture(t);
  const local = path.join(fx.cosmicPath, `${LEGACY}-service`, mindKeyFor(fx.mindPath, 'win32'), 'QA');
  await mkdir(local, { recursive: true });
  await writeFile(path.join(local, 'config.json'), JSON.stringify({ format: `${LEGACY}-service-config-v1`, mindPath: fx.mindPath.toUpperCase(), machine: 'QA', origin: { kind: 'folder', path: path.join(fx.root, 'origin') }, stagingPath: path.join(local, 'staging').toUpperCase() }));
  const options = { ...fx.options, platform: 'win32', mindPath: fx.mindPath.toUpperCase(), stopService: async () => ({ absent: true }) };
  await migrate(options);
  await migrate({ ...options, mindPath: fx.destination.toUpperCase() });
  const destination = path.join(fx.cosmicPath, 'onem1nd-service', mindKeyFor(fx.destination, 'win32'), 'QA');
  const config = JSON.parse(await readFile(path.join(destination, 'config.json'), 'utf8'));
  assert.equal(config.mindPath, fx.destination);
  assert.equal(config.stagingPath.toLowerCase(), path.join(destination, 'staging').toLowerCase());
  assert.equal(await readFile(path.join(fx.destination, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  await assert.rejects(lstat(fx.mindPath), { code: 'ENOENT' });
});

test('rebrand removes an owned npm command symlink and preserves its package target', async t => {
  const fx = await fixture(t);
  const bin = path.join(fx.root, 'bin');
  const target = path.join(fx.root, 'lib', 'node_modules', LEGACY, 'cli', 'index.mjs');
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(bin);
  await writeFile(target, 'export {};\n');
  const shim = path.join(bin, LEGACY);
  try { await symlink(target, shim, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('The host does not permit a file symlink.'); return; }
    throw error;
  }
  await migrate({ ...fx.options, shimDirectories: [bin] });
  await migrate({ ...fx.options, mindPath: fx.destination, shimDirectories: [bin] });
  await assert.rejects(lstat(shim), { code: 'ENOENT' });
  assert.equal(await readFile(target, 'utf8'), 'export {};\n');
});
