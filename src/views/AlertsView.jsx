// Alerts (docs/reference/prototype-src/views_admin.jsx AlertsView): the inbox (one alert per change,
// not one per crawl) and the alert rules: on / off, recipients, and the severity or look-ahead.
import React, { useCallback, useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { api } from "../api/client.js";
import { Field, inputCls, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton, Table, Tabs, Td, Toggle, Card } from "../ui.jsx";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";
import { ViolationDrawer } from "./ViolationsView.jsx";

const LEVEL_TONE = {
  Severe: "bg-red-50 text-red-700 border-red-200",
  Standard: "bg-orange-50 text-orange-700 border-orange-200",
  Health: "bg-amber-50 text-amber-700 border-amber-200",
  Info: "bg-slate-50 text-slate-700 border-slate-200",
};
const TRIGGER = {
  new_violating_seller: () => "A seller violates MAP for the first time",
  severe_violation: (c) => `A violation reaches ${c.severity ?? "Severe"} depth`,
  source_degraded_before_report: (c) => `A source is not healthy within ${c.hoursBefore ?? 24} h of a scheduled report`,
  notice_awaiting_approval: () => "A notice is waiting for the brand's approval",
  response_overdue: () => "A case's response date passes with no reply from the seller",
  seller_reoffended: (c) => `A seller breaks MAP again within ${c.days ?? 60} days of a resolved case`,
  case_resolved: () => "A case is resolved (re-checked compliant or closed by a person)",
};

export function AlertsView({ onUnreadChange }) {
  const { client, can, showToast } = useWorkspace();
  const [tab, setTab] = useState("inbox");
  const [inbox, setInbox] = useState({ unread: 0, events: [] });
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);
  const [violation, setViolation] = useState(null);
  const writable = can("alerts.write");

  const load = useCallback(async () => {
    const i = (await attempt(showToast, () => api.alertEvents(client))) ?? { unread: 0, events: [] };
    setInbox(i);
    onUnreadChange?.(i.unread);
    setRules((await attempt(showToast, () => api.alertRules(client))) ?? []);
  }, [client, showToast, onUnreadChange]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const markRead = async (body) => { if (await attempt(showToast, () => api.markAlertsRead(client, body))) load(); };
  const open = (e) => {
    if (!e.read_at) markRead({ ids: [e.id] });
    if (e.violation_id && can("violations.read")) setViolation(e.violation_id);
  };
  const toggle = async (r, active) => { if (await attempt(showToast, () => api.updateAlertRule(client, r.id, { active }))) load(); };

  return (
    <div>
      <PageHeader title={`Alerts — ${client.name} (${client.status})`} subtitle="Deduplicated: one alert per change, not one per crawl."
        action={tab === "inbox" && inbox.unread > 0 && <SecondaryButton onClick={() => markRead({ all: true })}><CheckCheck className="w-4 h-4" /> Mark all read</SecondaryButton>} />
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "inbox", label: "Inbox", count: inbox.unread }, { id: "rules", label: "Alert rules", count: rules.length }]} />
        {tab === "inbox" && (inbox.events.length ? (
          <div className="divide-y divide-brand-beige">
            {inbox.events.map((e) => (
              <button key={e.id} onClick={() => open(e)} className={`w-full text-left py-3 flex items-start gap-3 cursor-pointer hover:bg-brand-beige/20 ${e.read_at ? "opacity-70" : ""}`}>
                <Pill text={e.level} tone={LEVEL_TONE[e.level]} />
                <div className="flex-1 text-sm text-brand-charcoal">
                  <div className={e.read_at ? "" : "font-semibold"}>{e.title}</div>
                  <div className="text-xs text-brand-taupe mt-0.5">{e.body}</div>
                </div>
                <div className="text-xs text-brand-taupe whitespace-nowrap text-right">{formatWhen(e.created_at)}<div className="text-[10px]">{e.rule_code}</div></div>
              </button>
            ))}
          </div>
        ) : <div className="text-sm text-brand-taupe py-6 text-center">No alerts yet. They are raised after every collection run.</div>)}
        {tab === "rules" && (
          <>
            <Table columns={["Alert", "Trigger", "Channel", "Recipients", "Alerts (30d)", "On"]}>
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{writable ? <button className="text-left hover:underline cursor-pointer" onClick={() => setEditing(r)}><span className="text-brand-copper mr-2">{r.code}</span>{r.name}</button> : <><span className="text-brand-copper mr-2">{r.code}</span>{r.name}</>}</Td>
                  <Td className="text-brand-taupe">{TRIGGER[r.trigger]?.(r.config) ?? r.trigger}</Td>
                  <Td className="text-brand-taupe">{r.email && r.recipients.length ? "Email + Inbox" : "Inbox"}</Td>
                  <Td className="text-brand-taupe">{r.recipients.join(", ") || "—"}</Td>
                  <Td className="tabular-nums">{r.events_30d}</Td>
                  <Td><Toggle on={r.active} onChange={(v) => toggle(r, v)} disabled={!writable} /></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3"><Note>Emails are logged, not sent, until an email provider is set up. Every alert also lands in this inbox.</Note></div>
          </>
        )}
      </Card>
      {editing && <RuleModal rule={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {violation && <ViolationDrawer violationId={violation} onClose={() => setViolation(null)} />}
    </div>
  );
}

function RuleModal({ rule, onClose, onSaved }) {
  const { client, showToast } = useWorkspace();
  const [recipients, setRecipients] = useState(rule.recipients.join(", "));
  const [email, setEmail] = useState(rule.email);
  const [severity, setSeverity] = useState(rule.config.severity ?? "Severe");
  const [hours, setHours] = useState(rule.config.hoursBefore ?? 24);
  const [days, setDays] = useState(rule.config.days ?? 60);
  const save = async (e) => {
    e.preventDefault();
    const body = { email, recipients: recipients.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) };
    if (rule.trigger === "severe_violation") body.severity = severity;
    if (rule.trigger === "source_degraded_before_report") body.hoursBefore = Number(hours);
    if (rule.trigger === "seller_reoffended") body.days = Number(days);
    if (await attempt(showToast, () => api.updateAlertRule(client, rule.id, body))) { showToast(`${rule.code} saved.`); onSaved(); }
  };
  return (
    <Modal open onClose={onClose} title={`${rule.code} · ${rule.name}`}>
      <form className="space-y-4" onSubmit={save}>
        {rule.trigger === "severe_violation" && (
          <Field label="Alert when a violation reaches">
            <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}><option>Severe</option><option>Standard</option></select>
          </Field>
        )}
        {rule.trigger === "source_degraded_before_report" && (
          <Field label="Hours before a scheduled report"><input type="number" min="1" max="168" className={inputCls} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        )}
        {rule.trigger === "seller_reoffended" && (
          <Field label="Days after a resolved case"><input type="number" min="1" max="365" className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        )}
        <Field label="Recipients (emails, comma-separated)"><input className={inputCls} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="map-room@brand.com" /></Field>
        <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />Email the recipients (logged until a provider is set up)</label>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit">Save</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
