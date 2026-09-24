// Role -> action map (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_ACTIONS, actionsFor, can, grantableRoles } from '../src/lib/permissions.js';

test('Administrator and Account manager can do every account action', () => {
  for (const a of ACCOUNT_ACTIONS) {
    assert.ok(can('Administrator', a), a);
    assert.ok(can('Account manager', a), a);
  }
});

test('Analyst edits terms and catalogue, reads the rest, changes no configuration', () => {
  assert.ok(can('Analyst', 'terms.write'));
  assert.ok(can('Analyst', 'catalogue.write'));
  assert.ok(can('Analyst', 'audit.read'));
  for (const a of ['settings.write', 'sources.write', 'schedules.write', 'users.manage', 'credentials.write'] as const) {
    assert.equal(can('Analyst', a), false, a);
  }
});

test('Brand user is read-only and sees no configuration or audit', () => {
  assert.deepEqual(actionsFor('Brand user'), ['account.read', 'catalogue.read', 'observations.read']);
  assert.equal(can('Brand user', 'audit.read'), false);
  assert.equal(can('Brand user', 'terms.read'), false);
});

test('unknown or missing roles can do nothing', () => {
  assert.equal(can(null, 'account.read'), false);
  assert.equal(can('Owner', 'account.read'), false);
  assert.deepEqual(actionsFor(undefined), []);
});

test('only Administrators can grant Administrator', () => {
  assert.ok(grantableRoles('Administrator').includes('Administrator'));
  assert.deepEqual(grantableRoles('Account manager'), ['Account manager', 'Analyst', 'Brand user']);
  assert.deepEqual(grantableRoles('Analyst'), []);
});
