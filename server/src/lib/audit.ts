// Audit log writer. Call it with the same transaction (db) as the change it records, so the
// change and its audit row commit or roll back together.
import type { FastifyRequest } from 'fastify';
import type { Db } from './db.js';

export interface AuditActor {
  type: 'user' | 'rule' | 'system' | 'model';
  id?: string | null;
  label: string;
}

export interface AuditEntry {
  accountId: string | null;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { type: 'system', id: null, label: 'System' };

/** The signed-in user behind a request. */
export function actorFrom(req: FastifyRequest): AuditActor {
  return req.user ? { type: 'user', id: req.user.sub, label: req.user.email } : SYSTEM_ACTOR;
}

const SECRET_KEY = /pass(word)?|secret|token|cipher|private|credential|api_?key|auth_?tag|^iv$/i;

/** Copy of `value` with secret-looking fields replaced, so no secret ever lands in the audit log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

export async function recordAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_event (account_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, summary, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.accountId,
      e.actor.type,
      e.actor.id ?? null,
      e.actor.label,
      e.action,
      e.entityType,
      e.entityId ?? null,
      e.summary ?? null,
      e.before === undefined ? null : JSON.stringify(redact(e.before)),
      e.after === undefined ? null : JSON.stringify(redact(e.after)),
      e.requestId ?? null,
    ],
  );
}
