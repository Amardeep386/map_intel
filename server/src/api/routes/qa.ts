// Learning loop (Phase 4 · M7): the weekly QA sample of automatic Mapping Center decisions, the
// verdicts (a wrong one corrects the listing) and the precision they give. Audited.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant } from '../../lib/db.js';
import { drawSample, listSamples, QaError, qaStats, reviewSample } from '../../lib/qa.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

export async function qaRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/mapping/qa';

  app.get<{ Params: Params; Querystring: Record<string, string | undefined> }>(base, { config: { permission: 'mapping.read' } }, async (req) => {
    const q = parse(z.object({ week: z.string().date().optional(), open: z.enum(['true', 'false']).optional() }), req.query);
    return withTenant(req.params.accountId, (db) => listSamples(db, req.params.accountId, { week: q.week, open: q.open === 'true' }));
  });

  app.get<{ Params: Params }>(`${base}/stats`, { config: { permission: 'mapping.read' } }, async (req) =>
    withTenant(req.params.accountId, (db) => qaStats(db, req.params.accountId)));

  // Normally drawn by the hourly job; this draws this week's sample now if it has not been drawn.
  app.post<{ Params: Params }>(`${base}/draw`, { config: { permission: 'mapping.write' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => {
      const r = await drawSample(db, req.params.accountId);
      if (r.drawn) {
        await recordAudit(db, {
          accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, action: 'qa.drawn', entityType: 'qa_sample',
          summary: `QA sample for the week of ${r.week}: ${r.included} automatic includes, ${r.excluded} automatic excludes`, after: r,
        });
      }
      return r;
    }));

  app.post<{ Params: Params & { sampleId: string } }>(`${base}/:sampleId/review`, { config: { permission: 'mapping.write' } }, async (req) => {
    const id = uuidOr404(req.params.sampleId, 'sample');
    const b = parse(z.object({ verdict: z.enum(['correct', 'wrong']), note: z.string().trim().max(500).optional() }), req.body);
    return withTenant(req.params.accountId, async (db) => {
      const r = await reviewSample(db, req.params.accountId, id, b.verdict, b.note ?? null, { type: 'user', id: req.user!.sub, label: req.user!.email })
        .catch((err) => {
          if (err instanceof QaError) throw new HttpError(err.statusCode, err.message);
          throw err;
        });
      await recordAudit(db, {
        accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id, action: 'qa.reviewed', entityType: 'qa_sample', entityId: id,
        summary: `QA sample marked ${b.verdict}${r.corrected ? ` → listing ${r.corrected === 'Excluded' ? 'excluded' : 'back in review'}` : ''}${b.note ? ` (${b.note})` : ''}`,
        after: { ...b, corrected: r.corrected },
      });
      return r;
    });
  });
}
