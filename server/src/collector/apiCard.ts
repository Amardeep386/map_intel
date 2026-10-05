// Evidence card: a picture drawn from an official API response, for sources whose pages block us
// (eBay). The response itself (JSON, SHA-256, Object Lock) stays the evidence; the card is a
// readable view of it, labelled as drawn from the API, never passed off as a page screenshot.
// Pure: apiCardHtml builds the HTML; browser.ts renders it to PNG.

export interface CardMeta {
  sourceName: string; // "eBay"
  apiName: string; // "eBay Browse API"
  readAt: Date;
  apiSha256: string;
}

export interface CardFields {
  title: string | null;
  price: string | null;
  condition: string | null;
  seller: string | null;
  sellerRating: string | null;
  availability: string | null;
  shipping: string | null;
  location: string | null;
  itemId: string | null;
  mpn: string | null;
  gtin: string | null;
  imageUrl: string | null;
  listingUrl: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function money(p: { value?: string; currency?: string } | undefined): string | null {
  if (!p?.value) return null;
  const n = Number(p.value);
  if (!Number.isFinite(n)) return null;
  return p.currency === 'USD' || !p.currency ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${p.currency}`;
}

/** The fields an eBay Browse API item response carries (get_item / get_item_by_legacy_id). */
export function ebayCardFields(body: string): CardFields {
  const j = JSON.parse(body);
  const est = j.estimatedAvailabilities?.[0];
  const ship = j.shippingOptions?.[0];
  const shipCost = money(ship?.shippingCost);
  const loc = j.itemLocation;
  const rating =
    j.seller?.feedbackPercentage || j.seller?.feedbackScore !== undefined
      ? [j.seller.feedbackPercentage ? `${j.seller.feedbackPercentage}% positive` : null, j.seller.feedbackScore !== undefined ? `${j.seller.feedbackScore} ratings` : null]
          .filter(Boolean)
          .join(', ')
      : null;
  // The web link carries a long tracking parameter; the item number alone identifies the listing.
  const itemId = j.legacyItemId ?? (typeof j.itemId === 'string' ? (j.itemId.split('|')[1] ?? j.itemId) : null);
  return {
    title: j.title ?? null,
    price: money(j.price),
    condition: j.condition ?? null,
    seller: j.seller?.username ?? null,
    sellerRating: rating,
    availability: est?.estimatedAvailabilityStatus
      ? `${String(est.estimatedAvailabilityStatus).replace(/_/g, ' ').toLowerCase()}${est.estimatedAvailableQuantity !== undefined ? ` (${est.estimatedAvailableQuantity} available)` : ''}`
      : null,
    shipping: shipCost === null ? null : shipCost === '$0.00' ? 'Free shipping' : `${shipCost} shipping`,
    location: loc ? [loc.city, loc.stateOrProvince, loc.country].filter(Boolean).join(', ') : null,
    itemId,
    mpn: j.mpn ?? null,
    gtin: j.gtin ?? null,
    imageUrl: j.image?.imageUrl ?? null,
    listingUrl: itemId ? `https://www.ebay.com/itm/${itemId}` : null,
  };
}

const isNew = (c: string | null) => !c || /^new$|^brand new$/i.test(c.trim());

export function apiCardHtml(f: CardFields, meta: CardMeta): string {
  const row = (k: string, v: string | null, warn = false) =>
    v ? `<tr><th>${esc(k)}</th><td${warn ? ' class="warn"' : ''}>${esc(v)}</td></tr>` : '';
  const read = meta.readAt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1ea; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #2b2622; }
  #card { width: 960px; padding: 28px; background: #fff; border: 1px solid #d9d2c5; }
  .band { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 14px; border-bottom: 1px solid #e6dfd3; }
  .band b { font-size: 15px; }
  .tag { font-size: 12px; color: #6b5f52; }
  .main { display: flex; gap: 28px; padding: 22px 0; }
  .pic { width: 300px; height: 300px; flex: none; border: 1px solid #e6dfd3; display: flex; align-items: center; justify-content: center; background: #faf8f4; }
  .pic img { max-width: 100%; max-height: 100%; }
  .pic span { font-size: 12px; color: #8a7e70; }
  h1 { font-size: 20px; line-height: 1.3; margin: 0 0 10px; font-weight: 600; }
  .price { font-size: 32px; font-weight: 700; margin: 0 0 16px; }
  table { border-collapse: collapse; font-size: 14px; width: 100%; }
  th { text-align: left; font-weight: 500; color: #6b5f52; padding: 5px 16px 5px 0; width: 150px; vertical-align: top; }
  td { padding: 5px 0; }
  td.warn { color: #b42318; font-weight: 700; }
  .foot { border-top: 1px solid #e6dfd3; padding-top: 14px; font-size: 12px; color: #6b5f52; line-height: 1.6; }
  .foot code { font-family: Consolas, Menlo, monospace; font-size: 11.5px; color: #2b2622; }
</style></head><body><div id="card">
  <div class="band"><b>${esc(meta.sourceName)} listing · evidence card</b><span class="tag">Drawn from the ${esc(meta.apiName)} response, not a screenshot of the web page</span></div>
  <div class="main">
    <div class="pic">${f.imageUrl ? `<img src="${esc(f.imageUrl)}" alt="">` : '<span>No image in the response</span>'}</div>
    <div style="flex:1;min-width:0">
      <h1>${esc(f.title ?? '(no title)')}</h1>
      <div class="price">${esc(f.price ?? 'No price')}</div>
      <table>
        ${row('Condition', f.condition, !isNew(f.condition))}
        ${row('Seller', f.seller ? `${f.seller}${f.sellerRating ? ` (${f.sellerRating})` : ''}` : null)}
        ${row('Availability', f.availability)}
        ${row('Shipping', f.shipping)}
        ${row('Item location', f.location)}
        ${row('Item number', f.itemId)}
        ${row('MPN', f.mpn)}
        ${row('UPC / GTIN', f.gtin)}
        ${row('Listing', f.listingUrl)}
      </table>
    </div>
  </div>
  <div class="foot">
    Read at <b>${esc(read)}</b> by MAP Intel.<br>
    API response SHA-256: <code>${esc(meta.apiSha256)}</code><br>
    The original response is stored unchanged under this fingerprint, under a storage lock.
  </div>
</div></body></html>`;
}
