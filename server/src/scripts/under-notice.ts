// How many of an account's Included listings are under notice (Phase 4). The 6-hourly re-check on
// GitHub Actions asks first, so it skips the browser install and the run when there is nothing to do.
//   npm run under-notice -- --account lg        prints the count; writes count=N to $GITHUB_OUTPUT when set
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { closeDb, withSystem } from '../lib/db.js';

const { values } = parseArgs({ options: { account: { type: 'string' } } });

async function main(): Promise<void> {
  if (!values.account) throw new Error('usage: --account <slug>');
  const n = await withSystem(async (db) =>
    (await db.query<{ n: number }>(
      `SELECT count(DISTINCT m.listing_id)::int AS n
         FROM account a JOIN listing_match m ON m.account_id = a.id AND m.state = 'Included'
         JOIN violation_current v ON v.account_id = a.id AND v.listing_id = m.listing_id AND NOT v.episode_closed AND v.status = 'Under notice'
        WHERE a.slug = $1`,
      [values.account],
    )).rows[0].n,
  );
  console.log(`${values.account}: ${n} listing${n === 1 ? '' : 's'} under notice`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${n}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
