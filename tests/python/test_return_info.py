"""Tests for extract_return_info() and _parse_return_date()."""

from unittest.mock import Mock

import pytest
from bs4 import BeautifulSoup

from fetch_orders import extract_return_info, _parse_return_date


# ---------------------------------------------------------------------------
# Helpers — build mock items with parsed BeautifulSoup HTML
# ---------------------------------------------------------------------------


def _item_with_html(html: str):
    """Create a mock item whose .parsed attribute is a BeautifulSoup fragment."""
    item = Mock()
    item.parsed = BeautifulSoup(html, "html.parser")
    return item


# ---------------------------------------------------------------------------
# _parse_return_date
# ---------------------------------------------------------------------------


class TestParseReturnDate:
    def test_standard_date_text(self):
        text = "Return or replace items: Eligible through March 22, 2026"
        assert _parse_return_date(text) == "2026-03-22"

    def test_no_date_returns_none(self):
        assert _parse_return_date("no date here") is None

    def test_empty_string(self):
        assert _parse_return_date("") is None


# ---------------------------------------------------------------------------
# extract_return_info
# ---------------------------------------------------------------------------


class TestExtractReturnInfo:
    def test_return_or_replace_eligible(self):
        """'Return or replace items: Eligible through ...' -> free_or_replace."""
        html = """
        <div>
            <span class="a-size-small">
                Return or replace items: Eligible through March 22, 2026
            </span>
        </div>
        """
        date, policy = extract_return_info(_item_with_html(html))
        assert date == "2026-03-22"
        assert policy == "free_or_replace"

    def test_return_items_only(self):
        """'Return items: Eligible through ...' -> return_only."""
        html = """
        <div>
            <span class="a-size-small">
                Return items: Eligible through April 10, 2026
            </span>
        </div>
        """
        date, policy = extract_return_info(_item_with_html(html))
        assert date == "2026-04-10"
        assert policy == "return_only"

    def test_empty_connections_div_non_returnable(self):
        """Empty .yohtmlc-item-level-connections div -> non_returnable."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections"></div>
        </div>
        """
        date, policy = extract_return_info(_item_with_html(html))
        assert date is None
        assert policy == "non_returnable"

    def test_non_empty_connections_no_return_span(self):
        """Connections div has content but no return span -> (None, None)."""
        html = """
        <div>
            <div class="yohtmlc-item-level-connections">
                <a href="/buy-again">Buy it again</a>
            </div>
        </div>
        """
        date, policy = extract_return_info(_item_with_html(html))
        assert date is None
        assert policy is None

    def test_no_parsed_attribute(self):
        """Item without .parsed attribute -> (None, None)."""
        item = Mock(spec=[])  # no attributes at all
        date, policy = extract_return_info(item)
        assert date is None
        assert policy is None

    def test_parsed_is_none(self):
        """Item with parsed=None -> (None, None)."""
        item = Mock()
        item.parsed = None
        date, policy = extract_return_info(item)
        assert date is None
        assert policy is None

    def test_span_without_eligible_through_ignored(self):
        """a-size-small spans that do not contain 'eligible through' are skipped."""
        html = """
        <div>
            <span class="a-size-small">Delivered Jan 5</span>
            <div class="yohtmlc-item-level-connections">
                <span>Some content</span>
            </div>
        </div>
        """
        date, policy = extract_return_info(_item_with_html(html))
        assert date is None
        assert policy is None
