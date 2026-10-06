// Evidence links (Phase 3): create / list / revoke expiring links to a violation's evidence page,
// and the public endpoint behind the link (no sign-in: the token is the only key, scoped to one
// violation, expiring, revocable).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withApi, withTenant } from '../../lib/db.js';
import { createLink, evidenceRecord, openLink } from '../../lib/evidenceLinks.js';
import { violationCode } from '../../lib/violations.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string; violationId: string };

export async function evidenceLinkRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/violations/:violationId/links';

  app.get<{ Params: Params }>(base, { config: { permission: 'violations.read' } }, async (req) => {
    const id = uuidOr404(req.params.violationId, 'violation');
    return withTenant(req.params.accountId, async (db) =>
      (await db.query(
        `SELECT l.id, l.scope, l.expires_at, l.revoked_at, l.views, l.last_viewed_at, l.created_at, l.created_via, u.email AS created_by
           FROM evidence_link l LEFT JOIN app_user u ON u.id = l.created_by
          WHERE l.violation_id = $1 ORDER BY l.created_at DESC`,
        [id],
      )).rows,
    );
  });

  app.post<{ Params: Params }>(base, { config: { permission: 'violations.write' } }, async (req) => {
    const id = uuidOr404(req.params.violationId, 'violation');
    const b = parse(z.object({ days: z.number().int().min(1).max(365).default(30) }), req.body ?? {});
    return withTenant(req.params.accountId, async (db) => {
      const v = (await db.query<{ seq: number }>('SELECT seq FROM violation WHERE id = $1', [id])).rows[0];
      if (!v) throw new HttpError(404, 'violation not found');
      const link = await createLink(db, { accountId: req.params.accountId, scope: 'violation:view', violationId: id, days: b.days, createdBy: req.user?.sub ?? null });
      await recordAudit(db, {
        accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, action: 'evidence_link.created', entityType: 'evidence_link',
        entityId: link.id, summary: `Evidence link for ${violationCode(v.seq)}, expires ${link.expiresAt.toISOString().slice(0, 10)}`, after: { days: b.days },
      });
      return { id: link.id, url: link.url, expiresAt: link.expiresAt };
    });
  });

  app.post<{ Params: Params & { linkId: string } }>(`${base}/:linkId/revoke`, { config: { permission: 'violations.write' } }, async (req) => {
    const linkId = uuidOr404(req.params.linkId, 'link');
    return withTenant(req.params.accountId, async (db) => {
      const { rowCount } = await db.query('UPDATE evidence_link SET revoked_at = now() WHERE id = $1 AND violation_id = $2 AND revoked_at IS NULL', [linkId, req.params.violationId]);
      if (!rowCount) throw new HttpError(404, 'no open link');
      await recordAudit(db, {
        accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, action: 'evidence_link.revoked', entityType: 'evidence_link', entityId: linkId, summary: 'Evidence link revoked',
      });
      return { ok: true };
    });
  });

  /** The hosted evidence page's data. 404 unknown, 410 expired / revoked, 403 a link of another scope. */
  app.get<{ Params: { token: string } }>('/e/:token', { config: { permission: 'public' } }, async (req, reply) => {
    const link = await withApi((db) => openLink(db, req.params.token));
    if (!link) throw new HttpError(404, 'This evidence link is not valid.');
    if (link.state !== 'open') {
      reply.code(410);
      return { state: link.state, expiresAt: link.expires_at, message: link.state === 'expired' ? 'This evidence link has expired.' : 'This evidence link was revoked.' };
    }
    if (link.scope !== 'violation:view' || !link.violation_id) throw new HttpError(403, 'This link does not open an evidence page.');
    const record = await withTenant(link.account_id, (db) => evidenceRecord(db, link.violation_id!, { verify: true }));
    if (!record) throw new HttpError(404, 'This evidence record no longer exists.');
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
    return { state: 'open', expiresAt: link.expires_at, ...record };
  });
}
