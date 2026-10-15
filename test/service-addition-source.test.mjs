import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { acquireAdditionSource, receiveAdditionChunk, validateAdditionSource } from '../engine/service/addition-source.mjs';
import { hashBytes } from '../engine/service/identity.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

const now = Date.parse('2026-10-10T12:00:00.000Z');
const pin = 'a'.repeat(40);
const skill = '---\nname: pdf\ndescription: Reads PDF files\nruntime: none\n---\n# PDF\n';
async function hashes(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result[path.relative(root, file)] = hashBytes(await readFile(file));
    }
  }
  await visit(root); return result;
}
function tar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.data ?? '');
    const header = Buffer.alloc(512);
    header.write(`package/${entry.path}`, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = (entry.type ?? '0').charCodeAt(0);
    if (entry.link) header.write(entry.link, 157, 100);
    header.write('ustar\0', 257);
    const sum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
async function setup(t, { entries = [{ path: 'SKILL.md', data: skill }, { path: 'LICENSE', data: 'MIT License' }], date = '2026-10-03T12:00:00.000Z', registry = false, transport = null } = {}) {
  const fixture = await makeCoreFixture({ now });
  if (registry && !entries.some(entry => entry.path === 'package.json')) entries = [...entries, { path: 'package.json', data: JSON.stringify({ name: 'example', version: '1.2.3', license: 'MIT' }) }];
  const archive = tar(entries), calls = [], launches = { scripts: 0, native: 0, installers: 0 };
  const before = { mind: await hashes(fixture.paths.mind), client: await hashes(fixture.home), source: hashBytes(archive) };
  const context = { ...fixture, now: () => fixture.clock.now,
    additionLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    additionRunner: async (command, args, options, input) => {
      if (command !== 'git' || !args.includes('hash-object') || !args.includes('--no-filters')) { launches.scripts++; throw new Error('Unexpected execution'); }
      calls.push({ command, args, options });
      return Buffer.from(createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') + '\n');
    },
    additionTransport: transport ?? (async url => {
      calls.push({ url: url.href });
      if (url.hostname === 'registry.npmjs.org') return { status: 200, bytes: Buffer.from(JSON.stringify({ name: 'example', 'dist-tags': { latest: '1.2.3' },
        time: { '1.2.3': date }, versions: { '1.2.3': { name: 'example', version: '1.2.3', dist: { tarball: 'https://archives.example.com/example.tgz',
          integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` } } } })) };
      if (url.pathname.includes('/commits/')) return { status: 200, bytes: Buffer.from(JSON.stringify({ sha: pin, commit: { committer: { date } } })) };
      return { status: 200, bytes: archive };
    }) };
  const input = { id: randomUUID(), source: { kind: 'link', url: registry ? 'https://www.npmjs.com/package/example' : 'https://github.com/acme/example' } };
  t.after(async () => {
    try {
      assert.deepEqual(launches, { scripts: 0, native: 0, installers: 0 });
      assert.deepEqual({ mind: await hashes(fixture.paths.mind), client: await hashes(fixture.home), source: hashBytes(archive) }, before);
    } finally { await dispose(fixture); }
  });
  return { fixture, context, input, archive, calls, launches };
}

test('Git resolves a full immutable commit and hashes the complete protected inventory', async t => {
  const { context, input, calls } = await setup(t);
  const result = await acquireAdditionSource(context, input);
  assert.equal(result.pin.value, pin); assert.equal(result.pin.digest, result.manifestHash);
  assert.equal(result.candidates.find(item => item.kind === 'skill').check.eligible, true);
  const git = calls.find(item => item.command);
  assert.equal(git.command, 'git'); assert.equal(git.options.shell, false); assert.equal(git.options.timeout, 30000);
  assert.equal(git.options.env.PATH, undefined); assert.equal(git.options.env.SSH_AUTH_SOCK, undefined);
  for (const config of ['credential.helper=', 'core.hooksPath=', 'submodule.recurse=false', 'protocol.allow=never', 'core.attributesFile=']) assert.ok(git.args.includes(config));
  assert.equal(git.args.includes('--no-filters'), true);
  assert.ok(calls.some(call => call.url?.endsWith(`/tarball/${pin}`)));
  assert.equal((await lstat(path.join(result.directory, 'tree', 'SKILL.md'))).isFile(), true);
  assert.doesNotMatch(JSON.stringify(result.candidates), /# PDF|MIT License/);
});

test('registry links fetch exact release metadata and verify the archive without a package manager', async t => {
  const { context, input, archive, calls } = await setup(t, { registry: true });
  const result = await acquireAdditionSource(context, input);
  assert.deepEqual(result.pin, { kind: 'version', value: '1.2.3', digest: hashBytes(archive) });
  assert.ok(result.manifestHash); assert.equal(calls.some(call => call.command), false);
  assert.equal(result.candidates[0].check.age.days, 7);
});

test('mixed trees recognize nested skills and standalone docs while tools remain disabled', async t => {
  const { context, input } = await setup(t, { entries: [
    { path: 'LICENSE', data: 'MIT License' }, { path: 'skills/pdf/SKILL.md', data: skill },
    { path: 'skills/pdf/docs/help.md', data: 'Support' }, { path: 'skills/pdf/image.png', data: Buffer.from([0, 255, 128]) },
    { path: 'skills/docx/SKILL.md', data: skill.replace('name: pdf', 'name: docx') }, { path: 'docs/guide.md', data: 'Documentation' },
    { path: 'tools/package.json', data: JSON.stringify({ name: 'cloud', mcp: {}, license: 'Apache-2.0' }) },
  ] });
  const result = await acquireAdditionSource(context, input);
  assert.deepEqual(result.candidates.map(item => item.kind), ['skill', 'skill', 'docs', 'tool-server', 'repository']);
  const tool = result.candidates.find(item => item.kind === 'tool-server');
  assert.equal(tool.supported, false); assert.equal(tool.blockedReason, 'after_3_0'); assert.equal(tool.check.eligible, false);
  assert.equal(tool.check.license.value, 'Apache-2.0');
  const file = result.files.find(file => file.path.endsWith('image.png'));
  assert.deepEqual(await readFile(path.join(result.directory, 'tree', file.path)), Buffer.from([0, 255, 128]));
  assert.equal(file.text, undefined);
});

for (const [label, date, eligible] of [['seven days', '2026-10-03T12:00:00.000Z', true], ['one millisecond younger', '2026-10-03T12:00:00.001Z', false],
  ['unknown', null, false], ['future', '2026-10-11T12:00:00.000Z', false]]) {
  test(`pinned age evidence: ${label}`, async t => {
    const { context, input } = await setup(t, { date });
    const result = await acquireAdditionSource(context, input);
    assert.equal(result.candidates.find(item => item.kind === 'skill').check.eligible, eligible);
  });
}
test('a missing license and unknown declarative runtime fail independently', async t => {
  const { context, input } = await setup(t, { entries: [{ path: 'SKILL.md', data: skill.replace('runtime: none\n', '') }] });
  const result = await acquireAdditionSource(context, input);
  const check = result.candidates[0].check;
  assert.equal(check.license.ok, false); assert.equal(check.runtime.verified, false); assert.equal(check.eligible, false);
});

test('a runtime declaration cannot mask unknown package scripts or engines', async t => {
  const { context, input } = await setup(t, { entries: [{ path: 'SKILL.md', data: skill },
    { path: 'package.json', data: JSON.stringify({ name: 'pdf', license: 'MIT', engines: { unknown: '1' }, scripts: { start: 'custom-runtime run' } }) }] });
  const result = await acquireAdditionSource(context, input);
  assert.equal(result.candidates[0].check.runtime.verified, false);
  assert.equal(result.candidates[0].check.eligible, false);
});

test('every redirect and DNS answer is checked and the fourth redirect is refused', async t => {
  let connections = 0, resolutions = 0;
  const { context, input } = await setup(t, { transport: async url => { connections++; return { status: 302, headers: { location: new URL('/next', url).href } }; } });
  context.additionLookup = async () => { resolutions++; return [{ address: '93.184.216.34', family: 4 }]; };
  await assert.rejects(acquireAdditionSource(context, input), { code: 'invalid_source' });
  assert.equal(resolutions, 4); assert.equal(connections, 4);
});

test('a registry retry binds the original release integrity even before the archive arrives', async t => {
  const { context, input } = await setup(t, { registry: true });
  const original = context.additionTransport; let evidence;
  context.additionTransport = async (url, options) => url.hostname === 'registry.npmjs.org' ? original(url, options) : Promise.reject(new Error('unavailable'));
  await assert.rejects(acquireAdditionSource(context, { ...input, onResolved: value => { evidence = value; } }), { code: 'source_unavailable' });
  context.additionTransport = async (url, options) => {
    const response = await original(url, options);
    if (url.hostname === 'registry.npmjs.org') {
      const value = JSON.parse(response.bytes);
      value.versions['1.2.3'].dist.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
      return { ...response, bytes: Buffer.from(JSON.stringify(value)) };
    }
    return response;
  };
  await assert.rejects(acquireAdditionSource(context, { ...input, id: randomUUID(), pin: evidence.pin, integrity: evidence.integrity }), { code: 'source_changed' });
});

test('hardlink substitutions of protected upload chunks are refused before reading their bytes', async t => {
  const { context, fixture } = await setup(t);
  const upload = { id: randomUUID(), name: 'folder', files: {} };
  await receiveAdditionChunk(context, upload, { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from(skill).toString('base64') });
  const file = path.join(context.paths.localDirectory, 'additions', 'uploads', upload.id, 'chunks', hashBytes(Buffer.from('skill.md')), '0');
  const { link } = await import('node:fs/promises');
  await link(file, path.join(fixture.root, 'foreign-link'));
  await assert.rejects(acquireAdditionSource(context, { id: randomUUID(), source: { kind: 'folder', uploadId: upload.id }, upload }), { code: 'invalid_source' });
});

test('package engines dependencies and entry points augment hints without executing postinstall', async t => {
  const { context, input, fixture } = await setup(t, { entries: [
    { path: 'SKILL.md', data: skill.replace('runtime: none\n', '') },
    { path: 'package.json', data: JSON.stringify({ name: 'pdf', license: 'MIT', engines: { node: '>=22' }, dependencies: { parser: '1.0.0' },
      main: 'index.js', scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'sentinel\',\'executed\')"' } }) },
    { path: 'index.js', data: 'throw new Error("must not run")' },
  ] });
  const result = await acquireAdditionSource(context, input);
  assert.deepEqual(result.candidates[0].requirements, ['Node.js', 'Node.js >=22']);
  assert.equal(result.candidates[0].check.scripts.noInstallScripts, true);
  assert.equal(result.candidates[0].check.eligible, true);
  await assert.rejects(access(path.join(fixture.root, 'sentinel')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(result.directory, 'sentinel')), { code: 'ENOENT' });
});

for (const [label, entry] of [['symbolic link', { path: 'linked', type: '2', link: '/outside' }], ['hard link', { path: 'linked', type: '1', link: 'SKILL.md' }],
  ['device', { path: 'device', type: '3' }], ['fifo', { path: 'pipe', type: '6' }], ['traversal', { path: '../outside' }],
  ['device name', { path: 'NUL.txt' }], ['alternate stream', { path: 'safe:stream' }], ['absolute path', { path: '/absolute' }],
  ['case collision', { path: 'skill.md' }], ['parent case collision', { path: 'Docs/a.md' }]]) {
  test(`safe extraction refuses ${label}`, async t => {
    const { context, input } = await setup(t, { entries: [{ path: 'SKILL.md', data: skill }, { path: 'docs/a.md', data: 'text' }, entry] });
    await assert.rejects(acquireAdditionSource(context, input), error => ['invalid_source', 'invalid_path'].includes(error.code));
  });
}
test('DNS is checked before each connection and a private redirect is never connected', async t => {
  let calls = 0;
  const { context, input } = await setup(t, { transport: async () => { calls++; return { status: 302, headers: { location: 'https://127.0.0.1/private' } }; } });
  await assert.rejects(acquireAdditionSource(context, input), { code: 'invalid_source' });
  assert.equal(calls, 1);
  context.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(acquireAdditionSource(context, { ...input, id: randomUUID() }), { code: 'invalid_source' });
  assert.equal(calls, 1);
});
test('credential URLs query strings and filesystem paths are refused before transport', async t => {
  const { context, input, calls } = await setup(t);
  for (const url of ['https://user:private@github.com/acme/example', 'https://github.com/acme/example?access_token=private', 'https://github.com/acme/example#private', 'C:/source', 'http://github.com/acme/example']) {
    await assert.rejects(acquireAdditionSource(context, { ...input, source: { kind: 'link', url } }), { code: 'invalid_source' });
  }
  assert.equal(calls.length, 0);
});
test('a refused link names the forms Add accepts and the accepted forms still resolve', async t => {
  const { context, input } = await setup(t);
  const refused = /GitHub or GitLab repository link with an owner and a name, an npm package link, or a dropped folder/;
  for (const url of ['https://example.com/acme/example', 'https://github.com/acme', 'https://github.com/acme/example/issues/1', 'https://www.npmjs.com/acme/example',
    'https://gitlab.com/acme/example/blob/main/file', 'https://registry.npmjs.org/', 'http://github.com/acme/example']) {
    assert.throws(() => validateAdditionSource({ kind: 'link', url }), error => error.code === 'invalid_source' && error.status === 422 && refused.test(error.message), url);
  }
  for (const url of ['https://github.com/acme/example', 'https://gitlab.com/acme/example', 'https://www.npmjs.com/package/example', 'https://www.npmjs.com/package/@acme/example']) {
    assert.doesNotThrow(() => validateAdditionSource({ kind: 'link', url }), url);
  }
  await assert.rejects(acquireAdditionSource(context, { ...input, source: { kind: 'link', url: 'https://example.com/acme/example' } }), error => error.code === 'invalid_source' && refused.test(error.message));
});
test('registry digest mismatch and truncated archives leave no staged source', async t => {
  const { context, input } = await setup(t, { registry: true });
  const original = context.additionTransport;
  context.additionTransport = async (url, options) => {
    const result = await original(url, options);
    return url.hostname === 'registry.npmjs.org' ? result : { ...result, bytes: Buffer.from('corrupt') };
  };
  await assert.rejects(acquireAdditionSource(context, input), { code: 'invalid_source' });
  const next = await setup(t);
  const transport = next.context.additionTransport;
  next.context.additionTransport = async (url, options) => url.pathname.includes('/commits/') ? transport(url, options)
    : { status: 200, bytes: gzipSync(Buffer.alloc(512)) };
  await assert.rejects(acquireAdditionSource(next.context, next.input), { code: 'invalid_source' });
});
for (const [label, entries] of [['1025 files', Array.from({ length: 1025 }, (_, index) => ({ path: `${index}.txt`, data: '' }))],
  ['16 MiB plus one', [{ path: 'large.bin', data: Buffer.alloc(16777217) }]],
  ['64 MiB plus one', [...Array.from({ length: 4 }, (_, index) => ({ path: `${index}.bin`, data: Buffer.alloc(16777216) })), { path: 'last.bin', data: 'x' }]]]) {
  test(`decoded limits refuse ${label}`, async t => {
    const { context, input } = await setup(t, { entries });
    await assert.rejects(acquireAdditionSource(context, input), { code: 'addition_too_large' });
  });
}
test('chunks tolerate replay refuse conflicts and never recognize an incomplete file', async t => {
  const { context } = await setup(t);
  const upload = { id: randomUUID(), name: 'folder', files: {} };
  const chunk = { path: 'SKILL.md', index: 0, total: 1, base64: Buffer.from(skill).toString('base64') };
  await receiveAdditionChunk(context, upload, chunk); await receiveAdditionChunk(context, upload, chunk);
  await assert.rejects(receiveAdditionChunk(context, upload, { ...chunk, base64: Buffer.from('different').toString('base64') }), { code: 'source_changed' });
  const result = await acquireAdditionSource(context, { id: randomUUID(), source: { kind: 'folder', uploadId: upload.id }, upload });
  assert.equal(result.pin.kind, 'snapshot'); assert.equal(result.pin.value, result.manifestHash);
  assert.equal(result.candidates[0].check.age.publishedAt, null); assert.equal(result.candidates[0].check.age.ok, false);
  const interrupted = { id: randomUUID(), name: 'folder', files: {} };
  await receiveAdditionChunk(context, interrupted, { ...chunk, total: 2, base64: Buffer.alloc(65536).toString('base64') });
  await assert.rejects(acquireAdditionSource(context, { id: randomUUID(), source: { kind: 'folder', uploadId: interrupted.id }, upload: interrupted }), { code: 'source_changed' });
  await assert.rejects(receiveAdditionChunk(context, interrupted, { ...chunk, path: 'NUL', base64: '' }), { code: 'invalid_path' });
});
test('the injected deadline aborts at exactly 30000 ms while other transport failures stay unavailable', async t => {
  let tick, observedSignal, canceled = false;
  const { context, input } = await setup(t, { transport: async (_url, { signal }) => {
    observedSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private diagnostic')), { once: true }));
  } });
  context.additionSchedule = (callback, ms) => { assert.equal(ms, 30000); tick = callback; return 7; };
  context.additionClearTimeout = timer => { assert.equal(timer, 7); canceled = true; };
  const pending = acquireAdditionSource(context, input);
  while (!observedSignal) await new Promise(resolve => setImmediate(resolve));
  tick();
  await assert.rejects(pending, { code: 'source_timeout' });
  assert.equal(observedSignal.aborted, true); assert.equal(canceled, true);
  context.additionTransport = async () => { throw new Error('private diagnostic'); };
  await assert.rejects(acquireAdditionSource(context, { ...input, id: randomUUID() }), error => error.code === 'source_unavailable' && !error.message.includes('private diagnostic'));
});
