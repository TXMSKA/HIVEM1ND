import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { parseArgs, runCli } from '../cli/index.mjs';
import { createRelayPlus } from '../engine/relay-plus/runtime.mjs';
import { request } from '../engine/service/client.mjs';
import { servicePaths } from '../engine/service/paths.mjs';
import { stubAclRunner } from '../engine/service/security.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { bootstrapConfig } from '../engine/service/install.mjs';
import { createStore } from '../engine/service/store.mjs';

async function temporary(t) {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/relay-service-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}
function sink() { let text = ''; return { write(value) { text += value; }, read: () => text }; }

test('Relay+ bootstrap config permits secure endpoints and rejects credentials and remote HTTP', async t => {
  const root = await temporary(t);
  const base = { mindPath: path.join(root, 'mind'), machine: 'FIRST', stagingPath: path.join(root, 'staging'),
    origin: { kind: 'relay-plus', path: path.join(root, 'origin') } };
  for (const relayPlus of [
    { baseUrl: 'https://quantum.example.com', siteUrl: 'https://account.example.com', enabled: true, mindId: 'personal' },
    { baseUrl: 'http://127.0.0.1:20001', siteUrl: 'http://localhost:20002', enabled: false },
    { baseUrl: 'http://[::1]:20001' },
  ]) assert.deepEqual(bootstrapConfig({ ...base, relayPlus }).relayPlus, relayPlus);
  for (const relayPlus of [
    { baseUrl: 'http://example.com' }, { siteUrl: 'http://192.168.1.4:20002' },
    { baseUrl: 'https://user:password@example.com' }, { siteUrl: 'https://example.com/?token=secret' },
    { baseUrl: 'https://example.com/path' }, { siteUrl: 'https://example.com/#secret' },
    { accessToken: 'secret' }, { refreshToken: 'secret' }, { phrase: 'secret' }, { key: 'secret' },
    { enabled: 'true' }, { mindId: '../escape' },
  ]) assert.throws(() => bootstrapConfig({ ...base, relayPlus }), undefined, JSON.stringify(relayPlus));
});

test('Relay+ CLI validates required approval arguments and keeps recovery phrase off arguments', async () => {
  assert.equal(parseArgs(['service', 'install', '--origin-kind', 'relay-plus']).options.originKind, 'relay-plus');
  assert.deepEqual(parseArgs(['relay-plus', 'approve', '--device-id', 'second', '--message-id', 'message', '--fingerprint', 'digest']).options,
    { action: 'approve', deviceId: 'second', messageId: 'message', fingerprint: 'digest' });
  for (const argv of [['relay-plus', 'unknown'], ['relay-plus', 'request-approval'], ['relay-plus', 'approve', '--device-id', 'second'],
    ['relay-plus', 'recover', '--phrase', 'secret'], ['relay-plus', 'status', '--device-id', 'one', '--device-id', 'two']]) {
    assert.throws(() => parseArgs(argv));
  }
  let sent, released;
  const output = sink(), errors = sink();
  const relayPlusClient = {
    async connectService() { return { async release(value) { released = value; } }; },
    async request(_service, spec) { sent = spec; return { status: 200, json: { data: { state: 'ready' } } }; },
  };
  assert.equal(await runCli(['relay-plus', 'recover'], { relayPlusClient,
    input: Readable.from(['recovery phrase from standard input\n']), stdout: output, stderr: errors }), 0, errors.read());
  assert.equal(sent.path, '/api/v1/relay-plus');
  assert.equal(sent.body.phrase, 'recovery phrase from standard input');
  assert.doesNotMatch(output.read(), /recovery phrase/);
  assert.deepEqual(released, { stop: true });
});

test('signed-out runtime makes no Quantum requests; PKCE sign-in requests the existing account recovery phrase', async t => {
  const root = await temporary(t);
  let calls = 0, revoked = false;
  const runtime = await createRelayPlus({ localDirectory: root, machine: 'FIRST', mindId: 'test-mind', aclRunner: stubAclRunner(),
    accountKeyStore: { readAccountKey: async () => null },
    baseUrl: 'http://127.0.0.1:59999', fetch: async (url) => {
      calls++;
      if (url.pathname === '/v1/oauth/token') return Response.json({ accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43),
        expiresIn: 900, deviceId: 'first', account_id: 'account' });
      if (url.pathname === '/v1/me') return Response.json({ accountId: 'account', plans: [], devices: [] });
      if (url.pathname === '/v1/bootstrap') return Response.json({ capabilities: { relayPlus: true } });
      if (url.pathname === '/v1/usage') return Response.json({ usedBytes: 0, poolBytes: 1000 });
      if (url.pathname === '/v1/keys') return Response.json({ keys: [] });
      if (url.pathname === '/v1/oauth/revoke') { revoked = true; return Response.json({ success: true }); }
      throw new Error(`Unexpected contract request ${url.pathname}`);
    } });
  t.after(() => runtime.close());
  assert.equal((await runtime.control({ action: 'status' })).state, 'signed-out');
  assert.equal(calls, 0);
  assert.equal(runtime.ready(), false);
  const pending = await runtime.control({ action: 'sign-in' });
  const callback = new URL(new URL(pending.url).searchParams.get('redirectUri'));
  callback.searchParams.set('code', 'c'.repeat(43));
  assert.equal((await fetch(callback)).status, 200);
  // The callback persists credentials before the runtime loads the machine's key state.
  await new Promise(resolve => setTimeout(resolve, 50));
  const status = await runtime.control({ action: 'status' });
  assert.equal(status.state, 'ready');
  assert.equal(status.sync.state, 'key-required');
  assert.equal(status.sync.code, 'recovery_phrase_setup_required');
  assert.doesNotMatch(JSON.stringify(status), /accessToken|refreshToken|privateKey|wrappingKey/);
  await assert.rejects(runtime.control({ action: 'create-key' }), error => error.code === 'encryption_key_missing');
  assert.equal((await runtime.control({ action: 'sign-out' })).state, 'signed-out');
  assert.equal(revoked, true);
  assert.equal(runtime.ready(), false);
});

test('Relay+ service requires desktop authority and keeps secret requests out of durable receipts', async t => {
  const root = await temporary(t);
  const paths = servicePaths({ platform: 'win32', env: { LOCALAPPDATA: path.join(root, 'local') }, home: path.join(root, 'home'), machine: 'FIRST' });
  paths.origin = path.join(root, 'mirror');
  await mkdir(path.join(paths.mind, 'user'), { recursive: true });
  await mkdir(paths.localDirectory, { recursive: true });
  const store = createStore({ root, confineRoot: root, mindPath: paths.mind, localDirectory: paths.localDirectory });
  store.aclRunner = stubAclRunner();
  const core = await composeCore({ store, paths, projects: [], clients: [], relayPlus: {
    fetch: async () => { throw new Error('Signed-out service must not call Quantum'); },
  } });
  t.after(() => core.http.close());
  const caller = { origin: new URL(`http://127.0.0.1:${core.http.port}`), token: core.bootstrap.secret };
  const login = await request(caller, { path: '/api/v1/auth/local', body: { embedded: false, hostOrigin: null, look: null, language: null } });
  assert.equal(login.status, 201); caller.token = login.json.data.token;
  let invoked = 0;
  core.runtime.relayPlus.control = async body => { invoked++; assert.equal(body.phrase, 'secret recovery phrase never journaled'); return { state: 'ready' }; };
  const spec = { path: '/api/v1/relay-plus', headers: { 'idempotency-key': randomUUID() }, body: { action: 'recover', phrase: 'secret recovery phrase never journaled' } };
  assert.equal((await request(caller, spec)).status, 200);
  assert.equal((await request(caller, spec)).status, 200);
  assert.equal(invoked, 1, 'retries use memory, preserving the operation without writing its secret body');
  const phone = core.credentials.issue({ audience: 'phone', capabilities: ['home.manage'] });
  assert.equal((await request({ ...caller, token: phone.token }, { ...spec, headers: { 'idempotency-key': randomUUID() } })).status, 403);
  assert.equal((await request(caller, { ...spec, headers: { 'idempotency-key': randomUUID() }, body: { action: 'recover', phrase: 'secret', unexpected: true } })).status, 400);
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else assert.equal((await readFile(file)).includes(Buffer.from('secret recovery phrase never journaled')), false, file);
    }
  }
  await inspect(root);
});
