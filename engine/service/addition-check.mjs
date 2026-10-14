import { CoreError } from './identity.mjs';
export function checkAddition(candidate, evidence, nowMs) {
  const pin = evidence.pin;
  const pinned = evidence.pinVerified === true && /^[a-f0-9]{64}$/.test(pin?.digest ?? '')
    && (pin.kind === 'commit' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.value)
      || pin.kind === 'version' && typeof pin.value === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(pin.value) && pin.value.length <= 128
      || pin.kind === 'snapshot' && pin.value === pin.digest);
  const published = typeof evidence.publishedAt === 'string' ? Date.parse(evidence.publishedAt) : NaN;
  const elapsed = Number.isFinite(published) && Number.isFinite(nowMs) ? nowMs - published : NaN;
  const days = Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 86400000) : null;
  const license = typeof evidence.license === 'string' && evidence.license.trim()
    && evidence.license.length <= 128 && !/[\x00-\x1f\x7f]/.test(evidence.license) ? evidence.license.trim() : null;
  const scripts = evidence.noInstallScripts === true;
  const ageOk = days !== null && days >= 7;
  return { pin: { ok: pinned, kind: pin?.kind ?? '', value: pin?.value ?? '' },
    license: { ok: license !== null, value: license }, age: { ok: ageOk, days, publishedAt: Number.isFinite(published) ? evidence.publishedAt : null },
    scripts: { ok: scripts, noInstallScripts: scripts },
    runtime: { ok: evidence.runtimeVerified === true && candidate.requirements.length === 0,
      verified: evidence.runtimeVerified === true, requirements: [...candidate.requirements] },
    eligible: candidate.supported === true && pinned && license !== null && ageOk && scripts && evidence.runtimeVerified === true };
}

export function resolveAdditionScope(scope, units, groups) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['everyUnit', 'units', 'groups'].includes(key))
    || typeof scope.everyUnit !== 'boolean' || !Array.isArray(scope.units) || !Array.isArray(scope.groups)
    || scope.units.length > 255 || scope.groups.length > 255 || scope.everyUnit && (scope.units.length || scope.groups.length)) {
    throw new CoreError(422, 'invalid_scope', 'Choose Every unit or specific units and groups.');
  }
  const known = new Set(units.filter(id => id !== 'root:master'));
  const selected = new Set(scope.everyUnit ? known : []);
  const selectedGroups = new Set();
  for (const id of scope.units) {
    if (!known.has(id)) throw new CoreError(409, 'scope_changed', 'A selected unit is no longer available.');
    selected.add(id);
  }
  for (const id of scope.groups) {
    const group = groups.find(item => item.id === id && item.deleted !== true);
    if (!group) throw new CoreError(409, 'scope_changed', 'A selected group is no longer available.');
    selectedGroups.add(id);
    for (const member of group.members) {
      if (!known.has(member)) throw new CoreError(409, 'scope_changed', 'A selected group changed its members.');
      selected.add(member);
    }
  }
  if (!selected.size) throw new CoreError(422, 'invalid_scope', 'Choose at least one available unit.');
  return { scope: { everyUnit: scope.everyUnit, units: [...new Set(scope.units)].sort(), groups: [...selectedGroups].sort() },
    unitIds: [...selected].sort(), unitCount: selected.size };
}
