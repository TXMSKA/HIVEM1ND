import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './identity.mjs';

// The owned process handle of a native client that HIVEM1ND itself spawned.
// identity = pid plus creation time, so a recycled pid is never mistaken for the child.
// stop() ends the whole tree; cleanup() proves, after the exit, that no recorded descendant remains.
export const STOP_GRACE_MS = 5000;
const SETTLE_MS = 5000;
const POLL_MS = 150;

function unavailable(message = 'Owned execution cleanup cannot be verified.') { return new CoreError(409, 'cleanup_unavailable', message); }
const sleep = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

// A POSIX client runs in its own process group so one signal reaches every descendant.
export function ownedSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true };
}

function run(file, args, { timeout = 20000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, shell: false, timeout, maxBuffer: 8_000_000, encoding }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); } else resolve(stdout);
    });
  });
}

function systemTool(...parts) {
  return path.join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', ...parts);
}

// Windows. The kit never starts PowerShell, and Windows prints no process creation time or parent id without it or WMIC.
// So the identity's creation time is the instant the service recorded when it spawned the child, and the live check is the
// ChildProcess handle itself: while the service holds it, Windows cannot give the pid to another process. Descendants are
// the pids that taskkill /T reports it ended, in any language, since each report line names the ended pid first.
function windowsDriver() {
  const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  return {
    async creation(pid, context = {}) {
      const { child, recorded, spawnedAt } = context;
      if (!child || child.exitCode != null || child.signalCode != null || !exists(pid)) return null;
      return recorded ?? new Date(spawnedAt ?? Date.now()).toISOString();
    },
    // Nothing can be listed before the kill; what is ended is read from the kill report.
    async descendants() { return []; },
    async alive(targets) { return targets.filter(target => exists(target.pid)); },
    async terminate(pid) {
      let output = '';
      try { output = await run(systemTool('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { timeout: 15000, encoding: 'latin1' }); }
      catch (error) {
        // 128 means the process is already gone, which is the state being asked for. A failure to start the tool is not.
        if (typeof error.code !== 'number') throw error;
        output = error.stdout ?? '';
      }
      const killed = [];
      for (const line of String(output).split(/\r?\n/)) {
        const first = /\d+/.exec(line);
        const found = first ? Number(first[0]) : 0;
        if (found > 0 && found !== pid && !killed.some(item => item.pid === found)) killed.push({ pid: found, created: null });
      }
      return { killed };
    },
    async escalate() {},
    // After a root that ended by itself the pid is only swept while no other process holds it, so an unrelated tree is never touched.
    sweepable(pid) { return !exists(pid); },
  };
}

// Linux: /proc/<pid>/stat start time, and the process group of a client spawned detached.
function linuxDriver() {
  const stat = async pid => {
    let text;
    try { text = await readFile(`/proc/${pid}/stat`, 'utf8'); } catch { return null; }
    const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { pid, parent: Number(rest[1]), group: Number(rest[2]), created: rest[19] };
  };
  const table = async () => {
    const rows = [];
    for (const name of await readdir('/proc')) if (/^\d+$/.test(name)) { const row = await stat(Number(name)); if (row) rows.push(row); }
    return rows;
  };
  const signal = (pid, name) => { try { process.kill(-pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  return {
    async creation(pid) { return (await stat(pid))?.created ?? null; },
    async descendants(pid) {
      const rows = await table(), found = new Map();
      const add = row => { if (row.pid !== pid && !found.has(row.pid)) found.set(row.pid, { pid: row.pid, created: row.created }); };
      for (const row of rows) if (row.group === pid) add(row);
      for (let changed = true; changed;) {
        changed = false;
        for (const row of rows) if (!found.has(row.pid) && row.pid !== pid && (found.has(row.parent) || row.parent === pid)) { add(row); changed = true; }
      }
      return [...found.values()];
    },
    async alive(targets, pid) {
      const live = [];
      for (const target of targets) if ((await stat(target.pid))?.created === target.created) live.push(target);
      try { process.kill(-pid, 0); if (!live.length) live.push({ pid: -pid, created: 'group' }); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      return live;
    },
    async terminate(pid) { signal(pid, 'SIGTERM'); },
    async escalate(pid) { signal(pid, 'SIGKILL'); },
  };
}

// Other POSIX systems have no /proc; ps gives the same facts with a start time in whole seconds.
function psDriver() {
  const table = async () => {
    const out = await run('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart=']);
    return out.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)).filter(Boolean)
      .map(match => ({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), created: match[4] }));
  };
  const signal = (pid, name) => { try { process.kill(-pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  return {
    async creation(pid) { return (await table()).find(row => row.pid === pid)?.created ?? null; },
    async descendants(pid) {
      const rows = await table(), found = new Map();
      for (let changed = true; changed;) {
        changed = false;
        for (const row of rows) if (!found.has(row.pid) && row.pid !== pid && (row.group === pid || found.has(row.parent) || row.parent === pid)) { found.set(row.pid, { pid: row.pid, created: row.created }); changed = true; }
      }
      return [...found.values()];
    },
    async alive(targets) {
      const rows = await table();
      return targets.filter(target => rows.some(row => row.pid === target.pid && row.created === target.created));
    },
    async terminate(pid) { signal(pid, 'SIGTERM'); },
    async escalate(pid) { signal(pid, 'SIGKILL'); },
  };
}

export function processDriver(platform = process.platform) {
  return platform === 'win32' ? windowsDriver() : platform === 'linux' ? linuxDriver() : psDriver();
}

// Adopts a freshly spawned child. Everything it needs is read from the live ChildProcess and the operating system,
// never from a persisted pid, so a handle exists only for a process this service started.
export async function ownChildProcess(child, { platform = process.platform, driver = processDriver(platform), stopStep = null,
  graceMs = STOP_GRACE_MS, settleMs = SETTLE_MS, spawnedAt = Date.now() } = {}) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof child.once !== 'function') throw unavailable('The native process has no verifiable identity.');
  let exited = child.exitCode != null || child.signalCode != null;
  const listeners = new Set();
  child.once('exit', () => { exited = true; for (const listener of [...listeners]) { try { listener(); } catch { /* A listener cannot stop the others. */ } } });
  let created = null;
  try { created = await driver.creation(pid, { child, spawnedAt }); } catch { created = null; }
  if (typeof created !== 'string' || !created || exited) throw unavailable('The native process has no verifiable identity.');
  const identity = `${pid}:${created}`;
  const waitExit = ms => new Promise(resolve => {
    if (exited) { resolve(true); return; }
    let timer;
    const listener = () => { clearTimeout(timer); listeners.delete(listener); resolve(true); };
    timer = setTimeout(() => { listeners.delete(listener); resolve(exited); }, ms);
    timer.unref?.();
    listeners.add(listener);
  });
  // What is known to have been inside the tree. An unreadable tree is never reported closed.
  let recorded = null, unreadable = false, stopping = null, swept = false;
  const note = report => { for (const item of report?.killed ?? []) { recorded ??= []; if (!recorded.some(known => known.pid === item.pid)) recorded.push(item); } };
  const handle = {
    identity,
    async verify() {
      if (exited || child.exitCode != null || child.signalCode != null) return false;
      try { return await driver.creation(pid, { child, recorded: created }) === created; } catch { return false; }
    },
    onExit(listener) {
      if (typeof listener !== 'function') throw unavailable();
      if (exited) { queueMicrotask(listener); return () => {}; }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // The tree is recorded first, then ended whole; true only after the root's own exit event.
    stop() {
      if (stopping) return stopping;
      const work = (async () => {
        try {
          if (!exited) { try { recorded = await driver.descendants(pid, created, child); } catch { recorded = null; unreadable = true; } }
          if (!exited) {
            note(await driver.terminate(pid));
            if (!await waitExit(graceMs)) { await driver.escalate(pid); await waitExit(graceMs); }
          }
          // The root ending first does not end its descendants: they get the same grace, then the forced signal.
          if (exited && recorded?.length) {
            const deadline = Date.now() + graceMs;
            let remaining = await driver.alive(recorded, pid).catch(() => recorded);
            while (remaining.length && Date.now() < deadline) { await sleep(POLL_MS); remaining = await driver.alive(recorded, pid).catch(() => recorded); }
            if (remaining.length) await driver.escalate(pid);
          }
          return { acknowledged: exited };
        } catch { return { acknowledged: false }; }
      })();
      stopping = work;
      const release = () => { if (stopping === work) stopping = null; };
      work.then(release, release);
      return work;
    },
    // After the exit: no recorded descendant may still be alive.
    // Remaining weakness: when the root ends by itself nothing was recorded at stop time. Windows lists no tree without PowerShell or WMIC,
    // so the single sweep below (taskkill /T on the root pid, only while no other process holds that pid) finds nothing once the root is gone,
    // and orphans of a root that exited alone are not proved closed. A Linux client is covered by its process group instead.
    async cleanup() {
      if (!exited || unreadable) return { closed: false, identity };
      if (!swept && recorded === null && typeof driver.sweepable === 'function' && driver.sweepable(pid)) {
        swept = true;
        try { note(await driver.terminate(pid)); } catch { /* Nothing to sweep, or the tool is unavailable: the recorded list stays as it is. */ }
      }
      let targets = recorded;
      if (targets === null) { try { targets = await driver.descendants(pid, created, child); } catch { return { closed: false, identity }; } }
      const deadline = Date.now() + settleMs;
      for (;;) {
        let live;
        try { live = await driver.alive(targets, pid); } catch { return { closed: false, identity }; }
        if (!live.length) return { closed: true, identity };
        if (Date.now() >= deadline) return { closed: false, identity };
        await sleep(POLL_MS);
      }
    },
    async stopStep() {
      if (typeof stopStep !== 'function' || exited) return { acknowledged: false };
      const result = await stopStep();
      return result?.acknowledged === true ? { acknowledged: true } : { acknowledged: false };
    },
  };
  return Object.freeze(handle);
}
