// Synthetic candidate listings for building and testing the Mapping Center before the Phase 2b
// collectors find real ones. A day of candidates per brand: true matches (with and without an
// identifier), other sizes / capacities, refurbished and open-box offers, bundles, accessories,
// other brands, warehouse deals, auctions, and a grey-market seller that keeps relisting.
// Every candidate carries the decision a careful analyst would make (truth), which the exit
// test uses. Listings are stored with origin 'synthetic' and `npm run synthetic -- --clear`
// removes them. URLs point at the real retailer hosts with an "mi-synthetic" marker.
// Deterministic for a given seed.

export interface SyntheticProduct {
  id: string;
  code: string;
  name: string;
  brand: string;
  model: string | null;
  category: string | null;
  asin: string | null;
  /** Price to build offers around (median included price, else a category default). */
  basePrice: number;
}

export type Kind =
  | 'asin' | 'model' | 'title' | 'variant' | 'refurbished' | 'open-box' | 'bundle' | 'accessory' | 'other-brand' | 'warehouse' | 'auction' | 'grey-market';

export interface SyntheticCandidate {
  kind: Kind;
  sourceCode: string;
  url: string;
  title: string;
  price: number;
  sellerName: string;
  condition: string | null;
  format: string | null;
  channelSku: string | null;
  truth: { decision: 'include'; productId: string } | { decision: 'exclude'; reason: string; scope: 'listing' | 'seller_product' };
}

// Mix of a day's candidates (weights add up to 100).
const MIX: [Kind, number][] = [
  ['asin', 14], ['model', 18], ['title', 16], ['variant', 10], ['refurbished', 6], ['open-box', 4], ['bundle', 6],
  ['accessory', 7], ['other-brand', 6], ['warehouse', 4], ['auction', 4], ['grey-market', 5],
];

const SELLERS: Record<string, string[]> = {
  amazon_us: ['Amazon.com', 'Northwind Electronics', 'Contoso Deals', 'Fabrikam AV Supply', 'Tailspin Gadgets', 'Adventure Works Outlet'],
  walmart_us: ['Walmart.com', 'Wide World Importers', 'Litware Direct', 'Proseware Electronics', 'Lamna Home Tech', 'Northwind Electronics'],
  bestbuy_us: ['Best Buy'],
  ebay_us: ['coho_winery_electronics', 'fourthcoffee-outlet', 'margies_av_deals', 'treyresearch_tech', 'alpineski-house-liquidation'],
  target_us: ['Target'],
  homedepot_us: ['The Home Depot'],
};
const GREY_SELLER = 'Global Parallel Imports';
const OTHER_BRAND_TITLES = [
  'Sony BRAVIA 8 II 65" QD-OLED 4K Google TV', 'TCL 65" QM8K Mini LED 4K TV', 'Hisense 65" U8 Mini-LED 4K TV', 'Bose QuietComfort Ultra Earbuds',
  'Google Pixel 10 Pro 256GB Unlocked', 'Dell 27" Alienware AW2725DF QD-OLED Monitor', 'Whirlpool 4.5 cu. ft. Front Load Washer', 'Sonos Arc Ultra Soundbar',
  'Garmin Venu 4 Smartwatch', 'OnePlus Pad 3 12.1" 256GB',
];
const ACCESSORIES = ['Wall mount for', 'Screen protector for', 'Replacement remote for', 'Protective case for', 'Charging cable for', 'Stand for'];
const BUNDLE_ADDS = ['+ Soundbar Bundle', 'Bundle with 2-Year Protection Plan', '+ Wall Mount Kit', '2-Pack', 'with Bonus Accessories Kit'];

/** Mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough street prices by product type, only for building synthetic offers. */
export function defaultBasePrice(name: string, category: string | null): number {
  const t = `${name} ${category ?? ''}`.toLowerCase();
  if (/oled.*(tv|evo)|frame/.test(t)) return 2200;
  if (/\btv\b|qled|mini led/.test(t)) return 1300;
  if (/refrigerator|fridge/.test(t)) return 2600;
  if (/washer|dryer/.test(t)) return 1000;
  if (/macbook|gram|laptop|pc\b/.test(t)) return 1300;
  if (/monitor/.test(t)) return 800;
  if (/soundbar/.test(t)) return 900;
  if (/ultra|phone|galaxy s/.test(t)) return 1100;
  if (/ipad|tab/.test(t)) return 600;
  if (/watch/.test(t)) return 380;
  if (/airpods|buds/.test(t)) return 200;
  if (/ssd/.test(t)) return 180;
  if (/airtag|pencil/.test(t)) return 110;
  return 400;
}

/** A listing title for the product, in one of several retailer styles. */
function titleFor(p: SyntheticProduct, r: () => number, withModel: boolean): string {
  const name = p.name.replace(/\s*\((20\d\d)\)/, r() < 0.5 ? ' $1' : '');
  const styles = [
    () => name,
    () => `${name} - ${p.category ?? 'New'}`,
    () => name.replace(/(\d{2})"/, '$1-Inch Class'),
    () => `${p.brand} ${name.replace(new RegExp(`^${p.brand}\\s*`), '')} (Latest Model)`,
  ];
  const base = styles[Math.floor(r() * styles.length)]();
  return withModel && p.model ? `${base} ${p.model}` : base;
}

/** Another size or capacity of the same product line, when the name has one. */
function variantOf(p: SyntheticProduct, r: () => number): { title: string; factor: number } | null {
  const size = /(\d{2})"/.exec(p.name);
  if (size) {
    const n = Number(size[1]);
    const other = [n - 10, n + 12, n + 18, n - 22].filter((x) => x >= 24 && x !== n)[Math.floor(r() * 3)] ?? n + 12;
    const model = p.model ? p.model.replace(String(n), String(other)) : '';
    return { title: `${p.name.replace(`${n}"`, `${other}"`)} ${model}`.trim(), factor: other / n };
  }
  const cap = /(\d+)(GB|TB|mm)\b/i.exec(p.name);
  if (cap) {
    const n = Number(cap[1]);
    const other = cap[2].toLowerCase() === 'mm' ? (n === 42 ? 46 : 42) : n * 2;
    return { title: p.name.replace(cap[0], `${other}${cap[2]}`), factor: 1.2 };
  }
  return null;
}

const round = (x: number) => Math.round(x * 100) / 100 - 0.01;
const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

export function generateCandidates(products: SyntheticProduct[], count: number, seed = 1): SyntheticCandidate[] {
  if (!products.length) return [];
  const r = rng(seed);
  const out: SyntheticCandidate[] = [];
  const totalWeight = MIX.reduce((a, [, w]) => a + w, 0);
  for (let i = 0; i < count; i++) {
    const p = products[i % products.length];
    let roll = r() * totalWeight;
    let kind: Kind = MIX[0][0];
    for (const [k, w] of MIX) {
      if ((roll -= w) < 0) {
        kind = k;
        break;
      }
    }
    if (kind === 'asin' && !p.asin) kind = 'model';
    if (kind === 'variant' && !variantOf(p, r)) kind = 'title';

    const n = `${seed}-${i}`;
    const source = kind === 'asin' || kind === 'warehouse' ? 'amazon_us' : kind === 'auction' ? 'ebay_us' : kind === 'grey-market' ? 'walmart_us'
      : pick(r, ['amazon_us', 'walmart_us', 'walmart_us', 'bestbuy_us', 'ebay_us', 'target_us']);
    const url =
      source === 'amazon_us' ? `https://www.amazon.com/dp/${kind === 'asin' ? p.asin : `B0SYN${String(i).padStart(5, '0')}`}?mi-synthetic=${n}`
      : source === 'walmart_us' ? `https://www.walmart.com/ip/mi-synthetic-${n}`
      : source === 'bestbuy_us' ? `https://www.bestbuy.com/site/mi-synthetic-${n}.p`
      : source === 'ebay_us' ? `https://www.ebay.com/itm/mi-synthetic-${n}`
      : `https://www.target.com/p/mi-synthetic-${n}`;
    const seller = kind === 'warehouse' ? 'Amazon Warehouse' : kind === 'grey-market' ? GREY_SELLER : pick(r, SELLERS[source]);
    const base = p.basePrice;
    const include = { decision: 'include' as const, productId: p.id };
    const exclude = (reason: string, scope: 'listing' | 'seller_product' = 'listing') => ({ decision: 'exclude' as const, reason, scope });
    let c: Omit<SyntheticCandidate, 'kind' | 'sourceCode' | 'url' | 'sellerName'>;
    switch (kind) {
      case 'asin':
        c = { title: titleFor(p, r, r() < 0.5), price: round(base * (0.78 + r() * 0.25)), condition: 'New', format: null, channelSku: p.asin, truth: include };
        break;
      case 'model':
        c = { title: titleFor(p, r, true), price: round(base * (0.7 + r() * 0.32)), condition: 'New', format: null, channelSku: null, truth: include };
        break;
      case 'title':
        c = { title: titleFor(p, r, false), price: round(base * (0.68 + r() * 0.34)), condition: null, format: null, channelSku: null, truth: include };
        break;
      case 'variant': {
        const v = variantOf(p, r)!;
        // The "other size" may itself be in the catalogue (a 55" next to the 65"): then it is that product.
        const compact = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const other = products.find((q) => q.id !== p.id && q.model && compact(v.title).includes(compact(q.model)));
        c = { title: v.title, price: round(base * v.factor * (0.85 + r() * 0.2)), condition: 'New', format: null, channelSku: null,
          truth: other ? { decision: 'include', productId: other.id } : exclude('Wrong variant') };
        break;
      }
      case 'refurbished':
        c = { title: `${titleFor(p, r, r() < 0.5)} (${pick(r, ['Renewed', 'Refurbished', 'Certified Refurbished'])})`, price: round(base * (0.62 + r() * 0.15)), condition: 'Refurbished', format: null, channelSku: null, truth: exclude('Used or refurbished') };
        break;
      case 'open-box':
        c = { title: `${titleFor(p, r, true)} - Open Box`, price: round(base * (0.7 + r() * 0.12)), condition: 'Open box', format: null, channelSku: null, truth: exclude('Used or refurbished') };
        break;
      case 'bundle':
        c = { title: `${titleFor(p, r, r() < 0.6)} ${pick(r, BUNDLE_ADDS)}`, price: round(base * (1.1 + r() * 0.25)), condition: 'New', format: null, channelSku: null, truth: exclude('Bundle or multipack') };
        break;
      case 'accessory':
        c = { title: `${pick(r, ACCESSORIES)} ${p.name}${r() < 0.4 && p.model ? ` ${p.model}` : ''}`, price: round(8 + r() * 60), condition: 'New', format: null, channelSku: null, truth: exclude('Accessory or part') };
        break;
      case 'other-brand':
        c = { title: pick(r, OTHER_BRAND_TITLES), price: round(base * (0.7 + r() * 0.5)), condition: 'New', format: null, channelSku: null, truth: exclude('Wrong product') };
        break;
      case 'warehouse':
        c = { title: `${titleFor(p, r, false)} - Warehouse Deal`, price: round(base * (0.7 + r() * 0.12)), condition: 'Used - Like New', format: null, channelSku: null, truth: exclude('Used or refurbished') };
        break;
      case 'auction':
        c = { title: `${titleFor(p, r, r() < 0.5)} NEW SEALED`, price: round(base * (0.45 + r() * 0.3)), condition: 'New', format: 'auction', channelSku: null, truth: exclude('Not a purchasable offer') };
        break;
      case 'grey-market': {
        // A grey-market reseller keeps relisting the same couple of products.
        const g = products[Math.floor(r() * Math.min(2, products.length))];
        c = { title: `${titleFor(g, r, r() < 0.6)} (International Version)`, price: round(g.basePrice * (0.66 + r() * 0.1)), condition: 'New', format: null, channelSku: null,
          truth: { decision: 'exclude', reason: 'Out of region', scope: 'seller_product' } };
        break;
      }
    }
    out.push({ kind, sourceCode: source, url, sellerName: seller, ...c });
  }
  return out;
}
