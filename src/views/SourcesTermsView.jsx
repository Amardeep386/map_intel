// Sources & Terms: what we collect, from where, and how often (docs/reference/prototype-src/views_collect.jsx).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Upload, WandSparkles, SlidersHorizontal } from "lucide-react";
import { api } from "../api/client.js";
import {
  Bar, Card, Field, KPI, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Tabs, Td, Toggle, inputCls,
} from "../ui.jsx";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

const cellTone = {
  All: "bg-brand-copper text-brand-white border-brand-copper",
  Some: "bg-brand-beige text-brand-charcoal border-brand-beige",
  None: "bg-brand-white text-brand-taupe border-brand-beige",
};
const STATUS_TONE = {
  live: "bg-emerald-50 text-emerald-700 border-emerald-200",
  planned: "bg-blue-50 text-blue-700 border-blue-200",
};
const TERM_TYPES = ["keyword", "brand", "identifier", "url", "seller"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function SourcesTermsView({ skus }) {
  const { client, can, showToast } = useWorkspace();
  const [tab, setTab] = useState("matrix");
  const [matrix, setMatrix] = useState(null);
  const [subs, setSubs] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [termCount, setTermCount] = useState(0);
  const [termsVersion, setTermsVersion] = useState(0);
  const [modal, setModal] = useState(null); // { kind: 'generate' | 'import' | 'options' | 'cell' | 'schedule', ... }

  const reload = useCallback(async () => {
    const [m, s, sc, t] = await Promise.all([api.matrix(client), api.subscriptions(client), api.schedules(client), api.terms(client, { limit: 1 })]);
    setMatrix(m);
    setSubs(s);
    setSchedules(sc);
    setTermCount(t.total);
  }, [client]);

  useEffect(() => {
    attempt(showToast, reload);
  }, [reload, showToast]);

  const afterTermsChange = async () => {
    setTermsVersion((v) => v + 1);
    await attempt(showToast, reload);
  };

  const subscribed = subs?.sources.filter((s) => s.subscription?.active).length ?? 0;
  return (
    <div>
      <PageHeader
        title={`Sources & Terms — ${client.name} (${client.status})`}
        subtitle="What we collect, from where, and how often. Sources are shared across accounts; subscriptions are per account."
      />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Subscribed sources" value={subscribed} sub={`of ${subs?.sources.length ?? 0} in the catalogue`} />
        <KPI label="Terms" value={termCount.toLocaleString()} sub={`${matrix?.groups.length ?? 0} groups`} />
        <KPI
          label="Projected requests / cycle"
          value={(matrix?.total ?? 0).toLocaleString()}
          sub={`of ${(matrix?.budget ?? 0).toLocaleString()} budget`}
          subTone={matrix?.overBudget ? "text-red-600 font-semibold" : undefined}
        />
        <KPI label="Schedules" value={schedules.filter((s) => s.active).length} sub="active" />
      </div>
      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "matrix", label: "Subscription matrix" },
            { id: "sources", label: "Source catalogue", count: subs?.sources.length },
            { id: "terms", label: "Terms", count: termCount },
            { id: "schedules", label: "Schedules", count: schedules.length },
          ]}
        />
        {tab === "matrix" && matrix && <MatrixTab matrix={matrix} canEdit={can("sources.write")} onCell={(group, category) => setModal({ kind: "cell", group, category })} />}
        {tab === "sources" && subs && (
          <SourcesTab
            sources={subs.sources}
            canEdit={can("sources.write")}
            onToggle={async (s, active) => {
              const r = await attempt(showToast, () => api.setSubscription(client, s.code, { active }));
              if (r) {
                showToast(`${active ? "Subscribed to" : "Paused"} ${s.name}.`);
                await attempt(showToast, reload);
              }
            }}
            onOptions={(s) => setModal({ kind: "options", source: s })}
          />
        )}
        {tab === "terms" && (
          <TermsTab
            key={termsVersion}
            groups={matrix?.groups ?? []}
            canEdit={can("terms.write")}
            onGenerate={() => setModal({ kind: "generate" })}
            onImport={() => setModal({ kind: "import" })}
          />
        )}
        {tab === "schedules" && (
          <SchedulesTab
            schedules={schedules}
            canEdit={can("schedules.write")}
            onNew={() => setModal({ kind: "schedule" })}
            onToggle={async (s, active) => {
              if (await attempt(showToast, () => api.updateSchedule(client, s.id, { active }))) await attempt(showToast, reload);
            }}
          />
        )}
      </Card>

      {modal?.kind === "generate" && <GenerateModal skus={skus} onClose={() => setModal(null)} onDone={afterTermsChange} />}
      {modal?.kind === "import" && <ImportModal onClose={() => setModal(null)} onDone={afterTermsChange} />}
      {modal?.kind === "options" && <OptionsModal source={modal.source} canEdit={can("sources.write")} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === "cell" && (
        <CellModal matrix={matrix} group={modal.group} category={modal.category} onClose={() => setModal(null)} onDone={(m) => setMatrix(m)} />
      )}
      {modal?.kind === "schedule" && <ScheduleModal groups={matrix?.groups ?? []} sources={subs?.sources ?? []} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MatrixTab({ matrix, canEdit, onCell }) {
  const planned = matrix.groups.reduce((n, g) => n + g.plannedRequests, 0);
  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
        <div className="text-xs text-brand-taupe">
          Rows are term groups, columns are source categories.{canEdit ? " Click a cell to change it." : ""}
        </div>
        <div className="text-xs">
          <span className="text-brand-taupe">Projected requests / cycle:</span>{" "}
          <b className={`tabular-nums ${matrix.overBudget ? "text-red-600" : "text-brand-charcoal"}`}>{matrix.total.toLocaleString()}</b>{" "}
          <span className="text-brand-taupe">of {matrix.budget.toLocaleString()} budget</span>
        </div>
      </div>
      <div className="mb-3">
        <Bar value={matrix.total} max={matrix.budget} tone={matrix.overBudget ? "bg-red-500" : "bg-brand-copper"} />
      </div>
      {matrix.groups.length === 0 ? (
        <Note>No term groups yet. Generate terms from the catalogue or import them on the Terms tab.</Note>
      ) : (
        <Table columns={["Term group", "Terms", ...matrix.categories, "Requests / cycle", "Listings found (30d)"]}>
          {matrix.groups.map((g) => (
            <tr key={g.id} className="hover:bg-brand-beige/20">
              <Td className="font-semibold">
                {g.name}
                {g.lowYield && <div className="text-[10px] text-amber-700 font-medium">Low yield — review for retirement</div>}
              </Td>
              <Td>{g.activeTerms}/{g.terms}</Td>
              {matrix.categories.map((c) => {
                const cell = g.cells[c];
                return (
                  <Td key={c}>
                    <button
                      disabled={!canEdit}
                      onClick={() => onCell(g, c)}
                      title={cell.mode === "Some" ? cell.sourceCodes.join(", ") : undefined}
                      className={`text-xs px-2.5 py-1 rounded-md border ${canEdit ? "cursor-pointer" : "cursor-default"} ${cellTone[cell.mode]}`}
                    >
                      {cell.mode}
                    </button>
                  </Td>
                );
              })}
              <Td className="tabular-nums">
                {g.requests.toLocaleString()}
                {g.plannedRequests > 0 && <span className="text-[10px] text-blue-700 ml-1">({g.plannedRequests} planned)</span>}
              </Td>
              <Td className="tabular-nums">{g.found30d}</Td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-3 space-y-2">
        {matrix.overBudget && <Note tone="bg-red-50 text-red-700 border-red-200">Over budget: narrow the matrix or raise the request budget in Settings.</Note>}
        {planned > 0 && (
          <Note>
            {planned.toLocaleString()} of these requests go to sources whose collector is planned (eBay, Target, Home Depot, Google Shopping). They are
            counted now and collected from Phase 2b.
          </Note>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function SourcesTab({ sources, canEdit, onToggle, onOptions }) {
  const [q, setQ] = useState("");
  const list = sources.filter((s) => `${s.name} ${s.family?.name ?? ""} ${s.category} ${s.country}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="flex justify-between mb-3 gap-2 flex-wrap">
        <SearchBox placeholder="Search sources by name, family, category..." value={q} onChange={setQ} />
      </div>
      <Table columns={["Source", "Family", "Category", "Country", "Collector", "Options", "Subscribed"]}>
        {list.map((s) => (
          <tr key={s.code} className="hover:bg-brand-beige/20">
            <Td className="font-semibold">{s.name}</Td>
            <Td className="text-brand-taupe">{s.family?.name ?? "—"}</Td>
            <Td className="text-brand-taupe">{s.category}</Td>
            <Td className="text-brand-taupe">{s.country}</Td>
            <Td><Pill text={s.collectorStatus === "live" ? "Live" : "Planned"} tone={STATUS_TONE[s.collectorStatus]} /></Td>
            <Td>
              <button onClick={() => onOptions(s)} className="text-xs text-brand-copper hover:underline cursor-pointer inline-flex items-center gap-1">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {s.options.length} options
              </button>
            </Td>
            <Td><Toggle on={!!s.subscription?.active} disabled={!canEdit} onChange={(v) => onToggle(s, v)} /></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3">
        <Note>Options are declared by each source's collector, not hard-coded per account. "Planned" sources can be subscribed and costed now; their collectors arrive in Phase 2b.</Note>
      </div>
    </>
  );
}

function OptionsModal({ source, canEdit, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [values, setValues] = useState(() => ({ ...(source.subscription?.values ?? Object.fromEntries(source.options.map((o) => [o.key, o.default]))) }));
  const save = async (e) => {
    e.preventDefault();
    const overrides = Object.fromEntries(source.options.filter((o) => values[o.key] !== o.default).map((o) => [o.key, values[o.key]]));
    const r = await attempt(showToast, () => api.setSubscription(client, source.code, { active: source.subscription?.active ?? true, options: overrides }));
    if (r) {
      showToast(`Saved ${source.name} options.`);
      onClose();
      await onDone();
    }
  };
  return (
    <Modal open onClose={onClose} title={`${source.name} options`}>
      <form className="space-y-4" onSubmit={save}>
        {source.options.map((o) => (
          <div key={o.key} className="flex justify-between items-center gap-3">
            <div>
              <div className="text-sm text-brand-charcoal font-medium">{o.label}</div>
              {o.help && <div className="text-[11px] text-brand-taupe">{o.help}</div>}
            </div>
            {o.type === "boolean" ? (
              <Toggle on={!!values[o.key]} disabled={!canEdit} onChange={(v) => setValues({ ...values, [o.key]: v })} />
            ) : o.type === "integer" ? (
              <input type="number" min={o.min} max={o.max} disabled={!canEdit} value={values[o.key]} className={`${inputCls} w-20`}
                onChange={(e) => setValues({ ...values, [o.key]: Number.parseInt(e.target.value, 10) || o.min })} />
            ) : (
              <select disabled={!canEdit} value={values[o.key]} className={`${inputCls} w-40`} onChange={(e) => setValues({ ...values, [o.key]: e.target.value })}>
                {o.values.map((v) => <option key={v}>{v}</option>)}
              </select>
            )}
          </div>
        ))}
        {!source.subscription && <Note>Saving subscribes {client.name} to {source.name}.</Note>}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>{canEdit ? "Cancel" : "Close"}</SecondaryButton>
          {canEdit && <PrimaryButton type="submit">Save options</PrimaryButton>}
        </div>
      </form>
    </Modal>
  );
}

function CellModal({ matrix, group, category, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const cell = group.cells[category];
  const [mode, setMode] = useState(cell.mode);
  const [picked, setPicked] = useState(cell.sourceCodes);
  const available = matrix.sources[category] ?? [];
  const save = async (e) => {
    e.preventDefault();
    const m = await attempt(showToast, () => api.setMatrixCell(client, group.id, category, { mode, sourceCodes: mode === "Some" ? picked : [] }));
    if (m) {
      onDone(m);
      onClose();
      showToast(`"${group.name}" × ${category}: ${mode}.`);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${group.name} × ${category}`}>
      <form className="space-y-4" onSubmit={save}>
        <div className="flex gap-2">
          {["All", "Some", "None"].map((m) => (
            <button type="button" key={m} onClick={() => setMode(m)} className={`text-xs px-3 py-1.5 rounded-md border cursor-pointer ${mode === m ? cellTone.All : cellTone.None}`}>{m}</button>
          ))}
        </div>
        {mode === "All" && <Note>All subscribed {category} sources: {available.map((s) => s.name).join(", ") || "none subscribed yet"}.</Note>}
        {mode === "Some" && (
          <div className="space-y-1.5">
            {available.length === 0 && <Note>No {category} sources are subscribed.</Note>}
            {available.map((s) => (
              <label key={s.code} className="flex items-center gap-2 text-sm text-brand-charcoal cursor-pointer">
                <input type="checkbox" checked={picked.includes(s.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.code] : picked.filter((c) => c !== s.code))} />
                {s.name}
                {s.collectorStatus !== "live" && <span className="text-[10px] text-blue-700">planned</span>}
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={mode === "Some" && picked.length === 0}>Save</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
const PAGE = 100;

function TermsTab({ groups, canEdit, onGenerate, onImport }) {
  const { client, showToast } = useWorkspace();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState("");
  const [data, setData] = useState({ terms: [], total: 0 });
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const t = setTimeout(() => {
      attempt(showToast, async () => setData(await api.terms(client, { q, group, type, limit })));
    }, 250);
    return () => clearTimeout(t);
  }, [client, q, group, type, limit, showToast]);

  const toggle = async (term, active) => {
    const updated = await attempt(showToast, () => api.updateTerm(client, term.id, { active }));
    if (updated) setData((d) => ({ ...d, terms: d.terms.map((t) => (t.id === term.id ? updated : t)) }));
  };

  return (
    <>
      <div className="flex justify-between mb-3 gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <SearchBox placeholder="Search terms or product codes..." value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} />
          <select value={group} onChange={(e) => { setGroup(e.target.value); setLimit(PAGE); }} className={`${inputCls} w-52`}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE); }} className={`${inputCls} w-36`}>
            <option value="">All types</option>
            {TERM_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
          </select>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <SecondaryButton onClick={onImport}><Upload className="w-4 h-4" /> Bulk import</SecondaryButton>
            <PrimaryButton onClick={onGenerate}><WandSparkles className="w-4 h-4" /> Generate from catalogue</PrimaryButton>
          </div>
        )}
      </div>
      <Table columns={["Term", "Type", "Assigned product", "Group", "Listings found (30d)", "Survived cleansing", "Violations produced", "Active", ""]}>
        {data.terms.map((t) => (
          <tr key={t.id} className={`hover:bg-brand-beige/20 ${t.active ? "" : "opacity-60"}`}>
            <Td className="font-medium">{t.value}</Td>
            <Td><Pill text={cap(t.type)} /></Td>
            <Td className="text-brand-taupe">{t.productCode ?? "—"}</Td>
            <Td className="text-brand-taupe">{t.group.name}</Td>
            <Td>{t.yield.found30d}</Td>
            <Td>{t.yield.survivedPct === null ? "—" : `${t.yield.survivedPct}%`}</Td>
            <Td>{t.yield.violations30d}</Td>
            <Td><Toggle on={t.active} disabled={!canEdit} onChange={(v) => toggle(t, v)} /></Td>
            <Td>{t.yield.retireCandidate && <span className="text-[11px] text-amber-700 font-semibold whitespace-nowrap">0 surviving listings in 90d · retire?</span>}</Td>
          </tr>
        ))}
      </Table>
      <div className="flex justify-between items-center mt-3 text-xs text-brand-taupe">
        <span>Showing {data.terms.length.toLocaleString()} of {data.total.toLocaleString()}</span>
        {data.terms.length < data.total && <SecondaryButton onClick={() => setLimit((l) => Math.min(l + PAGE, 500))}>Show more</SecondaryButton>}
      </div>
      {data.total === 0 && !q && !group && !type && (
        <div className="mt-3"><Note>No terms yet. "Generate from catalogue" creates one term per SKU from a naming template, plus identifier terms (MPN, ASIN).</Note></div>
      )}
      <div className="mt-2 text-[11px] text-brand-taupe">Yield columns fill in once the Phase 2b collectors run these terms.</div>
    </>
  );
}

function GenerateModal({ skus, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const categories = useMemo(() => [...new Set(skus.filter((s) => s.status === "Active").map((s) => s.category).filter(Boolean))].sort(), [skus]);
  const active = skus.filter((s) => s.status === "Active");
  const [category, setCategory] = useState("");
  const [template, setTemplate] = useState("{Brand} {Product Name}");
  const [ids, setIds] = useState(["MPN"]);
  const [group, setGroup] = useState(`F${new Date().getFullYear() % 100}: Brand + Product Name`);
  const [preview, setPreview] = useState(null);
  const body = (dryRun) => ({ dryRun, group, template: template.trim() || null, identifierTypes: ids, products: category ? { category } : {} });

  const inputsKey = JSON.stringify(body(true));
  const runPreview = async () => {
    const r = await attempt(showToast, () => api.generateTerms(client, body(true), skus));
    if (r) setPreview({ ...r, key: inputsKey });
  };
  const create = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.generateTerms(client, body(false), skus));
    if (r) {
      showToast(`Created ${r.created} terms in group "${group}"${r.alreadyExist ? ` (${r.alreadyExist} already existed)` : ""}.`);
      onClose();
      await onDone();
    }
  };
  // A preview only counts for the inputs it was made from.
  const current = preview?.key === inputsKey ? preview : null;

  return (
    <Modal open onClose={onClose} title="Generate terms from catalogue" width="w-[34rem]">
      <form className="space-y-4" onSubmit={create}>
        <Field label="Products">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All active SKUs ({active.length})</option>
            {categories.map((c) => <option key={c} value={c}>Category: {c} ({active.filter((s) => s.category === c).length})</option>)}
          </select>
        </Field>
        <Field label="Naming template (keyword terms)">
          <input className={inputCls} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="{Brand} {Product Name}" />
          <div className="text-[11px] text-brand-taupe mt-1">Tokens: {"{Brand} {Product Name} {Model} {Code} {Category}"}. Leave empty for identifier terms only.</div>
        </Field>
        <Field label="Identifier terms">
          <div className="flex gap-4 flex-wrap text-sm text-brand-charcoal">
            {["MPN", "UPC", "ASIN", "WALMART_ID", "BESTBUY_SKU"].map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={ids.includes(t)} onChange={(e) => setIds(e.target.checked ? [...ids, t] : ids.filter((x) => x !== t))} />
                {t.replace("_", " ")}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Batch label (group name)">
          <input className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)} required />
        </Field>
        {current ? (
          <div className="space-y-2">
            <Note>
              {current.toCreate} new terms for {current.products} products
              {current.alreadyExist ? `; ${current.alreadyExist} already exist and will be skipped` : ""}.
            </Note>
            <div className="max-h-40 overflow-y-auto text-xs border border-brand-beige rounded-lg divide-y divide-brand-beige">
              {current.sample.map((t, i) => (
                <div key={i} className="px-3 py-1.5 flex justify-between gap-2">
                  <span className="text-brand-charcoal">{t.value}</span>
                  <span className="text-brand-taupe whitespace-nowrap">{t.type} · {t.productCode}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Note>Preview first: nothing is created until you confirm.</Note>
        )}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <SecondaryButton onClick={runPreview}>Preview</SecondaryButton>
          <PrimaryButton type="submit" disabled={!current || current.toCreate === 0}>Create {current ? current.toCreate : ""} terms</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [csv, setCsv] = useState("");
  const [defaultGroup, setDefaultGroup] = useState("Imported terms");
  const [report, setReport] = useState(null);
  const readFile = async (file) => {
    if (!file) return;
    setCsv(await file.text());
    setReport(null);
  };
  const check = async () => setReport(await attempt(showToast, () => api.importTerms(client, { csv, defaultGroup, dryRun: true })));
  const commit = async (e) => {
    e.preventDefault();
    const r = await attempt(showToast, () => api.importTerms(client, { csv, defaultGroup, dryRun: false }));
    if (r) {
      showToast(`Imported ${r.created} terms${r.problems.length ? `; ${r.problems.length} rows skipped` : ""}.`);
      onClose();
      await onDone();
    }
  };
  return (
    <Modal open onClose={onClose} title="Bulk import terms" width="w-[36rem]">
      <form className="space-y-4" onSubmit={commit}>
        <Field label="CSV file (columns: type, value, product_code, group)">
          <input type="file" accept=".csv,text/csv" className="text-xs text-brand-taupe" onChange={(e) => readFile(e.target.files?.[0])} />
        </Field>
        <Field label="…or paste rows">
          <textarea className={`${inputCls} h-28 font-mono text-xs`} value={csv} onChange={(e) => { setCsv(e.target.value); setReport(null); }}
            placeholder={"type,value,product_code,group\nkeyword,LG 65 inch OLED C6,LG-P01,Names\nseller,https://www.amazon.com/s?me=XYZ,,Known offenders"} />
        </Field>
        <Field label="Group for rows without one">
          <input className={inputCls} value={defaultGroup} onChange={(e) => setDefaultGroup(e.target.value)} />
        </Field>
        {report && (
          <div className="space-y-2">
            <Note>
              {report.rows} rows: {report.toCreate} to import, {report.alreadyExist.length} already exist, {report.problems.length} with problems
              {report.newGroups.length ? `. New groups: ${report.newGroups.join(", ")}` : ""}.
            </Note>
            {report.problems.length > 0 && (
              <div className="max-h-36 overflow-y-auto text-xs border border-amber-200 bg-amber-50 rounded-lg divide-y divide-amber-200">
                {report.problems.map((p, i) => (
                  <div key={i} className="px-3 py-1.5 text-amber-800">Line {p.line}: {p.reason}</div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <SecondaryButton onClick={check} disabled={!csv.trim()}>Check file</SecondaryButton>
          <PrimaryButton type="submit" disabled={!report || report.toCreate === 0}>Import {report ? report.toCreate : ""} terms</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
const CADENCES = [
  ["0 6 * * *", "Daily 06:00"],
  ["0 */6 * * *", "Every 6 hours"],
  ["0 */12 * * *", "Every 12 hours"],
  ["0 3 * * 1", "Weekly on Monday 03:00"],
];
const cadenceLabel = (c) => CADENCES.find(([v]) => v === c)?.[1] ?? c;

function scopeLabel(sel, groups) {
  const parts = [];
  if (sel?.categories?.length) parts.push(`Category: ${sel.categories.join(", ")}`);
  if (sel?.sources?.length) parts.push(`Sources: ${sel.sources.join(", ")}`);
  if (sel?.termGroups?.length) parts.push(`Groups: ${sel.termGroups.map((id) => groups.find((g) => g.id === id)?.name ?? "?").join(", ")}`);
  return parts.join(" · ") || "All sources";
}

function SchedulesTab({ schedules, canEdit, onNew, onToggle }) {
  const { client } = useWorkspace();
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    api.termGroups(client).then(setGroups).catch(() => setGroups([]));
  }, [client]);
  return (
    <>
      {canEdit && (
        <div className="flex justify-end mb-3">
          <PrimaryButton onClick={onNew}><Plus className="w-4 h-4" /> New schedule</PrimaryButton>
        </div>
      )}
      <Table columns={["Schedule", "Applies to", "Listing scope", "Listing status", "Takedown status", "Cadence", "Next run", "Priority", "Active"]}>
        {schedules.map((s) => (
          <tr key={s.id}>
            <Td className="font-semibold">{s.name}</Td>
            <Td className="text-brand-taupe">{scopeLabel(s.selector, groups)}</Td>
            <Td className="text-brand-taupe">{s.listingScope}</Td>
            <Td className="text-brand-taupe">{s.listingStatus}</Td>
            <Td className="text-brand-taupe">{s.takedownStatus}</Td>
            <Td>{cadenceLabel(s.cadence)} <span className="text-[10px] text-brand-taupe">{s.timezone}</span></Td>
            <Td className="text-brand-taupe whitespace-nowrap">{s.active ? formatWhen(s.nextRun) : "—"}</Td>
            <Td>{s.priority}</Td>
            <Td><Toggle on={s.active} disabled={!canEdit} onChange={(v) => onToggle(s, v)} /></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Note>When several schedules match the same work, the highest priority wins, then the most specific. Schedules run from Phase 2b.</Note></div>
    </>
  );
}

function ScheduleModal({ groups, sources, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [form, setForm] = useState({ name: "", cadence: "0 6 * * *", timezone: "UTC", priority: 10, category: "", source: "", group: "", listingScope: "Included and Staged", takedownStatus: "All" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const selector = {};
    if (form.category) selector.categories = [form.category];
    if (form.source) selector.sources = [form.source];
    if (form.group) selector.termGroups = [form.group];
    const r = await attempt(showToast, () =>
      api.createSchedule(client, {
        name: form.name.trim(),
        cadence: form.cadence.trim(),
        timezone: form.timezone.trim(),
        priority: Number.parseInt(form.priority, 10) || 0,
        listingScope: form.listingScope,
        takedownStatus: form.takedownStatus,
        selector,
      }),
    );
    if (r) {
      showToast(`Created schedule "${r.name}".`);
      onClose();
      await onDone();
    }
  };
  return (
    <Modal open onClose={onClose} title="New schedule" width="w-[32rem]">
      <form className="space-y-4" onSubmit={save}>
        <Field label="Name"><input className={inputCls} value={form.name} onChange={set("name")} required placeholder="e.g. Under-notice re-check" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence (cron)">
            <input className={inputCls} list="cadences" value={form.cadence} onChange={set("cadence")} required />
            <datalist id="cadences">{CADENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</datalist>
          </Field>
          <Field label="Timezone"><input className={inputCls} value={form.timezone} onChange={set("timezone")} required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={set("category")}>
              <option value="">Any</option>
              {["Marketplace", "Online Seller", "Price Comparison"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select className={inputCls} value={form.source} onChange={set("source")}>
              <option value="">Any</option>
              {sources.filter((s) => s.subscription?.active).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Term group">
            <select className={inputCls} value={form.group} onChange={set("group")}>
              <option value="">Any</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Listing scope">
            <select className={inputCls} value={form.listingScope} onChange={set("listingScope")}>
              {["Included only", "Included and Staged", "All"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Takedown status">
            <select className={inputCls} value={form.takedownStatus} onChange={set("takedownStatus")}>
              {["All", "Under notice", "Not under notice"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Priority (0–100)"><input type="number" min="0" max="100" className={inputCls} value={form.priority} onChange={set("priority")} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit">Create schedule</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
