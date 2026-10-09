// Mock-mode stand-in for the Phase 3 Rules, Reports and Alerts screens: the same shapes as the API
// (/rules, /reports, /alerts), kept in memory per client.
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const SEV = { minorBelowPct: 5, severeAbovePct: 15 };
const id = () => `mock-${Math.random().toString(36).slice(2, 10)}`;
const state = new Map();

function seed() {
  const v = (rid, n, over) => ({ id: `${rid}-v${n}`, rule_id: rid, version: n, scope: {}, severity: SEV, status: "Published", valid_from: ago(30), valid_to: null, created_at: ago(30), ...over });
  const rules = [
    { id: "r00", code: "R-00", name: "Brand Direct is never a violation", kind: "Verdict", is_default: true, hits_30d: 0, versions: [v("r00", 1, { condition: { type: "seller_class", classes: ["Brand Direct"] }, verdict: "exempt", priority: 10 })] },
    { id: "r01", code: "R-01", name: "Below MAP by more than tolerance", kind: "Verdict", is_default: true, hits_30d: 7, versions: [v("r01", 1, { condition: { type: "below_map" }, verdict: "violation", priority: 100 })] },
  ];
  const templates = [
    { id: "t1", code: "listing_map", name: "Listing MAP Report", type: "MAP", version: 1, description: "Every violation active in the period with an evidence link per row.", accounts: 3, definitions: 3, used_here: 1, last_used: ago(1),
      params: [{ key: "timeframe", label: "Timeframe", type: "enum", values: ["previous_week", "last_7_days", "last_30_days", "previous_month"], default: "previous_week" }] },
    { id: "t2", code: "monthly_trend", name: "Monthly Trend", type: "Trend", version: 1, description: "Compliance, trend by seller class, severity, top sellers.", accounts: 2, definitions: 2, used_here: 1, last_used: ago(5),
      params: [{ key: "month", label: "Month", type: "month", default: "previous" }] },
    { id: "t3", code: "seller_detail", name: "Seller Detail", type: "Seller", version: 1, description: "One or more sellers and their violations.", accounts: 0, definitions: 0, used_here: 0, last_used: null,
      params: [{ key: "sellerIds", label: "Sellers", type: "sellers", default: [] }] },
  ];
  const definitions = [
    { id: "d1", name: "Weekly MAP report", template_code: "listing_map", template: "Listing MAP Report", params: { timeframe: "previous_week" }, cadence: "0 8 * * 1", timezone: "America/New_York", recipients: ["map-room@example.com"], destinations: { email: true, hosted: true }, visibility: "Brand users", active: true, next_run: new Date(Date.now() + 3 * DAY).toISOString(), last_run: { seq: 4, status: "done", created_at: ago(2) } },
    { id: "d2", name: "Monthly trend deck", template_code: "monthly_trend", template: "Monthly Trend", params: { month: "previous" }, cadence: "0 7 1 * *", timezone: "America/New_York", recipients: ["leadership@example.com"], destinations: { email: true, hosted: true }, visibility: "Account", active: true, next_run: new Date(Date.now() + 25 * DAY).toISOString(), last_run: { seq: 3, status: "done", created_at: ago(5) } },
  ];
  const runs = [4, 3, 2, 1].map((n) => ({
    id: `run${n}`, seq: n, code: `RPT-${String(n).padStart(4, "0")}`, name: n % 2 ? "Monthly trend deck" : "Weekly MAP report", template: n % 2 ? "Monthly Trend" : "Listing MAP Report",
    template_code: n % 2 ? "monthly_trend" : "listing_map", trigger: "schedule", status: "done", period_from: ago(7 * n + 7), period_to: ago(7 * n), rows: 3 + n,
    rule_set: [{ code: "R-00", version: 1 }, { code: "R-01", version: 1 }], quality_note: n === 3 ? "Data quality: Target failing (blocked). Violations from this source may be undercounted." : null,
    created_at: ago(7 * n - 6), files: [{ kind: "pdf", fileName: `RPT-000${n}.pdf` }, { kind: "csv", fileName: `RPT-000${n}.csv` }],
    deliveries: [{ channel: "hosted", status: "delivered", target: "link" }, { channel: "email", status: "logged", target: "map-room@example.com" }],
  }));
  const alertRules = [
    { id: "a1", code: "A-01", name: "New violating seller", trigger: "new_violating_seller", config: {}, email: true, recipients: ["channel@example.com"], active: true, events_30d: 3 },
    { id: "a2", code: "A-02", name: "Severe violation", trigger: "severe_violation", config: { severity: "Severe" }, email: true, recipients: ["map-room@example.com"], active: true, events_30d: 2 },
    { id: "a3", code: "A-03", name: "Source degraded before a scheduled report", trigger: "source_degraded_before_report", config: { hoursBefore: 24 }, email: true, recipients: [], active: true, events_30d: 1 },
  ];
  const events = [
    { id: "e1", level: "Severe", title: "Severe violation V-00001: 16Z90TL-H.AUB4U1 at Beach Camera", body: "16Z90TL-H.AUB4U1 at $1,499.99 on Walmart.com, 28.5% below MAP $2,099.", created_at: ago(0.2), read_at: null, rule_code: "A-02", rule: "Severe violation" },
    { id: "e2", level: "Standard", title: "New violating seller: certrbtech (eBay)", body: "certrbtech on eBay advertised 15U50U-H.AR55U1 at $605, 3.8% below MAP $629.", created_at: ago(1), read_at: null, rule_code: "A-01", rule: "New violating seller" },
    { id: "e3", level: "Health", title: "Target is failing before \"Weekly MAP report\"", body: "Target is failing (blocked). The report will carry a data-quality note unless collection recovers.", created_at: ago(2), read_at: ago(1.5), rule_code: "A-03", rule: "Source degraded before a scheduled report" },
  ];
  return { rules, templates, definitions, runs, alertRules, events };
}
const S = (client) => { if (!state.has(client.name)) state.set(client.name, seed()); return state.get(client.name); };
const published = (r) => r.versions.find((v) => v.status === "Published") ?? null;
const draftOf = (r) => r.versions.find((v) => v.status === "Draft") ?? null;
const listRow = (r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, is_default: r.is_default, hits_30d: r.hits_30d, published: published(r), draft: draftOf(r) });

export const mockP3 = {
  async rules(client) { return S(client).rules.map(listRow); },
  async rule(client, ruleId) {
    const r = S(client).rules.find((x) => x.id === ruleId);
    return { ...listRow(r), versions: [...r.versions].sort((a, b) => b.version - a.version), replays: r.replays ?? [] };
  },
  async createRule(client, body) {
    const s = S(client);
    const rid = id();
    const code = `R-${String(s.rules.length).padStart(2, "0")}`;
    s.rules.push({ id: rid, code, name: body.name, kind: "Verdict", is_default: false, hits_30d: 0, versions: [{ id: id(), rule_id: rid, version: 1, status: "Draft", severity: SEV, priority: 100, scope: {}, ...body, created_at: new Date().toISOString() }] });
    return { id: rid, code };
  },
  async saveDraft(client, ruleId, body) {
    const r = S(client).rules.find((x) => x.id === ruleId);
    let d = draftOf(r);
    if (!d) { d = { id: id(), rule_id: ruleId, version: Math.max(...r.versions.map((v) => v.version)) + 1, status: "Draft", created_at: new Date().toISOString() }; r.versions.push(d); }
    Object.assign(d, { severity: SEV, priority: 100, scope: {}, ...body, last_dry_run: null });
    return d;
  },
  async discardDraft(client, ruleId) { const r = S(client).rules.find((x) => x.id === ruleId); r.versions = r.versions.filter((v) => v.status !== "Draft"); return { ok: true }; },
  async dryRun(client, ruleId, range) {
    const d = draftOf(S(client).rules.find((x) => x.id === ruleId));
    const result = { observations: 412, listings: 38, violationsLive: 7, violationsCandidate: 9, newlyViolating: 2, noLongerViolating: 0, bySeller: [{ seller: "certrbtech", newly: 2, noLonger: 0 }] };
    d.last_dry_run = { id: id(), range_from: range.from, range_to: range.to, result, created_at: new Date().toISOString() };
    return { id: d.last_dry_run.id, from: range.from, to: range.to, result };
  },
  async publish(client, ruleId) {
    const r = S(client).rules.find((x) => x.id === ruleId);
    const d = draftOf(r);
    if (!d?.last_dry_run) throw new Error("run a dry run of this exact draft before publishing");
    const p = published(r);
    if (p) Object.assign(p, { status: "Closed", valid_to: new Date().toISOString() });
    Object.assign(d, { status: "Published", valid_from: new Date().toISOString() });
    return { published: { id: d.id, version: d.version }, closed: p ? { id: p.id, version: p.version } : null };
  },
  async replay(client, versionId, range) {
    const r = S(client).rules.find((x) => x.versions.some((v) => v.id === versionId));
    const v = r.versions.find((x) => x.id === versionId);
    const summary = { observations: 412, listings: 38, violationsLive: 7, violationsCandidate: 7, newlyViolating: 0, noLongerViolating: 0, bySeller: [] };
    r.replays = [{ id: id(), rule_version_id: versionId, version: v.version, range_from: range.from, range_to: range.to, status: "done", total: 412, processed: 412, summary, created_at: new Date().toISOString() }, ...(r.replays ?? [])];
    // Same shape as the API (202): the run is queued; the demo finishes it at once.
    return { id: r.replays[0].id, status: "queued", total: 412 };
  },

  async reportTemplates(client) { return S(client).templates; },
  async reportDefinitions(client) { return S(client).definitions; },
  async createReportDefinition(client, body) {
    const t = S(client).templates.find((x) => x.code === body.templateCode);
    const d = { id: id(), template_code: body.templateCode, template: t.name, timezone: "America/New_York", visibility: "Account", active: true, destinations: { email: true, hosted: true }, recipients: [], params: {}, ...body, next_run: null, last_run: null };
    S(client).definitions.push(d);
    return d;
  },
  async updateReportDefinition(client, did, body) { const d = S(client).definitions.find((x) => x.id === did); Object.assign(d, body); return d; },
  async runReport(client, did, body) {
    const s = S(client);
    const d = did ? s.definitions.find((x) => x.id === did) : null;
    const seq = s.runs.length + 1;
    const t = s.templates.find((x) => x.code === (d?.template_code ?? body.templateCode));
    const run = { id: id(), seq, code: `RPT-${String(seq).padStart(4, "0")}`, name: d?.name ?? body?.name ?? t.name, template: t.name, template_code: t.code, trigger: "manual", status: "awaiting_pdf",
      period_from: ago(7), period_to: ago(0), rows: 3, rule_set: [{ code: "R-00", version: 1 }, { code: "R-01", version: 1 }], quality_note: null, created_at: new Date().toISOString(), files: [{ kind: "csv", fileName: "report.csv" }], deliveries: [] };
    s.runs.unshift(run);
    return { id: run.id, code: run.code, status: run.status };
  },
  async reportRuns(client) { return S(client).runs; },
  async reportRun(client, runId) {
    const r = S(client).runs.find((x) => x.id === runId);
    return { ...r, files: r.files.map((f) => ({ ...f, url: null })), html: `<!doctype html><body style="font-family:sans-serif;padding:24px"><h2>${r.name}</h2><p>Sample report (mock mode). Connect the portal to the API to see real reports.</p></body>` };
  },
  async reportRunLink() { return { url: `${window.location.origin}/report/mock-token`, expiresAt: new Date(Date.now() + 90 * DAY).toISOString() }; },
  async sftpTest(client, body) {
    return body.hostKey
      ? { ok: true, hostKey: body.hostKey, message: "Wrote and read back a test file (sample data)." }
      : { ok: false, hostKey: "SHA256:mockHostKeyFingerprintAbCdEfGhIjKlMnOpQrStU", message: "confirm the server's host key SHA256:mockHostKeyFingerprintAbCdEfGhIjKlMnOpQrStU" };
  },

  async alertEvents(client, f = {}) {
    const ev = S(client).events;
    return { unread: ev.filter((e) => !e.read_at).length, events: f.unread === true || f.unread === "true" ? ev.filter((e) => !e.read_at) : ev };
  },
  async markAlertsRead(client, body) {
    const ev = S(client).events.filter((e) => !e.read_at && (body.all || body.ids?.includes(e.id)));
    ev.forEach((e) => { e.read_at = new Date().toISOString(); });
    return { marked: ev.length };
  },
  async alertRules(client) { return S(client).alertRules; },
  async updateAlertRule(client, rid, body) {
    const r = S(client).alertRules.find((x) => x.id === rid);
    const { severity, hoursBefore, ...rest } = body;
    Object.assign(r, rest);
    if (severity) r.config = { ...r.config, severity };
    if (hoursBefore) r.config = { ...r.config, hoursBefore };
    return r;
  },
};
