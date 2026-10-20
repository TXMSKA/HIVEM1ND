import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../gui/app/api.mjs';
import { createSessionView, changeContext, loadSessionView, renderContext, renderSessionTabs, renderSessionWork, renderStartedWith } from '../gui/app/session-work.mjs';
import { document, nodes, copy } from './add-dom-fixture.mjs';
const styledDocument = { ...document, createElement(tag) { const node = document.createElement(tag); node.style = {}; return node; } };

test('Started with is one folded descriptor with actual safe references and has no message identity', () => {
  const descriptor = { role: 'executor', taskId: 'root:001', references: ['rules.md', 'roles/executor.md'] };
  const folded = renderStartedWith(document, descriptor, 'en', { cluster: 'shop', task: 'Cart empty state' });
  assert.equal(folded.getAttribute('open'), null);
  assert.match(copy(folded), /Started with/); assert.match(copy(folded), /Cart empty state/);
  assert.match(copy(folded), /roles\/executor.md/);
  assert.equal(nodes(folded).some(node => node.getAttribute('data-message')), false);
  assert.equal(renderStartedWith(document, descriptor, 'es', { open: true }).getAttribute('open'), '');
  const overseer = renderStartedWith(document, { role: 'overseer', references: ['rules.md'] }, 'en');
  assert.match(copy(overseer), /Overseer of every cluster and the M1ND/);
  assert.doesNotMatch(copy(overseer), /of ,/);
  const spanish = renderStartedWith(document, { role: 'overseer', references: ['rules.md'] }, 'es');
  assert.match(copy(spanish), /Overseer de todos los clústeres y el M1ND/);
});

test('Started with names the role of every agent: presets, a custom name, and never a raw id', () => {
  const summary = (descriptor, language = 'en', options = {}) => copy(renderStartedWith(document, { references: ['rules.md'], ...descriptor }, language, { cluster: 'shop', ...options }));
  assert.match(summary({ role: 'executor' }), /Executor of shop and the M1ND/);
  assert.match(summary({ role: 'ux-designer' }), /UX designer of shop and the M1ND/);
  assert.match(summary({ role: 'code-reviewer' }, 'es'), /Revisor de código de shop y el M1ND/);
  assert.match(summary({ role: 'security-consultant' }, 'es', { task: 'Audit' }), /Consultor de ciberseguridad de shop, el M1ND y la tarea Audit/);
  // A custom role reads as the name its person gave it, from the unit or from the descriptor.
  assert.match(summary({ role: 'custom' }, 'en', { roleName: 'Release captain' }), /Release captain of shop and the M1ND/);
  assert.match(summary({ role: 'custom', roleName: 'Capitán de versión' }, 'es'), /Capitán de versión de shop y el M1ND/);
  assert.match(summary({ role: 'custom' }), /Custom of shop and the M1ND/);
  assert.match(summary({ role: 'custom' }, 'es'), /Personalizado de shop y el M1ND/);
  // A plan session without a unit keeps its plan role as a name; anything the app does not know is an agent.
  assert.match(summary({ role: 'builder' }), /Builder of shop and the M1ND/);
  for (const role of ['invented-role', 'constructor', '__proto__', null, undefined, '']) {
    const shown = summary({ role });
    assert.match(shown, /Agent of shop and the M1ND/, String(role));
    if (typeof role === 'string' && role) assert.doesNotMatch(shown, new RegExp(role.replace(/_/g, '.')));
  }
  assert.match(summary({ role: 'invented-role' }, 'es', { cluster: '' }), /Agente y el M1ND/);
  assert.match(copy(renderStartedWith(document, { role: 'qa', references: [] }, 'en')), /QA and the M1ND/);
});

test('Chat and Work have keyboard tabs and ordered authoritative milestones with elapsed display only', () => {
  const view = createSessionView({ id: 'session' }); let selected;
  const tabs = renderSessionTabs(document, view, 'en', tab => { selected = tab; });
  const controls = nodes(tabs).filter(node => node.getAttribute('role') === 'tab');
  assert.deepEqual(controls.map(node => node.textContent), ['Chat', 'Work']);
  controls[0].listeners.keydown({ key: 'ArrowRight', preventDefault() {} }); assert.equal(selected, 'work');
  view.work = [{ id: 'one', sequence: 1, at: '2026-10-15T11:10:00Z', state: 'busy', key: 'tests', values: {} }];
  const before = structuredClone(view.work);
  const root = renderSessionWork(document, view, 'es', {}, Date.parse('2026-10-15T11:12:00Z'));
  assert.match(copy(root), /2 min/); assert.match(copy(root), /Estos registros no son mensajes/);
  assert.deepEqual(view.work, before);
  assert.equal(nodes(root).some(node => node.getAttribute('data-message')), false);
});

test('context actual, estimated and unknown capacity use backend percentages and generation dismissal', () => {
  const view = createSessionView({ id: 'session' });
  view.context = { generationId: 'one', revision: 'rev', percent: 18, estimated: false, dismissed: false };
  let root = renderContext(styledDocument, view, 'en', () => {});
  assert.equal(nodes(root).find(node => node.getAttribute('role') === 'meter').getAttribute('aria-valuenow'), '18');
  assert.equal(nodes(root).some(node => node.getAttribute('data-context-notice')), false);
  view.context.percent = 82; root = renderContext(styledDocument, view, 'en', () => {});
  assert.match(copy(root), /82% full/);
  assert.deepEqual(nodes(root).filter(node => node.tagName === 'BUTTON').map(node => node.getAttribute('data-action')), ['context-dismiss', 'context-compact', 'context-clear']);
  view.context.estimated = true; assert.match(copy(renderContext(styledDocument, view, 'es', () => {})), /estimado/);
  view.context.dismissed = true; assert.equal(nodes(renderContext(styledDocument, view, 'en', () => {})).some(node => node.getAttribute('data-context-notice')), false);
  view.context.percent = null; root = renderContext(styledDocument, view, 'en', () => {});
  assert.match(copy(root), /Context usage unavailable/); assert.equal(nodes(root).some(node => node.getAttribute('role') === 'meter'), false);
});

test('uncertain context retries keep the same operation and work pages preserve their cursor and rows', async () => {
  const calls = [], context = { generationId: 'old', revision: 'a'.repeat(64), percent: 82, operation: null };
  let lost = true;
  const api = createApi({ location: { origin: 'http://127.0.0.1:9', hash: '' }, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { calls.push(init.headers['Idempotency-Key']); if (lost) { lost = false; throw new Error('Lost response'); } }
    const data = path.endsWith('/work') ? { items: [{ id: 'step', sequence: 1 }], nextCursor: 'retained' }
      : init.method === 'POST' ? { context: { ...context, generationId: 'new' } } : { ...context, generationId: 'new' };
    return new Response(JSON.stringify({ contract: 'hivem1nd-gui-v3', data, meta: { requestId: 'fixture', readAt: '2026-10-15T12:00:00Z', eventCursor: 'fixture:1', sync: 'local' } }), { status: init.method === 'POST' ? 202 : 200 });
  } });
  api.token = 'fixture'; const view = createSessionView({ id: 'session' }); view.context = context;
  await assert.rejects(changeContext(api, view, 'compact'));
  assert.equal(view.context.generationId, 'old');
  await changeContext(api, view, 'compact'); assert.equal(calls[0], calls[1]);
  await loadSessionView(api, view); assert.equal(view.nextCursor, 'retained');
  await loadSessionView(api, view, { older: true }); assert.equal(view.work.length, 1);
});
