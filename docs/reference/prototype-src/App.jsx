import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle, FileText, Bell, SettingsIcon, Users,
  ClipboardList, ChevronDown, Lock, Moon, Sun, Gavel, Radar, Scale, Activity, Plus, X
} from "./icons";
import { DataContext, ToastContext, ClientLogo, PrimaryButton, SecondaryButton, Modal, Field, inputCls } from "./ui";
import logo from "./assets/favicon.ico";
import {
  CLIENTS, SKUS, SELLERS, VIOLATIONS, CASES, MAPPING_STAGE, MAPPING_INCLUDE, MAPPING_EXCLUDE
} from "./data";
import { OverviewView, ViolationsView, ViolationDrawer, EvidencePage, SellersView, EnforcementView } from "./views_monitor";
import { ProductSummaryView, MapPoliciesView, MappingCenterView } from "./views_catalog";
import { SourcesTermsView, RulesView, DataHealthView } from "./views_collect";
import { ReportsView, AlertsView, SettingsView, UsersView, AuditLogView, OnboardingView } from "./views_admin";

// ---------- Navigation (grouped; tag = what changed vs the current portal) ----------
const NAV = [
  { group: "Monitor" },
  { id: "overview", label: "Overview", icon: LayoutDashboard, tag: "upd" },
  { id: "violations", label: "Violations", icon: AlertTriangle, badge: true, tag: "upd" },
  { id: "enforcement", label: "Enforcement", icon: Gavel, tag: "new" },
  { id: "sellers", label: "Sellers", icon: Store, tag: "upd" },
  { group: "Catalogue" },
  { id: "product", label: "Product Summary", icon: Package, tag: "upd" },
  { id: "policies", label: "MAP Policies", icon: DollarSign, tag: "upd" },
  { group: "Collection" },
  { id: "mapping", label: "Mapping Center", icon: Shuffle, tag: "upd" },
  { id: "sources", label: "Sources & Terms", icon: Radar, tag: "new" },
  { id: "rules", label: "Rules", icon: Scale, tag: "new" },
  { id: "health", label: "Data Health", icon: Activity, tag: "new" },
  { group: "Deliver" },
  { id: "reports", label: "Reports", icon: FileText, tag: "upd" },
  { id: "alerts", label: "Alerts", icon: Bell, badge: true, tag: "upd" },
  { group: "Admin" },
  { id: "settings", label: "Settings", icon: SettingsIcon, tag: "upd" },
  { id: "users", label: "Users & Access", icon: Users },
  { id: "audit", label: "Audit Log", icon: ClipboardList, tag: "upd" },
];

const generateInitialData = () => {
  const db = {};
  CLIENTS.forEach((client) => {
    const isLg = client.name === "LG";
    db[client.name] = {
      skus: isLg ? [...SKUS] : SKUS.map((s, i) => ({ ...s, id: `${client.name.slice(0, 3).toUpperCase()}-00${i + 1}`, name: `${client.name} Product ${i + 1}`, upc: "", violations: i % 3 })).slice(0, Math.min(client.skus, 10)),
      violations: isLg ? [...VIOLATIONS] : VIOLATIONS.slice(0, client.merchants).map((v, i) => ({ ...v, id: `VIO-${client.name.slice(0, 2).toUpperCase()}${i + 1}`, sku: `${client.name.slice(0, 3).toUpperCase()}-00${i + 1}`, product: `${client.name} Product ${i + 1}` })),
      sellers: [...SELLERS].map((s) => (s.name === "LG.com" ? { ...s, name: `${client.name}.com`, source: `${client.name}.com` } : s)),
      cases: isLg ? [...CASES] : CASES.slice(0, 2),
      mappingStage: isLg ? [...MAPPING_STAGE] : MAPPING_STAGE.slice(0, 1),
      mappingInclude: isLg ? [...MAPPING_INCLUDE] : [],
      mappingExclude: isLg ? [...MAPPING_EXCLUDE] : [],
    };
  });
  return db;
};

export default function App() {
  const [db, setDb] = useState(generateInitialData);
  const [screen, setScreen] = useState("app"); // 'login' | 'client-select' | 'onboarding' | 'app'
  const [activeClient, setActiveClient] = useState("LG");
  const [isDark, setIsDark] = useState(() => {
    try {
      const t = document.documentElement.dataset.theme;
      return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch { return false; }
  });
  const [view, setView] = useState("overview");
  const [clientOpen, setClientOpen] = useState(false);
  const [violationId, setViolationId] = useState(null);
  const [evidenceFor, setEvidenceFor] = useState(null);
  const [modals, setModals] = useState({ product: false, promo: false });
  const [toasts, setToasts] = useState([]);
  const [showTags, setShowTags] = useState(true);

  useEffect(() => {
    const brandColors = {
      LG: { light: "#A50034", dark: "#FF4D6D" },
      Philips: { light: "#0066A1", dark: "#3B82F6" },
      Kawasaki: { light: "#1F2937", dark: "#6EE7B7" },
      Citizen: { light: "#475569", dark: "#94A3B8" },
    };
    const colors = brandColors[activeClient] || { light: "#A65E44", dark: "#E38663" };
    document.documentElement.style.setProperty("--accent-brand", isDark ? colors.dark : colors.light);
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
  }, [isDark, activeClient]);

  const client = CLIENTS.find((c) => c.name === activeClient);
  const violation = violationId ? db[activeClient].violations.find((v) => v.id === violationId) : null;

  const showToast = (message, type = "success", duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  };

  const updateViolation = (id, patch) =>
    setDb((prev) => ({ ...prev, [activeClient]: { ...prev[activeClient], violations: prev[activeClient].violations.map((v) => (v.id === id ? { ...v, ...patch } : v)) } }));

  const openCount = db[activeClient].violations.filter((v) => ["Open", "Needs review"].includes(v.status)).length;

  const handleProductSubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setDb((prev) => ({ ...prev, [activeClient]: { ...prev[activeClient], skus: [{ id: f.get("sku"), name: f.get("name"), model: f.get("model"), upc: f.get("upc"), category: f.get("category"), map: Number(f.get("map")) || 0, msrp: Number(f.get("msrp")) || 0, current: Number(f.get("map")) || 0, listings: 0, violations: 0, status: "Active" }, ...prev[activeClient].skus] } }));
    showToast(`SKU "${f.get("sku")}" added. Terms will be generated on the next discovery run.`);
    setModals((m) => ({ ...m, product: false }));
  };

  const go = (v) => setView(v);
  const mainContent = useMemo(() => {
    const p = { clientName: client.name };
    switch (view) {
      case "overview": return <OverviewView {...p} onOpenViolation={(v) => setViolationId(v.id)} go={go} />;
      case "violations": return <ViolationsView {...p} onOpenViolation={(v) => setViolationId(v.id)} />;
      case "enforcement": return <EnforcementView {...p} />;
      case "sellers": return <SellersView {...p} />;
      case "product": return <ProductSummaryView {...p} onAddSkuClick={() => setModals((m) => ({ ...m, product: true }))} />;
      case "policies": return <MapPoliciesView {...p} onAddPromoClick={() => setModals((m) => ({ ...m, promo: true }))} />;
      case "mapping": return <MappingCenterView {...p} />;
      case "sources": return <SourcesTermsView {...p} />;
      case "rules": return <RulesView {...p} />;
      case "health": return <DataHealthView {...p} />;
      case "reports": return <ReportsView {...p} />;
      case "alerts": return <AlertsView {...p} />;
      case "settings": return <SettingsView {...p} />;
      case "users": return <UsersView {...p} />;
      case "audit": return <AuditLogView {...p} />;
      default: return null;
    }
  }, [view, client]);

  const toastLayer = (
    <div className="fixed bottom-20 right-5 z-[100] flex flex-col gap-2" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="bg-brand-charcoal text-brand-ivory px-4 py-3 rounded-lg shadow-xl text-xs flex items-center gap-2 max-w-sm">
          <span className={`w-1.5 h-1.5 rounded-full ${t.type === "info" ? "bg-blue-400" : "bg-emerald-400"}`} />
          <div>{t.message}</div>
        </div>
      ))}
    </div>
  );

  const wrap = (children) => (
    <ToastContext.Provider value={showToast}>
      <DataContext.Provider value={{ db, setDb }}>{children}{toastLayer}</DataContext.Provider>
    </ToastContext.Provider>
  );

  // ---------------- LOGIN (unchanged) ----------------
  if (screen === "login") {
    return wrap(
      <div className="flex items-center justify-center bg-brand-charcoal font-sans" style={{ minHeight: "100vh" }}>
        <div className="bg-[#221916] border border-white/10 rounded-xl p-8 w-96 max-w-[92vw] shadow-2xl">
          <div className="flex items-center gap-2.5 mb-6 justify-center">
            <img src={logo} alt="Mirethos" className="w-7 h-7 bg-white p-1 rounded-md" />
            <div><span className="text-white text-base font-bold tracking-wide">MIRETHOS</span><span className="text-[9px] text-[#A9998E] uppercase tracking-wider block -mt-1">MAP Intel Login</span></div>
          </div>
          <h3 className="text-base font-semibold text-white mb-1">Welcome Back</h3>
          <p className="text-xs text-[#A9998E] mb-5">Enter credentials to access strategic market intelligence.</p>
          <form onSubmit={(e) => { e.preventDefault(); setScreen("client-select"); }} className="space-y-4">
            <div><label className="block text-xs font-semibold text-[#A9998E] mb-1" htmlFor="login-email">Business Email</label><input id="login-email" type="email" defaultValue="operations@mirethos.com" className="w-full px-3 py-2 text-sm border border-[#A9998E]/40 rounded-lg bg-[#17110F] text-white" /></div>
            <div><label className="block text-xs font-semibold text-[#A9998E] mb-1" htmlFor="login-pass">Password</label><input id="login-pass" type="password" defaultValue="password1234" className="w-full px-3 py-2 text-sm border border-[#A9998E]/40 rounded-lg bg-[#17110F] text-white" /></div>
            <button type="submit" className="w-full py-2.5 bg-brand-copper hover:bg-brand-copper/90 text-white rounded-lg text-sm font-semibold cursor-pointer mt-2">Sign In</button>
          </form>
          <div className="border-t border-white/5 mt-6 pt-4 text-center text-[10px] text-[#A9998E] flex items-center justify-center gap-1.5"><Lock className="w-3.5 h-3.5" /> SSO and MFA supported for enterprise accounts</div>
        </div>
      </div>
    );
  }

  if (screen === "onboarding") return wrap(<OnboardingView onDone={() => setScreen("client-select")} />);

  // ---------------- CLIENT SELECT (+ new account) ----------------
  if (screen === "client-select") {
    return wrap(
      <div className="flex items-center justify-center bg-brand-ivory font-sans p-4" style={{ minHeight: "100vh" }}>
        <div className="max-w-2xl w-full">
          <div className="flex items-center gap-2.5 mb-8 justify-center">
            <img src={logo} alt="Mirethos" className="w-8 h-8 bg-white p-1 rounded-md border border-brand-beige" />
            <div><span className="text-brand-charcoal text-lg font-bold tracking-wide">MIRETHOS</span><span className="text-[10px] text-brand-taupe uppercase tracking-wider block -mt-1">MAP Intel</span></div>
          </div>
          <div className="bg-brand-white border border-brand-beige rounded-xl p-6 shadow-md">
            <div className="flex justify-between items-start mb-5 gap-3">
              <div><h2 className="text-base font-bold text-brand-charcoal mb-1">Select Account</h2><p className="text-xs text-brand-taupe">Choose a brand to open its MAP Intel workspace</p></div>
              <SecondaryButton onClick={() => setScreen("onboarding")}><Plus className="w-4 h-4" /> New account</SecondaryButton>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CLIENTS.map((c) => (
                <div key={c.name} className="bg-brand-white border border-brand-beige hover:border-brand-copper/50 rounded-xl p-4 transition-all cursor-pointer shadow-sm" onClick={() => { setActiveClient(c.name); setScreen("app"); setView("overview"); }}>
                  <div className="flex justify-between items-start mb-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${c.status === "Sandbox" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>{c.status}</span>
                    <ClientLogo name={c.name} className="w-10 h-10 rounded-lg border border-brand-beige shadow-sm" />
                  </div>
                  <div className="space-y-1 text-xs text-brand-taupe mb-4"><div>• SKUs configured: {c.skus}</div><div>• Sources subscribed: {c.merchants}</div></div>
                  <div className="text-xs font-semibold text-brand-copper">Open Workspace →</div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-center mt-6"><button className="text-xs text-brand-taupe hover:text-brand-charcoal font-semibold border border-brand-beige bg-brand-white rounded-lg px-3 py-1.5 cursor-pointer" onClick={() => setScreen("login")}>Back to Log In</button></div>
        </div>
      </div>
    );
  }

  // ---------------- WORKSPACE SHELL (unchanged layout) ----------------
  return wrap(
    <div className="flex h-screen bg-brand-ivory font-sans text-brand-charcoal">
      <div className="hidden md:flex w-60 bg-brand-sidebar text-brand-charcoal flex-col shrink-0 border-r border-brand-beige shadow-lg">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-brand-beige">
          <img src={logo} alt="Mirethos" className="w-6.5 h-6.5 bg-white p-1 rounded-md" />
          <div><span className="text-brand-charcoal text-sm font-bold tracking-wide block">MIRETHOS</span><span className="text-[9px] text-brand-taupe uppercase tracking-wider block -mt-0.5">MAP Intel</span></div>
        </div>

        <div className="px-3 py-3 border-b border-brand-beige relative">
          <button onClick={() => setClientOpen((o) => !o)} className="w-full flex items-center justify-between hover:bg-brand-beige rounded-lg px-2.5 py-2 text-sm cursor-pointer">
            <div className="flex items-center gap-2">
              <ClientLogo name={client.name} className="w-6 h-6 rounded-md border border-brand-beige shadow-sm p-0.5" />
              <div className="text-left"><div className="text-brand-charcoal text-sm font-semibold">{client.name}</div><div className="text-[10px] text-brand-taupe font-medium">{client.status}</div></div>
            </div>
            <ChevronDown className="w-4 h-4 text-brand-taupe" />
          </button>
          {clientOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-brand-white border border-brand-beige rounded-lg overflow-hidden z-10 shadow-xl">
              {CLIENTS.map((c) => (
                <button key={c.name} onClick={() => { setActiveClient(c.name); setClientOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-beige flex justify-between items-center cursor-pointer ${c.name === activeClient ? "text-brand-charcoal font-bold" : "text-brand-taupe"}`}>
                  <span className="flex items-center gap-2"><ClientLogo name={c.name} className="w-4 h-4 rounded-sm" />{c.name}</span>
                  <span className="text-[10px] text-brand-taupe">{c.skus} SKUs</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((n) => {
            if (n.group) return <div key={n.group} className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-taupe/80">{n.group}</div>;
            const Icon = n.icon;
            const active = view === n.id;
            const badge = n.id === "violations" ? openCount : n.id === "alerts" ? 3 : null;
            return (
              <button key={n.id} onClick={() => setView(n.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors border-l-2 cursor-pointer ${active ? "bg-brand-beige border-brand-copper text-brand-charcoal font-semibold" : "border-transparent text-brand-taupe hover:text-brand-charcoal hover:bg-brand-beige/50"}`}>
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{n.label}</span>
                {showTags && n.tag && <span className={`text-[8px] font-bold uppercase tracking-wide rounded px-1 py-px border ${n.tag === "new" ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-blue-700 border-blue-200 bg-blue-50"}`}>{n.tag === "new" ? "New" : "Upd"}</span>}
                {badge ? <span className="text-[9px] font-bold bg-brand-copper text-brand-white rounded-full px-1.5 py-0.5">{badge}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-2 border-t border-brand-beige">
          <label className="flex items-center gap-2 text-[10px] text-brand-taupe cursor-pointer"><input id="show-tags" type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />Show what changed vs current portal</label>
        </div>
        <div className="px-4 py-3 border-t border-brand-beige flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-brand-copper flex items-center justify-center text-xs text-brand-white font-bold">FD</div>
            <div className="text-[11px]"><div className="text-brand-charcoal font-bold">Fenil Dholaviya</div><div className="text-brand-taupe">Account Manager</div></div>
          </div>
          <button onClick={() => setScreen("login")} className="text-[10px] text-brand-copper hover:underline cursor-pointer">Exit</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-brand-ivory min-w-0">
        <div className="md:hidden flex items-center gap-2 mb-4">
          <img src={logo} alt="Mirethos" className="w-6 h-6 bg-white p-1 rounded-md" />
          <select id="mobile-nav" value={view} onChange={(e) => setView(e.target.value)} className={inputCls}>
            {NAV.filter((n) => n.id).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </div>
        {mainContent}
      </div>

      <ViolationDrawer violation={violation} onClose={() => setViolationId(null)} onUpdate={updateViolation} onOpenEvidence={(v) => setEvidenceFor(v)} />
      <EvidencePage violation={evidenceFor} onClose={() => setEvidenceFor(null)} />

      <button onClick={() => setIsDark(!isDark)} className="fixed bottom-6 right-6 p-3 bg-brand-charcoal text-brand-ivory rounded-full shadow-lg transition-colors z-40 cursor-pointer flex items-center justify-center" title="Toggle theme" aria-label="Toggle theme">
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <Modal open={modals.product} onClose={() => setModals((m) => ({ ...m, product: false }))} title="Add Monitored SKU">
        <div className="mb-4 p-3 bg-brand-ivory border border-brand-beige rounded-lg text-center">
          <p className="text-xs text-brand-taupe mb-2">Adding many SKUs? Import a CSV / Excel file with a dry-run preview.</p>
        </div>
        <form onSubmit={handleProductSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="SKU Code *"><input id="p-sku" name="sku" required placeholder="LG-011" className={inputCls} /></Field><Field label="Category"><input id="p-cat" name="category" defaultValue="Monitor" className={inputCls} /></Field></div>
          <Field label="Product Name *"><input id="p-name" name="name" required placeholder="LG UltraGear Curved Monitor" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Model / MPN *"><input id="p-model" name="model" required placeholder="34WP65C-B" className={inputCls} /></Field><Field label="UPC / EAN"><input id="p-upc" name="upc" placeholder="195174025802" className={inputCls} /></Field></div>
          <div className="grid grid-cols-3 gap-3"><Field label="MAP ($) *"><input id="p-map" name="map" type="number" step="0.01" required placeholder="449.00" className={inputCls} /></Field><Field label="MSRP ($)"><input id="p-msrp" name="msrp" type="number" step="0.01" placeholder="499.00" className={inputCls} /></Field><Field label="MAP from *"><input id="p-from" name="from" type="date" defaultValue="2026-09-23" className={inputCls} /></Field></div>
          <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={() => setModals((m) => ({ ...m, product: false }))}>Cancel</SecondaryButton><PrimaryButton type="submit">Add SKU</PrimaryButton></div>
        </form>
      </Modal>

      <Modal open={modals.promo} onClose={() => setModals((m) => ({ ...m, promo: false }))} title="New promotion window">
        <form onSubmit={(e) => { e.preventDefault(); setModals((m) => ({ ...m, promo: false })); showToast("Promotion window PW-09 scheduled."); }} className="space-y-4">
          <Field label="Products *"><input id="pw-scope" required placeholder="LG-001, LG-002 or Category: TV" className={inputCls} /></Field>
          <Field label="Applies to sellers"><select id="pw-sellers" className={inputCls}><option>All sellers</option><option>MAP Authorised only</option><option>Selected sellers…</option></select></Field>
          <div className="grid grid-cols-3 gap-3"><Field label="Promo MAP ($) *"><input id="pw-price" type="number" step="0.01" required placeholder="1399.00" className={inputCls} /></Field><Field label="Start *"><input id="pw-start" type="date" required defaultValue="2026-11-24" className={inputCls} /></Field><Field label="End *"><input id="pw-end" type="date" required defaultValue="2026-12-01" className={inputCls} /></Field></div>
          <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={() => setModals((m) => ({ ...m, promo: false }))}>Cancel</SecondaryButton><PrimaryButton type="submit">Create window</PrimaryButton></div>
        </form>
      </Modal>
    </div>
  );
}
