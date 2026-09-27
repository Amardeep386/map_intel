// Write the collector-declared source catalogue (collector/catalogue.ts) into source_family and
// source. Used by the seed and by exit tests; the shared catalogue is the only cross-account data.
import { SOURCE_CATALOGUE, optionsSchema } from '../collector/catalogue.js';
import type { Db } from './db.js';

export async function syncSourceCatalogue(db: Db): Promise<Map<string, string>> {
  const familyIds = new Map<string, string>();
  for (const f of new Map(SOURCE_CATALOGUE.map((d) => [d.family.code, d.family])).values()) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO source_family (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [f.code, f.name],
    );
    familyIds.set(f.code, rows[0].id);
  }

  const sourceIds = new Map<string, string>();
  for (const s of SOURCE_CATALOGUE) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO source (code, internal_name, display_name, category, country, base_url, capability, options_schema, family_id, collector_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (code) DO UPDATE SET internal_name = EXCLUDED.internal_name, display_name = EXCLUDED.display_name,
         category = EXCLUDED.category, country = EXCLUDED.country, base_url = EXCLUDED.base_url, capability = EXCLUDED.capability,
         options_schema = EXCLUDED.options_schema, family_id = EXCLUDED.family_id, collector_status = EXCLUDED.collector_status
       RETURNING id`,
      [s.code, s.internalName, s.displayName, s.category, s.country, s.baseUrl, JSON.stringify(s.capability),
        JSON.stringify(optionsSchema(s)), familyIds.get(s.family.code), s.collectorStatus],
    );
    sourceIds.set(s.code, rows[0].id);
  }
  return sourceIds;
}
