import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashContent } from './records.mjs';
import { assertNoLinks } from './service/paths.mjs';

const LEGACY = 'hivem1nd'; // Compatibility: identify generated asset names and rule lines from existing client ownership receipts.
const CONFIG_KINDS = new Set(['mcp', 'hooks']);
const decode = value => value === null ? null : Buffer.from(value, 'base64');
const encode = value => value === null ? null : value.toString('base64');

async function readOwnedFile(file) {
  await assertNoLinks(file);
  const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('The configuration ownership path is not a regular private file.');
  return readFile(file);
}

function addedRuleLines(entries) {
  const lines = new Set();
  const prefix = `${LEGACY.toUpperCase()}: the mind is at `;
  for (const entry of entries.filter(item => item.kind === 'rule' && item.after !== null)) {
    const before = new Set((decode(entry.before)?.toString('utf8') ?? '').split(/\r?\n/));
    for (const line of decode(entry.after).toString('utf8').split(/\r?\n/)) {
      if (line.startsWith(prefix) && line.endsWith(' first, then the role or command asked for.') && !before.has(line)) lines.add(line);
    }
  }
  return lines;
}

function rewriteRule(content, lines, rebrand) {
  return content.replace(/([^\r\n]*)(\r\n|\n|$)/g, (whole, line, ending) => lines.has(line) ? `${rebrand(line)}${ending}` : whole);
}

function assetDestination(file) {
  return path.join(path.dirname(file), path.basename(file).replaceAll(LEGACY, 'onem1nd'));
}

function standaloneRule(file) {
  return new RegExp(`^(?:${LEGACY}|onem1nd)(?:\\.mdc|\\.instructions\\.md)$`, 'i').test(path.basename(file));
}

function ownershipConflict(file) {
  throw Object.assign(new Error(`The upgrade found conflicting client ownership at ${file}; the original was retained.`), { code: 'MIGRATION_CONFLICT' });
}

// Settings owns separate receipts from the standalone Relay installer. Keeping
// their original before/after chain lets Disconnect restore the person's bytes.
export async function planClientOwnership({ state, rewrite, stage, transformClient, rebrandGenerated }) {
  if (typeof transformClient !== 'function' || typeof rebrandGenerated !== 'function') throw new TypeError('Client migration needs its generated-content transformers.');
  const ownershipFiles = new Set();
  for (const move of state.moves) {
    const relative = path.relative(state.legacyServiceRoot, move.source);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    for (const entry of move.inventory ?? []) {
      if (!entry.directory && path.basename(entry.path) === 'client-configuration.json') ownershipFiles.add(path.join(move.destination, entry.path));
    }
  }
  for (const file of ownershipFiles) {
    const original = await readOwnedFile(file);
    if (!original) continue;
    const record = JSON.parse(original);
    if (record.format !== 'hivem1nd-client-configuration-v1' || !record.clients || typeof record.clients !== 'object') ownershipConflict(file); // Compatibility: the persisted Settings ownership format keeps existing configuration receipts readable.
    for (const [client, connection] of Object.entries(record.clients)) {
      if (!Array.isArray(connection.entries) || !connection.assetHashes || typeof connection.assetHashes !== 'object') ownershipConflict(file);
      const configEntries = connection.entries.filter(entry => CONFIG_KINDS.has(entry.kind) && entry.after !== null);
      const receipt = { client, entries: configEntries.map(entry => ({ ...entry })) };
      const rules = addedRuleLines(connection.entries);
      const rebrandAsset = (text, kind, file) => kind === 'rule' && !standaloneRule(file) ? rewriteRule(text, rules, rebrandGenerated) : rebrandGenerated(text);
      const rebrandBytes = (content, kind, file) => {
        const text = content.toString('utf8');
        return Buffer.from(text).equals(content) ? Buffer.from(rebrandAsset(text, kind, file)) : content;
      };
      const assets = new Map();
      const renamed = new Map();
      for (const [oldPath, expected] of Object.entries(connection.assetHashes)) {
        const currentPath = rewrite(oldPath), current = await readOwnedFile(currentPath);
        const entries = connection.entries.filter(entry => entry.path === oldPath && !CONFIG_KINDS.has(entry.kind) && entry.kind !== 'permission');
        const kind = entries.at(-1)?.kind;
        const ownedAfter = entries.map(entry => decode(entry.after)).filter(Boolean);
        const snapshot = ownedAfter.find(value => hashContent(value) === expected);
        let expectedAfter = expected;
        let transformed = null;
        if (current && hashContent(current) === expected) {
          transformed = rebrandBytes(current, kind, oldPath);
          expectedAfter = hashContent(transformed);
        } else if (kind === 'rule' && current) {
          const next = rebrandBytes(current, kind, oldPath);
          if (!next.equals(current)) transformed = next;
          if (snapshot) expectedAfter = hashContent(rebrandBytes(snapshot, kind, oldPath));
        } else if (snapshot && current) {
          const next = rebrandBytes(snapshot, kind, oldPath);
          if (next.equals(current)) expectedAfter = hashContent(next);
        }
        let destination = currentPath;
        if (transformed) {
          destination = assetDestination(currentPath);
          if (destination !== currentPath) {
            const existing = await readOwnedFile(destination);
            if (existing && !existing.equals(transformed)) ownershipConflict(destination);
          }
          await stage(destination, transformed);
          if (destination !== currentPath) await stage(currentPath, null);
        }
        renamed.set(oldPath, destination);
        assets.set(destination, expectedAfter);
      }
      for (const kind of new Set(configEntries.map(entry => entry.kind))) {
        const entries = configEntries.filter(entry => entry.kind === kind);
        for (const target of new Set(entries.map(entry => rewrite(entry.path)))) {
          const current = await readOwnedFile(target);
          if (!current) continue;
          const next = Buffer.from(transformClient(receipt, current.toString('utf8'), kind, rewrite));
          if (!next.equals(current)) await stage(target, next);
        }
      }
      const ownedSnapshots = new Map();
      for (const entry of connection.entries) {
        if (CONFIG_KINDS.has(entry.kind)) {
          const transform = value => value === null ? null : Buffer.from(transformClient(receipt, decode(value).toString('utf8'), entry.kind, rewrite));
          entry.before = encode(transform(entry.before));
          entry.after = encode(transform(entry.after));
        } else if (entry.kind !== 'permission') {
          const before = decode(entry.before), after = decode(entry.after);
          const key = `${entry.path}\0${entry.before}`;
          if (before && ownedSnapshots.has(key)) entry.before = ownedSnapshots.get(key);
          if (after) {
            const next = encode(rebrandBytes(after, entry.kind, entry.path));
            ownedSnapshots.set(`${entry.path}\0${entry.after}`, next);
            entry.after = next;
          }
        }
        entry.path = renamed.get(entry.path) ?? rewrite(entry.path);
        entry.root = rewrite(entry.root);
      }
      connection.assetHashes = Object.fromEntries(assets);
    }
    await stage(file, Buffer.from(`${JSON.stringify(record)}\n`));
  }
}
