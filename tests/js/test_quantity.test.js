import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const logic = require("../../order_logic.js");
const { groupItemsByAsin, formatFrequency } = logic;

function makeItem(overrides) {
  return {
    item_id: "111-0000000-0000000__B00TEST001",
    order_id: "111-0000000-0000000",
    order_date: "2025-01-01",
    title: "Test Item",
    asin: "B00TEST001",
    quantity: 1,
    unit_price: 9.99,
    total_price: 9.99,
    item_link: "https://www.amazon.com/dp/B00TEST001",
    image_link: "https://example.com/img.jpg",
    carrier: "Amazon",
    tracking_url: "",
    delivery_status: "Delivered",
    return_window_end: null,
    return_policy: "free_or_replace",
    return_status: "none",
    return_initiated_date: null,
    return_notes: "",
    subscribe_and_save: false,
    ...overrides,
  };
}

describe("groupItemsByAsin", () => {
  it("groups items by ASIN and sums quantities", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", order_date: "2025-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "BBB", item_id: "BBB__B001", order_date: "2025-06-01", quantity: 3 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].asin).toBe("B001");
    expect(groups[0].totalQuantity).toBe(4);
  });

  it("filters out items with only a single order", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups).toHaveLength(0);
  });

  it("filters out single orders even with quantity >= 2", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", quantity: 5 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups).toHaveLength(0);
  });

  it("uses the most recent order for title, image, and item_link", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", order_date: "2024-01-01", title: "Old Name", image_link: "old.jpg", item_link: "old_link", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "BBB", item_id: "BBB__B001", order_date: "2025-06-01", title: "New Name", image_link: "new.jpg", item_link: "new_link", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].title).toBe("New Name");
    expect(groups[0].image_link).toBe("new.jpg");
    expect(groups[0].item_link).toBe("new_link");
  });

  it("sorts results by most recent order date descending", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2024-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A1b", item_id: "A1b__B001", order_date: "2025-03-01", quantity: 1 }),
      makeItem({ asin: "B002", order_id: "A2", item_id: "A2__B002", order_date: "2024-06-01", quantity: 3 }),
      makeItem({ asin: "B002", order_id: "A2b", item_id: "A2b__B002", order_date: "2025-09-01", quantity: 2 }),
      makeItem({ asin: "B003", order_id: "A3", item_id: "A3__B003", order_date: "2024-02-01", quantity: 1 }),
      makeItem({ asin: "B003", order_id: "A3b", item_id: "A3b__B003", order_date: "2025-06-01", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    // B002 newest=2025-09, B003 newest=2025-06, B001 newest=2025-03
    expect(groups.map(g => g.asin)).toEqual(["B002", "B003", "B001"]);
  });

  it("uses subscribe_and_save from the most recent order", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", order_date: "2025-01-01", subscribe_and_save: true, quantity: 1 }),
      makeItem({ asin: "B001", order_id: "BBB", item_id: "BBB__B001", order_date: "2025-06-01", subscribe_and_save: false, quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    // Most recent order (BBB, 2025-06) has S&S=false
    expect(groups[0].subscribe_and_save).toBe(false);
  });

  it("shows subscribe_and_save true when most recent order used it", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", order_date: "2025-01-01", subscribe_and_save: false, quantity: 1 }),
      makeItem({ asin: "B001", order_id: "BBB", item_id: "BBB__B001", order_date: "2025-06-01", subscribe_and_save: true, quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].subscribe_and_save).toBe(true);
  });

  // --- Frequency calculation ---

  it("calculates consumption frequency based on quantity and time span", () => {
    // 1 on Jan 1, 3 on Jun 1, 1 on Sep 1 => 5 total, 8 months span => 8/4 = 2 mo
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2025-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-06-01", quantity: 3 }),
      makeItem({ asin: "B001", order_id: "A3", item_id: "A3__B001", order_date: "2025-09-01", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].frequencyMonths).toBe(2);
  });

  it("filters out items where all orders are on the same date", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "AAA", item_id: "AAA__B001", order_date: "2025-01-01", quantity: 2 }),
      makeItem({ asin: "B001", order_id: "BBB", item_id: "BBB__B001", order_date: "2025-01-01", quantity: 3 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups).toHaveLength(0);
  });

  it("returns frequency even when value exceeds 12 months", () => {
    // 1 on Jan 2023, 1 on Jan 2025 => 2 total, 24 months => 24/1 = 24 mo
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2023-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-01-01", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].frequencyMonths).toBe(24);
  });

  it("returns large frequency values for very infrequent purchases", () => {
    // 1 on Jan 2020, 1 on Jan 2025 => 2 total, ~60 months => 60/1 = 60 mo
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2020-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-01-01", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].frequencyMonths).toBe(60);
  });

  it("rounds frequency to nearest whole month", () => {
    // 1 on Jan 1, 1 on Apr 15 => 2 total, ~3.5 months => 3.5/1 = 3.5 => rounds to 3
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2025-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-04-15", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].frequencyMonths).toBe(3);
  });

  it("clamps frequency minimum to 1 month", () => {
    // Many orders in a short period
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2025-01-01", quantity: 5 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-01-15", quantity: 5 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].frequencyMonths).toBe(1);
  });

  it("keeps the most recent unit_price", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2024-01-01", unit_price: 5.99, quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-06-01", unit_price: 7.99, quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].unit_price).toBe(7.99);
  });

  it("handles items with null unit_price by using whatever is available", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2024-01-01", unit_price: 5.99, quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-06-01", unit_price: null, quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].unit_price).toBe(5.99);
  });

  it("handles multiple ASINs correctly", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2025-01-01", quantity: 2 }),
      makeItem({ asin: "B002", order_id: "A2", item_id: "A2__B002", order_date: "2025-03-01", quantity: 3 }),
      makeItem({ asin: "B001", order_id: "A3", item_id: "A3__B001", order_date: "2025-02-01", quantity: 1 }),
      makeItem({ asin: "B002", order_id: "A4", item_id: "A4__B002", order_date: "2025-04-01", quantity: 2 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups).toHaveLength(2);
    const b002 = groups.find(g => g.asin === "B002");
    const b001 = groups.find(g => g.asin === "B001");
    expect(b002.totalQuantity).toBe(5);
    expect(b001.totalQuantity).toBe(3);
    // Sorted by newest order date: B002 (2025-04) before B001 (2025-02)
    expect(groups[0].asin).toBe("B002");
  });

  it("returns orderCount with the number of distinct orders", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2025-01-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-06-01", quantity: 3 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].orderCount).toBe(2);
  });

  // --- Date range ---

  it("includes oldest and newest order dates", () => {
    const items = [
      makeItem({ asin: "B001", order_id: "A1", item_id: "A1__B001", order_date: "2024-03-15", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A2", item_id: "A2__B001", order_date: "2025-06-01", quantity: 1 }),
      makeItem({ asin: "B001", order_id: "A3", item_id: "A3__B001", order_date: "2024-11-20", quantity: 1 }),
    ];
    const groups = groupItemsByAsin(items);
    expect(groups[0].oldestOrderDate).toBe("2024-03-15");
    expect(groups[0].newestOrderDate).toBe("2025-06-01");
  });
});

describe("formatFrequency", () => {
  it("returns empty string for null", () => {
    expect(formatFrequency(null)).toBe("");
  });

  it("formats months <= 18 as 'Every X mo'", () => {
    expect(formatFrequency(1)).toBe("Every 1 mo");
    expect(formatFrequency(6)).toBe("Every 6 mo");
    expect(formatFrequency(12)).toBe("Every 12 mo");
    expect(formatFrequency(18)).toBe("Every 18 mo");
  });

  it("rounds to nearest year above 18 months", () => {
    expect(formatFrequency(19)).toBe("Every 2 yr");
    expect(formatFrequency(24)).toBe("Every 2 yr");
    expect(formatFrequency(30)).toBe("Every 3 yr");
    expect(formatFrequency(36)).toBe("Every 3 yr");
  });

  it("rounds 21 months to 2 yr", () => {
    expect(formatFrequency(21)).toBe("Every 2 yr");
  });

  it("rounds 42 months to 4 yr", () => {
    expect(formatFrequency(42)).toBe("Every 4 yr");
  });

  it("handles edge case of 59 months (rounds to 5 yr)", () => {
    expect(formatFrequency(59)).toBe("Every 5 yr");
  });
});
