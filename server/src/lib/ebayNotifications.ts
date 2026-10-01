// eBay Marketplace Account Deletion notifications (decision 39).
//   GET  ?challenge_code=…  → { challengeResponse: sha256hex(challengeCode + verificationToken + endpoint) }
//   POST notification       → verified against eBay's signature (X-EBAY-SIGNATURE: base64 JSON with
//                             the key id and an ECDSA signature of the body), then the seller is anonymised.
// The public key comes from eBay's Notification API (application token) and is cached per key id.
import { createHash, verify } from 'node:crypto';
import { config } from './config.js';

const API = 'https://api.ebay.com';

export function challengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return createHash('sha256').update(challengeCode).update(verificationToken).update(endpoint).digest('hex');
}

export interface SignatureHeader {
  alg: string;
  kid: string;
  signature: string;
  digest: string;
}

export function parseSignatureHeader(header: string | undefined): SignatureHeader | null {
  if (!header) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<SignatureHeader>;
    return h.kid && h.signature ? { alg: h.alg ?? 'ECDSA', kid: h.kid, signature: h.signature, digest: h.digest ?? 'SHA1' } : null;
  } catch {
    return null;
  }
}

/** eBay sends the key as one line ("-----BEGIN PUBLIC KEY-----MFkw…-----END PUBLIC KEY-----"). */
export function toPem(key: string): string {
  const body = key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PUBLIC KEY-----\n`;
}

/** True when `signature` (base64, DER) is the key's ECDSA signature of `body`. */
export function signatureValid(body: string, sig: SignatureHeader, publicKey: string, digest = sig.digest): boolean {
  try {
    return verify(digest.toLowerCase(), Buffer.from(body, 'utf8'), toPem(publicKey), Buffer.from(sig.signature, 'base64'));
  } catch {
    return false;
  }
}

const keys = new Map<string, { key: string; digest: string }>();
let token: { value: string; expiresAt: number } | null = null;

async function appToken(fetchImpl: typeof fetch): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  if (!config.EBAY_CLIENT_ID || !config.EBAY_CLIENT_SECRET) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set');
  const basic = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetchImpl(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`eBay OAuth ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export async function ebayPublicKey(kid: string, fetchImpl: typeof fetch = fetch): Promise<{ key: string; digest: string }> {
  const hit = keys.get(kid);
  if (hit) return hit;
  const res = await fetchImpl(`${API}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: { authorization: `Bearer ${await appToken(fetchImpl)}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`eBay public key ${res.status}`);
  const body = (await res.json()) as { key: string; digest?: string };
  const out = { key: body.key, digest: body.digest ?? 'SHA1' };
  keys.set(kid, out);
  return out;
}

export interface DeletionNotice {
  notificationId: string;
  eventDate: string | null;
  username: string;
  userId: string | null;
}

/** The fields we act on, or null when the body is not an account deletion notification. */
export function parseDeletionNotice(body: unknown): DeletionNotice | null {
  const b = body as { metadata?: { topic?: string }; notification?: { notificationId?: string; eventDate?: string; data?: { username?: string; userId?: string } } };
  const n = b?.notification;
  if (b?.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION' || !n?.notificationId || !n.data?.username) return null;
  return { notificationId: n.notificationId, eventDate: n.eventDate ?? null, username: n.data.username, userId: n.data.userId ?? null };
}

/** For tests. */
export function resetEbayNotificationCache(): void {
  keys.clear();
  token = null;
}
