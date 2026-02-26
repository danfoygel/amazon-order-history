"""Tests for date_to_iso() and add_days()."""

import datetime

import pytest
from fetch_orders import date_to_iso, add_days


# ===================================================================
# date_to_iso
# ===================================================================


class TestDateToIso:
    def test_date_object(self):
        assert date_to_iso(datetime.date(2025, 3, 15)) == "2025-03-15"

    def test_datetime_object(self):
        assert date_to_iso(datetime.datetime(2025, 3, 15, 10, 30)) == "2025-03-15"

    def test_iso_string_passthrough(self):
        assert date_to_iso("2025-03-15") == "2025-03-15"

    def test_iso_string_with_whitespace(self):
        assert date_to_iso("  2025-03-15  ") == "2025-03-15"

    def test_empty_string_returns_none(self):
        assert date_to_iso("") is None

    def test_whitespace_only_string_returns_none(self):
        assert date_to_iso("   ") is None

    def test_none_returns_none(self):
        assert date_to_iso(None) is None

    def test_non_standard_string(self):
        """A string that is not ISO format is returned as-is (str passthrough)."""
        assert date_to_iso("March 15, 2025") == "March 15, 2025"

    def test_numeric_value_converted_via_str(self):
        """Non-date, non-string values go through str()."""
        assert date_to_iso(12345) == "12345"


# ===================================================================
# add_days
# ===================================================================


class TestAddDays:
    def test_positive_days(self):
        assert add_days("2025-06-15", 30) == "2025-07-15"

    def test_negative_days(self):
        assert add_days("2025-06-15", -10) == "2025-06-05"

    def test_zero_days(self):
        assert add_days("2025-06-15", 0) == "2025-06-15"

    def test_none_input_returns_none(self):
        assert add_days(None, 5) is None

    def test_empty_string_returns_none(self):
        assert add_days("", 5) is None

    def test_invalid_date_string_returns_none(self):
        assert add_days("not-a-date", 5) is None

    def test_year_boundary_crossing(self):
        assert add_days("2025-12-31", 1) == "2026-01-01"

    def test_leap_year(self):
        assert add_days("2024-02-28", 1) == "2024-02-29"
