// Void: the project a document belongs to, which is how it finds the agent to
// write to.
//
// A document belongs to the project whose repository holds it, when the project
// is named in routes.md and has a path in this machine's record, or to the
// project whose folder in the mind holds it (user/projects/<project>/). The
// narrowest folder wins. A document anywhere else belongs to no project.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// The "- item" lines under a "## title" heading.
function section(text, title) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (start === -1) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) items.push(item[1]);
  }
  return items;
}

// path.relative compares case-insensitively on Windows, as its file names are.
function inside(folder, file) {
  const relative = path.relative(folder, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function read(file) {
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

export async function projectOf(file, { mindPath, hostname }) {
  const user = path.join(mindPath, 'user');
  const machines = await readdir(path.join(user, 'machines')).catch(() => []);
  const record = machines.find((name) => name.toLowerCase() === `${hostname}.md`.toLowerCase());
  const projects = new Set(section(await read(path.join(user, 'routes.md')), 'Projects').map((item) => item.replace(/\s*\(.*\)\s*$/, '').trim()));
  const roots = [];
  if (record) {
    for (const item of section(await read(path.join(user, 'machines', record)), 'Paths')) {
      const at = item.indexOf(':');
      const name = at > 0 ? item.slice(0, at).trim() : '';
      if (projects.has(name)) roots.push({ project: name, root: path.resolve(item.slice(at + 1).trim()) });
    }
  }
  for (const entry of await readdir(path.join(user, 'projects'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) roots.push({ project: entry.name, root: path.join(user, 'projects', entry.name) });
  }
  const target = path.resolve(file);
  const holders = roots.filter(({ root }) => inside(root, target));
  holders.sort((a, b) => b.root.length - a.root.length);
  return holders[0]?.project ?? null;
}
