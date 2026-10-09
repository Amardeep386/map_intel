import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'mirethos-map-intel';

export interface TokenClaims {
  sub: string; // user id
  email: string;
  role: 'admin' | 'member';
  /** The session was opened with a second factor (MFA code or recovery code, or SSO later). */
  mfa?: boolean;
  /** When the session was issued (seconds since epoch): a later password reset ends it. */
  iat?: number;
}

/** Between the password and the second factor: proves the password was right, nothing else. */
export type ChallengePurpose = 'mfa' | 'mfa-setup';

// bcrypt work factor. 10 keeps sign-in around a second on a small shared CPU (Render free plan);
// older cost-12 hashes are rewritten at the next successful sign-in (see needsRehash).
const PASSWORD_COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_COST);
}

/** True when a stored hash uses a different work factor than new hashes do. */
export function needsRehash(hash: string): boolean {
  try {
    const rounds = bcrypt.getRounds(hash); // NaN for a malformed hash
    return Number.isInteger(rounds) && rounds !== PASSWORD_COST;
  } catch {
    return false;
  }
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role, mfa: claims.mfa === true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_HOURS}h`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
  if (typeof payload.sub !== 'string') throw new Error('token has no subject');
  if (payload.pur) throw new Error('a sign-in challenge is not a session');
  return {
    sub: payload.sub,
    email: String(payload.email ?? ''),
    role: payload.role === 'admin' ? 'admin' : 'member',
    mfa: payload.mfa === true,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
  };
}

/** A ten-minute token for the second sign-in step only. */
export async function signChallenge(userId: string, purpose: ChallengePurpose): Promise<string> {
  return new SignJWT({ pur: purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

/** SSO (Phase 5 · M8): what the provider's redirect carries back, signed; ten minutes. Never a session. */
export interface SsoState {
  provider: string;
  nonce: string;
  verifier: string;
  browser: string; // must match the browser's cookie (stops login CSRF)
}

export async function signSsoState(s: SsoState): Promise<string> {
  return new SignJWT({ pur: 'sso-state', p: s.provider, n: s.nonce, v: s.verifier, b: s.browser })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

export async function verifySsoState(token: string): Promise<SsoState> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
  if (payload.pur !== 'sso-state') throw new Error('not an SSO state');
  return { provider: String(payload.p), nonce: String(payload.n), verifier: String(payload.v), browser: String(payload.b) };
}

export async function verifyChallenge(token: string, purposes: ChallengePurpose[]): Promise<{ userId: string; purpose: ChallengePurpose }> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
  if (typeof payload.sub !== 'string' || !purposes.includes(payload.pur as ChallengePurpose)) throw new Error('not a sign-in challenge');
  return { userId: payload.sub, purpose: payload.pur as ChallengePurpose };
}
