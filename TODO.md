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

## Item 5: Subscribe and Save

Figure out how you can tell if an item was ordered through "subscribe and save" or a regular order.  If it's subscribe and save, show a small icon on the item card indicating this.

---

## Item 6: Return Policy

Figure out what you can determine about the return policy for a given item - I specifically want to know if it's "free returns", or if its a non-returnable item.  Show a small icon on the item card indicating each of these.

---

## Item 7: Monthly Graph ✅ (merged PR #18)

In addition to the annual graph, create the same kind of graph showing the trailing 12 months.  Replace the "Show Graph" button with two, "x Years" and "x Months", where "x" is a tiny icon of a bar graph.

### Implementation Plan (branch: `feat/monthly-graph`)

#### Overview

Replace the single "Show Graph" button with two smaller buttons — `[icon] Years` and `[icon] Months` — each opening the same graph modal with different aggregations:
- **Years**: the existing stacked bar chart, one bar per calendar year.
- **Months**: a new stacked bar chart showing the trailing 12 calendar months (one bar per month).

The two charts share the same `<dialog>` element, canvas, and Chart.js instance. The modal title and x-axis label update dynamically based on which button was clicked.

#### Files to change

**`app.js`**

1. **`init()` — swap single button for two buttons.**
   Currently creates one `<button id="graph-btn">Show Graph</button>` and appends it to `#meta-bar`. Replace with:
   - A tiny inline SVG bar-chart icon (3 ascending bars, ~12×10 px, `aria-hidden="true"`). Same SVG string reused in both buttons.
   - `<button class="graph-btn">` (note: class, not ID) containing the SVG + " Years", bound to `openGraphModal("years")`.
   - A second `<button class="graph-btn">` containing the SVG + " Months", bound to `openGraphModal("months")`.
   - Both appended to `metaBar`; they sit side-by-side since `#meta-bar` is already `display:flex; gap:10px`.

2. **New `buildMonthlyGraphData()` function.**
   - Computes the trailing 12 calendar months ending with the current month (e.g. on Feb 24 2026: Mar 2025 → Feb 2026).
   - Generates `monthKeys` as `["2025-03", "2025-04", ..., "2026-02"]` and corresponding `labels` as `["Mar 2025", ..., "Feb 2026"]`.
   - Iterates `allItems`, buckets each item by the `YYYY-MM` prefix of its `order_date` and by `effectiveStatus()`. Items outside the 12-month window are ignored.
   - Returns `{ labels, datasets }` in the same shape as `buildGraphData()` (datasets reversed so Cancelled is bottom of stack, Ordered is top; x-axis labels are month strings instead of year strings).

3. **Modify `openGraphModal(mode)` to accept `"years"` or `"months"`.**
   - Existing call sites (`addEventListener("click", openGraphModal)`) become `() => openGraphModal("years")` and `() => openGraphModal("months")`.
   - Inside the function, branch on `mode`:
     - `"years"`: title = `"Items by Status & Year"`, x-axis title = `"Year"`, call `buildGraphData()`.
     - `"months"`: title = `"Items by Status (Trailing 12 Months)"`, x-axis title = `"Month"`, call `buildMonthlyGraphData()`.
   - Everything else (destroy/recreate chart, `requestAnimationFrame` deferral, same Chart.js config) stays the same.

**`style.css`**

- Replace the `#graph-btn` ID selector with `.graph-btn` so the same styles apply to both buttons.
- Add `display: inline-flex; align-items: center; gap: 4px;` to `.graph-btn` to align the SVG icon with the button text (the icon is `currentColor` so it inherits the button text color including hover/active states automatically).

**`index.html`**

- No changes needed. The `<dialog id="graph-modal">` structure is unchanged; only the title text inside it is updated dynamically by JS.

#### Key decisions

- **Single shared modal** — avoids duplicating dialog markup and Chart.js lifecycle code. The chart is destroyed and recreated on every open regardless, so there is no extra cost.
- **Trailing 12 months = current month + prior 11 months** — includes the current (possibly incomplete) month. The chart title makes this transparent. (See Q1 below if you prefer complete months only.)
- **Inline SVG icon** — no emoji, no icon library. Three ascending filled rectangles (~12×10 px). `aria-hidden="true"` because the button label ("Years" / "Months") is already descriptive.
- **Class instead of ID** — switching from `#graph-btn` to `.graph-btn` cleanly supports two identically-styled buttons without duplicating CSS rules.
- **Monthly chart uses `allItems`** — same scope as the annual chart, ignoring the current tab/filter. If Item 4 (fast load) is implemented later, both charts will benefit from the same "load all" flow without any special handling here.

#### Questions / Clarification Needed

**Q1: Should the trailing 12 months include the current (partial) month or end at the last complete month?**
- Current plan: include the current month (e.g. Feb 2026 on Feb 24), showing whatever orders exist so far. The chart title would say "Trailing 12 Months".
- Alternative: show only the 12 most recent *complete* months (Mar 2025 – Jan 2026). The current month would be omitted since it's in progress.

Answer: include current partial month

**Q2: No other open questions at this time.** The implementation above is otherwise unambiguous given the existing code structure.

---

## Item 8: Automated Tests

It's time to add some automated tests to this project.  This is a bit tricky, since the data is my personal order history - which shouldn't be part of the tests.  So I think the right approach is to mock the Amazon APIs, have those return some synthetic orders, and then verify that everything works in a deterministic and correct way for those orders.  I want to verify both the fetching process and the web view.

---

## Item 9: Add data to Git

I want to also store my data files in git - but obviously in a private repo that's separate from the main public repo.  I think the right approach is to make it a submodule - can you set that up?

---
