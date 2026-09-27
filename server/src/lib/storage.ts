import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT || undefined,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials:
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
      : undefined,
});

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface StoredObject {
  uri: string; // s3://bucket/key
  key: string;
  sha256: string; // hex
  bytes: number;
  /** Object Lock applied to this object (null when S3_OBJECT_LOCK_DAYS is 0). */
  lock: { mode: 'GOVERNANCE' | 'COMPLIANCE'; until: Date } | null;
}

/**
 * Store a file and return its SHA-256. The hash is sent to S3 as a checksum too, so the
 * storage service rejects the upload if the bytes it received differ from what we hashed.
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
  const hash = createHash('sha256').update(body);
  const hex = hash.copy().digest('hex');
  const b64 = hash.digest('base64');
  const input: PutObjectCommandInput = {
    Bucket: config.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ChecksumSHA256: b64,
    Metadata: { sha256: hex },
  };
  let lock: StoredObject['lock'] = null;
  if (config.S3_OBJECT_LOCK_DAYS > 0) {
    lock = { mode: 'GOVERNANCE', until: new Date(Date.now() + config.S3_OBJECT_LOCK_DAYS * 86_400_000) };
    input.ObjectLockMode = lock.mode;
    input.ObjectLockRetainUntilDate = lock.until;
  }
  await s3.send(new PutObjectCommand(input));
  return { uri: `s3://${config.S3_BUCKET}/${key}`, key, sha256: hex, bytes: body.length, lock };
}

export function keyFromUri(uri: string): string {
  const prefix = `s3://${config.S3_BUCKET}/`;
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : uri.replace(/^s3:\/\/[^/]+\//, '');
}

/** Short-lived download link for an evidence file. */
export async function signedUrl(uri: string, expiresInSeconds = 900): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: keyFromUri(uri) }), {
    expiresIn: expiresInSeconds,
  });
}

export async function ensureBucket(): Promise<'exists' | 'created'> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return 'exists';
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET, ObjectLockEnabledForBucket: true }));
    return 'created';
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}

export interface LockStatus {
  /** The bucket has Object Lock enabled (it can only be enabled, never turned off). */
  bucketEnabled: boolean;
  defaultRule: string | null;
  /** New evidence gets a retention period (S3_OBJECT_LOCK_DAYS > 0). */
  retentionDays: number;
  problem: string | null;
}

/** Is evidence written now protected by Object Lock? Checked by the worker at start-up. */
export async function evidenceLockStatus(): Promise<LockStatus> {
  let bucketEnabled = false;
  let defaultRule: string | null = null;
  try {
    const r = await s3.send(new GetObjectLockConfigurationCommand({ Bucket: config.S3_BUCKET }));
    bucketEnabled = r.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
    const d = r.ObjectLockConfiguration?.Rule?.DefaultRetention;
    defaultRule = d ? `${d.Mode} ${d.Days ?? d.Years} ${d.Days ? 'days' : 'years'}` : null;
  } catch {
    bucketEnabled = false;
  }
  const retentionDays = config.S3_OBJECT_LOCK_DAYS;
  const problem = !bucketEnabled
    ? `bucket ${config.S3_BUCKET} has no Object Lock`
    : retentionDays <= 0 && !defaultRule
      ? 'S3_OBJECT_LOCK_DAYS is 0 and the bucket has no default retention'
      : null;
  return { bucketEnabled, defaultRule, retentionDays, problem };
}

/** Re-read a stored evidence file and check its bytes still hash to the recorded SHA-256. */
export async function verifyEvidence(uri: string, sha256: string): Promise<{ ok: boolean; actual: string; retainUntil: Date | null; mode: string | null }> {
  const Key = keyFromUri(uri);
  const obj = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key }));
  const bytes = Buffer.from(await obj.Body!.transformToByteArray());
  const actual = sha256Hex(bytes);
  let retainUntil: Date | null = null;
  let mode: string | null = null;
  try {
    const r = await s3.send(new GetObjectRetentionCommand({ Bucket: config.S3_BUCKET, Key }));
    retainUntil = r.Retention?.RetainUntilDate ?? null;
    mode = r.Retention?.Mode ?? null;
  } catch {
    // no retention on this object
  }
  return { ok: actual === sha256, actual, retainUntil, mode };
}
