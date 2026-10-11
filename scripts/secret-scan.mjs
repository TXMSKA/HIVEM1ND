import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const PRIVATE_KEY = 'BEGIN [A-Z ]*PRIVATE KEY';

const result = gitleaksAvailable() ? scanWithGitleaks(root) : scanWithoutGitleaks(root);
if (result.note) process.stdout.write(`${result.note}\n`);
for (const location of result.locations) process.stdout.write(`${location}\n`);
process.exit(result.locations.length > 0 ? 1 : 0);

function gitleaksAvailable() {
  const found = spawnSync('gitleaks', ['version'], { encoding: 'utf8', shell: false, windowsHide: true });
  return found.status === 0;
}

function scanWithGitleaks(directory) {
  const locations = [
    ...gitleaksReport(directory, ['dir', directory]),
    ...gitleaksReport(directory, ['git', directory, '--log-opts=--all']),
  ];
  return { locations: [...new Set(locations)], note: null };
}

function gitleaksReport(directory, args) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'hivem1nd-gitleaks-'));
  const report = path.join(folder, 'report.json');
  try {
    spawnSync('gitleaks', [...args, '--redact', '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '1'], {
      cwd: directory,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    const findings = JSON.parse(readFileSync(report, 'utf8'));
    if (!Array.isArray(findings)) return [];
    return findings.map((finding) => {
      const file = finding.File ?? finding.file ?? 'unknown';
      const line = finding.StartLine ?? finding.startLine ?? 0;
      const rule = finding.RuleID ?? finding.rule ?? 'secret';
      return `${file}:${line}:${rule}`;
    });
  } catch {
    return [];
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function scanWithoutGitleaks(directory) {
  const locations = [
    ...grepLocations(directory, PRIVATE_KEY),
    ...historyLocations(directory, PRIVATE_KEY),
    ...envFiles(directory),
  ];
  return {
    locations,
    note: 'gitleaks is not installed; private-key and environment-file checks ran; generic token lines were not verified.',
  };
}

function grepLocations(directory, pattern) {
  const found = git(directory, ['grep', '-n', '-I', '-E', pattern]);
  if (found.status !== 0) return [];
  return found.stdout.split(/\r?\n/).filter(Boolean).map(locationOnly).filter(Boolean);
}

function historyLocations(directory, pattern) {
  const found = git(directory, ['log', '--all', '-G', pattern, '--pretty=format:%H', '--name-only']);
  if (found.status !== 0 || !found.stdout.trim()) return [];
  const locations = [];
  let commit = null;
  for (const line of found.stdout.split(/\r?\n/)) {
    if (/^[0-9a-f]{40}$/.test(line)) commit = line;
    else if (line && commit) locations.push(`${commit}:${line}`);
  }
  return locations;
}

function envFiles(directory) {
  const found = git(directory, ['ls-files', ':(glob)**/.env*']);
  if (found.status !== 0) return [];
  return found.stdout.split(/\r?\n/).filter(Boolean).map((file) => `${file}:tracked-env`);
}

function locationOnly(line) {
  const match = /^(.*?):(\d+):/.exec(line);
  return match ? `${match[1]}:${match[2]}` : null;
}

function git(directory, args) {
  return spawnSync('git', args, { cwd: directory, encoding: 'utf8', shell: false, windowsHide: true });
}
