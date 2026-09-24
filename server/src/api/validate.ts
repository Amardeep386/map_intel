import type { z } from 'zod';
import { HttpError } from './app.js';

/** Parse a body or query with zod; a failure becomes a 400 listing every problem. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route id that must be a uuid: anything else is simply "not found". */
export function uuidOr404(id: string, what: string): string {
  if (!UUID.test(id)) throw new HttpError(404, `${what} not found`);
  return id;
}

/** Postgres unique violation → 409 with a readable message. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}
