// Row 5: Void (the Document mode). Every case reaches its state through the GUI on a temporary M1ND whose shop repository holds a text
// library (Release, Manuals and Drafts folders, the text "Release notes 3.0" with three pages) and an attached agent, executor-shop.
import { caretAfter, failSaves, holdSaves, openText, seedVoid, selectPhrase, suggestChange } from '../void-helpers.mjs';

const SAVE = '[data-void-save]';

// Words the cases type or search, per language (the sentence they replace is ctx.void.idle.before, the last one of the first paragraph).
const PHRASE = {
  en: { typed: 'An idle machine makes no requests and sends nothing.', query: 'machine', replacement: 'computer', edit: ' Edited here.' },
  es: { typed: 'Una máquina inactiva no hace solicitudes y no envía nada.', query: 'máquina', replacement: 'computadora', edit: ' Editado aquí.' },
};

// Every case starts the same way: the seeded library on screen with the main text selected.
const base = {
  entry: 'none',
  async seed(ctx) { ctx.void = await seedVoid(ctx); },
  async start(ctx) {
    await ctx.open({ overseerExists: true });
    await openText(ctx, ctx.void.main.id);
  },
};

async function status(ctx, state, timeout = 15000) {
  await ctx.page.waitFor((selector, wanted) => document.querySelector(selector)?.getAttribute('data-void-save') === wanted, { timeout, args: [SAVE, state], message: `the save status to be ${state}` });
}

// Click at the end of a phrase of the body and type there, the way a person edits in place.
async function typeAfter(ctx, phrase, value) {
  await caretAfter(ctx.page, phrase);
  await ctx.page.type(value);
}

export const cases = {
  '5.1': {
    ...base,
    async reach(ctx) {
      await base.start(ctx);
      await ctx.visible('.editor-catalog [data-library-project]');
      await ctx.visible('[data-action="void-attach"]');
    },
  },

  '5.2': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      await base.start(ctx);
      // Create a folder: the dialog asks where, the new folder appears named and ready to type; Enter keeps its name.
      await page.click('[data-action="new-folder"]');
      await ctx.visible('[data-form="library-folder"] [data-action="confirm-form"]');
      // The dialog offers the folder of the open text as the parent; the new folder goes to the project root (first option).
      await page.focus('[data-form="library-folder"] [data-field="create-folder"]');
      await page.press('Home');
      await page.waitFor(() => document.querySelector('[data-form="library-folder"] [data-field="create-folder"]')?.value === '', { message: 'the project root to be the parent' });
      await page.click('[data-form="library-folder"] [data-action="confirm-form"]');
      await ctx.visible('[data-library-rename]', { timeout: 30000 });
      await page.press('Enter');
      await ctx.gone('[data-library-rename]', { timeout: 30000 });
      await page.waitFor(() => [...document.querySelectorAll('.library-folder-row')].some(row => row.querySelector('.library-count')?.textContent === '0'), { timeout: 30000, message: 'the new empty folder in the library' });
      // Begin the inline rename of a text that is not the open one: More menu, Rename.
      const other = ctx.void.texts['Install guide'].id;
      await page.click(`[data-library-more="${other}"]`);
      await ctx.visible('[data-library-menu="item"] [data-action="library-rename"]');
      await page.click('[data-library-menu="item"] [data-action="library-rename"]');
      await ctx.visible(`[data-library-rename="${other}"]`);
      await page.waitFor(id => document.activeElement?.getAttribute('data-library-rename') === id, { args: [other], message: 'the rename field to hold the caret' });
    },
  },

  '5.3': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      await base.start(ctx);
      const other = ctx.void.texts['Install guide'].id;
      await page.click(`[data-library-more="${other}"]`);
      await ctx.visible('[data-library-menu="item"] [data-action="library-delete"]');
      await page.click('[data-library-menu="item"] [data-action="library-delete"]');
      await ctx.visible('dialog[open][data-library-delete="item"]', { timeout: 30000 });
    },
  },

  '5.4': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      const phrase = PHRASE[ctx.language];
      await base.start(ctx);
      // The save started by the typing stays in flight, so the toolbar says Saving while the person keeps working.
      const hold = await holdSaves(page, ctx.void.main.id);
      ctx.defer(hold.release);
      const old = ctx.void.idle.before;
      await selectPhrase(page, old);
      await page.type(phrase.typed);
      await status(ctx, 'saving');
      // Select the passage that was typed: the format bar floats over a selection only.
      await selectPhrase(page, phrase.typed);
      await page.waitFor(() => { const bar = document.querySelector('[data-format-bar]'); return bar && !bar.hidden && bar.getBoundingClientRect().width > 0; }, { message: 'the format bar over the selection' });
      await status(ctx, 'saving');
    },
  },

  '5.5': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      const phrase = PHRASE[ctx.language];
      await base.start(ctx);
      // The repository stops answering while the person edits: every save request is refused.
      const failing = await failSaves(page, ctx.void.main.id);
      ctx.defer(failing.restore);
      await typeAfter(ctx, ctx.void.idle.before, phrase.edit);
      await ctx.visible('[data-void-error] [data-action="retry-void-save"]', { timeout: 30000 });
      await status(ctx, 'not-saved');
    },
  },

  '5.6': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      const phrase = PHRASE[ctx.language];
      await base.start(ctx);
      await page.click('[data-action="toggle-find"]');
      await ctx.visible('[data-find-bar]');
      await page.fill('[data-find-field="query"]', phrase.query);
      await page.fill('[data-find-field="replacement"]', phrase.replacement);
      // The hits are found by the worker: the count leaves 0 and the page marks its hits.
      await page.waitFor(() => {
        const count = document.querySelector('[data-find-count]')?.textContent ?? '';
        return /^[1-9]/.test(count.trim()) && Number(document.querySelector('[data-find-hits]')?.getAttribute('data-find-hits')) > 0;
      }, { timeout: 30000, message: 'the find count and the hits of the page' });
      await page.waitFor(() => { const replace = document.querySelector('[data-action="replace-all"]'); return replace && !replace.disabled; }, { timeout: 30000, message: 'Replace all to be enabled' });
    },
  },

  '5.7': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      const phrase = PHRASE[ctx.language];
      await base.start(ctx);
      // Edit in place so the caret sits in edited content, then switch to Source.
      await typeAfter(ctx, ctx.void.idle.before, phrase.edit);
      await status(ctx, 'saved', 30000);
      await page.click('[data-action="toggle-source"]');
      await ctx.visible('[data-source-edit] [data-source]');
      await page.waitFor(() => { const area = document.querySelector('[data-source]'); return document.activeElement === area && area.selectionStart > 0 && area.selectionStart === area.selectionEnd; }, { timeout: 15000, message: 'the caret in the Source field' });
    },
  },

  '5.8': {
    ...base,
    // The person commented on a sentence and the attached agent answered with a change; the text opens with the suggestion pending.
    async seed(ctx) { ctx.void = await seedVoid(ctx); await suggestChange(ctx, ctx.void); },
    async reach(ctx) {
      await base.start(ctx);
      await ctx.visible('[data-proposal][data-state="pending"] [data-action="accept-change"]', { timeout: 30000 });
      await ctx.visible('[data-action="edit-change"]');
    },
  },

  '5.9': {
    ...base,
    async seed(ctx) { ctx.void = await seedVoid(ctx); await suggestChange(ctx, ctx.void); },
    async reach(ctx) {
      const phrase = PHRASE[ctx.language];
      await base.start(ctx);
      await ctx.visible('[data-proposal][data-state="pending"] [data-action="accept-change"]', { timeout: 30000 });
      // The person changes the passage the suggestion was made on, so the suggestion no longer matches the text.
      await typeAfter(ctx, ctx.void.idle.before, phrase.edit);
      await status(ctx, 'saved', 30000);
      await ctx.visible('[data-proposal-stale="true"] [data-action="edit-passage"]', { timeout: 30000 });
      await ctx.visible('[data-proposal-stale="true"] [data-action="ask-again"]');
    },
  },

  '5.10': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      await base.start(ctx);
      // The pointer must not move in Focus: any movement shows the tools. The caret is placed first and Focus keeps it.
      ctx.keepPointer = true;
      await caretAfter(page, ctx.void.idle.before);
      await page.click('[data-action="enter-focus"]');
      await ctx.visible('[data-focus-layout] [data-void-body]');
      await ctx.visible('[data-focus-hint]');
      await page.waitFor(() => document.querySelector('[data-tools]')?.getAttribute('data-tools') === 'hidden', { message: 'the Focus tools to stay hidden' });
    },
  },

  '5.11': {
    ...base,
    async reach(ctx) {
      const { page } = ctx;
      await base.start(ctx);
      ctx.keepPointer = true;
      await caretAfter(page, ctx.void.idle.before);
      await page.click('[data-action="enter-focus"]');
      await ctx.visible('[data-focus-layout] [data-void-body]');
      // Moving the pointer shows the tools: Document, Page 1 of 3, the attached unit and Watch.
      await page.hover([720, 450]);
      await page.hover([760, 470]);
      await ctx.visible('[data-tools="visible"] [data-action="leave-focus"]');
      await ctx.visible('.void-page-dots [data-page-dot]');
    },
  },
};
