import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';

const OUTPUT_LIMIT = 16000000;
const ERROR_LIMIT = 65536;

export async function findConverter({ env = process.env, platform = process.platform } = {}) {
  const names = platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const directory of pathValue(env).split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        const stats = await stat(candidate);
        if (stats.isFile()) return candidate;
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      }
    }
  }
  return null;
}

export async function convertMedia(input, options = {}) {
  if (!input || !Buffer.isBuffer(input.bytes)) throw new CoreError(422, 'invalid_asset', 'Media conversion needs bytes.');
  const issues = options.issues ?? [];
  const handles = options.handles ?? [];
  if (isText(input.contentType) && input.contentType !== 'application/json') {
    return unchanged(input, issues);
  }
  if (input.contentType === 'application/json' || Array.isArray(input.references)) {
    return convertBoard(input, options, issues, handles);
  }
  const converted = await convertOne(input, options, issues, handles);
  return { ...converted, references: [], issues };
}

async function convertBoard(input, options, issues, handles) {
  const references = input.references ?? [];
  const converted = [];
  for (const reference of references) {
    if (reference?.contentType === 'application/json') {
      issues.push(issue(reference.name, 'invalid_asset', 'A board is not sent to the converter.'));
      return unchanged(input, issues);
    }
    converted.push(await convertOne(reference, options, issues, handles));
  }
  if (converted.some((item) => item.issue)) return { ...unchanged(input, issues), references };
  let bytes = input.bytes;
  const ready = [];
  for (const item of converted) {
    if (item.converted && item.name !== item.originalName) {
      bytes = replaceReference(bytes, item.originalName, item.name);
    }
    ready.push({ name: item.name, bytes: item.bytes, contentType: item.contentType, converted: item.converted });
  }
  return {
    converted: ready.some((item) => item.converted),
    bytes,
    contentType: input.contentType,
    name: input.name,
    references: ready,
    issues,
  };
}

async function convertOne(input, options, issues, handles) {
  const originalName = input.name ?? 'upload';
  const preserved = {
    converted: false,
    bytes: input.bytes,
    contentType: input.contentType,
    name: originalName,
    originalName,
    issue: null,
  };
  if (input.immutable === true || input.historical === true || input.contentType === 'image/webp' || input.contentType === 'video/webm') {
    if (!(await payloadComplete(input.bytes, input.contentType))) rejectIncomplete(preserved, issues, originalName);
    return preserved;
  }
  const target = targetType(input.contentType);
  if (!target) return preserved;
  if (!signatureMatches(input.bytes, input.contentType)) {
    preserved.issue = issue(originalName, 'invalid_asset', 'The media signature does not match its type.');
    issues.push(preserved.issue);
    return preserved;
  }
  const converter = options.converter === undefined ? await findConverter(options) : options.converter;
  if (!converter) {
    if (!(await payloadComplete(input.bytes, input.contentType))) rejectIncomplete(preserved, issues, originalName);
    return preserved;
  }
  const directory = options.directory ?? path.join(path.dirname(converter), '.hivem1nd-media');
  await mkdir(directory, { recursive: true });
  const stamp = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const source = path.join(directory, `${stamp}.${extensionFor(input.contentType)}`);
  const output = path.join(directory, `${stamp}.${target.extension}`);
  await writeFile(source, input.bytes);
  try {
    const result = await runConverter(converter, source, output, target, options, handles);
    if (!result.ok) {
      preserved.issue = issue(originalName, 'conversion_failed', 'Conversion failed.');
      issues.push(preserved.issue);
      return preserved;
    }
    const bytes = await readFile(output);
    if (bytes.length === 0 || bytes.length > (options.maxOutputBytes ?? OUTPUT_LIMIT) || !signatureMatches(bytes, target.contentType)) {
      preserved.issue = issue(originalName, 'conversion_failed', 'The converted media failed verification.');
      issues.push(preserved.issue);
      return preserved;
    }
    return {
      converted: true,
      bytes,
      contentType: target.contentType,
      name: replaceExtension(originalName, target.extension),
      originalName,
      issue: null,
    };
  } finally {
    await rm(source, { force: true });
    await rm(output, { force: true });
  }
}

function runConverter(converter, source, output, target, options, handles) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source];
  if (target.contentType === 'image/webp') args.push('-c:v', 'libwebp');
  if (target.contentType === 'video/webm') args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-an');
  args.push(output);
  if (args.some((arg) => /^https?:\/\//i.test(String(arg)))) {
    return Promise.resolve({ ok: false });
  }
  const spawnProcess = options.spawn ?? spawn;
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok });
    };
    try {
      child = spawnProcess(converter, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      finish(false);
      return;
    }
    handles.push(child);
    let errors = 0;
    child.stderr?.on('data', (chunk) => {
      errors += chunk.length;
      if (errors > ERROR_LIMIT) child.kill();
    });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, options.timeoutMs ?? 10000);
  });
}

function unchanged(input, issues) {
  return {
    converted: false,
    bytes: input.bytes,
    contentType: input.contentType,
    name: input.name,
    references: input.references ?? [],
    issues,
  };
}

function targetType(contentType) {
  if (contentType === 'image/png' || contentType === 'image/jpeg') return { contentType: 'image/webp', extension: 'webp' };
  if (contentType === 'video/mp4' || contentType === 'video/quicktime') return { contentType: 'video/webm', extension: 'webm' };
  return null;
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/quicktime') return 'mov';
  return 'bin';
}

function signatureMatches(bytes, contentType) {
  if (contentType === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/webp') return Boolean(webpPayload(bytes));
  if (contentType === 'video/webm') return bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (contentType === 'video/mp4' || contentType === 'video/quicktime') return bytes.length > 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  return false;
}

function replaceExtension(name, extension) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const prefix = slash >= 0 ? name.slice(0, slash + 1) : '';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${prefix}${stem}.${extension}`;
}

function replaceReference(bytes, from, to) {
  const parsed = JSON.parse(bytes.toString('utf8'));
  const next = rewrite(parsed, from, to);
  return Buffer.from(JSON.stringify(next));
}

function rewrite(value, from, to) {
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map((item) => rewrite(item, from, to));
  if (value && typeof value === 'object') {
    const next = {};
    for (const key of Object.keys(value)) next[key] = rewrite(value[key], from, to);
    return next;
  }
  return value;
}

function rejectIncomplete(preserved, issues, name) {
  preserved.issue = issue(name, 'invalid_asset', 'The media payload is incomplete.');
  issues.push(preserved.issue);
}

async function payloadComplete(bytes, contentType) {
  if (contentType === 'image/webp') return Boolean(webpPayload(bytes));
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') return true;
  const { imageComplete } = await import('../service/editors.mjs');
  return imageComplete(bytes, contentType);
}

export function webpPayload(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > 16_000_000) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return null;
  let offset = 12;
  let canvas = null;
  let image = null;
  let chunks = 0;
  while (offset < bytes.length && chunks < 64) {
    if (offset + 8 > bytes.length) return null;
    const tag = bytes.toString('ascii', offset, offset + 4);
    if (!/^[A-Za-z0-9 ]{4}$/.test(tag)) return null;
    const size = bytes.readUInt32LE(offset + 4);
    if (size > 16_000_000) return null;
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) return null;
    const data = bytes.subarray(start, end);
    if (tag === 'VP8X') {
      if (canvas || size !== 10) return null;
      canvas = vp8xSize(data);
      if (!canvas) return null;
    } else if (tag === 'VP8 ') {
      if (image) return null;
      image = vp8Size(data);
      if (!image) return null;
    } else if (tag === 'VP8L') {
      if (image) return null;
      image = vp8lSize(data);
      if (!image) return null;
    }
    offset = start + size + (size & 1);
    if (offset > bytes.length) return null;
    chunks += 1;
  }
  if (offset !== bytes.length || !image) return null;
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) return null;
  if (image.width < 1 || image.height < 1 || image.width > 16384 || image.height > 16384) return null;
  return image;
}

function vp8xSize(data) {
  const width = 1 + data.readUIntLE(4, 3);
  const height = 1 + data.readUIntLE(7, 3);
  if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  return { width, height };
}

function vp8Size(data) {
  if (data.length < 11 || (data[0] & 1) !== 0) return null;
  const tag = data.readUIntLE(0, 3);
  const partitionSize = tag >>> 5;
  if (((tag >>> 1) & 7) > 3 || !(tag & 16)) return null;
  // The control partition excludes the ten-byte key-frame header; coefficient data follows it.
  if (partitionSize < 2 || 10 + partitionSize >= data.length) return null;
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null;
  const width = data.readUInt16LE(6) & 0x3fff;
  const height = data.readUInt16LE(8) & 0x3fff;
  if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  return { width, height };
}

function vp8lSize(data) {
  // Even five single-symbol prefix trees need 20 bits after transform/cache/meta flags.
  if (data.length < 8 || data[0] !== 0x2f || !data.subarray(5).some((byte) => byte !== 0)) return null;
  const bits = data.readUInt32LE(1);
  if ((bits >>> 29) !== 0) return null;
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  if (width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  return { width, height };
}

function issue(resource, code, message) {
  return { path: resource ?? null, code, message };
}

function isText(contentType) {
  return contentType === 'text/plain' || contentType === 'text/markdown' || contentType === 'text/html';
}

function pathValue(env) {
  for (const [key, value] of Object.entries(env ?? {})) {
    if (key.toLowerCase() === 'path' && typeof value === 'string') return value;
  }
  return '';
}
