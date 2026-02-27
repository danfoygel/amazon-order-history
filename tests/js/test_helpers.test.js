import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const logic = require("../../order_logic.js");
const {
  escHtml,
  statusBadgeHtml,
  returnPolicyIcon,
  orderUrl,
  returnWindowHtml,
  estimateReturnWindowEnd,
  ESTIMATED_RETURN_WINDOW_DAYS,
  initialYears,
  isDecideEligible,
  isMailBackEligible,
} = logic;

// ---------------------------------------------------------------------------
// escHtml
// ---------------------------------------------------------------------------
describe("escHtml", () => {
  it('escapes "&" to "&amp;"', () => {
    expect(escHtml("A & B")).toBe("A &amp; B");
  });

  it('escapes "<" to "&lt;"', () => {
    expect(escHtml("<div>")).toBe("&lt;div&gt;");
  });

  it('escapes ">" to "&gt;"', () => {
    expect(escHtml("a > b")).toBe("a &gt; b");
  });

  it('escapes double quotes to "&quot;"', () => {
    expect(escHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("returns empty string for null", () => {
    expect(escHtml(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escHtml(undefined)).toBe("");
  });

  it("passes through normal text unchanged", () => {
    expect(escHtml("hello world")).toBe("hello world");
  });

  it("handles multiple special chars together", () => {
    expect(escHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

// ---------------------------------------------------------------------------
// statusBadgeHtml
// ---------------------------------------------------------------------------
describe("statusBadgeHtml", () => {
  it('returns badge-delivered class for "Delivered"', () => {
    const html = statusBadgeHtml("Delivered");
    expect(html).toContain("badge-delivered");
    expect(html).toContain("Delivered");
  });

  it('returns badge-in-transit class for "Shipped"', () => {
    const html = statusBadgeHtml("Shipped");
    expect(html).toContain("badge-in-transit");
    expect(html).toContain("Shipped");
  });

  it('returns badge-pending class for "Ordered"', () => {
    const html = statusBadgeHtml("Ordered");
    expect(html).toContain("badge-pending");
    expect(html).toContain("Ordered");
  });

  it('returns badge-cancelled class for "Cancelled"', () => {
    const html = statusBadgeHtml("Cancelled");
    expect(html).toContain("badge-cancelled");
    expect(html).toContain("Cancelled");
  });

  it('returns badge-return-started class for "Return Started"', () => {
    const html = statusBadgeHtml("Return Started");
    expect(html).toContain("badge-return-started");
    expect(html).toContain("Return Started");
  });

  it('returns badge-return-transit class for "Return in Transit"', () => {
    const html = statusBadgeHtml("Return in Transit");
    expect(html).toContain("badge-return-transit");
    expect(html).toContain("Return in Transit");
  });

  it('returns badge-return-complete class for "Return Complete"', () => {
    const html = statusBadgeHtml("Return Complete");
    expect(html).toContain("badge-return-complete");
    expect(html).toContain("Return Complete");
  });

  it('returns badge-replacement class and "Replacement" label for "Replacement Ordered"', () => {
    const html = statusBadgeHtml("Replacement Ordered");
    expect(html).toContain("badge-replacement");
    expect(html).toContain("Replacement");
    // Label should be "Replacement", not "Replacement Ordered"
    expect(html).not.toContain("Replacement Ordered");
  });

  it('returns badge-pending for unknown status', () => {
    const html = statusBadgeHtml("SomethingElse");
    expect(html).toContain("badge-pending");
    expect(html).toContain("SomethingElse");
  });

  it('returns badge-pending with "Unknown" for null status', () => {
    const html = statusBadgeHtml(null);
    expect(html).toContain("badge-pending");
  });

  it("wraps content in a span element", () => {
    const html = statusBadgeHtml("Delivered");
    expect(html).toMatch(/^<span class="badge badge-delivered">Delivered<\/span>$/);
  });
});

// ---------------------------------------------------------------------------
// returnPolicyIcon
// ---------------------------------------------------------------------------
describe("returnPolicyIcon", () => {
  it('returns badge-free-returns for "free_or_replace"', () => {
    const html = returnPolicyIcon({ return_policy: "free_or_replace" });
    expect(html).toContain("badge-free-returns");
    expect(html).toContain("<svg");
  });

  it('returns badge-no-return for "non_returnable"', () => {
    const html = returnPolicyIcon({ return_policy: "non_returnable" });
    expect(html).toContain("badge-no-return");
    expect(html).toContain("<svg");
  });

  it('returns badge-return-only for "return_only"', () => {
    const html = returnPolicyIcon({ return_policy: "return_only" });
    expect(html).toContain("badge-return-only");
    expect(html).toContain("<svg");
  });

  it("returns empty string for null return_policy", () => {
    expect(returnPolicyIcon({ return_policy: null })).toBe("");
  });

  it("returns empty string for undefined return_policy", () => {
    expect(returnPolicyIcon({})).toBe("");
  });

  it("returns empty string for unknown return_policy", () => {
    expect(returnPolicyIcon({ return_policy: "something_else" })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// orderUrl
// ---------------------------------------------------------------------------
describe("orderUrl", () => {
  it("returns correct Amazon URL for item with order_id", () => {
    const item = { order_id: "112-1234567-8901234" };
    const url = orderUrl(item);
    expect(url).toBe(
      "https://www.amazon.com/gp/your-account/order-details?orderID=112-1234567-8901234"
    );
  });

  it("encodes special characters in order_id", () => {
    const item = { order_id: "abc def" };
    const url = orderUrl(item);
    expect(url).toContain("orderID=abc%20def");
  });

  it("returns null when order_id is missing", () => {
    expect(orderUrl({})).toBeNull();
  });

  it("returns null when order_id is null", () => {
    expect(orderUrl({ order_id: null })).toBeNull();
  });

  it("returns null when order_id is empty string", () => {
    expect(orderUrl({ order_id: "" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// estimateReturnWindowEnd
// ---------------------------------------------------------------------------
describe("estimateReturnWindowEnd", () => {
  it("returns order_date + 33 days", () => {
    expect(estimateReturnWindowEnd("2025-06-01")).toBe("2025-07-04");
  });

  it("handles year boundary", () => {
    expect(estimateReturnWindowEnd("2025-12-10")).toBe("2026-01-12");
  });

  it("returns null for null order_date", () => {
    expect(estimateReturnWindowEnd(null)).toBeNull();
  });

  it("returns null for undefined order_date", () => {
    expect(estimateReturnWindowEnd(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// returnWindowHtml
// ---------------------------------------------------------------------------
describe("returnWindowHtml", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ok badge for Delivered item with future return window (>7 days)", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-ok");
    expect(html).toContain("Return by");
  });

  it("returns warn badge for Delivered item with return window within 7 days", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-15", // 4 days away
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-warn");
    expect(html).toContain("Return by");
  });

  it("returns closed badge for Delivered item with past return window", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-05-01",
      tracking_url: null,
      return_window_end: "2025-06-01", // 10 days past
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-closed");
    expect(html).toContain("Return window closed");
  });

  it("returns empty string for Delivered item without return_window_end", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: null,
    };
    expect(returnWindowHtml(item)).toBe("");
  });

  it('returns ok badge for Return Started item with future deadline (>7 days)', () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-ok");
    expect(html).toContain("Mail back by");
  });

  it("returns warn badge for Return Started item with deadline within 7 days", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-15", // 4 days away
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-warn");
    expect(html).toContain("Mail back by");
  });

  it("returns overdue badge for Return Started item with past deadline", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-05", // 6 days past, but < 30 so not demoted
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-overdue");
    expect(html).toContain("Mail back by");
  });

  it("estimates deadline for Return Started item without return_window_end", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: null,
    };
    const html = returnWindowHtml(item);
    // Estimated: order_date + 33 days = 2025-07-04, ~23 days away → ok badge
    expect(html).toContain("return-badge-ok");
    expect(html).toContain("Mail back by ~");
  });

  it("returns unknown deadline badge when both return_window_end and order_date are null", () => {
    const item = {
      delivery_status: "Return started",
      order_date: null,
      tracking_url: null,
      return_window_end: null,
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("return-badge-warn");
    expect(html).toContain("deadline unknown");
  });

  it("returns empty string for Ordered status", () => {
    const item = {
      delivery_status: "Not yet shipped",
      order_date: "2025-06-10",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    expect(returnWindowHtml(item)).toBe("");
  });

  it("returns empty string for Shipped status", () => {
    const item = {
      delivery_status: "Shipped",
      order_date: "2025-06-10",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    expect(returnWindowHtml(item)).toBe("");
  });

  it("includes days-left hint for Delivered item with deadline 4 days away", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-15", // 4 days away
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("4d left");
  });

  it("uses 'today'/'tomorrow' labels without days-left hint", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-11", // today
    };
    const html = returnWindowHtml(item);
    expect(html).toContain("today");
    expect(html).not.toContain("d left");
  });
});

// ---------------------------------------------------------------------------
// initialYears
// ---------------------------------------------------------------------------
describe("initialYears", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters manifest to years >= cutoff year (3 months back)", () => {
    // June 11, 2025 minus 3 months = March 11, 2025 → cutoff year 2025
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
    expect(initialYears([2026, 2025, 2024, 2023])).toEqual([2026, 2025]);
  });

  it("includes prior year when 3 months back crosses year boundary", () => {
    // February 15, 2025 minus 3 months = November 15, 2024 → cutoff year 2024
    vi.setSystemTime(new Date("2025-02-15T12:00:00"));
    expect(initialYears([2026, 2025, 2024, 2023])).toEqual([2026, 2025, 2024]);
  });

  it("returns empty array for empty manifest", () => {
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
    expect(initialYears([])).toEqual([]);
  });

  it("returns all years if all are recent", () => {
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
    expect(initialYears([2025, 2026])).toEqual([2025, 2026]);
  });
});

// ---------------------------------------------------------------------------
// isDecideEligible
// ---------------------------------------------------------------------------
describe("isDecideEligible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for Delivered item with future return window", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-01",
    };
    expect(isDecideEligible(item)).toBe(true);
  });

  it("returns true for Delivered item with return window ending today", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-06-11",
    };
    expect(isDecideEligible(item)).toBe(true);
  });

  it("returns false for Delivered item with past return window", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-05-01",
      tracking_url: null,
      return_window_end: "2025-06-01",
    };
    expect(isDecideEligible(item)).toBe(false);
  });

  it("returns false for Delivered item without return_window_end", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: null,
    };
    expect(isDecideEligible(item)).toBe(false);
  });

  it("returns false for non-Delivered item even with future return window", () => {
    const item = {
      delivery_status: "Shipped",
      order_date: "2025-06-10",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    expect(isDecideEligible(item)).toBe(false);
  });

  it("returns false for Ordered item", () => {
    const item = {
      delivery_status: "Not yet shipped",
      order_date: "2025-06-10",
      tracking_url: null,
      return_window_end: "2025-07-15",
    };
    expect(isDecideEligible(item)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMailBackEligible
// ---------------------------------------------------------------------------
describe("isMailBackEligible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for Return Started item", () => {
    const item = {
      delivery_status: "Return started",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-01",
    };
    expect(isMailBackEligible(item)).toBe(true);
  });

  it("returns true for Replacement Ordered item", () => {
    const item = {
      delivery_status: "Replacement ordered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-01",
    };
    expect(isMailBackEligible(item)).toBe(true);
  });

  it("returns false for Delivered item", () => {
    const item = {
      delivery_status: "Delivered",
      order_date: "2025-06-01",
      tracking_url: null,
      return_window_end: "2025-07-01",
    };
    expect(isMailBackEligible(item)).toBe(false);
  });

  it("returns false for Shipped item", () => {
    const item = {
      delivery_status: "Shipped",
      order_date: "2025-06-10",
      tracking_url: null,
    };
    expect(isMailBackEligible(item)).toBe(false);
  });

  it("returns false for Cancelled item", () => {
    const item = {
      delivery_status: "Cancelled",
      order_date: "2025-06-01",
      tracking_url: null,
    };
    expect(isMailBackEligible(item)).toBe(false);
  });
});
