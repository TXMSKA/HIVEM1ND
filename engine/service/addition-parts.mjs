import path from 'node:path';
import { parseFrontmatter } from '../records.mjs';
import { CoreError, uuidV8, validateName } from './identity.mjs';

const POWERSHELL_RUNTIME = 'PowerShell';
export const interpreterRuntimes = {
  node: 'Node.js', npm: 'Node.js', npx: 'Node.js', python: 'Python', python3: 'Python',
  bash: 'Bash', sh: 'Bash', pwsh: POWERSHELL_RUNTIME, powershell: POWERSHELL_RUNTIME,
};
export const skillRuntimes = {
  none: null, python: interpreterRuntimes.python, node: interpreterRuntimes.node,
  'node.js': interpreterRuntimes.node, bash: interpreterRuntimes.bash, powershell: interpreterRuntimes.powershell,
};

export function additionPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f:]/.test(value)) {
    throw new CoreError(422, 'invalid_path', 'The source path is not a regular relative path.');
  }
  const parts = value.split('/');
  if (parts.length > 40 || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new CoreError(422, 'invalid_path', 'The source path is not a regular relative path.');
  }
  return value;
}

function scalar(value, fallback, limit) {
  let result = String(value ?? fallback).trim();
  if (/^(['"])[\s\S]*\1$/.test(result)) result = result.slice(1, -1);
  if (!result || result.length > limit || /[\x00-\x1f\x7f]/.test(result)) {
    throw new CoreError(422, 'invalid_source', 'A source name or description is invalid.');
  }
  return result;
}

function packageData(file) {
  try {
    const value = JSON.parse(file.text);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.name != null && typeof value.name !== 'string'
      || value.description != null && typeof value.description !== 'string') throw new Error('Invalid manifest');
    return value;
  }
  catch { throw new CoreError(422, 'invalid_source', 'A package manifest is invalid.'); }
}

export function recognizeAdditionParts(entries, { repository = false, name = 'repository' } = {}) {
  if (!Array.isArray(entries) || entries.length > 1024) throw new CoreError(413, 'addition_too_large', 'The source has too many files.');
  const seen = new Set();
  let total = 0;
  const files = entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new CoreError(422, 'invalid_source', 'The source inventory is invalid.');
    const relative = additionPath(entry.path);
    if (entry.kind !== 'file' || !Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 16777216
      || entry.text !== null && typeof entry.text !== 'string') throw new CoreError(422, 'invalid_source', 'The source inventory is invalid.');
    if (seen.has(relative.toLowerCase())) throw new CoreError(422, 'invalid_path', 'The source contains colliding paths.');
    seen.add(relative.toLowerCase());
    total += entry.bytes;
    if (total > 67108864) throw new CoreError(413, 'addition_too_large', 'The source is too large.');
    if (entry.text !== null && Buffer.byteLength(entry.text, 'utf8') !== entry.bytes) {
      throw new CoreError(422, 'invalid_source', 'The source inventory does not match its bytes.');
    }
    return { ...entry, path: relative };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const result = [];
  const skillRoots = files.filter(file => path.posix.basename(file.path) === 'SKILL.md')
    .map(file => path.posix.dirname(file.path));
  const within = (file, root) => root === '.' || file.path.startsWith(root + '/');
  const requirements = root => {
    const names = new Set();
    for (const file of files.filter(item => within(item, root))) {
      if (/\.py$/i.test(file.path)) names.add('Python');
      if (/\.(?:js|mjs|cjs)$/i.test(file.path)) names.add('Node.js');
      if (/\.sh$/i.test(file.path)) names.add('Bash');
      if (/\.ps1$/i.test(file.path)) names.add(POWERSHELL_RUNTIME);
      if (/\.(?:exe|dll|so|dylib)$/i.test(file.path)) names.add('Native executable');
    }
    return [...names].sort();
  };
  const add = (kind, root, title, description) => {
    const itemName = scalar(title, name, 128);
    validateName(itemName, { label: 'addition name' });
    result.push({ id: uuidV8({ kind, path: root, name: itemName }), kind, name: itemName, title: itemName,
      description: scalar(description, itemName, 1000), path: root, supported: kind !== 'tool-server',
      blockedReason: kind === 'tool-server' ? 'after_3_0' : null, requirements: requirements(root) });
  };
  for (const file of files.filter(item => path.posix.basename(item.path) === 'SKILL.md')) {
    if (file.text === null) throw new CoreError(422, 'invalid_source', 'SKILL.md must be UTF-8 text.');
    const attributes = parseFrontmatter(file.text).attributes;
    const root = path.posix.dirname(file.path);
    add('skill', root, attributes.name ?? (root === '.' ? name : path.posix.basename(root)), attributes.description);
  }
  const docs = new Set();
  for (const file of files) {
    if (skillRoots.some(root => within(file, root))) continue;
    const parts = file.path.split('/');
    const index = parts.findIndex(part => ['docs', 'documentation', 'knowledge'].includes(part.toLowerCase()));
    if (index >= 0 && /\.(?:md|txt|rst|html|pdf|docx)$/i.test(file.path)) docs.add(parts.slice(0, index + 1).join('/'));
  }
  for (const root of [...docs].sort()) add('docs', root, path.posix.basename(root), 'Documentation');
  for (const file of files) {
    const base = path.posix.basename(file.path);
    if (file.text === null || !['package.json', 'mcp.json', '.mcp.json', 'tool-manifest.json'].includes(base)) continue;
    const manifest = packageData(file);
    const tool = base !== 'package.json' || manifest.mcpServers != null || manifest.mcp != null;
    if (tool) {
      const root = path.posix.dirname(file.path);
      const title = String(manifest.name ?? (root === '.' ? name : path.posix.basename(root))).replace(/^@[^/]+\//, '');
      if (!result.some(item => item.kind === 'tool-server' && item.path === root)) add('tool-server', root, title, manifest.description ?? 'Tool server');
    }
  }
  if (repository) add('repository', '.', name, 'Git repository');
  return result;
}

// The checkout folder names the pin by a short digest prefix: the owner-local root already sits deep under
// LOCALAPPDATA, and Git paths inside the checkout must stay within the Windows path limit.
export function repositoryCheckoutPath(local, id, digest) {
  return path.join(local, 'repositories', id, String(digest).slice(0, 16));
}
