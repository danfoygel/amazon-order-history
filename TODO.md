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

## Item 6: Return Policy

Figure out what you can determine about the return policy for a given item - I specifically want to know if it's "free returns", or if its a non-returnable item.  Show a small icon on the item card indicating each of these.

### Plan (branch: `feat/return-policy-icons`)

#### Background & Research

The `amazon-orders` library scrapes order detail pages and parses an HTML element with
`data-component='itemReturnEligibility'`. Currently, `fetch_orders.py` calls
`item.return_eligible_date` to get just the parsed date from that element — the raw text is
discarded. The library's `Item` objects expose a `parsed` attribute (a BeautifulSoup tag
representing the item's HTML section), which lets us run additional CSS selectors without
modifying the library.

**What we know:**
- Items with a return window have a `return_eligible_date` (e.g. `2025-01-30`)
- Items with no return data get a synthetic default: `order_date + 30 days`
- The library provides *nothing* about whether returns are free or whether the item is non-returnable

**What we need to determine (the key uncertainty):**
Amazon's order detail pages display return policy differently depending on the product:
- *Free returns*: the element likely contains text like "Free returns" or "free return"
- *Non-returnable*: the element likely contains "Non-returnable" or may be absent entirely
- *Standard/paid returns*: has a date but no "free" indicator

We don't have a confirmed sample of the exact HTML text patterns Amazon uses for each case.
The plan below includes a diagnostic step to discover this before committing to text-matching
rules.

---

#### Step 1 — Diagnostic: Discover actual return-text patterns

Before writing any detection logic, add a temporary `--dump-return-text` flag (or just
`--verbose` output) to `fetch_orders.py` that prints the raw text of the
`[data-component='itemReturnEligibility']` element for every item. Run this against a recent
fetch to observe what text Amazon actually uses. Look for at least:
- One item expected to have free returns (most Amazon-fulfilled items)
- One item expected to be non-returnable (e.g. digital codes, hazmat, certain food)
- One item with a standard paid-return policy (often third-party sellers)

**Decision**: The exact string patterns used in Step 2 will be finalized after this diagnostic.
Placeholder patterns: `"free return"` → free, `"non-returnable"` → non-returnable.

> **❓ Question for you**: Do you have any orders where you already know the return policy
> (e.g. items marked non-returnable on Amazon)? If so, their order IDs would be useful
> for validating the detection logic. Also — have you noticed Amazon ever showing a "free
> returns" label on the order detail page (not the product page)?

---

#### Step 2 — Backend: Add `return_policy` field to item records

**File**: `fetch_orders.py`

1. Add a helper function `extract_return_policy(item)` that:
   - Accesses `item.parsed` (the BeautifulSoup tag the library already holds)
   - Selects `[data-component='itemReturnEligibility']` within it
   - Gets the full text via `.get_text(" ", strip=True)`
   - Returns one of:
     - `"free"` — if text contains "free return" (case-insensitive)
     - `"non_returnable"` — if text contains "non-returnable" or "non returnable"
     - `"standard"` — has a `return_eligible_date` but no "free" marker (paid/standard returns)
     - `None` — element absent or text not recognized (unknown)

2. In `build_item_record()`, call `extract_return_policy(item)` and store the result as a new
   `"return_policy"` field in the returned dict.

3. **Non-returnable items and `return_window_end`**: When `return_policy == "non_returnable"`,
   we should set `return_window_end` to `None` rather than defaulting to `order_date + 30`.
   This prevents non-returnable items from appearing to have a return deadline.

   > **Decision**: If the `itemReturnEligibility` element says "non-returnable" but
   > `return_eligible_date` is also populated (unlikely but possible), `return_policy` wins and
   > `return_window_end` is set to `None`.

4. **Backward compatibility**: Existing data files will not have `return_policy`. `app.js`
   must treat a missing/null `return_policy` as unknown (no icon shown). No data migration
   needed — the field will appear on items fetched after this change is merged.

---

#### Step 3 — Frontend: Show icons on item cards

**Files**: `app.js`, `style.css` (possibly `index.html` for any SVG definitions)

**Icon design** (two new small inline icons):
- 🟢 **Free returns**: A small green recycling-arrow or return icon, inline in the metadata row
- 🔴 **Non-returnable**: A small red "no" symbol (circle-slash) or X, inline in the metadata row

Implementation approach: use inline SVG snippets (no external assets, no CDN dependency).
Each icon is ~16×16px, placed to the right of the existing return-window badge (or alongside
the status badge if there is no return-window badge). Include a `title` attribute on the SVG
for a tooltip that says "Free returns" or "Non-returnable".

In `renderCard(item)`:
- Add a helper `returnPolicyBadge(item)` that returns an HTML string:
  - `return_policy === "free"` → green icon SVG with tooltip "Free returns"
  - `return_policy === "non_returnable"` → red icon SVG with tooltip "Non-returnable"
  - anything else (including `null` / missing) → empty string

Inject the badge into the card's metadata row next to the return window badge.

**CSS**: Add small rules for the new icon classes (`.return-free-icon`, `.return-nonreturnable-icon`)
to control size and alignment. No large CSS additions needed.

> **Decision**: We are NOT showing an icon for `"standard"` (paid returns) — only the two
> cases explicitly requested. Items with `null`/unknown return policy show nothing.

---

#### Step 4 — Testing & Validation

After implementing:
1. Re-run `fetch_orders.py` (incremental mode) to populate `return_policy` in the current
   year's data file
2. Open `index.html` and verify icons appear correctly on cards where expected
3. Confirm non-returnable items no longer show a return-deadline badge

---

#### Open Questions / Decisions Needed

| # | Question | Default assumption |
|---|----------|--------------------|
| 1 | What exact text does Amazon use in `itemReturnEligibility` for free vs non-returnable? | "free return" / "non-returnable" (to be confirmed in Step 1 diagnostic) |
| 2 | Should non-returnable items have `return_window_end = null`? | Yes — prevents misleading deadline badge |
| 3 | Should items with `return_policy = "standard"` get any indicator? | No — only free and non-returnable as requested |
| 4 | What SVG icons to use? | Simple inline SVGs (no CDN); recycling arrow (green) and circle-slash (red) |
| 5 | Where to place the icon in the card? | Metadata row, adjacent to the return-window badge |

---

## Item 7: Monthly Graph ✅ (merged PR #18)

Replaced the "Show Graph" button with two icon buttons — `▐▐▐ Years` and `▐▐▐ Months` — each opening the same modal with a different aggregation. The Years chart is the existing annual stacked bar chart; Months shows a trailing-12-month stacked bar chart (current month included). Both buttons are hidden until all data is loaded (consistent with Item 4 fast-load behavior).

---

## Item 8: Automated Tests

It's time to add some automated tests to this project.  This is a bit tricky, since the data is my personal order history - which shouldn't be part of the tests.  So I think the right approach is to mock the Amazon APIs, have those return some synthetic orders, and then verify that everything works in a deterministic and correct way for those orders.  I want to verify both the fetching process and the web view.

---

## Item 9: Add data to Git

I want to also store my data files in git - but obviously in a private repo that's separate from the main public repo.  I think the right approach is to make it a submodule - can you set that up?

---

## Item 10: Diagnose "Return in Transit"

There are 73 items in "return in transit" status, most quite old.  This doesn't make sense - there should be essentially zero.  Are these items that I forgot to ship back?  Or did they get lost by the shipping company and never arrived at Amazon?  Or did Amazon receive them but didn't credit me for the return, for some reason?  Investigate this issue - look at some example items in that status from various years, use Chrome to find the tracking number and then access the tracking history, and write an analysis of what you've found.

---


