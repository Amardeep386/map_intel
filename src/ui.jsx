// Shared building blocks for the portal screens. The first group moved here unchanged from
// App.jsx; the second group follows docs/reference/prototype-src/ui.jsx (same visual language).
import React from "react";
import { Search, X } from "lucide-react";

export function Pill({ text, tone }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tone || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {text}
    </span>
  );
}

export function KPI({ label, value, sub, subTone }) {
  return (
    <div className="bg-brand-white border border-brand-beige rounded-xl p-4 flex-1 min-w-[150px]">
      <div className="text-xs text-brand-taupe mb-1">{label}</div>
      <div className="text-2xl font-bold text-brand-charcoal">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subTone || "text-brand-taupe"}`}>{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }) {
  return (
    <div className={`bg-brand-white border border-brand-beige rounded-xl p-4 ${className || ""}`}>
      {title && (
        <div className="flex items-center justify-between mb-3 border-b border-brand-beige pb-2">
          <h3 className="text-sm font-semibold text-brand-charcoal">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between mb-5 border-b border-brand-beige pb-3">
      <div>
        <h1 className="text-lg font-bold text-brand-charcoal">{title}</h1>
        {subtitle && <p className="text-sm text-brand-taupe mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PrimaryButton({ children, onClick, type, disabled }) {
  return (
    <button type={type || "button"} onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1.5 bg-brand-copper hover:bg-brand-copper/90 text-brand-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
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
        placeholder={placeholder || "Search..."}
        className="pl-9 pr-3 py-2 text-sm border border-brand-beige rounded-lg w-72 max-w-full focus:outline-none focus:ring-2 focus:ring-brand-copper/30 focus:border-brand-copper bg-brand-white text-brand-charcoal"
      />
    </div>
  );
}

export function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto border border-brand-beige rounded-lg">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-brand-beige text-left text-xs text-brand-charcoal bg-brand-beige">
            {columns.map((c) => (
              <th key={c} className="py-2 px-3 font-semibold whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-beige">{children}</tbody>
      </table>
    </div>
  );
}

// ---------- From the prototype (docs/reference/prototype-src/ui.jsx) ----------

export const Td = ({ children, className }) => <td className={`py-2 px-3 ${className || "text-brand-charcoal"}`}>{children}</td>;

export function SecondaryButton({ children, onClick, type = "button", disabled }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1.5 text-sm font-semibold border border-brand-beige bg-brand-white rounded-lg px-3 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

export function Tabs({ tabs, value, onChange, right }) {
  return (
    <div className="flex items-center gap-1 border-b border-brand-beige mb-4 flex-wrap">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap ${value === t.id ? "border-brand-copper text-brand-copper" : "border-transparent text-brand-taupe hover:text-brand-charcoal"}`}>
          {t.label} {t.count !== undefined && <span className="text-xs text-brand-taupe ml-1">{t.count}</span>}
        </button>
      ))}
      {right && <div className="ml-auto flex gap-2 pb-2">{right}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "w-[28rem]" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-brand-charcoal/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-brand-white border border-brand-beige rounded-xl p-6 ${width} max-w-full max-h-[90vh] overflow-y-auto shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b border-brand-beige pb-3 mb-4">
          <h3 className="text-sm font-bold text-brand-charcoal">{title}</h3>
          <button onClick={onClose} className="text-brand-taupe hover:text-brand-charcoal cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-brand-taupe mb-1">{label}</label>
      {children}
    </div>
  );
}

export const inputCls = "w-full px-3 py-2 text-sm border border-brand-beige rounded-lg bg-brand-white text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-copper/30";

export function KV({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-brand-taupe">{k}</span>
      <span className="text-brand-charcoal font-semibold text-right">{v}</span>
    </div>
  );
}

export function Note({ children, tone }) {
  return <div className={`text-xs rounded-lg px-3 py-2 border ${tone || "text-brand-copper bg-brand-beige/50 border-brand-beige"}`}>{children}</div>;
}

export function Toggle({ on, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} aria-pressed={on} disabled={disabled}
      className={`w-9 h-5 rounded-full relative transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${on ? "bg-brand-copper" : "bg-brand-beige"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-4.5" : "left-0.5"}`} />
    </button>
  );
}

export function Bar({ value, max, tone = "bg-brand-copper" }) {
  return (
    <div className="h-1.5 bg-brand-beige rounded-full overflow-hidden">
      <div className={`h-full ${tone} rounded-full`} style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} />
    </div>
  );
}
