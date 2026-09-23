# Phase 0 verification

Date: 2026-09-23 · Run from: India (home connection, `COLLECT_EGRESS_LABEL=local`) · Node 22.19.0, npm 10.9.3, git 2.51.0

Infrastructure (option b, no Docker): Neon Postgres 18.6 (pooler host, SSL), Upstash Redis (`rediss://`), AWS S3 (Object Lock off, `S3_OBJECT_LOCK_DAYS=0`).

## Results by step

| Step | What | Result |
|---|---|---|
| 0 | Delete `src/App.jsx.bak` and `map-intel-portal.jsx`, commit the baseline | PASS: commit `0ce6d4e`; nothing secret staged |
| 1 | Environment check | Docker and psql not installed → option (b) cloud services. `server/.env` created from the template (never opened) |
| 2.1 | Portal `npm install` / `build` / `lint` | PASS. Build OK (warning: 635 kB chunk). Lint: 0 errors, 9 warnings (see Known issues) |
| 2.2 | Portal fixes in mock mode (9 checks) | PASS: all 9 confirmed by the user in the browser |
| 3.1 | Server `npm install`, `playwright install chromium` | PASS |
| 3.2 | `npm run typecheck` | PASS: 0 errors (none needed fixing) |
| 3.3 | `npm test` | PASS: 9/9 at the start, **12/12** after the fixes below |
| 3.4 | Cloud services + `storage:init` | PASS: DB, Redis and S3 reachable; bucket already existed (`exists`) |
| 3.5 | `db:migrate`, `db:seed` | PASS: `001_init.sql` ran unchanged on Neon (CREATE ROLE / GRANT work); seed gave 3 accounts, 3 sources, 30 products, 82 listings |
| 3.6 | API with curl | PASS: `/health` ok (db, redis, storage); seed admin login gives a token; `/accounts` = Apple, LG, Samsung; 10 products each; wrong password → 401; no token / bad token → 401; unknown account → 404 (after fix 1) |
| 3.7 | RLS + append-only (pg script, all in rolled-back transactions) | PASS 10/10: `mapintel_tenant` has no superuser or BYPASSRLS; RLS enabled and forced on product, product_identifier, map_price, account_membership; as LG only LG's 10 products are visible; filtering on Apple's id returns 0; inserting an Apple product is refused; no account set → 0 rows; UPDATE and DELETE on `observation` are refused by the trigger (even as system) |
| 4.1 | Smoke test (`--inline --account lg --limit 3`) | PASS: Walmart ok $1,599.99, in stock, Walmart.com; Amazon blocked (bot check); Best Buy failed (connection dropped) |
| 4.2 | Compare with live pages | PARTIAL: checked against the captured evidence (see "Spot checks"); side-by-side comparison with the live pages in your browser not done yet |
| 4.3 | Evidence hashes | PASS: smoke run 4/4 files, full run **104/104** files (52 captures × HTML + PNG). Downloaded file SHA-256 = `evidence` table = S3 `ChecksumSHA256` = object metadata. The S3 SHA-256 checksum works on AWS, so nothing was dropped |
| 4.4 | Full run (`--inline`, 82 listings) + `collect:report` | DONE in 23 min: 27 ok, 2 partial, 21 blocked, 31 failed, 1 not_found. Table below |
| 4.5 | Queue path (worker + `collect -- --account apple --source bestbuy_us`) | PASS after fixes 6–7: worker processed 10/10 jobs; crawl_run `finished`; 10 observations for 10 listings (no duplicates despite a worker restart). Worker stopped afterwards |
| 4.6 | India findings | Recorded under "Findings from India"; nothing was bypassed |
| 5 | Portal in API mode | API side PASS: `.env.local` (`VITE_USE_MOCK=false`) is served, CORS allows `localhost:5173`, and products return a current price for 26/30 SKUs with MAP null. **Browser walkthrough not done yet:** sign in, client list, Product Summary, Add SKU survives refresh |
| 6 | This document + commit | Done (local commit, not pushed) |

## Bugs found and fixed

1. `server/src/api/app.ts`: for admins, `assertAccountAccess` never checked the account exists (GET returned 200 `[]`, POST would hit an FK error and return 500); now 404.
2. `server/src/collector/browser.ts`: evidence screenshots of HTTP-fetched pages came out unstyled because the page's own CSP `<meta>` blocked its CSS and images when re-rendered on `about:blank`. `bypassCSP` is now on for the offline, JavaScript-off render only. Stored HTML and its hash are unchanged.
3. `server/src/collector/robots.ts` + `collect.ts`: an unreachable or 5xx robots.txt was treated as "allow everything" for 12 h. It now means disallow (RFC 9309), retries after 15 min, and records the reason.
4. `server/src/collector/extract/common.ts`: availability enum values were misread: `NOT_AVAILABLE` → **in_stock**, and `OUT_OF_STOCK` / `PRE_ORDER` → unknown. That is why Walmart LG-P07 came out as `partial`.
5. `server/src/collector/extract/amazon.ts`: Amazon's "cannot be shipped to your selected delivery location" page (no buy box) was recorded as `failed`; it is now `blocked` (`geo_interstitial`).
6. `server/src/collector/runs.ts`: BullMQ rejects `:` in custom job ids, so the queue path could never enqueue. The id now uses `_`, and a failed enqueue marks the crawl_run `failed` instead of leaving it `running`.
7. `server/src/lib/queue.ts` + `scripts/collect.ts`: `npm run collect` (queue mode) never exited because BullMQ doesn't close a connection it was handed. The new `closeQueue()` closes both.
8. `server/src/collector/collect.ts` + `scripts/report.ts`: multi-line Playwright errors with ANSI colour codes garbled the report's Problems list. Errors are now one line.

New unit tests (with trimmed fixtures from real captured pages): robots.txt unreachable/5xx/404, Walmart marketplace out-of-stock (LG-P07), Amazon India no-ship page (SAM-P08), Walmart availability enums.

No portal (UI) code was changed.

## Collector results: full run `c851f474` (2026-09-23 10:26–10:49 UTC, egress: local/India)

| Source | Total | ok | partial | blocked | failed | not_found | skipped_robots | With evidence |
|---|---|---|---|---|---|---|---|---|
| amazon_us | 26 | 3 | 0 | 21 | 1 | 1 | 0 | 26 |
| bestbuy_us | 30 | 0 | 0 | 0 | 30 | 0 | 0 | 0 |
| walmart_us | 26 | 24 | 2 | 0 | 0 | 0 | 0 | 26 |
| **Total** | **82** | **27** | **2** | **21** | **31** | **1** | **0** | **52** |

Full per-listing table: `server/reports/poc-2026-09-23-10-26.md` (and `.csv`; hashes and errors only, no page HTML).

This run started before fixes 4–5, so on a re-run expect Walmart LG-P07 → `ok` (out of stock) and Amazon SAM-P08 → `blocked` instead of `failed`. Walmart LG-P08 (`partial`) is probably the same enum issue; check it on the next run.

### Spot checks against the captured evidence

- **Walmart LG-P01**: screenshot shows "Now $1,599.99" (was $2,099.99), "Sold and shipped by Walmart.com", arrives tomorrow. Matches the extracted values.
- **Amazon SAM-P04**: screenshot shows $289.99 (list $329.99, -12%), ships from and sold by Amazon.com, In Stock. Matches. But see "Findings from India".
- **Amazon SAM-P08**: "This item cannot be shipped to your selected delivery location" with no buy box. No price recorded (correct).
- **Amazon LG-P09**: Amazon's 404 page. The seeded ASIN `B0FKB4VTDY` is dead.
- **Walmart SAM-P03**: the page's model is `SM-R640NZKWXAR`, but the seed has `SM-R640NZKAXAR`. The seeded URL is a different colour variant, and `model_match=false` flags it correctly.
- **Amazon bot pages**: "Click the button below to continue shopping" interstitial and captcha pages. Recorded as `blocked` with no price, and never clicked through.

## Findings from India

- **Best Buy is unreachable.** Product pages *and* the homepage have the connection dropped (`fetch failed` / timeout, Chromium `ERR_HTTP2_PROTOCOL_ERROR`, curl exit 56). robots.txt is reachable from Node (322 rules; product pages allowed), so this is an edge block, not robots. Recorded as `failed`, 0/30 captured.
- **Amazon mostly shows bot checks:** 21/26 blocked (captcha or "continue shopping" interstitial) even at 15–20 s per request.
- **Amazon is localised to India even when it works.** Pages say "Deliver to India" and add "$103.06 Shipping & Import Charges to India". The item price looked like the US price in the one checked case, but the offer and seller shown can differ from what a US shopper sees.
- **Walmart works** and serves a US page with a default ZIP (Sacramento 95829). 26/26 pages captured. **17 of 26 buy boxes are held by third-party sellers** (e.g. Datavision Computer Video, Wholesale Connection, Spice Mobile, Electronic Express), which matters for MAP monitoring.

## Remaining known issues

- Portal lint: 9 warnings (6 unused imports/variables in `App.jsx`, 3 React-hook notes). Not bugs; left alone to keep the UI untouched. Build warns about a 635 kB JS chunk.
- Best Buy network drops are recorded as `failed`, not `blocked`: from the client side a dropped connection looks the same as an outage.
- `model_match` is `false` both for "the model code isn't printed on the page" (common on Amazon) and "a different model is printed". It should become three-valued (match / mismatch / not shown). Blocked pages also show "no".
- The politeness throttle (`politeWait`) lives in memory per process. One worker is fine; several workers (or worker + inline run at once) would each keep their own gap per retailer. Phase 1 needs a Redis-backed limiter.
- The login attempt brake is in memory and per process (noted in the code as a Phase 1 item).
- The dev API listens on all interfaces (it was reachable at the LAN IP during the test). Needed on Render; locally it exposes the API to the Wi-Fi network.
- Neon's owner role has BYPASSRLS. Tenant isolation relies on the API switching to `mapintel_tenant` for account queries (verified); `withSystem` code paths are not RLS-protected by design.
- `pg` warns that `sslmode=require` will change meaning in pg v9. Use `sslmode=verify-full` in `DATABASE_URL` to keep today's certificate checks.
- The portal refuses duplicate SKU codes case-insensitively, but the database unique key is case-sensitive.
- The smoke-run Walmart screenshot (captured before fix 2) is unstyled. It stays because evidence is append-only; its hash is still valid.

## Decisions for you

1. **US egress for collection.** Best Buy (0/30) and most of Amazon can't be collected from India. Options: run the worker in a US region (e.g. Render Ohio) and re-run the PoC from there, or use a US proxy. Neither is set up.
2. **Best Buy Products API.** Set `BESTBUY_API_KEY` for price and stock. The collector still fetches the page for evidence, which fails from India.
3. **Amazon approach** (part of legal review Decision 5): even with polite delays, 81% of pages hit bot checks. Consider an official or licensed source (Product Advertising / SP-API, or a data provider) rather than page fetching.
4. **Seed data fixes:** LG-P09 Amazon ASIN `B0FKB4VTDY` is dead. SAM-P03 Walmart URL (`/ip/19035974776`) is the `SM-R640NZKWXAR` variant, not `…KAXAR`: repoint it or accept the variant.
5. **MAP values:** none are seeded, so MAP shows "—". Provide the MAP list for the pilot SKUs.
6. **Admin password:** the seed admin password is very weak. Change it before anything leaves your machine, and consider a minimum length in `SEED_ADMIN_PASSWORD` validation.
7. **Remaining browser checks:** Step 4.2 (compare a few live pages with the report) and Step 5 (sign in with API mode on, check Product Summary, Add SKU survives refresh).
