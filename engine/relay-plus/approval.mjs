import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { platform as hostPlatform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreError } from '../service/identity.mjs';
import { decodeCanonicalBase64 } from './account-key.mjs';

export const APPROVAL_ALGORITHM = 'QNT_APPROVAL_X25519_HKDF_SHA256_AES256GCM_V1';
const LIFETIME_MS = 300_000;
const POLL_MS = 2_000;
const WRAPPED_LENGTH = 61;
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const FAMILIES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', android: 'Android', aix: 'AIX', freebsd: 'FreeBSD', openbsd: 'OpenBSD', sunos: 'Solaris' };
// Curve25519 points of small order. Agreement with one of them is not a secret.
const LOW_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
].map(hex => Buffer.from(hex, 'hex'));

function fail(code, message) { throw new CoreError(422, code, message); }
function zero(buffer) { buffer?.fill?.(0); }
function makeLock() {
  let tail = Promise.resolve();
  return function lock(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(() => {}, () => {});
    return run;
  };
}
function httpFailure(error) { return error && typeof error.status === 'number' && typeof error.code === 'string'; }
function networkFailure(error) { return !httpFailure(error); }

export function approvalLabel(host = hostPlatform()) {
  const family = FAMILIES[host] ?? 'POSIX';
  const cleaned = [...`ONEM1ND, ${family}`].filter(char => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char)).slice(0, 80).join('');
  if ([...cleaned].length < 1) fail('invalid_approval', 'The approval request is invalid.');
  return cleaned;
}

export function formatApprovalCode(digest) {
  const digits = String(digest.readUInt32BE(0) % 100_000_000).padStart(8, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

function concat(parts) { return Buffer.concat(parts); }

export function approvalCommitment(publicKey, nonce) {
  return createHash('sha256').update(concat([Buffer.from('cosmic-approval-commit-v1'), publicKey, nonce])).digest();
}

export function approvalCode(requesterPublic, approverPublic, requesterNonce, approverNonce) {
  const digest = createHash('sha256').update(concat([
    Buffer.from('cosmic-approval-code-v1'), requesterPublic, approverPublic, requesterNonce, approverNonce,
  ])).digest();
  return formatApprovalCode(digest);
}

export function usablePublicKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  // RFC 7748 masks the top bit, so each small-order point also has a high-bit alias. The raw bytes stay unchanged elsewhere.
  const masked = Buffer.from(bytes);
  masked[31] &= 0x7f;
  return !LOW_ORDER.some(point => point.equals(masked));
}

function privateFromSeed(seed) {
  return createPrivateKey({ key: concat([PKCS8, seed]), format: 'der', type: 'pkcs8' });
}

function publicRaw(key) {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32);
}

function asPrivate(value) {
  if (value?.type === 'private') return value;
  if (value instanceof Uint8Array && value.length === 32) return privateFromSeed(value);
  fail('invalid_approval', 'The approval request is invalid.');
}

function agreement(privateKey, peer) {
  if (!usablePublicKey(peer)) fail('invalid_approval', 'The approval request is invalid.');
  let secret;
  try {
    secret = diffieHellman({
      privateKey: asPrivate(privateKey),
      publicKey: createPublicKey({ key: concat([SPKI, peer]), format: 'der', type: 'spki' }),
    });
  } catch {
    fail('invalid_approval', 'The approval request is invalid.');
  }
  if (!secret.some(byte => byte !== 0)) { zero(secret); fail('invalid_approval', 'The approval request is invalid.'); }
  return secret;
}

export function openApprovalEnvelope(envelope, privateKey, transcript) {
  if (envelope?.algorithm !== APPROVAL_ALGORITHM) fail('unsupported_key_format', 'The key format is not supported.');
  const wrapped = decodeCanonicalBase64(envelope.wrapped, WRAPPED_LENGTH);
  if (!wrapped || wrapped[0] !== 1) fail('invalid_approval', 'The approval request is invalid.');
  const fields = [transcript.requesterPublic, transcript.approverPublic, transcript.requesterNonce, transcript.approverNonce];
  if (fields.some(field => !(field instanceof Uint8Array) || field.length !== 32) || !usablePublicKey(transcript.approverPublic)) {
    zero(wrapped);
    fail('invalid_approval', 'The approval request is invalid.');
  }
  let secret = null;
  let wrapping = null;
  let plain = null;
  let partial = null;
  try {
    secret = agreement(privateKey, transcript.approverPublic);
    wrapping = Buffer.from(hkdfSync('sha256', secret, concat(fields), Buffer.from('cosmic-key-approval-v1'), 32));
    const decipher = createDecipheriv('aes-256-gcm', wrapping, wrapped.subarray(1, 13));
    const aad = JSON.stringify(['cosmic-key-approval-v1', transcript.accountId, transcript.id,
      transcript.requesterPublic.toString('base64'), transcript.approverPublic.toString('base64'),
      transcript.requesterNonce.toString('base64'), transcript.approverNonce.toString('base64')]);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(wrapped.subarray(45));
    try { partial = decipher.update(wrapped.subarray(13, 45)); plain = Buffer.concat([partial, decipher.final()]); }
    catch { fail('key_authentication_failed', 'The account key could not be opened.'); }
    if (plain.length !== 32) fail('key_authentication_failed', 'The account key could not be opened.');
    return Buffer.from(plain);
  } finally {
    zero(secret);
    zero(wrapping);
    zero(plain);
    zero(partial);
    zero(wrapped);
  }
}

export async function approverAvailable(client) {
  const result = await client.request('/v1/key-approvers/availability');
  return result?.available === true;
}

function terminalStatus(status) { return status === 'rejected' || status === 'cancelled' || status === 'consumed' || status === 'expired'; }

export function createApprovalRequester(options) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const lock = options.lock ?? makeLock();
  const stepLock = makeLock();
  const client = options.client;
  const accountId = options.accountId;
  let requestId = null;
  let body = null;
  let privateKey = null;
  let publicKey = null;
  let nonce = null;
  let approvalId = null;
  let startedAt = null;
  let expiresAt = null;
  let offer = null;
  let revealed = false;
  let code = null;
  let envelope = null;
  let outcome = null;
  let stored = false;
  let cancelled = false;
  let secretsLost = false;
  let created = false;
  let remoteDeleted = null;
  let retryAt = 0;
  let lastGet = null;
  let getChain = Promise.resolve();
  // Cancellation aborts every in-flight poll and wait. The final DELETE and the cleanup consume are not abortable.
  const controller = new AbortController();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const signal = controller.signal;

  function live() { return !cancelled && !secretsLost && !outcome && signal?.aborted !== true; }
  function deadline() { return startedAt === null ? now() + LIFETIME_MS : startedAt + LIFETIME_MS; }
  function within() { return now() < deadline() && (expiresAt === null || now() < expiresAt); }
  function wipeSecrets() {
    zero(nonce);
    zero(publicKey);
    zero(offer?.publicKey);
    zero(offer?.nonce);
    privateKey = null;
    publicKey = null;
    nonce = null;
    offer = null;
    envelope = null;
    code = null;
  }
  function view() {
    const state = stored ? 'account-key-ready'
      : outcome ? 'approval-ended'
        : envelope ? 'approval-approved'
          : code ? 'approval-code'
            : requestId ? 'approval-pending'
              : 'approval-inactive';
    return {
      state,
      expiresAt,
      ...(code && !outcome ? { code } : {}),
      outcome: outcome ?? (envelope ? 'approved' : revealed ? 'revealed' : offer ? 'offered' : requestId ? 'pending' : null),
      remote: remoteDeleted,
      stored,
    };
  }
  function invalid(code = 'approval_conflict') {
    outcome = 'conflict';
    wipeSecrets();
    fail(code, 'The approval request changed.');
  }
  function remember(row) {
    if (!row || typeof row !== 'object') fail('invalid_approval', 'The approval request is invalid.');
    if (typeof row.createdAt === 'number' && startedAt !== null) expiresAt = Math.min(row.expiresAt ?? deadline(), deadline());
    else if (typeof row.expiresAt === 'number') expiresAt = Math.min(row.expiresAt, deadline());
    if (terminalStatus(row.status)) {
      outcome = row.status;
      wipeSecrets();
      return view();
    }
    if (typeof row.id === 'string') {
      if (approvalId && row.id !== approvalId) invalid();
      approvalId = row.id;
    }
    if (row.requesterPublic && row.requesterPublic !== publicKey?.toString('base64') ||
        row.requesterNonce && row.requesterNonce !== nonce?.toString('base64')) invalid();
    if (row.approverPublic || row.approverNonce) pinOffer(row.approverPublic, row.approverNonce);
    if (row.algorithm && row.wrapped) {
      if (envelope && (envelope.algorithm !== row.algorithm || envelope.wrapped !== row.wrapped)) invalid();
      envelope = { algorithm: row.algorithm, wrapped: row.wrapped };
    }
    return view();
  }
  function pinOffer(publicText, nonceText) {
    const nextPublic = decodeCanonicalBase64(publicText, 32);
    const nextNonce = decodeCanonicalBase64(nonceText, 32);
    if (!nextPublic || !nextNonce || !usablePublicKey(nextPublic)) {
      zero(nextPublic); zero(nextNonce);
      invalid('invalid_approval');
    }
    if (offer && (!offer.publicKey.equals(nextPublic) || !offer.nonce.equals(nextNonce))) {
      zero(nextPublic); zero(nextNonce);
      invalid();
    }
    try { zero(agreement(privateKey, nextPublic)); }
    catch { zero(nextPublic); zero(nextNonce); invalid('invalid_approval'); }
    zero(offer?.publicKey); zero(offer?.nonce);
    offer = { publicKey: nextPublic, nonce: nextNonce };
  }
  async function pause(ms) {
    if (ms <= 0 || !live()) return;
    try { await wait(ms, signal); }
    catch (error) { if (signal?.aborted || cancelled) return; throw error; }
  }
  function throttledGet(path) {
    const run = getChain.then(async () => {
      if (!within()) { outcome = outcome ?? 'expired'; wipeSecrets(); return null; }
      const floor = Math.max(lastGet === null ? 0 : lastGet + POLL_MS, retryAt);
      if (floor > now()) await pause(floor - now());
      if (!live() || !within()) { outcome = outcome ?? (within() ? null : 'expired'); if (!within()) wipeSecrets(); return null; }
      lastGet = now();
      try { return await client.request(path, { method: 'GET', signal }); }
      catch (error) {
        if (httpFailure(error) && error.status === 429) {
          retryAt = now() + Math.max(POLL_MS, (error.retryAfter ?? 0) * 1000);
          return null;
        }
        throw error;
      }
    });
    getChain = run.then(() => {}, () => {});
    return run;
  }
  async function reveal() {
    if (!offer || !publicKey || !nonce || revealed) return;
    const payload = { requesterPublic: Buffer.from(publicKey).toString('base64'), requesterNonce: Buffer.from(nonce).toString('base64') };
    try {
      const row = await client.request(`/v1/key-approvals/${encodeURIComponent(approvalId)}/reveal`, { method: 'POST', body: payload, signal });
      if (!live() || !within()) return;
      revealed = true;
      remember(row);
      if (!live()) return;
      code = approvalCode(publicKey, offer.publicKey, nonce, offer.nonce);
    } catch (error) {
      if (error?.status === 409 && error.code === 'approval_conflict') {
        const row = await throttledGet(`/v1/key-approvals/${encodeURIComponent(approvalId)}`);
        if (!live() || !within()) return;
        if (row) remember(row);
        if (row?.requesterPublic === payload.requesterPublic && row?.requesterNonce === payload.requesterNonce) {
          revealed = true;
          code = approvalCode(publicKey, offer.publicKey, nonce, offer.nonce);
          return;
        }
        outcome = 'conflict';
        wipeSecrets();
        return;
      }
      throw error;
    }
  }
  async function put() {
    return client.request(`/v1/key-approval-requests/${encodeURIComponent(requestId)}`, { method: 'PUT', body, signal });
  }
  async function readRequest() {
    return throttledGet(`/v1/key-approval-requests/${encodeURIComponent(requestId)}`);
  }
  function release() { wipeSecrets(); requestId = null; body = null; }
  // First creation, or recovery of an uncertain one: the same UUID, private pair, nonce and body every time.
  async function createOrRecover(first) {
    let row;
    try {
      if (first) row = await put();
      else {
        try {
          row = await readRequest();
          if (!row) return view();
        } catch (error) {
          if (httpFailure(error) && error.status === 404 && within()) row = await put();
          else throw error;
        }
      }
    } catch (error) {
      if (cancelled || signal.aborted) return view();
      if (httpFailure(error)) {
        if (error.code === 'approval_limit') { release(); return { state: 'key-required', outcome: 'approval-limit', stored: false, remote: null, expiresAt: null }; }
        if (error.code === 'approval_conflict') { outcome = 'conflict'; wipeSecrets(); return view(); }
        if (error.status === 404) { outcome = 'forgotten'; wipeSecrets(); return view(); }
        if (error.status === 429) {
          retryAt = now() + Math.max(POLL_MS, (error.retryAfter ?? 0) * 1000);
          release();
          return { state: 'key-required', outcome: 'rate-limited', stored: false, remote: null, expiresAt: null, retryAfter: error.retryAfter ?? null };
        }
      }
      throw error;
    }
    if (!live() || !within()) return view();
    created = true;
    return remember(row);
  }

  return {
    view,
    get stored() { return stored; },
    async available() { return approverAvailable(client); },
    async start() {
      if (requestId && !outcome) return view();
      if (await this.available() !== true) return { state: 'key-required', outcome: 'approval-unavailable', stored: false, remote: null, expiresAt: null };
      if (!live() || options.current?.() === false) return view();
      const generated = options.generate?.() ?? generateKeyPairSync('x25519');
      privateKey = generated.privateKey;
      publicKey = Buffer.from(publicRaw(privateKey));
      nonce = options.nonce ? Buffer.from(options.nonce) : randomBytes(32);
      if (!usablePublicKey(publicKey) || nonce.length !== 32) fail('invalid_approval', 'The approval request is invalid.');
      requestId = options.requestId ?? randomUUID();
      startedAt = now();
      expiresAt = deadline();
      body = { commit: approvalCommitment(publicKey, nonce).toString('base64'), label: options.label ?? approvalLabel(options.platform) };
      const uncertain = error => (networkFailure(error) || error.status >= 500) && !cancelled && !signal.aborted;
      try { return await createOrRecover(true); }
      catch (error) {
        if (!uncertain(error)) throw error;
      }
      // A lost answer leaves creation uncertain: read or repeat the identical request once. Inspecting continues the recovery.
      try { return await createOrRecover(false); }
      catch (error) {
        if (!uncertain(error)) throw error;
        return view();
      }
    },
    async inspect() {
      return stepLock(async () => {
        if (!requestId || outcome || !within()) {
          if (requestId && !outcome && !within()) { outcome = 'expired'; wipeSecrets(); }
          return view();
        }
        if (secretsLost) { outcome = 'forgotten'; return view(); }
        if (!created) return createOrRecover(false);
        const path = approvalId ? `/v1/key-approvals/${encodeURIComponent(approvalId)}` : `/v1/key-approval-requests/${encodeURIComponent(requestId)}`;
        try {
          const row = await throttledGet(path);
          if (!live()) return view();
          if (!row) return view();
          remember(row);
          if (live() && offer && approvalId && !revealed && !envelope) await reveal();
        } catch (error) {
          if (httpFailure(error) && error.status === 404) {
            if (!approvalId) { outcome = 'ended'; wipeSecrets(); return view(); }
            try {
              const receipt = await readRequest();
              if (receipt) return remember(receipt);
            } catch (readError) {
              if (!(httpFailure(readError) && readError.status === 404)) throw readError;
            }
            outcome = 'ended';
            wipeSecrets();
            return view();
          }
          throw error;
        }
        return view();
      });
    },
    async openKey() {
      if (!envelope || !privateKey || !offer || !publicKey || !nonce) fail('invalid_approval', 'The approval request is invalid.');
      const key = openApprovalEnvelope(envelope, privateKey, {
        accountId, id: approvalId, requesterPublic: publicKey, approverPublic: offer.publicKey, requesterNonce: nonce, approverNonce: offer.nonce,
      });
      if (cancelled || secretsLost || !live()) { zero(key); return null; }
      return key;
    },
    async accept(saveKey) {
      if (stored) return true;
      const key = await this.openKey();
      if (!key) return false;
      try {
        return await lock(async () => {
          if (stored) return true;
          if (!live() || !within() || options.current?.() === false) return false;
          await saveKey(key);
          stored = true;
          wipeSecrets();
          return true;
        });
      } finally { zero(key); }
    },
    async consume() {
      if (!stored || !approvalId) return false;
      try {
        await client.request(`/v1/key-approvals/${encodeURIComponent(approvalId)}/consume`, { method: 'POST' });
        return true;
      } catch (error) {
        if (httpFailure(error) && error.status === 404) return true;
        throw error;
      }
    },
    async cancel() {
      cancelled = true;
      controller.abort();
      const id = requestId;
      await lock(async () => { wipeSecrets(); });
      if (!id) { remoteDeleted = false; return view(); }
      try {
        await client.request(`/v1/key-approval-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
        remoteDeleted = true;
      } catch (error) {
        remoteDeleted = false;
        if (networkFailure(error) || (httpFailure(error) && (error.status === 404 || error.code === 'acceptance_required'))) return view();
        throw error;
      }
      return view();
    },
    async discardSecrets() {
      secretsLost = true;
      return this.cancel();
    },
    sameBody(next) { return !!body && next?.commit === body.commit && next?.label === body.label; },
    body: () => body ? { ...body } : null,
    requestId: () => requestId,
  };
}
