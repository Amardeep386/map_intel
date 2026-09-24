// Credential vault routes: secrets are stored encrypted and never come back out.   npm run test:db
// Uses the real VAULT_KEYS / VAULT_ACTIVE_KEY from server/.env.
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb, withSystem } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { decrypt } from '../../src/lib/vault.js';
import { call, createTestAccount, createUser, removeTestAccounts, removeTestUsers, testApp, type TestUser } from './helpers.js';

const SECRET = 'correct-horse-battery-staple-9431';
const ROTATED = 'rotated-secret-value-7788';

let app: FastifyInstance;
let acct: string;
let credId: string;
const u: Record<string, TestUser> = {};
const bodies: string[] = [];

before(async () => {
  acct = await createTestAccount('vault');
  u.manager = await createUser('vault-manager', 'Account manager', acct);
  u.analyst = await createUser('vault-analyst', 'Analyst', acct);
  u.brand = await createUser('vault-brand', 'Brand user', acct);
  app = await testApp();
});

after(async () => {
  await app.close();
  await removeTestUsers();
  await removeTestAccounts();
  await closeQueue();
  await closeDb();
});

test('creating a credential returns metadata and a hint, not the secret', async () => {
  const res = await call(app, u.manager, 'POST', `/accounts/${acct}/credentials`, {
    kind: 'sftp',
    label: 'Brand SFTP',
    username: 'mirethos',
    secret: SECRET,
  });
  bodies.push(res.body);
  assert.equal(res.statusCode, 201);
  const meta = res.json();
  credId = meta.id;
  assert.equal(meta.hint, '…9431');
  assert.equal(meta.secret, undefined);
});

test('the database holds ciphertext that decrypts back to the secret', async () => {
  const row = await withSystem(async (db) => (await db.query('SELECT * FROM credential WHERE id = $1', [credId])).rows[0]);
  assert.ok(!Buffer.from(row.ciphertext).toString('utf8').includes('horse'));
  const plain = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyId: row.key_id }, { accountId: acct, kind: 'sftp' });
  assert.equal(plain, SECRET);
});

test('duplicate labels are refused', async () => {
  const res = await call(app, u.manager, 'POST', `/accounts/${acct}/credentials`, { kind: 'sftp', label: 'brand sftp', secret: 'x' });
  assert.equal(res.statusCode, 409);
});

test('Analysts see metadata but cannot add or rotate; Brand users see nothing', async () => {
  const list = await call(app, u.analyst, 'GET', `/accounts/${acct}/credentials`);
  bodies.push(list.body);
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);
  assert.equal((await call(app, u.analyst, 'POST', `/accounts/${acct}/credentials`, {})).statusCode, 403);
  assert.equal((await call(app, u.analyst, 'PUT', `/accounts/${acct}/credentials/${credId}/secret`, { secret: 'x' })).statusCode, 403);
  assert.equal((await call(app, u.brand, 'GET', `/accounts/${acct}/credentials`)).statusCode, 403);
});

test('rotating replaces the secret and is audited without the value', async () => {
  const res = await call(app, u.manager, 'PUT', `/accounts/${acct}/credentials/${credId}/secret`, { secret: ROTATED });
  bodies.push(res.body);
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().rotatedAt);
  const audit = await call(app, u.manager, 'GET', `/accounts/${acct}/audit?entity=credential`);
  bodies.push(audit.body);
  const actions = audit.json().events.map((e: { action: string }) => e.action);
  assert.deepEqual(actions.sort(), ['credential.created', 'credential.rotated']);
});

test('no response and no audit row ever contained a secret', async () => {
  for (const body of bodies) {
    assert.ok(!body.includes(SECRET) && !body.includes(ROTATED));
  }
  const audit = await withSystem(async (db) =>
    JSON.stringify((await db.query('SELECT * FROM audit_event WHERE account_id = $1', [acct])).rows),
  );
  assert.ok(!audit.includes(SECRET) && !audit.includes(ROTATED));
});

test('deleting a credential removes it', async () => {
  assert.equal((await call(app, u.manager, 'DELETE', `/accounts/${acct}/credentials/${credId}`)).statusCode, 204);
  assert.equal((await call(app, u.manager, 'GET', `/accounts/${acct}/credentials`)).json().length, 0);
});
