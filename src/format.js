// Formatting helpers and pill tones shared by the catalogue screens (kept out of ui.jsx so that
// file only exports components).

const GREEN = "bg-emerald-50 text-emerald-700 border-emerald-200";
const GREY = "bg-slate-50 text-slate-700 border-slate-200";
const BLUE = "bg-blue-50 text-blue-700 border-blue-200";
const AMBER = "bg-amber-50 text-amber-700 border-amber-200";
const RED = "bg-red-50 text-red-700 border-red-200";

/** Pill tones for catalogue, MAP, seller and listing states. */
export const TONE = {
  Active: GREEN, Paused: GREY, Retired: GREY,
  "In force": GREEN, Superseded: GREY, Scheduled: BLUE, Expired: GREY, Cancelled: GREY,
  "MAP Authorised": GREEN, Unauthorised: RED, "Brand Direct": BLUE, Unknown: GREY,
  Staged: AMBER, Included: GREEN, Excluded: GREY,
  include: GREEN, review: AMBER, exclude: GREY,
  Synthetic: "bg-purple-50 text-purple-700 border-purple-200",
};

/** $1,299 / $1,299.50; "—" when empty. */
export const money = (n) =>
  n === null || n === undefined || n === "" ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n));

/** "Sep 24, 2026" */
export const formatDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—");

/** Read a picked file as base64 (for imports and uploads). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
