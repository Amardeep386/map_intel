// Outgoing email (Phase 3). No provider is configured yet (6 Oct 2026), so the only driver is
// 'log': the message is written to `notification` with status 'logged' and shows in the portal.
// A real provider is one more driver here plus MAIL_PROVIDER and its key in the environment.
import type { Db } from './db.js';

export interface Mail {
  accountId: string | null;
  to: string[];
  subject: string;
  body: string; // plain text
  reportRunId?: string | null;
}

export interface MailResult { id: string; status: 'logged' | 'sent' | 'failed'; provider: string }

export async function sendMail(db: Db, m: Mail): Promise<MailResult> {
  const provider = (process.env.MAIL_PROVIDER || 'log').toLowerCase();
  if (provider !== 'log') {
    // Not built yet: record it as failed rather than pretending it was sent.
    const id = await record(db, m, 'failed', provider, `mail provider "${provider}" is not configured in this build`);
    return { id, status: 'failed', provider };
  }
  const id = await record(db, m, 'logged', 'log', null);
  return { id, status: 'logged', provider: 'log' };
}

async function record(db: Db, m: Mail, status: string, provider: string, error: string | null): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO notification (account_id, recipients, subject, body, status, provider, error, report_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [m.accountId, m.to, m.subject.slice(0, 300), m.body, status, provider, error, m.reportRunId ?? null],
  )).rows[0].id;
}
