import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './identity.mjs';
import { localCosmic, mindKeyFor, oneDriveRoots } from './paths.mjs';
import { protectLocalFile } from './security.mjs';

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
  const tail = String(sid ?? '').split('-').filter(Boolean).pop() || 'user';
  return `HIVEM1ND-${tail}`;
}

function planWindows(input) {
  const sid = input.sid ?? 'S-1-5-21-0';
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
  const port = handle?.http?.port;
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
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ embedded: false, look: 'light', language: 'en' }),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.url ?? null;
}

export async function installService(input, options = {}) {
  const plan = planRegistration(input);
  const dryRun = options.dryRun !== false;
  if (dryRun) return { ...plan, executed: [], dryRun: true, os: false, action: 'plan' };
  const actual = options.query ? await options.query(plan) : null;
  if (actual?.present) {
    const ownedId = options.current?.installationId && actual.installationId === options.current.installationId;
    if (sameActual(actual, plan) && (!options.current?.installationId || ownedId)) {
      return { ...plan, executed: [], dryRun: false, os: false, action: 'unchanged' };
    }
    if (!ownedId) {
      return { ...plan, commands: [], executed: [], dryRun: false, os: false, action: 'conflict', conflict: true, reason: 'The login registration is not owned by this install.' };
    }
  } else if (!options.query && options.current) {
    const verdict = verifyOwnedRegistration(options.current, plan);
    if (verdict.owned) return { ...plan, executed: [], dryRun: false, os: false, action: 'unchanged' };
    return { ...plan, commands: [], executed: [], dryRun: false, os: false, action: 'conflict', conflict: true, reason: verdict.reason };
  }
  await mkdir(path.dirname(plan.file), { recursive: true });
  await writeFile(plan.file, Buffer.from(`\uFEFF${plan.body}`, 'utf16le'));
  if (options.aclRunner) await options.aclRunner.protect(plan.file);
  const action = actual?.present ? 'update' : 'create';
  const argv = plan.platform === 'win32'
    ? ['schtasks.exe', '/Create', '/XML', plan.file, '/TN', plan.name, ...(action === 'update' ? ['/F'] : [])]
    : plan.argv ?? plan.arguments;
  if (options.run) await options.run(argv);
  else throw new CoreError(503, 'service_unavailable', 'No registration runner was provided.');
  return { ...plan, executed: [argv], dryRun: false, os: true, action, installationId: options.current?.installationId ?? randomUUID() };
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

function sameActual(actual, plan) {
  if (!actual?.present) return false;
  return actual.executable === plan.executable
    && JSON.stringify(actual.arguments ?? []) === JSON.stringify(plan.arguments)
    && actual.digest === plan.digest;
}

export function bootstrapConfig(config) {
  if (!config || typeof config !== 'object') fail(422, 'invalid_body', 'Config is required.');
  if (config.encryption || config.preset === 'quantum' || config.quantum || config.algorithm) {
    fail(422, 'unsupported_origin', 'Unsupported encryption is refused.');
  }
  if (!config.mindPath || !config.stagingPath) fail(422, 'invalid_body', 'Config needs a mind and a staging path.');
  if (!config.machine) fail(422, 'invalid_body', 'Config needs a machine.');
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
  };
}

export async function runServicePhases(input, options = {}) {
  const dryRun = options.dryRun !== false;
  const state = { config: false, registration: false, start: false, ...(options.state ?? {}) };
  if (!state.config) {
    let config;
    try {
      config = bootstrapConfig(input.config);
    } catch (error) {
      return { status: 'failed', phase: 'config', state, os: false, error: error.message, code: error.code ?? 'invalid_body' };
    }
    if (!dryRun && options.persistConfig) {
      try {
        await options.persistConfig(config);
      } catch (error) {
        return { status: 'failed', phase: 'config', state, os: false, error: error.message };
      }
    }
    state.config = true;
    state.configBody = config;
  }
  if (!state.registration) {
    const installed = await installService(input.registration, {
      dryRun,
      run: options.run,
      current: options.current ?? null,
    });
    if (installed.conflict) {
      return { status: 'failed', phase: 'registration', state, os: false, conflict: installed.reason };
    }
    state.registration = true;
    state.installed = installed;
  }
  if (dryRun) return { status: 'planned', phase: null, state, os: false, viewerUrl: null };
  if (!state.start) {
    if (!options.start) return { status: 'failed', phase: 'start', state, os: false, error: 'No service starter was provided.' };
    try {
      const started = await options.start(state.configBody);
      state.start = true;
      state.viewerUrl = started?.viewerUrl ?? null;
    } catch (error) {
      return { status: 'failed', phase: 'start', state, os: false, error: error.message, viewerUrl: null };
    }
  }
  return { status: 'started', phase: null, state, os: false, viewerUrl: state.viewerUrl ?? null };
}

export async function configureOwnedService(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? {};
  const home = options.homeDir ?? options.home;
  const cosmic = options.cosmicPath
    ? path.resolve(options.cosmicPath)
    : localCosmic({ platform, env, home });
  const mindPath = path.resolve(options.mindPath);
  const machine = options.hostname ?? options.machine;
  const mindKey = mindKeyFor(mindPath, platform);
  const localDirectory = path.join(cosmic, 'hivem1nd-service', mindKey, machine);
  const configFile = path.join(localDirectory, 'config.json');
  const ownershipFile = path.join(localDirectory, 'registration.json');
  let existing = null;
  try {
    existing = JSON.parse(await readFile(configFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const stagingPath = path.join(localDirectory, 'staging');
  const origin = existing?.origin ?? {
    kind: options.originKind ?? 'folder',
    path: options.originPath ?? path.join(cosmic, 'hivem1nd-origin', mindKey),
  };
  const registration = {
    platform,
    nodePath: options.nodePath ?? process.execPath,
    cliPath: options.cliPath ?? path.join(options.kitPath ?? process.cwd(), 'cli', 'index.mjs'),
    mindPath,
    workingDirectory: options.workingDirectory ?? options.kitPath ?? process.cwd(),
    localDirectory,
    home,
    configHome: options.configHome ?? (home ? path.join(home, '.config') : undefined),
    sid: options.sid ?? 'S-1-5-21-current',
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
  const result = await runServicePhases({
    config: {
      mindPath,
      machine,
      origin,
      stagingPath,
      syncedRoots: options.syncedRoots ?? oneDriveRoots({ platform, env }),
    },
    registration,
  }, {
    dryRun: options.dryRun !== false,
    state: options.state,
    current,
    run: options.run,
    start: options.start,
    persistConfig: async (body) => {
      await mkdir(localDirectory, { recursive: true });
      const temporary = `${configFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, configFile);
      if (options.protect !== false) await protectLocalFile(configFile, { aclRunner: options.aclRunner, store: options.store });
    },
  });
  if (result.state?.installed?.action === 'create' && options.dryRun === false) {
    await mkdir(localDirectory, { recursive: true });
    const record = ownershipRecord(result.state.installed);
    await writeFile(ownershipFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    result.ownershipFile = ownershipFile;
  }
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
  if (options.query) {
    const actual = await options.query(current);
    const same = actual?.executable === current.executable
      && JSON.stringify(actual?.arguments ?? []) === JSON.stringify(current.arguments ?? [])
      && actual?.digest === current.digest
      && (!current.installationId || actual?.installationId === current.installationId);
    if (!same) {
      return { commands: [], removed: false, kept: { path: ownershipFile, reason: 'The operating system registration does not match and was left in place.' } };
    }
  }
  const command = platform === 'win32'
    ? `schtasks.exe /Delete /TN ${quoteWindows(current.name)} /F`
    : platform === 'darwin'
      ? `launchctl bootout gui/${options.uid ?? 501} ${current.path}`
      : `systemctl --user disable --now ${current.name}`;
  const argv = platform === 'win32'
    ? ['schtasks.exe', '/Delete', '/TN', current.name, '/F']
    : [command];
  if (!options.dryRun && options.run) {
    await options.run(argv);
    await unlink(ownershipFile);
    return { commands: [command], argv, removed: true, removedPath: ownershipFile };
  }
  return { commands: [command], removed: false, described: true };
}
