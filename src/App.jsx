import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Package, Shuffle, DollarSign, Store, AlertTriangle,
  Mail, FileText, Bell, Settings as SettingsIcon, Users, ClipboardList,
  ChevronDown, Scale, Lock, Moon, Sun, Radar, Loader2, Activity, PanelLeftClose, PanelLeftOpen,
  Eye, EyeOff, ShieldCheck, ArrowRight, Gavel, ListChecks, Plus, Gauge, Ticket as TicketIcon, Database
} from "lucide-react";
import lgLogo from "./assets/lg.png";
import appleLogo from "./assets/apple.png";
import samsungLogo from "./assets/samsung.png";
import philipsLogo from "./assets/philips.png";
import kawasakiLogo from "./assets/kawasaki.png";
import mirethosMark from "./assets/mirethos-mark.png";
import { api } from "./api/client.js";
import { WorkspaceContext } from "./workspace.js";
import { SourcesTermsView } from "./views/SourcesTermsView.jsx";
import { MapPoliciesView, ProductSummaryView } from "./views/CatalogViews.jsx";
import { MappingCenterView } from "./views/MappingCenterView.jsx";
import { SellersView } from "./views/SellersView.jsx";
import { DataHealthView } from "./views/DataHealthView.jsx";
import { ViolationsView } from "./views/ViolationsView.jsx";
import { OverviewView } from "./views/OverviewView.jsx";
import { RulesView } from "./views/RulesView.jsx";
import { ReportsView } from "./views/ReportsView.jsx";
import { AlertsView } from "./views/AlertsView.jsx";
import { EnforcementView } from "./views/EnforcementView.jsx";
import { AuditLogView, SettingsView, UsersView } from "./views/AdminViews.jsx";
import { NewAccountModal, OnboardingView } from "./views/OnboardingView.jsx";
import { PlatformScreen } from "./views/PlatformView.jsx";
import { MfaSignInScreen, SecurityModal } from "./views/MfaViews.jsx";
import { DataApiView } from "./views/DataApiView.jsx";

// ---------- Small building blocks ----------
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
      <div className={`flex items-center justify-center overflow-hidden bg-white ring-1 ring-black/5 ${className || "w-5 h-5 rounded-sm"}`}>
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
// Grouped as the work flows: watch, catalogue, collection, enforcement, administration.
const NAV = [
  // Only while the account is in Onboarding (P5 guided flow).
  { id: "onboarding", label: "Onboarding", icon: ListChecks, needs: "settings.read", group: "", onboardingOnly: true },
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "" },
  { id: "violations", label: "Violations", icon: AlertTriangle, needs: "violations.read", group: "Monitor" },
  { id: "alerts", label: "Alerts", icon: Bell, needs: "alerts.read", group: "Monitor" },
  { id: "reports", label: "Reports", icon: FileText, needs: "reports.read", group: "Monitor" },
  { id: "product", label: "Product Summary", icon: Package, group: "Catalogue" },
  { id: "pricing", label: "MAP Policies", icon: DollarSign, group: "Catalogue" },
  { id: "merchants", label: "Sellers", icon: Store, needs: "sellers.read", group: "Catalogue" },
  { id: "mapping", label: "Mapping Center", icon: Shuffle, needs: "mapping.read", group: "Collection" },
  { id: "sources", label: "Sources & Terms", icon: Radar, needs: "sources.read", group: "Collection" },
  { id: "health", label: "Data Health", icon: Activity, needs: "health.read", group: "Collection" },
  { id: "rules", label: "Rules", icon: Scale, needs: "rules.read", group: "Collection" },
  { id: "enforcement", label: "Enforcement", icon: Gavel, needs: "cases.read", group: "Enforcement" },
  { id: "settings", label: "Settings", icon: SettingsIcon, needs: "settings.read", group: "Admin" },
  { id: "users", label: "Users & Access", icon: Users, needs: "users.read", group: "Admin" },
  { id: "audit", label: "Audit Log", icon: ClipboardList, needs: "audit.read", group: "Admin" },
  { id: "data", label: "Data & API", icon: Database, needs: "account.read", group: "Admin" },
];

export const DataContext = React.createContext(null);

const EMPTY_WORKSPACE = { skus: [], violations: [], merchants: [], mappingStage: [], mappingInclude: [], mappingExclude: [], promotions: [] };
const EMPTY_SHARED = { emails: [], reports: [], alertRules: [], alertUnread: 0, users: [], audit: [], severityDist: [], trend: [] };
const DEFAULT_CHART_COLORS = { grid: "rgba(58, 38, 24, 0.10)", muted: "#6E6158", text: "#1C1714", card: "#FFFFFF", accent: "#AB5C36" };

// Each client's colour, tuned to read well as an accent: light = on a white page, dark = on espresso.
const BRAND_COLORS = {
  LG: { light: "#A50034", dark: "#F0587C" },
  Philips: { light: "#0B5ED7", dark: "#6EA8FE" },
  Kawasaki: { light: "#3B7A2A", dark: "#86C46E" },
  Citizen: { light: "#475569", dark: "#A3B1C6" },
  Apple: { light: "#3A3A3C", dark: "#C7C7CC" },
  Samsung: { light: "#1428A0", dark: "#7D93FF" },
};
const MIRETHOS_COLORS = { light: "#AB5C36", dark: "#DA9066" };

const initials = (name) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// Local calendar date as YYYY-MM-DD (en-CA formats dates that way).

// Sign-in: a brand panel (fixed espresso, the same in light and dark) beside the form on the theme's page colour.
const LOGIN_POINTS = [
  { icon: Radar, title: "Daily price checks", text: "Marketplace and retailer listings matched to your catalogue and re-checked every day." },
  { icon: ShieldCheck, title: "Evidence you can stand on", text: "Every price is saved with its page or API record, fingerprinted and locked." },
  { icon: Activity, title: "From detection to notice", text: "Spot below-MAP sellers, review the proof and act from one place." },
];

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, busy, slow, onForgot, providers = [] }) {
  const [showPw, setShowPw] = useState(false);
  const field = "w-full h-11 pl-10 pr-3 text-sm rounded-xl border border-brand-beige bg-brand-white text-brand-charcoal placeholder:text-brand-taupe/70 shadow-sm transition focus:outline-none focus:border-brand-copper focus:ring-4 focus:ring-brand-copper/15";
  return (
    // Before sign-in no brand is chosen: use Mirethos copper, not the default client's accent.
    <div className="min-h-screen flex bg-brand-ivory font-sans text-brand-charcoal" style={{ "--color-brand-copper": "#AB5C36", "--accent-coral": "#AB5C36" }}>
      <aside className="hidden lg:flex relative w-[46%] max-w-[640px] flex-col justify-between overflow-hidden p-12 text-[#FAF6EE]"
        style={{ background: "radial-gradient(110% 70% at 0% 0%, rgba(218,144,102,0.16) 0%, rgba(218,144,102,0) 55%), radial-gradient(90% 70% at 100% 100%, rgba(171,92,54,0.22) 0%, rgba(171,92,54,0) 60%), #17120F" }}>
        <div className="absolute inset-0 opacity-[0.045] pointer-events-none"
          style={{ backgroundImage: "linear-gradient(#FAF6EE 1px, transparent 1px), linear-gradient(90deg, #FAF6EE 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        <div className="relative flex items-center gap-3">
          <img src={mirethosMark} alt="" className="h-11 w-auto" />
          <div className="leading-none">
            <div className="wordmark text-lg">MIRETHOS</div>
            <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.24em] text-[#A7998D]">MAP Intelligence</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-4xl xl:text-[44px] leading-[1.1] font-semibold tracking-tight">
            Protect your price.<br /><span className="text-[#DA9066]">Prove every breach.</span>
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[#CBBFB4] max-w-md">
            Minimum Advertised Price monitoring and enforcement for brands that sell across marketplaces.
          </p>
          <div className="mt-10 space-y-5">
            {LOGIN_POINTS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[#DA9066]/10 ring-1 ring-[#DA9066]/25">
                  <Icon className="w-5 h-5 text-[#DA9066]" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-[13px] leading-snug text-[#A7998D] max-w-sm">{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-[#A7998D]">© {new Date().getFullYear()} Mirethos</div>
      </aside>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <img src={mirethosMark} alt="" className="h-9 w-auto" />
            <div>
              <div className="text-base font-semibold tracking-[0.22em] text-copper-700">MIRETHOS</div>
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

            <button type="submit" disabled={busy} style={{ background: "var(--copper-sheen)" }}
              className="group w-full h-11 rounded-xl text-white text-sm font-semibold shadow-[0_6px_18px_-8px_rgba(119,60,32,0.6)] hover:brightness-110 active:brightness-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-wait">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
            {slow && (
              <p className="text-xs text-brand-taupe text-center leading-relaxed">Waking up the server. The first sign-in after a quiet spell can take up to a minute.</p>
            )}
          </form>

          {providers.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-brand-taupe"><span className="flex-1 border-t border-brand-beige" />or<span className="flex-1 border-t border-brand-beige" /></div>
              <div className="mt-4 space-y-2.5">
                {providers.map((p) => (
                  <a key={p.id} href={api.ssoStartUrl(p.id)}
                    className="w-full h-11 rounded-xl border border-brand-beige bg-brand-white text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-surface-3 transition">
                    <ProviderMark id={p.id} /> Continue with {p.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 pt-6 border-t border-brand-beige flex items-center gap-2 text-xs text-brand-taupe">
            <ShieldCheck className="w-4 h-4 text-brand-copper" /> Encrypted connection · access is limited to invited users
          </div>
        </div>
      </main>
    </div>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toast-container fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className="bg-[#17120F] text-[#F3EDE6] border border-white/10 pl-3 pr-4 py-2.5 rounded-lg shadow-[var(--shadow-3)] text-[13px] flex items-center gap-2.5 animate-fade-in max-w-md">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.type === "info" ? "#DA9066" : "#6FBF8B" }} />
          <div style={{ whiteSpace: 'pre-line' }}>{t.message}</div>
        </div>
      ))}
    </div>
  );
}

/** Small provider marks for the sign-in buttons (plain shapes, no external images). */
function ProviderMark({ id }) {
  if (id === "microsoft") {
    return (
      <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
        <rect x="0" y="0" width="7.5" height="7.5" fill="#F25022" /><rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00" />
        <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF" /><rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900" />
      </svg>
    );
  }
  if (id === "google") {
    // Google's standard "G" (their sign-in branding asks for this mark on a white button).
    return (
      <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    );
  }
  return <ShieldCheck className="w-4 h-4" />;
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
    // Before a client is open (sign-in, client picker) the accent is Mirethos copper.
    const colors = screen !== 'app' ? MIRETHOS_COLORS : (accent?.light && accent) || BRAND_COLORS[activeClient] || MIRETHOS_COLORS;
    const accentHex = isDark ? colors.dark : colors.light;
    document.documentElement.style.setProperty('--accent-brand', accentHex);
    document.documentElement.style.setProperty('--accent-brand-dark', colors.dark || accentHex);
    document.documentElement.style.setProperty('--accent-contrast', textOn(accentHex));

    if (isDark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }

    // Chart colours follow light / dark mode and the client accent (same values as mirethos-theme.css).
    setChartColors({
      grid: isDark ? "rgba(252, 232, 210, 0.07)" : "rgba(58, 38, 24, 0.08)",
      muted: isDark ? "#A2948A" : "#6E6158",
      text: isDark ? "#F3EDE6" : "#1C1714",
      card: isDark ? "#1A1411" : "#FFFFFF",
      accent: (isDark ? colors.dark : colors.light) || DEFAULT_CHART_COLORS.accent,
    });
  }, [isDark, activeClient, clients, screen]);
  
  const [view, setView] = useState("overview");
  const [clientOpen, setClientOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  // Sidebar can shrink to an icon rail so wide screens (e.g. Product Summary) get the full width.
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem("navCollapsed") === "1"; } catch { return false; } });
  const toggleNav = () => setNavCollapsed((c) => { try { localStorage.setItem("navCollapsed", c ? "0" : "1"); } catch { /* storage unavailable */ } return !c; });

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
  const actions = useMemo(() => api.actionsFor(currentUser, client), [currentUser, client]);
  // Open violations for the sidebar badge, refreshed when the screen changes.
  const [openViolations, setOpenViolations] = useState(0);
  const canViolations = actions.includes("violations.read");
  useEffect(() => {
    if (screen !== 'app' || !canViolations || !client.id && !api.isMock) return;
    let live = true;
    api.violations(client, { active: true, limit: 1 }).then((r) => { if (live) setOpenViolations(r?.total ?? 0); }).catch(() => {});
    return () => { live = false; };
  }, [screen, client, canViolations, view]);
  // Unread alerts for the sidebar badge (the Alerts screen updates it when alerts are read).
  const [alertUnread, setAlertUnread] = useState(0);
  const canAlerts = actions.includes("alerts.read");
  useEffect(() => {
    if (screen !== 'app' || !canAlerts || !client.id && !api.isMock) return;
    let live = true;
    api.alertEvents(client, { unread: true, limit: 1 }).then((r) => { if (live) setAlertUnread(r?.unread ?? 0); }).catch(() => {});
    return () => { live = false; };
  }, [screen, client, canAlerts, view]);
  const navBadges = { violations: openViolations, alerts: alertUnread };
  const nav = useMemo(
    () => NAV.filter((n) => (!n.needs || actions.includes(n.needs)) && (!n.onboardingOnly || client.status === "Onboarding")),
    [actions, client.status],
  );
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


  // Wake the API while the user is still typing (the free host sleeps when idle).
  useEffect(() => { api.wake(); }, []);

  // P5 SSO: the providers to offer, and the return from a provider (?sso=<code> or ?sso_error=...).
  const [ssoProviders, setSsoProviders] = useState([]);
  useEffect(() => { api.ssoProviders().then(setSsoProviders); }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get("sso");
    const error = q.get("sso_error");
    if (!code && !error) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (error) {
      showToast(error, "info", 8000);
      return;
    }
    (async () => {
      try {
        const r = await api.ssoExchange(code);
        if (r?.mfa) {
          setMfaStep(r);
          setScreen('mfa');
          return;
        }
        await enterPortal();
        showToast("Signed in.", "success");
      } catch (err) {
        showToast(err.message || "Sign-in failed.", "info");
      }
    })();
    // Runs once, on the page load that comes back from the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const r = await api.login(loginEmail, loginPassword);
      if (r?.mfa) {
        setMfaStep(r);
        setScreen('mfa');
        return;
      }
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
    const c = clients.find((x) => x.name === clientName);
    setActiveClient(clientName);
    setScreen('app');
    setView(c?.status === "Onboarding" ? 'onboarding' : 'overview');
    showToast(`Opened ${clientName}.`, "success");
  };

  const attemptToast = async (fn) => {
    try { return await fn(); } catch (err) { showToast(err.message || "Something went wrong.", "info"); return undefined; }
  };

  // After an account is created or goes live: reload the accounts and the user's roles in them.
  const refreshAccounts = async () => {
    const [user, list] = await Promise.all([api.me(), api.listClients()]);
    const missing = list.filter((c) => !db[c.name]);
    const workspaces = await Promise.all(missing.map((c) => api.loadWorkspace(c)));
    setDb((prev) => ({ ...prev, ...Object.fromEntries(missing.map((c, i) => [c.name, workspaces[i]])) }));
    setClients(list);
    setCurrentUser(user);
    return list;
  };

  // Stable for the memoised screen list: always calls the latest refreshAccounts.
  const refreshOnLive = React.useRef(null);
  useEffect(() => { refreshOnLive.current = () => attemptToast(refreshAccounts); });

  const [newAccountOpen, setNewAccountOpen] = useState(false);
  // P5 MFA: the second sign-in step, and the Security dialog.
  const [mfaStep, setMfaStep] = useState(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const security = securityOpen && (
    <SecurityModal onClose={() => setSecurityOpen(false)} showToast={showToast}
      onChanged={async () => setCurrentUser(await api.me())} />
  );
  const [platformTab, setPlatformTab] = useState("tickets");
  const handleAccountCreated = async (created) => {
    setNewAccountOpen(false);
    const list = await attemptToast(refreshAccounts);
    const c = list?.find((x) => x.id === created.id);
    if (!c) return;
    setActiveClient(c.name);
    setScreen('app');
    setView('onboarding');
    showToast(`${c.name} created. Work through the steps, then go live.`, "success");
  };

  const mainContent = useMemo(() => {
    switch (currentView) {
      case "onboarding": return <OnboardingView key={client.id} onLive={() => refreshOnLive.current?.()} />;
      case "overview": return <OverviewView />;
      case "product": return <ProductSummaryView />;
      case "mapping": return <MappingCenterView />;
      case "sources": return <SourcesTermsView skus={workspace.skus} />;
      case "pricing": return <MapPoliciesView />;
      case "merchants": return <SellersView />;
      case "health": return <DataHealthView />;
      case "violations": return <ViolationsView />;
      case "enforcement": return <EnforcementView />;
      case "reports": return <ReportsView />;
      case "rules": return <RulesView />;
      case "alerts": return <AlertsView onUnreadChange={setAlertUnread} />;
      case "settings": return <SettingsView />;
      case "users": return <UsersView />;
      case "audit": return <AuditLogView />;
      case "data": return <DataApiView />;
      default: return null;
    }
  }, [currentView, workspace.skus, client.id]);

  // --------------------------------------------------------------------------
  // RENDER: WELCOME LOGIN
  // --------------------------------------------------------------------------
  if (screen === 'invite') {
    return (
      <>
      <InviteAcceptScreen
        inviteToken={inviteToken}
        onAccepted={async (r) => {
          window.history.replaceState(null, '', window.location.pathname);
          if (r?.mfa) {
            setMfaStep(r);
            setScreen('mfa');
            return;
          }
          await enterPortal();
          showToast("Welcome! Your account is ready.", "success");
        }}
        onCancel={() => { window.history.replaceState(null, '', window.location.pathname); setScreen('login'); }}
        showToast={showToast}
      />
      <Toasts toasts={toasts} />
      </>
    );
  }

  if (screen === 'mfa' && mfaStep) {
    return (
      <>
        <MfaSignInScreen step={mfaStep} showToast={showToast}
          onSignedIn={async () => { await enterPortal(); setMfaStep(null); showToast("Signed in.", "success"); }}
          onCancel={() => { setMfaStep(null); setScreen('login'); }} />
        <Toasts toasts={toasts} />
      </>
    );
  }

  if (screen === 'login') {
    return (
      <>
        <LoginScreen
          email={loginEmail} setEmail={setLoginEmail}
          password={loginPassword} setPassword={setLoginPassword}
          onSubmit={handleLoginSubmit} busy={isLoggingIn} slow={slowLogin}
          onForgot={() => showToast("Recovery portal loaded.", "info")}
          providers={ssoProviders}
        />
        <Toasts toasts={toasts} />
      </>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: CLIENT SELECTION
  // --------------------------------------------------------------------------
  if (screen === 'platform') {
    return (
      <>
        <PlatformScreen tab={platformTab} onTab={setPlatformTab} onBack={() => setScreen('client-select')} accounts={clients} showToast={showToast} />
        <Toasts toasts={toasts} />
      </>
    );
  }

  if (screen === 'client-select') {
    const firstName = (currentUser?.name || "").split(" ")[0];
    return (
      <div className="min-h-screen bg-brand-ivory font-sans text-brand-charcoal flex flex-col">
        <header className="h-16 px-8 flex items-center justify-between bg-rail border-b border-rail-line">
          <div className="flex items-center gap-3">
            <img src={mirethosMark} alt="" className="h-8 w-auto" />
            <div className="leading-none">
              <div className="wordmark text-[15px]">MIRETHOS</div>
              <div className="mt-1 text-[9.5px] uppercase tracking-[0.22em] text-rail-ink-2">MAP Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {currentUser?.role === "admin" && (
              <>
                <button className="inline-flex items-center gap-1.5 text-[13px] text-rail-ink-2 hover:text-rail-ink cursor-pointer" onClick={() => { setPlatformTab("tickets"); setScreen('platform'); }}>
                  <TicketIcon className="w-4 h-4" /> Tickets
                </button>
                <button className="inline-flex items-center gap-1.5 text-[13px] text-rail-ink-2 hover:text-rail-ink cursor-pointer" onClick={() => { setPlatformTab("budget"); setScreen('platform'); }}>
                  <Gauge className="w-4 h-4" /> Crawl budget
                </button>
              </>
            )}
            {!api.isMock && (
              <button className="inline-flex items-center gap-1.5 text-[13px] text-rail-ink-2 hover:text-rail-ink cursor-pointer" onClick={() => setSecurityOpen(true)}>
                <ShieldCheck className="w-4 h-4" /> Security
              </button>
            )}
            <button className="text-[13px] text-rail-ink-2 hover:text-rail-ink cursor-pointer" onClick={() => setScreen('login')}>Sign out</button>
          </div>
        </header>
        <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-14">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-copper-500">Workspaces</div>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">{firstName ? `Welcome back, ${firstName}.` : "Welcome back."}</h1>
          <p className="mt-1.5 text-sm text-brand-taupe">Choose a brand to open its MAP workspace.</p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {clients.map((c) => {
              const tone = (c.accent?.light && c.accent) || BRAND_COLORS[c.name] || MIRETHOS_COLORS;
              return (
                <button key={c.name} onClick={() => handleSelectClient(c.name)}
                  className="group text-left bg-brand-white border border-brand-beige rounded-xl p-5 shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] hover:border-line-strong transition cursor-pointer relative overflow-hidden">
                  <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: tone.light }} />
                  <div className="flex items-center gap-3.5">
                    <ClientLogo name={c.name} className="w-11 h-11 rounded-lg border border-brand-beige" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold">{c.name}</div>
                      <div className="text-xs text-brand-taupe mt-0.5">{c.status === "Sandbox" ? "Sandbox workspace" : c.status === "Onboarding" ? "Onboarding: set-up in progress" : "Live workspace"}</div>
                      {currentUser?.accounts?.find((a) => a.id === c.id)?.mfaRequired && !currentUser?.mfa?.session && (
                        <div className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Needs multi-factor sign-in: turn it on under Security, then sign in again</div>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-brand-taupe transition group-hover:translate-x-0.5 group-hover:text-brand-charcoal" />
                  </div>
                  <div className="mt-5 pt-4 border-t border-brand-beige grid grid-cols-2 gap-3">
                    <div><div className="text-[10.5px] uppercase tracking-[0.06em] text-brand-taupe">SKUs</div><div className="text-lg font-semibold tabular-nums mt-0.5">{c.skus}</div></div>
                    <div><div className="text-[10.5px] uppercase tracking-[0.06em] text-brand-taupe">Storefronts</div><div className="text-lg font-semibold tabular-nums mt-0.5">{c.merchants}</div></div>
                  </div>
                </button>
              );
            })}
            {currentUser?.role === "admin" && (
              <button onClick={() => setNewAccountOpen(true)}
                className="text-left border border-dashed border-line-strong rounded-xl p-5 hover:bg-brand-white hover:border-brand-copper transition cursor-pointer flex items-center gap-3.5 min-h-[150px]">
                <span className="w-11 h-11 rounded-lg border border-brand-beige bg-brand-white inline-flex items-center justify-center"><Plus className="w-5 h-5 text-brand-taupe" /></span>
                <span>
                  <span className="block text-[15px] font-semibold">New account</span>
                  <span className="block text-xs text-brand-taupe mt-0.5">Set up a brand through the guided flow</span>
                </span>
              </button>
            )}
          </div>
        </main>
        {security}
        <NewAccountModal open={newAccountOpen} onClose={() => setNewAccountOpen(false)} onCreated={handleAccountCreated} showToast={showToast} />
        <Toasts toasts={toasts} />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: WORKSPACE PORTAL SHELL
  // --------------------------------------------------------------------------
  const groups = [...new Set(nav.map((n) => n.group))];
  const current = nav.find((n) => n.id === currentView);
  const userName = currentUser?.name || "Fenil Dholaviya";
  return (
    <DataContext.Provider value={{ db, setDb, shared, chartColors }}>
    <WorkspaceContext.Provider value={workspaceCtx}>
      <div className="flex h-screen bg-brand-ivory font-sans text-brand-charcoal">

      {/* Sidebar: Mirethos espresso in both themes */}
      <aside className={`rail ${navCollapsed ? "w-[60px]" : "w-[248px]"} bg-rail text-rail-ink flex flex-col shrink-0 border-r border-rail-line transition-[width] duration-200`}>
        <div className={`h-16 flex items-center gap-2.5 border-b border-rail-line ${navCollapsed ? "justify-center px-2" : "px-5"}`}>
          <img src={mirethosMark} alt="Mirethos" className="h-7 w-auto shrink-0" />
          {!navCollapsed && (
            <div className="leading-none flex-1 min-w-0">
              <div className="wordmark text-[13.5px]">MIRETHOS</div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.22em] text-rail-ink-2">MAP Intelligence</div>
            </div>
          )}
        </div>

        {/* Workspace switcher */}
        <div className={`${navCollapsed ? "px-2" : "px-3"} pt-3 pb-2 relative`}>
          <button onClick={() => setClientOpen((o) => !o)} title={navCollapsed ? client.name : undefined}
            className={`w-full flex items-center gap-2.5 rounded-lg bg-rail-2 border border-rail-line hover:border-white/15 py-2 cursor-pointer transition ${navCollapsed ? "justify-center px-1" : "px-2.5"}`}>
            <ClientLogo name={client.name} className="w-7 h-7 rounded-md" />
            {!navCollapsed && (
              <>
                <div className="text-left flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-rail-ink truncate">{client.name}</div>
                  <div className="text-[10.5px] text-rail-ink-2">{client.status} workspace</div>
                </div>
                <ChevronDown className={`w-4 h-4 text-rail-ink-2 transition ${clientOpen ? "rotate-180" : ""}`} />
              </>
            )}
          </button>
          {clientOpen && (
            <div className={`absolute ${navCollapsed ? "left-2 w-56" : "left-3 right-3"} top-full mt-1 bg-rail-2 border border-rail-line rounded-lg overflow-hidden z-20 shadow-[var(--shadow-3)] py-1`}>
              {clients.map((c) => (
                <button key={c.name} onClick={() => { setActiveClient(c.name); setClientOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[13px] flex justify-between items-center cursor-pointer hover:bg-white/5 ${c.name === activeClient ? "text-rail-ink" : "text-rail-ink-2"}`}>
                  <span className="flex items-center gap-2.5"><ClientLogo name={c.name} className="w-5 h-5 rounded" />{c.name}</span>
                  <span className="text-[10.5px] tabular-nums">{c.skus} SKUs</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((g) => (
            <div key={g || "home"} className="mt-2.5 first:mt-1">
              {g && !navCollapsed && <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-rail-ink-2/70">{g}</div>}
              {g && navCollapsed && <div className="mx-3 mb-2 border-t border-rail-line" />}
              {nav.filter((n) => n.group === g).map((n) => {
                const Icon = n.icon;
                const active = currentView === n.id;
                return (
                  <button key={n.id} onClick={() => setView(n.id)} title={navCollapsed ? n.label : undefined}
                    className={`relative w-full flex items-center gap-3 h-8 rounded-md text-[13px] transition-colors cursor-pointer ${navCollapsed ? "justify-center px-0" : "px-3"} ${
                      active ? "bg-white/[0.07] text-rail-ink font-medium" : "text-rail-ink-2 hover:text-rail-ink hover:bg-white/[0.04]"}`}>
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-rail-accent" />}
                    <Icon className={`w-4 h-4 shrink-0 ${active ? "text-rail-accent" : ""}`} strokeWidth={active ? 2 : 1.75} />
                    {!navCollapsed && <span className="flex-1 text-left truncate">{n.label}</span>}
                    {navBadges[n.id] ? (
                      <span className={`${navCollapsed ? "absolute top-1 right-1.5 w-1.5 h-1.5 p-0" : "min-w-5 h-5 px-1.5"} tabular-nums text-[10.5px] font-semibold rounded-full inline-flex items-center justify-center bg-rail-accent text-[#17120F]`}>
                        {navCollapsed ? "" : navBadges[n.id]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`border-t border-rail-line p-2 flex ${navCollapsed ? "flex-col items-center gap-1" : "items-center"}`}>
          <button onClick={toggleNav} title={navCollapsed ? "Expand menu" : "Collapse menu"} className="text-rail-ink-2 hover:text-rail-ink hover:bg-white/5 rounded-md p-2 cursor-pointer">
            {navCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          {!navCollapsed && <span className="text-[10.5px] text-rail-ink-2/60 ml-1">© {new Date().getFullYear()} Mirethos</span>}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 flex items-center justify-between gap-4 px-8 border-b border-brand-beige bg-brand-white">
          <div className="flex items-center gap-2 text-[13px] min-w-0">
            <span className="text-brand-taupe">{client.name}</span>
            <span className="text-line-strong">/</span>
            {current?.group && <><span className="text-brand-taupe">{current.group}</span><span className="text-line-strong">/</span></>}
            <span className="font-medium text-brand-charcoal truncate">{current?.label}</span>
            <span className="ml-2 inline-flex items-center gap-1.5 h-5 px-1.5 rounded-[5px] text-[10.5px] font-medium border border-brand-beige text-brand-taupe">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />{client.status}
            </span>
          </div>
          <div className="flex items-center gap-1.5 relative">
            <button onClick={() => setIsDark(!isDark)} title={isDark ? "Light theme" : "Dark theme"}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-brand-taupe hover:text-brand-charcoal hover:bg-surface-3 cursor-pointer">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => setUserOpen((o) => !o)} className="flex items-center gap-2.5 pl-1.5 pr-2 h-9 rounded-lg hover:bg-surface-3 cursor-pointer">
              <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold text-[#FBF8F4]" style={{ background: "var(--copper-sheen)" }}>{initials(userName)}</span>
              <span className="text-left leading-tight hidden md:block">
                <span className="block text-[12.5px] font-medium">{userName}</span>
                <span className="block text-[11px] text-brand-taupe">{accountRole ?? (currentUser?.role === "member" ? "Member" : "Administrator")}</span>
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-brand-taupe" />
            </button>
            {userOpen && (
              <div className="absolute right-0 top-11 w-52 bg-brand-white border border-brand-beige rounded-lg shadow-[var(--shadow-3)] py-1 z-30 animate-fade-in">
                <div className="px-3 py-2 border-b border-brand-beige">
                  <div className="text-[12.5px] font-medium truncate">{currentUser?.email || userName}</div>
                </div>
                <button onClick={() => { setUserOpen(false); setScreen('client-select'); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-3 cursor-pointer">Switch workspace</button>
                {!api.isMock && <button onClick={() => { setUserOpen(false); setSecurityOpen(true); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-3 cursor-pointer">Security</button>}
                <button onClick={() => { setUserOpen(false); handleLogout(); }} className="w-full text-left px-3 py-2 text-[13px] text-red-700 hover:bg-surface-3 cursor-pointer">Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-7 max-w-[1600px] mx-auto">{mainContent}</div>
        </main>
      </div>

      {security}
      {/* Toasts */}
      <Toasts toasts={toasts} />

    </div>
    </WorkspaceContext.Provider>
    </DataContext.Provider>
  );
}

