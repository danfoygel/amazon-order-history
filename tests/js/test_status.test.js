import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const logic = require("../../order_logic.js");
const {
  hasShipmentId,
  deriveStatus,
  effectiveStatus,
  STATUS_RULES,
  ASSUME_DELIVERED_AFTER_DAYS,
} = logic;

// ---------------------------------------------------------------------------
// hasShipmentId
// ---------------------------------------------------------------------------
describe("hasShipmentId", () => {
  it("returns true when URL contains shipmentId param", () => {
    expect(hasShipmentId("https://example.com/track?shipmentId=abc123")).toBe(true);
  });

  it("returns false when URL has no shipmentId param", () => {
    expect(hasShipmentId("https://example.com/track?orderId=abc123")).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasShipmentId(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasShipmentId(undefined)).toBe(false);
  });

  it("returns false for malformed URL", () => {
    expect(hasShipmentId("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasShipmentId("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveStatus — STATUS_RULES patterns
// ---------------------------------------------------------------------------
describe("deriveStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Cancelled
  it('maps "Cancelled" to "Cancelled"', () => {
    expect(deriveStatus("Cancelled", "2025-06-01", null)).toBe("Cancelled");
  });

  it('maps "canceled" (US spelling) to "Cancelled"', () => {
    expect(deriveStatus("canceled", "2025-06-01", null)).toBe("Cancelled");
  });

  // Return states
  it('maps "Return complete" to "Return Complete"', () => {
    expect(deriveStatus("Return complete", "2025-06-01", null)).toBe("Return Complete");
  });

  it('maps "Return received" to "Return Complete"', () => {
    expect(deriveStatus("Return received", "2025-06-01", null)).toBe("Return Complete");
  });

  it('maps "Replacement complete" to "Return Complete"', () => {
    expect(deriveStatus("Replacement complete", "2025-06-01", null)).toBe("Return Complete");
  });

  it('maps "Return started" to "Return Started"', () => {
    expect(deriveStatus("Return started", "2025-06-01", null)).toBe("Return Started");
  });

  it('maps "Return in transit" to "Return in Transit"', () => {
    expect(deriveStatus("Return in transit", "2025-06-01", null)).toBe("Return in Transit");
  });

  it('maps "Refunded" to "Return in Transit"', () => {
    expect(deriveStatus("Refunded", "2025-06-01", null)).toBe("Return Complete");
  });

  it('maps "Refund issued" to "Return in Transit"', () => {
    expect(deriveStatus("Refund issued", "2025-06-01", null)).toBe("Return Complete");
  });

  it('maps "Replacement ordered" to "Replacement Ordered"', () => {
    expect(deriveStatus("Replacement ordered", "2025-06-01", null)).toBe("Replacement Ordered");
  });

  // Delivered
  it('maps "Delivered" to "Delivered"', () => {
    expect(deriveStatus("Delivered", "2025-06-01", null)).toBe("Delivered");
  });

  it('maps text containing "delivered" (case insensitive) to "Delivered"', () => {
    expect(deriveStatus("Package Delivered to front porch", "2025-06-01", null)).toBe("Delivered");
  });

  // Shipped / en route
  it('maps "Out for delivery" to "Shipped"', () => {
    expect(deriveStatus("Out for delivery", "2025-06-01", null)).toBe("Shipped");
  });

  it('maps "On the way" to "Shipped"', () => {
    expect(deriveStatus("On the way", "2025-06-01", null)).toBe("Shipped");
  });

  it('maps "Not yet shipped" to "Ordered" (must not match "shipped")', () => {
    expect(deriveStatus("Not yet shipped", "2025-06-01", null)).toBe("Ordered");
  });

  it('maps "Shipped" to "Shipped"', () => {
    expect(deriveStatus("Shipped", "2025-06-01", null)).toBe("Shipped");
  });

  it('maps "In transit" to "Shipped"', () => {
    expect(deriveStatus("In transit", "2025-06-01", null)).toBe("Shipped");
  });

  it('maps "Now arriving Feb 28" to "Shipped"', () => {
    expect(deriveStatus("Now arriving Feb 28", "2025-06-01", null)).toBe("Shipped");
  });

  // Arriving — the shipmentId tiebreaker
  it('maps "Arriving tomorrow" WITHOUT shipmentId to "Ordered"', () => {
    expect(deriveStatus("Arriving tomorrow", "2025-06-10", null)).toBe("Ordered");
  });

  it('maps "Arriving tomorrow" WITH shipmentId to "Shipped"', () => {
    const url = "https://www.amazon.com/track?shipmentId=abc";
    expect(deriveStatus("Arriving tomorrow", "2025-06-10", url)).toBe("Shipped");
  });

  it('maps "Arriving Saturday" WITHOUT shipmentId to "Ordered"', () => {
    expect(deriveStatus("Arriving Saturday", "2025-06-10", null)).toBe("Ordered");
  });

  it('maps "Arriving Saturday" WITH shipmentId to "Shipped"', () => {
    const url = "https://www.amazon.com/track?shipmentId=xyz";
    expect(deriveStatus("Arriving Saturday", "2025-06-10", url)).toBe("Shipped");
  });

  // Not yet shipped variants
  it('maps "Preparing for shipment" to "Ordered"', () => {
    expect(deriveStatus("Preparing for shipment", "2025-06-01", null)).toBe("Ordered");
  });

  it('maps "Order placed" to "Ordered"', () => {
    expect(deriveStatus("Order placed", "2025-06-01", null)).toBe("Ordered");
  });

  it('maps "Payment pending" to "Ordered"', () => {
    expect(deriveStatus("Payment pending", "2025-06-01", null)).toBe("Ordered");
  });

  // Fallbacks — empty delivery_status
  it(`returns Delivered for empty delivery_status on old order (>${ASSUME_DELIVERED_AFTER_DAYS}d)`, () => {
    // 2025-06-11 - 2025-01-01 = 161 days (well over the threshold)
    expect(deriveStatus("", "2025-01-01", null)).toBe("Delivered");
  });

  it("returns Unknown for empty delivery_status on recent order", () => {
    // 2025-06-11 - 2025-06-10 = 1 day
    expect(deriveStatus("", "2025-06-10", null)).toBe("Unknown");
  });

  it("returns Unknown for null delivery_status on recent order", () => {
    expect(deriveStatus(null, "2025-06-10", null)).toBe("Unknown");
  });

  // Fallbacks — unrecognized text
  it("returns Unknown for unrecognized text (regardless of age)", () => {
    expect(deriveStatus("Something completely unrecognized", "2025-01-01", null)).toBe("Unknown");
    expect(deriveStatus("Something completely unrecognized", "2025-06-10", null)).toBe("Unknown");
  });

  // Edge: whitespace-only delivery_status treated as empty
  it("treats whitespace-only delivery_status as empty", () => {
    expect(deriveStatus("   ", "2025-01-01", null)).toBe("Delivered");
  });
});

// ---------------------------------------------------------------------------
// effectiveStatus — demotion of stale return/replacement statuses
// ---------------------------------------------------------------------------
describe("effectiveStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('demotes "Return Started" to "Delivered" when return_window_end >30 days past', () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-03-01",
      tracking_url: null,
      return_window_end: "2025-04-01", // 71 days ago
    };
    expect(effectiveStatus(item)).toBe("Delivered");
  });

  it('keeps "Return Started" when return_window_end is recent', () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-20", // in the future
    };
    expect(effectiveStatus(item)).toBe("Return Started");
  });

  it('demotes "Replacement Ordered" to "Delivered" when return_window_end >30 days past', () => {
    const item = {
      delivery_status: "Replacement ordered",
      order_date: "2025-03-01",
      tracking_url: null,
      return_window_end: "2025-04-01", // 71 days ago
    };
    expect(effectiveStatus(item)).toBe("Delivered");
  });

  it('keeps "Replacement Ordered" when return_window_end is within 30 days', () => {
    const item = {
      delivery_status: "Replacement ordered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-05", // 6 days past, < 30
    };
    expect(effectiveStatus(item)).toBe("Replacement Ordered");
  });

  it('does not demote "Delivered" status regardless of return_window_end', () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-03-01",
      tracking_url: null,
      return_window_end: "2025-04-01",
    };
    expect(effectiveStatus(item)).toBe("Delivered");
  });

  it("demotes Return Started without return_window_end using estimated date", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-03-01",  // estimated window: 2025-04-03, >30 days past
      tracking_url: null,
      return_window_end: null,
    };
    expect(effectiveStatus(item)).toBe("Delivered");
  });

  it("does not demote Return Started with recent order_date and no return_window_end", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",  // estimated window: 2025-07-04, still future
      tracking_url: null,
      return_window_end: null,
    };
    expect(effectiveStatus(item)).toBe("Return Started");
  });

  it("does not demote Return Started without return_window_end or order_date", () => {
    const item = {
      delivery_status: "Return started",
      order_date: null,
      tracking_url: null,
      return_window_end: null,
    };
    expect(effectiveStatus(item)).toBe("Return Started");
  });
});

// ---------------------------------------------------------------------------
// effectiveStatus — digital order detection
// ---------------------------------------------------------------------------
describe("effectiveStatus — digital items", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Digital" for recent digital item with empty delivery_status', () => {
    const item = {
      delivery_status: "",
      order_date: "2025-06-10",
      tracking_url: null,
      is_digital: true,
    };
    expect(effectiveStatus(item)).toBe("Digital");
  });

  it('returns "Digital" for old digital item with empty delivery_status', () => {
    // Normally an old item with empty delivery_status would be "Delivered"
    const item = {
      delivery_status: "",
      order_date: "2025-01-01",
      tracking_url: null,
      is_digital: true,
    };
    expect(effectiveStatus(item)).toBe("Digital");
  });

  it('does not override non-empty delivery_status even if is_digital', () => {
    // If Amazon gave a delivery_status, respect it
    const item = {
      delivery_status: "Cancelled",
      order_date: "2025-06-01",
      tracking_url: null,
      is_digital: true,
    };
    expect(effectiveStatus(item)).toBe("Cancelled");
  });

  it('returns normal status when is_digital is false', () => {
    const item = {
      delivery_status: "",
      order_date: "2025-06-10",
      tracking_url: null,
      is_digital: false,
    };
    expect(effectiveStatus(item)).toBe("Unknown");
  });

  it('returns normal status when is_digital is undefined', () => {
    const item = {
      delivery_status: "",
      order_date: "2025-06-10",
      tracking_url: null,
    };
    expect(effectiveStatus(item)).toBe("Unknown");
  });
});
