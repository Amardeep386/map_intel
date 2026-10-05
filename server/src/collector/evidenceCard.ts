// Draw and store the evidence card for an API response (apiCard.ts), next to the response itself.
import type { Db } from '../lib/db.js';
import { putObject, type StoredObject } from '../lib/storage.js';
import { apiCardHtml, ebayCardFields } from './apiCard.js';
import { renderCard } from './browser.js';

const CARD_SOURCES: Record<string, { sourceName: string; apiName: string; fields: typeof ebayCardFields }> = {
  ebay_us: { sourceName: 'eBay', apiName: 'eBay Browse API', fields: ebayCardFields },
};

export function cardSupported(sourceCode: string): boolean {
  return sourceCode in CARD_SOURCES;
}

/** Render the card for a stored API response and store it as `<base>.card.png` (null: no card for this source). */
export async function storeApiCard(
  sourceCode: string,
  base: string,
  api: { body: string; sha256: string; readAt: Date },
): Promise<StoredObject | null> {
  const s = CARD_SOURCES[sourceCode];
  if (!s) return null;
  const png = await renderCard(apiCardHtml(s.fields(api.body), { sourceName: s.sourceName, apiName: s.apiName, readAt: api.readAt, apiSha256: api.sha256 }));
  return putObject(`${base}.card.png`, png, 'image/png');
}

export async function insertCard(db: Db, evidenceId: string, card: StoredObject, sourceSha256: string): Promise<void> {
  await db.query(
    `INSERT INTO evidence_card (evidence_id, uri, sha256, bytes, source_sha256, lock_mode, lock_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (evidence_id) DO NOTHING`,
    [evidenceId, card.uri, card.sha256, card.bytes, sourceSha256, card.lock?.mode ?? null, card.lock?.until ?? null],
  );
}
