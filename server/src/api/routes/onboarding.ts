// Guided onboarding (Phase 5 · M1): platform administrators create a new account in Onboarding;
// the account's people work through the steps (each step's done-ness is read from the real
// configuration, lib/onboarding.ts) and go live. Audited.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withApi, withTenant, type Db } from '../../lib/db.js';
import { forecastAccount } from '../../lib/crawlBudget.js';
import { goLive, onboardingState, OnboardingError, setCurrentStep, STEPS, type Estimates } from '../../lib/onboarding.js';
import { accountEstimate } from '../configData.js';
import { HttpError } from '../app.js';
import { parse } from '../validate.js';

type Params = { accountId: string };

const colour = z.string().regex(/^#[0-9a-f]{6}$/i, 'a #rrggbb colour');
const createBody = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lower-case letters, digits and dashes')
    .optional(),
  regions: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(20).default(['US']),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  timezone: z.string().max(64).default('America/New_York'),
  accentLight: colour.optional(),
  accentDark: colour.optional(),
  contractFrom: z.string().date().optional(),
  contractTo: z.string().date().optional(),
});

export function slugFor(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'account'
  );
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The request estimate against the budget, and what the schedules would collect a day. */
async function estimates(db: Db, accountId: string): Promise<Estimates> {
  let overBudget: boolean | null = null;
  let plannedPerDay: number | null = null;
  try {
    overBudget = (await accountEstimate(db, accountId)).estimate.overBudget;
  } catch {
    /* not known */
  }
  try {
    plannedPerDay = Object.values(await forecastAccount(db, accountId)).reduce((a, b) => a + b, 0);
  } catch {
    /* not known */
  }
  return { overBudget, plannedPerDay };
}

function fail(err: unknown): never {
  if (err instanceof OnboardingError) throw new HttpError(err.statusCode, err.message);
  throw err;
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/accounts', { config: { permission: 'platform' } }, async (req, reply) => {
    const b = parse(createBody, req.body);
    if (!validTimezone(b.timezone)) throw new HttpError(400, 'timezone: unknown time zone');
    if (b.contractFrom && b.contractTo && b.contractTo < b.contractFrom) throw new HttpError(400, 'the contract end must be after its start');
    const slug = b.slug ?? slugFor(b.name);
    const id = await withApi(async (db) => {
      if ((await db.query('SELECT 1 FROM account WHERE slug = $1', [slug])).rowCount) throw new HttpError(409, `an account with the slug "${slug}" already exists`);
      const { rows } = await db.query<{ id: string }>('SELECT app_create_account($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS id', [
        req.user!.sub,
        slug,
        b.name,
        b.brand,
        b.regions,
        b.currency,
        b.timezone,
        b.accentLight ?? null,
        b.accentDark ?? null,
        b.contractFrom ?? null,
        b.contractTo ?? null,
      ]);
      return rows[0].id;
    });
    const state = await withTenant(id, async (db) => {
      await recordAudit(db, {
        accountId: id,
        actor: actorFrom(req),
        requestId: req.id,
        action: 'account.created',
        entityType: 'account',
        entityId: id,
        summary: `Created the account ${b.name} (${b.brand}) for guided onboarding`,
        after: { slug, ...b },
      });
      return onboardingState(db, id, await estimates(db, id));
    });
    return reply.code(201).send({ id, slug, ...state });
  });

  app.get<{ Params: Params }>('/accounts/:accountId/onboarding', { config: { permission: 'settings.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => onboardingState(db, req.params.accountId, await estimates(db, req.params.accountId))),
  );

  // Where the person is in the flow, so "Save & exit" comes back to the same step.
  app.patch<{ Params: Params }>('/accounts/:accountId/onboarding', { config: { permission: 'settings.write' } }, async (req) => {
    const b = parse(z.object({ currentStep: z.enum(STEPS) }), req.body);
    const { accountId } = req.params;
    return withTenant(accountId, async (db) => {
      await setCurrentStep(db, accountId, b.currentStep).catch(fail);
      return onboardingState(db, accountId, await estimates(db, accountId));
    });
  });

  app.post<{ Params: Params }>('/accounts/:accountId/onboarding/go-live', { config: { permission: 'settings.write' } }, async (req) => {
    const { accountId } = req.params;
    return withTenant(accountId, async (db) => {
      const state = await goLive(db, accountId, req.user!.sub, await estimates(db, accountId)).catch(fail);
      await recordAudit(db, {
        accountId,
        actor: actorFrom(req),
        requestId: req.id,
        action: 'account.went_live',
        entityType: 'account',
        entityId: accountId,
        summary: 'Onboarding finished: the account is live and a baseline crawl is scheduled',
        before: { status: 'Onboarding' },
        after: { status: state.status, steps: state.steps.map((s) => ({ step: s.key, advice: s.checks.filter((c) => !c.required && !c.ok).map((c) => c.key) })) },
      });
      return state;
    });
  });
}
