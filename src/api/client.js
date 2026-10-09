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
// sellers/mapping/promotions -> P2a. Sources & Terms, Settings, Users & Access and Audit Log are
// real from P1 (with an in-memory stand-in, ./mock/config.js, in mock mode).

import {
  ALERT_EVENTS, ALERTS, AUDIT_LOG, CLIENTS, EMAILS, REPORTS, SEVERITY_DIST, TREND, USERS, mockWorkspace,
} from "./mock/data.js";
import { mockConfig } from "./mock/config.js";
import { mockCatalog } from "./mock/catalog.js";
import { mockHealth } from "./mock/health.js";
import { mockDetection as mockViolations } from "./mock/detection.js";
import { mockP3 } from "./mock/p3admin.js";

const mockDetection = { ...mockViolations, ...mockP3 };

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

const ALL_ACTIONS = [
  "account.read", "catalogue.read", "catalogue.write", "observations.read", "settings.read", "settings.write",
  "sources.read", "sources.write", "terms.read", "terms.write", "schedules.read", "schedules.write",
  "users.read", "users.manage", "audit.read", "credentials.read", "credentials.write",
  "mapping.read", "mapping.write", "sellers.read", "sellers.write", "health.read", "collection.run",
  "violations.read", "violations.write", "rules.read", "rules.write", "reports.read", "reports.write", "alerts.read", "alerts.write", "cases.read", "cases.write",
];

const qs = (params) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return q.toString() ? `?${q}` : "";
};

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
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

/** Enforcement (P4) needs the API: in demo mode say so instead of pretending. */
const P4 = (fn) => (USE_MOCK ? Promise.reject(new ApiError(501, "Enforcement needs the API: demo mode has no cases yet")) : fn());
/** Guided onboarding (P5) writes real configuration: it needs the API too. */
const P5 = (fn) => (USE_MOCK ? Promise.reject(new ApiError(501, "This needs the API: demo mode has no accounts to set up or crawl budgets")) : fn());

/** Fetch a file with the session token and hand it to the browser as a download. */
async function download(path, fileName) {
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
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
    brand: p.brand || "",
    modelFamily: p.modelFamily || "",
    configuration: p.configuration || "",
    colour: p.colour || "",
    internalId: p.internalId || "",
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

  /** Start the API early (the free host sleeps when idle) so it is awake by the time the user signs in. */
  wake() {
    if (!USE_MOCK) fetch(`${API_URL}/health`).catch(() => undefined);
  },

  /** The signed-in user with each account's role and allowed actions. */
  async me() {
    if (USE_MOCK) return { id: "mock", email: "fenil@mirethos.com", name: "Fenil Dholaviya", role: "admin", accounts: [] };
    return request("/auth/me");
  },

  /** What the user may do in one account (mock mode: everything). */
  actionsFor(user, client) {
    if (USE_MOCK) return ALL_ACTIONS;
    return user?.accounts?.find((a) => a.id === client?.id)?.actions ?? [];
  },

  // ---------------- Invites (public) ----------------
  async getInvite(inviteToken) {
    return request(`/auth/invite/${encodeURIComponent(inviteToken)}`);
  },

  async acceptInvite(inviteToken, password, name) {
    const data = await request("/auth/accept-invite", { method: "POST", body: { token: inviteToken, password, name: name || undefined } });
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
      slug: a.slug,
      name: a.name,
      brand: a.brand,
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

  // ---------------- Sources & Terms (P1) ----------------
  subscriptions(client) {
    return USE_MOCK ? mockConfig.subscriptions(client) : request(`/accounts/${client.id}/subscriptions`);
  },
  setSubscription(client, code, body) {
    return USE_MOCK ? mockConfig.setSubscription(client, code, body) : request(`/accounts/${client.id}/subscriptions/${code}`, { method: "PUT", body });
  },
  matrix(client) {
    return USE_MOCK ? mockConfig.matrix(client) : request(`/accounts/${client.id}/matrix`);
  },
  setMatrixCell(client, groupId, category, body) {
    return USE_MOCK
      ? mockConfig.setCell(client, groupId, category, body)
      : request(`/accounts/${client.id}/matrix/${groupId}/${encodeURIComponent(category)}`, { method: "PUT", body });
  },
  termGroups(client) {
    return USE_MOCK ? mockConfig.termGroups(client) : request(`/accounts/${client.id}/term-groups`);
  },
  terms(client, query) {
    return USE_MOCK ? mockConfig.terms(client, query) : request(`/accounts/${client.id}/terms${qs(query)}`);
  },
  updateTerm(client, termId, body) {
    return USE_MOCK ? mockConfig.updateTerm(client, termId, body) : request(`/accounts/${client.id}/terms/${termId}`, { method: "PATCH", body });
  },
  /** body: { dryRun, group, template, identifierTypes, products: { category } }. skus: mock mode only. */
  generateTerms(client, body, skus = []) {
    return USE_MOCK ? mockConfig.generate(client, body, skus) : request(`/accounts/${client.id}/terms/generate`, { method: "POST", body });
  },
  importTerms(client, body) {
    return USE_MOCK ? mockConfig.importTerms(client, body) : request(`/accounts/${client.id}/terms/import`, { method: "POST", body });
  },
  schedules(client) {
    return USE_MOCK ? mockConfig.schedules(client) : request(`/accounts/${client.id}/schedules`);
  },
  createSchedule(client, body) {
    return USE_MOCK ? mockConfig.createSchedule(client, body) : request(`/accounts/${client.id}/schedules`, { method: "POST", body });
  },
  updateSchedule(client, scheduleId, body) {
    return USE_MOCK ? mockConfig.updateSchedule(client, scheduleId, body) : request(`/accounts/${client.id}/schedules/${scheduleId}`, { method: "PATCH", body });
  },

  // ---------------- Settings, users, audit (P1) ----------------
  settings(client) {
    return USE_MOCK ? mockConfig.settings(client) : request(`/accounts/${client.id}/settings`);
  },
  updateSettings(client, body) {
    return USE_MOCK ? mockConfig.updateSettings(client, body) : request(`/accounts/${client.id}/settings`, { method: "PATCH", body });
  },
  users(client) {
    return USE_MOCK ? mockConfig.users(client) : request(`/accounts/${client.id}/users`);
  },
  inviteUser(client, body) {
    return USE_MOCK ? mockConfig.invite(client, body) : request(`/accounts/${client.id}/users/invite`, { method: "POST", body });
  },
  changeUserRole(client, userId, role) {
    return USE_MOCK ? mockConfig.changeRole(client, userId, role) : request(`/accounts/${client.id}/users/${userId}`, { method: "PATCH", body: { role } });
  },
  removeUser(client, userId) {
    return USE_MOCK ? mockConfig.removeUser(client, userId) : request(`/accounts/${client.id}/users/${userId}`, { method: "DELETE" });
  },
  revokeInvite(client, inviteId) {
    return USE_MOCK ? mockConfig.revokeInvite(client, inviteId) : request(`/accounts/${client.id}/invites/${inviteId}`, { method: "DELETE" });
  },
  credentials(client) {
    return USE_MOCK ? mockConfig.credentials(client) : request(`/accounts/${client.id}/credentials`);
  },
  addCredential(client, body) {
    return USE_MOCK ? mockConfig.addCredential(client, body) : request(`/accounts/${client.id}/credentials`, { method: "POST", body });
  },
  audit(client, query) {
    return USE_MOCK ? mockConfig.audit(client) : request(`/accounts/${client.id}/audit${qs(query)}`);
  },

  // ---------------- Catalogue, MAP policies, sellers, mapping (P2a) ----------------
  products(client, query) {
    return USE_MOCK ? mockCatalog.products(client, query) : request(`/accounts/${client.id}/products${qs(query)}`);
  },
  product(client, productId) {
    return USE_MOCK ? mockCatalog.product(client, productId) : request(`/accounts/${client.id}/products/${productId}`);
  },
  createProduct(client, body) {
    return USE_MOCK ? mockCatalog.addProduct(client, body) : request(`/accounts/${client.id}/products`, { method: "POST", body });
  },
  updateProduct(client, productId, body) {
    return USE_MOCK ? mockCatalog.updateProduct(client, productId, body) : request(`/accounts/${client.id}/products/${productId}`, { method: "PATCH", body });
  },
  /** kind: products | map | listings. body: { fileName, content (base64), mapping?, dryRun }. */
  importFile(client, kind, body) {
    if (USE_MOCK) return mockCatalog.importFile(client, kind, body);
    const path = kind === "listings" ? `/accounts/${client.id}/mapping/import` : `/accounts/${client.id}/imports/${kind}`;
    return request(path, { method: "POST", body });
  },
  imports(client) {
    return USE_MOCK ? mockCatalog.imports(client) : request(`/accounts/${client.id}/imports`);
  },
  mapPrices(client) {
    return USE_MOCK ? mockCatalog.mapPrices(client) : request(`/accounts/${client.id}/map-prices`);
  },
  addMapVersion(client, productId, body) {
    return USE_MOCK ? mockCatalog.addMapVersion(client, productId, body) : request(`/accounts/${client.id}/products/${productId}/map`, { method: "POST", body });
  },
  promos(client) {
    return USE_MOCK ? mockCatalog.promos(client) : request(`/accounts/${client.id}/promos`);
  },
  addPromo(client, body) {
    return USE_MOCK ? mockCatalog.addPromo(client, body) : request(`/accounts/${client.id}/promos`, { method: "POST", body });
  },
  cancelPromo(client, promoId) {
    return USE_MOCK ? mockCatalog.cancelPromo(client, promoId) : request(`/accounts/${client.id}/promos/${promoId}/cancel`, { method: "POST" });
  },
  policies(client) {
    return USE_MOCK ? mockCatalog.policies(client) : request(`/accounts/${client.id}/policies`);
  },
  uploadPolicy(client, body) {
    return USE_MOCK ? mockCatalog.uploadPolicy(client, body) : request(`/accounts/${client.id}/policies`, { method: "POST", body });
  },
  policyDownload(client, docId) {
    return USE_MOCK ? mockCatalog.policyDownload(client, docId) : request(`/accounts/${client.id}/policies/${docId}/download`);
  },
  sellers(client) {
    return USE_MOCK ? mockCatalog.sellers(client) : request(`/accounts/${client.id}/sellers`);
  },
  seller(client, sellerId) {
    return USE_MOCK ? mockCatalog.seller(client, sellerId) : request(`/accounts/${client.id}/sellers/${sellerId}`);
  },
  addSeller(client, body) {
    return USE_MOCK ? mockCatalog.addSeller(client, body) : request(`/accounts/${client.id}/sellers`, { method: "POST", body });
  },
  classifySeller(client, sellerId, body) {
    return USE_MOCK ? mockCatalog.classifySeller(client, sellerId, body) : request(`/accounts/${client.id}/sellers/${sellerId}/classification`, { method: "POST", body });
  },
  addSellerAlias(client, sellerId, body) {
    return USE_MOCK ? mockCatalog.addAlias(client, sellerId, body) : request(`/accounts/${client.id}/sellers/${sellerId}/aliases`, { method: "POST", body });
  },
  linkSeller(client, sellerId, body) {
    return USE_MOCK ? mockCatalog.linkSeller(client, sellerId, body) : request(`/accounts/${client.id}/sellers/${sellerId}/links`, { method: "POST", body });
  },
  addSellerContact(client, sellerId, body) {
    return USE_MOCK ? mockCatalog.addContact(client, sellerId, body) : request(`/accounts/${client.id}/sellers/${sellerId}/contacts`, { method: "POST", body });
  },
  removeSellerContact(client, sellerId, contactId) {
    return USE_MOCK ? mockCatalog.removeContact(client, sellerId, contactId) : request(`/accounts/${client.id}/sellers/${sellerId}/contacts/${contactId}`, { method: "DELETE" });
  },
  mappingSummary(client) {
    return USE_MOCK ? mockCatalog.mappingSummary(client) : request(`/accounts/${client.id}/mapping/summary`);
  },
  mappingQueue(client) {
    return USE_MOCK ? mockCatalog.mappingQueue(client) : request(`/accounts/${client.id}/mapping/queue`);
  },
  mappingListings(client, query) {
    return USE_MOCK ? mockCatalog.mappingListings(client, query) : request(`/accounts/${client.id}/mapping/listings${qs(query)}`);
  },
  mappingListing(client, listingId) {
    return USE_MOCK ? mockCatalog.mappingListing(client, listingId) : request(`/accounts/${client.id}/mapping/listings/${listingId}`);
  },
  /** body: { listingIds, action: include | exclude | restore | retire, productId?, reason?, scope?, urlPattern? } */
  mappingDecide(client, body) {
    return USE_MOCK ? mockCatalog.mappingDecide(client, body) : request(`/accounts/${client.id}/mapping/decisions`, { method: "POST", body });
  },
  applyMatchRules(client) {
    return USE_MOCK ? mockCatalog.applyRules(client) : request(`/accounts/${client.id}/mapping/apply-rules`, { method: "POST" });
  },
  matchRules(client) {
    return USE_MOCK ? mockCatalog.matchRules(client) : request(`/accounts/${client.id}/mapping/rules`);
  },
  setMatchRule(client, ruleId, body) {
    return USE_MOCK ? mockCatalog.setRule(client, ruleId, body) : request(`/accounts/${client.id}/mapping/rules/${ruleId}`, { method: "PATCH", body });
  },
  // Learning loop (P4): the weekly QA sample of automatic decisions and the precision it gives.
  qaSamples(client, query = {}) {
    return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/mapping/qa${qs(query)}`);
  },
  qaStats(client) {
    return USE_MOCK
      ? Promise.resolve({ included: { reviewed: 0, precision: null, open: 0 }, excluded: { reviewed: 0, precision: null, open: 0 }, bands: [], overrides: { automatic: 0, overridden: 0, rate: null } })
      : request(`/accounts/${client.id}/mapping/qa/stats`);
  },
  qaDraw(client) {
    return USE_MOCK ? Promise.resolve({ drawn: 0 }) : request(`/accounts/${client.id}/mapping/qa/draw`, { method: "POST", body: {} });
  },
  qaReview(client, sampleId, body) {
    return USE_MOCK ? Promise.reject(new ApiError(501, "QA review needs the API")) : request(`/accounts/${client.id}/mapping/qa/${sampleId}/review`, { method: "POST", body });
  },
  suppressions(client) {
    return USE_MOCK ? mockCatalog.suppressions(client) : request(`/accounts/${client.id}/mapping/suppressions`);
  },
  revokeSuppression(client, suppressionId) {
    return USE_MOCK ? mockCatalog.revokeSuppression(client, suppressionId) : request(`/accounts/${client.id}/mapping/suppressions/${suppressionId}/revoke`, { method: "POST" });
  },

  // ---------------- Data Health (P2b) ----------------
  dataHealth(client) {
    return USE_MOCK ? mockHealth.health(client) : request(`/accounts/${client.id}/health`);
  },
  healthFailures(client, source) {
    return USE_MOCK ? mockHealth.failures(client, source) : request(`/accounts/${client.id}/health/${source}/failures`);
  },
  /** Re-run the failed jobs of the latest run (optionally one source). */
  rerunFailed(client, source) {
    return USE_MOCK ? mockHealth.rerun(client, source) : request(`/accounts/${client.id}/health/rerun`, { method: "POST", body: source ? { source } : {} });
  },

  // ---------------- Violations (P3) ----------------
  overview(client, days) {
    return USE_MOCK ? mockDetection.overview(client) : request(`/accounts/${client.id}/overview${qs({ days })}`);
  },
  /** Filters: status / severity (comma lists), source, seller, product, q, active, from, to, limit, offset. */
  violations(client, filters = {}) {
    return USE_MOCK ? mockDetection.violations(client, filters) : request(`/accounts/${client.id}/violations${qs(filters)}`);
  },
  violation(client, violationId) {
    return USE_MOCK ? mockDetection.violation(client, violationId) : request(`/accounts/${client.id}/violations/${violationId}`);
  },
  // ---------------- Enforcement (P4) ----------------
  // Cases, notices, the communications log, letter templates and IP reports work against the API;
  // in demo mode the lists are empty and changes say they need the API.
  /** Open a case for one seller's active violations: { violationIds, owner?, responseDue?, note? }. */
  openCase(client, body) { return P4(() => request(`/accounts/${client.id}/cases`, { method: "POST", body })); },
  /** Filters: state (comma list), open, seller, owner, q. */
  cases(client, filters = {}) {
    return USE_MOCK ? Promise.resolve({ total: 0, rows: [], counts: {} }) : request(`/accounts/${client.id}/cases${qs(filters)}`);
  },
  caseDetail(client, caseId) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}`)); },
  moveCase(client, caseId, body) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}/state`, { method: "POST", body })); },
  /** { owner?, responseDue?, ipIssue?, ipReason? } */
  updateCase(client, caseId, body) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}`, { method: "PATCH", body })); },
  /** Filters: status (comma list), case. */
  notices(client, filters = {}) { return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/notices${qs(filters)}`); },
  draftNotice(client, caseId, body) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}/notices`, { method: "POST", body })); },
  editNotice(client, noticeId, body) { return P4(() => request(`/accounts/${client.id}/notices/${noticeId}`, { method: "PATCH", body })); },
  /** action: submit | approve | reject | send | cancel; body: { note } for approve / reject, { channel } for send. */
  noticeAction(client, noticeId, action, body = {}) {
    return P4(() => request(`/accounts/${client.id}/notices/${noticeId}/${action}`, { method: "POST", body }));
  },
  downloadNotice(client, notice) { return P4(() => download(`/accounts/${client.id}/notices/${notice.id}/text`, `${notice.code}.txt`)); },
  communications(client, filters = {}) { return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/communications${qs(filters)}`); },
  /** { kind: response | contest | note, channel?, summary, body?, occurredAt? } */
  logCommunication(client, caseId, body) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}/communications`, { method: "POST", body })); },
  noticeTemplates(client) { return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/notice-templates`); },
  updateNoticeTemplate(client, templateId, body) { return P4(() => request(`/accounts/${client.id}/notice-templates/${templateId}`, { method: "PATCH", body })); },
  createNoticeTemplate(client, body) { return P4(() => request(`/accounts/${client.id}/notice-templates`, { method: "POST", body })); },
  ipReports(client, filters = {}) { return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/ip-reports${qs(filters)}`); },
  /** { channel, ipBasis, reason } */
  draftIpReport(client, caseId, body) { return P4(() => request(`/accounts/${client.id}/cases/${caseId}/ip-reports`, { method: "POST", body })); },
  fileIpReport(client, reportId, body) { return P4(() => request(`/accounts/${client.id}/ip-reports/${reportId}/file`, { method: "POST", body })); },
  /** { status: Accepted | Rejected | Withdrawn, note? } */
  ipReportOutcome(client, reportId, body) { return P4(() => request(`/accounts/${client.id}/ip-reports/${reportId}/outcome`, { method: "POST", body })); },
  downloadEvidencePack(client, report) { return P4(() => download(`/accounts/${client.id}/ip-reports/${report.id}/pack`, `${report.code}-evidence.txt`)); },
  setViolationStatus(client, violationId, body) {
    return USE_MOCK ? mockDetection.setViolationStatus(client, violationId, body) : request(`/accounts/${client.id}/violations/${violationId}/status`, { method: "POST", body });
  },
  /** An expiring link to the violation's hosted evidence page (default 30 days). */
  createEvidenceLink(client, violationId, days) {
    return USE_MOCK ? mockDetection.createLink(client, violationId) : request(`/accounts/${client.id}/violations/${violationId}/links`, { method: "POST", body: days ? { days } : {} });
  },
  evidenceLinks(client, violationId) {
    return USE_MOCK ? Promise.resolve([]) : request(`/accounts/${client.id}/violations/${violationId}/links`);
  },
  revokeEvidenceLink(client, violationId, linkId) {
    return USE_MOCK ? Promise.resolve({ ok: true }) : request(`/accounts/${client.id}/violations/${violationId}/links/${linkId}/revoke`, { method: "POST" });
  },
  /** The public evidence page behind a link (no sign-in). Returns { status, data }. */
  async evidenceByToken(linkToken) {
    if (USE_MOCK || linkToken.startsWith("mock-")) return { status: 200, data: mockDetection.evidenceRecord(linkToken) };
    try {
      const res = await fetch(`${API_URL}/e/${encodeURIComponent(linkToken)}`);
      return { status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
      return { status: 0, data: { error: "The evidence service cannot be reached. Try again in a minute." } };
    }
  },
  /** The hosted report behind a link (no sign-in). Returns { status, data }. */
  async reportByToken(linkToken) {
    if (USE_MOCK) return { status: 404, data: { error: "Hosted reports open when the portal is connected to the API." } };
    try {
      const res = await fetch(`${API_URL}/r/${encodeURIComponent(linkToken)}`);
      return { status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
      return { status: 0, data: { error: "The report service cannot be reached. Try again in a minute." } };
    }
  },
  /** Download the filtered list as CSV (signed in, so fetched with the token). */
  async downloadViolationsCsv(client, filters = {}) {
    if (USE_MOCK) throw new Error("CSV export works when the portal is connected to the API.");
    const res = await fetch(`${API_URL}/accounts/${client.id}/violations.csv${qs(filters)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `violations-${client.name}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // ---------------- Rules (P3) ----------------
  rules(client) { return USE_MOCK ? mockDetection.rules(client) : request(`/accounts/${client.id}/rules`); },
  rule(client, ruleId) { return USE_MOCK ? mockDetection.rule(client, ruleId) : request(`/accounts/${client.id}/rules/${ruleId}`); },
  createRule(client, body) { return USE_MOCK ? mockDetection.createRule(client, body) : request(`/accounts/${client.id}/rules`, { method: "POST", body }); },
  saveRuleDraft(client, ruleId, body) { return USE_MOCK ? mockDetection.saveDraft(client, ruleId, body) : request(`/accounts/${client.id}/rules/${ruleId}/draft`, { method: "PUT", body }); },
  discardRuleDraft(client, ruleId) { return USE_MOCK ? mockDetection.discardDraft(client, ruleId) : request(`/accounts/${client.id}/rules/${ruleId}/draft`, { method: "DELETE" }); },
  dryRunRule(client, ruleId, range) { return USE_MOCK ? mockDetection.dryRun(client, ruleId, range) : request(`/accounts/${client.id}/rules/${ruleId}/draft/dry-run`, { method: "POST", body: range }); },
  publishRule(client, ruleId) { return USE_MOCK ? mockDetection.publish(client, ruleId) : request(`/accounts/${client.id}/rules/${ruleId}/draft/publish`, { method: "POST" }); },
  replayRuleVersion(client, versionId, range) { return USE_MOCK ? mockDetection.replay(client, versionId, range) : request(`/accounts/${client.id}/rules/versions/${versionId}/replay`, { method: "POST", body: range }); },

  // ---------------- Reports (P3) ----------------
  reportTemplates(client) { return USE_MOCK ? mockDetection.reportTemplates(client) : request(`/accounts/${client.id}/reports/templates`); },
  reportDefinitions(client) { return USE_MOCK ? mockDetection.reportDefinitions(client) : request(`/accounts/${client.id}/reports/definitions`); },
  createReportDefinition(client, body) { return USE_MOCK ? mockDetection.createReportDefinition(client, body) : request(`/accounts/${client.id}/reports/definitions`, { method: "POST", body }); },
  updateReportDefinition(client, id, body) { return USE_MOCK ? mockDetection.updateReportDefinition(client, id, body) : request(`/accounts/${client.id}/reports/definitions/${id}`, { method: "PATCH", body }); },
  runReportDefinition(client, id) { return USE_MOCK ? mockDetection.runReport(client, id) : request(`/accounts/${client.id}/reports/definitions/${id}/run`, { method: "POST" }); },
  runReport(client, body) { return USE_MOCK ? mockDetection.runReport(client, null, body) : request(`/accounts/${client.id}/reports/runs`, { method: "POST", body }); },
  reportRuns(client) { return USE_MOCK ? mockDetection.reportRuns(client) : request(`/accounts/${client.id}/reports/runs`); },
  reportRun(client, runId) { return USE_MOCK ? mockDetection.reportRun(client, runId) : request(`/accounts/${client.id}/reports/runs/${runId}`); },
  reportRunLink(client, runId) { return USE_MOCK ? mockDetection.reportRunLink(client, runId) : request(`/accounts/${client.id}/reports/runs/${runId}/link`, { method: "POST" }); },
  sftpTest(client, body) { return USE_MOCK ? mockDetection.sftpTest(client, body) : request(`/accounts/${client.id}/reports/sftp-test`, { method: "POST", body }); },

  // ---------------- Alerts (P3) ----------------
  alertEvents(client, filters = {}) { return USE_MOCK ? mockDetection.alertEvents(client, filters) : request(`/accounts/${client.id}/alerts/events${qs(filters)}`); },
  markAlertsRead(client, body) { return USE_MOCK ? mockDetection.markAlertsRead(client, body) : request(`/accounts/${client.id}/alerts/events/read`, { method: "POST", body }); },
  alertRules(client) { return USE_MOCK ? mockDetection.alertRules(client) : request(`/accounts/${client.id}/alerts/rules`); },
  updateAlertRule(client, id, body) { return USE_MOCK ? mockDetection.updateAlertRule(client, id, body) : request(`/accounts/${client.id}/alerts/rules/${id}`, { method: "PATCH", body }); },

  // ---------------- Guided onboarding (P5, needs the API) ----------------
  createAccount(body) { return P5(() => request("/accounts", { method: "POST", body })); },
  onboarding(client) { return P5(() => request(`/accounts/${client.id}/onboarding`)); },
  setOnboardingStep(client, currentStep) { return P5(() => request(`/accounts/${client.id}/onboarding`, { method: "PATCH", body: { currentStep } })); },
  goLive(client) { return P5(() => request(`/accounts/${client.id}/onboarding/go-live`, { method: "POST" })); },

  // ---------------- Platform (Mirethos administrators, P5) ----------------
  crawlBudget(days = 14) { return P5(() => request(`/platform/crawl-budget${qs({ days })}`)); },
  setCrawlBudget(body) { return P5(() => request("/platform/crawl-budget", { method: "PUT", body })); },
  tickets(filters = {}) { return P5(() => request(`/platform/tickets${qs(filters)}`)); },
  ticket(id) { return P5(() => request(`/platform/tickets/${id}`)); },
  createTicket(body) { return P5(() => request("/platform/tickets", { method: "POST", body })); },
  updateTicket(id, body) { return P5(() => request(`/platform/tickets/${id}`, { method: "PATCH", body })); },
  ticketAssignees() { return P5(() => request("/platform/assignees")); },
  sourceList() { return P5(() => request("/sources")); },
  platformReplays() { return P5(() => request("/platform/replays")); },
  startPlatformReplay(body) { return P5(() => request("/platform/replays", { method: "POST", body })); },

  // ---------------- Evidence (real when the backend is on) ----------------
  async getEvidence(evidenceId) {
    if (USE_MOCK) return null;
    return request(`/evidence/${evidenceId}`);
  },
  // A search / browse results page as it was read by discovery (HTML + screenshot).
  async getResultsPage(client, pageId) {
    if (USE_MOCK) return null;
    return request(`/accounts/${client.id}/results-pages/${pageId}`);
  },
};
