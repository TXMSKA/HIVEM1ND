import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError } from './identity.mjs';
import { assertNoLinks } from './paths.mjs';
import { validateSketch } from '../../features/blueprint/review/sketch-format.mjs';

const BLUEPRINT = resolve(dirname(fileURLToPath(import.meta.url)), '../../features/blueprint');
const KIT = join(BLUEPRINT, 'kit');
const REVIEW = join(BLUEPRINT, 'review');
const SHARED_KIT = new Set(['kit.mjs', 'board.mjs', 'icons.mjs', 'ui.mjs', 'skins.mjs']);

const MODULE_LIMIT = 16_000_000;
const exportRevision = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PARSE_IMPORTS = 'import { SourceTextModule } from "node:vm"; let source = ""; for await (const chunk of process.stdin) source += chunk; process.stdout.write(JSON.stringify(new SourceTextModule(source).dependencySpecifiers));';

function importUnavailable() {
  throw new CoreError(422, "import_unavailable", "This registered board cannot be exported.");
}

/** Read only the registered module and its approved kit; evaluation belongs to the desktop. */
export async function prepareLegacyExport(project, entry) {
  if (!entry?.readOnly || entry.kind !== "blueprint" || entry.project !== project.name || !/^docs\/flows\/boards\/[a-z0-9-]+\.mjs$/.test(entry.path)) importUnavailable();
  const root = resolve(project.localPath ?? project.root);
  const flows = join(root, "docs", "flows");
  const safeRead = async (file, optional = false) => {
    await assertNoLinks(root); await assertNoLinks(file);
    const stats = await lstat(file).catch((error) => { if (optional && error.code === "ENOENT") return null; throw error; });
    if (!stats) return null;
    if (!stats.isFile() || stats.size > MODULE_LIMIT) importUnavailable();
    return readFile(file);
  };
  const indexBytes = await safeRead(join(flows, "boards", "index.json"));
  let index;
  try { index = JSON.parse(indexBytes); } catch { importUnavailable(); }
  const listed = (Array.isArray(index) ? index : index.boards ?? []).find((item) => item.id === entry.legacyId);
  if (!listed) importUnavailable();
  const moduleBytes = await safeRead(join(root, entry.path));
  const sketchBytes = await safeRead(join(flows, "sketches", `${entry.legacyId}.json`), true);
  let sketch = null;
  try { if (sketchBytes) { sketch = validateSketch(JSON.parse(sketchBytes)); if (sketch.id !== entry.legacyId) importUnavailable(); } } catch { importUnavailable(); }
  const modules = {};
  const reading = new Set();
  let total = 0;
  const ownKit = async (file) => {
    const own = join(flows, "kit", file);
    const bytes = await safeRead(own, true);
    if (bytes) return { key: `project/kit/${file}`, file: own, bytes };
    if (!SHARED_KIT.has(file)) importUnavailable();
    return { key: `shared/${file}`, file: join(KIT, file), bytes: await safeRead(join(KIT, file)) };
  };
  const resolveImport = async (specifier, key) => {
    if (specifier.startsWith("blueprint/") && SHARED_KIT.has(specifier.slice(10))) {
      const file = specifier.slice(10);
      return { key: `shared/${file}`, file: join(KIT, file), bytes: await safeRead(join(KIT, file)) };
    }
    if (!specifier.startsWith(".") || specifier.includes("\\") || /[%?#]/.test(specifier)) importUnavailable();
    const relative = new URL(specifier, `https://blueprint.local/${key}`).pathname.slice(1);
    if (relative.startsWith("project/kit/") && /^[a-zA-Z0-9-]+\.mjs$/.test(relative.slice(12))) return ownKit(relative.slice(12));
    if (relative.startsWith("shared/") && SHARED_KIT.has(relative.slice(7))) {
      const file = relative.slice(7);
      return { key: relative, file: join(KIT, file), bytes: await safeRead(join(KIT, file)) };
    }
    importUnavailable();
  };
  const visit = async ({ key, file, bytes }) => {
    if (reading.has(key)) importUnavailable();
    if (modules[key]) return key;
    if (Object.keys(modules).length >= 64 || (total += bytes.length) > MODULE_LIMIT) importUnavailable();
    const source = bytes.toString("utf8");
    // Parsing creates a module record, but never links or evaluates repository code.
    const parsed = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", PARSE_IMPORTS], { input: source, encoding: "utf8", timeout: 5000, maxBuffer: MODULE_LIMIT, windowsHide: true });
    if (parsed.status !== 0 || parsed.error) importUnavailable();
    const dependencies = JSON.parse(parsed.stdout);
    const imports = [...source.matchAll(/(?:^|\n)[ \t]*(?:import\s*(?:[^;]*?\bfrom\s*)?|export\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])([^"'\r\n]+)\1/g)];
    if (dependencies.length !== imports.length || imports.some((match, i) => match[2] !== dependencies[i]) || /\bimport\s*\(/.test(source)) importUnavailable();
    reading.add(key);
    const references = [];
    for (const match of imports) {
      const dependency = await resolveImport(match[2], key);
      references.push({ start: match.index + match[0].length - match[2].length - 2, end: match.index + match[0].length, key: await visit(dependency) });
    }
    reading.delete(key);
    modules[key] = { source, imports: references };
    return key;
  };
  try {
    const module = await visit({ key: `project/boards/${entry.path.split("/").at(-1)}`, file: join(root, entry.path), bytes: moduleBytes });
    const kit = await visit(await ownKit("kit.mjs"));
    const skins = await visit(await ownKit("skins.mjs"));
    const exporter = await visit({ key: "shared/board.mjs", file: join(KIT, "board.mjs"), bytes: await safeRead(join(KIT, "board.mjs")) });
    const schema = await visit({ key: "schema", file: join(REVIEW, "sketch-format.mjs"), bytes: await safeRead(join(REVIEW, "sketch-format.mjs")) });
    const extras = {};
    for (const [key, file] of [["icons", "extra-icons.mjs"], ["nodes", "extra-nodes.mjs"]]) {
      const bytes = await safeRead(join(flows, "kit", file), true);
      if (bytes) extras[key] = await visit({ key: `project/kit/${file}`, file: join(flows, "kit", file), bytes });
    }
    return { module, kit, skins, exporter, schema, ...extras, modules, sketch, expectedRevision: exportRevision(moduleBytes), path: entry.path.replace(/\.mjs$/, ".json"), sourceRevisions: { module: exportRevision(moduleBytes), index: exportRevision(indexBytes), sketch: sketchBytes ? exportRevision(sketchBytes) : null, kit: Object.fromEntries(Object.entries(modules).filter(([key]) => key !== module).map(([key, value]) => [key, exportRevision(value.source)])) } };
  } catch (error) {
    if (error instanceof CoreError && error.code === "unsafe_path") throw error;
    importUnavailable();
  }
}
