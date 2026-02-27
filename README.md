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

Order data is stored in per-year files (`data/app_data_2025.js`, `data/app_data_2024.js`, etc.) plus a manifest file (`data/app_data_manifest.js`) that tells the app which years are available.

**Incremental refresh** (run this daily, e.g. via cron) — fetches the last 3 months and merges into the appropriate year file(s):

```
.venv/bin/python3 fetch_orders.py
```

**Historical backfill** — fetch a full calendar year once and write it to its own file:

```
.venv/bin/python3 fetch_orders.py --year 2023
```

Run this once per year you want to add. You can go as far back as your Amazon account's first order. Recommended first-run sequence:

```
# Backfill each year of history you want (oldest to newest)
.venv/bin/python3 fetch_orders.py --year 2020
.venv/bin/python3 fetch_orders.py --year 2021
.venv/bin/python3 fetch_orders.py --year 2022
# ... and so on up to last year

# Then do an incremental fetch to cover the last 3 months
.venv/bin/python3 fetch_orders.py
```

**Verbose mode** — add `--verbose` to either command to see detailed API diagnostics (timing, order counts, merge decisions):

```
.venv/bin/python3 fetch_orders.py --verbose
.venv/bin/python3 fetch_orders.py --year 2023 --verbose
```

Each command takes a minute or two per year fetched.

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

- **Combined view** (default) — items grouped by urgency: Mail Back → Decide → Shipped, then remaining items grouped by order month
- **Mail Back tab** — items you need to return (Return Started or Replacement Ordered), sorted by mail-back deadline
- **Decide tab** — delivered items still within their return window, sorted by deadline
- **Status tabs** — filter by All, Delivered, Shipped, Ordered, Cancelled, and various return statuses
- **Return/mail-back deadline badges** — color-coded: gray (plenty of time), yellow ⚠ (≤7 days), red (overdue)
- **Keep button** — on Mail Back and Decide items; marks an item as "keeping it" so it moves out of those action views. Persisted in `localStorage`.
- **Search** — filters by item title, ASIN, or order ID in real time
- **Tab counts** — each tab shows the number of matching items

---

## Refreshing data

Re-run `fetch_orders.py` (no flags) whenever you want to update order statuses. This refreshes the last 3 months only, so it's fast and safe to run daily. Keep decisions (localStorage) are stored in the browser and will not be overwritten by a data refresh.

To automate this, add a cron job:

```
# Runs daily at 6 AM — update the path to match your setup
0 6 * * * cd /Users/you/OrderHistory && .venv/bin/python3 fetch_orders.py
```

---

## Security note

Your Amazon credentials are stored in `.env`, which is gitignored. Never commit `.env`. The `fetch_orders.py` script uses the unofficial `amazon-orders` library, which scrapes Amazon's website — use it for personal use only and at a reasonable frequency (e.g., once daily) to avoid triggering Amazon's bot detection.

---

## Tests

Four test layers cover the Python backend, JavaScript logic, the full web UI, and visual regression.

### Prerequisites

```
# Python test dependencies (in addition to the .venv from Setup)
.venv/bin/pip install pytest beautifulsoup4 requests python-dateutil

# JavaScript / E2E dependencies
npm install
npx playwright install --with-deps
```

### Running all tests

```
bash tests/run_tests.sh
```

Or equivalently via npm:

```
npm run test:all
```

### Running individual layers

**Python unit tests** — covers `fetch_orders.py` logic (date handling, carrier detection, return info, ASIN enrichment, file I/O, pipeline):

```
.venv/bin/python -m pytest tests/python/ -v
```

**JavaScript unit tests** — covers `order_logic.js` pure functions (status mapping, sorting, date formatting, helpers):

```
npm test
```

**E2E browser tests** — Playwright tests that load the full app with fixture data and verify tabs, cards, search, filters, and badges:

```
npm run test:e2e
```

**Visual regression tests** — Playwright screenshot comparisons that catch unintended UI changes across full-page views, individual card types, and responsive layouts:

```
npm run test:visual
```

To update baselines after intentional UI changes:

```
npx playwright test tests/e2e/test_visual.spec.js --update-snapshots
```

Playwright automatically starts a local HTTP server on port 8456 for all browser tests — no manual server setup is needed.
