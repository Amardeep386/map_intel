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

test('withPageSlot: never more pages open than allowed, all run', async () => {
  const { withPageSlot } = await import('../src/collector/browser.js');
  let open = 0;
  let peak = 0;
  const task = () =>
    withPageSlot(async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 10));
      open -= 1;
      return 1;
    }, 2);
  const done = await Promise.all(Array.from({ length: 7 }, task));
  assert.equal(done.length, 7);
  assert.equal(peak, 2);
});
