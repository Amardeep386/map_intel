// Draw evidence cards for stored API responses that have none (eBay observations collected before
// cards existed). Each response is re-read from storage and must hash to its recorded SHA-256 first.
//   npm run evidence:cards            list what would be drawn
//   npm run evidence:cards -- --commit
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parseArgs } from 'node:util';
import { closeBrowser } from '../collector/browser.js';
import { cardSupported, insertCard, storeApiCard } from '../collector/evidenceCard.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { keyFromUri, s3, sha256Hex } from '../lib/storage.js';

const { values } = parseArgs({ options: { commit: { type: 'boolean', default: false } } });

interface Row {
  id: string;
  api_uri: string;
  api_sha256: string;
  captured_at: Date;
  source: string;
}

async function main(): Promise<void> {
  const rows = await withSystem(async (db) =>
    (
      await db.query<Row>(
        `SELECT e.id, e.api_uri, e.api_sha256, e.captured_at, s.code AS source
           FROM evidence e
           JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
           JOIN listing l ON l.id = o.listing_id
           JOIN source s ON s.id = l.source_id
          WHERE e.api_uri IS NOT NULL AND e.screenshot_uri IS NULL
            AND NOT EXISTS (SELECT 1 FROM evidence_card c WHERE c.evidence_id = e.id)
          ORDER BY e.captured_at`,
      )
    ).rows.filter((r) => cardSupported(r.source)),
  );
  console.log(`${rows.length} API responses without a card${values.commit ? '' : ' (dry run: add --commit to draw them)'}`);
  let drawn = 0;
  for (const r of rows) {
    const key = keyFromUri(r.api_uri);
    if (!values.commit) {
      console.log(`  ${r.captured_at.toISOString()}  ${key}`);
      continue;
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    const bytes = Buffer.from(await obj.Body!.transformToByteArray());
    if (sha256Hex(bytes) !== r.api_sha256.trim()) {
      console.log(`  SKIP ${key}: stored response no longer matches its SHA-256`);
      continue;
    }
    const card = await storeApiCard(r.source, key.replace(/\.json$/, ''), { body: bytes.toString('utf8'), sha256: r.api_sha256.trim(), readAt: r.captured_at });
    if (!card) continue;
    await withSystem((db) => insertCard(db, r.id, card, r.api_sha256.trim()));
    drawn += 1;
    console.log(`  drew ${card.key} (${card.bytes} bytes)`);
  }
  if (values.commit) console.log(`${drawn} cards drawn`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
