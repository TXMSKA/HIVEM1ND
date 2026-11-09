import { text } from '../texts.mjs';
import { CoreError } from '../service/identity.mjs';

const LABELS = { password: 'choicePassword', vault: 'choiceVault', approval: 'choiceApproval', phrase: 'choicePhrase', forgot: 'choiceForgot' };

// Vault is listed while it is installed; approval only when the service says an approver is available.
export function openingMethods(methods = {}) {
  const items = [];
  if (methods.password) items.push('password');
  if (methods.password && methods.vault) items.push('vault');
  if (methods.approval) items.push('approval');
  if (methods.phrase) items.push('phrase');
  if (methods.password) items.push('forgot');
  return items;
}

function emailOf(result) {
  const account = result?.account ?? result?.sync?.account;
  return typeof account?.email === 'string' ? account.email : '';
}

function methodsOf(result) {
  return result?.methods ?? result?.sync?.methods ?? null;
}

function page(result, language, kind) {
  return result?.pages?.[language]?.[kind] ?? result?.sync?.pages?.[language]?.[kind] ?? null;
}

function formatWhen(language, value, now) {
  const then = typeof value === 'number' ? value : Date.parse(value ?? '');
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 60) return text(language, minutes === 1 ? 'whenMinute' : 'whenMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return text(language, hours === 1 ? 'whenHour' : 'whenHours', { count: hours });
  const days = Math.max(1, Math.round(hours / 24));
  return text(language, days === 1 ? 'whenDay' : 'whenDays', { count: days });
}

function formatRemaining(expiresAt, now) {
  const at = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt ?? '');
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, Math.round((at - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function attachInput(input, signal) {
  let pending = '';
  let ended = false;
  let waiter = null;
  let sigint = false;
  let overflow = false;
  const decoder = new TextDecoder('utf8');
  const wake = () => {
    const current = waiter;
    waiter = null;
    current?.();
  };
  const onData = (chunk) => {
    if (overflow) return;
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(pending) > 8192) { overflow = true; pending = ''; }
    wake();
  };
  const onEnd = () => {
    pending += decoder.decode();
    ended = true;
    wake();
  };
  const onSigint = () => {
    sigint = true;
    wake();
  };
  input?.on?.('data', onData);
  input?.on?.('end', onEnd);
  process.on('SIGINT', onSigint);
  const onAbort = () => wake();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    get aborted() { return signal?.aborted === true; },
    get overflow() { return overflow; },
    takeCancel() {
      if (pending.startsWith('\u0003')) { pending = pending.slice(1); return true; }
      if (!sigint) return false;
      sigint = false;
      return true;
    },
    async wait() {
      if (pending.length || ended || sigint || overflow || signal?.aborted) return;
      await new Promise((resolve) => { waiter = resolve; });
    },
    takeChar() {
      const [char] = pending;
      pending = pending.slice(char.length);
      return char;
    },
    get empty() { return pending.length === 0; },
    get ended() { return ended; },
    indexOf(char) { return pending.indexOf(char); },
    sliceLine(index) {
      const line = pending.slice(0, index);
      pending = pending.slice(index);
      return line;
    },
    stop() {
      pending = '';
      input?.off?.('data', onData);
      input?.off?.('end', onEnd);
      process.off('SIGINT', onSigint);
      signal?.removeEventListener('abort', onAbort);
      wake();
    },
  };
}

// Hidden entry: raw mode, UTF-8, paste, backspace, Enter, EOF and Ctrl+C. The mode and listeners always come back.
export async function readSecret(input, source, output, { echo = false, limit = 4096 } = {}) {
  const raw = typeof input?.setRawMode === 'function';
  const wasRaw = input?.isRaw === true;
  if (raw) input.setRawMode(true);
  input?.resume?.();
  let value = '';
  try {
    for (;;) {
      if (source.overflow) throw new CoreError(413, 'invalid_body', 'The terminal input is too long.');
      if (source.aborted) return { aborted: true, value };
      if (source.takeCancel()) return { cancelled: true, value };
      if (source.empty) {
        if (source.ended) return { eof: true, value };
        await source.wait();
        continue;
      }
      const char = source.takeChar();
      if (char === '\u0003') return { cancelled: true, value };
      if (char === '\u0004') return { eof: true, value };
      if (char === '\r') {
        if (!source.empty && source.indexOf('\n') === 0) source.takeChar();
        if (echo) output.write('\n');
        return { value };
      }
      if (char === '\n') {
        if (echo) output.write('\n');
        return { value };
      }
      if (char === '\u007f' || char === '\b') {
        const chars = Array.from(value);
        chars.pop();
        value = chars.join('');
        if (echo) output.write('\b \b');
        continue;
      }
      value += char;
      if (Buffer.byteLength(value) > limit) throw new CoreError(413, 'invalid_body', 'The terminal input is too long.');
      if (echo) output.write(char);
    }
  } finally {
    if (raw) input.setRawMode(wasRaw);
  }
}

function writeMenu(output, language, methods) {
  const items = openingMethods(methods);
  if (!items.length) return items;
  if (methods.password) output.write(`${text(language, 'choicesIntro')}\n`);
  else output.write(`${text(language, 'legacyIntro')}\n\n`);
  items.forEach((item, index) => output.write(`  ${index + 1}  ${text(language, LABELS[item])}\n`));
  output.write(text(language, 'choicePrompt'));
  return items;
}

function writeLocked(output, language) {
  output.write(`\n^C\n\n${text(language, 'lockedTitle')}\n${text(language, 'lockedBody')}\n${text(language, 'lockedPaused')}\n`);
}

function relayReady(result) {
  const state = result?.sync?.state ?? result?.state;
  return state === 'ready' && result?.entitled !== false && result?.enabled !== false;
}

function clearRendered(output, value) {
  const width = output.columns ?? 120;
  const rows = value.split('\n').slice(0, -1).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
  output.write(`\r${rows ? `\u001b[${rows}A` : ''}\u001b[0J`);
}

function writeOpen(output, language, result = { state: 'ready' }) {
  output.write(`${text(language, 'dataOpen')}\n${text(language, 'dataOpenStay')}\n`);
  if (relayReady(result)) output.write(`${text(language, 'relayReady')}\n`);
}

function writeKeyFormat(output, language) {
  output.write(`${text(language, 'keyFormat')}\n`);
}

async function showAcceptance(options, result) {
  const { output, language, open, call } = options;
  const email = emailOf(result);
  if (email) output.write(`${text(language, 'signedInAs', { email })}\n`);
  output.write(`${text(language, 'acceptanceIntro')}\n${text(language, 'acceptanceOpening')}\n${text(language, 'acceptancePaused')}\n`);
  const url = page(result, language, 'acceptance');
  if (url) await open?.(url);
  let delay = 2000;
  for (;;) {
    if (options.source?.aborted || options.source?.takeCancel()) return false;
    let check;
    try { check = await call('check-acceptance'); }
    catch { return false; }
    if (check?.resumed || check?.stopped) return check.resumed === true;
    delay = Math.max(2000, (check?.retryAfter ?? 2) * 1000);
    await options.pause(delay);
  }
}

export async function renderAccountCommand({ language, action, result, output, open, call, source, now = Date.now, pause = async () => {} }) {
  if (action === 'sign-out') {
    output.write(`${text(language, 'signedOut')}\n`);
    return;
  }
  const state = result?.sync?.state === 'offline' || result?.state === 'offline' ? 'offline'
    : result?.state === 'acceptance-required' || result?.sync?.state === 'acceptance-required' ? 'acceptance-required'
      : result?.state === 'authentication-required' || result?.sync?.state === 'authentication-required' ? 'authentication-required'
        : result?.state === 'signed-out' || result?.sync?.state === 'signed-out' ? 'signed-out'
          : relayReady(result) ? 'ready'
            : null;
  if (state === 'offline') {
    output.write(`${text(language, 'offline')}\n`);
    return;
  }
  if (state === 'signed-out') {
    output.write(`${text(language, 'statusSignedOut')}\n${text(language, 'statusLocal')}\n${text(language, 'statusRun')}\n`);
    return;
  }
  if (state === 'authentication-required') {
    output.write(`${text(language, 'sessionEnded')}\n${text(language, 'statusRun')}\n`);
    return;
  }
  if (state === 'acceptance-required') {
    await showAcceptance({ output, language, open, call, pause, source }, result);
    return;
  }
  if (state === 'ready') {
    const email = emailOf(result);
    if (email) output.write(`${text(language, 'signedInAs', { email })}\n`);
    output.write(`${text(language, 'dataOpen')}\n`);
    const when = formatWhen(language, result.lastSync ?? result.sync?.lastSync, now());
    output.write(when ? `${text(language, 'statusReady', { when })}\n` : `${text(language, 'relayReady')}\n`);
  }
}

async function passwordFlow(options) {
  const { output, language, call, input, source } = options;
  let failed = false;
  for (;;) {
    output.write(failed ? `${text(language, 'passwordPrompt')}${text(language, 'passwordEmptyHint')}` : text(language, 'passwordPrompt'));
    const entry = await readSecret(input, source, output);
    if (entry.aborted) return 'exit';
    if (entry.cancelled) {
      writeLocked(output, language);
      return 'exit';
    }
    if (entry.eof) return 'exit';
    output.write('\n');
    if (entry.value.length === 0) return 'menu';
    try {
      const result = await call('unlock', { password: entry.value });
      if (result?.state === 'acceptance-required') { options.session = result; return 'acceptance'; }
      writeOpen(output, language, result);
      return 'done';
    } catch (error) {
      if (error?.code === 'unsupported_key_format') {
        writeKeyFormat(output, language);
        return 'exit';
      }
      if (error?.code === 'key_authentication_failed') {
        output.write(`${text(language, 'passwordWrong')}\n`);
        failed = true;
        continue;
      }
      throw error;
    }
  }
}

async function phraseFlow(options) {
  const { output, language, call, input, source } = options;
  let failed = false;
  for (;;) {
    if (!failed) output.write(`${text(language, 'phraseLead')}\n`);
    output.write(text(language, 'phrasePrompt'));
    const entry = await readSecret(input, source, output);
    if (entry.aborted) return 'exit';
    if (entry.cancelled) {
      writeLocked(output, language);
      return 'exit';
    }
    if (entry.eof) return 'exit';
    output.write('\n');
    if (entry.value.length === 0) return 'menu';
    try {
      const result = await call('recover', { phrase: entry.value });
      if (result?.state === 'acceptance-required') { options.session = result; return 'acceptance'; }
      writeOpen(output, language, result);
      return 'done';
    } catch (error) {
      if (error?.code === 'unsupported_key_format') {
        writeKeyFormat(output, language);
        return 'exit';
      }
      if (error?.code === 'key_authentication_failed' || error?.code === 'invalid_recovery_phrase') {
        output.write(`${text(language, 'phraseWrong')}\n`);
        failed = true;
        continue;
      }
      throw error;
    }
  }
}

// Vault hands the saved Cosmic password to the service. Only the Vault password, when Vault is locked, is typed here.
async function vaultFlow(options) {
  const { output, language, call, input, source } = options;
  let result = await call('vault');
  for (;;) {
    if (result?.state === 'acceptance-required') { options.session = result; return 'acceptance'; }
    if (result?.vault !== 'locked' && result?.vault !== 'vault-wrong') break;
    if (result.vault === 'vault-wrong') output.write(`${text(language, 'vaultWrong')}\n`);
    output.write(text(language, 'vaultPrompt'));
    const entry = await readSecret(input, source, output, { limit: 4096 });
    if (entry.aborted || entry.eof) return 'exit';
    if (entry.cancelled) { writeLocked(output, language); return 'exit'; }
    output.write('\n');
    if (entry.value.length === 0) return 'menu';
    result = await call('vault', { vaultPassword: entry.value });
  }
  if (!result?.vault) {
    writeOpen(output, language, result);
    return 'done';
  }
  options.session = result;
  const line = { none: 'vaultNone', 'wrong-password': 'vaultPasswordWrong' }[result.vault] ?? 'vaultUnavailable';
  output.write(`${text(language, line)}\n`);
  return passwordFlow(options);
}

function writeWaiting(output, language, view, now) {
  output.write(`\n${text(language, 'approvalTitle')}\n${text(language, 'approvalBody')}\n\n${text(language, 'approvalWaiting')}\n`);
  const time = formatRemaining(view.expiresAt, now());
  if (time) output.write(text(language, 'approvalExpires', { time }));
}

function writeCode(output, language, code) {
  output.write(`\n${text(language, 'approvalTitle')}\n${text(language, 'approvalBody')}\n\n${text(language, 'approvalCode', { code })}\n${text(language, 'approvalWaitingThere')}\n${text(language, 'approvalCompare')}`);
}

function writeApproved(output, language, code, result) {
  output.write(`\n${text(language, 'approvalCode', { code })}\n${text(language, 'approvalReceived')}\n`);
  writeOpen(output, language, result);
}

function writeRejected(output, language, code) {
  if (code) output.write(`\n${text(language, 'approvalCode', { code })}\n${text(language, 'approvalWaitingThere')}\n`);
  else output.write(`\n${text(language, 'approvalWaiting')}\n`);
  output.write(`${text(language, 'approvalRejected')}\n\n`);
}

function approvalDone(view) {
  return view?.state === 'ready' || view?.stored === true || view?.state === 'approval-ended' || view?.state === 'approval-inactive'
    || ['rejected', 'expired', 'cancelled'].includes(view?.outcome);
}

async function approvalFlow(options) {
  const { output, language, call, source } = options;
  let panel = '';
  const show = render => {
    if (panel) clearRendered(output, panel);
    let next = '';
    render({ write(value) { next += value; } });
    output.write(next);
    panel = next;
  };
  let view = await call('request-approval');
  if (view?.state === 'acceptance-required') { options.session = view; return 'acceptance'; }
  if (view?.outcome === 'approval-limit' || view?.outcome === 'rate-limited') {
    output.write(`${text(language, 'approvalTooMany')}\n\n`);
    return 'menu';
  }
  if (view?.outcome === 'approval-unavailable') return 'menu';
  let code = typeof view?.code === 'string' ? view.code : null;
  if (view?.state === 'ready' || view?.stored === true) {
    show(target => writeApproved(target, language, code ?? '', view));
    return 'done';
  }
  if (view?.state === 'approval-ended' || view?.outcome === 'rejected' || view?.outcome === 'expired') {
    show(target => writeRejected(target, language, view?.outcome === 'expired' && !code ? null : code));
    return 'menu';
  }
  if (code) show(target => writeCode(target, language, code));
  else show(target => writeWaiting(target, language, view, options.now));
  for (;;) {
    if (source.aborted) return 'exit';
    if (source.takeCancel()) {
      await call('cancel-approval');
      return 'menu';
    }
    const next = await call('inspect');
    if (next?.state === 'acceptance-required') { options.session = next; return 'acceptance'; }
    if (source.aborted) return 'exit';
    if (typeof next?.code === 'string') code = next.code;
    if (next?.state === 'ready' || next?.stored === true) {
      show(target => writeApproved(target, language, code ?? '', next));
      return 'done';
    }
    if (approvalDone(next) && next?.state !== 'approval-code' && next?.state !== 'approval-pending') {
      show(target => writeRejected(target, language, code));
      return 'menu';
    }
    if (!view?.code && code && next?.state === 'approval-code') {
      show(target => writeCode(target, language, code));
      view = next;
    }
    await options.pause(2000);
    if (source.takeCancel()) {
      await call('cancel-approval');
      return 'menu';
    }
  }
}

async function forgotFlow(options) {
  const { output, language, open } = options;
  output.write(`\n${text(language, 'forgotTitle')}\n${text(language, 'forgotBody')}\n${text(language, 'forgotOpening')}\n${text(language, 'forgotAfter')}\n\n`);
  const url = page(options.session, language, 'recovery');
  if (url) await open?.(url);
  options.refreshOnChoice = true;
  return 'menu';
}

async function choose(options) {
  const { output, language, input, source } = options;
  let methods = methodsOf(options.session) ?? { password: false, phrase: false, approval: false };
  for (;;) {
    if (source.aborted) return;
    if (!openingMethods(methods).length) {
      if (options.session?.code === 'unsupported_key_format' || options.session?.sync?.code === 'unsupported_key_format') {
        writeKeyFormat(output, language);
        return;
      }
      output.write(`${text(language, 'lockedTitle')}\n${text(language, 'lockedBody')}\n${text(language, 'lockedPaused')}\n`);
      return;
    }
    const items = writeMenu(output, language, methods);
    const choice = await readSecret(input, source, output, { echo: true, limit: 32 });
    if (choice.aborted || choice.eof) return;
    if (choice.cancelled) {
      writeLocked(output, language);
      return;
    }
    const index = Number(choice.value);
    const picked = Number.isInteger(index) ? items[index - 1] : null;
    if (!picked) continue;
    let outcome = 'menu';
    try {
      if (options.refreshOnChoice) {
        options.session = await options.call('refresh-keys');
        methods = methodsOf(options.session) ?? methods;
        options.refreshOnChoice = false;
      }
      if (picked === 'password') outcome = await passwordFlow(options);
      else if (picked === 'vault') { outcome = await vaultFlow(options); methods = methodsOf(options.session) ?? methods; }
      else if (picked === 'phrase') outcome = await phraseFlow(options);
      else if (picked === 'approval') outcome = await approvalFlow(options);
      else outcome = await forgotFlow(options);
    } catch (error) {
      if (error?.code !== 'acceptance_required') throw error;
      options.session = await options.call('status');
      outcome = 'acceptance';
    }
    if (outcome === 'done' || outcome === 'exit') return;
    if (outcome === 'acceptance') {
      if (!await showAcceptance(options, options.session)) return;
      options.session = await options.call('status');
      if (options.session.keyReady) { writeOpen(output, language, options.session); return; }
      methods = methodsOf(options.session) ?? methods;
    }
  }
}

export async function runSignInTerminal(options) {
  const output = options.output;
  const language = options.language === 'es' ? 'es' : 'en';
  const source = attachInput(options.input, options.signal);
  const now = () => options.now?.() ?? Date.now();
  const pause = (ms) => options.pause?.(ms, options.signal) ?? options.sleep?.(ms, options.signal) ?? new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  const sessionOptions = { ...options, output, language, source, now, pause, session: null };
  let pendingSignIn = false;
  try {
    output.write(`${text(language, 'signInOpening')}\n`);
    let result = await options.call('sign-in');
    if (result?.state === 'sign-in-pending') {
      pendingSignIn = true;
      output.write(`${text(language, 'signInWaiting')}\n`);
      await Promise.resolve();
      if (source.takeCancel() || source.indexOf('\u0003') === 0) {
        if (source.indexOf('\u0003') === 0) source.takeChar();
        output.write(`^C\n${text(language, 'signInCancelled')}\n`);
        await options.call('cancel-sign-in');
        pendingSignIn = false;
        return;
      }
      const progress = `${text(language, 'signInWaiting')}\n\n${text(language, 'signInBrowserHint', { url: result.url ?? '' })}\n\n${text(language, 'signInCancelHint')}`;
      output.write(progress.slice(text(language, 'signInWaiting').length + 1));
      const clearProgress = () => clearRendered(output, progress);
      if (result.url) await options.open?.(result.url);
      if (source.aborted) return;
      for (;;) {
        if (source.aborted) return;
        if (source.takeCancel() || source.indexOf('\u0003') === 0) {
          if (source.indexOf('\u0003') === 0) source.takeChar();
          clearProgress();
          output.write(`${text(language, 'signInWaiting')}\n^C\n${text(language, 'signInCancelled')}\n`);
          await options.call('cancel-sign-in');
          pendingSignIn = false;
          return;
        }
        result = await options.call('status');
        if (source.aborted) return;
        if (result?.signInPending === false || (result?.signInPending !== true && result?.state !== 'signed-out' && result?.sync?.state !== 'signed-out')) {
          pendingSignIn = false;
          clearProgress();
          if (result?.state === 'signed-out') {
            output.write(`${text(language, 'signInWaiting')}\n^C\n${text(language, 'signInCancelled')}\n`);
            return;
          }
          break;
        }
        await pause(500);
      }
    }
    sessionOptions.session = result;
    if (result?.state === 'offline' || result?.sync?.state === 'offline') {
      output.write(`${text(language, 'offline')}\n`);
      return;
    }
    if (result?.state === 'authentication-required' || result?.sync?.state === 'authentication-required') {
      output.write(`${text(language, 'sessionEnded')}\n${text(language, 'statusRun')}\n`);
      return;
    }
    if (result?.state === 'acceptance-required' || result?.sync?.state === 'acceptance-required') {
      const resumed = await showAcceptance(sessionOptions, result);
      if (!resumed) return;
      result = await options.call('status');
      sessionOptions.session = result;
    }
    const email = emailOf(result);
    const keyRequired = result?.state === 'key-required' || result?.sync?.state === 'key-required' || methodsOf(result);
    if (!keyRequired) {
      if (email && result?.keyReady !== false) {
        output.write(`${text(language, 'signedInAs', { email })}\n\n${text(language, 'keyAlready')}\n`);
        if (relayReady(result)) output.write(`${text(language, 'relayReady')}\n`);
      }
      return;
    }
    if (email) output.write(`${text(language, 'signedInAs', { email })}\n\n`);
    await choose(sessionOptions);
  } catch (error) {
    if (error?.code === 'unsupported_key_format') writeKeyFormat(output, language);
    else if (error?.status === 401 || error?.code === 'invalid_grant') output.write(`${text(language, 'sessionEnded')}\n${text(language, 'statusRun')}\n`);
    else if (error?.code !== 'operation_cancelled') output.write(`${text(language, 'offline')}\n`);
  } finally {
    try {
      if (pendingSignIn) { try { await options.call('cancel-sign-in'); } catch {} }
      try { await options.call('cancel-approval'); } catch {}
    } finally { source.stop(); }
  }
}
