// Row 6: Settings and the service. Every state is reached through the GUI on the actual core.
import path from 'node:path';
import { connectClient, openDesktop, openHome, openSettings, seedDesktop, settingsBoot, standingApproval, startRecoveryBridge } from '../settings-helpers.mjs';

const SHOP_NODE = '.map-node[data-unit-id="project:shop:executor-shop"]';

// Select executor-shop on the Map; the inspector shows its conversation and composer.
async function openShopChat(ctx) {
  await ctx.visible(SHOP_NODE);
  await ctx.page.click(SHOP_NODE);
  await ctx.visible('input[data-composer]', { timeout: 30000 });
}

// Type into the composer the way a person does and press Send.
async function sendFromComposer(ctx, text) {
  await ctx.page.click('input[data-composer]');
  await ctx.page.type(text);
  await ctx.page.click('[data-action="send"]');
}

export const cases = {
  '6.1': {
    // Press the gear. Home access is open with one phone signed in, so the expiry, the phone count and Close access show.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) {
      await seedDesktop(ctx);
      await openHome(ctx.world, { phones: 1 });
    },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'general');
      await ctx.visible('[data-home="open"] [data-phone-count]');
      await ctx.visible('[data-action="close-home"]');
    },
  },
  '6.2': {
    // Select Agents: five clients on this machine, three connected, Cursor needing two changes, Copilot not found.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'agents');
      await ctx.visible('[data-agent="copilot"]');
      await ctx.visible('[data-action="settings-review-cursor"]');
    },
  },
  '6.3': {
    // Press Review changes for Cursor: the Connect dialog opens, nothing has been written.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'agents');
      await ctx.page.click('[data-action="settings-review-cursor"]');
      await ctx.visible('dialog[data-settings-review="cursor"]', { timeout: 30000 });
      await ctx.visible('dialog[data-settings-review="cursor"] [data-action="settings-apply"]');
    },
  },
  '6.4': {
    // Open the machine picker: this machine with its check, and a second machine that is offline, read only.
    boot: settingsBoot({ laptop: true }),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'agents');
      await ctx.page.click('[data-action="settings-machine"]');
      await ctx.visible('.settings-machine-menu [data-machine-choice="DESKTOP"]');
      await ctx.visible('.settings-machine-menu [data-machine-choice="LAPTOP"] small');
    },
  },
  '6.5': {
    // Select Permissions: two standing approvals (Always for this unit) and one agent permission (Cursor, git).
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) {
      const { agents } = await seedDesktop(ctx);
      const { world } = ctx;
      await standingApproval(world, agents.executorShop.id, 'npm run build', world.fx.repositories.shop);
      await standingApproval(world, agents.overlordApi.id, 'npm test', path.join(world.home, 'Web', 'api-gateway'));
      await connectClient(world, 'cursor', 'on-demand', { git: true });
    },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'permissions');
      await ctx.visible('[data-permission]');
      await ctx.page.waitFor(() => document.querySelectorAll('[data-settings-page="permissions"] [data-permission]').length === 3, { message: 'two standing approvals and one agent permission' });
    },
  },
  '6.8': {
    // Select Content: features by category, knowledge packs, preferences.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'content');
      await ctx.page.waitFor(() => document.querySelectorAll('[data-settings-page="content"] [data-content-item]').length >= 13, { message: 'the features and knowledge packs' });
      await ctx.visible('[data-preference-instructions]');
    },
  },
  '6.9': {
    // Press Open on the phone: the QR and the six-character code. The code is replaced by bullets; the QR stays.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      await openDesktop(ctx);
      await openSettings(ctx, 'general');
      await ctx.page.click('[data-action="open-home"]');
      await ctx.visible('dialog[data-phone-dialog] svg[data-qr]', { timeout: 30000 });
      ctx.mask('dialog[data-phone-dialog] p[data-code]', 'dialog[data-phone-dialog] p[data-secret]');
    },
  },
  '6.10': {
    // Interrupt the service while a message is being sent: the Map and the chat stay, the line waits, the banner and footer say reconnecting.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) { await seedDesktop(ctx); },
    async reach(ctx) {
      const { page, world } = ctx;
      await openDesktop(ctx);
      await openShopChat(ctx);
      await page.click('input[data-composer]');
      await page.type('Run the checkout tests too.');
      // From here the service answers nothing: the send is held and every other request is refused.
      let held = null;
      const release = new Promise(resolve => { held = resolve; });
      ctx.defer(() => held());
      await page.route(request => request.url.includes('/api/v1/'), async request => {
        if (request.method === 'POST' && /\/chats\/[^/]+\/messages/.test(request.url)) { await release; return 'fail'; }
        return 'fail';
      });
      await page.click('[data-action="send"]');
      await ctx.visible('[data-message][data-pending="true"]');
      world.core.http.server.closeAllConnections();
      await ctx.visible('[data-service-banner="reconnecting"]', { timeout: 30000 });
      await ctx.visible('.foot [data-stream]');
    },
  },
  '6.11': {
    // Stop the owned service while the page is open: the Map stays, the banner says it stopped on DESKTOP.
    boot: settingsBoot({ extra: async fixture => ({ recoveryHosts: (fixture.recoveryHosts = new Map()) }) }),
    entry: 'none',
    async seed(ctx) {
      await seedDesktop(ctx);
      ctx.bridge = await startRecoveryBridge(ctx, ctx.world.fx.fixture.recoveryHosts);
    },
    async reach(ctx) {
      const { world, bridge } = ctx;
      // The viewer page is served at its own address, so its security policy lets it ask the launcher about the service.
      await ctx.open({ url: `${world.origin}/gui/${bridge.viewerId}/#session=${world.token}`, overseerExists: true });
      await ctx.visible(SHOP_NODE);
      await ctx.page.waitFor(() => Boolean(document.querySelector('.foot [data-service-machine]')), { message: 'the footer' });
      bridge.state.stopped = true;
      await world.core.http.close();
      await ctx.visible('[data-service-banner="stopped"]', { timeout: 60000 });
      await ctx.visible('[data-action="recover-service"]');
      await ctx.visible('[data-action="service-details"]');
    },
  },
  '6.12': {
    // A read that takes longer than usual: the notice shows with its elapsed seconds while the line and the draft stay.
    boot: settingsBoot(),
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedDesktop(ctx);
      const chat = await ctx.world.call('POST', '/chats', { members: [seeded.agents.executorShop.id] });
      for (let index = 0; index < 51; index += 1) await ctx.world.call('POST', `/chats/${chat.id}/messages`, { body: `Earlier note ${index}.` });
    },
    async reach(ctx) {
      const { page } = ctx;
      await openDesktop(ctx);
      await openShopChat(ctx);
      await sendFromComposer(ctx, 'Summarize what changed today.');
      await ctx.visible('[data-message][data-send-state], [data-message]');
      await page.waitFor(() => !document.querySelector('[data-message][data-pending="true"]') && Boolean(document.querySelector('[data-send-state]')), { timeout: 30000, message: 'the message to be stored' });
      await page.click('input[data-composer]');
      await page.type('Run the checkout tests too.');
      let held = null;
      const release = new Promise(resolve => { held = resolve; });
      ctx.defer(() => held());
      await page.route(request => request.method === 'GET' && /\/chats\/[^/]+\/messages/.test(request.url), async () => { await release; return 'continue'; });
      await page.click('[data-action="older"]');
      await ctx.visible('[data-activity-region] [data-action="cancel-activity"]');
      await page.waitFor(() => /\b12 s\b/.test(document.querySelector('[data-activity-region]')?.textContent ?? ''), { timeout: 40000, message: 'the notice to show 12 seconds' });
    },
  },
};
