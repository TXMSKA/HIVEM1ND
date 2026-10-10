import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { CURSOR_STOP_LOOP_LIMIT } from './cursor-wake.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { applyEdits, modify as modifyJsonc, parse as parseJsonc } from 'jsonc-parser';

const OWNED_SERVER = 'hivem1nd-relay';
const MARKER = '# HIVEM1ND Relay managed server';
// A Cursor stop hook reads the mind through OneDrive and measured 5 to 11 s on Windows.
const CURSOR_HOOK_TIMEOUT = 30;
const SUPPORTED = new Set(['claude', 'codex', 'cursor', 'opencode', 'copilot', 'antigravity']);

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
  // A direct node command: node reads the payload bytes from stdin itself, so
  // no PowerShell wrapper or encoded command is needed (antivirus behavior
  // rules kill encoded PowerShell command lines).
  return args.map((arg) => shellArg(arg, 'win32')).join(' ');
}

function hookHandler(options) {
  const { client, event, mindPath, kitPath, unit, nodePath, platform } = options;
  if (client === 'claude') {
    const args = [path.join(kitPath, 'cli', 'index.mjs'), 'relay', 'hook', '--client', client, '--event', event, '--mind-path', mindPath];
    return { type: 'command', command: nodePath, args, timeout: event === 'PreToolUse' ? 130 : 5 };
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Antigravity CLI settings.json holds permission rules, not an MCP server; the
// generic "mcp" slot of the config API carries that single file. A plain
// command(...) rule cannot match a Windows command line with backslashes, so
// the rules use the documented regex form: each whitespace-separated token is an
// anchored regular expression, and the tokens end at the mind path plus one
// token for the remaining arguments, which allows only the kit's relay read and
// relay send for that mind. A line Antigravity cannot split into commands
// (substitution, redirection, PowerShell or Command Prompt syntax) is matched
// against the whole rule, where a trailing wildcard would also accept a chained
// or substituted command, so the final token refuses shell control characters.
// It is a negated class, which Go RE2 and JavaScript read the same way.
const ANTIGRAVITY_ACTIONS = ['read', 'send'];
const ANTIGRAVITY_CLI_TOKEN_END = String.raw`cli[\\/]index\.mjs`;
const ANTIGRAVITY_ARGS_TOKEN = '[^;&|<>()$`{}\\r\\n]*';
const ANTIGRAVITY_LEGACY_ARGS_TOKEN = '.*';
const ANTIGRAVITY_OWNED_RULE = new RegExp(String.raw`^command\(regex:node (\S+) relay (?:read|send) --mind-path (\S+) (?:${escapeRegex(ANTIGRAVITY_LEGACY_ARGS_TOKEN)}|${escapeRegex(ANTIGRAVITY_ARGS_TOKEN)})\)$`);

function antigravityPathPattern(value) {
  const drive = /^([A-Za-z]):(?=[\\/])/.exec(value);
  const body = (drive ? value.slice(2) : value).split(/[\\/]/)
    .map(escapeRegex).join(String.raw`[\\/]`);
  return drive ? `(?:${drive[1]}:)?${body}` : body;
}

function antigravityRules({ kitPath, mindPath }, argsToken = ANTIGRAVITY_ARGS_TOKEN) {
  const cliPath = path.join(kitPath, 'cli', 'index.mjs');
  for (const value of [cliPath, mindPath]) {
    if (/[\s"'()]/.test(value)) throw new Error('Antigravity permission rules need kit and mind paths without whitespace, quotes or parentheses.');
  }
  const cli = `${antigravityPathPattern(kitPath)}${String.raw`[\\/]`}${ANTIGRAVITY_CLI_TOKEN_END}`;
  const mind = antigravityPathPattern(mindPath);
  return ANTIGRAVITY_ACTIONS.map((action) => `command(regex:node ${cli} relay ${action} --mind-path ${mind} ${argsToken})`);
}

function antigravityAllowList(text) {
  const document = parseJsoncObject(text.trim() ? text : '{}\n', 'Antigravity settings');
  const permissions = document.permissions;
  if (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions))) {
    throw Object.assign(new Error('Antigravity permissions must be an object; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' });
  }
  if (permissions?.allow !== undefined && !Array.isArray(permissions.allow)) {
    throw Object.assign(new Error('Antigravity permissions.allow must be an array; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' });
  }
  return permissions?.allow;
}

function antigravityMerge(text, options) {
  const initial = text.trim() ? text : '{}\n';
  const allow = antigravityAllowList(initial) ?? [];
  const legacy = antigravityRules(options, ANTIGRAVITY_LEGACY_ARGS_TOKEN);
  const kept = allow.filter((rule) => !legacy.includes(rule));
  const missing = antigravityRules(options).filter((rule) => !kept.includes(rule));
  if (kept.length === allow.length && !missing.length) return initial;
  return editJsonc(initial, ['permissions', 'allow'], [...kept, ...missing]);
}

function antigravityRemove(text, mindPath) {
  if (!text.trim()) return text;
  const allow = antigravityAllowList(text);
  if (!allow) return text;
  const wanted = mindPath === undefined ? undefined : path.resolve(mindPath);
  const kept = allow.filter((rule) => {
    const match = typeof rule === 'string' ? ANTIGRAVITY_OWNED_RULE.exec(rule) : null;
    return !match || !match[1].endsWith(ANTIGRAVITY_CLI_TOKEN_END)
      || (wanted !== undefined && match[2] !== antigravityPathPattern(wanted));
  });
  if (kept.length === allow.length) return text;
  if (kept.length) return editJsonc(text, ['permissions', 'allow'], kept);
  let next = editJsonc(text, ['permissions', 'allow'], undefined);
  if (!Object.keys(parseJsoncObject(next, 'Antigravity settings').permissions ?? {}).length) next = editJsonc(next, ['permissions'], undefined);
  return next;
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
      if (owned.length) for (const item of owned) Object.assign(item, { command, timeout: CURSOR_HOOK_TIMEOUT });
      else existing.push({ command, timeout: CURSOR_HOOK_TIMEOUT });
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
  if (client === 'antigravity') return { mcp: antigravityMerge(existing.mcp ?? '', { kitPath, mindPath }) };
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
  if (client === 'antigravity') {
    const root = path.join(home, '.gemini', 'antigravity-cli');
    return { mcp: path.join(root, 'settings.json'), mcpRoot: root };
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

// Brings the Relay-owned entries of an existing hooks file up to date in place. Foreign entries stay as they are, and an event
// with no owned entry gets none, since a person may have removed it on purpose.
function refreshOwnedHooks(text, options) {
  if (!text.trim()) return text;
  let document;
  try { document = JSON.parse(text); }
  catch { throw Object.assign(new Error('Client hooks configuration contains invalid JSON; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  const { client } = options;
  let changed = false;
  const assign = (target, values) => {
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(target[key]) === JSON.stringify(value)) continue;
      target[key] = value;
      changed = true;
    }
  };
  for (const [event, entries] of Object.entries(document?.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    const intended = hookHandler({ ...options, event });
    if (client === 'cursor') {
      for (const item of entries) {
        if (isOwnedHookCommand(item?.command, client, event)) assign(item, { command: intended.command, timeout: CURSOR_HOOK_TIMEOUT, ...(event === 'stop' ? { loop_limit: CURSOR_STOP_LOOP_LIMIT } : {}) });
      }
    } else {
      for (const group of entries) {
        for (const handler of group?.hooks ?? []) {
          if (isOwnedHookHandler(handler, client, event)) assign(handler, client === 'claude' ? { type: intended.type, command: intended.command, args: intended.args } : { command: intended.command });
        }
      }
    }
  }
  return changed ? `${JSON.stringify(document, null, 2)}\n` : text;
}

export async function refreshRelayHooks({ client, homeDir, env = process.env, kitPath, mindPath, nodePath = process.execPath, platform = process.platform } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  if (homeDir !== undefined) homeDir = path.resolve(safeString(homeDir, 'homeDir'));
  const targets = clientConfigPaths({ client, homeDir, env });
  if (!targets.hooks) return { client, changed: [] };
  const existing = await readRegular(targets.hooks);
  const next = refreshOwnedHooks(existing, { client, kitPath: path.resolve(safeString(kitPath, 'kitPath')),
    mindPath: path.resolve(safeString(mindPath, 'mindPath')), nodePath: path.resolve(safeString(nodePath, 'nodePath')), platform });
  if (next === existing) return { client, changed: [] };
  await atomicConfigWrite(targets.hooks, next, targets.hooksRoot);
  return { client, changed: [targets.hooks] };
}

export async function unconfigureRelayClient({ client, homeDir, env = process.env, mindPath } = {}) {
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
  } else if (client === 'antigravity') {
    nextMcp = antigravityRemove(mcpText, mindPath);
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

// The hivem1nd-relay MCP server of a client, or undefined when its config has none. Antigravity has no
// MCP slot, so its entry is the allow rules and it is read apart.
async function relayMcpEntry({ client, homeDir, env }) {
  const configText = await readRegular(clientConfigPaths({ client, homeDir, env }).mcp);
  if (!configText.trim()) return undefined;
  if (client === 'codex') {
    let parsed;
    try { parsed = parseToml(configText); }
    catch { throw Object.assign(new Error('Codex config.toml is invalid TOML; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
    return parsed.mcp_servers?.[OWNED_SERVER];
  }
  if (client === 'opencode') return parseJsoncObject(configText, 'OpenCode config').mcp?.[OWNED_SERVER];
  let document;
  try { document = JSON.parse(configText); }
  catch { throw Object.assign(new Error('Client MCP configuration contains invalid JSON; no files were changed.'), { code: 'RELAY_CONFIG_INVALID' }); }
  return document?.mcpServers?.[OWNED_SERVER];
}

async function antigravityOwnedRules({ homeDir, env }) {
  const configText = await readRegular(clientConfigPaths({ client: 'antigravity', homeDir, env }).mcp);
  return (configText.trim() ? antigravityAllowList(configText) ?? [] : [])
    .map((rule) => (typeof rule === 'string' ? ANTIGRAVITY_OWNED_RULE.exec(rule) : null))
    .filter((match) => match !== null && match[1].endsWith(ANTIGRAVITY_CLI_TOKEN_END));
}

// A client counts as configured when its own config already holds the Relay entry: the
// hivem1nd-relay MCP server or, for Antigravity, which has no MCP slot, the allow rules of the mind.
// Nothing else in that config is compared, so a hand-edited hook never makes it unconfigured.
export async function relayEntryPresent({ client, homeDir, env = process.env, mindPath } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  if (client === 'antigravity') {
    const wanted = mindPath === undefined ? undefined : antigravityPathPattern(path.resolve(mindPath));
    return (await antigravityOwnedRules({ homeDir, env })).some((match) => wanted === undefined || match[2] === wanted);
  }
  return (await relayMcpEntry({ client, homeDir, env })) !== undefined;
}

// True when the Relay entry of a client runs the CLI copy inside this mind. An entry that runs another
// kit, and anything else in the client config, is not this mind's to remove.
export async function relayEntryPointsAt({ client, homeDir, env = process.env, mindPath } = {}) {
  if (!SUPPORTED.has(client)) throw new Error(`Unsupported Relay client: ${client}`);
  const mind = path.resolve(mindPath);
  if (client === 'antigravity') {
    const expected = `${antigravityPathPattern(mind)}${String.raw`[\\/]`}${ANTIGRAVITY_CLI_TOKEN_END}`;
    return (await antigravityOwnedRules({ homeDir, env })).some((match) => match[1] === expected);
  }
  const entry = await relayMcpEntry({ client, homeDir, env });
  const items = Array.isArray(entry?.args) ? entry.args : Array.isArray(entry?.command) ? entry.command : [];
  const cli = path.join(mind, 'cli', 'index.mjs');
  const same = (value) => (process.platform === 'win32' ? value.toLowerCase() === cli.toLowerCase() : value === cli);
  return items.some((item) => typeof item === 'string' && path.isAbsolute(item) && same(path.resolve(item)));
}

export const RELAY_CLIENTS = [...SUPPORTED];

// Install and update join every available client to Relay. A client with no Relay entry is
// configured; a client that has one keeps everything a person edited, and only its Relay-owned hook entries are brought up to date.
export async function ensureRelayClients({ homeDir, env = process.env, kitPath, mindPath, executables, platform, nodePath } = {}) {
  const found = await diagnoseRelayClients({ homeDir, env, executables, platform });
  const results = [];
  for (const [client, info] of Object.entries(found)) {
    if (!info.available) {
      results.push({ client, status: 'not-available' });
      continue;
    }
    try {
      if (await relayEntryPresent({ client, homeDir, env, mindPath })) {
        const refreshed = await refreshRelayHooks({ client, homeDir, env, kitPath, mindPath, nodePath, platform });
        results.push(refreshed.changed.length ? { client, status: 'refreshed', restart: true } : { client, status: 'already-configured' });
        continue;
      }
      await configureRelayClient({ client, homeDir, env, kitPath, mindPath, nodePath, platform });
      results.push({ client, status: 'configured', restart: true });
    } catch (error) {
      results.push({ client, status: 'failed', reason: error.message });
    }
  }
  return results;
}

const CURSOR_GATE_EVENTS = ['beforeShellExecution', 'preToolUse'];
const PLATFORM_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

async function readJsonOrNull(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

function gateHooks(document) {
  return CURSOR_GATE_EVENTS.flatMap((event) => (Array.isArray(document?.hooks?.[event]) ? document.hooks[event] : [])
    .map((item) => ({ event, command: typeof item?.command === 'string' ? item.command.slice(0, 160) : null })));
}

// Plugin hooks live at <plugin>/hooks/hooks.json below the cache; the walk is bounded and never follows a link.
async function pluginHookFiles(root) {
  const found = [];
  async function walk(directory, depth) {
    if (depth > 6 || found.length >= 64) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const next = path.join(directory, entry.name);
      if (entry.name === 'hooks') {
        const file = path.join(next, 'hooks.json');
        if (existsSync(file)) found.push(file);
      } else await walk(next, depth + 1);
    }
  }
  await walk(root, 0);
  return found;
}

// A hook that gates shell calls or tool use can reject every call of a chat, so the ones Relay did not write are listed, and a
// plugin that says it does not support this platform is called out, since its hook can still run and refuse.
async function cursorForeignHooks({ homeDir, platform }) {
  const home = path.resolve(homeDir ?? os.homedir());
  const foreignHooks = [], warnings = [];
  const userFile = path.join(home, '.cursor', 'hooks.json');
  for (const hook of gateHooks(await readJsonOrNull(userFile))) foreignHooks.push({ source: 'user', file: userFile, ...hook });
  for (const file of await pluginHookFiles(path.join(home, '.cursor', 'plugins', 'cache'))) {
    const hooks = gateHooks(await readJsonOrNull(file));
    if (!hooks.length) continue;
    const manifest = await readJsonOrNull(path.join(path.dirname(file), '..', '.cursor-plugin', 'plugin.json'));
    const plugin = typeof manifest?.name === 'string' ? manifest.name : path.basename(path.dirname(path.dirname(file)));
    for (const hook of hooks) foreignHooks.push({ source: 'plugin', plugin, file, ...hook });
    const name = PLATFORM_NAMES[platform];
    if (name && new RegExp(`not\\s+supported\\s+on\\s+${name}`, 'i').test(`${manifest?.description ?? ''}`)) {
      warnings.push(`Cursor plugin ${plugin} says it is not supported on ${name} and still declares ${hooks.map((hook) => hook.event).join(', ')} in ${file}; it can reject shell calls here.`);
    }
  }
  return { foreignHooks, warnings };
}

export async function diagnoseRelayClients({ homeDir, env = process.env, executables = {}, platform = process.platform, mindPath } = {}) {
  const { access } = await import('node:fs/promises');
  const result = {};
  for (const client of SUPPORTED) {
    const config = clientConfigPaths({ client, homeDir, env });
    const command = executables[client] ?? (client === 'claude' ? 'claude' : client === 'codex' ? 'codex' : client === 'cursor' ? 'cursor' : client === 'copilot' ? 'copilot' : client === 'antigravity' ? 'agy' : 'opencode');
    let available = false;
    const pathValue = env.PATH ?? env.Path ?? '';
    const extensions = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((extension) => extension.toLowerCase())] : [''];
    const commandHasExtension = path.extname(command) !== '';
    const candidates = path.isAbsolute(command)
      ? [command]
      : pathValue.split(path.delimiter).flatMap((entry) => (commandHasExtension ? [path.join(entry, command)] : extensions.map((extension) => path.join(entry, `${command}${extension}`))));
    for (const candidate of candidates) { try { await access(candidate); available = true; break; } catch {} }
    // null when the client config cannot be read or parsed, which configure would refuse too.
    const configured = await relayEntryPresent({ client, homeDir, env, mindPath }).catch(() => null);
    result[client] = { executable: command, available, configured, configPaths: config,
      ...(client === 'cursor' ? await cursorForeignHooks({ homeDir, platform }) : {}) };
  }
  return result;
}
