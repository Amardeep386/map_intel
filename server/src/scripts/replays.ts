// Replay at scale (Phase 5 · M5): finish replay runs the API did not (it restarted or went to sleep
// mid-run). Each run resumes from its cursor; a run another worker holds is left alone.
//   npm run replays
import { closeDb, withSystem } from '../lib/db.js';
import { pendingReplays, runReplay } from '../lib/replay.js';

async function main(): Promise<void> {
  const runs = await withSystem((db) => pendingReplays(db));
  for (const r of runs) console.log(`replay ${r.id}: ${await runReplay(r.id, withSystem)}`);
  if (!runs.length) console.log('no replay runs to resume');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
