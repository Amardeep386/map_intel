// Catalogue imports (products, MAP files, listing candidates): read a CSV or XLSX file, map its
// columns to fields, check every row, and compare with what the account already has. The route
// returns this as a dry run first and only writes on commit. Pure except readTable (XLSX parsing).
import ExcelJS from 'exceljs';
import { parseCsv } from './terms.js';

export const IMPORT_KINDS = ['products', 'map', 'listings'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  /** Header names (normalised) that map to this field without the user choosing. */
  synonyms: string[];
}

const alt = (n: number): FieldSpec => ({ key: `alt${n}`, label: `Alt SKU ${n}`, required: false, synonyms: [`alt_sku_${n}`, `alt${n}`, `alternate_sku_${n}`, `alt_sku${n}`] });

export const IMPORT_FIELDS: Record<ImportKind, FieldSpec[]> = {
  products: [
    { key: 'code', label: 'SKU (product code)', required: true, synonyms: ['sku', 'code', 'product_code', 'item', 'item_code', 'client_sku'] },
    { key: 'name', label: 'Product name', required: false, synonyms: ['name', 'product', 'product_name', 'title', 'description'] },
    { key: 'model', label: 'Model / MPN', required: false, synonyms: ['model', 'mpn', 'model_number', 'part_number', 'manufacturer_part_number'] },
    { key: 'category', label: 'Category', required: false, synonyms: ['category', 'product_category', 'type'] },
    { key: 'group', label: 'Product group', required: false, synonyms: ['group', 'product_group', 'line', 'product_line', 'series'] },
    { key: 'msrp', label: 'MSRP', required: false, synonyms: ['msrp', 'rrp', 'list_price', 'standard_price', 'srp'] },
    { key: 'upc', label: 'UPC', required: false, synonyms: ['upc', 'upc_code', 'gtin', 'gtin12'] },
    { key: 'ean', label: 'EAN', required: false, synonyms: ['ean', 'ean13', 'ean_code', 'gtin13'] },
    { key: 'asin', label: 'ASIN', required: false, synonyms: ['asin', 'amazon_asin'] },
    alt(1), alt(2), alt(3), alt(4), alt(5), alt(6),
    { key: 'status', label: 'Status', required: false, synonyms: ['status', 'state', 'active'] },
  ],
  map: [
    { key: 'code', label: 'SKU (product code)', required: true, synonyms: ['sku', 'code', 'product_code', 'item', 'model', 'mpn'] },
    { key: 'amount', label: 'MAP', required: true, synonyms: ['map', 'amount', 'map_price', 'minimum_advertised_price', 'price'] },
    { key: 'from', label: 'Effective from', required: true, synonyms: ['from', 'start', 'effective_from', 'start_date', 'effective_date', 'date'] },
    { key: 'to', label: 'Effective to', required: false, synonyms: ['to', 'end', 'effective_to', 'end_date', 'until'] },
    { key: 'region', label: 'Region', required: false, synonyms: ['region', 'country', 'market'] },
    { key: 'note', label: 'Note', required: false, synonyms: ['note', 'notes', 'comment', 'reason'] },
  ],
  listings: [
    { key: 'url', label: 'URL', required: true, synonyms: ['url', 'link', 'listing_url', 'product_url'] },
    { key: 'source', label: 'Source', required: false, synonyms: ['source', 'retailer', 'marketplace', 'site', 'channel'] },
    { key: 'title', label: 'Title', required: false, synonyms: ['title', 'name', 'product', 'listing_title'] },
    { key: 'price', label: 'Price', required: false, synonyms: ['price', 'advertised_price', 'sale_price', 'amount'] },
    { key: 'seller', label: 'Seller', required: false, synonyms: ['seller', 'merchant', 'store', 'sold_by', 'seller_name'] },
    { key: 'condition', label: 'Condition', required: false, synonyms: ['condition', 'item_condition'] },
    { key: 'format', label: 'Listing format', required: false, synonyms: ['format', 'listing_format', 'buying_format'] },
    { key: 'image', label: 'Image URL', required: false, synonyms: ['image', 'image_url', 'picture'] },
    { key: 'channelSku', label: 'Retailer id (ASIN, SKU, item id)', required: false, synonyms: ['channel_sku', 'retailer_id', 'item_id', 'asin', 'retailer_sku'] },
    { key: 'product', label: 'Proposed SKU (optional)', required: false, synonyms: ['sku', 'product_code', 'proposed_sku'] },
  ],
};

/** A header cell as a comparable key: "Alt SKU 1" -> "alt_sku_1". */
export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export type ColumnMapping = Record<string, number | null>;

/** Map each field to the first header column whose name is one of its synonyms. */
export function guessMapping(kind: ImportKind, header: string[]): ColumnMapping {
  const keys = header.map(normaliseHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const f of IMPORT_FIELDS[kind]) {
    const idx = keys.findIndex((k, i) => !used.has(i) && (k === normaliseHeader(f.key) || f.synonyms.includes(k)));
    mapping[f.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

/** Read a CSV or XLSX file (base64) into rows of text cells; the first row is the header. */
export async function readTable(fileName: string, base64: string): Promise<string[][]> {
  const buf = Buffer.from(base64, 'base64');
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    // exceljs' Buffer type lags behind @types/node; the bytes are what it needs.
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    });
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }
  if (/\.xls$/i.test(fileName)) throw new Error('old .xls files are not supported: save the sheet as .xlsx or .csv');
  return parseCsv(buf.toString('utf8'));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    return '';
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

/** "$1,299.00" -> 1299. Returns null for empty, NaN for text that is not a number. */
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/^[A-Z]{3}\s*/i, '').replace(/[$£€,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : Number.NaN;
}

/** YYYY-MM-DD, MM/DD/YYYY or an Excel serial date -> YYYY-MM-DD; null when empty; 'invalid' otherwise. */
export function parseDate(s: string): string | null | 'invalid' {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (/^\d{5}$/.test(t)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000);
    return date.toISOString().slice(0, 10);
  } else return 'invalid';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return 'invalid';
  return date.toISOString().slice(0, 10);
}

/** GS1 check digit for UPC-A (12) and EAN-13 (13). */
export function validGtin(code: string): boolean {
  if (!/^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export const ASIN_RE = /^(B0[0-9A-Z]{8}|\d{9}[\dX])$/;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Problem {
  line: number;
  reason: string;
}

export interface RawRow {
  line: number;
  values: Record<string, string>;
}

/** Apply the mapping, check required fields and drop fully empty rows. Header is line 1. */
export function extractRows(kind: ImportKind, table: string[][], mapping: ColumnMapping): { rows: RawRow[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const missing = IMPORT_FIELDS[kind].filter((f) => f.required && (mapping[f.key] === null || mapping[f.key] === undefined));
  if (missing.length) return { rows: [], problems: [{ line: 1, reason: `map a column to: ${missing.map((f) => f.label).join(', ')}` }] };
  const rows: RawRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const values: Record<string, string> = {};
    for (const f of IMPORT_FIELDS[kind]) {
      const idx = mapping[f.key];
      values[f.key] = idx === null || idx === undefined ? '' : (cells[idx] ?? '').trim();
    }
    const line = i + 2;
    const empty = IMPORT_FIELDS[kind].filter((f) => f.required && !values[f.key]);
    if (empty.length) problems.push({ line, reason: `${empty.map((f) => f.label).join(', ')} is empty` });
    else rows.push({ line, values });
  });
  return { rows, problems };
}

// ---------------------------------------------------------------------------
// Products: compare with the catalogue
// ---------------------------------------------------------------------------

export const PRODUCT_STATUSES = ['Active', 'Paused', 'Retired'] as const;
export const IDENTIFIER_FIELDS = ['upc', 'ean', 'asin', 'alt1', 'alt2', 'alt3', 'alt4', 'alt5', 'alt6'] as const;

export interface ExistingProduct {
  id: string;
  code: string;
  name: string;
  model: string | null;
  category: string | null;
  group: string | null;
  msrp: number | null;
  status: string;
  /** Identifier values by field key: upc, ean, asin (any of several), alt1..alt6. */
  identifiers: Record<string, string[]>;
}

export interface ProductChange {
  line: number;
  code: string;
  kind: 'new' | 'changed';
  productId?: string;
  /** field -> [before, after]; for new products before is null. */
  fields: Record<string, [string | number | null, string | number | null]>;
}

export interface ProductPlan {
  changes: ProductChange[];
  unchanged: number;
  problems: Problem[];
}

/** Which identifier values already belong to another product: `${type}:${VALUE}` -> product code. */
export type IdentifierOwners = Map<string, string>;

const idType = (field: string) => (field.startsWith('alt') ? 'ALT' : field.toUpperCase());

/**
 * Compare file rows with existing products. Empty cells never clear a value. A row is an error
 * (and skipped) when a value is invalid or an identifier already belongs to another product.
 */
export function planProducts(rows: RawRow[], existing: ExistingProduct[], owners: IdentifierOwners): ProductPlan {
  const byCode = new Map(existing.map((p) => [p.code.toLowerCase(), p]));
  const changes: ProductChange[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const { line, values: v } of rows) {
    const code = v.code;
    const errs: string[] = [];
    if (code.length > 64) errs.push('SKU is longer than 64 characters');
    if (seen.has(code.toLowerCase())) errs.push(`SKU ${code} appears more than once in the file`);
    seen.add(code.toLowerCase());
    const cur = byCode.get(code.toLowerCase());
    if (!cur && !v.name) errs.push('a new SKU needs a product name');

    const msrp = parseMoney(v.msrp ?? '');
    if (Number.isNaN(msrp) || (msrp !== null && msrp <= 0)) errs.push(`MSRP "${v.msrp}" is not a positive amount`);
    let status: string | null = null;
    if (v.status) {
      status = PRODUCT_STATUSES.find((s) => s.toLowerCase() === v.status.toLowerCase()) ?? null;
      if (!status) errs.push(`status "${v.status}" is not Active, Paused or Retired`);
    }
    if (v.upc && !(/^\d{12}$/.test(v.upc) && validGtin(v.upc))) errs.push(`UPC ${v.upc} is not a valid 12-digit UPC`);
    if (v.ean && !(/^\d{13}$/.test(v.ean) && validGtin(v.ean))) errs.push(`EAN ${v.ean} is not a valid 13-digit EAN`);
    if (v.asin && !ASIN_RE.test(v.asin.toUpperCase())) errs.push(`ASIN ${v.asin} does not look like an ASIN`);
    for (const f of IDENTIFIER_FIELDS) {
      const val = v[f];
      if (!val) continue;
      const owner = owners.get(`${idType(f)}:${val.toUpperCase()}`);
      if (owner && owner.toLowerCase() !== code.toLowerCase()) errs.push(`${f.toUpperCase()} ${val} already belongs to ${owner}`);
    }
    if (v.model) {
      const owner = owners.get(`MPN:${v.model.toUpperCase()}`);
      if (owner && owner.toLowerCase() !== code.toLowerCase()) errs.push(`model ${v.model} already belongs to ${owner}`);
    }
    if (errs.length) {
      problems.push({ line, reason: errs.join('; ') });
      continue;
    }

    const next: Record<string, string | number | null> = {
      name: v.name || null,
      model: v.model || null,
      category: v.category || null,
      group: v.group || null,
      msrp,
      status,
    };
    for (const f of IDENTIFIER_FIELDS) next[f] = f === 'asin' && v[f] ? v[f].toUpperCase() : v[f] || null;

    const fields: ProductChange['fields'] = {};
    if (!cur) {
      for (const [k, val] of Object.entries(next)) if (val !== null) fields[k] = [null, val];
      changes.push({ line, code, kind: 'new', fields });
      continue;
    }
    const before: Record<string, string | number | null> = {
      name: cur.name, model: cur.model, category: cur.category, group: cur.group, msrp: cur.msrp, status: cur.status,
    };
    for (const [k, val] of Object.entries(next)) {
      if (val === null) continue;
      if (k in before) {
        if (String(before[k] ?? '') !== String(val)) fields[k] = [before[k] ?? null, val];
      } else {
        // Identifiers: UPC / EAN / ASIN add a value; an alt SKU slot holds one value.
        const have = cur.identifiers[k] ?? [];
        if (!have.some((h) => h.toUpperCase() === String(val).toUpperCase())) fields[k] = [have.join(', ') || null, val];
      }
    }
    if (Object.keys(fields).length) changes.push({ line, code: cur.code, kind: 'changed', productId: cur.id, fields });
    else unchanged++;
  }
  return { changes, unchanged, problems };
}

// ---------------------------------------------------------------------------
// MAP files: new versions per product and region
// ---------------------------------------------------------------------------

export interface MapVersion {
  id: string;
  productId: string;
  region: string | null;
  amount: number;
  from: string; // YYYY-MM-DD (in the account's time zone)
  to: string | null;
}

export interface MapChange {
  line: number;
  code: string;
  productId: string;
  region: string | null;
  amount: number;
  from: string;
  to: string | null;
  note: string | null;
  /** The open version this one closes (its effective_to becomes `from`). */
  closes: { id: string; amount: number; from: string } | null;
  current: number | null;
}

export interface MapPlan {
  changes: MapChange[];
  unchanged: number;
  unknown: Problem[];
  problems: Problem[];
}

/**
 * Plan new MAP versions. A new version must start after the open version it replaces, which
 * is closed on that date; history is never rewritten, so dates before the open version and
 * overlaps with closed versions are errors. The same amount already in force is "unchanged".
 */
export function planMap(rows: RawRow[], products: Map<string, string>, versions: MapVersion[]): MapPlan {
  const changes: MapChange[] = [];
  const problems: Problem[] = [];
  const unknown: Problem[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (const { line, values: v } of rows) {
    const productId = products.get(v.code.toLowerCase());
    if (!productId) {
      unknown.push({ line, reason: `unknown SKU ${v.code}` });
      continue;
    }
    const errs: string[] = [];
    const amount = parseMoney(v.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0) errs.push(`MAP "${v.amount}" is not a positive amount`);
    const from = parseDate(v.from);
    const to = parseDate(v.to ?? '');
    if (from === null || from === 'invalid') errs.push(`effective from "${v.from}" is not a date`);
    if (to === 'invalid') errs.push(`effective to "${v.to}" is not a date`);
    const region = v.region ? v.region.toUpperCase() : null;
    const key = `${productId}|${region ?? ''}`;
    if (seen.has(key)) errs.push(`${v.code}${region ? ` (${region})` : ''} appears more than once in the file`);
    seen.add(key);
    if (errs.length || from === null || from === 'invalid' || to === 'invalid' || amount === null) {
      problems.push({ line, reason: errs.join('; ') });
      continue;
    }
    if (to && to <= from) {
      problems.push({ line, reason: 'effective to must be after effective from' });
      continue;
    }
    const mine = versions.filter((m) => m.productId === productId && (m.region ?? null) === region);
    const open = mine.find((m) => m.to === null) ?? null;
    if (open && open.amount === amount && to === null) {
      unchanged++;
      continue;
    }
    if (open && from <= open.from) {
      problems.push({ line, reason: `the MAP in force (${open.amount}) starts ${open.from}; a new version must start after it` });
      continue;
    }
    const clash = mine.find((m) => m.to !== null && from < m.to && (to === null || to > m.from));
    if (clash) {
      problems.push({ line, reason: `overlaps the MAP version ${clash.from} to ${clash.to}` });
      continue;
    }
    changes.push({
      line, code: v.code, productId, region, amount, from, to, note: v.note || null,
      closes: open ? { id: open.id, amount: open.amount, from: open.from } : null,
      current: open?.amount ?? null,
    });
  }
  return { changes, unchanged, unknown, problems };
}
