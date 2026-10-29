import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { migrate } from '../migrations/3.0.0-onem1nd.mjs';
import { hashContent, writeMachineRecord } from '../engine/records.mjs';
import { bootstrapConfig, ownershipRecord, planRegistration } from '../engine/service/install.mjs';
import { mindKeyFor } from '../engine/service/paths.mjs';
import { createAclRunner, verifyBootstrapFiles, verifyLocalPermissions } from '../engine/service/security.mjs';
import { runConfiguredService } from '../engine/service/service.mjs';

const OLD = 'hivem1nd'; // Compatibility: 3.0.0 input only.
const interrupted = () => new Error('fixture interruption');
async function put(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); return file; }
async function checkpoint(f) { return JSON.parse(await readFile(f.checkpoint)); }

function strictAclRunner() {
  const protectedTargets = new Set(), calls = [];
  return {
    calls, protectedTargets,
    userSid() { return 'S-1-5-21-1-2-3-1001'; },
    protect(target) { calls.push({ op: 'protect', target }); protectedTargets.add(target); return { protected: true, sid: this.userSid() }; },
    check(target) {
      calls.push({ op: 'check', target });
      const limited = protectedTargets.has(target) || !lstatSync(target).isDirectory() && protectedTargets.has(path.dirname(target));
      if (!limited) throw Object.assign(new Error('The private folder still inherits permissions.'), { code: 'bootstrap_unavailable' });
      return { ok: true };
    },
  };
}

async function fixture(t, { service = false, registration = false, shortcut = false } = {}) {
  await mkdir('.work/test-migration-recovery', { recursive: true });
  const root = await mkdtemp(path.resolve('.work/test-migration-recovery/onem1nd-case-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cosmic = path.join(root, 'Cosmic'), source = path.join(cosmic, OLD), destination = path.join(cosmic, 'onem1nd');
  const aclRunner = strictAclRunner(), calls = [], registered = new Map();
  const options = { cosmicPath: cosmic, homeDir: path.join(root, 'home'), hostname: 'TEST', platform: process.platform,
    env: {}, kitPath: process.cwd(), nodePath: path.join(root, 'runtime', 'node.exe'), aclRunner,
    protectFile: async file => { aclRunner.protect(file); } };
  await put(path.join(source, 'user', 'VERSION'), '3.0.0\n');
  await put(path.join(source, 'data.bin'), Buffer.from([0, 255, 7, 0, 43]));
  const managedFiles = {};
  if (shortcut) {
    const file = await put(path.join(root, 'Desktop', `${OLD}.lnk`), 'legacy generated shortcut');
    managedFiles[file] = hashContent(await readFile(file));
    options.shortcutFolders = { desktop: path.dirname(file) };
    options.shortcutRun = async item => { await put(item.file, 'new generated shortcut'); };
  }
  await writeMachineRecord(source, 'TEST', { machine: 'TEST', mind: source, language: 'en', setup: 'done', agents: [], paths: [], excluded: [], managedFiles });
  if (service) {
    // Registration fixtures model Windows; no scheduler command reaches the operating system.
    options.platform = 'win32';
    const oldKey = mindKeyFor(source, options.platform), oldLocal = path.join(cosmic, `${OLD}-service`, oldKey, 'TEST');
    const oldOrigin = path.join(cosmic, `${OLD}-origin`, oldKey);
    await put(path.join(oldLocal, 'config.json'), JSON.stringify(bootstrapConfig({ mindPath: source, machine: 'TEST',
      stagingPath: path.join(oldLocal, 'staging'), origin: { kind: 'folder', path: oldOrigin },
      encryption: { algorithm: 'aes-256-gcm', keyId: 'fixture-key' }, startWithWindows: registration })));
    await put(path.join(oldLocal, 'staging', 'nested', 'pending.bin'), 'private staging bytes');
    await put(path.join(oldOrigin, 'packs', 'pending.bin'), 'private origin bytes');
    options.stopService = async () => ({ stopped: true });
    if (registration) {
      const current = planRegistration({ platform: 'win32', nodePath: options.nodePath, cliPath: path.join(options.kitPath, 'cli', 'index.mjs'),
        mindPath: source, workingDirectory: options.kitPath, localDirectory: oldLocal, sid: aclRunner.userSid() });
      current.name = current.name.replace(/^ONEM1ND-/, `${OLD.toUpperCase()}-`);
      current.installationId = 'fixture-installation';
      await put(path.join(oldLocal, 'registration.json'), JSON.stringify(ownershipRecord(current)));
      await put(path.join(oldLocal, 'service-task.xml'), Buffer.from(`\uFEFF${current.body}`, 'utf16le'));
      registered.set(current.name, current);
      options.queryRegistration = async plan => {
        const actual = registered.get(plan.name);
        return actual ? { present: true, matchesPlan: actual.digest === plan.digest, digest: actual.digest, executable: actual.executable, arguments: actual.arguments } : { present: false };
      };
      options.run = async argv => {
        calls.push(argv);
        if (argv.includes('/Create')) { const state = await checkpoint({ checkpoint: path.join(cosmic, '.onem1nd-upgrade.json') }); registered.set(state.registrations[0].plan.name, state.registrations[0].plan); }
        if (argv.includes('/Delete')) registered.delete(argv[argv.indexOf('/TN') + 1]);
      };
    }
  }
  if (shortcut) options.platform = 'win32';
  const shim = await put(path.join(root, 'bin', `${OLD}.cmd`), `@node "%dp0%\\node_modules\\${OLD}\\cli\\index.mjs" %*\n`);
  options.shimDirectories = [path.dirname(shim)];
  return { root, cosmic, source, destination, options, aclRunner, calls, registered, shim, checkpoint: path.join(cosmic, '.onem1nd-upgrade.json') };
}

async function assertComplete(f) {
  assert.equal((await checkpoint(f)).complete, true);
  assert.equal(await readFile(path.join(f.destination, 'data.bin'), 'hex'), '00ff07002b');
  await assert.rejects(lstat(f.source), { code: 'ENOENT' });
  const before = await readFile(f.checkpoint);
  assert.equal((await migrate(f.options)).migrated, false);
  assert.deepEqual(await readFile(f.checkpoint), before);
}

test('thousands of files have bounded checkpoint writes and bytes, and resume an unpublished partial copy', async t => {
  const f = await fixture(t), count = 2000;
  const data = path.join(f.source, 'bulk');
  await mkdir(data);
  for (let offset = 0; offset < count; offset += 50) await Promise.all(Array.from({ length: 50 }, (_, index) => {
    const number = offset + index;
    return put(path.join(data, `${String(number).padStart(5, '0')}.bin`), `file ${number}\n`);
  }));
  let saves = 0, writtenBytes = 0, copies = 0;
  const renameFile = async (from, to) => { saves += 1; writtenBytes += (await lstat(from)).size; await rename(from, to); };
  await assert.rejects(migrate({ ...f.options, renameFile, afterCopy: async () => { if (++copies === 735) throw interrupted(); } }), /fixture interruption/);
  assert.ok(saves < 10, `only ${saves} checkpoint saves before interruption`);
  assert.equal(await readFile(path.join(f.source, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  const state = await checkpoint(f), move = state.moves[0];
  const entry = move.inventory.find(item => item.path === 'bulk/01999.bin');
  const partial = path.join(f.destination, 'bulk', `.onem1nd-copy-${move.copyId}-${hashContent(entry.path)}.tmp`);
  await put(partial, 'partial bytes left by a process dying before publication');
  await migrate({ ...f.options, renameFile });
  await assert.rejects(lstat(partial), { code: 'ENOENT' });
  for (let number = 0; number < count; number += 1) assert.equal(await readFile(path.join(f.destination, 'bulk', `${String(number).padStart(5, '0')}.bin`), 'utf8'), `file ${number}\n`);
  const finalBytes = (await lstat(f.checkpoint)).size;
  assert.ok(saves <= 25, `${saves} saves must be independent of the number of copied files`);
  assert.ok(writtenBytes <= finalBytes * 25, `${writtenBytes} cumulative checkpoint bytes must stay proportional to the inventory`);
  await assertComplete(f);
});

for (const code of ['EPERM', 'EBUSY', 'EACCES']) test(`checkpoint rename retries transient ${code}`, async t => {
  const f = await fixture(t);
  let failures = 0;
  await migrate({ ...f.options, renameFile: async (from, to) => {
    assert.equal(to, f.checkpoint);
    if (failures++ < 2) throw Object.assign(new Error('temporary rename lock'), { code });
    await rename(from, to);
  } });
  assert.ok(failures >= 3);
  await assertComplete(f);
});

test('checkpoint rename retries are bounded, retain the source and clean their temporary file', async t => {
  const f = await fixture(t);
  let attempts = 0;
  await assert.rejects(migrate({ ...f.options, renameFile: async () => { attempts += 1; throw Object.assign(new Error('locked'), { code: 'EPERM' }); } }), { code: 'EPERM' });
  assert.equal(attempts, 6);
  assert.equal(await readFile(path.join(f.source, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  assert.equal((await readdir(f.cosmic)).filter(name => name.endsWith('.tmp')).length, 0);
  await migrate(f.options);
  await assertComplete(f);
});

for (const phase of ['agents', 'service', 'shortcuts', 'shims', 'retiring', 'complete']) test(`a durable ${phase} checkpoint resumes after process interruption`, async t => {
  const f = await fixture(t, { service: true, registration: true, shortcut: true });
  let stopped = false;
  await assert.rejects(migrate({ ...f.options, renameFile: async (from, to) => {
    const saved = JSON.parse(await readFile(from));
    await rename(from, to);
    const reached = phase === 'complete' ? saved.complete : phase === 'retiring' ? saved.moves.some(move => move.retiring) : saved.phases.includes(phase);
    if (!stopped && reached) { stopped = true; throw interrupted(); }
  } }), /fixture interruption/);
  assert.equal(stopped, true);
  await migrate(f.options);
  await assertComplete(f);
  assert.equal(f.registered.size, 1);
  assert.ok([...f.registered.keys()][0].startsWith('ONEM1ND-'));
  assert.equal(f.calls.filter(call => call.includes('/Create')).length, 1);
  assert.equal(f.calls.filter(call => call.includes('/Delete')).length, 1);
  assert.equal(await readFile(path.join(f.root, 'Desktop', 'ONEM1ND.lnk'), 'utf8'), 'new generated shortcut');
  await assert.rejects(lstat(f.shim), { code: 'ENOENT' });
});

test('an interrupted retirement resumes after deleting only part of the source', async t => {
  const f = await fixture(t);
  let retired = 0;
  await assert.rejects(migrate({ ...f.options, afterRetire: async () => { if (++retired === 2) throw interrupted(); } }), /fixture interruption/);
  assert.equal((await checkpoint(f)).moves[0].retiring, true);
  await migrate(f.options);
  await assertComplete(f);
});

test('pre-fix copyTemps checkpoints resume and clean a published hardlink left by interruption', async t => {
  const f = await fixture(t);
  await assert.rejects(migrate({ ...f.options, afterCopy: async () => { throw interrupted(); } }), /fixture interruption/);
  const state = await checkpoint(f), move = state.moves[0];
  const temporary = path.join(f.destination, '.onem1nd-copy-legacy-checkpoint.tmp');
  await link(path.join(f.destination, 'data.bin'), temporary);
  move.copyTemps = { 'data.bin': temporary };
  delete move.copyId;
  await writeFile(f.checkpoint, `${JSON.stringify(state, null, 2)}\n`);
  await migrate(f.options);
  await assert.rejects(lstat(temporary), { code: 'ENOENT' });
  assert.equal((await checkpoint(f)).moves[0].copyTemps, undefined);
  assert.equal((await lstat(path.join(f.destination, 'data.bin'))).nlink, 1);
  await assertComplete(f);
});

test('retirement rejects a changed destination digest and retains every source file', async t => {
  const f = await fixture(t);
  let changed = false;
  await assert.rejects(migrate({ ...f.options, renameFile: async (from, to) => {
    const state = JSON.parse(await readFile(from));
    await rename(from, to);
    if (!changed && state.phases.includes('shims')) { changed = true; await writeFile(path.join(f.destination, 'data.bin'), 'corrupt copied bytes'); }
  } }), { code: 'MIGRATION_CONFLICT' });
  assert.equal(await readFile(path.join(f.source, 'data.bin'), 'hex'), '00ff07002b');
  assert.equal(await readFile(path.join(f.source, 'user', 'VERSION'), 'utf8'), '3.0.0\n');
  assert.equal((await checkpoint(f)).moves[0].retired, undefined);
  await writeFile(path.join(f.destination, 'data.bin'), await readFile(path.join(f.source, 'data.bin')));
  await migrate(f.options);
  await assertComplete(f);
});

for (const command of ['/Create', '/Delete']) test(`service registration resumes a completed ${command} whose success was not checkpointed`, async t => {
  const f = await fixture(t, { service: true, registration: true });
  const run = f.options.run;
  let stopped = false;
  await assert.rejects(migrate({ ...f.options, run: async argv => {
    await run(argv);
    if (!stopped && argv.includes(command)) { stopped = true; throw interrupted(); }
  } }), /fixture interruption/);
  await migrate(f.options);
  await assertComplete(f);
  assert.equal(f.registered.size, 1);
  assert.equal(f.calls.filter(call => call.includes('/Create')).length, 1);
  assert.equal(f.calls.filter(call => call.includes('/Delete')).length, 1);
});

test('a linked PATH directory without our shims is skipped and its target remains untouched', async t => {
  const f = await fixture(t);
  const target = path.join(f.root, 'java-real'), linked = path.join(f.root, 'java8path');
  await put(path.join(target, 'java.exe'), 'personal runtime');
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await migrate({ ...f.options, env: { PATH: linked } });
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  assert.equal(await readFile(path.join(target, 'java.exe'), 'utf8'), 'personal runtime');
  await assertComplete(f);
});

test('a linked PATH directory with an apparent generated shim never allows deletion through the link', async t => {
  const f = await fixture(t);
  const target = path.join(f.root, 'shim-target'), linked = path.join(f.root, 'linked-bin');
  const shim = await put(path.join(target, `${OLD}.cmd`), `node node_modules\\${OLD}\\cli\\index.mjs`);
  const original = await readFile(shim);
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(migrate({ ...f.options, env: { PATH: linked } }), { code: 'unsafe_path' });
  assert.deepEqual(await readFile(shim), original);
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  assert.equal(await readFile(path.join(f.source, 'data.bin'), 'hex'), '00ff07002b');
});

test('missing private destination directories in an incomplete upgrade retain their source', async t => {
  const f = await fixture(t, { service: true });
  let stopped = false;
  await assert.rejects(migrate({ ...f.options, renameFile: async (from, to) => {
    const saved = JSON.parse(await readFile(from));
    await rename(from, to);
    if (!stopped && saved.phases.includes('agents')) { stopped = true; throw interrupted(); }
  } }), /fixture interruption/);
  const state = await checkpoint(f);
  assert.equal(state.complete, undefined);
  assert.ok(state.moves.every(move => move.copied));
  const serviceMove = state.moves.find(move => path.basename(path.dirname(move.destination)) === 'onem1nd-service');
  assert.ok(serviceMove);
  const removed = path.join(serviceMove.destination, 'TEST');
  const original = path.join(serviceMove.source, 'TEST', 'config.json'), bytes = await readFile(original);
  await rm(removed, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(migrate(f.options), { code: 'MIGRATION_CONFLICT' });
    await assert.rejects(lstat(removed), { code: 'ENOENT' });
    assert.deepEqual(await readFile(original), bytes);
    assert.equal(await readFile(path.join(f.source, 'data.bin'), 'hex'), '00ff07002b');
    assert.ok((await checkpoint(f)).moves.every(move => !move.retiring && !move.retired));
  }
});

test('private destination directories are protected before verification and completed upgrades repair inherited permissions', async t => {
  const f = await fixture(t, { service: true });
  await migrate(f.options);
  const state = await checkpoint(f), directories = [];
  for (const move of state.moves.filter(move => move.destination.includes('onem1nd-service') || move.destination.includes('onem1nd-origin'))) {
    directories.push(path.dirname(move.destination), move.destination, ...move.inventory.filter(entry => entry.directory).map(entry => path.join(move.destination, entry.path)));
  }
  for (const directory of new Set(directories)) {
    await verifyLocalPermissions(directory, f.options);
    if (process.platform === 'win32') {
      const operations = f.aclRunner.calls.filter(call => call.target === directory).map(call => call.op);
      assert.deepEqual(operations.slice(0, 3), ['check', 'protect', 'check']);
      assert.equal(operations.filter(op => op === 'protect').length, 1);
    }
  }
  const local = path.join(f.cosmic, 'onem1nd-service', mindKeyFor(f.destination, f.options.platform), 'TEST');
  const serviceOptions = { ...f.options, mindPath: f.destination };
  await verifyBootstrapFiles(local, path.join(local, 'config.json'), f.options);
  await assert.rejects(runConfiguredService(serviceOptions), { code: 'encryption_unavailable' });
  if (process.platform === 'win32') f.aclRunner.protectedTargets.clear();
  else for (const directory of new Set(directories)) await chmod(directory, 0o755);
  await assert.rejects(verifyLocalPermissions(local, f.options), { code: 'bootstrap_unavailable' });
  const previous = await readFile(f.checkpoint);
  assert.equal((await migrate(f.options)).migrated, false);
  assert.deepEqual(await readFile(f.checkpoint), previous);
  for (const directory of new Set(directories)) await verifyLocalPermissions(directory, f.options);
  await verifyBootstrapFiles(local, path.join(local, 'config.json'), f.options);
  await assert.rejects(runConfiguredService(serviceOptions), { code: 'encryption_unavailable' });
  const protections = f.aclRunner.calls.filter(call => call.op === 'protect').length;
  await migrate(f.options);
  assert.equal(f.aclRunner.calls.filter(call => call.op === 'protect').length, protections);
  const removed = path.join(local, 'staging', 'nested');
  await rm(removed, { recursive: true });
  await migrate(f.options);
  await assert.rejects(lstat(removed), { code: 'ENOENT' });
});

test('real Windows ACLs protect migrated bootstrap folders and a completed upgrade repairs inheritance', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { service: true });
  const temporary = path.join(f.root, 'tmp');
  await mkdir(temporary);
  const before = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TEMP = temporary; process.env.TMP = temporary;
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  let aclFailure = '';
  const aclRunner = createAclRunner({ spawnSync: (command, args, settings) => {
    assert.equal(settings.windowsHide, true);
    const result = spawnSync(command, args, settings);
    if (result.error || result.status !== 0) aclFailure = `${path.basename(command)} exited ${result.status}: ${String(result.error?.code ?? result.stderr ?? result.stdout).trim().slice(0, 250)}`;
    return result;
  } });
  try { aclRunner.protect(temporary); aclRunner.check(temporary); }
  catch (error) { t.skip(`Windows ACL commands are unavailable in this sandbox: ${aclFailure || `${error.code}: ${error.message}`}`); return; }
  const options = { ...f.options, aclRunner };
  delete options.protectFile;
  await migrate(options);
  const local = path.join(f.cosmic, 'onem1nd-service', mindKeyFor(f.destination, options.platform), 'TEST');
  await verifyBootstrapFiles(local, path.join(local, 'config.json'), options);
  await assert.rejects(runConfiguredService({ ...options, mindPath: f.destination }), { code: 'encryption_unavailable' });
  const moved = path.join(f.root, 'inherited-machine');
  await mkdir(moved);
  await rename(local, path.join(f.root, 'protected-machine'));
  await rename(moved, local);
  for (const entry of await readdir(path.join(f.root, 'protected-machine'))) await rename(path.join(f.root, 'protected-machine', entry), path.join(local, entry));
  await assert.rejects(verifyLocalPermissions(local, options), { code: 'bootstrap_unavailable' });
  assert.equal((await migrate(options)).migrated, false);
  await verifyBootstrapFiles(local, path.join(local, 'config.json'), options);
  await assert.rejects(runConfiguredService({ ...options, mindPath: f.destination }), { code: 'encryption_unavailable' });
});
