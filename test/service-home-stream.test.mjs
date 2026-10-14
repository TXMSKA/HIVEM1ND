import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';
import { eligibleAddresses } from '../engine/service/home.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { advanceClock, dispose, makeCoreFixture } from './core-fixture.mjs';

for (const reason of ['closed', 'replaced', 'expired']) {
  test(`Home ${reason} delivers a disabled notice before closing an authenticated phone stream`, async (t) => {
    const address = eligibleAddresses()[0];
    assert.ok(address, 'a private interface is required');
    const fixture = await makeCoreFixture();
    const core = await composeCore({
      store: fixture.store,
      paths: fixture.paths,
      now: () => fixture.clock.now,
      interfaces: () => [address],
    });
    t.after(async () => {
      await core.http.close();
      await dispose(fixture);
    });
    const localOrigin = `http://127.0.0.1:${core.http.port}`;
    const local = await call(localOrigin, 'POST', '/api/v1/auth/local', core.bootstrap.secret, {
      embedded: false, hostOrigin: null, look: null, language: null,
    });
    assert.equal(local.status, 201);
    const desktop = local.json.data.token;
    const opened = await call(localOrigin, 'POST', '/api/v1/settings/home-network', desktop, {
      enabled: true, addresses: [address.address],
    });
    assert.equal(opened.status, 201);
    const grant = opened.json.data;
    const origin = grant.addresses[0].origin;
    assert.equal((await call(origin, 'GET', '/api/v1/view')).status, 401);
    const exchanged = await call(origin, 'POST', '/api/v1/auth/home', null, { key: grant.key });
    assert.equal(exchanged.status, 200);
    const phone = exchanged.json.data.token;
    const stream = await openStream(origin, phone);
    const localStream = await openStream(localOrigin, phone);
    t.after(() => stream.close());
    t.after(() => localStream.close());
    const start = Date.now();
    if (reason === 'expired') {
      advanceClock(fixture, 43200000);
      const settings = await call(localOrigin, 'GET', '/api/v1/settings', desktop);
      assert.equal(settings.status, 200);
      assert.equal(settings.json.data.home.enabled, false);
    } else {
      const changed = await call(localOrigin, 'POST', '/api/v1/settings/home-network', desktop, {
        enabled: reason === 'replaced', addresses: [address.address],
      });
      assert.equal(changed.status, reason === 'replaced' ? 201 : 200);
      assert.equal(changed.json.data.enabled, reason === 'replaced');
      if (reason === 'replaced') {
        const next = await call(changed.json.data.addresses[0].origin, 'POST', '/api/v1/auth/home', null, { key: changed.json.data.key });
        assert.equal(next.status, 200);
        assert.equal(core.credentials.verify(next.json.data.token).audience, 'phone');
        assert.notEqual(changed.json.data.key, grant.key);
      }
    }
    await Promise.all([stream.ended, localStream.ended]);
    assert.equal(Date.now() - start < 2000, true);
    for (const endedStream of [stream, localStream]) {
      const terminal = endedStream.frames.filter((frame) => frame.name === 'home.changed');
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].data.data.reason, reason);
      assert.deepEqual(terminal[0].data.data.home, {
        enabled: false, openedAt: null, expiresAt: null, addresses: [], remainingSeconds: 0,
      });
      const serialized = JSON.stringify(endedStream.frames);
      assert.equal(serialized.includes(grant.key), false);
      assert.equal(serialized.includes(grant.shortCode), false);
      assert.equal(serialized.includes(phone), false);
    }
    assert.throws(() => core.credentials.verify(phone), { status: 401, code: 'invalid_session' });
    assert.equal((await call(localOrigin, 'GET', '/api/v1/view', phone)).status, 401);
  });
}

test('a restarted service retains no home grant and rejects the former phone credential', async t => {
  const address = eligibleAddresses()[0]; assert.ok(address);
  const fixture = await makeCoreFixture(); t.after(() => dispose(fixture));
  const options = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, interfaces: () => [address] };
  const first = await composeCore(options); t.after(() => first.http.close());
  const origin = `http://127.0.0.1:${first.http.port}`;
  const local = await call(origin, 'POST', '/api/v1/auth/local', first.bootstrap.secret, { embedded: false, hostOrigin: null, look: null, language: null });
  const grant = (await call(origin, 'POST', '/api/v1/settings/home-network', local.json.data.token, { enabled: true })).json.data;
  const phone = (await call(grant.addresses[0].origin, 'POST', '/api/v1/auth/home', null, { key: grant.key })).json.data.token;
  await first.http.close();
  assert.throws(() => first.credentials.verify(phone), { code: 'invalid_session' });
  const next = await composeCore(options); t.after(() => next.http.close());
  const nextOrigin = `http://127.0.0.1:${next.http.port}`;
  assert.equal((await call(nextOrigin, 'GET', '/api/v1/view', phone)).status, 401);
  const desktop = (await call(nextOrigin, 'POST', '/api/v1/auth/local', next.bootstrap.secret, { embedded: false, hostOrigin: null, look: null, language: null })).json.data.token;
  assert.equal((await call(nextOrigin, 'GET', '/api/v1/settings', desktop)).json.data.home.enabled, false);
});

function call(origin, method, target, token = null, body = undefined) {
  const url = new URL(target, origin);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      agent: false,
      headers: {
        origin,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...(method === 'POST' && target.includes('/settings/') ? { 'idempotency-key': randomUUID() } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(2000, () => req.destroy(new Error('Home request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

function openStream(origin, token) {
  return new Promise((resolve, reject) => {
    let response;
    const frames = [];
    let buffer = '';
    let ready = false;
    let finish;
    let fail;
    const ended = new Promise((resolveEnd, rejectEnd) => { finish = resolveEnd; fail = rejectEnd; });
    ended.catch(() => {});
    const req = request(new URL('/api/v1/events', origin), {
      agent: false,
      headers: { origin, authorization: `Bearer ${token}` },
    }, (res) => {
      response = res;
      assert.equal(res.statusCode, 200);
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n');
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const name = raw.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
          const data = raw.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!name || !data) continue;
          frames.push({ name, data: JSON.parse(data) });
          if (name === 'stream.ready' && !ready) {
            ready = true;
            resolve({ frames, ended, close: () => { clearTimeout(timer); req.destroy(); res.destroy(); } });
          }
        }
      });
      res.on('end', () => { clearTimeout(timer); finish(); });
      res.on('aborted', () => failed(new Error('Home stream ended without flushing its response')));
      res.on('error', failed);
    });
    const failed = (error) => {
      clearTimeout(timer);
      if (!ready) reject(error);
      fail(error);
      req.destroy();
      response?.destroy();
    };
    const timer = setTimeout(() => failed(new Error('Home stream stayed open')), 3000);
    req.on('error', failed);
    req.end();
  });
}
