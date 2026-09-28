// The scheduler by hand (development, exit tests, operations):
//   npm run scheduler -- --tick                                  fire every due schedule (queue for the worker)
//   npm run scheduler -- --fire "Daily sweep" --account lg       fire one schedule now (queue for the worker)
//   npm run scheduler -- --fire "Daily sweep" --account lg --inline [--limit 5] [--source walmart_us]
//                                                                ... and run its jobs in this process
//   npm run scheduler -- --run <crawlRunId> --inline [--limit 5] run queued jobs of a run in this process
//   npm run scheduler -- --cancel <crawlRunId>                   cancel what is still queued; the run finishes
import { parseArgs } from 'node:util';
import { closeBrowser } from '../collector/browser.js';
import { closePoliteness } from '../collector/http.js';
import { RetryLater, finalizeRun, runCrawlJob } from '../collector/jobs.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';
import { fireSchedule, inlineRuns, schedulerTick } from '../scheduler/tick.js';

const { values } = parseArgs({
  options: {
    tick: { type: 'boolean', default: false },
    fire: { type: 'string' },
    account: { type: 'string' },
    run: { type: 'string' },
    cancel: { type: 'string' },
    inline: { type: 'boolean', default: false },
    limit: { type: 'string' },
    source: { type: 'string' },
  },
});

async function runInline(runId: string, limit: number, source?: string): Promise<void> {
  inlineRuns.add(runId);
  for (let n = 0; n < limit; n++) {
    const next = await withSystem(
      async (db) =>
        (
          await db.query<{ id: string; kind: string; code: string }>(
            `SELECT j.id, j.kind, s.code FROM crawl_job j JOIN source s ON s.id = j.source_id
              WHERE j.crawl_run_id = $1 AND j.status = 'queued' AND ($2::text IS NULL OR s.code = $2)
              ORDER BY (j.kind = 'recheck') DESC, (j.kind = 'collect') DESC, j.queued_at LIMIT 1`,
            [runId, source ?? null],
          )
        ).rows[0],
    );
    if (!next) break;
    let attempt = 1;
    for (;;) {
      try {
        const r = await runCrawlJob(next.id, attempt, 2);
        const found = r.found !== null ? ` found ${r.found}` : '';
        const why = r.error ? `  -> ${r.error.slice(0, 160)}` : '';
        console.log(`${next.code.padEnd(13)} ${next.kind.padEnd(8)} ${r.status}${r.failureClass ? ` (${r.failureClass})` : ''}${found}${why}`);
        break;
      } catch (err) {
        if (!(err instanceof RetryLater) || attempt >= 2) throw err;
        console.log(`${next.code.padEnd(13)} ${next.kind.padEnd(8)} retry with the browser: ${err.message.slice(0, 120)}`);
        attempt += 1;
      }
    }
  }
  const left = await withSystem(
    async (db) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM crawl_job WHERE crawl_run_id = $1 AND status = 'queued'`, [runId])).rows[0].n,
  );
  console.log(`\nrun ${runId}: ${left} jobs still queued${left ? `  (continue: --run ${runId} --inline, or --cancel ${runId})` : ' (finished)'}`);
}

async function cancelRun(runId: string): Promise<void> {
  const finished = await withSystem(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE crawl_job SET status = 'skipped', skip_reason = 'cancelled', finished_at = now() WHERE crawl_run_id = $1 AND status = 'queued'`,
      [runId],
    );
    const { rows } = await db.query<{ done: boolean }>(
      `UPDATE crawl_run SET jobs_total = jobs_total - $2,
              status = CASE WHEN jobs_done >= jobs_total - $2 THEN 'finished' ELSE status END,
              finished_at = CASE WHEN jobs_done >= jobs_total - $2 THEN now() ELSE finished_at END
        WHERE id = $1 RETURNING jobs_done >= jobs_total AS done`,
      [runId, rowCount ?? 0],
    );
    console.log(`cancelled ${rowCount} jobs`);
    return rows[0]?.done ?? false;
  });
  if (finished) await finalizeRun(runId);
}

async function main(): Promise<void> {
  const limit = values.limit ? Number.parseInt(values.limit, 10) : 10_000;
  if (values.tick) {
    for (const r of await schedulerTick()) console.log(`${r.schedule}: run ${r.crawlRunId} (${r.queued} queued, skipped ${JSON.stringify(r.skipped)})`);
  } else if (values.fire) {
    if (!values.account) throw new Error('--fire needs --account <slug>');
    const scheduleId = await withSystem(
      async (db) =>
        (
          await db.query<{ id: string }>('SELECT s.id FROM schedule s JOIN account a ON a.id = s.account_id WHERE a.slug = $1 AND lower(s.name) = lower($2)', [
            values.account,
            values.fire,
          ])
        ).rows[0]?.id,
    );
    if (!scheduleId) throw new Error(`no schedule "${values.fire}" for account ${values.account}`);
    const r = await fireSchedule(scheduleId, new Date(), 'manual', { enqueue: !values.inline });
    if (!r) throw new Error('that slot already has a run');
    console.log(`run ${r.crawlRunId}: ${r.queued} jobs queued, skipped ${JSON.stringify(r.skipped)}`);
    if (values.inline) await runInline(r.crawlRunId, limit, values.source);
  } else if (values.run && values.inline) {
    await runInline(values.run, limit, values.source);
  } else if (values.cancel) {
    await cancelRun(values.cancel);
  } else {
    console.log('usage: --tick | --fire <schedule> --account <slug> [--inline] | --run <id> --inline | --cancel <id>');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
    await closeBrowser();
    await closePoliteness();
    await closeDb();
  });
