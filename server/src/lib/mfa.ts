// Multi-factor sign-in (Phase 5 · M7): authenticator app codes (RFC 6238 TOTP: HMAC-SHA1, six
// digits, 30-second steps, one step of clock drift either way) and one-time recovery codes.
// The shared secret is sealed with AES-256-GCM before it is stored; the key is MFA_KEY, or one
// derived from JWT_SECRET (HKDF) when MFA_KEY is not set.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.js';

export const ISSUER = 'Mirethos MAP Intel';
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what authenticator apps take). */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export const stepAt = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/** The code for one 30-second step. */
export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

/**
 * The step a code matches (now, or one step either side), or null. A step at or before
 * `lastStep` is refused, so the same code never works twice.
 */
export function checkTotp(secret: string, code: string, now: Date, lastStep: number | null): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepAt(now);
  for (const step of [s - 1, s, s + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, email: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function qrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

// ---------------------------------------------------------------- sealing the secret

function key(): Buffer {
  if (config.MFA_KEY) {
    const k = Buffer.from(config.MFA_KEY, 'base64');
    if (k.length !== 32) throw new Error('MFA_KEY must be 32 bytes, base64');
    return k;
  }
  return Buffer.from(hkdfSync('sha256', config.JWT_SECRET, 'mirethos-map-intel', 'mfa-secret-v1', 32));
}

export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('unknown MFA secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- recovery codes

/** Ten codes like "7KQ2-MAXD" (base32: letters and the digits 2-7). */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

// Codes have no 0, 1 or 8: someone who types those meant O, I and B.
const normaliseRecovery = (code: string) => code.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B').replace(/[^A-Z2-7]/g, '');

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecovery(code)).digest('hex');
}

export const looksLikeRecoveryCode = (code: string) => normaliseRecovery(code).length === 8 && /^[A-Za-z0-8]{4}-?[A-Za-z0-8]{4}$/.test(code.trim());
