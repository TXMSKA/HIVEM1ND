import { canAccept, canSendBack } from "./actions.mjs";
import { clientLabel, clusterLead } from './clusters.mjs';
import { element, icon, labeledField, pathIcon, progressMark } from "./components.mjs";
import { formatWhen } from "./i18n.mjs";
import { displayName, hierarchyIcon, readableIdentity, unitDisplayName, upperFirst } from './hierarchy.mjs';
import { roleLabel, startText } from './start-copy.mjs';
import { addText } from './add-view.mjs';

// "Starts fresh every session" is only true of an Overseer that holds nothing: a unit with sessions, unread messages or a
// recorded state keeps what it has, so it does not say so.
export function startsFresh(unit) {
  if (unit?.role !== 'overseer' || unit.fresh === false) return false;
  return !(unit.sessionIds?.length || unit.unread > 0 || unit.context || unit.date);
}

export function renderAgentHeader(document, unit, session, language, onMore) {
  const t = key => startText(language, key), working = ['busy', 'working', 'active'].includes(session?.activity);
  return element(document, 'header', { class: 'agent-heading' },
    element(document, 'span', { class: 'agent-avatar', 'aria-hidden': 'true' }, icon(document, unit.role === 'overseer' ? 'crown' : 'executor')),
    element(document, 'div', {}, element(document, 'h2', { text: unitDisplayName(unit) }),
      element(document, 'p', { class: 'agent-status' }, working ? element(document, 'span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
        startsFresh(unit) ? t('freshStatus') : t(working ? 'busy' : 'pending'))),
    element(document, 'button', { type: 'button', class: 'icon-button agent-more', 'data-action': 'agent-more', 'aria-label': t('moreMenu'), text: '···', onclick: onMore }));
}

const clusterMembers = (cluster, units) => (units ?? []).filter(unit => !unit.removed && unit.role !== 'master' && cluster.members.includes(unit.id));

// The one line under a cluster's name: what it is, what it holds and how many agents work in it.
export function clusterSummary(model) {
  const t = (key, values) => startText(model.language, key, values);
  const cluster = model.cluster, kind = cluster.link?.kind ?? 'none', repositories = (model.children ?? []).length, agents = clusterMembers(cluster, model.units).length;
  const parts = [t(kind === 'repository' ? 'repository' : kind === 'folder' ? 'folder' : 'notLinked')];
  if (kind === 'folder' && repositories) parts.push(t(repositories === 1 ? 'repositoryOne' : 'repositoryMany', { count: repositories }));
  if (kind === 'repository' && model.git?.branch) parts.push(t('onBranch', { branch: model.git.branch }));
  parts.push(!agents ? t('agentsNone') : t(agents === 1 ? 'agentOne' : 'agentMany', { count: agents }));
  return parts.join(', ');
}

export function renderCluster(document, model, actions = {}) {
  const t = (key, values) => startText(model.language, key, values);
  const cluster = model.cluster;
  const root = element(document, 'section', { class: 'cluster-inspector', 'data-cluster-inspector': cluster.id });
  const action = (key, id, run) => element(document, 'button', { type: 'button', class: 'icon-button',
    'data-action': id, 'aria-label': t(key), title: t(key), onclick: run });
  const add = action('newAgent', 'new-agent', actions.onNewAgent); add.replaceChildren(icon(document, 'plus'));
  const more = action('moreMenu', 'cluster-more', actions.onMore); more.replaceChildren(pathIcon(document, 'M5 12h.1M12 12h.1M19 12h.1'));
  root.append(element(document, 'header', { class: 'cluster-heading' }, element(document, 'span', { class: 'cluster-avatar', 'aria-hidden': 'true' }, icon(document, 'folder')),
    element(document, 'div', {}, element(document, 'h2', { text: displayName(cluster.title) }), element(document, 'p', { 'data-cluster-summary': 'true', text: clusterSummary(model) })),
    add, more));
  if (model.addition) {
    const item = model.addition;
    root.append(element(document, 'section', { class: 'cluster-origin', 'data-cluster-origin': item.id },
      element(document, 'button', { type: 'button', class: 'add-origin', 'aria-label': addText(model.language, 'checkUpdates'),
        text: addText(model.language, 'projectOrigin', { source: item.source.display }), onclick: () => actions.onUpdate?.(item) }),
      element(document, 'p', { class: 'start-hint', text: addText(model.language, 'pinned', { kind: addText(model.language, item.pin.kind), pin: item.pin.kind === 'commit' ? item.pin.value.slice(0, 7) : item.pin.value }) })));
  }
  return root;
}

// A cluster's Details tab: what it is and where it lives, then the agents that work in it.
export function renderClusterDetails(document, model, actions = {}) {
  const t = (key, values) => startText(model.language, key, values);
  const cluster = model.cluster, kind = cluster.link?.kind ?? 'none';
  const action = (key, id, run, look = 'btn') => element(document, 'button', { type: 'button', class: look, 'data-action': id, text: t(key), onclick: run });
  const root = element(document, 'section', { class: 'agent-details cluster-details', 'data-cluster-details': cluster.id, role: 'tabpanel',
    id: `session-${cluster.id}-panel`, 'aria-labelledby': `session-${cluster.id}-details` });
  const card = (key, ...parts) => root.append(element(document, 'section', { class: 'details-section', 'data-details-section': key },
    element(document, 'h3', { class: 'details-section-title', text: t(key) }), ...parts.filter(Boolean)));
  const fact = (label, value, attributes = {}) => element(document, 'p', { class: 'fact', ...attributes },
    element(document, 'span', { class: 'fact-label', text: label }), typeof value === 'string' ? element(document, 'span', { class: 'fact-value', text: value }) : element(document, 'span', { class: 'fact-value' }, value));
  const facts = element(document, 'div', { class: 'unit-facts cluster-facts' }, fact(t('kind'), t(kind === 'repository' ? 'repository' : kind === 'folder' ? 'folder' : 'notLinked')));
  // The folder is shown once the machine's reports are in; until then it loads, and without it the folder is said to be missing here.
  if (kind !== 'none') {
    if (model.link?.localPath) facts.append(fact(t('path'), element(document, 'code', { text: model.link.localPath })));
    else if (model.loading) facts.append(fact(t('path'), progressMark(document, t('loadingFolder'))));
    else facts.append(fact(t('path'), t(model.unreadable ? 'unavailable' : 'notOnMachine'), { 'data-folder-missing': 'true' }));
  }
  const children = model.children ?? [];
  if (kind === 'folder' && children.length) facts.append(fact(t('repositories'), children.map(child => displayName(child.title)).join(', ')));
  if (kind === 'repository' && model.git) facts.append(fact(t('branch'), element(document, 'code', { text: model.git.branch ?? 'HEAD' })));
  const git = model.git, parts = [facts];
  if (git) {
    if (git.remote) parts.push(element(document, 'code', { class: 'cluster-remote', text: git.remote }));
    parts.push(element(document, 'p', { class: 'cluster-dirty', text: t(git.dirtyCount === 1 ? 'changedOne' : 'changedMany', { count: git.dirtyCount }) }));
    if (git.lastCommit) parts.push(element(document, 'p', { class: 'start-hint', text: [git.lastCommit.subject, formatWhen(model.language, git.lastCommit.at)].join(' · ') }));
    parts.push(element(document, 'div', { class: 'action-row' }, action('changes', 'cluster-changes', actions.onChanges), action('openEditor', 'cluster-open-editor', actions.onEditor)));
  } else if (kind === 'none') parts.push(element(document, 'p', { class: 'start-hint', text: t('noLinkBody') }), action('linkFolder', 'link-folder', actions.onLink));
  if (model.error) parts.push(element(document, 'p', { role: 'alert', text: model.error }));
  card('cluster', ...parts);
  const members = clusterMembers(cluster, model.units), lead = clusterLead(cluster, model.units);
  const lines = members.map(unit => element(document, 'p', { class: 'cluster-agent', 'data-cluster-agent': unit.id }, icon(document, hierarchyIcon(unit)),
    element(document, 'span', { class: 'cluster-agent-name', text: unitDisplayName(unit) }), element(document, 'span', { class: 'cluster-agent-role', text: roleLabel(model.language, unit.role, unit.roleName) })));
  if (members.length) card('agents', ...lines);
  else card('agents', element(document, 'p', { class: 'cluster-agents-empty', text: kind === 'folder' && children.length ? t(children.length === 1 ? 'noAgentsFolderOne' : 'noAgentsFolder', { count: children.length }) : t('noAgentsHere') }),
    element(document, 'div', { class: 'action-row' }, action('newAgent', 'new-agent-card', actions.onNewAgent, 'btn primary'), lead ? null : action('choosePlanner', 'choose-planner', actions.onChoosePlanner, 'btn ghost')));
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
  // A custom role shows the name its person gave it; a role the app does not know shows as an agent, never as its id.
  card.append(element(document, "p", { text: `${t("role")}: ${unit?.role ? roleLabel(language, unit.role, unit.roleName) : t("unknown")}` }));
  card.append(element(document, "p", { text: `${t("job")}: ${unit?.job ?? t("unknown")}` }));
  const lines = [
    // The root scope is every cluster; any other scope is named.
    ["worksIn", unit?.scope?.kind === 'root' ? upperFirst(startText(language, 'everyCluster')) : unit?.scope?.name ?? unit?.scope?.kind],
    // The lead by its name, never its scoped id.
    ["lead", unit?.leadId ? readableIdentity(unit.leadId, t("person")) : null],
    ["model", unit?.model],
    ["machine", unit?.machine],
    ["branch", unit?.branch],
    ["date", shownDate(language, unit?.date)],
  ];
  const facts = element(document, "div", { class: "unit-facts", "data-unit-facts": "true" });
  for (const [label, value] of lines) {
    facts.append(element(document, "p", { text: `${t(label)}: ${value ?? t("unknown")}` }));
  }
  // "Ready." is the body every new unit starts with; it says nothing about this one.
  if (unit?.context && unit.context.trim() !== "Ready.") facts.append(element(document, "p", { class: "unit-context", text: unit.context }));
  card.append(facts);
  return card;
}

const CHECKOUT_REASONS = {
  manual: 'checkoutManual', other_machine: 'checkoutOtherMachine', unverified: 'checkoutUnverified',
  git_unavailable: 'checkoutGit', not_observed: 'checkoutNotSeen',
};

// The folder and branch rows of an agent's facts: [copy key, value, tooltip]. Nothing is guessed: an unknown
// folder says so, a branch nobody knows is not a row, and a stopped session keeps its last reading marked with the time it was last seen.
// A unit of the root scope works in every cluster, so for it an unknown folder is not "Not known".
export function checkoutFacts(t, language, { session, local, entry, root = false }) {
  if (!session) return [];
  const stopped = session.state === 'stopped';
  const unknown = reason => [root ? ['worksIn', upperFirst(startText(language, 'everyCluster')), null] : ['worksIn', t('notKnown'), t(reason)]];
  if (session.machine && session.machine !== local) return stopped ? [] : unknown('checkoutOtherMachine');
  const data = entry?.data;
  if (!data) return entry?.error && !stopped ? unknown('checkoutFailed') : [];
  if (data.known === false) return stopped ? [] : unknown(CHECKOUT_REASONS[data.reason] ?? 'checkoutUnverified');
  const seen = data.live === false ? ` · ${t('lastSeen', { time: formatWhen(language, data.observedAt) })}` : '';
  const folder = data.kind === 'private' ? t('checkoutPrivate') : String(data.path).split(/[\\/]+/).filter(Boolean).at(-1) ?? data.path;
  const rows = [['worksIn', `${folder}${data.kind === 'worktree' ? ` · ${t('worktree')}` : ''}${seen}`, data.path]];
  const branch = data.detached ? t('detachedAt', { head: String(data.head ?? '').slice(0, 7) }) : data.branch;
  if ((data.kind === 'repository' || data.kind === 'worktree') && branch) rows.push(['branch', `${branch}${seen}`, null]);
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

// `brief` is the compact card of a review opened in Waiting: what was asked in place of the task's number and title, and a way to open the task.
// There the note is asked for only once Send back is pressed (`noteShown` says it already was, `onReveal` keeps that across redraws): the
// first press shows and focuses the required note, the second sends it.
export function renderTask(document, task, t, onStatus, onUndo, draft = "", onDraft, allowSendBack = canSendBack(task), busy = false, brief = null) {
  const block = element(document, "section", { class: brief ? "card waiting-review" : "card", "data-task": task.id, "data-reviewable": String(Boolean(task.reviewable)), "data-task-status": task.status });
  if (!brief) block.append(element(document, "p", { text: `${task.number} ${task.title}` }));
  else if (brief.request) block.append(element(document, "p", { class: "waiting-request", text: brief.request }));
  if (busy) block.append(progressMark(document, t("working"), { "data-task-progress": task.id }));
  const accept = element(document, "button", {
    type: "button",
    class: brief ? "btn primary" : "btn",
    "data-action": "accept",
    "aria-busy": busy ? "true" : "false",
    text: t("accept"),
    onclick: () => onStatus?.(task, "done"),
  });
  let acceptHint = null, backHint = null;
  if (!canAccept(task) || busy) accept.disabled = true;
  if (!canAccept(task) && !busy) {
    const hint = element(document, "p", { id: `reason-accept-${task.id}`, class: "field-hint", "data-disabled-reason": "accept", text: t("acceptNeedsReview") });
    accept.setAttribute("aria-describedby", hint.id ?? `reason-accept-${task.id}`);
    acceptHint = hint;
  }
  const note = element(document, "input", { "data-note": task.id, "data-keep": `note|${encodeURIComponent(task.id)}` });
  note.value = draft;
  note.required = true;
  const field = labeledField(document, t("sendBack"), t("sendBackHint"), note);
  let asked = !brief || brief.noteShown === true || Boolean(draft);
  if (!asked) field.setAttribute("hidden", "");
  const back = element(document, "button", {
    type: "button",
    class: brief ? "btn ghost" : "btn",
    "data-action": "send-back",
    text: t("sendBack"),
    onclick: () => {
      if (!allowSendBack || busy) return;
      if (!asked) {
        asked = true;
        field.removeAttribute("hidden");
        brief.onReveal?.();
        updateNote();
        note.focus?.();
      } else if (note.value.trim()) onStatus?.(task, "open", note.value);
    },
  });
  const updateNote = () => { back.disabled = !allowSendBack || busy || (asked && !note.value.trim()); };
  note.addEventListener("input", () => { updateNote(); onDraft?.(note.value, note.selectionStart, note.selectionEnd); });
  updateNote();
  if (busy) back.setAttribute("aria-busy", "true");
  if (!allowSendBack && !busy) {
    const hint = element(document, "p", { id: `reason-back-${task.id}`, class: "field-hint", "data-disabled-reason": "send-back", text: t("sendBackNeedsReview") });
    back.setAttribute("aria-describedby", `reason-back-${task.id}`);
    backHint = hint;
  }
  if (brief) {
    const open = element(document, "button", { type: "button", class: "btn ghost", "data-action": "open-task", text: t("waitingOpenTask"), onclick: brief.onOpen });
    block.append(field, element(document, "div", { class: "waiting-actions" }, accept, back, open), ...[acceptHint, backHint].filter(Boolean));
  } else {
    // Each control is followed by the reason it cannot be used.
    block.append(...[accept, acceptHint, field, back, backHint].filter(Boolean));
  }
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

// The first paragraph of what a task asked, on one line, cut on a word boundary when it is long.
export function requestBrief(request, limit = 240) {
  const first = String(request ?? "").split(/\n\s*\n/).find((part) => part.trim()) ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (line.length <= limit) return line;
  const head = line.slice(0, limit);
  return `${(/\s/.test(line[limit]) ? head : head.replace(/\s+\S*$/, "")).replace(/[\s,;:.-]+$/, "")}…`;
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
