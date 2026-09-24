// Terms: generate from the catalogue with a naming template, and bulk import from CSV.
// Pure functions; the routes do the database work.
import { TERM_TYPES, type TermType } from '../collector/catalogue.js';

export interface CatalogueProduct {
  id: string;
  code: string;
  name: string;
  brand: string;
  model: string | null;
  category: string | null;
  identifiers: { type: string; value: string }[];
}

export interface PlannedTerm {
  type: TermType;
  value: string;
  productId: string | null;
  productCode: string | null;
}

export const TEMPLATE_TOKENS = ['{Brand}', '{Product Name}', '{Model}', '{Code}', '{Category}'] as const;

/**
 * Fill a naming template for one product. The product name often starts with the brand already
 * ("LG 65\" C6 OLED"), so a leading duplicate brand word is collapsed.
 */
export function renderTemplate(template: string, p: CatalogueProduct): string {
  let out = template
    .replaceAll('{Brand}', p.brand)
    .replaceAll('{Product Name}', p.name)
    .replaceAll('{Model}', p.model ?? '')
    .replaceAll('{Code}', p.code)
    .replaceAll('{Category}', p.category ?? '');
  out = out.replace(/\s+/g, ' ').trim();
  const brand = p.brand.trim();
  if (brand) {
    const dup = new RegExp(`^(${escapeRegExp(brand)})\\s+\\1\\b`, 'i');
    out = out.replace(dup, '$1');
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Unknown {Tokens} in a template, for a clear error before anything is created. */
export function unknownTokens(template: string): string[] {
  return (template.match(/\{[^}]*\}/g) ?? []).filter((t) => !(TEMPLATE_TOKENS as readonly string[]).includes(t));
}

export interface GenerateOptions {
  template: string | null; // null = no keyword terms
  identifierTypes: string[]; // e.g. ['MPN', 'UPC', 'ASIN']; [] = no identifier terms
}

/** One keyword term per product from the template, plus one identifier term per chosen identifier. */
export function planGeneratedTerms(products: CatalogueProduct[], opts: GenerateOptions): PlannedTerm[] {
  const planned: PlannedTerm[] = [];
  for (const p of products) {
    if (opts.template) {
      const value = renderTemplate(opts.template, p);
      if (value) planned.push({ type: 'keyword', value, productId: p.id, productCode: p.code });
    }
    for (const idType of opts.identifierTypes) {
      for (const ident of p.identifiers.filter((i) => i.type === idType)) {
        planned.push({ type: 'identifier', value: ident.value, productId: p.id, productCode: p.code });
      }
    }
  }
  return dedupe(planned);
}

const keyOf = (t: { type: string; value: string }) => `${t.type}|${t.value.trim().toLowerCase()}`;

function dedupe<T extends { type: string; value: string }>(terms: T[]): T[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Split planned terms into new ones and ones the account already has (same type + value, any case). */
export function splitExisting<T extends { type: string; value: string }>(
  planned: T[],
  existing: { type: string; value: string }[],
): { create: T[]; skipped: T[] } {
  const have = new Set(existing.map(keyOf));
  const create: T[] = [];
  const skipped: T[] = [];
  for (const t of planned) (have.has(keyOf(t)) ? skipped : create).push(t);
  return { create, skipped };
}

// ---------------------------------------------------------------------------
// CSV import: columns type,value,product_code,group (header row required, any column order)
// ---------------------------------------------------------------------------

export interface ImportRow {
  line: number;
  type: TermType;
  value: string;
  productCode: string | null;
  group: string;
}

export interface ImportProblem {
  line: number;
  reason: string;
  raw: string;
}

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const TYPE_ALIASES: Record<string, TermType> = { id: 'identifier', ident: 'identifier', link: 'url', storefront: 'seller' };

/** Check an import file. Rows with problems are reported, never silently dropped. */
export function parseTermImport(text: string, defaultGroup: string): { rows: ImportRow[]; problems: ImportProblem[] } {
  const table = parseCsv(text);
  const problems: ImportProblem[] = [];
  if (!table.length) return { rows: [], problems: [{ line: 1, reason: 'the file is empty', raw: '' }] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name: string) => header.indexOf(name);
  if (col('type') < 0 || col('value') < 0) {
    return { rows: [], problems: [{ line: 1, reason: 'the header row needs at least "type" and "value" columns', raw: table[0].join(',') }] };
  }
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const raw = cells.join(',');
    const rawType = (cells[col('type')] ?? '').trim().toLowerCase();
    const type = (TYPE_ALIASES[rawType] ?? rawType) as TermType;
    const value = (cells[col('value')] ?? '').trim();
    const productCode = col('product_code') >= 0 ? (cells[col('product_code')] ?? '').trim() || null : null;
    const group = col('group') >= 0 ? (cells[col('group')] ?? '').trim() || defaultGroup : defaultGroup;
    if (!TERM_TYPES.includes(type)) return problems.push({ line, reason: `unknown type "${rawType}" (use ${TERM_TYPES.join(', ')})`, raw });
    if (!value) return problems.push({ line, reason: 'value is empty', raw });
    if (value.length > 500) return problems.push({ line, reason: 'value is longer than 500 characters', raw });
    if (type === 'url' && !/^https?:\/\/\S+$/i.test(value)) return problems.push({ line, reason: 'a url term must start with http:// or https://', raw });
    if (!group) return problems.push({ line, reason: 'no group given and no default group', raw });
    const k = keyOf({ type, value });
    if (seen.has(k)) return problems.push({ line, reason: 'duplicate of an earlier row in this file', raw });
    seen.add(k);
    rows.push({ line, type, value, productCode, group });
    return undefined;
  });
  return { rows, problems };
}
