// SFTP delivery of report files (Phase 3). The password or private key comes from the vault (an
// 'sftp' credential: username + secret). Host, port, folder and the server's host-key fingerprint
// are not secret and live in the report's destination. The host key is always pinned: an unknown
// or changed key refuses the connection. Every uploaded file is read back and its SHA-256 compared.
import { createHash } from 'node:crypto';
import path from 'node:path/posix';
import SftpClient from 'ssh2-sftp-client';
import type { Db } from './db.js';
import { registerSftp, type DeliveryResult, type StoredFile } from './reportRunner.js';
import { getObjectBytes } from './storage.js';
import { decrypt } from './vault.js';

export interface SftpDestination {
  credentialId: string;
  host: string;
  port?: number;
  folder?: string;
  hostKey?: string; // "SHA256:<base64>" as ssh-keygen -lf prints it
}

export interface SftpLogin { host: string; port: number; username: string; password?: string; privateKey?: string }

/** "SHA256:<base64 without padding>", the OpenSSH fingerprint format. */
export const fingerprint = (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
const sameFingerprint = (a: string, b: string) => a.replace(/^SHA256:/, '').replace(/=+$/, '') === b.trim().replace(/^SHA256:/, '').replace(/=+$/, '');

export class SftpError extends Error {
  constructor(message: string, public seenHostKey: string | null = null) {
    super(message);
  }
}

/** The login for a destination: username and secret from the vault, read as the credential's account. */
export async function sftpLogin(db: Db, accountId: string, dest: SftpDestination): Promise<SftpLogin> {
  const c = (await db.query<{ kind: string; username: string | null; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_id: string; account_id: string }>(
    'SELECT kind, username, ciphertext, iv, auth_tag, key_id, account_id FROM credential WHERE id = $1 AND account_id = $2',
    [dest.credentialId, accountId],
  )).rows[0];
  if (!c || c.kind !== 'sftp') throw new SftpError('SFTP credential not found in this account');
  if (!c.username) throw new SftpError('the SFTP credential has no username');
  const secret = decrypt({ ciphertext: c.ciphertext, iv: c.iv, authTag: c.auth_tag, keyId: c.key_id }, { accountId, kind: 'sftp' });
  const isKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(secret);
  return { host: dest.host, port: dest.port ?? 22, username: c.username, ...(isKey ? { privateKey: secret } : { password: secret }) };
}

/** Connect with the host key pinned. Without a pinned key the connection is refused, but the key seen is reported. */
async function connect(login: SftpLogin, hostKey: string | undefined): Promise<SftpClient> {
  let seen: string | null = null;
  const client = new SftpClient('map-intel');
  try {
    await client.connect({
      host: login.host, port: login.port, username: login.username, password: login.password, privateKey: login.privateKey,
      readyTimeout: 20_000, retries: 0,
      hostVerifier: (key: Buffer) => {
        seen = fingerprint(key);
        return !!hostKey && sameFingerprint(seen, hostKey);
      },
    });
  } catch (err) {
    await client.end().catch(() => undefined);
    if (seen && (!hostKey || !sameFingerprint(seen, hostKey))) {
      throw new SftpError(hostKey ? `the server's host key changed (now ${seen}); refusing to connect` : `confirm the server's host key ${seen}`, seen);
    }
    throw new SftpError(`could not connect to ${login.host}:${login.port}: ${(err as Error).message}`, seen);
  }
  return client;
}

export interface Uploaded { name: string; remotePath: string; bytes: number; sha256: string; verified: boolean }

/** Upload files into `folder` (created if missing), then read each back and compare its SHA-256. */
export async function uploadFiles(login: SftpLogin, hostKey: string | undefined, folder: string, files: { name: string; body: Buffer }[]): Promise<Uploaded[]> {
  const client = await connect(login, hostKey);
  try {
    const dir = folder.trim() || '.';
    if (dir !== '.' && !(await client.exists(dir))) await client.mkdir(dir, true);
    const out: Uploaded[] = [];
    for (const f of files) {
      const remotePath = dir === '.' ? f.name : path.join(dir, f.name);
      await client.put(f.body, remotePath);
      const back = (await client.get(remotePath)) as Buffer;
      const sha256 = createHash('sha256').update(f.body).digest('hex');
      out.push({ name: f.name, remotePath, bytes: f.body.length, sha256, verified: createHash('sha256').update(back).digest('hex') === sha256 });
    }
    return out;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** "Test connection": write and remove a small file. Reports the host key seen so it can be pinned. */
export async function testConnection(login: SftpLogin, hostKey: string | undefined, folder: string): Promise<{ ok: boolean; hostKey: string | null; message: string }> {
  try {
    const name = `.map-intel-test-${Date.now()}.txt`;
    const [u] = await uploadFiles(login, hostKey, folder, [{ name, body: Buffer.from('MAP Intel connection test\n') }]);
    const client = await connect(login, hostKey);
    await client.delete(u.remotePath).catch(() => undefined);
    await client.end().catch(() => undefined);
    return { ok: u.verified, hostKey: hostKey ?? null, message: u.verified ? `Wrote and read back a test file in ${folder || 'the home folder'}.` : 'The test file read back differently.' };
  } catch (err) {
    return { ok: false, hostKey: err instanceof SftpError ? err.seenHostKey : null, message: (err as Error).message };
  }
}

/** Report delivery: every stored file of the run (PDF and CSV), from S3 to the destination folder. */
export async function deliverSftp(db: Db, run: { id: string; accountId: string; files: StoredFile[] }, dest: SftpDestination): Promise<DeliveryResult> {
  const target = `${dest.host}:${dest.folder || '~'}`;
  const login = await sftpLogin(db, run.accountId, dest);
  const files = [];
  for (const f of run.files) files.push({ name: f.fileName, body: await getObjectBytes(f.key) });
  const up = await uploadFiles(login, dest.hostKey, dest.folder ?? '', files);
  const ok = up.every((u) => u.verified);
  return { channel: 'sftp', status: ok ? 'delivered' : 'failed', target, detail: { files: up, hostKey: dest.hostKey } };
}

registerSftp(deliverSftp);
