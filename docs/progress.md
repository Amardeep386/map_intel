# MAP Intel — progress log

**This file in the repo (`docs/progress.md`) is the master copy.** Claude Code reads it at the start of every phase or session and updates it before finishing. The planning chat in the Mirethos Claude project mirrors it after each review. Newest entry at the top of "Log". Keep entries short: what was built, where it lives, decisions, known issues, next step.

## Current status
- **Phase:** P1 Foundation **done** (exit test 30/30 and browser checks passed, 24 Sep 2026). P0 done 23 Sep 2026.
- **Last updated:** 24 Sep 2026 (Claude Code: Phase 1)
- **Repo:** `E:\Claude Mirethos docs\Map Intel\Map Intel` (git, remote `github.com/Amardeep386/map_intel`). `main` = `origin/main` at `e7ee4dc` (P0). Phase 1 is on branch `phase-1-foundation` (`e37bbf7` to the docs commit), **not pushed or merged**.
- **Dev workflow:** Cursor with Claude Code in the terminal, working in the repo folder. Services: Neon (Postgres 18), Upstash (Redis), AWS S3. No Docker on the PC.
- **Live portal:** front-end with API client layer. Mock mode by default; `VITE_USE_MOCK=false` switches sign-in, clients, Product Summary, Sources & Terms, Settings, Users & Access and Audit Log to the API.
- **Env (server/.env, never committed):** `DATABASE_URL` (owner: migrations, seed, worker), `DATABASE_URL_API` (role `mapintel_api`: the API), `VAULT_KEYS` + `VAULT_ACTIVE_KEY`, `PORTAL_URL` (invite links). The same variables are listed in `render.yaml`.
- **Next step:**
  1. Review Phase 1 (review prompt in `docs/prompts.md`), then merge `phase-1-foundation` into `main` and push.
  2. Decide on US egress for the collector (Open questions); it gates Phase 2b.
  3. Check the 3 unconfirmed Amazon ASINs from a US browser (Known issues).
  4. Start Phase 2a and/or 2b (prompts in `docs/prompts.md`).

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
- [x] P1 Foundation: accounts, roles, audit log, vault, sources, subscriptions, schedules, terms (exit test 30/30, 24 Sep 2026)
- [ ] P2a Catalogue: products, MAP history, promo windows, policy docs, sellers, Mapping Center
- [ ] P2b Collectors: scheduler, production collectors, evidence capture, observation store, source health
- [ ] P3 Detection & reporting: rules, violations, dashboard, reports, evidence links, email alerts (pilot go-live)
- [ ] P4 Enforcement & learning: cases, notices, marketplace channels, learning loop, alerts
- [ ] P5 Scale & governance: onboarding, budget, tickets, SSO, API

## Known issues carried forward
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
