// Judge observations into verdicts and violation episodes (Phase 3):
//   npm run judge -- --account lg                 judge everything not judged yet
//   npm run judge -- --account lg --since 2026-10-01
//   npm run judge -- --all                        every account
// Idempotent: a verdict is unique per (account, observation). Crawl runs judge by themselves when
// they finish (collector/jobs.ts finalizeRun).
import { parseArgs } from 'node:util';
import { closeDb, withSystem } from '../lib/db.js';
import { judgeAccount } from '../lib/judge.js';

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    all: { type: 'boolean', default: false },
    since: { type: 'string' },
    backfill: { type: 'boolean', default: false },
  },
});

async function main(): Promise<void> {
  if (!values.account && !values.all) throw new Error('usage: --account <slug> [--since YYYY-MM-DD] | --all');
  const since = values.since ? new Date(values.since) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new Error(`bad --since ${values.since}`);
  const accounts = await withSystem(async (db) =>
    (await db.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM account WHERE ($1::text IS NULL OR slug = $1) ORDER BY slug', [values.all ? null : values.account],
    )).rows,
  );
  if (!accounts.length) throw new Error(`no account ${values.account}`);
  for (const a of accounts) {
    const r = await withSystem((db) => judgeAccount(db, a.id, { trigger: values.backfill ? 'backfill' : 'cli', since }));
    console.log(`${a.slug.padEnd(10)} observations ${r.observations}  verdicts ${r.verdicts}  opened ${r.opened}  resolved ${r.resolved}  closed (no longer included) ${r.closedExcluded}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
