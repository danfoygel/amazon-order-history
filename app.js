"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allItems = [];
let currentFilter = "combined";
let currentSearch = "";
let currentSnsOnly = false;
let loadedYears = new Set();   // which year files have been fetched so far
let totalItemCount = 0;        // sum across ALL years (from ORDER_DATA_YEAR_COUNTS)

// ---------------------------------------------------------------------------
// Kept items (localStorage)
// ---------------------------------------------------------------------------
const KEPT_KEY = "amazon_order_history_kept";

function loadKept() {
  try { return new Set(JSON.parse(localStorage.getItem(KEPT_KEY)) || []); }
  catch { return new Set(); }
}
function saveKept(set) {
  localStorage.setItem(KEPT_KEY, JSON.stringify([...set]));
}
function isKept(item) { return keptIds.has(item.item_id); }
function toggleKept(item) {
  if (keptIds.has(item.item_id)) { keptIds.delete(item.item_id); }
  else { keptIds.add(item.item_id); }
  saveKept(keptIds);
}

let keptIds = loadKept();

// ---------------------------------------------------------------------------
// Status derivation — loaded from order_logic.js
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------
function filterItems(items, tab, searchQuery) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return items.filter(item => {
    if (currentSnsOnly && !item.subscribe_and_save) return false;
    let tabMatch;
    if (tab === "all") {
      tabMatch = true;
    } else if (tab === "mail_back") {
      const status = effectiveStatus(item);
      tabMatch = (status === "Return Started" || status === "Replacement Ordered") && !isKept(item);
    } else if (tab === "decide") {
      if (effectiveStatus(item) !== "Delivered") { tabMatch = false; }
      else if (isKept(item)) { tabMatch = false; }
      else if (!item.return_window_end) { tabMatch = false; }
      else {
        const end = new Date(item.return_window_end + "T00:00:00");
        tabMatch = end >= today;
      }
    } else {
      tabMatch = effectiveStatus(item) === tab;
    }
    if (!tabMatch) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.title || "").toLowerCase().includes(q) ||
      (item.asin || "").toLowerCase().includes(q) ||
      (item.order_id || "").toLowerCase().includes(q)
    );
  });
}

// ---------------------------------------------------------------------------
// Tab counts (depends on global state: isKept)
// ---------------------------------------------------------------------------
function computeTabCounts(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const counts = {
    all: items.length,
    Delivered: 0,
    Shipped: 0,
    Ordered: 0,
    Cancelled: 0,
    Unknown: 0,
    "Return Started": 0,
    "Return in Transit": 0,
    "Return Complete": 0,
    "Replacement Ordered": 0,
    mail_back: 0,
    decide: 0,
    quantity: 0,
  };
  for (const item of items) {
    const status = effectiveStatus(item);
    if (counts[status] !== undefined) counts[status]++;
    if ((status === "Return Started" || status === "Replacement Ordered") && !isKept(item)) {
      counts.mail_back++;
    }
    if (status === "Delivered" && !isKept(item) && item.return_window_end) {
      const end = new Date(item.return_window_end + "T00:00:00");
      if (end >= today) counts.decide++;
    }
  }
  counts.quantity = groupItemsByAsin(items).length;
  return counts;
}

function renderTabCounts(items) {
  const counts = computeTabCounts(items);
  document.querySelectorAll(".tab").forEach(btn => {
    const filter = btn.dataset.filter;
    const countEl = btn.querySelector(".count");
    if (countEl && counts[filter] !== undefined) {
      countEl.textContent = counts[filter];
    }
    // Only show the Unknown tab when there are items with that status
    if (filter === "Unknown") {
      btn.style.display = counts.Unknown > 0 ? "" : "none";
    }
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format a date that's expected to be near today — omit the year and use
 *  "yesterday" / "today" / "tomorrow" when applicable.  Used for arrival
 *  estimates, return-by dates, and mail-back deadlines. */
function formatDateNearby(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === -1) return "yesterday";
  if (diffDays === 0)  return "today";
  if (diffDays === 1)  return "tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPrice(val) {
  if (val === null || val === undefined) return "—";
  return "$" + Number(val).toFixed(2);
}

function statusBadgeHtml(status) {
  const map = {
    "Delivered":           ["badge-delivered",      "Delivered"],
    "Shipped":             ["badge-in-transit",      "Shipped"],
    "Ordered":             ["badge-pending",         "Ordered"],
    "Cancelled":           ["badge-cancelled",       "Cancelled"],
    "Return Started":      ["badge-return-started",  "Return Started"],
    "Return in Transit":   ["badge-return-transit",  "Return in Transit"],
    "Return Complete":     ["badge-return-complete", "Return Complete"],
    "Replacement Ordered": ["badge-replacement",     "Replacement"],
    "Unknown":             ["badge-unknown",         "Unknown"],
  };
  const [cls, label] = map[status] || ["badge-pending", status || "Unknown"];
  return `<span class="badge ${cls}">${label}</span>`;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function orderUrl(item) {
  if (!item.order_id) return null;
  return `https://www.amazon.com/gp/your-account/order-details?orderID=${encodeURIComponent(item.order_id)}`;
}

// effectiveStatus(), returnWindowHtml(), estimateReturnWindowEnd() are in order_logic.js

// ---------------------------------------------------------------------------
// Return policy icon
// ---------------------------------------------------------------------------
function returnPolicyIcon(item) {
  const policy = item.return_policy;
  if (policy === "free_or_replace") {
    // Clockwise circular arrow — free returns
    return `<span class="icon-badge badge-free-returns" title="Free returns"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></span>`;
  }
  if (policy === "non_returnable") {
    // Circle with diagonal slash — non-returnable
    return `<span class="icon-badge badge-no-return" title="Non-returnable"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>`;
  }
  if (policy === "return_only") {
    // Corner-return arrow — returns allowed (but not free)
    return `<span class="icon-badge badge-return-only" title="Returns allowed"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg></span>`;
  }
  // null/missing: no icon shown
  return "";
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------
function thumbnailHtml(item) {
  if (!item.image_link) return "";
  const href = orderUrl(item);
  const wrap = href
    ? `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="card-thumb-link">`
    : `<div class="card-thumb-link">`;
  const closeWrap = href ? `</a>` : `</div>`;
  return `${wrap}<img class="card-thumb" src="${escHtml(item.image_link)}" alt="" loading="lazy" onerror="this.closest('.card-thumb-link').style.display='none'">${closeWrap}`;
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------
function renderCard(item) {
  const href = orderUrl(item);
  const titleHtml = href
    ? `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(item.title)}</a>`
    : escHtml(item.title);

  const priceHtml = item.unit_price !== null && item.unit_price !== undefined
    ? `<span class="price">${formatPrice(item.unit_price)}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</span>`
    : "";

  const itemStatus = effectiveStatus(item);
  const expectedDelivery = (itemStatus === "Shipped" || itemStatus === "Ordered")
    ? parseExpectedDelivery(item.delivery_status)
    : null;
  const etaLabel = itemStatus === "Ordered" ? "Expected" : "Arrives";
  const expectedDeliveryHtml = expectedDelivery
    ? `<span class="delivery-eta">${etaLabel} ${formatDateNearby(expectedDelivery)}</span>`
    : "";

  const article = document.createElement("article");
  article.className = "item-card";
  article.dataset.itemId = item.item_id;

  const kept = isKept(item);
  const showKeep = isDecideEligible(item) || isMailBackEligible(item);
  const keepTitle = isMailBackEligible(item)
    ? (kept ? "Unmark as not returning" : "Not returning (remove from Mail Back)")
    : (kept ? "Unmark as kept" : "Keep (remove from Decide)");
  const keepBtn = showKeep
    ? `<button class="keep-btn${kept ? " kept" : ""}" title="${keepTitle}">${kept ? "✓ Kept" : "Keep"}</button>`
    : "";

  const snsHtml = item.subscribe_and_save
    ? `<span class="icon-badge badge-sns" title="Subscribe &amp; Save"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`
    : "";

  article.innerHTML = `
    <div class="card-top">
      ${thumbnailHtml(item)}
      <div class="card-top-right">
        <div class="card-title">${titleHtml}</div>
        <div class="card-badges">
          ${statusBadgeHtml(effectiveStatus(item))}
          ${returnWindowHtml(item)}
          ${snsHtml}
          ${returnPolicyIcon(item)}
        </div>
        <div class="card-meta">
          <span>Ordered ${formatDate(item.order_date)}</span>
          ${item.quantity > 1 ? `<span>Qty: ${item.quantity}</span>` : ""}
          ${priceHtml}
          ${expectedDeliveryHtml}
        </div>
      </div>
    </div>
    ${keepBtn}
  `;

  if (showKeep) {
    article.querySelector(".keep-btn").addEventListener("click", () => {
      toggleKept(item);
      refreshView();
    });
  }

  return article;
}

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------
function renderSectionHeading(label, count) {
  const h = document.createElement("h2");
  h.className = "section-heading";
  h.textContent = `${label} (${count})`;
  return h;
}

/** Wrap a section heading + items in a collapsible group (expanded by default). */
function renderCollapsibleSection(label, items) {
  const group = document.createElement("div");
  group.className = "section-group";

  const heading = document.createElement("h2");
  heading.className = "section-heading section-heading-toggle";
  heading.innerHTML = `<span class="section-chevron">&#x25BE;</span> ${escHtml(label)} (${items.length})`;

  const itemsWrap = document.createElement("div");
  itemsWrap.className = "section-items";
  for (const item of items) itemsWrap.appendChild(renderCard(item));

  heading.addEventListener("click", () => {
    const collapsed = group.classList.toggle("collapsed");
    heading.querySelector(".section-chevron").innerHTML = collapsed ? "&#x25B8;" : "&#x25BE;";
  });

  group.appendChild(heading);
  group.appendChild(itemsWrap);
  return group;
}

function renderList(items) {
  const container = document.getElementById("item-list");
  container.innerHTML = "";

  if (items.length === 0) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<h2>No items found</h2><p>Try a different filter or search term.</p>`;
    container.appendChild(div);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    fragment.appendChild(renderCard(item));
  }
  container.appendChild(fragment);
}

function renderCombined(allFiltered) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mailBack = sortItems(
    allFiltered.filter(i => { const s = effectiveStatus(i); return (s === "Return Started" || s === "Replacement Ordered") && !isKept(i); }),
    "return_window_asc"
  );
  const decide = sortItems(
    allFiltered.filter(i => {
      if (effectiveStatus(i) !== "Delivered") return false;
      if (isKept(i)) return false;
      if (!i.return_window_end) return false;
      return new Date(i.return_window_end + "T00:00:00") >= today;
    }),
    "return_window_asc"
  );
  const shipped = sortItems(
    allFiltered.filter(i => effectiveStatus(i) === "Shipped"),
    "expected_delivery_asc"
  );
  const ordered = sortItems(
    allFiltered.filter(i => effectiveStatus(i) === "Ordered"),
    "expected_delivery_asc"
  );
  const restItems = sortItems(
    allFiltered.filter(i => {
      const s = effectiveStatus(i);
      if ((s === "Return Started" || s === "Replacement Ordered") && !isKept(i)) return false;
      if (s === "Shipped") return false;
      if (s === "Ordered") return false;
      if (s === "Delivered" && !isKept(i) && i.return_window_end && new Date(i.return_window_end + "T00:00:00") >= today) return false;
      return true;
    }),
    "order_date_desc"
  );

  // Group "rest" items by order month (YYYY-MM), most recent first
  const byMonth = new Map();
  for (const item of restItems) {
    const key = (item.order_date || "").slice(0, 7); // "YYYY-MM"
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(item);
  }
  const monthSections = [...byMonth.entries()].map(([key, items]) => {
    const [year, month] = key.split("-");
    const label = key
      ? new Date(Number(year), Number(month) - 1, 1)
          .toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "Unknown";
    return { label, items };
  });

  const container = document.getElementById("item-list");
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const fixedSections = [
    { label: "Mail Back", items: mailBack },
    { label: "Decide",    items: decide   },
    { label: "Shipped",   items: shipped  },
    { label: "Ordered",   items: ordered  },
  ];

  for (const { label, items } of fixedSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderCollapsibleSection(label, items));
  }

  for (const { label, items } of monthSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderCollapsibleSection(label, items));
  }

  container.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// Quantity view — deduplicated items grouped by ASIN
// ---------------------------------------------------------------------------
function renderQuantityCard(group) {
  const href = group.item_link || null;
  const titleHtml = href
    ? `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(group.title)}</a>`
    : escHtml(group.title);

  const priceHtml = group.unit_price !== null && group.unit_price !== undefined
    ? `<span class="price">${formatPrice(group.unit_price)}</span>`
    : "";

  const freqHtml = group.frequencyMonths !== null
    ? `<span class="badge badge-frequency">Every ${group.frequencyMonths} mo</span>`
    : "";

  const snsHtml = group.snsEligible
    ? `<span class="icon-badge badge-sns" title="S&amp;S eligible"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`
    : "";

  const thumbHtml = group.image_link
    ? `${href ? `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="card-thumb-link">` : `<div class="card-thumb-link">`}<img class="card-thumb" src="${escHtml(group.image_link)}" alt="" loading="lazy" onerror="this.closest('.card-thumb-link').style.display='none'">${href ? `</a>` : `</div>`}`
    : "";

  const article = document.createElement("article");
  article.className = "item-card";
  article.dataset.asin = group.asin;

  article.innerHTML = `
    <div class="card-top">
      ${thumbHtml}
      <div class="card-top-right">
        <div class="card-title">${titleHtml}</div>
        <div class="card-badges">
          <span class="badge badge-quantity">Qty: ${group.totalQuantity}</span>
          ${freqHtml}
          ${snsHtml}
        </div>
        <div class="card-meta">
          ${priceHtml}
          <span>${group.orderCount} order${group.orderCount !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  `;

  return article;
}

function renderQuantityView(items, searchQuery) {
  const groups = groupItemsByAsin(items);

  // Apply search filter to the deduplicated groups
  const filtered = searchQuery
    ? groups.filter(g => {
        const q = searchQuery.toLowerCase();
        return (g.title || "").toLowerCase().includes(q) ||
               (g.asin || "").toLowerCase().includes(q);
      })
    : groups;

  const container = document.getElementById("item-list");
  container.innerHTML = "";

  if (filtered.length === 0) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<h2>No items found</h2><p>Try a different search term.</p>`;
    container.appendChild(div);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of filtered) {
    fragment.appendChild(renderQuantityCard(group));
  }
  container.appendChild(fragment);
}

function sortForFilter(filter) {
  return (filter === "mail_back" || filter === "decide") ? "return_window_asc" : "order_date_desc";
}

function refreshView() {
  // Hide S&S filter on Quantity tab (S&S is shown differently there)
  const snsLabel = document.getElementById("sns-filter-label");
  if (snsLabel) snsLabel.style.display = currentFilter === "quantity" ? "none" : "";

  if (currentFilter === "quantity") {
    renderQuantityView(allItems, currentSearch);
  } else if (currentFilter === "combined") {
    const filtered = allItems.filter(item => {
      if (currentSnsOnly && !item.subscribe_and_save) return false;
      if (!currentSearch) return true;
      const q = currentSearch.toLowerCase();
      return (
        (item.title || "").toLowerCase().includes(q) ||
        (item.asin || "").toLowerCase().includes(q) ||
        (item.order_id || "").toLowerCase().includes(q)
      );
    });
    renderCombined(filtered);
  } else {
    const visible = sortItems(filterItems(allItems, currentFilter, currentSearch), sortForFilter(currentFilter));
    renderList(visible);
  }
  renderTabCounts(allItems);

  // Update S&S count to reflect items in the current tab that are S&S
  const snsCountEl = document.getElementById("sns-count");
  if (snsCountEl) {
    const saved = currentSnsOnly;
    currentSnsOnly = false;
    const base = currentFilter === "combined"
      ? allItems
      : filterItems(allItems, currentFilter, "");
    currentSnsOnly = saved;
    const snsCount = base.filter(i => i.subscribe_and_save).length;
    snsCountEl.textContent = snsCount > 0 ? `(${snsCount})` : "";
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
document.getElementById("search-input").addEventListener("input", e => {
  currentSearch = e.target.value.trim();
  refreshView();
});

document.getElementById("sns-filter").addEventListener("change", e => {
  currentSnsOnly = e.target.checked;
  refreshView();
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
    refreshView();
  });
});

// ---------------------------------------------------------------------------
// Boot — async, with fetch-based JSON loading
// ---------------------------------------------------------------------------

/** Fetch a JSON file and return its parsed content. */
async function loadJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  return resp.json();
}

/** Cache of loaded year data objects, keyed by year number. */
const yearDataCache = {};

/**
 * Fetch year JSON files, cache them, and merge their items into allItems.
 * Returns metadata from the freshest file.
 */
async function fetchAndMergeYears(years) {
  // Fetch any years not yet cached
  const toFetch = years.filter(y => !yearDataCache[y]);
  const fetched = await Promise.all(toFetch.map(y => loadJson(`data/app_data_${y}.json`)));
  for (let i = 0; i < toFetch.length; i++) {
    yearDataCache[toFetch[i]] = fetched[i];
  }

  let email = null;
  for (const year of years) {
    if (loadedYears.has(year)) continue;
    const yearData = yearDataCache[year];
    if (!yearData) continue;
    allItems = allItems.concat(yearData.items || []);
    loadedYears.add(year);
    if (!email && yearData.email) email = yearData.email;
  }
  // Use the current calendar year's generated_at so historical backfills
  // don't change the displayed "Updated" timestamp.
  const currentYearData = yearDataCache[new Date().getFullYear()];
  const latestGeneratedAt = currentYearData?.generated_at || null;
  return { latestGeneratedAt, email };
}

/** Render the meta-bar content based on current load state. */
function renderMetaBar(manifest, latestGeneratedAt, email) {
  const metaBar = document.getElementById("meta-bar");
  metaBar.innerHTML = "";

  const generated = latestGeneratedAt
    ? new Date(latestGeneratedAt).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      })
    : null;
  const emailPart = email ? `${email} · ` : "";

  const allLoaded = loadedYears.size === manifest.length;

  const barIcon = `<svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor" aria-hidden="true"><rect x="0" y="6" width="3" height="4"/><rect x="4.5" y="3" width="3" height="7"/><rect x="9" y="0" width="3" height="10"/></svg>`;

  if (allLoaded) {
    // Full mode: "email · Y items · Updated …  [▐▐▐ Years] [▐▐▐ Months]"
    const metaText = document.createElement("span");
    metaText.textContent =
      emailPart +
      `${allItems.length} item${allItems.length !== 1 ? "s" : ""}` +
      (generated ? ` · Updated ${generated}` : "");
    const yearsBtn = document.createElement("button");
    yearsBtn.className = "graph-btn";
    yearsBtn.innerHTML = `${barIcon} Years`;
    yearsBtn.addEventListener("click", () => openGraphModal("years"));
    const monthsBtn = document.createElement("button");
    monthsBtn.className = "graph-btn";
    monthsBtn.innerHTML = `${barIcon} Months`;
    monthsBtn.addEventListener("click", () => openGraphModal("months"));
    metaBar.appendChild(metaText);
    metaBar.appendChild(yearsBtn);
    metaBar.appendChild(monthsBtn);
  } else {
    // Partial mode: "email · X of Y items (load all) · Updated …"
    const yPart = totalItemCount > 0 ? ` of ${totalItemCount}` : "";
    const metaText = document.createElement("span");
    metaText.textContent = emailPart + `${allItems.length}${yPart} item${totalItemCount !== 1 ? "s" : ""}`;

    const loadLink = document.createElement("a");
    loadLink.id = "load-all-link";
    loadLink.href = "#";
    loadLink.textContent = "(load all)";
    loadLink.addEventListener("click", e => {
      e.preventDefault();
      loadAllYears(manifest);
    });

    const updatedText = document.createElement("span");
    updatedText.textContent = generated ? ` · Updated ${generated}` : "";

    metaBar.appendChild(metaText);
    metaBar.appendChild(document.createTextNode(" "));
    metaBar.appendChild(loadLink);
    metaBar.appendChild(updatedText);
  }
}

/** Load all remaining (deferred) year files, then re-render. */
async function loadAllYears(manifest) {
  const link = document.getElementById("load-all-link");
  if (link) {
    link.textContent = "loading\u2026";
    link.style.pointerEvents = "none";
  }

  const remaining = manifest.filter(y => !loadedYears.has(y));
  await fetchAndMergeYears(remaining);

  // Re-sort allItems newest-first so display order stays consistent
  allItems.sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""));

  // Retrieve email and current-year generatedAt for the final header
  let finalEmail = null;
  for (const year of loadedYears) {
    const yd = yearDataCache[year];
    if (!yd) continue;
    if (!finalEmail && yd.email) finalEmail = yd.email;
  }
  const currentYearData = yearDataCache[new Date().getFullYear()];
  const finalGenAt = currentYearData?.generated_at || null;

  renderMetaBar(manifest, finalGenAt, finalEmail);
  logDiagnostics(allItems);
  refreshView();
}

async function init() {
  const container = document.getElementById("item-list");

  // Load JSON configuration files (status rules + known overrides)
  try {
    const [statusRules, knownStatus] = await Promise.all([
      loadJson("status_rules.json"),
      loadJson("data/known_status_issues.json").catch(() => ({})),
    ]);
    _initOrderLogicData(statusRules, knownStatus);
  } catch (e) {
    console.error("Failed to load status rules:", e);
  }

  // Load manifest
  let manifestData;
  try {
    manifestData = await loadJson("data/app_data_manifest.json");
  } catch {
    manifestData = null;
  }

  const manifest = manifestData?.years || [];
  const yearCounts = manifestData?.year_counts || {};

  if (manifest.length === 0) {
    container.innerHTML = `
      <div class="error-state">
        <h2>Could not load order data</h2>
        <p>
          Run <code>.venv/bin/python3 fetch_orders.py</code> to generate
          <code>data/app_data_manifest.json</code> and year data files,
          then serve this directory with a local HTTP server.
        </p>
      </div>`;
    return;
  }

  // Compute total item count from manifest metadata (if available)
  totalItemCount = Object.values(yearCounts).reduce((sum, n) => sum + n, 0);

  // Determine which years to load now (those covering the last 3 months)
  const yearsToLoad = initialYears(manifest);

  // Fetch only the needed year JSON files
  const { latestGeneratedAt, email } = await fetchAndMergeYears(yearsToLoad);

  // Build the meta-bar and (conditionally) the Show Graph button
  renderMetaBar(manifest, latestGeneratedAt, email);

  // Activate the default tab visually
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === currentFilter);
  });

  logDiagnostics(allItems);
  refreshView();
}

// ---------------------------------------------------------------------------
// Diagnostics — logged to the browser console on every page load.
// Open DevTools → Console and look for "Order History Diagnostics".
// ---------------------------------------------------------------------------
function logDiagnostics(items) {
  const statusCounts = {};
  const deliverySamples = {};  // effective status → [delivery_status strings]
  const unknownSamples  = [];  // items whose effective status is "Unknown"

  for (const item of items) {
    const s = effectiveStatus(item);
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    if (item.delivery_status) {
      if (!deliverySamples[s]) deliverySamples[s] = new Set();
      deliverySamples[s].add(item.delivery_status);
    }

    if (s === "Unknown") {
      unknownSamples.push({ item_id: item.item_id, delivery_status: item.delivery_status });
    }
  }

  // Convert sets to sorted arrays for readability
  const samples = {};
  for (const [k, v] of Object.entries(deliverySamples)) {
    samples[k] = [...v].slice(0, 5);
  }

  console.group("Order History Diagnostics");
  console.log(`Total items: ${items.length}`);
  console.table(statusCounts);
  console.log("Sample raw delivery_status by effective status:", samples);
  if (unknownSamples.length) {
    console.warn(
      `${unknownSamples.length} item(s) have Unknown status ` +
      `(check status_rules.json and data/known_status_issues.json):`,
      unknownSamples.slice(0, 20)
    );
  }
  console.groupEnd();
}

// ---------------------------------------------------------------------------
// Graph modal — stacked area chart of items per status per year
// ---------------------------------------------------------------------------

const GRAPH_STATUSES = [
  "Ordered",
  "Shipped",
  "Delivered",
  "Replacement Ordered",
  "Return Started",
  "Return in Transit",
  "Return Complete",
  "Cancelled",
  "Unknown",
];

// Returns GRAPH_STATUSES filtered to omit "Unknown" when there are none.
function activeGraphStatuses() {
  const hasUnknown = allItems.some(item => effectiveStatus(item) === "Unknown");
  return hasUnknown ? GRAPH_STATUSES : GRAPH_STATUSES.filter(s => s !== "Unknown");
}

// Display labels for chart legends (where internal status name differs)
const GRAPH_STATUS_LABELS = {
  "Replacement Ordered": "Replacement",
};

// Colors aligned with existing badge palette in style.css
const GRAPH_STATUS_COLORS = {
  "Ordered":             "#6b7280",   // pending gray
  "Shipped":             "#2563eb",   // blue
  "Delivered":           "#16a34a",   // green
  "Replacement Ordered": "#6d28d9",   // purple
  "Return Started":      "#d97706",   // amber
  "Return in Transit":   "#06b6d4",   // cyan (clearly distinct from blue)
  "Return Complete":     "#9ca3af",   // muted gray
  "Cancelled":           "#dc2626",   // red
  "Unknown":             "#f97316",   // orange (warning)
};

let graphChartInstance = null;

function buildGraphData() {
  // Aggregate allItems by order year and effectiveStatus
  const byYear = {};
  for (const item of allItems) {
    const year = item.order_date ? item.order_date.slice(0, 4) : null;
    if (!year) continue;
    const status = effectiveStatus(item);
    if (!byYear[year]) byYear[year] = {};
    byYear[year][status] = (byYear[year][status] || 0) + 1;
  }

  const years = Object.keys(byYear).sort();
  // Datasets ordered Cancelled→Ordered so bars stack with Cancelled at bottom, Ordered at top.
  // Legend uses reverse:true to display Ordered first (left) and Cancelled last (right).
  const statuses = activeGraphStatuses();
  const datasets = [...statuses].reverse().map(status => ({
    label: GRAPH_STATUS_LABELS[status] || status,
    data: years.map(y => byYear[y][status] || 0),
    backgroundColor: GRAPH_STATUS_COLORS[status],
    borderColor: GRAPH_STATUS_COLORS[status],
    borderWidth: 0,
  }));

  return { labels: years, datasets };
}

function buildMonthlyGraphData() {
  // Compute the trailing 12 calendar months ending with the current month (inclusive).
  const today = new Date();
  const monthKeys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    monthKeys.push(`${y}-${m}`);
  }

  // Build human-readable labels: "Mar 2025", "Apr 2025", …
  const labels = monthKeys.map(key => {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString("en-US", { month: "short", year: "numeric" });
  });

  // Aggregate items into a Set for quick lookup, then count
  const monthKeySet = new Set(monthKeys);
  const byMonth = {};
  for (const item of allItems) {
    const key = item.order_date ? item.order_date.slice(0, 7) : null;
    if (!key || !monthKeySet.has(key)) continue;
    const status = effectiveStatus(item);
    if (!byMonth[key]) byMonth[key] = {};
    byMonth[key][status] = (byMonth[key][status] || 0) + 1;
  }

  // Same stack order as the annual chart: Cancelled at bottom, Ordered at top.
  const statuses = activeGraphStatuses();
  const datasets = [...statuses].reverse().map(status => ({
    label: GRAPH_STATUS_LABELS[status] || status,
    data: monthKeys.map(k => (byMonth[k] && byMonth[k][status]) || 0),
    backgroundColor: GRAPH_STATUS_COLORS[status],
    borderColor: GRAPH_STATUS_COLORS[status],
    borderWidth: 0,
  }));

  return { labels, datasets };
}

function openGraphModal(mode) {
  const modal = document.getElementById("graph-modal");
  const canvas = document.getElementById("graph-canvas");

  if (graphChartInstance) {
    graphChartInstance.destroy();
    graphChartInstance = null;
  }

  const isMonths = mode === "months";
  const { labels, datasets } = isMonths ? buildMonthlyGraphData() : buildGraphData();
  const modalTitle = isMonths ? "Items by Status (Trailing 12 Months)" : "Items by Status & Year";
  const xAxisTitle = isMonths ? "Month" : "Year";

  document.getElementById("graph-modal-title").textContent = modalTitle;

  modal.showModal();

  // Defer chart creation until the modal is laid out and the canvas has dimensions
  requestAnimationFrame(() => {
    graphChartInstance = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, title: { display: true, text: xAxisTitle } },
          y: {
            stacked: true,
            title: { display: true, text: "Items" },
            beginAtZero: true,
          },
        },
        animation: false,
        plugins: {
          legend: { position: "bottom", reverse: true, labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            mode: "index",
            intersect: false,
            reverse: true,
            filter: (item) => item.parsed.y !== 0,
          },
        },
      },
    });
  });
}

function closeGraphModal() {
  const modal = document.getElementById("graph-modal");
  modal.close();
  if (graphChartInstance) {
    graphChartInstance.destroy();
    graphChartInstance = null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("graph-modal-close").addEventListener("click", closeGraphModal);
  // Close on backdrop click
  document.getElementById("graph-modal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeGraphModal();
  });

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------
  let focusedCardIndex = -1;

  function getVisibleCards() {
    return Array.from(document.querySelectorAll(".item-card"));
  }

  function setCardFocus(index) {
    const cards = getVisibleCards();
    // Clear previous focus
    const prev = document.querySelector(".item-card.card-focused");
    if (prev) prev.classList.remove("card-focused");

    if (index < 0 || index >= cards.length) {
      focusedCardIndex = -1;
      return;
    }
    focusedCardIndex = index;
    cards[index].classList.add("card-focused");
    cards[index].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // Reset card focus when the view changes
  const _origRefreshView = refreshView;
  refreshView = function() {
    focusedCardIndex = -1;
    _origRefreshView();
  };

  document.addEventListener("keydown", e => {
    const tag = (e.target.tagName || "").toLowerCase();
    const inInput = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
    const modal = document.getElementById("graph-modal");
    const modalOpen = modal && modal.open;

    // Escape: close modal or clear search
    if (e.key === "Escape") {
      if (modalOpen) {
        closeGraphModal();
        e.preventDefault();
        return;
      }
      const searchInput = document.getElementById("search-input");
      if (searchInput.value) {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input"));
        searchInput.blur();
        e.preventDefault();
        return;
      }
      // Clear card focus
      if (focusedCardIndex >= 0) {
        setCardFocus(-1);
        e.preventDefault();
        return;
      }
      return;
    }

    // Don't intercept shortcuts when typing in an input
    if (inInput) return;
    // Don't intercept when modal is open
    if (modalOpen) return;

    // "/" or Ctrl+K — focus search bar
    if (e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      document.getElementById("search-input").focus();
      return;
    }

    // 1–9 — switch to the Nth visible tab
    if (e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const visibleTabs = Array.from(document.querySelectorAll(".tab")).filter(
        t => t.offsetParent !== null && t.style.display !== "none"
      );
      const idx = parseInt(e.key, 10) - 1;
      if (idx < visibleTabs.length) {
        visibleTabs[idx].click();
        e.preventDefault();
      }
      return;
    }

    // Arrow keys — navigate between item cards
    // Left/Right move by 1; Up/Down jump by row (grid column count)
    if (e.key === "ArrowRight") {
      const cards = getVisibleCards();
      if (cards.length === 0) return;
      const next = focusedCardIndex < 0 ? 0 : Math.min(focusedCardIndex + 1, cards.length - 1);
      setCardFocus(next);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft") {
      const cards = getVisibleCards();
      if (cards.length === 0) return;
      const prev = focusedCardIndex <= 0 ? 0 : focusedCardIndex - 1;
      setCardFocus(prev);
      e.preventDefault();
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && focusedCardIndex >= 0) {
      const cards = getVisibleCards();
      if (cards.length === 0) return;
      // Find the card visually above/below with the closest horizontal center.
      // This works across section boundaries in the combined view.
      const cur = cards[focusedCardIndex].getBoundingClientRect();
      const curCenterX = cur.left + cur.width / 2;
      const curCenterY = cur.top + cur.height / 2;
      let bestIdx = focusedCardIndex;
      let bestDist = Infinity;
      for (let i = 0; i < cards.length; i++) {
        if (i === focusedCardIndex) continue;
        const r = cards[i].getBoundingClientRect();
        const cy = r.top + r.height / 2;
        // Only consider cards in the correct direction
        if (e.key === "ArrowDown" && cy <= curCenterY) continue;
        if (e.key === "ArrowUp" && cy >= curCenterY) continue;
        const dx = Math.abs((r.left + r.width / 2) - curCenterX);
        const dy = Math.abs(cy - curCenterY);
        // Prefer same column (small dx), break ties by proximity (small dy)
        const dist = dx * 10000 + dy;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      setCardFocus(bestIdx);
      e.preventDefault();
      return;
    }

    // Enter — open the focused card's Amazon order page
    if (e.key === "Enter" && focusedCardIndex >= 0) {
      const cards = getVisibleCards();
      if (focusedCardIndex < cards.length) {
        const link = cards[focusedCardIndex].querySelector("a[href]");
        if (link) {
          window.open(link.href, "_blank", "noopener");
          e.preventDefault();
        }
      }
      return;
    }
  });
});

init();
