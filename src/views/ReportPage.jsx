// Hosted report (opened from a report link, no sign-in): the same frozen page the PDF was printed
// from, with the PDF and CSV to download. The link is scoped to one report run and expires.
import React, { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Lock } from "lucide-react";
import { api } from "../api/client.js";
import { formatDay } from "../format.js";

export function ReportPage({ token }) {
  const [res, setRes] = useState(null);
  useEffect(() => { api.reportByToken(token).then(setRes); }, [token]);
  const r = res?.status === 200 ? res.data : null;
  return (
    <div className="min-h-screen bg-brand-ivory flex flex-col">
      <div className="bg-brand-charcoal text-brand-ivory text-xs px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> MAP Intel report · view-only{r ? ` · this link expires ${formatDay(r.expiresAt)}` : ""}</span>
        {r && <span className="ml-auto flex gap-3">
          {r.files.map((f) => (
            <a key={f.kind} href={f.url} className="inline-flex items-center gap-1 underline" download={f.fileName}><Download className="w-3.5 h-3.5" />{f.kind.toUpperCase()}</a>
          ))}
        </span>}
      </div>
      {!res && <p className="p-6 text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Opening the report…</p>}
      {res && !r && (
        <div className="max-w-xl mx-auto mt-10 bg-brand-white border border-brand-beige rounded-xl p-6 text-sm text-brand-charcoal flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div><div className="font-semibold mb-1">{res.data?.message || res.data?.error || "This report link is not valid."}</div><div className="text-brand-taupe">Ask the person who sent it for a new link.</div></div>
        </div>
      )}
      {r && <iframe title={r.name} srcDoc={r.html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="flex-1 w-full border-0 bg-white" />}
    </div>
  );
}
