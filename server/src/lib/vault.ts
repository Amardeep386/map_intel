// Credential vault: AES-256-GCM with keys from VAULT_KEYS. The API only ever encrypts; `decrypt`
// is for the worker and delivery code (a unit test checks no API route imports it).
//
// Each secret is bound to its owner and kind through the GCM additional data, so a ciphertext
// copied onto another account's row does not decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
  hint: string;
}

export interface SecretOwner {
  accountId: string | null;
  kind: string;
}

type Keyring = Map<string, Buffer>;

/** Parse `id:base64,id:base64`. Every key must be exactly 32 bytes. */
export function parseKeyring(spec: string | undefined): Keyring {
  const ring: Keyring = new Map();
  for (const part of (spec ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i < 1) throw new Error('VAULT_KEYS entries must look like id:base64key');
    const id = part.slice(0, i);
    const key = Buffer.from(part.slice(i + 1), 'base64');
    if (key.length !== 32) throw new Error(`vault key ${id} must be 32 bytes (base64 of 32 random bytes)`);
    ring.set(id, key);
  }
  return ring;
}

let ring: Keyring | null = null;
function keyring(): Keyring {
  ring ??= parseKeyring(config.VAULT_KEYS);
  return ring;
}

/** Test hook: use a different keyring and active key. */
export function setKeyringForTests(spec: string, active: string): void {
  ring = parseKeyring(spec);
  activeOverride = active;
}
let activeOverride: string | null = null;

function activeKey(): { id: string; key: Buffer } {
  const id = activeOverride ?? config.VAULT_ACTIVE_KEY;
  const key = id ? keyring().get(id) : undefined;
  if (!id || !key) throw new Error('credential vault is not configured (set VAULT_KEYS and VAULT_ACTIVE_KEY in server/.env)');
  return { id, key };
}

export function vaultConfigured(): boolean {
  try {
    activeKey();
    return true;
  } catch {
    return false;
  }
}

const aad = (o: SecretOwner) => Buffer.from(`${o.accountId ?? 'platform'}|${o.kind}`, 'utf8');

/** A short, safe hint for the portal: the last 4 characters of long secrets only. */
export function hintFor(secret: string): string {
  return secret.length >= 12 ? `…${secret.slice(-4)}` : '••••';
}

export function encrypt(secret: string, owner: SecretOwner): SealedSecret {
  const { id, key } = activeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(owner));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: id, hint: hintFor(secret) };
}

export function decrypt(sealed: Omit<SealedSecret, 'hint'>, owner: SecretOwner): string {
  const key = keyring().get(sealed.keyId);
  if (!key) throw new Error(`vault key ${sealed.keyId} is not in VAULT_KEYS`);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAAD(aad(owner));
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}
