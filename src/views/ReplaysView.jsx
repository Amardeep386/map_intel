// Replay at scale (P5 · M5), for Mirethos administrators: re-judge chosen accounts' rule sets over a
// date range and compare with the verdicts stored at the time (drift after an engine, rule or data
// change). Runs in the background in batches; the hourly job resumes anything left unfinished.
import React, { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Field, inputCls, Note, PageHeader, PrimaryButton, SecondaryButton, Table, Td } from "../ui.jsx";
import { attempt, formatWhen } from "../workspace.js";
import { ReplayStatus } from "./RulesView.jsx";

const isoDay = (d) => d.toLocaleDateString("en-CA");
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));

export function ReplaysView({ accounts, showToast }) {
  const [batches, setBatches] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 30 * 86_400_000)), to: isoDay(new Date(Date.now() + 86_400_000)) }));
  const [busy, setBusy] = useState(false);
  const live = accounts.filter((a) => a.status !== "Closed");

  const load = useCallback(async () => setBatches(await api.platformReplays()), []);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);
  const running = batches?.some((b) => b.runs.some((r) => r.status === "queued" || r.status === "running"));
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => attempt(showToast, load), 4000);
    return () => clearInterval(t);
  }, [running, load, showToast]);

  const toggle = (id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = chosen.size === live.length && live.length > 0;
  const start = async () => {
    setBusy(true);
    const r = await attempt(showToast, () => api.startPlatformReplay({ accountIds: all ? "all" : [...chosen], from: range.from, to: range.to }));
    setBusy(false);
    if (r) {
      const n = r.runs.reduce((a, x) => a + x.total, 0);
      showToast(`Replay queued for ${r.runs.length} account${r.runs.length === 1 ? "" : "s"} (${fmt(n)} observations).`, "success");
      setChosen(new Set());
      attempt(showToast, load);
    }
  };

  return (
    <div>
      <PageHeader
        title="Replays"
        subtitle="Re-judge each account's rules, as they were in force at each observation, and compare with the verdicts stored at the time. Nothing live changes: results go to a shadow set."
        action={<SecondaryButton onClick={() => attempt(showToast, load)}><RefreshCw className="w-4 h-4" /> Refresh</SecondaryButton>}
      />
      <Card title="New replay" className="mb-5">
        <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
          <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={all} onChange={() => setChosen(all ? new Set() : new Set(live.map((a) => a.id)))} className="w-4 h-4 accent-[var(--accent)]" /> All accounts
          </label>
          {live.map((a) => (
            <label key={a.id} className="inline-flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} className="w-4 h-4 accent-[var(--accent)]" /> {a.name}
            </label>
          ))}
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="From"><input type="date" className={inputCls} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To (not included)"><input type="date" className={inputCls} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <PrimaryButton onClick={start} disabled={busy || chosen.size === 0}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />} Replay</PrimaryButton>
        </div>
        <p className="text-xs text-brand-taupe mt-3">Up to 400 days at a time. Each account is worked in batches of 2,000 observations, one after another.</p>
      </Card>

      {!batches ? <div className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading replays…</div>
        : batches.length === 0 ? <Note>No replays yet.</Note>
        : (
          <div className="space-y-4">
            {batches.map((b) => (
              <Card key={b.batchId} title={`${new Date(b.from).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${new Date(b.to).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · started ${formatWhen(b.createdAt)}`}>
                <Table columns={["Account", "Status", "Observations", "Changed", "Newly violating", "No longer violating", "Never judged"]}>
                  {b.runs.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.account}</Td>
                      <Td><ReplayStatus run={r} />{r.status === "failed" && r.error ? <div className="text-[11px] text-red-700 mt-1">{r.error}</div> : null}</Td>
                      <Td className="tabular-nums">{r.status === "done" ? fmt(r.summary.observations) : `${fmt(r.processed)} of ${fmt(r.total)}`}</Td>
                      <Td className="tabular-nums">{fmt(r.summary.changed)}</Td>
                      <Td className="tabular-nums">{fmt(r.summary.newlyViolating)}</Td>
                      <Td className="tabular-nums">{fmt(r.summary.noLongerViolating)}</Td>
                      <Td className="tabular-nums">{fmt(r.summary.notJudged)}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
