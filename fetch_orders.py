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
    from amazonorders.session import AmazonSession
    from amazonorders.orders import AmazonOrders
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
# Build a single item record
# ---------------------------------------------------------------------------

def build_item_record(order, shipment, item, item_id: str) -> dict:
    order_date = date_to_iso(order.order_placed_date)
    return_window_end = (
        date_to_iso(item.return_eligible_date)
        if getattr(item, "return_eligible_date", None)
        else add_days(order_date, 30)
    )

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
        "return_status":         "none",
        "return_initiated_date": None,
        "return_notes":          "",
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
    os.makedirs("data", exist_ok=True)
    with open("data/app_data_manifest.js", "w", encoding="utf-8") as f:
        f.write(f"window.ORDER_DATA_MANIFEST = {json.dumps(years)};\n")
    print(f"Wrote manifest: {years}")


# ---------------------------------------------------------------------------
# Progress display
# ---------------------------------------------------------------------------

class FetchProgress:
    """
    Tracks and displays live progress while get_order_history() runs.

    Strategy:
    - The library pages through order stubs first (fast), then fires all
      detail requests in parallel (slow — one HTTP request per order).
    - We intercept the logging.debug("No next page") call to learn the
      total order count as soon as paging finishes, before details start.
    - We wrap get_order() to count each detail completion as it comes in.
    - A background timer redraws the line every second so elapsed time
      ticks even if no orders complete (e.g. during initial paging).
    """

    def __init__(self, amazon_orders, label: str, verbose: bool = False):
        self._ao = amazon_orders
        self._label = label
        self._verbose = verbose
        self._lock = threading.Lock()
        self._completed = 0
        self._total = 0          # set once paging finishes
        self._t0 = time.monotonic()
        self._done = False

        # --- Hook 1: intercept get_order for per-order detail progress ---
        original_get_order = amazon_orders.get_order

        def _patched_get_order(order_id, clone=None):
            result = original_get_order(order_id, clone=clone)
            self._on_order_done(order_id)
            return result

        amazon_orders.get_order = _patched_get_order
        self._original_get_order = original_get_order

        # --- Hook 2: intercept library logging to detect paging complete ---
        # The library logs debug("No next page") when all pages are fetched.
        # At that point, the order stubs are counted; details haven't started.
        import logging as _logging

        class _PagingHandler(_logging.Handler):
            def __init__(self_, progress_ref):
                super().__init__()
                self_._progress = progress_ref

            def emit(self_, record):
                msg = record.getMessage()
                # "No next page" fires once per year/filter when paging ends
                if "no next page" in msg.lower() or "keep_paging is false" in msg.lower():
                    # We don't know the count yet from the log message alone;
                    # set_total() will be called with the real count once the
                    # library returns. The handler just signals paging is done.
                    pass

        self._log_handler = _PagingHandler(self)
        lib_logger = _logging.getLogger("amazonorders.orders")
        lib_logger.addHandler(self._log_handler)
        lib_logger.setLevel(_logging.DEBUG)

        # --- Background timer: redraws line every second ---
        self._timer = threading.Thread(target=self._tick, daemon=True)
        self._timer.start()

    def _elapsed(self) -> str:
        secs = int(time.monotonic() - self._t0)
        return f"{secs // 60}:{secs % 60:02d}"

    def _redraw(self):
        with self._lock:
            completed = self._completed
            total = self._total
        elapsed = self._elapsed()
        if total:
            pct = completed / total * 100
            line = f"  {self._label}: {completed}/{total} orders ({pct:.0f}%)  [{elapsed}]"
        else:
            line = f"  {self._label}: fetching order list …  [{elapsed}]"
        sys.stdout.write(f"\r{line:<72}")
        sys.stdout.flush()

    def _tick(self):
        while not self._done:
            self._redraw()
            time.sleep(1)

    def _on_order_done(self, order_id: str):
        with self._lock:
            self._completed += 1
            completed = self._completed
            total = self._total
        self._redraw()
        if self._verbose:
            sys.stdout.write(
                f"\n  [API] order {order_id} details fetched"
                f"  ({completed}/{total or '?'}) [{self._elapsed()}]\n"
            )
            sys.stdout.flush()

    def set_total(self, total: int):
        with self._lock:
            self._total = total
        self._redraw()

    def finish(self):
        self._done = True
        self._timer.join(timeout=2)
        # Remove our log handler
        import logging as _logging
        _logging.getLogger("amazonorders.orders").removeHandler(self._log_handler)
        elapsed = self._elapsed()
        with self._lock:
            completed = self._completed
            total = self._total
        sys.stdout.write(
            f"\r  {self._label}: {completed}/{total or completed} orders  [{elapsed}]\n"
        )
        sys.stdout.flush()
        # Restore original method
        self._ao.get_order = self._original_get_order


# ---------------------------------------------------------------------------
# Amazon API helpers
# ---------------------------------------------------------------------------

def _fetch_year_with_retry(
    amazon_orders,
    year: int,
    max_retries: int = 3,
    verbose: bool = False,
) -> list:
    """
    Fetch a single year of orders with retry on network errors.

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
            progress.set_total(len(orders))  # ensure total is set even if hook missed it
            progress.finish()
            if verbose:
                print(f"  [API] → {len(orders)} orders returned")
            return orders
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
    return []   # unreachable, keeps type-checkers happy


def _fetch_incremental_with_retry(
    amazon_orders,
    max_retries: int = 3,
    verbose: bool = False,
) -> list:
    """
    Fetch the last 3 months of orders using the library's native time_filter,
    with retry on network errors.
    """
    if verbose:
        print('  [API] get_order_history(time_filter="months-3", full_details=True)')
    for attempt in range(1, max_retries + 1):
        progress = FetchProgress(amazon_orders, "last 3 months", verbose=verbose)
        try:
            orders = amazon_orders.get_order_history(
                time_filter="months-3", full_details=True
            )
            progress.set_total(len(orders))
            progress.finish()
            if verbose:
                print(f"  [API] → {len(orders)} orders returned")
            return orders
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
    return []   # unreachable


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

    amazon_orders = AmazonOrders(session)
    today = datetime.date.today()
    t_total = time.monotonic()

    if args.year:
        # ------------------------------------------------------------------
        # Historical backfill mode: fetch a single complete calendar year
        # ------------------------------------------------------------------
        year = args.year
        print(f"Mode: historical backfill for {year}")
        print(f"Fetching orders for {year}...")
        raw_orders = _fetch_year_with_retry(amazon_orders, year, verbose=verbose)
        print(f"  Found {len(raw_orders)} orders.")
        items = build_items_from_orders(raw_orders)
        if verbose:
            print(f"  [summary] Built {len(items)} item records from {len(raw_orders)} orders")
        write_output(items, year, email=email)

    else:
        # ------------------------------------------------------------------
        # Incremental mode (default / cron): last 3 months, split by year
        # ------------------------------------------------------------------
        print("Mode: incremental (last 3 months)")
        print("Fetching orders for the last 3 months...")
        raw_orders = _fetch_incremental_with_retry(amazon_orders, verbose=verbose)
        print(f"  Found {len(raw_orders)} orders.")
        new_items = build_items_from_orders(raw_orders)
        if verbose:
            print(f"  [summary] Built {len(new_items)} item records from {len(raw_orders)} orders")

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
    main()
