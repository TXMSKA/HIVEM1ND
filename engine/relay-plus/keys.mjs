import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { CoreError } from '../service/identity.mjs';
import { openPasswordEnvelope, PASSWORD_ALGORITHM } from './account-key.mjs';
import { readAccountKey, writeAccountKey } from './cosmic-keys/index.mjs';

const PHRASE = 'QNT_PBKDF2_SHA256_AES256GCM_V1';
const SYMMETRIC = 'QNT_AES256GCM_V1';
function fail(code, message) { throw new CoreError(422, code, message); }
function bytes(value) {
  if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) fail('invalid_key_envelope', 'The key envelope is invalid.');
  return Buffer.from(value, 'base64');
}
function seal(key, plaintext, aad) {
  try {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  } finally { key.fill(0); }
}
function open(key, value, aad) {
  let partial;
  try {
    if (value.length < 28) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(value.subarray(-16));
    partial = cipher.update(value.subarray(12, -16));
    return Buffer.concat([partial, cipher.final()]);
  } catch { fail('key_authentication_failed', 'The recovery phrase or key envelope is invalid.'); }
  finally { key.fill(0); partial?.fill(0); }
}
function envelope(algorithm, value) { return { algorithm, wrapped: Buffer.concat([Buffer.from([1]), value]).toString('base64') }; }
function unwrap(value, algorithm) {
  if (value?.algorithm !== algorithm) fail('unsupported_key_format', 'The key format is not supported.');
  const data = bytes(value.wrapped);
  if (data[0] !== 1 || data.length > 4096) fail('unsupported_key_format', 'The key format is not supported.');
  return data.subarray(1);
}
const words = new Set(`acorn amber anchor apple apron arrow atlas autumn bamboo banana basket beach beacon berry birch blanket blossom blue boat book bottle branch breeze bridge brook brush bubble bucket butter button cabin cactus camel candle canyon canvas carrot castle cedar cherry chest circle citrus clay cliff cloud clover coast cocoa coconut coral cotton crane creek crown crystal daisy dawn deer desert diamond dolphin dove dragon dream drift drum dune eagle earth echo elm ember emerald feather fern field finch fire flame flower flute forest fox frost fruit garden gate gem ginger glass globe gold goose grape grass green grove harbor hare harvest hazel heart heron hill honey horizon horse house ice iris island ivory jade jar jasmine jewel journey jungle kettle key kite kiwi ladder lake lantern leaf lemon leopard light lilac lily lime linen lion lotus lunar maple marble meadow melon metal mint mirror mist moon moss mountain mouse music nectar nest net night north oak ocean olive orange orchid otter owl palm panda paper peach pearl pebble pelican pepper petal piano pine pink planet plum pond poppy prairie prism pumpkin purple quartz quilt rabbit rain rainbow raven reef ribbon rice ridge river robin rock rose ruby saddle sage sail salmon sand sapphire scarf sea seed shade shadow shell shore silver sky slate snow soap south sparrow spice spring spruce square star stone storm stream sugar summer sun sunrise sunset swan sweet table teal temple thorn thunder tide tiger timber toast tomato tower trail tree tulip turtle valley velvet vine violet walnut water wave wheat white`.split(' '));
function phraseKey(phrase, salt) {
  const normalized = (Array.isArray(phrase) ? phrase : typeof phrase === 'string' ? phrase.trim().split(/\s+/) : []).map(word => word.normalize('NFKD').trim().toLowerCase());
  if (normalized.length !== 24 || normalized.some(word => !words.has(word))) fail('invalid_recovery_phrase', 'The Cosmic recovery phrase must contain its 24 valid words.');
  return pbkdf2Sync(normalized.join(' '), salt, 600000, 32, 'sha256');
}
function material(value) {
  if (!value || typeof value.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.keyId) || typeof value.relanId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.relanId) || !(value.key instanceof Uint8Array) || value.key.length !== 32) fail('invalid_mind_key', 'The M1ND key is invalid.');
  return { keyId: value.keyId, relanId: value.relanId, key: Buffer.from(value.key) };
}
function blocking(error) {
  return error?.code === 'acceptance_required' || error?.reason === 'device_revoked' || error?.status === 401 || error?.code === 'invalid_grant' || error?.code === 'unauthorized';
}
function described(record, kind) {
  if (!record) return { present: false, format: null, record: null };
  const algorithm = kind === 'password' ? PASSWORD_ALGORITHM : PHRASE;
  const length = kind === 'password' ? 81 : 77;
  if (record.algorithm !== algorithm) return { present: true, format: 'unsupported', record: null };
  try {
    const decoded = bytes(record.wrapped);
    if (decoded.length !== length || decoded[0] !== 1) return { present: true, format: 'unsupported', record: null };
    if (kind === 'password' && decoded.readUInt32BE(1) !== 600000) return { present: true, format: 'unsupported', record: null };
    return { present: true, format: 'supported', record };
  } catch { return { present: true, format: 'unsupported', record: null }; }
}

export function createRelayPlusKeys({ client, loadState, saveState, deviceId, mindId, accountId, accountKeyStoreFile, existingMindKey, loadMindKey, saveMindKey, accountKeyStore = { readAccountKey, writeAccountKey } }) {
  let accountKey, mindKey, snapshot = null, migrated = false, locked = false;
  let requiredState = { state: 'key-required', code: 'account_key_unavailable', methods: { password: false, phrase: false, approval: false }, formats: {} };
  const storeOptions = { file: accountKeyStoreFile, writer: 'hivem1nd', origin: 'hivem1nd' };
  const context = purpose => `cosmic/account/${accountId}/hivem1nd/mind/${mindId}/${purpose}`;
  function derived(purpose) {
    if (!accountKey) fail('encryption_key_missing', 'Unlock the Cosmic account key first.');
    return Buffer.from(hkdfSync('sha256', accountKey, Buffer.alloc(0), `cosmic/account/hivem1nd/${purpose}`, 32));
  }
  function publishRequired(next) {
    const formats = {};
    if (next.password.present) formats.password = next.password.format;
    if (next.phrase.present) formats.phrase = next.phrase.format;
    const methods = {
      password: next.password.format === 'supported',
      phrase: next.phrase.format === 'supported',
      approval: next.approval === true,
    };
    const unsupported = Object.values(formats).includes('unsupported');
    const code = unsupported ? 'unsupported_key_format' : (methods.password || methods.phrase || methods.approval) ? 'key_required' : 'account_key_unavailable';
    requiredState = { state: 'key-required', code, methods, formats };
    return requiredState;
  }
  async function migrate() {
    if (migrated) return;
    migrated = true;
    const loaded = await loadState() ?? {};
    if (!loaded || !Object.hasOwn(loaded, 'pending')) return;
    const next = { ...loaded };
    delete next.pending;
    await saveState(next);
  }
  async function selection(force) {
    if (snapshot && !force) return snapshot;
    const listed = await client.request('/v1/keys');
    const rows = Array.isArray(listed?.keys) ? listed.keys : [];
    let approval = false;
    try {
      const result = await client.request('/v1/key-approvers/availability');
      approval = result?.available === true;
    } catch (error) {
      if (blocking(error)) throw error;
      approval = false;
    }
    snapshot = {
      password: described(rows.find(item => item?.recipient === 'password'), 'password'),
      phrase: described(rows.find(item => item?.recipient === 'phrase'), 'phrase'),
      approval,
    };
    publishRequired(snapshot);
    return snapshot;
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
    if (locked) fail('operation_cancelled', 'The key operation was cancelled.');
    if (!(key instanceof Uint8Array) || key.length !== 32) fail('invalid_account_key', 'The account key must contain 32 bytes.');
    if (accountKey?.length === 32 && accountKey.equals(key)) return { state: 'account-key-ready' };
    const retained = Buffer.from(key);
    try {
      await accountKeyStore.writeAccountKey(accountId, retained, storeOptions);
      accountKey?.fill(0);
      accountKey = retained;
      return { state: 'account-key-ready' };
    } catch (error) { retained.fill(0); throw error; }
  }
  async function retainCopied(key) {
    accountKey = Buffer.from(key);
    key.fill(0);
    const retained = existingMindKey ?? await loadMindKey?.();
    if (retained) mindKey = material(retained);
  }
  return {
    async unlock() {
      await migrate();
      const key = await accountKeyStore.readAccountKey(accountId, storeOptions);
      if (!key) {
        await selection(false);
        return false;
      }
      await retainCopied(key);
      return true;
    },
    async refresh() { return selection(true); },
    async unlockPassword(password, { commit = action => action(), current = () => true } = {}) {
      const found = (await selection(true)).password;
      if (!found.present) fail('account_key_unavailable', 'This account has no envelope for that method.');
      if (found.format !== 'supported') fail('unsupported_key_format', 'The key format is not supported.');
      const key = await openPasswordEnvelope(found.record, password, accountId);
      try { return await commit(() => {
        if (!current()) fail('operation_cancelled', 'The key operation was cancelled.');
        return saveAccount(key);
      }); } finally { key.fill(0); }
    },
    async createMindKey() {
      if (!accountKey) fail('encryption_key_missing', 'Unlock the Cosmic account key first.');
      if (!mindKey) await install(existingMindKey ?? await loadMindKey?.() ?? { keyId: randomUUID(), relanId: randomUUID(), key: randomBytes(32) });
      return { keyId: mindKey.keyId };
    },
    async recover(phrase, { commit = action => action(), current = () => true } = {}) {
      const found = (await selection(true)).phrase;
      if (!found.present) fail('account_key_unavailable', 'This account has no envelope for that method.');
      if (found.format !== 'supported') fail('unsupported_key_format', 'The key format is not supported.');
      const data = unwrap(found.record, PHRASE);
      if (data.length !== 76) fail('unsupported_key_format', 'The key format is not supported.');
      const wrapping = phraseKey(phrase, data.subarray(0, 16));
      let key;
      try {
        key = open(wrapping, data.subarray(16), PHRASE);
        return await commit(() => {
          if (!current()) fail('operation_cancelled', 'The key operation was cancelled.');
          return saveAccount(key);
        });
      } finally { key?.fill(0); wrapping.fill(0); data.fill(0); }
    },
    async saveAccount(key) { return saveAccount(key); },
    headKey() { return derived('heads'); },
    sealMindKey() {
      if (!mindKey) fail('encryption_key_missing', 'The M1ND key is unavailable.');
      const plaintext = Buffer.from(JSON.stringify({ ...mindKey, key: mindKey.key.toString('base64') }));
      try { return envelope(SYMMETRIC, seal(derived('mind-key'), plaintext, context('mind-key'))); }
      finally { plaintext.fill(0); }
    },
    async openMindKey(value) {
      let decoded, plaintext;
      try { plaintext = open(derived('mind-key'), unwrap(value, SYMMETRIC), context('mind-key')); decoded = JSON.parse(plaintext.toString('utf8')); }
      catch (error) {
        if (error instanceof CoreError) throw error;
        fail('invalid_mind_key', 'The sealed M1ND key is invalid.');
      } finally { plaintext?.fill(0); }
      const key = bytes(decoded.key);
      try { return await install({ ...decoded, key }); } finally { key.fill(0); }
    },
    keyProvider(id) { return mindKey?.keyId === id ? Buffer.from(mindKey.key) : null; },
    get requiredState() { return structuredClone(requiredState); },
    get encryption() { return { algorithm: 'aes-256-gcm', keyId: mindKey?.keyId ?? 'pending' }; },
    get ready() { return !locked && Boolean(accountKey && mindKey); },
    lock() { locked = true; accountKey?.fill(0); mindKey?.key.fill(0); accountKey = null; mindKey = null; snapshot = null; },
  };
}

// Test/account-creation helper. ONEM1ND never publishes this account-owned recipient.
export function createRecoveryEnvelope({ phrase, key = randomBytes(32) }) {
  if (!(key instanceof Uint8Array) || key.length !== 32) fail('invalid_account_key', 'The account key must contain 32 bytes.');
  const salt = randomBytes(16);
  return { key: Buffer.from(key), envelope: envelope(PHRASE, Buffer.concat([salt, seal(phraseKey(phrase, salt), key, PHRASE)])) };
}
