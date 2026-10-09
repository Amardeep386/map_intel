// What brands can take out of MAP Intel (Phase 5 · M9): the same datasets for the read-only public
// API (/v1, JSON pages) and the portal's CSV / XLSX exports. Each runs as the tenant (row-level
// security keeps it to the account), pages by a stable cursor, and declares the permission a
// portal user needs to export it.
import type { AccountAction } from './permissions.js';
import type { Db } from './db.js';

export interface Column {
  key: string;
  header: string;
  type?: 'number' | 'date' | 'text';
}

export interface Query {
  from?: Date;
  to?: Date;
  status?: string;
  product?: string;
  limit: number;
  after?: string | null; // cursor from the previous page
}

export interface Dataset {
  id: DatasetId;
  title: string;
  needs: AccountAction;
  columns: Column[];
  /** One page: rows in a stable order, and the cursor for the next page (null at the end). */
  page: (db: Db, q: Query) => Promise<{ rows: Record<string, unknown>[]; next: string | null }>;
}

export const DATASET_IDS = ['products', 'violations', 'observations', 'sellers', 'cases'] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

const encode = (v: unknown[]) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeCursor(c: string | null | undefined): unknown[] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Run a keyset page: `sql` must select the cursor columns as _c1, _c2 and order by them. */
async function keyset(db: Db, sql: string, params: unknown[], q: Query, cursorFrom: (r: Record<string, unknown>) => unknown[]) {
  const rows = (await db.query(sql, params)).rows as Record<string, unknown>[];
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const next = more ? encode(cursorFrom(page[page.length - 1])) : null;
  for (const r of page) for (const k of Object.keys(r)) if (k.startsWith('_c')) delete r[k];
  return { rows: page, next };
}

const products: Dataset = {
  id: 'products',
  title: 'Products',
  needs: 'catalogue.read',
  columns: [
    { key: 'product_code', header: 'Product code' }, { key: 'name', header: 'Name' }, { key: 'brand', header: 'Brand' },
    { key: 'category', header: 'Category' }, { key: 'model_number', header: 'Model' }, { key: 'status', header: 'Status' },
    { key: 'map', header: 'MAP in force', type: 'number' }, { key: 'msrp', header: 'MSRP', type: 'number' },
    { key: 'upc', header: 'UPC' }, { key: 'ean', header: 'EAN' }, { key: 'mpn', header: 'MPN' }, { key: 'asin', header: 'ASIN' },
  ],
  page: (db, q) => {
    const c = decodeCursor(q.after);
    return keyset(db,
      `SELECT p.product_code, p.name, p.brand, p.category, p.model_number, p.status,
              (SELECT mp.amount::float8 FROM map_price mp WHERE mp.product_id = p.id AND mp.effective_from <= now()
                  AND (mp.effective_to IS NULL OR now() < mp.effective_to) ORDER BY mp.effective_from DESC LIMIT 1) AS map,
              p.standard_price::float8 AS msrp,
              (SELECT string_agg(value, ' ') FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'UPC') AS upc,
              (SELECT string_agg(value, ' ') FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'EAN') AS ean,
              (SELECT string_agg(value, ' ') FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'MPN') AS mpn,
              (SELECT string_agg(value, ' ') FROM product_identifier i WHERE i.product_id = p.id AND i.type = 'ASIN') AS asin,
              p.product_code AS _c1, p.id AS _c2
         FROM product p
        WHERE ($1::text IS NULL OR (p.product_code, p.id) > ($1::text, $2::uuid))
          AND ($3::text IS NULL OR p.status = $3)
        ORDER BY p.product_code, p.id LIMIT $4`,
      [c?.[0] ?? null, c?.[1] ?? null, q.status ?? null, q.limit + 1], q, (r) => [r._c1, r._c2]);
  },
};

const violations: Dataset = {
  id: 'violations',
  title: 'Violations',
  needs: 'violations.read',
  columns: [
    { key: 'code', header: 'Violation' }, { key: 'status', header: 'Status' }, { key: 'severity', header: 'Severity' },
    { key: 'product_code', header: 'Product code' }, { key: 'product', header: 'Product' }, { key: 'seller', header: 'Seller' },
    { key: 'source', header: 'Source' }, { key: 'url', header: 'Listing URL' },
    { key: 'opened_at', header: 'Opened', type: 'date' }, { key: 'last_seen', header: 'Last seen', type: 'date' },
    { key: 'closed_at', header: 'Closed', type: 'date' }, { key: 'observations', header: 'Observations', type: 'number' },
    { key: 'last_price', header: 'Last price', type: 'number' }, { key: 'map', header: 'MAP', type: 'number' },
    { key: 'depth_pct', header: 'Depth %', type: 'number' }, { key: 'max_depth_pct', header: 'Max depth %', type: 'number' },
  ],
  page: (db, q) => {
    const c = decodeCursor(q.after);
    return keyset(db,
      `SELECT 'V-' || lpad(v.seq::text, 5, '0') AS code, v.status, v.severity, p.product_code, p.name AS product,
              s.name AS seller, src.code AS source, l.url, v.opened_at, v.last_seen, v.closed_at, v.observations,
              v.last_price::float8 AS last_price, v.last_map::float8 AS map, v.last_depth_pct::float8 AS depth_pct,
              v.max_depth_pct::float8 AS max_depth_pct, v.seq AS _c1
         FROM violation_current v
         JOIN product p ON p.id = v.product_id
         JOIN listing l ON l.id = v.listing_id
         JOIN source src ON src.id = v.source_id
         LEFT JOIN seller s ON s.id = v.seller_id
        WHERE ($1::int IS NULL OR v.seq > $1::int)
          AND ($2::text IS NULL OR v.status = $2 OR ($2 = 'active' AND NOT v.episode_closed))
          AND ($3::timestamptz IS NULL OR v.opened_at >= $3) AND ($4::timestamptz IS NULL OR v.opened_at < $4)
        ORDER BY v.seq LIMIT $5`,
      [c?.[0] ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.limit + 1], q, (r) => [r._c1]);
  },
};

const observations: Dataset = {
  id: 'observations',
  title: 'Price observations',
  needs: 'observations.read',
  columns: [
    { key: 'observed_at', header: 'Observed', type: 'date' }, { key: 'product_code', header: 'Product code' },
    { key: 'product', header: 'Product' }, { key: 'source', header: 'Source' }, { key: 'seller', header: 'Seller' },
    { key: 'price', header: 'Advertised price', type: 'number' }, { key: 'currency', header: 'Currency' },
    { key: 'availability', header: 'Availability' }, { key: 'url', header: 'Listing URL' },
    { key: 'outcome', header: 'Verdict' }, { key: 'map', header: 'MAP', type: 'number' }, { key: 'evidence_sha256', header: 'Evidence SHA-256' },
  ],
  page: (db, q) => {
    const c = decodeCursor(q.after);
    // Default window: the last 30 days (observations are the big table).
    const from = q.from ?? new Date(Date.now() - 30 * 86_400_000);
    return keyset(db,
      `SELECT o.observed_at, p.product_code, p.name AS product, src.code AS source,
              coalesce(se.name, o.seller_name_raw) AS seller, o.advertised_price::float8 AS price, o.currency, o.availability, l.url,
              vd.outcome, vd.map_amount::float8 AS map, coalesce(e.html_sha256, e.api_sha256, e.screenshot_sha256) AS evidence_sha256,
              o.observed_at AS _c1, o.id AS _c2
         FROM observation o
         JOIN listing l ON l.id = o.listing_id
         JOIN listing_match m ON m.listing_id = l.id AND m.state = 'Included' AND m.product_id IS NOT NULL
         JOIN product p ON p.id = m.product_id
         JOIN source src ON src.id = l.source_id
         LEFT JOIN seller se ON se.id = coalesce(o.seller_id, l.seller_id)
         LEFT JOIN verdict vd ON vd.observation_id = o.id
         LEFT JOIN evidence e ON e.observation_id = o.id AND e.observed_at = o.observed_at
        WHERE o.status IN ('ok', 'partial') AND o.advertised_price IS NOT NULL AND l.origin <> 'synthetic'
          AND o.observed_at >= $3 AND ($4::timestamptz IS NULL OR o.observed_at < $4)
          AND ($5::text IS NULL OR p.product_code = $5)
          AND ($1::timestamptz IS NULL OR (date_trunc('milliseconds', o.observed_at), o.id) > ($1::timestamptz, $2::uuid))
        ORDER BY date_trunc('milliseconds', o.observed_at), o.id LIMIT $6`,
      [c?.[0] ?? null, c?.[1] ?? null, from, q.to ?? null, q.product ?? null, q.limit + 1], q,
      (r) => [(r._c1 as Date).toISOString(), r._c2]);
  },
};

const sellers: Dataset = {
  id: 'sellers',
  title: 'Sellers',
  needs: 'sellers.read',
  columns: [
    { key: 'seller', header: 'Seller' }, { key: 'source', header: 'Source' }, { key: 'classification', header: 'Classification' },
    { key: 'classified_since', header: 'Since', type: 'date' }, { key: 'storefront_url', header: 'Storefront' },
    { key: 'open_violations', header: 'Open violations', type: 'number' }, { key: 'violations_total', header: 'Violations (all time)', type: 'number' },
  ],
  page: (db, q) => {
    const c = decodeCursor(q.after);
    return keyset(db,
      // The account's sellers: every one it has classified, or seen in its verdicts.
      `WITH ids AS (
         SELECT seller_id FROM seller_classification
         UNION SELECT seller_id FROM verdict WHERE seller_id IS NOT NULL
       )
       SELECT s.name AS seller, src.code AS source, coalesce(sc.class, 'Unknown') AS classification, sc.effective_from AS classified_since,
              s.storefront_url,
              (SELECT count(*)::int FROM violation_current v WHERE v.seller_id = s.id AND NOT v.episode_closed) AS open_violations,
              (SELECT count(*)::int FROM violation v WHERE v.seller_id = s.id) AS violations_total,
              lower(s.name) AS _c1, s.id AS _c2
         FROM ids
         JOIN seller s ON s.id = ids.seller_id
         JOIN source src ON src.id = s.source_id
         LEFT JOIN seller_classification sc ON sc.seller_id = s.id AND sc.effective_from <= now() AND (sc.effective_to IS NULL OR now() < sc.effective_to)
        WHERE ($1::text IS NULL OR (lower(s.name), s.id) > ($1::text, $2::uuid))
          AND ($3::text IS NULL OR coalesce(sc.class, 'Unknown') = $3)
        ORDER BY lower(s.name), s.id LIMIT $4`,
      [c?.[0] ?? null, c?.[1] ?? null, q.status ?? null, q.limit + 1], q, (r) => [r._c1, r._c2]);
  },
};

const cases: Dataset = {
  id: 'cases',
  title: 'Enforcement cases',
  needs: 'cases.read',
  columns: [
    { key: 'code', header: 'Case' }, { key: 'state', header: 'State' }, { key: 'seller', header: 'Seller' }, { key: 'source', header: 'Source' },
    { key: 'violations', header: 'Violations', type: 'number' }, { key: 'opened_at', header: 'Opened', type: 'date' },
    { key: 'response_due', header: 'Response due' }, { key: 'state_at', header: 'State since', type: 'date' },
  ],
  page: (db, q) => {
    const c = decodeCursor(q.after);
    return keyset(db,
      `SELECT 'C-' || lpad(c.seq::text, 5, '0') AS code, c.state, s.name AS seller, src.code AS source, c.violations,
              c.opened_at, to_char(c.response_due, 'YYYY-MM-DD') AS response_due, c.state_at, c.seq AS _c1
         FROM case_current c
         JOIN seller s ON s.id = c.seller_id
         JOIN source src ON src.id = c.source_id
        WHERE ($1::int IS NULL OR c.seq > $1::int)
          AND ($2::text IS NULL OR c.state = $2 OR ($2 = 'active' AND NOT c.closed))
          AND ($3::timestamptz IS NULL OR c.opened_at >= $3) AND ($4::timestamptz IS NULL OR c.opened_at < $4)
        ORDER BY c.seq LIMIT $5`,
      [c?.[0] ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.limit + 1], q, (r) => [r._c1]);
  },
};

export const DATASETS: Record<DatasetId, Dataset> = { products, violations, observations, sellers, cases };
