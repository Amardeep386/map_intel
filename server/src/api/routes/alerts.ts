// Alerts (Phase 3): the inbox (newest first, unread count), marking read, and the alert rules
// (on / off, recipients, the severity or look-ahead they use).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant } from '../../lib/db.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/alerts';

  app.get<{ Params: Params; Querystring: { unread?: string; limit?: string } }>(`${base}/events`, { config: { permission: 'alerts.read' } }, async (req) => {
    const unread = req.query.unread === 'true';
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return withTenant(req.params.accountId, async (db) => {
      const events = (await db.query(
        `SELECT e.id, e.level, e.title, e.body, e.created_at, e.read_at, e.violation_id, r.code AS rule_code, r.name AS rule
           FROM alert_event e JOIN alert_rule r ON r.id = e.alert_rule_id
          WHERE ($1::boolean IS FALSE OR e.read_at IS NULL)
          ORDER BY e.created_at DESC LIMIT $2`,
        [unread, limit],
      )).rows;
      const n = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM alert_event WHERE read_at IS NULL')).rows[0].n;
      return { unread: n, events };
    });
  });

  app.post<{ Params: Params }>(`${base}/events/read`, { config: { permission: 'alerts.read' } }, async (req) => {
    const b = parse(z.object({ ids: z.array(z.string().uuid()).max(500).optional(), all: z.boolean().optional() }), req.body ?? {});
    if (!b.all && !b.ids?.length) throw new HttpError(400, 'give ids or all: true');
    return withTenant(req.params.accountId, async (db) => {
      const { rowCount } = await db.query(
        'UPDATE alert_event SET read_at = now(), read_by = $1 WHERE read_at IS NULL AND ($2::boolean OR id = ANY($3::uuid[]))',
        [req.user?.sub ?? null, !!b.all, b.ids ?? []],
      );
      return { marked: rowCount ?? 0 };
    });
  });

  app.get<{ Params: Params }>(`${base}/rules`, { config: { permission: 'alerts.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT r.id, r.code, r.name, r.trigger, r.config, r.email, r.recipients, r.active, r.is_default, r.updated_at,
                (SELECT count(*)::int FROM alert_event e WHERE e.alert_rule_id = r.id AND e.created_at > now() - interval '30 days') AS events_30d
           FROM alert_rule r ORDER BY r.code`,
      )).rows,
    ),
  );

  app.patch<{ Params: Params & { ruleId: string } }>(`${base}/rules/:ruleId`, { config: { permission: 'alerts.write' } }, async (req) => {
    const id = uuidOr404(req.params.ruleId, 'alert rule');
    const b = parse(z.object({
      active: z.boolean().optional(),
      email: z.boolean().optional(),
      recipients: z.array(z.string().trim().email()).max(50).optional(),
      severity: z.enum(['Standard', 'Severe']).optional(),
      hoursBefore: z.number().int().min(1).max(168).optional(),
      days: z.number().int().min(1).max(365).optional(),
    }).strict(), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const cur = (await db.query('SELECT * FROM alert_rule WHERE id = $1', [id])).rows[0];
      if (!cur) throw new HttpError(404, 'alert rule not found');
      const config = { ...cur.config };
      if (b.severity && cur.trigger === 'severe_violation') config.severity = b.severity;
      if (b.hoursBefore && cur.trigger === 'source_degraded_before_report') config.hoursBefore = b.hoursBefore;
      if (b.days && cur.trigger === 'seller_reoffended') config.days = b.days;
      const r = (await db.query(
        'UPDATE alert_rule SET active = $2, email = $3, recipients = $4, config = $5 WHERE id = $1 RETURNING *',
        [id, b.active ?? cur.active, b.email ?? cur.email, b.recipients ?? cur.recipients, JSON.stringify(config)],
      )).rows[0];
      await recordAudit(db, {
        accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, action: 'alert_rule.updated', entityType: 'alert_rule', entityId: id,
        summary: `Updated alert ${cur.code}`, before: { active: cur.active, email: cur.email, recipients: cur.recipients, config: cur.config }, after: b,
      });
      return r;
    });
  });
}
