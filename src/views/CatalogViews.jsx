// Catalogue screens (docs/reference/prototype-src/views_catalog.jsx): Product Summary with the
// product drawer, the import modal (file -> column mapping -> dry-run diff -> commit), and
// MAP Policies (MAP history, promotion windows, policy documents).
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Upload, ExternalLink, FileText, Pencil, Download, Ban } from "lucide-react";
import { api } from "../api/client.js";
import {
  Card, Drawer, Field, KPI, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Tabs, Td, inputCls,
} from "../ui.jsx";
import { TONE, fileToBase64, formatDay, money } from "../format.js";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

// ============ PRODUCTS ============
export function ProductSummaryView() {
  const { client, can, showToast } = useWorkspace();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null); // {} = new SKU, product = edit
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setRows((await attempt(showToast, () => api.products(client, showRetired ? { retired: 1 } : {}))) ?? []);
  }, [client, showRetired, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const needle = q.toLowerCase();
  const filtered = (rows ?? []).filter((s) => [s.code, s.name, s.model, s.upc, s.ean, s.asin, ...(s.alts ?? [])].some((x) => (x ?? "").toLowerCase().includes(needle)));
  const writable = can("catalogue.write");
  return (
    <div>
      <PageHeader
        title={`Product Summary — ${client.name} (${client.status})`}
        action={writable && <><SecondaryButton onClick={() => setImporting(true)}><Upload className="w-4 h-4" /> Import catalogue</SecondaryButton><PrimaryButton onClick={() => setEditing({})}><Plus className="w-4 h-4" /> Add SKU</PrimaryButton></>}
      />
      <Card>
        <div className="flex justify-between mb-4 gap-3 flex-wrap items-center">
          <SearchBox value={q} onChange={setQ} placeholder="Search SKU, MPN, UPC, ASIN, alt SKU, product name..." />
          <label className="text-xs text-brand-taupe flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired SKUs
          </label>
        </div>
        <Table columns={["SKU", "Product name", "Model / MPN", "UPC", "Category", "MAP in force", "Lowest seen", "Listings", "Violations", "Status"]}>
          {filtered.map((s) => (
            <tr key={s.id} onClick={() => setSel(s)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold">{s.code}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td className="text-brand-taupe">{s.model || "—"}</Td>
              <Td className="text-brand-taupe font-mono text-xs">{s.upc || "—"}</Td>
              <Td className="text-brand-taupe">{s.category || "—"}</Td>
              <Td>{money(s.map)}</Td>
              <Td className={`font-semibold ${s.current != null && s.map != null && s.current < s.map ? "text-red-600" : "text-brand-charcoal"}`}>{money(s.current)}</Td>
              <Td>{s.listings ?? "—"}</Td>
              <Td>{s.violations > 0 ? <Pill text={s.violations} tone={TONE.Unauthorised} /> : <span className="text-brand-taupe">0</span>}</Td>
              <Td><Pill text={s.status} tone={TONE[s.status]} /></Td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">{rows ? `Showing ${filtered.length} of ${rows.length} SKUs` : "Loading…"}</div>
      </Card>
      {sel && <ProductDrawer productId={sel.id} onClose={() => setSel(null)} onEdit={(p) => { setSel(null); setEditing(p); }} />}
      {editing && <SkuModal product={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {importing && <ImportModal kind="products" onClose={() => setImporting(false)} onDone={load} />}
    </div>
  );
}

function ProductDrawer({ productId, onClose, onEdit }) {
  const { client, can, showToast } = useWorkspace();
  const [p, setP] = useState(null);
  useEffect(() => { attempt(showToast, () => api.product(client, productId)).then((x) => x && setP(x)); }, [client, productId, showToast]);
  if (!p) return null;
  const alts = (p.alts ?? []).map((v, i) => (v ? `${i + 1}: ${v}` : null)).filter(Boolean);
  return (
    <Drawer open onClose={onClose} eyebrow="Product" title={`${p.code} — ${p.name}`}
      footer={can("catalogue.write") && <SecondaryButton onClick={() => onEdit(p)}><Pencil className="w-4 h-4" /> Edit SKU</SecondaryButton>}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Identifiers">
          <div className="space-y-2.5 text-xs">
            <KV k="Model / MPN" v={p.model || "—"} /><KV k="UPC" v={p.upc || "—"} /><KV k="EAN" v={p.ean || "—"} /><KV k="ASIN" v={p.asin || "—"} />
            <KV k="Alt SKUs (1–6)" v={alts.length ? alts.join(" · ") : "—"} /><KV k="MSRP (reference)" v={money(p.msrp)} />
            <KV k="Product group" v={[p.category, p.group].filter(Boolean).join(" / ") || "—"} /><KV k="Status" v={p.status} />
          </div>
        </Card>
        <Card title="MAP history" className="md:col-span-2">
          {p.mapHistory.length ? (
            <Table columns={["Version", "Amount", "From", "To", "Region", "Source"]}>
              {p.mapHistory.map((m) => (
                <tr key={m.id}>
                  <Td className="font-semibold"><Pill text={`v${m.version}`} tone={m.to ? TONE.Superseded : TONE["In force"]} /></Td>
                  <Td>{money(m.amount)}</Td><Td className="text-brand-taupe">{formatDay(m.from)}</Td><Td className="text-brand-taupe">{m.to ? formatDay(m.to) : "—"}</Td>
                  <Td className="text-brand-taupe">{m.region || "All"}</Td><Td className="text-brand-taupe">{m.importCode ? `Import ${m.importCode}` : m.source === "manual" ? "Manual" : m.source}</Td>
                </tr>
              ))}
            </Table>
          ) : <div className="text-xs text-brand-taupe py-4">No MAP loaded for this SKU yet. Add one in MAP Policies, or import a MAP file.</div>}
          <div className="mt-3"><Note>Violations are always judged against the version in force on the observation date. Changing MAP never rewrites past violations.</Note></div>
        </Card>
      </div>
      <Card title="Included listings (seller × source)" className="mt-4">
        {p.includedListings.length ? (
          <Table columns={["Seller", "Source", "Price seen", "Confidence", "Included since", ""]}>
            {p.includedListings.map((l) => (
              <tr key={l.id}>
                <Td className="font-semibold">{l.seller || "—"}</Td><Td className="text-brand-taupe">{l.source}</Td>
                <Td>{money(l.candidate_price ?? p.offers?.find((o) => o.url === l.url)?.price)}</Td><Td>{l.confidence ?? "—"}</Td>
                <Td className="text-brand-taupe">{formatDay(l.state_since)}</Td>
                <Td><a href={l.url} target="_blank" rel="noreferrer" className="text-brand-copper inline-flex items-center gap-1 text-xs">Open <ExternalLink className="w-3.5 h-3.5" /></a></Td>
              </tr>
            ))}
          </Table>
        ) : <div className="text-xs text-brand-taupe py-3">No included listings yet: they appear once the Mapping Center includes them.</div>}
      </Card>
    </Drawer>
  );
}

function SkuModal({ product, onClose, onSaved }) {
  const { client, showToast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const text = (k) => String(f.get(k) ?? "").trim();
    const num = (k) => (text(k) ? Number(text(k)) : undefined);
    const alts = [1, 2, 3, 4, 5, 6].map((i) => text(`alt${i}`) || null);
    const body = {
      name: text("name"), model: text("model"), category: text("category"), group: text("group"), msrp: num("msrp"),
      upc: text("upc") || undefined, ean: text("ean") || undefined, asin: text("asin") || undefined, alts,
    };
    setBusy(true);
    const ok = product
      ? await attempt(showToast, () => api.updateProduct(client, product.id, { ...body, status: text("status") }))
      : await attempt(showToast, () => api.createProduct(client, { ...body, code: text("code"), map: num("map") }));
    setBusy(false);
    if (ok) {
      showToast(product ? `SKU ${product.code} saved.` : `SKU ${text("code")} added.`);
      await onSaved();
    }
  };
  const v = (k) => product?.[k] ?? "";
  return (
    <Modal open onClose={onClose} title={product ? `Edit SKU ${product.code}` : "Add SKU"} width="w-[40rem]">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {!product && <Field label="SKU (product code) *"><input name="code" required className={inputCls} /></Field>}
          <Field label="Product name *"><input name="name" required defaultValue={v("name")} className={inputCls} /></Field>
          <Field label="Model / MPN *"><input name="model" required defaultValue={v("model")} className={inputCls} /></Field>
          <Field label="Category"><input name="category" defaultValue={v("category")} className={inputCls} /></Field>
          <Field label="Product group"><input name="group" defaultValue={v("group")} className={inputCls} /></Field>
          <Field label="MSRP"><input name="msrp" type="number" step="0.01" min="0" defaultValue={v("msrp")} className={inputCls} /></Field>
          {!product && <Field label="MAP (optional, in force from today)"><input name="map" type="number" step="0.01" min="0" className={inputCls} /></Field>}
          {product && (
            <Field label="Status"><select name="status" defaultValue={product.status} className={inputCls}>{["Active", "Paused", "Retired"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          )}
          <Field label="UPC"><input name="upc" defaultValue={v("upc")} className={`${inputCls} font-mono`} /></Field>
          <Field label="EAN"><input name="ean" defaultValue={v("ean")} className={`${inputCls} font-mono`} /></Field>
          <Field label="ASIN"><input name="asin" defaultValue={v("asin")} className={`${inputCls} font-mono`} /></Field>
        </div>
        <div>
          <div className="text-xs font-semibold text-brand-charcoal mb-1.5">Alternate SKUs (slots 1–6)</div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <input key={i} name={`alt${i}`} placeholder={`Alt SKU ${i}`} defaultValue={product?.alts?.[i - 1] ?? ""} className={`${inputCls} font-mono`} />)}
          </div>
        </div>
        {product && <Note>UPC, EAN and ASIN add a value (a product can have several). Changes are recorded in the audit log.</Note>}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving…" : product ? "Save SKU" : "Add SKU"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ============ IMPORT (products, MAP files, listing candidates) ============
const IMPORT_TITLES = { products: "Import catalogue", map: "Import MAP file", listings: "Import candidate listings" };

export function ImportModal({ kind, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [file, setFile] = useState(null); // { fileName, content }
  const [mapping, setMapping] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun, nextMapping = mapping, f = file) => {
    setBusy(true);
    const r = await attempt(showToast, () => api.importFile(client, kind, { ...f, mapping: nextMapping ?? undefined, dryRun }));
    setBusy(false);
    if (!r) return;
    if (dryRun) {
      setReport(r);
      setMapping(r.mapping);
    } else {
      showToast(r.importCode ? `Import ${r.importCode} committed.` : "Nothing to commit.");
      await onDone?.();
      onClose();
    }
  };
  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const loaded = { fileName: f.name, content: await fileToBase64(f) };
    setFile(loaded);
    setMapping(null);
    await run(true, null, loaded);
  };
  const toCommit = report ? (kind === "map" ? report.summary.newVersions : kind === "products" ? report.summary.new + report.summary.changed : report.summary.newListings + report.summary.alreadyKnown) : 0;

  return (
    <Modal open onClose={onClose} title={`${IMPORT_TITLES[kind]} — dry run`} width="w-[52rem]">
      <div className="space-y-4">
        <Field label={kind === "listings" ? "CSV or XLSX (columns: URL, title, price, seller, condition, source...)" : "CSV or XLSX file (first row is the header)"}>
          <input type="file" accept=".csv,.xlsx,text/csv" onChange={pick} className="text-xs" />
        </Field>
        {report && (
          <>
            <div className="text-xs text-brand-taupe">{report.fileName} · {report.rows} rows · nothing is written until you commit</div>
            {report.fields?.length > 0 && (
              <div className="border border-brand-beige rounded-lg p-3">
                <div className="text-xs font-semibold text-brand-charcoal mb-2">Column mapping</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {report.fields.map((f) => (
                    <label key={f.key} className="text-[11px] text-brand-taupe">
                      {f.label}{f.required ? " *" : ""}
                      <select
                        className={`${inputCls} mt-0.5 !py-1 text-xs`}
                        value={mapping?.[f.key] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                      >
                        <option value="">— not in file —</option>
                        {report.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="flex justify-end mt-2"><SecondaryButton onClick={() => run(true)} disabled={busy}>Check again with this mapping</SecondaryButton></div>
              </div>
            )}
            <div className="flex gap-3 flex-wrap">
              {kind === "products" && <><KPI label="New SKUs" value={report.summary.new} /><KPI label="Changed" value={report.summary.changed} /><KPI label="Unchanged" value={report.summary.unchanged} /></>}
              {kind === "map" && <><KPI label="New MAP versions" value={report.summary.newVersions} /><KPI label="Unchanged" value={report.summary.unchanged} /><KPI label="Unknown SKUs" value={report.summary.unknownSkus} subTone="text-amber-700" sub="will be skipped" /></>}
              {kind === "listings" && <><KPI label="New listings" value={report.summary.newListings} /><KPI label="Already known" value={report.summary.alreadyKnown} sub="re-scored" /></>}
              <KPI label="Rows with errors" value={report.summary.errors} subTone="text-red-600" sub={report.summary.errors ? "skipped" : "none"} />
            </div>
            {report.changes?.length > 0 && <ChangeTable kind={kind} changes={report.changes} />}
            {report.problems?.length > 0 && (
              <div className="border border-red-200 bg-red-50/40 rounded-lg p-3 max-h-40 overflow-y-auto">
                {report.problems.slice(0, 200).map((p, i) => <div key={i} className="text-xs text-red-700">Line {p.line}: {p.reason}</div>)}
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => run(false)} disabled={busy || !report || !toCommit}>{busy ? "Working…" : `Commit ${toCommit} change${toCommit === 1 ? "" : "s"}`}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function ChangeTable({ kind, changes }) {
  const shown = changes.slice(0, 100);
  return (
    <div className="max-h-64 overflow-y-auto">
      {kind === "products" && (
        <Table columns={["Line", "SKU", "", "Changes"]}>
          {shown.map((c) => (
            <tr key={c.line}>
              <Td className="text-brand-taupe">{c.line}</Td><Td className="font-semibold">{c.code}</Td>
              <Td><Pill text={c.kind === "new" ? "New" : "Changed"} tone={c.kind === "new" ? TONE.Included : TONE.Scheduled} /></Td>
              <Td className="text-xs">{Object.entries(c.fields).map(([k, [from, to]]) => <div key={k}><b>{k}</b>: {from ?? "—"} → {to}</div>)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {kind === "map" && (
        <Table columns={["SKU", "Region", "Current MAP", "New MAP", "From", "Change"]}>
          {shown.map((c) => (
            <tr key={c.line}>
              <Td className="font-semibold">{c.code}</Td><Td className="text-brand-taupe">{c.region || "All"}</Td><Td>{money(c.current)}</Td>
              <Td className="font-semibold">{money(c.amount)}</Td><Td className="text-brand-taupe">{c.from}</Td>
              <Td className={c.current && c.amount < c.current ? "text-red-600" : "text-emerald-700"}>{c.current ? `${(((c.amount - c.current) / c.current) * 100).toFixed(1)}%` : "first MAP"}</Td>
            </tr>
          ))}
        </Table>
      )}
      {kind === "listings" && (
        <Table columns={["Line", "Source", "Title", "Price", "Seller", ""]}>
          {shown.map((c) => (
            <tr key={c.line}>
              <Td className="text-brand-taupe">{c.line}</Td><Td>{c.sourceCode}</Td><Td className="max-w-xs truncate">{c.title || c.url}</Td>
              <Td>{money(c.price)}</Td><Td className="text-brand-taupe">{c.seller || "—"}</Td><Td>{c.known ? <Pill text={`Known: ${c.known}`} tone={TONE[c.known]} /> : <Pill text="New" tone={TONE.Included} />}</Td>
            </tr>
          ))}
        </Table>
      )}
      {changes.length > shown.length && <div className="text-xs text-brand-taupe mt-2">…and {changes.length - shown.length} more</div>}
    </div>
  );
}

// ============ MAP POLICIES ============
export function MapPoliciesView() {
  const { client, can, showToast } = useWorkspace();
  const [tab, setTab] = useState("map");
  const [maps, setMaps] = useState([]);
  const [promos, setPromos] = useState([]);
  const [docs, setDocs] = useState([]);
  const [products, setProducts] = useState([]);
  const [modal, setModal] = useState(null); // 'import' | 'map' | 'promo' | 'policy'

  const load = useCallback(async () => {
    const r = await attempt(showToast, () => Promise.all([api.mapPrices(client), api.promos(client), api.policies(client), api.products(client)]));
    if (r) [setMaps, setPromos, setDocs, setProducts].forEach((set, i) => set(r[i]));
  }, [client, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const writable = can("catalogue.write");
  const download = async (d) => {
    const r = await attempt(showToast, () => api.policyDownload(client, d.id));
    if (r?.url) window.open(r.url, "_blank", "noopener");
  };
  const cancel = async (w) => {
    if (await attempt(showToast, () => api.cancelPromo(client, w.id))) {
      showToast(`Promotion window ${w.code} cancelled.`);
      await load();
    }
  };
  return (
    <div>
      <PageHeader
        title={`MAP Policies — ${client.name} (${client.status})`}
        subtitle="MAP is effective-dated. Competitive price tracking lives in the separate Pricing Intel portal."
        action={writable && <>
          <SecondaryButton onClick={() => setModal("import")}><Upload className="w-4 h-4" /> Import MAP file</SecondaryButton>
          <SecondaryButton onClick={() => setModal("map")}><Plus className="w-4 h-4" /> New MAP version</SecondaryButton>
          <PrimaryButton onClick={() => setModal("promo")}><Plus className="w-4 h-4" /> Add promotion window</PrimaryButton>
        </>}
      />
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "map", label: "MAP price history", count: maps.length }, { id: "promo", label: "Promotion windows", count: promos.length }, { id: "docs", label: "Policy documents", count: docs.length }]}
          right={tab === "docs" && writable && <SecondaryButton onClick={() => setModal("policy")}><Upload className="w-3.5 h-3.5" /> Upload policy version</SecondaryButton>} />
        {tab === "map" && (maps.length ? (
          <Table columns={["SKU", "Product", "Version", "MAP", "Effective from", "Effective to", "Region", "Source"]}>
            {maps.map((m) => (
              <tr key={m.id} className="hover:bg-brand-beige/20">
                <Td className="font-semibold">{m.code}</Td><Td>{m.product}</Td><Td><Pill text={`v${m.version}`} tone={TONE[m.status]} /></Td>
                <Td className="font-semibold">{money(m.amount)}</Td><Td className="text-brand-taupe">{formatDay(m.from)}</Td><Td className="text-brand-taupe">{m.to ? formatDay(m.to) : "—"}</Td>
                <Td className="text-brand-taupe">{m.region || "All"}</Td><Td className="text-brand-taupe">{m.sourceLabel}</Td>
              </tr>
            ))}
          </Table>
        ) : <Empty text="No MAP loaded yet. Import the brand's MAP file (dry run first) or add a version per SKU." />)}
        {tab === "promo" && (
          <>
            {promos.length ? (
              <Table columns={["Window", "Name", "SKUs", "Standard MAP", "Promo MAP", "Effective from", "Effective until", "Applies to", "Status", ""]}>
                {promos.map((w) => (
                  <tr key={w.id} className="hover:bg-brand-beige/20">
                    <Td className="font-semibold text-brand-copper">{w.code}</Td><Td>{w.name}</Td>
                    <Td className="text-xs">{w.products.map((p) => p.code).join(", ")}</Td>
                    <Td>{w.products.length === 1 ? money(w.products[0].standard) : "—"}</Td>
                    <Td className="text-emerald-700 font-bold">{w.products.length === 1 ? money(w.products[0].promoAmount) : `${w.products.length} SKUs`}</Td>
                    <Td className="text-brand-taupe">{formatDay(w.from)}</Td><Td className="text-brand-taupe">{formatDay(w.to)}</Td><Td className="text-brand-taupe">{w.appliesTo}</Td>
                    <Td><Pill text={w.status} tone={TONE[w.status]} /></Td>
                    <Td>{writable && ["Scheduled", "Active"].includes(w.status) && <button onClick={() => cancel(w)} className="text-xs text-brand-taupe hover:text-brand-charcoal cursor-pointer inline-flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> Cancel</button>}</Td>
                  </tr>
                ))}
              </Table>
            ) : <Empty text="No promotion windows." />}
            <div className="mt-4"><Note>Inside an active window, below-MAP observations are recorded as <b>Authorised promo</b> — kept in history but excluded from compliance trends, so holidays don't show false spikes.</Note></div>
          </>
        )}
        {tab === "docs" && (docs.length ? (
          <Table columns={["Document", "Version", "Effective", "Uploaded", "SHA-256", "Status", ""]}>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td className="font-semibold"><span className="inline-flex items-center gap-1.5"><FileText className="w-4 h-4 text-brand-taupe" />{d.name}</span></Td>
                <Td>v{d.version}</Td><Td className="text-brand-taupe">{formatDay(d.effective_from)}{d.effective_to ? ` → ${formatDay(d.effective_to)}` : ""}</Td>
                <Td className="text-brand-taupe">{formatWhen(d.uploaded_at)} · {d.uploaded_by}</Td>
                <Td className="font-mono text-[10px] text-brand-taupe" title={d.sha256}>{d.sha256.slice(0, 12)}…</Td>
                <Td><Pill text={d.status} tone={TONE[d.status]} /></Td>
                <Td><button onClick={() => download(d)} className="text-xs text-brand-copper cursor-pointer inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" /> {d.file_name}</button></Td>
              </tr>
            ))}
          </Table>
        ) : <Empty text="No policy documents yet. Upload the brand's MAP policy: each upload of the same name becomes a new version." />)}
      </Card>
      {modal === "import" && <ImportModal kind="map" onClose={() => setModal(null)} onDone={load} />}
      {modal === "map" && <MapVersionModal products={products} onClose={() => setModal(null)} onDone={load} />}
      {modal === "promo" && <PromoModal products={products} onClose={() => setModal(null)} onDone={load} />}
      {modal === "policy" && <PolicyModal onClose={() => setModal(null)} onDone={load} />}
    </div>
  );
}

const Empty = ({ text }) => <div className="text-center py-10 text-sm text-brand-taupe">{text}</div>;
const today = () => new Date().toLocaleDateString("en-CA");

function MapVersionModal({ products, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { amount: Number(f.get("amount")), from: f.get("from"), region: f.get("region") || undefined, note: f.get("note") || undefined };
    if (await attempt(showToast, () => api.addMapVersion(client, f.get("product"), body))) {
      showToast("New MAP version saved; the version in force was closed, not changed.");
      await onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title="New MAP version">
      <form onSubmit={submit} className="space-y-3">
        <Field label="SKU *"><select name="product" required className={inputCls}>{products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}{p.map ? ` (now ${money(p.map)})` : ""}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MAP *"><input name="amount" type="number" step="0.01" min="0.01" required className={inputCls} /></Field>
          <Field label="Effective from *"><input name="from" type="date" required defaultValue={today()} className={inputCls} /></Field>
          <Field label="Region (optional)"><input name="region" placeholder="e.g. CA" className={inputCls} /></Field>
          <Field label="Note"><input name="note" placeholder="e.g. Fall price list" className={inputCls} /></Field>
        </div>
        <Note>The version in force is closed on the new date; history is never rewritten.</Note>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Save version</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function PromoModal({ products, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [lines, setLines] = useState([{ productId: products[0]?.id ?? "", promoAmount: "" }]);
  const [sellers, setSellers] = useState([]);
  const [chosen, setChosen] = useState([]);
  useEffect(() => { attempt(showToast, () => api.sellers(client)).then((s) => s && setSellers(s)); }, [client, showToast]);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      name: f.get("name"), from: f.get("from"), to: f.get("to"), note: f.get("note") || undefined, sellerIds: chosen,
      products: lines.filter((l) => l.productId && l.promoAmount).map((l) => ({ productId: l.productId, promoAmount: Number(l.promoAmount) })),
    };
    const r = await attempt(showToast, () => api.addPromo(client, body));
    if (r) {
      showToast(`Promotion window ${r.code} saved.`);
      await onDone();
      onClose();
    }
  };
  const set = (i, patch) => setLines(lines.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  return (
    <Modal open onClose={onClose} title="Add promotion window" width="w-[40rem]">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name *"><input name="name" required placeholder="e.g. Black Friday 2026" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from *"><input name="from" type="date" required className={inputCls} /></Field>
          <Field label="Effective until *"><input name="to" type="date" required className={inputCls} /></Field>
        </div>
        <div>
          <div className="text-xs font-semibold text-brand-charcoal mb-1.5">SKUs and promotional MAP *</div>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <select value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} className={inputCls}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}{p.map ? ` (MAP ${money(p.map)})` : ""}</option>)}
              </select>
              <input type="number" step="0.01" min="0.01" placeholder="Promo MAP" value={l.promoAmount} onChange={(e) => set(i, { promoAmount: e.target.value })} className={`${inputCls} !w-36`} />
            </div>
          ))}
          <button type="button" onClick={() => setLines([...lines, { productId: products[0]?.id ?? "", promoAmount: "" }])} className="text-xs text-brand-copper font-semibold cursor-pointer">+ Add SKU</button>
        </div>
        <Field label="Applies to (none selected = all sellers)">
          <select multiple value={chosen} onChange={(e) => setChosen([...e.target.selectedOptions].map((o) => o.value))} className={`${inputCls} h-28`}>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.source}) — {s.classification}</option>)}
          </select>
        </Field>
        <Field label="Note"><input name="note" className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Save window</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function PolicyModal({ onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const file = f.get("file");
    if (!file?.size) return showToast("Choose the policy file.", "info");
    setBusy(true);
    const body = { name: f.get("name"), effectiveFrom: f.get("from"), fileName: file.name, contentType: file.type || "application/pdf", content: await fileToBase64(file), note: f.get("note") || undefined };
    const r = await attempt(showToast, () => api.uploadPolicy(client, body));
    setBusy(false);
    if (r) {
      showToast(`Policy "${body.name}" v${r.version} stored.`);
      await onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title="Upload policy version">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Document name *"><input name="name" required placeholder="e.g. LG US MAP Policy" className={inputCls} /></Field>
        <Field label="Effective from *"><input name="from" type="date" required defaultValue={today()} className={inputCls} /></Field>
        <Field label="File (PDF, Word, text or image; up to 10 MB) *"><input name="file" type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" className="text-xs" /></Field>
        <Field label="Note"><input name="note" className={inputCls} /></Field>
        <Note>Uploading the same name again creates the next version and closes the previous one. The file's SHA-256 is stored.</Note>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</PrimaryButton></div>
      </form>
    </Modal>
  );
}
