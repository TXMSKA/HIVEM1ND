import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrate } from '../migrations/3.0.0.mjs';
import { dispose, makeCoreFixture } from './core-fixture.mjs';

async function userRoot(t) {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  return path.join(fixture.paths.mind, 'user');
}

async function files(directory) {
  const found = [];
  async function walk(current) {
    let entries = [];
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        found.push([path.relative(directory, full), 'link']);
        continue;
      }
      if (entry.isDirectory()) await walk(full);
      else found.push([path.relative(directory, full), createHash('sha256').update(await readFile(full)).digest('hex')]);
    }
  }
  await walk(directory);
  return found.sort((left, right) => left[0].localeCompare(right[0]));
}

test('person migration is repeatable and leaves private history in place', async (t) => {
  const root = await userRoot(t);
  const historical = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('id: hist-1\r\nfrom: user\r\nto: executor-shop\r\n\r\nHistorical\r\n'),
  ]);
  await mkdir(path.join(root, 'state'), { recursive: true });
  await mkdir(path.join(root, 'inbox', 'user'), { recursive: true });
  await mkdir(path.join(root, 'inbox', 'user-helper'), { recursive: true });
  await mkdir(path.join(root, 'projects', 'shop', 'inbox', 'user'), { recursive: true });
  await mkdir(path.join(root, 'projects', 'blog', 'inbox', 'user'), { recursive: true });
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'relay', 'sessions'), { recursive: true });
  await mkdir(path.join(root, 'relay', 'archive', 'user'), { recursive: true });
  await writeFile(path.join(root, 'state', 'user.md'), 'unit: user\nstate: in\n\nPerson.\n');
  await writeFile(path.join(root, 'state', 'user-helper.md'), 'unit: user-helper\nstate: in\n\nHelper.\n');
  await writeFile(path.join(root, 'inbox', 'user', '20261001-000000-BOX-hist-1.md'), historical);
  await writeFile(path.join(root, 'inbox', 'user-helper', 'note.md'), 'from: helper\nto: user-helper\n\nStay.\n');
  await writeFile(path.join(root, 'projects', 'shop', 'inbox', 'user', 'shop.md'), 'id: shop-1\nfrom: executor\nto: user\n\nShop.\n');
  await writeFile(path.join(root, 'projects', 'blog', 'inbox', 'user', 'blog.md'), 'id: blog-1\nfrom: executor\nto: user\n\nBlog.\n');
  await writeFile(path.join(root, 'tasks', 'user-task.md'), 'status: open\n\nDo not rename.\n');
  const session = '{"kind":"registration","registrationId":"317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1","unit":"user"}\n';
  await writeFile(path.join(root, 'relay', 'sessions', '317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1.json'), session);
  await writeFile(path.join(root, 'relay', 'archive', 'user', 'old.md'), historical);

  await migrate({ userPath: root });
  const movedHistorical = await readFile(path.join(root, 'inbox', 'master', '20261001-000000-BOX-hist-1.md'));
  assert.deepEqual(movedHistorical, historical);
  assert.equal(await readFile(path.join(root, 'state', 'master.md'), 'utf8'), 'unit: user\nstate: in\n\nPerson.\n');
  assert.equal(await readFile(path.join(root, 'state', 'user-helper.md'), 'utf8'), 'unit: user-helper\nstate: in\n\nHelper.\n');
  assert.equal(await readFile(path.join(root, 'projects', 'shop', 'inbox', 'master', 'shop.md'), 'utf8'), 'id: shop-1\nfrom: executor\nto: user\n\nShop.\n');
  assert.equal(await readFile(path.join(root, 'projects', 'blog', 'inbox', 'master', 'blog.md'), 'utf8'), 'id: blog-1\nfrom: executor\nto: user\n\nBlog.\n');
  assert.equal(await readFile(path.join(root, 'tasks', 'user-task.md'), 'utf8'), 'status: open\n\nDo not rename.\n');
  assert.equal(await readFile(path.join(root, 'relay', 'sessions', '317fe33f-ec4e-49f2-9ab1-7f2a71b1d9b1.json'), 'utf8'), session);
  assert.deepEqual(await readFile(path.join(root, 'relay', 'archive', 'master', 'old.md')), historical);
  await assert.rejects(lstat(path.join(root, 'state', 'user.md')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(root, 'inbox', 'user')), { code: 'ENOENT' });
  assert.equal(path.basename(root), 'user');
  assert.equal((await lstat(root)).isDirectory(), true);
  const snapshot = await files(root);
  await migrate({ userPath: root });
  assert.deepEqual(await files(root), snapshot);
  assert.equal(snapshot.filter((entry) => entry[0].includes('conflict-notice')).length, 0);
});

test('state and inbox collisions keep both byte sequences and one notice', async (t) => {
  const root = await userRoot(t);
  await mkdir(path.join(root, 'state'), { recursive: true });
  await mkdir(path.join(root, 'inbox', 'user'), { recursive: true });
  await mkdir(path.join(root, 'inbox', 'master'), { recursive: true });
  await writeFile(path.join(root, 'state', 'user.md'), 'unit: user\n\nOld person.\n');
  await writeFile(path.join(root, 'state', 'master.md'), 'unit: master\n\nCurrent person.\n');
  const older = Buffer.from('id: same\nfrom: user\nto: master\n\nOlder body\n');
  const newer = Buffer.from('id: same\nfrom: master\nto: master\n\nNewer body\n');
  await writeFile(path.join(root, 'inbox', 'user', 'older.md'), older);
  await writeFile(path.join(root, 'inbox', 'master', 'newer.md'), newer);
  await migrate({ userPath: root });
  assert.equal(await readFile(path.join(root, 'state', 'master.md'), 'utf8'), 'unit: master\n\nCurrent person.\n');
  const conflict = (await readdir(path.join(root, 'state'))).find((name) => name.startsWith('user.md.conflict-'));
  assert.equal(await readFile(path.join(root, 'state', conflict), 'utf8'), 'unit: user\n\nOld person.\n');
  assert.equal(await readFile(path.join(root, 'inbox', 'master', 'newer.md'), 'utf8'), newer.toString());
  const inboxConflict = (await readdir(path.join(root, 'inbox', 'master'))).find((name) => name.startsWith('older.md.conflict-'));
  assert.equal(await readFile(path.join(root, 'inbox', 'master', inboxConflict), 'utf8'), older.toString());
  const notices = (await readdir(path.join(root, 'inbox', 'master'))).filter((name) => name.includes('20261010-000000-master-'));
  assert.equal(notices.length, 1);
  await migrate({ userPath: root });
  assert.equal((await readdir(path.join(root, 'inbox', 'master'))).filter((name) => name.includes('20261010-000000-master-')).length, 1);
});

test('an interrupted migration resumes without repeating a move', async (t) => {
  const root = await userRoot(t);
  await mkdir(path.join(root, 'inbox', 'user'), { recursive: true });
  await writeFile(path.join(root, 'inbox', 'user', 'one.md'), 'id: one\nfrom: a\nto: user\n\nOne\n');
  await writeFile(path.join(root, 'inbox', 'user', 'two.md'), 'id: two\nfrom: a\nto: user\n\nTwo\n');
  await assert.rejects(migrate({ userPath: root, faultAfterMoves: 1 }), { code: 'MIGRATION_INTERRUPTED' });
  const progress = JSON.parse(await readFile(path.join(root, 'relay', 'migration-3.0.0.json'), 'utf8'));
  assert.equal(progress.completed, false);
  assert.equal(progress.moves.length, 1);
  await migrate({ userPath: root });
  assert.equal(await readFile(path.join(root, 'inbox', 'master', 'one.md'), 'utf8'), 'id: one\nfrom: a\nto: user\n\nOne\n');
  assert.equal(await readFile(path.join(root, 'inbox', 'master', 'two.md'), 'utf8'), 'id: two\nfrom: a\nto: user\n\nTwo\n');
  const again = JSON.parse(await readFile(path.join(root, 'relay', 'migration-3.0.0.json'), 'utf8'));
  assert.equal(again.completed, true);
  assert.equal(again.moves.length, 2);
  const snapshot = await files(root);
  await migrate({ userPath: root });
  assert.deepEqual(await files(root), snapshot);
});

test('a linked inbox is not followed', async (t) => {
  const fixture = await makeCoreFixture();
  t.after(() => dispose(fixture));
  const root = path.join(fixture.paths.mind, 'user');
  const outside = path.join(fixture.root, 'outside-inbox');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.md'), 'id: secret\nfrom: a\nto: user\n\nSecret\n');
  await mkdir(path.join(root, 'inbox'), { recursive: true });
  await symlink(outside, path.join(root, 'inbox', 'user'), 'junction');
  await migrate({ userPath: root });
  assert.equal(await readFile(path.join(outside, 'secret.md'), 'utf8'), 'id: secret\nfrom: a\nto: user\n\nSecret\n');
  await assert.rejects(lstat(path.join(root, 'inbox', 'master', 'secret.md')), { code: 'ENOENT' });
});
