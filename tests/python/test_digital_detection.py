"""Tests for detect_digital_item() — identifies digital orders from parsed HTML."""

from unittest.mock import Mock

import pytest
from bs4 import BeautifulSoup

from fetch_orders import detect_digital_item


# ---------------------------------------------------------------------------
# Helpers — build mock items with parsed BeautifulSoup HTML
# ---------------------------------------------------------------------------


def _item_with_html(html: str):
    """Create a mock item whose .parsed attribute is a BeautifulSoup fragment."""
    item = Mock()
    item.parsed = BeautifulSoup(html, "html.parser")
    return item


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDetectDigitalItem:
    def test_software_library_link(self):
        """'Go to Your Software Library' link -> digital."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="/gp/swvgdtt/your-account/manage">Go to Your Software Library</a>
                <a href="/review/create-review">Write a product review</a>
            </div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is True

    def test_games_software_library_link(self):
        """'Go to Your Games & Software Library' link -> digital."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="/gp/swvgdtt/your-account/manage">Go to Your Games &amp; Software Library</a>
            </div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is True

    def test_view_your_item_link(self):
        """'View your item' link (common on digital orders) alone is not sufficient.
        Could also appear on physical items. Need a more specific indicator."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="/dp/B012345678">View your item</a>
                <a href="/review/create-review">Write a product review</a>
            </div>
        </div>
        """
        # "View your item" alone is ambiguous — not a digital indicator
        assert detect_digital_item(_item_with_html(html)) is False

    def test_physical_order_with_return_info(self):
        """Physical order with return eligibility -> not digital."""
        html = """
        <div>
            <span class="a-size-small">
                Return or replace items: Eligible through March 22, 2026
            </span>
            <div class="yohtmlc-item-level-connections">
                <a href="/buy-again">Buy it again</a>
            </div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is False

    def test_physical_order_empty_connections(self):
        """Physical non-returnable item with empty connections -> not digital."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections"></div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is False

    def test_no_parsed_attribute(self):
        """Item without .parsed attribute -> not digital."""
        item = Mock(spec=[])
        assert detect_digital_item(item) is False

    def test_parsed_is_none(self):
        """Item with parsed=None -> not digital."""
        item = Mock()
        item.parsed = None
        assert detect_digital_item(item) is False

    def test_case_insensitive_matching(self):
        """Detection should be case-insensitive."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="#">go to your software library</a>
            </div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is True

    def test_kindle_library_link(self):
        """Kindle library link -> digital."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="/hz/mycd/myx">Go to Your Kindle Library</a>
            </div>
        </div>
        """
        assert detect_digital_item(_item_with_html(html)) is True
