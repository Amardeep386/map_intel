import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  Plus, ChevronDown, ExternalLink, X, ChevronLeft, ChevronRight,
  Eye, MapPin, Ban, Sparkles, Lock, Moon, Sun, Radar
} from "lucide-react";
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import lgLogo from "./assets/lg.png";
import philipsLogo from "./assets/philips.png";
import kawasakiLogo from "./assets/kawasaki.png";
import { api } from "./api/client.js";
import { Card, KPI, PageHeader, Pill, PrimaryButton, SearchBox, Table } from "./ui.jsx";
import { WorkspaceContext } from "./workspace.js";
import { SourcesTermsView } from "./views/SourcesTermsView.jsx";
import { AuditLogView, SettingsView, UsersView } from "./views/AdminViews.jsx";

// ---------- Format Currency Utility (USD) ----------
const formatUSD = (number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(number);
};

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
  Expired: "bg-slate-50 text-slate-700 border-slate-200",
};

// ---------- Small building blocks ----------
// Logos come from the source record (source.logo_url), never from third-party logo lookups.
function MerchantLogo({ name, logoUrl }) {
  const [error, setError] = useState(false);
  if (logoUrl && !error) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img src={logoUrl} alt={name} className="w-4 h-4 rounded-full object-contain bg-brand-white border border-brand-beige" onError={() => setError(true)} />
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

  if (src && !error) {
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

// ---------- Views ----------
function OverviewView({ onOpenViolation, clientName }) {
  const { db, shared, chartColors } = React.useContext(DataContext);
  const clientData = db[clientName] || EMPTY_WORKSPACE;
  const { skus, violations, merchants } = clientData;
  const severityDist = shared.severityDist.map((d) => ({ ...d, color: SEVERITY_COLORS[d.name] }));
  const tooltipStyle = { background: chartColors.card, border: `1px solid ${chartColors.grid}`, borderRadius: 8, color: chartColors.text, fontSize: 12 };

  const topMerchants = [...merchants].sort((a, b) => b.violations - a.violations);
  const maxV = Math.max(1, ...topMerchants.map((m) => m.violations));
  
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
                <Pie data={severityDist} dataKey="value" innerRadius={40} outerRadius={65} paddingAngle={2} stroke={chartColors.card}>
                  {severityDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: chartColors.text }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 justify-center mt-1">
            {severityDist.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-brand-taupe">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </Card>
        <Card title="Violations over time" className="md:col-span-2">
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={shared.trend} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 'dataMax + 2']} tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: chartColors.text }} labelStyle={{ color: chartColors.muted }} />
              <Line type="monotone" dataKey="count" stroke={chartColors.accent} strokeWidth={2} dot={{ r: 3, fill: chartColors.accent, stroke: chartColors.accent }} />
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
  const skus = (db[clientName] || EMPTY_WORKSPACE).skus;
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
              <td className="py-2 px-3 text-brand-charcoal">{s.map != null ? `$${s.map.toLocaleString()}` : "—"}</td>
              <td className={`py-2 px-3 font-semibold ${s.current != null && s.map != null && s.current < s.map ? "text-red-600" : "text-brand-charcoal"}`}>{s.current != null ? `$${s.current.toLocaleString()}` : "—"}</td>
              <td className="py-2 px-3">{s.violations > 0 ? <Pill text={s.violations} tone="bg-red-50 text-red-700 border-red-200" /> : <span className="text-brand-taupe">0</span>}</td>
              <td className="py-2 px-3"><Pill text={s.status} tone={STATUS_BG[s.status]} /></td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">Showing {filtered.length} of {skus.length} SKUs</div>
      </Card>
    </div>
  );
}

function MappingCenterView({ clientName }) {
  const { db, setDb } = React.useContext(DataContext);
  const { mappingStage, mappingInclude, mappingExclude } = db[clientName] || EMPTY_WORKSPACE;

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
  const { db } = React.useContext(DataContext);
  const promotions = (db[clientName] || EMPTY_WORKSPACE).promotions;
  return (
    <div>
      <PageHeader title={`MAP & Pricing — ${clientName} (Sandbox)`} action={<PrimaryButton onClick={onAddPromoClick}><Plus className="w-4 h-4" /> Add promotion</PrimaryButton>} />
      <Card title="Promotions">
        <Table columns={["SKU", "Standard MAP", "Promo price", "Effective from", "Effective until", "Status"]}>
          {promotions.map((p, i) => (
            <tr key={i} className="border-b border-brand-beige hover:bg-brand-beige/20">
              <td className="py-2 px-3 text-brand-charcoal font-semibold">{p.sku}</td>
              <td className="py-2 px-3 text-brand-charcoal">{p.standard != null ? `$${p.standard}` : "—"}</td>
              <td className="py-2 px-3 text-emerald-700 font-bold">${p.promo}</td>
              <td className="py-2 px-3 text-brand-taupe">{p.from}</td>
              <td className="py-2 px-3 text-brand-taupe">{p.until}</td>
              <td className="py-2 px-3"><Pill text={p.status} tone={STATUS_BG[p.status] || STATUS_BG.Scheduled} /></td>
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
  const violations = (db[clientName] || EMPTY_WORKSPACE).violations;
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
function ViolationDrawer({ violation, onClose, onSendWarning, onResolve, onEscalate }) {
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
                <div className="absolute top-2 left-2 right-2 text-[9px] text-brand-taupe font-mono text-left truncate">
                  {v.evidence
                    ? `Captured ${new Date(v.evidence.capturedAt).toLocaleString()} · SHA-256 ${v.evidence.sha256.slice(0, 12)}…`
                    : "Sample data · no capture stored"}
                </div>
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
          <button onClick={() => onResolve(v.id)} className="text-sm font-semibold border border-brand-taupe rounded-lg px-4 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer">
            Mark Resolved
          </button>
          <button onClick={() => onEscalate(v.id)} className="text-sm font-semibold border border-brand-beige rounded-lg px-4 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer">
            Escalate
          </button>
          <PrimaryButton onClick={() => onSendWarning(v.id)}>
            Send Warning Notice
          </PrimaryButton>
        </div>

      </div>
    </div>
  );
}

function EmailCenterView({ clientName }) {
  const { shared } = React.useContext(DataContext);
  return (
    <div>
      <PageHeader title={`Email Center — ${clientName} (Sandbox)`} action={<PrimaryButton><Mail className="w-4 h-4" /> Compose email</PrimaryButton>} />
      <Card>
        <Table columns={["Date", "Seller", "Violation Reference", "Template", "Status", "Opened", "Response"]}>
          {shared.emails.map((e, i) => (
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
  const merchants = (db[clientName] || EMPTY_WORKSPACE).merchants;
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
  const { shared } = React.useContext(DataContext);
  return (
    <div>
      <PageHeader title={`Reports — ${clientName} (Sandbox)`} action={<PrimaryButton><Plus className="w-4 h-4" /> Schedule report</PrimaryButton>} />
      <Card>
        <Table columns={["Report name", "Frequency", "Recipients", "Last run", "Format"]}>
          {shared.reports.map((r, i) => (
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
  const { shared } = React.useContext(DataContext);
  return (
    <div>
      <PageHeader title={`Alerts — ${clientName} (Sandbox)`} action={<PrimaryButton><Plus className="w-4 h-4" /> Add rule</PrimaryButton>} />
      <Card>
        <Table columns={["Alert name", "Condition", "Channel", "Recipients"]}>
          {shared.alertRules.map((a, i) => (
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

// ---------- Accept an invite (opened from an invite link) ----------
function InviteAcceptScreen({ inviteToken, onAccepted, onCancel, showToast }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getInvite(inviteToken)
      .then((i) => { setInvite(i); setName(i.name || ""); })
      .catch((err) => setError(err.message || "This invite link is not valid."));
  }, [inviteToken]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 12) return showToast("Use at least 12 characters.", "info");
    if (password !== confirm) return showToast("The two passwords do not match.", "info");
    setBusy(true);
    try {
      await onAccepted(await api.acceptInvite(inviteToken, password, name));
    } catch (err) {
      showToast(err.message || "Could not accept the invite.", "info");
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-brand-taupe rounded-lg bg-brand-charcoal text-white focus:outline-none focus:ring-2 focus:ring-brand-copper/30";
  const open = invite && invite.state === "open";
  return (
    <div className="min-vh-100 flex items-center justify-center bg-brand-charcoal font-sans" style={{ minHeight: '100vh' }}>
      <div className="bg-brand-sidebar border border-white/10 rounded-xl p-8 w-96 shadow-2xl text-brand-white">
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <img src="/favicon.ico" alt="Mirethos Logo" className="w-7 h-7 bg-brand-white p-1 rounded-md" />
          <div>
            <span className="text-white text-base font-bold tracking-wide">MIRETHOS</span>
            <span className="text-[9px] text-brand-taupe uppercase tracking-wider block -mt-1">MAP Portal Invitation</span>
          </div>
        </div>
        {!invite && !error && <p className="text-xs text-brand-taupe text-center">Checking your invite…</p>}
        {(error || (invite && !open)) && (
          <>
            <h3 className="text-base font-semibold text-white mb-1">This link can't be used</h3>
            <p className="text-xs text-brand-taupe mb-5">{error || `This invite has ${invite.state === "used" ? "already been used" : invite.state}. Ask the person who invited you for a new link.`}</p>
            <button onClick={onCancel} className="w-full py-2.5 bg-brand-copper hover:bg-brand-copper/90 text-white rounded-lg text-sm font-semibold cursor-pointer">Go to sign in</button>
          </>
        )}
        {open && (
          <>
            <h3 className="text-base font-semibold text-white mb-1">Join {invite.account}</h3>
            <p className="text-xs text-brand-taupe mb-5">You were invited as <b className="text-white">{invite.role}</b> ({invite.email}). Choose a password to finish.</p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Password (at least 12 characters)</label>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">Repeat password</label>
                <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={inputCls} />
              </div>
              <button type="submit" disabled={busy} className="w-full py-2.5 bg-brand-copper hover:bg-brand-copper/90 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer mt-2 disabled:opacity-50">
                {busy ? "Setting up…" : "Accept invite"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Navigation layout menu ----------
const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "product", label: "Product Summary", icon: Package },
  { id: "mapping", label: "Mapping Center", icon: Shuffle },
  { id: "sources", label: "Sources & Terms", icon: Radar, needs: "sources.read" },
  { id: "pricing", label: "MAP & Pricing", icon: DollarSign },
  { id: "merchants", label: "Merchants (Sellers)", icon: Store },
  { id: "violations", label: "Violations", icon: AlertTriangle },
  { id: "email", label: "Email Center", icon: Mail },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: SettingsIcon, needs: "settings.read" },
  { id: "users", label: "Users & Access", icon: Users, needs: "users.read" },
  { id: "audit", label: "Audit Log", icon: ClipboardList, needs: "audit.read" },
];

export const DataContext = React.createContext(null);

const EMPTY_WORKSPACE = { skus: [], violations: [], merchants: [], mappingStage: [], mappingInclude: [], mappingExclude: [], promotions: [] };
const EMPTY_SHARED = { emails: [], reports: [], alertRules: [], alertUnread: 0, users: [], audit: [], severityDist: [], trend: [] };
const DEFAULT_CHART_COLORS = { grid: "rgba(60, 47, 47, 0.08)", muted: "#827064", text: "#3C2F2F", card: "#FFFFFF", accent: "#A65E44" };

const BRAND_COLORS = {
  LG: { light: "#A50034", dark: "#FF4D6D" },
  Philips: { light: "#0066A1", dark: "#3B82F6" },
  Kawasaki: { light: "#1F2937", dark: "#6EE7B7" },
  Citizen: { light: "#475569", dark: "#94A3B8" },
  Apple: { light: "#3A3A3C", dark: "#A1A1A6" },
  Samsung: { light: "#1428A0", dark: "#6B8BFF" },
};

const initials = (name) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// Local calendar date as YYYY-MM-DD (en-CA formats dates that way).
const todayIso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA");

export default function App() {
  // Workspace data per client name, plus lists shared by several screens. Loaded through the API client.
  const [db, setDb] = useState({});
  const [shared, setShared] = useState(EMPTY_SHARED);
  const [clients, setClients] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  // Screen Router States: 'invite', 'login', 'client-select', 'app'
  // An invite link (?invite=<token>) opens the accept-invite screen instead of sign-in.
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [screen, setScreen] = useState(() => (inviteToken ? 'invite' : 'login'));
  const [activeClient, setActiveClient] = useState("LG");
  
  const [isDark, setIsDark] = useState(false);
  const [chartColors, setChartColors] = useState(DEFAULT_CHART_COLORS);
  useEffect(() => {
    const accent = clients.find((c) => c.name === activeClient)?.accent;
    const colors = (accent?.light && accent) || BRAND_COLORS[activeClient] || { light: "#A65E44", dark: "#E38663" };
    document.documentElement.style.setProperty('--accent-brand', isDark ? colors.dark : colors.light);

    if (isDark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }

    // Charts read the live theme tokens so they follow light/dark mode and the client accent.
    const css = getComputedStyle(document.documentElement);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    setChartColors({
      grid: token('--border-color', DEFAULT_CHART_COLORS.grid),
      muted: token('--text-muted', DEFAULT_CHART_COLORS.muted),
      text: token('--text-primary', DEFAULT_CHART_COLORS.text),
      card: token('--card-bg', DEFAULT_CHART_COLORS.card),
      accent: (isDark ? colors.dark : colors.light) || DEFAULT_CHART_COLORS.accent,
    });
  }, [isDark, activeClient, clients]);
  
  const [view, setView] = useState("overview");
  const [clientOpen, setClientOpen] = useState(false);
  const [violation, setViolation] = useState(null);

  // Forms modals
  const [modals, setModals] = useState({ product: false, exception: false });
  const [toasts, setToasts] = useState([]);
  const toastSeq = React.useRef(0);

  // Login variables (the mock sign-in keeps its demo values; the real API needs a real password)
  const [loginEmail, setLoginEmail] = useState('operations@mirethos.com');
  const [loginPassword, setLoginPassword] = useState(api.isMock ? '••••••••••••' : '');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Client configuration
  const client = useMemo(
    () => clients.find((c) => c.name === activeClient) || clients[0] || { name: activeClient, status: "Sandbox", skus: 0, merchants: 0 },
    [clients, activeClient],
  );
  const workspace = db[client.name] || EMPTY_WORKSPACE;
  const activeViolationsCount = workspace.violations.filter((v) => v.status === "Open" || v.status === "Notified").length;
  const navBadges = { violations: activeViolationsCount, alerts: shared.alertUnread };
  const actions = useMemo(() => api.actionsFor(currentUser, client), [currentUser, client]);
  const nav = useMemo(() => NAV.filter((n) => !n.needs || actions.includes(n.needs)), [actions]);
  const accountRole = currentUser?.accounts?.find((a) => a.id === client.id)?.role;
  // Switching to an account where the current screen isn't allowed shows the Overview instead.
  const currentView = nav.some((n) => n.id === view) ? view : "overview";

  // Stable, so screens that load data on mount don't reload on every render.
  const showToast = React.useCallback((message, type = 'success', duration = 4000) => {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);
  const workspaceCtx = useMemo(() => ({ client, actions, showToast }), [client, actions, showToast]);

  const closeModal = (type) => {
    setModals(prev => ({ ...prev, [type]: false }));
  };

  const updateWorkspace = (clientName, fn) => {
    setDb(prev => ({ ...prev, [clientName]: fn(prev[clientName] || EMPTY_WORKSPACE) }));
  };

  // After sign-in (or accepting an invite): load the accounts and open the client picker.
  const enterPortal = async (user) => {
    const list = await api.listClients();
    const workspaces = await Promise.all(list.map((c) => api.loadWorkspace(c)));
    const nextDb = {};
    list.forEach((c, i) => { nextDb[c.name] = workspaces[i]; });
    setShared(await api.loadShared());
    setClients(list);
    setDb(nextDb);
    setCurrentUser(user);
    if (list.length && !list.some((c) => c.name === activeClient)) setActiveClient(list[0].name);
    setScreen('client-select');
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      await enterPortal(await api.login(loginEmail, loginPassword));
      showToast("Credentials authorized.", "success");
    } catch (err) {
      showToast(err.message || "Sign in failed.", "info");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setScreen('login');
    showToast("Logged out of session.", "info");
  };

  const handleSelectClient = (clientName) => {
    setActiveClient(clientName);
    setScreen('app');
    setView('overview');
    showToast(`Loaded ${clientName} portal sandbox.`, "success");
  };

  const setViolationStatus = (violationId, status) => {
    updateWorkspace(activeClient, (clientData) => ({
      ...clientData,
      violations: clientData.violations.map(v => v.id === violationId ? { ...v, status } : v),
    }));
  };

  const handleSendWarning = async (violationId) => {
    await api.sendWarning(activeClient, violationId);
    setViolationStatus(violationId, "Notified");
    showToast(`Notice sent for violation ID ${violationId}`, "success");
    setViolation(null); // Close the drawer
  };

  const handleResolveViolation = async (violationId) => {
    await api.resolveViolation(activeClient, violationId);
    setViolationStatus(violationId, "Resolved");
    showToast(`Violation ID ${violationId} resolved successfully.`, "success");
    setViolation(null); // Close the drawer
  };

  const handleEscalateViolation = async (violationId) => {
    await api.escalateViolation(activeClient, violationId);
    showToast("Escalated to brand manager dashboard queue.", "info");
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const num = (key) => {
      const v = String(data.get(key) ?? '').trim();
      return v === '' ? null : Number.parseFloat(v);
    };
    const sku = String(data.get('sku')).trim();
    const entry = {
      sku,
      name: String(data.get('name')).trim(),
      model: String(data.get('model')).trim(),
      category: String(data.get('category') ?? '').trim(),
      map: num('map'),
      msrp: num('msrp'),
    };
    if (workspace.skus.some((s) => s.id.toLowerCase() === sku.toLowerCase())) {
      showToast(`SKU "${sku}" already exists for ${activeClient}.`, 'info');
      return;
    }
    try {
      const row = await api.addSku(client, entry);
      updateWorkspace(activeClient, (clientData) => ({ ...clientData, skus: [row, ...clientData.skus] }));
      showToast(`SKU "${sku}" successfully registered for crawl monitors.`, 'success');
      closeModal('product');
      form.reset();
    } catch (err) {
      showToast(err.message || "Could not add the SKU.", 'info');
    }
  };

  const handleExceptionSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const entry = {
      seller: String(data.get('seller')).trim(),
      scope: String(data.get('scope')).trim(),
      promo: Number.parseFloat(String(data.get('discount'))),
      start: String(data.get('start')),
      end: String(data.get('end')),
    };
    if (entry.end < entry.start) {
      showToast("The end date must be on or after the start date.", 'info');
      return;
    }
    const promo = await api.addPromotion(client, entry, workspace.skus);
    updateWorkspace(activeClient, (clientData) => ({ ...clientData, promotions: [promo, ...(clientData.promotions || [])] }));
    showToast(`Pricing allowance exception authorized for ${entry.seller}.`, 'success');
    closeModal('exception');
    form.reset();
  };

  const mainContent = useMemo(() => {
    switch (currentView) {
      case "overview": return <OverviewView onOpenViolation={setViolation} clientName={client.name} />;
      case "product": return <ProductSummaryView clientName={client.name} onAddSkuClick={() => setModals(prev => ({ ...prev, product: true }))} />;
      case "mapping": return <MappingCenterView clientName={client.name} />;
      case "sources": return <SourcesTermsView skus={workspace.skus} />;
      case "pricing": return <PricingView clientName={client.name} onAddPromoClick={() => setModals(prev => ({ ...prev, exception: true }))} />;
      case "merchants": return <MerchantsView clientName={client.name} />;
      case "violations": return <ViolationsView onOpenViolation={setViolation} clientName={client.name} />;
      case "email": return <EmailCenterView clientName={client.name} />;
      case "reports": return <ReportsView clientName={client.name} />;
      case "alerts": return <AlertsView clientName={client.name} />;
      case "settings": return <SettingsView />;
      case "users": return <UsersView />;
      case "audit": return <AuditLogView />;
      default: return null;
    }
  }, [currentView, client, workspace.skus]);

  // --------------------------------------------------------------------------
  // RENDER: WELCOME LOGIN
  // --------------------------------------------------------------------------
  if (screen === 'invite') {
    return (
      <InviteAcceptScreen
        inviteToken={inviteToken}
        onAccepted={async (user) => {
          window.history.replaceState(null, '', window.location.pathname);
          await enterPortal(user);
          showToast("Welcome! Your account is ready.", "success");
        }}
        onCancel={() => { window.history.replaceState(null, '', window.location.pathname); setScreen('login'); }}
        showToast={showToast}
      />
    );
  }

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
              {clients.map((c) => (
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
    <DataContext.Provider value={{ db, setDb, shared, chartColors }}>
    <WorkspaceContext.Provider value={workspaceCtx}>
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
              {clients.map((c) => (
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
          {nav.map((n) => {
            const Icon = n.icon;
            const active = currentView === n.id;
            return (
              <button key={n.id} onClick={() => setView(n.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors border-l-2 cursor-pointer ${
                  active ? "bg-brand-beige border-brand-copper text-brand-charcoal font-semibold" : "border-transparent text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige/50"
                }`}>
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{n.label}</span>
                {navBadges[n.id] ? <span className="text-[9px] font-bold bg-brand-copper text-brand-white rounded-full px-1.5 py-0.5">{navBadges[n.id]}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Bottom User Avatar */}
        <div className="px-4 py-3 border-t border-brand-beige flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-brand-copper flex items-center justify-center text-xs text-brand-white font-bold">{initials(currentUser?.name || "Fenil Dholaviya")}</div>
            <div className="text-[11px]">
              <div className="text-brand-charcoal font-bold">{currentUser?.name || "Fenil Dholaviya"}</div>
              <div className="text-brand-taupe">{accountRole ?? (currentUser?.role === "member" ? "Member" : "Admin")}</div>
            </div>
          </div>
          <button onClick={handleLogout} className="text-[10px] text-brand-copper hover:underline cursor-pointer">
            Exit
          </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto p-6 bg-brand-ivory">{mainContent}</div>

      {/* Slide-out drawer details */}
      <ViolationDrawer violation={violation} onClose={() => setViolation(null)} onSendWarning={handleSendWarning} onResolve={handleResolveViolation} onEscalate={handleEscalateViolation} />

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
            <button type="button" onClick={() => showToast('Bulk upload arrives with catalogue import (Phase 2a).', 'info')} className="text-xs font-semibold bg-brand-white border border-brand-beige rounded px-3 py-1.5 text-brand-copper hover:bg-brand-beige cursor-pointer w-full flex items-center justify-center gap-2">
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
                <input type="date" name="start" required defaultValue={todayIso()} className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-brand-taupe mb-1">End Date *</label>
                <input type="date" name="end" required defaultValue={todayIso(7)} className="w-full px-3 py-2 text-sm border border-brand-beige rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-copper/30" />
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
    </WorkspaceContext.Provider>
    </DataContext.Provider>
  );
}

