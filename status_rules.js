// Shared status derivation rules used by order_logic.js, validate_data.js,
// and fetch_orders.py.  Each entry maps a lowercase substring pattern to a
// derived status category.
//
// Browser: loaded as a <script> tag; STATUS_RULES_DATA becomes a global.
// Node.js: loaded via require(); exported on module.exports.
// Python:  parsed by extracting the JSON between the marker comments.

// --- BEGIN JSON ---
var STATUS_RULES_DATA = {
  "assume_delivered_after_days": 90,
  "rules": [
    ["cancelled",              "Cancelled"],
    ["canceled",               "Cancelled"],
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
    ["delivered",              "Delivered"],
    ["out for delivery",       "Shipped"],
    ["on the way",             "Shipped"],
    ["not yet shipped",        "Ordered"],
    ["shipped",                "Shipped"],
    ["in transit",             "Shipped"],
    ["now arriving",           "Shipped"],
    ["arriving",               "Shipped"],
    ["preparing for shipment", "Ordered"],
    ["order placed",           "Ordered"],
    ["payment pending",        "Ordered"]
  ]
};
// --- END JSON ---

if (typeof module !== "undefined" && module.exports) {
  module.exports = STATUS_RULES_DATA;
}
