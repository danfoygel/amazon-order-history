"use strict";

// ---------------------------------------------------------------------------
// order_logic.js — Pure logic functions extracted from app.js for testability.
//
// In the browser, this file is loaded via <script> before app.js, so all
// functions are available as globals.  In Node.js tests, the conditional
// module.exports at the bottom makes everything importable via require().
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status derivation — rules loaded from status_rules.json (single source of
// truth shared with status.js, validate_data.js, and fetch_orders.py).
// ---------------------------------------------------------------------------
const _rulesData = require("./status_rules.json");
const STATUS_RULES = _rulesData.rules;
const ASSUME_DELIVERED_AFTER_DAYS = _rulesData.assume_delivered_after_days;

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
    if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
    return "Ordered";
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
  const status = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
  if ((status === "Return Started" || status === "Replacement Ordered") && item.return_window_end) {
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
    if (!item.return_window_end) return `<span class="badge return-badge-warn">⚠ Mail back — deadline unknown</span>`;
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    const dateStr = formatDateNearby(item.return_window_end);
    const daysHint = (daysLeft >= 0 && daysLeft <= 7 && !["today", "tomorrow", "yesterday"].includes(dateStr))
      ? ` (${daysLeft}d left)` : "";
    if (daysLeft < 0) {
      return `<span class="badge return-badge-overdue">Mail back by ${dateStr}</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Mail back by ${dateStr}${daysHint}</span>`;
    }
    return `<span class="badge return-badge-ok">Mail back by ${dateStr}</span>`;
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
// Graph constants
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
};

// ---------------------------------------------------------------------------
// Node.js exports (conditional — only active in Node, no-op in browser)
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_RULES,
    ASSUME_DELIVERED_AFTER_DAYS,
    WEEKDAY_NAMES,
    MONTH_NAMES,
    GRAPH_STATUSES,
    GRAPH_STATUS_LABELS,
    GRAPH_STATUS_COLORS,
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
    returnWindowHtml,
    returnPolicyIcon,
    isDecideEligible,
    isMailBackEligible,
    initialYears,
  };
}
