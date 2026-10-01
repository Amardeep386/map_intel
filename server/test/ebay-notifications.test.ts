import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import { ebayRoutes } from '../src/api/routes/ebay.js';
import { config } from '../src/lib/config.js';
import { challengeResponse, parseDeletionNotice, parseSignatureHeader, signatureValid, toPem } from '../src/lib/ebayNotifications.js';

const TOKEN = 'mapintel_ebay_verification_token_0123456789';
const ENDPOINT = 'https://map-intel-api.onrender.com/ebay/account-deletion';

test('challenge response is sha256(challengeCode + token + endpoint), hex', () => {
  const want = createHash('sha256').update(`abc123${TOKEN}${ENDPOINT}`).digest('hex');
  assert.equal(challengeResponse('abc123', TOKEN, ENDPOINT), want);
});

test('signature: ECDSA over the exact body, key sent as one-line PEM; a changed body fails', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const oneLine = (publicKey.export({ type: 'spki', format: 'pem' }) as string).replace(/\n/g, '');
  assert.match(toPem(oneLine), /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n$/);
  const body = JSON.stringify({ metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: 'n1', data: { username: 'tvdeals' } } });
  const signature = sign('sha1', Buffer.from(body), privateKey).toString('base64');
  const header = Buffer.from(JSON.stringify({ alg: 'ecdsa', kid: 'k1', signature, digest: 'SHA1' })).toString('base64');
  const sig = parseSignatureHeader(header)!;
  assert.equal(sig.kid, 'k1');
  assert.ok(signatureValid(body, sig, oneLine));
  assert.ok(!signatureValid(body.replace('tvdeals', 'other'), sig, oneLine));
  assert.equal(parseSignatureHeader('not base64 json'), null);
  assert.equal(parseSignatureHeader(undefined), null);
});

test('deletion notice: only the account deletion topic with a username', () => {
  const n = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: 'n1', eventDate: '2026-10-01T10:00:00.000Z', data: { username: 'tvdeals', userId: 'u1', eiasToken: 'x' } } };
  assert.deepEqual(parseDeletionNotice(n), { notificationId: 'n1', eventDate: '2026-10-01T10:00:00.000Z', username: 'tvdeals', userId: 'u1' });
  assert.equal(parseDeletionNotice({ ...n, metadata: { topic: 'OTHER' } }), null);
  assert.equal(parseDeletionNotice({ metadata: n.metadata, notification: { notificationId: 'n2', data: {} } }), null);
});

test('endpoint: 503 until configured, answers the challenge, refuses an unsigned notification', async () => {
  const saved = [config.EBAY_VERIFICATION_TOKEN, config.EBAY_DELETION_ENDPOINT];
  const app = Fastify();
  await app.register(ebayRoutes);
  try {
    config.EBAY_VERIFICATION_TOKEN = undefined;
    assert.equal((await app.inject({ method: 'GET', url: '/ebay/account-deletion?challenge_code=abc' })).statusCode, 503);
    config.EBAY_VERIFICATION_TOKEN = TOKEN;
    config.EBAY_DELETION_ENDPOINT = ENDPOINT;
    const res = await app.inject({ method: 'GET', url: '/ebay/account-deletion?challenge_code=abc' });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /application\/json/);
    assert.deepEqual(res.json(), { challengeResponse: challengeResponse('abc', TOKEN, ENDPOINT) });
    assert.equal((await app.inject({ method: 'GET', url: '/ebay/account-deletion' })).statusCode, 400);
    const post = await app.inject({ method: 'POST', url: '/ebay/account-deletion', headers: { 'content-type': 'application/json' }, payload: '{"metadata":{}}' });
    assert.equal(post.statusCode, 412);
  } finally {
    [config.EBAY_VERIFICATION_TOKEN, config.EBAY_DELETION_ENDPOINT] = saved;
    await app.close();
  }
});
