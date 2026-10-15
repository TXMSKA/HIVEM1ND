import { createOperation, request } from './api.mjs';
import { element, icon, progressMark } from './components.mjs';
import { formatClock } from './i18n.mjs';
import { startText } from './start-copy.mjs';

export function createSessionView(session) {
  return { session, tab: 'chat', work: [], nextCursor: null, workLoaded: false, scrollTop: 0,
    context: null, error: null, contextError: null, pending: null, operations: new Map(), startedOpen: false };
}

export async function loadSessionView(api, view, { older = false, context = false } = {}) {
  if (context) {
    const ticket = (view.contextTicket ?? 0) + 1; view.contextTicket = ticket;
    try {
      const result = await request(api, 'GET', `/sessions/${encodeURIComponent(view.session.id)}/context`);
      if (ticket === view.contextTicket) { view.context = result.data; view.contextError = view.context.operation?.state === 'failed' ? view.context.operation.error : null; }
    } catch (error) { if (ticket === view.contextTicket) view.contextError = error; }
    return view;
  }
  try {
    const result = await request(api, 'GET', `/sessions/${encodeURIComponent(view.session.id)}/work`, {
      query: { limit: 50, ...(older && view.nextCursor ? { cursor: view.nextCursor } : {}) },
    });
    const byId = new Map(view.work.map(item => [item.id, item]));
    for (const item of result.data.items) byId.set(item.id, item);
    view.work = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
    view.workCursor = view.work.at(-1)?.sequence ?? 0;
    view.nextCursor = result.data.nextCursor; view.workLoaded = true; view.error = null;
  } catch (error) { view.error = error; }
  return view;
}

export function changeContext(api, view, action, notify = () => {}) {
  if (view.pending) return view.pending;
  const context = view.context;
  if (!context) return Promise.reject(new Error('Context unavailable.'));
  const key = `${context.generationId}:${action}`;
  const operation = view.operations.get(key) ?? createOperation({ method: 'POST', path: '/sessions/:sessionId/context',
    params: { sessionId: view.session.id }, body: { action, expectedRevision: context.revision } });
  view.operations.set(key, operation); view.contextError = null;
  view.pending = Promise.resolve().then(async () => {
    const response = await request(api, 'POST', operation.path, { operation });
    if (view.context === context || view.context?.generationId === context.generationId && view.context?.operation?.state !== 'applied') view.context = response.data.context;
    await loadSessionView(api, view, { context: true });
    if (view.context?.operation?.state === 'failed') view.contextError = view.context.operation.error;
    return response;
  }).catch(error => { view.contextError = error; throw error; }).finally(() => { view.pending = null; notify(); });
  notify(); return view.pending;
}

export function renderSessionTabs(document, view, language, onChange) {
  const root = element(document, 'div', { class: 'session-tabs', role: 'tablist', 'aria-label': startText(language, 'work') });
  const names = ['chat', 'work'];
  for (const name of names) {
    const tab = element(document, 'button', { type: 'button', role: 'tab', id: `session-${view.session.id}-${name}`,
      class: 'session-tab', 'data-action': `session-${name}`, 'aria-selected': String(view.tab === name),
      'aria-controls': `session-${view.session.id}-panel`, tabindex: view.tab === name ? '0' : '-1',
      text: startText(language, name), onclick: () => onChange(name), onkeydown: event => {
        const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'work'
          : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? names[(names.indexOf(name) + 1) % 2] : null;
        if (next) { event.preventDefault(); onChange(next); }
      } });
    root.append(tab);
  }
  return root;
}

export function renderStartedWith(document, descriptor, language, { open = false, onToggle, cluster = '', task = '' } = {}) {
  if (!descriptor) return null;
  const t = (key, values) => startText(language, key, values);
  const root = element(document, 'details', { class: 'started-with', 'data-started-with': 'true', ...(open ? { open: '' } : {}),
    ontoggle: () => onToggle?.(root.open) });
  root.append(element(document, 'summary', {}, icon(document, 'document'), element(document, 'span', {},
    element(document, 'strong', { text: t('startedWith') }),
    element(document, 'span', { text: t('startedSummary', { role: descriptor.role ?? '', cluster, task: task || descriptor.taskId || '' }) }))));
  const references = element(document, 'ul');
  for (const reference of descriptor.references ?? []) references.append(element(document, 'li', {}, element(document, 'code', { text: reference })));
  root.append(references); return root;
}

const STEP_KEYS = { tests: 'tests', build: 'build', edit: 'editStep', plan: 'planStep', review: 'review', work: 'workStep',
  confirmed: 'confirmed', reported: 'reported', exited: 'exited', cleaned: 'cleaned', start: 'confirmed', report: 'reported', exit: 'exited', cleanup: 'cleaned' };

function workRows(records) {
  const rows = [];
  for (const record of records) {
    if (record.kind === 'step_end') {
      const started = rows.findLast(row => row.state === 'busy' && row.kind === 'step_start' && row.values?.step === record.values?.step
        && row.role === record.role && row.taskId === record.taskId && (!record.stepKey || row.stepKey === record.stepKey));
      if (started) { Object.assign(started, { state: record.state, endedAt: record.at }); continue; }
    }
    rows.push({ ...record });
  }
  return rows;
}

export function renderSessionWork(document, view, language, actions = {}, now = Date.now()) {
  const t = (key, values) => startText(language, key, values);
  const root = element(document, 'section', { class: 'session-work', 'data-session-work': view.session.id,
    id: `session-${view.session.id}-panel`, role: 'tabpanel', 'aria-labelledby': `session-${view.session.id}-work` });
  root.append(element(document, 'p', { class: 'work-hint', text: t('workHint') }));
  for (const record of workRows(view.work)) {
    const step = record.values?.step ?? record.kind ?? record.key;
    const startedAt = Date.parse(record.at);
    const elapsed = record.state === 'busy' && Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 60000)) : null;
    root.append(element(document, 'div', { class: 'work-step', 'data-work-sequence': record.sequence, 'data-state': record.state },
      element(document, 'time', { class: 'work-time', text: formatClock(language, record.at) }),
      element(document, 'span', { class: record.state === 'busy' ? 'spinner' : 'work-check', 'aria-label': t(record.state === 'busy' ? 'busy' : record.state === 'fail' ? 'failed' : 'done'), text: record.state === 'busy' ? '' : record.state === 'fail' ? '!' : '✓' }),
      element(document, 'div', {}, element(document, 'p', { text: t(STEP_KEYS[step] ?? 'workStep') }),
        elapsed !== null ? element(document, 'small', { 'data-work-elapsed': record.sequence, text: t('minutes', { count: elapsed }) }) : null)));
  }
  if (view.error) root.append(element(document, 'p', { role: 'alert', text: t('unavailable') }),
    element(document, 'button', { class: 'btn', type: 'button', 'data-action': 'retry-work', text: t('retry'), onclick: actions.onRetry }));
  if (view.nextCursor) root.append(element(document, 'button', { class: 'btn', type: 'button', 'data-action': 'older-work', text: t('more', { count: '' }), onclick: actions.onMore }));
  // Stopping the step shows progress on its button and its outcome here; the session itself stays open.
  if (view.stopOutcome) root.append(element(document, 'p', { class: 'work-outcome', role: 'status', 'data-stop-outcome': view.stopOutcome.state,
    text: t(view.stopOutcome.state === 'failed' ? 'stepNotStopped' : view.stopOutcome.state === 'idle' ? 'stepIdle' : 'stepStopped') }));
  const stopping = view.stopping === true;
  root.append(element(document, 'div', { class: 'work-actions' },
    element(document, 'button', { class: 'btn ghost', type: 'button', 'data-action': 'stop-step', disabled: stopping ? '' : null, 'aria-busy': stopping ? 'true' : null,
      onclick: actions.onStop }, stopping ? progressMark(document, t('stoppingStep')) : t('stopStep')),
    element(document, 'small', { text: t('transcriptHint') })));
  return root;
}

export function renderContext(document, view, language, onAction) {
  const t = (key, values) => startText(language, key, values), context = view.context;
  const percent = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : null;
  const estimated = context?.estimated === true, waiting = percent !== null && percent >= 80;
  const root = element(document, 'section', { class: 'session-context', 'data-context-generation': context?.generationId ?? '', 'data-estimated': String(estimated) });
  const label = percent === null ? t('contextUnknown') : t(estimated ? 'contextEstimated' : 'contextFull', { percent: Math.round(percent) });
  root.append(element(document, 'div', { class: 'context-label' }, element(document, 'span', { text: t('context') }), element(document, 'span', { text: label })));
  if (percent !== null) {
    const fill = element(document, 'span', { class: 'context-fill' }); fill.style.width = `${percent}%`;
    root.append(element(document, 'div', { class: 'context-bar' + (waiting ? ' is-full' : ''), role: 'meter', 'aria-label': label,
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent }, fill));
  }
  if (waiting && !context.dismissed || view.contextError || context?.operation?.state === 'pending') {
    const pending = Boolean(view.pending || context?.operation?.state === 'pending');
    const button = action => element(document, 'button', { type: 'button', class: action === 'compact' ? 'btn primary' : 'btn',
      'data-action': `context-${action}`, 'aria-label': t(action === 'dismiss' ? 'close' : action), disabled: pending ? '' : null,
      'aria-busy': pending ? 'true' : null, onclick: () => onAction(action) }, pending ? progressMark(document, t('working')) : t(action === 'dismiss' ? 'close' : action));
    const notice = element(document, 'section', { class: 'context-notice', 'data-context-notice': 'true' },
      element(document, 'header', {}, icon(document, 'alert'), element(document, 'strong', { text: percent === null ? label : t(estimated ? 'contextEstimated' : 'contextNotice', { percent: Math.round(percent) }) }), button('dismiss')),
      element(document, 'p', { text: t('contextHint') }), element(document, 'div', { class: 'action-row' }, button('compact'), button('clear')));
    if (view.contextError) notice.append(element(document, 'p', { role: 'alert', text: t('unavailable') }), element(document, 'button', {
      type: 'button', class: 'btn', 'data-action': 'retry-context', text: t('retry'), onclick: () => onAction(context?.operation?.action ?? [...view.operations.values()].at(-1)?.body.action ?? 'compact') }));
    root.append(notice);
  }
  return root;
}

export async function loadTranscriptPage(api, sessionId, cursor = null) {
  return (await request(api, 'GET', `/sessions/${encodeURIComponent(sessionId)}/transcript`, { query: { limit: 50, ...(cursor ? { cursor } : {}) } })).data;
}
