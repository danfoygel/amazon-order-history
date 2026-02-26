"""Tests for _preserve_return_window()."""

import pytest
from fetch_orders import _preserve_return_window


class TestPreserveReturnWindow:
    def test_fresh_null_existing_date_restored(self):
        """When fresh item has null return_window_end and existing has a date,
        the existing date should be restored."""
        fresh = [{"item_id": "id1", "return_window_end": None}]
        existing = {"id1": {"item_id": "id1", "return_window_end": "2025-07-15"}}
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] == "2025-07-15"

    def test_fresh_has_date_kept(self):
        """When fresh item already has a return_window_end, it should be kept
        even if the existing record also has a (different) date."""
        fresh = [{"item_id": "id1", "return_window_end": "2025-08-01"}]
        existing = {"id1": {"item_id": "id1", "return_window_end": "2025-07-15"}}
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] == "2025-08-01"

    def test_no_existing_match_stays_null(self):
        """When there is no matching existing record, the null stays null."""
        fresh = [{"item_id": "id-new", "return_window_end": None}]
        existing = {"id-other": {"item_id": "id-other", "return_window_end": "2025-06-01"}}
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] is None

    def test_existing_also_null_stays_null(self):
        """Both fresh and existing are null -> stays null."""
        fresh = [{"item_id": "id1", "return_window_end": None}]
        existing = {"id1": {"item_id": "id1", "return_window_end": None}}
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] is None

    def test_existing_empty_string_not_restored(self):
        """Existing has empty string (falsy) -> not restored (treated as missing)."""
        fresh = [{"item_id": "id1", "return_window_end": None}]
        existing = {"id1": {"item_id": "id1", "return_window_end": ""}}
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] is None

    def test_multiple_items(self):
        """Multiple items in fresh list — each gets independent treatment."""
        fresh = [
            {"item_id": "id1", "return_window_end": None},
            {"item_id": "id2", "return_window_end": "2025-09-01"},
            {"item_id": "id3", "return_window_end": None},
        ]
        existing = {
            "id1": {"item_id": "id1", "return_window_end": "2025-07-15"},
            "id2": {"item_id": "id2", "return_window_end": "2025-08-01"},
            # id3 not in existing
        }
        _preserve_return_window(fresh, existing)
        assert fresh[0]["return_window_end"] == "2025-07-15"  # restored
        assert fresh[1]["return_window_end"] == "2025-09-01"  # kept (fresh had value)
        assert fresh[2]["return_window_end"] is None           # no match
