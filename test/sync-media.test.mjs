import { deflateSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertMedia, findConverter } from '../engine/sync/media.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc ^ 0xffffffff;
}

function tinyPng() {
  const raw = Buffer.from([0, 255, 0, 0, 255]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a missing converter preserves media and does not block text', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const empty = path.join(fixture.root, 'empty-path');
  await mkdir(empty);
  const converter = await findConverter({ env: { PATH: empty, Path: empty }, platform: 'win32' });
  assert.equal(converter, null);
  const image = tinyPng();
  const calls = [];
  const absent = await convertMedia({
    bytes: image,
    contentType: 'image/png',
    name: 'assets/photo.png',
  }, {
    converter: null,
    directory: path.join(fixture.root, 'work'),
    handles: fixture.children,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return spawn(command, args, options);
    },
  });
  assert.equal(absent.converted, false);
  assert.ok(absent.bytes.equals(image));
  assert.equal(absent.contentType, 'image/png');
  assert.equal(absent.name, 'assets/photo.png');
  assert.equal(calls.length, 0);
  const text = await convertMedia({
    bytes: Buffer.from('Hello'),
    contentType: 'text/plain',
    name: 'note.txt',
  }, { converter, directory: path.join(fixture.root, 'work'), handles: fixture.children });
  assert.equal(text.bytes.toString(), 'Hello');
  assert.equal(fixture.children.length, 0);
  const board = Buffer.from(JSON.stringify({ assets: ['assets/photo.png'] }));
  const kept = await convertMedia({
    bytes: board,
    contentType: 'application/json',
    name: 'board.json',
    references: [{ name: 'assets/photo.png', bytes: image, contentType: 'image/png' }],
  }, { converter: null, directory: path.join(fixture.root, 'work'), handles: fixture.children });
  assert.ok(kept.bytes.equals(board));
  assert.equal(kept.references[0].name, 'assets/photo.png');
  assert.ok(kept.references[0].bytes.equals(image));
});

test('failed verification and failed conversion keep the original bytes', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const directory = path.join(fixture.root, 'work');
  const issues = [];
  const invalid = await convertMedia({
    bytes: Buffer.from('not a png'),
    contentType: 'image/png',
    name: 'broken.png',
  }, { converter: process.execPath, directory, handles: fixture.children, issues });
  assert.equal(invalid.converted, false);
  assert.equal(invalid.contentType, 'image/png');
  assert.equal(invalid.name, 'broken.png');
  assert.equal(issues[0].code, 'invalid_asset');
  assert.equal(fixture.children.length, 0);
  const image = tinyPng();
  const failed = await convertMedia({
    bytes: image,
    contentType: 'image/png',
    name: 'photo.png',
  }, { converter: process.execPath, directory, handles: fixture.children, issues, timeoutMs: 5000 });
  assert.equal(failed.converted, false);
  assert.ok(failed.bytes.equals(image));
  assert.equal(failed.contentType, 'image/png');
  assert.equal(failed.name, 'photo.png');
  assert.equal(issues.some((item) => item.code === 'conversion_failed'), true);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('rest')]);
  const calls = [];
  const existing = await convertMedia({
    bytes: webp,
    contentType: 'image/webp',
    name: 'done.webp',
  }, {
    converter: process.execPath,
    directory,
    spawn(command, args, options) {
      calls.push({ command, args, shell: options.shell });
      return spawn(command, args, options);
    },
  });
  assert.equal(calls.length, 0);
  assert.ok(existing.bytes.equals(webp));
  const historical = await convertMedia({
    bytes: image,
    contentType: 'image/png',
    name: 'history.png',
    immutable: true,
  }, { converter: process.execPath, directory });
  assert.ok(historical.bytes.equals(image));
  assert.equal(historical.name, 'history.png');
});

test('an installed converter writes verified WebP and updates references together', async (t) => {
  const converter = await findConverter();
  if (!converter) {
    t.diagnostic('optional real conversion check was unavailable');
    return;
  }
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const directory = path.join(fixture.root, 'work');
  const image = tinyPng();
  const calls = [];
  const converted = await convertMedia({
    bytes: image,
    contentType: 'image/png',
    name: 'assets/photo.png',
  }, {
    converter,
    directory,
    handles: fixture.children,
    timeoutMs: 20000,
    spawn(command, args, options) {
      calls.push({ command, args, shell: options.shell, windowsHide: options.windowsHide });
      assert.equal(options.shell, false);
      assert.equal(args.some((arg) => String(arg).includes('://')), false);
      assert.equal(String(command).includes('://'), false);
      return spawn(command, args, options);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes(JSON.stringify({ assets: ['assets/photo.png'] })), false);
  assert.equal(converted.converted, true);
  assert.equal(converted.contentType, 'image/webp');
  assert.equal(converted.name, 'assets/photo.webp');
  assert.equal(converted.bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(converted.bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  const board = Buffer.from(JSON.stringify({ assets: ['assets/photo.png'] }));
  const together = await convertMedia({
    bytes: board,
    contentType: 'application/json',
    name: 'board.json',
    references: [{ name: 'assets/photo.png', bytes: image, contentType: 'image/png' }],
  }, { converter, directory, handles: fixture.children, timeoutMs: 20000 });
  assert.equal(JSON.parse(together.bytes.toString()).assets[0], 'assets/photo.webp');
  assert.equal(together.references[0].name, 'assets/photo.webp');
  assert.equal(together.references[0].contentType, 'image/webp');
  assert.equal(together.references[0].bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(together.references[0].bytes.equals(image), false);
});
