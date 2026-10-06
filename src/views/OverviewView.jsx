// Overview dashboard (docs/reference/prototype-src/views_monitor.jsx OverviewView): compliance,
// open violations, unauthorised sellers, coverage; severity mix; authorised vs unauthorised trend
// with degraded collection days shaded; recent violations and top sellers. All from the API.
import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import { Bar, Card, KPI, PageHeader, Pill, Table, Td } from "../ui.jsx";
import { formatDay, money, TONE } from "../format.js";
import { attempt, useWorkspace } from "../workspace.js";
import { ViolationDrawer } from "./ViolationsView.jsx";

// Severity and seller-class colours are fixed (not the client's accent) so they read the same in every workspace.
const SEVERITY_COLORS = { Minor: "#A39A92", Standard: "#C98A2B", Severe: "#B0341F" };
const UNAUTH = "#B0341F";
const AUTH = "#8C8279";
const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
const ttc = (h) => (h === null || h === undefined ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);

export function OverviewView() {
  const { client, showToast, chartColors, go } = useWorkspace();
  const [o, setO] = useState(null);
  const [sel, setSel] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    attempt(showToast, () => api.overview(client)).then((r) => { if (live) setO(r ?? null); });
    return () => { live = false; };
  }, [client, showToast, tick]);

  const k = o?.kpis;
  const trend = (o?.trend ?? []).map((d) => ({ ...d, label: shortDay(d.day) }));
  const degraded = new Set((o?.degradedDays ?? []).map((d) => d.day));
  const shaded = trend.filter((d) => degraded.has(d.day));
  const top = o?.topSellers ?? [];
  const maxV = Math.max(1, ...top.map((t) => t.violations));
  const delta = k && k.compliance !== null && k.compliancePrev !== null ? Math.round((k.compliance - k.compliancePrev) * 10) / 10 : null;
  const tooltipStyle = { background: chartColors.card, border: `1px solid ${chartColors.grid}`, borderRadius: 8, color: chartColors.text, fontSize: 12 };

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={o ? `${formatDay(o.period.from)} – ${formatDay(o.period.to)} · MAP in force as of each observation date` : "Loading…"} />

      {o?.quality?.note && (
        <button onClick={() => go("health")} className="w-full text-left mb-4 flex items-center gap-2 text-xs rounded-lg px-3 py-2 border bg-amber-50 text-amber-800 border-amber-200 cursor-pointer">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{o.quality.note} View data health →</span>
        </button>
      )}

      <div className="flex gap-4 flex-wrap mb-5">
        <KPI label="MAP Compliance" value={k?.compliance !== null && k?.compliance !== undefined ? `${k.compliance}%` : "—"}
          sub={delta === null ? `${k?.judged ?? 0} prices judged, last 7 days` : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)} pts vs previous 7 days`}
          subTone={delta === null ? undefined : delta >= 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold"} />
        <KPI label="Open Violations" value={k?.openViolations ?? "—"} sub={k ? `+${k.openedLast24h} in the last 24 h` : ""} subTone={k?.openedLast24h ? "text-red-600 font-semibold" : undefined} />
        <KPI label="Unauthorised Sellers" value={k?.unauthorisedSellers ?? "—"} sub="with an open violation" />
        <KPI label="SKUs Monitored" value={k?.skusMonitored ?? "—"} sub="with an included listing" />
        <KPI label="Median Time to Compliance" value={ttc(k?.medianTtcHours)} sub={k ? `${k.resolvedInPeriod} resolved in ${o.period.days} days` : ""} />
        <KPI label="Coverage (last cycle)" value={k?.coverage !== null && k?.coverage !== undefined ? `${k.coverage}%` : "—"}
          sub={o?.quality?.degraded?.length ? `${o.quality.degraded.length} source${o.quality.degraded.length === 1 ? "" : "s"} not healthy` : "work executed / wanted"}
          subTone={o?.quality?.degraded?.length ? "text-amber-700 font-semibold" : undefined} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Card title={`Violations by severity (last ${o?.period.days ?? 30} days)`}>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={o?.severity ?? []} dataKey="value" innerRadius={48} outerRadius={66} paddingAngle={2} stroke={chartColors.card} strokeWidth={2}>
                {(o?.severity ?? []).map((d) => <Cell key={d.name} fill={SEVERITY_COLORS[d.name]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: chartColors.text }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 justify-center mt-1">
            {(o?.severity ?? []).map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-brand-taupe"><span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_COLORS[d.name] }} />{d.name} ({d.value})</div>
            ))}
          </div>
          <div className="text-[11px] text-brand-taupe text-center mt-2">Severity by depth: Minor &lt;5% · Standard 5–15% · Severe &gt;15%</div>
        </Card>
        <Card title="Listings below MAP per day — unauthorised vs authorised sellers" className="md:col-span-2">
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={trend} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              {shaded.map((d) => <ReferenceArea key={d.day} x1={d.label} x2={d.label} fill="#fcd34d" fillOpacity={0.35} strokeOpacity={0} ifOverflow="extendDomain" />)}
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartColors.muted }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: chartColors.text }} labelStyle={{ color: chartColors.muted }}
                labelFormatter={(l, p) => (p?.[0] && degraded.has(p[0].payload.day) ? `${l} · degraded collection` : l)} />
              <Line type="monotone" dataKey="unauthorised" name="Unauthorised" stroke={UNAUTH} strokeWidth={2} dot={false} activeDot={{ r: 3.5 }} />
              <Line type="monotone" dataKey="authorised" name="MAP Authorised" stroke={AUTH} strokeWidth={1.75} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-4 justify-center text-xs text-brand-taupe">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: UNAUTH }} />Unauthorised / unknown</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: AUTH }} />MAP Authorised</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-amber-200" />Degraded collection (not a clean line)</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Recent severe & standard violations" className="md:col-span-2" action={<button onClick={() => go("violations")} className="text-xs text-brand-copper hover:underline font-semibold cursor-pointer">View all violations</button>}>
          {o && !o.recent.length ? <div className="text-xs text-brand-taupe py-4">No open severe or standard violations.</div> : (
            <Table columns={["SKU / Product", "Seller", "MAP", "Advertised", "Gap", "Severity"]}>
              {(o?.recent ?? []).map((v) => (
                <tr key={v.id} onClick={() => setSel(v.id)} className="hover:bg-brand-beige/20 cursor-pointer">
                  <Td><div className="font-semibold">{v.product}</div><div className="text-xs text-brand-taupe">{v.sku}</div></Td>
                  <Td>{v.seller}<div className="text-[10px] text-brand-taupe">{v.source}</div></Td>
                  <Td>{money(v.last_map)}</Td>
                  <Td>{money(v.last_price)}</Td>
                  <Td className="text-red-600 font-bold">−{Number(v.last_depth_pct).toFixed(1)}%</Td>
                  <Td><Pill text={v.severity} tone={TONE[v.severity]} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Top violating sellers" action={<button onClick={() => go("merchants")} className="text-xs text-brand-copper hover:underline font-semibold cursor-pointer">All sellers</button>}>
          {o && !top.length ? <div className="text-xs text-brand-taupe">No violations in this period.</div> : (
            <div className="space-y-3">
              {top.map((m) => (
                <div key={`${m.seller}-${m.source}`}>
                  <div className="flex justify-between text-xs text-brand-charcoal mb-1 font-medium gap-2">
                    <span>{m.seller} <span className="text-brand-taupe">({m.source})</span></span>
                    <span className="tabular-nums">{m.violations}</span>
                  </div>
                  <Bar value={m.violations} max={maxV} />
                  <div className="text-[10px] text-brand-taupe mt-0.5">{m.class} · {m.active} open · avg depth {m.avg_depth}%</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {sel && <ViolationDrawer violationId={sel} onClose={() => setSel(null)} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}
