# Amazon Order History

A local web app for viewing your Amazon order history at the item level — filter by status, track returns, and spot approaching return deadlines.

## Setup

### 1. Install dependencies

```
python3 -m venv .venv
.venv/bin/pip install amazon-orders python-dotenv
```

### 2. Add your credentials

```
cp .env.example .env
```

Edit `.env` and fill in your Amazon email and password. If your account uses TOTP-based MFA (Google Authenticator, Authy, etc.), also add the **base32 secret key** from your authenticator app setup — this is the long code shown when you first enroll an authenticator, not a one-time code. Leave `AMAZON_OTP_SECRET` blank if you don't use MFA.

### 3. Fetch your orders

```
.venv/bin/python3 fetch_orders.py
```

This fetches the current year's orders and writes `data/orders.json`. It may take a minute or two.

**Note on CAPTCHAs:** Amazon occasionally presents a CAPTCHA during login. If the script fails with an authentication error, it's likely a CAPTCHA. There's no automated workaround — run the script in a terminal and retry; it sometimes succeeds on a second attempt. If not, try again a few hours later.

### 4. Open the app

You can't open `index.html` directly as a `file://` URL (browsers block `fetch()` from local files). Instead, serve the directory with Python's built-in server:

```
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Features

- **Status filter tabs** — All, Delivered, In Transit, Pending, Cancelled
- **Return tracking tabs** — "Needs Return" (delivered, window open, no return started) and "Return Closing ⚠" (same, but window expires within 7 days)
- **Return window badge** on each card — shows days remaining or "Window closed"
- **Mark Return** button — lets you manually record return status (None / Initiated / Shipped / Refund Received) with a date and notes; this is saved in your browser's localStorage and survives data refreshes
- **Search** — filters by item title, ASIN, or order ID in real time
- **Sort** — by date, price, or return window urgency
- **Tracking links** — click to open UPS/USPS/FedEx/Amazon tracking directly

---

## Refreshing data

Re-run `fetch_orders.py` whenever you want to update order statuses. Your manually-set return statuses are stored in `localStorage` and will not be overwritten.

To automate this, add a cron job:

```
# Runs daily at 6 AM — update the path to match your setup
0 6 * * * cd /Users/you/OrderHistory && .venv/bin/python3 fetch_orders.py
```

---

## Return status tracking

The `amazon-orders` library includes Amazon's stated `return_eligible_date` per item when available. The app uses this directly; it may extend beyond 30 days for holiday purchases or Prime items. When not available it falls back to order date + 30 days.

Use the **Mark Return** button to track the status of items you've initiated a return for. The four states are:

| State | Meaning |
|---|---|
| None | No return action taken |
| Return Initiated | You've started the return process on Amazon |
| Return Shipped | Item is on its way back |
| Refund Received | Amazon has issued the refund |

---

## Security note

Your Amazon credentials are stored in `.env`, which is gitignored. Never commit `.env`. The `fetch_orders.py` script uses the unofficial `amazon-orders` library, which scrapes Amazon's website — use it for personal use only and at a reasonable frequency (e.g., once daily) to avoid triggering Amazon's bot detection.
