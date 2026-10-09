// Internal tickets (P5 · M4): Mirethos's own tracker for operational issues, separate from
// enforcement cases. Platform administrators only; brands never see these. Tickets open by hand or
// automatically (a source failing or blocked for an account, a Mapping Center backlog) and the
// automatic ones resolve themselves when the issue is gone.
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Drawer, Field, inputCls, KPI, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton, Table, Tabs, Td } from "../ui.jsx";
import { attempt, formatWhen } from "../workspace.js";

const KIND = { source: "Source", mapping: "Mapping", data_quality: "Data quality", onboarding: "Onboarding", other: "Other" };
const PRIORITY_TONE = {
  Urgent: "bg-red-50 text-red-700 border-red-200",
  High: "bg-orange-50 text-orange-700 border-orange-200",
  Normal: "bg-slate-50 text-slate-700 border-slate-200",
  Low: "bg-slate-50 text-slate-500 border-slate-200",
};
const STATUS_TONE = {
  Open: "bg-amber-50 text-amber-700 border-amber-200",
  "In progress": "bg-sky-50 text-sky-700 border-sky-200",
  Waiting: "bg-violet-50 text-violet-700 border-violet-200",
  Resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const STATUSES = ["Open", "In progress", "Waiting", "Resolved"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

function eventText(e, assignees) {
  const name = (id) => assignees.find((a) => a.id === id)?.name || (id ? "someone" : "nobody");
  switch (e.kind) {
    case "opened": return e.body || "Opened the ticket";
    case "comment": return e.body;
    case "auto": return e.body;
    case "status": return `Status ${e.before?.status} → ${e.after?.status}`;
    case "priority": return `Priority ${e.before?.priority} → ${e.after?.priority}`;
    case "assignee": return `Assigned to ${name(e.after?.assignee)}`;
    default: return e.kind;
  }
}

function NewTicketModal({ open, onClose, onCreated, accounts, sources, assignees, showToast }) {
  const [f, setF] = useState({ title: "", kind: "other", priority: "Normal", accountId: "", sourceId: "", assigneeId: "", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  if (!open) return null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const t = await attempt(showToast, () => api.createTicket({
      title: f.title, kind: f.kind, priority: f.priority, description: f.description || undefined,
      accountId: f.accountId || null, sourceId: f.sourceId || null, assigneeId: f.assigneeId || null,
    }));
    setBusy(false);
    if (t) onCreated(t);
  };
  return (
    <Modal open onClose={onClose} title="New ticket" width="w-[34rem]">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title"><input required minLength={3} maxLength={200} value={f.title} onChange={set("title")} className={inputCls} placeholder="What needs doing" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select value={f.kind} onChange={set("kind")} className={inputCls}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Priority">
            <select value={f.priority} onChange={set("priority")} className={inputCls}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="Account (optional)">
            <select value={f.accountId} onChange={set("accountId")} className={inputCls}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
          <Field label="Source (optional)">
            <select value={f.sourceId} onChange={set("sourceId")} className={inputCls}><option value="">—</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
          <Field label="Assignee">
            <select value={f.assigneeId} onChange={set("assigneeId")} className={inputCls}><option value="">Unassigned</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
        </div>
        <Field label="Description"><textarea rows={4} value={f.description} onChange={set("description")} className={`${inputCls} h-auto py-2`} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Open ticket</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TicketDrawer({ ticketId, onClose, onChanged, assignees, showToast }) {
  const [t, setT] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setT(await api.ticket(ticketId)), [ticketId]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const save = async (patch) => {
    setBusy(true);
    const r = await attempt(showToast, () => api.updateTicket(ticketId, patch));
    setBusy(false);
    if (r) { setT(r); setNote(""); onChanged(); }
  };

  return (
    <Drawer open onClose={onClose} eyebrow={t ? `${t.code} · ${KIND[t.kind]}${t.origin === "auto" ? " · opened automatically" : ""}` : "Ticket"} title={t?.title || "Loading…"} width="w-[720px]">
      {!t ? <Loader2 className="w-4 h-4 animate-spin text-brand-taupe" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Status">
              <select value={t.status} disabled={busy} onChange={(e) => save({ status: e.target.value })} className={inputCls}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Priority">
              <select value={t.priority} disabled={busy} onChange={(e) => save({ priority: e.target.value })} className={inputCls}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
            </Field>
            <Field label="Assignee">
              <select value={t.assignee_id || ""} disabled={busy} onChange={(e) => save({ assigneeId: e.target.value || null })} className={inputCls}>
                <option value="">Unassigned</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="text-[13px] grid grid-cols-2 gap-x-6 gap-y-1">
            <div><span className="text-brand-taupe">Account </span>{t.account || "—"}</div>
            <div><span className="text-brand-taupe">Source </span>{t.source || "—"}</div>
            <div><span className="text-brand-taupe">Opened </span>{formatWhen(t.created_at)}{t.created_by ? ` by ${t.created_by}` : ""}</div>
            <div><span className="text-brand-taupe">Resolved </span>{t.resolved_at ? formatWhen(t.resolved_at) : "—"}</div>
          </div>
          {t.description && <p className="text-[13px] whitespace-pre-wrap bg-brand-white border border-brand-beige rounded-lg p-3">{t.description}</p>}
          {t.origin === "auto" && t.status !== "Resolved" && (
            <Note>This ticket resolves itself when the issue is gone. If you resolve it while the issue is still there, the next hourly check opens a new one: use Waiting instead.</Note>
          )}

          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-brand-taupe mb-2">History</div>
            <ol className="space-y-2">
              {t.events.map((e) => (
                <li key={e.id} className="text-[13px] flex gap-3">
                  <span className="text-brand-taupe tabular-nums shrink-0 w-28">{formatWhen(e.created_at)}</span>
                  <span className="min-w-0"><span className="font-medium">{e.actor}</span>: <span className={e.kind === "comment" ? "whitespace-pre-wrap" : "text-ink-2"}>{eventText(e, assignees)}</span></span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className={`${inputCls} h-auto py-2`} />
            <div className="flex justify-end"><PrimaryButton onClick={() => save({ note })} disabled={busy || !note.trim()}>Add note</PrimaryButton></div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function TicketsView({ accounts, showToast }) {
  const [filter, setFilter] = useState("active");
  const [kind, setKind] = useState("");
  const [data, setData] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [sources, setSources] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const q = filter === "mine" ? { status: "active", assignee: "me" } : filter === "unassigned" ? { status: "active", assignee: "none" } : { status: filter === "all" ? undefined : filter };
    setData(await api.tickets({ ...q, kind: kind || undefined }));
  }, [filter, kind]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  useEffect(() => {
    attempt(showToast, async () => {
      const [a, s] = await Promise.all([api.ticketAssignees(), api.sourceList()]);
      setAssignees(a);
      setSources(s.filter((x) => x.active));
    });
  }, [showToast]);

  const c = data?.counts ?? {};
  const active = (c.Open ?? 0) + (c["In progress"] ?? 0) + (c.Waiting ?? 0);
  return (
    <div>
      <PageHeader
        title="Tickets"
        subtitle="Mirethos's own operational work, separate from enforcement cases. Brands never see these. Failing or blocked sources and Mapping Center backlogs open tickets on their own every hour."
        action={<>
          <SecondaryButton onClick={() => attempt(showToast, load)}><RefreshCw className="w-4 h-4" /> Refresh</SecondaryButton>
          <PrimaryButton onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New ticket</PrimaryButton>
        </>}
      />
      <div className="flex gap-3 flex-wrap mb-5">
        <KPI label="Open" value={c.Open ?? 0} />
        <KPI label="In progress" value={c["In progress"] ?? 0} />
        <KPI label="Waiting" value={c.Waiting ?? 0} />
        <KPI label="Resolved" value={c.Resolved ?? 0} />
      </div>
      <Tabs
        tabs={[{ id: "active", label: "Active", count: active }, { id: "mine", label: "Mine" }, { id: "unassigned", label: "Unassigned" }, { id: "Resolved", label: "Resolved" }, { id: "all", label: "All" }]}
        value={filter}
        onChange={setFilter}
        right={<select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputCls} w-44`}><option value="">All kinds</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
      />
      {!data ? <div className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading tickets…</div> : (
        data.tickets.length === 0 ? <Note>No tickets here.</Note> : (
          <Table columns={["Ticket", "Title", "Kind", "Priority", "Status", "Account", "Assignee", "Updated"]}>
            {data.tickets.map((t) => (
              <tr key={t.id} onClick={() => setOpenId(t.id)} className="hover:bg-surface-2 cursor-pointer">
                <Td className="font-mono text-xs">{t.code}</Td>
                <Td>
                  <div className="font-medium">{t.title}</div>
                  {t.origin === "auto" && <div className="text-[11px] text-brand-taupe">opened automatically{t.source ? ` · ${t.source}` : ""}</div>}
                </Td>
                <Td className="text-brand-taupe">{KIND[t.kind]}</Td>
                <Td><Pill text={t.priority} tone={PRIORITY_TONE[t.priority]} /></Td>
                <Td><Pill text={t.status} tone={STATUS_TONE[t.status]} /></Td>
                <Td>{t.account || "—"}</Td>
                <Td>{t.assignee || <span className="text-brand-taupe">Unassigned</span>}</Td>
                <Td className="text-brand-taupe tabular-nums">{formatWhen(t.updated_at)}</Td>
              </tr>
            ))}
          </Table>
        )
      )}
      <NewTicketModal key={creating ? "open" : "closed"} open={creating} onClose={() => setCreating(false)} accounts={accounts} sources={sources} assignees={assignees} showToast={showToast}
        onCreated={(t) => { setCreating(false); showToast(`${t.code} opened.`, "success"); attempt(showToast, load); setOpenId(t.id); }} />
      {openId && <TicketDrawer key={openId} ticketId={openId} onClose={() => setOpenId(null)} onChanged={() => attempt(showToast, load)} assignees={assignees} showToast={showToast} />}
    </div>
  );
}
