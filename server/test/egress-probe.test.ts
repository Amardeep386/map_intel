import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeProbe, type ProbeReport } from '../src/collector/egressProbe.js';
import { genericBlock } from '../src/collector/extract/common.js';

test('genericBlock spots bot walls and rate limits', () => {
  assert.equal(genericBlock('<div id="px-captcha"></div>', 200), 'captcha');
  // A captcha provider named in the Content-Security-Policy is not a challenge (Walmart, Sep 2026).
  const csp = '<meta http-equiv="Content-Security-Policy" content="frame-src https://www.recaptcha.net https://hcaptcha.com *.captcha.net">';
  assert.equal(genericBlock(`<html><head>${csp}</head><body>LG fridge $1,499</body></html>`, 200), null);
  assert.equal(genericBlock('<title>Robot or human?</title>', 200), 'captcha');
  assert.equal(genericBlock('<h1>Access Denied</h1> errors.edgesuite.net', 403), 'access_denied');
  assert.equal(genericBlock('', 429), 'rate_limited');
  // Target in headless Chromium (Sep 2026): the "Press & hold" overlay deep in the DOM; a hidden one is not a block.
  const filler = 'x'.repeat(60_000);
  assert.equal(genericBlock(`<html>${filler}<iframe id="px-captcha-modal" style="display: block; position: fixed"></iframe></html>`, 200), 'captcha');
  assert.equal(genericBlock(`<html>${filler}<iframe id="px-captcha-modal" style="display: none"></iframe></html>`, 200), null);
  assert.equal(genericBlock('<html><body>LG 65" OLED $1,499.99</body></html>', 200), null);
});

test('summarizeProbe gives one line per source with the reasons', () => {
  const base = { ms: 100, bytes: 1000, error: null, robots: 'allowed' as const, price: null, block: null, status: 200 };
  const report: ProbeReport = {
    egressLabel: 'test',
    egressIp: '1.2.3.4',
    at: '2026-09-27T00:00:00Z',
    results: [
      { ...base, source: 'amazon_us', url: 'a1', price: 999 },
      { ...base, source: 'amazon_us', url: 'a2', block: 'captcha' },
      { ...base, source: 'target_us', url: 't1', robots: 'disallowed', status: null },
      { ...base, source: 'bestbuy_us', url: 'b1', status: null, error: 'fetch failed' },
    ],
  };
  const lines = summarizeProbe(report);
  assert.match(lines[0], /^amazon_us\s+1\/2 ok, 1 priced\s+\(captcha\)$/);
  assert.match(lines[1], /target_us\s+0\/1 ok\s+\(robots\)/);
  assert.match(lines[2], /bestbuy_us\s+0\/1 ok\s+\(error\)/);
});
