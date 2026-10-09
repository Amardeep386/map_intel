// Retention settings: defaults and limits.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RETENTION_DEFAULTS, retentionOf, retentionProblem } from '../src/lib/retention.js';

test('retentionOf: defaults filled in, settings win', () => {
  assert.deepEqual(retentionOf({}), RETENTION_DEFAULTS);
  assert.deepEqual(retentionOf(null), RETENTION_DEFAULTS);
  assert.deepEqual(retentionOf({ retention_observation_days: 400, retention_audit_days: 'x' }), { observations: 400, evidence: 365, audit: 2555 });
});

test('retentionProblem: bounds, evidence not longer than observations, and not shorter than the Object Lock', () => {
  assert.equal(retentionProblem(RETENTION_DEFAULTS, 365), null);
  assert.match(retentionProblem({ ...RETENTION_DEFAULTS, observations: 30 }, 0)!, /90 to 3,650/);
  assert.match(retentionProblem({ ...RETENTION_DEFAULTS, evidence: 800 }, 0)!, /no longer than observations/);
  assert.match(retentionProblem({ ...RETENTION_DEFAULTS, evidence: 200 }, 365)!, /locked for 365 days/);
  assert.equal(retentionProblem({ ...RETENTION_DEFAULTS, evidence: 200 }, 0), null);
  assert.match(retentionProblem({ ...RETENTION_DEFAULTS, audit: 100 }, 0)!, /365 to 3,650/);
});
