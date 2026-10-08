// Draw this week's QA sample of automatic Mapping Center decisions (Phase 4 · M7). Once per account
// per week: running it again the same week adds nothing. Runs hourly with the reports job.
//   npm run qa-sample -- --all            every account
//   npm run qa-sample -- --account lg
import { parseArgs } from 'node:util';
import { closeDb, withSystem } from '../lib/db.js';
import { drawSample } from '../lib/qa.js';

const { values } = parseArgs({ options: { account: { type: 'string' }, all: { type: 'boolean', default: false } } });

async function main(): Promise<void> {
  if (!values.account && !values.all) throw new Error('usage: --account <slug> | --all');
  const accounts = await withSystem(async (db) =>
    (await db.query<{ id: string; slug: string }>('SELECT id, slug FROM account WHERE ($1::text IS NULL OR slug = $1) ORDER BY slug', [values.all ? null : values.account])).rows);
  for (const a of accounts) {
    const r = await withSystem((db) => drawSample(db, a.id));
    console.log(`${a.slug.padEnd(10)} week of ${r.week}: ${r.drawn ? `${r.included} includes, ${r.excluded} excludes drawn` : 'nothing new to draw'}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
