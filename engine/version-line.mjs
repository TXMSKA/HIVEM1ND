// Two release lines share the mind's version record. HIVEM1ND numbered 0.x to 3.0.0 and wrote a bare
// version. ONEM1ND numbers its own line from 1.0.0-beta.1 and writes `onem1nd <version>`. A bare record
// belongs to the HIVEM1ND line, so any ONEM1ND version is newer than any bare record.

export const HIVEM1ND_LINE = 'hivem1nd';
export const ONEM1ND_LINE = 'onem1nd';

// Migration files written under HIVEM1ND numbering. Every other file in migrations/ is ONEM1ND numbered.
export const HIVEM1ND_MIGRATIONS = new Set([
  '0.2.0', '0.3.0', '1.0.0', '1.1.0', '2.0.0-experimental.4', '3.0.0', '3.0.0-onem1nd',
]);

const RECORD_PATTERN = /^(?:(onem1nd)\s+)?(\S+)$/;

export function parseVersionRecord(text) {
  const match = RECORD_PATTERN.exec(String(text ?? '').trim());
  if (!match) return { line: HIVEM1ND_LINE, version: String(text ?? '').trim() };
  return { line: match[1] ?? HIVEM1ND_LINE, version: match[2] };
}

export function formatVersionRecord(version, line = ONEM1ND_LINE) {
  return `${line === ONEM1ND_LINE ? `${ONEM1ND_LINE} ` : ''}${version}\n`;
}

export function lineOfPackage(name) {
  return String(name ?? '').trim() === 'onem1nd' ? ONEM1ND_LINE : HIVEM1ND_LINE;
}

// Orders `{ line, version }` pairs: a different line decides first, the same line compares versions.
export function compareRecords(left, right, compareVersions) {
  if (left.line !== right.line) return left.line === ONEM1ND_LINE ? 1 : -1;
  return compareVersions(left.version, right.version);
}

// Decides whether one migration file runs for a move from `from` to `to`. A record from the HIVEM1ND line
// runs the HIVEM1ND migrations above it and, since 3.0.0-onem1nd is the rebrand step, that one from 3.0.0 too.
export function migrationApplies(migrationVersion, from, to, compareVersions) {
  const legacy = HIVEM1ND_MIGRATIONS.has(migrationVersion);
  if (from.line === HIVEM1ND_LINE) {
    if (legacy) {
      const rebrand = migrationVersion === '3.0.0-onem1nd' && compareVersions(from.version, '3.0.0') >= 0;
      if (compareVersions(migrationVersion, from.version) <= 0 && !rebrand) return false;
      return to.line === ONEM1ND_LINE || compareVersions(migrationVersion, to.version) <= 0;
    }
    return to.line === ONEM1ND_LINE && compareVersions(migrationVersion, to.version) <= 0;
  }
  if (legacy || to.line !== ONEM1ND_LINE) return false;
  return compareVersions(migrationVersion, from.version) > 0 && compareVersions(migrationVersion, to.version) <= 0;
}
