// Flow board, row 7: the phone. The phone opens the home listener the way a handset does and types the code.
// The code stays in memory; the cells and the field are masked before the PNG is stored.
import { until } from '../chrome.mjs';
import { openPairing, openPhoneAccess, pairWithCode, presentLikeViewer, seedPhoneWorld, typeCode, wrongCode } from '../phone-helpers.mjs';

const PAIRING = { en: 'Open your M1ND', es: 'Abrir la M1ND' };

function maskCode(ctx) {
  ctx.mask('[data-home-code]', '.phone-code-cell');
}

// Pairing is drawn before a viewer exists. The capture presents the stored language, else the browser languages,
// before the page scripts run. Signed-in screens still read the language set on the shared Settings.
async function requirePairingLanguage(ctx) {
  const wanted = ctx.es ? PAIRING.es : PAIRING.en;
  const shown = await ctx.page.eval(() => document.querySelector('.phone-gate h1')?.textContent?.trim() ?? '');
  if (shown !== wanted) throw new Error(`The pairing screen is shown as "${shown}", not "${wanted}".`);
}

async function prepare(ctx, options = {}) {
  await seedPhoneWorld(ctx, options);
  await presentLikeViewer(ctx);
  await openPhoneAccess(ctx);
}

export const cases = {
  '7.1': {
    entry: 'none',
    seed: ctx => prepare(ctx, { ask: false, review: false }),
    async reach(ctx) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      ctx.defer(() => release());
      await ctx.page.route(request => request.method === 'POST' && new URL(request.url).pathname === '/api/v1/auth/home', () => held.then(() => 'continue'));
      await openPairing(ctx);
      await requirePairingLanguage(ctx);
      await typeCode(ctx, ctx.home.grant.shortCode);
      await ctx.visible('.phone-code-form button[aria-busy="true"]', { timeout: 15000 });
      maskCode(ctx);
    },
  },

  '7.2': {
    entry: 'none',
    seed: ctx => prepare(ctx, { ask: false, review: false }),
    async reach(ctx) {
      await openPairing(ctx);
      await requirePairingLanguage(ctx);
      await typeCode(ctx, wrongCode(ctx));
      const copy = ctx.es ? 'El código no coincide.' : 'That code does not match.';
      await ctx.visible('[data-phone-state="error"]', { text: copy, timeout: 20000 });
      maskCode(ctx);
    },
  },

  '7.3': {
    entry: 'none',
    seed: ctx => prepare(ctx, { ask: false, review: false }),
    async reach(ctx) {
      await openPairing(ctx);
      await requirePairingLanguage(ctx);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await typeCode(ctx, wrongCode(ctx));
        if (attempt < 4) await ctx.visible('[data-phone-state="error"]', { timeout: 20000 });
      }
      await ctx.visible('[data-phone-state="locked"]', { timeout: 20000 });
      maskCode(ctx);
    },
  },

  '7.4': {
    entry: 'none',
    seed: ctx => prepare(ctx),
    async reach(ctx) {
      await pairWithCode(ctx);
      await ctx.visible('.phone-nav', { text: ctx.es ? 'Jerarquía' : 'Hierarchy', timeout: 30000 });
      await ctx.visible('[data-row]');
    },
  },

  '7.5': {
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedPhoneWorld(ctx);
      const chat = await ctx.world.call('POST', '/chats', { members: [seeded.units.executorShop.id] });
      await ctx.world.call('POST', `/chats/${chat.id}/messages`, { body: 'The checkout is ready for a look.' });
      ctx.chat = chat;
      await presentLikeViewer(ctx);
      await openPhoneAccess(ctx);
    },
    async reach(ctx) {
      await pairWithCode(ctx);
      await ctx.page.click('[data-action="phone-chats"]');
      await ctx.page.eval(id => document.querySelector(`[data-row][data-id="${id}"]`)?.scrollIntoView({ block: 'center' }), ctx.chat.id);
      try {
        await ctx.visible(`[data-row][data-id="${ctx.chat.id}"]`, { timeout: 30000 });
      } catch (error) {
        const rows = await ctx.page.eval(() => [...document.querySelectorAll('[data-row]')].slice(0, 8).map(node => `${node.getAttribute('data-id') ?? ''} ${node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}`).join(' | ') || 'none');
        throw new Error(`${error.message} | rows: ${rows}`.replace(/\s+/g, ' '));
      }
      await ctx.page.click(`[data-row][data-id="${ctx.chat.id}"]`);
      await ctx.visible(`.transcript[data-chat="${ctx.chat.id}"] [data-message]`, { text: 'The checkout is ready for a look.', timeout: 30000 });
    },
  },

  '7.6': {
    entry: 'none',
    seed: ctx => prepare(ctx),
    async reach(ctx) {
      await pairWithCode(ctx);
      await ctx.page.click('[data-action="phone-waiting"]');
      await ctx.visible('[data-waiting-item]', { timeout: 30000 });
      await ctx.page.click('[data-waiting-item]');
      await ctx.visible('[data-waiting-record] [data-approval], [data-waiting-record] [data-task]', { timeout: 30000 });
    },
  },

  '7.7': {
    entry: 'none',
    seed: ctx => prepare(ctx, { ask: false, review: false }),
    async reach(ctx) {
      let streamConnected = false;
      ctx.page.on('Network.responseReceived', ({ response }) => {
        if (response.status === 200 && new URL(response.url).pathname === '/api/v1/events') streamConnected = true;
      });
      await pairWithCode(ctx);
      await until(() => streamConnected, { timeout: 30000, message: 'the phone event stream to connect' });
      await ctx.world.call('POST', '/settings/home-network', { enabled: false }, { key: ctx.world.key() });
      try {
        await ctx.visible('[data-phone-state="ended"]', { timeout: 20000 });
      } catch (error) {
        const note = await ctx.page.eval(() => `state=${document.querySelector('[data-phone-state]')?.getAttribute('data-phone-state') ?? 'none'} h1=${document.querySelector('h1, h2')?.textContent?.trim() ?? ''}`);
        throw new Error(`${error.message} | ${note}`.replace(/\s+/g, ' '));
      }
    },
  },
};
