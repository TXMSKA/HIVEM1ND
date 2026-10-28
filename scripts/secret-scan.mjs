import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? process.cwd());
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

if (!gitRepository(root)) fail('secret scan failed: not a git repository');
if (!gitleaksAvailable()) fail('secret scan failed: gitleaks is not installed');
const working = gitleaksReport(root, ['dir', root]);
if (working.error) fail(`secret scan failed: ${working.error}`);
const history = gitleaksReport(root, ['git', root, '--log-opts=--all']);
if (history.error) fail(`secret scan failed: ${history.error}`);
const locations = [...new Set([...working.locations, ...history.locations])];
for (const location of locations) process.stdout.write(`${location}\n`);
process.exit(locations.length > 0 ? 1 : 0);

function fail(note) {
  process.stdout.write(`${note}\n`);
  process.exit(1);
}

function gitleaksLaunch(args, cwd = root) {
  const override = process.env.ONEM1ND_GITLEAKS;
  if (override) return spawnSync(process.execPath, [override, ...args], { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  const name = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  return spawnSync(path.join(scriptDir, '..', '.tools', name), args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
}

function gitleaksAvailable() {
  const found = gitleaksLaunch(['version']);
  return !found.error && found.status === 0;
}

function gitleaksReport(directory, args) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'onem1nd-gitleaks-'));
  const report = path.join(folder, 'report.json');
  try {
    const found = gitleaksLaunch([...args, '--redact', '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '1'], directory);
    if (found.error || (found.status !== 0 && found.status !== 1)) return { error: 'gitleaks failed' };
    let findings;
    try {
      findings = JSON.parse(readFileSync(report, 'utf8'));
    } catch {
      return { error: 'gitleaks report failed' };
    }
    if (!Array.isArray(findings)) return { error: 'gitleaks report failed' };
    if ((found.status === 0 && findings.length > 0) || (found.status === 1 && findings.length === 0)) return { error: 'gitleaks report failed' };
    return {
      locations: findings.map((finding) => {
        const file = finding.File ?? finding.file ?? 'unknown';
        const line = finding.StartLine ?? finding.startLine ?? 0;
        const rule = finding.RuleID ?? finding.rule ?? 'secret';
        return `${file}:${line}:${rule}`;
      }),
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function gitRepository(directory) {
  const found = git(directory, ['rev-parse', '--is-inside-work-tree']);
  return !found.error && found.status === 0 && found.stdout.trim() === 'true';
}

function git(directory, args) {
  return spawnSync('git', args, { cwd: directory, encoding: 'utf8', shell: false, windowsHide: true });
}
