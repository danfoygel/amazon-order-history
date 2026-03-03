# Store Integration Research

Research into programmatic order-history retrieval for each store.
Status: **research only** — nothing implemented yet.

---

## Amazon (current)

### How we retrieve data today

We use the **[amazon-orders](https://github.com/alexdlaird/amazon-orders)** Python library (`pip install amazon-orders`). It is an unofficial, open-source package that logs into Amazon's consumer website and scrapes order data. There is no official Amazon consumer-order-history API.

### Authentication
- `AmazonSession` takes email + password from environment variables (`AMAZON_EMAIL`, `AMAZON_PASSWORD`).
- Optional TOTP-based MFA via `AMAZON_OTP_SECRET` (Base32 secret compatible with Google Authenticator / Authy).

### Data fields extracted
| Category | Fields |
|---|---|
| Order | `order_id`, `order_date`, `order_grand_total`, `subscribe_and_save` |
| Item | `title`, `asin`, `quantity`, `unit_price`, `total_price` |
| Links | `item_link`, `image_link` |
| Shipping | `tracking_url`, `carrier`, `delivery_status` |
| Returns | `return_window_end`, `return_policy`, `return_status`, `return_initiated_date`, `return_notes` |

### Fetch modes
- **Incremental** (default, daily cron): fetches the last 3 months, merges into per-year data files.
- **Historical** (`--year YYYY`): fetches an entire calendar year for backfill.

### Key implementation details
- ASIN is extracted via regex from item links (the library doesn't expose it directly).
- Carrier is detected from tracking-URL domain patterns.
- Return policy is extracted from order-page HTML (free_or_replace, return_only, non_returnable).
- Output: JavaScript data files (`window.ORDER_DATA_YYYY`) + a manifest file for the browser app.

---

## Walmart

### Dedicated libraries
**None.** There is no pip-installable / npm-installable library equivalent to `amazon-orders` for Walmart.

### Official APIs
Walmart has several official API programs, but **none expose a consumer's personal purchase history**:

| API | Portal | Purpose | Consumer order history? |
|---|---|---|---|
| Marketplace APIs | [developer.walmart.com](https://developer.walmart.com/) | Sellers manage their marketplace orders, items, prices | No — seller-side only |
| Affiliate / Commerce APIs | [walmart.io](https://www.walmart.io/) | Product catalog, affiliate links, SSO | No |
| Supplier / DSV APIs | (via developer.walmart.com) | 1P suppliers manage items & orders | No — supplier-side only |

### Best existing tool
**[Walmart Invoice Exporter](https://github.com/hppanpaliya/Walmart-Invoice-Exporter)** — a free, open-source Chrome extension (Manifest V3).
- Runs a content script on `walmart.com/orders`, crawls order-history pages, fetches invoice details.
- All processing is local (no external data transmission).
- Exports to XLSX (single file or per-order).
- Exported fields: product name, quantity, price, delivery status, product links, order number, date, shipping address, payment method, subtotal, total, delivery fees, tax, tips.
- Latest version v5.2 (Feb 2026). Active maintenance.

This extension's source code is the best reference for understanding Walmart's DOM structure and invoice-fetching patterns.

### Walmart's internal GraphQL API
Walmart's website uses a **federated GraphQL architecture** (Apollo Gateway). When you view your orders, the browser makes GraphQL requests that return structured JSON. These endpoints are undocumented and internal, but could be intercepted and replayed with the right auth cookies.

### Browser automation approach
A Playwright-based scraper could:
1. Launch with a persistent browser context (reuse an existing logged-in Chrome profile).
2. Navigate to the orders page.
3. Either parse the DOM (using patterns from the Invoice Exporter extension) or intercept GraphQL responses.

**Anti-bot protections:** Akamai Bot Manager and PerimeterX — TLS fingerprinting, behavioral analysis, progressive CAPTCHAs. Stealth plugins (e.g. `playwright-stealth`) may be needed.

### Other approaches
- **OrderPro Analytics** — paid Chrome extension ($9.95+/mo), exports CSV/Excel/Sheets from Walmart and 20+ other retailers.
- **Walmart Business account** — has a built-in purchase-history download feature, but only for business accounts, not personal.
- **Email parsing** — parse Walmart order-confirmation emails via IMAP. Limited to summary data (no detailed line items).
- **CCPA data request** — up to 2 requests per year, 45-day turnaround, data format not guaranteed to be machine-friendly.

### Recommended approach
Use Playwright with a persistent browser profile. Study the [Walmart Invoice Exporter source](https://github.com/hppanpaliya/Walmart-Invoice-Exporter) for DOM patterns and consider intercepting the underlying GraphQL responses for cleaner data.

---

## Target

### Dedicated libraries
**None.** No pip/npm library exists for Target consumer order history.

The **[TargetAPI](https://github.com/nwithan8/TargetAPI)** Python package (`pip install TargetAPI`) wraps Target's Redsky product API for store lookup, product search, pricing, and availability — but has no order-history support.

### Official APIs
| API | Purpose | Consumer order history? |
|---|---|---|
| [Target Developer Portal](https://developer.target.com/) | Restricted to employees & approved partners | Unknown — behind auth wall |
| [Target Plus Orders API](https://plus.target.com/docs/spec/orders) | Marketplace sellers manage their orders | No — seller-side only |
| Redsky API (`redsky.target.com`) | Product catalog, fulfillment, pricing | No |

The Redsky API uses a static API key and is publicly queryable for product data, but it has no order-history endpoints and has become increasingly rate-limited.

### Browser automation approach
Target's order history is at `https://www.target.com/account/orders`. A Playwright scraper could:
1. Authenticate at Target.com.
2. Navigate to the orders page.
3. Intercept XHR/Fetch responses (likely to `api.target.com` or similar) to capture structured JSON rather than parsing HTML.

**Anti-bot protections:** CAPTCHAs, IP blocking, browser fingerprinting. The `playwright-stealth` plugin is recommended.

### Third-party tools
- **OrderPro Analytics** — paid Chrome extension, exports Target order history to CSV/Excel/Sheets. Captures: order ID, date, payment method, subtotal, promotions, coupons, shipping, taxes, refunds, plus per-item product descriptions, quantities, prices.
- **Receiptor AI** ([receiptor.ai](https://receiptor.ai/)) — AI-powered extraction from email receipts. Free tier available. Only captures orders with email confirmations.
- **Target RedCard CSV export** — Statement transactions can be downloaded as CSV from the credit card portal. Limited to RedCard transactions, up to 1 year back. Increasingly unreliable since a recent system migration.

### Other approaches
- **CCPA data request** — available to California residents.
- **Target Circle** — in-store purchases linked via Target Circle membership may appear in online order history.

### Recommended approach
Playwright with network interception to capture Target's internal API responses. The JSON data will be cleaner and more reliable than HTML parsing.

---

## Costco

### Dedicated libraries
**None** as a pip/npm package, but several open-source projects exist (see below).

### Official APIs
Costco has no public developer API for consumer order history. They maintain an internal API portal at `doc.api.digital.costco.com` (Azure-based), but it is not publicly accessible.

### Costco's internal GraphQL API (key finding)
Costco's website and mobile app use an internal GraphQL endpoint for receipt data:

- **Endpoint:** `https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql`
- **Method:** POST
- **Auth header:** `Costco-X-Authorization: Bearer <idToken>` (token from `localStorage.idToken` after login)
- **Additional headers:** `Costco-X-Wcs-Clientid`, `Client-Identifier` (UUID), `Costco.Env: ecom`, `Costco.Service: restOrders`
- **GraphQL query:** `receiptsWithCounts` — accepts `startDate`, `endDate`, `documentType`, `documentSubType`
- **Response data:** Transaction metadata (date, warehouse, register), financial data (subtotal, taxes, total), `itemArray` (item numbers, descriptions, amounts), `tenderArray` (payment methods), `couponArray`

This is what all the browser extensions and console scripts use under the hood. It returns clean, structured JSON.

### Open-source projects

| Project | Approach | Output | Notes |
|---|---|---|---|
| **[TCRDD](https://github.com/TechStud/TCRDD)** | Browser console script | JSON | Up to 3 years of history, smart merging, includes a dashboard for visualization |
| **[Costco-Receipt-Downloader](https://github.com/harrykhh/Costco-Receipt-Downloader)** | Browser extension (MIT) | JSON | Chrome (MV3) + Firefox (MV2) |
| **[Costco_Scraping](https://github.com/dheerajW125/Costco_Scraping)** | Python + Selenium + undetected-chromedriver | JSON/CSV | Full automation with login, CAPTCHA handling (via 2captcha), Docker support, enriches items with product links |
| **[beancount_import_sources](https://github.com/ankurdave/beancount_import_sources)** | Browser console JS | JSON | Minimal script, clean GraphQL API usage, designed for beancount accounting import |
| **[costcomcp](https://github.com/jovezhong/costcomcp)** | MCP server | Database | Receipt parsing + analysis via LLM workflows |

### Browser extensions
- **[Costco Receipts Downloader](https://chromewebstore.google.com/detail/costco-receipts-downloade/nnalnbomehfogoleegpfegaeoofheemn)** — free Chrome extension, queries the GraphQL API using your existing auth tokens, exports 28-field CSV. Covers online orders, warehouse receipts, and gas station transactions. All processing local.
- **OrderPro Analytics** — paid ($9.95+/mo), multi-store CSV/Excel/Sheets export.

### Browser automation approach
The cleanest programmatic approach:
1. Use Playwright to log into costco.com (handling CAPTCHAs as needed).
2. Extract the `idToken` from `localStorage`.
3. Call the GraphQL endpoint directly with the auth token.
4. Parse the structured JSON response.

**Anti-bot protections:** Akamai CDN/bot protection. The `undetected-chromedriver` or Playwright stealth plugins may be needed. The [Costco_Scraping](https://github.com/dheerajW125/Costco_Scraping) repo demonstrates working CAPTCHA handling via 2captcha.

### Other approaches
- **CCPA data request** — [costco.com/RightsRequest](https://www.costco.com/RightsRequest) or privacy@costco.com. 45-day turnaround.
- **In-warehouse receipts** — available online for up to 2 years (in 6-month increments). Older records (10+ years) reportedly available at the membership desk in person.

### Recommended approach
Call the GraphQL API directly using auth tokens from a Playwright-managed browser session. The [beancount_import_sources](https://github.com/ankurdave/beancount_import_sources/blob/main/download/download_costco_receipts.js) script is a clean, minimal reference for the API call pattern. The [Costco_Scraping](https://github.com/dheerajW125/Costco_Scraping) repo demonstrates full Python automation including login and CAPTCHA handling.

---

## Home Depot

### Dedicated libraries
**None.** No pip/npm library exists for Home Depot order history.

### Official APIs
Home Depot does not offer a publicly accessible API for order history or any consumer-facing data. The domain `developer.homedepot.com` exists but is behind an invitation-only authentication wall with no public sign-up.

### Home Depot Pro Xtra CSV export (best first-party option)
If you have a **Pro Xtra account** (free to sign up), Home Depot provides a built-in Purchase Tracking tool:
- Navigate to Purchase Tracking, click "Export."
- Choose "Purchase Summary Data" or "Purchase Details Data."
- Downloads as CSV with up to **2 years** of history.
- Also supports QuickBooks `.iif` export.
- Fields: date, store, job/PO number, department, item descriptions, SKU, quantities, prices, payment method.
- Covers both online and in-store purchases (if paid with a registered card; Apple Pay / mobile wallets not tracked).

### Home Depot's internal GraphQL API
Home Depot uses a **GraphQL federation gateway** at `https://www.homedepot.com/federation-gateway/graphql`. Requests use an `opname` query parameter. Known public operations include `searchModel` and `productClientOnlyProduct`. Order-history operations exist behind authenticated sessions but are undocumented.

### Browser automation approach
Since there is no API, browser automation is the most direct approach:
1. Use Playwright to log in and navigate to order history.
2. Either parse the rendered DOM or intercept GraphQL responses.
3. For Pro Xtra accounts, automate the CSV export workflow instead of scraping HTML.

**Anti-bot protections:** JavaScript rendering requirements, CAPTCHAs, rate limiting.

### Third-party tools
- **Greenback / Dext Commerce** ([greenback.com](https://www.greenback.com/)) — connects to your Home Depot account and auto-fetches itemized receipts. Has a [REST API](https://developer.greenback.com/) for programmatic access. Paid service (contact sales for API pricing). Also supports Lowe's, Amazon, and others.
- **OrderPro Analytics** — paid Chrome extension, exports up to 15 years of Home Depot order history to CSV/Excel/Sheets.
- **Buildertrend** — official Home Depot partnership for Pro Xtra integration. Syncs up to 25 months of purchase history automatically (hourly for new purchases). Requires a Buildertrend subscription (construction project management software).

### Other approaches
- **CCPA data request** — available to California residents.
- **EDI integration** — for suppliers/vendors only (EDI 850, 855, 856, 810, etc.).
- **HammerZen** — converts Pro Xtra CSV exports into QuickBooks format.

### Recommended approach
Sign up for a free **Pro Xtra account** and use the native CSV export as the simplest legitimate path. For full automation, use Greenback/Dext Commerce's REST API, or build a Playwright scraper that automates the Pro Xtra CSV download flow. Intercepting the federation-gateway GraphQL responses is also viable for structured JSON data.

---

## Lowe's

### Dedicated libraries
**None.** No pip/npm library exists for Lowe's consumer order history.

### Official APIs
Lowe's operates an API developer portal on Azure APIM:

| API | Portal | Purpose | Consumer order history? |
|---|---|---|---|
| Order Status API | [portal.apim.lowes.com](https://portal.apim.lowes.com/) | Look up order status by order ID | No — single-order lookup, not bulk history; partner-only access |
| Purchase Order Events API | Same portal | Publish PO event status | No — vendor/supplier-facing |
| Mirakl Marketplace Seller API | [seller.lowes.com](https://seller.lowes.com/mirakl-seller-documentation/) | Marketplace sellers manage orders | No — seller-side only |

The Order Status API requires an Azure APIM subscription key and is designed for business partners, not consumer self-service.

### Lowe's Pro account built-in export
- **Pro account** primary admins can export purchase history for their organization.
- **Lowe's PreLoad accounts** can export to CSV, QuickBooks CSV, or Excel via the History menu.
- **Standard MyLowes accounts** do not have this export feature.

### Browser automation approach
- Order history page: `https://www.lowes.com/account/orders/`
- Use Playwright to authenticate, navigate to orders, and either parse HTML or intercept XHR/Fetch responses to capture internal API JSON.
- No existing open-source project specifically scrapes Lowe's order history.
- Reference: [lowesWebScrapper](https://github.com/vineetsingh065/lowesWebScrapper) demonstrates Selenium automation on lowes.com for product data (note: author reports Lowe's blocked the method).

**Anti-bot protections:** CAPTCHAs, rate limits, IP restrictions, fingerprinting.

### Third-party tools
- **Greenback / Dext Commerce** ([greenback.com](https://www.greenback.com/)) — auto-fetches Lowe's receipts, has a [REST API](https://developer.greenback.com/). Requires MyLowes member card number or linked phone number. Limitations: does not support Lowe's Pro credit card, commercial accounts, PreLoad cards, or Advantage Cards. Lowe's retains receipts for only 3 years (5 years for major appliances).
- **OrderPro Analytics** — paid Chrome extension. Exports: order date, order number, receipt ID, total, item names, descriptions, quantities, prices, store location, pickup/delivery details.
- **GetMyInvoices** ([getmyinvoices.com](https://www.getmyinvoices.com/)) — automated invoice downloading from Lowe's on a schedule, with OCR extraction. Supports 2FA. Paid service.

### Other approaches
- **EDI** — for suppliers selling to Lowe's only (ANSI X12 format via VAN, AS2, FTP, or HTTPS).
- **CCPA data request** — available to California residents.

### Recommended approach
For a free path: use Greenback/Dext Commerce if their limitations are acceptable, or build a Playwright-based scraper with network interception. For Pro account holders, the built-in export is the simplest option.

---

## Ace Hardware

### Dedicated libraries
**None.** No pip/npm library exists for Ace Hardware order history.

### Official APIs
Ace Hardware does not offer a public consumer-facing API. Existing integrations are vendor/supplier-facing:
- **Vendor Portal** — Microsoft Azure B2B, for suppliers only.
- **EDI / Private Supply Network (PSN)** — API-based vendor integration via ECI.

### Browser automation approach
- Ace's e-commerce is built on **SAP** (with Cognizant as their technology partner). The site may use server-rendered pages or a modern SPA.
- Use Playwright to log in, navigate to order history, and parse the DOM.
- No existing open-source order-history scraper for Ace.

**Anti-bot measures:** Unknown specifics, but given the SAP/Cognizant stack, expect standard bot detection. SeleniumBase's CDP Mode or Playwright stealth plugins may be needed.

### Ace Rewards mobile app
The Ace Rewards app (iOS and Android) displays purchase history. Its private API could theoretically be reverse-engineered using mitmproxy or Charles Proxy, but no public documentation of these endpoints exists.

### Third-party tools
- **OrderPro Analytics** — not confirmed to support Ace Hardware specifically.
- No other third-party tools found with direct Ace integration.

### Other approaches
- **CCPA data request** — via Ace's [OneTrust privacy portal](https://www.acehardware.com/privacy/california), phone (1-888-827-4223), or in-store. Twice per 12-month period for California residents.

### Recommended approach
Browser automation with Playwright is the only viable programmatic approach. The Ace Rewards mobile app API is a secondary option for reverse engineering. CCPA data requests work as a one-time fallback.

---

## REI

### Dedicated libraries
**None.** No pip/npm library exists for REI order history.

### Official APIs
REI has an API catalog at `api-catalog.rei.com`, but it is gated behind **SAML SSO authentication** — likely internal or partner-only. No public documentation is available.

REI's [engineering GitHub](https://github.com/rei) has 67 public repos (mostly their Cedar design system), but no consumer API SDKs.

### Known internal API patterns
A 2019 security research disclosure revealed REI's mobile app uses a `/mobile-gateway/` API path on `www.rei.com`. This confirms a REST API layer exists for the mobile app, likely including order-history endpoints — but these are undocumented and require authentication.

### Browser automation approach
- **Purchase history** is accessible via My Account after login, with a **year-selector dropdown** for viewing historical purchases.
- Online history goes back to at least 2015. Older records may require contacting customer service.
- In-store purchases appear if linked to your co-op membership number.
- Use Playwright to authenticate, navigate to purchase history, iterate through years via the dropdown, and extract order data.

### Mobile app API reverse engineering
- REI has iOS and Android apps displaying purchase history.
- The `/mobile-gateway/` base path is known. Order-related endpoints likely exist under this path.
- Risk: certificate pinning is common for retail apps; bypassing requires tools like Frida.

### Third-party tools
- No major third-party tools found with direct REI integration.

### Other approaches
- **CCPA data request** — email privacy@rei.com. As a co-op member, your purchase history is core profile data.

### Recommended approach
Playwright-based browser automation, taking advantage of the well-structured purchase history page with its year selector. Intercepting the underlying XHR responses is likely to yield cleaner JSON data than DOM parsing.

---

## Backcountry

### Dedicated libraries
**None.** No pip/npm library exists for Backcountry order history.

### Official APIs
Backcountry does not offer a public consumer API. Internally they use Mulesoft for API integration and Google Cloud Platform (BigQuery, Looker) for data, but none of this is exposed publicly. Their [GitHub organization](https://github.com/Backcountry) has no public repositories with API documentation.

### Browser automation approach
- **Login page:** `https://www.backcountry.com/Store/account/login.jsp` (the `.jsp` extension indicates a Java-based backend, possibly ATG/Oracle Commerce).
- **Order lookup:** `https://www.backcountry.com/order-lookup` allows lookup by order number + email without full login.
- Use Playwright to log in, navigate to account order history, and parse rendered HTML or intercept API responses.

**Anti-bot protections:** Backcountry uses **Akamai CDN** and **F5 BIG-IP** for security. Akamai's Bot Manager is a significant anti-bot product.

**Note:** Backcountry has indicated plans to **replatform their core e-commerce**, which means the technical landscape may shift.

### Existing scrapers (product data only)
- **[erinshellman/backcountry-scraper](https://github.com/erinshellman/backcountry-scraper)** — Python + Scrapy for product data. Demonstrates that Scrapy can interact with the site, but not for order history.

### Third-party tools
- **AfterShip** ([aftership.com](https://www.aftership.com/brands/backcountry.com)) — provides shipment tracking for Backcountry orders. Tracks shipments only, not full order history, but could supplement other approaches.

### Other approaches
- **CCPA data request** — email privacy@backcountry.com or call 1-801-204-4655. Online portal also available via their privacy policy page.

### Recommended approach
Playwright-based browser automation. The order-lookup page (`/order-lookup`) that works with just order number + email could be useful for targeted lookups. Be prepared for Akamai bot detection challenges.

---

## Cross-Cutting Patterns

### No store has a public consumer order-history API
Every store's official APIs are designed for sellers, suppliers, or partners — not for consumers to retrieve their own purchase history. This is a universal gap.

### Common retrieval strategies (ranked by reliability)

1. **Built-in export features** (where they exist) — Pro Xtra (Home Depot), Lowe's Pro, Walmart Business. The simplest and most reliable path, but limited to specific account types.

2. **Internal GraphQL/REST APIs** — Costco and Walmart have known internal APIs that return structured JSON. These are the cleanest data source when accessible, but require authenticated browser sessions and are undocumented.

3. **Browser automation (Playwright)** — the universal fallback. Every store can be scraped via Playwright with a logged-in browser session. Fragile and requires maintenance, but works everywhere.

4. **Third-party services** — Greenback/Dext Commerce covers Home Depot and Lowe's with a REST API. OrderPro Analytics covers most stores via Chrome extension (paid). These add a dependency but reduce maintenance burden.

5. **CCPA data requests** — legally supported for California residents, but slow (up to 45 days), limited frequency (2x/year), and format is unpredictable.

### Recommended tech stack for browser automation
- **[Playwright](https://playwright.dev/python/)** (Python) — preferred over Selenium for speed, auto-waiting, and built-in network interception.
- **[playwright-stealth](https://github.com/nichochar/playwright-stealth)** or **[SeleniumBase](https://github.com/seleniumbase/SeleniumBase)** — for bypassing anti-bot detection.
- **Persistent browser contexts** — reuse an existing logged-in Chrome profile to avoid the login/CAPTCHA problem.
- **Network interception** — capture internal API responses (GraphQL or REST) for structured JSON rather than parsing HTML.

### Anti-bot protections by store
| Store | Known protections |
|---|---|
| Amazon | Rate limiting, CAPTCHA, account lockout |
| Walmart | Akamai Bot Manager, PerimeterX, TLS fingerprinting |
| Target | CAPTCHA, IP blocking, browser fingerprinting |
| Costco | Akamai CDN/bot protection |
| Home Depot | CAPTCHA, rate limiting, JS rendering |
| Lowe's | CAPTCHA, rate limits, IP restrictions |
| Ace Hardware | Unknown (SAP stack) |
| REI | Unknown |
| Backcountry | Akamai Bot Manager, F5 BIG-IP |
