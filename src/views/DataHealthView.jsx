// Data Health (docs/reference/prototype-src/views_collect.jsx): per-source health of the latest
// collection runs — fetch and extraction success, freshness, coverage, failure class — so a quiet
// week reads as "few violations", not "broken collector". Reports and banners arrive with P3.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Bar, Card, Drawer, KPI, KV, Note, PageHeader, Pill, SecondaryButton, Table, Td } from "../ui.jsx";
import { attempt, useWorkspace } from "../workspace.js";

const GREEN = "bg-emerald-50 text-emerald-700 border-emerald-200";
const AMBER = "bg-amber-50 text-amber-700 border-amber-200";
const RED = "bg-red-50 text-red-700 border-red-200";
const GREY = "bg-slate-50 text-slate-700 border-slate-200";
const HEALTH_TONE = { Healthy: GREEN, Degraded: AMBER, Failing: RED, Blocked: RED, Idle: GREY, "No data": GREY };

const FAILURE_LABEL = {
  blocked: "Blocked (bot check)",
  layout_changed: "Layout changed",
  timeout: "Timeout",
  empty: "Empty page",
  auth: "API key refused",
  robots: "robots.txt disallows",
  network: "Network error",
  not_found: "Page not found",
  not_executable: "Not allowed here (no search)",
  no_collector: "No collector",
  budget: "Over request budget",
  cancelled: "Cancelled",
};

const when = (iso) =>
  iso ? `${new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC` : "—";
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
const rate = (x) => (x.total ? `${Math.round((x.ok / x.total) * 100)}% (${x.ok}/${x.total})` : "—");

export function DataHealthView() {
  const { client, can, showToast } = useWorkspace();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);

  const load = useCallback(async () => setData((await attempt(showToast, () => api.dataHealth(client))) ?? null), [client, showToast]);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  const rerun = async (source) => {
    const r = await attempt(showToast, () => api.rerunFailed(client, source));
    if (r) showToast(r.jobs ? `Re-run queued: ${r.jobs} failed job${r.jobs === 1 ? "" : "s"}${source ? "" : " across sources"}.` : "Nothing failed in the last run.");
  };

  const k = data?.kpis;
  const sources = data?.sources ?? [];
  const degraded = sources.filter((s) => s.subscribed && s.health !== "Healthy" && s.health !== "Idle");
  return (
    <div>
      <PageHeader title={`Data Health — ${client.name} (${client.status})`} subtitle="A quiet week should mean few violations, not a broken collector."
        action={can("collection.run") && <SecondaryButton onClick={() => rerun()}><RefreshCw className="w-4 h-4" /> Re-run failed</SecondaryButton>} />
      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="Coverage (last cycle)" value={pct(k?.coverage)} sub="work executed / work wanted" subTone={k && k.coverage < 90 ? "text-amber-700 font-semibold" : undefined} />
        <KPI label="Freshness SLA met" value={k ? `${k.freshness.met} / ${k.freshness.total}` : "—"} sub={`sources observed within ${k?.freshness.hours ?? 24}h`}
          subTone={k && k.freshness.met < k.freshness.total ? "text-amber-700 font-semibold" : undefined} />
        <KPI label="Extraction success" value={pct(k?.extraction)} />
        <KPI label="Evidence captured" value={pct(k?.evidence)} sub="of priced observations" subTone={k?.evidence === 100 ? "text-emerald-700 font-semibold" : undefined} />
        <KPI label="Rejected by validator" value={k?.held ?? "—"} sub="suspicious prices held" />
      </div>
      <Card title="Per-source health">
        <Table columns={["Source", "Health", "Last successful run", "Failure streak", "Listings vs expected", "Error class", "Next report affected"]}>
          {sources.map((s) => (
            <tr key={s.code} onClick={() => setSel(s)} className="hover:bg-brand-beige/20 cursor-pointer">
              <Td className="font-semibold">{s.name}{!s.subscribed && <span className="ml-2 text-xs text-brand-taupe font-normal">(not subscribed)</span>}</Td>
              <Td><Pill text={s.health} tone={HEALTH_TONE[s.health] ?? GREY} /></Td>
              <Td className="text-brand-taupe whitespace-nowrap">{when(s.lastSuccessAt)}</Td>
              <Td className={s.failureStreak ? "text-red-600 font-semibold" : ""}>{s.failureStreak}</Td>
              <Td>
                <span className="flex items-center gap-2 w-40">
                  <span className="tabular-nums w-16">{s.observed}/{s.expected}</span>
                  <span className="flex-1"><Bar value={s.observed} max={s.expected || 1} tone={s.expected && s.observed / s.expected < 0.8 ? "bg-red-500" : "bg-emerald-500"} /></span>
                </span>
              </Td>
              <Td className="text-brand-taupe">{s.mainFailure ? FAILURE_LABEL[s.mainFailure] ?? s.mainFailure : "—"}</Td>
              <Td className="text-brand-taupe" title="Reports arrive with Phase 3">
                {s.subscribed && s.health !== "Healthy" && s.health !== "Idle" && s.health !== "No data"
                  ? <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Next report</span>
                  : "—"}
              </Td>
            </tr>
          ))}
        </Table>
        {!data && <div className="text-xs text-brand-taupe mt-3">Loading…</div>}
        {data && !sources.length && <div className="text-xs text-brand-taupe mt-3">No source subscriptions yet: subscribe sources in Sources & Terms.</div>}
        <div className="mt-3 flex flex-col gap-2">
          {data?.lastRun && (
            <div className="text-xs text-brand-taupe">
              Last run {when(data.lastRun.startedAt)} ({data.lastRun.trigger}, {data.lastRun.status}) from {data.lastRun.egress ?? "unknown egress"}.
              {degraded.length > 0 && ` ${degraded.length} source${degraded.length === 1 ? " needs" : "s need"} attention.`}
            </div>
          )}
          <Note>Reports generated while a source is degraded carry a data-quality banner, and trend charts shade those days instead of drawing a clean line.</Note>
        </div>
      </Card>
      <SourceDrawer key={sel?.code ?? "none"} source={sel} onClose={() => setSel(null)} onRerun={can("collection.run") ? rerun : null} />
    </div>
  );
}

function SourceDrawer({ source, onClose, onRerun }) {
  const { client, showToast } = useWorkspace();
  const [failures, setFailures] = useState(null);
  useEffect(() => {
    if (!source) return;
    attempt(showToast, () => api.healthFailures(client, source.code)).then((f) => setFailures(f ?? []));
  }, [source, client, showToast]);
  if (!source) return null;

  const openEvidence = async (id) => {
    const e = await attempt(showToast, () => api.getEvidence(id));
    const url = e?.screenshot?.url ?? e?.html?.url;
    if (url) window.open(url, "_blank", "noopener");
    else showToast("Evidence opens when the portal is connected to the API.");
  };
  const skipped = Object.entries(source.jobs.skipped ?? {});
  return (
    <Drawer open={!!source} onClose={onClose} eyebrow="Source health" title={source.name} width="w-[760px]"
      footer={onRerun && <SecondaryButton onClick={() => onRerun(source.code)}><RefreshCw className="w-4 h-4" /> Re-run failed on {source.name}</SecondaryButton>}>
      <div className="flex items-center gap-3 mb-4">
        <Pill text={source.health} tone={HEALTH_TONE[source.health] ?? GREY} />
        <span className="text-xs text-brand-taupe">checked {when(source.checkedAt)} from {source.egress ?? "—"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-5">
        <KV k="Fetch success" v={rate(source.fetch)} />
        <KV k="Extraction success" v={rate(source.extraction)} />
        <KV k="Evidence captured" v={rate(source.evidence)} />
        <KV k="Held by validator" v={source.held} />
        <KV k="Listings observed" v={`${source.observed} of ${source.expected} included`} />
        <KV k="Listings discovered" v={source.discovered} />
        <KV k="Jobs" v={`${source.jobs.executed} of ${source.jobs.planned} run`} />
        <KV k="Skipped" v={skipped.length ? skipped.map(([r, n]) => `${n} ${FAILURE_LABEL[r] ?? r}`).join(", ") : "—"} />
      </div>
      <Card title="Recent failures">
        {failures === null && <div className="text-xs text-brand-taupe">Loading…</div>}
        {failures && !failures.length && <div className="text-xs text-brand-taupe">No failures recorded.</div>}
        {failures && failures.length > 0 && (
          <Table columns={["When", "Job", "Class", "What", "Evidence"]}>
            {failures.map((f) => (
              <tr key={f.id} className="align-top">
                <Td className="text-brand-taupe whitespace-nowrap">{when(f.at)}</Td>
                <Td className="text-brand-taupe">{f.kind}{f.attempts > 1 ? ` ×${f.attempts}` : ""}</Td>
                <Td><Pill text={FAILURE_LABEL[f.failureClass] ?? f.failureClass} tone={f.skipped ? GREY : f.failureClass === "blocked" ? RED : AMBER} /></Td>
                <Td>
                  <div className="text-brand-charcoal">{f.listingTitle ?? f.term ?? "—"}</div>
                  {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-brand-copper inline-flex items-center gap-1 break-all">{f.url.replace(/^https:\/\/(www\.)?/, "").slice(0, 70)}<ExternalLink className="w-3 h-3 shrink-0" /></a>}
                  {f.error && <div className="text-xs text-brand-taupe mt-1 break-words">{f.error.slice(0, 220)}</div>}
                </Td>
                <Td>{f.evidenceId ? <button className="text-xs text-brand-copper underline cursor-pointer" onClick={() => openEvidence(f.evidenceId)}>Open</button> : <span className="text-brand-taupe">—</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Drawer>
  );
}
