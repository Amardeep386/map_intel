import React, { useState, useEffect } from "react";
import { Plus, Upload, ExternalLink, Eye, Sparkles, Keyboard, SkipForward, Check, Ban, History, Undo2, FileText, Filter } from "./icons";
import {
  DataContext, useToast, Pill, KPI, Card, PageHeader, PrimaryButton, SecondaryButton, SearchBox, MerchantLogo,
  Table, Td, Tabs, Drawer, Modal, Field, inputCls, KV, Note, formatUSD
} from "./ui";
import { STATUS_BG, MAP_HISTORY, PROMOTIONS, POLICY_DOCS, SUPPRESSIONS, MAPPING_RETIRED } from "./data";

// ============ PRODUCTS ============
export function ProductSummaryView({ clientName, onAddSkuClick }) {
  const { db } = React.useContext(DataContext);
  const skus = db[clientName].skus;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const filtered = skus.filter((s) => (s.name + s.model + s.id + s.upc).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title={`Product Summary — ${clientName} (Sandbox)`} action={<><SecondaryButton onClick={onAddSkuClick}><Upload className="w-4 h-4" /> Import catalogue</SecondaryButton><PrimaryButton onClick={onAddSkuClick}><Plus className="w-4 h-4" /> Add SKU</PrimaryButton></>} />
      <Card>
        <div className="flex justify-between mb-4"><SearchBox value={q} onChange={setQ} placeholder="Search SKU, MPN, UPC, product name..." /></div>
        <Table columns={["SKU", "Product name", "Model / MPN", "UPC", "Category", "MAP in force", "Lowest seen", "Listings", "Violations", "Status"]}>
          {filtered.map((s) => (
            <tr key={s.id} onClick={() => setSel(s)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold">{s.id}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td className="text-brand-taupe">{s.model}</Td>
              <Td className="text-brand-taupe font-mono text-xs">{s.upc || "—"}</Td>
              <Td className="text-brand-taupe">{s.category}</Td>
              <Td>{formatUSD(s.map)}</Td>
              <Td className={`font-semibold ${s.current < s.map ? "text-red-600" : "text-brand-charcoal"}`}>{formatUSD(s.current)}</Td>
              <Td>{s.listings ?? "—"}</Td>
              <Td>{s.violations > 0 ? <Pill text={s.violations} tone="bg-red-50 text-red-700 border-red-200" /> : <span className="text-brand-taupe">0</span>}</Td>
              <Td><Pill text={s.status} tone={STATUS_BG[s.status]} /></Td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">Showing {filtered.length} of {skus.length} SKUs</div>
      </Card>
      <ProductDrawer p={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function ProductDrawer({ p, onClose }) {
  if (!p) return null;
  const hist = MAP_HISTORY.filter((m) => m.sku === p.id);
  return (
    <Drawer open onClose={onClose} eyebrow="Product" title={`${p.id} — ${p.name}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Identifiers">
          <div className="space-y-2.5 text-xs">
            <KV k="Model / MPN" v={p.model} /><KV k="UPC" v={p.upc || "—"} /><KV k="ASIN" v="B0CVS3X1YZ" /><KV k="Alt SKUs (1–6)" v="OLED55C4PUA.AUS" /><KV k="MSRP (reference)" v={formatUSD(p.msrp || p.map)} /><KV k="Product group" v={`${p.category} / 2024 line`} />
          </div>
        </Card>
        <Card title="MAP history" className="md:col-span-2">
          <Table columns={["Version", "Amount", "From", "To", "Region", "Source"]}>
            {(hist.length ? hist : [{ version: "v1", amount: p.map, from: "Jan 15, 2026", to: "—", region: "All", source: "Import IMP-001" }]).map((m) => (
              <tr key={m.version}><Td className="font-semibold">{m.version}</Td><Td>{formatUSD(m.amount)}</Td><Td className="text-brand-taupe">{m.from}</Td><Td className="text-brand-taupe">{m.to}</Td><Td className="text-brand-taupe">{m.region}</Td><Td className="text-brand-taupe">{m.source}</Td></tr>
            ))}
          </Table>
          <div className="mt-3"><Note>Violations are always judged against the version in force on the observation date. Changing MAP never rewrites past violations.</Note></div>
        </Card>
      </div>
      <Card title="Included listings (seller × source)" className="mt-4">
        <Table columns={["Seller", "Source", "Last price", "Last observed", "Status"]}>
          {[["XYZ Electronics", "Amazon", 1395, "Sep 23, 04:10 UTC", "Below MAP"], ["Best Buy", "Best Buy", 1399, "Sep 22, 06:05 UTC", "Authorised promo"], ["TechMart", "Walmart", 1499, "Sep 23, 06:10 UTC", "Compliant"], ["LG.com", "LG.com", 1499, "Sep 23, 05:00 UTC", "Compliant"]].map((r) => (
            <tr key={r[0]}><Td className="font-semibold">{r[0]}</Td><Td className="text-brand-taupe">{r[1]}</Td><Td className={r[2] < p.map ? "text-red-600 font-semibold" : ""}>{formatUSD(r[2])}</Td><Td className="text-brand-taupe">{r[3]}</Td><Td><Pill text={r[4]} tone={r[4] === "Below MAP" ? STATUS_BG.Open : r[4] === "Compliant" ? STATUS_BG.Active : STATUS_BG["Authorised promo"]} /></Td></tr>
          ))}
        </Table>
      </Card>
    </Drawer>
  );
}

// ============ MAP POLICIES (was "MAP & Pricing") ============
export function MapPoliciesView({ clientName, onAddPromoClick }) {
  const [tab, setTab] = useState("map");
  const [importOpen, setImportOpen] = useState(false);
  const showToast = useToast();
  return (
    <div>
      <PageHeader title={`MAP Policies — ${clientName} (Sandbox)`} subtitle="MAP is effective-dated. Competitive price tracking lives in the separate Pricing Intel portal."
        action={<><SecondaryButton onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> Import MAP file</SecondaryButton><PrimaryButton onClick={onAddPromoClick}><Plus className="w-4 h-4" /> Add promotion window</PrimaryButton></>} />
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "map", label: "MAP price history", count: MAP_HISTORY.length }, { id: "promo", label: "Promotion windows", count: PROMOTIONS.length }, { id: "docs", label: "Policy documents", count: POLICY_DOCS.length }]} />
        {tab === "map" && (
          <Table columns={["SKU", "Product", "Version", "MAP", "Effective from", "Effective to", "Region", "Source"]}>
            {MAP_HISTORY.map((m, i) => (
              <tr key={i} className="hover:bg-brand-beige/20">
                <Td className="font-semibold">{m.sku}</Td><Td>{m.product}</Td><Td><Pill text={m.version} tone={m.to === "—" ? STATUS_BG["In force"] : STATUS_BG.Superseded} /></Td>
                <Td className="font-semibold">{formatUSD(m.amount)}</Td><Td className="text-brand-taupe">{m.from}</Td><Td className="text-brand-taupe">{m.to}</Td><Td className="text-brand-taupe">{m.region}</Td><Td className="text-brand-taupe">{m.source}</Td>
              </tr>
            ))}
          </Table>
        )}
        {tab === "promo" && (
          <>
            <Table columns={["Window", "SKU", "Standard MAP", "Promo MAP", "Effective from", "Effective until", "Applies to", "Status"]}>
              {PROMOTIONS.map((p) => (
                <tr key={p.id} className="hover:bg-brand-beige/20">
                  <Td className="font-semibold text-brand-copper">{p.id}</Td><Td className="font-semibold">{p.sku}</Td><Td>{formatUSD(p.standard)}</Td>
                  <Td className="text-emerald-700 font-bold">{formatUSD(p.promo)}</Td><Td className="text-brand-taupe">{p.from}</Td><Td className="text-brand-taupe">{p.until}</Td><Td className="text-brand-taupe">{p.sellers}</Td>
                  <Td><Pill text={p.status} tone={STATUS_BG[p.status]} /></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-4"><Note>Inside an active window, below-MAP observations are recorded as <b>Authorised promo</b> — kept in history but excluded from compliance trends, so holidays don't show false spikes.</Note></div>
          </>
        )}
        {tab === "docs" && (
          <Table columns={["Document", "Version", "Effective", "Uploaded", "Referenced by", "Status"]}>
            {POLICY_DOCS.map((d) => (
              <tr key={d.version}><Td className="font-semibold"><span className="inline-flex items-center gap-1.5"><FileText className="w-4 h-4 text-brand-taupe" />{d.name}</span></Td><Td>{d.version}</Td><Td className="text-brand-taupe">{d.effective}</Td><Td className="text-brand-taupe">{d.uploaded}</Td><Td className="text-brand-taupe">{d.usedBy}</Td><Td><Pill text={d.status} tone={STATUS_BG[d.status]} /></Td></tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import MAP file — dry run" width="w-[40rem]">
        <div className="space-y-4">
          <div className="text-xs text-brand-taupe">LG_MAP_Oct2026.xlsx · 212 rows · columns mapped: SKU → product_code, MAP → amount, Start → effective_from</div>
          <div className="flex gap-3 flex-wrap">
            <KPI label="New MAP versions" value="14" /><KPI label="Unchanged" value="193" /><KPI label="Unknown SKUs" value="3" subTone="text-amber-700" sub="will be skipped" /><KPI label="Errors" value="2" sub="missing date" subTone="text-red-600" />
          </div>
          <Table columns={["SKU", "Current MAP", "New MAP", "From", "Change"]}>
            {[["LG-002", 1799, 1699, "Oct 01, 2026"], ["LG-006", 449, 429, "Oct 01, 2026"], ["LG-010", 379, 359, "Oct 01, 2026"]].map((r) => (
              <tr key={r[0]}><Td className="font-semibold">{r[0]}</Td><Td>{formatUSD(r[1])}</Td><Td className="font-semibold">{formatUSD(r[2])}</Td><Td className="text-brand-taupe">{r[3]}</Td><Td className="text-red-600">{(((r[2] - r[1]) / r[1]) * 100).toFixed(1)}%</Td></tr>
            ))}
          </Table>
          <div className="flex justify-end gap-2 border-t border-brand-beige pt-3">
            <SecondaryButton onClick={() => setImportOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={() => { setImportOpen(false); showToast("Import IMP-015 committed: 14 new MAP versions from Oct 01."); }}>Commit 14 changes</PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============ MAPPING CENTER ============
const REASONS = ["Wrong product", "Wrong variant", "Used or refurbished", "Bundle or multipack", "Accessory or part", "Out of region", "Not a purchasable offer", "Brand direct"];
const SCOPES = ["This listing", "Seller + product", "URL pattern", "Source"];

export function MappingCenterView({ clientName }) {
  const { db, setDb } = React.useContext(DataContext);
  const showToast = useToast();
  const { mappingStage, mappingInclude, mappingExclude } = db[clientName];
  const [tab, setTab] = useState("queue");
  const [excl, setExcl] = useState(null);

  const update = (fn) => setDb((prev) => ({ ...prev, [clientName]: fn(prev[clientName]) }));
  const include = (item) => {
    update((c) => ({ ...c, mappingStage: c.mappingStage.filter((i) => i !== item), mappingInclude: [{ product: item.product, merchant: item.merchant, url: "#", mappedOn: "Just now", by: "Analyst", confidence: item.confidence }, ...c.mappingInclude] }));
    showToast(`Included → ${item.match}. Decision saved as a training label.`);
  };
  const exclude = (item, reason, scope) => {
    update((c) => ({ ...c, mappingStage: c.mappingStage.filter((i) => i !== item), mappingExclude: [{ product: item.product, merchant: item.merchant, reason, scope, excludedOn: "Just now", by: "You" }, ...c.mappingExclude] }));
    showToast(scope === "This listing" ? `Excluded — ${reason}.` : `Excluded and saved as a standing suppression (${scope}).`);
  };

  const tabs = [
    { id: "queue", label: "Review queue", count: mappingStage.length },
    { id: "stage", label: "Staged", count: mappingStage.length },
    { id: "include", label: "Included", count: mappingInclude.length },
    { id: "exclude", label: "Excluded", count: mappingExclude.length },
    { id: "retired", label: "Retired", count: MAPPING_RETIRED.length },
    { id: "suppress", label: "Suppressions", count: SUPPRESSIONS.length },
  ];

  return (
    <div>
      <PageHeader title={`Mapping Center — ${clientName} (Sandbox)`} subtitle="Auto-include ≥ 90 · review 60–89 · auto-exclude < 60 (thresholds in Settings)" />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Staged today" value="126" sub="collected, not yet judged" />
        <KPI label="Auto-included" value="97" sub="≥ 90 confidence · 5% sampled for QA" />
        <KPI label="In review band" value={mappingStage.length} sub="ordered by risk" />
        <KPI label="Auto-excluded" value="25" sub="kept & searchable" />
      </div>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={tabs} right={<><SecondaryButton><Filter className="w-3.5 h-3.5" /> Saved views</SecondaryButton><SecondaryButton><History className="w-3.5 h-3.5" /> Diff vs last run</SecondaryButton></>} />

        {tab === "queue" && <ReviewQueue items={mappingStage} onInclude={include} onExclude={(i) => setExcl(i)} />}

        {tab === "stage" && (
          <>
            <div className="flex justify-between mb-3 gap-2 flex-wrap">
              <SearchBox placeholder="Search product, URL, seller..." value="" onChange={() => {}} />
              <PrimaryButton onClick={() => showToast("Rules applied: 2 included, 0 excluded.")}><Sparkles className="w-4 h-4" /> Apply rules now</PrimaryButton>
            </div>
            <Table columns={["Detected product", "Seller", "Detected price", "Proposed match", "Confidence", "Actions"]}>
              {mappingStage.map((r) => (
                <tr key={r.id} className="hover:bg-brand-beige/20">
                  <Td className="font-medium">{r.product}</Td>
                  <Td className="text-brand-taupe"><MerchantLogo name={r.merchant} /></Td>
                  <Td>{formatUSD(r.price)}</Td>
                  <Td>{r.match ? <span className="text-brand-copper font-semibold">{r.match}</span> : <span className="text-brand-taupe">No match</span>}</Td>
                  <Td><Pill text={`${r.confidence}`} tone={r.confidence >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"} /></Td>
                  <Td><div className="flex gap-3"><button onClick={() => include(r)} className="text-xs text-brand-copper font-semibold hover:underline cursor-pointer">Include</button><button onClick={() => setExcl(r)} className="text-xs text-brand-taupe hover:text-brand-charcoal cursor-pointer">Exclude…</button></div></Td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "include" && (
          <Table columns={["Product (client SKU)", "Seller", "Source URL", "Confidence", "Included on", "Decided by", "Actions"]}>
            {mappingInclude.map((r, i) => (
              <tr key={i} className="hover:bg-brand-beige/20">
                <Td className="font-medium">{r.product}</Td><Td className="text-brand-taupe"><MerchantLogo name={r.merchant} /></Td>
                <Td><span className="text-brand-copper hover:underline inline-flex items-center gap-1 cursor-pointer">{r.url}<ExternalLink className="w-3.5 h-3.5" /></span></Td>
                <Td>{r.confidence ?? "—"}</Td><Td className="text-brand-taupe">{r.mappedOn}</Td>
                <Td><Pill text={r.by} tone={r.by === "Auto Rule" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-600 border-slate-200"} /></Td>
                <Td><button className="text-xs text-brand-charcoal inline-flex items-center gap-1 cursor-pointer"><Eye className="w-3.5 h-3.5" /> View</button></Td>
              </tr>
            ))}
          </Table>
        )}

        {tab === "exclude" && (
          <>
            <div className="flex justify-end mb-3"><button className="text-xs text-brand-copper font-semibold hover:underline cursor-pointer inline-flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" />Restore selected</button></div>
            <Table columns={["Detected product", "Seller", "Reason", "Scope", "Excluded on", "By"]}>
              {mappingExclude.map((r, i) => (
                <tr key={i} className="hover:bg-brand-beige/20">
                  <Td className="font-medium">{r.product}</Td><Td className="text-brand-taupe"><MerchantLogo name={r.merchant} /></Td>
                  <Td><Pill text={r.reason} /></Td><Td className="text-brand-taupe">{r.scope || "This listing"}</Td><Td className="text-brand-taupe">{r.excludedOn}</Td><Td className="text-brand-taupe">{r.by || "—"}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "retired" && (
          <Table columns={["Product", "Seller", "Last seen", "Why retired"]}>
            {MAPPING_RETIRED.map((r, i) => <tr key={i}><Td className="font-medium">{r.product}</Td><Td className="text-brand-taupe">{r.merchant}</Td><Td className="text-brand-taupe">{r.lastSeen}</Td><Td className="text-brand-taupe">{r.reason}</Td></tr>)}
          </Table>
        )}

        {tab === "suppress" && (
          <>
            <Table columns={["Standing rule", "Reason", "Scope", "Created", "Listings suppressed", ""]}>
              {SUPPRESSIONS.map((s, i) => <tr key={i}><Td className="font-medium">{s.rule}</Td><Td><Pill text={s.reason} /></Td><Td className="text-brand-taupe">{s.scope}</Td><Td className="text-brand-taupe">{s.created}</Td><Td>{s.hits}</Td><Td><button className="text-xs text-brand-copper hover:underline cursor-pointer">Revoke</button></Td></tr>)}
            </Table>
            <div className="mt-3"><Note>Scoped exclusions become suppressions, so the same wrong listing is never excluded twice — and every one stays visible and revocable.</Note></div>
          </>
        )}
      </Card>

      <Modal open={!!excl} onClose={() => setExcl(null)} title="Exclude listing">
        {excl && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target); exclude(excl, f.get("reason"), f.get("scope")); setExcl(null); }}>
            <div className="text-xs text-brand-charcoal font-semibold">{excl.product}</div>
            <Field label="Reason *"><select id="excl-reason" name="reason" className={inputCls}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Apply to *"><select id="excl-scope" name="scope" className={inputCls}>{SCOPES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={() => setExcl(null)}>Cancel</SecondaryButton><PrimaryButton type="submit">Exclude</PrimaryButton></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function ReviewQueue({ items: raw, onInclude, onExclude }) {
  const items = [...raw].sort((a, b) => a.confidence - b.confidence);
  const [i, setI] = useState(0);
  const item = items[Math.min(i, items.length - 1)];
  useEffect(() => {
    const h = (e) => {
      if (!item || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "i") onInclude(item);
      if (e.key === "x") onExclude(item);
      if (e.key === "s") setI((n) => (n + 1) % items.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [item, items.length]);

  if (!item) return <div className="text-center py-10 text-sm text-brand-taupe">Queue clear — session finished. Nothing left in the review band.</div>;
  const sig = item.signals;
  const rows = [["Identifier", sig.identifier, !sig.identifier.startsWith("no")], ["Title similarity", sig.title, sig.title >= 0.8], ["Image similarity", sig.image, sig.image >= 0.8], ["Price plausibility", sig.price, sig.price === "plausible"], ["Attributes", sig.attributes, !/open box|bundle/.test(sig.attributes)], ["Prior decisions", "none on this seller + URL", true]];
  return (
    <div>
      <div className="flex justify-between items-center mb-3 text-xs text-brand-taupe flex-wrap gap-2">
        <span>Candidate {Math.min(i, items.length - 1) + 1} of {items.length} · ordered by lowest confidence × deepest discount</span>
        <span className="inline-flex items-center gap-1.5"><Keyboard className="w-3.5 h-3.5" /><b>I</b> include · <b>X</b> exclude · <b>S</b> skip</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold mb-2">Collected listing</div>
          <div className="bg-brand-beige rounded-lg h-28 mb-3 flex items-center justify-center text-xs text-brand-taupe">listing image</div>
          <div className="text-sm font-semibold text-brand-charcoal mb-2">{item.product}</div>
          <div className="space-y-1.5 text-xs"><KV k="Seller" v={item.merchant} /><KV k="Price" v={formatUSD(item.price)} /><KV k="Listing ID" v={item.id} /></div>
        </div>
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold mb-2">Confidence breakdown</div>
          <div className="text-3xl font-bold text-brand-charcoal mb-3 tabular-nums">{item.confidence}<span className="text-sm text-brand-taupe font-normal"> / 100</span></div>
          <div className="space-y-2 text-xs">
            {rows.map(([k, v, ok]) => (
              <div key={k} className="flex justify-between gap-2"><span className="text-brand-taupe">{k}</span><span className={`font-semibold text-right ${ok ? "text-emerald-700" : "text-red-600"}`}>{ok ? "✓" : "✗"} {String(v)}</span></div>
            ))}
          </div>
        </div>
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold mb-2">Proposed product</div>
          <div className="bg-brand-beige rounded-lg h-28 mb-3 flex items-center justify-center text-xs text-brand-taupe">reference image</div>
          <div className="text-sm font-semibold text-brand-copper mb-2">{item.match}</div>
          <div className="space-y-1.5 text-xs"><KV k="MAP in force" v="$1,499 (v2)" /><KV k="UPC" v="195174055281" /><KV k="MSRP" v="$1,799" /></div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 flex-wrap">
        <SecondaryButton onClick={() => setI((n) => (n + 1) % items.length)}><SkipForward className="w-4 h-4" /> Skip</SecondaryButton>
        <SecondaryButton onClick={() => onExclude(item)}><Ban className="w-4 h-4" /> Exclude…</SecondaryButton>
        <SecondaryButton>Assign other SKU</SecondaryButton>
        <PrimaryButton onClick={() => onInclude(item)}><Check className="w-4 h-4" /> Include as {item.match}</PrimaryButton>
      </div>
    </div>
  );
}
