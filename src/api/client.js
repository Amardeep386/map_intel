// API client layer for the MAP Intel portal.
//
// Every screen reads and writes through this module. Each function either calls the backend
// (server/) or returns mock data for screens whose backend lands in a later phase.
//
//   VITE_USE_MOCK=true  (default)  -> everything comes from ./mock/data.js, no backend needed
//   VITE_USE_MOCK=false            -> login, clients (accounts) and products come from the API;
//                                     screens not built yet still return mock data
//   VITE_API_URL                   -> backend base URL (default http://localhost:4000)
//
// Phase map for the mock parts: violations/overview/reports/alerts -> P3, enforcement/emails -> P4,
// sellers/mapping/promotions -> P2a, users/audit/settings -> P1.

import {
  ALERT_EVENTS, ALERTS, AUDIT_LOG, CLIENTS, EMAILS, REPORTS, SEVERITY_DIST, TREND, USERS, mockWorkspace,
} from "./mock/data.js";

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? "true").toLowerCase() !== "false";
export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

const TOKEN_KEY = "mapintel.token";
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = null; }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach the MAP Intel API at ${API_URL}. Is the backend running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export function promotionStatus(fromIso, untilIso, today = new Date()) {
  const t = today.toLocaleDateString("en-CA"); // local YYYY-MM-DD
  if (fromIso > t) return "Scheduled";
  if (untilIso < t) return "Expired";
  return "Active";
}

/** Turn an API product into the row shape the Product Summary table already uses. */
function toSkuRow(p) {
  return {
    id: p.code,
    uuid: p.id,
    name: p.name,
    model: p.model || "",
    category: p.category || "",
    map: p.map ?? null,
    msrp: p.msrp ?? null,
    current: p.current ?? null,
    violations: p.violations ?? 0,
    status: p.status || "Active",
    offers: p.offers || [],
  };
}

export const api = {
  isMock: USE_MOCK,

  // ---------------- Auth ----------------
  async login(email, password) {
    if (USE_MOCK) {
      await delay(1000);
      return { id: "mock", email, name: "Fenil Dholaviya", role: "admin" };
    }
    const data = await request("/auth/login", { method: "POST", body: { email, password } });
    token = data.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
    return data.user;
  },

  logout() {
    token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },

  // ---------------- Clients (accounts) ----------------
  async listClients() {
    if (USE_MOCK) return CLIENTS.map((c) => ({ ...c, id: c.name }));
    const accounts = await request("/accounts");
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      skus: a.skus,
      merchants: a.merchants,
      live: true,
      accent: a.accent,
    }));
  },

  /** Everything the workspace screens read for one client. */
  async loadWorkspace(client) {
    const mock = mockWorkspace(client.name, client.skus, client.merchants);
    if (USE_MOCK) return mock;
    const products = await request(`/accounts/${client.id}/products`);
    // Only products are real in Phase 0; the other screens stay on mock data until their phase.
    return { ...mock, skus: products.map(toSkuRow) };
  },

  // ---------------- Catalogue ----------------
  async addSku(client, form) {
    const row = {
      id: form.sku,
      name: form.name,
      model: form.model,
      category: form.category,
      map: form.map,
      msrp: form.msrp,
      current: null,
      violations: 0,
      status: "Active",
    };
    if (USE_MOCK) return row;
    const created = await request(`/accounts/${client.id}/products`, {
      method: "POST",
      body: { code: form.sku, name: form.name, model: form.model, category: form.category, map: form.map ?? undefined, msrp: form.msrp ?? undefined },
    });
    return toSkuRow(created);
  },

  // Promotions are stored per client in the portal until MAP Policies lands (Phase 2a).
  async addPromotion(client, form, skus) {
    const sku = skus.find((s) => s.id.toLowerCase() === form.scope.toLowerCase());
    return {
      sku: sku ? sku.name : form.scope,
      skuCode: form.scope,
      seller: form.seller,
      standard: sku?.map ?? null,
      promo: form.promo,
      from: formatDate(form.start),
      until: formatDate(form.end),
      fromIso: form.start,
      untilIso: form.end,
      status: promotionStatus(form.start, form.end),
    };
  },

  // ---------------- Violations & enforcement (Phase 3 / 4: mock) ----------------
  // eslint-disable-next-line no-unused-vars
  async resolveViolation(clientName, violationId) { return { ok: true }; },
  // eslint-disable-next-line no-unused-vars
  async sendWarning(clientName, violationId) { return { ok: true }; },
  // eslint-disable-next-line no-unused-vars
  async escalateViolation(clientName, violationId) { return { ok: true }; },

  // ---------------- Mapping (Phase 2a: mock) ----------------
  async mapListing() { return { ok: true }; },
  async excludeListing() { return { ok: true }; },

  // ---------------- Other screens (mock until their phase) ----------------
  async loadShared() {
    return {
      emails: EMAILS,
      reports: REPORTS,
      alertRules: ALERTS,
      alertUnread: ALERT_EVENTS.filter((e) => !e.read).length,
      users: USERS,
      audit: AUDIT_LOG,
      severityDist: SEVERITY_DIST,
      trend: TREND,
    };
  },

  // ---------------- Evidence (real when the backend is on) ----------------
  async getEvidence(evidenceId) {
    if (USE_MOCK) return null;
    return request(`/evidence/${evidenceId}`);
  },
};
