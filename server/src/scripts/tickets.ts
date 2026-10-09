// Internal tickets (Phase 5 · M4): open a ticket for each operational issue found (a source failing
// or blocked for an account, a Mapping Center backlog) and resolve automatic tickets whose issue is
// gone. Deduplicated: running it again opens nothing new. Hourly in the Reports workflow.
//   npm run tickets
import { closeDb, withSystem } from '../lib/db.js';
import { syncTickets } from '../lib/tickets.js';

async function main(): Promise<void> {
  const r = await withSystem((db) => syncTickets(db));
  console.log(`tickets opened ${r.opened.length} ${r.opened.join(' ')}  resolved ${r.resolved.length} ${r.resolved.join(' ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
