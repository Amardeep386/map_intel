// Sellers (docs/reference/prototype-src/views_monitor.jsx): storefronts found on the account's
// listings, with effective-dated classification (a change is a new record), aliases, linked
// sellers and notice contacts. P4: risk index (frequency, depth, recurrence, responsiveness over 90
// days), violations, time to compliance and compliance per seller; open a case from the profile.
import React, { useCallback, useEffect, useState } from "react";
import { Gavel, Plus, Store, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import {
  Bar, Card, Drawer, Field, KPI, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Td, inputCls,
} from "../ui.jsx";
import { TONE, formatDay, money } from "../format.js";
import { attempt, useWorkspace } from "../workspace.js";
import { DEMO_MERCHANTS } from "../api/mock/demo.js";

const CLASSES = ["MAP Authorised", "Unauthorised", "Brand Direct", "Unknown"];
// Every merchant on the brands' lists is a catalogue source (server/src/collector/catalogue.ts).
const SOURCES = DEMO_MERCHANTS.map((m) => [m.source, m.name]).sort((x, y) => x[1].localeCompare(y[1]));

const riskTone = (r) => (r > 60 ? "bg-red-500" : r > 30 ? "bg-amber-500" : "bg-emerald-500");
const hours = (h) => (h === null || h === undefined ? "—" : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);
const pct = (p) => (p === null || p === undefined ? "—" : `${p}%`);

function RiskCell({ value }) {
  if (value === undefined) return <span className="text-brand-taupe">—</span>;
  return (
    <span className="flex items-center gap-2 w-24">
      <span className="tabular-nums w-6">{value}</span>
      <span className="flex-1"><Bar value={value} max={100} tone={riskTone(value)} /></span>
    </span>
  );
}

export function SellersView() {
  const { client, can, showToast } = useWorkspace();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("All");
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => setRows((await attempt(showToast, () => api.sellers(client))) ?? []), [client, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const list = (rows ?? [])
    .filter((s) => (cls === "All" || s.classification === cls) && `${s.name} ${s.source}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => (y.risk ?? 0) - (x.risk ?? 0) || x.name.localeCompare(y.name));
  const count = (c) => (rows ?? []).filter((s) => s.classification === c).length;
  return (
    <div>
      <PageHeader title={`Sellers — ${client.name} (${client.status})`} subtitle="Storefronts found on each source, with effective-dated classification."
        action={can("sellers.write") && <PrimaryButton onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add seller</PrimaryButton>} />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Sellers" value={rows?.length ?? "—"} sub="on this account's listings" />
        <KPI label="Unauthorised" value={count("Unauthorised")} subTone="text-red-600 font-semibold" sub="classified" />
        <KPI label="MAP Authorised" value={count("MAP Authorised")} />
        <KPI label="Unknown" value={count("Unknown")} sub="waiting for a classification" subTone="text-amber-700" />
        <KPI label="High risk" value={(rows ?? []).filter((s) => (s.risk ?? 0) > 60).length} sub="risk index above 60 (90 days)" subTone="text-red-600 font-semibold" />
      </div>
      <Card>
        <div className="flex justify-between mb-4 gap-3 flex-wrap">
          <SearchBox value={q} onChange={setQ} placeholder="Search seller or source..." />
          <select value={cls} onChange={(e) => setCls(e.target.value)} className={`${inputCls} !w-48`}>{["All", ...CLASSES].map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <Table columns={["Seller", "Source", "Classification", "Risk index", "Tracked SKUs", "Violations (90d)", "Repeat", "Avg depth", "Time to compliance", "Compliance", "Notice contact"]}>
          {list.map((m) => (
            <tr key={m.id} onClick={() => setSel(m.id)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold"><span className="flex items-center gap-2"><Store className="w-4 h-4 text-brand-taupe" />{m.name}</span></Td>
              <Td className="text-brand-taupe">{m.source}</Td>
              <Td><Pill text={m.classification} tone={TONE[m.classification]} /></Td>
              <Td><RiskCell value={m.risk} /></Td>
              <Td>{m.tracked}</Td>
              <Td>{m.violations ? <Pill text={m.active ? `${m.violations} · ${m.active} open` : m.violations} tone={TONE.Open} /> : "0"}</Td>
              <Td>{m.repeats ?? "—"}</Td>
              <Td>{pct(m.avgDepthPct)}</Td>
              <Td className="text-brand-taupe">{hours(m.ttcHours)}</Td>
              <Td><span className={m.compliancePct === null || m.compliancePct === undefined ? "text-brand-taupe" : m.compliancePct >= 90 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>{pct(m.compliancePct)}</span></Td>
              <Td>{m.contacts ? <span className="text-emerald-700 text-xs font-semibold">✓ {m.contacts}</span> : <span className="text-amber-700 text-xs">Missing</span>}</Td>
            </tr>
          ))}
        </Table>
        <div className="text-xs text-brand-taupe mt-3">{rows ? `Showing ${list.length} of ${rows.length} sellers` : "Loading…"}</div>
      </Card>
      {sel && <SellerDrawer sellerId={sel} sellers={rows ?? []} onClose={() => setSel(null)} onChanged={load} />}
      {adding && <AddSellerModal onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}

function SellerDrawer({ sellerId, sellers, onClose, onChanged }) {
  const { client, can, showToast } = useWorkspace();
  const [s, setS] = useState(null);
  const [modal, setModal] = useState(null); // 'class' | 'alias' | 'link' | 'contact'
  const load = useCallback(async () => {
    const r = await attempt(showToast, () => api.seller(client, sellerId));
    if (r) setS(r);
  }, [client, sellerId, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  if (!s) return null;
  const writable = can("sellers.write");
  const st = s.stats ?? {};
  const openable = (s.violations ?? []).filter((v) => !v.episode_closed && !v.case_id);
  const after = async (msg) => {
    showToast(msg);
    setModal(null);
    await load();
    await onChanged();
  };
  const removeContact = async (c) => {
    if ((await attempt(showToast, () => api.removeSellerContact(client, s.id, c.id))) !== undefined) await after("Contact removed.");
  };
  return (
    <Drawer open onClose={onClose} eyebrow="Seller profile" title={`${s.name} — ${s.source}`}
      footer={writable && <>
        <SecondaryButton onClick={() => setModal("alias")}>Add alias</SecondaryButton>
        <SecondaryButton onClick={() => setModal("link")}>Link seller</SecondaryButton>
        <SecondaryButton onClick={() => setModal("contact")}>Add contact</SecondaryButton>
        <SecondaryButton onClick={() => setModal("class")}>Change classification</SecondaryButton>
        {can("cases.write") && <PrimaryButton onClick={() => setModal("case")} disabled={!openable.length}><Gavel className="w-4 h-4" /> Open case</PrimaryButton>}
      </>}>
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Risk index" value={st.risk ?? "—"} sub="frequency · depth · recurrence · response" />
        <KPI label="Violations (90d)" value={st.violations ?? "—"} sub={`${st.repeats ?? 0} repeat · ${st.active ?? 0} open`} />
        <KPI label="Avg discount depth" value={pct(st.avgDepthPct)} />
        <KPI label="Time to compliance" value={hours(st.ttcHours)} sub="median, to the fixed price" />
        <KPI label="Compliance" value={pct(st.compliancePct)} sub="observations at or above MAP" />
      </div>
      {st.parts && (
        <Card title="How the risk index is made" className="mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {[["Frequency", st.parts.frequency, `${st.violations} violations (5 = full)`, 35],
              ["Depth", st.parts.depth, `${pct(st.avgDepthPct)} average (30% = full)`, 25],
              ["Recurrence", st.parts.recurrence, `${st.repeats} repeats (3 = full)`, 25],
              ["Responsiveness", st.parts.responsiveness, st.noticesDue ? `${st.unanswered} of ${st.noticesDue} notices unanswered` : "no notice due yet: not counted", 15]].map(([k, v, why, w]) => (
              <div key={k}>
                <div className="flex justify-between mb-1"><span className="font-semibold">{k}</span><span className="text-brand-taupe">weight {w}</span></div>
                {v === null ? <div className="h-2" /> : <Bar value={Math.round(v * 100)} max={100} tone={riskTone(v * 100)} />}
                <div className="text-brand-taupe mt-1">{why}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Classification history">
          <div className="space-y-3 text-xs relative pl-3.5 border-l border-brand-beige">
            {s.history.map((h) => (
              <div key={h.id} className="relative">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-copper" />
                <Pill text={h.class} tone={TONE[h.class]} />
                <div className="text-brand-taupe mt-1">{formatDay(h.from)} → {h.to ? formatDay(h.to) : "now"}</div>
                <div className="text-[10px] text-brand-copper">{h.set_by} · “{h.note}”</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Identity & contact">
          <div className="space-y-2.5 text-xs">
            <KV k="Canonical name" v={s.name} />
            <KV k="Aliases" v={s.aliases.length ? s.aliases.map((a) => a.alias).join(", ") : "—"} />
            <KV k="Linked sellers" v={s.links.length ? s.links.map((l) => `${l.name} (${l.source}, ${l.confidence}% — ${l.reason})`).join("; ") : "—"} />
            <KV k="Storefront" v={s.storefront_url ? <a className="text-brand-copper" href={s.storefront_url} target="_blank" rel="noreferrer">{s.storefront_url}</a> : "—"} />
            <div className="pt-2 border-t border-brand-beige">
              <div className="text-brand-taupe mb-1">Notice contacts</div>
              {s.contacts.length ? s.contacts.map((c) => (
                <div key={c.id} className="flex justify-between items-center py-0.5">
                  <span><b>{c.kind}</b> {c.value}{c.label ? ` · ${c.label}` : ""}</span>
                  {writable && <button onClick={() => removeContact(c)} className="text-brand-taupe hover:text-red-600 cursor-pointer" aria-label="Remove contact"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              )) : <span className="text-amber-700">Missing — add before sending notices</span>}
            </div>
          </div>
        </Card>
      </div>
      {(s.violations ?? []).length > 0 && (
        <Card title="Violations" className="mt-4">
          <Table columns={["Violation", "Product", "Advertised", "MAP", "Deepest", "Status", "Since", "Case"]}>
            {s.violations.map((v) => (
              <tr key={v.id}>
                <Td className="font-semibold text-brand-copper">{v.code}</Td>
                <Td>{v.sku} — {v.product}</Td>
                <Td>{money(v.last_price)}</Td>
                <Td className="text-brand-taupe">{money(v.last_map)}</Td>
                <Td>{pct(v.max_depth_pct === null ? null : Math.round(v.max_depth_pct * 10) / 10)}</Td>
                <Td><Pill text={v.status} tone={TONE[v.status]} /></Td>
                <Td className="text-brand-taupe">{formatDay(v.opened_at)}</Td>
                <Td className="text-brand-taupe">{v.case_code ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {(s.cases ?? []).length > 0 && (
            <div className="text-xs text-brand-taupe mt-3">Cases: {s.cases.map((c) => `${c.code} (${c.state})`).join(" · ")}</div>
          )}
        </Card>
      )}
      <Card title="Listings" className="mt-4">
        {s.listings.length ? (
          <Table columns={["Product", "State", "URL"]}>
            {s.listings.slice(0, 50).map((l) => (
              <tr key={l.id}><Td>{l.code ? `${l.code} — ${l.product}` : "—"}</Td><Td><Pill text={l.state} tone={TONE[l.state]} /></Td>
                <Td><a href={l.url} target="_blank" rel="noreferrer" className="text-brand-copper text-xs truncate inline-block max-w-md">{l.url}</a></Td></tr>
            ))}
          </Table>
        ) : <div className="text-xs text-brand-taupe py-3">No listings for this account yet.</div>}
      </Card>
      {modal === "class" && <ClassifyModal seller={s} onClose={() => setModal(null)} onDone={after} />}
      {modal === "alias" && <SimpleModal title="Add alias" label="Other name this seller uses" field="alias" onClose={() => setModal(null)}
        onSubmit={(v) => api.addSellerAlias(client, s.id, { alias: v.alias })} onDone={() => after("Alias added.")} />}
      {modal === "link" && <LinkModal seller={s} sellers={sellers} onClose={() => setModal(null)} onDone={() => after("Sellers linked.")} />}
      {modal === "contact" && <ContactModal seller={s} onClose={() => setModal(null)} onDone={() => after("Contact added.")} />}
      {modal === "case" && <OpenCaseModal seller={s} violations={openable} onClose={() => setModal(null)} onDone={(code) => after(`Case ${code} opened. Draft the notice from Enforcement.`)} />}
    </Drawer>
  );
}

function OpenCaseModal({ seller, violations, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const [picked, setPicked] = useState(() => new Set(violations.map((v) => v.id)));
  const toggle = (vid) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(vid)) n.delete(vid); else n.add(vid);
    return n;
  });
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { violationIds: [...picked], responseDue: f.get("due") || undefined, note: f.get("note") || undefined };
    const r = await attempt(showToast, () => api.openCase(client, body));
    if (r) await onDone(r.code);
  };
  return (
    <Modal open onClose={onClose} title={`Open a case — ${seller.name}`} width="w-[34rem]">
      <form onSubmit={submit} className="space-y-3">
        <div className="text-xs text-brand-taupe">Open violations of this seller that are not in a case yet:</div>
        <div className="space-y-1.5 max-h-56 overflow-auto">
          {violations.map((v) => (
            <label key={v.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} />
              <span className="font-semibold">{v.code}</span><span>{v.sku}</span>
              <span className="text-brand-taupe">{money(v.last_price)} vs MAP {money(v.last_map)}</span>
            </label>
          ))}
        </div>
        <Field label="Response due (default: in 7 days)"><input name="due" type="date" className={inputCls} /></Field>
        <Field label="Note"><input name="note" placeholder="e.g. Two gram laptops far below MAP" className={inputCls} /></Field>
        <Note>The violations go Under notice when a notice is sent from the case.</Note>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit" disabled={!picked.size}>Open case</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function ClassifyModal({ seller, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (await attempt(showToast, () => api.classifySeller(client, seller.id, { class: f.get("class"), note: f.get("note") }))) await onDone("Classification change saved as a new effective-dated record.");
  };
  return (
    <Modal open onClose={onClose} title={`Change classification — ${seller.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="New classification *"><select name="class" defaultValue={seller.classification === "Unknown" ? "Unauthorised" : "Unknown"} className={inputCls}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Why *"><input name="note" required placeholder='e.g. "Not on the LG authorised list v9"' className={inputCls} /></Field>
        <Note>From now on. Earlier records stay as they were, and past violations keep the class they were captured with.</Note>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Save</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function SimpleModal({ title, label, field, onClose, onSubmit, onDone }) {
  const { showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const value = String(new FormData(e.target).get(field) ?? "").trim();
    if (await attempt(showToast, () => onSubmit({ [field]: value }))) await onDone();
  };
  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={`${label} *`}><input name={field} required className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Save</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function LinkModal({ seller, sellers, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { otherSellerId: f.get("other"), reason: f.get("reason"), confidence: Number(f.get("confidence")) };
    if (await attempt(showToast, () => api.linkSeller(client, seller.id, body))) await onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Link ${seller.name} to another seller`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Other seller *"><select name="other" className={inputCls}>{sellers.filter((x) => x.id !== seller.id).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.source})</option>)}</select></Field>
        <Field label="Why they are linked *"><input name="reason" required placeholder="e.g. Shared address" className={inputCls} /></Field>
        <Field label="Confidence (%)"><input name="confidence" type="number" min="0" max="100" defaultValue="60" className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Link</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function ContactModal({ seller, onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { kind: f.get("kind"), value: f.get("value"), label: f.get("label") || undefined };
    if (await attempt(showToast, () => api.addSellerContact(client, seller.id, body))) await onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Notice contact — ${seller.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Kind *"><select name="kind" className={inputCls}>{["email", "phone", "address", "web form", "other"].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Value *"><input name="value" required className={inputCls} /></Field>
        <Field label="Label"><input name="label" placeholder="e.g. Notices" className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Add</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function AddSellerModal({ onClose, onDone }) {
  const { client, showToast } = useWorkspace();
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { source: f.get("source"), name: f.get("name"), class: f.get("class"), note: f.get("note") || undefined, storefrontUrl: f.get("url") || undefined };
    if (await attempt(showToast, () => api.addSeller(client, body))) {
      showToast(`Seller ${body.name} added.`);
      await onDone();
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title="Add seller">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Source *"><select name="source" className={inputCls}>{SOURCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></Field>
        <Field label="Seller name *"><input name="name" required className={inputCls} /></Field>
        <Field label="Storefront URL"><input name="url" type="url" className={inputCls} /></Field>
        <Field label="Classification"><select name="class" defaultValue="Unknown" className={inputCls}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Note"><input name="note" placeholder="e.g. On the authorised reseller list v9" className={inputCls} /></Field>
        <div className="flex justify-end gap-2 border-t border-brand-beige pt-3"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton type="submit">Add seller</PrimaryButton></div>
      </form>
    </Modal>
  );
}
