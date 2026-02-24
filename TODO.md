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

### Implementation Plan (branch: `feat/fast-load`)

#### Root cause

`index.html` currently uses `document.write()` to synchronously inject a `<script>` tag for every year data file listed in the manifest, before the page renders anything. All ~6,000 items are parsed and stored before `app.js` can display anything.

#### Strategy

Load only the year file(s) needed to cover the last 3 months on initial page load; defer all older year files. The "last 3 months" cutoff is computed by calendar year — any year whose number is ≥ the year of (today minus 3 months) gets loaded up front. This means at most 2 year files on the first paint (e.g., in Feb 2026: load 2026 and 2025; in April 2026: load 2026 only). Items are **not** additionally filtered by date within loaded files — all items from the loaded years are visible immediately.

Clicking **"load all"** dynamically fetches the remaining year files and re-renders.

#### Files changed

**1. `fetch_orders.py`** — Enrich the manifest file

Add a second variable `window.ORDER_DATA_YEAR_COUNTS` alongside the existing manifest, so `app.js` can compute the total item count `Y` without loading every year file:

```js
// data/app_data_manifest.js (after change)
window.ORDER_DATA_MANIFEST = [2026, 2025, 2024, 2023, ...];
window.ORDER_DATA_YEAR_COUNTS = { "2026": 120, "2025": 350, "2024": 480, "2023": 612, ... };
```

The manifest array format (`[year, year, ...]`) is unchanged to minimize breakage. `ORDER_DATA_YEAR_COUNTS` is a new, additive variable written right after the manifest line. `fetch_orders.py` will count `len(items)` per year when writing each year file, then write the totals map into the manifest file.

**2. `index.html`** — Remove the synchronous `document.write()` block

The entire inline `<script>` block that loops over years and calls `document.write()` is deleted. Only the manifest script tag remains; year files are now loaded dynamically by `app.js`.

Before:
```html
<script src="data/app_data_manifest.js"></script>
<script>
  (function() {
    var years = window.ORDER_DATA_MANIFEST || [];
    for (var i = 0; i < years.length; i++) {
      document.write('<script src="data/app_data_' + years[i] + '.js"><\/script>');
    }
  })();
</script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="app.js"></script>
```

After:
```html
<script src="data/app_data_manifest.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="app.js"></script>
```

**3. `app.js`** — Async init, dynamic script loading, partial/full header

New state variables at the top:
```js
let loadedYears = new Set();   // which year files have been fetched
let totalItemCount = 0;        // sum across ALL years (from ORDER_DATA_YEAR_COUNTS)
```

New helper `loadScript(src)` — Promise-based dynamic script injector:
```js
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
```

New helper `initialYears(manifest)` — returns the subset of years to load on first paint:
```js
function initialYears(manifest) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffYear = cutoff.getFullYear();
  return manifest.filter(y => y >= cutoffYear);
}
```

`init()` becomes async:
1. Read `window.ORDER_DATA_MANIFEST` (already synchronously loaded)
2. Compute `totalItemCount` by summing `window.ORDER_DATA_YEAR_COUNTS`
3. Determine which years to load initially via `initialYears()`
4. Dynamically load those year scripts via `Promise.all(years.map(y => loadScript(...)))`
5. Merge items from loaded years into `allItems`; track loaded years in `loadedYears`
6. Render UI — if some years are deferred, show `"X of Y items"` + a `"(load all)"` link; if all loaded, show `"Y items"` (same as current)
7. Wire up event listeners

New function `loadAllYears()` — triggered by the "load all" link:
1. Find years not yet in `loadedYears`
2. Change "load all" link to `"loading…"` (non-interactive) while fetching
3. `Promise.all()` to load remaining scripts
4. Merge new items into `allItems`; sort by `order_date` descending to maintain ordering
5. Re-render; update header to `"Y items"` (remove "load all" link)
6. Show "Show Graph" button (see decision below)

Header rendering:
- Partial mode: `email · X of Y items · Updated … (load all)`
- Full mode: `email · Y items · Updated … Show Graph`

Note: for partial mode it should be `email · X of Y items (load all) · Updated …`

#### Key decisions

**D1 — Year-granularity, not item-granularity**: Items within a loaded year file are not date-filtered. The initial view shows everything from the loaded years (e.g., all of 2025 + 2026), not just the literal last 90 days. This keeps the code simple and avoids a new "date filter" state that would interact awkwardly with the existing status tabs. The speedup comes entirely from not parsing 2024 and older data.

**D2 — "Show Graph" hidden until all data loaded**: The graph aggregates all years and would be misleading if only recent years are loaded. The "Show Graph" button will be hidden in partial mode and appear only after "load all" completes (or if the page naturally loads with all years already in range, which happens once the dataset spans only 1–2 years).

**D3 — Additive manifest change**: `ORDER_DATA_YEAR_COUNTS` is a second variable added to the manifest file rather than changing the manifest array format. This is less disruptive. If `ORDER_DATA_YEAR_COUNTS` is missing (e.g., an older manifest), `app.js` will omit `Y` from the header and just show `"X items (load all)"`.

**D4 — Sort after merge**: When "load all" adds older items, `allItems` will be re-sorted by `order_date` descending before re-rendering, so the list order remains consistent.

**D5 — "load all" as inline link**: Rendered as `<a href="#">(load all)</a>` inside the meta-bar span, styled like a subtle text link. No separate button.

#### Questions for review

**Q1 — Initial view scope**: The plan shows ALL items from loaded year files (e.g., all of 2025), not just items from the last 90 days. Is this the right tradeoff, or should items within the loaded files also be date-filtered to only the last 3 months? Date-filtering would be more precise but adds a "date mode" that would need to interact with the existing filter tabs.

Answer: correct.

**Q2 — "Show Graph" in partial mode**: I plan to hide it until all data is loaded. Does that feel right, or would you prefer it visible with a note like "Show Graph (recent only)"?

Answer: correct.

**Q3 — Loading indicator**: When "load all" is clicked, older year files may take a moment. I'll change the link to "loading…" during fetch. Is that sufficient, or do you want something more prominent (e.g., a spinner)?

Answer: that's sufficient.

---

## Item 5: Subscribe and Save

Figure out how you can tell if an item was ordered through "subscribe and save" or a regular order.  If it's subscribe and save, show a small icon on the item card indicating this.

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
