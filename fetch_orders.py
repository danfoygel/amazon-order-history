#!/usr/bin/env python3
"""
fetch_orders.py — Scrapes Amazon order history and writes data/app_data.js.

Usage:
    python fetch_orders.py           # full fetch: last 12 months
    python fetch_orders.py --incremental  # fast: last 30 days merged with existing data

Reads credentials from .env (copy .env.example to .env and fill in values).
"""

import os
import sys
import json
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

load_dotenv()

# ---------------------------------------------------------------------------
# Carrier detection from tracking URL
# ---------------------------------------------------------------------------

CARRIER_PATTERNS = [
    ("UPS",   ["ups.com"]),
    ("USPS",  ["usps.com"]),
    ("FedEx", ["fedex.com"]),
    ("DHL",   ["dhl.com"]),
    ("Amazon",["amazon.com", "track.amazon.com"]),
    ("OnTrac",["ontrac.com"]),
    ("LSO",   ["lso.com"]),
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
        "item_id":              item_id,
        "order_id":             order.order_number,
        "order_date":           order_date,
        "title":                getattr(item, "title", "") or "",
        "asin":                 asin,
        "quantity":             quantity,
        "unit_price":           unit_price,
        "total_price":          total_price,
        "item_link":            link,
        "image_link":           image_link,
        "carrier":              detect_carrier(tracking_url),
        "tracking_url":         tracking_url,
        "delivery_status":      raw_delivery_status,
        "order_grand_total":    getattr(order, "grand_total", None),
        "return_window_end":    return_window_end,
        "return_status":        "none",
        "return_initiated_date": None,
        "return_notes":         "",
    }


# ---------------------------------------------------------------------------
# Shared: fetch orders for a date cutoff and build item records
# ---------------------------------------------------------------------------

def fetch_and_build(amazon_orders, cutoff: datetime.date) -> list[dict]:
    """Fetch all orders since cutoff and return a list of item records."""
    today = datetime.date.today()
    years_to_fetch = sorted({today.year} | ({today.year - 1} if cutoff.year < today.year else set()))

    all_orders = []
    for year in years_to_fetch:
        print(f"Fetching orders for {year}...")
        year_orders = amazon_orders.get_order_history(year=year, full_details=True)
        print(f"  Found {len(year_orders)} orders.")
        all_orders.extend(year_orders)

    orders = [
        o for o in all_orders
        if o.order_placed_date and o.order_placed_date >= cutoff
    ]
    print(f"Keeping {len(orders)} orders placed since {cutoff}.")

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


def load_existing_items(output_path: str) -> list[dict]:
    """Read items from the existing app_data.js, or return empty list."""
    if not os.path.exists(output_path):
        return []
    try:
        with open(output_path, encoding="utf-8") as f:
            content = f.read()
        # Strip the JS wrapper to get raw JSON
        json_str = content.removeprefix("window.ORDER_DATA = ").removesuffix(";\n")
        return json.loads(json_str).get("items", [])
    except Exception as e:
        print(f"Warning: could not read existing data ({e}), starting fresh.")
        return []


def write_output(items: list[dict], output_path: str, email: str | None = None) -> None:
    os.makedirs("data", exist_ok=True)
    output = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "email": email,
        "items": items,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("window.ORDER_DATA = ")
        json.dump(output, f, indent=2, default=str)
        f.write(";\n")
    print(f"Wrote {len(items)} items to {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    incremental = "--incremental" in sys.argv

    email = os.environ.get("AMAZON_EMAIL")
    password = os.environ.get("AMAZON_PASSWORD")
    otp_secret = os.environ.get("AMAZON_OTP_SECRET") or None

    if not email or not password:
        raise SystemExit("AMAZON_EMAIL and AMAZON_PASSWORD must be set in .env")

    print("Logging in to Amazon...")
    session = AmazonSession(email, password, otp_secret_key=otp_secret)
    session.login()
    print("Login successful.")

    today = datetime.date.today()
    output_path = "data/app_data.js"
    amazon_orders = AmazonOrders(session)

    if incremental:
        print("Mode: incremental (last 30 days)")
        cutoff = today - datetime.timedelta(days=30)
        new_items = fetch_and_build(amazon_orders, cutoff)

        # Merge: keep existing items older than cutoff, replace everything newer
        existing = load_existing_items(output_path)
        old_items = [i for i in existing if (i.get("order_date") or "") < cutoff.isoformat()]
        print(f"Keeping {len(old_items)} existing items older than {cutoff}, merging with {len(new_items)} refreshed items.")
        items = old_items + new_items
    else:
        print("Mode: full fetch (last 12 months)")
        cutoff = today - datetime.timedelta(days=365)
        items = fetch_and_build(amazon_orders, cutoff)

    write_output(items, output_path, email=email)


if __name__ == "__main__":
    main()
