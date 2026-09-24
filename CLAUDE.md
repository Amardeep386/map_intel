# CLAUDE.md — Mirethos MAP Intel

Read this first in every session. It is loaded automatically by Claude Code.

## What this is
MAP Intel: a Minimum Advertised Price monitoring and enforcement portal by Mirethos. It collects advertised prices from retailers and marketplaces, matches them to a brand's products, flags prices below the MAP in force, keeps tamper-evident evidence, and supports enforcement. Pilot brands: **LG, Apple, Samsung**.

Pricing Intel is a **separate portal built later**. Do not add competitive-pricing features here, but keep the shared data core (sources, products, sellers, listings, observations, evidence) reusable.

## Where things are
| Path | What |
|---|---|
| `src/` | Portal: React 19 + Vite + Tailwind v4, lucide-react icons, Recharts |
| `src/api/` | API client (`VITE_USE_MOCK`, `VITE_API_URL`) and mock data |
| `mirethos-theme.css`, `src/index.css` | Mirethos theme tokens (light "Creamy Sand", dark "Chocolate") |
| `server/` | Fastify + TypeScript API, BullMQ worker, collectors, migrations (`server/db`), seeds, tests |
| `docs/plan.md` | Refined roadmap, phase goals and exit tests, decisions |
| `docs/progress.md` | **Progress log. Read at the start, update at the end of every phase or session.** |
| `docs/architecture.md` | Target data model, data flow, status models, storage |
| `docs/prompts.md` | Phase kickoff prompts |
| `docs/reference/prototype.html` | Clickable prototype of the target screens (open in a browser) |
| `docs/reference/prototype-src/` | Prototype React source: the screen reference to copy layouts from |
| `docs/reference/blueprint.html` | Blueprint with diagrams (roadmap, ERD, data flow) |

## Rules
1. **Keep the current UI/UX.** Reuse the existing building blocks (Pill, KPI, Card, PageHeader, PrimaryButton, SearchBox, Table, drawers, modals), `brand-*` Tailwind colours and theme variables. New screens follow `docs/reference/prototype-src/`. No redesigns, no new UI libraries.
2. **Never read, print or commit `.env` files** (`.env`, `.env.local`, `server/.env`). Use `.env.example` for new variables.
3. **Append-only facts.** Observations, MAP prices, seller classifications and violations are never updated in place; corrections are new rows. Effective-dated tables use half-open `[from, to)` intervals.
4. **Tenant isolation.** Every account-owned table has `account_id` with row-level security. The shared source catalogue is the only cross-account data.
5. **A violation is judged against the MAP in force on the observation date**, and stores the MAP version, rule version and seller classification it used.
6. **Evidence is captured at collection time** (HTML + screenshot, SHA-256 stored). Never store a blocked or failed page as a price; never carry an old price forward as new.
7. Collectors: official API where available, otherwise HTTP first, headless browser only when needed, robots.txt respected, polite delays.
8. Each phase exit test in `docs/plan.md` must pass before a phase is marked done.

## Working style
- Start each phase in **plan mode**: read `docs/progress.md`, `docs/plan.md` and the relevant part of `docs/architecture.md`, ask questions, then propose a plan before editing.
- Work on a branch per phase (`phase-1-foundation`, …). Commit at each working milestone with clear messages. **Don't push** unless asked.
- Migrations: add new numbered files in `server/db` (never edit an applied one).
- Before saying something is done: portal `npm run build` and `npm run lint`; server typecheck and `npm test`; add tests for new server logic.
- End of a phase or session: update `docs/progress.md` (status, what was built and where, decisions, known issues, next step), then commit.

## Commands
```bash
npm run dev                 # portal, http://localhost:5173 (mock data by default)
cd server && npm run dev    # API, http://localhost:4000
cd server && npm run dev:worker
cd server && npm run db:migrate && npm run db:seed
cd server && npm test
```
Dev services: Neon (Postgres), Upstash (Redis), AWS S3. No Docker on this PC.
