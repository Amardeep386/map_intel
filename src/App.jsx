import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  Search, Plus, ChevronDown, ExternalLink, X, Check, ChevronLeft, ChevronRight,
  Eye, MapPin, Ban, Sparkles, Lock, Moon, Sun
} from "lucide-react";
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import lgLogo from "./assets/lg.png";
import philipsLogo from "./assets/philips.png";
import kawasakiLogo from "./assets/kawasaki.png";

// ---------- Format Currency Utility (USD) ----------
const formatUSD = (number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(number);
};

// ---------- Mock data matching mosaic registry ----------
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
    <div className="bg-brand-white border border-brand-beige rounded-xl p-4 flex-1 min-w-[150px]">
      <div className="text-xs text-brand-taupe mb-1">{label}</div>
      <div className="text-2xl font-bold text-brand-charcoal">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subTone || "text-brand-taupe"}`}>{sub}</div>}
    </div>
  );
}

function Card({ title, action, children, className }) {
  return (
    <div className={`bg-brand-white border border-brand-beige rounded-xl p-4 ${className || ""}`}>
      {title && (
        <div className="flex items-center justify-between mb-3 border-b border-brand-beige pb-2">
          <h3 className="text-sm font-semibold text-brand-charcoal">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between mb-5 border-b border-brand-beige pb-3">
      <div>
        <h1 className="text-lg font-bold text-brand-charcoal">{title}</h1>
        {subtitle && <p className="text-sm text-brand-taupe mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PrimaryButton({ children, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 bg-brand-copper hover:bg-brand-copper/90 text-brand-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors cursor-pointer">
      {children}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-brand-taupe absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search..."}
        className="pl-9 pr-3 py-2 text-sm border border-brand-beige rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-brand-copper/30 focus:border-brand-copper bg-brand-white text-brand-charcoal"
      />
    </div>
  );
}

function MerchantLogo({ name }) {
  const [error, setError] = useState(false);
  let domain = null;
  const lowerName = name.toLowerCase();
  if (lowerName.includes("amazon")) domain = "amazon.com";
  else if (lowerName.includes("best buy")) domain = "bestbuy.com";
  else if (lowerName.includes("walmart")) domain = "walmart.com";
  else if (lowerName.includes("target")) domain = "target.com";

  if (domain && !error) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img src={`https://logo.clearbit.com/${domain}`} alt={name} className="w-4 h-4 rounded-full object-contain bg-brand-white border border-brand-beige" onError={() => setError(true)} />
        <span>{name}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Store className="w-3.5 h-3.5 text-brand-taupe opacity-50" />
      <span>{name}</span>
    </span>
  );
}

function ClientLogo({ name, className }) {
  const [error, setError] = useState(false);
  let src = null;
  const lowerName = name.toLowerCase();
  if (lowerName === "lg") src = lgLogo;
  else if (lowerName === "philips") src = philipsLogo;
  else if (lowerName === "kawasaki") src = kawasakiLogo;
  else src = `https://logo.clearbit.com/${lowerName}.com`;

  if (!error) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-brand-white ${className || "w-5 h-5 rounded-sm"}`}>
        <img 
          src={src} 
          alt={name} 
          className="w-full h-full object-contain"
          style={{ 
            padding: '2px',
            transform: lowerName === "lg" ? 'scale(2.3)' : 'scale(1)' 
          }}
          onError={() => setError(true)} 
        />
      </div>
    );
  }
  
  return <div className={`flex items-center justify-center font-bold text-brand-white bg-brand-copper ${className || "w-5 h-5 rounded-sm"}`}>{name.charAt(0)}</div>;
}

function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto border border-brand-beige rounded-lg">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-brand-beige text-left text-xs text-brand-charcoal bg-brand-beige">
            {columns.map((c) => (
              <th key={c} className="py-2 px-3 font-semibold whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-beige">{children}</tbody>
      </table>
    </div>
  );
}

// ---------- Views ----------
function OverviewView({ onOpenViolation, clientName }) {
  const { db } = React.useContext(DataContext);
  const clientData = db[clientName];
  const { skus, violations, merchants } = clientData;

  const topMerchants = [...merchants].sort((a, b) => b.violations - a.violations);
  const maxV = Math.max(...topMerchants.map((m) => m.violations));
  
  const activeViolationsCount = violations.filter(v => v.status === "Open" || v.status === "Notified").length;

  return (
    <div>
      <PageHeader title={
        <div className="flex items-center gap-3">
          <ClientLogo name={clientName} className="w-8 h-8 rounded-lg shadow-sm border border-brand-beige p-1" />
          <span>Dashboard — {clientName} (Sandbox)</span>
        </div>
      } subtitle="Aug 16 – Aug 23, 2026" />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="MAP Compliance" value="94.2%" sub="↑ 2.4% vs last 7 days" subTone="text-emerald-700 font-semibold" />
        <KPI label="Active Violations" value={activeViolationsCount} sub="+4 since yesterday" subTone="text-red-600 font-semibold" />
        <KPI label="SKUs Monitored" value={skus.length} sub="0 vs yesterday" />
        <KPI label="Merchants Monitored" value={merchants.length} sub="0 vs yesterday" />
        <KPI label="Total Observations" value="1,248" sub="↑ 18% vs last week" subTone="text-emerald-700 font-semibold" />
        <KPI label="Repeat Violators" value="2" sub="↑ 1 vs yesterday" subTone="text-red-600 font-semibold" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
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
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-brand-taupe">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </Card>
        <Card title="Violations over time" className="md:col-span-2">
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={TREND} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 'dataMax + 2']} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Recent critical violations" className="md:col-span-2" action={<button className="text-xs text-brand-copper hover:underline font-semibold cursor-pointer">View all violations</button>}>
          <Table columns={["SKU / Product", "Merchant", "MAP", "Advertised", "Gap", "Severity"]}>
            {violations.filter((v) => v.severity === "Critical").slice(0, 4).map((v) => (
              <tr key={v.id} onClick={() => onOpenViolation(v)} className="border-b border-brand-beige hover:bg-brand-beige/20 cursor-pointer">
                <td className="py-2 px-3">
                  <div className="text-brand-charcoal font-semibold">{v.product}</div>
                  <div className="text-xs text-brand-taupe">{v.sku}</div>
                </td>
                <td className="py-2 px-3 text-brand-charcoal"><MerchantLogo name={v.merchant} /></td>
                <td className="py-2 px-3 text-brand-charcoal">${v.map}</td>
                <td className="py-2 px-3 text-brand-charcoal">${v.advertised}</td>
                <td className="py-2 px-3 text-red-600 font-bold">{v.gap}%</td>
                <td className="py-2 px-3"><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Top violating merchants">
          <div className="space-y-3">
            {topMerchants.map((m) => (
              <div key={m.name}>
                <div className="flex justify-between text-xs text-brand-charcoal mb-1 font-medium">
                  <span><MerchantLogo name={m.name} /></span><span>{m.violations}</span>
                </div>
                <div className="h-1.5 bg-brand-beige rounded-full overflow-hidden">
                  <div className="h-full bg-brand-copper rounded-full" style={{ width: `${(m.violations / maxV) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProductSummaryView({ clientName, onAddSkuClick }) {
  const { db } = React.useContext(DataContext);
  const skus = db[clientName].skus;
  const [q, setQ] = useState("");
  const filtered = skus.filter((s) => (s.name + s.model + s.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title={`Product Summary — ${clientName} (Sandbox)`} action={<PrimaryButton onClick={onAddSkuClick}><Plus className="w-4 h-4" /> Add SKU</PrimaryButton>} />
      <Card>
        <div className="flex justify-between mb-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, MPN, product name..." />
        </div>
        <Table columns={["SKU", "Product name", "Model / MPN", "Category", "MAP price", "Current price", "Violations", "Status"]}>
          {filtered.map((s) => (
            <tr key={s.id} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 font-semibold text-brand-charcoal">{s.id}</td>
              <td className="py-2 px-3 text-brand-charcoal font-medium">{s.name}</td>
              <td className="py-2 px-3 text-brand-taupe">{s.model}</td>
              <td className="py-2 px-3 text-brand-taupe">{s.category}</td>
              <td className="py-2 px-3 text-brand-charcoal">${s.map.toLocaleString()}</td>
              <td className={`py-2 px-3 font-semibold ${s.current < s.map ? "text-red-600" : "text-brand-charcoal"}`}>${s.current.toLocaleString()}</td>
              <td className="py-2 px-3">{s.violations > 0 ? <Pill text={s.violations} tone="bg-red-50 text-red-700 border-red-200" /> : <span className="text-brand-taupe">0</span>}</td>
              <td className="py-2 px-3"><Pill text={s.status} tone={STATUS_BG[s.status]} /></td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">Showing {filtered.length} of {SKUS.length} SKUs</div>
      </Card>
    </div>
  );
}

function MappingCenterView({ clientName }) {
  const { db, setDb } = React.useContext(DataContext);
  const { mappingStage, mappingInclude, mappingExclude } = db[clientName];

  const handleMap = (item) => {
    setDb(prev => {
      const clientData = prev[clientName];
      return {
        ...prev,
        [clientName]: {
          ...clientData,
          mappingStage: clientData.mappingStage.filter(i => i !== item),
          mappingInclude: [{ product: item.product, merchant: item.merchant, url: "#", mappedOn: "Just now", by: "Manual" }, ...clientData.mappingInclude]
        }
      };
    });
  };

  const handleExclude = (item) => {
    setDb(prev => {
      const clientData = prev[clientName];
      return {
        ...prev,
        [clientName]: {
          ...clientData,
          mappingStage: clientData.mappingStage.filter(i => i !== item),
          mappingExclude: [{ product: item.product, merchant: item.merchant, reason: "Manual Exclude", excludedOn: "Just now" }, ...clientData.mappingExclude]
        }
      };
    });
  };

  const [tab, setTab] = useState("stage");
  const tabs = [
    { id: "stage", label: "Stage (Unmapped)", count: mappingStage.length },
    { id: "include", label: "Include (Mapped)", count: mappingInclude.length },
    { id: "exclude", label: "Exclude (Ignored)", count: mappingExclude.length },
  ];
  return (
    <div>
      <PageHeader title={`Mapping Center — ${clientName} (Sandbox)`} />
      <Card>
        <div className="flex items-center gap-1 border-b border-brand-beige mb-4">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${tab === t.id ? "border-brand-copper text-brand-copper" : "border-transparent text-brand-taupe hover:text-brand-charcoal"}`}>
              {t.label} <span className="text-xs text-brand-taupe ml-1">{t.count}</span>
            </button>
          ))}
          <div className="ml-auto flex gap-2 pb-2">
            <button className="text-xs text-brand-charcoal border border-brand-beige hover:bg-brand-beige/50 rounded-lg px-2.5 py-1.5 cursor-pointer">Rules</button>
            <button className="text-xs text-brand-charcoal border border-brand-beige hover:bg-brand-beige/50 rounded-lg px-2.5 py-1.5 cursor-pointer">History</button>
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
              {mappingStage.map((r, i) => (
                <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
                  <td className="py-2 px-3 text-brand-charcoal font-medium">{r.product}</td>
                  <td className="py-2 px-3 text-brand-taupe"><MerchantLogo name={r.merchant} /></td>
                  <td className="py-2 px-3 text-brand-charcoal">${r.price}</td>
                  <td className="py-2 px-3">{r.match ? <span className="text-brand-copper font-semibold">{r.match}</span> : <span className="text-brand-taupe">No match</span>}</td>
                  <td className="py-2 px-3">
                    <Pill text={`${r.confidence}%`} tone={r.confidence > 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"} />
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-3">
                      <button onClick={() => handleMap(r)} className="text-xs text-brand-copper font-semibold hover:underline cursor-pointer">Map</button>
                      <button onClick={() => handleExclude(r)} className="text-xs text-brand-taupe hover:text-brand-charcoal cursor-pointer">Exclude</button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "include" && (
          <Table columns={["Product (client SKU)", "Merchant", "Source URL", "Mapped on", "Mapped by", "Actions"]}>
            {mappingInclude.map((r, i) => (
              <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
                <td className="py-2 px-3 text-brand-charcoal font-medium">{r.product}</td>
                <td className="py-2 px-3 text-brand-taupe"><MerchantLogo name={r.merchant} /></td>
                <td className="py-2 px-3"><span className="text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer">{r.url}<ExternalLink className="w-3.5 h-3.5" /></span></td>
                <td className="py-2 px-3 text-brand-taupe">{r.mappedOn}</td>
                <td className="py-2 px-3"><Pill text={r.by} tone={r.by === "Auto Rule" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-600 border-slate-200"} /></td>
                <td className="py-2 px-3"><button className="text-xs text-brand-charcoal inline-flex items-center gap-1 cursor-pointer"><Eye className="w-3.5 h-3.5" /> View</button></td>
              </tr>
            ))}
          </Table>
        )}

        {tab === "exclude" && (
          <>
            <div className="flex justify-end mb-3">
              <button className="text-xs text-brand-copper font-semibold hover:underline cursor-pointer">Restore selected</button>
            </div>
            <Table columns={["Detected product", "Merchant", "Reason", "Excluded on"]}>
              {mappingExclude.map((r, i) => (
                <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
                  <td className="py-2 px-3 text-brand-charcoal font-medium">{r.product}</td>
                  <td className="py-2 px-3 text-brand-taupe"><MerchantLogo name={r.merchant} /></td>
                  <td className="py-2 px-3"><Pill text={r.reason} tone="bg-slate-100 text-slate-600 border-slate-200" /></td>
                  <td className="py-2 px-3 text-brand-taupe">{r.excludedOn}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}

function PricingView({ clientName, onAddPromoClick }) {
  return (
    <div>
      <PageHeader title={`MAP & Pricing — ${clientName} (Sandbox)`} action={<PrimaryButton onClick={onAddPromoClick}><Plus className="w-4 h-4" /> Add promotion</PrimaryButton>} />
      <Card title="Promotions">
        <Table columns={["SKU", "Standard MAP", "Promo price", "Effective from", "Effective until", "Status"]}>
          {PROMOTIONS.map((p, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{p.sku}</td>
              <td className="py-2 px-3 text-brand-charcoal">${p.standard}</td>
              <td className="py-2 px-3 text-emerald-700 font-bold">${p.promo}</td>
              <td className="py-2 px-3 text-brand-taupe">{p.from}</td>
              <td className="py-2 px-3 text-brand-taupe">{p.until}</td>
              <td className="py-2 px-3"><Pill text={p.status} tone={p.status === "Active" ? STATUS_BG.Active : STATUS_BG.Scheduled} /></td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 text-xs text-brand-copper bg-brand-beige/50 border border-brand-beige rounded-lg px-3 py-2">
          Active promotions override the standard MAP during the effective date range for applicable merchants.
        </div>
      </Card>
    </div>
  );
}

// ------------------- Violations View -------------------
function ViolationsView({ onOpenViolation, clientName }) {
  const { db } = React.useContext(DataContext);
  const violations = db[clientName].violations;
  const [q, setQ] = useState("");
  const filtered = violations.filter((v) => (v.product + v.merchant + v.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title={`Violations — ${clientName} (Sandbox)`} />
      <Card>
        <div className="flex justify-between mb-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, merchant..." />
        </div>
        <Table columns={["Violation ID", "SKU / Product", "Merchant / Seller", "MAP", "Advertised", "Gap", "Duration", "Severity", "Status"]}>
          {filtered.map((v) => (
            <tr key={v.id} onClick={() => onOpenViolation(v)} className="border-b border-brand-beige hover:bg-brand-beige/20 cursor-pointer">
              <td className="py-2 px-3 font-semibold text-brand-copper">{v.id}</td>
              <td className="py-2 px-3">
                <div className="text-brand-charcoal font-semibold">{v.product}</div>
                <div className="text-xs text-brand-taupe">{v.sku}</div>
              </td>
              <td className="py-2 px-3 text-brand-charcoal"><MerchantLogo name={v.merchant} /></td>
              <td className="py-2 px-3 text-brand-charcoal">${v.map}</td>
              <td className="py-2 px-3 text-brand-charcoal">${v.advertised}</td>
              <td className="py-2 px-3 text-red-600 font-bold">{v.gap}%</td>
              <td className="py-2 px-3 text-brand-taupe">{v.duration}</td>
              <td className="py-2 px-3"><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></td>
              <td className="py-2 px-3"><Pill text={v.status} tone={STATUS_BG[v.status] || STATUS_BG.Open} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ------------------- Detailed Three Column Violation Drawer (Matches Screen 11 Detail) -------------------
function ViolationDrawer({ violation, onClose, onSendWarning, onResolve }) {
  if (!violation) return null;
  const v = violation;
  return (
    <div className="fixed inset-0 bg-brand-charcoal/40 flex justify-end z-50 transition-opacity" onClick={onClose}>
      <div className="bg-brand-ivory w-[920px] max-w-[90vw] h-full overflow-y-auto p-6 flex flex-col justify-between shadow-2xl border-l border-brand-beige" onClick={(e) => e.stopPropagation()}>
        
        {/* Drawer Header */}
        <div>
          <div className="flex items-center justify-between border-b border-brand-beige pb-3 mb-4">
            <div>
              <span className="text-xs font-semibold text-brand-taupe uppercase tracking-wider">VIOLATION PROFILE</span>
              <h2 className="text-lg font-bold text-brand-charcoal mt-1">Violation Detail — {v.id}</h2>
            </div>
            <button onClick={onClose} className="text-brand-taupe hover:text-brand-charcoal cursor-pointer p-1 rounded-lg border border-brand-beige bg-brand-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Three Column Content Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            
            {/* Column 1: Violation Information */}
            <div className="bg-brand-white border border-brand-beige rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-2">Violation Information</h4>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-brand-taupe">SKU / Product</span>
                  <span className="text-brand-charcoal font-semibold text-right max-w-[140px] truncate">{v.sku} - {v.product}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Merchant</span>
                  <span className="text-brand-charcoal font-semibold text-right"><MerchantLogo name={v.merchant} /></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Applicable MAP</span>
                  <span className="text-brand-charcoal font-semibold">${v.map}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Advertised Price</span>
                  <span className="text-red-600 font-bold">${v.advertised}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Gap</span>
                  <span className="text-red-600 font-bold">{v.gap}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Duration</span>
                  <span className="text-brand-charcoal font-medium">{v.duration}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-taupe">Severity</span>
                  <Pill text={v.severity} tone={SEVERITY_BG[v.severity]} />
                </div>
              </div>
            </div>

            {/* Column 2: Captured Evidence Locker */}
            <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
              <div className="flex justify-between items-center border-b border-brand-beige pb-1.5 mb-3">
                <h4 className="text-sm font-semibold text-brand-charcoal">Evidence</h4>
                <a href={v.listingUrl || "#"} target="_blank" rel="noreferrer" className="text-xs text-brand-copper hover:underline inline-flex items-center gap-0.5">
                  Open Live Listing <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="bg-brand-charcoal rounded-lg h-44 flex flex-col items-center justify-center p-4 text-center relative overflow-hidden border border-brand-beige">
                <div className="absolute top-2 left-2 text-[9px] text-brand-taupe font-mono">IP: 184.28.110.15</div>
                <div className="text-brand-white font-bold text-xs truncate max-w-[200px]">{v.product}</div>
                <div className="text-2xl font-black text-red-600 my-2">${v.advertised}</div>
                <div className="text-[10px] text-brand-taupe uppercase tracking-wide">Sold By: <MerchantLogo name={v.merchant} /></div>
              </div>
            </div>

            {/* Column 3: Chronological Timeline */}
            <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
              <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-3">Timeline</h4>
              <div className="space-y-3.5 text-xs relative pl-3.5 border-l border-brand-beige">
                <div className="relative">
                  <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                  <div className="font-bold text-brand-charcoal">Detected</div>
                  <div className="text-brand-taupe">Pricing discrepancy logged by crawler.</div>
                  <div className="text-[10px] text-brand-copper mt-0.5 font-medium">Aug 23, 2026 10:15 AM</div>
                </div>
                <div className="relative">
                  <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                  <div className="font-bold text-brand-charcoal">Validated</div>
                  <div className="text-brand-taupe">Assigned to compliance queue.</div>
                  <div className="text-[10px] text-brand-copper mt-0.5 font-medium">Aug 23, 2026 10:20 AM</div>
                </div>
                <div className="relative">
                  <span className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ${v.status === 'Resolved' || v.status === 'Notified' ? 'bg-brand-copper' : 'bg-brand-beige'}`} />
                  <div className="font-bold text-brand-charcoal">Seller Warned</div>
                  <div className="text-brand-taupe">{v.status === 'Resolved' || v.status === 'Notified' ? 'Warning email sent to merchant.' : 'Pending draft compilation.'}</div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Action Controls */}
        <div className="flex justify-end gap-3 border-t border-brand-beige pt-4 mt-6">
          <button onClick={() => { onResolve(v.id); showToast("Discrepancy marked resolved.", "success"); }} className="text-sm font-semibold border border-brand-taupe rounded-lg px-4 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer">
            Mark Resolved
          </button>
          <button onClick={() => showToast("Escalated to brand manager dashboard queue.", "info")} className="text-sm font-semibold border border-brand-beige rounded-lg px-4 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer">
            Escalate
          </button>
          <PrimaryButton onClick={() => { onSendWarning(v.id); showToast("Dispatched compliance warnings alert to merchant manager.", "success"); }}>
            Send Warning Notice
          </PrimaryButton>
        </div>

      </div>
    </div>
  );
}

function EmailCenterView({ clientName }) {
  return (
    <div>
      <PageHeader title={`Email Center — ${clientName} (Sandbox)`} action={<PrimaryButton><Mail className="w-4 h-4" /> Compose email</PrimaryButton>} />
      <Card>
        <Table columns={["Date", "Seller", "Violation Reference", "Template", "Status", "Opened", "Response"]}>
          {EMAILS.map((e, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-taupe">{e.date}</td>
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{e.seller}</td>
              <td className="py-2 px-3 text-brand-copper font-medium">{e.violation}</td>
              <td className="py-2 px-3 text-brand-taupe">{e.template}</td>
              <td className="py-2 px-3"><Pill text={e.status} tone={STATUS_BG.Delivered} /></td>
              <td className="py-2 px-3 text-brand-taupe">{e.opened}</td>
              <td className="py-2 px-3 text-brand-taupe">{e.response}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function MerchantsView({ clientName }) {
  const { db } = React.useContext(DataContext);
  const merchants = db[clientName].merchants;
  return (
    <div>
      <PageHeader title={`Merchants (Sellers) — ${clientName} (Sandbox)`} />
      <Card>
        <Table columns={["Merchant / channel", "Type", "Tracked SKUs", "Violations", "Compliance"]}>
          {merchants.map((m) => (
            <tr key={m.name} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 font-semibold text-brand-charcoal flex items-center gap-2"><Store className="w-4 h-4 text-brand-taupe" /> {m.name}</td>
              <td className="py-2 px-3 text-brand-taupe">{m.type}</td>
              <td className="py-2 px-3 text-brand-charcoal">{m.tracked}</td>
              <td className="py-2 px-3">{m.violations > 0 ? <Pill text={m.violations} tone="bg-red-50 text-red-700 border-red-200" /> : "0"}</td>
              <td className="py-2 px-3">
                <span className={m.compliance >= 90 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>{m.compliance}%</span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function ReportsView({ clientName }) {
  return (
    <div>
      <PageHeader title={`Reports — ${clientName} (Sandbox)`} action={<PrimaryButton><Plus className="w-4 h-4" /> Schedule report</PrimaryButton>} />
      <Card>
        <Table columns={["Report name", "Frequency", "Recipients", "Last run", "Format"]}>
          {REPORTS.map((r, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{r.name}</td>
              <td className="py-2 px-3 text-brand-taupe">{r.freq}</td>
              <td className="py-2 px-3 text-brand-taupe">{r.recipients}</td>
              <td className="py-2 px-3 text-brand-taupe">{r.lastRun}</td>
              <td className="py-2 px-3"><Pill text={r.format} tone="bg-slate-100 text-slate-600 border-slate-200" /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AlertsView({ clientName }) {
  return (
    <div>
      <PageHeader title={`Alerts — ${clientName} (Sandbox)`} action={<PrimaryButton><Plus className="w-4 h-4" /> Add rule</PrimaryButton>} />
      <Card>
        <Table columns={["Alert name", "Condition", "Channel", "Recipients"]}>
          {ALERTS.map((a, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{a.name}</td>
              <td className="py-2 px-3 text-brand-taupe">{a.condition}</td>
              <td className="py-2 px-3 text-brand-taupe">{a.channel}</td>
              <td className="py-2 px-3 text-brand-taupe">{a.recipients}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function SettingsView({ clientName }) {
  return (
    <div>
      <PageHeader title={`Settings — ${clientName} (Sandbox)`} action={<PrimaryButton><Check className="w-4 h-4" /> Save changes</PrimaryButton>} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Client information">
          <div className="space-y-3 text-sm">
            <div><div className="text-xs text-brand-taupe mb-1">Client name</div><div className="text-brand-charcoal font-medium">{clientName} Electronics (Sandbox)</div></div>
            <div><div className="text-xs text-brand-taupe mb-1">Region</div><div className="text-brand-charcoal font-medium">North America</div></div>
            <div><div className="text-xs text-brand-taupe mb-1">Currency</div><div className="text-brand-charcoal font-medium">USD — US Dollar</div></div>
          </div>
        </Card>
        <Card title="Other settings">
          <div className="space-y-3 text-sm">
            <div><div className="text-xs text-brand-taupe mb-1">Default scrape frequency</div><div className="text-brand-charcoal font-medium">Daily</div></div>
            <div><div className="text-xs text-brand-taupe mb-1">MAP tolerance</div><div className="text-brand-charcoal font-medium">1%</div></div>
            <div><div className="text-xs text-brand-taupe mb-1">Approval required before sending emails</div><div className="text-brand-charcoal font-medium">Enabled</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function UsersView({ clientName }) {
  return (
    <div>
      <PageHeader title={`Users & Access — ${clientName} (Sandbox)`} action={<PrimaryButton><Plus className="w-4 h-4" /> Invite user</PrimaryButton>} />
      <Card>
        <Table columns={["User", "Role", "Access level", "Last active", "Status"]}>
          {USERS.map((u, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{u.name}</td>
              <td className="py-2 px-3 text-brand-taupe">{u.role}</td>
              <td className="py-2 px-3 text-brand-taupe">{u.access}</td>
              <td className="py-2 px-3 text-brand-taupe">{u.lastActive}</td>
              <td className="py-2 px-3"><Pill text={u.status} tone={STATUS_BG.Active} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AuditLogView({ clientName }) {
  const rows = [
    { time: "Today, 10:15 AM", user: "Fenil Dholaviya", action: "Sent violation email for VIO-0123" },
    { time: "Today, 09:50 AM", user: "Auto Rule", action: "Mapped LG-003 to XYZ Electronics" },
    { time: "Yesterday, 04:12 PM", user: "analyst@mirethos.com", action: "Excluded LG Remote Control from tracking" },
  ];
  return (
    <div>
      <PageHeader title={`Audit Log — ${clientName} (Sandbox)`} />
      <Card>
        <Table columns={["Time", "User", "Action"]}>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-taupe">{r.time}</td>
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{r.user}</td>
              <td className="py-2 px-3 text-brand-charcoal">{r.action}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ---------- Navigation layout menu ----------
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

export const DataContext = React.createContext(null);

const generateInitialData = () => {
  const db = {};
  CLIENTS.forEach(client => {
    const isLg = client.name === "LG";
    db[client.name] = {
      skus: isLg ? [...SKUS] : SKUS.map((s, i) => ({ ...s, id: `${client.name}-00${i+1}`, name: `${client.name} Product ${i+1}`, violations: Math.floor(Math.random() * 3) })).slice(0, client.skus),
      violations: isLg ? [...VIOLATIONS] : VIOLATIONS.map((v, i) => ({ ...v, id: `VIO-${Math.random().toString(36).substr(2, 5).toUpperCase()}`, sku: `${client.name}-00${i+1}`, product: `${client.name} Product ${i+1}` })).slice(0, client.merchants * 2),
      merchants: [...MERCHANTS],
      mappingStage: isLg ? [...MAPPING_STAGE] : [],
      mappingInclude: isLg ? [...MAPPING_INCLUDE] : [],
      mappingExclude: isLg ? [...MAPPING_EXCLUDE] : []
    };
  });
  return db;
};

export default function App() {
  const [db, setDb] = useState(generateInitialData);
  // Screen Router States: 'login', 'client-select', 'app'
  const [screen, setScreen] = useState('login');
  const [activeClient, setActiveClient] = useState("LG");
  
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const brandColors = {
      LG: { light: "#A50034", dark: "#FF4D6D" },
      Philips: { light: "#0066A1", dark: "#3B82F6" },
      Kawasaki: { light: "#1F2937", dark: "#6EE7B7" },
      Citizen: { light: "#475569", dark: "#94A3B8" }
    };
    
    const colors = brandColors[activeClient] || { light: "#A65E44", dark: "#E38663" };
    document.documentElement.style.setProperty('--accent-brand', isDark ? colors.dark : colors.light);

    if (isDark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
  }, [isDark, activeClient]);
  
  const [view, setView] = useState("overview");
  const [clientOpen, setClientOpen] = useState(false);
  const [violation, setViolation] = useState(null);

  // Forms modals
  const [modals, setModals] = useState({ product: false, exception: false });
  const [toasts, setToasts] = useState([]);

  // Login variables
  const [loginEmail, setLoginEmail] = useState('operations@mirethos.com');
  const [loginPassword, setLoginPassword] = useState('••••••••••••');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Client configuration
  const client = CLIENTS.find((c) => c.name === activeClient);

  const showToast = (message, type = 'success', duration = 4000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  const closeModal = (type) => {
    setModals(prev => ({ ...prev, [type]: false }));
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setTimeout(() => {
      setIsLoggingIn(false);
      setScreen('client-select');
      showToast("Credentials authorized.", "success");
    }, 1000);
  };

  const handleSelectClient = (clientName) => {
    setActiveClient(clientName);
    setScreen('app');
    setView('overview');
    showToast(`Loaded ${clientName} portal sandbox.`, "success");
  };

  const handleSendWarning = (violationId) => {
    setDb(prev => {
      const clientData = prev[activeClient];
      return {
        ...prev,
        [activeClient]: {
          ...clientData,
          violations: clientData.violations.map(v => 
            v.id === violationId ? { ...v, status: "Notified" } : v
          )
        }
      }
    });
    showToast(`Notice sent for violation ID ${violationId}`, "success");
    setViolation(null); // Close the drawer
  };

  const handleResolveViolation = (violationId) => {
    setDb(prev => {
      const clientData = prev[activeClient];
      return {
        ...prev,
        [activeClient]: {
          ...clientData,
          violations: clientData.violations.map(v => 
            v.id === violationId ? { ...v, status: "Resolved" } : v
          )
        }
      }
    });
    showToast(`Violation ID ${violationId} resolved successfully.`, "success");
    setViolation(null); // Close the drawer
  };

  const handleProductSubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const sku = data.get('sku');
    const name = data.get('name');
    const model = data.get('model');
    const category = data.get('category');
    
    setDb(prev => {
      const clientData = prev[activeClient];
      return {
        ...prev,
        [activeClient]: {
          ...clientData,
          skus: [
            { id: sku, name, model, category, map: 999, current: 999, violations: 0, status: "Active" },
            ...clientData.skus
          ]
        }
      }
    });

    showToast(`SKU "${sku}" successfully registered for crawl monitors.`, 'success');
    closeModal('product');
    e.target.reset();
  };

  const handleExceptionSubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const seller = data.get('seller');
    showToast(`Pricing allowance exception authorized for ${seller}.`, 'success');
    closeModal('exception');
    e.target.reset();
  };

  const mainContent = useMemo(() => {
    switch (view) {
      case "overview": return <OverviewView onOpenViolation={setViolation} clientName={client.name} />;
      case "product": return <ProductSummaryView clientName={client.name} onAddSkuClick={() => setModals(prev => ({ ...prev, product: true }))} />;
      case "mapping": return <MappingCenterView clientName={client.name} />;
      case "pricing": return <PricingView clientName={client.name} onAddPromoClick={() => setModals(prev => ({ ...prev, exception: true }))} />;
      case "merchants": return <MerchantsView clientName={client.name} />;
      case "violations": return <ViolationsView onOpenViolation={setViolation} clientName={client.name} />;
      case "email": return <EmailCenterView clientName={client.name} />;
      case "reports": return <ReportsView clientName={client.name} />;
      case "alerts": return <AlertsView clientName={client.name} />;
      case "settings": return <SettingsView clientName={client.name} />;
      case "users": return <UsersView clientName={client.name} />;
      case "audit": return <AuditLogView clientName={client.name} />;
      default: return null;
    }
  }, [view, client]);

  // --------------------------------------------------------------------------
  // RENDER: WELCOME LOGIN
  // --------------------------------------------------------------------------
  if (screen === 'login') {
    return (
      <div className="min-vh-100 flex items-center justify-center bg-brand-charcoal font-sans" style={{ minHeight: '100vh' }}>
        <div className="bg-brand-sidebar border border-white/10 rounded-xl p-8 w-96 shadow-2xl text-brand-white">
          <div className="flex items-center gap-2.5 mb-6 justify-center">
            <img src="/favicon.ico" alt="Mirethos Logo" className="w-7 h-7 bg-brand-white p-1 rounded-md" />
            <div>
              <span className="text-white text-base font-bold tracking-wide">MIRETHOS</span>
              <span className="text-[9px] text-brand-taupe uppercase tracking-wider block -mt-1">MAP Portal Login</span>
            </div>
          </div>

          <h3 className="text-base font-semibold text-white mb-1">Welcome Back</h3>
          <p className="text-xs text-brand-taupe mb-5">Enter credentials to access strategic market intelligence.</p>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">Business Email</label>
              <input type="email" placeholder="name@company.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full px-3 py-2 text-sm border border-brand-taupe rounded-lg bg-brand-charcoal text-white focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-brand-taupe">Password</label>
                <a href="#" className="text-[10px] text-brand-copper hover:underline" onClick={e => { e.preventDefault(); showToast("Recovery portal loaded.", "info"); }}>Forgot?</a>
              </div>
              <input type="password" placeholder="Enter your password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required className="w-full px-3 py-2 text-sm border border-brand-taupe rounded-lg bg-brand-charcoal text-white focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>

            <label className="text-xs text-brand-taupe flex items-center gap-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded border-brand-taupe bg-brand-charcoal text-brand-copper focus:ring-brand-copper/30" /> Remember me
            </label>

            <button type="submit" className="w-full py-2.5 bg-brand-copper hover:bg-brand-copper/90 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer mt-2">
              Sign In
            </button>
          </form>

          <div className="border-t border-white/5 mt-6 pt-4 text-center text-[10px] text-brand-taupe flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Secured by enterprise-grade encryption
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: CLIENT SELECTION
  // --------------------------------------------------------------------------
  if (screen === 'client-select') {
    return (
      <div className="min-vh-100 flex items-center justify-center bg-brand-ivory font-sans p-4" style={{ minHeight: '100vh' }}>
        <div className="max-w-2xl w-full">
          <div className="flex items-center gap-2.5 mb-8 justify-center">
            <img src="/favicon.ico" alt="Mirethos Logo" className="w-8 h-8 bg-brand-white p-1 rounded-md border border-brand-beige" />
            <div>
              <span className="text-brand-charcoal text-lg font-bold tracking-wide">MIRETHOS</span>
              <span className="text-[10px] text-brand-taupe uppercase tracking-wider block -mt-1">AI Market Intelligence Platform</span>
            </div>
          </div>

          <div className="bg-brand-white border border-brand-beige rounded-xl p-6 shadow-md">
            <h2 className="text-base font-bold text-brand-charcoal mb-1">Select Client</h2>
            <p className="text-xs text-brand-taupe mb-5">Choose a client to access the MAP Intelligence Portal</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CLIENTS.map((c) => (
                <div key={c.name} className="bg-brand-white border border-brand-beige hover:border-brand-copper/50 rounded-xl p-4 transition-all cursor-pointer shadow-sm"
                  onClick={() => handleSelectClient(c.name)}>
                  <div className="flex justify-between items-start mb-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${c.status === 'Sandbox' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{c.status}</span>
                    <div className="flex items-center justify-end">
                      <ClientLogo name={c.name} className="w-10 h-10 rounded-lg border border-brand-beige shadow-sm bg-brand-white" />
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-brand-taupe mb-4">
                    <div>• SKUs Configured: {c.skus}</div>
                    <div>• Scanned Storefronts: {c.merchants}</div>
                  </div>
                  <div className="text-xs font-semibold text-brand-copper flex items-center gap-1">
                    Open Workspace &rarr;
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-6">
            <button className="text-xs text-brand-taupe hover:text-brand-charcoal font-semibold border border-brand-beige bg-brand-white rounded-lg px-3 py-1.5 cursor-pointer" onClick={() => setScreen('login')}>Back to Log In</button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: WORKSPACE PORTAL SHELL
  // --------------------------------------------------------------------------
  return (
    <DataContext.Provider value={{ db, setDb }}>
      <div className="flex h-screen bg-brand-ivory font-sans text-brand-charcoal select-none">
      
      {/* Sidebar */}
      <div className="w-60 bg-brand-sidebar text-brand-charcoal flex flex-col shrink-0 border-r border-brand-beige shadow-lg">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-brand-beige">
          <img src="/favicon.ico" alt="Mirethos Logo" className="w-6.5 h-6.5 bg-brand-white p-1 rounded-md" />
          <span className="text-brand-charcoal text-sm font-bold tracking-wide">MIRETHOS</span>
        </div>

        {/* Client selector details */}
        <div className="px-3 py-3 border-b border-brand-beige relative">
          <button onClick={() => setClientOpen((o) => !o)} className="w-full flex items-center justify-between hover:bg-brand-beige rounded-lg px-2.5 py-2 text-sm cursor-pointer">
            <div className="flex items-center gap-2">
              <ClientLogo name={client.name} className="w-6 h-6 rounded-md border border-brand-beige shadow-sm p-0.5" />
              <div className="text-left">
                <div className="text-brand-charcoal text-sm font-semibold">{client.name}</div>
                <div className="text-[10px] text-brand-taupe font-medium">{client.status}</div>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-brand-taupe" />
          </button>
          {clientOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-brand-white border border-brand-beige rounded-lg overflow-hidden z-10 shadow-xl">
              {CLIENTS.map((c) => (
                <button key={c.name} onClick={() => { setActiveClient(c.name); setClientOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-beige flex justify-between items-center cursor-pointer ${c.name === activeClient ? "text-brand-charcoal font-bold" : "text-brand-taupe"}`}>
                  <div className="flex items-center gap-2">
                    <ClientLogo name={c.name} className="w-4 h-4 rounded-sm" />
                    <span>{c.name}</span>
                  </div>
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
          <button onClick={() => { setScreen('login'); showToast("Logged out of session.", "info"); }} className="text-[10px] text-brand-copper hover:underline cursor-pointer">
            Exit
          </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto p-6 bg-brand-ivory">{mainContent}</div>

      {/* Slide-out drawer details */}
      <ViolationDrawer violation={violation} onClose={() => setViolation(null)} onSendWarning={handleSendWarning} onResolve={handleResolveViolation} />

      {/* Floating Theme Toggle */}
      <button 
        onClick={() => setIsDark(!isDark)} 
        className="fixed bottom-6 right-6 p-3 bg-brand-charcoal text-brand-white rounded-full shadow-lg hover:bg-brand-taupe transition-colors z-50 cursor-pointer flex items-center justify-center"
        title="Toggle Theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* ADD SKU MODAL */}
      <div className={`modal fixed inset-0 bg-brand-charcoal/40 flex items-center justify-center z-50 transition-opacity ${modals.product ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-brand-white border border-brand-beige rounded-xl p-6 w-96 shadow-2xl">
          <div className="flex justify-between items-center border-b border-brand-beige pb-3 mb-4">
            <h3 className="text-sm font-bold text-brand-charcoal">Add Monitored SKU</h3>
            <button onClick={() => closeModal('product')} className="text-brand-taupe hover:text-brand-charcoal"><X className="w-4 h-4" /></button>
          </div>

          <div className="mb-4 p-3 bg-brand-ivory border border-brand-beige rounded-lg text-center">
            <p className="text-xs text-brand-taupe mb-2">Want to add multiple SKUs at once?</p>
            <button type="button" onClick={() => alert('Bulk upload feature coming soon!')} className="text-xs font-semibold bg-brand-white border border-brand-beige rounded px-3 py-1.5 text-brand-copper hover:bg-brand-beige cursor-pointer w-full flex items-center justify-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              Upload CSV / Excel
            </button>
          </div>
          
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px bg-brand-beige flex-1"></div>
            <span className="text-[10px] uppercase font-bold text-brand-taupe tracking-wider">Or enter manually</span>
            <div className="h-px bg-brand-beige flex-1"></div>
          </div>

          <form onSubmit={handleProductSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">SKU Code *</label>
              <input type="text" name="sku" required placeholder="e.g. LG-011" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">Product Name *</label>
              <input type="text" name="name" required placeholder="e.g. LG UltraGear Curved Monitor" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Model / MPN *</label>
                <input type="text" name="model" required placeholder="34WP65C-B" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Category</label>
                <input type="text" name="category" defaultValue="Monitor" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">MAP Price ($) *</label>
                <input type="number" step="0.01" name="map" required placeholder="449.00" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">MSRP ($)</label>
                <input type="number" step="0.01" name="msrp" placeholder="499.00" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">Primary Merchant *</label>
              <input type="text" name="seller" defaultValue="XYZ Electronics" required className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>
            <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
              <button type="button" onClick={() => closeModal('product')} className="text-xs font-semibold border border-brand-beige rounded-lg px-3 py-1.5 text-brand-charcoal hover:bg-brand-beige cursor-pointer">Cancel</button>
              <PrimaryButton type="submit">Add SKU</PrimaryButton>
            </div>
          </form>
        </div>
      </div>

      {/* ADD EXCEPTION MODAL */}
      <div className={`modal fixed inset-0 bg-brand-charcoal/40 flex items-center justify-center z-50 transition-opacity ${modals.exception ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-brand-white border border-brand-beige rounded-xl p-6 w-96 shadow-2xl">
          <div className="flex justify-between items-center border-b border-brand-beige pb-3 mb-4">
            <h3 className="text-sm font-bold text-brand-charcoal">New Pricing Allowance Promotion</h3>
            <button onClick={() => closeModal('exception')} className="text-brand-taupe hover:text-brand-charcoal"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleExceptionSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">Merchant Storefront *</label>
              <input type="text" name="seller" required placeholder="e.g. XYZ Electronics" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-taupe mb-1">Product SKU *</label>
              <input type="text" name="scope" required placeholder="LG-001" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Promo Price ($) *</label>
                <input type="number" step="0.01" name="discount" required placeholder="1399.00" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Start Date *</label>
                <input type="date" name="start" required defaultValue="2026-08-25" className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
              <button type="button" onClick={() => closeModal('exception')} className="text-xs font-semibold border border-brand-beige rounded-lg px-3 py-1.5 text-brand-charcoal hover:bg-brand-beige cursor-pointer">Cancel</button>
              <PrimaryButton type="submit">Create Promo</PrimaryButton>
            </div>
          </form>
        </div>
      </div>

      {/* TOAST alerts */}
      <div className="toast-container fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className="bg-brand-sidebar border border-brand-beige text-brand-white px-4 py-3 rounded-lg shadow-xl text-xs flex items-center gap-2 animate-fade-in">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style={{ whiteSpace: 'pre-line' }}>{t.message}</div>
          </div>
        ))}
      </div>

    </div>
    </DataContext.Provider>
  );
}

