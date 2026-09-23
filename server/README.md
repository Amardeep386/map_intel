# MAP Intel backend

```
src/
  api/            Fastify API (auth, accounts, products, observations, evidence, crawl runs)
  worker/         BullMQ worker that runs collector jobs
  collector/      fetch (HTTP → headless browser fallback), extract, evidence, persist
    extract/      per-retailer extractors (Amazon, Best Buy, Walmart) + JSON-LD helpers
  lib/            config, database (with tenant/RLS helpers), S3 storage, queue, auth
  scripts/        migrate, seed, storage-init, collect, report
db/migrations/    SQL migrations (001_init.sql = Phase 0 schema)
seeds/            pilot-skus.json (LG, Apple, Samsung: 30 SKUs, 82 listings)
test/             extractor unit tests (npm test)
```

## API (Phase 0)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB, Redis and storage checks |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` (JWT, 12 h) |
| GET | `/auth/me` | current user |
| GET | `/accounts` | accounts the user can open (admins: all) |
| GET | `/accounts/:id/products` | products with MAP in force and the latest offer per retailer |
| POST | `/accounts/:id/products` | add a SKU (`code, name, model, category?, map?, msrp?`) |
| GET | `/accounts/:id/observations?product=&limit=` | observation history with evidence hashes |
| GET | `/evidence/:id` | evidence metadata + 15-minute download links |
| GET | `/sources` | source catalogue |
| GET/POST | `/crawl-runs` | list runs / queue a run (admin) |

## Data rules

- **Tenant isolation.** `account_id` is on every account-owned table (`product`, `product_identifier`, `map_price`, `account_membership`). Postgres row-level security enforces it. API queries for one brand run inside `withTenant()` as the non-superuser role `mapintel_tenant`, so RLS applies even on local Docker Postgres.
- **Append-only history.** `observation` and `evidence` are append-only (triggers block UPDATE and DELETE). `observation` is partitioned by month.
- **Evidence is captured when the price is seen.** The exact HTML that was parsed is stored, plus a screenshot, and each file's SHA-256 is saved. S3 also receives the hash as an upload checksum. Screenshots of HTTP-fetched pages are rendered from the stored HTML with JavaScript off, so the picture matches the hashed file.

## Collector limits to know

- **Where requests come from matters.** Retailers vary price, stock and pages by country. Run from India and you may get country splash pages, "does not ship" messages, or blocks. Production collectors should run in a US region (e.g. Render Ohio), and `COLLECT_EGRESS_LABEL` records where each run came from.
- **Politeness defaults.** One request at a time per retailer, 15–20 s apart, and robots.txt is respected. No request uses a login or bypasses a CAPTCHA. A blocked page is recorded as `blocked`, never as a price.
- **Legal review.** Fetching retailer pages directly is on the list for the legal review (Decision 5). Best Buy has an official Products API: set `BESTBUY_API_KEY` and the collector uses it for price and stock, still fetching the page for evidence.
