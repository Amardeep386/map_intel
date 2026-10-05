# Claude Code prompt: Amazon.com LG Sandbox slice (finish P2b)

Paste the block below into Claude Code in Cursor, in the repo folder.

```
We are finishing P2b with a first real slice: Amazon.com on the LG Sandbox. Most of the code exists; this is configuration, a few small features, and a real US run.

Read first: docs/progress.md (27–28 Sep entries, decisions 22–28, known issues), CLAUDE.md, server/src/collector/{jobs,collect,browser,http,discovery,sources}.ts, server/src/collector/extract/amazon.ts, server/src/scheduler/{expand,tick}.ts, server/src/lib/{mapping,validate}.ts.

Create a branch amazon-lg-slice from main.

Decisions for this slice (record them in docs/progress.md as decisions 29–35):
- Scope: Amazon.com only, LG Sandbox only, the first 10 active LG SKUs of the demo catalogue (by SKU code order). One term group "Amazon LG slice" with a model-number term and a name term per SKU, Marketplace cell = Some → Amazon only.
- Discovery depth: 2 search pages per term. Used / renewed / refurbished / open-box results are never staged as candidates for inclusion.
- Auto-validation stays on: 90+ auto-include, 60–89 review in the Mapping Center, below 60 auto-exclude.
- Monitoring: once a day at 09:00 Asia/Kolkata, Included listings only. A fresh screenshot + HTML is stored on every observation, including when nothing changed.
- Pace: 3 s minimum + up to 1 s random jitter between pages on amazon.com (COLLECT_MIN_DELAY_MS=3000, COLLECT_JITTER_MS=1000 for this source), one tab, one page at a time.
- Conduct: human-paced, not hidden. No stealth plugins, fingerprint spoofing, CAPTCHA solving or proxy rotation. robots.txt stays respected. A robot-check / CAPTCHA / "sorry" / 503 page is recorded as blocked and never stores a price.
- Egress: free first (see M6).

Milestones (small commits, tests with each):
M1 Configuration script `npm run slice:amazon-lg -- [--commit]` (dry run by default, through the API as the seed admin, audited): LG subscription to amazon_us active with search_pages=2, new_only=true, buy_box_only=true; the term group and its 20 terms; two schedules on LG: "Amazon LG discovery" (manual only / never fires by cron) and "Amazon LG daily monitoring" (cron 0 9 * * *, timezone Asia/Kolkata, listing scope Included only). Safe to re-run.
M2 Monitoring-only mode: add `schedule.kind` ('both' default, 'monitoring', 'discovery') in a new migration; expandFiring skips discover jobs for 'monitoring' and collect jobs for 'discovery'. API, Sources & Terms schedule editor and tests updated.
M3 Live evidence on Amazon: product pages go browser-first on amazon.com so the screenshot is the live page. Before the screenshot, scroll down in two or three steps to the buy box and back to the top with short pauses, then take the full-page screenshot (cap stays 4000 px). Remove `--disable-blink-features=AutomationControlled` from browser.ts (decision 27).
M4 Results-page evidence: every search results page read by a discover job stores HTML + screenshot + SHA-256 in S3 with Object Lock, linked to the crawl_job (new table or columns; append-only). Show it in the Data Health failure drawer and on the listing history in the Mapping Center ("found on search page N for term X").
M5 Stop on block: per run and source, after 2 consecutive blocked results, cancel the remaining queued jobs of that source in the run (skip reason 'cancelled', failure class blocked) instead of retrying through the browser. Data Health shows the run as blocked with the evidence of the challenge page.
M6 Egress, cheapest first:
   a. I run the free Ohio probe (PowerShell snippet in progress.md) against the Render API; you read server/reports/egress-render-ohio.json and record the Amazon result.
   b. Add a manual GitHub Actions workflow `.github/workflows/egress-probe.yml` (workflow_dispatch) that runs `npm run egress:probe` on ubuntu-latest and uploads the JSON report as an artifact. Tell me which repo secrets to add.
   c. If either US probe gets real Amazon pages: add `.github/workflows/amazon-lg-slice.yml` with workflow_dispatch inputs (discover | monitor) and a schedule of `30 3 * * *` (09:00 IST) for monitor; it installs Playwright Chromium and runs the scheduler inline (`npm run scheduler -- --fire <schedule> --account lg --inline`), so no Redis is needed. Secrets: DATABASE_URL, DATABASE_SSL, S3_*, S3_OBJECT_LOCK_DAYS, JWT_SECRET, COLLECT_EGRESS_LABEL=github-actions. This is for the test period; note in progress.md that production monitoring moves to the Render worker.
   d. If both probes are blocked: stop and write up the result and options (Render Starter worker, licensed data provider) in progress.md. Do not add proxies.
M7 Real run and checks: fire discovery once, then let monitoring run on two consecutive days. Report: pages read / blocked, listings staged, auto-included / review / auto-excluded counts, evidence files and hash re-check, and a Day 1 vs Day 2 comparison showing a new observation + screenshot for unchanged prices. Save the report to server/reports/.

Replace the Amazon unit-test fixtures with real pages from the first US run (server/test/fixtures/README.md).

Ask me any questions first, then show the plan. At the end, update docs/progress.md (status, decisions, log, known issues), and only tick P2b if `npm run exit:p2b -- --check --scheduled` passes for this scope.
```

## What you do by hand

1. Run the Ohio probe snippet from `docs/progress.md` (free).
2. Add the GitHub repo secrets Claude Code lists (Settings → Secrets and variables → Actions).
3. After discovery, open the Mapping Center on the LG Sandbox and work the 60–89 review queue (I include, X exclude). Check a few auto-includes too.
4. Look at Data Health after each run.
