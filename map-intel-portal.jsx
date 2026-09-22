import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  Search, Plus, ChevronDown, ExternalLink, X, Check, ChevronLeft, ChevronRight,
  Eye, MapPin, Ban, Sparkles, Moon, Sun
} from "lucide-react";
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";

// ---------- Mock data (LG Sandbox) ----------

const CLIENTS = [
  { name: "LG", status: "Sandbox", skus: 10, merchants: 3, live: true },
  { name: "Philips", status: "Active", skus: 24, merchants: 7, live: false },
  { name: "Kawasaki", status: "Active", skus: 18, merchants: 5, live: false },
  { name: "Citizen", status: "Active", skus: 12, merchants: 4, live: false },
];

const SKUS = [
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

const MERCHANTS = [
  { name: "XYZ Electronics", type: "Marketplace (Amazon)", tracked: 10, violations: 8, compliance: 74 },
  { name: "Best Buy", type: "Retailer", tracked: 8, violations: 4, compliance: 96 },
  { name: "TechMart", type: "Marketplace (Walmart)", tracked: 5, violations: 3, compliance: 88 },
];

const VIOLATIONS = [
  { id: "VIO-0123", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", map: 1499, advertised: 1395, gap: -6.9, duration: "6h", severity: "Critical", status: "Open" },
  { id: "VIO-0124", sku: "LG-003", product: 'LG 27" UltraGear Monitor', merchant: "XYZ Electronics (Amazon)", map: 349, advertised: 299, gap: -14.3, duration: "2d", severity: "Critical", status: "Open" },
  { id: "VIO-0125", sku: "LG-005", product: "LG WM3600HWA Washer", merchant: "Best Buy", map: 1149, advertised: 1095, gap: -4.7, duration: "1d", severity: "Medium", status: "Notified" },
  { id: "VIO-0126", sku: "LG-004", product: 'LG 75" QNED85', merchant: "TechMart (Walmart)", map: 1699, advertised: 1549, gap: -8.8, duration: "3d", severity: "High", status: "Open" },
  { id: "VIO-0127", sku: "LG-008", product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", map: 349, advertised: 299, gap: -14.3, duration: "12h", severity: "High", status: "Resolved" },
  { id: "VIO-0128", sku: "LG-007", product: "LG French Door Refrigerator", merchant: "Best Buy", map: 2199, advertised: 1999, gap: -9.1, duration: "5d", severity: "Critical", status: "Open" },
  { id: "VIO-0129", sku: "LG-010", product: "LG UltraGear 34GP63A", merchant: "TechMart (Walmart)", map: 379, advertised: 329, gap: -13.2, duration: "2d", severity: "Medium", status: "Notified" },
  { id: "VIO-0130", sku: "LG-001", product: 'LG 55" OLED C4', merchant: "Best Buy", map: 1499, advertised: 1450, gap: -3.3, duration: "4h", severity: "Low", status: "Open" },
];

const MAPPING_STAGE = [
  { product: "LG 55 OLED C4 Series", merchant: "XYZ Electronics (Amazon)", price: 1395, match: "LG-001", confidence: 98 },
  { product: "LG OLED C4 55 inch TV", merchant: "Best Buy", price: 1450, match: "LG-001", confidence: 95 },
  { product: 'LG 27" UltraGear Monitor', merchant: "TechMart (Walmart)", price: 299, match: "LG-003", confidence: 99 },
  { product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", price: 299, match: null, confidence: 61 },
];

const MAPPING_INCLUDE = [
  { product: 'LG 55" OLED C4', merchant: "XYZ Electronics (Amazon)", url: "amazon.com/8OCIH3F3Q8", mappedOn: "Aug 23, 2026", by: "Auto Rule" },
  { product: 'LG 27" UltraGear Monitor', merchant: "Best Buy", url: "bestbuy.com/site/6577865", mappedOn: "Aug 22, 2026", by: "Auto Rule" },
  { product: "LG WM3600HWA Washer", merchant: "TechMart (Walmart)", url: "walmart.com/ip/7a9f10e3", mappedOn: "Aug 21, 2026", by: "Analyst" },
];

const MAPPING_EXCLUDE = [
  { product: "LG Soundbar SN7Y", merchant: "XYZ Electronics (Amazon)", reason: "Accessory", excludedOn: "Aug 21, 2026" },
  { product: "LG Remote Control", merchant: "Best Buy", reason: "Accessory", excludedOn: "Aug 22, 2026" },
  { product: 'LG 55" OLED C3 (Old Model)', merchant: "TechMart (Walmart)", reason: "Out of scope", excludedOn: "Aug 21, 2026" },
];

const PROMOTIONS = [
  { sku: 'LG 55" OLED C4', standard: 1499, promo: 1399, from: "Aug 17, 2026", until: "Aug 23, 2026", status: "Active" },
  { sku: 'LG 27" UltraGear Monitor', standard: 349, promo: 299, from: "Sep 01, 2026", until: "Sep 07, 2026", status: "Scheduled" },
];

const EMAILS = [
  { date: "Aug 23, 2026", seller: "XYZ Electronics", violation: "VIO-0123", template: "First Warning", status: "Delivered", opened: "Yes", response: "Pending" },
  { date: "Aug 22, 2026", seller: "TechMart", violation: "VIO-0124", template: "MAP Notice", status: "Delivered", opened: "No", response: "Awaited" },
  { date: "Aug 21, 2026", seller: "Best Buy", violation: "VIO-0125", template: "MAP Reminder", status: "Delivered", opened: "Yes", response: "Resolved" },
];

const REPORTS = [
  { name: "Daily MAP Violations", freq: "Daily", recipients: "map-room@lg.com", lastRun: "Aug 23, 08:00 AM", format: "Excel" },
  { name: "Weekly Compliance Summary", freq: "Weekly", recipients: "leadership@lg.com", lastRun: "Aug 18, 06:00 AM", format: "PDF" },
  { name: "Unauthorized Sellers", freq: "Weekly", recipients: "channel@lg.com", lastRun: "Aug 18, 06:00 AM", format: "Excel" },
];

const ALERTS = [
  { name: "Critical MAP violation", condition: "Gap > 10%", channel: "Email + Dashboard", recipients: "map-room@lg.com" },
  { name: "New unauthorized seller", condition: "New seller detected", channel: "Email", recipients: "channel@lg.com" },
  { name: "Promotion ending soon", condition: "Ends in 2 days", channel: "Dashboard", recipients: "map-room@lg.com" },
];

const USERS = [
  { name: "Fenil Dholaviya", role: "Client Admin", access: "Full Access", lastActive: "Today, 10:15 AM", status: "Active" },
  { name: "analyst@mirethos.com", role: "MAP Analyst", access: "MAP + Violations", lastActive: "Today, 09:48 AM", status: "Active" },
  { name: "viewer@lg.com", role: "Viewer", access: "Read Only", lastActive: "Yesterday, 04:30 PM", status: "Active" },
];

const SEVERITY_COLORS = { Critical: "#dc2626", High: "#ea580c", Medium: "#f59e0b", Low: "#64748B" };
const SEVERITY_BG = { Critical: "bg-red-50 text-red-700 border-red-200", High: "bg-orange-50 text-orange-700 border-orange-200", Medium: "bg-amber-50 text-amber-700 border-amber-200", Low: "bg-slate-50 text-slate-700 border-slate-200" };
const STATUS_BG = {
  Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Paused: "bg-slate-50 text-slate-700 border-slate-200",
  Open: "bg-red-50 text-red-700 border-red-200",
  Notified: "bg-orange-50 text-orange-700 border-orange-200",
  Resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  Delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const SEVERITY_DIST = [
  { name: "Critical", value: 5, color: SEVERITY_COLORS.Critical },
  { name: "High", value: 8, color: SEVERITY_COLORS.High },
  { name: "Medium", value: 7, color: SEVERITY_COLORS.Medium },
  { name: "Low", value: 4, color: SEVERITY_COLORS.Low },
];

const TREND = [
  { day: "Aug 16", count: 10 }, { day: "Aug 17", count: 13 }, { day: "Aug 18", count: 18 },
  { day: "Aug 19", count: 20 }, { day: "Aug 20", count: 24 }, { day: "Aug 21", count: 24 },
  { day: "Aug 22", count: 24 },
];

// ---------- Small building blocks ----------

function Pill({ text, tone }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tone || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {text}
    </span>
  );
}

function KPI({ label, value, sub, subTone }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[150px]">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-medium text-slate-900">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subTone || "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

function Card({ title, action, children, className }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 ${className || ""}`}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-900">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h1 className="text-lg font-medium text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PrimaryButton({ children, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
      {children}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search..."}
        className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
      />
    </div>
  );
}

function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            {columns.map((c) => (
              <th key={c} className="py-2 px-3 font-medium whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ---------- Views ----------

function OverviewView({ onOpenViolation }) {
  const topMerchants = [...MERCHANTS].sort((a, b) => b.violations - a.violations);
  const maxV = Math.max(...topMerchants.map((m) => m.violations));
  return (
    <div>
      <PageHeader title="Dashboard — LG (Sandbox)" subtitle="Aug 16 – Aug 23, 2026" />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="MAP Compliance" value="94.2%" sub="↑ 2.4% vs last 7 days" subTone="text-emerald-600" />
        <KPI label="Active Violations" value="24" sub="+4 since yesterday" subTone="text-red-500" />
        <KPI label="SKUs Monitored" value="10" sub="0 vs yesterday" />
        <KPI label="Merchants Monitored" value="3" sub="0 vs yesterday" />
        <KPI label="Total Observations" value="1,248" sub="↑ 18% vs last week" subTone="text-emerald-600" />
        <KPI label="Repeat Violators" value="2" sub="↑ 1 vs yesterday" subTone="text-red-500" />
      </div>
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card title="Violations by severity">
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={SEVERITY_DIST} dataKey="value" innerRadius={40} outerRadius={65} paddingAngle={2}>
                  {SEVERITY_DIST.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 justify-center mt-1">
            {SEVERITY_DIST.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </Card>
        <Card title="Violations over time" className="col-span-2">
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={TREND} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card title="Recent critical violations" className="col-span-2" action={<button className="text-xs text-blue-600 font-medium">View all violations</button>}>
          <Table columns={["SKU / Product", "Merchant", "MAP", "Advertised", "Gap", "Severity"]}>
            {VIOLATIONS.filter((v) => v.severity === "Critical").slice(0, 4).map((v) => (
              <tr key={v.id} onClick={() => onOpenViolation(v)} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer">
                <td className="py-2 px-3">
                  <div className="text-slate-900">{v.product}</div>
                  <div className="text-xs text-slate-400">{v.sku}</div>
                </td>
                <td className="py-2 px-3 text-slate-600">{v.merchant}</td>
                <td className="py-2 px-3 text-slate-600">${v.map}</td>
                <td className="py-2 px-3 text-slate-600">${v.advertised}</td>
                <td className="py-2 px-3 text-red-600 font-medium">{v.gap}%</td>
                <td className="py-2 px-3"><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Top violating merchants">
          <div className="space-y-3">
            {topMerchants.map((m) => (
              <div key={m.name}>
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span>{m.name}</span><span>{m.violations}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${(m.violations / maxV) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProductSummaryView() {
  const [q, setQ] = useState("");
  const filtered = SKUS.filter((s) => (s.name + s.model + s.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Product Summary — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Add SKU</PrimaryButton>} />
      <Card>
        <div className="flex justify-between mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, MPN, product name..." />
        </div>
        <Table columns={["SKU", "Product name", "Model / MPN", "Category", "MAP price", "Current price", "Violations", "Status"]}>
          {filtered.map((s) => (
            <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 font-medium text-slate-900">{s.id}</td>
              <td className="py-2 px-3 text-slate-700">{s.name}</td>
              <td className="py-2 px-3 text-slate-500">{s.model}</td>
              <td className="py-2 px-3 text-slate-500">{s.category}</td>
              <td className="py-2 px-3 text-slate-600">${s.map.toLocaleString()}</td>
              <td className={`py-2 px-3 font-medium ${s.current < s.map ? "text-red-600" : "text-slate-700"}`}>${s.current.toLocaleString()}</td>
              <td className="py-2 px-3">{s.violations > 0 ? <Pill text={s.violations} tone="bg-red-50 text-red-700 border-red-200" /> : <span className="text-slate-400">0</span>}</td>
              <td className="py-2 px-3"><Pill text={s.status} tone={STATUS_BG[s.status]} /></td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-slate-400 mt-3">Showing {filtered.length} of {SKUS.length} SKUs</div>
      </Card>
    </div>
  );
}

function MappingCenterView() {
  const [tab, setTab] = useState("stage");
  const tabs = [
    { id: "stage", label: "Stage (Unmapped)", count: MAPPING_STAGE.length },
    { id: "include", label: "Include (Mapped)", count: MAPPING_INCLUDE.length },
    { id: "exclude", label: "Exclude (Ignored)", count: MAPPING_EXCLUDE.length },
  ];
  return (
    <div>
      <PageHeader title="Mapping Center — LG (Sandbox)" />
      <Card>
        <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t.label} <span className="text-xs text-slate-400 ml-1">{t.count}</span>
            </button>
          ))}
          <div className="ml-auto flex gap-2 pb-2">
            <button className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">Rules</button>
            <button className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">History</button>
          </div>
        </div>

        {tab === "stage" && (
          <>
            <div className="flex justify-between mb-3">
              <SearchBox placeholder="Search product, URL, seller..." value="" onChange={() => {}} />
              <div className="flex gap-2">
                <PrimaryButton><Sparkles className="w-4 h-4" /> Auto map</PrimaryButton>
              </div>
            </div>
            <Table columns={["Detected product", "Merchant", "Detected price", "Possible match", "Confidence", "Actions"]}>
              {MAPPING_STAGE.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2 px-3 text-slate-700">{r.product}</td>
                  <td className="py-2 px-3 text-slate-500">{r.merchant}</td>
                  <td className="py-2 px-3 text-slate-600">${r.price}</td>
                  <td className="py-2 px-3">{r.match ? <span className="text-blue-600">{r.match}</span> : <span className="text-slate-400">No match</span>}</td>
                  <td className="py-2 px-3">
                    <Pill text={`${r.confidence}%`} tone={r.confidence > 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"} />
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-2">
                      <button className="text-xs text-blue-600 font-medium">Map</button>
                      <button className="text-xs text-slate-500">Exclude</button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "include" && (
          <Table columns={["Product (client SKU)", "Merchant", "Source URL", "Mapped on", "Mapped by", "Actions"]}>
            {MAPPING_INCLUDE.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="py-2 px-3 text-slate-700">{r.product}</td>
                <td className="py-2 px-3 text-slate-500">{r.merchant}</td>
                <td className="py-2 px-3"><span className="text-blue-600 inline-flex items-center gap-1">{r.url}<ExternalLink className="w-3 h-3" /></span></td>
                <td className="py-2 px-3 text-slate-500">{r.mappedOn}</td>
                <td className="py-2 px-3"><Pill text={r.by} tone={r.by === "Auto Rule" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-600 border-slate-200"} /></td>
                <td className="py-2 px-3"><button className="text-xs text-slate-500 inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> View</button></td>
              </tr>
            ))}
          </Table>
        )}

        {tab === "exclude" && (
          <>
            <div className="flex justify-end mb-3">
              <button className="text-xs text-blue-600 font-medium">Restore selected</button>
            </div>
            <Table columns={["Detected product", "Merchant", "Reason", "Excluded on"]}>
              {MAPPING_EXCLUDE.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2 px-3 text-slate-700">{r.product}</td>
                  <td className="py-2 px-3 text-slate-500">{r.merchant}</td>
                  <td className="py-2 px-3"><Pill text={r.reason} tone="bg-slate-100 text-slate-600 border-slate-200" /></td>
                  <td className="py-2 px-3 text-slate-500">{r.excludedOn}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}

function PricingView() {
  return (
    <div>
      <PageHeader title="MAP & Pricing — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Add promotion</PrimaryButton>} />
      <Card title="Promotions">
        <Table columns={["SKU", "Standard MAP", "Promo price", "Effective from", "Effective until", "Status"]}>
          {PROMOTIONS.map((p, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-700">{p.sku}</td>
              <td className="py-2 px-3 text-slate-600">${p.standard}</td>
              <td className="py-2 px-3 text-emerald-600 font-medium">${p.promo}</td>
              <td className="py-2 px-3 text-slate-500">{p.from}</td>
              <td className="py-2 px-3 text-slate-500">{p.until}</td>
              <td className="py-2 px-3"><Pill text={p.status} tone={p.status === "Active" ? STATUS_BG.Active : STATUS_BG.Scheduled} /></td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          Active promotions override the standard MAP during the effective date range for applicable merchants.
        </div>
      </Card>
    </div>
  );
}

function MerchantsView() {
  return (
    <div>
      <PageHeader title="Merchants (Sellers) — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Add merchant</PrimaryButton>} />
      <Card>
        <Table columns={["Merchant / channel", "Type", "Tracked SKUs", "Violations", "Compliance"]}>
          {MERCHANTS.map((m) => (
            <tr key={m.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 font-medium text-slate-900 flex items-center gap-2"><Store className="w-4 h-4 text-slate-400" /> {m.name}</td>
              <td className="py-2 px-3 text-slate-500">{m.type}</td>
              <td className="py-2 px-3 text-slate-600">{m.tracked}</td>
              <td className="py-2 px-3">{m.violations > 0 ? <Pill text={m.violations} tone="bg-red-50 text-red-700 border-red-200" /> : "0"}</td>
              <td className="py-2 px-3">
                <span className={m.compliance >= 90 ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{m.compliance}%</span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function ViolationsView({ onOpenViolation }) {
  const [q, setQ] = useState("");
  const filtered = VIOLATIONS.filter((v) => (v.product + v.merchant + v.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Violations — LG (Sandbox)" />
      <Card>
        <div className="flex justify-between mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, merchant..." />
        </div>
        <Table columns={["Violation ID", "SKU / Product", "Merchant / Seller", "MAP", "Advertised", "Gap", "Duration", "Severity", "Status"]}>
          {filtered.map((v) => (
            <tr key={v.id} onClick={() => onOpenViolation(v)} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer">
              <td className="py-2 px-3 font-medium text-blue-600">{v.id}</td>
              <td className="py-2 px-3">
                <div className="text-slate-900">{v.product}</div>
                <div className="text-xs text-slate-400">{v.sku}</div>
              </td>
              <td className="py-2 px-3 text-slate-500">{v.merchant}</td>
              <td className="py-2 px-3 text-slate-600">${v.map}</td>
              <td className="py-2 px-3 text-slate-600">${v.advertised}</td>
              <td className="py-2 px-3 text-red-600 font-medium">{v.gap}%</td>
              <td className="py-2 px-3 text-slate-500">{v.duration}</td>
              <td className="py-2 px-3"><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></td>
              <td className="py-2 px-3"><Pill text={v.status} tone={STATUS_BG[v.status] || STATUS_BG.Open} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function ViolationDrawer({ violation, onClose }) {
  if (!violation) return null;
  const v = violation;
  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={onClose}>
      <div className="bg-white w-[440px] h-full overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <Pill text={v.severity} tone={SEVERITY_BG[v.severity]} />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <h2 className="text-base font-medium text-slate-900 mt-2">Violation detail — {v.id}</h2>
        <p className="text-sm text-slate-500 mb-4">{v.product} · {v.sku}</p>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-400">Merchant / seller</div>
            <div className="text-sm text-slate-800">{v.merchant}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-400">Applicable MAP price</div>
            <div className="text-sm text-slate-800">${v.map}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-400">Advertised price</div>
            <div className="text-sm text-red-600 font-medium">${v.advertised} ({v.gap}%)</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-400">Detected duration</div>
            <div className="text-sm text-slate-800">{v.duration} ago</div>
          </div>
        </div>

        <div className="mb-5">
          <div className="text-xs text-slate-400 mb-2">Evidence</div>
          <div className="bg-slate-100 rounded-lg h-40 flex items-center justify-center text-slate-400 text-xs">Screenshot captured at detection</div>
        </div>

        <div className="mb-5">
          <div className="text-xs text-slate-400 mb-2">Timeline</div>
          <ul className="text-sm space-y-2">
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Detected — Aug 23, 2026 10:15 AM</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Validated — Aug 23, 2026 10:20 AM</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Email drafted — pending send</li>
          </ul>
        </div>

        <div className="flex gap-2">
          <PrimaryButton>Send violation email</PrimaryButton>
          <button className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600">Mark resolved</button>
        </div>
      </div>
    </div>
  );
}

function EmailCenterView() {
  return (
    <div>
      <PageHeader title="Email Center — LG (Sandbox)" action={<PrimaryButton><Mail className="w-4 h-4" /> Compose email</PrimaryButton>} />
      <Card>
        <Table columns={["Date", "Seller", "Violation", "Template", "Status", "Opened", "Response"]}>
          {EMAILS.map((e, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-500">{e.date}</td>
              <td className="py-2 px-3 text-slate-700">{e.seller}</td>
              <td className="py-2 px-3 text-blue-600">{e.violation}</td>
              <td className="py-2 px-3 text-slate-500">{e.template}</td>
              <td className="py-2 px-3"><Pill text={e.status} tone={STATUS_BG.Delivered} /></td>
              <td className="py-2 px-3 text-slate-500">{e.opened}</td>
              <td className="py-2 px-3 text-slate-500">{e.response}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function ReportsView() {
  return (
    <div>
      <PageHeader title="Reports — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Schedule report</PrimaryButton>} />
      <Card>
        <Table columns={["Report name", "Frequency", "Recipients", "Last run", "Format"]}>
          {REPORTS.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-700">{r.name}</td>
              <td className="py-2 px-3 text-slate-500">{r.freq}</td>
              <td className="py-2 px-3 text-slate-500">{r.recipients}</td>
              <td className="py-2 px-3 text-slate-500">{r.lastRun}</td>
              <td className="py-2 px-3"><Pill text={r.format} tone="bg-slate-100 text-slate-600 border-slate-200" /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AlertsView() {
  return (
    <div>
      <PageHeader title="Alerts — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Add rule</PrimaryButton>} />
      <Card>
        <Table columns={["Alert name", "Condition", "Channel", "Recipients"]}>
          {ALERTS.map((a, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-700">{a.name}</td>
              <td className="py-2 px-3 text-slate-500">{a.condition}</td>
              <td className="py-2 px-3 text-slate-500">{a.channel}</td>
              <td className="py-2 px-3 text-slate-500">{a.recipients}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function SettingsView() {
  return (
    <div>
      <PageHeader title="Settings — LG (Sandbox)" action={<PrimaryButton><Check className="w-4 h-4" /> Save changes</PrimaryButton>} />
      <div className="grid grid-cols-2 gap-4">
        <Card title="Client information">
          <div className="space-y-3 text-sm">
            <div><div className="text-xs text-slate-400 mb-1">Client name</div><div className="text-slate-800">LG Electronics (Sandbox)</div></div>
            <div><div className="text-xs text-slate-400 mb-1">Region</div><div className="text-slate-800">North America</div></div>
            <div><div className="text-xs text-slate-400 mb-1">Currency</div><div className="text-slate-800">USD — US Dollar</div></div>
          </div>
        </Card>
        <Card title="Other settings">
          <div className="space-y-3 text-sm">
            <div><div className="text-xs text-slate-400 mb-1">Default scrape frequency</div><div className="text-slate-800">Daily</div></div>
            <div><div className="text-xs text-slate-400 mb-1">MAP tolerance</div><div className="text-slate-800">1%</div></div>
            <div><div className="text-xs text-slate-400 mb-1">Approval required before sending emails</div><div className="text-slate-800">Enabled</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function UsersView() {
  return (
    <div>
      <PageHeader title="Users & Access — LG (Sandbox)" action={<PrimaryButton><Plus className="w-4 h-4" /> Invite user</PrimaryButton>} />
      <Card>
        <Table columns={["User", "Role", "Access level", "Last active", "Status"]}>
          {USERS.map((u, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-700">{u.name}</td>
              <td className="py-2 px-3 text-slate-500">{u.role}</td>
              <td className="py-2 px-3 text-slate-500">{u.access}</td>
              <td className="py-2 px-3 text-slate-500">{u.lastActive}</td>
              <td className="py-2 px-3"><Pill text={u.status} tone={STATUS_BG.Active} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AuditLogView() {
  const rows = [
    { time: "Today, 10:15 AM", user: "Fenil Dholaviya", action: "Sent violation email for VIO-0123" },
    { time: "Today, 09:50 AM", user: "Auto Rule", action: "Mapped LG-003 to XYZ Electronics" },
    { time: "Yesterday, 04:12 PM", user: "analyst@mirethos.com", action: "Excluded LG Remote Control from tracking" },
  ];
  return (
    <div>
      <PageHeader title="Audit Log — LG (Sandbox)" />
      <Card>
        <Table columns={["Time", "User", "Action"]}>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 px-3 text-slate-500">{r.time}</td>
              <td className="py-2 px-3 text-slate-700">{r.user}</td>
              <td className="py-2 px-3 text-slate-600">{r.action}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ---------- Shell ----------

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "product", label: "Product Summary", icon: Package },
  { id: "mapping", label: "Mapping Center", icon: Shuffle },
  { id: "pricing", label: "MAP & Pricing", icon: DollarSign },
  { id: "merchants", label: "Merchants (Sellers)", icon: Store },
  { id: "violations", label: "Violations", icon: AlertTriangle, badge: 24 },
  { id: "email", label: "Email Center", icon: Mail },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "alerts", label: "Alerts", icon: Bell, badge: 3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "users", label: "Users & Access", icon: Users },
  { id: "audit", label: "Audit Log", icon: ClipboardList },
];

export default function MapIntelPortal() {
  const [view, setView] = useState("overview");
  const [clientOpen, setClientOpen] = useState(false);
  const [activeClient, setActiveClient] = useState("LG");
  const [violation, setViolation] = useState(null);

  const client = CLIENTS.find((c) => c.name === activeClient);

  const content = useMemo(() => {
    if (!client.live) {
      return (
        <div className="flex flex-col items-center justify-center h-96 text-center">
          <MapPin className="w-8 h-8 text-slate-300 mb-3" />
          <p className="text-slate-500 text-sm">No live data configured for {client.name} yet.</p>
          <p className="text-slate-400 text-xs mt-1">This sandbox currently has data seeded only for LG.</p>
        </div>
      );
    }
    switch (view) {
      case "overview": return <OverviewView onOpenViolation={setViolation} />;
      case "product": return <ProductSummaryView />;
      case "mapping": return <MappingCenterView />;
      case "pricing": return <PricingView />;
      case "merchants": return <MerchantsView />;
      case "violations": return <ViolationsView onOpenViolation={setViolation} />;
      case "email": return <EmailCenterView />;
      case "reports": return <ReportsView />;
      case "alerts": return <AlertsView />;
      case "settings": return <SettingsView />;
      case "users": return <UsersView />;
      case "audit": return <AuditLogView />;
default: return null;
    }
  }, [view, client]);

  return (
    <div className="flex h-[800px] max-h-[90vh] bg-slate-50 font-sans text-slate-800 rounded-xl overflow-hidden border border-slate-200">
      {/* Sidebar */}
      <div className="w-60 bg-brand-sidebar text-brand-charcoal flex flex-col shrink-0 border-r border-brand-beige shadow-lg">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-brand-beige">
          <img src="/favicon.ico" alt="Mirethos Logo" className="w-6.5 h-6.5 bg-brand-white p-1 rounded-md" />
          <span className="text-brand-charcoal text-sm font-bold tracking-wide">MIRETHOS</span>
        </div>

        {/* Client selector details */}
        <div className="px-3 py-3 border-b border-brand-beige relative">
          <button onClick={() => setClientOpen((o) => !o)} className="w-full flex items-center justify-between hover:bg-brand-beige rounded-lg px-2.5 py-2 text-sm cursor-pointer">
            <div className="text-left">
              <div className="text-brand-charcoal text-sm font-semibold">{client.name}</div>
              <div className="text-[10px] text-brand-taupe font-medium">{client.status}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-brand-taupe" />
          </button>
          {clientOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-brand-white border border-brand-beige rounded-lg overflow-hidden z-10 shadow-xl">
              {CLIENTS.map((c) => (
                <button key={c.name} onClick={() => { setActiveClient(c.name); setClientOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-beige flex justify-between items-center cursor-pointer ${c.name === activeClient ? "text-brand-charcoal font-bold" : "text-brand-taupe"}`}>
                  <span>{c.name}</span>
                  <span className="text-[10px] text-brand-taupe">{c.skus} SKUs</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button key={n.id} onClick={() => setView(n.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors border-l-2 cursor-pointer ${
                  active ? "bg-brand-beige border-brand-copper text-brand-charcoal font-semibold" : "border-transparent text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige/50"
                }`}>
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{n.label}</span>
                {n.badge ? <span className="text-[9px] font-bold bg-brand-copper text-brand-white rounded-full px-1.5 py-0.5">{n.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Bottom User Avatar */}
        <div className="px-4 py-3 border-t border-brand-beige flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-brand-copper flex items-center justify-center text-xs text-brand-white font-bold">FD</div>
            <div className="text-[11px]">
              <div className="text-brand-charcoal font-bold">Fenil Dholaviya</div>
              <div className="text-brand-taupe">Admin</div>
            </div>
          </div>
          <button onClick={() => setScreen('login')} className="text-[10px] text-brand-copper hover:underline cursor-pointer">
            Exit
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">{content}</div>

      {/* Slide-out drawer details */}
      <ViolationDrawer violation={violation} onClose={() => setViolation(null)} onSendWarning={handleSendWarning} onResolve={handleResolveViolation} />

      {/* Floating Theme Toggle */}
      <button 
        onClick={() => { document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark'); }} 
        className="fixed bottom-6 right-6 p-3 bg-brand-charcoal text-brand-white rounded-full shadow-lg hover:bg-brand-taupe transition-colors z-50 cursor-pointer flex items-center justify-center"
        title="Toggle Theme"
      >
        <Sparkles className="w-5 h-5" />
      </button>

      {/* ADD SKU MODAL */}
    </div>
  );
}
