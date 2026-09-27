// Mock-mode stand-in for Data Health (P2b): the same shapes as GET /accounts/:id/health and
// /health/:source/failures, so the screen works without the backend.

const HOUR = 3_600_000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();

function sourceRow(code, name, over) {
  return {
    code, name, subscribed: true, health: "Healthy", checkedAt: ago(3), egress: "render-ohio", lastSuccessAt: ago(3), failureStreak: 0,
    observed: 0, expected: 0, discovered: 0, fetch: { ok: 0, total: 0 }, extraction: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 },
    held: 0, jobs: { planned: 0, executed: 0, skipped: {} }, failures: {}, mainFailure: null, ...over,
  };
}

const SOURCES = () => [
  sourceRow("amazon_us", "Amazon", { health: "Blocked", lastSuccessAt: ago(52), failureStreak: 2, observed: 1, expected: 10, fetch: { ok: 3, total: 29 }, extraction: { ok: 3, total: 3 }, evidence: { ok: 1, total: 1 }, jobs: { planned: 29, executed: 29, skipped: {} }, failures: { blocked: 26 }, mainFailure: "blocked" }),
  sourceRow("bestbuy_us", "Best Buy", { observed: 9, expected: 10, discovered: 41, fetch: { ok: 30, total: 30 }, extraction: { ok: 29, total: 30 }, evidence: { ok: 9, total: 9 }, held: 1, jobs: { planned: 30, executed: 30, skipped: {} }, failures: { layout_changed: 1 }, mainFailure: "layout_changed" }),
  sourceRow("ebay_us", "eBay", { health: "Degraded", failureStreak: 1, observed: 6, expected: 8, discovered: 38, fetch: { ok: 9, total: 10 }, extraction: { ok: 9, total: 9 }, evidence: { ok: 6, total: 6 }, jobs: { planned: 10, executed: 10, skipped: { not_executable: 11 } }, failures: { timeout: 1 }, mainFailure: "timeout" }),
  sourceRow("homedepot_us", "Home Depot", { observed: 3, expected: 3, discovered: 24, fetch: { ok: 5, total: 5 }, extraction: { ok: 5, total: 5 }, evidence: { ok: 3, total: 3 }, jobs: { planned: 5, executed: 5, skipped: { not_executable: 22 } } }),
  sourceRow("target_us", "Target", { health: "Failing", lastSuccessAt: null, failureStreak: 3, observed: 0, expected: 4, fetch: { ok: 0, total: 6 }, extraction: { ok: 0, total: 0 }, jobs: { planned: 6, executed: 6, skipped: { not_executable: 22 } }, failures: { blocked: 6 }, mainFailure: "blocked" }),
  sourceRow("walmart_us", "Walmart", { observed: 8, expected: 8, discovered: 15, fetch: { ok: 10, total: 10 }, extraction: { ok: 10, total: 10 }, evidence: { ok: 8, total: 8 }, jobs: { planned: 10, executed: 10, skipped: { not_executable: 22 } } }),
];

const FAILURES = {
  amazon_us: [
    { id: "f1", kind: "collect", failureClass: "blocked", skipped: false, error: "http gave 200 (captcha), no price; trying browser | blocked: captcha", url: "https://www.amazon.com/dp/B0CVS4CYYF", attempts: 3, method: "browser", at: ago(3), listingTitle: "LG 65-Inch Class OLED evo C4 Series", term: null, evidenceId: null },
    { id: "f2", kind: "discover", failureClass: "blocked", skipped: false, error: "blocked: captcha", url: "https://www.amazon.com/s?k=LG+OLED65C4PUA", attempts: 3, method: "browser", at: ago(3), listingTitle: null, term: "LG OLED65C4PUA", evidenceId: null },
  ],
  target_us: [
    { id: "f3", kind: "discover", failureClass: "blocked", skipped: false, error: "blocked: captcha (Press & hold)", url: "https://www.target.com/b/lg-electronics/-/N-4y41g", attempts: 3, method: "browser", at: ago(3), listingTitle: null, term: "Target brand page", evidenceId: null },
  ],
  walmart_us: [
    { id: "f4", kind: "discover", failureClass: "not_executable", skipped: true, error: null, url: null, attempts: 0, method: null, at: ago(3), listingTitle: null, term: "LG 27GX704A-B", evidenceId: null },
  ],
};

export const mockHealth = {
  async health() {
    const sources = SOURCES();
    const sum = (f) => sources.reduce((n, s) => n + f(s), 0);
    const skipped = sum((s) => Object.values(s.jobs.skipped).reduce((a, b) => a + b, 0));
    const withListings = sources.filter((s) => s.expected > 0);
    return {
      kpis: {
        coverage: Math.round((sum((s) => s.jobs.executed) / (sum((s) => s.jobs.planned) + skipped)) * 1000) / 10,
        freshness: { met: withListings.filter((s) => s.lastSuccessAt && Date.now() - new Date(s.lastSuccessAt).getTime() <= 24 * HOUR).length, total: withListings.length, hours: 24 },
        extraction: Math.round((sum((s) => s.extraction.ok) / sum((s) => s.extraction.total)) * 1000) / 10,
        evidence: Math.round((sum((s) => s.evidence.ok) / sum((s) => s.evidence.total)) * 1000) / 10,
        held: sum((s) => s.held),
      },
      lastRun: { id: "mock-run", startedAt: ago(4), finishedAt: ago(3), status: "finished", egress: "render-ohio", trigger: "schedule" },
      sources,
    };
  },
  async failures(_client, source) {
    return FAILURES[source] ?? [];
  },
  async rerun() {
    return { crawlRunId: "mock-rerun", jobs: 9 };
  },
};
