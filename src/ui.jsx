// Shared building blocks for the portal screens. Same API as before; the look follows the
// Mirethos theme (mirethos-theme.css): white surfaces on a warm page, hairline borders, small
// radii, uppercase micro-labels, tabular numbers, the client's colour only as an accent.
import React from "react";
import { Search, X } from "lucide-react";

export function Pill({ text, tone }) {
  return (
    <span className={`inline-flex items-center h-5 px-1.5 rounded-[5px] text-[11px] font-medium leading-none border whitespace-nowrap ${tone || "bg-slate-50 text-slate-700 border-slate-200"}`}>
      {text}
    </span>
  );
}

export function KPI({ label, value, sub, subTone }) {
  return (
    <div className="bg-brand-white border border-brand-beige rounded-[10px] px-4 py-3.5 flex-1 min-w-[160px] shadow-[var(--shadow-1)]">
      <div className="text-[12px] font-medium text-ink-2 leading-snug">{label}</div>
      <div className="kpi-value mt-1.5 text-[26px] leading-none font-semibold tracking-tight text-brand-charcoal">{value}</div>
      {sub && <div className={`text-xs mt-2 ${subTone || "text-brand-taupe"}`}>{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }) {
  return (
    <section className={`bg-brand-white border border-brand-beige rounded-[10px] shadow-[var(--shadow-1)] ${className || ""}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 h-11 border-b border-brand-beige">
          <h3 className="text-[13px] font-semibold text-brand-charcoal tracking-[-0.005em]">{title}</h3>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// Screens pass "Violations — LG (Sandbox)"; the top bar already shows the client, so the title
// keeps only the screen name.
const screenTitle = (t) => (typeof t === "string" ? t.replace(/\s+—\s+[^—]+\([^)]*\)\s*$/, "") : t);

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-brand-charcoal">{screenTitle(title)}</h1>
        {subtitle && <p className="text-[13px] text-brand-taupe mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

const btn = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap";

export function PrimaryButton({ children, onClick, type, disabled }) {
  return (
    <button type={type || "button"} onClick={onClick} disabled={disabled} className={`${btn} bg-action text-action-ink hover:bg-action-hover shadow-[var(--shadow-1)]`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, type = "button", disabled }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${btn} bg-brand-white text-brand-charcoal border border-line-strong hover:bg-surface-3`}>
      {children}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-brand-taupe absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
        className="pl-9 pr-3 h-9 text-[13px] border border-line-strong rounded-lg w-80 max-w-full bg-brand-white text-brand-charcoal placeholder:text-brand-taupe/80 transition focus:outline-none focus:border-brand-copper focus:ring-[3px] focus:ring-accent-soft"
      />
    </div>
  );
}

// compact: smaller text and tighter cells so wide tables fit the screen without sideways scrolling.
export function Table({ columns, children, compact }) {
  return (
    <div className="overflow-x-auto border border-brand-beige rounded-lg">
      <table className={`w-full border-collapse ${compact ? "text-xs [&_td]:px-2 [&_td]:py-1.5" : "text-[13px]"}`}>
        <thead>
          <tr className="bg-surface-2 border-b border-brand-beige text-left">
            {columns.map((c) => (
              <th key={c} className={`font-medium uppercase tracking-[0.05em] text-[10.5px] text-brand-taupe ${compact ? "py-2 px-2 leading-tight" : "h-9 px-3 whitespace-nowrap"}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-beige [&_tr]:transition-colors">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }) => <td className={`py-2.5 px-3 align-middle ${className || "text-brand-charcoal"}`}>{children}</td>;

export function Tabs({ tabs, value, onChange, right }) {
  return (
    <div className="flex items-center gap-5 border-b border-brand-beige mb-4 flex-wrap">
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            className={`relative h-10 inline-flex items-center gap-1.5 text-[13px] font-medium -mb-px border-b-2 transition-colors cursor-pointer whitespace-nowrap ${on ? "border-brand-copper text-brand-charcoal" : "border-transparent text-brand-taupe hover:text-brand-charcoal"}`}>
            {t.label}
            {t.count !== undefined && (
              <span className={`tabular-nums text-[11px] px-1.5 h-[18px] inline-flex items-center rounded-[5px] ${on ? "bg-accent-soft text-brand-copper" : "bg-surface-3 text-brand-taupe"}`}>{t.count}</span>
            )}
          </button>
        );
      })}
      {right && <div className="ml-auto flex gap-2 pb-2">{right}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "w-[28rem]" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-[#0c0907]/45 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div className={`bg-brand-white border border-brand-beige rounded-xl ${width} max-w-full max-h-[90vh] overflow-y-auto shadow-[var(--shadow-3)]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-5 h-13 border-b border-brand-beige sticky top-0 bg-brand-white z-10">
          <h3 className="text-[15px] font-semibold text-brand-charcoal tracking-[-0.01em]">{title}</h3>
          <button onClick={onClose} className="text-brand-taupe hover:text-brand-charcoal hover:bg-surface-3 rounded-md p-1 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-2 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export const inputCls = "w-full px-3 h-9 text-[13px] border border-line-strong rounded-lg bg-brand-white text-brand-charcoal placeholder:text-brand-taupe/80 transition focus:outline-none focus:border-brand-copper focus:ring-[3px] focus:ring-accent-soft disabled:bg-surface-2 disabled:text-brand-taupe";

export function KV({ k, v }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-brand-taupe">{k}</span>
      <span className="text-brand-charcoal font-medium text-right">{v}</span>
    </div>
  );
}

export function Note({ children, tone }) {
  return <div className={`text-xs leading-relaxed rounded-lg px-3 py-2.5 border ${tone || "text-ink-2 bg-surface-2 border-brand-beige"}`}>{children}</div>;
}

export function Toggle({ on, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} aria-pressed={on} disabled={disabled}
      className={`w-8 h-[18px] rounded-full relative transition-colors ${disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer"} ${on ? "bg-brand-copper" : "bg-line-strong"}`}>
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
    </button>
  );
}

export function Bar({ value, max, tone = "bg-brand-copper" }) {
  return (
    <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
      <div className={`h-full ${tone} rounded-full`} style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} />
    </div>
  );
}

export function Drawer({ open, onClose, eyebrow, title, children, footer, width = "w-[920px]" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-[#0c0907]/40 backdrop-blur-[2px] flex justify-end z-50 animate-fade-in" onClick={onClose}>
      <div className={`bg-brand-ivory ${width} max-w-[94vw] h-full flex flex-col shadow-[var(--shadow-3)] border-l border-brand-beige`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-brand-beige bg-brand-white">
          <div className="min-w-0">
            <span className="text-[10.5px] font-medium text-brand-taupe uppercase tracking-[0.08em]">{eyebrow}</span>
            <h2 className="text-lg font-semibold text-brand-charcoal mt-1 tracking-[-0.01em]">{title}</h2>
          </div>
          <button onClick={onClose} className="text-brand-taupe hover:text-brand-charcoal hover:bg-surface-3 cursor-pointer p-1.5 rounded-md" aria-label="Close">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 py-3.5 border-t border-brand-beige bg-brand-white flex-wrap">{footer}</div>}
      </div>
    </div>
  );
}
