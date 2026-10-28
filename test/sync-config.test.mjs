import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapConfig, configureOwnedService } from '../engine/service/install.mjs';
import { runConfiguredService } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function configOf(fixture, kind = 'folder') {
  return {
    mindPath: fixture.paths.mind,
    machine: fixture.machine,
    stagingPath: fixture.paths.staging,
    origin: { kind, path: path.join(fixture.root, 'origin') },
  };
}

test('transport kinds validate with a local mirror and retain the Cosmic default', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  for (const kind of ['folder', 'onedrive', 'relan', 'relay-plus']) {
    const input = configOf(fixture, kind);
    assert.deepEqual(bootstrapConfig(input).origin, input.origin);
    assert.throws(() => bootstrapConfig({ ...input, origin: { kind } }), { code: 'invalid_body' });
    assert.throws(() => bootstrapConfig({ ...input, stagingPath: path.join(input.origin.path, 'staging') }), { code: 'invalid_path' });
    const configured = await configureOwnedService({
      platform: fixture.platform, mindPath: fixture.paths.mind, cosmicPath: fixture.paths.cosmic,
      hostname: fixture.machine, originKind: kind,
    });
    assert.equal(configured.status, 'planned');
    assert.deepEqual(configured.state.configBody.origin, {
      kind, path: path.join(fixture.paths.cosmic, 'onem1nd-origin', fixture.paths.mindKey),
    });
  }
  assert.throws(() => bootstrapConfig({ ...configOf(fixture), origin: { kind: 'quantum', path: path.join(fixture.root, 'origin') } }), { code: 'invalid_body' });
});

test('encryption configuration retains supported metadata and refuses unsupported or secret fields', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const input = configOf(fixture, 'relan');
  for (const encryption of [{ algorithm: 'none' }, { algorithm: 'aes-256-gcm', keyId: 'paired-key' }]) {
    const config = bootstrapConfig({ ...input, encryption });
    assert.deepEqual(config.encryption, encryption);
    assert.deepEqual(bootstrapConfig(config), config);
  }
  for (const extra of [{ preset: 'quantum' }, { quantum: true }, { algorithm: 'aes-256-gcm' }, { encryption: { algorithm: 'aes-128-gcm' } }]) {
    assert.throws(() => bootstrapConfig({ ...input, ...extra }), { code: 'unsupported_origin' });
  }
  for (const encryption of [true, null, [], { algorithm: 'aes-256-gcm' }, { algorithm: 'aes-256-gcm', keyId: '' },
    { algorithm: 'aes-256-gcm', keyId: 'x'.repeat(257) }, { algorithm: 'aes-256-gcm', keyId: 'key\n' }, { algorithm: 'aes-256-gcm', keyId: '\ud800' },
    { algorithm: 'aes-256-gcm', keyId: 'key', key: Buffer.alloc(32) }, { algorithm: 'none', keyId: 'key' }]) {
    assert.throws(() => bootstrapConfig({ ...input, encryption }), { code: 'invalid_body' });
  }
});

test('saved encryption survives configuration and cannot start a plaintext service', async t => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const encryption = { algorithm: 'aes-256-gcm', keyId: 'paired-key' };
  const config = bootstrapConfig({ ...configOf(fixture, 'relay-plus'), encryption });
  await mkdir(fixture.paths.localDirectory, { recursive: true, mode: 0o700 });
  await writeFile(fixture.paths.configFile, JSON.stringify(config), { mode: 0o600 });
  const options = {
    platform: fixture.platform, mindPath: fixture.paths.mind, cosmicPath: fixture.paths.cosmic,
    hostname: fixture.machine, aclRunner: fixture.store.aclRunner,
  };
  const planned = await configureOwnedService(options);
  assert.deepEqual(planned.state.configBody.encryption, encryption);
  await assert.rejects(runConfiguredService(options), { code: 'encryption_unavailable' });
  assert.deepEqual(JSON.parse(await readFile(fixture.paths.configFile, 'utf8')), config);
  assert.deepEqual(await readdir(fixture.paths.localDirectory), ['config.json']);
  await assert.rejects(readFile(path.join(config.origin.path, 'machines', fixture.machine, 'head.json')), { code: 'ENOENT' });
});
