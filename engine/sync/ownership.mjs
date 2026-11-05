import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { CoreError, canonicalJson, isUuid } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { writeDurable } from './origin.mjs';

const PROBE_TIMEOUT_MS = 1000;

export async function claimDirectory(directory) {
  await assertNoLinks(directory);
  const claims = path.join(directory, 'owners');
  await mkdir(claims, { recursive: true });
  await assertNoLinks(claims);
  const token = randomUUID();
  const server = createServer((socket) => {
    socket.on('error', () => {});
    socket.end(`${token}\n`, () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  server.unref();
  const port = server.address().port;
  const file = path.join(claims, `${token}.json`);
  const save = (record) => writeDurable({ confineRoot: directory }, file, Buffer.from(canonicalJson(record)), [directory]);
  let releasing;
  const release = () => {
    releasing ??= (async () => {
      try { await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
      finally { await new Promise((resolve) => server.close(resolve)); }
    })();
    return releasing;
  };
  const liveClaims = async () => {
    const records = await Promise.all((await readdir(claims)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).map(async (name) => {
      const claimFile = path.join(claims, name);
      let record;
      try {
        await assertNoLinks(claimFile);
        record = JSON.parse(await readFile(claimFile, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      // Only endpoint claims identify an owner; provisional PID-only records were never shipped.
      if (!isUuid(record?.token) || name !== `${record.token}.json` || typeof record.choosing !== 'boolean'
        || !Number.isSafeInteger(record.ticket) || record.ticket < 0
        || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535) return null;
      if (record.token === token) return null;
      return await claimIsLive(record) ? record : null;
    }));
    return records.filter(Boolean);
  };
  try {
    // Unique atomic tickets remain independent of PID and endpoint reuse.
    await save({ token, port, choosing: true, ticket: 0 });
    const ticket = Math.max(0, ...(await liveClaims()).map((record) => record.ticket)) + 1;
    if (!Number.isSafeInteger(ticket)) throw new CoreError(422, 'corrupt_resource', 'The owner ticket is not valid.');
    await save({ token, port, choosing: false, ticket });
    const deadline = performance.now() + PROBE_TIMEOUT_MS;
    for (;;) {
      const live = await liveClaims();
      if (live.some((record) => !record.choosing && (record.ticket < ticket || record.ticket === ticket && record.token < token))) {
        throw inUse();
      }
      if (!live.some((record) => record.choosing)) return release;
      if (performance.now() >= deadline) throw inUse();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } catch (error) {
    await release();
    throw error;
  }
}

function claimIsLive({ port, token }) {
  return new Promise((resolve) => {
    let response = '';
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (live) => { clearTimeout(timer); socket.destroy(); resolve(live); };
    // Uncertain probes retain ownership; only refusal or a different generation proves staleness.
    const timer = setTimeout(() => finish(true), PROBE_TIMEOUT_MS);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\n')) finish(response.slice(0, response.indexOf('\n')) === token);
      else if (response.length > 64) finish(true);
    });
    socket.on('error', (error) => finish(error.code !== 'ECONNREFUSED'));
    socket.on('end', () => finish(true));
    socket.on('close', () => finish(true));
  });
}

function inUse() {
  return new CoreError(409, 'store_in_use', 'The sync store already has an owner.');
}
