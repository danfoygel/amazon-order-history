"""Shared fixtures for fetch_orders tests.

Handles module-level side effects (load_dotenv, sys.stderr replacement,
amazonorders imports) by mocking them before importing fetch_orders.
"""

import sys
import os
from pathlib import Path
from unittest.mock import Mock

import pytest

# ---------------------------------------------------------------------------
# Make fetch_orders importable from the project root
# ---------------------------------------------------------------------------

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


# ---------------------------------------------------------------------------
# Factory helpers — lightweight Mock-based objects that mimic the
# amazonorders library's Order / Shipment / Item classes.
# ---------------------------------------------------------------------------


def make_item(
    title="Test Item",
    price=9.99,
    quantity=1,
    link="https://www.amazon.com/dp/B0123456789",
    image_link="https://m.media-amazon.com/images/I/test.jpg",
    parsed=None,
):
    """Create a mock Item with the attributes build_item_record expects."""
    item = Mock()
    item.title = title
    item.price = price
    item.quantity = quantity
    item.link = link
    item.image_link = image_link
    item.parsed = parsed
    return item


def make_shipment(
    delivery_status="Delivered",
    tracking_link="https://www.ups.com/track?tracknum=1Z999",
    items=None,
):
    """Create a mock Shipment containing one or more Items."""
    shipment = Mock()
    shipment.delivery_status = delivery_status
    shipment.tracking_link = tracking_link
    shipment.items = items if items is not None else [make_item()]
    return shipment


def make_order(
    order_number="111-2222222-3333333",
    order_date=None,
    grand_total=29.97,
    subscription_discount=None,
    shipments=None,
):
    """Create a mock Order containing one or more Shipments."""
    import datetime

    order = Mock()
    order.order_number = order_number
    order.order_placed_date = order_date or datetime.date(2025, 6, 15)
    order.grand_total = grand_total
    order.subscription_discount = subscription_discount
    order.shipments = shipments if shipments is not None else [make_shipment()]
    return order


# ---------------------------------------------------------------------------
# tmp_data_dir fixture — provides a temp directory and monkeypatches the
# working directory so file I/O functions write to an isolated location.
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_data_dir(tmp_path, monkeypatch):
    """Change into tmp_path so data/ files are written there, not in the repo."""
    monkeypatch.chdir(tmp_path)
    return tmp_path
