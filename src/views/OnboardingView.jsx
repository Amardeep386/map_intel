// Guided onboarding (P5 · M2; prototype: docs/reference/prototype-src/views_admin.jsx OnboardingView).
// Seven steps, each done only when the account's real configuration says so (server/src/lib/onboarding.ts).
// The work itself happens on the existing screens: each step opens them, and the checks refresh
// when the person comes back. Go live when every required check passes.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Circle, Loader2, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { Card, Field, inputCls, Modal, Note, PageHeader, Pill, PrimaryButton, SecondaryButton } from "../ui.jsx";
import { attempt, formatWhen, useWorkspace } from "../workspace.js";

// What each step asks for, and the screens where it is done (ids from App.jsx NAV).
const STEP_INFO = {
  account: { d: "Brand, regions, currency, contract, and the people who use the account with their roles.", open: [["settings", "Settings"], ["users", "Users & Access"]] },
  catalogue: { d: "Import the SKUs with their identifiers. The import shows a dry-run diff before anything is saved.", open: [["product", "Product Summary"]] },
  map: { d: "Import MAP with effective dates, add promotion windows and upload the MAP policy PDF.", open: [["pricing", "MAP Policies"]] },
  sellers: { d: "Classify the authorised resellers and the brand's own stores, and add contacts for notices.", open: [["merchants", "Sellers"]] },
  sources: { d: "Subscribe sources, generate terms from the catalogue, set a schedule and check the request estimate.", open: [["sources", "Sources & Terms"]] },
  rules: { d: "The default violation and mapping rules are in place. Review them; the baseline crawl runs at go-live.", open: [["rules", "Rules"], ["mapping", "Mapping Center"]] },
  reports: { d: "Schedule at least one report with its recipients and delivery, and check the alerts.", open: [["reports", "Reports"], ["alerts", "Alerts"]] },
};

function CheckRow({ c }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      {c.ok
        ? <CircleCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
        : <Circle className={`w-4 h-4 mt-0.5 shrink-0 ${c.required ? "text-brand-copper" : "text-brand-taupe"}`} />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-brand-charcoal">{c.label}</div>
        {c.detail && <div className="text-xs text-brand-taupe mt-0.5">{c.detail}</div>}
      </div>
      {!c.ok && <Pill text={c.required ? "Required" : "Advice"} tone={c.required ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-slate-50 text-slate-600 border-slate-200"} />}
    </li>
  );
}

/** A lighter shade of a #rrggbb colour, for the accent on the dark theme. */
function lighten(hex, amount = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => mix(v).toString(16).padStart(2, "0")).join("")}`;
}

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"];

/** Platform administrators: create a new account in Onboarding (first step of the guided flow). */
export function NewAccountModal({ open, onClose, onCreated, showToast }) {
  const [f, setF] = useState({ name: "", brand: "", regions: "US", currency: "USD", timezone: "America/New_York", accent: "#AB5C36", contractFrom: "", contractTo: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const created = await attempt(showToast, () => api.createAccount({
      name: f.name.trim(),
      brand: f.brand.trim(),
      regions: f.regions.split(/[\s,]+/).filter(Boolean).map((r) => r.toUpperCase()),
      currency: f.currency.trim().toUpperCase(),
      timezone: f.timezone,
      accentLight: f.accent,
      accentDark: lighten(f.accent),
      contractFrom: f.contractFrom || undefined,
      contractTo: f.contractTo || undefined,
    }));
    setBusy(false);
    if (created) onCreated(created);
  };

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="New account" width="w-[34rem]">
      <form onSubmit={submit} className="space-y-4">
        <Note>The account starts in Onboarding: it is not crawled until every step is done and it goes live.</Note>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account name"><input required value={f.name} onChange={set("name")} placeholder="Citizen Watch America" className={inputCls} /></Field>
          <Field label="Brand"><input required value={f.brand} onChange={set("brand")} placeholder="Citizen" className={inputCls} /></Field>
          <Field label="Regions (comma-separated)"><input value={f.regions} onChange={set("regions")} className={inputCls} /></Field>
          <Field label="Currency"><input value={f.currency} onChange={set("currency")} maxLength={3} className={inputCls} /></Field>
          <Field label="Time zone">
            <select value={f.timezone} onChange={set("timezone")} className={inputCls}>
              {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Brand colour (accent)">
            <div className="flex items-center gap-2">
              <input type="color" value={f.accent} onChange={set("accent")} className="h-9 w-12 rounded-lg border border-line-strong bg-brand-white cursor-pointer" />
              <span className="text-xs text-brand-taupe font-mono">{f.accent}</span>
            </div>
          </Field>
          <Field label="Contract from"><input type="date" value={f.contractFrom} onChange={set("contractFrom")} className={inputCls} /></Field>
          <Field label="Contract to"><input type="date" value={f.contractTo} onChange={set("contractTo")} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create and start onboarding</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function OnboardingView({ onLive }) {
  const { client, can, go, showToast } = useWorkspace();
  const [state, setState] = useState(null);
  const [step, setStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const canWrite = can("settings.write");

  const load = useCallback(async () => {
    const s = await api.onboarding(client);
    setState(s);
    setStep((cur) => cur ?? s.currentStep);
  }, [client]);

  // App.jsx remounts this view per account (key), so state starts empty for each one.
  useEffect(() => { attempt(showToast, load); }, [load, showToast]);

  if (!state) {
    return <div className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading onboarding…</div>;
  }

  const index = state.steps.findIndex((s) => s.key === step);
  const current = state.steps[index] ?? state.steps[0];
  const info = STEP_INFO[current.key];
  const doneCount = state.steps.filter((s) => s.done).length;
  const missing = state.steps
    .map((s) => ({ key: s.key, title: s.title, checks: s.checks.filter((c) => c.required && !c.ok).map((c) => c.label) }))
    .filter((s) => s.checks.length);
  const live = state.status !== "Onboarding";

  // Remember the step on the server, so "Save & exit" comes back here.
  const moveTo = async (key) => {
    setStep(key);
    if (canWrite && !live) await attempt(showToast, () => api.setOnboardingStep(client, key));
  };

  const goLive = async () => {
    setBusy(true);
    const s = await attempt(showToast, () => api.goLive(client));
    setBusy(false);
    if (!s) return;
    setState(s);
    showToast(`${client.name} is live. The baseline crawl is scheduled.`, "success");
    onLive?.();
  };

  return (
    <div>
      <PageHeader
        title={`Set up ${client.name}`}
        subtitle={live
          ? `Went live ${formatWhen(state.wentLiveAt)}.`
          : `${doneCount} of ${state.steps.length} steps done. Each step writes real configuration; when every step is done the account can go live.`}
        action={<SecondaryButton onClick={() => attempt(showToast, load)}><RefreshCw className="w-4 h-4" /> Check again</SecondaryButton>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        <ol className="space-y-0.5">
          {state.steps.map((s, i) => {
            const on = s.key === current.key;
            return (
              <li key={s.key}>
                <button onClick={() => moveTo(s.key)}
                  className={`w-full text-left flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-[13px] cursor-pointer transition-colors ${on ? "bg-brand-white border border-brand-beige font-medium text-brand-charcoal shadow-[var(--shadow-1)]" : "text-brand-taupe hover:text-brand-charcoal hover:bg-surface-3 border border-transparent"}`}>
                  <span className={`w-5 h-5 rounded-full text-[10px] inline-flex items-center justify-center border shrink-0 ${s.done ? "bg-brand-copper border-brand-copper text-on-accent" : "border-line-strong"}`}>
                    {s.done ? <Check className="w-3 h-3" /> : i + 1}
                  </span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="space-y-4">
          <Card title={current.title} action={current.done ? <Pill text="Done" tone="bg-emerald-50 text-emerald-700 border-emerald-200" /> : null}>
            <p className="text-[13px] text-brand-taupe mb-3">{info.d}</p>
            <ul className="divide-y divide-brand-beige border-y border-brand-beige">
              {current.checks.map((c) => <CheckRow key={c.key} c={c} />)}
            </ul>
            <div className="flex flex-wrap gap-2 mt-4">
              {info.open.map(([view, label]) => (
                <SecondaryButton key={view} onClick={() => go(view)}>Open {label} <ArrowRight className="w-4 h-4" /></SecondaryButton>
              ))}
            </div>
          </Card>

          {current.key === "rules" && state.baseline.runs.length > 0 && (
            <Card title="Baseline crawl">
              <ul className="text-[13px] space-y-1">
                {state.baseline.runs.map((r) => (
                  <li key={r.id} className="flex justify-between"><span className="text-brand-taupe">Run {r.id.slice(0, 8)}</span><span>{r.status} · {r.jobsDone} of {r.jobsTotal} listings</span></li>
                ))}
              </ul>
            </Card>
          )}

          {!live && current.key === "reports" && !state.ready && (
            <Note tone="text-orange-800 bg-orange-50 border-orange-200">
              <div className="font-medium mb-1">Still needed before going live</div>
              <ul className="space-y-0.5">
                {missing.map((m) => (
                  <li key={m.key}>
                    <button onClick={() => moveTo(m.key)} className="font-medium underline underline-offset-2 cursor-pointer">{m.title}</button>: {m.checks.join("; ")}
                  </li>
                ))}
              </ul>
            </Note>
          )}
          {live && <Note>The account is live. Steps can still be checked here; changes are made on the screens themselves.</Note>}

          <div className="flex justify-between gap-2">
            <SecondaryButton onClick={() => go("overview")}>Save & exit</SecondaryButton>
            <div className="flex gap-2">
              {index > 0 && <SecondaryButton onClick={() => moveTo(state.steps[index - 1].key)}><ArrowLeft className="w-4 h-4" /> Back</SecondaryButton>}
              {index < state.steps.length - 1
                ? <PrimaryButton onClick={() => moveTo(state.steps[index + 1].key)}>Continue <ArrowRight className="w-4 h-4" /></PrimaryButton>
                : !live && canWrite && (
                  <PrimaryButton onClick={goLive} disabled={!state.ready || busy}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />} Go live
                  </PrimaryButton>
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
