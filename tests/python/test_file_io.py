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
        with open("data/app_data_2099.json", "w") as f:
            f.write("{BROKEN JSON")
        assert load_existing_items(2099) == []

    def test_valid_file_returns_items(self, tmp_data_dir):
        """Write a valid JSON file manually, then read it back."""
        os.makedirs("data", exist_ok=True)
        items = [{"item_id": "test-1", "title": "Widget"}]
        payload = json.dumps({"generated_at": "2025-01-01", "email": None, "items": items})
        with open("data/app_data_2025.json", "w") as f:
            f.write(payload)
        loaded = load_existing_items(2025)
        assert len(loaded) == 1
        assert loaded[0]["item_id"] == "test-1"


# ===================================================================
# write_output
# ===================================================================


class TestWriteOutput:
    def test_creates_data_dir_and_file(self, tmp_data_dir):
        write_output([{"item_id": "a"}], 2025, email="test@example.com")
        path = tmp_data_dir / "data" / "app_data_2025.json"
        assert path.exists()

    def test_file_is_valid_json(self, tmp_data_dir):
        write_output([{"item_id": "a"}], 2025)
        content = (tmp_data_dir / "data" / "app_data_2025.json").read_text()
        data = json.loads(content)
        assert "generated_at" in data
        assert "items" in data

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
        content = (tmp_data_dir / "data" / "app_data_2025.json").read_text()
        data = json.loads(content)
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

        manifest_path = tmp_data_dir / "data" / "app_data_manifest.json"
        assert manifest_path.exists()
        data = json.loads(manifest_path.read_text())

        assert data["years"] == [2025, 2024]
        counts = data["year_counts"]
        assert counts == {"2024": 1, "2025": 2} or counts == {2024: 1, 2025: 2}

    def test_manifest_empty_when_no_files(self, tmp_data_dir):
        """Manifest with no year files -> empty list."""
        os.makedirs("data", exist_ok=True)
        write_manifest()
        data = json.loads((tmp_data_dir / "data" / "app_data_manifest.json").read_text())
        assert data["years"] == []
