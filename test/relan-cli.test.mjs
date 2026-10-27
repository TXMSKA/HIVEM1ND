import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { helpText, parseArgs, runCli } from '../cli/index.mjs';
import { request } from '../engine/service/client.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function sink() {
  let value = '';
  return { write(chunk) { value += chunk; }, read() { return value; } };
}

function connection(response = { status: 200, json: { data: { machine: 'MEMBER', paired: true, hosting: false, host: 'HOST' } } }) {
  const calls = [];
  const service = { token: 'desktop-person-token', async release(options) { calls.push({ release: options }); } };
  return { calls, async connectService(options) { calls.push({ connect: options }); return service; },
    async request(caller, spec) { calls.push({ caller, spec }); return response; } };
}

test('ReLAN CLI validates commands, codes and init combinations', async () => {
  assert.deepEqual(parseArgs(['relan', 'join', 'abc234', '--json']).options, { action: 'join', code: 'ABC234', json: true });
  assert.deepEqual(parseArgs(['relan', 'join', 'abc234', '--host', '100.64.0.2:43220']).options,
    { action: 'join', code: 'ABC234', host: '100.64.0.2:43220' });
  assert.equal(parseArgs(['init', '--join-code', 'ABC234']).options.joinCode, 'ABC234');
  assert.equal(parseArgs(['init', '--join-code', 'ABC234', '--host', '100.127.255.254']).options.host, '100.127.255.254');
  assert.equal(parseArgs(['service', 'install', '--origin-kind', 'relan']).options.originKind, 'relan');
  for (const argv of [
    ['relan', 'other'], ['relan', 'join'], ['relan', 'join', 'ABC01I'], ['relan', 'join', 'ABC234', 'extra'],
    ['relan', 'host', 'ABC234'], ['relan', 'status', '--origin-kind', 'folder'],
    ['init', '--join-code', 'ABC234', '--gui'], ['init', '--join-code', 'ABC234', '--resume'],
    ['init', '--join-code', 'ABC234', '--origin-kind', 'folder'],
    ['init', '--host', '100.64.0.2'], ['relan', 'status', '--host', '100.64.0.2'],
    ['relan', 'join', 'ABC234', '--host', '100.64.0.2', '--host', '100.64.0.3'],
  ]) assert.throws(() => parseArgs(argv), undefined, argv.join(' '));
  for (const address of ['0.0.0.0', '8.8.8.8', '100.63.255.255', '100.128.0.0', 'localhost', '100.64.0.2:0', '100.64.0.2:65536']) {
    assert.throws(() => parseArgs(['relan', 'join', 'ABC234', '--host', address]), undefined, address);
    assert.throws(() => parseArgs(['init', '--join-code', 'ABC234', '--host', address]), undefined, address);
  }
  const help = await helpText();
  assert.match(help, /relan <status\|join <code>\|host\|leave>/);
  assert.match(help, /--join-code/);
  assert.match(help, /relan peer <add\|remove>/);
  assert.match(help, /--host <address>/);
});

test('ReLAN peer CLI accepts only eligible IPv4 peers and one add or remove action', () => {
  for (const action of ['add', 'remove']) {
    assert.deepEqual(parseArgs(['relan', 'peer', action, '100.64.0.2:43219', '--json']).options,
      { action: `peer-${action}`, address: '100.64.0.2:43219', json: true });
    assert.equal(parseArgs(['relan', 'peer', action, '192.168.1.2']).options.address, '192.168.1.2');
  }
  for (const positional of [[], ['add'], ['list'], ['add', '8.8.8.8'], ['remove', '0.0.0.0'],
    ['add', '100.64.0.2', 'extra'], ['add', '100.64.0.2:65536'], ['add', '100.64.0.2;whoami']]) {
    assert.throws(() => parseArgs(['relan', 'peer', ...positional]), undefined, positional.join(' '));
  }
});

test('ReLAN status displays a pairing code through the authenticated local service', async () => {
  const output = sink();
  const errors = sink();
  const relanClient = connection({ status: 200, json: { data: { machine: 'HOST', paired: true, hosting: true,
    pairing: { code: 'ABC234', expiresAt: '2026-10-22T12:10:00.000Z' },
    peers: [{ address: '100.64.0.2', port: 43119 }, { address: '192.168.1.2', port: 43219 }] } } });
  assert.equal(await runCli(['relan', 'status', '--mind-path', '.', '--hostname', 'HOST'], { relanClient, stdout: output, stderr: errors }), 0);
  assert.equal(errors.read(), '');
  assert.match(output.read(), /Hosting ReLAN on HOST/);
  assert.match(output.read(), /Pairing code: ABC234/);
  assert.match(output.read(), /Known peers: 100\.64\.0\.2:43119, 192\.168\.1\.2:43219/);
  const requests = relanClient.calls.filter(call => call.spec);
  const request = requests[0];
  assert.equal(request.caller.token, 'desktop-person-token');
  assert.deepEqual(request.spec.body, { action: 'status' });
  assert.deepEqual(requests[1].spec.body, { action: 'code' });
  assert.equal(request.spec.path, '/api/v1/relan');
  assert.match(request.spec.headers['idempotency-key'], /^[a-f0-9-]{36}$/);
  assert.deepEqual(relanClient.calls.at(-1), { release: { stop: true } });
});

test('ReLAN peer mutations and direct joins forward their addresses to the local service', async () => {
  for (const action of ['add', 'remove']) {
    const relanClient = connection();
    assert.equal(await runCli(['relan', 'peer', action, '100.64.0.2:43219'],
      { relanClient, stdout: sink(), stderr: sink() }), 0);
    assert.deepEqual(relanClient.calls.filter(call => call.spec).map(call => call.spec.body),
      [{ action: `peer-${action}`, address: '100.64.0.2:43219' }]);
    assert.deepEqual(relanClient.calls.at(-1), { release: { stop: true } });
  }
  const relanClient = connection();
  assert.equal(await runCli(['relan', 'join', 'ABC234', '--host', '100.64.0.2:43220'],
    { relanClient, stdout: sink(), stderr: sink() }), 0);
  assert.deepEqual(relanClient.calls.find(call => call.spec).spec.body,
    { action: 'join', code: 'ABC234', host: '100.64.0.2:43220' });
});

test('ReLAN status does not activate an unpaired or departed member', async () => {
  const output = sink();
  const relanClient = connection({ status: 200, json: { data: { machine: 'MEMBER', paired: false, hosting: false, host: null } } });
  assert.equal(await runCli(['relan', 'status'], { relanClient, stdout: output, stderr: sink() }), 0);
  assert.deepEqual(relanClient.calls.filter(call => call.spec).map(call => call.spec.body), [{ action: 'status' }]);
  assert.doesNotMatch(output.read(), /Pairing code/);
});

test('ReLAN status reports local work while a paired machine has no private network', async () => {
  for (const hosting of [false, true]) {
    const output = sink();
    const relanClient = connection({ status: 200, json: { data: { machine: 'MEMBER', paired: true, hosting, host: 'HOST', listeners: [] } } });
    assert.equal(await runCli(['relan', 'status'], { relanClient, stdout: output, stderr: sink() }), 0);
    assert.match(output.read(), /^ReLAN is offline\. Changes are saved locally until the private network returns\./);
    assert.doesNotMatch(output.read(), /Hosting ReLAN|ReLAN member/);
  }
});

test('ReLAN mutations forward their own action and release after a rejected join', async () => {
  for (const action of ['join', 'host', 'leave']) {
    const relanClient = connection();
    const args = ['relan', action, ...(action === 'join' ? ['ABC234'] : []), '--json'];
    assert.equal(await runCli(args, { relanClient, stdout: sink(), stderr: sink() }), 0);
    assert.deepEqual(relanClient.calls.find(call => call.spec).spec.body,
      { action, ...(action === 'join' ? { code: 'ABC234' } : {}) });
  }
  const output = sink();
  const errors = sink();
  const relanClient = connection({ status: 401, json: { error: { code: 'invalid_pairing', message: 'The code was refused.' } } });
  assert.equal(await runCli(['relan', 'join', 'ABC234'], { relanClient, stdout: output, stderr: errors }), 1);
  assert.equal(output.read(), '');
  assert.match(errors.read(), /The code was refused/);
  assert.deepEqual(relanClient.calls.at(-1), { release: { stop: true } });
});

test('init --join-code configures the local mirror and joins without loading setup screens', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hivem1nd-relan-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mind = path.join(root, 'mind');
  let configured;
  const relanClient = connection();
  const result = await runCli(['init', '--join-code', 'abc234', '--host', '100.64.0.2', '--mind-path', mind, '--cosmic-path', path.join(root, 'Cosmic'), '--hostname', 'MEMBER'], {
    relanClient, stdout: sink(), stderr: sink(),
    setup: { createSetupSession() { assert.fail('The terminal setup must not load.'); } },
    serviceInstall: { async configureOwnedService(options) { configured = options; return { status: 'configured' }; } },
  });
  assert.equal(result, 0);
  assert.equal(configured.originKind, 'relan');
  assert.equal(configured.configureOnly, true);
  assert.equal(configured.mindPath, mind);
  assert.deepEqual(relanClient.calls.find(call => call.spec).spec.body, { action: 'join', code: 'ABC234', host: '100.64.0.2' });
});

test('ReLAN local service controls peers and forwards discovery and direct joins under desktop authority', async t => {
  const fixture = await makeCoreFixture();
  let core;
  t.after(async () => { await core?.http.close(); await dispose(fixture); });
  core = await composeCore({ store: fixture.store, paths: { ...fixture.paths, origin: path.join(fixture.root, 'mirror') },
    now: () => fixture.clock.now, originKind: 'relan', projects: [], clients: [],
    relan: { addresses: ['127.0.0.1'], allowLoopback: true, port: 0, discovery: { port: 0, targets: [] },
      execFile(_command, _args, _options, done) { done(new Error('unavailable')); } } });
  const caller = { origin: new URL(`http://127.0.0.1:${core.http.port}`), token: core.bootstrap.secret };
  const login = await request(caller, { path: '/api/v1/auth/local',
    body: { embedded: false, hostOrigin: null, look: null, language: null } });
  assert.equal(login.status, 201);
  caller.token = login.json.data.token;
  const relanClient = { async connectService() { return { ...caller, async release() {} }; }, request };
  const output = sink();
  const errors = sink();
  assert.equal(await runCli(['relan', 'peer', 'add', '100.64.0.2:43219'], { relanClient, stdout: output, stderr: errors }), 0, errors.read());
  assert.match(output.read(), /Known peers: 100\.64\.0\.2:43219/);
  assert.deepEqual(core.runtime.relan.status().peers, [{ address: '100.64.0.2', port: 43219 }]);
  const status = sink();
  assert.equal(await runCli(['relan', 'status'], { relanClient, stdout: status, stderr: errors }), 0);
  assert.match(status.read(), /Known peers: 100\.64\.0\.2:43219/);
  let joined;
  core.runtime.relan.join = async (...args) => { joined = args; };
  assert.equal(await runCli(['relan', 'join', 'ABC234'],
    { relanClient, stdout: sink(), stderr: errors }), 0, errors.read());
  assert.deepEqual(joined, ['ABC234']);
  assert.equal(await runCli(['relan', 'join', 'ABC234', '--host', '100.64.0.2:43220'],
    { relanClient, stdout: sink(), stderr: errors }), 0, errors.read());
  assert.deepEqual(joined, ['ABC234', { host: '100.64.0.2:43220' }]);
  assert.equal(await runCli(['relan', 'peer', 'remove', '100.64.0.2:43219'], { relanClient, stdout: sink(), stderr: errors }), 0);
  assert.deepEqual(core.runtime.relan.status().peers, []);
  const phone = core.credentials.issue({ audience: 'phone', capabilities: ['read'] });
  const denied = await request({ ...caller, token: phone.token }, { path: '/api/v1/relan',
    body: { action: 'peer-add', address: '100.64.0.2' } });
  assert.equal(denied.status, 403);
});
