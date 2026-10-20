// Captures the final-screen evidence that T064 of docs/3.0/integration.md defines.
//
//   node test/visual/capture-final-screens.mjs                 every active state, both languages, plus the five looks
//   node test/visual/capture-final-screens.mjs --only 2.2,start 2.3 --lang en --out <dir>
//
// It boots the actual core on a free loopback port (the same temporary M1ND and fixture repositories the
// actual-core T064 tests use), drives Google Chrome headless through the DevTools Protocol with Node's built-in
// WebSocket, reaches each state through the GUI, waits on a condition that the state is shown, and saves a PNG.
// A state it cannot reach is recorded with the reason and the run continues. This tool is not part of the package.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finalLookCaptures, finalVerificationCases } from '../gui-data.mjs';
import { Browser } from './chrome.mjs';
import { bootWorld } from './core.mjs';
import { makeContext } from './context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');
const TASK_LIMIT = Number(process.env.HIVEM1ND_CAPTURE_TASK_MS ?? 180000);

// Reasons and the report are stored. A session fragment or a bearer token must not be.
function redact(value) {
  return String(value ?? '').replace(/#session=[^\s#'"]+/g, '#session=redacted').replace(/#home=[^\s#'"]+/g, '#home=redacted').replace(/Bearer\s+\S+/gi, 'Bearer redacted');
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function loadRegistry() {
  const registry = new Map();
  for (const file of (await readdir(CASE_DIR)).filter(name => name.endsWith('.mjs')).sort()) {
    const module = await import(pathToFileURL(path.join(CASE_DIR, file)).href);
    for (const [reference, spec] of Object.entries(module.cases ?? {})) {
      if (registry.has(reference)) throw new Error(`Reference ${reference} is defined in two case files.`);
      registry.set(reference, { ...spec, file });
    }
  }
  return registry;
}

export function captureTasks({ only = null, languages = ['en', 'es'] } = {}) {
  const tasks = [];
  for (const item of finalVerificationCases()) {
    for (const capture of item.captures) {
      if (!languages.includes(capture.language)) continue;
      tasks.push({ reference: item.reference, viewport: item.viewport, screenId: item.screenId, ...capture });
    }
  }
  const cases = finalVerificationCases();
  for (const capture of finalLookCaptures()) {
    const item = cases.find(entry => entry.reference === '6.1');
    if (languages.includes(capture.language)) tasks.push({ reference: '6.1', viewport: item.viewport, screenId: item.screenId, ...capture });
  }
  return only ? tasks.filter(task => only.includes(task.reference)) : tasks;
}

async function runTask(task, { browser, spec, outDir }) {
  const started = Date.now();
  const file = path.join(outDir, path.basename(task.path));
  const record = { reference: task.reference, screenId: task.screenId, language: task.language, look: task.look, path: task.path, viewport: task.viewport, status: 'unreached', reason: null, width: null, height: null, bytes: null, ms: 0 };
  let world = null, page = null, timer = null, ctx = null;
  try {
    if (!spec) throw new Error('No reach procedure has been written for this reference.');
    const work = (async () => {
      if (spec.boot !== null) world = await bootWorld({ language: task.language, look: task.look, ...(spec.boot ?? {}) });
      page = await browser.newPage();
      await page.setViewport(task.viewport[0], task.viewport[1], { mobile: task.viewport[0] < 500, language: task.language });
      ctx = makeContext({ task, world, page, browser, spec });
      await spec.seed?.(ctx);
      if (spec.entry !== 'none') await ctx.open();
      await spec.reach(ctx);
      await ctx.finish();
      const shot = await page.screenshot(file, task.viewport);
      Object.assign(record, { status: 'captured', width: shot.width, height: shot.height, bytes: shot.bytes.length });
    })();
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The case did not finish within ${TASK_LIMIT / 1000} s.`)), TASK_LIMIT); });
    await Promise.race([work, limit]);
  } catch (error) {
    record.reason = redact(String(error?.message ?? error).split('\n')[0]).slice(0, 400);
    // HIVEM1ND_CAPTURE_FAILED=1 keeps a picture of the page where the case stopped, beside the out folder's captures.
    if (process.env.HIVEM1ND_CAPTURE_FAILED === '1' && page) await page.screenshot(file.replace(/\.png$/, '-failed.png'), task.viewport).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    await ctx?.cleanup().catch(() => undefined);
    await page?.close().catch(() => undefined);
    await world?.close().catch(() => undefined);
  }
  record.ms = Date.now() - started;
  return record;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); }
  }));
  return results;
}

// The report is written first; the run then fails when any capture was not reached, so automation cannot accept it.
export async function finishRun(results, { version, reportFile, write = writeFile, log = console.log }) {
  const report = { version, tasks: results.length, captured: results.filter(item => item.status === 'captured').length, unreached: results.filter(item => item.status !== 'captured').length, results };
  await write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  log(`captured ${report.captured}, unreached ${report.unreached}, Chrome ${version}`);
  return report.unreached ? 1 : 0;
}

export async function main() {
  const only = argument('only') ? argument('only').split(',').map(item => item.trim()) : null;
  const languages = argument('lang') ? [argument('lang')] : ['en', 'es'];
  const outDir = path.resolve(argument('out', path.join(ROOT, 'docs', '3.0', 'verification')));
  const reportFile = path.resolve(argument('report', path.join(outDir, 'capture-results.json')));
  const concurrency = Number(argument('concurrency', 1));
  const registry = await loadRegistry();
  const tasks = captureTasks({ only, languages });
  if (process.argv.includes('--list')) { for (const task of tasks) console.log(`${task.path}\t${registry.has(task.reference) ? 'written' : 'missing'}`); return; }
  await mkdir(outDir, { recursive: true });
  await mkdir(path.dirname(reportFile), { recursive: true });
  const browser = await Browser.launch();
  let results;
  try {
    results = await pool(tasks, concurrency, async (task, index) => {
      const record = await runTask(task, { browser, spec: registry.get(task.reference), outDir });
      console.log(`[${index + 1}/${tasks.length}] ${record.status === 'captured' ? 'CAPTURED ' : 'UNREACHED'} ${path.basename(task.path)} ${record.ms} ms${record.reason ? ` | ${redact(record.reason)}` : ''}`);
      return record;
    });
  } finally {
    await browser.close();
  }
  process.exitCode = await finishRun(results, { version: browser.version, reportFile });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exit(1); });
}
