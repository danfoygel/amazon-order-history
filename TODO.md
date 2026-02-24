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

#### Step 1 — Diagnostic findings ✅

Ran `diagnose_return_policy.py` against 30 recent items (last 3 months). Key findings:

**The library's selector is broken.** Amazon no longer uses
`data-component='itemReturnEligibility'`. That element is absent from every single item page
(explaining why `return_eligible_date` is always `None` across all ~2100 items in the data).

**The actual return-eligibility HTML** lives in a plain `<span class="a-size-small">` inside a
`<div class="a-row">` within each item's section. Two text patterns were found:

```
"Return or replace items: Eligible through [Month DD, YYYY]"   ← Amazon-fulfilled
"Return items: Eligible through [Month DD, YYYY]"              ← some third-party/category
```

**Items with no return text at all** — two distinct causes:
1. **Non-returnable** (food, supplements, consumables): the `yohtmlc-item-level-connections`
   div is completely empty (no Buy-it-again or other buttons). Examples: Ricola cough drops,
   Oregon Chai, vitamin supplements, toothpaste.
2. **Expired return window**: the item has buttons (Buy it again, View item) but no return
   span — because the 30-day window has passed since delivery.

**"Free returns" text was NOT found anywhere** in any order detail page HTML. Amazon does not
embed "Free returns" in the order detail page — it's a product-page attribute.

**"Non-returnable" text was also never found explicitly** — the signal is absence of the return
span rather than an explicit "Non-returnable" string.

**Revised understanding of what we can detect:**

| Signal in order HTML | Interpretation |
|---|---|
| `span.a-size-small` text contains "Return or replace items: Eligible through [date]" | Returnable; "replace" option = Amazon-fulfilled (likely free returns) |
| `span.a-size-small` text contains "Return items: Eligible through [date]" | Returnable; return-only (possibly third-party seller, may not be free) |
| No return span + connections div is completely empty | Likely non-returnable (consumables, food, etc.) |
| No return span + connections div has buttons | Return window expired (normal item, bought > 30-60 days ago) |

---

#### Step 2 — Backend changes (`fetch_orders.py`)

**2a. Fix the broken `return_eligible_date` / `return_window_end` parsing**

The `data-component='itemReturnEligibility'` selector never matches any more, so all items
fall through to the `order_date + 30` default. Fix by parsing `item.parsed` directly:

```python
def extract_return_info(item) -> tuple[str | None, str | None]:
    """
    Returns (return_window_end, return_policy) by reading item.parsed HTML.

    return_policy values:
      "free_or_replace"  — "Return or replace items" text (Amazon-fulfilled, likely free)
      "return_only"      — "Return items" text (return only, possibly paid/third-party)
      "non_returnable"   — no return span AND connections div is empty
      None               — ambiguous (no return span but connections div has content,
                           meaning window probably expired)
    """
    parsed = getattr(item, "parsed", None)
    if parsed is None:
        return None, None

    # Look for the return eligibility span
    for span in parsed.select("span.a-size-small"):
        text = span.get_text(" ", strip=True)
        lower = text.lower()
        if "eligible through" not in lower:
            continue
        # Found the return span — extract date and classify policy
        date_str = _parse_return_date(text)
        if "return or replace items" in lower:
            return date_str, "free_or_replace"
        else:
            return date_str, "return_only"

    # No return span found — check if connections div is empty (non-returnable signal)
    connections = parsed.select_one(".yohtmlc-item-level-connections")
    if connections is not None and not connections.get_text(strip=True):
        return None, "non_returnable"

    return None, None  # ambiguous (expired window or unknown)
```

`_parse_return_date(text)` uses `dateutil.parser.parse(text, fuzzy=True)` to extract the
date from the span text (same approach the library tried to do — now just with the right
selector).

**2b. Update `build_item_record()`**:
- Call `extract_return_info(item)` to get `(return_window_end, return_policy)`
- Use the parsed `return_window_end` instead of the old `item.return_eligible_date` path
- Fall back to `None` (not `order_date + 30`) when no return date is found
  - **Decision**: remove the `order_date + 30` default entirely, now that we can actually
    read Amazon's return dates correctly. A null `return_window_end` means "no return info"
    rather than "30 days" — this is more honest.
  - Items with a confirmed return date retain their date; items with no return span get `null`
- Store `return_policy` as a new field in the item record

**2c. Backward compatibility**: Existing data files have `return_window_end` set to
`order_date + 30` (the old synthetic default). These won't have `return_policy`. The frontend
must treat missing `return_policy` as `null` (no icon). After re-fetching, the dates will be
corrected.

---

#### Step 3 — Frontend: Show icons on item cards

**Files**: `app.js`, `style.css`

**Policy-to-icon mapping**:
- `"free_or_replace"` → 🟢 green recycling-arrow SVG, tooltip: "Free returns"
- `"non_returnable"` → 🔴 red circle-slash SVG, tooltip: "Non-returnable"
- `"return_only"` → no icon (returnable but we can't confirm free; don't mislead)
- `null` / missing → no icon

**Implementation**: add `returnPolicyIcon(item)` helper in `app.js` returning an HTML string.
Inject next to the return-window badge in `renderCard()`. Add minimal CSS for sizing/alignment.

---

#### Step 4 — Testing & Validation

1. Re-run `fetch_orders.py` (incremental) → verify `return_policy` and corrected
   `return_window_end` appear in `data/app_data_2026.js`
2. Spot-check: food/consumable items should have `return_policy: "non_returnable"` and
   `return_window_end: null`
3. Recent physical-goods items should have `return_policy: "free_or_replace"` and a real date
4. Open `index.html`, confirm icons render on the expected cards

---

#### Remaining open questions

| # | Question | Decision |
|---|----------|----------|
| 1 | Remove `order_date + 30` fallback entirely? | Yes — null is more honest than a fake date |
| 2 | Non-returnable icon for items with expired windows (no span, has buttons)? | No — `null` policy, no icon, too ambiguous |
| 3 | Show any icon for `"return_only"` (third-party, possibly paid)? | No — not what was asked for |
| 4 | SVG icon assets | Inline SVGs, no CDN |
| 5 | Icon placement | Metadata row, beside return-window badge |

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


