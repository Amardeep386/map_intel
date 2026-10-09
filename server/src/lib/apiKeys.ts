// API keys for the read-only public API (Phase 5 · M9). A key belongs to one account and is shown
// once: "mik_<8-char prefix>_<secret>". Only its SHA-256 is stored; the prefix finds the row.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(8);
  const prefix = [...bytes].map((b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join('');
  const key = `mik_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix, hash: hashKey(key) };
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** The prefix of a well-formed key, or null. */
export function parseKey(key: string): string | null {
  const m = /^mik_([a-z0-9]{8})_[A-Za-z0-9_-]{32}$/.exec(key);
  return m ? m[1] : null;
}

export interface ApiKeyAuth {
  id: string;
  accountId: string;
  name: string;
}

/** Check a presented key (API role connection). Null for anything wrong, revoked or expired. */
export async function authenticateKey(db: Db, key: string): Promise<ApiKeyAuth | null> {
  const prefix = parseKey(key);
  if (!prefix) return null;
  const row = (await db.query<{ id: string; account_id: string; key_hash: string; name: string }>('SELECT * FROM app_api_key_lookup($1)', [prefix])).rows[0];
  if (!row) return null;
  const ok = timingSafeEqual(Buffer.from(row.key_hash), Buffer.from(hashKey(key)));
  return ok ? { id: row.id, accountId: row.account_id, name: row.name } : null;
}
