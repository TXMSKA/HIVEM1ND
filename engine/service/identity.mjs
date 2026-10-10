import { createHash } from 'node:crypto';

const MAX_DEPTH = 40;
const MAX_ARRAY = 10000;
const UNIT_NAME_MAX = 80;
const MACHINE_NAME_MAX = 48;
const NAME_MAX = 128;
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TASK_DIGITS = /^[0-9]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ROLES = Object.freeze(['overseer', 'adjutant', 'executive', 'overlord', 'executor', 'incubator', 'genesis', 'master']);
export const CLIENTS = Object.freeze(['claude', 'codex', 'cursor']);

const ROLE_SET = new Set(ROLES);
const CLIENT_SET = new Set(CLIENTS);

export class CoreError extends Error {
  constructor(status, code, message, details = {}, retryAt = null) {
    super(message);
    this.name = 'CoreError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAt = retryAt;
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, 1));
}

function canonicalize(value, depth) {
  if (depth > MAX_DEPTH) {
    throw new CoreError(400, 'invalid_json', 'JSON exceeds the maximum nesting depth.');
  }
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CoreError(400, 'invalid_json', 'JSON numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new CoreError(400, 'invalid_json', 'JSON contains a value that cannot be encoded.');
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) throw new CoreError(400, 'invalid_json', 'JSON exceeds the maximum array length.');
    return value.map((item) => canonicalize(item, depth + 1));
  }
  if (!isPlainObject(value)) throw new CoreError(400, 'invalid_json', 'JSON contains a value that cannot be encoded.');
  const keys = Object.keys(value).sort();
  const sorted = {};
  for (const key of keys) {
    if (value[key] === undefined) throw new CoreError(400, 'invalid_json', 'JSON contains a value that cannot be encoded.');
    sorted[key] = canonicalize(value[key], depth + 1);
  }
  return sorted;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function uuidV8(input) {
  const bytes = createHash('sha256').update(canonicalJson(input), 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function validateName(value, { label = 'name', max = NAME_MAX } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !NAME_PATTERN.test(value) || value === '.' || value === '..' || value.endsWith('.') || DEVICE_NAME.test(value)) {
    throw new CoreError(422, 'invalid_name', `${label} must be a path-safe name.`);
  }
  return value;
}

export function validateMachineName(value) {
  return validateName(value, { label: 'machine', max: MACHINE_NAME_MAX });
}

export function validateRole(value) {
  if (typeof value !== 'string' || !ROLE_SET.has(value) || CLIENT_SET.has(value)) {
    throw new CoreError(422, 'invalid_role', 'The role is not one of the known roles.');
  }
  return value;
}

export function canonicalScope(scope) {
  if (scope === null || scope === undefined || scope === 'user' || scope === 'root' || scope?.id === 'user' || scope?.id === 'root' || scope?.kind === 'root') {
    return { kind: 'root', name: null, id: 'root' };
  }
  if (typeof scope === 'string') {
    const parsed = parseScopeId(scope);
    return parsed;
  }
  if (scope?.kind === 'environment') {
    const name = validateName(scope.name, { label: 'environment', max: UNIT_NAME_MAX });
    return { kind: 'environment', name, id: `env:${name}` };
  }
  if (scope?.kind === 'project') {
    const name = validateName(scope.name, { label: 'project', max: UNIT_NAME_MAX });
    return { kind: 'project', name, id: `project:${name}`, environment: scope.environment ? validateName(scope.environment, { label: 'environment', max: UNIT_NAME_MAX }) : null };
  }
  if (scope?.id) return parseScopeId(scope.id);
  throw new CoreError(422, 'invalid_scope', 'The scope is not canonical.');
}

function parseScopeId(value) {
  if (value === 'user' || value === 'root') return { kind: 'root', name: null, id: 'root' };
  const parts = String(value).split(':');
  if (parts[0] === 'env' && parts.length === 2) {
    const name = validateName(parts[1], { label: 'environment', max: UNIT_NAME_MAX });
    return { kind: 'environment', name, id: `env:${name}` };
  }
  if (parts[0] === 'project' && parts.length === 2) {
    const name = validateName(parts[1], { label: 'project', max: UNIT_NAME_MAX });
    return { kind: 'project', name, id: `project:${name}`, environment: null };
  }
  throw new CoreError(422, 'invalid_scope', 'The scope is not canonical.');
}

export function parseUnitId(value) {
  if (typeof value !== 'string') throw new CoreError(422, 'invalid_unit', 'The unit id is not canonical.');
  const parts = value.split(':');
  if (parts[0] === 'root' && parts.length === 2) {
    const unit = validateName(parts[1], { label: 'unit', max: UNIT_NAME_MAX });
    return { kind: 'root', environment: null, project: null, unit, id: `root:${unit}`, scope: { kind: 'root', name: null, id: 'root' } };
  }
  if (parts[0] === 'env' && parts.length === 3) {
    const environment = validateName(parts[1], { label: 'environment', max: UNIT_NAME_MAX });
    const unit = validateName(parts[2], { label: 'unit', max: UNIT_NAME_MAX });
    return { kind: 'environment', environment, project: null, unit, id: `env:${environment}:${unit}`, scope: { kind: 'environment', name: environment, id: `env:${environment}` } };
  }
  if (parts[0] === 'project' && parts.length === 3) {
    const project = validateName(parts[1], { label: 'project', max: UNIT_NAME_MAX });
    const unit = validateName(parts[2], { label: 'unit', max: UNIT_NAME_MAX });
    return { kind: 'project', environment: null, project, unit, id: `project:${project}:${unit}`, scope: { kind: 'project', name: project, id: `project:${project}` } };
  }
  throw new CoreError(422, 'invalid_unit', 'The unit id is not canonical.');
}

export function parseTaskId(value) {
  if (typeof value !== 'string') throw new CoreError(422, 'invalid_task', 'The task id is not canonical.');
  const parts = value.split(':');
  if (parts[0] === 'root' && parts.length === 2 && TASK_DIGITS.test(parts[1])) {
    return { kind: 'root', environment: null, project: null, number: parts[1], id: `root:${parts[1]}`, scope: { kind: 'root', name: null, id: 'root' } };
  }
  if (parts[0] === 'env' && parts.length === 3 && TASK_DIGITS.test(parts[2])) {
    const environment = validateName(parts[1], { label: 'environment', max: UNIT_NAME_MAX });
    return { kind: 'environment', environment, project: null, number: parts[2], id: `env:${environment}:${parts[2]}`, scope: { kind: 'environment', name: environment, id: `env:${environment}` } };
  }
  if (parts[0] === 'project' && parts.length === 3 && TASK_DIGITS.test(parts[2])) {
    const project = validateName(parts[1], { label: 'project', max: UNIT_NAME_MAX });
    return { kind: 'project', environment: null, project, number: parts[2], id: `project:${project}:${parts[2]}`, scope: { kind: 'project', name: project, id: `project:${project}` } };
  }
  throw new CoreError(422, 'invalid_task', 'The task id is not canonical.');
}

export function masterIdentity() {
  return {
    unit: 'master',
    unitId: 'root:master',
    scopeId: 'root',
    scope: { kind: 'root', name: null, id: 'root' },
    role: 'master',
    client: 'master',
  };
}

export function isPersonAlias(value, aliases = []) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  const lower = text.toLowerCase();
  if (lower === 'user' || lower === 'master') return true;
  if (/^user@[^@\s]+$/i.test(text)) return true;
  if (/^person:/i.test(text) && text.length > 'person:'.length) return true;
  return aliases.some((alias) => typeof alias === 'string' && alias.length > 0 && (alias.toLowerCase() === lower || `person:${alias}`.toLowerCase() === lower));
}

export function resolvePerson(value, { aliases = [] } = {}) {
  if (!isPersonAlias(value, aliases)) return null;
  return masterIdentity();
}

export function scopeDirectory(scope) {
  const canonical = canonicalScope(scope);
  if (canonical.kind === 'root') return 'user';
  if (canonical.kind === 'environment') return `user/environments/${canonical.name}`;
  return `user/projects/${canonical.name}`;
}

export function unitStatePath(parsed) {
  return `${scopeDirectory(parsed.scope)}/state/${parsed.unit}.md`;
}

export function taskDirectory(scope) {
  return `${scopeDirectory(scope)}/tasks`;
}

export function inboxDirectory(parsed) {
  return `${scopeDirectory(parsed.scope)}/inbox/${parsed.unit}`;
}

function unitScope(unit) {
  if (unit.scopeId || typeof unit.scope === 'string' || unit.scope?.kind) return canonicalScope(unit.scopeId ?? unit.scope);
  if (unit.project) return canonicalScope({ kind: 'project', name: unit.project, environment: unit.environment ?? null });
  if (unit.environment) return canonicalScope({ kind: 'environment', name: unit.environment });
  return canonicalScope('root');
}

function sameScope(left, right) {
  return left.kind === right.kind && left.name === right.name;
}

function presentUnit(unit) {
  const scope = unitScope(unit);
  const spelling = unit.unit;
  const id = unit.unitId ?? (scope.kind === 'root' ? `root:${spelling}` : scope.kind === 'environment' ? `env:${scope.name}:${spelling}` : `project:${scope.name}:${spelling}`);
  return {
    unit: spelling,
    unitId: id,
    scopeId: scope.id === 'root' && unit.scopeId === 'user' ? 'root' : scope.id,
    scope,
    role: unit.role ?? null,
    legacyScopeId: unit.scopeId === 'user' ? 'user' : null,
  };
}

function scopeChain(scope) {
  const canonical = canonicalScope(scope);
  if (canonical.kind === 'root') return [canonical];
  if (canonical.kind === 'environment') return [canonical, canonicalScope('root')];
  const chain = [canonical];
  if (scope?.environment) chain.push(canonicalScope({ kind: 'environment', name: scope.environment }));
  chain.push(canonicalScope('root'));
  return chain;
}

export function resolveUnit(input, { units = [], scope = null, aliases = [] } = {}) {
  if (typeof input !== 'string' || input.trim() === '') throw new CoreError(422, 'invalid_unit', 'The unit id is not canonical.');
  const text = input.trim();
  if (text.startsWith('root:') || text.startsWith('env:') || text.startsWith('project:')) {
    const parsed = parseUnitId(text);
    const matches = units.filter((unit) => {
      const presented = presentUnit(unit);
      return presented.unitId.toLowerCase() === parsed.id.toLowerCase();
    });
    if (matches.length > 1) throw new CoreError(409, 'ambiguous_unit', 'The unit name matches more than one scope.');
    if (matches.length === 0) throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
    return presentUnit(matches[0]);
  }
  if (isPersonAlias(text, aliases)) return masterIdentity();
  const name = validateName(text, { label: 'unit', max: UNIT_NAME_MAX });
  const levels = scope ? scopeChain(scope) : null;
  if (levels) {
    for (const level of levels) {
      const matches = units.filter((unit) => sameScope(unitScope(unit), level) && unit.unit.toLowerCase() === name.toLowerCase());
      if (matches.length > 1) throw new CoreError(409, 'ambiguous_unit', 'The unit name matches more than one scope.');
      if (matches.length === 1) return presentUnit(matches[0]);
    }
    throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
  }
  const matches = units.filter((unit) => unit.unit.toLowerCase() === name.toLowerCase());
  if (matches.length > 1) throw new CoreError(409, 'ambiguous_unit', 'The unit name matches more than one scope.');
  if (matches.length === 1) return presentUnit(matches[0]);
  throw new CoreError(404, 'unit_not_found', 'The unit does not exist.');
}

export function recordHeaders(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const split = splitRecord(buffer);
  const headers = new Map();
  for (const line of split.lines) {
    const text = line.text.toString('utf8');
    const colon = text.indexOf(':');
    if (colon <= 0) continue;
    headers.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
  }
  return { ...split, headers };
}

function splitRecord(buffer) {
  const bomLength = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  const lines = [];
  let offset = bomLength;
  while (offset < buffer.length) {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0x0a) end += 1;
    const consumed = end < buffer.length ? end + 1 : end;
    const crlf = end > offset && buffer[end - 1] === 0x0d && end < buffer.length && buffer[end] === 0x0a;
    const text = buffer.subarray(offset, crlf ? end - 1 : end);
    const ending = buffer.subarray(crlf ? end - 1 : end, consumed);
    if (text.length === 0) {
      return { bom: buffer.subarray(0, bomLength), lines, separator: ending, body: buffer.subarray(consumed) };
    }
    lines.push({ text, ending });
    if (end >= buffer.length) break;
    offset = consumed;
  }
  return { bom: buffer.subarray(0, bomLength), lines, separator: Buffer.alloc(0), body: Buffer.alloc(0) };
}

export function replaceHeader(bytes, name, value) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
    throw new CoreError(422, 'invalid_header', 'The header name is not valid.');
  }
  if (typeof value !== 'string' || /[\r\n\u0000]/.test(value)) {
    throw new CoreError(422, 'invalid_header', 'The header value must be a single line.');
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const parsed = recordHeaders(buffer);
  let replaced = false;
  const lines = parsed.lines.map((line) => ({ text: Buffer.from(line.text), ending: Buffer.from(line.ending) }));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = lines[index].text.toString('utf8');
    const colon = text.indexOf(':');
    if (colon <= 0) continue;
    if (text.slice(0, colon).trim() !== name) continue;
    const ending = lines[index].ending.length ? lines[index].ending : Buffer.from('\n');
    lines[index] = { text: Buffer.from(`${name}: ${value}`), ending };
    replaced = true;
    break;
  }
  if (!replaced) {
    const ending = lines.some((line) => line.ending.equals(Buffer.from('\r\n'))) ? Buffer.from('\r\n') : Buffer.from('\n');
    lines.push({ text: Buffer.from(`${name}: ${value}`), ending });
  }
  const header = Buffer.concat(lines.map((line) => Buffer.concat([line.text, line.ending])));
  const separator = parsed.separator.length ? parsed.separator : Buffer.from('\n');
  return Buffer.concat([parsed.bom, header, separator, parsed.body]);
}
