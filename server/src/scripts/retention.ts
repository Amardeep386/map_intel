// Retention (Phase 5 · M6): delete evidence files, observations and audit events past each
// account's retention, never anything behind an open violation or an unresolved case. Dry run by
// default (counts only); --apply deletes. --daily skips if an applied run finished in the last 20 h
// (the hourly Reports workflow calls it with --apply --daily). Every run is logged in retention_run.
//   npm run retention                 # dry run
//   npm run retention -- --apply
import { parseArgs } from 'node:util';
import { closeDb, withSystem } from '../lib/db.js';
import { runRetention } from '../lib/retention.js';
import { deleteObjectForGood } from '../lib/storage.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, daily: { type: 'boolean', default: false } } });

async function main(): Promise<void> {
  if (values.daily) {
    const recent = await withSystem(async (db) =>
      (await db.query("SELECT 1 FROM retention_run WHERE applied AND error IS NULL AND finished_at > now() - interval '20 hours'")).rowCount);
    if (recent) {
      console.log('retention already ran in the last 20 hours');
      return;
    }
  }
  const runId = await withSystem(async (db) => (await db.query<{ id: string }>('INSERT INTO retention_run (applied) VALUES ($1) RETURNING id', [values.apply])).rows[0].id);
  try {
    const counts = await withSystem((db) => runRetention(db, { apply: values.apply, deleteFile: deleteObjectForGood }));
    await withSystem((db) => db.query('UPDATE retention_run SET finished_at = now(), counts = $2 WHERE id = $1', [runId, JSON.stringify(counts)]));
    console.log(`${values.apply ? 'deleted' : 'would delete (dry run)'}: ${JSON.stringify(counts)}`);
  } catch (err) {
    await withSystem((db) => db.query('UPDATE retention_run SET finished_at = now(), error = $2 WHERE id = $1', [runId, (err as Error).message.slice(0, 500)]));
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
