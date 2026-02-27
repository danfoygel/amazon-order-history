import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const logic = require("../../order_logic.js");
const { sortItems } = logic;

// ---------------------------------------------------------------------------
// Synthetic test items
// ---------------------------------------------------------------------------
function makeItems() {
  return [
    {
      title: "Item A",
      order_date: "2025-03-15",
      unit_price: 29.99,
      return_window_end: "2025-04-15",
      delivery_status: "Arriving tomorrow",
    },
    {
      title: "Item B",
      order_date: "2025-01-10",
      unit_price: 9.99,
      return_window_end: "2025-02-10",
      delivery_status: "Arriving today",
    },
    {
      title: "Item C",
      order_date: "2025-06-01",
      unit_price: 49.99,
      return_window_end: null,
      delivery_status: "Delivered",
    },
    {
      title: "Item D",
      order_date: "2025-05-20",
      unit_price: 15.00,
      return_window_end: "2025-07-01",
      delivery_status: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// sortItems
// ---------------------------------------------------------------------------
describe("sortItems", () => {
  it("sorts by order_date_asc — oldest first", () => {
    const items = makeItems();
    const sorted = sortItems(items, "order_date_asc");
    expect(sorted.map(i => i.title)).toEqual(["Item B", "Item A", "Item D", "Item C"]);
  });

  it("sorts by order_date_desc — newest first", () => {
    const items = makeItems();
    const sorted = sortItems(items, "order_date_desc");
    expect(sorted.map(i => i.title)).toEqual(["Item C", "Item D", "Item A", "Item B"]);
  });

  it("sorts by price_asc — cheapest first", () => {
    const items = makeItems();
    const sorted = sortItems(items, "price_asc");
    expect(sorted.map(i => i.title)).toEqual(["Item B", "Item D", "Item A", "Item C"]);
  });

  it("sorts by price_desc — most expensive first", () => {
    const items = makeItems();
    const sorted = sortItems(items, "price_desc");
    expect(sorted.map(i => i.title)).toEqual(["Item C", "Item A", "Item D", "Item B"]);
  });

  it("sorts by return_window_asc — earliest deadline first, estimates from order_date", () => {
    const items = makeItems();
    const sorted = sortItems(items, "return_window_asc");
    // Item C has null return_window_end but order_date 2025-06-01 → estimated 2025-07-04
    expect(sorted.map(i => i.title)).toEqual(["Item B", "Item A", "Item D", "Item C"]);
  });

  it("sorts by return_window_asc — null order_date goes last", () => {
    const items = [
      { title: "Has date", return_window_end: "2025-05-01", order_date: "2025-03-01" },
      { title: "No info", return_window_end: null, order_date: null },
      { title: "Estimated", return_window_end: null, order_date: "2025-04-01" },
    ];
    const sorted = sortItems(items, "return_window_asc");
    // Has date (May 1), Estimated (Apr 1 + 33 = May 4), No info (null → last)
    expect(sorted.map(i => i.title)).toEqual(["Has date", "Estimated", "No info"]);
  });

  it("sorts by expected_delivery_asc — earliest delivery first (with frozen time)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-11T12:00:00"));

    const items = [
      { title: "Tomorrow", delivery_status: "Arriving tomorrow" },
      { title: "Today", delivery_status: "Arriving today" },
      { title: "No delivery", delivery_status: null },
      { title: "Saturday", delivery_status: "Arriving Saturday" },
    ];

    const sorted = sortItems(items, "expected_delivery_asc");
    // today (Jun 11) < tomorrow (Jun 12) < Saturday (Jun 14), null last
    expect(sorted.map(i => i.title)).toEqual(["Today", "Tomorrow", "Saturday", "No delivery"]);

    vi.useRealTimers();
  });

  it("preserves original order for unknown sort key", () => {
    const items = makeItems();
    const sorted = sortItems(items, "unknown_sort");
    expect(sorted.map(i => i.title)).toEqual(["Item A", "Item B", "Item C", "Item D"]);
  });

  it("does not mutate the original array", () => {
    const items = makeItems();
    const original = [...items];
    sortItems(items, "price_asc");
    expect(items.map(i => i.title)).toEqual(original.map(i => i.title));
  });

  // Edge cases
  it("handles null order_date values in order_date_asc", () => {
    const items = [
      { title: "No date", order_date: null },
      { title: "Has date", order_date: "2025-06-01" },
    ];
    const sorted = sortItems(items, "order_date_asc");
    // null coerces to "" which sorts before "2025..."
    expect(sorted[0].title).toBe("No date");
    expect(sorted[1].title).toBe("Has date");
  });

  it("handles null unit_price values in price_asc", () => {
    const items = [
      { title: "No price", unit_price: null },
      { title: "Has price", unit_price: 10.00 },
    ];
    const sorted = sortItems(items, "price_asc");
    // null coerces to 0 via ??
    expect(sorted[0].title).toBe("No price");
    expect(sorted[1].title).toBe("Has price");
  });

  it("handles empty array", () => {
    expect(sortItems([], "price_asc")).toEqual([]);
  });

  it("handles single item", () => {
    const items = [{ title: "Only one", unit_price: 5 }];
    const sorted = sortItems(items, "price_desc");
    expect(sorted).toHaveLength(1);
    expect(sorted[0].title).toBe("Only one");
  });
});
