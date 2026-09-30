// The Amazon.com LG Sandbox slice (decisions 29–35): which SKUs, which terms, which schedules.
// Pure, so the choice is tested; `npm run slice:amazon-lg` applies it through the API.

export const SLICE = {
  account: 'lg',
  source: 'amazon_us',
  group: 'Amazon LG slice',
  skus: 10,
  options: { search_pages: 2, new_only: true, buy_box_only: true },
  discovery: { name: 'Amazon LG discovery', cadence: 'manual', timezone: 'Asia/Kolkata', kind: 'discovery' as const },
  monitoring: { name: 'Amazon LG daily monitoring', cadence: '0 9 * * *', timezone: 'Asia/Kolkata', kind: 'monitoring' as const },
  /** Above the daily sweep (10) and the under-notice re-check (20). */
  priority: 40,
} as const;

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

/** Two terms per SKU: its model number (searched as-is on Amazon) and its product name. */
export function sliceTerms(skus: SliceProduct[]): SliceTerm[] {
  return skus.flatMap((p) => [
    { type: 'identifier' as const, value: p.model ?? p.code, productCode: p.code },
    { type: 'keyword' as const, value: p.name, productCode: p.code },
  ]);
}
