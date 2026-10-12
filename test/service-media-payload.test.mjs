import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addScreen, newSketch } from '../features/blueprint/review/sketch-format.mjs';
import { createBoard } from '../engine/service/editors.mjs';
import { composeCore } from '../engine/service/service.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';
import { LOSSLESS_WEBP, WEBP } from './media-fixture.mjs';

test('HTTP rejects header-only WebP before asset quota or storage, and reads genuine images', async t => {
  const fixture = await makeCoreFixture();
  const project = path.join(fixture.root, 'shop');
  await mkdir(project);
  const options = { store: fixture.store, paths: fixture.paths, now: () => fixture.clock.now, projects: [{ name: 'shop', localPath: project }], clients: [] };
  const core = await composeCore(options);
  t.after(async () => { await core.http.close(); await dispose(fixture); });
  const board = newSketch('payload', 'Payload');
  addScreen(board, { title: 'Payload', x: 0, y: 0 });
  const created = await createBoard({ ...options, sync: core.runtime.sync, pulse: core.runtime.pulse }, { project: 'shop', document: board });
  const origin = `http://127.0.0.1:${core.http.port}`;
  const token = core.credentials.issue({ audience: 'desktop', unitId: 'root:master', expiresAt: '2027-01-01T00:00:00.000Z' }).token;
  const route = `/api/v1/editors/${created.id}/assets`;
  const request = (method, target, body) => fetch(`${origin}${target}`, { method, headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  const quota = path.join(fixture.paths.mind, 'user/relay/editors/quotas/shop.json');
  const directory = path.join(project, 'docs/flows/assets');
  const snapshot = async () => ({ quota: await readFile(quota, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }), files: (await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).sort() });
  const vp8 = Buffer.alloc(11); vp8[0] = 0x10; vp8[3] = 0x9d; vp8[4] = 1; vp8[5] = 0x2a; vp8.writeUInt16LE(1, 6); vp8.writeUInt16LE(1, 8);
  const wrap = (kind, data) => { const bytes = Buffer.alloc(20 + data.length + (data.length % 2)); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write(`WEBP${kind}`, 8); bytes.writeUInt32LE(data.length, 16); data.copy(bytes, 20); return bytes; };
  for (const bytes of [wrap('VP8 ', vp8), wrap('VP8L', Buffer.from([0x2f, 0, 0, 0, 0, 1]))]) {
    const before = await snapshot();
    const response = await request('POST', route, { contentType: 'image/webp', bytesBase64: bytes.toString('base64') });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'invalid_asset');
    assert.deepEqual(await snapshot(), before);
  }
  for (const bytes of [WEBP, LOSSLESS_WEBP]) {
    const response = await request('POST', route, { contentType: 'image/webp', bytesBase64: bytes.toString('base64') });
    assert.equal(response.status, 201);
    const uploaded = (await response.json()).data;
    const read = await request('GET', `${route}/${uploaded.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('content-type'), 'image/webp');
    assert.ok(Buffer.from(await read.arrayBuffer()).equals(bytes));
  }
  assert.equal(JSON.parse(await readFile(quota, 'utf8')).count, 2);
});
