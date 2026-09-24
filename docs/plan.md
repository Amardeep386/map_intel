# MAP Intel — plan (v1.2, 24 Sep 2026)

Screen reference: `docs/reference/prototype.html` and `docs/reference/prototype-src/`. Diagrams: `docs/reference/blueprint.html`. Data model and flow: `docs/architecture.md`. Progress: `docs/progress.md`.

## Scope
- MAP Intel and Pricing Intel are separate portals. MAP Intel is built completely first.
- Keep the current portal UI/UX; add or change features per the uploaded specs.
- Pilot brands: LG, Apple, Samsung.

## Decisions
| # | Decision |
|---|---|
| 1 | MAP Intel first; Pricing Intel later as a separate portal on the same data core |
| 2 | Keep current UI/UX; prototype is the screen reference |
| 3 | Data collection built in-house |
| 4 | Pilot brands: LG, Apple, Samsung |
| 5 | Hosting: portal on Vercel, API and worker on Render, Postgres on Neon, Redis on Upstash, files on S3 |
| 6 | Collection: official API where one exists; otherwise direct fetch (robots.txt, polite delays). Best Buy API switches on with `BESTBUY_API_KEY` |
| 7 | Pilot SKUs: 30 placeholder bestsellers (10 per brand) until real lists arrive |
| 8 | Backend: Fastify + TypeScript, `pg`, BullMQ, AWS SDK v3, JWT + bcrypt, Playwright |
| 9 | Dev uses cloud services (Neon, Upstash, S3), no local Docker |
| 10 | Dev workflow: Claude Code in Cursor, in this repo; context lives in `CLAUDE.md` and `docs/` |

## Open decisions
- US egress for collection (Render Ohio worker vs US proxy vs licensed data). Collection from India is blocked on Amazon and Best Buy.
- Best Buy API key; Amazon source (official API / provider vs page fetch).
- Brand users log in during the pilot, or reports only (rec: reports first, read-only login in P4).
- Volume sizing: SKUs per brand, sources, checks per day.
- MAP source per pilot brand: real brand-supplied MAP, or a stand-in (demo sandbox).
- Legal review: collection methods, site terms, notice wording, filing marketplace reports as the brand's agent.
- Cyber-analyst / Case Management recordings (never received).

## Phases
Indicative weeks assume 2–3 engineers + 1 data-ops analyst.

### P0 Groundwork — DONE (23 Sep 2026)
Backend skeleton, portal bug fixes, API client layer, collector proof of concept (Amazon, Best Buy, Walmart), enforcement-channel notes. See `docs/progress.md` and `docs/phase0-verification.md`.

### P1 Foundation (wk 3–6)
Accounts and roles (Administrator, Account manager, Analyst, Brand user); API on its own non-owner DB role with RLS; audit log (actor, time, before/after); credential vault; shared source catalogue + per-account subscriptions; collector-declared per-source options; term-group × source-category subscription matrix with request-cost estimate; named reusable schedules; terms (keyword, brand, identifier, URL, seller) with yield, bulk import, generate-from-catalogue.
Screens: Sources & Terms (new), Users & Access, Settings, Audit Log.
**Exit test:** an account is configured (sources subscribed, terms generated at catalogue scale) without Excel or a shared drive.

### P2a Catalogue (wk 7–12)
Products + identifiers (UPC, EAN, MPN, ASIN, alt SKU 1–6) with import dry-run diff; MAP history (effective-dated, regional); promotion windows; versioned policy documents; sellers with aliases, linkages, effective-dated classification (MAP Authorised / Unauthorised / Brand Direct / Unknown) and contacts; listing lifecycle Staged → Included / Excluded → Retired; match confidence (identifier, title, image, price plausibility, attributes, prior decisions) with thresholds ≥90 include / 60–89 review / <60 exclude; Mapping Center review queue; exclusions with reason + scope → suppressions; seeded inclusion/exclusion rules.
Screens: Product Summary, MAP Policies, Sellers, Mapping Center.
**Exit test:** an analyst cleanses a pilot brand's daily volume without an Excel pivot.

### P2b Collectors (wk 7–12, parallel)
Scheduler + BullMQ queue from P1 schedules/subscriptions; production collectors for Amazon, Walmart, Best Buy, eBay, Target, Home Depot (API first, HTTP, headless only when needed); extract → validate (bounds, currency, sudden change; hold suspicious) → normalize; evidence at collection with S3 Object Lock; append-only observations; source health (fetch/extraction success, freshness, coverage, failure class).
Screens: Data Health.
**Exit test:** pilot SKUs collected daily from all launch sources with evidence; failures visible in Data Health.

### P3 Detection & reporting — pilot go-live (wk 13–17)
Rules engine (scope, condition, verdict, validity, priority, dry run before publish, versioning, replay into shadow set; seed default rules); violations vs MAP in force (statuses Open, Needs review, Under notice, Authorised promo, Resolved, Dismissed); Overview dashboard (authorised vs unauthorised trend, top sellers, depth, time to compliance, coverage, degraded days shaded); reports (templates with typed params, schedules, repository, adoption counts, email / hosted link / SFTP); evidence page per violation behind expiring scoped token, linked from every report row; basic email alerts; data-quality banners.
Screens: Overview, Violations, Rules (new), Reports, Alerts, Evidence page.
**Exit test:** weekly report and monthly trend deck generated with a working evidence link on every violation row, no Excel.

### P4 Enforcement & learning (wk 18–23)
Cases (Open → Notice sent → Awaiting response → Contested / Escalated → Resolved → Recurred); letter templates from frozen evidence + seller contacts, brand approval; marketplace channels as two tracks (pricing notices vs IP reports via Brand Registry / VeRO, per `docs/enforcement-channels.md`); faster re-check under notice, resolve only on compliant observation; learning loop + QA sampling; seller risk index; full alerts, inbox, Slack/Teams, webhooks.
Screens: Enforcement (replaces Email Center), Alerts inbox, seller profile.
**Exit test:** detected → notice sent → resolved and re-verified without a spreadsheet.

### P5 Scale & governance (wk 24+)
Guided onboarding; org-wide crawl budget; internal tickets; replay at scale; retention and audit hardening; SSO/MFA; public API and exports; hand-off note for Pricing Intel.
**Exit test:** onboarding a new brand is a guided flow, not a wiki page or a call.
