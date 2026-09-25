// Password hashing: new hashes use the current work factor; older ones are flagged for rewrite.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { hashPassword, needsRehash, verifyPassword } from '../src/lib/auth.js';

test('new hashes verify and need no rehash', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(needsRehash(hash), false);
});

test('cost-12 hashes are flagged for rewrite; junk is not', async () => {
  assert.equal(needsRehash(await bcrypt.hash('correct horse battery', 12)), true);
  assert.equal(needsRehash('not-a-bcrypt-hash'), false);
});
