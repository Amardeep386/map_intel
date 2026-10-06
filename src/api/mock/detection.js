// Mock-mode stand-in for Phase 3 detection: the same shapes as GET /accounts/:id/violations,
// /violations/:id and POST /violations/:id/status, so the screens work without the backend.
import { demoFor } from "./demo.js";

const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const DEPTHS = [6.9, 14.3, 4.7, 18.8, 3.3, 9.1, 23.2, 2.4, 11.6, 5.5];
const STATUS = ["Open", "Open", "Needs review", "Under notice", "Open", "Resolved", "Dismissed", "Open"];
const CLASSES = ["Unauthorised", "Unknown", "MAP Authorised", "Unauthorised"];
const SOURCES = [["walmart_us", "Walmart.com"], ["ebay_us", "eBay"], ["bestbuy_us", "Best Buy"]];
const severityOf = (d) => (d < 5 ? "Minor" : d > 15 ? "Severe" : "Standard");

const store = new Map(); // client name -> violations

function seed(clientName) {
  const { products, merchants } = demoFor(clientName);
  const sellers = merchants.filter((m) => m.track && m.channelType !== "Price comparison");
  const out = [];
  products.filter((p) => p.status === "Active" && p.map).forEach((p, i) => {
    if (i % 4 !== 0 || !sellers.length) return;
    const k = out.length;
    const depth = DEPTHS[k % DEPTHS.length];
    const status = STATUS[k % STATUS.length];
    const [source_code, source] = SOURCES[k % SOURCES.length];
    const price = Math.round(p.map * (1 - depth / 100) * 100) / 100;
    const opened = ago(2 + (k % 9));
    const closed = status === "Resolved";
    const id = `mock-v-${clientName}-${k}`;
    out.push({
      id, seq: k + 1, code: `V-${String(k + 1).padStart(5, "0")}`, status, status_at: ago(1), status_reason: status === "Dismissed" ? "Bundle, not the product" : null,
      severity: severityOf(depth), last_severity: severityOf(depth), opened_at: opened, last_seen: ago(closed ? 1 : 0.2), closed_at: closed ? ago(1) : null,
      episode_closed: closed, observations: 1 + (k % 5), last_price: price, last_map: p.map, last_depth_abs: Math.round((p.map - price) * 100) / 100,
      last_depth_pct: depth, max_depth_pct: depth, class_at_capture: CLASSES[k % CLASSES.length], sku: p.sku, product: p.name,
      seller: sellers[k % sellers.length].name, source_code, source, url: null, title: p.name, rule: "R-01 v1", evidence_id: null,
      events: [
        { id: `${id}-e1`, status: "Open", reason: null, created_at: opened, actor: "System", observed_at: opened },
        ...(status !== "Open" ? [{ id: `${id}-e2`, status, reason: status === "Resolved" ? "Compliant observation" : null, created_at: ago(1), actor: status === "Resolved" ? "System" : "analyst@mirethos.com", observed_at: null }] : []),
      ],
      history: Array.from({ length: 1 + (k % 5) }, (_, j) => ({
        observation_id: `${id}-o${j}`, observed_at: ago(j), price, map: p.map, promo: null, depth_pct: depth, outcome: "violation", severity: severityOf(depth),
        class_at_capture: CLASSES[k % CLASSES.length], in_violation: true, evidence_id: null,
      })),
      policy: { name: `${clientName} US Unilateral MAP Policy`, version: 2, effective_from: "2026-07-01T00:00:00Z" },
    });
  });
  return out;
}

const all = (client) => {
  if (!store.has(client.name)) store.set(client.name, seed(client.name));
  return store.get(client.name);
};

export const mockDetection = {
  async violations(client, f = {}) {
    const statuses = f.status ? f.status.split(",") : null;
    const q = (f.q || "").toLowerCase();
    const rows = all(client).filter((v) =>
      (!statuses || statuses.includes(v.status)) &&
      (!f.severity || f.severity.split(",").includes(v.severity)) &&
      (!f.source || v.source_code === f.source) &&
      (f.active === undefined || String(!v.episode_closed) === String(f.active)) &&
      (!q || `${v.code} ${v.sku} ${v.product} ${v.seller}`.toLowerCase().includes(q)));
    const counts = {};
    for (const v of all(client)) counts[v.status] = (counts[v.status] || 0) + 1;
    return { total: rows.length, rows, counts };
  },
  async violation(client, id) {
    const v = all(client).find((x) => x.id === id);
    if (!v) throw new Error("violation not found");
    return v;
  },
  async setViolationStatus(client, id, { status, reason }) {
    const v = all(client).find((x) => x.id === id);
    if (v.episode_closed) throw new Error("this violation has ended; a new breach opens a new violation");
    if (["Dismissed", "Resolved", "Authorised promo"].includes(status) && !reason) throw new Error(`${status} needs a reason`);
    v.status = status;
    v.status_reason = reason || null;
    v.episode_closed = status === "Resolved";
    v.events = [...v.events, { id: `${id}-e${v.events.length + 1}`, status, reason: reason || null, created_at: new Date().toISOString(), actor: "you (sample data)" }];
    return v;
  },
};
