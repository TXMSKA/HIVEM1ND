import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { CoreError } from '../service/identity.mjs';
import { readAccountKey, writeAccountKey } from './cosmic-keys/index.mjs';

const PHRASE = 'QNT_PBKDF2_SHA256_AES256GCM_V1';
const SYMMETRIC = 'QNT_AES256GCM_V1';
const APPROVAL = 'QNT_X25519_HKDF_SHA256_AES256GCM_V1';
function fail(code, message) { throw new CoreError(422, code, message); }
function bytes(value) {
  if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) fail('invalid_key_envelope', 'The key envelope is invalid.');
  return Buffer.from(value, 'base64');
}
function seal(key, plaintext, aad) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
function open(key, value, aad) {
  try {
    if (value.length < 28) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]);
  } catch { fail('key_authentication_failed', 'The recovery phrase or key envelope is invalid.'); }
}
function envelope(algorithm, value) { return { algorithm, wrapped: Buffer.concat([Buffer.from([1]), value]).toString('base64') }; }
function unwrap(value, algorithm) {
  if (value?.algorithm !== algorithm) fail('invalid_key_envelope', 'The key envelope algorithm is invalid.');
  const data = bytes(value.wrapped);
  if (data[0] !== 1 || data.length > 4096) fail('invalid_key_envelope', 'The key envelope version is invalid.');
  return data.subarray(1);
}
const words = new Set(`acorn amber anchor apple apron arrow atlas autumn bamboo banana basket beach beacon berry birch blanket blossom blue boat book bottle branch breeze bridge brook brush bubble bucket butter button cabin cactus camel candle canyon canvas carrot castle cedar cherry chest circle citrus clay cliff cloud clover coast cocoa coconut coral cotton crane creek crown crystal daisy dawn deer desert diamond dolphin dove dragon dream drift drum dune eagle earth echo elm ember emerald feather fern field finch fire flame flower flute forest fox frost fruit garden gate gem ginger glass globe gold goose grape grass green grove harbor hare harvest hazel heart heron hill honey horizon horse house ice iris island ivory jade jar jasmine jewel journey jungle kettle key kite kiwi ladder lake lantern leaf lemon leopard light lilac lily lime linen lion lotus lunar maple marble meadow melon metal mint mirror mist moon moss mountain mouse music nectar nest net night north oak ocean olive orange orchid otter owl palm panda paper peach pearl pebble pelican pepper petal piano pine pink planet plum pond poppy prairie prism pumpkin purple quartz quilt rabbit rain rainbow raven reef ribbon rice ridge river robin rock rose ruby saddle sage sail salmon sand sapphire scarf sea seed shade shadow shell shore silver sky slate snow soap south sparrow spice spring spruce square star stone storm stream sugar summer sun sunrise sunset swan sweet table teal temple thorn thunder tide tiger timber toast tomato tower trail tree tulip turtle valley velvet vine violet walnut water wave wheat white`.split(' '));
function phraseKey(phrase, salt) {
  const normalized = (Array.isArray(phrase) ? phrase : typeof phrase === 'string' ? phrase.trim().split(/\s+/) : []).map(word => word.normalize('NFKD').trim().toLowerCase());
  if (normalized.length !== 24 || normalized.some(word => !words.has(word))) fail('invalid_recovery_phrase', 'The Cosmic recovery phrase must contain its 24 valid words.');
  return pbkdf2Sync(normalized.join(' '), salt, 600000, 32, 'sha256');
}
function publicBytes(key) { return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32); }
// The person compares this on both screens: the first 10 bytes of SHA-256 in base32, as 4 groups of 4 (keys.md).
function fingerprint(key) {
  const digest = createHash('sha256').update(bytes(key)).digest().subarray(0, 10);
  let bits = '';
  for (const byte of digest) bits += byte.toString(2).padStart(8, '0');
  const text = bits.match(/.{5}/g).map(chunk => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(chunk, 2)]).join('');
  return text.match(/.{4}/g).join(' ');
}
function pair() {
  const generated = generateKeyPairSync('x25519');
  return { privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey: publicBytes(generated.privateKey).toString('base64') };
}
function shared(privateKey, publicKey, ephemeral, recipient) {
  const raw = bytes(publicKey);
  if (raw.length !== 32) fail('invalid_approval', 'The approval public key is invalid.');
  const secret = diffieHellman({ privateKey: createPrivateKey({ key: bytes(privateKey), type: 'pkcs8', format: 'der' }), publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), type: 'spki', format: 'der' }) });
  try { return Buffer.from(hkdfSync('sha256', secret, Buffer.concat([ephemeral, recipient]), APPROVAL, 32)); }
  finally { secret.fill(0); }
}
function material(value) {
  if (!value || typeof value.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.keyId) || typeof value.relanId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.relanId) || !(value.key instanceof Uint8Array) || value.key.length !== 32) fail('invalid_mind_key', 'The M1ND key is invalid.');
  return { keyId: value.keyId, relanId: value.relanId, key: Buffer.from(value.key) };
}

export function createRelayPlusKeys({ client, loadState, saveState, deviceId, mindId, accountId, accountKeyStoreFile, existingMindKey, loadMindKey, saveMindKey, accountKeyStore = { readAccountKey, writeAccountKey } }) {
  let state, accountKey, mindKey, requiredState = { state: 'key-required', code: 'recovery_phrase_required' };
  const storeOptions = { file: accountKeyStoreFile, writer: 'hivem1nd', origin: 'hivem1nd' };
  const context = purpose => `cosmic/account/${accountId}/hivem1nd/mind/${mindId}/${purpose}`;
  const approvalContext = (id, recipient) => `cosmic/account/${accountId}/hivem1nd/approval:${id}:${recipient}`;
  async function local() { return state ??= await loadState() ?? {}; }
  function derived(purpose) {
    if (!accountKey) fail('encryption_key_missing', 'Unlock the Cosmic account key first.');
    return Buffer.from(hkdfSync('sha256', accountKey, Buffer.alloc(0), `cosmic/account/hivem1nd/${purpose}`, 32));
  }
  async function install(value) {
    const next = material(value);
    if (!mindKey) {
      const retained = existingMindKey ?? await loadMindKey?.();
      if (retained) mindKey = material(retained);
    }
    if (mindKey && (mindKey.keyId !== next.keyId || mindKey.relanId !== next.relanId || !mindKey.key.equals(next.key))) fail('mind_key_conflict', 'This M1ND already has a different key.');
    if (mindKey) return { keyId: mindKey.keyId };
    await saveMindKey?.(next); mindKey = next;
    return { keyId: next.keyId };
  }
  async function saveAccount(key) {
    if (key.length !== 32) fail('invalid_account_key', 'The account key must contain 32 bytes.');
    await accountKeyStore.writeAccountKey(accountId, key, storeOptions);
    accountKey?.fill(0); accountKey = Buffer.from(key);
    return { state: 'account-key-ready' };
  }
  return {
    async initializeDevice() { return { state: 'approval-available' }; },
    async unlock() {
      const key = await accountKeyStore.readAccountKey(accountId, storeOptions);
      if (!key) {
        const found = (await client.request('/v1/keys')).keys.find(item => item.recipient === 'phrase');
        requiredState = found
          ? { state: 'key-required', code: 'recovery_phrase_required', message: 'Enter the Cosmic account recovery phrase or approve this computer from a signed-in computer.' }
          : { state: 'key-required', code: 'recovery_phrase_setup_required', message: 'Open the Cosmic account site and save the account recovery phrase before using Relay+.' };
        return false;
      }
      accountKey = Buffer.from(key);
      const retained = existingMindKey ?? await loadMindKey?.();
      if (retained) mindKey = material(retained);
      return true;
    },
    async createMindKey() {
      derived('mind-key');
      if (!mindKey) await install(existingMindKey ?? await loadMindKey?.() ?? { keyId: randomUUID(), relanId: randomUUID(), key: randomBytes(32) });
      return { keyId: mindKey.keyId };
    },
    async recover(phrase) {
      const found = (await client.request('/v1/keys')).keys.find(item => item.recipient === 'phrase');
      if (!found) fail('recovery_phrase_setup_required', 'Open the Cosmic account site and save the account recovery phrase before using Relay+.');
      const data = unwrap(found, PHRASE);
      if (data.length !== 76) fail('invalid_key_envelope', 'The recovery envelope is invalid.');
      const key = open(phraseKey(phrase, data.subarray(0, 16)), data.subarray(16), PHRASE);
      try { return await saveAccount(key); } finally { key.fill(0); }
    },
    headKey() { return derived('heads'); },
    sealMindKey() {
      if (!mindKey) fail('encryption_key_missing', 'The M1ND key is unavailable.');
      return envelope(SYMMETRIC, seal(derived('mind-key'), Buffer.from(JSON.stringify({ ...mindKey, key: mindKey.key.toString('base64') })), context('mind-key')));
    },
    async openMindKey(value) {
      let decoded;
      try { decoded = JSON.parse(open(derived('mind-key'), unwrap(value, SYMMETRIC), context('mind-key')).toString('utf8')); }
      catch (error) {
        if (error instanceof CoreError) throw error;
        fail('invalid_mind_key', 'The sealed M1ND key is invalid.');
      }
      return install({ ...decoded, key: bytes(decoded.key) });
    },
    async createApprovalRequest(approverDeviceId) {
      const current = await local(), temporary = pair();
      const request = { type: 'key-request', id: randomUUID(), accountId, deviceId, publicKey: temporary.publicKey };
      current.pending = { ...temporary, id: request.id, approverDeviceId };
      await saveState(current);
      return { recipient: approverDeviceId, fingerprint: fingerprint(temporary.publicKey), ciphertext: Buffer.from(JSON.stringify(request)) };
    },
    async inspectApproval(value, senderDeviceId) {
      let request;
      try { request = JSON.parse(Buffer.from(value).toString('utf8')); } catch { fail('invalid_approval', 'The approval request is invalid.'); }
      if (request.type !== 'key-request' || request.accountId !== accountId || request.deviceId !== senderDeviceId || typeof request.id !== 'string' || bytes(request.publicKey).length !== 32) fail('invalid_approval', 'The approval request does not match its sender.');
      return { ...request, fingerprint: fingerprint(request.publicKey) };
    },
    async approve(value, { senderDeviceId, fingerprint: confirmed }) {
      if (!accountKey) fail('encryption_key_missing', 'Unlock this machine before approving another machine.');
      const request = await this.inspectApproval(value, senderDeviceId);
      if (confirmed !== request.fingerprint) fail('approval_confirmation_required', 'Confirm the fingerprint shown on both machines before approval.');
      const temporary = pair(), ephemeral = bytes(temporary.publicKey), recipient = bytes(request.publicKey);
      const key = shared(temporary.privateKey, request.publicKey, ephemeral, recipient);
      const wrapped = envelope(APPROVAL, Buffer.concat([ephemeral, seal(key, accountKey, approvalContext(request.id, request.deviceId))]));
      key.fill(0);
      return { recipient: request.deviceId, ciphertext: Buffer.from(JSON.stringify({ type: 'key-approved', id: request.id, ...wrapped })) };
    },
    async acceptApproval(value, senderDeviceId) {
      const current = await local(), pending = current.pending;
      let response;
      try { response = JSON.parse(Buffer.from(value).toString('utf8')); } catch { fail('invalid_approval', 'The approval response is invalid.'); }
      if (!pending || pending.approverDeviceId !== senderDeviceId || response.type !== 'key-approved' || response.id !== pending.id) fail('invalid_approval', 'The approval does not match a pending request.');
      const data = unwrap(response, APPROVAL);
      if (data.length !== 92) fail('invalid_approval', 'The approval response is invalid.');
      const key = shared(pending.privateKey, data.subarray(0, 32).toString('base64'), data.subarray(0, 32), bytes(pending.publicKey));
      const plaintext = open(key, data.subarray(32), approvalContext(pending.id, deviceId));
      try { await saveAccount(plaintext); } finally { plaintext.fill(0); key.fill(0); }
      delete current.pending; await saveState(current);
      return { state: 'account-key-ready' };
    },
    keyProvider(id) { return mindKey?.keyId === id ? Buffer.from(mindKey.key) : null; },
    get requiredState() { return { ...requiredState }; },
    get encryption() { return { algorithm: 'aes-256-gcm', keyId: mindKey?.keyId ?? 'pending' }; },
    lock() { accountKey?.fill(0); mindKey?.key.fill(0); accountKey = null; mindKey = null; state = null; },
  };
}

// Test/account-creation helper. ONEM1ND never publishes this account-owned recipient.
export function createRecoveryEnvelope({ phrase, key = randomBytes(32) }) {
  if (!(key instanceof Uint8Array) || key.length !== 32) fail('invalid_account_key', 'The account key must contain 32 bytes.');
  const salt = randomBytes(16);
  return { key: Buffer.from(key), envelope: envelope(PHRASE, Buffer.concat([salt, seal(phraseKey(phrase, salt), key, PHRASE)])) };
}
