// Platform screens for Mirethos administrators (P5): the org-wide crawl budget across all accounts.
// Daily request caps per source and for the organisation; today's usage, each account's share and
// the forecast from its schedules. Opened from the workspace picker; not inside one account.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Pencil, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Bar, Card, Field, inputCls, KPI, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton, Table, Td } from "../ui.jsx";
import { attempt } from "../workspace.js";
import { GovernanceView } from "./GovernanceView.jsx";
import { ReplaysView } from "./ReplaysView.jsx";
import { TicketsView } from "./TicketsView.jsx";

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));
const OVER = "bg-red-50 text-red-700 border-red-200";

function CapModal({ target, onClose, onSaved, showToast }) {
  const [value, setValue] = useState(target?.cap ? String(target.cap) : "");
  const [note, setNote] = useState(target?.note || "");
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const save = async (dailyRequests) => {
    setBusy(true);
    const r = await attempt(showToast, () => api.setCrawlBudget({ sourceId: target.sourceId, dailyRequests, note: note.trim() || undefined }));
    setBusy(false);
    if (r) onSaved(dailyRequests === null ? `Cap removed for ${target.label}.` : `Cap for ${target.label}: ${fmt(dailyRequests)} requests a day.`);
  };
  const n = Number.parseInt(value, 10);
  return (
    <Modal open onClose={onClose} title={`Daily cap · ${target.label}`}>
      <div className="space-y-4">
        <Note>Requests a day (UTC) across every account. When the cap is reached, the rest of the day's work is skipped and shown in Data Health as "Over the daily org-wide cap". Each account's own request budget still applies first.</Note>
        <Field label="Requests per day"><input type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} placeholder="No cap" /></Field>
        <Field label="Note (why this cap)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} placeholder="e.g. eBay Browse API: 5,000 calls a day" /></Field>
        <div className="flex justify-between gap-2">
          {target.cap ? <SecondaryButton onClick={() => save(null)} disabled={busy}>Remove cap</SecondaryButton> : <span />}
          <div className="flex gap-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton onClick={() => save(n)} disabled={busy || !(n > 0)}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save</PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function CrawlBudgetView({ showToast }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => setData(await api.crawlBudget(14)), []);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  if (!data) return <div className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the crawl budget…</div>;
  const { org } = data;
  const last14 = org.history.reduce((a, b) => a + b, 0);
  const sources = [...data.sources].sort((a, b) => (b.forecast + b.usedToday) - (a.forecast + a.usedToday) || a.name.localeCompare(b.name));
  const onboarding = data.accounts.filter((a) => !a.counted);
  // Sources with no collector yet and nothing to show are folded away.
  const quiet = (s) => s.collectorStatus !== "live" && !s.cap && !s.forecast && !s.history.some((n) => n > 0);
  const hidden = sources.filter(quiet);
  const shown = showAll ? sources : sources.filter((s) => !quiet(s));

  return (
    <div>
      <PageHeader
        title="Crawl budget"
        subtitle={`Requests across every account, by UTC day (today ${data.today}). Forecasts come from each account's schedules, subscriptions, terms and listings.`}
        action={<>
          <SecondaryButton onClick={() => attempt(showToast, load)}><RefreshCw className="w-4 h-4" /> Refresh</SecondaryButton>
          <PrimaryButton onClick={() => setEditing({ sourceId: null, label: "the organisation", cap: org.cap, note: org.note })}><Pencil className="w-4 h-4" /> Org-wide cap</PrimaryButton>
        </>}
      />

      <div className="flex gap-3 flex-wrap mb-5">
        <KPI label="Org-wide daily cap" value={fmt(org.cap)} sub={org.cap ? org.note || "requests a day" : "no cap set"} />
        <KPI label="Used today" value={fmt(org.usedToday)} sub={org.cap ? `${Math.round((org.usedToday / org.cap) * 100)}% of the cap` : "queued work counts its planned requests"} />
        <KPI label="Forecast per day" value={fmt(org.forecast)} sub={org.overCap ? "above the org-wide cap" : "live and sandbox accounts"} subTone={org.overCap ? "text-red-700" : undefined} />
        <KPI label="Last 14 days" value={fmt(last14)} sub={`${fmt(Math.round(last14 / data.days.length))} a day on average`} />
      </div>

      <div className="space-y-5">
        <Card title="Sources">
          <Table columns={["Source", "Daily cap", "Used today", "Of cap", "Forecast / day", "Skipped today (cap)", "Last 14 days", "Cap"]}>
            {shown.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[11px] text-brand-taupe">{s.code}{s.collectorStatus !== "live" ? ` · collector ${s.collectorStatus}` : ""}</div>
                </Td>
                <Td className="tabular-nums">{s.cap ? <span title={s.note || undefined}>{fmt(s.cap)}</span> : <span className="text-brand-taupe">none</span>}</Td>
                <Td className="tabular-nums">{fmt(s.usedToday)}</Td>
                <Td className="w-32">{s.cap ? <Bar value={s.usedToday} max={s.cap} tone={s.usedToday >= s.cap ? "bg-red-500" : "bg-brand-copper"} /> : null}</Td>
                <Td className="tabular-nums">{fmt(s.forecast)} {s.overCap && <Pill text="Over cap" tone={OVER} />}</Td>
                <Td className="tabular-nums">{s.orgBudgetSkipsToday ? <span className="text-red-700">{fmt(s.orgBudgetSkipsToday)} jobs</span> : "—"}</Td>
                <Td className="tabular-nums">{fmt(s.history.reduce((a, b) => a + b, 0))}</Td>
                <Td><button onClick={() => setEditing({ sourceId: s.id, label: s.name, cap: s.cap, note: s.note })} className="text-[12.5px] text-brand-copper hover:underline cursor-pointer">{s.cap ? "Change cap" : "Set cap"}</button></Td>
              </tr>
            ))}
          </Table>
          {hidden.length > 0 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-3 text-[12.5px] text-brand-copper hover:underline cursor-pointer">
              {showAll ? "Hide sources without a collector" : `Show ${hidden.length} planned sources (no collector yet, nothing used)`}
            </button>
          )}
        </Card>

        <Card title="Accounts">
          <Table columns={["Account", "Status", "Used today", "Last 7 days", "Forecast / day", "Share of forecast", "Skipped, 7 days"]}>
            {data.accounts.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2">
                <Td className="font-medium">{a.name}</Td>
                <Td><Pill text={a.status} tone={a.status === "Onboarding" ? "bg-amber-50 text-amber-700 border-amber-200" : undefined} /></Td>
                <Td className="tabular-nums">{fmt(a.usedToday)}</Td>
                <Td className="tabular-nums">{fmt(a.last7Days)}</Td>
                <Td className="tabular-nums">{fmt(a.forecast)}</Td>
                <Td className="tabular-nums">{a.counted && org.forecast ? `${Math.round((a.forecast / org.forecast) * 100)}%` : "—"}</Td>
                <Td className="tabular-nums text-xs">
                  {a.budgetSkips7Days || a.orgBudgetSkips7Days
                    ? <>{a.budgetSkips7Days ? `${fmt(a.budgetSkips7Days)} account budget` : ""}{a.budgetSkips7Days && a.orgBudgetSkips7Days ? " · " : ""}{a.orgBudgetSkips7Days ? <span className="text-red-700">{fmt(a.orgBudgetSkips7Days)} org cap</span> : ""}</>
                    : "—"}
                </Td>
              </tr>
            ))}
          </Table>
          {onboarding.length > 0 && (
            <p className="text-xs text-brand-taupe mt-3">Accounts in Onboarding are not crawled on schedule yet: their forecast is shown but not counted in the totals.</p>
          )}
        </Card>
      </div>

      <CapModal key={editing ? `${editing.sourceId}` : "none"} target={editing} onClose={() => setEditing(null)} showToast={showToast}
        onSaved={(msg) => { setEditing(null); showToast(msg, "success"); attempt(showToast, load); }} />
    </div>
  );
}

/** Full-page frame for platform screens (outside any one account). */
export function PlatformScreen({ tab, onTab, onBack, accounts, showToast }) {
  return (
    <div className="min-h-screen bg-brand-ivory font-sans text-brand-charcoal">
      <header className="h-16 px-8 flex items-center gap-4 bg-rail border-b border-rail-line">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-rail-ink-2 hover:text-rail-ink cursor-pointer"><ArrowLeft className="w-4 h-4" /> Workspaces</button>
        <span className="text-[11px] uppercase tracking-[0.18em] text-rail-ink-2">Platform</span>
        <nav className="ml-4 flex items-center gap-1">
          {[["tickets", "Tickets"], ["budget", "Crawl budget"], ["replays", "Replays"], ["governance", "Governance"]].map(([id, label]) => (
            <button key={id} onClick={() => onTab(id)}
              className={`h-8 px-3 rounded-md text-[13px] cursor-pointer ${tab === id ? "bg-white/[0.08] text-rail-ink font-medium" : "text-rail-ink-2 hover:text-rail-ink"}`}>{label}</button>
          ))}
        </nav>
      </header>
      <main className="max-w-[1400px] mx-auto px-8 py-7">
        {tab === "tickets" ? <TicketsView accounts={accounts} showToast={showToast} />
          : tab === "replays" ? <ReplaysView accounts={accounts} showToast={showToast} />
          : tab === "governance" ? <GovernanceView showToast={showToast} />
          : <CrawlBudgetView showToast={showToast} />}
      </main>
    </div>
  );
}
