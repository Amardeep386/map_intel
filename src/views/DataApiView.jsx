// Data & API (P5 · M9): exports for everyone (only the datasets their role may read) as CSV or
// XLSX, and read-only API keys for the brand's BI tools (Administrators and Account managers).
// The same datasets and fields come out of both. docs/public-api.md is the reference for BI teams.
import React, { useCallback, useEffect, useState } from "react";
import { Copy, Download, KeyRound, Loader2, Plus } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Field, inputCls, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton, Table, Td } from "../ui.jsx";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const isoDay = (d) => d.toLocaleDateString("en-CA");
// With the year: keys live for months or years.
const fullDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const DATASETS = [
  { id: "products", title: "Products", needs: "catalogue.read", d: "Catalogue with identifiers, MAP in force and MSRP.", dates: false },
  { id: "violations", title: "Violations", needs: "violations.read", d: "Every violation with status, severity, seller, depth and dates.", dates: true },
  { id: "observations", title: "Price observations", needs: "observations.read", d: "Each advertised price seen, its verdict, MAP and evidence fingerprint.", dates: true },
  { id: "sellers", title: "Sellers", needs: "sellers.read", d: "Sellers with their classification and violation counts.", dates: false },
  { id: "cases", title: "Enforcement cases", needs: "cases.read", d: "Cases with state, seller, violations and response dates.", dates: true },
];

function ExportCard({ ds }) {
  const { client, showToast } = useWorkspace();
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 30 * 86_400_000)), to: "" }));
  const [busy, setBusy] = useState(null);
  const go = async (format) => {
    setBusy(format);
    await attempt(showToast, () => api.exportData(client, ds.id, { format, from: ds.dates ? range.from : undefined, to: ds.dates && range.to ? range.to : undefined }));
    setBusy(null);
  };
  return (
    <Card title={ds.title}>
      <p className="text-[13px] text-brand-taupe mb-3">{ds.d}</p>
      {ds.dates && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Field label="From"><input type="date" className={inputCls} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To (not included)"><input type="date" className={inputCls} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      )}
      <div className="flex gap-2">
        <SecondaryButton onClick={() => go("csv")} disabled={!!busy}>{busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV</SecondaryButton>
        <SecondaryButton onClick={() => go("xlsx")} disabled={!!busy}>{busy === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel</SecondaryButton>
      </div>
    </Card>
  );
}

function NewKeyModal({ onClose, onCreated }) {
  const { client, showToast } = useWorkspace();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("365");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const create = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.createApiKey(client, { name: name.trim(), expiresInDays: expires ? Number(expires) : null }));
    if (r) { setCreated(r); onCreated(); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(created.key); setCopied(true); } catch { /* clipboard blocked */ } };
  return (
    <Modal open onClose={onClose} title={created ? "Your new API key" : "New API key"} width="w-[34rem]">
      {created ? (
        <div className="space-y-3 text-[13px]">
          <Note tone="text-amber-900 bg-amber-50 border-amber-200">Copy the key now and store it in your BI tool's secret settings. It is shown only once; if it is lost, revoke it and make a new one.</Note>
          <div className="font-mono text-xs break-all bg-surface-2 border border-brand-beige rounded-lg p-3">{created.key}</div>
          <div className="flex justify-between">
            <SecondaryButton onClick={copy}><Copy className="w-4 h-4" /> {copied ? "Copied" : "Copy"}</SecondaryButton>
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </div>
        </div>
      ) : (
        <form onSubmit={create} className="space-y-3">
          <Field label="Name (what uses it)"><input autoFocus required maxLength={80} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Power BI – pricing dashboard" /></Field>
          <Field label="Expires">
            <select className={inputCls} value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="90">In 90 days</option><option value="365">In a year</option><option value="">Never (revoke by hand)</option>
            </select>
          </Field>
          <Note>Read-only: the key reads this account's products, violations, price observations, sellers and cases. It cannot change anything and cannot open other accounts.</Note>
          <div className="flex justify-end gap-2"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit" disabled={!name.trim()}><KeyRound className="w-4 h-4" /> Create key</PrimaryButton></div>
        </form>
      )}
    </Modal>
  );
}

function KeyLogModal({ apiKey, onClose }) {
  const { client, showToast } = useWorkspace();
  const [rows, setRows] = useState(null);
  useEffect(() => { attempt(showToast, async () => setRows(await api.apiKeyLog(client, apiKey.id))); }, [client, apiKey, showToast]);
  return (
    <Modal open onClose={onClose} title={`Recent calls · ${apiKey.name}`} width="w-[48rem]">
      {!rows ? <Loader2 className="w-4 h-4 animate-spin text-brand-taupe" /> : rows.length === 0 ? <Note>No calls yet.</Note> : (
        <Table compact columns={["Time", "Request", "Status", "Rows", "From"]}>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap text-brand-taupe">{formatWhen(r.at)}</Td>
              <Td className="font-mono text-[11px] break-all">{r.method} {r.path}</Td>
              <Td><Pill text={String(r.status)} tone={r.status < 400 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"} /></Td>
              <Td className="tabular-nums">{r.rows ?? "—"}</Td>
              <Td className="text-brand-taupe">{r.ip}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
}

function ApiKeysCard() {
  const { client, can, showToast } = useWorkspace();
  const [keys, setKeys] = useState(null);
  const [creating, setCreating] = useState(false);
  const [logFor, setLogFor] = useState(null);
  const load = useCallback(async () => setKeys(await api.apiKeys(client)), [client]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  const revoke = async (k) => {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working at once.`)) return;
    if ((await attempt(showToast, async () => (await api.revokeApiKey(client, k.id)) ?? true)) !== undefined) { showToast(`Revoked "${k.name}".`); attempt(showToast, load); }
  };
  const writable = can("settings.write");
  return (
    <Card title="API keys (read-only)" action={writable && <PrimaryButton onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New key</PrimaryButton>}>
      <p className="text-[13px] text-brand-taupe mb-3">
        For BI tools (Power BI, Tableau, Looker, a script). Send the key as <span className="font-mono text-xs">Authorization: Bearer mik_…</span> to{" "}
        <span className="font-mono text-xs">{api.apiBaseUrl()}/v1</span>. 120 calls a minute per key; every call is logged.
      </p>
      {!keys ? <Loader2 className="w-4 h-4 animate-spin text-brand-taupe" /> : keys.length === 0 ? <Note>No keys yet.</Note> : (
        <Table columns={["Name", "Key", "Created", "Expires", "Last used", "Calls (30 days)", ""]}>
          {keys.map((k) => (
            <tr key={k.id} className={k.revoked_at ? "opacity-60" : ""}>
              <Td className="font-medium">{k.name}<div className="text-[11px] text-brand-taupe font-normal">{k.created_by}</div></Td>
              <Td className="font-mono text-xs">mik_{k.prefix}_…</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{fullDate(k.created_at)}</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{k.revoked_at ? <Pill text="Revoked" tone="bg-slate-50 text-slate-500 border-slate-200" /> : k.expires_at ? fullDate(k.expires_at) : "Never"}</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{k.last_used_at ? formatWhen(k.last_used_at) : "Never"}</Td>
              <Td className="tabular-nums">{k.calls_30d}</Td>
              <Td className="whitespace-nowrap">
                <button onClick={() => setLogFor(k)} className="text-xs text-brand-copper hover:underline cursor-pointer mr-3">Calls</button>
                {writable && !k.revoked_at && <button onClick={() => revoke(k)} className="text-xs text-red-700 hover:underline cursor-pointer">Revoke</button>}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {creating && <NewKeyModal onClose={() => setCreating(false)} onCreated={() => attempt(showToast, load)} />}
      {logFor && <KeyLogModal apiKey={logFor} onClose={() => setLogFor(null)} />}
    </Card>
  );
}

export function DataApiView() {
  const { client, can } = useWorkspace();
  const mine = DATASETS.filter((d) => can(d.needs));
  return (
    <div>
      <PageHeader title={`Data & API — ${client.name} (${client.status})`} subtitle="Take this account's data out: download a file, or connect a BI tool with a read-only API key. Both give the same fields." />
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-brand-taupe mb-2">Exports (up to 100,000 rows each)</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {mine.map((ds) => <ExportCard key={ds.id} ds={ds} />)}
      </div>
      {can("settings.read") && <ApiKeysCard />}
    </div>
  );
}
