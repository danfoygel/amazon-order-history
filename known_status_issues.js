// Items with degraded status data that cannot be fixed (old orders where
// Amazon returns "Cannot display current status").  effectiveStatus() in
// order_logic.js uses the mapped status as an override when deriveStatus()
// returns "Unknown".
//
// Browser: loaded as a <script> tag; KNOWN_STATUS_ISSUES_DATA becomes a global.
// Node.js: loaded via require(); exported on module.exports.
// Python:  parsed by extracting the JSON between the marker comments.

// --- BEGIN JSON ---
var KNOWN_STATUS_ISSUES_DATA = {
  "items": {
    "002-0752694-0704223__0810933438": "Delivered",
    "002-1278437-9185049__B018YRBQSK": "Delivered",
    "002-4550913-9579466__B00KAS5GC4": "Delivered",
    "002-6546693-1689058__B018YRBQSK": "Delivered",
    "102-2801164-0301831__B018YRBQSK": "Delivered",
    "102-3810232-4721855__B018YRBQSK": "Delivered",
    "102-9663685-2937046__B00WOQSKMS": "Delivered",
    "105-0085412-9105856__B000UQ7XMM": "Delivered",
    "105-5181304-2147459__B000P8EIDW": "Delivered",
    "112-5410131-7261816__B01ACPT2LU": "Delivered",
    "112-5865177-6019465__1579129714": "Delivered",
    "112-9146790-2063428__B00004RJXI": "Delivered",
    "113-2390721-0570615__B001W02QYU": "Delivered",
    "114-0892595-8208261__B086H2GVDM": "Delivered",
    "114-6272914-9649818__B00004RJXI": "Delivered",
    "114-7496334-5630662__B086J9LGGZ": "Delivered",
    "114-8150581-9581038__078942049X": "Delivered"
  }
};
// --- END JSON ---

if (typeof module !== "undefined" && module.exports) {
  module.exports = KNOWN_STATUS_ISSUES_DATA;
}
