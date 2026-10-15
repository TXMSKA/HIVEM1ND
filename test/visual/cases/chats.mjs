// Flow board, row 3: chats and Waiting. Every state is reached through the GUI on the actual core; the world it needs
// is prepared through the HTTP API (accepted repositories, agents, an Overseer, conversations, an approval request made
// by the agent, a task awaiting review, a live session) and the faults the steps name are injected with page.route and
// the core's injected clock.
import {
  SHOP_EXECUTOR, SHOP_EXECUTOR_2, askBuild, askSession, chatRow, chatsBoot, messagesOf, noteWorkStep, openChatRow, openChats, openUnit, pinChat, readAs, reviewTask, say, seedChats, seedLaptopAgent, sendsMessage, showTab, startSession, unitToken,
} from '../chats-helpers.mjs';

const MESSAGE = 'Please build the empty cart state.';

export const cases = {
  '3.1': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const { world } = ctx;
      const { shop, a, chat } = await seedChats(world);
      ctx.units = { a };
      await say(world, chat.id, MESSAGE);
      await say(world, chat.id, 'The empty cart state is drafted. I need to run the build next.', unitToken(world, a));
      await askBuild(world, a, chat.id);
      await reviewTask(world, a, '029', 'Cart empty state', { lead: 'overlord-shop' });
      await say(world, shop.chatId, 'Where are we with the cart empty state?');
      await pinChat(world, chat);
      ctx.chat = chat;
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.units.a, 2);
      await showTab(ctx, 'chats', '.row-chat');
      await openChatRow(ctx, ctx.chat.id, 2);
    },
  },

  '3.2': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.chat = seeded.chat;
      await say(ctx.world, seeded.chat.id, 'The cart total is on the branch.');
    },
    async reach(ctx) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      ctx.defer(() => release());
      await openChats(ctx, [SHOP_EXECUTOR]);
      await showTab(ctx, 'chats', '.row-chat');
      await openChatRow(ctx, ctx.chat.id, 1);
      await ctx.page.route(sendsMessage, () => held.then(() => 'continue'));
      await ctx.page.click('input[data-composer]');
      await ctx.page.type('Please build the empty cart state.');
      await ctx.page.click('[data-action="send"]');
      await ctx.visible('[data-message][data-pending="true"]', { text: 'Please build the empty cart state.', timeout: 15000 });
      await ctx.visible('[data-send-state="sending"]');
    },
  },

  '3.3': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'Ship the empty state.');
      const sent = await messagesOf(ctx.world, seeded.chat.id);
      await readAs(ctx.world, seeded.chat.id, seeded.a, sent.map(message => message.id));
      await say(ctx.world, seeded.chat.id, 'Delivered the empty state.', unitToken(ctx.world, seeded.a));
      noteWorkStep(ctx.world);
      ctx.session = await startSession(ctx.world, seeded.a);
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.unit, 2);
      await ctx.page.click('[data-action="session-work"]');
      await ctx.visible('[data-session-work] .work-step', { timeout: 30000 });
      await ctx.visible('[data-action="stop-step"]');
    },
  },

  '3.4': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      ctx.child = seeded.b;
      await say(ctx.world, seeded.chat.id, 'Open a session for the second executor.');
      const started = await startSession(ctx.world, seeded.a);
      await askSession(ctx.world, seeded.a, started.sessionId, seeded.b);
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR, SHOP_EXECUTOR_2]);
      await openUnit(ctx, ctx.unit, 1);
      await ctx.visible('.inspector [data-approval]', { text: 'codex', timeout: 30000 });
      await ctx.visible('.inspector [data-approval] [data-action="approve"]');
    },
  },

  '3.5': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.chat = seeded.chat;
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'Did the empty state land?');
      const first = await messagesOf(ctx.world, seeded.chat.id);
      await readAs(ctx.world, seeded.chat.id, seeded.a, first.map(message => message.id));
      await say(ctx.world, seeded.chat.id, 'Yes. The empty state is on the branch.', unitToken(ctx.world, seeded.a));
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await showTab(ctx, 'chats', '.row-chat');
      await openChatRow(ctx, ctx.chat.id, 2);
      await ctx.visible('[data-send-state="readReceipt"]');
    },
  },

  '3.6': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.chat = seeded.chat;
    },
    async reach(ctx) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      ctx.defer(() => release());
      await openChats(ctx, [SHOP_EXECUTOR]);
      await showTab(ctx, 'chats', chatRow(ctx.chat.id));
      await ctx.page.click(chatRow(ctx.chat.id));
      await ctx.visible(`input[data-composer]`);
      await ctx.page.route(sendsMessage, () => held.then(() => 'fail'));
      await ctx.page.click('input[data-composer]');
      await ctx.page.type('This acknowledgment will not return.');
      await ctx.page.click('[data-action="send"]');
      const copy = ctx.es ? 'Sin confirmar' : 'Not confirmed';
      await ctx.visible('[data-send-state="notConfirmed"]', { text: copy, timeout: 20000 });
    },
  },

  '3.7': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.laptop = await seedLaptopAgent(ctx.world, seeded.blog);
      const chat = await ctx.world.call('POST', '/chats', { members: [ctx.laptop.id] });
      await say(ctx.world, chat.id, 'The laptop still has the checkout notes.');
      ctx.chat = chat;
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR, ctx.laptop.id]);
      await openUnit(ctx, ctx.laptop, 1);
      await ctx.visible('.inspector', { text: 'LAPTOP' });
    },
  },

  '3.8': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'I need the build.');
      await askBuild(ctx.world, seeded.a, seeded.chat.id);
      await reviewTask(ctx.world, seeded.a, '029', 'Cart empty state');
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await ctx.page.click('[data-action="waiting"]');
      await ctx.visible('[data-waiting-item]', { timeout: 30000 });
      await ctx.page.click('[data-waiting-item]');
      await ctx.visible('[data-waiting-record] [data-approval], [data-waiting-record] [data-task]', { timeout: 30000 });
    },
  },

  '3.9': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'Run the build when you can.');
      await askBuild(ctx.world, seeded.a, seeded.chat.id);
    },
    async reach(ctx) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      ctx.defer(() => release());
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.unit, 1);
      await ctx.page.route(request => request.method === 'POST' && /\/approvals\/[^/]+\/answer$/.test(new URL(request.url).pathname), () => held.then(() => 'continue'));
      await ctx.visible('.inspector [data-action="approve"]');
      await ctx.page.click('.inspector [data-action="approve"]');
      await ctx.visible('[data-approval-progress]', { timeout: 15000 });
    },
  },

  '3.10': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'The delivery is ready.');
      ctx.task = await reviewTask(ctx.world, seeded.a, '030', 'Cart empty state');
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.unit, 1);
      await ctx.visible(`.inspector [data-task="${ctx.task}"] [data-note]`);
      await ctx.page.click(`[data-note="${ctx.task}"]`);
      await ctx.page.type('The empty illustration is still the old one.');
      await ctx.page.waitFor(id => !document.querySelector(`[data-task="${id}"] [data-action="send-back"]`)?.disabled, { args: [ctx.task], message: 'Send back to be enabled' });
    },
  },

  '3.11': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'Please accept the delivery.');
      ctx.task = await reviewTask(ctx.world, seeded.a, '031', 'Cart empty state');
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.unit, 1);
      await ctx.visible(`.inspector [data-task="${ctx.task}"] [data-action="accept"]`);
      await ctx.page.click(`.inspector [data-task="${ctx.task}"] [data-action="accept"]`);
      await ctx.visible(`[data-task="${ctx.task}"][data-task-status="done"]`, { timeout: 30000 });
    },
  },
};
