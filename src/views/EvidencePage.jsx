// Hosted evidence page (docs/reference/prototype-src/views_monitor.jsx EvidencePage): what a brand
// or seller sees from the link in a report row or a copied link. No sign-in; the link is scoped to
// one violation, expires, and can be revoked.
import React, { useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, ExternalLink, Loader2, Lock } from "lucide-react";
import { api } from "../api/client.js";
import { Card, KV, Table, Td } from "../ui.jsx";
import { formatDay, money } from "../format.js";
import { formatWhen } from "../workspace.js";

const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—");

export function EvidencePage({ token }) {
  const [res, setRes] = useState(null);
  useEffect(() => { api.evidenceByToken(token).then(setRes); }, [token]);

  if (!res) return <Shell><p className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Opening the evidence record…</p></Shell>;
  if (res.status !== 200) {
    const msg = res.data?.message || res.data?.error || "This evidence link is not valid.";
    return <Shell><div className="bg-brand-white border border-brand-beige rounded-xl p-6 text-sm text-brand-charcoal flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" /><div><div className="font-semibold mb-1">{msg}</div><div className="text-brand-taupe">Ask the person who sent it for a new link.</div></div></div></Shell>;
  }
  const r = res.data;
  const latest = r.files?.[0];
  const picture = latest?.screenshot ?? latest?.card;
  return (
    <Shell expiresAt={r.expiresAt}>
      <div className="flex items-center gap-2.5 mb-5">
        <img src="/favicon.ico" alt="" className="w-7 h-7 bg-white p-1 rounded-md border border-brand-beige" />
        <div>
          <div className="text-sm font-bold tracking-wide text-brand-charcoal">MIRETHOS · MAP Evidence Record</div>
          <div className="text-[11px] text-brand-taupe">Record {r.record} · {r.brand} · record SHA-256 <span className="font-mono">{shortHash(r.recordSha256)}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card title="Seller"><div className="space-y-2 text-xs"><KV k="Name" v={r.seller.name} /><KV k="Source" v={r.seller.source} /><KV k="Classification at capture" v={r.seller.classAtCapture} /></div></Card>
        <Card title="Product"><div className="space-y-2 text-xs"><KV k="SKU" v={r.product.sku} /><KV k="Name" v={r.product.name} /><KV k="MAP in force" v={money(r.map)} /></div></Card>
        <Card title="Listing">
          <div className="space-y-2 text-xs">
            <KV k="Advertised" v={<span className="text-red-600 font-semibold">{money(r.advertised)}</span>} />
            <KV k="Below MAP" v={`${Number(r.depthPct).toFixed(1)}% (${money(r.depthAbs)})`} />
            <KV k="First seen" v={formatWhen(r.firstSeen)} />
            <KV k="Last seen" v={formatWhen(r.lastSeen)} />
            {r.listing.url && <KV k="Page" v={<a className="text-brand-copper underline inline-flex items-center gap-1" href={r.listing.url} target="_blank" rel="noreferrer">Open <ExternalLink className="w-3 h-3" /></a>} />}
          </div>
        </Card>
      </div>

      <Card title="Page snapshot" className="mb-4">
        {picture ? (
          <a href={picture.url} target="_blank" rel="noreferrer"><img src={picture.url} alt="Captured page" className="w-full max-h-[32rem] object-contain object-top rounded-lg border border-brand-beige bg-white" /></a>
        ) : (
          <div className="bg-brand-charcoal rounded-lg h-56 flex flex-col items-center justify-center text-center">
            <div className="text-brand-ivory font-bold">{r.product.name}</div>
            <div className="text-4xl font-black text-red-500 my-3">{money(r.advertised)}</div>
            <div className="text-xs text-brand-ivory/70">Sold by {r.seller.name}</div>
          </div>
        )}
        {latest && (
          <div className="text-[11px] text-brand-taupe mt-3 space-y-1">
            <div>Captured {formatWhen(latest.capturedAt)} by {latest.method}. {latest.card && !latest.screenshot ? "The site blocks page captures, so this card is drawn from the official API response (attached below), not a screenshot." : ""}</div>
            {r.verification && (
              <div className={`inline-flex items-center gap-1 ${r.verification.ok ? "text-emerald-700" : "text-red-700"}`}>
                {r.verification.ok ? <CircleCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                The {r.verification.file} was re-read just now and {r.verification.ok ? "matches" : "does NOT match"} its recorded SHA-256.
                {r.verification.retainUntil && <> Locked ({r.verification.mode}) until {formatDay(r.verification.retainUntil)}.</>}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Observations below MAP" className="mb-4">
        <Table columns={["Observed", "Advertised", "MAP in force", "Below MAP"]}>
          {r.observations.map((o) => (
            <tr key={o.at}><Td className="whitespace-nowrap">{formatWhen(o.at)}</Td><Td>{money(o.price)}</Td><Td>{money(o.map)}</Td><Td className="text-red-600">{Number(o.depthPct).toFixed(1)}%</Td></tr>
          ))}
        </Table>
      </Card>

      {r.files?.length > 0 && (
        <Card title="Stored proof files" className="mb-4">
          <Table columns={["Captured", "Price", "File", "SHA-256"]}>
            {r.files.flatMap((f) => [["Screenshot", f.screenshot], ["Evidence card", f.card], ["Page HTML", f.html], ["API response", f.api]]
              .filter(([, x]) => x)
              .map(([label, x]) => (
                <tr key={`${f.id}-${label}`}>
                  <Td className="whitespace-nowrap text-brand-taupe">{formatWhen(f.capturedAt)}</Td><Td>{money(f.price)}</Td>
                  <Td><a className="text-brand-copper underline" href={x.url} target="_blank" rel="noreferrer">{label}</a></Td>
                  <Td className="font-mono text-[11px]">{x.sha256}</Td>
                </tr>
              )))}
          </Table>
        </Card>
      )}

      <div className="text-[11px] text-brand-taupe">
        {r.policy ? <>Policy reference: {r.policy.name} v{r.policy.version}, effective {formatDay(r.policy.effective_from)}. </> : null}
        Judged by rule {r.rule || "—"} against the MAP in force on each observation date. This record documents an observed advertised price; it is not a legal determination.
      </div>
    </Shell>
  );
}

function Shell({ children, expiresAt }) {
  return (
    <div className="min-h-screen bg-brand-ivory">
      <div className="bg-brand-charcoal text-brand-ivory text-xs px-4 py-2 flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> MAP Intel evidence · view-only{expiresAt ? ` · this link expires ${formatDay(expiresAt)}` : ""}
      </div>
      <div className="max-w-4xl mx-auto p-6">{children}</div>
    </div>
  );
}
