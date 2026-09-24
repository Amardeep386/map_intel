// Named, reusable schedules. Phase 1 stores and resolves them; the Phase 2b scheduler runs them.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SOURCE_CATEGORIES } from '../../collector/catalogue.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { nextRun, resolveSchedule, type ScheduleDef } from '../../lib/schedules.js';
import { HttpError } from '../app.js';
import { isUniqueViolation, parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };

const selector = z
  .object({
    sources: z.array(z.string().max(64)).max(100),
    categories: z.array(z.enum(SOURCE_CATEGORIES as [string, ...string[]])).max(3),
    families: z.array(z.string().max(64)).max(100),
    termGroups: z.array(z.string().uuid()).max(200),
    terms: z.array(z.string().uuid()).max(1000),
  })
  .partial()
  .default({});

const fields = {
  name: z.string().trim().min(1).max(120),
  selector,
  listingScope: z.enum(['Included only', 'Included and Staged', 'All']),
  listingStatus: z.enum(['Active only', 'Inactive only', 'All']),
  takedownStatus: z.enum(['All', 'Under notice', 'Not under notice']),
  cadence: z.string().trim().min(9).max(100),
  timezone: z.string().trim().min(1).max(64),
  priority: z.number().int().min(0).max(100),
  active: z.boolean(),
};
const scheduleBody = z.object({
  ...fields,
  listingScope: fields.listingScope.default('Included and Staged'),
  listingStatus: fields.listingStatus.default('Active only'),
  takedownStatus: fields.takedownStatus.default('All'),
  timezone: fields.timezone.default('UTC'),
  priority: fields.priority.default(10),
  active: fields.active.default(true),
});
const schedulePatch = z.object(fields).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');

const resolveQuery = z.object({
  source: z.string().max(64),
  termGroup: z.string().uuid().optional(),
  term: z.string().uuid().optional(),
});

interface ScheduleRow {
  id: string;
  name: string;
  selector: ScheduleDef['selector'];
  listing_scope: string;
  listing_status: string;
  takedown_status: string;
  cadence: string;
  timezone: string;
  priority: number;
  active: boolean;
  updated_at: Date;
}

const view = (r: ScheduleRow) => {
  const n = nextRun(r.cadence, r.timezone);
  return {
    id: r.id,
    name: r.name,
    selector: r.selector,
    listingScope: r.listing_scope,
    listingStatus: r.listing_status,
    takedownStatus: r.takedown_status,
    cadence: r.cadence,
    timezone: r.timezone,
    priority: r.priority,
    active: r.active,
    nextRun: r.active && 'next' in n ? n.next : null,
    updatedAt: r.updated_at,
  };
};

async function loadAll(db: Db): Promise<ScheduleRow[]> {
  return (await db.query<ScheduleRow>('SELECT * FROM schedule ORDER BY priority DESC, lower(name)')).rows;
}

async function loadOne(db: Db, id: string): Promise<ScheduleRow> {
  const { rows } = await db.query<ScheduleRow>('SELECT * FROM schedule WHERE id = $1', [uuidOr404(id, 'schedule')]);
  if (!rows[0]) throw new HttpError(404, 'schedule not found');
  return rows[0];
}

function checkCadence(cadence: string, timezone: string): void {
  const n = nextRun(cadence, timezone);
  if ('error' in n) throw new HttpError(400, n.error);
}

const audit = (db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<Parameters<typeof recordAudit>[1], 'accountId' | 'actor' | 'requestId'>) =>
  recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Params }>('/accounts/:accountId/schedules', { config: { permission: 'schedules.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => (await loadAll(db)).map(view)),
  );

  app.post<{ Params: Params }>('/accounts/:accountId/schedules', { config: { permission: 'schedules.write' } }, async (req, reply) => {
    const b = parse(scheduleBody, req.body);
    checkCadence(b.cadence, b.timezone);
    const created = await withTenant(req.params.accountId, async (db) => {
      try {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO schedule (account_id, name, selector, listing_scope, listing_status, takedown_status, cadence, timezone, priority, active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [req.params.accountId, b.name, JSON.stringify(b.selector), b.listingScope, b.listingStatus, b.takedownStatus, b.cadence, b.timezone, b.priority, b.active, req.user!.sub],
        );
        await audit(db, req, { action: 'schedule.created', entityType: 'schedule', entityId: rows[0].id, summary: `Created schedule "${b.name}"`, after: b });
        return view(await loadOne(db, rows[0].id));
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `a schedule named "${b.name}" already exists`);
        throw err;
      }
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: Params & { scheduleId: string } }>(
    '/accounts/:accountId/schedules/:scheduleId',
    { config: { permission: 'schedules.write' } },
    async (req) => {
      const b = parse(schedulePatch, req.body);
      return withTenant(req.params.accountId, async (db) => {
        const before = view(await loadOne(db, req.params.scheduleId));
        const next = { ...before, ...b };
        checkCadence(next.cadence, next.timezone);
        try {
          await db.query(
            `UPDATE schedule SET name = $2, selector = $3, listing_scope = $4, listing_status = $5, takedown_status = $6,
                    cadence = $7, timezone = $8, priority = $9, active = $10 WHERE id = $1`,
            [before.id, next.name, JSON.stringify(next.selector), next.listingScope, next.listingStatus, next.takedownStatus, next.cadence, next.timezone, next.priority, next.active],
          );
        } catch (err) {
          if (isUniqueViolation(err)) throw new HttpError(409, `a schedule named "${next.name}" already exists`);
          throw err;
        }
        const after = view(await loadOne(db, before.id));
        const { nextRun: _a, updatedAt: _b, ...beforeFields } = before;
        const { nextRun: _c, updatedAt: _d, ...afterFields } = after;
        await audit(db, req, { action: 'schedule.updated', entityType: 'schedule', entityId: before.id, summary: `Changed schedule "${after.name}"`, before: beforeFields, after: afterFields });
        return after;
      });
    },
  );

  app.delete<{ Params: Params & { scheduleId: string } }>(
    '/accounts/:accountId/schedules/:scheduleId',
    { config: { permission: 'schedules.write' } },
    async (req, reply) => {
      await withTenant(req.params.accountId, async (db) => {
        const before = view(await loadOne(db, req.params.scheduleId));
        await db.query('DELETE FROM schedule WHERE id = $1', [before.id]);
        await audit(db, req, { action: 'schedule.deleted', entityType: 'schedule', entityId: before.id, summary: `Deleted schedule "${before.name}"`, before });
      });
      return reply.code(204).send();
    },
  );

  // Which schedule applies to a term on a source (what the Phase 2b scheduler will use).
  app.get<{ Params: Params; Querystring: Record<string, string> }>(
    '/accounts/:accountId/schedules/resolve',
    { config: { permission: 'schedules.read' } },
    async (req) => {
      const q = parse(resolveQuery, req.query);
      return withTenant(req.params.accountId, async (db) => {
        const src = (
          await db.query<{ category: string; family: string | null }>(
            'SELECT s.category, f.code AS family FROM source s LEFT JOIN source_family f ON f.id = s.family_id WHERE s.code = $1',
            [q.source],
          )
        ).rows[0];
        if (!src) throw new HttpError(404, 'source not found');
        const rows = await loadAll(db);
        const hit = resolveSchedule(
          rows.map((r) => ({ ...r, selector: r.selector ?? {} })),
          { source: q.source, category: src.category, family: src.family, termGroup: q.termGroup ?? null, term: q.term ?? null },
        );
        return { schedule: hit ? view(hit) : null };
      });
    },
  );
}
