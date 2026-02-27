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
        contentType: 'application/json',
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
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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
  // Wait for the tab to become active.
  await page.locator(`.tab[data-filter="${filter}"].active`).waitFor();
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
    // Should show "18 of 23 items" and "(load all)" link.
    expect(metaText).toContain('18');
    expect(metaText).toContain('23');
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
    // Wait for the meta-bar to update (load-all link disappears).
    await page.waitForFunction(() => {
      return !document.getElementById('load-all-link');
    });

    const metaText = await page.locator('#meta-bar').textContent();
    expect(metaText).toContain('23');
    expect(metaText).not.toContain('(load all)');

    // Tab counts should update.
    expect(await tabCount(page, 'all')).toBe(23);
    expect(await tabCount(page, 'Delivered')).toBe(13);
    // Decide should include Swim Fins (item 20) now.
    expect(await tabCount(page, 'decide')).toBe(4);
    // Other counts unchanged.
    expect(await tabCount(page, 'Shipped')).toBe(2);
    expect(await tabCount(page, 'Ordered')).toBe(2);
  });

  test('Delivered tab shows 13 cards after load all', async ({ page }) => {
    await loadApp(page);
    await page.locator('#load-all-link').click();
    await page.waitForFunction(() => !document.getElementById('load-all-link'));
    await clickTab(page, 'Delivered');
    expect(await cardCount(page)).toBe(13);
  });
});

test.describe('Search filtering', () => {

  test('searching for "Pickle" shows only Emotional Support Pickle', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');

    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Pickle' })).toBeVisible();
  });

  test('searching by order ID shows matching item', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', '114-4948746-6648245');

    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Punching Bag' })).toBeVisible();
  });

  test('searching by ASIN shows matching item', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'B019PGG1AC');

    expect(await cardCount(page)).toBe(1);
    await expect(page.locator('.item-card', { hasText: 'Jack Chain' })).toBeVisible();
  });

  test('clearing search restores all items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');

    expect(await cardCount(page)).toBe(1);
    await page.fill('#search-input', '');

    expect(await cardCount(page)).toBe(18);
  });
});

test.describe('Subscribe & Save filter', () => {

  test('S&S checkbox filters to only S&S items', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('#sns-filter').check();

    expect(await cardCount(page)).toBe(3);
    await expect(page.locator('.item-card', { hasText: 'Rechargeable' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Hanukkah' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Pistachio' })).toBeVisible();
  });

  test('unchecking S&S restores full list', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('#sns-filter').check();

    await page.locator('#sns-filter').uncheck();

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

    expect(await tabCount(page, 'decide')).toBe(2);

    // Reload the page.
    await page.reload();
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

    await expect(page.locator('.empty-state')).toBeVisible();
  });
});

// ===========================================================================
// Keyboard navigation
// ===========================================================================

test.describe('Keyboard navigation', () => {

  test('"/" focuses the search bar', async ({ page }) => {
    await loadApp(page);
    // Click body to ensure no element is focused.
    await page.locator('body').click();
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement.id);
    expect(focused).toBe('search-input');
  });

  test('Ctrl+K focuses the search bar', async ({ page }) => {
    await loadApp(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    const focused = await page.evaluate(() => document.activeElement.id);
    expect(focused).toBe('search-input');
  });

  test('number keys 1-9 switch tabs', async ({ page }) => {
    await loadApp(page);
    await page.locator('body').click();

    // Press "1" — should activate the first tab (Combined).
    await page.keyboard.press('1');
    await expect(page.locator('.tab[data-filter="combined"]')).toHaveClass(/active/);

    // Press "4" — should activate the 4th visible tab.
    await page.keyboard.press('4');
    const tabs = page.locator('.tab:visible');
    const fourthTab = tabs.nth(3);
    await expect(fourthTab).toHaveClass(/active/);
  });

  test('arrow keys move focus between item cards', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('body').click();

    // Press Right arrow to focus the first card.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.item-card').first()).toHaveClass(/card-focused/);

    // Press Right arrow again to move to the second card.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.item-card').nth(1)).toHaveClass(/card-focused/);
    // First card should no longer be focused.
    await expect(page.locator('.item-card').first()).not.toHaveClass(/card-focused/);

    // Press Left arrow to go back to the first card.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.item-card').first()).toHaveClass(/card-focused/);
  });

  test('up/down arrows jump by row (grid columns)', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('body').click();

    // Focus the first card.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.item-card').first()).toHaveClass(/card-focused/);

    // Compute how many columns the grid has by comparing card positions.
    const cols = await page.evaluate(() => {
      const cards = document.querySelectorAll('.item-card');
      if (cards.length < 2) return 1;
      const firstTop = cards[0].getBoundingClientRect().top;
      for (let i = 1; i < cards.length; i++) {
        if (cards[i].getBoundingClientRect().top !== firstTop) return i;
      }
      return cards.length;
    });

    // Press Down arrow — should jump forward by `cols` cards.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.item-card').nth(cols)).toHaveClass(/card-focused/);

    // Press Up arrow — should jump back to the first card.
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.item-card').first()).toHaveClass(/card-focused/);
  });

  test('up/down arrows maintain column across section boundaries in combined view', async ({ page }) => {
    await loadApp(page);
    // Combined view is the default — sections have independent grids.
    // Navigate to the 2nd card in the last row of Mail Back (col 2).
    await page.locator('body').click();

    // Focus the 2nd card (column 2 of first row).
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const startCard = page.locator('.item-card.card-focused');
    await expect(startCard).toBeVisible();

    const startCenterX = await startCard.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });

    // Press ArrowDown repeatedly until we cross the section boundary.
    // Each press should maintain the same horizontal column.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
      const focusedCard = page.locator('.item-card.card-focused');
      const centerX = await focusedCard.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      // Allow small tolerance (5px) for rounding.
      expect(Math.abs(centerX - startCenterX)).toBeLessThan(5);
    }
  });

  test('Enter on a focused card opens the Amazon order page', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.locator('body').click();

    // Focus the first card.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.item-card.card-focused')).toBeVisible();

    // Listen for popup (new tab) on Enter.
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    expect(popup.url()).toContain('amazon.com');
  });

  test('Escape closes the graph modal', async ({ page }) => {
    await loadApp(page);
    // Load all data so graph buttons appear.
    await page.locator('#load-all-link').click();
    await page.waitForFunction(() => !document.getElementById('load-all-link'));

    // Open the years graph modal.
    await page.locator('.graph-btn', { hasText: 'Years' }).click();
    await expect(page.locator('#graph-modal')).toBeVisible();

    // Press Escape to close it.
    await page.keyboard.press('Escape');
    await expect(page.locator('#graph-modal')).not.toBeVisible();
  });

  test('Escape clears the search bar', async ({ page }) => {
    await loadApp(page);
    await clickTab(page, 'all');
    await page.fill('#search-input', 'Pickle');
    expect(await cardCount(page)).toBe(1);

    // Press Escape to clear search.
    await page.keyboard.press('Escape');
    const searchVal = await page.locator('#search-input').inputValue();
    expect(searchVal).toBe('');
    expect(await cardCount(page)).toBe(18);
  });

  test('keyboard shortcuts are suppressed when typing in the search bar', async ({ page }) => {
    await loadApp(page);
    await page.locator('#search-input').focus();
    await page.keyboard.type('jack');

    // The "j" and "k" should have been typed, not intercepted as shortcuts.
    const searchVal = await page.locator('#search-input').inputValue();
    expect(searchVal).toBe('jack');
  });
});

// ===========================================================================
// Quantity view
// ===========================================================================
test.describe('Quantity view', () => {

  async function loadAllAndClickQuantity(page) {
    await loadApp(page);
    // Load all data so cross-year duplicates are available
    await page.locator('#load-all-link').click();
    await page.waitForFunction(() => !document.getElementById('load-all-link'));
    await clickTab(page, 'quantity');
  }

  test('Quantity tab shows correct count of deduplicated items', async ({ page }) => {
    await loadApp(page);
    await page.locator('#load-all-link').click();
    await page.waitForFunction(() => !document.getElementById('load-all-link'));
    // B07NXG4NV9: qty 2 (2024) + qty 1 (2025) = 3 total
    // B00004YMGF: qty 1 (2024) + qty 1 (2025) = 2 total
    // B07JJP4XTL: qty 1 (2024) + qty 2 (2025) = 3 total (Shipped in 2025 still qualifies)
    const count = await tabCount(page, 'quantity');
    expect(count).toBe(3);
  });

  test('Quantity view shows deduplicated item cards sorted by most recent order date', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    const cards = page.locator('.item-card');
    const count = await cards.count();
    expect(count).toBe(3);

    // B07JJP4XTL newest=2025-01-05, B07NXG4NV9 newest=2025-01-03, B00004YMGF newest=2025-01-01
    // First card should be B07JJP4XTL (most recently ordered)
    const firstAsin = await cards.first().getAttribute('data-asin');
    expect(firstAsin).toBe('B07JJP4XTL');
  });

  test('Quantity cards show item count in meta when qty differs from order count', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    // B07NXG4NV9: 2 orders, 3 items => should show "(3 items)"
    // B07JJP4XTL: 2 orders, 3 items => should show "(3 items)"
    // B00004YMGF: 2 orders, 2 items => should NOT show "items"
    const metas = await page.locator('.card-meta').allTextContents();
    const withItemCount = metas.filter(m => m.includes('items'));
    expect(withItemCount.length).toBe(2);
  });

  test('Quantity cards show frequency badge when applicable', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    // B07NXG4NV9: orders on 2024-07-01 (qty 2) and 2025-01-03 (qty 1) = 3 total, 6 mo span
    // frequency = 6 / (3-1) = 3 months
    const freqBadges = page.locator('.badge-frequency');
    const freqCount = await freqBadges.count();
    expect(freqCount).toBeGreaterThan(0);
  });

  test('Quantity cards show S&S icon when most recent order used S&S', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    // B07NXG4NV9 has subscribe_and_save=true on its most recent order (2025-01-03)
    const snsIcons = page.locator('.badge-sns');
    const snsCount = await snsIcons.count();
    expect(snsCount).toBe(1); // Only one item's latest order used S&S
  });

  test('Quantity cards do not show order date, return window, or keep button', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    // Should have no return-badge or keep-btn
    expect(await page.locator('.return-badge-ok, .return-badge-warn, .return-badge-closed').count()).toBe(0);
    expect(await page.locator('.keep-btn').count()).toBe(0);
    // Should not contain "Ordered" date text pattern
    const cardMetas = await page.locator('.card-meta').allTextContents();
    for (const meta of cardMetas) {
      expect(meta).not.toContain('Ordered');
    }
  });

  test('S&S filter checkbox is hidden on Quantity tab', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    const snsLabel = page.locator('#sns-filter-label');
    await expect(snsLabel).toBeHidden();
  });

  test('S&S filter checkbox reappears when switching away from Quantity', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    await clickTab(page, 'all');
    const snsLabel = page.locator('#sns-filter-label');
    await expect(snsLabel).toBeVisible();
  });

  test('search filters Quantity view by title', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    expect(await cardCount(page)).toBe(3);
    await page.fill('#search-input', 'Rechargeable');
    expect(await cardCount(page)).toBe(1);
  });

  test('Quantity cards show order count and date range in meta', async ({ page }) => {
    await loadAllAndClickQuantity(page);
    const metas = await page.locator('.card-meta').allTextContents();
    // All items have 2 orders with date ranges
    for (const meta of metas) {
      expect(meta).toContain('2 orders');
      expect(meta).toContain('–'); // date range separator
    }
  });
});
