// Summarise a crawl run (default: the latest) and write it to server/reports/<run>.md and .csv
//   npm run collect:report
//   npm run collect:report -- --run <crawl_run_id>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { closeDb, withSystem } from '../lib/db.js';

const { values } = parseArgs({ options: { run: { type: 'string' } } });
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reports');

interface Row {
  brand: string;
  product_code: string;
  model_number: string;
  source: string;
  status: string;
  advertised_price: number | null;
  list_price: number | null;
  availability: string | null;
  seller_name_raw: string | null;
  fetch_method: string | null;
  model_match: boolean | null;
  observed_at: Date;
  html_sha256: string | null;
  screenshot_sha256: string | null;
  error: string | null;
  url: string;
}

// Older rows may hold multi-line errors with ANSI colour codes (Playwright call logs).
function oneLine(s: string): string {
  return s
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\n\s*Call log:/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const { run, rows } = await withSystem(async (db) => {
    const runQ = await db.query<{ id: string; started_at: Date; finished_at: Date | null; egress_label: string; stats: Record<string, number>; jobs_total: number; jobs_done: number }>(
      values.run ? 'SELECT * FROM crawl_run WHERE id = $1' : 'SELECT * FROM crawl_run ORDER BY started_at DESC LIMIT 1',
      values.run ? [values.run] : [],
    );
    const r = runQ.rows[0];
    if (!r) throw new Error('no crawl run found');
    const q = await db.query<Row>(
      `SELECT a.brand, p.product_code, p.model_number, s.code AS source, o.status, o.advertised_price, o.list_price,
              o.availability, o.seller_name_raw, o.fetch_method, o.model_match, o.observed_at,
              e.html_sha256, e.screenshot_sha256, o.error, l.url
         FROM observation o
         JOIN listing l ON l.id = o.listing_id
         JOIN source s ON s.id = l.source_id
         JOIN product p ON p.id = l.product_id
         JOIN account a ON a.id = p.account_id
         LEFT JOIN evidence e ON e.observation_id = o.id AND e.observed_at = o.observed_at
        WHERE o.crawl_run_id = $1
        ORDER BY a.brand, p.product_code, s.code`,
      [r.id],
    );
    return { run: r, rows: q.rows };
  });

  const bySource = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = bySource.get(r.source) ?? {};
    m[r.status] = (m[r.status] ?? 0) + 1;
    m.total = (m.total ?? 0) + 1;
    if (r.html_sha256) m.with_evidence = (m.with_evidence ?? 0) + 1;
    bySource.set(r.source, m);
  }

  const md: string[] = [
    `# Collector proof of concept — crawl run ${run.id}`,
    '',
    `Started ${run.started_at.toISOString()} · finished ${run.finished_at?.toISOString() ?? '(running)'} · egress: ${run.egress_label} · jobs ${run.jobs_done}/${run.jobs_total}`,
    '',
    '## By source',
    '',
    '| Source | Total | ok | partial | blocked | failed | not_found | skipped_robots | With evidence |',
    '|---|---|---|---|---|---|---|---|---|',
    ...[...bySource.entries()].map(
      ([s, m]) =>
        `| ${s} | ${m.total ?? 0} | ${m.ok ?? 0} | ${m.partial ?? 0} | ${m.blocked ?? 0} | ${m.failed ?? 0} | ${m.not_found ?? 0} | ${m.skipped_robots ?? 0} | ${m.with_evidence ?? 0} |`,
    ),
    '',
    '## Observations',
    '',
    '| Brand | SKU | Model | Source | Status | Price | Availability | Seller | Method | Model on page | HTML SHA-256 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.brand} | ${r.product_code} | ${r.model_number} | ${r.source} | ${r.status} | ${r.advertised_price !== null ? `$${r.advertised_price.toFixed(2)}` : '—'} | ${r.availability ?? '—'} | ${(r.seller_name_raw ?? '—').replace(/\|/g, '/')} | ${r.fetch_method ?? '—'} | ${r.model_match === null ? '—' : r.model_match ? 'yes' : 'no'} | ${r.html_sha256 ? `\`${r.html_sha256.slice(0, 12)}…\`` : '—'} |`,
    ),
    '',
    '## Problems',
    '',
    ...rows
      .filter((r) => r.status !== 'ok' && r.error)
      .map((r) => `- **${r.product_code} · ${r.source}** (${r.status}): ${oneLine(r.error!)}`),
    '',
  ];

  const header = Object.keys(rows[0] ?? { brand: '' }) as (keyof Row)[];
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n');

  await mkdir(outDir, { recursive: true });
  const stamp = run.started_at.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  await writeFile(path.join(outDir, `poc-${stamp}.md`), md.join('\n'));
  await writeFile(path.join(outDir, `poc-${stamp}.csv`), csv);
  console.log(md.slice(0, 12 + bySource.size).join('\n'));
  console.log(`\nwritten: server/reports/poc-${stamp}.md and .csv`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
