/* T077 source port manifest. Enumerated read-only on 2026-10-14.
Dependent verification: 41 suites, 883 tests, 882 passed, 0 canceled; the service-api
route-coverage assertion at test/service-api.test.mjs:1704 also fails with all
changed production modules loaded read-only from committed HEAD, for the same
GET /additions, POST /additions and DELETE /additions/:additionId coverage gaps.
That pre-existing test and the HTTP route table are outside T077; neither was changed.
Baseline: d3ef43a; source head: 594e13529895d394e1d57572534ccb3372924832.

[
  {
    "hash": "ddb38ce6115f637d405d911bad4fa078953a8a71",
    "behavior": "Carry a Claude chat's unit and wake through its host conversation",
    "sourceRegressions": {
      "test/relay-carry-over.test.mjs": [
        "a new MCP process of a carried session adopts its registration instead of failing",
        "the MCP server of a new session of the same host conversation takes the unit and the wake back before any call",
        "a register call through the MCP server records its host conversation, and another conversation carries nothing",
        "a registration made before host conversations were recorded is carried from the session transcript by the MCP server",
        "registering by hand in the same host conversation takes the wake the earlier session still holds"
      ]
    },
    "adaptation": "Verified owner host conversation; transcript parsing and hook/MCP worker spawning replaced by exact native grant proof. Legacy transcript cases map to relay-carry-over isolation/refusal and verified explicit registration cases; no caller path is read.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled",
    "sourceBaselineCases": [
      "the last registration of a transcript is its last register call, not a mention of it",
      "only the transcript of this exact session inside the Claude projects folder is read",
      "a conversation under a new native session keeps its unit and its wake, and says so once",
      "nothing is carried when the old session now speaks for another unit, or the transcript names no registration",
      "a new MCP process of a carried session adopts its registration instead of failing",
      "a restarted MCP server of the same native session reads the inbox its earlier process registered",
      "an MCP server started for an explicit native session keeps its unit across a restart for any client",
      "the MCP server of a new session of the same host conversation takes the unit and the wake back before any call",
      "a register call through the MCP server records its host conversation, and another conversation carries nothing",
      "a registration made before host conversations were recorded is carried from the session transcript by the MCP server",
      "registering by hand in the same host conversation takes the wake the earlier session still holds",
      "a chat that registers a unit takes the consent an earlier session of the unit holds, and starts its worker",
      "a session whose process starts again under the same ID gets its wake back from the new process, also after the old pipe paused it"
    ],
    "adaptedCases": [
      "a verified host conversation carries its unit and wake to the new native session without renewing consent",
      "another host, unit, machine or unproved native binding carries nothing and a caller transcript cannot establish identity",
      "disabled, expired and unanswered-exhausted consent is never revived by host carry-over",
      "restarting a verified native connection retains the same consent, debt, daily usage and pointer identity",
      "a restarted MCP process answers for the exact served native session for every client",
      "host conversation identities are bounded and never taken from a path or last-active chat",
      "a verified explicit registration can continue a legacy conversation without trusting its transcript",
      "a host record whose old native session now speaks for another unit cannot transfer its consent"
    ]
  },
  {
    "hash": "32ea6a0d166d9e0a7302cf6abad4bcc6a28d5b1b",
    "behavior": "Release 2.0.2",
    "sourceRegressions": {},
    "adaptation": "Release-only CHANGELOG/package/lock bump deliberately excluded; target 3.0 metadata retained.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "a5f820b9b532d7e06ca28df80bb15bf518bbf578",
    "behavior": "Keep a chat's Relay unit when its MCP server starts again",
    "sourceRegressions": {
      "test/relay-carry-over.test.mjs": [
        "a restarted MCP server of the same native session reads the inbox its earlier process registered",
        "an MCP server started for an explicit native session keeps its unit across a restart for any client"
      ],
      "test/relay-store.test.mjs": [
        "a new instance that serves a registered native session keeps its unit; another session or machine is not registered"
      ]
    },
    "adaptation": "Served native session lookup retained in store; 3.0 stdio reconnects through connectNativeService. Restart cases mapped to relay-carry-over and service-native-bridge reconnect tests.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "1044b4aa1ef584fa34ef20726928063a96b804ae",
    "behavior": "Move a wake consent to the newest registration of its unit",
    "sourceRegressions": {
      "test/relay-carry-over.test.mjs": [
        "registering by hand in the same host conversation takes the wake the earlier session still holds",
        "a chat that registers a unit takes the consent an earlier session of the unit holds, and starts its worker",
        "a session whose process starts again under the same ID gets its wake back from the new process, also after the old pipe paused it"
      ],
      "test/relay-store.test.mjs": [
        "a chat that registers again as the same unit keeps its record, and a change of unit or an observation writes a new one",
        "a chat that registers its unit again after another chat registered it becomes the newest registration of the unit"
      ],
      "test/relay-wake.test.mjs": [
        "delivery status shows the state the recipient worker recorded, then the read and the reply",
        "a worker whose session a newer registration of the unit replaced hands the consent over instead of waking it"
      ]
    },
    "adaptation": "Canonical newest-registration takeover transfers intersected consent and deliveries without resetting usage; error-paused reconnect resumes through the shared controller. Tests in relay-carry-over, relay-store, relay-wake and service-native-bridge.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "06f195ddff54d453415dd5558c1599971601d6c4",
    "behavior": "Give the Relay MCP status tool a compact, filtered and paged answer",
    "sourceRegressions": {
      "test/relay-mcp.test.mjs": [
        "delivery_status answers for messages the registered unit sent and rejects arguments it does not take",
        "status answers with counts, the caller and the units waiting by default, and lists every unit only in pages on request"
      ]
    },
    "adaptation": "Compact paged overview composes scopeLock and strips native/host identities. Original MCP summary/page/filter assertions in relay-mcp; owner isolation in service-native-bridge and relay-port.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "2248ce03ec72d32c09dd3a956ecc3d6e1ca3dcac",
    "behavior": "Name each message by id, sender and subject in a wake pointer",
    "sourceRegressions": {
      "test/relay-claude-wake.test.mjs": [
        "Claude wake refuses text that is not the Relay pointer shape and a binding that is not valid before it connects"
      ],
      "test/relay-more-agents.test.mjs": [
        "Cursor stop is quiet without consent or unread, counts handoffs, and never archives content",
        "Cursor stop still follows up after the chat registers again, because the consent names the unit and the chat",
        "real host worker attaches, sends to the local fixture, and stops after exact disable"
      ],
      "test/relay-wake.test.mjs": [
        "a worker whose session a newer registration of the unit replaced hands the consent over instead of waking it",
        "a wake pointer names up to five messages by id, sender and subject on one line, and never their bodies"
      ]
    },
    "adaptation": "Common wakePointer generator and shared validation, including Codex and legacy Cursor reservations. Original transport/pointer assertions in relay-claude-wake, relay-more-agents and relay-wake.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "8e2b960c6a984158b84d13abe7fda3af028de794",
    "behavior": "Renew a wake window while its session is in use and say once when it ended",
    "sourceRegressions": {
      "test/relay-hooks.test.mjs": [
        "the registration index is built by the first hook, extended by the names that appear and rebuilt when a record leaves",
        "the first hook turn after a wake window ended says so once, and a turn inside the window starts it again"
      ],
      "test/relay-mcp.test.mjs": [
        "status answers with counts, the caller and the units waiting by default, and lists every unit only in pages on request",
        "a Relay tool call keeps the wake window of its session open, and the first call after the window ended carries the notice once"
      ],
      "test/relay-wake.test.mjs": [
        "a wake pointer names up to five messages by id, sender and subject on one line, and never their bodies",
        "activity of the session starts its window again, and the first call after a window that passed says so once"
      ]
    },
    "adaptation": "Verified owner activity renews every intersected window at most once per five minutes; one-time expiry notice forwarded by shared hooks/MCP. relay-wake source case retained; standalone hook/MCP cases mapped to relay-hooks and service-native-bridge.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "ae1690abceb60eb40f7545fe6ace18679d3bcc72",
    "behavior": "Retire older registrations of a unit whose sessions are no longer live",
    "sourceRegressions": {
      "test/relay-mcp.test.mjs": [
        "a Relay tool call keeps the wake window of its session open, and the first call after the window ended carries the notice once",
        "the MCP server of a chat holds its session, so a later registration of the unit keeps it while an abandoned one is retired"
      ],
      "test/relay-store.test.mjs": [
        "a chat that registers its unit again after another chat registered it becomes the newest registration of the unit",
        "a new registration of a unit retires the older ones of that unit on this machine whose sessions show no sign of life, and only those"
      ]
    },
    "adaptation": "Retirement needs verified native/session closure, never shared service PID. Original live/dead/foreign/recent/retired-readability assertions in relay-store with injected native liveness; holder identity in relay-carry-over.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "4561d4994933e79068bd7f595e4acc07c2772b82",
    "behavior": "Wake for messages that arrive by sync while their file is still busy",
    "sourceRegressions": {
      "test/relay-wake.test.mjs": [
        "activity of the session starts its window again, and the first call after a window that passed says so once",
        "a message that another machine wrote and OneDrive synced into the inbox wakes the session, also while a file is half written or busy",
        "read failures that clear on the next poll, as a sync gives them, never add up to pausing the wake"
      ]
    },
    "adaptation": "Skip busy/half-written/replaced sync files and clear consecutive inbox-read failures after a clean poll. Original source cases retained in relay-wake.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "606e95343b1c7ec92cd712f2681fa46891293aa5",
    "behavior": "Count only unanswered wakes against the handoff budget and say once when it ran out",
    "sourceRegressions": {
      "test/relay-mcp.test.mjs": [
        "the MCP server of a chat holds its session, so a later registration of the unit keeps it while an abandoned one is retired",
        "a Relay tool call answers the wakes of its session, and the first call after the budget ran out carries the notice once"
      ],
      "test/relay-wake.test.mjs": [
        "urgent arrivals bypass normal cooldown while busy and the handoff budget stops wakes the session does not answer",
        "read failures that clear on the next poll, as a sync gives them, never add up to pausing the wake",
        "activity of the session answers its wakes, and the first call after the budget ran out says so once"
      ]
    },
    "adaptation": "Activity resets unanswered debt only; exhausted consent stays closed and gives one notice. Original urgent/debt/notice cases retained in relay-wake.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  },
  {
    "hash": "594e13529895d394e1d57572534ccb3372924832",
    "behavior": "Cap the wakes of a consent per local calendar day",
    "sourceRegressions": {
      "test/relay-cli.test.mjs": [
        "relay wake status reads a binding of another machine only when --machine names it",
        "wake attach and enable take a daily wake cap within its bounds and pass it to the consent"
      ],
      "test/relay-hooks.test.mjs": [
        "a Claude hook opens a fixed number of policies and registrations however many exist, and only an event with a notice reads the inbox",
        "the first hook turn after a wake window ended says so once, and a turn inside the window starts it again",
        "a hook turn of a session whose consent reached the day's wake cap is told once, though the consent is still enabled"
      ],
      "test/relay-wake.test.mjs": [
        "activity of the session answers its wakes, and the first call after the budget ran out says so once",
        "a hard cap of wakes per local day holds wakes back until midnight, whatever the activity or a new attach, and says so once",
        "a consent that moves to a newer session of its unit keeps the day's count and its cap"
      ]
    },
    "adaptation": "Exact source daily default 200, integer 1..1000, local-calendar midnight; submitted/ambiguous batches once, deferred/unsubmitted zero, Cursor reservation and interrupted recovery. Usage/notices preserved across native restart, takeover and canonical aliases. Source cap and CLI cases retained in relay-wake/relay-cli; intersections in relay-carry-over, relay-wake-aliases, service-native-bridge and relay-port.",
    "proofResult": "PASSED: T077 Proof, 467 passed, 0 failed, 0 canceled"
  }
]
*/
import './relay-local-state.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRelay } from '../engine/relay/store.mjs';
import { createRelayWakeController } from '../engine/relay/wake.mjs';
import { makeRelayMind } from './relay-test-fixture.mjs';

async function world(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-port-'));
  const mindPath = await makeRelayMind(root), hostname = 'RELAYTEST';
  const relay = await createRelay({ mindPath, hostname, client: 'claude' });
  const registration = await relay.register({ unit: 'overseer', nativeSessionId: 'exact-native' });
  const binding = { unit: registration.unit, unitId: registration.unitId, nativeSessionId: registration.nativeSessionId, client: 'claude', machine: hostname };
  const controllers = [];
  const controller = async (sink, extra = {}) => {
    const value = await createRelayWakeController({ mindPath, hostname, sink, pollIntervalMs: 250,
      retryPolicy: { sinkTimeoutMs: 1000, leaseMs: 10000, cooldownMs: 1000, baseDelayMs: 100, maxDelayMs: 300 }, ...extra });
    controllers.push(value);
    return value;
  };
  t.after(async () => { for (const value of controllers) await value.stopAll(); await rm(root, { recursive: true, force: true }); });
  return { mindPath, relay, binding, controller };
}

async function until(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('The bounded owner wake check did not finish.');
}

test('the source manifest classifies every enumerated commit and restores each source regression suite with 3.0 metadata retained', async () => {
  const text = (await readFile(new URL(import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const manifest = JSON.parse(text.slice(text.indexOf('\n[\n') + 1, text.indexOf('\n*/')));
  assert.equal(manifest.length, 11);
  assert.equal(new Set(manifest.map(entry => entry.hash)).size, 11);
  for (const entry of manifest) {
    assert.match(entry.hash, /^[a-f0-9]{40}$/);
    assert.ok(entry.behavior && entry.adaptation && entry.proofResult);
    for (const suite of Object.keys(entry.sourceRegressions)) assert.match(await readFile(suite, 'utf8'), /test\(/);
  }
  assert.match(manifest.find(entry => entry.hash.startsWith('32ea6a0')).adaptation, /Release-only/);
  assert.equal(JSON.parse(await readFile('package.json', 'utf8')).version, '3.0.0');
  assert.equal(JSON.parse(await readFile('package-lock.json', 'utf8')).version, '3.0.0');
});

test('a non-expiring consent retains the daily cap, including urgent wakes, while the owner keeps polling at no model cost', async t => {
  const w = await world(t), notices = [];
  let now = new Date(2026, 9, 14, 23).getTime(), polls = 0;
  const wake = await w.controller(async notice => { notices.push(notice); return { status: 'submitted' }; }, {
    clock: { now: () => now, sleep(ms, signal) {
      polls++;
      return new Promise(resolve => {
        const timer = setTimeout(done, ms);
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
        signal?.addEventListener('abort', done, { once: true });
        if (signal?.aborted) done();
      });
    } },
  });
  await wake.enable({ ...w.binding, unlimited: true, manualConsent: true, maxDailyHandoffs: 2 });
  const worker = wake.start(w.binding);
  assert.equal((await worker.ready).ownsLease, true);
  for (let i = 1; i <= 2; i++) {
    await w.relay.send({ to: 'overseer', subject: `Step ${i}`, body: 'body', priority: 'urgent' });
    await until(async () => (await wake.status(w.binding)).dailyCount === i);
    await wake.touch(w.binding);
    now += 1001;
  }
  await w.relay.send({ to: 'overseer', subject: 'Urgent at cap', body: 'body', priority: 'urgent' });
  const before = polls;
  await until(() => polls >= before + 2);
  assert.equal(notices.length, 2);
  assert.equal((await wake.status(w.binding)).enabled, true);
  assert.equal((await wake.status(w.binding)).worker.state, 'running');
  await worker.stop();
});

test('interrupted attempting batches become ambiguous and count once; unsubmitted or deferred batches spend no daily quota', async t => {
  const w = await world(t);
  let attempts = 0;
  const wake = await w.controller(async () => { attempts++; return { status: 'not_submitted', deferred: true }; }, {
    adapters: { claude: { acceptsDeferred: true } },
  });
  await wake.enable(w.binding);
  const directory = path.join(w.mindPath, 'user', 'relay', 'wake', 'policies');
  const file = path.join(directory, (await readdir(directory))[0]);
  const policy = JSON.parse(await readFile(file, 'utf8'));
  const sent = await w.relay.send({ to: 'overseer', subject: 'Interrupted', body: 'body' });
  await writeFile(file, JSON.stringify({ ...policy, deliveries: { [sent.id]: { state: 'attempting', attempts: 1, lastAttemptAt: policy.startedAt } } }));
  let worker = wake.start(w.binding);
  assert.equal((await worker.ready).ownsLease, true);
  await until(async () => (await wake.status(w.binding)).dailyCount === 1);
  assert.equal((await wake.status(w.binding)).ambiguousCount, 1);
  assert.equal(attempts, 0);
  await worker.stop();
  worker = wake.start(w.binding);
  await worker.ready;
  await w.relay.send({ to: 'overseer', subject: 'Busy', body: 'body' });
  await until(() => attempts >= 2);
  assert.equal((await wake.status(w.binding)).dailyCount, 1);
  assert.equal((await wake.status(w.binding)).pendingCount, 0);
  await worker.stop();
});

test('scoped compact status and inbox remain isolated when two projects use the same short unit name', async t => {
  const w = await world(t);
  await writeFile(path.join(w.mindPath, 'user', 'routes.md'), '## Projects\n- alpha\n- beta\n');
  for (const project of ['alpha', 'beta']) {
    await mkdir(path.join(w.mindPath, 'user', 'projects', project, 'state'), { recursive: true });
    await writeFile(path.join(w.mindPath, 'user', 'projects', project, 'state', 'worker.md'), `unit: worker\nstate: in\n\n${project}.\n`);
  }
  const alpha = await w.relay.register({ unit: 'worker', unitId: 'project:alpha:worker', nativeSessionId: 'alpha-native' });
  await w.relay.register({ unit: 'worker', unitId: 'project:beta:worker', nativeSessionId: 'beta-native' });
  const scoped = await createRelay({ mindPath: w.mindPath, hostname: w.binding.machine, scopeLock: true,
    pinnedRegistration: alpha, proveBinding: async () => true });
  assert.equal((await scoped.inbox()).unit, 'worker');
  const overview = await scoped.overview({ detail: true, limit: 1 });
  assert.equal(overview.total, 1);
  assert.equal(overview.units[0].scope, 'project:alpha');
  assert.equal(JSON.stringify(overview).includes('beta-native'), false);
  assert.equal(JSON.stringify(overview).includes('alpha-native'), false);
  assert.equal((await scoped.overview()).counts.units, 1);
});

test('simultaneous verified activity claims each expiry, debt or daily notice once', async t => {
  for (const reason of ['expired', 'debt', 'daily']) await t.test(reason, async t => {
    const w = await world(t);
    let now = new Date(2026, 9, 14, 23).getTime();
    const wake = await w.controller(async () => ({ status: 'not_submitted' }), { clock: { now: () => now, sleep: () => Promise.resolve() } });
    await wake.enable({ ...w.binding, maxHandoffs: 1, maxDailyHandoffs: 1 });
    const directory = path.join(w.mindPath, 'user', 'relay', 'wake', 'policies');
    const file = path.join(directory, (await readdir(directory))[0]);
    const policy = JSON.parse(await readFile(file, 'utf8'));
    if (reason === 'expired') now += 5 * 3600000;
    if (reason === 'debt') await writeFile(file, JSON.stringify({ ...policy, wakeCount: 1, pausedReason: 'handoff-budget-exhausted' }));
    if (reason === 'daily') await writeFile(file, JSON.stringify({ ...policy, day: { date: '2026-10-14', count: 1 } }));
    const notices = await Promise.all([wake.touch(w.binding), wake.touch(w.binding)]);
    assert.equal(notices.filter(item => item.notice).length, 1);
  });
});
