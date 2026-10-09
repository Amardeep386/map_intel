// Internal tickets through the API, and the automatic sync.   npm run test:db
// The sync test runs inside a transaction that is rolled back, so it never opens real tickets in
// the shared database.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, pool, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { BACKLOG_MIN, syncTickets } from '../../src/lib/tickets.js';
import { asTenant, call, createTestAccount, createUser, expectRefused, removeTestAccounts, removeTestUsers, rolledBack, testApp, type TestUser } from './helpers.js';

const TITLE = 'zz-ticket-test';
let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;

async function cleanup(): Promise<void> {
  await withSystem((db) => db.query('DELETE FROM ticket WHERE title LIKE $1', [`${TITLE}%`]));
}

before(async () => {
  await cleanup();
  acct = await createTestAccount('tickets');
  u.platform = await createUser('tk-platform', 'admin');
  u.platform2 = await createUser('tk-platform2', 'admin');
  u.admin = await createUser('tk-admin', 'Administrator', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await cleanup();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('platform administrators open, assign and work tickets; account users cannot see them', async () => {
  const body = { title: `${TITLE} Walmart prices look stale`, kind: 'data_quality', accountId: acct, description: 'Seen on the Overview.' };
  assert.equal((await call(app, u.admin, 'POST', '/platform/tickets', body)).statusCode, 403);
  assert.equal((await call(app, u.admin, 'GET', '/platform/tickets')).statusCode, 403);
  assert.equal((await call(app, u.platform, 'POST', '/platform/tickets', { ...body, kind: 'nope' })).statusCode, 400);
  assert.equal((await call(app, u.platform, 'POST', '/platform/tickets', { ...body, assigneeId: u.admin.id })).statusCode, 400); // not a platform admin

  const res = await call(app, u.platform, 'POST', '/platform/tickets', { ...body, priority: 'High', assigneeId: u.platform2.id });
  assert.equal(res.statusCode, 201, res.body);
  const t = res.json();
  assert.match(t.code, /^T-\d{5}$/);
  assert.equal(t.status, 'Open');
  assert.equal(t.account, 'Test tickets');
  assert.equal(t.assignee, 'Test tk-platform2');
  assert.deepEqual(t.events.map((e: { kind: string }) => e.kind), ['opened']);

  const p = await call(app, u.platform2, 'PATCH', `/platform/tickets/${t.id}`, { status: 'In progress', note: 'Looking at the run.' });
  assert.equal(p.json().status, 'In progress');
  const r = (await call(app, u.platform2, 'PATCH', `/platform/tickets/${t.id}`, { status: 'Resolved', assigneeId: null })).json();
  assert.equal(r.status, 'Resolved');
  assert.ok(r.resolved_at);
  assert.equal(r.assignee, null);
  assert.deepEqual(r.events.map((e: { kind: string }) => e.kind), ['opened', 'status', 'comment', 'status', 'assignee']);
  const reopened = (await call(app, u.platform, 'PATCH', `/platform/tickets/${t.id}`, { status: 'Open' })).json();
  assert.equal(reopened.resolved_at, null);

  const active = (await call(app, u.platform, 'GET', `/platform/tickets?status=active&accountId=${acct}`)).json();
  assert.deepEqual(active.tickets.map((x: { id: string }) => x.id), [t.id]);
  const mine = (await call(app, u.platform2, 'GET', `/platform/tickets?assignee=me&accountId=${acct}`)).json();
  assert.equal(mine.tickets.length, 0);

  const audit = await withSystem(async (db) => (await db.query("SELECT action FROM audit_event WHERE entity_id = $1 ORDER BY occurred_at", [t.id])).rows.map((x) => x.action));
  assert.deepEqual(audit, ['ticket.opened', 'ticket.updated', 'ticket.updated', 'ticket.updated']);

  // History is append-only; the tenant role has no access to tickets at all.
  await rolledBack(async (db) => {
    await expectRefused(db, 'UPDATE ticket_event SET body = $2 WHERE ticket_id = $1', [t.id, 'changed']);
    await expectRefused(db, 'DELETE FROM ticket WHERE id = $1', [t.id]);
    await asTenant(db, acct);
    await expectRefused(db, 'SELECT * FROM ticket');
  });
});

test('the sync opens one ticket per failing source and per backlog, never twice, and resolves them when healed', async () => {
  const db = await pool().connect();
  try {
    await db.query("BEGIN; SELECT set_config('app.role', 'system', true)");
    await db.query("UPDATE account SET status = 'Active' WHERE id = $1", [acct]);
    const source = (await db.query<{ id: string }>("SELECT id FROM source WHERE code = 'walmart_us'")).rows[0].id;
    await db.query('INSERT INTO account_source (account_id, source_id) VALUES ($1, $2)', [acct, source]);
    const run = async () => (await db.query<{ id: string }>("INSERT INTO crawl_run (trigger, account_id, status) VALUES ('manual', $1, 'finished') RETURNING id", [acct])).rows[0].id;
    const snapshot = async (health: string) =>
      db.query("INSERT INTO source_health_snapshot (account_id, source_id, crawl_run_id, health, main_failure, created_at) VALUES ($1, $2, $3, $4, 'blocked', clock_timestamp())",
        [acct, source, await run(), health]);
    await snapshot('Blocked');
    const product = (await db.query<{ id: string }>("INSERT INTO product (account_id, product_code, name, brand) VALUES ($1, 'TK-1', 'Ticket widget', 'TestBrand') RETURNING id", [acct])).rows[0].id;
    for (let i = 0; i < BACKLOG_MIN; i++) {
      const l = (await db.query<{ id: string }>('INSERT INTO listing (source_id, url) VALUES ($1, $2) RETURNING id', [source, `https://example.invalid/tk-${Date.now()}-${i}`])).rows[0].id;
      await db.query("INSERT INTO listing_match (account_id, listing_id, product_id, state, decided_by, state_since) VALUES ($1, $2, $3, 'Staged', 'auto', now() - interval '5 days')", [acct, l, product]);
    }

    const mineOpen = async () => (await db.query<{ kind: string; priority: string; status: string }>(
      "SELECT kind, priority, status FROM ticket WHERE account_id = $1 AND origin = 'auto' ORDER BY kind", [acct])).rows;
    await syncTickets(db);
    assert.deepEqual(await mineOpen(), [
      { kind: 'mapping', priority: 'Normal', status: 'Open' },
      { kind: 'source', priority: 'High', status: 'Open' },
    ]);
    await syncTickets(db);
    assert.equal((await mineOpen()).length, 2); // deduplicated

    await snapshot('Healthy');
    await db.query("UPDATE listing_match SET state = 'Included' WHERE account_id = $1", [acct]);
    await syncTickets(db);
    assert.deepEqual((await mineOpen()).map((t) => t.status), ['Resolved', 'Resolved']);
    const notes = (await db.query("SELECT e.kind FROM ticket_event e JOIN ticket t ON t.id = e.ticket_id WHERE t.account_id = $1 AND e.kind = 'auto'", [acct])).rowCount;
    assert.equal(notes, 2);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
});
