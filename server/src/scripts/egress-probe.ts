// npm run egress:probe [-- --per 3 --json]
// Checks from this machine's IP whether each retailer serves real pages (HTTP only, stores nothing).
import { parseArgs } from 'node:util';
import { probeListingUrls, runEgressProbe, summarizeProbe } from '../collector/egressProbe.js';
import { closePoliteness } from '../collector/http.js';
import { closeDb, withSystem } from '../lib/db.js';

const { values } = parseArgs({ options: { per: { type: 'string', default: '3' }, json: { type: 'boolean', default: false } } });

async function main(): Promise<void> {
  const per = Math.min(Math.max(Number.parseInt(values.per ?? '3', 10) || 3, 1), 5);
  try {
    const urls = await withSystem((db) => probeListingUrls(db, per));
    const report = await runEgressProbe(urls, per);
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`egress ${report.egressLabel} (${report.egressIp ?? 'IP unknown'}) at ${report.at}`);
    for (const line of summarizeProbe(report)) console.log(`  ${line}`);
    for (const r of report.results)
      console.log(`    ${r.source} ${r.status ?? '-'} ${r.block ?? ''} ${r.price ?? ''} ${r.ms ?? '-'}ms ${r.error ?? ''} ${r.url}`);
  } finally {
    await closePoliteness();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
