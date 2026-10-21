// The work queue. A slow action leaves its dialog at once and runs here, in the background, one after another, so several
// deletions stack instead of each holding a dialog open. Every item has its own notice with a bar; the bell lists them all.
//
// An item is { label, run(report), onDone(result), steps }. run may call report(done, total) to move its bar; without it the
// bar shows work in progress. A failed item keeps its error and can be retried: run is called again, so it must reuse its own
// operation (the idempotency key) to replay a write the service may already have applied.

export function createQueue({ onChange = () => {}, now = () => Date.now() } = {}) {
  const items = [];
  let running = null, sequence = 0;
  const changed = () => { try { onChange(items); } catch { /* drawing must never stop the queue */ } };

  function add({ label, run, onDone = null, steps = null, kind = 'action' }) {
    const item = { id: `job-${++sequence}`, label, kind, run, onDone, state: 'waiting', error: null,
      progress: Number.isInteger(steps) && steps > 0 ? { done: 0, total: steps } : null, addedAt: now(), startedAt: null, endedAt: null };
    items.push(item);
    changed();
    pump();
    return item;
  }

  async function pump() {
    if (running) return;
    const next = items.find(item => item.state === 'waiting');
    if (!next) return;
    running = next;
    next.state = 'running';
    next.startedAt = now();
    changed();
    const report = (done, total = next.progress?.total ?? done) => { next.progress = { done, total }; changed(); };
    try {
      next.result = await next.run(report, next);
      next.state = 'done';
      next.endedAt = now();
      changed();
      try { await next.onDone?.(next.result, next); } catch { /* the work itself succeeded */ }
    } catch (error) {
      next.state = 'failed';
      next.error = error;
      next.endedAt = now();
    }
    running = null;
    changed();
    pump();
  }

  function retry(id) {
    const item = items.find(entry => entry.id === id && entry.state === 'failed');
    if (!item) return;
    item.state = 'waiting';
    item.error = null;
    changed();
    pump();
  }

  function dismiss(id) {
    const index = items.findIndex(entry => entry.id === id);
    if (index < 0 || ['running', 'waiting'].includes(items[index].state)) return;
    items.splice(index, 1);
    changed();
  }

  function clearFinished() {
    for (let index = items.length - 1; index >= 0; index -= 1) if (['done', 'failed'].includes(items[index].state)) items.splice(index, 1);
    changed();
  }

  return {
    add, retry, dismiss, clearFinished,
    get items() { return [...items]; },
    // What still needs attention: waiting, running, or failed and not yet dismissed.
    get open() { return items.filter(item => item.state !== 'done'); },
    get busy() { return Boolean(running) || items.some(item => item.state === 'waiting'); },
  };
}
