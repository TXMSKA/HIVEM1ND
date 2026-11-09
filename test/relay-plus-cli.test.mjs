import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { Readable } from 'node:stream';
import { helpText, parseArgs, runCli } from '../cli/index.mjs';
import { attachInput, readSecret, renderAccountCommand, runSignInTerminal } from '../engine/relay-plus/terminal.mjs';

const BOARD_ID = '0e1a1d00-5c05-4a11-9e7a-20261108a001';
const BOARD_PATH = 'C:/Users/ttasc/OneDrive/M1ND/.blueprint/ONEM1ND/blueprint/0e1a1d00-5c05-4a11-9e7a-20261108a001.json';
const NOW = 1_700_000_000_000;
const AUTHORIZATION_URL = 'https://cosmic.txmska.com/authorize/?appId=hivem1nd&...';
const EMAIL = 'alex@example.com';
const CODE = '4829 1173';
const SECRET = 'hidden-secret-value';

function terminalValue(node) {
  if (!node) return null;
  if (node.name === 'Terminal output' && typeof node.value === 'string') return node.value;
  for (const child of node.kids ?? []) {
    const found = terminalValue(child);
    if (found) return found;
  }
  return null;
}

function loadFrames() {
  if (existsSync(BOARD_PATH)) {
    const board = JSON.parse(readFileSync(BOARD_PATH, 'utf8'));
    assert.equal(board.id, BOARD_ID);
    return board.screens.map((screen) => ({ title: screen.title, lang: screen.lang, output: terminalValue(screen.root) }));
  }
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/sign-in-board-output.json', import.meta.url), 'utf8'));
  assert.equal(fixture.boardId, BOARD_ID);
  assert.ok(fixture.frames?.length, 'sign-in board fixture has no frames');
  return fixture.frames;
}

const frames = loadFrames();
const compared = new Set();

function appOutput(title) {
  const frame = frames.find((item) => item.title === title);
  assert.ok(frame, title);
  compared.add(title);
  const lines = frame.output.split('\n');
  if (/^PS .+> /.test(lines[0] ?? '')) lines.shift();
  if (/^PS .+> ?$/.test(lines.at(-1) ?? '')) lines.pop();
  return lines.join('\n');
}

function capture() {
  let text = '';
  return { write(value) { text += value; }, read: () => text, isTTY: true };
}

function scripted(chunks, { end = true } = {}) {
  const listeners = { data: new Set(), end: new Set() };
  const modes = [];
  const queued = [...chunks];
  let ended = false;
  const input = {
    isTTY: true,
    modes,
    setRawMode(value) { modes.push(value); },
    on(event, fn) {
      listeners[event].add(fn);
      if (event === 'data') while (queued.length) fn(queued.shift());
      if (event === 'end' && ended) fn();
    },
    off(event, fn) { listeners[event]?.delete(fn); },
    write(chunk) { for (const fn of listeners.data) fn(chunk); },
    end() { ended = true; for (const fn of listeners.end) fn(); },
    resume() {},
  };
  if (end) ended = true;
  return input;
}

function sink() { let text = ''; return { write(value) { text += value; }, read: () => text }; }

const pages = {
  en: { acceptance: 'http://127.0.0.1:9/', recovery: 'http://127.0.0.1:9/security/' },
  es: { acceptance: 'http://127.0.0.1:9/es/', recovery: 'http://127.0.0.1:9/es/security/' },
};

function signed(methods, language = 'en') {
  return {
    state: 'key-required',
    account: { email: EMAIL },
    methods,
    pages,
    expiresAt: NOW + 300_000,
  };
}

async function runSign(language, methods, chunks, call, { end = true, signal, until } = {}) {
  const output = capture();
  const opened = [];
  const input = scripted(chunks, { end });
  const controller = signal ? null : new AbortController();
  const timeout = AbortSignal.timeout(3000);
  const run = runSignInTerminal({
    language, input, output, signal: signal ? AbortSignal.any([signal, timeout]) : AbortSignal.any([controller.signal, timeout]),
    now: () => NOW, pause: async () => {},
    open: async (url) => { opened.push(url); },
    call: async (action, fields) => call(action, fields, opened),
  });
  if (until) {
    for (let attempt = 0; attempt < 40 && output.read() !== until; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controller.abort();
  }
  await run;
  return { output: output.read(), opened, modes: input.modes };
}

test('terminal frames match the board', async () => {
  const passwordOnly = { password: true, phrase: false, approval: true };
  const withPhrase = { password: true, phrase: true, approval: true };
  const legacy = { password: false, phrase: true, approval: true };
  const cases = [
    ['Signed in, key already here', 'en', null, [], (action) => (action === 'sign-in' ? { state: 'ready', account: { email: EMAIL } } : {})],
    ['Signed in, key already here (ES)', 'es', null, [], (action) => (action === 'sign-in' ? { state: 'ready', account: { email: EMAIL } } : {})],
    ['Password only, no phrase, no Vault', 'en', passwordOnly, [], () => signed(passwordOnly)],
    ['Password only, no phrase, no Vault (ES)', 'es', passwordOnly, [], () => signed(passwordOnly)],
    ["Every way, Vault found", 'en', null, [], () => signed({ password: true, vault: true, phrase: true, approval: true })],
    ["Every way, Vault found (ES)", 'es', null, [], () => signed({ password: true, vault: true, phrase: true, approval: true })],
    ['Older account, no password yet', 'en', legacy, [], () => signed(legacy)],
    ['Older account, no password yet (ES)', 'es', legacy, [], () => signed(legacy)],
    ['Typing the password', 'en', passwordOnly, ['1\n'], () => signed(passwordOnly), { end: false }],
    ['Typing the password (ES)', 'es', passwordOnly, ['1\n'], () => signed(passwordOnly), { end: false }],
    ['Password did not open it', 'en', passwordOnly, [`1\n${SECRET}\n`], (action) => {
      if (action === 'unlock') { const error = new Error('wrong'); error.code = 'key_authentication_failed'; throw error; }
      return signed(passwordOnly);
    }, { end: false }],
    ['Password did not open it (ES)', 'es', passwordOnly, [`1\n${SECRET}\n`], (action) => {
      if (action === 'unlock') { const error = new Error('wrong'); error.code = 'key_authentication_failed'; throw error; }
      return signed(passwordOnly);
    }, { end: false }],
    ['Data open', 'en', passwordOnly, [`1\n${SECRET}\n`], (action) => action === 'unlock' ? { state: 'ready' } : signed(passwordOnly)],
    ['Data open (ES)', 'es', passwordOnly, [`1\n${SECRET}\n`], (action) => action === 'unlock' ? { state: 'ready' } : signed(passwordOnly)],
    ['Recovery phrase', 'en', withPhrase, ['3\n'], () => signed(withPhrase), { end: false }],
    ['Recovery phrase (ES)', 'es', withPhrase, ['3\n'], () => signed(withPhrase), { end: false }],
    ['Phrase did not open it', 'en', withPhrase, [`3\n${SECRET}\n`], (action) => {
      if (action === 'recover') { const error = new Error('wrong'); error.code = 'invalid_recovery_phrase'; throw error; }
      return signed(withPhrase);
    }, { end: false }],
    ['Phrase did not open it (ES)', 'es', withPhrase, [`3\n${SECRET}\n`], (action) => {
      if (action === 'recover') { const error = new Error('wrong'); error.code = 'invalid_recovery_phrase'; throw error; }
      return signed(withPhrase);
    }, { end: false }],
  ];
  for (const [title, language, , chunks, call, extra] of cases) {
    const expected = appOutput(title);
    const result = await runSign(language, null, chunks, call, { end: extra?.end !== false, until: extra?.end === false ? expected : null });
    assert.equal(result.output, expected, title);
    assert.equal(result.output.includes(SECRET), false, title);
  }
});

test('approval, forgot password, cancellation and account frames match the board', async () => {
  const methods = { password: true, phrase: true, approval: true };
  const base = () => signed(methods);
  async function once(title, language, chunks, call, { end = true } = {}) {
    const controller = new AbortController();
    const result = await runSign(language, methods, chunks, (action, fields) => {
      if (action === 'sign-in') return base();
      return call(action, fields, controller);
    }, { end, signal: controller.signal });
    return result;
  }
  for (const [title, language] of [['Waiting for the other computer', 'en'], ['Waiting for the other computer (ES)', 'es']]) {
    const controller = new AbortController();
    const pending = runSign(language, methods, ['2\n'], (action) => {
      if (action === 'sign-in') return base();
      if (action === 'request-approval') return { state: 'approval-pending', outcome: 'pending', expiresAt: NOW + 300_000 };
      controller.abort();
      return { state: 'approval-pending', outcome: 'pending', expiresAt: NOW + 300_000 };
    }, { end: true, signal: controller.signal });
    const result = await pending;
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['The code', 'en'], ['The code (ES)', 'es']]) {
    const controller = new AbortController();
    const result = await runSign(language, methods, ['2\n'], (action) => {
      if (action === 'sign-in') return base();
      if (action === 'request-approval') return { state: 'approval-code', code: CODE, outcome: 'revealed', expiresAt: NOW + 300_000 };
      controller.abort();
      return { state: 'approval-code', code: CODE, outcome: 'revealed' };
    }, { signal: controller.signal });
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['Approved', 'en'], ['Approved (ES)', 'es']]) {
    const result = await once(title, language, ['2\n'], (action) => action === 'request-approval'
      ? { state: 'ready', stored: true, code: CODE } : base());
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['Rejected there', 'en'], ['Rejected there (ES)', 'es']]) {
    const result = await once(title, language, ['2\n'], (action) => action === 'request-approval'
      ? { state: 'approval-ended', outcome: 'rejected', code: CODE } : base(), { end: true });
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['Expired', 'en'], ['Expired (ES)', 'es']]) {
    const result = await once(title, language, ['2\n'], (action) => action === 'request-approval'
      ? { state: 'approval-ended', outcome: 'expired' } : base());
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['Too many requests', 'en'], ['Too many requests (ES)', 'es']]) {
    const result = await once(title, language, ['2\n'], (action) => action === 'request-approval'
      ? { state: 'key-required', outcome: 'approval-limit', methods: { ...methods, approval: false } } : base());
    assert.equal(result.output, appOutput(title), title);
  }
  for (const [title, language] of [['Forgot password', 'en'], ['Forgot password (ES)', 'es']]) {
    const opened = [];
    const result = await runSign(language, methods, ['4\n'], (action) => {
      if (action === 'refresh-keys') return signed(methods);
      return signed(methods);
    });
    assert.equal(result.output, appOutput(title), title);
    assert.deepEqual(result.opened, [pages[language].recovery]);
    void opened;
  }
  for (const [title, language] of [['Nothing left to open it', 'en'], ['Nothing left to open it (ES)', 'es']]) {
    const result = await runSign(language, methods, ['\u0003'], () => signed(methods));
    assert.equal(result.output, appOutput(title), title);
  }
  const account = [
    ['Status: ready', 'en', { state: 'ready', account: { email: EMAIL }, lastSync: new Date(NOW - 120_000).toISOString() }],
    ['Status: ready (ES)', 'es', { state: 'ready', account: { email: EMAIL }, lastSync: new Date(NOW - 120_000).toISOString() }],
    ['Status: not signed in', 'en', { state: 'signed-out' }],
    ['Status: not signed in (ES)', 'es', { state: 'signed-out' }],
    ['Sign-in ended', 'en', { state: 'authentication-required', reason: 'device-revoked' }],
    ['Sign-in ended (ES)', 'es', { state: 'authentication-required', reason: 'session-expired' }],
    ['No connection', 'en', { state: 'offline' }],
    ['No connection (ES)', 'es', { state: 'offline' }],
  ];
  for (const [title, language, result] of account) {
    const output = capture();
    await renderAccountCommand({ language, action: 'status', result, output, now: () => NOW, call: async () => ({ resumed: true }) });
    assert.equal(output.read(), appOutput(title), title);
  }
  for (const [title, language] of [['Sign out', 'en'], ['Sign out (ES)', 'es']]) {
    const output = capture();
    await renderAccountCommand({ language, action: 'sign-out', result: { state: 'signed-out' }, output, now: () => NOW });
    assert.equal(output.read(), appOutput(title), title);
  }
  for (const [title, language] of [['Terms or Privacy to accept', 'en'], ['Terms or Privacy to accept (ES)', 'es']]) {
    const output = capture();
    const opened = [];
    await renderAccountCommand({
      language, action: 'status', output, now: () => NOW,
      result: { state: 'acceptance-required', account: { email: EMAIL }, pages },
      open: async (url) => { opened.push(url); },
      call: async () => ({ resumed: true }),
    });
    assert.equal(output.read(), appOutput(title), title);
    assert.deepEqual(opened, [pages[language].acceptance]);
  }
  for (const [title, language] of [['Key format not supported', 'en'], ['Key format not supported (ES)', 'es']]) {
    const result = await runSign(language, passwordMethods(), ['1\nformat\n'], (action) => {
      if (action === 'unlock') { const error = new Error('format'); error.code = 'unsupported_key_format'; throw error; }
      return signed({ password: true, phrase: false, approval: true });
    });
    assert.equal(result.output, appOutput(title), title);
  }
});

function passwordMethods() { return { password: true, phrase: false, approval: true }; }

test('sign-in started and cancelled frames match the board', async () => {
  for (const [title, language] of [['Sign-in started', 'en'], ['Sign-in started (ES)', 'es']]) {
    const controller = new AbortController();
    const output = capture();
    const input = scripted([], { end: false });
    const opened = [];
    const run = runSignInTerminal({
      language, input, output, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]), now: () => NOW, pause: async () => {},
      open: async (url) => { opened.push(url); controller.abort(); },
      call: async (action) => action === 'sign-in' ? { state: 'sign-in-pending', url: AUTHORIZATION_URL, signInPending: true } : { signInPending: true },
    });
    await run;
    assert.equal(output.read(), appOutput(title), title);
    assert.deepEqual(opened, [AUTHORIZATION_URL]);
  }
  for (const [title, language] of [['Cancelled or timed out', 'en'], ['Cancelled or timed out (ES)', 'es']]) {
    const output = capture();
    const input = scripted(['\u0003']);
    let cancelled = false;
    await runSignInTerminal({
      language, input, output, now: () => NOW, pause: async () => {},
      open: async () => { throw new Error('browser opened after cancel'); },
      call: async (action) => {
        if (action === 'cancel-sign-in') { cancelled = true; return { state: 'sign-in-cancelled' }; }
        return { state: 'sign-in-pending', url: AUTHORIZATION_URL };
      },
    });
    assert.equal(output.read(), appOutput(title), title);
    assert.equal(cancelled, true);
  }
});

test('choices renumber, invalid numbers return, and an empty password goes back', async () => {
  const output = capture();
  const input = scripted(['9\n1\n\n']);
  await runSignInTerminal({
    language: 'en', input, output, now: () => NOW, pause: async () => {},
    call: async () => signed({ password: true, phrase: false, approval: false }),
  });
  const text = output.read();
  assert.match(text, / {2}1 {2}Cosmic password\n {2}2 {2}Forgot password\?/);
  assert.equal(text.includes('Approve from a connected computer'), false);
  assert.match(text, /Choice: 9/);
  assert.equal(text.includes('invalid'), false);
  assert.equal(text.includes('did not open'), false);
  const prompts = text.split('Choice: ').length - 1;
  assert.ok(prompts >= 3);
});

test('hidden input restores raw mode for EOF, backspace and Ctrl+C', async () => {
  const eof = scripted(['1\n'], { end: true });
  const eofOutput = capture();
  await runSignInTerminal({
    language: 'en', input: eof, output: eofOutput, now: () => NOW, pause: async () => {},
    call: async () => signed(passwordMethods()),
  });
  assert.equal(eof.modes.at(-1), false);
  assert.equal(eof.modes.includes(true), true);
  assert.equal(eofOutput.read().includes(SECRET), false);

  let seen = null;
  const edited = scripted([`1\nab\u007fc\n`]);
  await runSignInTerminal({
    language: 'en', input: edited, output: capture(), now: () => NOW, pause: async () => {},
    call: async (action, fields) => {
      if (action === 'unlock') { seen = fields.password; return { state: 'ready' }; }
      return signed(passwordMethods());
    },
  });
  assert.equal(seen, 'ac');
  assert.equal(edited.modes.at(-1), false);

  const stopped = scripted(['1\n\u0003']);
  const stoppedOutput = capture();
  await runSignInTerminal({
    language: 'en', input: stopped, output: stoppedOutput, now: () => NOW, pause: async () => {},
    call: async () => signed(passwordMethods()),
  });
  assert.equal(stopped.modes.at(-1), false);
  assert.equal(stopped.modes.includes(true), true);
  assert.equal(stoppedOutput.read().includes(SECRET), false);

  let pasted = null;
  const emoji = scripted(['1\na🙂\u007fx\n']);
  await runSignInTerminal({
    language: 'en', input: emoji, output: capture(), now: () => NOW, pause: async () => {},
    call: async (action, fields) => {
      if (action === 'unlock') { pasted = fields.password; return { state: 'ready' }; }
      return signed(passwordMethods());
    },
  });
  assert.equal(pasted, 'ax');
  assert.equal(emoji.modes.at(-1), false);
});

test('Spanish terminal output does not say computadora or equipo', async () => {
  const result = await runSign('es', null, [], () => signed({ password: true, phrase: true, approval: true }));
  assert.equal(/computadora|equipo/i.test(result.output), false);
  assert.match(result.output, /dispositivo/);
});

test('json and non-TTY sign-in print one result and do not open a browser', async () => {
  const events = [];
  const output = sink();
  const errors = sink();
  const relayPlusClient = {
    async connectService() { return { async release(value) { events.push(['release', value]); } }; },
    async request(_service, spec) {
      events.push(spec.body.action);
      if (spec.body.action === 'sign-in') return { status: 200, json: { data: { state: 'sign-in-pending', url: AUTHORIZATION_URL } } };
      if (spec.body.action === 'status') return { status: 200, json: { data: { state: 'ready', signInPending: false } } };
      if (spec.body.action === 'approve') return { status: 422, json: { error: { code: 'approval_retired', message: 'Approval from this app is no longer available.' } } };
      return { status: 200, json: { data: { state: 'ready' } } };
    },
  };
  const tty = scripted([], { end: false });
  const opened = [];
  assert.equal(await runCli(['sign-in', '--json'], {
    relayPlusClient, input: tty, stdout: output, stderr: errors, openUrl: async () => { opened.push('json'); }, pause: async () => {},
  }), 0, errors.read());
  assert.deepEqual(opened, []);
  assert.equal(output.read(), `${JSON.stringify({ state: 'sign-in-pending', url: AUTHORIZATION_URL })}\n`);
  assert.deepEqual(events.filter((item) => item === 'sign-in' || item === 'status'), ['sign-in', 'status']);
  assert.deepEqual(events.at(-1), ['release', { stop: true }]);

  const plain = sink();
  const second = [];
  const client = {
    async connectService() { return { async release() { second.push('release'); } }; },
    async request(_service, spec) {
      second.push(spec.body.action);
      if (spec.body.password) second.push(spec.body.password);
      if (spec.body.action === 'unlock') return { status: 200, json: { data: { state: 'ready' } } };
      return { status: 200, json: { data: { state: 'signed-out' } } };
    },
  };
  const quiet = sink();
  assert.equal(await runCli(['sign-in'], {
    relayPlusClient: client, input: Readable.from([]), stdout: plain, stderr: quiet,
    openUrl: async () => { throw new Error('non-TTY opened a browser'); }, pause: async () => {},
  }), 0, quiet.read());
  assert.equal(plain.read().trim().split('\n').length, 1);

  const unlocked = sink();
  const unlockErrors = sink();
  assert.equal(await runCli(['relay-plus', 'unlock'], {
    relayPlusClient: client, input: Readable.from([`  ${SECRET}  \n`]), stdout: unlocked, stderr: unlockErrors, pause: async () => {},
  }), 0, unlockErrors.read());
  assert.equal(second.includes(`  ${SECRET}  `), true);
  assert.equal(unlocked.read().includes(SECRET), false);
  const kept = sink();
  assert.equal(await runCli(['relay-plus', 'unlock'], {
    relayPlusClient: client, input: Readable.from([`${SECRET}\n\n`]), stdout: kept, stderr: sink(), pause: async () => {},
  }), 0);
  assert.equal(second.includes(`${SECRET}\n`), true);

  const approved = sink();
  assert.equal(await runCli(['relay-plus', 'approve'], {
    relayPlusClient, input: Readable.from([]), stdout: approved, stderr: sink(), pause: async () => {},
  }), 2);
  assert.equal(approved.read(), '{"code":"approval_retired"}\n');
  assert.equal(approved.read().includes('fingerprint'), false);
});

test('help omits the hidden sign-in alias and retired approval flags', async () => {
  const help = await helpText();
  assert.equal(help.includes('relay-plus sign-in'), false);
  assert.equal(help.includes('sign-in|'), false);
  assert.equal(help.includes('--fingerprint'), false);
  assert.equal(help.includes('approve'), false);
  assert.match(help, /onem1nd sign-in/);
  assert.match(help, /relay-plus <status\|sign-out/);
});

test('computer limit is not rendered and Vault shows only when the service reports it', async () => {
  const source = readFileSync(new URL('../engine/relay-plus/terminal.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('device_limit'), false);
  assert.equal(source.includes('Computer limit'), false);
  const result = await runSign('en', null, [], () => signed({ password: true, phrase: true, approval: true }));
  assert.equal(result.output.includes('Vault'), false);
  const noPassword = await runSign('en', null, [], () => signed({ password: false, vault: true, phrase: true, approval: true }));
  assert.equal(noPassword.output.includes('Vault'), false, 'Vault supplies a password, so it needs a password envelope');
});

test('Use Vault unlocks a locked Vault, opens the data and never echoes either password', async () => {
  const methods = { password: true, vault: true, phrase: true, approval: true };
  const calls = [];
  const result = await runSign('en', null, [`2\n${SECRET}\n`], (action, fields) => {
    calls.push([action, fields]);
    if (action === 'vault') return fields?.vaultPassword === SECRET ? { state: 'ready' } : { ...signed(methods), vault: 'locked' };
    return signed(methods);
  });
  assert.deepEqual(calls.filter(([action]) => action === 'vault').map(([, fields]) => fields), [undefined, { vaultPassword: SECRET }]);
  assert.match(result.output, /\n  2  Vault \(found on this computer\)\n/);
  assert.match(result.output, /Choice: 2\nVault password: \nYour data is open on this computer\.\n/);
  assert.equal(result.output.includes(SECRET), false);
});

test('Use Vault without a saved password hides Vault and moves to typing the password', async () => {
  for (const [answer, line] of [['none', 'Vault has no Cosmic password for this account. Type it instead.'],
    ['unavailable', 'Vault could not give the password. Type it instead.'],
    ['wrong-password', 'The password saved in Vault did not open your data. Type it instead.']]) {
    const methods = { password: true, vault: true, phrase: false, approval: false };
    const result = await runSign('en', null, ['2\n', `${SECRET}\n`], (action) => {
      if (action === 'vault') return { ...signed({ ...methods, vault: answer !== 'none' }), vault: answer };
      if (action === 'unlock') return { state: 'ready' };
      return signed(methods);
    });
    assert.ok(result.output.includes(`Choice: 2\n${line}\nCosmic password: \nYour data is open on this computer.\n`), answer);
    assert.equal(result.output.includes(SECRET), false);
  }
});

test('an approved envelope is not success before storage and a configured account is not ready', async () => {
  const output = capture();
  let inspected = false;
  await runSignInTerminal({
    language: 'en', input: scripted(['2\n']), output, pause: async () => {},
    call: async action => {
      if (action === 'sign-in') return signed({ password: true, approval: true });
      if (action === 'request-approval') return { state: 'approval-approved', outcome: 'approved', code: CODE, stored: false };
      if (action === 'inspect') {
        assert.equal(output.read().includes('Your data is open'), false);
        inspected = true;
        return { state: 'configured', stored: true, code: CODE };
      }
      return { state: 'approval-inactive' };
    },
  });
  assert.equal(inspected, true);
  assert.match(output.read(), /Your data is open/);
  assert.equal(output.read().includes('Relay+ is ready'), false);
  for (const state of ['configured', 'read-only', 'key-required']) {
    const status = capture();
    await renderAccountCommand({ language: 'en', action: 'status', result: { state: 'ready', sync: { state } }, output: status });
    assert.equal(status.read().includes('Relay+ is ready'), false);
  }
});

test('unsupported envelope state shows the format error without claiming data recovery', async () => {
  const result = await runSign('en', null, [], () => ({ ...signed({}), code: 'unsupported_key_format' }));
  assert.match(result.output, /This key format cannot be opened here/);
  assert.equal(result.output.includes('cannot be\nrecovered'), false);
});

test('returning from password recovery accepts the first visible choice and refreshes the envelopes', async () => {
  const methods = { password: true, phrase: true, approval: true };
  const actions = [];
  let correct = false;
  const result = await runSign('en', methods, [`4\n1\n${SECRET}\n`], (action, fields) => {
    actions.push(action);
    if (action === 'unlock') { correct = fields.password === SECRET; return { state: 'ready', stored: true }; }
    return signed(methods);
  });
  assert.equal(correct, true);
  assert.equal(actions.indexOf('refresh-keys') < actions.indexOf('unlock'), true);
  assert.equal(result.output.includes(SECRET), false);
  assert.match(result.output, /Choice: 1\nCosmic password:/);
});

test('JSON pending ownership cancels on SIGINT before releasing and emits one line', async () => {
  for (const action of ['sign-in', 'request-approval']) {
    const events = [];
    const output = sink();
    const client = {
      async connectService() { return { async release() { events.push('release'); } }; },
      async request(_service, spec) {
        events.push(spec.body.action);
        if (spec.body.action === 'status') return { status: 200, json: { data: { signInPending: true } } };
        return { status: 200, json: { data: { state: action === 'sign-in' ? 'sign-in-pending' : 'approval-pending' } } };
      },
    };
    const args = action === 'sign-in' ? ['sign-in', '--json'] : ['relay-plus', action, '--json'];
    assert.equal(await runCli(args, { relayPlusClient: client, input: Readable.from([]), stdout: output, stderr: sink(),
      pause: async () => { process.emit('SIGINT'); } }), 130);
    const cancel = action === 'sign-in' ? 'cancel-sign-in' : 'cancel-approval';
    assert.deepEqual(events.slice(-2), [cancel, 'release']);
    assert.equal(output.read().trim().split('\n').length, 1);
  }
});

test('rejected secret arguments never appear in usage errors', async () => {
  for (const prefix of [['sign-in'], ['relay-plus', 'unlock'], ['relay-plus', 'recover']]) {
    for (const flag of [`--password=${SECRET}`, `--phrase=${SECRET}`, SECRET]) {
      const output = sink(), errors = sink();
      assert.equal(await runCli([...prefix, flag], { stdout: output, stderr: errors }), 2);
      assert.equal((output.read() + errors.read()).includes(SECRET), false);
    }
  }
});

test('UTF-8 stdin decodes split characters and bounded TTY input restores its original mode', async () => {
  const secret = Buffer.from('  café 密碼  \n');
  let correct = false;
  const output = sink();
  const client = {
    async connectService() { return { async release() {} }; },
    async request(_service, spec) {
      correct = Buffer.from(spec.body.password).equals(secret.subarray(0, -1));
      return { status: 200, json: { data: { state: 'configured', stored: true } } };
    },
  };
  const chunks = [...secret].map(byte => Buffer.from([byte]));
  assert.equal(await runCli(['relay-plus', 'unlock'], { relayPlusClient: client, input: Readable.from(chunks), stdout: output, stderr: sink() }), 0);
  assert.equal(correct, true);
  assert.equal(output.read().includes('café'), false);
  const input = scripted(['x'.repeat(5000)]);
  input.isRaw = true;
  const source = attachInput(input);
  try { await assert.rejects(readSecret(input, source, capture()), { code: 'invalid_body' }); }
  finally { source.stop(); }
  assert.equal(input.modes.at(-1), true);
});

function visibleTerminal(value) {
  let row = 0, column = 0;
  const lines = [''];
  for (const token of value.match(/\u001b\[\d+[AJ]|[^\u001b]/gu) ?? []) {
    if (token.startsWith('\u001b[')) {
      if (token.endsWith('A')) row -= Number(token.slice(2, -1));
      else { lines.splice(row + 1); lines[row] = (lines[row] ?? '').slice(0, column); }
    } else if (token === '\r') column = 0;
    else if (token === '\n') { row += 1; column = 0; lines[row] ??= ''; }
    else { const line = lines[row] ?? ''; lines[row] = line.slice(0, column) + token + line.slice(column + token.length); column += token.length; }
  }
  return lines.join('\n');
}

test('a complete browser return and approval transition leave the approved board on screen', async () => {
  for (const language of ['en', 'es']) {
    const output = capture();
    let step = 0;
    await runSignInTerminal({
      language, input: scripted(['2\n']), output, now: () => NOW, pause: async () => {}, open: async () => {},
      call: async action => {
        if (action === 'sign-in') return { state: 'sign-in-pending', url: AUTHORIZATION_URL };
        if (action === 'status') return { ...signed({ password: true, phrase: true, approval: true }), signInPending: false };
        if (action === 'request-approval') return { state: 'approval-pending', expiresAt: NOW + 300000 };
        if (action === 'inspect') return ++step === 1 ? { state: 'approval-code', code: CODE }
          : { state: 'ready', stored: true, code: CODE };
        return { state: 'approval-inactive' };
      },
    });
    assert.equal(visibleTerminal(output.read()), appOutput(language === 'es' ? 'Approved (ES)' : 'Approved'));
  }
});

test('all fifty-two buildable English and Spanish frames are compared and the frozen copy is complete', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/sign-in-board-output.json', import.meta.url), 'utf8'));
  assert.equal(fixture.frames.length, 54);
  assert.deepEqual(fixture.frames.map(({ title, lang, output }) => ({ title, lang, output })), frames);
  const buildable = frames.filter(frame => !frame.title.startsWith('Computer limit reached'));
  assert.equal(buildable.length, 52);
  assert.equal(buildable.every(frame => compared.has(frame.title)), true, 'Every buildable board frame must have an output comparison.');
});
