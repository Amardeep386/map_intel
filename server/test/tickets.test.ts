// Internal tickets: which issues open a ticket and which tickets resolve.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backlogIssue, planSync, sourceIssue } from '../src/lib/tickets.js';

const src = sourceIssue({ account_id: 'a1', account: 'LG', source_id: 's1', source: 'Walmart.com', health: 'Blocked', main_failure: 'blocked', crawl_run_id: 'r1', created_at: new Date('2026-10-09T06:00:00Z') });
const back = backlogIssue({ account_id: 'a1', account: 'LG', staged: 120, oldest: new Date('2026-10-01T00:00:00Z') });

test('issues: one key per account and source / per account backlog; priority from severity', () => {
  assert.equal(src.key, 'source:a1:s1');
  assert.equal(src.title, 'Walmart.com is blocked for LG');
  assert.equal(src.priority, 'High');
  assert.equal(sourceIssue({ ...{ account_id: 'a1', account: 'LG', source_id: 's1', source: 'Walmart.com', main_failure: null, crawl_run_id: 'r1', created_at: new Date() }, health: 'Failing' }).priority, 'Normal');
  assert.equal(back.key, 'mapping:a1');
  assert.equal(back.priority, 'High');
  assert.equal(backlogIssue({ account_id: 'a1', account: 'LG', staged: 30, oldest: new Date() }).priority, 'Normal');
});

test('planSync: new issues open once; open automatic tickets without an issue resolve', () => {
  assert.deepEqual(planSync([src, back], []).toOpen.map((i) => i.key), ['source:a1:s1', 'mapping:a1']);
  const again = planSync([src, back], [{ id: 't1', key: 'source:a1:s1' }, { id: 't2', key: 'mapping:a1' }]);
  assert.equal(again.toOpen.length, 0);
  assert.equal(again.toResolve.length, 0);
  const healed = planSync([back], [{ id: 't1', key: 'source:a1:s1' }, { id: 't2', key: 'mapping:a1' }]);
  assert.deepEqual(healed.toResolve.map((t) => t.id), ['t1']);
});
