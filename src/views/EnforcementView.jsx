// Enforcement (docs/reference/prototype-src/views_monitor.jsx EnforcementView, replaces the Email
// Center): cases group one seller's violations; notices are filled from the frozen evidence, go to
// the brand for approval and are logged as sent (no email provider: the analyst sends the letter);
// the communications log, letter templates and the IP track (marketplace reports, only on cases
// marked as an IP issue). A case resolves when a re-check sees a compliant price.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Download, FileText, Gavel, MessageSquare, Pencil, Send, ShieldAlert, UserCog, X } from "lucide-react";
import { api } from "../api/client.js";
import {
  Card, Drawer, Field, KPI, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Tabs, Td, inputCls,
} from "../ui.jsx";
import { TONE, formatDay, money } from "../format.js";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const PATH = ["Open", "Notice sent", "Awaiting response", "Contested / Escalated", "Resolved"];
const stepOf = (state) => (state === "Contested" || state === "Escalated" ? 3 : state === "Recurred" ? 4 : PATH.indexOf(state));
// What a person may do from each state (server/src/lib/cases.ts MANUAL_MOVES).
const MOVES = {
  Open: ["Notice sent", "Escalated", "Resolved"],
  "Notice sent": ["Awaiting response", "Contested", "Escalated", "Resolved"],
  "Awaiting response": ["Contested", "Escalated", "Resolved"],
  Contested: ["Awaiting response", "Escalated", "Resolved"],
  Escalated: ["Awaiting response", "Contested", "Resolved"],
  Resolved: [],
  Recurred: [],
};
const NEEDS_REASON = ["Notice sent", "Contested", "Escalated", "Resolved"];
const MOVE_HINT = {
  "Notice sent": "Only for a notice sent outside MAP Intel. Notices sent from this case move it here by themselves.",
  Resolved: "A manual close. Normally a case resolves by itself when a re-check sees a compliant price.",
};
const CHANNELS = ["email", "marketplace message", "phone", "letter", "other"];
const IP_CHANNELS = [
  ["amazon_rav", "Amazon Brand Registry (Report a Violation)", "amazon_"],
  ["ebay_vero", "eBay VeRO", "ebay_"],
  ["walmart_brand_portal", "Walmart Brand Portal", "walmart_"],
];
const IP_BASES = [
  ["counterfeit", "Counterfeit"], ["trademark", "Trademark"], ["copyright", "Copyright (images or text)"],
  ["design_patent", "Design patent"], ["utility_patent", "Utility patent"], ["material_difference", "Material difference (after legal review)"],
];
const PLACEHOLDERS = "{{brand}} {{seller}} {{source}} {{period}} {{violationCount}} {{violationTable}} {{responseDue}} {{policy}} {{sellerHistory}} {{signature}}";
const textareaCls = "w-full px-3 py-2 text-[13px] border border-line-strong rounded-lg bg-brand-white text-brand-charcoal font-mono leading-relaxed";
const today = () => new Date().toLocaleDateString("en-CA");
const WARN = "text-amber-800 bg-amber-50 border-amber-200";

export function EnforcementView() {
  const { client, can, showToast } = useWorkspace();
  const approver = can("notices.approve");
  const [tab, setTab] = useState(approver && !can("cases.write") ? "approvals" : "cases");
  const [cases, setCases] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [comms, setComms] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [reports, setReports] = useState([]);
  const [show, setShow] = useState("open");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [loadedAt, setLoadedAt] = useState(() => Date.now()); // "last 30 days" is counted from the last load

  useEffect(() => {
    attempt(showToast, () => api.cases(client, show === "open" ? { open: "true" } : {})).then((r) => setCases(r ?? { rows: [], counts: {} }));
  }, [client, showToast, show, version]);
  useEffect(() => {
    attempt(showToast, () => api.notices(client, { status: "Awaiting approval" })).then((r) => setApprovals(r ?? []));
    attempt(showToast, () => api.communications(client)).then((r) => setComms(r ?? []));
    attempt(showToast, () => api.noticeTemplates(client)).then((r) => setTemplates(r ?? []));
    attempt(showToast, () => api.ipReports(client)).then((r) => { setReports(r ?? []); setLoadedAt(Date.now()); });
  }, [client, showToast, version]);

  const kpi = useMemo(() => {
    const since = loadedAt - 30 * 86_400_000;
    const sent = comms.filter((m) => m.kind === "notice" && new Date(m.occurred_at).getTime() >= since);
    const noticed = new Set(comms.filter((m) => m.kind === "notice").map((m) => m.case_id));
    const answered = new Set(comms.filter((m) => m.direction === "inbound" && noticed.has(m.case_id)).map((m) => m.case_id));
    const contested = new Set(comms.filter((m) => m.kind === "contest").map((m) => m.case_id));
    const counts = cases?.counts ?? {};
    const open = Object.entries(counts).filter(([s]) => s !== "Resolved" && s !== "Recurred").reduce((n, [, c]) => n + c, 0);
    return {
      open, sent: sent.length, recurred: counts.Recurred ?? 0,
      response: noticed.size ? Math.round((100 * answered.size) / noticed.size) : null,
      contest: noticed.size ? Math.round((100 * contested.size) / noticed.size) : null,
    };
  }, [comms, cases, loadedAt]);

  const rows = (cases?.rows ?? []).filter((c) => `${c.code} ${c.seller} ${c.products ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const tabs = [
    { id: "cases", label: "Cases", count: cases?.total },
    { id: "approvals", label: "Waiting for approval", count: approvals.length },
    { id: "comms", label: "Communications", count: comms.length },
    { id: "templates", label: "Letter templates", count: templates.length },
    { id: "ip", label: "IP reports", count: reports.length },
  ];
  return (
    <div>
      <PageHeader title="Enforcement" subtitle="Cases group a seller's violations. Notices are filled from the frozen evidence, approved by the brand and logged as sent; a case resolves when a re-check sees a compliant price." />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Open cases" value={cases ? kpi.open : "—"} />
        <KPI label="Waiting for approval" value={approvals.length} sub="notices with the brand" subTone={approvals.length ? "text-amber-700 font-semibold" : undefined} />
        <KPI label="Notices sent (30d)" value={kpi.sent} sub="logged; sent by the analyst" />
        <KPI label="Response rate" value={kpi.response === null ? "—" : `${kpi.response}%`} sub="cases with a notice that got a reply" />
        <KPI label="Contest rate" value={kpi.contest === null ? "—" : `${kpi.contest}%`} />
        <KPI label="Recurred" value={kpi.recurred} sub="sellers who offended again within 60 days" />
      </div>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        {tab === "cases" && (
          <>
            <div className="flex justify-between mb-4 gap-3 flex-wrap">
              <SearchBox value={q} onChange={setQ} placeholder="Search case, seller or SKU..." />
              <select value={show} onChange={(e) => setShow(e.target.value)} className={`${inputCls} !w-40`}>
                <option value="open">Open cases</option><option value="all">All cases</option>
              </select>
            </div>
            <Table columns={["Case", "Seller", "Violations", "Products", "State", "Owner", "Opened", "Response due", "Track"]}>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setSel(c.id)} className="hover:bg-brand-beige/20 cursor-pointer">
                  <Td className="font-semibold text-brand-copper">{c.code}</Td>
                  <Td><span className="font-semibold">{c.seller}</span> <span className="text-brand-taupe text-xs">· {c.source}</span></Td>
                  <Td>{c.active_violations !== c.violations ? `${c.active_violations} of ${c.violations} open` : c.violations}</Td>
                  <Td className="text-brand-taupe">{c.products}</Td>
                  <Td><Pill text={c.state} tone={TONE[c.state]} /></Td>
                  <Td className="text-brand-taupe">{c.owner_name ?? "—"}</Td>
                  <Td className="text-brand-taupe whitespace-nowrap">{formatDay(c.opened_at)}</Td>
                  <Td className={`whitespace-nowrap ${c.overdue ? "text-red-600 font-semibold" : "text-brand-taupe"}`}>{c.response_due ? formatDay(`${c.response_due}T12:00:00`) : "—"}{c.overdue ? " · overdue" : ""}</Td>
                  <Td>{c.ip_issue ? <Pill text="IP" tone={TONE.Escalated} /> : <span className="text-brand-taupe text-xs">Pricing</span>}</Td>
                </tr>
              ))}
            </Table>
            {cases && !rows.length && (
              <div className="text-center py-8 text-sm text-brand-taupe">No cases{show === "open" ? " open" : ""}. Open one from a seller's profile (Sellers) by picking their open violations.</div>
            )}
          </>
        )}
        {tab === "approvals" && <Approvals rows={approvals} onOpenCase={setSel} onChanged={refresh} />}
        {tab === "comms" && <Communications rows={comms} onOpenCase={setSel} />}
        {tab === "templates" && <Templates rows={templates} onChanged={refresh} />}
        {tab === "ip" && <IpReports rows={reports} onOpenCase={setSel} />}
      </Card>
      {sel && <CaseDrawer caseId={sel} templates={templates} onClose={() => setSel(null)} onChanged={refresh} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function Approvals({ rows, onOpenCase, onChanged }) {
  const { can } = useWorkspace();
  const [open, setOpen] = useState(null);
  return (
    <>
      <Table columns={["Notice", "Case", "Seller", "Subject", "Drafted", ""]}>
        {rows.map((n) => (
          <tr key={n.id}>
            <Td className="font-semibold">{n.code}</Td>
            <Td><button onClick={() => onOpenCase(n.case_id)} className="text-brand-copper hover:underline cursor-pointer">{n.case_code}</button></Td>
            <Td>{n.seller}</Td>
            <Td className="max-w-md truncate">{n.subject}</Td>
            <Td className="text-brand-taupe whitespace-nowrap">{formatWhen(n.created_at)} · {n.created_by}</Td>
            <Td><SecondaryButton onClick={() => setOpen(n)}>{can("notices.approve") ? "Review" : "View"}</SecondaryButton></Td>
          </tr>
        ))}
      </Table>
      {!rows.length && <div className="text-center py-8 text-sm text-brand-taupe">No notice is waiting for the brand's approval.</div>}
      <div className="mt-3"><Note>Only the brand's own people (Brand users) approve notices. Once approved, the analyst sends it and records it here.</Note></div>
      {open && <NoticeModal notice={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); onChanged(); }} />}
    </>
  );
}

function Communications({ rows, onOpenCase }) {
  return (
    <>
      <Table columns={["When", "Case", "Seller", "Direction", "Kind", "Channel", "Summary", "By"]}>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="text-brand-taupe whitespace-nowrap">{formatWhen(m.occurred_at)}</Td>
            <Td><button onClick={() => onOpenCase(m.case_id)} className="text-brand-copper hover:underline cursor-pointer">{m.case_code}</button></Td>
            <Td className="font-semibold">{m.seller}</Td>
            <Td className="text-brand-taupe">{m.direction === "outbound" ? "To seller" : m.direction === "inbound" ? "From seller" : "Internal"}</Td>
            <Td><Pill text={m.kind === "notice" ? `Notice${m.template ? ` · ${m.template}` : ""}` : m.kind} tone={m.kind === "contest" ? TONE.Contested : m.kind === "response" ? TONE.Resolved : undefined} /></Td>
            <Td className="text-brand-taupe">{m.channel}{m.delivery ? ` (${m.delivery})` : ""}</Td>
            <Td className="max-w-md">{m.summary}</Td>
            <Td className="text-brand-taupe">{m.actor}</Td>
          </tr>
        ))}
      </Table>
      {!rows.length && <div className="text-center py-8 text-sm text-brand-taupe">Nothing yet. Notices sent and the sellers' replies appear here.</div>}
    </>
  );
}

function Templates({ rows, onChanged }) {
  const { can } = useWorkspace();
  const [edit, setEdit] = useState(null);
  return (
    <>
      <Table columns={["Template", "Used for", "Attaches policy", "Version", "Sent", "Active", "Last edited", ""]}>
        {rows.map((t) => (
          <tr key={t.id}>
            <Td className="font-semibold">{t.code} {t.name}</Td>
            <Td className="text-brand-taupe">{t.used_for ?? "—"}</Td>
            <Td className="text-brand-taupe">{t.attaches_policy ? "Yes" : "No"}</Td>
            <Td>v{t.version}</Td>
            <Td>{t.sent}</Td>
            <Td>{t.active ? <span className="text-emerald-700 text-xs font-semibold">On</span> : <span className="text-brand-taupe text-xs">Off</span>}</Td>
            <Td className="text-brand-taupe whitespace-nowrap">{formatDay(t.updated_at)}{t.updated_by ? ` · ${t.updated_by}` : ""}</Td>
            <Td><SecondaryButton onClick={() => setEdit(t)}>{can("settings.write") ? <><Pencil className="w-3.5 h-3.5" /> Edit</> : "View"}</SecondaryButton></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Note tone={WARN}>The starting wording is a draft: have it reviewed (legal review, decision 5) before a notice goes to a real seller.</Note></div>
      {edit && <TemplateModal template={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
    </>
  );
}

function IpReports({ rows, onOpenCase }) {
  return (
    <>
      <Table columns={["Report", "Case", "Seller", "Channel", "Basis", "Status", "Reference", "Filed"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="font-semibold">{r.code}</Td>
            <Td><button onClick={() => onOpenCase(r.case_id)} className="text-brand-copper hover:underline cursor-pointer">{r.case_code}</button></Td>
            <Td>{r.seller}</Td>
            <Td className="text-brand-taupe">{r.channel_label}</Td>
            <Td className="text-brand-taupe">{r.basis_label}</Td>
            <Td><Pill text={r.status} tone={TONE[r.status]} /></Td>
            <Td>{r.reference ?? "—"}</Td>
            <Td className="text-brand-taupe">{r.filed_at ? formatDay(r.filed_at) : "—"}</Td>
          </tr>
        ))}
      </Table>
      {!rows.length && <div className="text-center py-8 text-sm text-brand-taupe">No IP reports. They are only possible on a case marked as an IP issue (counterfeit, trademark or copyright misuse) — never for a price below MAP.</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Case drawer
// ---------------------------------------------------------------------------

function CaseDrawer({ caseId, templates, onClose, onChanged }) {
  const { client, can, showToast } = useWorkspace();
  const [c, setC] = useState(null);
  const [notices, setNotices] = useState([]);
  const [comms, setComms] = useState([]);
  const [reports, setReports] = useState([]);
  const [modal, setModal] = useState(null); // { kind, ... }
  const load = useCallback(async () => {
    const d = await attempt(showToast, () => api.caseDetail(client, caseId));
    if (d) setC(d);
    attempt(showToast, () => api.notices(client, { case: caseId })).then((r) => r && setNotices(r));
    attempt(showToast, () => api.communications(client, { case: caseId })).then((r) => r && setComms(r));
    attempt(showToast, () => api.ipReports(client, { case: caseId })).then((r) => r && setReports(r));
  }, [client, caseId, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  if (!c) return null;

  const writable = can("cases.write") && !c.closed;
  const done = async (msg) => {
    if (msg) showToast(msg);
    setModal(null);
    await load();
    onChanged();
  };
  const run = async (fn, msg) => { if ((await attempt(showToast, fn)) !== undefined) await done(msg); };
  const step = stepOf(c.state);
  const activity = [
    ...c.events.map((e) => ({ at: e.created_at, title: e.state, detail: e.reason, by: e.actor, proof: e.observed_at })),
    ...comms.filter((m) => m.kind !== "notice").map((m) => ({ at: m.occurred_at, title: m.kind === "note" ? "Note" : `Seller ${m.kind}`, detail: `${m.summary} (${m.channel})`, by: m.actor })),
    ...notices.filter((n) => n.sent_at).map((n) => ({ at: n.sent_at, title: `${n.code} sent`, detail: n.subject, by: n.sent_by })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  const latest = notices.find((n) => n.status !== "Cancelled" && n.status !== "Rejected") ?? notices[0];
  const moves = MOVES[c.state] ?? [];

  return (
    <Drawer open onClose={onClose} eyebrow={`Enforcement case · ${c.ip_issue ? "IP track" : "pricing"}`} title={`${c.code} — ${c.seller} (${c.source})`}
      footer={writable && <>
        <SecondaryButton onClick={() => setModal({ kind: "log" })}><MessageSquare className="w-4 h-4" /> Log reply</SecondaryButton>
        <SecondaryButton onClick={() => setModal({ kind: "assign" })}><UserCog className="w-4 h-4" /> Owner & due date</SecondaryButton>
        {!c.ip_issue && <SecondaryButton onClick={() => setModal({ kind: "ip" })}><ShieldAlert className="w-4 h-4" /> Mark IP issue</SecondaryButton>}
        {moves.length > 0 && <SecondaryButton onClick={() => setModal({ kind: "move" })}><Gavel className="w-4 h-4" /> Move case</SecondaryButton>}
        <PrimaryButton onClick={() => setModal({ kind: "draft" })} disabled={!c.active_violations}><FileText className="w-4 h-4" /> Draft notice</PrimaryButton>
      </>}>
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {PATH.map((s, i) => (
          <React.Fragment key={s}>
            <span className={`text-xs px-2.5 py-1 rounded-full border ${i <= step ? "bg-brand-copper text-on-accent border-brand-copper" : "border-brand-beige text-brand-taupe bg-brand-white"}`}>
              {i === 3 && (c.state === "Contested" || c.state === "Escalated") ? c.state : i === 4 && c.state === "Recurred" ? "Recurred" : s}
            </span>
            {i < PATH.length - 1 && <span className="w-3 h-px bg-brand-beige" />}
          </React.Fragment>
        ))}
      </div>
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="State" value={c.state} sub={formatWhen(c.state_at)} />
        <KPI label="Violations" value={`${c.active_violations} open`} sub={`${c.violations} in the case`} />
        <KPI label="Response due" value={c.response_due ? formatDay(`${c.response_due}T12:00:00`) : "—"} sub={c.overdue ? "overdue" : ""} subTone="text-red-600 font-semibold" />
        <KPI label="Owner" value={c.owner_name ?? "—"} />
      </div>
      {c.recurred_from_code && <div className="mb-4"><Note tone={WARN}>This seller offended again within 60 days of {c.recurred_from_code} being resolved.</Note></div>}
      {c.ip_issue && <div className="mb-4"><Note>Marked as an IP issue: {c.ip_reason}</Note></div>}

      <Card title="Violations" className="mb-4">
        <Table compact columns={["Violation", "Product", "Advertised", "MAP", "Below", "Status", "Last seen", ""]}>
          {c.violations.map((v) => (
            <tr key={v.id}>
              <Td className="font-semibold">{v.code}</Td><Td>{v.sku} — {v.product}</Td><Td>{money(v.last_price)}</Td>
              <Td className="text-brand-taupe">{money(v.last_map)}</Td><Td>{v.last_depth_pct === null ? "—" : `${v.last_depth_pct.toFixed(1)}%`}</Td>
              <Td><Pill text={v.status} tone={TONE[v.status]} /></Td><Td className="text-brand-taupe">{formatDay(v.last_seen)}</Td>
              <Td><a href={v.url} target="_blank" rel="noreferrer" className="text-brand-copper text-xs hover:underline">Listing</a></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Notices">
          {notices.length ? (
            <div className="space-y-2">
              {notices.map((n) => (
                <div key={n.id} className="flex justify-between items-center gap-2 text-xs border-b border-brand-beige pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="font-semibold">{n.code} · {n.template_code ?? "—"} <Pill text={n.status} tone={TONE[n.status]} /></div>
                    <div className="text-brand-taupe truncate">{n.subject}</div>
                    {n.decision_note && <div className="text-red-600">Brand: “{n.decision_note}”</div>}
                  </div>
                  <SecondaryButton onClick={() => setModal({ kind: "notice", notice: n })}>Open</SecondaryButton>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-brand-taupe">No notice yet. “Draft notice” fills a letter template with this case's violations and secure evidence links.</div>}
          {!c.contacts.some((x) => x.kind === "email") && <div className="mt-3"><Note tone={WARN}>No email contact for this seller: add one in Sellers before sending by email.</Note></div>}
        </Card>
        <Card title="Activity">
          <div className="space-y-3 text-xs relative pl-3.5 border-l border-brand-beige max-h-80 overflow-auto">
            {activity.map((a, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                <div className="font-bold">{a.title}</div>
                {a.detail && <div className="text-brand-taupe">{a.detail}</div>}
                {a.proof && <div className="text-emerald-700">Compliant price seen {formatWhen(a.proof)}</div>}
                <div className="text-[10px] text-brand-copper">{formatWhen(a.at)} · {a.by ?? "System"}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {latest && (
        <Card title={`Letter preview — ${latest.code} (${latest.status})`} className="mt-4">
          <div className="text-xs text-brand-taupe mb-2">To: {latest.recipients.join(", ") || "no address yet"} · Subject: {latest.subject}</div>
          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-brand-charcoal max-h-72 overflow-auto">{latest.body}</pre>
        </Card>
      )}

      {(c.ip_issue || reports.length > 0) && (
        <Card title="IP reports" className="mt-4" action={writable && <SecondaryButton onClick={() => setModal({ kind: "ipReport" })}>New report</SecondaryButton>}>
          {reports.length ? (
            <Table compact columns={["Report", "Channel", "Basis", "Status", "Reference", ""]}>
              {reports.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{r.code}</Td><Td>{r.channel_label}</Td><Td>{r.basis_label}</Td>
                  <Td><Pill text={r.status} tone={TONE[r.status]} /></Td><Td>{r.reference ?? "—"}</Td>
                  <Td>
                    <span className="flex gap-1.5 justify-end">
                      {can("cases.write") && <SecondaryButton onClick={() => run(() => api.downloadEvidencePack(client, r))}><Download className="w-3.5 h-3.5" /> Pack</SecondaryButton>}
                      {can("cases.write") && r.status === "Draft" && <SecondaryButton onClick={() => setModal({ kind: "file", report: r })}>Record filing</SecondaryButton>}
                      {can("cases.write") && ["Draft", "Filed"].includes(r.status) && <SecondaryButton onClick={() => setModal({ kind: "outcome", report: r })}>Outcome</SecondaryButton>}
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          ) : <div className="text-xs text-brand-taupe">No report yet. MAP Intel prepares the evidence pack; you file it on the marketplace and record the reference here.</div>}
        </Card>
      )}

      {modal?.kind === "notice" && <NoticeModal notice={modal.notice} caseClosed={c.closed} onClose={() => setModal(null)} onChanged={() => done()} />}
      {modal?.kind === "draft" && (
        <FormModal title={`Draft a notice — ${c.code}`} submitLabel="Draft" onClose={() => setModal(null)}
          fields={[{ name: "templateId", label: "Template", type: "select", options: templates.filter((t) => t.active).map((t) => [t.id, `${t.code} ${t.name} — ${t.used_for ?? ""}`]) }]}
          note="The letter lists every open violation in this case with a secure 90-day evidence link. You can edit the draft before sending it to the brand."
          onSubmit={(v) => run(() => api.draftNotice(client, c.id, { templateId: v.templateId }), "Notice drafted. Open it to check and send for approval.")} />
      )}
      {modal?.kind === "move" && (
        <MoveModal c={c} moves={moves} onClose={() => setModal(null)}
          onSubmit={(v) => run(() => api.moveCase(client, c.id, { state: v.state, reason: v.reason || undefined }), `${c.code} moved to ${v.state}.`)} />
      )}
      {modal?.kind === "assign" && <AssignModal c={c} onClose={() => setModal(null)} onSubmit={(body) => run(() => api.updateCase(client, c.id, body), "Saved.")} />}
      {modal?.kind === "ip" && (
        <FormModal title={`Mark ${c.code} as an IP issue`} submitLabel="Mark IP issue" onClose={() => setModal(null)}
          fields={[{ name: "reason", label: "Why this is an IP issue *", required: true, placeholder: "e.g. Counterfeit units reported by the brand; uses LG product photos" }]}
          note="Only for counterfeit, trademark or copyright misuse (or material differences after legal review). A price below MAP alone is never an IP report."
          onSubmit={(v) => run(() => api.updateCase(client, c.id, { ipIssue: true, ipReason: v.reason }), `${c.code} is now on the IP track.`)} />
      )}
      {modal?.kind === "log" && (
        <FormModal title={`Log a reply — ${c.code}`} submitLabel="Log" onClose={() => setModal(null)}
          fields={[
            { name: "kind", label: "What", type: "select", options: [["response", "Seller replied"], ["contest", "Seller contests the claim"], ["note", "Internal note"]] },
            { name: "channel", label: "Channel", type: "select", options: CHANNELS.map((x) => [x, x]) },
            { name: "summary", label: "Summary *", required: true, placeholder: "e.g. Will correct the price on Monday" },
            { name: "body", label: "Full text (optional)", type: "textarea" },
          ]}
          note="A contest moves a case waiting on the seller to Contested."
          onSubmit={(v) => run(() => api.logCommunication(client, c.id, { kind: v.kind, channel: v.channel, summary: v.summary, body: v.body || null }), "Logged.")} />
      )}
      {modal?.kind === "ipReport" && (
        <FormModal title={`New IP report — ${c.code}`} submitLabel="Draft report" onClose={() => setModal(null)}
          fields={[
            { name: "channel", label: "Marketplace channel", type: "select", options: IP_CHANNELS.filter(([, , prefix]) => (c.source_code ?? "").startsWith(prefix)).map(([v, l]) => [v, l]) },
            { name: "ipBasis", label: "Basis", type: "select", options: IP_BASES },
            { name: "reason", label: "Claim *", required: true, placeholder: "e.g. Box shows a serial number the brand never issued" },
          ]}
          note="MAP Intel never files reports: download the evidence pack, file on the marketplace yourself, then record the reference number."
          onSubmit={(v) => run(() => api.draftIpReport(client, c.id, v), "Report drafted.")} />
      )}
      {modal?.kind === "file" && (
        <FormModal title={`Record filing — ${modal.report.code}`} submitLabel="Save" onClose={() => setModal(null)}
          fields={[{ name: "reference", label: "Reference number from the marketplace *", required: true }]}
          onSubmit={(v) => run(() => api.fileIpReport(client, modal.report.id, { reference: v.reference }), "Filing recorded.")} />
      )}
      {modal?.kind === "outcome" && (
        <FormModal title={`Outcome — ${modal.report.code}`} submitLabel="Save" onClose={() => setModal(null)}
          fields={[
            { name: "status", label: "Outcome", type: "select", options: (modal.report.status === "Filed" ? ["Accepted", "Rejected", "Withdrawn"] : ["Withdrawn"]).map((x) => [x, x]) },
            { name: "note", label: "Note (needed for Rejected / Withdrawn)" },
          ]}
          onSubmit={(v) => run(() => api.ipReportOutcome(client, modal.report.id, { status: v.status, note: v.note || undefined }), "Saved.")} />
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

/** A notice: preview, and the actions its status and the viewer's rights allow. */
function NoticeModal({ notice, caseClosed, onClose, onChanged }) {
  const { client, can, showToast } = useWorkspace();
  const [n, setN] = useState(notice);
  const [mode, setMode] = useState(null); // 'edit' | 'reject' | 'send'
  const act = async (action, body, msg) => {
    const r = await attempt(showToast, () => api.noticeAction(client, n.id, action, body));
    if (r) {
      showToast(msg);
      onChanged();
    }
  };
  const writer = can("cases.write") && !caseClosed;
  const draft = n.status === "Draft";
  const canSend = writer && (n.status === "Approved" || (draft && !n.needs_approval));
  return (
    <Modal open onClose={onClose} title={`${n.code} — ${n.case_code} · ${n.seller}`} width="w-[44rem]">
      <div className="space-y-3">
        <div className="flex gap-2 items-center flex-wrap text-xs">
          <Pill text={n.status} tone={TONE[n.status]} />
          <span className="text-brand-taupe">{n.template_code} {n.template_name} v{n.template_version} · drafted {formatWhen(n.created_at)} by {n.created_by}</span>
          {n.decided_at && <span className="text-brand-taupe">· {n.status === "Rejected" ? "rejected" : "approved"} {formatWhen(n.decided_at)} by {n.decided_by}</span>}
          {n.sent_at && <span className="text-brand-taupe">· sent {formatWhen(n.sent_at)} by {n.sent_by}{n.delivery ? ` (${n.delivery})` : ""}</span>}
        </div>
        {n.decision_note && <Note tone={WARN}>Brand: “{n.decision_note}”</Note>}
        {mode === "edit" ? (
          <EditNotice notice={n} onCancel={() => setMode(null)} onSaved={(updated) => { setN(updated); setMode(null); showToast("Draft saved."); }} />
        ) : (
          <>
            <KV k="To" v={n.recipients.join(", ") || <span className="text-amber-700">No address — add the seller's email in Sellers, or send by another channel</span>} />
            <KV k="Subject" v={n.subject} />
            {n.policy_name && <KV k="Attach" v={`${n.policy_name} v${n.policy_version}`} />}
            <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed bg-brand-beige/20 border border-brand-beige rounded-lg p-3 max-h-80 overflow-auto">{n.body}</pre>
          </>
        )}
        {mode === "reject" && (
          <FormInline label="Why it is rejected (the analyst sees this) *" submitLabel="Reject" onCancel={() => setMode(null)}
            onSubmit={(note) => act("reject", { note }, `${n.code} rejected.`)} />
        )}
        {mode === "send" && (
          <SendInline notice={n} onCancel={() => setMode(null)} onSubmit={(channel) => act("send", { channel }, `${n.code} recorded as sent. The case's violations are under notice.`)} />
        )}
        {mode === null && (
          <div className="flex justify-between gap-2 border-t border-brand-beige pt-3 flex-wrap">
            <SecondaryButton onClick={() => attempt(showToast, () => api.downloadNotice(client, n))}><Download className="w-4 h-4" /> Download letter</SecondaryButton>
            <div className="flex gap-2 flex-wrap justify-end">
              {writer && ["Draft", "Awaiting approval", "Approved"].includes(n.status) && <SecondaryButton onClick={() => act("cancel", {}, `${n.code} cancelled.`)}><X className="w-4 h-4" /> Cancel notice</SecondaryButton>}
              {writer && draft && <SecondaryButton onClick={() => setMode("edit")}><Pencil className="w-4 h-4" /> Edit</SecondaryButton>}
              {writer && draft && n.needs_approval && <PrimaryButton onClick={() => act("submit", {}, `${n.code} sent to the brand for approval.`)}><Send className="w-4 h-4" /> Send for approval</PrimaryButton>}
              {can("notices.approve") && n.status === "Awaiting approval" && <>
                <SecondaryButton onClick={() => setMode("reject")}><Ban className="w-4 h-4" /> Reject</SecondaryButton>
                <PrimaryButton onClick={() => act("approve", {}, `${n.code} approved.`)}><Check className="w-4 h-4" /> Approve</PrimaryButton>
              </>}
              {canSend && <PrimaryButton onClick={() => setMode("send")}><Send className="w-4 h-4" /> Record as sent</PrimaryButton>}
            </div>
          </div>
        )}
        {n.status === "Awaiting approval" && !can("notices.approve") && <Note>Waiting for a Brand user to approve or reject it.</Note>}
      </div>
    </Modal>
  );
}

function EditNotice({ notice, onCancel, onSaved }) {
  const { client, showToast } = useWorkspace();
  const [to, setTo] = useState(notice.recipients.join(", "));
  const [subject, setSubject] = useState(notice.subject);
  const [body, setBody] = useState(notice.body);
  const save = async () => {
    const r = await attempt(showToast, () => api.editNotice(client, notice.id, { recipients: to.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean), subject, body }));
    if (r) onSaved(r);
  };
  return (
    <div className="space-y-3">
      <Field label="To (emails, comma-separated)"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Letter"><textarea rows={14} className={textareaCls} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={save}>Save draft</PrimaryButton></div>
    </div>
  );
}

function FormInline({ label, submitLabel, onCancel, onSubmit }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-2 border-t border-brand-beige pt-3">
      <Field label={label}><input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
      <div className="flex justify-end gap-2"><SecondaryButton onClick={onCancel}>Back</SecondaryButton><PrimaryButton onClick={() => onSubmit(v.trim())} disabled={!v.trim()}>{submitLabel}</PrimaryButton></div>
    </div>
  );
}

function SendInline({ notice, onCancel, onSubmit }) {
  const [channel, setChannel] = useState(notice.recipients.length ? "email" : "marketplace message");
  return (
    <div className="space-y-2 border-t border-brand-beige pt-3">
      <Field label="How it was sent">
        <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((x) => <option key={x}>{x}</option>)}</select>
      </Field>
      <Note>MAP Intel does not email sellers yet: download the letter, send it yourself, then record it here. Recording it logs the notice, moves an open case to Notice sent and puts its violations Under notice.</Note>
      <div className="flex justify-end gap-2"><SecondaryButton onClick={onCancel}>Back</SecondaryButton><PrimaryButton onClick={() => onSubmit(channel)}>Record as sent</PrimaryButton></div>
    </div>
  );
}

function MoveModal({ c, moves, onClose, onSubmit }) {
  const [state, setState] = useState(moves[0]);
  const [reason, setReason] = useState("");
  const needs = NEEDS_REASON.includes(state);
  return (
    <Modal open onClose={onClose} title={`Move ${c.code} (now ${c.state})`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ state, reason: reason.trim() }); }}>
        <Field label="To"><select className={inputCls} value={state} onChange={(e) => setState(e.target.value)}>{moves.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label={`Reason${needs ? " *" : ""}`}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required={needs} /></Field>
        {MOVE_HINT[state] && <Note>{MOVE_HINT[state]}</Note>}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Move</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function AssignModal({ c, onClose, onSubmit }) {
  const { client, can, showToast } = useWorkspace();
  const [people, setPeople] = useState([]);
  const [owner, setOwner] = useState(c.owner ?? "");
  const [due, setDue] = useState(c.response_due ?? "");
  useEffect(() => {
    if (can("users.read")) attempt(showToast, () => api.users(client)).then((r) => r && setPeople((r.members ?? []).filter((m) => m.role !== "Brand user" && m.status === "Active")));
  }, [client, can, showToast]);
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ owner: owner || null, responseDue: due || null });
  };
  return (
    <Modal open onClose={onClose} title={`Owner & response date — ${c.code}`}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Owner">
          <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({p.role})</option>)}
          </select>
        </Field>
        <Field label="Response due"><input type="date" min={today()} className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Save</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function TemplateModal({ template, onClose, onSaved }) {
  const { client, can, showToast } = useWorkspace();
  const editable = can("settings.write");
  const [v, setV] = useState({ name: template.name, usedFor: template.used_for ?? "", subject: template.subject, body: template.body, attachesPolicy: template.attaches_policy, active: template.active });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.updateNoticeTemplate(client, template.id, { ...v, usedFor: v.usedFor || null }));
    if (r) {
      showToast(`${template.code} saved (v${r.version}). Notices already drafted keep their text.`);
      onSaved();
    }
  };
  return (
    <Modal open onClose={onClose} title={`${template.code} ${template.name} (v${template.version})`} width="w-[44rem]">
      <form className="space-y-3" onSubmit={save}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={v.name} onChange={set("name")} disabled={!editable} /></Field>
          <Field label="Used for"><input className={inputCls} value={v.usedFor} onChange={set("usedFor")} disabled={!editable} /></Field>
        </div>
        <Field label="Subject"><input className={inputCls} value={v.subject} onChange={set("subject")} disabled={!editable} /></Field>
        <Field label="Letter"><textarea rows={14} className={textareaCls} value={v.body} onChange={set("body")} disabled={!editable} /></Field>
        <div className="text-[11px] text-brand-taupe">Placeholders: {PLACEHOLDERS}</div>
        <div className="flex gap-4 text-xs">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={v.attachesPolicy} onChange={set("attachesPolicy")} disabled={!editable} />Attach the MAP policy in force</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={v.active} onChange={set("active")} disabled={!editable} />Active</label>
        </div>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>{editable ? "Cancel" : "Close"}</SecondaryButton>
          {editable && <PrimaryButton type="submit">Save</PrimaryButton>}
        </div>
      </form>
    </Modal>
  );
}

/** A small form: fields of type text (default), select ([value, label] options) or textarea. */
function FormModal({ title, fields, note, submitLabel, onClose, onSubmit }) {
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    onSubmit(Object.fromEntries(fields.map((x) => [x.name, String(f.get(x.name) ?? "").trim()])));
  };
  return (
    <Modal open onClose={onClose} title={title} width="w-[34rem]">
      <form className="space-y-3" onSubmit={submit}>
        {fields.map((x) => (
          <Field key={x.name} label={x.label}>
            {x.type === "select"
              ? <select name={x.name} className={inputCls}>{x.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              : x.type === "textarea"
                ? <textarea name={x.name} rows={5} className={textareaCls} />
                : <input name={x.name} required={x.required} placeholder={x.placeholder} className={inputCls} />}
          </Field>
        ))}
        {note && <Note>{note}</Note>}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">{submitLabel}</PrimaryButton></div>
      </form>
    </Modal>
  );
}
