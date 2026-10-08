// IP track (Phase 4 · M5): marketplace reports for cases a person has marked as an IP issue
// (counterfeit, trademark or copyright misuse, material differences after legal review). Never a
// pricing case: the database refuses a report on a case that is not an IP issue. No marketplace
// offers an API for these reports, so an analyst files them by hand (Amazon Brand Registry "Report
// a Violation", eBay VeRO, Walmart Brand Portal) with the evidence pack, then records the reference
// number and the outcome. See docs/enforcement-channels.md.
import { caseCode, CaseError } from './cases.js';
import type { Db } from './db.js';
import { createLink, evidenceRecord } from './evidenceLinks.js';

export const IP_CHANNELS = ['amazon_rav', 'ebay_vero', 'walmart_brand_portal'] as const;
export type IpChannel = (typeof IP_CHANNELS)[number];
export const IP_BASES = ['trademark', 'copyright', 'counterfeit', 'design_patent', 'utility_patent', 'material_difference'] as const;
export type IpBasis = (typeof IP_BASES)[number];
export const REPORT_STATUSES = ['Draft', 'Filed', 'Accepted', 'Rejected', 'Withdrawn'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const CHANNEL_LABEL: Record<IpChannel, string> = {
  amazon_rav: 'Amazon Brand Registry (Report a Violation)',
  ebay_vero: 'eBay VeRO',
  walmart_brand_portal: 'Walmart Brand Portal',
};
/** The marketplace each channel reports on, by source code prefix. */
const CHANNEL_SOURCE: Record<IpChannel, string> = { amazon_rav: 'amazon_', ebay_vero: 'ebay_', walmart_brand_portal: 'walmart_' };
export const BASIS_LABEL: Record<IpBasis, string> = {
  trademark: 'Trademark', copyright: 'Copyright (images or text)', counterfeit: 'Counterfeit', design_patent: 'Design patent',
  utility_patent: 'Utility patent', material_difference: 'Material difference (after legal review)',
};
/** Evidence links in a pack stay valid this long. */
export const PACK_LINK_DAYS = 90;

export const reportCode = (seq: number) => `IP-${String(seq).padStart(5, '0')}`;

interface CaseRow { id: string; seq: number; closed: boolean; ip_issue: boolean; source_code: string }

export interface NewReport { channel: IpChannel; ipBasis: IpBasis; reason: string }

export async function createReport(db: Db, accountId: string, caseId: string, r: NewReport, actor: string | null) {
  const c = (await db.query<CaseRow>(
    `SELECT c.id, c.seq, c.closed, c.ip_issue, s.code AS source_code FROM case_current c JOIN source s ON s.id = c.source_id WHERE c.id = $1`,
    [caseId])).rows[0];
  if (!c) throw new CaseError(404, 'case not found');
  if (!c.ip_issue) throw new CaseError(409, `${caseCode(c.seq)} is a pricing case: mark it as an IP issue (with a reason) first. A price below MAP is never an IP report.`);
  if (c.closed) throw new CaseError(409, `${caseCode(c.seq)} is closed`);
  if (!c.source_code.startsWith(CHANNEL_SOURCE[r.channel])) {
    throw new CaseError(400, `${CHANNEL_LABEL[r.channel]} only covers listings on that marketplace; this case is on ${c.source_code}`);
  }
  if (!r.reason.trim()) throw new CaseError(400, 'a report needs a reason');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ip-report-seq:${accountId}`]);
  const seq = (await db.query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM marketplace_report WHERE account_id = $1', [accountId])).rows[0].n;
  const id = (await db.query<{ id: string }>(
    `INSERT INTO marketplace_report (account_id, case_id, seq, channel, ip_basis, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [accountId, caseId, seq, r.channel, r.ipBasis, r.reason.trim(), actor])).rows[0].id;
  return { id, code: reportCode(seq), caseCode: caseCode(c.seq) };
}

async function load(db: Db, reportId: string) {
  const r = (await db.query<{ id: string; seq: number; status: ReportStatus; reference: string | null }>(
    'SELECT id, seq, status, reference FROM marketplace_report WHERE id = $1', [reportId])).rows[0];
  if (!r) throw new CaseError(404, 'report not found');
  return r;
}

/** Draft → Filed: the analyst filed it on the marketplace and records the reference it returned. */
export async function fileReport(db: Db, reportId: string, reference: string, filedAt: string | null, actor: string | null) {
  const r = await load(db, reportId);
  if (r.status !== 'Draft') throw new CaseError(409, `${reportCode(r.seq)} is ${r.status}`);
  if (!reference.trim()) throw new CaseError(400, 'enter the reference number the marketplace gave you');
  await db.query("UPDATE marketplace_report SET status = 'Filed', reference = $2, filed_at = coalesce($3::timestamptz, now()), filed_by = $4 WHERE id = $1",
    [reportId, reference.trim(), filedAt, actor]);
  return { code: reportCode(r.seq), before: r.status };
}

/** Filed → Accepted / Rejected (the marketplace's answer), or Draft / Filed → Withdrawn. */
export async function closeReport(db: Db, reportId: string, to: 'Accepted' | 'Rejected' | 'Withdrawn', note: string | null) {
  const r = await load(db, reportId);
  const ok = to === 'Withdrawn' ? ['Draft', 'Filed'].includes(r.status) : r.status === 'Filed';
  if (!ok) throw new CaseError(409, `${reportCode(r.seq)} is ${r.status}: it cannot become ${to}`);
  if (to !== 'Accepted' && !note?.trim()) throw new CaseError(400, `${to} needs a note`);
  await db.query('UPDATE marketplace_report SET status = $2, outcome_note = $3 WHERE id = $1', [reportId, to, note?.trim() || null]);
  return { code: reportCode(r.seq), before: r.status };
}

const SELECT = `
  SELECT r.id, r.seq, r.case_id, 'C-' || lpad(c.seq::text, 5, '0') AS case_code, coalesce(se.name, 'Unknown seller') AS seller,
         s.display_name AS source, r.channel, r.ip_basis, r.reason, r.status, r.reference, r.filed_at, fu.email AS filed_by,
         r.outcome_note, r.created_at, cu.email AS created_by, r.updated_at
    FROM marketplace_report r JOIN enforcement_case c ON c.id = r.case_id JOIN source s ON s.id = c.source_id
    LEFT JOIN seller se ON se.id = c.seller_id LEFT JOIN app_user fu ON fu.id = r.filed_by LEFT JOIN app_user cu ON cu.id = r.created_by`;

export async function listReports(db: Db, accountId: string, f: { caseId?: string } = {}) {
  const p: unknown[] = [accountId];
  let where = 'r.account_id = $1';
  if (f.caseId) { p.push(f.caseId); where += ` AND r.case_id = $${p.length}`; }
  const rows = (await db.query(`${SELECT} WHERE ${where} ORDER BY r.created_at DESC, r.seq DESC LIMIT 500`, p)).rows;
  return rows.map((r) => ({ ...r, code: reportCode(r.seq), channel_label: CHANNEL_LABEL[r.channel as IpChannel], basis_label: BASIS_LABEL[r.ip_basis as IpBasis] }));
}

export async function reportDetail(db: Db, reportId: string) {
  const r = (await db.query(`${SELECT} WHERE r.id = $1`, [reportId])).rows[0];
  return r ? { ...r, code: reportCode(r.seq), channel_label: CHANNEL_LABEL[r.channel as IpChannel], basis_label: BASIS_LABEL[r.ip_basis as IpBasis] } : null;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace('.000Z', 'Z') : '—');

/**
 * The evidence pack an analyst attaches to the marketplace form: the claim, the seller, and per
 * listing its URL, when it was captured, the SHA-256 of each stored proof file, the record hash
 * and a secure evidence link (the evidence page has the screenshot to download).
 */
export async function evidencePack(db: Db, accountId: string, reportId: string, actor: string | null): Promise<{ code: string; text: string }> {
  const r = await reportDetail(db, reportId);
  if (!r) throw new CaseError(404, 'report not found');
  const brand = (await db.query<{ brand: string }>('SELECT brand FROM account WHERE id = $1', [accountId])).rows[0].brand;
  const vs = (await db.query<{ id: string }>(
    'SELECT cv.violation_id AS id FROM case_violation cv JOIN violation v ON v.id = cv.violation_id WHERE cv.case_id = $1 ORDER BY v.seq', [r.case_id])).rows;
  const lines = [
    `EVIDENCE PACK ${r.code} — ${brand}`,
    `Channel: ${r.channel_label}`,
    `Basis: ${r.basis_label}`,
    `Claim: ${r.reason}`,
    `Seller: ${r.seller} (${r.source})`,
    `Case: ${r.case_code}`,
    `Prepared: ${iso(new Date())}`,
    '',
    'Every page below was captured at collection time and stored write-once with its SHA-256.',
    'Open the secure link for the full record and the screenshot.',
  ];
  for (const [i, v] of vs.entries()) {
    const rec = await evidenceRecord(db, v.id);
    if (!rec) continue;
    const link = await createLink(db, { accountId, scope: 'violation:view', violationId: v.id, days: PACK_LINK_DAYS, createdBy: actor, via: 'ip_report' });
    lines.push('', `${i + 1}. ${rec.record} · ${rec.product.sku} ${rec.product.name}`,
      `   Listing: ${rec.listing.url}`,
      ...(rec.listing.title ? [`   Title as captured: ${rec.listing.title}`] : []),
      `   First seen: ${iso(rec.firstSeen)}   Last seen: ${iso(rec.lastSeen)}`,
      `   Secure record (valid until ${iso(link.expiresAt)}): ${link.url}`,
      `   Record SHA-256: ${rec.recordSha256}`);
    for (const p of rec.proofs.slice(0, 3)) {
      const hashes = Object.entries(p.sha256).filter(([, h]) => h).map(([k, h]) => `${k} ${h}`).join('; ');
      lines.push(`   Captured ${iso(p.capturedAt)} (${p.method}): ${hashes || 'no stored file'}`);
    }
  }
  lines.push('', 'Fill in the marketplace form yourself: MAP Intel does not file reports. Record the reference number in the case afterwards.');
  return { code: r.code, text: lines.join('\r\n') };
}
