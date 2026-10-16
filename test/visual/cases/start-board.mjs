// Start board, rows 1 to 4, after the two first-run dialogs. Each state is reached through the GUI.
// Repositories, agents, plans and context meters are prepared through the actual core; the screen is not.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readRunRecord, runIds } from '../../../engine/service/runs.mjs';
import { acceptRepositories, agentCredential, choice, createOverseer } from '../seed.mjs';
import { openMap, seedMap } from '../map-helpers.mjs';
import { chatsBoot, noteWorkStep, openChats, openUnit, say, seedChats, startSession, unitToken } from '../chats-helpers.mjs';

const SHOP_EXECUTOR = 'project:shop:executor-shop';
const SHOP_EXECUTOR_2 = 'project:shop:executor-shop-2';

async function acceptAll(ctx) {
  await ctx.visible('[data-start-dialog="discovery"]');
  await ctx.page.click('[data-action="import-repositories"]');
  await ctx.visible('[data-start-dialog="overseer"]', { timeout: 90000 });
  await ctx.page.waitFor(() => {
    const button = document.querySelector('[data-start-dialog="overseer"] [data-action="create-agent"]');
    return Boolean(button) && !button.disabled;
  }, { timeout: 30000, message: 'Create Overseer to be enabled' });
  await ctx.page.click('[data-start-dialog="overseer"] [data-action="create-agent"]');
  await ctx.gone('[data-start-dialog]', { timeout: 90000 });
  await ctx.page.waitFor(() => document.querySelectorAll('.map-group-label').length >= 3 && document.querySelector('.map-node[data-role="overseer"]'), { timeout: 30000, message: 'the folder frames and the Overseer' });
  await ctx.page.click('[data-action="fit-map"]');
}

async function readyShop(ctx, agents = []) {
  const seeded = await seedMap(ctx.world, { repositories: ['shop'], agents: { shop: agents } });
  ctx.shop = seeded.clusters.shop;
  ctx.agents = seeded.agents.shop ?? [];
  return seeded;
}

async function openNewCluster(ctx) {
  await openMap(ctx, 1);
  await ctx.page.click('[data-action="new-cluster"]');
  await ctx.visible('[data-start-dialog="cluster"]');
  await ctx.page.fill('[data-start-field="title"]', 'ideas');
}

async function openNewAgent(ctx) {
  await openMap(ctx, 1);
  await ctx.page.click('.map-group-label[aria-label="shop"]');
  await ctx.visible('[data-action="new-agent"]');
  await ctx.page.click('[data-action="new-agent"]');
  await ctx.visible('[data-start-dialog="agent"]');
}

async function writePlan(ctx) {
  const seeded = await readyShop(ctx, ['overlord', 'executor', 'executor']);
  await writeFile(path.join(ctx.world.fx.fixture.paths.localDirectory, 'client-permissions.json'), JSON.stringify({
    permissions: [{ id: randomUUID(), machine: 'DESKTOP', client: 'codex', actions: ['git.commit'], scope: 'hivem1nd-started-sessions', grantedAt: new Date(ctx.world.fx.fixture.clock.now).toISOString(), grantedBy: 'root:master' }],
  }));
  const lead = seeded.agents.shop[0];
  const unit = seeded.agents.shop[1];
  const titles = [
    ['071', 'Empty state on the cart page'],
    ['072', 'The cart API answers an empty cart'],
    ['073', 'Review both against the board'],
  ];
  const directory = path.join(ctx.world.mind, 'user', 'tasks');
  await mkdir(directory, { recursive: true });
  for (const [number, title] of titles) {
    await writeFile(path.join(directory, `${number}.md`), `id: root:${number}\ntitle: ${title}\nstatus: open\nfrom-id: root:master\nto-id: ${unit.id}\nfiles: ["cart.txt"]\n\n## Request\n${title}\n`);
  }
  await say(ctx.world, ctx.shop.chatId, 'Plan the cart empty state.');
  const leadAssignment = { kind: 'unit', unitId: lead.id, runsIn: choice };
  const assignment = { kind: 'unit', unitId: unit.id, runsIn: choice };
  const current = await ctx.world.call('GET', `/chats/${ctx.shop.chatId}`);
  ctx.plan = await ctx.world.call('POST', '/plans', {
    clusterId: ctx.shop.id, chatId: ctx.shop.chatId, machine: 'DESKTOP', title: 'Cart empty state', branch: 'cart-empty', mode: 'execution',
    tasks: titles.map(([number, title]) => ({ id: `root:${number}`, title, assignment })),
    roles: { coordinator: leadAssignment, planner: leadAssignment, builder: assignment, reviewer: leadAssignment },
    expectedChatRevision: current.revision,
  });
}

async function showPlan(ctx) {
  await openMap(ctx, 4);
  await ctx.page.click('.map-group-label[aria-label="shop"]');
  await ctx.visible('.plan-card [data-action="run-plan"]', { timeout: 30000 });
}

export function stallPast(watch, now) {
  const last = Date.parse(watch?.lastStepAt);
  const limit = watch?.phase === 'planning' ? 1800000 : 600000;
  if (!Number.isFinite(last) || !Number.isFinite(now)) return limit + 1000;
  return Math.max(0, last + limit + 1000 - now);
}

async function confirmedRun(ctx) {
  for (const id of await runIds(ctx.world.core)) {
    const { record } = await readRunRecord(ctx.world.core, id);
    if (record.planId === ctx.plan.id && record.watches?.some(watch => !watch.resolved)) return record;
  }
  return null;
}

async function runPlan(ctx) {
  await showPlan(ctx);
  await ctx.page.click('.plan-card [data-action="run-plan"]');
  await ctx.visible('dialog[open][data-confirm-plan]');
  await ctx.page.click('dialog[open][data-confirm-plan] .btn.primary');
  await ctx.visible('.plan-card [data-action="stop-plan"]', { timeout: 60000 });
}

function watchContext(world, percent) {
  world.fx.adapters.codex.readContext = async () => ({ used: percent, capacity: 100, unit: 'tokens', estimated: false });
}

async function seedOverseer(ctx, percent) {
  await acceptRepositories(ctx.world, ['shop', 'blog', 'api-gateway']);
  const overseer = await createOverseer(ctx.world);
  watchContext(ctx.world, percent);
  await startSession(ctx.world, overseer);
  const chat = await ctx.world.call('POST', '/chats', { members: [overseer.id] });
  await say(ctx.world, chat.id, 'Shop, blog and api-gateway are in the launch.', agentCredential(ctx.world, overseer.id));
  ctx.overseer = overseer;
}

export const cases = {
  'start 1.3': {
    async reach(ctx) {
      await acceptAll(ctx);
      // The sidebar heading is Clusters. The unused "Your clusters" sentence is not on this screen,
      // and creating the Overseer selects it, so the inspector is not the empty state.
      await ctx.visible('[data-my-groups]', { text: ctx.es ? 'Clústeres' : 'Clusters' });
      await ctx.visible('.map-node[data-role="overseer"]');
    },
  },

  'start 1.4': {
    async reach(ctx) {
      await acceptAll(ctx);
      await ctx.page.doubleClick('.map-group-label[aria-label="Web"]');
      const hint = ctx.es ? 'Vista de Web' : 'Zoomed in on Web';
      await ctx.visible('body', { text: hint, timeout: 20000 });
      await ctx.settle();
      await ctx.page.click('.map-group-label[aria-label="shop"]');
      await ctx.visible('.inspector', { text: 'shop' });
    },
  },

  'start 2.1': {
    entry: 'none',
    seed: ctx => readyShop(ctx),
    async reach(ctx) {
      await openNewCluster(ctx);
      await ctx.page.waitFor(() => document.querySelector('[data-start-field="title"]')?.value === 'ideas', { message: 'the cluster name ideas' });
      await ctx.visible('[data-start-dialog="cluster"] [data-action="create-cluster"]');
    },
  },

  'start 2.2': {
    entry: 'none',
    seed: ctx => readyShop(ctx),
    async reach(ctx) {
      await openNewCluster(ctx);
      await ctx.page.click('[data-action="create-cluster"]');
      await ctx.gone('[data-start-dialog]', { timeout: 30000 });
      await ctx.visible('[data-cluster-row]', { text: 'ideas' });
    },
  },

  'start 2.3': {
    entry: 'none',
    seed: ctx => readyShop(ctx),
    async reach(ctx) {
      await openNewAgent(ctx);
      await ctx.visible('[data-start-dialog="agent"] [data-action="create-agent"]');
      await ctx.visible('[data-action="open-runs-picker"]');
    },
  },

  'start 2.4': {
    entry: 'none',
    seed: ctx => readyShop(ctx),
    async reach(ctx) {
      await openNewAgent(ctx);
      await ctx.page.click('[data-action="open-runs-picker"]');
      await ctx.visible('[data-runs-picker]');
      await ctx.visible('[data-action="runs-client-codex"]');
    },
  },

  'start 2.5': {
    entry: 'none',
    seed: ctx => readyShop(ctx),
    async reach(ctx) {
      await openNewAgent(ctx);
      await ctx.page.click('[data-action="open-runs-picker"]');
      await ctx.visible('[data-runs-picker]');
      const present = await ctx.page.eval(() => Boolean(document.querySelector('[data-action="runs-client-lyra"]')));
      if (!present) throw new Error('Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select.');
      await ctx.page.click('[data-action="runs-client-lyra"]');
      await ctx.visible('[data-action="runs-mode-fast"]');
      await ctx.visible('[data-action="runs-mode-thinking"]');
    },
  },

  'start 2.6': {
    entry: 'none',
    seed: ctx => readyShop(ctx, ['overlord', 'executor', 'executor']),
    async reach(ctx) {
      await openMap(ctx, 4);
      await ctx.page.click('.map-group-label[aria-label="shop"]');
      await ctx.visible('.inspector', { text: 'overlord-shop', timeout: 30000 });
      await ctx.visible('.map-node[data-unit-id="project:shop:executor-shop-2"]');
    },
  },

  'start 2.7': {
    entry: 'none',
    seed: writePlan,
    reach: showPlan,
  },

  'start 2.8': {
    entry: 'none',
    seed: writePlan,
    reach: runPlan,
  },

  'start 2.9': {
    entry: 'none',
    seed: writePlan,
    async reach(ctx) {
      await runPlan(ctx);
      const deadline = Date.now() + 30000;
      let run = null;
      while (Date.now() < deadline) {
        run = await confirmedRun(ctx);
        if (run) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!run) throw new Error('The plan run did not confirm a step.');
      const watch = run.watches.find(item => !item.resolved);
      ctx.advance(stallPast(watch, ctx.world.fx.fixture.clock.now));
      await ctx.world.core.runSupervisor.check();
      await ctx.visible('.plan-card [data-action="stop-step"]', { timeout: 30000 });
    },
  },

  'start 3.1': {
    entry: 'none',
    seed: ctx => seedOverseer(ctx, 18),
    async reach(ctx) {
      await ctx.open({ overseerExists: true });
      await ctx.page.click(`.map-node[data-unit-id="${ctx.overseer.id}"]`);
      await ctx.visible('.inspector [data-message]', { text: 'Shop, blog and api-gateway are in the launch.', timeout: 30000 });
      await ctx.gone('[data-inspector-progress]');
      await ctx.page.fill('.inspector input[data-composer]', 'Where are we with the launch?');
      await ctx.page.waitFor(() => (document.querySelector('.inspector input[data-composer]')?.value ?? '').includes('launch'), { message: 'the question to stay in the composer' });
      await ctx.page.click('.inspector [data-action="send"]');
      await ctx.visible('.inspector [data-message]', { text: 'Where are we with the launch?', timeout: 20000 });
      await ctx.page.waitFor(() => document.querySelector('.context-bar')?.getAttribute('aria-valuenow') === '18', { timeout: 30000, message: 'the context meter at 18 percent' });
    },
  },

  'start 3.2': {
    entry: 'none',
    seed: ctx => seedOverseer(ctx, 82),
    async reach(ctx) {
      await ctx.open({ overseerExists: true });
      await ctx.page.click(`.map-node[data-unit-id="${ctx.overseer.id}"]`);
      await ctx.visible('[data-context-notice]', { timeout: 30000 });
      await ctx.page.waitFor(() => document.querySelector('.context-bar')?.getAttribute('aria-valuenow') === '82', { message: 'the context meter at 82 percent' });
      await ctx.visible('[data-action="context-compact"]');
    },
  },

  'start 4.1': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      ctx.other = seeded.b;
      const other = await ctx.world.call('POST', '/chats', { members: [seeded.b.id] });
      await say(ctx.world, other.id, 'First note for the second executor.');
      await say(ctx.world, other.id, 'Second note for the second executor.');
      await say(ctx.world, seeded.chat.id, 'Build the empty cart state.');
      await say(ctx.world, seeded.chat.id, 'The illustration is on the board.', unitToken(ctx.world, seeded.a));
      await startSession(ctx.world, seeded.a);
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR, SHOP_EXECUTOR_2]);
      await openUnit(ctx, ctx.unit, 2);
      await ctx.visible('[data-action="session-chat"][aria-selected="true"]');
      await ctx.page.waitFor(id => (document.querySelector(`[data-row][data-id="${id}"]`)?.textContent ?? '').includes('2'), { args: [ctx.other.id], message: 'the unread count 2 on the second executor' });
    },
  },

  'start 4.2': {
    boot: chatsBoot,
    entry: 'none',
    async seed(ctx) {
      const seeded = await seedChats(ctx.world);
      ctx.unit = seeded.a;
      await say(ctx.world, seeded.chat.id, 'Build the empty cart state.');
      noteWorkStep(ctx.world);
      await startSession(ctx.world, seeded.a, { busy: true });
    },
    async reach(ctx) {
      await openChats(ctx, [SHOP_EXECUTOR]);
      await openUnit(ctx, ctx.unit, 1);
      await ctx.page.click('[data-action="session-work"]');
      await ctx.visible('[data-session-work] .work-step', { timeout: 30000 });
    },
  },
};
