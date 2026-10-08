# MAP Intel — progress log

**This file in the repo (`docs/progress.md`) is the master copy.** Claude Code reads it at the start of every phase or session and updates it before finishing. The planning chat in the Mirethos Claude project mirrors it after each review. Newest entry at the top of "Log". Keep entries short: what was built, where it lives, decisions, known issues, next step.

## Current status
- **Phase:** **P3 Detection & reporting done for the LG slice scope (exit test 20/20, 6 Oct 2026)** on branch `phase-3-detection`, **merged into `main` and pushed 6 Oct 2026 (live on Vercel + Render)**, built on the LG slice data (decision 40). The full P2b collection push (all launch sources, Apple + Samsung, Amazon) comes **before pilot go-live**, not after P5.
- **P2b:** P2b Collectors **in progress**, finishing through a first real slice on the **LG Sandbox**, now **route D: Walmart + eBay (Browse API), Amazon paused** (branch `amazon-lg-slice`, **merged into `main` on 5 Oct 2026**). **Exit test `--scope lg-slice` passed 10/10 on 5 Oct 2026** after three daily monitoring runs (2–4 Oct); M7 report in `server/reports/lg-slice-m7-2026-10-05.md`. Amazon.com blocked both free US egresses on 30 Sep. Demo catalogue and brand logos added 28 Sep 2026. P2a done 25 Sep 2026 (merged into `main`), P1 done 24 Sep 2026, P0 done 23 Sep 2026.
- **Last updated:** 8 Oct 2026 (Claude Code: P4 on branch `phase-4-enforcement`: M1 schema, M2 cases, M3 letters + approval done; decision 42)
- **Repo:** `E:\Claude Mirethos docs\Map Intel\Map Intel` (git, remote `github.com/Amardeep386/map_intel`). `main` = `origin/main` = P2a + Phase 2b + the demo catalogue + brand logos (latest `2cfc942` plus this docs commit). Phase 2b reached `main` on 28 Sep through the `demo-catalogue` merge (`bd96457`), at your request, before its exit test. Branches `phase-2b-collectors` and `demo-catalogue` are pushed and fully contained in `main`.
- **Live (since 25 Sep 2026):** portal https://map-intel-iota.vercel.app (Vercel, deploys `main`), API https://map-intel-api.onrender.com (Render free plan: no worker, sleeps when idle; a GitHub Action pings it every 10 min). Production shares Neon, Upstash and S3 with development.
- **Dev workflow:** Cursor with Claude Code in the terminal, working in the repo folder. Services: Neon (Postgres 18), Upstash (Redis), AWS S3. No Docker on the PC.
- **Portal:** mock mode by default; `VITE_USE_MOCK=false` puts every P1, P2a and P2b screen on the API.
- **Env (server/.env, never committed):** `DATABASE_URL`, `DATABASE_URL_API`, `VAULT_KEYS` + `VAULT_ACTIVE_KEY`, `PORTAL_URL`, and since 27 Sep `S3_OBJECT_LOCK_DAYS=365` (you set it). New optional collector variables are in `server/.env.example`.
- **Next step (resume here): P4 Enforcement on branch `phase-4-enforcement` (decision 42), M1–M3 done; next M4 (6-hourly re-check under notice, resolve on a compliant observation).** Plan agreed 8 Oct: M1 schema · M2 cases (group a seller's violations, owner, due date, states, Under notice) · M3 letters + brand approval (logged, not emailed) · M4 6-hourly re-check of listings under notice (GitHub Action), resolve only on a compliant observation · M5 IP track (manual filing, evidence pack) · M6 seller risk index + seller profile · M7 learning loop (matcher version, weekly QA sample, precision) · M8 more in-app alerts · M9 Enforcement screen replaces Email Center · M10 exit test `exit:p4 --scope lg-slice` (scratch flow + a real case on V-00002). Letter wording needs the legal review (decision 5) before a real notice goes out.
  - Still open from P3: look at the P3 screens on the live site; Walmart "gram 17"" mapped to a 16" product; Walmart / Beach Camera gram Pro 16 at $1,499.99.
- **Phase order from 6 Oct 2026 (decision 40):**
  1. **Now:** P3 built and tested on the LG slice (Walmart + eBay, daily on GitHub Actions). Small collection jobs run alongside: real fixtures, shorter eBay terms, keep the daily run healthy.
  2. **Before pilot go-live (P3 gate):** collection push: Apple and Samsung slices, Best Buy, Target, Home Depot, Amazon (route A or B), daily run moved to the Render worker; full P2b exit test (all launch sources).
  3. **Then:** P4, then P5.
- **Carried from the M7 findings (5 Oct):**
  1. **Done 5 Oct:** eBay windwing521 and Walmart gram 17" excluded. Still check Walmart / Beach Camera gram Pro 16 at $1,499.99 (MAP $2,099; page shows no model number).
  2. **You:** the Walmart "gram 17"" listing is mapped to 16Z90TL-H.AUB9U1, a 16" product: re-map or exclude it.
  3. **Done 5 Oct:** `amazon-lg-slice` merged into `main`; `lg-slice.yml` now checks out `main`. Pushed 5 Oct.
  4. Claude Code: capture real Walmart / eBay fixtures for the tests; add shorter eBay keyword terms (9 of 20 searches found nothing).
  5. Daily monitoring keeps running on GitHub Actions (starts ~6 h late, around 15:00 IST) until it moves to the Render worker.
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
| 40 | Phase order: build P3 now on the LG slice data instead of waiting for full collection; P3–P5 only read observations, evidence and source health, so more sources and brands add rows, not rework. Full collection (all launch sources, Apple + Samsung, Amazon route A/B, Render worker) is the gate before pilot go-live, not after P5. The daily LG run is kept healthy meanwhile | 6 Oct 2026 | Claude Code session |
| 41 | Portal redesign: Mirethos frame (espresso sidebar with the copper logo, porcelain page, white surfaces, hairline borders, Geist type, warm-tuned status colours) with the client's brand colour kept as a restrained accent; primary buttons espresso; grouped navigation (Monitor, Catalogue, Collection, Enforcement, Admin) and a breadcrumb top bar. Replaces the old "keep the current UI" rule | 6 Oct 2026 | Claude Code session (user request) |
| 42 | P4 (Enforcement) now, on the LG slice, before the collection push; the collection push stays the gate before pilot go-live. P4 choices: notices are logged, not emailed (no provider); brand approval of every notice on by default (per-account setting); no Slack / Teams / webhooks in P4 (in-app inbox only) | 8 Oct 2026 | Claude Code session |

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
- [x] P2b Collectors (LG slice scope): scheduler, production collectors, evidence capture, observation store, source health (exit test `--scope lg-slice` 10/10, 5 Oct 2026; Walmart + eBay API; Amazon paused, manual evidence in P3)
- [ ] P2b full scope: all launch sources, Apple + Samsung, Amazon (gate before P3 pilot go-live, decision 40)
- [x] P3 Detection & reporting (LG slice scope): rules, violations, dashboard, reports, evidence links, alerts (exit test `--scope lg-slice` 20/20, 6 Oct 2026; merged into `main` and pushed 6 Oct). Pilot go-live waits for the full collection push and the three-brand run (decision 40)
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
### 8 Oct 2026 (later) — P4 M3: letters, brand approval, communications log (Claude Code)
- `server/src/lib/notices.ts` + routes `server/src/api/routes/notices.ts`, all audited. **Draft** a notice for a case from a template (`POST /accounts/:id/cases/:caseId/notices`): placeholders `{{brand}} {{seller}} {{source}} {{period}} {{violationCount}} {{violationTable}} {{responseDue}} {{policy}} {{sellerHistory}} {{signature}}` filled from the case's active violations (SKU, advertised vs MAP, % below, listing URL and a fresh 90-day **secure evidence link** each, frozen into the notice), the MAP policy in force and the seller's email contacts ("Notices" label first). Edit the draft (`PATCH /notices/:id`), **submit** for brand approval (`/submit`; refused while a `{{placeholder}}` is left), **approve / reject** (`/approve`, `/reject` with a note; new permission `notices.approve`, **Brand users only**), **send** (`/send` with a channel; email goes through the mailer = logged, no provider; other channels recorded), cancel, download as text (`/notices/:id/text`). Sending logs an outbound communication, moves an Open case to Notice sent and puts its violations Under notice. If `brand_approval_required` is off, a draft is sent directly. **Communications log** (`GET /communications`, `POST /cases/:caseId/communications`): seller responses, contests (a contest moves a case waiting on the seller to Contested) and internal notes. **Templates** (`GET/POST/PATCH /notice-templates`, `settings.write`): unknown placeholders refused; a wording edit raises the version, earlier notices keep their text.
- Migration `037_notice_links.sql` (applied): evidence links may be created by a notice. Administrators and Account managers no longer hold every account action: `notices.approve` is the brand's.
- Tests: `test/db/notices.test.ts` 6/6 (shared set-up moved to `test/db/enforcement-world.ts`); cases 5/5.
### 8 Oct 2026 (later) — P4 M2: cases (Claude Code)
- `server/src/lib/cases.ts` + routes `server/src/api/routes/cases.ts` (`GET/POST /accounts/:id/cases`, `GET/PATCH …/cases/:caseId`, `POST …/:caseId/violations`, `POST …/:caseId/state`), all audited. A case covers one seller's **active** violations (each in one case only); default response due = today + `case_response_days` (new account setting, default 7). Manual moves: Open → Notice sent / Escalated / Resolved; Notice sent → Awaiting response / Contested / Escalated / Resolved; Contested and Escalated → each other, Awaiting response or Resolved. Notice sent, Contested, Escalated and Resolved need a reason (Notice sent by hand = a notice sent outside MAP Intel; M3 logs real ones). On Notice sent the case's Open / Needs review violations go **Under notice**, and violations added later follow. Opening a case for a seller whose case was resolved in the last 60 days marks that case **Recurred** and links the new one. Owner must be an Analyst / manager / admin on the account. New permissions `cases.read` (all roles incl. Brand user) and `cases.write` (Analyst and up).
- Tests: `test/db/cases.test.ts` 5/5; schema, permissions, settings DB tests and 164 unit tests pass.
### 8 Oct 2026 (later) — P4 started; M1 enforcement schema (Claude Code)
- Decision 42: P4 now on the LG slice, before the collection push. Branch `phase-4-enforcement`.
- **M1:** migration `036_enforcement.sql` (applied to the shared Neon DB): `enforcement_case` (C-seq, one seller, owner / due date / IP flag the only mutable fields), `case_violation` (a violation in one case at most, same seller), `case_event` + view `case_current` (append-only states; Resolved needs a verdict or a reason), `notice_template` (T-1 First warning, T-2 MAP reminder, T-3 Final notice seeded for every account, new accounts by trigger), `notice` (frozen once out of Draft; forward-only status; approval cannot be skipped; rejection needs a note), `communication` (append-only log), `marketplace_report` (only on IP cases, reference required once filed). RLS on all. `app_ebay_account_deletion` also redacts that seller's notices and communications. Tests: `test/db/enforcement-schema.test.ts` 5/5; eBay deletion, RLS, permissions and unit tests pass.
### 8 Oct 2026 — excluding a listing closes its violation at once (Claude Code)
- You excluded the windwing521 "Bent#23" eBay listing, but V-00003 stayed open: only the judge closed violations of listings no longer Included, and it runs after the daily collection (~16:00 IST). Claude Code ran `npm run judge -- --account lg` by hand; V-00003 is now Dismissed ("Listing no longer included").
- **Change:** `closeUnwatched()` (in `server/src/lib/violations.ts`) is shared by the judge and Mapping Center. Exclude / restore / retire (and listing imports) now end the open violation of any listing that left Included in the same request; the activity log says "N violations closed". New DB test in `test/db/detection.test.ts`; detection + mapping DB tests 24/24.
### 6 Oct 2026 (later) — portal redesign; Rules freeze fixed (Claude Code)
- **Fix on `main` (`2cae7b2`, pushed 6 Oct with the redesign):** the Rules screen and the schedule-report form froze the page (useWorkspace returned a new `can()` every render; both list it as an effect dependency). `can` is now memoised. Fixed on the live site.
- **Redesign (decision 41), merged into `main` and pushed 6 Oct (`f9c9491`), live on Vercel:** `mirethos-theme.css` rewritten around logo-sampled copper (#3D1304 → #FCE8C3), espresso sidebar, porcelain page, Geist / Geist Mono, warm-tuned status colours (light + dark); `src/ui.jsx` restyled with the same API; `App.jsx` shell (grouped espresso sidebar with the real logo `src/assets/mirethos-mark.png`, workspace switcher, breadcrumb top bar with user menu), new workspace picker, login page with the real logo; client colours tuned per theme and used as accents only; Overview / Violations tightened; evidence and report pages on the new frame. Screen titles drop the "— Client (Sandbox)" suffix (the breadcrumb shows it). Checked with headless screenshots of every screen in light and dark (mock mode).

### 6 Oct 2026 — phase order changed; P3 started (Claude Code)
- Decision 40: P3 is built now on the LG slice data; the full collection push is the gate before pilot go-live. Branch `phase-3-detection` created from `main`.
- **Your answers (6 Oct):** no email provider yet (emails logged, alerts in the portal inbox); monthly trend deck as PDF + hosted link; SFTP built now; no manual Amazon evidence screen in P3; Brand users read violations and reports.
- **M1** migration **031** (applied to Neon): `rule` / `rule_version` (published content frozen by trigger), append-only `verdict`, `violation` episodes + `violation_observation` + `violation_event` (status history; Dismissed needs a reason), view `violation_current`, `judge_run`, `dry_run`, `replay_run` / `replay_result`; R-00 (Brand Direct exempt) and R-01 (below MAP beyond tolerance; Minor <5%, Standard 5–15%, Severe >15%) seeded per account. New permissions violations / rules / reports / alerts.
- **M2** `lib/rules.ts` (pure engine + episodes), `lib/judge.ts` (MAP / promo / seller class / rule versions in force at `observed_at`; idempotent; ends episodes of listings no longer Included), `lib/ruleAdmin.ts` (dry run of the exact draft before publish; publish closes the old version; replay into the shadow set), `/rules` routes, `npm run judge`, judging after every finished crawl run (`collector/jobs.ts finalizeRun`).
- **M3** `lib/violations.ts` + `/violations` routes (list, counts, CSV, detail, status events, audited); portal `src/views/ViolationsView.jsx`.
- **M4** migration **032** (applied): `evidence_link` (token SHA-256 only, scope, expiry, revoke, views); public `GET /e/:token`; portal `/evidence/<token>` (`src/views/EvidencePage.jsx`) re-hashes the latest proof and shows its Object Lock retention.
- **M5** `lib/overview.ts`, `lib/dataQuality.ts`, `/overview`; portal `src/views/OverviewView.jsx` (data-quality banner, degraded days shaded). Old mock Overview / drawer removed from `App.jsx`.
- Tests: 14 unit (`test/rules.test.ts`), 11 against Neon (`test/db/detection.test.ts`, rolled-back transactions); 153 unit tests pass.
- **Preview of LG judging (rolled back):** 17 priced observations of Included listings: 10 compliant, 7 violating, giving 3 violations: Beach Camera gram Pro 16 on Walmart ($1,499.99 vs MAP $2,099, Severe), eBay certrbtech 15U50U ($605 vs $629, Minor), eBay windwing521 16U55U "Bent#23" ($399.99 vs $1,099, Severe). **That windwing521 listing is Included**: the matcher re-included it after the 5 Oct bulk Restore (the one you excluded on 5 Oct was a different windwing521 listing, 15U50U #37). Exclude it in Mapping Center; the judge then ends its violation by itself.
- Browser check (mock mode): the evidence page renders with no console errors; screenshots timed out and mock sign-in did not complete, so Overview / Violations still need a look in the browser.
- **LG backfilled (6 Oct):** `npm run judge -- --account lg --backfill`: 17 verdicts, 3 violations (V-00001 Beach Camera, V-00002 certrbtech, V-00003 windwing521 Bent#23); a second run adds nothing.
- **M6 reports:** migrations **033** (report_template, report_definition, report_run with a frozen snapshot, report_delivery, notification) and **034** (grant), applied. `lib/reports.ts` (periods in the account timezone, snapshots with a 90-day evidence link on every violation row, CSV, the HTML both the PDF and the hosted page come from), `lib/reportRunner.ts` (queue → generate → PDF + delivery; schedules via `dueSlot`), `lib/mailer.ts` (log driver: emails are written to `notification`, not sent), `collector/browser.ts renderPdf`, `/reports` routes + public `/r/:token`, portal `/report/<token>`, `npm run reports`, hourly `.github/workflows/reports.yml` (sets `PORTAL_URL` to the live portal; optional secrets `VAULT_KEYS` / `VAULT_ACTIVE_KEY` for SFTP). Trial runs RPT-0001 (weekly, 3 rows) and RPT-0002 (October trend deck) were generated from this PC, so their links point at localhost.
- **M7 SFTP delivery:** `lib/sftp.ts` (`ssh2-sftp-client`): password or private key from the vault ('sftp' credential with a username); host, port, folder and the server's host-key fingerprint (`SHA256:…`) in the report destination. The host key is always pinned: unknown or changed = refused, with the key seen reported. Each file is read back and its SHA-256 compared. `POST /reports/sftp-test` writes and removes a test file, or returns the host key to confirm first. A failed SFTP delivery is recorded and does not block email / hosted link. Tests: in-process ssh2 server (`test/sftpServer.ts`), 4 unit + 1 end-to-end against Neon + S3 (needs one finished report run in the database). The real brand SFTP target is added when a brand gives one.
- **M8 alerts:** migration **035** (applied): `alert_rule` (A-01 new violating seller, A-02 severe violation, A-03 a source not healthy within 24 h of a scheduled report; seeded per account, no recipients yet) and `alert_event` (unique per account + rule + dedup key; only read marks change). `lib/alerts.ts` runs after every judging and hourly in the reports runner; emails go through the mailer (logged). `/alerts` routes: inbox + unread count, mark read, rules. LG on 6 Oct: 5 alerts (3 new sellers, 2 severe); a second evaluation raised none.
- **M9 screens:** `src/views/RulesView.jsx` (draft → save → dry run with blast radius → publish; replay; versions; match rules read-only), `ReportsView.jsx` (scheduled / repository / template library; schedule form from the template's typed parameters; SFTP destination with Test connection and "Trust this key"; open a run's frozen page, PDF / CSV, copy hosted link), `AlertsView.jsx` (inbox, rules). New Rules nav item; sidebar badges for open violations and unread alerts. Mock stand-ins in `src/api/mock/p3admin.js`. Browser check not done: screenshots time out in this Chrome session and the local sign-in did not get past the form (`.env.local` exists; not read), so the screens are verified by build, lint and the API tests only.
- **M10 exit test** `npm run exit:p3 -- --scope lg-slice` (`src/scripts/exit-p3.ts`): **20/20 PASS** on 6 Oct 2026, report `server/reports/exit-p3-2026-10-06.md`. Through the API as invited LG users: R-01 publish refused without a dry run (LG draft then discarded, live rules unchanged; publish-after-dry-run proven in a throwaway account); judging idempotent (17 verdicts, 3 violations); weekly Listing MAP Report **RPT-0003** (PDF + CSV, 3 rows, every evidence link opens its violation with the proof re-hashed, hosted link from the logged email, SFTP delivery to an in-process server with the host key pinned, hashes match); monthly trend deck **RPT-0004** (October, PDF + hosted link, 3/3 links); links refused (404 / 410 / 410 / 403, Brand user 403); Brand user sees only shared reports; alerts deduplicated; data-quality note on a degraded source; no Excel. The run found real degraded days (Walmart.com, eBay) in the last 30 days, so RPT-0003 carries a data-quality note. RPT-0003 / RPT-0004 stay in LG's repository (links built with this PC's PORTAL_URL, localhost). The SFTP test server moved to `src/lib/sftpTestServer.ts`.
- Known limits: email is logged, not sent (no provider yet); PDFs come from the hourly GitHub runner while Render has no worker; the three-brand run and real SFTP targets come later; the screens have not been seen in a browser.

### 5 Oct 2026 (night) — colour / contrast pass over the whole portal (Claude Code)
- Audited every screen in light and dark with an in-browser WCAG contrast check: light had faint muted text (4.4:1); dark had 9 failing styles (status greens / reds / ambers, text on accent buttons). Also found by reading the code: toasts were white on cream (invisible in light), the invite page had the old white-on-cream login card, overlays turned the screen cream in dark, the violation evidence box used taupe on dark brown, and the "Violations by severity" donut drew at zero width.
- Fixes: `--text-muted` #6B5A4F (5.9:1), borders a little stronger; dark-mode overrides of the Tailwind status shades (`mirethos-theme.css`); `text-on-accent` (`--accent-contrast`, white or espresso chosen from each brand's accent); toasts on the inverted surface; overlays `bg-black/40`; evidence box on the page colour; invite page in the sign-in style; 9 px text → 10 px; donut fixed. Re-audit: 0 failures in light and dark on all 13 screens.

### 5 Oct 2026 (evening) — portal fixes: text selection, URL column, new sign-in page (Claude Code)
- Text can be selected and copied again (`select-none` removed from the app shell).
- Mapping Center tables: **URL** column ("Open" in a new tab).
- Mapping (LG, by you): eBay windwing521 $399.99 (for parts) and Walmart "gram 17"" (mapped to a 16" product) **excluded**. A bulk Restore at 11:20 IST put 644 Excluded / Retired listings back in review; Apply rules re-excluded most (the 1 Oct hand exclusions are now matcher decisions). 6 new eBay listings included by you + 1 by the matcher: monitored from the next daily run.
- New sign-in page (`LoginScreen` in `src/App.jsx`): espresso brand panel + form, show-password toggle, Mirethos copper before a brand is chosen (the default client LG's crimson showed before). All pushed to `main` and live.

### 5 Oct 2026 (later still) — evidence cards for eBay; Price checks in the listing drawer (Claude Code)
- **Evidence card** (`collector/apiCard.ts`, `collector/evidenceCard.ts`, `browser.ts renderCard`): where the page blocks us (eBay), a PNG drawn from the API response (photo, title, price, condition in red when not new, seller + rating, availability, shipping, location, item number, MPN, GTIN, read time, the response's SHA-256), labelled "drawn from the eBay Browse API response, not a screenshot". Stored as `<observation>.card.png` with Object Lock; **migration 030** `evidence_card` (append-only, one per evidence row, `source_sha256` = the response it was drawn from; applied to Neon). The API response stays the evidence.
- `npm run evidence:cards [-- --commit]` draws cards for stored responses (re-hashed first): **6 drawn** for the eBay checks of 1–4 Oct.
- API: `GET …/mapping/listings/:id` returns `checks` (every observation, evidence parts); `GET /evidence/:id` returns `card`. Portal: Mapping Center listing drawer → **Price checks** (when, price, seller, status, Screenshot / Evidence card / API data); Data Health opens the card when there is no screenshot.
- **Found while building it:** eBay's own reply says the $399.99 windwing521 gram Book 15 (the M7 "breach") is **"For parts or not working"**: not a MAP violation. `conditionFrom` did not recognise that wording (so new-only let it through); now "for parts / parts only / not working" = used. **Exclude that listing by hand** (decided listings keep their decision).
- Tests 138/138 (new `api-card.test.ts`); portal build OK, lint 0 errors.

### 5 Oct 2026 (later) — amazon-lg-slice merged into main (Claude Code)
- Merge commit on `main` (no conflicts); `.github/workflows/lg-slice.yml` default branch `amazon-lg-slice` → `main`. Server typecheck OK, tests 135/135; portal build OK, lint 0 errors.

### 5 Oct 2026 — LG slice M7 report; exit test passed (Claude Code)
- You worked the review queue on 1 Oct: 3 Walmart gram laptops included; the LCD panel and 2 other listings excluded.
- Daily monitoring ran on GitHub Actions 2, 3 and 4 Oct (`c17fdf07`, `f7f939a0`, `4c08e114`): 4/4 jobs ok each day, 4 listings priced with evidence (Walmart HTML + screenshot, eBay API JSON), prices unchanged. Scheduled 03:30 UTC, started ~09:30–10:00 UTC (GitHub delay).
- **`exit:p2b --check --scheduled --scope lg-slice`: 10/10** (`server/reports/exit-p2b-lg-slice-2026-10-05-04-00.md`). P2b ticked for the LG slice scope.
- **M7 report** `server/reports/lg-slice-m7-2026-10-05.md`: 2 candidate breaches (eBay −42.8%, Walmart gram Pro 16 −28.5%), 1 likely wrong mapping (gram 17" → 16" product), thin coverage (4 real listings).
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
