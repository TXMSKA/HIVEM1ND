import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const QUANTUM_COMMIT = 'f999f553ca3f5f205231e317872f8add7108f75c';
const source = 'C:/Users/ttasc/Web/Quantum/.claude/worktrees/login-join';
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const temporary = path.join(workspace, '.tmp');
const vectorBlob = '48e19a657da657322ffeb88ace52fc222545cdbc';

function owned(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe disposable test path');
  return target;
}

function essentials() {
  return Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'ComSpec', 'PATHEXT']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
}

export async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function assertPortReleased(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

async function waitForExit(child, timeout = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(timeout)]);
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await waitForExit(child);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await waitForExit(child, 5000); }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Owned test child did not stop');
}

async function run(command, args, { cwd, env = essentials(), timeout = 120_000 } = {}) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', bytes => { if (output.length < 16_384) output += bytes; });
  child.stderr.on('data', bytes => { if (output.length < 16_384) output += bytes; });
  let timer;
  try {
    const code = await Promise.race([
      new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned helper timed out')), timeout); }),
    ]);
    if (code !== 0) {
      const error = new Error(`Disposable command failed (${path.basename(command)}, exit ${code})`);
      error.command = [command, ...args].join(' ');
      error.output = output;
      throw error;
    }
    return output.trim();
  } finally { clearTimeout(timer); await stop(child); }
}

async function verifyVectors(app) {
  const vectors = await readFile(path.join(app, 'docs/keys-vectors.json'));
  assert.equal(createHash('sha1').update(`blob ${vectors.length}\0`).update(vectors).digest('hex'), vectorBlob);
  assert.ok(vectors.equals(await readFile(path.join(workspace, 'test/fixtures/cosmic-keys-vectors.json'))), 'Pinned vectors must match byte for byte');
}

async function prepare(root) {
  const app = owned(root, path.join(root, 'app'));
  await mkdir(app, { recursive: true });
  const git = ['-c', `safe.directory=${source}`, '-C', source];
  assert.equal(await run('git', [...git, 'rev-parse', QUANTUM_COMMIT]), QUANTUM_COMMIT);
  await run('git', [...git, 'archive', '--format=tar', `--output=${path.join(root, 'quantum.tar')}`, QUANTUM_COMMIT]);
  await run('tar', ['-xf', path.join(root, 'quantum.tar'), '-C', app]);
  await verifyVectors(app);
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await access(npm);
  // Dependency preparation uses the person's existing npm and Node trust settings. Only the server is allow-listed.
  await run(process.execPath, [npm, 'install', '--no-audit', '--no-fund'], { cwd: app, env: process.env, timeout: 300_000 });
  await run(process.execPath, [npm, 'run', 'build'], { cwd: app, env: process.env });
  await writeFile(path.join(root, 'prepared.json'), JSON.stringify({ revision: QUANTUM_COMMIT,
    archive: createHash('sha256').update(await readFile(path.join(root, 'quantum.tar'))).digest('hex') }));
  return app;
}

/** Owns every file and child. A prepared root is only for continuing this same install/build stage. */
export async function startLocalQuantum({ preparedRoot, resumePreparation = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Local Quantum requires Node 24 or newer');
  await mkdir(temporary, { recursive: true });
  const root = preparedRoot ? await realpath(preparedRoot) : await mkdtemp(path.join(temporary, 'signin-e2e-'));
  owned(temporary, root);
  if (!path.basename(root).startsWith('signin-e2e-')) throw new Error('Expected an owned sign-in test directory');
  let api, database, connection, pool, mysqlPort, port, closed = false;
  const evidence = { revision: QUANTUM_COMMIT, stage: 'preparation', mysql: null, api: null, migrations: null, callbacks: [] };
  const sessionRoots = [];
  const close = async ({ preservePrepared = false } = {}) => {
    if (closed) return;
    closed = true;
    const errors = [];
    try { await stop(api); if (evidence.api) evidence.api.exited = api.exitCode !== null || api.signalCode !== null; } catch (error) { errors.push(error); }
    try { await pool?.end(); } catch (error) { errors.push(error); }
    if (connection) {
      try { await connection.query('SHUTDOWN'); } catch { /* SQL shutdown can close its own socket. */ }
      try { await connection.end(); } catch { /* Server may already have closed it. */ }
    }
    try {
      if (database) { await waitForExit(database); await stop(database); if (evidence.mysql) evidence.mysql.exited = database.exitCode !== null || database.signalCode !== null; }
    } catch (error) { errors.push(error); }
    for (const used of [port, mysqlPort, ...sessionRoots].filter(Boolean)) {
      try { await assertPortReleased(used); } catch (error) { errors.push(error); }
    }
    if (!errors.length) {
      if (evidence.mysql) evidence.mysql.portReleased = true;
      if (evidence.api) evidence.api.portReleased = true;
      evidence.callbacks = sessionRoots.map(value => ({ port: value, released: true }));
    }
    if (!errors.length) {
      if (preservePrepared) {
        // A failing assertion must not require another dependency install. Private runtime data is still removed.
        for (const entry of await readdir(root)) if (!['app', 'quantum.tar', 'prepared.json'].includes(entry)) {
          await rm(owned(root, path.join(root, entry)), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        }
      } else await rm(owned(temporary, root), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
    if (errors.length) throw new AggregateError(errors, 'Disposable Quantum cleanup failed');
  };
  try {
    const app = preparedRoot && !resumePreparation ? owned(root, path.join(root, 'app')) : await prepare(root);
    if (preparedRoot) {
      const prepared = JSON.parse(await readFile(path.join(root, 'prepared.json'), 'utf8'));
      assert.equal(prepared.revision, QUANTUM_COMMIT);
      assert.equal(prepared.archive, createHash('sha256').update(await readFile(path.join(root, 'quantum.tar'))).digest('hex'));
      await access(path.join(app, 'dist/node.mjs'));
    }
    await verifyVectors(app);
    evidence.stage = 'mysql-initialization';
    for (const migration of ['0034_key_approver.sql', '0035_key_approval_receipt.sql', '0036_oauth_key_handoff.sql']) await access(path.join(app, 'drizzle/mysql', migration));
    const require = createRequire(path.join(app, 'package.json'));
    const mysql = require('mysql2/promise');
    const { drizzle } = require('drizzle-orm/mysql2');
    const { migrate } = require('drizzle-orm/mysql2/migrator');
    const { build, stop: stopBuild } = require('esbuild');
    const imported = relative => import(pathToFileURL(path.join(app, relative)).href);
    const mysqld = process.env.MYSQLD_PATH || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqld.exe';
    await access(mysqld);
    const basedir = path.dirname(path.dirname(mysqld));
    const data = owned(root, path.join(root, 'database'));
    await run(mysqld, ['--no-defaults', '--initialize-insecure', `--basedir=${basedir}`, `--datadir=${data}`], { timeout: 300_000 });
    mysqlPort = await freePort();
    database = spawn(mysqld, ['--no-defaults', `--basedir=${basedir}`, `--datadir=${data}`, '--bind-address=127.0.0.1', `--port=${mysqlPort}`,
      '--sql-mode=STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
      '--skip-named-pipe', '--shared-memory=0', '--mysqlx=0', `--pid-file=${path.join(root, 'mysqld.pid')}`, `--socket=${path.join(root, 'mysql.sock')}`],
    { env: essentials(), windowsHide: true, shell: false, stdio: 'ignore' });
    evidence.mysql = { pid: database.pid ?? null, port: mysqlPort, exited: false, portReleased: false };
    let databaseError;
    database.on('error', error => { databaseError = error; });
    const deadline = Date.now() + 180_000;
    while (!connection && Date.now() < deadline) {
      if (databaseError) throw databaseError;
      if (database.exitCode !== null) throw new Error(`Disposable MySQL exited ${database.exitCode} before readiness`);
      try { connection = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user: 'root', password: '', connectTimeout: 1000 }); }
      catch { await delay(100); }
    }
    if (!connection) throw new Error('Disposable MySQL did not become ready');
    await connection.query('SELECT 1');
    const schema = `signin_${randomBytes(12).toString('hex')}`;
    await connection.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    const databaseUrl = `mysql://root@127.0.0.1:${mysqlPort}/${schema}`;
    pool = mysql.createPool({ uri: databaseUrl, timezone: 'Z' });
    evidence.stage = 'mysql-migrations';
    await migrate(drizzle(pool), { migrationsFolder: path.join(app, 'drizzle/mysql') });
    const [migrationRows] = await pool.query('SELECT COUNT(*) AS total FROM __drizzle_migrations');
    evidence.migrations = { applied: Number(migrationRows[0].total), lastRequired: '0036_oauth_key_handoff' };
    const [{ createMySqlStore }, { runPlanCommand }, { csrfHeadersFromCookie }, { hashSecret }] = await Promise.all([
      imported('src/store/mysql.ts'), imported('src/plans/commands.ts'), imported('src/identity/csrf.ts'), imported('src/identity/crypto.ts'),
    ]);
    const store = createMySqlStore(pool);
    await runPlanCommand(store, ['seed'], Date.now());
    const cryptoFile = path.join(root, 'site-crypto.mjs');
    evidence.stage = 'site-crypto-bundle';
    try {
      await build({ stdin: { contents: "export * from './site/src/accountKey.ts'; export * from './site/src/recovery.ts'; export * from './site/src/approval.ts'; export * from './site/src/appKeyHandoff.ts';", resolveDir: app },
        outfile: cryptoFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    } finally { stopBuild(); }
    const siteCrypto = await import(pathToFileURL(cryptoFile).href);
    port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const storage = owned(root, path.join(root, 'storage'));
    await mkdir(storage);
    const emails = ['password', 'legacy', 'terminal', 'pending', 'handoff'].map(name => `${name}-${randomBytes(6).toString('hex')}@signin.example.test`);
    const hashSecretValue = randomBytes(32).toString('base64url');
    const env = { ...essentials(), NODE_ENV: 'development', BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'), HASH_SECRET: hashSecretValue,
      PORT: String(port), PUBLIC_URL: base, SITE_ORIGIN: base, DATABASE_URL: databaseUrl, STORAGE_DIR: storage, MAIL_MODE: 'capture',
      DEV_MAIL_LOG: path.join(root, 'private-mail.log'), INVITED_EMAILS: emails.join(','), LOG_LEVEL: 'error',
      // One proxy hop lets each site jar present its own documentation address, so the per-address code budget
      // (five per ten minutes) applies per simulated browser instead of to every loopback request together.
      TRUSTED_PROXY_HOPS: '1' };
    const guard = path.join(root, 'loopback-only.mjs');
    await writeFile(guard, `const original = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External fetch blocked by disposable test');
  return original(input, init);
};\n`);
    api = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'dist/node.mjs'], { cwd: app, env, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    evidence.stage = 'api-startup';
    evidence.api = { pid: api.pid ?? null, port, exited: false, portReleased: false };
    let apiError;
    api.on('error', error => { apiError = error; });
    // Both streams can contain development credentials. Neither is forwarded to test output.
    api.stderr.on('data', () => {});
    let ready = false;
    for (let attempt = 0; attempt < 600 && !ready; attempt += 1) {
      if (apiError) throw apiError;
      if (api.exitCode !== null) throw new Error(`Disposable Quantum exited ${api.exitCode} before readiness`);
      try { const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); ready = response.status === 200; await response.body?.cancel(); }
      catch { /* The owned child is still opening its port. */ }
      if (!ready) await delay(100);
    }
    if (!ready) throw new Error('Disposable Quantum did not become ready');
    const offsets = new Map();
    let browsers = 0;
    const client = () => {
      const jar = new Map(), address = `198.51.100.${(browsers += 1) % 250 + 1}`;
      const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
      return { async request(route, body, options = {}) {
        if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Expected a local Quantum path');
        const method = options.method ?? (body === undefined ? 'GET' : 'POST');
        const headers = new Headers({ Origin: base, Cookie: cookie(), 'X-Forwarded-For': address, ...(!['GET', 'HEAD'].includes(method) ? await csrfHeadersFromCookie(cookie(), hashSecretValue) : {}) });
        new Headers(options.headers).forEach((value, key) => headers.set(key, value));
        if (body !== undefined) headers.set('Content-Type', 'application/json');
        const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...options, method, headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(';')[0], at = pair.indexOf('=');
          if (/Max-Age=0(?:;|$)/i.test(value)) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
        }
        return response;
      } };
    };
    const register = async (email, consent = true) => {
      const browser = client();
      assert.equal((await browser.request('/v1/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status, 200);
      const end = Date.now() + 10_000;
      let otp;
      while (!otp && Date.now() < end) {
        const mail = await readFile(env.DEV_MAIL_LOG, 'utf8').catch(() => '');
        otp = mail.slice(offsets.get(email) ?? 0).split('[development mail]').findLast(entry => entry.includes(` para ${email}\n`) || entry.includes(` para ${email}\r\n`))?.match(/\b\d{6}\b/)?.[0];
        if (otp) offsets.set(email, mail.length); else await delay(25);
      }
      if (!otp) throw new Error('Private captured mail did not arrive');
      assert.equal((await browser.request('/v1/auth/sign-in/email-otp', { email, otp })).status, 200);
      const bootstrap = await browser.request('/v1/bootstrap');
      assert.equal(bootstrap.status, 200);
      const snapshot = await bootstrap.json();
      const missing = snapshot.legal.missing;
      if (consent) for (const policy of missing) assert.equal((await browser.request('/v1/legal/acceptances', { policy: policy.id, version: policy.version })).status, 200);
      return { browser, accountId: snapshot.accountId, missing, email };
    };
    evidence.stage = 'scenarios';
    return { root, app, base, store, siteCrypto, emails, register, client, evidence, hashSecret: value => hashSecret(value, hashSecretValue),
      grant: email => runPlanCommand(store, ['grant', '--email', email, '--plan', 'cosmic:insider'], Date.now()),
      trackCallback: value => sessionRoots.push(Number(new URL(value).port)), close };
  } catch (error) {
    error.preparedRoot = root;
    error.evidence = evidence;
    try { await close({ preservePrepared: true }); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Disposable setup and cleanup failed'); }
    throw error;
  }
}
