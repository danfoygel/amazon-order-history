"""Tests for the custom HTTP server with ETag/304 support."""

import io
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Make server.py importable from the project root
# ---------------------------------------------------------------------------
PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from server import CachingHTTPRequestHandler, _compute_etag  # noqa: E402
from http.server import HTTPServer  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_site(tmp_path):
    """Create a minimal site directory with a test file."""
    (tmp_path / "hello.txt").write_text("Hello, world!")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "app_data_2026.json").write_text('{"items":[]}')
    return tmp_path


@pytest.fixture()
def server_url(tmp_site):
    """Start the caching HTTP server in a background thread and return its URL."""
    original_dir = os.getcwd()
    os.chdir(tmp_site)

    server = HTTPServer(("127.0.0.1", 0), CachingHTTPRequestHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{port}"

    server.shutdown()
    os.chdir(original_dir)


# ---------------------------------------------------------------------------
# Unit tests for _compute_etag
# ---------------------------------------------------------------------------


class TestComputeEtag:
    def test_returns_quoted_string(self):
        etag = _compute_etag(b"hello")
        assert etag.startswith('"')
        assert etag.endswith('"')

    def test_deterministic(self):
        assert _compute_etag(b"test") == _compute_etag(b"test")

    def test_different_content_different_etag(self):
        assert _compute_etag(b"aaa") != _compute_etag(b"bbb")


# ---------------------------------------------------------------------------
# Integration tests — actual HTTP requests
# ---------------------------------------------------------------------------


class TestServerResponses:
    def test_serves_file_with_etag(self, server_url):
        """First request returns 200 with an ETag header."""
        resp = urllib.request.urlopen(f"{server_url}/hello.txt")
        assert resp.status == 200
        etag = resp.headers.get("ETag")
        assert etag is not None
        assert etag.startswith('"') and etag.endswith('"')
        assert resp.read() == b"Hello, world!"

    def test_cache_control_header(self, server_url):
        """Responses include Cache-Control: no-cache."""
        resp = urllib.request.urlopen(f"{server_url}/hello.txt")
        assert resp.headers.get("Cache-Control") == "no-cache"

    def test_304_on_matching_etag(self, server_url):
        """If-None-Match with a matching ETag returns 304."""
        # First request — get the ETag
        resp = urllib.request.urlopen(f"{server_url}/hello.txt")
        etag = resp.headers.get("ETag")
        assert etag is not None

        # Second request with If-None-Match
        req = urllib.request.Request(
            f"{server_url}/hello.txt",
            headers={"If-None-Match": etag},
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("Expected 304 but got 200")
        except urllib.error.HTTPError as e:
            assert e.code == 304

    def test_200_on_mismatched_etag(self, server_url):
        """If-None-Match with a stale ETag returns 200 with full body."""
        req = urllib.request.Request(
            f"{server_url}/hello.txt",
            headers={"If-None-Match": '"stale-etag"'},
        )
        resp = urllib.request.urlopen(req)
        assert resp.status == 200
        assert resp.read() == b"Hello, world!"

    def test_200_when_file_changes(self, server_url, tmp_site):
        """After a file changes, the old ETag no longer matches."""
        # Get initial ETag
        resp = urllib.request.urlopen(f"{server_url}/hello.txt")
        old_etag = resp.headers.get("ETag")

        # Modify the file
        (tmp_site / "hello.txt").write_text("Updated content!")

        # Request with old ETag — should get 200 (new content)
        req = urllib.request.Request(
            f"{server_url}/hello.txt",
            headers={"If-None-Match": old_etag},
        )
        resp = urllib.request.urlopen(req)
        assert resp.status == 200
        assert resp.read() == b"Updated content!"

        # New ETag should differ from old
        new_etag = resp.headers.get("ETag")
        assert new_etag != old_etag

    def test_serves_json_with_correct_content_type(self, server_url):
        """JSON files are served with application/json content type."""
        resp = urllib.request.urlopen(f"{server_url}/data/app_data_2026.json")
        assert resp.status == 200
        content_type = resp.headers.get("Content-Type")
        assert "json" in content_type

    def test_404_for_missing_file(self, server_url):
        """Requesting a non-existent file returns 404."""
        req = urllib.request.Request(f"{server_url}/nonexistent.txt")
        try:
            urllib.request.urlopen(req)
            pytest.fail("Expected 404 but got 200")
        except urllib.error.HTTPError as e:
            assert e.code == 404
