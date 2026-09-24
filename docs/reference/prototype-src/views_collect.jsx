import React, { useState } from "react";
import { Plus, Wand, Play, FlaskConical, History, AlertTriangle, RefreshCw, Upload, Info } from "./icons";
import {
  useToast, Pill, KPI, Card, PageHeader, PrimaryButton, SecondaryButton, SearchBox, Table, Td, Tabs, Drawer, Modal,
  Field, inputCls, KV, Note, Toggle, Bar
} from "./ui";
import { STATUS_BG, SOURCES, TERM_GROUPS, TERMS, SCHEDULES, RULES } from "./data";

// ============ SOURCES & TERMS ============
const CATS = ["Marketplace", "Online Seller", "Price Comparison"];
const cellTone = { All: "bg-brand-copper text-brand-white border-brand-copper", Some: "bg-brand-beige text-brand-charcoal border-brand-beige", None: "bg-brand-white text-brand-taupe border-brand-beige" };

export function SourcesTermsView({ clientName }) {
  const [tab, setTab] = useState("matrix");
  const [subs, setSubs] = useState(() => Object.fromEntries(SOURCES.map((s) => [s.name, s.subscribed])));
  const [gen, setGen] = useState(false);
  const showToast = useToast();
  const total = TERM_GROUPS.reduce((a, g) => a + g.cost, 0);
  return (
    <div>
      <PageHeader title={`Sources & Terms — ${clientName} (Sandbox)`} subtitle="What we collect, from where, and how often. Sources are shared across accounts; subscriptions are per account." />
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "matrix", label: "Subscription matrix" }, { id: "sources", label: "Source catalogue", count: SOURCES.length }, { id: "terms", label: "Terms", count: TERMS.length }, { id: "schedules", label: "Schedules", count: SCHEDULES.length }]} />

        {tab === "matrix" && (
          <>
            <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
              <div className="text-xs text-brand-taupe">Rows are term groups, columns are source categories. Click a cell to change it.</div>
              <div className="text-xs"><span className="text-brand-taupe">Projected requests / cycle:</span> <b className="text-brand-charcoal tabular-nums">{total.toLocaleString()}</b> <span className="text-brand-taupe">of 3,000 budget</span></div>
            </div>
            <div className="mb-3"><Bar value={total} max={3000} /></div>
            <Table columns={["Term group", "Terms", ...CATS, "Requests / cycle", "Listings found (30d)"]}>
              {TERM_GROUPS.map((g) => (
                <tr key={g.name} className="hover:bg-brand-beige/20">
                  <Td className="font-semibold">{g.name}{g.stale && <div className="text-[10px] text-amber-700 font-medium">Low yield — review for retirement</div>}</Td>
                  <Td>{g.active}/{g.terms}</Td>
                  {CATS.map((c) => <Td key={c}><button className={`text-xs px-2.5 py-1 rounded-md border cursor-pointer ${cellTone[g.matrix[c]]}`}>{g.matrix[c]}</button></Td>)}
                  <Td className="tabular-nums">{g.cost.toLocaleString()}</Td>
                  <Td className="tabular-nums">{g.yield30}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "sources" && (
          <>
            <div className="flex justify-between mb-3 gap-2 flex-wrap"><SearchBox placeholder="Search 5,900+ sources by name, family, country..." value="" onChange={() => {}} /><SecondaryButton>Saved view: My subscribed · US</SecondaryButton></div>
            <Table columns={["Source", "Family", "Category", "Country", "Capability", "Health", "Subscribed"]}>
              {SOURCES.map((s) => (
                <tr key={s.name} className="hover:bg-brand-beige/20">
                  <Td className="font-semibold">{s.name}</Td><Td className="text-brand-taupe">{s.family}</Td><Td className="text-brand-taupe">{s.category}</Td><Td className="text-brand-taupe">{s.country}</Td>
                  <Td className="text-brand-taupe">{s.type}</Td><Td><Pill text={s.health} tone={STATUS_BG[s.health]} /></Td>
                  <Td><Toggle on={subs[s.name]} onChange={(v) => { setSubs({ ...subs, [s.name]: v }); showToast(`${v ? "Subscribed to" : "Unsubscribed from"} ${s.name}.`); }} /></Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3"><Note>Amazon options (declared by the collector, not hard-coded): capture buy box · colour and size variants · new items only · seller-direct only · product monitor.</Note></div>
          </>
        )}

        {tab === "terms" && (
          <>
            <div className="flex justify-between mb-3 gap-2 flex-wrap">
              <SearchBox placeholder="Search terms..." value="" onChange={() => {}} />
              <div className="flex gap-2"><SecondaryButton><Upload className="w-4 h-4" /> Bulk import</SecondaryButton><PrimaryButton onClick={() => setGen(true)}><Wand className="w-4 h-4" /> Generate from catalogue</PrimaryButton></div>
            </div>
            <Table columns={["Term", "Type", "Assigned product", "Group", "Listings found (30d)", "Survived cleansing", "Violations produced", ""]}>
              {TERMS.map((t) => (
                <tr key={t.term} className="hover:bg-brand-beige/20">
                  <Td className="font-medium">{t.term}</Td><Td><Pill text={t.type} /></Td><Td className="text-brand-taupe">{t.product}</Td><Td className="text-brand-taupe">{t.group}</Td>
                  <Td>{t.yield}</Td><Td>{t.survived}%</Td><Td>{t.violations}</Td>
                  <Td>{t.retire && <span className="text-[11px] text-amber-700 font-semibold whitespace-nowrap">0 surviving listings in 90d · retire?</span>}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}

        {tab === "schedules" && (
          <Table columns={["Schedule", "Applies to", "Listing scope", "Listing status", "Takedown status", "Cadence", "Next run", "Priority"]}>
            {SCHEDULES.map((s) => (
              <tr key={s.name}><Td className="font-semibold">{s.name}</Td><Td className="text-brand-taupe">{s.scope}</Td><Td className="text-brand-taupe">{s.listingScope}</Td><Td className="text-brand-taupe">{s.status}</Td><Td className="text-brand-taupe">{s.takedown}</Td><Td>{s.cadence}</Td><Td className="text-brand-taupe whitespace-nowrap">{s.next}</Td><Td>{s.priority}</Td></tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={gen} onClose={() => setGen(false)} title="Generate terms from catalogue">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setGen(false); showToast("Created 10 terms in group 'F26: Brand + Product Name (Sep 23)'."); }}>
          <Field label="Products"><select id="gen-products" className={inputCls}><option>All active SKUs (10)</option><option>Category: TV (4)</option><option>Category: Monitor (3)</option></select></Field>
          <Field label="Naming template"><input id="gen-template" className={inputCls} defaultValue="{Brand} {Product Name}" /></Field>
          <Field label="Batch label (group name)"><input id="gen-batch" className={inputCls} defaultValue="F26: Brand + Product Name" /></Field>
          <Note>Preview: "LG 55&quot; OLED C4", "LG 65&quot; OLED C4", "LG 27&quot; UltraGear Monitor" … one term per product, each assigned to its SKU.</Note>
          <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={() => setGen(false)}>Cancel</SecondaryButton><PrimaryButton type="submit">Create 10 terms</PrimaryButton></div>
        </form>
      </Modal>
    </div>
  );
}

// ============ RULES ============
export function RulesView({ clientName }) {
  const [sel, setSel] = useState(null);
  const [kind, setKind] = useState("all");
  const list = RULES.filter((r) => kind === "all" || r.kind === kind);
  return (
    <div>
      <PageHeader title={`Rules — ${clientName} (Sandbox)`} subtitle="Versioned rules decide what counts as our listing and what counts as a violation. No rule goes live without a dry run."
        action={<PrimaryButton onClick={() => setSel(RULES[0])}><Plus className="w-4 h-4" /> New rule</PrimaryButton>} />
      <Card>
        <Tabs value={kind} onChange={setKind} tabs={[{ id: "all", label: "All", count: RULES.length }, ...["Verdict", "Inclusion", "Exclusion", "Score"].map((k) => ({ id: k, label: k, count: RULES.filter((r) => r.kind === k).length }))]} />
        <Table columns={["Rule", "Kind", "Action", "Scope", "Version", "Hits (30d)", "Status", ""]}>
          {list.map((r) => (
            <tr key={r.id} onClick={() => setSel(r)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold"><span className="text-brand-copper mr-2">{r.id}</span>{r.name}</Td>
              <Td><Pill text={r.kind} /></Td><Td className="text-brand-taupe">{r.action}</Td><Td className="text-brand-taupe">{r.scope}</Td>
              <Td>v{r.version}</Td><Td className="tabular-nums">{r.hits}</Td><Td><Pill text={r.status} tone={STATUS_BG[r.status]} /></Td>
              <Td>{r.seeded && <span className="text-[10px] text-brand-taupe whitespace-nowrap">default template</span>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <RuleDrawer rule={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function RuleDrawer({ rule, onClose }) {
  const showToast = useToast();
  const [ran, setRan] = useState(false);
  if (!rule) return null;
  return (
    <Drawer open onClose={() => { setRan(false); onClose(); }} eyebrow={`Rule ${rule.id} · editing creates v${rule.version + 1}`} title={rule.name}
      footer={<><SecondaryButton onClick={() => showToast("Replay queued: Jul–Sep re-evaluated into a shadow result set.")}><History className="w-4 h-4" /> Replay history</SecondaryButton><SecondaryButton onClick={() => setRan(true)}><FlaskConical className="w-4 h-4" /> Dry run (last 30 days)</SecondaryButton><PrimaryButton disabled={!ran} onClick={() => { showToast(`Published ${rule.id} v${rule.version + 1}. v${rule.version} closed, not deleted.`); onClose(); }}>Publish v{rule.version + 1}</PrimaryButton></>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Scope">
          <div className="space-y-3">
            <Field label="Products"><select id="rule-products" className={inputCls}><option>All products</option><option>Category: TV</option></select></Field>
            <Field label="Sources"><select id="rule-sources" className={inputCls}><option>Category: Marketplace + Online Seller</option><option>All sources</option></select></Field>
            <Field label="Region"><select id="rule-region" className={inputCls}><option>United States</option><option>Canada</option></select></Field>
            <Field label="Except seller classification"><select id="rule-class" className={inputCls}><option>Brand Direct</option><option>None</option></select></Field>
          </div>
        </Card>
        <Card title="Condition → verdict">
          <div className="space-y-2 text-xs">
            {[["", "Listing price", "is below", "MAP in force on observation date"], ["AND", "Depth", "greater than", "2% (tolerance)"], ["AND", "Sustained for", "at least", "1 observation"], ["AND NOT", "Promotion window", "is active for", "this seller + product"]].map((r, i) => (
              <div key={i} className="grid grid-cols-[56px_1fr_1fr_1.4fr] gap-1.5 items-center">
                <span className="text-brand-copper font-bold">{r[0]}</span>
                {r.slice(1).map((c, j) => <span key={j} className="border border-brand-beige rounded-md px-2 py-1.5 bg-brand-ivory text-brand-charcoal">{c}</span>)}
              </div>
            ))}
            <div className="border-t border-brand-beige pt-2 mt-2 text-brand-charcoal"><b>Verdict:</b> Violation · severity by depth — Minor &lt;5%, Standard 5–15%, Severe &gt;15%</div>
          </div>
        </Card>
      </div>
      {ran ? (
        <Card title="Dry-run result — Aug 24 to Sep 23" className="mt-4">
          <div className="flex gap-3 flex-wrap mb-3"><KPI label="Listings matched" value="1,904" /><KPI label="Violations created" value="212" /><KPI label="Newly created vs current" value="+9" subTone="text-red-600" sub="mostly TechMart" /><KPI label="Suppressed vs current" value="−4" sub="inside 2% tolerance" /></div>
          <Note>Blast radius: 7 of the 9 new violations are TechMart (Walmart). No change for MAP Authorised sellers.</Note>
        </Card>
      ) : (
        <div className="mt-4"><Note tone="bg-amber-50 text-amber-800 border-amber-200">Run a dry run to see the blast radius before this version can be published.</Note></div>
      )}
    </Drawer>
  );
}

// ============ DATA HEALTH ============
export function DataHealthView({ clientName }) {
  const showToast = useToast();
  const subs = SOURCES.filter((s) => s.subscribed);
  return (
    <div>
      <PageHeader title={`Data Health — ${clientName} (Sandbox)`} subtitle="A quiet week should mean few violations, not a broken collector." action={<SecondaryButton onClick={() => showToast("Re-run queued for degraded sources.")}><RefreshCw className="w-4 h-4" /> Re-run failed</SecondaryButton>} />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Coverage (last cycle)" value="91%" sub="terms executed / subscribed" subTone="text-amber-700 font-semibold" />
        <KPI label="Freshness SLA met" value="4 / 6" sub="sources observed within 24h" subTone="text-amber-700 font-semibold" />
        <KPI label="Extraction success" value="97.8%" />
        <KPI label="Evidence captured" value="100%" sub="of violations" subTone="text-emerald-700 font-semibold" />
        <KPI label="Rejected by validator" value="14" sub="suspicious prices held" />
      </div>
      <Card title="Per-source health">
        <Table columns={["Source", "Health", "Last successful run", "Failure streak", "Listings vs expected", "Error class", "Next report affected"]}>
          {subs.map((s) => (
            <tr key={s.name} className="hover:bg-brand-beige/20">
              <Td className="font-semibold">{s.name}</Td><Td><Pill text={s.health} tone={STATUS_BG[s.health]} /></Td><Td className="text-brand-taupe whitespace-nowrap">{s.lastRun}</Td>
              <Td className={s.streak ? "text-red-600 font-semibold" : ""}>{s.streak}</Td>
              <Td><span className="flex items-center gap-2 w-40"><span className="tabular-nums w-16">{s.listings}/{s.expected}</span><span className="flex-1"><Bar value={s.listings} max={s.expected || 1} tone={s.listings / (s.expected || 1) < 0.8 ? "bg-red-500" : "bg-emerald-500"} /></span></span></Td>
              <Td className="text-brand-taupe">{s.error || "—"}</Td>
              <Td className="text-brand-taupe">{s.health !== "Healthy" ? <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Weekly MAP Report · Mon</span> : "—"}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3"><Note>Reports generated while a source is degraded carry a data-quality banner, and trend charts shade those days instead of drawing a clean line.</Note></div>
      </Card>
    </div>
  );
}
