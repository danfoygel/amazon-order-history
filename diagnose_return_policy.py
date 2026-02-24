#!/usr/bin/env python3
"""
diagnose_return_policy.py — Diagnostic script for Item 6: Return Policy.

Fetches recent orders and dumps the raw return-policy HTML / text for each item,
so we can see exactly what Amazon puts in the page and decide how to parse it.

Usage:
    python diagnose_return_policy.py              # inspect last 20 items
    python diagnose_return_policy.py --limit 50   # inspect more items
    python diagnose_return_policy.py --order 114-XXXX-XXXXXXX  # single order

Output is written to diagnose_return_policy_output.txt in addition to stdout.
"""

import argparse
import os
import sys

from dotenv import load_dotenv

try:
    from amazonorders.session import AmazonSession
    from amazonorders.orders import AmazonOrders
    from amazonorders.conf import AmazonOrdersConfig
except ImportError:
    raise SystemExit(
        "amazon-orders is not installed. Run: .venv/bin/pip install amazon-orders python-dotenv"
    )

load_dotenv()

OUTPUT_FILE = "diagnose_return_policy_output.txt"


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

    # -----------------------------------------------------------------------
    # 1. Primary selector used by the library
    # -----------------------------------------------------------------------
    el = parsed.select_one("[data-component='itemReturnEligibility']")
    if el:
        raw_text = el.get_text(" ", strip=True)
        html_snip = str(el)[:500]
        msg = (
            f"  [data-component='itemReturnEligibility'] FOUND\n"
            f"    text:  {raw_text!r}\n"
            f"    HTML:  {html_snip}\n"
        )
    else:
        msg = "  [data-component='itemReturnEligibility'] NOT FOUND\n"
    print(msg, end="")
    out.write(msg)

    # -----------------------------------------------------------------------
    # 2. All data-component values present in this item's HTML
    # -----------------------------------------------------------------------
    components = sorted(set(
        el.get("data-component")
        for el in parsed.find_all(attrs={"data-component": True})
        if el.get("data-component")
    ))
    if components:
        msg = f"  [data-component values in item]: {components}\n"
        print(msg, end="")
        out.write(msg)

    # -----------------------------------------------------------------------
    # 3. Any text in the item's HTML that mentions "return"
    # -----------------------------------------------------------------------
    return_hits = []
    for node in parsed.descendants:
        if not hasattr(node, "get_text"):
            # It's a NavigableString (text node)
            text = str(node).strip()
            if "return" in text.lower() and text:
                return_hits.append(text)
    # Deduplicate while preserving order
    seen = set()
    unique_hits = []
    for h in return_hits:
        if h not in seen:
            seen.add(h)
            unique_hits.append(h)

    if unique_hits:
        msg = "  [text nodes containing 'return']:\n"
        print(msg, end="")
        out.write(msg)
        for h in unique_hits[:10]:
            line = f"    {h!r}\n"
            print(line, end="")
            out.write(line)
    else:
        msg = "  [no text nodes contain 'return']\n"
        print(msg, end="")
        out.write(msg)

    # -----------------------------------------------------------------------
    # 4. Full raw HTML of the item tag (truncated)
    # -----------------------------------------------------------------------
    full_html = str(parsed)
    if len(full_html) > 2000:
        full_html_display = full_html[:2000] + f"\n  ... [{len(full_html)} chars total, truncated]\n"
    else:
        full_html_display = full_html
    msg = f"\n  [Full item HTML]:\n{full_html_display}\n"
    print(msg, end="")
    out.write(msg)


def main():
    parser = argparse.ArgumentParser(
        description="Diagnose return policy HTML patterns from Amazon order pages."
    )
    parser.add_argument("--limit", type=int, default=20,
                        help="Max items to inspect (default: 20)")
    parser.add_argument("--order", type=str, metavar="ORDER_ID",
                        help="Inspect a single specific order by ID")
    args = parser.parse_args()

    email = os.environ.get("AMAZON_EMAIL")
    password = os.environ.get("AMAZON_PASSWORD")
    otp_secret = os.environ.get("AMAZON_OTP_SECRET") or None

    if not email or not password:
        raise SystemExit("AMAZON_EMAIL and AMAZON_PASSWORD must be set in .env")

    print("Logging in to Amazon...")
    session = AmazonSession(email, password, otp_secret_key=otp_secret)
    session.login()
    print("Login successful.\n")

    config = AmazonOrdersConfig(data={"warn_on_missing_required_field": True})
    amazon_orders = AmazonOrders(session, config=config)

    if args.order:
        print(f"Fetching single order: {args.order}")
        orders = [amazon_orders.get_order(args.order)]
    else:
        print(f"Fetching last 3 months of orders (will inspect up to {args.limit} items)...")
        orders = amazon_orders.get_order_history(time_filter="months-3", full_details=True)
        print(f"Found {len(orders)} orders.\n")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        banner = f"Return Policy Diagnostic — {len(orders)} orders\n{'=' * 72}\n"
        print(banner, end="")
        out.write(banner)

        count = 0
        for order in orders:
            for shipment in (getattr(order, "shipments", None) or []):
                for item in (getattr(shipment, "items", None) or []):
                    if count >= args.limit:
                        msg = f"\n[Stopped after {args.limit} items. Use --limit N for more.]\n"
                        print(msg, end="")
                        out.write(msg)
                        return
                    count += 1
                    inspect_item(item, order, count, out)

        msg = f"\n[Done — inspected {count} items. Full output saved to {OUTPUT_FILE}]\n"
        print(msg, end="")
        out.write(msg)


if __name__ == "__main__":
    main()
