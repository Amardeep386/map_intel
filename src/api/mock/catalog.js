// In-memory stand-in for the Phase 2a catalogue, sellers and mapping API (VITE_USE_MOCK=true).
// Same response shapes as server/src/api/routes/{catalogue,policies,sellers,mapping}.ts. The
// Mapping Center runs the real matcher on the same synthetic candidates the server generator
// makes (server/src/lib/*.ts are plain functions, bundled here for the demo).
import { generateCandidates, defaultBasePrice } from "../../../server/src/lib/synthetic.ts";
import { proposeProduct, scoreCandidate } from "../../../server/src/lib/matching.ts";
import { decide, suppressionHits } from "../../../server/src/lib/matchRules.ts";
import { mockWorkspace } from "./data.js";

const RULES = [
  ["EXC-CONDITION", "Used, refurbished, renewed or open box", "exclude", { type: "condition", values: ["used", "refurbished", "renewed", "open box", "pre-owned", "for parts"] }, "Used or refurbished", 10],
  ["EXC-WAREHOUSE", "Warehouse deals and resale programmes", "exclude", { type: "seller_or_title", patterns: ["amazon warehouse", "warehouse deal", "amazon resale", "renewed premium"] }, "Used or refurbished", 20],
  ["EXC-AUCTION", "Auctions", "exclude", { type: "listing_format", values: ["auction"] }, "Not a purchasable offer", 30],
  ["INC-ASIN-URL", "ASIN in the URL is the product's ASIN", "include", { type: "identifier_in_url", identifier: "ASIN" }, null, 50],
  ["INC-MPN", "Model number (MPN) in the URL or title", "include", { type: "identifier_in_url_or_title", identifier: "MPN" }, null, 60],
  ["INC-ATTRIBUTES", "Identifier found and attributes match (new, single unit, same variant)", "include", { type: "attribute_match", minTitle: 0.5 }, null, 70],
].map(([code, name, kind, condition, reason, priority]) => ({ id: code, code, name, kind, condition, reason, priority, active: true, is_default: true, hits: 0 }));

export const REASONS = ["Wrong product", "Wrong variant", "Used or refurbished", "Bundle or multipack", "Accessory or part", "Out of region", "Not a purchasable offer", "Brand direct"];
const SCOPES = [
  { id: "listing", label: "This listing" }, { id: "seller_product", label: "Seller + product" },
  { id: "url_pattern", label: "URL pattern" }, { id: "source", label: "Source" },
];
const SOURCE_NAMES = { amazon_us: "Amazon", walmart_us: "Walmart", bestbuy_us: "Best Buy", ebay_us: "eBay", target_us: "Target", homedepot_us: "Home Depot" };

const state = {};
let seq = 1;
const id = (p = "m") => `${p}-${seq++}`;
const now = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

function account(client) {
  if (state[client.name]) return state[client.name];
  const skus = mockWorkspace(client.name).skus;
  const products = skus.map((s) => ({
    id: s.id, code: s.id, name: s.name, brand: client.name, model: s.model || null, category: s.category || null, group: null,
    msrp: s.msrp ?? null, status: s.status || "Active", upc: s.upc || null, ean: null, asin: null, alts: [null, null, null, null, null, null],
  }));
  const maps = products.filter((_, i) => skus[i].map).map((p, i) => ({
    id: id("map"), productId: p.id, amount: skus.find((s) => s.id === p.id).map, region: null, from: "2026-01-15T05:00:00Z", to: null, source: "import", importSeq: 1, note: null, i,
  }));
  const a = { products, maps, promos: [], policies: [], imports: [], sellers: [], listings: [], suppressions: [], rules: clone(RULES), events: [] };
  state[client.name] = a;
  seedCandidates(a, 120);
  return a;
}

// ---------- mapping ----------
function refs(a) {
  return a.products.filter((p) => p.status !== "Retired").map((p) => ({
    id: p.id, code: p.code, name: p.name, brand: p.brand, model: p.model, msrp: p.msrp, map: mapNow(a, p.id), market: null,
    identifiers: [p.upc && { type: "UPC", value: p.upc }, p.asin && { type: "ASIN", value: p.asin }].filter(Boolean),
    asin: p.asin, category: p.category, basePrice: mapNow(a, p.id) ?? p.msrp ?? defaultBasePrice(p.name, p.category),
  }));
}

function sellerFor(a, name, sourceCode) {
  let s = a.sellers.find((x) => x.name === name && x.source_code === sourceCode);
  if (!s) {
    s = { id: id("sel"), name, source_code: sourceCode, source: SOURCE_NAMES[sourceCode], platform_seller_id: null, storefront_url: null, first_seen: now(),
      history: [{ id: id("cls"), class: "Unknown", from: now(), to: null, note: "First seen", set_by: "System" }], aliases: [], links: [], contacts: [] };
    a.sellers.push(s);
  }
  return s;
}

function stage(a, c, origin = "synthetic") {
  const products = refs(a);
  const input = { url: c.url, title: c.title, price: c.price, channelSku: c.channelSku ?? null, sellerName: c.sellerName, condition: c.condition ?? null, format: c.format ?? null, imageUrl: null };
  const seller = c.sellerName ? sellerFor(a, c.sellerName, c.sourceCode) : null;
  let l = a.listings.find((x) => x.url === c.url);
  const labels = [];
  if (l?.decided_by === "user" && (l.state === "Included" || l.state === "Excluded")) labels.push({ productId: l.product_id, state: l.state, sameUrl: true });
  const r = scoreCandidate(input, proposeProduct(input, products, c.productId), labels, { include: 90, review: 60 });
  const sups = a.suppressions.filter((s) => !s.revoked_at).map((s) => ({ ...s, listingId: s.listing_id, sellerId: s.seller_id, sellerName: s.seller_name, productId: s.product_id, sourceId: s.source_code, urlPattern: s.url_pattern }));
  const d = decide({ listingId: l?.id ?? "new", sourceId: c.sourceCode, sellerId: seller?.id ?? null, input }, r, a.rules, sups);
  const p = products.find((x) => x.id === r.productId);
  const base = {
    url: c.url, origin, channel_sku: c.channelSku ?? null, source_code: c.sourceCode, source: SOURCE_NAMES[c.sourceCode], seller: c.sellerName, seller_id: seller?.id ?? null,
    confidence: r.confidence, priority: r.priority, title: c.title, price: c.price, condition: c.condition ?? null, listing_format: c.format ?? null, seen_at: now(),
    signals: r.signals, candidate_product: p ? { id: p.id, code: p.code, name: p.name, model: p.model, msrp: p.msrp, map: p.map, upc: null, asin: p.asin } : null,
  };
  if (l && l.decided_by === "user" && (l.state === "Included" || l.state === "Excluded")) return Object.assign(l, base);
  const from = l?.state ?? null;
  l ??= { id: id("lst"), history: [] };
  const rule = a.rules.find((x) => x.id === d.ruleId);
  if (rule) rule.hits++;
  const sup = a.suppressions.find((x) => x.id === d.suppressionId);
  if (sup) sup.hits++;
  Object.assign(l, base, {
    state: d.state, decided_by: d.decidedBy, reason: d.reason, scope: null, rule_code: rule?.code ?? null, suppression_id: d.suppressionId,
    product_id: r.productId, product_code: p?.code ?? null, product_name: p?.name ?? null, state_since: now(),
    decided_label: { auto: "Matcher", rule: "Auto Rule", suppression: "Suppression" }[d.decidedBy] ?? null,
  });
  if (from !== d.state) l.history.unshift({ from_state: from, to_state: d.state, actor_type: d.decidedBy === "pending" ? "auto" : d.decidedBy, actor_label: rule ? `Rule ${rule.code}` : l.decided_label ?? "Matcher", reason: d.reason, scope: null, confidence: r.confidence, is_label: false, created_at: now(), product_code: p?.code ?? null });
  if (!a.listings.includes(l)) a.listings.push(l);
  return l;
}

function seedCandidates(a, count) {
  for (const c of generateCandidates(refs(a), count, 1)) stage(a, c);
}

const listingView = (l) => {
  const { history, signals, candidate_product, ...rest } = l;
  void history; void signals; void candidate_product;
  return { ...rest, product_id: l.product_id };
};

export const mockCatalog = {
  // ---------- products ----------
  products(client, { retired } = {}) {
    const a = account(client);
    return a.products.filter((p) => retired || p.status !== "Retired").map((p) => ({
      ...p, map: mapNow(a, p.id), current: null, violations: 0, listings: a.listings.filter((l) => l.product_id === p.id && l.state === "Included").length, offers: [],
    }));
  },
  product(client, productId) {
    const a = account(client);
    const p = this.products(client, { retired: true }).find((x) => x.id === productId);
    const mine = a.maps.filter((m) => m.productId === productId).sort((x, y) => (x.from < y.from ? 1 : -1));
    return {
      ...p,
      mapHistory: mine.map((m, i) => ({ ...m, version: mine.length - i, importCode: m.importSeq ? `IMP-${String(m.importSeq).padStart(3, "0")}` : null })),
      includedListings: a.listings.filter((l) => l.product_id === productId && l.state === "Included").map((l) => ({ id: l.id, url: l.url, source: l.source, seller: l.seller, state: l.state, confidence: l.confidence, state_since: l.state_since, candidate_price: l.price })),
    };
  },
  addProduct(client, body) {
    const a = account(client);
    if (a.products.some((p) => p.code.toLowerCase() === body.code.toLowerCase())) throw new Error(`SKU ${body.code} already exists`);
    const p = { id: body.code, code: body.code, name: body.name, brand: client.name, model: body.model, category: body.category || null, group: body.group || null, msrp: body.msrp ?? null, status: "Active", upc: body.upc || null, ean: body.ean || null, asin: body.asin || null, alts: [...(body.alts ?? []), null, null, null, null, null, null].slice(0, 6) };
    a.products.push(p);
    if (body.map) a.maps.push({ id: id("map"), productId: p.id, amount: body.map, region: null, from: now(), to: null, source: "manual" });
    return this.products(client, { retired: true }).find((x) => x.id === p.id);
  },
  updateProduct(client, productId, body) {
    const a = account(client);
    const p = a.products.find((x) => x.id === productId);
    for (const k of ["name", "model", "category", "group", "msrp", "status", "upc", "ean", "asin"]) if (body[k] !== undefined) p[k] = body[k];
    if (body.alts) body.alts.forEach((v, i) => { if (v !== undefined) p.alts[i] = v || null; });
    return this.products(client, { retired: true }).find((x) => x.id === productId);
  },

  // ---------- imports (mock: accepted as-is, no file parsing) ----------
  importFile(client, kind, body) {
    const a = account(client);
    const summary = kind === "map" ? { newVersions: 0, unchanged: 0, unknownSkus: 0, errors: 0 } : kind === "products" ? { new: 0, changed: 0, unchanged: 0, errors: 0 } : { newListings: 0, alreadyKnown: 0, errors: 0 };
    const res = { fileName: body.fileName, header: [], fields: [], mapping: {}, rows: 0, preview: [], dryRun: body.dryRun, summary, changes: [], problems: [{ line: 1, reason: "Demo mode: imports need the MAP Intel API (VITE_USE_MOCK=false)." }] };
    void a;
    return res;
  },
  imports() { return []; },

  // ---------- MAP policies ----------
  mapPrices(client) {
    const a = account(client);
    const t = new Date();
    return a.maps.map((m) => {
      const p = a.products.find((x) => x.id === m.productId);
      const versions = a.maps.filter((x) => x.productId === m.productId && x.region === m.region).sort((x, y) => (x.from < y.from ? -1 : 1));
      const inForce = new Date(m.from) <= t && (!m.to || new Date(m.to) > t);
      return { ...m, code: p.code, product: p.name, version: versions.indexOf(m) + 1, status: inForce ? "In force" : new Date(m.from) > t ? "Scheduled" : "Superseded", sourceLabel: m.importSeq ? `Import IMP-${String(m.importSeq).padStart(3, "0")}` : "Manual" };
    }).sort((x, y) => (x.code === y.code ? (x.from < y.from ? 1 : -1) : x.code < y.code ? -1 : 1));
  },
  addMapVersion(client, productId, body) {
    const a = account(client);
    const open = a.maps.find((m) => m.productId === productId && m.region === (body.region || null) && !m.to);
    const from = `${body.from}T05:00:00Z`;
    if (open && from <= open.from) throw new Error("a new version must start after the MAP in force");
    if (open) open.to = from;
    a.maps.push({ id: id("map"), productId, amount: Number(body.amount), region: body.region || null, from, to: null, source: "manual", note: body.note || null });
    return { ok: true };
  },
  promos(client) {
    const t = new Date();
    return account(client).promos.map((w) => ({ ...w, status: w.cancelled_at ? "Cancelled" : new Date(w.from) > t ? "Scheduled" : new Date(w.to) <= t ? "Expired" : "Active" }));
  },
  addPromo(client, body) {
    const a = account(client);
    const code = `PW-${String(a.promos.length + 1).padStart(3, "0")}`;
    a.promos.unshift({
      id: id("pw"), code, name: body.name, from: `${body.from}T05:00:00Z`, to: `${body.to}T05:00:00Z`, note: body.note ?? null, cancelled_at: null,
      products: body.products.map((x) => { const p = a.products.find((q) => q.id === x.productId); return { productId: p.id, code: p.code, name: p.name, promoAmount: x.promoAmount, standard: mapNow(a, p.id), msrp: p.msrp }; }),
      sellers: body.sellerIds.map((sid) => ({ id: sid, name: a.sellers.find((s) => s.id === sid)?.name })), appliesTo: body.sellerIds.length ? body.sellerIds.map((sid) => a.sellers.find((s) => s.id === sid)?.name).join(", ") : "All sellers",
    });
    return { code };
  },
  cancelPromo(client, promoId) {
    account(client).promos.find((w) => w.id === promoId).cancelled_at = now();
    return { ok: true };
  },
  policies(client) { return account(client).policies; },
  uploadPolicy(client, body) {
    const a = account(client);
    const prev = a.policies.filter((d) => d.name.toLowerCase() === body.name.toLowerCase());
    for (const d of prev) if (d.status === "In force") { d.status = "Superseded"; d.effective_to = `${body.effectiveFrom}T05:00:00Z`; }
    a.policies.unshift({ id: id("doc"), name: body.name, version: prev.length + 1, effective_from: `${body.effectiveFrom}T05:00:00Z`, effective_to: null, file_name: body.fileName, bytes: Math.round(body.content.length * 0.75), sha256: "demo-mode-no-hash".padEnd(64, "0"), uploaded_at: now(), uploaded_by: "you (demo)", status: "In force" });
    return { version: prev.length + 1 };
  },
  policyDownload() { throw new Error("Downloads need the MAP Intel API (VITE_USE_MOCK=false)."); },

  // ---------- sellers ----------
  sellers(client) {
    const a = account(client);
    return a.sellers.map((s) => ({
      id: s.id, name: s.name, source: s.source, source_code: s.source_code, classification: s.history[0].class, class_since: s.history[0].from,
      tracked: new Set(a.listings.filter((l) => l.seller_id === s.id && l.state === "Included").map((l) => l.product_id)).size,
      listings: a.listings.filter((l) => l.seller_id === s.id).length, aliases: s.aliases.length, contacts: s.contacts.length,
    })).sort((x, y) => x.name.localeCompare(y.name));
  },
  seller(client, sellerId) {
    const a = account(client);
    const s = a.sellers.find((x) => x.id === sellerId);
    return { ...clone(s), classification: s.history[0].class, listings: a.listings.filter((l) => l.seller_id === s.id).map((l) => ({ id: l.id, url: l.url, state: l.state, code: l.product_code, product: l.product_name })) };
  },
  addSeller(client, body) {
    const a = account(client);
    if (a.sellers.some((s) => s.name.toLowerCase() === body.name.toLowerCase() && s.source_code === body.source)) throw new Error("this seller is already on the list: change its classification instead");
    const s = sellerFor(a, body.name, body.source);
    s.history[0] = { id: id("cls"), class: body.class || "Unknown", from: now(), to: null, note: body.note || "Added manually", set_by: "you (demo)" };
    return { id: s.id };
  },
  classifySeller(client, sellerId, body) {
    const s = account(client).sellers.find((x) => x.id === sellerId);
    if (s.history[0].class === body.class) throw new Error(`${s.name} is already ${body.class}`);
    s.history[0].to = now();
    s.history.unshift({ id: id("cls"), class: body.class, from: now(), to: null, note: body.note, set_by: "you (demo)" });
    return { ok: true };
  },
  addAlias(client, sellerId, body) { account(client).sellers.find((x) => x.id === sellerId).aliases.push({ id: id("al"), alias: body.alias }); return { ok: true }; },
  linkSeller(client, sellerId, body) {
    const a = account(client);
    const o = a.sellers.find((x) => x.id === body.otherSellerId);
    a.sellers.find((x) => x.id === sellerId).links.push({ id: id("lk"), reason: body.reason, confidence: body.confidence, seller_id: o.id, name: o.name, source: o.source });
    return { ok: true };
  },
  addContact(client, sellerId, body) { account(client).sellers.find((x) => x.id === sellerId).contacts.push({ id: id("ct"), ...body, created_at: now() }); return { ok: true }; },
  removeContact(client, sellerId, contactId) {
    const s = account(client).sellers.find((x) => x.id === sellerId);
    s.contacts = s.contacts.filter((c) => c.id !== contactId);
    return null;
  },

  // ---------- mapping ----------
  mappingSummary(client) {
    const a = account(client);
    const count = (st) => a.listings.filter((l) => l.state === st).length;
    return {
      states: { Staged: count("Staged"), Included: count("Included"), Excluded: count("Excluded"), Retired: count("Retired") },
      today: {
        staged_today: a.listings.length,
        auto_included: a.listings.filter((l) => l.state === "Included" && ["auto", "rule"].includes(l.decided_by)).length,
        auto_excluded: a.listings.filter((l) => l.state === "Excluded" && ["auto", "rule", "suppression"].includes(l.decided_by)).length,
        decided_today: a.listings.filter((l) => l.decided_by === "user").length,
      },
      suppressions: a.suppressions.filter((s) => !s.revoked_at).length,
      thresholds: { include: 90, review: 60 },
      reasons: REASONS,
      scopes: SCOPES,
    };
  },
  mappingQueue(client) {
    const items = account(client).listings.filter((l) => l.state === "Staged").sort((x, y) => y.priority - x.priority);
    return { total: items.length, items: items.slice(0, 50).map((l) => ({ ...listingView(l), signals: l.signals, proposed: l.candidate_product, candidate_id: l.id })) };
  },
  mappingListings(client, { state: st = "Staged", q = "" } = {}) {
    const needle = q.toLowerCase();
    const items = account(client).listings
      .filter((l) => l.state.toLowerCase() === st.toLowerCase())
      .filter((l) => !needle || [l.url, l.title, l.seller, l.product_code, l.product_name].some((x) => (x ?? "").toLowerCase().includes(needle)))
      .sort((x, y) => (st === "Staged" ? y.priority - x.priority : x.state_since < y.state_since ? 1 : -1));
    return { total: items.length, items: items.slice(0, 100).map(listingView) };
  },
  mappingListing(client, listingId) {
    const l = account(client).listings.find((x) => x.id === listingId);
    return { ...listingView(l), signals: l.signals, history: l.history };
  },
  mappingDecide(client, body) {
    const a = account(client);
    const rows = a.listings.filter((l) => body.listingIds.includes(l.id));
    if (body.action === "exclude" && !body.reason) throw new Error("an exclusion needs a reason");
    const label = (l, to, reason, scope) => {
      l.history.unshift({ from_state: l.state, to_state: to, actor_type: "user", actor_label: "you (demo)", reason, scope, confidence: l.confidence, is_label: true, created_at: now(), product_code: l.product_code });
      Object.assign(l, { state: to, decided_by: "user", decided_label: "you (demo)", reason, scope, state_since: now() });
    };
    let suppression = null;
    for (const l of rows) {
      if (body.action === "include") {
        const p = a.products.find((x) => x.id === (body.productId ?? l.product_id));
        if (!p) throw new Error("choose the product to include this listing as");
        Object.assign(l, { product_id: p.id, product_code: p.code, product_name: p.name });
        label(l, "Included", body.productId && body.productId !== l.product_id ? "Assigned to another SKU" : "Included", null);
      } else if (body.action === "exclude") label(l, "Excluded", body.reason, body.scope ?? "listing");
      else if (body.action === "restore") label(l, "Staged", "Restored for review", null);
      else label(l, "Retired", "Retired by an analyst", null);
    }
    if (body.action === "exclude" && body.scope && body.scope !== "listing") {
      const l = rows[0];
      const s = {
        id: id("sup"), code: `SUP-${String(a.suppressions.length + 1).padStart(3, "0")}`, reason: body.reason, scope: body.scope, listing_id: l.id,
        seller_id: body.scope === "seller_product" ? l.seller_id : null, seller_name: null, product_id: body.scope === "seller_product" ? l.product_id : null,
        source_code: body.scope === "source" ? l.source_code : null, url_pattern: body.scope === "url_pattern" ? body.urlPattern : null,
        hits: 1, created_at: now(), created_by: "you (demo)", revoked_at: null, scopeLabel: SCOPES.find((x) => x.id === body.scope).label,
        rule: body.scope === "seller_product" ? `${l.seller} × ${l.product_code}` : body.scope === "url_pattern" ? body.urlPattern : body.scope === "source" ? `Everything on ${l.source}` : l.url,
      };
      a.suppressions.unshift(s);
      let also = 0;
      for (const o of a.listings.filter((x) => x.state === "Staged")) {
        const hit = suppressionHits({ ...s, listingId: s.listing_id, sellerId: s.seller_id, sellerName: null, productId: s.product_id, sourceId: s.source_code, urlPattern: s.url_pattern },
          { listingId: o.id, sourceId: o.source_code, sellerId: o.seller_id, input: { url: o.url, title: o.title, sellerName: o.seller } }, o.product_id);
        if (hit) { Object.assign(o, { state: "Excluded", decided_by: "suppression", decided_label: "Suppression", reason: `${s.reason} (suppression ${s.code})`, state_since: now() }); also++; }
      }
      s.hits += also;
      suppression = { id: s.id, code: s.code, alsoExcluded: also };
    }
    return { updated: rows.length, suppression };
  },
  applyRules(client) {
    const a = account(client);
    const staged = a.listings.filter((l) => l.state === "Staged");
    const out = { checked: staged.length, included: 0, excluded: 0, staged: 0 };
    for (const l of staged) {
      const r = stage(a, { url: l.url, title: l.title, price: l.price, sellerName: l.seller, sourceCode: l.source_code, condition: l.condition, format: l.listing_format, channelSku: l.channel_sku }, l.origin);
      out[r.state === "Included" ? "included" : r.state === "Excluded" ? "excluded" : "staged"]++;
    }
    return out;
  },
  matchRules(client) { return account(client).rules; },
  setRule(client, ruleId, body) { account(client).rules.find((r) => r.id === ruleId).active = body.active; return { ok: true }; },
  suppressions(client) { return account(client).suppressions; },
  revokeSuppression(client, suppressionId) { account(client).suppressions.find((s) => s.id === suppressionId).revoked_at = now(); return { ok: true }; },
};

function mapNow(a, productId) {
  const t = new Date();
  return a.maps.find((m) => m.productId === productId && !m.region && new Date(m.from) <= t && (!m.to || new Date(m.to) > t))?.amount ?? null;
}
