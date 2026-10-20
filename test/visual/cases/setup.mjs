// Flow board, row 1: setup and first run (references 1.1 to 1.10).
// 1.1 to 1.7 are the setup wizard (gui/index.html and gui/app.js served by gui/server.mjs) over a real setup session on
// temporary folders; no core runs in setup, so these cases boot nothing (`boot: null`) and open their own page.
// 1.8 to 1.10 are the main app on the actual core, with the opening read held or left alone.
import {
  deferPageStop, makeGate, makeSetupSandbox, openWizard, portConflict, serviceStarter, startWizard,
} from '../setup-helpers.mjs';

const WIZARD = { boot: null, entry: 'none' };

// Waits until a wizard step is shown: the step counter text carries the number in both languages.
async function waitStep(ctx, number, selector, message) {
  await ctx.page.waitFor((count, wanted) => /(\d+)/.exec(document.querySelector('.step-count')?.textContent ?? '')?.[1] === String(count)
    && (!wanted || [...document.querySelectorAll(wanted)].some(node => node.getBoundingClientRect().width > 0)),
  { timeout: 30000, args: [number, selector ?? null], message });
}

// Step 1 to step 2: Start setup.
async function startSetup(ctx) {
  await ctx.page.click('#continue-button');
  await waitStep(ctx, 2, '#mind-path', 'step 2 with the folder field');
}

// A wizard on a sandbox with a detected 2.x tree (legacy sessions optional), opened on step 1.
async function legacyWizard(ctx, { sessions = true, starter = null } = {}) {
  const sandbox = await makeSetupSandbox(ctx, { legacy: true, sessions });
  const { serviceStart } = starter ?? serviceStarter();
  const wizard = await startWizard(ctx, sandbox, { serviceStart, withLegacyControl: true });
  deferPageStop(ctx);
  await openWizard(ctx, wizard.server);
  return { sandbox, ...wizard };
}

// Continue from the location step through the 2.x closing dialog: Close them and migrate.
async function confirmMigration(ctx) {
  await ctx.page.click('#continue-button');
  await ctx.visible('#mode-dialog[open] .legacy-session');
  await ctx.page.click('#mode-dialog-close');
  await waitStep(ctx, 3, '[data-progress]', 'step 3 with its progress rows');
}

// The service step has finished or failed: the install request is over and the controls are live again.
async function installSettled(ctx, message) {
  await ctx.page.waitFor(() => document.querySelector('#step-form')?.getAttribute('aria-busy') === 'false'
    && !document.querySelector('#continue-button')?.disabled, { timeout: 120000, message });
}

// The opening frames choose a language before the read, from the stored viewer language or the browser languages.
// The capture presents that choice before the page scripts run.
async function requireLocalized(ctx, selector, [english, spanish]) {
  const wanted = ctx.es ? spanish : english;
  const shown = await ctx.page.eval(sel => document.querySelector(sel)?.textContent?.trim() ?? '', selector);
  if (shown !== wanted) throw new Error(`The state is shown as "${shown}", not "${wanted}".`);
}

export const cases = {
  '1.1': {
    // Open setup without a configured M1ND: the install step, with no Back control.
    ...WIZARD,
    async reach(ctx) {
      const sandbox = await makeSetupSandbox(ctx);
      const { server } = await startWizard(ctx, sandbox);
      deferPageStop(ctx);
      await openWizard(ctx, server);
      await ctx.visible('.setup-bullet');
      await waitStep(ctx, 1, '#continue-button', 'step 1');
    },
  },

  '1.2': {
    // Continue with a detected 2.x tree: step 2 offers to migrate it (checked) next to the default Cosmic folder.
    ...WIZARD,
    async reach(ctx) {
      await legacyWizard(ctx);
      await startSetup(ctx);
      await ctx.visible('#migrate-legacy');
      await ctx.page.waitFor(() => document.querySelector('#migrate-legacy')?.checked === true && document.querySelector('#relay-plus')?.disabled === true, { message: 'the checked Migrate legacy M1ND offer and the disabled Relay+ offer' });
    },
  },

  '1.3': {
    // Choose a populated 3.0 folder: typing its path into the Folder field turns the offer into Join this M1ND.
    ...WIZARD,
    async reach(ctx) {
      const sandbox = await makeSetupSandbox(ctx, { populated: true });
      const { server } = await startWizard(ctx, sandbox);
      deferPageStop(ctx);
      await openWizard(ctx, server);
      await startSetup(ctx);
      await ctx.page.click('#change-folder');
      await ctx.page.fill('#mind-path', sandbox.joinPath);
      await ctx.page.press('Tab');
      await ctx.visible('#join-mind');
      await ctx.page.waitFor(() => document.querySelector('#join-mind')?.checked === true && !document.querySelector('#migrate-legacy'), { message: 'the checked Join this M1ND offer' });
      await ctx.page.waitFor(() => !document.querySelector('#step-form')?.getAttribute('aria-busy')?.includes('true'), { message: 'the folder change to finish' });
    },
  },

  '1.4': {
    // Continue the migration while 2.x sessions are open: two local sessions and one on an offline machine.
    ...WIZARD,
    async reach(ctx) {
      await legacyWizard(ctx);
      await startSetup(ctx);
      await ctx.visible('#migrate-legacy');
      await ctx.page.click('#continue-button');
      await ctx.visible('#mode-dialog[open] .legacy-session');
      await ctx.page.waitFor(() => document.querySelectorAll('#mode-dialog .legacy-session').length === 3 && document.querySelector('#mode-dialog .offline-legacy') && document.querySelector('#cancel-legacy'), { message: 'three session rows, the offline note and Cancel' });
    },
  },

  '1.5': {
    // Confirm the migration: the service step is busy on "Starting the service" until the case releases the gate.
    ...WIZARD,
    async reach(ctx) {
      const gate = makeGate();
      await legacyWizard(ctx, { starter: serviceStarter({ gate: gate.promise }) });
      ctx.defer(() => gate.release());
      await startSetup(ctx);
      await ctx.visible('#migrate-legacy');
      await confirmMigration(ctx);
      await ctx.page.waitFor(() => document.querySelector('[data-progress="start"]')?.classList.contains('busy')
        && /\d/.test(document.querySelector('[data-progress="start"] .progress-time')?.textContent ?? '')
        && document.querySelectorAll('[data-progress].done').length === 3, { timeout: 120000, message: 'three completed rows and "Starting the service" busy with its time' });
    },
  },

  '1.6': {
    // A service port conflict fails the start: Step 3 stays, the failed row is marked, Retry is offered.
    ...WIZARD,
    async reach(ctx) {
      await legacyWizard(ctx, { starter: serviceStarter({ fail: () => portConflict() }) });
      await startSetup(ctx);
      await ctx.visible('#migrate-legacy');
      await confirmMigration(ctx);
      await ctx.visible('.setup-failure', { timeout: 120000 });
      await installSettled(ctx, 'the failed install to settle with Retry');
      await ctx.page.waitFor(() => document.querySelector('[data-progress="start"]')?.classList.contains('fail')
        && document.querySelector('[data-progress="open"]')?.classList.contains('todo')
        && document.querySelectorAll('[data-progress].done').length === 3, { message: 'three completed rows, the failed start and the pending open row' });
    },
  },

  '1.7': {
    // Finish startup: step 4 with the running summary and Open the Map (it is not clicked).
    ...WIZARD,
    async reach(ctx) {
      await legacyWizard(ctx);
      await startSetup(ctx);
      await ctx.visible('#migrate-legacy');
      await confirmMigration(ctx);
      await waitStep(ctx, 4, '.setup-summary', 'step 4 with the summary');
      await installSettled(ctx, 'the ready step to settle');
      await ctx.page.waitFor(() => document.querySelectorAll('[data-summary]').length === 5 && !document.querySelector('[data-progress]'), { message: 'the five summary rows' });
    },
  },

  '1.8': {
    // The initial read is delayed: the shell keeps the skeleton frame, the spinner and "Reading the M1ND" while the first reads
    // (GET /view and GET /settings) are held. A first open has no stored last-known view, and this capture holds the read,
    // so the counts line stays absent.
    entry: 'none',
    async reach(ctx) {
      const hold = makeGate();
      ctx.defer(() => hold.release());
      await ctx.page.route(request => ['/api/v1/view', '/api/v1/settings'].includes(new URL(request.url).pathname) && request.method === 'GET', () => hold.promise.then(() => 'continue'));
      await ctx.open({ ready: false, overseerExists: true });
      await ctx.visible('.shell[data-boot="reading"] .workspace-opening .opening-stage .spinner');
      await ctx.page.waitFor(() => document.querySelectorAll('.opening-skeletons .opening-skeleton').length === 14, { message: 'the 9 left and 5 right skeleton blocks' });
      await ctx.visible('.foot');
      await requireLocalized(ctx, '.opening-content h2', ['Reading the M1ND', 'Leyendo la M1ND']);
    },
  },

  '1.9': {
    // The folder read does not answer for 30 s: the opening frame turns into "The M1ND cannot be read".
    entry: 'none',
    async reach(ctx) {
      const hold = makeGate();
      ctx.defer(() => hold.release());
      await ctx.page.route(request => new URL(request.url).pathname === '/api/v1/view' && request.method === 'GET', () => hold.promise.then(() => 'continue'));
      await ctx.open({ ready: false, overseerExists: true });
      await ctx.visible('.workspace-opening .spinner');
      // The read has a 30 s deadline (gui/app/main.mjs runBoot); the failure appears when it passes.
      await ctx.visible('.opening-failure [data-opening-cause]', { timeout: 60000 });
      await ctx.visible('[data-action="retry-boot"]');
      await ctx.visible('[data-action="choose-folder"]');
      await requireLocalized(ctx, '.opening-failure h2', ['The M1ND cannot be read', 'No se puede leer la M1ND']);
    },
  },

  '1.10': {
    // After setup: Not now on the repository offer and Later on Overseer creation leave the empty M1ND.
    async reach(ctx) {
      await ctx.visible('[data-start-dialog="discovery"]');
      await ctx.page.click('[data-action="dismiss-discovery"]');
      await ctx.visible('[data-start-dialog="overseer"]', { timeout: 30000 });
      await ctx.page.click('[data-action="cancel-agent"]');
      await ctx.gone('dialog[open]');
    },
  },
};
