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

## Item 17: Mail back dates

The "mail back" section used to show a mail back date for each item card - but now it's gone.  Figure out why it broke and fix it.

### Root Cause

When an item transitions to "Return Started" status, Amazon's order page no longer displays the return eligibility span ("Return or replace items: Eligible through [date]") — the return has already started, so there's no "are you eligible?" prompt. As a result, `extract_return_info()` in `fetch_orders.py` returns `(None, ...)` for these items.

The incremental fetch (`fetch_orders.py` default mode) re-fetches all orders within the last 3 months and replaces existing items wholesale. So when a recently-ordered item transitions from Delivered → Return Started, the next incremental run re-fetches it, gets `return_window_end = None`, and overwrites the previously-stored date. The `returnWindowHtml()` function in `app.js` (lines 330–341) correctly checks `if (!item.return_window_end) return "";` and shows nothing — but that guard is now firing for all current Mail Back items.

**Confirmed with data:**
- 4 Return Started items in 2026 data (all ordered Jan–Feb 2026): all have `return_window_end = null`
- 2 Return Started items in 2025 data: also `return_window_end = null`
- 2 older Return Started items (2018, 2021) have dates, but these were set by the old `order_date + 30` fallback that was since removed; they were never re-fetched with the current code

**Note on why it "used to work":** Old versions of `fetch_orders.py` defaulted `return_window_end` to `order_date + 30` when no date was found on the page. That synthetic fallback was removed in the Item 6 work (PR #15) — "null is more accurate than a synthetic date when Amazon doesn't show return eligibility." That removal was correct for Delivered items (where null means "we don't know the return window") but inadvertently broke Mail Back items (where there IS a known deadline that was captured while the item was Delivered but is no longer on the page once a return starts).

---

### Implementation Plan

**Change 1: `fetch_orders.py` — preserve `return_window_end` during merge (primary fix)**

In both incremental and `--year` modes, after fetching fresh items and enriching them, before writing to disk: for each fresh item where `return_window_end is None` and `return_policy != "non_returnable"`, check whether the existing on-disk record for the same `item_id` had a non-null `return_window_end`, and if so, restore it.

_Rationale:_ Once a real date is captured from Amazon while the item is Delivered, it should be treated as sticky — a subsequent re-fetch that can no longer see the date (because the return started) should not overwrite it. The `non_returnable` guard prevents restoring a date for items where the product page confirmed no return window exists.

Specifically:

- **Incremental mode** (lines ~998–1028): After loading `existing`, build a dict `replaced_by_id = {i["item_id"]: i for i in existing if order_date >= earliest_fresh}`. Then iterate over `fresh` items before the merge and restore `return_window_end` from `replaced_by_id` where conditions are met.

- **Historical mode** (`--year`, lines ~963–969): Load existing items for the year first (already available via `load_existing_items`), build the same `existing_by_id` dict, and apply the same preservation pass after `enrich_items_with_asin_cache`.

Extract the preservation logic into a helper function to avoid duplication:
```python
def _preserve_return_window(fresh_items: list[dict], existing_by_id: dict[str, dict]) -> None:
    """Restore return_window_end from existing records where fresh re-fetch lost it."""
    for item in fresh_items:
        if (item.get("return_window_end") is None
                and item.get("return_policy") != "non_returnable"):
            old = existing_by_id.get(item.get("item_id"))
            if old and old.get("return_window_end"):
                item["return_window_end"] = old["return_window_end"]
```

**Change 2: `app.js` — show "deadline unknown" badge for current broken items**

The data fix only helps going forward. The 6 currently-broken items (4 in 2026, 2 in 2025) already have `return_window_end = null` and the correct dates can no longer be recovered automatically (they were overwritten in the data files before this fix). These items are silently invisible in the Mail Back list's "mail back by" badge.

In `returnWindowHtml()` (lines 330–341), add a fallback for the case where `return_window_end` is null on a Return Started / Replacement Ordered item:

```javascript
if (status === "Return Started" || status === "Replacement Ordered") {
  if (!item.return_window_end) {
    return `<span class="badge return-badge-warn">⚠ Mail back — deadline unknown</span>`;
  }
  // ... existing date display logic ...
}
```

_Decision note:_ An alternative would be estimating `order_date + 30` on the frontend. This was considered but rejected — those estimates would be wrong for many items (Amazon's actual return window for an item from a given seller may differ, and delivery date offsets vary). Showing "deadline unknown" is more honest and still prompts the user to act.

---

### Files to change

1. `fetch_orders.py` — add `_preserve_return_window()` helper; call it in incremental and `--year` modes
2. `app.js` — update `returnWindowHtml()` to show a warning badge when `return_window_end` is null for Mail Back items

### Questions / clarifications for review

1. **"Deadline unknown" wording:** Is `⚠ Mail back — deadline unknown` the right copy, or do you prefer something else (e.g., "Mail back ASAP" or "Mail back: check Amazon")?

2. **`--year` mode recovery:** Running `fetch_orders.py --year 2025` or `--year 2026` will NOT restore the lost dates for the 6 currently-broken items — the previously-stored dates are already gone from disk and Amazon no longer shows them. The only ways to restore correct dates are: (a) user manually edits the JSON in the data files, or (b) user checks the Amazon "Manage Returns" page. Should I include a note/warning in the script output for this edge case?

---

