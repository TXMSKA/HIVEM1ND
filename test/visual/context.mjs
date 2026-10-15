import { until } from './chrome.mjs';

// Everything a case needs: the booted actual core (`world`), the Chrome page, and helpers that wait on conditions.
export function makeContext({ task, world, page, browser, spec }) {
  const [width, height] = task.viewport;
  const ctx = {
    reference: task.reference, language: task.language, look: task.look, viewport: task.viewport, width, height,
    task, world, page, browser, spec, keepPointer: false, maskSelectors: [], deferred: [],
    es: task.language === 'es',
    // Register cleanup for anything a case starts itself (a setup wizard server, a temporary directory); the runner
    // runs it, last registered first, when the case ends, whether it captured or not.
    defer(fn) { ctx.deferred.push(fn); },
    async cleanup() {
      for (const fn of ctx.deferred.splice(0).reverse()) await Promise.resolve().then(fn).catch(() => undefined);
    },
    // Open the app on the actual core and wait until the shell has finished reading.
    // `overseerExists` is for a world whose Overseer was created before the page loaded: the app asks to create an
    // Overseer when it opens even though one exists (the unit list is still empty at that moment), so the person's
    // earlier "Later" is recorded in the page storage first, which is what that dialog's own Later button writes.
    async open({ url = world.url, ready = true, overseerExists = false } = {}) {
      if (overseerExists) {
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('hivem1nd:overseer:' + ${JSON.stringify(world.mind)}, 'dismissed'); } catch {}` });
      }
      await page.navigate(url);
      if (ready) await ctx.shellReady();
    },
    async shellReady(timeout = 30000) {
      await page.waitFor(() => (document.querySelector('.foot') || document.querySelector('.phone-status')) && !document.querySelector('.workspace-opening') && !document.querySelector('#status'), { timeout, message: 'the app shell to finish reading' });
    },
    // The state is shown when a selector is visible; cases wait on conditions, never on fixed sleeps.
    async visible(selector, { timeout = 15000, text = null } = {}) {
      await page.waitFor((sel, needle) => [...document.querySelectorAll(sel)].some(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!needle || node.textContent.includes(needle)); }), { timeout, args: [selector, text], message: `visible ${selector}${text ? ` containing ${text}` : ''}` });
    },
    async gone(selector, { timeout = 15000 } = {}) {
      await page.waitFor(sel => ![...document.querySelectorAll(sel)].some(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), { timeout, args: [selector], message: `${selector} to be gone` });
    },
    // Fonts loaded and no finite animation still running (infinite spinners are part of the state and are allowed).
    async settle(timeout = 8000) {
      await page.waitFor(async () => {
        await document.fonts.ready;
        const running = document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
        if (running.length) return false;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      }, { timeout, message: 'the page to settle' });
    },
    async park() { if (!ctx.keepPointer) await page.mouseEvent('mouseMoved', width - 2, height - 2); },
    // Replace generated credential text (pairing code, key) before anything is stored.
    mask(...selectors) { ctx.maskSelectors.push(...selectors); },
    async applyMask() {
      if (!ctx.maskSelectors.length) return;
      await page.eval(selectors => {
        const apply = () => {
          for (const selector of selectors) for (const node of document.querySelectorAll(selector)) {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            for (let text = walker.nextNode(); text; text = walker.nextNode()) { const masked = text.nodeValue.replace(/[^\s•]/g, '•'); if (masked !== text.nodeValue) text.nodeValue = masked; }
            if ('value' in node && node.value) { const masked = node.value.replace(/[^\s•]/g, '•'); if (masked !== node.value) node.value = masked; }
          }
        };
        apply();
        // The app repaints on timers and events; the observer masks a repainted credential before the next frame is drawn.
        window.__captureMask?.disconnect();
        window.__captureMask = new MutationObserver(apply);
        window.__captureMask.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      }, ctx.maskSelectors);
    },
    // The clock of the actual core (injected clock): hours and minutes pass without waiting.
    advance(ms) { world.fx.control.advance(ms); },
    async finish() {
      await ctx.applyMask();
      await ctx.settle();
      await ctx.park();
      await ctx.settle();
    },
  };
  return ctx;
}

export { until };
