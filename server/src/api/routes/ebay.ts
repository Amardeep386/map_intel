// eBay Marketplace Account Deletion endpoint (decision 39). Public: eBay calls it, not a user; a POST
// is only acted on when eBay's signature over the exact body checks out.
import type { FastifyInstance } from 'fastify';
import { config } from '../../lib/config.js';
import { withApi } from '../../lib/db.js';
import { challengeResponse, ebayPublicKey, parseDeletionNotice, parseSignatureHeader, signatureValid } from '../../lib/ebayNotifications.js';
import { normaliseSellerName } from '../../lib/sellers.js';

export async function ebayRoutes(app: FastifyInstance): Promise<void> {
  // The signature covers the body as sent, so this route keeps it as a string.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get<{ Querystring: { challenge_code?: string } }>('/ebay/account-deletion', { config: { permission: 'public' } }, async (req, reply) => {
    const code = req.query.challenge_code;
    if (!config.EBAY_VERIFICATION_TOKEN || !config.EBAY_DELETION_ENDPOINT) return reply.code(503).send({ error: 'not configured' });
    if (!code) return reply.code(400).send({ error: 'challenge_code is required' });
    return reply
      .header('content-type', 'application/json')
      .send({ challengeResponse: challengeResponse(code, config.EBAY_VERIFICATION_TOKEN, config.EBAY_DELETION_ENDPOINT) });
  });

  app.post('/ebay/account-deletion', { config: { permission: 'public' } }, async (req, reply) => {
    if (!config.EBAY_VERIFICATION_TOKEN || !config.EBAY_DELETION_ENDPOINT) return reply.code(503).send({ error: 'not configured' });
    const raw = typeof req.body === 'string' ? req.body : '';
    const sig = parseSignatureHeader(req.headers['x-ebay-signature'] as string | undefined);
    if (!sig) return reply.code(412).send({ error: 'missing or unreadable X-EBAY-SIGNATURE' });
    let key: { key: string; digest: string };
    try {
      key = await ebayPublicKey(sig.kid);
    } catch (err) {
      req.log.error({ err }, 'eBay public key');
      return reply.code(500).send({ error: 'could not fetch the eBay public key; eBay will retry' });
    }
    if (!signatureValid(raw, sig, key.key, key.digest)) return reply.code(412).send({ error: 'signature does not verify' });

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply.code(400).send({ error: 'body is not JSON' });
    }
    const notice = parseDeletionNotice(body);
    // A verified notification on another topic: acknowledge it, nothing to do.
    if (!notice) return reply.code(204).send();
    const anonymised = await withApi(async (db) => {
      const { rows } = await db.query<{ n: number }>('SELECT app_ebay_account_deletion($1, $2, $3, $4, $5) AS n', [
        notice.notificationId,
        notice.username,
        normaliseSellerName(notice.username),
        notice.userId,
        notice.eventDate,
      ]);
      return rows[0]?.n ?? 0;
    });
    req.log.info({ notificationId: notice.notificationId, anonymised }, 'eBay account deletion processed');
    return reply.code(204).send();
  });
}
