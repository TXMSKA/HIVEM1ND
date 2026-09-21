import { lstat, readdir, readFile, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { discoverContent, loadAdapters, resolveAdapterPaths } from './discovery.mjs';
import {
  atomicWriteFile,
  hashContent,
  machineReportPath,
  parseFrontmatter,
  readMachineRecord,
  removeSymbolicLink,
  restoreSymbolicLink,
  serializeFrontmatter,
  unsafeDestinationReason,
  writeMachineRecord,
} from './records.mjs';
import { text } from './texts.mjs';

const KIT_EXCLUSIONS = new Set([
  '.agents', '.cache', '.codex', '.cursor', '.git', 'coverage', 'dist', 'node_modules', 'test', 'tests', 'tmp', 'user',
]);
const PRIVATE_INSTRUCTION_FILES = new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md']);
const ASSET_SECTIONS = ['roles', 'commands', 'features', 'knowledge'];
const MISSING_SNAPSHOT = { kind: 'missing', hash: null, content: null };

const REASON_KEYS = {
  'Two setup operations produce different content for this path.': 'reasonDifferentContent',
  'The rules path is a symbolic link or is not a regular file.': 'reasonRulesNotRegular',
  'The destination is a symbolic link or is not a regular file.': 'reasonDestinationNotRegular',
  'The HIVEM1ND-managed file was modified after installation.': 'reasonManagedFileModified',
  'An unowned file already exists at this path.': 'reasonUnownedFile',
  'Selected agents require different content at the same shared path.': 'reasonAgentsConflict',
};
const REASON_PREFIX_KEYS = [
  ['Path escapes the selected destination: ', 'reasonPathEscapes'],
  ['Destination root is a symbolic link: ', 'reasonDestinationRootSymlink'],
  ['Destination root is not a directory: ', 'reasonDestinationRootNotDirectory'],
  ['Destination component is a symbolic link: ', 'reasonDestinationComponentSymlink'],
  ['Destination component is not a directory: ', 'reasonDestinationComponentNotDirectory'],
];

function localizeReason(reason, language) {
  const exactKey = REASON_KEYS[reason];
  if (exactKey) return text(language, exactKey);
  const prefixMatch = REASON_PREFIX_KEYS.find(([prefix]) => reason.startsWith(prefix));
  if (!prefixMatch) return reason;
  const [prefix, key] = prefixMatch;
  return text(language, key, { path: reason.slice(prefix.length) });
}

export const OWNED_RULE_MODES = new Set(['cursor', 'copilot']);

export function autoRuleLine(mindPath) {
  return `HIVEM1ND: the mind is at ${mindPath}. Read ${path.join(mindPath, 'rules.md')} first, then the role or command asked for.`;
}

export async function installAgentAssets({
  kitPath,
  mindPath,
  homeDir,
  hostname,
  env = process.env,
  previewOnly = false,
  conflictChoices = {},
  language = 'en',
}) {
  requireAbsoluteDirectoryOption('kitPath', kitPath);
  requireAbsoluteDirectoryOption('mindPath', mindPath);
  requireAbsoluteDirectoryOption('homeDir', homeDir);
  if (!hostname) throw new Error('hostname is required');

  const { filePath: machinePath, record } = await readMachineRecord(mindPath, hostname);
  if (!record) throw new Error(`Machine record not found for ${hostname}`);
  const adapters = await loadAdapters({ kitPath });
  const agentPlan = await planAgentAssets({
    kitPath,
    mindPath,
    homeDir,
    env,
    adapters,
    agents: record.agents,
    excluded: record.excluded,
    managedFiles: record.managedFiles,
    keepExistingPreferences: record.keepExistingPreferences,
    language,
  });
  const kitPlan = await planKitCopy({
    kitPath,
    mindPath,
    managedFiles: record.managedFiles,
    excluded: record.excluded,
    language,
  });
  const plan = registerLinkConflicts(combinePlans(kitPlan, agentPlan), language);
  const unresolved = plan.conflicts.filter((conflict) => {
    const allowed = conflict.choices ?? ['keep', 'replace'];
    return !allowed.includes(conflictChoices[conflict.path]);
  });
  const result = {
    ...summarizeAgentPlan(agentPlan, language),
    baseFiles: kitPlan.items.map((item) => item.path),
    warnings: plan.warnings,
    conflicts: plan.conflicts.map((conflict) => ({
      path: conflict.path,
      reason: localizeReason(conflict.reason, language),
      choices: conflict.choices ?? ['keep', 'replace'],
      selection: conflictChoices[conflict.path] ?? conflict.selection ?? null,
      link: conflict.link === true,
    })),
  };
  if (previewOnly || unresolved.length > 0) return result;

  const applied = await applyInstallPlan(plan, conflictChoices);
  record.managedFiles = { ...record.managedFiles, ...applied.managedFiles };
  for (const conflict of plan.conflicts) {
    if (conflictChoices[conflict.path] === 'keep') delete record.managedFiles[conflict.path];
  }
  for (const item of applied.omitted) delete record.managedFiles[item.path];
  delete record.managedFiles[machinePath];
  await writeMachineRecord(mindPath, hostname, record);
  const report = {
    action: 'evolve',
    written: applied.files.length,
    omitted: applied.omitted,
    replacedLinks: applied.replacedLinks,
    kept: plan.conflicts
      .filter((conflict) => conflictChoices[conflict.path] === 'keep')
      .map((conflict) => ({ path: conflict.path, reason: localizeReason(conflict.reason, language) })),
    warnings: result.warnings,
  };
  const reportPath = await writeInstallReport({ mindPath, hostname, language, report });
  return {
    agents: result.agents.map((agent) => ({
      ...agent,
      files: agent.files.filter((filePath) => applied.files.includes(filePath)),
    })),
    baseFiles: result.baseFiles.filter((filePath) => applied.files.includes(filePath)),
    warnings: result.warnings,
    conflicts: [],
    omitted: applied.omitted,
    replacedLinks: applied.replacedLinks,
    reportPath,
  };
}

// One file per machine, replaced on every run, so what a run did outlives the window it ran in.
export async function writeInstallReport({ mindPath, hostname, language = 'en', report }) {
  const destination = machineReportPath(mindPath, hostname);
  const lines = [
    `machine: ${hostname}`,
    `date: ${reportDate()}`,
    `action: ${report.action}`,
    `written: ${report.written}`,
    `omitted: ${report.omitted.length}`,
    `unwritten: ${(report.unwritten ?? []).length}`,
    `links-replaced: ${report.replacedLinks.length}`,
  ];
  const sections = [
    ['reportOmitted', report.omitted.map((item) => `${item.path}: ${text(language, 'reportOmittedReason', { path: item.component })}`)],
    ['reportReplacedLinks', report.replacedLinks],
    ['reportKept', (report.kept ?? []).map((item) => `${item.path}: ${localizeReason(item.reason, language)}`)],
    ['reportUnwritten', report.unwritten ?? []],
    ['reportWarnings', report.warnings ?? []],
  ];
  for (const [key, values] of sections) {
    if (values.length === 0) continue;
    lines.push('', `## ${text(language, key)}`, ...values.map((value) => `- ${value}`));
  }
  await atomicWriteFile(destination, `${lines.join('\n')}\n`, { root: mindPath });
  return destination;
}

function reportDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export async function planAgentAssets({
  kitPath,
  mindPath,
  homeDir,
  env = process.env,
  adapters,
  agents,
  excluded = [],
  managedFiles = {},
  keepExistingPreferences = true,
  language = 'en',
}) {
  const available = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const excludedNames = new Set(excluded);
  const sourceAssets = await listInstallableAssets(installableAssetRoots(kitPath, mindPath), excludedNames);
  const items = [];
  const conflicts = [];
  const warnings = [...sourceAssets.warnings];
  const linkComponents = [];
  const agentFiles = new Map();

  for (const selected of agents ?? []) {
    const agentName = typeof selected === 'string' ? selected : selected.name;
    const mode = typeof selected === 'string' ? 'on-demand' : selected.mode;
    if (agentName === 'another') {
      warnings.push(text(language, 'warningNoAdapterAnother', { mind: mindPath }));
      continue;
    }
    const adapter = available.get(agentName);
    if (!adapter) {
      warnings.push(text(language, 'warningNoAdapter', { agent: agentName, mind: mindPath }));
      continue;
    }

    const resolved = resolveAdapterPaths(adapter, { homeDir, env });
    const owner = { id: adapter.id, label: adapter.displayName };
    const files = [];
    for (const asset of sourceAssets.assets) {
      const rendered = renderSkill(asset.mainContent, asset.name, adapter, mindPath);
      const skillRoot = path.join(resolved.skillsRoot, asset.name);
      const mainPath = path.join(skillRoot, adapter.skills.fileName);
      files.push(mainPath);
      await addPlannedFile({
        items,
        conflicts,
        linkComponents,
        destination: mainPath,
        content: rendered,
        root: resolved.skillsBase,
        kind: 'skill',
        managedHash: managedFiles[mainPath],
        agentName,
        owned: true,
        owner,
      });

      for (const support of asset.supportFiles) {
        const supportPath = path.join(skillRoot, support.relativePath);
        files.push(supportPath);
        await addPlannedFile({
          items,
          conflicts,
          linkComponents,
          destination: supportPath,
          content: support.content,
          root: resolved.skillsBase,
          kind: 'skill-support',
          managedHash: managedFiles[supportPath],
          agentName,
          owned: true,
          owner,
        });
      }
    }

    if (mode === 'auto') {
      if (!adapter.rules) {
        warnings.push(text(language, 'warningNoRulesFile', { agent: adapter.displayName }));
      } else {
        const rule = autoRuleLine(mindPath);
        const rulePlan = await planRuleFile(
          adapter,
          resolved.rulesPath,
          resolved.rulesBase,
          rule,
          managedFiles,
          agentName,
          keepExistingPreferences,
          owner,
          linkComponents,
        );
        files.push(resolved.rulesPath);
        mergePlanItem(items, conflicts, rulePlan);
      }
    }
    agentFiles.set(agentName, [...new Set(files)]);
  }

  return {
    items: deduplicatePlanItems(items, conflicts),
    conflicts: deduplicateConflicts(conflicts),
    warnings: [...new Set(warnings)],
    linkComponents,
    agentFiles,
    roots: [...new Set(items.map((item) => item.root))],
  };
}

export async function planKitCopy({ kitPath, mindPath, managedFiles = {}, excluded = [], language = 'en' }) {
  const sourceRoot = path.resolve(kitPath);
  const destinationRoot = path.resolve(mindPath);
  if (normalizePath(sourceRoot) === normalizePath(destinationRoot)) {
    return { items: [], conflicts: [], warnings: [] };
  }

  const items = [];
  const conflicts = [];
  const warnings = [];
  const linkComponents = [];
  const excludedNames = new Set(excluded);
  const nestedDestination = relativeChild(sourceRoot, destinationRoot);
  const packageJson = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const distributableRoots = new Set(['package.json', ...(packageJson.files ?? []).map(topLevelEntry).filter(Boolean)]);
  const owner = { id: 'mind', label: text(language, 'ownerMind') };
  await walk(sourceRoot, '');
  return { items, conflicts, warnings, linkComponents };

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const top = relativePath.split(path.sep)[0];
      const segments = relativePath.split(path.sep);
      if (!distributableRoots.has(top)
        || segments.some((segment) => KIT_EXCLUSIONS.has(segment))
        || excludedKnowledgePath(segments, excludedNames)
        || PRIVATE_INSTRUCTION_FILES.has(entry.name)
        || entry.name === '.env'
        || entry.name.startsWith('.env.')
        || (nestedDestination && (relativePath === nestedDestination || relativePath.startsWith(`${nestedDestination}${path.sep}`)))) continue;
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(text(language, 'warningSymlinkSkipped', { path: source }));
        continue;
      }
      if (entry.isDirectory()) {
        await walk(source, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        warnings.push(text(language, 'warningUnsupportedEntry', { path: source }));
        continue;
      }
      const destination = path.join(destinationRoot, relativePath);
      await addPlannedFile({
        items,
        conflicts,
        linkComponents,
        destination,
        content: await readFile(source),
        root: destinationRoot,
        kind: 'kit',
        managedHash: managedFiles[destination],
        owned: true,
        owner,
      });
    }
  }
}

export async function planDataFile({
  destination,
  content,
  root,
  managedHash,
  kind = 'mind',
  allowExisting = false,
  owned = true,
  language = 'en',
}) {
  const items = [];
  const conflicts = [];
  const linkComponents = [];
  await addPlannedFile({
    items,
    conflicts,
    linkComponents,
    destination,
    content,
    root,
    managedHash,
    kind,
    owned,
    allowExisting,
    owner: { id: 'mind', label: text(language, 'ownerMind') },
  });
  return { items, conflicts, warnings: [], linkComponents };
}

export async function applyInstallPlan(plan, conflictChoices = {}) {
  const selected = new Map(Object.entries(conflictChoices ?? {}));
  for (const conflict of plan.conflicts ?? []) {
    const choice = selected.get(conflict.path) ?? conflict.selection;
    const allowed = conflict.choices ?? ['keep', 'replace'];
    if (!allowed.includes(choice)) {
      throw new Error(`Conflict requires an explicit ${allowed.join(' or ')} choice: ${conflict.path}`);
    }
  }

  const linkConflicts = (plan.conflicts ?? []).filter((conflict) => conflict.link === true);
  const omittedComponents = new Set(linkConflicts
    .filter((conflict) => (selected.get(conflict.path) ?? conflict.selection) === 'omit')
    .map((conflict) => conflict.path));
  const omitted = (plan.items ?? [])
    .filter((item) => item.linkComponent && omittedComponents.has(item.linkComponent))
    .map((item) => ({ path: item.path, component: item.linkComponent }));
  const removedLinks = [];
  // The links go first: every file behind one is planned as a creation at a path that only
  // becomes writable once the link is gone.
  for (const conflict of linkConflicts) {
    if (omittedComponents.has(conflict.path)) continue;
    const removed = await removeSymbolicLink(conflict.root ?? path.dirname(conflict.path), conflict.path);
    if (removed) removedLinks.push(removed);
  }

  const currentByPath = new Map();
  for (const item of plan.items) {
    if (item.linkComponent && omittedComponents.has(item.linkComponent)) continue;
    if (!currentByPath.has(item.path)) {
      currentByPath.set(item.path, await currentSnapshot(item.path, true));
    }
    const snapshot = currentByPath.get(item.path);
    if (snapshot.hash !== item.currentHash || snapshot.kind !== item.currentKind) {
      throw new Error(`File changed after preview: ${item.path}`);
    }
  }

  const files = [];
  const managedFiles = {};
  const written = [];
  try {
    for (const item of plan.items) {
      if (item.linkComponent && omittedComponents.has(item.linkComponent)) continue;
      const conflict = (plan.conflicts ?? []).find((candidate) => candidate.path === item.path && candidate.link !== true);
      const choice = conflict ? selected.get(item.path) ?? conflict.selection : null;
      if (choice === 'keep') continue;
      if (item.action !== 'unchanged') {
        await atomicWriteFile(item.path, item.content, { root: item.root });
        written.push({ item, snapshot: currentByPath.get(item.path) });
        files.push(item.path);
      }
      if (item.owned) managedFiles[item.path] = hashContent(item.content);
    }
  } catch (error) {
    const rollbackErrors = await rollbackWrites(written, removedLinks);
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Install failed and one or more files could not be restored');
    }
    throw error;
  }
  return { files, managedFiles, omitted, replacedLinks: removedLinks.map((link) => link.path) };
}

export function publicPreview(plan, language = 'en') {
  return {
    files: plan.items.map((item) => ({ path: item.path, action: item.action, owner: item.owner })),
    warnings: [...(plan.warnings ?? [])],
    conflicts: (plan.conflicts ?? []).map((conflict) => ({
      path: conflict.path,
      reason: localizeReason(conflict.reason, language),
      choices: conflict.choices ?? ['keep', 'replace'],
      selection: conflict.selection ?? null,
      link: conflict.link === true,
    })),
  };
}

export function combinePlans(...plans) {
  const items = [];
  const conflicts = [];
  const warnings = [];
  const linkComponents = [];
  for (const plan of plans) {
    if (!plan) continue;
    for (const item of plan.items ?? []) {
      const existing = items.find((candidate) => candidate.path === item.path);
      if (!existing) items.push(item);
      else if (hashContent(existing.content) !== hashContent(item.content)) {
        conflicts.push({ path: item.path, reason: 'Two setup operations produce different content for this path.' });
      } else {
        existing.agentNames = [...new Set([...(existing.agentNames ?? []), ...(item.agentNames ?? [])])];
      }
    }
    conflicts.push(...(plan.conflicts ?? []));
    warnings.push(...(plan.warnings ?? []));
    linkComponents.push(...(plan.linkComponents ?? []));
  }
  return { items, conflicts: deduplicateConflicts(conflicts), warnings: [...new Set(warnings)], linkComponents };
}

// One conflict per link, not per file: a single junction can stand in front of every skill
// of an agent, and the choice is the same for all of them.
export function registerLinkConflicts(plan, language = 'en') {
  if (!plan.linkComponents?.length) return plan;
  const byPath = new Map();
  for (const component of plan.linkComponents) {
    if (!byPath.has(component.path)) byPath.set(component.path, { ...component, count: 0 });
    byPath.get(component.path).count += 1;
  }
  const conflicts = [...byPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((component) => ({
      path: component.path,
      reason: text(language, component.count === 1 ? 'reasonLinkComponentOne' : 'reasonLinkComponentOther', {
        count: component.count,
        path: component.path,
      }),
      choices: ['replace', 'omit'],
      selection: 'replace',
      link: true,
      root: component.root,
    }));
  return { ...plan, conflicts: [...plan.conflicts, ...conflicts] };
}

export function installableAssetRoots(kitPath, mindPath) {
  const kitRoot = { path: path.resolve(kitPath), scope: 'kit', sections: ASSET_SECTIONS, mirrorsKit: false };
  if (!mindPath || normalizePath(mindPath) === normalizePath(kitRoot.path)) return [kitRoot];
  const mind = path.resolve(mindPath);
  return [
    kitRoot,
    { path: mind, scope: 'mind', sections: ASSET_SECTIONS, mirrorsKit: true },
    // The private half installs the same four sections as the kit, so a role written for
    // this mind alone lives in user/roles and never sits in the published folder.
    { path: path.join(mind, 'user'), scope: 'mind', sections: ASSET_SECTIONS, mirrorsKit: false },
  ];
}

export async function listInstallableAssets(roots, excludedNames = new Set()) {
  const sources = typeof roots === 'string' ? installableAssetRoots(roots) : roots;
  const assets = [];
  const warnings = [];
  const keptByName = new Map();
  for (const root of sources) {
    for (const asset of await readRootAssets(root, excludedNames)) addAsset(asset, root);
  }
  return { assets: assets.sort((left, right) => left.name.localeCompare(right.name)), warnings };

  function addAsset(asset, root) {
    const kept = keptByName.get(asset.name);
    if (!kept) {
      keptByName.set(asset.name, { root, sourcePath: asset.sourcePath });
      assets.push(asset);
      return;
    }
    if (kept.root.scope === 'kit' && root.scope === 'kit') {
      throw new Error(`Duplicate installable command name "${asset.name}" in ${kept.sourcePath} and ${asset.sourcePath}.`);
    }
    // A mind that mirrors the kit holds the copy of every kit asset, and the copy is not a collision.
    const mirrored = root.mirrorsKit
      && kept.root.scope === 'kit'
      && path.relative(root.path, asset.sourcePath) === path.relative(kept.root.path, kept.sourcePath);
    if (!mirrored) warnings.push(assetCollisionWarning(asset.name, kept.sourcePath, asset.sourcePath));
  }
}

function assetCollisionWarning(name, keptSource, skippedSource) {
  return `${skippedSource}: the command "${name}" already installs from ${keptSource}; this file was skipped; renaming it lets it install.`;
}

async function readRootAssets(root, excludedNames) {
  const assets = [];
  for (const section of root.sections) {
    if (section === 'features') {
      for (const feature of await readFeatureEntries(path.join(root.path, 'features'))) {
        if (!isExcluded(excludedNames, 'feature', feature.name)) assets.push(feature);
      }
      continue;
    }
    if (section === 'knowledge') {
      const knowledgeDirectory = path.join(root.path, 'knowledge');
      if (!await isDirectory(knowledgeDirectory) || excludedNames.has('knowledge')) continue;
      for (const entry of await readdir(knowledgeDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || isExcluded(excludedNames, 'knowledge', entry.name)) continue;
        const moduleFeatures = path.join(knowledgeDirectory, entry.name, 'features');
        for (const feature of await readFeatureEntries(moduleFeatures)) assets.push(feature);
      }
      continue;
    }
    const directory = path.join(root.path, section);
    if (!await isDirectory(directory)) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.toLowerCase() === 'readme.md') continue;
      const sourcePath = path.join(directory, entry.name);
      const mainContent = await readFile(sourcePath, 'utf8');
      assets.push({
        name: skillName(mainContent, entry.name),
        type: section.slice(0, -1),
        mainContent,
        supportFiles: [],
        sourcePath,
      });
    }
  }
  return assets;
}

async function readFeatureEntries(directory) {
  if (!await isDirectory(directory)) return [];
  const features = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === 'readme.md' || entry.isSymbolicLink()) continue;
    const sourcePath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const mainContent = await readFile(sourcePath, 'utf8');
      features.push({
        name: skillName(mainContent, entry.name),
        type: 'feature',
        mainContent,
        supportFiles: [],
        sourcePath,
      });
    } else if (entry.isDirectory()) {
      const feature = await readFeatureDirectory(sourcePath, entry.name);
      if (feature) features.push(feature);
    }
  }
  return features;
}

export function renderSkill(content, name, adapter, mindPath) {
  const parsed = parseFrontmatter(String(content));
  const additions = name === 'consultant' && adapter.readOnly?.mode === 'frontmatter'
    ? adapter.readOnly.frontmatter
    : {};
  const rendered = serializeFrontmatter(parsed, {
    allowedKeys: adapter.skills.frontmatterKeys,
    additions,
  });
  return rendered.replaceAll('{{mind}}', mindPath);
}

function summarizeAgentPlan(plan, language = 'en') {
  return {
    agents: [...plan.agentFiles.entries()].map(([name, files]) => ({ name, files })),
    warnings: plan.warnings,
    conflicts: plan.conflicts.map((conflict) => ({
      path: conflict.path,
      reason: localizeReason(conflict.reason, language),
      choices: conflict.choices ?? ['keep', 'replace'],
      selection: conflict.selection ?? null,
      link: conflict.link === true,
    })),
  };
}

async function planRuleFile(adapter, destination, root, line, managedFiles, agentName, keepExistingPreferences, owner, linkComponents) {
  const unsafeReason = await unsafeDestinationReason(root, destination);
  const symlinkAncestor = symlinkComponentPath(unsafeReason);
  if (symlinkAncestor) {
    // Nothing is written through the link, so the file is planned as a creation for once the
    // link is gone. Reading through the link is safe, and it keeps the existing lines.
    const existing = (await currentSnapshot(destination, true)).content?.toString('utf8') ?? '';
    const withoutRule = removeExactLine(existing, line);
    const separator = withoutRule.length === 0 || withoutRule.endsWith('\n') ? '' : '\n';
    const merged = keepExistingPreferences
      ? `${withoutRule}${separator}${line}\n`
      : `${line}\n${withoutRule}`;
    const item = plannedItem(destination, merged, root, 'rule', MISSING_SNAPSHOT, 'create', false, agentName, owner);
    item.linkComponent = symlinkAncestor;
    linkComponents.push({ path: symlinkAncestor, root: path.resolve(root) });
    return { item, conflict: null };
  }
  if (unsafeReason) {
    const snapshot = await currentSnapshot(destination);
    return {
      item: plannedItem(destination, '', root, 'rule', snapshot, 'conflict', false, agentName, owner),
      conflict: { path: destination, reason: unsafeReason, choices: ['keep'] },
    };
  }
  if (OWNED_RULE_MODES.has(adapter.rules.mode)) {
    const scope = adapter.rules.mode === 'cursor' ? 'alwaysApply: true' : 'applyTo: "**"';
    const content = `---\ndescription: Loads HIVEM1ND before every request.\n${scope}\n---\n\n${line}\n`;
    return singlePlannedFile({
      destination,
      content,
      root,
      kind: 'rule',
      managedHash: managedFiles[destination],
      agentName,
      owned: true,
      owner,
      linkComponents,
    });
  }

  const snapshot = await currentSnapshot(destination, true);
  if (snapshot.kind === 'symlink' || snapshot.kind === 'other') {
    return {
      item: plannedItem(destination, '', root, 'rule', snapshot, 'conflict', false, agentName, owner),
      conflict: {
        path: destination,
        reason: 'The rules path is a symbolic link or is not a regular file.',
        choices: ['keep'],
      },
    };
  }
  const existing = snapshot.content?.toString('utf8') ?? '';
  const withoutRule = removeExactLine(existing, line);
  const separator = withoutRule.length === 0 || withoutRule.endsWith('\n') ? '' : '\n';
  const content = keepExistingPreferences
    ? `${withoutRule}${separator}${line}\n`
    : `${line}\n${withoutRule}`;
  if (content === existing) {
    return {
      item: plannedItem(destination, existing, root, 'rule', snapshot, 'unchanged', false, agentName, owner),
      conflict: null,
    };
  }
  return {
    item: plannedItem(
      destination,
      content,
      root,
      'rule',
      snapshot,
      existing ? (keepExistingPreferences ? 'append' : 'update') : 'create',
      false,
      agentName,
      owner,
    ),
    conflict: null,
  };
}

function removeExactLine(content, line) {
  let output = '';
  for (const match of content.matchAll(/([^\r\n]*)(\r\n|\n|$)/g)) {
    if (match[0] === '') break;
    if (match[1] !== line) output += match[0];
  }
  return output;
}

async function singlePlannedFile(options) {
  const items = [];
  const conflicts = [];
  await addPlannedFile({ items, conflicts, ...options });
  return { item: items[0] ?? null, conflict: conflicts[0] ?? null };
}

const SYMLINK_COMPONENT_PATTERN = /^Destination (?:root|component) is a symbolic link: (.+)$/;

function symlinkComponentPath(reason) {
  return reason ? SYMLINK_COMPONENT_PATTERN.exec(reason)?.[1] ?? null : null;
}

async function addPlannedFile({
  items,
  conflicts,
  linkComponents,
  destination,
  content,
  root,
  kind,
  managedHash,
  agentName,
  owned,
  owner,
  allowExisting = false,
}) {
  const unsafeReason = await unsafeDestinationReason(root, destination);
  const symlinkAncestor = symlinkComponentPath(unsafeReason);
  if (symlinkAncestor) {
    // The file is planned as a creation behind the link: replacing the link leaves the
    // destination missing, and omitting it is what drops the file, with a record of both.
    const item = plannedItem(destination, content, root, kind, MISSING_SNAPSHOT, 'create', owned, agentName, owner);
    item.linkComponent = symlinkAncestor;
    items.push(item);
    linkComponents.push({ path: symlinkAncestor, root: path.resolve(root) });
    return;
  }
  const snapshot = await currentSnapshot(destination);
  let action = 'create';
  let reason = null;
  if (unsafeReason) {
    action = 'conflict';
    reason = unsafeReason;
  } else if (snapshot.kind === 'symlink' || snapshot.kind === 'other') {
    action = 'conflict';
    reason = 'The destination is a symbolic link or is not a regular file.';
  } else if (snapshot.kind === 'file') {
    const desiredHash = hashContent(content);
    if (snapshot.hash === desiredHash) action = 'unchanged';
    else if (allowExisting || (managedHash && snapshot.hash === managedHash)) action = 'update';
    else {
      action = 'conflict';
      reason = managedHash
        ? 'The HIVEM1ND-managed file was modified after installation.'
        : 'An unowned file already exists at this path.';
    }
  }
  const item = plannedItem(destination, content, root, kind, snapshot, action, owned, agentName, owner);
  items.push(item);
  if (reason) {
    conflicts.push({
      path: destination,
      reason,
      choices: unsafeReason || snapshot.kind === 'symlink' || snapshot.kind === 'other' ? ['keep'] : ['keep', 'replace'],
    });
  }
}

function plannedItem(destination, content, root, kind, snapshot, action, owned, agentName, owner) {
  return {
    path: path.resolve(destination),
    content,
    root: path.resolve(root),
    kind,
    action,
    owned,
    currentHash: snapshot.hash,
    currentKind: snapshot.kind,
    agentNames: agentName ? [agentName] : [],
    owner,
  };
}

function mergePlanItem(items, conflicts, planned) {
  if (planned.item) items.push(planned.item);
  if (planned.conflict) conflicts.push(planned.conflict);
}

function deduplicatePlanItems(items, conflicts) {
  const result = [];
  const byPath = new Map();
  for (const item of items) {
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, item);
      result.push(item);
      continue;
    }
    if (hashContent(existing.content) !== hashContent(item.content)) {
      conflicts.push({ path: item.path, reason: 'Selected agents require different content at the same shared path.' });
      continue;
    }
    existing.agentNames = [...new Set([...existing.agentNames, ...item.agentNames])];
  }
  return result;
}

function deduplicateConflicts(conflicts) {
  const seen = new Set();
  return conflicts.filter((conflict) => {
    if (seen.has(conflict.path)) return false;
    seen.add(conflict.path);
    return true;
  });
}

async function currentSnapshot(filePath, includeContent = false) {
  try {
    const state = await lstat(filePath);
    if (state.isSymbolicLink()) return { kind: 'symlink', hash: null, content: null };
    if (!state.isFile()) return { kind: 'other', hash: null, content: null };
    const content = await readFile(filePath);
    return {
      kind: 'file',
      hash: hashContent(content),
      content: includeContent ? content : null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'missing', hash: null, content: null };
    throw error;
  }
}

async function readFeatureDirectory(directory, fallbackName) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [
    `${fallbackName}.md`,
    'SKILL.md',
    ...entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md').map((entry) => entry.name),
  ];
  const mainName = [...new Set(candidates)].find((candidate) => entries.some((entry) => entry.isFile() && entry.name === candidate));
  if (!mainName) return null;
  const mainPath = path.join(directory, mainName);
  const mainContent = await readFile(mainPath, 'utf8');
  const supportFiles = [];
  await collectSupport(directory, '', mainPath, supportFiles);
  return {
    name: skillName(mainContent, fallbackName),
    type: 'feature',
    mainContent,
    supportFiles,
    sourcePath: mainPath,
  };
}

async function collectSupport(directory, relativeDirectory, mainPath, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (source === mainPath || entry.isSymbolicLink()) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) await collectSupport(source, relativePath, mainPath, output);
    else if (entry.isFile()) output.push({ relativePath, content: await readFile(source) });
  }
}

function skillName(content, fallback) {
  const parsed = parseFrontmatter(content);
  const name = parsed.attributes.name || path.basename(fallback, path.extname(fallback));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
  return name;
}

async function isDirectory(directory) {
  try {
    return (await lstat(directory)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function relativeChild(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function topLevelEntry(value) {
  const normalized = String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  return normalized.split('/')[0];
}

function isExcluded(excludedNames, type, name) {
  return excludedNames.has(name) || excludedNames.has(`${type}:${name}`);
}

function excludedKnowledgePath(segments, excludedNames) {
  if (segments[0] !== 'knowledge' || segments.length < 2 || segments[1].toLowerCase() === 'readme.md') return false;
  return excludedNames.has('knowledge') || isExcluded(excludedNames, 'knowledge', segments[1]);
}

async function rollbackWrites(written, removedLinks = []) {
  const errors = [];
  await restoreWrittenFiles(written, errors);
  // The files come back first: the folder created where the link stood has to be empty
  // again before the link can take its place.
  for (const link of [...removedLinks].reverse()) {
    try {
      await removeEmptyDirectory(link.path);
      await restoreSymbolicLink(link);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function removeEmptyDirectory(directory) {
  const state = await lstat(directory).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!state || state.isSymbolicLink() || !state.isDirectory()) return;
  await rmdir(directory);
}

async function restoreWrittenFiles(written, errors) {
  for (const { item, snapshot } of [...written].reverse()) {
    try {
      const current = await currentSnapshot(item.path);
      if (current.kind !== 'file' || current.hash !== hashContent(item.content)) {
        throw new Error(`Cannot safely restore a file that changed during rollback: ${item.path}`);
      }
      if (snapshot.kind === 'missing') await unlink(item.path);
      else await atomicWriteFile(item.path, snapshot.content, { root: item.root });
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requireAbsoluteDirectoryOption(name, value) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
}
