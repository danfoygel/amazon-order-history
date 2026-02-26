"""Tests for detect_carrier() and CARRIER_PATTERNS."""

import pytest
from fetch_orders import detect_carrier


# ---------------------------------------------------------------------------
# Known carriers — each (url, expected_carrier) pair
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://www.ups.com/track?tracknum=1Z999", "UPS"),
        ("https://tools.usps.com/go/TrackConfirmAction?tRef=fullpage&tLc=2", "USPS"),
        ("https://www.fedex.com/fedextrack/?trknbr=123456", "FedEx"),
        ("https://www.dhl.com/us-en/home/tracking.html?tracking-id=ABC", "DHL"),
        ("https://track.amazon.com/tracking/12345", "Amazon"),
        ("https://www.amazon.com/progress-tracker/package/ref=ppx", "Amazon"),
        ("https://www.ontrac.com/trackingdetail.asp?tracking=C1234", "OnTrac"),
        ("https://www.lso.com/tracking?airbillno=123456", "LSO"),
    ],
    ids=["UPS", "USPS", "FedEx", "DHL", "Amazon-track", "Amazon-progress", "OnTrac", "LSO"],
)
def test_known_carriers(url, expected):
    assert detect_carrier(url) == expected


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_unknown_domain_returns_other():
    assert detect_carrier("https://www.random-shipping.com/track/123") == "Other"


def test_none_returns_empty_string():
    assert detect_carrier(None) == ""


def test_empty_string_returns_empty_string():
    assert detect_carrier("") == ""


def test_malformed_url_returns_other():
    """A string that is not blank but cannot be parsed as a URL with a matching host."""
    assert detect_carrier("not-a-url") == "Other"


def test_carrier_case_insensitive_host():
    """Host matching should be case-insensitive (urlparse lowercases netloc)."""
    assert detect_carrier("https://WWW.UPS.COM/track?num=1Z") == "UPS"
