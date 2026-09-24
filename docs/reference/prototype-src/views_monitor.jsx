import React, { useState } from "react";
import {
  ExternalLink, AlertTriangle, LinkIcon, Copy, Fingerprint, Camera, Clock, Gavel, Send, Ban, CircleCheck,
  ShieldCheck, Lock, Store, Mail, Plus, Activity
} from "./icons";
import {
  DataContext, useToast, Pill, KPI, Card, PageHeader, PrimaryButton, SecondaryButton, SearchBox, MerchantLogo,
  ClientLogo, Table, Td, Tabs, Drawer, Modal, Field, inputCls, KV, Note, Donut, LineChart, Legend, Bar, formatUSD
} from "./ui";
import logo from "./assets/favicon.ico";
import {
  SEVERITY_BG, STATUS_BG, CLASS_BG, SEVERITY_DIST, TREND, PRICE_HISTORY, EMAILS, SOURCES
} from "./data";

// ============ OVERVIEW ============
export function OverviewView({ onOpenViolation, clientName, go }) {
  const { db } = React.useContext(DataContext);
  const { skus, violations, sellers } = db[clientName];
  const top = [...sellers].filter((s) => s.violations > 0).sort((a, b) => b.violations - a.violations);
  const maxV = Math.max(...top.map((m) => m.violations), 1);
  const open = violations.filter((v) => ["Open", "Needs review", "Under notice"].includes(v.status));
  const degraded = SOURCES.filter((s) => s.subscribed && s.health !== "Healthy");

  return (
    <div>
      <PageHeader title={
        <div className="flex items-center gap-3">
          <ClientLogo name={clientName} className="w-8 h-8 rounded-lg shadow-sm border border-brand-beige p-1" />
          <span>Dashboard — {clientName} (Sandbox)</span>
        </div>
      } subtitle="Sep 17 – Sep 23, 2026 · MAP in force as of each observation date" />

      {degraded.length > 0 && (
        <button onClick={() => go("health")} className="w-full text-left mb-4 flex items-center gap-2 text-xs rounded-lg px-3 py-2 border bg-amber-50 text-amber-800 border-amber-200 cursor-pointer">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><b>Data quality:</b> {degraded.map((d) => `${d.name} (${d.health.toLowerCase()} — ${d.error})`).join(", ")}. Counts for these sources may be understated. View data health →</span>
        </button>
      )}

      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="MAP Compliance" value="94.2%" sub="↑ 2.4% vs last 7 days" subTone="text-emerald-700 font-semibold" />
        <KPI label="Open Violations" value={open.length} sub="+4 since yesterday" subTone="text-red-600 font-semibold" />
        <KPI label="Unauthorised Sellers" value={sellers.filter((s) => s.classification === "Unauthorised").length} sub="1 new this week" subTone="text-red-600 font-semibold" />
        <KPI label="SKUs Monitored" value={skus.length} sub={`${skus.reduce((a, s) => a + s.listings, 0)} included listings`} />
        <KPI label="Median Time to Compliance" value="3.9d" sub="↓ 0.8d vs last month" subTone="text-emerald-700 font-semibold" />
        <KPI label="Coverage (last cycle)" value="91%" sub="2 sources below SLA" subTone="text-amber-700 font-semibold" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Card title="Violations by severity (last 30 days)">
          <div className="flex items-center justify-center"><Donut data={SEVERITY_DIST} /></div>
          <Legend items={SEVERITY_DIST.map((d) => ({ ...d, name: `${d.name} (${d.value})` }))} />
          <div className="text-[11px] text-brand-taupe text-center mt-2">Severity by depth: Minor &lt;5% · Standard 5–15% · Severe &gt;15%</div>
        </Card>
        <Card title="Violations over time — unauthorised vs authorised sellers" className="md:col-span-2">
          <LineChart rows={TREND} xKey="day" series={[{ key: "unauth", color: "#dc2626" }, { key: "auth", color: "#A65E44" }]} />
          <div className="flex flex-wrap gap-4 justify-center text-xs text-brand-taupe">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-600" />Unauthorised</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#A65E44" }} />MAP Authorised</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-amber-200" />Degraded collection (not a clean line)</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Recent severe & standard violations" className="md:col-span-2" action={<button onClick={() => go("violations")} className="text-xs text-brand-copper hover:underline font-semibold cursor-pointer">View all violations</button>}>
          <Table columns={["SKU / Product", "Seller", "MAP", "Advertised", "Gap", "Severity"]}>
            {violations.filter((v) => v.status === "Open").slice(0, 4).map((v) => (
              <tr key={v.id} onClick={() => onOpenViolation(v)} className="hover:bg-brand-beige/20 cursor-pointer">
                <Td><div className="font-semibold">{v.product}</div><div className="text-xs text-brand-taupe">{v.sku}</div></Td>
                <Td><MerchantLogo name={v.merchant} /></Td>
                <Td>{formatUSD(v.map)}</Td>
                <Td>{formatUSD(v.advertised)}</Td>
                <Td className="text-red-600 font-bold">{v.gap}%</Td>
                <Td><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Top violating sellers" action={<button onClick={() => go("sellers")} className="text-xs text-brand-copper hover:underline font-semibold cursor-pointer">All sellers</button>}>
          <div className="space-y-3">
            {top.map((m) => (
              <div key={m.name}>
                <div className="flex justify-between text-xs text-brand-charcoal mb-1 font-medium gap-2">
                  <span className="flex items-center gap-1.5"><MerchantLogo name={`${m.name} (${m.source})`} /></span>
                  <span className="tabular-nums">{m.violations}</span>
                </div>
                <Bar value={m.violations} max={maxV} />
                <div className="text-[10px] text-brand-taupe mt-0.5">{m.classification} · risk {m.risk}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============ VIOLATIONS ============
const V_TABS = ["Open", "Needs review", "Under notice", "Authorised promo", "Resolved", "Dismissed"];

export function ViolationsView({ onOpenViolation, clientName }) {
  const { db } = React.useContext(DataContext);
  const violations = db[clientName].violations;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const filtered = violations
    .filter((v) => tab === "all" || v.status === tab)
    .filter((v) => (v.product + v.merchant + v.id + v.sku).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title={`Violations — ${clientName} (Sandbox)`} subtitle="Each row is a rule verdict on one observation, judged against the MAP in force on that date." />
      <Card>
        <Tabs value={tab} onChange={setTab}
          tabs={[{ id: "all", label: "All", count: violations.length }, ...V_TABS.map((t) => ({ id: t, label: t, count: violations.filter((v) => v.status === t).length }))]} />
        <div className="flex justify-between mb-4 gap-2 flex-wrap">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, seller, violation ID..." />
          <div className="flex gap-2">
            <SecondaryButton><Gavel className="w-4 h-4" /> Open case from selected</SecondaryButton>
          </div>
        </div>
        <Table columns={["Violation ID", "SKU / Product", "Seller", "Seller class", "MAP", "Advertised", "Gap", "First seen", "Severity", "Status", "Evidence"]}>
          {filtered.map((v) => (
            <tr key={v.id} onClick={() => onOpenViolation(v)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold text-brand-copper">{v.id}</Td>
              <Td><div className="font-semibold">{v.product}</div><div className="text-xs text-brand-taupe">{v.sku}</div></Td>
              <Td><MerchantLogo name={v.merchant} /></Td>
              <Td><Pill text={v.sellerClass} tone={CLASS_BG[v.sellerClass]} /></Td>
              <Td>{formatUSD(v.map)}</Td>
              <Td>{formatUSD(v.advertised)}</Td>
              <Td className="text-red-600 font-bold">{v.gap}%</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{v.firstSeen}</Td>
              <Td><Pill text={v.severity} tone={SEVERITY_BG[v.severity]} /></Td>
              <Td><Pill text={v.status} tone={STATUS_BG[v.status]} /></Td>
              <Td><LinkIcon className="w-4 h-4 text-brand-copper" /></Td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">Showing {filtered.length} of {violations.length} violations</div>
      </Card>
    </div>
  );
}

export function ViolationDrawer({ violation, onClose, onUpdate, onOpenEvidence }) {
  const showToast = useToast();
  const [dismissOpen, setDismissOpen] = useState(false);
  if (!violation) return null;
  const v = violation;
  const permalink = `https://evidence.mirethos.com/v/${v.id.toLowerCase()}?t=7f3a…e91`;
  const copy = () => {
    navigator.clipboard?.writeText(permalink).then(() => showToast("Evidence link copied (expires in 30 days).")).catch(() => showToast("Copy blocked — select the link text instead.", "info"));
  };
  return (
    <Drawer open onClose={onClose} eyebrow="Violation profile" title={`Violation Detail — ${v.id}`}
      footer={<>
        <SecondaryButton onClick={() => setDismissOpen(true)}><Ban className="w-4 h-4" /> Dismiss with reason</SecondaryButton>
        {v.status === "Needs review" && <SecondaryButton onClick={() => { onUpdate(v.id, { status: "Open" }); showToast(`${v.id} confirmed as a violation.`); }}><CircleCheck className="w-4 h-4" /> Confirm violation</SecondaryButton>}
        <PrimaryButton onClick={() => { onUpdate(v.id, { status: "Under notice", caseId: v.caseId || "CASE-0043" }); showToast(v.caseId ? `Added to ${v.caseId}.` : "Opened CASE-0043 for this seller."); }}>
          <Gavel className="w-4 h-4" /> {v.caseId ? `View ${v.caseId}` : "Open enforcement case"}
        </PrimaryButton>
      </>}>
      {v.status === "Needs review" && <div className="mb-4"><Note tone="bg-amber-50 text-amber-800 border-amber-200"><b>Needs review:</b> {v.reviewReason}</Note></div>}
      {v.status === "Dismissed" && <div className="mb-4"><Note tone="bg-slate-50 text-slate-700 border-slate-200"><b>Dismissed:</b> {v.dismissReason}</Note></div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-3">Violation Information</h4>
          <div className="space-y-2.5 text-xs">
            <KV k="SKU / Product" v={`${v.sku} — ${v.product}`} />
            <KV k="Seller" v={<MerchantLogo name={v.merchant} />} />
            <KV k="Seller class (at capture)" v={<Pill text={v.sellerClass} tone={CLASS_BG[v.sellerClass]} />} />
            <KV k="MAP in force" v={formatUSD(v.map)} />
            <KV k="MAP version" v={v.mapV} />
            <KV k="Advertised price" v={<span className="text-red-600">{formatUSD(v.advertised)}</span>} />
            <KV k="Gap" v={<span className="text-red-600">{v.gap}% ({formatUSD(v.advertised - v.map)})</span>} />
            <KV k="First seen" v={v.firstSeen} />
            <KV k="Duration" v={v.duration} />
            <KV k="Rule applied" v={v.ruleV} />
            <KV k="Severity" v={<Pill text={v.severity} tone={SEVERITY_BG[v.severity]} />} />
          </div>
        </div>

        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <div className="flex justify-between items-center border-b border-brand-beige pb-1.5 mb-3">
            <h4 className="text-sm font-semibold text-brand-charcoal">Evidence bundle</h4>
            <span className="text-[10px] inline-flex items-center gap-1 text-emerald-700"><Lock className="w-3 h-3" />Frozen</span>
          </div>
          <div className="bg-brand-charcoal rounded-lg h-40 flex flex-col items-center justify-center p-4 text-center relative overflow-hidden">
            <div className="absolute top-2 left-2 text-[9px] text-brand-ivory/70 font-mono inline-flex items-center gap-1"><Camera className="w-3 h-3" />Sep 23, 2026 04:10:22 UTC</div>
            <div className="text-brand-ivory font-bold text-xs truncate max-w-[200px]">{v.product}</div>
            <div className="text-2xl font-black text-red-500 my-2">{formatUSD(v.advertised)}</div>
            <div className="text-[10px] text-brand-ivory/70 uppercase tracking-wide">Sold by: {v.merchant}</div>
          </div>
          <div className="space-y-1.5 text-[11px] mt-3">
            <KV k="Captures" v="Screenshot · HTML · PDF" />
            <KV k="SHA-256" v={<span className="font-mono">9c1e…4ab2</span>} />
            <KV k="Policy doc" v="LG MAP Policy 2026.2" />
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            <button onClick={() => onOpenEvidence(v)} className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer font-semibold"><ShieldCheck className="w-3.5 h-3.5" />Preview shareable evidence page</button>
            <button onClick={copy} className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer"><Copy className="w-3.5 h-3.5" />Copy expiring link</button>
            <a href="#" onClick={(e) => e.preventDefault()} className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1">Open live listing <ExternalLink className="w-3 h-3" /></a>
          </div>
        </div>

        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-3">Timeline</h4>
          <div className="space-y-3.5 text-xs relative pl-3.5 border-l border-brand-beige">
            {[
              ["Observed below MAP", "Collector captured price, seller and snapshot.", "Sep 23, 04:10 UTC", true],
              ["Rule verdict", `${v.ruleV}: ${v.severity.toLowerCase()} violation.`, "Sep 23, 04:10 UTC", true],
              ["Evidence frozen", "Bundle hashed and locked.", "Sep 23, 04:11 UTC", true],
              ["Case & notice", v.caseId ? `${v.caseId} — notice sent.` : "Not yet in a case.", v.caseId ? "Sep 23, 10:15 UTC" : "", !!v.caseId],
              ["Re-check", "Resolved only when a new observation shows a compliant price.", "", v.status === "Resolved"],
            ].map(([t, d, ts, done]) => (
              <div className="relative" key={t}>
                <span className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ${done ? "bg-brand-copper" : "bg-brand-beige"}`} />
                <div className="font-bold text-brand-charcoal">{t}</div>
                <div className="text-brand-taupe">{d}</div>
                {ts && <div className="text-[10px] text-brand-copper mt-0.5 font-medium">{ts}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Card title="Observation history for this listing" className="mt-5">
        <LineChart rows={PRICE_HISTORY.map((r, i, a) => ({ d: r.d, p: Math.round(v.map + ((v.advertised - v.map) * Math.max(0, i - 2)) / (a.length - 3)) }))} xKey="d" series={[{ key: "p", color: "#A65E44" }]} refLine={{ value: v.map, label: `MAP ${formatUSD(v.map)}` }} height={170} yFmt={(n) => "$" + n} />
      </Card>

      <Modal open={dismissOpen} onClose={() => setDismissOpen(false)} title={`Dismiss ${v.id}`}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onUpdate(v.id, { status: "Dismissed", dismissReason: new FormData(e.target).get("reason") }); setDismissOpen(false); showToast(`${v.id} dismissed. Reason kept in audit log.`); }}>
          <Field label="Reason *">
            <select id="dismiss-reason" name="reason" className={inputCls} defaultValue="Wrong product match">
              {["Wrong product match", "Bundle / multipack", "Used or refurbished", "Authorised exception", "Extraction error", "Within tolerance"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Note>Dismissals are recorded, never deleted. If the cause is a bad match, fix it in Mapping Center so it stops recurring.</Note>
          <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
            <SecondaryButton onClick={() => setDismissOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit">Dismiss</PrimaryButton>
          </div>
        </form>
      </Modal>
    </Drawer>
  );
}

// Hosted, token-gated evidence page (what a brand or seller sees from the link in a report row).
export function EvidencePage({ violation, onClose }) {
  if (!violation) return null;
  const v = violation;
  return (
    <div className="fixed inset-0 z-[60] bg-brand-ivory overflow-y-auto">
      <div className="bg-brand-charcoal text-brand-ivory text-xs px-4 py-2 flex justify-between items-center gap-2">
        <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />evidence.mirethos.com — access link expires Oct 23, 2026 · view-only</span>
        <button onClick={onClose} className="underline cursor-pointer">Back to portal</button>
      </div>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <img src={logo} alt="" className="w-7 h-7 bg-white p-1 rounded-md border border-brand-beige" />
          <div>
            <div className="text-sm font-bold tracking-wide text-brand-charcoal">MIRETHOS · MAP Evidence Record</div>
            <div className="text-[11px] text-brand-taupe">Record {v.id} · generated automatically at detection · SHA-256 9c1e…4ab2</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Card title="Seller"><div className="space-y-2 text-xs"><KV k="Name" v={v.merchant} /><KV k="Classification" v={v.sellerClass} /><KV k="Risk index" v="82" /></div></Card>
          <Card title="Product"><div className="space-y-2 text-xs"><KV k="SKU" v={v.sku} /><KV k="Name" v={v.product} /><KV k="MAP in force" v={formatUSD(v.map)} /></div></Card>
          <Card title="Listing"><div className="space-y-2 text-xs"><KV k="Advertised" v={<span className="text-red-600">{formatUSD(v.advertised)}</span>} /><KV k="Below MAP" v={`${v.gap}%`} /><KV k="Captured" v="Sep 23, 2026 04:10 UTC" /></div></Card>
        </div>
        <Card title="Page snapshot">
          <div className="bg-brand-charcoal rounded-lg h-64 flex flex-col items-center justify-center text-center">
            <div className="text-brand-ivory font-bold">{v.product}</div>
            <div className="text-4xl font-black text-red-500 my-3">{formatUSD(v.advertised)}</div>
            <div className="text-xs text-brand-ivory/70">Sold by {v.merchant} · full-page capture, 1440×3200</div>
          </div>
          <div className="text-[11px] text-brand-taupe mt-3">Policy reference: LG US Unilateral MAP Policy v2026.2, effective Jul 01, 2026. This record documents an observed advertised price; it is not a legal determination.</div>
        </Card>
      </div>
    </div>
  );
}

// ============ SELLERS ============
export function SellersView({ clientName }) {
  const { db } = React.useContext(DataContext);
  const sellers = db[clientName].sellers;
  const [sel, setSel] = useState(null);
  return (
    <div>
      <PageHeader title={`Sellers — ${clientName} (Sandbox)`} subtitle="Storefronts found on each source, with effective-dated classification." action={<PrimaryButton><Plus className="w-4 h-4" /> Add seller</PrimaryButton>} />
      <Card>
        <Table columns={["Seller", "Source", "Classification", "Risk index", "Tracked SKUs", "Violations", "Repeat", "Avg depth", "Time to compliance", "Compliance"]}>
          {sellers.map((m) => (
            <tr key={m.name} onClick={() => setSel(m)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold"><span className="flex items-center gap-2"><Store className="w-4 h-4 text-brand-taupe" />{m.name}</span></Td>
              <Td className="text-brand-taupe">{m.source}</Td>
              <Td><Pill text={m.classification} tone={CLASS_BG[m.classification]} /></Td>
              <Td><span className="flex items-center gap-2 w-24"><span className="tabular-nums w-6">{m.risk}</span><span className="flex-1"><Bar value={m.risk} max={100} tone={m.risk > 60 ? "bg-red-500" : m.risk > 30 ? "bg-amber-500" : "bg-emerald-500"} /></span></span></Td>
              <Td>{m.tracked}</Td>
              <Td>{m.violations > 0 ? <Pill text={m.violations} tone="bg-red-50 text-red-700 border-red-200" /> : "0"}</Td>
              <Td>{m.repeat}</Td>
              <Td>{m.avgDepth ? `${m.avgDepth}%` : "—"}</Td>
              <Td>{m.ttc}</Td>
              <Td><span className={m.compliance >= 90 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>{m.compliance}%</span></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <SellerDrawer seller={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function SellerDrawer({ seller, onClose }) {
  const showToast = useToast();
  if (!seller) return null;
  const s = seller;
  return (
    <Drawer open onClose={onClose} eyebrow="Seller profile" title={`${s.name} — ${s.source}`}
      footer={<><SecondaryButton onClick={() => showToast("Classification change saved as a new effective-dated record.")}>Change classification</SecondaryButton><PrimaryButton onClick={() => showToast("Case opened for this seller.")}><Gavel className="w-4 h-4" /> Open case</PrimaryButton></>}>
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Risk index" value={s.risk} sub="frequency · depth · recurrence · response" />
        <KPI label="Violations (90d)" value={s.violations} sub={`${s.repeat} repeat offences`} />
        <KPI label="Avg discount depth" value={s.avgDepth ? `${s.avgDepth}%` : "—"} />
        <KPI label="Time to compliance" value={s.ttc} sub="median, closed cases" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Classification history">
          <div className="space-y-3 text-xs relative pl-3.5 border-l border-brand-beige">
            {[[s.classification, "Sep 22, 2026 → now", "analyst@mirethos.com · 'Not on LG authorised list v9'"], ["Unknown", "Aug 14 → Sep 21, 2026", "System · first seen on " + s.source]].map(([c, when, who]) => (
              <div key={when} className="relative">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                <Pill text={c} tone={CLASS_BG[c]} /><div className="text-brand-taupe mt-1">{when}</div><div className="text-[10px] text-brand-copper">{who}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Identity & contact">
          <div className="space-y-2.5 text-xs">
            <KV k="Canonical name" v={s.name} />
            <KV k="Observed aliases" v={s.aliases.length ? s.aliases.join(", ") : "—"} />
            <KV k="Linked sellers" v={s.name === "XYZ Electronics" ? "TechMart (62% — shared address)" : "—"} />
            <KV k="Notice contact" v={s.contact || <span className="text-amber-700">Missing — add before sending notices</span>} />
            <KV k="Storefront" v={<span className="text-brand-copper">{s.source.toLowerCase().replace(" ", "")}.com/…</span>} />
          </div>
        </Card>
      </div>
    </Drawer>
  );
}

// ============ ENFORCEMENT (replaces Email Center) ============
const CASE_STATES = ["Open", "Notice sent", "Awaiting response", "Contested", "Escalated", "Resolved"];

export function EnforcementView({ clientName }) {
  const { db } = React.useContext(DataContext);
  const cases = db[clientName].cases;
  const [tab, setTab] = useState("cases");
  const [sel, setSel] = useState(null);
  const showToast = useToast();
  return (
    <div>
      <PageHeader title={`Enforcement — ${clientName} (Sandbox)`} subtitle="Cases group violations by seller and period. Notices use the frozen evidence bundle." action={<PrimaryButton onClick={() => showToast("Pick violations from the Violations queue to open a case.", "info")}><Plus className="w-4 h-4" /> New case</PrimaryButton>} />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Open cases" value={cases.filter((c) => c.state !== "Resolved").length} />
        <KPI label="Notices sent (30d)" value="14" />
        <KPI label="Response rate" value="71%" />
        <KPI label="Contest rate" value="9%" />
        <KPI label="Recurrence rate" value="18%" sub="resolved sellers who re-offended in 60d" />
      </div>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "cases", label: "Cases", count: cases.length }, { id: "comms", label: "Communications", count: EMAILS.length }, { id: "templates", label: "Letter templates", count: 3 }]} />
        {tab === "cases" && (
          <Table columns={["Case", "Seller", "Violations", "Products", "State", "Owner", "Opened", "Response due", "Channel"]}>
            {cases.map((c) => (
              <tr key={c.id} onClick={() => setSel(c)} className="hover:bg-brand-beige/20 cursor-pointer">
                <Td className="font-semibold text-brand-copper">{c.id}</Td>
                <Td><MerchantLogo name={`${c.seller} (${c.source})`} /></Td>
                <Td>{c.violations}</Td>
                <Td className="text-brand-taupe">{c.products}</Td>
                <Td><Pill text={c.state} tone={STATUS_BG[c.state]} /></Td>
                <Td className="text-brand-taupe">{c.owner}</Td>
                <Td className="text-brand-taupe whitespace-nowrap">{c.opened}</Td>
                <Td className="text-brand-taupe whitespace-nowrap">{c.due}</Td>
                <Td className="text-brand-taupe">{c.channel}</Td>
              </tr>
            ))}
          </Table>
        )}
        {tab === "comms" && (
          <Table columns={["Date", "Seller", "Case", "Template", "Status", "Opened", "Response"]}>
            {EMAILS.map((e, i) => (
              <tr key={i} className="hover:bg-brand-beige/20">
                <Td className="text-brand-taupe">{e.date}</Td><Td className="font-semibold">{e.seller}</Td>
                <Td className="text-brand-copper font-medium">{e.violation}</Td><Td className="text-brand-taupe">{e.template}</Td>
                <Td><Pill text={e.status} tone={STATUS_BG.Delivered} /></Td><Td className="text-brand-taupe">{e.opened}</Td><Td className="text-brand-taupe">{e.response}</Td>
              </tr>
            ))}
          </Table>
        )}
        {tab === "templates" && (
          <Table columns={["Template", "Used for", "Attaches", "Approval", "Last edited"]}>
            {[["T-1 First Warning", "Unauthorised sellers", "Evidence bundle + policy 2026.2", "Brand approval required", "Sep 02, 2026"], ["T-2 MAP Reminder (Authorised)", "Authorised resellers", "Evidence bundle", "Auto-send allowed", "Aug 11, 2026"], ["T-3 Final Notice", "Repeat offenders (3+ in 90d)", "Evidence bundle + seller history", "Brand approval required", "Jul 30, 2026"]].map((r) => (
              <tr key={r[0]}>{r.map((c, i) => <Td key={i} className={i === 0 ? "font-semibold" : "text-brand-taupe"}>{c}</Td>)}</tr>
            ))}
          </Table>
        )}
      </Card>
      <CaseDrawer c={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function CaseDrawer({ c, onClose }) {
  const showToast = useToast();
  if (!c) return null;
  const idx = CASE_STATES.indexOf(c.state);
  return (
    <Drawer open onClose={onClose} eyebrow="Enforcement case" title={`${c.id} — ${c.seller}`}
      footer={<><SecondaryButton onClick={() => showToast("Escalated to LG brand team / marketplace takedown.")}>Escalate</SecondaryButton><SecondaryButton onClick={() => showToast("Contest recorded with code and message.")}>Record contest</SecondaryButton><PrimaryButton onClick={() => showToast("Notice queued for brand approval.")}><Send className="w-4 h-4" /> Generate notice</PrimaryButton></>}>
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {CASE_STATES.map((s, i) => (
          <React.Fragment key={s}>
            <span className={`text-xs px-2.5 py-1 rounded-full border ${i <= idx ? "bg-brand-copper text-brand-white border-brand-copper" : "border-brand-beige text-brand-taupe bg-brand-white"}`}>{s}</span>
            {i < CASE_STATES.length - 1 && <span className="w-3 h-px bg-brand-beige" />}
          </React.Fragment>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Letter preview (T-1 First Warning)">
          <div className="text-xs text-brand-charcoal space-y-2 leading-relaxed">
            <p>To: {c.seller} — compliance contact on file</p>
            <p>Re: Advertised prices below LG's Minimum Advertised Price policy (v2026.2)</p>
            <p>On Sep 21–23, 2026 we observed {c.violations} listings from your storefront on {c.source} advertised below the MAP in force for products {c.products}. Evidence for each listing, including timestamped page captures, is available at the secure links below…</p>
            <p className="text-brand-taupe">[3 evidence links · policy PDF attached]</p>
          </div>
        </Card>
        <Card title="Activity">
          <div className="space-y-3 text-xs relative pl-3.5 border-l border-brand-beige">
            {[["Case opened", c.opened, "3 violations grouped"], ["Notice sent", "Sep 21, 2026 10:15", "Email + Amazon Brand Registry report #BR-99812"], ["Listing re-checked", "Sep 23, 2026 06:00", "LG-001 moved to $1,449 — still below MAP"], ["Response due", c.due, "Accelerated re-check every 6h until then"]].map(([t, w, d]) => (
              <div key={t} className="relative"><span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" /><div className="font-bold">{t}</div><div className="text-brand-taupe">{d}</div><div className="text-[10px] text-brand-copper">{w}</div></div>
            ))}
          </div>
        </Card>
      </div>
    </Drawer>
  );
}
