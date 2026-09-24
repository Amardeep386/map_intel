import React, { useState } from "react";
import { Search, Store, X } from "./icons";
import lgLogo from "./assets/lg.png";
import philipsLogo from "./assets/philips.png";
import kawasakiLogo from "./assets/kawasaki.png";

export const DataContext = React.createContext(null);
// Toasts are app-wide so any view/drawer can call showToast (fixes the drawer crash in the current build).
export const ToastContext = React.createContext(() => {});
export const useToast = () => React.useContext(ToastContext);

export const formatUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// ---------- Building blocks (unchanged from current portal) ----------
export function Pill({ text, tone }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${tone || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {text}
    </span>
  );
}

export function KPI({ label, value, sub, subTone }) {
  return (
    <div className="bg-brand-white border border-brand-beige rounded-xl p-4 flex-1 min-w-[150px]">
      <div className="text-xs text-brand-taupe mb-1">{label}</div>
      <div className="text-2xl font-bold text-brand-charcoal tabular-nums">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subTone || "text-brand-taupe"}`}>{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }) {
  return (
    <div className={`bg-brand-white border border-brand-beige rounded-xl p-4 ${className || ""}`}>
      {title && (
        <div className="flex items-center justify-between mb-3 border-b border-brand-beige pb-2 gap-2">
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
    <div className="flex items-center justify-between mb-5 border-b border-brand-beige pb-3 gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-bold text-brand-charcoal">{title}</h1>
        {subtitle && <p className="text-sm text-brand-taupe mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex gap-2 items-center">{action}</div>}
    </div>
  );
}

export function PrimaryButton({ children, onClick, type = "button", disabled }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1.5 bg-brand-copper hover:bg-brand-copper/90 text-brand-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, type = "button" }) {
  return (
    <button type={type} onClick={onClick} className="inline-flex items-center gap-1.5 text-sm font-semibold border border-brand-beige bg-brand-white rounded-lg px-3 py-2 text-brand-charcoal hover:bg-brand-beige cursor-pointer">
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

export function MerchantLogo({ name }) {
  // Logos are stored per source in the product (Clearbit's free logo API is no longer reliable).
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Store className="w-3.5 h-3.5 text-brand-taupe opacity-60" />
      <span>{name}</span>
    </span>
  );
}

export function ClientLogo({ name, className }) {
  const lower = name.toLowerCase();
  const src = lower === "lg" ? lgLogo : lower === "philips" ? philipsLogo : lower === "kawasaki" ? kawasakiLogo : null;
  if (src) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-white ${className || "w-5 h-5 rounded-sm"}`}>
        <img src={src} alt={name} className="w-full h-full object-contain" style={{ padding: "2px", transform: lower === "lg" ? "scale(2.3)" : "scale(1)" }} />
      </div>
    );
  }
  return <div className={`flex items-center justify-center font-bold text-brand-white bg-brand-copper ${className || "w-5 h-5 rounded-sm"}`}>{name.charAt(0)}</div>;
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

export const Td = ({ children, className }) => <td className={`py-2 px-3 ${className || "text-brand-charcoal"}`}>{children}</td>;

// ---------- New shared blocks (same visual language) ----------
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

export function Drawer({ open, onClose, eyebrow, title, children, footer, width = "w-[920px]" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-brand-charcoal/40 flex justify-end z-50" onClick={onClose}>
      <div className={`bg-brand-ivory ${width} max-w-[94vw] h-full overflow-y-auto p-6 flex flex-col shadow-2xl border-l border-brand-beige`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-brand-beige pb-3 mb-4">
          <div>
            <span className="text-xs font-semibold text-brand-taupe uppercase tracking-wider">{eyebrow}</span>
            <h2 className="text-lg font-bold text-brand-charcoal mt-1">{title}</h2>
          </div>
          <button onClick={onClose} className="text-brand-taupe hover:text-brand-charcoal cursor-pointer p-1 rounded-lg border border-brand-beige bg-brand-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-brand-beige pt-4 mt-6 flex-wrap">{footer}</div>}
      </div>
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
  return (
    <div className={`text-xs rounded-lg px-3 py-2 border ${tone || "text-brand-copper bg-brand-beige/50 border-brand-beige"}`}>{children}</div>
  );
}

export function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on} className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${on ? "bg-brand-copper" : "bg-brand-beige"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-4.5" : "left-0.5"}`} />
    </button>
  );
}

// ---------- Charts (SVG; the repo can keep Recharts) ----------
export function Donut({ data, size = 140 }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label="Violations by severity">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border-color)" strokeWidth="18" />
      {data.map((d) => {
        const len = (d.value / total) * c;
        const el = <circle key={d.name} cx="70" cy="70" r={r} fill="none" stroke={d.color} strokeWidth="18"
          strokeDasharray={`${Math.max(len - 2, 0)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
        acc += len;
        return el;
      })}
      <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text-primary)">{total}</text>
      <text x="70" y="86" textAnchor="middle" fontSize="10" fill="var(--text-muted)">30 days</text>
    </svg>
  );
}

// Multi-series line chart. series: [{key, color, label}], rows: [{x, ...}]; shade rows where row.degraded.
export function LineChart({ rows, xKey, series, height = 190, refLine, yFmt = (v) => v }) {
  const W = 600, H = height, L = 40, R = 12, T = 12, B = 26;
  const vals = rows.flatMap((r) => series.map((s) => r[s.key])).concat(refLine ? [refLine.value] : []);
  const min = refLine ? Math.min(...vals) * 0.97 : 0;
  const max = Math.max(...vals) * 1.08;
  const x = (i) => L + (i * (W - L - R)) / (rows.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const ticks = 4;
  const step = (W - L - R) / (rows.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img">
      {rows.map((r, i) => r.degraded ? <rect key={"d" + i} x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill="rgba(245,158,11,0.12)" /> : null)}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = min + ((max - min) * i) / ticks;
        return (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border-color)" strokeDasharray="3 3" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)">{yFmt(Math.round(v))}</text>
          </g>
        );
      })}
      {rows.map((r, i) => <text key={"x" + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{r[xKey]}</text>)}
      {refLine && (
        <g>
          <line x1={L} x2={W - R} y1={y(refLine.value)} y2={y(refLine.value)} stroke="#dc2626" strokeDasharray="5 4" />
          <text x={W - R} y={y(refLine.value) - 5} textAnchor="end" fontSize="10" fill="#dc2626">{refLine.label}</text>
        </g>
      )}
      {series.map((s) => (
        <g key={s.key}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" points={rows.map((r, i) => `${x(i)},${y(r[s.key])}`).join(" ")} />
          {rows.map((r, i) => <circle key={i} cx={x(i)} cy={y(r[s.key])} r={i === rows.length - 1 ? 4 : 2.5} fill={s.color} />)}
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-3 justify-center mt-1">
      {items.map((d) => (
        <div key={d.name} className="flex items-center gap-1.5 text-xs text-brand-taupe">
          <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
          {d.name}
        </div>
      ))}
    </div>
  );
}

export function Bar({ value, max, tone = "bg-brand-copper" }) {
  return (
    <div className="h-1.5 bg-brand-beige rounded-full overflow-hidden">
      <div className={`h-full ${tone} rounded-full`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}
