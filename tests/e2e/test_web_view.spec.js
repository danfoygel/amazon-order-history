const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Route interception: serve synthetic fixtures from tests/e2e/fixtures/
// instead of the real data/ directory.
// ---------------------------------------------------------------------------
test.beforeEach(async ({ page }) => {
  const fixturesDir = path.join(__dirname, 'fixtures');

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

});

// ---------------------------------------------------------------------------
// Helper: navigate to the app and wait for it to fully load.
// Clears localStorage before navigation so each test starts clean.
// ---------------------------------------------------------------------------
async function loadApp(page) {
  // Navigate to a blank page first so we have an origin, then clear storage.
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  // Reload to pick up the clean state.
  await page.reload();
  await page.waitForLoadState('networkidle');
  // Wait for the item list to render (at least one card or the meta-bar text).
  await page.waitForSelector('#meta-bar');
}

// ---------------------------------------------------------------------------
// Helper: get the text content of a tab's count badge.
// ---------------------------------------------------------------------------
async function tabCount(page, filter) {
  const tab = page.locator(`.tab[data-filter="${filter}"]`);
  const countEl = tab.locator('.count');
  return parseInt(await countEl.textContent(), 10);
}

// ---------------------------------------------------------------------------
// Helper: click a filter tab.
// ---------------------------------------------------------------------------
async function clickTab(page, filter) {
  await page.locator(`.tab[data-filter="${filter}"]`).click();
  // Brief pause for rendering.
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Helper: count visible item cards.
// ---------------------------------------------------------------------------
async function cardCount(page) {
  return page.locator('.item-card').count();
}

// ===========================================================================
// Tests
// ===========================================================================

test.describe('Initial load (2025 data only)', () => {

  test('meta-bar shows partial item count with load-all link', async ({ page }) => {
    await loadApp(page);
    const metaText = await page.locator('#meta-bar').textContent();
    // Should show "18 of 20 items" and "(load all)" link.
    expect(metaText).toContain('18');
    expect(metaText).toContain('20');
    expect(metaText).toContain('(load all)');
  });

  test('tab counts are correct for 2025 data', async ({ page }) => {
    await loadApp(page);

    expect(await tabCount(page, 'all')).toBe(18);
    expect(await tabCount(page, 'Delivered')).toBe(8);
    expect(await tabCount(page, 'Shipped')).toBe(2);
    expect(await tabCount(page, 'Ordered')).toBe(2);
    expect(await tabCount(page, 'Return Started')).toBe(2);
    expect(await tabCount(page, 'Replacement Ordered')).toBe(1);
    expect(await tabCount(page, 'Return in Transit')).toBe(1);
    expect(await tabCount(page, 'Return Complete')).toBe(1);
    expect(await tabCount(page, 'Cancelled')).toBe(1);
    expect(await tabCount(page, 'mail_back')).toBe(3);
    expect(await tabCount(page, 'decide')).toBe(3);
  });

  test('Delivered tab shows 8 cards', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    expect(await cardCount(page)).toBe(8);
  });

  test('Shipped tab shows 2 cards', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Shipped');
    expect(await cardCount(page)).toBe(2);
  });

  test('Ordered tab shows 2 cards', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Ordered');
    expect(await cardCount(page)).toBe(2);
  });

  test('Return Started tab shows 2 cards (item 9 demoted)', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Return Started');
    expect(await cardCount(page)).toBe(2);
    // Verify items 7 (Pickle) and 8 (Panasonic) are present.
    await expect(page.locator('.item-card', { hasText: 'Pickle' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Panasonic' })).toBeVisible();
    // Kayak Hoists (item 9) should NOT be here — it's demoted to Delivered.
    await expect(page.locator('.item-card', { hasText: 'Kayak' })).not.toBeVisible();
  });

  test('Replacement Ordered tab shows 1 card', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Replacement Ordered');
    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Hazmat' })).toBeVisible();
  });

  test('Cancelled tab shows 1 card', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Cancelled');
    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Sewing Needles' })).toBeVisible();
  });
});

test.describe('Load all years', () => {

  test('clicking load-all loads 2024 data and updates counts', async ({ page }) => {
    await loadApp(page);

    // Click "(load all)" link.
    await page.locator('#load-all-link').click();
    await page.waitForLoadState('networkidle');
    // Wait for the meta-bar to update (load-all link disappears).
    await page.waitForFunction(() => {
      return !document.getElementById('load-all-link');
    });

    const metaText = await page.locator('#meta-bar').textContent();
    expect(metaText).toContain('20');
    expect(metaText).not.toContain('(load all)');

    // Tab counts should update.
    expect(await tabCount(page, 'all')).toBe(20);
    expect(await tabCount(page, 'Delivered')).toBe(10);
    // Decide should include Swim Fins (item 20) now.
    expect(await tabCount(page, 'decide')).toBe(4);
    // Other counts unchanged.
    expect(await tabCount(page, 'Shipped')).toBe(2);
    expect(await tabCount(page, 'Ordered')).toBe(2);
  });

  test('Delivered tab shows 10 cards after load all', async ({ page }) => {
    await loadApp(page);
    await page.locator('#load-all-link').click();
    await page.waitForFunction(() => !document.getElementById('load-all-link'));
    await clickTab(page, 'Delivered');
    expect(await cardCount(page)).toBe(10);
  });
});

test.describe('Search filtering', () => {

  test('searching for "Pickle" shows only Emotional Support Pickle', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Pickle' })).toBeVisible();
  });

  test('searching by order ID shows matching item', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', '114-4948746-6648245');
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Punching Bag' })).toBeVisible();
  });

  test('searching by ASIN shows matching item', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'B019PGG1AC');
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Jack Chain' })).toBeVisible();
  });

  test('clearing search restores all items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(1);
    await page.fill('#search-input', '');
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(18);
  });
});

test.describe('Subscribe & Save filter', () => {

  test('S&S checkbox filters to only S&S items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('#sns-filter').check();
    await page.waitForTimeout(300);
    expect(await cardCount(page)).toBe(3);
    await expect(page.locator('.item-card', { hasText: 'Rechargeable' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Hanukkah' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Pistachio' })).toBeVisible();
  });

  test('unchecking S&S restores full list', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('#sns-filter').check();
    await page.waitForTimeout(200);
    await page.locator('#sns-filter').uncheck();
    await page.waitForTimeout(200);
    expect(await cardCount(page)).toBe(18);
  });

  test('S&S count badge shows correct number', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    const snsCount = await page.locator('#sns-count').textContent();
    expect(snsCount).toBe('(3)');
  });
});

test.describe('Status badges', () => {

  test('Delivered items show "Delivered" badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    // Check that the DEWALT Cutting Wheel card has a Delivered badge.
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    await expect(card.locator('.badge-delivered')).toHaveText('Delivered');
  });

  test('Shipped items show "Shipped" badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Shipped');
    const card = page.locator('.item-card', { hasText: 'Punching Bag' });
    await expect(card.locator('.badge-in-transit')).toHaveText('Shipped');
  });

  test('Ordered items show "Ordered" badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Ordered');
    const card = page.locator('.item-card', { hasText: 'Nozzle Cleaning' });
    await expect(card.locator('.badge-pending')).toHaveText('Ordered');
  });

  test('Cancelled items show "Cancelled" badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Cancelled');
    const card = page.locator('.item-card', { hasText: 'Sewing Needles' });
    await expect(card.locator('.badge-cancelled')).toHaveText('Cancelled');
  });

  test('Replacement Ordered items show "Replacement" badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Replacement Ordered');
    const card = page.locator('.item-card', { hasText: 'Hazmat' });
    await expect(card.locator('.badge-replacement')).toHaveText('Replacement');
  });
});

test.describe('Return policy icons', () => {

  test('free_or_replace items show free-returns icon', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    await expect(card.locator('.badge-free-returns')).toBeVisible();
  });

  test('non_returnable items show no-return icon', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Luxardo' });
    await expect(card.locator('.badge-no-return')).toBeVisible();
  });

  test('return_only items show return-only icon', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Furniture Glides' });
    await expect(card.locator('.badge-return-only')).toBeVisible();
  });
});

test.describe('Combined view', () => {

  test('combined view shows Mail Back, Decide, Shipped, Ordered sections', async ({ page }) => {
    await loadApp(page);
    // Combined is the default tab.
    const headings = page.locator('.section-heading');
    const headingTexts = await headings.allTextContents();
    const headingLabels = headingTexts.map(t => t.replace(/^[\u25B8\u25BE]\s*/, '').trim());

    // Should contain these sections (in order).
    expect(headingLabels.some(h => h.startsWith('Mail Back'))).toBe(true);
    expect(headingLabels.some(h => h.startsWith('Decide'))).toBe(true);
    expect(headingLabels.some(h => h.startsWith('Shipped'))).toBe(true);
    expect(headingLabels.some(h => h.startsWith('Ordered'))).toBe(true);
    // Should also have a monthly section for January 2025.
    expect(headingLabels.some(h => h.includes('January 2025'))).toBe(true);
  });

  test('Mail Back section has 3 items', async ({ page }) => {
    await loadApp(page);
    const headings = page.locator('.section-heading');
    const allTexts = await headings.allTextContents();
    const mailBackText = allTexts.find(t => t.includes('Mail Back'));
    expect(mailBackText).toContain('(3)');
  });

  test('Decide section has 3 items', async ({ page }) => {
    await loadApp(page);
    const headings = page.locator('.section-heading');
    const allTexts = await headings.allTextContents();
    const decideText = allTexts.find(t => t.includes('Decide'));
    expect(decideText).toContain('(3)');
  });

  test('Shipped section has 2 items', async ({ page }) => {
    await loadApp(page);
    const headings = page.locator('.section-heading');
    const allTexts = await headings.allTextContents();
    const shippedText = allTexts.find(t => t.includes('Shipped'));
    expect(shippedText).toContain('(2)');
  });

  test('Ordered section has 2 items', async ({ page }) => {
    await loadApp(page);
    const headings = page.locator('.section-heading');
    const allTexts = await headings.allTextContents();
    const orderedText = allTexts.find(t => t.includes('Ordered'));
    expect(orderedText).toContain('(2)');
  });
});

test.describe('Section collapse/expand', () => {

  test('clicking a section heading collapses and expands it', async ({ page }) => {
    await loadApp(page);
    // Find the "Mail Back" section group.
    const mailBackHeading = page.locator('.section-heading', { hasText: 'Mail Back' });
    const sectionGroup = mailBackHeading.locator('..');

    // Initially expanded: section-items should be visible.
    const sectionItems = sectionGroup.locator('.section-items');
    await expect(sectionItems).toBeVisible();

    // Click to collapse.
    await mailBackHeading.click();
    await expect(sectionGroup).toHaveClass(/collapsed/);

    // Click again to expand.
    await mailBackHeading.click();
    await expect(sectionGroup).not.toHaveClass(/collapsed/);
  });
});

test.describe('Keep button', () => {

  test('Keep button removes item from Decide tab', async ({ page }) => {
    await loadApp(page);

    // Verify Decide starts at 3.
    expect(await tabCount(page, 'decide')).toBe(3);

    // Go to Decide tab.
    await clickTab(page, 'decide');
    expect(await cardCount(page)).toBe(3);

    // Click Keep on the first visible card.
    const firstCard = page.locator('.item-card').first();
    const keepBtn = firstCard.locator('.keep-btn');
    await keepBtn.click();
    await page.waitForTimeout(300);

    // Decide count should now be 2, and only 2 cards visible.
    expect(await tabCount(page, 'decide')).toBe(2);
    expect(await cardCount(page)).toBe(2);
  });

  test('Keep persists across page reload', async ({ page }) => {
    await loadApp(page);

    // Keep an item.
    await clickTab(page, 'decide');
    const firstCard = page.locator('.item-card').first();
    await firstCard.locator('.keep-btn').click();
    await page.waitForTimeout(300);
    expect(await tabCount(page, 'decide')).toBe(2);

    // Reload the page.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#meta-bar');

    // Decide should still be 2.
    expect(await tabCount(page, 'decide')).toBe(2);
  });
});

test.describe('Demoted Return Started item (Kayak Hoists)', () => {

  test('Kayak Hoists appears in Delivered tab, not Return Started', async ({ page }) => {
    await loadApp(page);

    // Should be in Delivered.
    await clickTab(page, 'Delivered');
    await expect(page.locator('.item-card', { hasText: 'Kayak' })).toBeVisible();

    // Should NOT be in Return Started.
    await clickTab(page, 'Return Started');
    await expect(page.locator('.item-card', { hasText: 'Kayak' })).not.toBeVisible();
  });
});

test.describe('Card content', () => {

  test('card shows quantity when > 1', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Shipped');
    const card = page.locator('.item-card', { hasText: 'Punching Bag' });
    // Punching Bag: qty 2
    await expect(card).toContainText('Qty: 2');
  });

  test('card shows order date', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    // Order date: Jan 1, 2025
    await expect(card).toContainText('Jan 1, 2025');
  });

  test('S&S badge appears on S&S items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Rechargeable' });
    await expect(card.locator('.badge-sns')).toBeVisible();
  });

  test('S&S badge does not appear on non-S&S items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    await expect(card.locator('.badge-sns')).not.toBeVisible();
  });
});

test.describe('Return window badges', () => {

  test('open return window shows return-by badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'DEWALT' });
    // return_window_end=2099-12-31 — should show "Return by ..." with ok or warn badge.
    const badge = card.locator('.return-badge-ok, .return-badge-warn');
    await expect(badge).toBeVisible();
  });

  test('closed return window shows closed badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Delivered');
    const card = page.locator('.item-card', { hasText: 'Furniture Glides' });
    // return_window_end=2020-01-01 — closed.
    await expect(card.locator('.return-badge-closed')).toBeVisible();
  });

  test('Mail Back items with deadline show mail-back badge', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'Return Started');
    const card = page.locator('.item-card', { hasText: 'Panasonic' });
    // return_window_end=2099-03-15 → "Mail back by Mar 15" badge.
    await expect(card).toContainText('Mail back by');
  });
});

test.describe('Empty state', () => {

  test('non-matching search shows empty state', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'zzzznonexistent');
    await page.waitForTimeout(300);
    await expect(page.locator('.empty-state')).toBeVisible();
  });
});
