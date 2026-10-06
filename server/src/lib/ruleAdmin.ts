// Rule versions (Phase 3): drafts, dry runs, publishing and replay. A draft never judges live
// data. Publishing is refused unless a dry run exists for the draft's exact content; it closes the
// published version (valid_to = now) and the draft takes over from now. Replay re-evaluates a
// version over history into a shadow result set, next to what the live verdicts said.
import type { Db } from './db.js';
import { judgeOne, loadContext, loadObservations, loadRules, rulesAt, type DatedRule } from './judge.js';
import { contentHash, isViolating, type Outcome, type RuleVersion } from './rules.js';

export class RuleError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const FAR_PAST = new Date('2000-01-01T00:00:00Z');

interface VersionRow {
  id: string; rule_id: string; code: string; version: number; status: string; scope: RuleVersion['scope'];
  condition: RuleVersion['condition']; verdict: RuleVersion['verdict']; severity: RuleVersion['severity'];
  priority: number; content_hash: string; valid_from: Date | null; valid_to: Date | null;
}

export async function loadVersion(db: Db, versionId: string): Promise<VersionRow> {
  const v = (await db.query<VersionRow>(
    `SELECT rv.id, rv.rule_id, r.code, rv.version, rv.status, rv.scope, rv.condition, rv.verdict, rv.severity, rv.priority,
            rv.content_hash, rv.valid_from, rv.valid_to
       FROM rule_version rv JOIN rule r ON r.id = rv.rule_id WHERE rv.id = $1`,
    [versionId],
  )).rows[0];
  if (!v) throw new RuleError(404, 'rule version not found');
  return v;
}

const asDated = (v: VersionRow, from = v.valid_from ?? FAR_PAST, to = v.valid_to): DatedRule => ({
  id: v.id, ruleId: v.rule_id, code: v.code, version: v.version, scope: v.scope, condition: v.condition,
  verdict: v.verdict, severity: v.severity, priority: v.priority, validFrom: from, validTo: to,
});

export interface Comparison {
  observation: { id: string; observed_at: Date; listing_id: string; seller_id: string | null };
  live: Outcome;
  candidate: Outcome;
  candidateSeverity: string | null;
  candidateDepthPct: number | null;
}

/**
 * Evaluate a range twice: with the live rule set, and with `candidate` in place of every version of
 * the same rule (applied over the whole range, as if it had always been in force).
 */
export async function compareRange(db: Db, accountId: string, candidate: VersionRow, from: Date, to: Date): Promise<Comparison[]> {
  const obs = await loadObservations(db, accountId, { from, to });
  const live = await loadRules(db, accountId);
  const ctx = await loadContext(db, accountId, obs, live);
  const others = live.filter((r) => r.ruleId !== candidate.rule_id);
  const cand = asDated(candidate, FAR_PAST, null);
  return obs.map((o) => {
    const l = judgeOne(ctx, o, live).evaluation;
    const c = judgeOne(ctx, o, [...rulesAt(others, o.observed_at), cand]).evaluation;
    return {
      observation: { id: o.id, observed_at: o.observed_at, listing_id: o.listing_id, seller_id: o.seller_id },
      live: l.outcome, candidate: c.outcome, candidateSeverity: c.severity, candidateDepthPct: c.depthPct,
    };
  });
}

export interface DryRunResult {
  observations: number;
  listings: number;
  violationsLive: number;
  violationsCandidate: number;
  newlyViolating: number;
  noLongerViolating: number;
  bySeller: { sellerId: string | null; seller: string; newly: number; noLonger: number }[];
}

export async function summarise(db: Db, rows: Comparison[]): Promise<DryRunResult> {
  const sellers = new Map<string | null, { newly: number; noLonger: number }>();
  let vl = 0, vc = 0, newly = 0, gone = 0;
  for (const r of rows) {
    const a = isViolating(r.live), b = isViolating(r.candidate);
    if (a) vl++;
    if (b) vc++;
    if (a === b) continue;
    const s = sellers.get(r.observation.seller_id) ?? { newly: 0, noLonger: 0 };
    if (b) { newly++; s.newly++; } else { gone++; s.noLonger++; }
    sellers.set(r.observation.seller_id, s);
  }
  const ids = [...sellers.keys()].filter((k): k is string => !!k);
  const names = new Map(
    ids.length ? (await db.query<{ id: string; name: string }>('SELECT id, name FROM seller WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.id, r.name]) : [],
  );
  return {
    observations: rows.length,
    listings: new Set(rows.map((r) => r.observation.listing_id)).size,
    violationsLive: vl,
    violationsCandidate: vc,
    newlyViolating: newly,
    noLongerViolating: gone,
    bySeller: [...sellers.entries()]
      .map(([id, s]) => ({ sellerId: id, seller: id ? names.get(id) ?? 'Unknown seller' : 'No seller', ...s }))
      .sort((a, b) => b.newly + b.noLonger - (a.newly + a.noLonger)),
  };
}

export async function dryRun(db: Db, accountId: string, versionId: string, from: Date, to: Date, userId: string | null) {
  if (!(to > from)) throw new RuleError(400, 'the range must end after it starts');
  const v = await loadVersion(db, versionId);
  if (v.status !== 'Draft') throw new RuleError(409, 'only a draft is dry-run; published versions are replayed');
  const result = await summarise(db, await compareRange(db, accountId, v, from, to));
  const id = (await db.query<{ id: string }>(
    `INSERT INTO dry_run (account_id, rule_version_id, content_hash, range_from, range_to, result, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [accountId, v.id, v.content_hash, from, to, JSON.stringify(result), userId],
  )).rows[0].id;
  return { id, from, to, result };
}

/** Draft -> Published. The published version (if any) closes at the same instant. */
export async function publish(db: Db, versionId: string, userId: string | null, now = new Date()) {
  const v = await loadVersion(db, versionId);
  if (v.status !== 'Draft') throw new RuleError(409, 'only a draft can be published');
  if (contentHash(v) !== v.content_hash) throw new RuleError(409, 'draft content changed without a new hash');
  const dry = (await db.query<{ id: string }>(
    'SELECT id FROM dry_run WHERE rule_version_id = $1 AND content_hash = $2 ORDER BY created_at DESC LIMIT 1',
    [v.id, v.content_hash],
  )).rows[0];
  if (!dry) throw new RuleError(409, 'run a dry run of this exact draft before publishing');
  const closed = (await db.query<{ id: string; version: number }>(
    "UPDATE rule_version SET status = 'Closed', valid_to = $2 WHERE rule_id = $1 AND status = 'Published' RETURNING id, version",
    [v.rule_id, now],
  )).rows[0] ?? null;
  await db.query(
    `UPDATE rule_version SET status = 'Published', valid_from = $2, dry_run_id = $3, published_by = $4, published_at = $2 WHERE id = $1`,
    [v.id, now, dry.id, userId],
  );
  return { published: { id: v.id, version: v.version }, closed, dryRunId: dry.id };
}

/** Re-evaluate a version (draft or published) over history into the shadow set. */
export async function replay(db: Db, accountId: string, versionId: string, from: Date, to: Date, userId: string | null) {
  if (!(to > from)) throw new RuleError(400, 'the range must end after it starts');
  const v = await loadVersion(db, versionId);
  const run = (await db.query<{ id: string }>(
    'INSERT INTO replay_run (account_id, rule_version_id, range_from, range_to, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [accountId, v.id, from, to, userId],
  )).rows[0].id;
  const rows = await compareRange(db, accountId, v, from, to);
  const stored = new Map(
    (await db.query<{ observation_id: string; outcome: string }>(
      'SELECT observation_id, outcome FROM verdict WHERE account_id = $1 AND observed_at >= $2 AND observed_at < $3',
      [accountId, from, to],
    )).rows.map((r) => [r.observation_id, r.outcome]),
  );
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db.query(
      `INSERT INTO replay_result (replay_run_id, account_id, observation_id, observed_at, listing_id, seller_id, outcome, severity, depth_pct, live_outcome)
       SELECT $1, $2, x.observation_id, x.observed_at, x.listing_id, x.seller_id, x.outcome, x.severity, x.depth_pct, x.live_outcome
         FROM jsonb_to_recordset($3::jsonb) AS x(observation_id uuid, observed_at timestamptz, listing_id uuid, seller_id uuid,
                                                  outcome text, severity text, depth_pct numeric, live_outcome text)`,
      [run, accountId, JSON.stringify(chunk.map((r) => ({
        observation_id: r.observation.id, observed_at: r.observation.observed_at, listing_id: r.observation.listing_id,
        seller_id: r.observation.seller_id, outcome: r.candidate, severity: r.candidateSeverity, depth_pct: r.candidateDepthPct,
        live_outcome: stored.get(r.observation.id) ?? null,
      })))],
    );
  }
  const summary = await summarise(db, rows);
  await db.query("UPDATE replay_run SET status = 'done', summary = $2, finished_at = now() WHERE id = $1", [run, JSON.stringify(summary)]);
  return { id: run, summary };
}
