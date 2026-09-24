// ---------- Mock data (prototype only) ----------
// Shapes follow the MAP Intel data architecture: every row here maps to a table in the blueprint.

export const CLIENTS = [
  { name: "LG", status: "Sandbox", skus: 10, merchants: 6, live: true },
  { name: "Philips", status: "Active", skus: 24, merchants: 7, live: false },
  { name: "Kawasaki", status: "Active", skus: 18, merchants: 5, live: false },
  { name: "Citizen", status: "Active", skus: 12, merchants: 4, live: false },
];

export const SKUS = [
  { id: "LG-001", name: 'LG 55" OLED C4', model: "OLED55C4PUA", upc: "195174055281", category: "TV", map: 1499, msrp: 1799, current: 1395, listings: 9, violations: 3, status: "Active" },
  { id: "LG-002", name: 'LG 65" OLED C4', model: "OLED65C4PUA", upc: "195174055298", category: "TV", map: 1799, msrp: 2299, current: 1799, listings: 8, violations: 0, status: "Active" },
  { id: "LG-003", name: 'LG 27" UltraGear Monitor', model: "27GP850-B", upc: "195174017463", category: "Monitor", map: 349, msrp: 449, current: 299, listings: 12, violations: 4, status: "Active" },
  { id: "LG-004", name: 'LG 75" QNED85', model: "75QNED85UQA", upc: "195174051009", category: "TV", map: 1699, msrp: 1999, current: 1549, listings: 6, violations: 2, status: "Active" },
  { id: "LG-005", name: "LG WM3600HWA Washer", model: "WM3600HWA", upc: "048231802611", category: "Appliance", map: 1149, msrp: 1299, current: 1095, listings: 5, violations: 1, status: "Active" },
  { id: "LG-006", name: 'LG 34" UltraWide Monitor', model: "34WP65C-B", upc: "195174025802", category: "Monitor", map: 449, msrp: 499, current: 449, listings: 7, violations: 0, status: "Active" },
  { id: "LG-007", name: "LG French Door Refrigerator", model: "LRFVS3006S", upc: "048231029537", category: "Appliance", map: 2199, msrp: 2699, current: 1999, listings: 4, violations: 2, status: "Active" },
  { id: "LG-008", name: "LG Soundbar SN7Y", model: "SN7Y", upc: "195174014578", category: "Audio", map: 349, msrp: 499, current: 299, listings: 10, violations: 1, status: "Active" },
  { id: "LG-009", name: 'LG 43" QNED80', model: "43QNED80URA", upc: "195174051245", category: "TV", map: 549, msrp: 649, current: 549, listings: 3, violations: 0, status: "Paused" },
  { id: "LG-010", name: "LG UltraGear 34GP63A", model: "34GP63A-B", upc: "195174024454", category: "Monitor", map: 379, msrp: 449, current: 329, listings: 6, violations: 1, status: "Active" },
];

// Sellers = storefronts on a source. Classification is effective-dated (history kept).
export const SELLERS = [
  { name: "XYZ Electronics", source: "Amazon", classification: "Unauthorised", risk: 82, tracked: 10, violations: 8, repeat: 5, avgDepth: 11.4, ttc: "6.2d", compliance: 74, aliases: ["XYZ Electronics LLC", "XYZ-Elec"], contact: "compliance@xyzelec.example" },
  { name: "TechMart", source: "Walmart", classification: "Unauthorised", risk: 64, tracked: 5, violations: 3, repeat: 2, avgDepth: 11.0, ttc: "3.9d", compliance: 88, aliases: ["TechMart Deals"], contact: "ops@techmart.example" },
  { name: "Best Buy", source: "Best Buy", classification: "MAP Authorised", risk: 31, tracked: 8, violations: 4, repeat: 1, avgDepth: 5.7, ttc: "1.4d", compliance: 96, aliases: [], contact: "vendor-relations@bestbuy.example" },
  { name: "PrimeDeals Outlet", source: "eBay", classification: "Unknown", risk: 57, tracked: 4, violations: 2, repeat: 0, avgDepth: 9.8, ttc: "—", compliance: 81, aliases: ["primedeals_outlet"], contact: "" },
  { name: "Home Depot", source: "Home Depot", classification: "MAP Authorised", risk: 12, tracked: 3, violations: 0, repeat: 0, avgDepth: 0, ttc: "—", compliance: 100, aliases: [], contact: "vendor@homedepot.example" },
  { name: "LG.com", source: "LG.com", classification: "Brand Direct", risk: 0, tracked: 10, violations: 0, repeat: 0, avgDepth: 0, ttc: "—", compliance: 100, aliases: [], contact: "" },
];

// Violation = a rule verdict against one observation. Stores MAP version + rule version used.
export const VIOLATIONS = [
  { id: "VIO-0123", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", sellerClass: "Unauthorised", map: 1499, advertised: 1395, gap: -6.9, duration: "6h", firstSeen: "Sep 23, 04:10 UTC", severity: "Standard", status: "Open", ruleV: "R-01 v3", mapV: "MAP v2 (from Jul 01)", caseId: null },
  { id: "VIO-0124", sku: "LG-003", product: 'LG 27" UltraGear Monitor', merchant: "XYZ Electronics (Amazon)", sellerClass: "Unauthorised", map: 349, advertised: 299, gap: -14.3, duration: "2d", firstSeen: "Sep 21, 11:40 UTC", severity: "Standard", status: "Under notice", ruleV: "R-01 v3", mapV: "MAP v1", caseId: "CASE-0042" },
  { id: "VIO-0125", sku: "LG-005", product: "LG WM3600HWA Washer", merchant: "Best Buy", sellerClass: "MAP Authorised", map: 1149, advertised: 1095, gap: -4.7, duration: "1d", firstSeen: "Sep 22, 09:05 UTC", severity: "Minor", status: "Under notice", ruleV: "R-01 v3", mapV: "MAP v1", caseId: "CASE-0041" },
  { id: "VIO-0126", sku: "LG-004", product: 'LG 75" QNED85', merchant: "TechMart (Walmart)", sellerClass: "Unauthorised", map: 1699, advertised: 1549, gap: -8.8, duration: "3d", firstSeen: "Sep 20, 16:22 UTC", severity: "Standard", status: "Open", ruleV: "R-01 v3", mapV: "MAP v3 (from Sep 01)", caseId: null },
  { id: "VIO-0127", sku: "LG-008", product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", sellerClass: "Unauthorised", map: 349, advertised: 299, gap: -14.3, duration: "12h", firstSeen: "Sep 18, 07:30 UTC", severity: "Standard", status: "Resolved", ruleV: "R-01 v2", mapV: "MAP v1", caseId: "CASE-0038" },
  { id: "VIO-0128", sku: "LG-007", product: "LG French Door Refrigerator", merchant: "PrimeDeals Outlet (eBay)", sellerClass: "Unknown", map: 2199, advertised: 1799, gap: -18.2, duration: "5d", firstSeen: "Sep 18, 13:55 UTC", severity: "Severe", status: "Needs review", ruleV: "R-01 v3", mapV: "MAP v1", caseId: null, reviewReason: "Listing text mentions 'open box' — possible used/refurbished" },
  { id: "VIO-0129", sku: "LG-010", product: "LG UltraGear 34GP63A", merchant: "TechMart (Walmart)", sellerClass: "Unauthorised", map: 379, advertised: 329, gap: -13.2, duration: "2d", firstSeen: "Sep 21, 08:12 UTC", severity: "Standard", status: "Open", ruleV: "R-01 v3", mapV: "MAP v1", caseId: null },
  { id: "VIO-0130", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "Best Buy", sellerClass: "MAP Authorised", map: 1499, advertised: 1399, gap: -6.7, duration: "4h", firstSeen: "Sep 23, 06:00 UTC", severity: "Minor", status: "Authorised promo", ruleV: "R-01 v3", mapV: "Promo window PW-07", caseId: null },
  { id: "VIO-0131", sku: "LG-003", product: 'LG 27" UltraGear Monitor', merchant: "PrimeDeals Outlet (eBay)", sellerClass: "Unknown", map: 349, advertised: 255, gap: -26.9, duration: "1d", firstSeen: "Sep 22, 19:44 UTC", severity: "Severe", status: "Open", ruleV: "R-01 v3", mapV: "MAP v1", caseId: null },
  { id: "VIO-0132", sku: "LG-008", product: "LG Soundbar SN7Y", merchant: "TechMart (Walmart)", sellerClass: "Unauthorised", map: 349, advertised: 342, gap: -2.0, duration: "8h", firstSeen: "Sep 23, 01:00 UTC", severity: "Minor", status: "Dismissed", ruleV: "R-01 v3", mapV: "MAP v1", caseId: null, dismissReason: "Within 2% tolerance after shipping rule fix" },
];

// Listing lifecycle: Staged → Included / Excluded → Retired
export const MAPPING_STAGE = [
  { id: "L-88121", product: "LG 55 OLED C4 Series 4K Smart TV", merchant: "XYZ Electronics (Amazon)", price: 1395, match: "LG-001", confidence: 86, signals: { identifier: "ASIN in URL matches", title: 0.88, image: 0.93, price: "plausible", attributes: "55 in · 2024" } },
  { id: "L-88122", product: "LG OLED C4 55 inch TV (Open Box)", merchant: "PrimeDeals Outlet (eBay)", price: 1180, match: "LG-001", confidence: 72, signals: { identifier: "no identifier", title: 0.81, image: 0.90, price: "21% below MAP", attributes: "condition: open box" } },
  { id: "L-88123", product: 'LG 27" UltraGear 27GP850 Gaming Monitor', merchant: "TechMart (Walmart)", price: 299, match: "LG-003", confidence: 88, signals: { identifier: "MPN matches", title: 0.84, image: 0.71, price: "plausible", attributes: "27 in" } },
  { id: "L-88124", product: "LG Soundbar SN7Y + Rear Speaker Kit Bundle", merchant: "XYZ Electronics (Amazon)", price: 419, match: "LG-008", confidence: 64, signals: { identifier: "no identifier", title: 0.69, image: 0.55, price: "above MAP", attributes: "bundle: 2 items" } },
];

export const MAPPING_INCLUDE = [
  { product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", url: "amazon.com/dp/B0CVS3X1YZ", mappedOn: "Sep 23, 2026", by: "Auto Rule", confidence: 98 },
  { product: 'LG 27" UltraGear Monitor', merchant: "Best Buy", url: "bestbuy.com/site/6577865", mappedOn: "Sep 22, 2026", by: "Auto Rule", confidence: 99 },
  { product: "LG WM3600HWA Washer", merchant: "TechMart (Walmart)", url: "walmart.com/ip/7a9f10e3", mappedOn: "Sep 21, 2026", by: "Analyst", confidence: 86 },
];

export const MAPPING_EXCLUDE = [
  { product: "LG Soundbar SN7Y (Renewed)", merchant: "XYZ Electronics (Amazon)", reason: "Used or refurbished", scope: "Seller + product", excludedOn: "Sep 21, 2026", by: "Rule AE: Used Products" },
  { product: "LG Remote Control AKB75095307", merchant: "Best Buy", reason: "Accessory or part", scope: "URL pattern", excludedOn: "Sep 22, 2026", by: "analyst@mirethos.com" },
  { product: 'LG 55" OLED C3 (Old Model)', merchant: "TechMart (Walmart)", reason: "Wrong variant", scope: "This listing", excludedOn: "Sep 21, 2026", by: "analyst@mirethos.com" },
  { product: "LG OLED C4 — Amazon Warehouse", merchant: "Amazon Warehouse", reason: "Not a purchasable offer", scope: "Source", excludedOn: "Sep 20, 2026", by: "Rule AE: Warehouse Deals" },
];

export const MAPPING_RETIRED = [
  { product: 'LG 65" OLED C3', merchant: "TechMart (Walmart)", lastSeen: "Aug 30, 2026", reason: "Absent from 5 consecutive successful crawls" },
];

export const SUPPRESSIONS = [
  { rule: "Exclude URL pattern */accessories/*", reason: "Accessory or part", scope: "bestbuy.com", created: "Sep 22, 2026", hits: 41 },
  { rule: "Exclude seller 'XYZ Electronics' + condition 'Renewed'", reason: "Used or refurbished", scope: "Seller + product", created: "Sep 21, 2026", hits: 6 },
];

// MAP is a time series, never a single overwritten value.
export const MAP_HISTORY = [
  { sku: "LG-001", product: 'LG 55" OLED C4', version: "v2", amount: 1499, from: "Jul 01, 2026", to: "—", region: "All", source: "Import IMP-014" },
  { sku: "LG-001", product: 'LG 55" OLED C4', version: "v1", amount: 1599, from: "Mar 01, 2026", to: "Jun 30, 2026", region: "All", source: "Import IMP-006" },
  { sku: "LG-004", product: 'LG 75" QNED85', version: "v3", amount: 1699, from: "Sep 01, 2026", to: "—", region: "US", source: "Manual — Fenil D." },
  { sku: "LG-004", product: 'LG 75" QNED85', version: "v2", amount: 1799, from: "May 01, 2026", to: "Aug 31, 2026", region: "US", source: "Import IMP-009" },
  { sku: "LG-003", product: 'LG 27" UltraGear Monitor', version: "v1", amount: 349, from: "Jan 15, 2026", to: "—", region: "All", source: "Import IMP-001" },
];

export const PROMOTIONS = [
  { id: "PW-07", sku: 'LG 55" OLED C4', standard: 1499, promo: 1399, from: "Sep 20, 2026", until: "Sep 27, 2026", sellers: "MAP Authorised only", status: "Active" },
  { id: "PW-08", sku: 'LG 27" UltraGear Monitor', standard: 349, promo: 299, from: "Nov 24, 2026", until: "Dec 01, 2026", sellers: "All sellers", status: "Scheduled" },
  { id: "PW-05", sku: "LG Soundbar SN7Y", standard: 349, promo: 319, from: "Jul 01, 2026", until: "Jul 07, 2026", sellers: "All sellers", status: "Ended" },
];

export const POLICY_DOCS = [
  { name: "LG US Unilateral MAP Policy", version: "2026.2", effective: "Jul 01, 2026", uploaded: "Jun 24, 2026", usedBy: "Rules R-01, letter templates T-1, T-2", status: "In force" },
  { name: "LG US Unilateral MAP Policy", version: "2026.1", effective: "Jan 01, 2026", uploaded: "Dec 18, 2025", usedBy: "Violations before Jul 01", status: "Superseded" },
];

// Enforcement case = violations grouped by seller + product set + period.
export const CASES = [
  { id: "CASE-0042", seller: "XYZ Electronics", source: "Amazon", violations: 3, products: "LG-001, LG-003, LG-008", state: "Awaiting response", owner: "Fenil Dholaviya", opened: "Sep 21, 2026", due: "Sep 26, 2026", channel: "Email + Amazon Brand Registry" },
  { id: "CASE-0041", seller: "Best Buy", source: "Best Buy", violations: 1, products: "LG-005", state: "Notice sent", owner: "analyst@mirethos.com", opened: "Sep 22, 2026", due: "Sep 29, 2026", channel: "Email" },
  { id: "CASE-0040", seller: "TechMart", source: "Walmart", violations: 2, products: "LG-004, LG-010", state: "Open", owner: "Unassigned", opened: "Sep 23, 2026", due: "—", channel: "—" },
  { id: "CASE-0038", seller: "XYZ Electronics", source: "Amazon", violations: 1, products: "LG-008", state: "Resolved", owner: "Fenil Dholaviya", opened: "Sep 18, 2026", due: "—", channel: "Email" },
  { id: "CASE-0031", seller: "PrimeDeals Outlet", source: "eBay", violations: 4, products: "LG-003, LG-007", state: "Contested", owner: "analyst@mirethos.com", opened: "Sep 09, 2026", due: "Sep 24, 2026", channel: "eBay VeRO" },
];

export const EMAILS = [
  { date: "Sep 21, 2026", seller: "XYZ Electronics", violation: "CASE-0042", template: "First Warning", status: "Delivered", opened: "Yes", response: "Pending" },
  { date: "Sep 22, 2026", seller: "Best Buy", violation: "CASE-0041", template: "MAP Reminder (Authorised)", status: "Delivered", opened: "No", response: "Awaited" },
  { date: "Sep 18, 2026", seller: "XYZ Electronics", violation: "CASE-0038", template: "First Warning", status: "Delivered", opened: "Yes", response: "Resolved" },
];

export const SOURCES = [
  { name: "Amazon US", family: "Amazon", category: "Marketplace", country: "US", type: "Advanced", subscribed: true, health: "Healthy", lastRun: "Sep 23, 06:00 UTC", listings: 412, expected: 405, streak: 0 },
  { name: "Walmart US", family: "Walmart", category: "Marketplace", country: "US", type: "Advanced", subscribed: true, health: "Healthy", lastRun: "Sep 23, 06:10 UTC", listings: 188, expected: 190, streak: 0 },
  { name: "Best Buy", family: "Best Buy", category: "Online Seller", country: "US", type: "Basic", subscribed: true, health: "Degraded", lastRun: "Sep 22, 06:05 UTC", listings: 61, expected: 96, streak: 1, error: "Layout changed" },
  { name: "eBay US", family: "eBay", category: "Marketplace", country: "US", type: "Advanced", subscribed: true, health: "Healthy", lastRun: "Sep 23, 05:40 UTC", listings: 239, expected: 221, streak: 0 },
  { name: "Home Depot", family: "Home Depot", category: "Online Seller", country: "US", type: "Basic", subscribed: true, health: "Failing", lastRun: "Sep 20, 06:02 UTC", listings: 0, expected: 34, streak: 3, error: "Blocked (403)" },
  { name: "Google Shopping", family: "Google", category: "Price Comparison", country: "US", type: "Basic", subscribed: false, health: "Healthy", lastRun: "—", listings: 0, expected: 0, streak: 0 },
  { name: "Target", family: "Target", category: "Online Seller", country: "US", type: "Basic", subscribed: false, health: "Healthy", lastRun: "—", listings: 0, expected: 0, streak: 0 },
];

export const TERM_GROUPS = [
  { name: "F26: Brand + Product Name", terms: 10, active: 10, lastRun: "Sep 23", yield30: 318, matrix: { Marketplace: "All", "Online Seller": "All", "Price Comparison": "None" }, cost: 1240 },
  { name: "Identifiers (UPC / MPN)", terms: 20, active: 20, lastRun: "Sep 23", yield30: 204, matrix: { Marketplace: "All", "Online Seller": "Some", "Price Comparison": "None" }, cost: 860 },
  { name: "Known offender storefronts", terms: 3, active: 3, lastRun: "Sep 23", yield30: 57, matrix: { Marketplace: "Some", "Online Seller": "None", "Price Comparison": "None" }, cost: 90 },
  { name: "S26: Manufacturer + Product", terms: 10, active: 4, lastRun: "Sep 16", yield30: 3, matrix: { Marketplace: "Some", "Online Seller": "None", "Price Comparison": "None" }, cost: 210, stale: true },
];

export const TERMS = [
  { term: "LG OLED55C4PUA", type: "Identifier", product: "LG-001", group: "Identifiers (UPC / MPN)", yield: 34, survived: 91, violations: 3 },
  { term: "LG 55 inch OLED C4", type: "Keyword", product: "LG-001", group: "F26: Brand + Product Name", yield: 58, survived: 41, violations: 2 },
  { term: "amazon.com/stores/XYZElectronics", type: "Seller", product: "—", group: "Known offender storefronts", yield: 22, survived: 77, violations: 5 },
  { term: "LG UltraGear 27GP850", type: "Keyword", product: "LG-003", group: "F26: Brand + Product Name", yield: 41, survived: 63, violations: 4 },
  { term: "LG Monitor Accessories", type: "Keyword", product: "—", group: "S26: Manufacturer + Product", yield: 0, survived: 0, violations: 0, retire: true },
];

export const SCHEDULES = [
  { name: "Daily marketplace sweep", scope: "Category: Marketplace", listingScope: "Included and Staged", status: "Active only", takedown: "All", cadence: "Daily 06:00 UTC", next: "Sep 24, 06:00 UTC", priority: 10 },
  { name: "Under-notice re-check", scope: "All sources", listingScope: "Included only", status: "All", takedown: "Under notice", cadence: "Every 6 hours", next: "Sep 23, 12:00 UTC", priority: 20 },
  { name: "Weekly inactive monitoring run", scope: "All sources", listingScope: "Included only", status: "Inactive only", takedown: "All", cadence: "Weekly on Monday", next: "Sep 28, 03:00 UTC", priority: 5 },
];

export const RULES = [
  { id: "R-01", name: "Below MAP — US marketplaces & retailers", kind: "Verdict", action: "Violation, severity by depth", scope: "All products · All sources · US", version: 3, hits: 212, status: "Active", seeded: false },
  { id: "R-02", name: "Brand Direct is never a violation", kind: "Verdict", action: "Compliant", scope: "Seller class = Brand Direct", version: 1, hits: 48, status: "Active", seeded: false },
  { id: "AI-01", name: "AI: ASIN / MPN in URL", kind: "Inclusion", action: "Include listing", scope: "Amazon family", version: 2, hits: 391, status: "Active", seeded: true },
  { id: "AI-02", name: "AI: Colour / size attribute match", kind: "Inclusion", action: "Include listing", scope: "All sources", version: 1, hits: 77, status: "Active", seeded: true },
  { id: "AE-01", name: "AE: Amazon Warehouse Deals — All", kind: "Exclusion", action: "Exclude listing", scope: "Amazon family", version: 1, hits: 19, status: "Active", seeded: true },
  { id: "AE-02", name: "AE: Used / refurbished / open box", kind: "Exclusion", action: "Exclude listing", scope: "All sources", version: 2, hits: 36, status: "Active", seeded: true },
  { id: "AE-03", name: "AE: Bidding (auction) listings", kind: "Exclusion", action: "Exclude listing", scope: "eBay family", version: 1, hits: 11, status: "Active", seeded: true },
  { id: "CS-01", name: "Set cleansing score = 10 for known storefronts", kind: "Score", action: "Set match score", scope: "Term group: Known offender storefronts", version: 1, hits: 22, status: "Draft", seeded: true },
];

export const REPORTS = [
  { name: "Weekly MAP Report", template: "Listing MAP Report", freq: "Weekly · Mon 08:00", recipients: "LG MAP Room (list)", destinations: ["Email", "Hosted link", "SFTP"], lastRun: "Sep 21, 08:00 AM", format: "Excel", adoption: 4, visibility: "Brand visible" },
  { name: "Monthly Trend Deck", template: "Monthly Trend", freq: "Monthly · 1st", recipients: "LG Leadership (list)", destinations: ["Email", "Hosted link"], lastRun: "Sep 01, 06:00 AM", format: "PDF", adoption: 4, visibility: "Brand visible" },
  { name: "Unauthorised Sellers", template: "Seller Detail", freq: "Weekly · Mon 08:00", recipients: "channel@lg.com", destinations: ["Email"], lastRun: "Sep 21, 06:00 AM", format: "Excel", adoption: 2, visibility: "Brand visible" },
  { name: "Enforcement Summary", template: "Enforcement Summary", freq: "Weekly · Fri 17:00", recipients: "Mirethos Ops", destinations: ["Email"], lastRun: "Sep 19, 05:00 PM", format: "PDF", adoption: 1, visibility: "Internal only" },
];

export const REPORT_RUNS = [
  { name: "Weekly MAP Report", period: "Sep 14 – Sep 20", generated: "Sep 21, 08:00", rows: 38, delivery: "Delivered (3/3)", quality: "OK", ruleSet: "R-01 v3" },
  { name: "Weekly MAP Report", period: "Sep 07 – Sep 13", generated: "Sep 14, 08:00", rows: 29, delivery: "Delivered (3/3)", quality: "Best Buy degraded Sep 10–11", ruleSet: "R-01 v2" },
  { name: "Monthly Trend Deck", period: "August 2026", generated: "Sep 01, 06:00", rows: 142, delivery: "Delivered (2/2)", quality: "OK", ruleSet: "R-01 v2" },
];

export const ALERTS = [
  { name: "New violating seller appears", condition: "First violation by a seller", channel: "Email + Slack", recipients: "Account manager", on: true },
  { name: "Severe violation", condition: "Depth > 15% below MAP", channel: "Email + Dashboard", recipients: "Account manager, LG brand", on: true },
  { name: "Compliant listing drops below MAP", condition: "Status change → below MAP", channel: "Dashboard", recipients: "Analyst", on: true },
  { name: "Listing under notice changes", condition: "Price change or disappears", channel: "Email", recipients: "Case owner", on: true },
  { name: "Source health degrades before report", condition: "Degraded < 24h before scheduled run", channel: "Email + Slack", recipients: "Analyst", on: true },
];

export const ALERT_INBOX = [
  { time: "Today, 09:12", text: "PrimeDeals Outlet (eBay) listed LG-003 at $255 — 26.9% below MAP", level: "Severe" },
  { time: "Today, 06:20", text: "Best Buy collection degraded (layout changed) — Weekly MAP Report runs Mon 08:00", level: "Health" },
  { time: "Yesterday, 18:03", text: "CASE-0042: XYZ Electronics changed price on LG-001 to $1,449 (still below MAP)", level: "Case" },
];

export const USERS = [
  { name: "Fenil Dholaviya", role: "Account Manager", access: "Configure sources, rules, reports", lastActive: "Today, 10:15 AM", status: "Active" },
  { name: "analyst@mirethos.com", role: "Analyst", access: "Cleanse, classify, cases, reports", lastActive: "Today, 09:48 AM", status: "Active" },
  { name: "viewer@lg.com", role: "Brand User", access: "Own account: violations + reports (read)", lastActive: "Yesterday, 04:30 PM", status: "Active" },
  { name: "ops@mirethos.com", role: "Administrator", access: "Source catalogue, accounts, users", lastActive: "Sep 20, 11:02 AM", status: "Active" },
];

export const AUDIT = [
  { time: "Today, 10:15 AM", user: "Fenil Dholaviya", action: "Sent notice for CASE-0042 (3 violations, evidence bundle frozen)", before: "Open", after: "Notice sent" },
  { time: "Today, 09:50 AM", user: "Rule AI-01 v2", action: "Auto-included listing L-88090 → LG-003", before: "Staged", after: "Included" },
  { time: "Today, 09:31 AM", user: "Fenil Dholaviya", action: "Changed MAP for LG-004 (new version v3 from Sep 01)", before: "$1,799", after: "$1,699" },
  { time: "Yesterday, 04:12 PM", user: "analyst@mirethos.com", action: "Excluded 'LG Remote Control' — Accessory, scope: URL pattern", before: "Staged", after: "Excluded" },
  { time: "Yesterday, 02:40 PM", user: "analyst@mirethos.com", action: "Reclassified PrimeDeals Outlet", before: "Unauthorised", after: "Unknown" },
];

export const SEVERITY_COLORS = { Severe: "#dc2626", Standard: "#ea580c", Minor: "#f59e0b" };
export const SEVERITY_BG = {
  Severe: "bg-red-50 text-red-700 border-red-200",
  Standard: "bg-orange-50 text-orange-700 border-orange-200",
  Minor: "bg-amber-50 text-amber-700 border-amber-200",
};
export const STATUS_BG = {
  Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Paused: "bg-slate-50 text-slate-700 border-slate-200",
  Open: "bg-red-50 text-red-700 border-red-200",
  "Needs review": "bg-amber-50 text-amber-700 border-amber-200",
  "Under notice": "bg-orange-50 text-orange-700 border-orange-200",
  "Notice sent": "bg-orange-50 text-orange-700 border-orange-200",
  "Awaiting response": "bg-orange-50 text-orange-700 border-orange-200",
  Contested: "bg-purple-50 text-purple-700 border-purple-200",
  Escalated: "bg-red-50 text-red-700 border-red-200",
  Resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Authorised promo": "bg-blue-50 text-blue-700 border-blue-200",
  Dismissed: "bg-slate-50 text-slate-700 border-slate-200",
  Scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  Ended: "bg-slate-50 text-slate-700 border-slate-200",
  Delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Draft: "bg-slate-50 text-slate-700 border-slate-200",
  "In force": "bg-emerald-50 text-emerald-700 border-emerald-200",
  Superseded: "bg-slate-50 text-slate-700 border-slate-200",
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Degraded: "bg-amber-50 text-amber-700 border-amber-200",
  Failing: "bg-red-50 text-red-700 border-red-200",
};
export const CLASS_BG = {
  "MAP Authorised": "bg-emerald-50 text-emerald-700 border-emerald-200",
  Unauthorised: "bg-red-50 text-red-700 border-red-200",
  "Brand Direct": "bg-blue-50 text-blue-700 border-blue-200",
  Unknown: "bg-slate-50 text-slate-700 border-slate-200",
};

export const SEVERITY_DIST = [
  { name: "Severe", value: 6, color: SEVERITY_COLORS.Severe },
  { name: "Standard", value: 11, color: SEVERITY_COLORS.Standard },
  { name: "Minor", value: 7, color: SEVERITY_COLORS.Minor },
];

// Violations by day, split by seller classification (the legacy deck's headline chart).
export const TREND = [
  { day: "Sep 17", unauth: 7, auth: 2, degraded: false }, { day: "Sep 18", unauth: 9, auth: 3, degraded: false },
  { day: "Sep 19", unauth: 12, auth: 3, degraded: false }, { day: "Sep 20", unauth: 13, auth: 4, degraded: false },
  { day: "Sep 21", unauth: 16, auth: 4, degraded: false }, { day: "Sep 22", unauth: 17, auth: 5, degraded: true },
  { day: "Sep 23", unauth: 18, auth: 6, degraded: false },
];

export const PRICE_HISTORY = [
  { d: "Sep 17", p: 1499 }, { d: "Sep 18", p: 1499 }, { d: "Sep 19", p: 1479 }, { d: "Sep 20", p: 1449 },
  { d: "Sep 21", p: 1449 }, { d: "Sep 22", p: 1419 }, { d: "Sep 23", p: 1395 },
];
