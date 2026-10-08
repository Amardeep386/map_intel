// Phase 4 enforcement schema as the API's database role: tenant isolation, one seller per case,
// append-only case history, frozen letters, the IP track only on IP cases, default templates and
// the eBay deletion redaction.   npm run test:db
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb, type Db } from '../../src/lib/db.js';
import { accountIds, asTenant, createTestAccount, expectRefused, removeTestAccounts, rolledBack } from './helpers.js';

let accounts: Record<string, string> = {};

before(async () => {
  accounts = await accountIds();
});

after(async () => {
  await removeTestAccounts();
  await closeDb();
});

const one = async <T = Record<string, unknown>>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;

/** A scratch seller on `source` and an open case for it in `account`. */
async function openCase(db: Db, account: string, source = 'walmart_us'): Promise<{ caseId: string; sellerId: string; sourceId: string }> {
  const sourceId = (await one<{ id: string }>(db, 'SELECT id FROM source WHERE code = $1', [source])).id;
  const key = `zz enf ${Date.now()} ${Math.random()}`;
  const sellerId = (await one<{ id: string }>(db, 'INSERT INTO seller (source_id, platform_seller_id, name, name_key) VALUES ($1, $2, $2, $2) RETURNING id', [sourceId, key])).id;
  const seq = (await one<{ n: number }>(db, 'SELECT coalesce(max(seq), 0) + 1 AS n FROM enforcement_case WHERE account_id = $1', [account])).n;
  const caseId = (await one<{ id: string }>(db,
    'INSERT INTO enforcement_case (account_id, seq, seller_id, source_id) VALUES ($1, $2, $3, $4) RETURNING id', [account, seq, sellerId, sourceId])).id;
  await db.query("INSERT INTO case_event (account_id, case_id, state) VALUES ($1, $2, 'Open')", [account, caseId]);
  return { caseId, sellerId, sourceId };
}

async function draftNotice(db: Db, account: string, caseId: string, needsApproval: boolean): Promise<string> {
  const seq = (await one<{ n: number }>(db, 'SELECT coalesce(max(seq), 0) + 1 AS n FROM notice WHERE account_id = $1', [account])).n;
  return (await one<{ id: string }>(db,
    `INSERT INTO notice (account_id, case_id, seq, recipients, subject, body, needs_approval)
     VALUES ($1, $2, $3, '{seller@example.invalid}', 'MAP', 'Letter', $4) RETURNING id`, [account, caseId, seq, needsApproval])).id;
}

test('every account has the three default letter templates, a new account gets them too, and LG sees only its own', () =>
  rolledBack(async (db) => {
    const fresh = await createTestAccount('enforcement');
    await db.query("SELECT set_config('app.account_id', $1, true)", [fresh]);
    const codes = (await db.query<{ code: string }>('SELECT code FROM notice_template WHERE account_id = $1 ORDER BY code', [fresh])).rows.map((r) => r.code);
    assert.deepEqual(codes, ['T-1', 'T-2', 'T-3']);

    await asTenant(db, accounts.lg);
    for (const t of ['notice_template', 'enforcement_case', 'case_event', 'notice', 'communication', 'marketplace_report']) {
      const { rows } = await db.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM ${t}`);
      assert.ok(rows.every((r) => r.account_id === accounts.lg), t);
    }
    await expectRefused(db, `INSERT INTO notice_template (account_id, code, name, subject, body) VALUES ($1, 'T-9', 'x', 's', 'b')`, [accounts.apple]);
  }));

test('a case covers one seller; its history is append-only; Resolved needs a compliant observation or a reason', () =>
  rolledBack(async (db) => {
    await db.query("SELECT set_config('app.account_id', $1, true)", [accounts.lg]);
    const { caseId } = await openCase(db, accounts.lg);
    // Any existing LG violation belongs to another seller: refused.
    const v = await one<{ id: string } | undefined>(db, 'SELECT id FROM violation WHERE account_id = $1 LIMIT 1', [accounts.lg]);
    if (v) await expectRefused(db, 'INSERT INTO case_violation (case_id, violation_id, account_id) VALUES ($1, $2, $3)', [caseId, v.id, accounts.lg]);

    await expectRefused(db, "UPDATE case_event SET state = 'Escalated' WHERE case_id = $1", [caseId]);
    await expectRefused(db, 'DELETE FROM case_event WHERE case_id = $1', [caseId]);
    await expectRefused(db, 'DELETE FROM enforcement_case WHERE id = $1', [caseId]);
    await expectRefused(db, "UPDATE enforcement_case SET opened_at = '2020-01-01' WHERE id = $1", [caseId]);
    await db.query("UPDATE enforcement_case SET response_due = '2026-10-15' WHERE id = $1", [caseId]);

    await db.query("INSERT INTO case_event (account_id, case_id, state) VALUES ($1, $2, 'Notice sent')", [accounts.lg, caseId]);
    await expectRefused(db, "INSERT INTO case_event (account_id, case_id, state) VALUES ($1, $2, 'Resolved')", [accounts.lg, caseId]);
    let cur = await one<{ state: string; closed: boolean }>(db, 'SELECT state, closed FROM case_current WHERE id = $1', [caseId]);
    assert.deepEqual([cur.state, cur.closed], ['Notice sent', false]);
    await db.query("INSERT INTO case_event (account_id, case_id, state, reason) VALUES ($1, $2, 'Resolved', 'Seller removed the listing')", [accounts.lg, caseId]);
    cur = await one<{ state: string; closed: boolean }>(db, 'SELECT state, closed FROM case_current WHERE id = $1', [caseId]);
    assert.deepEqual([cur.state, cur.closed], ['Resolved', true]);
  }));

test('a notice is frozen once it leaves Draft and only moves forward; approval cannot be skipped', () =>
  rolledBack(async (db) => {
    await db.query("SELECT set_config('app.account_id', $1, true)", [accounts.lg]);
    const { caseId } = await openCase(db, accounts.lg);
    const n = await draftNotice(db, accounts.lg, caseId, true);
    await db.query("UPDATE notice SET body = 'Letter v2' WHERE id = $1", [n]); // Draft: editable
    await expectRefused(db, "UPDATE notice SET status = 'Sent' WHERE id = $1", [n]); // needs approval first
    await db.query("UPDATE notice SET status = 'Awaiting approval' WHERE id = $1", [n]);
    await expectRefused(db, "UPDATE notice SET body = 'Changed after review' WHERE id = $1", [n]);
    await expectRefused(db, "UPDATE notice SET status = 'Rejected' WHERE id = $1", [n]); // a rejection needs a note
    await db.query("UPDATE notice SET status = 'Approved', decided_at = now() WHERE id = $1", [n]);
    await db.query("UPDATE notice SET status = 'Sent', sent_at = now() WHERE id = $1", [n]);
    await expectRefused(db, "UPDATE notice SET status = 'Draft' WHERE id = $1", [n]);
    await expectRefused(db, "UPDATE notice SET status = 'Cancelled' WHERE id = $1", [n]);
    await expectRefused(db, 'DELETE FROM notice WHERE id = $1', [n]);

    const direct = await draftNotice(db, accounts.lg, caseId, false);
    await db.query("UPDATE notice SET status = 'Sent', sent_at = now() WHERE id = $1", [direct]);

    const c = await one<{ id: string }>(db,
      "INSERT INTO communication (account_id, case_id, notice_id, direction, kind, summary) VALUES ($1, $2, $3, 'outbound', 'notice', 'N-1 logged') RETURNING id",
      [accounts.lg, caseId, n]);
    await expectRefused(db, "UPDATE communication SET summary = 'x' WHERE id = $1", [c.id]);
    await expectRefused(db, 'DELETE FROM communication WHERE id = $1', [c.id]);
  }));

test('the IP track: refused on a pricing case; after marking it an IP issue with a reason, filed reports need a reference', () =>
  rolledBack(async (db) => {
    await db.query("SELECT set_config('app.account_id', $1, true)", [accounts.lg]);
    const { caseId } = await openCase(db, accounts.lg, 'ebay_us');
    const report = `INSERT INTO marketplace_report (account_id, case_id, seq, channel, ip_basis, reason) VALUES ($1, $2, 1, 'ebay_vero', 'counterfeit', 'Fake serial on box') RETURNING id`;
    await expectRefused(db, report, [accounts.lg, caseId]);
    await expectRefused(db, 'UPDATE enforcement_case SET ip_issue = true WHERE id = $1', [caseId]); // needs a reason
    await db.query("UPDATE enforcement_case SET ip_issue = true, ip_reason = 'Counterfeit units reported by LG' WHERE id = $1", [caseId]);
    const r = (await one<{ id: string }>(db, report, [accounts.lg, caseId])).id;
    await expectRefused(db, "UPDATE marketplace_report SET status = 'Filed', filed_at = now() WHERE id = $1", [r]); // no reference
    await db.query("UPDATE marketplace_report SET status = 'Filed', filed_at = now(), reference = 'VERO-123' WHERE id = $1", [r]);
    await expectRefused(db, "UPDATE marketplace_report SET ip_basis = 'trademark' WHERE id = $1", [r]);
    await expectRefused(db, 'DELETE FROM marketplace_report WHERE id = $1', [r]);
    await expectRefused(db, 'UPDATE enforcement_case SET ip_issue = false, ip_reason = NULL WHERE id = $1', [caseId]);
  }));

test('an eBay account deletion redacts that seller’s notices and communications', () =>
  rolledBack(async (db) => {
    await db.query("SELECT set_config('app.account_id', $1, true)", [accounts.lg]);
    const { caseId, sellerId } = await openCase(db, accounts.lg, 'ebay_us');
    const username = (await one<{ platform_seller_id: string }>(db, 'SELECT platform_seller_id FROM seller WHERE id = $1', [sellerId])).platform_seller_id;
    const n = await draftNotice(db, accounts.lg, caseId, true);
    await db.query("UPDATE notice SET status = 'Awaiting approval' WHERE id = $1", [n]);
    await db.query("INSERT INTO communication (account_id, case_id, direction, kind, summary, body) VALUES ($1, $2, 'inbound', 'response', 'Seller replied', 'From seller@example.invalid')", [accounts.lg, caseId]);

    await db.query('SELECT app_ebay_account_deletion($1, $2, $3, $4, now())', [`test-${Date.now()}`, username, 'not-a-key', null]);
    const notice = await one<{ recipients: string[]; body: string; status: string }>(db, 'SELECT recipients, body, status FROM notice WHERE id = $1', [n]);
    assert.deepEqual([notice.recipients, notice.body, notice.status], [[], 'Redacted (eBay account deletion)', 'Awaiting approval']);
    const comm = await one<{ summary: string; body: string | null }>(db, 'SELECT summary, body FROM communication WHERE case_id = $1', [caseId]);
    assert.deepEqual([comm.summary, comm.body], ['Redacted (eBay account deletion)', null]);
    // The redaction switch does not stay on for the rest of the transaction.
    await expectRefused(db, "UPDATE notice SET body = 'x' WHERE id = $1", [n]);
  }));
