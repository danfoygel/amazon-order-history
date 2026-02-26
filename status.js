// ---------------------------------------------------------------------------
// Status derivation — shared between the browser app and the CLI validator.
//
// Browser: loaded as a plain <script>; functions become globals.
// Node.js: loaded via require(); functions are exported on module.exports.
// ---------------------------------------------------------------------------

const STATUS_RULES = [
  // Cancelled
  ["cancelled",              "Cancelled"],
  ["canceled",               "Cancelled"],
  // Return states
  ["return complete",        "Return Complete"],
  ["return received",        "Return Complete"],
  ["replacement complete",   "Return Complete"],
  ["return request approved", "Return Started"],
  ["return requested",       "Return Started"],
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
// Node.js exports (no-op when loaded as a browser <script>)
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_RULES,
    ASSUME_DELIVERED_AFTER_DAYS,
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
