// Validate and normalise one collected price before it is published. Pure: the collector loads the
// reference prices and history, this decides. A suspicious reading is held (stored, never
// published) and read again by a recheck job; two consistent readings publish.

export type ReferenceKind = 'map' | 'msrp' | 'median';

export interface ValidationInput {
  price: number | null;
  currency: string | null;
  /** Currency the source prices in (USD for the US launch sources). */
  expectedCurrency: string;
  /** MAP in force on the observation date, else MSRP, else the listing's median accepted price. */
  reference: { kind: ReferenceKind; amount: number } | null;
  /** The listing's latest published price, if any. */
  lastAccepted: { price: number; at: Date } | null;
  observedAt: Date;
  /** Set when this reading re-checks a held one: the held price. */
  recheckOf?: { price: number } | null;
}

export interface Check {
  name: 'price' | 'currency' | 'bounds' | 'sudden_change' | 'confirmed_by_recheck';
  passed: boolean;
  detail: string;
}

export interface Validation {
  verdict: 'accept' | 'hold';
  checks: Check[];
  held: Check['name'][];
  reference: ValidationInput['reference'];
}

export const BOUNDS = { low: 0.25, high: 3 } as const;
export const SUDDEN_CHANGE = 0.4;
export const SUDDEN_CHANGE_DAYS = 14;
/** Two readings within 2% are "the same price". */
export const CONFIRM_TOLERANCE = 0.02;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function validatePrice(v: ValidationInput): Validation {
  const checks: Check[] = [];
  if (v.price === null) return { verdict: 'accept', checks, held: [], reference: v.reference };

  checks.push({ name: 'price', passed: v.price > 0 && Number.isFinite(v.price), detail: `${v.price}` });

  const currency = v.currency ?? v.expectedCurrency;
  checks.push({ name: 'currency', passed: currency === v.expectedCurrency, detail: `${currency} (expected ${v.expectedCurrency})` });

  if (v.reference && v.reference.amount > 0) {
    const ratio = v.price / v.reference.amount;
    checks.push({
      name: 'bounds',
      passed: ratio >= BOUNDS.low && ratio <= BOUNDS.high,
      detail: `${pct(ratio)} of ${v.reference.kind} ${v.reference.amount} (allowed ${pct(BOUNDS.low)}–${pct(BOUNDS.high)})`,
    });
  }

  const last = v.lastAccepted;
  if (last && last.price > 0 && v.observedAt.getTime() - last.at.getTime() <= SUDDEN_CHANGE_DAYS * 86_400_000) {
    const change = Math.abs(v.price - last.price) / last.price;
    checks.push({ name: 'sudden_change', passed: change <= SUDDEN_CHANGE, detail: `${pct(change)} vs ${last.price} on ${last.at.toISOString().slice(0, 10)}` });
  }

  // A second, consistent reading confirms a held price: bounds and sudden change stand down.
  // A wrong currency or a non-positive price is never confirmed.
  if (v.recheckOf && v.recheckOf.price > 0) {
    const diff = Math.abs(v.price - v.recheckOf.price) / v.recheckOf.price;
    const confirmed = diff <= CONFIRM_TOLERANCE;
    checks.push({ name: 'confirmed_by_recheck', passed: confirmed, detail: `${pct(diff)} from held ${v.recheckOf.price}` });
    if (confirmed) {
      const hard = checks.filter((c) => !c.passed && (c.name === 'price' || c.name === 'currency')).map((c) => c.name);
      return { verdict: hard.length ? 'hold' : 'accept', checks, held: hard, reference: v.reference };
    }
  }

  const held = checks.filter((c) => !c.passed && c.name !== 'confirmed_by_recheck').map((c) => c.name);
  return { verdict: held.length ? 'hold' : 'accept', checks, held, reference: v.reference };
}

export function median(values: number[]): number | null {
  const xs = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** The reference a price is judged against: MAP in force, else MSRP, else the median. */
export function pickReference(map: number | null, msrp: number | null, recent: number[]): ValidationInput['reference'] {
  if (map && map > 0) return { kind: 'map', amount: map };
  if (msrp && msrp > 0) return { kind: 'msrp', amount: msrp };
  const m = median(recent);
  return m ? { kind: 'median', amount: m } : null;
}

export type PromoType = 'coupon' | 'strike_through' | 'sale' | null;

/** Normalised promotion type of a reading (the raw texts are stored too). */
export function promoType(x: { price: number | null; listPrice: number | null; promoText: string | null; couponText: string | null }): PromoType {
  if (x.couponText) return 'coupon';
  if (x.price !== null && x.listPrice !== null && x.listPrice > x.price) return 'strike_through';
  if (x.promoText && /sale|deal|save|off|rollback|clearance/i.test(x.promoText)) return 'sale';
  return null;
}
