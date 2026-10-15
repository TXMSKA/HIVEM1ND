import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes, uuidV8 } from './identity.mjs';
import { readBytes, revisionOf, withLocalChanges, withLocks } from './store.mjs';
import { planBytes } from './plans.mjs';
import { appendRun, readRunRecord, runIds, runPrivateFile, deliverRunPointer, maintainRunLease, reconcileRunExtensions } from './runs.mjs';
import { dueRunActions, RUN_TIMING } from './run-policy.mjs';
import { queueNotice } from './chats.mjs';

const supervisors = new WeakMap();
const stamp = context => new Date(context.now()).toISOString();
const active = run => ['open', 'stopping'].includes(run.state);
const outboxFile = (context, id, actionId) => runPrivateFile(context, id, `outbox/${hashBytes(Buffer.from(actionId))}.json`);
const entry = (file, bytes, record) => ({ resource: file, recordPath: file, beforeRevision: revisionOf(bytes), afterBytes: planBytes(record), private: true });
async function saved(context, file) { const bytes = await readBytes(context.store, file); return { bytes, record: bytes ? JSON.parse(bytes) : null }; }

function episode(run, action) {
  if (action.kind === 'no_start') return run.attempts.find(a => a.id === action.attemptId && !a.resolved && a.confirmedAt === null);
  if (action.kind === 'stalled') return run.watches.find(w => !w.resolved && action.id.startsWith(`stalled:${w.episodeId}:`));
  if (['unread', 'unread_retry', 'message', 'resend'].includes(action.kind)) return run.messages.find(m => m.id === action.messageId)?.recipients.find(r => r.actorId === action.recipientId && r.readAt === null);
  return active(run);
}
function alertId(action) { return action.id.slice(0, -(action.target.length + 1)); }
function refreshAlerts(run) {
  for (const alert of run.alerts) {
    if (alert.kind === 'no_start') alert.resolved = !run.attempts.some(a => a.id === alert.attemptId && !a.resolved && a.confirmedAt === null);
    if (alert.kind === 'stalled') alert.resolved = !run.watches.some(w => !w.resolved && `stalled:${w.episodeId}` === alert.id);
    if (alert.kind === 'unread') alert.resolved = !run.messages.find(m => m.id === alert.messageId)?.recipients.some(r => r.actorId === alert.recipientId && r.readAt === null);
    if (!active(run)) alert.resolved = true;
  }
}

// Each outbox item and its immutable delivery identity commit before any transport is called.
export async function queueRunAction(context, run, action) {
  const file = outboxFile(context, run.id, action.id), before = await saved(context, file);
  if (before.record) return false;
  if (['no_start', 'stalled', 'unread'].includes(action.kind)) {
    const id = alertId(action);
    let alert = run.alerts.find(a => a.id === id);
    if (!alert) {
      alert = { id, kind: action.kind, attemptId: action.attemptId ?? null, messageId: action.messageId ?? null, recipientId: action.recipientId ?? null,
        at: new Date(action.dueAt).toISOString(), resolved: false, told: [], next: [], extensionId: null };
      run.alerts.push(alert);
    }
    if (!alert.next.some(n => n.target === action.target)) alert.next.push({ target: action.target, at: new Date(action.dueAt).toISOString() });
  }
  const record = { ...action, runId: run.id, deliveryId: uuidV8(['run-delivery', run.id, action.id]), state: 'pending', queuedAt: stamp(context), deliveredAt: null };
  await appendRun({ ...context, receipt: null }, run, { eventId: action.id, kind: 'queued', values: { action: action.kind, target: action.target ?? null }, state: 'wait' }, [entry(file, null, record)]);
  return true;
}

export async function checkRuns(context, { startsOnly = false } = {}) {
  return withLocks(context.store, ['run-supervision'], async () => {
    for (const id of await runIds(context)) {
      let run = (await readRunRecord(context, id)).record;
      if (run.machine !== context.paths.machine) continue;
      await reconcileRunExtensions(context, run);
      const lease = await maintainRunLease(context, run);
      await withLocalChanges(context.store, async () => {
        run = (await readRunRecord(context, id)).record;
        refreshAlerts(run);
        if (!active(run)) return;
        if (lease?.pausedReason || lease?.dailyResumesAt) {
          const capped = lease.dailyResumesAt ?? lease.pausedReason;
          const alertKey = `wake:${capped}`;
          if (!run.alerts.some(a => a.id === alertKey)) run.alerts.push({ id: alertKey, kind: 'wake_capped', at: stamp(context), resolved: false,
            attemptId: null, messageId: null, recipientId: null, extensionId: null, told: [{ target: 'person', at: stamp(context) }], next: [], resumesAt: lease.dailyResumesAt ?? null });
        } else for (const alert of run.alerts.filter(a => a.kind === 'wake_capped')) alert.resolved = true;
        const actions = dueRunActions(run, context.now()).filter(a => !startsOnly || a.kind === 'no_start');
        for (const action of actions) await queueRunAction(context, run, action);
        if (!startsOnly) {
          run.lastCheckedAt = stamp(context);
          await appendRun({ ...context, receipt: null }, run, { eventId: `checked:${context.now()}`, kind: 'checked', values: {} });
        }
      });
    }
    return deliverRunActions(context);
  });
}

export async function recoverOutbox(context) {
  // Unknown submissions keep their identity and await transport reconciliation. They are never blindly replayed.
  return deliverRunActions(context);
}
export async function deliverRunActions(context) {
  const results = [];
  for (const id of await runIds(context)) {
    const run = (await readRunRecord(context, id)).record;
    if (run.machine !== context.paths.machine) continue;
    let names;
    try { names = await readdir(runPrivateFile(context, id, 'outbox')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const records = await Promise.all(names.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => saved(context, runPrivateFile(context, id, `outbox/${n}`))));
    records.sort((a, b) => a.record.dueAt - b.record.dueAt || a.record.id.localeCompare(b.record.id));
    const latestSummary = Math.max(0, ...records.filter(r => r.record.kind === 'summary').map(r => r.record.slot));
    for (const item of records) {
      const action = item.record;
      if (['submitted', 'canceled'].includes(action.state)) continue;
      await withLocalChanges(context.store, async () => {
        const fresh = (await readRunRecord(context, id)).record, file = outboxFile(context, id, action.id), current = await saved(context, file);
        if (['submitted', 'canceled'].includes(current.record.state)) return;
        if (!active(fresh) || !episode(fresh, action) || action.kind === 'summary' && action.slot < latestSummary) {
          current.record.state = 'canceled';
          await appendRun({ ...context, receipt: null }, fresh, { eventId: `cancel:${action.id}`, kind: 'delivery_canceled', values: {} }, [entry(file, current.bytes, current.record)]); return;
        }
        // Ordering is by scheduled level, not successful delivery: an offline lead cannot hide the person warning.
        const reconcile = ['attempting', 'ambiguous'].includes(current.record.state);
        current.record.state = 'attempting';
        await appendRun({ ...context, receipt: null }, fresh, { eventId: `attempt:${action.id}`, kind: 'delivery_attempt', values: { deliveryId: action.deliveryId } }, [entry(file, current.bytes, current.record)]);
        let outcome;
        let deadline; const abort = new AbortController();
        try { outcome = await Promise.race([(context.runDelivery ?? deliverRunPointer)(context, fresh, { ...action, reconcile, signal: abort.signal }),
          new Promise(resolve => { deadline = setTimeout(() => { abort.abort(); resolve({ state: 'ambiguous' }); }, context.runDeliveryTimeoutMs ?? 3000); })]); }
        catch { outcome = { state: 'ambiguous' }; }
        finally { clearTimeout(deadline); }
        const after = await saved(context, file);
        const acknowledged = outcome?.state === 'submitted';
        after.record.state = acknowledged ? 'submitted' : outcome?.state === 'pending' || outcome?.state === 'failed' ? 'pending' : 'ambiguous';
        if (acknowledged) {
          after.record.deliveredAt = Number.isFinite(Date.parse(outcome.deliveredAt)) && Date.parse(outcome.deliveredAt) <= context.now() ? outcome.deliveredAt : stamp(context);
          if (action.kind === 'message') await queueNotice({ ...context, receipt: null }, { messageId: action.messageId, unitId: action.recipientId, state: 'submitted', submittedAt: after.record.deliveredAt });
          if (action.kind === 'summary') fresh.summarySlot = Math.max(fresh.summarySlot, action.slot);
          const tracked = episode(fresh, action);
          if (['no_start', 'stalled', 'unread'].includes(action.kind)) {
            if (!tracked.notifications.includes(action.target)) tracked.notifications.push(action.target);
            const alert = fresh.alerts.find(a => a.id === alertId(action));
            if (alert && !alert.told.some(t => t.target === action.target)) alert.told.push({ target: action.target, at: after.record.deliveredAt });
            if (alert) alert.next = alert.next.filter(n => n.target !== action.target);
          }
          if (action.kind === 'unread_retry' || action.kind === 'resend') tracked.retriedAt ??= stamp(context);
        }
        await appendRun({ ...context, receipt: null }, fresh, { eventId: `delivery:${action.id}`, kind: acknowledged ? 'delivered' : 'delivery_pending', state: acknowledged ? 'done' : 'wait',
          values: { action: action.kind, target: action.target ?? null, deliveryId: action.deliveryId, deliveredAt: after.record.deliveredAt } }, [entry(file, after.bytes, after.record)]);
        results.push({ id: action.id, state: after.record.state });
      });
    }
  }
  return results;
}

export async function openRunSupervisor(context) {
  if (supervisors.has(context.store)) return supervisors.get(context.store);
  let closed = false, pending = Promise.resolve(), scan = null, openCount = 0;
  const starts = new Map();
  const schedule = (fn, delay) => { const timer = context.schedule ? context.schedule(fn, delay) : setTimeout(fn, delay); timer?.unref?.(); return timer; };
  const cancel = timer => { if (timer == null) return; if (context.cancelSchedule) context.cancelSchedule(timer); else clearTimeout(timer); };
  const serial = fn => { pending = pending.then(() => closed ? undefined : fn()).catch(error => { supervisor.lastError = error; }); return pending; };
  const arm = async () => {
    if (closed) return;
    const needed = new Map();
    openCount = 0;
    let hasOpen = false;
    for (const id of await runIds(context)) {
      const run = (await readRunRecord(context, id)).record;
      if (run.machine !== context.paths.machine) continue;
      if (!active(run)) { await maintainRunLease(context, run); continue; }
      hasOpen = true;
      openCount++;
      for (const attempt of run.attempts.filter(a => !a.resolved && a.confirmedAt === null)) {
        const due = Date.parse(attempt.sentAt) + RUN_TIMING.start;
        if (due > context.now()) needed.set(`${id}:${attempt.id}`, due);
      }
    }
    for (const [key, timer] of starts) if (!needed.has(key)) { cancel(timer); starts.delete(key); }
    for (const [key, due] of needed) if (!starts.has(key)) starts.set(key, schedule(() => {
      starts.delete(key); void serial(async () => { await checkRuns(context, { startsOnly: true }); await arm(); });
    }, due - context.now()));
    if (hasOpen && scan === null) scan = schedule(() => { scan = null; void serial(async () => { await checkRuns(context); await arm(); }); }, RUN_TIMING.scan);
    if (!hasOpen && scan !== null) { cancel(scan); scan = null; }
  };
  const supervisor = { lastError: null, check: () => serial(async () => { await checkRuns(context); await arm(); }),
    async close() { closed = true; cancel(scan); scan = null; for (const timer of starts.values()) cancel(timer); starts.clear(); context.bus?.release(subscription); await pending;
      await (context.runWake ?? context.store.runWake)?.stopRunActors?.(); supervisors.delete(context.store); },
    get timerCount() { return starts.size + Number(scan !== null); } };
  Object.defineProperty(supervisor, 'openCount', { get: () => openCount });
  supervisors.set(context.store, supervisor);
  const subscription = context.bus?.subscribe({ stableId: 'run-supervisor', audience: 'desktop', capabilities: ['read'] }, {}, frame => {
    if (['run.changed', 'run.closed'].includes(frame.name)) void serial(arm);
  });
  await checkRuns(context); await arm();
  return supervisor;
}
export async function closeRunSupervisor(context) { await supervisors.get(context.store)?.close(); }
