import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiAuthError } from '../src/collector/apiError.js';
import { ebayApiItem, ebayApiSearch, resetEbayToken } from '../src/collector/ebayApi.js';

function fakeFetch(routes: Record<string, { status: number; body: unknown }>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const r = hit?.[1] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const TOKEN = { '/oauth2/token': { status: 200, body: { access_token: 'tok', expires_in: 7200 } } };

test('ebay API search: Buy It Now + new filter, legacy ids, one token for many calls', async () => {
  resetEbayToken();
  const calls: string[] = [];
  const summary = {
    itemId: 'v1|123456789012|0',
    title: 'LG C4 65',
    price: { value: '1299.00', currency: 'USD' },
    condition: 'New',
    seller: { username: 'tvdeals' },
    buyingOptions: ['FIXED_PRICE'],
  };
  const f = fakeFetch({ ...TOKEN, '/item_summary/search': { status: 200, body: { itemSummaries: [summary] } } }, calls);
  const items = await ebayApiSearch('LG OLED65C4PUA', { newOnly: true }, f);
  await ebayApiSearch('LG OLED55C4PUA', { newOnly: true }, f);
  assert.deepEqual(
    items.map((i) => [i.url, i.price, i.sellerName, i.condition, i.format]),
    [['https://www.ebay.com/itm/123456789012', 1299, 'tvdeals', 'new', 'buy_it_now']],
  );
  assert.equal(calls.filter((c) => c.includes('oauth2')).length, 1);
  assert.match(decodeURIComponent(calls[1]), /filter=buyingOptions:\{FIXED_PRICE\},conditionIds:\{1000\}/);
});

test('ebay API item, and refused credentials are an auth failure', async () => {
  resetEbayToken();
  const item = {
    itemId: 'v1|1|0',
    title: 'x',
    price: { value: '10.50', currency: 'USD' },
    seller: { username: 's' },
    estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }],
  };
  const x = await ebayApiItem('123456789012', fakeFetch({ ...TOKEN, get_item_by_legacy_id: { status: 200, body: item } }));
  assert.deepEqual([x.price, x.currency, x.sellerName, x.availability], [10.5, 'USD', 's', 'in_stock']);
  resetEbayToken();
  await assert.rejects(ebayApiSearch('x', { newOnly: false }, fakeFetch({ '/oauth2/token': { status: 401, body: {} } })), ApiAuthError);
});
