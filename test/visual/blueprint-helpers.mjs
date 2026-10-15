// Shared preconditions for the Blueprint captures (row 4). Everything here goes through the actual core's HTTP API, the
// way a person's earlier work would have: repositories accepted, boards and library folders created, comments left.
// The state a capture shows is always reached through the GUI afterwards.
import { addScreen, newSketch } from '../../features/blueprint/review/sketch-format.mjs';
import { until } from './chrome.mjs';
import { acceptRepositories, agentCredential, createAgent, createOverseer } from './seed.mjs';

export const PROJECTS = ['shop', 'blog', 'api-gateway', 'nova'];

const box = (id, name, place, w, h, extra = {}) => ({ id, name, t: 'box', dir: 'stack', place, w, h, kids: [], ...extra });
const text = (id, name, place, w, h, value, extra = {}) => ({ id, name, t: 'text', place, w, h, value, size: 14, weight: 400, color: '#1c1c1c', align: 'left', ...extra });

// A cart screen built the way the board's sample is: a heading, two item cards and a Continue shopping button
// (a button surface that holds the text node named Button, 160 by 40).
export function cartScreen(document, { id = 'cart-screen', title = 'Cart', x = 0, y = 0 } = {}) {
  const screen = addScreen(document, { title, x, y, w: 300, h: 560, id });
  const root = screen.root;
  root.kids.push(
    text(`${id}-heading`, 'Heading', { x: 20, y: 24 }, 260, 32, 'Your cart', { size: 24, weight: 600 }),
    text(`${id}-count`, 'Item count', { x: 20, y: 64 }, 260, 20, '2 items'),
    box(`${id}-item-1`, 'Item 1', { x: 20, y: 100 }, 260, 80, { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 1, radius: 10 }),
    box(`${id}-item-2`, 'Item 2', { x: 20, y: 196 }, 260, 80, { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 1, radius: 10 }),
    text(`${id}-total`, 'Total', { x: 20, y: 300 }, 260, 24, 'Total  $48.00', { size: 16, weight: 600 }),
  );
  const surface = box(`${id}-button-surface`, 'Button surface', { x: 70, y: 480 }, 160, 40, { fill: '#2563eb', radius: 8 });
  surface.kids.push(text(`${id}-button`, 'Button', { x: 0, y: 0 }, 160, 40, 'Continue shopping', { size: 18, weight: 600, color: '#ffffff', align: 'center' }));
  root.kids.push(surface);
  return screen;
}

export function checkoutScreen(document, { id = 'checkout-screen', title = 'Checkout', x = 400, y = 0 } = {}) {
  const screen = addScreen(document, { title, x, y, w: 300, h: 560, id });
  screen.root.kids.push(
    text(`${id}-heading`, 'Heading', { x: 20, y: 24 }, 260, 32, 'Checkout', { size: 24, weight: 600 }),
    box(`${id}-address`, 'Address card', { x: 20, y: 80 }, 260, 120, { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 1, radius: 10 }),
    box(`${id}-payment`, 'Payment card', { x: 20, y: 216 }, 260, 120, { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 1, radius: 10 }),
  );
  return screen;
}

export function cartDocument(id = 'cart', title = 'Cart') {
  const document = newSketch(id, title);
  cartScreen(document);
  checkoutScreen(document);
  return document;
}

export function plainDocument(id, title) {
  const document = newSketch(id, title);
  const screen = addScreen(document, { title, x: 0, y: 0, w: 300, h: 560, id: `${id}-screen` });
  screen.root.kids.push(text(`${id}-heading`, 'Heading', { x: 20, y: 24 }, 260, 32, title, { size: 24, weight: 600 }));
  return document;
}

export async function createBoard(world, project, document, { folderId = null, attached = [] } = {}) {
  return world.call('POST', '/blueprint/boards', { project, document, folderId, ...(attached.length ? { attached } : {}) }, {}, [201]);
}

export async function createFolder(world, project, title, { parentId = null, revision = null } = {}) {
  const result = await world.call('POST', '/library/folders', { project, kind: 'blueprint', title, parentId, expectedRevision: revision }, {}, [201]);
  return result;
}

export function readBoard(world, id) {
  return world.call('GET', `/blueprint/boards/${id}`);
}

// The library every Blueprint capture starts from: four accepted repositories and boards in three of them.
export async function seedLibrary(world, { comments = false } = {}) {
  const clusters = await acceptRepositories(world, PROJECTS);
  const flows = await createFolder(world, 'shop', 'Flows');
  const cart = await createBoard(world, 'shop', cartDocument('cart', 'Cart'), { folderId: flows.folder.id });
  const settings = await createBoard(world, 'shop', plainDocument('settings', 'Settings'));
  const home = await createBoard(world, 'blog', plainDocument('home', 'Blog home'));
  const preview = await createBoard(world, 'blog', plainDocument('cart-preview', 'Cart preview'));
  const routes = await createBoard(world, 'api-gateway', plainDocument('routes', 'Routes'));
  const boards = { cart, settings, home, preview, routes, flows: flows.folder, clusters };
  if (comments) await addComment(world, preview, 'The cart total needs a currency symbol.');
  return boards;
}

export async function addComment(world, board, body, { label = 'Board', sendToAgent = false } = {}) {
  const current = await readBoard(world, board.id);
  return world.call('POST', `/editors/${board.id}/comments`, {
    anchor: { screen: null, screenTitle: null, element: null, label, path: [label], point: { x: 40, y: 40 } },
    text: body, sendToAgent, expectedRevision: current.revision, expectedCommentsRevision: current.commentsRevision,
  }, {}, [201]);
}

// The page opens in the Blueprint mode with the library read.
export async function openBlueprint(ctx, { overseerExists = false } = {}) {
  await ctx.open({ overseerExists });
  await ctx.page.click('[data-action="mode-blueprint"]');
  await ctx.visible('[data-library="blueprint"] .library-item-select');
}

export async function selectBoard(ctx, id) {
  await ctx.page.click(`.library-item-select[data-id="${id}"]`);
  await ctx.visible('.board-host .board-svg');
  await ctx.page.waitFor(resourceId => document.querySelector('.library-item-select[aria-pressed="true"]')?.getAttribute('data-id') === resourceId && !document.querySelector('[data-activity]'), { message: 'the board to be open', args: [id] });
}

// ---- the wider world a board lives in: an Overseer, the shop cluster with its agents, attachments --------------------

export async function seedWorld(world, { comments = [], attach = null } = {}) {
  const library = await seedLibrary(world);
  const shop = library.clusters.find(cluster => cluster.title === 'shop');
  const executor = await createAgent(world, shop.id, 'executor');
  const overlord = await createAgent(world, shop.id, 'overlord');
  await createOverseer(world);
  const state = { ...library, shop, executor, overlord, units: { executor: executor.id, overlord: overlord.id } };
  for (const [name, text] of comments) await addComment(world, library[name], text);
  if (attach) await attachUnits(world, library.cart, attach === true ? [executor.id] : attach);
  return state;
}

export async function attachUnits(world, board, attached) {
  const current = await readBoard(world, board.id);
  return world.call('PUT', `/editors/${board.id}/attachments`, { attached, expectedRevision: current.attachmentRevision });
}

// Calls made as an attached unit, the way the unit's own session writes to a board.
export function asUnit(world, unitId) {
  const credential = agentCredential(world, unitId);
  return (method, target, body, expected = [200, 201]) => world.call(method, target, body, { credential }, expected);
}

export function nodePoint(page, nodeId, at = [0.5, 0.5]) {
  return page.point(`[data-node="${nodeId}"]`, { at });
}

// Select a board element the way a person does: click it on the canvas, then wait until the element bar names it. A click
// that lands while the canvas is still settling can pick a neighbour, so the click is repeated until the right one is chosen.
export async function selectNode(ctx, nodeId, name) {
  await until(async () => {
    await ctx.page.click(`[data-node="${nodeId}"]`);
    return ctx.page.waitFor(wanted => document.querySelector('.board-host .board-selection') && document.querySelector('.board-element-bar strong')?.textContent === wanted, { timeout: 1500, args: [name] }).then(() => true, () => false);
  }, { message: `${name} to be selected` });
}

export async function settleBoard(ctx) {
  await ctx.page.waitFor(() => !document.querySelector('[data-activity]') && !document.querySelector('.board-host[aria-busy="true"]'), { message: 'board saves to finish' });
}

// The board repaints its overlays (selection, popover) once after a render, which replaces the field a person just
// clicked; typing is retried until the field really holds the text, the way a person would notice and click again.
export async function typeInto(page, selector, value) {
  await until(async () => {
    await page.fill(selector, value);
    return page.eval((sel, wanted) => document.querySelector(sel)?.value === wanted, selector, value);
  }, { message: `the text to be typed into ${selector}` });
}

// ---- what an attached unit draws ------------------------------------------------------------------------------------

// The dashed hand frame the Draw tool makes, built the way an agent would write it into the board document.
export function addHandFrame(document, { id = 'sketch-agent', x = 800, y = 20 } = {}) {
  const screen = addScreen(document, { title: 'Hand sketch', x, y, w: 300, h: 560, id, fill: '#2c2533' });
  Object.assign(screen.root, { radius: 18, clip: true, stroke: '#bdcd79', strokeWidth: 2.2, sketch: true, dash: '6 5' });
  return screen;
}

// A freehand stroke through points given in the frame's coordinates, as the parent-relative vector node a pen makes.
export function penStroke(id, points, stroke = '#bdcd79') {
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
  const d = points.map(([px, py], index) => `${index ? 'L' : 'M'}${((px - x) * 100 / w).toFixed(2)} ${((py - y) * 100 / h).toFixed(2)}`).join(' ');
  return { id, name: 'Pen stroke', t: 'vector', kind: 'pen', place: { x, y }, w, h, d, fill: 'none', stroke, strokeWidth: 2.2, opacity: 1 };
}

// The unit commits a drawing: the sketch frame first, then a stroke inside it (the stroke carries the focus a watcher follows).
export async function agentDraws(world, unitId, boardId, { frame = 'sketch-agent', points = [[40, 120], [90, 70], [150, 140], [210, 80], [260, 150]] } = {}) {
  const call = asUnit(world, unitId);
  const board = await readBoard(world, boardId);
  const document = structuredClone(board.document);
  const screen = addHandFrame(document, { id: frame });
  const framed = await call('PUT', `/blueprint/boards/${boardId}`, { document, expectedRevision: board.revision });
  await call('POST', `/blueprint/boards/${boardId}/nodes`, { screenId: screen.id, parentId: screen.root.id, node: penStroke(`${frame}-stroke`, points), expectedRevision: framed.revision });
  return { frame: screen, stroke: `${frame}-stroke` };
}

export async function agentReplies(world, unitId, boardId, threadId, body) {
  const call = asUnit(world, unitId);
  const current = await readBoard(world, boardId);
  return call('POST', `/editors/${boardId}/comments/${threadId}/replies`, { text: body, sendToAgent: false, expectedCommentsRevision: current.commentsRevision });
}

// A comment the person left on a board element, addressed to the attached units.
export async function personComments(world, board, anchor, body, sendToAgent = true) {
  const current = await readBoard(world, board.id);
  return world.call('POST', `/editors/${board.id}/comments`, { anchor, text: body, sendToAgent, expectedRevision: current.revision, expectedCommentsRevision: current.commentsRevision }, {}, [201]);
}

export const HEADING_ANCHOR = { screen: 'cart-screen', screenTitle: 'Cart', element: 'cart-screen-heading', label: 'Heading', path: ['Cart', 'Heading'], point: { x: 20, y: 24 } };
