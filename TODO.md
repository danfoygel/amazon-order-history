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

## Item 4: Enable fast load

Even though everything is local, there are almost 6000 items and there is a visible delay in loading the web page.  In most cases, I don't need to see old orders - so let's optimize that case.

When the page is first opened, load the minimum data necessary to show the last 3 months - and then have a link that loads the remaining data files.

Change the header from "X items" to "X of Y items (load all)"

---

## Item 5: Subscribe and Save

Figure out how you can tell if an item was ordered through "subscribe and save" or a regular order.  If it's subscribe and save, show a small icon on the item card indicating this.

### Plan (branch: `feat/subscribe-and-save`)

#### How Subscribe & Save is detected

The `amazon-orders` library's `Order` class exposes a `subscription_discount` attribute (populated only when `full_details=True`, which we already use). It is non-`None` when the order detail page contains a Subscribe & Save discount line — regardless of the discount amount. This is the only machine-readable S&S signal the library provides; there is nothing on the `Item` class.

All items in a given order share the same `subscription_discount` value, so the approach is: if an order has a non-`None` `subscription_discount`, every item in that order is treated as a Subscribe & Save item. (Amazon places S&S items in dedicated S&S orders, not mixed with regular orders, so this should be accurate.)

#### Changes

**`fetch_orders.py` — `build_item_record()`**

Add a `"subscribe_and_save"` boolean to the item record dict:

```python
"subscribe_and_save": order.subscription_discount is not None,
```

This requires passing the `order` object into `build_item_record()`. Currently the signature is `(order, shipment, item, item_id)`, so `order` is already available — just add the field.

**`app.js` — `renderCard()`**

In the `.card-badges` row, append a small S&S pill badge when `item.subscribe_and_save` is truthy:

```js
const snsHtml = item.subscribe_and_save
  ? `<span class="badge badge-sns" title="Subscribe &amp; Save">S&amp;S</span>`
  : "";
```

Insert `${snsHtml}` into `.card-badges` alongside the existing status badge and return-window badge.

**`style.css`**

Add a style for `.badge-sns` — a muted teal/green pill consistent with the Amazon S&S brand color but not clashing with existing badges:

```css
.badge-sns { background: #d1fae5; color: #065f46; }
```

(Exact color is open to adjustment — see question below.)

#### Existing data / backfill

Stored JSON files do not currently have a `subscribe_and_save` field. Frontend code will treat the absent field as `false` (falsy), so no badge will appear for old items — this is the correct safe default. To backfill historical S&S status the user would need to re-run `fetch_orders.py --year YYYY` for each year of interest. This is optional and not part of this PR.

#### Key decisions made

- Detection is at order level, not item level — the library gives us no item-level S&S signal.
- `subscription_discount is not None` (field present on page) is used as the trigger, rather than `> 0`. A $0 S&S discount is still a S&S order. If this turns out to produce false positives, the condition can be tightened to `> 0`.
- No new filter tab is added — S&S is informational only (an icon, not a category). Adding a tab is a future option.

#### Questions / clarifications for user

1. **Badge style**: The plan uses a small "S&S" text pill. Would you prefer a different label (e.g., "Subscribe & Save" spelled out as a tooltip only, with a symbol like ↻ as the visible text), or is "S&S" the right label?

Answer: use ↻ symbol, mouseover text should say "Subscribe & Save"

2. **$0 discount edge case**: If an S&S order happens to have a $0 discount (e.g., all items were already discounted elsewhere), `subscription_discount` would be `0.0` rather than `None`. The plan treats both `0.0` and `None` differently (`0.0` → show badge, `None` → no badge). Is that the right behavior, or should the badge only appear when there's an actual dollar discount (`> 0`)?

Answer: that's correct.

3. **Backfill**: Do you want to re-run the fetcher for any historical years as part of this work to get accurate S&S data retroactively, or is "new fetches going forward" sufficient for now?

Answer: no, I'll handle backfill later

---

## Item 6: Return Policy

Figure out what you can determine about the return policy for a given item - I specifically want to know if it's "free returns", or if its a non-returnable item.  Show a small icon on the item card indicating each of these.

---

## Item 7: Monthly Graph

In addition to the annual graph, create the same kind of graph showing the trailing 12 months.  Replace the "Show Graph" button with two, "x Years" and "x Months", where "x" is a tiny icon of a bar graph.

---

## Item 8: Automated Tests

It's time to add some automated tests to this project.  This is a bit tricky, since the data is my personal order history - which shouldn't be part of the tests.  So I think the right approach is to mock the Amazon APIs, have those return some synthetic orders, and then verify that everything works in a deterministic and correct way for those orders.  I want to verify both the fetching process and the web view.

---

## Item 9: Add data to Git

I want to also store my data files in git - but obviously in a private repo that's separate from the main public repo.  I think the right approach is to make it a submodule - can you set that up?

---
