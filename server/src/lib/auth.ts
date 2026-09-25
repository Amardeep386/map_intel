import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'mirethos-map-intel';

export interface TokenClaims {
  sub: string; // user id
  email: string;
  role: 'admin' | 'member';
}

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
  return new SignJWT({ email: claims.email, role: claims.role })
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
  return {
    sub: payload.sub,
    email: String(payload.email ?? ''),
    role: payload.role === 'admin' ? 'admin' : 'member',
  };
}
