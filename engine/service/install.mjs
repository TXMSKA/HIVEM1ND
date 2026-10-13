import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './identity.mjs';
import { assertLocalStaging, assertNoLinks, localCosmic, mindKeyFor, oneDriveRoots } from './paths.mjs';
import { aclRunnerFrom, protectBootstrapFiles, protectLocalFile } from './security.mjs';
import { assertLegacyWakeClosure, requireLegacyClosure } from '../relay/local-wake.mjs';

function fail(status, code, message) {
  throw new CoreError(status, code, message);
}

function assertToken(value, label) {
  const text = String(value ?? '');
  if (text === '') fail(422, 'invalid_path', `${label} is required.`);
  if (/[\u0000\r\n]/.test(text)) fail(422, 'invalid_path', 'A registration argument cannot contain a line break.');
}

export function quoteWindows(value) {
  const text = String(value);
  assertToken(text, 'argument');
  if (!/[\s"]/.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeSystemd(value) {
  const text = String(value);
  assertToken(text, 'argument');
  const escaped = text.replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/"/g, '\\"');
  return /[\s"]/.test(text) ? `"${escaped}"` : escaped;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function planRegistration(input) {
  const platform = input.platform;
  assertToken(input.nodePath, 'node');
  assertToken(input.cliPath, 'cli');
  assertToken(input.mindPath, 'mind');
  assertToken(input.workingDirectory, 'working directory');
  if (platform === 'win32') return planWindows(input);
  if (platform === 'darwin') return planMac(input);
  if (platform === 'linux') return planLinux(input);
  fail(422, 'invalid_path', 'This platform has no user service plan.');
}

function serviceNameFor(sid) {
  return `HIVEM1ND-${createHash('sha256').update(String(sid)).digest('hex').slice(0, 16)}`;
}

function registrationDigest(body) {
  return createHash('sha256').update(body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()).digest('hex');
}

function xmlText(body, tag) {
  const values = [...body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'))];
  if (values.length !== 1) return null;
  return values[0][1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export async function queryRegistration(plan, { current = null, run = spawnSync } = {}) {
  if (plan.platform !== 'win32') {
    await assertNoLinks(plan.file);
    const bytes = await readFile(plan.file).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
    const digest = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
    const absent = { present: false, filePresent: bytes !== null, fileDigest: digest };
    const inspect = (file, args) => {
      const result = run(file, args, { shell: false, timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      if (result?.error || result?.status !== 0) throw new CoreError(503, 'service_unavailable', 'The user service manager could not be queried.');
      return String(result.stdout ?? '');
    };
    let loaded;
    if (plan.platform === 'darwin') {
      const uid = inspect('launchctl', ['manageruid']).trim();
      if (!/^\d+$/.test(uid) || plan.uid !== undefined && Number(uid) !== plan.uid) throw new CoreError(503, 'service_unavailable', 'The launch manager does not belong to the current user.');
      const listing = inspect('launchctl', ['list']);
      const labels = listing.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/).slice(2).join(' '));
      if (!labels.includes(plan.label ?? plan.name)) return absent;
      const details = inspect('launchctl', ['list', plan.label ?? plan.name]);
      const stringValue = (key) => {
        const match = details.match(new RegExp(`"${key}"\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`));
        try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
      };
      const block = details.match(/"ProgramArguments"\s*=\s*\(([\s\S]*?)\);/);
      const strings = block ? [...block[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => JSON.parse(match[0])) : [];
      const same = (expected) => stringValue('Label') === (plan.label ?? plan.name)
        && JSON.stringify(strings) === JSON.stringify(expected.arguments)
        && (stringValue('Program') === null || stringValue('Program') === expected.executable)
        && stringValue('WorkingDirectory') === xmlText(expected.body.match(/<key>WorkingDirectory<\/key>([\s\S]*?)<key>/)?.[1] ?? '', 'string');
      loaded = { current: same(current ?? plan), planned: same(plan) };
    } else {
      const details = inspect('systemctl', ['--user', 'show', plan.unit ?? plan.name, '--no-pager', '--property=LoadState,FragmentPath,DropInPaths,NeedDaemonReload,UnitFileState']);
      const properties = new Map(details.trim().split(/\r?\n/).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
      if (properties.get('LoadState') === 'not-found') return absent;
      if (!properties.has('LoadState')) throw new CoreError(503, 'service_unavailable', 'The user service manager response is not valid.');
      const matches = properties.get('LoadState') === 'loaded' && properties.get('FragmentPath') === plan.file
        && properties.get('DropInPaths') === '' && properties.get('NeedDaemonReload') === 'no';
      const enabled = properties.get('UnitFileState') === 'enabled';
      loaded = { current: matches, planned: matches && enabled, enabled };
    }
    const expected = current ?? plan;
    const match = loaded.current && digest === expected.digest;
    return { present: true, digest, executable: match ? expected.executable : null, arguments: match ? expected.arguments : [], matchesPlan: loaded.planned && digest === plan.digest, installationId: match ? current?.installationId : null, ...(loaded.enabled !== undefined ? { enabled: loaded.enabled } : {}) };
  }
  const result = run('schtasks.exe', ['/Query', '/TN', plan.name, '/XML'], { windowsHide: true, shell: false, timeout: 8000, maxBuffer: 1024 * 1024 });
  if (result?.error) throw new CoreError(503, 'service_unavailable', 'The login registration could not be queried.');
  if (result?.status !== 0) {
    if (result?.status === 1) return { present: false };
    throw new CoreError(503, 'service_unavailable', 'The login registration could not be queried.');
  }
  const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? ''));
  const body = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe || bytes[1] === 0 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  if (!body.includes('<Task') || body.includes('<!DOCTYPE') || body.includes('<!ENTITY')) throw new CoreError(503, 'service_unavailable', 'The login registration is not valid.');
  const expected = current ?? plan;
  const digest = registrationDigest(body);
  const executable = xmlText(body, 'Command');
  const argumentsText = xmlText(body, 'Arguments');
  const plannedArguments = (plan.arguments ?? []).map(quoteWindows).join(' ');
  const userIds = [...body.matchAll(/<UserId>([^<]+)<\/UserId>/g)].map(match => match[1]);
  const logonTrigger = body.match(/<LogonTrigger(?:\s[^>]*)?>([\s\S]*?)<\/LogonTrigger>/)?.[1] ?? '';
  const settings = body.match(/<Settings(?:\s[^>]*)?>([\s\S]*?)<\/Settings>/)?.[1] ?? '';
  const matchesPlan = executable === plan.executable && argumentsText === plannedArguments
    && xmlText(body, 'WorkingDirectory') === xmlText(plan.body, 'WorkingDirectory')
    && userIds.length === 2 && userIds.every(value => value === xmlText(plan.body.match(/<Principals>[\s\S]*?<\/Principals>/)?.[0] ?? '', 'UserId'))
    && xmlText(body, 'LogonType') === 'InteractiveToken'
    && xmlText(body, 'RunLevel') === 'LeastPrivilege'
    && xmlText(body, 'MultipleInstancesPolicy') === 'IgnoreNew'
    && xmlText(body, 'StartWhenAvailable') === 'true'
    && xmlText(body, 'ExecutionTimeLimit') === 'PT0S'
    && (!/<Enabled(?:\s|>)/.test(settings) || xmlText(settings, 'Enabled') === 'true')
    && (body.match(/<Exec(?:\s|>)/g) ?? []).length === 1
    && (body.match(/<Principal(?:\s|>)/g) ?? []).length === 1
    && (body.match(/<LogonTrigger(?:\s|>)/g) ?? []).length === 1
    && xmlText(logonTrigger, 'Enabled') === 'true'
    && !/<(?:Repetition|Delay|StartBoundary|EndBoundary)(?:\s|>)/.test(logonTrigger)
    && !/<(?:ComHandler|CalendarTrigger|BootTrigger|EventTrigger|IdleTrigger|RegistrationTrigger|SessionStateChangeTrigger|TimeTrigger)(?:\s|>)/.test(body);
  const matches = executable === expected.executable
    && argumentsText === (expected.arguments ?? []).map(quoteWindows).join(' ')
    && (digest === (expected.actualDigest ?? registrationDigest(expected.body ?? ''))
      || expected.verification === 'pending' && expected.digest === plan.digest && matchesPlan);
  return { present: true, digest, executable, arguments: matches ? expected.arguments : matchesPlan ? plan.arguments : [], matchesPlan, installationId: matches ? current?.installationId : null };
}

function planWindows(input) {
  const sid = input.sid ?? 'S-1-5-21-0';
  if (!/^S-\d+-\d+(?:-\d+)+$/.test(sid)) fail(422, 'invalid_path', 'The current user SID is not valid.');
  const name = input.name ?? serviceNameFor(sid);
  const args = [input.cliPath, 'service', 'run', '--mind-path', input.mindPath].map(quoteWindows).join(' ');
  const body = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Principals><Principal id="Author"><UserId>${xml(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(sid)}</UserId></LogonTrigger></Triggers>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions><Exec><Command>${xml(input.nodePath)}</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(input.workingDirectory)}</WorkingDirectory></Exec></Actions>
</Task>`;
  const file = path.join(input.localDirectory ?? input.workingDirectory, 'service-task.xml');
  return {
    platform: 'win32',
    name,
    file,
    body,
    encoding: 'utf-16le',
    executable: input.nodePath,
    arguments: [input.cliPath, 'service', 'run', '--mind-path', input.mindPath],
    argv: ['schtasks.exe', '/Create', '/XML', file, '/TN', name],
    commands: [`schtasks.exe /Create /XML ${quoteWindows(file)} /TN ${quoteWindows(name)}`],
    digest: createHash('sha256').update(body).digest('hex'),
  };
}

function planMac(input) {
  const label = input.label ?? 'com.hivem1nd.service';
  const args = [input.nodePath, input.cliPath, 'service', 'run', '--mind-path', input.mindPath];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${args.map((item) => `<string>${xml(item)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(input.workingDirectory)}</string><key>RunAtLoad</key><true/><key>ThrottleInterval</key><integer>5</integer></dict></plist>`;
  const file = path.join(input.home ?? input.workingDirectory, 'Library', 'LaunchAgents', `${label}.plist`);
  const uid = input.uid ?? 501;
  return {
    platform: 'darwin',
    uid,
    label,
    file,
    body,
    executable: input.nodePath,
    arguments: args,
    commands: [`launchctl bootstrap gui/${uid} ${file}`, `launchctl bootout gui/${uid} ${file}`],
    digest: createHash('sha256').update(body).digest('hex'),
  };
}

function planLinux(input) {
  if (input.userManager === false) fail(503, 'service_unavailable', 'The user service manager is not available.');
  const unit = input.unitName ?? 'hivem1nd.service';
  const args = [input.nodePath, input.cliPath, 'service', 'run', '--mind-path', input.mindPath];
  const exec = args.map(escapeSystemd).join(' ');
  const body = `[Service]\nType=simple\nExecStart=${exec}\nWorkingDirectory=${escapeSystemd(input.workingDirectory)}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
  const file = path.join(input.configHome ?? path.join(input.home ?? input.workingDirectory, '.config'), 'systemd', 'user', unit);
  return {
    platform: 'linux',
    unit,
    file,
    body,
    executable: input.nodePath,
    arguments: args,
    commands: ['systemctl --user daemon-reload', `systemctl --user enable --now ${unit}`],
    digest: createHash('sha256').update(body).digest('hex'),
  };
}

export function registrationRunner(run) {
  return async function runPlan(plan) {
    const commands = [];
    for (const command of plan.commands ?? []) {
      commands.push(command);
      if (run) await run(command);
    }
    return { executed: commands, os: false };
  };
}

export async function startConfiguredViewer(config, options = {}) {
  const handle = options.start
    ? await options.start(config)
    : await (await import('./service.mjs')).runConfiguredService({ mindPath: config.mindPath, ...options });
  const bootstrap = handle?.bootstrap?.origin ?? handle?.bootstrapState?.record?.origin;
  const port = handle?.http?.port ?? (bootstrap ? Number(new URL(bootstrap).port) : null);
  const secret = handle?.bootstrap?.secret ?? handle?.bootstrapState?.secret;
  if (!port || !secret) throw new CoreError(503, 'service_unavailable', 'The service is not ready.');
  const url = options.login
    ? await options.login({ port, secret, handle })
    : await loginViewer(port, secret);
  if (!url) throw new CoreError(503, 'service_unavailable', 'Local login did not complete.');
  return { viewerUrl: url, handle };
}

async function loginViewer(port, secret) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/local`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ embedded: false, hostOrigin: null, look: null, language: null }),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.data?.url ?? null;
}

export async function installService(input, options = {}) {
  const plan = planRegistration(input);
  const dryRun = options.dryRun !== false;
  if (dryRun) return { ...plan, executed: [], dryRun: true, os: false, action: 'plan' };
  const actual = options.query ? await options.query(plan) : null;
  if (actual?.filePresent && actual.fileDigest !== plan.digest && actual.fileDigest !== options.current?.digest) {
    return { ...plan, commands: [], executed: [], dryRun: false, os: false, action: 'conflict', conflict: true, reason: 'The existing service file is not owned by this install.' };
  }
  if (actual?.present) {
    const ownedId = options.current?.installationId && actual.installationId === options.current.installationId
      && (actual.digest === (options.current.actualDigest ?? options.current.digest)
        || options.current.verification === 'pending' && options.current.digest === plan.digest && actual.matchesPlan === true);
    const verifiedPending = options.current?.verification === 'pending' && options.current.digest === plan.digest && actual.matchesPlan === true && ownedId;
    if ((sameActual(actual, plan, options.current) || verifiedPending) && ownedId) {
      const executed = [];
      if (plan.platform === 'darwin' && options.preserveRuntime) {
        if (!options.run) throw new CoreError(503, 'service_unavailable', 'No registration runner was provided.');
        const argv = ['launchctl', 'enable', `gui/${plan.uid}/${plan.label}`];
        await options.run(argv);
        executed.push(argv);
      }
      if (plan.platform === 'linux' && actual.enabled === false) {
        if (!options.run) throw new CoreError(503, 'service_unavailable', 'No registration runner was provided.');
        const argv = ['systemctl', '--user', 'enable', plan.unit];
        await options.run(argv);
        executed.push(argv);
        const enabled = await options.query(plan);
        if (enabled?.matchesPlan !== true || !sameActual(enabled, plan, options.current)
            || enabled.installationId !== options.current.installationId) throw new CoreError(503, 'service_unavailable', 'The login registration could not be verified after installation.');
      }
      return { ...plan, executed, dryRun: false, os: executed.length > 0, action: 'unchanged', verification: 'verified', installationId: options.current?.installationId ?? null, ...(actual.digest ? { actualDigest: actual.digest } : {}), persistVerified: verifiedPending };
    }
    if (!ownedId) {
      return { ...plan, commands: [], executed: [], dryRun: false, os: false, action: 'conflict', conflict: true, reason: 'The login registration is not owned by this install.' };
    }
  } else if (!options.query && options.current) {
    const verdict = verifyOwnedRegistration(options.current, plan);
    if (verdict.owned) return { ...plan, executed: [], dryRun: false, os: false, action: 'unchanged' };
    return { ...plan, commands: [], executed: [], dryRun: false, os: false, action: 'conflict', conflict: true, reason: verdict.reason };
  }
  await assertNoLinks(plan.file);
  await mkdir(path.dirname(plan.file), { recursive: true });
  await writeFile(plan.file, plan.platform === 'win32' ? Buffer.from(`\uFEFF${plan.body}`, 'utf16le') : Buffer.from(plan.body), { mode: 0o600 });
  if (options.aclRunner) await options.aclRunner.protect(plan.file);
  const action = actual?.present ? 'update' : 'create';
  const argv = plan.platform === 'win32'
    ? ['schtasks.exe', '/Create', '/XML', plan.file, '/TN', plan.name, ...(action === 'update' ? ['/F'] : [])]
    : plan.platform === 'darwin'
      ? ['launchctl', 'bootstrap', `gui/${input.uid ?? 501}`, plan.file]
      : ['systemctl', '--user', 'enable', '--now', plan.unit];
  if (options.run) {
    if (plan.platform === 'linux') await options.run(['systemctl', '--user', 'daemon-reload']);
    if (plan.platform === 'darwin' && action === 'update') await options.run(['launchctl', 'bootout', `gui/${input.uid ?? 501}`, plan.file]);
    await options.run(argv);
  }
  else throw new CoreError(503, 'service_unavailable', 'No registration runner was provided.');
  const installed = { ...plan, executed: [argv], dryRun: false, os: true, action, installationId: options.current?.installationId ?? randomUUID() };
  if (options.persistPendingRegistration) await options.persistPendingRegistration({ ...installed, verification: 'pending' });
  if (options.query) {
    const observed = await options.query(plan);
    if (!observed?.present || !(observed.matchesPlan ?? sameActual(observed, plan, null))) {
      throw new CoreError(503, 'service_unavailable', 'The login registration could not be verified after installation.');
    }
    installed.actualDigest = observed.digest;
  }
  installed.verification = 'verified';
  return installed;
}

export function uninstallService(plan, current) {
  const command = plan.platform === 'win32'
    ? `schtasks.exe /Delete /TN ${quoteWindows(plan.name)} /F`
    : plan.platform === 'darwin'
      ? plan.commands[1]
      : `systemctl --user disable --now ${plan.unit}`;
  if (current === undefined) return { commands: [command], dryRun: true, os: false };
  const verdict = verifyOwnedRegistration(current, plan);
  if (!verdict.owned) return { commands: [], dryRun: true, os: false, conflict: true, reason: verdict.reason };
  return { commands: [command], dryRun: true, os: false, owned: true };
}

export function verifyOwnedRegistration(current, expected) {
  if (!current) return { owned: false, reason: 'absent' };
  if (current.digest !== expected.digest) return { owned: false, reason: 'modified' };
  if (current.executable && current.executable !== expected.executable) return { owned: false, reason: 'modified' };
  if (current.arguments && JSON.stringify(current.arguments) !== JSON.stringify(expected.arguments)) return { owned: false, reason: 'modified' };
  if (current.installationId && expected.installationId && current.installationId !== expected.installationId) return { owned: false, reason: 'modified' };
  return { owned: true, reason: 'match' };
}

function sameActual(actual, plan, current) {
  if (!actual?.present) return false;
  return actual.executable === plan.executable
    && JSON.stringify(actual.arguments ?? []) === JSON.stringify(plan.arguments)
    && (actual.digest === plan.digest || current?.digest === plan.digest && actual.digest === current.actualDigest);
}

export function bootstrapConfig(config) {
  if (!config || typeof config !== 'object') fail(422, 'invalid_body', 'Config is required.');
  if (config.startWithWindows !== undefined && typeof config.startWithWindows !== 'boolean') {
    fail(422, 'invalid_body', 'startWithWindows must be a boolean.');
  }
  if (config.encryption || config.preset === 'quantum' || config.quantum || config.algorithm) {
    fail(422, 'unsupported_origin', 'Unsupported encryption is refused.');
  }
  if (!config.mindPath || !config.stagingPath) fail(422, 'invalid_body', 'Config needs a mind and a staging path.');
  if (!config.machine) fail(422, 'invalid_body', 'Config needs a machine.');
  assertLegacyWakeClosure(config.mindPath, config.machine);
  const origin = config.origin ?? { kind: 'folder', path: config.originPath };
  if (!origin?.path || (origin.kind !== 'folder' && origin.kind !== 'onedrive')) {
    fail(422, 'invalid_body', 'Config needs a folder or OneDrive origin.');
  }
  if (isInside(config.mindPath, config.stagingPath) || isInside(config.stagingPath, config.mindPath)) {
    fail(422, 'invalid_path', 'Staging cannot sit inside the mind.');
  }
  if (isInside(origin.path, config.stagingPath) || isInside(config.stagingPath, origin.path)) {
    fail(422, 'invalid_path', 'Staging cannot sit inside the origin.');
  }
  for (const root of config.syncedRoots ?? []) {
    if (isInside(root, config.stagingPath)) fail(422, 'invalid_path', 'Staging cannot sit inside a synced folder.');
  }
  return {
    format: 'hivem1nd-service-config-v1',
    mindPath: path.resolve(config.mindPath),
    machine: config.machine,
    origin: { kind: origin.kind, path: path.resolve(origin.path) },
    stagingPath: path.resolve(config.stagingPath),
    port: 0,
    startWithWindows: config.startWithWindows ?? false,
  };
}

export function ownershipRecord(plan) {
  return {
    format: 'hivem1nd-registration-v1',
    installationId: plan.installationId ?? null,
    executable: plan.executable,
    arguments: plan.arguments,
    name: plan.name ?? plan.label ?? plan.unit,
    path: plan.file,
    body: plan.body,
    digest: plan.digest,
    verification: plan.verification ?? 'verified',
    ...(plan.actualDigest ? { actualDigest: plan.actualDigest } : {}),
    ...(plan.uid !== undefined ? { uid: plan.uid } : {}),
  };
}

export async function runServicePhases(input, options = {}) {
  const dryRun = options.dryRun !== false;
  const state = { config: false, registration: false, start: false, ...(options.state ?? {}) };
  let config;
  try {
    config = bootstrapConfig(input.config);
  } catch (error) {
    return { status: 'failed', phase: 'config', state, os: false, error: error.message, code: error.code ?? 'invalid_body' };
  }
  if (!state.config) {
    const prior = { ...config, startWithWindows: options.previousStartWithWindows ?? false };
    if (!dryRun && options.persistConfig) {
      try {
        await options.persistConfig(prior);
      } catch (error) {
        return { status: 'failed', phase: 'config', state, os: false, error: error.message };
      }
    }
    state.config = true;
    state.configBody = prior;
  }
  // Runtime ownership is the protected configuration, independent of logon startup.
  state.registration = true;
  const configureStartup = options.configureStartup ?? Object.hasOwn(input.config, 'startWithWindows');
  if (configureStartup) {
    let installed;
    try {
      if (config.startWithWindows) installed = await installService(input.registration, {
        dryRun,
        run: options.run,
        current: options.current ?? null,
        query: options.query,
        aclRunner: options.aclRunner,
        persistPendingRegistration: options.persistPendingRegistration,
        preserveRuntime: true,
      });
      else if (!dryRun && options.removeRegistration) {
        const removed = await options.removeRegistration();
        if (removed.kept || removed.described) {
          return { status: 'failed', phase: 'registration', state, os: false, conflict: removed.kept?.reason ?? 'The login registration was not removed.' };
        }
      }
    } catch (error) {
      return { status: 'failed', phase: 'registration', state, os: false, error: error.message, code: error.code ?? 'service_unavailable' };
    }
    if (installed?.conflict) {
      return { status: 'failed', phase: 'registration', state, os: false, conflict: installed.reason };
    }
    if (!dryRun && options.persistRegistration && (['create', 'update'].includes(installed?.action) || installed?.persistVerified)) {
      try {
        await options.persistRegistration(installed);
      } catch (error) {
        return { status: 'failed', phase: 'registration', state, os: false, error: error.message, code: error.code ?? 'service_unavailable' };
      }
    }
    if (!dryRun && options.persistConfig && config.startWithWindows !== state.configBody.startWithWindows) {
      try {
        await options.persistConfig(config);
      } catch (error) {
        return { status: 'failed', phase: 'config', state, os: false, error: error.message, code: error.code ?? 'service_unavailable' };
      }
    }
    state.configBody = config;
    state.installed = installed ?? null;
  }
  if (dryRun) return { status: 'planned', phase: null, state, os: false, viewerUrl: null };
  if (!state.start) {
    if (!options.start) return { status: 'failed', phase: 'start', state, os: false, error: 'No service starter was provided.' };
    try {
      const started = await options.start(state.configBody);
      if (!started?.viewerUrl) throw new CoreError(503, 'service_unavailable', 'The viewer is not ready.');
      state.start = true;
      state.viewerUrl = started?.viewerUrl ?? null;
    } catch (error) {
      return { status: 'failed', phase: 'start', state, os: false, error: error.message, code: error.code ?? 'service_unavailable',
        port: Number.isInteger(error.port) && error.port > 0 && error.port <= 65535 ? error.port : null, viewerUrl: null };
    }
  }
  return { status: 'started', phase: null, state, os: false, viewerUrl: state.viewerUrl ?? null };
}

export async function configureOwnedService(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDir ?? options.home;
  const cosmic = options.cosmicPath
    ? path.resolve(options.cosmicPath)
    : localCosmic({ platform, env, home });
  const mindPath = path.resolve(options.mindPath);
  const machine = options.hostname ?? options.machine;
  await requireLegacyClosure(mindPath, { machine, control: options.legacyControl });
  const mindKey = mindKeyFor(mindPath, platform);
  const localDirectory = path.join(cosmic, 'hivem1nd-service', mindKey, machine);
  const configFile = path.join(localDirectory, 'config.json');
  const ownershipFile = path.join(localDirectory, 'registration.json');
  let existing = null;
  await assertNoLinks(configFile);
  await assertNoLinks(ownershipFile);
  try {
    existing = JSON.parse(await readFile(configFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const stagingPath = path.join(localDirectory, 'staging');
  if (!existing && options.requireOrigin === true && !options.originPath) fail(422, 'invalid_body', 'An existing mind needs an explicit origin folder before service setup.');
  const origin = existing?.origin ?? {
    kind: options.originKind ?? 'folder',
    path: options.originPath ?? path.join(cosmic, 'hivem1nd-origin', mindKey),
  };
  const config = bootstrapConfig({ mindPath, machine, origin, stagingPath,
    startWithWindows: Object.hasOwn(options, 'startWithWindows') ? options.startWithWindows : existing?.startWithWindows ?? false,
    syncedRoots: options.syncedRoots ?? oneDriveRoots({ platform, env }) });
  const registration = {
    platform,
    nodePath: options.nodePath ?? process.execPath,
    cliPath: options.cliPath ?? path.join(options.kitPath ?? process.cwd(), 'cli', 'index.mjs'),
    mindPath,
    workingDirectory: options.workingDirectory ?? options.kitPath ?? process.cwd(),
    localDirectory,
    home,
    configHome: options.configHome ?? (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : home ? path.join(home, '.config') : undefined),
    sid: options.sid ?? (platform === 'win32' && options.dryRun === false ? aclRunnerFrom(options).userSid() : 'S-1-5-21-0'),
    uid: options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0),
    userManager: options.userManager,
  };
  let current = options.current ?? null;
  if (!current) {
    try {
      current = JSON.parse(await readFile(ownershipFile, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (current?.name) {
    if (platform === 'win32') registration.name = current.name;
    else if (platform === 'darwin') registration.label = current.name;
    else if (platform === 'linux') registration.unitName = current.name;
  }
  let resumedState = options.state;
  if (options.resumeSetup && existing) {
    if (JSON.stringify(bootstrapConfig(existing)) !== JSON.stringify(config)) fail(409, 'checkpoint_changed', 'The saved service configuration changed.');
    resumedState = { config: true, configBody: config, registration: true, installed: current, start: false };
  } else if (!resumedState && existing) {
    const prior = bootstrapConfig(existing);
    if (prior.mindPath !== mindPath || prior.machine !== machine || prior.stagingPath !== stagingPath) fail(409, 'service_mind_conflict', 'The saved service configuration does not match this installation.');
    resumedState = { config: true, configBody: prior, registration: true, installed: current, start: false };
  }
  let writtenOwnershipFile = null;
  const persistRegistration = async (installed) => {
    await mkdir(localDirectory, { recursive: true });
    const temporary = `${ownershipFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(ownershipRecord(installed), null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, ownershipFile);
    if (options.protect !== false) await protectLocalFile(ownershipFile, { aclRunner: options.aclRunner, store: options.store });
    writtenOwnershipFile = ownershipFile;
  };
  const result = await runServicePhases({
    config,
    registration,
  }, {
    dryRun: options.dryRun !== false,
    state: resumedState,
    current,
    configureStartup: Object.hasOwn(options, 'startWithWindows'),
    previousStartWithWindows: existing?.startWithWindows ?? false,
    run: options.run ?? options.serviceRunner,
    start: options.configureOnly ? null : options.start ?? options.serviceStart,
    query: options.query ?? options.serviceQuery ?? ((plan) => queryRegistration(plan, { current })),
    aclRunner: options.aclRunner,
    persistRegistration,
    persistPendingRegistration: persistRegistration,
    removeRegistration: () => removeOwnedRegistration({ ...options, hostname: machine, cosmicPath: cosmic,
      dryRun: false, preserveRuntime: true, run: options.run ?? options.serviceRunner,
      query: options.query ?? options.serviceQuery }),
    persistConfig: async (body) => {
      await assertLocalStaging(body.stagingPath, { platform, origin: body.origin.path, syncedRoots: options.syncedRoots ?? [], env });
      await mkdir(localDirectory, { recursive: true });
      const temporary = `${configFile}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
        if (options.protect !== false) await protectBootstrapFiles(localDirectory, temporary, { aclRunner: options.aclRunner, store: options.store });
        await rename(temporary, configFile);
      } finally {
        await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
      }
    },
  });
  if (options.configureOnly && result.phase === 'start' && result.state.config && result.state.registration) {
    result.status = 'configured';
    result.phase = null;
    delete result.error;
  }
  if (writtenOwnershipFile) result.ownershipFile = writtenOwnershipFile;
  result.configFile = configFile;
  result.localDirectory = localDirectory;
  return result;
}

export async function removeOwnedRegistration(options = {}) {
  const platform = options.platform ?? process.platform;
  const cosmic = options.cosmicPath
    ? path.resolve(options.cosmicPath)
    : localCosmic({ platform, env: options.env ?? {}, home: options.homeDir });
  const mindKey = mindKeyFor(path.resolve(options.mindPath), platform);
  const localDirectory = path.join(cosmic, 'hivem1nd-service', mindKey, options.hostname);
  const ownershipFile = path.join(localDirectory, 'registration.json');
  await assertNoLinks(ownershipFile);
  let current = null;
  try {
    current = JSON.parse(await readFile(ownershipFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { commands: [], removed: false };
    throw error;
  }
  const actualDigest = createHash('sha256').update(current.body ?? '').digest('hex');
  if (!current.body || actualDigest !== current.digest) {
    return { commands: [], removed: false, kept: { path: ownershipFile, reason: 'The login registration was modified and was left in place.' } };
  }
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : current.uid);
  if (platform === 'darwin' && (!Number.isInteger(uid) || current.uid !== undefined && current.uid !== uid)) {
    return { commands: [], removed: false, kept: { path: ownershipFile, reason: 'The login registration belongs to another user and was left in place.' } };
  }
  const query = options.query ?? (!options.dryRun && options.run ? (plan) => queryRegistration({ ...plan, platform, file: plan.path }, { current }) : null);
  if (query) {
    const actual = await query(current);
    const same = actual?.executable === current.executable
      && JSON.stringify(actual?.arguments ?? []) === JSON.stringify(current.arguments ?? [])
      && actual?.digest === (current.actualDigest ?? current.digest)
      && (!current.installationId || actual?.installationId === current.installationId);
    if (!same) {
      return { commands: [], removed: false, kept: { path: ownershipFile, reason: 'The operating system registration does not match and was left in place.' } };
    }
  }
  const command = platform === 'win32'
    ? `schtasks.exe /Delete /TN ${quoteWindows(current.name)} /F`
    : platform === 'darwin'
      ? options.preserveRuntime ? `launchctl disable gui/${uid}/${current.name}` : `launchctl bootout gui/${uid} ${current.path}`
      : `systemctl --user disable ${options.preserveRuntime ? '' : '--now '}${current.name}`;
  const argv = platform === 'win32'
    ? ['schtasks.exe', '/Delete', '/TN', current.name, '/F']
    : platform === 'darwin'
      ? options.preserveRuntime ? ['launchctl', 'disable', `gui/${uid}/${current.name}`] : ['launchctl', 'bootout', `gui/${uid}`, current.path]
      : ['systemctl', '--user', 'disable', ...(options.preserveRuntime ? [] : ['--now']), current.name];
  if (!options.dryRun && options.run) {
    await options.run(argv);
    if (platform !== 'win32' && options.preserveRuntime) return { commands: [command], argv, removed: true, removedPaths: [] };
    const removedPaths = [];
    await assertNoLinks(current.path);
    const bytes = await readFile(current.path).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
    const body = bytes && (platform === 'win32' ? bytes.toString('utf16le').replace(/^\uFEFF/, '') : bytes.toString('utf8'));
    if (body !== null && createHash('sha256').update(body).digest('hex') === current.digest) {
      await unlink(current.path);
      removedPaths.push(current.path);
      if (platform === 'linux') await options.run(['systemctl', '--user', 'daemon-reload']);
    }
    await unlink(ownershipFile);
    removedPaths.push(ownershipFile);
    return { commands: [command], argv, removed: true, removedPath: ownershipFile, removedPaths };
  }
  return { commands: [command], removed: false, described: true };
}
