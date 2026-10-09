// Platform screens for Mirethos administrators (Phase 5): the org-wide crawl budget across every
// account (M3) and internal tickets (M4). Changes are audited with no account: they are
// organisation settings and Mirethos's own work, never shown to the brands.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { randomUUID } from 'node:crypto';
import { forecastAccount, loadCaps, loadUsage, utcDay } from '../../lib/crawlBudget.js';
import { runReplay, startReplay } from '../../lib/replay.js';
import { RuleError } from '../../lib/ruleAdmin.js';
import { withApi, withTenant } from '../../lib/db.js';
import { createTicket, KINDS, listTickets, PRIORITIES, STATUSES, TicketError, ticketDetail, updateTicket } from '../../lib/tickets.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

const DAY_MS = 86_400_000;

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string | undefined> }>('/platform/crawl-budget', { config: { permission: 'platform' } }, async (req) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(60).default(14) }), req.query);
    const now = new Date();
    const today = utcDay(now);
    const days = Array.from({ length: q.days }, (_, i) => utcDay(new Date(now.getTime() - (q.days - 1 - i) * DAY_MS)));
    const weekAgo = utcDay(new Date(now.getTime() - 6 * DAY_MS));

    const { sources, accounts, caps, usage } = await withApi(async (db) => ({
      sources: (await db.query<{ id: string; code: string; display_name: string; collector_status: string }>(
        'SELECT id, code, display_name, collector_status FROM source WHERE active ORDER BY display_name',
      )).rows,
      accounts: (await db.query<{ id: string; name: string; status: string }>('SELECT id, name, status FROM app_accounts_for_user($1, true)', [req.user!.sub])).rows,
      caps: await loadCaps(db),
      usage: await loadUsage(db, days[0], today),
    }));

    // Each account's forecast is read as that tenant (its schedules, terms and listings).
    const forecasts = new Map<string, Record<string, number>>();
    for (const a of accounts) {
      if (a.status === 'Closed') continue;
      try {
        forecasts.set(a.id, await withTenant(a.id, (db) => forecastAccount(db, a.id, now)));
      } catch (err) {
        req.log.warn({ err, accountId: a.id }, 'crawl budget forecast failed');
      }
    }
    // An account in Onboarding is not crawled on schedule yet: its forecast is shown, not counted.
    const counted = (accountId: string) => accounts.find((a) => a.id === accountId)?.status !== 'Onboarding';

    const sum = (rows: { requests: number }[]) => rows.reduce((n, r) => n + r.requests, 0);
    const forecastFor = (pred: (accountId: string, sourceId: string) => boolean) => {
      let n = 0;
      for (const [accountId, bySource] of forecasts) {
        if (!counted(accountId)) continue;
        for (const [sourceId, r] of Object.entries(bySource)) if (pred(accountId, sourceId)) n += r;
      }
      return n;
    };
    const capOf = (sourceId: string | null) => caps.find((c) => c.sourceId === sourceId) ?? null;
    const orgCap = capOf(null);
    const orgForecast = forecastFor(() => true);

    return {
      today,
      days,
      org: {
        cap: orgCap?.dailyRequests ?? null,
        note: orgCap?.note ?? null,
        usedToday: sum(usage.filter((u) => u.day === today)),
        forecast: orgForecast,
        overCap: orgCap ? orgForecast > orgCap.dailyRequests : false,
        history: days.map((d) => sum(usage.filter((u) => u.day === d))),
      },
      sources: sources.map((s) => {
        const cap = capOf(s.id);
        const forecast = forecastFor((_, sourceId) => sourceId === s.id);
        const mine = usage.filter((u) => u.sourceId === s.id);
        return {
          id: s.id,
          code: s.code,
          name: s.display_name,
          collectorStatus: s.collector_status,
          cap: cap?.dailyRequests ?? null,
          note: cap?.note ?? null,
          usedToday: sum(mine.filter((u) => u.day === today)),
          forecast,
          overCap: cap ? forecast > cap.dailyRequests : false,
          orgBudgetSkipsToday: mine.filter((u) => u.day === today).reduce((n, u) => n + u.orgBudgetSkips, 0),
          history: days.map((d) => sum(mine.filter((u) => u.day === d))),
        };
      }),
      accounts: accounts.map((a) => {
        const mine = usage.filter((u) => u.accountId === a.id);
        const f = forecasts.get(a.id) ?? {};
        return {
          id: a.id,
          name: a.name,
          status: a.status,
          counted: counted(a.id),
          usedToday: sum(mine.filter((u) => u.day === today)),
          last7Days: sum(mine.filter((u) => u.day >= weekAgo)),
          forecast: Object.values(f).reduce((n, r) => n + r, 0),
          forecastBySource: f,
          budgetSkips7Days: mine.filter((u) => u.day >= weekAgo).reduce((n, u) => n + u.budgetSkips, 0),
          orgBudgetSkips7Days: mine.filter((u) => u.day >= weekAgo).reduce((n, u) => n + u.orgBudgetSkips, 0),
        };
      }),
    };
  });

  // Set or remove a daily cap: one source (sourceId) or the whole organisation (sourceId null).
  app.put('/platform/crawl-budget', { config: { permission: 'platform' } }, async (req) => {
    const b = parse(
      z.object({
        sourceId: z.string().uuid().nullable(),
        dailyRequests: z.number().int().min(1).max(10_000_000).nullable(),
        note: z.string().trim().max(300).optional(),
      }),
      req.body,
    );
    return withApi(async (db) => {
      let label = 'the organisation';
      if (b.sourceId) {
        const s = (await db.query<{ display_name: string }>('SELECT display_name FROM source WHERE id = $1', [b.sourceId])).rows[0];
        if (!s) throw new HttpError(404, 'source not found');
        label = s.display_name;
      }
      const before = (await db.query('SELECT daily_requests, note FROM crawl_budget WHERE source_id IS NOT DISTINCT FROM $1', [b.sourceId])).rows[0] ?? null;
      if (b.dailyRequests === null) {
        await db.query('DELETE FROM crawl_budget WHERE source_id IS NOT DISTINCT FROM $1', [b.sourceId]);
      } else {
        await db.query(
          `INSERT INTO crawl_budget (source_id, daily_requests, note, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id) DO UPDATE SET daily_requests = EXCLUDED.daily_requests, note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [b.sourceId, b.dailyRequests, b.note ?? null, req.user!.sub],
        );
      }
      await recordAudit(db, {
        accountId: null,
        actor: actorFrom(req),
        requestId: req.id,
        action: b.dailyRequests === null ? 'crawl_budget.removed' : 'crawl_budget.set',
        entityType: 'crawl_budget',
        entityId: null,
        summary: b.dailyRequests === null
          ? `Removed the daily request cap for ${label}`
          : `Daily request cap for ${label}: ${b.dailyRequests.toLocaleString('en-US')}`,
        before,
        after: b.dailyRequests === null ? null : { daily_requests: b.dailyRequests, note: b.note ?? null },
      });
      return loadCaps(db);
    });
  });

  // ---------------------------------------------------------------- internal tickets
  const fail = (err: unknown): never => {
    if (err instanceof TicketError) throw new HttpError(err.statusCode, err.message);
    throw err;
  };

  app.get<{ Querystring: Record<string, string | undefined> }>('/platform/tickets', { config: { permission: 'platform' } }, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['active', ...STATUSES]).optional(),
        kind: z.enum(KINDS).optional(),
        accountId: z.string().uuid().optional(),
        assignee: z.enum(['me', 'none']).optional(),
      }),
      req.query,
    );
    return withApi((db) => listTickets(db, q, req.user!.sub));
  });

  // Who tickets can be assigned to: Mirethos platform administrators.
  app.get('/platform/assignees', { config: { permission: 'platform' } }, async () =>
    withApi(async (db) => (await db.query("SELECT id, full_name AS name, email FROM app_user WHERE platform_role = 'admin' AND status = 'Active' ORDER BY full_name")).rows),
  );

  app.get<{ Params: { ticketId: string } }>('/platform/tickets/:ticketId', { config: { permission: 'platform' } }, async (req) => {
    const id = uuidOr404(req.params.ticketId, 'ticket');
    const t = await withApi((db) => ticketDetail(db, id));
    if (!t) throw new HttpError(404, 'ticket not found');
    return t;
  });

  app.post('/platform/tickets', { config: { permission: 'platform' } }, async (req, reply) => {
    const b = parse(
      z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        kind: z.enum(KINDS),
        priority: z.enum(PRIORITIES).optional(),
        accountId: z.string().uuid().nullable().optional(),
        sourceId: z.string().uuid().nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
      }),
      req.body,
    );
    const t = await withApi(async (db) => {
      const created = await createTicket(db, b, req.user!.sub).catch(fail);
      await recordAudit(db, {
        accountId: null, actor: actorFrom(req), requestId: req.id, action: 'ticket.opened', entityType: 'ticket', entityId: created.id,
        summary: `Opened ${created.code}: ${b.title}`, after: b,
      });
      return ticketDetail(db, created.id);
    });
    return reply.code(201).send(t);
  });

  app.patch<{ Params: { ticketId: string } }>('/platform/tickets/:ticketId', { config: { permission: 'platform' } }, async (req) => {
    const id = uuidOr404(req.params.ticketId, 'ticket');
    const b = parse(
      z.object({
        status: z.enum(STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        note: z.string().max(5000).optional(),
      }),
      req.body,
    );
    return withApi(async (db) => {
      const r = await updateTicket(db, id, b, req.user!.sub).catch(fail);
      if (r.changes.length) {
        await recordAudit(db, {
          accountId: null, actor: actorFrom(req), requestId: req.id, action: 'ticket.updated', entityType: 'ticket', entityId: id,
          summary: `${r.code}: ${r.changes.map((c) => `${c.kind} ${String(c.before ?? 'none')} → ${String(c.after ?? 'none')}`).join(', ')}`,
          before: Object.fromEntries(r.changes.map((c) => [c.kind, c.before])),
          after: Object.fromEntries(r.changes.map((c) => [c.kind, c.after])),
        });
      }
      return ticketDetail(db, id);
    });
  });

  // ---------------------------------------------------------------- replay at scale (M5)
  // Re-judge each chosen account's rule set over a range and compare with the stored verdicts.
  app.post('/platform/replays', { config: { permission: 'platform' } }, async (req, reply) => {
    const b = parse(
      z.object({ accountIds: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(200)]), from: z.coerce.date(), to: z.coerce.date() }),
      req.body,
    );
    if (!(b.to > b.from)) throw new HttpError(400, 'the range must end after it starts');
    if (b.to.getTime() - b.from.getTime() > 400 * DAY_MS) throw new HttpError(400, 'replay at most 400 days at a time');
    const accounts = (await withApi((db) => db.query<{ id: string; name: string; status: string }>('SELECT id, name, status FROM app_accounts_for_user($1, true)', [req.user!.sub]))).rows
      .filter((a) => a.status !== 'Closed' && (b.accountIds === 'all' || b.accountIds.includes(a.id)));
    if (b.accountIds !== 'all' && accounts.length !== b.accountIds.length) throw new HttpError(404, 'account not found');
    const batchId = randomUUID();
    const runs: { id: string; accountId: string; account: string; total: number }[] = [];
    for (const a of accounts) {
      const r = await withTenant(a.id, async (db) => {
        const started = await startReplay(db, a.id, { mode: 'ruleset' }, b.from, b.to, req.user!.sub, batchId).catch((err) => {
          if (err instanceof RuleError) throw new HttpError(err.statusCode, err.message);
          throw err;
        });
        await recordAudit(db, {
          accountId: a.id, actor: actorFrom(req), requestId: req.id, action: 'rules.replayed', entityType: 'replay_run', entityId: started.id,
          summary: `Rule set replay queued by Mirethos (${started.total} observations)`, after: { batchId, from: b.from, to: b.to, total: started.total },
        });
        return started;
      });
      runs.push({ id: r.id, accountId: a.id, account: a.name, total: r.total });
    }
    // One account after another, in the background; the hourly job resumes anything left.
    void (async () => {
      for (const r of runs) await runReplay(r.id, (fn) => withTenant(r.accountId, fn));
    })().catch((err) => req.log.error({ err, batchId }, 'replay batch failed'));
    return reply.code(202).send({ batchId, runs });
  });

  app.get('/platform/replays', { config: { permission: 'platform' } }, async () => {
    const rows = (await withApi((db) => db.query('SELECT * FROM app_replay_batches(20)'))).rows;
    const batches = new Map<string, { batchId: string; from: Date; to: Date; createdAt: Date; runs: unknown[] }>();
    for (const r of rows) {
      const b = batches.get(r.batch_id) ?? { batchId: r.batch_id, from: r.range_from, to: r.range_to, createdAt: r.created_at, runs: [] as unknown[] };
      b.runs.push({ id: r.run_id, accountId: r.account_id, account: r.account, status: r.status, total: r.total, processed: r.processed, summary: r.summary, error: r.error, finishedAt: r.finished_at });
      batches.set(r.batch_id, b);
    }
    return [...batches.values()];
  });
}
