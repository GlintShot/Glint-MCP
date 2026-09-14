/**
 * Attach to a live Glint Web Copilot board via Chrome DevTools Protocol.
 * Requires Chrome started with:
 *   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/glint-chrome-debug
 */
import { chromium } from 'playwright';

export const DEFAULT_CDP = process.env.GLINT_CDP_URL || 'http://127.0.0.1:9222';

const TIP_CDP =
  'Start Chrome with: google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/glint-chrome-debug';
const TIP_PAIR =
  'In Glint Web click Allow agent, copy the 4-letter board code, pass it as pairCode. Do not open a new editor tab.';

export async function connectCdp(cdpUrl = DEFAULT_CDP) {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    const e = new Error(`cdp_unavailable: ${err?.message || err}`);
    e.code = 'cdp_unavailable';
    e.tip = TIP_CDP;
    throw e;
  }
}

export async function listPages(browser) {
  return browser.contexts().flatMap((c) => c.pages());
}

/** Find the tab that owns this board code. */
export async function findBoardPage(browser, pairCode) {
  const code = String(pairCode || '').trim().toUpperCase();
  if (!code) return null;
  const pages = await listPages(browser);

  for (const p of pages) {
    try {
      const title = await p.title();
      if (title.includes(`[Glint ${code}]`)) return p;
    } catch {
      /* closed */
    }
  }

  for (const p of pages) {
    const ok = await p
      .evaluate((c) => {
        const g = window.__GLINT_COPILOT__;
        return !!(g && g.isThisBoard && g.isThisBoard(c));
      }, code)
      .catch(() => false);
    if (ok) return p;
  }
  return null;
}

/** Collect board registry entries from any open Glint tab. */
export async function listBoardsFromBrowser(browser) {
  const pages = await listPages(browser);
  const seen = new Map();

  for (const p of pages) {
    const rows = await p
      .evaluate(() => {
        const g = window.__GLINT_COPILOT__;
        if (g && typeof g.listBoards === 'function') {
          return g.listBoards();
        }
        return [];
      })
      .catch(() => []);

    for (const row of rows || []) {
      if (!row?.pairCode) continue;
      const key = String(row.pairCode).toUpperCase();
      const prev = seen.get(key);
      if (!prev || (row.focused && !prev.focused) || (row.updatedAt || 0) > (prev.updatedAt || 0)) {
        seen.set(key, { ...row, pairCode: key });
      }
    }

    // Also surface the live bridge on this page if Allow agent is on
    const live = await p
      .evaluate(() => {
        const g = window.__GLINT_COPILOT__;
        if (!g?.enabled || !g.pairCode) return null;
        return {
          pairCode: g.pairCode,
          generation: g.generation,
          focused: document.hasFocus(),
          href: location.href,
          title: document.title,
          live: true,
        };
      })
      .catch(() => null);
    if (live?.pairCode) {
      const key = String(live.pairCode).toUpperCase();
      seen.set(key, { ...(seen.get(key) || {}), ...live, pairCode: key });
    }
  }

  return [...seen.values()].sort((a, b) => {
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

export async function withBoard(pairCode, fn, { cdpUrl = DEFAULT_CDP } = {}) {
  const code = String(pairCode || '').trim().toUpperCase();
  if (!code || code.length < 4) {
    return { ok: false, error: 'bad_pair_code', tip: TIP_PAIR };
  }

  let browser;
  try {
    browser = await connectCdp(cdpUrl);
  } catch (err) {
    return { ok: false, error: err.code || 'cdp_unavailable', detail: err.message, tip: err.tip || TIP_CDP };
  }

  try {
    const page = await findBoardPage(browser, code);
    if (!page) {
      const boards = await listBoardsFromBrowser(browser);
      return {
        ok: false,
        error: 'board_not_found',
        pairCode: code,
        boards,
        tip: TIP_PAIR,
      };
    }
    await page.bringToFront().catch(() => {});
    return await fn(page, code);
  } finally {
    // Disconnect Playwright from CDP; do not quit the user's Chrome.
    await browser.close().catch(() => {});
  }
}

export async function evalBridge(page, fnSource, arg) {
  return page.evaluate(fnSource, arg);
}

export { TIP_CDP, TIP_PAIR };
