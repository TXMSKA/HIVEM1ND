import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createPersonRelay } from '../relay/person.mjs';
import { wakeCanRun } from '../relay/store.mjs';
import { postMailbox } from './chats.mjs';
import { commentRecipients, notifyAttached } from './editors.mjs';
import { CoreError, uuidV8 } from './identity.mjs';
import { assertNoLinks, safeRelative } from './paths.mjs';
import { readProjection } from './projection.mjs';
import { withLocks, withReceipt } from './store.mjs';
import { appPathKey, sameAppPath } from './app-paths.mjs';

const sendBudgets = new WeakMap();

function fail(code) {
  throw new CoreError({ invalid: 422, denied: 403, not_found: 404, no_agent: 409, conflict: 409, unavailable: 503 }[code], code, 'The agent request could not be completed.');
}

function projectFor(context, location) {
  if (typeof location !== 'string' || !location || location.length > 4096 || /[\u0000-\u001f\u007f]/.test(location)) fail('invalid');
  const project = (context.projects ?? []).find((item) => item.eligible !== false && item.localPath
    && (item.name === location || path.isAbsolute(location) && (sameAppPath(item.localPath, location) || sameAppPath(path.join(item.localPath, 'docs', 'flows'), location))));
  if (!project) fail('denied');
  return project;
}

async function projectFile(project, location, input) {
  const value = typeof input === 'string' ? input : input?.path ?? input?.id;
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid');
  if (value.split(/[\\/]/).includes('..')) fail('denied');
  let candidates;
  if (path.isAbsolute(value)) candidates = [path.resolve(value)];
  else {
    let relative;
    try { relative = safeRelative(value); } catch { fail('invalid'); }
    const root = path.resolve(project.localPath);
    const flows = path.join(root, 'docs', 'flows');
    candidates = sameAppPath(location, flows)
      ? [path.join(flows, relative), path.join(root, relative)]
      : [path.join(root, relative), path.join(flows, relative)];
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) candidates.push(path.join(flows, 'boards', `${value}.json`));
  }
  for (const file of [...new Set(candidates)]) {
    const relative = path.relative(path.resolve(project.localPath), file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('denied');
    try {
      await assertNoLinks(file, { root: project.localPath });
      if (!(await lstat(file)).isFile()) continue;
      const final = await realpath(file);
      const base = await realpath(project.localPath);
      const resolved = path.relative(base, final);
      if (resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) fail('denied');
      return { absolute: final, relative: relative.split(path.sep).join('/') };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error.code === 'unsafe_path' || error.code === 'invalid_path') fail('denied');
      throw error;
    }
  }
  fail('not_found');
}

function checkedText(value, limit) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit || value.includes('\0')) fail('invalid');
  return value;
}

async function person(context) {
  if (!context.paths?.mind || !context.store) fail('unavailable');
  const scoped = { ...context, receipt: null, principal: { ...context.principal, audience: 'desktop', unitId: 'root:master' }, now: context.now ?? (() => Date.now()) };
  let view;
  const operations = {
    async status() {
      view = await readProjection(scoped);
      return { units: view.units.filter((unit) => !unit.malformed).map((unit) => ({ ...unit, scope: unit.scope?.id ?? (unit.scope?.kind === 'root' ? 'root' : `${unit.scope?.kind}:${unit.scope?.name}`) })) };
    },
    async awake(unitId) {
      const now = scoped.now();
      for (const session of view.sessions.filter((item) => item.unitId === unitId && item.state !== 'stopped' && item.wake?.enabled === true)) {
        const key = createHash('sha256').update(JSON.stringify([session.unitId, session.nativeSessionId, session.client, session.machine])).digest('hex');
        let policy;
        try { policy = JSON.parse(await readFile(path.join(scoped.paths.mind, 'user', 'relay', 'wake', 'policies', `${key}.json`), 'utf8')); } catch { continue; }
        if (wakeCanRun(policy, now)) return true;
      }
      return false;
    },
    async register() { return { unit: 'master', client: 'master' }; },
    async send(input) {
      const key = uuidV8(['embedded-agent-send', context.receipt?.principalHash ?? 'master', input.requestId ?? randomUUID()]);
      const body = { subject: input.subject, body: input.body, priority: input.priority, attachments: input.attachments.map((item) => ({ path: item, kind: null })) };
      const result = await withReceipt(scoped.store, { principal: 'embedded-app-person', key, requestId: key, method: 'POST', path: `/mailboxes/${input.to}/messages`, body, responseFields: ['id', 'to'] }, async (receipt) => {
        const sent = await postMailbox({ ...scoped, receipt }, input.to, body);
        return { status: 201, body: sent.message };
      });
      return result.body;
    },
  };
  return createPersonRelay({ mindPath: scoped.paths.mind, tool: 'embedded-app', hostname: scoped.paths.machine ?? context.machine, clock: scoped.now, operations });
}

function bridgeError(error) {
  if (['invalid', 'denied', 'not_found', 'no_agent', 'conflict', 'unavailable'].includes(error?.code)) throw error;
  if (error?.code?.includes('conflict')) fail('conflict');
  if (error?.status === 403) fail('denied');
  if (error?.status === 404 || error?.code === 'ENOENT') fail('not_found');
  if (error?.status === 400 || error?.status === 413 || error?.status === 422) fail('invalid');
  fail('unavailable');
}

export async function listAppAgents(context, input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid');
    const project = projectFor(context, input.location);
    return (await (await person(context)).listFor(project.name)).map(({ unit, name, awake }) => ({ unit, name, awake }));
  } catch (error) { bridgeError(error); }
}

export async function sendAppAgent(context, input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid');
    if (Buffer.byteLength(JSON.stringify(input)) > 32 * 1024) fail('invalid');
    const project = projectFor(context, input.location);
    if (!['comment', 'reply', 'edits', 'board'].includes(input.kind)) fail('invalid');
    const subject = checkedText(input.subject, 240) || `${input.kind[0].toUpperCase()}${input.kind.slice(1)} from the person`;
    const body = checkedText(input.body, 16 * 1024);
    const threadId = checkedText(input.threadId, 180);
    if (/[\r\n\u0000-\u001f\u007f]/.test(subject + threadId)) fail('invalid');
    if (input.to !== undefined && (typeof input.to !== 'string' || input.to.length > 320)) fail('invalid');
    const document = await projectFile(project, input.location, input.document);
    const attachment = input.attachment === undefined ? null : await projectFile(project, input.location, input.attachment);
    const relay = await person(context);
    const agents = await relay.listFor(project.name);
    if (agents.length === 0) fail('no_agent');
    const agent = input.to === undefined ? agents[0] : agents.find((item) => item.id === input.to || item.unit === input.to);
    if (!agent) fail('denied');
    return await withLocks(context.store, [`app-agent-send:${appPathKey(project.localPath)}`], async () => {
      let projects = sendBudgets.get(context.store);
      if (!projects) { projects = new Map(); sendBudgets.set(context.store, projects); }
      const attachedKeys = new Set((context.projects ?? []).filter(item => item.eligible !== false && item.localPath).map(item => appPathKey(item.localPath)));
      for (const key of projects.keys()) if (!attachedKeys.has(key)) projects.delete(key);
      const now = (context.now ?? Date.now)(), projectKey = appPathKey(project.localPath);
      const bucket = projects.get(projectKey) ?? { sends: [], retries: new Map() };
      projects.set(projectKey, bucket);
      bucket.sends = bucket.sends.filter(at => now - at < 60000);
      for (const [key, retry] of bucket.retries) if (now - retry.at >= 60000) bucket.retries.delete(key);
      const retryKey = context.receipt ? `${context.receipt.principalHash}:${context.receipt.key}` : null;
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = retryKey ? bucket.retries.get(retryKey) : null;
      if (previous) {
        if (previous.hash !== requestHash) fail('conflict');
        return previous.result;
      }
      if (bucket.sends.length >= 6) fail('unavailable');
      bucket.sends.push(now);
      const sent = await relay.send({ project: project.name, to: agent.id, subject,
        body: [`Document: ${document.relative}`, `Kind: ${input.kind}`, ...(threadId ? [`Thread: ${threadId}`] : []), '', body].join('\n'),
        attachments: [...new Set([document.absolute, ...(attachment ? [attachment.absolute] : [])])], requestId: context.receipt?.key });
      if (!sent.sent) fail('no_agent');
      const recipients = commentRecipients(context, { sendToAgent: true }, [agent.id], 'root:master');
      await notifyAttached({ ...context, receipt: null }, { messageId: sent.id, resourceId: document.relative, recipients });
      const result = { sent: true, unit: sent.to, id: sent.id };
      if (retryKey) bucket.retries.set(retryKey, { at: now, hash: requestHash, result });
      return result;
    });
  } catch (error) { bridgeError(error); }
}
