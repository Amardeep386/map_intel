// Mapping Center (docs/reference/prototype-src/views_catalog.jsx): which collected listings are
// the brand's products. Review queue with keyboard (I include · X exclude · A assign other SKU ·
// S skip), ordered by lowest confidence x deepest discount; listings per state with bulk
// actions; exclusions need a reason and scope, and scopes wider than the listing become
// standing suppressions. Every decision is saved as a label that trains the matcher.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, SkipForward, Check, Ban, History, Undo2, Upload, Sparkles, ExternalLink, SlidersHorizontal, Archive } from "lucide-react";
import { api } from "../api/client.js";
import {
  Card, Drawer, Field, KPI, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Tabs, Td, Toggle, inputCls,
} from "../ui.jsx";
import { TONE, formatDay, money } from "../format.js";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";
import { ImportModal } from "./CatalogViews.jsx";

const SIGNAL_LABEL = { identifier: "Identifier", title: "Title similarity", image: "Image similarity", price: "Price plausibility", attributes: "Attributes", prior: "Prior decisions" };
const STATES = ["Staged", "Included", "Excluded", "Retired"];

export function MappingCenterView() {
  const { client, can, showToast } = useWorkspace();
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState("queue");
  const [excl, setExcl] = useState(null); // listings to exclude
  const [assign, setAssign] = useState(null); // listing to assign to another SKU
  const [detail, setDetail] = useState(null);
  const [modal, setModal] = useState(null); // 'import' | 'rules'
  const [products, setProducts] = useState([]);
  const [version, setVersion] = useState(0); // bumps after every change so tabs reload

  const loadSummary = useCallback(async () => {
    const s = await attempt(showToast, () => api.mappingSummary(client));
    if (s) setSummary(s);
  }, [client, showToast]);
  useEffect(() => { attempt(showToast, loadSummary); }, [loadSummary, showToast, version]);
  useEffect(() => { attempt(showToast, () => api.products(client)).then((p) => p && setProducts(p)); }, [client, showToast]);

  const writable = can("mapping.write");
  const decide = async (body, message) => {
    const r = await attempt(showToast, () => api.mappingDecide(client, body));
    if (!r) return false;
    const sup = r.suppression;
    showToast(sup ? `${message} Saved as suppression ${sup.code}${sup.alsoExcluded ? ` (${sup.alsoExcluded} more excluded)` : ""}.` : message);
    setVersion((v) => v + 1);
    return true;
  };
  const include = (items, productId) =>
    decide({ listingIds: items.map((i) => i.id), action: "include", productId: productId ?? undefined },
      items.length === 1 ? `Included → ${products.find((p) => p.id === (productId ?? items[0].product_id))?.code ?? items[0].product_code}. Decision saved as a training label.` : `Included ${items.length} listings.`);

  const t = summary?.thresholds;
  const st = summary?.states ?? {};
  const tabs = [
    { id: "queue", label: "Review queue", count: st.Staged },
    ...STATES.map((s) => ({ id: s, label: s, count: st[s] })),
    { id: "suppress", label: "Suppressions", count: summary?.suppressions },
  ];
  return (
    <div>
      <PageHeader
        title={`Mapping Center — ${client.name} (${client.status})`}
        subtitle={t ? `Auto-include ≥ ${t.include} · review ${t.review}–${t.include - 1} · auto-exclude < ${t.review} (thresholds in Settings)` : " "}
        action={writable && <SecondaryButton onClick={() => setModal("import")}><Upload className="w-4 h-4" /> Import listings</SecondaryButton>}
      />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Staged today" value={summary?.today.staged_today ?? "—"} sub="collected, scored" />
        <KPI label="Auto-included today" value={summary?.today.auto_included ?? "—"} sub={t ? `≥ ${t.include} or an inclusion rule` : ""} />
        <KPI label="In review band" value={st.Staged ?? "—"} sub="ordered by risk" />
        <KPI label="Auto-excluded today" value={summary?.today.auto_excluded ?? "—"} sub="kept & searchable" />
        <KPI label="Decided by analysts today" value={summary?.today.decided_today ?? "—"} sub="saved as labels" />
      </div>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={tabs}
          right={<SecondaryButton onClick={() => setModal("rules")}><SlidersHorizontal className="w-3.5 h-3.5" /> Rules</SecondaryButton>} />
        {tab === "queue" && summary && (
          <ReviewQueue key={version} writable={writable} onInclude={(i) => include([i])} onExclude={(i) => setExcl([i])} onAssign={setAssign} onOpen={setDetail} />
        )}
        {STATES.includes(tab) && (
          <ListingTable key={`${tab}-${version}`} state={tab} writable={writable} onOpen={setDetail}
            onInclude={(items) => include(items)} onExclude={setExcl}
            onRestore={(items) => decide({ listingIds: items.map((i) => i.id), action: "restore" }, `Restored ${items.length} listing${items.length === 1 ? "" : "s"} to review.`)}
            onRetire={(items) => decide({ listingIds: items.map((i) => i.id), action: "retire" }, `Retired ${items.length} listing${items.length === 1 ? "" : "s"}.`)}
            onApplyRules={async () => {
              const r = await attempt(showToast, () => api.applyMatchRules(client));
              if (r) {
                showToast(`Rules applied to ${r.checked} staged listings: ${r.included} included, ${r.excluded} excluded.`);
                setVersion((v) => v + 1);
              }
            }} />
        )}
        {tab === "suppress" && <Suppressions key={version} writable={writable} onChanged={() => setVersion((v) => v + 1)} />}
      </Card>

      {excl && summary && <ExcludeModal items={excl} summary={summary} onClose={() => setExcl(null)}
        onSubmit={async (body) => {
          if (await decide({ listingIds: excl.map((i) => i.id), action: "exclude", ...body }, body.scope === "listing" ? `Excluded — ${body.reason}.` : "Excluded.")) setExcl(null);
        }} />}
      {assign && <AssignModal item={assign} products={products} onClose={() => setAssign(null)}
        onSubmit={async (productId) => { if (await include([assign], productId)) setAssign(null); }} />}
      {detail && <ListingDrawer listingId={detail} onClose={() => setDetail(null)} />}
      {modal === "import" && <ImportModal kind="listings" onClose={() => setModal(null)} onDone={() => setVersion((v) => v + 1)} />}
      {modal === "rules" && <RulesModal writable={writable} onClose={() => setModal(null)} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

// ---------------- Review queue ----------------
function ReviewQueue({ writable, onInclude, onExclude, onAssign, onOpen }) {
  const { client, showToast } = useWorkspace();
  const [data, setData] = useState(null);
  const [i, setI] = useState(0);
  const busy = useRef(false);

  useEffect(() => { attempt(showToast, () => api.mappingQueue(client)).then((d) => d && setData(d)); }, [client, showToast]);
  const items = data?.items ?? [];
  const item = items.length ? items[Math.min(i, items.length - 1)] : null;

  useEffect(() => {
    const h = async (e) => {
      if (!item || !writable || busy.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || document.querySelector("[data-modal-open]")) return;
      const k = e.key.toLowerCase();
      if (k === "i") { busy.current = true; await onInclude(item); busy.current = false; }
      else if (k === "x") onExclude(item);
      else if (k === "a") onAssign(item);
      else if (k === "s") setI((n) => (n + 1) % items.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [item, items.length, writable, onInclude, onExclude, onAssign]);

  if (!data) return <div className="text-center py-10 text-sm text-brand-taupe">Loading the queue…</div>;
  if (!item) return <div className="text-center py-10 text-sm text-brand-taupe">Queue clear — nothing left in the review band.</div>;
  const p = item.proposed;
  return (
    <div>
      <div className="flex justify-between items-center mb-3 text-xs text-brand-taupe flex-wrap gap-2">
        <span>Candidate {Math.min(i, items.length - 1) + 1} of {data.total} · ordered by lowest confidence × deepest discount</span>
        <span className="inline-flex items-center gap-1.5"><Keyboard className="w-3.5 h-3.5" /><b>I</b> include · <b>X</b> exclude · <b>A</b> assign other SKU · <b>S</b> skip</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold">Collected listing</div>
            {item.origin === "synthetic" && <Pill text="Synthetic" tone={TONE.Synthetic} />}
          </div>
          <div className="text-sm font-semibold text-brand-charcoal mb-2">{item.title || "(no title captured)"}</div>
          <div className="space-y-1.5 text-xs">
            <KV k="Seller" v={item.seller || "—"} /><KV k="Source" v={item.source} /><KV k="Price" v={money(item.price)} />
            {item.condition && <KV k="Condition" v={item.condition} />}{item.listing_format && <KV k="Format" v={item.listing_format} />}
            <KV k="Listing" v={<a href={item.url} target="_blank" rel="noreferrer" className="text-brand-copper inline-flex items-center gap-1">Open <ExternalLink className="w-3 h-3" /></a>} />
          </div>
          <button onClick={() => onOpen(item.id)} className="mt-3 text-xs text-brand-taupe hover:text-brand-charcoal cursor-pointer inline-flex items-center gap-1"><History className="w-3.5 h-3.5" /> History</button>
        </div>
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold mb-2">Confidence breakdown</div>
          <div className="text-3xl font-bold text-brand-charcoal mb-3 tabular-nums">{Math.round(item.confidence)}<span className="text-sm text-brand-taupe font-normal"> / 100</span></div>
          <Signals signals={item.signals} />
        </div>
        <div className="border border-brand-beige rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-brand-taupe font-semibold mb-2">Proposed product</div>
          {p ? (
            <>
              <div className="text-sm font-semibold text-brand-copper mb-2">{p.code} — {p.name}</div>
              <div className="space-y-1.5 text-xs"><KV k="Model / MPN" v={p.model || "—"} /><KV k="MAP in force" v={money(p.map)} /><KV k="MSRP" v={money(p.msrp)} /><KV k="UPC" v={p.upc || "—"} /><KV k="ASIN" v={p.asin || "—"} /></div>
            </>
          ) : <div className="text-xs text-brand-taupe">No product in the catalogue resembles this listing.</div>}
        </div>
      </div>
      {writable && (
        <div className="flex justify-end gap-2 mt-4 flex-wrap">
          <SecondaryButton onClick={() => setI((n) => (n + 1) % items.length)}><SkipForward className="w-4 h-4" /> Skip</SecondaryButton>
          <SecondaryButton onClick={() => onExclude(item)}><Ban className="w-4 h-4" /> Exclude…</SecondaryButton>
          <SecondaryButton onClick={() => onAssign(item)}>Assign other SKU</SecondaryButton>
          {p && <PrimaryButton onClick={() => onInclude(item)}><Check className="w-4 h-4" /> Include as {p.code}</PrimaryButton>}
        </div>
      )}
    </div>
  );
}

function Signals({ signals }) {
  return (
    <div className="space-y-2 text-xs">
      {signals.map((s) => (
        <div key={s.signal} className="flex justify-between gap-2" title={s.score === null ? "not available: its weight went to the other signals" : `score ${s.score} · weight ${s.weight}%`}>
          <span className="text-brand-taupe whitespace-nowrap">{SIGNAL_LABEL[s.signal]}</span>
          <span className={`font-semibold text-right ${s.passed === null ? "text-brand-taupe" : s.passed ? "text-emerald-700" : "text-red-600"}`}>
            {s.passed === null ? "n/a" : s.passed ? "✓" : "✗"} {s.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------- Listings per state ----------------
function ListingTable({ state, writable, onOpen, onInclude, onExclude, onRestore, onRetire, onApplyRules }) {
  const { client, showToast } = useWorkspace();
  const [q, setQ] = useState("");
  const [data, setData] = useState({ total: 0, items: [] });
  const [sel, setSel] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    const d = await attempt(showToast, () => api.mappingListings(client, { state, q, offset, limit: 100 }));
    setLoading(false);
    if (d) setData((prev) => (offset ? { total: d.total, items: [...prev.items, ...d.items] } : d));
  }, [client, state, q, showToast]);
  useEffect(() => {
    const t = setTimeout(() => load(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const chosen = data.items.filter((i) => sel.has(i.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = data.items.length > 0 && chosen.length === data.items.length;
  const bulk = writable && chosen.length > 0;
  return (
    <>
      <div className="flex justify-between mb-3 gap-2 flex-wrap items-center">
        <SearchBox placeholder="Search product, URL, seller, title..." value={q} onChange={setQ} />
        <div className="flex gap-2 flex-wrap">
          {bulk && state === "Staged" && <><SecondaryButton onClick={() => onExclude(chosen)}><Ban className="w-3.5 h-3.5" /> Exclude {chosen.length}…</SecondaryButton>
            <PrimaryButton onClick={() => onInclude(chosen)}><Check className="w-4 h-4" /> Include {chosen.length} as proposed</PrimaryButton></>}
          {bulk && state === "Excluded" && <SecondaryButton onClick={() => onRestore(chosen)}><Undo2 className="w-3.5 h-3.5" /> Restore {chosen.length}</SecondaryButton>}
          {bulk && state === "Included" && <SecondaryButton onClick={() => onRetire(chosen)}><Archive className="w-3.5 h-3.5" /> Retire {chosen.length}</SecondaryButton>}
          {bulk && state === "Retired" && <SecondaryButton onClick={() => onRestore(chosen)}><Undo2 className="w-3.5 h-3.5" /> Back to review</SecondaryButton>}
          {writable && state === "Staged" && !chosen.length && <PrimaryButton onClick={onApplyRules}><Sparkles className="w-4 h-4" /> Apply rules now</PrimaryButton>}
        </div>
      </div>
      <Table columns={[
        writable ? <input key="all" type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(data.items.map((i) => i.id)))} aria-label="Select all" /> : "",
        state === "Staged" ? "Detected listing" : "Listing", "Seller", "Price", state === "Staged" ? "Proposed match" : "Product (client SKU)", "Confidence",
        state === "Staged" ? "Seen" : state === "Excluded" ? "Reason" : "Decided by", state === "Staged" ? "" : "Since",
      ]}>
        {data.items.map((r) => (
          <tr key={r.id} className="hover:bg-brand-beige/20">
            <Td>{writable && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select" />}</Td>
            <Td className="font-medium max-w-sm">
              <button onClick={() => onOpen(r.id)} className="text-left cursor-pointer hover:underline">{r.title || r.url}</button>
              <div className="text-[10px] text-brand-taupe flex gap-1.5 items-center">{r.source}{r.origin === "synthetic" && <Pill text="Synthetic" tone={TONE.Synthetic} />}</div>
            </Td>
            <Td className="text-brand-taupe">{r.seller || "—"}</Td>
            <Td>{money(r.price)}</Td>
            <Td>{r.product_code ? <span className={state === "Staged" ? "text-brand-copper font-semibold" : ""}>{r.product_code}</span> : <span className="text-brand-taupe">No match</span>}</Td>
            <Td>{r.confidence != null ? <Pill text={Math.round(r.confidence)} tone={r.confidence >= 90 ? TONE.include : r.confidence >= 60 ? TONE.review : TONE.exclude} /> : "—"}</Td>
            <Td className="text-brand-taupe text-xs">
              {state === "Staged" ? formatWhen(r.seen_at)
                : state === "Excluded" ? <><Pill text={r.reason || "—"} />{r.scope && r.scope !== "listing" && <span className="ml-1">({r.scope.replace("_", " + ")})</span>}</>
                : <Pill text={r.rule_code ? `Rule ${r.rule_code}` : r.decided_label || r.decided_by} tone={r.decided_by === "user" ? TONE.Paused : TONE.Scheduled} />}
            </Td>
            <Td className="text-brand-taupe text-xs">{state === "Staged" ? "" : formatDay(r.state_since)}</Td>
          </tr>
        ))}
      </Table>
      <div className="flex justify-between items-center mt-3 text-xs text-brand-taupe">
        <span>{loading ? "Loading…" : `Showing ${data.items.length} of ${data.total}`}</span>
        {data.items.length < data.total && <SecondaryButton onClick={() => load(data.items.length)}>Load more</SecondaryButton>}
      </div>
    </>
  );
}

// ---------------- Suppressions ----------------
function Suppressions({ writable, onChanged }) {
  const { client, showToast } = useWorkspace();
  const [rows, setRows] = useState([]);
  useEffect(() => { attempt(showToast, () => api.suppressions(client)).then((r) => r && setRows(r)); }, [client, showToast]);
  const revoke = async (s) => {
    if (await attempt(showToast, () => api.revokeSuppression(client, s.id))) {
      showToast(`Suppression ${s.code} revoked: new listings are matched normally again.`);
      onChanged();
    }
  };
  return (
    <>
      <Table columns={["Code", "Standing rule", "Reason", "Scope", "Created", "Listings suppressed", ""]}>
        {rows.map((s) => (
          <tr key={s.id} className={s.revoked_at ? "opacity-50" : ""}>
            <Td className="font-semibold">{s.code}</Td><Td className="font-medium max-w-xs truncate">{s.rule}</Td><Td><Pill text={s.reason} /></Td>
            <Td className="text-brand-taupe">{s.scopeLabel}</Td><Td className="text-brand-taupe">{formatDay(s.created_at)} · {s.created_by}</Td><Td>{s.hits}</Td>
            <Td>{s.revoked_at ? <span className="text-xs text-brand-taupe">Revoked {formatDay(s.revoked_at)}</span>
              : writable && <button onClick={() => revoke(s)} className="text-xs text-brand-copper hover:underline cursor-pointer">Revoke</button>}</Td>
          </tr>
        ))}
      </Table>
      {!rows.length && <div className="text-center py-8 text-sm text-brand-taupe">No suppressions yet. Excluding with a scope wider than the listing creates one.</div>}
      <div className="mt-3"><Note>Scoped exclusions become suppressions, so the same wrong listing is never reviewed twice — and every one stays visible and revocable. Revoking does not bring back listings already excluded.</Note></div>
    </>
  );
}

// ---------------- Modals and drawer ----------------
function ExcludeModal({ items, summary, onClose, onSubmit }) {
  const first = items[0];
  const [scope, setScope] = useState("listing");
  const guess = (() => {
    try {
      const u = new URL(first.url);
      return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/[^/]*$/, "")}*`;
    } catch { return ""; }
  })();
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    onSubmit({ reason: f.get("reason"), scope, urlPattern: scope === "url_pattern" ? f.get("pattern") : undefined, note: f.get("note") || undefined });
  };
  const scopes = items.length > 1 ? summary.scopes.filter((s) => s.id !== "seller_product") : summary.scopes;
  return (
    <Modal open onClose={onClose} title={items.length > 1 ? `Exclude ${items.length} listings` : "Exclude listing"}>
      <form data-modal-open className="space-y-4" onSubmit={submit}>
        <div className="text-xs text-brand-charcoal font-semibold">{items.length > 1 ? `${items.length} selected listings` : first.title || first.url}</div>
        <Field label="Reason *"><select name="reason" className={inputCls} autoFocus>{summary.reasons.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Apply to *">
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
            {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}{s.id === "seller_product" && first.seller && first.product_code ? ` (${first.seller} × ${first.product_code})` : s.id === "source" ? ` (everything on ${first.source})` : ""}</option>)}
          </select>
        </Field>
        {scope === "url_pattern" && <Field label="URL pattern (* = anything) *"><input name="pattern" defaultValue={guess} required className={`${inputCls} font-mono text-xs`} /></Field>}
        {scope !== "listing" && <Note>This becomes a standing suppression: matching listings, now in review and found later, are excluded automatically. You can revoke it under Suppressions.</Note>}
        <Field label="Note"><input name="note" className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Exclude</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function AssignModal({ item, products, onClose, onSubmit }) {
  const submit = (e) => {
    e.preventDefault();
    onSubmit(new FormData(e.target).get("product"));
  };
  return (
    <Modal open onClose={onClose} title="Include as another SKU">
      <form data-modal-open className="space-y-4" onSubmit={submit}>
        <div className="text-xs text-brand-charcoal font-semibold">{item.title || item.url}</div>
        <Field label="SKU *">
          <select name="product" defaultValue={item.product_id ?? ""} className={inputCls} autoFocus>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit"><Check className="w-4 h-4" /> Include</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function ListingDrawer({ listingId, onClose }) {
  const { client, showToast } = useWorkspace();
  const [l, setL] = useState(null);
  useEffect(() => { attempt(showToast, () => api.mappingListing(client, listingId)).then((x) => x && setL(x)); }, [client, listingId, showToast]);
  if (!l) return null;
  return (
    <Drawer open onClose={onClose} eyebrow={`Listing · ${l.source}`} title={l.title || l.url} width="w-[760px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Listing">
          <div className="space-y-2 text-xs">
            <KV k="State" v={<Pill text={l.state} tone={TONE[l.state]} />} /><KV k="Product" v={l.product_code ? `${l.product_code} — ${l.product_name}` : "—"} />
            <KV k="Seller" v={l.seller || "—"} /><KV k="Price seen" v={money(l.price)} /><KV k="Origin" v={l.origin} />
            <KV k="URL" v={<a href={l.url} target="_blank" rel="noreferrer" className="text-brand-copper break-all">{l.url}</a>} />
          </div>
        </Card>
        <Card title={`Confidence ${l.confidence != null ? Math.round(l.confidence) : "—"} / 100`}>{l.signals?.length ? <Signals signals={l.signals} /> : <span className="text-xs text-brand-taupe">Not scored.</span>}</Card>
      </div>
      <Card title="Decision history" className="mt-4">
        <div className="space-y-3 text-xs relative pl-3.5 border-l border-brand-beige">
          {l.history.map((h, i) => (
            <div key={i} className="relative">
              <span className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ${h.is_label ? "bg-brand-copper" : "bg-brand-beige"}`} />
              <div><b>{h.from_state ?? "New"} → {h.to_state}</b>{h.product_code ? ` as ${h.product_code}` : ""}{h.reason ? ` · ${h.reason}` : ""}{h.scope && h.scope !== "listing" ? ` (${h.scope.replace("_", " + ")})` : ""}</div>
              <div className="text-brand-taupe">{formatWhen(h.created_at)} · {h.actor_label}{h.is_label ? " · training label" : ""}</div>
            </div>
          ))}
        </div>
      </Card>
    </Drawer>
  );
}

function RulesModal({ writable, onClose, onChanged }) {
  const { client, showToast } = useWorkspace();
  const [rules, setRules] = useState([]);
  const load = useCallback(async () => { const r = await attempt(showToast, () => api.matchRules(client)); if (r) setRules(r); }, [client, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  const toggle = async (r) => {
    if (await attempt(showToast, () => api.setMatchRule(client, r.id, { active: !r.active }))) {
      await load();
      onChanged();
    }
  };
  return (
    <Modal open onClose={onClose} title="Inclusion and exclusion rules" width="w-[44rem]">
      <Table columns={["Rule", "Kind", "Order", "Hits", "Active"]}>
        {rules.map((r) => (
          <tr key={r.id}>
            <Td><div className="font-semibold">{r.code}</div><div className="text-[11px] text-brand-taupe">{r.name}</div></Td>
            <Td><Pill text={r.kind === "include" ? "Include" : "Exclude"} tone={r.kind === "include" ? TONE.Included : TONE.Excluded} /></Td>
            <Td>{r.priority}</Td><Td>{r.hits}</Td>
            <Td><Toggle on={r.active} onChange={() => toggle(r)} disabled={!writable} /></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Note>Suppressions come first, then rules in order (exclusions before inclusions), then the confidence bands. An inclusion rule never includes a used, refurbished, accessory, variant or other-region listing.</Note></div>
    </Modal>
  );
}
