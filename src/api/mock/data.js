// Mock data for screens whose backend arrives in a later phase.
// Moved out of App.jsx unchanged in Phase 0; the API client (../client.js) serves it.

export const CLIENTS = [
  { name: "LG", status: "Sandbox", skus: 10, merchants: 3, live: true },
  { name: "Philips", status: "Active", skus: 24, merchants: 7, live: false },
  { name: "Kawasaki", status: "Active", skus: 18, merchants: 5, live: false },
  { name: "Citizen", status: "Active", skus: 12, merchants: 4, live: false },
];

export const SKUS = [
  { id: "LG-001", name: 'LG 55" OLED C4', model: "OLED55C4PUA", category: "TV", map: 1499, current: 1395, violations: 3, status: "Active" },
  { id: "LG-002", name: 'LG 65" OLED C4', model: "OLED65C4PUA", category: "TV", map: 1799, current: 1799, violations: 0, status: "Active" },
  { id: "LG-003", name: 'LG 27" UltraGear Monitor', model: "27GP850-B", category: "Monitor", map: 349, current: 299, violations: 4, status: "Active" },
  { id: "LG-004", name: 'LG 75" QNED85', model: "75QNED85UQA", category: "TV", map: 1699, current: 1549, violations: 2, status: "Active" },
  { id: "LG-005", name: "LG WM3600HWA Washer", model: "WM3600HWA", category: "Appliance", map: 1149, current: 1095, violations: 1, status: "Active" },
  { id: "LG-006", name: 'LG 34" UltraWide Monitor', model: "34WP65C-B", category: "Monitor", map: 449, current: 449, violations: 0, status: "Active" },
  { id: "LG-007", name: "LG French Door Refrigerator", model: "LRFVS3006S", category: "Appliance", map: 2199, current: 1999, violations: 2, status: "Active" },
  { id: "LG-008", name: "LG Soundbar SN7Y", model: "SN7Y", category: "Audio", map: 349, current: 299, violations: 1, status: "Active" },
  { id: "LG-009", name: 'LG 43" QNED80', model: "43QNED80URA", category: "TV", map: 549, current: 549, violations: 0, status: "Paused" },
  { id: "LG-010", name: "LG UltraGear 34GP63A", model: "34GP63A-B", category: "Monitor", map: 379, current: 329, violations: 1, status: "Active" },
];

export const MERCHANTS = [
  { name: "XYZ Electronics", type: "Marketplace (Amazon)", tracked: 10, violations: 8, compliance: 74 },
  { name: "Best Buy", type: "Retailer", tracked: 8, violations: 4, compliance: 96 },
  { name: "TechMart", type: "Marketplace (Walmart)", tracked: 5, violations: 3, compliance: 88 },
];

export const VIOLATIONS = [
  { id: "VIO-0123", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", map: 1499, advertised: 1395, gap: -6.9, duration: "6h", severity: "Critical", status: "Open" },
  { id: "VIO-0124", sku: "LG-003", product: 'LG 27" UltraGear Monitor', merchant: "XYZ Electronics (Amazon)", map: 349, advertised: 299, gap: -14.3, duration: "2d", severity: "Critical", status: "Open" },
  { id: "VIO-0125", sku: "LG-005", product: "LG WM3600HWA Washer", merchant: "Best Buy", map: 1149, advertised: 1095, gap: -4.7, duration: "1d", severity: "Medium", status: "Notified" },
  { id: "VIO-0126", sku: "LG-004", product: 'LG 75" QNED85', merchant: "TechMart (Walmart)", map: 1699, advertised: 1549, gap: -8.8, duration: "3d", severity: "High", status: "Open" },
  { id: "VIO-0127", sku: "LG-008", product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", map: 349, advertised: 299, gap: -14.3, duration: "12h", severity: "High", status: "Resolved" },
  { id: "VIO-0128", sku: "LG-007", product: "LG French Door Refrigerator", merchant: "Best Buy", map: 2199, advertised: 1999, gap: -9.1, duration: "5d", severity: "Critical", status: "Open" },
  { id: "VIO-0129", sku: "LG-010", product: "LG UltraGear 34GP63A", merchant: "TechMart (Walmart)", map: 379, advertised: 329, gap: -13.2, duration: "2d", severity: "Medium", status: "Notified" },
  { id: "VIO-0130", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "Best Buy", map: 1499, advertised: 1450, gap: -3.3, duration: "4h", severity: "Low", status: "Open" },
];

export const MAPPING_STAGE = [
  { product: "LG 55 OLED C4 Series", merchant: "XYZ Electronics (Amazon)", price: 1395, match: "LG-001", confidence: 98 },
  { product: "LG OLED C4 55 inch TV", merchant: "Best Buy", price: 1450, match: "LG-001", confidence: 95 },
  { product: 'LG 27" UltraGear Monitor', merchant: "TechMart (Walmart)", price: 299, match: "LG-003", confidence: 99 },
  { product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", price: 299, match: null, confidence: 61 },
];

export const MAPPING_INCLUDE = [
  { product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", url: "amazon.com/8OCIH3F3Q8", mappedOn: "Aug 23, 2026", by: "Auto Rule" },
  { product: 'LG 27" UltraGear Monitor', merchant: "Best Buy", url: "bestbuy.com/site/6577865", mappedOn: "Aug 22, 2026", by: "Auto Rule" },
  { product: "LG WM3600HWA Washer", merchant: "TechMart (Walmart)", url: "walmart.com/ip/7a9f10e3", mappedOn: "Aug 21, 2026", by: "Analyst" },
];

export const MAPPING_EXCLUDE = [
  { product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", reason: "Accessory", excludedOn: "Aug 21, 2026" },
  { product: "LG Remote Control", merchant: "Best Buy", reason: "Accessory", excludedOn: "Aug 22, 2026" },
  { product: 'LG 55" OLED C3 (Old Model)', merchant: "TechMart (Walmart)", reason: "Out of scope", excludedOn: "Aug 21, 2026" },
];

export const PROMOTIONS = [
  { sku: 'LG 55" OLED C4', standard: 1499, promo: 1399, from: "Aug 17, 2026", until: "Aug 23, 2026", status: "Active" },
  { sku: 'LG 27" UltraGear Monitor', standard: 349, promo: 299, from: "Sep 01, 2026", until: "Sep 07, 2026", status: "Scheduled" },
];

export const EMAILS = [
  { date: "Aug 23, 2026", seller: "XYZ Electronics", violation: "VIO-0123", template: "First Warning", status: "Delivered", opened: "Yes", response: "Pending" },
  { date: "Aug 22, 2026", seller: "TechMart", violation: "VIO-0124", template: "MAP Notice", status: "Delivered", opened: "No", response: "Awaited" },
  { date: "Aug 21, 2026", seller: "Best Buy", violation: "VIO-0125", template: "MAP Reminder", status: "Delivered", opened: "Yes", response: "Resolved" },
];

export const REPORTS = [
  { name: "Daily MAP Violations", freq: "Daily", recipients: "map-room@lg.com", lastRun: "Aug 23, 08:00 AM", format: "Excel" },
  { name: "Weekly Compliance Summary", freq: "Weekly", recipients: "leadership@lg.com", lastRun: "Aug 18, 06:00 AM", format: "PDF" },
  { name: "Unauthorized Sellers", freq: "Weekly", recipients: "channel@lg.com", lastRun: "Aug 18, 06:00 AM", format: "Excel" },
];

export const ALERTS = [
  { name: "Critical MAP violation", condition: "Gap > 10%", channel: "Email + Dashboard", recipients: "map-room@lg.com" },
  { name: "New unauthorized seller", condition: "New seller detected", channel: "Email", recipients: "channel@lg.com" },
  { name: "Promotion ending soon", condition: "Ends in 2 days", channel: "Dashboard", recipients: "map-room@lg.com" },
];

// Unread alert events (drives the sidebar badge). Real alert events arrive in Phase 3.
export const ALERT_EVENTS = [
  { id: "ALT-1", rule: "Critical MAP violation", read: false },
  { id: "ALT-2", rule: "New unauthorized seller", read: false },
  { id: "ALT-3", rule: "Promotion ending soon", read: false },
];

export const USERS = [
  { name: "Fenil Dholaviya", role: "Client Admin", access: "Full Access", lastActive: "Today, 10:15 AM", status: "Active" },
  { name: "analyst@mirethos.com", role: "MAP Analyst", access: "MAP + Violations", lastActive: "Today, 09:48 AM", status: "Active" },
  { name: "viewer@lg.com", role: "Viewer", access: "Read Only", lastActive: "Yesterday, 04:30 PM", status: "Active" },
];

export const AUDIT_LOG = [
  { time: "Today, 10:15 AM", user: "Fenil Dholaviya", action: "Sent violation email for VIO-0123" },
  { time: "Today, 09:50 AM", user: "Auto Rule", action: "Mapped LG-003 to XYZ Electronics" },
  { time: "Yesterday, 04:12 PM", user: "analyst@mirethos.com", action: "Excluded LG Remote Control from tracking" },
];

export const SEVERITY_DIST = [
  { name: "Critical", value: 5 },
  { name: "High", value: 8 },
  { name: "Medium", value: 7 },
  { name: "Low", value: 4 },
];

export const TREND = [
  { day: "Aug 16", count: 10 }, { day: "Aug 17", count: 13 }, { day: "Aug 18", count: 18 },
  { day: "Aug 19", count: 20 }, { day: "Aug 20", count: 24 }, { day: "Aug 21", count: 24 },
  { day: "Aug 22", count: 24 },
];

/** Mock workspace for one client (same generator as before Phase 0, but works for any client name). */
export function mockWorkspace(clientName, skuCount = 10, merchantCount = 3) {
  const isLg = clientName === "LG";
  return {
    skus: isLg
      ? [...SKUS]
      : SKUS.map((s, i) => ({ ...s, id: `${clientName}-00${i + 1}`, name: `${clientName} Product ${i + 1}`, violations: Math.floor(Math.random() * 3) })).slice(0, skuCount),
    violations: isLg
      ? [...VIOLATIONS]
      : VIOLATIONS.map((v, i) => ({ ...v, id: `VIO-${Math.random().toString(36).substr(2, 5).toUpperCase()}`, sku: `${clientName}-00${i + 1}`, product: `${clientName} Product ${i + 1}` })).slice(0, merchantCount * 2),
    merchants: [...MERCHANTS],
    mappingStage: isLg ? [...MAPPING_STAGE] : [],
    mappingInclude: isLg ? [...MAPPING_INCLUDE] : [],
    mappingExclude: isLg ? [...MAPPING_EXCLUDE] : [],
    promotions: isLg ? [...PROMOTIONS] : [],
  };
}
