"""Tests for build_item_record() and build_items_from_orders()."""

import datetime
from unittest.mock import Mock

import pytest
from conftest import make_order, make_shipment, make_item
from fetch_orders import build_item_record, build_items_from_orders


# ===================================================================
# build_item_record
# ===================================================================


class TestBuildItemRecord:
    def test_all_fields_populated(self):
        """Verify every expected field is present and has the right value."""
        item = make_item(
            title="Widget",
            price=12.50,
            quantity=2,
            link="https://www.amazon.com/dp/B0TESTITEM1",
            image_link="https://m.media-amazon.com/images/I/widget.jpg",
        )
        shipment = make_shipment(
            delivery_status="Delivered",
            tracking_link="https://www.ups.com/track?num=1Z",
            items=[item],
        )
        order = make_order(
            order_number="111-0000000-0000001",
            order_date=datetime.date(2025, 6, 15),
            grand_total=25.00,
            subscription_discount=None,
            shipments=[shipment],
        )

        record = build_item_record(order, shipment, item, "111-0000000-0000001__B0TESTITEM1")

        assert record["item_id"] == "111-0000000-0000001__B0TESTITEM1"
        assert record["order_id"] == "111-0000000-0000001"
        assert record["order_date"] == "2025-06-15"
        assert record["title"] == "Widget"
        assert record["asin"] == "B0TESTITEM1"
        assert record["quantity"] == 2
        assert record["unit_price"] == 12.50
        assert record["total_price"] == 25.00
        assert record["item_link"] == "https://www.amazon.com/dp/B0TESTITEM1"
        assert record["image_link"] == "https://m.media-amazon.com/images/I/widget.jpg"
        assert record["carrier"] == "UPS"
        assert record["tracking_url"] == "https://www.ups.com/track?num=1Z"
        assert record["delivery_status"] == "Delivered"
        assert record["order_grand_total"] == 25.00
        assert record["return_status"] == "none"
        assert record["return_initiated_date"] is None
        assert record["return_notes"] == ""
        assert record["subscribe_and_save"] is False

    def test_subscribe_and_save_detected(self):
        """subscription_discount present on order -> subscribe_and_save True."""
        order = make_order(subscription_discount="5%")
        shipment = order.shipments[0]
        item = shipment.items[0]
        record = build_item_record(order, shipment, item, "test-id")
        assert record["subscribe_and_save"] is True

    def test_no_tracking_link(self):
        """None tracking_link -> carrier is empty string."""
        shipment = make_shipment(tracking_link=None)
        order = make_order(shipments=[shipment])
        item = shipment.items[0]
        record = build_item_record(order, shipment, item, "test-id")
        assert record["carrier"] == ""
        assert record["tracking_url"] is None

    def test_item_without_link(self):
        """Item with no product link -> asin is None."""
        item = make_item(link=None)
        shipment = make_shipment(items=[item])
        order = make_order(shipments=[shipment])
        record = build_item_record(order, shipment, item, "test-id")
        assert record["asin"] is None
        assert record["item_link"] is None

    def test_price_none(self):
        """Item with price=None -> unit_price and total_price are None."""
        item = make_item(price=None)
        shipment = make_shipment(items=[item])
        order = make_order(shipments=[shipment])
        record = build_item_record(order, shipment, item, "test-id")
        assert record["unit_price"] is None
        assert record["total_price"] is None

    def test_total_price_calculation(self):
        """total_price = unit_price * quantity, rounded to 2 decimals."""
        item = make_item(price=3.33, quantity=3)
        shipment = make_shipment(items=[item])
        order = make_order(shipments=[shipment])
        record = build_item_record(order, shipment, item, "test-id")
        assert record["total_price"] == 9.99


# ===================================================================
# build_items_from_orders
# ===================================================================


class TestBuildItemsFromOrders:
    def test_single_order_single_item(self):
        orders = [make_order()]
        items = build_items_from_orders(orders)
        assert len(items) == 1
        assert items[0]["order_id"] == "111-2222222-3333333"

    def test_multiple_items_across_shipments(self):
        """Two shipments with one item each -> two item records."""
        item_a = make_item(title="A", link="https://www.amazon.com/dp/B000000001")
        item_b = make_item(title="B", link="https://www.amazon.com/dp/B000000002")
        ship_a = make_shipment(items=[item_a])
        ship_b = make_shipment(items=[item_b])
        order = make_order(shipments=[ship_a, ship_b])
        items = build_items_from_orders([order])
        assert len(items) == 2
        assert items[0]["asin"] == "B000000001"
        assert items[1]["asin"] == "B000000002"

    def test_duplicate_asin_suffix(self):
        """Two items with the same ASIN in the same order get __1, __2 suffixes."""
        item_a = make_item(title="Same", link="https://www.amazon.com/dp/B0DUPLICATE")
        item_b = make_item(title="Same", link="https://www.amazon.com/dp/B0DUPLICATE")
        shipment = make_shipment(items=[item_a, item_b])
        order = make_order(order_number="111-DUP-TEST", shipments=[shipment])
        items = build_items_from_orders([order])
        assert len(items) == 2
        assert items[0]["item_id"] == "111-DUP-TEST__B0DUPLICATE"
        assert items[1]["item_id"] == "111-DUP-TEST__B0DUPLICATE__1"

    def test_item_without_asin_uses_slug(self):
        """Item without a parseable ASIN uses slugified title in item_id."""
        item = make_item(title="Gift Card $50", link="https://www.amazon.com/gc/123")
        shipment = make_shipment(items=[item])
        order = make_order(order_number="111-NOASIN-001", shipments=[shipment])
        items = build_items_from_orders([order])
        assert len(items) == 1
        assert "111-NOASIN-001__" in items[0]["item_id"]
        assert "gift-card-50" in items[0]["item_id"]

    def test_multiple_orders(self):
        """Multiple orders produce correct item counts."""
        order1 = make_order(order_number="ORDER-001")
        order2 = make_order(order_number="ORDER-002")
        items = build_items_from_orders([order1, order2])
        assert len(items) == 2
        assert items[0]["order_id"] == "ORDER-001"
        assert items[1]["order_id"] == "ORDER-002"

    def test_order_with_no_shipments(self):
        """Order with shipments=None -> no items produced."""
        order = make_order(shipments=None)
        # Make sure the attribute returns None, not a Mock
        order.shipments = None
        items = build_items_from_orders([order])
        assert items == []

    def test_shipment_with_no_items(self):
        """Shipment with items=None -> no items produced."""
        shipment = make_shipment(items=None)
        shipment.items = None
        order = make_order(shipments=[shipment])
        items = build_items_from_orders([order])
        assert items == []
