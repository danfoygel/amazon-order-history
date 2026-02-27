#!/usr/bin/env python3
"""
fetch_orders.py — Scrapes Amazon order history and writes year-partitioned JS data files.

Usage:
    python fetch_orders.py                # incremental: last 3 months, merged into year file(s)
    python fetch_orders.py --year 2023    # historical backfill: fetch full calendar year 2023
    python fetch_orders.py --verbose      # add detailed API diagnostics to either mode

Reads credentials from .env (copy .env.example to .env and fill in values).

Data files written:
    data/app_data_YYYY.js         one file per calendar year
    data/app_data_manifest.js     lists available years; loaded by index.html
"""

import argparse
import glob as _glob
import io
import os
import json
import sys
import threading
import time
import datetime
import re
from urllib.parse import urlparse

from dotenv import load_dotenv

try:
    from dateutil import parser as _dateutil_parser
except ImportError:
    _dateutil_parser = None

try:
    from bs4 import BeautifulSoup as _BeautifulSoup
except ImportError:
    _BeautifulSoup = None

try:
    from amazonorders.session import AmazonSession
    from amazonorders.orders import AmazonOrders
    from amazonorders.conf import AmazonOrdersConfig
except ImportError:
    raise SystemExit(
        "amazon-orders is not installed. Run: .venv/bin/pip install amazon-orders python-dotenv"
    )

try:
    from requests.exceptions import ConnectionError as RequestsConnectionError
except ImportError:
    RequestsConnectionError = OSError

load_dotenv()

# ---------------------------------------------------------------------------
# Carrier detection from tracking URL
# ---------------------------------------------------------------------------

CARRIER_PATTERNS = [
    ("UPS",    ["ups.com"]),
    ("USPS",   ["usps.com"]),
    ("FedEx",  ["fedex.com"]),
    ("DHL",    ["dhl.com"]),
    ("Amazon", ["amazon.com", "track.amazon.com"]),
    ("OnTrac", ["ontrac.com"]),
    ("LSO",    ["lso.com"]),
]


def detect_carrier(tracking_url: str | None) -> str:
    if not tracking_url:
        return ""
    try:
        host = urlparse(tracking_url).netloc.lower()
    except Exception:
        return "Other"
    for carrier, domains in CARRIER_PATTERNS:
        if any(d in host for d in domains):
            return carrier
    return "Other"


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def date_to_iso(d) -> str | None:
    """Convert a date/datetime object or ISO string to YYYY-MM-DD string."""
    if d is None:
        return None
    if isinstance(d, (datetime.date, datetime.datetime)):
        return d.strftime("%Y-%m-%d")
    if isinstance(d, str):
        s = d.strip()
        return s if s else None
    return str(d)


def add_days(iso_date: str | None, days: int) -> str | None:
    if not iso_date:
        return None
    try:
        d = datetime.date.fromisoformat(iso_date)
        return (d + datetime.timedelta(days=days)).isoformat()
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# ASIN extraction from item link (library doesn't expose asin directly)
# ---------------------------------------------------------------------------

ASIN_RE = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})", re.IGNORECASE)

def extract_asin(link: str | None) -> str | None:
    if not link:
        return None
    m = ASIN_RE.search(link)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# Slugify (for items without an ASIN)
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:40].strip("-")


# ---------------------------------------------------------------------------
# Return policy extraction from item HTML
# ---------------------------------------------------------------------------

def _parse_return_date(text: str) -> str | None:
    """Extract an ISO date from return eligibility text such as
    'Return or replace items: Eligible through March 22, 2026'."""
    if _dateutil_parser is None:
        return None
    try:
        d = _dateutil_parser.parse(text, fuzzy=True).date()
        return d.isoformat()
    except (ValueError, OverflowError):
        return None


def extract_return_info(item) -> tuple[str | None, str | None]:
    """Read item.parsed HTML to determine return window end date and a
    preliminary return policy hint.

    NOTE: The return_policy value returned here is a best-effort heuristic
    derived from the order detail page and may be inaccurate (e.g. Amazon
    shows a return window for non-returnable food/supplement items).
    enrich_items_with_asin_cache() fetches each item's product page and
    overrides return_policy with the authoritative value when it finds one.

    Returns (return_window_end, return_policy) where return_policy is one of:
      "free_or_replace"  — "Return or replace items" text found (Amazon-fulfilled;
                           replacement option indicates likely free returns)
      "return_only"      — "Return items" text found (return-only, possibly
                           third-party seller; may or may not be free)
      "non_returnable"   — no return span AND connections div is completely empty
                           (characteristic of food, consumables, and similar
                           non-returnable categories on the order page)
      None               — ambiguous (no return span but connections div has
                           content), or return window is closed (date is still
                           captured but policy can't be determined from closed text)
    """
    parsed = getattr(item, "parsed", None)
    if parsed is None:
        return None, None

    # Amazon's current HTML puts return eligibility in a span.a-size-small that
    # contains "Eligible through" (open window) or "Return window closed on"
    # (expired window).  The older data-component selector
    # (data-component='itemReturnEligibility') is no longer used by Amazon.
    for span in parsed.select("span.a-size-small"):
        text = span.get_text(" ", strip=True)
        lower = text.lower()
        if "eligible through" in lower:
            date_str = _parse_return_date(text)
            if "return or replace items" in lower:
                return date_str, "free_or_replace"
            else:
                return date_str, "return_only"
        if "return window closed" in lower:
            date_str = _parse_return_date(text)
            # Window is closed — we know the item was returnable, but we can't
            # distinguish free_or_replace vs return_only from the closed text.
            # Use None for policy so the ASIN cache can provide the real answer.
            return date_str, None

    # No return span — check whether the item-level connections div is empty.
    # A completely empty div (no Buy-it-again, no return buttons) is the pattern
    # seen for non-returnable items (food, supplements, consumables, etc.).
    connections = parsed.select_one(".yohtmlc-item-level-connections")
    if connections is not None and not connections.get_text(strip=True):
        return None, "non_returnable"

    return None, None  # ambiguous: no return info found


# ---------------------------------------------------------------------------
# ASIN product-page cache
# ---------------------------------------------------------------------------

ASIN_CACHE_PATH = "data/asin_cache.json"


def load_asin_cache() -> dict:
    """Load data/asin_cache.json, returning {} if absent or unreadable."""
    if not os.path.exists(ASIN_CACHE_PATH):
        return {}
    try:
        with open(ASIN_CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"Warning: could not read ASIN cache ({exc}); starting fresh.")
        return {}


def save_asin_cache(cache: dict) -> None:
    """Write the ASIN cache to disk, creating data/ if needed."""
    os.makedirs("data", exist_ok=True)
    with open(ASIN_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
        f.write("\n")


_PRODUCT_PAGE_HEADERS = {
    # Use a real browser UA so Amazon returns product pages rather than 503s.
    # The amazonorders session defaults to 'python-requests/…' which is
    # immediately flagged and receives service-unavailable error pages.
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


def fetch_product_page_info(
    session, asin: str, verbose: bool = False, max_retries: int = 3
) -> "tuple[dict | None, str | None]":
    """GET the product detail page for one ASIN and extract cacheable fields.

    Returns:
        (dict, None)   — successful fetch; individual field values may be None
                         if the signal wasn't found on the page.
        (None, str)    — failure; str describes the reason (HTTP status, exception
                         message, etc.).  Caller should not cache this result.

    Retries up to max_retries times with exponential backoff (1 s, 2 s, 4 s …)
    on transient errors (5xx, 429, network exceptions).  Permanent failures
    (404, 403, etc.) are returned immediately without retrying.

    Currently extracted fields:
        return_policy  "free_or_replace" | "non_returnable" | None
    """
    if _BeautifulSoup is None:
        reason = "bs4 not installed — cannot fetch product page"
        if verbose:
            print(f"    [{asin}] {reason}")
        return None, reason

    # HTTP status codes worth retrying (transient server-side errors).
    RETRYABLE_STATUSES = {429, 500, 502, 503, 504}

    url = f"https://www.amazon.com/dp/{asin}"
    last_reason: str = "unknown error"
    for attempt in range(1, max_retries + 1):
        try:
            resp = session.session.get(url, headers=_PRODUCT_PAGE_HEADERS, timeout=15)
            if resp.status_code != 200:
                last_reason = f"HTTP {resp.status_code}"
                if resp.status_code not in RETRYABLE_STATUSES or attempt == max_retries:
                    if verbose:
                        suffix = (
                            f" after {max_retries} attempts"
                            if attempt == max_retries and resp.status_code in RETRYABLE_STATUSES
                            else ""
                        )
                        print(f"    [{asin}] {last_reason}{suffix}")
                    return None, last_reason
                wait = 2 ** (attempt - 1)
                if verbose:
                    print(
                        f"    [{asin}] {last_reason} — retrying in {wait}s"
                        f" (attempt {attempt}/{max_retries})…"
                    )
                time.sleep(wait)
                continue
            # 200 OK — parse the page
            soup = _BeautifulSoup(resp.text, "html.parser")
            # Strip customer-review sections to avoid false positives from review text
            for el in soup.select("#customerReviews, #reviews-medley, #cr-medley"):
                el.decompose()
            text = soup.get_text(" ", strip=True).lower()
            result: dict = {}
            if "non-returnable" in text:
                result["return_policy"] = "non_returnable"
            elif "free returns" in text:
                result["return_policy"] = "free_or_replace"
            else:
                result["return_policy"] = None  # page loaded but no clear signal
            if verbose:
                print(f"    [{asin}] return_policy = {result['return_policy']!r}")
            return result, None
        except Exception as exc:
            last_reason = str(exc)
            if attempt == max_retries:
                if verbose:
                    print(f"    [{asin}] error: {last_reason} after {max_retries} attempts")
                return None, last_reason
            wait = 2 ** (attempt - 1)
            if verbose:
                print(
                    f"    [{asin}] error: {last_reason} — retrying in {wait}s"
                    f" (attempt {attempt}/{max_retries})…"
                )
            time.sleep(wait)
    return None, last_reason  # unreachable, but satisfies the type checker


class _AsinFetchProgress:
    """
    Lightweight progress display for the sequential ASIN product-page fetch loop.

    Unlike FetchProgress (which hooks into async library internals to learn the
    total count and receive per-order callbacks), product page fetching is a
    simple sequential loop — so all we need is a background timer and an
    on_done() call after each ASIN attempt.

    Non-verbose mode: a single \\r line showing N/total (pct%) [elapsed],
    updated after each ASIN and once per second by the timer thread.
    Verbose mode: no \\r tricks; each ASIN is already logged by the caller.
    """

    def __init__(self, total: int, verbose: bool = False):
        self._total = total
        self._verbose = verbose
        self._processed = 0          # ASINs attempted so far (success or failure)
        self._lock = threading.Lock()
        self._t0 = time.monotonic()
        self._stop_event = threading.Event()
        if not verbose:
            self._timer: "threading.Thread | None" = threading.Thread(
                target=self._tick, daemon=True
            )
            self._timer.start()
        else:
            self._timer = None

    def _elapsed(self) -> str:
        secs = int(time.monotonic() - self._t0)
        return f"{secs // 60}:{secs % 60:02d}"

    def _format_line(self) -> str:
        with self._lock:
            processed = self._processed
        pct = processed / self._total * 100 if self._total else 0
        return f"  product pages: {processed}/{self._total} ({pct:.0f}%)  [{self._elapsed()}]"

    def _redraw(self):
        sys.stdout.write(f"\r{self._format_line():<72}")
        sys.stdout.flush()

    def _tick(self):
        while not self._stop_event.wait(timeout=1):
            self._redraw()

    def on_done(self):
        """Call after each ASIN attempt completes (success or failure)."""
        with self._lock:
            self._processed += 1
        if not self._verbose:
            self._redraw()

    def finish(self, fetched: int, failures: "list[tuple[str, str]]") -> None:
        """Stop the timer and write the final summary line + per-ASIN warnings."""
        self._stop_event.set()
        if self._timer:
            self._timer.join(timeout=2)
        elapsed = self._elapsed()
        if not self._verbose:
            final = f"  product pages: {fetched}/{self._total}  [{elapsed}]"
            sys.stdout.write(f"\r{final:<72}\n")
            sys.stdout.flush()
            not_found = [asin for asin, reason in failures if reason == "HTTP 404"]
            other = [(asin, reason) for asin, reason in failures if reason != "HTTP 404"]
            for asin, reason in other:
                print(f"    Warning: [{asin}] {reason}")
            if not_found:
                print(f"    ({len(not_found)} ASIN(s) returned 404 — likely discontinued or delisted)")


def enrich_items_with_asin_cache(
    items: list,
    session,
    verbose: bool = False,
) -> None:
    """Fetch product pages for uncached ASINs; apply cached data to all items.

    Modifies items in-place.  Updates data/asin_cache.json with new entries.

    Fields applied from cache:
        return_policy   — product-page value overrides the order-page heuristic
                          when the product page gives a definitive answer
                          (non-None); a None from the product page means "couldn't
                          determine", so the order-page value is kept as fallback.
        return_window_end — cleared to None for non_returnable items (a date
                            for a non-returnable item would be misleading).
    """
    cache = load_asin_cache()

    unique_asins = {item["asin"] for item in items if item.get("asin")}
    uncached = sorted(unique_asins - set(cache))

    # Standard Amazon ASINs start with B; ISBN-10 codes (books) use digit-only
    # strings and consistently return HTTP 500 via /dp/ — skip them.
    AMAZON_ASIN_RE = re.compile(r"^B[A-Z0-9]{9}$")
    uncached = [a for a in uncached if AMAZON_ASIN_RE.match(a)]

    if uncached:
        print(f"Fetching product pages for {len(uncached)} new ASIN(s)…")
        fetched = 0
        failures: list[tuple[str, str]] = []  # (asin, reason)
        progress = _AsinFetchProgress(len(uncached), verbose=verbose)
        for i, asin in enumerate(uncached, 1):
            if verbose:
                print(f"  [{i}/{len(uncached)}] {asin}")
            info, err = fetch_product_page_info(session, asin, verbose=verbose)
            if info is not None:
                info["_fetched_at"] = datetime.datetime.now(datetime.UTC).isoformat()
                cache[asin] = info
                fetched += 1
            else:
                failures.append((asin, err or "unknown error"))
            progress.on_done()
            time.sleep(1.0)  # polite pacing between requests

        progress.finish(fetched, failures)
        save_asin_cache(cache)
        if verbose:
            print(f"  ASIN cache: {len(cache)} total entries after update.")

    # Apply cached fields to every item in the list
    updated = 0
    for item in items:
        asin = item.get("asin")
        if not asin or asin not in cache:
            continue
        cached = cache[asin]
        policy = cached.get("return_policy")
        # Only override when the product page gave a definitive (non-None) answer.
        # None means "page loaded but no clear signal" — keep the order-page hint.
        if policy is not None:
            item["return_policy"] = policy
            if policy == "non_returnable":
                item["return_window_end"] = None
            updated += 1
    if verbose and updated:
        print(f"  Applied ASIN cache to {updated} item(s).")


# ---------------------------------------------------------------------------
# Build a single item record
# ---------------------------------------------------------------------------

def build_item_record(order, shipment, item, item_id: str) -> dict:
    order_date = date_to_iso(order.order_placed_date)

    # Use the new HTML-based extractor instead of the library's return_eligible_date
    # field (which used a now-obsolete CSS selector and always returned None).
    # The fallback order_date+30 default has been removed — null is more accurate
    # than a synthetic date when Amazon doesn't show return eligibility.
    return_window_end, return_policy = extract_return_info(item)

    raw_delivery_status = getattr(shipment, "delivery_status", None) or ""
    tracking_url = getattr(shipment, "tracking_link", None)
    unit_price = getattr(item, "price", None)
    quantity = getattr(item, "quantity", 1) or 1
    total_price = round(unit_price * quantity, 2) if unit_price is not None else None

    link = getattr(item, "link", None)
    asin = extract_asin(link)
    image_link = getattr(item, "image_link", None)

    return {
        "item_id":               item_id,
        "order_id":              order.order_number,
        "order_date":            order_date,
        "title":                 getattr(item, "title", "") or "",
        "asin":                  asin,
        "quantity":              quantity,
        "unit_price":            unit_price,
        "total_price":           total_price,
        "item_link":             link,
        "image_link":            image_link,
        "carrier":               detect_carrier(tracking_url),
        "tracking_url":          tracking_url,
        "delivery_status":       raw_delivery_status,
        "order_grand_total":     getattr(order, "grand_total", None),
        "return_window_end":     return_window_end,
        "return_policy":         return_policy,
        "return_status":         "none",
        "return_initiated_date": None,
        "return_notes":          "",
        "subscribe_and_save":    getattr(order, "subscription_discount", None) is not None,
    }


def build_items_from_orders(orders: list) -> list[dict]:
    """Convert a list of Order objects into a flat list of item records."""
    items = []
    seen_ids: dict[str, int] = {}
    for order in orders:
        for shipment in (getattr(order, "shipments", None) or []):
            for item in (getattr(shipment, "items", None) or []):
                asin = extract_asin(getattr(item, "link", None))
                base_key = f"{order.order_number}__{asin or slugify(getattr(item, 'title', '') or 'item')}"
                if base_key in seen_ids:
                    seen_ids[base_key] += 1
                    item_id = f"{base_key}__{seen_ids[base_key]}"
                else:
                    seen_ids[base_key] = 0
                    item_id = base_key
                items.append(build_item_record(order, shipment, item, item_id))
    return items


# ---------------------------------------------------------------------------
# Status validation — warn about delivery_status strings that don't match
# any STATUS_RULE and aren't in the known-issues allowlist.
# ---------------------------------------------------------------------------

def _load_status_keywords() -> list[str]:
    """Load STATUS_RULES patterns from status_rules.js (single source of truth).

    The JS file contains a JSON object between marker comments
    ``// --- BEGIN JSON ---`` and ``// --- END JSON ---``.
    """
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "status_rules.js")
    with open(p, encoding="utf-8") as f:
        text = f.read()
    # Extract the JSON object assigned to STATUS_RULES_DATA
    start = text.index("// --- BEGIN JSON ---")
    end = text.index("// --- END JSON ---")
    fragment = text[start:end]
    # Strip the "var STATUS_RULES_DATA = " prefix to get pure JSON
    json_start = fragment.index("{")
    json_end = fragment.rindex("}") + 1
    data = json.loads(fragment[json_start:json_end])
    return [pattern for pattern, _value in data["rules"]]

_STATUS_KEYWORDS = _load_status_keywords()


def _load_known_status_issues() -> set[str]:
    """Load item IDs from data/known_status_issues.json (if it exists)."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "known_status_issues.json")
    try:
        with open(p, encoding="utf-8") as f:
            items = json.load(f).get("items", {})
            if isinstance(items, dict):
                return set(items.keys())
            return set(items)
    except Exception:
        return set()


def warn_status_errors(items: list[dict]) -> None:
    """Print warnings for items whose delivery_status is unrecognised.

    Items listed in data/known_status_issues.json are silently skipped.
    """
    known = _load_known_status_issues()
    warnings = []
    for item in items:
        raw = (item.get("delivery_status") or "").strip()
        if not raw:
            continue
        low = raw.lower()
        if any(k in low for k in _STATUS_KEYWORDS):
            continue
        item_id = item.get("item_id", item.get("order_id", "unknown"))
        if item_id in known:
            continue
        warnings.append((item_id, raw))

    if warnings:
        print(f"  Warning: {len(warnings)} item(s) have unrecognised delivery_status:")
        for item_id, raw in warnings:
            print(f"    {item_id}  \"{raw}\"")


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def load_existing_items(year: int) -> list[dict]:
    """Read items from data/app_data_{year}.js, or return empty list."""
    path = f"data/app_data_{year}.js"
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
        prefix = f"window.ORDER_DATA_{year} = "
        json_str = content.removeprefix(prefix).removesuffix(";\n")
        return json.loads(json_str).get("items", [])
    except Exception as e:
        print(f"Warning: could not read {path} ({e}), starting fresh.")
        return []


def _preserve_return_window(fresh_items: list[dict], existing_by_id: dict[str, dict]) -> None:
    """Restore return_window_end from existing records where fresh re-fetch lost it.

    When an item transitions to "Return Started" the Amazon order page no longer
    shows the return-eligibility date, so extract_return_info() returns None.  If
    we already captured a real date while the item was in Delivered status, we
    should keep it rather than overwriting with None.
    """
    for item in fresh_items:
        if item.get("return_window_end") is None:
            old = existing_by_id.get(item.get("item_id"))
            if old and old.get("return_window_end"):
                item["return_window_end"] = old["return_window_end"]


def write_output(items: list[dict], year: int, email: str | None = None) -> None:
    os.makedirs("data", exist_ok=True)
    path = f"data/app_data_{year}.js"
    output = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "email": email,
        "items": items,
    }
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"window.ORDER_DATA_{year} = ")
        json.dump(output, f, indent=2, default=str)
        f.write(";\n")
    print(f"Wrote {len(items)} items to {path}")


def write_manifest() -> None:
    """Scan data/ for app_data_YYYY.js files and write app_data_manifest.js."""
    files = _glob.glob("data/app_data_[0-9][0-9][0-9][0-9].js")
    years = sorted(
        [int(os.path.basename(f)[9:13]) for f in files],
        reverse=True,  # newest first
    )
    counts = {year: len(load_existing_items(year)) for year in years}
    os.makedirs("data", exist_ok=True)
    with open("data/app_data_manifest.js", "w", encoding="utf-8") as f:
        f.write(f"window.ORDER_DATA_MANIFEST = {json.dumps(years)};\n")
        f.write(f"window.ORDER_DATA_YEAR_COUNTS = {json.dumps(counts)};\n")
    print(f"Wrote manifest: {years} (counts: {counts})")


# ---------------------------------------------------------------------------
# Progress display
# ---------------------------------------------------------------------------

class _StderrInterceptor(io.TextIOBase):
    """
    Wraps stderr so that warning lines from the library (which print mid-fetch)
    don't corrupt the \r progress display in non-verbose mode.

    Instead of printing warnings immediately, we buffer them and flush them
    after the final progress line in FetchProgress.finish(). In verbose mode
    (or when no progress is active), writes pass through to real stderr unchanged.
    """

    def __init__(self, original_stderr):
        self._orig = original_stderr
        self.progress: "FetchProgress | None" = None
        self._buffer: list[str] = []
        self._buf_lock = threading.Lock()

    def write(self, s: str) -> int:
        progress = self.progress
        if progress and not progress._verbose and s.strip():
            # Buffer the warning; it will be printed after the final progress line.
            with self._buf_lock:
                self._buffer.append(s)
        else:
            self._orig.write(s)
        return len(s)

    def flush(self):
        self._orig.flush()

    def flush_buffer(self):
        """Print any buffered warnings to real stderr and clear the buffer."""
        with self._buf_lock:
            lines, self._buffer = self._buffer, []
        for line in lines:
            self._orig.write(line)
        if lines:
            self._orig.flush()


# Module-level stderr interceptor — installed once, reused across fetches.
_stderr_interceptor = _StderrInterceptor(sys.stderr)
sys.stderr = _stderr_interceptor


class FetchProgress:
    """
    Tracks and displays live progress while get_order_history() runs.

    Non-verbose mode: a single line that rewrites itself in place with \r,
    showing "fetching order list…" during paging then "N/total (pct%)" as
    detail requests complete. Library warnings (stderr) are printed cleanly
    above the progress line without corrupting it.

    Verbose mode: plain sequential lines per order, no \r tricks, so output
    is clean when redirected or viewed in a log.

    Total order count is learned by wrapping _build_orders_async to capture
    the task list length just before asyncio.gather fires — this is the
    moment paging finishes and we know how many detail requests will run.
    """

    def __init__(self, amazon_orders, label: str, verbose: bool = False):
        self._ao = amazon_orders
        self._label = label
        self._verbose = verbose
        self._lock = threading.Lock()       # guards _completed / _total
        self._stdout_lock = threading.Lock()  # serialises all \r writes to stdout
        self._stop_event = threading.Event()  # signals timer thread to exit
        self._completed = 0
        self._total = 0
        self._t0 = time.monotonic()
        self._done = False

        # Register with the stderr interceptor so warnings print cleanly
        if not verbose:
            _stderr_interceptor.progress = self

        # --- Hook 1: wrap _build_order to count every order completion ---
        # We hook _build_order rather than get_order so that "unsupported"
        # orders (Fresh, Whole Foods, physical stores) — which skip get_order
        # and just return a partial order — still increment the counter.
        # We also suppress the per-order warning and accumulate a summary instead.
        self._skipped_orders: list[str] = []
        original_build_order = amazon_orders._build_order

        def _patched_build_order(order_tag, full_details, current_index):
            import logging as _logging
            # Temporarily silence the library's warning for unsupported orders;
            # we'll print a clean summary at finish() instead.
            lib_logger = _logging.getLogger("amazonorders.orders")
            original_level = lib_logger.level
            class _WarningCapture(_logging.Handler):
                def emit(self_, record):
                    if "unsupported Order type" in record.getMessage():
                        # Extract order number from the message
                        parts = record.getMessage().split()
                        if len(parts) >= 2:
                            self._skipped_orders.append(parts[1])
            capture = _WarningCapture()
            lib_logger.addHandler(capture)
            lib_logger.setLevel(_logging.WARNING)
            try:
                result = original_build_order(order_tag, full_details, current_index)
            finally:
                lib_logger.removeHandler(capture)
                lib_logger.setLevel(original_level)
            self._on_order_done(getattr(result, "order_number", ""))
            return result

        amazon_orders._build_order = _patched_build_order
        self._original_build_order = original_build_order

        # --- Hook 2: wrap _build_orders_async to learn the total before gather fires ---
        # The library collects all order tasks then calls asyncio.gather(*order_tasks).
        # We wrap the coroutine to intercept order_tasks length at that moment.
        import asyncio as _asyncio
        original_build = amazon_orders._build_orders_async

        async def _patched_build(next_page, keep_paging, full_details, current_index):
            original_gather = _asyncio.gather

            async def _counting_gather(*tasks, **kwargs):
                self.set_total(len(tasks))
                return await original_gather(*tasks, **kwargs)

            _asyncio.gather = _counting_gather
            try:
                return await original_build(next_page, keep_paging, full_details, current_index)
            finally:
                _asyncio.gather = original_gather

        amazon_orders._build_orders_async = _patched_build
        self._original_build = original_build

        # --- Background timer: redraws the progress line every second ---
        # Only used in non-verbose mode.
        if not verbose:
            self._timer = threading.Thread(target=self._tick, daemon=True)
            self._timer.start()
        else:
            self._timer = None
            self._stop_event.set()  # mark as already stopped for verbose mode

    def _elapsed(self) -> str:
        secs = int(time.monotonic() - self._t0)
        return f"{secs // 60}:{secs % 60:02d}"

    def _format_line(self) -> str:
        """Build the progress line string (call with _lock held or after reading snapshot)."""
        with self._lock:
            completed = self._completed
            total = self._total
        elapsed = self._elapsed()
        if total and completed > 0:
            pct = completed / total * 100
            return f"  {self._label}: {completed}/{total} orders ({pct:.0f}%)  [{elapsed}]"
        elif total:
            return f"  {self._label}: 0/{total} orders  [{elapsed}]"
        else:
            return f"  {self._label}: fetching order list …  [{elapsed}]"

    def _redraw_locked(self):
        """Write the progress line — caller must hold _stdout_lock."""
        sys.stdout.write(f"\r{self._format_line():<72}")
        sys.stdout.flush()

    def _redraw(self):
        """Rewrite the current terminal line in place (non-verbose only)."""
        with self._stdout_lock:
            self._redraw_locked()

    def _tick(self):
        while not self._stop_event.wait(timeout=1):
            self._redraw()

    def _on_order_done(self, order_id: str):
        with self._lock:
            self._completed += 1
            completed = self._completed
            total = self._total
        if self._verbose:
            print(f"  [API] order {order_id} details fetched  ({completed}/{total or '?'}) [{self._elapsed()}]")
        else:
            self._redraw()

    def set_total(self, total: int):
        with self._lock:
            self._total = total
        if not self._verbose:
            self._redraw()
        else:
            print(f"  [API] paging complete: {total} orders to fetch details for  [{self._elapsed()}]")

    def finish(self) -> list[str]:
        """Stop progress display and restore patched methods.

        Returns the list of order numbers that the library flagged as
        unsupported (Fresh / Whole Foods / physical-store orders).
        """
        # Signal and join the timer thread first so it can't race with the
        # final line write.  Then write the final line under the stdout lock
        # so any concurrent stderr warning handler can't interleave either.
        self._done = True
        self._stop_event.set()
        if self._timer:
            self._timer.join(timeout=2)
        _stderr_interceptor.progress = None
        with self._lock:
            completed = self._completed
            total = self._total
        elapsed = self._elapsed()
        skipped = len(self._skipped_orders)
        if self._verbose:
            print(f"  [API] done: {completed}/{total or completed} orders  [{elapsed}]")
            if skipped:
                print(f"  [API] {skipped} unsupported order(s) skipped (Fresh/Whole Foods/physical store): "
                      f"{', '.join(self._skipped_orders)}")
        else:
            final = f"  {self._label}: {completed}/{total or completed} orders  [{elapsed}]"
            with self._stdout_lock:
                # Pad to 72 chars to fully overwrite the last timer-drawn line,
                # then end with \n to leave the cursor on a clean new line.
                sys.stdout.write(f"\r{final:<72}\n")
                sys.stdout.flush()
            if skipped:
                print(f"  ({skipped} unsupported order(s) skipped: Fresh/Whole Foods/physical store)")
            _stderr_interceptor.flush_buffer()
        # Restore patched methods
        self._ao._build_order = self._original_build_order
        self._ao._build_orders_async = self._original_build
        return list(self._skipped_orders)


# ---------------------------------------------------------------------------
# Amazon API helpers
# ---------------------------------------------------------------------------

def _fetch_year_with_retry(
    amazon_orders,
    year: int,
    max_retries: int = 3,
    verbose: bool = False,
) -> tuple[list, set[str]]:
    """
    Fetch a single year of orders with retry on network errors.

    Returns (orders, skipped_order_ids) where *skipped_order_ids* is the set
    of order numbers the library flagged as unsupported (Fresh / Whole Foods /
    physical-store orders).

    The amazonorders library fires one HTTP request per order in parallel
    (full_details=True). On macOS this burst can overwhelm the DNS resolver,
    causing spurious NameResolutionError / ConnectionError failures. Retrying
    after a short back-off is enough to recover in the vast majority of cases.
    """
    if verbose:
        print(f"  [API] get_order_history(year={year}, full_details=True)")
    for attempt in range(1, max_retries + 1):
        progress = FetchProgress(amazon_orders, f"year {year}", verbose=verbose)
        try:
            orders = amazon_orders.get_order_history(year=year, full_details=True)
            skipped = progress.finish()
            if verbose:
                print(f"  [API] → {len(orders)} orders returned")
            return orders, set(skipped)
        except RequestsConnectionError as exc:
            progress.finish()
            if attempt < max_retries:
                wait = 2 ** (attempt - 1)   # 1 s, 2 s, 4 s …
                print(
                    f"  Network error on attempt {attempt}/{max_retries} "
                    f"(DNS failure or dropped connection) — retrying in {wait}s …"
                )
                if verbose:
                    print(f"  [API] Error detail: {exc}")
                time.sleep(wait)
            else:
                raise SystemExit(
                    f"\nNetwork error after {max_retries} attempts while fetching {year} orders.\n"
                    "Check your internet connection and try again.\n"
                    f"Original error: {exc}"
                ) from exc
        except Exception:
            # Stop the timer and restore stderr before letting the traceback print,
            # so the exception is not interleaved with \r progress lines.
            progress.finish()
            raise
    return [], set()   # unreachable, keeps type-checkers happy


def _fetch_incremental_with_retry(
    amazon_orders,
    max_retries: int = 3,
    verbose: bool = False,
) -> tuple[list, set[str]]:
    """
    Fetch the last 3 months of orders using the library's native time_filter,
    with retry on network errors.

    Returns (orders, skipped_order_ids) — see _fetch_year_with_retry.
    """
    if verbose:
        print('  [API] get_order_history(time_filter="months-3", full_details=True)')
    for attempt in range(1, max_retries + 1):
        progress = FetchProgress(amazon_orders, "last 3 months", verbose=verbose)
        try:
            orders = amazon_orders.get_order_history(
                time_filter="months-3", full_details=True
            )
            skipped = progress.finish()
            if verbose:
                print(f"  [API] → {len(orders)} orders returned")
            return orders, set(skipped)
        except RequestsConnectionError as exc:
            progress.finish()
            if attempt < max_retries:
                wait = 2 ** (attempt - 1)
                print(
                    f"  Network error on attempt {attempt}/{max_retries} "
                    f"(DNS failure or dropped connection) — retrying in {wait}s …"
                )
                if verbose:
                    print(f"  [API] Error detail: {exc}")
                time.sleep(wait)
            else:
                raise SystemExit(
                    f"\nNetwork error after {max_retries} attempts fetching last 3 months.\n"
                    "Check your internet connection and try again.\n"
                    f"Original error: {exc}"
                ) from exc
        except Exception:
            progress.finish()
            raise
    return [], set()   # unreachable


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch Amazon order history and write year-partitioned JS data files."
    )
    parser.add_argument(
        "--year", type=int, metavar="YYYY",
        help="Fetch a specific calendar year (historical backfill). "
             "Writes data/app_data_YYYY.js and updates the manifest.",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Print detailed diagnostics about Amazon API interactions.",
    )
    args = parser.parse_args()
    verbose = args.verbose

    email = os.environ.get("AMAZON_EMAIL")
    password = os.environ.get("AMAZON_PASSWORD")
    otp_secret = os.environ.get("AMAZON_OTP_SECRET") or None

    if not email or not password:
        raise SystemExit("AMAZON_EMAIL and AMAZON_PASSWORD must be set in .env")

    print("Logging in to Amazon...")
    if verbose:
        print(f"  [API] AmazonSession(email={email!r})")
    t_login = time.monotonic()
    session = AmazonSession(email, password, otp_secret_key=otp_secret)
    session.login()
    if verbose:
        print(f"  [API] Login completed in {time.monotonic() - t_login:.1f}s")
    print("Login successful.")

    # Use warn_on_missing_required_field=True so old orders with unusual HTML
    # (e.g. missing grand_total) produce a warning instead of raising an exception.
    config = AmazonOrdersConfig(data={
        "warn_on_missing_required_field": True,
        "thread_pool_size": 4,
        "connection_pool_size": 8,
    })
    amazon_orders = AmazonOrders(session, config=config)
    today = datetime.date.today()
    t_total = time.monotonic()

    if args.year:
        # ------------------------------------------------------------------
        # Historical backfill mode: fetch a single complete calendar year
        # ------------------------------------------------------------------
        year = args.year
        print(f"Mode: historical backfill for {year}")
        existing_items = load_existing_items(year)
        existing_by_id = {i["item_id"]: i for i in existing_items}
        print(f"Fetching orders for {year}...")
        raw_orders, skipped_ids = _fetch_year_with_retry(amazon_orders, year, verbose=verbose)
        if skipped_ids:
            raw_orders = [o for o in raw_orders if o.order_number not in skipped_ids]
        print(f"  Found {len(raw_orders)} orders.")
        items = build_items_from_orders(raw_orders)
        if verbose:
            print(f"  [summary] Built {len(items)} item records from {len(raw_orders)} orders")
        warn_status_errors(items)
        enrich_items_with_asin_cache(items, session, verbose=verbose)
        _preserve_return_window(items, existing_by_id)
        write_output(items, year, email=email)

    else:
        # ------------------------------------------------------------------
        # Incremental mode (default / cron): last 3 months, split by year
        # ------------------------------------------------------------------
        print("Mode: incremental (last 3 months)")
        print("Fetching orders for the last 3 months...")
        raw_orders, skipped_ids = _fetch_incremental_with_retry(amazon_orders, verbose=verbose)
        if skipped_ids:
            raw_orders = [o for o in raw_orders if o.order_number not in skipped_ids]
        print(f"  Found {len(raw_orders)} orders.")
        new_items = build_items_from_orders(raw_orders)
        if verbose:
            print(f"  [summary] Built {len(new_items)} item records from {len(raw_orders)} orders")
        warn_status_errors(new_items)
        enrich_items_with_asin_cache(new_items, session, verbose=verbose)

        # Partition new items by calendar year
        by_year: dict[int, list[dict]] = {}
        for item in new_items:
            y = int((item.get("order_date") or str(today))[:4])
            by_year.setdefault(y, []).append(item)

        # Always process both the current year and the year 90 days ago
        # (covers the year-boundary edge case even if one year has zero new items)
        cutoff_approx = today - datetime.timedelta(days=90)
        touched_years = {today.year, cutoff_approx.year}
        if verbose:
            print(f"  [merge] touched years: {sorted(touched_years)}")
            print(f"  [merge] new items by year: { {y: len(v) for y, v in by_year.items()} }")

        for year in sorted(touched_years):
            fresh = by_year.get(year, [])
            existing = load_existing_items(year)

            if verbose:
                print(f"  [merge] year {year}: {len(existing)} existing items loaded from disk")

            if fresh:
                # Determine cutoff as the earliest order_date among fresh items for this year
                earliest_fresh = min(
                    (i["order_date"] for i in fresh if i.get("order_date")),
                    default=cutoff_approx.isoformat(),
                )
                kept = [i for i in existing if (i.get("order_date") or "") < earliest_fresh]
                # Preserve return_window_end for items whose date was captured before
                # they transitioned to "Return Started" (Amazon hides the date after that)
                replaced_by_id = {
                    i["item_id"]: i
                    for i in existing
                    if (i.get("order_date") or "") >= earliest_fresh
                }
                _preserve_return_window(fresh, replaced_by_id)
                if verbose:
                    print(
                        f"  [merge] year {year}: earliest fresh date = {earliest_fresh}, "
                        f"keeping {len(kept)} old items + {len(fresh)} fresh items"
                    )
            else:
                # No new items for this year — leave existing file untouched
                if verbose:
                    print(f"  [merge] year {year}: no new items, skipping write")
                continue

            merged = kept + fresh
            print(
                f"Year {year}: keeping {len(kept)} existing + "
                f"{len(fresh)} refreshed = {len(merged)} total"
            )
            write_output(merged, year, email=email)

    write_manifest()

    if verbose:
        print(f"  [summary] Total elapsed: {time.monotonic() - t_total:.1f}s")


if __name__ == "__main__":
    try:
        main()
    finally:
        # Restore real stderr so any unhandled exception traceback prints cleanly.
        sys.stderr = _stderr_interceptor._orig
