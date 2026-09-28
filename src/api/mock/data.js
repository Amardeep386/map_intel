// Mock data for screens whose backend arrives in a later phase.
// Moved out of App.jsx in Phase 0; the API client (../client.js) serves it.
import { DEMO_CLIENTS, demoFor } from "./demo.js";

// The three sandboxes and their catalogue come from the demo catalogue (./demo.js). Violations are
// sample data (Phase 3), generated from the brand's own SKUs and tracked merchants.
export const CLIENTS = DEMO_CLIENTS;

const GAPS = [-6.9, -14.3, -4.7, -8.8, -3.3, -9.1, -13.2, -2.4, -11.6, -5.5];
const DURATIONS = ["6h", "2d", "1d", "3d", "4h", "5d", "12h"];
const STATUSES = ["Open", "Notified", "Open", "Resolved"];
const severity = (gap) => (gap <= -10 ? "Critical" : gap <= -7 ? "High" : gap <= -4 ? "Medium" : "Low");

/** Sample violations: every fourth SKU, at one of the brand's tracked merchants that sells its category. */
function sampleViolations(products, merchants) {
  const sellers = merchants.filter((m) => m.track && m.channelType !== "Price comparison");
  const out = [];
  products.filter((p) => p.status === "Active").forEach((p, i) => {
    if (i % 4 !== 0 || !sellers.length) return;
    const k = out.length;
    const carrying = sellers.filter((m) => m.categories.includes(p.category));
    const m = (carrying.length ? carrying : sellers)[k % (carrying.length || sellers.length)];
    const gap = GAPS[k % GAPS.length];
    out.push({
      id: `VIO-${String(123 + k).padStart(4, "0")}`, sku: p.sku, product: p.name, merchant: m.name, map: p.map,
      advertised: Math.round(p.map * (1 + gap / 100) * 100) / 100, gap, duration: DURATIONS[k % DURATIONS.length], severity: severity(gap), status: STATUSES[k % STATUSES.length],
    });
  });
  return out;
}

export const EMAILS = [
  { date: "Aug 23, 2026", seller: "Walmart.com", violation: "VIO-0123", template: "First Warning", status: "Delivered", opened: "Yes", response: "Pending" },
  { date: "Aug 22, 2026", seller: "Newegg", violation: "VIO-0124", template: "MAP Notice", status: "Delivered", opened: "No", response: "Awaited" },
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
  { time: "Today, 09:50 AM", user: "Auto Rule", action: "Mapped 14Z90T-G.AAB2U1 to a Walmart.com listing" },
  { time: "Yesterday, 04:12 PM", user: "analyst@mirethos.com", action: "Excluded an open-box LG gram listing on eBay" },
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

/** Mock workspace for one sandbox: its demo SKUs, tracked merchants and sample violations. */
export function mockWorkspace(clientName) {
  const { products, merchants } = demoFor(clientName);
  const violations = sampleViolations(products, merchants);
  const skus = products.map((p) => {
    const mine = violations.filter((v) => v.sku === p.sku);
    return {
      id: p.sku, name: p.name, model: p.sku, brand: p.brand, category: p.category, modelFamily: p.modelFamily, configuration: p.configuration,
      colour: p.colour, internalId: p.internalId, map: p.map, current: mine.length ? Math.min(...mine.map((v) => v.advertised)) : null,
      violations: mine.filter((v) => v.status !== "Resolved").length, status: p.status,
    };
  });
  const tracked = merchants.filter((m) => m.track);
  return {
    skus,
    violations,
    merchants: tracked.map((m) => {
      const carried = products.filter((p) => m.categories.includes(p.category)).length;
      const open = violations.filter((v) => v.merchant === m.name).length;
      return { name: m.name, type: m.channelType, tracked: carried, violations: open, compliance: carried ? Math.round(100 - (open / carried) * 100) : 100 };
    }),
  };
}
