// Row 4: Blueprint. Boards live in repositories, so each case accepts the fixture repositories and creates the boards
// (and, where the step presupposes them, library folders, attached units and comments) through the actual core's API.
// The state itself is reached through the GUI: Blueprint mode, library clicks, canvas pointer events and keys.
import { until } from '../chrome.mjs';
import { agentDraws, asUnit, agentReplies, attachUnits, HEADING_ANCHOR, openBlueprint, personComments, selectBoard, selectNode, seedWorld, settleBoard, typeInto } from '../blueprint-helpers.mjs';

const BUTTON = 'cart-screen-button';
const ITEM = 'cart-screen-item-1';

// Every case opens on the shop Cart board, which is selected unless the step is about the library alone.
async function openCart(ctx, { select = true } = {}) {
  await openBlueprint(ctx, { overseerExists: true });
  if (select) await selectBoard(ctx, ctx.state.cart.id);
  await settleBoard(ctx);
}

// Library item menus open from the More control of a row.
async function openItemMenu(ctx, id) {
  await ctx.page.click(`[data-library-more="${id}"]`);
  await ctx.visible('[data-library-menu="item"]');
}

const seeded = options => async ctx => { ctx.state = await seedWorld(ctx.world, options); };

export const cases = {
  '4.1': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      await openCart(ctx);
      await ctx.visible('[data-empty="comments"]');
      await ctx.visible('[data-action="attach"]');
    },
  },

  '4.2': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      await openCart(ctx);
      await openItemMenu(ctx, ctx.state.cart.id);
      await ctx.visible('[data-action="library-delete"]');
    },
  },

  '4.3': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      await openCart(ctx);
      await ctx.page.click('[data-action="open-create"][data-kind="blueprint"]');
      await ctx.visible('[data-form="library-create"] [data-field="create-title"]');
      await ctx.visible('[data-form="library-create"] input[name="creation"]');
    },
  },

  '4.4': {
    entry: 'none',
    seed: seeded({ comments: [['cart', 'The cart total needs a currency symbol.'], ['preview', 'Show the cart count in the header.']] }),
    async reach(ctx) {
      const { page } = ctx;
      await openCart(ctx);
      await page.fill('[data-library-search="blueprint"]', 'cart');
      await ctx.visible('.library-item-select', { text: 'Cart' });
      await page.click('[data-action="library-filters"]');
      await ctx.visible('[data-library-menu="filters"]');
      await page.click('[data-action="library-open-comments"]');
      await ctx.visible('[data-filter-chip="openComments"]');
      await page.waitFor(() => document.querySelector('[data-action="library-open-comments"]')?.getAttribute('aria-checked') === 'true' && !document.querySelector('[data-activity]') && document.querySelectorAll('.library-item').length > 0, { message: 'the filtered library to settle' });
    },
  },

  '4.5': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      const { page } = ctx;
      await openCart(ctx);
      await openItemMenu(ctx, ctx.state.cart.id);
      await page.click('[data-action="library-move"]');
      await ctx.visible('[data-form="library-move"] select[name="project"]');
      await page.eval(() => {
        const select = document.querySelector('[data-form="library-move"] select[name="project"]');
        select.value = 'api-gateway';
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.click('[data-form="library-move"] [data-action="confirm-form"]');
      await ctx.visible('[data-library-repository-confirm]');
    },
  },

  '4.6': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      await openCart(ctx);
      await openItemMenu(ctx, ctx.state.cart.id);
      await ctx.page.click('[data-action="library-delete"]');
      await ctx.visible('[data-library-delete="item"]');
    },
  },

  '4.7': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      await openCart(ctx);
      await selectNode(ctx, BUTTON, 'Button');
      await ctx.visible('.board-resize[data-resize="se"]');
    },
  },

  '4.8': {
    entry: 'none',
    seed: seeded({ attach: true }),
    async reach(ctx) {
      const { page } = ctx;
      await openCart(ctx);
      // Choosing Draw adds the dashed sketch frame beside the last screen and saves it.
      await page.click('[data-board-tool="draw"]');
      await ctx.visible('[data-draw-tool="pen"][aria-pressed="true"]');
      await page.waitFor(() => document.querySelectorAll('.board-svg [data-screen]').length === 3 && !document.querySelector('[data-activity]'), { message: 'the sketch frame to be saved' });
      const frame = await sketchFrame(page);
      // A pen stroke and a marker stroke inside the frame, drawn with the pointer.
      await strokeAlong(page, frame, [[50, 110], [90, 80], [140, 130], [190, 90], [240, 140]]);
      await page.waitFor(() => document.querySelectorAll('.board-svg path[data-kind="pen"]').length === 1 && !document.querySelector('[data-activity]'), { message: 'the pen stroke to be saved' });
      await page.click('[data-draw-tool="marker"]');
      await strokeAlong(page, frame, [[60, 220], [120, 280], [180, 230], [230, 300]]);
      await page.waitFor(() => document.querySelectorAll('.board-svg path[data-kind="pen"]').length === 2 && !document.querySelector('[data-activity]'), { message: 'the marker stroke to be saved' });
      await page.click('[data-draw-tool="pen"]');
      await ctx.visible('[data-draw-tool="pen"][aria-pressed="true"]');
    },
  },

  '4.9': {
    entry: 'none',
    seed: seeded({}),
    async reach(ctx) {
      const { page } = ctx;
      await openCart(ctx);
      await page.click('[data-action="attach"]');
      await ctx.visible('[data-form="attach"] [data-attach-unit]');
      // One unit and the cluster that holds it: the group expands to its two members, so the count is 2, not 3.
      await page.click(`[data-attach-unit="${ctx.state.units.executor}"]`);
      await page.click(`[data-attach-group="group:${ctx.state.shop.id}"]`);
      await page.waitFor(() => document.querySelector('[data-form="attach"] [data-action="save-attachments"]')?.textContent.trim().endsWith('2'), { message: 'the Attach button to count 2' });
    },
  },

  '4.10': {
    entry: 'none',
    seed: async ctx => { ctx.state = await seedWorld(ctx.world, {}); await attachUnits(ctx.world, ctx.state.cart, [ctx.state.units.executor, ctx.state.units.overlord]); },
    async reach(ctx) {
      await openCart(ctx);
      await startComment(ctx, 'Show the item price and a remove link here.');
    },
  },

  '4.11': {
    entry: 'none',
    seed: async ctx => { ctx.state = await seedWorld(ctx.world, {}); await attachUnits(ctx.world, ctx.state.cart, [ctx.state.units.executor, ctx.state.units.overlord]); },
    async reach(ctx) {
      const { page } = ctx;
      await openCart(ctx);
      await startComment(ctx, 'Show the item price and a remove link here.');
      await page.click('.board-comment-actions button:last-child');
      await ctx.visible('[data-thread] .comment-text');
      await ctx.visible('.board-comment-pin');
      await page.waitFor(() => !document.querySelector('.board-comment-popover') && !document.querySelector('[data-activity]'), { message: 'the comment to be sent' });
    },
  },

  '4.12': {
    entry: 'none',
    async seed(ctx) {
      ctx.state = await seedWorld(ctx.world, { attach: true });
      ctx.thread = (await personComments(ctx.world, ctx.state.cart, HEADING_ANCHOR, 'Can the heading say how many items are in the cart?')).thread;
    },
    async reach(ctx) {
      const { page, state } = ctx;
      await openCart(ctx);
      await page.click('[data-action="watch"]');
      await ctx.visible('[data-watch="waiting"]');
      // The attached unit commits a drawing into the board, then answers the comment; the page follows it.
      const drawn = await agentDraws(ctx.world, state.units.executor, state.cart.id);
      await agentReplies(ctx.world, state.units.executor, state.cart.id, ctx.thread.id, 'Done, the heading now counts the items. I also sketched the empty state.');
      await ctx.visible('[data-watch="watching"]');
      await page.waitFor(stroke => !!document.querySelector(`.board-svg [data-node="${stroke}"]`), { message: 'the stroke drawn by the unit', args: [drawn.stroke] });
      await ctx.visible('[data-thread] .comment-text', { text: 'sketched the empty state' });
    },
  },

  '4.13': {
    entry: 'none',
    seed: seeded({ attach: true }),
    async reach(ctx) {
      const { page, state, world } = ctx;
      await openCart(ctx);
      await selectNode(ctx, ITEM, 'Item 1');
      // The person is part-way through moving the first item card (pointer still down) when the attached unit commits a change to it.
      const from = await page.point(`[data-node="${ITEM}"]`);
      await page.mouseEvent('mouseMoved', from.x, from.y);
      await page.mouseEvent('mousePressed', from.x, from.y, { button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 8; step += 1) await page.mouseEvent('mouseMoved', from.x + step * 4, from.y - step * 3, { button: 'left', buttons: 1 });
      const board = await world.call('GET', `/blueprint/boards/${state.cart.id}`);
      await asUnit(world, state.units.executor)('PATCH', `/blueprint/boards/${state.cart.id}/nodes/${ITEM}`, { changes: { fill: '#fde68a' }, expectedRevision: board.revision });
      // The canvas repaints on pointer moves, so the conflict shows as soon as the page has read the unit's change.
      let wiggle = 0;
      await until(async () => {
        await page.mouseEvent('mouseMoved', from.x + 32 + (wiggle % 2), from.y - 24, { button: 'left', buttons: 1 });
        wiggle += 1;
        return page.eval(() => !!document.querySelector('.board-conflict'));
      }, { message: 'the conflict banner' });
      await page.mouseEvent('mouseReleased', from.x + 32, from.y - 24, { button: 'left', buttons: 0, clickCount: 1 });
      await ctx.visible('.board-conflict [data-action="reapply-draft"]');
      // Send to agent is switched off for the note the person is about to write.
      await page.click('[data-send-to-agent="blueprint"]');
      await page.waitFor(() => document.querySelector('[data-send-to-agent="blueprint"]')?.checked === false && /./.test(document.querySelector('.comment-preference-hint')?.textContent ?? '') && !!document.querySelector('.board-conflict') && !document.querySelector('[data-activity]'), { message: 'Send to agent to be off with the conflict still shown' });
    },
  },

  '4.14': {
    entry: 'none',
    async seed(ctx) {
      const { world } = ctx;
      // Creation (the seeded board), a comment, an attached unit's drawing, then the person's answer to a conflict with it.
      ctx.state = await seedWorld(world, { attach: true });
      const { cart, units } = ctx.state;
      await personComments(world, cart, HEADING_ANCHOR, 'Can the heading say how many items are in the cart?');
      await agentDraws(world, units.executor, cart.id);
      const incoming = await world.call('GET', `/blueprint/boards/${cart.id}`);
      const draft = structuredClone(incoming.document);
      draft.screens.find(screen => screen.id === 'cart-screen').root.kids.find(node => node.id === ITEM).place.y += 8;
      await world.call('POST', `/editors/${cart.id}/conflict`, { decision: 'keep-mine', document: draft, expectedRevision: incoming.revision, expectedCommentsRevision: incoming.commentsRevision });
    },
    async reach(ctx) {
      await openCart(ctx);
      await ctx.page.click('[data-action="editor-history"]');
      await ctx.visible('.editor-history .history-row');
      await ctx.page.waitFor(() => document.querySelectorAll('.editor-history .history-row').length >= 5 && document.querySelector('[data-action="editor-history"]')?.getAttribute('aria-expanded') === 'true', { message: 'the version rows' });
    },
  },
};

// Select the first item card, press C and write a draft in the popover that opens next to it.
async function startComment(ctx, draft) {
  const { page } = ctx;
  await selectNode(ctx, ITEM, 'Item 1');
  await page.focus(`[data-node="${ITEM}"]`);
  await page.press('c');
  await ctx.visible('.board-comment-popover textarea[data-board-comment]');
  await typeInto(page, '.board-comment-popover textarea[data-board-comment]', draft);
  await page.waitFor(() => !document.querySelector('.board-comment-popover .btn.primary')?.disabled, { message: 'the Comment button to enable' });
}

// The dashed hand frame is the one screen whose id starts with sketch-; its paper is the screen background rect.
async function sketchFrame(page) {
  return page.waitFor(() => {
    const group = document.querySelector('.board-svg [data-screen^="sketch-"]');
    const rect = group?.querySelector('.board-screen-background')?.getBoundingClientRect();
    return rect && rect.width > 0 ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height, scale: rect.width / 300 } : null;
  }, { message: 'the sketch frame' });
}

// Draw with the pointer along points given in the frame's own 300 by 560 coordinates.
async function strokeAlong(page, frame, points) {
  const at = ([x, y]) => [frame.x + x * frame.scale, frame.y + y * frame.scale];
  const [first, ...rest] = points.map(at);
  await page.mouseEvent('mouseMoved', first[0], first[1]);
  await page.mouseEvent('mousePressed', first[0], first[1], { button: 'left', buttons: 1, clickCount: 1 });
  let last = first;
  for (const next of rest) {
    for (let step = 1; step <= 6; step += 1) await page.mouseEvent('mouseMoved', last[0] + (next[0] - last[0]) * step / 6, last[1] + (next[1] - last[1]) * step / 6, { button: 'left', buttons: 1 });
    last = next;
  }
  await page.mouseEvent('mouseReleased', last[0], last[1], { button: 'left', buttons: 0, clickCount: 1 });
}
