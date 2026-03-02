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

## Item 11: Quantity Insights ✅ (merged PR #60)

Added a "Quantity" tab showing items ordered on multiple dates, acting as an S&S optimizer. Groups items by ASIN across all years, shows consumption-rate frequency ("Every X mo" or "Every X yr" for >18 mo), S&S icon from latest order, order count with date range, and most recent price. Pure logic in `groupItemsByAsin()` and `formatFrequency()` in `order_logic.js`. 24 unit tests, 11 E2E tests.

---

## Item 11b: S&S eligibility enrichment

Detect S&S eligibility for items in the Quantity view. Currently only items previously ordered via S&S show the icon. Needs a way to determine if a product offers Subscribe & Save (e.g. scraping the product page). The Quantity view could then show the S&S icon for truly eligible items.

---

## Item 12: Plug in stores ✅ (merged PR #39)

Added `STORES.md` with detailed research on programmatic order-history retrieval for 9 stores: Amazon (current approach), Walmart, Target, Costco, Home Depot, Lowe's, Ace Hardware, REI, and Backcountry. No store offers a public consumer order-history API. Key findings: Costco has a known GraphQL endpoint with multiple open-source tools; Home Depot/Lowe's have Pro account CSV exports; Walmart has an open-source invoice exporter extension; the rest require Playwright browser automation. Research only — no implementation yet.

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

## Item 17: Mail back dates ✅ (merged PR #30, updated PR #54)

When an item transitions to "Return Started", Amazon stops showing the return eligibility date. Originally fixed with `_preserve_return_window()` to restore dates from prior fetches, but that never actually helped actionable items. Replaced with frontend estimation: `order_date + 33 days` (median offset from observed data). Estimated dates show a `~` prefix. Sorting uses estimated dates so mail-back items are ordered by urgency. Removed `_preserve_return_window` as dead code.

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

## Item 25: Keyboard navigation ✅ (merged PR #50)

Added keyboard shortcuts via a single `keydown` listener: `/` or `Ctrl+K` to focus search, `1`–`9` to switch tabs, arrow keys to navigate cards (with orange focus ring, maintaining column across section boundaries), `Enter` to open the focused card's Amazon page, `Escape` to close modal/clear search/unfocus. 10 new E2E tests.

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

## Item 32: Pixel Level Automated Tests ✅ (merged PR #43)

Added 18 visual regression tests using Playwright's built-in `toHaveScreenshot()`. Covers full-page views (combined, tabs, search, S&S filter, graph modals), individual card types (delivered, shipped, S&S, non-returnable), and responsive mobile layouts. Uses `Date.now()` freezing for stable date badges, image masking for external thumbnails, and canvas masking for Chart.js graphs. Runs via separate `npm run test:visual` command; baselines updated with `--update-snapshots`.

---

## Item 33: Improve project docs ✅ (merged PR #40)

Moved recurring workflow instructions (worktree data symlink, TODO-driven planning vs implementation, dev server URL sharing) from NOTES.md prompt templates into CLAUDE.md as persistent project instructions. Simplified NOTES.md to short prompt starters with original text preserved in a "Raw Prompts" section.

---

## Item 34: Identify and display digital orders

Digital downloads (e.g. software, Kindle books) have empty `delivery_status` because there's no physical shipment. Currently these are indistinguishable from physical orders where Amazon simply dropped the tracking data. Investigate how to reliably detect digital orders (product category, ASIN patterns, order metadata) and give them a distinct status or visual indicator instead of lumping them in with empty-status physical orders. Example: order 114-2932976-0773838 (TurboTax Premier Desktop Edition 2025, PC/Mac Download).

--- 

## Item 35: Convert status_rules.json to .js for file:/// compatibility ✅ (merged PR #42)

Converted `status_rules.json` to `status_rules.js` — an inline JS variable loaded via `<script>` tag, eliminating the XHR fetch that CORS blocked under `file:///`. Python extracts the JSON from marker comments in the JS file.

---

## Item 36: CI ✅ (merged PR #51)

Added GitHub Actions CI workflow (`.github/workflows/test.yml`) that runs JS unit tests (vitest), Python unit tests (pytest), and functional E2E tests (Playwright) on every push to main and on all PRs. Visual snapshot tests remain local-only (darwin snapshots).

---

## Item 37: Fix "Updated" timestamp ✅ (merged PR #53)

Changed the "Updated" header to use only the current calendar year's `generated_at` timestamp (not the newest across all data files), so historical backfills don't affect the displayed time. Also switched `fetch_orders.py` from UTC to local time so the timestamp matches the user's wall clock without timezone conversion artifacts.

---

## Item 38: Remove file:/// Support ✅ (merged PR #57)

Removed the dual `file:///`/`http://` access pattern. Converted all data files to pure JSON (`status_rules.json`, `app_data_YYYY.json`, `app_data_manifest.json`). `app.js` now uses `fetch()` instead of dynamic `<script>` injection. Removed synchronous XHR fallback in `order_logic.js`. Updated `fetch_orders.py`, `validate_data.js`, all tests, and docs. Converted 26 on-disk data files.

---