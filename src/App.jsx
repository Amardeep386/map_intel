import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  Plus, ChevronDown, ExternalLink, X, ChevronLeft, ChevronRight,
  MapPin, Lock, Moon, Sun, Radar, Loader2, Activity, PanelLeftClose, PanelLeftOpen,
  Eye, EyeOff, ShieldCheck, ArrowRight
} from "lucide-react";
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import lgLogo from "./assets/lg.png";
import appleLogo from "./assets/apple.png";
import samsungLogo from "./assets/samsung.png";
import philipsLogo from "./assets/philips.png";
import kawasakiLogo from "./assets/kawasaki.png";
import { api } from "./api/client.js";
import { Card, KPI, PageHeader, Pill, PrimaryButton, Table } from "./ui.jsx";
import { WorkspaceContext } from "./workspace.js";
import { SourcesTermsView } from "./views/SourcesTermsView.jsx";
import { MapPoliciesView, ProductSummaryView } from "./views/CatalogViews.jsx";
import { MappingCenterView } from "./views/MappingCenterView.jsx";
import { SellersView } from "./views/SellersView.jsx";
import { DataHealthView } from "./views/DataHealthView.jsx";
import { ViolationsView } from "./views/ViolationsView.jsx";
import { AuditLogView, SettingsView, UsersView } from "./views/AdminViews.jsx";

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
  else if (lowerName === "apple") src = appleLogo;
  else if (lowerName === "samsung") src = samsungLogo;
  else if (lowerName === "philips") src = philipsLogo;
  else if (lowerName === "kawasaki") src = kawasakiLogo;

  if (src && !error) {
    return (
      // Always a white tile, in dark mode too: brand marks are made for white (Apple's is black).
      <div className={`flex items-center justify-center overflow-hidden bg-white ${className || "w-5 h-5 rounded-sm"}`}>
        <img 
          src={src} 
          alt={name} 
          className="w-full h-full object-contain"
          style={{ padding: '2px' }}
          onError={() => setError(true)} 
        />
      </div>
    );
  }
  
  return <div className={`flex items-center justify-center font-bold text-on-accent bg-brand-copper ${className || "w-5 h-5 rounded-sm"}`}>{name.charAt(0)}</div>;
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
          <div className="w-full">
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

// ------------------- Detailed Three Column Violation Drawer (Matches Screen 11 Detail) -------------------
function ViolationDrawer({ violation, onClose, onSendWarning, onResolve, onEscalate }) {
  if (!violation) return null;
  const v = violation;
  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50 transition-opacity" onClick={onClose}>
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
              <div className="bg-brand-ivory rounded-lg h-44 flex flex-col items-center justify-center p-4 text-center relative overflow-hidden border border-brand-beige">
                <div className="absolute top-2 left-2 right-2 text-[10px] text-brand-taupe font-mono text-left truncate">
                  {v.evidence
                    ? `Captured ${new Date(v.evidence.capturedAt).toLocaleString()} · SHA-256 ${v.evidence.sha256.slice(0, 12)}…`
                    : "Sample data · no capture stored"}
                </div>
                <div className="text-brand-charcoal font-bold text-xs truncate max-w-[200px]">{v.product}</div>
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

  const inputCls = "w-full h-11 px-3.5 text-sm rounded-xl border border-brand-beige bg-brand-white text-brand-charcoal placeholder:text-brand-taupe/70 shadow-sm transition focus:outline-none focus:border-brand-copper focus:ring-4 focus:ring-brand-copper/15";
  const label = "block text-[13px] font-medium mb-1.5";
  const button = "w-full h-11 rounded-xl bg-brand-copper text-white text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(166,94,68,0.7)] hover:brightness-110 transition cursor-pointer disabled:opacity-60";
  const open = invite && invite.state === "open";
  return (
    // Same look as the sign-in page: Mirethos copper, page colour of the theme.
    <div className="min-h-screen flex items-center justify-center bg-brand-ivory font-sans text-brand-charcoal px-6 py-12" style={{ "--color-brand-copper": "#A65E44", "--accent-coral": "#A65E44" }}>
      <div className="w-full max-w-[420px] bg-brand-white border border-brand-beige rounded-2xl p-8 shadow-[0_24px_60px_-24px_rgba(60,47,47,0.35)]">
        <div className="flex items-center gap-3 mb-8">
          <img src="/favicon.ico" alt="" className="w-9 h-9 rounded-xl bg-brand-ivory border border-brand-beige p-1.5" />
          <div>
            <div className="text-base font-semibold tracking-[0.18em]">MIRETHOS</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-brand-taupe">MAP Intelligence · Invitation</div>
          </div>
        </div>
        {!invite && !error && <p className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking your invite…</p>}
        {(error || (invite && !open)) && (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">This link can't be used</h2>
            <p className="mt-1.5 mb-6 text-sm text-brand-taupe">{error || `This invite has ${invite.state === "used" ? "already been used" : invite.state}. Ask the person who invited you for a new link.`}</p>
            <button onClick={onCancel} className={button}>Go to sign in</button>
          </>
        )}
        {open && (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">Join {invite.account}</h2>
            <p className="mt-1.5 mb-6 text-sm text-brand-taupe">You were invited as <b className="text-brand-charcoal">{invite.role}</b> ({invite.email}). Choose a password to finish.</p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className={label}>Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={label}>Password <span className="text-brand-taupe font-normal">(at least 12 characters)</span></label>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              </div>
              <div>
                <label className={label}>Repeat password</label>
                <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={inputCls} />
              </div>
              <button type="submit" disabled={busy} className={`${button} mt-2 flex items-center justify-center gap-2`}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up…</> : "Accept invite"}
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
  { id: "health", label: "Data Health", icon: Activity, needs: "health.read" },
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

// Sign-in: a brand panel (fixed espresso, the same in light and dark) beside the form on the theme's page colour.
const LOGIN_POINTS = [
  { icon: Radar, title: "Daily price checks", text: "Marketplace and retailer listings matched to your catalogue and re-checked every day." },
  { icon: ShieldCheck, title: "Evidence you can stand on", text: "Every price is saved with its page or API record, fingerprinted and locked." },
  { icon: Activity, title: "From detection to notice", text: "Spot below-MAP sellers, review the proof and act from one place." },
];

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, busy, slow, onForgot }) {
  const [showPw, setShowPw] = useState(false);
  const field = "w-full h-11 pl-10 pr-3 text-sm rounded-xl border border-brand-beige bg-brand-white text-brand-charcoal placeholder:text-brand-taupe/70 shadow-sm transition focus:outline-none focus:border-brand-copper focus:ring-4 focus:ring-brand-copper/15";
  return (
    // Before sign-in no brand is chosen: use Mirethos copper, not the default client's accent.
    <div className="min-h-screen flex bg-brand-ivory font-sans text-brand-charcoal" style={{ "--color-brand-copper": "#A65E44", "--accent-coral": "#A65E44" }}>
      <aside className="hidden lg:flex relative w-[46%] max-w-[640px] flex-col justify-between overflow-hidden p-12 text-[#FAF6EE]"
        style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(227,134,99,0.28) 0%, rgba(227,134,99,0) 55%), radial-gradient(90% 70% at 100% 100%, rgba(166,94,68,0.35) 0%, rgba(166,94,68,0) 60%), #17110F" }}>
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{ backgroundImage: "linear-gradient(#FAF6EE 1px, transparent 1px), linear-gradient(90deg, #FAF6EE 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.ico" alt="" className="w-10 h-10 rounded-xl bg-[#FAF6EE] p-1.5" />
          <div>
            <div className="text-lg font-semibold tracking-[0.18em]">MIRETHOS</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#A9998E]">MAP Intelligence</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-4xl xl:text-[44px] leading-[1.1] font-semibold tracking-tight">
            Protect your price.<br /><span className="text-[#E38663]">Prove every breach.</span>
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[#CDBFB4] max-w-md">
            Minimum Advertised Price monitoring and enforcement for brands that sell across marketplaces.
          </p>
          <div className="mt-10 space-y-5">
            {LOGIN_POINTS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[#E38663]/15 ring-1 ring-[#E38663]/30">
                  <Icon className="w-5 h-5 text-[#E38663]" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-[13px] leading-snug text-[#A9998E] max-w-sm">{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-[#A9998E]">© {new Date().getFullYear()} Mirethos</div>
      </aside>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <img src="/favicon.ico" alt="" className="w-9 h-9 rounded-xl bg-brand-white border border-brand-beige p-1.5" />
            <div>
              <div className="text-base font-semibold tracking-[0.18em]">MIRETHOS</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-brand-taupe">MAP Intelligence</div>
            </div>
          </div>

          <h2 className="text-[28px] font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1.5 text-sm text-brand-taupe">Sign in to your MAP Intel workspace.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-[13px] font-medium mb-1.5">Business email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-taupe" />
                <input id="login-email" type="email" autoComplete="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} required className={field} />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="login-password" className="text-[13px] font-medium">Password</label>
                <button type="button" onClick={onForgot} className="text-xs font-medium text-brand-copper hover:underline cursor-pointer">Forgot password?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-taupe" />
                <input id="login-password" type={showPw ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required className={`${field} pr-11`} />
                <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige/60 cursor-pointer">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-[13px] text-brand-taupe cursor-pointer select-none">
              <input type="checkbox" defaultChecked className="w-4 h-4 rounded accent-[var(--accent-coral)] cursor-pointer" /> Keep me signed in
            </label>

            <button type="submit" disabled={busy}
              className="group w-full h-11 rounded-xl bg-brand-copper text-white text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(166,94,68,0.7)] hover:brightness-110 active:brightness-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-wait">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
            {slow && (
              <p className="text-xs text-brand-taupe text-center leading-relaxed">Waking up the server. The first sign-in after a quiet spell can take up to a minute.</p>
            )}
          </form>

          <div className="mt-10 pt-6 border-t border-brand-beige flex items-center gap-2 text-xs text-brand-taupe">
            <ShieldCheck className="w-4 h-4 text-brand-copper" /> Encrypted connection · access is limited to invited users
          </div>
        </div>
      </main>
    </div>
  );
}

/** White or dark text, whichever reads better on a hex colour (WCAG relative luminance). */
function textOn(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (!Number.isFinite(n)) return "#FFFFFF";
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#17110F" : "#FFFFFF";
}

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
    const accentHex = isDark ? colors.dark : colors.light;
    document.documentElement.style.setProperty('--accent-brand', accentHex);
    document.documentElement.style.setProperty('--accent-contrast', textOn(accentHex));

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
  // Sidebar can shrink to an icon rail so wide screens (e.g. Product Summary) get the full width.
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem("navCollapsed") === "1"; } catch { return false; } });
  const toggleNav = () => setNavCollapsed((c) => { try { localStorage.setItem("navCollapsed", c ? "0" : "1"); } catch { /* storage unavailable */ } return !c; });
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
  const workspaceCtx = useMemo(() => ({ client, actions, showToast, chartColors, go: setView }), [client, actions, showToast, chartColors]);

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
      case "health": return <DataHealthView />;
      case "violations": return <ViolationsView />;
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
      <LoginScreen
        email={loginEmail} setEmail={setLoginEmail}
        password={loginPassword} setPassword={setLoginPassword}
        onSubmit={handleLoginSubmit} busy={isLoggingIn} slow={slowLogin}
        onForgot={() => showToast("Recovery portal loaded.", "info")}
      />
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
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${c.status === 'Sandbox' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{c.status}</span>
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
      <div className="flex h-screen bg-brand-ivory font-sans text-brand-charcoal">
      
      {/* Sidebar */}
      <div className={`${navCollapsed ? "w-14" : "w-60"} bg-brand-sidebar text-brand-charcoal flex flex-col shrink-0 border-r border-brand-beige shadow-lg transition-[width] duration-200`}>
        <div className={`flex items-center gap-2.5 py-4 border-b border-brand-beige ${navCollapsed ? "flex-col px-2" : "px-4"}`}>
          <img src="/favicon.ico" alt="Mirethos Logo" className="w-6.5 h-6.5 bg-brand-white p-1 rounded-md" />
          {!navCollapsed && <span className="text-brand-charcoal text-sm font-bold tracking-wide flex-1">MIRETHOS</span>}
          <button onClick={toggleNav} title={navCollapsed ? "Expand menu" : "Collapse menu"} className="text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige rounded-md p-1 cursor-pointer">
            {navCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Client selector details */}
        <div className={`${navCollapsed ? "px-1.5" : "px-3"} py-3 border-b border-brand-beige relative`}>
          <button onClick={() => setClientOpen((o) => !o)} title={navCollapsed ? client.name : undefined} className={`w-full flex items-center hover:bg-brand-beige rounded-lg py-2 text-sm cursor-pointer ${navCollapsed ? "justify-center px-1" : "justify-between px-2.5"}`}>
            <div className="flex items-center gap-2">
              <ClientLogo name={client.name} className="w-6 h-6 rounded-md border border-brand-beige shadow-sm p-0.5" />
              {!navCollapsed && (
                <div className="text-left">
                  <div className="text-brand-charcoal text-sm font-semibold">{client.name}</div>
                  <div className="text-[10px] text-brand-taupe font-medium">{client.status}</div>
                </div>
              )}
            </div>
            {!navCollapsed && <ChevronDown className="w-4 h-4 text-brand-taupe" />}
          </button>
          {clientOpen && (
            <div className={`absolute ${navCollapsed ? "left-1.5 w-52" : "left-3 right-3"} top-full mt-1 bg-brand-white border border-brand-beige rounded-lg overflow-hidden z-10 shadow-xl`}>
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
              <button key={n.id} onClick={() => setView(n.id)} title={navCollapsed ? n.label : undefined}
                className={`relative w-full flex items-center gap-2.5 py-2 text-sm ${navCollapsed ? "justify-center px-0" : "px-4"} transition-colors border-l-2 cursor-pointer ${
                  active ? "bg-brand-beige border-brand-copper text-brand-charcoal font-semibold" : "border-transparent text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige/50"
                }`}>
                <Icon className="w-4 h-4 shrink-0" />
                {!navCollapsed && <span className="flex-1 text-left">{n.label}</span>}
                {navBadges[n.id] ? <span className={`${navCollapsed ? "absolute top-0.5 right-1.5" : ""} text-[10px] font-bold bg-brand-copper text-on-accent rounded-full px-1.5 py-0.5`}>{navBadges[n.id]}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Bottom User Avatar */}
        <div className={`py-3 border-t border-brand-beige flex items-center justify-between ${navCollapsed ? "flex-col gap-2 px-1" : "px-4"}`}>
          <div className="flex items-center gap-2" title={navCollapsed ? currentUser?.name || "Fenil Dholaviya" : undefined}>
            <div className="w-7 h-7 rounded-full bg-brand-copper flex items-center justify-center text-xs text-on-accent font-bold">{initials(currentUser?.name || "Fenil Dholaviya")}</div>
            <div className={`text-[11px] ${navCollapsed ? "hidden" : ""}`}>
              <div className="text-brand-charcoal font-bold">{currentUser?.name || "Fenil Dholaviya"}</div>
              <div className="text-brand-taupe">{accountRole ?? (currentUser?.role === "member" ? "Member" : "Admin")}</div>
            </div>
          </div>
          <div className={`flex items-center gap-2 ${navCollapsed ? "flex-col" : ""}`}>
            <button onClick={() => setIsDark(!isDark)} title={isDark ? "Switch to light theme" : "Switch to dark theme"}
              className="text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige rounded-md p-1 cursor-pointer">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={handleLogout} className="text-[10px] text-brand-copper hover:underline cursor-pointer">
              Exit
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto p-6 bg-brand-ivory">{mainContent}</div>

      {/* Slide-out drawer details */}
      <ViolationDrawer violation={violation} onClose={() => setViolation(null)} onSendWarning={handleSendWarning} onResolve={handleResolveViolation} onEscalate={handleEscalateViolation} />

      {/* TOAST alerts */}
      <div className="toast-container fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className="bg-brand-charcoal text-brand-ivory px-4 py-3 rounded-xl shadow-xl text-sm flex items-center gap-2 animate-fade-in">
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

