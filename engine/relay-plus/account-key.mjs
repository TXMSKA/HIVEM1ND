import { createDecipheriv, pbkdf2 } from 'node:crypto';
import { CoreError } from '../service/identity.mjs';

export const PASSWORD_ALGORITHM = 'QNT_PASSWORD_PBKDF2_SHA256_AES256GCM_V1';
export const PASSWORD_ITERATIONS = 600_000;
const WRAPPED_LENGTH = 81;

function fail(code, message) { throw new CoreError(422, code, message); }

// Canonical padded base64 only. Node's decoder accepts unpadded and dirty input, which the contract rejects.
export function decodeCanonicalBase64(value, length) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return null;
  if (length !== undefined && bytes.length !== length) return null;
  return bytes;
}

export function passwordCodePoints(password) {
  if (typeof password !== 'string') return null;
  return [...password.normalize('NFC')].length;
}

function deriveKey(passwordBytes, salt) {
  return new Promise((resolve, reject) => {
    pbkdf2(passwordBytes, salt, PASSWORD_ITERATIONS, 32, 'sha256', (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export const HANDOFF_ALGORITHM = 'QNT_APP_KEY_HANDOFF_AES256GCM_V1';

// Setup key handoff: K sealed by the site for one authorization attempt under the app's fresh 32-byte secret.
// The additional data binds the account and the exact launch, so a handoff for another account or attempt never opens.
export function openHandoffEnvelope(envelope, secret, { accountId, appId, clientId = null, redirectUri, codeChallenge, state }) {
  if (envelope?.algorithm !== HANDOFF_ALGORITHM) fail('unsupported_key_format', 'The key format is not supported.');
  const wrapped = decodeCanonicalBase64(envelope.wrapped, 61);
  if (!wrapped || wrapped[0] !== 0x01 || !(secret instanceof Uint8Array) || secret.length !== 32 || typeof accountId !== 'string' || !accountId) {
    wrapped?.fill(0);
    fail('invalid_key_envelope', 'The key envelope is invalid.');
  }
  let plain = null, partial = null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, wrapped.subarray(1, 13));
    decipher.setAAD(Buffer.from(JSON.stringify(['cosmic-app-key-handoff-v1', accountId, appId, clientId, redirectUri, codeChallenge, state])));
    decipher.setAuthTag(wrapped.subarray(45));
    try { partial = decipher.update(wrapped.subarray(13, 45)); plain = Buffer.concat([partial, decipher.final()]); }
    catch { fail('key_authentication_failed', 'The account key could not be opened.'); }
    if (plain.length !== 32) fail('key_authentication_failed', 'The account key could not be opened.');
    return Buffer.from(plain);
  } finally { plain?.fill(0); partial?.fill(0); wrapped.fill(0); }
}

// Opening an existing envelope is 1 to 128 NFC code points. Creation on the site stays 15 to 128.
export async function openPasswordEnvelope(envelope, password, accountId, options = {}) {
  if (envelope?.algorithm !== PASSWORD_ALGORITHM) fail('unsupported_key_format', 'The key format is not supported.');
  const wrapped = decodeCanonicalBase64(envelope.wrapped, WRAPPED_LENGTH);
  if (!wrapped) fail('invalid_key_envelope', 'The key envelope is invalid.');
  // The iteration count is fixed. A hostile envelope must not choose the work factor.
  if (wrapped[0] !== 0x01 || wrapped.readUInt32BE(1) !== PASSWORD_ITERATIONS) {
    wrapped.fill(0);
    fail('unsupported_key_format', 'The key format is not supported.');
  }
  const points = passwordCodePoints(password);
  if (points === null || points < 1 || points > 128 || typeof accountId !== 'string' || !accountId) {
    wrapped.fill(0);
    fail('key_authentication_failed', 'The account key could not be opened.');
  }
  const normalized = Buffer.from(password.normalize('NFC'));
  const derive = options.derive ?? deriveKey;
  let wrapping = null;
  let plain = null;
  let partial = null;
  try {
    wrapping = await derive(normalized, wrapped.subarray(5, 21));
    if (!(wrapping instanceof Uint8Array) || wrapping.length !== 32) fail('key_authentication_failed', 'The account key could not be opened.');
    const decipher = createDecipheriv('aes-256-gcm', wrapping, wrapped.subarray(21, 33));
    decipher.setAAD(Buffer.from(JSON.stringify([PASSWORD_ALGORITHM, accountId, 'password', 1, PASSWORD_ITERATIONS])));
    decipher.setAuthTag(wrapped.subarray(65));
    try { partial = decipher.update(wrapped.subarray(33, 65)); plain = Buffer.concat([partial, decipher.final()]); }
    catch { fail('key_authentication_failed', 'The account key could not be opened.'); }
    if (plain.length !== 32) fail('key_authentication_failed', 'The account key could not be opened.');
    return Buffer.from(plain);
  } finally {
    normalized.fill(0);
    wrapping?.fill?.(0);
    plain?.fill?.(0);
    partial?.fill?.(0);
    wrapped.fill(0);
  }
}
