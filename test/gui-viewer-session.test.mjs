import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi, request } from '../gui/app/api.mjs';

function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

const at = (pathname, hash = '') => ({ origin: 'http://127.0.0.1:4310', pathname, search: '', hash });
const history = { state: null, replaceState() {} };

test('a desktop viewer keeps its session through a reload of the same tab', () => {
  const storage = memoryStorage();
  const first = createApi({ location: at('/gui/viewer-1/', '#session=TOKEN-1'), history, storage });
  assert.equal(first.token, 'TOKEN-1');
  // The reload has no fragment: the tab gives the session back.
  const reloaded = createApi({ location: at('/gui/viewer-1/'), history, storage });
  assert.equal(reloaded.token, 'TOKEN-1');
  // Another viewer, or a tab without storage, gets nothing.
  assert.equal(createApi({ location: at('/gui/viewer-2/'), history, storage }).token, null);
  assert.equal(createApi({ location: at('/gui/viewer-1/'), history }).token, null);
});

test('the phone keeps nothing in the tab, and a broken storage changes nothing', () => {
  const storage = memoryStorage();
  createApi({ location: at('/', '#session=PHONE'), history, storage });
  assert.equal(storage.values.size, 0);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.equal(createApi({ location: at('/gui/viewer-1/', '#session=TOKEN-1'), history, storage: broken }).token, 'TOKEN-1');
  assert.equal(createApi({ location: at('/gui/viewer-1/'), history, storage: broken }).token, null);
});

test('a session the service refuses is dropped from the tab', async () => {
  const storage = memoryStorage();
  createApi({ location: at('/gui/viewer-1/', '#session=OLD'), history, storage });
  const api = createApi({ location: at('/gui/viewer-1/'), history, storage,
    fetch: async () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'No session.' } }), { status: 401, headers: { 'content-type': 'application/json' } }) });
  assert.equal(api.token, 'OLD');
  await assert.rejects(request(api, 'GET', '/view'));
  assert.equal(api.token, null);
  assert.equal(storage.getItem('hivem1nd.viewer.viewer-1'), null); // Compatibility: browser storage and desktop bridge names remain stable.
});
