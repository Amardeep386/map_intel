// npm run egress:probe [-- --per 3 --json] [--browser] [--sources amazon_us,walmart_us] [--out reports/x.json]
// Checks from this machine's IP whether each retailer serves real pages (stores nothing). --browser
// also reads browser-first sources (Amazon) through headless Chromium, as the collector does.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { probeListingUrls, runEgressProbe, summarizeProbe } from '../collector/egressProbe.js';
import { closeBrowser } from '../collector/browser.js';
import { closePoliteness } from '../collector/http.js';
import { closeDb, withSystem } from '../lib/db.js';

const { values } = parseArgs({
  options: {
    per: { type: 'string', default: '3' },
    json: { type: 'boolean', default: false },
    browser: { type: 'boolean', default: false },
    sources: { type: 'string' },
    out: { type: 'string' },
  },
});

async function main(): Promise<void> {
  const per = Math.min(Math.max(Number.parseInt(values.per ?? '3', 10) || 3, 1), 5);
  try {
    const urls = await withSystem((db) => probeListingUrls(db, per));
    const report = await runEgressProbe(urls, per, { browser: values.browser, sources: values.sources?.split(',').map((s) => s.trim()).filter(Boolean) });
    if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2));
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`egress ${report.egressLabel} (${report.egressIp ?? 'IP unknown'}) at ${report.at}`);
    for (const line of summarizeProbe(report)) console.log(`  ${line}`);
    for (const r of report.results)
      console.log(`    ${r.source} ${r.method ?? 'http'} ${r.status ?? '-'} ${r.block ?? ''} ${r.price ?? ''}${r.items != null ? ` ${r.items} items` : ''} ${r.ms ?? '-'}ms ${r.error ?? ''} ${r.url}`);
  } finally {
    await closeBrowser();
    await closePoliteness();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
