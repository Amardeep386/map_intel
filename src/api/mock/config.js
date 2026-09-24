// In-memory stand-in for the Phase 1 configuration API, used when VITE_USE_MOCK=true.
// Same response shapes as server/src/api/routes/*; the cost estimate is simplified.

const opt = {
  pages: (def, max = 5) => ({ key: "search_pages", label: "Search result pages per keyword", type: "integer", default: def, min: 1, max }),
  newOnly: { key: "new_only", label: "New items only", type: "boolean", default: true },
};

const CATALOGUE = [
  { code: "amazon_us", name: "Amazon", family: { code: "amazon", name: "Amazon" }, category: "Marketplace", collectorStatus: "live",
    options: [{ key: "buy_box_only", label: "Capture buy box only", type: "boolean", default: true }, { key: "include_variants", label: "Colour and size variants", type: "boolean", default: false }, opt.newOnly, { key: "seller_direct_only", label: "Seller-direct only", type: "boolean", default: false }, opt.pages(2)] },
  { code: "walmart_us", name: "Walmart", family: { code: "walmart", name: "Walmart" }, category: "Marketplace", collectorStatus: "live",
    options: [{ key: "all_sellers", label: "Record every seller on a listing", type: "boolean", default: true }, opt.newOnly, opt.pages(2)] },
  { code: "bestbuy_us", name: "Best Buy", family: { code: "bestbuy", name: "Best Buy" }, category: "Online Seller", collectorStatus: "live",
    options: [{ key: "use_api", label: "Use the Best Buy Products API when available", type: "boolean", default: true }, opt.pages(1, 3)] },
  { code: "ebay_us", name: "eBay", family: { code: "ebay", name: "eBay" }, category: "Marketplace", collectorStatus: "planned",
    options: [opt.newOnly, { key: "buy_it_now_only", label: "Buy It Now only (skip auctions)", type: "boolean", default: true }, opt.pages(3)] },
  { code: "target_us", name: "Target", family: { code: "target", name: "Target" }, category: "Online Seller", collectorStatus: "planned", options: [opt.pages(1, 3)] },
  { code: "homedepot_us", name: "Home Depot", family: { code: "homedepot", name: "Home Depot" }, category: "Online Seller", collectorStatus: "planned", options: [opt.pages(1, 3)] },
  { code: "google_shopping_us", name: "Google Shopping", family: { code: "google", name: "Google" }, category: "Price Comparison", collectorStatus: "planned", options: [opt.pages(1, 3)] },
].map((s) => ({ ...s, id: s.code, country: "US", active: true }));

const CATEGORIES = ["Marketplace", "Online Seller", "Price Comparison"];
const state = {};
let seq = 1;
const id = () => `mock-${seq++}`;
const now = () => new Date().toISOString();

function account(name) {
  state[name] ??= {
    subs: { amazon_us: {}, walmart_us: {}, bestbuy_us: {} },
    groups: [],
    terms: [],
    cells: {},
    schedules: [{ id: id(), name: "Daily marketplace sweep", selector: {}, listingScope: "Included and Staged", listingStatus: "Active only", takedownStatus: "All", cadence: "0 6 * * *", timezone: "UTC", priority: 10, active: true, nextRun: null }],
    settings: { name, regions: ["US"], currency: "USD", timezone: "America/New_York", contractFrom: null, contractTo: null, seats: 8,
      settings: { mapTolerancePct: 2, minDepth: 1, graceHours: 0, matchInclude: 90, matchReview: 60, qaSamplePct: 5, brandApprovalRequired: true, brandUsersSeeNeedsReview: false, requestBudget: 3000 } },
    audit: [],
    users: [
      { userId: id(), name: "Fenil Dholaviya", email: "fenil@mirethos.com", role: "Account manager", status: "Active", lastLoginAt: now() },
      { userId: id(), name: "Analyst", email: "analyst@mirethos.com", role: "Analyst", status: "Active", lastLoginAt: null },
    ],
    invites: [],
  };
  return state[name];
}

function log(a, action, summary, before, after) {
  a.audit.unshift({ id: id(), occurredAt: now(), actorType: "user", actor: "you (sample data)", action, entityType: action.split(".")[0], summary, before: before ?? null, after: after ?? null });
}

const values = (s, overrides) => Object.fromEntries(s.options.map((o) => [o.key, overrides?.[o.key] ?? o.default]));
const sourceView = (a, s) => ({ ...s, subscription: a.subs[s.code] ? { active: a.subs[s.code].active !== false, overrides: a.subs[s.code].options || {}, values: values(s, a.subs[s.code].options) } : null });

function estimate(a) {
  const groups = a.groups.map((g) => {
    const terms = a.terms.filter((t) => t.group.id === g.id && t.active);
    let requests = 0;
    let planned = 0;
    for (const cat of CATEGORIES) {
      const cell = a.cells[`${g.id}|${cat}`] || { mode: "None", sourceCodes: [] };
      if (cell.mode === "None") continue;
      for (const s of CATALOGUE.filter((x) => x.category === cat && a.subs[x.code] && a.subs[x.code].active !== false)) {
        if (cell.mode === "Some" && !cell.sourceCodes.includes(s.code)) continue;
        const pages = values(s, a.subs[s.code].options).search_pages || 1;
        const r = terms.reduce((n, t) => n + (t.type === "keyword" || t.type === "brand" ? pages : 1), 0);
        requests += r;
        if (s.collectorStatus !== "live") planned += r;
      }
    }
    return { id: g.id, requests, planned };
  });
  const total = groups.reduce((n, g) => n + g.requests, 0);
  const budget = a.settings.settings.requestBudget;
  return { groups, total, budget, overBudget: total > budget };
}

function matrix(a) {
  const est = estimate(a);
  return {
    categories: CATEGORIES,
    sources: Object.fromEntries(CATEGORIES.map((c) => [c, CATALOGUE.filter((s) => s.category === c && a.subs[s.code] && a.subs[s.code].active !== false).map((s) => ({ code: s.code, name: s.name, collectorStatus: s.collectorStatus }))])),
    groups: a.groups.map((g) => {
      const e = est.groups.find((x) => x.id === g.id);
      const terms = a.terms.filter((t) => t.group.id === g.id);
      return { id: g.id, name: g.name, terms: terms.length, activeTerms: terms.filter((t) => t.active).length, requests: e.requests, plannedRequests: e.planned, sources: [], found30d: 0, lowYield: false,
        cells: Object.fromEntries(CATEGORIES.map((c) => [c, a.cells[`${g.id}|${c}`] || { mode: "None", sourceCodes: [] }])) };
    }),
    total: est.total,
    budget: est.budget,
    overBudget: est.overBudget,
  };
}

function groupByName(a, name) {
  let g = a.groups.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!g) {
    g = { id: id(), name, description: null };
    a.groups.push(g);
  }
  return g;
}

const newTerm = (g, type, value, productCode, batchLabel) => ({ id: id(), type, value, active: true, batchLabel, group: { id: g.id, name: g.name }, productCode, yield: { found30d: 0, survived30d: 0, survivedPct: null, violations30d: 0, retireCandidate: false } });
const exists = (a, type, value) => a.terms.some((t) => t.type === type && t.value.toLowerCase() === value.toLowerCase());

export const mockConfig = {
  subscriptions(client) {
    const a = account(client.name);
    const e = estimate(a);
    return { sources: CATALOGUE.map((s) => sourceView(a, s)), estimate: { total: e.total, budget: e.budget, overBudget: e.overBudget } };
  },
  setSubscription(client, code, body) {
    const a = account(client.name);
    const before = a.subs[code];
    a.subs[code] = { active: body.active, options: body.options ?? before?.options ?? {} };
    const s = CATALOGUE.find((x) => x.code === code);
    log(a, before ? "subscription.updated" : "subscription.created", `${before ? "Changed" : "Subscribed to"} ${s.name}`, before, a.subs[code]);
    const e = estimate(a);
    return { source: sourceView(a, s), estimate: { total: e.total, budget: e.budget, overBudget: e.overBudget } };
  },
  matrix(client) { return matrix(account(client.name)); },
  setCell(client, groupId, category, body) {
    const a = account(client.name);
    a.cells[`${groupId}|${category}`] = { mode: body.mode, sourceCodes: body.mode === "Some" ? body.sourceCodes : [] };
    log(a, "matrix.updated", `${a.groups.find((g) => g.id === groupId)?.name} × ${category}: ${body.mode}`);
    return matrix(a);
  },
  termGroups(client) {
    const a = account(client.name);
    return a.groups.map((g) => ({ ...g, terms: a.terms.filter((t) => t.group.id === g.id).length, activeTerms: a.terms.filter((t) => t.group.id === g.id && t.active).length, batchLabels: [g.name], found30d: 0, survived30d: 0 }));
  },
  terms(client, q = {}) {
    const a = account(client.name);
    const list = a.terms.filter((t) => (!q.group || t.group.id === q.group) && (!q.type || t.type === q.type) && (!q.q || t.value.toLowerCase().includes(q.q.toLowerCase())));
    return { terms: list.slice(0, q.limit || 100), total: list.length, limit: q.limit || 100, offset: 0 };
  },
  updateTerm(client, termId, body) {
    const a = account(client.name);
    const t = a.terms.find((x) => x.id === termId);
    Object.assign(t, body);
    log(a, "term.updated", `${body.active === false ? "Deactivated" : "Changed"} term "${t.value}"`);
    return t;
  },
  generate(client, body, skus) {
    const a = account(client.name);
    const brand = client.name;
    const products = skus.filter((s) => !body.products?.category || (s.category || "").toLowerCase() === body.products.category.toLowerCase());
    const planned = [];
    for (const p of products) {
      if (body.template) planned.push({ type: "keyword", value: body.template.replaceAll("{Brand}", brand).replaceAll("{Product Name}", p.name).replaceAll("{Model}", p.model || "").replaceAll("{Code}", p.id).replaceAll("{Category}", p.category || "").replace(/\s+/g, " ").replace(new RegExp(`^${brand} ${brand}\\b`, "i"), brand).trim(), productCode: p.id });
      if (body.identifierTypes?.includes("MPN") && p.model) planned.push({ type: "identifier", value: p.model, productCode: p.id });
    }
    const create = planned.filter((t) => !exists(a, t.type, t.value));
    const preview = { products: products.length, toCreate: create.length, alreadyExist: planned.length - create.length, sample: create.slice(0, 25), skippedSample: [], group: body.group };
    if (body.dryRun) return { dryRun: true, ...preview };
    const g = groupByName(a, body.group);
    create.forEach((t) => a.terms.push(newTerm(g, t.type, t.value, t.productCode, body.group)));
    log(a, "terms.generated", `Generated ${create.length} terms from the catalogue into "${body.group}"`);
    return { dryRun: false, ...preview, created: create.length, groupId: g.id };
  },
  importTerms(client, body) {
    const a = account(client.name);
    const lines = body.csv.trim().split(/\r?\n/);
    const head = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/\s+/g, "_"));
    const problems = [];
    const rows = [];
    lines.slice(1).forEach((line, i) => {
      const cells = line.split(",");
      const get = (k) => (head.indexOf(k) >= 0 ? (cells[head.indexOf(k)] || "").trim() : "");
      const type = get("type").toLowerCase();
      if (!["keyword", "brand", "identifier", "url", "seller"].includes(type)) return problems.push({ line: i + 2, reason: `unknown type "${type}"`, raw: line });
      if (!get("value")) return problems.push({ line: i + 2, reason: "value is empty", raw: line });
      rows.push({ line: i + 2, type, value: get("value"), productCode: get("product_code") || null, group: get("group") || body.defaultGroup || "Imported terms" });
      return undefined;
    });
    const create = rows.filter((r) => !exists(a, r.type, r.value));
    const report = { rows: rows.length + problems.length, toCreate: create.length, alreadyExist: rows.filter((r) => exists(a, r.type, r.value)), problems, newGroups: [...new Set(create.map((r) => r.group))].filter((g) => !a.groups.some((x) => x.name.toLowerCase() === g.toLowerCase())), perGroup: {} };
    if (body.dryRun) return { dryRun: true, ...report };
    create.forEach((r) => a.terms.push(newTerm(groupByName(a, r.group), r.type, r.value, r.productCode, body.batchLabel || "Import")));
    log(a, "terms.imported", `Imported ${create.length} terms`);
    return { dryRun: false, ...report, created: create.length };
  },
  schedules(client) { return account(client.name).schedules; },
  createSchedule(client, body) {
    const a = account(client.name);
    const s = { id: id(), selector: {}, listingScope: "Included and Staged", listingStatus: "Active only", takedownStatus: "All", timezone: "UTC", priority: 10, active: true, nextRun: null, ...body };
    a.schedules.push(s);
    log(a, "schedule.created", `Created schedule "${s.name}"`);
    return s;
  },
  updateSchedule(client, scheduleId, body) {
    const a = account(client.name);
    const s = a.schedules.find((x) => x.id === scheduleId);
    Object.assign(s, body);
    log(a, "schedule.updated", `Changed schedule "${s.name}"`);
    return s;
  },
  settings(client) { return account(client.name).settings; },
  updateSettings(client, body) {
    const a = account(client.name);
    const before = structuredClone(a.settings);
    a.settings = { ...a.settings, ...body, settings: { ...a.settings.settings, ...(body.settings || {}) } };
    log(a, "settings.updated", "Changed settings", before, a.settings);
    return a.settings;
  },
  users(client) {
    const a = account(client.name);
    return { members: a.users, invites: a.invites, grantableRoles: ["Administrator", "Account manager", "Analyst", "Brand user"] };
  },
  invite(client, body) {
    const a = account(client.name);
    const inv = { id: id(), email: body.email, name: body.name, role: body.role, createdAt: now(), expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString() };
    a.invites.push(inv);
    log(a, "invite.created", `Invited ${body.email} as ${body.role}`);
    return { status: "invited", inviteUrl: `${window.location.origin}/?invite=sample-token`, expiresAt: inv.expiresAt };
  },
  changeRole(client, userId, role) {
    const a = account(client.name);
    const u = a.users.find((x) => x.userId === userId);
    log(a, "member.role_changed", `Changed ${u.email} from ${u.role} to ${role}`);
    u.role = role;
    return { userId, role };
  },
  removeUser(client, userId) {
    const a = account(client.name);
    a.users = a.users.filter((x) => x.userId !== userId);
    log(a, "member.removed", "Removed a member");
  },
  revokeInvite(client, inviteId) {
    const a = account(client.name);
    a.invites = a.invites.filter((x) => x.id !== inviteId);
  },
  credentials(client) { return account(client.name).credentials ?? []; },
  addCredential(client, body) {
    const a = account(client.name);
    const c = { id: id(), kind: body.kind, label: body.label, username: body.username ?? null, hint: body.secret.length >= 12 ? `…${body.secret.slice(-4)}` : "••••", createdAt: now(), rotatedAt: null };
    a.credentials = [...(a.credentials ?? []), c];
    log(a, "credential.created", `Stored ${body.kind} credential "${body.label}" (secret not logged)`);
    return c;
  },
  audit(client) { return { events: account(client.name).audit, next: null }; },
};
