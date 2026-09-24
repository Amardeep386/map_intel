// Settings, Users & Access and Audit Log (docs/reference/prototype-src/views_admin.jsx).
import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Field, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Td, Toggle, inputCls } from "../ui.jsx";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const ACTIVE_TONE = "bg-emerald-50 text-emerald-700 border-emerald-200";
const MUTED_TONE = "bg-slate-50 text-slate-700 border-slate-200";

// ============ SETTINGS ============
export function SettingsView() {
  const { client, can, showToast } = useWorkspace();
  const canEdit = can("settings.write");
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    attempt(showToast, async () => {
      const s = await api.settings(client);
      setForm(s);
      setSaved(s);
    });
  }, [client, showToast]);

  if (!form) return <PageHeader title={`Settings — ${client.name} (${client.status})`} />;
  const set = (k, v) => setForm({ ...form, [k]: v });
  const setS = (k, v) => setForm({ ...form, settings: { ...form.settings, [k]: v } });
  const num = (v) => (v === "" ? "" : Number(v));

  const save = async () => {
    const body = {
      name: form.name,
      regions: String(form.regions).split(",").map((r) => r.trim().toUpperCase()).filter(Boolean),
      currency: form.currency.trim().toUpperCase(),
      timezone: form.timezone.trim(),
      contractFrom: form.contractFrom || null,
      contractTo: form.contractTo || null,
      seats: form.seats === "" || form.seats === null ? null : Number(form.seats),
      settings: Object.fromEntries(Object.entries(form.settings).map(([k, v]) => [k, typeof saved.settings[k] === "number" ? Number(v) : v])),
    };
    const r = await attempt(showToast, () => api.updateSettings(client, body));
    if (r) {
      setForm(r);
      setSaved(r);
      showToast("Settings saved. Change recorded in audit log.");
    }
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const s = form.settings;
  const review = Number(s.matchReview) || 0;
  const include = Number(s.matchInclude) || 0;

  return (
    <div>
      <PageHeader
        title={`Settings — ${client.name} (${client.status})`}
        subtitle="Account process lives here as data — not in a wiki page or someone's laptop."
        action={canEdit && <PrimaryButton onClick={save} disabled={!dirty}><Check className="w-4 h-4" /> Save changes</PrimaryButton>}
      />
      <fieldset disabled={!canEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Account">
          <div className="space-y-3 text-sm">
            <Field label="Account name"><input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Regions in scope (country codes)"><input className={inputCls} value={Array.isArray(form.regions) ? form.regions.join(", ") : form.regions} onChange={(e) => set("regions", e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Currency"><input className={inputCls} value={form.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
                <Field label="Timezone"><input className={inputCls} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Contract from"><input type="date" className={inputCls} value={form.contractFrom ?? ""} onChange={(e) => set("contractFrom", e.target.value)} /></Field>
              <Field label="Contract to"><input type="date" className={inputCls} value={form.contractTo ?? ""} onChange={(e) => set("contractTo", e.target.value)} /></Field>
              <Field label="Seats"><input type="number" min="1" className={inputCls} value={form.seats ?? ""} onChange={(e) => set("seats", num(e.target.value))} /></Field>
            </div>
          </div>
        </Card>
        <Card title="Violation defaults">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <Field label="MAP tolerance (%)"><input type="number" step="0.1" min="0" className={inputCls} value={s.mapTolerancePct} onChange={(e) => setS("mapTolerancePct", num(e.target.value))} /></Field>
              <Field label="Min. depth ($)"><input type="number" step="0.01" min="0" className={inputCls} value={s.minDepth} onChange={(e) => setS("minDepth", num(e.target.value))} /></Field>
              <Field label="Grace window (h)"><input type="number" min="0" className={inputCls} value={s.graceHours} onChange={(e) => setS("graceHours", num(e.target.value))} /></Field>
            </div>
            <div className="flex justify-between items-center"><span className="text-xs text-brand-taupe">Brand approval required before notices</span><Toggle on={s.brandApprovalRequired} disabled={!canEdit} onChange={(v) => setS("brandApprovalRequired", v)} /></div>
            <div className="flex justify-between items-center"><span className="text-xs text-brand-taupe">Brand users can see Needs-review items</span><Toggle on={s.brandUsersSeeNeedsReview} disabled={!canEdit} onChange={(v) => setS("brandUsersSeeNeedsReview", v)} /></div>
          </div>
        </Card>
        <Card title="Match confidence thresholds">
          <div className="space-y-3 text-xs">
            <div className="h-3 rounded-full overflow-hidden flex">
              <div className="bg-red-300" style={{ width: `${review}%` }} />
              <div className="bg-amber-300" style={{ width: `${Math.max(include - review, 0)}%` }} />
              <div className="bg-emerald-400" style={{ width: `${Math.max(100 - include, 0)}%` }} />
            </div>
            <div className="flex justify-between text-brand-taupe"><span>0</span><span>Auto-exclude &lt; {review}</span><span>Review {review}–{include - 1}</span><span>Auto-include ≥ {include}</span><span>100</span></div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Review from"><input type="number" min="0" max="99" className={inputCls} value={s.matchReview} onChange={(e) => setS("matchReview", num(e.target.value))} /></Field>
              <Field label="Auto-include from"><input type="number" min="1" max="100" className={inputCls} value={s.matchInclude} onChange={(e) => setS("matchInclude", num(e.target.value))} /></Field>
              <Field label="QA sample (%)"><input type="number" min="0" max="100" className={inputCls} value={s.qaSamplePct} onChange={(e) => setS("qaSamplePct", num(e.target.value))} /></Field>
            </div>
          </div>
        </Card>
        <Card title="Collection budget">
          <div className="space-y-3 text-xs">
            <Field label="Requests per collection cycle"><input type="number" min="100" step="100" className={inputCls} value={s.requestBudget} onChange={(e) => setS("requestBudget", num(e.target.value))} /></Field>
            <Note>The subscription matrix on Sources & Terms shows the projected requests against this budget.</Note>
          </div>
        </Card>
      </fieldset>
      {can("credentials.read") && <CredentialsCard />}
    </div>
  );
}

const KINDS = { source_login: "Source login", sftp: "SFTP", slack: "Slack", smtp: "SMTP", api_key: "API key" };

function CredentialsCard() {
  const { client, can, showToast } = useWorkspace();
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => attempt(showToast, async () => setList((await api.credentials(client)) ?? [])), [client, showToast]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Card title="Delivery & source credentials (vault)" className="mt-4" action={can("credentials.write") && <SecondaryButton onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add</SecondaryButton>}>
      {list.length === 0 ? (
        <Note>No credentials stored. SFTP, Slack and source logins are encrypted at rest and never shown again after saving.</Note>
      ) : (
        <div className="space-y-2.5 text-xs">
          {list.map((c) => (
            <KV key={c.id} k={`${KINDS[c.kind]} · ${c.label}`} v={<span className="inline-flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" />{c.username ? `${c.username} · ` : ""}{c.hint} · vaulted{c.rotatedAt ? ` · rotated ${formatWhen(c.rotatedAt)}` : ""}</span>} />
          ))}
        </div>
      )}
      {adding && <CredentialModal onClose={() => setAdding(false)} onDone={load} />}
    </Card>
  );
}

function CredentialModal({ onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [form, setForm] = useState({ kind: "sftp", label: "", username: "", secret: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.addCredential(client, { ...form, username: form.username || undefined }));
    if (r) {
      showToast(`Stored "${r.label}". The secret is encrypted and will not be shown again.`);
      onClose();
      await onDone();
    }
  };
  return (
    <Modal open onClose={onClose} title="Add credential">
      <form className="space-y-4" onSubmit={save}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className={inputCls} value={form.kind} onChange={set("kind")}>
              {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Label"><input className={inputCls} value={form.label} onChange={set("label")} required placeholder="Brand SFTP" /></Field>
        </div>
        <Field label="Username (optional)"><input className={inputCls} value={form.username} onChange={set("username")} autoComplete="off" /></Field>
        <Field label="Secret (password, token or key)"><input type="password" className={inputCls} value={form.secret} onChange={set("secret")} required autoComplete="new-password" /></Field>
        <Note>Encrypted before it is stored. Nobody, including administrators, can read it back in the portal.</Note>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit">Store credential</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ============ USERS ============
const ROLE_CAN = {
  Administrator: "Everything, including users and credentials",
  "Account manager": "Configure sources, terms, schedules, settings, users",
  Analyst: "Edit terms and catalogue; read everything else",
  "Brand user": "Own account: catalogue and prices (read)",
};

export function UsersView() {
  const { client, can, showToast } = useWorkspace();
  const canManage = can("users.manage");
  const [data, setData] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState(null);
  const load = useCallback(() => attempt(showToast, async () => setData(await api.users(client))), [client, showToast]);
  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (m, role) => {
    if (await attempt(showToast, () => api.changeUserRole(client, m.userId, role))) {
      showToast(`${m.email} is now ${role}.`);
      await load();
    }
  };
  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.email} from ${client.name}?`)) return;
    if ((await attempt(showToast, async () => (await api.removeUser(client, m.userId)) ?? true)) !== undefined) {
      showToast(`Removed ${m.email}.`);
      await load();
    }
  };
  const revoke = async (i) => {
    if ((await attempt(showToast, async () => (await api.revokeInvite(client, i.id)) ?? true)) !== undefined) await load();
  };

  return (
    <div>
      <PageHeader title={`Users & Access — ${client.name} (${client.status})`} action={canManage && <PrimaryButton onClick={() => setInviting(true)}><Plus className="w-4 h-4" /> Invite user</PrimaryButton>} />
      <Card>
        <Table columns={["User", "Role", "Can", "Last active", "Status", ""]}>
          {(data?.members ?? []).map((m) => (
            <tr key={m.userId}>
              <Td className="font-semibold">{m.name}<div className="text-[11px] text-brand-taupe font-normal">{m.email}</div></Td>
              <Td>
                {canManage && data.grantableRoles.includes(m.role) ? (
                  <select className={`${inputCls} w-40`} value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    {data.grantableRoles.map((r) => <option key={r}>{r}</option>)}
                  </select>
                ) : (
                  m.role
                )}
              </Td>
              <Td className="text-brand-taupe">{ROLE_CAN[m.role]}</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{m.lastLoginAt ? formatWhen(m.lastLoginAt) : "Never"}</Td>
              <Td><Pill text={m.status} tone={m.status === "Active" ? ACTIVE_TONE : MUTED_TONE} /></Td>
              <Td>
                {canManage && data.grantableRoles.includes(m.role) && (
                  <button onClick={() => remove(m)} className="text-brand-taupe hover:text-red-600 cursor-pointer" title="Remove from account"><Trash2 className="w-4 h-4" /></button>
                )}
              </Td>
            </tr>
          ))}
          {(data?.invites ?? []).map((i) => (
            <tr key={i.id} className="opacity-80">
              <Td className="font-semibold">{i.name}<div className="text-[11px] text-brand-taupe font-normal">{i.email}</div></Td>
              <Td>{i.role}</Td>
              <Td className="text-brand-taupe">{ROLE_CAN[i.role]}</Td>
              <Td className="text-brand-taupe whitespace-nowrap">Invite expires {formatWhen(i.expiresAt)}</Td>
              <Td><Pill text="Invited" tone="bg-blue-50 text-blue-700 border-blue-200" /></Td>
              <Td>{canManage && <button onClick={() => revoke(i)} className="text-xs text-brand-copper hover:underline cursor-pointer">Revoke</button>}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3"><Note>Brand users only ever see their own account. Mirethos administrators can open every account; that access is logged.</Note></div>
      </Card>
      {inviting && (
        <InviteModal grantable={data?.grantableRoles ?? []} onClose={() => setInviting(false)} onDone={async (r) => { setInviting(false); if (r.inviteUrl) setLink(r); await load(); }} />
      )}
      {link && (
        <Modal open onClose={() => setLink(null)} title="Invite link" width="w-[34rem]">
          <div className="space-y-3">
            <p className="text-sm text-brand-charcoal">Send this link to the new user. It works once and expires {formatWhen(link.expiresAt)}.</p>
            <div className="flex gap-2">
              <input readOnly className={`${inputCls} font-mono text-xs`} value={link.inviteUrl} onFocus={(e) => e.target.select()} />
              <SecondaryButton onClick={() => { navigator.clipboard?.writeText(link.inviteUrl); showToast("Link copied."); }}><Copy className="w-4 h-4" /> Copy</SecondaryButton>
            </div>
            <Note>Email delivery of invites arrives with Phase 3.</Note>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InviteModal({ grantable, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [form, setForm] = useState({ name: "", email: "", role: grantable.includes("Analyst") ? "Analyst" : grantable[0] });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.inviteUser(client, form));
    if (r) {
      showToast(r.status === "added" ? `${form.email} already had an account and was added as ${form.role}.` : `Invited ${form.email}.`);
      await onDone(r);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Invite to ${client.name}`}>
      <form className="space-y-4" onSubmit={save}>
        <Field label="Name"><input className={inputCls} value={form.name} onChange={set("name")} required /></Field>
        <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={set("email")} required /></Field>
        <Field label="Role">
          <select className={inputCls} value={form.role} onChange={set("role")}>
            {grantable.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="text-[11px] text-brand-taupe mt-1">{ROLE_CAN[form.role]}</div>
        </Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit">Create invite</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ============ AUDIT ============
const show = (v) => {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return String(v);
  return Object.entries(v)
    .filter(([, x]) => x !== null && x !== undefined && typeof x !== "object")
    .slice(0, 4)
    .map(([k, x]) => `${k}: ${x}`)
    .join(" · ") || "…";
};

/** Only the fields that changed, so "before → after" stays readable. */
function diff(before, after) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [before, after];
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, JSON.stringify(v)]]));
  const b = Object.fromEntries(flat(before));
  const a = Object.fromEntries(flat(after));
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => b[k] !== a[k]);
  return [Object.fromEntries(keys.map((k) => [k, b[k] ?? "—"])), Object.fromEntries(keys.map((k) => [k, a[k] ?? "—"]))];
}

export function AuditLogView() {
  const { client, showToast } = useWorkspace();
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      attempt(showToast, async () => {
        const r = await api.audit(client, { actor, entity, limit: 50 });
        setRows(r.events);
        setNext(r.next);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [client, actor, entity, showToast]);

  const more = async () => {
    const r = await attempt(showToast, () => api.audit(client, { actor, entity, limit: 50, before: next }));
    if (r) {
      setRows((x) => [...x, ...r.events]);
      setNext(r.next);
    }
  };

  return (
    <div>
      <PageHeader title={`Audit Log — ${client.name} (${client.status})`} subtitle="Append-only. Every change records who (person, rule or model version), when, and before → after." />
      <Card>
        <div className="flex gap-2 mb-3 flex-wrap">
          <SearchBox placeholder="Filter by person (email)..." value={actor} onChange={setActor} />
          <select className={`${inputCls} w-52`} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All changes</option>
            {[["account", "Settings"], ["account_source", "Subscriptions"], ["term", "Terms"], ["term_group", "Term groups"], ["term_group_subscription", "Matrix"], ["schedule", "Schedules"], ["app_user", "Users"], ["user_invite", "Invites"], ["credential", "Credentials"], ["product", "Products"]].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <Table columns={["Time", "Actor", "Action", "Before", "After"]}>
          {rows.map((r) => {
            const [b, a] = diff(r.before, r.after);
            return (
              <tr key={r.id}>
                <Td className="text-brand-taupe whitespace-nowrap">{formatWhen(r.occurredAt)}</Td>
                <Td className="font-semibold">{r.actor}{r.actorType !== "user" && <div className="text-[10px] text-brand-taupe font-normal">{r.actorType}</div>}</Td>
                <Td>{r.summary || r.action}</Td>
                <Td className="text-brand-taupe max-w-64 truncate" title={JSON.stringify(b)}>{show(b)}</Td>
                <Td className="text-brand-charcoal font-medium max-w-64 truncate" title={JSON.stringify(a)}>{show(a)}</Td>
              </tr>
            );
          })}
        </Table>
        {rows.length === 0 && <div className="mt-3"><Note>No changes recorded yet{actor || entity ? " for this filter" : ""}.</Note></div>}
        {next && <div className="mt-3 flex justify-center"><SecondaryButton onClick={more}>Load older</SecondaryButton></div>}
      </Card>
    </div>
  );
}
