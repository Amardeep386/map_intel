// Audit log: written with the change, readable per account by the right roles, append-only.
//   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { SYSTEM_ACTOR, recordAudit } from '../../src/lib/audit.js';
import { apiPool, closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import {
  accountIds,
  call,
  createTestAccount,
  createUser,
  removeTestAccounts,
  removeTestUsers,
  testApp,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let acct: string;
let ids: Record<string, string>;
const u: Record<string, TestUser> = {};

before(async () => {
  ids = await accountIds();
  acct = await createTestAccount('audit');
  u.manager = await createUser('audit-manager', 'Account manager', acct);
  u.analyst = await createUser('audit-analyst', 'Analyst', acct);
  u.brand = await createUser('audit-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestUsers();
  await removeTestAccounts();
  await closeQueue();
  await closeDb();
});

test('adding a SKU writes an audit event with the actor and the new values', async () => {
  const res = await call(app, u.manager, 'POST', `/accounts/${acct}/products`, { code: 'AUD-1', name: 'Audit test', model: 'AUD1' });
  assert.equal(res.statusCode, 201);
  const { events } = (await call(app, u.manager, 'GET', `/accounts/${acct}/audit?entity=product`)).json();
  const e = events.find((x: { action: string }) => x.action === 'product.created');
  assert.ok(e, 'product.created event missing');
  assert.equal(e.actor, u.manager.email);
  assert.equal(e.after.code, 'AUD-1');
  assert.equal(e.before, null);
});

test('Analysts read the audit log; Brand users cannot', async () => {
  assert.equal((await call(app, u.analyst, 'GET', `/accounts/${acct}/audit`)).statusCode, 200);
  assert.equal((await call(app, u.brand, 'GET', `/accounts/${acct}/audit`)).statusCode, 403);
  assert.equal((await call(app, u.manager, 'GET', `/accounts/${acct}/audit?limit=abc`)).statusCode, 400);
});

test("another account's tenant cannot see these events", async () => {
  const db = await apiPool().connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE mapintel_tenant');
    await db.query("SELECT set_config('app.account_id', $1, true)", [ids.lg]);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM audit_event WHERE account_id = $1', [acct]);
    assert.equal(rows[0].n, 0);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

test('audit events cannot be changed or deleted, not even by the owner', async () => {
  await assert.rejects(withSystem((db) => db.query('UPDATE audit_event SET summary = $2 WHERE account_id = $1', [acct, 'x'])), /append-only/);
  await assert.rejects(withSystem((db) => db.query('DELETE FROM audit_event WHERE account_id = $1', [acct])), /append-only/);
});

test('secret-looking fields are redacted before they are stored', async () => {
  await withSystem((db) =>
    recordAudit(db, {
      accountId: acct,
      actor: SYSTEM_ACTOR,
      action: 'test.redaction',
      entityType: 'test',
      after: { label: 'SFTP', password: 'hunter2', nested: { apiKey: 'abc', host: 'example' } },
    }),
  );
  const { events } = (await call(app, u.manager, 'GET', `/accounts/${acct}/audit?entity=test`)).json();
  const after_ = events[0].after;
  assert.equal(after_.password, '[redacted]');
  assert.equal(after_.nested.apiKey, '[redacted]');
  assert.equal(after_.nested.host, 'example');
});

test('the API role cannot delete accounts', async () => {
  await assert.rejects(apiPool().query('DELETE FROM account WHERE id = $1', [acct]), /permission denied/);
});
