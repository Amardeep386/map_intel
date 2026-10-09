// Single sign-on (Phase 5 · M8): OpenID Connect authorization-code flow with PKCE, for Google and
// Microsoft (work or school accounts). The API checks the ID token itself: signature (the
// provider's published keys), issuer, audience, expiry and the one-time nonce.
//   Google:    the email, only when the provider says it is verified.
//   Microsoft: the sign-in name (preferred_username), which the organisation controls and must be on
//              one of its verified domains; the editable email claim is not trusted. Personal
//              Microsoft accounts are refused. The stable id is tenant id + object id.
// Other providers can be registered in tests (registerProvider) against a local mock.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from './config.js';

export interface Identity {
  subject: string;
  email: string;
  name: string | null;
}

export interface Provider {
  id: string;
  name: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** Checks the issuer and turns the verified claims into an identity, or throws. */
  identity: (claims: JWTPayload, discoveredIssuer: string) => Identity;
}

export class SsoError extends Error {}

const MS_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const looksLikeEmail = (s: unknown): s is string => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** Pure: Google's verified claims → identity. */
export function googleIdentity(c: JWTPayload): Identity {
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new SsoError('unexpected issuer');
  if (c.email_verified !== true || !looksLikeEmail(c.email)) throw new SsoError('Google did not confirm this email address');
  return { subject: String(c.sub), email: c.email.toLowerCase(), name: typeof c.name === 'string' ? c.name : null };
}

/** Pure: Microsoft's verified claims → identity (work or school accounts; sign-in name, not email). */
export function microsoftIdentity(c: JWTPayload, tenantSetting: string): Identity {
  const tid = typeof c.tid === 'string' ? c.tid : '';
  if (!tid || c.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new SsoError('unexpected issuer');
  if (tid === MS_CONSUMER_TENANT) throw new SsoError('use a work or school Microsoft account');
  if (!/^(organizations|common)$/.test(tenantSetting) && tid !== tenantSetting) throw new SsoError('this organisation is not allowed');
  if (typeof c.oid !== 'string' || !looksLikeEmail(c.preferred_username)) throw new SsoError('Microsoft did not return a sign-in name');
  return { subject: `${tid}:${c.oid}`, email: c.preferred_username.toLowerCase(), name: typeof c.name === 'string' ? c.name : null };
}

const google = (): Provider | null =>
  config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ? {
        id: 'google',
        name: 'Google',
        discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        scope: 'openid email profile',
        identity: (c) => googleIdentity(c),
      }
    : null;

const microsoft = (): Provider | null =>
  config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET
    ? {
        id: 'microsoft',
        name: 'Microsoft',
        discoveryUrl: `https://login.microsoftonline.com/${encodeURIComponent(config.MICROSOFT_TENANT)}/v2.0/.well-known/openid-configuration`,
        clientId: config.MICROSOFT_CLIENT_ID,
        clientSecret: config.MICROSOFT_CLIENT_SECRET,
        scope: 'openid email profile',
        identity: (c) => microsoftIdentity(c, config.MICROSOFT_TENANT),
      }
    : null;

const extra = new Map<string, Provider>();
/** Tests only: a provider backed by a local mock. */
export function registerProvider(p: Provider): void {
  extra.set(p.id, p);
}

export function providers(): Provider[] {
  return [google(), microsoft(), ...extra.values()].filter((p): p is Provider => p !== null);
}

export function provider(id: string): Provider | null {
  return providers().find((p) => p.id === id) ?? null;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
const discoveries = new Map<string, { at: number; doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> }>();

async function discover(p: Provider) {
  const cached = discoveries.get(p.discoveryUrl);
  if (cached && Date.now() - cached.at < 3_600_000) return cached;
  const res = await fetch(p.discoveryUrl);
  if (!res.ok) throw new SsoError(`${p.name} sign-in is not reachable (${res.status})`);
  const doc = (await res.json()) as Discovery;
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  discoveries.set(p.discoveryUrl, entry);
  return entry;
}

export const redirectUri = (p: Provider) => `${config.API_PUBLIC_URL.replace(/\/$/, '')}/auth/sso/${p.id}/callback`;
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export async function authorizationUrl(p: Provider, s: { state: string; nonce: string; verifier: string }): Promise<string> {
  const { doc } = await discover(p);
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(p),
    scope: p.scope,
    state: s.state,
    nonce: s.nonce,
    code_challenge: pkceChallenge(s.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Trade the code for an ID token and check it. */
export async function finish(p: Provider, code: string, verifier: string, nonce: string): Promise<Identity> {
  const { doc, jwks } = await discover(p);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(p),
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new SsoError(`${p.name} refused the sign-in${body.error ? ` (${body.error})` : ''}`);
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(body.id_token, jwks, { audience: p.clientId, clockTolerance: 60 }));
  } catch {
    throw new SsoError(`${p.name} sign-in could not be verified`);
  }
  if (claims.nonce !== nonce) throw new SsoError('the sign-in did not match this browser: try again');
  return p.identity(claims, doc.issuer);
}
