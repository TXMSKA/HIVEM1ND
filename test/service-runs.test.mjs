import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createPlan, startPlan } from '../engine/service/plans.mjs';
import { callPlanTool, controlRun, drainRunLaunches, ingestPlanSignal, readRun, readRunLog, readSessionWork, recoverRuns, requestPlanNativeOperation } from '../engine/service/runs.mjs';
import { cleanupRunAttempt, drainRunProcesses } from '../engine/service/run-processes.mjs';
import { readDetail } from '../engine/service/projection.mjs';
import { patchCluster } from '../engine/service/clusters.mjs';
import { createClusterLink, readMachineSettings } from '../engine/service/settings.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { enqueueStart } from '../engine/service/adapters.mjs';
import { createNativeAdapter } from '../engine/service/adapters.mjs';
import { openLyraAdapter } from '../engine/service/lyra.mjs';
import { makePlanFixture, runsIn } from './service-plans.test.mjs';

async function start(t) {
  const state = await makePlanFixture(t), plan = await createPlan(state.context, state.input);
  const result = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
  await drainRunLaunches(state.context); const run = await readRun(state.context, result.runId), coordinator = run.attempts[0];
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: coordinator.sessionId } };
  return { ...state, plan, run, actor, coordinator };
}
test('only coordinator dispatches and bound events use owner time, gap-free sequence and immutable witnesses', async t => {
  const state = await start(t);
  const request = { runId: state.run.id, attemptId: state.coordinator.id, eventId: 'step-one', step: 'plan', state: 'started', requestId: randomUUID() };
  const event = await callPlanTool(state.actor, 'plan_step', request);
  const duplicate = await callPlanTool(state.actor, 'plan_step', { ...request, requestId: randomUUID() });
  assert.equal(duplicate.sequence, event.sequence);
  await assert.rejects(callPlanTool(state.actor, 'plan_step', { ...request, step: 'edit', requestId: randomUUID() }), { code: 'invalid_run_event' });
  await assert.rejects(ingestPlanSignal(state.actor, { runId: state.run.id, attemptId: state.coordinator.id, id: 'forged', kind: 'exit', source: 'process' }), { code: 'invalid_run_event' });
  const fresh = await readRun(state.context, state.run.id);
  const dispatched = await callPlanTool(state.actor, 'plan_dispatch', { runId: fresh.id, role: 'planner', taskId: null, expectedRevision: fresh.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  const planner = (await readRun(state.context, fresh.id)).attempts.find(attempt => attempt.id === dispatched.attemptId);
  const worker = { ...state.actor, principal: { ...state.actor.principal, sessionId: planner.sessionId } };
  await assert.rejects(callPlanTool(worker, 'plan_dispatch', { runId: fresh.id, role: 'reviewer', taskId: null, expectedRevision: (await readRun(state.context, fresh.id)).revision, requestId: randomUUID() }), { code: 'plan_lead_required' });
  await assert.rejects(enqueueStart(worker, { unitId: state.units[0].id }), { code: 'plan_lead_required' });
  const log = await readRunLog(state.context, fresh.id, { limit: 100 });
  assert.deepEqual(log.items.map(item => item.sequence), log.items.map((_, index) => index + 1));
  assert.ok((await readSessionWork(state.context, state.coordinator.sessionId)).items.some(item => item.kind === 'step_start'));
  assert.equal(log.items.some(item => JSON.stringify(item).includes('native-init')), false);
});
test('authored reports, parent exit and verified cleanup settle in the actual owned driver; a turn alone cannot deliver', async t => {
  const state = await start(t);
  const result = await callPlanTool(state.actor, 'plan_dispatch', { runId: state.run.id, role: 'planner', taskId: null, expectedRevision: state.run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  const planner = (await readRun(state.context, state.run.id)).attempts.find(attempt => attempt.id === result.attemptId);
  const worker = { ...state.actor, principal: { ...state.actor.principal, sessionId: planner.sessionId } };
  assert.equal(planner.resolved, false);
  const report = await callPlanTool(worker, 'plan_report', { runId: state.run.id, attemptId: planner.id, outcome: 'delivered', summary: 'The draft is ready for review.', requestId: randomUUID() });
  assert.equal(report.accepted, true); await drainRunProcesses(state.context);
  const after = await readRun(state.context, state.run.id);
  assert.equal(after.attempts.find(attempt => attempt.id === planner.id).resolved, true);
  assert.equal(after.state, 'open'); assert.equal(after.taskIndex, 0);
  await assert.rejects(callPlanTool(worker, 'plan_step', { runId: after.id, attemptId: planner.id, eventId: 'late', step: 'work', state: 'started', requestId: randomUUID() }), { code: 'forbidden' });
});
test('recovery never repeats an ambiguous launch and private native identities never enter public runtime or logs', async t => {
  const state = await makePlanFixture(t), plan = await createPlan(state.context, state.input);
  state.context.runFault = 'launch_gap';
  const started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  delete state.context.runFault;
  assert.equal((await recoverRuns(state.context))[0].code, 'launch_ambiguous'); assert.equal(state.launches.length, 0);
  const run = await readRun(state.context, started.runId), log = await readRunLog(state.context, started.runId);
  assert.equal(/nativeSessionId|executionId|"pid"|credential|environment/.test(JSON.stringify({ run, log })), false);
  await assert.rejects(controlRun(state.context, run.id, { action: 'retry_start', attemptId: run.attempts[0].id, expectedRevision: run.revision }), { code: 'cleanup_unavailable' });
});
test('direct clients receive restricted role actors and per-task choices do not create units or change their Runs in', async t => {
  const state = await makePlanFixture(t), direct = { kind: 'client', client: 'codex', runsIn: { ...runsIn, model: 'alternate' }, reuseRole: null };
  state.input.roles.planner = direct; state.input.roles.reviewer = { ...direct, reuseRole: 'planner' };
  const plan = await createPlan(state.context, state.input), started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
  await drainRunLaunches(state.context); let run = await readRun(state.context, started.runId);
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: run.attempts[0].sessionId } };
  await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'planner', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
  assert.equal(state.launches[1].unitId, null); assert.equal(state.launches[1].runsIn.model, 'alternate');
  run = await readRun(state.context, run.id); const planner = run.attempts.find(attempt => attempt.role === 'planner');
  const directActor = { ...state.context, principal: { audience: 'agent', unitId: null, sessionId: planner.sessionId } };
  await assert.rejects(callPlanTool(directActor, 'plan_dispatch', { runId: run.id, role: 'builder', taskId: state.taskId, expectedRevision: run.revision, requestId: randomUUID() }), { code: 'plan_lead_required' });
  const intent = JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'intents', `${planner.id}.json`)));
  assert.equal(intent.binding.actorId, `plan:${plan.id}:planner`);
});

test('replacement validates before stopping, records the exact new choice and revokes the old actor', async t => {
  const state = await start(t);
  await callPlanTool(state.actor, 'plan_dispatch', { runId: state.run.id, role: 'planner', taskId: null, expectedRevision: state.run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  let run = await readRun(state.context, state.run.id), old = run.attempts.find(attempt => attempt.role === 'planner');
  const oldActor = { ...state.actor, principal: { ...state.actor.principal, sessionId: old.sessionId } };
  await assert.rejects(controlRun(state.context, run.id, { action: 'replace_role', role: 'planner', assignment: { kind: 'client', client: 'codex', runsIn: { ...runsIn, model: 'not-installed' }, reuseRole: null }, expectedRevision: run.revision }), { code: 'unsupported_launch_choice' });
  await callPlanTool(oldActor, 'plan_step', { runId: run.id, attemptId: old.id, eventId: 'still-working', step: 'plan', state: 'started', requestId: randomUUID() });
  run = await readRun(state.context, run.id);
  const replacement = { kind: 'client', client: 'codex', runsIn: { ...runsIn, model: 'alternate' }, reuseRole: null };
  await controlRun(state.context, run.id, { action: 'replace_role', role: 'planner', assignment: replacement, expectedRevision: run.revision });
  await drainRunLaunches(state.context);
  run = await readRun(state.context, run.id);
  assert.equal(run.attempts.filter(attempt => attempt.role === 'planner').length, 1);
  assert.equal(state.launches.at(-1).unitId, null); assert.equal(state.launches.at(-1).model, 'alternate');
  assert.deepEqual((await readDetail(state.context, 'chats', state.cluster.chatId)).plans[0].roles.planner, replacement);
  await assert.rejects(callPlanTool(oldActor, 'plan_report', { runId: run.id, attemptId: old.id, outcome: 'delivered', summary: 'Stale report.', requestId: randomUUID() }), { code: 'forbidden' });
});

test('failed owned cleanup blocks retry and Stop until a fresh verified closure', async t => {
  const state = await start(t), parent = new EventEmitter(), identity = randomUUID(); let closes = false, exited = false;
  state.nativeOptions.planProcessHandle = { identity, verify: async () => true,
    onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
    cleanup: async () => ({ closed: closes, identity }), stop: async () => { exited = true; parent.emit('exit'); return { acknowledged: true }; } };
  await callPlanTool(state.actor, 'plan_dispatch', { runId: state.run.id, role: 'planner', taskId: null, expectedRevision: state.run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  let run = await readRun(state.context, state.run.id), old = run.attempts.find(attempt => attempt.role === 'planner');
  await assert.rejects(controlRun(state.context, run.id, { action: 'retry_task', attemptId: old.id, expectedRevision: run.revision }), { code: 'cleanup_unavailable' });
  assert.equal(exited, true); assert.equal(state.launches.length, 2);
  closes = true; delete state.nativeOptions.planProcessHandle;
  run = await readRun(state.context, run.id);
  await controlRun(state.context, run.id, { action: 'retry_task', attemptId: old.id, expectedRevision: run.revision });
  await drainRunLaunches(state.context);
  assert.equal(state.launches.length, 3);
  run = await readRun(state.context, run.id);
  await controlRun(state.context, run.id, { action: 'stop_run', expectedRevision: run.revision });
  await Promise.allSettled([...(state.context.store.runStops?.values() ?? [])]);
  assert.equal((await readRun(state.context, run.id)).state, 'stopped');
});

test('native plan permissions remain exact person decisions and reviewer writes cannot borrow builder authority', async t => {
  const state = await start(t), directory = path.join(state.root, 'review-work'); await mkdir(directory);
  let run = await readRun(state.context, state.run.id);
  await callPlanTool(state.actor, 'plan_dispatch', { runId: run.id, role: 'reviewer', taskId: null, expectedRevision: run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context); run = await readRun(state.context, run.id);
  const reviewer = run.attempts.find(attempt => attempt.role === 'reviewer');
  const actor = { ...state.actor, principal: { ...state.actor.principal, sessionId: reviewer.sessionId } };
  const intent = JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'intents', `${reviewer.id}.json`)));
  let authorized = 0;
  const boundary = { verified: true, authorize: async () => { authorized++; return { authorized: true }; } };
  assert.equal(await requestPlanNativeOperation(actor, { id: 'write', kind: 'write', nativeSessionId: intent.binding.nativeSessionId, paths: [path.join(directory, 'result.txt')] }, boundary), false);
  assert.equal(await requestPlanNativeOperation(actor, { id: 'git', kind: 'process', nativeSessionId: intent.binding.nativeSessionId, command: 'git commit', cwd: directory }, boundary), false);
  state.context.nativeApprovalTimeoutMs = 1; actor.nativeApprovalTimeoutMs = 1;
  assert.equal(await requestPlanNativeOperation(actor, { id: 'tests', kind: 'process', nativeSessionId: intent.binding.nativeSessionId, command: 'node --test', cwd: directory }, boundary), false);
  assert.equal(authorized, 0);
  assert.equal(state.launches.at(-1).planAuthority.role, 'reviewer'); assert.deepEqual(state.launches.at(-1).planAuthority.writablePaths, []);
});

test('each report/exit/cleanup ordering preserves pending evidence until all three facts arrive', async t => {
  for (const order of [['report', 'exit', 'cleanup'], ['report', 'cleanup', 'exit'], ['exit', 'report', 'cleanup'], ['exit', 'cleanup', 'report'], ['cleanup', 'report', 'exit'], ['cleanup', 'exit', 'report']]) {
    await t.test(order.join('/'), async t => {
      const state = await start(t), parent = new EventEmitter(); let cleanupReady = false, liveIdentity = true;
      const identity = randomUUID();
      state.nativeOptions.planProcessHandle = { identity, verify: async () => liveIdentity, onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
        cleanup: async () => { if (cleanupReady) liveIdentity = false; return { closed: cleanupReady, identity }; }, stop: async () => { cleanupReady = true; parent.emit('exit'); return { acknowledged: true }; } };
      state.context.adapters.codex.completePlanTask = async () => ({ acknowledged: true });
      const dispatched = await callPlanTool(state.actor, 'plan_dispatch', { runId: state.run.id, role: 'planner', taskId: null, expectedRevision: state.run.revision, requestId: randomUUID() });
      await drainRunLaunches(state.context);
      const attempt = (await readRun(state.context, state.run.id)).attempts.find(attempt => attempt.id === dispatched.attemptId);
      const worker = { ...state.actor, principal: { ...state.actor.principal, sessionId: attempt.sessionId } };
      for (let index = 0; index < order.length; index++) {
        if (order[index] === 'report') await callPlanTool(worker, 'plan_report', { runId: state.run.id, attemptId: attempt.id, outcome: 'delivered', summary: 'Verified draft report.', requestId: randomUUID() });
        if (order[index] === 'exit') { parent.emit('exit'); await drainRunProcesses(state.context); }
        if (order[index] === 'cleanup') { cleanupReady = true; await cleanupRunAttempt(state.context, state.run.id, attempt.id); }
        assert.equal((await readRun(state.context, state.run.id)).attempts.find(candidate => candidate.id === attempt.id).resolved, index === 2);
      }
    });
  }
});

test('the driver settles report and parent exit while an owned hung descendant still holds stdout', async t => {
  const state = await start(t), parent = new EventEmitter(), stdout = new EventEmitter(), identity = randomUUID(); let hung = true, pipeClosed = false;
  stdout.on('end', () => { pipeClosed = true; });
  state.nativeOptions.planProcessHandle = { identity, verify: async () => true,
    onExit: listener => { parent.on('exit', listener); return () => parent.off('exit', listener); },
    cleanup: async () => { hung = false; return { closed: true, identity }; }, stop: async () => { parent.emit('exit'); return { acknowledged: true }; } };
  state.context.adapters.codex.completePlanTask = async () => ({ acknowledged: true });
  await callPlanTool(state.actor, 'plan_dispatch', { runId: state.run.id, role: 'planner', taskId: null, expectedRevision: state.run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  const attempt = (await readRun(state.context, state.run.id)).attempts.find(attempt => attempt.role === 'planner');
  const actor = { ...state.actor, principal: { ...state.actor.principal, sessionId: attempt.sessionId } };
  state.clock.now += 60000;
  await callPlanTool(actor, 'plan_report', { runId: state.run.id, attemptId: attempt.id, outcome: 'delivered', summary: 'The owned test report is ready.', requestId: randomUUID() });
  assert.equal((await readRun(state.context, state.run.id)).attempts.find(item => item.id === attempt.id).resolved, false);
  state.clock.now += 60000; parent.emit('exit'); await drainRunProcesses(state.context);
  assert.equal((await readRun(state.context, state.run.id)).attempts.find(item => item.id === attempt.id).resolved, true);
  assert.equal(hung, false); assert.equal(pipeClosed, false);
  const log = (await readRunLog(state.context, state.run.id)).items.filter(item => ['report', 'exit', 'cleanup'].includes(item.kind));
  assert.deepEqual(log.map(item => item.kind), ['report', 'exit', 'cleanup']);
  assert.equal(log[1].at, new Date(state.clock.now).toISOString());
});

test('approved branch and per-task commit reconcile once, preserve foreign staging and never push', async t => {
  const state = await makePlanFixture(t), directory = path.join(state.root, 'repository');
  await mkdir(path.join(directory, '.git'), { recursive: true });
  const indexFile = path.join(directory, '.git', 'index'); await writeFile(indexFile, 'foreign staged bytes');
  const git = { branch: 'main', head: 'a'.repeat(40), parent: null, commits: 0, switches: 0 };
  let loseCommitResponse = true;
  const foreign = `100644 ${'f'.repeat(40)} 0\tforeign.txt\0`;
  state.context.gitRunner = async (_command, args, options) => {
    assert.equal(options.shell, false);
    if (args.includes('config')) return args.includes('--list') ? { stdout: 'reviewed-config' } : { stdout: '', code: 1 };
    if (args.includes('rev-parse')) return { stdout: args.includes('--show-toplevel') ? `${directory}\n` : args.includes('--git-common-dir') ? `${path.join(directory, '.git')}\n` : args.includes('--git-path') ? '.git/index\n' : `${git.head}\n` };
    if (args.includes('worktree')) return { stdout: `worktree ${directory}\0HEAD ${git.head}\0branch refs/heads/${git.branch}\0\0` };
    if (args.includes('symbolic-ref')) return { stdout: `${git.branch}\n` };
    if (args.includes('show-ref')) return { stdout: '', code: 1 };
    if (args.includes('check-ref-format')) return { stdout: args.at(-1) };
    if (args.includes('switch')) { assert.equal(args.some(arg => arg.startsWith('core.hooksPath=')), false); git.switches++; git.branch = args.at(-1); return { stdout: '' }; }
    if (args.includes('diff')) return { stdout: 'result.txt\0' };
    if (args.includes('ls-files')) return { stdout: args.includes('--others') ? '' : foreign };
    if (args.includes('hash-object')) return { stdout: 'c'.repeat(40) + '\n' };
    if (args.includes('ls-tree')) return { stdout: `100644 blob ${'c'.repeat(40)}\tresult.txt\0` };
    if (args.includes('add')) { assert.deepEqual(args.slice(args.lastIndexOf('--') + 1), ['result.txt']); return { stdout: '' }; }
    if (args.includes('commit')) { assert.equal(args.some(arg => arg.startsWith('core.hooksPath=')), false); assert.ok(args.includes('--only')); git.commits++; git.parent = git.head; git.head = 'b'.repeat(40); if (loseCommitResponse) { loseCommitResponse = false; throw new Error('Lost commit response'); } return { stdout: '' }; }
    if (args.includes('show')) return { stdout: args.includes('-s') ? `${git.parent}\0Complete task ${state.taskId}\n` : 'Built\n' };
    if (args.includes('diff-tree')) return { stdout: 'result.txt\0' };
    throw new Error('Unexpected Git operation');
  };
  const report = await readMachineSettings(state.context, state.machine, 'projects');
  const mapping = await createClusterLink(state.context, { machine: state.machine, kind: 'repository', path: directory, expectedReportRevision: report.revision });
  const cluster = await patchCluster(state.context, state.cluster.id, { machine: state.machine, link: mapping.link, expectedRevision: state.cluster.revision });
  await writeFile(path.join(state.paths.localDirectory, 'client-permissions.json'), JSON.stringify({ permissions: [{ id: randomUUID(), machine: state.machine, client: 'codex', actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(state.clock.now).toISOString(), grantedBy: 'root:master' }] })); // Compatibility: existing permission grants retain their scope identity.
  state.input.mode = 'execution'; state.input.expectedChatRevision = (await readDetail(state.context, 'chats', cluster.chatId)).revision;
  const plan = await createPlan(state.context, state.input); assert.equal(git.switches, 0);
  const started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  assert.equal(git.switches, 1);
  let run = await readRun(state.context, started.runId); const coordinator = run.attempts[0];
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: coordinator.sessionId } };
  const dispatched = await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'builder', taskId: state.taskId, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
  await writeFile(path.join(directory, 'result.txt'), 'Built\n');
  run = await readRun(state.context, run.id); const builder = run.attempts.find(attempt => attempt.id === dispatched.attemptId);
  const worker = { ...actor, principal: { ...actor.principal, sessionId: builder.sessionId } };
  await callPlanTool(worker, 'plan_report', { runId: run.id, attemptId: builder.id, outcome: 'delivered', summary: 'The task was delivered.', requestId: randomUUID() }); await drainRunProcesses(state.context);
  assert.equal(git.commits, 1); assert.equal(await readFile(indexFile, 'utf8'), 'foreign staged bytes');
  assert.equal((await readDetail(state.context, 'chats', state.cluster.chatId)).plans[0].tasks[0].state, 'stuck');
  assert.ok((await readRunLog(state.context, run.id)).items.some(item => item.state === 'fail' && item.values.code === 'git_unavailable'));
  await recoverRuns(state.context); assert.equal(git.commits, 1);
  const { commitPlanTask } = await import('../engine/service/cluster-git.mjs');
  const approval = JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'approval.json')));
  assert.equal((await commitPlanTask(state.context, approval, state.taskId)).reconciled, true); assert.equal(git.commits, 1);
  assert.equal((await readDetail(state.context, 'chats', state.cluster.chatId)).plans[0].tasks[0].state, 'done');
  assert.equal(hashBytes(await readFile(path.join(directory, 'result.txt'))), hashBytes(Buffer.from('Built\n')));
});

test('real Git commits only changed reviewed text, binary and deleted paths and retains the foreign index', async t => {
  const state = await makePlanFixture(t), directory = path.join(state.root, 'real-plan-repository'); await mkdir(directory);
  const env = { ...state.env, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  state.context.env = env; state.context.probeAgents = async () => ({}); state.context.kitPath = state.root;
  const git = async (...args) => (await promisify(execFile)('git', args, { cwd: directory, env, windowsHide: true, timeout: 15000 })).stdout;
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.test');
  await git('config', 'commit.gpgSign', 'false'); await git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  await writeFile(path.join(directory, 'result.txt'), 'Before\n'); await writeFile(path.join(directory, 'stable.txt'), 'Keep\n');
  await writeFile(path.join(directory, 'removed.bin'), Buffer.from([0, 1, 255])); await writeFile(path.join(directory, 'foreign.txt'), 'Before\n');
  await git('add', '.'); await git('commit', '-m', 'Initial fixture');
  await writeFile(path.join(directory, 'foreign.txt'), 'Foreign staged\n'); await git('add', 'foreign.txt');
  const foreignBefore = await git('ls-files', '--stage', '--', 'foreign.txt');
  const { createClusterLink, readMachineSettings } = await import('../engine/service/settings.mjs');
  const report = await readMachineSettings(state.context, state.machine, 'projects');
  const mapping = await createClusterLink(state.context, { machine: state.machine, kind: 'repository', path: directory, expectedReportRevision: report.revision });
  const cluster = await patchCluster(state.context, state.cluster.id, { machine: state.machine, link: mapping.link, expectedRevision: state.cluster.revision });
  await writeFile(path.join(state.paths.localDirectory, 'client-permissions.json'), JSON.stringify({ permissions: [{ id: randomUUID(), machine: state.machine, client: 'codex', actions: ['git.commit', 'git.push'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(state.clock.now).toISOString(), grantedBy: 'root:master' }] })); // Compatibility: existing permission grants retain their scope identity.
  const taskFile = path.join(state.paths.mind, 'user', 'tasks', '001.md');
  await writeFile(taskFile, (await readFile(taskFile, 'utf8')).replace('files: ["result.txt"]', 'files: ["result.txt","stable.txt","removed.bin","new.bin"]'));
  state.input.mode = 'execution'; state.input.expectedChatRevision = (await readDetail(state.context, 'chats', cluster.chatId)).revision;
  const plan = await createPlan(state.context, state.input), launched = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision });
  await drainRunLaunches(state.context);
  let run = await readRun(state.context, launched.runId), coordinator = run.attempts[0];
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: coordinator.sessionId } };
  const dispatched = await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'builder', taskId: state.taskId, expectedRevision: run.revision, requestId: randomUUID() });
  await drainRunLaunches(state.context);
  await writeFile(path.join(directory, 'result.txt'), 'Built\n'); await writeFile(path.join(directory, 'new.bin'), Buffer.from([0, 254, 2]));
  const { unlink } = await import('node:fs/promises'); await unlink(path.join(directory, 'removed.bin'));
  run = await readRun(state.context, run.id); const builder = run.attempts.find(attempt => attempt.id === dispatched.attemptId);
  await callPlanTool({ ...actor, principal: { ...actor.principal, sessionId: builder.sessionId } }, 'plan_report', { runId: run.id, attemptId: builder.id, outcome: 'delivered', summary: 'Reviewed changes delivered.', requestId: randomUUID() });
  await drainRunProcesses(state.context);
  assert.equal((await readDetail(state.context, 'chats', cluster.chatId)).plans[0].tasks[0].state, 'done');
  assert.equal(await git('ls-files', '--stage', '--', 'foreign.txt'), foreignBefore);
  assert.deepEqual((await git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).trim().split('\n').sort(), ['new.bin', 'removed.bin', 'result.txt']);
  assert.equal((await git('rev-list', '--count', 'HEAD')).trim(), '2');
});

test('planner review reopens the verified checkpoint under a new restricted actor', async t => {
  const state = await start(t), direct = { kind: 'client', client: 'codex', runsIn, reuseRole: null };
  // A separate reviewed plan chooses the direct planner and its checkpoint-backed reviewer.
  await controlRun(state.context, state.run.id, { action: 'stop_run', expectedRevision: state.run.revision });
  await new Promise(resolve => setImmediate(resolve)); await drainRunProcesses(state.context);
  const fresh = await makePlanFixture(t); fresh.input.roles.planner = direct; fresh.input.roles.reviewer = { ...direct, reuseRole: 'planner' };
  const plan = await createPlan(fresh.context, fresh.input), started = await startPlan(fresh.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(fresh.context);
  let run = await readRun(fresh.context, started.runId);
  const actor = { ...fresh.context, principal: { audience: 'agent', unitId: fresh.units[0].id, sessionId: run.attempts[0].sessionId } };
  await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'planner', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(fresh.context);
  run = await readRun(fresh.context, run.id); const planner = run.attempts.find(attempt => attempt.role === 'planner');
  const plannerActor = { ...fresh.context, principal: { audience: 'agent', unitId: null, sessionId: planner.sessionId } };
  await callPlanTool(plannerActor, 'plan_report', { runId: run.id, attemptId: planner.id, outcome: 'delivered', summary: 'Keep the empty-state decision.', requestId: randomUUID() }); await drainRunProcesses(fresh.context);
  run = await readRun(fresh.context, run.id);
  await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'reviewer', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(fresh.context);
  assert.equal(fresh.launches.at(-1).planActor.role, 'reviewer');
  assert.ok(fresh.launches.at(-1).retainedContext.messages.some(message => message.content === 'Keep the empty-state decision.'));
  const reviewer = (await readRun(fresh.context, run.id)).attempts.find(attempt => attempt.role === 'reviewer'); assert.ok(reviewer.confirmedAt);
  const reviewerActor = { ...fresh.context, principal: { audience: 'agent', unitId: null, sessionId: reviewer.sessionId } };
  await assert.rejects(callPlanTool(reviewerActor, 'plan_dispatch', { runId: run.id, role: 'builder', taskId: fresh.taskId, expectedRevision: (await readRun(fresh.context, run.id)).revision, requestId: randomUUID() }), { code: 'plan_lead_required' });
});

test('Claude, Cursor and Lyra structured initialization bind real attempts; local done is not a delivered task', async t => {
  for (const client of ['claude', 'cursor', 'lyra']) await t.test(client, async t => {
    const state = await makePlanFixture(t), nativeId = randomUUID(); let adapter, choice;
    if (client !== 'lyra') {
      const transcript = client === 'claude' ? [{ type: 'system', subtype: 'init', session_id: nativeId, model: 'observed' }]
        : [{ jsonrpc: '2.0', id: 1, result: { sessionId: nativeId } }];
      adapter = createNativeAdapter(client, { fixture: true, models: ['observed'], transcript: transcript.map(value => JSON.stringify(value)) }); choice = { ...runsIn, client };
    } else {
      const status = { ollama: { running: true }, installed: [{ name: 'lyra-base' }], modes: { fast: { model: 'lyra-base' }, normal: { model: 'lyra-base' }, thinking: { model: 'lyra-thinking' } } };
      adapter = openLyraAdapter({ tokens: { get: async () => 'fixture-app-token', set: async () => {} },
        discover: async () => ({ pid: 10, port: 1, home: state.root, startedAt: new Date(state.clock.now).toISOString() }),
        fetch: async (url, options) => {
          const route = new URL(url).pathname;
          if (route === '/v1/apps/current') return Response.json({ id: 'hivem1nd', kind: 'app', status: 'granted', scopes: ['chat', 'models', 'tools'] }); // Compatibility: Lyra app grants retain their registered identity.
          if (route === '/v1/models') return Response.json(status);
          if (route === '/v1/tools') { assert.equal(options.method, 'PUT'); return new Response(null, { status: 204 }); }
          if (route === '/v1/chat') {
            const body = JSON.parse(options.body); assert.equal(body.cloud, false); assert.equal(body.tools.includes('plan_dispatch'), false);
            return new Response([{ type: 'start', mode: 'normal', model: 'lyra-base', provider: 'local', fellBack: false },
              { type: 'thinking' }, { type: 'text', text: 'Draft prose is not a task report.' }, { type: 'done' }].map(value => JSON.stringify(value)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
          }
          throw new Error('Unexpected local route');
        } });
      choice = { client, model: 'lyra-base', effort: null, mode: 'normal' };
    }
    t.after(() => adapter.close()); state.context.adapters[client] = adapter;
    state.input.roles.planner = { kind: 'client', client, runsIn: choice, reuseRole: null };
    const plan = await createPlan(state.context, state.input), started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
    let run = await readRun(state.context, started.runId), coordinator = run.attempts[0];
    const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: coordinator.sessionId } };
    const result = await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'planner', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
    let planner;
    for (let tries = 0; tries < 100; tries++) {
      run = await readRun(state.context, run.id); planner = run.attempts.find(attempt => attempt.id === result.attemptId);
      if (planner?.confirmedAt && (client !== 'lyra' || (await adapter.observe({ nativeSessionId: (JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'intents', `${planner.id}.json`)))).binding.nativeSessionId })).activity === 'idle')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await drainRunProcesses(state.context);
    assert.ok(planner.confirmedAt); assert.equal(planner.resolved, false);
    assert.equal(run.watches.find(watch => watch.attemptId === planner.id).lastStepAt, planner.confirmedAt);
    if (client === 'lyra') {
      const evidence = JSON.parse(await readFile(path.join(state.paths.localDirectory, 'runs', run.id, 'evidence', `${planner.id}.json`)));
      assert.equal(evidence.processExited, true); assert.equal(evidence.cleanupVerified, true); assert.equal(evidence.report, null);
    }
  });
});

test('all eight bound tools retain receipts, charge only distinct authored messages and require a different role for credit', async t => {
  const state = await makePlanFixture(t);
  await writeFile(path.join(state.paths.mind, 'user', 'tasks', '002.md'), `id: root:002\nstatus: open\nfrom-id: root:master\nto-id: ${state.units[0].id}\nfiles: ["second.txt"]\n\n## Request\nSecond accepted task.\n`);
  state.input.tasks.push({ ...state.input.tasks[0], id: 'root:002', title: 'Second task' });
  const plan = await createPlan(state.context, state.input), started = await startPlan(state.context, plan.id, { confirmed: true, expectedRevision: plan.revision }); await drainRunLaunches(state.context);
  let run = await readRun(state.context, started.runId); const coordinator = run.attempts[0];
  const actor = { ...state.context, principal: { audience: 'agent', unitId: state.units[0].id, sessionId: coordinator.sessionId } };
  const confirm = { runId: run.id, attemptId: coordinator.id, requestId: randomUUID() };
  assert.equal((await callPlanTool(actor, 'plan_confirm_start', confirm)).confirmed, true);
  run = await readRun(state.context, run.id);
  const dispatched = await callPlanTool(actor, 'plan_dispatch', { runId: run.id, role: 'planner', taskId: null, expectedRevision: run.revision, requestId: randomUUID() }); await drainRunLaunches(state.context);
  run = await readRun(state.context, run.id); const planner = run.attempts.find(attempt => attempt.id === dispatched.attemptId);
  const worker = { ...actor, principal: { ...actor.principal, sessionId: planner.sessionId } };
  const send = { runId: run.id, recipientRoles: ['planner'], text: 'Review the accepted source.', requestId: randomUUID() };
  const sent = await callPlanTool(actor, 'plan_send', send); assert.deepEqual(await callPlanTool(actor, 'plan_send', send), sent);
  assert.equal((await readRun(state.context, run.id)).budget.used, 1);
  await assert.rejects(callPlanTool(actor, 'plan_read', { runId: run.id, messageIds: [sent.messageId], requestId: randomUUID() }), { code: 'forbidden' });
  assert.deepEqual((await callPlanTool(worker, 'plan_read', { runId: run.id, messageIds: [sent.messageId], requestId: randomUUID() })).messageIds, [sent.messageId]);
  run = await readRun(state.context, run.id);
  const extension = await callPlanTool(actor, 'plan_extend', { runId: run.id, count: 1, reason: 'Clarify the accepted task.', expectedRevision: run.revision, requestId: randomUUID() });
  run = await readRun(state.context, run.id);
  await assert.rejects(callPlanTool(actor, 'plan_agree', { runId: run.id, extensionId: extension.extensionId, expectedRevision: run.revision, requestId: randomUUID() }), { code: 'invalid_extension' });
  const agreed = await callPlanTool(worker, 'plan_agree', { runId: run.id, extensionId: extension.extensionId, expectedRevision: run.revision, requestId: randomUUID() });
  assert.equal(agreed.budget.limit, 3); assert.equal(agreed.budget.roleExtra, 1);
  assert.equal((await readRun(state.context, run.id)).budget.used, 1);
  await assert.rejects(callPlanTool(worker, 'plan_report', { runId: run.id, attemptId: coordinator.id, outcome: 'delivered', summary: 'Forged report', requestId: randomUUID() }), { code: 'forbidden' });
});
