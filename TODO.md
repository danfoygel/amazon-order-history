# Todo List

---

## Item 1: Change display order of statuses ✅ (merged PR #9)

Reordered status filter tabs in `index.html` to: All, Ordered, Shipped, Delivered, Replacement Ordered, Return Started, Return in Transit, Return Complete, Cancelled.

---

## Item 2: Fix "replacement ordered" items way past the deadline ✅ (merged PR #10)

Extended `effectiveStatus()` in `app.js` to demote "Replacement Ordered" items that are >30 days past their `return_window_end` to "Delivered", consistent with existing "Return Started" logic.

---

## Item 3: Add a "show graph" button with a stacked bar chart modal ✅ (merged PR #11)

Added a "Show Graph" button that opens a modal with a stacked bar chart (Chart.js via CDN) showing item counts per status per year across all data. Legend, tooltip, and bar stack all ordered Ordered→Cancelled.

--- 

## Item 4: Enable fast load ✅ (merged PR #16)

On first load, only the year files covering the last 3 months are fetched dynamically (at most 2 files). The header shows "X of Y items (load all)" where Y comes from a new `ORDER_DATA_YEAR_COUNTS` map written into the manifest by `fetch_orders.py`. Clicking "(load all)" fetches remaining years and switches the header to "Y items · Show Graph". The "Show Graph" button is hidden until all data is loaded.

---

## Item 5: Subscribe and Save ✅ (merged PR #17)

Added a `subscribe_and_save` boolean to each item record in `fetch_orders.py` (detected via `order.subscription_discount is not None`). Shows a ↻ badge on S&S item cards, and added a "↻ S&S only" checkbox filter to the right of the status tabs. The checkbox label shows a live count of S&S items in the currently active tab.

---

## Item 6: Return Policy ✅ (merged PR #15)

Added green circular-arrow icon for free-returns items and red circle-slash icon for non-returnable items on each card. `fetch_orders.py` fetches each item's product page (`amazon.com/dp/{ASIN}`) to get the authoritative return policy and caches results in `data/asin_cache.json` (generic ASIN cache, extensible for future per-product data). Order-page return-window dates are kept for the return-window badge; `return_window_end` is cleared to `null` for non-returnable items. Frontend renders inline SVGs in `.card-badges` via `returnPolicyIcon()` in `app.js`.

---

## Item 7: Monthly Graph ✅ (merged PR #18)

Replaced the "Show Graph" button with two icon buttons — `▐▐▐ Years` and `▐▐▐ Months` — each opening the same modal with a different aggregation. The Years chart is the existing annual stacked bar chart; Months shows a trailing-12-month stacked bar chart (current month included). Both buttons are hidden until all data is loaded (consistent with Item 4 fast-load behavior).

---

## Item 8: Automated Tests ✅ (merged PR #36)

Added three layers of automated testing (297 tests total). Extracted ~400 lines of pure logic from `app.js` into a new `order_logic.js` module (conditional CommonJS exports for browser/Node dual compatibility). Python unit tests (105 via pytest) cover `fetch_orders.py` logic with mocked Amazon APIs. JavaScript unit tests (150 via vitest) cover `order_logic.js` functions. Playwright E2E tests (42) load the full app with realistic fixture data (real ASINs/product names) via route interception and verify tabs, cards, search, filters, and badges. Test instructions added to README.md.

---

## Item 9: Add data to Git

I want to also store my data files in git - but obviously in a private repo that's separate from the main public repo.  I think the right approach is to make it a submodule - can you set that up?

---

## Item 10: Diagnose "Return in Transit"

There are 73 items in "return in transit" status, most quite old.  This doesn't make sense - there should be essentially zero.  Are these items that I forgot to ship back?  Or did they get lost by the shipping company and never arrived at Amazon?  Or did Amazon receive them but didn't credit me for the return, for some reason?  Investigate this issue - look at some example items in that status from various years, use Chrome to find the tracking number and then access the tracking history, and write an analysis of what you've found.

---

## Item 11: Quantity Insights

Add a new special view, with a button to the right of "Decide", that is "Quantity".  When that's the one selected, show items that I've ordered multiple times.  Think of this as a s&s optimizer.

- Should only apply to items that were delivered and not returned, figure out which subset of statuses that shoud include - put that in the plan and I'll confirm.
- Show the total quantity that I've ever ordered on the item card, and sort the view by quantity desc.
- Make sure you consider the item quantity in the order.
- Deduplicate orders - if I've ordered the same item in multiple orders at different times, show that as a single item card with a combined quantity.  
- In this view, only show items where the combined quantity is >= 2.
- Remove all of the date information - ordered, delivered, return by, etc. - since it may not be applicable when there are multiple orders.
- Remove the s&s indication (and checkbox) and the return status indication, since those again might be order-specific.
- Calculate the average frequency that I'm ordering these items - for instance, if I order it on Jan 1, Jun 1, and Sep 1, that would be "every 4 months".  Determine the right formula for this - put that in the plan and I'll confirm.
- If the frequency is <= 12 months, show that on the item card.
- For each item, see if you're able to determine whether it's s&s eligible - let me know in the plan whether that's possible.  If yes, show the s&s icon on those items - this will mean something different than the other views, here's it showing that s&s is possible rather than that s&s was used.

---

## Item 12: Plug in stores

---

## Item 13: Refetch based on emails

---

## Item 14: Cloud hosted

---

## Item 15: Enhance return information ✅ (merged PR #25)

Added an amber corner-return arrow icon for items with `return_policy = "return_only"`, with mouseover text "Returns allowed". Styled via new `.return-only-icon` CSS class (`#d97706` amber-600).

--- 

## Item 16: Harmonize Icons ✅ (merged PR #26)

Replaced the four disparate item card indicators with a unified pill-badge style. All use inline SVG icons in colored pills: S&S = blue clock, free returns = green circular arrow, returns allowed = yellow corner arrow, non-returnable = red circle-slash. Also updated the S&S filter label icon to match.

---

## Item 17: Mail back dates ✅ (merged PR #30)

When an item transitions to "Return Started", Amazon stops showing the return eligibility date, so incremental re-fetches overwrote previously-captured `return_window_end` values with `null`. Fixed by adding `_preserve_return_window()` in `fetch_orders.py` — during merge (incremental and `--year` modes), any item whose freshly-fetched `return_window_end` is null gets its date restored from the on-disk record. In `app.js`, null-date Mail Back items now show a `⚠ Mail back — deadline unknown` amber badge instead of nothing. Previously-broken items were backfilled manually by inspecting the Amazon returns page.

---

## Item 18: Fix Ordered/Shipped misclassification ✅ (merged PR #29)

Amazon shows `"Arriving [date]"` for both pre-ship estimated delivery dates and in-transit packages, so the `"arriving" → Shipped` rule in `STATUS_RULES` was incorrectly classifying unshipped orders as Shipped. Fixed by adding a `hasShipmentId()` helper in `app.js` that checks for the `shipmentId` parameter in the tracking URL — Amazon only adds this once a package has been assigned to a carrier — and using it as a tiebreaker in `deriveStatus()`: `"arriving"` without a `shipmentId` maps to Ordered, with one maps to Shipped. No re-fetch needed.

---

## Item 19: Ordered Section ✅ (merged PR #32)

Added "Ordered" as a dedicated section in the combined view, placed after "Shipped" and before the month-based sections, sorted by expected delivery date. Ordered items are excluded from the monthly groupings.

---

## Item 20: Date Formatting ✅ (merged PR #32)

Nearby dates (arrives, return by, mail back by) now omit the year and use "yesterday", "today", or "tomorrow" when applicable (e.g., "Arrives today", "Return by tomorrow"). The redundant "(Xd left)" suffix is suppressed for today/tomorrow/yesterday. The "Ordered" date on cards continues to show the full year.

---

## Item 21: Collapse ✅ (merged PR #32)

All sections in the combined view are now collapsible via a chevron toggle (▾/▸) on the section heading. Sections are expanded by default on page load.

---

## Item 22: Shorten "Replacement Ordered" to "Replacement" ✅

Shortened the display label from "Replacement Ordered" to "Replacement" across the status badge, filter tab, and chart legends to reduce card overflow at narrower viewports. Internal status logic unchanged.

---

## Item 23: Spending summary

*Automatically suggested by Claude Code on 2026-02-25.*

The data already has `unit_price`, `quantity`, and `order_date` for most items. Add a spending overview — either as a new tab or as a panel in the graph modal — showing:

- Total spend per month and per year (stacked bar or line chart, reusing Chart.js)
- Average order value and average item price
- Top N most expensive items (sortable table or card list)
- Spend broken down by status (useful to see total $ in returns vs delivered)

This is a read-only view of data we already collect; no backend changes needed.

---

## Item 24: Dark mode

*Automatically suggested by Claude Code on 2026-02-25.*

Add a dark theme toggle. The CSS already uses design tokens (`:root` custom properties for all colors), so the implementation is straightforward:

- Add a `:root.dark` (or `[data-theme="dark"]`) block overriding the color tokens
- Add a toggle button in the header (sun/moon icon)
- Persist the preference in localStorage
- Respect `prefers-color-scheme: dark` as the initial default

Badge colors, graph colors, and the modal backdrop all need dark variants.

---

## Item 25: Keyboard navigation

*Automatically suggested by Claude Code on 2026-02-25.*

Add keyboard shortcuts for power users:

- `/` or `Ctrl+K` to focus the search bar
- `1`–`9` (or `Ctrl+1`–`Ctrl+9`) to switch tabs
- `j`/`k` to move between item cards (highlight with a focus ring)
- `Enter` on a focused card to open the Amazon order page
- `Escape` to clear search / close the graph modal (graph modal already handles backdrop click but not Escape)

Lightweight — just a single `keydown` listener on `document`.

---

## Item 26: Export to CSV

*Automatically suggested by Claude Code on 2026-02-25.*

Add an "Export" button (visible when data is loaded) that generates a CSV of the currently visible items. Fields: order date, title, ASIN, status, unit price, quantity, total price, carrier, return policy, return window end. Uses the Blob API + `URL.createObjectURL` for a pure client-side download — no backend needed.

---

## Item 27: Per-item notes

*Automatically suggested by Claude Code on 2026-02-25.*

Allow the user to attach a short text note to any item (e.g., "gift for Mom", "defective, returning"). Store in localStorage keyed by `item_id` (similar to the existing kept-items implementation). Show as a small muted line below the card's meta row, with an edit icon to add/change.

---

## Item 28: Stale data warning

*Automatically suggested by Claude Code on 2026-02-25.*

When the page loads, compare `generated_at` from the most recent year file against the current date. If the data is more than 7 days old, show a subtle banner below the header: "Data last updated 12 days ago — run `python fetch_orders.py` to refresh." Dismissible, with the dismissal stored in sessionStorage so it doesn't nag on every page load within a single session.

---

## Item 29: Virtual scrolling for large datasets

*Automatically suggested by Claude Code on 2026-02-25.*

With several years of history loaded, the DOM can have thousands of item cards. Currently `renderList` / `renderCombined` create all cards upfront. For users with 5,000+ items, this causes noticeable jank on tab switches.

Implement a lightweight virtual scroller (either a small custom one or a lib like `virtual-scroller`) so only the ~30 visible cards are in the DOM at once. The combined view's collapsible sections make this trickier — probably easiest to virtualize only the flat list views first (single-status tabs, All tab) and leave Combined as-is.

---

## Item 30: Notification of expiring return windows

*Automatically suggested by Claude Code on 2026-02-25.*

Add an optional browser notification (via the Notifications API) that fires when the page loads if any Decide-eligible items have a return window closing within the next 3 days. The user would need to grant notification permission once. This turns the tool from "open it when you remember" into something that actively reminds you.

---

## Item 31: Price tracking / price history

*Automatically suggested by Claude Code on 2026-02-25.*

During the ASIN product-page fetch (which already happens for return-policy detection), also scrape the current price and store it in `asin_cache.json` alongside `return_policy`. Over time, with repeated fetches, this builds a rudimentary price history per ASIN. The frontend could show a small sparkline on each card showing how the price has changed since purchase. Requires a backend change to `fetch_product_page_info` (add a `current_price` field) and a cache schema migration (add a `price_history` array of `{date, price}` entries).

---

## Item 32: Pixel Level Automated Tests

Let's add visual regression testing - evaluate using Percy or BackstopJS or another suitable library.

### Library evaluation

| | Playwright `toHaveScreenshot()` | BackstopJS | Percy |
|---|---|---|---|
| **Fits existing stack** | Already installed; same test runner, same fixture data, same route interception | Separate tool with its own config, scenarios, and CLI | SaaS; requires account, API key, CI integration |
| **Maintenance** | Baselines are local PNG files checked into git; update with `--update-snapshots` | Local reference images + backstop config JSON | Cloud-hosted baselines; tied to a paid service |
| **Cost** | Free | Free | Free tier limited; paid for serious use |
| **Pixel diff** | Built-in comparator with configurable `maxDiffPixelRatio` / `maxDiffPixels` / `threshold` | Built-in pixel diff via Resemble.js | Cloud-based diffing with approval UI |
| **Responsive** | Trivial — just set `page.setViewportSize()` per test | Define separate scenarios per viewport | Define widths in config |
| **CI friendliness** | Native — `npx playwright test` just works | Needs Docker for consistent rendering | Needs API key in CI env |

**Recommendation: Playwright `toHaveScreenshot()`** — it's already installed, uses the same fixtures and route interception, produces deterministic local baselines, and adds zero new dependencies. BackstopJS would duplicate the server/fixture setup we already have. Percy is overkill for a personal project with no team review workflow.

**Question: Does this choice sound right, or would you prefer one of the others?**

Answer: Yes.

### Handling dynamic / flaky content

1. **Relative dates** ("Arrives today", "3d left") — mock `Date.now()` via `page.addInitScript()` to freeze time to a fixed date (e.g., `2025-06-15`). The fixture data's return windows are already set to far-future (`2099-12-31`) or far-past (`2020-01-01`), so the rendered text will be stable.

2. **Amazon product images** — the existing E2E tests don't intercept image requests, so thumbnails load from `m.media-amazon.com`. For visual baselines these would be flaky (CDN changes, network failures). Plan: intercept `**/images/**` requests and serve a local placeholder PNG from the fixtures directory, so every card shows the same image. Alternatively, use Playwright's `mask` option to exclude image areas from the diff.

3. **Chart.js canvases** — canvas rendering can vary slightly across environments. Plan: mask the `<canvas>` element in graph-modal screenshots, or skip graph screenshots entirely and rely on the existing functional E2E tests for graph behavior.

**Question: For images, do you prefer (a) intercepting and replacing with a placeholder, or (b) masking the image area in screenshots? Option (a) gives a more realistic-looking baseline; option (b) is simpler.**

Answer: Mask.

### What to capture (test scenarios)

Each scenario = one `toHaveScreenshot()` call with a named baseline file.

**Full-page views (desktop 1280×800):**
1. Combined view (default on load, with "load all" link visible)
2. Combined view after "load all" (all sections expanded)
3. Combined view with a section collapsed
4. All tab
5. Delivered tab (most items)
6. Return Started tab
7. Cancelled tab (or another low-count tab)
8. Search active with results
9. Search active with no results
10. S&S filter active
11. Graph modal — Years chart
12. Graph modal — Months chart

**Individual card detail (element screenshot):**
13. A delivered card with return-policy badge and "Return by" date
14. A shipped card with tracking info
15. An S&S card with the blue pill badge
16. A non-returnable card with red badge

**Responsive (mobile 375×812):**
17. Combined view — verifies single-column layout
18. Filter nav — verifies tab wrapping

That's ~18 screenshots. Each one is a separate test case in a new `tests/e2e/test_visual.spec.js` file.

### Implementation plan

1. **Create `tests/e2e/fixtures/placeholder.png`** — a small neutral placeholder image for product thumbnails.

2. **Create `tests/e2e/test_visual.spec.js`** with:
   - A shared `beforeEach` that: loads the app via the existing `loadApp` pattern, mocks `Date.now()` to a fixed timestamp, intercepts image requests to serve the placeholder.
   - ~18 test cases as listed above, each calling `await expect(page).toHaveScreenshot('name.png')` or `await expect(locator).toHaveScreenshot('name.png')`.
   - Configurable `maxDiffPixelRatio: 0.01` (1% tolerance) to absorb sub-pixel anti-aliasing differences across environments.

3. **Generate initial baselines** by running `npx playwright test tests/e2e/test_visual.spec.js --update-snapshots`.

4. **Add npm script** — `"test:visual": "npx playwright test tests/e2e/test_visual.spec.js"` in `package.json`.

5. **Check baseline PNGs into git** in `tests/e2e/test_visual.spec.js-snapshots/` (Playwright's default location).

6. **Update `tests/run_tests.sh`** to include the visual tests (or keep them separate since they're slower).

**Question: Should visual tests run as part of the main `npm run test:e2e` suite, or as a separate `npm run test:visual` command? Separate is nice because visual tests are slower and baselines need explicit updating when the UI intentionally changes.**

Answer: separate.

---

## Item 33: Improve project docs ✅ (merged PR #40)

Moved recurring workflow instructions (worktree data symlink, TODO-driven planning vs implementation, dev server URL sharing) from NOTES.md prompt templates into CLAUDE.md as persistent project instructions. Simplified NOTES.md to short prompt starters with original text preserved in a "Raw Prompts" section.

---

## Item 35: Convert status_rules.json to .js for file:/// compatibility ✅ (merged PR #42)

Converted `status_rules.json` to `status_rules.js` — an inline JS variable loaded via `<script>` tag, eliminating the XHR fetch that CORS blocked under `file:///`. Python extracts the JSON from marker comments in the JS file.

---

## Item 34: Identify and display digital orders

Digital downloads (e.g. software, Kindle books) have empty `delivery_status` because there's no physical shipment. Currently these are indistinguishable from physical orders where Amazon simply dropped the tracking data. Investigate how to reliably detect digital orders (product category, ASIN patterns, order metadata) and give them a distinct status or visual indicator instead of lumping them in with empty-status physical orders. Example: order 114-2932976-0773838 (TurboTax Premier Desktop Edition 2025, PC/Mac Download).

---