import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiAuthError } from '../src/collector/apiError.js';
import { planTerm } from '../src/collector/discovery.js';
import { ebayApiItem, ebayApiSearch, ebayApiSearchUrl, isEbayApiUrl, parseEbaySearch, resetEbayToken } from '../src/collector/ebayApi.js';
import { adapters } from '../src/collector/sources.js';
import { config } from '../src/lib/config.js';

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

test('ebay API item keeps the raw response as evidence (decision 36)', async () => {
  resetEbayToken();
  const item = { itemId: 'v1|1|0', title: 'LG gram 16Z90S', price: { value: '999.99', currency: 'USD' }, mpn: '16Z90S-K.AAB7U1' };
  const x = await ebayApiItem('123456789012', fakeFetch({ ...TOKEN, get_item_by_legacy_id: { status: 200, body: item } }));
  assert.equal(x.price, 999.99);
  assert.equal(x.api.status, 200);
  assert.deepEqual(JSON.parse(x.api.body), item);
  assert.match(x.api.url, /legacy_item_id=123456789012/);
});

test('ebay API search URL pages by offset, Buy It Now only; a response becomes a results page', () => {
  const u = new URL(ebayApiSearchUrl('LG gram 16Z90S', 2));
  assert.equal(u.host, 'api.ebay.com');
  assert.equal(u.searchParams.get('q'), 'LG gram 16Z90S');
  assert.equal(u.searchParams.get('offset'), '50');
  assert.equal(u.searchParams.get('filter'), 'buyingOptions:{FIXED_PRICE}');
  assert.ok(isEbayApiUrl(u.href));
  assert.ok(!isEbayApiUrl('https://www.ebay.com/itm/123456789012'));

  const page = parseEbaySearch(
    JSON.stringify({
      total: 120,
      next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=x&offset=100',
      itemSummaries: [{ itemId: 'v1|223344556677|0', title: 'LG gram', price: { value: '1099.00', currency: 'USD' }, condition: 'Used' }],
    }),
  );
  assert.equal(page.recognized, true);
  assert.equal(page.nextUrl, 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=x&offset=100');
  assert.deepEqual(page.items.map((i) => [i.url, i.price, i.condition]), [['https://www.ebay.com/itm/223344556677', 1099, 'used']]);
  assert.deepEqual(parseEbaySearch(JSON.stringify({ total: 0 })), { items: [], nextUrl: null, recognized: true });
  assert.equal(parseEbaySearch('<html>').recognized, false);
});

test('eBay plans keyword and model-number terms as API searches only when keyed', () => {
  const saved = [config.EBAY_CLIENT_ID, config.EBAY_CLIENT_SECRET];
  try {
    config.EBAY_CLIENT_ID = undefined;
    assert.deepEqual(planTerm(adapters.ebay_us, 'ebay_us', { type: 'keyword', value: 'LG gram' }), { kind: 'skip', reason: 'not_executable' });
    config.EBAY_CLIENT_ID = 'id';
    config.EBAY_CLIENT_SECRET = 'secret';
    const plan = planTerm(adapters.ebay_us, 'ebay_us', { type: 'identifier', value: '16Z90S-K.AAB7U1' });
    assert.equal(plan.kind, 'search');
    assert.ok(plan.kind === 'search' && isEbayApiUrl(plan.url));
  } finally {
    [config.EBAY_CLIENT_ID, config.EBAY_CLIENT_SECRET] = saved;
  }
});
