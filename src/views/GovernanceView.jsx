// Governance (P5 · M6), for Mirethos administrators: the integrity of every audit chain (one per
// account, one for platform changes) and the daily retention runs with what each deleted.
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Note, PageHeader, Pill, SecondaryButton, Table, Td } from "../ui.jsx";
import { attempt, formatWhen } from "../workspace.js";

const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const OK = "bg-emerald-50 text-emerald-700 border-emerald-200";
const BAD = "bg-red-50 text-red-700 border-red-200";

function runSummary(c) {
  if (!c) return "—";
  const audit = Object.values(c.audit ?? {}).reduce((a, b) => a + b, 0);
  return `${fmt(c.evidence)} evidence (${fmt(c.evidenceFiles)} files${c.evidenceSkipped ? `, ${fmt(c.evidenceSkipped)} kept: still locked` : ""}), ${fmt(c.observations)} observations, ${fmt(audit)} audit events`;
}

export function GovernanceView({ showToast }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => setData(await api.governance()), []);
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  if (!data) return <div className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking every audit chain…</div>;
  const broken = data.chains.filter((c) => !c.ok);
  return (
    <div>
      <PageHeader
        title="Governance"
        subtitle="Every audit log is a hash chain: changing, removing or reordering an entry breaks it. Retention runs once a day and never deletes anything behind an open violation or an unresolved case."
        action={<SecondaryButton onClick={() => attempt(showToast, load)}><RefreshCw className="w-4 h-4" /> Check again</SecondaryButton>}
      />
      {broken.length > 0 && <div className="mb-4"><Note tone="text-red-800 bg-red-50 border-red-200">{broken.length} audit chain{broken.length === 1 ? " is" : "s are"} broken: {broken.map((c) => c.name).join(", ")}.</Note></div>}
      <Card title="Audit chains" className="mb-5">
        <Table columns={["Chain", "Integrity", "Events checked", "Deleted under retention", "Latest hash", "Checked"]}>
          {data.chains.map((c) => (
            <tr key={c.accountId ?? "platform"}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{c.ok ? <Pill text="Intact" tone={OK} /> : <span title={c.broken?.reason}><Pill text={`Broken at #${c.broken?.seq}`} tone={BAD} /></span>}</Td>
              <Td className="tabular-nums">{fmt(c.checked)}</Td>
              <Td className="tabular-nums text-brand-taupe">{c.purged ? `${fmt(c.purged.count)} before ${formatWhen(c.purged.before)}` : "—"}</Td>
              <Td className="font-mono text-[11px] text-brand-taupe">{c.lastHash ? `${c.lastHash.slice(0, 16)}…` : "—"}</Td>
              <Td className="text-brand-taupe">{formatWhen(c.checkedAt)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Retention runs">
        {data.retentionRuns.length === 0 ? <Note>No retention runs yet. The daily run starts once this release is live.</Note> : (
          <Table columns={["Started", "Mode", "Result"]}>
            {data.retentionRuns.map((r) => (
              <tr key={r.id}>
                <Td className="text-brand-taupe whitespace-nowrap">{formatWhen(r.started_at)}</Td>
                <Td><Pill text={r.applied ? "Applied" : "Dry run"} tone={r.applied ? undefined : "bg-slate-50 text-slate-500 border-slate-200"} /></Td>
                <Td className={r.error ? "text-red-700" : ""}>{r.error ? `Failed: ${r.error}` : r.finished_at ? `${r.applied ? "Deleted" : "Would delete"} ${runSummary(r.counts)}` : "Running…"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
