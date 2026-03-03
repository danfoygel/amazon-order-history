# Amazon Order History — Code Walkthrough

*2026-02-25T23:06:46Z by Showboat 0.6.1*
<!-- showboat-id: 1c64a707-e8e5-4088-8434-a21b06bc0f85 -->

<!-- 
Read the source and then plan a linear walkthrough of the code that explains how it all works in detail

Then run “uvx showboat –help” to learn showboat - use showboat to create a walkthrough.md file in the repo and build the walkthrough in there, using showboat note for commentary and showboat exec plus sed or grep or cat or whatever you need to include snippets of code you are talking about
-->

This walkthrough explains every moving part of the **Amazon Order History** project — a tool that scrapes your Amazon order history and presents it in a fast, filterable, single-page web UI.

The project has two halves:

| Layer | File | Purpose |
|-------|------|---------|
| **Backend** | `fetch_orders.py` | Scrapes Amazon, enriches data, writes JS data files |
| **Backend** | `diagnose_return_policy.py` | Dev-time diagnostic for return-policy HTML |
| **Frontend** | `index.html` | HTML shell — tabs, search, graph modal |
| **Frontend** | `app.js` | All client-side logic — filtering, rendering, charts |
| **Frontend** | `style.css` | Responsive styling with light theme |

Data flows one way: **Python scraper → JS data files on disk → browser loads them**. There is no server at runtime; the frontend is purely static.

Let's start with the project layout.

## Project Structure

```bash
find . -maxdepth 1 -not -name ".*" -not -name walkthrough.md -not -name __pycache__ -not -name "*.egg-info" | sort
```

```output
./CLAUDE.md
./NOTES.md
./README.md
./TODO.md
./app.js
./diagnose_return_policy.py
./fetch_orders.py
./index.html
./style.css
```

The `data/` directory (git-ignored) holds generated output: per-year JS data files (`app_data_YYYY.js`) and a manifest (`app_data_manifest.js`). A `.env` file (also git-ignored) stores Amazon credentials.

Let's look at what dependencies the Python backend needs.

```bash
head -5 .env.example
```

```output
AMAZON_EMAIL=your@email.com
AMAZON_PASSWORD=your_amazon_password
# Optional: only needed if your account uses TOTP MFA (Google Authenticator etc.)
# This is the base32 secret from your authenticator app setup, NOT a one-time code.
AMAZON_OTP_SECRET=
```

## Backend: fetch_orders.py

This is the heart of the project — a ~1,070 line Python script that logs into Amazon, scrapes order history, enriches each item with return-policy data, and writes per-year JavaScript data files to disk.

### Imports and Configuration

The script uses soft imports — `dateutil`, `BeautifulSoup`, and `requests` are optional, degrading gracefully if missing. The one hard requirement is `amazon-orders`, the unofficial scraping library.

```bash
sed -n '17,55p' fetch_orders.py
```

```output
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
```

Notice the pattern: `dateutil` and `bs4` are wrapped in `try/except` and set to `None` if missing — functions that need them check before calling. But `amazon-orders` is a hard requirement: if it's missing, the script exits immediately with an install hint. `load_dotenv()` reads `.env` into the environment right at import time.

### Carrier Detection

When items ship, Amazon provides a tracking URL. The script identifies the carrier by checking the URL's hostname against a pattern table:

```bash
sed -n '61,82p' fetch_orders.py
```

```output
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
```

Simple substring matching on the hostname. The `urlparse` call isolates the domain so query strings and paths don't cause false matches.

### ASIN Extraction and Slugification

Amazon product links contain the ASIN (Amazon Standard Identification Number) in the URL path. The script extracts it with a regex. For items without ASINs (digital content, gift cards), it falls back to a slugified title to generate a stable item ID:

```bash
sed -n '115,133p' fetch_orders.py
```

```output
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

```

The ASIN regex matches both `/dp/B0123456789` and `/gp/product/B0123456789` URL formats. The slug is capped at 40 characters to keep IDs manageable.

### Return Policy Extraction from Order Pages

Amazon's order detail pages embed return eligibility info in HTML, but the format is fragile and changes over time. The `extract_return_info` function parses each item's order-page HTML to extract the return window end date and policy:

- **`free_or_replace`** — "Return or replace items" text found (Amazon-fulfilled with free returns)
- **`return_only`** — "Return items" text (third-party seller, returns may not be free)
- **`non_returnable`** — no return span *and* the connections div is empty (food, supplements, consumables)
- **`None`** — ambiguous (e.g. expired return window where policy can't be determined from the closed text)

The date is extracted using `dateutil.parser.parse()` with fuzzy matching, which handles text like "Eligible through March 22, 2026".

### Building Item Records

Each order from the Amazon API contains shipments, which contain items. The script flattens this hierarchy into a list of item dicts — one record per item, carrying all the metadata the frontend needs:

```bash
sed -n '472,531p' fetch_orders.py
```

```output
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
```

The **item ID** format is `{order_number}__{asin}` — e.g. `123-4567890-1234567__B0ABCDEFGH`. If the same ASIN appears twice in one order (quantity 2 shipped separately), a `__2` suffix is appended as a disambiguator.

The `subscribe_and_save` flag is detected cleverly: if the order has a `subscription_discount` attribute at all (even $0), it's an S&S order.

Note the defensive `getattr(..., None) or ""` pattern used throughout — the `amazon-orders` library doesn't guarantee every attribute exists, so the code never assumes.

### File I/O: Year Files and Manifest

Each calendar year gets its own JavaScript file. The format is designed for zero-config browser loading — it assigns data to a `window` global:

```bash
sed -n '569,596p' fetch_orders.py
```

```output
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
```

The year file format:

```
window.ORDER_DATA_2024 = { "generated_at": "...", "email": "...", "items": [...] };
```

The manifest file:

```
window.ORDER_DATA_MANIFEST = [2026, 2025, 2024, 2023];
window.ORDER_DATA_YEAR_COUNTS = {"2026": 45, "2025": 312, ...};
```

This design means the frontend can load just the manifest first, know how many items exist per year, and then selectively load only the year files it needs. No server required — just `file://` or any static file server.

### Return Window Preservation

A subtle but important piece: when you start a return on Amazon, the order page stops showing the return-eligibility date. Without special handling, re-fetching would overwrite the date with `null`. The `_preserve_return_window` function prevents this:

```bash
sed -n '554,567p' fetch_orders.py
```

```output
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

```

This is called during both incremental and backfill merges — it looks up each fresh item in the existing on-disk records and restores the date if the fresh fetch lost it.

### The Main Function: Two Operating Modes

The script supports two modes, controlled by the `--year` flag:

```bash
sed -n '931,968p' fetch_orders.py
```

```output
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
    config = AmazonOrdersConfig(data={"warn_on_missing_required_field": True})
    amazon_orders = AmazonOrders(session, config=config)
    today = datetime.date.today()
```

After login, the script enters one of two paths. In **historical backfill mode** (`--year 2023`), it fetches the entire calendar year and writes it as a single file:

```bash
sed -n '971,987p' fetch_orders.py
```

```output
    if args.year:
        # ------------------------------------------------------------------
        # Historical backfill mode: fetch a single complete calendar year
        # ------------------------------------------------------------------
        year = args.year
        print(f"Mode: historical backfill for {year}")
        existing_items = load_existing_items(year)
        existing_by_id = {i["item_id"]: i for i in existing_items}
        print(f"Fetching orders for {year}...")
        raw_orders = _fetch_year_with_retry(amazon_orders, year, verbose=verbose)
        print(f"  Found {len(raw_orders)} orders.")
        items = build_items_from_orders(raw_orders)
        if verbose:
            print(f"  [summary] Built {len(items)} item records from {len(raw_orders)} orders")
        _preserve_return_window(items, existing_by_id)
        write_output(items, year, email=email)
```

In **incremental mode** (default, no flags), it fetches the last 3 months and merges into the existing year files. The merge is the most complex part of the main function — it handles year boundaries, preserves old items that are outside the 3-month window, and prevents data loss:

```bash
sed -n '989,1060p' fetch_orders.py
```

```output
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

```

The merge strategy is clever:

1. **Partition new items by year** — a 3-month fetch around New Year's may span two calendar years
2. **Always touch both years** — the current year and the year from 90 days ago, even if one has zero new items
3. **Keep older items** — everything with an order date before the earliest fresh item is preserved verbatim from the existing file
4. **Replace the rest** — items within the fresh date range are replaced entirely by the new fetch (which has the latest status)
5. **Preserve return windows** — for items transitioning to "Return Started"

### Progress Display

The `FetchProgress` class is the most engineering-heavy part of the backend. The `amazon-orders` library fetches order details asynchronously (one HTTP request per order in parallel), but doesn't expose progress callbacks. So the script monkey-patches the library's internals:

```bash
sed -n '647,662p' fetch_orders.py
```

```output
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
```

The class uses two hooks:

1. **Hook 1**: wraps `_build_order()` to count each order completion — this catches all orders including unsupported types (Fresh, Whole Foods)
2. **Hook 2**: wraps `_build_orders_async()` to intercept `asyncio.gather()` and learn the total order count the moment paging completes

A background timer thread redraws the `\r` progress line every second. The `_StderrInterceptor` class buffers library warnings to prevent them from corrupting the progress display — they're flushed after the final progress line.

### Network Retry Logic

Both fetch modes wrap the API call in retry logic with exponential backoff:

```bash
sed -n '834,880p' fetch_orders.py
```

```output
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
        except Exception:
            # Stop the timer and restore stderr before letting the traceback print,
            # so the exception is not interleaved with \r progress lines.
            progress.finish()
            raise
    return []   # unreachable, keeps type-checkers happy
```

Each retry creates a fresh `FetchProgress` instance, and `progress.finish()` is always called — even on error — to stop the background timer thread and restore stderr. The exponential backoff (1s, 2s, 4s) handles the macOS DNS resolver issue where bursts of parallel HTTP requests cause spurious name resolution failures.

---

## Frontend: index.html

The HTML is minimal — 57 lines. It's a shell that sets up the layout and loads scripts:

```bash
cat index.html
```

```output
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Amazon Order History</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <header>
    <h1>Order History</h1>
    <input type="search" id="search-input" placeholder="Search by title, ASIN, or order ID…" autocomplete="off">
    <div id="meta-bar"></div>
  </header>

  <nav id="filter-tabs">
    <button class="tab tab-action" data-filter="combined">Combined</button>
    <button class="tab tab-action" data-filter="mail_back">Mail Back <span class="count"></span></button>
    <button class="tab tab-action" data-filter="decide">Decide <span class="count"></span></button>
    <button class="tab" data-filter="all">All <span class="count"></span></button>
    <button class="tab" data-filter="Ordered">Ordered <span class="count"></span></button>
    <button class="tab" data-filter="Shipped">Shipped <span class="count"></span></button>
    <button class="tab" data-filter="Delivered">Delivered <span class="count"></span></button>
    <button class="tab" data-filter="Replacement Ordered">Replacement <span class="count"></span></button>
    <button class="tab" data-filter="Return Started">Return Started <span class="count"></span></button>
    <button class="tab" data-filter="Return in Transit">Return in Transit <span class="count"></span></button>
    <button class="tab" data-filter="Return Complete">Return Complete <span class="count"></span></button>
    <button class="tab" data-filter="Cancelled">Cancelled <span class="count"></span></button>
    <label id="sns-filter-label" title="Show only Subscribe &amp; Save items">
      <input type="checkbox" id="sns-filter"> <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;margin-bottom:1px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> S&amp;S only <span id="sns-count"></span>
    </label>
  </nav>

  <main id="item-list"></main>

  <!-- Graph modal -->
  <dialog id="graph-modal">
    <div id="graph-modal-card">
      <div id="graph-modal-header">
        <span id="graph-modal-title">Items by Status &amp; Year</span>
        <button id="graph-modal-close" aria-label="Close">&times;</button>
      </div>
      <div id="graph-modal-body">
        <canvas id="graph-canvas"></canvas>
      </div>
    </div>
  </dialog>

  <!-- Step 1: manifest sets window.ORDER_DATA_MANIFEST and window.ORDER_DATA_YEAR_COUNTS -->
  <script src="data/app_data_manifest.js"></script>
  <!-- Step 2: Chart.js (for graph modal) -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <!-- Step 3: app logic — dynamically loads only the year files it needs -->
  <script src="app.js"></script>
</body>
</html>
```

The key architectural points:

- **Three script loads at the bottom**: manifest first (sync), then Chart.js from CDN, then app.js
- **12 filter tabs** in the nav: 3 "action" tabs (Combined, Mail Back, Decide) and 8 status tabs, plus an S&S filter checkbox
- **`<dialog>` for the graph modal** — native HTML dialog, no library needed
- **`<main id="item-list">`** — the single container where all cards are rendered dynamically
- Year data files are *not* loaded here — `app.js` handles that dynamically

## Frontend: app.js

The frontend is ~1,090 lines of vanilla JavaScript — no framework, no bundler. It handles everything: data loading, status classification, filtering, sorting, rendering, charts, and localStorage persistence.

### State and Boot Sequence

Global state is minimal — just a few variables:

```bash
sed -n '1,11p' app.js
```

```output
"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let allItems = [];
let currentFilter = "combined";
let currentSearch = "";
let currentSnsOnly = false;
let loadedYears = new Set();   // which year files have been fetched so far
let totalItemCount = 0;        // sum across ALL years (from ORDER_DATA_YEAR_COUNTS)
```

The boot sequence starts at the bottom of the file with `init()`. Here's how data gets loaded — note the fast-load optimization:

```bash
sed -n '703,711p' app.js
```

```output
/**
 * Returns the subset of manifest years whose calendar year is >= the year
 * of (today minus 3 months).  At most 2 years are returned (current + prior).
 */
function initialYears(manifest) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffYear = cutoff.getFullYear();
  return manifest.filter(y => y >= cutoffYear);
```

```bash
sed -n '830,870p' app.js
```

```output
async function init() {
  const container = document.getElementById("item-list");
  const manifest = window.ORDER_DATA_MANIFEST;

  if (!manifest || manifest.length === 0) {
    container.innerHTML = `
      <div class="error-state">
        <h2>Could not load order data</h2>
        <p>
          Run <code>.venv/bin/python3 fetch_orders.py</code> to generate
          <code>data/app_data_manifest.js</code> and year data files,
          then open <code>index.html</code> directly in your browser.
        </p>
      </div>`;
    return;
  }

  // Compute total item count from manifest metadata (if available)
  const yearCounts = window.ORDER_DATA_YEAR_COUNTS || {};
  totalItemCount = Object.values(yearCounts).reduce((sum, n) => sum + n, 0);

  // Determine which years to load now (those covering the last 3 months)
  const yearsToLoad = initialYears(manifest);

  // Dynamically load only the needed year scripts
  await Promise.all(yearsToLoad.map(y => loadScript(`data/app_data_${y}.js`)));

  // Merge loaded year data into allItems
  const { latestGeneratedAt, email } = mergeYears(yearsToLoad);

  // Build the meta-bar and (conditionally) the Show Graph button
  renderMetaBar(manifest, latestGeneratedAt, email);

  // Activate the default tab visually
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === currentFilter);
  });

  logDiagnostics(allItems);
  refreshView();
}
```

The **fast load** optimization: on a page load today (February 2026), `initialYears` returns only `[2026, 2025]` — the years covering the last 3 months. This means if you have 5+ years of order history, only ~3 months of data loads initially. The UI shows "142 of 1,847 items (load all)" with a link to fetch the rest.

When "load all" is clicked, `loadAllYears()` dynamically injects `<script>` tags for the remaining year files, merges them into `allItems`, and re-renders.

### Status Derivation

Raw `delivery_status` strings from Amazon are messy and inconsistent ("Arriving Saturday", "Delivered Feb 22", "Not yet shipped"). The `deriveStatus` function maps them to 8 canonical statuses using a priority-ordered rule table:

```bash
sed -n '37,95p' app.js
```

```output
const STATUS_RULES = [
  // Cancelled
  ["cancelled",              "Cancelled"],
  ["canceled",               "Cancelled"],
  // Return states
  ["return complete",        "Return Complete"],
  ["return received",        "Return Complete"],
  ["replacement complete",   "Return Complete"],
  ["return started",         "Return Started"],
  ["return in transit",      "Return in Transit"],
  ["refunded",               "Return in Transit"],
  ["refund issued",          "Return in Transit"],
  ["replacement ordered",    "Replacement Ordered"],
  // Delivered
  ["delivered",              "Delivered"],
  // Shipped / en route ("not yet shipped" must precede "shipped" to avoid false match)
  ["out for delivery",       "Shipped"],
  ["on the way",             "Shipped"],
  ["not yet shipped",        "Ordered"],
  ["shipped",                "Shipped"],
  ["in transit",             "Shipped"],
  ["now arriving",           "Shipped"],
  ["arriving",               "Shipped"],
  // Not yet shipped
  ["preparing for shipment", "Ordered"],
  ["order placed",           "Ordered"],
  ["payment pending",        "Ordered"],
];

const ASSUME_DELIVERED_AFTER_DAYS = 14;

// Returns true only when the tracking URL contains a shipmentId parameter,
// which Amazon adds once a package has been assigned to a carrier.
function hasShipmentId(trackingUrl) {
  if (!trackingUrl) return false;
  try { return new URL(trackingUrl).searchParams.has("shipmentId"); }
  catch { return false; }
}

function deriveStatus(deliveryStatus, orderDate, trackingUrl) {
  const key = (deliveryStatus || "").trim().toLowerCase();
  if (!key) {
    if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
    return "Ordered";
  }
  for (const [pattern, value] of STATUS_RULES) {
    if (key.includes(pattern)) {
      // "arriving" alone is ambiguous: Amazon shows "Arriving [date]" for both
      // pre-ship estimated delivery dates AND in-transit packages.  Use the
      // presence of shipmentId in the tracking URL as the tiebreaker.
      if (pattern === "arriving" && value === "Shipped" && !hasShipmentId(trackingUrl)) {
        return "Ordered";
      }
      return value;
    }
  }
  if (orderDate && daysSince(orderDate) > ASSUME_DELIVERED_AFTER_DAYS) return "Delivered";
  return "Ordered";
}
```

Important details in the status logic:

- **Rule order matters**: "not yet shipped" is checked before "shipped" to avoid the substring match misfiring
- **"Arriving" is ambiguous**: Amazon uses it for both pre-ship estimates and in-transit tracking. The `shipmentId` URL parameter is the tiebreaker — if present, the carrier has the package
- **14-day fallback**: If an order is >14 days old with no recognized status, it's assumed delivered
- **Status was moved from Python to JavaScript**: The comment says "mirrors logic that was previously in fetch_orders.py" — this lets the frontend re-derive status without re-fetching

On top of `deriveStatus`, there's `effectiveStatus` which applies post-processing:

```bash
sed -n '326,336p' app.js
```

```output
function effectiveStatus(item) {
  const status = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
  if ((status === "Return Started" || status === "Replacement Ordered") && item.return_window_end) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysOverdue = Math.ceil((today - end) / (1000 * 60 * 60 * 24));
    if (daysOverdue > 30) return "Delivered";
  }
  return status;
}
```

`effectiveStatus` handles abandoned returns: if an item has been in "Return Started" for over 30 days past the return deadline, it's demoted back to "Delivered". This prevents old, never-shipped returns from cluttering the action tabs.

### Kept Items (localStorage)

The "Keep" feature lets users mark items they've decided not to return, removing them from the Mail Back and Decide action tabs:

```bash
sed -n '16,32p' app.js
```

```output
const KEPT_KEY = "amazon_order_history_kept";

function loadKept() {
  try { return new Set(JSON.parse(localStorage.getItem(KEPT_KEY)) || []); }
  catch { return new Set(); }
}
function saveKept(set) {
  localStorage.setItem(KEPT_KEY, JSON.stringify([...set]));
}
function isKept(item) { return keptIds.has(item.item_id); }
function toggleKept(item) {
  if (keptIds.has(item.item_id)) { keptIds.delete(item.item_id); }
  else { keptIds.add(item.item_id); }
  saveKept(keptIds);
}

let keptIds = loadKept();
```

Simple but effective — persisted as a JSON array in localStorage, loaded into a `Set` for O(1) lookups. The `try/catch` around `JSON.parse` handles corrupted storage gracefully.

### Filtering and Sorting

The filter system has two layers: tab filtering and search filtering. The `filterItems` function applies both:

```bash
sed -n '155,219p' app.js
```

```output
function filterItems(items, tab, searchQuery) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return items.filter(item => {
    if (currentSnsOnly && !item.subscribe_and_save) return false;
    let tabMatch;
    if (tab === "all") {
      tabMatch = true;
    } else if (tab === "mail_back") {
      const status = effectiveStatus(item);
      tabMatch = (status === "Return Started" || status === "Replacement Ordered") && !isKept(item);
    } else if (tab === "decide") {
      if (effectiveStatus(item) !== "Delivered") { tabMatch = false; }
      else if (isKept(item)) { tabMatch = false; }
      else if (!item.return_window_end) { tabMatch = false; }
      else {
        const end = new Date(item.return_window_end + "T00:00:00");
        tabMatch = end >= today;
      }
    } else {
      tabMatch = effectiveStatus(item) === tab;
    }
    if (!tabMatch) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.title || "").toLowerCase().includes(q) ||
      (item.asin || "").toLowerCase().includes(q) ||
      (item.order_id || "").toLowerCase().includes(q)
    );
  });
}

function sortItems(items, sort) {
  const arr = [...items];
  switch (sort) {
    case "order_date_asc":
      return arr.sort((a, b) => (a.order_date || "").localeCompare(b.order_date || ""));
    case "order_date_desc":
      return arr.sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""));
    case "price_desc":
      return arr.sort((a, b) => (b.unit_price ?? 0) - (a.unit_price ?? 0));
    case "price_asc":
      return arr.sort((a, b) => (a.unit_price ?? 0) - (b.unit_price ?? 0));
    case "return_window_asc":
      return arr.sort((a, b) => {
        if (!a.return_window_end && !b.return_window_end) return 0;
        if (!a.return_window_end) return 1;
        if (!b.return_window_end) return -1;
        return a.return_window_end.localeCompare(b.return_window_end);
      });
    case "expected_delivery_asc":
      return arr.sort((a, b) => {
        const da = parseExpectedDelivery(a.delivery_status);
        const db = parseExpectedDelivery(b.delivery_status);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
    default:
      return arr;
  }
}
```

The **Mail Back** tab shows items with active returns that need to be mailed back (not marked "Keep"). The **Decide** tab shows delivered items still within their return window that haven't been marked as "Keep".

The sort has two special modes: `return_window_asc` (for deadline-sorted tabs) and `expected_delivery_asc` (for in-transit items, which parses the estimated delivery date from the status text).

### The Combined View

The default "Combined" tab is the most complex rendering path. Instead of a flat list, it creates collapsible sections prioritized by urgency:

```bash
sed -n '551,626p' app.js
```

```output
function renderCombined(allFiltered) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mailBack = sortItems(
    allFiltered.filter(i => { const s = effectiveStatus(i); return (s === "Return Started" || s === "Replacement Ordered") && !isKept(i); }),
    "return_window_asc"
  );
  const decide = sortItems(
    allFiltered.filter(i => {
      if (effectiveStatus(i) !== "Delivered") return false;
      if (isKept(i)) return false;
      if (!i.return_window_end) return false;
      return new Date(i.return_window_end + "T00:00:00") >= today;
    }),
    "return_window_asc"
  );
  const shipped = sortItems(
    allFiltered.filter(i => effectiveStatus(i) === "Shipped"),
    "expected_delivery_asc"
  );
  const ordered = sortItems(
    allFiltered.filter(i => effectiveStatus(i) === "Ordered"),
    "expected_delivery_asc"
  );
  const restItems = sortItems(
    allFiltered.filter(i => {
      const s = effectiveStatus(i);
      if ((s === "Return Started" || s === "Replacement Ordered") && !isKept(i)) return false;
      if (s === "Shipped") return false;
      if (s === "Ordered") return false;
      if (s === "Delivered" && !isKept(i) && i.return_window_end && new Date(i.return_window_end + "T00:00:00") >= today) return false;
      return true;
    }),
    "order_date_desc"
  );

  // Group "rest" items by order month (YYYY-MM), most recent first
  const byMonth = new Map();
  for (const item of restItems) {
    const key = (item.order_date || "").slice(0, 7); // "YYYY-MM"
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(item);
  }
  const monthSections = [...byMonth.entries()].map(([key, items]) => {
    const [year, month] = key.split("-");
    const label = key
      ? new Date(Number(year), Number(month) - 1, 1)
          .toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "Unknown";
    return { label, items };
  });

  const container = document.getElementById("item-list");
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const fixedSections = [
    { label: "Mail Back", items: mailBack },
    { label: "Decide",    items: decide   },
    { label: "Shipped",   items: shipped  },
    { label: "Ordered",   items: ordered  },
  ];

  for (const { label, items } of fixedSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderCollapsibleSection(label, items));
  }

  for (const { label, items } of monthSections) {
    if (items.length === 0) continue;
    fragment.appendChild(renderCollapsibleSection(label, items));
  }

  container.appendChild(fragment);
}
```

The Combined view creates sections in priority order:

1. **Mail Back** — items needing to be returned, sorted by deadline (most urgent first)
2. **Decide** — delivered items still within their return window, sorted by deadline
3. **Shipped** — in-transit items, sorted by expected delivery date
4. **Ordered** — not-yet-shipped items, sorted by expected delivery date
5. **Monthly groups** — everything else (delivered, cancelled, return-complete, etc.), grouped by order month

Each section uses `renderCollapsibleSection` which creates a clickable heading with a chevron toggle. Empty sections are skipped entirely.

### Card Rendering

Each item is rendered as a card with a thumbnail, title, badges, and metadata:

```bash
sed -n '431,497p' app.js
```

```output
function renderCard(item) {
  const href = orderUrl(item);
  const titleHtml = href
    ? `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(item.title)}</a>`
    : escHtml(item.title);

  const priceHtml = item.unit_price !== null && item.unit_price !== undefined
    ? `<span class="price">${formatPrice(item.unit_price)}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</span>`
    : "";

  const itemStatus = effectiveStatus(item);
  const expectedDelivery = (itemStatus === "Shipped" || itemStatus === "Ordered")
    ? parseExpectedDelivery(item.delivery_status)
    : null;
  const etaLabel = itemStatus === "Ordered" ? "Expected" : "Arrives";
  const expectedDeliveryHtml = expectedDelivery
    ? `<span class="delivery-eta">${etaLabel} ${formatDateNearby(expectedDelivery)}</span>`
    : "";

  const article = document.createElement("article");
  article.className = "item-card";
  article.dataset.itemId = item.item_id;

  const kept = isKept(item);
  const showKeep = isDecideEligible(item) || isMailBackEligible(item);
  const keepTitle = isMailBackEligible(item)
    ? (kept ? "Unmark as not returning" : "Not returning (remove from Mail Back)")
    : (kept ? "Unmark as kept" : "Keep (remove from Decide)");
  const keepBtn = showKeep
    ? `<button class="keep-btn${kept ? " kept" : ""}" title="${keepTitle}">${kept ? "✓ Kept" : "Keep"}</button>`
    : "";

  const snsHtml = item.subscribe_and_save
    ? `<span class="icon-badge badge-sns" title="Subscribe &amp; Save"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`
    : "";

  article.innerHTML = `
    <div class="card-top">
      ${thumbnailHtml(item)}
      <div class="card-top-right">
        <div class="card-title">${titleHtml}</div>
        <div class="card-badges">
          ${statusBadgeHtml(effectiveStatus(item))}
          ${returnWindowHtml(item)}
          ${snsHtml}
          ${returnPolicyIcon(item)}
        </div>
        <div class="card-meta">
          <span>Ordered ${formatDate(item.order_date)}</span>
          ${item.quantity > 1 ? `<span>Qty: ${item.quantity}</span>` : ""}
          ${priceHtml}
          ${expectedDeliveryHtml}
        </div>
      </div>
    </div>
    ${keepBtn}
  `;

  if (showKeep) {
    article.querySelector(".keep-btn").addEventListener("click", () => {
      toggleKept(item);
      refreshView();
    });
  }

  return article;
}
```

Each card has:
- **Thumbnail** — lazy-loaded image with an `onerror` handler that hides the image if it 404s
- **Title** — linked to the Amazon order details page
- **Badge row** — status badge + return window badge + S&S icon + return policy icon
- **Meta row** — order date, quantity (if >1), unit price, expected delivery (if in transit)
- **Keep button** — only shown for Mail Back / Decide eligible items

The title is HTML-escaped via `escHtml()` to prevent XSS from product titles with special characters.

### Return Window and Policy Badges

The `returnWindowHtml` function generates color-coded return deadline badges. The coloring depends on urgency:

```bash
sed -n '341,380p' app.js
```

```output
function returnWindowHtml(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const status = effectiveStatus(item);

  if (status === "Delivered") {
    if (!item.return_window_end) return "";
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    const dateStr = formatDateNearby(item.return_window_end);
    const daysHint = (daysLeft >= 0 && daysLeft <= 7 && !["today", "tomorrow", "yesterday"].includes(dateStr))
      ? ` (${daysLeft}d left)` : "";
    if (daysLeft < 0) {
      return `<span class="badge return-badge-closed">Return window closed</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Return by ${dateStr}${daysHint}</span>`;
    }
    return `<span class="badge return-badge-ok">Return by ${dateStr}</span>`;
  }

  if (status === "Return Started" || status === "Replacement Ordered") {
    if (!item.return_window_end) return `<span class="badge return-badge-warn">⚠ Mail back — deadline unknown</span>`;
    const end = new Date(item.return_window_end + "T00:00:00");
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    const dateStr = formatDateNearby(item.return_window_end);
    const daysHint = (daysLeft >= 0 && daysLeft <= 7 && !["today", "tomorrow", "yesterday"].includes(dateStr))
      ? ` (${daysLeft}d left)` : "";
    if (daysLeft < 0) {
      return `<span class="badge return-badge-overdue">Mail back by ${dateStr}</span>`;
    }
    if (daysLeft <= 7) {
      return `<span class="badge return-badge-warn">⚠ Mail back by ${dateStr}${daysHint}</span>`;
    }
    return `<span class="badge return-badge-ok">Mail back by ${dateStr}</span>`;
  }

  return "";
}
```

The badge color coding:

| Situation | Badge Style | Example |
|-----------|------------|---------|
| Delivered, >7 days left | Green | "Return by Mar 15" |
| Delivered, ≤7 days left | Yellow with warning | "⚠ Return by tomorrow (1d left)" |
| Delivered, window closed | Struck-through | "Return window closed" |
| Return Started, >7 days | Green | "Mail back by Mar 15" |
| Return Started, ≤7 days | Yellow with warning | "⚠ Mail back by Mar 2 (3d left)" |
| Return Started, overdue | Amber/overdue | "Mail back by yesterday" |
| Return Started, no date | Yellow with warning | "⚠ Mail back — deadline unknown" |

The `formatDateNearby` helper converts dates within 1 day of today to human-friendly "yesterday"/"today"/"tomorrow" labels, and omits the year for dates in the current year.

The `returnPolicyIcon` function adds small inline SVG icons next to each item:

```bash
sed -n '385,401p' app.js
```

```output
function returnPolicyIcon(item) {
  const policy = item.return_policy;
  if (policy === "free_or_replace") {
    // Clockwise circular arrow — free returns
    return `<span class="icon-badge badge-free-returns" title="Free returns"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></span>`;
  }
  if (policy === "non_returnable") {
    // Circle with diagonal slash — non-returnable
    return `<span class="icon-badge badge-no-return" title="Non-returnable"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>`;
  }
  if (policy === "return_only") {
    // Corner-return arrow — returns allowed (but not free)
    return `<span class="icon-badge badge-return-only" title="Returns allowed"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg></span>`;
  }
  // null/missing: no icon shown
  return "";
}
```

Three SVG icons in colored pills:
- **Green circular arrow** — free returns (Amazon-fulfilled)
- **Red circle-slash** — non-returnable (food, consumables)
- **Yellow corner arrow** — returns allowed but may not be free (third-party seller)

All SVGs are inline — no external icon library needed.

### Graph Modal

When all data is loaded, two graph buttons appear in the meta bar. They open a `<dialog>` modal with stacked bar charts using Chart.js:

```bash
sed -n '929,955p' app.js
```

```output
const GRAPH_STATUSES = [
  "Ordered",
  "Shipped",
  "Delivered",
  "Replacement Ordered",
  "Return Started",
  "Return in Transit",
  "Return Complete",
  "Cancelled",
];

// Display labels for chart legends (where internal status name differs)
const GRAPH_STATUS_LABELS = {
  "Replacement Ordered": "Replacement",
};

// Colors aligned with existing badge palette in style.css
const GRAPH_STATUS_COLORS = {
  "Ordered":             "#6b7280",   // pending gray
  "Shipped":             "#2563eb",   // blue
  "Delivered":           "#16a34a",   // green
  "Replacement Ordered": "#6d28d9",   // purple
  "Return Started":      "#d97706",   // amber
  "Return in Transit":   "#06b6d4",   // cyan (clearly distinct from blue)
  "Return Complete":     "#9ca3af",   // muted gray
  "Cancelled":           "#dc2626",   // red
};
```

Two chart types are available:

- **Years chart** — one stacked bar per calendar year, showing how many items ended up in each status
- **Months chart** — trailing 12 months, same breakdown but at monthly granularity

The stack order is reversed from the array order: Cancelled sits at the bottom, Ordered at the top. The legend uses `reverse: true` so it reads left-to-right in natural order (Ordered, Shipped, Delivered, ..., Cancelled).

Chart.js is loaded from CDN and the chart is created inside `requestAnimationFrame` to ensure the modal's `<canvas>` has dimensions before Chart.js measures it.

### Console Diagnostics

On every page load, `logDiagnostics` prints a summary to the browser's DevTools console:

```bash
sed -n '876,923p' app.js
```

```output
function logDiagnostics(items) {
  const statusCounts = {};
  const deliverySamples = {};  // derived status → [delivery_status strings]
  const unknownSamples  = [];  // delivery_status strings that fell through to default

  for (const item of items) {
    const s = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    if (item.delivery_status) {
      if (!deliverySamples[s]) deliverySamples[s] = new Set();
      deliverySamples[s].add(item.delivery_status);
    }

    // Flag items whose raw delivery_status doesn't match any known keyword
    // and whose derived status is Delivered/Ordered (possible mis-classification).
    if (item.delivery_status && (s === "Ordered" || s === "Delivered")) {
      const raw = item.delivery_status.toLowerCase();
      const knownKeywords = [
        "cancelled", "canceled", "return", "refund", "replacement", "delivered",
        "out for delivery", "on the way", "not yet shipped", "shipped", "in transit",
        "now arriving", "arriving", "preparing", "order placed", "payment pending",
      ];
      if (!knownKeywords.some(k => raw.includes(k))) {
        unknownSamples.push({ status: s, delivery_status: item.delivery_status });
      }
    }
  }

  // Convert sets to sorted arrays for readability
  const samples = {};
  for (const [k, v] of Object.entries(deliverySamples)) {
    samples[k] = [...v].slice(0, 5);
  }

  console.group("Order History Diagnostics");
  console.log(`Total items: ${items.length}`);
  console.table(statusCounts);
  console.log("Sample raw delivery_status by derived status:", samples);
  if (unknownSamples.length) {
    console.warn(
      `${unknownSamples.length} item(s) have unrecognised delivery_status strings ` +
      `(check STATUS_RULES in app.js):`,
      unknownSamples.slice(0, 20)
    );
  }
  console.groupEnd();
}
```

This is a development aid — open DevTools Console and you'll see a table of item counts per status, sample raw `delivery_status` strings for each category, and warnings for any unrecognized status strings. This makes it easy to add new rules to `STATUS_RULES` when Amazon introduces new delivery status formats.

---

## Frontend: style.css

The CSS provides a responsive, light-themed design. Let's look at the key structural styles:

```bash
grep -n 'badge-delivered\|badge-in-transit\|badge-pending\|badge-cancelled\|badge-return-started\|badge-return-transit\|badge-return-complete\|badge-replacement\|return-badge-ok\|return-badge-warn\|return-badge-closed\|return-badge-overdue\|badge-free-returns\|badge-no-return\|badge-return-only\|badge-sns' style.css | head -30
```

```output
242:.badge-delivered         { background: #dcfce7; color: var(--color-delivered); }
243:.badge-in-transit        { background: #dbeafe; color: var(--color-in-transit); }
244:.badge-pending           { background: #f3f4f6; color: var(--color-pending); }
245:.badge-cancelled         { background: #fee2e2; color: var(--color-cancelled); }
246:.badge-return-started    { background: #fef3c7; color: #92400e; }
247:.badge-return-transit    { background: #cffafe; color: var(--color-return-active); }
248:.badge-return-complete   { background: #f3f4f6; color: var(--color-pending); }
249:.badge-replacement       { background: #ede9fe; color: #6d28d9; }
250:.badge-sns               { background: #dbeafe; color: #1d4ed8; }
253:.return-badge-ok       { background: #f3f4f6; color: var(--color-pending); }
254:.return-badge-warn     { background: #fef3c7; color: #92400e; }
255:.return-badge-overdue  { background: #fee2e2; color: var(--color-cancelled); }
256:.return-badge-closed   { background: #f3f4f6; color: var(--color-pending); text-decoration: line-through; opacity: 0.7; }
273:.badge-free-returns { background: #dcfce7; color: #15803d; } /* green  */
274:.badge-return-only  { background: #fef9c3; color: #854d0e; } /* yellow */
275:.badge-no-return    { background: #fee2e2; color: #b91c1c; } /* red    */
```

```bash
sed -n '1,30p' style.css
```

```output
/* ── Design tokens ── */
:root {
  --color-delivered:     #16a34a;
  --color-in-transit:    #2563eb;
  --color-pending:       #6b7280;
  --color-cancelled:     #dc2626;
  --color-return-active: #0891b2;

  --bg:        #f3f4f6;
  --bg-card:   #ffffff;
  --border:    #e5e7eb;
  --text:      #111827;
  --text-muted:#6b7280;
  --accent:    #f97316;

  --card-radius: 8px;
  --card-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --tab-radius:  6px;

  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* ── Reset & base ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
```

The CSS uses design tokens (CSS custom properties) for all colors, ensuring consistency between badges, cards, and graph colors. The color palette is intentionally muted with careful contrast — green for positive states, red for negative, amber/yellow for warnings, gray for neutral.

Key design decisions:
- **System font stack** — no web fonts to load
- **Responsive layout** — cards stack cleanly on mobile via flexible widths
- **Badge system** — lightweight colored pills using background + text color pairs
- **Return-closed badge** — uses `text-decoration: line-through` plus reduced opacity
- **Collapsible sections** — toggle via `.collapsed` class which hides `.section-items`
- **Graph modal** — uses native `<dialog>` with backdrop click to close

---

## Diagnostic Tool: diagnose_return_policy.py

This is a development-time utility, not part of the main workflow. It fetches orders and dumps raw HTML for each item, helping developers understand Amazon's return policy page structure:

```bash
sed -n '36,55p' diagnose_return_policy.py
```

```output
def inspect_item(item, order, count, out):
    """Print return-policy diagnostics for a single item to both stdout and file."""
    title = getattr(item, "title", "") or ""
    return_eligible_date = getattr(item, "return_eligible_date", None)

    header = (
        f"\n{'=' * 72}\n"
        f"Item {count}: {title[:65]}\n"
        f"Order: {order.order_number}  |  return_eligible_date: {return_eligible_date}\n"
    )
    print(header, end="")
    out.write(header)

    parsed = getattr(item, "parsed", None)
    if parsed is None:
        msg = "  [item.parsed is None — library version issue?]\n"
        print(msg, end="")
        out.write(msg)
        return

```

For each item, the diagnostic script checks:
1. The `data-component='itemReturnEligibility'` selector (the old Amazon format)
2. All `data-component` values present in the item HTML
3. Any text nodes containing the word "return"
4. The full raw HTML (truncated to 2,000 characters)

Output goes to both stdout and `diagnose_return_policy_output.txt`. This was instrumental in building and debugging the `extract_return_info` function in `fetch_orders.py`.

---

## Data Flow Summary

Here's the complete pipeline from Amazon to browser:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. LOGIN                                                       │
│     .env → AmazonSession → session.login()                     │
├─────────────────────────────────────────────────────────────────┤
│  2. FETCH                                                       │
│     amazon_orders.get_order_history()                           │
│     → List of Order objects (with Shipments and Items)          │
│     (with FetchProgress tracking via monkey-patched callbacks)  │
├─────────────────────────────────────────────────────────────────┤
│  3. FLATTEN                                                     │
│     build_items_from_orders() → flat list of item dicts         │
│     Each item: order info + shipment info + item info           │
│     ASIN extracted from product URL, carrier from tracking URL  │
├─────────────────────────────────────────────────────────────────┤
│  4. MERGE                                                       │
│     Load existing year files from disk                          │
│     Preserve return_window_end for Return Started items         │
│     Keep older items + replace with fresh items                 │
├─────────────────────────────────────────────────────────────────┤
│  5. WRITE                                                       │
│     write_output() → data/app_data_YYYY.js                     │
│     write_manifest() → data/app_data_manifest.js               │
├─────────────────────────────────────────────────────────────────┤
│  6. VIEW                                                        │
│     Open index.html → loads manifest → loads recent year files  │
│     app.js derives status, filters, sorts, renders cards        │
│     User: search, filter by tab, toggle S&S, mark "Keep"       │
│     Stored in localStorage, graphs via Chart.js                 │
└─────────────────────────────────────────────────────────────────┘
```

The architecture is intentionally simple: no database, no server, no framework. The Python script is the only thing that touches the network. The frontend is entirely static — it reads the generated JS files and does everything client-side.
