"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allItems = [];
let currentFilter = "combined";
let currentSearch = "";

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
// Status derivation (mirrors logic that was previously in fetch_orders.py)
// ---------------------------------------------------------------------------
const STATUS_RULES = [
  // Cancelled
  ["cancelled",              "Cancelled"],
  ["canceled",               "Cancelled"],
  // Return states
  ["return complete",        "Return Complete"],
  ["return received",        "Return Complete"],
  ["replacement complete",   "Return Complete"],
  ["return started",         "Return Started"],
  ["return in transit",      "Return in Transit"],
  ["refunded",               "Return in Transit"],
  ["refund issued",          "Return in Transit"],
  ["replacement ordered",    "Replacement Ordered"],
  // Delivered
  ["delivered",              "Delivered"],
  // Shipped / en route ("not yet shipped" must precede "shipped" to avoid false match)
  ["out for delivery",       "Shipped"],
  ["on the way",             "Shipped"],
  ["not yet shipped",        "Ordered"],
  ["shipped",                "Shipped"],
  ["in transit",             "Shipped"],
  ["now arriving",           "Shipped"],
  ["arriving",               "Shipped"],
  // Not yet shipped
  ["preparing for shipment", "Ordered"],
  ["order placed",           "Ordered"],
  ["payment pending",        "Ordered"],
];

const ASSUME_DELIVERED_AFTER_DAYS = 14;

function deriveStatus(deliveryStatus, orderDate) {
  const key = (deliveryStatus || "").trim().toLowerCase();
  if (!key) {
    if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
    return "Ordered";
  }
  for (const [pattern, value] of STATUS_RULES) {
    if (key.includes(pattern)) return value;
  }
  if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
  return "Ordered";
}

function daysSince(isoDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((today - new Date(isoDate + "T00:00:00")) / 86400000);
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
                     "july", "august", "september", "october", "november", "december"];

function parseExpectedDelivery(deliveryStatus) {
  if (!deliveryStatus) return null;
  const s = deliveryStatus.trim().toLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (s.includes("today") || s.includes("out for delivery")) {
    return toIso(today);
  }
  if (s.includes("tomorrow")) {
    return toIso(new Date(today.getTime() + 86400000));
  }

  // Named weekday: "Arriving Saturday"
  for (let i = 0; i < WEEKDAY_NAMES.length; i++) {
    if (s.includes(WEEKDAY_NAMES[i])) {
      let daysAhead = (i - today.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      return toIso(new Date(today.getTime() + daysAhead * 86400000));
    }
  }

  // Month + day: "Now arriving February 28" or "Arriving Feb 22"
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const abbr = MONTH_NAMES[i].slice(0, 3);
    if (s.includes(abbr)) {
      const m = s.match(new RegExp(abbr + "\\w*\\s+(\\d{1,2})"));
      if (m) {
        const day = parseInt(m[1], 10);
        const month = i; // 0-indexed
        let candidate = new Date(today.getFullYear(), month, day);
        if (candidate < today) candidate = new Date(today.getFullYear() + 1, month, day);
        return toIso(candidate);
      }
    }
  }

  return null;
}

function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------
function filterItems(items, tab, searchQuery) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return items.filter(item => {
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

function sortItems(items, sort) {
  const arr = [...items];
  switch (sort) {
    case "order_date_asc":
      return arr.sort((a, b) => (a.order_date || "").localeCompare(b.order_date || ""));
    case "order_date_desc":
      return arr.sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""));
    case "price_desc":
      return arr.sort((a, b) => (b.unit_price ?? 0) - (a.unit_price ?? 0));
    case "price_asc":
      return arr.sort((a, b) => (a.unit_price ?? 0) - (b.unit_price ?? 0));
    case "return_window_asc":
      return arr.sort((a, b) => {
        if (!a.return_window_end && !b.return_window_end) return 0;
        if (!a.return_window_end) return 1;
        if (!b.return_window_end) return -1;
        return a.return_window_end.localeCompare(b.return_window_end);
      });
    case "expected_delivery_asc":
      return arr.sort((a, b) => {
        const da = parseExpectedDelivery(a.delivery_status);
        const db = parseExpectedDelivery(b.delivery_status);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
    default:
      return arr;
  }
}

// ---------------------------------------------------------------------------
// Tab counts
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
    "Return Started": 0,
    "Return in Transit": 0,
    "Return Complete": 0,
    "Replacement Ordered": 0,
    mail_back: 0,
    decide: 0,
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
    "Replacement Ordered": ["badge-replacement",     "Replacement Ordered"],
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

// ---------------------------------------------------------------------------
// Effective display status (Return Started items kept >30 days past deadline
// are treated as Delivered for display purposes)
// ---------------------------------------------------------------------------
function effectiveStatus(item) {
  const status = deriveStatus(item.delivery_status, item.order_date);
  if (status === "Return Started" && item.return_window_end) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysOverdue = Math.ceil((today - end) / (1000 * 60 * 60 * 24));
    if (daysOverdue > 30) return "Delivered";
  }
  return status;
}

// ---------------------------------------------------------------------------
// Return window badge (Delivered and Return Started items)
// ---------------------------------------------------------------------------
function returnWindowHtml(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const status = effectiveStatus(item);

  if (status === "Delivered") {
    if (!item.return_window_end) return "";
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      return `<span class="badge return-badge-closed">Return window closed</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Return by ${formatDate(item.return_window_end)} (${daysLeft}d left)</span>`;
    }
    return `<span class="badge return-badge-ok">Return by ${formatDate(item.return_window_end)}</span>`;
  }

  if (status === "Return Started" || status === "Replacement Ordered") {
    if (!item.return_window_end) return "";
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      return `<span class="badge return-badge-overdue">Mail back by ${formatDate(item.return_window_end)}</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Mail back by ${formatDate(item.return_window_end)} (${daysLeft}d left)</span>`;
    }
    return `<span class="badge return-badge-ok">Mail back by ${formatDate(item.return_window_end)}</span>`;
  }

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
function isDecideEligible(item) {
  if (effectiveStatus(item) !== "Delivered") return false;
  if (!item.return_window_end) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(item.return_window_end + "T00:00:00") >= today;
}

function isMailBackEligible(item) {
  const s = effectiveStatus(item);
  return s === "Return Started" || s === "Replacement Ordered";
}

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
    ? `<span class="delivery-eta">${etaLabel} ${formatDate(expectedDelivery)}</span>`
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

  article.innerHTML = `
    <div class="card-top">
      ${thumbnailHtml(item)}
      <div class="card-top-right">
        <div class="card-title">${titleHtml}</div>
        <div class="card-badges">
          ${statusBadgeHtml(effectiveStatus(item))}
          ${returnWindowHtml(item)}
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
  const restItems = sortItems(
    allFiltered.filter(i => {
      const s = effectiveStatus(i);
      if ((s === "Return Started" || s === "Replacement Ordered") && !isKept(i)) return false;
      if (s === "Shipped") return false;
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
  ];

  for (const { label, items } of fixedSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderSectionHeading(label, items.length));
    for (const item of items) fragment.appendChild(renderCard(item));
  }

  for (const { label, items } of monthSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderSectionHeading(label, items.length));
    for (const item of items) fragment.appendChild(renderCard(item));
  }

  container.appendChild(fragment);
}

function sortForFilter(filter) {
  return (filter === "mail_back" || filter === "decide") ? "return_window_asc" : "order_date_desc";
}

function refreshView() {
  if (currentFilter === "combined") {
    const filtered = allItems.filter(item => {
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
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
document.getElementById("search-input").addEventListener("input", e => {
  currentSearch = e.target.value.trim();
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
// Boot
// ---------------------------------------------------------------------------
function init() {
  const container = document.getElementById("item-list");
  const manifest = window.ORDER_DATA_MANIFEST;

  if (!manifest || manifest.length === 0) {
    container.innerHTML = `
      <div class="error-state">
        <h2>Could not load order data</h2>
        <p>
          Run <code>.venv/bin/python3 fetch_orders.py</code> to generate
          <code>data/app_data_manifest.js</code> and year data files,
          then open <code>index.html</code> directly in your browser.
        </p>
      </div>`;
    return;
  }

  // Merge items from all year globals (manifest is newest-year-first)
  allItems = [];
  let latestGeneratedAt = null;
  let email = null;
  for (const year of manifest) {
    const yearData = window["ORDER_DATA_" + year];
    if (!yearData) continue;
    allItems = allItems.concat(yearData.items || []);
    if (yearData.generated_at) {
      if (!latestGeneratedAt || yearData.generated_at > latestGeneratedAt) {
        latestGeneratedAt = yearData.generated_at;
      }
    }
    if (!email && yearData.email) email = yearData.email;
  }

  const metaBar = document.getElementById("meta-bar");
  const generated = latestGeneratedAt
    ? new Date(latestGeneratedAt).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      })
    : null;
  const emailPart = email ? `${email} · ` : "";
  const metaText = document.createElement("span");
  metaText.textContent =
    emailPart +
    `${allItems.length} item${allItems.length !== 1 ? "s" : ""}` +
    (generated ? ` · Updated ${generated}` : "");
  const graphBtn = document.createElement("button");
  graphBtn.id = "graph-btn";
  graphBtn.textContent = "Show Graph";
  graphBtn.addEventListener("click", openGraphModal);
  metaBar.appendChild(metaText);
  metaBar.appendChild(graphBtn);

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
  const deliverySamples = {};  // derived status → [delivery_status strings]
  const unknownSamples  = [];  // delivery_status strings that fell through to default

  for (const item of items) {
    const s = deriveStatus(item.delivery_status, item.order_date);
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    if (item.delivery_status) {
      if (!deliverySamples[s]) deliverySamples[s] = new Set();
      deliverySamples[s].add(item.delivery_status);
    }

    // Flag items whose raw delivery_status doesn't match any known keyword
    // and whose derived status is Delivered/Ordered (possible mis-classification).
    if (item.delivery_status && (s === "Ordered" || s === "Delivered")) {
      const raw = item.delivery_status.toLowerCase();
      const knownKeywords = [
        "cancelled", "canceled", "return", "refund", "replacement", "delivered",
        "out for delivery", "on the way", "not yet shipped", "shipped", "in transit",
        "now arriving", "arriving", "preparing", "order placed", "payment pending",
      ];
      if (!knownKeywords.some(k => raw.includes(k))) {
        unknownSamples.push({ status: s, delivery_status: item.delivery_status });
      }
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
  console.log("Sample raw delivery_status by derived status:", samples);
  if (unknownSamples.length) {
    console.warn(
      `${unknownSamples.length} item(s) have unrecognised delivery_status strings ` +
      `(check STATUS_RULES in app.js):`,
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
];

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
  const datasets = [...GRAPH_STATUSES].reverse().map(status => ({
    label: status,
    data: years.map(y => byYear[y][status] || 0),
    backgroundColor: GRAPH_STATUS_COLORS[status],
    borderColor: GRAPH_STATUS_COLORS[status],
    borderWidth: 0,
  }));

  return { years, datasets };
}

function openGraphModal() {
  const modal = document.getElementById("graph-modal");
  const canvas = document.getElementById("graph-canvas");

  if (graphChartInstance) {
    graphChartInstance.destroy();
    graphChartInstance = null;
  }

  const { years, datasets } = buildGraphData();

  modal.showModal();

  // Defer chart creation until the modal is laid out and the canvas has dimensions
  requestAnimationFrame(() => {
    graphChartInstance = new Chart(canvas, {
      type: "bar",
      data: { labels: years, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, title: { display: true, text: "Year" } },
          y: {
            stacked: true,
            title: { display: true, text: "Items" },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { position: "bottom", reverse: true, labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { mode: "index", intersect: false, reverse: true },
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
});

init();
