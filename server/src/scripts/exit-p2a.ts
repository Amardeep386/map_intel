// Phase 2a exit test: an analyst cleanses a pilot brand's daily volume without an Excel pivot.
//
//   npm run exit:p2a
//
// On LG, through the API, as an invited Analyst:
//   1. the catalogue round-trips through the import dry run (export -> re-import = no changes),
//      and a MAP file is checked by dry run (nothing written: MAP stays empty until the brand's
//      file arrives)
//   2. a day of candidates (300, synthetic, generated as the collector would stage them) is
//      scored; automatic decisions must agree with the ground truth
//   3. the analyst works the review queue to zero in the Mapping Center order, excluding with a
//      reason and scope; scoped exclusions become suppressions
//   4. the next day: suppressed patterns are excluded automatically, re-seen listings keep the
//      analyst's decision, nothing already decided comes back to the queue
//   5. every decision is a training label with an audit event; the grey-market seller is
//      classified; a Brand user and another account are refused
// Earlier synthetic listings are cleared first; the day it creates is kept for browser checks
// (remove with `npm run synthetic -- --clear`). The throwaway users are removed at the end.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../api/app.js';
import { signToken } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { closeDb, withSystem } from '../lib/db.js';
import { closeQueue } from '../lib/queue.js';
import { generateCandidates, type SyntheticCandidate } from '../lib/synthetic.js';
import { clearSynthetic, stageSynthetic, syntheticProducts } from './synthetic-candidates.js';

const TEST_DOMAIN = 'exit-p2a.mirethos.invalid';
const DAY1 = 300;
const DAY2 = 100;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const checks: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function call(app: FastifyInstance, token: string | null, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as Record<string, unknown> | undefined });
}

async function invite(app: FastifyInstance, adminToken: string, accountId: string, label: string, role: string): Promise<string> {
  const email = `${label}@${TEST_DOMAIN}`;
  const res = await call(app, adminToken, 'POST', `/accounts/${accountId}/users/invite`, { email, name: `Exit test ${label}`, role });
  if (res.statusCode !== 201) throw new Error(`invite ${email}: ${res.statusCode} ${res.body}`);
  const token = new URL(res.json().inviteUrl).searchParams.get('invite');
  const accepted = await call(app, null, 'POST', '/auth/accept-invite', { token, password: `exit-test-${crypto.randomUUID()}` });
  if (accepted.statusCode !== 200) throw new Error(`accept ${email}: ${accepted.statusCode} ${accepted.body}`);
  return accepted.json().token;
}

const csvCell = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** How the listings of one generated day ended up: automatic decisions compared with the truth. */
async function outcome(accountId: string, listings: { candidate: SyntheticCandidate; listingId: string }[]) {
  const states = await withSystem(async (db) =>
    new Map(
      (
        await db.query<{ listing_id: string; state: string; decided_by: string; product_id: string | null }>(
          'SELECT listing_id, state, decided_by, product_id FROM listing_match WHERE account_id = $1 AND listing_id = ANY($2::uuid[])',
          [accountId, listings.map((l) => l.listingId)],
        )
      ).rows.map((r) => [r.listing_id, r]),
    ),
  );
  let wrong = 0;
  const examples: string[] = [];
  const count = { Included: 0, Excluded: 0, Staged: 0, suppression: 0 };
  for (const { candidate: c, listingId } of listings) {
    const m = states.get(listingId)!;
    count[m.state as 'Included' | 'Excluded' | 'Staged']++;
    if (m.decided_by === 'suppression') count.suppression++;
    if (m.decided_by === 'user' || m.state === 'Staged') continue;
    const truthInclude = c.truth.decision === 'include';
    const bad = (m.state === 'Included' && (!truthInclude || m.product_id !== (c.truth as { productId: string }).productId)) || (m.state === 'Excluded' && truthInclude);
    if (bad) {
      wrong++;
      if (examples.length < 3) examples.push(`${c.kind}: ${c.title} -> ${m.state}`);
    }
  }
  return { count, wrong, examples, states };
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  const started = Date.now();
  try {
    const admin = await withSystem(async (db) => {
      const { rows } = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM app_user WHERE lower(email) = lower($1) AND platform_role = 'admin'`,
        [config.SEED_ADMIN_EMAIL ?? ''],
      );
      if (!rows[0]) throw new Error('the seed admin (SEED_ADMIN_EMAIL) was not found; run db:seed first');
      return rows[0];
    });
    const adminToken = await signToken({ sub: admin.id, email: admin.email, role: 'admin' });
    const accounts = (await call(app, adminToken, 'GET', '/accounts')).json() as Json[];
    const lg = accounts.find((a) => a.slug === 'lg')!;
    const apple = accounts.find((a) => a.slug === 'apple')!;
    const base = `/accounts/${lg.id}`;
    const analyst = await invite(app, adminToken, lg.id, 'analyst', 'Analyst');
    const brand = await invite(app, adminToken, lg.id, 'brand', 'Brand user');
    check('Analyst and Brand user invited to LG and signed in through the invite links', true);

    // ---- 1. catalogue and MAP through the import dry run ----
    const products = (await call(app, analyst, 'GET', `${base}/products`)).json() as Json[];
    const header = ['SKU', 'Product Name', 'Model', 'Category', 'Product group', 'MSRP', 'UPC', 'EAN', 'ASIN', ...[1, 2, 3, 4, 5, 6].map((i) => `Alt SKU ${i}`)];
    const rows = products.map((p) => [p.code, p.name, p.model, p.category, p.group, p.msrp, p.upc, p.ean, p.asin, ...p.alts].map(csvCell).join(','));
    const roundTrip = (await call(app, analyst, 'POST', `${base}/imports/products`, { fileName: 'lg-catalogue-export.csv', content: b64([header.join(','), ...rows].join('\n')), dryRun: true })).json();
    check('catalogue export re-imported by dry run: every SKU unchanged, nothing written',
      roundTrip.summary.unchanged === products.length && roundTrip.summary.new === 0 && roundTrip.summary.changed === 0 && roundTrip.summary.errors === 0,
      `${products.length} SKUs, ${JSON.stringify(roundTrip.summary)}`);
    const mapFile = ['SKU,MAP,Start', ...products.slice(0, 5).map((p) => `${p.code},999.00,2026-10-01`), 'NOT-A-SKU,10,2026-10-01'].join('\n');
    const mapDry = (await call(app, analyst, 'POST', `${base}/imports/map`, { fileName: 'lg-map-sample.csv', content: b64(mapFile), dryRun: true })).json();
    const mapAfter = (await call(app, analyst, 'GET', `${base}/map-prices`)).json() as Json[];
    check('MAP file checked by dry run (new versions and unknown SKUs reported, nothing written)',
      mapDry.summary.newVersions === 5 && mapDry.summary.unknownSkus === 1 && mapAfter.filter((m) => products.some((p) => p.code === m.code)).length === 0,
      JSON.stringify(mapDry.summary));

    // ---- 2. a day of candidates ----
    const removed = await clearSynthetic();
    const refs = await withSystem((db) => syntheticProducts(db, lg.id));
    const daySeed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    const day1 = generateCandidates(refs, DAY1, daySeed);
    const t1 = Date.now();
    const staged1 = await stageSynthetic(lg.id, day1);
    const o1 = await outcome(lg.id, staged1.listings);
    check(`day 1: ${DAY1} candidates collected and scored`, staged1.listings.length === DAY1,
      `${o1.count.Included} auto-included, ${o1.count.Excluded} auto-excluded, ${o1.count.Staged} to review (${Math.round((Date.now() - t1) / 1000)} s; ${removed} old synthetic listings cleared)`);
    check('automatic decisions agree with the ground truth', o1.wrong === 0, o1.wrong ? o1.examples.join(' | ') : `${o1.count.Included + o1.count.Excluded} automatic decisions, 0 wrong`);

    // ---- 3. the analyst works the queue ----
    const truthByListing = new Map(staged1.listings.map((l) => [l.listingId, l.candidate]));
    const t3 = Date.now();
    let decisions = 0;
    let suppressionsMade = 0;
    let alsoExcluded = 0;
    let orderOk = true;
    for (let guard = 0; guard < 400; guard++) {
      const q = (await call(app, analyst, 'GET', `${base}/mapping/queue?limit=50`)).json();
      if (!q.total) break;
      for (let i = 1; i < q.items.length; i++) if (q.items[i].priority > q.items[i - 1].priority) orderOk = false;
      let restart = false;
      for (const item of q.items) {
        const c = truthByListing.get(item.id);
        if (!c) throw new Error(`a non-synthetic listing is in the queue: ${item.url}`);
        let body: Json;
        if (c.truth.decision === 'include') body = { listingIds: [item.id], action: 'include', productId: c.truth.productId };
        else body = { listingIds: [item.id], action: 'exclude', reason: c.truth.reason, scope: c.truth.scope };
        const res = await call(app, analyst, 'POST', `${base}/mapping/decisions`, body);
        if (res.statusCode !== 200) throw new Error(`decision failed: ${res.statusCode} ${res.body}`);
        decisions++;
        const sup = res.json().suppression;
        if (sup) {
          suppressionsMade++;
          alsoExcluded += sup.alsoExcluded;
          if (sup.alsoExcluded) {
            restart = true; // other listings in this page may be gone: fetch the queue again
            break;
          }
        }
      }
      if (!restart && q.items.length === q.total) {
        const left = (await call(app, analyst, 'GET', `${base}/mapping/queue?limit=1`)).json();
        if (!left.total) break;
      }
    }
    const summary = (await call(app, analyst, 'GET', `${base}/mapping/summary`)).json();
    const perMinute = decisions / Math.max((Date.now() - t3) / 60000, 0.01);
    check('the review queue is worked to zero in risk order (lowest confidence × deepest discount first)',
      summary.states.Staged === 0 && orderOk, `${decisions} decisions (${perMinute.toFixed(0)} / min through the API), queue now ${summary.states.Staged}`);
    check('scoped exclusions became suppressions that excluded matching listings',
      suppressionsMade > 0, `${suppressionsMade} suppressions, ${alsoExcluded} more listings excluded by them`);

    // ---- 4. the next day ----
    const suppressed = (await call(app, analyst, 'GET', `${base}/mapping/suppressions`)).json() as Json[];
    const endOfDay1 = (await outcome(lg.id, staged1.listings)).states;
    const day2 = generateCandidates(refs, DAY2, daySeed + 1);
    const reseen = staged1.listings.filter((l) => o1.states.get(l.listingId)?.state === 'Staged').slice(0, 20).map((l) => l.candidate);
    const staged2 = await stageSynthetic(lg.id, [...day2, ...reseen]);
    const after = await withSystem(async (db) =>
      (
        await db.query<{ listing_id: string; state: string; decided_by: string; product_id: string | null }>(
          'SELECT listing_id, state, decided_by, product_id FROM listing_match WHERE account_id = $1 AND listing_id = ANY($2::uuid[])',
          [lg.id, staged2.listings.map((l) => l.listingId)],
        )
      ).rows,
    );
    const byId = new Map(after.map((r) => [r.listing_id, r]));
    const grey = staged2.listings.filter((l) => l.candidate.kind === 'grey-market' && day2.includes(l.candidate));
    // Grey-market relistings of a product the analyst already suppressed for that seller.
    const suppressedCodes = new Set(suppressed.filter((s) => s.scope === 'seller_product' && !s.revoked_at).map((s) => s.product_code));
    const greyCovered = grey.filter((l) => suppressedCodes.has(refs.find((r) => r.id === byId.get(l.listingId)?.product_id)?.code));
    const reseenIds = staged2.listings.filter((l) => reseen.includes(l.candidate)).map((l) => l.listingId);
    const o2 = await outcome(lg.id, staged2.listings.filter((l) => day2.includes(l.candidate)));
    check('day 2: suppressed patterns are excluded automatically, not queued again',
      greyCovered.length > 0 && greyCovered.every((l) => byId.get(l.listingId)?.decided_by === 'suppression'),
      `${o2.count.suppression} of ${DAY2} excluded by suppressions; grey-market ${grey.length} (${greyCovered.length} covered by a suppression, all caught)`);
    const unchanged = reseenIds.filter((id) => byId.get(id)?.state === endOfDay1.get(id)?.state && byId.get(id)?.decided_by === endOfDay1.get(id)?.decided_by);
    check('re-seen listings keep the analyst\'s decision (or the suppression that excluded them)', unchanged.length === reseenIds.length,
      `${unchanged.length} of ${reseenIds.length} re-seen listings unchanged, none back in the queue`);
    check('day 2 automatic decisions agree with the ground truth', o2.wrong === 0, o2.wrong ? o2.examples.join(' | ') : `${o2.count.Staged} new to review`);

    // ---- 5. labels, audit, sellers, roles ----
    const labels = await withSystem(async (db) =>
      (await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM listing_state_event e JOIN app_user u ON u.id::text = e.actor_id
          WHERE e.account_id = $1 AND e.is_label AND u.email = $2`, [lg.id, `analyst@${TEST_DOMAIN}`])).rows[0].n,
    );
    // The audit log pages 200 events at a time.
    let byAnalyst = 0;
    for (let before: string | null = null, page = 0; page < 20; page++) {
      const res: Json = (await call(app, adminToken, 'GET', `${base}/audit?limit=200&entity=listing${before ? `&before=${encodeURIComponent(before)}` : ''}`)).json();
      // Only this run: an earlier run's analyst had the same address.
      byAnalyst += res.events.filter((e: Json) => e.actor === `analyst@${TEST_DOMAIN}` && String(e.action).startsWith('mapping.') && new Date(e.occurredAt).getTime() >= started).length;
      before = res.next;
      if (!before) break;
    }
    check('every decision is a training label with an audit event', labels === decisions && byAnalyst === decisions,
      `${labels} labels, ${byAnalyst} audit events for ${decisions} decisions`);

    const sellers = (await call(app, analyst, 'GET', `${base}/sellers`)).json() as Json[];
    const greySeller = sellers.find((s) => s.name === 'Global Parallel Imports');
    const cls = greySeller && (await call(app, analyst, 'POST', `${base}/sellers/${greySeller.id}/classification`, { class: 'Unauthorised', note: 'Exit test: sells international versions' }));
    const greyAfter = greySeller && (await call(app, analyst, 'GET', `${base}/sellers/${greySeller.id}`)).json();
    check('the grey-market seller is classified Unauthorised with its history kept',
      // 409 = already Unauthorised from an earlier run (sellers are shared and outlive a run).
      !!greySeller && (cls!.statusCode === 201 || (cls!.statusCode === 409 && greySeller.classification === 'Unauthorised')) && greyAfter.classification === 'Unauthorised' && greyAfter.history.length >= 2,
      greySeller ? `${greySeller.listings} listings, history ${greyAfter.history.map((h: Json) => h.class).join(' ← ')}` : 'seller not found');

    const included = ((await call(app, analyst, 'GET', `${base}/products`)).json() as Json[]).reduce((a, p) => a + p.listings, 0);
    check('Product Summary counts the included listings per SKU', included >= o1.count.Included, `${included} included listings across ${products.length} SKUs`);

    const denied = [
      await call(app, brand, 'GET', `${base}/mapping/queue`),
      await call(app, brand, 'POST', `${base}/mapping/decisions`, { listingIds: [staged1.listings[0].listingId], action: 'restore' }),
      await call(app, brand, 'GET', `${base}/sellers`),
      await call(app, analyst, 'GET', `/accounts/${apple.id}/mapping/queue`),
    ].map((r) => r.statusCode);
    check('a Brand user cannot use the Mapping Center or Sellers; LG\'s analyst cannot see Apple', denied.every((s) => s === 403), denied.join(','));
  } finally {
    await cleanup(app);
    await app.close();
    await closeQueue();
    await closeDb();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed in ${Math.round((Date.now() - started) / 1000)} s${failed.length ? ` — ${failed.length} FAILED` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}

/** Remove the throwaway users through the API (audited), then delete them. */
async function cleanup(app: FastifyInstance): Promise<void> {
  const users = await withSystem(async (db) =>
    (await db.query<{ user_id: string; account_id: string }>(
      `SELECT m.user_id, m.account_id FROM account_membership m JOIN app_user u ON u.id = m.user_id WHERE u.email LIKE $1`,
      [`%@${TEST_DOMAIN}`],
    )).rows,
  );
  const admin = await withSystem(
    async (db) => (await db.query<{ id: string; email: string }>(`SELECT id, email FROM app_user WHERE lower(email) = lower($1)`, [config.SEED_ADMIN_EMAIL ?? ''])).rows[0],
  );
  if (admin) {
    const token = await signToken({ sub: admin.id, email: admin.email, role: 'admin' });
    for (const u of users) await call(app, token, 'DELETE', `/accounts/${u.account_id}/users/${u.user_id}`);
  }
  await withSystem((db) => db.query('DELETE FROM app_user WHERE email LIKE $1', [`%@${TEST_DOMAIN}`]));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
