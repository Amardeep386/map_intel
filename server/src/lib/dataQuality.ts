// Data quality (Phase 3): what the dashboard banner, report notes, shaded chart days and the
// "source degraded" alert read. Same numbers as Data Health: the latest snapshot per subscribed
// source, coverage = work executed / work wanted.
import type { Db } from './db.js';

export const UNHEALTHY = ['Degraded', 'Failing', 'Blocked'];

export interface SourceState { code: string; name: string; health: string; mainFailure: string | null; checkedAt: Date | null; lastSuccessAt: Date | null }
export interface DataQuality {
  coverage: number | null; // %
  sources: SourceState[];
  degraded: SourceState[];
  note: string | null; // one line for a banner or a report, null when every source is healthy
}

export async function dataQuality(db: Db, accountId: string, at: Date = new Date()): Promise<DataQuality> {
  const rows = (await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (source_id) * FROM source_health_snapshot
        WHERE account_id = $1 AND created_at <= $2 ORDER BY source_id, created_at DESC)
     SELECT s.code, s.display_name AS name, coalesce(l.health, 'No data') AS health, l.main_failure, l.created_at, l.last_success_at,
            coalesce(l.jobs_planned, 0) AS planned, coalesce(l.jobs_executed, 0) AS executed,
            coalesce((SELECT sum(v::int) FROM jsonb_each_text(l.jobs_skipped) AS x(k, v)), 0) AS skipped
       FROM account_source a JOIN source s ON s.id = a.source_id
       LEFT JOIN latest l ON l.source_id = s.id
      WHERE a.account_id = $1 AND a.active
      ORDER BY s.display_name`,
    [accountId, at],
  )).rows;
  const executed = rows.reduce((n, r) => n + Number(r.executed), 0);
  const wanted = rows.reduce((n, r) => n + Number(r.planned) + Number(r.skipped), 0);
  const sources: SourceState[] = rows.map((r) => ({
    code: r.code, name: r.name, health: r.health, mainFailure: r.main_failure, checkedAt: r.created_at, lastSuccessAt: r.last_success_at,
  }));
  const degraded = sources.filter((s) => UNHEALTHY.includes(s.health));
  return {
    coverage: wanted ? Math.round((executed / wanted) * 1000) / 10 : null,
    sources,
    degraded,
    note: degraded.length
      ? `Data quality: ${degraded.map((s) => `${s.name} ${s.health.toLowerCase()}${s.mainFailure ? ` (${s.mainFailure.replace('_', ' ')})` : ''}`).join(', ')}. Violations from ${degraded.length === 1 ? 'this source' : 'these sources'} may be undercounted.`
      : null,
  };
}

/** Days (UTC dates) on which any subscribed source's run was not healthy, with the sources. */
export async function degradedDays(db: Db, accountId: string, from: Date, to: Date): Promise<{ day: string; sources: string[] }[]> {
  return (await db.query(
    `SELECT to_char(h.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, array_agg(DISTINCT s.display_name ORDER BY s.display_name) AS sources
       FROM source_health_snapshot h
       JOIN source s ON s.id = h.source_id
       JOIN account_source a ON a.account_id = h.account_id AND a.source_id = h.source_id AND a.active
      WHERE h.account_id = $1 AND h.created_at >= $2 AND h.created_at < $3 AND h.health = ANY($4::text[])
      GROUP BY 1 ORDER BY 1`,
    [accountId, from, to, UNHEALTHY],
  )).rows;
}
