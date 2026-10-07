import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { CURSOR_STOP_LOOP_LIMIT } from './cursor-wake.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { applyEdits, modify as modifyJsonc, parse as parseJsonc } from 'jsonc-parser';

const OWNED_SERVER = 'hivem1nd-relay';
const MARKER = '# HIVEM1ND Relay managed server';
const CLI_PATH = fileURLToPath(new URL('../../cli/index.mjs', import.meta.url));
const SUPPORTED = new Set(['claude', 'codex', 'cursor', 'opencode', 'copilot']);

const CLIENT_PATHS = {
  claude: (home) => ({ mcp: path.join(home, '.claude.json'), hooks: path.join(home, '.claude', 'settings.json') }),
  codex: (home) => ({ mcp: path.join(home, '.codex', 'config.toml'), hooks: path.join(home, '.codex', 'hooks.json') }),
  cursor: (home) => ({ mcp: path.join(home, '.cursor', 'mcp.json'), hooks: path.join(home, '.cursor', 'hooks.json') }),
  opencode: (home) => ({ mcp: path.join(home, '.config', 'opencode', 'opencode.jsonc') }),
  copilot: (home) => ({ mcp: path.join(home, '.copilot', 'mcp-config.json') }),
};

function safeString(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) throw new Error(`${name} must be a non-empty single-line string.`);
  return value;
}

function shellArg(value, platform) {
  const arg = safeString(String(value), 'argument');
  // Native hook runners evaluate this string through their configured shell.
  // Windows filenames cannot contain a double quote; rejecting one keeps the
  // cmd/PowerShell-compatible quoted argument deterministic.
  if (platform === 'win32') {
    if (arg.includes('"')) throw new Error('Windows hook arguments cannot contain double quotes.');
    return `"${arg}"`;
  }
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

function hookCommand({ client, event, mindPath, kitPath, unit, nodePath, platform }) {
  const args = [nodePath, path.join(kitPath, 'cli', 'index.mjs'), 'relay', 'hook', '--client', client, '--event', event, '--mind-path', mindPath];
  if (platform === 'win32' && (client === 'codex' || client === 'cursor')) return windowsHookCommand(args);
  return args.map((arg) => shellArg(arg, platform)).join(' ');
}

function windowsHookCommand(args) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const command = `& ${args.map(literal).join(' ')}`;
  const script = `$ErrorActionPreference = 'Stop'\n$relayInput = [Console]::In.ReadToEnd()\n$relayInput | ${command}\nexit $LASTEXITCODE`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

function hookHandler(options) {
  const { client, event, mindPath, kitPath, unit, nodePath, platform } = options;
  if (client === 'claude') {
    const args = [path.join(kitPath, 'cli', 'index.mjs'), 'relay', 'hook', '--client', client, '--event', event, '--mind-path', mindPath];
    return { type: 'command', command: nodePath, args, timeout: 5, ...(event === 'PreToolUse' ? { async: true } : {}) };
  }
  return { type: 'command', command: hookCommand(options), timeout: 5 };
}

function ownedMcp({ client, kitPath, mindPath, unit, sessionId, nodePath }) {
  const entry = {
    command: nodePath,
    args: [path.join(kitPath, 'cli', 'index.mjs'), 'relay', 'mcp', '--mind-path', mindPath, '--client', client,
      ...(unit ? ['--unit', unit] : []), ...(sessionId ? ['--session-id', sessionId] : [])],
  };
  if (client === 'cursor') return { type: 'stdio', ...entry };
  // Copilot's documented mcp-config.json entry shape for a local server.
  if (client === 'copilot') return { type: 'local', ...entry, tools: ['*'] };
  return entry;
}

function ownedOpenCodeMcp({ kitPath, mindPath, sessionId, nodePath }) {
  return {
    type: 'local',
    command: [nodePath, path.join(kitPath, 'cli', 'index.mjs'), 'relay', 'mcp', '--mind-path', mindPath, '--client', 'opencode', ...(sessionId ? ['--session-id', sessionId] : [])],
    enabled: true,
  };
}

function parseJsoncObject(text, label) {
  const errors = [];
  let document;
  try { document = parseJsonc(text || '{}', errors, { allowTrailingComma: true, disallowComments: false }); }
  catch { errors.push(new Error('parse failed')); }
  if (errors.length || !document || typeof document !== 'object' || Array.isArray(document)) {
    throw Object.assign(new Error(`${label} contains invalid JSON/JSONC; no files were changed.`), { code: 'RELAY_CONFIG_INVALID' });
  }
  return document;
}

function editJsonc(text, keyPath, value) {
  return applyEdits(text, modifyJsonc(text, keyPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  }));
}

function isOwnedOpenCodeMcp(value) {
  const command = value?.command;
  if (value?.type !== 'local' || !Array.isArray(command)) return false;
  const cliIndex = command.findIndex((item) => typeof item === 'string' && /(?:^|[\\/])cli[\\/]index\.mjs$/i.test(item));
  return cliIndex >= 0 && command.slice(cliIndex + 1, cliIndex + 4).join('\0') === ['relay', 'mcp', '--mind-path'].join('\0')
    && command.includes('--client') && command.includes('opencode');
}

function openCodeMcpMerge(text, options) {
  const initial = text.trim() ? text : '{}\n';
  const document = parseJsoncObject(initial, 'OpenCode config');
  if (document.mcp !== undefined && (!document.mcp || typeof document.mcp !== 'object' || Array.isArray(document.mcp))) {
    throw Object.assign(new Error('OpenCode mcp must be an object; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' });
  }
  const existing = document.mcp?.[OWNED_SERVER];
  if (existing !== undefined && !isOwnedOpenCodeMcp(existing)) {
    throw Object.assign(new Error(`The ${OWNED_SERVER} entry exists and is not owned by this setup.`), { code: 'RELAY_CONFIG_CONFLICT' });
  }
  const intended = ownedOpenCodeMcp(options);
  if (existing && JSON.stringify(existing) === JSON.stringify(intended)) return initial;
  return editJsonc(initial, ['mcp', OWNED_SERVER], intended);
}

function jsonMerge(existingText, kind, options) {
  let document = {};
  if (existingText.trim()) {
    try { document = JSON.parse(existingText); }
    catch { throw Object.assign(new Error(`${kind} contains invalid JSON; no files were changed.`), { code: 'RELAY_CONFIG_INVALID' }); }
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error(`${kind} must contain a JSON object.`);
  const { client, unit } = options;
  if (kind === 'mcp') {
    const key = client === 'claude' ? 'mcpServers' : 'mcpServers';
    document[key] ??= {};
    if (!document[key] || typeof document[key] !== 'object' || Array.isArray(document[key])) throw new Error(`${key} must be an object.`);
    const intended = ownedMcp(options);
    const existing = document[key][OWNED_SERVER];
    if (existing && JSON.stringify(existing) !== JSON.stringify(intended) && !isOwnedMcp(existing)) {
      throw Object.assign(new Error(`The ${OWNED_SERVER} entry exists and is not owned by this setup.`), { code: 'RELAY_CONFIG_CONFLICT' });
    }
    document[key][OWNED_SERVER] = intended;
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  if (client === 'cursor') {
    document.version = document.version ?? 1;
    if (!Number.isInteger(document.version) || document.version < 1) throw new Error('Cursor hooks.json has an unsupported version.');
    document.hooks ??= {};
    if (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) throw new Error('Cursor hooks must be an object.');
    for (const event of ['sessionStart', 'postToolUse', 'stop']) {
      const command = hookCommand({ ...options, client, event, unit });
      const existing = document.hooks[event] ?? [];
      if (!Array.isArray(existing)) throw new Error(`Cursor hook ${event} must be an array.`);
      const owned = existing.filter((item) => isOwnedHookCommand(item?.command, client, event));
      if (owned.length) for (const item of owned) item.command = command;
      else existing.push({ command, timeout: 5 });
      if (event === 'stop') for (const item of existing) {
        if (isOwnedHookCommand(item?.command, client, event)) item.loop_limit = CURSOR_STOP_LOOP_LIMIT;
      }
      document.hooks[event] = existing;
    }
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  document.hooks ??= {};
  if (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) throw new Error('hooks must be an object.');
  const events = client === 'claude' ? ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SessionEnd'] : ['SessionStart', 'UserPromptSubmit'];
  for (const event of events) {
    const handler = hookHandler({ ...options, client, event, unit });
    const groups = document.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`Hook ${event} must be an array.`);
    const owned = groups.filter((group) => (group.hooks ?? []).some((candidate) => isOwnedHookHandler(candidate, client, event)));
    let found = false;
    for (const group of owned) {
      for (const candidate of group.hooks ?? []) {
        if (!isOwnedHookHandler(candidate, client, event)) continue;
        found = true;
        candidate.command = handler.command;
        candidate.args = handler.args;
        if (!handler.args) delete candidate.args;
        candidate.type = handler.type;
      }
    }
    if (!found) groups.push({ hooks: [handler] });
    document.hooks[event] = groups;
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

function codexMcpMerge(text, options) {
  const server = ownedMcp({ ...options, client: 'codex' });
  const section = `${MARKER}\n[mcp_servers.${OWNED_SERVER}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${tomlArray(server.args)}\n`;
  let parsed;
  try { parsed = text.trim() ? parseToml(text) : {}; }
  catch { throw Object.assign(new Error('Codex config.toml is invalid TOML; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  if (parsed.mcp_servers !== undefined && (!parsed.mcp_servers || typeof parsed.mcp_servers !== 'object' || Array.isArray(parsed.mcp_servers))) {
    throw Object.assign(new Error('Codex mcp_servers must be a table; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' });
  }
  const present = parsed.mcp_servers?.[OWNED_SERVER];
  if (present) {
    const markerAt = text.lastIndexOf(MARKER);
    const headerAt = findOwnedTableHeader(text);
    if (markerAt < 0 || markerAt > headerAt || !isOwnedMcp(present)) {
      throw Object.assign(new Error(`The ${OWNED_SERVER} entry exists and is not an unchanged Relay-owned entry.`), { code: 'RELAY_CONFIG_CONFLICT' });
    }
    if (JSON.stringify(present) === JSON.stringify(server)) return text;
    return replaceOwnedTomlBlock(text, markerAt, headerAt, `${MARKER}\n[mcp_servers.${OWNED_SERVER}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${tomlArray(server.args)}\n`);
  }
  if (text.includes(`[mcp_servers.${OWNED_SERVER}]`) || text.includes(MARKER)) {
    throw Object.assign(new Error(`The ${OWNED_SERVER} entry is malformed and was left intact.`), { code: 'RELAY_CONFIG_CONFLICT' });
  }
  if (text.trim() && !text.endsWith('\n')) text += '\n';
  const merged = `${text}${text.trim() ? '\n' : ''}${section}`;
  try { parseToml(merged); }
  catch { throw Object.assign(new Error('Relay could not create a valid Codex TOML configuration.'), { code: 'RELAY_CONFIG_INVALID' }); }
  return merged;
}

function tomlArray(values) { return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`; }

function codexHooksMerge(text, options) {
  let doc;
  try { doc = text.trim() ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('Codex hooks.json contains invalid JSON; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Codex hooks.json must contain a JSON object.');
  doc.hooks ??= {};
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) throw new Error('Codex hooks must be an object.');
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const command = hookCommand({ ...options, client: 'codex', event });
    const groups = doc.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`Codex hook ${event} must be an array.`);
    const owned = groups.filter((group) => (group.hooks ?? []).some((handler) => handler?.type === 'command' && isOwnedHookCommand(handler.command, 'codex', event)));
    for (const group of owned) {
      for (const handler of group.hooks ?? []) if (handler?.type === 'command' && isOwnedHookCommand(handler.command, 'codex', event)) handler.command = command;
    }
    if (!groups.some((group) => (group.hooks ?? []).some((handler) => handler?.type === 'command' && handler.command === command)) && !owned.length) {
      groups.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    }
    doc.hooks[event] = groups;
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function buildClientConfig({ client, existing = {}, kitPath, mindPath, unit, sessionId, nodePath = process.execPath, platform = process.platform } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  kitPath = path.resolve(safeString(kitPath, 'kitPath'));
  mindPath = path.resolve(safeString(mindPath, 'mindPath'));
  nodePath = path.resolve(safeString(nodePath, 'nodePath'));
  if (unit !== undefined) safeString(unit, 'unit');
  if (sessionId !== undefined) safeString(sessionId, 'sessionId');
  if (client === 'codex') {
    const mcp = codexMcpMerge(existing.mcp ?? '', { client, kitPath, mindPath, unit, sessionId, nodePath });
    const hooks = codexHooksMerge(existing.hooks ?? '', { client, kitPath, mindPath, unit, nodePath, platform });
    return { mcp, hooks };
  }
  if (client === 'opencode') {
    return { mcp: openCodeMcpMerge(existing.mcp ?? '', { client, kitPath, mindPath, unit, sessionId, nodePath }) };
  }
  if (client === 'copilot') {
    return { mcp: jsonMerge(existing.mcp ?? '', 'mcp', { client, kitPath, mindPath, unit, sessionId, nodePath }) };
  }
  return {
    mcp: jsonMerge(existing.mcp ?? '', 'mcp', { client, kitPath, mindPath, unit, sessionId, nodePath }),
    hooks: jsonMerge(existing.hooks ?? '', 'hooks', { client, kitPath, mindPath, unit, nodePath, platform }),
  };
}

function isOwnedMcp(value) {
  const args = value?.args;
  return Array.isArray(args) && args.some((item) => typeof item === 'string' && /(?:^|[\\/])cli[\\/]index\.mjs$/i.test(item))
    && args.includes('relay') && args.includes('mcp') && args.includes('--mind-path');
}

function isOwnedHookCommand(value, client, event) {
  if (typeof value !== 'string') return false;
  const encoded = value.match(/(?:^|\s)-EncodedCommand\s+([A-Za-z0-9+/=]+)/i);
  if (encoded) {
    try { value = Buffer.from(encoded[1], 'base64').toString('utf16le'); } catch { return false; }
  }
  // hookCommand quotes every argument on POSIX and Windows, so recognize both
  // quoted and unquoted shell tokens rather than matching only one rendering.
  const token = (text) => `(?:'${text}'|"${text}"|${text})`;
  const pair = (name, argument) => new RegExp(`${token(name)}\\s+${token(argument)}`).test(value);
  return pair('relay', 'hook') && pair('--client', client) && pair('--event', event) && /(?:'--mind-path'|"--mind-path"|--mind-path)/.test(value);
}

function isOwnedHookHandler(handler, client, event) {
  if (handler?.type !== 'command') return false;
  if (client === 'claude' && Array.isArray(handler.args)) {
    const args = handler.args;
    return args.some((item) => typeof item === 'string' && /(?:^|[\\/])cli[\\/]index\.mjs$/i.test(item))
      && args.includes('relay') && args.includes('hook') && args.includes('--client') && args[args.indexOf('--client') + 1] === client
      && args.includes('--event') && args[args.indexOf('--event') + 1] === event && args.includes('--mind-path');
  }
  return isOwnedHookCommand(handler.command, client, event);
}

function findOwnedTableHeader(text) {
  const matches = [...text.matchAll(/^\s*\[mcp_servers\.(?:"hivem1nd-relay"|hivem1nd-relay)\]\s*$/gm)];
  return matches.at(-1)?.index ?? -1;
}

function replaceOwnedTomlBlock(text, markerAt, headerAt, replacement) {
  const headerEnd = text.indexOf('\n', headerAt);
  const searchFrom = headerEnd < 0 ? text.length : headerEnd + 1;
  const nextTable = /^\s*\[[^\]]+\]\s*$/gm;
  nextTable.lastIndex = searchFrom;
  const match = nextTable.exec(text);
  const end = match?.index ?? text.length;
  const start = replacement === '' && text.slice(0, markerAt).endsWith('\n\n') ? markerAt - 1 : markerAt;
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export function clientConfigPaths({ client, homeDir, env = process.env } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  const explicitHome = homeDir !== undefined;
  const home = path.resolve(homeDir ?? os.homedir());
  if (client === 'codex') {
    const root = path.resolve(explicitHome ? path.join(home, '.codex') : env.CODEX_HOME || path.join(home, '.codex'));
    return { mcp: path.join(root, 'config.toml'), hooks: path.join(root, 'hooks.json'), mcpRoot: root, hooksRoot: root };
  }
  if (client === 'claude') {
    const configRoot = path.resolve(explicitHome ? path.join(home, '.claude') : env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
    // Claude's user MCP registry follows CLAUDE_CONFIG_DIR when overridden;
    // otherwise it remains the documented home-level ~/.claude.json file.
    const customConfigDir = !explicitHome && Boolean(env.CLAUDE_CONFIG_DIR);
    const mcpRoot = customConfigDir ? configRoot : home;
    return {
      mcp: path.join(mcpRoot, '.claude.json'), hooks: path.join(configRoot, 'settings.json'),
      mcpRoot, hooksRoot: configRoot,
    };
  }
  if (client === 'opencode') {
    const customConfig = !explicitHome && typeof env.OPENCODE_CONFIG === 'string' && env.OPENCODE_CONFIG.trim();
    if (customConfig) {
      const mcp = path.resolve(env.OPENCODE_CONFIG);
      return { mcp, mcpRoot: path.dirname(mcp) };
    }
    const root = path.join(home, '.config', 'opencode');
    // OpenCode prefers JSONC, then JSON, then legacy config.json when files exist.
    const candidates = ['opencode.jsonc', 'opencode.json', 'config.json'].map((name) => path.join(root, name));
    const mcp = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
    return { mcp, mcpRoot: root };
  }
  if (client === 'copilot') {
    // COPILOT_HOME overrides ~/.copilot; VS Code reads the same portable user file.
    const root = path.resolve(explicitHome ? path.join(home, '.copilot') : env.COPILOT_HOME || path.join(home, '.copilot'));
    return { mcp: path.join(root, 'mcp-config.json'), mcpRoot: root };
  }
  const root = path.join(home, '.cursor');
  return { mcp: path.join(root, 'mcp.json'), hooks: path.join(root, 'hooks.json'), mcpRoot: root, hooksRoot: root };
}

async function readRegular(filePath) {
  try {
    const state = await lstat(filePath);
    if (state.isSymbolicLink() || !state.isFile()) throw new Error(`Refusing unsafe configuration path: ${filePath}`);
    return await readFile(filePath, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function ensureSafeParents(filePath, root) {
  const relative = path.relative(root, path.dirname(filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Configuration path escapes home: ${filePath}`);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const state = await lstat(current);
      if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`Refusing unsafe configuration directory: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
}

async function atomicConfigWrite(filePath, content, homeDir, backup = true) {
  await mkdir(homeDir, { recursive: true });
  const rootState = await lstat(homeDir);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) throw new Error(`Refusing unsafe configuration root: ${homeDir}`);
  await ensureSafeParents(filePath, homeDir);
  const prior = await readRegular(filePath);
  if (prior === content) return { changed: false, prior };
  if (backup && prior) {
    const backupPath = `${filePath}.relay-backup`;
    try {
      const state = await lstat(backupPath);
      if (state.isSymbolicLink() || !state.isFile()) throw new Error(`Refusing unsafe Relay backup: ${backupPath}`);
    } catch (error) { if (error.code === 'ENOENT') await copyFile(filePath, backupPath); else throw error; }
  }
  const temporary = `${filePath}.relay-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', encoding: 'utf8' });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { changed: true, prior };
}

export async function configureRelayClient({ client, homeDir, env = process.env, kitPath, mindPath, unit, sessionId, nodePath, platform } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  if (homeDir !== undefined) homeDir = path.resolve(safeString(homeDir, 'homeDir'));
  const targets = clientConfigPaths({ client, homeDir, env });
  const oldMcp = await readRegular(targets.mcp);
  const oldHooks = targets.hooks ? await readRegular(targets.hooks) : '';
  const config = buildClientConfig({ client, existing: { mcp: oldMcp, hooks: oldHooks }, kitPath, mindPath, unit, sessionId, nodePath, platform });
  const writes = [[targets.mcp, config.mcp], ...(targets.hooks ? [[targets.hooks, config.hooks]] : [])];
  const applied = [];
  try {
    for (const [filePath, content] of writes) {
      const root = filePath === targets.mcp ? targets.mcpRoot : targets.hooksRoot;
      const change = await atomicConfigWrite(filePath, content, root);
      applied.push({ filePath, ...change });
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      if (!item.changed) continue;
      if (item.prior) await atomicConfigWrite(item.filePath, item.prior, item.filePath === targets.mcp ? targets.mcpRoot : targets.hooksRoot, false);
      else await rm(item.filePath, { force: true });
    }
    throw error;
  }
  return { client, paths: [targets.mcp, ...(targets.hooks ? [targets.hooks] : [])], changed: applied.filter((item) => item.changed).map((item) => item.filePath), backups: applied.filter((item) => item.changed && item.prior).map((item) => `${item.filePath}.relay-backup`) };
}

export async function unconfigureRelayClient({ client, homeDir, env = process.env } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  const targets = clientConfigPaths({ client, homeDir, env });
  const mcpText = await readRegular(targets.mcp);
  const hooksText = targets.hooks ? await readRegular(targets.hooks) : '';
  let nextMcp = mcpText;
  let nextHooks = hooksText;
  if (client === 'codex') {
    let parsed;
    try { parsed = mcpText.trim() ? parseToml(mcpText) : {}; }
    catch { throw Object.assign(new Error('Codex config.toml is invalid TOML; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
    const markerAt = mcpText.lastIndexOf(MARKER);
    const headerAt = findOwnedTableHeader(mcpText);
    if (markerAt >= 0 && markerAt < headerAt && parsed.mcp_servers?.[OWNED_SERVER] && isOwnedMcp(parsed.mcp_servers[OWNED_SERVER])) {
      nextMcp = replaceOwnedTomlBlock(mcpText, markerAt, headerAt, '');
    }
    nextHooks = removeJsonHooks(hooksText, 'codex');
  } else if (client === 'opencode') {
    const document = parseJsoncObject(mcpText, 'OpenCode config');
    if (isOwnedOpenCodeMcp(document.mcp?.[OWNED_SERVER])) nextMcp = editJsonc(mcpText, ['mcp', OWNED_SERVER], undefined);
  } else {
    nextMcp = removeJsonMcp(mcpText);
    nextHooks = removeJsonHooks(hooksText, client);
  }
  const changed = [];
  if (nextMcp !== mcpText) { await atomicConfigWrite(targets.mcp, nextMcp, targets.mcpRoot); changed.push(targets.mcp); }
  if (targets.hooks && nextHooks !== hooksText) { await atomicConfigWrite(targets.hooks, nextHooks, targets.hooksRoot); changed.push(targets.hooks); }
  return { client, paths: [targets.mcp, ...(targets.hooks ? [targets.hooks] : [])], changed };
}

function removeJsonMcp(text) {
  if (!text.trim()) return text;
  let doc;
  try { doc = JSON.parse(text); } catch { throw Object.assign(new Error('Client MCP configuration contains invalid JSON; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  const servers = doc?.mcpServers;
  if (!servers?.[OWNED_SERVER] || !isOwnedMcp(servers[OWNED_SERVER])) return text;
  delete servers[OWNED_SERVER];
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function removeJsonHooks(text, client) {
  if (!text.trim()) return text;
  let doc;
  try { doc = JSON.parse(text); } catch { throw Object.assign(new Error('Client hooks configuration contains invalid JSON; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  let changed = false;
  for (const [event, groups] of Object.entries(doc?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    doc.hooks[event] = groups.map((group) => {
      if (client === 'cursor') return group;
      const handlers = group?.hooks ?? [];
      const retained = handlers.filter((handler) => !isOwnedHookHandler(handler, client, event));
      if (retained.length !== handlers.length) changed = true;
      return { ...group, hooks: retained };
    }).filter((group) => client === 'cursor' || (group.hooks?.length ?? 0) > 0);
    if (!doc.hooks[event].length) delete doc.hooks[event];
  }
  if (client === 'cursor') {
    for (const [event, entries] of Object.entries(doc?.hooks ?? {})) {
      if (!Array.isArray(entries)) continue;
      doc.hooks[event] = entries.filter((entry) => !isOwnedHookCommand(entry?.command, client, event));
      if (doc.hooks[event].length !== entries.length) changed = true;
      if (!doc.hooks[event].length) delete doc.hooks[event];
    }
  }
  return changed ? `${JSON.stringify(doc, null, 2)}\n` : text;
}

export async function diagnoseRelayClients({ homeDir, env = process.env, executables = {}, platform = process.platform } = {}) {
  const { access } = await import('node:fs/promises');
  const result = {};
  for (const client of SUPPORTED) {
    const config = clientConfigPaths({ client, homeDir, env });
    const command = executables[client] ?? (client === 'claude' ? 'claude' : client === 'codex' ? 'codex' : client === 'cursor' ? 'cursor' : client === 'copilot' ? 'copilot' : 'opencode');
    let available = false;
    const pathValue = env.PATH ?? env.Path ?? '';
    const extensions = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((extension) => extension.toLowerCase())] : [''];
    const commandHasExtension = path.extname(command) !== '';
    const candidates = path.isAbsolute(command)
      ? [command]
      : pathValue.split(path.delimiter).flatMap((entry) => (commandHasExtension ? [path.join(entry, command)] : extensions.map((extension) => path.join(entry, `${command}${extension}`))));
    for (const candidate of candidates) { try { await access(candidate); available = true; break; } catch {} }
    result[client] = { executable: command, available, configPaths: config };
  }
  return result;
}
