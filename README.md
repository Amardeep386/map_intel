# Mirethos MAP Intel

MAP monitoring and enforcement portal. The repo has two parts:

- **Portal** (repo root): React 19, Vite and Tailwind v4.
- **Backend** (`server/`): Node/TypeScript API, collector worker, PostgreSQL, Redis queue and S3-compatible evidence storage.

## Run the portal only (sample data)

```bash
npm install
npm run dev            # http://localhost:5173
```

By default every screen uses built-in sample data (`VITE_USE_MOCK=true`).

## Run everything locally

Needs Docker Desktop and Node 20+.

```bash
# 1. Infrastructure: Postgres, Redis, MinIO (S3) and the evidence bucket
docker compose up -d postgres redis minio minio-init

# 2. Backend
cd server
cp .env.example .env          # then set JWT_SECRET and SEED_ADMIN_PASSWORD
npm install
npx playwright install chromium
npm run db:migrate
npm run db:seed               # pilot accounts (LG, Apple, Samsung), 30 SKUs, 82 retailer listings, admin user
npm run dev                   # API on http://localhost:4000  (GET /health)
npm run dev:worker            # collector worker (second terminal)

# 3. Portal against the API
cd ..
echo VITE_USE_MOCK=false > .env.local
npm run dev
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `server/.env`.

Other ways to run it:

- **Everything in containers:** `docker compose --profile app up -d --build`
- **MinIO console:** http://localhost:9001 (user `mapintel`, password `mapintel-secret`)

## Collector proof of concept

```bash
cd server
npm run collect -- --inline --account lg --limit 3   # quick test, prints results
npm run collect -- --inline                          # all 82 pilot listings (slow and polite: ~15-20 s between hits per retailer)
npm run collect:report                               # writes server/reports/poc-<time>.md and .csv
```

Each result is saved as an append-only `observation` row. Its `evidence` row points to an HTML copy and a screenshot in object storage, and stores the SHA-256 of each file. The fetch order is: plain HTTP first, a headless browser only if that is blocked or incomplete, and robots.txt is respected. See `server/README.md` for details and limits.

## Docs

- `docs/enforcement-channels.md`: Amazon Brand Registry and eBay VeRO notes (Phase 0 spike)
- Blueprint, prototype and progress log are kept in the Mirethos Claude project.

## Deploy (planned)

| Part | Host |
|---|---|
| Portal | Vercel (`vercel.json`) |
| API and collector worker | Render (`render.yaml`) |
| Postgres | Neon |
| Redis | Upstash |
| Evidence files | AWS S3 (with Object Lock) |
