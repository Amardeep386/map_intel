// Credential vault routes. Secrets go in, metadata comes out: no response ever carries a secret.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, recordAudit } from '../../lib/audit.js';
import { withTenant, type Db } from '../../lib/db.js';
import { encrypt } from '../../lib/vault.js';
import { HttpError } from '../app.js';

const KINDS = ['source_login', 'sftp', 'slack', 'smtp', 'api_key'] as const;

const newCredential = z.object({
  kind: z.enum(KINDS),
  label: z.string().trim().min(1).max(120),
  source: z.string().trim().max(64).optional(), // source code, for source logins
  username: z.string().trim().max(200).optional(),
  secret: z.string().min(1).max(8_000),
});
const newSecret = z.object({ secret: z.string().min(1).max(8_000) });

interface CredentialRow {
  id: string;
  kind: string;
  label: string;
  source_code: string | null;
  username: string | null;
  hint: string;
  key_id: string;
  created_at: Date;
  rotated_at: Date | null;
}

const SELECT_META = `
  SELECT c.id, c.kind, c.label, s.code AS source_code, c.username, c.hint, c.key_id, c.created_at, c.rotated_at
    FROM credential c LEFT JOIN source s ON s.id = c.source_id`;

const toMeta = (r: CredentialRow) => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  source: r.source_code,
  username: r.username,
  hint: r.hint,
  keyId: r.key_id,
  createdAt: r.created_at,
  rotatedAt: r.rotated_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadMeta(db: Db, id: string): Promise<CredentialRow> {
  if (!UUID.test(id)) throw new HttpError(404, 'credential not found');
  const { rows } = await db.query<CredentialRow>(`${SELECT_META} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'credential not found');
  return rows[0];
}

const badRequest = (e: z.ZodError) => new HttpError(400, e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { accountId: string } }>(
    '/accounts/:accountId/credentials',
    { config: { permission: 'credentials.read' } },
    async (req) =>
      withTenant(req.params.accountId, async (db) => {
        const { rows } = await db.query<CredentialRow>(`${SELECT_META} ORDER BY c.kind, lower(c.label)`);
        return rows.map(toMeta);
      }),
  );

  app.post<{ Params: { accountId: string } }>(
    '/accounts/:accountId/credentials',
    { config: { permission: 'credentials.write' } },
    async (req, reply) => {
      const body = newCredential.safeParse(req.body);
      if (!body.success) throw badRequest(body.error);
      const b = body.data;
      const { accountId } = req.params;
      const meta = await withTenant(accountId, async (db) => {
        let sourceId: string | null = null;
        if (b.source) {
          sourceId = (await db.query<{ id: string }>('SELECT id FROM source WHERE code = $1', [b.source])).rows[0]?.id ?? null;
          if (!sourceId) throw new HttpError(400, `unknown source ${b.source}`);
        }
        const sealed = encrypt(b.secret, { accountId, kind: b.kind });
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO credential (account_id, kind, label, source_id, username, ciphertext, iv, auth_tag, key_id, hint, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, b.kind, b.label, sourceId, b.username ?? null, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyId, sealed.hint, req.user!.sub],
        );
        if (!rows[0]) throw new HttpError(409, `a credential named "${b.label}" already exists`);
        const created = await loadMeta(db, rows[0].id);
        await recordAudit(db, {
          accountId,
          actor: actorFrom(req),
          action: 'credential.created',
          entityType: 'credential',
          entityId: created.id,
          summary: `Stored ${b.kind} credential "${b.label}" (secret not logged)`,
          after: { kind: b.kind, label: b.label, source: b.source ?? null, username: b.username ?? null },
          requestId: req.id,
        });
        return toMeta(created);
      });
      return reply.code(201).send(meta);
    },
  );

  // Replace the secret (rotation). The old ciphertext is overwritten; the audit log records who and when.
  app.put<{ Params: { accountId: string; credentialId: string } }>(
    '/accounts/:accountId/credentials/:credentialId/secret',
    { config: { permission: 'credentials.write' } },
    async (req) => {
      const body = newSecret.safeParse(req.body);
      if (!body.success) throw badRequest(body.error);
      const { accountId, credentialId } = req.params;
      return withTenant(accountId, async (db) => {
        const before = await loadMeta(db, credentialId);
        const sealed = encrypt(body.data.secret, { accountId, kind: before.kind });
        await db.query(
          `UPDATE credential SET ciphertext = $2, iv = $3, auth_tag = $4, key_id = $5, hint = $6, rotated_by = $7, rotated_at = now()
            WHERE id = $1`,
          [credentialId, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyId, sealed.hint, req.user!.sub],
        );
        await recordAudit(db, {
          accountId,
          actor: actorFrom(req),
          action: 'credential.rotated',
          entityType: 'credential',
          entityId: credentialId,
          summary: `Replaced the secret of "${before.label}" (secret not logged)`,
          before: { keyId: before.key_id, rotatedAt: before.rotated_at },
          after: { keyId: sealed.keyId },
          requestId: req.id,
        });
        return toMeta(await loadMeta(db, credentialId));
      });
    },
  );

  app.delete<{ Params: { accountId: string; credentialId: string } }>(
    '/accounts/:accountId/credentials/:credentialId',
    { config: { permission: 'credentials.write' } },
    async (req, reply) => {
      const { accountId, credentialId } = req.params;
      await withTenant(accountId, async (db) => {
        const before = await loadMeta(db, credentialId);
        await db.query('DELETE FROM credential WHERE id = $1', [credentialId]);
        await recordAudit(db, {
          accountId,
          actor: actorFrom(req),
          action: 'credential.deleted',
          entityType: 'credential',
          entityId: credentialId,
          summary: `Deleted credential "${before.label}"`,
          before: { kind: before.kind, label: before.label, source: before.source_code, username: before.username },
          requestId: req.id,
        });
      });
      return reply.code(204).send();
    },
  );
}
