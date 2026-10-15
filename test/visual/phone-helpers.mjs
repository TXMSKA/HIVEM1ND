// Preparation and steps shared by the phone captures (row 7 of the T064 list). The phone reaches the actual core
// through its home listener on the LAN address, exactly as a phone does; a person types the six-character code there.
// Pairing credentials (code, key, token) never leave memory: nothing here prints or stores them.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acceptRepositories, agentCredential, choice, createAgent, createCluster, createOverseer, post } from './seed.mjs';
import { openHome } from './settings-helpers.mjs';

// The pairing screen has no viewer to take its language or look from, so the person's shared Settings choice is what
// the phone reads once it is signed in. Set it to the language and look under capture before the phone opens.
export async function presentLikeViewer(ctx) {
  const settings = await ctx.world.call('GET', '/settings');
  await ctx.world.call('PATCH', '/settings', { language: ctx.language, look: ctx.look, expectedRevision: settings.revision }, { key: ctx.world.key() });
}

// Open home access (the person's earlier Open on the phone) and keep the grant in memory for the phone steps.
export async function openPhoneAccess(ctx, options = {}) {
  ctx.home = await openHome(ctx.world, options);
  return ctx.home;
}

// Open the LAN shell without a credential, as a phone does after the QR is not used.
export async function openPairing(ctx) {
  await ctx.page.navigate(`${ctx.home.origin}/`);
  await ctx.visible('[data-phone-state="pair"] [data-home-code]', { timeout: 30000 });
}

// Type six characters into the code field the way a person does, then press Continue.
export async function typeCode(ctx, code, { submit = true } = {}) {
  await ctx.page.click('[data-home-code]');
  await ctx.page.type(code);
  if (submit) {
    await ctx.page.waitFor(() => !document.querySelector('.phone-code-form button[type="submit"]').disabled, { message: 'the code to be complete' });
    await ctx.page.click('.phone-code-form button[type="submit"]');
  }
}

// A six-character code that is not the grant's (the alphabet leaves out 0, 1, I and O).
export const wrongCode = ctx => ctx.home.grant.shortCode === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';

// Pair with the right code and wait until the signed-in shell shows.
export async function pairWithCode(ctx) {
  await openPairing(ctx);
  await typeCode(ctx, ctx.home.grant.shortCode);
  await ctx.visible('.phone-nav', { timeout: 30000 });
}

// ---- what the phone shows -----------------------------------------------------------------------------------

// A task delivered for review: written the way the /task command writes it, with the lead's approval in the report.
export async function writeReviewTask(world, { project = 'shop', number = '001', title = 'Build the cart checkout', unit = 'executor-shop', lead = 'overlord-shop' } = {}) {
  const date = '2026-10-10 11:00';
  const directory = path.join(world.mind, 'user', 'projects', project, 'tasks');
  await mkdir(directory, { recursive: true });
  const text = [`id: ${number}`, `task-id: project:${project}:${number}`, `title: ${title}`, 'status: review', 'from: master', 'from-id: root:master',
    `to: ${unit}`, `to-id: project:${project}:${unit}`, `date: ${date}`, '', '## Request', title, '', '## Report', 'The delivery is ready for review.',
    `Approved for review by ${lead} on ${date}`, ''].join('\n');
  await writeFile(path.join(directory, `${number}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`), text);
}

// An ask from an agent: its session asks to run one exact command (answered with Approve or Deny).
export async function buildAsk(world, unitId, command, cwd, { always = false } = {}) {
  const credential = agentCredential(world, unitId);
  const asked = await world.call('POST', '/approvals/request', { action: 'process.run', pattern: { command, cwd }, display: `Run ${command}`, alwaysAllowed: always }, { key: world.key(), credential });
  return asked.approval;
}

// An ask to push: shown on the phone with the computer-required guidance and no answer button.
export async function pushAsk(world, unitId, repository) {
  const credential = agentCredential(world, unitId);
  const asked = await world.call('POST', '/approvals/request', { action: 'git.push', pattern: { repository, args: ['push', 'origin', 'main'] }, display: 'Run git push origin main' }, { key: world.key(), credential });
  return asked.approval;
}

// The Hierarchy the phone shows: an Overseer, a shop cluster with an Overlord and Executors, and two clusters whose
// Executors have no Overlord (data and mobile).
export async function seedPhoneWorld(ctx, { ask = true, review = true } = {}) {
  const { world } = ctx;
  const clusters = await acceptRepositories(world, ['shop', 'api-gateway']);
  const byName = Object.fromEntries(clusters.map(cluster => [cluster.title, cluster]));
  const units = {
    overlordShop: await createAgent(world, byName.shop.id, 'overlord', choice),
    executorShop: await createAgent(world, byName.shop.id, 'executor', choice),
    overlordApi: await createAgent(world, byName['api-gateway'].id, 'overlord', choice),
    executorApi: await createAgent(world, byName['api-gateway'].id, 'executor', choice),
  };
  for (const title of ['data', 'mobile']) {
    const cluster = await createCluster(world, title);
    units[`executor_${title}`] = await createAgent(world, cluster.id, 'executor', choice);
  }
  await createOverseer(world, choice);
  const shopPath = world.fx.repositories.shop;
  const approvals = {};
  if (ask) {
    approvals.build = await buildAsk(world, units.executorShop.id, 'npm run build', shopPath);
    approvals.push = await pushAsk(world, units.executorShop.id, shopPath);
  }
  if (review) await writeReviewTask(world);
  return { clusters: byName, units, approvals, shopPath };
}

export { post };
