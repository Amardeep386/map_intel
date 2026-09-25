// Match confidence: is this collected listing one of the brand's products, and how sure are we?
// Six signals, each scored 0–1 with a readable detail and stored per signal (match_signal):
//   identifier  ASIN / UPC / EAN / MPN / alt SKU found in the URL, retailer id or title
//   title       how much of the product's name and model appears in the listing title
//   image       not available until collectors capture product images (weight shared out)
//   price       plausibility against the MAP in force, else MSRP
//   attributes  condition, bundle / multipack, accessory, size / capacity / colour variant
//   prior       earlier human decisions on the same URL or the same seller + product
// Pure functions; lib/mapping.ts loads the inputs and stores the result.

export const SIGNALS = ['identifier', 'title', 'image', 'price', 'attributes', 'prior'] as const;
export type Signal = (typeof SIGNALS)[number];

/** Weights when every signal is available; missing signals (score null) share theirs out. */
export const WEIGHTS: Record<Signal, number> = { identifier: 30, title: 30, image: 5, price: 15, attributes: 15, prior: 5 };

export interface CandidateInput {
  url: string;
  title: string | null;
  price: number | null;
  channelSku: string | null;
  sellerName: string | null;
  condition: string | null;
  format: string | null;
  imageUrl: string | null;
}

export interface ProductRef {
  id: string;
  code: string;
  name: string;
  brand: string;
  model: string | null;
  msrp: number | null;
  map: number | null;
  identifiers: { type: string; value: string }[];
}

/** An earlier human decision that bears on this candidate. */
export interface PriorLabel {
  productId: string | null;
  state: 'Included' | 'Excluded';
  sameUrl: boolean;
}

export interface Thresholds {
  include: number; // >= auto-include
  review: number; // >= review; below = auto-exclude
}

export interface SignalResult {
  signal: Signal;
  score: number | null;
  weight: number;
  passed: boolean | null;
  detail: string;
}

export interface Found {
  identifiers: { type: string; value: string; where: 'url' | 'retailer id' | 'title'; exact: boolean }[];
  condition: string | null;
  bundle: string | null;
  accessory: string | null;
  variant: string | null;
}

export interface MatchResult {
  productId: string | null;
  confidence: number;
  band: 'include' | 'review' | 'exclude';
  signals: SignalResult[];
  found: Found;
  /** Discount below the reference price (MAP, else MSRP), 0–1. */
  depth: number;
  /** Review order: lower confidence and deeper discount first (higher = earlier). */
  priority: number;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'for', 'of', 'in', 'by', 'new', 'class', 'series', 'inch', 'in', 'model', 'version', 'edition', 'smart', 'tv']);

/** Compact form for identifier comparison: "OLED65C6-PUA" -> "OLED65C6PUA". */
export const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function tokens(s: string): string[] {
  const t = s
    .toLowerCase()
    .replace(/(\d+)\s*(?:"|”|''|-?\s?inch(?:es)?\b|-?in\b)/g, '$1 ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
  return [...new Set(t)];
}

/** Share of the product's words found in the title, blended with overall overlap (0–1). */
export function titleSimilarity(title: string, product: ProductRef): number {
  const p = tokens(`${product.brand} ${product.name} ${product.model ?? ''}`);
  const t = new Set(tokens(title));
  if (!p.length || !t.size) return 0;
  const hit = p.filter((w) => t.has(w)).length;
  const containment = hit / p.length;
  const dice = (2 * hit) / (p.length + t.size);
  return Math.round((0.75 * containment + 0.25 * dice) * 1000) / 1000;
}

// Sizes, capacities and colours that make a different variant of the same product line.
const SIZE_RE = /\b(\d{2,3})\s*(?:"|”|''|-?\s?inch(?:es)?\b|-?in\b|\s?class\b)/gi;
const CAPACITY_RE = /\b(\d+)\s?(gb|tb|mm)\b/gi;
const COLOURS = ['black', 'white', 'silver', 'gold', 'blue', 'green', 'red', 'pink', 'purple', 'graphite', 'titanium', 'midnight', 'starlight', 'gray', 'grey', 'navy', 'cream', 'yellow', 'orange'];

function values(re: RegExp, s: string): Set<string> {
  return new Set([...s.matchAll(re)].map((m) => m.slice(1).join('').toLowerCase()));
}

const CONDITION_RE = /\b(refurbished|renewed|open[\s-]?box|pre[\s-]?owned|used|for parts|reconditioned|like new|scratch(?:\s|-)and(?:\s|-)dent)\b/i;
const BUNDLE_RE = /\bbundle\b|\bcombo\b|\bkit\b|\b\d+[\s-]?pack\b|\bpack of \d+\b|\bset of \d+\b|\bwith (?:free|bonus)\b|\s\+\s?\w+|\bw\/\s?\w+/i;
const ACCESSORY_RE = /\b(case for|cover for|screen protector|protector for|mount for|wall mount|compatible with|replacement|remote (?:control )?for|cable for|charger for|stand for|skin for|strap for|band for|adapter for|for (?:lg|samsung|apple|iphone|ipad|galaxy|macbook)\b)/i;

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Where the product's identifiers appear in the candidate. */
export function findIdentifiers(c: CandidateInput, p: ProductRef): Found['identifiers'] {
  const url = compact(decodeURIComponent(c.url));
  const sku = c.channelSku ? compact(c.channelSku) : '';
  const titleWords = new Set((c.title ?? '').split(/[^A-Za-z0-9./-]+/).map(compact).filter(Boolean));
  const titleCompact = compact(c.title ?? '');
  const out: Found['identifiers'] = [];
  const ids = [...p.identifiers];
  if (p.model && !ids.some((i) => i.type === 'MPN' && compact(i.value) === compact(p.model!))) ids.push({ type: 'MPN', value: p.model });
  for (const { type, value } of ids) {
    const v = compact(value);
    if (v.length < 4) continue;
    if (sku && sku === v) out.push({ type, value, where: 'retailer id', exact: true });
    else if (url.includes(v)) out.push({ type, value, where: 'url', exact: true });
    else if (titleWords.has(v) || (v.length >= 8 && titleCompact.includes(v))) out.push({ type, value, where: 'title', exact: true });
    else if (type === 'MPN' && v.length >= 8) {
      // "65QNED75B" in the title for model 65QNED75BUA: the base model without the region suffix.
      const base = [...titleWords].find((w) => w.length >= 6 && w.length >= v.length - 3 && v.startsWith(w));
      if (base) out.push({ type, value, where: 'title', exact: false });
    }
  }
  return out;
}

function identifierSignal(found: Found['identifiers']): SignalResult {
  const w = WEIGHTS.identifier;
  const strong = found.find((f) => f.exact && ['ASIN', 'UPC', 'EAN'].includes(f.type));
  const exact = strong ?? found.find((f) => f.exact);
  if (exact) return { signal: 'identifier', score: 1, weight: w, passed: true, detail: `${exact.type} ${exact.value} in the ${exact.where}` };
  const partial = found.find((f) => !f.exact);
  if (partial) return { signal: 'identifier', score: 0.6, weight: w, passed: true, detail: `base model of ${partial.value} in the title (suffix missing)` };
  return { signal: 'identifier', score: 0, weight: w, passed: false, detail: 'no identifier of this product found' };
}

function titleSignal(c: CandidateInput, p: ProductRef): SignalResult {
  if (!c.title) return { signal: 'title', score: null, weight: WEIGHTS.title, passed: null, detail: 'no title captured' };
  const s = titleSimilarity(c.title, p);
  return { signal: 'title', score: s, weight: WEIGHTS.title, passed: s >= 0.6, detail: `${Math.round(s * 100)}% of the product name` };
}

function priceSignal(c: CandidateInput, p: ProductRef): { signal: SignalResult; depth: number } {
  const w = WEIGHTS.price;
  const ref = p.map ?? p.msrp;
  const refName = p.map ? 'MAP' : 'MSRP';
  if (c.price === null || c.price <= 0) return { signal: { signal: 'price', score: null, weight: w, passed: null, detail: 'no price captured' }, depth: 0 };
  if (!ref) return { signal: { signal: 'price', score: null, weight: w, passed: null, detail: 'no MAP or MSRP to compare with' }, depth: 0 };
  const ratio = c.price / ref;
  const pct = Math.round((ratio - 1) * 1000) / 10;
  const detail = `${c.price.toFixed(2)} vs ${refName} ${ref.toFixed(2)} (${pct > 0 ? '+' : ''}${pct}%)`;
  // This asks "could this be the product?", not "is it compliant?": deep discounts are exactly
  // the MAP violations to catch, so only prices far from the product's range count against it.
  let score: number;
  if (ratio >= 0.55 && ratio <= 1.25) score = 1;
  else if (ratio >= 0.4 && ratio < 0.55) score = 0.6;
  else if (ratio > 1.25 && ratio <= 1.6) score = 0.6;
  else score = 0.05; // far off: a part, an accessory, a bundle or a different product
  return { signal: { signal: 'price', score, weight: w, passed: score >= 0.6, detail: score >= 0.6 ? `plausible: ${detail}` : `implausible: ${detail}` }, depth: Math.max(0, 1 - ratio) };
}

export function detectAttributes(c: CandidateInput, p: ProductRef): Omit<Found, 'identifiers'> {
  const text = `${c.title ?? ''} ${c.condition ?? ''}`;
  const condition = (c.condition && !/^new$/i.test(c.condition.trim()) ? c.condition.trim().toLowerCase() : null) ?? CONDITION_RE.exec(c.title ?? '')?.[1]?.toLowerCase() ?? null;
  const bundle = BUNDLE_RE.exec(c.title ?? '')?.[0] ?? null;
  const accessory = ACCESSORY_RE.exec(c.title ?? '')?.[0] ?? null;

  let variant: string | null = null;
  const productText = `${p.name} ${p.model ?? ''}`;
  const mine = values(SIZE_RE, productText);
  const theirs = values(SIZE_RE, text);
  if (mine.size && theirs.size && ![...theirs].some((s) => mine.has(s))) variant = `size ${[...theirs].join('/')}" vs ${[...mine].join('/')}"`;
  const myCap = values(CAPACITY_RE, productText);
  const theirCap = values(CAPACITY_RE, text);
  if (!variant && myCap.size && theirCap.size && ![...theirCap].some((s) => myCap.has(s))) variant = `capacity ${[...theirCap].join('/')} vs ${[...myCap].join('/')}`;
  const pc = COLOURS.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(productText));
  const tc = COLOURS.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(c.title ?? ''));
  if (!variant && pc.length && tc.length && !tc.some((k) => pc.includes(k))) variant = `colour ${tc.join('/')} vs ${pc.join('/')}`;
  return { condition, bundle, accessory, variant };
}

function attributesSignal(a: Omit<Found, 'identifiers'>): SignalResult {
  const w = WEIGHTS.attributes;
  if (a.condition) return { signal: 'attributes', score: 0, weight: w, passed: false, detail: `condition: ${a.condition}` };
  if (a.accessory) return { signal: 'attributes', score: 0, weight: w, passed: false, detail: `accessory or part ("${a.accessory}")` };
  if (a.variant) return { signal: 'attributes', score: 0.1, weight: w, passed: false, detail: `different variant: ${a.variant}` };
  if (a.bundle) return { signal: 'attributes', score: 0.3, weight: w, passed: false, detail: `bundle or multipack ("${a.bundle}")` };
  return { signal: 'attributes', score: 1, weight: w, passed: true, detail: 'new, single unit, same variant' };
}

function priorSignal(labels: PriorLabel[], productId: string): SignalResult {
  const w = WEIGHTS.prior;
  const url = labels.find((l) => l.sameUrl);
  if (url) {
    const same = url.productId === productId;
    if (url.state === 'Included' && same) return { signal: 'prior', score: 1, weight: w, passed: true, detail: 'this URL was included as this product before' };
    if (url.state === 'Included') return { signal: 'prior', score: 0.2, weight: w, passed: false, detail: 'this URL was included as a different product before' };
    return { signal: 'prior', score: 0, weight: w, passed: false, detail: 'this URL was excluded before' };
  }
  const sp = labels.filter((l) => !l.sameUrl && l.productId === productId);
  if (sp.length) {
    const inc = sp.filter((l) => l.state === 'Included').length;
    const score = Math.round((0.3 + 0.6 * (inc / sp.length)) * 1000) / 1000;
    return { signal: 'prior', score, weight: w, passed: inc >= sp.length / 2, detail: `seller + product: ${inc} of ${sp.length} earlier decisions included` };
  }
  return { signal: 'prior', score: null, weight: w, passed: null, detail: 'no earlier decision on this URL or seller + product' };
}

// ---------------------------------------------------------------------------
// Product choice and confidence
// ---------------------------------------------------------------------------

/** The product this candidate most likely is: identifiers first, then title similarity. */
export function proposeProduct(c: CandidateInput, products: ProductRef[], preferred?: string | null): ProductRef | null {
  if (preferred) {
    const p = products.find((x) => x.id === preferred);
    if (p) return p;
  }
  let best: { p: ProductRef; score: number } | null = null;
  for (const p of products) {
    const ids = findIdentifiers(c, p);
    const idScore = ids.some((i) => i.exact) ? 2 : ids.length ? 1.2 : 0;
    const score = idScore + (c.title ? titleSimilarity(c.title, p) : 0);
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score >= 0.25 ? best.p : null;
}

export function bandFor(confidence: number, t: Thresholds): MatchResult['band'] {
  if (confidence >= t.include) return 'include';
  if (confidence >= t.review) return 'review';
  return 'exclude';
}

/**
 * Score a candidate against a product. Hard limits keep the bands honest: a used, refurbished
 * or accessory listing can never be auto-included, and a variant or bundle always gets a
 * human look; an exact retailer identifier on a clean listing is auto-included.
 */
export function scoreCandidate(c: CandidateInput, product: ProductRef | null, labels: PriorLabel[], t: Thresholds): MatchResult {
  const attrs = product ? detectAttributes(c, product) : { condition: null, bundle: null, accessory: null, variant: null };
  if (!product) {
    const signals: SignalResult[] = SIGNALS.map((s) => ({
      signal: s, score: s === 'identifier' || s === 'title' ? 0 : null, weight: WEIGHTS[s], passed: s === 'identifier' || s === 'title' ? false : null,
      detail: s === 'identifier' || s === 'title' ? 'no product in the catalogue resembles this listing' : 'not scored: no proposed product',
    }));
    return { productId: null, confidence: 0, band: 'exclude', signals, found: { identifiers: [], ...attrs }, depth: 0, priority: 100 };
  }
  const identifiers = findIdentifiers(c, product);
  const price = priceSignal(c, product);
  const signals: SignalResult[] = [
    identifierSignal(identifiers),
    titleSignal(c, product),
    { signal: 'image', score: null, weight: WEIGHTS.image, passed: null, detail: c.imageUrl ? 'image comparison not available yet' : 'no image captured' },
    price.signal,
    attributesSignal(attrs),
    priorSignal(labels, product.id),
  ];
  const available = signals.filter((s) => s.score !== null);
  const total = available.reduce((a, s) => a + s.weight, 0);
  // Record the weight each signal actually carried after missing ones were shared out.
  for (const s of signals) s.weight = s.score === null || !total ? 0 : Math.round((s.weight / total) * 10000) / 100;
  let confidence = total ? available.reduce((a, s) => a + (s.score as number) * s.weight, 0) : 0;

  const idExact = signals[0].score === 1;
  const strongId = identifiers.some((i) => i.exact && ['ASIN', 'UPC', 'EAN'].includes(i.type));
  const clean = !attrs.condition && !attrs.accessory && !attrs.variant && !attrs.bundle;
  const priorExcluded = labels.some((l) => l.sameUrl && l.state === 'Excluded');
  if (attrs.condition || attrs.accessory || priorExcluded) confidence = Math.min(confidence, t.review - 1);
  else if (attrs.variant || attrs.bundle) confidence = Math.min(confidence, t.include - 1);
  else if (clean && strongId) confidence = Math.max(confidence, Math.max(t.include, 92));
  else if (clean && idExact && (signals[1].score ?? 0) >= 0.4) confidence = Math.max(confidence, t.include);
  confidence = Math.round(Math.max(0, Math.min(100, confidence)) * 100) / 100;

  return {
    productId: product.id,
    confidence,
    band: bandFor(confidence, t),
    signals,
    found: { identifiers, ...attrs },
    depth: Math.round(price.depth * 1000) / 1000,
    priority: Math.round((100 - confidence) * (1 + price.depth) * 1000) / 1000,
  };
}
