// Audit chain verification and export, retention settings, and the platform governance view.
//   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
const u: Record<string, TestUser> = {};
let acct: string;
let base: string;

before(async () => {
  acct = await createTestAccount('audit-chain');
  base = `/accounts/${acct}`;
  u.platform = await createUser('ac-platform', 'admin');
  u.admin = await createUser('ac-admin', 'Administrator', acct);
  u.brand = await createUser('ac-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestAccounts();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('retention settings: defaults, limits, and audited changes extend the chain, which verifies', async () => {
  const s = (await call(app, u.admin, 'GET', `${base}/settings`)).json();
  assert.deepEqual([s.settings.retentionObservationDays, s.settings.retentionEvidenceDays, s.settings.retentionAuditDays], [730, 365, 2555]);
  assert.equal((await call(app, u.admin, 'PATCH', `${base}/settings`, { settings: { retentionObservationDays: 30 } })).statusCode, 400);
  const longer = await call(app, u.admin, 'PATCH', `${base}/settings`, { settings: { retentionObservationDays: 400, retentionEvidenceDays: 500 } });
  assert.equal(longer.statusCode, 400);
  assert.match(longer.json().error, /no longer than observations/);
  const ok = await call(app, u.admin, 'PATCH', `${base}/settings`, { settings: { retentionObservationDays: 1095, retentionAuditDays: 3650 } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().settings.retentionAuditDays, 3650);

  const v = (await call(app, u.admin, 'GET', `${base}/audit/verify`)).json();
  assert.equal(v.ok, true);
  assert.ok(v.checked >= 1);
  assert.equal(v.broken, null);
  assert.equal((await call(app, u.brand, 'GET', `${base}/audit/verify`)).statusCode, 403);
});

test('audit export: CSV oldest first with chain hashes; the export itself is audited', async () => {
  const res = await call(app, u.admin, 'GET', `${base}/audit/export`);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/csv/);
  assert.match(String(res.headers['content-disposition']), /audit-log-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = res.body.trim().split('\r\n');
  assert.equal(lines[0], 'seq,occurred_at,actor_type,actor,action,entity_type,entity_id,summary,before,after,request_id,prev_hash,hash');
  assert.ok(lines.length >= 2);
  const seqs = lines.slice(1).map((l) => Number(l.split(',')[0]));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  const after = (await call(app, u.admin, 'GET', `${base}/audit?limit=1`)).json();
  assert.equal(after.events[0].action, 'audit.exported');
  assert.equal((await call(app, u.brand, 'GET', `${base}/audit/export`)).statusCode, 403);
});

test('platform governance: every chain verified, retention runs listed; platform only', async () => {
  assert.equal((await call(app, u.admin, 'GET', '/platform/governance')).statusCode, 403);
  const g = (await call(app, u.platform, 'GET', '/platform/governance')).json();
  assert.equal(g.chains[0].name, 'Platform');
  const mine = g.chains.find((c: { accountId: string }) => c.accountId === acct);
  assert.equal(mine.ok, true);
  assert.ok(Array.isArray(g.retentionRuns));
});
