"""Tests for load_existing_items(), write_output(), and write_manifest()."""

import json
import os

import pytest
from fetch_orders import load_existing_items, write_output, write_manifest


# ===================================================================
# load_existing_items
# ===================================================================


class TestLoadExistingItems:
    def test_nonexistent_file_returns_empty(self, tmp_data_dir):
        assert load_existing_items(2099) == []

    def test_corrupt_file_returns_empty(self, tmp_data_dir):
        """Malformed JSON -> empty list (with a printed warning)."""
        os.makedirs("data", exist_ok=True)
        with open("data/app_data_2099.js", "w") as f:
            f.write("window.ORDER_DATA_2099 = {BROKEN JSON;\n")
        assert load_existing_items(2099) == []

    def test_valid_file_returns_items(self, tmp_data_dir):
        """Write a valid JS file manually, then read it back."""
        os.makedirs("data", exist_ok=True)
        items = [{"item_id": "test-1", "title": "Widget"}]
        payload = json.dumps({"generated_at": "2025-01-01", "email": None, "items": items})
        with open("data/app_data_2025.js", "w") as f:
            f.write(f"window.ORDER_DATA_2025 = {payload};\n")
        loaded = load_existing_items(2025)
        assert len(loaded) == 1
        assert loaded[0]["item_id"] == "test-1"


# ===================================================================
# write_output
# ===================================================================


class TestWriteOutput:
    def test_creates_data_dir_and_file(self, tmp_data_dir):
        write_output([{"item_id": "a"}], 2025, email="test@example.com")
        path = tmp_data_dir / "data" / "app_data_2025.js"
        assert path.exists()

    def test_file_has_correct_prefix(self, tmp_data_dir):
        write_output([{"item_id": "a"}], 2025)
        content = (tmp_data_dir / "data" / "app_data_2025.js").read_text()
        assert content.startswith("window.ORDER_DATA_2025 = ")
        assert content.endswith(";\n")

    def test_round_trip(self, tmp_data_dir):
        """write_output -> load_existing_items round-trips correctly."""
        original = [
            {"item_id": "id1", "title": "Item One", "order_date": "2025-06-15"},
            {"item_id": "id2", "title": "Item Two", "order_date": "2025-07-01"},
        ]
        write_output(original, 2025, email="user@example.com")
        loaded = load_existing_items(2025)
        assert len(loaded) == 2
        assert loaded[0]["item_id"] == "id1"
        assert loaded[1]["item_id"] == "id2"

    def test_email_stored_in_output(self, tmp_data_dir):
        write_output([], 2025, email="user@amazon.com")
        content = (tmp_data_dir / "data" / "app_data_2025.js").read_text()
        prefix = "window.ORDER_DATA_2025 = "
        json_str = content.removeprefix(prefix).removesuffix(";\n")
        data = json.loads(json_str)
        assert data["email"] == "user@amazon.com"


# ===================================================================
# write_manifest
# ===================================================================


class TestWriteManifest:
    def test_manifest_lists_years(self, tmp_data_dir):
        """Manifest should list all year files, newest first."""
        write_output([{"item_id": "a"}], 2024)
        write_output([{"item_id": "b"}, {"item_id": "c"}], 2025)
        write_manifest()

        manifest_path = tmp_data_dir / "data" / "app_data_manifest.js"
        assert manifest_path.exists()
        content = manifest_path.read_text()
        assert "window.ORDER_DATA_MANIFEST" in content
        assert "window.ORDER_DATA_YEAR_COUNTS" in content

        # Parse the manifest to verify years are newest-first
        lines = content.strip().split("\n")
        manifest_json = lines[0].split(" = ", 1)[1].rstrip(";")
        years = json.loads(manifest_json)
        assert years == [2025, 2024]

        # Verify counts
        counts_json = lines[1].split(" = ", 1)[1].rstrip(";")
        counts = json.loads(counts_json)
        assert counts == {"2024": 1, "2025": 2} or counts == {2024: 1, 2025: 2}

    def test_manifest_empty_when_no_files(self, tmp_data_dir):
        """Manifest with no year files -> empty list."""
        os.makedirs("data", exist_ok=True)
        write_manifest()
        content = (tmp_data_dir / "data" / "app_data_manifest.js").read_text()
        assert "[]" in content
