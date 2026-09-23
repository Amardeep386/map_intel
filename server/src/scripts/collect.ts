// Run the collector.
//   npm run collect                         -> queue every pilot listing for the worker (needs Redis + worker)
//   npm run collect -- --inline             -> run here, without Redis/worker, and print results
//   npm run collect -- --inline --account lg --source bestbuy_us --limit 3
import { parseArgs } from 'node:util';
import { closeBrowser } from '../collector/browser.js';
import { collectListing, type CollectOutcome } from '../collector/collect.js';
import { createCrawlRun, enqueueRun, selectListings, type RunScope } from '../collector/runs.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';

const { values } = parseArgs({
  options: {
    inline: { type: 'boolean', default: false },
    account: { type: 'string' },
    source: { type: 'string' },
    product: { type: 'string' },
    limit: { type: 'string' },
  },
});

const scope: RunScope = {
  account: values.account,
  source: values.source,
  product: values.product,
  limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
};

async function runInline(): Promise<void> {
  const ids = await selectListings(scope);
  const crawlRunId = await createCrawlRun(scope, ids.length);
  console.log(`crawl run ${crawlRunId}: ${ids.length} listings (inline)`);

  // Group by source so each retailer is visited one page at a time, sources in parallel.
  const bySource = await withSystem(async (db) => {
    const { rows } = await db.query<{ id: string; code: string }>(
      `SELECT l.id, s.code FROM listing l JOIN source s ON s.id = l.source_id WHERE l.id = ANY($1::uuid[])`,
      [ids],
    );
    const m = new Map<string, string[]>();
    for (const id of ids) {
      const code = rows.find((r) => r.id === id)!.code;
      m.set(code, [...(m.get(code) ?? []), id]);
    }
    return m;
  });

  const results: CollectOutcome[] = [];
  await Promise.all(
    [...bySource.values()].map(async (list) => {
      for (const id of list) {
        try {
          const r = await collectListing(id, crawlRunId);
          results.push(r);
          console.log(
            `${(r.productCode ?? '').padEnd(8)} ${r.source.padEnd(11)} ${r.status.padEnd(14)} ` +
              `${r.price !== null ? `$${r.price.toFixed(2)}`.padStart(10) : '         -'}  ${(r.availability ?? '').padEnd(12)} ${r.seller ?? ''}` +
              (r.status !== 'ok' && r.error ? `\n         ↳ ${r.error.slice(0, 220)}` : ''),
          );
        } catch (err) {
          console.error(`listing ${id} crashed:`, err);
        }
      }
    }),
  );

  const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  console.log(`\ndone. ${JSON.stringify(counts)}  ->  npm run collect:report -- --run ${crawlRunId}`);
}

async function main(): Promise<void> {
  try {
    if (values.inline) {
      await runInline();
    } else {
      const { crawlRunId, jobs } = await enqueueRun(scope);
      console.log(`queued crawl run ${crawlRunId} with ${jobs} jobs; the worker will process them`);
      await closeQueue();
    }
  } finally {
    await closeBrowser();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
