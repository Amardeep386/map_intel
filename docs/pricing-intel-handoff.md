# Hand-off note: what Pricing Intel reuses from MAP Intel

Written at the end of Phase 5 (9 Oct 2026). MAP Intel and Pricing Intel are separate portals
(decision 1); Pricing Intel is built later on the same data core. This note lists what it can take
as it is, what needs a small change, and what stays MAP-only. Names are the implemented ones
(`server/db/migrations`, `server/src`). Data model: `docs/architecture.md`.

Pricing Intel's job differs from MAP Intel's: it watches **competitors' and the brand's own prices**
(price position, index, changes, promotions) rather than judging **resellers against a MAP**. So
collection, identity, evidence and the platform carry over almost whole; MAP judgement and
enforcement do not.

## 1. Reuse as it is

### Data (shared core)
| Area | Tables | Notes |
|---|---|---|
| Sources | `source`, `source_family` | One shared catalogue. Pricing Intel adds its sources (e.g. competitor stores, price comparison) as rows; collectors declare options and request costs in `server/src/collector/catalogue.ts`. |
| Collection config | `account_source`, `term_group`, `term`, `term_group_subscription`, `schedule`, `crawl_run`, `crawl_job` | Subscriptions, terms (keyword / brand / identifier / URL / seller), the matrix, named schedules, the job ledger. Account-owned with RLS. |
| Listings & prices | `listing`, `listing_discovery`, `observation` (monthly partitions), `evidence`, `evidence_card`, `results_page`, `results_page_listing` | Shared, append-only. An observation is a price fact for any purpose; nothing in it is MAP-specific. |
| Market identity | `seller`, `seller_alias`, `seller_link`, `seller_contact` | Shared storefront identity. |
| Health | `source_health_snapshot` | Per account × source × run. |
| Platform | `account`, `app_user`, `account_membership`, `user_invite`, `credential` (vault), `audit_event` (hash-chained), `audit_checkpoint`, `retention_run`, `ticket`, `ticket_event`, `crawl_budget`, `user_identity`, `sso_login`, `mfa_recovery_code`, `api_key`, `api_request_log` | Accounts, people, sign-in (password, MFA, SSO), audit, retention, budget, tickets, API keys. |

### Services
| Service | Where | Notes |
|---|---|---|
| Scheduler and queue | `server/src/scheduler/*` (`expandFiring`, `fireSchedule`, `fireBaselines`, `work.ts`), `lib/queue.ts` | Schedules × subscriptions × terms → jobs, account budget and org-wide daily caps, priorities. |
| Collectors | `server/src/collector/*` (Walmart, eBay Browse API, Best Buy API, Amazon, Target, Home Depot extractors; robots.txt, polite delays, headless fallback, block detection, failure classes) | Extract price, list price, seller, stock, promo. |
| Evidence | `collector/collect.ts`, `lib/storage.ts` | HTML / screenshot / API record to S3 with Object Lock and SHA-256; `deleteObjectForGood` for retention. |
| Validation and health | `collector/outcome.ts`, `lib/health.ts`, `lib/dataQuality.ts` | Suspicious prices held; coverage and freshness per source. |
| Platform | `lib/auth.ts`, `lib/mfa*.ts`, `lib/sso.ts`, `lib/permissions.ts`, `lib/audit.ts`, `lib/vault.ts`, `lib/rateLimit.ts`, `lib/retention.ts`, `lib/tickets.ts`, `lib/crawlBudget.ts`, `lib/apiKeys.ts` | Same platform for both portals; one sign-in and one Mirethos operations view across them is the natural next step. |
| Delivery plumbing | `lib/reportRunner.ts` (PDF via Chromium), `lib/sftp.ts`, `lib/mailer.ts`, `lib/evidenceLinks.ts` | Report templates are MAP-specific (below); the machinery is not. |

### Screens (portal)
Sources & Terms, Data Health, Users & Access, Settings (account, retention, sign-in security), Audit Log
(verify, export), Data & API, the sign-in / MFA / SSO screens, Onboarding (steps differ, see 2), and the
Platform pages (Tickets, Crawl budget, Replays, Governance). Design system: `mirethos-theme.css`, `src/ui.jsx`.

## 2. Reuse with a change

| What | Change for Pricing Intel |
|---|---|
| `product`, `product_identifier`, `catalogue_import` | Same catalogue and import (dry-run diff). Add the brand's own target prices or price bands where MAP Intel has `map_price`. |
| Mapping: `listing_match`, `listing_state_event`, `match_candidate`, `match_signal`, `match_rule`, `suppression`, `lib/matching.ts`, Mapping Center | Matching a listing to a product is the same problem. Pricing Intel also matches **competitor products** (other brands' equivalents): a product-to-competitor link table is new; the confidence signals and QA loop (`qa_sample`) carry over. |
| `seller_classification` | MAP classes (MAP Authorised / Unauthorised / Brand Direct / Unknown) mean little for pricing; Pricing Intel needs its own classes (own store, retailer, marketplace third party, competitor). Same effective-dated pattern. |
| Onboarding (`lib/onboarding.ts`) | Same engine (steps read from real configuration, go-live, baseline crawl). Steps change: no "MAP & policy"; add "competitor set" and "price targets". |
| Data & API (`lib/datasets.ts`, `/v1`) | Same keyset paging, keys, exports; new datasets (price history, price index, competitor gaps). |
| Replay (`lib/replay.ts`) | The batching, cursor and lease are generic; the evaluation inside is MAP rules. |
| Alerts (`alert_rule`, `alert_event`, `lib/alerts.ts`) | Engine reusable; triggers are MAP / enforcement ones today (price drop, competitor undercut would be new). |
| Overview and reports | Layout and PDF / hosted-link / SFTP delivery reusable; the queries and templates are MAP's. |

## 3. MAP-only (not for Pricing Intel)

`map_price`, `promo_window` (+ products / sellers), `policy_document`, `rule`, `rule_version`,
`dry_run`, `judge_run`, `verdict`, `violation`, `violation_observation`, `violation_event`,
`replay_run` / `replay_result` contents, `enforcement_case`, `case_violation`, `case_event`, `notice`,
`notice_template`, `communication`, `marketplace_report`, `report_template` rows (Listing MAP report,
monthly trend), seller risk (`lib/sellerRisk.ts`), and the Violations, Rules, Enforcement and
MAP Policies screens.

## 4. Things to decide when Pricing Intel starts

1. **One API and database, two portals** (recommended: the data core is already shared and
   account-scoped), or a second service on the same database.
2. **Accounts:** the same account for a brand in both portals (one catalogue, one set of people), with
   a product flag per account (`account.settings.products = ['map', 'pricing']`).
3. **Collection volume:** pricing needs more frequent checks on fewer listings; the org-wide crawl
   budget (`crawl_budget`) and per-source caps are where that is balanced against MAP collection.
4. **Retention:** price history is the product for Pricing Intel, so observation retention will be
   longer there; retention already keeps a shared observation for the longest period of any account
   that maps its listing.
5. **Collection gate:** the P2b collection push (all launch sources, Amazon route A/B, the Render
   worker) is needed by both portals and stays the first step.
