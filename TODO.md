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

## Item 8: Automated Tests

It's time to add some automated tests to this project.  This is a bit tricky, since the data is my personal order history - which shouldn't be part of the tests.  So I think the right approach is to mock the Amazon APIs, have those return some synthetic orders, and then verify that everything works in a deterministic and correct way for those orders.  I want to verify both the fetching process and the web view.

### Implementation Plan

#### Overview

Three layers of testing, corresponding to the three parts of the system:
1. **Python unit tests** — test `fetch_orders.py` logic with mocked Amazon APIs
2. **JavaScript unit tests** — test `app.js` pure logic (status derivation, filtering, sorting, date parsing)
3. **End-to-end web view tests** — load synthetic data in a real browser and verify rendering

#### Directory Structure

```
tests/
├── python/
│   ├── conftest.py                  # Shared fixtures: mock Order/Shipment/Item factories, tmp data dir
│   ├── test_carrier.py              # detect_carrier()
│   ├── test_dates.py                # date_to_iso(), add_days()
│   ├── test_asin.py                 # extract_asin(), slugify()
│   ├── test_return_info.py          # extract_return_info(), _parse_return_date()
│   ├── test_build_items.py          # build_item_record(), build_items_from_orders()
│   ├── test_file_io.py              # load_existing_items(), write_output(), write_manifest()
│   ├── test_preserve_return_window.py
│   ├── test_enrich_asin_cache.py    # enrich_items_with_asin_cache(), fetch_product_page_info()
│   └── test_pipeline.py             # Full pipeline: mock Amazon → verify output files
├── js/
│   ├── test_status.mjs              # deriveStatus(), hasShipmentId(), effectiveStatus()
│   ├── test_dates.mjs               # parseExpectedDelivery(), formatDate(), formatDateNearby(), daysSince()
│   ├── test_filter_sort.mjs         # filterItems(), sortItems(), computeTabCounts()
│   └── test_helpers.mjs             # formatPrice(), escHtml(), statusBadgeHtml(), returnPolicyIcon(), etc.
├── e2e/
│   ├── test_web_view.py             # Playwright: load page with synthetic data, verify rendering
│   └── fixtures/
│       ├── app_data_manifest.js     # Synthetic manifest (years: [2025, 2024])
│       └── app_data_2025.js         # Synthetic year file with ~20 items covering all statuses
└── run_tests.sh                     # Single entry point: runs all three layers
```

#### Layer 1: Python Unit Tests (pytest)

**Setup:**
- Install `pytest` into the venv (`pip install pytest`)
- Add `pytest.ini` or `pyproject.toml` section with `testpaths = ["tests/python"]`

**Mock strategy for Amazon API objects:**
- Create factory functions in `conftest.py` that build mock `Order`, `Shipment`, and `Item` objects
- These use `unittest.mock.Mock` or simple dataclasses with the attributes that `build_item_record()` accesses: `order_number`, `order_placed_date`, `grand_total`, `subscription_discount`, `shipments`, `delivery_status`, `tracking_link`, `title`, `price`, `quantity`, `link`, `image_link`, `parsed` (BeautifulSoup object from HTML snippet)
- For `extract_return_info()` tests: create real BeautifulSoup objects from small HTML snippets representing Amazon's return eligibility markup patterns

**Test files:**

1. **test_carrier.py** — `detect_carrier(tracking_url)`
   - UPS, USPS, FedEx, DHL, Amazon, OnTrac, LSO URLs → correct carrier name
   - Unknown domains → "Other"
   - None/empty → ""
   - Malformed URLs → "Other"

2. **test_dates.py** — `date_to_iso()`, `add_days()`
   - datetime.date, datetime.datetime, ISO string, empty string, None inputs
   - add_days with positive/negative/zero offsets, None input, invalid date

3. **test_asin.py** — `extract_asin()`, `slugify()`
   - Standard `/dp/B0123456789` links
   - `/gp/product/B0123456789` variant
   - ISBN-style links (digits only)
   - No ASIN in URL, None/empty input
   - slugify: special characters, spaces, truncation at 40 chars

4. **test_return_info.py** — `extract_return_info()`
   - HTML with "Return or replace items: Eligible through March 22, 2026" → `("2026-03-22", "free_or_replace")`
   - HTML with "Return items: Eligible through ..." → `(date, "return_only")`
   - HTML with empty `.yohtmlc-item-level-connections` div → `(None, "non_returnable")`
   - HTML with no return span but non-empty connections → `(None, None)`
   - Item with no `parsed` attribute → `(None, None)`

5. **test_build_items.py** — `build_item_record()`, `build_items_from_orders()`
   - Verify all 18 fields of the item record dict are populated correctly
   - Multiple items per shipment, multiple shipments per order
   - Duplicate ASIN handling (same ASIN in same order gets `__1`, `__2` suffixes)
   - Items without ASIN (uses slugified title as key)
   - S&S detection: `subscription_discount` present vs absent

6. **test_file_io.py** — `load_existing_items()`, `write_output()`, `write_manifest()`
   - Uses pytest `tmp_path` fixture; `monkeypatch.chdir(tmp_path)` so `data/` is written inside temp dir
   - Round-trip: write items → load items → verify equality
   - Write manifest → verify correct years list and counts
   - Load from nonexistent file → empty list
   - Load from corrupt file → empty list with warning

7. **test_preserve_return_window.py**
   - Fresh item has `return_window_end: null`, existing has a date → date is restored
   - Fresh item already has a date → kept as-is
   - No matching existing item → stays null

8. **test_enrich_asin_cache.py** — `enrich_items_with_asin_cache()`, `fetch_product_page_info()`
   - Mock `session.session.get()` to return synthetic product page HTML
   - Product page with "free returns" text → `return_policy = "free_or_replace"`
   - Product page with "non-returnable" text → `return_policy = "non_returnable"`, `return_window_end` cleared to null
   - Product page with neither → `return_policy = None` (cache stores None, order-page value kept)
   - HTTP 404 → not cached, original item values preserved
   - HTTP 503 → retried, then failure if persistent
   - ISBN-style ASINs (digit-only) are skipped entirely
   - Already-cached ASINs are not re-fetched

9. **test_pipeline.py** — End-to-end integration
   - Create mock Order objects representing ~10 synthetic orders with various statuses
   - Mock `AmazonSession`, `AmazonOrders.get_order_history()` to return them
   - Mock `session.session.get()` for product page fetches
   - Run the `main()` function in `--year` mode and incremental mode
   - Verify output data files have correct structure, item counts, field values
   - Verify manifest is correct
   - Verify incremental merge: old items preserved before cutoff, fresh items replace after

#### Layer 2: JavaScript Unit Tests (Node.js built-in test runner)

**Setup:**
- No extra dependencies — use Node.js built-in `node:test` and `node:assert` (Node v24 is available)
- Run with: `node --test tests/js/`

**Key decision: making app.js functions testable**

app.js is a browser script with DOM side effects (event listeners, `init()` call at the bottom). Pure logic functions need to be extracted into a testable module. **Plan:**

- Create a new file `order_logic.js` containing all pure (non-DOM) functions:
  `deriveStatus`, `hasShipmentId`, `daysSince`, `parseExpectedDelivery`, `toIso`,
  `filterItems`, `sortItems`, `computeTabCounts`, `effectiveStatus`,
  `formatDate`, `formatDateNearby`, `formatPrice`, `escHtml`,
  `statusBadgeHtml`, `returnPolicyIcon`, `returnWindowHtml`,
  `buildGraphData`, `buildMonthlyGraphData`, `initialYears`,
  `isDecideEligible`, `isMailBackEligible`
- Also move the constants: `STATUS_RULES`, `ASSUME_DELIVERED_AFTER_DAYS`, `WEEKDAY_NAMES`, `MONTH_NAMES`, `GRAPH_STATUSES`, `GRAPH_STATUS_COLORS`, `GRAPH_STATUS_LABELS`
- `order_logic.js` uses conditional `export` at the bottom:
  ```js
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { deriveStatus, filterItems, sortItems, ... };
  }
  ```
- `app.js` loads `order_logic.js` via a `<script>` tag before itself (functions remain global in browser context) and `index.html` gets a new `<script src="order_logic.js"></script>` line
- Tests import via `require()` or dynamic `import()`

This keeps the browser experience unchanged (functions are still global) while enabling Node.js testing.

**Decision note:** This is a small refactor that splits ~400 lines of pure logic out of the ~1093-line app.js. It makes the code more modular without changing any behavior. The alternative would be to load app.js inside jsdom for tests, but that's fragile (needs a fake HTML document matching index.html, Chart.js mock, etc.).

**Test files:**

1. **test_status.mjs** — Status derivation
   - `hasShipmentId()`: URL with/without `shipmentId` param, null/invalid URLs
   - `deriveStatus()`: every STATUS_RULES pattern, including:
     - "arriving" with shipmentId → Shipped; without → Ordered
     - "not yet shipped" before "shipped" (rule ordering)
     - Empty delivery_status: old order (>14d) → Delivered; recent → Ordered
     - Unrecognized text: old → Delivered; recent → Ordered
   - `effectiveStatus()`: "Return Started" items >30 days overdue → demoted to Delivered; ≤30 days → unchanged; "Replacement Ordered" same logic

2. **test_dates.mjs** — Date parsing & formatting
   - `parseExpectedDelivery()`: "Arriving today", "Arriving tomorrow", "Arriving Saturday", "Now arriving February 28", "Arriving Feb 22", null/empty, unrecognized text
   - `daysSince()`: various ISO dates
   - `formatDate()`: standard dates, null
   - `formatDateNearby()`: yesterday/today/tomorrow detection, other dates (omit year)
   - `formatPrice()`: numbers, null/undefined

   **Decision note:** Date-dependent tests need deterministic "today" values. Tests will mock `Date` or use known fixed dates and verify relative behavior. (E.g., freeze "today" to 2025-06-15 and test that "Arriving Saturday" maps to 2025-06-21.)

3. **test_filter_sort.mjs** — Filtering & sorting
   - `filterItems()`: tab=all, tab=mail_back, tab=decide, tab=specific status, search query, S&S filter
   - `sortItems()`: order_date_asc/desc, price_asc/desc, return_window_asc, expected_delivery_asc
   - `computeTabCounts()`: verify counts match expected values for a synthetic item set
   - Edge cases: items with null dates, null prices

4. **test_helpers.mjs** — Rendering helpers
   - `escHtml()`: special characters, null/undefined
   - `statusBadgeHtml()`: all 8 statuses, unknown status
   - `returnPolicyIcon()`: all 3 policies + null
   - `initialYears()`: manifest with various years, verify correct subset returned based on "today"
   - `isDecideEligible()`, `isMailBackEligible()`: various item configurations

#### Layer 3: End-to-End Web View Tests (Playwright)

**Setup:**
- Install Playwright: `npm init -y && npm install -D @playwright/test && npx playwright install chromium`
- Add `playwright.config.js` with a local web server config
- `package.json` scripts: `"test:e2e": "npx playwright test"`

**Synthetic test data** (`tests/e2e/fixtures/`):

Create ~20 synthetic items across 2 years covering:
- All 8 statuses (Ordered, Shipped, Delivered, Replacement Ordered, Return Started, Return in Transit, Return Complete, Cancelled)
- Various return policies (free_or_replace, return_only, non_returnable, null)
- S&S and non-S&S items
- Items with open return windows (within Decide view)
- Items in Return Started with/without return_window_end (mail back scenarios)
- Items >30 days past return_window_end (should be demoted to Delivered)
- Items with "arriving" status with and without shipmentId
- Varying prices, quantities, carriers

**Test file: test_web_view.py**

Uses Playwright to:
1. Serve the app from the project root but with `tests/e2e/fixtures/` as the `data/` directory (via symlink or Playwright's route interception to rewrite `/data/` requests to `tests/e2e/fixtures/`)
2. Navigate to the page
3. Verify:
   - Correct total item count in meta-bar
   - Tab counts match expected per-status counts
   - Combined view sections: Mail Back, Decide, Shipped, Ordered, monthly groups all present with correct counts
   - Click each status tab → correct items shown
   - Search filtering works (search by title, ASIN, order ID)
   - S&S checkbox filters correctly
   - Status badges show correct text and exist on cards
   - Return window badges (ok/warn/closed/overdue) render correctly
   - Return policy icons (green/red/amber) render on correct items
   - Keep button works (click Keep → item removed from Decide, persists on reload)
   - "Load all" link appears when only partial data is loaded, clicking it loads remaining years
   - Graph modal opens and contains a canvas (Chart.js rendering)
   - Section collapse/expand toggle works

**Decision note:** Playwright was chosen over lighter alternatives (jsdom, happy-dom) because the web view tests need to verify real DOM behavior — event listeners, `<dialog>` elements, Chart.js rendering, localStorage persistence across page reloads, and CSS-dependent badge visibility. jsdom doesn't support `<dialog>` or `<canvas>` well.

#### Synthetic Test Data Design

The synthetic data set needs to be carefully designed so every test has deterministic expected values. Key properties:

| # | Title | Status | Return Policy | S&S | Return Window | Notes |
|---|-------|--------|--------------|-----|--------------|-------|
| 1 | "Wireless Mouse" | Delivered | free_or_replace | no | future (in Decide) | |
| 2 | "USB Cable" | Delivered | non_returnable | no | null | |
| 3 | "Coffee Beans" | Delivered | free_or_replace | yes | future (in Decide) | S&S item |
| 4 | "Phone Case" | Delivered | return_only | no | past (closed) | |
| 5 | "Laptop Stand" | Shipped | null | no | null | Has shipmentId in tracking URL |
| 6 | "Notebook Set" | Ordered | null | no | null | "Arriving Feb 28" without shipmentId |
| 7 | "Headphones" | Return Started | free_or_replace | no | future | In Mail Back |
| 8 | "Keyboard" | Return Started | free_or_replace | no | null | Mail back — deadline unknown |
| 9 | "Monitor Arm" | Return Started | free_or_replace | no | >30d past | Demoted to Delivered |
| 10 | "Replacement Battery" | Replacement Ordered | null | no | future | In Mail Back |
| 11 | "HDMI Cable" | Return in Transit | null | no | null | |
| 12 | "Book" | Return Complete | null | no | null | |
| 13 | "Old Charger" | Cancelled | null | no | null | |
| 14 | "Protein Powder" | Delivered | free_or_replace | yes | future | S&S item in Decide |
| 15 | "Screen Protector" | Shipped | null | no | null | "Out for delivery" |
| 16 | "Water Bottle" | Ordered | null | no | null | "Not yet shipped" |
| 17 | "Desk Lamp" | Delivered | free_or_replace | no | past (7d ago) | Window recently closed |
| 18 | "Replacement Headphones" | Replacement Ordered | null | no | >30d past | Demoted to Delivered |
| 19 | "Paper Towels" | Delivered | non_returnable | yes | null | S&S, non-returnable |
| 20 | "Webcam" | Delivered | return_only | no | future (3d left) | Warn badge |

This data set will produce deterministic expected counts for every tab and filter combination.

#### Test Runner Script (`tests/run_tests.sh`)

```bash
#!/bin/bash
set -e
echo "=== Python tests ==="
.venv/bin/python -m pytest tests/python/ -v

echo "=== JavaScript tests ==="
node --test tests/js/

echo "=== E2E tests ==="
npx playwright test
```

#### Dependencies to Install

**Python:** `pip install pytest` (into existing .venv)
**Node.js:** `npm init -y && npm install -D @playwright/test` (creates package.json)
**Playwright browsers:** `npx playwright install chromium`

#### Questions / Decisions for Review

1. **JS module extraction**: The plan calls for extracting ~400 lines of pure logic from `app.js` into `order_logic.js`. This is a small refactor (no behavior change) that makes the code more modular and testable. The alternative is loading app.js inside jsdom with a fake HTML document, which is fragile. **Is this refactor acceptable?**

Yes

2. **Playwright for E2E**: Playwright is a substantial dependency (~130 MB for Chromium). The alternative is to skip browser-based E2E tests and rely on the JS unit tests plus manual verification. **Are you OK with adding Playwright, or would you prefer a lighter approach?**

OK

3. **Node.js built-in test runner vs vitest/jest**: The plan uses `node:test` (zero dependencies) for JS unit tests. vitest would provide nicer output, watch mode, and better mocking utilities, but adds a dependency. **Preference?**

Let's use vitest

4. **Test data in the repo**: The synthetic test fixtures (`tests/e2e/fixtures/`) will be committed to the public repo. They contain only fake data (no real order history). **Confirmed OK?**

OK

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