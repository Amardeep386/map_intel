# MAP Intel — target data architecture

Target model for all phases. Where the implemented schema (`server/db/*.sql`) already exists, it is the source of truth for names; extend it toward this model with new migrations. Diagrams: `docs/reference/blueprint.html`.

## Principles
- **Append-only facts:** observations, MAP prices, seller classifications, violations. Corrections are new rows.
- **Effective-dated:** MAP prices, promo windows, seller classifications, rule versions, policy documents (`[from, to)`, no gaps per scope). A verdict stores the versions it used.
- **Tenant boundary:** `account_id` on every account-owned row + Postgres RLS. The API connects as `mapintel_api` (no BYPASSRLS; `app.role=system` ignored); the few cross-account reads are SECURITY DEFINER `app_*` functions. Only the source catalogue is shared.
- **Shared core** (reused later by Pricing Intel unchanged): collection config, market identity (sellers), observations/listings/evidence.

## Domains and tables
| Domain | Tables |
|---|---|
| Tenancy & access | account, app_user, account_membership (role), user_invite, credential (vault, encrypted), audit_event |
| Collection config (shared core) | source, source_family, account_source (subscription), term_group, term, term_group_subscription, schedule, crawl_job, crawl_run |
| Catalogue & policy | product, product_identifier, map_price, promo_window, policy_document |
| Market identity (shared core) | seller, seller_alias, seller_link, seller_classification (per account, effective-dated), seller_contact |
| Observations (shared core) | listing, listing_discovery (term found listing; drives term yield), listing_state_event, observation (monthly partitions), evidence, match_candidate, match_decision, suppression |
| MAP decisions | rule, rule_version, violation, violation_event, replay_run |
| Enforcement | case, case_violation, notice, notice_template, communication, marketplace_report |
| Delivery | report_template, report_definition, report_run, destination, distribution_list, evidence_link, alert_rule, alert_event, notification |
| Health & ops | source_health_snapshot, data_quality_flag, ticket |

Key relationships: term → product (assigned); listing → source, seller, product (matched); observation → listing; evidence → observation; violation → observation, map_price (version), rule_version, class at capture; case_violation → violation; evidence_link → violation/evidence; source_health_snapshot → source × account × cycle.

## Key tables
| Table | Key columns | Rule |
|---|---|---|
| account | id, brand, regions[], currency, timezone, contract_from/to, settings (tolerance, min_depth, grace, match thresholds) | Tenant root; process config lives here |
| source | id, code, internal_name, family_id, category (Marketplace / Online Seller / Price Comparison), country, capability, options_schema, collector_status (live / planned) | Shared; options and per-term request costs declared by the collector (server/src/collector/catalogue.ts) |
| term | id, account_id, group_id, type (keyword/brand/identifier/url/seller), value, product_id?, active, batch_label | Yield derived from listings found |
| product | id, account_id, product_code, name, brand, category, group_id, standard_price (MSRP), retired | Identifiers in product_identifier |
| map_price | id, product_id, amount, currency, region?, effective_from, effective_to, source | Never overwritten |
| promo_window | id, account_id, products, sellers?, promo_amount, from, to | Below-MAP inside → "Authorised promo" |
| seller_classification | seller_id, account_id, class, from, to, set_by, note | Class at capture copied onto violation |
| listing | id, source_id, seller_id, product_id?, url, channel_sku, state (Staged/Included/Excluded/Retired), match_confidence, first_seen, last_seen | Stable identity over observations |
| observation | id, listing_id, observed_at (UTC), advertised_price, list_price, currency, promo_text, coupon, qty, availability, seller_name_raw, crawl_run_id, status | Append-only, partitioned monthly |
| evidence | id, observation_id, screenshot_uri, html_uri, pdf_uri, sha256, captured_at, method | S3 Object Lock; hash in Postgres |
| rule_version | rule_id, version, scope, condition (JSON), verdict, severity bands, valid_from/to, priority | Edit = new version |
| violation | id, account_id, observation_id, listing_id, product_id, seller_id, map_price_id, rule_version_id, class_at_capture, map_amount, observed_price, depth_abs, depth_pct, severity, status, first_seen, last_seen | Reproducible |
| case | id, account_id, seller_id, state, owner, opened_at, response_due, channel | Resolve on compliant observation or manual close with reason |
| evidence_link | token_hash, violation_id, scope, expires_at, created_by, views | Never an open URL |

## Status models
- **Listing:** Staged → Included / Excluded → Retired (absent from N consecutive successful crawls).
- **Violation:** Open, Needs review, Under notice, Authorised promo, Resolved, Dismissed (reason required).
- **Case:** Open → Notice sent → Awaiting response → Contested / Escalated → Resolved → Recurred.
- **Seller classification:** MAP Authorised, Unauthorised, Brand Direct, Unknown.
- **Severity (default, configurable):** Minor < 5%, Standard 5–15%, Severe > 15% below MAP.
- **Match thresholds (default, per account):** ≥ 90 auto-include (sampled for QA), 60–89 review, < 60 auto-exclude (kept, searchable).

## Data flow
1. **Schedule:** schedules × subscriptions × terms → crawl_job (priority, SLA, per-source rate limits).
2. **Queue:** BullMQ with retries and per-source budgets.
3. **Collect:** official API where available; else HTTP first, headless if needed; robots.txt; raw HTML + screenshot to S3 with SHA-256 → crawl_run.
4. **Extract:** price, list price, seller, stock, promo, identifiers.
5. **Validate:** bounds, currency, sudden change; suspicious → held, never published.
6. **Normalize:** currency, promo type, seller name → seller/alias.
7. **Match:** identifiers → title/image/attributes → confidence; 60–89 to review queue; decisions become labels.
8. **Store:** append observation + evidence; update listing current state.
9. **Judge:** rules engine with MAP in force at observed_at, promo windows, seller class, rule version → violation / violation_event.
10. **Deliver:** freeze evidence bundle; events (violation.created, resolved, source.degraded) → dashboard, alerts, reports, evidence page, API, cases.
11. **Enforce:** cases raise re-check cadence for listings under notice (e.g. every 6 h); resolved when a compliant observation arrives.
12. **Health:** every stage reports fetch/extraction success, rejections, freshness, coverage, evidence success → Data Health, banners, alerts, shaded chart days.

## Storage & services
Portal React + Vite (Vercel) · API Fastify/TypeScript (Render) · Worker BullMQ + Playwright (Render, US region for egress) · Postgres (Neon, RLS, monthly partitions) · Redis (Upstash) · S3 with Object Lock · secrets in a managed store / KMS-encrypted vault.
