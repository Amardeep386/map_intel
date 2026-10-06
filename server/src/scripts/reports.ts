// The reports runner (Phase 3). Hourly on GitHub Actions (.github/workflows/reports.yml) until the
// Render worker runs; by hand for development and the exit test.
//   npm run reports -- --due --pending                       queue due schedules, then finish every pending run
//   npm run reports -- --account lg --template listing_map [--params '{"timeframe":"last_7_days"}'] [--name "..."]
//                                                            one ad-hoc run now (generated, printed, delivered)
import { parseArgs } from 'node:util';
import { closeBrowser, renderPdf } from '../collector/browser.js';
import { closeDb, withSystem } from '../lib/db.js';
import '../lib/sftp.js'; // registers SFTP delivery with the runner
import { completeRun, failRun, generateRun, queueDueRuns, queueRun, runCode, runHtml } from '../lib/reportRunner.js';

const { values } = parseArgs({
  options: {
    due: { type: 'boolean', default: false },
    pending: { type: 'boolean', default: false },
    account: { type: 'string' },
    template: { type: 'string' },
    params: { type: 'string' },
    name: { type: 'string' },
  },
});

/** Generate, print and deliver one run. Each step commits on its own; a failure marks the run failed. */
async function finishRun(runId: string): Promise<void> {
  try {
    const status = await withSystem(async (db) => (await db.query<{ status: string }>('SELECT status FROM report_run WHERE id = $1', [runId])).rows[0].status);
    if (status === 'queued') await withSystem((db) => generateRun(db, runId));
    const html = await withSystem((db) => runHtml(db, runId));
    const pdf = await renderPdf(html);
    const r = await withSystem((db) => completeRun(db, runId, pdf));
    console.log(`  ${runId} done: ${r.deliveries.map((d) => `${d.channel} ${d.status}`).join(', ') || 'no deliveries'}`);
  } catch (err) {
    console.error(`  ${runId} failed:`, err);
    await withSystem((db) => failRun(db, runId, String((err as Error).stack ?? err)));
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (values.account || values.template) {
    if (!values.account || !values.template) throw new Error('an ad-hoc run needs --account <slug> and --template <code>');
    const q = await withSystem(async (db) => {
      const a = (await db.query<{ id: string }>('SELECT id FROM account WHERE slug = $1', [values.account])).rows[0];
      if (!a) throw new Error(`no account ${values.account}`);
      return queueRun(db, { accountId: a.id, templateCode: values.template!, params: values.params ? JSON.parse(values.params) : {}, name: values.name, trigger: 'manual' });
    });
    console.log(`queued ${q.code} (${q.id})`);
    await finishRun(q.id);
    return;
  }
  if (!values.due && !values.pending) throw new Error('usage: --due --pending | --account <slug> --template <code> [--params <json>]');
  if (values.due) {
    const fired = await withSystem((db) => queueDueRuns(db));
    console.log(`due schedules: ${fired.length}${fired.length ? ` (${fired.map((f) => f.code).join(', ')})` : ''}`);
  }
  if (values.pending) {
    const runs = await withSystem(async (db) =>
      (await db.query<{ id: string; seq: number; status: string }>("SELECT id, seq, status FROM report_run WHERE status IN ('queued', 'awaiting_pdf') ORDER BY created_at LIMIT 50")).rows,
    );
    console.log(`pending runs: ${runs.length}`);
    for (const r of runs) {
      console.log(`${runCode(r.seq)} (${r.status})`);
      await finishRun(r.id);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
