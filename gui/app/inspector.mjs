import { canAccept, canSendBack } from "./actions.mjs";
import { clientLabel, clusterLead } from './clusters.mjs';
import { element, icon, labeledField, pathIcon, progressMark } from "./components.mjs";
import { formatWhen } from "./i18n.mjs";
import { readableIdentity, unitDisplayName } from './hierarchy.mjs';
import { startText } from './start-copy.mjs';
import { addText } from './add-view.mjs';

export function renderAgentHeader(document, unit, session, language, onMore) {
  const t = key => startText(language, key), working = ['busy', 'working', 'active'].includes(session?.activity);
  return element(document, 'header', { class: 'agent-heading' },
    element(document, 'span', { class: 'agent-avatar', 'aria-hidden': 'true' }, icon(document, unit.role === 'overseer' ? 'crown' : 'executor')),
    element(document, 'div', {}, element(document, 'h2', { text: unitDisplayName(unit) }),
      element(document, 'p', { class: 'agent-status' }, working ? element(document, 'span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
        unit.role === 'overseer' && unit.fresh !== false ? t('freshStatus') : t(working ? 'busy' : 'pending'))),
    element(document, 'button', { type: 'button', class: 'icon-button agent-more', 'data-action': 'agent-more', 'aria-label': t('moreMenu'), text: '···', onclick: onMore }));
}

export function renderCluster(document, model, actions = {}) {
  const t = (key, values) => startText(model.language, key, values);
  const cluster = model.cluster, kind = cluster.link?.kind ?? 'none';
  const root = element(document, 'section', { class: 'cluster-inspector', 'data-cluster-inspector': cluster.id });
  const action = (key, id, run, glyph = null) => element(document, 'button', { type: 'button', class: glyph ? 'icon-button' : 'btn',
    'data-action': id, 'aria-label': t(key), title: t(key), onclick: run }, glyph ? icon(document, glyph) : t(key));
  const add = action('newAgent', 'new-agent', actions.onNewAgent, 'executor'); add.replaceChildren(icon(document, 'plus'));
  const more = action('moreMenu', 'cluster-more', actions.onMore, 'settings'); more.replaceChildren(pathIcon(document, 'M5 12h.1M12 12h.1M19 12h.1'));
  root.append(element(document, 'header', { class: 'cluster-heading' }, element(document, 'span', { class: 'cluster-avatar', 'aria-hidden': 'true' }, icon(document, 'folder')),
    element(document, 'div', {}, element(document, 'h2', { text: cluster.title }), element(document, 'p', { text: t(kind === 'repository' ? 'repoCluster' : kind === 'folder' ? 'folder' : 'unlinkedCluster') })),
    add, more));
  const facts = element(document, 'section', { class: 'cluster-git', 'data-cluster-git': cluster.id });
  if (model.git) {
    const git = model.git;
    facts.append(element(document, 'div', { class: 'cluster-git-identity' }, element(document, 'code', { text: git.remote ?? '' }),
      element(document, 'code', { class: 'cluster-branch', text: git.branch ?? 'HEAD' })),
      element(document, 'p', { class: 'cluster-dirty', text: t(git.dirtyCount === 1 ? 'changedOne' : 'changedMany', { count: git.dirtyCount }) }));
    if (git.lastCommit) facts.append(element(document, 'p', { class: 'start-hint', text: [git.lastCommit.subject, formatWhen(model.language, git.lastCommit.at)].join(' · ') }));
    facts.append(element(document, 'div', { class: 'action-row' }, action('changes', 'cluster-changes', actions.onChanges), action('openEditor', 'cluster-open-editor', actions.onEditor)));
  } else if (kind === 'none') facts.append(element(document, 'p', { class: 'start-hint', text: t('noLinkBody') }), action('linkFolder', 'link-folder', actions.onLink));
  else facts.append(element(document, 'code', { text: model.link?.localPath ?? t('unavailable') }));
  if (model.error) facts.append(element(document, 'p', { role: 'alert', text: model.error }));
  root.append(facts);
  if (model.addition) {
    const item = model.addition;
    root.append(element(document, 'section', { class: 'cluster-origin', 'data-cluster-origin': item.id },
      element(document, 'button', { type: 'button', class: 'add-origin', 'aria-label': addText(model.language, 'checkUpdates'),
        text: addText(model.language, 'projectOrigin', { source: item.source.display }), onclick: () => actions.onUpdate?.(item) }),
      element(document, 'p', { class: 'start-hint', text: addText(model.language, 'pinned', { kind: addText(model.language, item.pin.kind), pin: item.pin.kind === 'commit' ? item.pin.value.slice(0, 7) : item.pin.value }) })));
  }
  const lead = clusterLead(cluster, model.units), members = (model.units ?? []).filter(unit => !unit.removed && unit.role !== 'master' && cluster.members.includes(unit.id));
  root.append(element(document, 'div', { class: 'cluster-members', 'data-cluster-lead': lead?.id ?? '' },
    element(document, 'p', { text: !members.length ? t('noAgents') : lead && members.length > 1
      ? t('leads', { lead: unitDisplayName(lead), members: members.filter(unit => unit.id !== lead.id).map(unitDisplayName).join(', ') })
      : members.map(unitDisplayName).join(', ') })));
  return root;
}

export function renderClusterChanges(document, changes) {
  return element(document, 'div', { class: 'cluster-changes' }, (changes ?? []).map(change => element(document, 'article', {},
    element(document, 'code', { text: [change.status, change.path].filter(Boolean).join(' ') }),
    change.patch ? element(document, 'pre', { text: change.patch }) : null)));
}

export function renderUnit(document, unit, t, language = "en") {
  const card = element(document, "section", { class: "unit-card" });
  card.append(element(document, "h3", { text: unit ? unitDisplayName(unit) : t("unknown") }));
  card.append(element(document, "p", { text: `${t("role")}: ${unit?.role === 'agent' ? startText(language, 'agent') : unit?.role ?? t("unknown")}` }));
  card.append(element(document, "p", { text: `${t("job")}: ${unit?.job ?? t("unknown")}` }));
  const lines = [
    ["scope", unit?.scope?.name ?? unit?.scope?.kind],
    // The lead by its name, never its scoped id.
    ["lead", unit?.leadId ? readableIdentity(unit.leadId) : null],
    ["model", unit?.model],
    ["machine", unit?.machine],
    ["branch", unit?.branch],
    ["date", shownDate(language, unit?.date)],
  ];
  const facts = element(document, "div", { class: "unit-facts", "data-unit-facts": "true" });
  for (const [label, value] of lines) {
    facts.append(element(document, "p", { text: `${t(label)}: ${value ?? t("unknown")}` }));
  }
  if (unit?.context) facts.append(element(document, "p", { text: unit.context }));
  card.append(facts);
  return card;
}

const CHECKOUT_REASONS = {
  manual: 'checkoutManual', other_machine: 'checkoutOtherMachine', unverified: 'checkoutUnverified',
  git_unavailable: 'checkoutGit', not_observed: 'checkoutNotSeen',
};

// The folder and branch rows of an agent's facts: [copy key, value, tooltip]. Nothing is guessed: an unknown
// answer says so, a stopped session keeps its last reading marked with the time it was last seen.
export function checkoutFacts(t, language, { session, local, entry }) {
  if (!session) return [];
  const stopped = session.state === 'stopped', unknown = reason => [['worksIn', t('notKnown'), t(reason)], ['branch', t('notKnown'), t(reason)]];
  if (session.machine && session.machine !== local) return stopped ? [] : unknown('checkoutOtherMachine');
  const data = entry?.data;
  if (!data) return entry?.error && !stopped ? unknown('checkoutFailed') : [];
  if (data.known === false) return stopped ? [] : unknown(CHECKOUT_REASONS[data.reason] ?? 'checkoutUnverified');
  const seen = data.live === false ? ` · ${t('lastSeen', { time: formatWhen(language, data.observedAt) })}` : '';
  const folder = data.kind === 'private' ? t('checkoutPrivate') : String(data.path).split(/[\\/]+/).filter(Boolean).at(-1) ?? data.path;
  const rows = [['worksIn', `${folder}${data.kind === 'worktree' ? ` · ${t('worktree')}` : ''}${seen}`, data.path]];
  if (data.kind === 'repository' || data.kind === 'worktree') {
    rows.push(['branch', `${data.detached ? t('detachedAt', { head: String(data.head ?? '').slice(0, 7) }) : data.branch ?? t('notKnown')}${seen}`, null]);
  }
  return rows;
}

export function renderMachine(document, machine, t) {
  const block = element(document, "section", {
    class: "machine-facts",
    "data-machine": machine?.id ?? "",
    "data-answers": machine?.answers ? "true" : "false",
  });
  block.append(element(document, "p", { text: `${machine?.id ?? t("unknown")}: ${machine?.answers ? t("machineAnswers") : t("machineSilent")}` }));
  for (const issue of machine?.issues ?? []) {
    block.append(element(document, "p", { "data-machine-issue": machine.id, text: issue.message || t("machineUnavailable", { machine: machine.id }) }));
  }
  return block;
}

const ACTIVITY_COPY = {
  busy: "sessionWorking",
  working: "sessionWorking",
  idle: "activityIdle",
  active: "activityActive",
  inactive: "activityInactive",
};

const WAKE_COPY = {
  "handoff-budget-exhausted": "wakePausedHandoff",
  "dedupe-budget-exhausted": "wakePausedDedupe",
  "error-budget-exhausted": "wakePausedError",
  expired: "wakePausedExpired",
  disabled: "wakePausedDisabled",
};

function shownDate(language, value) {
  if (value == null || value === "") return null;
  return formatWhen(language, value);
}

function wakeSentence(t, wake) {
  if (!wake) return t("wakeUnknown");
  if (wake.pausedReason) return t(WAKE_COPY[wake.pausedReason] ?? "wakePausedUnknown");
  return wake.enabled ? t("wakeEnabledSentence") : t("wakeOff");
}

export function renderSession(document, session, t) {
  if (!session) return element(document, "p", { text: t("unknown") });
  const block = element(document, "section", { "data-session": session.id, "data-session-state": session.state ?? "" });
  const named = clientLabel(session.client);
  const runs = session.launchKind === 'cli' ? t('runsCli', { client: named })
    : session.launchKind === 'manual-app' ? t('runsApp', { client: named }) : named || t('unknown');
  block.append(element(document, 'p', { 'data-runs-in': session.launchKind ?? '', text: `${t('finalRunsIn')}: ${runs} · ${session.machine ?? t('unknown')}` }));
  const activity = session.activity ?? "unknown";
  const activityText = t(ACTIVITY_COPY[activity] ?? "activityUnknown");
  if (activity === "busy" || activity === "working") {
    block.append(progressMark(document, activityText, { "data-session-activity": activity }));
  } else {
    block.append(element(document, "p", { "data-session-activity": activity, text: activityText }));
  }
  const quota = session.quota;
  const quotaText = quota == null ? t("unknown") : `${quota.remaining ?? t("unknown")}${quota.exhausted ? ` ${t("statusQuota")}` : ""}`;
  block.append(element(document, "p", { "data-session-quota": quota == null ? "unknown" : "known", text: `${t("sessionQuota")}: ${quotaText}` }));
  const wake = session.wake;
  const wakeState = !wake ? "unknown" : wake.pausedReason ? "paused" : wake.enabled ? "enabled" : "off";
  block.append(element(document, "p", { "data-session-wake": wakeState, text: wakeSentence(t, wake) }));
  return block;
}

export function renderGrants(document, grants, t, onRevoke, busyId = null) {
  const block = element(document, "section", { class: "grants" });
  for (const grant of grants ?? []) {
    const row = element(document, "article", { class: "grant" });
    row.append(element(document, "p", { "data-grant-action": grant.action ?? "", text: grant.action || t("unknown") }));
    row.append(element(document, "p", { "data-grant-pattern": "true", text: patternText(grant.pattern) || t("unknown") }));
    const busy = busyId === grant.id;
    if (busy) row.append(progressMark(document, t("working")));
    if (onRevoke) row.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "revoke-grant",
      "data-grant": grant.id,
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: t("revoke"),
      onclick: () => onRevoke(grant),
    }));
    block.append(row);
  }
  return block;
}

export function renderApproval(document, approval, t, onAnswer, busy = false, allowAlways = true) {
  const block = element(document, "section", { class: "card", "data-approval": approval.id, "data-approval-state": approval.state });
  block.append(element(document, "p", { text: approval.action === 'session.open' ? `${t('sessionOpenAsk')}: ${approval.pattern.client} CLI · ${approval.pattern.machine}` : approval.display ?? approval.action ?? approval.id }));
  if (!allowAlways) {
    block.append(element(document, "p", { class: "field-hint", "data-computer-required": "true", text: t("phoneComputerRequired") }));
    if (approval.desktopOnly) return block;
  }
  if (busy) block.append(progressMark(document, t("answering"), { "data-approval-progress": approval.id }));
  if (approval.state === "pending") {
    const button = (action, label) => element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": action,
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: label,
      onclick: () => onAnswer?.(approval, action),
    });
    block.append(button("approve", t("approve")));
    if (allowAlways && approval.alwaysAllowed !== false) block.append(button("approve-always", t("approveAlways")));
    block.append(button("deny", t("deny")));
  }
  return block;
}

export function renderTask(document, task, t, onStatus, onUndo, draft = "", onDraft, allowSendBack = canSendBack(task), busy = false) {
  const block = element(document, "section", { class: "card", "data-task": task.id, "data-reviewable": String(Boolean(task.reviewable)), "data-task-status": task.status });
  block.append(element(document, "p", { text: `${task.number} ${task.title}` }));
  if (busy) block.append(progressMark(document, t("working"), { "data-task-progress": task.id }));
  const accept = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "accept",
    "aria-busy": busy ? "true" : "false",
    text: t("accept"),
    onclick: () => onStatus?.(task, "done"),
  });
  if (!canAccept(task) || busy) accept.disabled = true;
  if (!canAccept(task) && !busy) {
    const hint = element(document, "p", { id: `reason-accept-${task.id}`, class: "field-hint", "data-disabled-reason": "accept", text: t("acceptNeedsReview") });
    accept.setAttribute("aria-describedby", hint.id ?? `reason-accept-${task.id}`);
    block.append(hint);
  }
  const note = element(document, "input", { "data-note": task.id, "data-keep": `note|${encodeURIComponent(task.id)}` });
  note.value = draft;
  note.required = true;
  const back = element(document, "button", {
    type: "button",
    class: "btn",
    "data-action": "send-back",
    text: t("sendBack"),
    onclick: () => { if (allowSendBack && !busy && note.value.trim()) onStatus?.(task, "open", note.value); },
  });
  const updateNote = () => { back.disabled = !allowSendBack || busy || !note.value.trim(); };
  note.addEventListener("input", () => { updateNote(); onDraft?.(note.value, note.selectionStart, note.selectionEnd); });
  updateNote();
  if (busy) back.setAttribute("aria-busy", "true");
  if (!allowSendBack && !busy) {
    const hint = element(document, "p", { id: `reason-back-${task.id}`, class: "field-hint", "data-disabled-reason": "send-back", text: t("sendBackNeedsReview") });
    back.setAttribute("aria-describedby", `reason-back-${task.id}`);
    block.append(hint);
  }
  block.append(accept, labeledField(document, t("sendBack"), t("sendBackHint"), note), back);
  if (task.undoAvailable && onUndo) {
    block.append(element(document, "button", {
      type: "button",
      class: "btn",
      "data-action": "undo",
      "aria-busy": busy ? "true" : "false",
      disabled: busy ? "" : null,
      text: t("undo"),
      onclick: () => onUndo?.(task),
    }));
  }
  return block;
}

export function renderWaiting(document, items, t, onOpen, emptyAction = null) {
  const activeCount = (items ?? []).filter((item) => item.state !== 'expired').length;
  const block = element(document, 'section', { class: 'waiting-list', 'data-waiting': String(activeCount) });
  if (!items?.length) {
    block.append(element(document, 'p', { 'data-empty': 'waiting', text: t('emptyWaiting') }));
    block.append(element(document, 'p', { class: 'field-hint', 'data-empty-next': 'waiting', text: t('emptyWaitingNext') }));
    if (emptyAction) block.append(emptyAction);
  }
  for (const section of waitingSections(items ?? [])) {
    if (!section.items.length) continue;
    block.append(element(document, 'h3', { class: 'waiting-section-title', text: t(section.key) }));
    for (const item of section.items) {
      const attrs = {
        'data-waiting-item': item.id,
        'data-kind': item.kind ?? '',
        'data-state': item.state ?? 'pending',
        'data-approval': item.approvalId ?? '',
        'data-task': item.taskId ?? '',
        'data-chat': item.chatId ?? '',
        'data-message': item.messageId ?? '',
        'data-unit': item.unitId ?? '',
        text: (item.title || item.kind || '') + (item.state === 'expired' ? ' · ' + t('expiredAsk') : ''),
      };
      if (onOpen) block.append(element(document, 'button', { type: 'button', class: 'btn', ...attrs, onclick: () => onOpen(item) }));
      else block.append(element(document, 'p', attrs));
    }
  }
  return block;
}

export function openTaskDetail(document, task, t) {
  const requirements = (task.requirements ?? []).join(", ");
  return element(document, "article", { "data-task-detail": task.id },
    element(document, "h3", { text: task.title ?? "" }),
    element(document, "p", { text: task.request ?? "" }),
    element(document, "p", { text: task.report ?? "" }),
    element(document, "p", { "data-requirements": requirements, text: `${t("requirements")}: ${requirements || t("unknown")}` }),
    element(document, "p", { "data-approved-by": task.approvedBy ?? "", text: `${t("approvedBy")}: ${task.approvedBy ?? t("unknown")}` }),
  );
}

function patternText(pattern) {
  if (!pattern || typeof pattern !== "object") return "";
  return Object.keys(pattern).sort().map((key) => `${key}: ${pattern[key]}`).join(", ");
}

export function waitingSections(items) {
  return [
    { key: 'asks', items: items.filter((item) => item.state !== 'expired' && item.kind !== 'review') },
    { key: 'reviews', items: items.filter((item) => item.state !== 'expired' && item.kind === 'review') },
    { key: 'endedWithoutAnswer', items: items.filter((item) => item.state === 'expired') },
  ];
}
