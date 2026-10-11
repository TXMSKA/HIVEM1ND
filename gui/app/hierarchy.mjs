export function buildHierarchy(units, issues = []) {
  const list = Array.isArray(units) ? units : [];
  const byId = new Map(list.map((unit) => [unit.id, unit]));
  const canonical = list.find((unit) => unit.role === "overseer" && unit.unit === "overseer" && unit.scope?.kind === "root") ?? null;
  const hidden = list.filter((unit) => unit.role === "overseer" && unit.id !== canonical?.id);
  const hiddenIds = new Set(hidden.map((unit) => unit.id));
  const services = list.filter((unit) => unit.role === "genesis" || unit.role === "incubator");
  const serviceIds = new Set(services.map((unit) => unit.id));
  const beside = list.filter((unit) => unit.role === "adjutant" || unit.role === "executive");
  const besideIds = new Set(beside.map((unit) => unit.id));
  const masters = list.filter((unit) => unit.role === "master");
  const masterIds = new Set(masters.map((unit) => unit.id));
  const cycles = new Set();
  const overlordOrder = [];
  const membersOf = new Map();

  function ancestorOverlord(unit) {
    if (unit.role === "overlord") return unit;
    const seen = new Set();
    let current = unit;
    while (current?.leadId) {
      if (seen.has(current.id)) {
        cycles.add(current.id);
        return null;
      }
      seen.add(current.id);
      const lead = byId.get(current.leadId);
      if (!lead) return null;
      if (seen.has(lead.id)) {
        cycles.add(lead.id);
        cycles.add(current.id);
        return null;
      }
      if (lead.role === "overlord") return lead;
      current = lead;
    }
    return null;
  }

  function ensureOverlord(unit) {
    if (!membersOf.has(unit.id)) {
      membersOf.set(unit.id, []);
      overlordOrder.push(unit);
    }
  }

  const loose = new Map();
  for (const unit of list) {
    if (hiddenIds.has(unit.id) || serviceIds.has(unit.id) || besideIds.has(unit.id) || masterIds.has(unit.id) || unit.id === canonical?.id) continue;
    const overlord = ancestorOverlord(unit);
    if (overlord && !hiddenIds.has(overlord.id)) {
      ensureOverlord(overlord);
      if (unit.id !== overlord.id) membersOf.get(overlord.id).push(unit);
      continue;
    }
    const key = scopeKey(unit);
    if (!loose.has(key)) loose.set(key, []);
    loose.get(key).push(unit);
  }

  return {
    command: [...masters, ...(canonical ? [canonical] : []), ...beside],
    overlords: overlordOrder.map((unit) => ({ unit, members: membersOf.get(unit.id) ?? [] })),
    loose,
    services,
    hidden: hidden.map((unit) => unit.id),
    cycles: [...cycles],
    issues,
  };
}

export function flattenVisibleHierarchy(tree, state, query = "") {
  const rows = [];
  const fold = state ?? { shown: new Map(), collapsed: new Set() };
  if (tree.command.length || tree.overlords.length) {
    rows.push(heading("section:command", "command"));
    for (const unit of tree.command) rows.push(unitRow(unit, unit.role === "master" || unit.role === "overseer" ? 0 : 1));
    for (const group of tree.overlords) {
      rows.push(unitRow(group.unit, 1));
      pushMembers(rows, group.members, `lead:${group.unit.id}`, fold, query, 2);
    }
  }
  if (tree.loose.size) {
    rows.push(heading("section:loose", "withoutOverlord"));
    for (const [key, members] of tree.loose) {
      rows.push({
        id: `group:${key}`,
        kind: "group",
        groupId: key,
        label: key === "root" ? "" : key.split(":").slice(1).join(":"),
        labelKey: key === "root" ? "scopeRoot" : "",
        depth: 0,
        count: members.length,
      });
      pushMembers(rows, members, key, fold, query, 1);
    }
  }
  if (tree.services.length) {
    rows.push(heading("section:services", "services"));
    for (const unit of tree.services) rows.push(unitRow(unit, 0));
  }
  if (tree.cycles.length) rows.push({ id: "issue:cycle", kind: "issue", labelKey: "cycleIssue", depth: 0 });
  rows.forEach((row, index) => {
    row.pos = index + 1;
    row.setsize = rows.length;
  });
  return rows;
}

export function toggleGroup(state, groupId) {
  if (state.collapsed.has(groupId)) state.collapsed.delete(groupId);
  else state.collapsed.add(groupId);
}

export function revealGroup(state, groupId, count) {
  const shown = state.shown.get(groupId) ?? 8;
  state.shown.set(groupId, shown + count);
  state.collapsed.delete(groupId);
}

export function activateUnit(app, unit, kind) {
  if (!unit?.id) return;
  app.store.selected.unitId = unit.id;
  app.activated = { id: unit.id, kind };
  if (kind === "double") {
    app.pendingCenter = unit.id;
    app.pendingChat = app.layout === "phone"
      ? { unitId: unit.id, create: false }
      : { unitId: unit.id, create: true };
  }
}

export function unitsForTree(matches, catalog) {
  const source = catalog?.length ? catalog : matches;
  if (!matches || matches === source) return source;
  const byId = new Map(source.map((unit) => [unit.id, unit]));
  const wanted = new Set();
  for (const unit of matches) {
    wanted.add(unit.id);
    const seen = new Set([unit.id]);
    let leadId = unit.leadId;
    while (leadId && !seen.has(leadId)) {
      seen.add(leadId);
      wanted.add(leadId);
      leadId = byId.get(leadId)?.leadId ?? null;
    }
  }
  const ordered = source.filter((unit) => wanted.has(unit.id));
  for (const unit of matches) if (!ordered.some((item) => item.id === unit.id)) ordered.push(unit);
  return ordered;
}

function pushMembers(rows, members, groupId, state, query, depth) {
  const visible = takeVisible(members, groupId, state, query);
  for (const unit of visible.members) rows.push(unitRow(unit, depth));
  if (visible.hidden > 0) {
    rows.push({
      id: `more:${groupId}`,
      kind: "more",
      groupId,
      count: visible.hidden,
      depth,
      labelKey: "showMore",
    });
  }
}

function takeVisible(members, groupId, state, query) {
  const collapsed = state.collapsed.has(groupId);
  const shown = state.shown.get(groupId) ?? 8;
  const limit = members.length > 8 ? shown : members.length;
  const opened = collapsed ? [] : members.slice(0, limit);
  const visible = [];
  const seen = new Set();
  for (const unit of opened) {
    seen.add(unit.id);
    visible.push(unit);
  }
  if (query) {
    for (const unit of members) {
      if (seen.has(unit.id)) continue;
      if (matches(unit, query)) visible.push(unit);
    }
  }
  return { members: visible, hidden: Math.max(0, members.length - visible.length) };
}

function matches(unit, query) {
  const needle = String(query).toLowerCase();
  return [unit.unit, unit.job, unit.context].some((value) => String(value ?? "").toLowerCase().includes(needle));
}

function scopeKey(unit) {
  if (unit.scope?.kind === "project") return `project:${unit.scope.name}`;
  if (unit.scope?.kind === "environment") return `env:${unit.scope.name}`;
  return "root";
}

function heading(id, labelKey) {
  return { id, kind: "heading", labelKey, depth: 0 };
}

function unitRow(unit, depth) {
  return { id: unit.id, kind: "unit", unit, depth, label: unit.unit };
}
