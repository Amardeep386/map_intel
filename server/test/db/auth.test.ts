// Sign-in and the shared (Redis) brake on password guessing.   npm run test:db
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, test } from 'node:test';
import { closeDb } from '../../src/lib/db.js';
import { closeQueue } from '../../src/lib/queue.js';
import { reset } from '../../src/lib/rateLimit.js';
import { call, createUser, removeTestUsers, testApp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let user: TestUser;
const key = () => `login:127.0.0.1:${user.email}`;

before(async () => {
  user = await createUser('login', 'admin');
  app = await testApp();
  await reset(key());
});

after(async () => {
  await reset(key());
  await app.close();
  await removeTestUsers();
  await closeQueue();
  await closeDb();
});

test('right password signs in; wrong password is 401', async () => {
  const ok = await call(app, null, 'POST', '/auth/login', { email: user.email, password: 'not-a-real-password-123' });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().token);
  const bad = await call(app, null, 'POST', '/auth/login', { email: user.email, password: 'wrong' });
  assert.equal(bad.statusCode, 401);
});

test('after 5 wrong passwords the next attempt is refused with 429, even with the right password', async () => {
  await reset(key());
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(app, null, 'POST', '/auth/login', { email: user.email, password: `wrong-${i}` })).statusCode, 401);
  }
  const blocked = await call(app, null, 'POST', '/auth/login', { email: user.email, password: 'not-a-real-password-123' });
  assert.equal(blocked.statusCode, 429);
});
