// API keys and data exports for an account (Phase 5 · M9).
//   Keys: Administrators and Account managers create (shown once), list and revoke them; each
//   key's recent calls are listed. Creating and revoking are audited.
//   Exports: any dataset the caller's role may read, as CSV or XLSX (up to 100,000 rows); audited.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { newKey } from '../../lib/apiKeys.js';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { DATASET_IDS, DATASETS, type DatasetId } from '../../lib/datasets.js';
import { withTenant, type Db } from '../../lib/db.js';
import { can } from '../../lib/permissions.js';
import { HttpError } from '../app.js';
import { parse, uuidOr404 } from '../validate.js';

type Params = { accountId: string };
const EXPORT_CAP = 100_000;

const audit = (db: Db, req: FastifyRequest<{ Params: Params }>, e: Omit<Parameters<typeof recordAudit>[1], 'accountId' | 'actor' | 'requestId'>) =>
  recordAudit(db, { ...e, accountId: req.params.accountId, actor: actorFrom(req), requestId: req.id });

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet: quote it as text.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  const base = '/accounts/:accountId/api-keys';

  app.get<{ Params: Params }>(base, { config: { permission: 'settings.read' } }, async (req) =>
    withTenant(req.params.accountId, async (db) => (await db.query(
      `SELECT k.id, k.name, k.prefix, k.created_at, k.expires_at, k.last_used_at, k.revoked_at, u.email AS created_by,
              (SELECT count(*)::int FROM api_request_log l WHERE l.api_key_id = k.id AND l.at > now() - interval '30 days') AS calls_30d
         FROM api_key k LEFT JOIN app_user u ON u.id = k.created_by
        ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    )).rows));

  app.post<{ Params: Params }>(base, { config: { permission: 'settings.write' } }, async (req, reply) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(80), expiresInDays: z.number().int().min(1).max(730).nullable().optional() }), req.body);
    const k = newKey();
    const row = await withTenant(req.params.accountId, async (db) => {
      const r = (await db.query<{ id: string; created_at: Date; expires_at: Date | null }>(
        `INSERT INTO api_key (account_id, name, prefix, key_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(days => $6::int) END)
         RETURNING id, created_at, expires_at`,
        [req.params.accountId, b.name, k.prefix, k.hash, req.user!.sub, b.expiresInDays ?? null],
      )).rows[0];
      await audit(db, req, {
        action: 'api_key.created', entityType: 'api_key', entityId: r.id,
        summary: `Created the read-only API key "${b.name}" (mik_${k.prefix}_…)${r.expires_at ? `, expires ${r.expires_at.toISOString().slice(0, 10)}` : ''}`,
        after: { name: b.name, prefix: k.prefix, expiresAt: r.expires_at },
      });
      return r;
    });
    // The only time the key is shown.
    return reply.code(201).send({ id: row.id, name: b.name, key: k.key, prefix: k.prefix, createdAt: row.created_at, expiresAt: row.expires_at });
  });

  app.delete<{ Params: Params & { keyId: string } }>(`${base}/:keyId`, { config: { permission: 'settings.write' } }, async (req, reply) => {
    const keyId = uuidOr404(req.params.keyId, 'API key');
    await withTenant(req.params.accountId, async (db) => {
      const k = (await db.query<{ name: string; prefix: string }>(
        'UPDATE api_key SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING name, prefix', [keyId, req.user!.sub])).rows[0];
      if (!k) throw new HttpError(404, 'API key not found or already revoked');
      await audit(db, req, { action: 'api_key.revoked', entityType: 'api_key', entityId: keyId, summary: `Revoked the API key "${k.name}" (mik_${k.prefix}_…)` });
    });
    return reply.code(204).send();
  });

  app.get<{ Params: Params & { keyId: string } }>(`${base}/:keyId/log`, { config: { permission: 'settings.read' } }, async (req) => {
    const keyId = uuidOr404(req.params.keyId, 'API key');
    return withTenant(req.params.accountId, async (db) => (await db.query(
      'SELECT at, method, path, status, rows, ip FROM api_request_log WHERE api_key_id = $1 ORDER BY at DESC LIMIT 100', [keyId])).rows);
  });

  // ---------------------------------------------------------------- exports
  app.get<{ Params: Params & { dataset: string }; Querystring: Record<string, string | undefined> }>(
    '/accounts/:accountId/exports/:dataset',
    { config: { permission: 'account.read' } },
    async (req, reply) => {
      if (!(DATASET_IDS as readonly string[]).includes(req.params.dataset)) throw new HttpError(404, 'unknown dataset');
      const ds = DATASETS[req.params.dataset as DatasetId];
      if (!can(req.accountRole, ds.needs)) throw new HttpError(403, `your role (${req.accountRole}) cannot export ${ds.title.toLowerCase()}`);
      const q = parse(z.object({
        format: z.enum(['csv', 'xlsx']).default('csv'),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        status: z.string().trim().max(40).optional(),
      }), req.query);

      const { rows, capped } = await withTenant(req.params.accountId, async (db) => {
        const all: Record<string, unknown>[] = [];
        let after: string | null = null;
        do {
          const page = await ds.page(db, { limit: 5000, after, from: q.from, to: q.to, status: q.status });
          all.push(...page.rows);
          after = page.next;
        } while (after && all.length < EXPORT_CAP);
        const cut = all.length > EXPORT_CAP || after !== null;
        await audit(db, req, {
          action: 'data.exported', entityType: 'export', entityId: null,
          summary: `Exported ${ds.title.toLowerCase()} as ${q.format.toUpperCase()} (${Math.min(all.length, EXPORT_CAP).toLocaleString('en-US')} rows${cut ? ', capped' : ''})`,
          after: { dataset: ds.id, format: q.format, from: q.from ?? null, to: q.to ?? null, status: q.status ?? null },
        });
        return { rows: all.slice(0, EXPORT_CAP), capped: cut };
      });

      const name = `${ds.id}-${new Date().toISOString().slice(0, 10)}`;
      reply.header('x-rows', String(rows.length)).header('x-capped', String(capped));
      if (q.format === 'csv') {
        const lines = [ds.columns.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => ds.columns.map((c) => csvCell(r[c.key])).join(','))];
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${name}.csv"`)
          .send(`﻿${lines.join('\r\n')}\r\n`);
      }
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Mirethos MAP Intel';
      const ws = wb.addWorksheet(ds.title);
      ws.columns = ds.columns.map((c) => ({ header: c.header, key: c.key, width: Math.min(48, Math.max(12, c.header.length + 4)) }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const r of rows) ws.addRow(Object.fromEntries(ds.columns.map((c) => [c.key, r[c.key] ?? null])));
      ds.columns.forEach((c, i) => {
        if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd hh:mm';
        if (c.type === 'number') ws.getColumn(i + 1).numFmt = '#,##0.00';
      });
      if (capped) ws.addRow([`Capped at ${EXPORT_CAP.toLocaleString('en-US')} rows: narrow the date range for the rest.`]);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${name}.xlsx"`)
        .send(buf);
    },
  );
}
