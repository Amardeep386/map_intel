// Evidence links (Phase 3): expiring, scoped tokens for the hosted evidence page and hosted reports.
// Only the token's SHA-256 is stored. The evidence record lists the facts a violation was judged on
// and every stored proof file with its hash; the latest proof is re-hashed on view and its Object
// Lock retention read back.
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { Db } from './db.js';
import { canonicalJson } from './rules.js';
import { signedUrl, verifyEvidence } from './storage.js';
import { violationDetail } from './violations.js';

export const DEFAULT_LINK_DAYS = 90;
export const hashLinkToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export function portalLink(path: string): string {
  return new URL(path, config.PORTAL_URL.replace(/\/?$/, '/')).toString();
}

export interface NewLink {
  accountId: string;
  scope: 'violation:view' | 'report:view';
  violationId?: string | null;
  reportRunId?: string | null;
  days?: number;
  createdBy?: string | null;
  via?: 'portal' | 'report' | 'alert' | 'test' | 'notice';
  now?: Date;
}

export async function createLink(db: Db, l: NewLink): Promise<{ id: string; token: string; url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = l.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (l.days ?? DEFAULT_LINK_DAYS) * 86_400_000);
  const id = (await db.query<{ id: string }>(
    `INSERT INTO evidence_link (account_id, token_hash, scope, violation_id, report_run_id, expires_at, created_by, created_via, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [l.accountId, hashLinkToken(token), l.scope, l.violationId ?? null, l.reportRunId ?? null, expiresAt, l.createdBy ?? null, l.via ?? 'portal', now],
  )).rows[0].id;
  const path = l.scope === 'violation:view' ? `evidence/${token}` : `report/${token}`;
  return { id, token, url: portalLink(path), expiresAt };
}

export interface OpenedLink {
  link_id: string;
  account_id: string;
  scope: string;
  violation_id: string | null;
  report_run_id: string | null;
  expires_at: Date;
  state: 'open' | 'expired' | 'revoked';
}

/** Resolve a token from a public request (counts the view when the link is usable). */
export async function openLink(db: Db, token: string): Promise<OpenedLink | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return ((await db.query('SELECT * FROM app_open_evidence_link($1)', [hashLinkToken(token)])).rows[0] as OpenedLink) ?? null;
}

interface FileRow { uri: string | null; sha256: string | null; bytes: number | null }
const file = async (f: FileRow) => (f.uri ? { sha256: f.sha256, bytes: f.bytes, url: await signedUrl(f.uri) } : null);

/** What the evidence page shows for one violation, read as its account. */
export async function evidenceRecord(db: Db, violationId: string, opts: { verify?: boolean } = {}) {
  const v = await violationDetail(db, violationId);
  if (!v) return null;
  const account = (await db.query<{ brand: string }>('SELECT a.brand FROM account a JOIN violation x ON x.account_id = a.id WHERE x.id = $1', [violationId])).rows[0];
  const proofs = (await db.query(
    `SELECT vd.observed_at, vd.observed_price::float8 AS price, e.id, e.method, e.captured_at,
            e.screenshot_uri, e.screenshot_sha256, e.screenshot_bytes, e.html_uri, e.html_sha256, e.html_bytes,
            e.api_uri, e.api_sha256, e.api_bytes, c.uri AS card_uri, c.sha256 AS card_sha256, c.bytes AS card_bytes
       FROM violation_observation vo
       JOIN verdict vd ON vd.id = vo.verdict_id
       JOIN evidence e ON e.observation_id = vd.observation_id AND e.observed_at = vd.observed_at
       LEFT JOIN evidence_card c ON c.evidence_id = e.id
      WHERE vo.violation_id = $1 ORDER BY vo.observed_at DESC LIMIT 10`,
    [violationId],
  )).rows;

  const facts = {
    record: v.code,
    brand: account?.brand ?? null,
    product: { sku: v.sku, name: v.product },
    seller: { name: v.seller, classAtCapture: v.class_at_capture, source: v.source },
    listing: { url: v.url, title: v.title },
    map: v.last_map, advertised: v.last_price, depthAbs: v.last_depth_abs, depthPct: v.last_depth_pct, severity: v.severity,
    firstSeen: v.opened_at, lastSeen: v.last_seen, status: v.status, rule: v.rule,
    policy: v.policy,
    observations: v.history.filter((h: { in_violation: boolean }) => h.in_violation)
      .map((h: { observed_at: Date; price: number; map: number; depth_pct: number; outcome: string }) => ({ at: h.observed_at, price: h.price, map: h.map, depthPct: h.depth_pct, outcome: h.outcome })),
    proofs: proofs.map((p) => ({
      capturedAt: p.captured_at, method: p.method,
      sha256: { screenshot: p.screenshot_sha256, html: p.html_sha256, api: p.api_sha256, card: p.card_sha256 },
    })),
  };
  const recordSha256 = createHash('sha256').update(canonicalJson(facts)).digest('hex');

  let check: { file: string; ok: boolean; retainUntil: Date | null; mode: string | null } | null = null;
  const latest = proofs[0];
  if (opts.verify && latest) {
    const [kind, uri, sha] = latest.screenshot_uri ? ['screenshot', latest.screenshot_uri, latest.screenshot_sha256]
      : latest.card_uri ? ['evidence card', latest.card_uri, latest.card_sha256]
        : latest.api_uri ? ['API response', latest.api_uri, latest.api_sha256] : ['page HTML', latest.html_uri, latest.html_sha256];
    if (uri && sha) {
      const r = await verifyEvidence(uri, sha).catch(() => null);
      check = { file: kind, ok: r?.ok ?? false, retainUntil: r?.retainUntil ?? null, mode: r?.mode ?? null };
    }
  }

  return {
    ...facts,
    recordSha256,
    verification: check,
    files: await Promise.all(proofs.map(async (p) => ({
      id: p.id, observedAt: p.observed_at, price: p.price, capturedAt: p.captured_at, method: p.method,
      screenshot: await file({ uri: p.screenshot_uri, sha256: p.screenshot_sha256, bytes: p.screenshot_bytes }),
      card: await file({ uri: p.card_uri, sha256: p.card_sha256, bytes: p.card_bytes }),
      html: await file({ uri: p.html_uri, sha256: p.html_sha256, bytes: p.html_bytes }),
      api: await file({ uri: p.api_uri, sha256: p.api_sha256, bytes: p.api_bytes }),
    }))),
  };
}
