import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, link, lstat, mkdir, open, readdir, readFile, readlink, rename, rmdir, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, isDeepStrictEqual } from 'node:util';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { hashContent, readMachineRecord } from '../engine/records.mjs';
import { assertNoLinks, localCosmic, mindKeyFor } from '../engine/service/paths.mjs';
import { ownershipRecord, planRegistration, queryRegistration } from '../engine/service/install.mjs';
import { clientConfigPaths, RELAY_CLIENTS } from '../engine/relay/config.mjs';
import { applyShortcuts, shortcutPlan } from '../engine/shortcuts.mjs';
import { loadAdapters, resolveAdapterPaths } from '../engine/discovery.mjs';
import { protectLocalFile } from '../engine/service/security.mjs';
import { planClientOwnership } from '../engine/rebrand-clients.mjs';

export const version = '3.0.0-onem1nd';
export const idempotent = true;
const LEGACY = 'hivem1nd'; // Compatibility: locate the pre-rebrand installation and its generated entries.
const LEGACY_SERVICE = `${LEGACY}-service`;
const LEGACY_SERVER = `${LEGACY}-relay`;
const exec = promisify(execFile);
const kitDefault = fileURLToPath(new URL('../', import.meta.url));
const active = new Map();
const exists = async file => (await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) !== null;
const bytes = async file => { await assertNoLinks(file); return readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); };
const json = async file => { const value = await bytes(file); return value ? JSON.parse(value) : null; };
const digest = value => value === null ? null : hashContent(value);

function conflict(file) {
  throw Object.assign(new Error(`The upgrade found changed or conflicting data at ${file}; the original was retained.`), { code: 'MIGRATION_CONFLICT' });
}

function cosmicFor({ cosmicPath, platform, env, homeDir }) {
  const localEnv = { ...env };
  if (platform === 'win32' && !localEnv.LOCALAPPDATA) localEnv.LOCALAPPDATA = path.join(homeDir, 'AppData', 'Local');
  return path.resolve(cosmicPath ?? localCosmic({ platform, env: localEnv, home: homeDir }));
}

function samePath(left, right, platform) {
  const normalize = value => platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function publish(file, content, protect) {
  await assertNoLinks(file);
  const current = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (current && (!current.isFile() || current.nlink !== 1)) conflict(file);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.onem1nd-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await protect(temporary);
    await handle.writeFile(content);
    await handle.sync();
    if (process.platform !== 'win32') await chmod(temporary, 0o600 | (current?.mode & 0o100));
  } finally { await handle.close(); }
  try { await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function copyVerified(source, destination, expected, protect, temporary) {
  const handle = await open(temporary, 'wx', 0o600);
  await handle.close();
  try {
    await protect(temporary);
    await copyFile(source, temporary);
    await chmod(temporary, expected.mode);
    await protect(temporary);
    if (process.platform !== 'win32') await chmod(temporary, 0o600 | (expected.mode & 0o100));
    if (digest(await bytes(temporary)) !== expected.sha256) conflict(source);
    const timestamps = await lstat(source);
    await utimes(temporary, timestamps.atime, timestamps.mtime);
    // An interrupted copy is never published as a partial destination file.
    await link(temporary, destination);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function inventory(root) {
  if (!await exists(root)) return null;
  await assertNoLinks(root);
  const result = [];
  async function walk(directory, relative = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) conflict(file);
      if (stat.isDirectory()) { result.push({ path: name, directory: true, mode: stat.mode }); await walk(file, name); }
      else result.push({ path: name, sha256: hashContent(await readFile(file)), mode: stat.mode });
    }
  }
  await walk(root);
  return result;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function pathRewriter(moves, platform) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternPath = value => {
    const drive = /^([A-Za-z]):(?=[\\/])/.exec(value);
    const body = (drive ? value.slice(2) : value).split(/[\\/]/).map(escape).join(String.raw`[\\/]`);
    return drive ? `(?:${drive[1]}:)?${body}` : body;
  };
  return value => {
    let result = value;
    for (const { source, destination } of [...moves].sort((a, b) => b.source.length - a.source.length)) {
      // JSON and shell renderings of a generated path need the same relocation.
      for (const [oldPath, newPath] of [[source, destination], [source.replaceAll('\\', '\\\\'), destination.replaceAll('\\', '\\\\')], [patternPath(source), patternPath(destination)]]) {
        let offset = 0;
        while (true) {
          const index = platform === 'win32' ? result.toLowerCase().indexOf(oldPath.toLowerCase(), offset) : result.indexOf(oldPath, offset);
          if (index < 0) break;
          const tail = result.slice(index + oldPath.length);
          if (!tail || /^[\\/\s"')]/.test(tail) || tail.startsWith(String.raw`[\\/]`) || /^\.[ \r\n]/.test(tail)) {
            result = result.slice(0, index) + newPath + tail; offset = index + newPath.length;
          } else offset = index + oldPath.length;
        }
      }
    }
    return result;
  };
}

function generated(value, rewrite) {
  if (typeof value === 'string') {
    const kept = [];
    const stable = new RegExp(`${LEGACY.toUpperCase()}_[A-Z_]+|${LEGACY}-[a-z0-9-]+-v[0-9]+|x-${LEGACY}-[a-z0-9-]+|${LEGACY}-started-sessions|\\.${LEGACY}(?=[/\\\\])`, 'g');
    let text = rewrite(value);
    for (const file of rewrite.keepPaths ?? []) for (const rendered of [file, file.replaceAll('\\', '\\\\')]) {
      text = text.split(rendered).join(`\u0001${kept.length}\u0002`); kept.push(rendered);
    }
    text = text.replace(stable, match => { kept.push(match); return `\u0001${kept.length - 1}\u0002`; });
    return text.replaceAll(LEGACY.toUpperCase(), 'ONEM1ND').replaceAll(LEGACY, 'onem1nd').replace(/\u0001(\d+)\u0002/g, (_, index) => kept[index]);
  }
  if (Array.isArray(value)) return value.map(item => generated(item, rewrite));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key === LEGACY_SERVER ? 'onem1nd-relay' : key, generated(item, rewrite)]));
  return value;
}

function parseObject(text) {
  const errors = [];
  const value = parseJsonc(text || '{}', errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object') throw new Error('The generated client configuration is invalid.');
  return value;
}

function scriptEntry(value) {
  const text = JSON.stringify(value);
  return value && typeof value === 'object' && ('command' in value || 'args' in value)
    && /cli[\\/]+index\.mjs/.test(text.replaceAll('\\\\', '\\')) && /relay/.test(text);
}

function visit(value, fn, keys = []) {
  fn(value, keys);
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, fn, [...keys, Array.isArray(value) ? Number(key) : key]);
}

function ownedValues(state) {
  const values = [];
  for (const entry of state.entries) {
    if (entry.kind === 'mcp' && state.client === 'codex') continue;
    const before = entry.before ? parseObject(Buffer.from(entry.before, 'base64').toString()) : {};
    const after = parseObject(Buffer.from(entry.after, 'base64').toString());
    const previous = new Set();
    visit(before, value => previous.add(JSON.stringify(value)));
    visit(after, (value, keys) => {
      if ((scriptEntry(value) || typeof value === 'string' && value.startsWith('command(regex:node ')) && !previous.has(JSON.stringify(value))) values.push({ value, keys });
    });
  }
  return values;
}

function rewriteJson(text, owned, rewrite) {
  const document = parseObject(text);
  const matches = (candidate, value) => isDeepStrictEqual(candidate, value)
    || scriptEntry(candidate) && scriptEntry(value) && ['command', 'args', 'type'].every(key => isDeepStrictEqual(candidate[key], value[key]));
  const sameRoute = (left, right) => left.length === right.length && left.every((key, index) => typeof key === 'number' ? typeof right[index] === 'number' : key === right[index]);
  const nodes = [];
  visit(document, (value, keys) => nodes.push({ value, keys }));
  let output = text;
  const edit = (keys, value) => { output = applyEdits(output, modify(output, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })); };
  const handled = [];
  visit(document, (value, keys) => {
    if (handled.some(parent => parent.every((key, index) => keys[index] === key))) return;
    const candidates = owned.filter(candidate => sameRoute(candidate.keys, keys) && matches(candidate.value, value));
    if (!candidates.length) return;
    if (candidates.some(candidate => nodes.filter(node => sameRoute(candidate.keys, node.keys) && matches(candidate.value, node.value)).length !== 1)) conflict('ambiguous generated client entry');
    const target = scriptEntry(value) ? { ...value,
      ...(value.command === undefined ? {} : { command: Array.isArray(value.command) ? value.command.map(rewrite.executable) : rewrite.executable(value.command) }),
      ...(value.args === undefined ? {} : { args: value.args.map(rewrite.executable) }),
    } : rewrite.executable(value);
    if (keys.at(-1) === LEGACY_SERVER) {
      const nextKeys = [...keys.slice(0, -1), 'onem1nd-relay'];
      let existing = document;
      for (const key of nextKeys) existing = existing?.[key];
      if (existing !== undefined && !isDeepStrictEqual(existing, target)) conflict('onem1nd-relay');
      edit(nextKeys, target);
      edit(keys, undefined);
    } else if (!isDeepStrictEqual(value, target)) edit(keys, target);
    handled.push(keys);
  });
  return output;
}

function rewriteToml(text, state, rewrite) {
  const document = text.trim() ? parseToml(text) : {};
  const server = document.mcp_servers?.[LEGACY_SERVER];
  if (!server) return text;
  const owned = state.entries.some(entry => {
    if (entry.kind !== 'mcp') return false;
    const after = parseToml(Buffer.from(entry.after, 'base64').toString());
    const before = entry.before ? parseToml(Buffer.from(entry.before, 'base64').toString()) : {};
    const installed = after.mcp_servers?.[LEGACY_SERVER];
    return installed && ['command', 'args'].every(key => isDeepStrictEqual(installed[key], server[key]))
      && !isDeepStrictEqual(before.mcp_servers?.[LEGACY_SERVER], installed);
  });
  if (!owned || !scriptEntry(server)) return text;
  if (document.mcp_servers?.['onem1nd-relay']) conflict('Codex onem1nd-relay');
  const header = new RegExp(`^[ \\t]*\\[mcp_servers\\.(?:"${LEGACY_SERVER}"|${LEGACY_SERVER})\\][ \\t]*$`, 'm').exec(text);
  if (!header) conflict('Codex managed table');
  const start = header.index, bodyStart = start + header[0].length;
  const next = /^\s*\[[^\]]+\]/m.exec(text.slice(bodyStart));
  const end = next ? bodyStart + next.index : text.length;
  let block = text.slice(start, end).replace(LEGACY_SERVER, 'onem1nd-relay');
  // Only executable fields belong to the generator; opaque user fields retain their bytes.
  for (const key of ['command', 'args']) {
    const intended = Array.isArray(server[key]) ? server[key].map(rewrite.executable) : rewrite.executable(server[key]);
    if (isDeepStrictEqual(intended, server[key])) continue;
    const match = new RegExp(`^[ \\t]*${key}[ \\t]*=`, 'm').exec(block);
    if (!match) conflict('Codex executable fields');
    let limit = block.indexOf('\n', match.index);
    for (;;) {
      if (limit < 0) limit = block.length;
      let complete = false;
      try { complete = isDeepStrictEqual(parseToml(block.slice(match.index, limit))[key], server[key]); } catch { /* Continue through a multiline array. */ }
      if (complete) { block = block.slice(0, match.index) + `${key} = ${JSON.stringify(intended)}` + block.slice(limit); break; }
      if (limit === block.length) conflict('Codex executable fields');
      limit = block.indexOf('\n', limit + 1);
    }
  }
  const marker = `# ${LEGACY.toUpperCase()} Relay managed server`;
  const prefix = text.slice(0, start).replace(new RegExp(`${marker}(\\r?\\n[ \\t]*)$`), '# ONEM1ND Relay managed server$1');
  const result = prefix + block + text.slice(end);
  const table = new RegExp(`(^[ \\t]*\\[mcp_servers\\.)(?:"${LEGACY_SERVER}"|'${LEGACY_SERVER}'|${LEGACY_SERVER})(?=[.\\]])`, 'gm');
  return result.replace(table, '$1onem1nd-relay');
}

async function planAgents(context) {
  const { state, rewrite, stage, options } = context;
  const minds = new Set([state.mindPath, ...(state.mindPaths ?? []), options.mindPath].filter(Boolean).map(rewrite));
  for (const mindPath of minds) {
    const machines = path.join(mindPath, 'user', 'machines');
    for (const name of await readdir(machines).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!name.endsWith('.md') || name.endsWith('.report.md')) continue;
      const hostname = name.slice(0, -3);
      const { record } = await readMachineRecord(mindPath, hostname);
      if (!record) continue;
      const managed = {};
      for (const [oldFile, expected] of Object.entries(record.managedFiles)) {
        const file = rewrite(oldFile), content = await bytes(file);
        managed[file] = expected;
        if (!content || hashContent(content) !== expected) continue;
        if (/\.(md|mdc)$/i.test(file) && !inside(path.join(mindPath, 'user'), file)) {
          const next = Buffer.from(generated(content.toString('utf8'), rewrite));
          const target = path.join(path.dirname(file), path.basename(file).replaceAll(LEGACY, 'onem1nd'));
          await stage(target, next);
          if (target !== file) { await stage(file, null); delete managed[file]; }
          managed[target] = hashContent(next);
        }
      }
      record.mind = rewrite(record.mind);
      const adapters = await loadAdapters({ kitPath: options.kitPath });
      for (const attached of record.agents) {
        const adapter = adapters.find(item => item.id === attached.name);
        if (!adapter) continue;
        const target = resolveAdapterPaths(adapter, { homeDir: options.homeDir, env: options.env }).rulesPath;
        const content = await bytes(target);
        if (!content) continue;
        const oldMinds = [mindPath, ...state.moves.filter(move => move.destination === mindPath).map(move => move.source)];
        let text = content.toString();
        for (const oldMind of oldMinds) {
          const line = `${LEGACY.toUpperCase()}: the mind is at ${oldMind}. Read ${path.join(oldMind, 'rules.md')} first, then the role or command asked for.`;
          text = text.split(/(?<=\n)/).map(part => part.replace(/\r?\n$/, '') === line ? part.replace(line, generated(line, rewrite)) : part).join('');
        }
        if (text !== content.toString()) await stage(target, Buffer.from(text));
      }
      record.managedFiles = managed;
      const machineFile = path.join(machines, name);
      const machineBytes = await bytes(machineFile);
      await stage(machineFile, Buffer.from(machineBytes.toString().replace(/^mind:[^\r\n]*/m, `mind: ${record.mind}`)));
      await stage(machineFile.replace(/\.md$/, '.managed.json'), Buffer.from(`${JSON.stringify(managed, null, 2)}\n`));
    }
    const settings = await json(path.join(mindPath, 'user', 'gui', 'content.json'));
    if (settings?.preferences) {
      const p = settings.preferences, file = path.join(mindPath, 'user', 'preferences.md'), content = await bytes(file);
      const marker = `${LEGACY.toUpperCase()} Settings preferences`;
      const block = `<!-- ${marker} -->\nAddress style: ${p.addressStyle}\nKeep existing preferences first: ${p.keepExistingPreferencesFirst ? 'yes' : 'no'}\nCheck for updates: ${p.updateChecks}\n\n${p.additionalInstructions}\n<!-- /${marker} -->\n`;
      if (content?.toString().includes(block)) await stage(file, Buffer.from(content.toString().replace(block, block.replaceAll(marker, 'ONEM1ND Settings preferences'))));
    }
  }
  for (const client of RELAY_CLIENTS) {
    const paths = clientConfigPaths({ client, homeDir: options.homeDir, env: options.env });
    const receiptPath = `${paths.mcp}.relay-owned.json`, receipt = await json(receiptPath);
    if (!receipt || receipt.client !== client || !Array.isArray(receipt.entries)) continue;
    const owned = ownedValues(receipt);
    const transform = (text, kind) => client === 'codex' && kind === 'mcp' ? rewriteToml(text, receipt, rewrite) : rewriteJson(text, owned, rewrite);
    for (const kind of ['mcp', 'hooks']) {
      if (!paths[kind]) continue;
      const current = await bytes(paths[kind]);
      if (current) await stage(paths[kind], Buffer.from(transform(current.toString(), kind)));
    }
    const next = { ...receipt, mindPath: rewrite(receipt.mindPath), entries: receipt.entries.map(entry => ({ ...entry,
      ...(entry.mindPath ? { mindPath: rewrite(entry.mindPath) } : {}),
      before: entry.before === null ? null : Buffer.from(transform(Buffer.from(entry.before, 'base64').toString(), entry.kind)).toString('base64'),
      after: Buffer.from(transform(Buffer.from(entry.after, 'base64').toString(), entry.kind)).toString('base64'),
    })) };
    await stage(receiptPath, Buffer.from(`${JSON.stringify(next)}\n`));
  }
}

async function migrateRegistrations(context) {
  const { state, options, save, rewrite, stage, flush, run } = context;
  for (const item of state.registrations) {
    const current = item.current;
    const query = options.queryRegistration ?? ((plan, expected) => queryRegistration({ ...plan, platform: options.platform, file: plan.file ?? plan.path }, { current: expected }));
    if (!item.plan) {
      if (hashContent(current.body) !== current.digest) conflict(current.path);
      const actual = await query(current, current);
      if (actual.present && (actual.digest !== (current.actualDigest ?? current.digest) || actual.executable !== current.executable || !isDeepStrictEqual(actual.arguments, current.arguments))) conflict(current.path);
      const name = current.name.replaceAll(LEGACY.toUpperCase(), 'ONEM1ND').replaceAll(LEGACY, 'onem1nd');
      const configuredMind = current.arguments[current.arguments.indexOf('--mind-path') + 1];
      if (!configuredMind) conflict(current.path);
      item.plan = { ...planRegistration({ platform: options.platform, name, label: name, unitName: name,
        nodePath: options.nodePath ?? rewrite(current.executable), cliPath: path.join(rewrite(options.kitPath), 'cli', 'index.mjs'),
        mindPath: rewrite(configuredMind), workingDirectory: rewrite(options.kitPath), localDirectory: path.dirname(rewrite(item.file)),
        home: options.homeDir, configHome: options.env.XDG_CONFIG_HOME,
        sid: current.body.match(/<UserId>([^<]+)<\/UserId>/)?.[1], uid: current.uid ?? options.uid }),
        name, installationId: current.installationId };
      await save();
    }
    const plan = item.plan;
    if (!item.installed) {
      const actual = await query(plan, plan);
      if (actual.present && !item.creationAuthorized) conflict(plan.file);
      if (actual.present && !(actual.matchesPlan || actual.digest === (plan.actualDigest ?? plan.digest) && actual.executable === plan.executable && isDeepStrictEqual(actual.arguments, plan.arguments))) conflict(plan.file);
      if (!actual.present) {
        const existing = await bytes(plan.file);
        const copied = state.moves.flatMap(move => (move.inventory ?? []).map(entry => ({ file: path.join(move.destination, entry.path), ...entry }))).find(entry => entry.file === plan.file);
        if (existing && !item.creationAuthorized && digest(existing) !== copied?.sha256) conflict(plan.file);
        item.creationAuthorized = true; await save();
        await stage(plan.file, options.platform === 'win32' ? Buffer.from(`\uFEFF${plan.body}`, 'utf16le') : Buffer.from(plan.body));
        await flush();
        if (options.platform === 'win32') await run(['schtasks.exe', '/Create', '/XML', plan.file, '/TN', plan.name]);
        else if (options.platform === 'darwin') await run(['launchctl', 'bootstrap', `gui/${current.uid ?? options.uid ?? process.getuid?.()}`, plan.file]);
        else { await run(['systemctl', '--user', 'daemon-reload']); await run(['systemctl', '--user', 'enable', plan.name]); }
      }
      const verified = await query(plan, plan);
      if (!verified.present || !(verified.matchesPlan || verified.digest === plan.digest && verified.executable === plan.executable && isDeepStrictEqual(verified.arguments, plan.arguments))) throw new Error('The new login registration could not be verified.');
      plan.actualDigest = verified.digest;
      item.installed = true;
      await save();
    }
    if (!item.removed) {
      const actual = await query(current, current);
      if (options.platform === 'linux' && item.removalAuthorized && !await exists(current.path)) {
        await run(['systemctl', '--user', 'daemon-reload']);
        if ((await query(current, current)).present) conflict(current.path);
        item.removed = true; await save();
      }
      else if (actual.present) {
        if (actual.digest !== (current.actualDigest ?? current.digest) || actual.executable !== current.executable || !isDeepStrictEqual(actual.arguments, current.arguments)) conflict(current.path);
        item.removalAuthorized = true; await save();
        if (options.platform === 'win32') await run(['schtasks.exe', '/Delete', '/TN', current.name, '/F']);
        else if (options.platform === 'darwin') await run(['launchctl', 'bootout', `gui/${current.uid ?? options.uid ?? process.getuid?.()}`, current.path]);
        else await run(['systemctl', '--user', 'disable', '--now', current.name]);
        if (options.platform !== 'win32') {
          const content = await bytes(current.path);
          if (content && digest(content) !== current.digest) conflict(current.path);
          if (content) { await stage(current.path, null); await flush(); }
          if (options.platform === 'linux') await run(['systemctl', '--user', 'daemon-reload']);
        }
        if ((await query(current, current)).present) throw new Error('The old login registration is still present.');
      }
      item.removed = true;
      await save();
    }
    await stage(rewrite(item.file), Buffer.from(`${JSON.stringify(ownershipRecord({ ...plan, installationId: current.installationId }), null, 2)}\n`));
    if (current.path !== plan.file && !inside(state.legacyServiceRoot, current.path)) {
      const content = await bytes(current.path);
      if (content && digest(content) === current.digest) await stage(current.path, null);
    }
  }
}

/** Same-version upgrade of 3.0.0; explicit context also makes fault tests hermetic. */
export async function migrate(input = {}) {
  const env = input.env ?? process.env, home = input.homeDir ?? os.homedir(), platform = input.platform ?? process.platform;
  const cosmic = cosmicFor({ cosmicPath: input.cosmicPath, platform, env, homeDir: home });
  if (active.has(cosmic)) return active.get(cosmic);
  const work = (async () => {
    const checkpoint = await json(path.join(cosmic, '.onem1nd-upgrade.json'));
    if (checkpoint?.complete) return { migrated: false, mindPath: checkpoint.mindPath, relocatedPaths: checkpoint.moves, version };
    const roots = [LEGACY, '.m1nd'].map(name => path.join(cosmic, name)).filter(root => !input.mindPath || samePath(input.mindPath, root, platform) || samePath(input.mindPath, path.join(cosmic, 'onem1nd'), platform));
    let relevant = (await Promise.all(roots.map(exists))).some(Boolean);
    const serviceRoot = path.join(cosmic, LEGACY_SERVICE);
    const serviceMind = input.mindPath && !samePath(input.mindPath, path.join(cosmic, 'onem1nd'), platform) ? input.mindPath : null;
    const selectedServiceRoot = serviceMind ? path.join(serviceRoot, mindKeyFor(serviceMind, platform)) : serviceRoot;
    if (!relevant && await exists(selectedServiceRoot)) {
      for (const entry of await inventory(selectedServiceRoot)) {
        if (!entry.path.endsWith('/config.json')) continue;
        const config = await json(path.join(selectedServiceRoot, entry.path));
        if (!serviceMind || samePath(config.mindPath, serviceMind, platform)) { relevant = true; break; }
      }
    }
    if (!relevant && !checkpoint) return { migrated: false, version };
    const lock = path.join(cosmic, '.onem1nd-upgrade.lock'), nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const deadline = Date.now() + 60000;
    for (;;) {
      await assertNoLinks(lock);
      const candidate = `${lock}.${nonce}`;
      try {
        await writeFile(candidate, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 });
        try { await link(candidate, lock); } finally { await unlink(candidate); }
        break;
      }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const holder = await json(lock);
        try { process.kill(holder.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') { await unlink(lock); continue; } throw error; }
        if (Date.now() >= deadline) throw new Error('Another ONEM1ND upgrade is still running.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await runMigration(input); }
    finally { if ((await json(lock))?.nonce === nonce) await unlink(lock); }
  })();
  active.set(cosmic, work);
  try { return await work; } finally { active.delete(cosmic); }
}

async function runMigration(input) {
  const options = { platform: process.platform, env: process.env, homeDir: os.homedir(), kitPath: kitDefault, ...input };
  options.homeDir ??= os.homedir();
  options.env ??= process.env;
  options.platform ??= process.platform;
  options.protectFile ??= protectLocalFile;
  const cosmic = cosmicFor(options);
  const checkpoint = path.join(cosmic, '.onem1nd-upgrade.json');
  let state = await json(checkpoint);
  if (state?.complete) return { migrated: false, mindPath: state.mindPath, relocatedPaths: state.moves, version };
  const legacyRoots = [path.join(cosmic, LEGACY), path.join(cosmic, '.m1nd')];
  const legacyServiceRoot = path.join(cosmic, LEGACY_SERVICE);
  if (!state && !(await Promise.all([...legacyRoots, legacyServiceRoot].map(exists))).some(Boolean)) return { migrated: false, version };
  const run = options.run ?? (async ([file, ...args]) => { await exec(file, args, { windowsHide: true, shell: false, timeout: 20000 }); });
  const save = async () => { await publish(checkpoint, `${JSON.stringify(state, null, 2)}\n`, options.protectFile); };
  if (!state) {
    const roots = [];
    for (const root of legacyRoots) if (await exists(root)) roots.push(root);
    if (roots.length > 1) conflict(cosmic);
    const source = roots[0], mindPath = source ? path.join(cosmic, 'onem1nd') : input.mindPath;
    state = { version, mindPath, mindPaths: [], legacyServiceRoot, moves: [], registrations: [], writes: [], symlinks: [], phases: [] };
    if (source) state.moves.push({ source, destination: mindPath });
    const selectedServiceRoot = legacyServiceRoot;
    const serviceInventory = await inventory(selectedServiceRoot);
    if (serviceInventory) {
      const configs = serviceInventory.filter(entry => entry.path.endsWith('/config.json'));
      for (const entry of configs) {
        const configFile = path.join(selectedServiceRoot, entry.path), config = await json(configFile);
        if (!config?.mindPath || !config.machine) conflict(configFile);
        const ownershipFile = path.join(path.dirname(configFile), 'registration.json'), current = await json(ownershipFile);
        if (current) state.registrations.push({ file: ownershipFile, current });
        const { stopConfiguredService } = await import('../engine/service/service.mjs');
        const stopped = await (options.stopService ?? stopConfiguredService)({ ...options, mindPath: config.mindPath, hostname: config.machine, serviceDirectoryName: LEGACY_SERVICE });
        if (stopped.absent) state.staleLeases = true;
        const oldKey = mindKeyFor(config.mindPath, options.platform);
        const newMind = source && samePath(config.mindPath, source, options.platform) ? mindPath : config.mindPath;
        state.mindPaths.push(newMind);
        state.mindPath ??= newMind;
        const newKey = mindKeyFor(newMind, options.platform);
        state.moves.push({ source: path.join(legacyServiceRoot, oldKey), destination: path.join(cosmic, 'onem1nd-service', newKey) });
        const originRoot = path.join(cosmic, `${LEGACY}-origin`, oldKey);
        if (await exists(originRoot)) state.moves.push({ source: originRoot, destination: path.join(cosmic, 'onem1nd-origin', newKey) });
      }
      // Files at the service root are leases, not records; shutdown must remove them.
      for (const entry of ['active.json', 'service.lock']) {
        if (await exists(path.join(legacyServiceRoot, entry)) && !state.staleLeases) conflict(path.join(legacyServiceRoot, entry));
      }
    }
    state.moves = state.moves.filter((move, index, all) => all.findIndex(item => item.source === move.source) === index);
    if (!state.moves.length) return { migrated: false, version };
    for (const move of state.moves) move.inventory = await inventory(move.source);
    await save();
  }
  const rewrite = pathRewriter(state.moves, options.platform);
  rewrite.keepPaths = [rewrite(options.kitPath), options.nodePath ?? process.execPath];
  const cliPath = path.join(rewrite(options.kitPath), 'cli', 'index.mjs');
  rewrite.executable = value => {
    const text = rewrite(value);
    if (text.startsWith('command(regex:node ')) {
      const drive = /^([A-Za-z]):(?=[\\/])/.exec(cliPath);
      const body = (drive ? cliPath.slice(2) : cliPath).split(/[\\/]/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`[\\/]`);
      const pattern = drive ? `(?:${drive[1]}:)?${body}` : body;
      return text.replace(/^command\(regex:node \S+ relay /, () => `command(regex:node ${pattern} relay `);
    }
    if (/(?:^|[\\/])cli[\\/]index\.mjs$/i.test(text)) return cliPath;
    return text.replace(/(["'])([^"'\r\n]*[\\/]cli[\\/]index\.mjs)\1/g, (_, quote) => `${quote}${cliPath}${quote}`);
  };
  const stage = async (file, after) => {
    const before = await bytes(file);
    if (digest(before) === digest(after)) return;
    const existing = state.writes.find(item => item.file === file && !item.done);
    if (existing) { if (existing.after === (after?.toString('base64') ?? null)) return; conflict(file); }
    state.writes.push({ file, before: digest(before), after: after?.toString('base64') ?? null });
  };
  const flush = async () => {
    await save();
    for (const item of state.writes.filter(item => !item.done)) {
      const current = await bytes(item.file), target = item.after === null ? null : Buffer.from(item.after, 'base64');
      if (digest(current) !== digest(target)) {
        if (digest(current) !== item.before) conflict(item.file);
        if (target === null) await unlink(item.file);
        else await publish(item.file, target, options.protectFile);
      }
      item.done = true;
      await save();
      await options.afterWrite?.(item.file);
    }
    for (const item of (state.symlinks ?? []).filter(item => !item.done)) {
      const current = await lstat(item.file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current) {
        if (!current.isSymbolicLink() || await readlink(item.file) !== item.target) conflict(item.file);
        await unlink(item.file);
      }
      item.done = true; await save();
    }
  };
  if (state.staleLeases && !state.phases.includes('leases')) {
    for (const name of ['active.json', 'service.lock']) if (await exists(path.join(legacyServiceRoot, name))) await stage(path.join(legacyServiceRoot, name), null);
    state.phases.push('leases');
  }
  for (const move of state.moves) for (const temporary of Object.values(move.copyTemps ?? {})) {
    if (!inside(move.destination, temporary) || !path.basename(temporary).startsWith('.onem1nd-copy-')) conflict(temporary);
    const stat = await lstat(temporary).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink()) conflict(temporary);
      await unlink(temporary);
    }
  }
  await flush();
  for (const move of state.moves) {
    if (move.copied) continue;
    if (!isDeepStrictEqual(await inventory(move.source), move.inventory)) conflict(move.source);
    await assertNoLinks(move.destination);
    await mkdir(move.destination, { recursive: true });
    for (const entry of move.inventory ?? []) {
      const source = path.join(move.source, entry.path), destination = path.join(move.destination, entry.path);
      await assertNoLinks(destination);
      if (entry.directory) await mkdir(destination, { recursive: true, mode: 0o700 });
      else {
        await mkdir(path.dirname(destination), { recursive: true });
        if (!await exists(destination)) {
          move.copyTemps ??= {};
          if (!move.copyTemps[entry.path]) {
            move.copyTemps[entry.path] = path.join(path.dirname(destination), `.onem1nd-copy-${randomUUID()}.tmp`);
            await save();
          }
          await copyVerified(source, destination, entry, options.protectFile, move.copyTemps[entry.path]);
        }
        if (digest(await bytes(destination)) !== entry.sha256) conflict(destination);
      }
      await options.afterCopy?.(destination);
    }
    if (!isDeepStrictEqual(await inventory(move.source), move.inventory)) conflict(move.source);
    move.copied = true;
    await save();
  }
  const context = { state, options, rewrite, stage, flush, save, run };
  if (!state.phases.includes('agents')) {
    const transformClient = (receipt, text, kind) => receipt.client === 'codex' && kind === 'mcp'
      ? rewriteToml(text, receipt, rewrite) : rewriteJson(text, ownedValues(receipt), rewrite);
    await planClientOwnership({ ...context, transformClient, rebrandGenerated: text => generated(text, rewrite) });
    await planAgents(context); state.phases.push('agents'); await flush();
  }
  if (!state.phases.includes('service')) {
    for (const move of state.moves.filter(item => inside(legacyServiceRoot, item.source))) {
      for (const entry of move.inventory ?? []) {
        if (!entry.path.endsWith('/config.json')) continue;
        const file = path.join(move.destination, entry.path), config = await json(file);
        const next = { ...config, mindPath: rewrite(config.mindPath), stagingPath: rewrite(config.stagingPath), origin: { ...config.origin, path: rewrite(config.origin.path) } };
        await stage(file, Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
      }
    }
    await flush();
    await migrateRegistrations(context);
    state.phases.push('service');
    await flush();
  }
  if (!state.phases.includes('shortcuts')) {
    for (const mind of new Set([state.mindPath, ...(state.mindPaths ?? []), input.mindPath].filter(Boolean).map(rewrite))) {
      const machine = options.hostname ?? os.hostname(), { record } = await readMachineRecord(mind, machine);
      if (!record) continue;
      const managed = { ...record.managedFiles };
      const startMenuRoot = options.shortcutFolders?.startMenu ?? (options.env.APPDATA && path.join(options.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
      for (const [file, expected] of Object.entries(managed)) {
        if (path.basename(file).toLowerCase() !== `${LEGACY}.lnk` || digest(await bytes(file)) !== expected) continue;
        const folders = startMenuRoot && samePath(path.dirname(file), startMenuRoot, options.platform)
          ? { startMenu: startMenuRoot } : { desktop: path.dirname(file) };
        const plan = shortcutPlan({ platform: options.platform, mindPath: mind, kitPath: rewrite(options.kitPath), nodePath: options.nodePath ?? process.execPath,
          cosmicPath: options.cosmicPath ?? '', folders, env: options.env, message: 'ONEM1ND could not start.', description: 'ONEM1ND' });
        for (const item of plan) {
          state.shortcutTasks ??= [];
          let task = state.shortcutTasks.find(candidate => candidate.source === file);
          if (!task) {
            if (await exists(item.file)) conflict(item.file);
            task = { source: file, destination: item.file, temporary: `${item.file}.onem1nd-${randomUUID()}.lnk` };
            state.shortcutTasks.push(task); await save();
          }
          const current = await bytes(task.temporary);
          const temporaryManaged = current ? { [task.temporary]: hashContent(current) } : {};
          const applied = await applyShortcuts([{ ...item, file: task.temporary }], { managed: temporaryManaged, run: options.shortcutRun, env: options.env });
          if (applied.some(result => result.status !== 'applied')) conflict(file);
          const shortcut = await bytes(task.temporary);
          await stage(task.destination, shortcut);
          await stage(task.temporary, null);
          managed[task.destination] = hashContent(shortcut);
        }
        await stage(file, null); delete managed[file];
      }
      await stage(path.join(mind, 'user', 'machines', `${machine}.managed.json`), Buffer.from(`${JSON.stringify(managed, null, 2)}\n`));
    }
    state.phases.push('shortcuts'); await flush();
  }
  if (!state.phases.includes('shims')) {
    const prefixes = new Set([...(options.shimDirectories ?? []), options.env.APPDATA && path.join(options.env.APPDATA, 'npm'),
      options.env.npm_config_prefix, options.env.NPM_CONFIG_PREFIX, options.env.npm_config_prefix && path.join(options.env.npm_config_prefix, 'bin'),
      ...(options.env.PATH ?? options.env.Path ?? '').split(options.platform === 'win32' ? ';' : ':'), path.dirname(options.nodePath ?? process.execPath)].filter(Boolean));
    for (const prefix of prefixes) for (const extension of ['', '.cmd', '.ps1']) {
      const file = path.join(prefix, `${LEGACY}${extension}`);
      const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat?.isSymbolicLink()) {
        await assertNoLinks(path.dirname(file));
        const target = await readlink(file), resolved = path.resolve(path.dirname(file), target);
        if (new RegExp(`node_modules[\\\\/]${LEGACY}[\\\\/]cli[\\\\/]index\\.mjs$`).test(resolved)) state.symlinks.push({ file, target });
        continue;
      }
      const content = await bytes(file);
      if (content && new RegExp(`node_modules[\\\\/]${LEGACY}[\\\\/]cli[\\\\/]index\\.mjs`).test(content.toString())) await stage(file, null);
    }
    state.phases.push('shims'); await flush();
  }
  // Only the unchanged source inventory is retired, after every replacement is durable.
  for (const move of state.moves) {
    if (move.retired) continue;
    if (!inside(cosmic, move.source) || !inside(cosmic, move.destination) || move.source === cosmic) conflict(move.source);
    if (await exists(move.source)) {
      const remaining = await inventory(move.source);
      for (const entry of remaining) if (!move.inventory.some(original => isDeepStrictEqual(original, entry))) conflict(move.source);
      // Verify every destination again, accepting only journaled transformations.
      for (const directory of [move.destination, ...move.inventory.filter(item => item.directory).map(item => path.join(move.destination, item.path))]) {
        await assertNoLinks(directory);
        const stat = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat?.isDirectory()) conflict(directory);
      }
      for (const entry of move.inventory.filter(item => !item.directory)) {
        const destination = path.join(move.destination, entry.path);
        const write = state.writes.findLast(item => item.file === destination);
        const expected = write ? digest(write.after === null ? null : Buffer.from(write.after, 'base64')) : entry.sha256;
        if (digest(await bytes(destination)) !== expected) conflict(destination);
      }
      move.retiring = true; await save();
      for (const entry of remaining.filter(item => !item.directory)) await unlink(path.join(move.source, entry.path));
      for (const entry of remaining.filter(item => item.directory).sort((a, b) => b.path.length - a.path.length)) await rmdir(path.join(move.source, entry.path));
      await rmdir(move.source);
    }
    move.retired = true; await save();
  }
  state.complete = true; await save();
  return { migrated: true, mindPath: state.mindPath, relocatedPaths: state.moves, version };
}
