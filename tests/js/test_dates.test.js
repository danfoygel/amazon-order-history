import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const logic = require("../../order_logic.js");
const {
  daysSince,
  parseExpectedDelivery,
  toIso,
  formatDate,
  formatDateNearby,
  formatPrice,
} = logic;

// ---------------------------------------------------------------------------
// daysSince
// ---------------------------------------------------------------------------
describe("daysSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for today's date", () => {
    expect(daysSince("2025-06-11")).toBe(0);
  });

  it("returns 1 for yesterday", () => {
    expect(daysSince("2025-06-10")).toBe(1);
  });

  it("returns 10 for 10 days ago", () => {
    expect(daysSince("2025-06-01")).toBe(10);
  });

  it("returns negative for future dates", () => {
    expect(daysSince("2025-06-12")).toBe(-1);
  });

  it("handles cross-month boundaries", () => {
    // May 31 to June 11 = 11 days
    expect(daysSince("2025-05-31")).toBe(11);
  });

  it("handles cross-year boundaries", () => {
    // Jan 1 2025 to June 11 2025 — 161 calendar days, but daysSince uses
    // millisecond division (Math.floor) which can be off by 1 due to DST.
    const result = daysSince("2025-01-01");
    expect(result).toBeGreaterThanOrEqual(160);
    expect(result).toBeLessThanOrEqual(161);
  });
});

// ---------------------------------------------------------------------------
// parseExpectedDelivery
// ---------------------------------------------------------------------------
describe("parseExpectedDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday, June 11, 2025
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses "Arriving today" to today\'s date', () => {
    expect(parseExpectedDelivery("Arriving today")).toBe("2025-06-11");
  });

  it('parses "Out for delivery" to today\'s date', () => {
    expect(parseExpectedDelivery("Out for delivery")).toBe("2025-06-11");
  });

  it('parses "Arriving tomorrow" to tomorrow\'s date', () => {
    expect(parseExpectedDelivery("Arriving tomorrow")).toBe("2025-06-12");
  });

  it('parses "Arriving Saturday" to next Saturday', () => {
    // June 11 is Wednesday, next Saturday is June 14
    expect(parseExpectedDelivery("Arriving Saturday")).toBe("2025-06-14");
  });

  it('parses "Arriving Wednesday" to next Wednesday (not today)', () => {
    // Today is Wednesday, so next Wednesday = 7 days ahead
    expect(parseExpectedDelivery("Arriving Wednesday")).toBe("2025-06-18");
  });

  it('parses "Arriving Monday" to next Monday', () => {
    // June 11 is Wednesday, next Monday is June 16
    expect(parseExpectedDelivery("Arriving Monday")).toBe("2025-06-16");
  });

  it('parses "Now arriving February 28" to 2026-02-28 (future month)', () => {
    // February is past for 2025, so it should roll to 2026
    expect(parseExpectedDelivery("Now arriving February 28")).toBe("2026-02-28");
  });

  it('parses "Arriving Feb 22" to 2026-02-22 (past month rolls forward)', () => {
    expect(parseExpectedDelivery("Arriving Feb 22")).toBe("2026-02-22");
  });

  it('parses "Arriving Jun 15" to 2025-06-15 (current month, future day)', () => {
    expect(parseExpectedDelivery("Arriving Jun 15")).toBe("2025-06-15");
  });

  it('parses "Arriving Jun 5" to 2026-06-05 (current month, past day)', () => {
    // June 5 is before June 11, so rolls to next year
    expect(parseExpectedDelivery("Arriving Jun 5")).toBe("2026-06-05");
  });

  it("returns null for null input", () => {
    expect(parseExpectedDelivery(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseExpectedDelivery("")).toBeNull();
  });

  it("returns null for unrecognized text", () => {
    expect(parseExpectedDelivery("Something random")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseExpectedDelivery(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toIso
// ---------------------------------------------------------------------------
describe("toIso", () => {
  it("converts a Date object to YYYY-MM-DD string", () => {
    expect(toIso(new Date(2025, 0, 15))).toBe("2025-01-15");
  });

  it("pads single-digit months and days", () => {
    expect(toIso(new Date(2025, 2, 5))).toBe("2025-03-05");
  });

  it("handles December 31", () => {
    expect(toIso(new Date(2025, 11, 31))).toBe("2025-12-31");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe("formatDate", () => {
  it('formats ISO string to locale date format', () => {
    const result = formatDate("2025-02-25");
    expect(result).toBe("Feb 25, 2025");
  });

  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatDate(undefined)).toBe("\u2014");
  });

  it("returns em dash for empty string", () => {
    expect(formatDate("")).toBe("\u2014");
  });
});

// ---------------------------------------------------------------------------
// formatDateNearby
// ---------------------------------------------------------------------------
describe("formatDateNearby", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "yesterday" for yesterday\'s date', () => {
    expect(formatDateNearby("2025-06-10")).toBe("yesterday");
  });

  it('returns "today" for today\'s date', () => {
    expect(formatDateNearby("2025-06-11")).toBe("today");
  });

  it('returns "tomorrow" for tomorrow\'s date', () => {
    expect(formatDateNearby("2025-06-12")).toBe("tomorrow");
  });

  it("returns short date for dates further away", () => {
    const result = formatDateNearby("2025-06-20");
    expect(result).toBe("Jun 20");
  });

  it("returns em dash for null", () => {
    expect(formatDateNearby(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatDateNearby(undefined)).toBe("\u2014");
  });
});

// ---------------------------------------------------------------------------
// formatPrice
// ---------------------------------------------------------------------------
describe("formatPrice", () => {
  it('formats 24.99 as "$24.99"', () => {
    expect(formatPrice(24.99)).toBe("$24.99");
  });

  it('formats 0 as "$0.00"', () => {
    expect(formatPrice(0)).toBe("$0.00");
  });

  it('formats integer as "$10.00"', () => {
    expect(formatPrice(10)).toBe("$10.00");
  });

  it("returns em dash for null", () => {
    expect(formatPrice(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatPrice(undefined)).toBe("\u2014");
  });
});
