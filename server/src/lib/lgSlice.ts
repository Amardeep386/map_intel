// The LG Sandbox slice that finishes P2b (decisions 29–38): which SKUs, terms, sources and schedules.
// Route D (decision 37, 1 Oct 2026): Amazon.com blocks every free US egress, so Amazon is paused and
// is manual evidence until the brand's SP-API access or a licensed provider is in place; the slice
// runs on Walmart (pages, works from US datacentres) and eBay (Browse API, decision 36).
// Pure, so the choice is tested; `npm run slice:lg` applies it through the API.

export const SLICE = {
  account: 'lg',
  /** Collected automatically, in this order. */
  sources: ['walmart_us', 'ebay_us'] as string[],
  /** Not collected automatically (route D): subscription and schedules switched off. */
  paused: ['amazon_us'] as string[],
  skus: 10,
  /** Subscription options per source, stored as explicit overrides. */
  options: {
    walmart_us: { search_pages: 3, new_only: true },
    ebay_us: { search_pages: 2, new_only: true, buy_it_now_only: true },
  } as Record<string, Record<string, unknown>>,
  /** Model-number and name terms (searched on eBay through the API). Was "Amazon LG slice". */
  group: { name: 'LG slice', formerName: 'Amazon LG slice', sources: ['ebay_us'], description: 'LG slice: model number and name of 10 LG SKUs, searched on eBay through the Browse API (decisions 29, 36).' },
  /** Walmart does not allow search (robots.txt): its LG computers browse page instead. */
  pagesGroup: {
    name: 'LG slice Walmart pages',
    sources: ['walmart_us'],
    description: 'LG slice: Walmart browse pages (Walmart /search is disallowed by robots.txt).',
    urls: ['https://www.walmart.com/browse/electronics/computers-laptops-and-tablets/3944_1089430?facet=brand%3ALG'],
  },
  discovery: { name: 'LG slice discovery', formerName: 'Amazon LG discovery', cadence: 'manual', timezone: 'Asia/Kolkata', kind: 'discovery' as const },
  monitoring: { name: 'LG slice daily monitoring', formerName: 'Amazon LG daily monitoring', cadence: '0 9 * * *', timezone: 'Asia/Kolkata', kind: 'monitoring' as const },
  /** Above the daily sweep (10) and the under-notice re-check (20). */
  priority: 40,
};

export interface SliceProduct {
  code: string;
  name: string;
  model: string | null;
  category: string | null;
  modelFamily: string | null;
  status: string;
}

/**
 * A spread of the catalogue: take turns across categories (by name) and, within each, take the
 * first SKU (code order) of a model family not used yet, until `n` SKUs are chosen. The LG demo
 * catalogue is all gram laptops, so this spreads the slice over its 5 lines and 10 families.
 */
export function pickSliceSkus(products: SliceProduct[], n: number = SLICE.skus): SliceProduct[] {
  const active = products.filter((p) => p.status === 'Active').sort((a, b) => a.code.localeCompare(b.code));
  const byCategory = new Map<string, Map<string, SliceProduct>>();
  for (const p of active) {
    const families = byCategory.get(p.category ?? '') ?? new Map<string, SliceProduct>();
    const family = p.modelFamily ?? p.code;
    if (!families.has(family)) families.set(family, p); // first SKU of the family by code
    byCategory.set(p.category ?? '', families);
  }
  const queues = [...byCategory.keys()].sort((a, b) => a.localeCompare(b)).map((c) => [...byCategory.get(c)!.values()].sort((a, b) => a.code.localeCompare(b.code)));
  const picked: SliceProduct[] = [];
  for (let round = 0; picked.length < n && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] && picked.length < n) picked.push(q[round]);
  }
  // A catalogue with fewer families than `n`: fill up with the remaining SKUs in code order.
  for (const p of active) if (picked.length < n && !picked.includes(p)) picked.push(p);
  return picked;
}

export interface SliceTerm {
  type: 'identifier' | 'keyword';
  value: string;
  productCode: string;
}

/** Two terms per SKU: its model number (searched as-is) and its product name. */
export function sliceTerms(skus: SliceProduct[]): SliceTerm[] {
  return skus.flatMap((p) => [
    { type: 'identifier' as const, value: p.model ?? p.code, productCode: p.code },
    { type: 'keyword' as const, value: p.name, productCode: p.code },
  ]);
}
