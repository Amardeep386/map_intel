# MAP Intel — Claude Code prompts (Cursor)

## How to use
1. In Cursor, open the terminal in the repo folder (`E:\Claude Mirethos docs\Map Intel\Map Intel`) and run `claude`.
2. Press **Shift+Tab** until the mode shows **plan mode**, then paste the phase prompt. Claude reads the docs, asks questions and proposes a plan without editing anything.
3. Approve the plan (switch back out of plan mode) and let it build.
4. Long phase? End the session with the **wrap-up prompt**, run `/clear`, then continue with the **resume prompt**.
5. After each phase, paste the **review prompt** into the planning chat in the Mirethos Claude project.

`CLAUDE.md` is loaded automatically, so the rules (keep the UI, no `.env`, append-only, RLS, tests) don't need repeating.

---

## Phase 0 follow-ups (do first)

```
Read docs/progress.md. Phase 0 is done but has follow-ups.
1. Commit the new CLAUDE.md and docs/ files (plan.md, architecture.md, prompts.md, progress.md, reference/) with the message "docs: add Claude Code project context".
2. Walk me through the two outstanding browser checks (Steps 4.2 and 5 in docs/phase0-verification.md) one step at a time, and record the results.
3. Help me rotate the seed admin password without printing any .env contents.
4. Make sure lint and build ignore docs/reference/ (it is reference code, not part of the app).
5. Fix the seed data issues listed under Known issues (LG-P09 ASIN, SAM-P03 Walmart URL) and list the 8 missing SKU/retailer pairs so I can supply them.
Update docs/progress.md and commit when done.
```

---

## Phase 1 — Foundation

```
Start Phase 1 (Foundation) of MAP Intel.

Read docs/progress.md, the P1 section of docs/plan.md, and the Tenancy and Collection config parts of docs/architecture.md. Check the current schema in server/db and the git log. For the screens, use docs/reference/prototype-src/views_collect.jsx (Sources & Terms) and views_admin.jsx (Settings, Users & Access, Audit Log).

Create a branch phase-1-foundation.

Goals:
1. Accounts, users, roles (Administrator, Account manager, Analyst, Brand user) with role checks on every API route.
2. Give the API its own non-owner Postgres role so RLS is enforced by the database, not just by switching roles (see Known issues).
3. Audit log: actor (user, rule or system), time, action, before/after, for every change.
4. Credential vault for source logins and delivery credentials (encrypted at rest, never returned in full by the API).
5. Shared source catalogue + per-account subscriptions; per-source options declared by the collector.
6. Subscription matrix (term group × source category) with a request-cost estimate against an account budget.
7. Named, reusable schedules matched by selector (source, category, family, term, term group), with priority.
8. Terms with types (keyword, brand, identifier, URL, seller), yield counters, bulk import, and "generate from catalogue" with a naming template and batch label.
9. Connect Sources & Terms (new screen), Users & Access, Settings and Audit Log to the API, matching the prototype and existing components.

Exit test: an account (LG, Apple, Samsung) is fully configured — sources subscribed, terms generated at catalogue scale — without Excel.

Ask me any questions first, then show the plan. Build in small commits with tests. At the end, run the exit test, update docs/progress.md (tick P1) and commit.
```

---

## Phase 2a — Catalogue & Mapping Center

```
Start Phase 2a (Catalogue) of MAP Intel. Phase 2b (collectors) may be running on another branch — don't change collector code here.

Read docs/progress.md, the P2a section of docs/plan.md, and the Catalogue, Market identity and Observations parts of docs/architecture.md. Screens: docs/reference/prototype-src/views_catalog.jsx (Product Summary, MAP Policies, Mapping Center) and the Sellers view in views_monitor.jsx.

Create a branch phase-2a-catalogue.

Goals:
1. Products with identifiers (UPC, EAN, MPN, ASIN, alt SKU 1–6); catalogue import (CSV/XLSX) with column mapping and a dry-run diff before commit.
2. MAP as effective-dated history (never overwritten, optional region); promotion windows (products, optional sellers, dates); versioned policy documents.
3. Sellers with aliases, linkages, effective-dated classification (MAP Authorised / Unauthorised / Brand Direct / Unknown) and contacts.
4. Listing lifecycle Staged → Included / Excluded → Retired, with a state history.
5. Match confidence from the six signals, stored per signal; thresholds from account settings (default ≥90 / 60–89 / <60).
6. Mapping Center: keyboard review queue (lowest confidence × deepest discount first), tabs Staged / Included / Excluded / Retired / Suppressions; exclusions need a reason and scope and become suppressions; decisions saved as labels. Seed default inclusion/exclusion rules (ASIN/MPN in URL, attribute match, warehouse deals, used/refurbished/open box, auctions).
7. Connect Product Summary, MAP Policies, Sellers and Mapping Center to the API, matching the prototype.
8. Load the LG, Apple and Samsung catalogues (ask me for the real SKU and MAP files; otherwise keep the placeholders and flag it).

Exit test: an analyst cleanses a pilot brand's daily volume without an Excel pivot.

Ask me any questions first (especially where each brand's MAP values come from), then show the plan. Small commits with tests. At the end, run the exit test, update docs/progress.md (tick P2a) and commit.
```

---

## Phase 2b — Production collectors

```
Start Phase 2b (Collectors) of MAP Intel. Phase 2a (catalogue) may be running on another branch — don't change catalogue or UI code owned by 2a except the Data Health screen.

Read docs/progress.md (especially the collector results and the US egress question), the P2b section of docs/plan.md, and the Data flow section of docs/architecture.md. Start from the Phase 0 collector in server/. Screen: DataHealthView in docs/reference/prototype-src/views_collect.jsx.

Create a branch phase-2b-collectors.

Goals:
1. Scheduler that turns Phase 1 schedules × subscriptions × terms into jobs on the BullMQ queue, with priorities, retries and per-source rate limits.
2. Collectors for Amazon, Walmart, Best Buy, eBay, Target and Home Depot: official API first where we have keys (Best Buy via BESTBUY_API_KEY), otherwise HTTP first, headless only when needed, robots.txt respected.
3. Extract → validate (price bounds, currency, sudden change; suspicious results held) → normalize.
4. Evidence at collection: HTML + screenshot to S3 with Object Lock and SHA-256.
5. Append-only observations; never carry an old price forward.
6. Source health per source × account × run: fetch success, extraction success, freshness, coverage, failure class (blocked, layout changed, timeout, empty, auth). Connect the Data Health screen.
7. Hand collected listings to the Phase 2a matcher (or a stub if 2a isn't merged yet).
8. Help me set up and test US egress (Render Ohio worker first) and record the results.

Exit test: pilot SKUs for LG, Apple and Samsung are collected daily from all launch sources with evidence, and failures show in Data Health.

Ask me any questions first, then show the plan. Small commits with tests. At the end, run the exit test, update docs/progress.md (tick P2b) and commit.
```

---

## Phase 3 — Detection & reporting (pilot go-live)

```
Start Phase 3 (Detection & reporting) of MAP Intel. This phase ends with the pilot live for LG, Apple and Samsung.

Read docs/progress.md, the P3 section of docs/plan.md, and the MAP decisions, Delivery and Status models parts of docs/architecture.md. Make sure the P2a and P2b branches are merged. Screens: OverviewView and ViolationsView/ViolationDrawer/EvidencePage in docs/reference/prototype-src/views_monitor.jsx, RulesView in views_collect.jsx, ReportsView and AlertsView in views_admin.jsx.

Create a branch phase-3-detection.

Goals:
1. Rules engine: scope, condition, verdict, validity, priority; dry run over a date range required before publishing; each edit creates a new version; replay into a shadow result set. Seed rule R-01 (below MAP by more than tolerance, severity by depth) and "Brand Direct is never a violation".
2. Violations judged against the MAP in force at observed_at, respecting promo windows; store MAP version, rule version and seller class at capture. Statuses: Open, Needs review, Under notice, Authorised promo, Resolved, Dismissed (reason required).
3. Overview dashboard: authorised vs unauthorised trend, top sellers, depth, time to compliance, coverage; degraded days shaded.
4. Reports: templates with typed parameters, schedules, repository (with rule set and data-quality note per run), adoption counts; delivery by email, hosted link and SFTP (credentials from the vault).
5. Evidence page per violation behind an expiring, scoped token; evidence link on every report row.
6. Basic email alerts: new violating seller, severe depth, source degraded before a scheduled report. Deduplicated.
7. Data-quality banners on the dashboard and reports.
8. Connect Overview, Violations, Rules, Reports, Alerts and the evidence page, matching the prototype.

Exit test: a weekly report and a monthly trend deck are generated with a working evidence link on every violation row, without Excel.

Ask me any questions first, then show the plan. Small commits with tests. At the end, run the exit test, update docs/progress.md (tick P3) and commit.
```

---

## Phase 4 — Enforcement & learning

```
Start Phase 4 (Enforcement & learning) of MAP Intel.

Read docs/progress.md, the P4 section of docs/plan.md, the Enforcement part of docs/architecture.md and docs/enforcement-channels.md. Screens: EnforcementView and SellersView in docs/reference/prototype-src/views_monitor.jsx, AlertsView in views_admin.jsx.

Create a branch phase-4-enforcement.

Goals:
1. Cases: violations grouped by seller and period; states Open → Notice sent → Awaiting response → Contested / Escalated → Resolved → Recurred; owner and response due date.
2. Letter templates filled from the frozen evidence bundle, seller contact and policy document; brand approval before sending (configurable per account); communications log.
3. Two enforcement tracks: pricing notices (email) and IP reports (Amazon Brand Registry, eBay VeRO) where we have access, per docs/enforcement-channels.md.
4. Faster re-check schedule for listings under notice; a case resolves only when a compliant observation arrives (manual close needs a reason).
5. Learning loop: analyst decisions become labels, model version recorded; QA sampling of auto-include/exclude with precision per threshold.
6. Seller risk index (frequency, depth, recurrence, responsiveness).
7. Full alert rules, alert inbox, Slack/Teams and webhooks; deduplicated with delivery log.
8. Replace Email Center with the Enforcement screen; add the seller profile drawer; match the prototype.

Exit test: a violation goes detected → notice sent → resolved and re-verified without a spreadsheet.

Ask me any questions first, then show the plan. Small commits with tests. At the end, run the exit test, update docs/progress.md (tick P4) and commit.
```

---

## Phase 5 — Scale & governance

```
Start Phase 5 (Scale & governance) of MAP Intel — the last phase before Pricing Intel.

Read docs/progress.md, the P5 section of docs/plan.md and docs/architecture.md. Screen: OnboardingView in docs/reference/prototype-src/views_admin.jsx and the "New account" button in App.jsx.

Create a branch phase-5-scale.

Goals:
1. Guided onboarding: account → catalogue → MAP & policy → sellers → sources & terms → rules & baseline crawl → reports, producing a complete account.
2. Org-wide crawl budget dashboard across accounts.
3. Internal ticket tracker for operational issues, separate from cases.
4. Replay and shadow evaluation at scale; retention and audit hardening.
5. SSO/MFA; public API and exports for brand BI teams.
6. docs/pricing-intel-handoff.md: which tables, services and screens Pricing Intel reuses.

Exit test: onboarding a new brand is finishing a guided flow, not writing a wiki page or booking a call.

Ask me any questions first, then show the plan. Small commits with tests. At the end, run the exit test, update docs/progress.md (tick P5) and commit.
```

---

## Resume prompt (new session in the middle of a phase)

```
We're continuing Phase X of MAP Intel. Read docs/progress.md and the git log on the current branch, tell me what's done and what's left for this phase, then continue with the next item.
```

## Wrap-up prompt (end of a session)

```
Let's stop here for this session. Run the build, lint and tests, update docs/progress.md (what was built, where, decisions, known issues, next step), and commit.
```

## Review prompt (paste into the planning chat in the Mirethos Claude project)

```
Phase X is finished. Read docs/progress.md and docs/plan.md from the Map Intel repo in my connected folder, check what was built against the Phase X exit test, list anything missing or risky, update the plan if needed, and mirror progress.md into the project.
```
