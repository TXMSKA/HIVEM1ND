import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { protectLocalFile } from './security.mjs';
import { atomicWrite, readBytes } from './store.mjs';

// Several accounts per agent client. Each client keeps its own login inside its own home folder; ONEM1ND stores only a label
// and that folder. No token, e-mail or credential content is ever read or kept: a login is only checked for existing.
export const ACCOUNT_CLIENTS = Object.freeze(['claude', 'codex']);
export const DEFAULT_ACCOUNT = 'default';
export const ACCOUNT_VARIABLES = Object.freeze({ claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' });
const FOLDER_PREFIX = Object.freeze({ claude: '.claude-', codex: '.codex-' });
const DEFAULT_FOLDER = Object.freeze({ claude: '.claude', codex: '.codex' });
const LOGIN_FILES = Object.freeze({ claude: ['.credentials.json', '.claude.json'], codex: ['auth.json'] });
const LOGIN_COMMAND = Object.freeze({ claude: 'claude auth login', codex: 'codex login' });
const LABEL_MAX = 40;
const FORMAT = 'onem1nd-accounts-v1';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function fail(status, code, message) { throw new CoreError(status, code, message); }

export function accountsPath(context) { return path.join(context.paths.localDirectory, 'accounts.json'); }
function userHome(context) { return path.resolve(context.homeDir ?? os.homedir()); }
function sameHome(left, right) { return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(); }

export function validateLabel(label) {
  const value = typeof label === 'string' ? label.trim() : '';
  if (!value || value.length > LABEL_MAX || /[\u0000-\u001f]/.test(value)) fail(422, 'invalid_body', 'The account label must be one to forty characters.');
  return value;
}

export function validateAccountClient(client) {
  if (!ACCOUNT_CLIENTS.includes(client)) fail(422, 'invalid_body', 'Only Claude Code and Codex support several accounts.');
  return client;
}

function emptyRecord() { return { format: FORMAT, confirmed: false, skipped: [], accounts: { claude: [], codex: [] } }; }

export async function readAccounts(context) {
  const file = accountsPath(context);
  await assertNoLinks(file);
  const source = await readBytes(context.store, file);
  if (!source) return emptyRecord();
  let record;
  try { record = JSON.parse(source); } catch { fail(422, 'corrupt_resource', 'The accounts record is not valid.'); }
  if (record?.format !== FORMAT || typeof record.confirmed !== 'boolean') fail(422, 'corrupt_resource', 'The accounts record is not valid.');
  const accounts = { claude: [], codex: [] };
  for (const client of ACCOUNT_CLIENTS) {
    for (const item of Array.isArray(record.accounts?.[client]) ? record.accounts[client] : []) {
      if (typeof item?.id === 'string' && ID_PATTERN.test(item.id) && item.id !== DEFAULT_ACCOUNT && typeof item.label === 'string' && typeof item.home === 'string' && path.isAbsolute(item.home)) {
        accounts[client].push({ id: item.id, label: item.label, home: item.home });
      }
    }
  }
  return { format: FORMAT, confirmed: record.confirmed, skipped: Array.isArray(record.skipped) ? record.skipped.filter(item => typeof item === 'string') : [], accounts };
}

async function writeAccounts(context, record) {
  const file = accountsPath(context);
  await assertNoLinks(file);
  await atomicWrite(context.store, file, Buffer.from(`${JSON.stringify(record)}\n`));
  await protectLocalFile(file, { store: context.store }).catch(() => {});
}

// The default account always comes first and is the client's own home, with its variable unset.
export function accountList(context, record, client) {
  validateAccountClient(client);
  return [{ id: DEFAULT_ACCOUNT, label: 'Default', home: path.join(userHome(context), DEFAULT_FOLDER[client]), default: true },
    ...record.accounts[client].map(item => ({ ...item, default: false }))];
}

export async function listAccounts(context, client) { return accountList(context, await readAccounts(context), client); }

// The home folder a launch for this account uses; null for the default account, which leaves the variable unset.
export async function accountHome(context, client, accountId) {
  if (accountId === undefined || accountId === null || accountId === DEFAULT_ACCOUNT) return null;
  validateAccountClient(client);
  const found = (await readAccounts(context)).accounts[client].find(item => item.id === accountId);
  if (!found) fail(422, 'unsupported_launch_choice', 'The selected account does not exist.');
  return found.home;
}

// The environment for one client process of one account. Both home variables are dropped first, so a variable inherited from the
// parent (or meant for the other client) never reaches the child. The default account then leaves its variable unset and the client
// uses its own home; any other account sets its folder for that process only.
export function accountEnv(env, client, home) {
  const names = Object.values(ACCOUNT_VARIABLES);
  const next = { ...env };
  for (const key of Object.keys(next)) if (names.includes(key.toUpperCase())) delete next[key];
  const variable = ACCOUNT_VARIABLES[client];
  if (variable && home) next[variable] = home;
  return next;
}

async function hasLogin(client, home, fsApi) {
  for (const name of LOGIN_FILES[client]) {
    const found = await fsApi.stat(path.join(home, name)).catch(() => null);
    if (found?.isFile()) return true;
  }
  return false;
}

// Extra homes in the user home: `.claude-*` holding a login file, `.codex-*` holding auth.json. Only the names and the
// existence of the login files are looked at; no file is read. `known` and `skipped` homes are not offered.
export async function detectAccounts({ homeDir, known = [], skipped = [], fs: fsApi = { readdir, stat } } = {}) {
  const entries = await fsApi.readdir(homeDir, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const client of ACCOUNT_CLIENTS) {
      const prefix = FOLDER_PREFIX[client];
      if (!entry.name.startsWith(prefix) || entry.name.length === prefix.length) continue;
      const home = path.join(homeDir, entry.name);
      if ([...known, ...skipped].some(item => sameHome(item, home)) || !await hasLogin(client, home, fsApi)) continue;
      found.push({ client, label: entry.name.slice(prefix.length), home });
    }
  }
  return found.sort((left, right) => left.client.localeCompare(right.client) || left.home.localeCompare(right.home));
}

function slug(label) { return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'account'; }

function nextId(record, client, label) {
  const base = slug(label);
  const taken = new Set([DEFAULT_ACCOUNT, ...record.accounts[client].map(item => item.id)]);
  let id = base, count = 2;
  while (taken.has(id)) id = `${base}-${count++}`;
  return id;
}

function insert(record, client, label, home) {
  if (record.accounts[client].some(item => sameHome(item.home, home))) fail(409, 'account_exists', 'That account is already in the list.');
  const id = nextId(record, client, label);
  record.accounts[client].push({ id, label, home });
  return id;
}

async function pending(context, record) {
  if (record.confirmed) return [];
  const known = ACCOUNT_CLIENTS.flatMap(client => record.accounts[client].map(item => item.home));
  return detectAccounts({ homeDir: userHome(context), known, skipped: record.skipped, fs: context.accountFs });
}

// What Settings shows: the accounts of each client and the detected homes still waiting for the person's answer. The first start
// with nothing to offer closes the question for good.
export async function accountsView(context) {
  let record = await readAccounts(context);
  const offers = await pending(context, record);
  if (!record.confirmed && !offers.length) { record = { ...record, confirmed: true }; await writeAccounts(context, record); }
  return { machine: context.paths.machine, confirmed: record.confirmed, pending: offers,
    clients: Object.fromEntries(ACCOUNT_CLIENTS.map(client => [client, accountList(context, record, client).map(({ id, label, home, default: isDefault }) => ({ id, label, home, default: isDefault }))])) };
}

async function answered(context, record) {
  if (!record.confirmed && !(await pending(context, record)).length) record.confirmed = true;
  await writeAccounts(context, record);
  return accountsView(context);
}

// The person confirms a detected home (the label is the suggestion or what they typed). Only a home that detection offers now is accepted.
export async function confirmDetected(context, { client, home, label }) {
  validateAccountClient(client);
  const record = await readAccounts(context);
  const offer = (await pending(context, record)).find(item => item.client === client && sameHome(item.home, String(home)));
  if (!offer) fail(409, 'account_unavailable', 'That home is not waiting for confirmation.');
  record.skipped = record.skipped.filter(item => !sameHome(item, offer.home));
  insert(record, client, validateLabel(label ?? offer.label), offer.home);
  return answered(context, record);
}

export async function skipDetected(context, { client, home }) {
  validateAccountClient(client);
  const record = await readAccounts(context);
  const offer = (await pending(context, record)).find(item => item.client === client && sameHome(item.home, String(home)));
  if (!offer) fail(409, 'account_unavailable', 'That home is not waiting for confirmation.');
  record.skipped.push(offer.home);
  return answered(context, record);
}


// The real terminal launcher. The running service configures it; a service composed without it (tests, embedders) opens no window.
export function systemTerminal({ variable, home, command }) {
  if (process.platform !== 'win32') throw new CoreError(409, 'terminal_unavailable', 'This platform has no terminal launcher yet.');
  // The account home travels in the environment of the new console, so no shell string carries it.
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', 'cmd.exe', '/k', command], { shell: false, detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, [variable]: home } });
  child.unref();
}

// Opens a terminal for the client's own sign-in with that account's variable set. The home path is chosen here, never taken from the request.

export async function addAccount(context, { client, label }) {
  validateAccountClient(client);
  const name = validateLabel(label);
  if (typeof context.openTerminal !== 'function') fail(409, 'terminal_unavailable', 'No terminal launcher is configured.');
  const record = await readAccounts(context);
  const base = path.join(userHome(context), `${FOLDER_PREFIX[client]}${slug(name)}`);
  let home = base, count = 2;
  while (ACCOUNT_CLIENTS.some(other => record.accounts[other].some(item => sameHome(item.home, home))) || await stat(home).then(() => true, () => false)) home = `${base}-${count++}`;
  insert(record, client, name, home);
  await writeAccounts(context, record);
  await context.openTerminal({ client, home, variable: ACCOUNT_VARIABLES[client], command: LOGIN_COMMAND[client] });
  return accountsView(context);
}

// Removes only ONEM1ND's entry. The folder, the login and any setup written into the home stay.
export async function removeAccount(context, { client, accountId }) {
  validateAccountClient(client);
  if (accountId === DEFAULT_ACCOUNT) fail(409, 'account_default', 'The default account cannot be removed.');
  const record = await readAccounts(context);
  const found = record.accounts[client].find(item => item.id === accountId);
  if (!found) fail(404, 'account_unavailable', 'The account does not exist.');
  record.accounts[client] = record.accounts[client].filter(item => item.id !== accountId);
  record.skipped.push(found.home);
  return answered(context, record);
}
