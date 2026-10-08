// Evaluate every alert rule for every account (Phase 4 · M8): enforcement alerts (notice waiting for
// approval, response overdue, re-offence, case resolved) come from the clock and from people's
// actions, not only from crawls, so the hourly reports job runs this too. Alerts are deduplicated:
// running it again raises nothing new.
//   npm run alerts -- --all | --account lg
import { parseArgs } from 'node:util';
import { evaluateAlerts } from '../lib/alerts.js';
import { closeDb, withSystem } from '../lib/db.js';

const { values } = parseArgs({ options: { account: { type: 'string' }, all: { type: 'boolean', default: false } } });

async function main(): Promise<void> {
  if (!values.account && !values.all) throw new Error('usage: --account <slug> | --all');
  const accounts = await withSystem(async (db) =>
    (await db.query<{ id: string; slug: string }>('SELECT id, slug FROM account WHERE ($1::text IS NULL OR slug = $1) ORDER BY slug', [values.all ? null : values.account])).rows);
  for (const a of accounts) {
    const r = await withSystem((db) => evaluateAlerts(db, a.id));
    console.log(`${a.slug.padEnd(10)} alerts raised ${r.raised} ${JSON.stringify(r.byRule)}  emails logged ${r.emailed}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
