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

function run(file, args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, shell: false, timeout, maxBuffer: 8_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); } else resolve(stdout);
    });
  });
}

function systemTool(...parts) {
  return path.join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', ...parts);
}

// Windows: Win32_Process through powershell.exe. Descendants are found by ParentProcessId, which Windows never rewrites,
// and by a creation time not earlier than the parent's, so they stay findable after the parent exits.
function windowsDriver() {
  const powershell = (script) => run(systemTool('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]);
  const table = async () => {
    const out = await powershell("Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString('o') }");
    const rows = new Map();
    for (const line of out.split(/\r?\n/)) {
      const match = /^(\d+) (\d+) (\S+)$/.exec(line.trim());
      if (match) rows.set(Number(match[1]), { pid: Number(match[1]), parent: Number(match[2]), created: match[3] });
    }
    if (!rows.size) throw unavailable();
    return rows;
  };
  return {
    async creation(pid) {
      const out = await powershell(`$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p -and $p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('o') }`);
      return /^\d{4}-\d{2}-\d{2}T\S+Z$/.test(out.trim()) ? out.trim() : null;
    },
    async descendants(pid, created) {
      const rows = [...(await table()).values()], found = [], queue = [{ pid, created }];
      while (queue.length) {
        const parent = queue.shift();
        for (const row of rows) {
          if (row.parent === parent.pid && row.created >= parent.created && row.pid !== pid && !found.some(item => item.pid === row.pid)) {
            found.push({ pid: row.pid, created: row.created }); queue.push(row);
          }
        }
      }
      return found;
    },
    async alive(targets) {
      const rows = await table();
      return targets.filter(target => rows.get(target.pid)?.created === target.created);
    },
    async terminate(pid) {
      try { await run(systemTool('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { timeout: 15000 }); }
      catch (error) {
        // 128 means the process is already gone, which is the state being asked for.
        if (error.code !== 128) throw error;
      }
    },
    async escalate() {},
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
  graceMs = STOP_GRACE_MS, settleMs = SETTLE_MS } = {}) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof child.once !== 'function') throw unavailable('The native process has no verifiable identity.');
  let exited = child.exitCode != null || child.signalCode != null;
  const listeners = new Set();
  child.once('exit', () => { exited = true; for (const listener of [...listeners]) { try { listener(); } catch { /* A listener cannot stop the others. */ } } });
  let created = null;
  try { created = await driver.creation(pid); } catch { created = null; }
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
  let recorded = null, stopping = null;
  const handle = {
    identity,
    async verify() {
      if (exited || child.exitCode != null || child.signalCode != null) return false;
      try { return await driver.creation(pid) === created; } catch { return false; }
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
          if (!exited) { try { recorded = await driver.descendants(pid, created, child); } catch { recorded = null; } }
          if (!exited) {
            await driver.terminate(pid);
            if (!await waitExit(graceMs)) { await driver.escalate(pid); await waitExit(graceMs); }
          }
          return { acknowledged: exited };
        } catch { return { acknowledged: false }; }
      })();
      stopping = work;
      const release = () => { if (stopping === work) stopping = null; };
      work.then(release, release);
      return work;
    },
    // After the exit: no recorded descendant may still be alive with its creation identity.
    async cleanup() {
      if (!exited) return { closed: false, identity };
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
