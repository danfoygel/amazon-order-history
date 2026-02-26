// ---------------------------------------------------------------------------
// Status derivation — shared between the browser app and the CLI validator.
//
// Rules are defined in status_rules.json (single source of truth, also used
// by fetch_orders.py).
//
// Known-issue overrides are loaded from data/known_status_issues.json so that
// items with degraded Amazon data get an explicit status instead of "Unknown".
//
// Browser: loaded as a plain <script>; functions become globals.
// Node.js: loaded via require(); functions are exported on module.exports.
// ---------------------------------------------------------------------------

const _rulesData = (typeof require !== "undefined")
  ? require("./status_rules.json")
  : (function() {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "status_rules.json", false);
      xhr.send();
      return JSON.parse(xhr.responseText);
    })();

const STATUS_RULES = _rulesData.rules;
const ASSUME_DELIVERED_AFTER_DAYS = _rulesData.assume_delivered_after_days;

// Load known-status overrides (item_id → status).  Gracefully returns {} if
// the file is absent (e.g. fresh clone without a data/ directory).
const _knownStatusData = (typeof require !== "undefined")
  ? (function() {
      try { return require("./data/known_status_issues.json"); }
      catch { return {}; }
    })()
  : (function() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "data/known_status_issues.json", false);
        xhr.send();
        if (xhr.status === 200) return JSON.parse(xhr.responseText);
      } catch {}
      return {};
    })();

const KNOWN_STATUS_OVERRIDES = _knownStatusData.items || {};

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

// In the browser, order_logic.js (loaded first) already provides daysSince,
// WEEKDAY_NAMES, MONTH_NAMES, parseExpectedDelivery, and toIso as globals.
// In Node.js (validate_data.js), order_logic.js is not pre-loaded, so we
// pull them in here.  We use Object.assign to avoid var/const hoisting
// conflicts with order_logic.js's const declarations in the browser.
if (typeof require !== "undefined") {
  Object.assign(globalThis, (function() {
    var ol = require("./order_logic.js");
    return { daysSince: ol.daysSince, WEEKDAY_NAMES: ol.WEEKDAY_NAMES,
             MONTH_NAMES: ol.MONTH_NAMES, parseExpectedDelivery: ol.parseExpectedDelivery,
             toIso: ol.toIso };
  })());
}

function effectiveStatus(item) {
  let status = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
  // Apply known-issue overrides for items with degraded status data
  if (status === "Unknown" && item.item_id && KNOWN_STATUS_OVERRIDES[item.item_id]) {
    status = KNOWN_STATUS_OVERRIDES[item.item_id];
  }
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
// Node.js exports (no-op when loaded as a browser <script>)
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_RULES,
    ASSUME_DELIVERED_AFTER_DAYS,
    KNOWN_STATUS_OVERRIDES,
    hasShipmentId,
    deriveStatus,
    daysSince,
    WEEKDAY_NAMES,
    MONTH_NAMES,
    parseExpectedDelivery,
    toIso,
    effectiveStatus,
  };
}
