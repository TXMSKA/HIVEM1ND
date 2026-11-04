import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ACCOUNT_VARIABLES, accountEnv, accountHome, accountsView, addAccount, confirmDetected, detectAccounts, listAccounts, readAccounts, removeAccount, skipDetected } from '../engine/service/accounts.mjs';
import { accountClients, launchChoice, validateRunsIn, withoutAccount } from '../engine/service/runs-in.mjs';
import { createStore } from '../engine/service/store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'accounts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home'), localDirectory = path.join(root, 'local');
  await mkdir(homeDir, { recursive: true }); await mkdir(localDirectory, { recursive: true });
  const store = createStore({ root, mindPath: path.join(root, 'mind'), localDirectory });
  const opened = [];
  const context = { homeDir, store, paths: { localDirectory, machine: 'test-machine' }, openTerminal: input => { opened.push(input); } };
  return { root, homeDir, context, opened };
}
async function fakeHome(homeDir, name, file, body = '{"secret":"SECRET-TOKEN"}') {
  const dir = path.join(homeDir, name);
  await mkdir(dir, { recursive: true });
  if (file) await writeFile(path.join(dir, file), body);
  return dir;
}

const clients = [{ id: 'claude', connected: true, models: [{ id: 'm-default', efforts: ['high'], modes: [] }],
  accounts: [{ id: 'work', label: 'Work', connected: true, models: [{ id: 'm-work', efforts: ['high'], modes: [] }] }] },
{ id: 'cursor', connected: true, models: [{ id: 'c', efforts: ['high'], modes: [] }] }];

test('the choice with and without account, and old records without it', () => {
  const plain = { client: 'claude', model: 'm-default', effort: 'high', mode: null };
  assert.deepEqual({ ...validateRunsIn(plain, clients) }, plain);
  assert.deepEqual({ ...launchChoice({ runsIn: plain }, clients) }, plain);
  const work = { ...plain, model: 'm-work', account: 'work' };
  assert.deepEqual({ ...validateRunsIn(work, clients) }, work);
  assert.deepEqual({ ...validateRunsIn({ ...plain, account: 'default' }, clients) }, plain);
  for (const bad of [{ ...work, account: 'gone' }, { ...work, model: 'm-default' }, { ...plain, model: 'm-work' }, { ...plain, client: 'cursor', model: 'c', account: 'work' }, { ...plain, account: 7 }])
    assert.throws(() => validateRunsIn(bad, clients), error => error.code === 'unsupported_launch_choice');
  assert.deepEqual(withoutAccount(work), { client: 'claude', model: 'm-work', effort: 'high', mode: null });
  const standing = accountClients({ id: 'claude', connected: true, models: [{ id: 'm-work', efforts: ['high'], modes: [] }] }, 'work');
  assert.deepEqual({ ...validateRunsIn(work, standing) }, work);
});

test('the spawn environment sets the account variable only for a non-default account', () => {
  const base = { PATH: 'x', CLAUDE_CONFIG_DIR: 'C:\\inherited', CODEX_HOME: 'C:\\inheritedcodex' };
  assert.equal(Object.hasOwn(accountEnv(base, 'claude', null), 'CLAUDE_CONFIG_DIR'), false);
  assert.equal(accountEnv(base, 'claude', 'C:\\h').CLAUDE_CONFIG_DIR, 'C:\\h');
  assert.equal(accountEnv(base, 'claude', 'C:\\h').CODEX_HOME, 'C:\\inheritedcodex');
  assert.equal(accountEnv(base, 'codex', 'C:\\k').CODEX_HOME, 'C:\\k');
  assert.equal(accountEnv(base, 'cursor', 'C:\\k'), base);
  assert.equal(base.CLAUDE_CONFIG_DIR, 'C:\\inherited');
  assert.equal(ACCOUNT_VARIABLES.codex, 'CODEX_HOME');
});

test('detection offers extra homes with a login file, one by one, and never reads credentials', async t => {
  const { homeDir, context } = await fixture(t);
  await fakeHome(homeDir, '.claude-alt', '.credentials.json');
  await fakeHome(homeDir, '.claude-bare', null);
  await fakeHome(homeDir, '.claude-json', '.claude.json');
  await fakeHome(homeDir, '.codex-alt', 'auth.json');
  await fakeHome(homeDir, '.codex-nologin', 'config.toml');
  await fakeHome(homeDir, '.cursor-alt', 'auth.json');
  const calls = [];
  const spy = { readdir: (...args) => { calls.push('readdir'); return readdir(...args); }, stat: file => { calls.push(`stat:${path.basename(file)}`); return stat(file); } };
  const found = await detectAccounts({ homeDir, fs: spy });
  assert.deepEqual(found.map(item => [item.client, item.label]), [['claude', 'alt'], ['claude', 'json'], ['codex', 'alt']]);
  assert.ok(calls.every(call => call === 'readdir' || call.startsWith('stat:')));
  assert.ok(calls.includes('stat:.credentials.json') && calls.includes('stat:auth.json'));

  let view = await accountsView(context);
  assert.equal(view.confirmed, false);
  assert.equal(view.pending.length, 3);
  assert.deepEqual(view.clients.claude.map(item => item.id), ['default']);
  view = await confirmDetected(context, { client: 'claude', home: path.join(homeDir, '.claude-alt'), label: 'Personal' });
  assert.deepEqual(view.clients.claude.map(item => [item.id, item.label]), [['default', 'Default'], ['personal', 'Personal']]);
  assert.equal(view.pending.length, 2);
  view = await skipDetected(context, { client: 'claude', home: path.join(homeDir, '.claude-json') });
  assert.equal(view.clients.claude.length, 2);
  assert.equal(view.confirmed, false);
  await assert.rejects(confirmDetected(context, { client: 'codex', home: path.join(homeDir, '.codex-nologin'), label: 'x' }), error => error.code === 'account_unavailable');
  view = await confirmDetected(context, { client: 'codex', home: path.join(homeDir, '.codex-alt'), label: 'Codex two' });
  assert.equal(view.confirmed, true);
  assert.equal(view.pending.length, 0);
  const stored = await readFile(path.join(context.paths.localDirectory, 'accounts.json'), 'utf8');
  assert.ok(!stored.includes('SECRET-TOKEN'));
  assert.equal(Object.keys(JSON.parse(stored).accounts.claude[0]).sort().join(), 'home,id,label');
  assert.equal(await accountHome(context, 'claude', 'personal'), path.join(homeDir, '.claude-alt'));
  assert.equal(await accountHome(context, 'claude', undefined), null);
  assert.equal(await accountHome(context, 'claude', 'default'), null);
  await assert.rejects(accountHome(context, 'claude', 'nope'), error => error.code === 'unsupported_launch_choice');
  assert.equal((await accountsView(context)).pending.length, 0);
});

test('nothing to offer closes the first-start question', async t => {
  const { context } = await fixture(t);
  assert.equal((await accountsView(context)).confirmed, true);
  assert.equal((await readAccounts(context)).confirmed, true);
});

test('adding opens a terminal for that home; removing drops only the entry', async t => {
  const { homeDir, context, opened } = await fixture(t);
  const view = await addAccount(context, { client: 'codex', label: 'Work team' });
  const added = view.clients.codex.find(item => !item.default);
  assert.equal(added.label, 'Work team');
  assert.equal(path.dirname(added.home), homeDir);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].client, 'codex');
  assert.equal(opened[0].home, added.home);
  assert.equal(opened[0].variable, 'CODEX_HOME');
  assert.equal(opened[0].command, 'codex login');
  assert.ok(!JSON.stringify(opened[0]).includes('Work team'));
  await mkdir(added.home, { recursive: true });
  await writeFile(path.join(added.home, 'auth.json'), 'keep');
  const second = await addAccount(context, { client: 'codex', label: 'Work team' });
  assert.equal(second.clients.codex.length, 3);
  assert.notEqual(second.clients.codex[2].home, added.home);
  await assert.rejects(addAccount(context, { client: 'cursor', label: 'x' }), error => error.code === 'invalid_body');
  await assert.rejects(addAccount(context, { client: 'codex', label: '  ' }), error => error.code === 'invalid_body');
  await assert.rejects(removeAccount(context, { client: 'codex', accountId: 'default' }), error => error.code === 'account_default');
  const after = await removeAccount(context, { client: 'codex', accountId: added.id });
  assert.equal(after.clients.codex.some(item => item.id === added.id), false);
  assert.equal(await readFile(path.join(added.home, 'auth.json'), 'utf8'), 'keep');
  await assert.rejects(removeAccount(context, { client: 'codex', accountId: added.id }), error => error.code === 'account_unavailable');
  assert.equal((await listAccounts(context, 'codex')).length, 2);
});

test('a plan task step stores the account and an old step reads as the default', async () => {
  const { validatePlanAssignment } = await import('../engine/service/plans.mjs');
  const supervised = [{ ...clients[0], boundary: 'supervised', scopeEnforced: false }];
  const work = { client: 'claude', model: 'm-work', effort: 'high', mode: null, account: 'work' };
  const plain = { client: 'claude', model: 'm-default', effort: 'high', mode: null };
  const stored = await validatePlanAssignment({}, { kind: 'client', client: 'claude', runsIn: work, reuseRole: null }, [], supervised, 'builder');
  assert.deepEqual(stored.runsIn, work);
  const old = await validatePlanAssignment({}, { kind: 'client', client: 'claude', runsIn: plain, reuseRole: null }, [], supervised, 'builder');
  assert.deepEqual(old.runsIn, plain);
  await assert.rejects(validatePlanAssignment({}, { kind: 'client', client: 'claude', runsIn: { ...work, account: 'gone' }, reuseRole: null }, [], supervised, 'builder'), { code: 'unsupported_launch_choice' });
});
