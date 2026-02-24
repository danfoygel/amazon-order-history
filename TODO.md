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

## Item 5: Subscribe and Save ✅ (merged PR #17)

Added a `subscribe_and_save` boolean to each item record in `fetch_orders.py` (detected via `order.subscription_discount is not None`). Shows a ↻ badge on S&S item cards, and added a "↻ S&S only" checkbox filter to the right of the status tabs. The checkbox label shows a live count of S&S items in the currently active tab.

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
