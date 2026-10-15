import { createTextAnchor, plainText } from '../../gui/app/markup.mjs';
import { acceptRepositories, agentCredential, createAgent, createOverseer } from './seed.mjs';

// Fixture texts for the Void (Document mode) captures. Everything here goes through the HTTP API of the actual core, the way
// the T064 core tests prepare a library: a repository accepted, an agent attached, folders, texts with English and Spanish pages.
const FOLDERS = ['Release', 'Manuals', 'Drafts'];

// The sentence the suggestion captures change; the English and Spanish versions are both whole sentences of one paragraph.
export const IDLE = {
  en: { before: 'An idle machine sends no traffic.', after: 'An idle machine makes no requests and sends nothing.', comment: 'Say what an idle machine costs: no requests, not only no traffic.' },
  es: { before: 'Una máquina inactiva no envía tráfico.', after: 'Una máquina inactiva no hace solicitudes y no envía nada.', comment: 'Indicar qué cuesta una máquina inactiva: ninguna solicitud, no solo ningún tráfico.' },
};

const RELEASE = {
  title: 'Release notes 3.0',
  subtitle: 'Draft by executor-shop',
  rev: 0,
  pages: [
    {
      k: 'overview',
      en: `HIVEM1ND 3.0 brings **every agent** of the M1ND onto one Map. Units are created where they run, and _every conversation is kept_.\n\n## One service per machine\n\nEach machine runs one Relay service while HIVEM1ND needs it. It wakes the sessions on that machine and starts new ones from the Map. ${IDLE.en.before}\n\n## Chats and mailboxes\n\nEvery unit has a mailbox for messages left while it is not running. A chat opens its own inbox, so a conversation with one unit or a group stays in one place.`,
      es: `HIVEM1ND 3.0 reúne a **todos los agentes** del M1ND en un solo Mapa. Las unidades se crean donde se ejecutan y _cada conversación se conserva_.\n\n## Un servicio por máquina\n\nCada máquina ejecuta un servicio Relay mientras HIVEM1ND lo necesita. Despierta las sesiones de esa máquina e inicia otras nuevas desde el Mapa. ${IDLE.es.before}\n\n## Chats y buzones\n\nCada unidad tiene un buzón para los mensajes que llegan mientras no se ejecuta. Un chat abre su propia bandeja, así una conversación con una unidad o un grupo queda en un solo lugar.`,
    },
    {
      k: 'live-editors',
      en: '## Live editors\n\nAgents draw in Blueprint and write in Void through the service. The person watches a step at a time, or lets the work run off screen.',
      es: '## Editores en vivo\n\nLos agentes dibujan en Blueprint y escriben en Void a través del servicio. La persona sigue un paso a la vez, o deja que el trabajo corra fuera de pantalla.',
    },
    {
      k: 'upgrade',
      en: '## Upgrading from 2.x\n\nThe 2.x folder is copied, never changed. Close the old sessions first so no work is lost.',
      es: '## Actualizar desde 2.x\n\nLa carpeta 2.x se copia y nunca se modifica. Cerrar antes las sesiones antiguas para no perder trabajo.',
    },
  ],
};

const OTHERS = [
  ['Release', 'Install guide', 'install-guide'],
  ['Manuals', 'Relay manual', 'relay-manual'],
  ['Manuals', 'Squad rules', 'squad-rules'],
  ['Drafts', 'Holiday banner', 'holiday-banner'],
  ['Drafts', 'Returns policy', 'returns-policy'],
  ['Drafts', 'Pricing page', 'pricing-page'],
];

function plainDocument(title) {
  return {
    title, rev: 0,
    pages: [{ k: 'overview', en: `## ${title}\n\nThis text is a draft kept for the sample library.`, es: `## ${title}\n\nEste texto es un borrador de la biblioteca de muestra.` }],
  };
}

// Folders, texts and the attached agent, all written the way the actual core does: Release/Manuals/Drafts folders, the main text
// "Release notes 3.0" in Release with three pages, other texts in the three folders, executor-shop attached to every text.
export async function seedVoid(ctx, { overseer = true } = {}) {
  const { world } = ctx;
  const clusters = await acceptRepositories(world, ['shop']);
  const cluster = clusters.find(item => item.link?.kind === 'repository') ?? clusters[0];
  if (overseer) await createOverseer(world);
  const agent = await createAgent(world, cluster.id, 'executor');
  // The library lists folders by their random ids, so the folders are made first and then named in the listed order:
  // the sidebar always reads Release, Manuals, Drafts.
  let revision = null;
  for (let index = 0; index < FOLDERS.length; index += 1) {
    revision = (await world.call('POST', '/library/folders', { project: 'shop', kind: 'void', title: `Folder ${index + 1}`, parentId: null, expectedRevision: revision })).revision;
  }
  const folders = {};
  const listed = (await world.call('GET', '/library/folders?kind=void&project=shop')).items;
  for (const [index, folder] of listed.entries()) {
    revision = (await world.call('PATCH', `/library/folders/${folder.id}`, { project: 'shop', title: FOLDERS[index], expectedRevision: revision })).revision;
    folders[FOLDERS[index]] = folder.id;
  }
  const texts = {};
  const create = async (folder, document, slug) => {
    const editor = await world.call('POST', '/void/texts', { project: 'shop', path: `docs/${slug}.json`, document, folderId: folders[folder], attached: [agent.id] });
    texts[document.title] = editor;
    return editor;
  };
  const main = await create('Release', RELEASE, 'release-notes');
  for (const [folder, title, slug] of OTHERS) await create(folder, plainDocument(title), slug);
  return { cluster, agent, folders, texts, main, language: ctx.language, idle: IDLE[ctx.language] };
}

// Open the app on the Document mode and select a text of the library through the GUI.
export async function openText(ctx, id) {
  const { page } = ctx;
  await page.click('[data-action="mode-document"]');
  await ctx.visible(`[data-library-item="${id}"]`, { timeout: 30000 });
  await page.click(`[data-library-item="${id}"] [data-action="select-editor"]`);
  await ctx.visible('[data-void-body]', { timeout: 30000 });
  await page.waitFor(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', { args: [`[data-library-item="${id}"] [data-action="select-editor"]`], message: 'the selected text row' });
  await page.waitFor(() => document.querySelector('[data-void-save]')?.getAttribute('data-void-save') === 'saved' && document.querySelector('[data-void-body]')?.textContent.length > 20, { message: 'the text to show saved' });
}

// A comment by the person on a passage of the main text and a suggestion of the attached agent on it (the agent writes through its
// own credential, the way an attached agent does). Returns the proposal.
export async function suggestChange(ctx, seed) {
  const { world } = ctx;
  const { main, agent, idle, language } = seed;
  const current = await world.call('GET', `/void/texts/${main.id}`);
  const page = current.document.pages[0];
  const source = page[language];
  const start = source.indexOf(idle.before);
  if (start < 0) throw new Error('The sentence to change is not in the main text.');
  const end = start + idle.before.length;
  // A comment anchors on the visible text (markup removed); a suggestion addresses the source.
  const plainStart = plainText(source).indexOf(idle.before);
  const comment = await world.call('POST', `/editors/${main.id}/comments`, {
    text: idle.comment, sendToAgent: true, expectedRevision: current.revision, expectedCommentsRevision: current.commentsRevision,
    anchor: createTextAnchor(source, page.k, language, plainStart, plainStart + idle.before.length),
  });
  const proposed = await world.call('POST', `/void/texts/${main.id}/ranges`, {
    k: page.k, lang: language, start, end, expectedText: idle.before, replacement: idle.after, mode: 'propose',
    threadId: comment.thread.id, expectedRevision: current.revision, expectedCommentsRevision: comment.commentsRevision,
  }, { credential: agentCredential(world, agent.id) });
  return proposed.proposal;
}

// Screen points of a phrase of the document body, found from the rendered text (the way a person aims at it).
async function phrasePoints(page, phrase) {
  const points = await page.eval(needle => {
    const body = document.querySelector('[data-void-body]');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.nodeValue.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + needle.length);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
      if (!rects.length) continue;
      const first = rects[0], last = rects.at(-1);
      return { from: { x: first.left + 1, y: first.top + first.height / 2 }, to: { x: last.right - 1, y: last.top + last.height / 2 }, right: { x: last.right + 2, y: last.top + last.height / 2 } };
    }
    return null;
  }, phrase);
  if (!points) throw new Error(`The phrase "${phrase}" is not in the document body.`);
  return points;
}

// Select a phrase of the document with the mouse: press at its start, drag to its end.
export async function selectPhrase(page, phrase) {
  const { from, to } = await phrasePoints(page, phrase);
  await page.drag(from, to);
}

// Put the caret at the end of a phrase: click just after its last character.
export async function caretAfter(page, phrase) {
  const { right } = await phrasePoints(page, phrase);
  await page.click(right);
}

// Hold the save requests of the open text until `release()` is called (the save stays in flight, so the toolbar keeps saying Saving).
export async function holdSaves(page, resourceId) {
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const off = await page.route(request => request.method === 'PUT' && request.url.includes(`/void/texts/${resourceId}`), async () => { await gate; return 'continue'; });
  return { release: () => { release(); off(); } };
}

// Make the repository unavailable for saves: the request of the save never reaches the folder (the connection is refused).
export async function failSaves(page, resourceId) {
  let failing = true;
  const off = await page.route(request => failing && request.method === 'PUT' && request.url.includes(`/void/texts/${resourceId}`), () => 'fail');
  return { restore: () => { failing = false; off(); } };
}
