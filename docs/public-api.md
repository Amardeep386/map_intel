# MAP Intel public API (read-only)

For a brand's BI team: read your account's MAP Intel data into Power BI, Tableau, Looker, a
spreadsheet or a script. Built in Phase 5 · M9 (`server/src/api/routes/publicApi.ts`,
`server/src/lib/datasets.ts`).

- **Base URL:** `https://map-intel-api.onrender.com/v1`
- **Key:** an account Administrator or Account manager creates one in the portal under
  **Admin → Data & API → New key**. It is shown once. Send it on every call:
  `Authorization: Bearer mik_xxxxxxxx_…`
- **Read-only:** a key reads its own account only and cannot change anything. Revoked or expired keys
  stop at once.
- **Limits:** 120 calls a minute per key (then `429` with `Retry-After: 60`); up to 1,000 rows a page.
- **Logged:** every call (time, path, status, rows, IP) is listed under the key's **Calls**.
- The free hosting sleeps when idle: the first call after a quiet spell can take up to a minute.

## Endpoints

| Path | What | Filters |
|---|---|---|
| `GET /v1` | The account, and every dataset with its fields | — |
| `GET /v1/products` | Catalogue: identifiers (UPC, EAN, MPN, ASIN), MAP in force, MSRP | `status` (Active, Paused, Retired) |
| `GET /v1/violations` | Violations: status, severity, product, seller, source, listing URL, opened / last seen / closed, last price, MAP, depth % | `status` (Open, Needs review, Under notice, Authorised promo, Resolved, Dismissed, or `active`), `from` / `to` (opened) |
| `GET /v1/observations` | Every advertised price seen on the account's matched listings, with its verdict, the MAP used and the evidence fingerprint (SHA-256) | `from` / `to` (observed; default: the last 30 days), `product` (product code) |
| `GET /v1/sellers` | Sellers with their classification and open / total violations | `status` (MAP Authorised, Unauthorised, Brand Direct, Unknown) |
| `GET /v1/cases` | Enforcement cases: state, seller, source, violations, opened, response due | `status` (a state, or `active`), `from` / `to` (opened) |

Common parameters: `limit` (1–1,000, default 100) and `cursor`. Dates are ISO 8601
(`2026-10-01` or `2026-10-01T00:00:00Z`); `to` is not included. Times in responses are UTC.

## Paging

Every list answers `{ "data": [...], "next_cursor": "…" }`. Call again with `?cursor=<next_cursor>`
(and the same filters) until `next_cursor` is `null`. Cursors follow a stable order, so new rows
during paging are not skipped or repeated.

```bash
KEY="mik_xxxxxxxx_..."
curl -s -H "Authorization: Bearer $KEY" "https://map-intel-api.onrender.com/v1/violations?status=active&limit=500"
```

```python
import requests
url, key, rows, cursor = "https://map-intel-api.onrender.com/v1/observations", "mik_...", [], None
while True:
    r = requests.get(url, headers={"Authorization": f"Bearer {key}"},
                     params={"from": "2026-09-01", "limit": 1000, **({"cursor": cursor} if cursor else {})}, timeout=120)
    r.raise_for_status()
    page = r.json(); rows += page["data"]; cursor = page["next_cursor"]
    if not cursor: break
```

Power BI: **Get data → Web → Advanced**, URL as above, header `Authorization` = `Bearer mik_…`;
for more than one page use a Power Query function that follows `next_cursor`.

## Files instead of the API

The same datasets, with the same fields, download as CSV or Excel from **Admin → Data & API**
(up to 100,000 rows each; narrow the dates for more). Every role sees the datasets it may read.
Values starting with `=`, `+`, `-` or `@` are prefixed with `'` in CSV so spreadsheets do not run
them as formulas.

## Errors

`400` bad parameter or cursor · `401` missing, wrong, revoked or expired key · `429` too many calls ·
`5xx` try again later. Bodies are `{ "error": "…" }`.
