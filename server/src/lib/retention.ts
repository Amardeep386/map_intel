// Retention (Phase 5 · M6). Each account keeps observations, evidence files and its audit log for
// its own number of days (account.settings, defaults below). Runs as the system (npm run retention).
//   * Listings and observations are shared between accounts: an observation is kept for the
//     LONGEST period of every account that maps its listing.
//   * Never purged: anything behind a violation whose episode is still open (or Open, Needs review,
//     Under notice), or a violation in a case that is not Resolved.
//   * Evidence goes first (its files, then its rows), and only once its Object Lock has passed;
//     an observation goes only when it has no evidence left. Verdicts and violations stay: they are
//     the account's decision record and carry the price, MAP and depth.
//   * Audit events: the oldest part of each chain; the last purged hash is kept as a checkpoint,
//     so the chain still verifies from there.
// Dry run unless `apply`: counts what would go, deletes nothing. Every run is logged in retention_run.
import type { Db } from './db.js';

export const RETENTION_DEFAULTS = { observations: 730, evidence: 365, audit: 2555 };
export const PLATFORM_AUDIT_DAYS = 2555;
export const LIMITS = { evidence: 2000, observations: 20000 };

export interface RetentionDays {
  observations: number;
  evidence: number;
  audit: number;
}

/** Pure: an account's retention from its settings, defaults filled in. */
export function retentionOf(settings: Record<string, unknown> | null | undefined): RetentionDays {
  const n = (k: string, d: number) => {
    const v = Number(settings?.[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    observations: n('retention_observation_days', RETENTION_DEFAULTS.observations),
    evidence: n('retention_evidence_days', RETENTION_DEFAULTS.evidence),
    audit: n('retention_audit_days', RETENTION_DEFAULTS.audit),
  };
}

/** Pure: is a retention setting acceptable? Returns the problem or null. */
export function retentionProblem(r: RetentionDays, objectLockDays: number): string | null {
  if (r.observations < 90 || r.observations > 3650) return 'observations are kept 90 to 3,650 days';
  if (r.evidence < 90 || r.evidence > r.observations) return 'evidence is kept at least 90 days and no longer than observations';
  if (objectLockDays > 0 && r.evidence < objectLockDays) return `evidence files are locked for ${objectLockDays} days: keep evidence at least that long`;
  if (r.audit < 365 || r.audit > 3650) return 'the audit log is kept 365 to 3,650 days';
  return null;
}

// Per listing: the longest retention of the accounts that map it (defaults when none does).
const LISTING_RETENTION = `
  listing_retention AS (
    SELECT l.id AS listing_id,
           coalesce(max(coalesce((a.settings->>'retention_observation_days')::int, ${RETENTION_DEFAULTS.observations})), ${RETENTION_DEFAULTS.observations}) AS obs_days,
           coalesce(max(coalesce((a.settings->>'retention_evidence_days')::int, ${RETENTION_DEFAULTS.evidence})), ${RETENTION_DEFAULTS.evidence}) AS ev_days
      FROM listing l
      LEFT JOIN listing_match m ON m.listing_id = l.id
      LEFT JOIN account a ON a.id = m.account_id
     GROUP BY l.id
  )`;

// Observations behind an open violation or an unresolved case, in any account.
const PROTECTED = `
  protected AS (
    SELECT DISTINCT v.observation_id
      FROM verdict v
      JOIN violation_observation vo ON vo.verdict_id = v.id
      JOIN violation_current x ON x.id = vo.violation_id
      LEFT JOIN case_violation cv ON cv.violation_id = x.id
      LEFT JOIN case_current c ON c.id = cv.case_id
     WHERE NOT x.episode_closed OR x.status IN ('Open', 'Needs review', 'Under notice') OR (c.id IS NOT NULL AND NOT c.closed)
  )`;

interface EvidenceRow {
  id: string;
  uris: string[];
}

export interface RetentionCounts {
  evidence: number;
  evidenceFiles: number;
  evidenceSkipped: number; // a file could not be deleted (still locked, or a storage error): row kept
  observations: number;
  audit: Record<string, number>; // per chain (account id or 'platform')
  protectedObservations: number;
  apiRequestLog: number; // public API call log entries past 90 days (Phase 5 · M9)
}

async function evidenceCandidates(db: Db, now: Date, limit: number): Promise<EvidenceRow[]> {
  return (await db.query<EvidenceRow>(
    `WITH ${LISTING_RETENTION}, ${PROTECTED}
     SELECT e.id, array_remove(ARRAY[e.html_uri, e.screenshot_uri, e.pdf_uri, e.api_uri, c.uri], NULL) AS uris
       FROM evidence e
       JOIN observation o ON o.id = e.observation_id AND o.observed_at = e.observed_at
       JOIN listing_retention r ON r.listing_id = o.listing_id
       LEFT JOIN evidence_card c ON c.evidence_id = e.id
      WHERE e.observed_at < $1::timestamptz - make_interval(days => r.ev_days)
        AND (e.lock_until IS NULL OR e.lock_until < $1)
        AND e.observation_id NOT IN (SELECT observation_id FROM protected)
      ORDER BY e.observed_at
      LIMIT $2`,
    [now, limit],
  )).rows;
}

async function observationCandidates(db: Db, now: Date, limit: number): Promise<{ id: string; observed_at: Date }[]> {
  return (await db.query(
    `WITH ${LISTING_RETENTION}, ${PROTECTED}
     SELECT o.id, o.observed_at
       FROM observation o
       JOIN listing_retention r ON r.listing_id = o.listing_id
      WHERE o.observed_at < $1::timestamptz - make_interval(days => r.obs_days)
        AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.observation_id = o.id AND e.observed_at = o.observed_at)
        AND o.id NOT IN (SELECT observation_id FROM protected)
      ORDER BY o.observed_at
      LIMIT $2`,
    [now, limit],
  )).rows;
}

/** Per chain: the newest seq that may go (every event up to it is past the chain's retention). */
async function auditCutoffs(db: Db, now: Date): Promise<{ chain: string | null; upToSeq: number; count: number }[]> {
  return (await db.query(
    `WITH chains AS (
       SELECT a.id AS chain, coalesce((a.settings->>'retention_audit_days')::int, ${RETENTION_DEFAULTS.audit}) AS days FROM account a
       UNION ALL SELECT NULL, ${PLATFORM_AUDIT_DAYS}
     ),
     firstKept AS (
       SELECT c.chain, c.days,
              (SELECT min(e.seq) FROM audit_event e WHERE e.account_id IS NOT DISTINCT FROM c.chain
                  AND e.occurred_at >= $1::timestamptz - make_interval(days => c.days)) AS first_kept
         FROM chains c
     )
     SELECT f.chain, x.up_to AS "upToSeq", x.n::int AS count
       FROM firstKept f
       CROSS JOIN LATERAL (
         SELECT max(e.seq) AS up_to, count(*) AS n FROM audit_event e
          WHERE e.account_id IS NOT DISTINCT FROM f.chain
            AND e.occurred_at < $1::timestamptz - make_interval(days => f.days)
            AND (f.first_kept IS NULL OR e.seq < f.first_kept)
       ) x
      WHERE x.n > 0`,
    [now],
  )).rows;
}

export type DeleteFile = (uri: string) => Promise<unknown>;

/**
 * One retention pass. `db` must be the system connection (owner); a dry run only counts. With
 * `apply`, files are deleted first and a row goes only when all its files went.
 */
export async function runRetention(db: Db, opts: { apply: boolean; now?: Date; deleteFile: DeleteFile; limits?: typeof LIMITS }): Promise<RetentionCounts> {
  const now = opts.now ?? new Date();
  const limits = opts.limits ?? LIMITS;
  const counts: RetentionCounts = { evidence: 0, evidenceFiles: 0, evidenceSkipped: 0, observations: 0, audit: {}, protectedObservations: 0, apiRequestLog: 0 };
  counts.protectedObservations = Number((await db.query(`WITH ${PROTECTED} SELECT count(*) FROM protected`)).rows[0].count);

  const evidence = await evidenceCandidates(db, now, limits.evidence);
  const observations = await observationCandidates(db, now, limits.observations);
  const audit = await auditCutoffs(db, now);
  const API_LOG_OLD = "at < $1::timestamptz - interval '90 days'";
  if (!opts.apply) {
    counts.apiRequestLog = Number((await db.query(`SELECT count(*) FROM api_request_log WHERE ${API_LOG_OLD}`, [now])).rows[0].count);
    counts.evidence = evidence.length;
    counts.evidenceFiles = evidence.reduce((n, e) => n + e.uris.length, 0);
    counts.observations = observations.length;
    for (const a of audit) counts.audit[a.chain ?? 'platform'] = a.count;
    return counts;
  }

  counts.apiRequestLog = (await db.query(`DELETE FROM api_request_log WHERE ${API_LOG_OLD}`, [now])).rowCount ?? 0;
  await db.query("SELECT set_config('app.purging', 'on', true)");
  try {
    const gone: string[] = [];
    for (const e of evidence) {
      try {
        for (const uri of e.uris) {
          await opts.deleteFile(uri);
          counts.evidenceFiles++;
        }
        gone.push(e.id);
      } catch {
        counts.evidenceSkipped++;
      }
    }
    if (gone.length) {
      await db.query('DELETE FROM evidence_card WHERE evidence_id = ANY($1::uuid[])', [gone]);
      counts.evidence = (await db.query('DELETE FROM evidence WHERE id = ANY($1::uuid[])', [gone])).rowCount ?? 0;
    }
    // Observations whose evidence went in this pass are picked up by the next pass.
    if (observations.length) {
      counts.observations = (await db.query(
        `DELETE FROM observation o USING jsonb_to_recordset($1::jsonb) AS x(id uuid, observed_at timestamptz)
          WHERE o.id = x.id AND o.observed_at = x.observed_at`,
        [JSON.stringify(observations)],
      )).rowCount ?? 0;
    }
    for (const a of audit) {
      const last = (await db.query<{ hash: string }>('SELECT hash FROM audit_event WHERE seq = $1', [a.upToSeq])).rows[0];
      const n = (await db.query('DELETE FROM audit_event WHERE account_id IS NOT DISTINCT FROM $1 AND seq <= $2', [a.chain, a.upToSeq])).rowCount ?? 0;
      await db.query(
        `INSERT INTO audit_checkpoint (account_id, last_seq, last_hash, purged_before, purged_count) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id) DO UPDATE SET last_seq = EXCLUDED.last_seq, last_hash = EXCLUDED.last_hash,
           purged_before = EXCLUDED.purged_before, purged_count = audit_checkpoint.purged_count + EXCLUDED.purged_count, updated_at = now()`,
        [a.chain, a.upToSeq, last.hash, now, n],
      );
      counts.audit[a.chain ?? 'platform'] = n;
    }
  } finally {
    await db.query("SELECT set_config('app.purging', 'off', true)");
  }
  return counts;
}
