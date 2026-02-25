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

---  

