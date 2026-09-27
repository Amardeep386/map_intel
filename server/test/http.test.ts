import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyFromUrl } from '../src/collector/browser.js';
import { claimSlot } from '../src/collector/http.js';

test('claimSlot: requests to one host queue up one gap apart', () => {
  assert.deepEqual(claimSlot(null, 1000, 500), [1000, 1500]); // free host: go now
  assert.deepEqual(claimSlot(1500, 1100, 500), [1500, 2000]); // busy: wait for the next slot
  assert.deepEqual(claimSlot(900, 1000, 500), [1000, 1500]); // a stale slot never makes us go early
});

test('proxyFromUrl splits credentials for Playwright', () => {
  assert.equal(proxyFromUrl(undefined), undefined);
  assert.deepEqual(proxyFromUrl('http://proxy.example:8080'), { server: 'http://proxy.example:8080' });
  assert.deepEqual(proxyFromUrl('http://u%40x:p%3Ass@proxy.example:8080'), { server: 'http://proxy.example:8080', username: 'u@x', password: 'p:ss' });
});
