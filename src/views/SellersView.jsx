// Sellers (docs/reference/prototype-src/views_monitor.jsx): storefronts found on the account's
// listings, with effective-dated classification (a change is a new record), aliases, linked
// sellers and notice contacts. Risk, violations and time to compliance arrive with P3 / P4.
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Store, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import {
  Card, Drawer, Field, KPI, KV, Modal, Note, PageHeader, Pill, PrimaryButton, SearchBox, SecondaryButton, Table, Td, inputCls,
} from "../ui.jsx";
import { TONE, formatDay } from "../format.js";
import { attempt, useWorkspace } from "../workspace.js";

const CLASSES = ["MAP Authorised", "Unauthorised", "Brand Direct", "Unknown"];
const SOURCES = [["amazon_us", "Amazon"], ["walmart_us", "Walmart"], ["bestbuy_us", "Best Buy"], ["ebay_us", "eBay"], ["target_us", "Target"], ["homedepot_us", "Home Depot"], ["google_shopping_us", "Google Shopping"]];

export function SellersView() {
  const { client, can, showToast } = useWorkspace();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("All");
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => setRows((await attempt(showToast, () => api.sellers(client))) ?? []), [client, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const list = (rows ?? []).filter((s) => (cls === "All" || s.classification === cls) && `${s.name} ${s.source}`.toLowerCase().includes(q.toLowerCase()));
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
      </div>
      <Card>
        <div className="flex justify-between mb-4 gap-3 flex-wrap">
          <SearchBox value={q} onChange={setQ} placeholder="Search seller or source..." />
          <select value={cls} onChange={(e) => setCls(e.target.value)} className={`${inputCls} !w-48`}>{["All", ...CLASSES].map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <Table columns={["Seller", "Source", "Classification", "Since", "Risk index", "Tracked SKUs", "Listings", "Violations", "Notice contact"]}>
          {list.map((m) => (
            <tr key={m.id} onClick={() => setSel(m.id)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold"><span className="flex items-center gap-2"><Store className="w-4 h-4 text-brand-taupe" />{m.name}</span></Td>
              <Td className="text-brand-taupe">{m.source}</Td>
              <Td><Pill text={m.classification} tone={TONE[m.classification]} /></Td>
              <Td className="text-brand-taupe">{formatDay(m.class_since)}</Td>
              <Td className="text-brand-taupe" title="From Phase 3 violations">—</Td>
              <Td>{m.tracked}</Td>
              <Td>{m.listings}</Td>
              <Td className="text-brand-taupe" title="From Phase 3">—</Td>
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
        <PrimaryButton onClick={() => setModal("class")}>Change classification</PrimaryButton>
      </>}>
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Classification" value={s.classification} />
        <KPI label="Listings" value={s.listings.length} sub={`${s.listings.filter((l) => l.state === "Included").length} included`} />
        <KPI label="Risk index" value="—" sub="with Phase 3 violations" />
        <KPI label="Time to compliance" value="—" sub="with Phase 4 cases" />
      </div>
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
    </Drawer>
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
