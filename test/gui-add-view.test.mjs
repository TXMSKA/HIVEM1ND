import assert from 'node:assert/strict';
import test from 'node:test';
import { ADD_COPY, addText, addButton, renderAdd, renderAddedContent } from '../gui/app/add-view.mjs';
import { document, nodes, copy } from './add-dom-fixture.mjs';
const check = { pin: { ok: true, kind: 'commit', value: '4f2c9e1'.padEnd(40, '0') }, license: { ok: true, value: 'MIT' },
  age: { ok: true, days: 9, publishedAt: '2026-10-01T00:00:00.000Z' }, scripts: { ok: true, noInstallScripts: true },
  runtime: { ok: false, verified: true, requirements: ['Python'] }, eligible: true };
const pdf = { id: 'pdf', kind: 'skill', title: 'pdf', description: 'Reads, fills and merges PDF files', supported: true, check };
const model = { language: 'en', stage: 'source', link: 'https://example.com/skills', preview: { sourceDisplay: 'acme/agent-skills',
  pin: { kind: 'commit', value: check.pin.value }, candidates: [pdf, { ...pdf, id: 'docx', title: 'docx' },
    { ...pdf, id: 'tool', kind: 'tool-server', title: 'acme-files', description: 'Reads and writes cloud files', supported: false }] }, selected: ['pdf'],
  scopes: { pdf: { everyUnit: false, units: ['root:adjutant'], groups: ['checkout'] } },
  choices: { units: [{ id: 'root:adjutant', title: 'adjutant' }], groups: [{ id: 'checkout', title: 'Checkout launch', members: ['one', 'two', 'three'] }] }, busy: false, errorCode: null };
test('discovery lists mixed parts and disables the excluded tool with a named control', () => {
  const view = renderAdd(document, model, {});
  assert.match(copy(view), /Add to M1ND/); assert.match(copy(view), /Found in acme\/agent-skills, commit 4f2c9e1/);
  const rows = nodes(view).filter(node => node.getAttribute('data-candidate-id'));
  assert.deepEqual(rows.map(row => row.getAttribute('data-candidate-id')), ['pdf', 'docx', 'tool']);
  assert.equal(rows[2].children[0].getAttribute('disabled'), ''); assert.match(copy(rows[2]), /Reads and writes cloud files/);
  assert.match(rows[2].children[0].getAttribute('aria-label'), /Available after 3.0/);
  assert.equal(addButton(document, 'en', () => {}).getAttribute('aria-label'), 'Add to M1ND');
  assert.match(copy(renderAdd(document, { ...model, language: 'es' }, {})), /Agregar al M1ND/);
});
test('the check precedes unit selection and runtime caution does not imply installation', () => {
  const view = renderAdd(document, { ...model, stage: 'check' }, {});
  const text = copy(view);
  for (const value of ['Add pdf', 'Pinned to commit 4f2c9e1', 'MIT license', 'Older than 7 days, no install scripts',
    'Its scripts run Python', 'only in the units below', 'Who can use it', 'Every unit', 'Checkout launch', 'Cluster, 3 agents', 'adjutant', 'Back']) assert.ok(text.includes(value), value);
  assert.ok(text.indexOf('MIT license') < text.indexOf('Who can use it'));
  assert.equal(nodes(view).filter(node => node.getAttribute('data-check-ok') === 'false').length, 1);
  const buttons = nodes(view).filter(node => node.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(node => node.textContent), ['Back', 'Add pdf']);
  assert.equal(buttons[1].getAttribute('disabled'), null);
  const noScope = renderAdd(document, { ...model, stage: 'check', scopes: {} }, {});
  assert.equal(nodes(noScope).find(node => node.getAttribute('data-action') === 'add-confirm').getAttribute('disabled'), '');
});
test('added content preserves origin scope count and Remove while copy is bilingual', () => {
  const row = renderAddedContent(document, { title: 'pdf', included: true, additionId: 'owned', origin: 'acme/agent-skills', unitCount: 4, removable: true }, 'en', {});
  assert.match(copy(row), /from acme\/agent-skills, 4 units/); assert.match(copy(row), /Remove/);
  for (const [key, pair] of Object.entries(ADD_COPY)) {
    assert.equal(pair.length, 2); assert.equal(typeof addText('en', key), 'string'); assert.equal(typeof addText('es', key), 'string');
    assert.doesNotMatch(pair.join(' '), /\u2014/);
  }
  const malicious = renderAdd(document, { ...model, preview: { ...model.preview, candidates: [{ ...pdf, description: '<script>run()</script>' }] } }, {});
  assert.equal(nodes(malicious).some(node => node.tagName === 'SCRIPT'), false);
});
test('failed inspection retains an enabled Retry and unknown evidence is shown without a false claim', () => {
  let retried = 0;
  const failure = renderAdd(document, { ...model, preview: null, selected: [], errorCode: 'source_unavailable' }, { onRetry() { retried += 1; } });
  const retry = nodes(failure).find(node => node.getAttribute('data-action') === 'add-continue');
  assert.equal(retry.getAttribute('disabled'), null); assert.equal(retry.textContent, 'Retry'); retry.listeners.click(); assert.equal(retried, 1);
  const unknown = { ...pdf, check: { ...check, pin: { ok: false, kind: '', value: '' },
    runtime: { ok: false, verified: false, requirements: [] }, eligible: false } };
  const view = renderAdd(document, { ...model, stage: 'check', preview: { ...model.preview, candidates: [unknown] } }, {});
  assert.match(copy(view), /The pin could not be verified/); assert.match(copy(view), /Runtime requirements could not be verified/);
  assert.doesNotMatch(copy(view), /No executable runtime required/);
  const versioned = renderAdd(document, { ...model, preview: { ...model.preview, pin: { kind: 'version', value: '12.34.56-rc.10' } } }, {});
  assert.match(copy(versioned), /12\.34\.56-rc\.10/);
  const repository = renderAdd(document, { ...model, stage: 'check', selected: ['repo'], scopes: {},
    preview: { ...model.preview, candidates: [{ ...pdf, id: 'repo', kind: 'repository' }] } }, {});
  assert.match(copy(repository), /A repository becomes a cluster/);
  assert.equal(nodes(repository).find(node => node.getAttribute('data-action') === 'add-confirm').getAttribute('disabled'), null);
});
test('the hint names the three accepted forms and a refused source repeats them in both languages', () => {
  const english = 'A GitHub or GitLab repository link, an npm package link, or a dropped folder';
  assert.equal(addText('en', 'linkHint'), english);
  assert.equal(addText('es', 'linkHint'), 'Un enlace a un repositorio de GitHub o GitLab, un enlace a un paquete de npm o una carpeta soltada');
  assert.ok(copy(renderAdd(document, model, {})).includes(english));
  assert.ok(copy(renderAdd(document, { ...model, language: 'es' }, {})).includes(addText('es', 'linkHint')));
  for (const [language, forms] of [['en', ['GitHub or GitLab repository link', 'npm package link', 'dropped folder']], ['es', ['repositorio de GitHub o GitLab', 'paquete de npm', 'carpeta soltada']]]) {
    const refused = renderAdd(document, { ...model, language, preview: null, selected: [], errorCode: 'invalid_source' }, {});
    const alert = nodes(refused).find(node => node.getAttribute('role') === 'alert');
    for (const form of forms) assert.ok(copy(alert).includes(form), `${language}: ${form}`);
  }
});
test('a dropped folder can be inspected but its Add stays off, and a link shows no such line', () => {
  const folder = { ...pdf, check: { ...check, age: { ok: false, days: null, publishedAt: null }, eligible: false } };
  const dropped = { ...model, stage: 'check', preview: { ...model.preview, sourceDisplay: 'notes', pin: { kind: 'snapshot', value: 'd'.repeat(64) }, candidates: [folder] } };
  const view = renderAdd(document, dropped, {});
  const line = nodes(view).find(node => node.getAttribute('data-dropped-folder') === 'true');
  assert.equal(line.textContent, 'A dropped folder can be inspected, but it cannot be added: it has no pinned commit or release date. Add it from its repository link instead.');
  assert.equal(nodes(view).find(node => node.getAttribute('data-action') === 'add-confirm').getAttribute('disabled'), '');
  assert.equal(nodes(renderAdd(document, { ...dropped, language: 'es' }, {})).find(node => node.getAttribute('data-dropped-folder') === 'true').textContent,
    'Una carpeta soltada se puede inspeccionar, pero no se puede agregar: no tiene un commit fijado ni una fecha de publicación. Agregarla desde el enlace de su repositorio.');
  const link = renderAdd(document, { ...model, stage: 'check' }, {});
  assert.equal(nodes(link).some(node => node.getAttribute('data-dropped-folder') === 'true'), false);
  assert.equal(nodes(link).find(node => node.getAttribute('data-action') === 'add-confirm').getAttribute('disabled'), null);
  assert.equal(nodes(renderAdd(document, model, {})).some(node => node.getAttribute('data-dropped-folder') === 'true'), false);
});
