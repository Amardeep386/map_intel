// Violations (docs/reference/prototype-src/views_monitor.jsx): one row per breach of a listing,
// judged against the MAP in force on each observation date. The drawer shows the facts it was
// judged on, the proof of every observation, the status history, and status changes (each one a
// new event, never an edit).
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, CircleCheck, Copy, Download, ExternalLink, FileSearch, Lock, Megaphone, RotateCcw, ShieldCheck } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import { Card, Drawer, Field, inputCls, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Tabs, Td } from "../ui.jsx";
import { money, TONE } from "../format.js";
import { openEvidence } from "../evidence.js";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const V_STATUSES = ["Open", "Needs review", "Under notice", "Authorised promo", "Resolved", "Dismissed"];
const DISMISS_REASONS = ["Wrong product match", "Bundle / multipack", "Used or refurbished", "Authorised exception", "Extraction error", "Within tolerance"];
const pct = (n) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(1)}%`);
const age = (from, to) => {
  const h = Math.max(0, (new Date(to || Date.now()) - new Date(from)) / 3_600_000);
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
};

export function ViolationsView() {
  const { client, showToast } = useWorkspace();
  const [tab, setTab] = useState("active");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);

  const filters = tab === "active" ? { active: true } : tab === "all" ? {} : { status: tab };
  const key = JSON.stringify({ ...filters, q });
  const load = useCallback(async () => {
    const f = JSON.parse(key);
    setData((await attempt(showToast, () => api.violations(client, { ...f, q: f.q || undefined }))) ?? { total: 0, rows: [], counts: {} });
  }, [client, showToast, key]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = (counts.Open ?? 0) + (counts["Needs review"] ?? 0) + (counts["Under notice"] ?? 0);
  const rows = data?.rows ?? [];
  return (
    <div>
      <PageHeader title={`Violations — ${client.name} (${client.status})`} subtitle="Each row is a breach of one listing, judged against the MAP in force on each observation date."
        action={<SecondaryButton onClick={() => attempt(showToast, () => api.downloadViolationsCsv(client, { ...filters, q: q || undefined }))}><Download className="w-4 h-4" /> Export CSV</SecondaryButton>} />
      <Card>
        <Tabs value={tab} onChange={setTab}
          tabs={[{ id: "active", label: "Active", count: active }, ...V_STATUSES.map((s) => ({ id: s, label: s, count: counts[s] ?? 0 })), { id: "all", label: "All", count: all }]} />
        <div className="flex justify-between mb-4 gap-2 flex-wrap">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, product, seller, violation ID..." />
        </div>
        {data && !rows.length ? (
          <div className="text-sm text-brand-taupe py-8 text-center">No violations here. Prices are judged after every collection run.</div>
        ) : (
          <Table columns={["Violation", "Product", "Seller", "Class", "MAP", "Advertised", "Gap", "First seen", "Severity", "Status", ""]}>
            {rows.map((v) => (
              <tr key={v.id} onClick={() => setSel(v.id)} className="hover:bg-surface-2 cursor-pointer">
                <Td className="font-mono text-[12px] font-medium text-brand-copper whitespace-nowrap">{v.code}</Td>
                <Td className="min-w-[220px] max-w-[340px]"><div className="font-medium leading-snug">{v.product}</div><div className="text-[11px] text-brand-taupe font-mono mt-0.5">{v.sku}</div></Td>
                <Td className="whitespace-nowrap"><div>{v.seller}</div><div className="text-[11.5px] text-brand-taupe">{v.source}</div></Td>
                <Td><Pill text={v.class_at_capture} tone={TONE[v.class_at_capture]} /></Td>
                <Td className="whitespace-nowrap tabular-nums">{money(v.last_map)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{money(v.last_price)}</Td>
                <Td className="text-red-600 font-semibold whitespace-nowrap tabular-nums">−{pct(v.last_depth_pct)}</Td>
                <Td className="text-brand-taupe whitespace-nowrap">{new Date(v.opened_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</Td>
                <Td><Pill text={v.severity} tone={TONE[v.severity]} /></Td>
                <Td><Pill text={v.status} tone={TONE[v.status]} /></Td>
                <Td>
                  <button onClick={(e) => { e.stopPropagation(); openEvidence(showToast, v.evidence_id); }} title="Open the latest proof"
                    className="text-brand-taupe hover:text-brand-copper p-1 rounded cursor-pointer disabled:opacity-30" disabled={!v.evidence_id}><FileSearch className="w-4 h-4" /></button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="text-xs text-brand-taupe mt-3">Showing {rows.length} of {data?.total ?? 0} violations</div>
      </Card>
      {sel && <ViolationDrawer violationId={sel} onClose={() => setSel(null)} onChanged={load} />}
    </div>
  );
}

export function ViolationDrawer({ violationId, onClose, onChanged }) {
  const { client, can, showToast, chartColors } = useWorkspace();
  const [v, setV] = useState(null);
  const [asking, setAsking] = useState(null); // status that needs a reason

  useEffect(() => {
    let live = true;
    attempt(showToast, () => api.violation(client, violationId)).then((r) => { if (live) setV(r ?? null); });
    return () => { live = false; };
  }, [client, violationId, showToast]);

  const setStatus = async (status, reason) => {
    const r = await attempt(showToast, () => api.setViolationStatus(client, violationId, { status, reason }));
    if (r) {
      setV(r);
      setAsking(null);
      showToast(`${r.code}: ${status}. Recorded in the history.`);
      onChanged?.();
    }
  };

  const shareLink = async (copy) => {
    const tab = copy ? null : window.open("", "_blank"); // opened now, so the browser does not block it
    const link = await attempt(showToast, () => api.createEvidenceLink(client, violationId));
    if (!link) { tab?.close(); return; }
    if (tab) { tab.location.href = link.url; return; }
    try {
      await navigator.clipboard.writeText(link.url);
      showToast(`Evidence link copied. It expires ${new Date(link.expiresAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })}.`);
    } catch {
      showToast(`Copying was blocked by the browser. The link: ${link.url}`, "info");
    }
  };

  if (!v) return <Drawer open onClose={onClose} eyebrow="Violation profile" title="Loading…"><div className="text-sm text-brand-taupe">Loading…</div></Drawer>;
  const writable = can("violations.write") && !v.episode_closed;
  const chart = [...v.history].reverse().map((h) => ({ t: new Date(h.observed_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" }), price: h.price, map: h.promo ?? h.map }));
  const tooltipStyle = chartColors ? { background: chartColors.card, border: `1px solid ${chartColors.grid}`, borderRadius: 8, color: chartColors.text, fontSize: 12 } : undefined;
  return (
    <Drawer open onClose={onClose} eyebrow="Violation profile" title={`Violation Detail — ${v.code}`}
      footer={writable && <>
        {v.status === "Needs review" && <SecondaryButton onClick={() => setStatus("Open")}><CircleCheck className="w-4 h-4" /> Confirm violation</SecondaryButton>}
        {v.status !== "Dismissed" && <SecondaryButton onClick={() => setAsking("Dismissed")}><Ban className="w-4 h-4" /> Dismiss with reason</SecondaryButton>}
        {v.status === "Dismissed" && <SecondaryButton onClick={() => setStatus("Open")}><RotateCcw className="w-4 h-4" /> Reopen</SecondaryButton>}
        <SecondaryButton onClick={() => setAsking("Resolved")}><CircleCheck className="w-4 h-4" /> Close with reason</SecondaryButton>
        {v.status !== "Under notice" && <PrimaryButton onClick={() => setStatus("Under notice")}><Megaphone className="w-4 h-4" /> Mark under notice</PrimaryButton>}
      </>}>
      {v.status === "Needs review" && <div className="mb-4"><Note tone="bg-amber-50 text-amber-800 border-amber-200"><b>Needs review:</b> {v.status_reason || "Check the match and the price before acting."}</Note></div>}
      {v.status === "Dismissed" && <div className="mb-4"><Note tone="bg-slate-50 text-slate-700 border-slate-200"><b>Dismissed:</b> {v.status_reason}. Later observations below MAP join this violation until a compliant price ends it.</Note></div>}
      {v.episode_closed && <div className="mb-4"><Note tone="bg-emerald-50 text-emerald-800 border-emerald-200"><b>Ended {formatWhen(v.closed_at)}:</b> {v.status_reason || v.status}. A new breach of this listing opens a new violation.</Note></div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-3">Violation Information</h4>
          <div className="space-y-2.5 text-xs">
            <KV k="SKU / Product" v={`${v.sku} — ${v.product}`} />
            <KV k="Seller" v={`${v.seller} · ${v.source}`} />
            <KV k="Seller class (at capture)" v={<Pill text={v.class_at_capture} tone={TONE[v.class_at_capture]} />} />
            <KV k="MAP in force" v={money(v.last_map)} />
            <KV k="Advertised price" v={<span className="text-red-600">{money(v.last_price)}</span>} />
            <KV k="Gap" v={<span className="text-red-600">−{pct(v.last_depth_pct)} ({money(v.last_depth_abs)})</span>} />
            <KV k="Deepest" v={pct(v.max_depth_pct)} />
            <KV k="First seen" v={formatWhen(v.opened_at)} />
            <KV k="Duration" v={age(v.opened_at, v.closed_at)} />
            <KV k="Observations" v={v.observations} />
            <KV k="Rule applied" v={v.rule || "—"} />
            <KV k="Severity" v={<Pill text={v.severity} tone={TONE[v.severity]} />} />
            <KV k="Status" v={<Pill text={v.status} tone={TONE[v.status]} />} />
          </div>
        </div>

        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <div className="flex justify-between items-center border-b border-brand-beige pb-1.5 mb-3">
            <h4 className="text-sm font-semibold text-brand-charcoal">Evidence</h4>
            <span className="text-[10px] inline-flex items-center gap-1 text-emerald-700"><Lock className="w-3 h-3" />Locked at capture</span>
          </div>
          <div className="space-y-1.5 text-[11px]">
            <KV k="Latest proof" v={v.evidence_id ? <button className="text-brand-copper underline cursor-pointer" onClick={() => openEvidence(showToast, v.evidence_id)}>Open</button> : "—"} />
            <KV k="Policy document" v={v.policy ? `${v.policy.name} v${v.policy.version}` : "None in force"} />
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {can("violations.write") && <>
              <button onClick={() => shareLink(false)} className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer font-semibold"><ShieldCheck className="w-3.5 h-3.5" />Preview shareable evidence page</button>
              <button onClick={() => shareLink(true)} className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer"><Copy className="w-3.5 h-3.5" />Copy expiring link (30 days)</button>
            </>}
            {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-xs text-brand-copper hover:underline inline-flex items-center gap-1">Open live listing <ExternalLink className="w-3 h-3" /></a>}
          </div>
          <div className="text-[10px] text-brand-taupe mt-3">Each observation's page screenshot or API evidence card is stored with its SHA-256 and locked (S3 Object Lock).</div>
        </div>

        <div className="bg-brand-white border border-brand-beige rounded-xl p-4">
          <h4 className="text-sm font-semibold text-brand-charcoal border-b border-brand-beige pb-1.5 mb-3">Timeline</h4>
          <div className="space-y-3.5 text-xs relative pl-3.5 border-l border-brand-beige">
            {v.events.map((e) => (
              <div className="relative" key={e.id}>
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                <div className="font-bold text-brand-charcoal">{e.status}</div>
                <div className="text-brand-taupe">{e.reason || (e.actor === "System" ? "Rule verdict on a new observation." : "Changed by hand.")}</div>
                <div className="text-[10px] text-brand-copper mt-0.5 font-medium">{formatWhen(e.observed_at || e.created_at)} · {e.actor}</div>
              </div>
            ))}
            {!v.episode_closed && (
              <div className="relative">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-beige" />
                <div className="font-bold text-brand-charcoal">Re-check</div>
                <div className="text-brand-taupe">Resolved automatically when a new observation shows a compliant price.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card title="Observation history for this listing" className="mt-5">
        {chart.length > 1 && chartColors && (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={chart} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} tickFormatter={(n) => `$${n}`} width={60} domain={["dataMin - 50", "dataMax + 50"]} />
              <Tooltip contentStyle={tooltipStyle} formatter={(n) => money(n)} />
              <ReferenceLine y={v.last_map} stroke="#B0341F" strokeDasharray="4 4" label={{ value: `MAP ${money(v.last_map)}`, fill: chartColors.muted, fontSize: 10, position: "insideTopRight" }} />
              <Line type="stepAfter" dataKey="price" name="Advertised" stroke={chartColors.accent} strokeWidth={2} dot={{ r: 3, fill: chartColors.accent }} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <Table columns={["Observed", "Price", "MAP in force", "Gap", "Verdict", "Seller class", "Proof"]}>
          {v.history.map((h) => (
            <tr key={h.observation_id}>
              <Td className="text-brand-taupe whitespace-nowrap">{formatWhen(h.observed_at)}</Td>
              <Td className="font-semibold whitespace-nowrap">{money(h.price)}</Td>
              <Td className="whitespace-nowrap">{money(h.map)}{h.promo ? <span className="text-brand-taupe"> · promo {money(h.promo)}</span> : null}</Td>
              <Td className={h.depth_pct > 0 ? "text-red-600 font-semibold" : "text-brand-taupe"}>{h.depth_pct > 0 ? `−${pct(h.depth_pct)}` : "at or above"}</Td>
              <Td>{h.outcome.replace("_", " ")}{h.severity ? ` · ${h.severity}` : ""}</Td>
              <Td className="text-brand-taupe">{h.class_at_capture}</Td>
              <Td className="whitespace-nowrap">
                {h.evidence_id ? (
                  <span className="flex gap-3">
                    <button className="text-xs text-brand-copper underline cursor-pointer" onClick={() => openEvidence(showToast, h.evidence_id)}>{h.has_screenshot ? "Screenshot" : h.has_card ? "Evidence card" : "Page"}</button>
                    {h.has_api && <button className="text-xs text-brand-copper underline cursor-pointer" onClick={() => openEvidence(showToast, h.evidence_id, "api")}>API data</button>}
                  </span>
                ) : <span className="text-brand-taupe">—</span>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {asking && <ReasonModal status={asking} code={v.code} onClose={() => setAsking(null)} onSubmit={(reason) => setStatus(asking, reason)} />}
    </Drawer>
  );
}

function ReasonModal({ status, code, onClose, onSubmit }) {
  const [reason, setReason] = useState(status === "Dismissed" ? DISMISS_REASONS[0] : "");
  const [note, setNote] = useState("");
  const full = [reason, note.trim()].filter(Boolean).join(": ");
  return (
    <Modal open onClose={onClose} title={status === "Dismissed" ? `Dismiss ${code}` : `Close ${code}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (full) onSubmit(full); }}>
        {status === "Dismissed" && (
          <Field label="Reason *">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {DISMISS_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        )}
        <Field label={status === "Dismissed" ? "Note" : "Reason *"}>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === "Dismissed" ? "Optional detail" : "e.g. Seller corrected the price; confirmed by phone"} />
        </Field>
        <Note>
          {status === "Dismissed"
            ? "Dismissals are recorded, never deleted. If the cause is a bad match, fix it in Mapping Center so it stops recurring."
            : "Closing ends this violation now. It normally closes by itself when a compliant price is observed."}
        </Note>
        {status === "Dismissed" && <div className="text-[11px] text-brand-taupe inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> The seller and product stay monitored.</div>}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!full}>{status === "Dismissed" ? "Dismiss" : "Close violation"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
