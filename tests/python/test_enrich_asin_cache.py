"""Tests for fetch_product_page_info() and enrich_items_with_asin_cache()."""

import json
import os
from unittest.mock import Mock, patch, MagicMock

import pytest
from fetch_orders import fetch_product_page_info, enrich_items_with_asin_cache


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_response(status_code=200, text="", html=None):
    """Create a mock requests.Response."""
    resp = Mock()
    resp.status_code = status_code
    resp.text = html or text
    return resp


def _session_with_responses(*responses):
    """Create a mock session whose session.get returns responses in order."""
    session = Mock()
    session.session = Mock()
    session.session.get = Mock(side_effect=list(responses))
    return session


# ---------------------------------------------------------------------------
# fetch_product_page_info
# ---------------------------------------------------------------------------


class TestFetchProductPageInfo:
    @patch("fetch_orders.time.sleep")
    def test_free_returns_detected(self, mock_sleep):
        html = "<html><body>Free Returns on this item</body></html>"
        session = _session_with_responses(_mock_response(200, html=html))
        info, err = fetch_product_page_info(session, "B0TESTFREE1")
        assert err is None
        assert info["return_policy"] == "free_or_replace"

    @patch("fetch_orders.time.sleep")
    def test_non_returnable_detected(self, mock_sleep):
        html = "<html><body>This item is non-returnable.</body></html>"
        session = _session_with_responses(_mock_response(200, html=html))
        info, err = fetch_product_page_info(session, "B0TESTNONR1")
        assert err is None
        assert info["return_policy"] == "non_returnable"

    @patch("fetch_orders.time.sleep")
    def test_neither_signal_returns_none_policy(self, mock_sleep):
        html = "<html><body>Just a normal product page.</body></html>"
        session = _session_with_responses(_mock_response(200, html=html))
        info, err = fetch_product_page_info(session, "B0TESTNONE1")
        assert err is None
        assert info["return_policy"] is None

    @patch("fetch_orders.time.sleep")
    def test_http_404_not_cached(self, mock_sleep):
        """404 is a permanent failure — returned immediately, not retried."""
        session = _session_with_responses(_mock_response(404))
        info, err = fetch_product_page_info(session, "B0TEST4041")
        assert info is None
        assert "404" in err
        # 404 should not be retried — only one call
        assert session.session.get.call_count == 1
        mock_sleep.assert_not_called()

    @patch("fetch_orders.time.sleep")
    def test_http_503_retries_then_fails(self, mock_sleep):
        """503 is retryable. After max_retries attempts it should give up."""
        responses = [_mock_response(503) for _ in range(3)]
        session = _session_with_responses(*responses)
        info, err = fetch_product_page_info(session, "B0TEST5031", max_retries=3)
        assert info is None
        assert "503" in err
        assert session.session.get.call_count == 3
        # sleep called between retries (not after the last one)
        assert mock_sleep.call_count == 2

    @patch("fetch_orders.time.sleep")
    def test_http_503_then_success(self, mock_sleep):
        """503 on first attempt, 200 on second."""
        html = "<html><body>Free Returns available</body></html>"
        responses = [_mock_response(503), _mock_response(200, html=html)]
        session = _session_with_responses(*responses)
        info, err = fetch_product_page_info(session, "B0TESTRECV1", max_retries=3)
        assert err is None
        assert info["return_policy"] == "free_or_replace"

    @patch("fetch_orders.time.sleep")
    def test_network_exception_retries(self, mock_sleep):
        """Network errors are retried with backoff."""
        session = Mock()
        session.session = Mock()
        session.session.get = Mock(side_effect=ConnectionError("DNS failed"))
        info, err = fetch_product_page_info(session, "B0TESTNET01", max_retries=2)
        assert info is None
        assert "DNS failed" in err
        assert session.session.get.call_count == 2

    @patch("fetch_orders.time.sleep")
    def test_review_sections_stripped(self, mock_sleep):
        """Customer review text should not trigger false positive for 'free returns'."""
        html = """
        <html><body>
            <div>Product details</div>
            <div id="customerReviews">
                I love the free returns policy on this item!
            </div>
        </body></html>
        """
        session = _session_with_responses(_mock_response(200, html=html))
        info, err = fetch_product_page_info(session, "B0TESTREV01")
        assert err is None
        # "free returns" was only in a review section, so should not be detected
        assert info["return_policy"] is None


# ---------------------------------------------------------------------------
# enrich_items_with_asin_cache
# ---------------------------------------------------------------------------


class TestEnrichItemsWithAsinCache:
    @patch("fetch_orders.time.sleep")
    def test_fetches_and_caches_new_asin(self, mock_sleep, tmp_path, monkeypatch):
        """New ASIN is fetched, cached, and applied to item."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        html = "<html><body>Free Returns on this item</body></html>"
        session = _session_with_responses(_mock_response(200, html=html))

        items = [
            {"asin": "B0ENRICHED1", "return_policy": None, "return_window_end": "2025-08-01"},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)

        # Item should be enriched
        assert items[0]["return_policy"] == "free_or_replace"
        # Cache file should exist
        assert os.path.exists(cache_path)
        with open(cache_path) as f:
            cache = json.load(f)
        assert "B0ENRICHED1" in cache

    @patch("fetch_orders.time.sleep")
    def test_already_cached_not_refetched(self, mock_sleep, tmp_path, monkeypatch):
        """ASIN already in cache should not trigger a fetch."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        # Pre-populate cache
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump({"B0CACHED001": {"return_policy": "non_returnable"}}, f)

        session = Mock()
        session.session = Mock()
        items = [
            {"asin": "B0CACHED001", "return_policy": "free_or_replace", "return_window_end": "2025-08-01"},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)

        # Session should not have been called (ASIN was cached)
        session.session.get.assert_not_called()
        # Item should have cache value applied (non_returnable overrides)
        assert items[0]["return_policy"] == "non_returnable"
        assert items[0]["return_window_end"] is None  # cleared for non_returnable

    @patch("fetch_orders.time.sleep")
    def test_isbn_asin_skipped(self, mock_sleep, tmp_path, monkeypatch):
        """ISBN ASINs (digit-only, not starting with B) are skipped."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        session = Mock()
        session.session = Mock()
        items = [
            {"asin": "0134685997", "return_policy": None, "return_window_end": None},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)

        # ISBN should not be fetched
        session.session.get.assert_not_called()
        # return_policy should remain None (not overridden)
        assert items[0]["return_policy"] is None

    @patch("fetch_orders.time.sleep")
    def test_none_policy_from_cache_preserves_order_page_value(self, mock_sleep, tmp_path, monkeypatch):
        """When cache has return_policy=None, the order-page value is kept."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        # Pre-populate cache with None policy
        with open(cache_path, "w") as f:
            json.dump({"B0NONESIG01": {"return_policy": None}}, f)

        session = Mock()
        session.session = Mock()
        items = [
            {"asin": "B0NONESIG01", "return_policy": "return_only", "return_window_end": "2025-08-01"},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)

        # None from cache should NOT override non-None from order page
        assert items[0]["return_policy"] == "return_only"
        assert items[0]["return_window_end"] == "2025-08-01"

    @patch("fetch_orders.time.sleep")
    def test_non_returnable_clears_return_window(self, mock_sleep, tmp_path, monkeypatch):
        """non_returnable from cache clears return_window_end to None."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        with open(cache_path, "w") as f:
            json.dump({"B0NONRET01": {"return_policy": "non_returnable"}}, f)

        session = Mock()
        session.session = Mock()
        items = [
            {"asin": "B0NONRET01", "return_policy": "free_or_replace", "return_window_end": "2025-08-01"},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)

        assert items[0]["return_policy"] == "non_returnable"
        assert items[0]["return_window_end"] is None

    @patch("fetch_orders.time.sleep")
    def test_item_without_asin_unchanged(self, mock_sleep, tmp_path, monkeypatch):
        """Items with no ASIN are left untouched."""
        cache_path = str(tmp_path / "asin_cache.json")
        monkeypatch.setattr("fetch_orders.ASIN_CACHE_PATH", cache_path)

        session = Mock()
        session.session = Mock()
        items = [
            {"asin": None, "return_policy": "return_only", "return_window_end": "2025-08-01"},
        ]
        enrich_items_with_asin_cache(items, session, verbose=False)
        assert items[0]["return_policy"] == "return_only"
