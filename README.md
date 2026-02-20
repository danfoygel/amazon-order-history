# Amazon Order History

A local web app for viewing your Amazon order history at the item level — track return deadlines, decide what to keep, and manage mail-backs.

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

This fetches the current year's orders and writes `data/app_data.js`. It may take a minute or two.

**Note on CAPTCHAs:** Amazon occasionally presents a CAPTCHA during login. If the script fails with an authentication error, retry a few times or try again later.

### 4. Open the app

The simplest option is to open `index.html` directly in your browser as a `file://` URL — just double-click it in Finder. Data is loaded via a `<script>` tag rather than `fetch()`, so this works without a server.

Alternatively, serve the directory with Python's built-in server (useful if you prefer `http://` or run into any browser restrictions):

```
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

**Note on localStorage:** Keep decisions are stored in `localStorage`, which is scoped to the origin. If you switch between `file://` and `http://localhost`, they won't share the same kept-item state.

---

## Features

- **Combined view** (default) — items grouped into four sections: Mail Back → Decide → Shipped → Everything Else, each sorted by urgency
- **Mail Back tab** — items you need to return (Return Started or Replacement Ordered), sorted by mail-back deadline
- **Decide tab** — delivered items still within their return window, sorted by deadline
- **Status tabs** — filter by All, Delivered, Shipped, Ordered, Cancelled, and various return statuses
- **Return/mail-back deadline badges** — color-coded: gray (plenty of time), yellow ⚠ (≤7 days), red (overdue)
- **Keep button** — on Mail Back and Decide items; marks an item as "keeping it" so it moves out of the action views and into Everything Else. Persisted in `localStorage`.
- **Search** — filters by item title, ASIN, or order ID in real time
- **Tab counts** — each tab shows the number of matching items

---

## Refreshing data

Re-run `fetch_orders.py` whenever you want to update order statuses. Keep decisions (localStorage) are stored in the browser and will not be overwritten by a data refresh.

To automate this, add a cron job:

```
# Runs daily at 6 AM — update the path to match your setup
0 6 * * * cd /Users/you/OrderHistory && .venv/bin/python3 fetch_orders.py
```

---

## Security note

Your Amazon credentials are stored in `.env`, which is gitignored. Never commit `.env`. The `fetch_orders.py` script uses the unofficial `amazon-orders` library, which scrapes Amazon's website — use it for personal use only and at a reasonable frequency (e.g., once daily) to avoid triggering Amazon's bot detection.
