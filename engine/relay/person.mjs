import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openRelayOperations } from '../service/client.mjs';
import { wakeCanRun } from './store.mjs';

const MAX_SUBJECT = 240;

function oneLine(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_SUBJECT);
}

async function enabledWakeUnits(mindPath, now) {
  const folder = path.join(mindPath, 'user', 'relay', 'wake', 'policies');
  let names;
  try { names = await readdir(folder); } catch { return new Set(); }
  const units = new Set();
  for (const name of names.filter((item) => /^[a-f0-9]{64}\.json$/i.test(item))) {
    // A policy OneDrive has not finished syncing reads as invalid for a moment; the next poll sees it.
    let policy;
    try { policy = JSON.parse(await readFile(path.join(folder, name), 'utf8')); } catch { continue; }
    if (wakeCanRun(policy, now) && typeof policy.binding?.unit === 'string') units.add(policy.binding.unit.toLowerCase());
  }
  return units;
}

/**
 * The person's channel to agents. Sends as canonical master and registers on the first message,
 * so opening the tool writes nothing. A saved registration is not an agent capability.
 */
export async function createPersonRelay({ mindPath, tool, hostname = os.hostname(), clock = () => Date.now(), operations = null, serviceOptions = {} } = {}) {
  if (typeof tool !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(tool)) throw new TypeError('tool must be a short lowercase name.');
  const sessionId = `${tool}-${hostname}`;
  const relay = operations ?? await openRelayOperations({ ...serviceOptions, mindPath, hostname, sessionId, client: 'master' });
  let registered = false;
  async function listFor(project) {
    const { units } = await relay.status();
    const candidates = units.filter((item) => item.scope === `project:${project}` && item.state === 'in')
      .sort((a, b) => Number(b.role === 'executor' || b.unit.startsWith('executor-')) - Number(a.role === 'executor' || a.unit.startsWith('executor-'))
        || String(b.date ?? '').localeCompare(String(a.date ?? '')));
    if (!candidates.length) return [];
    const enabled = relay.awake ? null : await enabledWakeUnits(path.resolve(mindPath), clock());
    return Promise.all(candidates.map(async (selected) => {
      const id = selected.id ?? selected.unitId ?? `project:${project}:${selected.unit}`;
      const awake = relay.awake ? await relay.awake(id) : enabled.has(selected.unit.toLowerCase());
      return { id, unit: selected.unit, name: selected.alias || selected.name || selected.unit, awake };
    }));
  }

  async function agentFor(project) {
    const selected = (await listFor(project))[0];
    return selected ? { unit: selected.unit, awake: selected.awake } : null;
  }

  async function send({ project, subject, body, attachments = [], to, requestId }) {
    const candidates = await listFor(project);
    const agent = to === undefined ? candidates[0] : candidates.find((item) => item.id === to || item.unit === to);
    if (!agent) return { sent: false, reason: 'no-agent' };
    if (!registered) {
      await relay.register({ unit: 'master', nativeSessionId: sessionId, client: 'master' });
      registered = true;
    }
    const result = await relay.send({ to: relay.awake ? agent.id : agent.unit, subject: oneLine(subject) || 'Message from the person', body: String(body ?? ''), attachments, priority: 'normal', ...(requestId && relay.awake ? { requestId } : {}) });
    return { sent: true, to: agent.unit, id: result.id };
  }

  return { agentFor, listFor, send };
}
