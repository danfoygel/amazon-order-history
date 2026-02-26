"""Tests for extract_asin() and slugify()."""

import pytest
from fetch_orders import extract_asin, slugify


# ===================================================================
# extract_asin
# ===================================================================


class TestExtractAsin:
    def test_dp_url(self):
        url = "https://www.amazon.com/dp/B0123456789/ref=some_ref"
        assert extract_asin(url) == "B0123456789"

    def test_gp_product_url(self):
        url = "https://www.amazon.com/gp/product/B0123456789?th=1"
        assert extract_asin(url) == "B0123456789"

    def test_isbn_asin(self):
        """ISBN-10 codes (all digits, not starting with B) are valid ASINs."""
        url = "https://www.amazon.com/dp/0134685997"
        assert extract_asin(url) == "0134685997"

    def test_no_asin_in_url(self):
        url = "https://www.amazon.com/some/other/path"
        assert extract_asin(url) is None

    def test_none_input(self):
        assert extract_asin(None) is None

    def test_empty_string(self):
        assert extract_asin("") is None

    def test_case_insensitive(self):
        """ASIN_RE uses re.IGNORECASE so lowercase ASINs should match."""
        url = "https://www.amazon.com/dp/b0123456789"
        assert extract_asin(url) == "b0123456789"

    def test_asin_with_title_slug(self):
        """Real Amazon URLs often have a title slug before /dp/."""
        url = "https://www.amazon.com/Some-Product-Name/dp/B09ABCDEFG/ref=sr_1_1"
        assert extract_asin(url) == "B09ABCDEFG"


# ===================================================================
# slugify
# ===================================================================


class TestSlugify:
    def test_basic_text(self):
        assert slugify("Hello World") == "hello-world"

    def test_special_characters_stripped(self):
        assert slugify("Test! @#$% Item") == "test-item"

    def test_multiple_spaces_collapsed(self):
        assert slugify("a   b   c") == "a-b-c"

    def test_truncation_at_40_chars(self):
        long_text = "a" * 50
        result = slugify(long_text)
        assert len(result) <= 40

    def test_leading_trailing_hyphens_stripped(self):
        assert slugify("  --hello--  ") == "hello"

    def test_mixed_case_lowered(self):
        assert slugify("CamelCaseTitle") == "camelcasetitle"

    def test_underscores_replaced(self):
        assert slugify("some_item_name") == "some-item-name"

    def test_empty_string(self):
        assert slugify("") == ""

    def test_truncation_does_not_break_mid_hyphen(self):
        """If truncation lands on a hyphen, it should be stripped."""
        # 39 chars of 'a' + '-' at position 40 => truncated then stripped
        text = "a" * 39 + "-bbbbb"
        result = slugify(text)
        assert len(result) <= 40
        assert not result.endswith("-")
