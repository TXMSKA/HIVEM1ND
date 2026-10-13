import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { moveEditor, deleteEditor } from '../gui/app/editors.mjs';

test('moving and deleting retain all independent revision preconditions', async () => {
  const bodies = [];
  const api = createApi({ location: { origin: 'http://127.0.0.1:12345', hash: '#session=fixture' }, history: { replaceState() {} }, fetch: async (url, options) => {
    bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data: {}, meta: { requestId: 'fixture', readAt: '2026-10-13T00:00:00.000Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: 200 });
  } });
  const editor = { id: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64), commentsRevision: 'b'.repeat(64), attachmentRevision: 'c'.repeat(64) };
  await moveEditor(api, editor, { project: 'api', folderId: null, path: 'docs/flows/boards/cart.json', confirmedRepositoryChange: true }, 'd'.repeat(64));
  await deleteEditor(api, editor, 'd'.repeat(64));
  for (const body of bodies) {
    assert.equal(body.expectedRevision, 'a'.repeat(64));
    assert.equal(body.expectedCommentsRevision, 'b'.repeat(64));
    assert.equal(body.expectedAttachmentRevision, 'c'.repeat(64));
    assert.equal(body.expectedLibraryRevision, 'd'.repeat(64));
  }
  assert.equal(bodies[0].confirmedRepositoryChange, true);
  assert.equal(bodies[1].confirmed, true);
});
