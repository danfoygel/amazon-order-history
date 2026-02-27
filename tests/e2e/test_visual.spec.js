const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Shared setup: fixture routing, date freezing, image masking helpers
// ---------------------------------------------------------------------------

const FROZEN_DATE = new Date('2025-06-15T12:00:00Z');

test.beforeEach(async ({ page }) => {
  const fixturesDir = path.join(__dirname, 'fixtures');

  // Route data requests to fixtures (same as functional E2E tests).
  await page.route('**/data/**', async (route) => {
    const url = new URL(route.request().url());
    const filename = path.basename(url.pathname);
    const filePath = path.join(fixturesDir, filename);

    if (fs.existsSync(filePath)) {
      const body = fs.readFileSync(filePath, 'utf-8');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body,
      });
    } else {
      await route.fulfill({ status: 404 });
    }
  });

  // Freeze Date.now() so relative date badges ("today", "3d left") are stable.
  await page.addInitScript(`{
    const frozenNow = ${FROZEN_DATE.getTime()};
    const OrigDate = Date;
    Date = class extends OrigDate {
      constructor(...args) {
        if (args.length === 0) { super(frozenNow); } else { super(...args); }
      }
      static now() { return frozenNow; }
    };
    Date.prototype = OrigDate.prototype;
  }`);
});

// ---------------------------------------------------------------------------
// Helper: load the app with clean state.
// ---------------------------------------------------------------------------
async function loadApp(page) {
  // Clear localStorage via init script so it's clean before anything loads.
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  // #meta-bar is hidden on narrow viewports (<640px), so wait for
  // the item list or filter tabs instead.
  await page.waitForSelector('#filter-tabs');
  await page.waitForSelector('.item-card, .empty-state', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Helper: click "load all" and wait for all data to be loaded.
// ---------------------------------------------------------------------------
async function loadAll(page) {
  await page.locator('#load-all-link').click();
  await page.waitForFunction(() => !document.getElementById('load-all-link'));
}

// ---------------------------------------------------------------------------
// Helper: click a filter tab.
// ---------------------------------------------------------------------------
async function clickTab(page, filter) {
  await page.locator(`.tab[data-filter="${filter}"]`).click();
  await page.locator(`.tab[data-filter="${filter}"].active`).waitFor();
}

// ---------------------------------------------------------------------------
// Mask locators to exclude dynamic/external content from pixel comparison.
// ---------------------------------------------------------------------------
function imageMask(page) {
  return [page.locator('.card-thumb')];
}

function chartMask(page) {
  return [page.locator('canvas')];
}

// ---------------------------------------------------------------------------
// Screenshot options shared across tests.
// ---------------------------------------------------------------------------
const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.01,
};

// ===========================================================================
// Full-page views (desktop 1280×800)
// ===========================================================================

test.describe('Visual: Full-page views', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('combined view — initial load', async ({ page }) => {
    await loadApp(page);
    await expect(page).toHaveScreenshot('combined-initial.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('combined view — all data loaded', async ({ page }) => {
    await loadApp(page);
    await loadAll(page);
    await expect(page).toHaveScreenshot('combined-all-loaded.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('combined view — section collapsed', async ({ page }) => {
    await loadApp(page);
    // Collapse the Mail Back section.
    await page.locator('.section-heading', { hasText: 'Mail Back' }).click();
    // Wait for collapse class to be applied.
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll('.section-heading')].find(el => el.textContent.includes('Mail Back'));
      return h && h.parentElement.classList.contains('collapsed');
    });
    await expect(page).toHaveScreenshot('combined-collapsed.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('All tab', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await expect(page).toHaveScreenshot('all-tab.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('Delivered tab', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    await expect(page).toHaveScreenshot('delivered-tab.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('Return Started tab', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Return Started');
    await expect(page).toHaveScreenshot('return-started-tab.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('Cancelled tab', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Cancelled');
    await expect(page).toHaveScreenshot('cancelled-tab.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('search with results', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');
    await page.locator('.item-card', { hasText: 'Pickle' }).waitFor();
    await expect(page).toHaveScreenshot('search-results.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('search with no results', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'zzzznonexistent');
    await page.locator('.empty-state').waitFor();
    await expect(page).toHaveScreenshot('search-empty.png', {
      ...SCREENSHOT_OPTS,
      fullPage: true,
    });
  });

  test('S&S filter active', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('#sns-filter').check();
    await expect(page).toHaveScreenshot('sns-filter.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('graph modal — Years', async ({ page }) => {
    await loadApp(page);
    await loadAll(page);
    await page.locator('.graph-btn', { hasText: 'Years' }).click();
    await page.locator('canvas').waitFor();
    await expect(page).toHaveScreenshot('graph-years.png', {
      ...SCREENSHOT_OPTS,
      mask: [...imageMask(page), ...chartMask(page)],
    });
  });

  test('graph modal — Months', async ({ page }) => {
    await loadApp(page);
    await loadAll(page);
    await page.locator('.graph-btn', { hasText: 'Months' }).click();
    await page.locator('canvas').waitFor();
    await expect(page).toHaveScreenshot('graph-months.png', {
      ...SCREENSHOT_OPTS,
      mask: [...imageMask(page), ...chartMask(page)],
    });
  });
});

// ===========================================================================
// Individual card screenshots (element-level)
// ===========================================================================

test.describe('Visual: Card details', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('delivered card with free-returns badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    await expect(card).toHaveScreenshot('card-delivered-free-returns.png', {
      ...SCREENSHOT_OPTS,
      mask: [card.locator('.card-thumb')],
    });
  });

  test('shipped card with tracking', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Shipped');
    const card = page.locator('.item-card', { hasText: 'Punching Bag' });
    await expect(card).toHaveScreenshot('card-shipped.png', {
      ...SCREENSHOT_OPTS,
      mask: [card.locator('.card-thumb')],
    });
  });

  test('S&S card with blue pill badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Rechargeable' });
    await expect(card).toHaveScreenshot('card-sns.png', {
      ...SCREENSHOT_OPTS,
      mask: [card.locator('.card-thumb')],
    });
  });

  test('non-returnable card with red badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Luxardo' });
    await expect(card).toHaveScreenshot('card-non-returnable.png', {
      ...SCREENSHOT_OPTS,
      mask: [card.locator('.card-thumb')],
    });
  });
});

// ===========================================================================
// Responsive views (mobile 375×812)
// ===========================================================================

test.describe('Visual: Mobile responsive', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('combined view — mobile layout', async ({ page }) => {
    await loadApp(page);
    await expect(page).toHaveScreenshot('mobile-combined.png', {
      ...SCREENSHOT_OPTS,
      mask: imageMask(page),
      fullPage: true,
    });
  });

  test('filter nav — mobile tab wrapping', async ({ page }) => {
    await loadApp(page);
    const nav = page.locator('#filter-tabs');
    await expect(nav).toHaveScreenshot('mobile-filter-nav.png', {
      ...SCREENSHOT_OPTS,
    });
  });
});
