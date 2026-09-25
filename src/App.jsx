import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  Plus, ChevronDown, ExternalLink, X, ChevronLeft, ChevronRight,
  MapPin, Lock, Moon, Sun, Radar, Loader2
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
import { MapPoliciesView, ProductSummaryView } from "./views/CatalogViews.jsx";
import { MappingCenterView } from "./views/MappingCenterView.jsx";
import { SellersView } from "./views/SellersView.jsx";
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
  { id: "mapping", label: "Mapping Center", icon: Shuffle, needs: "mapping.read" },
  { id: "sources", label: "Sources & Terms", icon: Radar, needs: "sources.read" },
  { id: "pricing", label: "MAP Policies", icon: DollarSign },
  { id: "merchants", label: "Sellers", icon: Store, needs: "sellers.read" },
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

  const [toasts, setToasts] = useState([]);
  const toastSeq = React.useRef(0);

  // Login variables (the mock sign-in keeps its demo values; the real API needs a real password)
  const [loginEmail, setLoginEmail] = useState('operations@mirethos.com');
  const [loginPassword, setLoginPassword] = useState(api.isMock ? '••••••••••••' : '');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // Shown when sign-in takes long, which usually means the API is waking from sleep.
  const [slowLogin, setSlowLogin] = useState(false);

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

  const updateWorkspace = (clientName, fn) => {
    setDb(prev => ({ ...prev, [clientName]: fn(prev[clientName] || EMPTY_WORKSPACE) }));
  };

  // Wake the API while the user is still typing (the free host sleeps when idle).
  useEffect(() => { api.wake(); }, []);

  // After sign-in (or accepting an invite): load the user, accounts and shared data together,
  // then each account's workspace, and open the client picker.
  const enterPortal = async () => {
    const [user, list, sharedData] = await Promise.all([api.me(), api.listClients(), api.loadShared()]);
    const workspaces = await Promise.all(list.map((c) => api.loadWorkspace(c)));
    const nextDb = {};
    list.forEach((c, i) => { nextDb[c.name] = workspaces[i]; });
    setShared(sharedData);
    setClients(list);
    setDb(nextDb);
    setCurrentUser(user);
    if (list.length && !list.some((c) => c.name === activeClient)) setActiveClient(list[0].name);
    setScreen('client-select');
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const slowTimer = setTimeout(() => setSlowLogin(true), 5000);
    try {
      await api.login(loginEmail, loginPassword);
      await enterPortal();
      showToast("Credentials authorized.", "success");
    } catch (err) {
      showToast(err.message || "Sign in failed.", "info");
    } finally {
      clearTimeout(slowTimer);
      setIsLoggingIn(false);
      setSlowLogin(false);
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

  const mainContent = useMemo(() => {
    switch (currentView) {
      case "overview": return <OverviewView onOpenViolation={setViolation} clientName={client.name} />;
      case "product": return <ProductSummaryView />;
      case "mapping": return <MappingCenterView />;
      case "sources": return <SourcesTermsView skus={workspace.skus} />;
      case "pricing": return <MapPoliciesView />;
      case "merchants": return <SellersView />;
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
        onAccepted={async () => {
          window.history.replaceState(null, '', window.location.pathname);
          await enterPortal();
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

            <button type="submit" disabled={isLoggingIn} className="w-full py-2.5 bg-brand-copper hover:bg-brand-copper/90 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer mt-2 disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2">
              {isLoggingIn && <Loader2 className="w-4 h-4 animate-spin" />}
              {isLoggingIn ? "Signing in…" : "Sign In"}
            </button>
            {slowLogin && (
              <p className="text-[11px] text-brand-taupe text-center">Waking up the server. The first sign-in after a quiet spell can take up to a minute.</p>
            )}
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

