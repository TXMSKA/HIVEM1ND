// Flow board, row 2: the Map. Every state is reached through the GUI on the actual core; the world it needs is
// prepared through the HTTP API (accepted repositories, agents, an Overseer, a chat, an approval request, a task).
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finalAdditionArchive } from '../../gui-data.mjs';
import { agentCredential, createAgent, createCluster, createOverseer } from '../seed.mjs';
import { directChat, heldStart, idOf, node, openMap, placeNodes, seedMap, setAlias, startFromInspector } from '../map-helpers.mjs';
import { openSettings } from '../settings-helpers.mjs';

const SHOP = idOf('shop', 'executor-shop');

export const cases = {
  '2.1': {
    entry: 'none',
    async seed(ctx) {
      const world = await seedMap(ctx.world);
      ctx.agents = world.agents;
      await setAlias(ctx.world, world.agents.shop[2], 'Checkout');
    },
    async reach(ctx) {
      await openMap(ctx, 5);
      await ctx.visible('.map-nodes .map-node[data-role="overseer"]');
      await ctx.visible('.map-actions [data-action="fit-map"]');
    },
  },
  '2.2': {
    entry: 'none',
    async seed(ctx) {
      const { world } = ctx;
      const seeded = await seedMap(world);
      const unit = seeded.agents.shop[1];
      const agent = agentCredential(world, unit.id);
      const chat = await directChat(world, unit, { messages: ['Start with the cart total.'], replies: ['The cart total is done. I need to run the build.'] }, agent);
      await world.call('POST', '/approvals/request', { action: 'process.run', pattern: { command: 'npm run build', cwd: 'project:shop' }, display: 'npm run build', alwaysAllowed: true, chatId: chat.id }, { credential: agent });
      const file = path.join(world.mind, 'user', 'tasks', '021.md');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `id: project:shop:021\ntitle: Cart total\nstatus: review\nfrom-id: root:master\nto-id: ${unit.id}\ndate: 2026-10-10\n\n## Request\nCompute the cart total.\n\n## Report\nThe cart total is computed.\nApproved for review by overlord-shop on 2026-10-10\n`);
    },
    async reach(ctx) {
      await openMap(ctx, 5);
      await ctx.page.click(node(SHOP));
      await ctx.visible('.inspector [data-approval][data-approval-state="pending"] [data-action="approve-always"]', { timeout: 30000 });
      await ctx.visible('.inspector [data-task="project:shop:021"][data-reviewable="true"] [data-action="accept"]', { timeout: 30000 });
      await ctx.visible('.inspector [data-composer="true"]');
      await inspectorLoaded(ctx);
      await ctx.page.waitFor(id => document.querySelector(`.map-node[data-unit-id="${id}"]`)?.classList.contains('is-selected') && document.querySelectorAll('.inspector .bubble').length >= 2, { args: [SHOP], message: 'the executor selected with its history' });
    },
  },
};

// The circles every Map case starts from, and the GUI steps that several of them share.
const GAME = idOf('game-1', 'executor-game-1');
const OVERLORD = idOf('shop', 'overlord-shop');

async function plainMap(ctx) {
  const seeded = await seedMap(ctx.world);
  ctx.agents = seeded.agents;
  return seeded;
}

// The inspector reads the unit after a selection; the state is shown when that read has finished.
async function inspectorLoaded(ctx) {
  await ctx.visible('.inspector [data-unit-facts]');
  await ctx.gone('.inspector [data-inspector-progress]');
}

// Select a circle, then More/Rename in the inspector header (F2 does nothing after a click on a circle: the shell render
// moves the focus to the page body and the F2 handler listens on the shell, main.mjs:267).
async function beginRename(ctx, id) {
  await ctx.page.click(node(id));
  await ctx.visible('.inspector [data-action="agent-more"]');
  await ctx.page.click('.inspector [data-action="agent-more"]');
  await ctx.visible('dialog[open] [data-action="agent-rename"]');
  await ctx.page.click('dialog[open] [data-action="agent-rename"]');
  // Closing the More dialog returns the focus to its button after the field took it, so the person clicks into the field.
  await ctx.visible('[data-alias-input]');
  await ctx.page.click('[data-alias-input]');
  await ctx.page.waitFor(() => document.activeElement?.matches?.('[data-alias-input]'), { message: 'the alias field to have the focus' });
}

Object.assign(cases, {
  '2.3': {
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      await beginRename(ctx, GAME);
      await ctx.page.type('Game');
      await ctx.page.waitFor(() => document.querySelector('[data-alias-input]')?.value === 'Game', { message: 'the typed alias' });
      await ctx.visible('[data-alias-edit] [data-action="save-alias"]');
      await inspectorLoaded(ctx);
    },
  },
  '2.4': {
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      await beginRename(ctx, GAME);
      await ctx.page.type('Game');
      await ctx.page.press('Enter');
      await ctx.gone('[data-alias-edit]');
      await ctx.visible('.map-node[data-unit-id$="executor-game-1"] .unit-alias', { text: 'Game' });
      await ctx.visible('.map-toast [data-action="map-undo"]');
      await inspectorLoaded(ctx);
    },
  },
  '2.5': {
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      await ctx.page.drag(`.map-handle[data-unit-id="${OVERLORD}"]`, node(GAME));
      await ctx.visible('dialog[open].connection-dialog');
    },
  },
  '2.6': {
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      // The service accepts the lead change only after the gate opens, so the Map shows it pending.
      let open; const gate = new Promise(resolve => { open = resolve; });
      const unroute = await ctx.page.route(request => request.method === 'PUT' && /\/units\/[^/]+\/lead$/.test(new URL(request.url).pathname), async () => { await gate; return 'continue'; });
      ctx.defer(() => { open(); unroute(); });
      await ctx.page.drag(`.map-handle[data-unit-id="${OVERLORD}"]`, node(GAME));
      await ctx.visible('dialog[open].connection-dialog');
      await ctx.page.click('dialog[open].connection-dialog .dialog-actions .btn.primary');
    },
  },
});

Object.assign(cases, {
  '2.15': {
    boot: heldStart,
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      ctx.defer(() => ctx.world.fx.fixture.visualGate?.fail('The service closed.'));
      await ctx.page.click(node(SHOP));
      await startFromInspector(ctx);
      await ctx.visible('.inspector [data-session-progress] [data-action="cancel-start"]', { timeout: 30000 });
      await inspectorLoaded(ctx);
    },
  },
});

Object.assign(cases, {
  '2.16': {
    boot: heldStart,
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      ctx.defer(() => ctx.world.fx.fixture.visualGate?.fail('The service closed.'));
      await ctx.page.click(node(SHOP));
      await startFromInspector(ctx);
      await ctx.visible('.inspector [data-session-progress] [data-action="cancel-start"]', { timeout: 30000 });
      // The client never answers: the actual core waits 30 s of its own clock and then the launch is refused.
      ctx.advance(30000);
      ctx.world.fx.fixture.visualGate.fail('The selected client did not answer.');
      await ctx.visible('.inspector [data-session-progress] [data-action="choose-client"]', { timeout: 30000 });
      await inspectorLoaded(ctx);
    },
  },
});

Object.assign(cases, {
  '2.17': {
    entry: 'none',
    seed: plainMap,
    async reach(ctx) {
      await openMap(ctx, 5);
      await ctx.page.click(node(SHOP));
      await startFromInspector(ctx);
      // Stop is offered as soon as a session id exists, including while start is still queued or starting.
      // The dialog is the live session's Stop, so the starting progress has to be gone first.
      await ctx.page.waitFor(() => {
        const inspector = document.querySelector('.inspector');
        return Boolean(inspector?.querySelector('[data-action="stop-session"]')) && !inspector.querySelector('[data-session-progress]');
      }, { timeout: 60000, message: 'a live session before Stop' });
      await ctx.page.click('.inspector [data-action="stop-session"]');
      await ctx.visible('dialog[open] .dialog-actions .btn.primary');
    },
  },
});

// The fixture repositories have no project named mobile. The remove dialog is the one the product opens for the
// executor of a cluster titled mobile (the derived unit name, not the board's sample label).
async function seedMobile(ctx) {
  const cluster = await createCluster(ctx.world, 'mobile');
  ctx.unit = await createAgent(ctx.world, cluster.id, 'executor');
  await createOverseer(ctx.world);
  await placeNodes(ctx.world);
}

// The same owner hooks the actual-core addition test installs, so the GUI inspects the mixed fixture archive
// without a network read. The archive bytes are the T064 fixture, not a live repository.
function installAddition(world) {
  const archive = gzipSync(finalAdditionArchive());
  const owner = world.fx.core.runtime.settingsOwner;
  const pin = 'a'.repeat(40);
  owner.additionLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  owner.additionTransport = async url => {
    const pathname = typeof url === 'string' ? new URL(url).pathname : url.pathname;
    const bytes = pathname.includes('/commits/')
      ? Buffer.from(JSON.stringify({ sha: pin, commit: { committer: { date: '2026-10-01T00:00:00.000Z' } } }))
      : archive;
    return { status: 200, bytes };
  };
  owner.additionRunner = async (_command, args, _options, input) => {
    if (!args.includes('hash-object')) throw new Error('The addition check asked for a command other than hash-object.');
    return Buffer.from(`${createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex')}\n`);
  };
}

const SOURCE = 'https://github.com/acme/final-source';

async function seedAddition(ctx) {
  const seeded = await seedMap(ctx.world, { repositories: ['shop'], agents: { shop: ['executor', 'executor', 'executor'] } });
  ctx.shop = seeded.clusters.shop;
  await createCluster(ctx.world, 'Checkout launch');
  installAddition(ctx.world);
}

async function openAdd(ctx) {
  await openMap(ctx, 4);
  await ctx.page.click('[data-action="add-to-mind"]');
  await ctx.visible('dialog.add-dialog #add-link');
  await ctx.page.fill('#add-link', SOURCE);
  await ctx.page.press('Enter');
  await ctx.page.waitFor(() => document.querySelector('dialog.add-dialog .add-found [data-candidate-id]') || document.querySelector('dialog.add-dialog .add-error'), { timeout: 45000, message: 'the Add inspection to finish' });
  const error = await ctx.page.eval(() => document.querySelector('dialog.add-dialog .add-error')?.textContent?.trim() ?? '');
  if (error) throw new Error(`Add inspection failed: ${error}`);
}

async function clickFound(ctx, title) {
  const index = await ctx.page.eval(name => [...document.querySelectorAll('dialog.add-dialog .add-found .add-choice')].findIndex(node => node.querySelector('strong')?.textContent === name), title);
  if (index < 0) throw new Error(`The Add dialog has no row titled ${title}.`);
  await ctx.page.click('dialog.add-dialog .add-found .add-choice input', { index });
}

Object.assign(cases, {
  '2.18': {
    entry: 'none',
    seed: seedMobile,
    async reach(ctx) {
      await openMap(ctx, 2);
      const menu = `[data-unit-menu="${ctx.unit.id}"]`;
      await ctx.page.click(`[data-row][data-id="${ctx.unit.id}"]`);
      await ctx.visible(`${menu} summary`);
      await ctx.page.click(`${menu} summary`);
      await ctx.visible(`${menu} [data-action="remove-unit"]`);
      // The expanded menu is covered by the inspector chat, so a pointer click lands on the chat. Activate the
      // button itself; the confirm dialog is the state a person gets from Remove unit.
      await ctx.page.eval(sel => document.querySelector(sel)?.click(), `${menu} [data-action="remove-unit"]`);
      const opened = await ctx.page.eval(() => Boolean(document.querySelector('dialog[data-remove-unit]')));
      if (!opened) throw new Error('Remove did not open a dialog after the button was activated.');
    },
  },
  '2.19': {
    entry: 'none',
    seed: seedAddition,
    async reach(ctx) {
      await openAdd(ctx);
      await ctx.visible('dialog.add-dialog .add-found .add-choice strong', { text: 'pdf' });
      await ctx.visible('dialog.add-dialog [data-action="add-continue"]');
    },
  },
  '2.20': {
    entry: 'none',
    seed: seedAddition,
    async reach(ctx) {
      await openAdd(ctx);
      await clickFound(ctx, 'pdf');
      await ctx.page.click('dialog.add-dialog [data-action="add-continue"]');
      await ctx.visible('dialog.add-dialog[data-add-stage="check"]', { timeout: 30000 });
      const index = await ctx.page.eval(() => [...document.querySelectorAll('dialog.add-dialog .add-scope .add-choice')].findIndex(node => node.textContent.includes('Checkout launch')));
      if (index < 0) throw new Error('The check step has no Checkout launch group.');
      await ctx.page.click('dialog.add-dialog .add-scope .add-choice input', { index });
      await ctx.page.waitFor(() => document.querySelector('dialog.add-dialog .add-scope .add-choice.is-selected')?.textContent.includes('Checkout launch'), { message: 'Checkout launch to be selected' });
    },
  },
  '2.21': {
    entry: 'none',
    seed: seedAddition,
    async reach(ctx) {
      await openAdd(ctx);
      await clickFound(ctx, 'pdf');
      await ctx.page.click('dialog.add-dialog [data-action="add-continue"]');
      await ctx.visible('dialog.add-dialog[data-add-stage="check"]', { timeout: 30000 });
      const choiceIndex = label => ctx.page.eval(text => [...document.querySelectorAll('dialog.add-dialog .add-scope .add-choice')].findIndex(node => node.textContent.includes(text)), label);
      const group = await choiceIndex('Checkout launch');
      const unit = await choiceIndex('executor-shop');
      if (group < 0) throw new Error('The check step has no Checkout launch group.');
      if (unit < 0) throw new Error('The check step has no executor to grant the skill to.');
      await ctx.page.click('dialog.add-dialog .add-scope .add-choice input', { index: group });
      await ctx.page.click('dialog.add-dialog .add-scope .add-choice input', { index: unit });
      await ctx.page.waitFor(() => !document.querySelector('dialog.add-dialog [data-action="add-confirm"]')?.disabled, { message: 'Add pdf to be enabled' });
      await ctx.page.click('dialog.add-dialog [data-action="add-confirm"]');
      try {
        await ctx.gone('dialog.add-dialog', { timeout: 30000 });
      } catch (error) {
        const detail = await ctx.page.eval(() => {
          const dialog = document.querySelector('dialog.add-dialog');
          const alert = dialog?.querySelector('.add-error')?.innerText?.replace(/\s+/g, ' ')?.trim() ?? '';
          return `busy=${dialog?.getAttribute('aria-busy') ?? ''} stage=${dialog?.getAttribute('data-add-stage') ?? ''} error=${alert}`;
        });
        throw new Error(`${error.message} | ${detail}`);
      }
      await openSettings(ctx, 'content');
      await ctx.visible('[data-settings-page="content"]', { text: 'pdf', timeout: 30000 });
    },
  },
  '2.22': {
    entry: 'none',
    seed: seedAddition,
    async reach(ctx) {
      await openAdd(ctx);
      const label = ctx.es ? 'Repositorio' : 'Repository';
      const index = await ctx.page.eval(badge => [...document.querySelectorAll('dialog.add-dialog .add-found .add-choice')].findIndex(node => node.querySelector('.add-badge')?.textContent === badge), label);
      if (index < 0) throw new Error(`The Add dialog has no ${label} row.`);
      await ctx.page.click('dialog.add-dialog .add-found .add-choice input', { index });
      await ctx.page.click('dialog.add-dialog [data-action="add-continue"]');
      await ctx.visible('dialog.add-dialog[data-add-stage="check"]', { timeout: 30000 });
      await ctx.page.waitFor(() => !document.querySelector('dialog.add-dialog [data-action="add-confirm"]')?.disabled, { message: 'the repository acceptance to be enabled' });
      await ctx.page.click('dialog.add-dialog [data-action="add-confirm"]');
      await ctx.gone('dialog.add-dialog', { timeout: 45000 });
      await ctx.page.click('[data-action="fit-map"]');
      await ctx.visible('[data-cluster-row]', { timeout: 30000 });
    },
  },
});
