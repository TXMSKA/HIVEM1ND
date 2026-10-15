// Start board, row 1: first run. Every case reaches its state through the GUI on a new temporary M1ND.
const FOLDER_BUTTON = '.discovery-folder button[aria-expanded]';

async function setExpanded(page, name, wanted) {
  const folders = await page.eval(selector => [...document.querySelectorAll(selector)].map(button => ({ name: button.getAttribute('aria-label'), open: button.getAttribute('aria-expanded') === 'true' })), FOLDER_BUTTON);
  const index = folders.findIndex(folder => folder.name === name);
  if (index < 0) throw new Error(`The ${name} folder is not in the offer.`);
  if (folders[index].open !== wanted) await page.click(FOLDER_BUTTON, { index });
}

export const cases = {
  'start 1.1': {
    // A new M1ND with no accepted clusters or Overseer: the read-only discovery offer opens by itself.
    async reach(ctx) {
      const { page } = ctx;
      await ctx.visible('[data-start-dialog="discovery"]');
      // Web expanded and the other folders collapsed, as the board shows it.
      await setExpanded(page, 'Tools', false);
      await setExpanded(page, 'Web', true);
      await ctx.visible('.discovery-repository');
    },
  },
  'start 1.2': {
    // Accept the repository offer; with no Overseer the creation dialog follows.
    async reach(ctx) {
      await ctx.visible('[data-start-dialog="discovery"]');
      await ctx.page.click('[data-action="import-repositories"]');
      await ctx.visible('[data-start-dialog="overseer"]', { timeout: 60000 });
    },
  },
};
