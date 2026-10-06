// Rules (docs/reference/prototype-src/views_collect.jsx RulesView): versioned verdict rules. An edit
// is a draft; a dry run over a date range shows its blast radius; only then can it be published,
// which closes the old version (never deletes it). Inclusion / exclusion rules are the Mapping
// Center's match rules, listed here read-only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, History, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Drawer, Field, inputCls, KPI, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton, Table, Tabs, Td } from "../ui.jsx";
import { formatDay, TONE } from "../format.js";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const SOURCES = [["walmart_us", "Walmart.com"], ["ebay_us", "eBay"], ["amazon_us", "Amazon.com"], ["bestbuy_us", "Best Buy"], ["target_us", "Target"], ["homedepot_us", "The Home Depot"]];
const SOURCE_CATS = ["Marketplace", "Online Seller", "Price Comparison"];
const CLASSES = ["MAP Authorised", "Unauthorised", "Brand Direct", "Unknown"];
const VERDICT_LABEL = { violation: "Violation", exempt: "Never a violation", needs_review: "Needs review" };
const isoDay = (d) => d.toISOString().slice(0, 10);

const scopeText = (s) => {
  const parts = [];
  if (s?.sources?.length) parts.push(s.sources.map((c) => SOURCES.find((x) => x[0] === c)?.[1] ?? c).join(", "));
  if (s?.sourceCategories?.length) parts.push(s.sourceCategories.join(" + "));
  if (s?.categories?.length) parts.push(`Category: ${s.categories.join(", ")}`);
  if (s?.products?.length) parts.push(`${s.products.length} products`);
  return parts.join(" · ") || "All products, all sources";
};
const actionText = (v) => {
  if (!v) return "—";
  const c = v.condition;
  if (c.type === "seller_class") return `${c.classes.join(", ")} → ${VERDICT_LABEL[v.verdict]}`;
  const tol = c.tolerancePct ?? null;
  return `Below MAP by more than ${tol === null ? "tolerance" : `${tol}%`} → ${VERDICT_LABEL[v.verdict]}`;
};

export function RulesView() {
  const { client, can, showToast } = useWorkspace();
  const [kind, setKind] = useState("all");
  const [rules, setRules] = useState(null);
  const [matchRules, setMatchRules] = useState([]);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setRules((await attempt(showToast, () => api.rules(client))) ?? []);
    if (can("mapping.read")) setMatchRules((await attempt(showToast, () => api.matchRules(client))) ?? []);
  }, [client, showToast, can]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const rows = useMemo(() => [
    ...(rules ?? []).map((r) => {
      const v = r.published ?? r.draft;
      return { key: r.id, id: r.id, code: r.code, name: r.name, kind: "Verdict", action: actionText(v), scope: scopeText(v?.scope), version: r.published?.version,
        draft: r.draft?.version, hits: r.hits_30d, status: r.published ? "Published" : "Draft", seeded: r.is_default, verdict: true };
    }),
    ...matchRules.map((m) => ({ key: m.id, code: m.code, name: m.name, kind: m.kind === "include" ? "Inclusion" : "Exclusion", action: m.reason || (m.kind === "include" ? "Include listing" : "Exclude listing"),
      scope: "Listings in Mapping Center", version: null, hits: m.hits, status: m.active ? "Published" : "Closed", seeded: m.is_default, verdict: false })),
  ], [rules, matchRules]);
  const list = rows.filter((r) => kind === "all" || r.kind === kind);

  return (
    <div>
      <PageHeader title={`Rules — ${client.name} (${client.status})`} subtitle="Versioned rules decide what counts as a violation. No rule goes live without a dry run."
        action={can("rules.write") && <PrimaryButton onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New rule</PrimaryButton>} />
      <Card>
        <Tabs value={kind} onChange={setKind} tabs={[{ id: "all", label: "All", count: rows.length }, ...["Verdict", "Inclusion", "Exclusion"].map((k) => ({ id: k, label: k, count: rows.filter((r) => r.kind === k).length }))]} />
        <Table columns={["Rule", "Kind", "Action", "Scope", "Version", "Hits (30d)", "Status", ""]}>
          {list.map((r) => (
            <tr key={r.key} onClick={() => (r.verdict ? setSel(r.id) : showToast("Inclusion and exclusion rules are switched on and off in Mapping Center → Rules.", "info"))} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold"><span className="text-brand-copper mr-2">{r.code}</span>{r.name}</Td>
              <Td><Pill text={r.kind} /></Td>
              <Td className="text-brand-taupe">{r.action}</Td>
              <Td className="text-brand-taupe">{r.scope}</Td>
              <Td className="whitespace-nowrap">{r.version ? `v${r.version}` : "—"}{r.draft ? <span className="text-amber-700 text-[11px]"> · draft v{r.draft}</span> : null}</Td>
              <Td className="tabular-nums">{r.hits ?? 0}</Td>
              <Td><Pill text={r.status} tone={TONE[r.status]} /></Td>
              <Td>{r.seeded && <span className="text-[10px] text-brand-taupe whitespace-nowrap">default template</span>}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3"><Note>Rules run by priority (lower first); the first that matches decides. Tolerance and minimum depth left empty use Settings → Violation defaults.</Note></div>
      </Card>
      {sel && <RuleDrawer ruleId={sel} onClose={() => setSel(null)} onChanged={load} />}
      {creating && <NewRuleModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setSel(id); }} />}
    </div>
  );
}

const emptyForm = { scope: {}, condition: { type: "below_map", tolerancePct: null, minDepth: null }, verdict: "violation", severity: { minorBelowPct: 5, severeAbovePct: 15 }, priority: 100 };
const formOf = (v) => (v ? { scope: v.scope ?? {}, condition: v.condition, verdict: v.verdict, severity: v.severity, priority: v.priority } : emptyForm);
const toggle = (arr, x) => (arr?.includes(x) ? arr.filter((y) => y !== x) : [...(arr ?? []), x]);
const numOrNull = (s) => (s === "" || s === null || s === undefined ? null : Number(s));

function RuleForm({ form, setForm, disabled }) {
  const c = form.condition;
  const set = (patch) => setForm({ ...form, ...patch });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Scope">
        <div className="space-y-3 text-xs">
          <Field label="Sources (none = all)">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {SOURCES.map(([code, name]) => (
                <label key={code} className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={!!form.scope.sources?.includes(code)} onChange={() => set({ scope: { ...form.scope, sources: toggle(form.scope.sources, code) } })} />{name}</label>
              ))}
            </div>
          </Field>
          <Field label="Source categories (none = all)">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {SOURCE_CATS.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={!!form.scope.sourceCategories?.includes(k)} onChange={() => set({ scope: { ...form.scope, sourceCategories: toggle(form.scope.sourceCategories, k) } })} />{k}</label>
              ))}
            </div>
          </Field>
          <Field label="Product categories (comma-separated, empty = all)">
            <input className={inputCls} disabled={disabled} value={(form.scope.categories ?? []).join(", ")}
              onChange={(e) => set({ scope: { ...form.scope, categories: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} placeholder="e.g. Laptop, TV" />
          </Field>
        </div>
      </Card>
      <Card title="Condition → verdict">
        <div className="space-y-3 text-xs">
          <Field label="Condition">
            <select className={inputCls} disabled={disabled} value={c.type}
              onChange={(e) => set({ condition: e.target.value === "below_map" ? { type: "below_map", tolerancePct: null, minDepth: null } : { type: "seller_class", classes: ["Brand Direct"] } })}>
              <option value="below_map">Listing price is below the MAP in force on the observation date</option>
              <option value="seller_class">Seller classification at capture is…</option>
            </select>
          </Field>
          {c.type === "below_map" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="by more than (%)"><input className={inputCls} type="number" min="0" step="0.1" disabled={disabled} value={c.tolerancePct ?? ""} placeholder="tolerance" onChange={(e) => set({ condition: { ...c, tolerancePct: numOrNull(e.target.value) } })} /></Field>
              <Field label="and by more than ($)"><input className={inputCls} type="number" min="0" step="0.01" disabled={disabled} value={c.minDepth ?? ""} placeholder="min. depth" onChange={(e) => set({ condition: { ...c, minDepth: numOrNull(e.target.value) } })} /></Field>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {CLASSES.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={c.classes.includes(k)} onChange={() => set({ condition: { ...c, classes: toggle(c.classes, k) } })} />{k}</label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Verdict">
              <select className={inputCls} disabled={disabled} value={form.verdict} onChange={(e) => set({ verdict: e.target.value })}>
                {Object.entries(VERDICT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Priority (lower first)"><input className={inputCls} type="number" min="0" disabled={disabled} value={form.priority} onChange={(e) => set({ priority: Number(e.target.value) })} /></Field>
          </div>
          {form.verdict !== "exempt" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minor below (%)"><input className={inputCls} type="number" min="0" disabled={disabled} value={form.severity.minorBelowPct} onChange={(e) => set({ severity: { ...form.severity, minorBelowPct: Number(e.target.value) } })} /></Field>
              <Field label="Severe above (%)"><input className={inputCls} type="number" min="0" disabled={disabled} value={form.severity.severeAbovePct} onChange={(e) => set({ severity: { ...form.severity, severeAbovePct: Number(e.target.value) } })} /></Field>
            </div>
          )}
          <div className="border-t border-brand-beige pt-2 text-brand-charcoal">
            <b>Verdict:</b> {VERDICT_LABEL[form.verdict]}{form.verdict !== "exempt" ? ` · severity by depth — Minor <${form.severity.minorBelowPct}%, Standard ${form.severity.minorBelowPct}–${form.severity.severeAbovePct}%, Severe >${form.severity.severeAbovePct}%` : ""}
          </div>
        </div>
      </Card>
    </div>
  );
}

function DryRunResult({ run }) {
  const r = run.result;
  return (
    <Card title={`Dry-run result — ${formatDay(run.range_from ?? run.from)} to ${formatDay(run.range_to ?? run.to)}`} className="mt-4">
      <div className="flex gap-3 flex-wrap mb-3">
        <KPI label="Prices evaluated" value={r.observations} sub={`${r.listings} listings`} />
        <KPI label="Violating (draft)" value={r.violationsCandidate} sub={`${r.violationsLive} with the live rules`} />
        <KPI label="Newly violating" value={`+${r.newlyViolating}`} subTone={r.newlyViolating ? "text-red-600" : undefined} />
        <KPI label="No longer violating" value={`−${r.noLongerViolating}`} />
      </div>
      {r.bySeller.length > 0
        ? <Note>Blast radius: {r.bySeller.slice(0, 5).map((s) => `${s.seller} ${s.newly ? `+${s.newly}` : ""}${s.noLonger ? ` −${s.noLonger}` : ""}`).join(" · ")}.</Note>
        : <Note>No change for any seller in this range.</Note>}
    </Card>
  );
}

function RuleDrawer({ ruleId, onClose, onChanged }) {
  const { client, can, showToast } = useWorkspace();
  const [rule, setRule] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 30 * 86_400_000)), to: isoDay(new Date(Date.now() + 86_400_000)) }));
  const [dry, setDry] = useState(null);
  const writable = can("rules.write");

  const load = useCallback(async () => {
    const r = await attempt(showToast, () => api.rule(client, ruleId));
    if (!r) return;
    setRule(r);
    const draft = r.versions.find((v) => v.status === "Draft");
    const pub = r.versions.find((v) => v.status === "Published");
    setForm(formOf(draft ?? pub));
    setDirty(false);
    setDry(draft?.last_dry_run && (!draft.content_hash || draft.last_dry_run.content_hash === draft.content_hash) ? draft.last_dry_run : null);
  }, [client, ruleId, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  if (!rule) return <Drawer open onClose={onClose} eyebrow="Rule" title="Loading…"><div className="text-sm text-brand-taupe">Loading…</div></Drawer>;
  const draft = rule.versions.find((v) => v.status === "Draft");
  const pub = rule.versions.find((v) => v.status === "Published");
  const nextV = draft?.version ?? Math.max(0, ...rule.versions.map((v) => v.version)) + 1;
  const edit = (f) => { setForm(f); setDirty(true); setDry(null); };

  const save = async () => {
    const r = await attempt(showToast, () => api.saveRuleDraft(client, ruleId, form));
    if (r) { showToast(`Draft v${r.version} saved. Run a dry run before publishing.`); await load(); onChanged(); }
  };
  const runDry = async () => {
    if (dirty) return showToast("Save the draft first: the dry run checks exactly what will be published.", "info");
    const r = await attempt(showToast, () => api.dryRunRule(client, ruleId, { from: range.from, to: range.to }));
    if (r) setDry(r);
  };
  const publish = async () => {
    const r = await attempt(showToast, () => api.publishRule(client, ruleId));
    if (r) { showToast(`Published ${rule.code} v${r.published.version}.${r.closed ? ` v${r.closed.version} closed, not deleted.` : ""}`); await load(); onChanged(); }
  };
  const discard = async () => {
    if (await attempt(showToast, () => api.discardRuleDraft(client, ruleId))) { showToast("Draft discarded."); await load(); onChanged(); }
  };
  const replay = async () => {
    if (!pub) return;
    const r = await attempt(showToast, () => api.replayRuleVersion(client, pub.id, { from: range.from, to: range.to }));
    if (r) { showToast(`Replayed v${pub.version} into a shadow result set: ${r.summary.newlyViolating} newly violating, ${r.summary.noLongerViolating} no longer.`); await load(); }
  };

  return (
    <Drawer open onClose={onClose} eyebrow={`Rule ${rule.code} · ${draft ? `draft v${draft.version}` : `editing creates v${nextV}`}`} title={rule.name}
      footer={writable && <>
        {draft && <SecondaryButton onClick={discard}><Trash2 className="w-4 h-4" /> Discard draft</SecondaryButton>}
        {pub && <SecondaryButton onClick={replay}><History className="w-4 h-4" /> Replay v{pub.version}</SecondaryButton>}
        <SecondaryButton onClick={save} disabled={!dirty}>Save draft v{nextV}</SecondaryButton>
        <SecondaryButton onClick={runDry} disabled={!draft || dirty}><FlaskConical className="w-4 h-4" /> Dry run</SecondaryButton>
        <PrimaryButton onClick={publish} disabled={!draft || dirty || !dry}>Publish v{draft?.version ?? nextV}</PrimaryButton>
      </>}>
      <RuleForm form={form} setForm={edit} disabled={!writable} />
      {writable && (
        <div className="flex items-end gap-3 mt-4 text-xs flex-wrap">
          <Field label="Dry run / replay from"><input type="date" className={inputCls} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="to (not included)"><input type="date" className={inputCls} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      )}
      {dry ? <DryRunResult run={dry} /> : writable && (
        <div className="mt-4"><Note tone="bg-amber-50 text-amber-800 border-amber-200">{draft ? "Run a dry run of this draft to see its blast radius before it can be published." : "Change the rule and save a draft to start a new version."}</Note></div>
      )}

      <Card title="Versions" className="mt-4">
        <Table columns={["Version", "Status", "Action", "Scope", "In force", "Published by"]}>
          {rule.versions.map((v) => (
            <tr key={v.id}>
              <Td className="font-semibold">v{v.version}</Td>
              <Td><Pill text={v.status} tone={TONE[v.status]} /></Td>
              <Td className="text-brand-taupe">{actionText(v)}</Td>
              <Td className="text-brand-taupe">{scopeText(v.scope)}</Td>
              <Td className="text-brand-taupe whitespace-nowrap">{v.valid_from ? `${formatWhen(v.valid_from)} – ${v.valid_to ? formatWhen(v.valid_to) : "now"}` : "—"}</Td>
              <Td className="text-brand-taupe">{v.published_by_email ?? (v.status === "Draft" ? "—" : "default")}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {rule.replays?.length > 0 && (
        <Card title="Replays (shadow result sets)" className="mt-4">
          <Table columns={["Version", "Range", "Newly violating", "No longer", "Run"]}>
            {rule.replays.map((r) => (
              <tr key={r.id}><Td>v{r.version}</Td><Td className="text-brand-taupe">{formatDay(r.range_from)} – {formatDay(r.range_to)}</Td><Td>{r.summary.newlyViolating ?? "—"}</Td><Td>{r.summary.noLongerViolating ?? "—"}</Td><Td className="text-brand-taupe">{formatWhen(r.created_at)}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
    </Drawer>
  );
}

function NewRuleModal({ onClose, onCreated }) {
  const { client, showToast } = useWorkspace();
  const [name, setName] = useState("");
  const [form, setForm] = useState(emptyForm);
  const create = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.createRule(client, { name, ...form }));
    if (r) { showToast(`${r.code} created as draft v1. Dry-run it, then publish.`); onCreated(r.id); }
  };
  return (
    <Modal open onClose={onClose} title="New rule" width="w-[56rem]">
      <form className="space-y-4" onSubmit={create}>
        <Field label="Name *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. eBay: any price below MAP needs review" /></Field>
        <RuleForm form={form} setForm={setForm} />
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!name.trim()}>Create draft</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
