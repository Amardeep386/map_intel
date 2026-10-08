// Role -> action map (no database).   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_ACTIONS, actionsFor, can, grantableRoles } from '../src/lib/permissions.js';

test('Administrator and Account manager can do every account action except the brand’s approval of notices', () => {
  for (const a of ACCOUNT_ACTIONS) {
    const expected = a !== 'notices.approve';
    assert.equal(can('Administrator', a), expected, a);
    assert.equal(can('Account manager', a), expected, a);
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

test('Brand user is read-only (cases too), approves notices, and sees no configuration or audit', () => {
  assert.deepEqual(actionsFor('Brand user'), ['account.read', 'catalogue.read', 'observations.read', 'violations.read', 'reports.read', 'cases.read', 'notices.approve']);
  assert.equal(can('Brand user', 'audit.read'), false);
  assert.equal(can('Brand user', 'terms.read'), false);
});

test('Analyst cleanses: mapping and sellers read and write; Brand user sees neither', () => {
  for (const a of ['mapping.read', 'mapping.write', 'sellers.read', 'sellers.write'] as const) {
    assert.ok(can('Analyst', a), a);
    assert.equal(can('Brand user', a), false, a);
  }
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

test('P3: Analyst works violations but does not publish rules or schedule reports; Brand user reads violations and reports', () => {
  assert.ok(can('Analyst', 'violations.write'));
  for (const a of ['rules.write', 'reports.write', 'alerts.write'] as const) assert.equal(can('Analyst', a), false, a);
  for (const a of ['violations.read', 'rules.read', 'reports.read', 'alerts.read'] as const) assert.ok(can('Analyst', a), a);
  assert.ok(can('Brand user', 'violations.read'));
  assert.ok(can('Brand user', 'reports.read'));
  for (const a of ['violations.write', 'rules.read', 'alerts.read', 'reports.write'] as const) assert.equal(can('Brand user', a), false, a);
});
