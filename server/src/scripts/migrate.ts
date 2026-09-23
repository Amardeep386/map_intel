// Applies db/migrations/*.sql in name order, once each, and keeps monthly
// observation partitions created a year ahead.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, pool } from '../lib/db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      console.log(`applying ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    await client.query("SELECT ensure_observation_partitions(date_trunc('month', now())::date, 13)");
    console.log('migrations up to date');
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
