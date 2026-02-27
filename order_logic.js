"use strict";

// ---------------------------------------------------------------------------
// order_logic.js — Pure logic functions for the Order History app.
//
// Single source of truth for status derivation, sorting, formatting, and
// display helpers.  Rules are loaded from status_rules.json (shared with
// fetch_orders.py).
//
// Browser: loaded as a plain <script> before app.js; functions become globals.
// Node.js: loaded via require(); functions are exported on module.exports.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status rules + known-issue overrides
// ---------------------------------------------------------------------------
const _rulesData = (typeof require !== "undefined")
  ? require("./status_rules.json")
  : (typeof _ORDER_LOGIC_STATUS_RULES !== "undefined" ? _ORDER_LOGIC_STATUS_RULES : {rules: [], assume_delivered_after_days: 90});

let STATUS_RULES = _rulesData.rules;
let ASSUME_DELIVERED_AFTER_DAYS = _rulesData.assume_delivered_after_days;

// Known-status overrides (item_id → status).  Gracefully returns {} if the
// file is absent (e.g. fresh clone without a data/ directory).
const _knownStatusData = (typeof require !== "undefined")
  ? (function() {
      try { return require("./data/known_status_issues.json"); }
      catch { return {}; }
    })()
  : (typeof _ORDER_LOGIC_KNOWN_STATUS !== "undefined" ? _ORDER_LOGIC_KNOWN_STATUS : {});

let KNOWN_STATUS_OVERRIDES = _knownStatusData.items || {};

/**
 * Inject pre-fetched JSON data (called by app.js after fetching JSON files).
 * Must be called before init() processes any items.
 */
function _initOrderLogicData(statusRules, knownStatus) {
  if (statusRules) {
    STATUS_RULES = statusRules.rules;
    ASSUME_DELIVERED_AFTER_DAYS = statusRules.assume_delivered_after_days;
  }
  if (knownStatus) {
    KNOWN_STATUS_OVERRIDES = knownStatus.items || {};
  }
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

// Returns true only when the tracking URL contains a shipmentId parameter,
// which Amazon adds once a package has been assigned to a carrier.
function hasShipmentId(trackingUrl) {
  if (!trackingUrl) return false;
  try { return new URL(trackingUrl).searchParams.has("shipmentId"); }
  catch { return false; }
}

function deriveStatus(deliveryStatus, orderDate, trackingUrl) {
  const key = (deliveryStatus || "").trim().toLowerCase();
  if (!key) {
    // Empty delivery_status: Amazon doesn't retain tracking for older orders.
    // Assume delivered if ordered long enough ago; otherwise Unknown.
    if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
    return "Unknown";
  }
  for (const [pattern, value] of STATUS_RULES) {
    if (key.includes(pattern)) {
      // "arriving" alone is ambiguous: Amazon shows "Arriving [date]" for both
      // pre-ship estimated delivery dates AND in-transit packages.  Use the
      // presence of shipmentId in the tracking URL as the tiebreaker.
      if (pattern === "arriving" && value === "Shipped" && !hasShipmentId(trackingUrl)) {
        return "Ordered";
      }
      return value;
    }
  }
  // Non-empty delivery_status that doesn't match any rule — a real parsing issue.
  return "Unknown";
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
// Sorting
// ---------------------------------------------------------------------------
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
        const aEnd = a.return_window_end || estimateReturnWindowEnd(a.order_date);
        const bEnd = b.return_window_end || estimateReturnWindowEnd(b.order_date);
        if (!aEnd && !bEnd) return 0;
        if (!aEnd) return 1;
        if (!bEnd) return -1;
        return aEnd.localeCompare(bEnd);
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
    "Digital":             ["badge-digital",          "Digital"],
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
// Effective display status (applies known-issue overrides and demotes stale
// Return Started items to Delivered)
// ---------------------------------------------------------------------------
function effectiveStatus(item) {
  let status = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
  // Digital items: empty delivery_status + is_digital flag from fetch_orders.py
  if ((status === "Unknown" || status === "Delivered") && item.is_digital &&
      !(item.delivery_status || "").trim()) {
    return "Digital";
  }
  // Apply known-issue overrides for items with degraded status data
  if (status === "Unknown" && item.item_id && KNOWN_STATUS_OVERRIDES[item.item_id]) {
    status = KNOWN_STATUS_OVERRIDES[item.item_id];
  }
  if (status === "Return Started" || status === "Replacement Ordered") {
    const windowEnd = item.return_window_end || estimateReturnWindowEnd(item.order_date);
    if (windowEnd) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(windowEnd + "T00:00:00");
      const daysOverdue = Math.ceil((today - end) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 30) return "Delivered";
    }
  }
  return status;
}

// ---------------------------------------------------------------------------
// Estimate return_window_end from order_date when the actual date is unknown.
// Amazon's standard return window is 30 days from delivery.  Observed data
// shows return_window_end ≈ order_date + 33 days (median across 39 items).
// ---------------------------------------------------------------------------
const ESTIMATED_RETURN_WINDOW_DAYS = 33;

function estimateReturnWindowEnd(orderDate) {
  if (!orderDate) return null;
  const d = new Date(orderDate + "T00:00:00");
  d.setDate(d.getDate() + ESTIMATED_RETURN_WINDOW_DAYS);
  return toIso(d);
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
    const dateStr = formatDateNearby(item.return_window_end);
    const daysHint = (daysLeft >= 0 && daysLeft <= 7 && !["today", "tomorrow", "yesterday"].includes(dateStr))
      ? ` (${daysLeft}d left)` : "";
    if (daysLeft < 0) {
      return `<span class="badge return-badge-closed">Return window closed</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Return by ${dateStr}${daysHint}</span>`;
    }
    return `<span class="badge return-badge-ok">Return by ${dateStr}</span>`;
  }

  if (status === "Return Started" || status === "Replacement Ordered") {
    let windowEnd = item.return_window_end;
    let estimated = false;
    if (!windowEnd) {
      windowEnd = estimateReturnWindowEnd(item.order_date);
      estimated = true;
    }
    if (!windowEnd) return `<span class="badge return-badge-warn">⚠ Mail back — deadline unknown</span>`;
    const end = new Date(windowEnd + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    const dateStr = formatDateNearby(windowEnd);
    const approx = estimated ? "~" : "";
    const daysHint = (daysLeft >= 0 && daysLeft <= 7 && !["today", "tomorrow", "yesterday"].includes(dateStr))
      ? ` (${daysLeft}d left)` : "";
    if (daysLeft < 0) {
      return `<span class="badge return-badge-overdue">Mail back by ${approx}${dateStr}</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Mail back by ${approx}${dateStr}${daysHint}</span>`;
    }
    return `<span class="badge return-badge-ok">Mail back by ${approx}${dateStr}</span>`;
  }

  return "";
}

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
// Eligibility helpers
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

// ---------------------------------------------------------------------------
// Data loading helper
// ---------------------------------------------------------------------------

/**
 * Returns the subset of manifest years whose calendar year is >= the year
 * of (today minus 3 months).  At most 2 years are returned (current + prior).
 */
function initialYears(manifest) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffYear = cutoff.getFullYear();
  return manifest.filter(y => y >= cutoffYear);
}

// ---------------------------------------------------------------------------
// Quantity Insights — group items by ASIN for the "Quantity" view
// ---------------------------------------------------------------------------
const QUANTITY_STATUSES = new Set(["Delivered", "Ordered", "Shipped"]);

function groupItemsByAsin(items) {
  const byAsin = new Map();

  for (const item of items) {
    const status = effectiveStatus(item);
    if (!QUANTITY_STATUSES.has(status)) continue;
    if (!item.asin) continue;

    if (!byAsin.has(item.asin)) {
      byAsin.set(item.asin, []);
    }
    byAsin.get(item.asin).push(item);
  }

  const result = [];
  for (const [asin, orders] of byAsin) {
    // Sort orders by date ascending for frequency calculation
    orders.sort((a, b) => (a.order_date || "").localeCompare(b.order_date || ""));

    // Require orders on multiple distinct dates
    const distinctDates = new Set(orders.map(o => o.order_date));
    if (distinctDates.size < 2) continue;

    const totalQuantity = orders.reduce((sum, o) => sum + (o.quantity || 1), 0);
    const mostRecent = orders[orders.length - 1];
    const oldest = orders[0];

    // Find the best unit_price — prefer most recent non-null, else any non-null
    let unitPrice = mostRecent.unit_price;
    if (unitPrice === null || unitPrice === undefined) {
      for (let i = orders.length - 2; i >= 0; i--) {
        if (orders[i].unit_price !== null && orders[i].unit_price !== undefined) {
          unitPrice = orders[i].unit_price;
          break;
        }
      }
    }

    // Frequency: consumption rate = span / (totalQuantity - 1)
    let frequencyMonths = null;
    const firstDate = new Date(oldest.order_date + "T00:00:00");
    const lastDate = new Date(mostRecent.order_date + "T00:00:00");
    const spanMs = lastDate - firstDate;
    if (spanMs > 0 && totalQuantity > 1) {
      const spanMonths = spanMs / (1000 * 60 * 60 * 24 * 30.44);
      const rawFreq = spanMonths / (totalQuantity - 1);
      frequencyMonths = Math.max(1, Math.round(rawFreq));
    }

    result.push({
      asin,
      title: mostRecent.title,
      image_link: mostRecent.image_link,
      item_link: mostRecent.item_link,
      unit_price: unitPrice,
      totalQuantity,
      orderCount: orders.length,
      frequencyMonths,
      subscribe_and_save: mostRecent.subscribe_and_save || false,
      oldestOrderDate: oldest.order_date,
      newestOrderDate: mostRecent.order_date,
    });
  }

  // Sort by most recent order date descending
  result.sort((a, b) => (b.newestOrderDate || "").localeCompare(a.newestOrderDate || ""));
  return result;
}

/**
 * Format a frequencyMonths value for display.
 * <= 18 months: "Every X mo"
 * > 18 months: "Every X yr" (rounded to nearest year)
 * null: ""
 */
function formatFrequency(months) {
  if (months === null || months === undefined) return "";
  if (months <= 18) return `Every ${months} mo`;
  const years = Math.round(months / 12);
  return `Every ${years} yr`;
}

// ---------------------------------------------------------------------------
// Node.js exports (conditional — only active in Node, no-op in browser)
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    get STATUS_RULES() { return STATUS_RULES; },
    get ASSUME_DELIVERED_AFTER_DAYS() { return ASSUME_DELIVERED_AFTER_DAYS; },
    get KNOWN_STATUS_OVERRIDES() { return KNOWN_STATUS_OVERRIDES; },
    _initOrderLogicData,
    WEEKDAY_NAMES,
    MONTH_NAMES,
    hasShipmentId,
    deriveStatus,
    daysSince,
    parseExpectedDelivery,
    toIso,
    sortItems,
    formatDate,
    formatDateNearby,
    formatPrice,
    statusBadgeHtml,
    escHtml,
    orderUrl,
    effectiveStatus,
    ESTIMATED_RETURN_WINDOW_DAYS,
    estimateReturnWindowEnd,
    returnWindowHtml,
    returnPolicyIcon,
    isDecideEligible,
    isMailBackEligible,
    initialYears,
    groupItemsByAsin,
    formatFrequency,
  };
}
