# MAP Intel — progress log

**This file in the repo (`docs/progress.md`) is the master copy.** Claude Code reads it at the start of every phase or session and updates it before finishing. The planning chat in the Mirethos Claude project mirrors it after each review. Newest entry at the top of "Log". Keep entries short: what was built, where it lives, decisions, known issues, next step.

## Current status
- **Phase:** P2b Collectors **in progress**, finishing through a first real slice on the **LG Sandbox**, now **route D: Walmart + eBay (Browse API), Amazon paused** (branch `amazon-lg-slice`; code done 1 Oct 2026, waiting for the first GitHub Actions run). Amazon.com blocked both free US egresses on 30 Sep. Demo catalogue and brand logos added 28 Sep 2026. P2a done 25 Sep 2026 (merged into `main`), P1 done 24 Sep 2026, P0 done 23 Sep 2026.
- **Last updated:** 1 Oct 2026 (Claude Code: LG slice route D, D1–D5)
- **Repo:** `E:\Claude Mirethos docs\Map Intel\Map Intel` (git, remote `github.com/Amardeep386/map_intel`). `main` = `origin/main` = P2a + Phase 2b + the demo catalogue + brand logos (latest `2cfc942` plus this docs commit). Phase 2b reached `main` on 28 Sep through the `demo-catalogue` merge (`bd96457`), at your request, before its exit test. Branches `phase-2b-collectors` and `demo-catalogue` are pushed and fully contained in `main`.
- **Live (since 25 Sep 2026):** portal https://map-intel-iota.vercel.app (Vercel, deploys `main`), API https://map-intel-api.onrender.com (Render free plan: no worker, sleeps when idle; a GitHub Action pings it every 10 min). Production shares Neon, Upstash and S3 with development.
- **Dev workflow:** Cursor with Claude Code in the terminal, working in the repo folder. Services: Neon (Postgres 18), Upstash (Redis), AWS S3. No Docker on the PC.
- **Portal:** mock mode by default; `VITE_USE_MOCK=false` puts every P1, P2a and P2b screen on the API.
- **Env (server/.env, never committed):** `DATABASE_URL`, `DATABASE_URL_API`, `VAULT_KEYS` + `VAULT_ACTIVE_KEY`, `PORTAL_URL`, and since 27 Sep `S3_OBJECT_LOCK_DAYS=365` (you set it). New optional collector variables are in `server/.env.example`.
- **Next step (resume here): LG slice M7, the real run on GitHub Actions** (route D, decisions 36–38).
  1. **You:** push `amazon-lg-slice` and put `.github/workflows/lg-slice.yml` on `main` (GitHub only lists and schedules workflows from the default branch; the workflow checks out `amazon-lg-slice` until it is merged).
  2. **Done 1 Oct:** repository secrets added. **eBay Production keys were refused (OAuth 401) on the first run**: eBay keeps Production keys disabled until Marketplace Account Deletion is set up (decision 39). **You:** on Render add `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT` = `https://map-intel-api.onrender.com/ebay/account-deletion`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`; then on developer.ebay.com → Alerts & Notifications enter the same endpoint and token, Save, Send Test Notification; then re-run discovery. Earlier secrets: (eBay App ID, Production), `EBAY_CLIENT_SECRET` (Cert ID, Production), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_OBJECT_LOCK_DAYS` (365), plus `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` only if `server/.env` has them. `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET` are already there.
  3. **You:** Actions → LG slice → Run workflow → mode `discover`. Then work the 60–89 review queue in the Mapping Center (LG Sandbox).
  4. Monitoring then runs by itself at 09:00 IST (03:30 UTC) for two days (or Run workflow → `monitor`).
  5. Claude Code: M7 report to `server/reports/` (pages read, staged / auto-included / review / excluded, evidence re-hash, Day 1 vs Day 2), real Walmart / eBay fixtures, then `cd server && npm run exit:p2b -- --check --scheduled --scope lg-slice`. Tick P2b (for this scope) only if it passes.
  6. Amazon stays manual evidence until route A (LG's SP-API access) or B (licensed data) is in place.
  7. When the brands send their own SKU / MAP files, load them through Product Summary → Import catalogue and MAP Policies → Import MAP file (dry run first); `server/seeds/demo-catalogue.json` is the demo stand-in.

## Decisions so far
| # | Decision | Date | Where decided |
|---|---|---|---|
| 1 | MAP Intel and Pricing Intel are separate portals; MAP Intel first | 23 Sep 2026 | Planning chat |
| 2 | Keep current portal UI/UX; prototype is the screen reference | 23 Sep 2026 | Planning chat |
| 3 | Data collection built in-house; starts in Phase 0 | 23 Sep 2026 | Planning chat |
| 4 | Pilot brands: LG, Apple, Samsung | 23 Sep 2026 | Planning chat |
| 5 | Hosting: portal on Vercel, API and worker on Render, Postgres on Neon, Redis on Upstash, files on S3 | 23 Sep 2026 | Phase 0 chat |
| 6 | Collection method: official API where one exists. No API keys yet, so the PoC fetches pages directly (slow, robots.txt respected). The Best Buy API switches on when `BESTBUY_API_KEY` is set. | 23 Sep 2026 | Phase 0 chat |
| 7 | Pilot SKUs: Claude picked 30 current bestsellers (10 per brand) as placeholders; the user will send the real SKU lists later | 23 Sep 2026 | Phase 0 chat |
| 8 | Backend stack: Fastify + TypeScript, `pg`, BullMQ, AWS SDK v3, JWT auth with bcrypt, Playwright for the headless fallback and screenshots | 23 Sep 2026 | Phase 0 chat |
| 9 | Dev setup: cloud services (Neon, Upstash, S3) instead of local Docker | 23 Sep 2026 | Phase 0 chat |
| 10 | Build with Claude Code in Cursor; project context lives in the repo (`CLAUDE.md`, `docs/`) | 24 Sep 2026 | Planning chat |
| 11 | Roles (prototype matrix): Administrator and Account manager configure everything in an account (only Administrators grant Administrator); Analyst edits terms and catalogue and reads the rest; Brand user reads catalogue and prices only | 24 Sep 2026 | Phase 1 (Claude Code) |
| 12 | Credential vault: AES-256-GCM in the API with keys in env (`VAULT_KEYS`, rotatable by key id); AWS KMS possible later without a schema change | 24 Sep 2026 | Phase 1 |
| 13 | Invites: single-use link (72 h) copied by the inviter; email delivery arrives in P3 | 24 Sep 2026 | Phase 1 |
| 14 | The source catalogue holds all 6 launch sources plus Google Shopping; sources without a collector are `planned`: subscribable and costed, not crawled until P2b | 24 Sep 2026 | Phase 1 |
| 15 | The API connects as `mapintel_api` (no BYPASSRLS) and `app.role='system'` is ignored for it; the few cross-account reads are SECURITY DEFINER functions | 24 Sep 2026 | Phase 1 |
| 16 | Hosting on free tiers for now: Vercel portal, Render free web service for the API (migrations at start-up), no collector worker until a paid plan | 25 Sep 2026 | Deploy chat |
| 17 | Listings stay shared; each account's decision lives in `listing_match` with an append-only `listing_state_event` history. Human decisions are the training labels | 25 Sep 2026 | Phase 2a |
| 18 | MAP stays empty until the brands' files arrive (your answer). Price plausibility falls back to MSRP, then to the median price of the product's included listings | 25 Sep 2026 | Phase 2a |
| 19 | Until the P2b collectors run, the Mapping Center is fed by a seeded synthetic-candidate generator (origin `synthetic`, removable) and a listing CSV/XLSX import. Exit-test volume: 300 candidates per brand per day (your answer) | 25 Sep 2026 | Phase 2a |
| 20 | Precedence: suppression → rules by priority (exclusions 10–30 before inclusions 50–70) → confidence band. An inclusion rule never includes a used, accessory, variant, bundle or other-region listing; a person's Include / Exclude is never overridden by the matcher | 25 Sep 2026 | Phase 2a |
| 21 | Migrations 007–019 belong to P2a, 020+ to P2b | 25 Sep 2026 | Phase 2a |
| 22 | US egress: free HTTP probe on the Render (Ohio) API first, then a US collector run. No API keys yet: Best Buy and eBay API paths stay behind env keys | 27 Sep 2026 | Phase 2b |
| 23 | Discovery respects robots.txt: search on Amazon and Best Buy only; Walmart, eBay, Target and Home Depot discover through brand / browse pages (url terms, `server/seeds/brand-pages.json`) because their search pages are disallowed | 27 Sep 2026 | Phase 2b |
| 24 | Evidence: S3 Object Lock Governance, 365 days per object. Versioning + Object Lock enabled on `mapintel-evidence` (irreversible); the worker refuses to start in production without it | 27 Sep 2026 | Phase 2b |
| 25 | A blocked, failed or robots-skipped page never stores a price, even if one could be read; a suspicious price is stored as `held` and rechecked once; two consistent readings publish | 27 Sep 2026 | Phase 2b |
| 26 | One BullMQ queue per source (own limiter), one headless page at a time per worker; retries only for timeout / network / blocked, the retry through the browser | 27 Sep 2026 | Phase 2b |
| 27 | We do not try to get past bot challenges (e.g. Target's "Press & hold"): they are recorded as `blocked` and shown in Data Health | 27 Sep 2026 | Phase 2b |
| 28 | Demo catalogue replaces the placeholder SKUs: `docs/MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx` columns A–J (127 SKUs, MAP from 28 Sep 2026) and its merchant lists. Placeholders are retired, not deleted; the 13 whose model number is a sheet SKU are renamed to it (listings and prices carry over). Each brand subscribes to its Track = Y merchants; merchants without a collector are `planned`. "Check listing" loads as Paused | 28 Sep 2026 | Demo catalogue (your answers) |
| 29 | P2b finishes through one real slice: Amazon.com, LG Sandbox, 10 active LG SKUs. The LG catalogue is all gram laptops, so the 10 are spread over its 5 lines and 10 model families (first SKU by code of each family, taking turns across lines) instead of the first 10 by code, which were all gram 14" (your answer). One group "Amazon LG slice": a model-number and a name term per SKU, Marketplace = Some → Amazon only. "Brand SKUs" no longer searches Amazon (your answer) | 30 Sep 2026 | Amazon LG slice |
| 30 | Discovery reads 2 search pages per term. Used / renewed / refurbished / open-box results are never staged (search cards, Renewed badges and product pages) | 30 Sep 2026 | Amazon LG slice |
| 31 | Auto-validation stays on: 90+ auto-include, 60–89 review in the Mapping Center, below 60 auto-exclude (LG settings 90 / 60) | 30 Sep 2026 | Amazon LG slice |
| 32 | Monitoring once a day at 09:00 Asia/Kolkata, Included listings only, through a monitoring-only schedule; discovery through a discovery-only schedule fired by hand (`schedule.kind`, cadence `manual`). Every observation stores a fresh screenshot + HTML, also when nothing changed. Amazon is browser-first for product **and** results pages: one request per page and the screenshot is the live page | 30 Sep 2026 | Amazon LG slice |
| 33 | Pace on amazon.com: 3 s + up to 1 s random jitter between pages (adapter pace, other sources keep the global delay), one tab, one page at a time | 30 Sep 2026 | Amazon LG slice |
| 34 | Conduct: human-paced, not hidden. No stealth plugins, fingerprint spoofing, CAPTCHA solving or proxy rotation; `--disable-blink-features=AutomationControlled` removed; robots.txt respected. A robot-check / CAPTCHA / "sorry" / 503 page is recorded as blocked and never stores a price; a blocked Amazon page is not retried through the browser; 2 blocked results in a row on a source cancel its remaining queued jobs in the run | 30 Sep 2026 | Amazon LG slice |
| 35 | Egress free first: Render Ohio HTTP probe, then a GitHub Actions probe (with the browser). If a US probe gets real Amazon pages, the slice runs on GitHub Actions for the test period; production monitoring moves to the Render worker. If both are blocked: write up Render Starter worker vs a licensed data provider; no proxies | 30 Sep 2026 | Amazon LG slice |
| 36 | An official API response is evidence: stored verbatim (JSON, SHA-256, Object Lock) like a page, and a price with it is publishable without a page screenshot. eBay prices and searches go through the Browse API (keyword search is disallowed on the website); the item page is still tried for a screenshot, and a blocked eBay page no longer voids the API price (no browser retry, no screenshot of the block page). Legal review to confirm | 1 Oct 2026 | LG slice, route D |
| 37 | Route D for Amazon: Amazon.com is paused in the LG Sandbox (subscription off) and is manual evidence until route A (LG's SP-API access) or B (licensed data); no proxies (decision 34). A screen for manual Amazon evidence comes in P3 | 1 Oct 2026 | LG slice, route D |
| 38 | The slice runs on Walmart (its LG computers browse page, 3 pages; Walmart /search is disallowed) and eBay (model-number and name terms through the API, 2 pages of 50, Buy It Now only, new only), same 10 SKUs, same schedules renamed "LG slice discovery" / "LG slice daily monitoring", on GitHub Actions for the test period (`lg-slice.yml`, inline, no Redis) | 1 Oct 2026 | LG slice, route D |
| 39 | eBay Marketplace Account Deletion: we comply with an endpoint instead of claiming an exemption (MAP Intel keeps eBay seller usernames). `/ebay/account-deletion` on the API answers eBay's challenge and, for a notification whose ECDSA signature verifies, anonymises the eBay seller (name, key, storefront), deletes its aliases and every account's contacts, and logs the request with hashes only. Append-only observations / candidates and locked evidence keep the raw name as enforcement evidence (legal review to confirm) | 1 Oct 2026 | LG slice, route D |

## Open questions
- **US egress for collection.** Probes, HTTP only unless noted:

  | Source | India (27 Sep) | Render Ohio (30 Sep, `74.220.50.240`) | GitHub Actions (30 Sep, `134.33.77.23`) | India, browser (30 Sep) |
  |---|---|---|---|---|
  | Amazon | captcha / geo page | **captcha 3/3** (3.8 KB robot check) | **HTTP captcha 3/3; browser captcha 3/3, search 503 "sorry"** | product page: geo page; search page: 21 results read |
  | Walmart | ok | ok, 3/3 priced | ok, 3/3 priced | — |
  | Best Buy | connection dropped | timeout 3/3 | not probed | — |
  | eBay | 403 | 403 | not probed | — |
  | Target | ok over HTTP, "Press & hold" in browser | captcha | not probed | — |
  | Home Depot | 403 | 403 | not probed | — |

  The Ohio probe's report says egress `local` because the Render API has no `COLLECT_EGRESS_LABEL`; the IP is Render's. GitHub's run: `server/reports/egress-github-actions-2026-09-30.md`.
- **Amazon from US datacentres is blocked (M6d, 30 Sep). 1 Oct: route D chosen (decision 37); A or B still needed for automated Amazon.** Both free US egresses (Render Ohio, GitHub Actions / Azure) get Amazon's robot check on every product page, over HTTP and in a plain headless browser, and a 503 on search. Under decision 34 we do not get past it and add no proxies. Routes, cheapest-to-reliable:
  - **A. The brand's own Amazon access (recommended).** Amazon's Selling Partner API (Product Pricing: `getItemOffers` / competitive pricing per ASIN) gives the buy-box price and every offer's seller, officially, for any ASIN in the US marketplace. It needs an Amazon seller (or vendor) developer registration: LG's, or Mirethos acting for LG. Credentials go in the vault (P1). Evidence is the signed API response (hashed and locked like a page); a page screenshot is not available this way. Free with the account; needs LG's agreement and legal review.
  - **B. A licensed price-data provider** (e.g. Keepa for Amazon buy-box price history; or a retail-data vendor with page captures). Paid, per ASIN or per request; terms allow commercial use. Some vendors supply screenshots, most supply data only. Pick after the legal review of collection methods (already an open question).
  - **C. Render Starter background worker in Ohio** (about $0.25/day while running; suspend after). Cheap to try, but the Ohio IP already gets the captcha over HTTP, and GitHub's browser was blocked too, so success is unlikely. Useful for Walmart, which works from every US egress.
  - **D. Keep Amazon out of the automated pilot:** collect Walmart (works now) and the API sources (Best Buy, eBay keys), and treat Amazon as manual evidence until A or B is in place.
  - Not pursued (decision 34): proxies of any kind, stealth browsers, CAPTCHA solving.
- **Earlier notes on US egress** (27 Sep) — options considered then:
  - run the worker on Render Ohio (already planned);
  - a US residential or ISP proxy;
  - licensed data.
  - Amazon may still block datacenter IPs, so test the Render option first.
- **Best Buy API key** (eBay Browse API keys: you have them, 1 Oct). Official, free and reliable; recommended. The code switches on with `BESTBUY_API_KEY` / `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`. eBay keys also allow keyword search, which robots.txt does not allow on the website.
- **Target prices come from its own API (`redsky.target.com`, robots.txt disallows all).** Our collector never calls it; Target's page JavaScript does when a headless browser renders an allowed page. Add to the legal review.
- **Amazon source.** Official API or a data provider, versus fetching pages. Part of the legal review.
- Brand users log in during the pilot, or reports only?
- Volume: SKUs per pilot brand, launch sources, checks per day.
- MAP source per pilot brand: real brand-supplied MAP, or a stand-in for a demo sandbox? (No MAP values are seeded; MAP shows "—".)
- Legal review of collection methods, notice wording, and filing marketplace reports as the brand's agent.
- Cyber-analyst / Case Management recordings (never received).

## Phase checklist
- [x] P0 Groundwork: backend skeleton, bug fixes, API client, collector proof of concept, enforcement-channel spike (verified 23 Sep 2026)
- [x] P1 Foundation: accounts, roles, audit log, vault, sources, subscriptions, schedules, terms (exit test 30/30, 24 Sep 2026)
- [x] P2a Catalogue: products, MAP history, promo windows, policy docs, sellers, Mapping Center (exit test 14/14, 25 Sep 2026)
- [ ] P2b Collectors: scheduler, production collectors, evidence capture, observation store, source health (code complete; finishing through the Amazon LG slice; exit test `--scope amazon-lg` waits for a US run)
- [ ] P3 Detection & reporting: rules, violations, dashboard, reports, evidence links, email alerts (pilot go-live)
- [ ] P4 Enforcement & learning: cases, notices, marketplace channels, learning loop, alerts
- [ ] P5 Scale & governance: onboarding, budget, tickets, SSO, API

## Known issues carried forward
- **eBay account deletion (1 Oct):** the raw username stays in append-only observations, match candidates and locked evidence files (retained as evidence); confirm in the legal review. Render free plan sleeps: eBay retries a notification that times out, and the keep-awake ping keeps it mostly up.
- **LG slice, route D (1 Oct):** the Walmart LG computers page mixes monitors, drives and tablets with the gram laptops (no robots-allowed laptops-only page was found), so most of what it shows is auto-excluded by the matcher; listings found there have no proposed product, so they score on title / model only. The eBay API path is tested with recorded responses only; the first GitHub run is its live test (an `auth` failure in Data Health means the keys are wrong or not Production). The browse-page request estimate counts 1 page per url term; the job reads `search_pages` (3).
- **Amazon slice (30 Sep):** the request estimate counts a model-number (identifier) term as 1 search page, but discover jobs read the subscription's `search_pages` (2), so Amazon discovery costs about 40 pages, not 30. The "fresh screenshot + HTML on every observation, even unchanged" rule is how the collector already works (append-only, no de-duplication); M7's Day 1 vs Day 2 report is its proof on real pages. Amazon extractor fixtures are still hand-made (replace from the first US run).
- **Data Health on the live site** does not know the slice changes until `amazon-lg-slice` is merged: the Render API on `main` ignores `schedule.kind` (migrations 025–027 are applied to Neon and are backward compatible).
- **P2b extractors for eBay, Target and Home Depot are untested on real US pages** (India is blocked there). Unit tests use small pages in each site's shape; replace them with real fixtures from the first US run (`server/test/fixtures/README.md`). Watch Data Health for `layout_changed`.
- **Evidence from before 27 Sep is not locked.** Object Lock was only enabled on the bucket on 27 Sep; P0 and smoke-test files have hashes but no retention.
- **Other sellers on a listing are counted, not captured.** Walmart's other offers load in the browser (`otherOffers` is recorded in the observation's extract); Amazon's offer panel (AOD) is not built. Pilot subscriptions use buy box only.
- **Seller-storefront terms are not crawled** (recorded as not executable).
- **Under-notice re-check schedules** fire every 6 h with no work until Phase 4 cases exist (empty runs, no health snapshots).
- **pg deprecation warning** from P1 `server/src/api/configData.ts` `accountEstimate` (parallel queries on one client). Harmless now; breaks on pg 9.
- **Development runs left in the database:** crawl runs from the 27 Sep smoke tests (a few Walmart observations with evidence, one cancelled LG run).
- **Demo catalogue, not the brands' own files.** Since 28 Sep the sandboxes hold the demo catalogue (127 SKUs with MAP, see the 28 Sep log). The brands' real lists still load through the import (dry run first). LG-022 is Paused ("Check listing": specs to confirm). A fresh `db:seed` still loads the old placeholders from `pilot-skus.json`; run `npm run catalogue:demo -- --commit` after it.
- **Image similarity is not scored.** No product images are captured until P2b; the signal shows n/a and its weight goes to the other five.
- **Matcher accuracy is measured on synthetic data only.** 0 wrong automatic decisions on 2,700 simulated candidates and in the exit test, but the generator and the matcher were written together. Real listings from P2b are the real test: watch the review band and wrong includes in the first weeks.
- **Synthetic listings in the shared database.** The exit test leaves one LG day (about 400 listings, marked "Synthetic" in the portal) for browser checks. They show on the live site once P2a is merged. Remove with `cd server && npm run synthetic -- --clear`.
- **Staging speed from India:** about 1 s per candidate (Neon round trips). The worker in Ohio will be much faster.
- **Retirement by absence** needs P2b crawl results: `retireListings()` is ready for the scheduler; retiring by hand works now.
- **QA sampling of auto-includes (5%)** is a Settings value but not applied yet.
- **Imports are limited to 20,000 product rows or 5,000 listings per file,** and run in one request.
- **Collector blocked from India on Amazon and Best Buy.** Needs US egress; see Open questions.
- **9 SKU/retailer pairs have no listing.** URL research on 24 Sep: APL-P10 Walmart found and added. The Amazon pages could not be checked from India (bot check), so 3 candidate ASINs need their "Item model number" confirmed from a US browser. The other 6 were not found new on that retailer: the only listings were a different model, refurbished, open-box, a bundle or an international version, so they were not used.

  | SKU | Model | Retailer | Status |
  |---|---|---|---|
  | LG-P04 | 65QNED75BUA | Amazon | Candidate `B0HFPCNJYH` (title says 65QNED75B only); confirm model |
  | LG-P09 | S90TY | Amazon | Not found on amazon.com (`B0DZ6RWBVF` is amazon.in; `B0FKB4VTDY` dead, retired) |
  | LG-P09 | S90TY | Walmart | Not found (`5439978188` is the S90TR) |
  | LG-P10 | 16U55U-H.AU77U3 | Walmart | Not found |
  | APL-P10 | MEQX4LW/A | Amazon | Not found new (M/L listing is Renewed; `B0FQFPB851` is S/M, MEQW4LW/A) |
  | SAM-P02 | SM-S942UZKEXAA | Amazon | Candidate `B0G4SW96R4` (same ASIN is "International Version" on amazon.ae); confirm model |
  | SAM-P03 | SM-R640NZKAXAR | Walmart | Not found (Walmart has `…KWXAR`, an international version, or a listing with no model code) |
  | SAM-P07 | QN65QN90FAFXZA | Amazon | Candidate `B0DXMYSQJC` ("65QN90F, 2025"); confirm model |
  | SAM-P07 | QN65QN90FAFXZA | Walmart | Not found (`16209267446` is a bundle, `15969669430` open box) |
- **Only the main offer is collected.** Walmart LG-P01 had 5 other sellers that were not captured. MAP monitoring needs all offers on a listing (Phase 2b).
- **Test SKU `TEST-P0-STEP5` (LG) is `Retired`, not deleted.** Its MAP row is protected by `map_price_no_delete`. Product Summary still lists Retired products; filter them in Phase 2a.
- **Owner-level functions rely on BYPASSRLS.** The API itself is now on `mapintel_api` (fixed in P1). The SECURITY DEFINER helpers (`app_accounts_for_user`, `app_accept_invite`, and so on) run as the owner and need its BYPASSRLS on Neon; on a Postgres whose owner lacks it they would return nothing. Keep this in mind if the database moves.
- **Tokens stay valid until they expire (12 h)**, but every request re-checks that the user is Active and still a member, so disabling or removing someone takes effect at once. No refresh tokens or sign-out-everywhere yet (P5, with SSO).
- **Removed users keep their login.** Removing someone from an account deletes the membership; the `app_user` row stays (they may belong to other accounts). The browser-check user `browser-check@example.com` exists without any membership. There is no platform user-admin screen yet (P5).
- **Term yield shows 0** until the P2b collectors fill `listing_discovery`; the violations column waits for P3.
- **Planned sources** (eBay, Target, Home Depot, Google Shopping) are subscribed and costed for the pilot accounts but have no collector until P2b.
- **Database tests run over the network.** `npm run test:db` (45 tests) takes several minutes from India against Neon; each API request makes 2 to 3 extra round trips (user status, role lookup).
- **Upstash command limits.** Run the worker only when needed until production.
- **Mock screens.** Screens for later phases still show mock data in API mode.
- **Lint warnings.** 10 remain, all from before P1: 8 in the portal (6 unused names, 2 React notes) and 2 in `server/` (`collect.ts`, `report.ts`); none is a bug. `docs/reference/` is excluded from lint and build.

## Log
### 1 Oct 2026 (later still) — second discovery: eBay works; matcher fix (Claude Code)
- After the deletion endpoint was set up (Render env + eBay form), the eBay Production keys work. **Discovery run `db2fa281`** (github-actions, finished): eBay 26 API results pages (314 items, JSON evidence under a Governance lock), Walmart 3 pages again. eBay listings: 113 auto-excluded, **2 auto-included**, each collected through the API (page blocked `access_denied` from GitHub too, so API evidence only): gram Book 15 `15U50U-H.AA56U1` $399.99 from windwing521 (MAP $699, confidence 90): a real candidate breach, check it; and **a wrong include**: a $132.99 replacement LCD panel titled with `16Z90TS-G.AUG4U1` (MAP $1,846.99), included by rule INC-MPN (held on price bounds, then confirmed by the re-check). Walmart: 3 gram laptops in review (60). 9 of 20 eBay searches found nothing (several model numbers, and long product names that eBay must match word for word).
- **Fix (`3b86677`):** parts (LCD / screen / display panels and assemblies, digitizers, motherboards, palm rests, bottom covers, "parts only") count as accessories; an inclusion rule no longer fires when the price is implausible for the product (under 40% or over 160% of MAP): the listing goes to review; an eBay API search with 0 results is a finished job, not a failure. Tests 135/135. Decided listings keep their decision: **exclude the LCD panel listing by hand in the Mapping Center.**
- Branch only (the collector runs from `amazon-lg-slice`); `main` gets the matcher fix at the merge.

### 1 Oct 2026 (later) — first LG slice discovery; eBay account deletion endpoint (Claude Code)
- **First discovery run on GitHub Actions** (`aecdc2b3`, egress `github-actions`, finished, 24 jobs): **Walmart** read its 3 browse pages over HTTP (49 / 63 / 54 cards, HTML + screenshot, Governance lock), 166 listings: 141 auto-excluded (monitors, drives, tablets, used / open box), 2 already retired, **3 gram laptops staged for review at confidence 60** and collected with price + screenshot (gram 17" $1,929.99 Happy Ranger, gram Pro 16" $1,499.99 Beach Camera, gram Book 15" $729.99 Happy Ranger). **eBay** 20/20 discover jobs `auth`: OAuth 401, the Production keyset is not usable yet.
- `config.ts` trims the eBay keys (`d4f055a`).
- **eBay Marketplace Account Deletion** (decision 39): `src/api/routes/ebay.ts`, `src/lib/ebayNotifications.ts`, migration 029 (`ebay_account_deletion`, `app_ebay_account_deletion()`; applied to Neon). Cherry-picked to `main` (`4828368`) and live on Render (answers 503 until `EBAY_VERIFICATION_TOKEN` and `EBAY_DELETION_ENDPOINT` are set). Tests: unit 133/133 on the branch (117 on `main`), DB `ebay-deletion` + `sellers` 4/4.

### 1 Oct 2026 — LG slice, route D: Walmart + eBay API, Amazon paused (Claude Code)
- **Your answers:** route D; eBay Production keys (App ID + Cert ID); the API response counts as eBay evidence; Amazon only paused (manual capture screen in P3). Decisions 36–38.
- **D1 eBay search through the Browse API** (`collector/ebayApi.ts`: `ebayApiSearchUrl`, `parseEbaySearch`, `ebayApiReadResults`; eBay adapter `searchUrl` only when keyed, `readResultsApi`): keyword and model-number terms become API searches (50 per page, `next` link, Buy It Now only; new-only applied after). `jobs.ts` reads API results pages without robots.txt (not a website) or the browser; `resultsEvidence.ts` stores the JSON response as the page's evidence.
- **D2 eBay prices:** `ebayApiItem` keeps the raw response; `collect.ts` stores it (`.json`, Object Lock) as evidence, keeps the API price when the item page is blocked, skips the browser retry, and screenshots only an unblocked page. Model match reads the API response when the page was blocked. `ok` needs a screenshot or an API response.
- **Migration 028** (applied to Neon): `api_uri` / `api_sha256` / `api_bytes` on `evidence` and `results_page`; `results_page.method` allows `api`. Data Health health, evidence API responses (`api`), portal "Open page" / evidence links prefer screenshot, then API response, then HTML.
- **D3** `npm run slice:lg [-- --commit]` (was `slice:amazon-lg`; `src/scripts/slice-lg.ts`, `src/lib/lgSlice.ts`). **Committed to LG on 1 Oct:** Walmart subscription active (3 pages, new only), eBay active (2 pages, new only, Buy It Now only), Amazon.com paused; group "Amazon LG slice" renamed "LG slice" (same 20 terms, Marketplace = eBay); new group "LG slice Walmart pages" (url term `walmart.com/browse/electronics/computers-laptops-and-tablets/3944_1089430?facet=brand:LG`, Marketplace = Walmart); schedules renamed "LG slice discovery" (manual, discovery) and "LG slice daily monitoring" (`0 9 * * *` Asia/Kolkata, monitoring, Included), both Walmart + eBay, priority 40. A re-run changes nothing. Projected 361 of 2,500 requests / cycle (whole LG account).
- **D4** `.github/workflows/lg-slice.yml`: Run workflow `discover` / `monitor`, and daily 03:30 UTC monitoring (`scheduler --fire … --due --inline`, egress `github-actions`), Playwright Chromium, a secrets check, 150-minute limit. For the test period; production monitoring moves to the Render worker.
- **D5** `exit:p2b --check --scheduled --scope lg-slice` (replaces `amazon-lg`): LG × Walmart + eBay, evidence = page + screenshot or API response, each re-hashed under a Governance lock (`verifyStored`).
- **Tests:** `npm test` 129/129 (new: eBay API raw evidence, search URL / paging / parse, keyed planning; slice route D). DB `collection-runs` 8/8 (new: API-only evidence and `api` results pages). Portal build OK, lint 0 errors (7 older warnings).
- **Not done yet:** push + secrets + first run (you), M7 report, real fixtures, exit test.

### 30 Sep 2026 — Amazon.com LG slice, M1–M6b (Claude Code)
- **Branch** `amazon-lg-slice` from `main` (not pushed). Commits: M1+M2 `18f197f`, M3–M5 `b5ce93a` (one commit: `jobs.ts` carries all three), M6a/b `e9e5ba3`, docs: this commit. Prompt: `docs/amazon-lg-slice-prompt.md`. Decisions 29–35 above.
- **Migrations 025–027** (applied to Neon): 025 `schedule.kind`; 026 `results_page` + `results_page_listing` (append-only, RLS); 027 `crawl_run.stopped`.
- **M1** `npm run slice:amazon-lg [-- --commit]` (`src/scripts/slice-amazon-lg.ts`, choice in `src/lib/amazonSlice.ts`), through the API as the seed admin. **Committed to LG on 30 Sep:** group "Amazon LG slice" with 20 terms for `14Z90T-G.AAB2U1`, `14T90S-G.AAB4U1`, `15U50T-G.AAS3U1`, `16Z90SP-A.ADB9U1`, `16T90SP-G.AAB6U1`, `14Z90U-G.AS63U1`, `15U50U-H.AA56U1`, `16Z90TS-G.AUG4U1`, `16T95TP-K.AA77U1`, `14Z95U-G.AS67U1`; Marketplace = Amazon only; "Brand SKUs" Marketplace All → Some (Newegg, Walmart, eBay); schedules "Amazon LG discovery" (discovery, manual, priority 40, Amazon + slice group) and "Amazon LG daily monitoring" (monitoring, `0 9 * * *` Asia/Kolkata, Included only, priority 40, Amazon). The Amazon subscription already had 2 pages / new only / buy box only. A re-run changes nothing. Plan preview: discovery 20 search jobs; monitoring 1 collect (the one Included Amazon listing); the daily sweep no longer touches Amazon.
- **M2** schedule kind: discovery work resolves among `both` / `discovery` schedules, listings among `both` / `monitoring` (`scheduler/expand.ts`); cadence `manual` never fires (`lib/schedules.ts`, `scheduler/due.ts`); API, Sources & Terms (Runs column and field, "Manual only"), mock.
- **M3** Amazon adapter (`collector/sources.ts`): browser-first, pace 3 s + 1 s, scroll to the buy box in 2–3 steps and back before the full-page screenshot (4000 px cap), `noRetryOnBlock`. `browser.ts`: automation flag removed; one context per source (cookies carry over), one tab at a time. Condition: Amazon title / used buy box / Renewed badge; `keepCondition` on search and product-page discovery. `egress:probe --browser --sources --out`.
- **M4** `collector/resultsEvidence.ts`: every results page a discover job reads (blocked ones too) → HTML + screenshot + SHA-256 under Object Lock, with the listings it showed and their positions. `GET /accounts/:id/results-pages/:pageId`; Data Health failures "Open page"; Mapping Center listing drawer "Found by discovery: search page N for term X".
- **M5** `collector/stopOnBlock.ts`: 2 blocked results in a row on a source → its queued jobs in the run are cancelled (skipped / cancelled, class blocked), `crawl_run.stopped` records it, Data Health shows a red "Stopped" note and the cancelled jobs. A job cancelled while on the queue is not run.
- **M6a** Ohio probe (you, 30 Sep): Amazon captcha 3/3 over HTTP; table under Open questions. **M6b** `.github/workflows/egress-probe.yml` (manual): probe on `ubuntu-latest`, Amazon also through Chromium, JSON artifact. Secrets: `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`. Local check from India with `--browser`: the Amazon search page was read (21 results).
- `scheduler --fire <schedule> --account <slug> --due` fires the latest due slot as a scheduled run (once per slot) for cron outside the worker. `exit:p2b --check --scheduled --scope amazon-lg` checks LG × Amazon (runs from `render-ohio` or `github-actions`) plus the slice discovery's results-page evidence (hash + lock) and that nothing used was staged.
- **Tests:** `npm test` 125/125 (new: schedule kinds, manual cadence, SKU pick, Amazon condition and Renewed badge, pace, scroll plan, stop-on-block streak, results evidence keys). DB: `collection-config` 8/8 (fixed the stale "7 sources" expectation: 25 since the demo catalogue), `collection-runs` + `data-health` 12/12 (new: results pages RLS / append-only, stop on block). Portal build OK, lint 0 errors (7 warnings, all older).
- **M6b result (you ran it, 30 Sep):** GitHub Actions `134.33.77.23`: Amazon 0/7 real pages (HTTP captcha 3/3, browser captcha 3/3, search 503); Walmart 3/3 priced. The job then hung on exit (the probe's Redis client kept reconnecting where no Redis exists; `closePoliteness` now drops a client that never connected, exits in 10 s locally) and GitHub cancelled it after its 20-minute limit; the results were complete. **M6c not built** (its condition, real Amazon pages from a US probe, was not met). **M6d:** routes A–D under Open questions.
- **Not done yet:** your choice of Amazon route, M7 (discovery run, two monitoring days, report), real Amazon fixtures, exit test.

### 28 Sep 2026 — Brand logos (Claude Code)
- **Files:** you added `docs/Apple Logo.png` and `docs/Samsung Logo.png`; the portal uses cropped copies `src/assets/apple.png` and `src/assets/samsung.png` (Samsung's grey card made transparent). `src/assets/lg.png` cropped the same way (it had wide white margins).
- **`ClientLogo` (`src/App.jsx`):** shows Apple and Samsung; the LG `scale(2.3)` workaround is removed; the logo tile is always white, in dark mode too (Apple's mark is black and vanished on the dark card).
- **Checked** in the browser (sample-data mode): client picker, sidebar switcher and page header, light and dark. Commits `511c0aa`, `2cfc942`, pushed to `main`.
- Philips and Kawasaki logos (`src/assets`, `public`) are no longer used by any client; left in place.

### 28 Sep 2026 — Demo catalogue for the three sandboxes (Claude Code)
- **Branch** `demo-catalogue` (from `phase-2b-collectors`), **merged into `main` and pushed on 28 Sep at your request (`bd96457`)**, so `main` and the live site now include the Phase 2b code too (P2b exit test still not run; Render free plan still has no worker, so nothing collects on its own). Source file: `docs/MAP_Intel_Demo_Catalogue_LG_Apple_Samsung.xlsx`, turned into `server/seeds/demo-catalogue.json` (products = columns A–J of the three "Product Summary" sheets; merchants = the three "Sources" sheets).
- **Migration 024** (applied to Neon): `product.model_family`, `configuration`, `colour`, `internal_id`; `account_source.profile` (the brand's merchant-list entry: channel type, seller model, authorisation, priority, check frequency, collection method, notes, categories).
- **Server:** product import, create, edit and read carry the four new fields (import headers map without choosing: Model Family, Configuration, Colour, Internal ID; MAP import also accepts "MAP Price (USD)"); product API returns `brand`; `PUT /subscriptions/:code` takes an optional `profile`. Source catalogue: Amazon.com, Walmart.com and The Home Depot use the sheet's names; 18 merchants added as `planned` (Newegg, Micro Center, Abt, B&H, Adorama, Costco, Sam's Club, Staples, Office Depot, Crutchfield, P.C. Richard & Son, Expercom, Verizon, AT&T, T-Mobile, LG.com, Apple.com, Samsung.com).
- **Loader:** `cd server && npm run catalogue:demo` (dry run) / `-- --commit`. Through the API as the seed admin: retire SKUs not in the sheet (with their included listings and product terms), rename placeholders whose model is a sheet SKU, product import, MAP import, subscriptions (Track = Y on with profile, others paused), name + identifier terms. Safe to re-run.
- **Portal:** Product Summary shows columns A–J (then Lowest seen, Listings, Violations); drawer and Add/Edit SKU have the new fields; Source catalogue shows priority, check frequency and authorisation (hover for the rest); Sellers' source list covers every merchant. Sample-data mode now uses the same file: clients are the LG, Apple and Samsung sandboxes (Philips, Kawasaki, Citizen removed), SKUs and MAP from the sheet, merchants = tracked merchants, sample violations generated from them.
- **Tests:** `npm test` 113/113 (new: demo sheet mapping, seed file vs source catalogue). Portal build OK, lint 0 errors.
- **Effect on P2b:** the exit test's listings were on the placeholders; 17 placeholders are now retired, so fewer seeded listings are collected. The 13 converted SKUs keep theirs. New SKUs have no listings yet; they are found through the new name / identifier terms and brand pages once the collector runs from the US.

### 27 Sep 2026 — Phase 2b Collectors (Claude Code), paused before the exit test
- **Branch** `phase-2b-collectors` (pushed, not merged). Commits: M0 `90c5ddd` (egress probe; also on `main` as `9fe9c83`), M1 `a00be58`, M2 `46159b3`, fix `515069c`, M3 `87141e0`, M4 `62413d6`, M6 `32a561e`, M8 `2a251f6`, M9 `4d04271`, M10 `af5ae7c`, M11a `d0b4eee`, fix `c26d4a7`, docs: this commit. (M5 evidence and M7 matcher hand-off are inside M4 and M6.)
- **Migrations 020–023** (applied to Neon): 020 `crawl_run` gains account / schedule / slot (one run per slot) + `crawl_job` ledger; 021 observation `held`, `failure_class`, `validation`, `seller_id`, `condition`, `offer_rank`, evidence lock columns, `app_evidence_accounts`; 022 `source_health_snapshot` (append-only); 023 skip reason `cancelled`.
- **Server** (`server/src`):
  - `scheduler/`: `expand.ts` (schedules × subscriptions × terms → jobs; listings first; budget; under-notice schedules never take the sweep's work), `due.ts`, `tick.ts` (fires due schedules, writes jobs, queues them per source).
  - `collector/`: `jobs.ts` (collect / recheck / discover runner, retries, matcher hand-off via `stageCandidate` + `listing_discovery`), `collect.ts` (API → HTTP → headless, validate, evidence), `outcome.ts`, `failure.ts`, `discovery.ts`, `http.ts` (Redis-shared politeness, proxy hook), `browser.ts` (one page at a time), `extract/{results,ebay,target,homedepot}.ts`, `ebayApi.ts`, `egressProbe.ts`.
  - `lib/`: `validate.ts`, `health.ts`, `sourceCatalogue.ts`, per-source queues in `queue.ts`, `storage.ts` (lock status, `verifyEvidence`).
  - Routes: `GET /accounts/:id/health`, `GET /accounts/:id/health/:source/failures`, `POST /accounts/:id/health/rerun`, `POST /admin/egress-probe`. Permissions `health.read`, `collection.run`.
  - Worker: scheduler tick every 5 min + one worker per source; refuses to start in production without Object Lock.
  - Scripts: `npm run egress:probe`; `npm run scheduler -- --tick | --fire <schedule> --account <slug> [--inline] | --run <id> --inline | --cancel <id>`; `npm run exit:p2b -- --setup | --fire | --check [--wait] [--scheduled]`.
- **Portal:** `src/views/DataHealthView.jsx` (prototype layout, drawer with failures and evidence), `src/api/mock/health.js`, client functions, one nav entry in `App.jsx`. Checked in mock mode.
- **Pilot configuration changed** (`exit:p2b --setup`, through the API, audited): all 6 launch sources subscribed for LG, Apple, Samsung; a "Brand pages" group with url terms (LG 5, Apple 4, Samsung 6) sent to Marketplace + Online Seller. Catalogue: eBay, Target, Home Depot now `live`.
- **Found and fixed:** Walmart pages were all flagged "captcha" (Walmart's CSP names captcha.net); the evidence bucket had no Object Lock (enabled with versioning); the pilots' under-notice schedule (priority 20, empty selector) would have taken all daily-sweep work; Target's headless "Press & hold" page is now detected as blocked.
- **Tests:** `npm test` 111/111; `npm run test:db` 79/79 (2 P1 expectations updated: eBay is live). Portal build OK, lint 0 errors.
- **Smoke tests from India:** 2 LG Walmart listings collected with evidence (re-hash OK); LG daily sweep fired inline: 67 jobs planned, 22 not executable (search disallowed), 4 Walmart collects OK, health snapshots written.
- **How to run the Ohio probe (free, you):** open PowerShell, paste:
  ```powershell
  cd "E:\Claude Mirethos docs\Map Intel\Map Intel\server"
  $api = "https://map-intel-api.onrender.com"
  $email = Read-Host "Admin email"
  $pw = Read-Host "Admin password" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
  Invoke-RestMethod "$api/health" | Out-Null
  $token = (Invoke-RestMethod -Method Post "$api/auth/login" -ContentType "application/json" -Body (@{ email = $email; password = $plain } | ConvertTo-Json)).token
  Invoke-RestMethod -Method Post "$api/admin/egress-probe" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body '{"perSource":3}' -TimeoutSec 600 | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 reports\egress-render-ohio.json
  ```
  The probe deployed on `main` still has the Walmart CSP false positive: judge Walmart by the extracted prices in the report.
- **Render worker settings (if you choose Render):** Background Worker, repo `map_intel`, branch `phase-2b-collectors`, region Ohio, Docker, root `server`, Dockerfile `./Dockerfile`, command `node dist/worker/index.js`, Starter. Env: `NODE_ENV=production`, `NODE_OPTIONS=--max-old-space-size=256`, `DATABASE_URL` (owner URL, copy from the API service), `DATABASE_SSL=true`, `REDIS_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (copy), `S3_FORCE_PATH_STYLE=false`, `S3_OBJECT_LOCK_DAYS=365`, `JWT_SECRET` (copy), `COLLECT_EGRESS_LABEL=render-ohio`, `COLLECT_CONCURRENCY=1`, `COLLECT_BROWSER_PAGES=1`, `SCHEDULER_TICK_MINUTES=5`. Healthy logs: `evidence lock: bucket enabled, 365 days per object`, then `collector worker started (egress render-ohio …)`. On start it fires today's daily sweeps.
- **Not done yet:** Ohio probe results, a US collection run, the exit test, merge to `main`.

### 25 Sep 2026 — Phase 2a Catalogue (Claude Code)
- **Branch** `phase-2a-catalogue`. Commits:
  - M1 `d1a8cb2`, M2 `be03e9a`, M3 `f0f5c6c`, M4 `b37d799`, M5 `315216a`, M6 `315bbc9`
  - M7–M9 `e0c4e55`, M10 (exit test + docs): this commit

  Not pushed.
- **Migrations 007–009** (applied to Neon):
  - 007: product group, alt SKU slots 1–6, MAP close-only with no overlaps per product + region, promotion windows, versioned policy documents, `catalogue_import`.
  - 008: shared `seller`, `seller_alias`, `seller_link`; per-account effective-dated `seller_classification`; `seller_contact`; promotion sellers.
  - 009: `listing_match`, `listing_state_event`, `match_candidate` + `match_signal`, `suppression`, `match_rule` (6 defaults per account, also on new accounts); backfill of the seeded listings.
- **Server** (`server/src`):
  - `lib/catalogueImport.ts`: CSV/XLSX (exceljs), header auto-mapping and user override, value checks (GTIN check digits, ASIN, money, dates), product diff, MAP version plan.
  - `lib/sellers.ts`: name normalisation and `resolveSeller` (for P2b).
  - `lib/matching.ts`: six signals and confidence. `lib/matchRules.ts`: rules and suppressions.
  - `lib/mapping.ts`: `stageCandidate` (**P2b entry point**; batch context from `loadMatchContext`), decisions, suppressions, apply rules, `retireListings`, `upsertListing`.
  - `lib/synthetic.ts`: the seeded candidate generator.
  - Routes: `catalogue.ts` (products, imports), `policies.ts` (MAP history, versions, promotions, policy documents), `sellers.ts`, `mapping.ts`.
  - Permissions: `mapping.read/write`, `sellers.read/write` (Analyst writes; Brand user has neither).
  - Scripts: `npm run sellers:backfill` (13 sellers from P0 observations), `npm run synthetic -- --account lg [--count 300] [--clear]`, `npm run exit:p2a`.
  - CSV fix: an unquoted inch mark (65" TV) is text.
- **Portal** (`src/`):
  - `views/CatalogViews.jsx`: Product Summary, product drawer, add/edit SKU, import modal (file → column mapping → dry-run diff → commit), MAP Policies.
  - `views/SellersView.jsx`, `views/MappingCenterView.jsx`: keyboard review queue I / X / A / S, state tabs with bulk actions, suppressions, rules, listing history.
  - `api/mock/catalog.js`, `format.js`; nav renamed to MAP Policies and Sellers.
- **Tests:**
  - `npm test`: 66/66 (unit), including a regression test that automatic decisions on 3 brands × 3 synthetic days are never wrong.
  - `npm run test:db`: 69/69 as `mapintel_api` against Neon (24 new: schema rules, catalogue, MAP policies, sellers, mapping lifecycle and routes).
  - Portal: build OK, lint 0 errors (8 warnings, all from before P2a).
- **Exit test** `npm run exit:p2a`: **14/14** in 632 s (third run; the first two failed on test-script bugs, fixed). An invited LG Analyst, through the API:
  - Catalogue export round-trips through the import dry run with no changes, and a MAP file is checked by dry run.
  - A day of 300 candidates is scored in about 5 minutes: roughly 96 auto-included, 126 auto-excluded, 78 to review, 0 wrong automatic decisions.
  - The analyst works the queue to zero in risk order: 66 decisions, about 23 per minute through the API.
  - 2 seller + product suppressions exclude 12 more listings on the spot. On day 2 every grey-market relisting they cover is excluded automatically, and 20 re-seen listings keep their decision.
  - Every decision is one training label and one audit event. The grey-market seller is classified Unauthorised (history kept). Brand user and cross-account calls get 403.
- **Browser checks for you (P2a):**
  1. Mapping Center: review 20 candidates with the keyboard (I / X / A / S).
  2. Exclude one with scope "Seller + product", see it under Suppressions, revoke it.
  3. Product Summary: import a small XLSX catalogue, check the dry-run diff, cancel or commit.
  4. Sellers: change a seller's classification and check the history.
  5. MAP Policies: add a promotion window and upload a policy document.

### 24 Sep 2026 — Phase 1 Foundation (Claude Code)
- **Branch** `phase-1-foundation`. Commits:
  - M1 `e37bbf7`, M2 `5816a8a`, M3 `df44e85`, M4 `3803d90`
  - M5–M8 `f78b608`, M9 `44557f2`, M10 `270da6f`, M11 `8ecb997`
  - docs: this commit

  Not pushed.
- **Migrations 002–006** (`server/db/migrations`):
  - 002: API role `mapintel_api` and SECURITY DEFINER cross-account helpers.
  - 003: `audit_event`, append-only except through account deletion.
  - 004: `credential` (vault).
  - 005: `source_family`, `account_source`, `term_group`, `term`, `listing_discovery` + `term_yield`, `term_group_subscription`, `schedule`.
  - 006: `user_invite`, invite functions, RLS on `account`.
- **Server** (`server/src`):
  - `lib/permissions.ts` maps roles to actions. Every route declares a permission; a route without one fails at startup.
  - `lib/audit.ts` writes audit rows in the same transaction as the change, with secrets redacted.
  - Also new: `lib/vault.ts`, `lib/rateLimit.ts` (Redis), `lib/cost.ts`, `lib/terms.ts`, `lib/schedules.ts`, `lib/sourceOptions.ts`.
  - `collector/catalogue.ts`: 7 sources with collector-declared options and per-term-type request costs.
  - Routes: accounts, audit, credentials, sources, terms, matrix, schedules, settings, users, and auth (invite info and accept).
- **Portal** (`src/`):
  - `ui.jsx`: shared blocks moved out of `App.jsx`, plus the prototype blocks.
  - `views/SourcesTermsView.jsx`: the new Sources & Terms screen.
  - `views/AdminViews.jsx`: Settings with vault credentials, Users & Access with invite links, Audit Log.
  - An accept-invite screen, and nav items hidden by role.
  - `api/mock/config.js` stands in for these screens in mock mode.
- **Seed:**
  - Writes the source catalogue.
  - Gives each pilot account its starting subscriptions (Amazon, Walmart, Best Buy) and a daily schedule.
  - A retired listing's retailer id is now removed from the product and its identifier term deactivated (LG-P09's dead ASIN).
- **Tests:**
  - `npm test`: 36/36 (unit).
  - `npm run test:db`: 45/45 as `mapintel_api` against Neon (RLS, role × route, audit, vault, configuration, users and settings).
  - Portal: lint 0 errors, build OK.
- **Exit test** `npm run exit:p1`: 30/30, and it passes again on a re-run.
  - An invited Account manager configures LG, Apple and Samsung through the API:
    - 4 subscriptions each, including eBay (planned)
    - about 30 terms per account: a keyword per active SKU, MPN/ASIN identifiers, and a brand term by import
    - the matrix at about 112 of 3,000 requests per cycle
    - an "Under-notice re-check" schedule next to the daily sweep
    - every change in the audit log
  - A Brand user gets 403 on configuration, and LG's manager gets 403 on Apple.
- **Browser checks (you, 24 Sep): all pass.**
  1. Sources & Terms screen.
  2. Generate terms with preview, then the audit entry.
  3. Settings save: the budget shows on the matrix, and the audit log has before/after.
  4. Invite a Brand user, accept in a private window, config screens hidden, user removed.
- **Pilot data changed by the checks:**
  - LG has a "Browser check: Brand + Model" group (2 terms).
  - LG settings are now budget 2,500 and MAP tolerance 1.5%, unless you reset them.

### 24 Sep 2026 — P0 follow-ups (Claude Code)
- **Commits:** `f1a4462` (context docs), `f0ec35d` (follow-ups), `cb90fd0` (APL-P10 seed); all P0 commits pushed to `origin/main`.
- **Browser checks:** Step 4.2 PASS (4/4 live pages match the report); Step 5 PASS (sign in, client list, Product Summary, Add SKU survives refresh). Details in `docs/phase0-verification.md`.
- **Admin password rotated** with the new `server` script `npm run admin:set-password`. It never prints the password. `SEED_ADMIN_PASSWORD` must now be at least 12 characters.
- **Seed:** `pilot-skus.json` has a `retired` entry per product; `seed.ts` sets those listings to `Retired`, keeping their observations and evidence. LG-P09 Amazon and SAM-P03 Walmart retired; Neon has 80 Included and 2 Retired listings.
- **Seed URL research:** APL-P10 Walmart added (`/ip/17814852199`: model MEQX4LW/A, new, sold by Walmart.com). Neon now has 81 Included listings. The other 9 missing pairs are in Known issues.
- **`docs/reference/` excluded** from oxlint (`.oxlintrc.json`), Tailwind scanning (`src/index.css`: CSS 39.0 → 31.9 kB) and the Vite dependency scan (`vite.config.js`).

### 24 Sep 2026 — Planning chat
- Added `CLAUDE.md`, `docs/plan.md`, `docs/architecture.md`, `docs/prompts.md`, this file, and `docs/reference/` (blueprint, prototype, prototype source) so Claude Code has full context in the repo.
- Phase kickoff prompts rewritten for Claude Code in Cursor.

### 23 Sep 2026 — Phase 0 verification (Claude Code in Cursor)
- **Commits:** local `0ce6d4e` (baseline, duplicate files deleted) and `eccdcd8` (fixes); not pushed. Details in `docs/phase0-verification.md`.
- **Portal:** build and lint OK (0 errors); all 9 UI fixes confirmed in the browser.
- **Server:**
  - Typecheck clean; tests 12/12.
  - Migrate and seed on Neon: 3 accounts, 3 sources, 30 products, 82 listings.
  - All API checks pass, including the 401 cases.
  - RLS and append-only checks pass 10/10 on Neon; the queue path works (worker 10/10 jobs).
- **8 backend bugs fixed:**
  - BullMQ job IDs contained `:`
  - the collect CLI hung after queueing
  - CSP blanked the evidence screenshots
  - unreachable robots.txt was treated as allow (now disallow)
  - Walmart NOT_AVAILABLE was recorded as in stock
  - admins got 200 for unknown accounts (now 404)
  - Amazon's India no-ship page was labelled failed (now blocked)
  - multi-line errors garbled the report
- **Collector PoC from India (82 listings):**

  | Retailer | ok | partial | blocked | failed | not found |
  |---|---|---|---|---|---|
  | Walmart | 24 | 2 | 0 | 0 | 0 |
  | Amazon | 3 | 0 | 21 | 1 | 1 |
  | Best Buy | 0 | 0 | 0 | 30 (connection dropped) | 0 |

  - Walmart: 17 of 26 buy boxes are held by third-party sellers.
  - Evidence: all 104 stored files (52 pages × HTML + screenshot) match their SHA-256.
  - No blocked page was ever stored as a price.
- Report: `server/reports/poc-2026-09-23-10-26.md`.

### 23 Sep 2026 — Phase 0 chat (groundwork)
- **Portal fixes (UI unchanged, `src/App.jsx`):**
  - ViolationDrawer crash fixed.
  - Add SKU saves MAP/MSRP and rejects duplicates.
  - Promotions are saved, with an end date.
  - "Showing X of N" count fixed.
  - Badges computed from data.
  - Fake IP replaced by evidence metadata.
  - Clearbit removed.
  - Charts follow the theme.
  - `alert()` replaced by a toast.
- **API client:** `src/api/client.js` and `src/api/mock/data.js` (`VITE_USE_MOCK`, `VITE_API_URL`).
- **Backend (`server/`):** Fastify API with JWT auth, BullMQ worker, S3 storage, `docker-compose.yml`, `render.yaml`, `vercel.json`.
- **Schema (`001_init.sql`):** account, app_user, account_membership, source, product, product_identifier, map_price, listing, crawl_run, observation (monthly partitions, append-only), evidence (SHA-256). RLS on account-owned tables.
- **Seed:** 3 accounts, 3 sources, 30 pilot SKUs, 82 listings.
- **Collector:** HTTP first, Playwright fallback, robots.txt respected, polite delays, evidence HTML + screenshot + SHA-256.
- **Docs:** `docs/enforcement-channels.md`. Brand Registry and VeRO are IP-only, not MAP, so Phase 4 needs separate pricing and IP tracks.

### 23 Sep 2026 — Planning chat
- Reviewed all uploaded docs, spec PDFs, addendum 3 roadmap and current portal code.
- Published MAP Intel Blueprint (roadmap, data architecture, data flow) and Map Intel Prototype (clickable, built on current UI).
- Decisions 1–4 above recorded.
