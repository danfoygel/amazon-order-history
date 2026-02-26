"""End-to-end integration test for the data transformation pipeline.

Tests the flow: build_items_from_orders -> write_output -> load_existing_items
without mocking the full main() function and its login/session complexity.
"""

import datetime
import json
import os
from unittest.mock import Mock

import pytest
from conftest import make_order, make_shipment, make_item
from fetch_orders import (
    build_items_from_orders,
    write_output,
    load_existing_items,
    write_manifest,
    _preserve_return_window,
)


def _make_test_orders():
    """Create ~5 mock orders with various statuses and configurations."""
    # Order 1: Simple single-item delivered order
    order1 = make_order(
        order_number="111-0000001-0000001",
        order_date=datetime.date(2025, 6, 1),
        grand_total=15.99,
        shipments=[
            make_shipment(
                delivery_status="Delivered June 3, 2025",
                tracking_link="https://www.ups.com/track?num=1Z001",
                items=[
                    make_item(
                        title="USB-C Cable",
                        price=15.99,
                        quantity=1,
                        link="https://www.amazon.com/dp/B0USBCABL1",
                    ),
                ],
            ),
        ],
    )

    # Order 2: Multi-item order with two shipments
    order2 = make_order(
        order_number="111-0000002-0000002",
        order_date=datetime.date(2025, 6, 10),
        grand_total=45.97,
        shipments=[
            make_shipment(
                delivery_status="Delivered June 12, 2025",
                tracking_link="https://www.fedex.com/track?num=FX002",
                items=[
                    make_item(
                        title="Wireless Mouse",
                        price=29.99,
                        quantity=1,
                        link="https://www.amazon.com/dp/B0WIRMOUSE",
                    ),
                ],
            ),
            make_shipment(
                delivery_status="Delivered June 13, 2025",
                tracking_link="https://track.amazon.com/tracking/AMZ003",
                items=[
                    make_item(
                        title="Mouse Pad",
                        price=7.99,
                        quantity=2,
                        link="https://www.amazon.com/dp/B0MOUSEPAD",
                    ),
                ],
            ),
        ],
    )

    # Order 3: Subscribe & Save order
    order3 = make_order(
        order_number="111-0000003-0000003",
        order_date=datetime.date(2025, 7, 1),
        grand_total=12.99,
        subscription_discount="5%",
        shipments=[
            make_shipment(
                delivery_status="Delivered July 3, 2025",
                tracking_link="https://www.usps.com/track?num=USPS004",
                items=[
                    make_item(
                        title="Protein Bars 12-Pack",
                        price=12.99,
                        quantity=1,
                        link="https://www.amazon.com/dp/B0PROTBAR0",
                    ),
                ],
            ),
        ],
    )

    # Order 4: Item without ASIN (e.g., gift card)
    order4 = make_order(
        order_number="111-0000004-0000004",
        order_date=datetime.date(2025, 7, 15),
        grand_total=50.00,
        shipments=[
            make_shipment(
                delivery_status="",
                tracking_link=None,
                items=[
                    make_item(
                        title="Amazon Gift Card $50",
                        price=50.00,
                        quantity=1,
                        link="https://www.amazon.com/gc/gift-cards",
                    ),
                ],
            ),
        ],
    )

    # Order 5: Order with duplicate ASINs
    order5 = make_order(
        order_number="111-0000005-0000005",
        order_date=datetime.date(2025, 8, 1),
        grand_total=39.98,
        shipments=[
            make_shipment(
                delivery_status="Delivered August 3, 2025",
                tracking_link="https://www.ontrac.com/track?num=OT005",
                items=[
                    make_item(
                        title="Phone Case",
                        price=19.99,
                        quantity=1,
                        link="https://www.amazon.com/dp/B0PHONECAS",
                    ),
                    make_item(
                        title="Phone Case (Color Variant)",
                        price=19.99,
                        quantity=1,
                        link="https://www.amazon.com/dp/B0PHONECAS",
                    ),
                ],
            ),
        ],
    )

    return [order1, order2, order3, order4, order5]


class TestPipeline:
    def test_build_write_load_roundtrip(self, tmp_data_dir):
        """Full pipeline: build items from orders, write to file, load back."""
        orders = _make_test_orders()
        items = build_items_from_orders(orders)

        # Should produce 7 items total:
        # Order 1: 1 item, Order 2: 2 items, Order 3: 1 item,
        # Order 4: 1 item, Order 5: 2 items (duplicate ASIN)
        assert len(items) == 7

        # Write to 2025 file
        write_output(items, 2025, email="test@example.com")
        loaded = load_existing_items(2025)
        assert len(loaded) == 7

        # Verify specific items
        by_id = {i["item_id"]: i for i in loaded}

        # Order 1 - simple item
        usb_cable = by_id["111-0000001-0000001__B0USBCABL1"]
        assert usb_cable["title"] == "USB-C Cable"
        assert usb_cable["carrier"] == "UPS"
        assert usb_cable["subscribe_and_save"] is False

        # Order 3 - subscribe & save
        protein = by_id["111-0000003-0000003__B0PROTBAR0"]
        assert protein["subscribe_and_save"] is True
        assert protein["carrier"] == "USPS"

        # Order 5 - duplicate ASIN handling
        phone_ids = [k for k in by_id if "B0PHONECAS" in k]
        assert len(phone_ids) == 2
        assert "111-0000005-0000005__B0PHONECAS" in phone_ids
        assert "111-0000005-0000005__B0PHONECAS__1" in phone_ids

    def test_item_without_asin_has_slug_id(self, tmp_data_dir):
        """Gift card (no ASIN) gets slugified title in item_id."""
        orders = _make_test_orders()
        items = build_items_from_orders(orders)
        gift_card = [i for i in items if "gift" in i["item_id"].lower()]
        assert len(gift_card) == 1
        assert gift_card[0]["asin"] is None
        assert gift_card[0]["carrier"] == ""

    def test_multi_year_split(self, tmp_data_dir):
        """Items from different years written to separate files."""
        item_2024 = make_item(
            title="2024 Widget",
            link="https://www.amazon.com/dp/B02024WDG0",
        )
        item_2025 = make_item(
            title="2025 Widget",
            link="https://www.amazon.com/dp/B02025WDG0",
        )
        order_2024 = make_order(
            order_number="ORD-2024-001",
            order_date=datetime.date(2024, 12, 15),
            shipments=[make_shipment(items=[item_2024])],
        )
        order_2025 = make_order(
            order_number="ORD-2025-001",
            order_date=datetime.date(2025, 1, 5),
            shipments=[make_shipment(items=[item_2025])],
        )

        all_items = build_items_from_orders([order_2024, order_2025])
        items_2024 = [i for i in all_items if i["order_date"].startswith("2024")]
        items_2025 = [i for i in all_items if i["order_date"].startswith("2025")]

        write_output(items_2024, 2024, email="test@example.com")
        write_output(items_2025, 2025, email="test@example.com")

        loaded_2024 = load_existing_items(2024)
        loaded_2025 = load_existing_items(2025)

        assert len(loaded_2024) == 1
        assert loaded_2024[0]["title"] == "2024 Widget"
        assert len(loaded_2025) == 1
        assert loaded_2025[0]["title"] == "2025 Widget"

    def test_manifest_after_writes(self, tmp_data_dir):
        """Manifest correctly reflects written year files."""
        write_output([{"item_id": "a"}], 2024)
        write_output([{"item_id": "b"}, {"item_id": "c"}], 2025)
        write_manifest()

        manifest_path = tmp_data_dir / "data" / "app_data_manifest.js"
        content = manifest_path.read_text()
        lines = content.strip().split("\n")

        manifest_json = lines[0].split(" = ", 1)[1].rstrip(";")
        years = json.loads(manifest_json)
        assert years == [2025, 2024]

    def test_preserve_return_window_in_pipeline(self, tmp_data_dir):
        """Simulate incremental update: fresh items lose return_window_end,
        but _preserve_return_window restores it from existing data."""
        # First pass: write items with return dates
        items_v1 = [
            {
                "item_id": "ORD-001__B0ITEM0001",
                "order_id": "ORD-001",
                "order_date": "2025-06-15",
                "title": "Widget",
                "asin": "B0ITEM0001",
                "return_window_end": "2025-07-15",
                "return_policy": "free_or_replace",
            },
        ]
        write_output(items_v1, 2025)

        # Second pass: re-fetch produces null return_window_end
        # (item went to "Return Started" status on Amazon)
        items_v2 = [
            {
                "item_id": "ORD-001__B0ITEM0001",
                "order_id": "ORD-001",
                "order_date": "2025-06-15",
                "title": "Widget",
                "asin": "B0ITEM0001",
                "return_window_end": None,
                "return_policy": "free_or_replace",
            },
        ]

        existing = load_existing_items(2025)
        existing_by_id = {i["item_id"]: i for i in existing}
        _preserve_return_window(items_v2, existing_by_id)

        # Return window should be restored from v1
        assert items_v2[0]["return_window_end"] == "2025-07-15"

    def test_output_file_structure(self, tmp_data_dir):
        """Verify the exact structure of the output JS file."""
        items = [
            {
                "item_id": "test-id",
                "title": "Test Item",
                "order_date": "2025-06-15",
            },
        ]
        write_output(items, 2025, email="user@test.com")

        path = tmp_data_dir / "data" / "app_data_2025.js"
        content = path.read_text()

        # Must start with window assignment and end with semicolon
        assert content.startswith("window.ORDER_DATA_2025 = ")
        assert content.endswith(";\n")

        # Parse the JSON portion
        json_str = content.removeprefix("window.ORDER_DATA_2025 = ").removesuffix(";\n")
        data = json.loads(json_str)

        assert "generated_at" in data
        assert data["email"] == "user@test.com"
        assert isinstance(data["items"], list)
        assert len(data["items"]) == 1
        assert data["items"][0]["item_id"] == "test-id"
