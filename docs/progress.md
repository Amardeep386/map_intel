# MAP Intel — progress log

**This file in the repo (`docs/progress.md`) is the master copy.** Claude Code reads it at the start of every phase or session and updates it before finishing. The planning chat in the Mirethos Claude project mirrors it after each review. Newest entry at the top of "Log". Keep entries short: what was built, where it lives, decisions, known issues, next step.

## Current status
- **Phase:** P0 Groundwork **done** (verified 23 Sep 2026; follow-ups closed 24 Sep 2026, including browser Steps 4.2 and 5).
- **Last updated:** 24 Sep 2026 (Claude Code: P0 follow-ups)
- **Repo:** `E:\Claude Mirethos docs\Map Intel\Map Intel` (git, remote `github.com/Amardeep386/map_intel`). Local commits `0ce6d4e` (baseline), `eccdcd8` (verification fixes), `f1a4462` (context docs) and the P0 follow-ups commit; **not pushed**.
- **Dev workflow:** Cursor with Claude Code in the terminal, working in the repo folder. Services: Neon (Postgres 18), Upstash (Redis), AWS S3. No Docker on the PC.
- **Live portal:** front-end with API client layer. Mock mode by default; `VITE_USE_MOCK=false` switches sign-in, clients and Product Summary to the API.
- **Next step:**
  1. Supply URLs for the 10 missing SKU/retailer pairs (Known issues).
  2. Decide on US egress for the collector (see Open questions).
  3. Start Phase 1 in Claude Code (prompt in `docs/prompts.md`).

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

## Open questions
- **US egress for collection.** From India, Best Buy drops every connection and Amazon returns bot checks on 21 of 26 pages. Options:
  - run the worker on Render Ohio (already planned);
  - a US residential or ISP proxy;
  - licensed data.
  - Amazon may still block datacenter IPs, so test the Render option first.
- **Best Buy API key.** Official, free and reliable; recommended.
- **Amazon source.** Official API or a data provider, versus fetching pages. Part of the legal review.
- Brand users log in during the pilot, or reports only?
- Volume: SKUs per pilot brand, launch sources, checks per day.
- MAP source per pilot brand: real brand-supplied MAP, or a stand-in for a demo sandbox? (No MAP values are seeded; MAP shows "—".)
- Legal review of collection methods, notice wording, and filing marketplace reports as the brand's agent.
- Cyber-analyst / Case Management recordings (never received).

## Phase checklist
- [x] P0 Groundwork: backend skeleton, bug fixes, API client, collector proof of concept, enforcement-channel spike (verified 23 Sep 2026)
- [ ] P1 Foundation: accounts, roles, audit log, vault, sources, subscriptions, schedules, terms
- [ ] P2a Catalogue: products, MAP history, promo windows, policy docs, sellers, Mapping Center
- [ ] P2b Collectors: scheduler, production collectors, evidence capture, observation store, source health
- [ ] P3 Detection & reporting: rules, violations, dashboard, reports, evidence links, email alerts (pilot go-live)
- [ ] P4 Enforcement & learning: cases, notices, marketplace channels, learning loop, alerts
- [ ] P5 Scale & governance: onboarding, budget, tickets, SSO, API

## Known issues carried forward
- **Collector blocked from India on Amazon and Best Buy.** Needs US egress; see Open questions.
- **10 SKU/retailer pairs have no listing** (8 never found, plus 2 retired on 24 Sep). URLs needed from you:

  | SKU | Model | Needs |
  |---|---|---|
  | LG-P04 | 65QNED75BUA | Amazon |
  | LG-P09 | S90TY | Amazon (dead ASIN `B0FKB4VTDY` retired) |
  | LG-P09 | S90TY | Walmart |
  | LG-P10 | 16U55U-H.AU77U3 | Walmart |
  | APL-P10 | MEQX4LW/A | Amazon |
  | APL-P10 | MEQX4LW/A | Walmart |
  | SAM-P02 | SM-S942UZKEXAA | Amazon |
  | SAM-P03 | SM-R640NZKAXAR | Walmart (…KWXAR variant URL retired) |
  | SAM-P07 | QN65QN90FAFXZA | Amazon |
  | SAM-P07 | QN65QN90FAFXZA | Walmart |
- **Only the main offer is collected.** Walmart LG-P01 had 5 other sellers that were not captured. MAP monitoring needs all offers on a listing (Phase 2b).
- **Test SKU `TEST-P0-STEP5` (LG) is `Retired`, not deleted.** Its MAP row is protected by `map_price_no_delete`. Product Summary still lists Retired products; filter them in Phase 1/2a.
- **Neon owner role has BYPASSRLS.** Tenant isolation relies on the API switching to `mapintel_tenant`, which is verified (10/10). In Phase 1, give the API its own non-owner database role.
- **Upstash command limits.** Run the worker only when needed until production.
- **Mock screens.** Screens for later phases still show mock data in API mode.
- **Lint warnings.** 11 remain: 9 in the portal (6 unused names, 3 React-hook notes) and 2 in `server/` (`collect.ts`, `report.ts`); none is a bug. `docs/reference/` is excluded from lint and build.

## Log
### 24 Sep 2026 — P0 follow-ups (Claude Code)
- **Commits:** `f1a4462` (context docs) and the follow-ups commit; not pushed.
- **Browser checks:** Step 4.2 PASS (4/4 live pages match the report); Step 5 PASS (sign in, client list, Product Summary, Add SKU survives refresh). Details in `docs/phase0-verification.md`.
- **Admin password rotated** with the new `server` script `npm run admin:set-password`. It never prints the password. `SEED_ADMIN_PASSWORD` must now be at least 12 characters.
- **Seed:** `pilot-skus.json` has a `retired` entry per product; `seed.ts` sets those listings to `Retired`, keeping their observations and evidence. LG-P09 Amazon and SAM-P03 Walmart retired; Neon has 80 Included and 2 Retired listings.
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
